import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MONTHS_SHORT, MONTHS_LONG } from '../lib/dates';
import { eur, eur0 } from '../lib/format';

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(320);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function niceStep(range: number, ticks = 4) {
  const raw = range / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

function scale(values: number[]) {
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const step = niceStep(max - min || 1);
  const top = Math.ceil(max / step) * step || step;
  const bottom = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = bottom; v <= top + step / 2; v += step) ticks.push(Math.round(v));
  return { top, bottom, ticks };
}

/** Bar path with a 4px rounded data-end and a square base. */
function barPath(x: number, w: number, y0: number, y1: number) {
  const r = Math.min(4, w / 2, Math.abs(y1 - y0));
  if (Math.abs(y1 - y0) < 0.5) return '';
  if (y1 < y0) return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`;
  return `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`;
}

export interface Series { label: string; color: string; values: number[] }

const PAD = { l: 44, r: 8, t: 12, b: 24 };

/** Column chart by month (grouped when several series) with optional target ticks. */
export function MonthColumns({ series, target, targetLabel = 'Objetivo', height = 200, highlight }: {
  series: Series[]; target?: number[] | null; targetLabel?: string; height?: number; highlight?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const all = [...series.flatMap((s) => s.values), ...(target ?? [])];
  const { top, bottom, ticks } = scale(all);
  const innerW = width - PAD.l - PAD.r;
  const innerH = height - PAD.t - PAD.b;
  const y = (v: number) => PAD.t + ((top - v) / (top - bottom)) * innerH;
  const slot = innerW / 12;
  const gap = 2;
  const barW = Math.min(24, (slot * 0.7 - gap * (series.length - 1)) / series.length);
  const groupW = barW * series.length + gap * (series.length - 1);

  return (
    <div className="chart-box" ref={ref}>
      <svg className="chart" width={width} height={height} role="img" aria-label={series.map((s) => s.label).join(', ')}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={width - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--ink-faint)">{compact(t)}</text>
          </g>
        ))}
        <line x1={PAD.l} x2={width - PAD.r} y1={y(0)} y2={y(0)} stroke="var(--ink-faint)" strokeWidth={1} />
        {MONTHS_SHORT.map((m, i) => {
          const x0 = PAD.l + slot * i + (slot - groupW) / 2;
          return (
            <g key={m} opacity={hover != null && hover !== i ? 0.45 : 1}>
              {highlight === i && <rect x={PAD.l + slot * i} y={PAD.t} width={slot} height={innerH} fill="var(--surface-2)" />}
              {series.map((s, k) => (
                <path key={s.label} d={barPath(x0 + k * (barW + gap), barW, y(0), y(s.values[i] || 0))} fill={s.color} />
              ))}
              {target && target[i] ? (
                <line x1={x0 - 3} x2={x0 + groupW + 3} y1={y(target[i])} y2={y(target[i])} stroke="var(--ink)" strokeWidth={2} strokeLinecap="round" />
              ) : null}
              <text x={PAD.l + slot * i + slot / 2} y={height - 6} textAnchor="middle" fontSize={11} fill={highlight === i ? 'var(--ink)' : 'var(--ink-faint)'}>
                {width < 420 ? m.charAt(0).toUpperCase() : m}
              </text>
              <rect x={PAD.l + slot * i} y={0} width={slot} height={height} fill="transparent"
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => setHover(hover === i ? null : i)} />
            </g>
          );
        })}
      </svg>
      {hover != null && (
        <Tip x={Math.min(Math.max(PAD.l + slot * hover + slot / 2, 80), width - 80)}>
          <div className="h">{MONTHS_LONG[hover]}</div>
          {series.map((s) => <div className="r" key={s.label}><i style={{ background: s.color }} />{s.label}: {eur(s.values[hover] || 0)}</div>)}
          {target && target[hover] ? <div className="r"><i style={{ background: 'var(--ink)', height: 2 }} />{targetLabel}: {eur(target[hover])}</div> : null}
        </Tip>
      )}
      <div className="legend">
        {series.length > 1 || target ? series.map((s) => <span key={s.label}><i style={{ background: s.color }} />{s.label}</span>) : null}
        {target && target.some(Boolean) && <span><i style={{ background: 'var(--ink)', height: 2, verticalAlign: 3 }} />{targetLabel}</span>}
      </div>
    </div>
  );
}

/** Single-series line (e.g. net worth at the end of each month). */
export function LineChart({ values, labels, color = 'var(--series-1)', height = 180 }: {
  values: (number | null)[]; labels: string[]; color?: string; height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const nums = values.filter((v): v is number => v != null);
  if (!nums.length) return <div ref={ref} />;
  const min = Math.min(...nums), max = Math.max(...nums);
  const step = niceStep(max - min || Math.abs(max) || 1, 3);
  const bottom = Math.floor(min / step) * step;
  const top = Math.ceil(max / step) * step === bottom ? bottom + step : Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = bottom; v <= top + step / 2; v += step) ticks.push(v);
  const innerW = width - PAD.l - PAD.r - 8;
  const innerH = height - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + 4 + (innerW * i) / Math.max(1, values.length - 1);
  const y = (v: number) => PAD.t + ((top - v) / (top - bottom)) * innerH;
  const pts = values.map((v, i) => (v == null ? null : [x(i), y(v)] as const)).filter(Boolean) as (readonly [number, number])[];
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join('');
  const lastIdx = values.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0).pop()!;
  return (
    <div className="chart-box" ref={ref}>
      <svg className="chart" width={width} height={height} role="img" aria-label="Evolución">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={width - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--ink-faint)">{compact(t)}</text>
          </g>
        ))}
        <path d={`${d}L${pts[pts.length - 1][0]},${y(bottom)}L${pts[0][0]},${y(bottom)}Z`} fill={color} opacity={0.1} />
        <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(lastIdx)} cy={y(values[lastIdx]!)} r={4.5} fill={color} stroke="var(--surface)" strokeWidth={2} />
        {hover != null && values[hover] != null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + innerH} stroke="var(--ink-faint)" strokeWidth={1} />
            <circle cx={x(hover)} cy={y(values[hover]!)} r={4.5} fill={color} stroke="var(--surface)" strokeWidth={2} />
          </>
        )}
        {labels.map((l, i) => (
          <text key={i} x={x(i)} y={height - 6} textAnchor="middle" fontSize={11} fill="var(--ink-faint)">{width < 420 ? l.charAt(0).toUpperCase() : l}</text>
        ))}
        {values.map((_, i) => (
          <rect key={i} x={x(i) - innerW / values.length / 2} y={0} width={innerW / values.length} height={height} fill="transparent"
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => setHover(hover === i ? null : i)} />
        ))}
      </svg>
      {hover != null && values[hover] != null && (
        <Tip x={Math.min(Math.max(x(hover), 70), width - 70)}>
          <div className="h">{MONTHS_LONG[hover] ?? labels[hover]}</div>
          <div className="r">{eur(values[hover]!)}</div>
        </Tip>
      )}
    </div>
  );
}

function Tip({ x, children }: { x: number; children: ReactNode }) {
  return <div className="chart-tip" style={{ left: x }}>{children}</div>;
}

function compact(v: number) {
  const a = Math.abs(v);
  if (a >= 1000) return `${(v / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })}k`;
  return eur0(v).replace(/\s?€/, '');
}
