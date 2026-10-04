// GS Baseball Scorebook helper (Cloudflare Worker).
//
// The scorebook is a public website, so secret keys can't live in it. This Worker keeps
// them on Cloudflare and does these jobs for GS Baseball Hub:
//   roster  read a roster photo
//   scout   write a scouting report
//   live-start / live-end   open and close a private Cloudflare Stream for the camera phone
//   notifications   every minute (Cron Trigger) and when a coach scores, look for new chat
//                   messages and score changes and send phone notifications
//   photos  team chat photos: store them in R2, hand out short-lived viewing links, delete them.
//           Only signed-in, approved members can send or see them.
//   fees    tournament fee reminder notifications to families who haven't paid yet.
//
// Set these in the Worker's Settings -> Variables and Secrets:
//   ACCESS_CODE        Secret  any passphrase you make up; coaches type it into the scorebook
//   ANTHROPIC_API_KEY  Secret  your key from console.anthropic.com (roster photos, scouting reports)
//   CF_STREAM_TOKEN    Secret  Cloudflare API token with Account > Stream > Edit (live video)
//   CF_ACCOUNT_ID      Text    your Cloudflare account ID (live video)
//   FIREBASE_SERVICE_ACCOUNT  Secret  the whole service-account .json file from Firebase (notifications, photos, fees)
// and under Settings -> Bindings add an R2 bucket with the variable name PHOTOS (chat photos),
// and under Settings -> Triggers add a Cron Trigger that runs every minute (* * * * *).
//   ALLOWED_ORIGIN     Text    optional; defaults to the scorebook site and keubanks16.github.io
//   MODEL              Text    optional; defaults to claude-sonnet-5-5

