// ───────────────────────── renderer ─────────────────────────
// scene (G-buffer, 3×5 samples per cell) → reflection → emissive glow → ASCII cells → glyph composite
const CHARSETS = [
  /* 0 SKY     */ "     ..''`^*+",
  /* 1 STONE   */ "   .,:;;+*%#@",
  /* 2 ASPHALT */ "   ..,,:;=+*#",
  /* 3 GRAVEL  */ "  .,:;;:i!lI",
  /* 4 GRASS   */ " .,'|/\\\"",
  /* 5 WATER   */ "  .-~=~=*",
  /* 6 WOOD    */ "  .:-=+=#H#",
  /* 7 ROOF    */ "  .-:=mMW#",
  /* 8 PAPER   */ " .:oO0@@@",
  /* 9 NEON    */ " .:+*#%@",
  /* 10 FACADE */ "  .,:;i!|lI[#",
  /* 11 FOLIAGE*/ " .:;o0OQ@8&%#",
  /* 12 METAL  */ "  .:-=+#[]#",
  /* 13 CLOTH  */ "  .:-=+*#%@@",
  /* 14 FIRE   */ " .'^*%#@",
  /* 15 GLASS  */ "  .:[]#=|#",
  /* 16 neon letters  */ "ABCDEFGHKMNRSTXZ",
  /* 17 window text   */ "$#@&%abdkpqwzQW0",
  /* 18 glow ramp     */ " ..,,::;;'''**",
  /* 19 pillar strokes*/ "  .:|||I[]H#",
];
const EDGE_GLYPHS = "|/\\_-()'.,[]";

