// ───────────────────────── world: Asakusa, compressed ─────────────────────────
// x → east, z → south, y ↑. The player walks north (−z): neon side street → avenue →
// Kaminarimon → Nakamise → Hozomon → temple grounds.
const COL = {
  asphalt: [0.055, 0.055, 0.065], paint: [0.62, 0.62, 0.58], walk: [0.2, 0.19, 0.19], stone: [0.24, 0.22, 0.2],
  verm: [0.66, 0.08, 0.035], vermD: [0.36, 0.045, 0.025], roof: [0.17, 0.19, 0.24], roofCap: [0.08, 0.08, 0.1],
  black: [0.025, 0.022, 0.022], lantern: [0.9, 0.12, 0.05], gold: [0.75, 0.55, 0.18], concrete: [0.15, 0.15, 0.17],
  concreteW: [0.2, 0.18, 0.17], wood: [0.28, 0.17, 0.09], woodD: [0.14, 0.08, 0.05], plaster: [0.55, 0.52, 0.46],
  ginkgo: [0.85, 0.66, 0.08], maple: [0.85, 0.16, 0.05], pine: [0.08, 0.2, 0.1], skin: [0.6, 0.45, 0.35],
};

function buildWorld() {
  const M = new Mesh();
  const lights = [], signs = [], decals = [], colliders = [];
  const R = rng(7);
  const o = (c, m, e = 0, p = 0) => ({ c, m, e, p });
  const L = (p, c, r, i, flick = 0) => lights.push({ p, c, r, i, base: i, flick });
  const solid = (x0, z0, x1, z1) => colliders.push([Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1)]);

  // ── ground
  M.ground(-60, 16, 60, 27, 0, o(COL.asphalt, MAT.ASPHALT, 0, PAT.ASPHALT));      // avenue (Kaminarimon-dori)
  M.ground(-60, 27, 60, 31, 0.02, o(COL.walk, MAT.STONE, 0, PAT.PAVING));         // south sidewalk
  M.ground(-60, 3, 60, 16, 0.02, o(COL.walk, MAT.STONE, 0, PAT.PAVING));          // north sidewalk / gate forecourt
  M.ground(-3, 31, 3, 72, 0, o(COL.asphalt, MAT.ASPHALT, 0, PAT.ASPHALT));        // neon side street
  M.ground(-4.6, 31, -3, 72, 0.04, o(COL.walk, MAT.STONE, 0, PAT.PAVING));
  M.ground(3, 31, 4.6, 72, 0.04, o(COL.walk, MAT.STONE, 0, PAT.PAVING));
  M.ground(-4, -34.5, 4, 3, 0.03, o(COL.stone, MAT.STONE, 0, PAT.PAVING));         // Nakamise path
  // curbs
  M.box(-60, 0, 26.85, 60, 0.12, 27.05, o(COL.stone, MAT.STONE));
  M.box(-60, 0, 15.95, 60, 0.12, 16.15, o(COL.stone, MAT.STONE));
  // lane markings: dashed centre line, side-street edge lines, "止まれ"-style stop bar
  for (let x = -58; x < 58; x += 4) if (Math.abs(x + 1) > 5) M.box(x, 0.005, 21.45, x + 2.2, 0.012, 21.6, o(COL.paint, MAT.ASPHALT));
  for (const x of [-2.75, 2.65]) M.box(x, 0.005, 31.5, x + 0.1, 0.012, 72, o(COL.paint, MAT.ASPHALT));
  M.box(-2.6, 0.005, 32.2, 2.6, 0.012, 32.6, o(COL.paint, MAT.ASPHALT));
  // zebra crossing: bars parallel to the walking direction
  for (let x = -3.2; x <= 3.2; x += 0.9) M.box(x - 0.24, 0.005, 16.6, x + 0.24, 0.014, 26.4, o(COL.paint, MAT.ASPHALT, 0.02));

  // ── street lamps (avenue)
  for (const x of [-30, -18, -8, 8, 18, 30]) for (const z of [15.4, 27.6]) {
    M.cyl(x, 0, z, 0.08, 5.2, 6, o([0.12, 0.12, 0.13], MAT.METAL));
    M.box(x - 0.6, 5.1, z - 0.12, x + 0.6, 5.25, z + 0.12, o([0.12, 0.12, 0.13], MAT.METAL));
    M.cbox(x, 4.95, z, 0.9, 0.16, 0.3, o([1, 0.8, 0.55], MAT.PAPER, 1));
    L([x, 4.6, z], [1, 0.72, 0.45], 13, 1.3);
  }
  // pedestrian signals
  for (const [x, z, s] of [[-4.2, 15.6, 1], [4.2, 27.4, -1]]) {
    M.cyl(x, 0, z, 0.07, 3, 6, o([0.15, 0.15, 0.16], MAT.METAL));
    M.cbox(x, 2.3, z, 0.4, 0.7, 0.3, o([0.05, 0.05, 0.05], MAT.METAL));
    M.cbox(x, 2.35, z + 0.16 * s, 0.26, 0.26, 0.04, o([0.1, 1, 0.6], MAT.NEON, 1));
    L([x, 2.4, z + 0.4 * s], [0.1, 1, 0.6], 4, 0.6);
  }

  // ── modern block: towers south of the avenue, a narrow neon side street between them
  const neonCols = [[1, 0.25, 0.55], [0.2, 0.9, 1], [1, 0.62, 0.15], [0.7, 0.35, 1], [0.3, 1, 0.45], [1, 0.9, 0.3]];
  function tower(x0, z0, x1, z1, h) {
    M.box(x0, 0, z0, x1, h, z1, o(R() > 0.5 ? COL.concrete : COL.concreteW, MAT.FACADE, 0, PAT.WINDOWS));
    M.box(x0 + 0.5, h, z0 + 0.5, x0 + 2.2, h + 1.6, z0 + 2, o([0.12, 0.12, 0.13], MAT.METAL));
    if (R() > 0.4) M.cyl((x0 + x1) / 2 + 1, h, (z0 + z1) / 2, 0.9, 2.2, 7, o([0.14, 0.14, 0.15], MAT.METAL));
    solid(x0, z0, x1, z1);
  }
  const blocks = [
    [-12, 31, -4.6, 38, 14], [-12, 38, -4.6, 45, 23], [-12, 45, -4.6, 53, 11], [-12, 53, -4.6, 61, 17], [-12, 61, -4.6, 72, 26],
    [4.6, 31, 11, 39, 10], [4.6, 39, 12, 46, 19], [4.6, 46, 11, 55, 13], [4.6, 55, 12, 63, 21], [4.6, 63, 12, 72, 15],
    [-24, 31, -12, 40, 18], [-34, 31, -24, 39, 12], [-46, 31, -34, 40, 21], [-60, 31, -46, 38, 15],
    [12, 31, 23, 40, 16], [23, 31, 35, 38, 24], [35, 31, 47, 40, 13], [47, 31, 60, 39, 19],
  ];
  blocks.forEach(b => tower(b[0], b[1], b[2], b[3], b[4]));
  // avenue-facing shop fronts
  blocks.forEach((b, i) => {
    const [x0, z0, x1] = b, nc = neonCols[i % neonCols.length];
    M.box(x0 + 0.4, 0.1, z0 - 0.06, x1 - 0.4, 2.8, z0, o([nc[0] * 0.5 + 0.35, nc[1] * 0.5 + 0.35, nc[2] * 0.5 + 0.35], MAT.GLASS, 0.45, PAT.SHOJI), 'z');
    M.box(x0 + 0.2, 2.9, z0 - 0.9, x1 - 0.2, 3.1, z0, o([0.08, 0.08, 0.09], MAT.METAL));
    L([(x0 + x1) / 2, 2.2, z0 - 1.5], [nc[0] * 0.6 + 0.4, nc[1] * 0.6 + 0.4, nc[2] * 0.6 + 0.4], 7, 0.55);
  });
  // side-street shop fronts: every few metres a lit doorway, noren, a light pool on the street
  const fronts = [
    // [side, z0, z1, colour, kind]
    [-1, 38.5, 44.5, [1, 0.6, 0.3], 'izakaya'], [-1, 45.5, 52.5, [1, 0.35, 0.5], 'bar'], [-1, 53.5, 60.5, [0.5, 0.8, 1], 'cafe'], [-1, 61.5, 70, [1, 0.75, 0.4], 'ramen'],
    [1, 39.5, 45.5, [0.8, 0.5, 1], 'karaoke'], [1, 46.5, 54.5, [1, 0.55, 0.25], 'yakitori'], [1, 55.5, 62.5, [0.4, 1, 0.7], 'game'], [1, 63.5, 71, [1, 0.85, 0.5], 'sushi'],
  ];
  for (const [side, z0, z1, c, kind] of fronts) {
    const x = side * 4.6;
    M.box(Math.min(x, x - side * 0.05), 0.1, z0, Math.max(x, x - side * 0.05), 2.7, z1, o([c[0] * 0.6 + 0.3, c[1] * 0.6 + 0.3, c[2] * 0.6 + 0.3], MAT.GLASS, 0.55, kind === 'game' ? PAT.DRINKS : PAT.SHOJI), side > 0 ? 'x' : 'X');
    M.box(Math.min(x, x - side * 0.8), 2.75, z0, Math.max(x, x - side * 0.8), 2.95, z1, o([0.06, 0.06, 0.07], MAT.METAL));
    if (kind === 'izakaya' || kind === 'ramen' || kind === 'yakitori') {
      M.box(Math.min(x, x - side * 0.06), 1.9, z0 + 1, Math.max(x, x - side * 0.06) + 0.0, 2.7, z0 + 3.2, o([0.55, 0.06, 0.04], MAT.CLOTH), side > 0 ? 'x' : 'X');
      for (const zz of [z0 + 0.6, z0 + 3.6]) {
        M.lathe(x - side * 0.45, 1.95, zz, [[0.16, 0], [0.24, 0.16], [0.24, 0.48], [0.16, 0.62]], 7, o([1, 0.25, 0.08], MAT.PAPER, 0.95, PAT.RIBS));
        L([x - side * 0.9, 2.2, zz], [1, 0.42, 0.15], 5, 0.8, 0.05);
      }
    }
    L([x - side * 1.6, 1.6, (z0 + z1) / 2], c, 7.5, 0.9);
  }
  // blade signs (tategata kanban) hanging over the street, facing south toward the camera
  const blades = [
    [-1, 35, 'RAMEN', 3.2, 0], [-1, 40.5, 'IZAKAYA', 3.6, 2], [-1, 47.5, 'BAR', 5.5, 0], [-1, 52, 'SNACK', 3.4, 3], [-1, 57, 'CAFE', 4.2, 1], [-1, 64, 'HOTEL', 6, 3],
    [1, 37.5, 'SUSHI', 3.3, 5], [1, 42, 'KARAOKE', 4, 3], [1, 48.5, 'YAKITORI', 3.4, 2], [1, 54, 'MAHJONG', 5, 1], [1, 59, 'GAME', 3.6, 4], [1, 66, 'SENTO', 4.4, 0],
  ];
  blades.forEach(([side, z, text, y0, ci], i) => {
    const c = neonCols[ci], xi = side * 4.55, xo = side * 3.65, h = text.length * 0.62 + 0.5;
    M.box(Math.min(xi, xo), y0, z - 0.1, Math.max(xi, xo), y0 + h, z + 0.1, o([c[0] * 0.2, c[1] * 0.2, c[2] * 0.2], MAT.NEON, 0.35));
    M.box(Math.min(xi, xo) + 0.06, y0 + 0.08, z + 0.1, Math.max(xi, xo) - 0.06, y0 + h - 0.08, z + 0.13, o([c[0] * 0.12, c[1] * 0.12, c[2] * 0.12], MAT.GLASS, 0.15), 'Z');
    signs.push({ p: [(xi + xo) / 2, y0 + h - 0.35, z + 0.2], text, col: c.map(v => v * 0.5 + 0.5), v: true, flick: i === 3 ? 0.3 : i === 8 ? 0.12 : 0, glow: 1 });
    L([(xi + xo) / 2 - side * 0.6, y0 + h / 2, z + 0.6], c, 7, 1.0);
  });
  // utility poles + overhead wires: the most Tokyo thing there is
  const poles = [];
  for (const z of [33, 43, 53, 63, 73]) for (const side of [-1, 1]) {
    const x = side * 3.35;
    M.cyl(x, 0, z, 0.13, 9.5, 6, o([0.18, 0.18, 0.19], MAT.METAL));
    M.box(x - 0.9, 8.6, z - 0.07, x + 0.9, 8.75, z + 0.07, o([0.18, 0.18, 0.19], MAT.METAL));
    M.box(x - 0.7, 7.6, z - 0.06, x + 0.7, 7.72, z + 0.06, o([0.18, 0.18, 0.19], MAT.METAL));
    M.cyl(x + side * 0.35, 6.4, z, 0.28, 0.9, 7, o([0.25, 0.26, 0.27], MAT.METAL));   // transformer drum
    // little street lamp arm
    M.box(Math.min(x, x - side * 1.3), 5.6, z - 0.05, Math.max(x, x - side * 1.3), 5.7, z + 0.05, o([0.18, 0.18, 0.19], MAT.METAL));
    M.cbox(x - side * 1.3, 5.45, z, 0.32, 0.15, 0.2, o([0.85, 0.95, 1], MAT.PAPER, 1));
    L([x - side * 1.3, 5.2, z], [0.85, 0.92, 1], 9, 1.1);
    poles.push([x, z, side]);
    solid(x - 0.2, z - 0.2, x + 0.2, z + 0.2);
  }
  const wires = [];
  for (const side of [-1, 1]) {
    const ps = poles.filter(p => p[2] === side).sort((a, b) => a[1] - b[1]);
    for (let i = 0; i < ps.length - 1; i++) for (const [dx, y] of [[-0.8, 8.75], [0.8, 8.75], [-0.6, 7.72], [0.6, 7.72]]) {
      wires.push([[ps[i][0] + dx, y, ps[i][1]], [ps[i + 1][0] + dx, y, ps[i + 1][1]], 0.45 + R() * 0.3]);
    }
  }
  // drop wires across the street
  for (const z of [43, 63]) wires.push([[-3.35, 8.2, z], [3.35, 8.2, z], 0.6]);
  // konbini on the east corner: glass front facing the street, blue stripe
  M.box(4.55, 0.1, 31.5, 4.6, 2.9, 38.5, o([0.8, 0.9, 1], MAT.GLASS, 0.8, PAT.DRINKS), 'x');
  M.box(4.4, 2.9, 31, 4.6, 3.5, 39, o([0.15, 0.5, 0.95], MAT.NEON, 0.9), 'xZz');
  signs.push({ p: [3.9, 3.45, 34.2], text: '24H', col: [0.85, 0.95, 1], flick: 0, glow: 0.8 });
  L([2.5, 2, 35], [0.75, 0.88, 1], 11, 1.5);
  // vending machines (west sidewalk), glowing fronts facing the street
  for (let k = 0; k < 3; k++) {
    const z = 32 + k * 1.05;
    M.box(-4.55, 0.05, z, -3.75, 1.85, z + 0.95, o([k === 1 ? 0.75 : 0.85, k === 1 ? 0.15 : 0.85, k === 1 ? 0.1 : 0.9], MAT.METAL));
    M.box(-3.75, 0.75, z + 0.08, -3.7, 1.75, z + 0.87, o([0.9, 0.95, 1], MAT.GLASS, 0.85, PAT.DRINKS), 'X');
  }
  L([-2.9, 1.3, 33.6], [0.8, 0.9, 1], 6, 1.2);
  // avenue-facing horizontal neon
  signs.push({ p: [-30, 3.6, 30.9], text: 'PACHINKO', col: [1, 0.3, 0.6], flick: 0.05 });
  signs.push({ p: [-18.8, 3.6, 30.9], text: 'SOBA', col: [1, 0.75, 0.3], flick: 0 });
  signs.push({ p: [17.5, 3.6, 30.9], text: 'DRUG', col: [0.3, 1, 0.5], flick: 0 });
  signs.push({ p: [29, 3.6, 30.9], text: 'KARAOKE', col: [0.6, 0.4, 1], flick: 0.03 });

  // ── traditional shops on the north side of the avenue, flanking the gate
  for (const side of [-1, 1]) {
    for (let k = 0; k < 6; k++) {
      const x0 = side * (9 + k * 8.5), x1 = x0 + side * 8;
      const xa = Math.min(x0, x1), xb = Math.max(x0, x1);
      const h = 5.5 + (k % 2) * 1.5;
      M.box(xa, 0, -8, xb, h, 4, o(COL.plaster, MAT.FACADE, 0, PAT.PLANKS));
      M.box(xa + 0.3, 0.1, 4, xb - 0.3, 2.6, 4.05, o([1, 0.78, 0.5], MAT.GLASS, 0.5, PAT.SHOJI), 'Z');
      M.roof((xa + xb) / 2, h, -2, xb - xa + 1.4, 13.6, 2.6, o(COL.roof, MAT.ROOF, 0, PAT.TILES), { ridge: 0.7, lift: 0.25, sag: 0.18 });
      // noren curtain + two lanterns
      M.box(xa + 2, 1.9, 4.06, xb - 2, 2.6, 4.1, o(k % 2 ? [0.1, 0.12, 0.35] : [0.45, 0.08, 0.06], MAT.CLOTH));
      for (const lx of [xa + 1.2, xb - 1.2]) {
        M.lathe(lx, 2.3, 4.5, [[0.22, 0], [0.3, 0.2], [0.3, 0.45], [0.22, 0.62]], 7, o([1, 0.45, 0.12], MAT.PAPER, 0.9, PAT.RIBS));
        L([lx, 2.6, 4.7], [1, 0.45, 0.15], 5, 0.7, 0.04);
      }
      solid(xa, -8, xb, 4);
    }
  }

  // ── ginkgo trees along the north sidewalk
  for (const x of [-26, -14, 14, 26]) {
    M.cyl(x, 0, 14.2, 0.22, 3.2, 6, o(COL.woodD, MAT.WOOD));
    for (let k = 0; k < 6; k++) M.blob(x + (R() - 0.5) * 2.6, 3.6 + R() * 2.4, 14.2 + (R() - 0.5) * 2.2, 1 + R() * 0.7, o([COL.ginkgo[0] * (0.8 + R() * 0.3), COL.ginkgo[1] * (0.8 + R() * 0.3), COL.ginkgo[2]], MAT.FOLIAGE), 7, 0.85);
    solid(x - 0.4, 13.8, x + 0.4, 14.6);
  }

  // ── KAMINARIMON (Thunder Gate)
  {
    const gz = 8, base = o(COL.stone, MAT.STONE, 0, PAT.PAVING);
    M.box(-6.6, 0, gz - 3, 6.6, 0.22, gz + 3, base);
    const pil = o(COL.verm, MAT.WOOD, 0, PAT.PLANKS);
    for (const x of [-5.7, -3.3, 3.3, 5.7]) for (const z of [gz - 2.3, gz + 2.3]) M.cyl(x, 0.2, z, 0.32, 6.2, 8, pil);
    for (const x of [-4.5, 4.5]) M.cyl(x, 0.2, gz, 0.26, 6.2, 8, pil);
    // tie beams
    for (const z of [gz - 2.3, gz + 2.3]) {
      M.box(-6.3, 5.5, z - 0.28, 6.3, 6.3, z + 0.28, o(COL.verm, MAT.WOOD));
      for (const sd of [-1, 1]) M.box(sd * 3.3, 3.9, z - 0.18, sd * 6.3, 4.3, z + 0.18, o(COL.verm, MAT.WOOD));
    }
    // bracket complex + roof
    M.box(-6.5, 6.3, gz - 2.7, 6.5, 7.4, gz + 2.7, o(COL.vermD, MAT.WOOD, 0, PAT.PLANKS));
    M.box(-6.9, 7.4, gz - 3.1, 6.9, 7.65, gz + 3.1, o([0.12, 0.04, 0.03], MAT.WOOD));
    M.roof(0, 7.6, gz, 18, 10.4, 3.6, o(COL.roof, MAT.ROOF, 0, PAT.TILES), { ridge: 0.42, lift: 0.55, sag: 0.4, th: 0.35, capc: COL.roofCap });
    // shachi-like ridge ends
    for (const x of [-4.4, 4.4]) M.cbox(x, 11.1, gz, 0.5, 0.9, 0.5, o(COL.roofCap, MAT.ROOF));
    // plaque
    M.box(-1.1, 6.45, gz + 2.62, 1.1, 7.3, gz + 2.75, o([0.04, 0.03, 0.03], MAT.WOOD));
    // side bays: Fujin (east, green) and Raijin (west, red) behind grilles
    for (const side of [-1, 1]) {
      const x0 = side * 3.6, x1 = side * 5.5, xa = Math.min(x0, x1), xb = Math.max(x0, x1);
      M.box(xa, 0.2, gz - 0.3, xb, 5.4, gz + 0.1, o([0.05, 0.03, 0.03], MAT.WOOD));
      M.box(xa, 0.2, gz - 0.3, xb, 1.4, gz + 1.9, o([0.08, 0.04, 0.03], MAT.WOOD));
      const god = side > 0 ? [0.25, 0.55, 0.3] : [0.75, 0.15, 0.1];
      M.blob((xa + xb) / 2, 2.8, gz + 0.9, 0.9, o(god, MAT.CLOTH), 7, 1.5);
      M.blob((xa + xb) / 2, 4.4, gz + 1, 0.55, o(god, MAT.CLOTH), 7);
      // wind bag / drum ring
      if (side > 0) M.lathe((xa + xb) / 2, 4.3, gz + 0.7, [[0.2, 0], [1.2, 0.35], [1.25, 0.6], [0.2, 0.9]], 8, o([0.55, 0.5, 0.4], MAT.CLOTH));
      else for (let a = 0; a < 6; a++) M.cyl((xa + xb) / 2 + Math.cos(a) * 1.1, 4.6 + Math.sin(a) * 1.1, gz + 0.6, 0.22, 0.2, 6, o([0.6, 0.45, 0.15], MAT.METAL));
      for (let x = xa + 0.15; x < xb; x += 0.32) M.box(x, 0.2, gz + 2.05, x + 0.09, 5.4, gz + 2.15, o([0.35, 0.04, 0.02], MAT.WOOD));
      L([(xa + xb) / 2, 3, gz + 1.5], god.map(v => v * 0.6 + 0.3), 4, 0.5);
      solid(xa - 0.3, gz - 2.6, xb + 0.3, gz + 2.6);
    }
    // the great lantern (chōchin), 3.9 m tall, hung in the passage
    const ly = 1.85;
    M.cyl(0, ly - 0.32, gz, 1.18, 0.34, 12, o([0.06, 0.04, 0.03], MAT.METAL));
    M.lathe(0, ly, gz, [[1.18, 0], [1.46, 0.22], [1.64, 0.75], [1.7, 1.95], [1.64, 3.15], [1.46, 3.68], [1.18, 3.9]], 14, o(COL.lantern, MAT.PAPER, 0.42, PAT.RIBS));
    M.cyl(0, ly + 3.9, gz, 1.18, 0.28, 12, o([0.06, 0.04, 0.03], MAT.METAL));
    M.cyl(0, ly + 4.18, gz, 0.08, 1.5, 4, o([0.06, 0.04, 0.03], MAT.METAL));
    L([0, ly + 1.9, gz + 2.4], [1, 0.32, 0.12], 10, 2.2, 0.03);
    L([0, ly + 1.0, gz - 2.4], [1, 0.32, 0.12], 7, 1.2, 0.03);
    for (const x of [-5.7, -3.3, 3.3, 5.7]) L([x, 0.6, gz + 3.2], [1, 0.42, 0.18], 7, 1.3);
    L([0, 9, gz + 6], [1, 0.5, 0.25], 10, 0.8);
    L([0, 13, gz + 2], [0.55, 0.6, 1], 12, 0.7);   // cool rim light on the roof
    decals.push({ kind: 'kanji', text: '雷門', c: [0, ly + 1.95, gz + 1.72], w: 1.7, h: 3.0, col: [0.04, 0.01, 0.01] });
  }

  // ── NAKAMISE-DORI: stalls under tiled eaves, red lanterns
  const goods = ['SENBEI', 'DANGO', 'NINGYO-YAKI', 'OMIYAGE', 'KIBI', 'MOCHI', 'SENSU', 'KIMONO', 'MANJU', 'TENUGUI'];
  let gi = 0;
  for (let z = 2; z > -33; z -= 3.6) {
    for (const side of [-1, 1]) {
      const xa = side > 0 ? 4.2 : -8.2, xb = side > 0 ? 8.2 : -4.2, front = side > 0 ? xa : xb;
      const z0 = z - 3.5, z1 = z;
      M.box(xa, 0, z0, xb, 3.4, z1, o([0.5, 0.36, 0.26], MAT.FACADE, 0, PAT.PLANKS));
      // lit shop interior: warm glass with goods
      const goodsCol = [[1, 0.75, 0.45], [1, 0.6, 0.5], [0.95, 0.85, 0.6]][gi % 3];
      M.box(Math.min(front, front - side * 0.05), 0.4, z0 + 0.2, Math.max(front, front - side * 0.05), 2.5, z1 - 0.2, o(goodsCol, MAT.GLASS, 0.55, PAT.DRINKS), side > 0 ? 'x' : 'X');
      // counter
      M.box(Math.min(front, front - side * 0.5), 0, z0 + 0.2, Math.max(front, front - side * 0.5), 0.9, z1 - 0.2, o(COL.wood, MAT.WOOD, 0, PAT.PLANKS));
      // eave
      M.box(Math.min(front + side * 0.3, front - side * 1.2), 2.9, z0, Math.max(front + side * 0.3, front - side * 1.2), 3.1, z1, o([0.12, 0.05, 0.03], MAT.WOOD));
      // small lantern
      const lx = front - side * 1.0;
      M.lathe(lx, 2.15, z0 + 1.75, [[0.16, 0], [0.24, 0.15], [0.24, 0.42], [0.16, 0.58]], 7, o([1, 0.2, 0.08], MAT.PAPER, 0.95, PAT.RIBS));
      if (gi % 2 === 0) L([lx - side * 0.6, 2.2, z0 + 1.75], [1, 0.5, 0.2], 6.5, 0.85, 0.05);
      if (gi % 3 === 0) signs.push({ p: [lx - side * 0.2, 3.25, z0 + 1.75], text: goods[(gi / 3) % goods.length | 0], col: [1, 0.82, 0.55], flick: 0, glow: 0.25, small: true });
      gi++;
    }
    // continuous tiled roof over each row
  }
  for (const side of [-1, 1]) {
    const xa = side > 0 ? 4 : -8.6, xb = side > 0 ? 8.6 : -4;
    M.at((xa + xb) / 2, 0, -16, Math.PI / 2);
    M.roof(0, 3.4, 0, 36.4, xb - xa + 1, 1.6, o(COL.roof, MAT.ROOF, 0, PAT.TILES), { ridge: 0.98, lift: 0.15, sag: 0.1, th: 0.18 });
    M.pop();
    solid(xa, -34, xb, 2.2);
  }

  // ── temple grounds (Hozomon → Senso-ji → pagoda → pond) live in 81_temple.js
  const trees = [[-26, 0, 14.2, 0], [-14, 0, 14.2, 0], [14, 0, 14.2, 0], [26, 0, 14.2, 0]];   // [x, y, z, 0 ginkgo | 1 maple]
  const anchors = {};
  buildTemple(M, { o, L, solid, signs, decals, wires, trees, anchors, R, COL });
  return { mesh: M, lights, signs, decals, colliders, wires, trees, anchors };
}
