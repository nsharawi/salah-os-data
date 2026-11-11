'use strict';
/* Reads a masjid's printed year calendar and turns it into a schedule.
 *
 * A yearly PDF is the richest thing a masjid publishes: every day, azaan and iqama, with the clock
 * changes already baked in. It is also the only artefact that carries all 365 days, so for a masjid
 * that prints one, this is the whole job -- no weekly scraping, no staleness.
 *
 * This file takes TEXT, not a PDF. Extraction is a separate, swappable step (pdftotext -layout, or
 * anything else that preserves columns), which keeps the parser dependency-free and testable, and
 * means a masjid that mails a spreadsheet can go through the same code.
 */

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
                'july', 'august', 'september', 'october', 'november', 'december'];
const DIM = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const leap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const dim = (m, y) => (m === 1 && leap(y) ? 29 : DIM[m]);

/* Which prayer each printed column belongs to, in the order the columns appear. A masjid that prints
   a different set of columns gets a new entry here rather than a new parser. */
const LAYOUTS = {
  /* MCA and Masjid An-Noor, Santa Clara: three months side by side, each day one row.
     No Maghrib iqama column -- it is called a few minutes after the azaan (see maghribIqama). */
  'azaan-iqama-10': ['fajr.azaan', 'fajr.iqama', 'sunrise', 'dhuhr.azaan', 'dhuhr.iqama',
                     'asr.azaan', 'asr.iqama', 'maghrib.azaan', 'isha.azaan', 'isha.iqama'],
  /* Same, for a masjid that does print a Maghrib iqama. */
  'azaan-iqama-11': ['fajr.azaan', 'fajr.iqama', 'sunrise', 'dhuhr.azaan', 'dhuhr.iqama',
                     'asr.azaan', 'asr.iqama', 'maghrib.azaan', 'maghrib.iqama', 'isha.azaan', 'isha.iqama']
};

/* Printed calendars almost never mark am/pm -- the reader knows Asr is in the afternoon. The hour a
   prayer can fall in is what disambiguates, and these windows are wide enough for any latitude we
   serve while still leaving only one possible reading of each token. Deliberately not done by
   assuming the times ascend: one misread token would then drag every later one with it. */
const WINDOW = {
  fajr:    [2, 9],
  sunrise: [4, 11],
  dhuhr:   [11, 16],
  asr:     [12, 20],
  maghrib: [15, 23],
  isha:    [16, 24]
};

const pad = n => (n < 10 ? '0' : '') + n;

function resolveTime(tok, prayer) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(tok);
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (h < 1 || h > 23 || mi > 59) return null;
  const w = WINDOW[prayer] || [0, 24];
  /* 12:xx is noon or midnight; 1-11 could be either half of the day; 13+ is already unambiguous. */
  const cands = h === 12 ? [12, 0] : h < 12 ? [h, h + 12] : [h];
  for (let i = 0; i < cands.length; i++) if (cands[i] >= w[0] && cands[i] < w[1]) return pad(cands[i]) + ':' + pad(mi);
  return null;
}

const toMin = t => (+t.slice(0, 2)) * 60 + (+t.slice(3));

function monthsIn(line) {
  const low = line.toLowerCase(), found = [];
  let from = 0;
  /* Scan left to right so the months come back in the order they are printed. */
  while (true) {
    let best = -1, bestAt = Infinity;
    for (let i = 0; i < 12; i++) {
      const at = low.indexOf(MONTHS[i], from);
      if (at >= 0 && at < bestAt) { bestAt = at; best = i; }
    }
    if (best < 0) break;
    found.push(best);
    from = bestAt + MONTHS[best].length;
  }
  return found;
}

