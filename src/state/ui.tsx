import { createContext, useContext } from 'react';
import type { Transaction } from '../domain/types';

export type Tab = 'home' | 'movements' | 'budget' | 'reports' | 'settings';

export interface TxSheetOptions {
  tx?: Transaction;
  preset?: Partial<Transaction>;
  title?: string;
  onSaved?: (tx: Transaction) => void;
}

export interface UI {
  tab: Tab;
  goTab: (t: Tab) => void;
  openTx: (o?: TxSheetOptions) => void;
  openRecurring: () => void;
  openImport: (accountId?: string) => void;
  openAccount: (id: string) => void;
  period: { y: number; m0: number };
  setPeriod: (y: number, m0: number) => void;
}

export const UICtx = createContext<UI | null>(null);
export function useUI(): UI {
  const v = useContext(UICtx);
  if (!v) throw new Error('useUI outside Shell');
  return v;
}
