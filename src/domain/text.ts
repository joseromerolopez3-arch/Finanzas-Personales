/** Lowercase, no accents, no numbers/card masks/dates: the "merchant key" of a bank description. */
export function merchantKey(s: string): string {
  return stripAccents(s.toLowerCase())
    .replace(/\b\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?\b/g, ' ')
    .replace(/\S*\d\S*/g, ' ')
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\b(compra|pago|tarj(eta)?|tj|con|en|de|del|la|el|recibo|transf(erencia)?|trf|bizum|cargo|abono|sepa|adeudo|contactless)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function normalizeLoose(s: string): string {
  return stripAccents(s.toLowerCase()).replace(/\s+/g, ' ').trim();
}

/** Readable note from an uppercase bank description: "COMPRA TARJ. MERCADONA" → "Compra tarj. mercadona". */
export function prettify(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t !== t.toUpperCase()) return t;
  const lower = t.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** Share of words of `a` present in `b` (0..1). */
export function similarity(a: string, b: string): number {
  const wa = new Set(merchantKey(a).split(' ').filter((w) => w.length > 2));
  const wb = new Set(merchantKey(b).split(' ').filter((w) => w.length > 2));
  if (!wa.size || !wb.size) return 0;
  let hit = 0;
  for (const w of wa) if (wb.has(w)) hit++;
  return hit / Math.min(wa.size, wb.size);
}
