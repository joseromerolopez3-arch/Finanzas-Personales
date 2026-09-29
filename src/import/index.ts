import type { ParsedStatement, TableMapping } from '../domain/types';
import { closingFromRows } from '../domain/reconcile';
import { parseCSV } from './csv';
import { looksLikeNorma43, parseNorma43 } from './norma43';
import { looksLikeOFX, parseOFX } from './ofx';
import { applyMapping, guessMapping, type Cell } from './table';

export type LoadedFile =
  | { kind: 'statement'; format: 'Norma 43' | 'OFX'; statement: ParsedStatement }
  | { kind: 'table'; format: 'CSV' | 'Excel'; rows: Cell[][]; mapping: TableMapping };

/** Bank exports are often Windows-1252 rather than UTF-8. */
export function decode(buf: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

export async function loadFile(file: File): Promise<LoadedFile> {
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf.slice(0, 8));
  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  const isOle = head[0] === 0xd0 && head[1] === 0xcf;
  if (isOle) throw new Error('Este Excel es de formato antiguo (.xls). Ábrelo y guárdalo como .xlsx o .csv, o descarga el extracto en formato Norma 43.');
  if (isZip) {
    const { readSheet } = await import('read-excel-file/browser');
    const rows = (await readSheet(file)) as Cell[][];
    return { kind: 'table', format: 'Excel', rows, mapping: guessMapping(rows) };
  }
  const text = decode(buf);
  if (looksLikeNorma43(text)) return { kind: 'statement', format: 'Norma 43', statement: parseNorma43(text) };
  if (looksLikeOFX(text)) return { kind: 'statement', format: 'OFX', statement: parseOFX(text) };
  // Some banks export an HTML table with an .xls extension.
  if (/<table/i.test(text.slice(0, 5000))) {
    const rows = htmlTableRows(text);
    return { kind: 'table', format: 'Excel', rows, mapping: guessMapping(rows) };
  }
  const rows = parseCSV(text);
  return { kind: 'table', format: 'CSV', rows, mapping: guessMapping(rows) };
}

function htmlTableRows(html: string): Cell[][] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return Array.from(doc.querySelectorAll('tr'))
    .map((tr) => Array.from(tr.querySelectorAll('td,th')).map((td) => (td.textContent || '').trim()))
    .filter((r) => r.some(Boolean));
}

export function tableToStatement(rows: Cell[][], mapping: TableMapping): ParsedStatement {
  const parsed = applyMapping(rows, mapping);
  return { rows: parsed, closingBalance: closingFromRows(parsed), accountHint: null };
}
