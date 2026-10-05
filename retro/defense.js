// GS Baseball Hub: Defense Drills. A retro 8-bit field that plays out where every fielder goes
// on a ball in play, plus a "Where do you go?" quiz. Standard youth positioning; coaches can teach
// it differently. Mounted by index.html (Instincts tab) with mount(root, hub) / unmount().

const W = 208, H = 178;
const HOME = [104, 164], B1 = [135, 133], B2 = [104, 102], B3 = [73, 133], MOUND = [104, 135];
const BASE = { H: HOME, 1: B1, 2: B2, 3: B3 };
const BASE_NAME = { H: 'home', 1: '1st', 2: '2nd', 3: '3rd' };
const START = { P: [104, 132], C: [104, 172], '1B': [139, 123], '2B': [123, 104], SS: [85, 104], '3B': [69, 123], LF: [50, 62], CF: [104, 40], RF: [158, 62] };
const ORDER = ['P', 'C', '1B', '2B', 'SS', '3B', 'LF', 'CF', 'RF'];
const POS_NAME = { P: 'pitcher', C: 'catcher', '1B': 'first baseman', '2B': 'second baseman', SS: 'shortstop', '3B': 'third baseman', LF: 'left fielder', CF: 'center fielder', RF: 'right fielder' };

export const HITS = [
  { k: 'S-LF', g: 'Base hits', l: 'Single to LF', short: 'Single to left', to: [56, 70], by: 'LF', type: 'single', side: 'L' },
  { k: 'S-CF', g: 'Base hits', l: 'Single to CF', short: 'Single to center', to: [104, 54], by: 'CF', type: 'single', side: 'C' },
  { k: 'S-RF', g: 'Base hits', l: 'Single to RF', short: 'Single to right', to: [152, 70], by: 'RF', type: 'single', side: 'R' },
  { k: 'D-LC', g: 'Doubles', l: 'Gap: left-center', short: 'Double to the left-center gap', to: [72, 26], by: 'LF', type: 'double', side: 'L' },
  { k: 'D-RC', g: 'Doubles', l: 'Gap: right-center', short: 'Double to the right-center gap', to: [136, 26], by: 'RF', type: 'double', side: 'R' },
  { k: 'G-3B', g: 'Grounders', l: 'To 3B', short: 'Grounder to third', to: [72, 121], by: '3B', type: 'grounder', side: 'L' },
  { k: 'G-SS', g: 'Grounders', l: 'To SS', short: 'Grounder to short', to: [89, 107], by: 'SS', type: 'grounder', side: 'L' },
  { k: 'G-2B', g: 'Grounders', l: 'To 2B', short: 'Grounder to second', to: [119, 107], by: '2B', type: 'grounder', side: 'R' },
  { k: 'G-1B', g: 'Grounders', l: 'To 1B', short: 'Grounder to first', to: [136, 121], by: '1B', type: 'grounder', side: 'R' },
  { k: 'BUNT', g: 'Bunts', l: 'Bunt (3B side)', short: 'Bunt down the third base line', to: [92, 150], by: '3B', type: 'bunt', side: 'L' }
];
export const RUNNERS = [['0', 'None'], ['1', '1st'], ['2', '2nd'], ['12', '1st & 2nd']];
const RUN_TEXT = { 0: 'bases empty', 1: 'runner on 1st', 2: 'runner on 2nd', 12: 'runners on 1st & 2nd' };

// ---------- the plays ----------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const len = (a) => Math.hypot(a[0], a[1]) || 1;
const unit = (a) => mul(a, 1 / len(a));
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const near = (k, p) => add(BASE[k], p || [0, 0]);
// Behind a base, away from where the throw comes from.
const backupOf = (k, from, d) => add(BASE[k], mul(unit(sub(BASE[k], from)), d || 15));
const behind = (spot, d) => add(spot, mul(unit(sub(spot, HOME)), d || 13));
const between = (from, k, t) => lerp(BASE[k], from, t);

