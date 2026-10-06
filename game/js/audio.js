// Ballpark audio: synthesized bat/glove sounds, a crowd built from many voices,
// the PA announcer, and the team songs playing underneath the game.
let ctx = null, master = null, sfxBus = null, crowdBus = null, musicGain = null, enabled = true, announcer = true;
let crowd = null, murmurGain = null;
export function setSound(on) { enabled = on; if (master) master.gain.value = on ? 1 : 0; if (!on) music.stop(0); }
export function setAnnouncer(on) { announcer = on; }
export function unlock() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = enabled ? 1 : 0; master.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.9; sfxBus.connect(master);
    crowdBus = ctx.createGain(); crowdBus.gain.value = 0.85; crowdBus.connect(master);
    buildCrowd();
  } catch { ctx = null; }
  // iOS: an <audio> element must be started inside a tap before it can play later
  try { const a = audioEl(); if (!a.src) { a.src = SILENT; a.play().then(() => a.pause()).catch(() => { }); } } catch { }
  routeMusic();
}
function noiseBuffer(sec) {
  const b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate); const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b;
}
let nb = null;
function noise(dur, freq, q, gain, type = 'bandpass', attack = 0.002) {
  if (!ctx) return;
  nb = nb || noiseBuffer(2);
  const s = ctx.createBufferSource(); s.buffer = nb;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); const t = ctx.currentTime;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(sfxBus); s.start(t, Math.random()); s.stop(t + dur + 0.05);
}
function tone(freq, dur, gain, type = 'sine', slide) {
  if (!ctx) return;
  const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
  const g = ctx.createGain(); const t = ctx.currentTime;
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + dur + 0.02);
}

