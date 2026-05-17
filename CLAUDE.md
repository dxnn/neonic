## Git policy (overrides global)
You manage git directly in this project. The global "manual git" rule does
NOT apply here. `git push` remains denied at the permission layer; the user
handles pushing.

Workflow:
- Commit after each meaningful change passes its tests. One logical change
  per commit.
- Stage only the files relevant to the change. Use `git add <paths>`, not
  `git add .` or `git add -A`. Do not sweep up unrelated edits.
- Before committing, run `git diff --staged` and verify the diff is exactly
  what you intend. If something unintended is staged, `git restore --staged
  <path>` to unstage.
- Conventional commit messages: feat:, fix:, refactor:, docs:, test:, chore:.
  First line under 72 chars. Body if useful, omitted if not.
- Never commit on red. If a test was passing and now isn't, fix the test or
  the code before committing — do not commit broken state.
- Do not include AI attribution in commit messages.

## Project shape
- Static HTML/JS app, no build step.
- Serve with `python3 -m http.server 8000`; entry point is `neonic.html`.
- Syntax sanity check for the inline module: `node /tmp/claude/check.js`
  (extracts the `<script type="module">` body and `new Function`-checks it).
- Unit tests (pure helpers + CycleEngine palette logic):
  `node --test 'tests/*.test.js'`. Runs without a browser via Node's
  built-in test runner (node:test). 22 tests. (Node 25 dropped the
  implicit directory-discovery form, so pass the glob explicitly.)
- Browser smoke-test the actual UI changes — canvas/DOM code can't be covered
  by the Node tests.

## Architecture (4 panels)
- Panel 1: live drawing (PF outline polygon during drag, disc-stamped from
  bezier samples after pointerup).
- Panel 2: anchor + tangent editor with width handles. Has its own logical →
  CSS view transform so handles dragged offscreen reframe automatically;
  manual zoom/pan overrides auto-fit.
- Panel 3: playlist of palettes — each row's drawer IS the editor.
- Panel 4: cycling preview, baked from the same disc-stamp algorithm as
  panel 1 (single rendering pipeline).

## Data model invariants
- `state.paths[0].size` — base stroke size; scaled by the stroke slider.
- `anchor.pressure` — source of truth, in [0..1] for PF input, free outside
  that range when set via width-handle drag inverse formula.
- `anchor.width` — derived display value: `width = path.size × (1 -
  thinning + 2 × thinning × pressure)`.
- Stroke slider scales `path.size`; thinning slider just changes the
  formula; both call `recomputeWidths()`.
- Width-handle drag updates `width` and inverts the formula to update
  `pressure` so the explicit drag survives future thinning changes.
- NEONIC PNG metadata persists `thinning` so widths round-trip losslessly
  on import (slider restored before recompute).

## Session state — 2026-05-16 (updated)

