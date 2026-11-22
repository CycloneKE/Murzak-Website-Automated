import React from "react";

/** Series colours come from the portal theme tokens, so light and dark both work. */
export const SERIES = {
  blue: "var(--p-info)",
  green: "var(--p-success)",
  amber: "var(--p-warning)",
  red: "var(--p-danger)",
  violet: "var(--p-accent)",
  grey: "var(--p-muted)",
} as const;

/** A tiny trend line under a stat. Decorative: the number beside it carries the meaning. */
export const Sparkline: React.FC<{ values: number[]; color: string; height?: number }> = ({ values, color, height = 36 }) => {
  const w = 120;
  if (values.length < 2 || values.every((v) => v === 0)) {
    return <div aria-hidden className="h-9 flex items-end"><div className="h-px w-full bg-p-border" /></div>;
  }
  const max = Math.max(...values, 1);
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - (v / max) * (height - 4)).toFixed(1)}`);
  return (
    <svg aria-hidden viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
};

export interface AreaPoint { label: string; value: number }

/**
 * Requests over time. Axis ticks are real values (0 to the rounded-up max), and
 * every bucket exposes its exact value on hover and to screen readers.
 */
export const AreaChart: React.FC<{ points: AreaPoint[]; color: string; ariaLabel: string; xLabels: string[] }> = ({
  points, color, ariaLabel, xLabels,
}) => {
  const W = 900, H = 220, L = 40, R = 8, T = 10, B = 26;
  const n = points.length;
  const rawMax = Math.max(...points.map((p) => p.value), 0);
  const niceMax = niceCeil(rawMax);
  const x = (i: number) => L + (n <= 1 ? 0 : (i / (n - 1)) * (W - L - R));
  const y = (v: number) => T + (1 - v / niceMax) * (H - T - B);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = n ? `${line} L${x(n - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z` : "";
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(niceMax * f));
  return (
    <svg role="img" aria-label={ariaLabel} viewBox={`0 0 ${W} ${H}`} className="w-full h-auto text-p-muted" style={{ maxHeight: 260 }}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--p-border)" strokeWidth="1" />
          <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="currentColor">{t}</text>
        </g>
      ))}
      {n > 0 && <path d={area} fill={color} opacity="0.12" />}
      {n > 0 && <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
      {xLabels.map((l, i) => (
        l ? <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize="11" fill="currentColor">{l}</text> : null
      ))}
      {points.map((p, i) => (
        <rect key={i} x={x(i) - (W - L - R) / Math.max(1, n - 1) / 2} y={T} width={(W - L - R) / Math.max(1, n - 1)} height={H - T - B} fill="transparent">
          <title>{`${p.label}: ${p.value} requests`}</title>
        </rect>
      ))}
    </svg>
  );
};

/** 0 -> 4, 7 -> 8, 130 -> 150: a round top so the axis ticks read cleanly. */
export function niceCeil(v: number): number {
  if (v <= 4) return 4;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / pow;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * pow;
}

export interface DonutSlice { name: string; value: number; color: string }

/** Share-of-requests ring with a legend that doubles as the accessible description. */
export const Donut: React.FC<{ slices: DonutSlice[]; ariaLabel: string }> = ({ slices, ariaLabel }) => {
  const total = slices.reduce((n, s) => n + s.value, 0);
  const r = 52, c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="flex flex-col items-center gap-3">
      <svg role="img" aria-label={ariaLabel} viewBox="0 0 140 140" className="w-40 h-40 -rotate-90">
        <circle cx="70" cy="70" r={r} fill="none" stroke="var(--p-border)" strokeWidth="18" />
        {total > 0 && slices.filter((s) => s.value > 0).map((s) => {
          const len = (s.value / total) * c;
          const el = (
            <circle key={s.name} cx="70" cy="70" r={r} fill="none" stroke={s.color} strokeWidth="18"
              strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset}>
              <title>{`${s.name}: ${s.value}`}</title>
            </circle>
          );
          offset += len;
          return el;
        })}
      </svg>
      <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-[13px] text-p-muted">
        {slices.map((s) => (
          <li key={s.name} className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} aria-hidden />
            {s.name} <span className="text-p-text font-medium">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};
