// ───────────────────────── materials ─────────────────────────
// Every surface carries a material id; the ASCII pass picks its character set from it.
const MAT = {
  SKY: 0, STONE: 1, ASPHALT: 2, GRAVEL: 3, GRASS: 4, WATER: 5, WOOD: 6, ROOF: 7,
  PAPER: 8, NEON: 9, FACADE: 10, FOLIAGE: 11, METAL: 12, CLOTH: 13, FIRE: 14, GLASS: 15,
};
// procedural surface patterns, evaluated in the scene shader
const PAT = { NONE: 0, PAVING: 1, PLANKS: 2, WINDOWS: 3, TILES: 4, RIBS: 5, ASPHALT: 6, SHOJI: 7, BRICK: 8, DRINKS: 9, WET: 10 };

// ───────────────────────── mesh builder ─────────────────────────
// Non-indexed triangles. Vertex = pos3 nrm3 col3 (mat, emissive, pattern) = 12 floats.
class Mesh {
  constructor() { this.d = []; this.m = M4.ident(); this.st = []; }
  push(m) { this.st.push(this.m); this.m = M4.mul(this.m, m); return this; }
  pop() { this.m = this.st.pop(); return this; }
  at(x, y, z, ry = 0) { return this.push(ry ? M4.mul(M4.trans(x, y, z), M4.rotY(ry)) : M4.trans(x, y, z)); }
  // quad/tri whose normal is forced to face `dir` (a vector) — used for generated shapes
  quadF(a, b, c, d, o, dir) {
    let n = V3.norm(V3.cross(V3.sub(b, a), V3.sub(c, a)));
    if (V3.dot(n, dir) < 0) n = V3.mul(n, -1);
    this.quad(a, b, c, d, o, n);
  }
  triF(a, b, c, o, dir) {
    let n = V3.norm(V3.cross(V3.sub(b, a), V3.sub(c, a)));
    if (V3.dot(n, dir) < 0) n = V3.mul(n, -1);
    this.tri(a, b, c, o, n);
  }
  v(p, n, o) {
    const P = M4.tp(this.m, p), N = V3.norm(M4.td(this.m, n));
    const c = o.c;
    this.d.push(P[0], P[1], P[2], N[0], N[1], N[2], c[0], c[1], c[2], o.m, o.e || 0, o.p || 0);
  }
  tri(a, b, c, o, n) {
    if (!n) n = V3.norm(V3.cross(V3.sub(b, a), V3.sub(c, a)));
    this.v(a, n, o); this.v(b, n, o); this.v(c, n, o);
  }
  quad(a, b, c, d, o, n) { this.tri(a, b, c, o, n); this.tri(a, c, d, o, n); }
  // axis-aligned box in local space: x0..x1, y0..y1, z0..z1
  box(x0, y0, z0, x1, y1, z1, o, faces) {
    const f = faces || 'xXyYzZ';
    if (f.includes('X')) this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], o, [1, 0, 0]);
    if (f.includes('x')) this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], o, [-1, 0, 0]);
    if (f.includes('Y')) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], o, [0, 1, 0]);
    if (f.includes('y')) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], o, [0, -1, 0]);
    if (f.includes('Z')) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], o, [0, 0, 1]);
    if (f.includes('z')) this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], o, [0, 0, -1]);
  }
  // centered box: center x,z, bottom y, size w,h,d
  cbox(x, y, z, w, h, d, o, faces) { this.box(x - w / 2, y, z - d / 2, x + w / 2, y + h, z + d / 2, o, faces); }
  // surface of revolution around local Y. prof = [[r, y], ...] bottom→top
  lathe(x, y, z, prof, seg, o, caps) {
    for (let i = 0; i < prof.length - 1; i++) {
      const [r0, y0] = prof[i], [r1, y1] = prof[i + 1];
      const nr = y1 - y0, ny = -(r1 - r0), nl = Math.hypot(nr, ny) || 1;
      for (let s = 0; s < seg; s++) {
        const a0 = s / seg * Math.PI * 2, a1 = (s + 1) / seg * Math.PI * 2;
        const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
        const p00 = [x + c0 * r0, y + y0, z + s0 * r0], p10 = [x + c1 * r0, y + y0, z + s1 * r0];
        const p01 = [x + c0 * r1, y + y1, z + s0 * r1], p11 = [x + c1 * r1, y + y1, z + s1 * r1];
        const n0 = [c0 * nr / nl, ny / nl, s0 * nr / nl], n1 = [c1 * nr / nl, ny / nl, s1 * nr / nl];
        this.v(p00, n0, o); this.v(p01, n0, o); this.v(p11, n1, o);
        this.v(p00, n0, o); this.v(p11, n1, o); this.v(p10, n1, o);
      }
    }
    if (caps) {
      const [rt, yt] = prof[prof.length - 1];
      for (let s = 0; s < seg; s++) {
        const a0 = s / seg * Math.PI * 2, a1 = (s + 1) / seg * Math.PI * 2;
        this.tri([x, y + yt, z], [x + Math.cos(a1) * rt, y + yt, z + Math.sin(a1) * rt], [x + Math.cos(a0) * rt, y + yt, z + Math.sin(a0) * rt], o, [0, 1, 0]);
      }
    }
  }
  cyl(x, y, z, r, h, seg, o, caps = true) { this.lathe(x, y, z, [[r, 0], [r, h]], seg, o, caps); }
  // Japanese hip roof with upturned eaves. Footprint w×d centred at (x,z), eave height y, rise h.
  // ridge spans (w-d*k) along X. curve lifts the four corners.
  roof(x, y, z, w, d, h, o, opts = {}) {
    const k = opts.ridge ?? 0.45, lift = opts.lift ?? 0.35, sag = opts.sag ?? 0.25, th = opts.th ?? 0.25;
    const hw = w / 2, hd = d / 2, rw = Math.max(0.2, hw - hd * (1 - k));
    const R0 = [x - rw, y + h, z], R1 = [x + rw, y + h, z];
    const E = [[x - hw, y + lift, z - hd], [x + hw, y + lift, z - hd], [x + hw, y + lift, z + hd], [x - hw, y + lift, z + hd]];
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - lift, (a[2] + b[2]) / 2];
    // a slight sag between ridge and eave makes the concave Japanese curve
    const sagP = (e, r) => { const m = V3.lerp(e, r, 0.45); m[1] -= sag; return m; };
    const M = [mid(E[0], E[1]), mid(E[1], E[2]), mid(E[2], E[3]), mid(E[3], E[0])];
    // front (−z) and back (+z) trapezoids, each split in two bands for the curve
    const face = (e0, em, e1, r0, r1) => {
      const s0 = sagP(e0, r0), sm = sagP(em, V3.lerp(r0, r1, 0.5)), s1 = sagP(e1, r1);
      const out = [0, 1, 0];
      this.quadF(e0, em, sm, s0, o, out); this.quadF(em, e1, s1, sm, o, out);
      this.quadF(s0, sm, V3.lerp(r0, r1, 0.5), r0, o, out); this.quadF(sm, s1, r1, V3.lerp(r0, r1, 0.5), o, out);
    };
    face(E[0], M[0], E[1], R0, R1);
    face(E[2], M[2], E[3], R1, R0);
    // hip ends (triangular)
    const hip = (e0, em, e1, r) => {
      const s0 = sagP(e0, r), sm = sagP(em, r), s1 = sagP(e1, r);
      const out = [0, 1, 0];
      this.quadF(e0, em, sm, s0, o, out); this.quadF(em, e1, s1, sm, o, out);
      this.triF(s0, sm, r, o, out); this.triF(sm, s1, r, o, out);
    };
    hip(E[1], M[1], E[2], R1);
    hip(E[3], M[3], E[0], R0);
    // eave thickness (fascia) as a thin dark band
    if (th > 0) {
      const fo = Object.assign({}, o, { c: opts.fascia || [o.c[0] * 0.6, o.c[1] * 0.6, o.c[2] * 0.6] });
      const ring = [E[0], M[0], E[1], M[1], E[2], M[2], E[3], M[3], E[0]];
      for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i], b = ring[i + 1];
        this.quadF([a[0], a[1] - th, a[2]], [b[0], b[1] - th, b[2]], b, a, fo, [(a[0] + b[0]) / 2 - x, 0, (a[2] + b[2]) / 2 - z]);
      }
      // soffit (underside), so the roof reads as a solid slab from below
      this.quad([E[0][0], E[0][1] - th, E[0][2]], [E[3][0], E[3][1] - th, E[3][2]], [E[2][0], E[2][1] - th, E[2][2]], [E[1][0], E[1][1] - th, E[1][2]], fo, [0, -1, 0]);
    }
    // ridge cap
    if (opts.cap !== false) this.box(R0[0] - 0.3, R0[1] - 0.05, z - 0.18, R1[0] + 0.3, R0[1] + 0.35, z + 0.18, Object.assign({}, o, { c: opts.capc || o.c }));
  }
  // flat ground quad
  ground(x0, z0, x1, z1, y, o) { this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], o, [0, 1, 0]); }
  // simple blob (low-poly sphere) for foliage, lanterns, heads
  blob(x, y, z, r, o, seg = 7, sy = 1) {
    const prof = [];
    for (let i = 0; i <= 5; i++) { const a = -Math.PI / 2 + i / 5 * Math.PI; prof.push([Math.cos(a) * r + 1e-3, Math.sin(a) * r * sy]); }
    this.lathe(x, y, z, prof, seg, o);
  }
  get count() { return this.d.length / 12; }
}
