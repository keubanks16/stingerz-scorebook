import * as THREE from './vendor/three.module.min.js';
import { buildStadium } from './field.js';
import { Player3D, makeBall } from './player.js';
import * as PH from './physics.js';
import { Game } from './engine.js';
import { createHUD } from './ui.js';
import * as D from './data.js';
import { ready as assetsReady } from './assets.js';
await assetsReady;
import { sfx, unlock, setSound, setAnnouncer, setMusic, music, SONGS, audioState } from './audio.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const S = D.load();

// ---------- renderer / scene ----------
const canvas = $('#c');
const lowPower = /iPhone|iPad|Android/i.test(navigator.userAgent);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowPower ? 1.75 : 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcfe0ee, 650, 1800);
const camera = new THREE.PerspectiveCamera(34, 1, 0.5, 4200);
scene.add(new THREE.HemisphereLight(0xd5e9ff, 0x4a6b3a, 1.15));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.3);
sun.castShadow = true; sun.shadow.mapSize.set(lowPower ? 1024 : 2048, lowPower ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 10, far: 600 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
scene.add(sun); scene.add(sun.target);
const stadium = buildStadium(scene, renderer);
const { ball: ballMesh, shadow: ballShadow } = makeBall(scene);

// strike zone + aim reticle
const zone = PH.zoneOf();
const zoneGroup = new THREE.Group(); scene.add(zoneGroup);
{
  const m = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false });
  const x0 = -0.83, x1 = 0.83, y0 = zone.y0, y1 = zone.y1, pts = [];
  pts.push(x0, y0, 0, x1, y0, 0, x1, y0, 0, x1, y1, 0, x1, y1, 0, x0, y1, 0, x0, y1, 0, x0, y0, 0);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const box = new THREE.LineSegments(g, m); box.renderOrder = 5; zoneGroup.add(box);
  const gp = []; for (let i = 1; i < 3; i++) { const x = x0 + (x1 - x0) * i / 3, y = y0 + (y1 - y0) * i / 3; gp.push(x, y0, 0, x, y1, 0, x0, y, 0, x1, y, 0); }
  const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3));
  const grid = new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthTest: false })); grid.renderOrder = 5; zoneGroup.add(grid); zoneGroup.userData.grid = grid;
}
const reticle = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.22, 32), new THREE.MeshBasicMaterial({ color: 0xffd34d, depthTest: false, transparent: true }));
reticle.renderOrder = 6; scene.add(reticle); reticle.visible = false;
// hit tracer
const TR_MAX = 400;
const trGeo = new THREE.BufferGeometry(); trGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TR_MAX * 3), 3));
const tracer = new THREE.Line(trGeo, new THREE.LineBasicMaterial({ color: 0x70bdf5, transparent: true, opacity: 0.85 }));
tracer.frustumCulled = false; scene.add(tracer);

// ---------- camera control ----------
const cam = { pos: new THREE.Vector3(0, 60, 120), look: new THREE.Vector3(0, 0, -150), mode: 'menu', t: 0 };
function fovFor(v, h) { const a = camera.aspect; return Math.max(v, 2 * Math.atan(Math.tan(h * Math.PI / 360) / a) * 180 / Math.PI); }
function camTargets(dt) {
  const g = game;
  if (cam.mode === 'menu') {
    cam.t += dt * 0.05;
    const a = cam.t;
    return { pos: new THREE.Vector3(Math.sin(a) * 210, 70 + Math.sin(a * 0.7) * 15, -150 + Math.cos(a) * 260), look: new THREE.Vector3(0, 0, -130), fov: fovFor(40, 60), snap: false, rate: 1.5 };
  }
  if (cam.mode === 'card') { const wide = camera.aspect > 1.2; return { pos: new THREE.Vector3(-1.8, 3.4, 15.5), look: new THREE.Vector3(wide ? -5.6 : -1.8, wide ? 2.8 : 1.2, 0), fov: fovFor(30, 40), snap: true }; }
  if (!g) return null;
  const m = g.camMode;
  const portrait = camera.aspect < 1;
  if (m === 'bat') return { pos: new THREE.Vector3(0, 10.5, 15), look: new THREE.Vector3(0, -1.4, -24), fov: fovFor(36, 44), snap: true };
  if (m === 'pitch') return { pos: new THREE.Vector3(2.4, 7.6, -67), look: new THREE.Vector3(0, 1.6, 0), fov: fovFor(13, 22), snap: true };
  // follow the ball
  const bp = g.ball.pos || { x: 0, y: 0, z: -60 };
  const f = new THREE.Vector3(bp.x, Math.max(0, bp.y) * 0.4, bp.z);
  const P = g.planInfo;
  if (g.ball.mode === 'free' && P && P.point && g.ball.b && !g.ball.b.touched) { f.x += (P.point.x - f.x) * 0.55; f.z += (P.point.z - f.z) * 0.55; }
  const d = Math.hypot(f.x, f.z);
  const k = Math.min(1, d / 330);
  const pos = new THREE.Vector3(f.x * (0.4 + 0.2 * k), 36 + 30 * k + f.y * 0.6, 62 + f.z * (0.4 + 0.15 * k));
  const look = new THREE.Vector3(f.x, f.y, f.z);
  return { pos, look, fov: fovFor(38, 52), rate: 3.2 };
}
let lastMode = '';
function updateCamera(dt) {
  const T = camTargets(dt); if (!T) return;
  const modeKey = cam.mode === 'game' ? game.camMode + (game.camMode === 'bat' ? game.batter?.p.id : '') : cam.mode;
  const snap = T.snap && modeKey !== lastMode; lastMode = modeKey;
  if (snap || T.snap) { cam.pos.copy(T.pos); cam.look.copy(T.look); }
  else { const r = 1 - Math.exp(-(T.rate || 3) * dt); cam.pos.lerp(T.pos, r); cam.look.lerp(T.look, r); }
  camera.position.copy(cam.pos); camera.lookAt(cam.look);
  if (Math.abs(camera.fov - T.fov) > 0.01) { camera.fov += (T.fov - camera.fov) * (snap || T.snap ? 1 : Math.min(1, dt * 3)); camera.updateProjectionMatrix(); }
  // shadows follow the action
  const fx = cam.mode === 'game' ? cam.look.x : 0, fz = cam.mode === 'game' ? cam.look.z : -60;
  sun.position.set(fx - 90, 170, fz + 70); sun.target.position.set(fx, 0, fz);
}
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  const portrait = h > w && w < 820;
  $('#rotate').classList.toggle('hidden', !(portrait && cam.mode === 'game' && !rotateOk));
}
let rotateOk = false;
addEventListener('resize', resize); addEventListener('orientationchange', () => setTimeout(resize, 200));

