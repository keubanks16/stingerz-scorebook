// Spray tendencies and the swing-based prediction. Pure functions, no DOM.
//
// Field coordinates are feet from home plate: +y toward center field, +x toward the
// first-base / right-field side. Spray angle is degrees from straightaway center,
// negative toward left field. "Pull frame" flips it so positive is always the pull side.

export const ZONES = ['pullLine', 'pullGap', 'center', 'oppoGap', 'oppoLine'];
export const ZONE_LABEL = { pullLine: 'Pull line', pullGap: 'Pull gap', center: 'Up the middle', oppoGap: 'Oppo gap', oppoLine: 'Oppo line' };
export const TYPES = ['GB', 'LD', 'FB', 'PU'];
export const TYPE_LABEL = { GB: 'Ground ball', LD: 'Line drive', FB: 'Fly ball', PU: 'Pop up', BU: 'Bunt' };
export const RESULT_LABEL = { '1B': 'Single', '2B': 'Double', '3B': 'Triple', HR: 'Home run', OUT: 'Out', E: 'Error', FC: "Fielder's choice", FOUL: 'Foul', MISS: 'Swing and miss', TAKE: 'Took the pitch' };
export const HIT = new Set(['1B', '2B', '3B', 'HR']);
const PRIOR = [0.17, 0.26, 0.24, 0.2, 0.13];      // youth hitters lean to the pull side
const TYPE_PRIOR = [0.45, 0.2, 0.25, 0.1];

export const sprayAngle = (x, y) => Math.atan2(x, y) * 180 / Math.PI;
export const pullAngle = (angle, bats) => (bats === 'L' ? angle : -angle);
export const fieldAngle = (pull, bats) => (bats === 'L' ? pull : -pull);
export function zoneOf(pull) {
  if (pull > 27) return 0;
  if (pull > 9) return 1;
  if (pull >= -9) return 2;
  if (pull >= -27) return 3;
  return 4;
}
export const sideOf = (pull) => (pull > 15 ? 'pull' : pull < -15 ? 'oppo' : 'center');
export const zoneCenterPull = (z) => [36, 18, 0, -18, -36][z];

export function inPlay(ab) {
  return ab && ab.outcome && ab.outcome.kind === 'inplay' && Number.isFinite(ab.outcome.x) && Number.isFinite(ab.outcome.y) && (ab.bats === 'R' || ab.bats === 'L');
}
export function abPull(ab) { return pullAngle(sprayAngle(ab.outcome.x, ab.outcome.y), ab.bats); }

const norm = (a) => { const s = a.reduce((p, q) => p + q, 0); return s > 0 ? a.map((v) => v / s) : a.map(() => 1 / a.length); };

// ---------------------------------------------------------------- swing features
export const FEATURES = [
  { key: 'downToRotation', label: 'Foot down → turn', unit: 's' },
  { key: 'loadTime', label: 'Leg lift → turn', unit: 's' },
  { key: 'hipLead', label: 'Hips ahead of shoulders', unit: 's' },
  { key: 'shoulderOpenAtContact', label: 'Shoulders open at contact', unit: '%' },
  { key: 'headDrift', label: 'Head drift', unit: '%H' },
  { key: 'stride', label: 'Stride', unit: 'H' },
];
export function featureVector(sw) {
  if (!sw || !sw.metrics) return null;
  const m = sw.metrics, e = sw.events || {};
  return {
    downToRotation: num(m.downToRotation),
    loadTime: (e.tLift != null && e.tRot != null) ? e.tRot - e.tLift : null,
    hipLead: num(m.hipLead),
    shoulderOpenAtContact: e.contactSource === 'estimate' ? null : num(m.shoulderOpenAtContact),
    headDrift: num(m.headDrift),
    stride: num(m.stride),
  };
}
const num = (v) => (Number.isFinite(v) ? v : null);

