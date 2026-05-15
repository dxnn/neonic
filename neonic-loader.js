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
// When the source PNG carries editable anchors in its metadata, the
// loader re-bakes at the canvas's display resolution × devicePixelRatio
// instead of using the export-time indices buffer. That means a small
// canvas pays small per-frame compute, and the file doesn't have to ship
// a giant indices blob just to be displayed at thumbnail size. Old
// PNGs without anchors fall back to the embedded indices buffer.
//
// data-supersample="2"  on the canvas requests extra oversampling
//   (default 1 = matched-resolution bake). Higher = smoother strokes
//   at the cost of more compute per frame.

(function (root) {
  function anchorBBox(anchors) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const a of anchors) {
      if (a.x < minX) minX = a.x; if (a.x > maxX) maxX = a.x;
      if (a.y < minY) minY = a.y; if (a.y > maxY) maxY = a.y;
    }
    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
  }

  // Pick a bake scale that fills the canvas's pixel-resolution box
  // (cssSize × devicePixelRatio × supersample) without overflowing
  // either axis. Padding lives outside the anchor bbox in the bake, so
  // we subtract it from the target box before dividing.
  function chooseBakeScale(canvas, anchors, fallbackW, fallbackH, padding) {
    const bbox = anchorBBox(anchors);
    if (bbox.w <= 0 && bbox.h <= 0) return 1;

    const dpr = root.devicePixelRatio || 1;
    const ss  = +canvas.dataset.supersample || 1;
    const cssW = canvas.clientWidth  || canvas.width  || fallbackW || 320;
    const cssH = canvas.clientHeight || canvas.height || fallbackH || 320;
    const targetW = cssW * dpr * ss;
    const targetH = cssH * dpr * ss;

    const usableW = Math.max(8, targetW - padding * 2);
    const usableH = Math.max(8, targetH - padding * 2);
    const sW = bbox.w > 0 ? usableW / bbox.w : Infinity;
    const sH = bbox.h > 0 ? usableH / bbox.h : Infinity;
    return Math.max(0.05, Math.min(sW, sH));
  }

  function bakeForCanvas(canvas, metadata, fallbackW, fallbackH) {
    const padding = metadata.padding != null ? metadata.padding : 24;
    const half    = metadata.half || 'full';
    const scale   = chooseBakeScale(canvas, metadata.anchors,
                                    fallbackW, fallbackH, padding);
    return root.Neonic.bakeFromAnchors({
      anchors: metadata.anchors,
      scale, padding, half,
    });
  }

  async function mount(canvas, src) {
    src = src || canvas.dataset.src;
    const buf = await fetch(src).then((r) => {
      if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
      return r.arrayBuffer();
    });
    const { width, height, indices, metadata } =
      root.NeonicPng.decode(new Uint8Array(buf));

    // Anchors carry the geometry; rebake at the actual display
    // resolution so the engine paints only what the canvas shows. Fall
    // back to the embedded indices buffer when anchors aren't present
    // (legacy PNGs from before this loader version).
    let baked;
    if (metadata.anchors && metadata.anchors.length >= 2
        && root.Neonic.bakeFromAnchors) {
      baked = bakeForCanvas(canvas, metadata, width, height);
    } else if (indices) {
      baked = { width, height, indices };
    } else {
      throw new Error('NEONIC PNG has neither anchors nor indices');
    }

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