// ---------- HUD ----------
let game = null, paused = false, swingMode = null, lastCfg = null;
const hud = createHUD({
  scoreboard(s) {
    const [a, h] = s.teams;
    stadium.drawScoreboard({ status: s.derby ? 'HR DERBY' : `${s.half ? 'BOT' : 'TOP'} ${s.inning}`, innings: s.innings, teams: [a, h].map(t => ({ abbr: t.abbr, line: t.line, r: t.runs, h: t.hits, e: t.errors })), batter: s.batter ? `#${s.batter.num} ${s.batter.name.toUpperCase()}` : '', count: s.derby ? `HR ${s.derby.hr}  OUTS ${s.derby.outs}` : `B ${s.balls}  S ${s.strikes}  O ${s.outs}` });
  },
  seasonLine(p) { const t = S.stats[p.id]; return t && t.AB ? `SEASON ${D.avg(t.H, t.AB)} · ${t.HR || 0} HR · ${t.RBI || 0} RBI` : 'FIRST GAME'; },
  setSwingMode(m) { swingMode = m; if (game) { game.power = m === 'power'; game.bunting = m === 'bunt'; if (game.batter && game.phase === 'prepitch') game.batter.a.play(m === 'bunt' ? 'bunt' : 'stance', { restart: true }); } sfx.click(); },
  choosePitch(type) {
    if (!game || game.phase !== 'prepitch' || hud.meter) return;
    sfx.click();
    const p = new THREE.Vector3(game.pitchAim.x, game.pitchAim.y, 0).project(camera);
    const sp = { x: (p.x + 1) / 2 * innerWidth, y: (1 - p.y) / 2 * innerHeight };
    $('#pitchUI').classList.add('hidden');
    hud.startMeter(sp, [1.25, 1.0, 0.85][S.settings.difficulty], err => game.humanPitch(type, err));
    pendingPitch = type;
  },
  gameOver(sum) { showGameOver(sum); },
  derbyOver(d) { showDerbyOver(d); },
});
let pendingPitch = null;

// ---------- input on the field ----------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function planePoint(e, z) {
  ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const o = ray.ray.origin, d = ray.ray.direction; const t = (z - o.z) / d.z;
  return t > 0 ? { x: o.x + d.x * t, y: o.y + d.y * t } : null;
}
$('#stage').addEventListener('pointerdown', e => {
  unlock();
  if (!game || paused) return;
  if (hud.meter) { hud.tapMeter(); return; }
  if (game.play && game.play.award && game.phase === 'live' && !game.play.walk) { game.setFast(true); game.hrSkip = true; return; }
  if (game.isHumanBat() && (game.phase === 'pitch' || game.phase === 'windup')) {
    const aim = planePoint(e, PH.CONTACT_Z);
    if (game.humanSwing(aim)) sfx.whoosh();
    return;
  }
  if (game.phase === 'prepitch' && game.isHumanPitch()) { const p = planePoint(e, 0); if (p) { game.setPitchAim(p); sfx.click(); } }
});
addEventListener('keydown', e => {
  if (!game || paused) return;
  if (e.code === 'Space') { e.preventDefault(); if (hud.meter) hud.tapMeter(); else if (game.isHumanBat()) game.humanSwing(null); }
});
$('#skipBtn').addEventListener('click', e => { e.stopPropagation(); if (game) { game.setFast(!game.fast); $('#skipBtn').textContent = game.fast ? '▶ NORMAL' : '⏩ SKIP'; } });
$('#pauseBtn').addEventListener('click', e => { e.stopPropagation(); pause(true); });
$('#resumeBtn').addEventListener('click', () => pause(false));
$('#quitBtn').addEventListener('click', () => { quitGame(); go('menu'); });
$('#rotateOk').addEventListener('click', () => { rotateOk = true; resize(); });
function pause(on) { paused = on; screen(on ? 'sPause' : null); if (!on) $('#hud').classList.remove('hidden'); }

