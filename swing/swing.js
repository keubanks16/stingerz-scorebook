// Swing analysis: track the batter through a clip with the pose engine, find the swing,
// measure it, and look for the ball off the bat. Video coordinates are source pixels.

export const KP = { nose: 0, lEye: 1, rEye: 2, lEar: 3, rEar: 4, lSh: 5, rSh: 6, lEl: 7, rEl: 8, lWr: 9, rWr: 10, lHip: 11, rHip: 12, lKn: 13, rKn: 14, lAn: 15, rAn: 16 };
export const EDGES = [[5, 6], [5, 7], [7, 9], [6, 8], [8, 10], [5, 11], [6, 12], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16]];
const BODY = [5, 6, 11, 12, 13, 14, 15, 16];

// ---------------------------------------------------------------- frame access
export function waitFrame(video, t, timeoutMs = 2500) {
  return new Promise((resolve) => {
    let done = false, mediaTime = null;
    const finish = () => { if (done) return; done = true; video.removeEventListener('seeked', onSeeked); resolve(mediaTime); };
    const onSeeked = () => {
      if ('requestVideoFrameCallback' in video) {
        video.requestVideoFrameCallback((_, meta) => { mediaTime = meta && typeof meta.mediaTime === 'number' ? meta.mediaTime : null; finish(); });
        setTimeout(finish, 160);
      } else finish();
    };
    video.addEventListener('seeked', onSeeked);
    const target = Math.max(0, Math.min(t, (video.duration || t) - 0.001));
    if (Math.abs(video.currentTime - target) < 1e-4) { onSeeked(); }
    else video.currentTime = target;
    setTimeout(finish, timeoutMs);
  });
}

// draw the square crop (cx, cy, size) of the current video frame into a 256x256 canvas
export function drawCrop(video, ctx, cx, cy, size) {
  const S = ctx.canvas.width;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, S, S);
  const vw = video.videoWidth, vh = video.videoHeight;
  const x0 = cx - size / 2, y0 = cy - size / 2;
  const sx = Math.max(0, x0), sy = Math.max(0, y0);
  const ex = Math.min(vw, x0 + size), ey = Math.min(vh, y0 + size);
  if (ex <= sx || ey <= sy) return;
  const k = S / size;
  ctx.drawImage(video, sx, sy, ex - sx, ey - sy, (sx - x0) * k, (sy - y0) * k, (ex - sx) * k, (ey - sy) * k);
}

// ---------------------------------------------------------------- pose helpers
function toVideo(out, cx, cy, size) {        // MoveNet (y,x,score) in crop -> [x,y,score] video px
  const kp = new Float32Array(51), x0 = cx - size / 2, y0 = cy - size / 2;
  for (let k = 0; k < 17; k++) {
    kp[k * 3] = x0 + out[k * 3 + 1] * size;
    kp[k * 3 + 1] = y0 + out[k * 3] * size;
    kp[k * 3 + 2] = out[k * 3 + 2];
  }
  return kp;
}
const X = (kp, k) => kp[k * 3], Y = (kp, k) => kp[k * 3 + 1], S = (kp, k) => kp[k * 3 + 2];
export function bodyConf(kp) { let s = 0; for (const k of BODY) s += S(kp, k); return s / BODY.length; }
function extent(kp, thr = 0.25) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, n = 0;
  for (let k = 0; k < 17; k++) if (S(kp, k) > thr) { const x = X(kp, k), y = Y(kp, k); x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); n++; }
  if (n < 6) return null;
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0, ext: Math.max(x1 - x0, y1 - y0) };
}
function hipCenter(kp) {
  if (S(kp, 11) > 0.2 && S(kp, 12) > 0.2) return [(X(kp, 11) + X(kp, 12)) / 2, (Y(kp, 11) + Y(kp, 12)) / 2];
  const e = extent(kp, 0.2); return e ? [e.cx, e.cy] : [NaN, NaN];
}
function headCenter(kp) {
  let x = 0, y = 0, n = 0;
  for (let k = 0; k < 5; k++) if (S(kp, k) > 0.25) { x += X(kp, k); y += Y(kp, k); n++; }
  return n ? [x / n, y / n] : [X(kp, 0), Y(kp, 0)];
}
function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
function median(a) { const b = a.filter(Number.isFinite).sort((p, q) => p - q); if (!b.length) return NaN; const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; }
function medianFilter(a, w = 5) { const h = w >> 1; return a.map((_, i) => median(a.slice(Math.max(0, i - h), i + h + 1))); }
function smooth(a, w = 3) { const h = w >> 1; return a.map((_, i) => { let s = 0, n = 0; for (let j = Math.max(0, i - h); j <= Math.min(a.length - 1, i + h); j++) if (Number.isFinite(a[j])) { s += a[j]; n++; } return n ? s / n : NaN; }); }

