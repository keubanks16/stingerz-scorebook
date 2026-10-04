// GS Baseball Hub · Swing AI
//
// Analyze a swing from a clip, keep every player's swings, scout a whole game video, and call
// where each hitter is likely to hit it next. The tracking runs on the phone (MoveNet pose model
// on TensorFlow.js) and the video never leaves it: only the numbers, a snapshot and the body
// keypoints are saved, to the player, through the Hub (window-free: everything comes in through
// the `hub` object handed to mount()).
//
// The engine files next to this one (swing.js, scout.js, field.js, overlay.js, model.js, pose.js)
// come unchanged from GS Baseball Scout.

import { EDGES, analyzeSwing, waitFrame, packFrames, unpackFrames } from './swing.js';
import * as M from './model.js';

let H = null;              // the Hub: data, saving, toasts
let root = null;
let SC = null, F = null, OV = null;      // full-game scouting modules, loaded on first use
const loadScoutMods = async () => { if (!SC) [SC, F, OV] = await Promise.all([import('./scout.js'), import('./field.js'), import('./overlay.js')]); };

const S = { view: 'analyze', pose: null, posePromise: null, poseProgress: 0, hitter: null, report: null, media: null, mediaErr: '', anim: 0, from: 'stats' };
const FIELD_KEY = 'gs-hub-swing-field';
function fieldCfg() {
  let f = null; try { f = JSON.parse(localStorage.getItem(FIELD_KEY) || 'null'); } catch (e) { f = null; }
  const bp = Number(f && f.basePath) || 60;
  return { basePath: bp, fence: Number(f && f.fence) || Math.round(bp * 3.3) };
}
function setFieldCfg(f) { try { localStorage.setItem(FIELD_KEY, JSON.stringify(f)); } catch (e) { /* per phone */ } }

// ------------------------------------------------------------------ little helpers
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);
function roundObj(o) {
  if (!o) return null;
  const out = {};
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (typeof v === 'number') out[k] = r3(v);
    else if (v == null) out[k] = null;
    else if (typeof v === 'object' && !Array.isArray(v)) out[k] = roundObj(v);
    else out[k] = v;
  }
  return out;
}
const esc = (v) => H.esc(v);
const slug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const mmss = (t, tenths) => {
  t = Math.max(0, t || 0);
  const m = Math.floor(t / 60), s = t - m * 60;
  return m + ':' + (tenths ? s.toFixed(1).padStart(4, '0') : String(Math.floor(s)).padStart(2, '0'));
};
const fmtS = (v) => (Number.isFinite(v) ? v.toFixed(2) + ' s' : '—');
const rel = (v) => (Number.isFinite(v) ? (Math.abs(v) < 0.005 ? '±0.00 s' : (v < 0 ? '−' : '+') + Math.abs(v).toFixed(2) + ' s') : '—');
const pct = (v) => (Number.isFinite(v) ? Math.round(v * 100) + '%' : '—');
const dateOf = (ms) => new Date(Number(ms) || Date.now()).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const ICON = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5v14l12-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>',
};

