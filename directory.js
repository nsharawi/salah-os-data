'use strict';
/* Builds the masjid directory from OpenStreetMap.
   OSM data is open (ODbL) and must be credited, which data/masjids.json records.
   One region at a time, with a pause between, so Overpass is never hammered.
   Usage: node directory.js [region ...]      (default: every region in regions.json) */
const fs = require('fs'), path = require('path');
const { get } = require('./lib/fetch');
const { writeJson, today } = require('./lib/util');

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const PAUSE_MS = 20000;         /* Overpass asks for gaps between queries; be generous */

function query(area) {
  return `[out:json][timeout:180];
area["ISO3166-2"="${area}"]->.a;
(
  node["amenity"="place_of_worship"]["religion"="muslim"](area.a);
  way["amenity"="place_of_worship"]["religion"="muslim"](area.a);
  relation["amenity"="place_of_worship"]["religion"="muslim"](area.a);
);
out center tags;`;
}

/* Turn an Overpass answer into directory rows. Exported so it can be tested without the network. */
function parse(json, region) {
  const out = [];
  for (const el of (json && json.elements) || []) {
    const t = el.tags || {};
    const name = t.name || t['name:en'] || t['name:ar'];
    if (!name) continue;                                  /* unnamed points are no use to anyone */
    const lat = el.lat != null ? el.lat : (el.center && el.center.lat);
    const lon = el.lon != null ? el.lon : (el.center && el.center.lon);
    if (lat == null || lon == null) continue;
    out.push({
      id: 'osm:' + el.type[0] + el.id,
      name: String(name).trim(),
      nameAr: t['name:ar'] || null,
      city: t['addr:city'] || null,
      state: region ? region.split('-')[1] || null : null,
      cc: region ? region.split('-')[0].toLowerCase() : null,
      lat: Number(Number(lat).toFixed(5)),
      lon: Number(Number(lon).toFixed(5)),
      website: t.website || t['contact:website'] || t.url || null,
      phone: t.phone || t['contact:phone'] || null
    });
  }
  /* Same masjid mapped twice (a node inside a building way) — keep one. */
  const seen = new Map();
  for (const m of out) {
    const key = m.name.toLowerCase().replace(/[^a-z0-9]/g, '') + '|' + m.lat.toFixed(2) + '|' + m.lon.toFixed(2);
    const prev = seen.get(key);
    if (!prev || (!prev.website && m.website)) seen.set(key, m);
  }
  return [...seen.values()];
}

async function main() {
  const regionsFile = path.join(__dirname, 'regions.json');
  const regions = process.argv.slice(2).length ? process.argv.slice(2) : JSON.parse(fs.readFileSync(regionsFile, 'utf8'));
  const file = path.join(__dirname, 'data', 'masjids.json');
  let existing = { masjids: [] };
  try { existing = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
  const byId = new Map(existing.masjids.map(m => [m.id, m]));
  let added = 0, failed = [];

  for (const region of regions) {
    process.stdout.write('  ' + region + ' … ');
    const r = await get(OVERPASS + '?data=' + encodeURIComponent(query(region)), { skipRobots: true, timeout: 200000 });
    if (!r.body) { console.log('failed (' + (r.error || r.status) + ')'); failed.push(region); await sleep(PAUSE_MS); continue; }
    let rows = [];
    try { rows = parse(JSON.parse(r.body), region); }
    catch (e) { console.log('unreadable answer'); failed.push(region); await sleep(PAUSE_MS); continue; }
    for (const m of rows) {
      const prev = byId.get(m.id);
      byId.set(m.id, prev ? Object.assign({}, m, { source: prev.source, tz: prev.tz }) : m);
      if (!prev) added++;
    }
    console.log(rows.length + ' masjids');
    await sleep(PAUSE_MS);
  }

  const masjids = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  writeJson(file, { updated: today(), attribution: 'Masjid locations from OpenStreetMap contributors, ODbL', count: masjids.length, masjids });
  console.log('\n' + masjids.length + ' masjids in the directory (' + added + ' new)' + (failed.length ? ', failed regions: ' + failed.join(', ') : ''));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
module.exports = { parse, query };
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