const DEFAULT_ORIGIN = 'https://scorebook.stingerz-baseball.com,https://keubanks16.github.io';
const DEFAULT_MODEL = 'claude-sonnet-5-5';
const CLAUDE_TASKS = { roster: 2000, scout: 1000, ping: 5 }; // max output tokens per job
const STREAM_TASKS = ['live-start', 'live-end'];
const MAX_PROMPT_CHARS = 24000;
const MAX_IMAGES = 5;
const MAX_IMAGE_B64 = 6000000; // about 4.5 MB per image
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const PHOTO_TASKS = ['photo-urls', 'photo-delete'];
const PAY_TASKS = ['fee-remind'];
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_PHOTO_BYTES = 6 * 1024 * 1024; // the Hub shrinks photos to about 0.3-1 MB before sending
const PHOTO_KEY = /^chat\/[a-f0-9]{32}\.jpg$/;

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(notifyRun(env).catch(() => {}));
  },
  async fetch(request, env, ctx) {
    // Notification fan-out from this same Worker (no browser involved).
    const internal = request.headers.get('x-gs-internal');
    if (internal && env.ACCESS_CODE && request.method === 'POST' && sameText(internal, String(env.ACCESS_CODE))) {
      const b = await request.json().catch(() => null);
      if (b && b.task === 'notify-send' && Array.isArray(b.items)) await sendItems(b.pid, b.gtok, b.items.slice(0, 40));
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    }
    const here = new URL(request.url);
    // Chat photos are shown with plain <img> links, so they're checked by a signature, not a sign-in.
    if (request.method === 'GET' && here.pathname.startsWith('/p/')) return photoServe(here, env);
    const origin = request.headers.get('Origin') || '';
    const allowed = String(env.ALLOWED_ORIGIN || DEFAULT_ORIGIN).split(',').map((s) => s.trim()).filter(Boolean);
    const originOk = allowed.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': originOk ? origin : allowed[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type, x-gs-code, authorization',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin'
    };
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return reply(405, { error: 'bad_request', detail: 'Use POST.' });
    if (!originOk) return reply(403, { error: 'origin', detail: 'This site is not in ALLOWED_ORIGIN.' });
    // Sending a chat photo is the one request that isn't JSON.
    if ((request.headers.get('content-type') || '').startsWith('multipart/form-data')) {
      return photoTask('photo-send', request, null, env, reply, ctx, here.origin, allowed[0]);
    }
    let body;
    try { body = await request.json(); } catch (e) { return reply(400, { error: 'bad_request' }); }
    const task = body && body.task;
    // Anyone on the site may ask for a notification check; it only sends what's new.
    if (task === 'notify-check') {
      ctx.waitUntil(notifyRun(env, here.origin, allowed[0]).catch(() => {}));
      return reply(202, { ok: true });
    }
    // Team members prove who they are with their Hub sign-in, not the coaches' access code.
    if (PHOTO_TASKS.includes(task)) return photoTask(task, request, body, env, reply, ctx, here.origin, allowed[0]);
    if (PAY_TASKS.includes(task)) return payTask(task, request, body, env, reply, allowed);
    if (!env.ACCESS_CODE) return reply(500, { error: 'not_configured', detail: 'Add ACCESS_CODE as a secret.' });
    if (!sameText(request.headers.get('x-gs-code') || '', String(env.ACCESS_CODE))) return reply(401, { error: 'bad_code' });
    if (STREAM_TASKS.includes(task)) return stream(task, body, env, reply);
    if (!Object.prototype.hasOwnProperty.call(CLAUDE_TASKS, task)) return reply(400, { error: 'bad_request', detail: 'Unknown task.' });
    if (!env.ANTHROPIC_API_KEY) return reply(500, { error: 'not_configured', detail: 'Add ANTHROPIC_API_KEY as a secret.' });

    const prompt = task === 'ping' ? 'Reply with the single word OK.' : String(body.prompt || '');
    if (!prompt || prompt.length > MAX_PROMPT_CHARS) return reply(400, { error: 'bad_request', detail: 'Prompt missing or too long.' });

    const images = Array.isArray(body.images) ? body.images : [];
    if (images.length && task !== 'roster') return reply(400, { error: 'bad_request', detail: 'Images are only for roster reading.' });
    if (images.length > MAX_IMAGES) return reply(400, { error: 'too_many_images' });

    const content = [];
    for (const im of images) {
      if (!im || !IMAGE_TYPES.includes(im.media_type) || typeof im.data !== 'string' || !im.data || im.data.length > MAX_IMAGE_B64) {
        return reply(400, { error: 'bad_image' });
      }
      content.push({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } });
    }
    content.push({ type: 'text', text: prompt });

    let r;
    try {
      r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: env.MODEL || DEFAULT_MODEL, max_tokens: CLAUDE_TASKS[task], messages: [{ role: 'user', content }] })
      });
    } catch (e) {
      return reply(502, { error: 'upstream', detail: 'Could not reach the AI service.' });
    }
    const data = await r.json().catch(() => null);
    if (!r.ok) {
      const msg = data && data.error && data.error.message ? String(data.error.message).slice(0, 240) : '';
      let error = 'upstream';
      if (r.status === 401 || r.status === 403) error = 'bad_key';
      else if (r.status === 429 || r.status === 529) error = 'rate_limited';
      else if (/credit|billing|balance/i.test(msg)) error = 'no_credit';
      return reply(error === 'rate_limited' ? 429 : 502, { error, detail: msg });
    }
    const text = ((data && data.content) || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    return reply(200, { text, truncated: data && data.stop_reason === 'max_tokens' });
  }
};

