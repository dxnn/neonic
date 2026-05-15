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
// The loader re-bakes from the anchors stored in the PNG's metadata
// at the canvas's display resolution × devicePixelRatio × supersample.
// A small CSS-shrunk canvas thus pays small per-frame compute. The
// bake's long edge is capped at MAX_BAKE_EDGE so a huge canvas can't
// blow up frame compute.
//
// data-supersample="N"  on the canvas overrides the supersample
//   factor (default 2 = 4× pixel oversample over CSS at dpr=2).
//   Drop to 1 if compute is more important than smoothness on a
//   particular embed; raise above 2 to chase the legacy "bake big,
//   downsample" look (subject to the MAX_BAKE_EDGE cap).

(function (root) {
  const DEFAULT_SUPERSAMPLE = 2;
  const MAX_BAKE_EDGE = 1024;     // safety ceiling on bake's long side

  function anchorBBox(anchors) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const a of anchors) {
      if (a.x < minX) minX = a.x; if (a.x > maxX) maxX = a.x;
      if (a.y < minY) minY = a.y; if (a.y > maxY) maxY = a.y;
    }
    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
  }

  // Pick a bake scale that fills cssSize × dpr × supersample without
  // overflowing either axis, then clamp so the bake's long edge stays
  // ≤ MAX_BAKE_EDGE (defensive against very large canvases on retina,
  // where the naive supersample target would balloon to 3M+ px/frame).
  function chooseBakeScale(canvas, bbox, padding) {
    if (bbox.w <= 0 && bbox.h <= 0) return 1;

    const dpr = root.devicePixelRatio || 1;
    const ss  = +canvas.dataset.supersample || DEFAULT_SUPERSAMPLE;
    const cssW = canvas.clientWidth  || canvas.width  || 320;
    const cssH = canvas.clientHeight || canvas.height || 320;
    const targetW = cssW * dpr * ss;
    const targetH = cssH * dpr * ss;

    const usableW = Math.max(8, targetW - padding * 2);
    const usableH = Math.max(8, targetH - padding * 2);
    const sW = bbox.w > 0 ? usableW / bbox.w : Infinity;
    const sH = bbox.h > 0 ? usableH / bbox.h : Infinity;
    let scale = Math.min(sW, sH);

    const longBboxEdge = Math.max(bbox.w, bbox.h);
    const longBakeEdge = longBboxEdge * scale + padding * 2;
    if (longBakeEdge > MAX_BAKE_EDGE) {
      scale = (MAX_BAKE_EDGE - padding * 2) / longBboxEdge;
    }
    return Math.max(0.05, scale);
  }

  function bakeForCanvas(canvas, metadata) {
    const padding = metadata.padding != null ? metadata.padding : 24;
    const half    = metadata.half || 'full';
    const bbox    = anchorBBox(metadata.anchors);
    const scale   = chooseBakeScale(canvas, bbox, padding);
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
