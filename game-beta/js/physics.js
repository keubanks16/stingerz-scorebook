// Ball physics + swing contact model. Units: feet, seconds. World: home plate at origin,
// field toward -z, first base toward +x, y up.
export const G = 32.17;
export const BALL_R = 0.121;
const RHO = 0.0023769, AREA = Math.PI * BALL_R * BALL_R, MASS = 0.3203 / G;
const KD = 0.5 * RHO * 0.33 * AREA / MASS;   // quadratic drag coeff (1/ft)
const KL = 0.5 * RHO * AREA / MASS;          // lift coeff base (times CL)
export const MPH = 1.46667;

export const BASES = [[0, 0], [63.64, -63.64], [0, -127.28], [-63.64, -63.64]];
export const WALL_H = 8;
export function fenceDist(angDeg) { const a = Math.min(45, Math.abs(angDeg)); return 392 - 67 * Math.pow(a / 45, 1.6); }
export function sprayOf(x, z) { return Math.atan2(x, -z) * 180 / Math.PI; }
export function isFairXZ(x, z) { return -z >= -0.5 && Math.abs(sprayOf(x, z)) <= 45; }
export function distXZ(x, z) { return Math.hypot(x, z); }
// out-of-play boundary in foul territory (stands)
export function inStands(x, z) {
  if (z > 52) return true;
  const ang = sprayOf(x, z);
  if (Math.abs(ang) <= 45 && -z > 0) return false;
  // perpendicular distance to nearest foul line
  const s = x >= 0 ? 1 : -1;
  const perp = 0.7071 * Math.abs(x + s * z);   // distance from the foul line
  const along = (s * x - z) * 0.7071;           // distance down the line
  if (along > fenceDist(45) + 4) return true;
  return perp > 46;
}

// ---------- pitch ----------
export const PITCHES = {
  FB: { name: 'FASTBALL', short: 'FB', speed: 1.0, ax: -7, ay: 13 },
  CH: { name: 'CHANGEUP', short: 'CH', speed: 0.83, ax: -12, ay: 4 },
  CB: { name: 'CURVEBALL', short: 'CB', speed: 0.76, ax: 8, ay: -20 },
  SL: { name: 'SLIDER', short: 'SL', speed: 0.86, ax: 15, ay: -6 },
};
export const CONTACT_Z = -1.2;
// Build an analytic pitch from release point to target (x,y at plate z=0).
export function makePitch(type, mph, release, target, throwsL) {
  const P = PITCHES[type];
  const v0z = mph * MPH;
  const D = -release.z;                    // distance to plate
  const az = (0.86 - 1) * v0z * v0z / (2 * D); // ~7% speed loss
  // solve D = v0z*T + .5 az T^2
  const T = (-v0z + Math.sqrt(v0z * v0z + 2 * az * D)) / az;
  const ax = P.ax * (throwsL ? -1 : 1), ay = P.ay - G;
  const v0x = (target.x - release.x - 0.5 * ax * T * T) / T;
  const v0y = (target.y - release.y - 0.5 * ay * T * T) / T;
  return { type, mph, p0: { ...release }, v0: { x: v0x, y: v0y, z: v0z }, a: { x: ax, y: ay, z: az }, T, target: { ...target } };
}
export function pitchPos(pt, t) {
  return {
    x: pt.p0.x + pt.v0.x * t + 0.5 * pt.a.x * t * t,
    y: pt.p0.y + pt.v0.y * t + 0.5 * pt.a.y * t * t,
    z: pt.p0.z + pt.v0.z * t + 0.5 * pt.a.z * t * t,
  };
}
export function pitchTimeAtZ(pt, z) {
  const D = z - pt.p0.z, a = pt.a.z, v = pt.v0.z;
  return (-v + Math.sqrt(v * v + 2 * a * D)) / a;
}
export function zoneOf(heightScale = 1) { return { x: 0.83 + BALL_R, y0: 1.45 * heightScale, y1: 3.25 * heightScale }; }
export function isStrike(x, y, zone) { return Math.abs(x) <= zone.x && y >= zone.y0 - BALL_R && y <= zone.y1 + BALL_R; }

// ---------- swing contact ----------
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
export const randn = gauss;
// tau: timing error (s, negative = early). dx,dy: aim - ball (ft). hand: 'R'|'L'. assist: window multiplier
export function resolveSwing({ tau, dx, dy, power, bunt, hand, assist = 1, evScale = 1 }) {
  if (bunt) {
    if (Math.abs(tau) > 0.22 * assist || Math.abs(dy) > 0.38 * assist || Math.abs(dx) > 0.75) return { result: 'miss' };
    if (Math.abs(dy) > 0.26 * assist) return { result: 'foul' };
    return { result: 'inplay', ev: 22 + Math.random() * 12, la: -18 + Math.random() * 20, spray: gauss() * 20, q: 0.3, bunt: true };
  }
  const tlim = (power ? 0.072 : 0.095) * assist, ylim = (power ? 0.19 : 0.25) * assist, xlim = 0.62 * Math.sqrt(assist);
  const at = Math.abs(tau), ay = Math.abs(dy), ax = Math.abs(dx);
  if (at > tlim * 1.35 || ay > ylim * 1.35 || ax > xlim) return { result: 'miss' };
  if (at > tlim || ay > ylim) return { result: 'foul', back: ay > ylim };
  const qt = at / tlim, qy = ay / ylim, qx = ax / xlim;
  const q = Math.max(0.12, Math.min(1, 1 - 0.5 * qy * qy - 0.4 * qt * qt - 0.3 * qx * qx));
  const ev = ((power ? 66 + 38 * q : 60 + 30 * q) + gauss() * 2.5) * evScale;
  let la = (power ? 23 : 15) - dy * 125 + gauss() * 6;
  la = Math.max(-35, Math.min(72, la));
  const side = hand === 'L' ? -1 : 1;
  const spray = (tau / tlim) * 40 * side + (dx * 14) * side * 0 + gauss() * 9;
  return { result: 'inplay', ev, la, spray, q };
}

