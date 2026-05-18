// neonic-png.js
// Encode / decode .neonic.png — a PNG that's both a normal RGBA preview
// AND carries the editable anchors + palette stops + speed in an iTXt
// chunk keyed 'neonic'. The playback engine reconstructs the bake from
// the anchors at the consumer's display resolution, so no pre-rendered
// indices buffer ships in the file.
//
// Usage:
//   const bytes = await NeonicPng.encode({ canvas, anchors, ...meta });
//   // bytes is a Uint8Array; Blob it and download.
//
//   const decoded = NeonicPng.decode(uint8Array);
//   // → { width, height, metadata }
//
// Format versions accepted on decode:
//   v3 — current. metadata.paddingLogical stored directly in anchor space.
//   v2 — paddingLogical = padding / scale; loader recovers via that ratio.
//   v1 — also carried a precomputed indices field; ignored on read.
//   'pshift' keyword — legacy (pre-rename); decoded identically.
//
// To build a palette ramp from decoded stops, use Neonic.buildRamp(stops).

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
      if (pos + 8 > pngBytes.length) throw new Error('Truncated PNG: chunk header past EOF');
      const len = readU32(pngBytes, pos);
      const type = readType(pngBytes, pos + 4);
      const total = 12 + len;
      if (pos + total > pngBytes.length) throw new Error('Truncated PNG: chunk body past EOF');
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

  // ─── public encode / decode ───────────────────────────────────────────
  // encode(opts) → Promise<Uint8Array>
  // opts: { canvas, anchors, palettes,
  //         strokeWidth, thinning, scale, padding, half }
  // `thinning` records the slider value at export time so import can
  // restore it; without that, anchor widths drift on re-load because
  // the formula reapplies at whatever the slider happens to be.
  //
  // The metadata stores `paddingLogical` (in anchor-space units)
  // alongside the bake-pixel `padding` it was rendered with. The
  // loader prefers paddingLogical when present so re-bakes at
  // different scales keep the same visual margin proportion.
  async function encode(opts) {
    const { canvas, anchors, palettes,
            strokeWidth, thinning, scale, padding, half } = opts;
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    if (!blob) throw new Error('canvas.toBlob returned null');
    const pngBytes = new Uint8Array(await blob.arrayBuffer());
    const paddingLogical = (scale > 0 && padding != null)
      ? padding / scale
      : null;
    const meta = {
      version: 3,
      width: canvas.width,
      height: canvas.height,
      anchors,
      palettes,
      strokeWidth, thinning, scale, padding, paddingLogical, half,
    };
    return injectIText(pngBytes, 'neonic', JSON.stringify(meta));
  }

  // decode(uint8) → { width, height, metadata }
  // Returns the preview-image dimensions and the editable metadata.
  // The playback engine reconstructs the indices buffer from
  // metadata.anchors at whatever resolution the consumer asks for.
  // Pre-v2 PNGs that carried a precomputed `indices` field in their
  // metadata are still accepted — the field is just ignored.
  function decode(pngBytes) {
    if (pngBytes[0] !== 0x89 || pngBytes[1] !== 0x50) throw new Error('Not a PNG');
    let pos = 8, meta = null;
    while (pos < pngBytes.length) {
      if (pos + 8 > pngBytes.length) throw new Error('Truncated PNG: chunk header past EOF');
      const len = readU32(pngBytes, pos);
      const type = readType(pngBytes, pos + 4);
      const dataStart = pos + 8;
      const dataEnd = dataStart + len;
      if (dataEnd > pngBytes.length) throw new Error('Truncated PNG: chunk body past EOF');
      if (type === 'iTXt') {
        let p = dataStart;
        while (p < dataEnd && pngBytes[p] !== 0) p++;
        const keyword = new TextDecoder().decode(pngBytes.subarray(dataStart, p));
        if (keyword === 'neonic' || keyword === 'pshift') {
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
    if (!meta) throw new Error('No neonic metadata in PNG');
    if (meta.indices != null) delete meta.indices;
    // Validate anchor shape before handing back. The loader and editor
    // both check anchors.length, but a corrupt PNG could pass that and
    // still ship anchors with missing/non-numeric fields that bake to
    // NaN coordinates and an empty mask. Fail loudly here instead.
    if (Array.isArray(meta.anchors)) {
      const REQ = ['x', 'y', 'h1x', 'h1y', 'h2x', 'h2y'];
      for (let i = 0; i < meta.anchors.length; i++) {
        const a = meta.anchors[i];
        if (!a || typeof a !== 'object') {
          throw new Error('Anchor ' + i + ' is not an object');
        }
        for (const k of REQ) {
          if (typeof a[k] !== 'number' || !isFinite(a[k])) {
            throw new Error('Anchor ' + i + ' missing or non-finite ' + k);
          }
        }
      }
    }
    return { width: meta.width, height: meta.height, metadata: meta };
  }

  root.NeonicPng = { encode, decode };
})(window);
