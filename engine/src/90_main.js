// ───────────────────────── boot, input, gameplay ─────────────────────────
const FONT_STACK = '"M PLUS 1 Code", "DejaVu Sans Mono", Menlo, Consolas, monospace';
const KANJI_FONT = '"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif CJK JP", "Noto Serif JP", serif';
const AU = window.AsakusaAudio || { init() { return Promise.resolve(false); }, update() { }, step() { }, sfx() { }, setMuted() { }, isMuted() { return true; } };

// ── kanji decals on the big lanterns: rasterised once, re-sampled into cells every frame
function rasterKanji(text) {
  const n = text.length, S = 64;
  const cv = document.createElement('canvas'); cv.width = S; cv.height = S * n;
  const c = cv.getContext('2d', { willReadFrequently: true });
  c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = `900 ${S * 0.92}px ${KANJI_FONT}`;
  for (let i = 0; i < n; i++) c.fillText(text[i], S / 2, S * i + S / 2);
  const d = c.getImageData(0, 0, S, S * n).data, cov = new Float32Array(S * S * n);
  for (let i = 0; i < cov.length; i++) cov[i] = d[i * 4 + 3] / 255;
  return { w: S, h: S * n, cov };
}
function drawDecal(ov, rend, d) {
  const P0 = rend.project(d.c);
  if (!P0 || P0.x < -8 || P0.y < -8 || P0.x > ov.cols + 8 || P0.y > ov.rows + 8 || P0.d > 0.35) return;
  const Px = rend.project([d.c[0] + d.w / 2, d.c[1], d.c[2]]), Py = rend.project([d.c[0], d.c[1] + d.h / 2, d.c[2]]);
  if (!Px || !Py) return;
  const ax = Px.x - P0.x, ay = Px.y - P0.y, bx = Py.x - P0.x, by = Py.y - P0.y, det = ax * by - ay * bx;
  if (Math.abs(det) < 0.5) return;
  const ex = Math.abs(ax) + Math.abs(bx), ey = Math.abs(ay) + Math.abs(by);
  if (ex > ov.cols || ey > ov.rows) return;
  if (!d.bmp) d.bmp = rasterKanji(d.text);
  const B = d.bmp;
  const y0 = Math.max(0, Math.floor(P0.y - ey)), y1 = Math.min(ov.rows - 1, Math.ceil(P0.y + ey));
  const x0 = Math.max(0, Math.floor(P0.x - ex)), x1 = Math.min(ov.cols - 1, Math.ceil(P0.x + ex));
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
    let cov = 0;
    for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) {
      const dx = cx + (sx + 0.5) / 3 - P0.x, dy = cy + (sy + 0.5) / 3 - P0.y;
      const s = (dx * by - dy * bx) / det, t = (ax * dy - ay * dx) / det;
      if (s < -1 || s > 1 || t < -1 || t > 1) continue;
      cov += B.cov[Math.min(B.h - 1, Math.floor((1 - t) / 2 * B.h)) * B.w + Math.min(B.w - 1, Math.floor((s + 1) / 2 * B.w))];
    }
    cov /= 9;
    if (cov > 0.55) ov.put(cx, cy, '#', d.col, P0.d - 0.004, 2, 0);
    else if (cov > 0.3) ov.put(cx, cy, cov > 0.42 ? '%' : '+', [0.1, 0.015, 0.01], P0.d - 0.004, 0, 0);
  }
}
// overhead wires: sagging lines rasterised as / - \ | characters, depth-tested
function drawWires(ov, rend, wires) {
  for (const [a, b, sag] of wires) {
    const A = rend.project(a), B = rend.project(b);
    if (!A || !B) continue;
    if ((A.x < 0 && B.x < 0) || (A.x > ov.cols && B.x > ov.cols) || (A.y < 0 && B.y < 0) || (A.y > ov.rows && B.y > ov.rows)) continue;
    const n = Math.min(90, Math.ceil(Math.hypot(A.x - B.x, A.y - B.y) * 1.3) + 2);
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const t = i / n, p = V3.lerp(a, b, t); p[1] -= sag * 4 * t * (1 - t);
      const P = rend.project(p); if (!P) { prev = null; continue; }
      if (prev) {
        const dx = P.x - prev.x, dy = P.y - prev.y;
        const ch = Math.abs(dy) < Math.abs(dx) * 0.35 ? '-' : Math.abs(dx) < Math.abs(dy) * 0.35 ? '|' : (dx * dy > 0 ? '\\' : '/');
        ov.put(P.x, P.y, ch, [0.2, 0.22, 0.3], P.d, 0, 0);
      }
      prev = P;
    }
  }
}
function drawSigns(ov, rend, signs, t) {
  for (const s of signs) {
    const P0 = rend.project(s.p);
    if (!P0) continue;
    const P = { x: P0.x / 2, y: P0.y / 2, d: P0.d };
    if (P.d > 0.5 || P.x < -12 || P.x > ov.cols + 12 || P.y < -12 || P.y > ov.rows + 2) continue;
    let on = 1;
    if (s.flick) { const k = Math.sin(t * 31 + s.p[0]) * Math.sin(t * 17.3 + s.p[2]); if (k > 1 - s.flick * 2) on = 0.15; }
    const c = s.col.map(v => v * (0.55 + 0.45 * on)), g = (s.glow ?? 0.9) * on;
    if (s.v) for (let i = 0; i < s.text.length; i++) ov.put(P.x, P.y + i, s.text[i], c, P.d - 0.003, 0, g);
    else ov.text(Math.round(P.x - s.text.length / 2), P.y, s.text, c, P.d - 0.003, 0, g);
  }
}