// ---------- screens / menus ----------
let screenStack = [];
function screen(id) {
  $$('.screen').forEach(s => s.classList.toggle('show', s.id === id));
  if (id) screenStack.push(id);
}
function back() { screenStack.pop(); const prev = screenStack.pop() || (game ? 'sPause' : 'sMenu'); screen(prev); if (prev !== 'sCard') cam.mode = game ? 'game' : 'menu'; }
$$('[data-back]').forEach(b => b.addEventListener('click', () => { sfx.click(); back(); }));
function go(where) {
  sfx.click();
  if (where === 'derby') return startGame(where);
  if (where === 'team' || where === 'me') { openLineup(where); return; }
  if (where === 'pick') { buildRoster(); screen('sPick'); cam.mode = 'menu'; return; }
  if (where === 'card') { openCard(); return; }
  if (where === 'settings') { syncSettings(); screen('sSettings'); return; }
  if (where === 'stats') { buildStats(); screen('sStats'); return; }
  if (where === 'help') { screen('sHelp'); return; }
  if (where === 'install') { screen('sInstall'); return; }
  if (where === 'menu') { buildMenu(); screen('sMenu'); cam.mode = 'menu'; previewOff(); if (S.settings.music) music.menu(); return; }
}
$$('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));
$('#tStart').addEventListener('click', () => { unlock(); applySettings(); if (S.settings.music) music.menu(); go(S.me ? 'menu' : 'pick'); });

function buildRoster() {
  const r = $('#roster'); r.innerHTML = '';
  for (const p of D.GS_ROSTER) {
    const c = D.card(p.id);
    const b = document.createElement('button'); if (S.me === p.id) b.classList.add('sel');
    b.innerHTML = `<div class="n">${p.num}</div><div><div class="nm">${p.name}</div><div class="ps">${D.POS_NAMES[c.pos] || c.pos}</div></div>`;
    b.onclick = () => { sfx.click(); S.me = p.id; D.save(); openCard(true); };
    r.appendChild(b);
  }
}
let cardFirst = false, preview = null;
function openCard(first) {
  cardFirst = !!first;
  const p = D.gsPlayer(S.me); if (!p) return go('pick');
  $('#cardTitle').textContent = `#${p.num} ${p.name.toUpperCase()}`;
  const c = D.card(S.me);
  const segs = $$('#sCard .seg');
  const posSeg = $('#sCard .seg[data-k="pos"]'); posSeg.innerHTML = D.POSITIONS.map(x => `<button data-v="${x}">${x}</button>`).join('');
  segs.forEach(seg => seg.querySelectorAll('button').forEach(b => { b.classList.toggle('on', c[seg.dataset.k] === b.dataset.v); b.onclick = () => { sfx.click(); D.setCard(S.me, { [seg.dataset.k]: b.dataset.v }); openCardRefresh(); }; }));
  const sw = (k, list) => { const el = $(`#sCard .sw[data-k="${k}"]`); el.innerHTML = ''; list.forEach(col => { const b = document.createElement('button'); b.style.background = col; b.classList.toggle('on', c[k] === col); b.onclick = () => { sfx.click(); D.setCard(S.me, { [k]: col }); openCardRefresh(); }; el.appendChild(b); }); };
  sw('skin', D.SKINS); sw('hair', D.HAIRS);
  const sp = $('#songPick'); sp.innerHTML = '';
  [{ id: '', title: 'No song' }, ...SONGS].forEach(s => {
    const b = document.createElement('button'); b.className = 'song' + ((c.walkup || '') === s.id ? ' on' : '');
    b.innerHTML = `<span>${s.id ? '🎵 ' : ''}${s.title}</span>${s.id ? '<i>▶ PLAY</i>' : ''}`;
    b.onclick = (e) => { sfx.click(); D.setCard(S.me, { walkup: s.id }); if (s.id) music.preview(s.id); else music.stop(); openCardRefresh(); };
    sp.appendChild(b);
  });
  screen('sCard'); cam.mode = 'card';
  showPreview(p);
}
function openCardRefresh() { const keep = cardFirst; openCard(keep); screenStack.pop(); }
$('#cardDone').addEventListener('click', () => { sfx.click(); go('menu'); screenStack = ['sMenu']; });
function showPreview(p) {
  previewOff();
  const pl = { ...p, ...D.card(p.id) };
  preview = new Player3D({ name: pl.name, num: pl.num, team: D.TEAMS.GS, skin: pl.skin, hair: pl.hair, bats: pl.bats, throws: pl.throws });
  preview.pos.set(-2.7 * (pl.bats === 'L' ? -1 : 1), 0, 0.2);
  preview.root.rotation.y = pl.bats === 'L' ? -Math.PI / 2 : Math.PI / 2;
  preview.setHeadgear('helmet'); preview.showBat(true); preview.play('stance');
  preview.pos.x = -1.8; preview.root.rotation.y = 0.6 + Math.PI;
  scene.add(preview.root);
}
function previewOff() { if (preview) { scene.remove(preview.root); preview = null; } }
function buildMenu() {
  const p = D.gsPlayer(S.me); if (!p) return;
  $('#meNum').textContent = p.num; $('#meName').textContent = p.name.toUpperCase();
  const t = S.stats[p.id];
  const d = S.derby[p.id];
  $('#meLine').textContent = (t && t.AB ? `${D.avg(t.H, t.AB)} AVG · ${t.HR || 0} HR · ${t.RBI || 0} RBI` : `${D.POS_NAMES[p.pos]} · Bats ${p.bats === 'L' ? 'Left' : 'Right'}`) + (d ? ` · Derby best ${d.best}` : '');
}
function syncSettings() {
  $$('#sSettings .seg').forEach(seg => {
    const k = seg.dataset.s;
    seg.querySelectorAll('button').forEach(b => {
      b.classList.toggle('on', String(S.settings[k]) === b.dataset.v);
      b.onclick = () => { sfx.click(); let v = b.dataset.v; v = v === 'true' ? true : v === 'false' ? false : /^\d+$/.test(v) ? +v : v; S.settings[k] = v; D.save(); applySettings(); syncSettings(); };
    });
  });
}
function applySettings() {
  if (S.settings.music === undefined) S.settings.music = true;
  setSound(S.settings.sound); setAnnouncer(S.settings.announcer); setMusic(S.settings.music && S.settings.sound);
}
function buildStats() {
  const rows = D.GS_ROSTER.map(p => ({ p, t: S.stats[p.id] || {}, d: S.derby[p.id] }));
  const head = ['PLAYER', 'G', 'AB', 'H', 'AVG', '2B', '3B', 'HR', 'RBI', 'R', 'BB', 'K', 'SB', 'DERBY'];
  $('#statsTable').innerHTML = `<tr>${head.map(h => `<th>${h}</th>`).join('')}</tr>` + rows.map(({ p, t, d }) =>
    `<tr class="${p.id === S.me ? 'mine' : ''}"><td>#${p.num} ${p.name}</td><td>${t.G || 0}</td><td>${t.AB || 0}</td><td>${t.H || 0}</td><td>${D.avg(t.H || 0, t.AB || 0)}</td><td>${t['2B'] || 0}</td><td>${t['3B'] || 0}</td><td>${t.HR || 0}</td><td>${t.RBI || 0}</td><td>${t.R || 0}</td><td>${t.BB || 0}</td><td>${t.K || 0}</td><td>${t.SB || 0}</td><td>${d ? d.best + ' HR' : '—'}</td></tr>`).join('');
}

// ---------- base coach: send / hold runners, steals ----------
let ruSig = '';
function renderRun(force) {
  const rc = game && !paused ? game.runControl() : null;
  const box = $('#runUI');
  if (!rc) { if (!box.classList.contains('hidden')) { box.classList.add('hidden'); ruSig = ''; } return; }
  const sig = rc.mode + '|' + rc.runners.map(r => [r.id, r.at, r.to, r.back, r.steal, r.canSteal, r.forced].join(',')).join(';');
  if (!force && sig === ruSig) return;
  ruSig = sig; box.classList.remove('hidden');
  $('#ruHint').textContent = rc.mode === 'steal' ? 'tap STEAL before the pitch' : rc.mode === 'going' ? 'they\'re running!' : 'send or hold';
  $('#ruList').innerHTML = rc.runners.map(r => {
    const where = r.at ? `on <b>${r.at}</b>` : r.back ? `back to <b>${r.to}</b>` : `running to <b>${r.to}</b>`;
    if (rc.mode === 'steal' || rc.mode === 'going') {
      const nextB = { '1B': '2ND', '2B': '3RD' }[r.at] || '';
      return `<div class="ruRow"><span class="who">#${r.num} ${r.name}<em>${where}</em></span><span></span>${r.canSteal || r.steal ? `<button class="steal${r.steal ? ' on' : ''}" data-r="steal" data-id="${r.id}" ${rc.mode === 'going' ? 'disabled' : ''}>${r.steal ? (rc.mode === 'going' ? 'STEALING!' : 'STEALING ✓') : 'STEAL ' + nextB}</button>` : '<span></span>'}</div>`;
    }
    return `<div class="ruRow"><span class="who">#${r.num} ${r.name}<em>${where}${r.forced ? ' · forced' : ''}</em></span><button class="back" data-r="back" data-id="${r.id}" ${r.forced || !r.to || r.back ? 'disabled' : ''}>◀</button><button class="go" data-r="go" data-id="${r.id}">GO ▶</button></div>`;
  }).join('');
  $('#ruAll').classList.toggle('hidden', rc.mode !== 'live' || rc.runners.length < 2);
}
hud.runControls = () => renderRun(true);
$('#runUI').addEventListener('pointerdown', e => {
  e.stopPropagation();
  const b = e.target.closest('button'); if (!b || b.disabled || !game) return;
  const a = b.dataset.r, id = b.dataset.id;
  let ok = false;
  if (a === 'go') ok = game.runnerGo(id);
  if (a === 'back') ok = game.runnerBack(id);
  if (a === 'steal') ok = game.runnerSteal(id);
  if (a === 'allgo' || a === 'allback') {
    const rc = game.runControl(); if (rc) for (const r of rc.runners) ok = (a === 'allgo' ? game.runnerGo(r.id) : game.runnerBack(r.id)) || ok;
  }
  if (ok) sfx.click(); else { b.animate([{ transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'none' }], { duration: 160 }); }
  renderRun(true);
});

// ---------- lineup ----------
// Batting order + positions before Play Ball / My Player. Saved on the device for next time.
let LU = null, luMode = 'team', luOpen = -1, hubLineup = null;
function openLineup(mode) {
  luMode = mode; LU = D.savedLineup(S.me); luOpen = -1;
  renderLineup(); screen('sLineup');
}
// who takes over a position: an extra hitter (one who plays it first), else a bench player
function luReplacement(pos, excludeId) {
  const prefer = list => list.find(x => D.prefPos(x.id) === pos) || list[0];
  const ehs = LU.filter(x => x.pos === 'EH' && x.id !== excludeId);
  if (ehs.length) return prefer(ehs);
  const bench = D.GS_ROSTER.filter(p => p.id !== excludeId && !LU.some(x => x.id === p.id)).map(p => ({ id: p.id }));
  if (!bench.length) return null;
  const e = { id: prefer(bench).id, pos }; LU.push(e); return e;
}
let luNoteT = 0;
function luNote(msg) { const el = $('#luSub'); el.textContent = msg; el.style.color = '#ff9fae'; clearTimeout(luNoteT); luNoteT = setTimeout(() => { el.style.color = ''; renderLineup(); }, 1800); }
function luCommit() { LU = D.fixLineup(LU); D.saveLineup(LU); renderLineup(); }
function renderLineup() {
  if (!LU) return;
  const nm = id => { const p = D.playerName(id); return `<small>#${p.num}</small>${p.name}`; };
  const fielders = LU.filter(e => e.pos !== 'EH').length;
  $('#luSub').textContent = `${LU.length} batters · ${LU.length - fielders} extra hitter${LU.length - fielders === 1 ? '' : 's'} · ${luMode === 'me' ? 'My Player' : 'Play Ball'}`;
  $('#luList').innerHTML = LU.map((e, i) => `
    <div class="luRow${e.id === S.me ? ' mine' : ''}" data-i="${i}">
      <span class="o">${i + 1}</span>
      <span class="nm">${nm(e.id)}${e.id === S.me ? '<i>YOU</i>' : ''}</span>
      <button class="pos${e.pos === 'EH' ? ' eh' : ''}" data-a="pos">${e.pos}</button>
      <button data-a="up" ${i ? '' : 'disabled'} aria-label="Move up">▲</button>
      <button data-a="down" ${i < LU.length - 1 ? '' : 'disabled'} aria-label="Move down">▼</button>
      <button data-a="bench" aria-label="Bench">✕</button>
      ${luOpen === i ? `<div class="luPick">${[...D.POSITIONS, 'EH'].map(p => `<button data-a="set" data-p="${p}" class="${p === e.pos ? 'on' : ''}">${p === 'EH' ? 'BAT ONLY' : p}</button>`).join('')}</div>` : ''}
    </div>`).join('');
  const bench = D.GS_ROSTER.filter(p => !LU.some(e => e.id === p.id));
  $('#luBench').innerHTML = bench.length ? bench.map(p => `<button data-add="${p.id}"><b>+</b>#${p.num} ${p.name}</button>`).join('') : '<span class="none">Everyone is in the lineup.</span>';
  const meIn = LU.some(e => e.id === S.me);
  const w = $('#luWarn');
  if (luMode === 'me' && !meIn) { w.classList.remove('hidden'); w.innerHTML = `<span>You're on the bench. Put yourself in the lineup to play My Player.</span><button id="luMeIn">PUT ME IN</button>`; $('#luMeIn').onclick = () => { sfx.click(); LU.push({ id: S.me, pos: 'EH' }); luCommit(); }; }
  else w.classList.add('hidden');
  $('#luGo').disabled = luMode === 'me' && !meIn; $('#luGo').style.opacity = $('#luGo').disabled ? 0.45 : 1;
  const hb = $('#luHub');
  hb.classList.toggle('hidden', !hubLineup);
  if (hubLineup) hb.textContent = 'USE HUB LINEUP' + (hubLineup.label ? ' · ' + hubLineup.label : '');
}
$('#luList').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const i = +b.closest('.luRow').dataset.i, a = b.dataset.a; sfx.click();
  if (a === 'pos') { luOpen = luOpen === i ? -1 : i; renderLineup(); return; }
  if (a === 'up' && i > 0) { [LU[i - 1], LU[i]] = [LU[i], LU[i - 1]]; luOpen = -1; }
  if (a === 'down' && i < LU.length - 1) { [LU[i + 1], LU[i]] = [LU[i], LU[i + 1]]; luOpen = -1; }
  if (a === 'bench') {
    const e = LU[i];
    if (e.pos !== 'EH') { const rep = luReplacement(e.pos, e.id); if (!rep) { luNote(`No one else can play ${e.pos} — need 9 in the field`); return; } rep.pos = e.pos; }
    LU.splice(LU.indexOf(e), 1); luOpen = -1;
  }
  if (a === 'set') {
    const p = b.dataset.p, e = LU[i], cur = e.pos;
    if (p === cur) { luOpen = -1; renderLineup(); return; }
    if (p === 'EH') {
      // someone has to take his spot in the field: an extra hitter, or a bench player
      const rep = luReplacement(cur, e.id);
      if (!rep) { luNote(`No one else can play ${cur} — need 9 in the field`); return; }
      rep.pos = cur;
    } else {
      const other = LU.find(x => x !== e && x.pos === p);
      if (other) other.pos = cur;        // swap positions (an extra hitter swapping in sends that fielder to bat-only)
    }
    e.pos = p; luOpen = -1;
  }
  luCommit();
});
$('#luBench').addEventListener('click', e => {
  const b = e.target.closest('[data-add]'); if (!b) return; sfx.click();
  LU.push({ id: b.dataset.add, pos: 'EH' }); luCommit();
});
$('#luReset').addEventListener('click', () => { sfx.click(); LU = D.defaultLineup(S.me); luOpen = -1; luCommit(); });
$('#luHub').addEventListener('click', () => { if (!hubLineup) return; sfx.click(); LU = D.lineupFromHub(hubLineup.order); luOpen = -1; luCommit(); luNote('Loaded the Hub lineup' + (hubLineup.label ? ' (' + hubLineup.label + ')' : '')); });
$('#luGo').addEventListener('click', () => { if ($('#luGo').disabled) return; D.saveLineup(D.fixLineup(LU)); startGame(luMode); });

