// Reading the GameChanger scoreboard drawn in the top-left corner of the video:
// find its text rows, which team has the "at bat" dot, the batter row, and (outside Claude)
// read the words with Tesseract OCR. Coordinates are pixels of the corner canvas.

// the corner of the frame at full resolution
export function cornerCanvas(video) {
  const vw = video.videoWidth, vh = video.videoHeight;
  const w = Math.round(vw * 0.42), h = Math.round(vh * 0.38);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d', { willReadFrequently: true }).drawImage(video, 0, 0, w, h, 0, 0, w, h);
  return c;
}

// Text on the scoreboard is light on a dark panel. A pixel is "text" when it is light and has a
// dark pixel close by (clouds and sky are light without dark surroundings).
export function layout(canvas) {
  const w = canvas.width, h = canvas.height;
  const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const lum = new Uint8Array(w * h);
  for (let i = 0, j = 0; j < lum.length; i += 4, j++) lum[j] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
  // min filter (3 px radius) by separable passes
  const r = Math.max(2, Math.round(h / 160));
  const tmp = new Uint8Array(w * h), mn = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 255; for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) m = Math.min(m, lum[y * w + k]); tmp[y * w + x] = m; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 255; for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) m = Math.min(m, tmp[k * w + x]); mn[y * w + x] = m; }
  const txt = new Uint8Array(w * h);
  let n = 0;
  for (let j = 0; j < txt.length; j++) if (lum[j] > 185 && mn[j] < 80) { txt[j] = 1; n++; }
  if (n < 50) return null;
  // columns that hold text, then rows (bands) within them
  const colN = new Uint32Array(w); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) colN[x] += txt[y * w + x];
  let xa = 0; while (xa < w && colN[xa] < 2) xa++;
  let xb = w - 1; while (xb > xa && colN[xb] < 2) xb--;
  const rowN = new Uint32Array(h); for (let y = 0; y < h; y++) for (let x = xa; x <= xb; x++) rowN[y] += txt[y * w + x];
  const minRow = Math.max(3, (xb - xa) * 0.004);
  const bands = []; let s = -1;
  for (let y = 0; y <= h; y++) {
    const on = y < h && rowN[y] >= minRow;
    if (on && s < 0) s = y;
    else if (!on && s >= 0) { if (y - s >= Math.max(5, h / 90)) bands.push({ y0: s, y1: y - 1 }); s = -1; }
  }
  // merge bands split by a gap smaller than a third of their height (descenders, accents)
  for (let i = 1; i < bands.length; i++) {
    const a = bands[i - 1], b = bands[i];
    if (b.y0 - a.y1 < Math.min(a.y1 - a.y0, b.y1 - b.y0) * 0.35) { a.y1 = b.y1; bands.splice(i, 1); i--; }
  }
  for (const b of bands) {
    let x0 = w, x1 = 0;
    for (let y = b.y0; y <= b.y1; y++) for (let x = xa; x <= xb; x++) if (txt[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
    b.x0 = x0; b.x1 = x1; b.h = b.y1 - b.y0 + 1;
  }
  const rows = bands.filter((b) => b.x1 - b.x0 > b.h * 2);
  if (rows.length < 3) return { rows, ok: false };
  // GameChanger: the header, the away team, the home team, then one or two player lines.
  // With two, they follow the team order (away first), so the batting team's line is the
  // batter and the other is the pitcher. With one, it is usually the batter.
  const nPlayers = rows.length >= 5 ? 2 : 1;
  const players = rows.slice(rows.length - nPlayers);
  const teams = rows.length >= 4 ? [rows[rows.length - nPlayers - 2], rows[rows.length - nPlayers - 1]] : null;
  // the orange "at bat" dot sits just right of one team's name, in the left part of the board
  let batting = null;
  if (teams) {
    const xLim = xa + (xb - xa) * 0.42;
    const hits = [0, 0];
    teams.forEach((tb, i) => {
      for (let y = tb.y0; y <= tb.y1; y++) for (let x = xa; x < xLim; x++) {
        const k = (y * w + x) * 4, R = d[k], Gc = d[k + 1], B = d[k + 2];
        if (R > 200 && Gc > 80 && Gc < 180 && B < 120 && R - B > 110) hits[i]++;
      }
    });
    const need = Math.max(4, teams[0].h * teams[0].h * 0.05);
    if (hits[0] >= need && hits[0] > hits[1] * 3) batting = 0;
    else if (hits[1] >= need && hits[1] > hits[0] * 3) batting = 1;
  }
  const batter = nPlayers === 1 ? players[0] : batting != null ? players[batting] : null;
  const pitcher = nPlayers === 2 && batter ? players[1 - players.indexOf(batter)] : null;
  const last = rows[rows.length - 1];
  return { ok: true, rows, teams, players, batting, batter, pitcher, batterSure: !!batter && nPlayers === 2, box: { x0: xa, x1: xb, y0: rows[0].y0, y1: last.y1 } };
}

// a clean crop of one row for OCR: grey, inverted (dark text on white), text about 40 px tall
export function rowCanvas(src, row, { part = 1, pad = 0.35 } = {}) {
  const ph = Math.round(row.h * pad);
  const x0 = Math.max(0, row.x0 - ph), y0 = Math.max(0, row.y0 - ph);
  const x1 = Math.min(src.width, row.x0 + (row.x1 - row.x0) * part + ph), y1 = Math.min(src.height, row.y1 + ph);
  const k = Math.min(4, Math.max(1, 40 / row.h));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round((x1 - x0) * k)); c.height = Math.max(1, Math.round((y1 - y0) * k));
  const x = c.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingQuality = 'high';
  x.drawImage(src, x0, y0, x1 - x0, y1 - y0, 0, 0, c.width, c.height);
  const im = x.getImageData(0, 0, c.width, c.height), d = im.data;
  for (let i = 0; i < d.length; i += 4) {
    const l = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
    const v = 255 - Math.max(0, Math.min(255, (l - 60) * 1.6));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  x.putImageData(im, 0, 0);
  return c;
}
// the batter row as shown (colour, name part only), for the review list
export function rowPreview(src, row, part = 0.62) {
  const ph = Math.round(row.h * 0.3);
  const x0 = Math.max(0, row.x0 - ph), y0 = Math.max(0, row.y0 - ph);
  const x1 = Math.min(src.width, row.x0 + (row.x1 - row.x0) * part + ph), y1 = Math.min(src.height, row.y1 + ph);
  const k = 30 / (y1 - y0);
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round((x1 - x0) * k)); c.height = 30;
  c.getContext('2d').drawImage(src, x0, y0, x1 - x0, y1 - y0, 0, 0, c.width, 30);
  try { return c.toDataURL('image/png'); } catch { return null; }
}
// a small signature of the name part of the batter row: same batter -> same picture
export function rowPrint(src, row) {
  // a fixed shape tied to the text height, so a slightly different row width reads the same
  const W = 96, H = 12, w = Math.min(row.x1 - row.x0, row.h * 9);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(src, row.x0, row.y0 - 1, Math.max(1, w), row.h + 2, 0, 0, W, H);
  const d = x.getImageData(0, 0, W, H).data, g = new Float32Array(W * H);
  let m = 0; for (let i = 0; i < g.length; i++) { g[i] = d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]; m += g[i]; }
  m /= g.length; let s = 0; for (let i = 0; i < g.length; i++) { g[i] -= m; s += g[i] * g[i]; }
  s = Math.sqrt(s) || 1; for (let i = 0; i < g.length; i++) g[i] /= s;
  return g;
}
export function samePrint(a, b) { if (!a || !b) return 0; let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

// ---------------------------------------------------------------- parsing OCR text
export function parseBatter(text) {
  const t = String(text || '').replace(/[|\[\]{}]/g, ' ').replace(/\s+/g, ' ').trim();
  const m = t.match(/^(.*?)[,.;:]?\s*#\s*([0-9OoIl]{1,3})\b/);
  if (!m) return null;
  const name = m[1].replace(/[^A-Za-z .'\-]/g, '').replace(/\s+/g, ' ').trim();
  const number = m[2].replace(/[Oo]/g, '0').replace(/[Il]/g, '1');
  if (!name || name.length < 2) return null;
  return { name, number };
}
// the pitcher's line ends with a pitch count ("P: 11"), the batter's with "0 for 0"
export const isPitcherLine = (text) => /\bP\s*[:;.]\s*\d/.test(String(text || '')) && !/\d\s*for\s*\d/i.test(String(text || ''));
export const isBatterLine = (text) => /\d\s*for\s*\d/i.test(String(text || ''));
export function parseTeam(text) {
  const t = String(text || '').trim();
  const m = t.match(/^[^A-Za-z0-9]*([A-Z0-9][A-Za-z0-9]{1,6})/);
  if (!m) return null;
  let abbr = m[1].replace(/[a-z]+$/, '');            // a dot read as a trailing "e"
  if (abbr.length < 2) return null;
  return abbr.toUpperCase();
}

// ---------------------------------------------------------------- Tesseract (outside Claude)
const TESS_URLS = [
  'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
  'https://unpkg.com/tesseract.js@5.1.1/dist/tesseract.min.js',
];
let tessWorker = null;
export async function tesseract() {
  if (tessWorker) return tessWorker;
  tessWorker = (async () => {
    if (!window.Tesseract) {
      for (const u of TESS_URLS) {
        try {
          await new Promise((res, rej) => { const s = document.createElement('script'); s.src = u; s.async = true; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
          if (window.Tesseract) break;
        } catch {}
      }
    }
    if (!window.Tesseract) throw new Error('OCR could not be loaded');
    const T = window.Tesseract;
    const worker = await T.createWorker('eng', 1);
    await worker.setParameters({ tessedit_pageseg_mode: T.PSM ? T.PSM.SINGLE_LINE : '7', preserve_interword_spaces: '1' });
    return worker;
  })();
  tessWorker.catch(() => { tessWorker = null; });
  return tessWorker;
}
export async function ocrLine(canvas) {
  const w = await tesseract();
  const { data } = await w.recognize(canvas);
  return String(data && data.text || '').split('\n').map((s) => s.trim()).filter(Boolean)[0] || '';
}