// ── floating paper lanterns (tōrō nagashi) on the pond
function buildFloaters(M, list, t) {
  for (const f of list) {
    const bob = Math.sin(t * 1.3 + f.ph) * 0.03;
    M.push(M4.mul(M4.trans(f.x, 0.02 + bob, f.z), M4.rotY(f.ph + t * 0.05)));
    M.box(-0.24, 0, -0.24, 0.24, 0.07, 0.24, o3([0.25, 0.15, 0.08], MAT.WOOD));
    M.box(-0.19, 0.07, -0.19, 0.19, 0.5, 0.19, o3([1, 0.62, 0.3], MAT.PAPER, 0.95, PAT.SHOJI));
    M.box(-0.21, 0.5, -0.21, 0.21, 0.54, 0.21, o3([0.25, 0.15, 0.08], MAT.WOOD));
    M.pop();
  }
}

const GS = {
  state: 'boot', t: 0, busy: false, dialog: null, fortune: null, card: null, ending: null,
  rituals: [false, false, false], seen: {}, rainManual: null, flash: 0, flashCol: [1, 1, 1],
  finale: null, stick: { active: false }, keys: new Set(), btn: null, btnPressed: -9, hudRects: null,
  touch: matchMedia('(pointer: coarse)').matches, calm: matchMedia('(prefers-reduced-motion: reduce)').matches,
};
const waits = [];
const wait = s => new Promise(r => waits.push([GS.t + s, r]));
const say = lines => new Promise(r => { GS.dialog = { lines, t0: GS.t, resolve: r, typedLast: 0 }; });
const showFortune = f => new Promise(r => { GS.fortune = Object.assign({ t0: GS.t, resolve: r }, f); });
async function run(fn) { if (GS.busy) return; GS.busy = true; try { await fn(); } catch (e) { console.error(e); } GS.busy = false; }
const sfx = (n, o) => AU.sfx(n, o);

function zoneOf(x, z) {
  if (z > 31) return 'neon';
  if (z > 16) return 'avenue';
  if (z > 3) return 'gate';
  if (z > -34) return 'nakamise';
  if (z > -42) return 'hozomon';
  if (x < -9 && z < -48 && z > -72) return 'pagoda';
  if (x > 11 && z < -46 && z > -80) return 'pond';
  return 'temple';
}
function onBridge(x, z) { return x > 11.6 && x < 30.4 && Math.abs(z + 62) < 0.78; }
function surfaceAt(x, z, rain) {
  if (onBridge(x, z)) return 'wood';
  if ((z > 31 && Math.abs(x) < 3) || (z > 16.2 && z < 26.9)) return rain > 0.2 && Math.sin(x * 1.7) * Math.cos(z * 1.3) > 0.4 ? 'puddle' : 'asphalt';
  if (x > 10.5 && z < -45 && z > -80) return 'grass';
  if (z < -34 && Math.abs(x) > 14) return 'gravel';
  return 'stone';
}