// ---------------------------------------------------------------- tracker
class Tracker {
  constructor(pose, video) {
    this.pose = pose; this.video = video;
    const c = document.createElement('canvas'); c.width = c.height = 256;
    this.ctx = c.getContext('2d', { willReadFrequently: true });
    this.ctx.imageSmoothingQuality = 'high';
    const f = document.createElement('canvas'); f.width = 40; f.height = 24;
    this.fctx = f.getContext('2d', { willReadFrequently: true });
    this.lastPrint = null;
  }
  // true when the frame on screen is identical to the one seen last time (a repeated frame)
  sameAsLast() {
    const v = this.video;
    this.fctx.drawImage(v, 0, 0, v.videoWidth, v.videoHeight, 0, 0, 40, 24);
    const d = this.fctx.getImageData(0, 0, 40, 24).data;
    let same = !!this.lastPrint;
    if (same) for (let i = 0; i < d.length; i += 4) if (d[i] !== this.lastPrint[i] || d[i + 1] !== this.lastPrint[i + 1]) { same = false; break; }
    this.lastPrint = d;
    return same;
  }
  async infer(cx, cy, size) {
    drawCrop(this.video, this.ctx, cx, cy, size);
    const out = await this.pose.estimate(this.ctx.canvas);
    return toVideo(out, cx, cy, size);
  }
  // two passes: wide crop around a point, then a crop fitted to the body found
  async acquire(px, py, size) {
    let best = null;
    for (const s of [size, size * 1.6, size * 0.7]) {
      const kp = await this.infer(px, py, s);
      const e = extent(kp);
      if (!e) continue;
      const fit = Math.max(e.ext * 1.45, 64);
      const kp2 = await this.infer(e.cx, e.cy, fit);
      const c2 = bodyConf(kp2);
      // the body found must contain (or be near) the tapped point
      const e2 = extent(kp2) || e;
      const near = dist(e2.cx, e2.cy, px, py) < Math.max(e2.ext * 0.75, 40);
      if (near && (!best || c2 > best.conf)) best = { kp: kp2, conf: c2, cx: e2.cx, cy: e2.cy, size: Math.max(e2.ext * 1.45, 64) };
      if (best && best.conf > 0.45) break;
    }
    return best;
  }
}

// find a person near (x, y) at time t (a crop of about `size` px); null if nobody there
export async function acquireAt(video, pose, x, y, size, t) {
  const tr = new Tracker(pose, video);
  if (t != null) await waitFrame(video, t);
  return tr.acquire(x, y, size);
}
export { extent, hipCenter, headCenter };

function frameState(kp, prev) {
  const e = extent(kp);
  if (!e) return null;
  const conf = bodyConf(kp);
  return { e, conf };
}

