// ───────────────────────── GL helpers ─────────────────────────
function glProgram(gl, vs, fs, name) {
  const mk = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      const lines = src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n');
      console.error('[shader ' + name + ']\n' + log + '\n' + lines);
      throw new Error('shader ' + name + ': ' + log);
    }
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link ' + name + ': ' + gl.getProgramInfoLog(p));
  // cache uniform locations
  const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i), nm = info.name.replace(/\[0\]$/, '');
    u[nm] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

function glTex(gl, w, h, opts = {}) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  const f = opts.linear ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const ifmt = opts.ifmt || gl.RGBA8, fmt = opts.fmt || gl.RGBA, type = opts.type || gl.UNSIGNED_BYTE;
  gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, opts.data || null);
  t.w = w; t.h = h;
  return t;
}

// framebuffer with N color textures (+ optional depth renderbuffer)
function glTarget(gl, w, h, n, opts = {}) {
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  const tex = [], bufs = [];
  for (let i = 0; i < n; i++) {
    const t = glTex(gl, w, h, { linear: opts.linear && opts.linear[i] });
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0);
    tex.push(t); bufs.push(gl.COLOR_ATTACHMENT0 + i);
  }
  let depth = null;
  if (opts.depth) {
    depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
  }
  gl.drawBuffers(bufs);
  const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (st !== gl.FRAMEBUFFER_COMPLETE) console.error('framebuffer incomplete', st);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fb, tex, depth, w, h, bufs };
}
function glFree(gl, t) {
  if (!t) return;
  gl.deleteFramebuffer(t.fb);
  t.tex.forEach(x => gl.deleteTexture(x));
  if (t.depth) gl.deleteRenderbuffer(t.depth);
}

// ───────────────────────── glyph atlas ─────────────────────────
// 95 printable ASCII glyphs rasterised at the exact device-pixel cell size.
// Also produces: a blurred copy (per-glyph halo) and per-glyph coverage vectors
// sampled on the same SX×SY sub-grid the scene is rendered at (shape matching).
const ATLAS_COLS = 16, ATLAS_ROWS = 6;
const GLYPHS = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i));
const G = (ch) => ch.charCodeAt(0) - 32; // glyph index

function buildAtlas(cw, ch, font, SX, SY) {
  const W = cw * ATLAS_COLS, H = ch * ATLAS_ROWS;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const c = cv.getContext('2d', { willReadFrequently: true });
  c.clearRect(0, 0, W, H);
  c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = font;
  for (let i = 0; i < 95; i++) {
    const x = (i % ATLAS_COLS) * cw, y = Math.floor(i / ATLAS_COLS) * ch;
    c.save(); c.beginPath(); c.rect(x, y, cw, ch); c.clip();
    c.fillText(GLYPHS[i], x + cw / 2, y + ch * 0.54);
    c.restore();
  }
  const img = c.getImageData(0, 0, W, H);
  const a = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) a[i] = img.data[i * 4 + 3];
  // per-glyph blur (stays inside its own cell): two box passes ≈ gaussian
  const blur = new Uint8Array(W * H);
  const r = Math.max(1, Math.round(cw * 0.28));
  const tmp = new Float32Array(cw * ch), tmp2 = new Float32Array(cw * ch);
  for (let g = 0; g < 95; g++) {
    const ox = (g % ATLAS_COLS) * cw, oy = Math.floor(g / ATLAS_COLS) * ch;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) tmp[y * cw + x] = a[(oy + y) * W + ox + x];
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        let s = 0, n = 0; for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < cw) { s += tmp[y * cw + xx]; n++; } } tmp2[y * cw + x] = s / (2 * r + 1);
      }
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        let s = 0; for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < ch) s += tmp2[yy * cw + x]; } tmp[y * cw + x] = s / (2 * r + 1);
      }
    }
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) blur[(oy + y) * W + ox + x] = Math.min(255, tmp[y * cw + x] * 2.2);
  }
  // coverage vectors: region (sx, sy) with sy counted from the BOTTOM (GL convention)
  const NS = SX * SY, shape = new Float32Array(95 * NS);
  for (let g = 0; g < 95; g++) {
    const ox = (g % ATLAS_COLS) * cw, oy = Math.floor(g / ATLAS_COLS) * ch;
    for (let sy = 0; sy < SY; sy++) for (let sx = 0; sx < SX; sx++) {
      const x0 = Math.floor(sx * cw / SX), x1 = Math.floor((sx + 1) * cw / SX);
      const yt = SY - 1 - sy, y0 = Math.floor(yt * ch / SY), y1 = Math.floor((yt + 1) * ch / SY);
      let s = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += a[(oy + y) * W + ox + x]; n++; }
      shape[g * NS + sy * SX + sx] = n ? s / n / 255 : 0;
    }
  }
  // normalise each region by its max over all glyphs (Harri's trick: makes shapes comparable)
  const shapeN = new Uint8Array(95 * NS);
  for (let k = 0; k < NS; k++) {
    let mx = 1e-6; for (let g = 0; g < 95; g++) mx = Math.max(mx, shape[g * NS + k]);
    for (let g = 0; g < 95; g++) shapeN[k * 95 + g] = Math.round(255 * Math.min(1, shape[g * NS + k] / mx));
  }
  return { W, H, alpha: a, blur, shapeN, NS };
}
