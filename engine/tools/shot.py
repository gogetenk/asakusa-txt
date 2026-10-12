#!/usr/bin/env python3
"""Headless test harness for a single-file WebGL2 (mobile) game.

  python3 shot.py PAGE.html OUTDIR [--viewport 390x844] [--dpr 2] [--desktop]
                  [--actions actions.json] [--wait 1500] [--shell] [--allow-net]

Mobile emulation by default (iPhone Safari UA, touch, dpr 2); taps/drags are real touch
events sent with CDP Input.dispatchTouchEvent. --desktop = 1280x800 dpr 1, mouse + keyboard.
Writes OUTDIR/console.txt and OUTDIR/<name>.png per {"shot": name}. Action format: README.md.
"""
import argparse, asyncio, json, pathlib, re, sys, time

from playwright.async_api import async_playwright, Error as PWError

WEBGL_ARGS = [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
    "--enable-webgl",
    "--autoplay-policy=no-user-gesture-required",
]
IPHONE_UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 "
             "(KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1")
FONT_HOSTS = ("fonts.googleapis.com", "fonts.gstatic.com")
MOVE_TICK = 0.016    # s between interpolated moves during a drag
HOLD_TICK = 0.050    # s between touchMoves while a drag is held
HOLD_JITTER = 0.1    # px; Chrome drops touchMoves whose position did not change
FLUSH_TIMEOUT = 60   # s to wait for the page to ack queued input

# Injected before any page script: counts rAF frames (for an fps figure that needs no
# cooperation from the page) and logs WebGL context creation / loss to the console.
INIT_JS = r"""
(() => {
  const h = window.__shotHarness = { frames: 0, last: 0 };
  const raf = window.requestAnimationFrame.bind(window);
  const tick = (t) => { h.frames++; h.last = t; raf(tick); };
  raf(tick);
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    const ctx = orig.apply(this, arguments);
    if (/webgl/i.test(type) && !this.__shotSeen) {
      this.__shotSeen = true;
      console.debug(`[shot] getContext('${type}') -> ${ctx ? 'ok' : 'NULL'} at ${performance.now().toFixed(0)}ms ` +
                    JSON.stringify(attrs || {}));
      this.addEventListener('webglcontextlost', () => console.error('[shot] webglcontextlost'));
      this.addEventListener('webglcontextrestored', () => console.warn('[shot] webglcontextrestored'));
    }
    return ctx;
  };
})();
"""


def log(msg=""):
    print(msg, flush=True)


def parse_args():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("page", help="path to the HTML file")
    ap.add_argument("outdir", help="output directory (created if missing)")
    ap.add_argument("--viewport", help="WxH in CSS px (default 390x844 mobile, 1280x800 desktop)")
    ap.add_argument("--dpr", type=float, help="device scale factor (default 2 mobile, 1 desktop)")
    ap.add_argument("--desktop", action="store_true", help="desktop mode: mouse + keyboard, no touch")
    ap.add_argument("--actions", help="JSON file with a list of actions")
    ap.add_argument("--wait", type=int, default=1500, help="ms to wait after load, before the actions (default 1500)")
    ap.add_argument("--shell", action="store_true",
                    help="use chromium_headless_shell (old headless) instead of full Chromium new-headless; "
                         "much slower screenshots of WebGL pages")
    ap.add_argument("--allow-net", action="store_true",
                    help="let non-font http(s) requests through (default: abort all of them, the sandbox has no internet)")
    return ap.parse_args()