// ---------- crowd ----------
function toBuffer(arr, sr) { const b = ctx.createBuffer(1, arr.length, sr); b.getChannelData(0).set(arr); return b; }
function buildCrowd() {
  const sr = 16000;
  const done = (d) => {
    crowd = {};
    for (const k of ['murmur', 'cheer', 'cheer2', 'ooh', 'aww']) if (d[k]) crowd[k] = toBuffer(d[k], d.sr);
    startMurmur();
  };
  try {
    const w = new Worker(new URL('./crowd-worker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => { done(e.data); w.terminate(); };
    w.onerror = () => { w.terminate(); fallback(); };
    w.postMessage({ sr });
  } catch { fallback(); }
  function fallback() { setTimeout(async () => { const C = await import('./crowd.js'); done({ sr, murmur: C.makeMurmur(sr), cheer: C.makeCheer(sr), ooh: C.makeOoh(sr), aww: C.makeAww(sr) }); }, 1500); }
}
function startMurmur() {
  if (!crowd?.murmur) return;
  // two copies offset in time and panned apart make the stands sound wide and full
  murmurGain = ctx.createGain(); murmurGain.gain.value = 0; murmurGain.connect(crowdBus);
  [[-0.6, 0], [0.6, crowd.murmur.duration / 2]].forEach(([pan, off]) => {
    const s = ctx.createBufferSource(); s.buffer = crowd.murmur; s.loop = true; s.playbackRate.value = pan < 0 ? 1 : 0.94;
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) { p.pan.value = pan; s.connect(p); p.connect(murmurGain); } else s.connect(murmurGain);
    s.start(0, off);
  });
  murmurGain.gain.linearRampToValueAtTime(crowdLevel, ctx.currentTime + 2);
}
let crowdLevel = 0.16;
export function setCrowdLevel(v) { crowdLevel = v; if (murmurGain && ctx) murmurGain.gain.setTargetAtTime(v, ctx.currentTime, 0.6); }
function playCrowd(name, gain, { rate = 1, pan = 0, delay = 0 } = {}) {
  if (!ctx || !crowd || !crowd[name]) return;
  const s = ctx.createBufferSource(); s.buffer = crowd[name]; s.playbackRate.value = rate;
  const g = ctx.createGain(); g.gain.value = gain;
  let node = g;
  if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); node = p; }
  s.connect(g); node.connect(crowdBus); s.start(ctx.currentTime + delay);
  return { s, g };
}
let oohNode = null;
export const sfx = {
  crack(q = 0.8) { noise(0.09, 2400 + q * 1500, 1.4, 1.1); tone(900 + q * 500, 0.05, 0.35, 'triangle', 400); noise(0.35, 700, 0.8, 0.25 * q, 'lowpass'); },
  foul() { noise(0.06, 1800, 1.5, 0.6); },
  mitt() { noise(0.08, 380, 1.2, 1.2, 'lowpass'); tone(130, 0.07, 0.4); },
  glove() { noise(0.06, 600, 1.1, 0.7, 'lowpass'); },
  whoosh() { noise(0.18, 900, 0.7, 0.18, 'bandpass', 0.06); },
  click() { tone(880, 0.05, 0.12, 'square'); },
  // the home crowd roars (level 0.3 = nice play ... 1.2 = home run)
  cheer(level = 1) {
    sfx.oohStop();
    const g = 0.25 + 0.55 * Math.min(1.3, level);
    playCrowd('cheer', g, { pan: -0.25, rate: 0.98 + Math.random() * 0.06 });
    if (level >= 0.6) playCrowd('cheer2', g * 0.85, { pan: 0.3, delay: 0.12, rate: 0.96 + Math.random() * 0.06 });
    if (level >= 1) playCrowd('cheer', g * 0.7, { pan: 0, delay: 1.6, rate: 0.93 });
    music.duck(level >= 1 ? 0.6 : 0.4, 2.5 + level * 2);
  },
  // home crowd groans when the other team does something good
  aww(level = 0.6) { sfx.oohStop(); playCrowd('aww', 0.25 + 0.4 * level, { rate: 0.97 + Math.random() * 0.06 }); },
  // building "ooooh" while a long fly ball hangs in the air
  ooh() { if (oohNode) return; oohNode = playCrowd('ooh', 0.55, { rate: 1 }); setTimeout(() => { oohNode = null; }, 3000); },
  oohStop() { if (oohNode && ctx) { try { oohNode.g.gain.setTargetAtTime(0, ctx.currentTime, 0.15); } catch { } oohNode = null; } },
  organ() { // charge!
    if (!ctx) return; const notes = [392, 523, 659, 784, 659, 784]; const durs = [0.15, 0.15, 0.15, 0.3, 0.15, 0.6];
    let t = 0; notes.forEach((n, i) => { setTimeout(() => { tone(n, durs[i] + 0.1, 0.12, 'square'); tone(n / 2, durs[i] + 0.1, 0.08, 'triangle'); }, t * 1000); t += durs[i]; });
  },
};
export function say(text, rate = 1.0, pitch = 0.9) {
  if (!enabled || !announcer || !('speechSynthesis' in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text); u.rate = rate; u.pitch = pitch; u.volume = 1;
    const v = speechSynthesis.getVoices().find(v => /en[-_]US/i.test(v.lang) && /male|daniel|alex|fred|google us/i.test(v.name)) || speechSynthesis.getVoices().find(v => /^en/i.test(v.lang));
    if (v) u.voice = v;
    music.duck(0.5, 2.5);
    speechSynthesis.speak(u);
  } catch { }
}

