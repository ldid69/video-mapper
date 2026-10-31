'use strict';
// ---------- Math : homographie carré unité -> quadrilatère (Heckbert) ----------
function squareToQuad(q) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  const det = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(det) < 1e-12) return null;
  const g = (dx3 * dy2 - dx2 * dy3) / det, h = (dx1 * dy3 - dx3 * dy1) / det;
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0,
          y1 - y0 + g * y1, y3 - y0 + h * y3, y0,
          g, h, 1];
}
function inv3(m) {
  if (!m) return null;
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
          B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
          C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}
function apply(m, x, y) {
  const w = m[6] * x + m[7] * y + m[8];
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w];
}
// Cadrage : échelle des coordonnées de texture pour couvrir / contenir la surface.
function fitScale(fit, mw, mh, qw, qh) {
  if (fit === 'free' || !mw || !mh || !qw || !qh) return [1, 1];
  const ra = (mw / mh) / (qw / qh), wide = ra > 1;
  if (fit === 'cover') return wide ? [1 / ra, 1] : [1, ra];
  return wide ? [1, ra] : [1 / ra, 1];
}
// Auto-vérification au chargement.
{
  const q = [[.1, .2], [.8, .1], [.9, .9], [.2, .7]], H = squareToQuad(q), Hi = inv3(H);
  [[0, 0], [1, 0], [1, 1], [0, 1]].forEach((u, k) => {
    const p = apply(H, ...u), b = apply(Hi, ...p);
    console.assert(Math.hypot(p[0] - q[k][0], p[1] - q[k][1]) < 1e-9, 'homographie coin ' + k);
    console.assert(Math.hypot(b[0] - u[0], b[1] - u[1]) < 1e-9, 'inverse coin ' + k);
  });
  const c = fitScale('cover', 1920, 1080, 100, 100), n = fitScale('contain', 1920, 1080, 100, 100);
  console.assert(Math.abs(c[0] - 9 / 16) < 1e-9 && c[1] === 1, 'cover 16:9 dans un carré');
  console.assert(n[0] === 1 && Math.abs(n[1] - 16 / 9) < 1e-9, 'contain 16:9 dans un carré');
}
// ---------- fin math ----------

const $ = s => document.querySelector(s);
const KEY = 'mapping-video-v3', HIT = 12, ROT_OFF = 34;
const BEAM = '#ffb547', PLAY = '#5bd49b', TEXT = '#ebe7df';
const glc = $('#gl'), ov = $('#overlay'), ui = $('#ui'), layersEl = $('#layers');
const gl = glc.getContext('webgl2', { alpha: false, antialias: false, powerPreference: 'high-performance' });
const ctx = ov.getContext('2d');
if (!gl) { alert('WebGL2 indisponible : utilise un Chrome ou un Edge récent.'); throw new Error('WebGL2'); }
const vw = () => innerWidth, vh = () => innerHeight;

// ---------- Icônes Lucide ----------
function setIcon(el, name) { el.innerHTML = LUCIDE[name] || ''; el.dataset.icon = name; }
document.querySelectorAll('[data-icon]').forEach(el => {
  setIcon(el, el.dataset.icon);
  if (el.title && !el.hasAttribute('aria-label')) el.setAttribute('aria-label', el.title);
});
const iconCache = {};
function iconImg(name, color) {   // version image des icônes, pour les dessiner sur la scène
  const k = name + color;
  if (!iconCache[k]) {
    const img = new Image();
    img.src = 'data:image/svg+xml,' + encodeURIComponent(LUCIDE[name].replace(/currentColor/g, color));
    iconCache[k] = img;
  }
  return iconCache[k];
}

// ---------- Sauvegarde ----------
function loadSaved() {
  try {
    const v3 = JSON.parse(localStorage.getItem(KEY));
    if (v3) return v3;
    // Reprise des réglages des versions précédentes.
    const v2 = JSON.parse(localStorage.getItem('mapping-video-v2')) || {};
    const v1 = JSON.parse(localStorage.getItem('mapping-video-v1'));
    const corners = v2.corners || (Array.isArray(v1) ? v1 : null);
    return { layers: corners && corners.map(c => ({ corners: c })), bg: v2.bg && { color: v2.bg }, ui: v2.ui };
  } catch { return {}; }
}
const saved = loadSaved() || {};
const layers = [];
const bg = { color: saved.bg?.color || '#000000', fit: saved.bg?.fit || 'cover', el: null, url: null,
             name: typeof saved.bg?.name === 'string' ? saved.bg.name : '', tex: null };
// Projet = tout sauf les médias eux-mêmes (le navigateur ne donne pas accès aux chemins des fichiers).
function serialize() {
  return {
    app: 'mapping-video', version: 1,
    layers: layers.map(L => ({ label: L.label, camLabel: L.camLabel, corners: L.corners, fit: L.fit, opacity: L.opacity,
                               blur: L.blur, blend: L.blend,
                               volume: L.video.volume, loop: L.video.loop, visible: L.visible, locked: L.locked })),
    bg: { color: bg.color, fit: bg.fit, name: bg.name },
    step: +stepIn.value, grid: showGrid, ui: [ui.offsetLeft, ui.offsetTop],
  };
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(serialize())); } catch {}
}

