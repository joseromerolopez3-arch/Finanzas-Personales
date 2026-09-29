import type { Account, Category, Settings } from './types';
import { todayStr } from '../lib/dates';

export const EMOJIS = [
  '🛒', '🍽️', '🏠', '⚡', '💧', '🔥', '📱', '🌐', '🚗', '⛽', '🚌', '✈️', '🏖️', '🎉', '🎬', '🎁',
  '💊', '🏥', '💅', '👕', '👗', '📚', '🎓', '🐾', '👶', '🧾', '🏦', '🔑', '🔁', '🛡️', '🔧', '📦',
  '💼', '📈', '💰', '💵', '💳', '🐷', '✨', '❔'
];
export const PALETTE = [
  '#A6503B', '#8C6A4E', '#4B6E8C', '#8E5C93', '#3F8C74', '#B5891F', '#5C7A5A', '#7A4B6E',
  '#4E6B8C', '#8C5C3F', '#6E5C99', '#3C7C8C', '#B15A7A', '#7A7A7A'
];
export const colorFor = (i: number) => PALETTE[i % PALETTE.length];

type Seed = [id: string, name: string, icon: string, color: string];
const EXPENSE: Seed[] = [
  ['supermercado', 'Supermercado', '🛒', '#5C7A5A'],
  ['gastos_casa', 'Gastos casa', '🏠', '#8C6A4E'],
  ['hipoteca', 'Hipoteca', '🏦', '#7A5C3E'],
  ['alquiler', 'Alquiler', '🔑', '#96633E'],
  ['suministros', 'Luz, agua y gas', '⚡', '#B5891F'],
  ['movil', 'Móvil e internet', '📱', '#6B7A99'],
  ['coche', 'Coche', '🚗', '#5A6B7C'],
  ['gasolina', 'Gasolina', '⛽', '#4B6E8C'],
  ['salud', 'Salud', '💊', '#3F8C74'],
  ['bares_restaurantes', 'Bares y restaurantes', '🍽️', '#A6503B'],
  ['ocio', 'Ocio', '🎉', '#8E5C93'],
  ['viajes', 'Viajes', '✈️', '#3C7C8C'],
  ['ropa_complementos', 'Ropa y complementos', '👗', '#7A4B6E'],
  ['belleza', 'Belleza', '💅', '#B15A7A'],
  ['formacion', 'Formación', '📚', '#4E7A6A'],
  ['suscripciones', 'Suscripciones', '🔁', '#6E5C99'],
  ['seguros', 'Seguros', '🛡️', '#4E6B8C'],
  ['impuestos', 'Impuestos', '🧾', '#7A7A7A'],
  ['regalos', 'Regalos', '🎁', '#B5891F'],
  ['otros_gastos', 'Otros gastos', '📦', '#8C5C3F']
];
const INCOME: Seed[] = [
  ['nomina', 'Nómina', '💼', '#2F6F5E'],
  ['intereses', 'Intereses', '📈', '#4E8C7A'],
  ['otros_ingresos', 'Otros ingresos', '✨', '#B5891F']
];

export function defaultCategories(): Category[] {
  const map = (kind: 'income' | 'expense') => ([id, name, icon, color]: Seed, position: number): Category =>
    ({ id, kind, name, icon, color, position, archived: false });
  return [...EXPENSE.map(map('expense')), ...INCOME.map(map('income'))];
}

export function defaultAccounts(openingDate = todayStr()): Account[] {
  const base = { openingBalance: 0, openingDate, archived: false, importMapping: null };
  return [
    { ...base, id: 'cuenta1', name: 'Cuenta corriente', icon: '🏦', color: '#2F6F5E', kind: 'bank', position: 0 },
    { ...base, id: 'cuenta2', name: 'Ahorro', icon: '🐷', color: '#B5891F', kind: 'savings', position: 1 },
    { ...base, id: 'efectivo', name: 'Efectivo', icon: '💵', color: '#4B6E8C', kind: 'cash', position: 2 }
  ];
}

export function defaultSettings(name = ''): Settings {
  return {
    id: 'me', name, startMonth: todayStr().slice(0, 7), theme: 'system',
    onboarded: false, legacyImported: false, lastAccountId: null
  };
}

export const FALLBACK_CATEGORY: Category = {
  id: '', kind: 'expense', name: 'Sin categoría', icon: '❔', color: '#9AA69B', position: 999, archived: false
};
export const FALLBACK_ACCOUNT: Account = {
  id: '', name: 'Cuenta eliminada', icon: '❔', color: '#9AA69B', kind: 'other', openingBalance: 0,
  openingDate: '1970-01-01', position: 999, archived: true, importMapping: null
};