// Opens or closes a Cloudflare Stream live input. The publish (WHIP) address is secret and
// goes only to the coach's camera phone; the play (WHEP) address is what families use.
async function stream(task, body, env, reply) {
  if (!env.CF_STREAM_TOKEN || !env.CF_ACCOUNT_ID) {
    return reply(500, { error: 'stream_not_configured', detail: 'Add CF_STREAM_TOKEN (secret) and CF_ACCOUNT_ID (text) to the Worker.' });
  }
  const base = 'https://api.cloudflare.com/client/v4/accounts/' + encodeURIComponent(String(env.CF_ACCOUNT_ID).trim()) + '/stream/live_inputs';
  const headers = { Authorization: 'Bearer ' + env.CF_STREAM_TOKEN, 'content-type': 'application/json' };
  const fail = async (r) => {
    const data = await r.json().catch(() => null);
    const msg = data && data.errors && data.errors[0] ? String(data.errors[0].message || '').slice(0, 240) : '';
    const error = r.status === 401 || r.status === 403 ? 'stream_token' : 'stream_error';
    return reply(502, { error, detail: msg });
  };
  try {
    if (task === 'live-start') {
      const name = String(body.name || 'GS Baseball game').slice(0, 100);
      const r = await fetch(base, { method: 'POST', headers, body: JSON.stringify({ meta: { name }, recording: { mode: 'off' } }) });
      if (!r.ok) return fail(r);
      const data = await r.json();
      const res = data && data.result;
      const whip = res && res.webRTC && res.webRTC.url;
      const whep = res && res.webRTCPlayback && res.webRTCPlayback.url;
      if (!res || !res.uid || !whip || !whep) return reply(502, { error: 'stream_error', detail: 'Cloudflare did not return WebRTC addresses.' });
      return reply(200, { uid: res.uid, whip, whep });
    }
    const uid = String(body.uid || '');
    if (!/^[a-f0-9]{32}$/i.test(uid)) return reply(400, { error: 'bad_request', detail: 'Bad stream id.' });
    const r = await fetch(base + '/' + uid, { method: 'DELETE', headers });
    if (!r.ok && r.status !== 404) return fail(r);
    return reply(200, { ok: true });
  } catch (e) {
    return reply(502, { error: 'stream_error', detail: 'Could not reach Cloudflare Stream.' });
  }
}