// ---------- WebGL ----------
const VS = `#version 300 es
in vec2 p; void main() { gl_Position = vec4(p, 0., 1.); }`;
const FS = `#version 300 es
precision highp float;
uniform sampler2D t; uniform mat3 Hi;
uniform vec2 res, S, O;
uniform float grid, has, tile, alpha, white;
out vec4 o;
void main() {
  vec2 n = vec2(gl_FragCoord.x / res.x, 1. - gl_FragCoord.y / res.y);
  vec3 q = Hi * vec3(n, 1.);
  vec2 uv = q.xy / q.z;                                  // position sur la surface (0..1)
  if (any(lessThan(uv, vec2(0.))) || any(greaterThan(uv, vec2(1.)))) discard;
  vec4 c = vec4(.10, .11, .14, 1.);                      // surface vide
  if (has > .5) {
    vec2 tuv = uv * S + O;                               // position dans la vidéo (cadrage)
    if (tile > .5) tuv = fract(tuv);
    c = any(lessThan(tuv, vec2(0.))) || any(greaterThan(tuv, vec2(1.))) ? vec4(0.) : texture(t, tuv);
  }
  if (grid > .5 || has < .5) {                           // grille déformée avec la surface
    vec2 g = uv * 10.;
    vec2 d = abs(fract(g + .5) - .5) / fwidth(g);
    c = mix(c, vec4(1.), (1. - min(min(d.x, d.y), 1.)) * .8);
  }
  // Couleur prémultipliée : permet à tous les modes de fusion de respecter l'opacité.
  float a = c.a * alpha;
  o = vec4(white > .5 ? mix(vec3(1.), c.rgb, a) : c.rgb * a, a);   // « Assombrir » : neutre = blanc
}`;
// Flou gaussien séparable : une passe horizontale puis une verticale, 17 échantillons.
const BVS = `#version 300 es
in vec2 p; out vec2 v; void main() { v = p * .5 + .5; gl_Position = vec4(p, 0., 1.); }`;
const BFS = `#version 300 es
precision highp float;
uniform sampler2D t; uniform vec2 dir; uniform float sigma;
in vec2 v; out vec4 o;
void main() {
  vec4 acc = vec4(0.); float ws = 0.;
  for (int i = -8; i <= 8; i++) {
    float x = float(i), w = exp(-x * x / (2. * sigma * sigma));
    acc += texture(t, v + dir * x) * w; ws += w;
  }
  o = acc / ws;
}`;
function shader(type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
function program(vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, shader(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'p');   // même géométrie pour les deux programmes
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}
const prog = program(VS, FS), blurProg = program(BVS, BFS);
const U = Object.fromEntries(['Hi', 'res', 'S', 'O', 'grid', 'has', 'tile', 'alpha', 'white'].map(n => [n, gl.getUniformLocation(prog, n)]));
const BU = { dir: gl.getUniformLocation(blurProg, 'dir'), sigma: gl.getUniformLocation(blurProg, 'sigma') };
gl.useProgram(prog);
gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
gl.enable(gl.BLEND);
// Modes de fusion faisables directement par la carte graphique (source en couleur prémultipliée).
const BLENDS = {
  normal: [gl.FUNC_ADD, gl.ONE, gl.ONE_MINUS_SRC_ALPHA],
  add: [gl.FUNC_ADD, gl.ONE, gl.ONE],
  screen: [gl.FUNC_ADD, gl.ONE, gl.ONE_MINUS_SRC_COLOR],
  multiply: [gl.FUNC_ADD, gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA],
  lighten: [gl.MAX, gl.ONE, gl.ONE],
  darken: [gl.MIN, gl.ONE, gl.ONE],
};
function setBlend(m) {
  const [eq, s, d] = BLENDS[m] || BLENDS.normal;
  gl.blendEquation(eq); gl.blendFunc(s, d);
  gl.uniform1f(U.white, m === 'darken' ? 1 : 0);
}
function newTex() {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
                        [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]])
    gl.texParameteri(gl.TEXTURE_2D, k, v);
  return t;
}
function upload(tex, media) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, media);
}
bg.tex = newTex();
const colMajor = m => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
function drawQuad(tex, corners, { has = true, grid = false, s = [1, 1], tile = false, alpha = 1, blend = 'normal' } = {}) {
  const Hi = inv3(squareToQuad(corners)); if (!Hi) return;
  setBlend(blend);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1f(U.has, has ? 1 : 0);
  gl.uniform1f(U.grid, grid ? 1 : 0);
  gl.uniform1f(U.tile, tile ? 1 : 0);
  gl.uniform1f(U.alpha, alpha);
  gl.uniform2f(U.S, s[0], s[1]);
  gl.uniform2f(U.O, tile ? 0 : .5 - .5 * s[0], tile ? 0 : .5 - .5 * s[1]);
  gl.uniformMatrix3fv(U.Hi, false, colMajor(Hi));
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

// ---------- Flou : rendu dans deux textures intermédiaires, en résolution réduite si le flou est fort ----------
function fboTex(w, h) {
  const t = newTex();
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const f = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, f);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { t, f };
}
function freeBlur(L) {
  const B = L.blurBuf;
  if (!B) return;
  for (const x of [B.a, B.b]) { gl.deleteTexture(x.t); gl.deleteFramebuffer(x.f); }
  L.blurBuf = null;
}
function blurLayer(L) {
  const v = L.video, sigma = L.blur / 2;               // rayon ≈ 2 σ, en pixels de la vidéo
  const ds = Math.max(1, Math.ceil(sigma * 3 / 8));    // réduction pour que 3 σ tiennent dans 8 échantillons
  const w = Math.max(1, Math.round(v.videoWidth / ds)), h = Math.max(1, Math.round(v.videoHeight / ds));
  if (!L.blurBuf || L.blurBuf.w !== w || L.blurBuf.h !== h) { freeBlur(L); L.blurBuf = { w, h, a: fboTex(w, h), b: fboTex(w, h) }; }
  const B = L.blurBuf;
  gl.useProgram(blurProg);
  gl.disable(gl.BLEND);
  gl.viewport(0, 0, w, h);
  gl.uniform1f(BU.sigma, Math.max(sigma / ds, .01));
  gl.bindFramebuffer(gl.FRAMEBUFFER, B.a.f);
  gl.bindTexture(gl.TEXTURE_2D, L.tex);
  gl.uniform2f(BU.dir, ds / v.videoWidth, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, B.b.f);
  gl.bindTexture(gl.TEXTURE_2D, B.a.t);
  gl.uniform2f(BU.dir, 0, 1 / h);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, glc.width, glc.height);
  gl.enable(gl.BLEND);
  gl.useProgram(prog);
}

// ---------- Géométrie en pixels (les coins sont stockés en 0..1 de l'écran) ----------
const toPx = ([x, y]) => [x * vw(), y * vh()];
const toN = ([x, y]) => [x / vw(), y / vh()];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
function centroidPx(corners) {
  const P = corners.map(toPx);
  return [P.reduce((a, p) => a + p[0], 0) / 4, P.reduce((a, p) => a + p[1], 0) / 4];
}
function rotateCorners(corners, c, a) {
  const cos = Math.cos(a), sin = Math.sin(a);
  return corners.map(q => {
    const [x, y] = toPx(q), dx = x - c[0], dy = y - c[1];
    return toN([c[0] + dx * cos - dy * sin, c[1] + dx * sin + dy * cos]);
  });
}
function scaleCorners(corners, c, f) {
  return corners.map(q => { const [x, y] = toPx(q); return toN([c[0] + (x - c[0]) * f, c[1] + (y - c[1]) * f]); });
}
function quadSize(corners) {
  const P = corners.map(toPx);
  return [(dist(P[0], P[1]) + dist(P[3], P[2])) / 2, (dist(P[0], P[3]) + dist(P[1], P[2])) / 2];
}
function rotHandle(P) {   // poignée de rotation : au-dessus du milieu du bord haut
  const m = mid(P[0], P[1]), c = [(P[0][0] + P[1][0] + P[2][0] + P[3][0]) / 4, (P[0][1] + P[1][1] + P[2][1] + P[3][1]) / 4];
  const d = dist(m, c) || 1;
  return [m[0] + (m[0] - c[0]) / d * ROT_OFF, m[1] + (m[1] - c[1]) / d * ROT_OFF];
}
const edgeMids = P => P.map((p, j) => mid(p, P[(j + 1) % 4]));   // poignées d'agrandissement proportionnel
function inside(L, x, y) {
  const Hi = inv3(squareToQuad(L.corners)); if (!Hi) return false;
  const [u, v] = apply(Hi, x, y);
  return u >= 0 && u <= 1 && v >= 0 && v <= 1;
}
function defaultCorners(i) {   // 3 par ligne, les suivants décalés vers le bas
  const w = .28, h = .4, g = (1 - 3 * w) / 4, x = g + (i % 3) * (w + g), y = .12 + (Math.floor(i / 3) % 6) * .08;
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}