// ---------------------------------------------------------------- main entry
export async function analyzeSwing({ video, pose, seed, onProgress = () => {}, signal, hint, tEnd }) {
  const tr = new Tracker(pose, video);
  const vh = video.videoHeight, dur = video.duration;
  const tStop = Math.min(dur, tEnd != null ? tEnd : dur);      // a full game: only scan this window
  const check = () => { if (signal && signal.aborted) throw new DOMException('Stopped', 'AbortError'); };

  // 1. acquire the batter at the tapped point
  onProgress({ stage: 'Finding the batter', p: 0 });
  await waitFrame(video, seed.t);
  const acq = await tr.acquire(seed.x, seed.y, vh * 0.3);
  if (!acq || acq.conf < 0.22) return { error: 'no_batter' };
  let cx = acq.cx, cy = acq.cy, size = acq.size;
  const H0 = acq.size / 1.45;            // rough body extent in px

  // 2. coarse scan forward to find the swing
  const t0 = seed.t;
  const span = Math.max(0.5, tStop - t0);
  const step = span <= 16 ? 0.1 : Math.min(0.25, span / 160);
  const coarse = [];
  let lost = 0, hip0 = null;
  for (let t = t0; t <= tStop - 0.02; t += step) {
    check();
    await waitFrame(video, t);
    const kp = await tr.infer(cx, cy, size);
    const st = frameState(kp);
    const ok = st && st.conf > 0.25 && dist(st.e.cx, st.e.cy, cx, cy) < 0.9 * size && st.e.ext < size * 1.2 && st.e.ext > size * 0.35;
    if (ok) {
      lost = 0;
      coarse.push({ t, kp });
      if (!hip0) hip0 = hipCenter(kp);
      const hc = hipCenter(kp);
      if (dist(hc[0], hc[1], hip0[0], hip0[1]) > 1.6 * H0 / 1.0 && t > t0 + 0.5) { onProgress({ stage: 'Scanning the clip', p: 1 }); break; }
      cx = 0.4 * cx + 0.6 * st.e.cx; cy = 0.4 * cy + 0.6 * st.e.cy;
      size = 0.7 * size + 0.3 * Math.max(st.e.ext * 1.45, 64);
    } else if (++lost >= 3) break;
    onProgress({ stage: 'Scanning the clip', p: Math.min(1, (t - t0) / span), box: { cx, cy, size }, kp });
  }
  if (coarse.length < 5) return { error: 'lost_batter', coarse };

  const swing = findSwing(coarse, hint);
  if (!swing) return { error: 'no_swing', coarse };

  // 3. fine pass around the swing
  const wa = Math.max(t0, swing.t - 1.3), wb = Math.min(dur - 0.02, swing.t + 0.9);
  const near = coarse.reduce((b, f) => (Math.abs(f.t - wa) < Math.abs(b.t - wa) ? f : b), coarse[0]);
  const ne = extent(near.kp);
  cx = ne.cx; cy = ne.cy; size = Math.max(ne.ext * 1.45, 64);
  const Hb = bodyHeight(coarse.filter((f) => f.t < swing.t - 0.6).map((f) => f.kp)) || H0;
  const times = [];
  for (let t = wa; t <= wb + 1e-6;) { times.push(t); t += (Math.abs(t - swing.t) < 0.45 ? 1 / 60 : 1 / 30); }
  const frames = [];
  const grayFrames = [];
  let region = null, lastMedia = null, bad = 0;
  for (let i = 0; i < times.length; i++) {
    check();
    const mt = await waitFrame(video, times[i]);
    if (mt != null && lastMedia != null && Math.abs(mt - lastMedia) < 1e-4) continue;   // same frame as before
    lastMedia = mt;
    if (tr.sameAsLast()) continue;
    const t = mt != null ? mt : times[i];
    let kp = await tr.infer(cx, cy, size);
    let st = frameState(kp);
    if (!st || st.conf < 0.33) {                      // refit and retry once
      const e = st ? st.e : null;
      if (e) { const kp2 = await tr.infer(e.cx, e.cy, Math.max(e.ext * 1.45, 64)); const s2 = frameState(kp2); if (s2 && (!st || s2.conf > st.conf)) { kp = kp2; st = s2; } }
    }
    const jump = st ? dist(st.e.cx, st.e.cy, cx, cy) : Infinity;
    const ok = st && st.conf > 0.22 && jump < 0.6 * size && st.e.ext > size * 0.35 && st.e.ext < size * 1.15;
    if (!ok) { if (++bad >= 2 && t > swing.t + 0.2) break; continue; }
    bad = 0;
    frames.push({ t, kp });
    cx = 0.3 * cx + 0.7 * st.e.cx; cy = 0.3 * cy + 0.7 * st.e.cy;
    size = 0.6 * size + 0.4 * Math.max(st.e.ext * 1.45, 64);
    // grey copies of the region around the batter, for finding the ball
    if (t >= swing.t - 0.25 && t <= swing.t + 0.9) {
      if (!region) region = ballRegion(kp, Hb, video);
      grayFrames.push({ t, g: grabGray(video, region) });
    }
    onProgress({ stage: 'Tracking the swing', p: i / times.length, box: { cx, cy, size }, kp });
  }
  if (frames.length < 8) return { error: 'lost_batter', coarse };

  // 4. measurements
  onProgress({ stage: 'Measuring', p: 1 });
  const m = measure(frames, swing.t);
  // 5. ball off the bat
  let ball = null;
  if (region && grayFrames.length > 5) {
    try { ball = findBall(grayFrames, region, frames, m, Hb); } catch (e) { ball = null; }
  }
  if (ball && ball.tContact) { m.events.tContact = ball.tContact; m.events.contactSource = 'ball'; }
  finalizeMetrics(m, frames);
  return { frames, coarse, swingT: swing.t, H: m.H, events: m.events, metrics: m.metrics, series: m.series, ball, region };
}

