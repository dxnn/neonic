// neonic-loader.js
// Mount a .neonic.png onto a <canvas>. Requires logo-engine-standalone.js
// and neonic-png.js to have been loaded first as globals.
//
//   <canvas class="logo-cycle" data-src="logo.neonic.png"></canvas>
//   <script src="neonic-playback.js"></script>
//   <script>NeonicLoader.mountAll('.logo-cycle');</script>
//
// Or call NeonicLoader.mount(canvas) directly. Returns the CycleEngine.
//
// The loader re-bakes from the anchors stored in the PNG's metadata.
// The engine paints through a smooth alpha mask (composited via
// destination-in) so stroke-edge anti-aliasing lives inside the bake
// itself — no browser oversampling needed for clean edges. That lets
// the bake match the display canvas exactly: bake.long ≈ cssLong ×
// devicePixelRatio × supersample.
//
// data-supersample="N" on the canvas multiplies the display target.
//   Default 1. Raise to chase extra smoothness on tiny displays;
//   drop below 1 to trade quality for compute.
//
// MAX_BAKE_EDGE caps the long edge so a huge canvas can't runaway-grow
// per-frame compute.

(function (root) {
  const DEFAULT_SUPERSAMPLE = 1;
  const MAX_BAKE_EDGE = 1024;     // safety ceiling on bake's long side

  function anchorBBox(anchors) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const a of anchors) {
      if (a.x < minX) minX = a.x; if (a.x > maxX) maxX = a.x;
      if (a.y < minY) minY = a.y; if (a.y > maxY) maxY = a.y;
    }
    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
  }

  // Without this, an embed using e.g. `height:32px; width:auto` reports
  // a pre-mount clientWidth of ~64 — the auto dim derives from the
  // canvas's default 300×150 intrinsic aspect (2:1), inflating the
  // measurement. Setting the attribute size to 1×1 collapses the
  // intrinsic to 1:1, so the auto dim now equals the explicit dim.
  // The bake step will overwrite canvas.width/height afterward.
  function collapseCanvasIntrinsic(canvas) {
    canvas.width = 1; canvas.height = 1;
    void canvas.offsetHeight;  // force a sync reflow
  }

  // Pick scale + padding so the bake's long edge matches the display
  // canvas exactly (× dpr × supersample), capped at MAX_BAKE_EDGE.
  //
  // Padding is treated as a *logical* (anchor-space) quantity recovered
  // from the export's metadata.padding / metadata.scale ratio — that
  // way the visual proportion of margin around the drawing is the same
  // regardless of how big or small we bake. Without this, a small bake
  // has the same 24 bake-pixels of padding as a big one and the drawing
  // visibly shrinks within the canvas.
  //
  // bake.long = bbox.long × scale + 2 × padding_bake
  //           = bbox.long × scale + 2 × scale × paddingLogical
  //           = (bbox.long + 2 × paddingLogical) × scale
  // Solve for scale given a target bake.long.
  function planBake(canvas, metadata) {
    const bbox = anchorBBox(metadata.anchors);
    const longBbox = Math.max(bbox.w, bbox.h);

    const exportPadding = metadata.padding != null ? metadata.padding : 24;
    const exportScale   = metadata.scale != null ? metadata.scale : 1.6;
    const paddingLogical = exportPadding / exportScale;

    const dpr = root.devicePixelRatio || 1;
    const ss  = +canvas.dataset.supersample || DEFAULT_SUPERSAMPLE;
    const cssW = canvas.clientWidth  || canvas.width  || 320;
    const cssH = canvas.clientHeight || canvas.height || 320;
    const cssLong = Math.max(cssW, cssH);

    let targetLong = ss * cssLong * dpr;
    if (targetLong > MAX_BAKE_EDGE) targetLong = MAX_BAKE_EDGE;
    if (targetLong < 16) targetLong = 16;

    const denom = Math.max(1, longBbox + 2 * paddingLogical);
    const scale = Math.max(0.02, targetLong / denom);
    const padding = Math.max(1, Math.round(paddingLogical * scale));
    return { scale, padding };
  }

  function bakeForCanvas(canvas, metadata) {
    const half = metadata.half || 'full';
    const { scale, padding } = planBake(canvas, metadata);
    return root.Neonic.bakeFromAnchors({
      anchors: metadata.anchors,
      scale, padding, half,
    });
  }

  // If the canvas hasn't been laid out yet, clientWidth/Height is 0
  // and we'd fall back to the canvas's attribute size — for a fresh
  // <canvas> that's 300×150, which is the wrong shape and the wrong
  // size. One rAF tick is enough for the browser to assign the
  // CSS-driven layout; we only wait if the layout really is zero.
  function waitForLayout(canvas) {
    if (canvas.clientWidth > 0 && canvas.clientHeight > 0) return Promise.resolve();
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  async function mount(canvas, src) {
    src = src || canvas.dataset.src;
    const buf = await fetch(src).then((r) => {
      if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
      return r.arrayBuffer();
    });
    const { metadata } = root.NeonicPng.decode(new Uint8Array(buf));

    if (!metadata.anchors || metadata.anchors.length < 2) {
      throw new Error('NEONIC PNG is missing anchors');
    }
    await waitForLayout(canvas);
    collapseCanvasIntrinsic(canvas);
    const baked = bakeForCanvas(canvas, metadata);

    const eng = new root.Neonic.CycleEngine(canvas, baked);
    const palettes = metadata.palettes;
    const mode = metadata.playMode || 'sequential';
    let curIdx = (typeof metadata.activeIdx === 'number'
                  && metadata.activeIdx >= 0
                  && metadata.activeIdx < palettes.length) ? metadata.activeIdx : 0;
    let pendingNext = -1;
    let target = palettes[curIdx].cycles || 1;

    function applyPalette(i) {
      const p = palettes[i];
      eng.setPalette(root.Neonic.buildRamp(p.stops));
      eng.setSpeed(Math.abs(p.speed));
    }
    applyPalette(curIdx);
    eng.start();

    if (palettes.length < 2) return eng;

    function tick() {
      if (eng.running) {
        if (eng.nextPalette !== null) {
          // Tween speed across the 254-tick feed-in.
          const tFrac = Math.max(0, Math.min(1,
            (eng.offset - eng.nextStartOff) / 254));
          const s1 = palettes[curIdx].speed;
          const s2 = palettes[pendingNext].speed;
          eng.setSpeed(Math.abs(s1 + (s2 - s1) * tFrac));
        } else if (pendingNext >= 0) {
          curIdx = pendingNext; pendingNext = -1;
          applyPalette(curIdx);
          target = mode === 'surprise'
            ? 1 + Math.floor(Math.random() * 4)
            : (palettes[curIdx].cycles || 1);
        } else if ((eng.offset - eng.baseStartOff) / 255 >= target) {
          let next;
          if (mode === 'sequential') next = (curIdx + 1) % palettes.length;
          else { do { next = Math.floor(Math.random() * palettes.length); }
                 while (next === curIdx); }
          pendingNext = next;
          eng.transitionTo(
            root.Neonic.buildRamp(palettes[next].stops),
            eng.baseStartOff + target * 255);
        }
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    return eng;
  }

  function mountAll(selector) {
    const canvases = document.querySelectorAll(selector || '.logo-cycle');
    return Promise.all(Array.from(canvases).map((c) => mount(c)));
  }

  root.NeonicLoader = { mount, mountAll };
})(window);