function parse(text, opts) {
  opts = opts || {};
  const layout = LAYOUTS[opts.layout || 'azaan-iqama-10'];
  if (!layout) throw new Error('unknown layout: ' + opts.layout);
  const year = opts.year;
  if (!year) throw new Error('year is required');
  const maghribIqama = opts.maghribIqama == null ? 5 : opts.maghribIqama;

  const days = {}, warn = [];
  let months = null;

  text.split(/\r?\n/).forEach((line, lineNo) => {
    const heads = monthsIn(line);
    if (heads.length) { months = heads; return; }
    if (!months) return;
    const toks = line.match(/\d{1,2}:\d{2}|\d{1,2}/g);
    if (!toks) return;

    /* Read every day-group on the line first. The months they belong to cannot be decided by
       position: a row for the 31st prints nothing at all under a 30-day month, so the groups shift
       left and a positional reading would file May 31 under April. Month is settled afterwards, from
       which of the block's months actually have this day. */
    const groups = [];
    let i = 0;
    while (i < toks.length) {
      if (toks[i].indexOf(':') >= 0) { i++; continue; }      /* a stray time, not a day number */
      const day = +toks[i++];
      const times = [];
      while (times.length < layout.length && i < toks.length && toks[i].indexOf(':') >= 0) times.push(toks[i++]);
      if (times.length === layout.length && day >= 1 && day <= 31) groups.push({ day: day, times: times });
    }
    if (!groups.length) return;

    const day0 = groups[0].day;
    const valid = months.filter(m => day0 <= dim(m, year));
    if (groups.length !== valid.length) {
      warn.push('line ' + (lineNo + 1) + ': found ' + groups.length + ' day-groups but ' + valid.length +
        ' of the block\'s months have a day ' + day0 + '; skipped');
      return;
    }

    groups.forEach((g, group) => {
      const day = g.day, times = g.times, mon = valid[group];
      if (day !== day0) {
        warn.push('line ' + (lineNo + 1) + ': day numbers disagree across the row (' + day0 + ' vs ' + day + ')');
        return;
      }

      const rec = {}, bad = [];
      layout.forEach((field, n) => {
        const parts = field.split('.'), prayer = parts[0];
        const v = resolveTime(times[n], prayer);
        if (!v) { bad.push(field + '=' + times[n]); return; }
        if (parts.length === 1) rec[prayer] = v;
        else { (rec[prayer] = rec[prayer] || {})[parts[1]] = v; }
      });
      const date = year + '-' + pad(mon + 1) + '-' + pad(day);
      if (bad.length) { warn.push(date + ': unreadable ' + bad.join(', ')); return; }

      /* Maghrib iqama is rarely printed because it follows the azaan closely. Derived, not published,
         and flagged as such in the output so nobody mistakes it for the masjid's own figure. */
      if (rec.maghrib && !rec.maghrib.iqama) {
        const t = toMin(rec.maghrib.azaan) + maghribIqama;
        rec.maghrib.iqama = pad(Math.floor(t / 60) % 24) + ':' + pad(t % 60);
        rec.maghrib.derived = true;
      }

      if (days[date]) warn.push(date + ': appears twice; keeping the first');
      else days[date] = rec;
    });
  });

  return { days, warn };
}

/* Flags a time that jumps from one day to the next. Sunrise and the prayers move by a minute or two a
   day, never twenty, so a big step is a typo rather than astronomy -- and it is the one kind of error a
   within-a-day check cannot see, because the wrong value still sits in the right part of the evening.
   Found exactly this way: both Santa Clara calendars print Isha on 19 August as 9:43 where the days
   either side read 9:15 and 9:12. */
function jumps(days, limit) {
  limit = limit || 12;
  const fields = ['fajr.azaan', 'sunrise', 'dhuhr.azaan', 'asr.azaan', 'maghrib.azaan', 'isha.azaan'];
  const dates = Object.keys(days).sort(), out = [];
  for (let i = 1; i < dates.length; i++) {
    const a = days[dates[i - 1]], b = days[dates[i]];
    fields.forEach(f => {
      const p = f.split('.');
      const va = p.length === 1 ? a[p[0]] : (a[p[0]] || {})[p[1]];
      const vb = p.length === 1 ? b[p[0]] : (b[p[0]] || {})[p[1]];
      if (!va || !vb) return;
      const d = Math.abs(toMin(vb) - toMin(va));
      /* An hour means the clocks changed, which is real and shows up on every time at once. */
      if (d > limit && Math.abs(d - 60) > limit) out.push(dates[i] + ': ' + f + ' jumps ' + d + ' minutes from ' + va + ' to ' + vb);
    });
  }
  return out;
}

/* Flags a day whose times do not run forward through the day. Reported, never corrected: a calendar
   that disagrees with itself is a question for the masjid, not something to paper over. A fixed Isha
   iqama that lands before a late summer Isha azaan is a real published arrangement, so it is allowed. */
function check(days) {
  const order = ['fajr.azaan', 'fajr.iqama', 'sunrise', 'dhuhr.azaan', 'dhuhr.iqama',
                 'asr.azaan', 'asr.iqama', 'maghrib.azaan', 'isha.azaan'];
  const out = [];
  Object.keys(days).sort().forEach(date => {
    const d = days[date];
    let prev = -1, prevName = null;
    order.forEach(f => {
      const p = f.split('.'), v = p.length === 1 ? d[p[0]] : (d[p[0]] || {})[p[1]];
      if (!v) return;
      const m = toMin(v);
      if (m < prev) out.push(date + ': ' + f + ' (' + v + ') is before ' + prevName);
      prev = m; prevName = f + ' (' + v + ')';
    });
  });
  return out;
}

/* Builds the file the frame reads. */
function schedule(meta, days) {
  const out = {
    id: meta.id, name: meta.name, address: meta.address, tz: meta.tz,
    source: meta.source, days: {}, jumuah: meta.jumuah || [],
    lat: meta.lat, lon: meta.lon
  };
  Object.keys(days).sort().forEach(date => {
    const d = days[date];
    out.days[date] = {
      fajr: [d.fajr.azaan, d.fajr.iqama],
      sunrise: d.sunrise,
      dhuhr: [d.dhuhr.azaan, d.dhuhr.iqama],
      asr: [d.asr.azaan, d.asr.iqama],
      maghrib: [d.maghrib.azaan, d.maghrib.iqama],
      isha: [d.isha.azaan, d.isha.iqama]
    };
  });
  return out;
}

module.exports = { parse, check, jumps, schedule, LAYOUTS, resolveTime };
