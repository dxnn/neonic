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
- E2E tests (canvas/DOM/Playwright): `npm run test:e2e`. Specs live
  in `tests-e2e/*.spec.js`. The config hits the always-on static
  server at localhost:8080, chromium only. One-time setup if
  node_modules is fresh: `npm install && npx playwright install
  chromium`. Prefer `getByRole` / `getByLabel`; use ID selectors
  for canvases and unlabelled sliders, `data-testid` for elements
  with no semantic role (the playlist hamburger grip is the only
  one so far).
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

## Session state — 2026-05-17 (display-adaptive playback)

Tests: `node --test tests/*.test.js` — 22 passing. Syntax check passes.

Shipped: resolution-adaptive playback, soft-mask compositing, format
v2 (no embedded indices). The runtime decides bake size from the
display canvas; embeds bake only what they show.

Architecture in one paragraph:
NEONIC PNGs carry anchors + palettes + a static preview image — no
precomputed indices buffer. At mount, `NeonicLoader.planBake` solves
`scale = targetLong / (bboxLong + 2 × paddingLogical)` where
`targetLong = cssLong × dpr × supersample`. The bake step disc-stamps
indices AND a smooth alpha mask. The painter does indexed-palette
putImageData → `globalCompositeOperation='destination-in'` →
drawImage(mask), so AA edges come from the mask, not from oversample.

Embedder surface (the only knob):
- `data-supersample="N"` on the canvas. Default 1. Allowed values
  1, 2, 4 — anything else falls back to 1 with a console.warn.

Engine API (consumers calling Neonic.CycleEngine directly):
- `new CycleEngine(canvas, baked)` — `baked` may include `maskCanvas`
  for soft-mask compositing.
- `setPalette(ramp)`, `replacePalette(ramp)`, `transitionTo(ramp, off)`.
- `setSpeed(s)` — sign is preserved; negative cycles backward.
  (Editor doesn't expose negative speeds in UI yet.)
- `start()`, `stop()`, `render()`.
- `onFrame` — assign a callback to run inside the engine's rAF; the
  loader's playlist watcher uses this so there's only one rAF loop.
- `dispose()` — added by the loader after mount; releases the
  ResizeObserver, clears onFrame and maskCanvas refs, calls stop().

Loader behaviour:
- Re-bakes via ResizeObserver when CSS long edge changes by >5%.
- Bails (returns null) if the canvas is detached before bake.
- Reads `metadata.paddingLogical` when present (v3 PNGs), falls back
  to `padding / scale` (v2 and earlier).

Internal knobs (not user-facing):
- `MAX_BAKE_EDGE = 1024` — safety ceiling on bake long edge.
- `MIN_BAKE_DIM = 16`, `MIN_BAKE_SCALE = 0.02` — floors for the
  degenerate "huge bbox or zero target" cases.
- `REBAKE_THRESHOLD = 0.05` — minimum CSS change to trigger a re-bake.

Per-frame compute on the project logo at 32px CSS height, retina:
- Pre-work (binary, fixed 480-long bake): ~210k px/frame.
- Post-work (soft mask, no floor, ss=1): ~4k px/frame. ~50× less.

File map (deploy):
- `index.html` — editor.
- `neonic-playback.js` — bundled runtime (~35 KB).
- `logo.neonic.png` — sample (still 326 KB; will shrink to ~33 KB on
  re-export through the editor, format-v2 metadata drops the indices).
- `perfect-freehand.mjs` — vendored stroke helper.

File map (tooling, under `extra/`, gitignored):
- `compare-tiny-canvas.html` — A/B compare across four PNGs at five
  CSS heights. Three columns: ss=2 (4× pixels of C, GPU oversample),
  legacy floor (MIN=480 for reference), ss=1 (no floor — baseline).
- `compare-playback.html` — redirect stub to the tiny-canvas page.
- `disc-stamp-test.html` — dev sandbox for PF outline vs disc-stamp.
- `logo-embed.html` — recommended-usage example, single-bundle.
- `logo-12.neonic.png` — local-only sample (gitignored).

Things worth knowing about the journey (in case the same questions
come back):
- The `padding` parameter is in bake-pixels in the API, but
  `NeonicLoader.planBake` recovers a logical-units padding from
  `metadata.padding / metadata.scale` and re-multiplies by the chosen
  bake scale, so margin proportions stay constant across bake sizes.
  Direct callers of `bakeFromAnchors` (e.g. the editor's preview)
  still pass a bake-pixel `padding`.
- The pre-mount `clientWidth` of a canvas with `width: auto` reflects
  the default 300:150 intrinsic, *not* the post-layout CSS dim. The
  loader sets `canvas.width = canvas.height = 1` and forces a reflow
  before measuring (`collapseCanvasIntrinsic`).
- Disc-stamping spacing is tied to disc radius (not lenSpan/800) so
  thin strokes at small scales stay continuous — the old formula
  produced visible beading on emmyjs-style designs.

Pre-existing bug fix in this session: `built[idx].slice()` in the
gradient-bar click-to-add-stop handler. `buildRamp` returns flat
`Uint8Array(255*3)` since bc548da; this call site was missed in
the refactor.

Open / future work:
- `nwp/neonic-playback.js` (local article-deploy mirror, gitignored)
  is out of sync with the bundle. User manages that deploy separately.
- `logo.neonic.png` still has v1 metadata (with stale indices field).
  Re-export through the editor to get a ~33 KB v2 file.
- Adaptive supersample (per-canvas-size auto choice) was discussed
  and deferred. The fixed `data-supersample` knob is the entire
  current API; revisit only if real-world embeds report quality
  problems at any size.

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