// ---------- Team chat photos ----------
// Photos live in the R2 bucket bound as PHOTOS, never on the public website. The Worker checks
// each person's Hub sign-in (a Firebase ID token) and their approved member record before it
// stores a photo, writes the chat message itself (so a message can only point at a real photo),
// or gives out viewing links. Viewing links are signed, last one to two days, and stay the same
// all day so phones can cache the pictures.
async function photoTask(task, request, body, env, reply, ctx, self, site) {
  let u;
  try { u = await photoUser(request, env); } catch (e) { return reply(e.status || 500, { error: e.error || 'upstream' }); }
  try {
    if (task === 'photo-send') {
      let form;
      try { form = await request.formData(); } catch (e) { return reply(400, { error: 'bad_request' }); }
      const file = form.get('photo');
      if (!file || typeof file === 'string') return reply(400, { error: 'bad_image' });
      if (file.size > MAX_PHOTO_BYTES) return reply(413, { error: 'too_big' });
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8 || bytes[2] !== 0xFF) return reply(400, { error: 'bad_image' });
      const dim = (v) => Math.max(0, Math.min(10000, Math.round(Number(v) || 0)));
      const key = 'chat/' + hexRand(16) + '.jpg';
      await env.PHOTOS.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' }, customMetadata: { uid: u.uid } });
      const msg = {
        uid: u.uid,
        name: String(form.get('name') || u.name || 'Team member').trim().slice(0, 60) || 'Team member',
        text: String(form.get('text') || '').trim().slice(0, 1000),
        coach: u.admin,
        photo: { key, w: dim(form.get('w')), h: dim(form.get('h')) }
      };
      let id;
      try { id = await u.db.create('messages', msg, 'at'); } catch (e) { id = null; }
      if (!id) { await env.PHOTOS.delete(key).catch(() => {}); return reply(502, { error: 'upstream', detail: 'Could not save the message.' }); }
      ctx.waitUntil(notifyRun(env, self, site).catch(() => {}));
      return reply(200, { id, key });
    }
    if (task === 'photo-urls') {
      const keys = [...new Set((Array.isArray(body.keys) ? body.keys : []).map(String))].filter((k) => PHOTO_KEY.test(k)).slice(0, 300);
      const exp = (Math.floor(Date.now() / 86400000) + 2) * 86400; // end of tomorrow (UTC), in seconds
      const hk = await photoKey(u.sa);
      const urls = {};
      for (const k of keys) urls[k] = self + '/p/' + k + '?e=' + exp + '&s=' + (await photoSig(hk, k, exp));
      return reply(200, { urls, exp });
    }
    if (task === 'photo-delete') {
      const id = String(body.id || '');
      if (!/^[A-Za-z0-9]{1,40}$/.test(id)) return reply(400, { error: 'bad_request' });
      const m = await u.db.get('messages/' + id);
      if (!m) return reply(200, { ok: true });
      if (m.uid !== u.uid && !u.admin) return reply(403, { error: 'not_allowed' });
      const key = m.photo && m.photo.key;
      if (key && PHOTO_KEY.test(key)) await env.PHOTOS.delete(key);
      if (!(await u.db.del('messages/' + id))) return reply(502, { error: 'upstream', detail: 'Could not delete the message.' });
      return reply(200, { ok: true });
    }
    return reply(400, { error: 'bad_request' });
  } catch (e) {
    return reply(502, { error: 'upstream', detail: 'Photo storage had a problem.' });
  }
}
async function photoUser(request, env) {
  if (!env.PHOTOS || !env.FIREBASE_SERVICE_ACCOUNT) throw { status: 500, error: 'photos_not_configured' };
  return hubUser(request, env);
}
// Who is asking: checks their Hub sign-in (a Firebase ID token) and their member record.
async function hubUser(request, env) {
  if (!env.FIREBASE_SERVICE_ACCOUNT) throw { status: 500, error: 'not_configured' };
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  const m = /^Bearer\s+(\S+)$/.exec(request.headers.get('authorization') || '');
  if (!m) throw { status: 401, error: 'signed_out' };
  const uid = await verifyIdToken(m[1], sa.project_id);
  if (!uid) throw { status: 401, error: 'signed_out' };
  const db = firestore(sa.project_id, await googleToken(sa));
  const [member, setup] = await Promise.all([db.get('members/' + uid), db.get('config/setup')]);
  const owner = !!(setup && setup.owner === uid);
  const approved = !!(member && member.status === 'approved');
  if (!owner && !approved) throw { status: 403, error: 'not_approved' };
  return { uid, db, sa, owner, member: member || {}, admin: owner || (approved && member.role === 'admin'), name: member && member.name };
}
// Checks a Firebase sign-in token against Google's published keys. Returns the user id, or null.
let JWKS = null;
async function verifyIdToken(tok, pid) {
  try {
    const parts = String(tok).split('.');
    if (parts.length !== 3) return null;
    const json = (s) => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));
    const h = json(parts[0]), p = json(parts[1]);
    const now = Date.now() / 1000;
    if (h.alg !== 'RS256' || !h.kid) return null;
    if (p.aud !== pid || p.iss !== 'https://securetoken.google.com/' + pid) return null;
    if (typeof p.sub !== 'string' || !p.sub || p.sub.length > 128) return null;
    if (!(p.exp > now) || !(p.iat <= now + 300)) return null;
    let jwk = (await googleKeys(false)).find((k) => k.kid === h.kid);
    if (!jwk) jwk = (await googleKeys(true)).find((k) => k.kid === h.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
    return ok ? p.sub : null;
  } catch (e) { return null; }
}
async function googleKeys(fresh) {
  if (!fresh && JWKS && JWKS.exp > Date.now()) return JWKS.keys;
  const r = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  const d = await r.json().catch(() => null);
  if (!d || !Array.isArray(d.keys)) return (JWKS && JWKS.keys) || [];
  JWKS = { keys: d.keys, exp: Date.now() + 3600000 };
  return d.keys;
}
// The signing key for viewing links comes from the service account's private key, so there's no
// extra secret to set up and nobody outside the Worker can make a valid link.
let PKEY = null;
async function photoKey(sa) {
  if (PKEY && PKEY.email === sa.client_email) return PKEY.key;
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(sa.private_key) + '|gs-chat-photos'));
  const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  PKEY = { email: sa.client_email, key };
  return key;
}
async function photoSig(hk, key, exp) {
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', hk, new TextEncoder().encode(key + '|' + exp))));
}
async function photoServe(url, env) {
  const no = (s) => new Response(null, { status: s, headers: { 'cache-control': 'no-store' } });
  if (!env.PHOTOS || !env.FIREBASE_SERVICE_ACCOUNT) return no(404);
  const key = decodeURIComponent(url.pathname.slice(3));
  const exp = Number(url.searchParams.get('e'));
  const sig = url.searchParams.get('s') || '';
  if (!PHOTO_KEY.test(key) || !Number.isFinite(exp) || exp * 1000 < Date.now()) return no(403);
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  if (!sameText(sig, await photoSig(await photoKey(sa), key, exp))) return no(403);
  const obj = await env.PHOTOS.get(key);
  if (!obj) return no(404);
  return new Response(obj.body, {
    headers: {
      'content-type': 'image/jpeg',
      'cache-control': 'private, max-age=' + Math.max(0, Math.floor(exp - Date.now() / 1000)) + ', immutable',
      'x-content-type-options': 'nosniff'
    }
  });
}
function hexRand(n) { return Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join(''); }
function b64urlBytes(s) { return Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4)), (c) => c.charCodeAt(0)); }