function bodyHeight(kps) {
  const v = kps.map((kp) => {
    const ay = (S(kp, 15) > 0.2 && S(kp, 16) > 0.2) ? (Y(kp, 15) + Y(kp, 16)) / 2 : Math.max(Y(kp, 15), Y(kp, 16));
    return ay - headCenter(kp)[1];
  });
  return median(v);
}

// The swing: the first time the shoulders and hips turn well away from their stance width
// (seen from behind the plate they open up; from the side they close), while the batter is
// still in the box. Falls back to the biggest burst of upper-body motion.
export function findSwing(coarse, hint) {
  const n0 = Math.max(3, Math.min(Math.floor(coarse.length * 0.3), coarse.findIndex((f) => f.t > coarse[0].t + 1.5) > 0 ? coarse.findIndex((f) => f.t > coarse[0].t + 1.5) : 3));
  const H = bodyHeight(coarse.slice(0, n0).map((f) => f.kp)) || 100;
  const sw = coarse.map((f) => dist(X(f.kp, 5), Y(f.kp, 5), X(f.kp, 6), Y(f.kp, 6)) / H);
  const hw = coarse.map((f) => dist(X(f.kp, 11), Y(f.kp, 11), X(f.kp, 12), Y(f.kp, 12)) / H);
  const sw0 = median(sw.slice(0, n0)), hw0 = median(hw.slice(0, n0));
  // where the batter stands: the middle of the stance frames, not just the first one
  const hs0 = coarse.slice(0, n0).map((f) => hipCenter(f.kp));
  const hip0 = [median(hs0.map((h) => h[0])), median(hs0.map((h) => h[1]))];
  const turn = coarse.map((_, i) => Math.abs(sw[i] - sw0) + Math.abs(hw[i] - hw0));
  const inBox = coarse.map((f) => { const h = hipCenter(f.kp); return dist(h[0], h[1], hip0[0], hip0[1]) < 0.45 * H; });
  const crossings = [];
  for (let i = n0; i + 1 < coarse.length; i++) {
    if (turn[i] > 0.14 && turn[i + 1] > 0.14 && inBox[i] && (i === n0 || turn[i - 1] <= 0.14)) crossings.push({ t: coarse[i].t, i, v: turn[i] + turn[i + 1] });
  }
  if (crossings.length) {
    let pick = crossings[0];
    let ok = true;
    if (hint != null && typeof hint === 'object') {
      // a window: the first turn inside it (later turns are the batter turning to run)
      const inWin = crossings.filter((c) => c.t >= hint.lo && c.t <= hint.hi);
      if (inWin.length) pick = inWin[0]; else ok = false;      // none in the window: try the motion burst below
    } else if (hint != null) pick = crossings.reduce((a, b) => (Math.abs(b.t - hint) < Math.abs(a.t - hint) ? b : a));
    if (ok) return { t: pick.t, v: pick.v, H, how: 'turn' };
  }
  // fallback: biggest burst of upper-body motion relative to the hips, before leaving the box
  const UP = [5, 6, 7, 8, 9, 10];
  const score = [];
  for (let i = 1; i < coarse.length; i++) {
    if (!inBox[i]) { if (hint != null && typeof hint === 'object') continue; break; }
    const a = coarse[i - 1].kp, b = coarse[i].kp, dt = coarse[i].t - coarse[i - 1].t;
    const ha = hipCenter(a), hb = hipCenter(b);
    let s = 0, n = 0;
    for (const k of UP) {
      const w = Math.min(S(a, k), S(b, k));
      if (w < 0.15) continue;
      s += w * dist(X(b, k) - hb[0], Y(b, k) - hb[1], X(a, k) - ha[0], Y(a, k) - ha[1]);
      n += w;
    }
    score.push({ t: coarse[i].t, v: n ? s / n / H / dt : 0 });
  }
  if (!score.length) return null;
  let cands = hint == null ? score : typeof hint === 'object' ? score.filter((s) => s.t >= hint.lo && s.t <= hint.hi) : score.filter((s) => Math.abs(s.t - hint) < 0.8);
  if (!cands.length) cands = score;
  const best = cands.reduce((a, b) => (b.v > a.v ? b : a));
  if (best.v < 0.9) return null;        // body barely moved: probably a take
  return { t: best.t, v: best.v, H, how: 'motion' };
}

