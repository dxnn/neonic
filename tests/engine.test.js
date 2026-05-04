'use strict';
// Run: node --test tests/engine.test.js
// Tests pure helpers and CycleEngine palette logic without a real browser.
// Canvas-dependent code (bakeFromD, bakeFromStroke) requires browser smoke-testing.

const { test } = require('node:test');
const assert = require('node:assert/strict');
// For cross-realm arrays (created inside vm context), deepStrictEqual fails
// the prototype check. Use this wrapper to compare element values instead.
function eqArr(actual, expected) {
  assert.equal(actual.length, expected.length, 'array length mismatch');
  for (let i = 0; i < expected.length; i++)
    assert.equal(actual[i], expected[i], `element [${i}]: ${actual[i]} !== ${expected[i]}`);
}
const vm = require('vm');
const fs = require('fs');

// ── minimal DOM mock ──────────────────────────────────────────────────────────
// Only what CycleEngine's constructor touches; bake functions aren't exercised.
function makeImageData(w, h) {
  const data = new Uint8Array(w * h * 4);
  return { data };
}
const mockDocument = {
  body: { appendChild: () => {}, removeChild: () => {} },
  createElement: () => ({ getContext: () => ({}) }),
  createElementNS: () => ({
    setAttribute: () => {},
    appendChild: () => {},
    getBBox: () => ({ x: 0, y: 0, width: 100, height: 100 }),
    getTotalLength: () => 100,
    getPointAtLength: (l) => ({ x: l, y: 0 }),
    style: {},
  }),
};
function mockCanvas(w, h) {
  const data = new Uint8Array(w * h * 4);
  return {
    width: 0, height: 0,
    getContext: () => ({
      createImageData: (cw, ch) => makeImageData(cw, ch),
      putImageData: () => {},
    }),
  };
}
function mockBaked(w, h) {
  const indices = new Uint8Array(w * h);
  // Fill with a spread of palette indices so _blit exercises the copy.
  for (let i = 0; i < indices.length; i++) indices[i] = (i % 254) + 1;
  return { width: w, height: h, indices };
}

// ── load the module ───────────────────────────────────────────────────────────
const src = fs.readFileSync(require('path').resolve(__dirname, '../logo-engine-standalone.js'), 'utf8');
const ctx = vm.createContext({ window: {}, document: mockDocument });
vm.runInContext(src, ctx);
const { HyperDrive } = ctx.window;
const { CycleEngine, PALETTES, _test: { rgba, hex, buildRamp } } = HyperDrive;

// ── rgba ──────────────────────────────────────────────────────────────────────
test('rgba packs channels in ABGR order for little-endian Uint32Array', () => {
  // In a Uint32Array backed by Uint8Array [R, G, B, A], the Uint32 on a
  // little-endian machine is (A<<24)|(B<<16)|(G<<8)|R.
  const v = rgba(0xff, 0x80, 0x40, 0xff);
  assert.equal(v >>> 0, 0xff4080ff >>> 0);
});

test('rgba clamps channels to 8 bits', () => {
  const full = rgba(0x1ff, 0x1ff, 0x1ff, 0x1ff);
  assert.equal(full >>> 0, 0xffffffff >>> 0);
});

test('rgba alpha=0 produces zero top byte', () => {
  assert.equal((rgba(255, 255, 255, 0) >>> 24) & 0xff, 0);
  assert.equal(rgba(0, 0, 0, 0), 0);
});

// ── hex ───────────────────────────────────────────────────────────────────────
test('hex decodes a 6-digit CSS colour', () => {
  eqArr(hex('#ff8040'), [0xff, 0x80, 0x40]);
});

test('hex decodes black and white', () => {
  eqArr(hex('#000000'), [0, 0, 0]);
  eqArr(hex('#ffffff'), [255, 255, 255]);
});

// ── buildRamp ─────────────────────────────────────────────────────────────────
test('buildRamp returns 255 entries', () => {
  const ramp = buildRamp([{ t: 0, c: [0, 0, 0] }, { t: 1, c: [255, 255, 255] }]);
  assert.equal(ramp.length, 255);
});

test('buildRamp first entry matches start stop', () => {
  const ramp = buildRamp([{ t: 0, c: [10, 20, 30] }, { t: 1, c: [200, 210, 220] }]);
  eqArr(ramp[0], [10, 20, 30]);
});

test('buildRamp last entry matches end stop', () => {
  const ramp = buildRamp([{ t: 0, c: [0, 0, 0] }, { t: 1, c: [255, 128, 64] }]);
  eqArr(ramp[254], [255, 128, 64]);
});

