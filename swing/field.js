// Field geometry from four tapped bases: a ground-plane homography (image <-> field feet),
// a pinhole camera recovered from it, and a ballistic fit of the ball's track off the bat.
// Field coordinates are feet from home plate: +y toward center field, +x toward first base,
// z up. Pure math, no DOM.

export const G = 32.17;                 // ft/s^2
const DRAG = 0.0019;                    // 1/ft: rho*Cd*A/(2m) for a baseball

// ---------------------------------------------------------------- small linear algebra
export function solve(A, b) {           // A: n x n (array of rows), b: n. Gaussian elimination.
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}
export function inv3(m) {
  const [a, b, c] = m[0], [d, e, f] = m[1], [g, h, i] = m[2];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-18) return null;
  return [[A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
          [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
          [C / det, -(a * h - b * g) / det, (a * e - b * d) / det]];
}
const mul3 = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const norm = (a) => Math.hypot(...a);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// ---------------------------------------------------------------- homography
// maps src[i] -> dst[i]; 4 or more point pairs (least squares with h33 = 1)
export function homography(src, dst) {
  const AtA = Array.from({ length: 8 }, () => new Array(8).fill(0)), Atb = new Array(8).fill(0);
  const add = (row, rhs) => { for (let i = 0; i < 8; i++) { Atb[i] += row[i] * rhs; for (let j = 0; j < 8; j++) AtA[i][j] += row[i] * row[j]; } };
  // normalise both point sets for conditioning
  const nrm = (pts) => {
    const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length, my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const sd = Math.sqrt(pts.reduce((s, p) => s + (p[0] - mx) ** 2 + (p[1] - my) ** 2, 0) / pts.length) || 1;
    const k = Math.SQRT2 / sd;
    return { T: [[k, 0, -k * mx], [0, k, -k * my], [0, 0, 1]], p: pts.map((q) => [(q[0] - mx) * k, (q[1] - my) * k]) };
  };
  const ns = nrm(src), nd = nrm(dst);
  for (let i = 0; i < src.length; i++) {
    const [x, y] = ns.p[i], [u, v] = nd.p[i];
    add([x, y, 1, 0, 0, 0, -u * x, -u * y], u);
    add([0, 0, 0, x, y, 1, -v * x, -v * y], v);
  }
  const h = solve(AtA, Atb);
  if (!h) return null;
  const Hn = [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]];
  const Ti = inv3(nd.T);
  const H = mul3(mul3(Ti, Hn), ns.T);
  const s = H[2][2]; return H.map((r) => r.map((v) => v / s));
}
export function applyH(H, x, y) {
  const w = H[2][0] * x + H[2][1] * y + H[2][2];
  if (Math.abs(w) < 1e-12) return null;
  return [(H[0][0] * x + H[0][1] * y + H[0][2]) / w, (H[1][0] * x + H[1][1] * y + H[1][2]) / w, w];
}
export function fieldBases(bp) { const s = bp / Math.SQRT2; return [[0, 0], [s, s], [0, 2 * s], [-s, s]]; }

