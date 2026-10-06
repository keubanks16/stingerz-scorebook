import * as THREE from './vendor/three.module.min.js';
import { IMG } from './assets.js';

const V3 = THREE.Vector3;
const L1 = 0.92, L2 = 0.88;
const matCache = new Map();
function lam(color) { const k = 'l' + color; if (!matCache.has(k)) matCache.set(k, new THREE.MeshLambertMaterial({ color })); return matCache.get(k); }
function phong(color, shin = 60) { const k = 'p' + color; if (!matCache.has(k)) matCache.set(k, new THREE.MeshPhongMaterial({ color, shininess: shin })); return matCache.get(k); }
const geoCache = new Map();
function cyl(rt, rb, h, seg = 10) { const k = `c${rt},${rb},${h}`; if (!geoCache.has(k)) geoCache.set(k, new THREE.CylinderGeometry(rt, rb, h, seg)); return geoCache.get(k); }
function sph(r, w = 14, h = 10) { const k = `s${r}`; if (!geoCache.has(k)) geoCache.set(k, new THREE.SphereGeometry(r, w, h)); return geoCache.get(k); }
function box(x, y, z) { const k = `b${x},${y},${z}`; if (!geoCache.has(k)) geoCache.set(k, new THREE.BoxGeometry(x, y, z)); return geoCache.get(k); }
function mesh(g, m, x = 0, y = 0, z = 0, parent) { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; if (parent) parent.add(o); return o; }
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

function jerseyTextures(team, name, num) {
  const mk = (draw) => { const c = document.createElement('canvas'); c.width = 256; c.height = 320; const g = c.getContext('2d'); g.fillStyle = team.jersey; g.fillRect(0, 0, 256, 320); draw(g); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
  const front = mk(g => {
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.strokeStyle = team.outline; g.fillStyle = team.letter;
    const logo = team.key === 'GS' && IMG.logoLight;
    if (logo) { const w = 200, h = w * logo.height / logo.width; g.drawImage(logo, 128 - w / 2, 115 - h / 2, w, h); }
    else {
      g.fillStyle = team.trim; g.fillRect(122, 0, 12, 320); g.fillStyle = team.letter;
      g.font = 'italic 900 92px system-ui, sans-serif'; g.lineWidth = 10; g.strokeText(team.abbr, 128, 120); g.fillText(team.abbr, 128, 120);
    }
    g.font = '900 56px system-ui, sans-serif'; g.lineWidth = 6; g.strokeText(num, 196, 250); g.fillText(num, 196, 250);
  });
  const last = (name || '').split(' ').slice(-1)[0].toUpperCase();
  const back = mk(g => {
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = team.letter; g.strokeStyle = team.outline;
    let fs = 46; g.font = `900 ${fs}px system-ui, sans-serif`; while (g.measureText(last).width > 220 && fs > 18) { fs -= 2; g.font = `900 ${fs}px system-ui, sans-serif`; }
    g.lineWidth = 5; g.strokeText(last, 128, 58); g.fillText(last, 128, 58);
    g.font = '900 150px system-ui, sans-serif'; g.lineWidth = 12; g.strokeText(num, 128, 190); g.fillText(num, 128, 190);
  });
  return { front, back };
}

let decalMat = null;
function logoDecal(parent, w, x, y, z, tiltX) {
  if (!IMG.logoLight) return;
  if (!decalMat) { const t = new THREE.Texture(IMG.logoLight); t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; decalMat = new THREE.MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }); }
  const h = w * IMG.logoLight.height / IMG.logoLight.width;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), decalMat); m.position.set(x, y, z); m.rotation.x = tiltX || 0; parent.add(m); return m;
}
export class Player3D {
  constructor(o) {
    this.o = o; // {name,num,team,skin,hair,bats,throws,role}
    const team = o.team;
    this.root = new THREE.Group();
    const skin = lam(o.skin || '#d9a77e'), pants = lam(team.pants), jersey = lam(team.jersey), sock = lam(team.sock), shoe = lam('#111111');
    this.hips = new THREE.Group(); this.hips.position.y = 2.65; this.root.add(this.hips);
    mesh(box(0.95, 0.45, 0.55), pants, 0, 0, 0, this.hips);
    mesh(box(0.97, 0.12, 0.57), lam(team.belt || '#111'), 0, 0.22, 0, this.hips);
    const leg = (x) => {
      const g = new THREE.Group(); g.position.set(x, -0.1, 0); this.hips.add(g);
      mesh(cyl(0.19, 0.16, 1.25), pants, 0, -0.625, 0, g);
      const k = new THREE.Group(); k.position.y = -1.25; g.add(k);
      mesh(cyl(0.155, 0.135, 0.5), pants, 0, -0.25, 0, k);
      mesh(cyl(0.135, 0.11, 0.72), sock, 0, -0.86, 0, k);
      mesh(box(0.27, 0.17, 0.56), shoe, 0, -1.25, 0.1, k);
      return [g, k];
    };
    [this.legL, this.kneeL] = leg(0.25); [this.legR, this.kneeR] = leg(-0.25);
    this.spine = new THREE.Group(); this.spine.position.y = 0.2; this.hips.add(this.spine);
    if (o.role === 'ump') {
      mesh(box(1.15, 1.45, 0.62), lam('#1c2430'), 0, 0.72, 0, this.spine);
    } else {
      const tex = jerseyTextures(team, o.name, o.num);
      const mats = [jersey, jersey, jersey, jersey, new THREE.MeshLambertMaterial({ map: tex.front }), new THREE.MeshLambertMaterial({ map: tex.back })];
      this.jerseyMats = mats;
      mesh(box(1.1, 1.45, 0.58), mats, 0, 0.72, 0, this.spine);
    }
    mesh(cyl(0.13, 0.14, 0.25), skin, 0, 1.5, 0, this.spine);
    this.head = new THREE.Group(); this.head.position.y = 1.6; this.spine.add(this.head);
    mesh(sph(0.36), skin, 0, 0.32, 0, this.head);
    // face details
    const eye = lam('#1a1a1a');
    mesh(sph(0.045, 6, 4), eye, 0.12, 0.36, 0.32, this.head); mesh(sph(0.045, 6, 4), eye, -0.12, 0.36, 0.32, this.head);
    mesh(sph(0.06, 6, 4), skin, 0.36, 0.3, 0, this.head); mesh(sph(0.06, 6, 4), skin, -0.36, 0.3, 0, this.head);
    // hair at back
    const hairM = lam(o.hair || '#2b1d12');
    const hair = mesh(new THREE.SphereGeometry(0.37, 14, 10, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.35), hairM, 0, 0.32, -0.02, this.head); hair.rotation.x = -0.35;
    // cap
    this.cap = new THREE.Group(); this.head.add(this.cap);
    const capM = o.role === 'ump' ? lam('#151b24') : lam(team.cap);
    mesh(new THREE.SphereGeometry(0.385, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), capM, 0, 0.38, 0, this.cap);
    const brim = mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 16, 1, false, -Math.PI / 2, Math.PI), capM, 0, 0.4, 0.28, this.cap); brim.scale.set(1.15, 1, 1.25);
    if (team.key === 'GS' && o.role !== 'ump') logoDecal(this.cap, 0.36, 0, 0.6, 0.335, -0.5);
    // helmet
    this.helmet = new THREE.Group(); this.head.add(this.helmet);
    const helM = phong(team.helmet || team.cap, 90);
    mesh(new THREE.SphereGeometry(0.43, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.58), helM, 0, 0.32, -0.02, this.helmet);
    const hb = mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.04, 16, 1, false, -Math.PI / 2, Math.PI), helM, 0, 0.42, 0.3, this.helmet); hb.scale.set(1.1, 1, 0.8);
    if (team.key === 'GS') logoDecal(this.helmet, 0.4, 0, 0.6, 0.355, -0.55);
    const flap = mesh(sph(0.2, 10, 8), helM, (o.bats === 'L' ? -1 : 1) * 0.36, 0.22, -0.02, this.helmet); flap.scale.set(0.5, 1, 1);
    this.helmet.visible = false;
    if (o.role === 'ump') { const mask = mesh(box(0.5, 0.5, 0.12), lam('#222'), 0, 0.3, 0.36, this.head); }
    const arm = (x) => {
      const s = new THREE.Group(); s.position.set(x, 1.3, 0); this.spine.add(s);
      mesh(cyl(0.17, 0.15, 0.5), o.role === 'ump' ? lam('#1c2430') : jersey, 0, -0.25, 0, s);
      mesh(cyl(0.13, 0.12, 0.45), skin, 0, -0.7, 0, s);
      const e = new THREE.Group(); e.position.y = -L1; s.add(e);
      mesh(cyl(0.12, 0.1, 0.82), skin, 0, -0.41, 0, e);
      const h = new THREE.Group(); h.position.y = -L2; e.add(h);
      mesh(sph(0.13, 8, 6), skin, 0, 0, 0, h);
      return [s, e, h];
    };
    [this.shL, this.elL, this.handL] = arm(0.66); [this.shR, this.elR, this.handR] = arm(-0.66);
    // glove on glove hand
    this.throwsL = o.throws === 'L';
    const gloveHand = this.throwsL ? this.handR : this.handL;
    this.glove = mesh(sph(o.role === 'C' ? 0.36 : 0.3, 10, 8), lam('#6b3b1c'), 0, -0.08, 0.12, gloveHand); this.glove.scale.set(0.95, 1.2, 0.55);
    if (o.role === 'ump') this.glove.visible = false;
    // bat
    this.grip = new THREE.Group(); this.root.add(this.grip);
    const batM = lam('#c9a06a');
    const bat = mesh(new THREE.CylinderGeometry(0.11, 0.045, 2.55, 10), batM, 0, 1.3, 0, this.grip);
    mesh(cyl(0.07, 0.07, 0.06), batM, 0, 0.02, 0, this.grip);
    mesh(new THREE.SphereGeometry(0.11, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), batM, 0, 2.575, 0, this.grip);
    this.grip.visible = false;
    this.anim = { name: 'idle', t: 0 };
    this.phase = Math.random() * 6;
    this.speed = 0;
    this.heading = 0;
    this.root.traverse(c => { if (c.isMesh) c.castShadow = true; });
    if (o.scale) this.root.scale.setScalar(o.scale);
  }
  get pos() { return this.root.position; }
  setHeadgear(kind) { this.cap.visible = kind === 'cap'; this.helmet.visible = kind === 'helmet'; }
  showBat(v) { this.grip.visible = v; }
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
    const throwHand = this.throwsL ? this.handL : this.handR;
    const h = glove ? (this.throwsL ? this.handR : this.handL) : throwHand;
    return h.getWorldPosition(out);
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
  handTo(left, rootPt, pole) {
    _w.copy(rootPt); this.root.localToWorld(_w); this.spine.worldToLocal(_w);
    if (left) this.ik(this.shL, this.elL, _w, pole || _poleL); else this.ik(this.shR, this.elR, _w, pole || _poleR);
  }
  update(dt) {
    const a = this.anim; a.t += dt;
    this.reset();
    const fn = this['pose_' + a.name] || this.pose_idle;
    fn.call(this, a, dt);
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
    this.handTo(!this.throwsL, _w2, _poleUp);
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
    this.grip.position.set(k.g[0] * s, k.g[1] + (bunt ? yOff : yOff * contactWeight(k)) + sway, k.g[2]);
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
    this.handTo(bottomLeft, _w, _poleFwd); this.handTo(!bottomLeft, _w2, _poleFwd);
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
    this.handTo(s < 0, _v.set(k.h[0] * -s, k.h[1], k.h[2]), _poleUp);
    this.handTo(s > 0, _v.set(k.g[0] * -s, k.g[1], k.g[2]), _poleFwd);
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
    if (t < 0.45) h = [lerpA([0.3, 4.3, 0.5], [1.4, 5.2, -0.7], t / 0.45)];
    else if (t < 0.6) h = [lerpA([1.4, 5.2, -0.7], [0.5, 5.6, 1.2], (t - 0.45) / 0.15)];
    else h = [lerpA([0.5, 5.6, 1.2], [-0.5, 2.8, 1.0], (t - 0.6) / 0.4)];
    this.handTo(s < 0, _v.set(h[0][0] * -s, h[0][1], h[0][2]), _poleUp);
    this.handTo(s > 0, _v.set(-0.8 * -s, 4.2, 0.9), _poleFwd);
  }
  pose_catch(a) {
    // glove reaching toward a.glove (world)
    this.hips.position.y = a.low ? 2.0 : 2.5; this.spine.rotation.x = a.low ? 0.6 : 0.15;
    if (a.low) { this.legL.rotation.x = -0.6; this.legR.rotation.x = -0.6; this.kneeL.rotation.x = 1; this.kneeR.rotation.x = 1; }
    this.root.updateMatrixWorld(true);
    _w2.copy(a.glove || _v2.set(0, 4, 2)); this.root.worldToLocal(_w2);
    this.handTo(!this.throwsL, _w2, _poleFwd);
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
const _poleL = new V3(0.2, 0.1, 1), _poleR = new V3(-0.2, 0.1, 1), _poleUp = new V3(0, 1, 0.3), _poleFwd = new V3(0, -0.2, 1);
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
  { t: 0, h: [0.15, 4.0, 0.55], g: [0.1, 4.0, 0.6], lt: 0, lk: 0, bt: 0, bk: 0, drop: 0, lean: 0.05, yaw: 0, hy: 0 },
  { t: 0.32, h: [0.1, 4.3, 0.4], g: [0.05, 4.3, 0.45], lt: -1.5, lk: 1.8, bt: 0, bk: 0.15, drop: 0.05, lean: -0.05, yaw: -0.6, hy: -0.5 },
  { t: 0.55, h: [1.2, 4.9, -0.9], g: [-0.9, 4.4, 0.9], lt: -0.95, lk: 0.55, bt: 0.45, bk: 0.5, drop: 0.45, lean: 0.1, yaw: -0.5, hy: -0.2 },
  { t: 0.68, h: [0.45, 5.6, 1.4], g: [-0.6, 3.6, 0.5], lt: -0.7, lk: 0.5, bt: 0.6, bk: 0.7, drop: 0.5, lean: 0.45, yaw: 0.35, hy: 0.3 },
  { t: 1, h: [-0.6, 2.6, 1.2], g: [-0.6, 3.4, 0.2], lt: -0.6, lk: 0.6, bt: 1.0, bk: 1.3, drop: 0.55, lean: 0.85, yaw: 0.7, hy: 0.5 },
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