// ---------- Messages ----------
const hintEl = $('#hint'), toastEl = $('#toast');
let toastTimer, toastDone = null;
function setHint(t) { if (hintEl.textContent !== t) hintEl.textContent = t; }
function toast(msg, { dot = false, action = null, ms = 2500, done = null } = {}) {
  const prev = toastDone; toastDone = null; prev?.();
  toastEl.textContent = '';
  if (dot) toastEl.append(Object.assign(document.createElement('span'), { className: 'dot' }));
  toastEl.append(msg);
  if (action) {
    const b = Object.assign(document.createElement('button'), { textContent: action.label });
    b.onclick = () => { toastDone = null; action.fn(); hideToast(); };
    toastEl.append(b);
  }
  toastEl.classList.add('show');
  toastDone = done;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, ms);
}
function hideToast() {
  toastEl.classList.remove('show');
  const d = toastDone; toastDone = null; d?.();
}

// ---------- Calques ----------
let sel = -1, selCorner = -1, drag = null, hoverIdx = -1, showGrid = false, devices = [], pickTarget = null, pendingDelete = null;
const STATE_ICON = { playing: 'play', paused: 'pause', missing: 'circle-alert', empty: 'file-video-camera' };
const STATE_TEXT = { playing: 'En lecture', paused: 'En pause', missing: 'Fichier à recharger', empty: 'Aucune source' };
const hasMedia = L => L.video.readyState >= 2 && L.video.videoWidth > 0;
function status(L) {
  if (!L.url && !L.stream) return L.label ? 'missing' : 'empty';
  return L.video.paused ? 'paused' : 'playing';
}