test('buildRamp midpoint interpolates linearly', () => {
  const ramp = buildRamp([{ t: 0, c: [0, 0, 0] }, { t: 1, c: [254, 254, 254] }]);
  // t=127/254 ≈ 0.5 → rgb ≈ [127, 127, 127]
  const [r, g, b] = ramp[127];
  assert.ok(Math.abs(r - 127) <= 1, `r=${r} not near 127`);
  assert.ok(Math.abs(g - 127) <= 1, `g=${g} not near 127`);
  assert.ok(Math.abs(b - 127) <= 1, `b=${b} not near 127`);
});

test('buildRamp sorts stops by t', () => {
  const ramp = buildRamp([{ t: 1, c: [255, 0, 0] }, { t: 0, c: [0, 0, 255] }]);
  // first entry should be the t=0 stop colour
  eqArr(ramp[0], [0, 0, 255]);
});

// ── PALETTES ─────────────────────────────────────────────────────────────────
test('built-in palette constructors return 255-entry arrays', () => {
  for (const name of Object.keys(PALETTES)) {
    const p = PALETTES[name]();
    assert.equal(p.length, 255, `${name} palette has wrong length`);
    assert.ok(Array.isArray(p[0]), `${name}[0] is not an array`);
    assert.equal(p[0].length, 3, `${name}[0] does not have 3 channels`);
  }
});

// ── CycleEngine: _writePalette and _blit ──────────────────────────────────────
function makeEngine(w = 4, h = 4) {
  return new CycleEngine(mockCanvas(w, h), mockBaked(w, h));
}

test('engine palette starts as zeroes before setPalette', () => {
  const eng = makeEngine();
  // palette[0] = transparent, palette[1..255] = 0 until first write
  assert.equal(eng.palette[128], 0);
});

test('setPalette writes non-zero colours into palette', () => {
  const eng = makeEngine();
  eng.setPalette('greyscale');
  // After setPalette the palette array should have non-zero values in 1..255.
  const nonzero = Array.from(eng.palette.slice(1)).some(v => v !== 0);
  assert.ok(nonzero, 'palette stayed all-zeroes after setPalette');
});

test('_blit skips work when palette unchanged (_prevPal matches)', () => {
  const eng = makeEngine();
  eng.setPalette('rainbow');
  // First blit: _prevPal is all-zero, palette is non-zero → blit runs.
  let blitCount = 0;
  const origPutImageData = eng.ctx.putImageData;
  eng.ctx.putImageData = (...args) => { blitCount++; origPutImageData(...args); };
  eng.render(); // should blit (palette != prevPal)
  assert.equal(blitCount, 1, 'first render should blit');
  eng.render(); // palette unchanged → should skip
  assert.equal(blitCount, 1, 'second render without palette change should not blit');
});

test('_blit runs again after palette changes', () => {
  const eng = makeEngine();
  eng.setPalette('greyscale');
  let blitCount = 0;
  eng.ctx.putImageData = () => { blitCount++; };
  eng.render();
  assert.equal(blitCount, 1);
  eng.setPalette('rainbow'); // changes palette
  eng.render();
  assert.equal(blitCount, 2, 'should blit after palette switch');
});

test('_blit runs again after replacePalette', () => {
  const eng = makeEngine();
  eng.setPalette('sodium');
  let blitCount = 0;
  eng.ctx.putImageData = () => { blitCount++; };
  eng.render();
  assert.equal(blitCount, 1);
  eng.replacePalette('cyan');
  eng.render();
  assert.equal(blitCount, 2);
});

test('_prevPal is updated after each blit', () => {
  const eng = makeEngine();
  eng.setPalette('plasma');
  eng.render();
  // After render, _prevPal should match palette.
  for (let i = 0; i < 256; i++) {
    assert.equal(eng._prevPal[i], eng.palette[i], `mismatch at index ${i}`);
  }
});

test('_writePalette produces same output regardless of offset wrap-around', () => {
  // Offset values that differ by exactly 255 should produce identical palettes.
  const eng1 = makeEngine();
  const eng2 = makeEngine();
  eng1.setPalette('sodium'); eng1.offset = 1000;
  eng2.setPalette('sodium'); eng2.offset = 1000 + 255;
  eng1._writePalette(); eng2._writePalette();
  for (let i = 1; i < 256; i++) {
    assert.equal(eng1.palette[i], eng2.palette[i], `palette differs at index ${i}`);
  }
});

test('palette index 0 is always transparent', () => {
  const eng = makeEngine();
  eng.setPalette('rainbow');
  assert.equal(eng.palette[0], 0);
  eng.offset = 12345; eng._writePalette();
  assert.equal(eng.palette[0], 0);
});
