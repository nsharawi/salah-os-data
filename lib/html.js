'use strict';
/* A small HTML reader, just enough to pull prayer-time tables out of a page.
   Deliberately dependency-free: the scraper then runs on a plain Node install with nothing to set up. */

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"' };

function decode(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => (n.toLowerCase() in ENT ? ENT[n.toLowerCase()] : m));
}

/* Visible text of an HTML fragment, with block boundaries kept as spaces. */
function text(html) {
  return decode(String(html)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}

/* Every table on the page, innermost first, each as an array of rows of cell text. */
function tables(html) {
  const out = [];
  const re = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let m;
  while ((m = re.exec(html))) {
    const inner = m[1];
    if (/<table\b/i.test(inner)) {            /* nested: take the inner ones instead */
      out.push(...tables(inner));
    }
    const rows = [];
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let r;
    while ((r = rowRe.exec(inner))) {
      if (/<table\b/i.test(r[1])) continue;
      const cells = [];
      const cellRe = /<t([hd])\b([^>]*)>([\s\S]*?)<\/t\1>/gi;
      let c;
      while ((c = cellRe.exec(r[1]))) {
        const span = /colspan\s*=\s*["']?(\d+)/i.exec(c[2]);
        cells.push(text(c[3]));
        for (let i = 1; i < (span ? Number(span[1]) : 1); i++) cells.push('');
      }
      if (cells.length) rows.push(cells);
    }
    if (rows.length) out.push(rows);
  }
  return out;
}

module.exports = { decode, text, tables };