function featureStats(rows) {
  const st = {};
  for (const f of FEATURES) {
    const v = rows.map((r) => r.f && r.f[f.key]).filter((x) => x != null);
    if (v.length < 3) continue;
    const mu = v.reduce((a, b) => a + b, 0) / v.length;
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - mu) ** 2, 0) / (v.length - 1)) || 1e-6;
    st[f.key] = { mu, sd };
  }
  return st;
}
function fdist(a, b, st) {
  let s = 0, n = 0;
  for (const k in st) {
    if (a[k] == null || b[k] == null) continue;
    s += ((a[k] - b[k]) / st[k].sd) ** 2; n++;
  }
  return n >= 2 ? Math.sqrt(s / n) : null;
}

// ---------------------------------------------------------------- distributions
export function rows(atbats) {
  return atbats.filter(inPlay).map((ab) => {
    const p = abPull(ab);
    return { id: ab.id, hitterKey: ab.hitterKey, bats: ab.bats, pull: p, zone: zoneOf(p), side: sideOf(p), type: ab.outcome.type, dist: Math.hypot(ab.outcome.x, ab.outcome.y), f: ab.features || null, result: ab.outcome.result, createdAt: ab.createdAt || 0 };
  });
}

export function poolDist(R) {
  const c = [0, 0, 0, 0, 0];
  for (const r of R) c[r.zone]++;
  return norm(c.map((v, i) => v + 5 * PRIOR[i]));
}

export function hitterDist(R, key, pooled) {
  const mine = R.filter((r) => r.hitterKey === key);
  const c = [0, 0, 0, 0, 0];
  for (const r of mine) c[r.zone]++;
  const k = 4;
  return { dist: norm(c.map((v, i) => v + k * pooled[i])), n: mine.length };
}

export function typeDist(R, key) {
  const mine = key ? R.filter((r) => r.hitterKey === key) : R;
  const c = TYPES.map((t) => mine.filter((r) => r.type === t).length);
  return { dist: norm(c.map((v, i) => v + 2 * TYPE_PRIOR[i])), n: mine.filter((r) => TYPES.includes(r.type)).length, counts: c };
}

export function sides(dist5) {
  // split the gap wedges across the +-15 degree thirds (gap wedge 9-27 deg: one third pull-ward of 15)
  const pull = dist5[0] + dist5[1] * (12 / 18);
  const oppo = dist5[4] + dist5[3] * (12 / 18);
  return { pull, center: 1 - pull - oppo, oppo };
}

// Predict where a swing will go: the hitter's history, nudged by swings that looked like this one.
export function predict(atbats, hitterKey, features) {
  const R = rows(atbats);
  const pooled = poolDist(R);
  const h = hitterDist(R, hitterKey, pooled);
  let dist = h.dist, similar = 0, beta = 0, nearest = [];
  const st = featureStats(R);
  if (features && Object.keys(st).length >= 2 && R.length >= 6) {
    const c = [0, 0, 0, 0, 0];
    for (const r of R) {
      if (!r.f) continue;
      const d = fdist(features, r.f, st);
      if (d == null) continue;
      const w = Math.exp(-(d * d) / (2 * 0.8 * 0.8)) * (r.hitterKey === hitterKey ? 2 : 1);
      c[r.zone] += w; similar += w;
      nearest.push({ id: r.id, d, w });
    }
    if (similar > 0.3) {
      const knn = norm(c.map((v, i) => v + 1.5 * pooled[i]));
      beta = Math.min(0.6, similar / (similar + 3));
      dist = dist.map((v, i) => (1 - beta) * v + beta * knn[i]);
    }
    nearest.sort((a, b) => a.d - b.d); nearest = nearest.slice(0, 5);
  }
  const support = h.n + similar;
  const confidence = support >= 15 ? 'high' : support >= 5 ? 'medium' : 'low';
  const best = dist.indexOf(Math.max(...dist));
  return { dist, sides: sides(dist), best, nHitter: h.n, similar: Math.round(similar * 10) / 10, swingWeight: beta, confidence, types: typeDist(R, hitterKey).dist, nearest };
}

// Baseline guess for scoring the model: the hitter's most common wedge so far (center if none)
export function baselinePick(atbats, hitterKey) {
  const R = rows(atbats).filter((r) => r.hitterKey === hitterKey);
  if (!R.length) return 2;
  const c = [0, 0, 0, 0, 0]; for (const r of R) c[r.zone]++;
  return c.indexOf(Math.max(...c));
}

