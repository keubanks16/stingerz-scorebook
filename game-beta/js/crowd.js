// Crowd sounds synthesized from many individual "voices": each voice is a buzzy vocal
// source shaped by vowel formants (the resonances that make "ahh", "ooh", "ay" sound human),
// with its own pitch, vibrato and timing. Claps and whistles are layered on top.
// Everything is generated once into plain sample arrays (no audio files).

const VOWELS = {
  a: [[730, 1.0, 80], [1090, 0.5, 90], [2440, 0.25, 120]],   // "ahh"  (yeahhh!)
  e: [[530, 1.0, 70], [1840, 0.45, 100], [2480, 0.25, 120]], // "ehh"  (heyyy!)
  o: [[570, 1.0, 70], [840, 0.55, 80], [2410, 0.15, 120]],   // "ohh"
  u: [[400, 1.0, 60], [800, 0.4, 80], [2300, 0.1, 120]],     // "ooo"
  w: [[640, 1.0, 80], [1190, 0.45, 90], [2390, 0.2, 120]],   // "aww"
};
let seed = 12345;
const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const rr = (a, b) => a + (b - a) * rand();

// RBJ band-pass (constant peak gain), run in place over a buffer
function bandpass(src, sr, f, bw) {
  const w = 2 * Math.PI * f / sr, q = f / bw, al = Math.sin(w) / (2 * q), c = Math.cos(w);
  const b0 = al, b2 = -al, a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
  const out = new Float32Array(src.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < src.length; i++) {
    const x = src[i];
    const y = (b0 * x + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y; out[i] = y;
  }
  return out;
}
function formant(src, sr, vowel) {
  const out = new Float32Array(src.length);
  for (const [f, g, bw] of VOWELS[vowel]) { const b = bandpass(src, sr, f * rr(0.97, 1.03), bw * 1.6); for (let i = 0; i < out.length; i++) out[i] += b[i] * g; }
  return out;
}
const smooth = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);

// One crowd layer. env(t, voice) returns 0..1 loudness for a voice at time t.
function voices(sr, dur, n, opts) {
  const N = Math.floor(sr * dur);
  const groups = {};
  for (const v of opts.vowels) groups[v] = new Float32Array(N);
  for (let k = 0; k < n; k++) {
    const vowel = opts.vowels[(rand() * opts.vowels.length) | 0];
    const buf = groups[vowel];
    const kid = rand() < opts.kids;
    const f0 = kid ? rr(240, 360) : rand() < 0.45 ? rr(190, 260) : rr(105, 160);
    const vib = rr(4.5, 6.5), vibD = rr(0.01, 0.03), ph0 = rand();
    const v = { start: rr(opts.startMin, opts.startMax), len: rr(opts.lenMin, opts.lenMax), amp: rr(0.5, 1), syl: rr(3, 6), sylPh: rand() * 6.28 };
    let ph = ph0;
    for (let i = 0; i < N; i++) {
      const t = i / sr;
      const e = opts.env(t, v);
      if (e <= 0.0005) continue;
      const glide = opts.glide ? opts.glide(t, v) : 1;
      const f = f0 * glide * (1 + vibD * Math.sin(2 * Math.PI * vib * t + ph0 * 6));
      ph += f / sr; if (ph >= 1) ph -= 1;
      // band-limited-ish buzzy source: sawtooth softened with a little breath noise
      const s = (2 * ph - 1) * 0.8 + (rand() * 2 - 1) * 0.35;
      buf[i] += s * e * v.amp;
    }
  }
  const out = new Float32Array(N);
  for (const v of opts.vowels) { const f = formant(groups[v], sr, v); for (let i = 0; i < N; i++) out[i] += f[i]; }
  return out;
}
function claps(sr, dur, rate, envFn, out) {
  const N = out.length;
  let t = 0;
  while (t < dur) {
    t += -Math.log(1 - rand()) / rate;
    const i0 = Math.floor(t * sr); if (i0 >= N) break;
    const g = envFn(t) * rr(0.3, 1);
    if (g < 0.02) continue;
    const L = Math.floor(sr * 0.012); let lp = 0;
    for (let j = 0; j < L && i0 + j < N; j++) { const n = rand() * 2 - 1; lp = lp * 0.55 + n * 0.45; out[i0 + j] += (lp * 0.8 + n * 0.2) * g * Math.exp(-j / (sr * 0.004)) * 0.28; }
  }
}
function whistle(sr, out, at, len, f0, f1, g) {
  const i0 = Math.floor(at * sr), L = Math.floor(len * sr); let ph = 0;
  for (let j = 0; j < L && i0 + j < out.length; j++) {
    const u = j / L, f = f0 + (f1 - f0) * Math.sin(u * Math.PI / 2) + 30 * Math.sin(j / sr * 2 * Math.PI * 7);
    ph += f / sr; const e = smooth(u * 8) * smooth((1 - u) * 6);
    out[i0 + j] += Math.sin(2 * Math.PI * ph) * e * g;
  }
}
function normalize(a, peak = 0.9) { let m = 0; for (const x of a) m = Math.max(m, Math.abs(x)); if (m > 0) for (let i = 0; i < a.length; i++) a[i] *= peak / m; return a; }

