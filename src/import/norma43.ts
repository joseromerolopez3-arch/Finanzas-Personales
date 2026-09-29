import type { BankRow, ParsedStatement } from '../domain/types';
import { round2 } from '../lib/format';

/** AEB "Cuaderno 43" common concepts, used when a movement has no free-text concept. */
const COMMON: Record<string, string> = {
  '01': 'Talones / reintegros', '02': 'Ingresos', '03': 'Recibos domiciliados', '04': 'Transferencias',
  '05': 'Amortización préstamo', '06': 'Remesa de efectos', '07': 'Suscripciones', '08': 'Dividendos',
  '09': 'Operaciones de bolsa', '10': 'Cheques gasolina', '11': 'Cajero automático', '12': 'Tarjeta',
  '13': 'Operaciones extranjero', '14': 'Devoluciones', '15': 'Nóminas / seguros sociales',
  '16': 'Timbres / corretaje', '17': 'Intereses / comisiones', '98': 'Anulación', '99': 'Varios'
};

const yymmdd = (s: string) => `20${s.slice(0, 2)}-${s.slice(2, 4)}-${s.slice(4, 6)}`;
const amount = (s: string) => Number(s) / 100;

export const looksLikeNorma43 = (text: string) => /^11\d{18}\d{12}[12]\d{14}/m.test(text.replace(/^﻿/, ''));

/**
 * Spanish banks' standard statement format (Norma/Cuaderno 43). Fixed-width 80-char records:
 * 11 = account header (initial balance), 22 = movement, 23 = extra concepts, 33 = account totals.
 */
export function parseNorma43(text: string): ParsedStatement {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).map((l) => l.replace(/\s+$/, ''));
  const rows: BankRow[] = [];
  let running: number | null = null;
  let current: BankRow | null = null;
  let concepts: string[] = [];
  let accountHint: string | null = null;
  let closing: ParsedStatement['closingBalance'] = null;
  let endDate = '';

  const flush = () => {
    if (!current) return;
    const extra = concepts.map((c) => c.trim()).filter(Boolean).join(' ');
    if (extra) current.description = extra;
    rows.push(current);
    current = null;
    concepts = [];
  };

  for (const l of lines) {
    const code = l.slice(0, 2);
    if (code === '11') {
      flush();
      accountHint = `${l.slice(2, 6)} ${l.slice(6, 10)} ${l.slice(10, 20)}`;
      endDate = yymmdd(l.slice(26, 32));
      const initial = amount(l.slice(33, 47));
      running = l[32] === '1' ? -initial : initial;
    } else if (code === '22') {
      flush();
      const sign = l[27] === '1' ? -1 : 1;
      const value = round2(sign * amount(l.slice(28, 42)));
      if (running != null) running = round2(running + value);
      const refs = `${l.slice(52, 64).trim()} ${l.slice(64, 80).trim()}`.trim();
      current = {
        date: yymmdd(l.slice(10, 16)),
        amount: value,
        description: COMMON[l.slice(22, 24)] ?? (refs || 'Movimiento'),
        balance: running,
        externalId: null
      };
    } else if (code === '23') {
      concepts.push(l.slice(4, 42), l.slice(42, 80));
    } else if (code === '33') {
      flush();
      const fin = amount(l.slice(59, 73));
      closing = { date: endDate || rows[rows.length - 1]?.date || '', amount: round2(l[58] === '1' ? -fin : fin) };
    }
  }
  flush();
  return { rows, closingBalance: closing, accountHint };
}
