/* ==========================================================================
   ASAKUSA.TXT  -  audio.js
   Fully procedural sound for the night walk: no samples, no libraries.
   Everything is synthesized live with the Web Audio API.

   Layout of this file
     1. constants + small utils
     2. offline JS DSP helpers (used once to pre-render short buffers)
     3. Kit: per-AudioContext cache of noise, drum, pluck and impulse buffers
     4. Voice: tiny node-builder with automatic cleanup + voice cap
     5. Graph: buses, layers, reverb, compressor, safety clipper
     6. Instruments (e-piano, bass, koto, flutes, sho, bells, drums ...)
     7. One-shot SFX library
     8. Footsteps
     9. Ambience beds + random ambient events
    10. Generative music conductor (city / temple / festival layers)
    11. State mapping (update -> AudioParams)
    12. Public API (+ _renderOffline debug helper)

   Every builder takes the graph object G (which owns ctx + kit) and a
   destination node, so the exact same code runs on a live AudioContext and
   on an OfflineAudioContext (see api._renderOffline).
   ========================================================================== */
window.AsakusaAudio = (function () {

  /* ------------------------------------------------------------------ 1 */
  const BPM = 74;
  const STEP = 60 / BPM / 4;          // one 16th note (s)
  const BAR = STEP * 16;              // one 4/4 bar (s)
  const LOOKAHEAD = 0.15;             // scheduler horizon (s)
  const TICK_MS = 25;                 // scheduler period (ms)
  const SOFT_CAP = 34;                // music/ambience voices allowed at once
  const HARD_CAP = 60;                // absolute cap incl. sfx
  const TAU = Math.PI * 2;

  const rnd = Math.random;
  const rr = (a, b) => a + (b - a) * rnd();
  const ri = (a, b) => Math.floor(a + (b - a + 1) * rnd());
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const chance = (p) => rnd() < p;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

  /* ------------------------------------------------------------------ 2 */
  // RBJ biquad as a per-sample closure (only used when pre-rendering buffers)
  function biquad(type, f, Q, sr) {
    const w = TAU * Math.min(f, sr * 0.45) / sr, cs = Math.cos(w), sn = Math.sin(w), al = sn / (2 * Q);
    let b0, b1, b2;
    if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; }
    else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; }
    else { b0 = al; b1 = 0; b2 = -al; }                       // band-pass, 0 dB peak
    const a0 = 1 + al, a1 = -2 * cs / a0, a2 = (1 - al) / a0;
    b0 /= a0; b1 /= a0; b2 /= a0;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    return function (x) {
      const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y; return y;
    };
  }

  function newBuf(ctx, sec, ch) {
    const n = Math.max(1, Math.floor(ctx.sampleRate * sec));
    return ctx.createBuffer(ch || 1, n, ctx.sampleRate);
  }

  function normalize(d, peak) {
    let m = 0;
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > m) m = a; }
    if (m > 0) { const k = peak / m; for (let i = 0; i < d.length; i++) d[i] *= k; }
  }

  // Seamlessly loopable noise (white / pink / brown), mono
  function makeNoise(ctx, sec, color) {
    const sr = ctx.sampleRate, n = Math.floor(sr * sec), F = Math.floor(sr * 0.05);
    const g = new Float32Array(n + F);
    let b0 = 0, b1 = 0, b2 = 0, last = 0;
    for (let i = 0; i < n + F; i++) {
      const w = rnd() * 2 - 1;
      if (color === 'white') g[i] = w * 0.6;
      else if (color === 'pink') {
        b0 = 0.99765 * b0 + w * 0.0990460; b1 = 0.96300 * b1 + w * 0.2965164; b2 = 0.57000 * b2 + w * 1.0526913;
        g[i] = (b0 + b1 + b2 + w * 0.1848) * 0.16;
      } else { last = (last + 0.02 * w) / 1.02; g[i] = last * 4.2; }
    }
    const b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = g[i];
    for (let i = 0; i < F; i++) { const k = i / F; d[i] = g[i] * k + g[n + i] * (1 - k); } // loop crossfade
    return b;
  }

  // Procedural stereo impulse response: early reflections + darkening tail
  function makeIR(ctx, sec, rt60) {
    const sr = ctx.sampleRate, b = newBuf(ctx, sec, 2), n = b.length;
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr, env = Math.exp(-6.9 * t / rt60) * Math.min(1, t / 0.015);
        const k = 0.7 * Math.exp(-t * 1.1) + 0.06;           // one-pole LP closing over time
        lp += ((rnd() * 2 - 1) - lp) * k;
        d[i] = lp * env;
      }
      for (let r = 0; r < 7; r++) {                           // a few early reflections
        const i = Math.floor(sr * rr(0.012, 0.085));
        if (i < n) d[i] += (rnd() < 0.5 ? -1 : 1) * rr(0.2, 0.5);
      }
      normalize(d, 0.6);
    }
    return b;
  }

  /* ------------------------------------------------------------------ 3 */
  // Kit = everything pre-rendered once per AudioContext
  function makeKit(ctx) {
    const sr = ctx.sampleRate, K = { sr };
    K.white = makeNoise(ctx, 2.0, 'white');
    K.pink = makeNoise(ctx, 2.5, 'pink');
    K.brown = makeNoise(ctx, 3.0, 'brown');
    K.ir = makeIR(ctx, 2.6, 2.3);
    K.silence = ctx.createBuffer(1, 1, sr);

    // lazily rendered entries: built on first use, or ahead of time by prewarm()
    K.lazy = [];
    function lazy(name, build) {
      K.lazy.push(name);
      Object.defineProperty(K, name, {
        configurable: true, enumerable: true,
        get: function () { const v = build(); Object.defineProperty(K, name, { value: v, enumerable: true }); return v; }
      });
    }
    // generic renderer: fn(t, i, noise) -> sample, then normalized
    function rend(sec, peak, fn) {
      const b = newBuf(ctx, sec, 1), d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = fn(i / sr, i, rnd() * 2 - 1);
      normalize(d, peak);
      const F = Math.min(d.length, Math.floor(sr * 0.004));   // de-click the tail
      for (let i = 0; i < F; i++) d[d.length - 1 - i] *= i / F;
      return b;
    }

    // dusty lo-fi kick
    lazy('kick', () => {
      let ph = 0; const lp = biquad('lp', 900, 0.7, sr);
      return rend(0.55, 0.95, (t, i, w) => {
        const f = 47 + 75 * Math.exp(-t * 30); ph += TAU * f / sr;
        const s = Math.sin(ph) * Math.exp(-t * 6.5) * Math.min(1, t * 900) + lp(w) * Math.exp(-t * 260) * 0.5;
        return Math.tanh(s * 1.7);
      });
    });
    // brushed snare
    lazy('brush', () => {
      const bp = biquad('bp', 2600, 0.6, sr), hp = biquad('hp', 700, 0.7, sr); let ph = 0;
      return rend(0.4, 0.9, (t, i, w) => {
        ph += TAU * 185 / sr;
        const env = Math.min(1, t / 0.006) * Math.exp(-t * 11) * (0.75 + 0.25 * Math.sin(t * 190));
        return hp(bp(w)) * env * 1.6 + Math.sin(ph) * Math.exp(-t * 38) * 0.35;
      });
    });
    // rimshot / cross-stick (woody click)
    lazy('rim', () => {
      const bp = biquad('bp', 1750, 3.5, sr); let ph = 0;
      return rend(0.14, 0.9, (t, i, w) => {
        ph += TAU * 430 / sr;
        return bp(w) * Math.exp(-t * 70) * 2.2 + Math.sin(ph) * Math.exp(-t * 55) * 0.6;
      });
    });
    // hats
    lazy('hatC', () => {
      const hp = biquad('hp', 7200, 0.7, sr), bp = biquad('bp', 9500, 0.8, sr);
      return rend(0.09, 0.9, (t, i, w) => (hp(w) * 0.6 + bp(w)) * Math.exp(-t * 75));
    });
    lazy('hatO', () => {
      const hp2 = biquad('hp', 6800, 0.7, sr), bp2 = biquad('bp', 9000, 0.9, sr);
      return rend(0.5, 0.9, (t, i, w) => (hp2(w) * 0.6 + bp2(w)) * Math.exp(-t * 8.5));
    });
    // o-daiko: circular membrane modes + slap
    lazy('taiko', () => {
      const R = [1, 1.59, 2.14, 2.3, 2.65, 2.92], A = [1, 0.55, 0.38, 0.3, 0.22, 0.16], D = [2.6, 4.5, 6.5, 7.5, 9, 11];
      const ph = R.map(() => 0), lp = biquad('lp', 520, 0.8, sr), f0 = 56;
      return rend(1.9, 0.95, (t, i, w) => {
        const bend = 1 + 0.14 * Math.exp(-t * 18);
        let s = 0;
        for (let k = 0; k < R.length; k++) { ph[k] += TAU * f0 * R[k] * bend / sr; s += Math.sin(ph[k]) * A[k] * Math.exp(-t * D[k]); }
        s *= Math.min(1, t * 500);
        return Math.tanh((s + lp(w) * Math.exp(-t * 30) * 1.4) * 1.3);
      });
    });
    // shime-daiko: high tight drum
    lazy('shime', () => {
      const R = [1, 1.59, 2.14], A = [1, 0.5, 0.3], D = [24, 32, 40], ph = [0, 0, 0];
      const bp = biquad('bp', 3200, 1.2, sr);
      return rend(0.28, 0.9, (t, i, w) => {
        let s = 0;
        for (let k = 0; k < 3; k++) { ph[k] += TAU * 410 * R[k] / sr; s += Math.sin(ph[k]) * A[k] * Math.exp(-t * D[k]); }
        return s + bp(w) * Math.exp(-t * 160) * 1.2;
      });
    });
    // kane (atarigane hand gong): bright inharmonic metal
    lazy('kane', () => {
      const F = [1480, 2310, 3570, 4690, 6080], A = [1, 0.8, 0.6, 0.42, 0.28], D = [7, 10, 13, 17, 22], ph = F.map(() => 0);
      const bp = biquad('bp', 5000, 1, sr);
      return rend(0.6, 0.9, (t, i, w) => {
        let s = 0;
        for (let k = 0; k < F.length; k++) { ph[k] += TAU * F[k] / sr; s += Math.sin(ph[k]) * A[k] * Math.exp(-t * D[k]); }
        return s + bp(w) * Math.exp(-t * 120) * 1.5;
      });
    });
    // hollow wooden "tok" (UI, ladle, sticks, wood footsteps)
    lazy('wood', () => {
      let p1 = 0, p2 = 0; const bp = biquad('bp', 1100, 2, sr);
      return rend(0.22, 0.9, (t, i, w) => {
        p1 += TAU * 640 * (1 + 0.04 * Math.exp(-t * 60)) / sr; p2 += TAU * 1580 / sr;
        return Math.sin(p1) * Math.exp(-t * 32) + Math.sin(p2) * Math.exp(-t * 60) * 0.35 + bp(w) * Math.exp(-t * 140) * 0.9;
      });
    });
    // tiny bamboo stick click (omikuji rattle)
    lazy('click', () => {
      const bp = biquad('bp', 2300, 5, sr), bp2 = biquad('bp', 4100, 4, sr);
      return rend(0.05, 0.9, (t, i, w) => (bp(w) + bp2(w) * 0.6) * Math.exp(-t * 130));
    });
    // dialog blip
    lazy('blip', () => {
      let ph = 0;
      return rend(0.022, 0.9, (t, i, w) => { ph += TAU * 1900 / sr; return (Math.sin(ph) * 0.8 + w * 0.15) * Math.exp(-t * 320) * Math.min(1, t * 4000); });
    });
    // vinyl crackle bed (looped)
    {
      const b = newBuf(ctx, 4.0, 1), d = b.getChannelData(0), hp = biquad('hp', 1800, 0.7, sr), lp = biquad('lp', 5000, 0.7, sr);
      let k = 0;
      for (let i = 0; i < d.length; i++) {
        let x = (rnd() * 2 - 1) * 0.012;                      // hiss
        if (rnd() < 14 / sr) k = (rnd() < 0.12 ? rr(0.5, 1) : rr(0.08, 0.3)) * (rnd() < 0.5 ? -1 : 1);
        x += k; k *= 0.35;
        d[i] = lp(hp(x));
      }
      normalize(d, 0.8); K.vinyl = b;
    }
    // firework crackle (3 variants)
    lazy('crackle', () => [0, 1, 2].map(() => {
      const b = newBuf(ctx, 1.7, 1), d = b.getChannelData(0), hp = biquad('hp', 1500, 0.7, sr);
      let k = 0, burst = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr, rate = 90 * Math.exp(-t * 1.6) * (t < 0.05 ? t / 0.05 : 1);
        if (rnd() < rate / sr) { k = rr(0.2, 1) * (rnd() < 0.5 ? -1 : 1); burst = Math.floor(sr * rr(0.001, 0.005)); }
        let x = 0;
        if (burst > 0) { x = (rnd() * 2 - 1) * Math.abs(k); burst--; }
        d[i] = hp(x);
      }
      normalize(d, 0.9); return b;
    }));

    // Karplus-Strong koto pluck, lazily rendered + cached per MIDI note
    K.plucks = {};
    K.pluck = function (m) {
      if (K.plucks[m]) return K.plucks[m];
      const f = mtof(m), N = Math.max(4, Math.floor(sr / f - 0.5));
      const T60 = clamp(3.6 - (m - 50) * 0.07, 1.1, 3.6), dur = Math.min(3.2, T60 + 0.3);
      const rho = Math.pow(0.001, 1 / (f * T60));
      const b = newBuf(ctx, dur, 1), d = b.getChannelData(0), n = d.length;
      // excitation: bright noise burst with a pluck-position comb (tsume attack)
      let lp = 0; const P = Math.max(1, Math.floor(N * 0.18)), ex = new Float32Array(N);
      for (let i = 0; i < N; i++) { lp += ((rnd() * 2 - 1) - lp) * 0.75; ex[i] = lp; }
      for (let i = 0; i < N; i++) d[i] = ex[i] - 0.7 * ex[(i + P) % N];
      for (let i = N; i < n; i++) d[i] = rho * (0.5 * d[i - N] + 0.5 * (i - N - 1 >= 0 ? d[i - N - 1] : 0));
      // plectrum click
      const bp = biquad('bp', 3400, 1.5, sr);
      for (let i = 0; i < Math.min(n, sr * 0.012); i++) d[i] += bp(rnd() * 2 - 1) * Math.exp(-i / sr * 300) * 0.5;
      let mean = 0; for (let i = 0; i < n; i++) mean += d[i]; mean /= n;
      for (let i = 0; i < n; i++) d[i] -= mean;
      normalize(d, 0.9);
      const F = Math.floor(sr * 0.05); for (let i = 0; i < F; i++) d[n - 1 - i] *= i / F;
      // the period is N + 0.5 samples; playbackRate corrects the residual detune
      const buf = { b, rate: f / (sr / (N + 0.5)) };
      K.plucks[m] = buf; return buf;
    };

    // periodic waves for reed / flute / bass
    function wave(amps) {
      const re = new Float32Array(amps.length + 1), im = new Float32Array(amps.length + 1);
      for (let i = 0; i < amps.length; i++) im[i + 1] = amps[i];
      return ctx.createPeriodicWave(re, im);
    }
    K.waveReed = wave([1, 0.62, 0.48, 0.33, 0.26, 0.17, 0.12, 0.08, 0.05]);
    K.waveShaku = wave([1, 0.18, 0.09, 0.03]);
    K.waveFue = wave([1, 0.42, 0.22, 0.12, 0.06]);
    K.waveBass = wave([1, 0.32, 0.1, 0.04]);
    K.waveRhodes = wave([1, 0.06, 0.02]);
    return K;
  }

  /* ------------------------------------------------------------------ 4 */
  // Voice: a short-lived sub-graph. All sources stop at v.end, then every
  // node of the voice is disconnected and the voice counter released.
  // prio 0 = music/ambience (dropped first under load), 1 = sfx, 2 = must play
  const VP = {
    _n(node) { this.nodes.push(node); return node; },
    gain(v, to) { const g = this._n(this.ctx.createGain()); g.gain.value = v; if (to) g.connect(to); return g; },
    filt(type, f, Q, to) {
      const b = this._n(this.ctx.createBiquadFilter()); b.type = type; b.frequency.value = f;
      if (Q != null) b.Q.value = Q; if (to) b.connect(to); return b;
    },
    pan(p, to) {
      let n;
      if (this.ctx.createStereoPanner) { n = this.ctx.createStereoPanner(); n.pan.value = clamp(p, -1, 1); }
      else n = this.ctx.createGain();
      this._n(n); if (to) n.connect(to); return n;
    },
    osc(type, f, to, start) {
      const o = this._n(this.ctx.createOscillator());
      if (typeof type === 'string') o.type = type; else o.setPeriodicWave(type);
      o.frequency.value = f; if (to) o.connect(to);
      this.srcs.push([o, start == null ? this.t : start, 0]); return o;
    },
    buf(b, to, rate, start, offset, loop) {
      const s = this._n(this.ctx.createBufferSource()); s.buffer = b;
      if (rate) s.playbackRate.value = rate; if (loop) s.loop = true; if (to) s.connect(to);
      this.srcs.push([s, start == null ? this.t : start, offset || 0]); return s;
    },
    noise(kind, to, start, rate) {
      const b = this.G.kit[kind || 'white'];
      return this.buf(b, to, rate || 1, start, rnd() * (b.duration - 0.1), true);
    },
    // modulation link from a persistent node into one of this voice's params
    link(from, param) { from.connect(param); this.ext.push([from, param]); },
    done() {
      const G = this.G, v = this;
      if (!this.srcs.length) { G.active--; return; }
      for (let i = 0; i < this.srcs.length; i++) {
        const s = this.srcs[i];
        try { s[0].start(Math.max(s[1], 0), s[2]); s[0].stop(Math.max(this.end, s[1] + 0.01)); } catch (e) { /* ignore */ }
      }
      let last = this.srcs[0];
      for (let i = 1; i < this.srcs.length; i++) if (this.srcs[i][1] > last[1]) last = this.srcs[i];
      last[0].onended = function () {
        for (let i = 0; i < v.ext.length; i++) { try { v.ext[i][0].disconnect(v.ext[i][1]); } catch (e) { /* old Safari */ } }
        for (let i = 0; i < v.nodes.length; i++) { try { v.nodes[i].disconnect(); } catch (e) { /* ignore */ } }
        v.nodes.length = 0; v.srcs.length = 0; G.active--;
      };
    }
  };
  function voice(G, t, life, prio) {
    if (!G.offline) {
      if (G.active >= HARD_CAP) return null;
      if (!prio && G.active >= SOFT_CAP) return null;
    }
    if (G.log) G.log.push([t, t + life, prio || 0]);
    const v = Object.create(VP);
    v.G = G; v.ctx = G.ctx; v.t = t; v.end = t + life; v.nodes = []; v.srcs = []; v.ext = [];
    G.active++;
    return v;
  }

  // envelope helpers (p = AudioParam)
  function perc(p, t, a, peak, tc) {
    p.setValueAtTime(0, t); p.linearRampToValueAtTime(peak, t + a); p.setTargetAtTime(0, t + a, tc);
  }
  function swell(p, t, a, peak, hold, rel) {
    p.setValueAtTime(0, t); p.linearRampToValueAtTime(peak, t + a);
    p.setValueAtTime(peak, t + a + hold); p.linearRampToValueAtTime(0, t + a + hold + rel);
  }

  /* ------------------------------------------------------------------ 5 */
  function softClipCurve() {
    const n = 4096, c = new Float32Array(n), knee = 0.6, lim = 0.88;
    for (let i = 0; i < n; i++) {
      const x = i / (n - 1) * 2 - 1, a = Math.abs(x);
      const y = a < knee ? a : knee + (lim - knee) * Math.tanh((a - knee) / (lim - knee));
      c[i] = x < 0 ? -y : y;
    }
    return c;
  }

  function lfo(ctx, f, depth, to, type) {
    const o = ctx.createOscillator(); o.type = type || 'sine'; o.frequency.value = f;
    const g = ctx.createGain(); g.gain.value = depth; o.connect(g); if (to) g.connect(to);
    return { o, g };
  }

  // Build the whole persistent graph on ctx (live or offline)
  function buildGraph(ctx, offline, raw) {
    const G = { ctx, offline: !!offline, kit: makeKit(ctx), active: 0, persist: [], srcs: [] };
    const P = (n) => { G.persist.push(n); return n; };
    const gainN = (v, to) => { const g = P(ctx.createGain()); g.gain.value = v; if (to) g.connect(to); return g; };
    const filtN = (type, f, Q, to) => { const b = P(ctx.createBiquadFilter()); b.type = type; b.frequency.value = f; b.Q.value = Q; if (to) b.connect(to); return b; };
    const loopSrc = (buf, to) => { const s = P(ctx.createBufferSource()); s.buffer = buf; s.loop = true; s.connect(to); G.srcs.push(s); return s; };
    const addLfo = (f, depth, to, type) => { const L = lfo(ctx, f, depth, to, type); P(L.o); P(L.g); G.srcs.push(L.o); return L; };

    // ---- master: compressor -> master gain -> safety soft-clip -> out
    const comp = P(ctx.createDynamicsCompressor());
    comp.threshold.value = -18; comp.knee.value = 12; comp.ratio.value = 3; comp.attack.value = 0.008; comp.release.value = 0.3;
    G.master = gainN(0.9);
    comp.connect(G.master);
    if (raw) G.master.connect(ctx.destination);
    else { const clip = P(ctx.createWaveShaper()); clip.curve = softClipCurve(); clip.oversample = 'none'; G.master.connect(clip); clip.connect(ctx.destination); }

    // ---- reverb (procedural IR) as a shared send
    const conv = P(ctx.createConvolver()); conv.normalize = true; conv.buffer = G.kit.ir;
    G.rev = gainN(1);
    const revHP = filtN('highpass', 140, 0.7, conv);
    G.rev.connect(revHP);
    const revOut = gainN(0.55, comp); conv.connect(revOut);

    const bus = (lvl, send) => { const g = gainN(lvl, comp); gainN(send, G.rev); g.connect(G.persist[G.persist.length - 1]); return g; };
    G.musicBus = bus(1, 0.42);
    G.ambBus = bus(1, 0.22);
    G.sfxBus = bus(1, 0.32);
    G.stepBus = bus(1, 0.12);
    G.uiBus = bus(1, 0.18);

    // ---- music: layers -> tone LP (rain darkens) -> music bus
    G.musicTone = filtN('lowpass', 14000, 0.5, G.musicBus);
    G.musicLvl = gainN(0.8, G.musicTone);   // overall music level (ducked by rain)
    G.musicLvl.disconnect(); G.musicLvl.connect(G.musicTone);
    // city layer: in -> tape LP -> layer gain
    G.cityGain = gainN(0, G.musicLvl);
    G.tape = filtN('lowpass', 3600, 0.6, G.cityGain);
    G.cityIn = gainN(1, G.tape);
    G.epBus = gainN(0.82, G.cityIn);         // e-piano bus with tremolo
    addLfo(4.3, 0.15, G.epBus.gain);
    G.vinylG = gainN(0.05, G.cityGain);
    loopSrc(G.kit.vinyl, filtN('bandpass', 3000, 0.4, G.vinylG));
    // tape wow + flutter, linked into e-piano / bass oscillator detune
    G.wow = gainN(1);
    addLfo(0.43, 7, G.wow); addLfo(5.9, 1.6, G.wow);
    addLfo(0.21, 120, G.tape.detune);
    // temple layer (wetter)
    G.templeGain = gainN(0, G.musicLvl);
    gainN(0.35, G.rev); G.templeGain.connect(G.persist[G.persist.length - 1]);
    G.templeIn = gainN(1, G.templeGain);
    // festival layer
    G.festGain = gainN(0, G.musicLvl);
    G.festIn = gainN(1, G.festGain);

    // ---- ambience beds (persistent loops, gains driven by update())
    const A = G.ambBus;
    G.humG = gainN(0, A);
    loopSrc(G.kit.brown, filtN('lowpass', 320, 0.7, G.humG));
    G.rainG = gainN(0, A);
    { const lp = filtN('lowpass', 5200, 0.5, G.rainG), hp = filtN('highpass', 380, 0.5, lp); loopSrc(G.kit.pink, hp); }
    G.rainHiss = gainN(0, A);
    loopSrc(G.kit.white, filtN('highpass', 4200, 0.5, G.rainHiss));
    G.waterG = gainN(0, A);
    {
      const am = gainN(0.5, G.waterG);
      addLfo(0.23, 0.28, am.gain); addLfo(0.37, 0.18, am.gain);
      const bp = filtN('bandpass', 520, 0.9, am); addLfo(0.29, 140, bp.frequency);
      loopSrc(G.kit.brown, bp);
    }
    G.crowdG = gainN(0, A);
    {
      const am = gainN(0.6, G.crowdG); addLfo(0.13, 0.25, am.gain); addLfo(0.31, 0.12, am.gain);
      const b1 = filtN('bandpass', 480, 1.6, am), b2 = filtN('bandpass', 1150, 2.2, am);
      addLfo(0.7, 90, b1.frequency); addLfo(0.53, 220, b2.frequency);
      const src = gainN(1); src.connect(b1); src.connect(b2);
      loopSrc(G.kit.pink, src);
    }

    G.srcs.forEach((s) => { try { s.start(0); } catch (e) { /* ignore */ } });
    G.applied = {};
    G.listener = { x: 0, z: 0 };
    G.state = { zone: 0, rain: 0, water: 0, crowd: 0, festival: 0 };
    G.music = newConductor();
    return G;
  }

  // set an AudioParam smoothly, only if the value moved meaningfully
  function setP(G, key, param, v, tc, eps) {
    const old = G.applied[key];
    if (old !== undefined && Math.abs(old - v) < (eps || 0.004)) return;
    G.applied[key] = v;
    if (G.offline || old === undefined) { param.value = v; return; }
    param.setTargetAtTime(v, G.ctx.currentTime, tc || 0.5);
  }

  /* ------------------------------------------------------------------ 6 */
  // Instruments. Signature convention: (G, dest, t, ...) ; all return nothing.

  // one-shot buffer player (drums, clicks ...)
  function play(G, dest, t, buf, vel, rate, pan, prio, lpHz) {
    rate = rate || 1;
    const v = voice(G, t, buf.duration / rate + 0.02, prio || 0);
    if (!v) return;
    let out = v.gain(vel, pan ? v.pan(pan, dest) : dest);
    if (lpHz) out = v.filt('lowpass', lpHz, 0.7, out);
    v.buf(buf, out, rate);
    v.done();
  }

  // FM electric piano (Rhodes-ish). notes: array of midi; strum: s between notes
  function epiano(G, dest, t, notes, dur, vel, strum, bright) {
    const v = voice(G, t, dur + 1.6, 0);
    if (!v) return;
    const out = v.gain(1, dest);
    const ix = bright == null ? 1 : bright;
    for (let i = 0; i < notes.length; i++) {
      const tt = t + i * (strum || 0) + rr(0, 0.006), f = mtof(notes[i]);
      const g = v.gain(0, out), c = v.osc('sine', f, g, tt), m = v.osc('sine', f, null, tt);
      const mg = v.gain(0, c.frequency); m.connect(mg);
      const pk = f * 1.6 * ix * (0.6 + vel * 0.6);
      mg.gain.setValueAtTime(pk, tt); mg.gain.setTargetAtTime(f * 0.12 * ix, tt, 0.22);
      v.link(G.wow, c.detune);
      const a = vel * 0.17 / Math.sqrt(notes.length * 0.35 + 0.65) * (notes[i] > 76 ? 0.7 : 1);
      const gp = g.gain;
      gp.setValueAtTime(0, tt); gp.linearRampToValueAtTime(a, tt + 0.005);
      gp.setTargetAtTime(a * 0.4, tt + 0.005, 0.5);
      gp.setTargetAtTime(0, tt + dur, 0.28);
    }
    v.done();
  }

  // round sine-ish bass
  function bass(G, dest, t, m, dur, vel) {
    const v = voice(G, t, dur + 0.8, 0);
    if (!v) return;
    const g = v.gain(0, v.filt('lowpass', 520, 0.8, dest));
    const o = v.osc(G.kit.waveBass, mtof(m), g);
    v.link(G.wow, o.detune);
    const p = g.gain, a = 0.17 * vel;
    p.setValueAtTime(0, t); p.linearRampToValueAtTime(a, t + 0.012);
    p.setTargetAtTime(a * 0.55, t + 0.02, 0.35); p.setTargetAtTime(0, t + dur, 0.07);
    v.done();
  }

  // Karplus-Strong koto pluck from cache. bend: semitones of oshide press
  function koto(G, dest, t, m, vel, pan, bend) {
    const P = G.kit.pluck(m);
    const v = voice(G, t, P.b.duration + 0.05, 0);
    if (!v) return;
    const g = v.gain(0.55 * vel, v.pan(pan || 0, dest));
    const lp = v.filt('lowpass', 2200 + vel * 4200, 0.6, g);
    const s = v.buf(P.b, lp, P.rate);
    if (bend) {
      const r = s.playbackRate;
      r.setValueAtTime(P.rate, t + 0.16);
      r.linearRampToValueAtTime(P.rate * Math.pow(2, bend / 12), t + 0.32);
      if (bend < 1.5) r.setTargetAtTime(P.rate, t + 0.9, 0.12);
    }
    v.done();
  }

  // breathy end-blown flute. kind: 'shaku' (shakuhachi) | 'fue' (shinobue)
  function flute(G, dest, t, m, dur, vel, from, kind, grace) {
    const fue = kind === 'fue', f = mtof(m), K = G.kit;
    const rel = fue ? 0.12 : 0.45;
    const v = voice(G, t, dur + rel + 0.3, 0);
    if (!v) return;
    const out = v.gain(1, v.filt('lowpass', fue ? 5200 : 2600, 0.6, dest));
    const amp = v.gain(0, out);
    const o = v.osc(fue ? K.waveFue : K.waveShaku, f, amp);
    const fr = o.frequency;
    if (grace) { fr.setValueAtTime(mtof(grace), t); fr.setValueAtTime(f, t + 0.045); }
    else if (from) { fr.setValueAtTime(mtof(from), t); fr.exponentialRampToValueAtTime(f, t + (fue ? 0.06 : 0.2)); }
    else { fr.setValueAtTime(f * (fue ? 0.995 : 0.975), t); fr.exponentialRampToValueAtTime(f, t + 0.12); }
    if (!fue && dur > 1) fr.setTargetAtTime(f * 0.985, t + dur - 0.05, 0.12);  // falling meri at release
    // vibrato that deepens on long notes
    const vib = v.osc('sine', fue ? 6.2 : rr(4.6, 5.4), null), vg = v.gain(0, fr);
    vib.connect(vg);
    const vs = fue ? 0.25 : 0.45;
    if (dur > vs) {
      vg.gain.setValueAtTime(0, t + vs);
      vg.gain.linearRampToValueAtTime(f * (fue ? 0.006 : 0.014), t + Math.max(vs + 0.1, dur));
    }
    // amplitude: soft breath onset, slight swell, release
    const A = (fue ? 0.1 : 0.12) * vel, p = amp.gain, at = fue ? 0.035 : 0.16;
    p.setValueAtTime(0, t); p.linearRampToValueAtTime(A * 0.85, t + at);
    p.linearRampToValueAtTime(A, t + Math.max(at + 0.01, dur * 0.6));
    p.linearRampToValueAtTime(A * 0.8, t + dur); p.linearRampToValueAtTime(0, t + dur + rel);
    // breath noise following the note (+ a louder chiff at the onset)
    const bg = v.gain(0, out), bp = v.filt('bandpass', f * (fue ? 2 : 1.5), fue ? 1.2 : 0.9, bg);
    v.noise('white', bp, t);
    const B = A * (fue ? 0.5 : 0.95), bq = bg.gain;
    bq.setValueAtTime(0, t); bq.linearRampToValueAtTime(B * 2.2, t + 0.03);
    bq.linearRampToValueAtTime(B, t + 0.2); bq.setValueAtTime(B, t + dur);
    bq.linearRampToValueAtTime(0, t + dur + rel);
    v.done();
  }

  // sho mouth organ cluster (aitake-like): swelling detuned reeds
  function sho(G, dest, t, notes, dur, vel, att) {
    att = att || 2.2;
    const v = voice(G, t, Math.max(att, dur) + att + 0.2, 0);
    if (!v) return;
    const g = v.gain(0, v.filt('lowpass', 2300, 0.5, dest));
    const per = 0.065 * vel / Math.sqrt(notes.length);
    for (let i = 0; i < notes.length; i++) {
      const og = v.gain(per * (notes[i] > 74 ? 0.75 : 1), g);
      const o = v.osc(G.kit.waveReed, mtof(notes[i]), og, t);
      o.detune.value = rr(-7, 7);
    }
    const p = g.gain;
    p.setValueAtTime(0, t); p.linearRampToValueAtTime(0.75, t + att * 0.6); p.linearRampToValueAtTime(1, t + att);
    p.setValueAtTime(1, t + Math.max(att, dur)); p.linearRampToValueAtTime(0, t + Math.max(att, dur) + att * 0.9);
    v.done();
  }

  // rin / singing bowl: inharmonic partials, beating pairs, ~6s decay
  function rin(G, dest, t, f0, vel, pan, lite, prio) {
    const R = [1, 2.71, 5.12, 8.3, 12.1], Am = [1, 0.55, 0.32, 0.16, 0.08], T = [6.5, 4.8, 3.0, 1.8, 1.1];
    const v = voice(G, t, 7, prio == null ? 1 : prio);
    if (!v) return;
    const out = v.gain(0.24 * vel, v.pan(pan || 0, dest));
    const n = lite ? 3 : R.length;
    for (let k = 0; k < n; k++) {
      const f = f0 * R[k];
      if (f > 15000) break;
      const g = v.gain(0, out), pair = !lite && k < 3;     // low partials: slowly beating pairs
      perc(g.gain, t, 0.002, Am[k] * (pair ? 0.5 : 1), T[k] / 6.9);
      if (pair) { const b = rr(0.7, 2.2); v.osc('sine', f - b / 2, g, t); v.osc('sine', f + b / 2, g, t); }
      else v.osc('sine', f, g, t);
    }
    if (!lite) {                         // strike transient
      const sg = v.gain(0, out); perc(sg.gain, t, 0.001, 0.35, 0.008);
      v.noise('white', v.filt('highpass', 2800, 0.7, sg), t);
    }
    v.done();
  }

  // big temple bell (bonsho) struck with a log
  function bonsho(G, dest, t, vel, lite, prio) {
    const f0 = rr(128, 144);                   // 'prime'; the hum partial (x0.5) sits at 64-72 Hz
    const R = [0.5, 1, 1.52, 2.03, 2.68, 3.23, 4.16, 5.42];
    const Am = [0.35, 1, 0.42, 0.55, 0.3, 0.24, 0.14, 0.08];
    const T = [13, 11, 8, 7, 5, 3.8, 2.8, 2];
    const Bt = [0.3, 0.85, 1.3, 1.05, 1.9, 2.4, 2.9, 3.4];
    const v = voice(G, t, lite ? 9 : 12, prio == null ? 1 : prio);
    if (!v) return;
    const out = v.gain(0.42 * vel, dest);
    const n = lite ? 5 : R.length;
    for (let k = 0; k < n; k++) {
      const f = f0 * R[k], g = v.gain(0, out), a = k < 2 ? 0.03 : 0.006;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(Am[k] * (lite ? 1 : 0.5), t + a);
      g.gain.setTargetAtTime(0, t + a, T[k] / 6.9);
      if (lite) v.osc('sine', f, g, t);
      else { v.osc('sine', f - Bt[k] / 2, g, t); v.osc('sine', f + Bt[k] / 2, g, t); }
    }
    // wooden log thump
    const th = v.gain(0, v.filt('lowpass', 420, 0.8, out));
    perc(th.gain, t, 0.003, 0.9, 0.05);
    v.noise('brown', th, t);
    const sg = v.gain(0, out), s = v.osc('sine', 120, sg, t);
    s.frequency.setValueAtTime(120, t); s.frequency.exponentialRampToValueAtTime(48, t + 0.2);
    perc(sg.gain, t, 0.002, 0.6, 0.07);
    if (!lite) v.buf(G.kit.wood, v.gain(0.25, v.filt('lowpass', 900, 0.7, out)), 0.3, t);
    v.done();
  }

  // koto + rin helpers used by UI motifs
  function motif(G, dest, t, notes, gap, vel, lastLong) {
    for (let i = 0; i < notes.length; i++) {
      const isLast = i === notes.length - 1;
      kotoSfx(G, dest, t + i * gap * (isLast && lastLong ? 1.3 : 1), notes[i], vel * (isLast ? 1 : 0.85), (i - notes.length / 2) * 0.06);
    }
  }
  function kotoSfx(G, dest, t, m, vel, pan) {
    const P = G.kit.pluck(m);
    const v = voice(G, t, P.b.duration + 0.05, 1);
    if (!v) return;
    v.buf(P.b, v.filt('lowpass', 6000, 0.6, v.gain(0.5 * vel, v.pan(pan || 0, dest))), P.rate);
    v.done();
  }

  /* ------------------------------------------------------------------ 7 */
  // One-shot SFX. Each entry: [lifeSeconds, fn(G, dest, t, opts)]

  // filtered-noise burst inside an existing voice
  function nz(v, d, t, o) {
    const g = v.gain(0, d);
    const f = v.filt(o.ft || 'bandpass', o.f || 1000, o.q == null ? 0.8 : o.q, g);
    if (o.f2) { f.frequency.setValueAtTime(o.f, t); f.frequency.exponentialRampToValueAtTime(o.f2, t + (o.fs || 0.3)); }
    v.noise(o.n || 'white', f, t, o.rate);
    const p = g.gain, a = o.a || 0.003, h = o.hold || 0;
    p.setValueAtTime(0, t); p.linearRampToValueAtTime(o.pk, t + a);
    if (h) p.setValueAtTime(o.pk, t + a + h);
    p.setTargetAtTime(0, t + a + h, o.tc || 0.05);
    g.f = f;
    return g;
  }
  // water bubble / drip: rising sine blip
  function bub(v, d, t, f, dur, pk) {
    const g = v.gain(0, d), o = v.osc('sine', f, g, t);
    o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * rr(1.5, 2.2), t + dur);
    perc(g.gain, t, 0.002, pk, dur * 0.4);
  }
  // a sum of decaying sine partials (metal / glass)
  function partials(v, d, t, f0, R, A, T, beat) {
    for (let k = 0; k < R.length; k++) {
      const f = f0 * R[k]; if (f > 16000) break;
      const g = v.gain(0, d);
      perc(g.gain, t, 0.0015, A[k], T[k]);
      v.osc('sine', f, g, t);
      if (beat && k === 0) v.osc('sine', f * (1 + beat), g, t);
    }
  }
  // many short noise grains (paper, leaves, rattles, gravel)
  function grains(v, d, t, n, span, fLo, fHi, pk, tcLo, tcHi, q) {
    for (let i = 0; i < n; i++) {
      const tt = t + rnd() * span;
      nz(v, d, tt, { f: rr(fLo, fHi), q: q || 1.2, a: 0.001, pk: pk * rr(0.3, 1), tc: rr(tcLo, tcHi) });
    }
  }

  const SFX = {
    coin: [1.6, function (G, d, t) {
      const v = voice(G, t, 1.5, 1); if (!v) return;
      const f = rr(2900, 3400), R = [1, 1.53, 2.41, 3.37], A = [0.16, 0.1, 0.07, 0.04], T = [0.09, 0.06, 0.04, 0.03];
      partials(v, d, t, f, R, A, T);
      partials(v, d, t + rr(0.08, 0.11), f * rr(1.02, 1.07), R, A.map((a) => a * 0.65), T);
      if (chance(0.75)) partials(v, d, t + rr(0.16, 0.2), f * rr(0.95, 0.99), R, A.map((a) => a * 0.4), T);
      const tt = t + rr(0.24, 0.28);                      // falls into the wooden box
      v.buf(G.kit.wood, v.gain(0.3, v.filt('lowpass', 800, 0.7, d)), 0.42, tt);
      nz(v, d, tt, { n: 'brown', ft: 'lowpass', f: 300, q: 0.7, a: 0.003, pk: 0.5, tc: 0.05 });
      v.done();
    }],

    bow: [1.4, function (G, d, t) {
      const v = voice(G, t, 1.3, 1); if (!v) return;
      nz(v, d, t, { n: 'pink', f: 1500, q: 0.6, a: 0.22, pk: 0.13, tc: 0.12 });
      nz(v, d, t + 0.4, { n: 'pink', f: 2200, q: 0.8, a: 0.15, pk: 0.07, tc: 0.1 });
      v.done();
    }],

    rin: [7.5, function (G, d, t) { rin(G, d, t, rr(650, 690), 1, 0, false, 2); }],

    bell: [12.5, function (G, d, t, o) {
      bonsho(G, d, t, 1, false, 2);
      bonsho(G, G.rev, t, 0.35 * clamp(num(o.vol, 1), 0, 1), true, 1);   // extra wash in the reverb
    }],

    omikuji: [1.8, function (G, d, t) {
      const v = voice(G, t, 1.7, 1); if (!v) return;
      const K = G.kit;
      for (let s = 0; s < 4; s++) {                       // four shakes of the box
        const ts = t + s * 0.2 + rr(-0.01, 0.01);
        v.buf(K.wood, v.gain(rr(0.12, 0.18), v.filt('lowpass', 1200, 0.7, d)), rr(0.55, 0.7), ts);
        const n = ri(5, 8);
        for (let i = 0; i < n; i++) v.buf(K.click, v.gain(rr(0.04, 0.12), d), rr(0.75, 1.35), ts + rr(0, 0.08));
      }
      const tt = t + 0.95;                                // one stick slides out
      nz(v, d, tt, { f: 1800, f2: 3400, fs: 0.32, q: 3, a: 0.05, hold: 0.22, pk: 0.09, tc: 0.03 });
      v.buf(K.click, v.gain(0.16, d), 0.6, tt + 0.34);
      v.buf(K.wood, v.gain(0.1, d), 1.25, tt + 0.36);
      v.done();
    }],

    paper: [1.2, function (G, d, t) {
      const v = voice(G, t, 1.1, 1); if (!v) return;
      grains(v, d, t, ri(9, 13), 0.65, 2500, 7000, 0.12, 0.005, 0.03, 1.4);
      nz(v, d, t + 0.05, { n: 'pink', f: 900, q: 0.7, a: 0.08, pk: 0.06, tc: 0.07 });
      nz(v, d, t + 0.45, { n: 'pink', f: 1200, q: 0.7, a: 0.06, pk: 0.05, tc: 0.06 });
      v.done();
    }],

    fortune_good: [3.5, function (G, d, t) {
      motif(G, d, t, [74, 76, 79, 81, 83, 86], 0.085, 0.85, true);
      rin(G, d, t + 0.55, 1175, 0.35, 0.1, true, 1);
    }],

    fortune_bad: [3.5, function (G, d, t) {
      motif(G, d, t, [81, 79, 75, 74], 0.2, 0.55, true);
      kotoSfx(G, d, t + 0.95, 62, 0.45, -0.1);
    }],

    water_ladle: [2.8, function (G, d, t) {
      const v = voice(G, t, 2.7, 1); if (!v) return;
      v.buf(G.kit.wood, v.gain(0.1, d), 0.85, t);         // ladle touches the basin
      nz(v, d, t + 0.08, { n: 'brown', ft: 'lowpass', f: 900, q: 0.7, a: 0.12, pk: 0.35, tc: 0.12 });
      for (let i = 0; i < 3; i++) bub(v, d, t + 0.1 + rr(0, 0.25), rr(450, 900), rr(0.05, 0.1), 0.06);
      const tp = t + 0.65;                                // pour
      const pg = nz(v, d, tp, { n: 'pink', f: 1100, q: 0.7, a: 0.12, hold: 1.0, pk: 0.16, tc: 0.15 });
      nz(v, d, tp + 0.05, { f: 3200, q: 0.5, a: 0.15, hold: 0.9, pk: 0.04, tc: 0.15 });
      const fl = v.osc('sine', 9, v.gain(0.05, pg.gain), tp); fl.frequency.value = rr(8, 12);
      for (let i = 0; i < 12; i++) bub(v, d, tp + rr(0, 1.25), rr(700, 1700), rr(0.03, 0.07), rr(0.02, 0.05));
      v.done();
    }],

    incense: [2.4, function (G, d, t) {
      const v = voice(G, t, 2.3, 1); if (!v) return;
      for (let i = 0; i < 4; i++)                         // match scratch
        nz(v, d, t + i * 0.028 + rr(0, 0.01), { f: rr(2500, 4200), q: 0.9, a: 0.004, pk: rr(0.1, 0.18), tc: 0.015 });
      nz(v, d, t + 0.12, { n: 'pink', ft: 'lowpass', f: 400, f2: 2600, fs: 0.12, q: 0.7, a: 0.04, pk: 0.22, tc: 0.18 });
      nz(v, d, t + 0.15, { n: 'brown', ft: 'lowpass', f: 650, q: 0.6, a: 0.1, hold: 0.6, pk: 0.12, tc: 0.35 });
      v.buf(G.kit.crackle[ri(0, 2)], v.gain(0.07, v.filt('lowpass', 2600, 0.7, d)), 0.6, t + 0.3);
      v.done();
    }],

    splash: [1.6, function (G, d, t) {
      const v = voice(G, t, 1.5, 1); if (!v) return;
      nz(v, d, t, { n: 'white', ft: 'lowpass', f: 4500, f2: 500, fs: 0.3, q: 0.7, a: 0.006, pk: 0.28, tc: 0.09 });
      nz(v, d, t, { n: 'brown', ft: 'lowpass', f: 320, q: 0.7, a: 0.008, pk: 0.45, tc: 0.07 });
      bub(v, d, t + 0.03, rr(350, 500), 0.08, 0.09);
      for (let i = 0; i < 6; i++) bub(v, d, t + rr(0.15, 0.75), rr(900, 2200), rr(0.02, 0.05), rr(0.02, 0.05));
      v.done();
    }],

    lantern: [2.2, function (G, d, t) {
      const v = voice(G, t, 2.1, 1); if (!v) return;
      grains(v, d, t, 5, 0.25, 2500, 6000, 0.07, 0.005, 0.02, 1.4);
      const tp = t + 0.35;
      bub(v, d, tp, rr(240, 300), 0.09, 0.12);
      nz(v, d, tp, { n: 'brown', ft: 'lowpass', f: 380, q: 0.7, a: 0.006, pk: 0.2, tc: 0.05 });
      for (let i = 0; i < 3; i++)                         // small ripples lapping
        nz(v, d, tp + 0.2 + i * 0.28, { n: 'brown', f: 520 - i * 50, q: 1.2, a: 0.08, pk: 0.12 / (i + 1), tc: 0.08 });
      v.done();
    }],

    vend: [2.4, function (G, d, t) {
      const v = voice(G, t, 2.3, 1); if (!v) return;
      const bg = v.gain(0, v.filt('lowpass', 3000, 0.7, d));          // button beep
      v.osc('square', 1760, bg, t);
      bg.gain.setValueAtTime(0, t); bg.gain.linearRampToValueAtTime(0.035, t + 0.005);
      bg.gain.setValueAtTime(0.035, t + 0.09); bg.gain.linearRampToValueAtTime(0, t + 0.1);
      const tw = t + 0.25, wg = v.gain(0, v.filt('lowpass', 700, 1, d)); // motor whirr
      const m = v.osc('sawtooth', 60, wg, tw);
      m.frequency.setValueAtTime(55, tw); m.frequency.linearRampToValueAtTime(95, tw + 0.25); m.frequency.linearRampToValueAtTime(80, tw + 0.8);
      swell(wg.gain, tw, 0.08, 0.07, 0.6, 0.12);
      const rg = nz(v, d, tw, { n: 'pink', f: 420, q: 2, a: 0.08, hold: 0.62, pk: 0.06, tc: 0.04 });
      v.osc('sine', 31, v.gain(0.03, rg.gain), tw);
      const drop = (tt, k) => {                                       // can clunks down the chute
        nz(v, d, tt, { n: 'brown', ft: 'lowpass', f: 520, q: 0.8, a: 0.003, pk: 0.5 * k, tc: 0.06 });
        partials(v, d, tt, rr(500, 560), [1, 2.57, 4.26, 6.7], [0.08 * k, 0.05 * k, 0.03 * k, 0.015 * k], [0.12, 0.08, 0.05, 0.03]);
      };
      drop(t + 1.15, 1); drop(t + 1.34, 0.45); drop(t + 1.45, 0.2);
      v.done();
    }],

    can: [1.3, function (G, d, t) {
      const v = voice(G, t, 1.2, 1); if (!v) return;
      v.buf(G.kit.click, v.gain(0.18, d), 0.55, t);
      partials(v, d, t, 2400, [1, 2.3], [0.04, 0.02], [0.03, 0.02]);
      nz(v, d, t + 0.025, { n: 'white', ft: 'bandpass', f: 7000, f2: 3200, fs: 0.25, q: 0.6, a: 0.004, pk: 0.3, tc: 0.09 });
      grains(v, d, t + 0.1, 14, 0.8, 4000, 9000, 0.03, 0.003, 0.01, 1.5);   // fizz
      v.done();
    }],

    meow: [1.0, function (G, d, t) {
      const v = voice(G, t, 0.9, 1); if (!v) return;
      const k = rr(0.92, 1.1), src = v.osc('sawtooth', 620 * k, null, t), F = src.frequency;
      F.setValueAtTime(600 * k, t); F.linearRampToValueAtTime(800 * k, t + 0.12);
      F.linearRampToValueAtTime(720 * k, t + 0.35); F.linearRampToValueAtTime(520 * k, t + 0.58);
      const vib = v.osc('sine', 7, v.gain(10, F), t); vib.frequency.value = rr(6, 8);
      const amp = v.gain(0, d), sum = v.gain(1, amp);
      const fm = [[400, 900, 650, 450, 1], [2300, 1500, 1100, 900, 0.55], [3100, 2700, 2600, 2500, 0.25]];
      for (let i = 0; i < 3; i++) {
        const b = v.filt('bandpass', fm[i][0], 7, v.gain(fm[i][4], sum)), q = b.frequency;
        q.setValueAtTime(fm[i][0], t); q.linearRampToValueAtTime(fm[i][1], t + 0.15);
        q.linearRampToValueAtTime(fm[i][2], t + 0.4); q.linearRampToValueAtTime(fm[i][3], t + 0.58);
        src.connect(b);
      }
      const a = amp.gain;
      a.setValueAtTime(0, t); a.linearRampToValueAtTime(0.5, t + 0.05); a.linearRampToValueAtTime(0.42, t + 0.4);
      a.linearRampToValueAtTime(0, t + 0.62);
      nz(v, amp, t, { n: 'white', f: 2500, q: 1, a: 0.03, hold: 0.3, pk: 0.04, tc: 0.08 });
      v.done();
    }],

    purr: [1.8, function (G, d, t) {
      const v = voice(G, t, 1.7, 1); if (!v) return;
      const am = v.gain(0.5, d), env = v.gain(0, am);
      const L = v.osc('sine', 26, v.gain(0.5, am.gain), t);
      L.frequency.setValueAtTime(26, t); L.frequency.setValueAtTime(22, t + 0.78);
      v.noise('brown', v.filt('lowpass', 520, 0.8, env), t);
      const buzz = v.osc('sawtooth', 26, v.gain(0.12, v.filt('lowpass', 260, 0.8, env)), t);
      buzz.frequency.setValueAtTime(26, t); buzz.frequency.setValueAtTime(22, t + 0.78);
      const p = env.gain;                                  // exhale ... inhale
      p.setValueAtTime(0, t); p.linearRampToValueAtTime(0.7, t + 0.12); p.linearRampToValueAtTime(0.55, t + 0.65);
      p.linearRampToValueAtTime(0.05, t + 0.76); p.linearRampToValueAtTime(0.4, t + 0.9);
      p.linearRampToValueAtTime(0.35, t + 1.35); p.linearRampToValueAtTime(0, t + 1.52);
      v.done();
    }],

    crossing: [2.4, function (G, d, t) {
      const v = voice(G, t, 2.3, 1); if (!v) return;
      const out = v.filt('lowpass', 5000, 0.7, d);
      for (let i = 0; i < 6; i++) {
        const tt = t + Math.floor(i / 2) * 0.72 + (i % 2) * 0.27;
        const g = v.gain(0, out), o = v.osc('triangle', 2400, g, tt), f = o.frequency;
        f.setValueAtTime(2400, tt); f.exponentialRampToValueAtTime(3150, tt + 0.03);
        f.setValueAtTime(3150, tt + 0.06); f.exponentialRampToValueAtTime(2050, tt + 0.16);
        const p = g.gain;
        p.setValueAtTime(0, tt); p.linearRampToValueAtTime(0.07, tt + 0.01); p.linearRampToValueAtTime(0.03, tt + 0.06);
        p.linearRampToValueAtTime(0.065, tt + 0.08); p.linearRampToValueAtTime(0, tt + 0.17);
      }
      v.done();
    }],

    door: [2.6, function (G, d, t) {               // original two-tone chime (descending minor third)
      const v = voice(G, t, 2.5, 1); if (!v) return;
      const R = [1, 4, 9.8], T = [0.55, 0.14, 0.04];
      partials(v, d, t, mtof(82), R, [0.12, 0.03, 0.008], T, 0.002);
      partials(v, d, t + 0.42, mtof(79), R, [0.12, 0.03, 0.008], T.map((x) => x * 1.4), 0.002);
      v.done();
    }],

    chime: [3.2, function (G, d, t) {
      const v = voice(G, t, 3.1, 1); if (!v) return;
      const n = ri(2, 4), base = [2350, 2620, 2960, 3140, 3520];
      for (let i = 0; i < n; i++) {
        const tt = t + (i ? rr(0.12, 1.1) : 0), f = pick(base) * rr(0.995, 1.005);
        partials(v, d, tt, f, [1, 2.32, 4.25], [0.05, 0.022, 0.01], [0.35, 0.16, 0.07], 0.0025);
        nz(v, d, tt, { f: 7000, q: 1, a: 0.001, pk: 0.03, tc: 0.004 });
      }
      v.done();
    }],

    firework_launch: [2.1, function (G, d, t) {
      const v = voice(G, t, 2.0, 1); if (!v) return;
      nz(v, d, t, { n: 'brown', ft: 'lowpass', f: 250, q: 0.7, a: 0.004, pk: 0.35, tc: 0.05 });
      const g = v.gain(0, d), o = v.osc('sine', 500, g, t), f = o.frequency;
      f.setValueAtTime(500, t + 0.05); f.exponentialRampToValueAtTime(rr(2300, 2800), t + 1.65);
      v.osc('sine', 11, v.gain(25, f), t);
      const p = g.gain;
      p.setValueAtTime(0, t); p.linearRampToValueAtTime(0.03, t + 0.3); p.linearRampToValueAtTime(0.05, t + 1.4);
      p.linearRampToValueAtTime(0, t + 1.7);
      nz(v, d, t + 0.05, { f: 3500, q: 0.7, a: 1.0, hold: 0.4, pk: 0.035, tc: 0.08 });
      v.done();
    }],

    firework_boom: [3.6, function (G, d, t, o) {
      const k = clamp(num(o.vol, 1), 0, 1.5), v = voice(G, t, 3.5, 2); if (!v) return;
      // (opts.vol already scales the level in sfxDest; here it only darkens far booms)
      const out = v.gain(1, v.filt('lowpass', 300 + 1800 * Math.min(1, k), 0.6, d));
      out.connect(v.gain(0.7 * Math.min(1, k + 0.2), G.rev));   // big smeared reverb tail
      const sg = v.gain(0, out), s = v.osc('sine', 90, sg, t);
      s.frequency.setValueAtTime(95, t); s.frequency.exponentialRampToValueAtTime(38, t + 0.5);
      perc(sg.gain, t, 0.01, 0.55, 0.3);
      nz(v, out, t, { n: 'brown', ft: 'lowpass', f: 320, f2: 110, fs: 1.2, q: 0.7, a: 0.02, pk: 0.75, tc: 0.45 });
      nz(v, out, t, { n: 'pink', ft: 'lowpass', f: 1800, q: 0.7, a: 0.003, pk: 0.4, tc: 0.07 });
      v.done();
    }],

    crackle: [1.9, function (G, d, t) {
      const v = voice(G, t, 1.8, 1); if (!v) return;
      v.buf(pick(G.kit.crackle), v.gain(0.13, v.pan(rr(-0.4, 0.4), v.filt('highpass', 1200, 0.7, d))), rr(0.9, 1.1), t);
      v.done();
    }],

    taiko: [2.1, function (G, d, t) {
      play(G, d, t, G.kit.taiko, 0.7, rr(0.97, 1.03), 0, 2);
      play(G, d, t, G.kit.click, 0.08, 0.45, 0, 1);
    }],

    blip: [0.06, function (G, d, t) { play(G, d, t, G.kit.blip, 0.028, rr(0.92, 1.1), 0, 1, 5000); }],

    select: [1.6, function (G, d, t) {
      play(G, d, t, G.kit.wood, 0.12, 1.3, 0, 2);
      rin(G, d, t + 0.02, 1320, 0.22, 0, true, 1);
    }],

    back: [0.4, function (G, d, t) { play(G, d, t, G.kit.wood, 0.12, 0.78, 0, 2, 1500); }],

    quest: [5, function (G, d, t) {
      motif(G, d, t, [67, 69, 74, 79], 0.12, 0.8, true);
      rin(G, d, t + 0.5, 880, 0.45, 0.05, false, 1);
    }],

    gate: [2.8, function (G, d, t) {
      const v = voice(G, t, 2.7, 1); if (!v) return;
      const g = nz(v, d, t, { n: 'pink', f: 350, q: 1.2, a: 0.7, hold: 0.1, pk: 0.14, tc: 0.35 });
      const bp = g.f;
      bp.frequency.setValueAtTime(350, t); bp.frequency.exponentialRampToValueAtTime(1600, t + 0.8);
      bp.frequency.exponentialRampToValueAtTime(500, t + 2.0);
      const tg = v.gain(0, d);
      [62, 69, 74].forEach((m, i) => { const o = v.osc('sine', mtof(m), v.gain(i === 2 ? 0.5 : 1, tg), t); o.detune.value = rr(-4, 4); });
      swell(tg.gain, t, 0.6, 0.035, 0.4, 1.3);
      v.done();
    }],

    leaves: [1.3, function (G, d, t) {
      const v = voice(G, t, 1.2, 1); if (!v) return;
      grains(v, d, t, ri(18, 26), 0.85, 3000, 8000, 0.06, 0.003, 0.012, 1.3);
      nz(v, d, t, { n: 'pink', f: 2600, q: 0.5, a: 0.2, hold: 0.3, pk: 0.035, tc: 0.15 });
      v.done();
    }],

    thunder: [5.5, function (G, d, t) {
      const v = voice(G, t, 5.4, 2); if (!v) return;
      const lp = v.filt('lowpass', 170, 0.7), mid = v.filt('bandpass', 320, 0.8);
      const src = v.noise('brown', null, t); src.connect(lp); src.connect(mid);
      const n = ri(3, 5);
      for (let i = 0; i < n; i++) {
        const tt = t + (i ? rr(0.2, 2.6) : 0), g = v.gain(0, d), pk = (i ? rr(0.35, 0.8) : 1);
        lp.connect(g);
        const m = v.gain(0.35, g); mid.connect(m);
        g.gain.setValueAtTime(0, tt); g.gain.linearRampToValueAtTime(pk * 0.55, tt + rr(0.15, 0.4));
        g.gain.setTargetAtTime(0, tt + 0.4, rr(0.45, 0.9));
      }
      v.done();
    }],

    title: [5, function (G, d, t) {
      sho(G, d, t, [62, 69, 74, 75, 79], 1.6, 1.25, 1.5);
      rin(G, d, t + 0.25, 660, 0.7, 0, false, 2);
      kotoSfx(G, d, t + 0.25, 50, 0.6, -0.15);
    }]
  };

  // route a one-shot through an optional positional wrapper (pan + distance)
  function sfxDest(G, t, life, o, bus) {
    let k = num(o.vol, 1), pan = 0, lp = 0;
    const hasPos = typeof o.x === 'number' && typeof o.z === 'number' && isFinite(o.x) && isFinite(o.z);
    if (hasPos) {
      const dx = o.x - G.listener.x, dz = o.z - G.listener.z, dist = Math.sqrt(dx * dx + dz * dz);
      k *= 1 / (1 + dist / 6); pan = clamp(dx / 12, -1, 1);
      if (dist > 10) lp = 16000 / (1 + (dist - 10) / 8);
    }
    if (!hasPos && Math.abs(k - 1) < 1e-3) return bus;
    const v = voice(G, t, life, 2);
    if (!v) return null;
    let n = hasPos ? v.pan(pan, bus) : bus;
    n = v.gain(k, n);
    if (lp) n = v.filt('lowpass', lp, 0.5, n);
    v.buf(G.kit.silence, n, 1, t, 0, true);              // keeps the wrapper alive until `life`
    v.done();
    return n;
  }

  /* ------------------------------------------------------------------ 8 */
  // Footsteps (stepBus). Short, soft, randomized.
  const STEPS = {
    stone(G, v, d, t) {
      nz(v, d, t, { n: 'pink', f: rr(550, 850), q: 1.1, a: 0.002, pk: 0.5, tc: 0.022 });
      nz(v, d, t, { n: 'white', ft: 'highpass', f: 3000, q: 0.7, a: 0.001, pk: 0.06, tc: 0.006 });
    },
    asphalt(G, v, d, t) {
      nz(v, d, t, { n: 'pink', f: rr(1100, 1500), q: 0.6, a: 0.012, pk: 0.26, tc: 0.035 });
      nz(v, d, t + rr(0.04, 0.06), { n: 'pink', f: rr(1800, 2400), q: 0.7, a: 0.01, pk: 0.1, tc: 0.03 });
    },
    gravel(G, v, d, t) {
      nz(v, d, t, { n: 'brown', ft: 'lowpass', f: 300, q: 0.7, a: 0.004, pk: 0.4, tc: 0.03 });
      grains(v, d, t, ri(6, 9), 0.12, 1800, 4800, 0.3, 0.005, 0.014, 1.5);
    },
    wood(G, v, d, t) {
      v.buf(G.kit.wood, v.gain(0.4, v.filt('lowpass', 1400, 0.7, d)), rr(0.45, 0.56), t);
      nz(v, d, t, { n: 'brown', ft: 'lowpass', f: 250, q: 0.7, a: 0.003, pk: 0.5, tc: 0.04 });
    },
    grass(G, v, d, t) {
      nz(v, d, t, { n: 'white', ft: 'highpass', f: 2200, q: 0.5, a: 0.02, pk: 0.09, tc: 0.045 });
      grains(v, d, t, 3, 0.08, 3000, 7000, 0.06, 0.004, 0.01, 1.2);
    },
    puddle(G, v, d, t) {
      nz(v, d, t, { n: 'white', ft: 'lowpass', f: 3500, f2: 800, fs: 0.12, q: 0.7, a: 0.004, pk: 0.32, tc: 0.045 });
      bub(v, d, t + 0.01, rr(550, 750), 0.05, 0.08);
      bub(v, d, t + rr(0.08, 0.18), rr(1100, 1900), 0.03, 0.035);
    }
  };
  function playStep(G, surface, t, vol) {
    const fn = STEPS[surface] || STEPS.stone;
    const v = voice(G, t, 0.45, 1); if (!v) return;
    const d = v.gain(0.55 * num(vol, 1) * rr(0.8, 1.1), v.pan(rr(-0.08, 0.08), G.stepBus));
    fn(G, v, d, t);
    v.done();
  }

  /* ------------------------------------------------------------------ 9 */
  // Random ambient events (crickets, rain drops, traffic, wind)
  function cricket(G, t) {
    const v = voice(G, t, 3.2, 0); if (!v) return;
    const out = v.gain(rr(0.006, 0.016), v.pan(rr(-0.85, 0.85), G.ambBus));
    const am = v.gain(0.5, out), env = v.gain(0, am);
    v.osc('sine', rr(4250, 4900), env, t);
    v.osc('sine', rr(38, 56), v.gain(0.5, am.gain), t);
    let tt = t; const n = ri(1, 4), p = env.gain, dur = rr(0.25, 0.6);
    p.setValueAtTime(0, t);
    for (let i = 0; i < n && tt < t + 2.6; i++) {
      p.setValueAtTime(0, tt); p.linearRampToValueAtTime(1, tt + 0.03);
      p.setValueAtTime(1, tt + dur); p.linearRampToValueAtTime(0, tt + dur + 0.05);
      tt += dur + rr(0.15, 0.4);
    }
    v.done();
  }
  function droplet(G, t, rain) {
    const v = voice(G, t, 0.12, 0); if (!v) return;
    const d = v.gain(rr(0.25, 1) * (0.4 + 0.6 * rain), v.pan(rr(-0.9, 0.9), G.ambBus));
    if (chance(0.7)) {                                     // tick on stone / leaf
      const g = v.gain(0, d), o = v.osc('sine', rr(1800, 4200), g, t);
      o.frequency.exponentialRampToValueAtTime(o.frequency.value * 1.3, t + 0.015);
      perc(g.gain, t, 0.001, 0.035, rr(0.005, 0.015));
    } else {                                               // heavier tap (umbrella / roof)
      nz(v, d, t, { n: 'pink', f: rr(700, 1300), q: 1.5, a: 0.001, pk: 0.12, tc: 0.012 });
    }
    v.done();
  }
  function traffic(G, t) {
    const v = voice(G, t, 8, 0); if (!v) return;
    const dur = rr(4, 7), pn = v.pan(0, G.ambBus);
    if (pn.pan) { const s = chance(0.5) ? 1 : -1; pn.pan.setValueAtTime(-0.8 * s, t); pn.pan.linearRampToValueAtTime(0.8 * s, t + dur); }
    const g = v.gain(0, pn), f = v.filt('bandpass', 250, 0.8, g);
    f.frequency.setValueAtTime(220, t); f.frequency.linearRampToValueAtTime(520, t + dur * 0.5); f.frequency.linearRampToValueAtTime(200, t + dur);
    v.noise('pink', f, t);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(rr(0.05, 0.09), t + dur * 0.5); g.gain.linearRampToValueAtTime(0, t + dur);
    v.done();
  }
  function wind(G, t) {
    const v = voice(G, t, 10, 0); if (!v) return;
    const dur = rr(6, 9), g = v.gain(0, G.ambBus), f = v.filt('bandpass', 500, 0.6, g);
    f.frequency.setValueAtTime(rr(350, 500), t); f.frequency.linearRampToValueAtTime(rr(700, 1000), t + dur * 0.45);
    f.frequency.linearRampToValueAtTime(400, t + dur);
    v.noise('pink', f, t);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(rr(0.05, 0.08), t + dur * 0.45); g.gain.linearRampToValueAtTime(0, t + dur);
    v.done();
  }
  // Poisson scheduler for one event kind
  function poisson(E, key, rate, from, to, fire) {
    if (!(rate > 0.0001)) { E[key] = to + 0.3; return; }
    if (E[key] == null || E[key] < from - 1) E[key] = from + rnd() / rate;
    while (E[key] < to) { fire(E[key]); E[key] += -Math.log(1 - rnd() * 0.999) / rate; }
  }
  function tickAmb(G, from, to) {
    const s = G.state, E = G.music.amb, tw = smooth01((s.zone - 0.25) / 0.75);
    const dry = (1 - s.rain) * (1 - s.rain) * (1 - 0.8 * s.festival);
    poisson(E, 'cr', (0.25 + 1.6 * tw) * dry, from, to, (t) => cricket(G, t));
    poisson(E, 'dr', 16 * s.rain, from, to, (t) => droplet(G, t, s.rain));
    poisson(E, 'tr', 0.07 * (1 - s.zone), from, to, (t) => traffic(G, t));
    poisson(E, 'wi', 1 / 45, from, to, (t) => {
      wind(G, t);
      if (s.rain < 0.3 && chance(0.6)) {
        const d = sfxDest(G, t + 2, 3.2, { vol: 0.35 }, G.ambBus);
        if (d) SFX[s.zone > 0.5 ? 'chime' : 'leaves'][1](G, d, t + 2, {});
      }
    });
  }
  function smooth01(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }

  /* ----------------------------------------------------------------- 10 */
  // Generative music. One shared 16th-note clock (74 BPM, 4/4) drives all
  // layers. Tonal centre D; temple + festival use the In scale D Eb G A Bb,
  // the city layer uses jazzy voicings around the same centre.

  const IN_SCALE = [2, 3, 7, 9, 10];
  function scaleNotes(lo, hi) {
    const r = [];
    for (let m = lo; m <= hi; m++) if (IN_SCALE.indexOf(((m % 12) + 12) % 12) >= 0) r.push(m);
    return r;
  }
  const KOTO_NOTES = scaleNotes(50, 81);       // D3..A5
  const SHAKU_NOTES = scaleNotes(62, 79);      // D4..G5
  const FUE_NOTES = scaleNotes(74, 91);        // D5..G6

  // city chords: bass root + e-piano voicing + melody pool (chord-safe notes)
  const CH = {
    Gm9: { b: 43, v: [58, 62, 65, 69], mel: [74, 77, 79, 81, 82, 86] },
    Eb7: { b: 39, v: [55, 58, 62, 69], mel: [74, 79, 81, 82, 86] },        // Ebmaj7#11
    Dm11: { b: 38, v: [53, 57, 60, 67], mel: [72, 74, 77, 79, 81] },
    Bb7: { b: 46, v: [57, 62, 65, 69], mel: [74, 77, 79, 81, 84] },        // Bbmaj9
    Cm9: { b: 36, v: [58, 62, 63, 67], mel: [74, 75, 79, 82, 84] },
    Asus: { b: 45, v: [55, 58, 62, 69], mel: [74, 76, 79, 81, 82] },       // A7sus4(b9)
    Gm7: { b: 43, v: [53, 58, 62, 65], mel: [74, 77, 79, 82, 86] }
  };
  const PROGS = [
    ['Gm9', 'Eb7', 'Dm11', 'Bb7'],
    ['Gm9', 'Eb7', 'Dm11', 'Asus'],
    ['Eb7', 'Dm11', 'Cm9', 'Bb7'],
    ['Gm7', 'Bb7', 'Eb7', 'Asus'],
    ['Dm11', 'Bb7', 'Gm9', 'Asus']
  ];
  const SHO_CLUSTERS = [
    [57, 62, 67, 69, 74], [55, 62, 63, 70, 74], [58, 62, 67, 69, 75], [57, 63, 67, 70, 74], [55, 62, 67, 69, 74]
  ];

  function newConductor() {
    return {
      step: 0, next: -1, amb: {},
      prog: PROGS[0], progNext: 0,
      kotoRest: 1, kotoQ: [], flRest: 3, flQ: [], fueQ: [], fueRest: 0,
      shoAt: -1, lastKoto: 62, lastFl: 69, lastFue: 81, melQ: [], drumsOff: 0
    };
  }

  // ---- city layer (lo-fi hip-hop) -----------------------------------
  function cityStep(G, M, t, bar, pos, sw) {
    const K = G.kit, D = G.cityIn;
    if (pos === 0 && bar % 4 === 0) {
      M.prog = chance(0.55) && M.prog ? M.prog : pick(PROGS);
      M.drumsOff = (bar < 2 || (bar % 16 === 12 && chance(0.6))) ? (bar < 2 ? 2 - bar : 2) : 0;
    }
    if (pos === 0 && M.drumsOff > 0 && bar > 1) M.drumsOff--;
    const c = CH[M.prog[bar % 4]], nextC = CH[M.prog[(bar + 1) % 4]];
    const drums = M.drumsOff === 0;

    // e-piano comping
    if (pos === 0) {
      const v = c.v.slice();
      if (chance(0.3)) v.push(v[0] + 12);
      epiano(G, G.epBus, t + rr(0, 0.02), v, BAR * rr(0.55, 0.9), rr(0.55, 0.75), rr(0.012, 0.03));
    } else if (pos === 10 && chance(0.35)) {
      epiano(G, G.epBus, t + sw, c.v.slice(1), STEP * 5, rr(0.35, 0.5), 0.01);
    } else if (pos === 14 && chance(0.18)) {
      epiano(G, G.epBus, t + sw, nextC.v.slice(0, 3), STEP * 2, 0.35, 0.008);
    }
    // bass
    if (pos === 0) bass(G, D, t, c.b, STEP * (chance(0.5) ? 9 : 6), 1);
    else if (pos === 10 && chance(0.55)) bass(G, D, t + sw, chance(0.7) ? c.b : c.b + 7, STEP * 3, 0.75);
    else if (pos === 14 && chance(0.25)) bass(G, D, t + sw, nextC.b + (chance(0.5) ? 2 : -1), STEP * 1.5, 0.6);

    // melodic fragments (sparse, soft high e-piano / bell-ish)
    if (pos === 0 && !M.melQ.length && bar > 3 && chance(0.3)) {
      const n = ri(2, 5); let s = pick([2, 4, 6, 8]);
      let m = pick(c.mel);
      for (let i = 0; i < n && s < 15; i++) {
        M.melQ.push([bar, s, m]);
        s += pick([1, 2, 2, 3, 4]);
        const pool = CH[M.prog[bar % 4]].mel, j = pool.indexOf(m);
        m = pool[clamp((j < 0 ? 2 : j) + pick([-1, -1, 1, -2, 0]), 0, pool.length - 1)];
      }
    }
    while (M.melQ.length && (M.melQ[0][0] < bar || (M.melQ[0][0] === bar && M.melQ[0][1] <= pos))) {
      const e = M.melQ.shift();
      if (e[0] === bar && e[1] === pos) epiano(G, G.epBus, t + sw, [e[2]], STEP * rr(1.5, 3), rr(0.45, 0.6), 0, 1.6);
    }

    // drums
    if (!drums) {
      if (pos % 4 === 2 && chance(0.6)) play(G, D, t + sw, K.hatC, 0.05 * rr(0.6, 1), rr(0.95, 1.05), rr(-0.2, 0.2));
      return;
    }
    const hum = rr(-0.006, 0.006);
    if (pos === 0 || pos === 10 || (pos === 7 && chance(0.25)) || (pos === 13 && chance(0.12)))
      play(G, D, t + (pos % 2 ? sw : 0) + hum, K.kick, pos === 0 ? 0.36 : 0.27, 1, 0, 0, 2400);
    if (pos === 4 || pos === 12) {
      if (chance(0.7)) play(G, D, t + hum, K.brush, 0.28 * rr(0.85, 1), rr(0.96, 1.04), 0.05);
      else play(G, D, t + hum, K.rim, 0.2, rr(0.97, 1.03), 0.05);
    } else if ((pos === 15 || pos === 7) && chance(0.08)) play(G, D, t + sw, K.brush, 0.08, 1.05, 0.05);
    if (pos % 2 === 0) {
      const acc = pos % 4 === 0 ? 1 : 0.6;
      if (pos === 14 && chance(0.2)) play(G, D, t + sw, K.hatO, 0.04, 1, -0.2);
      else play(G, D, t + (pos % 4 === 2 ? sw : 0) + hum, K.hatC, 0.075 * acc * rr(0.7, 1), rr(0.95, 1.05), -0.2);
    } else if (chance(0.12)) play(G, D, t + sw * 0.5, K.hatC, 0.03, 1.1, -0.2);
  }

  // ---- temple layer (koto, shakuhachi, sho, distant bell) -------------
  function walk(pool, from, maxJump, bias) {
    let j = pool.indexOf(from); if (j < 0) j = Math.floor(pool.length / 2);
    let d = ri(-maxJump, maxJump) + (bias || 0);
    if (d === 0) d = chance(0.5) ? 1 : -1;
    return pool[clamp(j + d, 0, pool.length - 1)];
  }
  function templeStep(G, M, t, bar, pos, festival) {
    const D = G.templeIn, abs = bar * 16 + pos;

    // sho: a new cluster every 2 bars, overlapping swells
    if (pos === 0 && bar % 2 === 0) sho(G, D, t, pick(SHO_CLUSTERS), BAR * 2 - 1.2, 0.9 * (1 - 0.4 * festival), 2.4);

    // koto phrases with ma (silence) between them
    if (pos === 0 && !M.kotoQ.length) {
      if (M.kotoRest > 0) M.kotoRest--;
      else {
        let s = abs + pick([0, 2, 4]), m = walk(KOTO_NOTES, M.lastKoto, 3);
        const n = ri(3, 7), descend = chance(0.6);
        for (let i = 0; i < n; i++) {
          const last = i === n - 1;
          let note = m;
          if (last) note = pick([50, 57, 62, 62, 69, 74].filter((x) => Math.abs(x - m) < 13).concat([62]));
          M.kotoQ.push({ s, m: note, vel: last ? 0.85 : rr(0.55, 0.9), dbl: last && chance(0.35), bend: !last && chance(0.12) ? pick([1, 2]) : 0 });
          s += pick([2, 2, 3, 4, 4, 6, 1]);
          m = walk(KOTO_NOTES, m, 2, descend ? -1 : 0);
        }
        M.lastKoto = M.kotoQ[M.kotoQ.length - 1].m;
        M.kotoRest = ri(1, 3) + (festival > 0.5 ? 1 : 0);
        if (chance(0.25)) M.kotoQ.push({ s: s + 6, m: 50, vel: 0.5, dbl: true, bend: 0 });   // low drone pluck
      }
    }
    while (M.kotoQ.length && M.kotoQ[0].s <= abs) {
      const e = M.kotoQ.shift();
      if (e.s < abs) continue;
      const pan = (e.m - 66) / 40;
      koto(G, D, t + rr(0, 0.012), e.m, e.vel, pan, e.bend);
      if (e.dbl) koto(G, D, t + 0.03, e.m === 50 ? 57 : e.m - 12 >= 50 ? e.m - 12 : e.m + 7, e.vel * 0.6, -pan);
    }

    // shakuhachi: occasional long breathy phrase, rarely during festival
    if (pos === 0 && !M.flQ.length) {
      if (M.flRest > 0) M.flRest--;
      else if (festival < 0.3) {
        let s = abs + pick([0, 4, 8]), m = walk(SHAKU_NOTES, M.lastFl, 2), prev = 0;
        const n = ri(2, 4);
        for (let i = 0; i < n; i++) {
          const len = (i === n - 1 ? pick([10, 12, 16]) : pick([4, 6, 8]));
          M.flQ.push({ s, m, len, from: prev && chance(0.6) ? prev : 0 });
          prev = m; s += len + (chance(0.3) ? 2 : 0);
          m = walk(SHAKU_NOTES, m, 2, i === n - 2 ? -1 : 0);
        }
        M.lastFl = M.flQ[M.flQ.length - 1].m;
        M.flRest = ri(3, 6);
      }
    }
    while (M.flQ.length && M.flQ[0].s <= abs) {
      const e = M.flQ.shift();
      if (e.s < abs) continue;
      flute(G, D, t, e.m, e.len * STEP * 0.95, rr(0.75, 0.95), e.from, 'shaku');
    }

    // very occasional distant bonsho
    if (pos === 0 && bar > 2 && chance(0.035 * (1 - festival))) {
      bonsho(G, D, t, 0.22, true, 0);
    }
  }

  // ---- festival layer (taiko ensemble + shinobue) ----------------------
  const ODAIKO = [
    [1, 0, 0, 0, 0, 0, 0.6, 0, 0.9, 0, 0, 0.45, 0.8, 0, 0, 0],
    [1, 0, 0, 0.4, 0, 0, 0.7, 0, 0.9, 0, 0.5, 0, 0.8, 0, 0.5, 0],
    [1, 0, 0, 0, 0.7, 0, 0, 0.5, 1, 0, 0, 0, 0.6, 0.5, 0.7, 0.8]
  ];
  const SHIME = [1, 0, 0.5, 0.35, 0.8, 0, 0.5, 0.35, 0.9, 0, 0.5, 0.35, 0.8, 0.3, 0.5, 0.4];
  const KANE = [1, 0, 0, 0.5, 0.7, 0, 0.5, 0, 0.9, 0, 0, 0.5, 0.7, 0, 0.5, 0];
  function festStep(G, M, t, bar, pos, sw) {
    const K = G.kit, D = G.festIn, abs = bar * 16 + pos;
    const fill = bar % 4 === 3, pat = fill ? ODAIKO[2] : ODAIKO[bar % 2];
    const hum = rr(-0.004, 0.004);
    if (pat[pos]) play(G, D, t + hum, K.taiko, 0.36 * pat[pos], rr(0.97, 1.02), rr(-0.1, 0.1), 0);
    if (SHIME[pos]) play(G, D, t + (pos % 2 ? sw * 0.5 : 0) + hum, K.shime, 0.16 * SHIME[pos] * rr(0.85, 1), rr(0.98, 1.03), 0.35, 0);
    if (KANE[pos]) play(G, D, t + (pos % 2 ? sw * 0.5 : 0) + hum, K.kane, 0.07 * KANE[pos], rr(0.98, 1.02), -0.35, 0, 7000);
    if (pos === 0 && bar % 8 === 0) play(G, D, t, K.click, 0.12, 0.5, 0, 0);   // kakegoe-ish rim knock

    // shinobue phrases: 1-2 bars of melody, then a bar of rest
    if (pos === 0 && !M.fueQ.length) {
      if (M.fueRest > 0) M.fueRest--;
      else {
        let s = abs, m = walk(FUE_NOTES, M.lastFue, 2);
        const end = abs + 16 * ri(1, 2);
        const motifR = [pick([4, 2, 2]), pick([2, 2, 1]), pick([2, 4]), pick([2, 1, 2])];
        let i = 0;
        while (s < end - 2) {
          const len = motifR[i % motifR.length];
          M.fueQ.push({ s, m, len, grace: chance(0.25) ? m + 2 : 0 });
          s += len; i++;
          m = walk(FUE_NOTES, m, 2, chance(0.3) ? -1 : 0);
        }
        M.fueQ.push({ s: end - 2, m: pick([74, 81, 86, 79]), len: 6, grace: 0 });
        M.lastFue = M.fueQ[M.fueQ.length - 1].m;
        M.fueRest = ri(0, 1);
      }
    }
    while (M.fueQ.length && M.fueQ[0].s <= abs) {
      const e = M.fueQ.shift();
      if (e.s < abs) continue;
      flute(G, D, t + (pos % 2 ? sw * 0.5 : 0), e.m, e.len * STEP * 0.9, rr(0.8, 1), 0, 'fue', e.grace ? e.grace : 0);
    }
  }

  // ---- the scheduler -------------------------------------------------
  function schedule(G, horizon) {
    const M = G.music, ctx = G.ctx;
    const now = G.offline ? 0 : ctx.currentTime;
    if (M.next < 0) M.next = now + 0.1;
    if (M.next < now - 0.05) {                           // fell behind (backgrounded): skip ahead
      const skip = Math.ceil((now - M.next) / STEP);
      M.step += skip; M.next += skip * STEP;
      M.kotoQ.length = 0; M.flQ.length = 0; M.fueQ.length = 0; M.melQ.length = 0;
    }
    const end = now + horizon, from = M.next;
    const lv = G.levels || {};
    while (M.next < end) {
      const t = M.next, bar = Math.floor(M.step / 16), pos = M.step % 16;
      const sw = STEP * 0.36;                            // lazy lo-fi swing on off-8ths
      if (!G.muted) {
        if (lv.city > 0.015) cityStep(G, M, t, bar, pos, sw);
        else if (pos === 0 && bar % 4 === 0) M.prog = pick(PROGS);
        if (lv.temple > 0.015) templeStep(G, M, t, bar, pos, lv.fest || 0);
        else { M.kotoQ.length = 0; M.flQ.length = 0; }
        if (lv.fest > 0.015) festStep(G, M, t, bar, pos, sw);
        else M.fueQ.length = 0;
      }
      M.step++; M.next += STEP;
    }
    if (!G.muted) tickAmb(G, from, M.next);
    else M.amb = {};
  }

  /* ----------------------------------------------------------------- 11 */
  // Map game state -> layer + bed levels. Cheap: a few numbers per call and
  // AudioParams are only touched when a target moved meaningfully.
  function applyState(G, s) {
    const S = G.state;
    if (s) {
      S.zone = clamp(num(s.zone, S.zone), 0, 1);
      S.rain = clamp(num(s.rain, S.rain), 0, 1);
      S.water = clamp(num(s.water, S.water), 0, 1);
      S.crowd = clamp(num(s.crowd, S.crowd), 0, 1);
      S.festival = clamp(num(s.festival, S.festival), 0, 1);
      if (typeof s.px === 'number' && isFinite(s.px)) G.listener.x = s.px;
      if (typeof s.pz === 'number' && isFinite(s.pz)) G.listener.z = s.pz;
    }
    const z = smooth01(S.zone), f = S.festival, r = S.rain;
    const city = Math.cos(z * Math.PI / 2) * (1 - 0.75 * f);
    const temple = Math.sin(z * Math.PI / 2) * (1 - 0.35 * f);
    G.levels = { city, temple, fest: f };
    setP(G, 'city', G.cityGain.gain, city * 0.95, 0.8, 0.004);
    setP(G, 'temple', G.templeGain.gain, temple * 1.3, 0.8, 0.004);
    setP(G, 'fest', G.festGain.gain, f * 0.9, 0.6, 0.004);
    setP(G, 'mlvl', G.musicLvl.gain, 0.8 * (1 - 0.22 * r), 0.8, 0.004);
    setP(G, 'mtone', G.musicTone.frequency, 14000 * Math.pow(2600 / 14000, r), 0.9, 40);
    setP(G, 'hum', G.humG.gain, 0.16 * (1 - 0.8 * z) * (1 - 0.5 * f), 0.8, 0.003);
    setP(G, 'rain', G.rainG.gain, 0.2 * r, 0.6, 0.003);
    setP(G, 'rainh', G.rainHiss.gain, 0.05 * r * r, 0.6, 0.002);
    setP(G, 'water', G.waterG.gain, 0.32 * S.water, 0.5, 0.003);
    setP(G, 'crowd', G.crowdG.gain, 0.09 * S.crowd * (1 - 0.5 * r), 0.7, 0.002);
  }

  /* ----------------------------------------------------------------- 12 */
  const api = {};
  let ticks = 0, ctx = null, G = null, timer = 0, muted = false, volume = 0.8, lastBlip = 0, lastStep = 0, visHooked = false;
  const UI = { blip: 1, select: 1, back: 1, quest: 1, title: 1, gate: 1, fortune_good: 1, fortune_bad: 1 };
  const WARM = KOTO_NOTES.concat([76, 83, 86, 67, 69, 79]);

  function masterTarget() { return muted ? 0 : 0.9 * volume; }
  function applyMaster(tc) {
    if (!G) return;
    const p = G.master.gain, v = masterTarget();
    try { p.cancelScheduledValues(ctx.currentTime); p.setTargetAtTime(v, ctx.currentTime, tc || 0.12); } catch (e) { p.value = v; }
  }
  function prewarm() {                       // spread buffer rendering over scheduler ticks
    const K = G.kit;
    while (K.lazy.length) {
      const n = K.lazy.shift(), d = Object.getOwnPropertyDescriptor(K, n);
      if (d && d.get) { void K[n]; return; }   // touching the getter renders + caches it
    }
    for (let i = 0; i < WARM.length; i++) if (!K.plucks[WARM[i]]) { K.pluck(WARM[i]); return; }
  }
  function tick() {
    if (!G || ctx.state !== 'running') return;
    try { schedule(G, LOOKAHEAD); if (++ticks % 2 === 0) prewarm(); } catch (e) { /* never break the game loop */ }
  }
  function unlock() {
    try {                                    // iOS: play a 1-sample silent buffer inside the gesture
      const s = ctx.createBufferSource(); s.buffer = G.kit.silence; s.connect(ctx.destination);
      s.onended = function () { try { s.disconnect(); } catch (e) { /* ignore */ } };
      s.start(0);
    } catch (e) { /* ignore */ }
  }
  function resume() {
    if (!ctx) return Promise.resolve(false);
    let p = null;
    try { if (ctx.state !== 'running' && ctx.resume) p = ctx.resume(); } catch (e) { p = null; }
    return Promise.resolve(p).then(() => ctx.state === 'running', () => false);
  }
  function hookVisibility() {
    if (visHooked || typeof document === 'undefined' || !document.addEventListener) return;
    visHooked = true;
    document.addEventListener('visibilitychange', function () {
      if (!ctx) return;
      try {
        if (document.hidden) { if (ctx.state === 'running' && ctx.suspend) ctx.suspend(); }
        else resume();
      } catch (e) { /* ignore */ }
    });
  }

  api.init = function () {
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return Promise.resolve(false);
        try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = new AC(); }
        G = buildGraph(ctx, false);
        G.muted = muted;
        applyState(G, null);                 // default state (zone 0) until the first update()
        G.master.gain.value = masterTarget();
        timer = setInterval(tick, TICK_MS);
        hookVisibility();
      }
      unlock();
      return resume().then((ok) => { if (ok) tick(); return ok; });
    } catch (e) {
      return Promise.resolve(false);
    }
  };

  api.update = function (dt, s) {
    if (!G || !s) return;
    try { applyState(G, s); } catch (e) { /* ignore */ }
  };

  api.step = function (surface) {
    if (!G || muted || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    if (t - lastStep < 0.06) return;
    lastStep = t;
    try { playStep(G, String(surface), t + 0.005); } catch (e) { /* ignore */ }
  };

  api.sfx = function (name, opts) {
    if (!G || muted || ctx.state !== 'running') return;
    if (!Object.prototype.hasOwnProperty.call(SFX, name)) return;
    const t = ctx.currentTime + 0.005;
    if (name === 'blip') { if (t - lastBlip < 0.03) return; lastBlip = t; }
    try { fireSfx(G, name, t, opts || {}); } catch (e) { /* ignore */ }
  };
  function fireSfx(g, name, t, o) {
    const e = SFX[name], d = sfxDest(g, t, e[0], o, UI[name] ? g.uiBus : g.sfxBus);
    if (d) e[1](g, d, t, o);
  }

  api.setMuted = function (b) {
    muted = !!b;
    if (G) { G.muted = muted; applyMaster(0.15); }
  };
  api.isMuted = function () { return muted; };
  api.setVolume = function (v) {
    volume = clamp(num(+v, volume), 0, 1);
    applyMaster(0.1);
  };
  // debug: live voice count + current smoothed state
  api._stats = function () {
    return G ? { state: ctx.state, time: ctx.currentTime, voices: G.active, levels: G.levels, muted } : null;
  };
  Object.defineProperty(api, 'ctx', { get: function () { return ctx; }, enumerable: true });

  // ---- debug: render a sound / the music on an OfflineAudioContext --------
  // kind: 'sfx' | 'step' | 'music'. state: update() state (+ x, z, vol for sfx,
  // raw:true to bypass the safety soft-clipper). Resolves {peak, rms, nan, buffer}.
  api._renderOffline = function (kind, name, seconds, state) {
    try {
      const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!OAC) return Promise.reject(new Error('no OfflineAudioContext'));
      const sr = 44100, sec = seconds || 3, st = state || {};
      const oc = new OAC(2, Math.ceil(sr * sec), sr);
      const g = buildGraph(oc, true, !!st.raw);
      g.log = [];
      g.master.gain.value = 0.9 * volume;
      g.muted = false;
      applyState(g, st);
      if (st.solo) {                         // debug: isolate one layer ('city'|'temple'|'fest'|'amb'|'none')
        const L = { city: [g.cityGain], temple: [g.templeGain], fest: [g.festGain], amb: [g.humG, g.rainG, g.rainHiss, g.waterG, g.crowdG] };
        Object.keys(L).forEach((k) => { if (k !== st.solo) L[k].forEach((n) => { n.gain.value = 0; }); });
        if (st.solo !== 'amb') g.ambBus.gain.value = 0;
      }
      if (kind === 'music') {
        schedule(g, sec);
        (st.sfx || []).forEach((e) => { if (SFX[e.name]) fireSfx(g, e.name, e.t, e.opts || {}); });   // stress tests
      }
      else {                                 // isolate the one-shot: silence beds + music
        [g.cityGain, g.templeGain, g.festGain, g.humG, g.rainG, g.rainHiss, g.waterG, g.crowdG].forEach((n) => { n.gain.value = 0; });
        if (kind === 'step') playStep(g, name, 0.05, 1);
        else if (Object.prototype.hasOwnProperty.call(SFX, name)) fireSfx(g, name, 0.05, st);
      }
      const done = new Promise((res) => { oc.oncomplete = (e) => res(e.renderedBuffer); });
      const p = oc.startRendering();
      return (p && p.then ? p : done).then((buf) => {
        let peak = 0, sum = 0, nan = 0, n = 0;
        for (let c = 0; c < buf.numberOfChannels; c++) {
          const d = buf.getChannelData(c);
          for (let i = 0; i < d.length; i++) {
            const x = d[i];
            if (!isFinite(x)) { nan++; continue; }
            const a = Math.abs(x); if (a > peak) peak = a; sum += x * x; n++;
          }
        }
        // max number of overlapping voices (all prios / music+ambience only)
        const ev = [], ev0 = [];
        g.log.forEach((L) => { ev.push([L[0], 1], [L[1], -1]); if (!L[2]) ev0.push([L[0], 1], [L[1], -1]); });
        const mx = (E) => { E.sort((a, b) => a[0] - b[0] || a[1] - b[1]); let c = 0, m = 0; E.forEach((e) => { c += e[1]; if (c > m) m = c; }); return m; };
        return { peak, rms: Math.sqrt(sum / Math.max(1, n)), nan, buffer: buf, voices: g.log.length, maxVoices: mx(ev), maxMusicVoices: mx(ev0) };
      });
    } catch (e) {
      return Promise.reject(e);
    }
  };

  return api;
})();