// ---------------------------------------------------------------- camera
// H maps field (x, y, 0) -> image. Focal length is the one that makes the two ground axes
// most nearly orthonormal; principal point at the centre of the picture area.
export function cameraFromH(H, cx, cy, W) {
  let best = null;
  for (let i = 0; i < 400; i++) {
    const f = W * 0.25 * Math.pow(16, i / 399);
    const Ki = [[1 / f, 0, -cx / f], [0, 1 / f, -cy / f], [0, 0, 1]];
    const M = mul3(Ki, H);
    const r1 = [M[0][0], M[1][0], M[2][0]], r2 = [M[0][1], M[1][1], M[2][1]];
    const n1 = norm(r1), n2 = norm(r2);
    const c = dot(r1, r2) ** 2 / (n1 * n1 * n2 * n2) + ((n1 - n2) / (n1 + n2)) ** 2;
    if (!best || c < best.c) best = { c, f };
  }
  const f = best.f;
  const Ki = [[1 / f, 0, -cx / f], [0, 1 / f, -cy / f], [0, 0, 1]];
  const M = mul3(Ki, H);
  let r1 = [M[0][0], M[1][0], M[2][0]], r2 = [M[0][1], M[1][1], M[2][1]], t = [M[0][2], M[1][2], M[2][2]];
  const lam = 2 / (norm(r1) + norm(r2));
  r1 = r1.map((v) => v * lam); r2 = r2.map((v) => v * lam); t = t.map((v) => v * lam);
  if (t[2] < 0) { r1 = r1.map((v) => -v); r2 = r2.map((v) => -v); t = t.map((v) => -v); }
  // orthonormalise r1, r2 (Gram-Schmidt on the bisector keeps them symmetric)
  const a = r1.map((v, i) => v + r2[i]), b = r1.map((v, i) => v - r2[i]);
  const an = a.map((v) => v / norm(a));
  const bo = b.map((v, i) => v - dot(b, an) * an[i]), bn = bo.map((v) => v / norm(bo));
  r1 = an.map((v, i) => (v + bn[i]) / Math.SQRT2); r2 = an.map((v, i) => (v - bn[i]) / Math.SQRT2);
  let r3 = cross(r1, r2);
  // camera centre C = -R^T t; it must be above the ground
  const R = [[r1[0], r2[0], r3[0]], [r1[1], r2[1], r3[1]], [r1[2], r2[2], r3[2]]];
  let C = [0, 1, 2].map((j) => -(R[0][j] * t[0] + R[1][j] * t[1] + R[2][j] * t[2]));
  if (C[2] < 0) { r3 = r3.map((v) => -v); for (let i = 0; i < 3; i++) R[i][2] = r3[i]; C = [0, 1, 2].map((j) => -(R[0][j] * t[0] + R[1][j] * t[1] + R[2][j] * t[2])); }
  const K = [[f, 0, cx], [0, f, cy], [0, 0, 1]];
  const P = [0, 1, 2].map((i) => [0, 1, 2, 3].map((j) => {
    let s = 0; for (let k = 0; k < 3; k++) s += K[i][k] * (j < 3 ? R[k][j] : t[k]); return s;
  }));
  return { f, K, R, t, C, P, cost: best.c };
}
export function project(P, X) {
  const w = P[2][0] * X[0] + P[2][1] * X[1] + P[2][2] * X[2] + P[2][3];
  return [(P[0][0] * X[0] + P[0][1] * X[1] + P[0][2] * X[2] + P[0][3]) / w, (P[1][0] * X[0] + P[1][1] * X[1] + P[1][2] * X[2] + P[1][3]) / w, w];
}