// ---------- game lifecycle ----------
function startGame(mode, extra = {}) {
  if (S.settings.music) music.background(); previewOff();
  quitGame();
  const st = S.settings;
  const lineup = D.lineupPlayers(D.savedLineup(S.me), S.me);
  lineup.forEach(p => p.walkup = D.card(p.id).walkup);
  let cfg = { mode, innings: st.innings, difficulty: st.difficulty, gsHome: mode === 'derby' ? false : st.gsHome, gsLineup: lineup, rivals: D.rivalsLineup(), showZone: st.zone, baserun: st.baserun || 'manual', ...extra };
  if (mode === 'derby') {
    const me = { ...(D.gsPlayer(S.me) || lineup[0]), me: true };
    cfg.gsLineup = Array.from({ length: 9 }, () => me);
    cfg.innings = 99;
  }
  lastCfg = mode;
  game = new Game({ scene, ui: hud }, cfg);
  cam.mode = 'game'; paused = false; swingMode = null;
  screenStack = []; screen(null);
  $('#hud').classList.remove('hidden');
  $('#skipBtn').textContent = '⏩ SKIP';
  hud.ticker(mode === 'derby' ? 'Home Run Derby — anything but a homer is an out!' : '');
  resize();
}
function quitGame() {
  if (!game) return;
  for (const a of game.actors.values()) if (a.root.parent) a.root.parent.remove(a.root);
  if (game.ump.root.parent) game.ump.root.parent.remove(game.ump.root);
  game = null; hud.throwControls(null); hud.pitchControls(false); hud.batControls(false); hud.stopMeter();
  $('#hud').classList.add('hidden'); $('#rotate').classList.add('hidden'); $('#runUI').classList.add('hidden'); ruSig = '';
  ballMesh.visible = false; ballShadow.visible = false; tracer.visible = false; zoneGroup.visible = false; reticle.visible = false;
}
function showGameOver(sum) {
  const gsTeam = sum.teams.find(t => t.gs), rv = sum.teams.find(t => !t.gs);
  const win = gsTeam.runs > rv.runs, tie = gsTeam.runs === rv.runs;
  $('#overTitle').textContent = tie ? `FINAL — TIE ${gsTeam.runs}-${rv.runs}` : win ? `GS WINS ${gsTeam.runs}-${rv.runs}!` : `FINAL: ${rv.abbr} ${rv.runs}, GS ${gsTeam.runs}`;
  if (win) { sfx.organ(); }
  const n = sum.innings;
  $('#lineTable').innerHTML = `<tr><th></th>${Array.from({ length: n }, (_, i) => `<th>${i + 1}</th>`).join('')}<th>R</th><th>H</th><th>E</th></tr>` +
    sum.teams.map((t, ti) => `<tr><td>${t.abbr}</td>${Array.from({ length: n }, (_, i) => `<td>${t.line[i] ?? (ti === 1 && i === n - 1 && t.runs > sum.teams[0].runs ? 'X' : '')}</td>`).join('')}<td class="tot">${t.runs}</td><td>${t.hits}</td><td>${t.errors}</td></tr>`).join('');
  const gsBox = sum.box.filter(b => b.p.gs);
  // save career stats
  const seen = new Set();
  for (const b of gsBox) {
    seen.add(b.p.id);
    D.addStats(b.p.id, { G: 1, AB: b.AB, H: b.H, '2B': b['2B'], '3B': b['3B'], HR: b.HR, RBI: b.RBI, R: b.R, BB: b.BB, K: b.K, SB: b.SB || 0 });
  }
  const score = b => b.H * 2 + b.HR * 4 + b.RBI * 1.5 + b.R + b['2B'] + b['3B'] * 2 + b.BB * 0.5;
  const best = gsBox.slice().sort((a, b) => score(b) - score(a))[0];
  $('#potg').innerHTML = best && score(best) > 0 ? `<small>GS PLAYER OF THE GAME</small>#${best.p.num} ${best.p.name} — ${best.H}-${best.AB}${best.HR ? `, ${best.HR} HR` : ''}${best.RBI ? `, ${best.RBI} RBI` : ''}` : `<small>NEXT GAME</small>Keep swinging — the hits will come!`;
  $('#potg').classList.remove('hidden');
  const head = ['GS BATTING', 'AB', 'R', 'H', '2B', '3B', 'HR', 'RBI', 'BB', 'K'];
  $('#boxTable').innerHTML = `<tr>${head.map(h => `<th>${h}</th>`).join('')}</tr>` + gsBox.map(b => `<tr class="${b.p.me ? 'mine' : ''}"><td>#${b.p.num} ${b.p.name}</td><td>${b.AB}</td><td>${b.R}</td><td>${b.H}</td><td>${b['2B']}</td><td>${b['3B']}</td><td>${b.HR}</td><td>${b.RBI}</td><td>${b.BB}</td><td>${b.K}</td></tr>`).join('');
  setTimeout(() => { $('#hud').classList.add('hidden'); screen('sOver'); }, 2200);
}
function showDerbyOver(d) {
  const p = D.gsPlayer(S.me);
  const rec = D.recordDerby(S.me, d.hr, d.longest);
  $('#overTitle').textContent = `${d.hr} HOME RUN${d.hr === 1 ? '' : 'S'}!`;
  $('#lineTable').innerHTML = `<tr><th>HOME RUNS</th><th>LONGEST</th><th>PERSONAL BEST</th></tr><tr><td class="tot">${d.hr}</td><td>${d.longest ? d.longest + ' ft' : '—'}</td><td>${rec.best} HR · ${rec.longest} ft</td></tr>`;
  $('#potg').innerHTML = `<small>${d.hr >= rec.best && d.hr > 0 ? 'NEW PERSONAL BEST!' : 'DERBY'}</small>#${p.num} ${p.name}`;
  // derby leaderboard (this device)
  const rows = D.GS_ROSTER.map(x => ({ x, d: S.derby[x.id] })).filter(r => r.d).sort((a, b) => b.d.best - a.d.best || b.d.longest - a.d.longest);
  $('#boxTable').innerHTML = `<tr><th>DERBY LEADERS</th><th>BEST</th><th>LONGEST</th></tr>` + rows.map(r => `<tr class="${r.x.id === S.me ? 'mine' : ''}"><td>#${r.x.num} ${r.x.name}</td><td>${r.d.best}</td><td>${r.d.longest} ft</td></tr>`).join('');
  setTimeout(() => { $('#hud').classList.add('hidden'); screen('sOver'); }, 1800);
}
$('#againBtn').addEventListener('click', () => { sfx.click(); startGame(lastCfg || 'team'); });
$('#menuBtn').addEventListener('click', () => { quitGame(); go('menu'); screenStack = ['sMenu']; });

