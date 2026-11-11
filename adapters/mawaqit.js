'use strict';
/* Reads a masjid's own page on mawaqit.net and turns it into a full-year schedule.
 *
 * Mawaqit is a display system masjids run themselves, so what it holds is the masjid's own word: a
 * calendar of when each prayer begins and when the congregation stands, for every day of the year.
 * That makes it the one online source that passes the test the aggregators failed -- it has a date
 * dimension, and the masjid maintains it. The page carries all of it in one object, `confData`.
 *
 * This file takes the page's HTML as text. Fetching is the caller's business.
 */

const pad = n => (n < 10 ? '0' : '') + n;
const leap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;
const norm = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '').trim()); return m ? pad(+m[1]) + ':' + m[2] : null; };
const toMin = t => (+t.slice(0, 2)) * 60 + (+t.slice(3));
const fromMin = m => { m = ((m % 1440) + 1440) % 1440; return pad(Math.floor(m / 60)) + ':' + pad(m % 60); };

/* The object is assigned in an inline script. It is cut out by counting braces rather than with a
   greedy pattern, because the JSON itself is full of braces and the script goes on after it. */
function extract(html) {
  const at = html.search(/confData\s*=\s*\{/);
  if (at < 0) throw new Error('no confData on the page -- is this a mawaqit.net masjid page?');
  const start = html.indexOf('{', at);
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) return JSON.parse(html.slice(start, i + 1)); }
  }
  throw new Error('confData never closes');
}

/* An iqama entry is either a clock time or "+N" minutes after the adhan; both are in use. */
function iqama(v, adhan) {
  const s = String(v == null ? '' : v).trim();
  if (/^\+?\d{1,3}$/.test(s)) return fromMin(toMin(adhan) + parseInt(s.replace('+', ''), 10));
  return norm(s);
}

function parse(html, opts) {
  opts = opts || {};
  const c = extract(html), year = opts.year || new Date().getFullYear();
  const cal = c.calendar, iq = c.iqamaCalendar || [];
  if (!Array.isArray(cal) || cal.length !== 12) throw new Error('this masjid has no yearly calendar on Mawaqit');
  const days = {}, warn = [];
  for (let m = 0; m < 12; m++) {
    Object.keys(cal[m] || {}).map(Number).sort((a, b) => a - b).forEach(d => {
      if (m === 1 && d === 29 && !leap(year)) return;          /* the calendar always carries 29 February */
      const date = year + '-' + pad(m + 1) + '-' + pad(d), row = (cal[m][d] || []).map(norm);
      if (row.length < 6 || row.some(x => !x)) { warn.push(date + ': unreadable times ' + JSON.stringify(cal[m][d])); return; }
      /* calendar: fajr, sunrise, dhuhr, asr, maghrib, isha.  iqamaCalendar: the five prayers. */
      const ad = [row[0], row[2], row[3], row[4], row[5]];
      const qi = ((iq[m] || {})[d] || []);
      const pair = k => [ad[k], qi[k] != null ? iqama(qi[k], ad[k]) : null];
      days[date] = { fajr: pair(0), sunrise: row[1], dhuhr: pair(1), asr: pair(2), maghrib: pair(3), isha: pair(4) };
    });
  }
  const jumuah = [c.jumua, c.jumua2, c.jumua3].map(norm).filter(Boolean);
  return { days, warn, meta: { name: c.label || c.name, lat: c.latitude, lon: c.longitude, tz: c.timezone, jumuah, countryCode: c.countryCode } };
}

/* What the masjid's own entries get wrong. Reported, never corrected. */
function check(days) {
  const out = [], dates = Object.keys(days).sort();
  const sunrise = dates.filter(d => days[d].fajr[1] && toMin(days[d].fajr[1]) >= toMin(days[d].sunrise));
  if (sunrise.length) out.push('Fajr iqamah is at or after sunrise on ' + sunrise.length + ' days, beginning ' + sunrise[0]);
  ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'].forEach(p => {
    const early = dates.filter(d => days[d][p][1] && toMin(days[d][p][1]) < toMin(days[d][p][0]));
    if (early.length) out.push(p + ' iqamah is before the adhan on ' + early.length + ' days, beginning ' + early[0]);
  });
  return out;
}

module.exports = { extract, parse, check };