async function boot() {
  const cv = document.getElementById('screen');
  try { await Promise.race([document.fonts.load('500 20px "M PLUS 1 Code"'), new Promise(r => setTimeout(r, 1800))]); } catch (e) { }
  const rend = new Renderer(cv);
  rend.moon = V3.norm([-0.3, 0.62, -0.72]);
  const fogBase = [0.05, 0.03, 0.075], ambTop = [0.06, 0.07, 0.14], ambBot = [0.03, 0.025, 0.04];
  rend.fogC = fogBase.slice(); rend.ambTop = ambTop.slice(); rend.ambBot = ambBot.slice();
  if (GS.touch) UI.TEXT.title.hint = '';
  const world = buildWorld();
  rend.uploadChunked(world.mesh);
  const playerObj = rend.upload(new Mesh(), true), catObj = rend.upload(new Mesh(), true), floatObj = rend.upload(new Mesh(), true);
  const ov = new Overlay(), ui = new Overlay(), fx = new FX();
  const A = world.anchors;
  const player = { x: 0.4, z: 64, vx: 0, vz: 0, face: Math.PI, walk: 0, amp: 0, y: 0 };
  const cat = { x: -2.6, z: -31.5, face: 0.6, walk: 0, amp: 0, follow: false, tx: -2.6, tz: -31.5, idle: 0 };
  const floaters = [];
  for (let i = 0; i < 6; i++) { const a = i * 1.1, r = 0.55; floaters.push({ x: POND.cx + Math.cos(a) * POND.rx * r, z: POND.cz + Math.sin(a) * POND.rz * r, vx: 0, vz: 0, ph: i * 2.3 }); }
  const koi = [];
  for (let i = 0; i < 9; i++) { const a = Math.random() * 6.28, r = Math.random() * 0.6; koi.push({ x: POND.cx + Math.cos(a) * POND.rx * r, z: POND.cz + Math.sin(a) * POND.rz * r, a: Math.random() * 6.28, sp: 0.5 + Math.random() * 0.4, col: [[1, 0.42, 0.1], [0.95, 0.93, 0.88], [1, 0.75, 0.25], [1, 0.3, 0.12]][i % 4] }); }
  if (typeof GARDEN_POOL !== 'undefined') for (let i = 0; i < 3; i++) koi.push({ x: GARDEN_POOL.cx, z: GARDEN_POOL.cz + (i - 1) * 2, a: i * 2, sp: 0.4, col: [[1, 0.5, 0.15], [0.95, 0.93, 0.88], [1, 0.75, 0.25]][i] });
  let camT = [player.x, 1, player.z - 9];
  Object.assign(Game, { rend, world, ov, ui, fx, player, cat, G: GS, koi, floaters, start: () => start(), teleport(x, z) { player.x = x; player.z = z; camT = [x, 1, z - 9]; }, finale: () => startFinale(), act: () => act(), advance: () => advance() });

  // ── sizing
  function resize() {
    const w = innerWidth, h = innerHeight, dpr = Math.min(devicePixelRatio || 1, 3);
    // fine scene cells: half the size of the text cells (2× detail on each axis)
    const cellH = clamp(Math.min(h, w * 1.7) / 156, 4.2, 8) * (GS.coarse || 1);
    rend.resize(w, h, dpr, cellH, FONT_STACK);
    ov.resize(rend.cols, rend.rows);
    ui.resize(rend.uiCols, rend.uiRows);
  }
  resize(); addEventListener('resize', resize);
  const cellOf = e => {
    const dpr = rend.dpr, top = rend.H - rend.off[1] - rend.rows * rend.cellPx[1];
    return [(e.clientX * dpr - rend.off[0]) / (rend.cellPx[0] * 2), (e.clientY * dpr - top) / (rend.cellPx[1] * 2)];
  };
  const inRect = (c, r) => r && c[0] >= r[0] - 0.5 && c[0] <= r[0] + r[2] + 0.5 && c[1] >= r[1] - 0.5 && c[1] <= r[1] + r[3] + 0.5;

  // ── interactions
  const ints = [
    { id: 'vending', p: [-3.3, 0, 33.4], r: 1.8, label: UI.TEXT.prompts.vending, act: async () => { sfx('vend', { x: -3.9, z: 33 }); await wait(1.4); sfx('can'); await say(UI.lines('vending')); } },
    { id: 'kaminarimon', p: [0, 0, 11.4], r: 2.6, label: UI.TEXT.prompts.look, act: () => lookAt([1.6, 1.7, 25], [0, 6.4, 8], 'kaminarimon') },
    { id: 'hozomon', p: [0, 0, -34.6], r: 2.2, label: UI.TEXT.prompts.look, act: () => lookAt([1.4, 1.7, -24], [0, 6.2, -38.5], 'hozomon') },
    { id: 'pagoda', p: [-11.5, 0, -57], r: 2.4, label: UI.TEXT.prompts.look, act: () => lookAt([-2.5, 2.4, -44.5], [-17, 11.5, -60], 'pagoda') },
    { id: 'temizu', p: A.temizu, r: 2.0, label: UI.TEXT.prompts.temizu, act: async () => { sfx('water_ladle', { x: A.temizu[0], z: A.temizu[2] - 1.5 }); await say(UI.lines('temizu')); } },
    {
      id: 'incense', p: A.incense, r: 3.7, label: UI.TEXT.prompts.incense, act: async () => {
        sfx('incense', { x: A.incense[0], z: A.incense[2] }); GS.smokeBoost = 3.5;
        await wait(0.9); await say(UI.lines('incense')); completeRitual(0);
      }
    },
    {
      id: 'pray', p: A.pray, r: 2.4, label: UI.TEXT.prompts.pray, act: async () => {
        player.face = Math.PI; sfx('coin', { x: 0, z: -76.6 }); await wait(0.9); sfx('bow'); await wait(0.6); sfx('rin');
        await say(UI.lines('prayer')); completeRitual(1);
      }
    },
    {
      id: 'omikuji', p: A.omikuji, r: 2.2, label: UI.TEXT.prompts.omikuji, act: async () => {
        sfx('omikuji', { x: 9, z: -73 }); await say(UI.lines('omikuji_shake'));
        const f = UI.drawFortune(); sfx('paper'); await wait(0.3); sfx(f.kyo ? 'fortune_bad' : 'fortune_good');
        await showFortune(f); completeRitual(2);
      }
    },
    {
      id: 'lantern', p: A.pondShore, r: 2.4, label: UI.TEXT.prompts.lantern, act: async () => {
        sfx('lantern', { x: A.pondShore[0] + 1, z: A.pondShore[2] });
        if (floaters.length > 16) floaters.shift();
        floaters.push({ x: A.pondShore[0] + 1.6, z: A.pondShore[2], vx: 0.45, vz: -0.05, ph: Math.random() * 6 });
        fx.addRipple(A.pondShore[0] + 1.6, A.pondShore[2], 1);
        if (!GS.seen.lantern) { GS.seen.lantern = 1; await say(UI.lines('lantern')); } else await wait(0.6);
      }
    },
    {
      id: 'koi', p: [21, 0, -62], r: 1.8, label: UI.TEXT.prompts.koi, act: async () => {
        GS.koiCall = [21, -60.4, GS.t + 6]; await wait(1.2); sfx('splash', { x: 21, z: -60.4 }); fx.addRipple(21, -60.4, 1.2);
        await say(UI.lines('koi'));
      }
    },
    {
      id: 'cat', p: null, r: 1.7, label: UI.TEXT.prompts.cat, act: async () => {
        sfx('meow', { x: cat.x, z: cat.z }); cat.follow = true; await wait(0.4); sfx('purr', { x: cat.x, z: cat.z }); await say(UI.lines('cat'));
      }
    },
  ];
  // "look": the camera leaves the player and frames the monument from below for the length of the text
  async function lookAt(pos, tgt, key) {
    sfx('select'); GS.lookCam = { pos, tgt };
    await wait(1.2); await say(UI.lines(key));
    GS.lookCam = null;
  }
  function nearest() {
    let best = null, bd = 1e9;
    for (const it of ints) {
      const p = it.id === 'cat' ? [cat.x, 0, cat.z] : it.p;
      if (!p) continue;
      const d = Math.hypot(player.x - p[0], player.z - p[2]);
      if (d < it.r && d < bd) { bd = d; best = it; }
    }
    return best;
  }
  function act() {
    if (GS.state !== 'play' || GS.busy || (GS.finale && GS.finale.cine)) return;
    const it = nearest(); if (!it) return;
    player.vx = player.vz = 0;
    run(it.act);
  }
  function completeRitual(i) {
    if (GS.rituals[i]) return;
    GS.rituals[i] = true; sfx('quest');
    if (GS.rituals.every(Boolean) && !GS.finale) setTimeout(() => startFinale(), 2600);
  }
  function advance() {
    if (GS.fortune) { if (GS.t - GS.fortune.t0 > 0.7) { const r = GS.fortune.resolve; GS.fortune = null; sfx('select'); r(); } return true; }
    if (GS.dialog) { const d = GS.dialog; if (!d.done) d.skip = true; else { GS.dialog = null; sfx('select'); d.resolve(); } return true; }
    if (GS.ending) { if (GS.t - GS.ending.t0 > 3) { GS.ending = null; GS.finale.cine = false; sfx('back'); } return true; }
    return false;
  }

  // ── finale: three rituals → hanabi over the river, seen across the pond
  const SKY_DIR = [Math.sin(0.34), 0, -Math.cos(0.34)];
  const FW_COLS = [[1, 0.35, 0.18], [1, 0.8, 0.35], [0.45, 0.85, 1], [1, 0.55, 0.85], [0.95, 0.95, 1], [0.6, 1, 0.55]];
  function startFinale() {
    if (GS.finale) return;
    if (GS.busy || GS.dialog || GS.fortune) { setTimeout(startFinale, 1000); return; }
    GS.finale = { t0: GS.t, cine: true, next: GS.t + 1.8, k: 0 };
    GS.stick = { active: false };
    run(async () => {
      await wait(6); await say(UI.lines('finale').slice(0, 2));
      await wait(8); await say(UI.lines('finale').slice(2));
      await wait(6); GS.ending = { t0: GS.t };
    });
  }
  function launch(intensity) {
    const R = Math.random, D = 120 + R() * 50, lat = (R() - 0.5) * 70;
    const base = [21 + SKY_DIR[0] * D - SKY_DIR[2] * lat * 0.5, 0, -62 + SKY_DIR[2] * D + SKY_DIR[0] * lat * 0.5];
    const at = [base[0] + (R() - 0.5) * 20, 42 + R() * 36, base[2] + (R() - 0.5) * 20];
    const col = FW_COLS[(R() * FW_COLS.length) | 0], type = R() < 0.18 ? 2 : R() < 0.35 ? 3 : R() < 0.6 ? 1 : 0;
    sfx('firework_launch', { vol: 0.5 * intensity });
    fx.firework([base[0], 0, base[2]], at, col, type, () => {
      GS.flash = Math.max(GS.flash, 0.5 * intensity); GS.flashCol = col;
      setTimeout(() => { sfx('firework_boom', { vol: 0.75 * intensity }); if (type === 1 || type === 2) setTimeout(() => sfx('crackle', { vol: 0.6 * intensity }), 500); }, 420);
    });
  }

  // ── start / title
  function start() {
    if (GS.state !== 'title') return;
    GS.state = 'intro'; GS.introT0 = GS.t;
    AU.init().then(() => sfx('title'));
    run(async () => { await wait(1.2); GS.state = 'play'; await say(UI.TEXT.intro); });
  }

  // ── input: floating joystick anywhere, action button, HUD buttons, tap to advance text
  const onDown = e => {
    if (e.pointerType === 'mouse') AU.init();
    if (GS.state === 'title') return;
    if (GS.state !== 'play') return;
    const c = cellOf(e);
    if (GS.hudRects && inRect(c, GS.hudRects.rain)) { toggleRain(); return; }
    if (GS.hudRects && inRect(c, GS.hudRects.sound)) { toggleSound(); return; }
    if (advance()) return;
    if (GS.btn && inRect(c, GS.btn)) { GS.btnPressed = GS.t; act(); return; }
    if (!GS.stick.active && !GS.busy) GS.stick = { active: true, id: e.pointerId, ox: c[0], oy: c[1], kx: c[0], ky: c[1], vx: 0, vy: 0 };
  };
  const onMove = e => {
    const s = GS.stick; if (!s.active || s.id !== e.pointerId) return;
    const c = cellOf(e); let dx = (c[0] - s.ox) / 7, dy = (c[1] - s.oy) / 3.85;
    const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
    s.kx = s.ox + dx * 7; s.ky = s.oy + dy * 3.85; s.vx = dx; s.vy = dy;
  };
  const onUp = e => {
    AU.init();
    if (GS.state === 'title') { start(); return; }
    if (GS.stick.id === e.pointerId) GS.stick = { active: false };
  };
  cv.addEventListener('pointerdown', e => { e.preventDefault(); try { cv.setPointerCapture(e.pointerId); } catch (_) { } onDown(e); });
  cv.addEventListener('pointermove', e => { e.preventDefault(); onMove(e); });
  cv.addEventListener('pointerup', onUp); cv.addEventListener('pointercancel', e => { if (GS.stick.id === e.pointerId) GS.stick = { active: false }; });
  addEventListener('touchend', () => AU.init(), { passive: true });
  addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    AU.init();
    if (GS.state === 'title') { start(); return; }
    if (['e', ' ', 'enter'].includes(k)) { e.preventDefault(); if (!advance()) act(); return; }
    if (k === 'r') toggleRain();
    if (k === 'm') toggleSound();
    GS.keys.add(k);
  });
  addEventListener('keyup', e => GS.keys.delete(e.key.toLowerCase()));
  addEventListener('blur', () => { GS.keys.clear(); GS.stick = { active: false }; });
  function toggleRain() { const on = rend.params.rain > 0.15; GS.rainManual = on ? 0 : 0.55; sfx('select'); }
  function toggleSound() { const m = !AU.isMuted(); AU.setMuted(m); if (!m) sfx('select'); }

  // ── collisions
  const cols = world.colliders;
  function blocked(x, z) {
    if (x < -31 || x > 36 || z < -97 || z > 71) return true;
    if (isWater(x, z) && !onBridge(x, z)) return true;
    const r = 0.32;
    for (const c of cols) if (x > c[0] - r && x < c[2] + r && z > c[1] - r && z < c[3] + r) return true;
    return false;
  }

  // ── main loop
  let last = performance.now(), fpsAcc = 0, fpsN = 0, lastZone = null, boltT = 14, crossT = 0;
  window.__perf = {};
  GS.state = 'title'; rend.params.reveal = 0;

  function frame(now) {
    const rdt = (now - last) / 1000, dt = Math.min(GS.maxDt || 0.05, Math.max(0, rdt)); last = now;
    GS.t += dt; const t = GS.t; rend.time = t;
    if (GS.state === 'play' && !GS.coarse) {
      GS.qAcc = (GS.qAcc || 0) + rdt; GS.qN = (GS.qN || 0) + 1;
      if (GS.qAcc > 4) { if (GS.qN / GS.qAcc < 28 && !GS.noAdapt) { GS.coarse = 1.4; resize(); } GS.qAcc = 0; GS.qN = 0; }
    }
    fpsAcc += rdt; fpsN++; if (fpsAcc > 1) { window.__perf = { fps: +(fpsN / fpsAcc).toFixed(1), cols: rend.cols, rows: rend.rows, ui: [rend.uiCols, rend.uiRows], cell: rend.cellPx, gbuf: [rend.gw, rend.gh], state: GS.state, js: +(GS.jsMs || 0).toFixed(2), x: +player.x.toFixed(1), z: +player.z.toFixed(1) }; fpsAcc = 0; fpsN = 0; }
    for (let i = waits.length - 1; i >= 0; i--) if (t >= waits[i][0]) { const r = waits[i][1]; waits.splice(i, 1); r(); }
    rend.params.reveal = Math.min(1, rend.params.reveal + Math.min(rdt, 0.1) / 2.6);
    const cine = !!(GS.finale && GS.finale.cine);

    // ── movement
    let mx = 0, mz = 0;
    if (GS.state === 'play' && !GS.busy && !cine) {
      if (GS.stick.active && GS.stick.vx !== undefined) { mx = GS.stick.vx; mz = GS.stick.vy; }
      const K = GS.keys;
      if (K.has('a') || K.has('arrowleft') || K.has('q')) mx -= 1;
      if (K.has('d') || K.has('arrowright')) mx += 1;
      if (K.has('w') || K.has('arrowup') || K.has('z')) mz -= 1;
      if (K.has('s') || K.has('arrowdown')) mz += 1;
    }
    const ml = Math.hypot(mx, mz); if (ml > 1) { mx /= ml; mz /= ml; }
    const dead = ml < 0.12 ? 0 : 1, sp = 4.4;
    player.vx = damp(player.vx, mx * sp * dead, 10, dt); player.vz = damp(player.vz, mz * sp * dead, 10, dt);
    const nx = player.x + player.vx * dt, nz = player.z + player.vz * dt;
    if (!blocked(nx, player.z)) player.x = nx; else player.vx *= 0.3;
    if (!blocked(player.x, nz)) player.z = nz; else player.vz *= 0.3;
    const speed = Math.hypot(player.vx, player.vz);
    if (speed > 0.3) { const want = Math.atan2(player.vx, player.vz); player.face += Math.atan2(Math.sin(want - player.face), Math.cos(want - player.face)) * Math.min(1, dt * 12); }
    player.amp = damp(player.amp, Math.min(1, speed / 3.5), 8, dt);
    const ph0 = player.walk; player.walk += speed * dt * 2.7;
    if (Math.floor(player.walk / Math.PI) !== Math.floor(ph0 / Math.PI) && speed > 0.8) AU.step(surfaceAt(player.x, player.z, rend.params.rain));
    player.y = onBridge(player.x, player.z) ? bridgeY(player.x, player.z) : 0;

    // ── weather: rain over the city, easing as you reach the temple (unless toggled)
    const autoRain = player.z > 8 ? 0.5 : player.z > -30 ? 0.5 * (player.z + 30) / 38 : 0;
    const rainT = GS.rainManual !== null ? GS.rainManual : autoRain;
    rend.params.rain = damp(rend.params.rain, rainT, 0.8, dt);
    rend.params.wet = 0.35 + rend.params.rain * 0.8;
    // lightning while it pours: the Thunder Gate earns its name
    if (rend.params.rain > 0.3 && GS.state === 'play') { boltT -= dt; if (boltT < 0) { boltT = 18 + Math.random() * 22; GS.flash = 1; GS.flashCol = [0.72, 0.78, 1]; GS.bolt = t; setTimeout(() => sfx('thunder', { vol: 0.8 }), 1200 + Math.random() * 1500); } }
    GS.flash = Math.max(0, GS.flash - dt * (GS.bolt && t - GS.bolt < 0.6 ? 3.5 : 1.5));
    const fl = GS.flash * (GS.calm ? 0.4 : GS.bolt && t - GS.bolt < 0.6 ? (0.55 + 0.45 * Math.sign(Math.sin(t * 47))) : 1);
    for (let i = 0; i < 3; i++) { rend.ambTop[i] = ambTop[i] + GS.flashCol[i] * fl * 0.6; rend.ambBot[i] = ambBot[i] + GS.flashCol[i] * fl * 0.25; rend.fogC[i] = fogBase[i] + GS.flashCol[i] * fl * 0.12; }

    // ── cat
    {
      let tx = cat.tx, tz = cat.tz;
      if (cat.follow) { const d = Math.hypot(player.x - cat.x, player.z - cat.z); if (d > 2.2) { tx = player.x + 0.9; tz = player.z + 1.1; } else { tx = cat.x; tz = cat.z; } }
      else { cat.idle -= dt; if (cat.idle < 0) { cat.idle = 3 + Math.random() * 5; cat.tx = -2.6 + (Math.random() - 0.5) * 4; cat.tz = -31 - Math.random() * 4; } tx = cat.tx; tz = cat.tz; }
      const dx = tx - cat.x, dz = tz - cat.z, d = Math.hypot(dx, dz), csp = Math.min(cat.follow ? 5.2 : 1.2, d * 2);
      if (d > 0.15) { const vx = dx / d * csp, vz = dz / d * csp; if (!blocked(cat.x + vx * dt, cat.z + vz * dt)) { cat.x += vx * dt; cat.z += vz * dt; } cat.face = Math.atan2(vx, vz); }
      cat.amp = damp(cat.amp, d > 0.15 ? Math.min(1, csp / 2) : 0, 6, dt); cat.walk += csp * dt * 5;
    }
    // ── koi wander inside the water; feeding pulls them in
    const calling = GS.koiCall && t < GS.koiCall[2];
    for (const k of koi) {
      k.a += Math.sin(t * 0.7 + k.sp * 9) * 0.6 * dt;
      if (calling) { const want = Math.atan2(GS.koiCall[1] - k.z, GS.koiCall[0] - k.x); k.a += Math.atan2(Math.sin(want - k.a), Math.cos(want - k.a)) * dt * 2.2; }
      const v = k.sp * (calling ? 1.8 : 1);
      const nx2 = k.x + Math.cos(k.a) * v * dt, nz2 = k.z + Math.sin(k.a) * v * dt;
      if (isWater(nx2, nz2) && isWater(nx2 + Math.cos(k.a) * 0.8, nz2 + Math.sin(k.a) * 0.8)) { k.x = nx2; k.z = nz2; } else k.a += 2.4 * dt + 0.2;
      if (Math.random() < dt * 0.02) { fx.addRipple(k.x, k.z, 0.5); if (Math.hypot(k.x - player.x, k.z - player.z) < 10) sfx('splash', { x: k.x, z: k.z, vol: 0.4 }); }
    }
    // ── floating lanterns drift
    for (const f of floaters) {
      f.vx += (Math.sin(t * 0.21 + f.ph) * 0.04 - f.vx * 0.15) * dt; f.vz += (Math.cos(t * 0.17 + f.ph * 1.7) * 0.04 - f.vz * 0.15) * dt;
      const nx3 = f.x + f.vx * dt, nz3 = f.z + f.vz * dt;
      if (isWater(nx3, nz3) && !(Math.abs(nz3 + 62) < 1.4 && nx3 > 12 && nx3 < 30)) { f.x = nx3; f.z = nz3; } else { f.vx = -f.vx; f.vz = -f.vz; }
    }

    // ── camera: follow (behind/above, looking north), title drift, or the finale's view across the pond
    const look = [player.x + player.vx * 0.35, 1 + player.y * 0.6, player.z - 9 + player.vz * 0.45];
    camT = [damp(camT[0], look[0], 3, dt), damp(camT[1], look[1], 3, dt), damp(camT[2], look[2], 3, dt)];
    const sway = GS.calm ? [0, 0, 0] : [Math.sin(t * 0.13) * 0.5, Math.sin(t * 0.21) * 0.25, 0];
    let cpos, ctgt;
    if (GS.state === 'title' || GS.state === 'intro') {
      const k = GS.state === 'intro' ? smooth(0, 1.2, t - GS.introT0) : 0;
      const tp = [player.x, 1, player.z - 9], cp = [tp[0] + sway[0], tp[1] + 12.5 + sway[1], tp[2] + 19.5];
      const tt = [Math.sin(t * 0.07) * 1.5, 8.5, player.z - 44], ct = [Math.sin(t * 0.07) * 1.5 + 0.5, 3.0, player.z - 3.5];
      ctgt = V3.lerp(tt, tp, k); cpos = V3.lerp(ct, cp, k);
    } else {
      ctgt = camT.slice(); cpos = [camT[0] + sway[0], camT[1] + 12.5 + sway[1], camT[2] + 19.5];
    }
    GS.lookK = damp(GS.lookK || 0, GS.lookCam ? 1 : 0, 1.6, dt);
    if (GS.lookCam) GS.lastLook = GS.lookCam;
    if (GS.lookK > 0.001 && GS.lastLook) {
      const lk = smooth(0, 1, GS.lookK);
      cpos = V3.lerp(cpos, V3.add(GS.lastLook.pos, [Math.sin(t * 0.3) * 0.3, 0, 0]), lk); ctgt = V3.lerp(ctgt, GS.lastLook.tgt, lk);
    }
    if (GS.finale) {
      GS.finale.k = damp(GS.finale.k, cine ? 1 : 0, 0.9, dt);
      const fk = smooth(0, 1, GS.finale.k);
      const sp0 = [14.6 + Math.sin(t * 0.2) * 0.6, 8, -45.2], st0 = V3.add(sp0, [SKY_DIR[0] * 30, 1.2, SKY_DIR[2] * 30]);
      cpos = V3.lerp(cpos, sp0, fk); ctgt = V3.lerp(ctgt, st0, fk);
      if (t > GS.finale.next) { launch(cine ? 1 : 0.55); GS.finale.next = t + (cine ? 0.6 + Math.random() * 1.2 : 4 + Math.random() * 6); }
    }
    rend.setCamera(cpos, ctgt, 1.02);
    rend.occ = (GS.state === 'play' && !cine && GS.lookK < 0.3) ? [player.x, 1.3 + player.y, player.z, 2.3] : [0, 0, 0, 0];

    // ── lights
    const showDim = GS.finale ? 1 - 0.62 * smooth(0, 1, GS.finale.k) : 1;   // the precinct dims for the show
    for (const l of world.lights) l.i = showDim * l.base * (1 - l.flick * (0.5 + 0.5 * Math.sin(t * 13 + l.p[0] * 3) * Math.sin(t * 7.7 + l.p[2])));
    const dynL = [{ p: [player.x + 0.42 * Math.sin(player.face - 1.57), 0.9 + player.y, player.z + 0.42 * Math.cos(player.face - 1.57)], c: [1, 0.6, 0.25], r: 6, i: 1.15 * (0.92 + 0.08 * Math.sin(t * 17)) }];
    for (const f of floaters) dynL.push({ p: [f.x, 0.6, f.z], c: [1, 0.6, 0.3], r: 4, i: 0.75 });
    if (GS.smokeBoost) GS.smokeBoost = Math.max(0, GS.smokeBoost - dt * 0.5);
    rend.setLights(world.lights.concat(dynL));

    // ── dynamic meshes
    const gl = rend.gl, putMesh = (obj, M, model) => { gl.bindBuffer(gl.ARRAY_BUFFER, obj.vbo); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(M.d), gl.DYNAMIC_DRAW); obj.count = M.count; obj.model = model; };
    { const M = new Mesh(); buildPlayer(M, { walk: player.walk, amp: player.amp, umbrella: rend.params.rain > 0.12 ? 1 : 0, lantern: true }); putMesh(playerObj, M, M4.mul(M4.trans(player.x, player.y, player.z), M4.rotY(player.face))); }
    { const M = new Mesh(); buildCat(M, { walk: cat.walk, amp: cat.amp, t }); putMesh(catObj, M, M4.mul(M4.trans(cat.x, 0, cat.z), M4.rotY(cat.face))); }
    { const M = new Mesh(); buildFloaters(M, floaters, t); putMesh(floatObj, M, M4.ident()); }

    // ── particles
    fx.update(dt, t, { center: [player.x, 0, player.z], rain: rend.params.rain, leaves: rend.params.rain > 0.3 ? 0.3 : 1, trees: world.trees, wind: -0.4, isWater });
    if (A.smoke) fx.smoke(A.smoke, 7 + (GS.smokeBoost || 0) * 10, dt, GS.smokeBoost > 0.5 ? [player.x, 1.5, player.z] : null);
    fx.writeRipples(rend.rip);

    // ── zones: location cards and ambient cues
    const zone = zoneOf(player.x, player.z);
    if (GS.state === 'play' && zone !== lastZone && !GS.busy) {
      lastZone = zone;
      if (!GS.seen['card_' + zone]) {
        GS.seen['card_' + zone] = 1;
        const c = UI.TEXT.cards[zone]; if (c) { GS.card = { title: c.title, sub: c.sub, t0: t }; sfx('gate'); }
        if ((zone === 'temple' || zone === 'pagoda' || zone === 'pond') && !GS.seen.templeTale) { GS.seen.templeTale = 1; run(async () => { await wait(3.4); await say(UI.lines('temple')); }); }
      }
    }
    if (zone === 'avenue' && GS.state === 'play') { crossT -= dt; if (crossT < 0) { crossT = 7; sfx('crossing', { x: 0, z: 21 }); } } else crossT = 0.5;
    if (!GS.seen.door && player.x > 2 && player.z > 32 && player.z < 37) { GS.seen.door = 1; sfx('door', { x: 4.6, z: 34.5 }); }

    // ── audio mix
    const pondNear = 1 - Math.min(1, Math.hypot((player.x - POND.cx) / (POND.rx + 8), (player.z - POND.cz) / (POND.rz + 8)));
    const basinNear = 1 - Math.min(1, Math.hypot(player.x - A.temizu[0], player.z - A.temizu[2] + 2) / 6);
    AU.update(dt, { zone: smooth(10, -14, player.z), rain: rend.params.rain, water: clamp(Math.max(pondNear * 1.4, basinNear), 0, 1), crowd: player.z > 31 ? 0.5 : 0.1, festival: GS.finale ? (cine ? 1 : 0.3) : 0, px: player.x, pz: player.z });

    // ── overlay: world text, particles, koi, name tag, then UI
    ov.clear();
    drawWires(ov, rend, world.wires);
    ui.clear();
    drawSigns(ui, rend, world.signs, t);
    for (const d of world.decals) drawDecal(ov, rend, d);
    fx.draw(ov, rend, t);
    for (const k of koi) {
      const s = rend.project([k.x, -0.1, k.z]); if (!s || s.d > 0.4) continue;
      const right = Math.cos(k.a) > 0, str = right ? '><>' : '<><', x0 = Math.round(s.x) - 1;
      for (let i = 0; i < 3; i++) ov.put(x0 + i, s.y, str[i], k.col.map(v => v * (i === (right ? 2 : 0) ? 0.85 : 0.65)), 0, 5, 0.12);
    }
    if (GS.state === 'play' && !cine && GS.lookK < 0.2) {
      const head = rend.project([player.x, 2.75 + player.y, player.z]);
      if (head) ui.text(Math.round(head.x / 2 - 4), Math.round(head.y / 2), 'tabibito', [0.58, 0.58, 0.64], 0, 1, 0.05);
    }

    // ── UI
    if (GS.state === 'title' || (GS.state === 'intro' && t - GS.introT0 < 1.2)) {
      const a = GS.state === 'title' ? smooth(0.8, 2.6, t) : 1 - smooth(0, 1, t - GS.introT0);
      UI.title(ui, t, a, 0.9);
    }
    if (GS.state === 'play') {
      if (!cine) {
        GS.hudRects = UI.hud(ui, { rituals: UI.TEXT.rituals.map((l, i) => ({ label: l, done: GS.rituals[i] })), rain: rend.params.rain > 0.15, sound: !AU.isMuted(), t, alpha: 1 });
        const it = !GS.busy && !GS.dialog ? nearest() : null;
        if (it) {
          const s = rend.project(it.id === 'cat' ? [cat.x, 1.0, cat.z] : [it.p[0], 1.6, it.p[2]]);
          if (s) UI.prompt(ui, s.x / 2, s.y / 2, it.label, t, GS.touch ? undefined : 'E');
        }
        GS.btn = GS.touch ? UI.button(ui, { visible: !!it, label: it ? it.label : '', pressed: t - GS.btnPressed < 0.18, t }) : null;
        if (GS.touch && !GS.busy && !GS.dialog) {
          const Lo = UI.layout(ui);
          UI.stick(ui, GS.stick.active ? GS.stick : { active: false, ox: Lo.stick[0], oy: Lo.stick[1], kx: Lo.stick[0], ky: Lo.stick[1] });
        }
      } else { GS.hudRects = null; GS.btn = null; }
      if (GS.card && !UI.card(ui, t, GS.card)) GS.card = null;
    }
    if (GS.dialog) {
      const r = UI.dialog(ui, t, GS.dialog);
      GS.dialog.done = r.done;
      if (r.typed > GS.dialog.typedLast + 1) { GS.dialog.typedLast = r.typed; sfx('blip'); }
    }
    if (GS.fortune) UI.fortune(ui, t, GS.fortune);
    if (GS.ending) UI.end(ui, t, GS.ending.t0);

    const tj = performance.now(); GS.jsMs = damp(GS.jsMs || 0, tj - now, 4, dt);
    rend.render(ov, ui);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
const Game = {};
boot().catch(e => { console.error(e); document.body.insertAdjacentHTML('beforeend', '<pre style="position:fixed;left:16px;right:16px;bottom:16px;color:#f88;font:12px monospace;white-space:pre-wrap">' + String(e.message || e) + '</pre>'); });