// ---------------------------------------------------------------- measurements
export function measure(frames, tSwing) {
  const t = frames.map((f) => f.t);
  const K = frames.map((f) => f.kp);
  const pre = t.map((tt) => tt < tSwing - 0.75);
  const preK = K.filter((_, i) => pre[i]);
  const H = bodyHeight(preK.length >= 3 ? preK : K.slice(0, 5));
  const shw = smooth(K.map((kp) => dist(X(kp, 5), Y(kp, 5), X(kp, 6), Y(kp, 6))));
  const hpw = smooth(K.map((kp) => dist(X(kp, 11), Y(kp, 11), X(kp, 12), Y(kp, 12))));
  const norm = (a) => {
    const base = median(a.filter((_, i) => pre[i]).length >= 3 ? a.filter((_, i) => pre[i]) : a.slice(0, 5));
    let mx = -Infinity;
    for (let i = 0; i < a.length; i++) if (t[i] <= tSwing + 0.45 && a[i] > mx) mx = a[i];
    const r = mx - base;
    return a.map((v) => (r > 1e-6 ? Math.min(1, Math.max(0, (v - base) / r)) : 0));
  };
  const sh = norm(shw), hp = norm(hpw);
  const firstSustained = (mask, after, n = 2) => { for (let i = 0; i + n <= mask.length; i++) if (t[i] >= after && mask.slice(i, i + n).every(Boolean)) return t[i]; return null; };

  // ankles: when both land on the same spot the weaker one is a mislabel; then median-filter
  const ank = (k) => {
    const o = k === 15 ? 16 : 15;
    const ys = K.map((kp) => (dist(X(kp, k), Y(kp, k), X(kp, o), Y(kp, o)) < 0.06 * H && S(kp, k) < S(kp, o)) || S(kp, k) < 0.12 ? NaN : Y(kp, k));
    const xs = K.map((kp, i) => (Number.isNaN(ys[i]) ? NaN : X(kp, k)));
    return { y: medianFilter(ys, 5), x: medianFilter(xs, 5) };
  };
  const A = { 15: ank(15), 16: ank(16) };
  // front foot = the ankle that lifts during the load
  const lift = [15, 16].map((k) => {
    const base = median(A[k].y.filter((_, i) => pre[i]));
    let mn = Infinity; for (let i = 0; i < K.length; i++) if (t[i] > tSwing - 0.8 && t[i] < tSwing + 0.1 && Number.isFinite(A[k].y[i])) mn = Math.min(mn, A[k].y[i]);
    return base - mn;
  });
  const FA = (lift[0] >= lift[1] || !Number.isFinite(lift[1])) ? 15 : 16;
  const fy = A[FA].y;
  const fx = A[FA].x;
  const fyBase = median(fy.filter((_, i) => pre[i]));
  const fxBase = median(fx.filter((_, i) => pre[i]));
  let iPeak = -1, mn = Infinity;
  for (let i = 0; i < fy.length; i++) if (t[i] > tSwing - 0.9 && t[i] < tSwing + 0.15 && Number.isFinite(fy[i]) && fy[i] < mn) { mn = fy[i]; iPeak = i; }
  const liftAmt = fyBase - mn;
  // leg lift starts where the front ankle last sat in its stance band before the peak
  const preY = fy.filter((v, i) => pre[i] && Number.isFinite(v));
  const mad = median(preY.map((v) => Math.abs(v - fyBase)));
  const band = Math.max(0.04 * H, 3 * (mad || 0));
  let tLift = null;
  if (iPeak > 0 && liftAmt > 0.05 * H) {
    let i = iPeak;
    while (i > 0 && !(Number.isFinite(fy[i - 1]) && fy[i - 1] >= fyBase - band)) i--;
    tLift = t[i];
  }
  let tDown = (iPeak >= 0 && liftAmt > 0.05 * H) ? firstSustained(fy.map((v) => v >= mn + 0.075 * H), t[iPeak]) : null;
  const tHip = firstSustained(hp.map((v) => v > 0.4), tSwing - 0.6);
  const tSh = firstSustained(sh.map((v) => v > 0.4), tSwing - 0.6);
  const tRot = (tHip != null && tSh != null) ? (tHip + tSh) / 2 : (tHip ?? tSh ?? tSwing);
  // the front foot has to land before the body turns; otherwise this was not the stride
  if (tDown != null && tDown > tRot + 0.12) tDown = null;
  if (tLift != null && tDown != null && tLift >= tDown) tLift = null;
  // stride: how far the front foot travelled (in body heights)
  let stride = NaN;
  if (tDown != null) { const i = t.findIndex((tt) => tt >= tDown); if (i >= 0) stride = dist(fx[i], fy[i], fxBase, fyBase) / H; }
  return {
    H, frontAnkle: FA === 15 ? 'left' : 'right',
    events: { tLift: tLift != null && tLift < tRot ? tLift : null, tDown, tHip, tSh, tRot, tContact: tRot + 0.13, contactSource: 'estimate' },
    series: { t, sh, hp },
    metrics: { stride, liftHeight: liftAmt / H },
  };
}

