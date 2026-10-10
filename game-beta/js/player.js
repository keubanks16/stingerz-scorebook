import * as THREE from './vendor/three.module.min.js';
import { IMG } from './assets.js';

const V3 = THREE.Vector3;
const L1 = 0.92, L2 = 0.88;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

// ====================================================================================
// GS Baseball player look: stylized cartoon ballplayers with cel shading and ink outlines.
// Built from smooth shapes with painted textures (face, jersey, cap panels, pinstripe pants,
// socks, cleats, bat graphics, glove web). Every part hangs off the joints the animations
// drive (hips, legs, knees, spine, head, shoulders, elbows, hands), so all poses still work.
// ====================================================================================

// ---------- materials ----------
// Cel shading: a 4-step light ramp gives the flat "drawn" shading.
const RAMP = (() => {
  const d = new Uint8Array([78, 150, 215, 255]);
  const t = new THREE.DataTexture(d, d.length, 1, THREE.RedFormat); t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true; return t;
})();
let ENV = null, CAM = null;
const glossy = new Set();
const matCache = new Map();
// cache key for extra material options (textures by id, not by contents)
const xkey = (x) => (x ? Object.entries(x).map(([k, v]) => k + ':' + (v && v.isTexture ? v.uuid : String(v))).join(',') : '');
function toon(color, extra) {
  const k = 't' + color + xkey(extra);
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshToonMaterial({ color, gradientMap: RAMP, ...(extra || {}) }));
  return matCache.get(k);
}
const toonTex = (map, extra) => new THREE.MeshToonMaterial({ map, gradientMap: RAMP, ...(extra || {}) });
// Shiny things (helmet shell, bat, sunglass lenses, gold chain) use real reflections.
function shiny(color, rough = 0.2, metal = 0, envAmt = 1, extra) {
  const k = 'g' + color + rough + metal + envAmt + xkey(extra);
  if (!matCache.has(k)) { const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...(extra || {}) }); m.userData.env = envAmt; if (ENV) { m.envMap = ENV; m.envMapIntensity = envAmt; } glossy.add(m); matCache.set(k, m); }
  return matCache.get(k);
}
// Called once with the game's renderer: builds a small sky reflection map for the shiny parts.
export function initPlayerLook(renderer) {
  if (ENV || !renderer) return;
  const sc = new THREE.Scene();
  sc.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying vec3 vP; void main(){ float h = vP.y; vec3 top = vec3(0.55,0.74,0.98); vec3 hor = vec3(0.97,0.96,0.92); vec3 gr = vec3(0.20,0.30,0.16);'
      + ' vec3 c = h > 0.0 ? mix(hor, top, pow(h, 0.6)) : mix(hor, gr, pow(-h, 0.4));'
      + ' float sun = pow(max(dot(vP, normalize(vec3(-0.5,0.75,0.45))), 0.0), 220.0) * 18.0; gl_FragColor = vec4(c + sun, 1.0); }',
  })));
  const pm = new THREE.PMREMGenerator(renderer);
  ENV = pm.fromScene(sc, 0.02).texture; pm.dispose();
  for (const m of glossy) { m.envMap = ENV; m.envMapIntensity = m.userData.env; m.needsUpdate = true; }
}
// The camera, so players near it get ink outlines (far-away players skip them to stay fast).
export function setPlayerCamera(camera) { CAM = camera; }

// ---------- MJ Eubanks hero model ----------
// A detailed model made in Tripo, rigged here with the same joints as every other player so it
// moves with the game's animations. Built offline from the GLB (hero/mj.json + mj.bin + textures).
const HERO = { data: null, loading: null };
const isHeroName = (name) => /^m\.?\s*j\.?\s+eubanks$/i.test(String(name || '').trim());
export function loadHero(base = 'hero/') {
  if (HERO.loading) return HERO.loading;
  HERO.loading = (async () => {
    const meta = await (await fetch(base + 'mj.json')).json();
    const bin = await (await fetch(base + 'mj.bin')).arrayBuffer();
    const T = { float32: Float32Array, int8: Int8Array, uint8: Uint8Array, uint16: Uint16Array };
    const arr = (k) => { const l = meta.layout[k]; return new T[l.type](bin, l.offset, l.length); };
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(arr('position'), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(arr('normal'), 3, true));
    g.setAttribute('uv', new THREE.BufferAttribute(arr('uv'), 2));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(arr('skinIndex'), 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(arr('skinWeight'), 4, true));
    g.setIndex(new THREE.BufferAttribute(arr('index'), 1));
    g.computeBoundingSphere();
    const img = (u) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = base + u; });
    const [cImg, nImg] = await Promise.all([img('mj_color.jpg'), img('mj_normal.jpg')]);
    const tex = (im, srgb) => { if (!im) return null; const t = new THREE.Texture(im); t.flipY = false; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.needsUpdate = true; return t; };
    const mat = new THREE.MeshStandardMaterial({ map: tex(cImg, true), normalMap: tex(nImg, false), roughness: 0.62, metalness: 0 });
    mat.userData.env = 0.45; if (ENV) { mat.envMap = ENV; mat.envMapIntensity = 0.45; } glossy.add(mat);
    HERO.data = { meta, geo: g, mat };
    return HERO.data;
  })().catch((e) => { console.warn('hero model not loaded', e); HERO.loading = null; return null; });
  return HERO.loading;
}
export const heroReady = () => !!HERO.data;
export const isHeroPlayer = (name) => !!HERO.data && isHeroName(name);
// The back of MJ's jersey: name and number (the model's back is plain).
function heroBackTexture(name, num) {
  return canvasTex('heroback' + name + num, 512, 512, (g, W, H) => {
    g.clearRect(0, 0, W, H); g.textAlign = 'center'; g.textBaseline = 'middle';
    const last = String(name || '').split(' ').slice(-1)[0].toUpperCase();
    let fs = 78; g.font = `900 ${fs}px system-ui, sans-serif`; while (g.measureText(last).width > 430 && fs > 30) { fs -= 2; g.font = `900 ${fs}px system-ui, sans-serif`; }
    outlineText(g, last, W / 2, 90, '#ffffff', '#70bdf5', 9);
    g.font = '900 300px system-ui, sans-serif';
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillText(num, W / 2 + 8, 318);
    outlineText(g, num, W / 2, 310, '#ffffff', '#70bdf5', 18);
  });
}
const OUTLINE_NEAR = 70, _ow = new V3();
const _hv1 = new V3(), _hv2 = new V3(), _hv3 = new V3(), _hv4 = new V3(), _hv5 = new V3(), _hv6 = new V3(), _hv7 = new V3(), _hv8 = new V3(), _hq = new THREE.Quaternion(), _hq2 = new THREE.Quaternion();
const outlineMats = new Map();
function outlineMat(thick) {
  const k = thick.toFixed(4);
  if (!outlineMats.has(k)) outlineMats.set(k, new THREE.ShaderMaterial({
    side: THREE.BackSide, uniforms: { thick: { value: thick }, col: { value: new THREE.Color(0x1a1512) } },
    vertexShader: 'uniform float thick; void main(){ vec3 p = position + normalize(normal) * thick; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }',
    fragmentShader: 'uniform vec3 col; void main(){ gl_FragColor = vec4(col, 1.0); }',
  }));
  return outlineMats.get(k);
}

