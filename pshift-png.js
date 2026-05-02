// pshift-png.js
// Encode / decode .pshift.png — a PNG that's both a normal RGBA preview
// AND carries the precomputed palette-cycle bake (indices buffer +
// editable anchors + palette stops + speed) in an iTXt chunk keyed
// 'pshift'.
//
// Usage:
//   const bytes = await PshiftPng.encode({ canvas, indices, ...meta });
//   // bytes is a Uint8Array; Blob it and download.
//
//   const decoded = PshiftPng.decode(uint8Array);
//   // → { width, height, indices, metadata }
//
//   const ramp = PshiftPng.buildRamp(metadata.stops);

(function (root) {

  // ─── CRC32 over PNG chunk type+data ───────────────────────────────────
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })();
  function crc32(bytes, off, len) {
    let c = 0xffffffff;
    for (let i = off; i < off + len; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function makeChunk(type, data) {
    const out = new Uint8Array(12 + data.length);
    const len = data.length;
    out[0] = (len >>> 24) & 0xff; out[1] = (len >>> 16) & 0xff;
    out[2] = (len >>>  8) & 0xff; out[3] =  len         & 0xff;
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    const c = crc32(out, 4, 4 + len);
    out[8 + len    ] = (c >>> 24) & 0xff; out[8 + len + 1] = (c >>> 16) & 0xff;
    out[8 + len + 2] = (c >>>  8) & 0xff; out[8 + len + 3] =  c         & 0xff;
    return out;
  }

  // ─── iTXt chunk body ──────────────────────────────────────────────────
  // PNG iTXt: keyword \0 compFlag compMethod langTag \0 transKey \0 text
  function makeIText(keyword, text) {
    const enc = new TextEncoder();
    const k = enc.encode(keyword);
    const t = enc.encode(text);
    const buf = new Uint8Array(k.length + 5 + t.length);
    let p = 0;
    buf.set(k, p); p += k.length;
    buf[p++] = 0;  // null after keyword
    buf[p++] = 0;  // compression flag = 0 (uncompressed)
    buf[p++] = 0;  // compression method
    buf[p++] = 0;  // empty language tag + null
    buf[p++] = 0;  // empty translated keyword + null
    buf.set(t, p);
    return buf;
  }

  // ─── Splice an iTXt chunk into a finished PNG, before IEND ────────────
  function injectIText(pngBytes, keyword, text) {
    if (pngBytes[0] !== 0x89 || pngBytes[1] !== 0x50) throw new Error('Not a PNG');
    const parts = [pngBytes.subarray(0, 8)];
    let pos = 8;
    while (pos < pngBytes.length) {
      const len = readU32(pngBytes, pos);
      const type = readType(pngBytes, pos + 4);
      const total = 12 + len;
      if (type === 'IEND') {
        parts.push(makeChunk('iTXt', makeIText(keyword, text)));
      }
      parts.push(pngBytes.subarray(pos, pos + total));
      pos += total;
    }
    return concat(parts);
  }

  function readU32(b, p) {
    return ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;
  }
  function readType(b, p) {
    return String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
  }
  function concat(parts) {
    let n = 0;
    for (const p of parts) n += p.length;
    const out = new Uint8Array(n);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
  }

  // ─── base64 ───────────────────────────────────────────────────────────
  function bytesToBase64(bytes) {
    let s = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(s);
  }
  function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // ─── ramp builder (shared with the editor) ────────────────────────────
  function buildRamp(stops) {
    const s = stops.slice().sort((a, b) => a.t - b.t);
    const out = new Array(255);
    for (let i = 0; i < 255; i++) {
      const t = i / 254;
      let a = s[0], b = s[s.length - 1];
      if (t <= s[0].t) a = b = s[0];
      else if (t >= s[s.length - 1].t) a = b = s[s.length - 1];
      else for (let k = 0; k < s.length - 1; k++)
        if (t >= s[k].t && t <= s[k + 1].t) { a = s[k]; b = s[k + 1]; break; }
      const span = b.t - a.t || 1, u = (t - a.t) / span;
      out[i] = [
        Math.round(a.color[0] + (b.color[0] - a.color[0]) * u),
        Math.round(a.color[1] + (b.color[1] - a.color[1]) * u),
        Math.round(a.color[2] + (b.color[2] - a.color[2]) * u),
      ];
    }
    return out;
  }

  // ─── public encode / decode ───────────────────────────────────────────
  // encode(opts) → Promise<Uint8Array>
  // opts: { canvas, indices, anchors,
  //         palettes, activeIdx, playMode, strokeWidth, scale, padding, half }
  async function encode(opts) {
    const { canvas, indices, anchors,
            palettes, activeIdx, playMode,
            strokeWidth, scale, padding, half } = opts;
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    if (!blob) throw new Error('canvas.toBlob returned null');
    const pngBytes = new Uint8Array(await blob.arrayBuffer());
    const meta = {
      version: 1,
      width: canvas.width,
      height: canvas.height,
      indices: bytesToBase64(indices),
      anchors,
      palettes,
      activeIdx,
      playMode,
      strokeWidth, scale, padding, half,
    };
    return injectIText(pngBytes, 'pshift', JSON.stringify(meta));
  }

  // decode(uint8) → { width, height, indices, metadata }
  function decode(pngBytes) {
    if (pngBytes[0] !== 0x89 || pngBytes[1] !== 0x50) throw new Error('Not a PNG');
    let pos = 8, meta = null;
    while (pos < pngBytes.length) {
      const len = readU32(pngBytes, pos);
      const type = readType(pngBytes, pos + 4);
      const dataStart = pos + 8;
      const dataEnd = dataStart + len;
      if (type === 'iTXt') {
        let p = dataStart;
        while (p < dataEnd && pngBytes[p] !== 0) p++;
        const keyword = new TextDecoder().decode(pngBytes.subarray(dataStart, p));
        if (keyword === 'pshift') {
          p++;                   // null after keyword
          const compFlag = pngBytes[p++];
          p++;                   // compression method
          while (p < dataEnd && pngBytes[p] !== 0) p++;  p++;  // skip lang tag
          while (p < dataEnd && pngBytes[p] !== 0) p++;  p++;  // skip trans keyword
          if (compFlag !== 0) throw new Error('Compressed iTXt not supported');
          const text = new TextDecoder().decode(pngBytes.subarray(p, dataEnd));
          meta = JSON.parse(text);
        }
      } else if (type === 'IEND') {
        break;
      }
      pos = dataEnd + 4;
    }
    if (!meta) throw new Error('No pshift metadata in PNG');
    const indices = base64ToBytes(meta.indices);
    if (indices.length !== meta.width * meta.height) {
      throw new Error('indices length does not match width × height');
    }
    return { width: meta.width, height: meta.height, indices, metadata: meta };
  }

  root.PshiftPng = { encode, decode, buildRamp };
})(window);
