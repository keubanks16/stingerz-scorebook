// In-game HUD (scorebug, banners, controls). The engine calls these.
import { avg } from './data.js';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
let bannerT = 0, pitchT = 0, contactT = 0, swingT = 0;

export function createHUD(api) {
  const ui = {
    meter: null,
    hud(s) {
      const [away, home] = s.teams;
      const set = (el, t, batting) => { el.querySelector('i').style.background = t.ui; el.querySelector('b').textContent = t.abbr; el.querySelector('span').textContent = t.runs; el.classList.toggle('bat', batting); };
      set($('#bugAway'), away, s.half === 0); set($('#bugHome'), home, s.half === 1);
      $('#bugInn').textContent = (s.half ? '▼' : '▲') + s.inning;
      $('#bugBS').textContent = `${s.balls}-${s.strikes}`;
      $$('#bugOuts i').forEach((e, i) => e.classList.toggle('on', i < s.outs));
      ['b1', 'b2', 'b3'].forEach((id, i) => document.getElementById(id).classList.toggle('on', s.bases[i]));
      $('#bug').classList.toggle('hidden', !!s.derby); $('#derbyBug').classList.toggle('hidden', !s.derby);
      if (s.derby) ui.derby(s.derby);
      api.scoreboard?.(s);
    },
    banner(text, kind = 'strike', ms = 1300) {
      const b = $('#banner'); b.className = ''; void b.offsetWidth; b.textContent = text; b.className = 'show k-' + kind;
      clearTimeout(bannerT); bannerT = setTimeout(() => b.className = 'k-' + kind, ms);
    },
    ticker(text) { $('#ticker').textContent = text || ''; },
    pitchInfo(text) { const e = $('#pitchInfo'); e.textContent = text; e.classList.add('show'); clearTimeout(pitchT); pitchT = setTimeout(() => e.classList.remove('show'), 2600); },
    contact({ ev, la, dist }) {
      const e = $('#contactInfo');
      e.innerHTML = `<div><b>${Math.round(ev)}</b><span>EXIT MPH</span></div><div><b>${Math.round(la)}°</b><span>LAUNCH</span></div>` + (dist ? `<div><b>${dist}</b><span>FEET</span></div>` : '');
      e.classList.add('show'); clearTimeout(contactT); contactT = setTimeout(() => e.classList.remove('show'), 4200);
    },
    swingInfo(text, err) {
      const e = $('#swingInfo'); e.textContent = `${text} by ${Math.round(err * 1000)} ms`; e.classList.add('show');
      clearTimeout(swingT); swingT = setTimeout(() => e.classList.remove('show'), 1400);
    },
    batterCard(p, box) {
      const c = $('#batterCard'); c.classList.toggle('me', !!p.me);
      c.querySelector('.bcNum').textContent = p.num; c.querySelector('.bcName').textContent = p.name.toUpperCase();
      const line = box.AB || box.BB ? `${box.H}-${box.AB} TODAY${box.HR ? ` · ${box.HR} HR` : ''}${box.RBI ? ` · ${box.RBI} RBI` : ''}` : (p.gs ? api.seasonLine(p) : (p.bats === 'L' ? 'BATS LEFT' : 'BATS RIGHT'));
      c.querySelector('.bcLine').textContent = line;
    },
    batControls(show) {
      $('#batBtns').classList.toggle('hidden', !show);
      $('#powerBtn').classList.remove('on'); $('#buntBtn').classList.remove('on');
      $('#batterCard').classList.toggle('hidden', false);
    },
    pitchControls(show) { $('#pitchUI').classList.toggle('hidden', !show); if (!show) ui.stopMeter(); },
    throwControls(opts) {
      const t = $('#throwUI');
      if (!opts) { t.classList.add('hidden'); return; }
      t.classList.remove('hidden');
      $$('#throwUI .tb').forEach(b => { b.classList.toggle('rec', String(opts.rec) === b.dataset.b); b.onclick = (e) => { e.stopPropagation(); opts.onPick(b.dataset.b === 'hold' ? null : +b.dataset.b); }; });
    },
    skip(show) { $('#skipBtn').classList.toggle('hidden', !show); },
    derby(d) { $('#dHR').textContent = d.hr; $('#dOuts').textContent = Math.max(0, d.maxOuts - d.outs); $('#dLong').textContent = d.longest ? d.longest + "'" : '—'; },
    halfBanner(half, inning, team) { ui.banner(`${half} ${inning} · ${team.abbr} UP`, 'ball', 1500); },
    gameOver(sum) { api.gameOver(sum); },
    derbyOver(d) { api.derbyOver(d); },
    // ----- pitch meter -----
    startMeter(screenPos, speed, done) {
      const m = $('#meter'); m.classList.remove('hidden'); m.style.left = screenPos.x + 'px'; m.style.top = screenPos.y + 'px';
      const ring = $('#meterRing'); const t0 = performance.now(); const dur = speed * 1000;
      const R0 = 130, core = 17;
      ui.meter = { done, r: R0 };
      const tick = () => {
        if (!ui.meter) return;
        const k = (performance.now() - t0) / dur; const r = R0 * (1 - k);
        ui.meter.r = r;
        ring.style.width = ring.style.height = Math.max(0, r * 2) + 'px';
        if (r <= -12) { ui.tapMeter(); return; }
        requestAnimationFrame(tick);
      };
      tick();
    },
    tapMeter() {
      if (!ui.meter) return false;
      const err = Math.min(1, Math.abs(ui.meter.r - 17) / 70);
      const done = ui.meter.done; ui.stopMeter();
      ui.banner(err < 0.12 ? 'PERFECT!' : err < 0.35 ? 'GOOD' : 'WILD', err < 0.12 ? 'safe' : err < 0.35 ? 'ball' : 'out', 600);
      done(err); return true;
    },
    stopMeter() { ui.meter = null; $('#meter').classList.add('hidden'); },
  };
  $('#powerBtn').addEventListener('pointerdown', e => { e.stopPropagation(); const on = !$('#powerBtn').classList.contains('on'); $('#powerBtn').classList.toggle('on', on); $('#buntBtn').classList.remove('on'); api.setSwingMode(on ? 'power' : null); });
  $('#buntBtn').addEventListener('pointerdown', e => { e.stopPropagation(); const on = !$('#buntBtn').classList.contains('on'); $('#buntBtn').classList.toggle('on', on); $('#powerBtn').classList.remove('on'); api.setSwingMode(on ? 'bunt' : null); });
  $$('#pitchUI .prow button').forEach(b => b.addEventListener('pointerdown', e => { e.stopPropagation(); api.choosePitch(b.dataset.p); }));
  return ui;
}
export { avg };
