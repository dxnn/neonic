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
- Static HTML/JS app, no build step at deploy time. Authored sources are
  bundled into `neonic-playback.js` via `node build-playback.js`.
- Serve with `python3 -m http.server 8000`; entry point is `index.html`.
- Syntax sanity check for the inline module: `node /tmp/claude/check.js`
  (extracts the `<script type="module">` body and `new Function`-checks it).
- Unit tests (pure helpers, engine palette logic, bundle freshness):
  `node --test 'tests/*.test.js'` — currently 22 tests. Runs without a
  browser via Node's built-in test runner. (Node 25 dropped the implicit
  directory-discovery form, so pass the glob explicitly.)
- E2E tests (canvas/DOM/Playwright): `npm run test:e2e`. Specs live in
  `tests-e2e/*.spec.js`. Chromium only, hits the always-on static server
  at localhost:8080. One-time setup if node_modules is fresh:
  `npm install && npx playwright install chromium`. Prefer `getByRole` /
  `getByLabel`; use ID selectors for canvases and unlabelled sliders,
  `data-testid` for elements with no semantic role (the playlist
  hamburger grip is the only one so far).
- Bundle freshness: `tests/bundle.test.js` fails if `neonic-playback.js`
  drifts from a fresh concat of its three sources. Always re-run
  `node build-playback.js` and commit the regenerated bundle when one of
  the source files (`logo-engine-standalone.js`, `neonic-png.js`,
  `neonic-loader.js`) changes.

## Architecture (4 panels)
- Panel 1 (Sketch it): live drawing — PF outline polygon during drag,
  disc-stamped from bezier samples after pointerup.
- Panel 2 (Tweak it): anchor + tangent editor with width handles. Has
  its own logical → CSS view transform so handles dragged offscreen
  reframe automatically; manual zoom/pan overrides auto-fit. Empty-
  space drag pans, regardless of tap-mode; the explicit pan mode is
  for densely-packed canvases.
- Panel 3 (Paint it): playlist of palettes — each row's drawer IS the
  per-palette stop editor.
- Panel 4 (Grab it): cycling preview, baked from the same disc-stamp
  algorithm as panel 1 (single rendering pipeline).

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
- `.neonic.png` metadata persists `thinning` so widths round-trip
  losslessly on import (slider restored before recompute).
- Snapshot/undo carries the whole playlist + activeIdx/displayedIdx/
  pendingNextIdx/selectedStop/targetCycles — palette ops are
  undoable alongside drawing edits.

## Engine surface
`window.Neonic = { CycleEngine, bakeFromD, bakeFromStroke,
bakeFromAnchors, sampleAnchors, buildRamp, attachPlaylistWatcher }`.
The engine deliberately has no built-in palette dict — named palette
presets are an editor concept (see `PALETTE_STOPS` in `index.html`),
and embed-time playback gets stops from PNG metadata. The string-name
form of `setPalette`/`replacePalette`/`transitionTo` is gone; all three
take a `Uint8Array` ramp from `buildRamp(stops)`.

`attachPlaylistWatcher(eng, opts)` is the playlist orchestrator used by
both the editor and the loader. opts is a small callback set
(`getPalettes`/`getActive`/`setActive`/`getPending`/`setPending`/
`getTarget`/`setTarget`/optional `onPromote`) so each host decides
where the active/pending/target state lives.

## Loader behaviour
- `NeonicLoader.mount(canvas, src)` and `.mountAll(selector)`.
- `mountAll` uses `Promise.allSettled` + per-canvas catch + console.warn;
  one bad PNG doesn't take down every other logo on the page.
- Re-bakes via ResizeObserver when CSS long edge changes by >5%; releases
  the previous mask canvas's backing buffer (sets width/height to 0)
  before reassigning.
- Reads `metadata.paddingLogical` when present (v3 PNGs), falls back to
  `padding / scale` (v2 and earlier).
- `eng.dispose()` (added after mount) disconnects observer, breaks ref
  cycles, releases mask canvas backing.

## Loader knobs (not user-facing)
- `MAX_BAKE_EDGE = 1024` — safety ceiling on bake long edge.
- `MIN_BAKE_DIM = 16`, `MIN_BAKE_SCALE = 0.02` — floors for degenerate
  "huge bbox or zero target" cases.
- `REBAKE_THRESHOLD = 0.05` — minimum CSS change to trigger a re-bake.
- `DEFAULT_SUPERSAMPLE = 1`, `ALLOWED_SUPERSAMPLE = [1, 2, 4]` — the
  `data-supersample="N"` knob on a `.logo-cycle` canvas.

## Article
- `nwp/neonic/article2.html` is the process essay's local mirror; the
  deploy site is `inwordsandpictures.com/neonic`. `nwp/` is gitignored —
  the user manages that deploy separately. After engine/loader changes
  that affect surface area, glance at the article for drift (palette-
  name iteration, PNG metadata field names, etc.) and update the local
  mirror; the user carries those changes to the deploy.

## TODOs / future work
- Negative speeds + playlist composition modes (e.g. reverse-on-loop,
  shuffle). The TODO comment is on the speed input in `index.html`.
  Negative speeds were briefly enabled and reverted because the
  cycle-watcher's transition tween stalls mid-blend on sign-flip.
- SVG import: `<g transform>` and per-path `transform` are ignored. CAD
  exports that come in skewed are why. Fix is to multiply by `getCTM()`
  while the path is mounted.
- Adaptive supersample (per-canvas-size auto choice) deferred. The
  fixed `data-supersample` knob is the entire current API; revisit only
  if real-world embeds report quality problems.
- CI workflow not set up. `npm run test:e2e` works locally.
- e2e coverage gaps: Import (file upload), Export (file download),
  Record (MediaRecorder), the gradient-bar click-to-add/drag-stop, and
  the native color picker. The first three are heavyweight; the last
  two are achievable but fiddly.
