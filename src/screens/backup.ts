import type { Snapshot, Transaction } from '../domain/types';
import { EMPTY_SNAPSHOT } from '../domain/types';
import type { useLookups } from '../state/hooks';

function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const TYPE_LABEL = { income: 'Ingreso', expense: 'Gasto', transfer: 'Traspaso', adjustment: 'Ajuste' } as const;

/** Excel-friendly CSV (semicolon, decimal comma, BOM). */
export function downloadCSV(txs: Transaction[], { cat, acc }: ReturnType<typeof useLookups>, name: string) {
  const esc = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const rows = [...txs].sort((a, b) => a.date.localeCompare(b.date)).map((t) => {
    const signed = t.type === 'expense' ? -t.amount : t.amount;
    return [
      t.date, TYPE_LABEL[t.type], t.categoryId ? cat(t.categoryId).name : '', acc(t.accountId).name,
      t.type === 'transfer' ? acc(t.toAccountId).name : '', signed.toFixed(2).replace('.', ','), t.note, t.bankDescription ?? ''
    ].map((v) => esc(String(v))).join(';');
  });
  download(name, '﻿' + ['Fecha;Tipo;Categoría;Cuenta;Cuenta destino;Importe;Concepto;Concepto banco', ...rows].join('\n'), 'text/csv;charset=utf-8');
}

export function downloadBackup(data: Snapshot) {
  const payload = { app: 'cuentas-personales', version: 2, exportedAt: new Date().toISOString(), data };
  download(`cuentas-personales-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 1), 'application/json');
}

export async function readBackup(file: File): Promise<Snapshot> {
  const json = JSON.parse(await file.text());
  const data = json?.data ?? json;
  if (!data || !Array.isArray(data.transactions) || !Array.isArray(data.accounts)) throw new Error('El archivo no es una copia de seguridad de Cuentas Personales.');
  return { ...EMPTY_SNAPSHOT, ...data };
}