// ------------------------------------------------------------------ the pose engine
// TensorFlow.js 4.22.0 from a public CDN: the same build the pose engine was verified against.
const TF_URLS = [
  'https://cdnjs.cloudflare.com/ajax/libs/tensorflow/4.22.0/tf.min.js',
  'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js',
  'https://unpkg.com/@tensorflow/tfjs@4.22.0/dist/tf.min.js',
];
async function loadTF() {
  if (window.tf && window.tf.fused) return window.tf;
  for (const u of TF_URLS) {
    try {
      await new Promise((res, rej) => { const s = document.createElement('script'); s.src = u; s.async = true; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
      if (window.tf && window.tf.fused) return window.tf;
    } catch (e) { /* next copy */ }
  }
  throw new Error('The AI engine could not be downloaded');
}
let poseHook = null;
function ensurePose() {
  if (S.pose) return Promise.resolve(S.pose);
  if (window.__GS_POSE) { S.pose = window.__GS_POSE; return Promise.resolve(S.pose); }     // tests
  if (!S.posePromise) {
    S.posePromise = (async () => {
      const tf = await loadTF();
      try { if (!(await tf.setBackend('webgl'))) await tf.setBackend('cpu'); } catch (e) { await tf.setBackend('cpu'); }
      await tf.ready();
      const { loadPose } = await import('./pose.js');
      const pose = await loadPose(tf, new URL('./model/', import.meta.url).href, (p) => { S.poseProgress = p; if (poseHook) poseHook(p); });
      S.pose = pose;
      return pose;
    })();
    S.posePromise.catch(() => { S.posePromise = null; });
  }
  return S.posePromise;
}

// ------------------------------------------------------------------ a video stage
// A video with a drawing layer on top. Taps come back in video pixels; the first tap on a small
// screen zooms in 3x so the next one can be exact.
class Stage {
  constructor(host, o) {
    this.o = o || {};
    host.innerHTML = `<div class="sw-stage" hidden><video playsinline muted preload="auto"></video><canvas></canvas><span class="sw-phase" hidden></span><span class="sw-hint" hidden></span></div>
      <div class="sw-transport" hidden><button type="button" class="btn ghost sm" data-k="play" aria-label="Play">${ICON.play}</button><button type="button" class="btn ghost sm" data-k="prev" aria-label="Back one frame">‹</button><input type="range" min="0" max="1000" value="0" aria-label="Position in the video"><button type="button" class="btn ghost sm" data-k="next" aria-label="Forward one frame">›</button><span class="sw-clock">0:00</span></div>`;
    this.box = host.querySelector('.sw-stage');
    this.video = host.querySelector('video');
    this.cv = host.querySelector('canvas');
    this.ctx = this.cv.getContext('2d');
    this.hintEl = host.querySelector('.sw-hint');
    this.phaseEl = host.querySelector('.sw-phase');
    this.tp = host.querySelector('.sw-transport');
    this.range = this.tp.querySelector('input');
    this.clockEl = this.tp.querySelector('.sw-clock');
    this.zoom = null; this.url = null; this.locked = false;
    this.cv.addEventListener('click', (e) => { if (this.locked) return; const p = this.point(e); if (p && this.o.onTap) this.o.onTap(p); });
    this.tp.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b || this.locked) return;
      const v = this.video;
      if (b.dataset.k === 'play') { if (v.paused) v.play().catch(() => {}); else v.pause(); }
      else { v.pause(); v.currentTime = clamp(v.currentTime + (b.dataset.k === 'next' ? 1 : -1) / 30, 0, v.duration || 0); }
    });
    this.range.addEventListener('input', () => { if (this.locked || !this.video.duration) return; this.video.pause(); this.video.currentTime = this.range.value / 1000 * this.video.duration; });
    const tick = () => { this.clock(); this.draw(); };
    this.video.addEventListener('timeupdate', tick);
    this.video.addEventListener('seeked', tick);
    this.video.addEventListener('play', () => { this.playBtn(); const loop = () => { if (this.video.paused || this.dead) return; this.draw(); if (this.o.onFrame) this.o.onFrame(); requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
    this.video.addEventListener('pause', () => this.playBtn());
    this.onResize = () => this.size();
    window.addEventListener('resize', this.onResize);
  }
  async open(file) {
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(file);
    const v = this.video;
    this.zoom = null; this.zoomCSS();
    this.box.hidden = false;
    v.src = this.url; v.load();
    await new Promise((res, rej) => {
      const ok = () => { cl(); res(); }, bad = () => { cl(); rej(new Error('decode')); };
      const cl = () => { v.removeEventListener('loadeddata', ok); v.removeEventListener('error', bad); };
      v.addEventListener('loadeddata', ok); v.addEventListener('error', bad);
    });
    this.box.style.aspectRatio = String(clamp(v.videoWidth / v.videoHeight, 0.5, 2.4));
    this.tp.hidden = false;
    await new Promise((r) => requestAnimationFrame(r));
    this.size();
  }
  size() {
    const r = this.box.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (!r.width || !r.height) return;
    this.cv.width = Math.round(r.width * dpr); this.cv.height = Math.round(r.height * dpr);
    this.zoomCSS(); this.draw();
  }
  base(cw, ch) { const vw = this.video.videoWidth || 16, vh = this.video.videoHeight || 9, s = Math.min(cw / vw, ch / vh); return { s, ox: (cw - vw * s) / 2, oy: (ch - vh * s) / 2 }; }
  map(cw, ch) {
    const b = this.base(cw, ch);
    if (!this.zoom) return { ...b, z: 1 };
    const z = this.zoom.z, s = b.s * z, vw = this.video.videoWidth * s, vh = this.video.videoHeight * s;
    let ox = cw / 2 - this.zoom.x * s, oy = ch / 2 - this.zoom.y * s;
    ox = vw <= cw ? (cw - vw) / 2 : clamp(ox, cw - vw, 0);
    oy = vh <= ch ? (ch - vh) / 2 : clamp(oy, ch - vh, 0);
    return { s, ox, oy, z };
  }
  zoomCSS() {
    const r = this.box.getBoundingClientRect(); if (!r.width) return;
    const m = this.map(r.width, r.height), b = this.base(r.width, r.height);
    if (m.z === 1) { this.video.style.transform = ''; return; }
    this.video.style.transformOrigin = '0 0';
    this.video.style.transform = `translate(${m.ox - b.ox * m.z}px, ${m.oy - b.oy * m.z}px) scale(${m.z})`;
  }
  setZoom(z) { this.zoom = z; this.zoomCSS(); this.draw(); }
  point(e) {
    const rect = this.cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1, m = this.map(this.cv.width, this.cv.height);
    const x = ((e.clientX - rect.left) * dpr - m.ox) / m.s, y = ((e.clientY - rect.top) * dpr - m.oy) / m.s;
    return x < 0 || y < 0 || x > this.video.videoWidth || y > this.video.videoHeight ? null : { x, y, small: rect.width < 640 };
  }
  P() { const m = this.map(this.cv.width, this.cv.height); return { m, P: (x, y) => [m.ox + x * m.s, m.oy + y * m.s], dpr: window.devicePixelRatio || 1 }; }
  draw() { const c = this.ctx; c.clearRect(0, 0, this.cv.width, this.cv.height); if (this.o.draw && this.video.videoWidth && !this.box.hidden) this.o.draw(c, this); }
  clock() {
    const v = this.video, d = v.duration || 0;
    this.clockEl.textContent = `${mmss(v.currentTime, d < 600)} / ${mmss(d, d < 600)}`;
    if (document.activeElement !== this.range) this.range.value = d ? Math.round(v.currentTime / d * 1000) : 0;
  }
  playBtn() { const b = this.tp.querySelector('[data-k="play"]'); b.innerHTML = this.video.paused ? ICON.play : ICON.pause; b.setAttribute('aria-label', this.video.paused ? 'Play' : 'Pause'); }
  hint(html) { if (!html) { this.hintEl.hidden = true; return; } this.hintEl.innerHTML = html; this.hintEl.hidden = false; }
  phase(t) { if (!t) { this.phaseEl.hidden = true; return; } this.phaseEl.textContent = t; this.phaseEl.hidden = false; }
  lock(b) { this.locked = b; this.tp.classList.toggle('off', !!b); this.range.disabled = !!b; }
  destroy() { this.dead = true; window.removeEventListener('resize', this.onResize); try { this.video.pause(); } catch (e) { /* gone */ } if (this.url) URL.revokeObjectURL(this.url); this.url = null; }
}
function skeleton(c, P, kp, color, w) {
  c.lineCap = 'round'; c.lineWidth = w; c.strokeStyle = color;
  for (const [a, b] of EDGES) {
    if (kp[a * 3 + 2] < 0.15 || kp[b * 3 + 2] < 0.15) continue;
    const p = P(kp[a * 3], kp[a * 3 + 1]), q = P(kp[b * 3], kp[b * 3 + 1]);
    c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(q[0], q[1]); c.stroke();
  }
  c.fillStyle = '#FFFFFF';
  for (let k = 5; k < 17; k++) { if (kp[k * 3 + 2] < 0.15) continue; const p = P(kp[k * 3], kp[k * 3 + 1]); c.beginPath(); c.arc(p[0], p[1], w * 0.75, 0, 7); c.fill(); }
}
const nearestFrame = (frames, t) => { if (!frames || !frames.length) return null; let b = frames[0]; for (const f of frames) if (Math.abs(f.t - t) < Math.abs(b.t - t)) b = f; return Math.abs(b.t - t) < 0.08 ? b : null; };
function phaseAt(ev, t) {
  if (!ev) return '';
  const tc = ev.tContact;
  if (Math.abs(t - tc) <= 0.025) return 'CONTACT';
  if (t > tc) return 'FOLLOW-THROUGH';
  if (ev.tDown != null && t >= ev.tDown) return 'SWING';
  if (ev.tLift != null && t >= ev.tLift) return 'LOAD + STRIDE';
  if (ev.tDown == null && ev.tRot != null && t >= ev.tRot - 0.15) return 'SWING';
  return 'STANCE';
}

// ------------------------------------------------------------------ field in feet
// Feet from home: +x toward first base, +y toward center field. Used for tapping where the ball
// went, the scout results and the call's wedges.
function fieldFeetSVG(o) {
  const f = o.field || fieldCfg(), R = f.fence, bp = f.basePath, s2 = bp / Math.SQRT2, a45 = Math.SQRT1_2;
  const W = R * a45 + 14;
  const vb = `${-W} ${-R - 14} ${2 * W} ${R + 32}`;
  const P = (x, y) => `${(+x).toFixed(1)},${(-y).toFixed(1)}`;
  let wedges = '';
  if (o.dist && o.bats) {
    const edges = [45, 27, 9, -9, -27, -45];
    for (let z = 0; z < 5; z++) {
      const a1 = M.fieldAngle(edges[z], o.bats) * Math.PI / 180, a2 = M.fieldAngle(edges[z + 1], o.bats) * Math.PI / 180;
      const p1 = [Math.sin(a1) * R, Math.cos(a1) * R], p2 = [Math.sin(a2) * R, Math.cos(a2) * R];
      const sweep = a2 > a1 ? 1 : 0;
      wedges += `<path class="sw-wedge${z === o.best ? ' best' : ''}" d="M0,0 L${P(...p1)} A${R},${R} 0 0,${sweep} ${P(...p2)} Z" style="opacity:${(0.08 + 0.75 * o.dist[z]).toFixed(2)}"/>`;
    }
  }
  const dots = (o.dots || []).map((d) => {
    const [x, y] = [d.x, -d.y], r = R * 0.022;
    if (d.type === 'LD') return `<path class="sw-dot" d="M${x.toFixed(1)},${(y - r * 1.2).toFixed(1)} L${(x + r * 1.1).toFixed(1)},${(y + r * 0.8).toFixed(1)} L${(x - r * 1.1).toFixed(1)},${(y + r * 0.8).toFixed(1)} Z"/>`;
    if (d.type === 'FB') return `<circle class="sw-dot ring" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r * 0.95).toFixed(1)}" style="stroke-width:${(r * 0.45).toFixed(1)}"/>`;
    if (d.type === 'PU') return `<circle class="sw-dot ring" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r * 0.85).toFixed(1)}" style="stroke-width:${(r * 0.4).toFixed(1)};stroke-dasharray:${(r * 0.5).toFixed(1)} ${(r * 0.4).toFixed(1)}"/>`;
    return `<circle class="sw-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}"/>`;
  }).join('');
  const mk = o.marker ? `<circle class="sw-mark-ring" cx="${o.marker.x.toFixed(1)}" cy="${(-o.marker.y).toFixed(1)}" r="${(R * 0.05).toFixed(1)}"/><circle class="sw-mark" cx="${o.marker.x.toFixed(1)}" cy="${(-o.marker.y).toFixed(1)}" r="${(R * 0.026).toFixed(1)}"/>` : '';
  const bag = (x, y) => `<rect class="bag" x="${(x - 1.6).toFixed(1)}" y="${(-y - 1.6).toFixed(1)}" width="3.2" height="3.2" transform="rotate(45 ${x.toFixed(1)} ${(-y).toFixed(1)})"/>`;
  const dirt = bp * 1.36;
  return `<svg class="field sw-field${o.tap ? ' tap' : ''}" viewBox="${vb}" role="img" aria-label="${esc(o.label || 'Field')}"${o.tap ? ` data-sw="${o.tap}"` : ''}>
    <path class="fair" d="M0,0 L${P(-R * a45, R * a45)} A${R},${R} 0 0,1 ${P(R * a45, R * a45)} Z"/>
    <path class="dirt" d="M0,0 L${P(-dirt * a45, dirt * a45)} A${dirt},${dirt} 0 0,1 ${P(dirt * a45, dirt * a45)} Z"/>
    <path class="igrass" d="M${P(0, bp * 0.18)} L${P(s2 * 0.78, s2)} L${P(0, 2 * s2 * 0.9)} L${P(-s2 * 0.78, s2)} Z"/>
    ${wedges}
    <path class="chalk" style="stroke-width:${(R / 220).toFixed(2)}" d="M${P(-R * a45, R * a45)} L0,0 L${P(R * a45, R * a45)}"/>
    ${bag(s2, s2)}${bag(0, 2 * s2)}${bag(-s2, s2)}<path class="bag" d="M-2,0 L2,0 L2,-1.5 L0,-3 L-2,-1.5 Z" transform="translate(0 1.5)"/>
    ${dots}${mk}</svg>`;
}
function svgFeet(svg, e) {
  const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
  const q = pt.matrixTransform(svg.getScreenCTM().inverse());
  return { x: Math.round(q.x * 10) / 10, y: Math.round(-q.y * 10) / 10 };
}
const zoneOfPlay = (x, y, bats) => (x == null || !bats ? null : M.zoneOf(M.pullAngle(M.sprayAngle(x, y), bats)));
const zoneLabel = (x, y, bats) => { const z = zoneOfPlay(x, y, bats); return z == null ? '' : M.ZONE_LABEL[M.ZONES[z]]; };

// ------------------------------------------------------------------ the swing breakdown
// The report for one swing: phases against contact, the measurements, the hip and shoulder
// turn chart and the ball. rec = { events, metrics, series?, ball? } (a fresh analysis or a saved one).
function breakdownHTML(rec) {
  const e = rec.events || {}, m = rec.metrics || {}, tc = e.tContact;
  const rows = [['Leg lift', e.tLift], ['Foot down', e.tDown], ['Hips open', e.tHip], ['Shoulders open', e.tSh]]
    .filter(([, t]) => t != null).map(([l, t]) => `<div><span>${l}</span><b>${rel(t - tc)}</b></div>`).join('')
    + `<div class="contact"><span>Contact <small>${e.contactSource === 'ball' ? 'seen from the ball' : 'estimated'}</small></span><b>±0.00 s</b></div>`;
  const hl = m.hipLead;
  const hv = !Number.isFinite(hl) ? '—' : Math.abs(hl) < 0.035 ? 'Opened together' : hl > 0 ? `Hips first (${Math.round(hl * 1000)} ms)` : `Shoulders first (${Math.round(-hl * 1000)} ms)`;
  const meas = [
    ['Leg lift → contact', fmtS(m.liftToContact)],
    ['Foot down → contact', fmtS(m.downToContact)],
    ['Hips vs shoulders', hv],
    ['Shoulders open at contact', pct(m.shoulderOpenAtContact)],
    ['Head drift to contact', Number.isFinite(m.headDrift) ? Math.round(m.headDrift * 100) + '% of height' : '—'],
    ['Stride', Number.isFinite(m.stride) ? Math.round(m.stride * 100) + '% of height' : '—'],
  ].map(([l, v]) => `<div><span>${l}</span><b>${esc(v)}</b></div>`).join('');
  const b = rec.ball;
  const ball = !b ? '' : b.found
    ? `Ball tracked ${b.n || (b.track ? b.track.length : 0)} frames off the bat${b.air === true ? ', climbing: in the air' : b.air === false ? ', staying low: on the ground' : ''}.${b.type ? ' Looks like a ' + M.TYPE_LABEL[b.type].toLowerCase() + '.' : ''}`
    : 'The ball wasn’t picked up after contact.';
  return `<section class="card sw-break">
    <div class="sw-cols"><div><h3>Timeline <small>(relative to contact)</small></h3><div class="sw-rows">${rows}</div></div>
    <div><h3>Measurements</h3><div class="sw-rows">${meas}</div></div></div>
    ${rec.series && rec.series.t && rec.series.t.length > 3 ? turnChart(rec.series, e) : ''}
    ${ball ? `<p class="small muted" style="margin:0">${esc(ball)}</p>` : ''}
  </section>`;
}
function turnChart(sr, e) {
  const t = sr.t, t0 = t[0], t1 = Math.min(t[t.length - 1], e.tContact != null ? e.tContact + 0.25 : t[t.length - 1]);
  const W = 320, Hh = 110, X = (v) => ((v - t0) / Math.max(0.01, t1 - t0)) * W, Y = (v) => Hh - 8 - clamp(v, 0, 1) * (Hh - 18);
  const line = (a) => t.map((tt, i) => (tt <= t1 && Number.isFinite(a[i]) ? `${X(tt).toFixed(1)},${Y(a[i]).toFixed(1)}` : null)).filter(Boolean).join(' ');
  // labels alternate rows when two events sit close together
  let lastX = -1e9, row = 0;
  const mark = (tt, cls, lbl) => {
    if (tt == null || tt < t0 || tt > t1) return '';
    const x = X(tt); row = x - lastX < 46 ? 1 - row : 0; lastX = x;
    return `<line class="${cls}" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="6" y2="${Hh - 6}"/><text x="${x.toFixed(1)}" y="${Hh + 8 + row * 10}">${lbl}</text>`;
  };
  return `<div class="sw-chart"><div class="small muted">How far the hips and shoulders have turned toward the pitcher <span class="sw-key"><i class="hp"></i>hips <i class="sh"></i>shoulders</span></div>
    <svg viewBox="0 -4 ${W} ${Hh + 24}" role="img" aria-label="Hip and shoulder turn over the swing">
      <line class="grid" x1="0" x2="${W}" y1="${Y(0)}" y2="${Y(0)}"/><line class="grid" x1="0" x2="${W}" y1="${Y(0.5)}" y2="${Y(0.5)}"/><line class="grid" x1="0" x2="${W}" y1="${Y(1)}" y2="${Y(1)}"/>
      ${mark(e.tLift, 'ev', 'Leg lift')}${mark(e.tDown, 'ev', 'Foot down')}${mark(e.tContact, 'ev contact', 'Contact')}
      <polyline class="hp" points="${line(sr.hp)}"/><polyline class="sh" points="${line(sr.sh)}"/>
    </svg></div>`;
}

// ------------------------------------------------------------------ the call (prediction)
function callHTML(p, bats, o) {
  if (!p) return '';
  const best = p.best, zone = M.ZONE_LABEL[M.ZONES[best]], sd = p.sides;
  const bar = (k, l) => `<div class="sw-side"><span>${l}</span><i style="width:${Math.round(sd[k] * 100)}%"></i><b>${Math.round(sd[k] * 100)}%</b></div>`;
  const basis = p.nHitter
    ? `From ${p.nHitter} of this hitter’s balls in play${p.similar >= 1 ? ', nudged by saved swings that looked like this one' : ''}.`
    : 'No balls in play saved for this hitter yet, so this is the team-wide pattern. It sharpens with every saved swing.';
  return `<section class="card sw-call"><div class="row"><div class="grow"><div class="small muted">${esc(o && o.title || 'The call')}</div><b class="sw-big">${esc(zone)} <span>${Math.round(p.dist[best] * 100)}%</span></b></div><span class="chip">${esc(p.confidence)} confidence</span></div>
    <div class="sw-sides">${bar('pull', 'Pull side')}${bar('center', 'Middle')}${bar('oppo', 'Opposite field')}</div>
    <p class="small muted" style="margin:0">${esc(basis)}${o && o.frozen ? ' Locked in before the result was tagged.' : ''}</p>
    ${o && o.field ? fieldFeetSVG({ dist: p.dist, best, bats, dots: o.dots, label: 'Where the call expects the ball' }) : ''}</section>`;
}

// ================================================================== mount / update / unmount
let analyzeStage = null, scoutStage = null;
export function mount(el, hub, o) {
  H = hub; root = el; S.from = (o && o.from) || 'stats';
  root.innerHTML = `<div class="row"><button class="btn ghost sm" data-sw="back">‹ ${S.from === 'iq' ? 'Instincts' : 'Stats'}</button></div>
    <section class="iq-hero"><img src="${H.logo()}" alt=""><div><div class="iq-kicker">${esc(H.team().name)}</div><h2>Swing AI</h2><p>Every swing from your video, broken down <b>frame by frame</b>.</p></div></section>
    <div id="sw-tabs"></div>
    <div data-view="analyze"></div><div data-view="hitters" hidden></div><div data-view="hitter" hidden></div><div data-view="report" hidden></div><div data-view="scout" hidden></div>`;
  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);
  buildAnalyze();
  buildScout();
  show(S.view === 'scout' && !H.user().admin ? 'analyze' : S.view);
}
export function update() {
  if (!root) return;
  renderTabs();
  if (S.view === 'analyze') { renderGate(); renderWho(false); if (A.analysis && !A.frozen) computeCall(); renderCall(); renderTag(); }
  else if (S.view === 'hitters') renderHitters();
  else if (S.view === 'hitter') renderHitter();
  else if (S.view === 'report') renderReport();
  else if (S.view === 'scout') { renderScoutTarget(); renderSaveState(); }
}
export function unmount() {
  if (!root) return;
  if (A.abort) A.abort.abort();
  if (G.abort) G.abort.abort();
  cancelAnimationFrame(S.anim);
  root.removeEventListener('click', onClick); root.removeEventListener('input', onInput); root.removeEventListener('change', onChange);
  if (analyzeStage) analyzeStage.destroy();
  if (scoutStage) scoutStage.destroy();
  analyzeStage = scoutStage = null;
  Object.assign(A, blankAnalysis(), { file: null });
  // The game video goes with the page, but balls in play already found stay listed to save.
  G.files = []; G.adjust = null; G.watch = null;
  for (const p of G.plays) p.restored = true;
  G.phase = G.plays.length ? 'done' : 'empty';
  if (G.plays.some((p) => !p.savedId)) G.restored = G.restored || Date.now();
  root = null;
}
export const busy = () => !!(A.abort || G.abort || A.saving || G.saving);

function show(view) {
  S.view = view;
  cancelAnimationFrame(S.anim);
  for (const v of root.querySelectorAll('[data-view]')) v.hidden = v.dataset.view !== view;
  renderTabs();
  if (view === 'analyze') { renderGate(); renderWho(true); renderCall(); renderTag(); setTimeout(() => analyzeStage && analyzeStage.size(), 0); }
  if (view === 'hitters') renderHitters();
  if (view === 'hitter') renderHitter();
  if (view === 'report') renderReport();
  if (view === 'scout') { renderScout(); setTimeout(() => scoutStage && scoutStage.size(), 0); }
}
function renderTabs() {
  const u = H.user(), tabs = [['analyze', 'Analyze'], ['hitters', 'Hitters']];
  if (u.admin) tabs.push(['scout', 'Scout a game']);
  const cur = S.view === 'hitter' || S.view === 'report' ? 'hitters' : S.view;
  const el = root.querySelector('#sw-tabs');
  if (!u.allowed) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="seg sw-tabs">${tabs.map(([k, l]) => `<button type="button" data-sw="view" data-v="${k}" aria-pressed="${cur === k}">${l}</button>`).join('')}</div>`;
}

// ------------------------------------------------------------------ events
const ACT = {};
function onClick(e) {
  const el = e.target.closest('[data-sw]');
  if (!el || !root.contains(el)) return;
  const fn = ACT[el.dataset.sw];
  if (fn) fn(el.dataset, el, e);
}
const IN = {};
function onInput(e) { const el = e.target; if (el.dataset && el.dataset.swIn && IN[el.dataset.swIn]) IN[el.dataset.swIn](el, e); }
function onChange(e) { const el = e.target; if (el.dataset && el.dataset.swCh && IN[el.dataset.swCh]) IN[el.dataset.swCh](el, e); }
ACT.back = () => H.back();
ACT.view = (d) => {
  if (busy()) { H.toast('Swing AI is still working. Tap Stop first, or wait for it to finish.'); return; }
  show(d.v);
};

// ================================================================== Analyze a swing
const blankTag = () => ({ kind: '', type: '', result: '', x: null, y: null });
const blankAnalysis = () => ({ seed: null, analysis: null, abort: null, prog: null, msg: '', tag: blankTag(), pred: null, frozen: false, savedId: null, saving: false, thumb: null, live: null, replay: null });
const A = Object.assign({ who: null, bats: '', file: null, game: '', count: '', inning: '' }, blankAnalysis());

function buildAnalyze() {
  const v = root.querySelector('[data-view="analyze"]');
  v.innerHTML = `<div id="a-gate"></div>
    <div id="a-work" class="stack" hidden>
      <section class="card stack" style="padding:14px" id="a-who"></section>
      <section class="card stack" style="padding:14px">
        <div class="row"><div class="grow"><b>Clip</b><div class="small muted" id="a-clipname">Any phone video of one swing works, or a GameChanger clip. It stays on your phone.</div></div>
        <label class="btn primary" for="a-file" id="a-pick">Choose a clip</label><input type="file" id="a-file" class="vh" accept="video/*" data-sw-ch="file"></div>
        <div id="a-stage"></div>
        <div id="a-actions"></div>
        <div id="a-msg"></div>
      </section>
      <div id="a-report"></div>
      <div id="a-call"></div>
      <div id="a-tag"></div>
    </div>`;
  analyzeStage = new Stage(v.querySelector('#a-stage'), { onTap: analyzeTap, draw: analyzeDraw, onFrame: analyzeFrame });
}
function renderGate() {
  const u = H.user(), gate = root.querySelector('#a-gate'), work = root.querySelector('#a-work');
  let msg = '';
  if (!u.live) msg = 'Swing AI saves swings to your team’s online database, which this copy of the Hub isn’t connected to.';
  else if (!u.signedIn) msg = 'Sign in to analyze swings. Coaches can analyze any player, and families can analyze their own player.';
  else if (!u.allowed) msg = u.approved ? 'Ask a coach to link your account to your player (Team, Families & coaches). Then you can analyze their swings here.' : 'Your account is waiting for a coach to approve it.';
  work.hidden = !!msg;
  if (msg) {
    gate.innerHTML = `<section class="card stack" style="padding:14px"><p style="margin:0">${esc(msg)}</p></section>${demoHTML()}`;
    return;
  }
  gate.innerHTML = A.file ? '' : demoHTML(true);
}
function demoHTML(steps) {
  return `<section class="card stack sw-demo" style="padding:14px">
    <div class="swing-video"><img src="${new URL('../media/swing-breakdown.gif', import.meta.url).href}" alt="Example swing breakdown: body tracking through stance, stride, swing, contact and follow-through, with a timing chart and the ball tracked off the bat"></div>
    ${steps ? `<ol class="sw-steps"><li><b>Pick the player and a clip.</b> Film from behind the plate or the side. A GameChanger clip works too.</li><li><b>Tap the batter</b> on a frame before the pitch.</li><li><b>Analyze.</b> You get the swing’s timing, hip and shoulder turn, head movement and where the ball went, saved to the player.</li></ol>` : ''}
  </section>`;
}

// ---------- who's batting
function myWhoOptions() {
  const u = H.user(), team = H.team();
  return u.admin ? team.players : team.players.filter((p) => u.players.includes(p.id));
}
function renderWho(force) {
  const box = root.querySelector('#a-who');
  if (!box || (!force && box.contains(document.activeElement))) return;
  const u = H.user(), opts = myWhoOptions();
  if (!A.who && opts.length === 1) A.who = { kind: 'us', pid: opts[0].id };
  if (A.who && A.who.kind === 'us' && !opts.some((p) => p.id === A.who.pid)) A.who = null;
  if (A.who && !A.bats) A.bats = batsFor(A.who);
  const w = A.who || {};
  const val = !A.who ? '' : w.kind === 'opp' ? 'opp' : 'us:' + w.pid;
  let h = `<label><span class="field-lbl">Batter</span><select class="input" data-sw-ch="who" ${A.abort || A.saving ? 'disabled' : ''}>
    <option value="" ${val ? '' : 'selected'} disabled>Choose the batter</option>
    ${opts.map((p) => `<option value="us:${esc(p.id)}" ${val === 'us:' + p.id ? 'selected' : ''}>${p.num ? '#' + esc(p.num) + ' ' : ''}${esc(p.name)}</option>`).join('')}
    ${u.admin ? `<option value="opp" ${val === 'opp' ? 'selected' : ''}>An opponent’s hitter…</option>` : ''}</select></label>`;
  if (w.kind === 'opp') {
    const ops = H.opponents(), o = ops.find((x) => x.key === w.opp);
    h += `<div class="grid2"><label><span class="field-lbl">Team</span>${ops.length ? `<select class="input" data-sw-ch="opp"><option value="">Choose the team</option>${ops.map((x) => `<option value="${esc(x.key)}" ${x.key === w.opp ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}<option value="new" ${w.opp === 'new' ? 'selected' : ''}>Another team…</option></select>` : ''}
      ${!ops.length || w.opp === 'new' ? `<input class="input" data-sw-in="oppName" value="${esc(w.oppName || '')}" placeholder="Team name" autocomplete="off" style="margin-top:6px">` : ''}</label>
      <label><span class="field-lbl">Number</span><input class="input" data-sw-in="num" value="${esc(w.num || '')}" inputmode="numeric" placeholder="12" autocomplete="off"></label></div>
      <label><span class="field-lbl">Name (optional)</span><input class="input" data-sw-in="name" value="${esc(w.name || '')}" placeholder="${esc(o && w.num ? (oppPlayer(o, w.num) || {}).name || '' : '')}" autocomplete="off" list="a-opp-names"></label>
      <datalist id="a-opp-names">${o ? o.players.map((p) => `<option value="${esc(p.name || '')}">`).join('') : ''}</datalist>`;
  }
  if (A.who) h += `<div><span class="field-lbl">Bats</span><div class="seg">${[['R', 'Right'], ['L', 'Left']].map(([k, l]) => `<button type="button" data-sw="bats" data-v="${k}" aria-pressed="${A.bats === k}">${l}</button>`).join('')}</div>${batsNote()}</div>`;
  box.innerHTML = h;
}
function oppPlayer(o, num) { const n = String(num || '').trim().replace(/^#/, ''); return n ? (o.players || []).find((p) => String(p.num || '').trim() === n) : null; }
function batsFor(w) {
  if (!w) return '';
  if (w.kind === 'us') { const p = H.team().players.find((x) => x.id === w.pid); return p && (p.bats === 'R' || p.bats === 'L') ? p.bats : ''; }
  const o = H.opponents().find((x) => x.key === w.opp), p = o && oppPlayer(o, w.num);
  return p && (p.bats === 'R' || p.bats === 'L') ? p.bats : '';
}
function batsNote() {
  const w = A.who; if (!w || w.kind !== 'us') return '';
  const p = H.team().players.find((x) => x.id === w.pid);
  return p && p.bats === 'S' ? '<p class="small muted" style="margin:6px 0 0">Switch hitter: pick the side for this clip.</p>' : '';
}
function whoInfo() {
  const w = A.who; if (!w) return null;
  const team = H.team();
  if (w.kind === 'us') {
    const p = team.players.find((x) => x.id === w.pid); if (!p) return null;
    return { pid: p.id, opp: '', oppName: '', key: 'us:' + p.id, hitter: { name: p.name, number: String(p.num || ''), team: team.name }, label: p.name, short: String(p.name).split(/\s+/)[0] };
  }
  const o = w.opp && w.opp !== 'new' ? H.opponents().find((x) => x.key === w.opp) : null;
  const oname = o ? o.name : String(w.oppName || '').trim();
  const num = String(w.num || '').trim().replace(/^#/, '');
  const rp = o && oppPlayer(o, num);
  const name = String(w.name || '').trim() || (rp && rp.name) || '';
  if (!oname || (!num && !name)) return null;
  const okey = o ? o.key : H.oppKey(oname);
  return { pid: '', opp: okey, oppName: oname, key: 'opp:' + okey + ':' + (num ? '#' + num : slug(name)), hitter: { name: name || '#' + num, number: num, team: oname }, label: (num ? '#' + num + ' ' : '') + (name || oname + ' hitter'), short: name ? name.split(/\s+/)[0] : '#' + num };
}
IN.who = (el) => {
  const v = el.value;
  A.who = v === 'opp' ? { kind: 'opp', opp: '', num: '', name: '', oppName: '' } : { kind: 'us', pid: v.slice(3) };
  A.bats = batsFor(A.who);
  afterWhoChange();
  renderWho(true);
};
IN.opp = (el) => { A.who.opp = el.value; A.bats = batsFor(A.who) || A.bats; afterWhoChange(); renderWho(true); };
IN.oppName = (el) => { A.who.oppName = el.value; afterWhoChange(); };
IN.num = (el) => { A.who.num = el.value; const b = batsFor(A.who); if (b) A.bats = b; afterWhoChange(); };
IN.name = (el) => { A.who.name = el.value; afterWhoChange(); };
ACT.bats = (d) => { A.bats = d.v; afterWhoChange(); renderWho(true); };
function afterWhoChange() { if (A.analysis && !A.frozen) computeCall(); renderCall(); renderTag(); renderActions(); }

// ---------- the clip
IN.file = async (el) => {
  const f = el.files && el.files[0]; el.value = '';
  if (!f || A.abort) return;
  Object.assign(A, blankAnalysis());
  A.file = f;
  root.querySelector('#a-clipname').textContent = f.name;
  root.querySelector('#a-pick').textContent = 'Change clip';
  renderGate(); renderReport0(); renderCall(); renderTag();
  ensurePose().catch(() => {});
  try { await analyzeStage.open(f); }
  catch (e) { A.file = null; analyzeStage.box.hidden = true; analyzeStage.tp.hidden = true; setMsg('This phone couldn’t open that video. Try an .mp4 or .mov file.'); renderGate(); return; }
  await waitFrame(analyzeStage.video, Math.min(0.5, (analyzeStage.video.duration || 1) / 3));
  setMsg('');
  tapHint();
  renderActions(); analyzeStage.draw();
};
function tapHint() {
  const st = analyzeStage;
  if (A.analysis) { st.hint(null); return; }
  st.hint(A.seed ? 'Tap the <b>batter</b> again to move the marker' : st.zoom ? 'Now tap the middle of the <b>batter</b>' : 'Pause before the pitch and tap the <b>batter</b>');
}
function analyzeTap(p) {
  if (A.abort || A.analysis) return;
  const st = analyzeStage;
  st.video.pause();
  if (p.small && !st.zoom) { st.setZoom({ x: p.x, y: p.y, z: 3 }); tapHint(); return; }
  A.seed = { x: p.x, y: p.y, t: st.video.currentTime };
  st.setZoom(null);
  tapHint(); renderActions(); st.draw();
}
function renderActions() {
  const el = root.querySelector('#a-actions'); if (!el) return;
  if (!A.file) { el.innerHTML = ''; return; }
  if (A.abort) {
    const p = A.prog || { text: 'Starting…', p: 0 };
    el.innerHTML = `<div class="sw-prog"><div class="row"><span class="grow small">${esc(p.text)}</span><button type="button" class="btn sm" data-sw="stop">Stop</button></div><div class="sw-bar"><i style="width:${Math.round(clamp(p.p || 0, 0, 1) * 100)}%"></i></div></div>`;
    return;
  }
  if (A.analysis) {
    el.innerHTML = `<div class="row" style="flex-wrap:wrap"><button type="button" class="btn primary" data-sw="replay">Replay the swing</button><button type="button" class="btn" data-sw="contact">Jump to contact</button><button type="button" class="btn ghost" data-sw="again">Analyze again</button></div>`;
    return;
  }
  const ok = !!A.seed && !!whoInfo() && !!A.bats;
  const need = !whoInfo() ? 'Choose the batter above.' : !A.bats ? 'Pick which side they bat from.' : !A.seed ? 'Tap the batter on the video.' : '';
  el.innerHTML = `<div class="row" style="flex-wrap:wrap"><button type="button" class="btn primary" data-sw="analyze" ${ok ? '' : 'disabled'}>Analyze swing</button><button type="button" class="btn ghost" data-sw="analyzeHere" ${ok ? '' : 'disabled'} title="Use this if the clip has more than one swing">Analyze near this spot</button></div>${need ? `<p class="small muted" style="margin:6px 0 0">${need}</p>` : ''}`;
}
function setMsg(t, warn) { const el = root.querySelector('#a-msg'); if (el) el.innerHTML = t ? `<p class="${warn === false ? 'small muted' : 'warn-text'}" style="margin:0">${esc(t)}</p>` : ''; }
ACT.stop = () => { if (A.abort) A.abort.abort(); };
ACT.analyze = () => runAnalysis();
ACT.analyzeHere = () => runAnalysis(analyzeStage.video.currentTime);
ACT.again = () => { if (A.saving) return; Object.assign(A, blankAnalysis(), { seed: A.seed }); renderReport0(); renderCall(); renderTag(); renderActions(); tapHint(); analyzeStage.phase(null); analyzeStage.draw(); renderWho(true); };
ACT.contact = async () => { if (!A.analysis) return; analyzeStage.video.pause(); await waitFrame(analyzeStage.video, Math.max(0, A.analysis.events.tContact - 0.01)); analyzeStage.draw(); analyzeFrame(); };
ACT.replay = async () => {
  const a = A.analysis; if (!a) return;
  const v = analyzeStage.video, ev = a.events;
  const start = Math.max(0, (ev.tLift != null ? ev.tLift : ev.tContact - 0.9) - 0.35), end = Math.min(v.duration || 0, ev.tContact + 0.7);
  v.pause();
  await waitFrame(v, start);
  v.playbackRate = 0.25;
  A.replay = end;
  try { await v.play(); } catch (e) { A.replay = null; v.playbackRate = 1; }
};
function analyzeFrame() {
  const v = analyzeStage.video;
  if (A.replay != null && v.currentTime >= A.replay) { v.pause(); v.playbackRate = 1; A.replay = null; }
  analyzeStage.phase(A.analysis ? phaseAt(A.analysis.events, v.currentTime) : '');
}
function analyzeDraw(c, st) {
  const { m, P, dpr } = st.P();
  if (A.live) {
    const { box, kp } = A.live;
    if (box) { const p = P(box.cx - box.size / 2, box.cy - box.size / 2); c.strokeStyle = 'rgba(127,176,230,.9)'; c.lineWidth = 1.5 * dpr; c.setLineDash([6 * dpr, 4 * dpr]); c.strokeRect(p[0], p[1], box.size * m.s, box.size * m.s); c.setLineDash([]); }
    if (kp) skeleton(c, P, kp, 'rgba(64,211,190,.95)', clamp(3 * dpr * m.s * 4, 1.5 * dpr, 4 * dpr));
    return;
  }
  const a = A.analysis;
  if (a) {
    const t = st.video.currentTime;
    const f = nearestFrame(a.frames, t);
    if (f) skeleton(c, P, f.kp, 'rgba(64,211,190,.95)', clamp(a.H * m.s / 24, 1.4 * dpr, 4 * dpr));
    if (a.ball && a.ball.found && a.ball.track) {
      const pts = a.ball.track.filter((q) => q.t <= t + 0.01);
      pts.forEach((q, i) => { const p = P(q.x, q.y); c.fillStyle = `rgba(255,196,61,${0.4 + 0.6 * (i + 1) / pts.length})`; c.beginPath(); c.arc(p[0], p[1], (i === pts.length - 1 ? 5 : 3) * dpr, 0, 7); c.fill(); });
    }
    analyzeFrame();
    return;
  }
  if (A.seed) {
    const p = P(A.seed.x, A.seed.y);
    c.strokeStyle = '#FFFFFF'; c.lineWidth = 2.5 * dpr; c.beginPath(); c.arc(p[0], p[1], 14 * dpr, 0, 7); c.stroke();
    c.fillStyle = 'rgba(127,176,230,.95)'; c.beginPath(); c.arc(p[0], p[1], 5 * dpr, 0, 7); c.fill();
  }
}

async function runAnalysis(hint) {
  if (!A.seed || A.abort || !whoInfo() || !A.bats) return;
  const st = analyzeStage, ctl = new AbortController();
  A.abort = ctl; A.analysis = null; A.pred = null; A.frozen = false; A.tag = blankTag(); A.savedId = null; A.thumb = null;
  st.video.pause(); st.lock(true); st.hint(null); setMsg('');
  renderReport0(); renderCall(); renderTag(); renderWho(true);
  const prog = (text, p) => { A.prog = { text, p }; renderActions(); };
  poseHook = (p) => prog('Downloading the swing AI (first time only, about 13 MB)…', p);
  try {
    prog('Getting the swing AI ready…', S.poseProgress);
    const pose = await ensurePose();
    poseHook = null;
    if (ctl.signal.aborted) throw new DOMException('Stopped', 'AbortError');
    const res = await analyzeSwing({
      video: st.video, pose, seed: A.seed, signal: ctl.signal, hint,
      onProgress: (p) => { prog(p.stage + '…', p.p); if (p.kp || p.box) { A.live = { kp: p.kp, box: p.box }; st.draw(); } },
    });
    A.live = null;
    if (res.error) {
      setMsg({
        no_batter: 'No player found where you tapped. Pause on a frame where the batter is clear of the catcher and tap the middle of their body.',
        lost_batter: 'Lost track of the batter partway through. Tap the batter again on a frame closer to the pitch.',
        no_swing: 'No swing found, so this may be a pitch they took. Move to the swing and use “Analyze near this spot”.',
      }[res.error] || 'Something went wrong while tracking.');
      return;
    }
    A.analysis = res;
    A.thumb = await makeThumb(st.video, res).catch(() => null);
    computeCall();
    await waitFrame(st.video, Math.max(0, res.events.tContact - 0.01));
    renderReport0(); renderCall(); renderTag();
    setTimeout(() => { const r = root && root.querySelector('#a-report'); if (r && r.scrollIntoView) r.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 60);
  } catch (e) {
    A.live = null;
    if (e && e.name === 'AbortError') setMsg('Stopped.', false);
    else { console.error(e); setMsg('The swing AI couldn’t run on this phone (' + (e && e.message || e) + '). It needs a recent Safari or Chrome.'); }
  } finally {
    poseHook = null; A.abort = null; A.prog = null;
    if (root) { st.lock(false); tapHint(); renderActions(); renderWho(true); st.draw(); analyzeFrame(); }
  }
}
async function makeThumb(video, res) {
  const f = res.frames.reduce((b, x) => (Math.abs(x.t - res.events.tContact) < Math.abs(b.t - res.events.tContact) ? x : b), res.frames[0]);
  await waitFrame(video, f.t);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let k = 0; k < 17; k++) if (f.kp[k * 3 + 2] > 0.2) { x0 = Math.min(x0, f.kp[k * 3]); x1 = Math.max(x1, f.kp[k * 3]); y0 = Math.min(y0, f.kp[k * 3 + 1]); y1 = Math.max(y1, f.kp[k * 3 + 1]); }
  if (!Number.isFinite(x0)) return null;
  const size = Math.max(x1 - x0, y1 - y0) * 1.5, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const c = document.createElement('canvas'); c.width = c.height = 240;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 240, 240);
  g.drawImage(video, cx - size / 2, cy - size / 2, size, size, 0, 0, 240, 240);
  return c.toDataURL('image/jpeg', 0.72);
}
function renderReport0() {
  const el = root.querySelector('#a-report'); if (!el) return;
  const a = A.analysis;
  el.innerHTML = a ? `<h2 class="sec">Swing breakdown${whoInfo() ? ' · ' + esc(whoInfo().label) : ''}</h2>` + breakdownHTML({ events: a.events, metrics: a.metrics, series: a.series, ball: a.ball && a.ball.found ? { found: true, air: a.ball.air, type: a.ball.type, track: a.ball.track } : { found: false } }) : '';
}

// ---------- the call
function computeCall() {
  const a = A.analysis, w = whoInfo();
  if (!a || !w || !A.bats) { A.pred = null; return; }
  const list = H.swings().filter((s) => s.id !== A.savedId);
  const p = M.predict(list, w.key, M.featureVector({ metrics: a.metrics, events: a.events }));
  p.baseline = M.baselinePick(list, w.key);
  A.pred = p;
}
function renderCall() {
  const el = root.querySelector('#a-call'); if (!el) return;
  el.innerHTML = A.analysis && A.pred ? callHTML(A.pred, A.bats, { title: 'The call: where this swing is likely to go', frozen: A.frozen }) : '';
}

// ---------- what happened + save
const KINDS = [['inplay', 'In play'], ['foul', 'Foul'], ['miss', 'Swing and miss'], ['practice', 'Practice swing']];
const TYPES = [['GB', 'Ground ball'], ['LD', 'Line drive'], ['FB', 'Fly ball'], ['PU', 'Pop up'], ['BU', 'Bunt']];
const RESULTS = [['OUT', 'Out'], ['1B', 'Single'], ['2B', 'Double'], ['3B', 'Triple'], ['HR', 'Home run'], ['E', 'Error'], ['FC', 'Fielder’s choice'], ['', 'Not sure']];
function chips(act, cur, list) { return `<div class="pick-chips">${list.map(([k, l]) => `<button type="button" class="pick${cur === k ? ' on' : ''}" data-sw="${act}" data-v="${k}" aria-pressed="${cur === k}">${esc(l)}</button>`).join('')}</div>`; }
function renderTag() {
  const el = root.querySelector('#a-tag'); if (!el) return;
  const a = A.analysis, w = whoInfo();
  if (!a || !w) { el.innerHTML = ''; return; }
  const t = A.tag;
  if (A.savedId) {
    el.innerHTML = `<section class="card stack" style="padding:14px"><p style="margin:0"><b>Saved to ${esc(w.label)}.</b> ${w.pid ? 'Coaches and their family can see it.' : 'Coaches can see it, and it counts toward this hitter’s scouting.'}</p>
      <div class="row" style="flex-wrap:wrap"><label class="btn primary" for="a-file">Analyze another clip</label><button type="button" class="btn" data-sw="seeHitter" data-k="${esc(w.key)}">See their swings</button></div></section>`;
    return;
  }
  let h = `<h2 class="sec">What happened?</h2><section class="card stack" style="padding:14px">${chips('kind', t.kind, KINDS)}`;
  if (t.kind === 'inplay') {
    const z = zoneLabel(t.x, t.y, A.bats);
    const verdict = t.x != null && A.pred ? (zoneOfPlay(t.x, t.y, A.bats) === A.pred.best ? '<b class="sw-good">The call was right.</b>' : `The call said ${esc(M.ZONE_LABEL[M.ZONES[A.pred.best]].toLowerCase())}.`) : '';
    h += `<div class="small muted">Tap the field where the ball went${a.ball && a.ball.found && a.ball.type ? '' : ''}.</div>
      ${fieldFeetSVG({ tap: 'fieldTap', marker: t.x != null ? { x: t.x, y: t.y } : null, dist: A.pred && A.frozen ? A.pred.dist : null, best: A.pred && A.pred.best, bats: A.bats, label: 'Tap where the ball went' })}
      ${t.x != null ? `<div class="small">${esc(z)} · ${Math.round(Math.hypot(t.x, t.y))} ft. ${verdict}</div>` : ''}
      <div><span class="field-lbl">Batted ball${a.ball && a.ball.found && a.ball.type ? ' <span class="muted">(the AI thinks ' + esc(M.TYPE_LABEL[a.ball.type].toLowerCase()) + ')</span>' : ''}</span>${chips('type', t.type, TYPES)}</div>
      <div><span class="field-lbl">Result</span>${chips('result', t.result, RESULTS)}</div>`;
  }
  h += `<details class="sw-more"><summary>Game details (optional)</summary><div class="grid2" style="margin-top:8px"><label><span class="field-lbl">Game</span><input class="input" data-sw-in="game" value="${esc(A.game)}" placeholder="vs Hardknox" autocomplete="off"></label><label><span class="field-lbl">Count</span><input class="input" data-sw-in="count" value="${esc(A.count)}" placeholder="1-0" autocomplete="off"></label></div></details>`;
  const ok = t.kind && (t.kind !== 'inplay' || (t.x != null && t.type));
  const need = !t.kind ? 'Pick what happened.' : t.kind === 'inplay' && t.x == null ? 'Tap where the ball went.' : t.kind === 'inplay' && !t.type ? 'Pick the batted-ball type.' : '';
  h += `<div class="row"><button type="button" class="btn primary" data-sw="save" ${ok && !A.saving ? '' : 'disabled'}>${A.saving ? 'Saving…' : 'Save to ' + esc(w.short)}</button><span class="small muted grow">${esc(need)}</span></div></section>`;
  el.innerHTML = h;
}
const freeze = () => { if (A.pred && !A.frozen) { A.frozen = true; renderCall(); } };
ACT.kind = (d) => { A.tag.kind = d.v; if (d.v !== 'inplay') Object.assign(A.tag, { type: '', result: '', x: null, y: null }); else if (!A.tag.type && A.analysis.ball && A.analysis.ball.type) A.tag.type = A.analysis.ball.type; freeze(); renderTag(); };
ACT.type = (d) => { A.tag.type = d.v; freeze(); renderTag(); };
ACT.result = (d) => { A.tag.result = d.v; renderTag(); };
ACT.fieldTap = (d, el, e) => { const svg = el.closest('svg'); const q = svgFeet(svg, e); if (q.y < -10) return; A.tag.x = q.x; A.tag.y = q.y; freeze(); renderTag(); };
IN.game = (el) => { A.game = el.value; };
IN.count = (el) => { A.count = el.value; };
ACT.seeHitter = (d) => { S.hitter = d.k; show('hitter'); };
ACT.save = async () => {
  const a = A.analysis, w = whoInfo(), u = H.user(), t = A.tag;
  if (!a || !w || A.saving || !t.kind) return;
  A.saving = true; renderTag();
  const id = H.newId(), now = Date.now();
  const ev = roundObj(a.events);
  const p = A.pred;
  const doc = {
    pid: w.pid, opp: w.opp, oppName: w.oppName, hitterKey: w.key, hitter: w.hitter, bats: A.bats,
    outcome: { kind: t.kind, type: t.kind === 'inplay' ? t.type : null, result: t.kind === 'inplay' ? (t.result || null) : t.kind === 'foul' ? 'FOUL' : t.kind === 'miss' ? 'MISS' : null, x: t.kind === 'inplay' ? t.x : null, y: t.kind === 'inplay' ? t.y : null },
    swing: { events: ev, metrics: roundObj(a.metrics), H: Math.round(a.H), frames: a.frames.length },
    features: roundObj(M.featureVector({ metrics: a.metrics, events: a.events })),
    ball: a.ball && a.ball.found ? { found: true, air: a.ball.air == null ? null : !!a.ball.air, type: a.ball.type || null, n: a.ball.track.length } : { found: false },
    prediction: p && A.frozen ? { dist: p.dist.map(r3), best: p.best, confidence: p.confidence, nHitter: p.nHitter, similar: r3(p.similar), baseline: p.baseline } : null,
    auto: null, source: 'analyze', game: String(A.game || '').trim().slice(0, 60), count: String(A.count || '').trim().slice(0, 10), inning: '',
    clip: { name: String(A.file ? A.file.name : '').slice(0, 80), duration: r3(analyzeStage.video.duration) },
    needsReview: false, by: u.uid, createdAt: now, updatedAt: now,
  };
  const st = analyzeStage.video;
  const media = {
    pid: w.pid, opp: w.opp, by: u.uid, thumb: A.thumb || null,
    series: { t: a.series.t.map(r3), sh: a.series.sh.map(r3), hp: a.series.hp.map(r3) },
    track: a.ball && a.ball.found ? a.ball.track.map((q) => ({ t: r3(q.t), x: Math.round(q.x), y: Math.round(q.y) })) : [],
    frames: packFrames(a.frames, st.videoWidth, st.videoHeight),
    events: ev,
  };
  try {
    await H.save(id, doc, media);
    A.savedId = id;
    H.toast('Swing saved to ' + w.label);
  } catch (e) {
    console.error(e);
    H.toast(e && e.code === 'permission-denied' ? 'Couldn’t save. Check that the latest security rules are published.' : 'Couldn’t save the swing. Check your connection and try again.');
  }
  A.saving = false; renderTag();
};

// ================================================================== Hitters
function hitterGroups() {
  const by = new Map();
  for (const s of H.swings()) {
    if (!s.hitterKey) continue;
    if (!by.has(s.hitterKey)) by.set(s.hitterKey, { key: s.hitterKey, pid: s.pid || '', opp: s.opp || '', oppName: s.oppName || '', hitter: s.hitter || {}, bats: s.bats || '', swings: [] });
    const g = by.get(s.hitterKey);
    g.swings.push(s);
    if (s.bats && !g.bats) g.bats = s.bats;
  }
  const team = H.team();
  for (const g of by.values()) {
    if (g.pid) { const p = team.players.find((x) => x.id === g.pid); if (p) g.hitter = { name: p.name, number: String(p.num || ''), team: team.name }; }
    g.label = (g.hitter.number ? '#' + g.hitter.number + ' ' : '') + (g.hitter.name || 'Hitter');
  }
  return [...by.values()];
}
const avg = (list, f) => { const v = list.map(f).filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
function renderHitters() {
  const el = root.querySelector('[data-view="hitters"]'); if (!el) return;
  const u = H.user();
  if (!u.allowed) { show('analyze'); return; }
  if (!H.loaded()) { el.innerHTML = '<div class="card empty" style="padding:18px"><p>Loading swings…</p></div>'; return; }
  const groups = hitterGroups();
  if (!groups.length) { el.innerHTML = `<div class="card empty" style="padding:20px"><p>No swings saved yet. Analyze a clip and save it to start each player’s swing history.</p><button type="button" class="btn primary" data-sw="view" data-v="analyze">Analyze a swing</button></div>`; return; }
  const ours = groups.filter((g) => g.pid).sort((a, b) => (Number(a.hitter.number) || 999) - (Number(b.hitter.number) || 999) || String(a.hitter.name).localeCompare(String(b.hitter.name)));
  const opp = groups.filter((g) => !g.pid);
  const row = (g) => {
    const last = g.swings[0], dc = avg(g.swings, (s) => s.swing && s.swing.metrics && s.swing.metrics.downToContact);
    const bip = g.swings.filter((s) => M.inPlay(s)).length;
    return `<button type="button" class="player" data-sw="seeHitter" data-k="${esc(g.key)}"><span class="no">${esc(g.hitter.number || '–')}</span><span style="min-width:0"><span class="nm">${esc(g.hitter.name || 'Hitter')}</span><span class="meta">${g.swings.length} swing${g.swings.length === 1 ? '' : 's'}${bip ? ' · ' + bip + ' in play' : ''}${dc != null ? ' · foot down → contact ' + dc.toFixed(2) + ' s' : ''} · last ${dateOf(last.createdAt)}</span></span><span class="fee-go" aria-hidden="true">›</span></button>`;
  };
  let h = '';
  if (ours.length) h += `<h2 class="sec">${esc(H.team().name)}</h2><div class="card roster">${ours.map(row).join('')}</div>`;
  const byTeam = new Map();
  for (const g of opp) { const k = g.oppName || 'Opponent'; if (!byTeam.has(k)) byTeam.set(k, []); byTeam.get(k).push(g); }
  for (const [name, list] of [...byTeam.entries()].sort((a, b) => a[0].localeCompare(b[0]))) h += `<h2 class="sec">${esc(name)}</h2><div class="card roster">${list.sort((a, b) => (Number(a.hitter.number) || 999) - (Number(b.hitter.number) || 999)).map(row).join('')}</div>`;
  if (u.admin) {
    const sc = M.scorecard(H.swings());
    if (sc.n) h += `<h2 class="sec">How good are the calls?</h2><section class="card stack" style="padding:14px"><p style="margin:0">On ${sc.n} swing${sc.n === 1 ? '' : 's'} tagged after the call was made, it named the right part of the field <b>${pct(sc.wedge)}</b> of the time and the right side <b>${pct(sc.side)}</b>. Guessing each hitter’s usual spot would have been right ${pct(sc.baseline)}.</p></section>`;
  }
  el.innerHTML = h;
}
function renderHitter() {
  const el = root.querySelector('[data-view="hitter"]'); if (!el) return;
  const g = hitterGroups().find((x) => x.key === S.hitter);
  if (!g) { el.innerHTML = `<div class="row"><button type="button" class="btn ghost sm" data-sw="view" data-v="hitters">‹ Hitters</button></div><div class="card empty" style="padding:18px"><p>No swings saved for this hitter.</p></div>`; return; }
  const list = H.swings(), bats = g.bats || 'R';
  const p = M.predict(list, g.key, null);
  const bip = g.swings.filter((s) => M.inPlay(s));
  const f = fieldCfg(), def = M.defense(list, g.key, bats, f);
  const ms = (k) => avg(g.swings, (s) => s.swing && s.swing.metrics && s.swing.metrics[k]);
  const hl = ms('hipLead');
  const tiles = [
    ['Leg lift → contact', fmtS(ms('liftToContact'))], ['Foot down → contact', fmtS(ms('downToContact'))],
    ['Hips vs shoulders', hl == null ? '—' : Math.abs(hl) < 0.035 ? 'Together' : hl > 0 ? 'Hips first' : 'Shoulders first'],
    ['Head drift', ms('headDrift') == null ? '—' : Math.round(ms('headDrift') * 100) + '%'],
  ];
  let h = `<div class="row"><button type="button" class="btn ghost sm" data-sw="view" data-v="hitters">‹ Hitters</button></div>
    <section class="card stack" style="padding:14px"><div class="row"><div class="grow"><b style="font-size:20px">${esc(g.label)}</b><div class="small muted">${esc(g.pid ? H.team().name : g.oppName)} · bats ${esc(bats === 'L' ? 'left' : 'right')} · ${g.swings.length} swing${g.swings.length === 1 ? '' : 's'}</div></div></div>
    <div class="swing-stats sw-avg">${tiles.map(([l, v]) => `<div><span>${l}</span><b class="txt">${esc(v)}</b></div>`).join('')}</div><p class="small muted" style="margin:0">Averages across their saved swings.</p></section>`;
  h += callHTML(p, bats, { title: 'The call for their next ball in play', field: true, dots: bip.map((s) => ({ x: s.outcome.x, y: s.outcome.y, type: s.outcome.type })) });
  if (bip.length) h += `<section class="card" style="padding:12px 14px"><b>Where to play them</b><p class="small" style="margin:4px 0 0">${esc(M.describeShift(def, bats))}</p></section>`;
  h += `<h2 class="sec">Swings</h2><div class="card roster">${g.swings.map((s) => {
    const o = s.outcome || {}, m = (s.swing && s.swing.metrics) || {};
    const what = o.kind === 'inplay' ? [M.TYPE_LABEL[o.type], o.result && M.RESULT_LABEL[o.result], zoneLabel(o.x, o.y, s.bats)].filter(Boolean).join(' · ') : o.kind === 'practice' ? 'Practice swing' : M.RESULT_LABEL[o.result] || 'Swing';
    return `<button type="button" class="player" data-sw="openSwing" data-id="${esc(s.id)}"><span class="no" style="font-size:13px">${esc(dateOf(s.createdAt))}</span><span style="min-width:0"><span class="nm">${esc(what)}</span><span class="meta">${s.source === 'scout' ? 'From game video' : 'Analyzed clip'}${Number.isFinite(m.downToContact) ? ' · foot down → contact ' + m.downToContact.toFixed(2) + ' s' : ''}${s.game ? ' · ' + esc(s.game) : ''}</span></span><span class="fee-go" aria-hidden="true">›</span></button>`;
  }).join('')}</div>`;
  el.innerHTML = h;
}

// ---------- one saved swing
ACT.openSwing = (d) => { S.report = d.id; S.media = null; S.mediaErr = ''; show('report'); loadMedia(d.id); };
async function loadMedia(id) {
  try { const m = await H.media(id); if (S.report !== id) return; S.media = m || { missing: true }; }
  catch (e) { if (S.report !== id) return; S.mediaErr = 'Couldn’t load this swing’s replay.'; }
  if (S.view === 'report') renderReport();
}
function renderReport() {
  const el = root.querySelector('[data-view="report"]'); if (!el) return;
  const s = H.swings().find((x) => x.id === S.report);
  cancelAnimationFrame(S.anim);
  if (!s) { el.innerHTML = `<div class="row"><button type="button" class="btn ghost sm" data-sw="view" data-v="hitters">‹ Hitters</button></div><div class="card empty" style="padding:18px"><p>This swing was deleted.</p></div>`; return; }
  const u = H.user(), md = S.media, o = s.outcome || {};
  const label = (s.hitter && (s.hitter.number ? '#' + s.hitter.number + ' ' : '') + (s.hitter.name || '')) || 'Swing';
  const what = o.kind === 'inplay' ? [M.TYPE_LABEL[o.type], o.result && M.RESULT_LABEL[o.result], zoneLabel(o.x, o.y, s.bats) && 'to ' + zoneLabel(o.x, o.y, s.bats).toLowerCase()].filter(Boolean).join(', ') : o.kind === 'practice' ? 'Practice swing' : M.RESULT_LABEL[o.result] || '';
  const canDel = u.admin || s.by === u.uid;
  let h = `<div class="row"><button type="button" class="btn ghost sm" data-sw="seeHitter" data-k="${esc(s.hitterKey)}">‹ ${esc(label)}</button></div>
    <section class="card stack" style="padding:14px"><div class="row"><div class="grow"><b>${esc(label)}</b><div class="small muted">${esc(dateOf(s.createdAt))} · ${s.source === 'scout' ? 'from game video' : 'analyzed clip'}${s.game ? ' · ' + esc(s.game) : ''}</div></div></div>
    ${what ? `<p style="margin:0">${esc(what)}.</p>` : ''}
    <div class="sw-replay">${md && md.thumb ? `<img src="${esc(md.thumb)}" alt="The batter at contact">` : ''}<canvas width="480" height="480" aria-label="Replay of the swing as a stick figure"></canvas></div>
    ${!md ? `<p class="small muted" style="margin:0">${esc(S.mediaErr || 'Loading the replay…')}</p>` : md.missing ? '<p class="small muted" style="margin:0">No replay saved for this swing.</p>' : ''}</section>`;
  if (s.swing) h += breakdownHTML({ events: s.swing.events, metrics: s.swing.metrics, series: md && md.series, ball: s.ball });
  if (s.prediction && Array.isArray(s.prediction.dist)) {
    const p = Object.assign({ sides: M.sides(s.prediction.dist), confidence: s.prediction.confidence || 'low', nHitter: s.prediction.nHitter || 0, similar: s.prediction.similar || 0 }, s.prediction);
    h += callHTML(p, s.bats, { title: 'The call made before the result', frozen: true, field: M.inPlay(s), dots: M.inPlay(s) ? [{ x: o.x, y: o.y, type: o.type }] : [] });
  } else if (M.inPlay(s)) h += `<section class="card" style="padding:12px 14px">${fieldFeetSVG({ dots: [{ x: o.x, y: o.y, type: o.type }], label: 'Where the ball went' })}</section>`;
  if (canDel) h += `<div class="row"><button type="button" class="btn danger" data-sw="delSwing" data-id="${esc(s.id)}">Delete this swing</button></div>`;
  el.innerHTML = h;
  if (md && md.frames && md.frames.kp) startStick(el.querySelector('.sw-replay canvas'), md, s.swing && s.swing.events);
}
// The saved keypoints, replayed as a stick figure (slow motion, on a loop).
function startStick(cv, md, ev) {
  let frames; try { frames = unpackFrames(md.frames); } catch (e) { return; }
  if (!frames.length || !cv) return;
  const tc = ev && ev.tContact != null ? ev.tContact : frames[Math.floor(frames.length / 2)].t;
  const t0 = Math.max(frames[0].t, (ev && ev.tLift != null ? ev.tLift : tc - 0.9) - 0.3), t1 = Math.min(frames[frames.length - 1].t, tc + 0.6);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const f of frames) { if (f.t < t0 || f.t > t1) continue; for (let k = 0; k < 17; k++) if (f.kp[k * 3 + 2] > 0.2) { x0 = Math.min(x0, f.kp[k * 3]); x1 = Math.max(x1, f.kp[k * 3]); y0 = Math.min(y0, f.kp[k * 3 + 1]); y1 = Math.max(y1, f.kp[k * 3 + 1]); } }
  if (!Number.isFinite(x0)) return;
  const W = cv.width, size = Math.max(x1 - x0, y1 - y0) * 1.25, s = W / size, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const P = (x, y) => [W / 2 + (x - cx) * s, W / 2 + (y - cy) * s];
  const c = cv.getContext('2d');
  const track = (md.track || []).filter((q) => Number.isFinite(q.x));
  const start = performance.now(), speed = 0.3;
  const loop = (now) => {
    if (!cv.isConnected) return;
    const t = t0 + (((now - start) / 1000 * speed) % Math.max(0.2, t1 - t0 + 0.3));
    c.fillStyle = '#0B1A33'; c.fillRect(0, 0, W, W);
    const f = frames.reduce((b, x) => (Math.abs(x.t - t) < Math.abs(b.t - t) ? x : b), frames[0]);
    skeleton(c, P, f.kp, 'rgba(64,211,190,.95)', W / 70);
    const hd = f.kp; if (hd[2] > 0.2) { const p = P(hd[0], hd[1]); c.strokeStyle = 'rgba(64,211,190,.95)'; c.lineWidth = W / 90; c.beginPath(); c.arc(p[0], p[1], W / 28, 0, 7); c.stroke(); }
    const pts = track.filter((q) => q.t <= t + 0.01);
    pts.forEach((q, i) => { const p = P(q.x, q.y); if (p[0] < -20 || p[0] > W + 20 || p[1] < -20 || p[1] > W + 20) return; c.fillStyle = `rgba(255,196,61,${0.4 + 0.6 * (i + 1) / pts.length})`; c.beginPath(); c.arc(p[0], p[1], W / 80, 0, 7); c.fill(); });
    c.fillStyle = '#FFFFFF'; c.font = `700 ${Math.round(W / 24)}px "Barlow Semi Condensed", sans-serif`; c.fillText(phaseAt(ev, t) || '', W / 30, W / 15);
    S.anim = requestAnimationFrame(loop);
  };
  S.anim = requestAnimationFrame(loop);
}
ACT.delSwing = async (d) => {
  if (!confirm('Delete this swing? This can’t be undone.')) return;
  try { await H.remove(d.id); H.toast('Swing deleted'); const s = H.swings().find((x) => x.id === d.id); if (s) S.hitter = s.hitterKey; show('hitter'); }
  catch (e) { H.toast(e && e.code === 'permission-denied' ? 'You can only delete swings you saved.' : 'Couldn’t delete. Check your connection.'); }
};

// ================================================================== Scout a game (coaches)
const G = { files: [], fi: -1, bp: 60, taps: [], cal: null, baseErr: '', teams: null, teamNote: '', target: 'all', game: '', phase: 'empty', needCal: null, calDone: null, plays: [], clusters: [], abort: null, live: null, watch: null, stats: null, wake: null, startedAt: 0, saveAs: { kind: 'opp', opp: '', name: '' }, prog: null, adjust: null, saving: false };
const BASES = ['home plate', 'first base', 'second base', 'third base'];
const BASE_SHORT = ['Home', '1st', '2nd', '3rd'];
const DRAFT_KEY = 'gs-hub-scout-draft';

function buildScout() {
  const v = root.querySelector('[data-view="scout"]');
  v.innerHTML = `<section class="card stack" style="padding:14px" id="g-intro"></section>
    <div id="g-stage"></div><div class="pick-chips" id="g-parts"></div>
    <section class="card stack" style="padding:14px" id="g-bases" hidden></section>
    <section class="card stack" style="padding:14px" id="g-team" hidden></section>
    <section class="card stack" style="padding:14px" id="g-run" hidden></section>
    <div id="g-results"></div>
    <input type="file" id="g-file" class="vh" accept="video/*" multiple data-sw-ch="gfile">`;
  scoutStage = new Stage(v.querySelector('#g-stage'), { onTap: scoutTap, draw: scoutDraw, onFrame: scoutFrame });
  restoreDraft();
}
function renderScout() {
  if (!H.user().admin) { show('analyze'); return; }
  const has = G.files.length > 0, ph = G.phase;
  root.querySelector('#g-intro').innerHTML = has && !G.abort && (ph === 'done' || ph === 'stopped') ? `<div class="row"><span class="grow small muted">${esc(G.files.map((f) => f.file.name).join(', '))}</span><label class="btn sm" for="g-file">Scout another game</label></div>`
    : has ? `<div class="small muted">${esc(G.files.length > 1 ? G.files.length + ' parts: ' : '')}${esc(G.files.map((f) => f.file.name).join(', '))}</div>`
    : `<b>Scout a whole game</b><p class="small" style="margin:0">Swing AI watches a game video by itself, finds every ball in play, measures each swing and places the ball on the spray chart. Use it on an opponent to scout them, or on your own team.</p>
      <ol class="sw-steps"><li><b>Get the game on this phone.</b> Play it in GameChanger full screen and record it with Screen Recording, or use a video someone filmed.</li><li><b>Tap the four bases</b> on one frame.</li><li><b>Start scouting</b> and leave this screen open. It takes roughly a third to a half of the video’s length.</li></ol>
      <div class="row"><label class="btn primary" for="g-file">Choose the game video</label></div>`;
  root.querySelector('#g-intro').hidden = false;
  root.querySelector('#g-bases').hidden = !(ph === 'bases' || ph === 'team' || G.needCal != null);
  root.querySelector('#g-team').hidden = ph !== 'team';
  root.querySelector('#g-run').hidden = !(ph === 'team' || ph === 'running' || ph === 'done' || ph === 'stopped' || G.needCal != null) || (!!G.restored && !G.files.length);
  if (!root.querySelector('#g-bases').hidden) renderBases();
  if (ph === 'team') renderTeam();
  renderRun(); renderResults(); renderParts();
}
function renderParts() {
  const q = root.querySelector('#g-parts');
  q.innerHTML = G.files.length < 2 ? '' : G.files.map((it, i) => `<span class="pick${i === G.fi ? ' on' : ''}">Part ${i + 1}${it.dur ? ' · ' + mmss(it.dur) : ''}${it.status === 'done' ? ' ✓' : ''}</span>`).join('');
}
IN.gfile = async (el) => {
  const files = [...(el.files || [])]; el.value = '';
  if (!files.length) return;
  if (G.abort) { H.toast('Stop scouting before changing the video.'); return; }
  const unsaved = G.plays.filter((p) => p.include && !p.savedId).length;
  if (unsaved && !confirm(`${unsaved} ball${unsaved === 1 ? '' : 's'} in play from the last video aren’t saved yet. Start a new game anyway?`)) return;
  await loadScoutMods();
  files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  clearDraft();
  Object.assign(G, { files: files.map((f) => ({ file: f, status: 'new', dur: null, cal: null })), taps: [], cal: null, baseErr: '', teams: null, teamNote: '', target: 'all', game: '', needCal: null, plays: [], clusters: [], watch: null, live: null, stats: null, adjust: null, restored: null });
  G.bp = fieldCfg().basePath;
  ensurePose().catch(() => {});
  if (!(await scOpen(0))) return;
  for (let i = 1; i < G.files.length; i++) G.files[i].dur = await videoDuration(G.files[i].file).catch(() => null);
  G.phase = 'bases';
  renderScout(); scoutStage.draw();
};
function videoDuration(file) {
  return new Promise((res, rej) => {
    const v = document.createElement('video'); v.preload = 'metadata'; v.muted = true;
    const u = URL.createObjectURL(file);
    v.onloadedmetadata = () => { res(v.duration); URL.revokeObjectURL(u); };
    v.onerror = () => { rej(new Error('decode')); URL.revokeObjectURL(u); };
    v.src = u;
  });
}
async function scOpen(i, at) {
  G.fi = i; const it = G.files[i];
  try { await scoutStage.open(it.file); }
  catch (e) { H.toast('This phone couldn’t open that video. Try an .mp4 or .mov file.'); G.phase = 'empty'; G.files = []; renderScout(); return false; }
  const sv = scoutStage.video;
  it.dur = sv.duration;
  await waitFrame(sv, at != null ? at : Math.min(sv.duration * 0.08, 45));
  scoutStage.draw(); renderParts();
  return true;
}

// ---------- the bases
function curCal() { return G.needCal != null ? G.files[G.needCal].cal : ((G.files[G.fi] && G.files[G.fi].cal) || G.cal); }
function scoutTap(p) {
  if (G.phase !== 'bases' || G.taps.length >= 4) return;
  const st = scoutStage; st.video.pause();
  if (p.small && !st.zoom) { st.setZoom({ x: p.x, y: p.y, z: 3 }); renderBases(); return; }
  G.taps.push([Math.round(p.x), Math.round(p.y)]);
  st.setZoom(null);
  if (G.taps.length === 4) scCalibrate();
  renderBases(); st.draw();
}
function scCalibrate() {
  const sv = scoutStage.video, content = SC.contentRect(sv);
  const cal = F.calibrate({ taps: G.taps, basePath: G.bp, vw: sv.videoWidth, vh: sv.videoHeight, content });
  if (!cal.ok) { G.baseErr = cal.error; G.taps = []; setCal(null); return; }
  cal.print = SC.viewPrint(sv, content); cal.t = sv.currentTime;
  G.baseErr = cal.warnings.join(' ');
  setCal(cal);
}
function setCal(cal) {
  if (G.needCal != null) G.files[G.needCal].cal = cal;
  else { G.cal = cal; G.files.forEach((f, i) => { if (i === 0 || (f.cal && f.cal.shared)) f.cal = cal && { ...cal, shared: i > 0 }; }); }
}
function renderBases() {
  const el = root.querySelector('#g-bases'), n = G.taps.length, cal = curCal(), st = scoutStage;
  const text = (G.needCal != null ? `Part ${G.needCal + 1} shows a different camera view, so mark the bases again for it. ` : '')
    + (n < 4 ? `Move to a frame where all four bases are visible and nobody is standing on them, then tap <b>${BASES[n]}</b>${st.zoom ? ' exactly' : ''}.` : cal ? 'Check the white lines: they should sit on the foul lines and base paths. If they’re off, start over and tap the middle of each base.' : '');
  el.innerHTML = `<div class="row"><b class="grow">Mark the bases</b><span class="small muted">${n === 4 && cal ? 'field set' : n + ' of 4'}</span></div>
    <div class="pick-chips">${BASE_SHORT.map((b, i) => `<span class="pick${i < n ? ' on' : ''}">${i < n ? '✓ ' : ''}${b}</span>`).join('')}</div>
    <p class="small" style="margin:0">${text}</p>
    ${G.baseErr ? `<p class="warn-text" style="margin:0">${esc(G.baseErr)}</p>` : ''}
    <div class="row" style="flex-wrap:wrap"><label class="small">Base paths <select class="input" style="width:auto;display:inline-block;margin-left:6px" data-sw-ch="bp">${[46, 50, 60, 65, 70, 80, 90].map((v) => `<option value="${v}" ${v === G.bp ? 'selected' : ''}>${v} ft</option>`).join('')}</select></label>
      <span class="grow"></span><button type="button" class="btn ghost sm" data-sw="gUndo">Undo</button><button type="button" class="btn ghost sm" data-sw="gRedo">Start over</button>
      ${n === 4 && cal && G.phase === 'bases' ? '<button type="button" class="btn primary sm" data-sw="gBasesOk">The lines look right</button>' : ''}</div>`;
  if (G.phase === 'bases') st.hint(st.zoom ? `Now tap <b>${BASES[n]}</b> exactly` : n < 4 ? `Tap <b>${BASES[n]}</b>` : null);
  else st.hint(null);
}
IN.bp = (el) => { G.bp = +el.value; setFieldCfg({ basePath: G.bp, fence: Math.round(G.bp * 3.3) }); if (G.taps.length === 4) scCalibrate(); renderBases(); scoutStage.draw(); };
ACT.gUndo = () => { if (G.abort && G.needCal == null) return; if (G.phase === 'team') G.phase = 'bases'; if (scoutStage.zoom) scoutStage.setZoom(null); else if (G.taps.length) { G.taps.pop(); setCal(null); G.baseErr = ''; } renderScout(); scoutStage.draw(); };
ACT.gRedo = () => { if (G.abort && G.needCal == null) return; if (G.phase === 'team') G.phase = 'bases'; G.taps = []; scoutStage.setZoom(null); setCal(null); G.baseErr = ''; renderScout(); scoutStage.draw(); };
ACT.gBasesOk = () => {
  if (G.needCal != null) { const r = G.calDone; G.needCal = null; G.calDone = null; G.phase = 'running'; renderScout(); if (r) r(); return; }
  G.phase = 'team'; scoutStage.hint(null); renderScout(); scoutStage.draw(); readTeams();
};

// ---------- the scoreboard and whose hitters
const SCORE_PROMPT = `This image is the top-left part of one frame of a youth baseball video recorded with the GameChanger app. Read the scoreboard overlay if there is one.
Reply with only a JSON object in exactly this shape:
{"found": true, "batter": {"name": "M Eubanks", "number": "1", "line": "1 for 2"}, "pitcher": {"name": "T M", "number": "5", "pitches": 63}, "count": "1-0", "outs": 0, "inning": 6, "half": "bottom", "teams": [{"abbr": "VPRM", "runs": 9, "batting": false}, {"abbr": "GRGS", "runs": 5, "batting": true}]}
(Those values are only an example of the format.) Below the two team rows there are one or two player rows, in either order. The batter's row shows a name, #number and a line like "1 for 2" or "0 for 0"; the pitcher's row shows a name, #number and "P:" with a pitch count. Never report the pitcher as the batter: if the only player row shows "P:", use null for the batter. A small dot beside a team abbreviation marks the team at bat. A down-pointing triangle by the inning number means the bottom half, up-pointing means the top. Use null for anything you cannot read, and {"found": false} if there is no scoreboard.`;
async function aiBoard(canvas) {
  const ai = H.ai && H.ai();
  if (!ai) return null;
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
  const d = await ai.json(SCORE_PROMPT, { images: [blob] });
  return d && d.found !== false ? d : null;
}
async function readTeams() {
  G.teams = null; G.teamNote = 'Reading the GameChanger scoreboard…'; renderTeam();
  const sv = scoutStage.video;
  try {
    const corner = OV.cornerCanvas(sv), L = OV.layout(corner);
    let teams = null;
    if (H.ai && H.ai()) {
      const d = await aiBoard(corner).catch(() => null);
      const ts = d && Array.isArray(d.teams) ? d.teams.map((t) => t && t.abbr && String(t.abbr).trim()).filter(Boolean) : [];
      if (ts.length === 2) teams = ts;
    }
    if (!teams && L && L.ok && L.teams) {
      const read = await Promise.all(L.teams.map((r) => OV.ocrLine(OV.rowCanvas(corner, r, { part: 0.45 })).then(OV.parseTeam).catch(() => null)));
      if (read[0] && read[1] && read[0] !== read[1]) teams = read;
    }
    G.teams = teams; G.boardSeen = !!(L && L.ok);
    if (teams) { G.target = 'all'; G.teamNote = `Scoreboard read: ${teams[0]} at ${teams[1]}. Pick whose hitters to scout.`; }
    else G.teamNote = G.boardSeen ? 'Found the scoreboard but couldn’t read the team names, so every batter will be scouted. You may need to type some names at the end.' : 'No GameChanger scoreboard found, so every batter will be scouted and you’ll type the names at the end.';
  } catch (e) { G.teams = null; G.teamNote = 'Couldn’t read the scoreboard, so every batter will be scouted.'; }
  renderTeam(); renderRun();
}
function renderTeam() {
  const el = root.querySelector('#g-team'); if (!el || el.hidden) return;
  const opts = [...(G.teams || []).map((t, i) => [String(i), `${t} hitters`]), ['all', 'Every batter']];
  el.innerHTML = `<b>Whose hitters?</b><p class="small muted" style="margin:0">${esc(G.teamNote)}</p>
    <div class="pick-chips">${opts.map(([v, l]) => `<button type="button" class="pick${String(G.target) === v ? ' on' : ''}" data-sw="gTarget" data-v="${v}">${esc(l)}</button>`).join('')}</div>
    <div id="g-target"></div>
    <label><span class="field-lbl">Game (optional)</span><input class="input" data-sw-in="gGame" value="${esc(G.game)}" placeholder="vs Hardknox, Oct 4" autocomplete="off"></label>`;
  renderScoutTarget();
}
// Where the found balls in play are saved: an opponent's roster (their scouting) or our team.
function renderScoutTarget() {
  const el = root.querySelector('#g-target'); if (!el) return;
  if (el.contains(document.activeElement)) return;
  const s = G.saveAs, ops = H.opponents();
  if (s.kind === 'opp' && !s.opp && !s.name && ops.length === 1) s.opp = ops[0].key;
  el.innerHTML = `<span class="field-lbl">Save them as</span><div class="seg">${[['opp', 'An opponent'], ['us', esc(H.team().name)]].map(([k, l]) => `<button type="button" data-sw="gSaveKind" data-v="${k}" aria-pressed="${s.kind === k}">${l}</button>`).join('')}</div>
    ${s.kind === 'opp' ? `<div style="margin-top:8px">${ops.length ? `<select class="input" data-sw-ch="gOpp"><option value="">Choose the team</option>${ops.map((o) => `<option value="${esc(o.key)}" ${o.key === s.opp ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}<option value="new" ${s.opp === 'new' ? 'selected' : ''}>Another team…</option></select>` : ''}
      ${!ops.length || s.opp === 'new' ? `<input class="input" data-sw-in="gOppName" value="${esc(s.name)}" placeholder="Team name" autocomplete="off" style="margin-top:6px">` : ''}</div>`
    : '<p class="small muted" style="margin:6px 0 0">Each ball goes to the player with that jersey number.</p>'}`;
}
ACT.gTarget = (d) => { G.target = d.v === 'all' ? 'all' : +d.v; if (G.teams && G.target !== 'all' && !G.game) G.game = 'vs ' + G.teams[1 - G.target]; renderTeam(); };
ACT.gSaveKind = (d) => { G.saveAs.kind = d.v; renderScoutTarget(); renderSaveState(); };
IN.gOpp = (el) => { G.saveAs.opp = el.value; renderScoutTarget(); renderSaveState(); };
IN.gOppName = (el) => { G.saveAs.name = el.value; renderSaveState(); };
IN.gGame = (el) => { G.game = el.value; saveDraft(); };
function saveTarget() {
  const s = G.saveAs;
  if (s.kind === 'us') return { kind: 'us' };
  const o = s.opp && s.opp !== 'new' ? H.opponents().find((x) => x.key === s.opp) : null;
  const name = o ? o.name : String(s.name || '').trim();
  return name ? { kind: 'opp', key: o ? o.key : H.oppKey(name), name, roster: o } : null;
}
// a name for each play's batter: the batter row of the scoreboard, read once per distinct row
function boardFor(play, corner) {
  const L = OV.layout(corner);
  play.board = L && L.ok ? { batting: L.batting } : null;
  if (L && L.ok) {
    const rowsKey = L.batter ? [L.batter] : L.players;
    const pr = rowsKey.map((r) => OV.rowPrint(corner, r));
    play.print = pr.length === 1 ? pr[0] : Float32Array.from([...pr[0], ...pr[1]].map((v) => v / Math.SQRT2));
    if (L.batter) play.preview = OV.rowPreview(corner, L.batter);
  }
  let cl = play.print ? G.clusters.find((c) => OV.samePrint(c.print, play.print) > 0.93) : null;
  if (!cl) {
    cl = { id: G.clusters.length + 1, print: play.print || null, name: '', number: '', src: '', plays: [] };
    G.clusters.push(cl);
    cl.reading = readCluster(cl, corner, L).catch(() => {});
  }
  cl.plays.push(play); play.cluster = cl;
  if (play.board && play.board.batting != null && G.teams) play.team = G.teams[play.board.batting];
  return L;
}
async function readCluster(cl, corner, L) {
  let done = false;
  if (H.ai && H.ai()) {
    const d = await aiBoard(corner).catch(() => null);
    if (d && d.batter && d.batter.name) {
      cl.name = String(d.batter.name).trim(); cl.number = d.batter.number != null ? String(d.batter.number).replace(/^#/, '') : ''; cl.src = 'ai'; done = true;
      const bt = Array.isArray(d.teams) ? d.teams.find((t) => t && t.batting) : null;
      if (bt && bt.abbr) cl.team = String(bt.abbr).trim();
      if (d.count) cl.count = d.count;
      if (d.inning) cl.inning = (d.half === 'top' ? 'Top ' : d.half === 'bottom' ? 'Bot ' : '') + d.inning;
    }
  }
  if (!done && L && L.ok) {
    const order = L.batter ? [L.batter, ...L.players.filter((r) => r !== L.batter)] : [...L.players].reverse();
    let chosen = null, b = null;
    for (const row of order) {
      const txt = await OV.ocrLine(OV.rowCanvas(corner, row, { part: 1 }));
      if (OV.isPitcherLine(txt)) continue;
      const pb = OV.parseBatter(txt);
      if (pb && (OV.isBatterLine(txt) || order.length === 1 || row === L.batter)) { chosen = row; b = pb; break; }
      if (pb && !chosen) { chosen = row; b = pb; }
    }
    if (b) { cl.name = b.name; cl.number = b.number; cl.src = 'read'; }
    if (chosen && !L.batter) cl.preview = OV.rowPreview(corner, chosen);
  }
  for (const p of cl.plays) applyCluster(p);
  if (root) { renderResults(); saveDraft(); }
}
function applyCluster(p) {
  const cl = p.cluster; if (!cl) return;
  if (!p.preview && cl.preview) p.preview = cl.preview;
  if (p.nameSrc !== 'typed' && cl.name) { p.name = cl.name; p.number = cl.number; p.nameSrc = cl.src; }
  if (!p.team) p.team = cl.team || '';
  if (!p.count && cl.count) p.count = cl.count;
  if (!p.inning && cl.inning) p.inning = cl.inning;
}

// ---------- running it
async function wakeOn() { try { if (navigator.wakeLock && !G.wake) { G.wake = await navigator.wakeLock.request('screen'); G.wake.addEventListener('release', () => { G.wake = null; }); } } catch (e) { /* not allowed */ } }
function wakeOff() { try { if (G.wake) G.wake.release(); } catch (e) { /* gone */ } G.wake = null; }
document.addEventListener('visibilitychange', () => { if (G.abort && document.visibilityState === 'visible') wakeOn(); });
const scProgress = (text, p) => { G.prog = { text, p }; renderRun(); };
ACT.gGo = () => scoutRun();
ACT.gStop = () => { if (G.abort) G.abort.abort(); };
async function scoutRun() {
  if (G.abort || !G.cal) return;
  const ctl = new AbortController(); G.abort = ctl;
  G.phase = 'running'; G.watch = null; G.startedAt = performance.now();
  G.stats = { checked: 0, found: 0, other: 0, noswing: 0, nobatter: 0, foul: 0, videoDone: 0, perPlay: [] };
  const total = G.files.reduce((s, f) => s + (f.dur || 0), 0) || 1;
  const sv = scoutStage.video;
  scoutStage.lock(true);
  renderScout(); wakeOn();
  poseHook = (p) => scProgress('Downloading the swing AI (first time only, about 13 MB)…', p);
  try {
    scProgress('Getting the swing AI ready…', S.poseProgress);
    const pose = await ensurePose();
    poseHook = null;
    for (let i = 0; i < G.files.length; i++) {
      if (ctl.signal.aborted) throw new DOMException('Stopped', 'AbortError');
      const it = G.files[i];
      if (it.status === 'done') { G.stats.videoDone += it.dur || 0; continue; }
      if (i !== G.fi) { if (!(await scOpen(i, 0))) throw new Error('Part ' + (i + 1) + ' could not be opened'); }
      if (!it.cal) {
        await waitFrame(sv, Math.min(sv.duration * 0.1, 20));
        const sameSize = sv.videoWidth === G.cal.vw && sv.videoHeight === G.cal.vh;
        const look = sameSize ? SC.viewPrint(sv, G.cal.content) : null;
        let sim = 0; if (look) for (let k = 0; k < look.length; k++) sim += look[k] * G.cal.print[k];
        if (sameSize && sim > 0.55) it.cal = { ...G.cal, shared: true };
        else {
          G.prog = null; G.needCal = i; G.taps = []; G.phase = 'bases'; wakeOff(); scoutStage.lock(false);
          renderScout(); scoutStage.draw();
          H.toast(`Part ${i + 1} has a different camera view. Mark the bases for it.`);
          await new Promise((res) => { G.calDone = res; ctl.signal.addEventListener('abort', res, { once: true }); });
          if (ctl.signal.aborted) throw new DOMException('Stopped', 'AbortError');
          scoutStage.lock(true); wakeOn();
        }
      }
      const cal = it.cal;
      const partTxt = G.files.length > 1 ? `part ${i + 1} of ${G.files.length}, ` : '';
      const series = await SC.scanVideo({
        video: sv, cal, signal: ctl.signal, onProgress: (p) => {
          const done = G.stats.videoDone + p.t;
          scProgress(`Watching the game (${partTxt}${mmss(p.t)} of ${mmss(it.dur)})${p.eta != null ? ` · about ${Math.max(1, Math.round(p.eta / 60))} min left in this pass` : ''}`, done / total);
        },
      });
      const cands = SC.findRuns(series);
      for (let k = 0; k < cands.length; k++) {
        if (ctl.signal.aborted) throw new DOMException('Stopped', 'AbortError');
        const cand = cands[k], t1 = performance.now();
        const avgS = G.stats.perPlay.length ? G.stats.perPlay.reduce((a, b) => a + b, 0) / G.stats.perPlay.length : 20;
        const head = `Checking play ${k + 1} of ${cands.length}${G.files.length > 1 ? ` in part ${i + 1}` : ''} · about ${Math.max(1, Math.round((cands.length - k) * avgS / 60))} min left`;
        scProgress(head, (G.stats.videoDone + it.dur * (k / cands.length)) / total);
        G.stats.checked++;
        await waitFrame(sv, Math.max(0, cand.t - 2.2));
        const play = { id: 'p' + i + '_' + k + '_' + Math.round(cand.t * 10), file: i, cand, name: '', number: '', team: '', nameSrc: '', include: false, vw: sv.videoWidth, vh: sv.videoHeight, fileName: it.file.name };
        const corner = OV.cornerCanvas(sv);
        boardFor(play, corner);
        if (G.target !== 'all' && G.teams) {
          let bat = play.board ? play.board.batting : null;
          if (bat == null && play.cluster && play.cluster.reading && H.ai && H.ai()) { await play.cluster.reading; const tm = play.cluster.team; bat = tm ? G.teams.findIndex((x) => slug(x) === slug(tm)) : null; if (bat < 0) bat = null; }
          if (bat != null && bat !== G.target) { G.stats.other++; play.cluster.plays = play.cluster.plays.filter((q) => q !== play); continue; }
        }
        const r = await SC.analyzePlay({
          video: sv, pose, cal, cand, field: fieldCfg(), signal: ctl.signal,
          onProgress: (p) => { if (p.kp || p.box) { G.live = { kp: p.kp, box: p.box }; scoutStage.draw(); } scProgress(`${head} · ${p.stage}`, (G.stats.videoDone + it.dur * ((k + clamp(p.p || 0, 0, 1) * 0.9) / cands.length)) / total); },
        });
        G.live = null; scoutStage.draw();
        G.stats.perPlay.push((performance.now() - t1) / 1000);
        if (r.error) { if (r.error === 'no_swing' || r.error === 'no_run') G.stats.noswing++; else G.stats.nobatter++; play.cluster.plays = play.cluster.plays.filter((q) => q !== play); continue; }
        if (r.outcome && r.outcome.foul) { G.stats.foul++; play.cluster.plays = play.cluster.plays.filter((q) => q !== play); continue; }
        Object.assign(play, r);
        if (r.outcome) {
          play.x = r.outcome.x; play.y = r.outcome.y; play.type = r.outcome.type;
          play.include = r.outcome.conf !== 'low';
          if (r.outcome.tContact) play.tContact = r.outcome.tContact;
        } else { play.x = null; play.y = null; play.type = (r.ball && r.ball.type) || null; play.include = false; play.needsPlace = true; }
        applyCluster(play);
        G.plays.push(play); G.stats.found++;
        renderResults(); renderRun(); saveDraft();
      }
      it.status = 'done'; G.stats.videoDone += it.dur || 0; renderParts();
    }
    G.phase = 'done';
    await Promise.all(G.clusters.map((c) => c.reading));
  } catch (e) {
    G.live = null;
    G.phase = 'stopped';
    if (!(e && e.name === 'AbortError')) { console.error(e); H.toast('Scouting stopped: ' + (e && e.message || e)); }
  } finally {
    poseHook = null; G.abort = null; G.prog = null; wakeOff(); G.needCal = null;
    G.runSecs = (performance.now() - G.startedAt) / 1000;
    if (root) { scoutStage.lock(false); renderScout(); scoutStage.draw(); }
  }
}
function renderRun() {
  const el = root && root.querySelector('#g-run'); if (!el || el.hidden) return;
  const ph = G.phase, total = G.files.reduce((s, f) => s + (f.dur || 0), 0), st = G.stats;
  let h = `<div class="row"><b class="grow">Scout it</b><span class="small muted">${total ? mmss(total) + ' of video' : ''}</span></div>`;
  if (ph === 'team') {
    const lo = Math.max(2, Math.round(total * 0.3 / 60)), hi = Math.max(4, Math.round(total * 0.6 / 60));
    h += `<p class="small" style="margin:0">This takes roughly ${lo}–${hi} minutes on a phone for ${mmss(total)} of video. Keep this screen open and the phone plugged in; the screen stays on while it works.</p>
      <div class="row"><button type="button" class="btn primary" data-sw="gGo" ${G.cal ? '' : 'disabled'}>Start scouting</button></div>`;
  } else if (st) {
    const skipped = st.other + st.noswing + st.nobatter + st.foul;
    const lead = G.needCal != null ? `Paused until the bases are marked for part ${G.needCal + 1}.` : ph === 'running' ? 'Working on it. Balls in play show up below as they’re found.' : ph === 'done' ? `Done in ${Math.max(1, Math.round((G.runSecs || 0) / 60))} min.` : 'Stopped. What was found so far is below.';
    h += `<p class="small" style="margin:0">${lead}</p>`;
    if (G.prog && G.abort) h += `<div class="sw-prog"><div class="row"><span class="grow small">${esc(G.prog.text)}</span><button type="button" class="btn sm" data-sw="gStop">Stop</button></div><div class="sw-bar"><i style="width:${Math.round(clamp(G.prog.p || 0, 0, 1) * 100)}%"></i></div></div>`;
    else if (G.abort) h += `<div class="row"><button type="button" class="btn sm" data-sw="gStop">Stop</button></div>`;
    h += `<div class="swing-stats"><div><span>Balls in play</span><b>${st.found}</b></div><div><span>Plays checked</span><b>${st.checked}</b></div><div><span>Skipped</span><b>${skipped}</b></div></div>`;
    if (skipped) h += `<p class="small muted" style="margin:0">Skipped: ${[st.other && `${st.other} by the other team`, st.noswing && `${st.noswing} that weren’t a ball in play`, st.foul && `${st.foul} foul`, st.nobatter && `${st.nobatter} where the batter couldn’t be followed`].filter(Boolean).join(', ')}.</p>`;
  }
  el.innerHTML = h;
}

// ---------- results and saving
function renderResults() {
  const el = root && root.querySelector('#g-results'); if (!el) return;
  if (!G.plays.length && !(G.phase === 'done' || G.phase === 'stopped')) { el.innerHTML = ''; return; }
  const focus = document.activeElement && el.contains(document.activeElement) && document.activeElement.matches('input');
  if (focus) { renderSaveState(); return; }
  const inc = G.plays.filter((p) => p.include && p.x != null);
  let h = `<h2 class="sec">Balls in play <span class="small muted" style="letter-spacing:0;text-transform:none">${G.plays.length ? inc.length + ' of ' + G.plays.length + ' set to save' : ''}</span></h2>`;
  if (G.restored) h += `<p class="small muted" style="margin:0 4px">Kept from your last scout (${new Date(G.restored).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}). They stay here until you save them or scout another game.</p>`;
  if (G.plays.length) h += `<section class="card" style="padding:10px 12px">${fieldFeetSVG({ dots: inc.map((p) => ({ x: p.x, y: p.y, type: p.type })), label: 'Balls in play found' })}<div class="sw-legend small muted"><span>● ground ball</span><span>▲ line drive</span><span>○ fly ball</span><span>◌ pop up</span></div></section>`;
  h += G.plays.length ? `<div class="stack" style="gap:8px">${G.plays.map(playHTML).join('')}</div>` : `<div class="card empty" style="padding:18px"><p>No balls in play were found. Check that the bases were marked on the right spots and that the video shows the batter and the first-base line.</p></div>`;
  h += '<section class="card stack" style="padding:14px" id="g-save"></section>';
  el.innerHTML = h;
  renderSaveState();
}
function playHTML(p) {
  const o = p.outcome, z = p.x != null ? zoneLabel(p.x, p.y, p.bats) : '';
  const conf = p.moved ? 'placed by you' : o ? { high: 'clear track', medium: 'good track', low: 'rough track, check it' }[o.conf] : 'ball not followed, tap Adjust to place it';
  let h = `<div class="card sw-play${p.include ? '' : ' off'}">
    ${p.thumb && p.thumb.url ? `<img class="thumb" src="${p.thumb.url}" alt="Batter at contact">` : '<div class="thumb"></div>'}
    <div class="stack" style="gap:6px;min-width:0">
      <div class="row" style="gap:6px"><input class="input" data-sw-in="pName" data-id="${esc(p.id)}" value="${esc(p.name)}" placeholder="Batter name" aria-label="Batter name" ${p.savedId ? 'disabled' : ''}><input class="input sw-num" data-sw-in="pNum" data-id="${esc(p.id)}" value="${esc(p.number)}" inputmode="numeric" placeholder="#" aria-label="Number" ${p.savedId ? 'disabled' : ''}></div>
      ${p.preview ? `<img class="sw-board" src="${p.preview}" alt="Scoreboard batter line at this at-bat">` : ''}
      <div class="small muted">bats ${esc(p.bats || '?')}${p.type ? ' · ' + esc(M.TYPE_LABEL[p.type]) : ''}${z ? ' · ' + esc(z) : ''}${o && !p.moved && p.x != null ? ' · ~' + Math.round(Math.hypot(p.x, p.y)) + ' ft' : ''} · ${esc(conf)} · ${mmss(p.tContact)}</div>
      <div class="row" style="gap:6px;flex-wrap:wrap">${p.savedId ? '<span class="chip">Saved</span>' : `<label class="small"><input type="checkbox" data-sw-ch="pInc" data-id="${esc(p.id)}" ${p.include ? 'checked' : ''} ${p.x == null ? 'disabled' : ''}> Save</label><button type="button" class="btn ghost sm" data-sw="gAdjust" data-id="${esc(p.id)}">Adjust</button>`}${!p.restored ? `<button type="button" class="btn ghost sm" data-sw="gWatch" data-id="${esc(p.id)}">Watch</button>` : ''}</div>
    </div></div>`;
  if (G.adjust && G.adjust.id === p.id) {
    const t = G.adjust;
    h += `<section class="card stack" style="padding:12px 14px"><b>Adjust this ball in play</b><div class="small muted">Tap the field where the ball went.</div>
      ${fieldFeetSVG({ tap: 'gAdjTap', marker: t.x != null ? { x: t.x, y: t.y } : null, label: 'Tap where the ball went' })}
      ${chips('gAdjType', t.type, TYPES)}<div class="seg">${[['R', 'Bats right'], ['L', 'Bats left']].map(([k, l]) => `<button type="button" data-sw="gAdjBats" data-v="${k}" aria-pressed="${t.bats === k}">${l}</button>`).join('')}</div>
      <div class="row"><button type="button" class="btn primary sm" data-sw="gAdjOk">Use this</button><button type="button" class="btn ghost sm" data-sw="gAdjCancel">Cancel</button></div></section>`;
  }
  return h;
}
const playById = (id) => G.plays.find((x) => x.id === id);
IN.pName = (el) => {
  const p = playById(el.dataset.id); if (!p) return;
  p.name = el.value; p.nameSrc = 'typed';
  if (p.cluster) for (const q of p.cluster.plays) if (q !== p && q.nameSrc !== 'typed' && !q.savedId) { q.name = p.name; q.number = p.number; const e2 = root.querySelector(`input[data-sw-in="pName"][data-id="${CSS.escape(q.id)}"]`); if (e2) e2.value = q.name; }
  renderSaveState(); saveDraft();
};
IN.pNum = (el) => { const p = playById(el.dataset.id); if (!p) return; p.number = el.value; p.nameSrc = 'typed'; renderSaveState(); saveDraft(); };
IN.pInc = (el) => { const p = playById(el.dataset.id); if (!p) return; p.include = el.checked; renderResults(); saveDraft(); };
ACT.gAdjust = (d) => { const p = playById(d.id); if (!p) return; G.adjust = { id: p.id, x: p.x, y: p.y, type: p.type, bats: p.bats }; renderResults(); };
ACT.gAdjTap = (d, el, e) => { const q = svgFeet(el.closest('svg'), e); if (q.y < -10) return; G.adjust.x = q.x; G.adjust.y = q.y; renderResults(); };
ACT.gAdjType = (d) => { G.adjust.type = d.v; renderResults(); };
ACT.gAdjBats = (d) => { G.adjust.bats = d.v; renderResults(); };
ACT.gAdjCancel = () => { G.adjust = null; renderResults(); };
ACT.gAdjOk = () => {
  const t = G.adjust, p = playById(t.id);
  if (t.x == null || !t.type) { H.toast('Tap where the ball went and pick the batted-ball type.'); return; }
  Object.assign(p, { x: t.x, y: t.y, type: t.type, bats: t.bats, moved: true, include: true, needsPlace: false });
  G.adjust = null; renderResults(); saveDraft();
};
ACT.gWatch = async (d) => {
  const p = playById(d.id); if (!p || G.abort) return;
  if (p.restored || !G.files[p.file]) { H.toast('This list was kept after the page reloaded, so the video isn’t loaded. Save them, or scout the video again to watch.'); return; }
  if (p.file !== G.fi) { if (!(await scOpen(p.file))) return; }
  G.watch = p; scoutStage.setZoom(null);
  scoutStage.box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  const sv = scoutStage.video, start = Math.max(0, p.tContact - 1.6), end = Math.min(sv.duration, p.tContact + 2.2);
  await waitFrame(sv, start);
  sv.playbackRate = 0.5; G.watchEnd = end;
  try { await sv.play(); } catch (e) { sv.playbackRate = 1; }
};
function scoutFrame() { const sv = scoutStage.video; if (G.watchEnd != null && sv.currentTime >= G.watchEnd) { sv.pause(); sv.playbackRate = 1; G.watchEnd = null; } }
function scoutDraw(c, st) {
  const { m, P, dpr } = st.P();
  const cal = curCal();
  if (cal && F && (G.phase === 'bases' || G.phase === 'team' || (G.phase === 'running' && !G.live))) {
    const line = (A1, B1, color, w) => {
      const a = F.project(cal.P, A1), b = F.project(cal.P, B1);
      if (!(a[2] > 0 && b[2] > 0)) return;
      const p = P(a[0], a[1]), q = P(b[0], b[1]);
      c.strokeStyle = color; c.lineWidth = w * dpr; c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(q[0], q[1]); c.stroke();
    };
    const bp = cal.basePath, s2 = bp / Math.SQRT2, far = bp * 2.6 / Math.SQRT2, al = G.phase === 'running' ? 0.35 : 0.95;
    line([0, 0, 0], [far, far, 0], `rgba(255,255,255,${al})`, 2);
    line([0, 0, 0], [-far, far, 0], `rgba(255,255,255,${al})`, 2);
    line([s2, s2, 0], [0, 2 * s2, 0], `rgba(255,255,255,${al})`, 2);
    line([0, 2 * s2, 0], [-s2, s2, 0], `rgba(255,255,255,${al})`, 2);
    for (const side of ['R', 'L']) { const q = F.BOX[side]; for (let i = 0; i < 4; i++) line([...q[i], 0], [...q[(i + 1) % 4], 0], `rgba(64,211,190,${al})`, 1.6); }
  }
  if (G.phase === 'bases') {
    G.taps.forEach(([x, y], i) => {
      const p = P(x, y);
      c.fillStyle = '#7FB0E6'; c.strokeStyle = 'rgba(4,18,45,.9)'; c.lineWidth = 2 * dpr;
      c.beginPath(); c.arc(p[0], p[1], 6 * dpr, 0, 7); c.fill(); c.stroke();
      c.font = `700 ${Math.round(13 * dpr)}px "Barlow Semi Condensed", sans-serif`;
      c.fillStyle = '#FFFFFF'; c.fillText(BASE_SHORT[i], p[0] + 9 * dpr, p[1] - 8 * dpr);
    });
  }
  if (G.live) {
    const { box, kp } = G.live;
    if (box) { const p = P(box.cx - box.size / 2, box.cy - box.size / 2); c.strokeStyle = 'rgba(127,176,230,.9)'; c.lineWidth = 1.5 * dpr; c.setLineDash([6 * dpr, 4 * dpr]); c.strokeRect(p[0], p[1], box.size * m.s, box.size * m.s); c.setLineDash([]); }
    if (kp) skeleton(c, P, kp, 'rgba(64,211,190,.95)', clamp(3 * dpr * m.s * 4, 1.5 * dpr, 4 * dpr));
  }
  const w = G.watch;
  if (w && w.analysis && w.file === G.fi) {
    const t = st.video.currentTime, f = nearestFrame(w.analysis.frames, t);
    if (f) skeleton(c, P, f.kp, 'rgba(64,211,190,.95)', clamp(w.analysis.H * m.s / 24, 1.4 * dpr, 4 * dpr));
    if (w.ball && w.ball.found && w.ball.track) {
      const pts = w.ball.track.filter((q) => q.t <= t + 0.01);
      pts.forEach((q, i) => { const p = P(q.x, q.y); c.fillStyle = `rgba(255,196,61,${0.4 + 0.6 * (i + 1) / pts.length})`; c.beginPath(); c.arc(p[0], p[1], (i === pts.length - 1 ? 5 : 3) * dpr, 0, 7); c.fill(); });
    }
  }
}
function renderSaveState() {
  const el = root && root.querySelector('#g-save'); if (!el) return;
  const todo = G.plays.filter((p) => p.include && !p.savedId && p.x != null);
  const noName = todo.filter((p) => !String(p.name || '').trim() && !String(p.number || '').trim());
  const tgt = saveTarget();
  const unknown = tgt && tgt.kind === 'us' ? todo.filter((p) => !ourPlayerFor(p)) : [];
  const note = !tgt ? 'Pick the team to save them to (above).' : noName.length ? `Add the batter’s name or number for ${noName.length} of them.` : unknown.length ? `${unknown.length} number${unknown.length === 1 ? ' doesn’t' : 's don’t'} match anyone on your roster. Fix the number or uncheck them.` : G.phase === 'running' && todo.length ? 'You can save now or when it finishes.' : '';
  const ok = todo.length && tgt && !noName.length && !unknown.length && !G.saving;
  el.innerHTML = `<div class="row" style="flex-wrap:wrap"><button type="button" class="btn primary" data-sw="gSave" ${ok ? '' : 'disabled'}>${G.saving ? 'Saving…' : todo.length ? `Save ${todo.length} to the spray charts` : 'Save to the spray charts'}</button><span class="small muted grow">${esc(note)}</span></div>`;
  if (!G.plays.length) el.hidden = true; else el.hidden = false;
}
function ourPlayerFor(p) {
  const n = String(p.number || '').trim().replace(/^#/, '');
  const team = H.team().players;
  if (n) return team.find((x) => String(x.num || '').trim() === n) || null;
  const nm = String(p.name || '').trim().toLowerCase();
  return nm ? team.find((x) => String(x.name).toLowerCase() === nm) || null : null;
}
ACT.gSave = async () => {
  const tgt = saveTarget(), u = H.user();
  if (!tgt || G.saving) return;
  const todo = G.plays.filter((p) => p.include && !p.savedId && p.x != null && (String(p.name || '').trim() || String(p.number || '').trim()));
  if (!todo.length) return;
  G.saving = true; renderSaveState();
  let n = 0;
  try {
    for (const p of todo) {
      const a = p.analysis, o = p.outcome || {}, now = Date.now(), id = H.newId();
      const ev = Object.assign({}, a.events); if (o.tContact) { ev.tContact = o.tContact; ev.contactSource = 'ball'; }
      let who;
      if (tgt.kind === 'us') {
        const pl = ourPlayerFor(p); if (!pl) continue;
        who = { pid: pl.id, opp: '', oppName: '', key: 'us:' + pl.id, hitter: { name: pl.name, number: String(pl.num || ''), team: H.team().name } };
      } else {
        const num = String(p.number || '').trim().replace(/^#/, ''), rp = tgt.roster && oppPlayer(tgt.roster, num);
        const name = String(p.name || '').trim() || (rp && rp.name) || '#' + num;
        who = { pid: '', opp: tgt.key, oppName: tgt.name, key: 'opp:' + tgt.key + ':' + (num ? '#' + num : slug(name)), hitter: { name, number: num, team: tgt.name } };
      }
      const doc = {
        pid: who.pid, opp: who.opp, oppName: who.oppName, hitterKey: who.key, hitter: who.hitter, bats: p.bats === 'L' ? 'L' : 'R',
        outcome: { kind: 'inplay', type: p.type || null, result: null, x: r3(p.x), y: r3(p.y) },
        swing: a ? { events: roundObj(ev), metrics: roundObj(a.metrics), H: Math.round(a.H || 0), frames: a.frames ? a.frames.length : a.nFrames || 0 } : null,
        features: a ? roundObj(M.featureVector({ metrics: a.metrics, events: ev })) : null,
        ball: p.ball && p.ball.found ? { found: true, air: p.ball.air == null ? null : !!p.ball.air, type: p.ball.type || null, n: (p.ball.track || []).length } : { found: false },
        prediction: null,
        auto: p.outcome && !p.moved ? roundObj({ angle: o.angle, dist: o.dist, launch: o.launch, mph: o.mph, conf: null }) : null,
        source: 'scout', game: String(G.game || '').trim().slice(0, 60), count: String(p.count || '').slice(0, 10), inning: String(p.inning || '').slice(0, 12),
        clip: { name: String(p.fileName || '').slice(0, 80), t: r3(p.tContact || 0) },
        needsReview: !p.moved && (!p.outcome || p.outcome.conf === 'low'),
        by: u.uid, createdAt: now, updatedAt: now,
      };
      if (doc.auto && p.outcome) doc.auto.conf = p.outcome.conf || null;
      const media = {
        pid: who.pid, opp: who.opp, by: u.uid, thumb: p.thumb && p.thumb.url ? p.thumb.url : null,
        series: a && a.series ? { t: a.series.t.map(r3), sh: a.series.sh.map(r3), hp: a.series.hp.map(r3) } : null,
        track: p.ball && p.ball.found && p.ball.track ? p.ball.track.map((q) => ({ t: r3(q.t), x: Math.round(q.x), y: Math.round(q.y) })) : [],
        frames: a && a.frames && a.frames.length ? packFrames(a.frames, p.vw, p.vh) : (a && a.packed) || null,
        events: roundObj(ev),
      };
      await H.save(id, doc, media);
      p.savedId = id; n++;
    }
    H.toast(`Saved ${n} ball${n === 1 ? '' : 's'} in play to the spray charts.`);
  } catch (e) {
    console.error(e);
    H.toast(`Saved ${n}. ` + (e && e.code === 'permission-denied' ? 'Couldn’t save the rest. Check that the latest security rules are published.' : 'Couldn’t save the rest. Check your connection and try again.'));
  } finally { G.saving = false; renderResults(); saveDraft(); }
};

// ---------- the found list survives a reload (iOS can reload a page left in the background)
function draftOf(p, withThumb) {
  const a = p.analysis;
  return {
    id: p.id, fileName: p.fileName, name: p.name, number: p.number, team: p.team, nameSrc: p.nameSrc, include: p.include, bats: p.bats, type: p.type, x: p.x, y: p.y,
    moved: !!p.moved, needsPlace: !!p.needsPlace, tContact: p.tContact, count: p.count || '', inning: p.inning || '', preview: withThumb ? p.preview || null : null, vw: p.vw, vh: p.vh,
    thumb: withThumb && p.thumb ? p.thumb : null, outcome: p.outcome || null, savedId: p.savedId || null,
    ball: p.ball && p.ball.found ? { found: true, air: p.ball.air, type: p.ball.type, track: (p.ball.track || []).map((q) => ({ t: r3(q.t), x: Math.round(q.x), y: Math.round(q.y) })) } : { found: false },
    analysis: a ? { events: a.events, metrics: a.metrics, H: a.H, series: a.series, packed: a.frames ? packFrames(a.frames, p.vw, p.vh) : a.packed } : null,
  };
}
let draftTimer = null;
function saveDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    const todo = G.plays.filter((p) => !p.savedId && p.analysis);
    try {
      if (!todo.length) { localStorage.removeItem(DRAFT_KEY); return; }
      const body = (th) => JSON.stringify({ v: 1, savedAt: Date.now(), game: G.game, teams: G.teams, saveAs: G.saveAs, plays: todo.map((p) => draftOf(p, th)) });
      try { localStorage.setItem(DRAFT_KEY, body(true)); } catch (e) { localStorage.setItem(DRAFT_KEY, body(false)); }
    } catch (e) { /* storage blocked */ }
  }, 300);
}
function restoreDraft() {
  if (G.files.length || G.plays.length) return;
  let d = null;
  try { d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { d = null; }
  if (!d || !Array.isArray(d.plays) || !d.plays.length) return;
  const plays = d.plays.filter((q) => q.analysis).map((q) => {
    let frames = null; try { frames = q.analysis.packed ? unpackFrames(q.analysis.packed) : null; } catch (e) { frames = null; }
    return Object.assign({}, q, { file: -1, restored: true, analysis: Object.assign({}, q.analysis, { frames }) });
  });
  if (!plays.length) return;
  Object.assign(G, { plays, game: d.game || '', teams: d.teams || null, phase: 'done', restored: d.savedAt || Date.now() });
  if (d.saveAs) G.saveAs = d.saveAs;
}
function clearDraft() { clearTimeout(draftTimer); try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* blocked */ } G.restored = null; }

// test hook (harmless in production)
window.__swingAI = { A, G, S };
