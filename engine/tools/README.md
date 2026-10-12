# shot.py: headless WebGL2 test harness

Loads a single-file HTML game in headless Chromium with software WebGL2 (ANGLE on SwiftShader), plays a script of touch, mouse and keyboard actions, and saves screenshots. It also collects console output and page errors, and prints `window.__perf`.

```
python3 shot.py PAGE.html OUTDIR [--viewport 390x844] [--dpr 2] [--desktop]
                [--actions actions.json] [--wait 1500] [--shell] [--allow-net]
```

| mode | viewport | dpr | input | UA |
|---|---|---|---|---|
| default (mobile) | 390x844 | 2 | touch through CDP `Input.dispatchTouchEvent`, `is_mobile`, `has_touch` | iPhone iOS 18.5 Safari |
| `--desktop` | 1280x800 | 1 | mouse and keyboard | desktop Chrome |

- `--wait` sets how many ms to wait after `load`, before the actions run.
- `--shell` switches to `chromium_headless_shell`. Rendering is the same, but screenshots of WebGL pages are about 5-10x slower.
- `--allow-net` lets non-font http(s) requests through. By default every http(s) request is aborted immediately, since the sandbox has no internet. Google Fonts requests are always aborted.
- With no `--actions`, the script waits, then runs `shot initial`, taps the screen centre, waits 1500 ms and runs `shot after_tap`.
- Output: `OUTDIR/*.png` (viewport only, at device pixels, so 780x1688 by default) and `OUTDIR/console.txt`. Everything is also printed to stdout, with each line prefixed `[log] [warning] [error] [pageerror] [blocked] ...`. The run ends with `window.__perf` as JSON (if the page defines it), the measured rAF fps, the pageerror count and the wall time.
- Exit code is 1 if an action is invalid or fails.

## Actions (JSON list, run in order)

```json
[
  {"wait": 500},
  {"tap": [195, 600]},                          // touch tap (mobile) / click (desktop); optional "ms": 50, "frames": 0
  {"drag": [80, 700, 140, 640], "ms": 300, "hold": 3000},  // virtual joystick: move over ms, then hold
  {"key": "w", "ms": 1000},                     // hold a key (keyboard.down ... up)
  {"press": "e"},                               // single press; optional "frames": N
  {"eval": "window.game.player.pos"},           // result printed as JSON
  {"shot": "after_move"}                        // OUTDIR/after_move.png
]
```
(Real files must not contain the `//` comments.)

- `drag` sends `touchStart` at p1, then interpolated `touchMove`s to p2 about every 16 ms over `ms`. During `hold` it sends a `touchMove` every 50 ms at p2 ±0.1 px, then `touchEnd`. Desktop mode uses mouse down/move/up instead, and sends no moves while holding.
- `"frames": N` on `tap` or `press` keeps the input down until the page has rendered N frames. Use it when the game polls input once per frame and could miss a 50 ms tap at low fps.
- Coordinates are CSS px (`clientX` / `clientY`).

## Examples

```bash
cd /home/claude/asakusa/tools
python3 shot.py ../game.html out/smoke                                  # load, tap centre, two screenshots
python3 shot.py ../game.html out/run --actions test/actions_mobile.json
python3 shot.py ../game.html out/desk --desktop --actions test/actions_desktop.json
python3 shot.py ../game.html out/fast --dpr 1 --wait 3000              # ~3x the fps of dpr 2
python3 shot.py ../game.html out/land --viewport 844x390 --dpr 3       # landscape iPhone
```

## Launch flags used

```
channel="chromium" (full binary, new headless), headless=True
--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader
--ignore-gpu-blocklist --enable-webgl --autoplay-policy=no-user-gesture-required
```
WebGL2 works with every combination tried, including no flags at all. Chromium 141 falls back to ANGLE/Vulkan/SwiftShader on its own. The flags only make that choice explicit, and they also expose `EXT_disjoint_timer_query_webgl2`.

WebGL2 report (`test/probe_flags.py`): renderer `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))`, MAX_DRAW_BUFFERS = MAX_COLOR_ATTACHMENTS = 6, MAX_TEXTURE_SIZE 8192.
- Available: `EXT_color_buffer_float`, `EXT_color_buffer_half_float`, `OES_texture_float_linear`, `EXT_float_blend`, `WEBGL_multi_draw`, `EXT_texture_filter_anisotropic`, `OES_draw_buffers_indexed`, `EXT_disjoint_timer_query_webgl2` (with the flags only), and all compressed formats (S3TC, ETC, ASTC, BPTC, RGTC).
- Not available: `OES_texture_half_float_linear` (half-float linear filtering is core in WebGL2 anyway) and `KHR_parallel_shader_compile`.
- A 3-attachment RGBA16F MRT with `drawBuffers` reads back exactly, including values >1 and <0.

## Gotchas

- **Speed comes from fill rate.** On 2 vCPUs, the demo (two fullscreen passes, 3x RGBA16F MRT, 9-tap glow) runs at about 7 fps at dpr 2 (780x1688), about 24 fps at dpr 1, and about 8 fps on desktop 1280x800. A trivial shader holds 60 fps. Expect a real game to run at a few fps, so make game logic dt-based and keep waits generous.
- **WebGL init is fast**: about 15 ms to get the context and first frame about 30 ms after navigation. Shader compilation is not the bottleneck. Asset decoding / generation in your own code is what to time.
- **Screenshots** are about 0.5-1 s at dpr 2 (they wait for a fresh compositor frame), or 4-25 s with `--shell`. They capture WebGL correctly with `preserveDrawingBuffer: false`.
- **Input is not awaited per event.** At low fps the renderer acks each CDP input only after the current frame, which would turn a 50 ms tap into about 400 ms. The tool pipelines the events and collects the acks at the end of each action, so the page sees the intended timing (event `timeStamp`s stay 50 ms apart).
- **Stationary `touchMove`s are dropped** by Chrome. So are tiny moves before the touch has moved past slop, unless the page calls `preventDefault` on touchmove. That is why held drags jitter by ±0.1 px. A game that ignores moves smaller than 1 px still sees a steady joystick vector.
- Mobile mode has **no mouse events and no `click` on the canvas** unless the page's handlers allow it. DOM buttons do get `click` from a tap. Desktop mode has no touch events.
- Key holds use Playwright `keyboard.down` / `up`. A held key does **not** auto-repeat. The page sees one `keydown` and one `keyup`.
- `console.txt` also contains a `[debug] [shot] getContext(...)` line, plus `[shot] webglcontextlost` if the context is lost. These come from the injected init script, which also counts rAF frames for the fps figure.

Test assets are in `test/`: `demo.html` (touch-driven WebGL2 demo; URL knobs `?glow=R&rt=8&scale=0.5`), `webgl2_probe.html` with `probe_flags.py`, `bench.html`, and sample action files.