export function buildPlay(hitKey, run) {
  const h = HITS.find((x) => x.k === hitKey);
  const F = h.to;
  const on1 = run === '1' || run === '12', on2 = run === '2' || run === '12';
  const J = {};
  const set = (pos, job, to) => { if (!J[pos]) J[pos] = { job, to: to.map((v) => Math.round(v * 10) / 10) }; };
  const throws = []; // [{ to: base key or pos spot, via }]
  let call = '';
  const otherMI = (p) => (p === 'SS' ? '2B' : 'SS');

  if (h.type === 'single' || h.type === 'double') {
    const target = h.type === 'single' ? (on2 ? 'H' : on1 ? '3' : '2') : (run === '0' ? '3' : 'H');
    set(h.by, `Field it, throw to ${target === 'H' ? 'the cutoff' : h.type === 'double' ? 'the relay' : target === '2' ? '2nd' : 'the cutoff'}`, F);
    let cut = null;
    if (h.type === 'double') {
      cut = h.side === 'L' ? 'SS' : '2B';
      const relaySpot = between(F, target === 'H' ? '3' : target, 0.55);
      set(cut, `Go out for the relay, throw to ${BASE_NAME[target]}`, relaySpot);
      set(otherMI(cut), 'Trail the relay (backup cut)', lerp(relaySpot, BASE[target === 'H' ? '3' : target], 0.3));
      if (target === 'H') {
        set('1B', 'Cutoff to home', between(BASE['3'], 'H', 0.35));
        set('3B', 'Cover 3rd', near('3', [-3, 0]));
        set('P', 'Back up home', backupOf('H', BASE['3'], 13));
      } else {
        set('3B', 'Cover 3rd', near('3', [-3, 0]));
        set('1B', 'Follow the batter, cover 2nd', near('2', [4, 2]));
        set('P', 'Back up 3rd', backupOf('3', relaySpot, 14));
      }
      set('C', 'Cover home', near('H', [0, 3]));
      const cfBack = h.by === 'LF' ? 'CF' : 'CF';
      set(cfBack, `Back up the ${h.by}`, behind(F, 12));
      const far = h.side === 'L' ? 'RF' : 'LF';
      set(far, far === 'RF' ? 'Back up 2nd' : 'Back up 3rd', far === 'RF' ? backupOf('2', relaySpot, 16) : add(BASE['3'], [-16, 8]));
      throws.push({ to: cut }, { to: target === 'H' ? '1B' : target }, ...(target === 'H' ? [{ to: 'H' }] : []));
      call = target === '3' ? 'Double: hit the relay, hold the batter at 2nd (throw to 3rd).' : 'Double: hit the relay, then the cutoff. Keep the run from scoring.';
    } else {
      // Singles
      if (target === '2') {
        cut = h.side === 'R' ? '2B' : 'SS';
        set(cut, 'Cutoff to 2nd', between(F, '2', 0.4));
        set(otherMI(cut), 'Cover 2nd', near('2', [0, 2]));
        set('1B', 'Watch the batter touch 1st, cover 1st', near('1', [2, 0]));
        set('3B', 'Cover 3rd', near('3', [-2, 0]));
        set('P', 'Back up 2nd', backupOf('2', F, 12));
        set('C', 'Trail the batter to 1st', add(BASE['1'], [8, 12]));
        throws.push({ to: cut }, { to: '2' });
        call = 'No one on: throw it to 2nd. Keep the batter at 1st.';
      } else if (target === '3') {
        cut = 'SS';
        set('SS', 'Cutoff to 3rd', between(F, '3', 0.38));
        set('3B', 'Cover 3rd', near('3', [-2, 0]));
        set('2B', 'Cover 2nd', near('2', [0, 2]));
        set('1B', 'Cover 1st', near('1', [2, 0]));
        set('P', 'Back up 3rd', backupOf('3', F, 15));
        set('C', 'Cover home', near('H', [0, 3]));
        throws.push({ to: 'SS' }, { to: '3' });
        call = 'Runner on 1st: throw to 3rd through the cutoff. Don’t let him go first to third.';
      } else {
        cut = h.side === 'L' ? '3B' : '1B';
        set(cut, 'Cutoff to home', between(F, 'H', 0.32));
        if (cut === '3B') { set('SS', 'Cover 3rd', near('3', [-2, 0])); set('2B', 'Cover 2nd', near('2', [0, 2])); set('1B', 'Cover 1st', near('1', [2, 0])); }
        else { set('3B', 'Cover 3rd', near('3', [-2, 0])); set('2B', 'Cover 1st', near('1', [3, -2])); set('SS', 'Cover 2nd', near('2', [0, 2])); }
        set('P', 'Back up home', backupOf('H', F, 13));
        set('C', 'Cover home, call the cut', near('H', [0, 3]));
        throws.push({ to: cut }, { to: 'H' });
        call = run === '12' ? 'Runners on 1st & 2nd: throw home through the cutoff. Cut it if the lead runner scores easy.' : 'Runner on 2nd: throw home through the cutoff.';
      }
    }
    for (const of of ['LF', 'CF', 'RF']) {
      if (J[of]) continue;
      if (h.by === 'CF') set(of, 'Back up the CF', behind(F, 10).map((v, i) => v + (i === 0 ? (of === 'LF' ? -8 : 8) : 0)));
      else if (of === 'CF') set('CF', `Back up the ${h.by}`, behind(F, 12));
      else if (of === 'RF') set('RF', target === 'H' ? 'Back up 2nd' : 'Back up 2nd', backupOf('2', F, 16));
      else set('LF', 'Back up 3rd', add(BASE['3'], [-16, 8]));
    }
  } else if (h.type === 'grounder') {
    const p = h.by;
    const cover2 = p === '3B' || p === 'SS' ? '2B' : 'SS';
    const cover1 = p === '1B' ? 'P' : '1B';
    let first = '1', second = null;
    if (run === '12' && p === '3B') { first = '3'; second = '1'; call = 'Force at 3rd: step on the bag, then throw to 1st.'; }
    else if (run === '12' && p === 'SS') { first = '3'; call = 'Force at 3rd: get the lead runner.'; }
    else if (on1) { first = '2'; second = '1'; call = 'Force at 2nd, then turn two.'; }
    else if (on2) call = 'Runner on 2nd: look him back, then throw to 1st.';
    else call = 'Bases empty: field it clean, throw to 1st.';
    const job = first === '3' && p === '3B' ? 'Field it, step on 3rd, throw to 1st'
      : first === '3' ? 'Field it, throw to 3rd' : first === '2' ? 'Field it, throw to 2nd' : on2 ? 'Field it, check the runner, throw to 1st'
      : p === '1B' ? 'Field it, flip to the pitcher' : 'Field it, throw to 1st';
    set(p, job, F);
    set(cover1, 'Cover 1st', near('1', cover1 === 'P' ? [2, 4] : [2, 0]));
    if (first === '2') set(cover2, 'Cover 2nd, turn two', near('2', [cover2 === 'SS' ? -2 : 2, 2]));
    else set(cover2, 'Cover 2nd', near('2', [cover2 === 'SS' ? -2 : 2, 2]));
    if (p !== '3B') set('3B', 'Cover 3rd', near('3', [-2, 0]));
    if (p === '3B' && !J.SS) set('SS', 'Cover 3rd', near('3', [3, -3]));
    if (!J.SS) set('SS', 'Cover 2nd', near('2', [-2, 2]));
    if (!J['2B']) set('2B', 'Back up 1st', add(BASE['1'], [-4, -10]));
    set('P', p === '1B' || p === '2B' ? 'Break to 1st' : 'Back up the throw to 1st', p === '1B' || p === '2B' ? near('1', [-6, 6]) : lerp(MOUND, BASE['1'], 0.45));
    set('C', run === '0' ? 'Back up 1st' : 'Cover home', run === '0' ? add(BASE['1'], [10, 14]) : near('H', [0, 3]));
    set('LF', 'Back up 3rd', add(BASE['3'], [-16, 8]));
    set('CF', 'Back up 2nd', add(BASE['2'], [0, -18]));
    set('RF', 'Back up 1st', add(BASE['1'], [16, 6]));
    throws.push({ to: first === '1' && cover1 === 'P' ? '1' : first });
    if (second) throws.push({ to: second });
  } else {
    // Bunt
    const holdThird = on2;
    const fielder = holdThird ? 'P' : '3B';
    const target = run === '12' ? '3' : '1';
    set(fielder, target === '3' ? 'Field it, throw to 3rd' : 'Field it, take the sure out at 1st', F);
    if (holdThird) set('3B', 'Stay at 3rd', near('3', [-2, 0]));
    else set('P', 'Charge the bunt', lerp(MOUND, F, 0.6));
    set('1B', 'Charge the bunt', lerp(START['1B'], [110, 152], 1));
    set('2B', 'Cover 1st', near('1', [2, -2]));
    set('SS', 'Cover 2nd', near('2', [-2, 2]));
    set('C', run === '0' || run === '1' ? 'Come out, call the throw' : 'Cover home', run === '0' || run === '1' ? lerp(HOME, F, 0.35) : near('H', [0, 3]));
    set('LF', 'Back up 3rd', add(BASE['3'], [-16, 8]));
    set('CF', 'Back up 2nd', add(BASE['2'], [0, -18]));
    set('RF', 'Back up 1st', add(BASE['1'], [16, 6]));
    throws.push({ to: target });
    call = target === '3' ? 'Bunt, runners on 1st & 2nd: 3B stays home. Force at 3rd if you have it.' : holdThird ? 'Bunt, runner on 2nd: 3B stays at 3rd, pitcher fields it. Sure out at 1st.' : 'Bunt: everyone charges, take the sure out at 1st.';
  }
  for (const p of ORDER) if (!J[p]) J[p] = { job: 'Hold your spot', to: START[p] };

  const runners = [{ who: 'B', from: 'H', to: h.type === 'double' ? '2' : '1' }];
  if (on1) runners.push({ who: 'R1', from: '1', to: h.type === 'double' ? '3' : '2' });
  if (on2) runners.push({ who: 'R2', from: '2', to: h.type === 'grounder' || h.type === 'bunt' ? '2' : h.type === 'single' && !on2 ? '3' : 'H' });
  return { hit: h, run, J, throws, call, runners, title: `${h.short}, ${RUN_TEXT[run]}` };
}

