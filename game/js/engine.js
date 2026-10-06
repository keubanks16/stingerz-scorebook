import * as PH from './physics.js';
import { Player3D } from './player.js';
import { TEAMS } from './data.js';
import { sfx, say, music } from './audio.js';

const B = PH.BASES;
const bxz = k => B[((Math.round(k) % 4) + 4) % 4];
const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
const rnd = PH.randn;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const polar = (d, a) => [Math.sin(a * Math.PI / 180) * d, -Math.cos(a * Math.PI / 180) * d];
const SPOTS = { P: [0, -60.5], C: [0, 3.4], '1B': polar(98, 38), '2B': polar(142, 15), SS: polar(142, -15), '3B': polar(98, -38), LF: polar(270, -29), CF: polar(300, 0), RF: polar(270, 29) };
const THROW = { P: 74, C: 80, '1B': 74, '2B': 76, SS: 82, '3B': 82, LF: 76, CF: 78, RF: 78 };
const RELEASE = p => OUTFIELD.has(p) ? 0.8 : 0.45;
const CUT_MIN = 150;   // outfield throws longer than this go through a cutoff man
const POSWORD = { P: 'the pitcher', C: 'the catcher', '1B': 'first', '2B': 'second', SS: 'short', '3B': 'third', LF: 'left', CF: 'center', RF: 'right' };
const BASEWORD = ['home', 'first', 'second', 'third', 'home'];
const OUTFIELD = new Set(['LF', 'CF', 'RF']);
export function groundY(x, z) { const d = Math.hypot(x, z + 60.5); return d < 5 ? 0.8 : d < 9 ? 0.8 * (9 - d) / 4 : 0; }
function fieldDir(spray, dist) {
  if (dist < 130) return null;
  const a = spray;
  if (a < -30) return 'left'; if (a < -12) return 'left-center'; if (a <= 12) return 'center'; if (a <= 30) return 'right-center'; return 'right';
}

export class Game {
  constructor(ctx, cfg) {
    this.ctx = ctx; this.cfg = cfg; this.ui = ctx.ui; this.scene = ctx.scene;
    this.t = 0; this.timers = []; this.timeScale = 1; this.fast = false;
    this.actors = new Map();
    this.diff = cfg.difficulty;
    const gs = { ...TEAMS.GS, lineup: cfg.gsLineup, idx: 0, runs: 0, hits: 0, errors: 0, line: [], gs: true };
    const rv = { ...TEAMS.RIV, lineup: cfg.rivals, idx: 0, runs: 0, hits: 0, errors: 0, line: [], gs: false };
    this.teams = cfg.gsHome ? [rv, gs] : [gs, rv];
    this.inning = 1; this.half = 0; this.outs = 0; this.balls = 0; this.strikes = 0;
    this.box = {}; this.pbox = {};
    this.runners = []; this.fielders = []; this.batter = null;
    this.ball = { mode: 'none', pos: { x: 0, y: -10, z: 0 } };
    this.phase = 'init'; this.camMode = 'bat'; this.showZone = false; this.pitchAim = { x: 0, y: 2.4 };
    this.derby = cfg.mode === 'derby' ? { hr: 0, outs: 0, maxOuts: 10, longest: 0, last: null } : null;
    this.ump = new Player3D({ name: '', num: '', team: TEAMS.RIV, role: 'ump' }); this.scene.add(this.ump.root); this.ump.play('ump');
    this.tracer = [];
    this.setupHalf(true);
  }
  // ---------- helpers ----------
  get offense() { return this.teams[this.half]; }
  get defense() { return this.teams[1 - this.half]; }
  after(sec, fn) { this.timers.push({ at: this.t + sec, fn }); }
  clearTimers() { this.timers = []; }
  actor(p, role) {
    let a = this.actors.get(p.id);
    if (!a) {
      const team = p.gs ? TEAMS.GS : TEAMS.RIV;
      a = new Player3D({ name: p.name, num: p.num, team, skin: p.skin, hair: p.hair, bats: p.bats, throws: p.throws, role: p.pos === 'C' ? 'C' : null, scale: p.gs ? 1 : 1.03 });
      this.actors.set(p.id, a);
    }
    return a;
  }
  show(a) { if (!a.root.parent) this.scene.add(a.root); }
  hide(a) { if (a.root.parent) a.root.parent.remove(a.root); }
  boxOf(p) { return this.box[p.id] || (this.box[p.id] = { p, AB: 0, R: 0, H: 0, '2B': 0, '3B': 0, HR: 0, RBI: 0, BB: 0, K: 0 }); }
  pboxOf(p) { return this.pbox[p.id] || (this.pbox[p.id] = { p, OUTS: 0, H: 0, R: 0, BB: 0, K: 0, PIT: 0 }); }
  isHumanBat() { if (this.cfg.autoplay) return false; const m = this.cfg.mode; if (m === 'derby') return true; if (!this.offense.gs) return false; return m === 'team' || !!this.batter?.p.me; }
  isHumanPitch() { if (this.cfg.autoplay) return false; const m = this.cfg.mode; if (m === 'derby' || !this.defense.gs) return false; return m === 'team' || !!this.pitcherEnt?.p.me; }
  isHumanField(f) { if (this.cfg.autoplay) return false; if (!this.defense.gs || this.cfg.mode === 'derby') return false; return this.cfg.mode === 'team' || !!f?.p.me; }
  humanInvolved() { return this.isHumanBat() || this.isHumanPitch(); }
  // home crowd: cheers for GS, groans for the other team
  react(goodForGS, level) { if (this.fast && level < 1) return; if (goodForGS) sfx.cheer(level); else sfx.aww(Math.min(1, level)); }
  setFast(on) { this.fast = on; this.timeScale = on ? 4 : 1; }

  // ---------- half-inning setup ----------
  setupHalf(first) {
    this.clearTimers();
    for (const a of this.actors.values()) this.hide(a);
    this.fielders = []; this.runners = []; this.batter = null;
    const def = this.defense;
    for (const p of def.lineup) {
      const a = this.actor(p); this.show(a); a.setHeadgear(p.pos === 'C' ? 'helmet' : 'cap'); a.showBat(false);
      const [x, z] = SPOTS[p.pos];
      a.pos.set(x, groundY(x, z), z); a.faceToward(0, 0);
      const sm = def.gs ? 0.97 : [0.86, 0.93, 1][this.diff];
      const f = { p, a, pos: p.pos, spot: [x, z], goal: null, v: 0, spd: (OUTFIELD.has(p.pos) ? 21 : p.pos === 'C' ? 17 : 19.5) * sm, react: OUTFIELD.has(p.pos) ? 0.32 : 0.22, stun: 0, cover: null, chase: false };
      this.fielders.push(f);
      if (p.pos === 'P') this.pitcherEnt = f;
      if (p.pos === 'C') this.catcherEnt = f;
    }
    this.outs = 0; this.balls = 0; this.strikes = 0;
    const off = this.offense; off.line[this.inning - 1] = off.line[this.inning - 1] || 0;
    if (this.derby) { this.camMode = 'bat'; }
    this.refresh();
    this.after(first ? 0.8 : 1.6, () => this.startAtBat());
  }
  spotFor(f) {
    let [x, z] = f.spot;
    if (f.pos === '1B' && this.runnerOn(1) && !this.runnerOn(2)) { x = 66; z = -58; }
    return [x, z];
  }
  runnerOn(k) { return this.runners.find(r => r.state === 'alive' && r.s === k * 90); }

