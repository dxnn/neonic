// pshift-loader.js
// Mount a .pshift.png onto a <canvas>. Requires logo-engine-standalone.js
// and pshift-png.js to have been loaded first as globals.
//
//   <canvas class="logo-cycle" data-src="logo.pshift.png"></canvas>
//   <script src="logo-engine-standalone.js"></script>
//   <script src="pshift-png.js"></script>
//   <script src="pshift-loader.js"></script>
//   <script>PshiftLoader.mountAll('.logo-cycle');</script>
//
// Or call PshiftLoader.mount(canvas) directly. Returns the CycleEngine.

(function (root) {
  async function mount(canvas, src) {
    src = src || canvas.dataset.src;
    const buf = await fetch(src).then((r) => {
      if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
      return r.arrayBuffer();
    });
    const { width, height, indices, metadata } =
      window.PshiftPng.decode(new Uint8Array(buf));
    const eng = new window.HyperDrive.CycleEngine(canvas, { width, height, indices });
    const palettes = metadata.palettes;
    const mode = metadata.playMode || 'sequential';
    let curIdx = (typeof metadata.activeIdx === 'number'
                  && metadata.activeIdx >= 0
                  && metadata.activeIdx < palettes.length) ? metadata.activeIdx : 0;
    let pendingNext = -1;
    let target = palettes[curIdx].cycles || 1;

    function applyPalette(i) {
      const p = palettes[i];
      eng.setPalette(window.PshiftPng.buildRamp(p.stops));
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
            window.PshiftPng.buildRamp(palettes[next].stops),
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

  root.PshiftLoader = { mount, mountAll };
})(window);
