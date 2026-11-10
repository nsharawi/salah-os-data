'use strict';
/* Refuses to publish a broken schedule, so a bad scrape can never reach a frame. */
const fs = require('fs'), path = require('path');
const { validate, coverage } = require('../lib/util');
const dir = path.join(__dirname, '..', 'data', 'schedules');
let bad = 0, n = 0;
for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
  if (!f.endsWith('.json')) continue;
  n++;
  const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const v = validate(j.days || {}), c = coverage(j.days || {});
  if (!v.ok) { bad++; console.error('REJECT ' + f + ': ' + v.problems.slice(0, 3).join('; ')); }
  else console.log('ok     ' + f + ' — ' + c.days + ' days, reaches ' + c.to);
}
if (bad) { console.error('\n' + bad + ' of ' + n + ' schedules are broken; not publishing.'); process.exit(1); }
console.log('\n' + n + ' schedule(s) checked, all sound.');