// big roar: everyone yells at once, swells, holds, fades. Claps + whistles.
export function makeCheer(sr, dur = 5.5, s = 7) {
  seed = s;
  const out = voices(sr, dur, 70, {
    vowels: ['a', 'a', 'e', 'o'], kids: 0.4, startMin: 0, startMax: 0.45, lenMin: 1.6, lenMax: 4.2,
    env: (t, v) => { const x = t - v.start; if (x < 0) return 0; return smooth(x / 0.18) * smooth((v.len - x) / 0.9) * (0.8 + 0.2 * Math.sin(2 * Math.PI * 1.3 * t + v.sylPh)); },
    glide: (t, v) => { const x = Math.max(0, t - v.start); return 1 + 0.18 * smooth(x / 0.35) - 0.1 * smooth((x - 1) / 2); },
  });
  normalize(out, 0.75);
  claps(sr, dur, 45, t => smooth(t / 0.3) * smooth((dur - t) / 2), out);
  const nw = 1 + Math.floor(rand() * 3);
  for (let i = 0; i < nw; i++) whistle(sr, out, rr(0.2, 1.6), rr(0.5, 0.9), rr(1900, 2400), rr(2600, 3300), 0.12);
  return fadeEnds(normalize(out, 0.92), sr);
}
// rising "ooooh" while a long fly ball is in the air
export function makeOoh(sr, dur = 3, s = 11) {
  seed = s;
  const out = voices(sr, dur, 60, {
    vowels: ['o', 'u', 'o'], kids: 0.4, startMin: 0, startMax: 0.6, lenMin: 1.8, lenMax: 3,
    env: (t, v) => { const x = t - v.start; if (x < 0) return 0; return smooth(x / 0.8) * smooth((v.len - x) / 0.7); },
    glide: (t, v) => 1 + 0.25 * smooth(Math.max(0, t - v.start) / 2),
  });
  return fadeEnds(normalize(out, 0.85), sr);
}
// disappointed "awww"
export function makeAww(sr, dur = 2.4, s = 21) {
  seed = s;
  const out = voices(sr, dur, 55, {
    vowels: ['w', 'o'], kids: 0.35, startMin: 0, startMax: 0.25, lenMin: 1.2, lenMax: 2,
    env: (t, v) => { const x = t - v.start; if (x < 0) return 0; return smooth(x / 0.12) * smooth((v.len - x) / 0.9); },
    glide: (t, v) => 1.15 - 0.3 * smooth(Math.max(0, t - v.start) / 1.4),
  });
  return fadeEnds(normalize(out, 0.8), sr);
}
// steady ballpark chatter (loops)
export function makeMurmur(sr, dur = 9, s = 31) {
  seed = s;
  const out = voices(sr, dur, 32, {
    vowels: ['a', 'e', 'o', 'u'], kids: 0.4, startMin: -1, startMax: 0, lenMin: 99, lenMax: 99,
    // talking: syllables switching on and off at random-ish rates
    env: (t, v) => { const g = Math.sin(2 * Math.PI * v.syl * t + v.sylPh) * 0.5 + 0.5; const phrase = Math.sin(2 * Math.PI * 0.23 * t + v.sylPh * 3) > -0.2 ? 1 : 0; return g * g * phrase * 0.6; },
    glide: (t, v) => 1 + 0.08 * Math.sin(2 * Math.PI * 0.7 * t + v.sylPh),
  });
  claps(sr, dur, 2, () => 0.25, out);
  normalize(out, 0.8);
  // crossfade the tail into the head so it loops without a seam
  const X = Math.floor(sr * 0.8), N = out.length;
  for (let i = 0; i < X; i++) { const k = i / X; out[i] = out[i] * k + out[N - X + i] * (1 - k); }
  return out.subarray(0, N - X);
}
function fadeEnds(a, sr) { const F = Math.floor(sr * 0.05); for (let i = 0; i < F; i++) { a[i] *= i / F; a[a.length - 1 - i] *= i / F; } return a; }
