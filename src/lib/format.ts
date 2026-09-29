// 'always' groups 4-digit amounts too (1.754,80 €), easier to read in a finance app.
const grouping = { useGrouping: 'always' } as unknown as Intl.NumberFormatOptions;
const eurFmt = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', ...grouping });
const eur0Fmt = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0, ...grouping });

export const eur = (n: number) => eurFmt.format(round2(n) || 0);
/** Compact amount without decimals, for charts and dense tables. */
export const eur0 = (n: number) => eur0Fmt.format(Math.round(n) || 0);
export const pct = (n: number) => `${Math.round(n)} %`;

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
export const cents = (n: number) => Math.round(n * 100);

/**
 * Parses amounts typed by people or exported by Spanish banks:
 * "1.234,56", "1,234.56", "-12,5", "12,50 €", "(12.50)", "12,50-".
 * Returns NaN when nothing numeric is found.
 */
export function parseAmount(input: string | number | null | undefined): number {
  if (typeof input === 'number') return input;
  if (input == null) return NaN;
  let s = String(input).trim();
  if (!s) return NaN;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (/-\s*$/.test(s)) { negative = true; s = s.replace(/-\s*$/, ''); }
  if (/^\s*[-−–]/.test(s)) { negative = true; }
  s = s.replace(/[^\d.,]/g, '');
  if (!s) return NaN;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    const dec = lastComma > lastDot ? ',' : '.';
    const thou = dec === ',' ? '.' : ',';
    s = s.split(thou).join('').replace(dec, '.');
  } else if (lastComma >= 0) {
    // Spanish decimal comma; "1,234,567" style thousands only if several groups of 3.
    s = /^\d{1,3}(,\d{3}){2,}$/.test(s) ? s.split(',').join('') : s.split(',').join('.');
    if ((s.match(/\./g) || []).length > 1) s = s.replace(/\.(?=.*\.)/g, '');
  } else if (lastDot >= 0) {
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.split('.').join('');
  }
  const n = parseFloat(s);
  if (isNaN(n)) return NaN;
  return negative ? -n : n;
}

/** Formats a number for an editable input: "1234,5" → "1234,50". */
export function toInput(n: number | null | undefined): string {
  if (n == null || isNaN(n) || n === 0) return '';
  return round2(n).toFixed(2).replace('.', ',');
}