// ---------- timeline ----------
const PATH = ['H', '1', '2', '3', 'H'];
function runnerPath(from, to) {
  const out = [BASE[from]];
  let i = PATH.indexOf(from);
  if (from === 'H') i = 0;
  if (to === from) return out;
  for (let k = 0; k < 4; k++) { i++; out.push(BASE[PATH[i]]); if (PATH[i] === to) break; }
  return out;
}
function along(pts, d) {
  for (let i = 1; i < pts.length; i++) {
    const L = len(sub(pts[i], pts[i - 1]));
    if (d <= L) return lerp(pts[i - 1], pts[i], d / L);
    d -= L;
  }
  return pts[pts.length - 1];
}
function pathLen(pts) { let s = 0; for (let i = 1; i < pts.length; i++) s += len(sub(pts[i], pts[i - 1])); return s; }

function timeline(P) {
  const RUN = 30, THROW = 110;
  const ballSpeed = P.hit.type === 'bunt' ? 45 : P.hit.type === 'grounder' ? 75 : 85;
  const contact = 0.6;
  const field = P.hit.to;
  const tBall = contact + len(sub(field, HOME)) / ballSpeed;
  const moves = {};
  for (const p of ORDER) {
    const d = len(sub(P.J[p].to, START[p]));
    moves[p] = { from: START[p], to: P.J[p].to, t0: contact + 0.12, t1: contact + 0.12 + d / RUN };
  }
  const fielder = ORDER.find((p) => P.J[p].to[0] === field[0] && P.J[p].to[1] === field[1]) || P.hit.by;
  let t = Math.max(tBall, moves[fielder].t1) + 0.35;
  const segs = [{ kind: 'hit', from: HOME, to: field, t0: contact, t1: tBall, arc: P.hit.type === 'single' || P.hit.type === 'double' }];
  let at = field;
  let catchAt = t;
  for (const th of P.throws) {
    const dest = BASE[th.to] ? (P.J[ORDER.find((p) => P.J[p].job.startsWith('Cover ' + BASE_NAME[th.to]))] || {}).to || BASE[th.to] : P.J[th.to].to;
    const target = th.to === '3' && P.hit.k === 'G-3B' && P.run === '12' ? BASE['3'] : dest;
    const dist = len(sub(target, at));
    if (dist < 4) { at = target; t += 0.3; continue; }
    const t1 = t + dist / THROW;
    segs.push({ kind: 'throw', from: at, to: target, t0: t, t1 });
    at = target; t = t1 + 0.25;
  }
  const runs = P.runners.map((r) => {
    const pts = runnerPath(r.from, r.to);
    const t0 = r.who === 'B' ? contact + 0.25 : contact + 0.1;
    return { who: r.who, pts, t0, t1: t0 + pathLen(pts) / (RUN * 0.95) };
  });
  const end = Math.max(t, ...runs.map((r) => r.t1), ...Object.values(moves).map((m) => m.t1)) + 0.8;
  return { segs, moves, runs, contact, end, fielder, catchAt };
}