function addLayer(d = {}) {
  const video = document.createElement('video');
  Object.assign(video, { muted: true, loop: d.loop ?? true, playsInline: true, volume: d.volume ?? 1 });
  const L = {
    video, stream: null, url: null, deviceId: '', label: d.label || '', camLabel: d.camLabel || '',
    corners: d.corners || defaultCorners(layers.length), fit: d.fit || 'free',
    opacity: d.opacity ?? 1, visible: d.visible ?? true, locked: !!d.locked,
    blur: d.blur || 0, blend: d.blend || 'normal',
    tex: newTex(), dirty: true, blurDirty: true, blurBuf: null,
  };
  // N'envoie au GPU que les images réellement nouvelles (économise la bande passante à plusieurs flux).
  if ('requestVideoFrameCallback' in video) {
    const onFrame = () => { L.dirty = true; video.requestVideoFrameCallback(onFrame); };
    video.requestVideoFrameCallback(onFrame);
  } else L.alwaysDirty = true;
  const li = document.createElement('li');
  li.className = 'layer';
  li.innerHTML = `<canvas class="thumb" width="64" height="36"></canvas>
    <span class="lname"><b class="num"></b><span class="ltxt"></span></span>
    <span class="lstate"></span>
    <button class="ib xs vis" title="Masquer / afficher"></button>
    <button class="ib xs lock" title="Verrouiller / déverrouiller (L)"></button>
    <span class="more">
      <button class="ib xs up" title="Passer devant (Page↑)" data-icon="chevron-up"></button>
      <button class="ib xs down" title="Passer derrière (Page↓)" data-icon="chevron-down"></button>
      <button class="ib xs del danger" title="Supprimer le calque" data-icon="trash-2"></button>
    </span>`;
  li.querySelectorAll('[data-icon]').forEach(el => { setIcon(el, el.dataset.icon); el.setAttribute('aria-label', el.title); });
  li.querySelectorAll('.vis, .lock').forEach(el => el.setAttribute('aria-label', el.title));
  const on = (cls, fn) => li.querySelector(cls).addEventListener('click', e => { e.stopPropagation(); fn(); });
  on('.vis', () => { L.visible = !L.visible; refreshLayer(L); save(); });
  on('.lock', () => toggleLock(L));
  on('.up', () => moveLayer(L, 1));
  on('.down', () => moveLayer(L, -1));
  on('.del', () => removeLayer(L));
  li.onclick = () => select(layers.indexOf(L));
  li.ondblclick = () => pickFor(L);
  L.li = li;
  L.tctx = li.querySelector('.thumb').getContext('2d');
  for (const ev of ['play', 'pause', 'ended', 'emptied', 'loadeddata']) video.addEventListener(ev, () => refreshLayer(L));
  layers.push(L);
  layersEl.appendChild(li);
  return L;
}
function select(i) {
  sel = i; selCorner = -1;
  refreshAll();
}
function refreshLayer(L) {
  const i = layers.indexOf(L), st = status(L), q = s => L.li.querySelector(s);
  if (i < 0) return;
  q('.num').textContent = i + 1;
  const t = q('.ltxt');
  t.textContent = L.label || 'Calque vide';
  t.classList.toggle('missing', st === 'missing');
  t.title = st !== 'missing' ? L.label
    : L.camLabel ? L.label + ' : caméra à reconnecter (bouton caméra)' : L.label + ' : à recharger (double-clic ou bouton lien)';
  const s = q('.lstate');
  s.className = 'lstate ' + st; setIcon(s, STATE_ICON[st]); s.title = STATE_TEXT[st];
  const vis = q('.vis'), lock = q('.lock');
  setIcon(vis, L.visible ? 'eye' : 'eye-off'); vis.classList.toggle('off', !L.visible);
  setIcon(lock, L.locked ? 'lock' : 'lock-open'); lock.classList.toggle('off', !L.locked);
  q('.up').disabled = i === layers.length - 1;
  q('.down').disabled = i === 0;
  q('.del').disabled = layers.length <= 1;
  L.li.classList.toggle('sel', i === sel);
  if (i === sel) updateInspector();
  refreshLinkBtn();
}
const fileMissing = L => status(L) === 'missing' && !L.camLabel;
const bgMissing = () => !!bg.name && !bg.url;
function refreshLinkBtn() {
  const n = layers.filter(fileMissing).length + (bgMissing() ? 1 : 0);
  const b = $('#linkBtn');
  b.disabled = !n;
  b.title = n ? `Relier ${n > 1 ? 'les ' + n + ' fichiers' : 'le fichier'} à recharger (sélection multiple)` : 'Aucun fichier à recharger';
  b.setAttribute('aria-label', b.title);
  return n;
}
function refreshAll() {
  layers.forEach(refreshLayer);
  $('#count').textContent = layers.length;
  updateInspector();
}
function moveLayer(L, dir) {   // l'ordre du tableau est l'ordre de dessin : le dernier passe devant
  const i = layers.indexOf(L), j = i + dir;
  if (j < 0 || j >= layers.length) return;
  [layers[i], layers[j]] = [layers[j], layers[i]];
  layers.forEach(x => layersEl.appendChild(x.li));
  select(j); save();
}
function removeLayer(L) {
  if (layers.length <= 1) return;
  const i = layers.indexOf(L);
  L.video.pause();
  L.li.remove();
  layers.splice(i, 1);
  select(Math.min(Math.max(sel, 0), layers.length - 1));
  save();
  pendingDelete = { L, i };
  toast(`Calque ${i + 1} supprimé`, {
    ms: 6000,
    action: { label: 'Annuler', fn: () => {
      layers.splice(i, 0, L);
      layers.forEach(x => layersEl.appendChild(x.li));
      pendingDelete = null;
      select(i); save();
    } },
    done: () => { if (pendingDelete?.L === L) { release(L); gl.deleteTexture(L.tex); freeBlur(L); pendingDelete = null; } },
  });
}
function release(L) {   // libère fichier ou caméra avant d'en charger un autre
  if (L.stream) { L.stream.getTracks().forEach(t => t.stop()); L.stream = null; L.video.srcObject = null; }
  if (L.url) { URL.revokeObjectURL(L.url); L.url = null; L.video.removeAttribute('src'); L.video.load(); }
  L.deviceId = ''; L.camLabel = '';
}
function loadFile(L, f) {
  release(L);
  L.label = f.name;
  L.url = L.video.src = URL.createObjectURL(f);
  L.video.play().catch(() => {});
  refreshLayer(L); save();
}
async function loadCam(L, id) {
  release(L);
  refreshLayer(L);
  if (!id) return;
  try {
    L.stream = await navigator.mediaDevices.getUserMedia({ audio: false,
      video: { deviceId: { exact: id }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
    L.deviceId = id;
    L.label = L.camLabel = devices.find(d => d.deviceId === id)?.label || 'Caméra';
    L.video.srcObject = L.stream;
    L.video.play().catch(() => {});
  } catch (e) { toast('Impossible d\'ouvrir la caméra : ' + e.message, { ms: 4000 }); }
  refreshLayer(L); save();
}
function pickFor(L) { pickTarget = L; const p = $('#pick'); p.value = ''; p.click(); }
$('#pick').onchange = e => { const f = e.target.files[0]; if (f && pickTarget) loadFile(pickTarget, f); };
function toggleLock(L) {
  L.locked = !L.locked;
  refreshLayer(L); save();
  toast(L.locked ? 'Calque verrouillé' : 'Calque déverrouillé', { ms: 1400 });
}
function editable(L) {
  if (!L) return false;
  if (L.locked) { toast('Calque verrouillé. Appuie sur L pour le déverrouiller.'); return false; }
  return true;
}
function togglePlay(L) {
  if (!L || (!L.url && !L.stream)) return;
  L.video.paused ? L.video.play().catch(() => {}) : L.video.pause();
}

// ---------- Inspecteur ----------
const insp = {
  body: $('#inspBody'), empty: $('#inspEmpty'), name: $('#inspName'), fit: $('#fitSeg'),
  play: $('#playBtn'), loop: $('#loopBtn'), mute: $('#muteBtn'), op: $('#opacity'), opOut: $('#opOut'), cam: $('#camSel'),
  vol: $('#volume'), volOut: $('#volOut'), blur: $('#blur'), blurOut: $('#blurOut'), blend: $('#blendSel'),
};
// ---------- Son : un analyseur par calque, créé au premier réglage (le navigateur exige un geste) ----------
let actx = null, level = 0;
function ensureAudio(L) {
  if (L.analyser) return;
  try {
    actx = actx || new AudioContext();
    actx.resume();
    const src = actx.createMediaElementSource(L.video);   // le volume de la vidéo s'applique avant l'analyse
    L.analyser = actx.createAnalyser();
    L.analyser.fftSize = 1024;
    L.samples = new Float32Array(L.analyser.fftSize);
    src.connect(L.analyser);
    L.analyser.connect(actx.destination);
  } catch (e) { console.warn('Vumètre indisponible :', e); }
}
function updateMeter() {
  const L = layers[sel];
  let target = 0;
  if (L?.analyser && !L.video.muted && !L.video.paused) {
    L.analyser.getFloatTimeDomainData(L.samples);
    let peak = 0;
    for (const s of L.samples) peak = Math.max(peak, Math.abs(s));
    target = peak > 0 ? Math.max(0, 1 + 20 * Math.log10(peak) / 60) : 0;   // -60 dB .. 0 dB
  }
  level = target > level ? target : level * .9 + target * .1;   // montée immédiate, descente douce
  insp.vol.style.setProperty('--lvl', (level * 100).toFixed(1) + '%');
}
function volText(v) { return v.muted || v.volume === 0 ? 'Coupé' : Math.round(v.volume * 100) + ' %'; }
function segSet(seg, v) { seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-checked', b.dataset.v === v)); }
function updateInspector() {
  const L = layers[sel];
  insp.body.hidden = !L; insp.empty.hidden = !!L;
  insp.name.textContent = L ? (sel + 1) + ' · ' + (L.label || 'Calque vide') : 'Aucun calque sélectionné';
  insp.name.title = L ? L.label : '';
  if (!L) return;
  segSet(insp.fit, L.fit);
  setIcon(insp.play, L.video.paused ? 'play' : 'pause');
  insp.play.disabled = !L.url && !L.stream;
  insp.loop.setAttribute('aria-pressed', L.video.loop);
  insp.mute.setAttribute('aria-pressed', !L.video.muted);
  setIcon(insp.mute, L.video.muted || L.video.volume === 0 ? 'volume-x' : 'volume-2');
  insp.vol.value = Math.round(L.video.volume * 100);
  insp.vol.style.setProperty('--vol', (L.video.muted ? 0 : insp.vol.value) + '%');
  insp.volOut.textContent = volText(L.video);
  insp.op.value = Math.round(L.opacity * 100);
  insp.opOut.textContent = insp.op.value + ' %';
  insp.cam.value = L.deviceId;
  insp.blur.value = L.blur;
  insp.blurOut.textContent = L.blur ? L.blur + ' px' : 'Aucun';
  insp.blend.value = L.blend;
  document.querySelectorAll('#xfRow button').forEach(b => { b.disabled = L.locked; });
}
insp.fit.onclick = e => {
  const b = e.target.closest('button'), L = layers[sel];
  if (b && L) { L.fit = b.dataset.v; segSet(insp.fit, L.fit); save(); }
};
insp.play.onclick = () => togglePlay(layers[sel]);
insp.loop.onclick = () => { const L = layers[sel]; L.video.loop = !L.video.loop; updateInspector(); save(); };
insp.mute.onclick = () => {
  const v = layers[sel].video;
  ensureAudio(layers[sel]);
  v.muted = !v.muted;
  if (!v.muted && v.volume === 0) v.volume = .5;   // rétablir le son à 0 % n'aurait aucun effet
  updateInspector(); save();
};
insp.vol.oninput = () => {
  const L = layers[sel];
  ensureAudio(L);
  L.video.volume = insp.vol.value / 100;
  L.video.muted = L.video.volume === 0;   // bouger le curseur rétablit le son
  updateInspector();
};
insp.vol.onchange = save;
insp.op.oninput = () => { const L = layers[sel]; L.opacity = insp.op.value / 100; insp.opOut.textContent = insp.op.value + ' %'; };
insp.op.onchange = save;
insp.blur.oninput = () => {
  const L = layers[sel];
  L.blur = +insp.blur.value; L.blurDirty = true;
  insp.blurOut.textContent = L.blur ? L.blur + ' px' : 'Aucun';
};
insp.blur.onchange = save;
insp.blend.onchange = () => { layers[sel].blend = insp.blend.value; save(); };
insp.cam.onchange = () => loadCam(layers[sel], insp.cam.value);
$('#pickBtn').onclick = () => layers[sel] && pickFor(layers[sel]);
function transform(L, op) {
  if (!editable(L)) return;
  const c = centroidPx(L.corners);
  if (op === 'rot-' || op === 'rot+') L.corners = rotateCorners(L.corners, c, (op === 'rot+' ? 15 : -15) * Math.PI / 180);
  else if (op === 'zoom-' || op === 'zoom+') L.corners = scaleCorners(L.corners, c, op === 'zoom+' ? 1.05 : 1 / 1.05);
  else if (op === 'reset') L.corners = defaultCorners(layers.indexOf(L));
  save();
}
$('#xfRow').onclick = e => { const b = e.target.closest('button'); if (b) transform(layers[sel], b.dataset.xf); };

// ---------- Caméras ----------
function fillCams() {
  insp.cam.length = 1;
  devices.forEach((d, k) => insp.cam.add(new Option(d.label || 'Caméra ' + (k + 1), d.deviceId)));
  updateInspector();
}
$('#camsBtn').onclick = async e => {
  e.preventDefault();   // ne replie pas la section
  try {
    // Les noms des périphériques ne sont visibles qu'après une autorisation.
    const tmp = await navigator.mediaDevices.getUserMedia({ video: true });
    tmp.getTracks().forEach(t => t.stop());
    devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    fillCams();
    // Reconnecte les calques caméra d'un projet chargé, retrouvés par le nom du périphérique.
    let back = 0;
    for (const L of layers) {
      const d = L.camLabel && !L.stream && devices.find(d => d.label === L.camLabel);
      if (d) { loadCam(L, d.deviceId); back++; }
    }
    toast(devices.length + (devices.length > 1 ? ' sources vidéo détectées' : ' source vidéo détectée') +
          (back ? ` · ${back} reconnectée${back > 1 ? 's' : ''}` : ''));
  } catch (err) { toast('Accès caméra refusé ou indisponible : ' + err.message, { ms: 4000 }); }
};
$('#addBtn').onclick = e => {
  e.preventDefault();
  const L = addLayer();
  select(layers.length - 1); save();
  pickFor(L);
};

// ---------- Fond ----------
const bgColor = $('#bgColor'), bgClearBtn = $('#bgClear'), bgNameEl = $('#bgName');
bgColor.value = bg.color;
Coloris({
  el: '#bgColor', theme: 'large', themeMode: 'dark', alpha: false, format: 'hex', margin: 6,
  swatches: ['#000000', '#0d1020', '#1b0d2a', '#2a0a0a', '#0a2a1a', '#ff7a00', '#7a2cff', '#ffffff'],
  closeButton: true, closeLabel: 'Fermer',
});
bgColor.addEventListener('input', () => {
  if (/^#[0-9a-f]{6}$/i.test(bgColor.value)) { bg.color = bgColor.value; save(); }
});
function clearBg() {
  if (bg.el instanceof HTMLVideoElement) bg.el.pause();
  if (bg.url) URL.revokeObjectURL(bg.url);
  bg.el = bg.url = null; bg.name = '';
  refreshBg();
}
function refreshBg() {
  const miss = bgMissing();
  bgNameEl.textContent = bg.name ? bg.name + (miss ? ' · à recharger' : '') : '';
  bgNameEl.title = bg.name;
  bgNameEl.classList.toggle('missing', miss);
  bgClearBtn.disabled = !bg.name;
  refreshLinkBtn();
}
function setBg(f) {
  clearBg();
  const url = bg.url = URL.createObjectURL(f);
  bg.name = f.name;
  refreshBg(); save();
  if (f.type.startsWith('video/')) {
    const v = document.createElement('video');
    Object.assign(v, { muted: true, loop: true, playsInline: true, src: url });
    v.play().catch(() => {});
    bg.el = v;
  } else {
    const img = new Image();
    img.onload = () => {
      if (bg.url !== url) return;   // fond changé ou retiré pendant le chargement
      upload(bg.tex, img);          // image fixe : un seul envoi vers le GPU
      bg.el = img;
    };
    img.src = url;
  }
}
bgClearBtn.onclick = () => { clearBg(); save(); };
$('#bgPickBtn').onclick = () => { const p = $('#bgPick'); p.value = ''; p.click(); };
$('#bgPick').onchange = e => { const f = e.target.files[0]; if (f) setBg(f); };
segSet($('#bgFitSeg'), bg.fit);
$('#bgFitSeg').onclick = e => {
  const b = e.target.closest('button');
  if (b) { bg.fit = b.dataset.v; segSet($('#bgFitSeg'), bg.fit); save(); }
};
const FULL = [[0, 0], [1, 0], [1, 1], [0, 1]];
function drawBg() {
  const b = bg.el;
  if (!b) return;
  const isV = b instanceof HTMLVideoElement;
  if (isV && b.readyState < 2) return;
  const mw = b.videoWidth || b.naturalWidth, mh = b.videoHeight || b.naturalHeight;
  if (isV) upload(bg.tex, b);
  const tile = bg.fit === 'mosaic';
  drawQuad(bg.tex, FULL, { s: tile ? [vw() / mw, vh() / mh] : fitScale(bg.fit, mw, mh, vw(), vh()), tile });
}

// ---------- Modes, plein écran, grille ----------
const stepIn = $('#step'), gridBtn = $('#gridBtn'), fsBtn = $('#fsBtn');
if (saved.step) stepIn.value = saved.step;
stepIn.onchange = save;
const isLive = () => document.body.classList.contains('live');
function setGrid(v) { showGrid = v; gridBtn.setAttribute('aria-pressed', v); }
gridBtn.onclick = () => setGrid(!showGrid);
function toggleFs() { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); }
fsBtn.onclick = toggleFs;
let fsByLive = false;   // le plein écran a-t-il été ouvert par la diffusion ?
function setLive(on) {
  if (on === isLive()) return;
  document.body.classList.toggle('live', on);
  if (on && !document.fullscreenElement) {
    fsByLive = true;
    document.documentElement.requestFullscreen().catch(() => { fsByLive = false; });
  } else if (!on && fsByLive) {
    fsByLive = false;   // on ne quitte que le plein écran ouvert par la diffusion
    if (document.fullscreenElement) document.exitFullscreen();
  }
  toast(on ? 'Diffusion · Échap pour revenir en édition' : 'Retour en édition', { dot: on, ms: on ? 1800 : 1200 });
}
$('#liveBtn').onclick = () => setLive(true);
function exitAll() {
  setLive(false);
  if (document.fullscreenElement) document.exitFullscreen();
}
document.addEventListener('fullscreenchange', () => {
  const fs = !!document.fullscreenElement;
  fsBtn.setAttribute('aria-pressed', fs);
  setIcon(fsBtn, fs ? 'minimize' : 'maximize');
  $('#tallyText').textContent = fs ? 'Édition · plein écran' : 'Édition';
  if (!fs) { fsByLive = false; setLive(false); }   // en plein écran, le navigateur intercepte Échap lui-même
});
$('#restartAll').onclick = () => layers.forEach(L => { if (L.url) L.video.currentTime = 0; });
$('#playAll').onclick = () => layers.forEach(L => { if (L.url || L.stream) L.video.play().catch(() => {}); });
$('#pauseAll').onclick = () => layers.forEach(L => L.video.pause());
const keysDlg = $('#keys');
$('#keysBtn').onclick = () => keysDlg.showModal();
$('#keysClose').onclick = () => keysDlg.close();

// ---------- Panneau déplaçable ----------
function placeUi(x, y) {   // garde toujours la barre de titre attrapable à l'écran
  ui.style.left = Math.min(Math.max(0, x), innerWidth - 80) + 'px';
  ui.style.top = Math.min(Math.max(0, y), innerHeight - 40) + 'px';
}
const bar = $('#bar');
bar.addEventListener('pointerdown', e => {
  if (e.target.closest('button')) return;
  const dx = e.clientX - ui.offsetLeft, dy = e.clientY - ui.offsetTop;
  bar.setPointerCapture(e.pointerId);
  bar.onpointermove = ev => placeUi(ev.clientX - dx, ev.clientY - dy);
  bar.onpointerup = () => { bar.onpointermove = bar.onpointerup = null; save(); };
});
function resize() {
  const dpr = devicePixelRatio || 1;
  for (const c of [glc, ov]) { c.width = Math.round(innerWidth * dpr); c.height = Math.round(innerHeight * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  gl.viewport(0, 0, glc.width, glc.height);
  placeUi(ui.offsetLeft, ui.offsetTop);
  $('#res').textContent = glc.width + ' × ' + glc.height;
}
if (saved.ui) placeUi(...saved.ui);
addEventListener('resize', resize);
resize();

// ---------- Interaction sur la scène ----------
function hitTest(px, py) {
  const S = layers[sel];
  if (S && S.visible && !S.locked) {   // les poignées du calque sélectionné passent en premier
    const P = S.corners.map(toPx);
    if (dist(rotHandle(P), [px, py]) < HIT) return { i: sel, type: 'rot' };
    const k = P.findIndex(p => dist(p, [px, py]) < HIT);
    if (k >= 0) return { i: sel, type: 'corner', k };
    if (edgeMids(P).some(m => dist(m, [px, py]) < HIT)) return { i: sel, type: 'scale' };
  }
  const n = toN([px, py]);
  for (let i = layers.length - 1; i >= 0; i--) {
    const L = layers[i];
    if (L.visible && inside(L, ...n)) return { i, type: L.locked ? 'locked' : 'move' };
  }
  return null;
}
const HINTS = {
  corner: 'Glisser : déformer le coin · Maj : redimensionner',
  scale: 'Glisser : agrandir / réduire en gardant les proportions',
  rot: 'Glisser : pivoter · Maj : par pas de 15°',
  move: 'Glisser : déplacer · Double-clic : changer de vidéo · Molette : taille · Alt+molette : rotation',
  locked: 'Calque verrouillé · L pour le déverrouiller',
  none: 'Glisse une vidéo ici pour créer un calque · ? pour les raccourcis',
};
const CURSORS = { corner: 'crosshair', scale: 'zoom-in', rot: 'grab', move: 'move', locked: 'not-allowed', none: 'default' };
ov.addEventListener('pointerdown', e => {
  if (isLive() || e.button !== 0) return;
  const h = hitTest(e.offsetX, e.offsetY);
  if (!h) { select(-1); return; }
  if (h.i !== sel) select(h.i);
  selCorner = h.type === 'corner' ? h.k : -1;
  if (h.type === 'locked') return;
  const L = layers[h.i];
  drag = { type: h.type, k: h.k, start: [e.offsetX, e.offsetY], orig: L.corners.map(c => [...c]), c: centroidPx(L.corners) };
  ov.setPointerCapture(e.pointerId);
});
ov.addEventListener('pointermove', e => {
  const p = [e.offsetX, e.offsetY];
  if (!drag) {
    if (isLive()) return;
    const h = hitTest(...p), t = h ? h.type : 'none';
    hoverIdx = h ? h.i : -1;
    ov.style.cursor = CURSORS[t];
    setHint(HINTS[t]);
    return;
  }
  const L = layers[sel];
  if (drag.type === 'corner') {
    if (e.shiftKey) L.corners = scaleCorners(drag.orig, drag.c, dist(p, drag.c) / Math.max(1, dist(drag.start, drag.c)));
    else L.corners = drag.orig.map((c, j) => j === drag.k ? toN(p) : [...c]);
  } else if (drag.type === 'scale') {
    const f = dist(p, drag.c) / Math.max(1, dist(drag.start, drag.c));
    L.corners = scaleCorners(drag.orig, drag.c, f);
    setHint(`Échelle ${Math.round(f * 100)} %`);
  } else if (drag.type === 'move') {
    const dx = (p[0] - drag.start[0]) / vw(), dy = (p[1] - drag.start[1]) / vh();
    L.corners = drag.orig.map(([x, y]) => [x + dx, y + dy]);
  } else if (drag.type === 'rot') {
    let a = Math.atan2(p[1] - drag.c[1], p[0] - drag.c[0]) - Math.atan2(drag.start[1] - drag.c[1], drag.start[0] - drag.c[0]);
    if (e.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
    L.corners = rotateCorners(drag.orig, drag.c, a);
    let deg = Math.round(a * 180 / Math.PI) % 360;
    if (deg > 180) deg -= 360; else if (deg < -180) deg += 360;
    setHint(`Rotation ${deg > 0 ? '+' : ''}${deg}° · Maj : par pas de 15°`);
  }
});
ov.addEventListener('pointerup', () => { if (drag) save(); drag = null; });
ov.addEventListener('pointerleave', () => { if (!drag) { hoverIdx = -1; setHint(''); } });
ov.addEventListener('dblclick', e => {
  if (isLive()) return;
  const h = hitTest(e.offsetX, e.offsetY);
  if (h && h.type !== 'rot' && h.type !== 'corner') pickFor(layers[h.i]);
});
ov.addEventListener('wheel', e => {
  const L = layers[sel];
  if (isLive() || !L) return;
  e.preventDefault();
  if (L.locked) return;
  const d = e.deltaY || e.deltaX, c = centroidPx(L.corners);
  if (e.altKey) L.corners = rotateCorners(L.corners, c, (d > 0 ? 2 : -2) * Math.PI / 180);
  else L.corners = scaleCorners(L.corners, c, d < 0 ? 1.03 : 1 / 1.03);
  save();
}, { passive: false });

// Glisser-déposer : vidéo sur un calque = remplacement, ailleurs = nouveau calque ; image = fond.
addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
addEventListener('drop', e => {
  e.preventDefault();
  const files = [...e.dataTransfer.files];
  const h = isLive() ? null : hitTest(e.clientX, e.clientY);
  let target = h && layers[h.i];
  for (const f of files) {
    if (bgMissing() && f.name === bg.name) { setBg(f); continue; }
    if (f.type.startsWith('image/')) { setBg(f); continue; }
    if (!f.type.startsWith('video/')) { toast(f.name + ' : format non pris en charge'); continue; }
    const L = layers.find(L => fileMissing(L) && L.label === f.name) || target || addLayer();
    target = null;
    loadFile(L, f);
    select(layers.indexOf(L));
  }
  save();
});

// ---------- Projet : enregistrer / ouvrir / relier les fichiers ----------
async function exportProject() {
  const json = JSON.stringify(serialize(), null, 2);
  const name = 'mapping-' + new Date().toISOString().slice(0, 10) + '.json';
  if (window.showSaveFilePicker) {   // Chrome / Edge : choix de l'emplacement et du nom
    try {
      const h = await showSaveFilePicker({ suggestedName: name,
        types: [{ description: 'Projet de mapping', accept: { 'application/json': ['.json'] } }] });
      const w = await h.createWritable();
      await w.write(json); await w.close();
      toast('Projet enregistré : ' + h.name);
      return;
    } catch (e) { if (e.name === 'AbortError') return; }   // autre erreur : téléchargement classique
  }
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([json], { type: 'application/json' })), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('Projet enregistré : ' + name);
}
// Le fichier vient de l'extérieur : on ne garde que des valeurs valides, le reste prend sa valeur par défaut.
function parseProject(o) {
  if (!o || o.app !== 'mapping-video' || !Array.isArray(o.layers) || !o.layers.length)
    throw new Error('ce fichier n\'est pas un projet de mapping');
  const num = v => typeof v === 'number' && Number.isFinite(v);
  const unit = (v, d) => num(v) ? Math.min(1, Math.max(0, v)) : d;
  const oneOf = (v, list, d) => list.includes(v) ? v : d;
  const str = v => typeof v === 'string' ? v.slice(0, 255) : '';
  const quad = c => Array.isArray(c) && c.length === 4 && c.every(p => Array.isArray(p) && p.length === 2 && p.every(num))
    ? c.map(p => p.map(v => Math.min(10, Math.max(-10, v)))) : undefined;
  return {
    layers: o.layers.slice(0, 64).map(l => ({
      label: str(l?.label), camLabel: str(l?.camLabel), corners: quad(l?.corners),
      fit: oneOf(l?.fit, ['cover', 'contain', 'free'], 'free'), opacity: unit(l?.opacity, 1), volume: unit(l?.volume, 1),
      blur: num(l?.blur) ? Math.min(60, Math.max(0, Math.round(l.blur))) : 0,
      blend: oneOf(l?.blend, Object.keys(BLENDS), 'normal'),
      loop: l?.loop !== false, visible: l?.visible !== false, locked: l?.locked === true,
    })),
    bg: { color: /^#[0-9a-f]{6}$/i.test(o.bg?.color) ? o.bg.color : '#000000',
          fit: oneOf(o.bg?.fit, ['cover', 'contain', 'mosaic'], 'cover'), name: str(o.bg?.name) },
    step: num(o.step) ? Math.min(400, Math.max(10, Math.round(o.step))) : 50,
    grid: o.grid === true,
  };
}
function applyProject(p) {
  hideToast();   // finalise une éventuelle suppression en attente
  layers.splice(0).forEach(L => { release(L); gl.deleteTexture(L.tex); freeBlur(L); L.li.remove(); });
  p.layers.forEach(d => addLayer(d));
  clearBg();
  bg.color = p.bg.color; bg.fit = p.bg.fit; bg.name = p.bg.name;
  bgColor.value = bg.color;
  bgColor.dispatchEvent(new Event('input', { bubbles: true }));   // met à jour la pastille Coloris
  segSet($('#bgFitSeg'), bg.fit);
  refreshBg();
  stepIn.value = p.step;
  setGrid(p.grid);
  select(0); save();
}
$('#saveBtn').onclick = exportProject;
const resetDlg = $('#resetDlg');
$('#resetBtn').onclick = () => { resetDlg.returnValue = ''; resetDlg.showModal(); };
resetDlg.onclose = () => {   // scène vierge, comme au premier lancement
  if (resetDlg.returnValue !== 'reset') return;
  applyProject(parseProject({ app: 'mapping-video', layers: [{}] }));
  toast('Scène réinitialisée');
};
$('#openBtn').onclick = () => { const p = $('#projPick'); p.value = ''; p.click(); };
$('#projPick').onchange = async e => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    applyProject(parseProject(JSON.parse(await f.text())));
  } catch (err) {
    toast('Impossible d\'ouvrir ' + f.name + ' : ' + (err instanceof SyntaxError ? 'fichier JSON invalide' : err.message), { ms: 5000 });
    return;
  }
  const files = refreshLinkBtn(), cams = layers.filter(L => L.camLabel).length;
  const parts = [];
  if (files) parts.push(`${files} fichier${files > 1 ? 's' : ''} à relier`);
  if (cams) parts.push(`${cams} caméra${cams > 1 ? 's' : ''} : bouton caméra pour reconnecter`);
  toast('Projet ouvert' + (parts.length ? ' · ' + parts.join(' · ') : ''), {
    ms: 8000, action: files ? { label: 'Relier les fichiers', fn: openLinkPicker } : null });
};
function openLinkPicker() { const p = $('#linkPick'); p.value = ''; p.click(); }
$('#linkBtn').onclick = e => { e.preventDefault(); openLinkPicker(); };
$('#linkPick').onchange = e => {   // chaque fichier retrouve son calque (ou le fond) par son nom
  let linked = 0, unknown = 0;
  for (const f of e.target.files) {
    const L = layers.find(L => fileMissing(L) && L.label === f.name);
    if (L) { loadFile(L, f); linked++; }
    else if (bgMissing() && bg.name === f.name) { setBg(f); linked++; }
    else unknown++;
  }
  const left = refreshLinkBtn();
  toast(`${linked} fichier${linked > 1 ? 's' : ''} relié${linked > 1 ? 's' : ''}` +
        (left ? ` · ${left} encore à relier` : '') + (unknown ? ` · ${unknown} sans calque correspondant` : ''), { ms: 4000 });
};

// ---------- Clavier ----------
addEventListener('keydown', e => {
  if (e.key === 'Escape') { exitAll(); return; }
  const t = e.target;
  if (t.closest?.('input, select, textarea, dialog')) return;
  if (t.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase(), L = layers[sel];
  if (k === 'f') toggleFs();
  else if (k === 'h') setLive(!isLive());
  else if (k === 'g') setGrid(!showGrid);
  else if (e.key === '?') keysDlg.showModal();
  else if (k === ' ') { e.preventDefault(); togglePlay(L); }
  else if (/^[1-9]$/.test(k) && +k <= layers.length) select(+k - 1);
  else if (k === 'tab') {   // parcourt les 4 coins puis revient au calque entier
    e.preventDefault();
    if (sel < 0) select(0);
    else selCorner = selCorner === 3 ? -1 : selCorner + 1;
  }
  else if (!L) return;
  else if (k === 'l') toggleLock(L);
  else if (k === 'r') transform(L, 'reset');
  else if (k === '+' || k === '=') transform(L, 'zoom+');
  else if (k === '-') transform(L, 'zoom-');
  else if (k === 'pageup' || k === 'pagedown') { e.preventDefault(); moveLayer(L, k === 'pageup' ? 1 : -1); }
  else if (k.startsWith('arrow')) {
    e.preventDefault();
    if (!editable(L)) return;
    const d = e.shiftKey ? 10 : 1;
    const dx = (k === 'arrowleft' ? -d : k === 'arrowright' ? d : 0) / vw();
    const dy = (k === 'arrowup' ? -d : k === 'arrowdown' ? d : 0) / vh();
    L.corners = L.corners.map((c, j) => selCorner < 0 || j === selCorner ? [c[0] + dx, c[1] + dy] : c);
    save();
  }
});

// ---------- Rendu ----------
const hex = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16) / 255);
let frames = 0, fpsT = performance.now(), thumbT = 0;
function frame(now) {
  const live = isLive();
  gl.clearColor(...hex(bg.color), 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.uniform2f(U.res, glc.width, glc.height);
  drawBg();
  for (const L of layers) {
    if (!L.visible) continue;
    const v = L.video, has = hasMedia(L);
    if (!has && live) continue;                    // pas de mire vide en diffusion
    if (has && (L.dirty || L.alwaysDirty)) { upload(L.tex, v); L.dirty = false; L.blurDirty = true; }
    const blurred = has && L.blur > 0;
    if (blurred && (L.blurDirty || !L.blurBuf)) { blurLayer(L); L.blurDirty = false; }
    const [qw, qh] = quadSize(L.corners);
    drawQuad(blurred ? L.blurBuf.b.t : L.tex, L.corners, { has, grid: showGrid, alpha: L.opacity, blend: L.blend,
      s: has ? fitScale(L.fit, v.videoWidth, v.videoHeight, qw, qh) : [1, 1] });
  }
  drawOverlay(live);
  if (!live) updateMeter();
  if (now - thumbT > 250) { thumbT = now; layers.forEach(drawThumb); }
  frames++;
  if (now - fpsT > 500) { $('#fps').textContent = Math.round(frames * 1000 / (now - fpsT)) + ' images/s'; frames = 0; fpsT = now; }
  requestAnimationFrame(frame);
}
function drawThumb(L) {
  const c = L.tctx;
  if (hasMedia(L)) { c.drawImage(L.video, 0, 0, c.canvas.width, c.canvas.height); L.thumbOn = true; }
  else if (L.thumbOn) { c.clearRect(0, 0, c.canvas.width, c.canvas.height); L.thumbOn = false; }
}
function drawOverlay(live) {
  const w = vw(), h = vh();
  ctx.clearRect(0, 0, w, h);
  if (showGrid) drawGrid();
  if (live) return;
  ctx.strokeStyle = 'rgba(255,181,71,.55)'; ctx.lineWidth = 2;   // liseré ambre = mode édition
  ctx.strokeRect(1, 1, w - 2, h - 2);
  layers.forEach((L, i) => {
    const P = L.corners.map(toPx), isSel = i === sel;
    ctx.setLineDash(L.visible ? [] : [6, 5]);
    ctx.strokeStyle = isSel ? BEAM : i === hoverIdx ? 'rgba(255,255,255,.75)' : 'rgba(255,255,255,.35)';
    ctx.lineWidth = isSel ? 2 : 1;
    ctx.beginPath(); P.forEach(([x, y], j) => j ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.stroke();
    ctx.setLineDash([]);
    drawBadge(L, i, P[0]);
    if (!isSel || L.locked || !L.visible) return;
    const r = rotHandle(P), m = mid(P[0], P[1]);
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(...m); ctx.lineTo(...r); ctx.stroke();
    ctx.beginPath(); ctx.arc(r[0], r[1], 6, 0, Math.PI * 2);
    ctx.fillStyle = '#17181d'; ctx.fill(); ctx.stroke();
    edgeMids(P).forEach(([x, y]) => {   // ronds = proportionnel, carrés = déformation libre
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = BEAM; ctx.fill();
    });
    P.forEach(([x, y], j) => {
      ctx.fillStyle = j === selCorner ? BEAM : '#fff';
      ctx.fillRect(x - 5, y - 5, 10, 10);
      ctx.strokeRect(x - 5, y - 5, 10, 10);
    });
  });
}
function drawBadge(L, i, [x, y]) {   // numéro + état de lecture, en haut à gauche du calque
  const st = status(L);
  const icons = [[STATE_ICON[st], st === 'playing' ? PLAY : st === 'missing' ? BEAM : TEXT]];
  if (L.locked) icons.push(['lock', TEXT]);
  if (!L.visible) icons.push(['eye-off', TEXT]);
  const bx = x + 8, by = y + 8, bh = 22, bw = 24 + icons.length * 18;
  ctx.fillStyle = 'rgba(23,24,29,.88)';
  ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 6); ctx.fill();
  ctx.fillStyle = TEXT; ctx.font = '600 12px "Segoe UI", system-ui, sans-serif'; ctx.textBaseline = 'middle';
  ctx.fillText(String(i + 1), bx + 8, by + bh / 2 + 1);
  icons.forEach(([name, col], k) => {
    const img = iconImg(name, col);
    if (img.complete) ctx.drawImage(img, bx + 22 + k * 18, by + 4, 14, 14);
  });
}
function drawGrid() {
  const step = Math.max(10, +stepIn.value || 50), w = vw(), h = vh(), cx = w / 2, cy = h / 2;
  ctx.lineWidth = 1;
  // Grille centrée pour que le repère central tombe toujours sur une ligne.
  for (const [other, c, vert] of [[h, cx, true], [w, cy, false]]) {
    for (let k = -Math.ceil(c / step); k <= Math.ceil(c / step); k++) {
      const p = Math.round(c + k * step) + .5;
      ctx.strokeStyle = k % 5 === 0 ? 'rgba(255,255,255,.75)' : 'rgba(255,255,255,.3)';
      ctx.beginPath();
      vert ? (ctx.moveTo(p, 0), ctx.lineTo(p, other)) : (ctx.moveTo(0, p), ctx.lineTo(other, p));
      ctx.stroke();
    }
  }
  ctx.strokeStyle = '#f44'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.moveTo(0, cy); ctx.lineTo(w, cy);
  ctx.strokeRect(1, 1, w - 2, h - 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, Math.min(w, h) * .4, 0, Math.PI * 2); ctx.stroke();
}

// ---------- Démarrage ----------
(saved.layers?.length ? saved.layers : [{}]).forEach(d => addLayer(d));
if (saved.grid) setGrid(true);
refreshBg();
select(0);
requestAnimationFrame(frame);
