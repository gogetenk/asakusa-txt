// ───────────────────────── particles: rain, splashes, leaves ─────────────────────────
// Particles live in world space and are drawn as single characters in the overlay,
// depth-tested against the scene so they pass behind buildings.
class FX {
  constructor() { this.p = []; this.rip = []; this.rainAcc = 0; this.leafAcc = 0; }
  spawn(o) { if (this.p.length < 2400) this.p.push(o); }
  // incense smoke from the jokoro: slow, curling, warm at the base, grey as it rises
  smoke(src, rate, dt, pull) {
    this.smokeAcc = (this.smokeAcc || 0) + dt * rate;
    while (this.smokeAcc > 1) {
      this.smokeAcc--;
      const R = Math.random;
      this.spawn({ k: 4, x: src[0] + (R() - 0.5) * 0.9, y: src[1], z: src[2] + (R() - 0.5) * 0.9, vx: (R() - 0.5) * 0.3, vy: 0.55 + R() * 0.35, vz: (R() - 0.5) * 0.3, life: 5 + R() * 3, max: 8, ph: R() * 6.28, pull });
    }
  }
  // fireworks: a rocket climbs, then bursts into sparks. type: 0 peony, 1 chrysanthemum (trails), 2 willow (gold, drooping), 3 ring
  firework(from, at, col, type, onBurst) {
    this.spawn({ k: 5, x: from[0], y: from[1], z: from[2], tx: at[0], ty: at[1], tz: at[2], life: 1.6, max: 1.6, col, type, onBurst });
  }
  _burst(q) {
    const R = Math.random, n = q.type === 3 ? 70 : q.type === 2 ? 110 : 140, sp = q.type === 2 ? 28 : 40 + R() * 9;
    const ax = R() * 6.28;
    for (let i = 0; i < n; i++) {
      let dx, dy, dz;
      if (q.type === 3) { const a = i / n * 6.28; dx = Math.cos(a); dy = Math.sin(a) * Math.cos(ax); dz = Math.sin(a) * Math.sin(ax); }
      else { const u = R() * 2 - 1, a = R() * 6.28, r = Math.sqrt(1 - u * u); dx = r * Math.cos(a); dy = u; dz = r * Math.sin(a); }
      const v = sp * (q.type === 3 ? 1 : 0.75 + R() * 0.25);
      const c = (q.type === 1 && R() < 0.3) ? [1, 0.95, 0.85] : q.col;
      this.spawn({ k: 6, x: q.x, y: q.y, z: q.z, vx: dx * v, vy: dy * v, vz: dz * v, life: (q.type === 2 ? 3.4 : 2.3) + R() * 0.7, max: 2.9, col: c, type: q.type, tw: R() * 6.28 });
    }
    if (q.onBurst) q.onBurst(q);
  }
  update(dt, t, env) {
    const c = env.center, R = Math.random;
    // rain
    this.rainAcc += dt * env.rain * 1500;
    while (this.rainAcc > 1) {
      this.rainAcc--;
      this.spawn({ k: 0, x: c[0] + (R() - 0.5) * 22, y: 1 + R() * 13, z: c[2] - 34 + R() * 40, vx: -2.2, vy: -19 - R() * 5, vz: 0.6, life: 2 });
    }
    // falling leaves around the trees
    this.leafAcc += dt * env.leaves * 7;
    while (this.leafAcc > 1) {
      this.leafAcc--;
      const tr = env.trees[(R() * env.trees.length) | 0];
      if (!tr) break;
      this.spawn({ k: 2, x: tr[0] + (R() - 0.5) * 4, y: 3.5 + R() * 3, z: tr[2] + (R() - 0.5) * 4, vx: 0, vy: -0.7 - R() * 0.5, vz: 0, life: 14, ph: R() * 6.28, col: tr[3], spin: 2 + R() * 3 });
    }
    const keep = [];
    for (const q of this.p) {
      q.life -= dt;
      if (q.k === 0) {
        q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
        if (q.y <= 0) {
          q.k = 1; q.y = 0.02; q.life = 0.28;
          if (env.isWater && env.isWater(q.x, q.z) && this.rip.length < 8 && R() < 0.25) this.rip.push([q.x, q.z, 0, 0.8]);
        }
      } else if (q.k === 2) {
        q.ph += dt * q.spin;
        q.x += (Math.sin(q.ph) * 0.9 + env.wind) * dt; q.z += Math.cos(q.ph * 0.7) * 0.4 * dt;
        q.y += q.vy * dt;
        if (q.y <= 0.03) { q.y = 0.03; q.k = 3; q.life = 8 + R() * 6; }
      }
      else if (q.k === 4) {
        q.ph += dt * 0.9;
        const age = q.max - q.life;
        q.x += (q.vx + Math.sin(q.ph + age) * 0.35 + env.wind * 0.15 * age) * dt;
        q.z += (q.vz + Math.cos(q.ph * 1.3) * 0.25) * dt;
        q.y += q.vy * dt * (1 - age * 0.06);
        if (q.pull) { q.x += (q.pull[0] - q.x) * dt * 0.8; q.z += (q.pull[2] - q.z) * dt * 0.8; q.y += (q.pull[1] - q.y) * dt * 0.3; }
      } else if (q.k === 5) {
        const t = 1 - q.life / q.max, e = 1 - (1 - t) * (1 - t);
        q.px = q.x; q.py = q.y; q.pz = q.z;
        q.cx = q.x; q.cy = q.y; q.cz = q.z;
        if (q.sx === undefined) { q.sx = q.x; q.sy = q.y; q.sz = q.z; }
        q.x = q.sx + (q.tx - q.sx) * t; q.y = q.sy + (q.ty - q.sy) * e; q.z = q.sz + (q.tz - q.sz) * t;
        if (q.life <= 0) this._burst(q);
        if (R() < 0.6) this.spawn({ k: 7, x: q.x, y: q.y, z: q.z, life: 0.5, max: 0.5 });
      } else if (q.k === 6) {
        const drag = q.type === 2 ? 1.6 : 1.1;
        q.vx -= q.vx * drag * dt; q.vy -= (q.vy * drag + (q.type === 2 ? 7 : 4.5)) * dt; q.vz -= q.vz * drag * dt;
        q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
        if ((q.type === 1 || q.type === 2) && R() < 0.22) this.spawn({ k: 7, x: q.x, y: q.y, z: q.z, life: 0.7, max: 0.7, col: q.col });
      } else if (q.k === 7) { q.y -= dt * 1.5; }
      if (q.life > 0) keep.push(q);
    }
    this.p = keep;
    // ripples age
    for (const r of this.rip) r[2] += dt;
    this.rip = this.rip.filter(r => r[2] < 1.4);
  }
  _drawSpark(ov, rend, q, mirror) {
    const s = rend.project([q.x, mirror ? -q.y : q.y, q.z]);
    if (!s) return;
    const f = Math.max(0, Math.min(1, q.life / (q.max * 0.55)));
    let ch, c, g;
    if (q.k === 5) { ch = '|'; c = [1, 0.85, 0.5]; g = 0.6; }
    else if (q.k === 7) { ch = q.life > 0.35 ? ':' : '.'; c = (q.col || [1, 0.7, 0.4]).map(v => v * 0.5 * f); g = 0.1; }
    else {
      const tw = 0.75 + 0.25 * Math.sin(q.tw + q.life * 30);
      ch = f > 0.75 ? '*' : f > 0.45 ? '+' : f > 0.2 ? '\'' : '.';
      if (q.type === 2) ch = f > 0.6 ? '*' : f > 0.3 ? '|' : ':';
      c = q.col.map(v => Math.min(1, v * (0.35 + 0.75 * f) * tw)); g = 0.9 * f;
    }
    if (mirror) { c = c.map(v => v * 0.62); g *= 0.5; ov.put(s.x, s.y, ch === '|' ? '|' : ch, c, 0, 5, g); }
    else ov.put(s.x, s.y, ch, c, s.d, 0, g);
  }
  addRipple(x, z, s = 1) { if (this.rip.length >= 8) this.rip.shift(); this.rip.push([x, z, 0, s]); }
  writeRipples(arr) {
    arr.fill(0);
    this.rip.forEach((r, i) => { arr[i * 4] = r[0]; arr[i * 4 + 1] = r[1]; arr[i * 4 + 2] = r[2]; arr[i * 4 + 3] = r[3]; });
  }
  draw(ov, rend, t) {
    for (const q of this.p) {
      const s = rend.project([q.x, q.y, q.z]);
      if (!s) continue;
      if (q.k === 0) {
        const s2 = rend.project([q.x - q.vx * 0.045, q.y - q.vy * 0.045, q.z - q.vz * 0.045]);
        if (!s2) continue;
        const dx = s.x - s2.x, dy = s.y - s2.y;
        const ch = Math.abs(dx) < Math.abs(dy) * 0.3 ? '|' : (dx * dy > 0 ? '\\' : '/');
        const a = 0.35 + 0.25 * Math.sin(q.x * 9.1 + q.z * 3.3);
        ov.put(s.x, s.y, ch, [0.55 * a + 0.2, 0.68 * a + 0.24, 0.95 * a + 0.3], s.d, 0, 0.05);
        if (Math.abs(dy) > 1.6) ov.put(s2.x, s2.y, ch, [0.28, 0.34, 0.5], s2.d, 0, 0);
      } else if (q.k === 1) {
        const ch = q.life > 0.18 ? '.' : q.life > 0.08 ? 'o' : '\'';
        ov.put(s.x, s.y, ch, [0.5, 0.6, 0.78], s.d - 0.001, 0, 0);
      } else if (q.k === 2) {
        const seq = '-\\|/';
        const ch = q.col === 1 ? '*' : seq[Math.floor(q.ph * 1.3) & 3];
        const c = q.col === 1 ? [1, 0.28, 0.1] : [1, 0.78, 0.18];
        ov.put(s.x, s.y, ch, c, s.d - 0.001, 0, 0.15);
      } else if (q.k === 4) {
        const age = q.max - q.life, f = Math.min(1, q.life / 2) * Math.min(1, age * 2);
        const ch = age < 1 ? '.' : age < 2.5 ? (Math.sin(q.ph) > 0 ? '(' : ')') : age < 4.5 ? '~' : (Math.sin(q.ph * 2) > 0 ? 'S' : '~');
        const warm = Math.max(0, 1 - age * 0.6);
        ov.put(s.x, s.y, ch, [(0.42 + 0.5 * warm) * f, (0.4 + 0.18 * warm) * f, (0.46 - 0.2 * warm) * f], s.d - 0.002, 0, 0.1 * f);
      } else if (q.k === 5 || q.k === 6 || q.k === 7) {
        this._drawSpark(ov, rend, q, false);
        if (q.k !== 7) this._drawSpark(ov, rend, q, true);
      } else if (q.k === 3) {
        const f = Math.min(1, q.life / 3);
        const c = q.col === 1 ? [0.7 * f, 0.2 * f, 0.07 * f] : [0.7 * f, 0.55 * f, 0.12 * f];
        ov.put(s.x, s.y, q.col === 1 ? '*' : ',', c, s.d - 0.001, 0, 0);
      }
    }
  }
}