// ---------- drawing ----------
const PAL = {
  bg: '#0b1530', stands: '#14224a', crowdA: '#1f3270', crowdB: '#2a4590', grassA: '#2f8f3a', grassB: '#277a31', dirt: '#b9784a', dirtD: '#9a6038', chalk: '#f4f1e6',
  wall: '#0d3b1a', team: '#7fb0e6', teamD: '#245fa8', skin: '#e0ac7c', run: '#f2c94c', runD: '#a8761b', ball: '#ffffff', you: '#f2c94c', line: '#ffe27a', label: '#ffffff', shadow: 'rgba(0,0,0,.35)'
};
// 3x5 bitmap font for labels.
const GLYPH = {
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', B: '110101110101110', C: '111100100100111', F: '111100110100100',
  H: '101101111101101', L: '100100100100111', P: '111101111100100', R: '110101110101101', S: '111100111001111', Y: '101101010010010', O: '111101101101111', U: '101101101101111', '!': '010010010000010'
};
function text(ctx, s, x, y, color) {
  ctx.fillStyle = color;
  let cx = Math.round(x - (s.length * 4 - 1) / 2);
  for (const ch of s) {
    const g = GLYPH[ch];
    if (g) for (let i = 0; i < 15; i++) if (g[i] === '1') ctx.fillRect(cx + (i % 3), Math.round(y) + Math.floor(i / 3), 1, 1);
    cx += 4;
  }
}
function px(ctx, x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), w, h); }

let fieldCache = null;
function drawField() {
  if (fieldCache) return fieldCache;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = PAL.bg; g.fillRect(0, 0, W, H);
  // stands and crowd
  for (let y = 0; y < 22; y += 3) for (let x = 0; x < W; x += 3) px(g, x, y, 2, 2, ((x * 7 + y * 13) % 5 === 0) ? '#f2c94c' : ((x + y) % 2 ? PAL.crowdA : PAL.crowdB));
  // foul-territory grass below the stands
  g.fillStyle = '#1f6a2a'; g.fillRect(0, 22, W, H - 22);
  // grass with mow stripes, clipped to the fan
  g.save();
  g.beginPath(); g.moveTo(HOME[0], HOME[1]);
  g.arc(HOME[0], HOME[1], 150, Math.PI * 1.25, Math.PI * 1.75); g.closePath(); g.clip();
  for (let i = -20; i < 40; i++) { g.fillStyle = i % 2 ? PAL.grassA : PAL.grassB; g.beginPath(); g.moveTo(i * 10, 0); g.lineTo(i * 10 + 10, 0); g.lineTo(i * 10 + 10 - 180, H); g.lineTo(i * 10 - 180, H); g.fill(); }
  g.restore();
  // warning track and wall
  g.strokeStyle = PAL.dirtD; g.lineWidth = 4; g.beginPath(); g.arc(HOME[0], HOME[1], 146, Math.PI * 1.25, Math.PI * 1.75); g.stroke();
  g.strokeStyle = PAL.wall; g.lineWidth = 3; g.beginPath(); g.arc(HOME[0], HOME[1], 150, Math.PI * 1.25, Math.PI * 1.75); g.stroke();
  // infield dirt arc
  g.fillStyle = PAL.dirt; g.beginPath(); g.moveTo(HOME[0], HOME[1]); g.arc(HOME[0], HOME[1], 66, Math.PI * 1.25, Math.PI * 1.75); g.closePath(); g.fill();
  // infield grass
  g.fillStyle = PAL.grassA; g.beginPath(); g.moveTo(104, 156); g.lineTo(128, 133); g.lineTo(104, 109); g.lineTo(80, 133); g.closePath(); g.fill();
  // base paths
  g.strokeStyle = PAL.dirt; g.lineWidth = 3; g.beginPath(); g.moveTo(...HOME); g.lineTo(...B1); g.lineTo(...B2); g.lineTo(...B3); g.closePath(); g.stroke();
  // mound, home circle
  g.fillStyle = PAL.dirt; g.beginPath(); g.arc(MOUND[0], MOUND[1], 5, 0, 7); g.fill(); px(g, MOUND[0] - 1, MOUND[1] - 1, 3, 1, PAL.chalk);
  g.beginPath(); g.arc(HOME[0], HOME[1], 7, 0, 7); g.fill();
  // foul lines
  g.strokeStyle = PAL.chalk; g.lineWidth = 1;
  g.beginPath(); g.moveTo(HOME[0] + 0.5, HOME[1]); g.lineTo(HOME[0] - 106, HOME[1] - 106); g.moveTo(HOME[0] + 0.5, HOME[1]); g.lineTo(HOME[0] + 107, HOME[1] - 106); g.stroke();
  for (const b of [B1, B2, B3]) { px(g, b[0] - 2, b[1] - 2, 4, 4, PAL.chalk); }
  px(g, HOME[0] - 2, HOME[1] - 1, 5, 3, PAL.chalk);
  // lights
  for (const x of [6, W - 14]) { px(g, x, 2, 8, 5, '#dfe9ff'); px(g, x + 3, 7, 2, 14, '#6d7a99'); }
  fieldCache = c;
  return c;
}
function sprite(ctx, x, y, team, you, t, moving) {
  x = Math.round(x); y = Math.round(y);
  const leg = moving ? (Math.floor(t * 8) % 2) : 0;
  px(ctx, x - 2, y + 3, 5, 1, PAL.shadow);
  const shirt = team ? '#ffffff' : PAL.run, trim = team ? PAL.teamD : PAL.runD;
  px(ctx, x - 1, y - 6, 3, 1, team ? PAL.teamD : PAL.runD); // cap
  px(ctx, x - 1, y - 5, 3, 2, PAL.skin);
  px(ctx, x - 2, y - 3, 5, 3, shirt); px(ctx, x - 2, y - 3, 5, 1, trim);
  px(ctx, x - 1 - leg, y, 1, 3, trim); px(ctx, x + 1 + leg, y, 1, 3, trim);
  if (you) { px(ctx, x - 4, y - 8, 9, 1, PAL.you); px(ctx, x - 4, y + 4, 9, 1, PAL.you); px(ctx, x - 4, y - 8, 1, 13, PAL.you); px(ctx, x + 4, y - 8, 1, 13, PAL.you); }
}