export function finalizeMetrics(m, frames) {
  const e = m.events, t = m.series.t;
  const at = (arr, tt) => { let b = 0; for (let i = 0; i < t.length; i++) if (Math.abs(t[i] - tt) < Math.abs(t[b] - tt)) b = i; return arr[b]; };
  const K = frames.map((f) => f.kp);
  const pre = K.filter((_, i) => t[i] < (e.tLift ?? e.tRot - 0.5));
  const h0 = pre.length ? [median(pre.map((kp) => headCenter(kp)[0])), median(pre.map((kp) => headCenter(kp)[1]))] : headCenter(K[0]);
  const kc = K[t.reduce((b, tt, i) => (Math.abs(tt - e.tContact) < Math.abs(t[b] - e.tContact) ? i : b), 0)];
  const hc = headCenter(kc);
  Object.assign(m.metrics, {
    liftToContact: e.tLift != null ? e.tContact - e.tLift : null,
    downToContact: e.tDown != null ? e.tContact - e.tDown : null,
    downToRotation: e.tDown != null ? e.tRot - e.tDown : null,
    hipLead: (e.tHip != null && e.tSh != null) ? e.tSh - e.tHip : null,     // + = hips first
    shoulderOpenAtContact: at(m.series.sh, e.tContact),
    hipOpenAtContact: at(m.series.hp, e.tContact),
    headDrift: dist(hc[0], hc[1], h0[0], h0[1]) / m.H,
  });
}

// ---------------------------------------------------------------- ball off the bat
const GS = 80;     // grey image scale: body height -> 80 px
export function ballRegion(kp, H, video) {
  const h = hipCenter(kp), hd = headCenter(kp);
  const x0 = Math.max(0, h[0] - 4.5 * H), x1 = Math.min(video.videoWidth, h[0] + 4.5 * H);
  const y0 = Math.max(0, hd[1] - 4.5 * H), y1 = Math.min(video.videoHeight, h[1] + 1.2 * H);
  const s = GS / H;
  const c = document.createElement('canvas');
  c.width = Math.max(8, Math.round((x1 - x0) * s)); c.height = Math.max(8, Math.round((y1 - y0) * s));
  return { x0, y0, x1, y1, s, w: c.width, h: c.height, ctx: c.getContext('2d', { willReadFrequently: true }) };
}
export function grabGray(video, R) {
  R.ctx.drawImage(video, R.x0, R.y0, R.x1 - R.x0, R.y1 - R.y0, 0, 0, R.w, R.h);
  const d = R.ctx.getImageData(0, 0, R.w, R.h).data;
  const g = new Uint8Array(R.w * R.h);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
  return g;
}

// small blobs moving in frame k (differs from both neighbours)
export function movingBlobs(a, b, c, w, h, bodyBox) {
  const n = w * h, m = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const d1 = Math.abs(b[i] - a[i]), d2 = Math.abs(b[i] - c[i]);
    m[i] = (d1 < d2 ? d1 : d2) > 28 ? 1 : 0;
  }
  const lab = new Int32Array(n), out = [];
  const stack = [];
  let id = 0;
  for (let i = 0; i < n; i++) {
    if (!m[i] || lab[i]) continue;
    id++; let area = 0, sx = 0, sy = 0, minx = w, maxx = 0, miny = h, maxy = 0;
    stack.push(i); lab[i] = id;
    while (stack.length) {
      const p = stack.pop(); const px = p % w, py = (p / w) | 0;
      area++; sx += px; sy += py;
      if (px < minx) minx = px; if (px > maxx) maxx = px; if (py < miny) miny = py; if (py > maxy) maxy = py;
      if (area > 400) continue;
      const nb = [p - 1, p + 1, p - w, p + w];
      for (const q of nb) { if (q < 0 || q >= n) continue; if ((q === p - 1 && px === 0) || (q === p + 1 && px === w - 1)) continue; if (m[q] && !lab[q]) { lab[q] = id; stack.push(q); } }
    }
    const bw = maxx - minx + 1, bh = maxy - miny + 1;
    if (area < 2 || area > 160 || bw > 16 || bh > 16) continue;
    const x = sx / area, y = sy / area;
    if (bodyBox && x > bodyBox[0] && x < bodyBox[2] && y > bodyBox[1] && y < bodyBox[3]) continue;
    out.push({ x, y, a: area });
  }
  return out;
}

