export const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const MONTHS_LONG = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
];

const pad = (n: number) => String(n).padStart(2, '0');

/** Local date as YYYY-MM-DD (never UTC, so late-night entries land on the right day). */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function todayStr(): string {
  return ymd(new Date());
}
export function makeDate(y: number, m0: number, d: number): string {
  const dim = daysInMonth(y, m0);
  return `${y}-${pad(m0 + 1)}-${pad(Math.min(Math.max(d, 1), dim))}`;
}
export function monthKey(y: number, m0: number): string {
  return `${y}-${pad(m0 + 1)}`;
}
export function parseYmd(s: string): { y: number; m0: number; d: number } {
  return { y: Number(s.slice(0, 4)), m0: Number(s.slice(5, 7)) - 1, d: Number(s.slice(8, 10)) };
}
export function toDate(s: string): Date {
  const { y, m0, d } = parseYmd(s);
  return new Date(y, m0, d);
}
export function daysInMonth(y: number, m0: number): number {
  return new Date(y, m0 + 1, 0).getDate();
}
export function addDays(s: string, n: number): string {
  const d = toDate(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}
export function diffDays(a: string, b: string): number {
  return Math.round((toDate(a).getTime() - toDate(b).getTime()) / 86400000);
}
export function addMonths(y: number, m0: number, n: number): { y: number; m0: number } {
  const t = y * 12 + m0 + n;
  return { y: Math.floor(t / 12), m0: ((t % 12) + 12) % 12 };
}
export function monthLabel(y: number, m0: number): string {
  return `${MONTHS_LONG[m0]} ${y}`;
}
export function dayLabel(s: string): string {
  const today = todayStr();
  if (s === today) return 'Hoy';
  if (s === addDays(today, -1)) return 'Ayer';
  return toDate(s).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
}
export function shortDate(s: string): string {
  return toDate(s).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}
export function longDate(s: string): string {
  return toDate(s).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
}
