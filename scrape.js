'use strict';
/* Fetches each masjid's published timetable and writes it where the frames can read it.
   Never replaces a good schedule with a worse one, and reports how far ahead each masjid still reaches —
   that is the number worth alerting on, not when it was last checked. */
const fs = require('fs'), path = require('path');
const { get } = require('./lib/fetch');
const { writeJson, validate, coverage, today, daysBetween } = require('./lib/util');

const ADAPTERS = { table: require('./adapters/table') };
const OUT = path.join(__dirname, 'data');
const WARN_DAYS = 21;          /* shout when a masjid has less than three weeks left */

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; } }

async function one(src) {
  const r = { id: src.id, name: src.name, url: src.url, adapter: src.adapter, checked: new Date().toISOString() };
  const adapter = ADAPTERS[src.adapter];
  if (!adapter) { r.status = 'failed'; r.error = 'no adapter called "' + src.adapter + '"'; return r; }

  const res = await get(src.url, { cacheDir: path.join(__dirname, '.cache') });
  if (!res.body) { r.status = 'failed'; r.error = res.error || ('HTTP ' + res.status); return r; }
  r.notModified = !!res.notModified;

  let parsed;
  try { parsed = adapter.parse(res.body, { pageTitle: src.pageTitle || src.name, hint: src.hint }); }
  catch (e) { r.status = 'failed'; r.error = 'parse threw: ' + (e && e.message); return r; }

  const check = validate(parsed.days);
  const cov = coverage(parsed.days);
  r.days = cov.days; r.coverageTo = cov.to; r.daysLeft = cov.daysLeft;

  const file = path.join(OUT, 'schedules', src.id.replace(/[^a-z0-9]+/gi, '_') + '.json');
  const prev = readJson(file, null);
  const prevCov = prev ? coverage(prev.days) : { daysLeft: -1, days: 0 };

  if (!check.ok) {
    r.status = 'rejected'; r.error = check.problems.slice(0, 3).join('; ');
    r.keptPrevious = !!prev;
    return r;                                  /* the old file stays exactly as it was */
  }
  /* Only publish if this reaches at least as far as what we already have. */
  if (prev && cov.daysLeft < prevCov.daysLeft) {
    r.status = 'ignored'; r.error = 'reaches ' + cov.daysLeft + ' days, already have ' + prevCov.daysLeft;
    return r;
  }
  writeJson(file, {
    id: src.id, name: src.name, tz: src.tz || null, lat: src.lat || null, lon: src.lon || null,
    source: { url: src.url, adapter: src.adapter, fetched: today(), attribution: 'Times published by ' + src.name },
    coverage: cov, jumuah: parsed.jumuah || src.jumuah || null, days: parsed.days
  });
  r.status = cov.daysLeft < WARN_DAYS ? 'thin' : 'ok';
  return r;
}

async function main() {
  const sources = readJson(path.join(__dirname, 'sources.json'), []).filter(s => s.enabled !== false);
  if (!sources.length) { console.log('No enabled sources in sources.json — nothing to do.'); return; }
  console.log('Checking ' + sources.length + ' masjid' + (sources.length > 1 ? 's' : '') + '\n');
  const results = [];
  for (const src of sources) {
    const r = await one(src);
    results.push(r);
    const tail = r.status === 'ok' || r.status === 'thin'
      ? r.days + ' days, reaches ' + r.coverageTo + ' (' + r.daysLeft + ' left)' + (r.notModified ? ', unchanged' : '')
      : (r.error || '');
    console.log('  ' + String(r.status).toUpperCase().padEnd(9) + (r.name || r.id) + ' — ' + tail);
  }
  const health = {
    updated: new Date().toISOString(),
    summary: ['ok', 'thin', 'rejected', 'ignored', 'failed'].reduce((o, k) => (o[k] = results.filter(r => r.status === k).length, o), {}),
    masjids: results
  };
  writeJson(path.join(OUT, 'health.json'), health);
  const bad = results.filter(r => r.status === 'failed' || r.status === 'rejected');
  const thin = results.filter(r => r.status === 'thin');
  console.log('\n' + health.summary.ok + ' ok, ' + thin.length + ' running thin, ' + bad.length + ' need attention');
  if (thin.length) console.log('  thin: ' + thin.map(r => r.name + ' (' + r.daysLeft + 'd)').join(', '));
  if (bad.length) console.log('  broken: ' + bad.map(r => r.name).join(', '));
}

module.exports = { one };
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