// frames whose region is (nearly) identical to the previous one are repeats: drop them
function nearSame(a, b) {
  let n = 0; const lim = Math.max(20, a.length * 0.0004);
  for (let i = 0; i < a.length; i += 2) if (Math.abs(a[i] - b[i]) > 22 && ++n > lim) return false;
  return true;
}

export function findBall(G0, R, frames, m, H) {
  const s = R.s, e = m.events;
  const G = [G0[0]];
  for (let k = 1; k < G0.length; k++) if (!nearSame(G0[k].g, G[G.length - 1].g)) G.push(G0[k]);
  // contact zone: in front of the batter at hand height, at the moment of rotation
  const fr = frames.reduce((b, f) => (Math.abs(f.t - e.tRot) < Math.abs(b.t - e.tRot) ? f : b), frames[0]);
  const kpAt = (tt) => frames.reduce((b, f) => (Math.abs(f.t - tt) < Math.abs(b.t - tt) ? f : b), frames[0]).kp;
  const hand = (kp) => { const ws = [9, 10].filter((k) => S(kp, k) > 0.15); if (ws.length) return [ws.reduce((a, k) => a + X(kp, k), 0) / ws.length, ws.reduce((a, k) => a + Y(kp, k), 0) / ws.length]; const h = hipCenter(kp); return [h[0], h[1] - 0.25 * H]; };
  const zone = hand(fr.kp).map((v, i) => (v - (i ? R.y0 : R.x0)) * s);
  const blobs = [];
  for (let k = 1; k < G.length - 1; k++) {
    const kp = kpAt(G[k].t); const ex = extent(kp, 0.2);
    const box = ex ? [(ex.cx - ex.w / 2 - R.x0) * s - 4, (ex.cy - ex.h / 2 - R.y0) * s - 4, (ex.cx + ex.w / 2 - R.x0) * s + 4, (ex.cy + ex.h / 2 - R.y0) * s + 4] : null;
    blobs.push({ t: G[k].t, b: movingBlobs(G[k - 1].g, G[k].g, G[k + 1].g, R.w, R.h, box) });
  }
  const HP = GS;                                   // body height in grey pixels
  const cands = [];
  for (let i = 0; i < blobs.length - 4; i++) {
    if (blobs[i].t < e.tRot || blobs[i].t > e.tRot + 0.5) continue;
    for (const b0 of blobs[i].b) {
      const d0 = Math.hypot(b0.x - zone[0], b0.y - zone[1]);
      if (d0 > 2.2 * HP || d0 < 0.45 * HP) continue;
      for (const b1 of blobs[i + 1].b) {
        const dt1 = (blobs[i + 1].t - blobs[i].t) / (1 / 30);
        const step = Math.hypot(b1.x - b0.x, b1.y - b0.y) / dt1;
        if (step < 0.05 * HP || step > 1.0 * HP) continue;
        if (Math.hypot(b1.x - zone[0], b1.y - zone[1]) <= d0) continue;   // must move away from the batter
        const tr = [{ t: blobs[i].t, x: b0.x, y: b0.y }, { t: blobs[i + 1].t, x: b1.x, y: b1.y }];
        let vx = (b1.x - b0.x) / (blobs[i + 1].t - blobs[i].t), vy = (b1.y - b0.y) / (blobs[i + 1].t - blobs[i].t);
        let miss = 0;
        for (let j = i + 2; j < blobs.length && miss < 2; j++) {
          const last = tr[tr.length - 1], dt = blobs[j].t - last.t;
          const px = last.x + vx * dt, py = last.y + vy * dt;
          const gate = 0.22 * HP + 0.35 * Math.hypot(vx * dt, vy * dt);
          let pick = null, pd = gate;
          for (const c of blobs[j].b) { const d = Math.hypot(c.x - px, c.y - py); if (d < pd) { pd = d; pick = c; } }
          if (!pick) { miss++; continue; }
          miss = 0;
          const nvx = (pick.x - last.x) / dt, nvy = (pick.y - last.y) / dt;
          vx = 0.5 * vx + 0.5 * nvx; vy = 0.5 * vy + 0.5 * nvy;
          tr.push({ t: blobs[j].t, x: pick.x, y: pick.y });
        }
        if (tr.length < 5) continue;
        const last = tr[tr.length - 1];
        const net = Math.hypot(last.x - zone[0], last.y - zone[1]) - d0;
        const steps = []; for (let q = 0; q + 1 < tr.length; q++) steps.push(Math.hypot(tr[q + 1].x - tr[q].x, tr[q + 1].y - tr[q].y) / ((tr[q + 1].t - tr[q].t) * 30));
        // a ball hit away from the camera crosses little of the picture: allow a shorter
        // net move when the track is long and steady
        const minNet = tr.length >= 8 ? 0.45 * HP : 1.0 * HP;
        if (net < minNet || median(steps) < 0.04 * HP) continue;
        const score = tr.length * net / HP;
        cands.push({ score, tr });
      }
    }
  }
  if (!cands.length) return { found: false };
  // the best track, plus a few others that start elsewhere (the bat or a hand can look like the ball)
  cands.sort((p, q) => q.score - p.score);
  const picked = [];
  for (const c of cands) {
    if (picked.length >= 4) break;
    if (picked.some((p) => p.tr.some((a) => c.tr.some((b) => a.t === b.t && Math.hypot(a.x - b.x, a.y - b.y) < 2)))) continue;
    picked.push(c);
  }
  const out = picked.map((c) => describeTrack(c.tr, R, s, zone, kpAt, H));
  return { ...out[0], alts: out.slice(1) };
}
function describeTrack(best, R, s, zone, kpAt, H) {
  const toV = (p) => ({ t: p.t, x: R.x0 + p.x / s, y: R.y0 + p.y / s });
  const track = best.map(toV);
  // contact: extrapolate the first two points back to the contact zone
  const a = best[0], b = best[1];
  const sp = Math.hypot(b.x - a.x, b.y - a.y) / (b.t - a.t);
  const back = Math.hypot(a.x - zone[0], a.y - zone[1]) / Math.max(sp, 1e-3);
  const tContact = a.t - Math.min(Math.max(back, 0), 0.033);
  // in the air or on the ground: how high above the batter's head it climbs (body heights)
  const kc = kpAt(tContact);
  const headY = headCenter(kc)[1];
  let minY = Infinity, dxTot = track[track.length - 1].x - track[0].x;
  for (const p of track) minY = Math.min(minY, p.y);
  const rise = (headY - minY) / H;
  const climb = (track[0].y - minY) / H;
  let air = null, type = null;
  if (rise > 1.0) { air = true; type = Math.abs(dxTot) / H < 0.35 * climb ? 'PU' : (climb / Math.max(Math.abs(dxTot) / H, 0.01) > 0.55 ? 'FB' : 'LD'); }
  else if (rise < 0.2) { air = false; type = 'GB'; }
  return { found: true, track, tContact, rise, air, type };
}

