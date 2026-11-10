'use strict';
/* Shared helpers for the Salah OS scraper. */
const fs = require('fs'), path = require('path');

const pad = n => String(n).padStart(2, '0');
const iso = d => d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
const today = () => iso(new Date());
const addDays = (isoDate, n) => { const [y, m, d] = isoDate.split('-').map(Number);
  return iso(new Date(Date.UTC(y, m - 1, d + n))); };
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);

/* "5:07 pm", "17:07", "١٧:٠٧" -> "17:07". Returns null when it is not a time at all. */
function toHHMM(raw, opts) {
  if (raw == null) return null;
  let s = String(raw).replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x0660))
                     .replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 0x06F0))
                     .replace(/‏|‎/g, '').trim().toLowerCase();
  const m = /(\d{1,2})\s*[:.٭]\s*(\d{2})\s*(a\.?m\.?|p\.?m\.?|ص|م)?/.exec(s);
  if (!m) return null;
  let h = Number(m[1]); const min = Number(m[2]), ap = (m[3] || '').replace(/\./g, '');
  if (min > 59 || h > 23) return null;
  if (ap === 'pm' || ap === 'م') { if (h < 12) h += 12; }
  else if (ap === 'am' || ap === 'ص') { if (h === 12) h = 0; }
  else if (opts && opts.pmIfBefore != null && h < opts.pmIfBefore) h += 12;   /* bare "5:07" in an evening column */
  return pad(h) + ':' + pad(min);
}

const PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

/* A schedule is only worth publishing if its days are complete and in order. */
function validate(days) {
  const problems = [], dates = Object.keys(days).sort();
  if (!dates.length) return { ok: false, problems: ['no days at all'] };
  for (const d of dates) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { problems.push('bad date key ' + d); continue; }
    const row = days[d];
    for (const p of PRAYERS) {
      const v = row[p];
      if (!Array.isArray(v) || !v[0]) { problems.push(d + ': missing ' + p); continue; }
      if (!/^\d{2}:\d{2}$/.test(v[0])) problems.push(d + ': bad ' + p + ' "' + v[0] + '"');
    }
    const mins = p => { const v = row[p] && row[p][0]; return v ? Number(v.slice(0, 2)) * 60 + Number(v.slice(3)) : null; };
    const f = mins('fajr'), dh = mins('dhuhr'), a = mins('asr'), mg = mins('maghrib'), is = mins('isha');
    if (f != null && dh != null && a != null && mg != null && !(f < dh && dh < a && a < mg)) problems.push(d + ': prayers out of order');
    if (mg != null && is != null && is <= mg && is > 180) problems.push(d + ': isha before maghrib');
  }
  /* A gap in the dates usually means a parsing slip rather than a real break in the schedule. */
  for (let i = 1; i < dates.length; i++) if (daysBetween(dates[i - 1], dates[i]) !== 1) problems.push('gap between ' + dates[i - 1] + ' and ' + dates[i]);
  return { ok: problems.length === 0, problems: problems.slice(0, 20), count: dates.length };
}

/* How far ahead this schedule still reaches — the number that matters for alerting. */
function coverage(days) {
  const dates = Object.keys(days).sort();
  if (!dates.length) return { from: null, to: null, days: 0, daysLeft: 0 };
  const t = today();
  return { from: dates[0], to: dates[dates.length - 1], days: dates.length,
           daysLeft: Math.max(0, daysBetween(t, dates[dates.length - 1])) };
}

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1) + '\n');
  fs.renameSync(tmp, file);
}

module.exports = { pad, iso, today, addDays, daysBetween, toHHMM, PRAYERS, validate, coverage, writeJson };