class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    this.SX = 3; this.SY = 5;
    this.P = {
      scene: glProgram(gl, VS_SCENE, FS_SCENE, 'scene'),
      sky: glProgram(gl, VS_FULL, FS_SKY, 'sky'),
      emit: glProgram(gl, VS_FULL, FS_EMIT, 'emit'),
      blur: glProgram(gl, VS_FULL, FS_BLUR, 'blur'),
      ascii: glProgram(gl, VS_FULL, FS_ASCII, 'ascii'),
      disp: glProgram(gl, VS_FULL, FS_DISPLAY, 'display'),
    };
    this.vaoEmpty = gl.createVertexArray();
    // character sets → R8 texture (16 levels × rows)
    const cs = new Uint8Array(16 * 24);
    CHARSETS.forEach((s, r) => { for (let i = 0; i < 16; i++) cs[r * 16 + i] = G(s[Math.min(s.length - 1, Math.floor(i / 16 * s.length))]); });
    this.csTex = glTex(gl, 16, 24, { ifmt: gl.R8, fmt: gl.RED, data: cs });
    this.edge = new Int32Array(24); this.edgeN = EDGE_GLYPHS.length;
    for (let i = 0; i < this.edgeN; i++) this.edge[i] = G(EDGE_GLYPHS[i]);
    this.meshes = [];
    this.LP = new Float32Array(MAXL * 4); this.LC = new Float32Array(MAXL * 4); this.NL = 0;
    this.rip = new Float32Array(32);
    this.params = { expo: 1.3, halo: 0.55, bloomAscii: 1.0, wet: 0.7, fog: 0.012, fade: 1, reveal: 1, rain: 0 };
    this.time = 0;
    this.blackTex = glTex(gl, 1, 1, { data: new Uint8Array([0, 0, 0, 255]) });
  }

  // ── geometry
  upload(mesh, dynamic = false) {
    const gl = this.gl, vao = gl.createVertexArray(), vbo = gl.createBuffer();
    gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.d), dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    const st = 48;
    [[0, 3, 0], [1, 3, 12], [2, 3, 24], [3, 3, 36]].forEach(([l, n, o]) => { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, n, gl.FLOAT, false, st, o); });
    gl.bindVertexArray(null);
    const obj = { vao, vbo, count: mesh.count, model: M4.ident(), visible: true, reflect: true };
    this.meshes.push(obj);
    return obj;
  }

  // split a big static mesh into spatial chunks (grid on x/z) so off-screen parts are skipped
  uploadChunked(mesh, size = 14) {
    const buckets = new Map(), d = mesh.d;
    for (let i = 0; i < d.length; i += 36) {
      const cx = (d[i] + d[i + 12] + d[i + 24]) / 3, cz = (d[i + 2] + d[i + 14] + d[i + 26]) / 3;
      const key = Math.floor(cx / size) + ',' + Math.floor(cz / size);
      let b = buckets.get(key); if (!b) buckets.set(key, b = []);
      for (let k = 0; k < 36; k++) b.push(d[i + k]);
    }
    const out = [];
    for (const arr of buckets.values()) {
      const bb = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9];
      for (let i = 0; i < arr.length; i += 12) for (let a = 0; a < 3; a++) { bb[a] = Math.min(bb[a], arr[i + a]); bb[a + 3] = Math.max(bb[a + 3], arr[i + a]); }
      const m = this.upload({ d: arr, count: arr.length / 12 });
      m.bb = bb; out.push(m);
    }
    return out;
  }
  _frustum(vp) {
    const r = k => [vp[k], vp[4 + k], vp[8 + k], vp[12 + k]], R0 = r(0), R1 = r(1), R2 = r(2), R3 = r(3);
    const P = [];
    for (const [a, sgn] of [[R0, 1], [R0, -1], [R1, 1], [R1, -1], [R2, 1], [R2, -1]]) P.push([R3[0] + sgn * a[0], R3[1] + sgn * a[1], R3[2] + sgn * a[2], R3[3] + sgn * a[3]]);
    return P;
  }
  _visible(bb, mirror) {
    const F = this._fr; if (!F || !bb) return true;
    const y0 = mirror ? -bb[4] : bb[1], y1 = mirror ? -bb[1] : bb[4];
    for (const p of F) {
      const x = p[0] > 0 ? bb[3] : bb[0], y = p[1] > 0 ? y1 : y0, z = p[2] > 0 ? bb[5] : bb[2];
      if (p[0] * x + p[1] * y + p[2] * z + p[3] < 0) return false;
    }
    return true;
  }

  // ── sizing: integer device-pixel cells, glyph atlas rebuilt at that exact size
  // Two grids: a fine one for the scene (detail) and a coarse one, exactly 2×2 fine cells, for
  // everything that must stay legible (signs, HUD, dialogs). Both are even-sized so they align.
  resize(cssW, cssH, dpr, cellCssH, fontFamily) {
    const gl = this.gl;
    const W = Math.round(cssW * dpr), H = Math.round(cssH * dpr);
    this.cv.width = W; this.cv.height = H;
    const ch = Math.max(7, Math.round(cellCssH * dpr));
    const fontPx = Math.round(ch * 0.82);
    const mc = document.createElement('canvas').getContext('2d');
    const font = `500 ${fontPx}px ${fontFamily}`;
    mc.font = font;
    const cw = Math.max(4, Math.round(mc.measureText('M').width * 1.02));
    this.cellPx = [cw, ch]; this.font = font;
    this.cols = Math.floor(W / cw) & ~1; this.rows = Math.floor(H / ch) & ~1;
    this.uiCols = this.cols / 2; this.uiRows = this.rows / 2;
    this.off = [Math.floor((W - this.cols * cw) / 2), Math.floor((H - this.rows * ch) / 2)];
    this.W = W; this.H = H; this.dpr = dpr;
    this.aspect = (this.cols * cw) / (this.rows * ch);
    const SX = this.SX, SY = this.SY;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const pack = at => { const rg = new Uint8Array(at.W * at.H * 2); for (let i = 0; i < at.W * at.H; i++) { rg[i * 2] = at.alpha[i]; rg[i * 2 + 1] = at.blur[i]; } return rg; };
    const at = buildAtlas(cw, ch, font, SX, SY);
    if (this.atlasTex) gl.deleteTexture(this.atlasTex);
    this.atlasTex = glTex(gl, at.W, at.H, { ifmt: gl.RG8, fmt: gl.RG, data: pack(at) });
    if (this.shapeTex) gl.deleteTexture(this.shapeTex);
    this.shapeTex = glTex(gl, 95, at.NS, { ifmt: gl.R8, fmt: gl.RED, data: at.shapeN });
    const uat = buildAtlas(cw * 2, ch * 2, `500 ${Math.round(ch * 2 * 0.82)}px ${fontFamily}`, 1, 1);
    if (this.uiAtlasTex) gl.deleteTexture(this.uiAtlasTex);
    this.uiAtlasTex = glTex(gl, uat.W, uat.H, { ifmt: gl.RG8, fmt: gl.RG, data: pack(uat) });
    // targets
    [this.tG, this.tR, this.tE, this.tB1, this.tB2, this.tC].forEach(t => glFree(gl, t));
    this.gw = this.cols * SX; this.gh = this.rows * SY;
    this.tG = glTarget(gl, this.gw, this.gh, 2, { depth: true });
    this.tR = glTarget(gl, Math.ceil(this.gw * 0.5), Math.ceil(this.gh * 0.5), 2, { depth: true, linear: [true, false] });
    this.tE = glTarget(gl, this.cols, this.rows, 1, { linear: [true] });
    this.tB1 = glTarget(gl, this.cols, this.rows, 1, { linear: [true] });
    this.tB2 = glTarget(gl, this.cols, this.rows, 1, { linear: [true] });
    this.tC = glTarget(gl, this.cols, this.rows, 3);
    [this.ovA, this.ovB, this.uiA, this.uiB].forEach(t => t && gl.deleteTexture(t));
    this.ovA = glTex(gl, this.cols, this.rows); this.ovB = glTex(gl, this.cols, this.rows);
    this.uiA = glTex(gl, this.uiCols, this.uiRows); this.uiB = glTex(gl, this.uiCols, this.uiRows);
  }

  // ── camera
  setCamera(pos, target, fovY, far = 260) {
    const view = M4.lookAt(pos, target, [0, 1, 0]);
    const proj = M4.persp(fovY, this.aspect, 0.3, far);
    this.cam = { pos, target, fovY, far, view, proj, vp: M4.mul(proj, view) };
    const f = V3.norm(V3.sub(target, pos)), r = V3.norm(V3.cross(f, [0, 1, 0])), u = V3.cross(r, f);
    this.cam.fwd = f; this.cam.right = r; this.cam.up = u;
    const ty = Math.tan(fovY / 2); this.cam.tan = [ty * this.aspect, ty];
  }
  // world point → cell coords (x,y from top-left) + depth
  project(p) {
    const c = M4.proj(this.cam.vp, p);
    if (c[3] <= 0.01) return null;
    const nx = c[0] / c[3], ny = c[1] / c[3];
    return { x: (nx * 0.5 + 0.5) * this.cols, y: (1 - (ny * 0.5 + 0.5)) * this.rows, d: V3.len(V3.sub(p, this.cam.pos)) / this.cam.far };
  }

  setLights(list) {
    // nearest lights to the camera target win
    const t = this.cam.target;
    const sorted = list.filter(l => l.i > 0.001).map(l => [l, (l.p[0] - t[0]) ** 2 + (l.p[2] - t[2]) ** 2 - l.r * l.r * 2]).sort((a, b) => a[1] - b[1]);
    this.NL = Math.min(MAXL, sorted.length);
    for (let k = 0; k < this.NL; k++) {
      const l = sorted[k][0];
      this.LP.set([l.p[0], l.p[1], l.p[2], l.r], k * 4);
      this.LC.set([l.c[0] * l.i, l.c[1] * l.i, l.c[2] * l.i, 0], k * 4);
    }
  }

  _drawScene(mirror, target) {
    const gl = this.gl, P = this.P, c = this.cam, pr = this.params;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
    gl.viewport(0, 0, target.w, target.h);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    // sky
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
    gl.useProgram(P.sky.p);
    const su = P.sky.u;
    gl.uniform3fv(su.uFwd, c.fwd); gl.uniform3fv(su.uRight, c.right); gl.uniform3fv(su.uUp, c.up);
    gl.uniform3fv(su.uMoon, this.moon); gl.uniform2fv(su.uTan, c.tan); gl.uniform2f(su.uRes, target.w, target.h);
    gl.uniform1f(su.uMirror, mirror); gl.uniform1f(su.uTime, this.time); gl.uniform1f(su.uRain, pr.rain || 0);
    gl.bindVertexArray(this.vaoEmpty); gl.drawArrays(gl.TRIANGLES, 0, 3);
    // geometry
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.depthFunc(gl.LEQUAL);
    gl.useProgram(P.scene.p);
    const u = P.scene.u;
    gl.uniformMatrix4fv(u.uVP, false, c.vp);
    gl.uniform3fv(u.uCam, c.pos); gl.uniform1f(u.uTime, this.time); gl.uniform1f(u.uMirror, mirror);
    gl.uniform1f(u.uFar, c.far); gl.uniform1f(u.uWet, pr.wet); gl.uniform1f(u.uFog, pr.fog);
    gl.uniform2f(u.uRes, target.w, target.h);
    gl.uniform4fv(u.uLP, this.LP); gl.uniform4fv(u.uLC, this.LC); gl.uniform1i(u.uNL, this.NL);
    gl.uniform3fv(u.uMoon, this.moon); gl.uniform3fv(u.uFogC, this.fogC);
    gl.uniform3fv(u.uAmbTop, this.ambTop); gl.uniform3fv(u.uAmbBot, this.ambBot);
    gl.uniform4fv(u.uRip, this.rip); gl.uniform4fv(u.uOcc, this.occ || [0, 0, 0, 0]);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, mirror ? this.blackTex : this.tR.tex[0]);
    gl.uniform1i(u.uRefl, 0);
    this._fr = this._frustum(c.vp);
    for (const m of this.meshes) {
      if (!m.visible || (mirror && !m.reflect)) continue;
      if (!this._visible(m.bb, mirror)) continue;
      gl.uniformMatrix4fv(u.uModel, false, m.model);
      gl.bindVertexArray(m.vao); gl.drawArrays(gl.TRIANGLES, 0, m.count);
    }
    gl.bindVertexArray(null);
  }

  _full(prog, target, w, h) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    gl.viewport(0, 0, w, h);
    gl.bindVertexArray(this.vaoEmpty); gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  _tex(unit, tex, loc) { const gl = this.gl; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(loc, unit); }

  render(overlay, ui) {
    const gl = this.gl, P = this.P, pr = this.params;
    gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    this._drawScene(1, this.tR);
    this._drawScene(0, this.tG);
    gl.disable(gl.DEPTH_TEST);
    // emissive → cell res
    gl.useProgram(P.emit.p); this._tex(0, this.tG.tex[0], P.emit.u.uG0); gl.uniform2i(P.emit.u.uS, this.SX, this.SY);
    this._full(P.emit, this.tE, this.cols, this.rows);
    // separable blur ×2 (wide glow)
    gl.useProgram(P.blur.p); gl.uniform2f(P.blur.u.uSize, this.cols, this.rows);
    let src = this.tE;
    [[2, 0], [0, 2], [4.4, 0], [0, 4.4]].forEach((d, i) => {
      const dst = i % 2 ? this.tB2 : this.tB1;
      this._tex(0, src.tex[0], P.blur.u.uT); gl.uniform2f(P.blur.u.uDir, d[0], d[1]);
      this._full(P.blur, dst, this.cols, this.rows); src = dst;
    });
    // ASCII
    gl.useProgram(P.ascii.p); const au = P.ascii.u;
    this._tex(0, this.tG.tex[0], au.uG0); this._tex(1, this.tG.tex[1], au.uG1);
    this._tex(2, this.tB2.tex[0], au.uGlow); this._tex(3, this.shapeTex, au.uShape); this._tex(4, this.csTex, au.uCS);
    gl.uniform2i(au.uS, this.SX, this.SY); gl.uniform1f(au.uTime, this.time); gl.uniform1f(au.uExpo, pr.expo);
    gl.uniform1f(au.uBloomAscii, pr.bloomAscii); gl.uniform1f(au.uDetail, 2); gl.uniform1f(au.uReveal, pr.reveal ?? 1); gl.uniform2i(au.uCells, this.cols, this.rows);
    gl.uniform1iv(au.uEdge, this.edge); gl.uniform1i(au.uEdgeN, this.edgeN);
    this._full(P.ascii, this.tC, this.cols, this.rows);
    // overlay upload
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindTexture(gl.TEXTURE_2D, this.ovA); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.cols, this.rows, gl.RGBA, gl.UNSIGNED_BYTE, overlay.a);
    gl.bindTexture(gl.TEXTURE_2D, this.ovB); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.cols, this.rows, gl.RGBA, gl.UNSIGNED_BYTE, overlay.b);
    gl.bindTexture(gl.TEXTURE_2D, this.uiA); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.uiCols, this.uiRows, gl.RGBA, gl.UNSIGNED_BYTE, ui.a);
    gl.bindTexture(gl.TEXTURE_2D, this.uiB); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.uiCols, this.uiRows, gl.RGBA, gl.UNSIGNED_BYTE, ui.b);
    // display
    gl.useProgram(P.disp.p); const du = P.disp.u;
    this._tex(0, this.tC.tex[0], du.uC0); this._tex(1, this.tC.tex[1], du.uC1); this._tex(2, this.tC.tex[2], du.uC2);
    this._tex(3, this.atlasTex, du.uAtlas); this._tex(4, this.tB2.tex[0], du.uGlow);
    this._tex(5, this.ovA, du.uO0); this._tex(6, this.ovB, du.uO1);
    this._tex(7, this.uiA, du.uU0); this._tex(8, this.uiB, du.uU1); this._tex(9, this.uiAtlasTex, du.uAtlasUI);
    gl.uniform2fv(du.uCellPx, this.cellPx); gl.uniform2fv(du.uOff, this.off); gl.uniform2f(du.uScreen, this.W, this.H);
    gl.uniform2i(du.uCells, this.cols, this.rows); gl.uniform1f(du.uTime, this.time); gl.uniform1f(du.uHalo, pr.halo); gl.uniform1f(du.uFade, pr.fade);
    this._full(P.disp, null, this.W, this.H);
  }
}

