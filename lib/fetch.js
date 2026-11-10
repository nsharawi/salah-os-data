'use strict';
/* Polite fetching. One request at a time, a real gap between hits on the same host, robots.txt honoured,
   and conditional requests so an unchanged page costs the site almost nothing. */
const fs = require('fs'), path = require('path');

const UA = 'SalahOS/1.0 (+https://salah-os.web.app) prayer-times reader';
const MIN_GAP_MS = 4000;          /* between two requests to the same host */
const TIMEOUT_MS = 30000;

const lastHit = {}, robots = {};
const sleep = ms => new Promise(r => setTimeout(r, ms));

function cacheFile(dir, url) {
  const safe = url.replace(/[^a-z0-9]+/gi, '_').slice(0, 120);
  return path.join(dir, safe + '.json');
}

async function robotsAllows(url) {
  const u = new URL(url), origin = u.origin;
  if (!(origin in robots)) {
    robots[origin] = null;
    try {
      const r = await fetch(origin + '/robots.txt', { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) });
      robots[origin] = r.ok ? await r.text() : '';
    } catch (e) { robots[origin] = ''; }
  }
  const txt = robots[origin];
  if (!txt) return true;
  /* Only the rules that apply to everyone; we never claim to be another agent. */
  const lines = txt.split(/\r?\n/).map(l => l.replace(/#.*/, '').trim());
  let applies = false; const disallow = [];
  for (const line of lines) {
    const m = /^(user-agent|disallow|allow)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === 'user-agent') applies = (val === '*');
    else if (applies && key === 'disallow' && val) disallow.push(val);
    else if (applies && key === 'allow' && val) disallow.push('!' + val);
  }
  let blocked = false;
  for (const rule of disallow) {
    if (rule[0] === '!') { if (u.pathname.startsWith(rule.slice(1))) blocked = false; }
    else if (u.pathname.startsWith(rule)) blocked = true;
  }
  return !blocked;
}

/** A POST, for services that want the query in the body (Overpass). Not cached; retries a busy server. */
async function post(url, body, opts = {}) {
  const tries = opts.tries || 3;
  for (let i = 0; i < tries; i++) {
    const host = new URL(url).host, wait = (lastHit[host] || 0) + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastHit[host] = Date.now();
    try {
      const r = await fetch(url, { method: 'POST', body,
        headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded' },
        signal: AbortSignal.timeout(opts.timeout || 240000) });
      if (r.ok) return { status: r.status, body: await r.text() };
      /* 429 and the 5xx family mean "busy, come back" rather than "no" — wait longer each time. */
      if (![429, 502, 503, 504].includes(r.status) || i === tries - 1) return { status: r.status, error: 'HTTP ' + r.status, body: null };
      await sleep(15000 * (i + 1));
    } catch (e) {
      if (i === tries - 1) return { status: 0, error: String(e && e.message || e), body: null };
      await sleep(15000 * (i + 1));
    }
  }
  return { status: 0, error: 'gave up', body: null };
}

/** Returns { status, body, fromCache, notModified } — never throws for an ordinary failure. */
async function get(url, opts = {}) {
  const dir = opts.cacheDir || path.join(__dirname, '..', '.cache');
  fs.mkdirSync(dir, { recursive: true });
  const cf = cacheFile(dir, url);
  let cached = null;
  try { cached = JSON.parse(fs.readFileSync(cf, 'utf8')); } catch (e) {}

  if (!opts.skipRobots && !(await robotsAllows(url))) return { status: 0, error: 'robots.txt disallows this path', body: null };

  const host = new URL(url).host, wait = (lastHit[host] || 0) + MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastHit[host] = Date.now();

  const headers = { 'user-agent': UA, 'accept-language': 'en,ar;q=0.8' };
  if (cached && cached.etag) headers['if-none-match'] = cached.etag;
  if (cached && cached.lastModified) headers['if-modified-since'] = cached.lastModified;

  try {
    const r = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(opts.timeout || TIMEOUT_MS) });
    if (r.status === 304 && cached) return { status: 304, body: cached.body, fromCache: true, notModified: true };
    if (!r.ok) return { status: r.status, error: 'HTTP ' + r.status, body: cached ? cached.body : null, fromCache: !!cached };
    const body = opts.binary ? Buffer.from(await r.arrayBuffer()).toString('base64') : await r.text();
    try {
      fs.writeFileSync(cf, JSON.stringify({ url, at: new Date().toISOString(), etag: r.headers.get('etag'),
        lastModified: r.headers.get('last-modified'), body }));
    } catch (e) {}
    return { status: r.status, body, fromCache: false };
  } catch (e) {
    return { status: 0, error: String(e && e.message || e), body: cached ? cached.body : null, fromCache: !!cached };
  }
}

module.exports = { get, post, robotsAllows, UA, MIN_GAP_MS };
