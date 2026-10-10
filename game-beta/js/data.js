// Team data, player cards, and saved stats (stored on the device).
export const GS_ROSTER = [
  ['1', 'MJ Eubanks', '2B'], ['2', 'Mason Meharg', 'C'], ['3', 'Liam Harris', 'LF'], ['4', 'Cas Hortman', 'CF'],
  ['5', 'Landon Wilson', 'RF'], ['6', 'ColtonLee Crosby', '1B'], ['7', 'Wyatt Kell', 'SS'], ['13', 'Cash Pitts', '3B'],
  ['14', 'Wes Renfroe', 'RF'], ['18', 'Maverick Roland', 'CF'], ['27', 'Kade Wilson', 'LF'], ['31', 'SJ Fairchild', 'P'],
].map(([num, name, pos]) => ({ id: 'gs' + num, num, name, pos, gs: true }));

export const RIVALS = [
  ['8', 'Tyler Brooks', 'CF'], ['12', 'Jace Alvarez', 'SS'], ['22', 'Drew Carter', '1B'], ['44', 'Mateo Ramos', '3B'],
  ['9', 'Ryan Sanders', 'C'], ['17', 'Kobe Price', 'LF'], ['3', 'Brady Foster', '2B'], ['25', 'Nico Patel', 'RF'], ['21', 'Hunter Lane', 'P'],
].map(([num, name, pos], i) => ({ id: 'rv' + num, num, name, pos, gs: false, bats: i % 3 === 1 ? 'L' : 'R', throws: 'R', skin: ['#f1c7a5', '#c68a5e', '#e0b08a', '#8d5a3b', '#f3cfb3', '#a8714a'][i % 6], hair: ['#2b1d12', '#6b4a2b', '#c99a4b', '#1a1a1a'][i % 4] }));

export const POSITIONS = ['P', 'C', '1B', '2B', 'SS', '3B', 'LF', 'CF', 'RF'];
export const POS_NAMES = { P: 'Pitcher', C: 'Catcher', '1B': 'First Base', '2B': 'Second Base', SS: 'Shortstop', '3B': 'Third Base', LF: 'Left Field', CF: 'Center Field', RF: 'Right Field' };

export const TEAMS = {
  GS: { key: 'GS', name: 'GS Baseball', abbr: 'GS', jersey: '#0b2b53', trim: '#70bdf5', letter: '#ffffff', outline: '#70bdf5', pants: '#e9e9e4', sock: '#0b2b53', cap: '#0b2b53', helmet: '#0b2b53', belt: '#0b2b53', ui: '#70bdf5' },
  RIV: { key: 'RIV', name: 'Rivals', abbr: 'RIV', jersey: '#ece7dc', trim: '#7e2536', letter: '#7e2536', outline: '#2a0d14', pants: '#9d9d97', sock: '#7e2536', cap: '#7e2536', helmet: '#7e2536', belt: '#222222', ui: '#d0546b' },
};

export const SKINS = ['#f3cfb3', '#e0b08a', '#c68a5e', '#a8714a', '#7a4b2a', '#5a3620'];
export const HAIRS = ['#1a1a1a', '#3b2616', '#6b4a2b', '#a8743d', '#d9b46a', '#9c3d1e'];