function stateAt(TL, t) {
  const pos = {};
  for (const p of ORDER) {
    const m = TL.moves[p];
    const k = t <= m.t0 ? 0 : t >= m.t1 ? 1 : (t - m.t0) / (m.t1 - m.t0);
    pos[p] = { at: lerp(m.from, m.to, k), moving: k > 0 && k < 1 };
  }
  let ball = null, high = 0;
  if (t < TL.contact) ball = lerp(MOUND, HOME, Math.min(1, t / TL.contact));
  for (const s of TL.segs) {
    if (t >= s.t0) {
      const k = Math.min(1, (t - s.t0) / (s.t1 - s.t0));
      ball = lerp(s.from, s.to, k);
      high = s.arc ? Math.sin(Math.PI * k) * 14 : s.kind === 'throw' ? Math.sin(Math.PI * k) * 3 : 0;
    }
  }
  // the fielder carries the ball between catching and throwing
  const runners = TL.runs.map((r) => {
    const k = t <= r.t0 ? 0 : t >= r.t1 ? 1 : (t - r.t0) / (r.t1 - r.t0);
    return { at: along(r.pts, k * pathLen(r.pts)), moving: k > 0 && k < 1 };
  });
  return { pos, ball, high, runners };
}

function draw(ctx, P, TL, t, o) {
  ctx.drawImage(drawField(), 0, 0);
  const S = stateAt(TL, t);
  if (o.lines) {
    ctx.fillStyle = PAL.line;
    for (const p of ORDER) {
      const m = TL.moves[p], d = len(sub(m.to, m.from));
      if (d < 3) continue;
      for (let i = 0; i < d; i += 3) { const q = lerp(m.from, m.to, i / d); ctx.fillRect(Math.round(q[0]), Math.round(q[1]), 1, 1); }
      ctx.fillRect(Math.round(m.to[0]) - 1, Math.round(m.to[1]), 3, 1); ctx.fillRect(Math.round(m.to[0]), Math.round(m.to[1]) - 1, 1, 3);
    }
  }
  const people = ORDER.map((p) => ({ y: S.pos[p].at[1], f: () => sprite(ctx, S.pos[p].at[0], S.pos[p].at[1], true, o.you === p, t, S.pos[p].moving) }));
  S.runners.forEach((r) => people.push({ y: r.at[1], f: () => sprite(ctx, r.at[0], r.at[1], false, false, t, r.moving) }));
  people.sort((a, b) => a.y - b.y).forEach((x) => x.f());
  if (o.labels) for (const p of ORDER) { const a = S.pos[p].at; text(ctx, o.you === p ? 'YOU' : p, a[0], a[1] - 14, o.you === p ? PAL.you : PAL.label); }
  if (o.target) { const [x, y] = o.target.map(Math.round); ctx.fillStyle = PAL.you; for (let i = -2; i <= 2; i++) { ctx.fillRect(x + i, y + i, 1, 1); ctx.fillRect(x + i, y - i, 1, 1); } }
  if (S.ball) {
    const b = S.ball;
    if (S.high > 1) px(ctx, b[0] - 1, b[1] + 1, 3, 1, PAL.shadow);
    px(ctx, b[0] - 1, b[1] - 1 - S.high, 2, 2, PAL.ball);
  }
}

// ---------- sound ----------
let AC = null;
function beep(freq, dur, type, slide) {
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type || 'square'; o.frequency.value = freq;
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, AC.currentTime + dur);
    g.gain.value = 0.06; g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + dur);
    o.connect(g); g.connect(AC.destination); o.start(); o.stop(AC.currentTime + dur);
  } catch (e) { /* no audio */ }
}