// ---------- batted ball ----------
export function launch(ev, la, spray, from) {
  const v = ev * MPH, l = la * Math.PI / 180, s = spray * Math.PI / 180;
  const h = v * Math.cos(l);
  const backspin = la > 4 ? 1 : (la < -2 ? -0.6 : 0.2);
  return { x: from.x, y: from.y, z: from.z, vx: h * Math.sin(s), vy: v * Math.sin(l), vz: -h * Math.cos(s), spin: backspin, onGround: false, rolling: false, touched: false };
}
// step a free ball; returns events
export function stepBall(b, dt, ev) {
  if (b.rolling) {
    const sp = Math.hypot(b.vx, b.vz);
    const dec = (isDirt(b.x, b.z) ? 12 : 15) * dt;
    if (sp <= dec || sp < 0.4) { b.vx = b.vz = 0; b.stopped = true; }
    else { b.vx *= (sp - dec) / sp; b.vz *= (sp - dec) / sp; }
    b.x += b.vx * dt; b.z += b.vz * dt; b.y = BALL_R;
    return;
  }
  const v = Math.hypot(b.vx, b.vy, b.vz) || 1e-6;
  const vh = Math.hypot(b.vx, b.vz) || 1e-6;
  let axx = -KD * v * b.vx, ayy = -KD * v * b.vy - G, azz = -KD * v * b.vz;
  // lift perpendicular to velocity in the vertical plane (backspin = up)
  const CL = 0.16 * b.spin;
  const L = KL * CL * v * v;
  const nx = -b.vy * (b.vx / vh) / v, ny = vh / v, nz = -b.vy * (b.vz / vh) / v;
  axx += L * nx; ayy += L * ny; azz += L * nz;
  b.vx += axx * dt; b.vy += ayy * dt; b.vz += azz * dt;
  b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
  b.spin *= (1 - 0.15 * dt);
  if (b.y <= BALL_R && b.vy < 0) {
    if (ev) ev.landed = true;
    b.y = BALL_R; b.touched = true; b.spin = 0;
    const infieldDirt = isDirt(b.x, b.z);
    b.vy = -b.vy * (infieldDirt ? 0.42 : 0.36);
    const f = infieldDirt ? 0.82 : 0.72;
    b.vx *= f; b.vz *= f;
    if (b.vy < 2.2) { b.vy = 0; b.rolling = true; }
  }
}
export function isDirt(x, z) {
  const dm = Math.hypot(x, z + 60.5);
  return (dm < 95 && -z > 0 && Math.abs(sprayOf(x, z)) < 47) && !(Math.abs(x) + Math.abs(z + 63.64) < 56);
}
// wall collision in fair territory; returns 'hr' | 'wall' | null
export function wallCheck(b) {
  const d = Math.hypot(b.x, b.z);
  const ang = sprayOf(b.x, b.z);
  if (Math.abs(ang) > 45 || -b.z < 0) return null;
  const fd = fenceDist(ang);
  if (d >= fd) {
    if (b.y > WALL_H) return 'over';
    // bounce off wall
    const nx = b.x / d, nz = b.z / d;
    const vr = b.vx * nx + b.vz * nz;
    if (vr > 0) { b.vx -= 1.4 * vr * nx; b.vz -= 1.4 * vr * nz; b.vx *= 0.6; b.vz *= 0.6; b.vy *= 0.6; }
    b.x = nx * (fd - 0.3); b.z = nz * (fd - 0.3);
    return 'wall';
  }
  return null;
}
// simulate a copy forward; returns samples every dt
export function predict(b0, maxT = 9, dt = 1 / 60) {
  const b = { ...b0 }; const out = [];
  let t = 0, over = false;
  while (t < maxT) {
    const ev = {};
    stepBall(b, dt, ev); t += dt;
    const w = wallCheck(b);
    if (w === 'over') { over = true; out.push({ t, x: b.x, y: b.y, z: b.z, touched: b.touched, over: true }); break; }
    out.push({ t, x: b.x, y: b.y, z: b.z, touched: b.touched, stopped: b.stopped });
    if (b.stopped) break;
    if (inStands(b.x, b.z)) { out[out.length - 1].stands = true; break; }
  }
  return { samples: out, over };
}