  // ---------- at bat ----------
  startAtBat() {
    if (this.phase === 'over') return;
    const off = this.offense;
    const p = off.lineup[off.idx % 9];
    const a = this.actor(p); this.show(a); a.setHeadgear('helmet'); a.showBat(true);
    const s = p.bats === 'L' ? -1 : 1;
    a.pos.set(-2.7 * s, 0, 0.2); a.root.rotation.y = s * Math.PI / 2; a.play('stance', { restart: true });
    this.batter = { p, a, s };
    this.balls = 0; this.strikes = 0;
    this.ump.pos.set(1.5 * s, 0, 6.3); this.ump.root.rotation.y = Math.PI;
    this.resetFielders(true);
    const human = this.isHumanBat();
    if (this.cfg.mode === 'me' && !this.humanInvolved()) this.ui.skip?.(true); else { this.ui.skip?.(false); if (this.fast) this.setFast(false); }
    this.refresh();
    const delay = this.fast ? 0.3 : 1.2;
    if (!this.fast) {
      if (p.gs) {
        const last = p.name.split(' ').slice(-1)[0];
        say(`Now batting, number ${p.num}, ${p.name}!`, 1.0, 0.85);
        if (p.walkup) music.walkup(p.walkup, 12);
      } else say(`Now batting, ${p.name}.`, 1.05, 0.9);
    }
    this.ui.ticker?.(`#${p.num} ${p.name} steps in${human ? ' — tap to swing!' : ''}`);
    this.ui.batterCard?.(p, this.boxOf(p));
    this.after(delay + (p.gs && !this.fast ? 1.4 : 0), () => this.prePitch());
  }
  resetFielders(snap) {
    for (const f of this.fielders) {
      const [x, z] = this.spotFor(f);
      f.goal = null; f.chase = false; f.cover = null; f.stun = 0; f.throwing = null; f.v = 0; f.carry = false;
      if (snap) { f.a.pos.set(x, groundY(x, z), z); }
      f.a.faceToward(0, 0);
      f.a.play(f.pos === 'C' ? 'catcher' : f.pos === 'P' ? 'stand' : 'ready');
      if (f.pos === 'C') f.a.root.rotation.y = Math.PI;
      if (f.pos === 'P') { f.a.root.rotation.y = 0; f.a.pos.set(0, 0.8, -60.5); }
    }
    for (const r of this.runners) { if (r.state === 'alive') { this.placeRunner(r); r.a.play('stand'); r.a.faceToward(0, 0); } }
  }
  prePitch() {
    if (this.phase === 'over') return;
    this.phase = 'prepitch'; this.swing = null; this.cpuSwing = null; this.play = null;
    const P = this.pitcherEnt; P.a.pos.set(0, 0.8, -60.5); P.a.root.rotation.y = 0; P.a.play('stand');
    this.catcherEnt.a.anim.glove = { x: 0, y: 2.4, z: 2.3 };
    this.ball.mode = 'none';
    this.batter.a.play('stance', { restart: true }); this.bunting = false; this.power = false;
    this.camMode = this.isHumanPitch() ? 'pitch' : 'bat';
    this.showZone = this.isHumanPitch() || (this.isHumanBat() && this.cfg.showZone);
    this.ui.batControls?.(this.isHumanBat());
    this.refresh();
    if (this.isHumanPitch()) {
      this.ui.pitchControls?.(true);
    } else {
      this.after(this.fast ? 0.25 : 0.9, () => this.cpuPitch());
    }
  }
  // ---------- pitching ----------
  pitchSpeed() {
    if (this.derby) return [46, 52, 58][this.diff];
    if (this.isHumanPitch()) return 64;
    if (!this.defense.gs) return [52, 61, 69][this.diff];
    return 62;
  }
  cpuPitch() {
    if (this.phase !== 'prepitch') return;
    let type = 'FB', tx, ty;
    if (this.derby) { tx = rnd() * 0.35; ty = 2.45 + rnd() * 0.3; }
    else {
      const r = Math.random();
      const mix = this.diff === 0 ? [0.72, 0.86, 0.95] : [0.5, 0.7, 0.85];
      type = r < mix[0] ? 'FB' : r < mix[1] ? 'CH' : r < mix[2] ? 'CB' : 'SL';
      const ahead = this.strikes > this.balls, behind = this.balls >= 3;
      const edge = behind ? 0.35 : ahead ? 1.05 : 0.7;
      tx = (Math.random() * 2 - 1) * edge; ty = 2.35 + (Math.random() * 2 - 1) * edge * 1.05;
      if (type === 'CB') ty -= 0.35;
      const miss = [0.32, 0.26, 0.2][this.diff];
      tx += rnd() * miss; ty += rnd() * miss;
    }
    this.throwPitch(type, { x: tx, y: ty });
  }
  setPitchAim(pt) { if (this.phase === 'prepitch' && this.isHumanPitch()) { this.pitchAim = { x: clamp(pt.x, -2, 2), y: clamp(pt.y, 0.6, 4.5) }; } }
  humanPitch(type, err) {
    if (this.phase !== 'prepitch' || !this.isHumanPitch()) return;
    const ang = Math.random() * Math.PI * 2, r = 0.08 + err * 1.1;
    const tgt = { x: this.pitchAim.x + Math.cos(ang) * r, y: this.pitchAim.y + Math.sin(ang) * r };
    this.ui.pitchControls?.(false);
    this.throwPitch(type, tgt, 1 - err * 0.1);
  }
  throwPitch(type, target, veloMul = 1) {
    this.phase = 'windup';
    const P = this.pitcherEnt;
    P.a.play('pitch', { dur: 1.0, restart: true });
    const lefty = P.p.throws === 'L';
    const mph = this.pitchSpeed() * PH.PITCHES[type].speed * veloMul * (1 + rnd() * 0.015);
    this.after(0.68, () => {
      if (this.phase !== 'windup') return;
      const rel = { x: (lefty ? 1.3 : -1.3), y: 5.9, z: -55.2 };
      this.ball.pt = PH.makePitch(type, mph, rel, target, lefty);
      this.ball.mode = 'pitch'; this.ball.t = 0;
      this.phase = 'pitch';
      this.pboxOf(P.p).PIT++;
      this.tracer = [];
      sfx.whoosh();
      if (!this.isHumanBat()) this.planCpuSwing();
    });
  }
  // ---------- batting ----------
  humanSwing(aimPt, opts = {}) {
    if (!this.isHumanBat() || this.swing) return false;
    if (!(this.phase === 'pitch' || (this.phase === 'windup'))) return false;
    if (this.phase === 'windup' && !this.bunting) return false;
    const pt = this.ball.pt;
    const tNow = this.phase === 'pitch' ? this.ball.t : -0.2;
    if (pt && tNow > pt.T + 0.05) return false;
    const tc = tNow + 0.1;
    this.swing = { tc, aim: aimPt, power: !!this.power, bunt: !!this.bunting, human: true };
    this.batter.a.play(this.bunting ? 'bunt' : 'swing', { restart: true, aimY: aimPt ? aimPt.y : 2.4 });
    return true;
  }
  planCpuSwing() {
    const pt = this.ball.pt, p = this.batter.p;
    const sk = this.offense.gs ? { st: 0.05, sa: 0.13, eye: 0.22 } : [{ st: 0.07, sa: 0.18, eye: 0.3 }, { st: 0.056, sa: 0.145, eye: 0.23 }, { st: 0.045, sa: 0.11, eye: 0.17 }][this.diff];
    if (this.derby) return;
    const cross = PH.pitchPos(pt, pt.T);
    const zone = PH.zoneOf();
    const px = cross.x + rnd() * sk.eye, py = cross.y + rnd() * sk.eye;
    const inZ = PH.isStrike(px, py, zone);
    const out = Math.max(0, Math.abs(px) - zone.x, zone.y0 - py, py - zone.y1);
    let ps = inZ ? 0.7 : 0.3 * Math.exp(-out / 0.45);
    if (this.strikes === 2) ps = inZ ? 0.92 : ps + 0.18;
    if (this.balls === 3 && this.strikes === 0) ps *= 0.35;
    if (pt.type !== 'FB' && !inZ) ps += 0.08;
    if (Math.random() > ps) return;
    const tIdeal = PH.pitchTimeAtZ(pt, PH.CONTACT_Z), bp = PH.pitchPos(pt, tIdeal);
    const bias = pt.type === 'CH' ? -0.03 : pt.type === 'CB' ? -0.018 : 0;
    const tau = bias + rnd() * sk.st;
    this.cpuSwing = { tc: tIdeal + tau, aim: { x: bp.x + rnd() * sk.sa * 1.3, y: bp.y + rnd() * sk.sa }, power: Math.random() < (this.balls > this.strikes ? 0.4 : 0.15), bunt: false, human: false, started: false };
  }
  resolveSwing(sw) {
    const pt = this.ball.pt, bat = this.batter;
    sw.resolved = true;
    const tIdeal = PH.pitchTimeAtZ(pt, PH.CONTACT_Z), bp = PH.pitchPos(pt, tIdeal);
    let aim = sw.aim;
    const assist = sw.human ? [1.5, 1.22, 1.0][this.diff] : 1;
    if (sw.human) {
      const mag = [1, 0.6, 0.25][this.diff];
      if (!aim) aim = { x: bp.x, y: bp.y };
      aim = { x: aim.x + (bp.x - aim.x) * mag + rnd() * 0.03, y: aim.y + (bp.y - aim.y) * mag + rnd() * 0.03 };
    }
    const tau = sw.tc - tIdeal;
    const evScale = sw.human ? 1 : this.offense.gs ? 0.97 : [0.88, 0.95, 1][this.diff];
    const res = PH.resolveSwing({ tau, dx: aim.x - bp.x, dy: aim.y - bp.y, power: sw.power, bunt: sw.bunt, hand: bat.p.bats, assist, evScale });
    sw.res = res;
    if (res.result === 'miss') { this.swung = true; if (sw.human) this.ui.swingInfo?.(tau < 0 ? 'EARLY' : 'LATE', Math.abs(tau)); return; }
    if (res.result === 'foul') { this.foulBall(bp, tau, sw.bunt); return; }
    this.startLive(res, bp);
  }
  updatePitch(dt) {
    const b = this.ball; b.t += dt;
    const pt = b.pt;
    const sw = this.swing || this.cpuSwing;
    if (this.cpuSwing && !this.cpuSwing.started && b.t >= this.cpuSwing.tc - 0.1) { this.cpuSwing.started = true; this.batter.a.play('swing', { restart: true, aimY: this.cpuSwing.aim.y }); }
    if (sw && !sw.resolved && b.t >= sw.tc) { this.resolveSwing(sw); if (this.phase !== 'pitch') return; }
    const tGlove = PH.pitchTimeAtZ(pt, 2.3);
    const p = PH.pitchPos(pt, Math.min(b.t, tGlove));
    b.pos = p;
    // catcher glove tracks the pitch
    const cr = PH.pitchPos(pt, tGlove);
    this.catcherEnt.a.anim.glove = { x: cr.x, y: cr.y + groundY(0, 0), z: 2.3 };
    this.tracerPush(p);
    if (b.t >= tGlove) {
      sfx.mitt();
      this.callPitch();
    }
  }
  callPitch() {
    const pt = this.ball.pt; const cross = PH.pitchPos(pt, pt.T);
    const swung = !!((this.swing && this.swing.resolved) || (this.cpuSwing && this.cpuSwing.resolved));
    const strike = swung || PH.isStrike(cross.x, cross.y, PH.zoneOf());
    this.phase = 'between'; this.ball.mode = 'held'; this.ball.holder = this.catcherEnt;
    const mph = Math.round(pt.mph);
    this.ui.pitchInfo?.(`${mph} MPH ${PH.PITCHES[pt.type].name}`, { x: cross.x, y: cross.y, strike, type: pt.type });
    if (this.derby) {
      if (swung) { this.derbyOut('Swing and miss'); return; }
      this.after(0.8, () => this.prePitch()); return;
    }
    if (strike) {
      this.strikes++;
      if (this.strikes >= 3) {
        this.ui.banner?.(swung ? 'STRIKE THREE!' : 'STRIKE THREE — LOOKING!', 'out');
        if (!this.fast) say(swung ? 'Strike three!' : 'Strike three, called!', 1.1, 0.8);
        this.react(this.defense.gs, 0.5);
        this.boxOf(this.batter.p).AB++; this.boxOf(this.batter.p).K++; this.pboxOf(this.pitcherEnt.p).K++;
        this.ui.ticker?.(`${this.batter.p.name} strikes out ${swung ? 'swinging' : 'looking'}.`);
        this.batterDone();
        this.recordOut();
        this.afterPlay(1.6);
      } else { this.ui.banner?.(swung ? 'SWINGING STRIKE' : 'STRIKE', 'strike', 700); this.after(this.fast ? 0.3 : 1.0, () => this.prePitch()); }
    } else {
      this.balls++;
      if (this.balls >= 4) {
        this.ui.banner?.('BALL FOUR', 'ball'); this.ui.ticker?.(`${this.batter.p.name} draws a walk.`);
        this.boxOf(this.batter.p).BB++; this.pboxOf(this.pitcherEnt.p).BB++;
        this.walk();
      } else { this.ui.banner?.('BALL', 'ball', 600); this.after(this.fast ? 0.3 : 1.0, () => this.prePitch()); }
    }
    this.refresh();
  }
  batterDone() { const a = this.batter.a; a.showBat(false); a.play('stand'); this.after(0.8, () => { if (!this.runners.find(r => r.a === a)) this.hide(a); }); this.offense.idx++; }
  foulBall(bp, tau, bunt) {
    sfx.foul();
    const side = (tau < 0 ? -1 : 1) * (this.batter.p.bats === 'L' ? -1 : 1);
    const back = Math.random() < 0.5;
    const spray = back ? 160 + Math.random() * 40 : side * (50 + Math.random() * 30);
    const b = PH.launch(35 + Math.random() * 35, back ? 35 + Math.random() * 25 : 10 + Math.random() * 30, spray, { x: bp.x, y: bp.y, z: PH.CONTACT_Z });
    this.ball.mode = 'foul'; this.ball.b = b; this.phase = 'foul';
    this.ui.banner?.('FOUL BALL', 'strike', 800);
    if (this.derby) { this.after(0.6, () => this.derbyOut('Foul ball')); return; }
    if (this.strikes < 2) this.strikes++;
    else if (bunt) { this.strikes = 3; this.ui.banner?.('FOUL BUNT — STRIKE THREE', 'out'); this.boxOf(this.batter.p).AB++; this.boxOf(this.batter.p).K++; this.pboxOf(this.pitcherEnt.p).K++; this.batterDone(); this.recordOut(); this.afterPlay(1.6); this.refresh(); return; }
    this.refresh();
    this.after(this.fast ? 0.4 : 1.4, () => { this.ball.mode = 'none'; this.prePitch(); });
  }
  walk() {
    // forced advances
    const b = this.batter;
    const occ = [1, 2, 3].map(k => this.runnerOn(k));
    const r = this.newRunner(b.p, b.a, 0); r.target = 1;
    if (occ[0]) { occ[0].target = 2; if (occ[1]) { occ[1].target = 3; if (occ[2]) occ[2].target = 4; } }
    b.a.showBat(false); this.offense.idx++;
    this.play = { award: true, runs: [], outsOnPlay: 0, batterRunner: r, walk: true };
    this.phase = 'live'; this.ball.mode = 'held'; this.ball.holder = this.catcherEnt;
    for (const x of this.runners) { x.vmax = 14; x.delay = 0.2; }
    this.refresh();
  }
  newRunner(p, a, s) {
    const r = { p, a, s, target: Math.round(s / 90), state: 'alive', v: 0, vmax: 22, delay: 0, orig: Math.round(s / 90), forcedTo: null };
    this.runners.push(r); a.setHeadgear('helmet'); return r;
  }
  placeRunner(r) {
    const s = Math.min(r.s, 360); const k = Math.min(3, Math.floor(s / 90)); const f = (s - k * 90) / 90;
    const [x0, z0] = bxz(k), [x1, z1] = bxz(k + 1);
    // stand slightly off the bag toward the outside
    const x = x0 + (x1 - x0) * f, z = z0 + (z1 - z0) * f;
    r.a.pos.set(x, 0, z);
  }

