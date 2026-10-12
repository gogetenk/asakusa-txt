// ───────────────────────── actors: the traveller, the cat ─────────────────────────
function buildPlayer(M, s) {
  // s: { walk (phase), amp (0..1), umbrella (0..1), lantern (bool) }
  const sw = Math.sin(s.walk) * 0.55 * s.amp, bob = Math.abs(Math.cos(s.walk)) * 0.05 * s.amp;
  const coat = o3([0.66, 0.63, 0.58], MAT.CLOTH), pants = o3([0.1, 0.11, 0.2], MAT.CLOTH);
  const skin = o3([0.75, 0.55, 0.42], MAT.CLOTH), hair = o3([0.03, 0.03, 0.04], MAT.CLOTH);
  // legs
  for (const side of [-1, 1]) {
    M.push(M4.mul(M4.trans(side * 0.11, 0.86 + bob, 0), M4.rotX(sw * side)));
    M.box(-0.08, -0.86, -0.09, 0.08, 0, 0.09, pants);
    M.box(-0.09, -0.88, -0.06, 0.09, -0.78, 0.17, o3([0.02, 0.02, 0.02], MAT.CLOTH));
    M.pop();
  }
  M.push(M4.trans(0, bob, 0));
  // haori-style coat, slightly flared
  M.lathe(0, 0.7, 0, [[0.3, 0], [0.27, 0.35], [0.25, 0.75], [0.14, 0.9]], 8, coat);
  M.box(-0.27, 1.02, -0.2, 0.27, 1.1, 0.2, o3([0.12, 0.13, 0.32], MAT.CLOTH)); // indigo obi sash
  // arms
  for (const side of [-1, 1]) {
    const a = side > 0 && s.umbrella > 0.5 ? -1.2 : -sw * side * 0.9;
    M.push(M4.mul(M4.trans(side * 0.32, 1.5, 0), M4.rotX(a)));
    M.box(-0.07, -0.55, -0.07, 0.07, 0, 0.07, coat);
    M.blob(0, -0.6, 0, 0.065, skin, 5);
    M.pop();
  }
  // head + hair bun
  M.blob(0, 1.74, 0, 0.17, skin, 7, 1.1);
  M.blob(0, 1.8, -0.04, 0.18, hair, 7, 0.95);
  M.blob(0, 1.97, -0.1, 0.08, hair, 5);
  // wagasa (oil-paper umbrella)
  if (s.umbrella > 0.02) {
    const u = s.umbrella;
    M.push(M4.mul(M4.trans(0.22, 1.15, 0.05), M4.rotZ(-0.38)));
    M.cyl(0, 0, 0, 0.02, 1.2 * u, 4, o3([0.3, 0.2, 0.1], MAT.WOOD));
    M.lathe(0, 1.12 * u, 0, [[0.62 * u, 0], [0.5 * u, 0.09], [0.27 * u, 0.2], [0.02, 0.28]], 12, o3([0.78, 0.1, 0.06], MAT.PAPER, 0.06, PAT.RIBS));
    M.pop();
  }
  // hand lantern (chōchin) on the left
  if (s.lantern) {
    const lx = -0.42, ly = 0.66 + Math.sin(s.walk * 2) * 0.03 * s.amp;
    M.cyl(lx, ly + 0.36, 0.08, 0.01, 0.3, 3, o3([0.1, 0.07, 0.04], MAT.WOOD));
    M.lathe(lx, ly, 0.08, [[0.07, 0], [0.12, 0.06], [0.13, 0.2], [0.12, 0.3], [0.07, 0.36]], 7, o3([1, 0.55, 0.2], MAT.PAPER, 1, PAT.RIBS));
  }
  M.pop();
}
function o3(c, m, e = 0, p = 0) { return { c, m, e, p }; }

function buildCat(M, s) {
  const fur = o3([0.04, 0.04, 0.05], MAT.CLOTH), eye = o3([0.9, 0.85, 0.2], MAT.NEON, 1);
  const sw = Math.sin(s.walk) * 0.5 * s.amp;
  M.blob(0, 0.28, 0, 0.2, fur, 7, 0.75);              // body
  M.push(M4.scale(1, 1, 1.6)); M.blob(0, 0.28, 0, 0.17, fur, 7, 0.8); M.pop();
  M.blob(0, 0.48, 0.3, 0.13, fur, 7);                  // head
  M.tri([-0.1, 0.55, 0.3], [-0.03, 0.56, 0.3], [-0.08, 0.68, 0.28], fur, [0, 0, 1]);
  M.tri([0.03, 0.56, 0.3], [0.1, 0.55, 0.3], [0.08, 0.68, 0.28], fur, [0, 0, 1]);
  M.cbox(-0.05, 0.49, 0.42, 0.03, 0.025, 0.02, eye); M.cbox(0.05, 0.49, 0.42, 0.03, 0.025, 0.02, eye);
  for (const [x, z, ph] of [[-0.09, 0.18, 0], [0.09, 0.18, 3.14], [-0.09, -0.2, 3.14], [0.09, -0.2, 0]]) {
    M.push(M4.mul(M4.trans(x, 0.22, z), M4.rotX(Math.sin(s.walk + ph) * 0.6 * s.amp)));
    M.box(-0.035, -0.22, -0.035, 0.035, 0, 0.035, fur); M.pop();
  }
  // tail, curling
  M.push(M4.mul(M4.trans(0, 0.32, -0.3), M4.rotX(-0.9 + Math.sin(s.t * 2) * 0.25)));
  M.box(-0.025, 0, -0.025, 0.025, 0.42, 0.025, fur); M.pop();
  void sw;
}