// ---------- geometry ----------
const geoCache = new Map();
function geo(key, make) { if (!geoCache.has(key)) geoCache.set(key, make()); return geoCache.get(key); }
const caps = (r, len, cs = 6, rs = 16) => geo(`k${r},${len},${cs},${rs}`, () => new THREE.CapsuleGeometry(r, len, cs, rs));
const sph = (r, w = 16, h = 12) => geo(`s${r},${w},${h}`, () => new THREE.SphereGeometry(r, w, h));
const cyl = (rt, rb, h, seg = 14) => geo(`c${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
const box = (x, y, z) => geo(`b${x},${y},${z}`, () => new THREE.BoxGeometry(x, y, z));
// a part: added to its joint group and later merged with same-material parts (fewer draw calls)
function part(parent, g, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.scale.set(sx, sy, sz);
  o.castShadow = true; o.userData.bake = true; parent.add(o); return o;
}
function mergeGeos(list) {
  let nv = 0, ni = 0;
  for (const g of list) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const g of list) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, vo * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, vo * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
    if (g.index) { const a = g.index.array; for (let i = 0; i < a.length; i++) idx[io + i] = a[i] + vo; io += a.length; }
    else { for (let i = 0; i < n; i++) idx[io + i] = vo + i; io += n; }
    vo += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1)); out.computeBoundingSphere();
  return out;
}
// Merge each group's direct mesh children that share a material into one mesh.
function bake(group) {
  const by = new Map();
  for (const c of group.children) if (c.isMesh && c.userData.bake) { const k = c.material.uuid + (c.userData.noOutline ? '-n' : ''); if (!by.has(k)) by.set(k, []); by.get(k).push(c); }
  for (const list of by.values()) {
    if (list.length < 2) continue;
    const gs = list.map((m) => { m.updateMatrix(); const g = m.geometry.clone(); g.applyMatrix4(m.matrix); return g; });
    const merged = new THREE.Mesh(mergeGeos(gs), list[0].material); merged.castShadow = true; merged.userData.noOutline = !!list[0].userData.noOutline;
    for (const g of gs) g.dispose();
    for (const m of list) group.remove(m);
    group.add(merged);
  }
  for (const c of group.children) if (!c.isMesh) bake(c);
}

// ---------- textures ----------
const texCache = new Map();
function canvasTex(key, w, h, draw, opts = {}) {
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (opts.wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  texCache.set(key, t); return t;
}
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function strHash(t) { let h = 2166136261; for (const ch of String(t)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; }
function fabric(g, w, h, seed, amt = 1) {
  const r = rng(seed);
  for (let i = 0; i < 22; i++) {
    const x = r() * w, ww = 20 + r() * 70, a = (0.025 + r() * 0.045) * amt;
    const gr = g.createLinearGradient(x - ww, 0, x + ww, 0);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, r() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a * 1.3})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - ww, 0, ww * 2, h);
  }
}
const outlineText = (g, text, x, y, fill, stroke, lw) => { g.lineJoin = 'round'; g.strokeStyle = stroke; g.lineWidth = lw; g.strokeText(text, x, y); g.fillStyle = fill; g.fillText(text, x, y); };

// Torso: a rounded barrel with one wrap-around jersey texture.
const TORSO_PROFILE = [[0.5, -0.1], [0.55, 0.22], [0.6, 0.66], [0.645, 1.02], [0.64, 1.24], [0.56, 1.42], [0.37, 1.55], [0.0, 1.62]];
const TY0 = -0.1, TY1 = 1.62, TZ = 0.72;
function torsoR(y) { const P = TORSO_PROFILE; for (let i = 1; i < P.length; i++) if (y <= P[i][1]) { const t = (y - P[i - 1][1]) / (P[i][1] - P[i - 1][1]); return lerp(P[i - 1][0], P[i][0], clamp(t, 0, 1)); } return 0; }
function torsoGeo() {
  return geo('torso', () => {
    const g = new THREE.LatheGeometry(TORSO_PROFILE.map(([r, y]) => new THREE.Vector2(r, y)), 48, Math.PI / 2);
    const pos = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setY(i, (pos.getY(i) - TY0) / (TY1 - TY0));
    g.scale(1, 1, TZ); g.computeVertexNormals();
    return g;
  });
}
function jerseyTexture(team, name, num, ump) {
  return canvasTex('j' + team.key + '|' + name + '|' + num + '|' + (ump ? 1 : 0), 1024, 512, (g, W, H) => {
    const yAt = (y) => (1 - (y - TY0) / (TY1 - TY0)) * H;
    const FX = W * 0.75, BX = W * 0.25;
    g.fillStyle = ump ? '#1b222c' : team.jersey; g.fillRect(0, 0, W, H);
    fabric(g, W, H, strHash(name + num), 1);
    const tuck = g.createLinearGradient(0, H * 0.86, 0, H); tuck.addColorStop(0, 'rgba(0,0,0,0)'); tuck.addColorStop(1, 'rgba(0,0,0,0.3)'); g.fillStyle = tuck; g.fillRect(0, H * 0.86, W, H * 0.14);
    if (ump) return;
    // V collar with piping and undershirt, button placket with piping and buttons
    g.fillStyle = team.trim; g.beginPath(); g.moveTo(FX - 78, 0); g.lineTo(FX, yAt(1.3)); g.lineTo(FX + 78, 0); g.closePath(); g.fill();
    g.fillStyle = team.jersey; g.beginPath(); g.moveTo(FX - 64, 0); g.lineTo(FX, yAt(1.345)); g.lineTo(FX + 64, 0); g.closePath(); g.fill();
    g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(FX - 56, 0); g.lineTo(FX, yAt(1.37)); g.lineTo(FX + 56, 0); g.closePath(); g.fill();
    g.fillStyle = team.trim; g.fillRect(FX - 19, yAt(1.3), 6, H); g.fillRect(FX + 13, yAt(1.3), 6, H);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(FX - 1, yAt(1.3), 2, H);
    for (let y = yAt(1.18); y < H * 0.9; y += 46) {
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.arc(FX + 1, y + 2, 8, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#eef2f6'; g.beginPath(); g.arc(FX, y, 8, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#9aa3ad'; g.beginPath(); g.arc(FX - 2.5, y, 1.6, 0, Math.PI * 2); g.arc(FX + 2.5, y, 1.6, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = team.trim; for (const x of [W * 0.5, 2, W - 2]) g.fillRect(x - 4, yAt(1.18), 8, H);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const logo = team.key === 'GS' && IMG.logoLight;
    if (logo) {
      const w = 230, h = w * logo.height / logo.width;
      g.globalAlpha = 0.45; g.filter = 'blur(3px)'; g.drawImage(logo, FX - w / 2 + 4, yAt(0.96) - h / 2 + 6, w, h); g.filter = 'none'; g.globalAlpha = 1;
      g.drawImage(logo, FX - w / 2, yAt(0.96) - h / 2, w, h);
    } else { g.font = 'italic 900 128px system-ui, sans-serif'; outlineText(g, team.abbr, FX, yAt(0.96), team.letter, team.outline, 14); }
    g.font = '900 70px system-ui, sans-serif'; outlineText(g, num, FX - 140, yAt(0.42), team.letter, team.outline, 9);
    const last = (name || '').split(' ').slice(-1)[0].toUpperCase();
    let fs = 56; g.font = `900 ${fs}px system-ui, sans-serif`; while (g.measureText(last).width > 290 && fs > 22) { fs -= 2; g.font = `900 ${fs}px system-ui, sans-serif`; }
    const tw = g.measureText(last).width; let cx = BX - tw / 2;
    for (const ch of last) { const cw = g.measureText(ch).width; const t = (cx + cw / 2 - BX) / (tw / 2 || 1); const y = yAt(1.2) + t * t * 14; g.save(); g.translate(cx + cw / 2, y); g.rotate(t * 0.16); outlineText(g, ch, 0, 0, team.letter, team.outline, 7); g.restore(); cx += cw; }
    g.font = '900 200px system-ui, sans-serif';
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillText(num, BX + 7, yAt(0.6) + 8);
    outlineText(g, num, BX, yAt(0.6), team.letter, team.outline, 16);
  });
}
// Head (built at R 0.92 and scaled by HEAD_S): one sphere with the face painted on.
const HEAD_R = 0.92, HEAD_Y = 0.8, HEAD_S = 0.8;
function faceTexture(skin, hair, ump, eyes) {
  return canvasTex('f' + skin + hair + (ump ? 1 : 0) + eyes, 1024, 512, (g, W, H) => {
    const X = (lon) => (0.25 + lon / 360) * W, Y = (lat) => (90 - lat) / 180 * H, S = W / 360;
    g.fillStyle = skin; g.fillRect(0, 0, W, H);
    const sh = g.createLinearGradient(0, Y(10), 0, Y(-75)); sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(0.55, 'rgba(120,40,10,0.05)'); sh.addColorStop(1, 'rgba(60,15,0,0.3)'); g.fillStyle = sh; g.fillRect(0, Y(10), W, H);
    // hair on the scalp at the top, sides and back
    const r = rng(strHash(hair + skin));
    g.fillStyle = hair; g.fillRect(0, 0, W, Y(14));
    const backPath = () => { g.beginPath(); g.moveTo(X(64), Y(16)); for (let lon = 64; lon <= 296; lon += 3) { const d = Math.min(lon - 64, 296 - lon); g.lineTo(X(lon), Y(Math.max(-30, 6 - d * 1.1))); } g.lineTo(X(296), Y(16)); g.closePath(); };
    g.save(); backPath(); g.fill(); g.translate(-W, 0); backPath(); g.fill(); g.restore();
    for (const s of [-1, 1]) { g.beginPath(); g.moveTo(X(s * 70), Y(16)); g.lineTo(X(s * 82), Y(16)); g.lineTo(X(s * 79), Y(-6)); g.lineTo(X(s * 72), Y(-1)); g.closePath(); g.fill(); }
    g.lineWidth = 1.4;
    for (let i = 0; i < 700; i++) { const lon = 60 + r() * 240, lat = 16 - r() * 40; const x = X(lon), y = Y(lat); g.strokeStyle = r() > 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.18)'; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 6, y + 10 + r() * 14); g.stroke(); }
    if (ump) return;
    for (const s of [-1, 1]) { const rg = g.createRadialGradient(X(s * 31), Y(-24), 0, X(s * 31), Y(-24), 11 * S); rg.addColorStop(0, 'rgba(255,105,105,0.30)'); rg.addColorStop(1, 'rgba(255,105,105,0)'); g.fillStyle = rg; g.fillRect(X(s * 31) - 12 * S, Y(-12), 24 * S, 24 * S); }
    const iris = eyes || '#5a3a20';
    for (const s of [-1, 1]) {
      const ex = X(s * 19), ey = Y(-7), rx = 10.5 * S, ry = 12.2 * S;
      g.fillStyle = '#fbfbf8'; g.beginPath(); g.ellipse(ex, ey, rx, ry, 0, 0, Math.PI * 2); g.fill();
      g.save(); g.beginPath(); g.ellipse(ex, ey, rx, ry, 0, 0, Math.PI * 2); g.clip();
      const ix = ex - s * 1.2 * S, iy = ey + 1.4 * S;
      const ig = g.createRadialGradient(ix, iy + 3 * S, 1, ix, iy, 8 * S);
      ig.addColorStop(0, new THREE.Color(iris).offsetHSL(0, 0, 0.18).getStyle()); ig.addColorStop(0.7, iris); ig.addColorStop(1, new THREE.Color(iris).offsetHSL(0, 0, -0.18).getStyle());
      g.fillStyle = ig; g.beginPath(); g.ellipse(ix, iy, 7.8 * S, 8.6 * S, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 1.2 * S; g.stroke();
      g.fillStyle = '#0b0603'; g.beginPath(); g.ellipse(ix, iy, 4 * S, 4.6 * S, 0, 0, Math.PI * 2); g.fill();
      const ls = g.createLinearGradient(0, ey - ry, 0, ey - ry * 0.2); ls.addColorStop(0, 'rgba(60,20,0,0.4)'); ls.addColorStop(1, 'rgba(60,20,0,0)'); g.fillStyle = ls; g.fillRect(ex - rx, ey - ry, rx * 2, ry);
      g.restore();
      g.fillStyle = '#ffffff'; g.beginPath(); g.ellipse(ix + s * 2.4 * S, iy - 3.2 * S, 2.3 * S, 2.6 * S, 0, 0, Math.PI * 2); g.fill();
      // upper lid: thick ink line, heavier toward the outside, slightly hooded for a confident look
      g.strokeStyle = '#1a100a'; g.lineCap = 'round'; g.lineWidth = 3.4 * S;
      g.beginPath(); g.ellipse(ex, ey + 1.2 * S, rx + 0.4 * S, ry - 0.6 * S, 0, Math.PI * (s > 0 ? 1.08 : 1.1), Math.PI * (s > 0 ? 1.9 : 1.92)); g.stroke();
      g.strokeStyle = 'rgba(90,40,20,0.4)'; g.lineWidth = 1.2 * S; g.beginPath(); g.ellipse(ex, ey, rx, ry, 0, Math.PI * 0.2, Math.PI * 0.8); g.stroke();
      // brow: thick, a little arched
      g.strokeStyle = hair; g.lineWidth = 4.6 * S;
      g.beginPath(); g.moveTo(X(s * 8), Y(9 + (s > 0 ? 1.5 : 0))); g.quadraticCurveTo(X(s * 19), Y(15 + (s > 0 ? 1.5 : 0)), X(s * 31), Y(10.5)); g.stroke();
    }
    const nz = g.createRadialGradient(X(1.5), Y(-24), 0, X(1.5), Y(-24), 6 * S); nz.addColorStop(0, 'rgba(110,40,10,0.30)'); nz.addColorStop(1, 'rgba(110,40,10,0)'); g.fillStyle = nz; g.fillRect(X(-6), Y(-18), 12 * S, 12 * S);
    // confident smirk
    g.strokeStyle = '#5e2416'; g.lineWidth = 2.6 * S; g.lineCap = 'round';
    g.beginPath(); g.moveTo(X(-9), Y(-34)); g.quadraticCurveTo(X(1), Y(-38.5), X(10), Y(-31.5)); g.stroke();
    g.lineWidth = 1.6 * S; g.beginPath(); g.moveTo(X(10), Y(-31.5)); g.lineTo(X(11.5), Y(-30.2)); g.stroke();
    const ch = g.createRadialGradient(X(0), Y(-46), 0, X(0), Y(-46), 7 * S); ch.addColorStop(0, 'rgba(110,40,10,0.12)'); ch.addColorStop(1, 'rgba(110,40,10,0)'); g.fillStyle = ch; g.fillRect(X(-8), Y(-39), 16 * S, 16 * S);
  });
}
// Cap crown: six panels with seams, stitching and eyelets.
function capTexture(color) {
  return canvasTex('cap' + color, 1024, 256, (g, W, H) => {
    g.fillStyle = color; g.fillRect(0, 0, W, H); fabric(g, W, H, strHash(color), 0.6);
    for (let k = 0; k < 6; k++) {
      const x = ((0.25 + 1 / 12 + k / 6) % 1) * W;
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x - 2, 0, 4, H);
      g.strokeStyle = 'rgba(255,255,255,0.2)'; g.setLineDash([6, 6]); g.lineWidth = 1.5;
      for (const dx of [-7, 7]) { g.beginPath(); g.moveTo(x + dx, 10); g.lineTo(x + dx, H); g.stroke(); }
      g.setLineDash([]);
      const ex = ((0.25 + k / 6) % 1) * W; g.fillStyle = 'rgba(0,0,0,0.45)'; g.beginPath(); g.arc(ex, H * 0.38, 5, 0, Math.PI * 2); g.fill();
    }
  });
}
// Pinstripe pants with team piping down the sides. Capsule sides are at u 0.25 and 0.75.
function pantsTexture(team, ump, shift = 0) {
  return canvasTex('p' + team.key + (ump ? 'u' : '') + shift, 512, 256, (g, W, H) => {
    g.fillStyle = ump ? '#5d636d' : team.pants; g.fillRect(0, 0, W, H); fabric(g, W, H, strHash(team.key + shift), 0.9);
    if (ump) return;
    g.fillStyle = team.key === 'GS' ? 'rgba(11,43,83,0.55)' : 'rgba(126,37,54,0.45)';
    for (let x = 0; x < W; x += 18) g.fillRect(x, 0, 2.2, H);
    for (const u of [0.25 + shift, 0.75 + shift]) { const x = (u % 1) * W; g.fillStyle = team.trim; g.fillRect(x - 6, 0, 12, H); g.fillStyle = team.jersey; g.fillRect(x - 2, 0, 4, H); }
  });
}
function sockTexture(team, ump) {
  return canvasTex('k' + team.key + (ump ? 'u' : ''), 128, 256, (g, W, H) => {
    g.fillStyle = ump ? '#15181d' : team.sock; g.fillRect(0, 0, W, H); fabric(g, W, H, strHash(team.sock), 0.7);
    if (!ump) { g.fillStyle = '#ffffff'; g.fillRect(0, H * 0.14, W, H * 0.05); g.fillStyle = team.trim; g.fillRect(0, H * 0.22, W, H * 0.05); }
  });
}
// Cleats: team color with white camo splashes
function cleatTexture(base, splash) {
  return canvasTex('cl' + base + splash, 256, 128, (g, W, H) => {
    g.fillStyle = base; g.fillRect(0, 0, W, H);
    const r = rng(strHash(base));
    for (let i = 0; i < 26; i++) { g.fillStyle = r() > 0.4 ? splash : 'rgba(255,255,255,0.35)'; g.beginPath(); const x = r() * W, y = r() * H; g.moveTo(x, y); for (let k = 0; k < 5; k++) g.lineTo(x + (r() - 0.3) * 40, y + (r() - 0.5) * 22); g.closePath(); g.fill(); }
  }, { wrap: true });
}
function webTexture(color) {
  return canvasTex('w' + color, 128, 128, (g, W, H) => {
    g.fillStyle = color; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 6; for (let i = -W; i < W * 2; i += 26) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + H, H); g.stroke(); g.beginPath(); g.moveTo(i, H); g.lineTo(i + H, 0); g.stroke(); }
  }, { wrap: true });
}
// Jewelry and shades each kid can pick on his player card.
export const SHADES = { blue: { lens: ['#1b2a8c', '#2e8ff0', '#5fe0ff', '#a879ff'], frame: '#f4f6f8' }, red: { lens: ['#5a0d12', '#d8262c', '#ff7a2f', '#ffd04a'], frame: '#16181c' }, black: { lens: ['#050608', '#1b1f2a', '#2d2f3d', '#4a3b5e'], frame: '#16181c' }, gold: { lens: ['#5a3608', '#c9861c', '#ffcf4d', '#ffe9a8'], frame: '#16181c' } };
export const CHAINS = { gold: ['#f0bd3d', 0.28, 1, 1.2], silver: ['#e3e7ec', 0.22, 1, 1.3], ice: ['#f6faff', 0.04, 1, 2.2] };
export const EARRINGS = { diamond: ['#f6faff', 0.03, 1, 2.4], gold: ['#f0bd3d', 0.25, 1, 1.2] };
const pickOpt = (v, table, def) => (v === true || v === 'on' ? def : (v && table[v] ? v : null));
function lensTexture(kind) {
  return canvasTex('lens' + kind, 64, 128, (g, W, H) => {
    const c = SHADES[kind].lens, gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, c[0]); gr.addColorStop(0.45, c[1]); gr.addColorStop(0.75, c[2]); gr.addColorStop(1, c[3]);
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(0, H * 0.18, W, 3);   // glare streak
  });
}
// sparkle for iced-out chains: tiny bright stones along the tube
function iceTexture() {
  return canvasTex('ice', 256, 16, (g, W, H) => {
    g.fillStyle = '#dfe6ee'; g.fillRect(0, 0, W, H);
    for (let x = 2; x < W; x += 6) { g.fillStyle = '#ffffff'; g.beginPath(); g.arc(x, H / 2, 2.4, 0, Math.PI * 2); g.fill(); g.fillStyle = '#9fb2c8'; g.fillRect(x + 2.6, 0, 0.8, H); }
  }, { wrap: true });
}
const BAT_PROFILE = [[0.0, 0.0], [0.105, 0.0], [0.11, 0.04], [0.06, 0.09], [0.055, 0.5], [0.06, 0.95], [0.085, 1.4], [0.112, 1.8], [0.118, 2.3], [0.116, 2.52], [0.09, 2.57], [0.0, 2.58]];
function batGeo() {
  return geo('bat2', () => {
    const g = new THREE.LatheGeometry(BAT_PROFILE.map(([r, y]) => new THREE.Vector2(r, y)), 18);
    const pos = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setY(i, pos.getY(i) / 2.58);
    g.computeVertexNormals(); return g;
  });
}
function batTexture(team) {
  return canvasTex('bat' + team.key, 256, 1024, (g, W, H) => {
    const Y = (y) => (1 - y / 2.58) * H;
    g.fillStyle = team.key === 'GS' ? '#16335f' : '#3a3f47'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#d5dae0'; g.fillRect(0, Y(2.5), W, Y(2.2) - Y(2.5));
    g.fillStyle = team.trim; g.fillRect(0, Y(2.18), W, 10); g.fillRect(0, Y(1.5), W, 10);
    g.save(); g.translate(W * 0.25, Y(1.85)); g.rotate(-Math.PI / 2); g.font = 'italic 900 64px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#ffffff'; g.fillText(team.key === 'GS' ? 'STINGERZ' : team.abbr, 0, 0); g.restore();
    g.fillStyle = '#151515'; g.fillRect(0, Y(0.95), W, H - Y(0.95));
    g.strokeStyle = 'rgba(255,255,255,0.10)'; g.lineWidth = 6; for (let y = Y(0.95); y < H; y += 22) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y + 22); g.stroke(); }
    g.fillStyle = team.trim; g.fillRect(0, H - 24, W, 24);
  });
}
function brimGeo(rx, rz, thick, bend) {
  return geo(`brim${rx},${rz},${thick},${bend}`, () => {
    const s = new THREE.Shape(); s.moveTo(-rx, 0);
    for (let i = 0; i <= 24; i++) { const a = Math.PI - (i / 24) * Math.PI; s.lineTo(Math.cos(a) * rx, Math.sin(a) * rz); }
    s.lineTo(-rx, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2, curveSegments: 24 });
    g.rotateX(Math.PI / 2);
    const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i); p.setY(i, p.getY(i) - bend * x * x); }
    g.computeVertexNormals(); return g;
  });
}
// A chain draped around the neck and down the chest (spine coords), as a tube.
function chainGeo(drop, out) {
  return geo('chain' + drop, () => {
    const pts = [];
    for (let i = 0; i < 28; i++) {
      const phi = (i / 28) * Math.PI * 2, f = Math.abs(Math.atan2(Math.sin(phi), Math.cos(phi))) / Math.PI;   // 0 front .. 1 back
      const y = 1.56 - drop * Math.pow(1 - f, 1.6);
      const r = Math.max(torsoR(y), 0.3) + out;
      pts.push(new V3(Math.sin(phi) * r, y, Math.cos(phi) * r * TZ + (f > 0.6 ? 0 : out * 0.4)));
    }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 120, 0.034, 6, true);
  });
}
let decalMat = null;
function logoDecal(parent, w, x, y, z, tiltX) {
  if (!IMG.logoLight) return null;
  if (!decalMat) { const t = new THREE.Texture(IMG.logoLight); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.needsUpdate = true; decalMat = new THREE.MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }); }
  const h = w * IMG.logoLight.height / IMG.logoLight.width;
  const m = new THREE.Mesh(geo(`dec${w}`, () => new THREE.PlaneGeometry(w, h)), decalMat); m.position.set(x, y, z); m.rotation.x = tiltX || 0; m.userData.noOutline = true; parent.add(m); return m;
}

// Legs a little shorter than the animations were built for. Poses still set hip height for
// full-length legs; the hips' y is remapped (see constructor) and hand targets drop to match.
const LEGF = 0.9;
const EYES = ['#5a3a20', '#3b2414', '#4c6a2f', '#3f6f9e', '#6b4a1e'];

export class Player3D {
  constructor(o) {
    this.o = o; // {name,num,team,skin,hair,bats,throws,role,shades,chain,ears,bracelet}
    const team = o.team, ump = o.role === 'ump', isC = o.role === 'C', gsTeam = team.key === 'GS';
    this.root = new THREE.Group();
    const skinC = o.skin || '#d9a77e', hairC = o.hair || '#2b1d12';
    const eyes = EYES[strHash(o.name || 'x') % EYES.length];
    const skin = toon(skinC);
    const jerseyM = toon(ump ? '#1b222c' : team.jersey);
    const sleeveM = toon(ump ? '#1b222c' : team.trim);
    const trimM = toon(ump ? '#2c333d' : team.trim);
    const beltM = toon(ump ? '#111111' : team.trim), loopM = toon('#f2f2ee'), metal = shiny('#d6dbe1', 0.2, 1, 1);
    const pantsM = toonTex(pantsTexture(team, ump)), pelvisM = toonTex(pantsTexture(team, ump, 0.25)), sockM = toonTex(sockTexture(team, ump));
    const shoeM = ump ? toon('#151515') : toonTex(cleatTexture(team.trim, '#ffffff')), soleM = toon('#f6f6f2'), accentM = toon(ump ? '#222222' : team.jersey), laceM = toon('#ffffff');
    const darkPad = toon('#2a2f37');

    // ---- hips and legs ----
    this.hips = new THREE.Group(); this.root.add(this.hips);
    { let raw = 2.65; this.legDrop = (raw - 0.1) * (1 - LEGF);
      Object.defineProperty(this.hips.position, 'y', { configurable: true, get: () => (raw - 0.1) * LEGF + 0.1, set: (v) => { raw = v; this.legDrop = (v - 0.1) * (1 - LEGF); } }); }
    this.hips.position.y = 2.65;
    part(this.hips, geo('pelvis', () => new THREE.SphereGeometry(0.54, 28, 18).scale(1.08, 0.66, 0.8)), pelvisM, 0, -0.04, 0);
    part(this.hips, geo('belt', () => new THREE.CylinderGeometry(0.545, 0.545, 0.14, 32, 1, false).scale(1.05, 1, 0.8)), beltM, 0, 0.19, 0);
    part(this.hips, box(0.18, 0.12, 0.05), metal, 0, 0.19, 0.45);
    for (const a of [-1.15, -0.55, 0.55, 1.15, Math.PI]) part(this.hips, box(0.05, 0.17, 0.035), loopM, Math.sin(a) * 0.575, 0.19, Math.cos(a) * 0.45, 0, a, 0);
    this.gearParts = [];
    const leg = (x) => {
      const g = new THREE.Group(); g.position.set(x, -0.1, 0); this.hips.add(g);
      const F = LEGF, foot = -1.335 * F;
      part(g, caps(0.28, 0.74 * F), pantsM, 0, -0.6 * F, 0);
      const k = new THREE.Group(); k.position.y = -1.25 * F; g.add(k);
      // knickers: the pant leg blouses just below the knee over high socks
      part(k, geo('blouse', () => new THREE.SphereGeometry(0.27, 18, 12).scale(1, 1.15, 1)), pantsM, 0, -0.18, 0);
      part(k, geo('cuff', () => new THREE.TorusGeometry(0.2, 0.045, 8, 20).rotateX(Math.PI / 2)), pantsM, 0, -0.42, 0);
      part(k, caps(0.17, 0.5), sockM, 0, foot * 0.55, 0);
      if (isC) {
        const gd = new THREE.Group(); k.add(gd); this.gearParts.push(gd);
        part(gd, geo('guard', () => new THREE.CapsuleGeometry(0.23, 0.5, 4, 14).scale(1, 1, 0.82)), darkPad, 0, foot * 0.5, 0.07);
        part(gd, geo('kneecap', () => new THREE.SphereGeometry(0.23, 14, 10).scale(1, 0.9, 0.8)), darkPad, 0, -0.08, 0.12);
        for (const y of [0.25, 0.5, 0.75]) part(gd, box(0.38, 0.035, 0.08), trimM, 0, foot * y, 0.28);
      }
      const sole = foot + 0.06;
      part(k, geo('shoeup', () => new THREE.CapsuleGeometry(0.2, 0.42, 6, 16).rotateX(Math.PI / 2).scale(1.12, 0.78, 1)), shoeM, 0, sole + 0.15, 0.14);
      part(k, geo('midsole', () => new THREE.CapsuleGeometry(0.225, 0.46, 4, 16).rotateX(Math.PI / 2).scale(1.1, 0.3, 1)), soleM, 0, sole + 0.02, 0.14);
      part(k, geo('heel', () => new THREE.SphereGeometry(0.18, 14, 10).scale(1.12, 0.85, 0.7)), accentM, 0, sole + 0.15, -0.2);
      part(k, geo('collar', () => new THREE.TorusGeometry(0.15, 0.04, 6, 16).rotateX(Math.PI / 2)), accentM, 0, sole + 0.3, -0.04);
      for (let i = 0; i < 4; i++) part(k, box(0.2, 0.025, 0.04), laceM, 0, sole + 0.3 - i * 0.015, 0.12 + i * 0.075, -0.4);
      for (const z of [-0.12, 0.12, 0.36]) for (const s of [-1, 1]) part(k, cyl(0.025, 0.012, 0.06, 6), darkPad, s * 0.13, sole - 0.09, z);
      return [g, k];
    };
    [this.legL, this.kneeL] = leg(0.26); [this.legR, this.kneeR] = leg(-0.26);

    // ---- torso ----
    this.spine = new THREE.Group(); this.spine.position.y = 0.2; this.hips.add(this.spine);
    part(this.spine, torsoGeo(), toonTex(jerseyTexture(team, o.name, o.num, ump)), 0, 0, 0);
    part(this.spine, cyl(0.19, 0.22, 0.32, 16), skin, 0, 1.62, 0.02);   // neck
    part(this.spine, geo('collar', () => new THREE.TorusGeometry(0.3, 0.05, 8, 24).rotateX(Math.PI / 2).scale(1, 1, 0.8)), ump ? jerseyM : sleeveM, 0, 1.54, 0);
    const chain = ump ? null : pickOpt(o.chain, CHAINS, 'gold');
    if (chain) {
      const [cc, cr, cm, ce] = CHAINS[chain];
      const cm1 = shiny(cc, cr, cm, ce, chain === 'ice' ? { map: iceTexture(), emissive: '#3a4250' } : undefined);
      part(this.spine, chainGeo(0.48, 0.035), cm1, 0, 0, 0).userData.noOutline = true;
      part(this.spine, chainGeo(0.62, 0.05), cm1, 0, 0, 0).userData.noOutline = true;
      const pz = torsoR(0.86) * TZ + 0.06;
      part(this.spine, box(0.16, 0.19, 0.04), shiny(cc, cr, cm, ce), 0, 0.86, pz).userData.noOutline = true;
      if (gsTeam) logoDecal(this.spine, 0.14, 0, 0.86, pz + 0.025, 0);
    }
    if (isC) {
      const cp = new THREE.Group(); this.spine.add(cp); this.gearParts.push(cp);
      part(cp, geo('chestpad', () => new THREE.SphereGeometry(0.62, 24, 16).scale(1, 1.18, 0.42)), darkPad, 0, 0.78, 0.27);
      part(cp, geo('chesttrim', () => new THREE.TorusGeometry(0.6, 0.04, 6, 32).scale(1, 1.18, 1)), trimM, 0, 0.78, 0.31);
      for (const y of [0.45, 0.78, 1.1]) part(cp, box(0.86, 0.03, 0.08), toon('#3a404a'), 0, y, 0.52);
      for (const g of this.gearParts) g.visible = false;
    }

    // ---- head (designed at R 0.92, scaled by HEAD_S) ----
    this.head = new THREE.Group(); this.head.position.y = 1.62; this.spine.add(this.head);
    const hd = new THREE.Group(); hd.scale.setScalar(HEAD_S); hd.position.y = -0.02; this.head.add(hd);
    part(hd, geo('head', () => new THREE.SphereGeometry(HEAD_R, 48, 32).scale(1, 0.98, 0.93)), toonTex(faceTexture(skinC, hairC, ump, eyes)), 0, HEAD_Y, 0);
    part(hd, geo('nose', () => new THREE.SphereGeometry(0.1, 14, 10).scale(0.9, 0.8, 0.95)), skin, 0, HEAD_Y - 0.34, 0.82);
    for (const s of [-1, 1]) {
      part(hd, geo('ear', () => new THREE.SphereGeometry(0.18, 14, 12).scale(0.45, 1, 0.75)), skin, s * HEAD_R * 0.97, HEAD_Y - 0.1, -0.02, 0, s * 0.25, 0);
      part(hd, geo('earin', () => new THREE.SphereGeometry(0.095, 10, 8).scale(0.3, 1, 0.7)), toon(new THREE.Color(skinC).multiplyScalar(0.78).getStyle()), s * (HEAD_R * 0.97 + 0.05), HEAD_Y - 0.1, 0.0, 0, s * 0.25, 0);
    }
    // flow: locks of hair curling out under the cap at the back and sides
    const hairM = toon(hairC), hr = rng(strHash((o.name || '') + hairC));
    const lockG = geo('lock', () => new THREE.CapsuleGeometry(0.12, 0.3, 4, 10).translate(0, -0.2, 0).scale(1, 1, 0.7));
    for (let i = 0; i < 15; i++) {
      const a = (-1.62 + (i / 14) * 3.24) + (hr() - 0.5) * 0.1;   // around the back (0 = straight back)
      const side = Math.abs(a) / 1.62;
      const m = part(hd, lockG, hairM, Math.sin(a) * HEAD_R * 0.9, HEAD_Y + 0.06 - side * 0.08, -Math.cos(a) * HEAD_R * 0.84, 0, 0, 0, 0.95, 0.55 + (1 - side) * 0.6 + hr() * 0.15, 0.95);
      m.rotation.order = 'YXZ'; m.rotation.set(0.32 + (1 - side) * 0.22 + hr() * 0.12, -a, (hr() - 0.5) * 0.35);
    }
    // cap: paneled crown, curved brim, button, GS logo
    this.cap = new THREE.Group(); this.cap.position.set(0, HEAD_Y + 0.22, -0.02); this.cap.rotation.x = -0.04; hd.add(this.cap);
    const capColor = ump ? '#151b24' : team.cap;
    const capM = toon(capColor);
    part(this.cap, geo('crown', () => new THREE.SphereGeometry(HEAD_R * 1.06, 48, 18, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.86, 0.97)), toonTex(capTexture(capColor)), 0, 0, 0);
    part(this.cap, brimGeo(0.64, 0.72, 0.05, 0.24), capM, 0, 0.03, 0.66, 0.08);
    part(this.cap, sph(0.075, 12, 8), capM, 0, HEAD_R * 1.06 * 0.86, 0);
    if (gsTeam && !ump) logoDecal(this.cap, 0.64, 0, 0.46, 0.82, -0.52);
    // batting helmet: glossy shell, back skirt, ear flap toward the pitcher, visor, vents, logo
    this.helmet = new THREE.Group(); this.helmet.position.set(0, HEAD_Y + 0.13, -0.03); hd.add(this.helmet);
    const helM = shiny(team.helmet || team.cap, 0.14, 0, 1.0);
    const HR = HEAD_R * 1.13;
    part(this.helmet, geo('helm', () => new THREE.SphereGeometry(HR, 48, 20, 0, Math.PI * 2, 0, Math.PI * 0.52).scale(1, 0.95, 1)), helM, 0, 0, 0);
    part(this.helmet, geo('helmback', () => new THREE.SphereGeometry(HR, 32, 6, Math.PI * 0.95, Math.PI * 1.1, Math.PI * 0.52, Math.PI * 0.17)), helM, 0, 0, 0);
    part(this.helmet, brimGeo(0.56, 0.36, 0.05, 0.12), helM, 0, -0.05, HR * 0.9, 0.12);
    const fs = o.bats === 'L' ? -1 : 1;
    part(this.helmet, geo('flap', () => new THREE.SphereGeometry(0.46, 18, 14).scale(0.32, 0.9, 0.78)), helM, fs * HR * 0.86, -0.44, -0.04, 0, 0, fs * 0.08);
    for (const s of [-1, 1]) part(this.helmet, geo('vent', () => new THREE.CapsuleGeometry(0.035, 0.16, 3, 8).rotateX(Math.PI / 2)), toon('#0c0f14'), s * 0.42, HR * 0.78, -0.25, -0.4, 0, s * 0.3);
    if (gsTeam) logoDecal(this.helmet, 0.7, 0, 0.56, HR * 0.86, -0.58);
    this.helmet.visible = false;
    // wraparound shades with a mirrored lens
    const shades = ump ? null : pickOpt(o.shades, SHADES, 'blue');
    if (shades) {
      const sg = new THREE.Group(); sg.position.y = HEAD_Y - 0.13; hd.add(sg);
      const frame = toon(SHADES[shades].frame, { side: THREE.DoubleSide });
      part(sg, geo('lens', () => new THREE.CylinderGeometry(HEAD_R * 1.04, HEAD_R * 1.01, 0.42, 40, 1, true, -1.2, 2.4).scale(1, 1, 0.98)), shiny('#ffffff', 0.1, 0, 0.55, { map: lensTexture(shades), side: THREE.DoubleSide }), 0, 0, 0);
      part(sg, geo('frame', () => new THREE.CylinderGeometry(HEAD_R * 1.07, HEAD_R * 1.07, 0.05, 40, 1, true, -1.75, 3.5).scale(1, 1, 0.98)), frame, 0, 0.22, 0);
      part(sg, box(0.12, 0.08, 0.06), frame, 0, 0.15, HEAD_R * 1.0);
    }
    // earrings: a stud on each ear lobe
    const ears = ump ? null : pickOpt(o.ears, EARRINGS, 'diamond');
    if (ears) {
      const em = shiny(...EARRINGS[ears]);
      for (const s of [-1, 1]) part(hd, geo('stud', () => new THREE.OctahedronGeometry(0.065, 1)), em, s * (HEAD_R * 0.97 + 0.07), HEAD_Y - 0.25, 0.02).userData.noOutline = true;
    }
    // catcher's helmet with cage (the umpire gets the mask with his cap)
    if (isC || ump) {
      this.ctch = new THREE.Group(); this.ctch.position.set(0, HEAD_Y, 0); hd.add(this.ctch);
      const cM = ump ? toon('#16191e') : shiny(team.helmet || team.cap, 0.16, 0, 1.0), bar = shiny('#4a505a', 0.3, 0.8, 0.8), pad = toon('#16181c');
      if (!ump) {
        part(this.ctch, geo('cdome', () => new THREE.SphereGeometry(HEAD_R * 1.08, 40, 16, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(1, 0.95, 1)), cM, 0, 0.16, -0.04);
        part(this.ctch, geo('cback', () => new THREE.SphereGeometry(HEAD_R * 1.08, 28, 8, Math.PI * 0.9, Math.PI * 1.2, Math.PI * 0.5, Math.PI * 0.32)), cM, 0, 0.16, -0.04);
        if (gsTeam) logoDecal(this.ctch, 0.55, 0, 0.82, 0.55, -0.95);
      }
      for (const s of [-1, 1]) part(this.ctch, geo('cpad', () => new THREE.CapsuleGeometry(0.12, 0.5, 4, 10).scale(1, 1, 0.6)), pad, s * 0.62, -0.25, 0.48, 0, s * -0.6, 0);
      for (const [y, w] of [[0.2, 1.0], [-0.02, 0.95], [-0.24, 0.86], [-0.46, 0.66]]) part(this.ctch, geo('cbar' + y, () => new THREE.TorusGeometry(0.9 * w, 0.034, 6, 28, Math.PI * 0.62)), bar, 0, y, 0.04, Math.PI / 2, 0, Math.PI * 0.19);
      for (const x of [-0.3, 0, 0.3]) part(this.ctch, cyl(0.032, 0.032, 0.78, 8), bar, x, -0.14, 0.88 - Math.abs(x) * 0.18, 0.12);
      this.ctch.visible = false;
    }

    // ---- arms: jersey sleeve with trim; a compression sleeve on the throwing arm, bare glove arm ----
    this.throwsL = o.throws === 'L';
    this.hands = []; this.skinMat = skin; this.batGloveMat = toon(gsTeam ? '#f4f6f8' : '#f0ece4');
    const arm = (x) => {
      const side = x > 0 ? 1 : -1, left = x > 0;
      const throwing = left === this.throwsL;
      const armM = ump ? jerseyM : (throwing && gsTeam ? sleeveM : skin);
      const s = new THREE.Group(); s.position.set(x, 1.3, 0); this.spine.add(s);
      part(s, caps(0.25, 0.22), jerseyM, 0, -0.18, 0);
      if (!ump) part(s, geo('sleevetrim', () => new THREE.TorusGeometry(0.225, 0.035, 8, 24).rotateX(Math.PI / 2)), trimM, 0, -0.44, 0);
      part(s, caps(0.165, 0.62), armM, 0, -0.52, 0);
      const e = new THREE.Group(); e.position.y = -L1; s.add(e);
      part(e, caps(0.15, 0.54), armM, 0, -0.37, 0);
      if (!ump && !throwing) part(e, cyl(0.16, 0.155, 0.16, 18), toon(team.jersey), 0, -0.72, 0);   // wristband
      const brace = ump ? null : pickOpt(o.bracelet, CHAINS, 'gold');
      if (brace && throwing) part(e, geo('bracelet', () => new THREE.TorusGeometry(0.165, 0.032, 8, 24).rotateX(Math.PI / 2)), shiny(...CHAINS[brace].slice(0, 4), brace === 'ice' ? { map: iceTexture(), emissive: '#3a4250' } : undefined), 0, -0.74, 0, 0.15).userData.noOutline = true;
      const h = new THREE.Group(); h.position.y = -L2; e.add(h);
      const hm = new THREE.Group(); h.add(hm);
      part(hm, geo('palm', () => new THREE.SphereGeometry(0.19, 18, 14).scale(1, 1.12, 0.8)), skin, 0, -0.03, 0);
      part(hm, caps(0.065, 0.12, 4, 10), skin, side * 0.16, 0.0, 0.06, 0, 0, side * 0.6);
      part(hm, geo('knuckles', () => new THREE.CapsuleGeometry(0.07, 0.19, 4, 10).rotateZ(Math.PI / 2)), skin, 0, -0.16, 0.04);
      this.hands.push(hm);
      return [s, e, h];
    };
    [this.shL, this.elL, this.handL] = arm(0.7); [this.shR, this.elR, this.handR] = arm(-0.7);

    // ---- fielding glove: tan leather, finger stalls, thumb, laced web, lacing, wrist strap, patch ----
    const gloveHand = this.throwsL ? this.handR : this.handL;
    const gs = this.throwsL ? -1 : 1;
    const leather = toon(isC ? '#25252a' : '#c98f48'), leatherDk = toon(isC ? '#141417' : '#8d5a26'), lace = toon(isC ? '#c9a46a' : '#5e3517');
    this.glove = new THREE.Group(); this.glove.position.set(0, -0.14, 0.1); gloveHand.add(this.glove);
    if (isC) {
      part(this.glove, geo('cmitt', () => new THREE.SphereGeometry(0.5, 24, 18).scale(1, 1.05, 0.5)), leather, 0, -0.08, 0);
      part(this.glove, geo('crim', () => new THREE.TorusGeometry(0.47, 0.06, 8, 32).scale(1, 1.05, 1)), leatherDk, 0, -0.08, 0.06);
      part(this.glove, geo('cpocket', () => new THREE.SphereGeometry(0.26, 16, 12).scale(1, 1, 0.3)), leatherDk, 0, -0.08, 0.18);
      for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; part(this.glove, sph(0.035, 6, 4), lace, Math.cos(a) * 0.47, -0.08 + Math.sin(a) * 0.5, 0.11); }
      part(this.glove, caps(0.1, 0.3, 4, 10), leather, gs * 0.42, 0.06, 0.04, 0, 0, gs * 0.5);
    } else {
      part(this.glove, geo('pocket', () => new THREE.SphereGeometry(0.38, 24, 18).scale(1, 1.45, 0.48)), leather, -gs * 0.03, -0.2, 0);
      part(this.glove, geo('palmpad', () => new THREE.SphereGeometry(0.24, 16, 12).scale(1, 1.3, 0.3)), leatherDk, -gs * 0.02, -0.18, 0.15);
      for (let i = 0; i < 4; i++) part(this.glove, caps(0.11, 0.3, 4, 12), leather, -gs * (i - 1.0) * 0.135, -0.62 + Math.abs(i - 1.5) * 0.06, -0.01, 0, 0, -gs * (i - 1.5) * 0.08);
      for (let i = 0; i < 7; i++) part(this.glove, sph(0.03, 6, 4), lace, -gs * (-0.12 + i * 0.07), -0.86 + Math.abs(i - 3) * 0.02, 0.06);
      part(this.glove, caps(0.1, 0.36, 4, 12), leather, gs * 0.38, -0.2, 0.02, 0, 0, gs * 0.55);
      part(this.glove, geo('web', () => new THREE.SphereGeometry(0.2, 12, 10).scale(1, 1.1, 0.25)), toonTex(webTexture('#a86d32')), gs * 0.26, -0.45, 0.03, 0, 0, gs * 0.4);
      part(this.glove, geo('grim', () => new THREE.TorusGeometry(0.36, 0.022, 6, 32, Math.PI * 1.25).scale(1, 1.05, 1)), lace, 0, -0.05, 0.1, 0, 0, Math.PI * 0.87);
      part(this.glove, geo('strap', () => new THREE.CapsuleGeometry(0.11, 0.3, 4, 10).rotateZ(Math.PI / 2)), leatherDk, 0, 0.26, 0.06);
      part(this.glove, box(0.18, 0.11, 0.03), toon('#d23c3c'), 0, 0.26, 0.17);
    }
    if (ump) this.glove.visible = false;

    // ---- bat ----
    this.grip = new THREE.Group(); this.root.add(this.grip);
    part(this.grip, batGeo(), shiny('#ffffff', 0.22, 0.2, 0.9, { map: batTexture(team) }), 0, -0.04, 0);
    this.grip.visible = false;

    this.anim = { name: 'idle', t: 0 };
    this.phase = Math.random() * 6;
    this.speed = 0;
    this.heading = 0;
    bake(this.root);
    this.hands = this.hands.map((g) => g.children.filter((c) => c.isMesh)).flat();
    // ink outlines: an inflated back-face copy of each mesh, thickness kept even across scaled groups
    this.outlines = [];
    this.root.updateMatrixWorld(true);
    const ws = new V3(), meshes = [];
    this.root.traverse(c => { if (c.isMesh) meshes.push(c); });
    for (const c of meshes) {
      c.castShadow = true;
      if (c.userData.noOutline || c.material.transparent) continue;
      c.getWorldScale(ws);
      const ol = new THREE.Mesh(c.geometry, outlineMat(0.026 / ws.x)); ol.castShadow = false; ol.userData.outline = true;
      c.add(ol); this.outlines.push(ol);
    }
    this.outlineOn = true;
    if (ump) this.setHeadgear('ump');
    if (gsTeam && isHeroName(o.name) && HERO.data) this.buildHero(HERO.data);
    if (o.scale) this.root.scale.setScalar(o.scale);
  }
  get pos() { return this.root.position; }
  setHeadgear(kind) {
    const ump = this.o.role === 'ump';
    const c = (kind === 'catcher' || ump) && this.ctch;
    this.cap.visible = kind === 'cap' || ump; this.helmet.visible = !ump && (kind === 'helmet' || (kind === 'catcher' && !c));
    if (this.ctch) this.ctch.visible = !!c;
    for (const g of this.gearParts) g.visible = kind === 'catcher' && !ump;
  }
  setOutlines(on) { on = !!on && !this._ghost; if (on === this.outlineOn) return; this.outlineOn = on; for (const m of this.outlines) m.visible = on; }
  // See-through (used for the catcher and umpire in the batting view, so they don't hide the pitch).
  setGhost(on) {
    on = !!on; if (on === !!this._ghost) return; this._ghost = on;
    this.root.traverse(m => {
      if (!m.isMesh || m.userData.outline) return;
      if (on) { m.userData.solid = m.material; const c = m.material.clone(); c.transparent = true; c.opacity = 0.3; c.depthWrite = false; m.material = c; }
      else if (m.userData.solid) { m.material.dispose(); m.material = m.userData.solid; m.userData.solid = null; }
    });
    this.outlineOn = !on; for (const m of this.outlines) m.visible = !on;
  }
  showBat(v) { this.grip.visible = v; if (this.o.role !== 'ump') this.glove.visible = !v; for (const h of this.hands) h.material = v ? this.batGloveMat : this.skinMat; }

  face(dx, dz, dt, rate = 10) {
    if (Math.abs(dx) + Math.abs(dz) < 1e-4) return;
    const target = Math.atan2(dx, dz);
    let d = target - this.root.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
    this.root.rotation.y += dt ? d * Math.min(1, dt * rate) : d;
  }
  faceToward(x, z, dt, rate) { this.face(x - this.pos.x, z - this.pos.z, dt, rate); }
  play(name, opts = {}) { if (this.anim.name === name && !opts.restart) { Object.assign(this.anim, opts); return; } this.anim = { name, t: 0, ...opts }; }
  // world position of throwing hand / glove
  handWorld(out, glove = false) {
    if (this.hero) { const H = this.hero; return (glove ? (this.throwsL ? H.palmR : H.palmL) : (this.throwsL ? H.palmL : H.palmR)).getWorldPosition(out); }
    const throwHand = this.throwsL ? this.handL : this.handR;
    const h = glove ? (this.throwsL ? this.handR : this.handL) : throwHand;
    return h.getWorldPosition(out);
  }
  // ---- hero model (MJ) ----
  buildHero(data) {
    const { meta, geo, mat } = data;
    // hide the regular body; keep the bat and glove
    const keep = new Set(); this.grip.traverse((c) => keep.add(c)); this.glove.traverse((c) => keep.add(c));
    this.root.traverse((c) => { if (c.isMesh && !keep.has(c)) c.visible = false; });
    const bones = meta.bones.map((b) => { const o = new THREE.Bone(); o.name = b.name; o.position.fromArray(b.pos); return o; });
    meta.bones.forEach((b, i) => { if (b.parent >= 0) bones[b.parent].add(bones[i]); });
    const B = Object.fromEntries(bones.map((b) => [b.name, b]));
    const hr = new THREE.Group(); this.root.add(hr); hr.add(B.hips);
    B.shL.rotation.z = Math.PI / 2; B.shR.rotation.z = -Math.PI / 2;    // bind pose: T-pose
    const mesh = new THREE.SkinnedMesh(geo, mat); mesh.castShadow = true; mesh.frustumCulled = false; mesh.userData.noOutline = true; hr.add(mesh);
    hr.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(bones));
    B.shL.rotation.z = 0; B.shR.rotation.z = 0;
    // name and number on the back
    const back = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62), new THREE.MeshBasicMaterial({ map: heroBackTexture(this.o.name, this.o.num), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    back.position.set(0, 0.42, meta.backZ - 0.03); back.rotation.y = Math.PI; B.spine.add(back);
    // palms (ball holding) and the glove on the glove hand; the model's own glove hand shrinks under it
    const palm = (h) => { const o = new THREE.Object3D(); o.position.set(0, -0.32, 0.04); h.add(o); return o; };
    const gHand = this.throwsL ? B.handR : B.handL, gEl = this.throwsL ? B.elR : B.elL;
    gHand.scale.setScalar(0.35);
    this.glove.parent && this.glove.parent.remove(this.glove);
    this.glove.position.set(0, gHand.position.y - 0.16, 0.1); this.glove.scale.setScalar(1.05); gEl.add(this.glove);
    (this.throwsL ? B.handL : B.handR).scale.setScalar(0.85);
    this.hero = { B, mesh, root: hr, palmL: palm(B.handL), palmR: palm(B.handR), hipY: meta.bones[0].pos[1], legY: meta.legY || meta.bones[0].pos[1], l1: meta.upper, l2: meta.fore, r: meta.armLen / (L1 + L2) };
    if (this.throwsL) this.hero.palmR = this.glove; else this.hero.palmL = this.glove;
    this.grip.scale.set(1, meta.batScale || 1.14, 1);   // a slightly longer bat makes up for his shorter arms
  }
  // Each frame: copy the game skeleton's pose onto the hero bones, then reach the hands to the
  // same spots (scaled to his shorter arms) so the bat, ball and glove line up.
  heroSync() {
    const H = this.hero, B = H.B;
    this.root.updateMatrixWorld(true);
    const raw = (this.hips.position.y - 0.1) / LEGF + 0.1;
    // crouching lowers the hips by the same share of his leg length as the game skeleton's
    B.hips.position.y = H.hipY - H.legY * (1 - (raw - 0.1) / 2.55);
    B.hips.quaternion.copy(this.hips.quaternion); B.spine.quaternion.copy(this.spine.quaternion); B.head.quaternion.copy(this.head.quaternion);
    B.legL.quaternion.copy(this.legL.quaternion); B.legR.quaternion.copy(this.legR.quaternion);
    B.kneeL.quaternion.copy(this.kneeL.quaternion); B.kneeR.quaternion.copy(this.kneeR.quaternion);
    H.root.updateMatrixWorld(true);
    // map points from the game skeleton (relative to the middle of its shoulders) onto the hero
    const cMy = _hv1.copy(this.shL.getWorldPosition(_hv2)).add(this.shR.getWorldPosition(_hv3)).multiplyScalar(0.5);
    const cH = _hv4.copy(B.shL.getWorldPosition(_hv2)).add(B.shR.getWorldPosition(_hv3)).multiplyScalar(0.5);
    // sideways and forward reach scale to his shorter arms; heights stay the same so the bat
    // still comes through at the ball's height
    const map = (wp) => { wp.sub(cMy); wp.x *= H.r; wp.z *= H.r; return wp.add(cH); };
    if (this.grip.visible) { const g = map(this.grip.getWorldPosition(_hv5)); this.root.worldToLocal(g); this.grip.position.copy(g); }
    for (const [mySh, myEl, myHand, sh, el] of [[this.shL, this.elL, this.handL, B.shL, B.elL], [this.shR, this.elR, this.handR, B.shR, B.elR]]) {
      const t = map(myHand.getWorldPosition(_hv5));
      // pole: the side the game skeleton's elbow points to
      const s0 = mySh.getWorldPosition(_hv6), e0 = myEl.getWorldPosition(_hv7), h0 = myHand.getWorldPosition(_hv8);
      const dir = _hv8.sub(s0).normalize(); const off = e0.sub(s0); off.addScaledVector(dir, -off.dot(dir)).negate();
      B.spine.worldToLocal(t);
      _hq.copy(B.spine.getWorldQuaternion(_hq2)).invert(); off.applyQuaternion(_hq);
      if (off.lengthSq() < 1e-6) off.set(0, 0, -1);
      this.ikLen(sh, el, t, off, H.l1, H.l2);
    }
    H.root.updateMatrixWorld(true);
  }
  ikLen(sh, el, target, pole, l1, l2) {
    _d.subVectors(target, sh.position); let dist = _d.length(); _d.normalize();
    dist = clamp(dist, 0.12, l1 + l2 - 0.01);
    const A = Math.acos(clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1));
    const C = Math.acos(clamp((l1 * l1 + l2 * l2 - dist * dist) / (2 * l1 * l2), -1, 1));
    _p.copy(pole).addScaledVector(_d, -pole.dot(_d)); if (_p.lengthSq() < 1e-6) _p.set(0, 0, 1); _p.normalize();
    _u.copy(_d).multiplyScalar(Math.cos(A)).addScaledVector(_p, -Math.sin(A));
    _y.copy(_u).negate();
    _z.copy(_p).addScaledVector(_u, -_p.dot(_u)).normalize();
    _x.crossVectors(_y, _z);
    _m.makeBasis(_x, _y, _z); sh.quaternion.setFromRotationMatrix(_m);
    el.rotation.set(-(Math.PI - C), 0, 0);
  }
  // ---- low level pose helpers ----
  reset() {
    this.hips.position.y = 2.65; this.hips.rotation.set(0, 0, 0);
    this.spine.rotation.set(0, 0, 0); this.head.rotation.set(0, 0, 0);
    this.legL.rotation.set(0, 0, 0); this.legR.rotation.set(0, 0, 0); this.kneeL.rotation.set(0, 0, 0); this.kneeR.rotation.set(0, 0, 0);
    this.armFK(this.shL, this.elL, 0.05, 0, 0.12, -0.25); this.armFK(this.shR, this.elR, 0.05, 0, -0.12, -0.25);
  }
  armFK(sh, el, x, y, z, elbow) { sh.quaternion.setFromEuler(_e.set(x, y, z)); el.rotation.set(elbow, 0, 0); }
  // 2-bone IK; target in spine-local coords
  ik(sh, el, target, pole) {
    _d.subVectors(target, sh.position); let dist = _d.length(); _d.normalize();
    dist = clamp(dist, 0.25, L1 + L2 - 0.02);
    const A = Math.acos(clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1));
    const C = Math.acos(clamp((L1 * L1 + L2 * L2 - dist * dist) / (2 * L1 * L2), -1, 1));
    _p.copy(pole).addScaledVector(_d, -pole.dot(_d)); if (_p.lengthSq() < 1e-6) _p.set(0, 0, 1); _p.normalize();
    _u.copy(_d).multiplyScalar(Math.cos(A)).addScaledVector(_p, -Math.sin(A));
    _y.copy(_u).negate();
    _z.copy(_p).addScaledVector(_u, -_p.dot(_u)).normalize();
    _x.crossVectors(_y, _z);
    _m.makeBasis(_x, _y, _z); sh.quaternion.setFromRotationMatrix(_m);
    el.rotation.set(-(Math.PI - C), 0, 0);
  }
  // hand to a point given in ROOT-local coords
  handTo(left, rootPt, pole, world) {
    _w.copy(rootPt); if (!world) _w.y -= this.legDrop; this.root.localToWorld(_w); this.spine.worldToLocal(_w);
    if (left) this.ik(this.shL, this.elL, _w, pole || _poleL); else this.ik(this.shR, this.elR, _w, pole || _poleR);
  }
  update(dt) {
    const a = this.anim; a.t += dt;
    this.reset();
    const fn = this['pose_' + a.name] || this.pose_idle;
    fn.call(this, a, dt);
    // outlines only for players near the camera
    if (CAM) { this.root.getWorldPosition(_ow); this.setOutlines(_ow.distanceTo(CAM.position) < OUTLINE_NEAR); }
    if (this.hero) this.heroSync();
  }
  // ---- poses ----
  pose_idle() { this.armFK(this.shL, this.elL, -0.1, 0, 0.15, -0.4); this.armFK(this.shR, this.elR, -0.1, 0, -0.15, -0.4); }
  pose_ready(a) {
    const bob = Math.sin(a.t * 3) * 0.02;
    this.hips.position.y = 2.25 + bob; this.spine.rotation.x = 0.45;
    this.legL.rotation.set(-0.55, 0, 0.32); this.legR.rotation.set(-0.55, 0, -0.32);
    this.kneeL.rotation.x = 0.95; this.kneeR.rotation.x = 0.95;
    this.root.updateMatrixWorld(true);
    this.handTo(true, _v.set(0.35, 2.0, 0.95)); this.handTo(false, _v.set(-0.35, 2.0, 0.95));
  }
  pose_stand(a) {
    this.armFK(this.shL, this.elL, -0.25, 0, 0.12, -0.9); this.armFK(this.shR, this.elR, -0.25, 0, -0.12, -0.9);
  }
  pose_run(a, dt) {
    const sp = this.speed;
    this.phase += dt * (3.5 + sp * 0.33);
    const ph = this.phase, k = clamp(sp / 22, 0.25, 1);
    this.hips.position.y = 2.6 + Math.abs(Math.sin(ph)) * 0.12 * k - 0.08;
    this.spine.rotation.x = 0.12 + 0.18 * k;
    this.legL.rotation.x = -Math.sin(ph) * 0.95 * k; this.legR.rotation.x = Math.sin(ph) * 0.95 * k;
    this.kneeL.rotation.x = 0.25 + 1.3 * k * Math.max(0, Math.cos(ph)); this.kneeR.rotation.x = 0.25 + 1.3 * k * Math.max(0, -Math.cos(ph));
    this.armFK(this.shL, this.elL, Math.sin(ph) * 0.9 * k, 0, 0.1, -1.5); this.armFK(this.shR, this.elR, -Math.sin(ph) * 0.9 * k, 0, -0.1, -1.5);
    this.head.rotation.x = -0.1;
  }
  pose_catcher(a) {
    this.hips.position.y = 1.1; this.spine.rotation.x = 0.4;
    this.legL.rotation.set(-1.45, 0, 0.55); this.legR.rotation.set(-1.45, 0, -0.55);
    this.kneeL.rotation.x = 2.35; this.kneeR.rotation.x = 2.35;
    this.root.updateMatrixWorld(true);
    const g = a.glove || _v2.set(0, 2.5, 3);
    // glove target given in world; convert to root
    _w2.copy(g); this.root.worldToLocal(_w2);
    this.handTo(!this.throwsL, _w2, _poleUp, true);
    this.handTo(this.throwsL, _v.set(this.throwsL ? 0.6 : -0.6, 1.6, 0.3));
  }
  pose_ump() {
    this.hips.position.y = 1.9; this.spine.rotation.x = 0.55;
    this.legL.rotation.set(-0.95, 0, 0.45); this.legR.rotation.set(-0.95, 0, -0.45);
    this.kneeL.rotation.x = 1.5; this.kneeR.rotation.x = 1.5;
    this.root.updateMatrixWorld(true);
    this.handTo(true, _v.set(0.5, 1.75, 0.55)); this.handTo(false, _v.set(-0.5, 1.75, 0.55));
  }
  // batter: a.s (0 = stance) swing progress; a.aimY
  batterBase(s) {
    this.hips.position.y = 2.4; this.spine.rotation.x = 0.22;
    this.legL.rotation.set(-0.15, 0, 0.3 * s); this.legR.rotation.set(-0.15, 0, -0.3 * s);
    this.kneeL.rotation.x = 0.4; this.kneeR.rotation.x = 0.4;
  }
  pose_stance(a) {
    const s = this.o.bats === 'L' ? -1 : 1;
    this.batterBase(1);
    const sway = Math.sin(a.t * 2.2) * 0.05;
    this.spine.rotation.y = -0.35 * s; this.head.rotation.y = 1.15 * s - this.spine.rotation.y; this.head.rotation.x = 0.05;
    this.setGrip(KEYS[0], s, 0, sway);
    this.handsOnBat(s);
  }
  pose_swing(a) {
    const s = this.o.bats === 'L' ? -1 : 1;
    // progress: from 0.18 to 0.5 in 0.10s, then 0.5 -> 1 in 0.32s
    const t = a.t < 0.1 ? lerp(0.18, 0.5, a.t / 0.1) : Math.min(1, 0.5 + (a.t - 0.1) / 0.64);
    this.batterBase(1);
    this.spine.rotation.y = lerp(-0.35, 1.5, ease(clamp(t * 1.1, 0, 1))) * s;
    this.hips.rotation.y = lerp(0, 0.9, clamp(t * 1.6 - 0.3, 0, 1)) * s;
    this.head.rotation.y = 1.15 * s - this.spine.rotation.y * 0.6;
    this.legL.rotation.z = 0.3; this.legR.rotation.z = -0.3;
    this.kneeR.rotation.x = s > 0 ? lerp(0.4, 0.9, t) : 0.4; this.kneeL.rotation.x = s < 0 ? lerp(0.4, 0.9, t) : 0.4;
    this.setGrip(sampleKeys(t), s, (a.aimY || 2.4) - 2.5, 0);
    this.handsOnBat(s);
  }
  pose_bunt(a) {
    const s = this.o.bats === 'L' ? -1 : 1;
    this.batterBase(1); this.spine.rotation.y = 0.9 * s; this.hips.rotation.y = 0.5 * s; this.head.rotation.y = 0.5 * s;
    this.setGrip({ g: [0.35, 3.2, 0.8], d: [-1, 0.12, 0.25] }, s, (a.aimY || 2.4) - 2.5, 0, true);
    this.handsOnBat(s, true);
  }
  setGrip(k, s, dy, sway, bunt) {
    const yOff = clamp(dy, -1, 1) * 0.85;
    // the bat sits lower with the shorter legs, and rises back to the ball's height at contact
    const drop = bunt ? 0 : this.legDrop * (1 - (k.w == null ? 0 : k.w));
    this.grip.position.set(k.g[0] * s, k.g[1] + (bunt ? yOff : yOff * contactWeight(k)) + sway - drop, k.g[2]);
    _d.set(k.d[0] * s, k.d[1] - (bunt ? 0 : yOff * 0.35 * contactWeight(k)), k.d[2]).normalize();
    this.grip.quaternion.setFromUnitVectors(_up, _d);
    this.root.updateMatrixWorld(true);
  }
  handsOnBat(s, bunt) {
    this.grip.updateMatrixWorld(true);
    // bottom hand at knob, top hand above; bunt: top hand slides up the barrel
    const bottomLeft = s > 0; // RHB: left hand bottom
    _w.set(0, 0.12, 0); this.grip.localToWorld(_w); this.root.worldToLocal(_w);
    _w2.set(0, bunt ? 1.2 : 0.38, 0); this.grip.localToWorld(_w2); this.root.worldToLocal(_w2);
    this.handTo(bottomLeft, _w, null, true); this.handTo(!bottomLeft, _w2, null, true);
  }
  // pitcher delivery; a.dur
  pose_pitch(a) {
    const s = this.throwsL ? -1 : 1; // RHP s=1 throwing hand = right = local -x
    const t = clamp(a.t / (a.dur || 1), 0, 1);
    const k = samplePitch(t);
    this.hips.position.y = 2.65 - k.drop;
    this.spine.rotation.x = k.lean; this.spine.rotation.y = k.yaw * s;
    this.hips.rotation.y = k.hy * s;
    const lead = s > 0 ? [this.legL, this.kneeL] : [this.legR, this.kneeR];
    const back = s > 0 ? [this.legR, this.kneeR] : [this.legL, this.kneeL];
    lead[0].rotation.x = k.lt; lead[1].rotation.x = k.lk; back[0].rotation.x = k.bt; back[1].rotation.x = k.bk;
    this.root.updateMatrixWorld(true);
    this.handTo(s < 0, _v.set(k.h[0] * -s, k.h[1], k.h[2]), s > 0 ? _poleThrowR : _poleThrowL);
    this.handTo(s > 0, _v.set(k.g[0] * -s, k.g[1], k.g[2]));
    this.head.rotation.y = -this.spine.rotation.y * 0.8;
  }
  pose_throw(a) {
    const s = this.throwsL ? -1 : 1;
    const t = clamp(a.t / (a.dur || 0.5), 0, 1);
    this.hips.position.y = 2.55; this.spine.rotation.x = lerp(0, 0.45, ease(t));
    this.spine.rotation.y = lerp(-0.8, 0.6, ease(t)) * s;
    this.legL.rotation.x = s > 0 ? -0.5 : 0.3; this.legR.rotation.x = s > 0 ? 0.3 : -0.5; this.kneeL.rotation.x = 0.4; this.kneeR.rotation.x = 0.4;
    this.root.updateMatrixWorld(true);
    let h;
    if (t < 0.45) h = [lerpA([0.3, 3.7, 0.6], [1.25, 4.45, -0.55], t / 0.45)];
    else if (t < 0.6) h = [lerpA([1.25, 4.45, -0.55], [0.45, 4.6, 1.15], (t - 0.45) / 0.15)];
    else h = [lerpA([0.45, 4.6, 1.15], [-0.45, 2.9, 1.0], (t - 0.6) / 0.4)];
    this.handTo(s < 0, _v.set(h[0][0] * -s, h[0][1], h[0][2]), s > 0 ? _poleThrowR : _poleThrowL);
    this.handTo(s > 0, _v.set(-0.75 * -s, 3.75, 0.85));
  }
  pose_catch(a) {
    // glove reaching toward a.glove (world)
    this.hips.position.y = a.low ? 2.0 : 2.5; this.spine.rotation.x = a.low ? 0.6 : 0.15;
    if (a.low) { this.legL.rotation.x = -0.6; this.legR.rotation.x = -0.6; this.kneeL.rotation.x = 1; this.kneeR.rotation.x = 1; }
    this.root.updateMatrixWorld(true);
    _w2.copy(a.glove || _v2.set(0, 4, 2)); this.root.worldToLocal(_w2);
    // short legs: hop up for high balls so the glove still gets there
    const reach = this.hips.position.y + 0.2 + 1.3 + 1.55;
    if (_w2.y > reach) { this.hips.position.y = (a.low ? 2.0 : 2.5) + Math.min(1.4, _w2.y - reach) / LEGF; this.legL.rotation.x = -0.3; this.kneeL.rotation.x = 0.9; this.root.updateMatrixWorld(true); }
    this.handTo(!this.throwsL, _w2, null, true);
    this.handTo(this.throwsL, _v.set(this.throwsL ? 0.5 : -0.5, 3.6, 0.6));
  }
  pose_celebrate(a) {
    const j = Math.abs(Math.sin(a.t * 7)) * 0.4;
    this.root.position.y = (this.baseY || 0) + j;
    this.armFK(this.shL, this.elL, -2.9, 0, 0.3, -0.2); this.armFK(this.shR, this.elR, -2.9, 0, -0.3, -0.2);
  }
  pose_slide(a) {
    this.hips.position.y = 0.6; this.spine.rotation.x = -1.1;
    this.legL.rotation.x = -1.4; this.legR.rotation.x = -1.2; this.kneeR.rotation.x = 1.3;
    this.armFK(this.shL, this.elL, -2.6, 0, 0.3, 0); this.armFK(this.shR, this.elR, -2.6, 0, -0.3, 0);
  }
}
const _e = new THREE.Euler(), _d = new V3(), _u = new V3(), _p = new V3(), _x = new V3(), _y = new V3(), _z = new V3(), _m = new THREE.Matrix4();
const _w = new V3(), _w2 = new V3(), _v = new V3(), _v2 = new V3(), _up = new V3(0, 1, 0);
const _poleL = new V3(-0.45, 1, 0.35), _poleR = new V3(0.45, 1, 0.35), _poleUp = new V3(0, 1, 0.3);
// throwing arm: forearm points up, elbow out to the side at about shoulder height
const _poleThrowR = new V3(0.6, 1, 0.1), _poleThrowL = new V3(-0.6, 1, 0.1);
const lerpA = (a, b, t) => a.map((v, i) => lerp(v, b[i], clamp(t, 0, 1)));

// batting keyframes in root frame (RHB, facing +z toward plate; pitcher at +x)
const KEYS = [
  { t: 0, g: [-0.5, 4.15, 0.25], d: [-0.35, 0.85, -0.45] },
  { t: 0.3, g: [-0.38, 3.75, 0.55], d: [-0.95, 0.3, -0.2] },
  { t: 0.5, g: [0.05, 3.2, 1.0], d: [0.25, 0.08, 1.0] },
  { t: 0.7, g: [0.55, 3.55, 0.7], d: [1.0, 0.25, -0.25] },
  { t: 1, g: [0.3, 4.2, -0.15], d: [-0.3, 0.45, -0.85] },
];
function contactWeight(k) { return k.w == null ? 1 : k.w; }
function sampleKeys(t) {
  let i = 0; while (i < KEYS.length - 2 && t > KEYS[i + 1].t) i++;
  const a = KEYS[i], b = KEYS[i + 1], u = clamp((t - a.t) / (b.t - a.t), 0, 1);
  const w = 1 - Math.min(1, Math.abs(t - 0.5) / 0.3);
  return { g: lerpA(a.g, b.g, u), d: lerpA(a.d, b.d, u), w };
}
// pitching keyframes (RHP, facing +z). h = throwing hand (x mirrored to -x in code), g = glove hand
const PK = [
  { t: 0, h: [0.15, 3.85, 0.55], g: [0.1, 3.85, 0.6], lt: 0, lk: 0, bt: 0, bk: 0, drop: 0, lean: 0.05, yaw: 0, hy: 0 },
  { t: 0.32, h: [0.1, 4.0, 0.45], g: [0.05, 4.0, 0.5], lt: -1.5, lk: 1.8, bt: 0, bk: 0.15, drop: 0.05, lean: -0.05, yaw: -0.6, hy: -0.5 },
  { t: 0.55, h: [1.15, 4.35, -0.75], g: [-0.85, 3.75, 0.85], lt: -0.95, lk: 0.55, bt: 0.45, bk: 0.5, drop: 0.45, lean: 0.1, yaw: -0.5, hy: -0.2 },
  { t: 0.68, h: [0.4, 4.45, 1.35], g: [-0.55, 3.3, 0.45], lt: -0.7, lk: 0.5, bt: 0.6, bk: 0.7, drop: 0.5, lean: 0.45, yaw: 0.35, hy: 0.3 },
  { t: 1, h: [-0.6, 2.3, 1.15], g: [-0.55, 3.0, 0.25], lt: -0.6, lk: 0.6, bt: 1.0, bk: 1.3, drop: 0.55, lean: 0.85, yaw: 0.7, hy: 0.5 },
];
function samplePitch(t) {
  let i = 0; while (i < PK.length - 2 && t > PK[i + 1].t) i++;
  const a = PK[i], b = PK[i + 1], u = ease(clamp((t - a.t) / (b.t - a.t), 0, 1));
  const o = {}; for (const k in a) { if (k === 't') continue; o[k] = Array.isArray(a[k]) ? lerpA(a[k], b[k], u) : lerp(a[k], b[k], u); }
  return o;
}

export function makeBall(scene) {
  const tex = (() => { const c = document.createElement('canvas'); c.width = 128; c.height = 64; const g = c.getContext('2d'); g.fillStyle = '#fbfaf5'; g.fillRect(0, 0, 128, 64); g.strokeStyle = '#c0392b'; g.lineWidth = 3; g.beginPath(); for (let x = 0; x <= 128; x += 2) { const y = 32 + Math.sin(x / 128 * Math.PI * 2) * 18; x ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), new THREE.MeshBasicMaterial({ map: tex }));
  ball.castShadow = true; scene.add(ball);
  const sh = new THREE.Mesh(new THREE.CircleGeometry(0.35, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
  scene.add(sh);
  return { ball, shadow: sh };
}