// ---------- page ----------
const CSS = `
.dd{--dd-bg:#0b1530;--dd-panel:#12224a;--dd-line:#2c4c80;--dd-ink:#e7eef9;--dd-dim:#9fb3d6;--dd-gold:#f2c94c;--dd-blue:#7fb0e6;font-family:'Press Start 2P',ui-monospace,Menlo,monospace;color:var(--dd-ink);background:var(--dd-bg);border-radius:12px;padding:14px 12px 16px;display:flex;flex-direction:column;gap:12px;margin:-4px -4px 0}
.dd *{box-sizing:border-box}
.dd .t{font-size:9px;line-height:1.6;color:var(--dd-dim);letter-spacing:.02em}
.dd h2{margin:0;font-size:16px;line-height:1.3;color:#fff;font-weight:400}
.dd h2 span{color:var(--dd-gold)}
.dd .kick{font-size:8px;color:var(--dd-gold);letter-spacing:.06em}
.dd .preview{font-size:8px;line-height:1.6;color:#0b1530;background:var(--dd-gold);padding:6px 8px;border-radius:4px}
.dd .row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.dd button{font:inherit;font-size:9px;line-height:1.3;color:var(--dd-ink);background:#0b1530;border:2px solid var(--dd-line);border-radius:2px;padding:9px 9px;min-height:40px;cursor:pointer;text-transform:uppercase;letter-spacing:.02em}
.dd button[aria-pressed="true"]{background:var(--dd-gold);color:#0b1530;border-color:var(--dd-gold)}
.dd button.blue[aria-pressed="true"]{background:var(--dd-blue);border-color:var(--dd-blue)}
.dd button:disabled{opacity:.4}
.dd .back{border:0;background:none;color:var(--dd-blue);padding:6px 0;min-height:36px}
.dd .tabs{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.dd .tabs button{font-size:11px;min-height:44px}
.dd .panel{background:var(--dd-panel);border:2px solid var(--dd-line);border-radius:4px;padding:10px}
.dd .lbl{font-size:8px;color:var(--dd-gold);margin:0 0 6px;letter-spacing:.06em}
.dd .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
.dd .grid button{text-align:left;min-height:44px}
.dd .screen{border:3px solid #2c4c80;border-radius:4px;background:#000;padding:0;position:relative;line-height:0}
.dd canvas{width:100%;height:auto;image-rendering:pixelated;image-rendering:crisp-edges;display:block}
.dd .time{width:100%;accent-color:var(--dd-gold);margin:0}
.dd .callbox{border:2px solid var(--dd-gold);background:#000;padding:10px;font-size:9px;line-height:1.7;color:#fff}
.dd .callbox b{color:var(--dd-gold);font-weight:400}
.dd .jobs{display:grid;grid-template-columns:auto 1fr;gap:6px 10px;font-size:8px;line-height:1.6}
.dd .jobs .p{color:var(--dd-gold)}
.dd .jobs .me{color:#0b1530;background:var(--dd-gold);padding:0 4px}
.dd .score{display:flex;justify-content:space-between;font-size:8px;color:var(--dd-dim);gap:8px}
.dd .score b{color:#fff;font-weight:400}
.dd .q{font-size:11px;line-height:1.6;color:#fff;margin:0}
.dd .choices{display:flex;flex-direction:column;gap:6px}
.dd .choices button{text-align:left;font-size:9px;line-height:1.5;min-height:46px;text-transform:none}
.dd .choices button.right{background:#1f7a3a;border-color:#3dbe7c;color:#fff;opacity:1}
.dd .choices button.wrong{background:#7a1f1f;border-color:#f06a5c;color:#fff;opacity:1}
.dd .fb{font-size:9px;line-height:1.7}
.dd .fb.ok b{color:#3dbe7c;font-weight:400}.dd .fb.no b{color:#f06a5c;font-weight:400}
.dd .stars{font-size:28px;letter-spacing:6px;color:var(--dd-gold);text-align:center}
.dd .big{font-size:24px;text-align:center;color:#fff}
.dd .note{font-size:8px;line-height:1.6;color:var(--dd-dim)}
@media (min-width:560px){.dd .grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
`;
const BEST = 'gs-dd-best';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

let S = null;
export function mount(root, hub) {
  if (!document.getElementById('dd-css')) { const st = document.createElement('style'); st.id = 'dd-css'; st.textContent = CSS; document.head.appendChild(st); }
  S = { root, hub, mode: 'watch', hit: 'G-SS', run: '1', play: null, tl: null, t: 0, playing: false, speed: 1, labels: true, lines: true, sound: false, raf: 0, last: 0, quiz: null, sounded: {} };
  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  load();
  paint();
  start();
}
export function unmount() {
  if (!S) return;
  cancelAnimationFrame(S.raf);
  S.root.removeEventListener('click', onClick);
  S.root.removeEventListener('input', onInput);
  S = null;
}
export function update() { /* nothing from the Hub changes this page */ }

function load(you) {
  S.play = buildPlay(S.hit, S.run);
  S.tl = timeline(S.play);
  S.t = 0; S.sounded = {};
  S.you = you || null;
}
function start() { S.playing = true; S.last = performance.now(); loop(); }
function loop() {
  cancelAnimationFrame(S.raf);
  S.raf = requestAnimationFrame((now) => {
    if (!S) return;
    const dt = Math.min(0.1, (now - S.last) / 1000); S.last = now;
    if (S.playing) {
      S.t = Math.min(S.tl.end, S.t + dt * S.speed);
      if (S.sound) sounds();
      if (S.t >= S.tl.end) { S.playing = false; syncControls(); }
    }
    frame();
    if (S.playing) loop();
  });
}
function sounds() {
  const T = S.tl, t = S.t, s = S.sounded;
  if (!s.crack && t >= T.contact) { s.crack = 1; beep(1200, 0.12, 'square', 200); }
  T.segs.forEach((g, i) => { if (!s['c' + i] && t >= g.t1) { s['c' + i] = 1; beep(i === T.segs.length - 1 ? 660 : 440, 0.08, 'square'); } });
  if (!s.end && t >= T.end - 0.5) { s.end = 1; beep(523, 0.08); setTimeout(() => beep(784, 0.12), 90); }
}
function frame() {
  const cv = S.root.querySelector('canvas');
  if (!cv) return;
  draw(cv.getContext('2d'), S.play, S.tl, S.t, { labels: S.labels, lines: S.lines && (S.mode === 'watch' || (S.quiz && S.quiz.picked != null)), you: S.you, target: S.mode === 'quiz' && S.quiz && S.quiz.picked == null ? S.play.hit.to : null });
  const r = S.root.querySelector('.time');
  if (r && document.activeElement !== r) r.value = String(Math.round((S.t / S.tl.end) * 1000));
}
function syncControls() {
  const b = S.root.querySelector('[data-dd="play"]');
  if (b) b.textContent = S.playing ? '❚❚ Pause' : S.t >= S.tl.end ? '↻ Replay' : '▶ Play';
}