Soft-mask compositing: the bake's smooth alpha mask is now retained
and applied via `globalCompositeOperation='destination-in'` after the
indexed-palette putImageData. Anti-aliasing therefore lives in the
bake itself (per-pixel fractional alpha from canvas2d's path-fill AA)
instead of relying on the browser to oversample-and-downsample a much
bigger backing store.

- `bakeFromStroke` / `bakeFromAnchors` / `bakeFromD` accept
  `softMask: true` (default). When set, mask threshold drops from 200
  to 1, and `maskCanvas` is returned alongside `indices`.
- `CycleEngine._paint` composites the mask if present (one extra
  drawImage + two composite-mode setter calls per frame).
- `NeonicLoader`: `MIN_BAKE_EDGE` dropped 480 → 200 since AA no
  longer needs the oversample budget.
- Tooling/example HTML moved under `extra/`:
  `extra/compare-tiny-canvas.html` is the A/B (binary vs. soft mask),
  `extra/compare-playback.html` is a redirect stub,
  `extra/disc-stamp-test.html` is a dev sandbox,
  `extra/logo-embed.html` is the recommended-usage example (now
  using the bundle).

Pre-existing bug fix: `built[idx].slice()` in the gradient-bar
click-to-add-stop handler. `buildRamp` returns flat `Uint8Array(255*3)`
since bc548da; this call site was missed in the refactor.

Per-frame compute on the live logo at 32px CSS height (dpr=2):
- Binary path (old): bake 480×438 ≈ 210k px/frame.
- Soft mask path (new): bake 200×186 ≈ 37k px/frame.
- Quality should be visibly comparable; verify on retina via
  `extra/compare-tiny-canvas.html` columns A vs C.

Open / future work:
- The soft-mask path means `MIN_BAKE_EDGE` could go lower than 200
  for drawings with thicker strokes. Adaptive based on min stroke
  width is the natural next step.
- Anchor BBox doesn't account for stroke-half-width swelling, so
  thicker strokes may clip into the padding band. Hasn't been seen
  in practice. Worth tightening if a drawing comes in with very thick
  edge strokes.

## Session state — 2026-05-15
Tests: `node --test tests/*.test.js` — 22 passing. Syntax check passes.

This session: resolution-adaptive playback + smaller PNGs
(`b38f931..d1021d9`, 5 commits).

What landed:
- `Neonic.bakeFromAnchors({ anchors, scale, padding, half })` and
  `Neonic.sampleAnchors(anchors, perSeg)` added to the runtime so any
  consumer can re-bake from anchor metadata without pulling in editor
  internals.
- `NeonicLoader.mount` rebakes from `metadata.anchors` at
  `clientWidth × devicePixelRatio × supersample` (default ss=2). One
  rAF wait if `clientWidth` is 0 (otherwise we'd fall through to the
  canvas's 300×150 attribute default). Bake's long edge capped at
  `MAX_BAKE_EDGE = 1024` so a big canvas on retina doesn't melt CPUs.
- `NeonicPng` format bumped to v2: no more `indices` field. Encoder
  doesn't accept it, decoder doesn't return it. Old PNGs with
  meta.indices still decode (the field is just ignored).
- `index.html` exportSize dropdown removed. Preview image is always
  baked at `scale=0.8` (= "half" of the historical 1.6); playback is
  display-resolution-driven anyway.
- `compare-tiny-canvas.html`: standalone QA page that mounts the same
  PNG into canvases at 32 / 48 / 64 / 120 / 240 / 480 px CSS height
  (mimicking the aisoup-style `height:32px; width:auto` pattern),
  with three supersample columns: default(ss=2), ss=1 (compute-tight),
  ss=4 (quality-max). Each cell reports bake dims + px/frame.
- `compare-playback.html`: the legacy-vs-new comparison from earlier
  in the session is now a no-op redirect to `compare-tiny-canvas.html`
  since the legacy path no longer exists.

Measured impact on `logo.neonic.png`:
- File size: 326 KB → ~33 KB once re-exported (~90% smaller; the
  committed `logo.neonic.png` is still the pre-eradication 326 KB
  file, will shrink on next export).
- Per-frame compute (32px-tall canvas, dpr=2, ss=2 default):
  legacy ≈173k px → new ≈31k px (~5–6× less). Big-canvas worst case
  is now bounded by MAX_BAKE_EDGE rather than display × dpr × ss.

Open / future work:
- Adaptive supersample (more ss for smaller canvases, less for big)
  — user wanted to defer until baseline behaviour settles.
- Re-export of `logo.neonic.png` to shrink the committed file —
  needs a manual roundtrip through the editor's import/export buttons.
- Quality at very small canvases on dpr=1 is necessarily limited.
  Embeds targeting non-retina screens at <50px height should bump
  to `data-supersample="4"` to keep strokes smooth.

## Session state — 2026-05-04
Tests: `node --test tests/` — 19 passing. Syntax check passes; dev server returns 200.

Last session shipped 11 commits (`66e09ba..c06bcb0`). What landed:
- Unified panel 1 + panel 4 via disc-stamping (one rendering pipeline).
- Absolute anchor widths with per-anchor `pressure` source-of-truth and
  per-path `size`.
- Thinning slider; live-recompute on slider changes; persisted to NEONIC
  metadata so widths round-trip cleanly.
- Pen pressure: `simulatePressure: false` for `pointerType === 'pen'`,
  preserves Apple Pencil pressure values that were previously being
  overwritten by PF's velocity simulator.
- Auto-fit + manual zoom/pan in panel 2 (wheel, +/−/fit buttons,
  middle-click + pan-mode drag).
- Tap-mode dropdown (drag/add/remove anchor/pan) for mobile users
  without modifier keys.
- Panel 3 redesign: each playlist row expands into a per-row drawer
  containing the full palette editor (preset name+save, dropdown +
  switch, duplicate, gradient bar with click-to-add and drag-stop,
  color picker, remove stop, remove palette).
- Row click triggers smooth forward-feed transition to that palette
  via the existing cycle-watcher pendingNextIdx flow.
- SVG import: best-effort sample of first `<path>` (truncates at second
  M/m), scale-to-fit panel 1, RDP-simplify; missing palette data keeps
  the user's current playlist instead of resetting.
- Bug fixes: undo/redo no longer briefly speeds up the cycler (rebake
  now restores `engine.baseStartOff`); drag handle restricted to grip;
  preset row tightened so duplicate fits on one line.

Open or future work the user might pick up:
- SVG transforms: `<g transform>` and per-path `transform` attributes
  are currently ignored. If a CAD-style export comes in skewed, that's
  why. Fix is to multiply by `getCTM()` while the path is mounted.
- PNG/NEONIC files exported between "store pressure" and "save thinning"
  (a small build window) land at the 0.4 default thinning. Not corrupt,
  but absolute widths may be slightly off vs the moment of export.
  Re-saving fixes them for next time.
- The width-handle drag at thinning ≈ 0 doesn't survive subsequent
  slider tweaks (formula is degenerate). Acceptable since the user
  explicitly said widths are uniform at thinning=0; flag it if it
  becomes painful in practice.

## Naming
- Project name is **Neonic**. The runtime global is `window.Neonic`
  (was `window.HyperDrive` in earlier commits — the name was a working
  title). All consumers use `window.Neonic.{CycleEngine, bakeFromD,
  bakeFromStroke, PALETTES, buildRamp}`.

## Article
- `neonic_article.html` is the process essay (9-stage walkthrough of
  the engine, with live demos). Replaces `HyperDrive Process.html`.
  The prelude (before the Autotext seam) is a placeholder for the user
  to rewrite. The walkthrough section between the Autotext and Fin
  seams contains the engine stages with live demos that depend on
  `window.Neonic` being loaded by the topbar.
