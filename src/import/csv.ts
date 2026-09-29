/** RFC-4180-ish CSV parser with delimiter auto-detection (; , tab |). */
export function parseCSV(text: string, delimiter?: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const delim = delimiter ?? detectDelimiter(clean);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"' && field.trim() === '') {
      inQuotes = true; field = '';
    } else if (c === delim) {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && clean[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row.map((f) => f.trim()));
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row.map((f) => f.trim()));
  return rows;
}

export function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 30);
  let best = ';', bestScore = -1;
  for (const d of [';', ',', '\t', '|']) {
    const counts = lines.map((l) => splitCount(l, d));
    const max = Math.max(...counts);
    if (max === 0) continue;
    // Prefer the delimiter that yields the same (high) column count on most lines.
    const mode = counts.filter((c) => c === max).length;
    const score = mode * 10 + max;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

function splitCount(line: string, d: string): number {
  let n = 0, q = false;
  for (const c of line) {
    if (c === '"') q = !q;
    else if (c === d && !q) n++;
  }
  return n;
}