// ───────────────────────── overlay (HUD, particles, signs) ─────────────────────────
// One character per cell, drawn over the scene. flags: 1 always on top, 2 solid background, 4 only over water
class Overlay {
  resize(cols, rows) {
    this.cols = cols; this.rows = rows;
    this.a = new Uint8Array(cols * rows * 4); this.b = new Uint8Array(cols * rows * 4);
    this.z = new Float32Array(cols * rows);
  }
  clear() { this.a.fill(0); this.z.fill(9); }
  put(x, y, ch, col, d = 0, flags = 1, glow = 0) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
    const code = typeof ch === 'number' ? ch : ch.charCodeAt(0);
    if (code <= 32 && !(flags & 2)) return;
    const i = (this.rows - 1 - y) * this.cols + x;
    if (!(flags & 1) && d > this.z[i]) return;
    this.z[i] = (flags & 1) ? -1 : d;
    const dd = Math.min(0.99999, Math.max(0, d)) * 255;
    const A = this.a, B = this.b, j = i * 4;
    A[j] = Math.max(32, code); A[j + 1] = Math.floor(dd); A[j + 2] = Math.floor((dd % 1) * 255); A[j + 3] = flags;
    B[j] = Math.min(255, col[0] * 255); B[j + 1] = Math.min(255, col[1] * 255); B[j + 2] = Math.min(255, col[2] * 255); B[j + 3] = Math.min(255, glow * 255);
  }
  text(x, y, s, col, d = 0, flags = 1, glow = 0) { for (let i = 0; i < s.length; i++) this.put(x + i, y, s[i], col, d, flags, glow); }
  vtext(x, y, s, col, d = 0, flags = 1, glow = 0) { for (let i = 0; i < s.length; i++) this.put(x, y + i, s[i], col, d, flags, glow); }
  // filled box with an ASCII border
  box(x, y, w, h, col, bcol, style = 0) {
    const bc = bcol || col;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const edgeY = j === 0 || j === h - 1, edgeX = i === 0 || i === w - 1;
      let c = ' ';
      if (edgeY && edgeX) c = style ? '+' : '.';
      else if (edgeY) c = style ? '-' : (j === 0 ? '-' : '-');
      else if (edgeX) c = '|';
      this.put(x + i, y + j, c, bc, 0, 3, 0);
    }
  }
}
