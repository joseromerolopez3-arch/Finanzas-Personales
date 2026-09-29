import type { BankRow, TableMapping } from '../domain/types';
import { parseAmount, round2 } from '../lib/format';
import { stripAccents } from '../domain/text';

export type Cell = string | number | boolean | Date | null | undefined;

const norm = (c: Cell) => stripAccents(String(c ?? '').toLowerCase()).replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

const HEADERS = {
  date: [/^f(echa)? ?(de )?(operacion|oper|contable|movimiento)?$/, /^date$/, /fecha operacion/, /^fecha$/],
  valueDate: [/valor/],
  description: [/concepto/, /descripcion/, /detalle/, /movimiento/, /^description$/, /observaciones/, /beneficiario/, /comercio/, /informacion/],
  amount: [/^importe/, /^cantidad/, /^amount/, /^euros?$/, /importe eur/],
  debit: [/cargo/, /^debe$/, /debito/, /^gastos?$/, /^salidas?$/],
  credit: [/abono/, /^haber$/, /credito/, /^ingresos?$/, /^entradas?$/],
  balance: [/saldo/, /disponible/, /^balance$/]
};

const matches = (h: string, list: RegExp[]) => list.some((r) => r.test(h));

/** Finds the header row and guesses which column is which. */
export function guessMapping(rows: Cell[][]): TableMapping {
  let headerRow = -1, bestHits = 0;
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const hs = rows[i].map(norm);
    const hits = hs.filter((h) => h && Object.values(HEADERS).some((l) => matches(h, l))).length;
    if (hits > bestHits && hs.some((h) => matches(h, HEADERS.date) || /fecha/.test(h))) { bestHits = hits; headerRow = i; }
  }
  const mapping: TableMapping = {
    headerRow, date: -1, description: [], amount: null, debit: null, credit: null, balance: null,
    dateOrder: 'dmy', invert: false
  };
  if (headerRow >= 0) {
    const hs = rows[headerRow].map(norm);
    hs.forEach((h, i) => {
      if (!h) return;
      if (mapping.date < 0 && /fecha|date/.test(h) && !matches(h, HEADERS.valueDate)) mapping.date = i;
      else if (matches(h, HEADERS.balance)) { if (mapping.balance == null) mapping.balance = i; }
      else if (matches(h, HEADERS.debit)) { if (mapping.debit == null) mapping.debit = i; }
      else if (matches(h, HEADERS.credit)) { if (mapping.credit == null) mapping.credit = i; }
      else if (matches(h, HEADERS.amount)) { if (mapping.amount == null) mapping.amount = i; }
      else if (matches(h, HEADERS.description)) mapping.description.push(i);
    });
    if (mapping.date < 0) mapping.date = hs.findIndex((h) => /fecha|date/.test(h));
  }
  const body = rows.slice(headerRow + 1);
  // No usable headers: infer from content (first date-like column, last numeric columns...).
  if (mapping.date < 0) mapping.date = firstColumn(body, (c) => parseDate(c, 'dmy') != null);
  if (mapping.amount == null && (mapping.debit == null || mapping.credit == null)) {
    const numeric = columnsWhere(body, (c) => typeof c === 'number' || (typeof c === 'string' && /\d/.test(c) && !isNaN(parseAmount(c)) && parseDate(c, 'dmy') == null));
    const cand = numeric.filter((i) => i !== mapping.balance && i !== mapping.date && i !== mapping.debit && i !== mapping.credit);
    if (cand.length) mapping.amount = cand[0];
    if (mapping.balance == null && cand.length > 1) mapping.balance = cand[cand.length - 1];
  }
  if (!mapping.description.length) {
    const texty = columnsWhere(body, (c) => typeof c === 'string' && /[a-zA-Z]{3}/.test(c));
    const best = texty.sort((a, b) => avgLen(body, b) - avgLen(body, a))[0];
    if (best != null) mapping.description = [best];
  }
  mapping.dateOrder = guessDateOrder(body.map((r) => r[mapping.date]));
  return mapping;
}

function firstColumn(rows: Cell[][], ok: (c: Cell) => boolean): number {
  const cols = columnsWhere(rows, ok);
  return cols.length ? cols[0] : -1;
}
function columnsWhere(rows: Cell[][], ok: (c: Cell) => boolean): number[] {
  const sample = rows.slice(0, 30);
  const width = Math.max(0, ...sample.map((r) => r.length));
  const out: number[] = [];
  for (let i = 0; i < width; i++) {
    const filled = sample.filter((r) => r[i] != null && String(r[i]).trim() !== '');
    if (filled.length && filled.filter((r) => ok(r[i])).length / filled.length >= 0.8) out.push(i);
  }
  return out;
}
function avgLen(rows: Cell[][], i: number) {
  const s = rows.slice(0, 30).map((r) => String(r[i] ?? '').length);
  return s.reduce((a, b) => a + b, 0) / (s.length || 1);
}

export function guessDateOrder(cells: Cell[]): TableMapping['dateOrder'] {
  for (const c of cells) {
    if (typeof c !== 'string') continue;
    const m = c.trim().match(/^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})/);
    if (!m) continue;
    if (m[1].length === 4) return 'ymd';
    if (Number(m[2]) > 12) return 'mdy';
  }
  return 'dmy';
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Accepts Date objects, Excel serial numbers and dd/mm/yyyy-like strings. */
export function parseDate(c: Cell, order: TableMapping['dateOrder']): string | null {
  if (c == null || c === '') return null;
  if (c instanceof Date) {
    if (isNaN(c.getTime())) return null;
    // Spreadsheet dates come as UTC midnight.
    return `${c.getUTCFullYear()}-${pad(c.getUTCMonth() + 1)}-${pad(c.getUTCDate())}`;
  }
  if (typeof c === 'number') {
    if (c < 20000 || c > 80000) return null;
    const d = new Date(Math.round((c - 25569) * 86400000));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const s = String(c).trim();
  let m = s.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    return order === 'mdy' ? valid(y, +m[1], +m[2]) : valid(y, +m[2], +m[1]);
  }
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  return null;
}
function valid(y: number, mo: number, d: number): string | null {
  if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

function num(c: Cell): number {
  if (typeof c === 'number') return c;
  if (c == null || c === '') return NaN;
  return parseAmount(String(c));
}

/** Converts spreadsheet rows into bank rows using a column mapping. Rows without a valid date/amount are skipped. */
export function applyMapping(rows: Cell[][], m: TableMapping): BankRow[] {
  const out: BankRow[] = [];
  for (const r of rows.slice(m.headerRow + 1)) {
    const date = parseDate(r[m.date], m.dateOrder);
    if (!date) continue;
    let amount = NaN;
    if (m.amount != null) amount = num(r[m.amount]);
    if (isNaN(amount) && (m.debit != null || m.credit != null)) {
      const d = m.debit != null ? num(r[m.debit]) : NaN;
      const c = m.credit != null ? num(r[m.credit]) : NaN;
      if (!isNaN(d) || !isNaN(c)) amount = (isNaN(c) ? 0 : Math.abs(c)) - (isNaN(d) ? 0 : Math.abs(d));
    }
    if (isNaN(amount) || amount === 0) continue;
    if (m.invert) amount = -amount;
    const description = m.description.map((i) => String(r[i] ?? '').trim()).filter(Boolean).join(' · ');
    const bal = m.balance != null ? num(r[m.balance]) : NaN;
    out.push({ date, amount: round2(amount), description: description || 'Movimiento', balance: isNaN(bal) ? null : round2(bal), externalId: null });
  }
  return out;
}