function controlsHTML() {
  return `<div class="row"><button data-dd="play">${S.playing ? '❚❚ Pause' : '▶ Play'}</button><button data-dd="replay">↺ Replay</button><button data-dd="speed" class="blue" aria-pressed="${S.speed < 1}">½ Speed</button></div>
    <div class="row"><button data-dd="labels" class="blue" aria-pressed="${S.labels}">Labels</button><button data-dd="lines" class="blue" aria-pressed="${S.lines}">Lines</button><button data-dd="sound" class="blue" aria-pressed="${S.sound}">Sound</button></div>
    <input class="time" type="range" min="0" max="1000" value="0" aria-label="Time">`;
}
function jobsHTML(P, you) {
  return `<div class="jobs">${ORDER.map((p) => `<span class="p">${p}</span><span${p === you ? ' class="me"' : ''}>${esc(P.J[p].job)}</span>`).join('')}</div>`;
}
function paint() {
  const team = esc((S.hub && S.hub.teamName) || 'GS Baseball');
  let h = `<div class="dd"><div class="row" style="justify-content:space-between"><button class="back" data-dd="back">‹ Instincts</button><span class="kick">${team}</span></div>
    <div><h2>DEFENSE <span>DRILLS</span></h2><p class="t" style="margin:6px 0 0">Watch where all nine go on every ball in play. Then quiz yourself.</p></div>
    <div class="preview">PREVIEW · ONLY YOU CAN SEE THIS</div>
    <div class="tabs"><button data-dd="mode" data-v="watch" aria-pressed="${S.mode === 'watch'}">Watch</button><button data-dd="mode" data-v="quiz" aria-pressed="${S.mode === 'quiz'}">Quiz</button></div>`;
  if (S.mode === 'watch') {
    const P = S.play;
    h += `<div class="screen"><canvas width="${W}" height="${H}"></canvas></div>${controlsHTML()}
      <div class="callbox"><b>THE CALL:</b> ${esc(P.call)}</div>
      <div class="panel"><p class="lbl">BALL IN PLAY</p>${['Grounders', 'Base hits', 'Doubles', 'Bunts'].map((g) => `<p class="note" style="margin:8px 0 4px">${g.toUpperCase()}</p><div class="grid">${HITS.filter((x) => x.g === g).map((x) => `<button data-dd="hit" data-v="${x.k}" aria-pressed="${S.hit === x.k}">${esc(x.l)}</button>`).join('')}</div>`).join('')}</div>
      <div class="panel"><p class="lbl">RUNNERS</p><div class="grid">${RUNNERS.map(([k, l]) => `<button data-dd="run" data-v="${k}" aria-pressed="${S.run === k}">${l}</button>`).join('')}</div></div>
      <div class="panel"><p class="lbl">EVERYONE’S JOB · ${esc(P.title.toUpperCase())}</p>${jobsHTML(P)}</div>
      <p class="note">Standard youth positioning. Your coach may teach some plays differently.</p>`;
  } else h += quizHTML();
  S.root.innerHTML = h + '</div>';
  frame(); syncControls();
}