// ---------- Tournament fees ----------
// Families pay with Venmo or Cash App right from the app; the Worker only sends reminders.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const money = (c) => '$' + (c % 100 ? (c / 100).toFixed(2) : String(c / 100));
const dueText = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || '')); return m ? MONTHS[Number(m[2]) - 1] + ' ' + Number(m[3]) : ''; };
// Where a reminder links to: the page the coach sent it from, if it's one of this team's sites.
function backUrl(back, allowed) {
  try {
    const u = new URL(String(back || ''));
    if (allowed.includes(u.origin) && (u.protocol === 'https:' || u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return u.origin + u.pathname;
  } catch (e) { /* fall through */ }
  return allowed[0] + '/';
}
async function payTask(task, request, body, env, reply, allowed) {
  let u;
  try { u = await hubUser(request, env); } catch (e) { return reply(e.status || 500, { error: e.error || 'upstream' }); }
  const m = u.member || {};
  const feeAccess = u.owner || (m.status === 'approved' && m.fees === true);
  try {
    if (task === 'fee-remind') {
      if (!feeAccess) return reply(403, { error: 'not_allowed' });
      const feeId = String(body.fee || '');
      if (!ID_RE.test(feeId)) return reply(400, { error: 'bad_request' });
      const fee = await u.db.get('fees/' + feeId);
      if (!fee || !Array.isArray(fee.players)) return reply(404, { error: 'no_fee' });
      const [members, tokens, pays, team] = await Promise.all([u.db.list('members'), u.db.list('pushTokens'), u.db.list('fees/' + feeId + '/pay'), u.db.get('team/main')]);
      const done = new Set(pays.filter((x) => x.status === 'paid').map((x) => x._id));
      const want = (Array.isArray(body.players) ? body.players.map(String) : fee.players).filter((pid) => fee.players.includes(pid) && !done.has(pid));
      const site = backUrl(body.back, allowed).replace(/\/$/, '');
      const name = (pid) => { const p = ((team && team.players) || []).find((x) => x.id === pid); return (p && p.name) || 'your player'; };
      const items = [], reached = [], noApp = [];
      for (const pid of want) {
        const fams = new Set(members.filter((x) => x.status === 'approved' && Array.isArray(x.players) && x.players.includes(pid)).map((x) => x._id));
        const toks = tokens.filter((t) => t.token && fams.has(t.uid));
        if (!toks.length) { noApp.push(name(pid)); continue; }
        reached.push(pid);
        const due = dueText(fee.due);
        for (const t of toks) items.push({ id: t._id, token: t.token, title: 'Fee reminder: ' + String(fee.name || 'Tournament'), body: money(Number(fee.amount) || 0) + ' for ' + name(pid) + (due ? ' is due ' + due : ' is due') + '. Tap to pay.', tag: 'fee-' + feeId + '-' + pid, link: site + '/#team', icon: site + '/icons/icon-192.png' });
      }
      if (items.length) await sendItems(u.sa.project_id, await googleToken(u.sa), items.slice(0, 60), u.db);
      return reply(200, { reminded: reached.length, noApp });
    }
    return reply(400, { error: 'bad_request' });
  } catch (e) {
    return reply(502, { error: 'upstream' });
  }
}
// ---------- Notifications ----------
// Watches Firestore with the service account (which skips the security rules) and sends phone
// notifications through Firebase Cloud Messaging. State lives in config/notify and is saved with
// a compare-and-swap, so a Cron run and a coach's check at the same moment never send twice.
let GTOK = null;
function b64url(bytes) { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
async function googleToken(sa) {
  if (GTOK && GTOK.email === sa.client_email && GTOK.exp > Date.now() + 120000) return GTOK.token;
  const now = Math.floor(Date.now() / 1000);
  const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = enc({ alg: 'RS256', typ: 'JWT' }) + '.' + enc({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
  const der = Uint8Array.from(atob(String(sa.private_key).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + unsigned + '.' + b64url(new Uint8Array(sig)) });
  const d = await r.json().catch(() => ({}));
  if (!d.access_token) throw new Error('Google sign-in for the service account failed');
  GTOK = { token: d.access_token, email: sa.client_email, exp: Date.now() + (Number(d.expires_in) || 3600) * 1000 };
  return GTOK.token;
}
function fsVal(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return Date.parse(v.timestampValue);
  if ('mapValue' in v) return fsObj(v.mapValue.fields);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fsVal);
  return null;
}
function fsObj(fields) { const o = {}; for (const k in fields || {}) o[k] = fsVal(fields[k]); return o; }
function fsEnc(v) {
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (v && typeof v === 'object') { const fields = {}; for (const k in v) fields[k] = fsEnc(v[k]); return { mapValue: { fields } }; }
  return { nullValue: null };
}
function firestore(pid, tok) {
  const base = 'https://firestore.googleapis.com/v1/projects/' + pid + '/databases/(default)/documents';
  const H = { Authorization: 'Bearer ' + tok, 'content-type': 'application/json' };
  const docOut = (d) => Object.assign(fsObj(d.fields), { _id: d.name.split('/').pop(), _updateTime: d.updateTime });
  return {
    async get(path) { const r = await fetch(base + '/' + path, { headers: H }); if (r.status === 404) return null; if (!r.ok) throw new Error('firestore get ' + r.status); return docOut(await r.json()); },
    // New document with a random id; timeField (if given) is set to the server's clock, like serverTimestamp().
    async create(col, data, timeField) {
      const id = hexRand(10);
      const write = { update: { name: 'projects/' + pid + '/databases/(default)/documents/' + col + '/' + id, fields: fsEnc(data).mapValue.fields }, currentDocument: { exists: false } };
      if (timeField) write.updateTransforms = [{ fieldPath: timeField, setToServerValue: 'REQUEST_TIME' }];
      const r = await fetch(base + ':commit', { method: 'POST', headers: H, body: JSON.stringify({ writes: [write] }) });
      return r.ok ? id : null;
    },
    async del(path) { const r = await fetch(base + '/' + path, { method: 'DELETE', headers: H }).catch(() => null); return !!(r && (r.ok || r.status === 404)); },
    async query(col, field, op, value, order, limit) {
      const q = { from: [{ collectionId: col }], where: { fieldFilter: { field: { fieldPath: field }, op, value } }, limit };
      if (order) q.orderBy = [{ field: { fieldPath: order }, direction: 'ASCENDING' }];
      const r = await fetch(base + ':runQuery', { method: 'POST', headers: H, body: JSON.stringify({ structuredQuery: q }) });
      if (!r.ok) throw new Error('firestore query ' + r.status);
      return (await r.json()).filter((x) => x.document).map((x) => docOut(x.document));
    },
    async list(col) { const r = await fetch(base + '/' + col + '?pageSize=300', { headers: H }); if (!r.ok) throw new Error('firestore list ' + r.status); return ((await r.json()).documents || []).map(docOut); },
    async saveState(state, updateTime) {
      const pre = updateTime ? 'currentDocument.updateTime=' + encodeURIComponent(updateTime) : 'currentDocument.exists=false';
      const r = await fetch(base + '/config/notify?' + pre, { method: 'PATCH', headers: H, body: JSON.stringify({ fields: { state: { stringValue: JSON.stringify(state) } } }) });
      return r.ok;
    },
    async remove(path) { await fetch(base + '/' + path, { method: 'DELETE', headers: H }).catch(() => {}); }
  };
}
const ORDN = (n) => n + ((n % 100 >= 11 && n % 100 <= 13) ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] || 'th'));
async function notifyRun(env, self, site) {
  if (!env.FIREBASE_SERVICE_ACCOUNT) return { skipped: 'not_configured' };
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  const pid = sa.project_id;
  const tok = await googleToken(sa);
  const db = firestore(pid, tok);
  const cur = await db.get('config/notify');
  const state = cur && cur.state ? JSON.parse(cur.state) : {};
  const before = JSON.stringify(state);
  const first = !state.msgAt;
  if (self) state.self = self;
  if (site) state.site = site;
  site = state.site || String(env.ALLOWED_ORIGIN || DEFAULT_ORIGIN).split(',')[0].trim();
  state.games = state.games || {};
  const out = [];

  // Team chat
  const since = state.msgAt || Date.now();
  const msgs = await db.query('messages', 'at', 'GREATER_THAN', { timestampValue: new Date(since).toISOString() }, 'at', 25);
  if (msgs.length) state.msgAt = Math.max(...msgs.map((m) => m.at || 0));
  else if (first) state.msgAt = since;
  // Chat notifications are worked out per person below, so nobody hears about their own messages
  // or about people they muted.
  const chatNew = first ? [] : msgs;

  // Coach announcements go to everyone with notifications on (not the coach who posted),
  // even if they turned team chat notifications off or muted that coach in the chat.
  const annFirst = !state.annAt;
  const annSince = state.annAt || Date.now();
  const anns = await db.query('announcements', 'at', 'GREATER_THAN', { timestampValue: new Date(annSince).toISOString() }, 'at', 10).catch(() => []);
  if (anns.length) state.annAt = Math.max(...anns.map((a) => a.at || 0));
  else if (annFirst) state.annAt = annSince;
  const annNew = annFirst ? [] : anns;

  // Games in progress: start, runs, half-innings, final
  const live = await db.query('games', 'status', 'EQUAL', { stringValue: 'live' }, null, 10);
  let teamName = state.team || 'GS Baseball';
  const line = (g, sum) => { const us = sum.us === 'home' ? sum.h : sum.a, them = sum.us === 'home' ? sum.a : sum.h; return { text: teamName + ' ' + us + ', ' + (g.opponent || 'Opponent') + ' ' + them, us, them }; };
  if (live.length || Object.keys(state.games).length) {
    const team = await db.get('team/main');
    if (team && team.name) teamName = state.team = team.name;
  }
  const seen = new Set();
  for (const g of live) {
    const sum = g.sum;
    seen.add(g._id);
    if (!sum) continue;
    const prev = state.games[g._id];
    state.games[g._id] = { a: sum.a, h: sum.h, i: sum.i, half: sum.half };
    if (first) continue;
    const L = line(g, sum), link = site + '/#live', tag = 'game-' + g._id;
    const where = (sum.half ? 'Bottom ' : 'Top ') + ORDN(sum.i);
    if (!prev) { out.push({ kind: 'score', level: 'runs', title: teamName + (g.home ? ' vs ' : ' at ') + (g.opponent || 'Opponent') + ' is underway', body: 'Follow it live in GS Baseball Hub.', tag, link }); continue; }
    const runs = prev.a !== sum.a || prev.h !== sum.h;
    const turned = prev.i !== sum.i || prev.half !== sum.half;
    if (runs) out.push({ kind: 'score', level: 'runs', title: 'Run scores! ' + L.text, body: turned ? (sum.half ? 'Middle of the ' + ORDN(sum.i) : 'End of the ' + ORDN(sum.i - 1)) : where + ', ' + (sum.o || 0) + ' out' + (sum.o === 1 ? '' : 's'), tag, link });
    else if (turned) out.push({ kind: 'score', level: 'all', title: L.text, body: sum.half ? 'Middle of the ' + ORDN(sum.i) : 'End of the ' + ORDN(sum.i - 1), tag, link });
  }
  for (const gid of Object.keys(state.games)) {
    if (seen.has(gid)) continue;
    delete state.games[gid];
    const g = await db.get('games/' + gid);
    if (!first && g && g.status === 'final' && g.sum) {
      const L = line(g, g.sum);
      out.push({ kind: 'score', level: 'runs', title: 'Final: ' + L.text, body: L.us > L.them ? teamName + ' win!' : L.us < L.them ? teamName + ' lose. On to the next one.' : 'It ends in a tie.', tag: 'game-' + gid, link: site + '/#games' });
    }
  }

  if (JSON.stringify(state) === before) return { sent: 0 };
  if (!(await db.saveState(state, cur ? cur._updateTime : null))) return { sent: 0, raced: true };
  if (!out.length && !chatNew.length && !annNew.length) return { sent: 0 };

  // Who gets what: approved members (or the owner) with the matching setting on, never the sender,
  // and no chat messages from people they muted (prefs/{uid}.mute, a map of muted uid -> name).
  const [tokens, members, setup, prefs] = await Promise.all([db.list('pushTokens'), db.list('members'), db.get('config/setup'), chatNew.length ? db.list('prefs').catch(() => []) : []]);
  const ok = new Set(members.filter((m) => m.status === 'approved').map((m) => m._id));
  if (setup && setup.owner) ok.add(setup.owner);
  const muted = new Map(prefs.map((x) => [x._id, x.mute && typeof x.mute === 'object' ? x.mute : {}]));
  const icon = site + '/icons/icon-192.png';
  const link = site + '/#chat';
  const say = (m, n) => (m.photo ? '📷 Photo' + (m.text ? ': ' : '') : '') + String(m.text || '').slice(0, n);
  const items = [];
  for (const t of tokens) {
    if (!t.token || !ok.has(t.uid)) continue;
    for (const a of annNew) if (a.uid !== t.uid) items.push({ id: t._id, token: t.token, title: '📣 ' + (a.name || 'Coach'), body: String(a.text || '').slice(0, 180), tag: 'ann-' + a._id, link: site + '/#news', icon });
    if (chatNew.length && t.chat !== false) {
      const mute = muted.get(t.uid) || {};
      const see = chatNew.filter((m) => m.uid !== t.uid && !mute[m.uid]);
      if (see.length <= 3) for (const m of see) items.push({ id: t._id, token: t.token, title: (m.name || 'Team chat') + (m.coach ? ' (Coach)' : ''), body: say(m, 160), tag: 'chat-' + m._id, link, icon });
      else { const last = see[see.length - 1]; items.push({ id: t._id, token: t.token, title: see.length + ' new messages in team chat', body: (last.name || '') + ': ' + say(last, 120), tag: 'chat', link, icon }); }
    }
    for (const n of out) {
      if (n.kind === 'score' && (t.scores === 'off' || (n.level === 'all' && t.scores !== 'all'))) continue;
      items.push({ id: t._id, token: t.token, title: n.title, body: n.body, tag: n.tag, link: n.link, icon });
    }
  }
  const INLINE = 30;
  await sendItems(pid, tok, items.slice(0, INLINE), db);
  const target = env.WORKER_URL || state.self;
  for (let i = INLINE; i < items.length && target; i += 40) {
    await fetch(target, { method: 'POST', headers: { 'content-type': 'application/json', 'x-gs-internal': String(env.ACCESS_CODE || '') }, body: JSON.stringify({ task: 'notify-send', pid, gtok: tok, items: items.slice(i, i + 40) }) }).catch(() => {});
  }
  return { sent: items.length };
}
async function sendItems(pid, tok, items, db) {
  const gone = [];
  await Promise.all(items.map(async (it) => {
    const r = await fetch('https://fcm.googleapis.com/v1/projects/' + pid + '/messages:send', {
      method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'content-type': 'application/json' },
      body: JSON.stringify({ message: { token: it.token, webpush: { headers: { Urgency: 'high', TTL: '3600' }, notification: { title: it.title, body: it.body, icon: it.icon, tag: it.tag, renotify: true }, fcm_options: { link: it.link } } } })
    }).catch(() => null);
    if (r && (r.status === 404 || r.status === 400)) { const t = await r.text().catch(() => ''); if (/UNREGISTERED|registration-token-not-registered|not a valid FCM registration token/i.test(t)) gone.push(it.id); }
  }));
  if (gone.length && db) for (const id of [...new Set(gone)].slice(0, 5)) await db.remove('pushTokens/' + id);
}

function sameText(a, b) {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}
