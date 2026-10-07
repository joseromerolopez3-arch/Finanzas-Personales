import type { CollectionName, Snapshot } from '../domain/types';

/** Table and columns (camelCase, as in the domain types) for each collection. */
export const TABLES: Record<CollectionName, { table: string; fields: string[] }> = {
  accounts: { table: 'accounts', fields: ['id', 'name', 'icon', 'color', 'kind', 'openingBalance', 'openingDate', 'position', 'archived', 'importMapping'] },
  categories: { table: 'categories', fields: ['id', 'kind', 'name', 'icon', 'color', 'position', 'archived'] },
  transactions: {
    table: 'transactions',
    fields: ['id', 'type', 'date', 'amount', 'accountId', 'toAccountId', 'categoryId', 'note', 'source', 'externalId',
      'toExternalId', 'bankDescription', 'recurringId', 'propertyId', 'createdBy', 'needsReview', 'createdAt']
  },
  budgetYears: { table: 'budget_years', fields: ['id', 'year', 'mode'] },
  budgetLines: { table: 'budget_lines', fields: ['id', 'year', 'kind', 'categoryId', 'propertyId', 'pattern', 'base', 'amounts'] },
  recurring: {
    table: 'recurring',
    fields: ['id', 'name', 'type', 'amount', 'categoryId', 'accountId', 'propertyId', 'frequency', 'everyMonths', 'day', 'month', 'startDate', 'endDate', 'active']
  },
  recurringLog: { table: 'recurring_log', fields: ['id', 'recurringId', 'period', 'status', 'transactionId', 'at'] },
  rules: { table: 'rules', fields: ['id', 'pattern', 'categoryId', 'kind'] },
  properties: { table: 'properties', fields: ['id', 'name', 'icon', 'position', 'archived'] },
  settings: { table: 'settings', fields: ['id', 'householdId', 'name', 'startMonth', 'theme', 'onboarded', 'lastAccountId'] }
};

export const COLLECTIONS = Object.keys(TABLES) as CollectionName[];

const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
/** Values for fields missing in rows saved before the field existed (NOT NULL columns). */
const FIELD_DEFAULTS: Record<string, unknown> = { needsReview: false };
const NUMERIC = new Set(['amount', 'openingBalance', 'base']);

export function toDb(col: CollectionName, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of TABLES[col].fields) out[snake(f)] = row[f] === undefined ? FIELD_DEFAULTS[f] ?? null : row[f];
  return out;
}

export function fromDb<C extends CollectionName>(col: C, row: Record<string, unknown>): Snapshot[C][number] {
  const out: Record<string, unknown> = {};
  for (const f of TABLES[col].fields) {
    let v = row[snake(f)];
    // numeric columns may arrive as strings depending on the driver.
    if (NUMERIC.has(f) && typeof v === 'string') v = Number(v);
    if (f === 'amounts' && Array.isArray(v)) v = v.map(Number);
    out[f] = v === undefined ? FIELD_DEFAULTS[f] ?? null : v;
  }
  return out as unknown as Snapshot[C][number];
}