// ---------- quiz ----------
const QN = 10;
function bestScore() { try { return Number(localStorage.getItem(BEST)) || 0; } catch (e) { return 0; } }
function newQuiz() {
  const qs = [];
  const seen = new Set();
  let guard = 0;
  while (qs.length < QN && guard++ < 500) {
    const hit = HITS[Math.floor(Math.random() * HITS.length)].k;
    const run = RUNNERS[Math.floor(Math.random() * RUNNERS.length)][0];
    const P = buildPlay(hit, run);
    const counts = {};
    ORDER.forEach((p) => { counts[P.J[p].job] = (counts[P.J[p].job] || 0) + 1; });
    const cands = ORDER.filter((p) => counts[P.J[p].job] === 1 && P.J[p].job !== 'Hold your spot');
    if (!cands.length) continue;
    const you = cands[Math.floor(Math.random() * cands.length)];
    const key = hit + run + you;
    if (seen.has(key)) continue;
    seen.add(key);
    const wrong = shuffle([...new Set(ORDER.filter((p) => p !== you).map((p) => P.J[p].job))].filter((j) => j !== P.J[you].job)).slice(0, 3);
    qs.push({ hit, run, you, choices: shuffle([P.J[you].job, ...wrong]), answer: P.J[you].job });
  }
  return { qs, i: 0, score: 0, streak: 0, picked: null };
}
function quizLoad() {
  const Q = S.quiz, q = Q.qs[Q.i];
  S.hit = q.hit; S.run = q.run;
  load(q.you);
  S.playing = false; S.t = S.tl.contact + 0.05;
}
function quizHTML() {
  if (!S.quiz) {
    const b = bestScore();
    return `<div class="panel" style="display:flex;flex-direction:column;gap:12px"><p class="q">WHERE DO YOU GO?</p><p class="t" style="margin:0">${QN} plays. You get a position and a situation. Pick your job before the ball gets there.</p>${b ? `<p class="note" style="margin:0">BEST: ${b} / ${QN}</p>` : ''}<button data-dd="qstart" aria-pressed="true" style="min-height:52px;font-size:12px">▶ Start</button></div>`;
  }
  const Q = S.quiz;
  if (Q.i >= Q.qs.length) {
    const stars = Q.score >= 9 ? 3 : Q.score >= 7 ? 2 : Q.score >= 4 ? 1 : 0;
    return `<div class="panel" style="display:flex;flex-direction:column;gap:14px;align-items:stretch"><p class="q" style="text-align:center">GAME OVER</p><div class="big">${Q.score} / ${QN}</div><div class="stars">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</div><p class="t" style="text-align:center;margin:0">${stars === 3 ? 'ALL-STAR GLOVE!' : stars === 2 ? 'NICE WORK. ONE MORE TRY FOR 3 STARS?' : 'KEEP PRACTICING. WATCH MODE SHOWS EVERY PLAY.'}</p><button data-dd="qstart" aria-pressed="true" style="min-height:50px">↻ Play again</button></div>`;
  }
  const q = Q.qs[Q.i], P = S.play, done = Q.picked != null;
  let h = `<div class="score"><span>PLAY <b>${Q.i + 1}/${QN}</b></span><span>SCORE <b>${Q.score}</b></span><span>STREAK <b>${Q.streak}</b></span></div>
    <div class="screen"><canvas width="${W}" height="${H}"></canvas></div>
    <div class="callbox"><b>${esc(P.hit.short.toUpperCase())}</b><br>${esc(RUN_TEXT[q.run].toUpperCase())}. YOU’RE THE <b>${esc(POS_NAME[q.you].toUpperCase())}</b>.</div>
    <p class="q">WHERE DO YOU GO?</p>
    <div class="choices">${q.choices.map((c, i) => `<button data-dd="pick" data-i="${i}" ${done ? 'disabled' : ''} class="${!done ? '' : c === q.answer ? 'right' : i === Q.picked ? 'wrong' : ''}">${esc(c)}</button>`).join('')}</div>`;
  if (done) {
    const ok = q.choices[Q.picked] === q.answer;
    h += `<div class="fb ${ok ? 'ok' : 'no'}"><b>${ok ? ['NICE!', 'HEADS-UP PLAY!', 'YOU GOT IT!', 'ALL-STAR!'][Q.i % 4] : 'NOT QUITE.'}</b> ${ok ? '' : 'Your job: ' + esc(q.answer) + '. '}${esc(P.call)}</div>
      ${controlsHTML()}<div class="panel"><p class="lbl">EVERYONE’S JOB</p>${jobsHTML(P, q.you)}</div>
      <button data-dd="qnext" aria-pressed="true" style="min-height:50px">${Q.i + 1 < QN ? 'Next play ›' : 'See score ›'}</button>`;
  }
  return h;
}

function onInput(e) {
  if (!e.target.classList.contains('time')) return;
  S.t = (Number(e.target.value) / 1000) * S.tl.end;
  S.playing = false; syncControls(); frame();
}
function onClick(e) {
  const b = e.target.closest('[data-dd]');
  if (!b || !S) return;
  const a = b.dataset.dd, v = b.dataset.v;
  if (a === 'back') { S.hub && S.hub.back(); return; }
  if (a === 'mode') { S.mode = v; if (v === 'watch') { load(); paint(); start(); } else { S.quiz = null; S.playing = false; paint(); } return; }
  if (a === 'hit' || a === 'run') { S[a] = v; load(); paint(); start(); return; }
  if (a === 'play') { if (S.t >= S.tl.end) S.t = 0, S.sounded = {}; if (S.playing) S.playing = false; else start(); syncControls(); return; }
  if (a === 'replay') { S.t = 0; S.sounded = {}; start(); syncControls(); return; }
  if (a === 'speed') { S.speed = S.speed < 1 ? 1 : 0.5; b.setAttribute('aria-pressed', String(S.speed < 1)); return; }
  if (a === 'labels' || a === 'lines' || a === 'sound') { S[a] = !S[a]; b.setAttribute('aria-pressed', String(S[a])); if (a === 'sound' && S.sound) beep(880, 0.06); frame(); return; }
  if (a === 'qstart') { S.quiz = newQuiz(); quizLoad(); paint(); return; }
  if (a === 'pick') {
    const Q = S.quiz; if (Q.picked != null) return;
    Q.picked = Number(b.dataset.i);
    const q = Q.qs[Q.i];
    if (q.choices[Q.picked] === q.answer) { Q.score++; Q.streak++; if (S.sound) { beep(660, 0.07); setTimeout(() => beep(990, 0.1), 80); } }
    else { Q.streak = 0; if (S.sound) beep(160, 0.25, 'square', 90); }
    S.t = 0; S.sounded = {}; paint(); start();
    return;
  }
  if (a === 'qnext') {
    const Q = S.quiz; Q.i++; Q.picked = null;
    if (Q.i >= Q.qs.length) { try { if (Q.score > bestScore()) localStorage.setItem(BEST, String(Q.score)); } catch (err) { /* per-device */ } S.playing = false; paint(); }
    else { quizLoad(); paint(); }
    S.root.scrollIntoView({ block: 'start' });
  }
}