const KEY = 'gsbaseball.v3';
const blank = () => ({ me: null, cards: {}, stats: {}, derby: {}, settings: { difficulty: 0, innings: 3, gsHome: false, sound: true, music: true, announcer: true, zone: true, baserun: 'manual' } });
let mem = null;
export function load() {
  if (mem) return mem;
  try { mem = Object.assign(blank(), JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { mem = blank(); }
  mem.settings = Object.assign(blank().settings, mem.settings || {});
  return mem;
}
export function save() { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch { } }

export function card(id) {
  const s = load();
  const base = GS_ROSTER.find(p => p.id === id);
  const c = s.cards[id] || {};
  const songs = ['bring-that-sting', 'built-different', 'buzzin', 'one-shot'];
  const idx = Math.max(0, GS_ROSTER.findIndex(p => p.id === id));
  return { bats: (base && base.bats) || 'R', throws: (base && base.throws) || 'R', skin: SKINS[1], hair: HAIRS[2], pos: base ? base.pos : 'CF', walkup: songs[idx % 4], shades: 'off', chain: 'off', ears: 'off', bracelet: 'off', ...c };
}
export function setCard(id, patch) { const s = load(); s.cards[id] = { ...card(id), ...patch }; save(); }
export function gsPlayer(id) { const b = GS_ROSTER.find(p => p.id === id); return b ? { ...b, ...card(id), pos: card(id).pos } : null; }

// Inside GS Baseball Hub: use the Hub's live roster (new players show up automatically).
const POS_MAP = { LC: 'CF', RC: 'CF', OF: 'LF', CENTER: 'CF', LEFT: 'LF', RIGHT: 'RF', PITCHER: 'P', CATCHER: 'C', SHORT: 'SS' };
export function setRoster(list) {
  const known = new Map(GS_ROSTER.map(p => [p.name.toLowerCase(), p.pos]));
  const out = [];
  for (const h of list || []) {
    if (!h || !h.name) continue;
    const toks = String(h.pos || '').toUpperCase().split(/[^A-Z0-9]+/).map(t => POS_MAP[t] || t).filter(t => POSITIONS.includes(t));
    const pos = toks[0] || known.get(String(h.name).toLowerCase()) || 'CF';
    const hand = v => (String(v || '').toUpperCase().startsWith('L') ? 'L' : 'R');
    out.push({ id: 'h_' + h.id, num: String(h.num || '').replace(/^#/, '') || '0', name: String(h.name), pos, bats: hand(h.bats), throws: hand(h.throws), gs: true });
  }
  if (!out.length) return false;
  GS_ROSTER.splice(0, GS_ROSTER.length, ...out);
  return true;
}

// Starting nine. "me" always starts, at the position on their card.
export function buildGSLineup(meId) {
  const all = GS_ROSTER.map(p => ({ ...gsPlayer(p.id), me: p.id === meId }));
  const me = all.find(p => p.me);
  const starters = {};
  if (me) starters[me.pos] = me;
  for (const p of all) {
    if (p.me) continue;
    if (!starters[p.pos]) starters[p.pos] = p;
  }
  // fill any open position with remaining bench players
  const used = new Set(Object.values(starters).map(p => p.id));
  for (const pos of POSITIONS) {
    if (!starters[pos]) { const b = all.find(p => !used.has(p.id)); if (b) { starters[pos] = { ...b, pos }; used.add(b.id); } }
  }
  let sub = 0;
  for (const pos of POSITIONS) if (!starters[pos]) starters[pos] = { id: 'sub' + (++sub), num: String(90 + sub), name: 'GS Sub ' + sub, pos, gs: true, bats: 'R', throws: 'R' };
  const nine = POSITIONS.map(pos => ({ ...starters[pos], pos }));
  // batting order follows roster order
  const order = GS_ROSTER.map(p => p.id);
  const at = id => { const i = order.indexOf(id); return i < 0 ? 99 : i; };
  nine.sort((a, b) => at(a.id) - at(b.id));
  return nine;
}
export function rivalsLineup() { return RIVALS.map(p => ({ ...p })); }

export function addStats(id, line) {
  const s = load(); const t = s.stats[id] || {};
  for (const k in line) t[k] = (t[k] || 0) + line[k];
  s.stats[id] = t; save();
}
export function recordDerby(id, hr, longest) {
  const s = load(); const d = s.derby[id] || { best: 0, longest: 0, played: 0 };
  d.played++; d.best = Math.max(d.best, hr); d.longest = Math.max(d.longest, Math.round(longest)); s.derby[id] = d; save();
  return d;
}
export function avg(h, ab) { if (!ab) return '.000'; const v = (h / ab).toFixed(3); return v.startsWith('0') ? v.slice(1) : v; }

// ---------- lineups ----------
// A lineup is the batting order: [{ id, pos }]. pos is a field position, or 'EH' for an extra
// hitter who bats but doesn't play the field (so a whole youth roster can hit).
// Default: everyone on the roster bats. The best nine take the field and the rest are extra
// hitters, all in roster order.
export function defaultLineup(meId) {
  const nine = buildGSLineup(meId).map(p => ({ id: p.id, pos: p.pos }));
  const all = nine.concat(GS_ROSTER.filter(p => !nine.some(e => e.id === p.id)).map(p => ({ id: p.id, pos: 'EH' })));
  const order = GS_ROSTER.map(p => p.id);
  const at = id => { const i = order.indexOf(id); return i < 0 ? 99 : i; };
  return meInField(all.sort((a, b) => at(a.id) - at(b.id)), meId);
}
// The kid playing on this phone never sits as an extra hitter: if he's bat-only, he takes an
// outfield spot (his own outfield position if he has one, else RF, LF, CF) and that outfielder
// bats as the extra hitter instead. Batting order doesn't change.
export const OUTFIELD = ['RF', 'LF', 'CF'];
export function meInField(entries, meId) {
  const me = (entries || []).find(e => e.id === meId);
  if (!me || me.pos !== 'EH') return entries;
  const want = card(meId).pos;
  const spots = OUTFIELD.includes(want) ? [want, ...OUTFIELD.filter(p => p !== want)] : OUTFIELD;
  for (const pos of spots) {
    const other = entries.find(e => e.pos === pos);
    if (other && other.id !== meId) { other.pos = 'EH'; me.pos = pos; return entries; }
  }
  return entries;
}
export const prefPos = id => { const c = card(id); return POSITIONS.includes(c.pos) ? c.pos : 'CF'; };
export function fixLineup(entries) {
  const known = new Set(GS_ROSTER.map(p => p.id));
  const seen = new Set(), out = [];
  for (const e of entries || []) {
    if (!e || seen.has(e.id) || !(known.has(e.id) || /^sub\d+$/.test(e.id))) continue;
    seen.add(e.id); out.push({ id: e.id, pos: e.pos });
  }
  // one player per position; duplicates become extra hitters
  const used = new Set();
  for (const e of out) { if (POSITIONS.includes(e.pos) && !used.has(e.pos)) used.add(e.pos); else e.pos = 'EH'; }
  // fill open positions: extra hitters who play it, any extra hitter, then the bench
  for (const pos of POSITIONS) {
    if (used.has(pos)) continue;
    let e = out.find(x => x.pos === 'EH' && prefPos(x.id) === pos) || out.find(x => x.pos === 'EH');
    if (!e) {
      const bench = GS_ROSTER.filter(p => !seen.has(p.id));
      const b = bench.find(p => prefPos(p.id) === pos) || bench[0];
      if (b) { e = { id: b.id, pos }; out.push(e); seen.add(b.id); }
      else { let n = 1; while (seen.has('sub' + n)) n++; e = { id: 'sub' + n, pos }; out.push(e); seen.add(e.id); }
    }
    e.pos = pos; used.add(pos);
  }
  return out;
}
// v2 lineups: everyone bats by default. Older saved lineups (nine only) start over once.
// Players added to the roster after the lineup was saved join at the bottom as extra hitters;
// only players someone took out on the lineup screen stay on the bench.
const LINEUP_V = 2;
export function savedLineup(meId) {
  const s = load();
  if (s.lineupV !== LINEUP_V || !s.lineup || !s.lineup.length) return fixLineup(defaultLineup(meId));
  const benched = new Set(s.benched || []);
  const lu = s.lineup.map(e => ({ id: e.id, pos: e.pos }));
  for (const p of GS_ROSTER) if (!benched.has(p.id) && !lu.some(e => e.id === p.id)) lu.push({ id: p.id, pos: 'EH' });
  return fixLineup(lu);
}
export function saveLineup(entries) {
  const s = load();
  s.lineup = entries.map(e => ({ id: e.id, pos: e.pos }));
  s.benched = GS_ROSTER.filter(p => !entries.some(e => e.id === p.id)).map(p => p.id);
  s.lineupV = LINEUP_V;
  save();
}
// The Hub's batting order for a game (ids from the Hub roster)
export function lineupFromHub(order) {
  return fixLineup((order || []).map(id => 'h_' + id).filter(id => GS_ROSTER.some(p => p.id === id)).map(id => ({ id, pos: prefPos(id) })));
}
export function lineupPlayers(entries, meId) {
  return entries.map(e => {
    const p = gsPlayer(e.id);
    if (p) return { ...p, pos: e.pos, me: e.id === meId };
    const n = +String(e.id).replace('sub', '') || 1;
    return { id: e.id, num: String(90 + n), name: 'GS Sub ' + n, pos: e.pos, gs: true, bats: 'R', throws: 'R' };
  });
}
export function playerName(id) { const p = GS_ROSTER.find(x => x.id === id); return p ? p : { id, num: String(90 + (+String(id).replace('sub', '') || 1)), name: 'GS Sub ' + (+String(id).replace('sub', '') || 1) }; }
