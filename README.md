# Salah OS — masjid schedules

Collects published prayer timetables and writes them where the frames can read them.
Runs on Dean's desktop (a home connection, which masjid sites accept where a datacentre is often challenged),
then pushes the result to GitHub, which deploys it to the site.

Plain Node, no `npm install`.

## Daily run

    run.bat

Windows Task Scheduler, once a day, with **"Run task as soon as possible after a scheduled start is missed"**
ticked — then a machine that was asleep at 3am catches up as soon as it wakes.

## What it does

* Reads `sources.json` and fetches each masjid's own timetable page.
* Parses it into days, **validates every day**, and writes `data/schedules/<id>.json`.
* Writes `data/health.json` for the dashboard.

Safety rules, because wrong prayer times are the worst failure this product has:

* A day with a missing prayer, times out of order, or a gap in the dates is **rejected whole** — the previous file is untouched.
* A schedule that reaches less far ahead than the one already stored is **ignored**.
* Anything with under three weeks of coverage left is flagged `thin`. That, not "last checked",
  is the number to watch: a masjid scraped ten days ago with a year of data is fine; one scraped
  this morning that runs out on Friday is not.

## Being a good guest

One request at a time, four seconds between hits on the same host, `robots.txt` honoured, a truthful
User-Agent, and conditional requests so an unchanged page costs the site almost nothing.
Every published schedule credits the masjid it came from.

## Directory

    node directory.js            # every region in regions.json
    node directory.js US-CA      # one region

Masjid locations come from OpenStreetMap contributors (ODbL), which `data/masjids.json` records.
Twenty seconds between regions; the full US and Canada sweep takes about twenty minutes.

## Adding a masjid

1. Find it in `data/masjids.json` and copy its `id`.
2. Add a block to `sources.json` with that id, the masjid's timetable URL, and `"adapter": "table"`.
3. `node scrape.js` and read what it says.

`table` handles any HTML table whose header names the prayers, in English or Arabic, in any column order,
with separate adhan and iqamah columns where they exist. Sites that need something else get their own
adapter in `adapters/`.
