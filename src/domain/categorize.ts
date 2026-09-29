import type { Kind, Rule, Transaction } from './types';
import { merchantKey, normalizeLoose } from './text';

export interface Categorizer {
  suggest(description: string, kind: Kind): string | null;
}

/**
 * Explicit rules win ("contains X → category"); otherwise the category most recently used for
 * the same merchant, learnt from the movement history (notes and bank descriptions).
 */
export function makeCategorizer(rules: Rule[], history: Transaction[]): Categorizer {
  const learnt = new Map<string, string>();
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  for (const t of sorted) {
    if ((t.type !== 'income' && t.type !== 'expense') || !t.categoryId) continue;
    for (const text of [t.bankDescription, t.note]) {
      const key = text ? merchantKey(text) : '';
      if (key.length >= 3) learnt.set(`${t.type}|${key}`, t.categoryId);
    }
  }
  const normRules = rules
    .map((r) => ({ ...r, p: normalizeLoose(r.pattern) }))
    .filter((r) => r.p)
    .sort((a, b) => b.p.length - a.p.length);

  return {
    suggest(description, kind) {
      const norm = normalizeLoose(description);
      const rule = normRules.find((r) => (!r.kind || r.kind === kind) && norm.includes(r.p));
      if (rule) return rule.categoryId;
      const key = merchantKey(description);
      if (key.length < 3) return null;
      const exact = learnt.get(`${kind}|${key}`);
      if (exact) return exact;
      // Fall back to the first two meaningful words ("mercadona valencia" ≈ "mercadona madrid").
      const short = key.split(' ').slice(0, 2).join(' ');
      if (short.length < 4) return null;
      for (const [k, v] of learnt) if (k.startsWith(`${kind}|${short}`)) return v;
      return null;
    }
  };
}