// ---------- main loop ----------
let last = performance.now();
function frame(now) {
  const rdt = Math.min(0.05, (now - last) / 1000); last = now;
  if (game && !paused) {
    const dt = rdt * game.timeScale;
    const steps = Math.ceil(dt / 0.02);
    for (let i = 0; i < steps; i++) game.update(dt / steps);
    syncWorld();
    renderRun(false);
  } else if (preview) preview.update(rdt);
  updateCamera(rdt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
function syncWorld() {
  const b = game.ball;
  const vis = b.mode !== 'none' && b.mode !== 'gone' && b.pos;
  ballMesh.visible = !!vis; ballShadow.visible = !!vis;
  if (vis) {
    ballMesh.position.set(b.pos.x, Math.max(0.15, b.pos.y), b.pos.z);
    ballMesh.scale.setScalar(Math.max(1, camera.position.distanceTo(ballMesh.position) / 75));
    ballShadow.position.set(b.pos.x, 0.06 + (Math.hypot(b.pos.x, b.pos.z + 60.5) < 9 ? 0.8 : 0), b.pos.z);
    const s = 1 + Math.min(2, b.pos.y / 40); ballShadow.scale.setScalar(s); ballShadow.material.opacity = 0.35 / s;
  }
  ballMesh.rotation.x += 0.4;
  // zone & reticle
  zoneGroup.visible = game.showZone && (game.phase === 'prepitch' || game.phase === 'windup' || game.phase === 'pitch');
  zoneGroup.userData.grid.visible = game.isHumanPitch();
  reticle.visible = game.isHumanPitch() && game.phase === 'prepitch';
  if (reticle.visible) reticle.position.set(game.pitchAim.x, game.pitchAim.y, 0.05);
  // tracer
  const tr = game.tracer, n = Math.min(TR_MAX, tr.length / 3);
  tracer.visible = n > 1 && (game.phase === 'live' || game.phase === 'dead' || game.phase === 'foul');
  if (tracer.visible) { const arr = trGeo.attributes.position.array; arr.set(tr.slice(0, n * 3)); trGeo.attributes.position.needsUpdate = true; trGeo.setDrawRange(0, n); }
}

// ---------- app install / offline ----------
let deferredPrompt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; $('#installBtn').classList.remove('hidden'); });
$('#installBtn').addEventListener('click', async () => { if (!deferredPrompt) return; deferredPrompt.prompt(); deferredPrompt = null; $('#installBtn').classList.add('hidden'); });
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => { });
}
document.addEventListener('visibilitychange', () => { if (document.hidden && game && !paused && game.phase !== 'over') pause(true); });