class Input:
    """Touch via CDP in mobile mode, mouse via CDP in desktop mode, keyboard via Playwright.

    Events are sent without waiting for the renderer's ack (acks only arrive once the main
    thread is free, i.e. up to one frame later, and at a few fps that would stretch a 50 ms tap
    into 400+ ms). flush() collects the acks at the end of each action.
    """

    def __init__(self, page, cdp, desktop):
        self.page, self.cdp, self.desktop = page, cdp, desktop
        self.pending = []
        self._jit = False
        self.loop = asyncio.get_running_loop()

    def _spawn(self, coro):
        self.pending.append(asyncio.ensure_future(coro))

    async def flush(self):
        pend, self.pending = self.pending, []
        if not pend:
            return
        res = await asyncio.wait_for(asyncio.gather(*pend, return_exceptions=True), FLUSH_TIMEOUT)
        for r in res:
            if isinstance(r, Exception):
                raise r

    # -- primitives
    def touch(self, kind, x=None, y=None):
        pts = [] if x is None else [{"x": x, "y": y, "id": 1, "radiusX": 4, "radiusY": 4, "force": 1}]
        self._spawn(self.cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": pts}))

    def mouse(self, kind, x, y, held):
        p = {"type": kind, "x": x, "y": y, "button": "left" if (held or kind != "mouseMoved") else "none",
             "buttons": 1 if held else 0, "clickCount": 0 if kind == "mouseMoved" else 1}
        self._spawn(self.cdp.send("Input.dispatchMouseEvent", p))

    async def frames(self, n):
        for _ in range(n):  # resolves after the page has run one more animation frame
            await self.page.evaluate("new Promise(r => requestAnimationFrame(() => r()))")

    async def press_release(self, down, up, ms, frames):
        """down(); keep pressed >= ms wall-clock and (if frames) >= that many rendered frames; up()."""
        t0 = self.loop.time()
        down()
        if frames:
            await self.flush()          # the page has handled the down event...
            await self.frames(frames)   # ...and rendered `frames` frames since
        rest = ms / 1000 - (self.loop.time() - t0)
        if rest > 0:
            await asyncio.sleep(rest)
        up()
        await self.flush()

    # -- actions
    async def tap(self, x, y, ms, frames):
        if self.desktop:
            self.mouse("mouseMoved", x, y, False)
            await self.press_release(lambda: self.mouse("mousePressed", x, y, True),
                                     lambda: self.mouse("mouseReleased", x, y, False), ms, frames)
        else:
            await self.press_release(lambda: self.touch("touchStart", x, y),
                                     lambda: self.touch("touchEnd"), ms, frames)

    async def drag(self, x1, y1, x2, y2, ms, hold):
        if self.desktop:
            self.mouse("mouseMoved", x1, y1, False)
            self.mouse("mousePressed", x1, y1, True)
            move = lambda x, y: self.mouse("mouseMoved", x, y, True)
        else:
            self.touch("touchStart", x1, y1)
            move = lambda x, y: self.touch("touchMove", x, y)
        t0, dur = self.loop.time(), max(ms, 1) / 1000
        while True:
            await asyncio.sleep(MOVE_TICK)
            t = min(1.0, (self.loop.time() - t0) / dur)
            move(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)
            if t >= 1.0:
                break
        if hold > 0:
            t1 = self.loop.time()
            while self.loop.time() - t1 < hold / 1000:
                await asyncio.sleep(HOLD_TICK)
                if not self.desktop:   # a stationary mouse sends nothing; a held finger keeps moving
                    self._jit = not self._jit
                    move(x2 + (HOLD_JITTER if self._jit else -HOLD_JITTER), y2)
        if self.desktop:
            self.mouse("mouseReleased", x2, y2, False)
        else:
            self.touch("touchEnd")
        await self.flush()

    async def key(self, key, ms, frames=0):
        kb = self.page.keyboard
        await self.press_release(lambda: self._spawn(kb.down(key)), lambda: self._spawn(kb.up(key)), ms, frames)


def to_json(v):
    try:
        return json.dumps(v, ensure_ascii=False)
    except (TypeError, ValueError):
        return repr(v)


async def run_action(page, inp, a, outdir, i):
    if not isinstance(a, dict) or not a:
        raise ValueError(f"not a non-empty object: {a!r}")
    t = time.monotonic()
    el = lambda: f"({(time.monotonic() - t) * 1000:.0f}ms)"
    if "wait" in a:
        log(f"> [{i}] wait {a['wait']}ms")
        await asyncio.sleep(int(a["wait"]) / 1000)
    elif "tap" in a:
        x, y = a["tap"]
        ms, fr = int(a.get("ms", 50)), int(a.get("frames", 0))
        await inp.tap(x, y, ms, fr)
        log(f"> [{i}] tap {x},{y} ms={ms}{f' frames={fr}' if fr else ''} {el()}")
    elif "drag" in a:
        x1, y1, x2, y2 = a["drag"]
        ms, hold = int(a.get("ms", 800)), int(a.get("hold", 0))
        await inp.drag(x1, y1, x2, y2, ms, hold)
        log(f"> [{i}] drag {x1},{y1} -> {x2},{y2} ms={ms} hold={hold} {el()}")
    elif "key" in a:
        ms = int(a.get("ms", 100))
        await inp.key(a["key"], ms)
        log(f"> [{i}] key {a['key']} held {ms}ms {el()}")
    elif "press" in a:
        ms, fr = int(a.get("ms", 50)), int(a.get("frames", 0))
        await inp.key(a["press"], ms, fr)
        log(f"> [{i}] press {a['press']}{f' frames={fr}' if fr else ''} {el()}")
    elif "eval" in a:
        try:
            res = await page.evaluate(a["eval"])
            log(f"> [{i}] eval {a['eval']}\n    = {to_json(res)}")
        except PWError as e:
            log(f"> [{i}] eval {a['eval']}\n    ! {str(e).splitlines()[0]}")
    elif "shot" in a:
        path = outdir / f"{a['shot']}.png"
        await page.screenshot(path=str(path), timeout=60000)
        log(f"> [{i}] shot {path} {el()}")
    else:
        raise ValueError(f"unknown action: {a!r}")


async def harness_frames(page):
    try:
        return await page.evaluate("window.__shotHarness ? [__shotHarness.frames, __shotHarness.last] : null")
    except PWError:
        return None


async def amain():
    args = parse_args()
    wall0 = time.monotonic()
    page_path = pathlib.Path(args.page).resolve()
    if not page_path.is_file():
        sys.exit(f"no such file: {page_path}")
    outdir = pathlib.Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    vw, vh, dpr = (1280, 800, 1.0) if args.desktop else (390, 844, 2.0)
    if args.viewport:
        vw, vh = (int(v) for v in args.viewport.lower().split("x"))
    if args.dpr is not None:
        dpr = args.dpr

    actions = None
    if args.actions:
        actions = json.loads(pathlib.Path(args.actions).read_text())
        if not isinstance(actions, list):
            sys.exit("actions file must contain a JSON list")

    messages, blocked = [], []   # messages: (type, text)

    def on_console(msg):
        loc = msg.location or {}
        url = loc.get("url") or ""
        where = f"  ({url.rsplit('/', 1)[-1][:60]}:{loc.get('lineNumber', '?')})" if url else ""
        messages.append((msg.type, msg.text + where))

    def on_pageerror(err):
        stack = (err.stack or "").strip()
        messages.append(("pageerror", stack or f"{err.name}: {err.message}"))

    def on_requestfailed(req):
        if req.url not in blocked:
            messages.append(("requestfailed", f"{req.url}: {req.failure}"))

    async def on_route(route):
        url = route.request.url
        host = re.sub(r"^https?://([^/:]+).*$", r"\1", url)
        if host in FONT_HOSTS or not args.allow_net:
            blocked.append(url)
            await route.abort("blockedbyclient")
        else:
            await route.continue_()

    async with async_playwright() as p:
        launch = dict(headless=True, args=WEBGL_ARGS)
        if not args.shell:
            launch["channel"] = "chromium"     # full Chromium binary in new-headless mode
        t = time.monotonic()
        browser = await p.chromium.launch(**launch)
        log(f"browser: {'chromium_headless_shell' if args.shell else 'chromium new-headless'} {browser.version} "
            f"({(time.monotonic() - t) * 1000:.0f}ms)")

        ctx_opts = dict(viewport={"width": vw, "height": vh}, device_scale_factor=dpr)
        if args.desktop:
            ctx_opts.update(is_mobile=False, has_touch=False,
                            user_agent=f"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
                                       f"Chrome/{browser.version} Safari/537.36")
        else:
            ctx_opts.update(is_mobile=True, has_touch=True, user_agent=IPHONE_UA)
        context = await browser.new_context(**ctx_opts)
        await context.route(re.compile(r"^https?://"), on_route)
        await context.add_init_script(INIT_JS)
        page = await context.new_page()
        page.on("console", on_console)
        page.on("pageerror", on_pageerror)
        page.on("requestfailed", on_requestfailed)
        page.on("crash", lambda *_: messages.append(("crash", "renderer crashed")))
        page.on("dialog", lambda d: (messages.append(("dialog", f"{d.type}: {d.message}")),
                                     asyncio.ensure_future(d.dismiss())))
        cdp = await context.new_cdp_session(page)
        inp = Input(page, cdp, args.desktop)

        log(f"mode: {'desktop' if args.desktop else 'mobile'} {vw}x{vh} @dpr{dpr:g}  page: {page_path.as_uri()}")
        t = time.monotonic()
        try:
            await page.goto(page_path.as_uri(), wait_until="load", timeout=30000)
            log(f"loaded ({(time.monotonic() - t) * 1000:.0f}ms)")
        except PWError as e:
            log(f"WARNING: load did not complete ({str(e).splitlines()[0]}); continuing")

        if args.wait > 0:
            log(f"> wait {args.wait}ms (--wait)")
            await asyncio.sleep(args.wait / 1000)

        if actions is None:
            actions = [{"shot": "initial"}, {"tap": [vw / 2, vh / 2]}, {"wait": 1500}, {"shot": "after_tap"}]

        f0, t0 = await harness_frames(page), time.monotonic()
        failed = None
        for i, a in enumerate(actions):
            try:
                await run_action(page, inp, a, outdir, i)
            except Exception as e:     # keep going far enough to report console / perf
                failed = f"action [{i}] {a!r} failed: {type(e).__name__}: {e}"
                log("ERROR: " + failed)
                break
        f1, t1 = await harness_frames(page), time.monotonic()

        perf = None
        try:
            perf = await page.evaluate(
                "(() => { const p = window.__perf; if (!p || typeof p !== 'object') return undefined;"
                " try { return JSON.parse(JSON.stringify(p)); } catch (e) { return 'unserializable: ' + e; } })()")
        except PWError as e:
            log(f"WARNING: could not read window.__perf: {str(e).splitlines()[0]}")
        await browser.close()

    with open(outdir / "console.txt", "w") as f:
        for typ, text in messages:
            f.write(f"[{typ}] {text}\n")
        for url in blocked:
            f.write(f"[blocked] {url}\n")

    log(f"\n--- console: {len(messages)} messages, {len(blocked)} requests blocked -> {outdir / 'console.txt'}")
    for typ, text in messages:
        log(f"[{typ}] {text}")
    for url in blocked:
        log(f"[blocked] {url}")
    if perf is not None:
        log("\n--- window.__perf")
        log(json.dumps(perf, indent=2, ensure_ascii=False))
    log()
    if f0 and f1 and f1[1] > f0[1]:
        log(f"rAF fps during actions: {(f1[0] - f0[0]) * 1000 / (f1[1] - f0[1]):.1f} "
            f"({f1[0] - f0[0]} frames in {t1 - t0:.1f}s)")
    n_err = sum(1 for typ, _ in messages if typ in ("pageerror", "crash"))
    log(f"pageerrors: {n_err}   wall time: {time.monotonic() - wall0:.2f}s")
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(amain())
