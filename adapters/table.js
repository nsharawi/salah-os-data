'use strict';
/* Reads a prayer timetable laid out as an HTML table — by far the most common shape on masjid sites.
   Works out which column is which from the header row, so column order does not matter. */
const { tables } = require('../lib/html');
const { toHHMM, pad, PRAYERS } = require('../lib/util');

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/* Column names seen in the wild, in English and Arabic. */
const COLS = [
  ['date',    /^(date|day|التاريخ|اليوم)\b/i],
  ['fajr',    /\b(fajr|fajer|fjr|subh|الفجر)\b/i],
  ['sunrise', /\b(sunrise|shuruq|shurooq|shurook|الشروق)\b/i],
  ['dhuhr',   /\b(dhuhr|duhr|zuhr|dhur|thuhr|الظهر)\b/i],
  ['asr',     /\b(asr|assr|العصر)\b/i],
  ['maghrib', /\b(maghrib|magrib|maghreb|المغرب)\b/i],
  ['isha',    /\b(isha|esha|ishaa|العشاء)\b/i],
  ['jumuah',  /\b(jum[ua]'?ah?|friday|الجمعة)\b/i]
];
/* Never treat these as a prayer column. */
const IQAMA = /(\biqam|\bjama|\bjema|الإقامة|اقامة)/i;          /* prefix match: "Iqamah", "Iqama", "Jamaah" */
const ADHAN = /(\badhan|\bathan|\bazan|\bbegins|\bstart|الأذان|اذان)/i;

const noPM = { fajr: true, sunrise: true };

function monthFromText(s) {
  const m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*,?\s*(\d{4})?/i.exec(s || '');
  if (!m) return null;
  return { month: MONTHS.indexOf(m[1].toLowerCase()) + 1, year: m[2] ? Number(m[2]) : null };
}

/* "Nov 1", "1 Nov 2026", "11/01/2026", "1" (with a month hint) -> "YYYY-MM-DD" */
function parseDate(cell, hint) {
  const s = String(cell || '').trim();
  let m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return m[1] + '-' + pad(+m[2]) + '-' + pad(+m[3]);
  m = /(\d{1,2})\s*[\/.]\s*(\d{1,2})\s*[\/.]\s*(\d{2,4})/.exec(s);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; return y + '-' + pad(+m[1]) + '-' + pad(+m[2]); }   /* US order */
  m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*(\d{1,2})\b/i.exec(s);
  if (m) { const mo = MONTHS.indexOf(m[1].toLowerCase()) + 1, d = +m[2], y = (hint && hint.year) || new Date().getUTCFullYear();
    return y + '-' + pad(mo) + '-' + pad(d); }
  m = /\b(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\b/i.exec(s);
  if (m) { const mo = MONTHS.indexOf(m[2].toLowerCase()) + 1, d = +m[1], y = (hint && hint.year) || new Date().getUTCFullYear();
    return y + '-' + pad(mo) + '-' + pad(d); }
  m = /^(\d{1,2})$/.exec(s);
  if (m && hint && hint.month) { const y = hint.year || new Date().getUTCFullYear();
    return y + '-' + pad(hint.month) + '-' + pad(+m[1]); }
  return null;
}

/* Map each column index to { key, kind } where kind is 'adhan' or 'iqamah'. */
function readHeader(rows) {
  for (let r = 0; r < Math.min(rows.length, 4); r++) {
    const head = rows[r], map = {};
    let hits = 0;
    head.forEach((cell, i) => {
      for (const [key, re] of COLS) {
        if (re.test(cell)) {
          const kind = IQAMA.test(cell) ? 'iqamah' : 'adhan';
          map[i] = { key, kind };
          if (key !== 'date' && key !== 'jumuah') hits++;
          break;
        }
      }
    });
    /* A real schedule header names at least four of the five prayers. */
    const named = new Set(Object.values(map).filter(v => PRAYERS.includes(v.key)).map(v => v.key));
    if (named.size >= 4) return { headerRow: r, map };
  }
  return null;
}

/**
 * parse(html, opts) -> { days, jumuah, note }
 * opts.hint: { month, year } for tables that show only a day number.
 */
function parse(html, opts = {}) {
  const hint = opts.hint || monthFromText(opts.pageTitle) || null;
  const all = tables(html);
  const days = {};
  let jumuah = null, used = 0;

  for (const rows of all) {
    const h = readHeader(rows);
    if (!h) continue;
    used++;
    for (let r = h.headerRow + 1; r < rows.length; r++) {
      const row = rows[r];
      let date = null; const vals = {};
      for (const idxStr of Object.keys(h.map)) {
        const i = Number(idxStr), { key, kind } = h.map[i], cell = row[i];
        if (cell == null) continue;
        if (key === 'date') { date = parseDate(cell, hint); continue; }
        if (key === 'jumuah') { const t = toHHMM(cell, { pmIfBefore: 11 }); if (t && !jumuah) jumuah = [t]; continue; }
        const t = toHHMM(cell, noPM[key] ? {} : { pmIfBefore: 11 });
        if (t) { vals[key] = vals[key] || {}; vals[key][kind] = t; }
      }
      if (!date || !PRAYERS.every(p => vals[p] && vals[p].adhan)) continue;
      const out = {};
      if (vals.sunrise && vals.sunrise.adhan) out.sunrise = vals.sunrise.adhan;
      PRAYERS.forEach(p => { out[p] = [vals[p].adhan, vals[p].iqamah || null]; });
      days[date] = out;
    }
  }
  return { days, jumuah, note: used ? used + ' table(s) read' : 'no prayer table found' };
}

module.exports = { parse, parseDate, readHeader, monthFromText };