  // ---------- ball in play ----------
  startLive(res, bp) {
    sfx.crack(res.q);
    this.phase = 'live'; this.liveT = 0;
    const b = PH.launch(res.ev, res.la, res.spray, { x: bp.x, y: bp.y, z: PH.CONTACT_Z });
    this.ball.mode = 'free'; this.ball.b = b; this.ball.holder = null;
    const bat = this.batter;
    this.play = { res, runs: [], outsOnPlay: 0, forceOuts: 0, fairLocked: false, landed: false, fieldedBy: null, caught: false, hr: false, error: false, foul: false, startT: this.t, maxDist: 0 };
    this.tracer = [];
    // batter becomes a runner
    bat.a.showBat(false);
    let br = null;
    if (!this.derby) { br = this.newRunner(bat.p, bat.a, 0); br.target = 1; br.delay = res.bunt ? 0.15 : 0.35; br.forcedTo = 1; }
    else { bat.a.play('stand'); }
    this.play.batterRunner = br;
    // force chain
    const on = [1, 2, 3].map(k => this.runnerOn(k));
    for (const r of this.runners) { if (r !== br) { r.orig = r.s / 90; r.forcedTo = null; } }
    if (on[0]) { on[0].forcedTo = 2; if (on[1]) { on[1].forcedTo = 3; if (on[2]) on[2].forcedTo = 4; } }
    this.offense.idx++;
    this.camMode = 'follow';
    this.ui.batControls?.(false); this.ui.pitchControls?.(false);
    this.showZone = false;
    this.ui.contact?.({ ev: res.ev, la: res.la });
    if (res.la > 18 && res.ev > 80 && !this.fast) this.after(0.35, () => { if (this.phase === 'live' && this.ball.mode === 'free') sfx.ooh(); });
    this.plan();
    // fly ball? runners hold to tag
    this.play.flyHold = this.planInfo && this.planInfo.air && this.outs < 2;
    for (const r of this.runners) { r.vmax = 22; if (r !== br && !this.play.flyHold) { r.v = 12; } }
    // runners take a lead off their base
    for (const r of this.runners) if (r !== br && r.state === 'alive') r.lead = 9;
    this.decideAllRunners();
    this.refresh();
  }
  // predict & assign fielders
  plan() {
    const b = this.ball.b; if (!b) return;
    const pr = PH.predict(b, 9, 1 / 60);
    const S = pr.samples;
    const since = this.t - (this.play?.startT ?? this.t);
    let best = null;
    for (const f of this.fielders) {
      f.chase = false;
      if (f.stun > 0 || f.throwing) continue;
      const react = Math.max(0, f.react - since);
      let hit = null;
      for (const s of S) {
        if (s.over || s.stands) break;
        if (s.y > 7.2) continue;
        const run = Math.max(0, s.t - react - 0.12) * f.spd;
        const d = dist2(f.a.pos.x, f.a.pos.z, s.x, s.z) - 1.8;
        if (d <= run) { hit = s; break; }
      }
      if (hit && (!best || hit.t < best.s.t)) best = { f, s: hit };
    }
    let chaser = null, point = null, tInt = 99;
    if (best) { chaser = best.f; point = best.s; tInt = best.s.t; }
    else {
      const last = S[S.length - 1];
      if (last && !pr.over) {
        let bd = 1e9; for (const f of this.fielders) { if (f.throwing) continue; const d = dist2(f.a.pos.x, f.a.pos.z, last.x, last.z); if (d < bd) { bd = d; chaser = f; } }
        point = last; tInt = last.t + 1;
      }
    }
    this.planInfo = { chaser, point, tAbs: this.t + tInt, air: !!(point && !point.touched && point.y > 0.6 && best), over: pr.over };
    if (chaser) { chaser.chase = true; chaser.goal = { x: point.x, z: point.z }; }
    // second outfielder backs up
    if (chaser && OUTFIELD.has(chaser.pos) && point) {
      let bk = null, bd = 1e9; for (const f of this.fielders) { if (f === chaser || !OUTFIELD.has(f.pos)) continue; const d = dist2(f.a.pos.x, f.a.pos.z, point.x, point.z); if (d < bd) { bd = d; bk = f; } }
      if (bk && bd < 160) bk.goal = { x: point.x * 0.92 + (bk.a.pos.x - point.x) * 0.15, z: point.z * 0.92 + 18 };
    }
    this.assignCovers();
  }
  assignCovers() {
    const used = new Set(this.fielders.filter(f => f.chase || f.carry || (this.ball.mode === 'held' && this.ball.holder === f)).map(f => f.pos));
    this.planCutoff(used);
    const left = this.ball.b ? this.ball.b.x < 0 : true;
    const prefs = { 1: ['1B', '2B', 'P'], 2: left ? ['2B', 'SS', 'P'] : ['SS', '2B', 'P'], 3: ['3B', 'SS', 'P'], 0: ['C', 'P'] };
    this.covers = {};
    for (const k of [1, 2, 3, 0]) {
      for (const pos of prefs[k]) {
        if (used.has(pos)) continue;
        const f = this.fielders.find(x => x.pos === pos);
        if (!f) continue;
        used.add(pos); this.covers[k] = f; f.cover = k; const [x, z] = bxz(k); f.goal = { x: x + (k === 0 ? 0 : 0), z: z + (k === 0 ? 1.5 : 0) }; break;
      }
    }
    // remaining infielders/pitcher drift toward the ball, outfielders back up
    for (const f of this.fielders) {
      if (used.has(f.pos) || f.goal) continue;
      if (this.planInfo?.point) { const p = this.planInfo.point; f.goal = { x: f.a.pos.x + (p.x - f.a.pos.x) * 0.3, z: f.a.pos.z + (p.z - f.a.pos.z) * 0.3 }; }
    }
  }
  coverOf(k) {
    let f = this.covers?.[k];
    if (!f || (this.ball.holder === f) || f.chase) {
      let bd = 1e9; f = null; const [x, z] = bxz(k);
      for (const g of this.fielders) { if (g === this.ball.holder || g.throwing) continue; const d = dist2(g.a.pos.x, g.a.pos.z, x, z); if (d < bd) { bd = d; f = g; } }
      if (f) { this.covers[k] = f; f.cover = k; f.chase = false; f.goal = { x, z }; }
    }
    return f;
  }
  update(dt) {
    this.t += dt;
    for (let i = 0; i < this.timers.length; i++) { const tm = this.timers[i]; if (this.t >= tm.at) { this.timers.splice(i--, 1); tm.fn(); } }
    if (this.phase === 'pitch') this.updatePitch(dt);
    if (this.phase === 'foul' && this.ball.b) { PH.stepBall(this.ball.b, dt, {}); this.ball.pos = this.ball.b; if (Math.abs(this.ball.b.x) > 200 || this.ball.b.z > 90) this.ball.mode = 'none'; }
    if (this.ball.mode === 'hr') {
      const b = this.ball.b; b.hrT = (b.hrT || 0) + dt; PH.stepBall(b, dt, {}); this.ball.pos = b; this.tracerPush(b);
      if (b.hrT > 2.2 || (b.y < 25 && Math.hypot(b.x, b.z) > PH.fenceDist(PH.sprayOf(b.x, b.z)) + 60)) this.ball.mode = 'gone';
    }
    if (this.phase === 'live') {
      const n = 4, h = dt / n;
      for (let i = 0; i < n && this.phase === 'live'; i++) this.stepLive(h);
    }
    // actor animation & positions
    for (const f of this.fielders) {
      if (this.phase === 'live' || this.phase === 'dead') this.moveFielder(f, dt);
      f.a.update(dt);
    }
    for (const r of this.runners) r.a.update(dt);
    if (this.batter && !this.runners.find(r => r.a === this.batter.a)) this.batter.a.update(dt);
    this.ump.update(dt);
    if (this.ball.mode === 'held' && this.ball.holder) {
      const v = this.ball.holder.a.handWorld(_tmpV, this.ball.holder.a.anim.name !== 'throw'); this.ball.pos = { x: v.x, y: v.y, z: v.z };
    }
  }
  stepLive(dt) {
    const pl = this.play, b = this.ball;
    this.liveT += dt;
    if (b.mode === 'free') {
      const ev = {};
      PH.stepBall(b.b, dt, ev);
      b.pos = b.b; this.tracerPush(b.b);
      const d = Math.hypot(b.b.x, b.b.z); pl.maxDist = Math.max(pl.maxDist, d);
      const w = PH.wallCheck(b.b);
      if (w === 'over' && !pl.award) {
        if (!b.b.touched && !pl.foul) return this.homeRun();
        return this.groundRule();
      }
      if (w === 'wall') { pl.hitWall = true; sfx.glove(); this.plan(); }
      if (ev.landed && !pl.landed) {
        pl.landed = true; pl.landX = b.b.x; pl.landZ = b.b.z; sfx.oohStop();
        if (!pl.fairLocked) {
          const fair = PH.isFairXZ(b.b.x, b.b.z);
          if (d > 125 || !fair) { if (!fair) return this.liveFoul(); pl.fairLocked = true; }
        }
        if (pl.flyHold) { pl.flyHold = false; this.decideAllRunners(); }
        this.plan();
      }
      if (pl.landed && !pl.fairLocked) {
        if (!PH.isFairXZ(b.b.x, b.b.z)) return this.liveFoul();
        if (d > 125) pl.fairLocked = true;
      }
      if (PH.inStands(b.b.x, b.b.z)) { if (pl.fairLocked) return this.groundRule(); return this.liveFoul(); }
      if (b.b.stopped && !pl.fairLocked && d < 125) { if (!PH.isFairXZ(b.b.x, b.b.z)) return this.liveFoul(); pl.fairLocked = true; }
      if ((this.liveT % 0.4) < dt) this.plan();
      this.checkCatch();
    } else if (b.mode === 'thrown') {
      const th = b.throw; th.t += dt;
      const u = Math.min(1, th.t / th.T);
      b.pos = { x: th.x0 + (th.x1 - th.x0) * u, y: th.y0 + th.vy * th.t - 0.5 * PH.G * th.t * th.t, z: th.z0 + (th.z1 - th.z0) * u };
      this.tracerPush(null);
      if (u >= 1) this.throwArrives();
    }
    this.updateRunners(dt);
    if (this.phase !== 'live') return;
    if (b.mode === 'held' && b.holder && !pl.award) this.applyRules(b.holder);
    if (this.phase !== 'live') return;
    // play over?
    const moving = this.runners.some(r => r.state === 'alive' && (r.s !== r.target * 90 || r.delay > 0));
    if (!moving && ((b.mode === 'held' && !(b.holder && (b.holder.throwing || b.holder.carry))) || (pl.award && (b.mode === 'gone' || b.mode === 'hr')))) {
      pl.quiet = (pl.quiet || 0) + dt;
      if (pl.quiet > (pl.award ? 0.2 : 0.55)) this.endPlay();
    } else if (pl) pl.quiet = 0;
    if (this.liveT > 25) this.endPlay(true);
  }
  checkCatch() {
    const b = this.ball.b, pl = this.play;
    if (b.y > 7.6) return;
    for (const f of this.fielders) {
      if (f.stun > 0 || f.throwing) continue;
      const reach = f.chase ? 2.4 : 1.8;
      if (dist2(f.a.pos.x, f.a.pos.z, b.x, b.z) > reach) continue;
      // error chance
      const errRate = (this.defense.gs ? 0.01 : [0.04, 0.025, 0.012][this.diff]) * (b.touched ? 1 : 0.5) * (this.derby ? 0 : 1);
      if (Math.random() < errRate && !pl.error) {
        pl.error = true; this.defense.errors++; f.stun = 0.7;
        const a = Math.random() * Math.PI * 2; b.vx = Math.cos(a) * 9; b.vz = Math.sin(a) * 9; b.vy = 4; b.rolling = false; b.touched = true; b.stopped = false;
        sfx.glove(); this.ui.banner?.('ERROR!', 'safe', 900); this.ui.ticker?.(`${f.p.name} can't handle it — error!`);
        if (pl.flyHold) { pl.flyHold = false; this.decideAllRunners(); }
        this.plan(); return;
      }
      const inAir = !b.touched && !pl.hitWall;
      // a ball fielded in foul territory before passing the bag is foul
      if (!inAir && !pl.fairLocked && !PH.isFairXZ(b.x, b.z)) return this.liveFoul();
      pl.fairLocked = true;
      this.ball.mode = 'held'; this.ball.holder = f; this.ball.b = null;
      f.chase = false; f.goal = null; f.v = 0;
      pl.fieldedBy = pl.fieldedBy || f;
      sfx.glove();
      f.a.play('catch', { glove: { x: b.x, y: b.y, z: b.z }, low: b.y < 2 });
      if (inAir) {
        pl.caught = true;
        const br = pl.batterRunner;
        if (this.derby) { this.derbyOut('Caught'); return; }
        this.ui.banner?.('CAUGHT!', 'out', 900); this.react(this.defense.gs, 0.35);
        this.markOut(br, 'fly');
        if (this.phase !== 'live') return;
        pl.flyHold = false;
        // runners must tag up
        for (const r of this.runners) if (r.state === 'alive' && r !== br) { r.forcedTo = null; if (r.s > r.orig * 90) { r.target = r.orig; r.returning = true; } }
        this.after(0.05, () => this.decideAllRunners());
      } else if (this.derby) { this.derbyOut('In play'); return; }
      this.assignCovers();
      this.afterPossession(f, OUTFIELD.has(f.pos) && !inAir ? 0.45 : 0.22);
      return;
    }
  }
  afterPossession(f, delay) {
    this.after(delay, () => {
      if (this.phase !== 'live' || this.ball.holder !== f || this.ball.mode !== 'held') return;
      this.decideAllRunners();
      const choice = this.decideThrow(f);
      const anyMoving = this.runners.some(r => r.state === 'alive' && r.s !== r.target * 90);
      if (this.isHumanField(f) && !this.play.award && anyMoving) {
        this.awaitHuman = { f, choice }; if (this.fast) this.setFast(false);
        this.ui.throwControls?.({ rec: choice.type === 'hold' ? null : choice.k, onPick: k => this.humanThrow(f, k) });
        const limit = [1.6, 1.35, 1.1][this.diff];
        this.after(limit, () => { if (this.awaitHuman && this.awaitHuman.f === f) { this.awaitHuman = null; this.ui.throwControls?.(null); this.execChoice(f, this.decideThrow(f)); } });
      } else this.execChoice(f, choice);
    });
  }
  humanThrow(f, k) {
    if (!this.awaitHuman || this.awaitHuman.f !== f) return;
    this.awaitHuman = null; this.ui.throwControls?.(null);
    if (k == null) return this.execChoice(f, { type: 'hold' });
    const [x, z] = bxz(k);
    if (dist2(f.a.pos.x, f.a.pos.z, x, z) < 22) return this.execChoice(f, { type: 'run', k });
    this.execChoice(f, { type: 'throw', k });
  }
  execChoice(f, c) {
    if (this.phase !== 'live' || this.ball.holder !== f) return;
    if (c.type === 'throw') this.startThrow(f, c.k);
    else if (c.type === 'run') { f.carry = true; const [x, z] = bxz(c.k); f.goal = { x, z }; f.carryTo = c.k; }
  }
  // Where the lead runner is, and the base the outfield should throw to: the base after the one
  // he's heading for (no one on + single = throw to 2nd; runner on 1st = throw to 3rd).
  leadRunner() {
    const alive = this.runners.filter(r => r.state === 'alive');
    return alive.length ? alive.reduce((a, b) => (b.s > a.s ? b : a)) : null;
  }
  aheadBase() {
    const L = this.leadRunner(); if (!L) return 2;
    const base = Math.floor(L.s / 90 + 1e-6);
    const going = L.target > base && L.s < L.target * 90 ? L.target : base;
    return Math.min(4, going + 1);
  }
  outfieldThrow(f) {
    const L = this.leadRunner();
    if (!L) return { type: 'throw', k: 2 };
    const fx = f.a.pos.x, fz = f.a.pos.z;
    const k = L.target, [bx, bz] = bxz(k);
    // a chance to get the lead runner where he's going? (force at 2nd, doubled off, or a sure tag)
    if (L.s !== k * 90) {
      const forced = L.forcedTo === k || L.s > k * 90;
      const d = dist2(fx, fz, bx, bz);
      const td = RELEASE(f.pos) + d / THROW[f.pos] + 0.1 + (d > CUT_MIN ? 0.45 : 0);
      const tr = Math.abs(k * 90 - L.s) / L.vmax + Math.max(0, L.delay) + (L.v < 3 ? 0.3 : 0);
      if (tr - td > (forced ? 0.15 : 0.45)) return { type: 'throw', k: k % 4 };
    }
    // otherwise keep him from taking another base: throw ahead of him
    return { type: 'throw', k: this.aheadBase() % 4 };
  }
  // Cutoff man for long outfield throws: SS on throws to 3rd; 3B (ball to left) or 1B (center/right)
  // on throws home; SS (left/center) or 2B (right) on long throws to 2nd. He lines up between the
  // outfielder and the base.
  planCutoff(used) {
    this.cut = null;
    const P = this.planInfo;
    let from = null;
    if (this.ball.mode === 'held' && this.ball.holder && OUTFIELD.has(this.ball.holder.pos)) from = { x: this.ball.holder.a.pos.x, z: this.ball.holder.a.pos.z };
    else if (this.ball.mode === 'free' && P && P.chaser && OUTFIELD.has(P.chaser.pos) && P.point) from = { x: P.point.x, z: P.point.z };
    if (!from) return;
    const k = this.aheadBase() % 4;
    if (k === 1) return;
    const [bx, bz] = bxz(k);
    const d = dist2(from.x, from.z, bx, bz);
    if (d < CUT_MIN) return;
    const pos = k === 0 ? (from.x < -40 ? '3B' : '1B') : k === 3 ? 'SS' : (from.x > 40 ? '2B' : 'SS');
    if (used.has(pos)) return;
    const f = this.fielders.find(x => x.pos === pos); if (!f) return;
    const pt = this.cutPoint(from, k);
    used.add(pos); f.goal = { x: pt.x, z: pt.z }; f.cover = null;
    this.cut = { f, k, x: pt.x, z: pt.z };
  }
  planCutoffFor(f, k) {
    if (k === 1) return;
    const from = { x: f.a.pos.x, z: f.a.pos.z };
    const pos = k === 0 ? (from.x < -40 ? '3B' : '1B') : k === 3 ? 'SS' : (from.x > 40 ? '2B' : 'SS');
    const c = this.fielders.find(x => x.pos === pos);
    // the cutoff can't be someone who has to cover the base the throw is going to
    if (!c || c === this.covers?.[k] || c === f) return;
    const pt = this.cutPoint(from, k);
    this.cut = { f: c, k, x: pt.x, z: pt.z };
  }
  cutPoint(from, k) {
    const [bx, bz] = bxz(k);
    const d = dist2(from.x, from.z, bx, bz), ux = (from.x - bx) / d, uz = (from.z - bz) / d;
    const dc = k === 0 ? Math.max(40, Math.min(60, d * 0.3)) : Math.max(55, Math.min(115, d * 0.42));
    return { x: bx + ux * dc, z: bz + uz * dc };
  }
  decideThrow(f) {
    if (OUTFIELD.has(f.pos)) return this.outfieldThrow(f);
    const fx = f.a.pos.x, fz = f.a.pos.z, spd = THROW[f.pos];
    let best = null;
    const alive = this.runners.filter(r => r.state === 'alive');
    for (const r of alive) {
      const fwd = r.s < r.target * 90, back = r.s > r.target * 90;
      if (!fwd && !back) continue;
      const k = r.target, [bx, bz] = bxz(k);
      const forced = (r.forcedTo === k) || back;
      const tr = Math.abs(k * 90 - r.s) / r.vmax + Math.max(0, r.delay) + (r.v < 3 ? 0.3 : 0);
      const d = dist2(fx, fz, bx, bz);
      let td, type;
      if (d < 3) { td = 0; type = 'run'; }
      else if (d < 22) { td = d / 18; type = 'run'; }
      else { td = RELEASE(f.pos) + d / spd + 0.1; type = 'throw'; }
      const margin = tr - td - (forced ? 0 : 0.3);
      if (margin < 0.08) continue;
      const score = (margin > 0.35 ? k * 2 : 0) + margin;
      if (!best || score > best.score) best = { type, k: k % 4, score };
    }
    if (best) return best;
    // no out available: get the ball ahead of the lead runner
    const moving = alive.filter(r => r.s < r.target * 90).sort((a, b) => b.target - a.target);
    if (moving.length && OUTFIELD.has(f.pos)) {
      const k = moving[0].target % 4;
      return { type: 'throw', k: k === 0 ? 0 : k };
    }
    if (OUTFIELD.has(f.pos) && !moving.length) return { type: 'throw', k: 2 };
    return { type: 'hold' };
  }
  startThrow(f, k) {
    let recv = this.coverOf(k);
    if (!recv) return;
    let [bx, bz] = bxz(k), tk = k;
    // long throw from the outfield: hit the cutoff man instead of throwing all the way
    if (OUTFIELD.has(f.pos) && dist2(f.a.pos.x, f.a.pos.z, bx, bz) > CUT_MIN) {
      if (!this.cut || this.cut.k !== k || this.cut.f === f) { this.cut = null; this.planCutoffFor(f, k); }
      if (this.cut && this.cut.k === k) {
        const pt = this.cutPoint({ x: f.a.pos.x, z: f.a.pos.z }, k);
        recv = this.cut.f; recv.goal = { x: pt.x, z: pt.z }; bx = pt.x; bz = pt.z; tk = -1;
      }
    }
    f.throwing = { k, t: 0 }; f.goal = null; f.v = 0; f.carry = false;
    f.a.faceToward(bx, bz); f.a.play('throw', { dur: 0.5, restart: true });
    this.after(0.27, () => {
      if (this.phase !== 'live' || this.ball.holder !== f) { f.throwing = null; return; }
      const h = f.a.handWorld(_tmpV);
      const d = dist2(h.x, h.z, bx, bz);
      const rd = dist2(recv.a.pos.x, recv.a.pos.z, bx, bz);
      const T = Math.max(0.25, d / THROW[f.pos], rd / recv.spd + 0.15);
      const y1 = 4.2, vy = (y1 - h.y + 0.5 * PH.G * T * T) / T;
      this.ball.mode = 'thrown'; this.ball.holder = null;
      this.ball.throw = { x0: h.x, y0: h.y, z0: h.z, x1: bx, z1: bz, T, t: 0, vy, k: tk, cutK: tk < 0 ? k : null, recv, from: f };
      if (tk < 0) this.ui.ticker?.(`${f.p.name} hits the cutoff man.`);
      this.after(0.25, () => { f.throwing = null; f.a.play('ready'); });
      this.decideAllRunners();
    });
  }
  throwArrives() {
    const th = this.ball.throw, R = th.recv;
    if (R && R.stun <= 0 && Math.random() > 0.015) { R.a.pos.x = th.x1 + (R.a.pos.x - th.x1) * Math.min(1, 3 / Math.max(3, dist2(R.a.pos.x, R.a.pos.z, th.x1, th.z1))); R.a.pos.z = th.z1 + (R.a.pos.z - th.z1) * Math.min(1, 3 / Math.max(3, dist2(R.a.pos.x, R.a.pos.z, th.x1, th.z1))); }
    const ok = R && dist2(R.a.pos.x, R.a.pos.z, th.x1, th.z1) < 4.5 && R.stun <= 0;
    if (ok) {
      this.ball.mode = 'held'; this.ball.holder = R; R.goal = null; R.v = 0; sfx.glove();
      R.a.play('catch', { glove: { x: th.x1, y: 4, z: th.z1 } });
      this.applyRules(R);
      if (this.phase === 'live') this.afterPossession(R, 0.32);
    } else {
      // throw gets by
      const b = { x: th.x1, y: 3, z: th.z1, vx: (th.x1 - th.x0) / th.T * 0.35, vy: 0, vz: (th.z1 - th.z0) / th.T * 0.35, spin: 0, touched: true, rolling: false };
      this.ball.mode = 'free'; this.ball.b = b; this.play.error = true; this.defense.errors++;
      this.ui.ticker?.('The throw gets away!');
      this.plan(); this.decideAllRunners();
    }
  }
  applyRules(F) {
    const pl = this.play; if (!pl || pl.award) return;
    const fx = F.a.pos.x, fz = F.a.pos.z;
    for (const r of this.runners) {
      if (r.state !== 'alive') continue;
      // force or appeal at a base
      const k = r.target; const [bx, bz] = bxz(k);
      const onBag = dist2(fx, fz, bx, bz) < 2.8;
      if (onBag) {
        if (r.forcedTo === k && r.s < k * 90) { this.markOut(r, 'force', k); if (this.phase !== 'live') return; continue; }
        if (r.returning && r.s > k * 90) { this.markOut(r, 'doubled', k); if (this.phase !== 'live') return; continue; }
      }
      // tag
      const off = Math.abs(r.s - Math.round(r.s / 90) * 90) > 1.2;
      if (off && dist2(fx, fz, r.a.pos.x, r.a.pos.z) < 3.2) { this.markOut(r, 'tag', k); if (this.phase !== 'live') return; }
    }
  }
  markOut(r, how, k) {
    const pl = this.play;
    r.state = 'out'; r.v = 0;
    pl.outsOnPlay++;
    if (how === 'force') pl.forceOuts++;
    const br = pl.batterRunner;
    if (r === br) pl.batterOut = how;
    // trailing runner out removes force on runners ahead
    for (const o of this.runners) if (o.state === 'alive' && (r === br || o.orig > r.orig)) o.forcedTo = null;
    if (how !== 'fly') {
      this.ui.banner?.(how === 'tag' ? 'TAGGED OUT!' : how === 'doubled' ? 'DOUBLED OFF!' : `OUT AT ${BASEWORD[k].toUpperCase()}!`, 'out', 1000);
      sfx.glove(); this.react(this.defense.gs, 0.3);
    }
    r.a.play('stand');
    this.after(1.0, () => { if (r.state === 'out') this.hide(r.a); });
    this.recordOut();
    if (this.outs >= 3) {
      // third out on a force (or batter before first): no runs count
      if (how === 'force' || (r === br && how !== 'fly' && r.s < 90)) this.revokeRuns();
      this.endPlay();
    }
  }
  recordOut() { this.outs++; this.pboxOf(this.pitcherEnt.p).OUTS++; this.refresh(); }
  revokeRuns() {
    const pl = this.play;
    for (const r of pl.runs) { this.offense.runs--; this.offense.line[this.inning - 1]--; this.boxOf(r.p).R--; this.pboxOf(this.pitcherEnt.p).R--; }
    pl.runs = [];
  }
  liveFoul() {
    sfx.oohStop();
    const pl = this.play;
    pl.foul = true;
    this.ui.banner?.('FOUL BALL', 'strike', 800);
    if (this.derby) return this.derbyOut('Foul');
    // undo the batter-runner and runner movement
    const br = pl.batterRunner;
    this.runners = this.runners.filter(r => r !== br);
    this.offense.idx--;
    for (const r of this.runners) { if (r.state === 'alive') { r.s = r.orig * 90; r.target = r.orig; r.v = 0; r.returning = false; this.placeRunner(r); } }
    const bunt = pl.res.bunt;
    if (this.strikes < 2) this.strikes++;
    else if (bunt) {
      this.phase = 'dead';
      this.ui.banner?.('FOUL BUNT — STRIKE THREE', 'out'); this.boxOf(br.p).AB++; this.boxOf(br.p).K++;
      this.batter.a.play('stand'); this.offense.idx++;
      this.recordOut(); this.afterPlay(1.6); return;
    }
    this.phase = 'dead'; this.ball.mode = 'none';
    this.batter.a.showBat(true); this.batter.a.play('stance', { restart: true });
    const s = this.batter.s; this.batter.a.pos.set(-2.7 * s, 0, 0.2); this.batter.a.root.rotation.y = s * Math.PI / 2;
    this.refresh();
    this.after(1.4, () => { this.resetFielders(true); this.camMode = 'bat'; this.prePitch(); });
  }
  homeRun() {
    const pl = this.play; pl.hr = true; pl.award = true;
    const dist = Math.round(this.estimateHRDist());
    this.ball.mode = 'hr'; this.ball.hrT = 0;
    this.ui.banner?.('HOME RUN!', 'hr', 2600);
    this.react(this.offense.gs, 1.2); if (!this.fast) say(`It's outta here! Home run, ${this.batter.p.name}!`, 1.05, 0.9);
    if (this.batter.p.gs && this.batter.p.walkup) music.walkup(this.batter.p.walkup, 14); else if (this.batter.p.gs) sfx.organ();
    this.ui.contact?.({ ev: pl.res.ev, la: pl.res.la, dist });
    if (this.derby) { this.derby.hr++; this.derby.longest = Math.max(this.derby.longest, dist); this.derby.last = dist; this.ui.derby?.(this.derby); }
    for (const r of this.runners) if (r.state === 'alive') { r.target = 4; r.vmax = 26; r.forcedTo = null; r.returning = false; }
    for (const f of this.fielders) { f.goal = null; f.chase = false; }
    pl.hrDist = dist;
    if (this.derby) { this.phase = 'dead'; this.after(3.2, () => this.derbyNext()); }
  }
  estimateHRDist() {
    const b = { ...this.ball.b };
    for (let i = 0; i < 600 && b.y > 0.2; i++) PH.stepBall(b, 1 / 60, {});
    return Math.hypot(b.x, b.z);
  }
  groundRule() {
    if (this.derby) return this.derbyOut('Ground-rule double');
    const pl = this.play; pl.award = true; pl.gr2 = true;
    this.ball.mode = 'gone';
    this.ui.banner?.('GROUND-RULE DOUBLE', 'safe', 1600);
    for (const r of this.runners) if (r.state === 'alive') { r.target = Math.min(4, r.orig + 2); r.vmax = 15; r.returning = false; }
    pl.batterRunner.target = 2;
  }
  // ---------- runners ----------
  decideAllRunners() {
    const alive = this.runners.filter(r => r.state === 'alive').sort((a, b) => b.s - a.s);
    for (const r of alive) this.decideRunner(r);
  }
  decideRunner(r) {
    const pl = this.play;
    if (!pl || pl.award || r.state !== 'alive') return;
    if (r.s % 90 !== 0) return; // committed between bases
    const base = r.s / 90;
    if (r.returning) return;
    if (pl.flyHold && r !== pl.batterRunner) return;
    if (r.forcedTo && r.forcedTo > base) { r.target = Math.max(r.target, base + 1); return; }
    if (r.target > base) return;
    const next = base + 1; if (next > 4) return;
    // blocked by runner ahead
    // never pass the runner ahead (runners keep their batting-order position on the bases)
    for (const o of this.runners) if (o !== r && o.state === 'alive' && (o.orig > r.orig || o.s > r.s) && o.target <= next) return;
    const runT = (next * 90 - r.s) / r.vmax + (r.v > 10 ? 0 : 0.35) + Math.max(0, r.delay);
    const defT = this.defenseTime(next);
    const margin = (next === 4 ? 0 : 0.25) - (this.outs === 2 ? 0.25 : 0);
    if (runT + margin < defT) r.target = next;
  }
  defenseTime(k) {
    const [bx, bz] = bxz(k), b = this.ball;
    if (b.mode === 'held' && b.holder) {
      const F = b.holder, d = dist2(F.a.pos.x, F.a.pos.z, bx, bz);
      if (d < 5) return 0;
      return (F.throwing ? 0.2 : RELEASE(F.pos)) + d / THROW[F.pos] + 0.1;
    }
    if (b.mode === 'thrown') {
      const th = b.throw, rem = th.T - th.t;
      if (th.k === k % 4) return rem + 0.1;
      return rem + 0.5 + dist2(th.x1, th.z1, bx, bz) / 90;
    }
    if (b.mode === 'free') {
      const P = this.planInfo; if (!P || !P.chaser || !P.point) return 8;
      const rem = Math.max(0, P.tAbs - this.t);
      return rem + RELEASE(P.chaser.pos) + 0.2 + dist2(P.point.x, P.point.z, bx, bz) / THROW[P.chaser.pos] + 0.1;
    }
    return 0;
  }
  updateRunners(dt) {
    const pl = this.play;
    for (const r of this.runners) {
      if (r.state !== 'alive') continue;
      if (r.delay > 0) { r.delay -= dt; continue; }
      const goal = r.target * 90;
      if (r.s === goal) { r.v = 0; r.a.speed = 0; if (r.a.anim.name === 'run' || r.a.anim.name === 'slide') r.a.play('stand'); continue; }
      const dir = Math.sign(goal - r.s);
      r.v = Math.min(r.vmax, r.v + 17 * dt);
      if (r.lead && dir > 0) { r.s += Math.min(r.lead, goal - r.s - 1); r.lead = 0; }
      else if (dir < 0) r.lead = 0;
      const prev = r.s;
      r.s += dir * r.v * dt;
      if ((dir > 0 && r.s >= goal) || (dir < 0 && r.s <= goal)) r.s = goal;
      // crossing bases forward
      if (dir > 0 && Math.floor(r.s / 90) > Math.floor(prev / 90) || r.s === goal) {
        if (r.s >= 360) { this.score(r); continue; }
      }
      if (r.s === goal) { r.returning = false; const vv = r.v; this.decideRunner(r); r.v = r.target * 90 > r.s ? vv * 0.85 : 0; }
      this.placeRunner(r);
      const [tx, tz] = bxz(Math.min(4, dir > 0 ? Math.floor(r.s / 90) + 1 : Math.ceil(r.s / 90) - 1));
      r.a.faceToward(tx, tz, dt, 14);
      r.a.speed = r.v;
      // slide into a contested base
      const remain = Math.abs(goal - r.s);
      const contested = (this.ball.mode === 'thrown' && this.ball.throw.k === r.target % 4) || (this.ball.mode === 'held' && this.ball.holder && dist2(this.ball.holder.a.pos.x, this.ball.holder.a.pos.z, ...bxz(r.target)) < 12);
      if (remain < 9 && contested && dir > 0 && !pl?.award) r.a.play('slide'); else r.a.play('run');
    }
  }
  score(r) {
    r.state = 'scored'; r.s = 360; this.placeRunner(r);
    if (this.outs >= 3) return;
    const off = this.offense;
    off.runs++; off.line[this.inning - 1] = (off.line[this.inning - 1] || 0) + 1;
    this.boxOf(r.p).R++; this.pboxOf(this.pitcherEnt.p).R++;
    this.play?.runs.push(r);
    this.ui.banner?.('RUN SCORES!', 'run', 900); this.react(this.offense.gs, 0.7);
    r.a.play('celebrate'); r.a.baseY = 0;
    this.after(1.2, () => this.hide(r.a));
    this.refresh();
    // walk-off
    if (this.half === 1 && this.inning >= this.cfg.innings && this.teams[1].runs > this.teams[0].runs) this.play && (this.play.walkoff = true);
  }
  moveFielder(f, dt) {
    if (f.stun > 0) f.stun -= dt;
    const a = f.a;
    if (f.throwing) { a.pos.y = groundY(a.pos.x, a.pos.z); return; }
    let goal = f.goal;
    if (this.phase === 'dead' && !goal) { const [x, z] = this.spotFor(f); goal = { x, z }; }
    const sinceContact = this.play ? this.t - this.play.startT : 9;
    if (this.phase === 'live' && sinceContact < f.react && !this.play?.award) goal = null;
    if (goal) {
      const dx = goal.x - a.pos.x, dz = goal.z - a.pos.z, d = Math.hypot(dx, dz);
      if (d > 0.4) {
        const max = this.phase === 'dead' ? 16 : f.spd;
        f.v = Math.min(max, f.v + 28 * dt, d / dt * 0.9);
        a.pos.x += dx / d * f.v * dt; a.pos.z += dz / d * f.v * dt;
        a.face(dx, dz, dt, 12); a.speed = f.v;
        if (f.v > 2) a.play('run'); else if (a.anim.name === 'run') a.play('ready');
      } else {
        f.v = 0; a.speed = 0;
        if (a.anim.name === 'run') a.play(f.pos === 'C' && this.phase !== 'live' ? 'catcher' : 'ready');
        if (f.carry && f.carryTo != null) {
          f.carry = false; const k = f.carryTo; f.carryTo = null;
          this.applyRules(f); if (this.phase === 'live' && this.ball.holder === f) this.afterPossession(f, 0.15);
        }
        if (this.phase === 'dead' && f.pos === 'C') { a.root.rotation.y = Math.PI; a.play('catcher'); }
        else if (this.ball.pos) a.faceToward(this.ball.pos.x, this.ball.pos.z, dt, 6);
      }
    } else if (this.ball.pos && this.phase === 'live') a.faceToward(this.ball.pos.x, this.ball.pos.z, dt, 6);
    a.pos.y = groundY(a.pos.x, a.pos.z);
  }
  // ---------- end of play ----------
  endPlay(timeout) {
    if (this.phase !== 'live') return;
    if (this.derby) return this.derbyOut('In play');
    const pl = this.play; this.phase = 'dead';
    if (this.hrSkip) { this.hrSkip = false; this.setFast(false); }
    this.awaitHuman = null; this.ui.throwControls?.(null);
    for (const r of this.runners) if (r.state === 'alive' && r.s % 90) { r.s = (r.s - Math.floor(r.s / 90) * 90 > 60 && r.target * 90 > r.s ? Math.ceil(r.s / 90) : Math.floor(r.s / 90)) * 90; if (r.s >= 360) r.s = 270; }
    // one runner per base: anyone who'd land on an occupied base drops back one
    const onb = this.runners.filter(r => r.state === 'alive').sort((a, b) => b.s - a.s || b.orig - a.orig);
    for (let i = 1; i < onb.length; i++) if (onb[i].s >= onb[i - 1].s) onb[i].s = onb[i - 1].s - 90;
    for (const r of onb) { if (r.s < 90) { r.state = 'out'; this.hide(r.a); } else this.placeRunner(r); }
    for (const r of this.runners) if (r.state === 'alive') { r.target = r.s / 90; r.forcedTo = null; r.returning = false; r.orig = r.s / 90; }
    for (const f of this.fielders) { f.goal = null; f.chase = false; f.carry = false; f.throwing = null; f.cover = null; }
    if (!pl.walk) this.summarize(pl);
    this.runners = this.runners.filter(r => r.state === 'alive');
    this.refresh();
    if (pl.walk) { this.afterPlay(0.6); return; }
    this.afterPlay(pl.hr ? 3.4 : 1.8);
  }
  summarize(pl) {
    const br = pl.batterRunner, p = br.p, bx = this.boxOf(p), px = this.pboxOf(this.pitcherEnt.p);
    const res = pl.res; const runs = pl.runs.length;
    const dir = fieldDir(res.spray, pl.maxDist);
    const by = pl.fieldedBy ? POSWORD[pl.fieldedBy.pos] : null;
    let text, hit = 0;
    const la = res.la;
    if (pl.batterOut) {
      const sac = pl.caught && runs > 0;
      if (!sac) bx.AB++;
      if (pl.caught) text = `${p.name} ${la > 50 ? 'pops out' : la < 12 ? 'lines out' : 'flies out'}${by ? ' to ' + by : ''}${sac ? ' — sacrifice fly!' : '.'}`;
      else text = `${p.name} ${res.bunt ? 'bunts' : 'grounds'} out${by ? ' to ' + by : ''}.`;
      if (pl.outsOnPlay >= 2) text = `${p.name} hits into a double play!`;
    } else if (br.state === 'alive' || br.state === 'scored') {
      const bases = br.state === 'scored' ? 4 : br.s / 90;
      bx.AB++;
      if (pl.hr) { hit = 4; text = `${p.name} HOMERS${dir ? ' to ' + dir : ''}! (${pl.hrDist} ft)`; }
      else if (pl.forceOuts > 0 && bases === 1) text = `${p.name} reaches on a fielder's choice.`;
      else if (pl.error && !pl.fieldedBy) { hit = bases; }
      else if (pl.error && bases <= 1) text = `${p.name} reaches on an error.`;
      else hit = Math.max(1, Math.min(4, pl.gr2 ? 2 : bases));
      if (hit && !text) {
        const words = { 1: 'singles', 2: 'doubles', 3: 'triples', 4: 'circles the bases — inside-the-park home run' };
        text = `${p.name} ${words[hit]}${dir ? ' to ' + dir : res.bunt ? ' on a bunt' : ''}!`;
      }
    } else text = `${p.name} is out.`;
    if (hit) { bx.H++; this.offense.hits++; px.H++; if (hit === 2) bx['2B']++; if (hit === 3) bx['3B']++; if (hit === 4) bx.HR++; }
    if (runs && !(pl.outsOnPlay >= 2 && !hit)) bx.RBI += runs;
    if (runs) text += ` ${runs} run${runs > 1 ? 's' : ''} score${runs > 1 ? '' : 's'}!`;
    pl.hit = hit;
    this.ui.ticker?.(text);
    if (hit && !pl.hr) { this.ui.banner?.({ 1: 'SINGLE!', 2: 'DOUBLE!', 3: 'TRIPLE!', 4: 'INSIDE-THE-PARK HR!' }[hit], 'safe', 1400); this.react(this.offense.gs, 0.5 + hit * 0.15); }
  }
  afterPlay(delay) {
    this.camMode = this.camMode === 'follow' ? 'follow' : this.camMode;
    this.after(delay, () => {
      if (this.checkGameOver()) return;
      if (this.outs >= 3) return this.endHalf();
      this.resetFielders(true);
      this.ball.mode = 'none'; this.tracer = [];
      this.camMode = this.isHumanPitch() ? 'pitch' : 'bat';
      this.startAtBat();
    });
  }
  checkGameOver(endOfHalf) {
    const [away, home] = this.teams, n = this.cfg.innings;
    if (this.derby) return false;
    // walk-off
    if (this.half === 1 && this.inning >= n && home.runs > away.runs) { this.gameOver(); return true; }
    if (endOfHalf) {
      if (this.half === 0 && this.inning >= n && home.runs > away.runs) { this.gameOver(); return true; }
      if (this.half === 1 && this.inning >= n && home.runs !== away.runs) { this.gameOver(); return true; }
      if (this.half === 1 && this.inning >= n + 3) { this.gameOver(); return true; }
    }
    return false;
  }
  endHalf() {
    this.ui.banner?.('THREE OUTS', 'out', 1400);
    if (this.checkGameOver(true)) return;
    this.runners = [];
    this.after(1.6, () => {
      if (this.half === 0) this.half = 1; else { this.half = 0; this.inning++; }
      this.ui.halfBanner?.(this.half ? 'BOTTOM' : 'TOP', this.inning, this.offense);
      this.setupHalf(false);
    });
  }
  gameOver() {
    this.phase = 'over'; this.clearTimers();
    this.ui.batControls?.(false); this.ui.pitchControls?.(false); this.ui.skip?.(false);
    const gsT = this.teams.find(t => t.gs), rvT = this.teams.find(t => !t.gs);
    this.react(gsT.runs >= rvT.runs, 1.1);
    this.ui.gameOver?.(this.summary());
  }
  summary() {
    return { teams: this.teams.map(t => ({ abbr: t.abbr, name: t.name, runs: t.runs, hits: t.hits, errors: t.errors, line: t.line.slice(), gs: t.gs })), innings: Math.max(this.cfg.innings, this.inning), box: Object.values(this.box), pbox: Object.values(this.pbox) };
  }
  // ---------- derby ----------
  derbyOut(why) {
    if (this.phase === 'over') return;
    this.phase = 'dead'; this.ball.mode = this.ball.mode === 'held' ? 'held' : this.ball.mode;
    this.derby.outs++; this.derby.last = null;
    this.ui.derby?.(this.derby);
    this.ui.banner?.(`OUT ${this.derby.outs}`, 'out', 900);
    this.after(1.6, () => this.derbyNext());
  }
  derbyNext() {
    if (this.derby.outs >= this.derby.maxOuts) { this.phase = 'over'; this.ui.derbyOver?.(this.derby); return; }
    this.runners = []; this.ball.mode = 'none'; this.tracer = [];
    for (const r of this.actors.values()) if (r === this.batter.a) this.hide(r);
    this.offense.idx = 0;
    this.resetFielders(true);
    this.startAtBat();
  }
  // ---------- misc ----------
  tracerPush(p) { if (!p) return; if (this.tracer.length > 400) return; this.tracer.push(p.x, p.y, p.z); }
  refresh() {
    const off = this.offense, def = this.defense;
    const bases = [1, 2, 3].map(k => !!this.runnerOn(k));
    this.ui.hud?.({ teams: this.teams, inning: this.inning, half: this.half, outs: this.outs, balls: this.balls, strikes: this.strikes, bases, offense: off, defense: def, batter: this.batter?.p, pitcher: this.pitcherEnt?.p, derby: this.derby, innings: this.cfg.innings });
  }
}
import * as THREE from './vendor/three.module.min.js';
const _tmpV = new THREE.Vector3();