// ---------- team music ----------
// One player for the songs. During games they play softly underneath everything; a walk-up
// or home run brings the batter's song up front, then it settles back down and keeps going.
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
export const SONGS = [
  { id: 'bring-that-sting', title: 'Bring That Sting', file: 'music/bring-that-sting.mp3', hook: 150 },
  { id: 'built-different', title: 'Built Different', file: 'music/built-different.mp3', hook: 127.5 },
  { id: 'buzzin', title: "Buzzin'", file: 'music/buzzin.mp3', hook: 143.5 },
  { id: 'one-shot', title: 'One Shot', file: 'music/one-shot.mp3', hook: 113.5 },
];
const LEVEL = { menu: 0.5, game: 0.14, feature: 0.75, preview: 0.75 };
const blobs = {};
async function srcFor(song) {
  if (blobs[song.id]) return blobs[song.id];
  try { const r = await fetch(song.file); if (!r.ok) throw 0; const b = await r.blob(); blobs[song.id] = URL.createObjectURL(b); }
  catch { blobs[song.id] = song.file; }
  return blobs[song.id];
}
let musicOn = true, el = null, routed = false, mode = null, base = 0.5, cur = null, playToken = 0, listIdx = Math.floor(Math.random() * 4);
let featureTimer = null, duckUntil = 0, duckLevel = 1, duckTimer = null;
export function setMusic(on) { musicOn = on; if (!on) music.stop(0); }
function audioEl() {
  if (!el) { el = new Audio(); el.preload = 'auto'; el.playsInline = true; el.setAttribute('playsinline', ''); el.crossOrigin = 'anonymous'; }
  return el;
}
// iPhones ignore <audio>.volume, so the songs go through Web Audio where a gain node sets the level
function routeMusic() {
  if (routed || !ctx) return;
  try { const src = ctx.createMediaElementSource(audioEl()); musicGain = ctx.createGain(); musicGain.gain.value = 0; src.connect(musicGain); musicGain.connect(master); routed = true; } catch { routed = false; }
}
let target = 0;
function setLevel(v, sec = 0.6) {
  target = v;
  const eff = v * (performance.now() < duckUntil ? duckLevel : 1);
  if (routed && musicGain && ctx) { musicGain.gain.cancelScheduledValues(ctx.currentTime); musicGain.gain.setTargetAtTime(eff, ctx.currentTime, Math.max(0.01, sec / 3)); audioEl().volume = 1; }
  else { audioEl().volume = Math.max(0, Math.min(1, eff)); }
}
async function load(song, from = 0) {
  const tok = ++playToken;
  const src = await srcFor(song); if (tok !== playToken) return false;
  const a = audioEl(); a.onended = null; a.pause(); a.src = src;
  await new Promise(res => { if (a.readyState >= 1) res(); else { a.addEventListener('loadedmetadata', res, { once: true }); setTimeout(res, 3000); } });
  if (tok !== playToken) return false;
  try { a.currentTime = from; } catch { }
  cur = song;
  a.onended = () => { if (tok === playToken) nextInList(); };
  a.play().catch(() => { });
  return true;
}
function nextInList() {
  if (!mode || mode === 'preview') { mode = null; return; }
  if (mode === 'feature') { mode = 'game'; base = LEVEL.game; }
  const s = SONGS[listIdx++ % SONGS.length];
  setLevel(0, 0.01); load(s, 0).then(ok => ok && setLevel(base, 1.5));
}
export const music = {
  // playlist on the menus
  menu() { music.list('menu'); },
  // playlist softly underneath the game
  background() { music.list('game'); },
  list(m) {
    if (!musicOn || !enabled) return;
    base = LEVEL[m];
    const playing = el && !el.paused && cur && (mode === 'menu' || mode === 'game' || mode === 'feature');
    mode = m; clearTimeout(featureTimer);
    if (playing) { setLevel(base, 1.2); return; }
    nextInList();
  },
  // walk-up song / home run: the batter's song comes up front, then drops back underneath
  feature(id, secs = 11) {
    if (!musicOn || !enabled) return;
    const s = SONGS.find(x => x.id === id); if (!s) return;
    const back = mode === 'menu' ? 'menu' : 'game';
    mode = 'feature'; base = LEVEL.feature; clearTimeout(featureTimer);
    const go = () => { setLevel(LEVEL.feature, 0.4); featureTimer = setTimeout(() => { if (mode === 'feature') { mode = back; base = LEVEL[back]; setLevel(base, 2.5); } }, secs * 1000); };
    if (cur === s && el && !el.paused) { go(); return; }
    setLevel(0, 0.2);
    load(s, s.hook).then(ok => ok && go());
  },
  walkup(id, secs = 11) { music.feature(id, secs); },
  // tap-to-hear on the player card
  preview(id) {
    if (!musicOn || !enabled) return;
    const s = SONGS.find(x => x.id === id); if (!s) return;
    mode = 'preview'; clearTimeout(featureTimer); base = LEVEL.preview;
    setLevel(0, 0.1); load(s, s.hook).then(ok => { if (!ok) return; setLevel(LEVEL.preview, 0.4); featureTimer = setTimeout(() => { if (mode === 'preview') music.menu(); }, 8000); });
  },
  // briefly lower the music so the crowd or announcer comes through
  duck(level = 0.5, sec = 2) {
    duckLevel = level; duckUntil = performance.now() + sec * 1000; setLevel(target, 0.3);
    clearTimeout(duckTimer); duckTimer = setTimeout(() => setLevel(target, 1.2), sec * 1000 + 30);
  },
  stop(ms = 800) {
    mode = null; ++playToken; clearTimeout(featureTimer);
    if (!el) return; setLevel(0, ms / 1000); setTimeout(() => { if (!mode) el.pause(); }, ms + 50);
  },
  nowPlaying() { return mode; },
};

export function audioState() { return { ctx: ctx && ctx.state, crowd: crowd ? Object.keys(crowd) : null, routed, mode, target: +target.toFixed(2), song: cur && cur.id, paused: el ? el.paused : null }; }
