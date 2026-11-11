'use strict';
/* Imports masjids that run Mawaqit: their whole year, from their own page.
 *
 *   node mawaqit-import.js            every masjid in sources-mawaqit.json
 *   node mawaqit-import.js icbab      just one
 *
 * Each entry needs only an id and the masjid's mawaqit.net address; name, position, zone and Jumu'ah
 * come from the page. Re-run it whenever you like -- a masjid that changes its times on Mawaqit is
 * picked up on the next run, and the output is one day per line so the change shows as a small diff.
 */
const fs = require('fs'), path = require('path');
const mawaqit = require('./adapters/mawaqit.js');
const ROOT = __dirname, OUT = path.join(ROOT, 'data', 'schedules');

function serialise(s) {
  const head = {}; Object.keys(s).forEach(k => { if (k !== 'days') head[k] = s[k]; });
  const lines = Object.keys(s.days).sort().map(d => '  ' + JSON.stringify(d) + ': ' + JSON.stringify(s.days[d]));
  return JSON.stringify(head).replace(/\}$/, '') + ',\n "days": {\n' + lines.join(',\n') + '\n }\n}\n';
}

async function page(entry) {
  if (entry.file) return fs.readFileSync(path.resolve(ROOT, entry.file), 'utf8');      /* a saved copy, for testing */
  const r = await fetch(entry.url, { headers: { 'User-Agent': 'SalahOS-schedule-import/1.0 (+https://salah-os.web.app)', 'Accept': 'text/html' } });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' from ' + entry.url);
  return r.text();
}

async function run(entry) {
  const label = entry.id.padEnd(8);
  try {
    const { days, warn, meta } = mawaqit.parse(await page(entry), { year: entry.year });
    /* Some masjids list the time the Fajr adhan is called in Mawaqit's single "iqama" column, and stand
       for the prayer a few minutes later. Where someone who prays there has said so, the listed time is
       kept as the adhan, the iqamah follows it, and dawn is kept separately because the fast starts then. */
    if (entry.fajrListedIsAdhan != null) Object.keys(days).forEach(d => { const r = days[d]; if (!r.fajr[1]) return;
      const t = r.fajr[1], m = (+t.slice(0, 2)) * 60 + (+t.slice(3)) + (+entry.fajrListedIsAdhan);
      r.dawn = r.fajr[0]; r.fajr = [t, String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0')]; });
    const dates = Object.keys(days).sort();
    if (dates.length < 365) throw new Error('only ' + dates.length + ' days on the page');
    const sched = { id: entry.id, name: entry.name || meta.name, address: entry.address || '', tz: entry.tz || meta.tz,
      source: 'The masjid\'s own Mawaqit timetable', sourceUrl: entry.url || null, lat: meta.lat, lon: meta.lon,
      jumuah: entry.jumuah || meta.jumuah, days };
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, entry.id + '.json'), serialise(sched));
    const problems = mawaqit.check(days);
    console.log(label + ' ok       ' + dates.length + ' days, ' + dates[0] + ' to ' + dates[dates.length - 1] + '  ' + sched.name);
    warn.slice(0, 5).forEach(w => console.log('         ! ' + w));
    problems.forEach(w => console.log('         ? ' + w + '  (the masjid should check this)'));
    return true;
  } catch (e) { console.log(label + ' failed   ' + e.message); return false; }
}

(async () => {
  const only = process.argv[2], conf = JSON.parse(fs.readFileSync(path.join(ROOT, 'sources-mawaqit.json'), 'utf8'));
  const list = only ? conf.filter(e => e.id === only) : conf;
  if (!list.length) { console.log('no masjid with id "' + only + '" in sources-mawaqit.json'); process.exit(1); }
  let ok = 0; for (const e of list) if (await run(e)) ok++;
  console.log('\n' + ok + ' of ' + list.length + ' imported');
})();
