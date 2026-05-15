# Neonic

A palette-cycling canvas engine, a four-panel drawing tool, and a
self-describing PNG format that carries its own animation data.

You draw a stroke, the editor bakes it into an indexed bitmap, and the
runtime animates it by rotating a 255-entry color palette per frame.
The pixels never change — only the color lookup does. The output is a
`.pshift.png`: a regular PNG that any image viewer can display (showing
the first frame as a static preview), with the precomputed bake and the
palette stops tucked into an iTXt metadata chunk. Drop one next to the
player and it animates.

## Play a logo on your site

```html
<canvas class="logo-cycle" data-src="logo.pshift.png"></canvas>
<script src="neonic-playback.js"></script>
<script>PshiftLoader.mountAll('.logo-cycle');</script>
```

`neonic-playback.js` is a single ~27 KB file with no dependencies. If
the PNG has more than one palette baked into it, the bundled loader
crossfades through them automatically.

## Draw a logo

Open `neonic.html` in a browser:

```
python3 -m http.server 8000
# visit http://localhost:8000/neonic.html
```

The tool has four panels:

1. **Draw** — pressure-sensitive pen or mouse, with per-anchor width
   handles after `pointerup`.
2. **Edit** — anchor / tangent / width editor with auto-fit + manual
   zoom and pan.
3. **Palettes** — playlist of palettes; each row's drawer is its own
   gradient editor with click-to-add stops and a color picker.
4. **Preview** — the cycling animation in real time, baked from the
   same disc-stamp pipeline the draw panel uses.

Export from the toolbar → you get a `logo.pshift.png` carrying the
bake and the full palette playlist.

## File map

| File | Role |
|---|---|
| `neonic.html` | The drawing tool |
| `neonic-playback.js` | Bundled playback runtime — what consumers ship |
| `logo-engine-standalone.js` | Engine: `CycleEngine`, `buildRamp`, `bakeFromD`, `bakeFromStroke` |
| `pshift-png.js` | `.pshift.png` codec (iTXt chunk read/write) |
| `pshift-loader.js` | Playlist scheduler + crossfade controller |
| `build-playback.js` | Concatenates the three runtime files into the bundle |
| `perfect-freehand.mjs` | Vendored stroke renderer (Steve Ruiz, MIT) |
| `logo.pshift.png` | Sample logo |
| `logo-embed.html` | Embed demo: navbar mark + size comparisons |
| `neonic_article.html` | Nine-stage walkthrough of the engine (deployed separately) |
| `tests/engine.test.js` | Node test suite — 22 tests, no browser needed |
| `extra/` | Junk drawer — superseded files, spare PNG samples; gitignored |

## Development

```
python3 -m http.server 8000           # serve the static app
node --test 'tests/*.test.js'         # run unit tests
node build-playback.js                # rebuild neonic-playback.js
```

Edit the three runtime source files
(`logo-engine-standalone.js`, `pshift-png.js`, `pshift-loader.js`)
and re-run `node build-playback.js` to refresh the bundle. The bundle
is committed so consumers can grab a working copy without running node.

Tests cover pure helpers and the `CycleEngine` palette math. Anything
involving the canvas (the bake pipeline, the editor itself) needs a
browser smoke-test.

## How it works

See `neonic_article.html` for the nine-stage walkthrough: parsing the
path, sampling colored segments, masking and combining into an index
buffer, building the palette LUT, the render loop, custom palettes
from stops, the forward-feed transition, and the iTXt metadata format.
The article is the source of truth that gets deployed to its own home.

## License

Apache 2.0 — see [`LICENSE`](LICENSE). The vendored `perfect-freehand`
is MIT; attribution is in [`NOTICE`](NOTICE) and
[`THIRD_PARTY_LICENSES/perfect-freehand-MIT.txt`](THIRD_PARTY_LICENSES/perfect-freehand-MIT.txt).