// ---------------------------------------------------------------- calibration
// taps: [home, first, second, third] in video px. content: picture rect inside black bars.
export function calibrate({ taps, basePath, vw, vh, content }) {
  const bp = Number(basePath) || 60;
  const warnings = [];
  const H = homography(fieldBases(bp), taps);
  if (!H) return { ok: false, error: 'Those four points do not make a diamond. Tap home, first, second and third in that order.' };
  const Hi = inv3(H);
  const ct = content || { x: 0, y: 0, w: vw, h: vh };
  const cam = cameraFromH(H, ct.x + ct.w / 2, ct.y + ct.h / 2, ct.w);
  // sanity: the camera has to be behind or beside home, above the ground, and the taps in order
  const [h0, b1, b2, b3] = taps;
  const turn = (a, b, c) => (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
  const t1 = turn(h0, b1, b2), t2 = turn(b1, b2, b3), t3 = turn(b2, b3, h0), t4 = turn(b3, h0, b1);
  const convex = (t1 > 0 && t2 > 0 && t3 > 0 && t4 > 0) || (t1 < 0 && t2 < 0 && t3 < 0 && t4 < 0);
  if (!convex) return { ok: false, error: 'Those four points do not make a diamond. Tap home, first, second and third in that order.' };
  const C = cam.C;
  // seen from behind home, first base is to the right of the line home -> second (left from center field)
  const firstOnRight = (b2[0] - h0[0]) * (b1[1] - h0[1]) - (b2[1] - h0[1]) * (b1[0] - h0[0]) > 0;
  if (firstOnRight !== (C[1] < 0)) warnings.push('First and third look swapped. Tap first base (the right-field side) second.');
  if (!(C[2] > 1 && C[2] < 120)) warnings.push('The camera height does not come out right. Check that each tap is on the base itself.');
  if (C[1] > bp * 0.5) warnings.push('The camera does not seem to be behind home plate. Check the taps.');
  return { ok: true, taps, basePath: bp, H, Hi, cam, P: cam.P, content: ct, vw, vh, warnings };
}
export const toField = (cal, u, v) => { const p = applyH(cal.Hi, u, v); return p ? [p[0], p[1]] : null; };
export const toImage = (cal, X) => project(cal.P, X);

// the region a standing person occupies above a ground quad: hull of the quad lifted to height h
export function liftedPoly(cal, ground, h) {
  const pts = [];
  for (const [x, y] of ground) for (const z of [0, h]) { const p = project(cal.P, [x, y, z]); if (p[2] > 0) pts.push([p[0], p[1]]); }
  return hull(pts);
}
export function hull(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
// ground quad in field feet: distance d0..d1 along the first-base line, offset o0..o1 (+ = foul side)
export function lineQuad(d0, d1, o0, o1) {
  const r = Math.SQRT1_2;
  return [[d0, o0], [d1, o0], [d1, o1], [d0, o1]].map(([d, o]) => [(d + o) * r, (d - o) * r]);
}
// batter's boxes (field feet): right-handed box on the third-base side (x < 0)
export const BOX = { R: [[-4.6, -2.6], [-1.2, -2.6], [-1.2, 3.8], [-4.6, 3.8]], L: [[1.2, -2.6], [4.6, -2.6], [4.6, 3.8], [1.2, 3.8]] };
export const BOX_CENTER = { R: [-2.75, 0.6], L: [2.75, 0.6] };

// ---------------------------------------------------------------- the ball's flight
function traj(X0, V, taus, k = DRAG, dt = 0.004) {
  const out = []; let X = [...X0], v = [...V], T = 0;
  for (const tau of taus) {
    while (T + dt <= tau) {
      const sp = norm(v);
      const a = [-k * sp * v[0], -k * sp * v[1], -G - k * sp * v[2]];
      v = v.map((q, i) => q + a[i] * dt); X = X.map((q, i) => q + v[i] * dt); T += dt;
    }
    const h = tau - T, sp = norm(v);
    const a = [-k * sp * v[0], -k * sp * v[1], -G - k * sp * v[2]];
    out.push(X.map((q, i) => q + v[i] * h + 0.5 * a[i] * h * h));
  }
  return out;
}
// one weighted least-squares fit of start point X0 and velocity V (drag handled by
// re-linearising around the previous solution). obs: [{t,x,y}] video px.
function fitOnce(P, obs, t0, prior, sig, pixSig) {
  const taus = obs.map((o) => o.t - t0);
  let D = obs.map(() => [0, 0, 0]), w = obs.map(() => 1), X0 = null, V = null, res = null;
  for (let it = 0; it < 6; it++) {
    const AtA = Array.from({ length: 6 }, () => new Array(6).fill(0)), Atb = new Array(6).fill(0);
    const add = (row, rhs) => { for (let i = 0; i < 6; i++) { Atb[i] += row[i] * rhs; for (let j = 0; j < 6; j++) AtA[i][j] += row[i] * row[j]; } };
    obs.forEach((o, j) => {
      const tau = taus[j], off = [D[j][0], D[j][1], -0.5 * G * tau * tau + D[j][2]];
      for (const [r, m] of [[P[0], o.x], [P[1], o.y]]) {
        const a = [r[0] - m * P[2][0], r[1] - m * P[2][1], r[2] - m * P[2][2]];
        const c = (r[3] - m * P[2][3]) + dot(a, off);
        const k = w[j] / pixSig;
        add([a[0] * k, a[1] * k, a[2] * k, a[0] * tau * k, a[1] * tau * k, a[2] * tau * k], -c * k);
      }
    });
    for (let q = 0; q < 3; q++) { const row = [0, 0, 0, 0, 0, 0]; row[q] = 1 / sig[q]; add(row, prior[q] / sig[q]); }
    const s = solve(AtA, Atb);
    if (!s) return null;
    X0 = s.slice(0, 3); V = s.slice(3);
    const pos = traj(X0, V, taus);
    D = pos.map((p, j) => { const tau = taus[j]; return [p[0] - X0[0] - V[0] * tau, p[1] - X0[1] - V[1] * tau, p[2] - X0[2] - V[2] * tau + 0.5 * G * tau * tau]; });
    res = pos.map((p, j) => { const q = project(P, p); w[j] = q[2] > 0 ? 1 / q[2] : 1; return Math.hypot(q[0] - obs[j].x, q[1] - obs[j].y); });
  }
  return { X0, V, res };
}
const median = (a) => { const b = [...a].sort((p, q) => p - q); const m = b.length >> 1; return b.length ? (b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2) : NaN; };

// robust fit: drop the worst point while it is far off the rest
function robust(cal, pts, t0, prior, sig, pixSig, rounds = 8) {
  let fit = null;
  for (let round = 0; round < rounds; round++) {
    fit = fitOnce(cal.P, pts, t0, prior, sig, pixSig);
    if (!fit) return null;
    const med = median(fit.res), lim = Math.max(10 * cal.content.w / 2344, 3 * med);
    const worst = fit.res.indexOf(Math.max(...fit.res));
    if (fit.res[worst] <= lim || pts.length <= 5) break;
    pts = pts.filter((_, i) => i !== worst);
  }
  return { ...fit, pts };
}
// The track's first points can belong to the bat or hands, and the contact time is only
// estimated, so try trimming the start and a few contact times; keep the best-explained fit.
export function fitFlight(cal, track, tContact, opt = {}) {
  const prior = opt.prior || [0, 1.5, 2.6], sig = opt.sig || [1, 1, 0.8];
  const kpx = cal.content.w / 2344, pixSig = (opt.pixSig || 4) * kpx;
  const all = track.filter((p) => tContact == null || p.t > tContact - 0.2).sort((a, b) => a.t - b.t);
  if (all.length < 4) return null;
  let best = null;
  const maxTrim = Math.max(0, Math.min(5, all.length - 6));
  for (let k = 0; k <= maxTrim; k++) {
    const pts = all.slice(k);
    const t0s = [0.017, 0.033, 0.05, 0.075, 0.11].map((d) => pts[0].t - d);
    if (k === 0 && tContact != null && tContact < pts[0].t) t0s.push(tContact);
    for (const t0 of t0s) {
      const f = robust(cal, pts, t0, prior, sig, pixSig, 5);
      if (!f) continue;
      const c = 12 * kpx;
      const cost = (f.res.reduce((s, r) => s + Math.min(r, c) ** 2, 0) + (all.length - f.pts.length) * (7 * kpx) ** 2) / all.length;
      if (!best || cost < best.cost) best = { cost, t0, k, f };
    }
  }
  if (!best) return null;
  const fit = robust(cal, best.f.pts, best.t0, prior, sig, pixSig, 8);
  if (!fit) return null;
  const rms = Math.sqrt(fit.res.reduce((s, r) => s + r * r, 0) / fit.res.length) / kpx;
  return { ...fit, t0: best.t0, trimmed: best.k, rms, n: fit.pts.length, span: fit.pts[fit.pts.length - 1].t - fit.pts[0].t };
}
export function landing(X0, V, k = DRAG, dt = 0.005) {
  let X = [...X0], v = [...V], T = 0, apex = X0[2];
  while (X[2] > 0 && T < 9) {
    const sp = norm(v); const a = [-k * sp * v[0], -k * sp * v[1], -G - k * sp * v[2]];
    v = v.map((q, i) => q + a[i] * dt); X = X.map((q, i) => q + v[i] * dt); T += dt; apex = Math.max(apex, X[2]);
  }
  return { x: X[0], y: X[1], T, apex };
}
export function predictAt(fit, t) { return traj(fit.X0, fit.V, [Math.max(0, t - fit.t0)])[0]; }

// A ball on the ground: its track maps straight onto the field. Fit a line from the plate
// with distance s(t) = b t + c t^2 along it, and measure how well that explains the pixels.
export function groundFit(cal, track, t0, prior = [0, 1.5]) {
  const kpx = cal.content.w / 2344;
  const pts = track.filter((p) => p.t > t0 - 0.01).map((p) => ({ tau: p.t - t0, g: toField(cal, p.x, p.y), p })).filter((q) => q.g && q.g[1] > -15 && Math.hypot(q.g[0], q.g[1]) < 450);
  if (pts.length < 4) return null;
  const evalAt = (deg) => {
    const r = deg * Math.PI / 180, d = [Math.sin(r), Math.cos(r)];
    const sv = pts.map((q) => (q.g[0] - prior[0]) * d[0] + (q.g[1] - prior[1]) * d[1]);
    // least squares for s = b tau + c tau^2
    let a11 = 0, a12 = 0, a22 = 0, r1 = 0, r2 = 0;
    pts.forEach((q, k) => { const t = q.tau, t2 = t * t; a11 += t2; a12 += t2 * t; a22 += t2 * t2; r1 += t * sv[k]; r2 += t2 * sv[k]; });
    const det = a11 * a22 - a12 * a12;
    const b = Math.abs(det) > 1e-12 ? (r1 * a22 - r2 * a12) / det : r1 / Math.max(a11, 1e-9);
    const c = Math.abs(det) > 1e-12 ? (a11 * r2 - a12 * r1) / det : 0;
    const res = pts.map((q) => {
      const sf = b * q.tau + c * q.tau * q.tau;
      const P = project(cal.P, [prior[0] + sf * d[0], prior[1] + sf * d[1], 0.12]);
      return P[2] > 0 ? Math.hypot(P[0] - q.p.x, P[1] - q.p.y) : 1e4;
    });
    const cap = 15 * kpx;
    return { deg, b, c, res, cost: res.reduce((x, v) => x + Math.min(v, cap) ** 2, 0) / res.length };
  };
  let best = null;
  for (let a = -80; a <= 80; a += 1) { const e = evalAt(a); if (!best || e.cost < best.cost) best = e; }
  for (let a = best.deg - 1; a <= best.deg + 1; a += 0.1) { const e = evalAt(a); if (e.cost < best.cost) best = e; }
  const rms = Math.sqrt(best.res.reduce((x, v) => x + v * v, 0) / best.res.length) / kpx;
  const med = [...best.res].sort((p, q) => p - q)[best.res.length >> 1] / kpx;
  return { angle: best.deg, speed: best.b, decel: best.c, rms, med, n: pts.length };
}

// Where the ball went: spray direction, type and landing distance (feet), with a confidence.
// Two explanations of the track compete: a flight through the air (gravity and drag) and a
// ball rolling or skipping along the ground.
export function ballOutcome(cal, ball, field, guessType) {
  const bp = cal.basePath, fence = Number(field && field.fence) || bp * 3.3;
  if (!ball || !ball.found || !ball.track || ball.track.length < 4) return null;
  const fit = fitFlight(cal, ball.track, ball.tContact);
  const gr = groundFit(cal, ball.track, fit ? fit.t0 : ball.tContact);
  if (!fit && !gr) return null;
  let air = null;
  if (fit) {
    const V = fit.V, sp = norm(V), hs = Math.hypot(V[0], V[1]);
    const L = landing(fit.X0, V);
    air = { V, launch: Math.atan2(V[2], hs) * 180 / Math.PI, angle: Math.atan2(V[0], V[1]) * 180 / Math.PI, mph: sp * 0.6818, L, dist: Math.hypot(L.x, L.y), apex: L.apex,
      good: fit.n >= 6 && fit.rms < 6 && sp * 0.6818 > 8 && sp * 0.6818 < 110 && V[1] > -5 };
  }
  const groundOk = gr && gr.n >= 4 && gr.speed > 8 && gr.rms < 9;
  // on the ground when the ground line explains the track about as well, or the flight is low
  let onGround = false;
  if (groundOk && (!air || !air.good)) onGround = true;
  else if (groundOk && air && air.good && (gr.rms <= fit.rms * 1.25 || air.launch < 8 || air.apex < 3.5)) onGround = true;
  let type, angle, dist, conf, how;
  if (onGround) {
    type = 'GB'; angle = gr.angle; dist = bp * 1.05; how = 'ground';
    conf = gr.n >= 8 && gr.rms < 4 ? 'high' : gr.rms < 7 ? 'medium' : 'low';
  } else if (air) {
    type = air.launch < 10 ? 'GB' : air.launch < 25 ? 'LD' : air.launch < 52 ? 'FB' : 'PU';
    if (!air.good && guessType) type = guessType;
    // a soft, low ball that comes down well short of the infielders is played on the bounce
    if (air.good && (type === 'LD' || type === 'FB') && air.dist < bp * 0.7 && air.apex < 10) type = 'GB';
    angle = air.angle; how = 'air';
    if (type === 'GB') dist = bp * 1.05;
    else if (air.good) dist = Math.max(air.dist, bp * 0.6);
    else dist = { LD: 2.1, FB: 2.5, PU: 0.8 }[type] * bp;
    if (type === 'PU') dist = Math.min(dist, bp * 1.6);
    conf = air.good && fit.n >= 9 && fit.span > 0.25 ? 'high' : air.good ? 'medium' : 'low';
  } else return null;
  dist = Math.max(bp * 0.35, Math.min(dist, fence * 1.08));
  const foul = Math.abs(angle) > 47 || (!onGround && air && air.V[1] < 0);
  const r = angle * Math.PI / 180;
  return {
    x: Math.round(Math.sin(r) * dist * 10) / 10, y: Math.round(Math.cos(r) * dist * 10) / 10,
    angle: Math.round(angle * 10) / 10, dist: Math.round(dist), type, how, conf, foul,
    launch: air ? Math.round(air.launch) : null, mph: onGround ? Math.round(gr.speed * 0.6818) : air ? Math.round(air.mph) : null,
    hang: air ? Math.round(air.L.T * 100) / 100 : null,
    n: onGround ? gr.n : fit.n, rms: Math.round((onGround ? gr.rms : fit.rms) * 10) / 10,
    tContact: fit ? fit.t0 : ball.tContact,
    fit: fit && !onGround ? { X0: fit.X0, V: fit.V, t0: fit.t0 } : null,
    ground: gr ? { angle: Math.round(gr.angle * 10) / 10, rms: Math.round(gr.rms * 10) / 10, speed: Math.round(gr.speed) } : null,
    airFit: air ? { angle: Math.round(air.angle * 10) / 10, launch: Math.round(air.launch), rms: Math.round(fit.rms * 10) / 10, dist: Math.round(air.dist) } : null,
  };
}
