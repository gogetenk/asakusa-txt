// ───────────────────────── temple grounds: Hozomon → Senso-ji → pagoda → pond ─────────────────────────
// Everything north of the Nakamise (z < −34). The follow camera sits 13.5 m up and the top edge of the
// view dips 3.4° below the horizon, so nothing higher than ≈ 11–12 m is ever seen directly: the upper
// tiers of the pagoda and the hall's ridge only exist in reflections. A reflection of height H at z_o lands
// on the water at z_w = (H·z_c + 13.5·z_o) / (H + 13.5) (z_c = camera z = player z + 10.5), so the whole
// 25 m pagoda, silhouetted against the mirrored starry sky, needs water reaching ~13 m south of it: hence
// the long reflecting pool in front of it (the big pond is far too east to ever mirror it).
// Any surface at y ≥ −0.02 is also drawn in the mirror pass and would hide what is reflected behind it,
// so water and all walkable ground sit a few cm below 0.
const POND = { cx: 21, cz: -62, rx: 8, rz: 11 };
const GARDEN_POOL = { cx: -17.75, cz: -46.2, rx: 4.3, rz: 7.4, p: 4 };
const ISLET = { cx: 24.6, cz: -55.4, rx: 2.3, rz: 1.5 };              // nakajima in the south-east of the pond    // superellipse |u|^p + |v|^p < 1
function isWater(x, z) {
  const G = GARDEN_POOL;
  return (((x - POND.cx) / POND.rx) ** 2 + ((z - POND.cz) / POND.rz) ** 2 < 1 && ((x - ISLET.cx) / ISLET.rx) ** 2 + ((z - ISLET.cz) / ISLET.rz) ** 2 > 1)
    || Math.abs((x - G.cx) / G.rx) ** G.p + Math.abs((z - G.cz) / G.rz) ** G.p < 1;
}
function bridgeY(x, z) { return (x > 12 && x < 30 && Math.abs(z + 62) < 0.8) ? 1.4 * Math.sin(Math.PI * (x - 12) / 18) : 0; }