// How often the stored prediction (made before the result was tagged) named the right wedge / side
export function scorecard(atbats) {
  let n = 0, hit = 0, hitSide = 0, base = 0;
  for (const ab of atbats) {
    if (!inPlay(ab) || !ab.prediction || !Array.isArray(ab.prediction.dist)) continue;
    const p = abPull(ab), z = zoneOf(p);
    const pred = ab.prediction.dist;
    const pz = pred.indexOf(Math.max(...pred));
    const ps = sides(pred); const pside = Object.entries(ps).sort((a, b) => b[1] - a[1])[0][0];
    n++;
    if (pz === z) hit++;
    if (pside === sideOf(p)) hitSide++;
    if (ab.prediction.baseline === z) base++;
  }
  return { n, wedge: n ? hit / n : null, side: n ? hitSide / n : null, baseline: n ? base / n : null };
}

// ---------------------------------------------------------------- defense
// Standard spots for a 90-ft field, as [pull-neutral field angle deg, distance ft]
const SPOTS = { '1B': [33, 112], '2B': [13, 148], SS: [-13, 148], '3B': [-33, 116], LF: [-27, 290], CF: [0, 320], RF: [27, 290] };
export function defense(atbats, hitterKey, bats, field) {
  const R = rows(atbats).filter((r) => r.hitterKey === hitterKey);
  const scaleIn = field.basePath / 90, scaleOut = field.fence / 400;
  const mean = (a) => (a.length ? a.reduce((p, q) => p + q, 0) / a.length : 0);
  const gb = R.filter((r) => r.type === 'GB' || r.type === 'BU').map((r) => fieldAngle(r.pull, bats));
  const air = R.filter((r) => r.type === 'LD' || r.type === 'FB').map((r) => fieldAngle(r.pull, bats));
  const all = R.map((r) => fieldAngle(r.pull, bats));
  const enough = R.length >= 4;
  const shiftIn = enough ? Math.max(-14, Math.min(14, 0.6 * mean(gb.length >= 3 ? gb : all))) : 0;
  const shiftOut = enough ? Math.max(-15, Math.min(15, 0.7 * mean(air.length >= 3 ? air : all))) : 0;
  const airD = R.filter((r) => r.type === 'FB' || r.type === 'LD').map((r) => r.dist).sort((a, b) => a - b);
  const depth = enough && airD.length >= 3 ? Math.max(0.75, Math.min(1.1, airD[airD.length >> 1] / (0.8 * field.fence))) : 1;
  const out = {};
  for (const [pos, [a, d]] of Object.entries(SPOTS)) {
    const inf = d < 200;
    const ang = a + (inf ? shiftIn : shiftOut);
    const dd = inf ? d * scaleIn : d * scaleOut * depth;
    const base = { x: Math.sin(a * Math.PI / 180) * (inf ? d * scaleIn : d * scaleOut), y: Math.cos(a * Math.PI / 180) * (inf ? d * scaleIn : d * scaleOut) };
    out[pos] = { x: Math.sin(ang * Math.PI / 180) * dd, y: Math.cos(ang * Math.PI / 180) * dd, base };
  }
  return { spots: out, shiftIn, shiftOut, depth, n: R.length, enough };
}

export function describeShift(def, bats) {
  if (!def.enough) return 'Standard positions until there are at least 4 balls in play.';
  const side = (deg) => (Math.abs(deg) < 3 ? null : (deg < 0 ? 'toward third / left field' : 'toward first / right field'));
  const parts = [];
  const si = side(def.shiftIn), so = side(def.shiftOut);
  if (si) parts.push(`Shade the infield ${Math.round(Math.abs(def.shiftIn))}° ${si}`);
  if (so) parts.push(`swing the outfield ${Math.round(Math.abs(def.shiftOut))}° ${so}`);
  if (def.depth < 0.92) parts.push('bring the outfield in');
  if (def.depth > 1.04) parts.push('play the outfield deep');
  if (!parts.length) return 'Straight up: this hitter uses the whole field.';
  const s = parts.join(', ');
  return s.charAt(0).toUpperCase() + s.slice(1) + '.';
}

export function mean(arr) { const v = arr.filter((x) => Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }
