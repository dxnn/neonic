'use strict';
// Run: node --test tests/engine.test.js
// Tests pure helpers and CycleEngine palette logic without a real browser.
// Canvas-dependent code (bakeFromD, bakeFromStroke) requires browser smoke-testing.

const { test } = require('node:test');
const assert = require('node:assert/strict');
// hex() returns a JS array from inside the vm context; deepStrictEqual fails
// the cross-realm prototype check, so compare element values directly.
function eqArr(actual, expected) {
  assert.equal(actual.length, expected.length, 'array length mismatch');
  for (let i = 0; i < expected.length; i++)
    assert.equal(actual[i], expected[i], `element [${i}]: ${actual[i]} !== ${expected[i]}`);
}
const vm = require('vm');
const fs = require('fs');

// ── minimal DOM mock ──────────────────────────────────────────────────────────
const mockDocument = {
  body: { appendChild: () => {}, removeChild: () => {} },
  createElement: () => ({ getContext: () => ({}) }),
  createElementNS: () => ({
    setAttribute: () => {}, appendChild: () => {},
    getBBox: () => ({ x: 0, y: 0, width: 100, height: 100 }),
    getTotalLength: () => 100, getPointAtLength: (l) => ({ x: l, y: 0 }),
    style: {},
  }),
};
function mockCanvas() {
  return {
    width: 0, height: 0,
    getContext: () => ({
      createImageData: (w, h) => { const d = new Uint8Array(w * h * 4); return { data: d }; },
      putImageData: () => {},
    }),
  };
}
function mockBaked(w = 4, h = 4) {
  const indices = new Uint8Array(w * h);
  for (let i = 0; i < indices.length; i++) indices[i] = (i % 254) + 1;
  return { width: w, height: h, indices };
}

// ── load the module ───────────────────────────────────────────────────────────
const src = fs.readFileSync(require('path').resolve(__dirname, '../logo-engine-standalone.js'), 'utf8');
const ctx = vm.createContext({
  window: {},
  document: mockDocument,
  requestAnimationFrame: () => {},
});
vm.runInContext(src, ctx);
const { Neonic } = ctx.window;
const { CycleEngine, PALETTES, buildRamp, _test: { rgba, hex } } = Neonic;

function makeEngine() { return new CycleEngine(mockCanvas(), mockBaked()); }

// ── rgba ──────────────────────────────────────────────────────────────────────
test('rgba packs channels in ABGR order for little-endian Uint32Array', () => {
  const v = rgba(0xff, 0x80, 0x40, 0xff);
  assert.equal(v >>> 0, 0xff4080ff >>> 0);
});

test('rgba clamps channels to 8 bits', () => {
  assert.equal(rgba(0x1ff, 0x1ff, 0x1ff, 0x1ff) >>> 0, 0xffffffff >>> 0);
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
test('buildRamp returns Uint8Array of length 255*3', () => {
  const ramp = buildRamp([{ t: 0, color: [0, 0, 0] }, { t: 1, color: [255, 255, 255] }]);
  assert.ok(Object.prototype.toString.call(ramp) === '[object Uint8Array]', 'not a Uint8Array');
  assert.equal(ramp.length, 255 * 3);
});

test('buildRamp first entry matches start stop', () => {
  const ramp = buildRamp([{ t: 0, color: [10, 20, 30] }, { t: 1, color: [200, 210, 220] }]);
  assert.equal(ramp[0], 10);
  assert.equal(ramp[1], 20);
  assert.equal(ramp[2], 30);
});

test('buildRamp last entry matches end stop', () => {
  const ramp = buildRamp([{ t: 0, color: [0, 0, 0] }, { t: 1, color: [255, 128, 64] }]);
  assert.equal(ramp[254 * 3],     255);
  assert.equal(ramp[254 * 3 + 1], 128);
  assert.equal(ramp[254 * 3 + 2],  64);
});

test('buildRamp midpoint interpolates linearly', () => {
  const ramp = buildRamp([{ t: 0, color: [0, 0, 0] }, { t: 1, color: [254, 254, 254] }]);
  // t=127/254 ≈ 0.5 → rgb ≈ [127, 127, 127]
  assert.ok(Math.abs(ramp[127 * 3]     - 127) <= 1, `r=${ramp[127*3]} not near 127`);
  assert.ok(Math.abs(ramp[127 * 3 + 1] - 127) <= 1, `g=${ramp[127*3+1]} not near 127`);
  assert.ok(Math.abs(ramp[127 * 3 + 2] - 127) <= 1, `b=${ramp[127*3+2]} not near 127`);
});

test('buildRamp sorts stops by t', () => {
  const ramp = buildRamp([{ t: 1, color: [255, 0, 0] }, { t: 0, color: [0, 0, 255] }]);
  assert.equal(ramp[0], 0);
  assert.equal(ramp[1], 0);
  assert.equal(ramp[2], 255);
});

test('buildRamp accepts {t, color} stop format', () => {
  // Verify the public API shape — no {t, c} here.
  const ramp = buildRamp([{ t: 0, color: [100, 150, 200] }, { t: 1, color: [100, 150, 200] }]);
  assert.equal(ramp[0],   100);
  assert.equal(ramp[1],   150);
  assert.equal(ramp[2],   200);
});

// ── PALETTES ─────────────────────────────────────────────────────────────────
test('built-in PALETTES return Uint8Array(255*3)', () => {
  for (const name of Object.keys(PALETTES)) {
    const p = PALETTES[name]();
    assert.ok(Object.prototype.toString.call(p) === '[object Uint8Array]', `${name} is not a Uint8Array`);
    assert.equal(p.length, 255 * 3, `${name} has wrong length`);
    // Spot-check: values are in 0..255 range
    assert.ok(p[0] >= 0 && p[0] <= 255, `${name}[0] out of range`);
  }
});

// ── CycleEngine ───────────────────────────────────────────────────────────────
test('engine palette starts as zeroes before any render', () => {
  const eng = makeEngine();
  assert.equal(eng.palette[128], 0);
});

test('setPalette marks _palDirty without immediately painting', () => {
  const eng = makeEngine();
  let painted = 0;
  eng.ctx.putImageData = () => { painted++; };
  eng.setPalette('greyscale');
  assert.equal(painted, 0, 'setPalette should not paint directly');
  assert.equal(eng._palDirty, true);
});

test('render() always paints regardless of state', () => {
  const eng = makeEngine();
  let painted = 0;
  eng.ctx.putImageData = () => { painted++; };
  eng.setPalette('rainbow');
  eng.render();
  assert.equal(painted, 1, 'first render should paint');
  eng.render();
  assert.equal(painted, 2, 'render() is unconditional — always paints');
});

test('render() clears _palDirty and writes _renderOff', () => {
  const eng = makeEngine();
  eng.setPalette('sodium');
  assert.equal(eng._palDirty, true);
  eng.render();
  assert.equal(eng._palDirty, false);
  assert.equal(eng._renderOff, eng.offset);
});

test('_frame skips paint when floor(offset) is unchanged', () => {
  const eng = makeEngine();
  eng.setPalette('rainbow');
  eng.render();               // prime state
  eng.speed = 0;              // freeze automatic advancement
  eng.running = true;
  let painted = 0;
  eng.ctx.putImageData = () => { painted++; };

  // Set _renderOff and offset to the same integer floor.
  eng._renderOff = 5.3;
  eng.offset = 5.7;           // same floor (5) as _renderOff
  eng._last = 1000;
  eng._frame(1000);           // dt=0 → offset stays 5.7
  assert.equal(painted, 0, 'should skip when floor unchanged');
});

test('_frame paints when floor(offset) crosses an integer', () => {
  const eng = makeEngine();
  eng.setPalette('cyan');
  eng.render();
  eng.speed = 0;
  eng.running = true;
  let painted = 0;
  eng.ctx.putImageData = () => { painted++; };

  eng._renderOff = 5.3;
  eng.offset = 6.1;           // floor(6.1)=6 ≠ floor(5.3)=5
  eng._last = 1000;
  eng._frame(1000);
  assert.equal(painted, 1, 'should paint when floor changes');
  assert.equal(eng._palDirty, false);
});

test('_frame paints when _palDirty regardless of floor', () => {
  const eng = makeEngine();
  eng.render();
  eng.speed = 0;
  eng.running = true;
  let painted = 0;
  eng.ctx.putImageData = () => { painted++; };

  eng._renderOff = 5.3;
  eng.offset = 5.7;           // same floor — would normally skip
  eng._palDirty = true;       // explicit palette change
  eng._last = 1000;
  eng._frame(1000);
  assert.equal(painted, 1, 'should paint when _palDirty');
});

test('_writePalette produces same output for offsets differing by 255', () => {
  const eng1 = makeEngine();
  const eng2 = makeEngine();
  eng1.setPalette('sodium'); eng1.offset = 1000; eng1._writePalette();
  eng2.setPalette('sodium'); eng2.offset = 1000 + 255; eng2._writePalette();
  for (let i = 1; i < 256; i++) {
    assert.equal(eng1.palette[i], eng2.palette[i], `palette differs at index ${i}`);
  }
});

test('palette index 0 is always transparent', () => {
  const eng = makeEngine();
  eng.setPalette('rainbow');
  eng.render();
  assert.equal(eng.palette[0], 0);
  eng.offset = 12345; eng._writePalette();
  assert.equal(eng.palette[0], 0);
});

test('replacePalette and transitionTo also set _palDirty', () => {
  const eng = makeEngine();
  eng.render();
  eng._palDirty = false;
  eng.replacePalette('cyan');
  assert.equal(eng._palDirty, true);

  eng.render();
  eng._palDirty = false;
  eng.transitionTo('plasma');
  assert.equal(eng._palDirty, true);
});
