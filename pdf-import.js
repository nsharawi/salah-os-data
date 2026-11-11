'use strict';
/* Turns published masjid calendars into schedule files the frame can read.
 *
 *   node pdf-import.js              all masjids in sources-pdf.json
 *   node pdf-import.js mca          just one
 *
 * Re-runnable on purpose: when a masjid publishes a corrected calendar, drop the new file in and run
 * this again. Nothing is edited by hand, so there is nothing to lose track of.
 */

const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const pdf = require('./adapters/pdf.js');

const ROOT = __dirname;
const CONF = path.join(ROOT, 'sources-pdf.json');
const OUT = path.join(ROOT, 'data', 'schedules');

function textOf(entry) {
  const file = path.resolve(ROOT, entry.file);
  if (!fs.existsSync(file)) throw new Error('file not found: ' + entry.file);
  if (!/\.pdf$/i.test(file)) return fs.readFileSync(file, 'utf8');
  /* pdftotext keeps the columns, which is the whole reason the parser can work by position. */
  const txt = file.replace(/\.pdf$/i, '.txt');
  try {
    execFileSync('pdftotext', ['-layout', file, txt], { stdio: 'pipe' });
  } catch (e) {
    throw new Error('could not run pdftotext on ' + entry.file + '.\n' +
      '      Install poppler (Windows: choco install poppler, or download poppler-utils),\n' +
      '      or convert the PDF to text yourself and point "file" at the .txt.');
  }
  return fs.readFileSync(txt, 'utf8');
}

/* One day per line. Compact enough for the frame to fetch on every load, and a corrected calendar
   then shows up as a diff of only the days that actually moved, rather than a wall of re-indented
   whitespace. */
function serialise(s) {
  const head = {};
  Object.keys(s).forEach(k => { if (k !== 'days') head[k] = s[k]; });
  const lines = Object.keys(s.days).sort()
    .map(d => '  ' + JSON.stringify(d) + ': ' + JSON.stringify(s.days[d]));
  const open = JSON.stringify(head).replace(/\}$/, '');
  return open + ',\n "days": {\n' + lines.join(',\n') + '\n }\n}\n';
}

function run(entry) {
  const label = entry.id.padEnd(6);
  let text;
  try { text = textOf(entry); }
  catch (e) { console.log(label + ' failed   ' + e.message); return false; }

  const { days, warn } = pdf.parse(text, entry);
  const dates = Object.keys(days).sort();
  if (!dates.length) {
    console.log(label + ' failed   no day rows found -- is the layout right?');
    return false;
  }

  /* A year calendar should have a row for every day of the year. Gaps mean a parse miss, not a
     masjid that skips days, so they are counted and named rather than quietly accepted. */
  const first = new Date(dates[0] + 'T12:00:00Z'), last = new Date(dates[dates.length - 1] + 'T12:00:00Z');
  const span = Math.round((last - first) / 864e5) + 1;
  const missing = [];
  for (let i = 0; i < span; i++) {
    const d = new Date(first.getTime() + i * 864e5).toISOString().slice(0, 10);
    if (!days[d]) missing.push(d);
  }

  const problems = pdf.check(days).concat(pdf.jumps(days));
  const sched = pdf.schedule(entry, days);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, entry.id + '.json'), serialise(sched));

  console.log(label + ' ok       ' + dates.length + ' days, ' + dates[0] + ' to ' + dates[dates.length - 1] +
    (missing.length ? '  [' + missing.length + ' MISSING]' : '') +
    (warn.length ? '  [' + warn.length + ' warnings]' : '') +
    (problems.length ? '  [' + problems.length + ' out of order]' : ''));
  missing.slice(0, 8).forEach(d => console.log('         missing ' + d));
  if (missing.length > 8) console.log('         ... and ' + (missing.length - 8) + ' more');
  warn.slice(0, 8).forEach(w => console.log('         ! ' + w));
  if (warn.length > 8) console.log('         ... and ' + (warn.length - 8) + ' more');
  problems.slice(0, 8).forEach(w => console.log('         ? ' + w));
  if (problems.length > 8) console.log('         ... and ' + (problems.length - 8) + ' more');
  return !missing.length && !warn.length;
}

const only = process.argv[2];
const conf = JSON.parse(fs.readFileSync(CONF, 'utf8'));
const list = only ? conf.filter(e => e.id === only) : conf;
if (!list.length) { console.log('no masjid with id "' + only + '" in sources-pdf.json'); process.exit(1); }
let clean = 0;
list.forEach(e => { if (run(e)) clean++; });
console.log('\n' + clean + ' of ' + list.length + ' imported with no warnings');