function buildTemple(M, k) {
  const { o, L, solid, signs, decals, wires, trees, anchors, R, COL } = k;
  const V = V3, TAU = Math.PI * 2;
  // temple palette on top of the world palette
  const C = {
    verm: COL.verm, vermD: COL.vermD, roof: COL.roof, cap: COL.roofCap, black: COL.black, gold: COL.gold,
    wood: COL.wood, woodD: COL.woodD, plaster: COL.plaster, white: [0.74, 0.71, 0.64], lantern: COL.lantern,
    stone: COL.stone, stoneL: [0.36, 0.34, 0.31], stoneD: [0.15, 0.14, 0.13], gravel: [0.25, 0.23, 0.2],
    bronze: [0.2, 0.4, 0.33], bronzeD: [0.1, 0.18, 0.15], straw: [0.66, 0.53, 0.3], grass: [0.06, 0.14, 0.05],
    bark: [0.12, 0.08, 0.06], ridge: [0.3, 0.32, 0.38],
  };
  const WARM = [1, 0.56, 0.26], RED = [1, 0.32, 0.12], EMBER = [1, 0.42, 0.12], FLOOD = [1, 0.6, 0.32];
  const tiles = o([0.25, 0.27, 0.34], MAT.ROOF, 0.06, PAT.TILES);   // faint moonlit sheen: the south slopes face away from the moon
  const pillar = o(C.verm, MAT.WOOD, 0, PAT.PLANKS);           // upright lacquer → | strokes
  const lac = o(C.verm, MAT.METAL), lacD = o(C.vermD, MAT.METAL); // horizontal lacquer beams → - = strokes
  const gold = o(C.gold, MAT.METAL, 0.25), blackM = o([0.04, 0.035, 0.03], MAT.METAL);
  const pave = o(C.stone, MAT.STONE, 0, PAT.PAVING);
  const bark = o(C.bark, MAT.WOOD);
  const v0 = M.count;

  // ───────── helpers ─────────
  // prism between two points with a w×h cross-section (rails, sloped beams)
  function beam(a, b, w, h, opt) {
    const d = V.sub(b, a), s = V.mul(V.norm([-d[2], 0, d[0]]), w / 2), u = [0, h / 2, 0];
    const p = (q, ss, uu) => V.add(V.add(q, V.mul(s, ss)), V.mul(u, uu));
    M.quadF(p(a, 1, 1), p(b, 1, 1), p(b, -1, 1), p(a, -1, 1), opt, [0, 1, 0]);
    M.quadF(p(a, 1, -1), p(b, 1, -1), p(b, -1, -1), p(a, -1, -1), opt, [0, -1, 0]);
    M.quadF(p(a, 1, -1), p(b, 1, -1), p(b, 1, 1), p(a, 1, 1), opt, s);
    M.quadF(p(a, -1, -1), p(b, -1, -1), p(b, -1, 1), p(a, -1, 1), opt, V.mul(s, -1));
  }
  // tapered n-gon tube between two points (limbs, legs)
  function tube(a, b, r0, r1, opt, seg = 5) {
    const d = V.norm(V.sub(b, a)), ref = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = V.norm(V.cross(d, ref)), w = V.cross(d, u);
    const q = (ang, r, p) => V.add(p, V.add(V.mul(u, Math.cos(ang) * r), V.mul(w, Math.sin(ang) * r)));
    for (let i = 0; i < seg; i++) {
      const a0 = i / seg * TAU, a1 = (i + 1) / seg * TAU, am = (a0 + a1) / 2;
      M.quad(q(a0, r0, a), q(a1, r0, a), q(a1, r1, b), q(a0, r1, b), opt, V.add(V.mul(u, Math.cos(am)), V.mul(w, Math.sin(am))));
    }
  }
  // giant red paper lantern (chōchin) with black rims; y = bottom of the paper
  function chochin(x, y, z, r, h, e) {
    const rr = r * 0.7, rim = o([0.06, 0.04, 0.03], MAT.METAL);
    M.cyl(x, y - 0.3, z, rr, 0.3, 12, rim);
    M.lathe(x, y, z, [[rr, 0], [r * 0.86, h * 0.06], [r * 0.97, h * 0.2], [r, h * 0.5], [r * 0.97, h * 0.8], [r * 0.86, h * 0.94], [rr, h]], 14, o(C.lantern, MAT.PAPER, e, PAT.RIBS));
    M.cyl(x, y + h, z, rr, 0.26, 12, rim);
  }
  // stone lantern (ishidōrō), ≈ 2.4·s tall; kind 'bronze' gives the verdigris kinrō version
  const winO = o([1, 0.68, 0.32], MAT.PAPER, 0.95);
  function toro(x, z, s = 1, kind = 'stone') {
    const br = kind === 'bronze';
    const st = br ? o(C.bronze, MAT.METAL) : o(C.stoneL, MAT.STONE), stD = br ? o(C.bronzeD, MAT.METAL) : o(C.stone, MAT.STONE);
    M.cbox(x, -0.03, z, 0.95 * s, 0.25 * s, 0.95 * s, br ? o(C.stoneL, MAT.STONE) : stD, 'xXYZz');
    M.lathe(x, 0.22 * s, z, [[0.3 * s, 0], [0.17 * s, 0.1 * s], [0.15 * s, 0.9 * s], [0.2 * s, 0.95 * s]], 6, st);
    M.cbox(x, 1.15 * s, z, 0.72 * s, 0.18 * s, 0.72 * s, st, 'xXYZz');
    M.cbox(x, 1.33 * s, z, 0.5 * s, 0.5 * s, 0.5 * s, stD, 'xXYZz');
    const hw = 0.14 * s, y0 = 1.43 * s, y1 = 1.73 * s, f = 0.255 * s;
    M.box(x - hw, y0, z + f - 0.01, x + hw, y1, z + f, winO, 'Z');
    M.box(x + f - 0.01, y0, z - hw, x + f, y1, z + hw, winO, 'X');
    M.box(x - f, y0, z - hw, x - f + 0.01, y1, z + hw, winO, 'x');
    troof(x, 1.83 * s, z, 1.2 * s, 1.2 * s, 0.4 * s, st, { ridge: 0.06, lift: 0.14 * s, sag: 0.05 * s, th: 0.1 * s, cap: false, soffit: [0.5, 0.36, 0.2], soffitE: 0.25 });
    M.blob(x, 2.3 * s, z, 0.11 * s, st, 5, 1.2);
    solid(x - 0.5 * s, z - 0.5 * s, x + 0.5 * s, z + 0.5 * s);
  }
  // hanging black-and-gold metal lantern (tsuri-dōrō), hung from ytop
  function tsuriDoro(x, ytop, z, s = 1) {
    const y = ytop - 1.75 * s, glow = o([1, 0.66, 0.3], MAT.PAPER, 0.9, PAT.RIBS);
    M.cyl(x, y + 1.55 * s, z, 0.03, 0.2 * s, 4, blackM);
    M.lathe(x, y, z, [[0.12 * s, 0], [0.4 * s, 0.12 * s], [0.42 * s, 0.2 * s]], 6, blackM, true);
    M.lathe(x, y + 0.2 * s, z, [[0.34 * s, 0], [0.37 * s, 0.75 * s]], 6, glow);
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; M.cbox(x + Math.cos(a) * 0.36 * s, y + 0.2 * s, z + Math.sin(a) * 0.36 * s, 0.07 * s, 0.75 * s, 0.07 * s, blackM, 'xXZz'); }
    M.lathe(x, y + 0.92 * s, z, [[0.4 * s, 0], [0.4 * s, 0.05 * s]], 6, gold);
    M.lathe(x, y + 0.97 * s, z, [[0.66 * s, 0], [0.56 * s, 0.1 * s], [0.22 * s, 0.42 * s], [0.07 * s, 0.52 * s]], 6, blackM);
    M.lathe(x, y + 0.97 * s, z, [[0.67 * s, -0.04 * s], [0.67 * s, 0.01 * s]], 6, gold);
    M.blob(x, y + 1.55 * s, z, 0.1 * s, gold, 5);
  }
  // giant woven straw sandal (waraji) hung flat against a wall; f = +1 faces south, −1 north
  function waraji(x, y0, z, h, f) {
    const straw = o(C.straw, MAT.CLOTH, 0, PAT.RIBS), strawD = o(C.straw.map(v => v * 0.68), MAT.CLOTH, 0, PAT.RIBS);
    const rope = o([0.3, 0.19, 0.08], MAT.CLOTH), n = 9, w = h * 0.34, t = 0.2;
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n, ww = w * (0.58 + 0.42 * Math.sqrt(Math.sin(Math.PI * (t0 + t1) / 2)));
      M.box(x - ww / 2, y0 + t0 * h, z - t, x + ww / 2, y0 + t1 * h + 0.01, z + t, straw, 'xXYZz');
    }
    const zf = z + f * t, zo = z + f * (t + 0.07);
    M.box(x - w * 0.14, y0 + 0.1 * h, Math.min(zf, zo), x + w * 0.14, y0 + 0.92 * h, Math.max(zf, zo), strawD);     // centre weave
    for (const yy of [0.58, 0.72]) M.box(x - w * 0.5, y0 + yy * h, Math.min(zf, zo + f * 0.03), x + w * 0.5, y0 + yy * h + 0.14, Math.max(zf, zo + f * 0.03), rope);
    for (const sd of [-1, 1]) for (const yy of [0.35, 0.5, 0.65]) M.cbox(x + sd * w * 0.52, y0 + yy * h, z, 0.22, 0.12, 0.3, rope);
    M.box(x - 0.06, y0 + h, z - 0.06, x + 0.06, y0 + h + 0.6, z + 0.06, rope);
  }
  // Niō guardian, standing behind a grille; s mirrors the pose
  function nio(x, z, col, s) {
    const sk = o(col, MAT.CLOTH), dk = o(col.map(v => v * 0.55), MAT.CLOTH);
    M.cbox(x, 0, z, 1.6, 0.9, 1.1, o(C.stoneD, MAT.STONE));
    for (const lx of [-0.38, 0.38]) M.cbox(x + lx, 0.9, z, 0.34, 1.0, 0.4, sk);
    M.blob(x, 2.3, z, 0.78, dk, 7, 0.95);
    M.blob(x, 3.2, z + 0.06, 0.72, sk, 7, 0.85);
    M.blob(x, 4.02, z + 0.14, 0.36, sk, 7, 1.12);
    M.blob(x, 4.38, z + 0.04, 0.2, dk, 5);
    tube([x + s * 0.62, 3.55, z], [x + s * 1.02, 4.45, z + 0.25], 0.18, 0.14, sk);
    M.blob(x + s * 1.02, 4.55, z + 0.28, 0.21, sk, 5);
    tube([x - s * 0.62, 3.5, z], [x - s * 0.82, 2.55, z + 0.38], 0.18, 0.14, sk);
    M.blob(x - s * 0.82, 2.45, z + 0.4, 0.21, sk, 5);
    tube([x - 0.9, 4.2, z - 0.3], [x, 4.95, z - 0.35], 0.08, 0.08, dk, 4);       // flying scarf (tenne)
    tube([x, 4.95, z - 0.35], [x + 0.9, 4.2, z - 0.3], 0.08, 0.08, dk, 4);
  }
  // roof() wrapper: roof()'s own soffit is one flat quad at corner height and pokes up through the tiles
  // wherever the eave sags, which reads as a black hole from above. Build the fascia + soffit here instead,
  // following the eave curve. ro.glow → emissive warm fascia (uplit rafter ends) that outlines the roof in
  // ASCII; ro.soffitE → glowing underside, which is what the reflections see.
  function troof(x, y, z, w, d, h, opt, ro = {}) {
    M.roof(x, y, z, w, d, h, opt, Object.assign({}, ro, { th: 0 }));
    const th = ro.th ?? 0.25, lift = ro.lift ?? 0.35, hw = w / 2, hd = d / 2;
    if (ro.hips) {   // hip ridges (kudarimune): light diagonal lines from the ridge ends down to the corners
      const k = ro.ridge ?? 0.45, sag = ro.sag ?? 0.25, rw = Math.max(0.2, hw - hd * (1 - k)), ho = o(ro.capc || C.ridge, MAT.ROOF);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const E = [x + sx * hw * 0.97, y + lift + 0.12, z + sz * hd * 0.97], Rr = [x + sx * rw, y + h + 0.1, z];
        const S = V.lerp(E, Rr, 0.45); S[1] -= sag;
        beam(E, S, ro.hips, ro.hips * 0.8, ho); beam(S, Rr, ro.hips, ro.hips * 0.8, ho);
      }
    }
    if (th <= 0) return;
    const ring = [[-hw, lift, -hd], [0, 0, -hd], [hw, lift, -hd], [hw, 0, 0], [hw, lift, hd], [0, 0, hd], [-hw, lift, hd], [-hw, 0, 0]].map(p => [x + p[0], y + p[1], z + p[2]]);
    const fo = ro.glow ? o(ro.fascia || [1, 0.6, 0.3], MAT.METAL, ro.glow) : o(ro.fascia || opt.c.map(v => v * 0.6), opt.m);
    const so = o(ro.soffit || [0.32, 0.13, 0.06], MAT.WOOD, ro.soffitE || 0), c = [x, y - th, z];
    for (let i = 0; i < 8; i++) {
      const a = ring[i], b = ring[(i + 1) % 8], a2 = [a[0], a[1] - th, a[2]], b2 = [b[0], b[1] - th, b[2]];
      M.quadF(a2, b2, b, a, fo, [(a[0] + b[0]) / 2 - x, 0, (a[2] + b[2]) / 2 - z]);
      M.triF(c, a2, b2, so, [0, -1, 0]);
    }
  }
  // low-poly leaf cluster (3 bands × 6 sides): at 3×5 samples per character a full blob buys nothing
  function leaf(x, y, z, r, opt, sy = 1) { M.lathe(x, y, z, [[0.01, -r * sy], [r * 0.92, -r * 0.35 * sy], [r * 0.8, r * 0.4 * sy], [0.01, r * sy]], 6, opt); }
  // cheap low-poly crown (3 bands) for distant tree masses
  function crown(x, y, z, r, opt) { M.lathe(x, y, z, [[0.01, -r * 0.75], [r, -r * 0.15], [r * 0.82, r * 0.45], [0.01, r]], 6, opt); }
  // trees: falling-leaf emitters get pushed to `trees`
  function maple(x, z, s, tx, tz) {   // trunk at (x,z), crown over (tx,tz)
    const m = [(x * 2 + tx) / 3, 1.7 * s, (z * 2 + tz) / 3];
    tube([x, -0.05, z], m, 0.22 * s, 0.15 * s, bark, 5);
    tube(m, [tx, 3.1 * s, tz], 0.14 * s, 0.07 * s, bark, 5);
    tube(m, [m[0] * 0.4 + tx * 0.6 + 1.2 * s, 2.7 * s, m[2] * 0.4 + tz * 0.6 - 0.8 * s], 0.1 * s, 0.05 * s, bark, 4);
    for (let i = 0; i < 12; i++) {
      const a = R() * TAU, d = Math.sqrt(R());
      const c = [0.62 + R() * 0.3, 0.05 + R() * 0.17, 0.03 + R() * 0.03];
      leaf(tx + Math.cos(a) * d * 2.5 * s, (2.7 + R() * 1.5 - d * 0.7) * s, tz + Math.sin(a) * d * 2.0 * s, (0.75 + R() * 0.5) * s, o(c, MAT.FOLIAGE), 0.62);
    }
    trees.push([tx, 0, tz, 1]);
  }
  function ginkgo(x, z, s) {
    tube([x, -0.05, z], [x, 5 * s, z], 0.32 * s, 0.16 * s, bark, 6);
    for (let i = 0; i < 11; i++) {
      const t = R(), a = R() * TAU, rr = (1 - t * 0.8) * 2.2 * s * Math.sqrt(R());
      const c = [COL.ginkgo[0] * (0.75 + R() * 0.3), COL.ginkgo[1] * (0.7 + R() * 0.3), 0.05];
      leaf(x + Math.cos(a) * rr, (2.8 + t * 4.6) * s, z + Math.sin(a) * rr, (1.0 + (1 - t) * 0.55) * s, o(c, MAT.FOLIAGE), 0.85);
    }
    trees.push([x, 0, z, 0]);
  }
  function pine(x, z, s, lx, lz) {    // black pine leaning toward (x+lx, z+lz), cloud-pruned pads
    const nd = [[0.05, 0.15, 0.08], [0.07, 0.19, 0.09], [0.04, 0.12, 0.07]];
    const p1 = [x + lx * 0.35, 2.3 * s, z + lz * 0.35], p2 = [x + lx, 4.0 * s, z + lz];
    tube([x, -0.05, z], p1, 0.34 * s, 0.26 * s, bark, 6); tube(p1, p2, 0.26 * s, 0.13 * s, bark, 6);
    const pads = [[p2, 2.0], [[p1[0] - lz * 0.5 + 1.8 * s, 3.0 * s, p1[2] + 0.6], 1.5], [[p1[0] - 1.7 * s, 2.6 * s, p1[2] - 0.5], 1.4], [V.lerp(p1, p2, 0.5).map((v, i) => i === 1 ? v + 1.3 * s : v), 1.3]];
    pads.forEach(([c, r], i) => {
      if (i) tube(i === 3 ? V.lerp(p1, p2, 0.5) : p1, c, 0.1 * s, 0.06 * s, bark, 4);
      for (let j = 0; j < 3; j++) leaf(c[0] + (R() - 0.5) * r, c[1] + R() * 0.25 * s, c[2] + (R() - 0.5) * r * 0.8, r * s * (0.7 + R() * 0.35), o(nd[(i + j) % 3], MAT.FOLIAGE), 0.36);
    });
  }
  // dark tree masses for the backdrop
  function grove(x0, z0, x1, z1, n, h0, h1) {
    const cols = [[0.04, 0.09, 0.06], [0.05, 0.11, 0.07], [0.03, 0.07, 0.06], [0.06, 0.1, 0.05]];
    for (let i = 0; i < n; i++) {
      const x = x0 + R() * (x1 - x0), z = z0 + R() * (z1 - z0), h = h0 + R() * (h1 - h0), r = 2 + R() * 1.8;
      M.cyl(x, -0.05, z, 0.25, h - r * 0.6, 5, bark, false);
      crown(x, h, z, r, o(cols[i % 4], MAT.FOLIAGE));
      if (R() < 0.6) crown(x + (R() - 0.5) * 2.5, h - r * 0.8, z + (R() - 0.5) * 2, r * 0.8, o(cols[(i + 1) % 4], MAT.FOLIAGE));
    }
  }

  // ───────── ground ─────────
  // Everything walkable sits a few cm below 0 (see header): gravel −0.05, paving −0.035, sandō −0.028.
  const gravel = o(C.gravel, MAT.GRAVEL), earth = o([0.1, 0.095, 0.09], MAT.GRAVEL);
  M.ground(-30, -100, 36, -34.4, -0.05, gravel);                 // precinct
  M.ground(-30, -34.4, 36, -8, -0.05, earth);                    // behind the Nakamise stalls
  M.ground(-70, -125, -30, -8, -0.05, earth);                    // outside the walls
  M.ground(36, -125, 80, -8, -0.05, earth);
  M.ground(-30, -125, 36, -100, -0.05, earth);
  M.ground(-13.4, -46, 14, -34.4, -0.035, pave);                 // plaza paving (stops at the pagoda pool)
  M.ground(-13.4, -78, 11, -46, -0.035, pave);
  M.ground(-14, -81, 14, -78, -0.035, pave);
  M.ground(-3, -78, 3, -41.6, -0.028, o([0.33, 0.31, 0.28], MAT.STONE, 0, PAT.PAVING));   // sandō, lighter stone
  for (const sx of [-3.1, 2.9]) M.box(sx, -0.05, -78, sx + 0.2, 0.03, -41.6, o(C.stoneD, MAT.STONE), 'xXY');

  // ───────── pond: water, grass annulus, rim stones ─────────
  const P = POND, PX0 = 11, PX1 = 33, PZ0 = -78, PZ1 = -46;
  {
    const water = o([0.035, 0.07, 0.085], MAT.WATER), N = 40;
    for (let i = 0; i < N; i++) {
      const a0 = i / N * TAU, a1 = (i + 1) / N * TAU;
      M.tri([P.cx, -0.04, P.cz], [P.cx + Math.cos(a1) * P.rx, -0.04, P.cz + Math.sin(a1) * P.rz], [P.cx + Math.cos(a0) * P.rx, -0.04, P.cz + Math.sin(a0) * P.rz], water, [0, 1, 0]);
    }
    M.lathe(P.cx, -0.4, P.cz, [[0.01, 0], [Math.min(P.rx, P.rz) * 0.98, 0]], 12, o([0.02, 0.03, 0.03], MAT.STONE));   // pond bed (only seen through ripples)
    // grass from the ellipse out to the rectangle, rays through the rectangle's corners so it tiles exactly
    const angs = [];
    for (let i = 0; i < 48; i++) angs.push(i / 48 * TAU);
    for (const [x, z] of [[PX0, PZ0], [PX1, PZ0], [PX1, PZ1], [PX0, PZ1]]) angs.push((Math.atan2((z - P.cz) / P.rz, (x - P.cx) / P.rx) + TAU) % TAU);
    angs.sort((a, b) => a - b); angs.push(angs[0] + TAU);
    const out = (a) => {
      const dx = Math.cos(a) * P.rx, dz = Math.sin(a) * P.rz;
      const tx = dx > 0 ? (PX1 - P.cx) / dx : (PX0 - P.cx) / dx, tz = dz > 0 ? (PZ1 - P.cz) / dz : (PZ0 - P.cz) / dz;
      const t = Math.min(Math.abs(tx), Math.abs(tz));
      return [P.cx + dx * t, -0.03, P.cz + dz * t];
    };
    const grass = o(C.grass, MAT.GRASS);
    for (let i = 0; i < angs.length - 1; i++) {
      const a0 = angs[i], a1 = angs[i + 1];
      const e0 = [P.cx + Math.cos(a0) * P.rx * 1.005, -0.03, P.cz + Math.sin(a0) * P.rz * 1.005], e1 = [P.cx + Math.cos(a1) * P.rx * 1.005, -0.03, P.cz + Math.sin(a1) * P.rz * 1.005];
      M.quadF(e0, e1, out(a1), out(a0), grass, [0, 1, 0]);
    }
    // rim: low grey rocks, with gaps at the bridge ends and on the west shore (pondShore)
    const per = 2 * Math.PI * Math.sqrt((P.rx * P.rx + P.rz * P.rz) / 2), nR = Math.round(per / 0.95);
    for (let i = 0; i < nR; i++) {
      const a = (i + R() * 0.4) / nR * TAU, f = 1.04 + R() * 0.05;
      const x = P.cx + Math.cos(a) * P.rx * f, z = P.cz + Math.sin(a) * P.rz * f;
      if (Math.abs(z + 62) < 1.4) continue;                      // bridge abutments
      if (x < P.cx && z > -68.8 && z < -65.2) continue;           // kneeling spot
      const r = 0.28 + R() * 0.3, h = r * (0.7 + R() * 0.5), g = 0.2 + R() * 0.12;
      M.lathe(x, -0.12, z, [[r, 0], [r * 0.75, h * 0.8], [0.01, h * 1.05]], 5, o([g, g * 0.97, g * 0.92], MAT.STONE));
    }
    for (const [x, z, r] of [[11.8, -53.2, 0.5], [12.6, -55.0, 0.35], [11.6, -61.8, 0.45], [13.2, -52.2, 0.3], [11.9, -69.0, 0.4]]) {
      M.lathe(x, -0.1, z, [[r, 0], [r * 0.8, r * 0.6], [0.01, r * 0.85]], 5, o([0.2, 0.21, 0.18], MAT.STONE));
      M.lathe(x + r * 0.9, -0.05, z + 0.3, [[r * 0.9, 0], [r * 0.6, r * 0.45], [0.01, r * 0.6]], 6, o([0.05, 0.12, 0.05], MAT.FOLIAGE));
    }
    // a few flat stepping stones on the kneeling spot and moss-dark shrubs (azalea) on the banks
    for (const [x, z] of [[12.9, -67], [13.6, -66.4]]) M.lathe(x, -0.05, z, [[0.45, 0], [0.4, 0.09], [0.01, 0.1]], 6, o(C.stoneL, MAT.STONE));
    for (const [x, z, r] of [[12.2, -59.6, 0.8], [12.3, -63.6, 0.6], [16.5, -49.6, 0.9], [24.5, -49.7, 1.0], [29.6, -55.8, 0.8], [29.8, -68, 0.9], [12.0, -75.8, 0.8], [33.2, -73.6, 1.1]]) {
      leaf(x, 0.15, z, r, o([0.05, 0.13, 0.06], MAT.FOLIAGE), 0.6);
      leaf(x + r * 0.6, 0.1, z + 0.3, r * 0.7, o([0.07, 0.15, 0.06], MAT.FOLIAGE), 0.6);
    }
  }

  // ───────── HOZOMON (Treasure-House Gate), centred (0, −38) ─────────
  // Stylised low: the follow camera passes ~2.5 m over the ridge when the player walks through.
  {
    const gz = -38, zf = -35.4, zb = -40.6, pt = 4.7;          // front / back pillar lines, pillar top
    M.box(-9.2, -0.05, -41.2, 9.2, 0.3, -34.8, o(C.stoneL, MAT.STONE, 0, PAT.PAVING));
    M.box(-2.9, -0.05, -41.4, 2.9, 0.06, -34.6, o(C.stone, MAT.STONE, 0, PAT.PAVING), 'Y');   // threshold flush with the path
    const PX = [-8.6, -3.2, 3.2, 8.6];
    for (const x of PX) for (const z of [zf, gz, zb]) M.cyl(x, 0.3, z, 0.34, pt - 0.3, 8, pillar);
    for (const x of [-5.9, 5.9]) for (const z of [zf, zb]) M.cyl(x, 0.3, z, 0.26, pt - 0.3, 8, pillar);
    for (const z of [zf, zb]) {
      M.box(-9.1, pt - 0.6, z - 0.3, 9.1, pt, z + 0.3, lac);                   // head beam (kashiranuki)
      M.box(-9.1, pt, z - 0.32, 9.1, pt + 0.18, z + 0.32, o(C.white, MAT.STONE, 0.05));  // white bracket band
      for (const sd of [-1, 1]) M.box(sd * 3.2, 2.9, z - 0.2, sd * 8.9, 3.25, z + 0.2, lacD);
    }
    for (const x of PX) M.box(x - 0.3, pt - 0.6, zb, x + 0.3, pt, zf, lac);
    for (let x = -8.6; x <= 8.61; x += 1.35) {                   // bracket complex (tokyō), gold-tipped
      M.cbox(x, pt + 0.18, zf + 0.15, 0.5, 0.36, 0.9, lacD);
      M.cbox(x, pt + 0.54, zf + 0.35, 0.9, 0.18, 0.7, lac);
      M.cbox(x, pt + 0.24, zf + 0.62, 0.2, 0.2, 0.06, gold, 'Z');
    }
    M.box(-9.2, pt + 0.18, zb - 0.6, 9.2, pt + 0.72, zf + 0.75, lacD, 'xXy');
    troof(0, pt + 0.72, gz, 19.0, 8.4, 0.75, tiles, { ridge: 0.98, lift: 0.4, sag: 0.15, th: 0.28, cap: false, glow: 0.35, soffitE: 0.25 });   // skirt roof
    // upper storey: balcony + railing, white walls between vermilion posts, black doors with gold studs
    const uz0 = -39.5, uz1 = -36.5, uy = 6.0, uh = 1.45;
    M.box(-8.2, uy - 0.22, -40.3, 8.2, uy, -35.7, o(C.vermD, MAT.WOOD));
    M.box(-8.3, uy - 0.4, -35.85, 8.3, uy - 0.18, -35.6, lac);
    for (let x = -8; x <= 8.01; x += 1.6) M.box(x - 0.07, uy, -35.85, x + 0.07, uy + 0.7, -35.71, lac);   // railing posts
    for (const yy of [uy + 0.3, uy + 0.64]) M.box(-8.1, yy, -35.88, 8.1, yy + 0.09, -35.7, lac);
    for (const x of [-8, 8]) for (let z = -40.1; z <= -35.7; z += 1.45) M.box(x - 0.07, uy, z - 0.07, x + 0.07, uy + 0.7, z + 0.07, lac);
    for (const x of [-8.05, 8.05]) M.box(x - 0.05, uy + 0.64, -40.2, x + 0.05, uy + 0.73, -35.8, lac);
    M.box(-7.2, uy, uz0, 7.2, uy + uh, uz1, o(C.white, MAT.FACADE, 0.04));
    for (const x of [-7.2, -4.3, -1.45, 1.45, 4.3, 7.2]) M.box(x - 0.17, uy, uz1, x + 0.17, uy + uh + 0.1, uz1 + 0.18, pillar);
    for (const x of [-7.2, 7.2]) for (const z of [uz0, -38]) M.box(x - 0.17, uy, z - 0.17, x + 0.17, uy + uh + 0.1, z + 0.17, pillar);
    M.box(-7.3, uy + uh - 0.3, uz1, 7.3, uy + uh + 0.1, uz1 + 0.2, lac);
    M.box(-7.3, uy, uz1, 7.3, uy + 0.16, uz1 + 0.2, lac);
    M.box(-1.3, uy + 0.16, uz1, 1.3, uy + uh - 0.3, uz1 + 0.06, o([0.05, 0.035, 0.03], MAT.WOOD), 'Z');          // central doors
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) M.cbox(-0.95 + i * 0.63, uy + 0.35 + j * 0.38, uz1 + 0.09, 0.08, 0.08, 0.05, gold, 'Z');
    for (const sd of [-1, 1]) {                                 // lattice windows (renji-mado), lamplight inside
      M.box(sd * 2.87 - 0.85, uy + 0.3, uz1, sd * 2.87 + 0.85, uy + 1.2, uz1 + 0.04, o([0.95, 0.62, 0.3], MAT.GLASS, 0.32, PAT.SHOJI), 'Z');
      M.box(sd * 5.75 - 0.8, uy + 0.3, uz1, sd * 5.75 + 0.8, uy + 1.2, uz1 + 0.04, o([0.95, 0.62, 0.3], MAT.GLASS, 0.24, PAT.SHOJI), 'Z');
    }
    const by = uy + uh + 0.1;
    M.box(-7.3, by, uz0 - 0.4, 7.3, by + 0.16, uz1 + 0.4, o(C.white, MAT.STONE, 0.05));
    for (let x = -7; x <= 7.01; x += 1.0) M.cbox(x, by + 0.16, uz1 + 0.3, 0.42, 0.34, 0.8, lacD);
    M.box(-7.6, by + 0.5, uz0 - 0.9, 7.6, by + 0.66, uz1 + 0.9, o([0.12, 0.04, 0.03], MAT.WOOD));
    const ry = by + 0.62;                                         // upper roof: eave ≈ 8.2, ridge ≈ 10.4
    troof(0, ry, gz, 17.4, 9.6, 2.2, tiles, { ridge: 0.42, lift: 0.75, sag: 0.4, th: 0.35, capc: C.ridge, glow: 0.5, soffitE: 0.3, hips: 0.4 });
    for (const x of [-4.2, 4.2]) {                                // shachi (gilded ridge fish)
      M.cbox(x, ry + 2.3, gz, 0.5, 0.65, 0.45, o(C.cap, MAT.ROOF));
      M.blob(x * 1.05, ry + 3.15, gz, 0.24, gold, 5, 1.5);
    }
    M.box(-1.4, by + 0.05, uz1 + 0.75, 1.4, by + 0.6, uz1 + 0.85, o([0.04, 0.03, 0.03], MAT.WOOD), 'Z');   // plaque
    M.box(-1.25, by + 0.13, uz1 + 0.85, 1.25, by + 0.52, uz1 + 0.88, o(C.gold, MAT.METAL, 0.35), 'Z');
    // side bays: Niō behind vermilion grilles, a giant waraji on each outer flank
    for (const side of [-1, 1]) {
      const xa = side > 0 ? 3.55 : -6.85, xb = side > 0 ? 6.85 : -3.55, xm = (xa + xb) / 2;
      const ba = Math.min(side * 3.4, side * 8.8), bb = Math.max(side * 3.4, side * 8.8);
      M.box(ba, 0.3, -38.3, bb, pt - 0.6, -37.7, o([0.05, 0.03, 0.03], MAT.WOOD));   // dark back wall
      M.box(ba, 0.3, -38.3, bb, 0.7, -35.6, o(C.stoneD, MAT.STONE));
      M.push(M4.mul(M4.trans(side * 5.75, 0, -36.9), M4.scale(0.84, 0.84, 0.84)));
      nio(0, 0, side < 0 ? [0.75, 0.2, 0.12] : [0.5, 0.16, 0.22], side);
      M.pop();
      for (let x = xa + 0.1; x < xb - 0.05; x += 0.3) M.box(x, 0.3, -35.45, x + 0.09, pt - 0.6, -35.35, o([0.42, 0.05, 0.03], MAT.WOOD), 'xXZ');
      M.box(xa, 2.0, -35.48, xb, 2.12, -35.3, lacD);
      L([side * 5.4, 2.8, -35.0], [1, 0.5, 0.3], 4.5, 0.8);
      // giant waraji. The real pair hangs on the north face (below); the camera never sees north faces, and the
      // outer flanks are always hidden behind the Nakamise roofs or outside the portrait view, so the south
      // pair (artistic licence) hangs on the inner half of each Niō grille, just outside the passage.
      waraji(side * 4.2, 0.5, -35.12, 3.6, 1);
      for (const dx of [-0.35, 0.35]) M.box(side * 4.2 + dx - 0.03, 4.1, -35.2, side * 4.2 + dx + 0.03, pt - 0.6, -35.1, o([0.3, 0.19, 0.08], MAT.CLOTH));
      const wx0 = side > 0 ? 6.95 : -8.45, wx1 = side > 0 ? 8.45 : -6.95;
      M.box(wx0, 0.3, -37.0, wx1, pt - 0.6, -35.75, o(C.woodD, MAT.FACADE, 0, PAT.PLANKS));   // outer flank wall
      M.box(ba, 0.3, -40.4, bb, pt - 0.6, -40.25, o(C.woodD, MAT.FACADE, 0, PAT.PLANKS), 'xXz');
      waraji(side * 6.0, 0.4, -40.85, 3.6, -1);
      tsuriDoro(side * 4.25, pt - 0.6, -34.75, 0.95);
      solid(side > 0 ? 2.86 : -9.3, -41.2, side > 0 ? 9.3 : -2.86, -34.8);
    }
    // the Kobunachō lantern, 3 m, in the passage
    const ly = 1.15;
    chochin(0, ly, gz, 1.42, 3.0, 0.45);
    decals.push({ kind: 'kanji', text: '小舟町', c: [0, ly + 1.52, gz + 1.44], w: 1.1, h: 2.5, col: [0.04, 0.01, 0.01] });
    L([0, ly + 1.6, gz + 3.6], RED, 10, 2.0, 0.03);
    L([0, ly + 1.0, gz - 3.4], RED, 7, 1.0, 0.03);
    for (const sd of [-1, 1]) L([sd * 6.2, 0.7, -33.6], FLOOD, 8, 1.3);
    L([0, 9.5, -29.5], [1, 0.62, 0.4], 13, 1.1);                  // warm wash on the upper storey + roof
    L([0, 13.5, -37], [0.55, 0.62, 1], 12, 0.85);                 // cool moon rim on the tiles
  }

  // ───────── plaza: stone lanterns along the sandō ─────────
  for (const z of [-44.5, -64.5, -71.5]) for (const sd of [-1, 1]) toro(sd * 4.6, z, 1.05);
  for (const z of [-44.5, -64.5, -71.5]) L([0, 2.2, z], WARM, 7.5, 0.95);   // one shared pool per pair

  // ───────── JŌKORO (incense burner), centred (0, −55) ─────────
  {
    const x = 0, z = -55, br = o(C.bronze, MAT.METAL), brD = o(C.bronzeD, MAT.METAL), brL = o([0.3, 0.55, 0.45], MAT.METAL);
    M.lathe(x, -0.04, z, [[1.75, 0], [1.75, 0.18], [1.5, 0.22], [1.5, 0.38]], 8, o(C.stoneL, MAT.STONE), true);
    for (let i = 0; i < 3; i++) {                                  // three lion-paw legs
      const a = i / 3 * TAU + Math.PI / 2;
      tube([x + Math.cos(a) * 0.62, 1.0, z + Math.sin(a) * 0.62], [x + Math.cos(a) * 0.95, 0.38, z + Math.sin(a) * 0.95], 0.13, 0.17, brD, 5);
      M.blob(x + Math.cos(a) * 0.98, 0.42, z + Math.sin(a) * 0.98, 0.2, br, 5, 0.7);
    }
    M.lathe(x, 0.85, z, [[0.45, 0], [0.95, 0.18], [1.15, 0.45], [1.18, 0.75], [1.08, 0.92], [1.22, 0.98], [1.22, 1.06]], 12, br);
    for (const sd of [-1, 1]) M.lathe(x + sd * 1.3, 1.75, z, [[0.06, 0], [0.22, 0.05], [0.22, 0.3], [0.06, 0.35]], 6, brL);  // ring handles
    M.lathe(x, 1.83, z, [[0.01, 0], [1.02, 0]], 12, o([0.3, 0.12, 0.05], MAT.FIRE, 0.25));      // ash bed
    for (let i = 0; i < 14; i++) {                                   // incense bundles + embers
      const a = R() * TAU, d = Math.sqrt(R()) * 0.75, ex = x + Math.cos(a) * d, ez = z + Math.sin(a) * d;
      M.cbox(ex, 1.83, ez, 0.09, 0.22 + R() * 0.16, 0.09, o([1, 0.45, 0.12], MAT.FIRE, 0.75 + R() * 0.25));
    }
    for (let i = 0; i < 4; i++) {                                    // posts holding the little roof
      const a = (i + 0.5) / 4 * TAU;
      M.cyl(x + Math.cos(a) * 0.95, 2.0, z + Math.sin(a) * 0.95, 0.06, 1.0, 5, brD);
    }
    M.at(x, 0, z, Math.PI / 4);
    troof(0, 2.95, 0, 2.2, 2.2, 0.75, o(C.bronze, MAT.METAL, 0, PAT.TILES), { ridge: 0.04, lift: 0.35, sag: 0.12, th: 0.12, cap: false, fascia: [0.3, 0.55, 0.45], soffit: [0.6, 0.3, 0.1], soffitE: 0.5 });
    M.pop();
    M.lathe(x, 3.6, z, [[0.18, 0], [0.24, 0.12], [0.08, 0.3], [0.16, 0.45], [0.02, 0.75]], 6, brL);   // hōju finial
    solid(x - 1.3, z - 1.3, x + 1.3, z + 1.3);
    L([x, 2.5, z], EMBER, 8, 1.6, 0.22);
    L([x, 0.9, z + 2.4], [1, 0.5, 0.2], 5, 0.7, 0.1);
    anchors.incense = [x, 0, z]; anchors.smoke = [x, 1.9, z];
  }

  // ───────── CHŌZUYA (purification pavilion), (−10, −47) ─────────
  {
    const x = -10, z = -47, stoneB = o([0.3, 0.29, 0.27], MAT.STONE), br = o(C.bronze, MAT.METAL), brL = o([0.32, 0.58, 0.46], MAT.METAL);
    M.box(x - 3, -0.05, z - 2.6, x + 3, 0.15, z + 2.6, o(C.stoneL, MAT.STONE, 0, PAT.PAVING), 'xXYZz');
    const ph = 4.4;                                              // tall posts: the basin stays visible under the south eave
    for (const px of [-2.5, 2.5]) for (const pz of [-2.1, 2.1]) M.cyl(x + px, 0.15, z + pz, 0.16, ph - 0.15, 8, o(C.verm, MAT.WOOD, 0, PAT.PLANKS));
    for (const pz of [-2.1, 2.1]) M.box(x - 2.8, ph - 0.35, z + pz - 0.13, x + 2.8, ph, z + pz + 0.13, lac);
    for (const px of [-2.5, 2.5]) M.box(x + px - 0.13, ph - 0.35, z - 2.1, x + px + 0.13, ph, z + 2.1, lac);
    M.box(x - 2.9, ph, z - 2.3, x + 2.9, ph + 0.25, z + 2.3, o(C.vermD, MAT.WOOD));
    troof(x, ph + 0.25, z, 7.4, 5.6, 1.9, tiles, { ridge: 0.5, lift: 0.5, sag: 0.3, th: 0.25, capc: C.ridge, glow: 0.4, soffitE: 0.2, hips: 0.25 });
    M.box(x - 1.0, ph - 0.85, z + 2.24, x + 1.0, ph - 0.4, z + 2.3, o([0.05, 0.03, 0.02], MAT.WOOD), 'Z');   // small plaque
    // basin: a long granite trough, water just below the rim
    M.box(x - 1.9, 0.15, z - 0.9, x + 1.9, 0.95, z + 0.9, stoneB);
    M.box(x - 1.65, 0.86, z - 0.65, x + 1.65, 0.87, z + 0.65, o([0.04, 0.08, 0.1], MAT.WATER, 0.04), 'Y');
    for (let i = 0; i < 5; i++) {                                   // hishaku ladles resting on the rim
      const lx = x - 0.8 + i * 0.58, lz = z + 0.78;
      beam([lx, 0.97, lz - 0.62], [lx + 0.08, 1.0, lz + 0.18], 0.04, 0.04, o([0.62, 0.52, 0.3], MAT.WOOD));
      M.lathe(lx + 0.09, 0.95, lz + 0.26, [[0.07, 0], [0.09, 0.14]], 6, o([0.66, 0.56, 0.34], MAT.WOOD), true);
    }
    // bronze dragon on a rock pedestal at the north end, water arcing from its mouth
    // kept low (head ≈ 1.9 m) so it reads under the south eave from where the player stands
    const dx = x - 1.45, dz = z - 0.1;                            // rock pedestal at the west end of the trough
    M.lathe(dx, 0.95, dz, [[0.45, 0], [0.38, 0.2], [0.08, 0.3]], 6, o([0.22, 0.21, 0.2], MAT.STONE));
    M.push(M4.trans(0, -0.55, 0));
    const body = [[dx - 0.15, 1.65, dz + 0.1], [dx - 0.35, 2.05, dz - 0.15], [dx - 0.05, 2.4, dz - 0.2], [dx + 0.25, 2.55, dz + 0.05], [dx + 0.45, 2.45, dz + 0.1]];
    for (let i = 0; i < body.length - 1; i++) tube(body[i], body[i + 1], 0.2 - i * 0.02, 0.18 - i * 0.02, br, 6);
    for (let i = 1; i < body.length - 1; i++) M.blob(body[i][0], body[i][1], body[i][2], 0.2 - i * 0.02, br, 6);
    M.blob(dx + 0.55, 2.47, dz + 0.1, 0.22, brL, 6, 0.8);                                 // head, facing east
    M.cbox(dx + 0.78, 2.32, dz + 0.1, 0.3, 0.09, 0.2, br);                                 // jaw
    for (const sd of [-1, 1]) tube([dx + 0.5, 2.62, dz + 0.1 + sd * 0.08], [dx + 0.2, 2.95, dz + 0.1 + sd * 0.22], 0.04, 0.015, brL, 4);   // horns
    for (let i = 0; i < 5; i++) M.cbox(dx + 0.92 + i * 0.1, 2.28 - i * 0.04 - i * i * 0.03, dz + 0.1, 0.08, 0.08, 0.06, o([0.55, 0.75, 0.95], MAT.WATER, 0.3));   // spout
    M.pop();
    solid(x - 2.1, z - 1.1, x + 2.1, z + 1.1);
    for (const px of [-2.5, 2.5]) for (const pz of [-2.1, 2.1]) solid(x + px - 0.2, z + pz - 0.2, x + px + 0.2, z + pz + 0.2);
    L([x, 3.2, z + 1.6], [1, 0.72, 0.45], 7, 1.2);
    L([x - 0.5, 1.4, z + 2.8], [0.6, 0.75, 1], 4, 0.45);           // cool glint on the water
    anchors.temizu = [x, 0, -44.6];
  }

  // ───────── GOJŪ-NO-TŌ (five-storey pagoda), centred (−17, −60) ─────────
  {
    const x = -17, z = -60, wallO = o(C.verm, MAT.WOOD, 0.05, PAT.PLANKS), band = o(C.white, MAT.STONE, 0.18);
    M.box(x - 5.2, -0.05, z - 5.2, x + 5.2, 1.0, z + 5.2, o(C.stoneL, MAT.STONE, 0, PAT.PAVING));
    for (let i = 0; i < 3; i++) M.box(x + 5.2, -0.05, z - 2.2, x + 5.2 + (3 - i) * 0.4, 1.0 - i * 0.33, z + 2.2, o(C.stone, MAT.STONE));   // steps on the east side
    M.box(x - 5.35, 0.85, z - 5.35, x + 5.35, 1.0, z + 5.35, o(C.stoneD, MAT.STONE), 'xXZz');
    let y0 = 1.0;
    const tiers = [[6.4, 2.6, 11.2, 1.1], [5.9, 2.1, 10.4, 1.05], [5.4, 2.0, 9.7, 1.0], [4.9, 1.9, 9.0, 0.95], [4.4, 1.8, 8.4, 1.8]];
    tiers.forEach(([w, h, rw, rise], i) => {
      const hw = w / 2;
      M.box(x - hw, y0, z - hw, x + hw, y0 + h, z + hw, wallO);
      if (i === 0) M.box(x - hw - 0.6, y0, z - hw - 0.6, x + hw + 0.6, y0 + 0.25, z + hw + 0.6, o(C.vermD, MAT.WOOD));   // veranda
      for (const cx of [-1, 1]) for (const cz of [-1, 1]) M.box(x + cx * hw - 0.2, y0, z + cz * hw - 0.2, x + cx * hw + 0.2, y0 + h, z + cz * hw + 0.2, pillar);
      for (const cx of [-hw / 3, hw / 3]) M.box(x + cx - 0.13, y0, z + hw, x + cx + 0.13, y0 + h, z + hw + 0.12, pillar);
      // door (south) with gold studs, lattice windows either side
      const dw = w * 0.16, dh = h * 0.62;
      M.box(x - dw, y0 + 0.25, z + hw, x + dw, y0 + 0.25 + dh, z + hw + 0.05, o([0.05, 0.035, 0.03], MAT.WOOD), 'Z');
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) M.cbox(x - dw * 0.6 + a * dw * 0.6, y0 + 0.5 + b * dh * 0.3, z + hw + 0.07, 0.07, 0.07, 0.04, gold, 'Z');
      for (const sd of [-1, 1]) M.box(x + sd * w * 0.33 - w * 0.09, y0 + h * 0.3, z + hw, x + sd * w * 0.33 + w * 0.09, y0 + h * 0.75, z + hw + 0.04, o([1, 0.6, 0.3], MAT.GLASS, 0.18, PAT.SHOJI), 'Z');
      // white bracket band + stepped dark-red brackets
      M.box(x - hw - 0.05, y0 + h - 0.42, z - hw - 0.05, x + hw + 0.05, y0 + h, z + hw + 0.05, band);
      M.box(x - hw - 0.45, y0 + h, z - hw - 0.45, x + hw + 0.45, y0 + h + 0.22, z + hw + 0.45, lacD);
      for (let t = -2; t <= 2; t++) M.cbox(x + t * w * 0.21, y0 + h - 0.05, z + hw + 0.32, 0.32, 0.3, 0.55, lac);
      M.box(x - hw - 0.8, y0 + h + 0.22, z - hw - 0.8, x + hw + 0.8, y0 + h + 0.38, z + hw + 0.8, o([0.12, 0.04, 0.03], MAT.WOOD));
      const ey = y0 + h + 0.42;
      // tier roof: glowing rafter ends + uplit underside (that is what the reflections show)
      troof(x, ey, z, rw, rw, rise, tiles, { ridge: 0.04, lift: 0.75, sag: 0.32, th: 0.3, cap: false, glow: 0.55, soffit: [0.6, 0.24, 0.1], soffitE: 0.35, hips: 0.3 });
      // little bells (fūtaku) at the corners
      for (const cx of [-1, 1]) for (const cz of [-1, 1]) M.cbox(x + cx * (rw / 2 - 0.15), ey + 0.25, z + cz * (rw / 2 - 0.15), 0.12, 0.3, 0.12, gold);
      y0 = ey + rise * 0.55;
      if (i === 4) y0 = ey + rise;
    });
    // sōrin: base, bowl, nine rings, water flame, jewel
    const sg = o(C.gold, MAT.METAL, 0.35);
    M.cbox(x, y0 - 0.25, z, 1.1, 0.55, 1.1, o(C.cap, MAT.ROOF));
    M.lathe(x, y0 + 0.3, z, [[0.2, 0], [0.5, 0.2], [0.42, 0.5], [0.15, 0.6]], 8, sg);
    M.lathe(x, y0 + 0.9, z, [[0.1, 0], [0.45, 0.3]], 8, sg);
    M.cyl(x, y0 + 0.9, z, 0.07, 8, 5, sg);
    for (let r = 0; r < 9; r++) M.lathe(x, y0 + 1.45 + r * 0.42, z, [[0.44 - r * 0.012, 0], [0.44 - r * 0.012, 0.12]], 8, sg, true);
    const fy = y0 + 1.45 + 9 * 0.42 + 0.25;
    for (const a of [0, Math.PI / 2]) { M.at(x, fy, z, a); M.box(-0.42, 0, -0.03, 0.42, 1.0, 0.03, sg); M.pop(); }
    M.blob(x, fy + 1.25, z, 0.17, sg, 6);
    M.lathe(x, fy + 1.5, z, [[0.05, 0], [0.22, 0.18], [0.16, 0.38], [0.02, 0.62]], 8, sg);
    for (const cx of [-1, 1]) for (const cz of [-1, 1]) wires.push([[x, fy + 1.2, z], [x + cx * 3.9, y0 - 0.9, z + cz * 3.9], 0.5]);
    solid(x - 5.3, z - 5.3, x + 5.3, z + 5.3);
    solid(x + 5.2, z - 2.3, x + 6.5, z + 2.3);
    // two bronze lanterns flanking the east steps, uplights
    for (const sd of [-1, 1]) toro(x + 6.9, z + sd * 3.6, 0.85, 'bronze');
    L([x, 0.6, z + 7.4], FLOOD, 10, 1.7);
    L([x + 3.5, 5.5, z + 7], [1, 0.58, 0.3], 9, 1.1);
    L([x - 3.5, 9.5, z + 6.5], [1, 0.55, 0.3], 9, 1.0);
    L([x + 1, 15.5, z + 4], [0.5, 0.56, 0.95], 11, 0.9);           // cool moon rim on the upper roofs
  }

  // ───────── reflecting pool in front of the pagoda (GARDEN_POOL) ─────────
  // Low stone kerb, dark water a few cm down, a little stone bridge-slab at the west end.
  {
    const G = GARDEN_POOL, N = 48, water = o([0.03, 0.06, 0.075], MAT.WATER);
    const pt = (a, f) => {
      const c = Math.cos(a), sn = Math.sin(a);
      return [G.cx + Math.sign(c) * Math.abs(c) ** (2 / G.p) * G.rx * f, G.cz + Math.sign(sn) * Math.abs(sn) ** (2 / G.p) * G.rz * f];
    };
    const kerb = o(C.stoneL, MAT.STONE), kerbT = o([0.42, 0.4, 0.37], MAT.STONE);
    for (let i = 0; i < N; i++) {
      const a0 = i / N * TAU, a1 = (i + 1) / N * TAU, p0 = pt(a0, 1), p1 = pt(a1, 1), q0 = pt(a0, 1.09), q1 = pt(a1, 1.09);
      M.tri([G.cx, -0.045, G.cz], [p1[0], -0.045, p1[1]], [p0[0], -0.045, p0[1]], water, [0, 1, 0]);
      // kerb: inner face, top, outer face (top is only 12 cm high so it hides little of the reflection)
      M.quadF([p0[0], -0.045, p0[1]], [p1[0], -0.045, p1[1]], [p1[0], 0.12, p1[1]], [p0[0], 0.12, p0[1]], kerb, [G.cx - p0[0], 0, G.cz - p0[1]]);
      M.quadF([p0[0], 0.12, p0[1]], [p1[0], 0.12, p1[1]], [q1[0], 0.12, q1[1]], [q0[0], 0.12, q0[1]], kerbT, [0, 1, 0]);
      M.quadF([q0[0], -0.05, q0[1]], [q1[0], -0.05, q1[1]], [q1[0], 0.12, q1[1]], [q0[0], 0.12, q0[1]], kerb, [q0[0] - G.cx, 0, q0[1] - G.cz]);
    }
    // a few water-lily pads + a stone in the water
    for (const [lx, lz, r] of [[-20.6, -42.6, 0.35], [-20.0, -43.6, 0.28], [-15.0, -51.9, 0.3], [-14.6, -50.8, 0.24], [-20.9, -50.2, 0.26]]) M.lathe(lx, -0.03, lz, [[r, 0], [0.01, 0.01]], 7, o([0.06, 0.16, 0.07], MAT.GRASS), false);
    M.lathe(-15.0, -0.2, -44.2, [[0.42, 0], [0.32, 0.3], [0.01, 0.38]], 6, o(C.stone, MAT.STONE));
    for (let zz = G.cz - G.rz; zz < G.cz + G.rz - 0.01; zz += 1.6) {
      const v = Math.min(1, Math.abs((zz + 0.8 - G.cz) / G.rz) + 0.8 / G.rz), hw = G.rx * Math.max(0, 1 - v ** G.p) ** (1 / G.p) + 0.25;
      solid(G.cx - hw, zz - 0.1, G.cx + hw, zz + 1.7);
    }
    L([-17.75, 1.4, -39.6], FLOOD, 7, 0.9);                          // kerb glow, also lights the near water edge
  }

  // ───────── HONDŌ (main hall), centred (0, −88) ─────────
  {
    const zc = -88, zF = -80.5, top = 1.4;
    const granite = o(C.stoneL, MAT.STONE, 0, PAT.PAVING);
    M.box(-14.2, -0.05, -95.2, 14.2, top, zF, o(C.stoneL, MAT.STONE, 0, PAT.BRICK));
    M.box(-14.4, top - 0.12, -95.4, 14.4, top, zF + 0.15, o(C.stone, MAT.STONE), 'xXZz');
    // stairs: 6 steps from z −80.5 (top) to −78 (ground)
    for (let i = 0; i < 6; i++) M.box(-6.2, -0.05, zF, 6.2, top - i * (top / 6), zF + (i + 1) * (2.5 / 6), granite);
    for (const sd of [-1, 1]) {
      beam([sd * 6.45, top + 0.15, zF], [sd * 6.45, 0.3, -78], 0.4, 0.45, o(C.stone, MAT.STONE));
      M.box(sd * 6.45 - 0.2, -0.05, -78.4, sd * 6.45 + 0.2, 0.55, -77.9, o(C.stone, MAT.STONE));
    }
    // veranda floor + front railing (gap at the stairs)
    M.box(-13.8, top, -84.6, 13.8, top + 0.18, zF, o(C.woodD, MAT.WOOD, 0, PAT.PLANKS));
    for (const sd of [-1, 1]) {
      for (let x = 6.4; x <= 13.6; x += 1.2) M.box(sd * x - 0.06, top, zF + 0.05, sd * x + 0.06, top + 0.9, zF + 0.17, lac);
      M.box(Math.min(sd * 6.4, sd * 13.7), top + 0.82, zF + 0.03, Math.max(sd * 6.4, sd * 13.7), top + 0.94, zF + 0.2, lac);
      M.box(Math.min(sd * 6.4, sd * 13.7), top + 0.35, zF + 0.06, Math.max(sd * 6.4, sd * 13.7), top + 0.43, zF + 0.16, lac);
    }
    // front pillar row
    const yTop = 7.7;
    for (let i = 0; i <= 10; i++) M.cyl(-12 + i * 2.4, top, -81.8, 0.3, yTop - top, 8, pillar);
    for (const sd of [-1, 1]) for (const z of [-84.6, -87.6, -90.6, -93.6]) M.cyl(sd * 13.3, top, z, 0.28, yTop - top, 7, pillar);
    M.box(-13.6, yTop - 0.7, -82.1, 13.6, yTop, -81.5, lac);
    M.box(-13.6, 4.6, -82.0, 13.6, 4.9, -81.6, lacD);
    // inner front wall: lattice doors glowing faintly either side of the open central bays
    for (const sd of [-1, 1]) {
      const xa = Math.min(sd * 5.4, sd * 13.3), xb = Math.max(sd * 5.4, sd * 13.3);
      M.box(xa, top, -84.8, xb, yTop, -84.5, o([0.95, 0.62, 0.32], MAT.GLASS, 0.2, PAT.SHOJI));
      for (let x = xa; x <= xb + 0.01; x += 2.6) M.box(x - 0.15, top, -84.5, x + 0.15, yTop, -84.3, pillar);
      M.box(xa, 4.3, -84.5, xb, 4.6, -84.3, lacD);
      // closed walls on the sides and back
      M.box(sd * 13.3 - 0.15, top, -94.8, sd * 13.3 + 0.15, yTop, -84.6, o(C.verm, MAT.FACADE, 0.02, PAT.PLANKS));
    }
    M.box(-13.3, top, -94.9, 13.3, yTop, -94.6, o(C.vermD, MAT.FACADE));
    // interior: dark floor, coffered ceiling, the golden sanctum (naijin) deep inside
    M.box(-13.2, top, -94.6, 13.2, top + 0.15, -84.6, o([0.08, 0.04, 0.03], MAT.WOOD, 0, PAT.PLANKS), 'Y');
    M.box(-13.3, yTop - 0.05, -94.7, 13.3, yTop + 0.05, -84.3, o([0.25, 0.12, 0.05], MAT.WOOD, 0.1, PAT.SHOJI), 'y');
    for (const x of [-5.4, 5.4]) for (const z of [-87.5, -90.6]) M.cyl(x, top, z, 0.3, yTop - top, 8, o([0.55, 0.06, 0.03], MAT.WOOD, 0.08, PAT.PLANKS));
    const goldE = (e) => o([0.95, 0.68, 0.24], MAT.METAL, e);
    M.box(-6.5, top, -94.5, 6.5, 6.8, -94.3, goldE(0.32), 'Z');                    // gilded back wall
    M.box(-3.6, top, -93.4, 3.6, 3.0, -91.2, goldE(0.45));                          // altar platform
    M.box(-2.4, 3.0, -93.2, 2.4, 5.6, -92.4, goldE(0.6), 'xXZ');                    // zushi (shrine cabinet)
    troof(0, 5.6, -92.8, 5.6, 1.8, 0.8, goldE(0.35), { ridge: 0.6, lift: 0.25, sag: 0.1, th: 0.12, cap: false });
    for (const sd of [-1, 1]) {
      M.lathe(sd * 3.2, 3.0, -91.8, [[0.12, 0], [0.12, 1.2], [0.3, 1.4], [0.02, 1.7]], 6, goldE(0.55));   // candle stands
      M.lathe(sd * 1.8, 4.2, -89.5, [[0.05, 0], [0.5, 0.3], [0.45, 0.9], [0.05, 1.2]], 8, goldE(0.4));      // hanging gold lanterns
      M.cyl(sd * 1.8, 5.4, -89.5, 0.03, 2.3, 4, goldE(0.2));
    }
    M.lathe(0, 6.0, -90.0, [[2.6, 0], [2.2, 0.45], [0.6, 0.7]], 10, goldE(0.3));   // tengai canopy
    // head beams, white bracket band, brackets, then the great roof (eave ≈ 9, ridge ≈ 19)
    for (const z of [-81.8]) {
      M.box(-14, yTop, z - 0.4, 14, yTop + 0.55, z + 0.35, o(C.white, MAT.STONE, 0.1));
      for (let x = -13.2; x <= 13.21; x += 1.2) {
        M.cbox(x, yTop + 0.55, z + 0.2, 0.55, 0.45, 1.2, lacD);
        M.cbox(x, yTop + 1.0, z + 0.55, 0.85, 0.22, 0.9, lac);
        M.cbox(x, yTop + 0.66, z + 0.82, 0.22, 0.22, 0.05, gold, 'Z');
      }
    }
    M.box(-14.6, yTop + 0.55, -95.6, 14.6, yTop + 1.22, -82.0, lacD, 'xXz');
    M.box(-15.2, yTop + 1.22, -96.0, 15.2, yTop + 1.42, -80.6, o([0.12, 0.04, 0.03], MAT.WOOD));
    const ey = 9.1;
    troof(0, ey, zc, 36, 22, 10, tiles, { ridge: 0.42, lift: 1.1, sag: 1.0, th: 0.5, capc: C.ridge, glow: 0.45, soffitE: 0.3, hips: 0.55 });
    // irimoya gables on the hip ends, with gilded fittings
    for (const sd of [-1, 1]) {
      const gx = sd * 11.0;
      M.triF([gx, 14.6, zc - 4.2], [gx, 14.6, zc + 4.2], [gx, 19.1, zc], o(C.white, MAT.FACADE, 0.08), [sd, 0, 0]);
      M.blob(gx + sd * 0.1, 18.1, zc, 0.45, gold, 6, 0.8);
      M.cbox(sd * 11.6, 19.2, zc, 0.8, 1.4, 0.7, o(C.cap, MAT.ROOF));                 // oni-ita
      M.blob(sd * 11.9, 20.8, zc, 0.38, gold, 5, 1.6);
    }
    // plaque under the eave + the Shinbashi lantern
    M.box(-2.0, 5.5, -81.45, 2.0, 7.0, -81.35, o([0.05, 0.03, 0.02], MAT.WOOD), 'Z');
    M.box(-1.8, 5.65, -81.35, 1.8, 6.85, -81.31, o(C.gold, MAT.METAL, 0.3), 'Z');
    chochin(0, 2.15, -80.7, 1.2, 3.0, 0.45);
    M.cyl(0, 2.15 + 3.26, -80.7, 0.06, 2.3, 4, blackM);
    decals.push({ kind: 'kanji', text: '志ん橋', c: [0, 3.68, -80.7 + 1.22], w: 1.0, h: 2.4, col: [0.04, 0.01, 0.01] });
    signs.push({ p: [0, 6.25, -81.2], text: 'SENSO-JI', col: [1, 0.82, 0.45], flick: 0, glow: 0.35 });
    // saisen-bako (offering box), (0, 0, −76.6), facing south
    {
      const bz = -76.6, wd = o([0.3, 0.17, 0.08], MAT.WOOD, 0, PAT.PLANKS), dk = o([0.08, 0.05, 0.03], MAT.WOOD);
      M.box(-1.5, -0.05, bz - 0.5, 1.5, 0.82, bz + 0.5, wd);
      M.box(-1.58, 0.82, bz - 0.58, 1.58, 1.0, bz + 0.58, dk, 'xXZzy');
      for (let x = -1.35; x <= 1.36; x += 0.15) M.box(x - 0.045, 0.82, bz - 0.5, x + 0.045, 1.02, bz + 0.5, o([0.4, 0.24, 0.12], MAT.WOOD), 'Yxz');
      for (const sd of [-1, 1]) M.box(sd * 1.5 - 0.06, 0.1, bz + 0.5, sd * 1.5 + 0.06, 1.0, bz + 0.6, gold, 'Z');
      M.box(-1.5, 0.1, bz + 0.5, 1.5, 0.2, bz + 0.6, gold, 'ZY');
      M.box(-0.7, 0.35, bz + 0.5, 0.7, 0.62, bz + 0.53, o([0.75, 0.55, 0.2], MAT.METAL, 0.1), 'Z');   // brass plate
      solid(-1.6, bz - 0.6, 1.6, bz + 0.6);
      anchors.pray = [0, 0, -75.2];
      // the bell rope (suzu no o) above, hanging from the eave
      wires.push([[0.6, 8.6, -79.2], [0.6, 1.3, -77.6], 0.15]);
      M.blob(0.6, 8.2, -79.2, 0.28, gold, 6);
    }
    solid(-14.4, -95.4, 14.4, zF);
    solid(-6.65, zF, 6.65, -78);
    L([0, 3.6, -78.2], RED, 9, 1.7, 0.03);                          // lantern pool on the stairs
    L([0, 4.2, -88.8], [1, 0.72, 0.32], 11, 1.8);                    // golden sanctum
    for (const sd of [-1, 1]) L([sd * 9, 0.7, -77.2], FLOOD, 10, 1.3);  // uplights on the facade
    L([0, 12, -73], [1, 0.6, 0.36], 13, 0.85);                      // roof wash
  }

  // ───────── OMIKUJI stand (9, −73) + the rack of tied fortunes ─────────
  {
    const x = 9, z = -73, wd = o([0.62, 0.42, 0.22], MAT.GLASS, 0.12, PAT.SHOJI);
    M.box(x - 1.9, -0.05, z - 0.9, x + 1.9, 0.9, z + 0.9, o(C.woodD, MAT.WOOD, 0, PAT.PLANKS));            // counter base
    M.box(x - 2.0, 0.9, z - 0.5, x + 2.0, 1.02, z + 1.05, o(C.vermD, MAT.WOOD));                            // counter top
    M.box(x - 1.75, 1.02, z - 0.9, x + 1.75, 3.1, z - 0.35, wd);                                            // ~100 tiny drawers
    for (let i = 0; i < 5; i++) M.box(x - 1.75, 1.08 + i * 0.4, z - 0.36, x + 1.75, 1.11 + i * 0.4, z - 0.3, o([0.12, 0.06, 0.03], MAT.WOOD), 'ZY');
    for (const sd of [-1, 1]) M.box(x + sd * 1.9 - 0.11, -0.05, z - 0.95, x + sd * 1.9 + 0.11, 3.5, z - 0.75, pillar);
    for (const sd of [-1, 1]) M.box(x + sd * 1.9 - 0.11, 1.0, z + 0.85, x + sd * 1.9 + 0.11, 3.5, z + 1.05, pillar);
    M.box(x - 2.1, 3.3, z - 1.0, x + 2.1, 3.55, z + 1.1, lac);
    troof(x, 3.55, z, 5.0, 2.9, 0.9, tiles, { ridge: 0.6, lift: 0.3, sag: 0.15, th: 0.18, capc: C.ridge, glow: 0.3 });
    // hexagonal shaking box on the counter
    M.lathe(x - 0.8, 1.02, z + 0.4, [[0.17, 0], [0.17, 0.62]], 6, o([0.5, 0.33, 0.15], MAT.WOOD), true);
    M.lathe(x - 0.25, 1.02, z + 0.45, [[0.17, 0], [0.17, 0.62]], 6, o([0.5, 0.33, 0.15], MAT.WOOD), true);
    M.cbox(x + 0.6, 1.02, z + 0.5, 0.6, 0.04, 0.4, o([0.9, 0.86, 0.75], MAT.PAPER, 0.15));                  // a fortune slip
    M.box(x - 1.4, 3.1, z + 1.04, x + 1.4, 3.32, z + 1.1, o(C.gold, MAT.METAL, 0.25), 'Z');
    signs.push({ p: [x + 2.35, 3.0, z + 1.2], text: 'OMIKUJI', col: [1, 0.85, 0.55], v: true, flick: 0, glow: 0.45 });
    solid(x - 2.1, z - 1.0, x + 2.1, z + 0.95);
    // rack (x 10.5..12.5 → set a little east so the stand's eave clears it)
    const rx0 = 11.3, rx1 = 13.3, rz = -73.2, rw = o(C.woodD, MAT.WOOD);
    for (const xx of [rx0, rx1]) M.box(xx - 0.07, -0.05, rz - 0.07, xx + 0.07, 2.1, rz + 0.07, rw);
    for (let r = 0; r < 4; r++) {
      const yy = 0.75 + r * 0.38;
      M.box(rx0, yy, rz - 0.03, rx1, yy + 0.03, rz + 0.03, rw);
      for (let xx = rx0 + 0.08; xx < rx1 - 0.05; xx += 0.085) {
        if (R() < 0.12) continue;
        M.cbox(xx, yy - 0.09 - R() * 0.03, rz + 0.05, 0.065, 0.15, 0.06, o([0.88, 0.86, 0.8], MAT.PAPER, 0.06));
      }
    }
    M.box(rx0 - 0.12, 2.1, rz - 0.2, rx1 + 0.12, 2.22, rz + 0.2, o(C.vermD, MAT.WOOD));
    solid(rx0 - 0.15, rz - 0.15, rx1 + 0.15, rz + 0.15);
    L([x, 2.4, z + 2.3], [1, 0.72, 0.42], 7.5, 1.2);
    anchors.omikuji = [x, 0, -71.2];
  }

  // ───────── TAIKO-BASHI (arched bridge) along z = −62, x 12 → 30 ─────────
  {
    const zc = -62, z0 = -62.8, z1 = -61.2, N = 24, deckC = o([0.48, 0.07, 0.035], MAT.WOOD, 0, PAT.PLANKS);
    const yAt = (x) => 1.4 * Math.sin(Math.PI * (x - 12) / 18);
    for (let i = 0; i < N; i++) {
      const xa = 12 + i * 18 / N, xb = 12 + (i + 1) * 18 / N, ya = yAt(xa), yb = yAt(xb);
      M.quadF([xa, ya, z1], [xb, yb, z1], [xb, yb, z0], [xa, ya, z0], deckC, [0, 1, 0]);
      M.quadF([xa, ya - 0.28, z1], [xb, yb - 0.28, z1], [xb, yb, z1], [xa, ya, z1], o(C.verm, MAT.WOOD), [0, 0, 1]);   // fascia
      M.quadF([xa, ya - 0.28, z0], [xb, yb - 0.28, z0], [xb, yb, z0], [xa, ya, z0], o(C.verm, MAT.WOOD), [0, 0, -1]);
      M.quadF([xa, ya - 0.28, z1], [xb, yb - 0.28, z1], [xb, yb - 0.28, z0], [xa, ya - 0.28, z0], o(C.vermD, MAT.WOOD), [0, -1, 0]);
    }
    // railings: posts with black caps, top + mid rails following the arch
    for (const zz of [z0 + 0.08, z1 - 0.08]) {
      for (let i = 0; i <= 8; i++) {
        const xx = 12.3 + i * (17.4 / 8), yy = yAt(xx);
        M.box(xx - 0.09, yy - 0.3, zz - 0.09, xx + 0.09, yy + 1.05, zz + 0.09, o(C.verm, MAT.WOOD, 0, PAT.PLANKS));
        M.lathe(xx, yy + 1.05, zz, [[0.11, 0], [0.13, 0.08], [0.02, 0.3]], 6, (i === 0 || i === 8) ? gold : blackM);
      }
      for (let i = 0; i < 16; i++) {
        const xa = 12.3 + i * 17.4 / 16, xb = 12.3 + (i + 1) * 17.4 / 16;
        beam([xa, yAt(xa) + 0.92, zz], [xb, yAt(xb) + 0.92, zz], 0.1, 0.1, lac);
        beam([xa, yAt(xa) + 0.45, zz], [xb, yAt(xb) + 0.45, zz], 0.07, 0.07, lac);
      }
    }
    // small red lanterns hung from the four end posts: their glow is what the water mirrors around the bridge
    for (const xx of [12.3, 29.7]) for (const zz of [z0 - 0.25, z1 + 0.25]) {
      const yy = yAt(xx);
      M.box(xx - 0.03, yy + 0.95, Math.min(zz, zz > zc ? zz - 0.3 : zz + 0.3), xx + 0.03, yy + 1.0, Math.max(zz, zz > zc ? zz - 0.3 : zz + 0.3), blackM);
      chochin(xx, yy + 0.35, zz, 0.2, 0.5, 0.95);
    }
    for (const xx of [12.3, 29.7]) L([xx, 1.2, zc], RED, 6.5, 1.0, 0.05);
    // piers in the water
    for (const xx of [15.5, 21, 26.5]) for (const zz of [z0 + 0.15, z1 - 0.15]) M.cyl(xx, -0.4, zz, 0.12, yAt(xx) + 0.15, 6, o(C.vermD, MAT.WOOD));
    // stone landings at both ends
    M.box(10.6, -0.05, z0 - 0.3, 12.05, 0.05, z1 + 0.3, o(C.stoneL, MAT.STONE, 0, PAT.PAVING), 'xYZz');
    M.box(29.95, -0.05, z0 - 0.3, 31.0, 0.05, z1 + 0.3, o(C.stoneL, MAT.STONE, 0, PAT.PAVING), 'XYZz');
    // keep the player off the railings' outside: thin colliders along the bridge, open at the ends
    solid(12.4, z0 - 0.35, 29.6, z0 - 0.1); solid(12.4, z1 + 0.1, 29.6, z1 + 0.35);
  }
  // pond colliders: the ellipse as a stack of boxes, leaving the bridge corridor open
  for (let zz = -73; zz < -51; zz += 1) {
    const zm = zz + 0.5, t = 1 - ((zm - POND.cz) / POND.rz) ** 2;
    if (t <= 0) continue;
    if (zm > -63.2 && zm < -60.8) continue;
    const hw = POND.rx * Math.sqrt(t) - 0.15;
    solid(POND.cx - hw, zz, POND.cx + hw, zz + 1);
  }

  // ───────── BENTEN-DŌ: small octagonal shrine at the east end (32.5, −62) ─────────
  {
    const x = 33.1, z = -62;
    M.lathe(x, -0.05, z, [[2.0, 0], [2.0, 0.5], [1.85, 0.55]], 8, o(C.stoneL, MAT.STONE), true);
    M.lathe(x, 0.55, z, [[1.3, 0], [1.3, 2.0]], 8, o(C.white, MAT.FACADE, 0.04), true);
    for (let i = 0; i < 8; i++) { const a = (i + 0.5) / 8 * TAU; M.cyl(x + Math.cos(a) * 1.38, 0.55, z + Math.sin(a) * 1.38, 0.1, 2.2, 6, pillar); }
    M.lathe(x, 2.55, z, [[1.55, 0], [1.55, 0.22]], 8, lac);
    M.lathe(x, 2.75, z, [[2.4, 0.35], [2.0, 0.3], [1.0, 1.05], [0.15, 1.35]], 8, tiles);
    M.lathe(x, 2.75, z, [[2.4, 0.2], [2.4, 0.35]], 8, o([0.12, 0.05, 0.03], MAT.WOOD));
    M.lathe(x, 4.1, z, [[0.2, 0], [0.24, 0.15], [0.05, 0.55]], 6, gold);
    // doors face west (toward the bridge) and south
    M.box(x - 1.32, 0.6, z - 0.5, x - 1.27, 2.1, z + 0.5, o([0.05, 0.035, 0.03], MAT.WOOD), 'x');
    M.box(x - 0.5, 0.6, z + 1.27, x + 0.5, 2.1, z + 1.32, o([1, 0.66, 0.32], MAT.GLASS, 0.3, PAT.SHOJI), 'Z');
    for (const sd of [-1, 1]) {
      M.cyl(x - 2.3, 0, z + sd * 1.7, 0.05, 2.2, 4, blackM);
      chochin(x - 2.3, 1.15, z + sd * 1.7, 0.3, 0.75, 0.9);
    }
    solid(x - 1.9, z - 1.9, x + 1.9, z + 1.9);
    L([x - 3.0, 1.6, z], RED, 7, 1.3, 0.05);
    signs.push({ p: [x - 2.6, 2.6, z + 3.4], text: 'BENTEN-DO', col: [1, 0.78, 0.5], flick: 0, glow: 0.3 });
  }

  // ───────── pond lanterns + trees ─────────
  for (const [x, z, s] of [[14.2, -51.5, 0.95], [28.6, -52.5, 1.0], [28.6, -73.2, 1.05], [13.0, -70.6, 0.9]]) toro(x, z, s);
  L([14.4, 2.0, -51.2], WARM, 8, 1.1);
  L([28.4, 2.0, -52.2], WARM, 8, 1.1);
  L([28.4, 2.0, -72.8], WARM, 8, 1.1);
  L([13.0, 1.8, -69.6], WARM, 7, 0.9);
  L([20.8, 3.5, -74.4], [1, 0.62, 0.25], 10, 1.5);                 // uplight on the big ginkgo + maple + pine
  L([29.6, 3.0, -74.6], [1, 0.7, 0.3], 7, 1.0);                    // ginkgo + pine uplight on the north shore
  // trees stand on the far (north) and east shores: anything tall on the near shore would sit between
  // the camera and the water. Their lit crowns are what the far half of the pond reflects.
  maple(15.6, -76.0, 1.05, 17.2, -72.6);                           // overhangs the north-west water
  maple(30.4, -67.6, 1.0, 27.9, -65.6);                            // overhangs the east water
  ginkgo(21.6, -77.4, 1.45);                                       // tall, due north: its reflection fills the far half
  ginkgo(32.0, -75.0, 0.95);
  pine(25.6, -76.6, 1.1, -1.2, 2.4);                               // big black pine leaning out over the north shore
  for (const [x, z] of [[15.6, -76], [30.4, -67.6], [21.6, -77.4], [32, -75], [25.6, -76.6]]) solid(x - 0.4, z - 0.4, x + 0.4, z + 0.4);
  // nakajima: a rocky islet with a small pine and a snow-viewing lantern (yukimi-dōrō) whose window and
  // reflection fill the near water, which otherwise only mirrors the dark upper sky
  {
    const I = ISLET;
    M.push(M4.mul(M4.trans(I.cx, 0, I.cz), M4.scale(I.rx, 1, I.rz)));
    M.lathe(0, -0.3, 0, [[1.02, 0], [0.98, 0.34], [0.6, 0.42], [0.01, 0.45]], 9, o([0.07, 0.13, 0.05], MAT.GRASS));
    M.pop();
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * TAU + R() * 0.3, r = 0.3 + R() * 0.25, g = 0.24 + R() * 0.1;
      M.lathe(I.cx + Math.cos(a) * I.rx * 0.98, -0.15, I.cz + Math.sin(a) * I.rz * 0.98, [[r, 0], [r * 0.7, r * 0.9], [0.01, r * 1.1]], 5, o([g, g, g * 0.95], MAT.STONE));
    }
    // yukimi-dōrō: three splayed legs, wide umbrella roof, lit window
    const yx = I.cx - 0.5, yz = I.cz + 0.5, st = o(C.stoneL, MAT.STONE);
    for (let i = 0; i < 3; i++) { const a = i / 3 * TAU + 0.5; tube([yx + Math.cos(a) * 0.55, 0.3, yz + Math.sin(a) * 0.55], [yx + Math.cos(a) * 0.22, 0.95, yz + Math.sin(a) * 0.22], 0.07, 0.06, st, 4); }
    M.lathe(yx, 0.95, yz, [[0.4, 0], [0.4, 0.12]], 6, st, true);
    M.lathe(yx, 1.07, yz, [[0.24, 0], [0.24, 0.36]], 6, o([1, 0.7, 0.34], MAT.PAPER, 0.95), true);
    M.lathe(yx, 1.43, yz, [[0.95, 0.06], [0.9, 0.1], [0.5, 0.3], [0.08, 0.42]], 6, st);
    M.lathe(yx, 1.85, yz, [[0.12, 0], [0.14, 0.12], [0.02, 0.26]], 6, st);
    L([yx, 1.25, yz + 0.6], WARM, 7, 1.2, 0.03);
    pine(I.cx + 0.9, I.cz - 0.4, 0.55, 0.9, 0.5);
  }
  // tall uplit ginkgos behind the north shore: tall enough (~15 m) to land in the middle of the pond's reflection
  ginkgo(19.5, -81.5, 1.35); ginkgo(27.5, -82.5, 1.45); ginkgo(33.0, -80.0, 1.2);
  for (const [x, z] of [[19.5, -81.5], [27.5, -82.5], [33, -80]]) solid(x - 0.6, z - 0.6, x + 0.6, z + 0.6);
  L([23.5, 7.5, -77.8], [1, 0.7, 0.3], 13, 1.5);
  // lily pads drifting in the near half (y −0.03: below the mirror-pass cut, so they never hide a reflection)
  for (const [cx, cz, n] of [[16.5, -56.5, 5], [19.5, -53.2, 4], [27.0, -58.8, 4], [15.2, -66.8, 3], [22.2, -68.5, 4], [18.0, -59.3, 3]]) {
    for (let i = 0; i < n; i++) {
      const x = cx + (R() - 0.5) * 1.8, z = cz + (R() - 0.5) * 1.3, r = 0.22 + R() * 0.16, g = 0.6 + R() * 0.5;
      if (!isWater(x, z)) continue;
      M.lathe(x, -0.03, z, [[r, 0], [0.01, 0.005]], 7, o([0.05 * g, 0.15 * g, 0.06 * g], MAT.FOLIAGE));
    }
  }
  // hōnō-chōchin rack on the north shore: a row of donated paper lanterns, mirrored in the far water
  {
    const z = -74.4, xs = [14.6, 27.4], wd = o(C.woodD, MAT.WOOD);
    for (const x of xs) M.box(x - 0.08, -0.05, z - 0.08, x + 0.08, 3.0, z + 0.08, wd);
    M.box(xs[0] - 0.2, 2.95, z - 0.1, xs[1] + 0.2, 3.1, z + 0.1, wd);
    M.box(xs[0] - 0.4, 3.1, z - 0.35, xs[1] + 0.4, 3.22, z + 0.35, o(C.roof, MAT.ROOF, 0.04, PAT.TILES));
    for (let i = 0; i < 12; i++) {
      const x = xs[0] + 0.55 + i * (xs[1] - xs[0] - 1.1) / 11;
      M.cyl(x, 2.62, z, 0.012, 0.33, 3, blackM, false);
      M.lathe(x, 1.95, z, [[0.12, 0], [0.2, 0.1], [0.21, 0.36], [0.2, 0.56], [0.12, 0.66]], 7, o(i % 3 === 1 ? [1, 0.88, 0.7] : C.lantern, MAT.PAPER, 0.85, PAT.RIBS));
    }
    solid(xs[0] - 0.2, z - 0.2, xs[1] + 0.2, z + 0.2);
    L([21, 2.6, -73.2], [1, 0.45, 0.2], 7, 1.0, 0.04);
  }
  // more trees around the precinct
  maple(-25.6, -45.2, 1.0, -23.6, -47.6);
  maple(-7.5, -66.5, 0.9, -8.5, -68.0);
  ginkgo(-24.5, -73.5, 1.15);
  ginkgo(18.5, -82.5, 1.2);
  ginkgo(-18.5, -84.5, 1.15);
  pine(-11.5, -77.0, 0.95, -1.0, 0.4);
  for (const [x, z] of [[-25.6, -45.2], [-7.5, -66.5], [-24.5, -73.5], [18.5, -82.5], [-18.5, -84.5], [-11.5, -77]]) solid(x - 0.4, z - 0.4, x + 0.4, z + 0.4);

  anchors.pondShore = [12.6, 0, -67];

  // ───────── surroundings ─────────
  // low two-storey machiya behind the Nakamise stalls, tiled roofs, a few lit upstairs windows
  for (const side of [-1, 1]) {
    for (let z = -8.4; z > -33; ) {
      const d = 5.5 + R() * 2.5, z1 = z, z0 = Math.max(-34, z - d);
      let x = 9.0;
      while (x < 29) {
        const w = 5 + R() * 3.5, xa = side > 0 ? x : -x - w, xb = side > 0 ? x + w : -x, h = 5.2 + (R() > 0.5 ? 1.2 : 0);
        M.box(xa, -0.05, z0, xb, 3.0, z1, o(C.woodD, MAT.FACADE, 0, PAT.PLANKS), 'xXZz');
        M.box(xa + 0.15, 3.0, z0 + 0.15, xb - 0.15, h, z1 - 0.15, o([0.42, 0.4, 0.36], MAT.FACADE), 'xXZz');
        M.box(xa - 0.2, 2.9, z0 - 0.4, xb + 0.2, 3.15, z1 + 0.4, o(C.roof, MAT.ROOF, 0, PAT.TILES), 'xXYZz');   // pent roof between floors
        if (R() < 0.55) M.box((xa + xb) / 2 - w * 0.3, h - 1.7, z1 - 0.15, (xa + xb) / 2 + w * 0.3, h - 0.6, z1 - 0.1, o([1, 0.66, 0.34], MAT.GLASS, 0.3 + R() * 0.25, PAT.SHOJI), 'Z');
        troof((xa + xb) / 2, h, (z0 + z1) / 2, w + 0.9, z1 - z0 + 0.9, 1.8, tiles, { ridge: 0.55, lift: 0.2, sag: 0.15, th: 0.2, capc: C.cap });
        x += w + 0.4;
      }
      z = z0 - 0.6;
    }
    solid(side > 0 ? 8.9 : -30, -34, side > 0 ? 30 : -8.9, -8.2);
  }
  // tsuiji-bei: plaster wall with a tiled cap around the precinct
  const wallO = o([0.5, 0.47, 0.42], MAT.FACADE, 0, PAT.PLANKS), wallBase = o(C.stoneD, MAT.STONE);
  function tsuiji(xa, za, xb, zb) {
    const len = Math.hypot(xb - xa, zb - za), ang = Math.atan2(-(zb - za), xb - xa);
    M.at((xa + xb) / 2, 0, (za + zb) / 2, ang);
    M.box(-len / 2, -0.05, -0.4, len / 2, 0.5, 0.4, wallBase);
    M.box(-len / 2, 0.5, -0.32, len / 2, 2.3, 0.32, wallO);
    for (let i = 0; i < 3; i++) M.box(-len / 2, 1.2 + i * 0.3, 0.32, len / 2, 1.24 + i * 0.3, 0.34, o(C.white, MAT.STONE), 'Z');
    troof(0, 2.3, 0, len + 0.4, 1.3, 0.45, tiles, { ridge: 0.99, lift: 0.08, sag: 0.05, th: 0.12, capc: C.cap });
    M.pop();
    solid(Math.min(xa, xb) - 0.4, Math.min(za, zb) - 0.4, Math.max(xa, xb) + 0.4, Math.max(za, zb) + 0.4);
  }
  tsuiji(-30, -34.5, -30, -99);
  tsuiji(36, -34.5, 36, -99);
  tsuiji(-30, -99.5, 36, -99.5);
  tsuiji(9.6, -34.5, 36, -34.5);
  tsuiji(-30, -34.5, -9.6, -34.5);
  // dark tree masses: north of the hall, along the walls, outside them
  grove(-34, -126, 42, -101, 24, 9, 14);
  grove(-29, -98, -24, -78, 6, 6, 9);
  grove(-29, -58, -24, -36, 5, 5, 8);
  grove(25, -97, 35, -82, 6, 6, 9);
  grove(32.5, -58, 35, -37, 4, 5, 8);
  grove(-48, -110, -32, -20, 14, 7, 12);
  grove(38, -110, 54, -20, 14, 7, 12);
  // the city beyond: modern towers with lit windows, a few red aviation lights
  for (const [x0, z0, x1, z1, h] of [
    [-74, -30, -56, -16, 34], [-70, -62, -54, -44, 48], [-80, -98, -60, -78, 28], [-66, -128, -50, -110, 40],
    [56, -28, 72, -14, 30], [58, -60, 78, -42, 52], [60, -96, 76, -80, 36], [54, -130, 72, -112, 44],
    [-30, -170, -10, -150, 46], [10, -175, 32, -155, 38],
  ]) {
    M.box(x0, -0.05, z0, x1, h, z1, o(R() > 0.5 ? COL.concrete : COL.concreteW, MAT.FACADE, 0, PAT.WINDOWS), 'xXYZz');
    M.cbox(x0 + 2, h, z0 + 2, 1.2, 0.5, 1.2, o([1, 0.12, 0.08], MAT.NEON, 1));
  }

  // ───────── signs ─────────
  signs.push({ p: [0, 7.75, -35.4], text: 'HOZOMON', col: [1, 0.8, 0.45], flick: 0, glow: 0.3 });
  void v0;
}
