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

## Session state — 2026-05-15 (updated)
Tests: `node --test tests/*.test.js` — 22 passing. Syntax check passes.

This session: resolution-adaptive playback + smaller PNGs
(`b38f931..6ff76c5`, 2 commits).

What landed:
- `Neonic.bakeFromAnchors({ anchors, scale, padding, half })` and
  `Neonic.sampleAnchors(anchors, perSeg)` added to the runtime so any
  consumer can re-bake from anchor metadata without pulling in editor
  internals.
- `NeonicLoader.mount` now rebakes from `metadata.anchors` at the
  canvas's `clientWidth × devicePixelRatio × supersample` (default
  supersample=1, override via `data-supersample` attr). Legacy PNGs
  without anchors fall back to embedded indices.
- `NeonicPng.encode` accepts `indices: null/undefined` and omits the
  field. Decoder returns `indices: null` when absent.
- `index.html` export stops embedding the indices buffer. The
  exportSize dropdown now only affects the static preview image inside
  the PNG (its title attribute spells that out).
- `compare-playback.html` is a side-by-side visual QA tool that mounts
  the same source PNG in three modes (legacy / opt ss=1 / opt ss=2) at
  four canvas sizes, plus a file-size delta panel.

Measured impact on the existing `logo.neonic.png`:
- File: 326 KB → 33 KB (~90% smaller) with identical preview image,
  ~98% smaller if the preview is shrunk too.
- Per-frame compute (60px CSS canvas, dpr=1): 225k px → 3.8k px (~58×
  less work). Scales with the canvas, not the export.

Open / future work:
- Default `supersample` is 1. On dpr=1 displays, very small canvases
  (≤80px) look slightly chunky; bumping to `data-supersample="2"`
  fixes it at the cost of 4× the pixel work. On retina this is moot.
  If the comparison tool shows the chunkiness is unacceptable as a
  default, lift it to 2 (will roughly match legacy compute on small
  canvases and still beat it on large).
- Legacy fallback (no-anchors PNGs) is untested for the new path —
  none exist in the repo. The code is the same as before, just guarded.

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
