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
// The bake is sized to the display canvas. The engine composites
// colors through a soft alpha mask (destination-in) so stroke-edge
// AA lives in the bake itself — no browser oversampling needed. If
// the canvas's CSS size changes after mount (responsive layout), the
// loader re-bakes via ResizeObserver.
//
// One knob, on the canvas as a data attribute:
//
//   data-supersample="N"  (default 1)
//     Multiplies the bake target. Bake long edge ≈ cssLong × dpr × N,
//     capped at MAX_BAKE_EDGE. Allowed values: 1, 2, 4. Anything else
//     falls back to 1 with a console.warn naming the bad value.
//       1 — fast; bake matches display pixels 1:1. Best for most logos.
//       2 — smoother; 4× the per-frame compute. Worth it for designs
//           with very thin strokes that look brittle at ss=1.
//       4 — smoothest, rarely needed; 16× the per-frame compute.
//           Hits the MAX_BAKE_EDGE cap quickly on retina.
//
// MAX_BAKE_EDGE is an internal safety ceiling so a huge canvas can't
// runaway-grow per-frame compute. Not user-tunable.

(function (root) {
  const DEFAULT_SUPERSAMPLE = 1;
  const ALLOWED_SUPERSAMPLE = [1, 2, 4];
  const MAX_BAKE_EDGE  = 1024;  // safety ceiling on bake's long side
  const MIN_BAKE_DIM   = 16;    // bake long-edge floor; below this, the
                                //   drawing is too small to render usefully
  const MIN_BAKE_SCALE = 0.02;  // scale floor; bbox × this is a few pixels
  const REBAKE_THRESHOLD = 0.05; // re-bake when cssLong changes by >5%

  function anchorBBox(anchors) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const a of anchors) {
      if (a.x < minX) minX = a.x; if (a.x > maxX) maxX = a.x;
      if (a.y < minY) minY = a.y; if (a.y > maxY) maxY = a.y;
    }
    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
  }

  function parseSupersample(canvas) {
    const raw = canvas.dataset.supersample;
    if (raw == null || raw === '') return DEFAULT_SUPERSAMPLE;
    const n = +raw;
    if (ALLOWED_SUPERSAMPLE.indexOf(n) === -1) {
      console.warn(
        'NeonicLoader: data-supersample="' + raw + '" not in [1, 2, 4]; ' +
        'using ' + DEFAULT_SUPERSAMPLE);
      return DEFAULT_SUPERSAMPLE;
    }
    return n;
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

    // Recover logical padding from metadata. Guard against scale=0 or
    // missing values in malformed files.
    const exportPadding = metadata.padding != null ? metadata.padding : 24;
    const exportScale   = metadata.scale > 0 ? metadata.scale : 1.6;
    const paddingLogical = metadata.paddingLogical != null
      ? metadata.paddingLogical
      : exportPadding / exportScale;

    const dpr = root.devicePixelRatio || 1;
    const ss  = parseSupersample(canvas);
    const cssW = canvas.clientWidth  || canvas.width  || 320;
    const cssH = canvas.clientHeight || canvas.height || 320;
    const cssLong = Math.max(cssW, cssH);

    let targetLong = ss * cssLong * dpr;
    if (targetLong > MAX_BAKE_EDGE) targetLong = MAX_BAKE_EDGE;
    if (targetLong < MIN_BAKE_DIM)  targetLong = MIN_BAKE_DIM;

    const denom = Math.max(1, longBbox + 2 * paddingLogical);
    const scale = Math.max(MIN_BAKE_SCALE, targetLong / denom);
    const padding = Math.max(1, Math.round(paddingLogical * scale));
    return { scale, padding, cssLong };
  }

  function bakeForCanvas(canvas, metadata) {
    const half = metadata.half || 'full';
    const { scale, padding, cssLong } = planBake(canvas, metadata);
    const baked = root.Neonic.bakeFromAnchors({
      anchors: metadata.anchors,
      scale, padding, half,
    });
    return { baked, cssLong };
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

  // Re-bake when the canvas's CSS dims change by more than ~5%. The
  // observer also fires after the bake step itself sets canvas.width
  // (because that changes the canvas's intrinsic, which feeds the
  // auto CSS dim) — the threshold check prevents that triggering an
  // infinite rebake loop. Detached canvases stop being observed
  // automatically; we also clean up on engine.dispose().
  function attachResizeObserver(canvas, ctx) {
    if (typeof root.ResizeObserver === 'undefined') return null;
    const obs = new root.ResizeObserver(() => {
      if (!canvas.isConnected || ctx.disposed) return;
      const cssLong = Math.max(canvas.clientWidth, canvas.clientHeight);
      if (!cssLong) return;
      const last = ctx.lastCssLong || 1;
      const change = Math.abs(cssLong - last) / last;
      if (change < REBAKE_THRESHOLD) return;
      collapseCanvasIntrinsic(canvas);
      const { baked, cssLong: newCssLong } = bakeForCanvas(canvas, ctx.metadata);
      ctx.lastCssLong = newCssLong;
      // Explicitly release the previous mask canvas's backing buffer
      // before swapping the reference. Browsers will GC the orphan
      // eventually, but a long-lived page that resizes a lot (window
      // drags, external-monitor moves) builds up MBs of canvas data
      // between collections.
      const oldMask = ctx.eng.maskCanvas;
      if (oldMask) { oldMask.width = 0; oldMask.height = 0; }
      ctx.eng.baked = baked;
      ctx.eng.maskCanvas = baked.maskCanvas || null;
      canvas.width = baked.width; canvas.height = baked.height;
      ctx.eng.image = ctx.eng.ctx.createImageData(baked.width, baked.height);
      ctx.eng.data32 = new Uint32Array(ctx.eng.image.data.buffer);
      ctx.eng._palDirty = true;  // force a repaint at the new size
    });
    obs.observe(canvas);
    return obs;
  }

  async function mount(canvas, src) {
    src = src || canvas.dataset.src;
    const buf = await fetch(src).then((r) => {
      if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
      return r.arrayBuffer();
    });
    if (!canvas.isConnected) return null;  // detached mid-fetch; bail

    const { metadata } = root.NeonicPng.decode(new Uint8Array(buf));
    if (!metadata.anchors || metadata.anchors.length < 2) {
      throw new Error('NEONIC PNG is missing anchors');
    }
    await waitForLayout(canvas);
    if (!canvas.isConnected) return null;

    collapseCanvasIntrinsic(canvas);
    const { baked, cssLong: lastCssLong } = bakeForCanvas(canvas, metadata);

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
      eng.setSpeed(p.speed);  // sign preserved: negative = cycle backward
    }
    applyPalette(curIdx);

    // Playlist watcher runs inside the engine's _frame, so there's only
    // one rAF loop and eng.stop() halts everything.
    if (palettes.length > 1) {
      eng.onFrame = function () {
        if (eng.nextPalette !== null) {
          // Tween speed across the 254-tick feed-in. Sign-preserving.
          const tFrac = Math.max(0, Math.min(1,
            (eng.offset - eng.nextStartOff) / 254));
          const s1 = palettes[curIdx].speed;
          const s2 = palettes[pendingNext].speed;
          eng.setSpeed(s1 + (s2 - s1) * tFrac);
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
      };
    }

    const ctx = { eng, metadata, lastCssLong, disposed: false, observer: null };
    ctx.observer = attachResizeObserver(canvas, ctx);

    // Augment eng with a dispose() that releases observer + breaks ref
    // cycles. eng.stop() pauses the rAF; dispose() makes the cleanup
    // permanent.
    eng.dispose = function () {
      ctx.disposed = true;
      eng.stop();
      if (ctx.observer) { ctx.observer.disconnect(); ctx.observer = null; }
      eng.onFrame = null;
      // Release the mask canvas's backing buffer eagerly — same
      // reasoning as the rebake path.
      if (eng.maskCanvas) {
        eng.maskCanvas.width = 0;
        eng.maskCanvas.height = 0;
      }
      eng.maskCanvas = null;
    };

    eng.start();
    return eng;
  }

  // Promise.allSettled, not all — one broken PNG or detached canvas
  // shouldn't take down every other logo on the page. Failed mounts
  // are logged so a developer sees them, then dropped.
  function mountAll(selector) {
    const canvases = document.querySelectorAll(selector || '.logo-cycle');
    return Promise.allSettled(Array.from(canvases).map((c) =>
      mount(c).catch((err) => {
        console.warn('Neonic: mount failed for', c, err);
        throw err;
      })
    ));
  }

  root.NeonicLoader = { mount, mountAll };
})(window);
