// logo-engine-standalone.js
// Self-contained palette-cycling engine. No deps, no JSX.
// Usage:
//   const baked = HyperDrive.bakeFromD({ d, scale, strokeWidth, half, padding });
//   const eng = new HyperDrive.CycleEngine(canvasEl, baked);
//   eng.setPalette('rainbow'); eng.setSpeed(60); eng.start();

(function (root) {
  // ─── helpers ────────────────────────────────────────────────────────────
  function rgba(r, g, b, a) {
    return ((a & 0xff) << 24) | ((b & 0xff) << 16) | ((g & 0xff) << 8) | (r & 0xff);
  }
  function hex(h) { const n = parseInt(h.slice(1), 16); return [(n>>16)&255,(n>>8)&255,n&255]; }
  function buildRamp(stops) {
    const out = new Array(255);
    stops = stops.slice().sort((a,b)=>a.t-b.t);
    for (let i = 0; i < 255; i++) {
      const t = i / 254;
      let a = stops[0], b = stops[stops.length-1];
      for (let k = 0; k < stops.length-1; k++) {
        if (t >= stops[k].t && t <= stops[k+1].t) { a = stops[k]; b = stops[k+1]; break; }
      }
      const span = b.t - a.t || 1, u = (t - a.t) / span;
      out[i] = [
        Math.round(a.c[0] + (b.c[0]-a.c[0])*u),
        Math.round(a.c[1] + (b.c[1]-a.c[1])*u),
        Math.round(a.c[2] + (b.c[2]-a.c[2])*u),
      ];
    }
    return out;
  }

  const PALETTES = {
    greyscale: () => buildRamp([{t:0,c:hex('#0a0a0b')},{t:1,c:hex('#f5f3ec')}]),
    sodium:    () => buildRamp([{t:0,c:hex('#1a0a02')},{t:.45,c:hex('#a5410a')},{t:.78,c:hex('#ffb24a')},{t:1,c:hex('#fff7d6')}]),
    cyan:      () => buildRamp([{t:0,c:hex('#03070d')},{t:.40,c:hex('#0a4a72')},{t:.72,c:hex('#3fb6e6')},{t:1,c:hex('#eaf6ff')}]),
    plasma:    () => buildRamp([{t:0,c:hex('#0d0420')},{t:.30,c:hex('#5a0c6e')},{t:.55,c:hex('#c2317a')},{t:.78,c:hex('#f08a3a')},{t:1,c:hex('#fff2cf')}]),
    rainbow:   () => buildRamp([
      {t:0.00,c:hex('#ff2a2a')},{t:0.17,c:hex('#ff8a14')},{t:0.33,c:hex('#ffe600')},
      {t:0.50,c:hex('#2dd24a')},{t:0.66,c:hex('#1f7bff')},{t:0.83,c:hex('#7b2dff')},
      {t:1.00,c:hex('#ff2a2a')},
    ]),
    rainbowCompressed: () => {
      const blue = hex('#1f7bff');
      return buildRamp([
        {t:0.000,c:blue},{t:0.449,c:blue},
        {t:0.450,c:hex('#ff2a2a')},{t:0.467,c:hex('#ff8a14')},{t:0.484,c:hex('#ffe600')},
        {t:0.500,c:hex('#2dd24a')},{t:0.517,c:hex('#1f7bff')},{t:0.534,c:hex('#7b2dff')},
        {t:0.550,c:blue},{t:1.000,c:blue},
      ]);
    },
  };

  // ─── bake ───────────────────────────────────────────────────────────────
  function bakeFromD(opts) {
    const { d, scale = 1.6, padding = 24, strokeWidth = 18, half = 'first' } = opts || {};
    const ns = 'http://www.w3.org/2000/svg';
    const tmp = document.createElementNS(ns, 'svg');
    tmp.style.cssText = 'position:absolute;left:-99999px';
    document.body.appendChild(tmp);
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    tmp.appendChild(p);
    const bbox = p.getBBox();
    const totalLen = p.getTotalLength();
    if (totalLen < 1) { document.body.removeChild(tmp); throw new Error('Path has no length.'); }

    const w = Math.ceil(bbox.width  * scale + padding * 2);
    const h = Math.ceil(bbox.height * scale + padding * 2);
    const tx = padding - bbox.x * scale;
    const ty = padding - bbox.y * scale;

    let lenStart, lenSpan;
    if (half === 'second') { lenStart = totalLen/2; lenSpan = totalLen/2; }
    else if (half === 'full') { lenStart = 0; lenSpan = totalLen; }
    else { lenStart = 0; lenSpan = totalLen/2; }

    const STROKE_W = strokeWidth * scale;
    const N_SEG = 254;
    const SUBSEG = Math.max(1, Math.ceil(lenSpan * scale / 800));
    const TOTAL = N_SEG * SUBSEG;

    const pts = new Array(TOTAL + 1);
    for (let i = 0; i <= TOTAL; i++) {
      const pt = p.getPointAtLength(lenStart + (i / TOTAL) * lenSpan);
      pts[i] = { x: pt.x * scale + tx, y: pt.y * scale + ty };
    }

    // index canvas
    const idxC = document.createElement('canvas'); idxC.width = w; idxC.height = h;
    const ictx = idxC.getContext('2d', { willReadFrequently: true });
    ictx.lineWidth = STROKE_W; ictx.lineCap = 'round'; ictx.lineJoin = 'round';
    for (let i = 0; i < N_SEG; i++) {
      const v = i + 1;
      ictx.strokeStyle = 'rgb(' + v + ',0,0)';
      ictx.beginPath();
      const base = i * SUBSEG;
      ictx.moveTo(pts[base].x, pts[base].y);
      for (let j = 1; j <= SUBSEG; j++) ictx.lineTo(pts[base+j].x, pts[base+j].y);
      ictx.stroke();
    }
    const idxData = ictx.getImageData(0, 0, w, h).data;

    // alpha mask
    const mskC = document.createElement('canvas'); mskC.width = w; mskC.height = h;
    const mctx = mskC.getContext('2d', { willReadFrequently: true });
    mctx.lineWidth = STROKE_W * 0.92; mctx.lineCap = 'round'; mctx.lineJoin = 'round';
    mctx.strokeStyle = '#fff';
    mctx.beginPath();
    mctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i <= TOTAL; i++) mctx.lineTo(pts[i].x, pts[i].y);
    mctx.stroke();
    const mskData = mctx.getImageData(0, 0, w, h).data;

    const indices = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      if (mskData[i*4+3] < 200) { indices[i] = 0; continue; }
      let v = idxData[i*4]; if (v < 1) v = 1; if (v > 254) v = 254;
      indices[i] = v;
    }
    // sparkle cull
    {
      const src = new Uint8Array(indices);
      for (let y = 1; y < h-1; y++) for (let x = 1; x < w-1; x++) {
        const i = y*w+x; if (src[i] === 0) continue;
        let z = 0;
        for (let dy=-1; dy<=1; dy++) for (let dx=-1; dx<=1; dx++) {
          if (dx===0&&dy===0) continue;
          if (src[(y+dy)*w+(x+dx)] === 0) z++;
        }
        if (z >= 5) indices[i] = 0;
      }
    }

    document.body.removeChild(tmp);
    return { width: w, height: h, indices };
  }

  // ─── bake from a width-bearing stroke ───────────────────────────────────
  // stroke: array of { x, y, width } in path-local coords. width is the
  // absolute pixel diameter at that sample point. Disc-stamps each
  // sample with radius = width * scale / 2, so the bake matches what
  // panel 1 paints from the same samples. Otherwise mirrors bakeFromD's
  // mask + index pipeline.
  function bakeFromStroke(opts) {
    const { stroke, scale = 1.6, padding = 24, half = 'first' } = opts || {};
    if (!stroke || stroke.length < 2) throw new Error('Stroke has fewer than 2 points.');

    const cumLen = new Array(stroke.length);
    cumLen[0] = 0;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < stroke.length; i++) {
      const p = stroke[i];
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      if (i > 0) {
        const dx = p.x - stroke[i - 1].x, dy = p.y - stroke[i - 1].y;
        cumLen[i] = cumLen[i - 1] + Math.sqrt(dx * dx + dy * dy);
      }
    }
    const totalLen = cumLen[cumLen.length - 1];
    if (totalLen < 1) throw new Error('Stroke has no length.');

    const w = Math.ceil((maxX - minX) * scale + padding * 2);
    const h = Math.ceil((maxY - minY) * scale + padding * 2);
    const tx = padding - minX * scale;
    const ty = padding - minY * scale;

    let lenStart, lenSpan;
    if (half === 'second') { lenStart = totalLen / 2; lenSpan = totalLen / 2; }
    else if (half === 'full') { lenStart = 0; lenSpan = totalLen; }
    else { lenStart = 0; lenSpan = totalLen / 2; }

    const N_SEG = 254;
    const SUBSEG = Math.max(1, Math.ceil(lenSpan * scale / 800));
    const TOTAL = N_SEG * SUBSEG;

    function sampleAtLength(L) {
      let lo = 0, hi = cumLen.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (cumLen[mid] <= L) lo = mid; else hi = mid;
      }
      const u = (L - cumLen[lo]) / (cumLen[hi] - cumLen[lo] || 1);
      const a = stroke[lo], b = stroke[hi];
      const wa = a.width == null ? 22 : a.width;
      const wb = b.width == null ? 22 : b.width;
      return {
        x: a.x + (b.x - a.x) * u,
        y: a.y + (b.y - a.y) * u,
        width: wa + (wb - wa) * u,
      };
    }

    const pts = new Array(TOTAL + 1);
    for (let i = 0; i <= TOTAL; i++) {
      const s = sampleAtLength(lenStart + (i / TOTAL) * lenSpan);
      pts[i] = { x: s.x * scale + tx, y: s.y * scale + ty, width: s.width * scale };
    }

    // Anchors carry absolute pixel widths; we stamp discs at every
    // sample point with radius = local width / 2. Adjacent same-coloured
    // discs overlap smoothly; later (higher-index) discs paint over
    // earlier ones at segment boundaries, which is the desired ordering.
    // (Round-capped strokes would let a thicker neighbour's cap engulf
    // a thinner segment, so we use discs instead.)

    const idxC = document.createElement('canvas'); idxC.width = w; idxC.height = h;
    const ictx = idxC.getContext('2d', { willReadFrequently: true });
    for (let i = 0; i < N_SEG; i++) {
      const v = i + 1;
      ictx.fillStyle = 'rgb(' + v + ',0,0)';
      const base = i * SUBSEG;
      for (let j = 0; j < SUBSEG; j++) {
        const p = pts[base + j];
        const r = Math.max(0.5, p.width / 2);
        ictx.beginPath();
        ictx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ictx.fill();
      }
    }
    // Stamp the very last point with the highest index so the tail
    // doesn't fade out before the rest of the cycling band.
    {
      const last = pts[TOTAL];
      ictx.fillStyle = 'rgb(254,0,0)';
      const r = Math.max(0.5, last.width / 2);
      ictx.beginPath();
      ictx.arc(last.x, last.y, r, 0, Math.PI * 2);
      ictx.fill();
    }
    const idxData = ictx.getImageData(0, 0, w, h).data;

    const mskC = document.createElement('canvas'); mskC.width = w; mskC.height = h;
    const mctx = mskC.getContext('2d', { willReadFrequently: true });
    mctx.fillStyle = '#fff';
    for (let i = 0; i <= TOTAL; i++) {
      const p = pts[i];
      const r = Math.max(0.5, p.width / 2 * 0.92);
      mctx.beginPath();
      mctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      mctx.fill();
    }
    const mskData = mctx.getImageData(0, 0, w, h).data;

    const indices = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      if (mskData[i * 4 + 3] < 200) { indices[i] = 0; continue; }
      let v = idxData[i * 4]; if (v < 1) v = 1; if (v > 254) v = 254;
      indices[i] = v;
    }
    {
      const src = new Uint8Array(indices);
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const i = y * w + x; if (src[i] === 0) continue;
        let z = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (src[(y + dy) * w + (x + dx)] === 0) z++;
        }
        if (z >= 5) indices[i] = 0;
      }
    }

    return { width: w, height: h, indices };
  }

  // ─── runtime ────────────────────────────────────────────────────────────
  // Forward-feed model: every palette is "fed in" at palette[1], with a
  // specific color flowing outward to palette[2], [3], ... over time.
  //
  //   palette[i+1] at offset `off` reads
  //     basePalette[(off - i - baseStartOff) mod 255]
  //
  // Transitioning to a new palette: schedule it at `nextStartOff`. Tape
  // position s = off - i; if s ≥ nextStartOff that palette index has been
  // "swept" and reads from nextPalette[(s - nextStartOff) mod 255] instead.
  // After 254 off-ticks the new palette has fully spread and we promote.
  function CycleEngine(canvas, baked) {
    this.canvas = canvas; this.baked = baked;
    canvas.width = baked.width; canvas.height = baked.height;
    this.ctx = canvas.getContext('2d');
    this.image = this.ctx.createImageData(baked.width, baked.height);
    this.data32 = new Uint32Array(this.image.data.buffer);
    this.palette = new Uint32Array(256); this.palette[0] = 0;
    this.basePalette = PALETTES.greyscale();
    this.baseStartOff = 0;
    this.nextPalette = null;
    this.nextStartOff = -1;
    this.offset = 0; this.speed = 40; this.reverse = false;
    this.running = false; this._raf = 0; this._last = 0;
  }
  CycleEngine.prototype.setPalette = function (n) {
    this.basePalette = typeof n === 'string' ? PALETTES[n]() : n;
    this.baseStartOff = this.offset;
    this.nextPalette = null;
    this.nextStartOff = -1;
    this._writePalette();
  };
  // Live-edit a palette without resetting the cycle position. Used by the
  // editor's stop-edits — the user wants their tweaks to appear without
  // jumping the cycle back to phase 0.
  CycleEngine.prototype.replacePalette = function (n) {
    this.basePalette = typeof n === 'string' ? PALETTES[n]() : n;
    this._writePalette();
  };
  // Schedule a feed-in of `n` starting at `scheduledOff` (defaults to now).
  // The watcher snaps scheduledOff to a cycle boundary so palette[1] reads
  // n[0] exactly at scheduledOff.
  CycleEngine.prototype.transitionTo = function (n, scheduledOff) {
    this.nextPalette = typeof n === 'string' ? PALETTES[n]() : n;
    this.nextStartOff = (scheduledOff != null) ? scheduledOff : this.offset;
    this._writePalette();
  };
  CycleEngine.prototype.setSpeed = function (s) { this.speed = s; };
  CycleEngine.prototype.setReverse = function (r) { this.reverse = !!r; };
  CycleEngine.prototype._writePalette = function () {
    if (this.nextPalette !== null && (this.offset - this.nextStartOff) >= 254) {
      this.basePalette = this.nextPalette;
      this.baseStartOff = this.nextStartOff;
      this.nextPalette = null;
      this.nextStartOff = -1;
    }
    const a = this.basePalette, b = this.nextPalette;
    const aOff = this.baseStartOff, bOff = this.nextStartOff;
    const off = this.offset;
    const pal = this.palette;
    for (let i = 0; i < 255; i++) {
      const s = off - i;
      let pos, p;
      if (b !== null && s >= bOff) {
        pos = ((s - bOff) % 255 + 255) % 255;
        p = b;
      } else {
        pos = ((s - aOff) % 255 + 255) % 255;
        p = a;
      }
      const k0 = Math.floor(pos), k1 = (k0 + 1) % 255, f = pos - k0;
      const c0 = p[k0], c1 = p[k1];
      const r = c0[0] + (c1[0] - c0[0]) * f;
      const g = c0[1] + (c1[1] - c0[1]) * f;
      const bl = c0[2] + (c1[2] - c0[2]) * f;
      pal[i+1] = rgba(r|0, g|0, bl|0, 255);
    }
    pal[0] = 0;
  };
  CycleEngine.prototype._frame = function (now) {
    if (!this.running) return;
    let dt = this._last ? (now - this._last) / 1000 : 0;
    // Tab was hidden / paused: don't catch up — just skip ahead and resume.
    if (dt > 0.1) dt = 0;
    this._last = now;
    this.offset += this.speed * dt;
    this._writePalette();
    const data32 = this.data32, idx = this.baked.indices, pal = this.palette, n = idx.length;
    for (let i = 0; i < n; i++) data32[i] = pal[idx[i]];
    this.ctx.putImageData(this.image, 0, 0);
    this._raf = requestAnimationFrame(this._frame.bind(this));
  };
  CycleEngine.prototype.start = function () {
    if (this.running) return;
    this.running = true; this._last = 0;
    this._raf = requestAnimationFrame(this._frame.bind(this));
  };
  CycleEngine.prototype.stop = function () {
    this.running = false; if (this._raf) cancelAnimationFrame(this._raf); this._raf = 0;
  };
  CycleEngine.prototype.render = function () {
    this._writePalette();
    const data32 = this.data32, idx = this.baked.indices, pal = this.palette, n = idx.length;
    for (let i = 0; i < n; i++) data32[i] = pal[idx[i]];
    this.ctx.putImageData(this.image, 0, 0);
  };

  root.HyperDrive = { bakeFromD, bakeFromStroke, CycleEngine, PALETTES };
})(window);
