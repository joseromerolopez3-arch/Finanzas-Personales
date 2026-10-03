import { useMemo, useState } from 'react';
import { FileUp, CheckCircle2 } from 'lucide-react';
import type { ParsedStatement, TableMapping, Transaction } from '../domain/types';
import { useApp } from '../state/app';
import { newTx, useCategorizer, useLookups } from '../state/hooks';
import { balanceGap, reconcile, type ReviewRow } from '../domain/reconcile';
import { prettify } from '../domain/text';
import { matchRecurring, pending } from '../domain/recurring';
import { loadFile, tableToStatement, type LoadedFile } from '../import';
import { applyMapping } from '../import/table';
import { shortDate, todayStr } from '../lib/dates';
import { eur, round2 } from '../lib/format';
import { Sheet } from '../ui/Sheet';
import { Field } from '../ui/controls';

type Step = 'pick' | 'map' | 'review' | 'done';
interface Choice { include: boolean; categoryId: string | null; transferTo: string | null }

export function ImportSheet({ accountId: initialAccount, onClose }: { accountId: string | null; onClose: () => void }) {
  const { data, activeAccounts, upsert, categories } = useApp();
  const { cat } = useLookups();
  const categorizer = useCategorizer();
  const [accountId, setAccountId] = useState(initialAccount ?? activeAccounts[0]?.id ?? '');
  const [step, setStep] = useState<Step>('pick');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState<LoadedFile | null>(null);
  const [mapping, setMapping] = useState<TableMapping | null>(null);
  const [statement, setStatement] = useState<ParsedStatement | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [adjust, setAdjust] = useState(false);
  const [summary, setSummary] = useState({ created: 0, matched: 0, recurring: 0 });
  const account = activeAccounts.find((a) => a.id === accountId);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setError('');
    try {
      const lf = await loadFile(file);
      setLoaded(lf);
      if (lf.kind === 'statement') {
        review(lf.statement);
      } else {
        // Reuse the mapping saved for this account when the file has the same layout.
        const saved = account?.importMapping;
        const m = saved && saved.headerRow === lf.mapping.headerRow && applyMapping(lf.rows, saved).length ? saved : lf.mapping;
        setMapping(m);
        setStep('map');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo leer el archivo.');
    }
    setBusy(false);
  };

  const review = (st: ParsedStatement) => {
    if (!st.rows.length) { setError('No se han encontrado movimientos en el archivo.'); return; }
    const r = reconcile(st.rows, accountId, data.transactions, { categorizer });
    setStatement(st);
    setRows(r);
    setChoices(Object.fromEntries(r.filter((x) => x.status === 'new').map((x) => [x.key, { include: true, categoryId: x.categoryId, transferTo: null }])));
    setStep('review');
  };

  const fresh = rows.filter((r) => r.status === 'new');
  const matches = rows.filter((r) => r.status === 'match');
  const dups = rows.filter((r) => r.status === 'duplicate');

  const built = useMemo(() => {
    const created: Transaction[] = [];
    for (const r of fresh) {
      const c = choices[r.key];
      if (!c?.include) continue;
      const amount = round2(Math.abs(r.row.amount));
      const common = { date: r.row.date, note: prettify(r.row.description), bankDescription: r.row.description, source: 'import' as const };
      if (c.transferTo) {
        created.push(r.row.amount < 0
          ? newTx({ ...common, type: 'transfer', amount, accountId, toAccountId: c.transferTo, externalId: r.key })
          : newTx({ ...common, type: 'transfer', amount, accountId: c.transferTo, toAccountId: accountId, toExternalId: r.key }));
      } else {
        created.push(newTx({ ...common, type: r.kind, amount, accountId, categoryId: c.categoryId, externalId: r.key }));
      }
    }
    const byId = new Map(data.transactions.map((t) => [t.id, t]));
    const updated: Transaction[] = matches.map((r) => {
      const t = byId.get(r.matchId!)!;
      const inbound = t.type === 'transfer' && t.toAccountId === accountId && t.accountId !== accountId;
      return { ...t, ...(inbound ? { toExternalId: r.key } : { externalId: r.key }), bankDescription: t.bankDescription ?? r.row.description };
    });
    return { created, updated };
  }, [fresh, matches, choices, accountId, data.transactions]);

  const gap = useMemo(() => {
    if (!statement?.closingBalance || !account) return null;
    const after = [...data.transactions.filter((t) => !built.updated.some((u) => u.id === t.id)), ...built.updated, ...built.created];
    return { ...statement.closingBalance, diff: balanceGap(account, after, statement.closingBalance) };
  }, [statement, account, data.transactions, built]);

  const confirm = () => {
    const { created, updated } = built;
    const all = [...created, ...updated];
    const extra = adjust && gap && gap.diff !== 0
      ? [newTx({ type: 'adjustment', amount: gap.diff, accountId, date: gap.date, note: 'Ajuste para cuadrar con el banco' })]
      : [];
    upsert('transactions', [...created, ...extra, ...updated]);
    if (loaded?.kind === 'table' && mapping && account) upsert('accounts', [{ ...account, importMapping: mapping }]);
    // Mark scheduled payments/incomes that this statement already covers.
    const logs = matchRecurring(pending(data.recurring, data.recurringLog, todayStr()), all, new Date().toISOString());
    upsert('recurringLog', logs);
    setSummary({ created: created.length, matched: updated.length, recurring: logs.length });
    setStep('done');
  };

  const setChoice = (key: string, patch: Partial<Choice>) => setChoices((c) => ({ ...c, [key]: { ...c[key], ...patch } }));
  const otherAccounts = activeAccounts.filter((a) => a.id !== accountId);

  return (
    <Sheet title="Importar extracto del banco" onClose={onClose} wide>
      {step === 'pick' && (
        <>
          <p className="muted small" style={{ marginTop: 0 }}>
            Descarga el extracto desde la web o app de tu banco y súbelo aquí. Detectamos lo que ya tenías apuntado (conciliación), evitamos duplicados y proponemos la categoría.
          </p>
          <Field label="Cuenta">
            <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {activeAccounts.map((a) => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
            </select>
          </Field>
          <label className="drop" style={{ marginTop: 14 }}
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void onFile(e.dataTransfer.files[0]); }}>
            <FileUp size={28} />
            <div style={{ marginTop: 8, fontWeight: 600 }}>{busy ? 'Leyendo…' : 'Elige o arrastra el archivo'}</div>
            <div className="small">CSV, Excel (.xlsx), Norma 43 (.n43, .txt, .q43) u OFX</div>
            <input type="file" className="sr-only" accept=".csv,.txt,.xlsx,.xls,.n43,.q43,.aeb,.ofx,.qfx" onChange={(e) => void onFile(e.target.files?.[0])} disabled={!accountId || busy} />
          </label>
          {error && <div className="error-text">{error}</div>}
          <p className="hint">Consejo: el formato «Norma 43» (o «Cuaderno 43») lo ofrecen casi todos los bancos españoles y es el más fiable.</p>
        </>
      )}

      {step === 'map' && loaded?.kind === 'table' && mapping && (
        <MappingStep rows={loaded.rows} mapping={mapping} onChange={setMapping} onBack={() => setStep('pick')}
          onNext={() => { setError(''); review(tableToStatement(loaded.rows, mapping)); }} error={error} />
      )}

      {step === 'review' && statement && (
        <>
          <div className="kpis">
            <div className="kpi"><div className="l">Nuevos</div><div className="v">{fresh.length}</div></div>
            <div className="kpi"><div className="l">Ya apuntados</div><div className="v">{matches.length}</div></div>
            <div className="kpi"><div className="l">Ya importados</div><div className="v">{dups.length}</div></div>
          </div>
          <p className="hint">
            {account?.icon} {account?.name} · del {shortDate(statement.rows.reduce((m, r) => (r.date < m ? r.date : m), statement.rows[0].date))} al {shortDate(statement.rows.reduce((m, r) => (r.date > m ? r.date : m), statement.rows[0].date))}
          </p>

          {gap && (
            <div className={gap.diff === 0 ? 'notice' : 'warn-box'} style={{ marginTop: 10 }}>
              {gap.diff === 0 ? (
                <><CheckCircle2 size={15} style={{ verticalAlign: -3 }} /> Tras importar, el saldo cuadra con el banco: {eur(gap.amount)} a {shortDate(gap.date)}.</>
              ) : (
                <>
                  Saldo según el banco a {shortDate(gap.date)}: <strong>{eur(gap.amount)}</strong>. En la app quedaría con una diferencia de <strong>{eur(gap.diff)}</strong>
                  {' '}(movimientos anteriores al extracto o saldo inicial distinto).
                  <label className="row-flex" style={{ marginTop: 8 }}>
                    <input type="checkbox" checked={adjust} onChange={(e) => setAdjust(e.target.checked)} /> Añadir un ajuste para cuadrar el saldo
                  </label>
                </>
              )}
            </div>
          )}

          {fresh.length > 0 && (
            <>
              <div className="section-head"><h2>Movimientos nuevos</h2>
                <button className="link" onClick={() => {
                  const all = fresh.every((r) => choices[r.key]?.include);
                  setChoices((c) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, { ...v, include: !all }])));
                }}>Marcar / desmarcar todos</button>
              </div>
              <div>
                {fresh.map((r) => {
                  const c = choices[r.key];
                  const kindCats = categories.filter((x) => x.kind === r.kind && !x.archived);
                  return (
                    <div className="review-row" key={r.key} style={{ opacity: c?.include ? 1 : 0.5 }}>
                      <label className="row-flex" style={{ minWidth: 0 }}>
                        <input type="checkbox" checked={!!c?.include} onChange={(e) => setChoice(r.key, { include: e.target.checked })} />
                        <span style={{ minWidth: 0 }}>
                          <div className="t1" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.row.description}</div>
                          <div className="xsmall muted">{shortDate(r.row.date)}</div>
                        </span>
                      </label>
                      <strong className={`num ${r.row.amount > 0 ? 'pos' : ''}`} style={{ textAlign: 'right' }}>{r.row.amount > 0 ? '+' : ''}{eur(r.row.amount)}</strong>
                      <select className="input" style={{ gridColumn: '1 / -1' }} value={c?.transferTo ? `t:${c.transferTo}` : c?.categoryId ?? ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          setChoice(r.key, v.startsWith('t:') ? { transferTo: v.slice(2), categoryId: null } : { transferTo: null, categoryId: v || null });
                        }}>
                        <option value="">{r.kind === 'income' ? 'Ingreso' : 'Gasto'} sin categoría</option>
                        {kindCats.map((x) => <option key={x.id} value={x.id}>{x.icon} {x.name}</option>)}
                        {otherAccounts.length > 0 && <optgroup label="Traspaso entre tus cuentas">
                          {otherAccounts.map((a) => <option key={a.id} value={`t:${a.id}`}>↔ {r.row.amount < 0 ? 'a' : 'desde'} {a.name}</option>)}
                        </optgroup>}
                      </select>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {matches.length > 0 && (
            <details style={{ marginTop: 16 }}>
              <summary className="small" style={{ cursor: 'pointer', fontWeight: 600 }}>Coinciden con lo que ya habías apuntado ({matches.length})</summary>
              {matches.map((r) => {
                const t = data.transactions.find((x) => x.id === r.matchId)!;
                return (
                  <div className="review-row" key={r.key}>
                    <div className="small"><div>{r.row.description}</div><div className="muted">↔ {t.note || cat(t.categoryId).name} · {shortDate(t.date)}</div></div>
                    <strong className="num small">{eur(r.row.amount)}</strong>
                  </div>
                );
              })}
            </details>
          )}

          {error && <div className="error-text">{error}</div>}
          <div className="btn-row">
            <button className="btn" onClick={() => setStep(loaded?.kind === 'table' ? 'map' : 'pick')}>Atrás</button>
            <button className="btn primary" onClick={confirm} disabled={!built.created.length && !built.updated.length && !(adjust && gap?.diff)}>
              Importar {built.created.length} y conciliar {built.updated.length}
            </button>
          </div>
        </>
      )}

      {step === 'done' && (
        <div className="center" style={{ padding: '20px 0' }}>
          <div style={{ fontSize: 40 }}>✅</div>
          <h3 className="display" style={{ fontSize: 22, margin: '8px 0' }}>Extracto importado</h3>
          <p className="muted">
            {summary.created} movimientos añadidos · {summary.matched} conciliados con los que ya tenías
            {summary.recurring > 0 && ` · ${summary.recurring} programados marcados como hechos`}.
          </p>
          <button className="btn primary" onClick={onClose}>Listo</button>
        </div>
      )}
    </Sheet>
  );
}

function MappingStep({ rows, mapping, onChange, onBack, onNext, error }: {
  rows: (string | number | boolean | Date | null | undefined)[][]; mapping: TableMapping; onChange: (m: TableMapping) => void;
  onBack: () => void; onNext: () => void; error: string;
}) {
  const header = mapping.headerRow >= 0 ? rows[mapping.headerRow] : [];
  const width = Math.max(...rows.slice(0, 50).map((r) => r.length));
  const cols = Array.from({ length: width }, (_, i) => ({ i, label: String(header[i] ?? '').trim() || `Columna ${i + 1}` }));
  const preview = applyMapping(rows, mapping);
  const twoCols = mapping.amount == null;
  const set = (p: Partial<TableMapping>) => onChange({ ...mapping, ...p });
  const col = (value: number | null, onPick: (v: number | null) => void, optional?: boolean) => (
    <select className="input" value={value ?? ''} onChange={(e) => onPick(e.target.value === '' ? null : Number(e.target.value))}>
      {optional && <option value="">—</option>}
      {cols.map((c) => <option key={c.i} value={c.i}>{c.label}</option>)}
    </select>
  );
  return (
    <>
      <p className="muted small" style={{ marginTop: 0 }}>Comprueba que las columnas son correctas. Lo recordaremos para la próxima vez.</p>
      <div className="row-flex" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}><Field label="Fecha">{col(mapping.date, (v) => set({ date: v ?? 0 }))}</Field></div>
        <div style={{ flex: 1 }}><Field label="Formato de fecha">
          <select className="input" value={mapping.dateOrder} onChange={(e) => set({ dateOrder: e.target.value as TableMapping['dateOrder'] })}>
            <option value="dmy">día/mes/año</option><option value="mdy">mes/día/año</option><option value="ymd">año-mes-día</option>
          </select>
        </Field></div>
      </div>
      <Field label="Concepto">{col(mapping.description[0] ?? null, (v) => set({ description: v == null ? [] : [v, ...mapping.description.slice(1).filter((x) => x !== v)] }))}</Field>
      <Field label="Concepto adicional (opcional)">{col(mapping.description[1] ?? null, (v) => set({ description: [mapping.description[0], ...(v == null ? [] : [v])].filter((x) => x != null) as number[] }), true)}</Field>
      <label className="row-flex field"><input type="checkbox" checked={twoCols} onChange={(e) => set(e.target.checked ? { amount: null, debit: mapping.debit ?? 0, credit: mapping.credit ?? 0 } : { amount: mapping.amount ?? 0 })} /> El importe viene en dos columnas (cargo / abono)</label>
      {twoCols ? (
        <div className="row-flex">
          <div style={{ flex: 1 }}><Field label="Cargos (salidas)">{col(mapping.debit, (v) => set({ debit: v }), true)}</Field></div>
          <div style={{ flex: 1 }}><Field label="Abonos (entradas)">{col(mapping.credit, (v) => set({ credit: v }), true)}</Field></div>
        </div>
      ) : (
        <Field label="Importe">{col(mapping.amount, (v) => set({ amount: v }))}</Field>
      )}
      <Field label="Saldo (opcional, para comprobar que cuadra)">{col(mapping.balance, (v) => set({ balance: v }), true)}</Field>
      <label className="row-flex field"><input type="checkbox" checked={mapping.invert} onChange={(e) => set({ invert: e.target.checked })} /> Invertir signo (si los gastos salen en positivo)</label>

      <div className="section-head"><h2>Vista previa</h2><span className="small muted">{preview.length} movimientos</span></div>
      <div className="card flush">
        {preview.slice(0, 5).map((r, i) => (
          <div className="list-row" key={i}>
            <div className="main-col"><div className="t1">{r.description}</div><div className="t2">{shortDate(r.date)}{r.balance != null && ` · saldo ${eur(r.balance)}`}</div></div>
            <div className={`amt ${r.amount > 0 ? 'pos' : ''}`}>{eur(r.amount)}</div>
          </div>
        ))}
        {!preview.length && <p className="muted center small">Ninguna fila válida con esta configuración.</p>}
      </div>
      {error && <div className="error-text">{error}</div>}
      <div className="btn-row">
        <button className="btn" onClick={onBack}>Atrás</button>
        <button className="btn primary" disabled={!preview.length} onClick={onNext}>Continuar</button>
      </div>
    </>
  );
}