// ---------------------------------------------------------------- storage helpers
// pack keypoints compactly: per frame 17 x (x,y as uint16 of frame size, score as uint8)
export function packFrames(frames, vw, vh) {
  const n = frames.length, buf = new Uint8Array(n * 17 * 5);
  let o = 0;
  for (const f of frames) for (let k = 0; k < 17; k++) {
    const x = Math.round(Math.min(1, Math.max(0, f.kp[k * 3] / vw)) * 65535), y = Math.round(Math.min(1, Math.max(0, f.kp[k * 3 + 1] / vh)) * 65535);
    buf[o++] = x >> 8; buf[o++] = x & 255; buf[o++] = y >> 8; buf[o++] = y & 255; buf[o++] = Math.round(Math.min(1, Math.max(0, f.kp[k * 3 + 2])) * 255);
  }
  let s = ''; for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
  return { t: frames.map((f) => Math.round(f.t * 1000) / 1000), kp: btoa(s), vw, vh };
}
export function unpackFrames(p) {
  const bin = atob(p.kp), out = [];
  for (let i = 0; i < p.t.length; i++) {
    const kp = new Float32Array(51);
    for (let k = 0; k < 17; k++) {
      const o = (i * 17 + k) * 5;
      kp[k * 3] = ((bin.charCodeAt(o) << 8) | bin.charCodeAt(o + 1)) / 65535 * p.vw;
      kp[k * 3 + 1] = ((bin.charCodeAt(o + 2) << 8) | bin.charCodeAt(o + 3)) / 65535 * p.vh;
      kp[k * 3 + 2] = bin.charCodeAt(o + 4) / 255;
    }
    out.push({ t: p.t[i], kp });
  }
  return out;
}
