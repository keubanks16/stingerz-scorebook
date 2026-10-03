// GS Baseball Scorebook: Claude helper for the GitHub Pages copy (Cloudflare Worker).
//
// The scorebook is a public website, so your Anthropic API key can't live in it.
// This Worker keeps the key on Cloudflare and only does two jobs for the scorebook:
// reading roster photos and writing scouting reports.
//
// Set these in the Worker's Settings -> Variables and Secrets:
//   ANTHROPIC_API_KEY  Secret  your key from console.anthropic.com
//   ACCESS_CODE        Secret  any passphrase you make up; type the same one into the scorebook
//   ALLOWED_ORIGIN     Text    optional; defaults to the scorebook site and keubanks16.github.io
//   MODEL              Text    optional; defaults to claude-sonnet-5-5

const DEFAULT_ORIGIN = 'https://scorebook.stingerz-baseball.com,https://keubanks16.github.io';
const DEFAULT_MODEL = 'claude-sonnet-5-5';
const TASKS = { roster: 2000, scout: 1000, ping: 5 }; // max output tokens per job
const MAX_PROMPT_CHARS = 24000;
const MAX_IMAGES = 5;
const MAX_IMAGE_B64 = 6000000; // about 4.5 MB per image
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = String(env.ALLOWED_ORIGIN || DEFAULT_ORIGIN).split(',').map((s) => s.trim()).filter(Boolean);
    const originOk = allowed.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': originOk ? origin : allowed[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type, x-gs-code',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin'
    };
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return reply(405, { error: 'bad_request', detail: 'Use POST.' });
    if (!originOk) return reply(403, { error: 'origin', detail: 'This site is not in ALLOWED_ORIGIN.' });
    if (!env.ANTHROPIC_API_KEY || !env.ACCESS_CODE) return reply(500, { error: 'not_configured', detail: 'Add ANTHROPIC_API_KEY and ACCESS_CODE as secrets.' });
    if (!sameText(request.headers.get('x-gs-code') || '', String(env.ACCESS_CODE))) return reply(401, { error: 'bad_code' });

    let body;
    try { body = await request.json(); } catch (e) { return reply(400, { error: 'bad_request' }); }
    const task = body && body.task;
    if (!Object.prototype.hasOwnProperty.call(TASKS, task)) return reply(400, { error: 'bad_request', detail: 'Unknown task.' });

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
        body: JSON.stringify({ model: env.MODEL || DEFAULT_MODEL, max_tokens: TASKS[task], messages: [{ role: 'user', content }] })
      });
    } catch (e) {
      return reply(502, { error: 'upstream', detail: 'Could not reach the Claude API.' });
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

function sameText(a, b) {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}