// ---------- inside GS Baseball Hub ----------
// The Hub opens the game in a frame and sends its live roster plus which player(s) belong
// to whoever is signed in, so kids land on their own player card automatically.
const EMBED = window.parent !== window || new URLSearchParams(location.search).has('embed');
if (EMBED) document.body.classList.add('embed');
const toHub = (msg) => { try { window.parent.postMessage(Object.assign({ source: 'gs-game' }, msg), location.origin); } catch { } };
addEventListener('message', (e) => {
  if (e.origin !== location.origin || !e.data || e.data.source !== 'gs-hub') return;
  const d = e.data;
  if (d.type === 'roster') {
    if (!D.setRoster(d.players)) return;
    const mine = (d.mine || []).map(id => 'h_' + id).filter(id => D.GS_ROSTER.some(p => p.id === id));
    if (!D.GS_ROSTER.some(p => p.id === S.me)) S.me = null;
    if (mine.length && !mine.includes(S.me)) S.me = mine[0];
    D.save();
    if ($('#sPick').classList.contains('show')) buildRoster();
    if ($('#sMenu').classList.contains('show')) buildMenu();
    hubLineup = d.lineup && Array.isArray(d.lineup.order) && d.lineup.order.length ? d.lineup : null;
    if ($('#sLineup').classList.contains('show')) renderLineup();
  }
});
$$('[data-hub]').forEach(b => b.addEventListener('click', () => { quitGame(); music.stop(300); toHub({ type: 'close' }); }));
if (EMBED) toHub({ type: 'ready' });

// boot
applySettings();
resize();
ballMesh.visible = false; ballShadow.visible = false; tracer.visible = false; zoneGroup.visible = false;
requestAnimationFrame(frame);
window.__gs = { get game() { return game; }, startGame, S, D, camera, audioState, music, sfx,
  // test helper: advance the simulation without waiting for real frames
  step(sec, dt = 1 / 60) { for (let t = 0; t < sec; t += dt) { if (game && !paused) { game.update(dt * game.timeScale); } updateCamera(dt); } if (game) syncWorld(); renderer.render(scene, camera); },
};
window.DONE = true;
