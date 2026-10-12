// Indicators from data already stored: CPI (CPI_REF items: monthly CPI m/m and the IZ reference index W(n))
// and NBP exchange rates (FX#<currency> items).
// No 12-month inflation here: compounding the one-decimal monthly figures misses GUS's published y/y by up to
// ~0.3 pp (2026-08: 3.13 vs 3.4), so that needs GUS's own y/y series.

export interface IndicatorPoint {
  /** "YYYY-MM" for monthly indicators, "YYYY-MM-DD" for daily ones. */
  date: string;
  value: number;
}

export interface IndicatorInfo {
  id: string;
  name: string;
  group: "Inflation" | "Exchange rates";
  unit: "%" | "index" | "PLN";
  frequency: "monthly" | "daily";
  /** One line on what it is and where it comes from. */
  note: string;
}

export interface Indicator extends IndicatorInfo {
  points: IndicatorPoint[];
}

/** The Indicators view's row: the latest value and the one a year before it. */
export interface IndicatorSummary extends IndicatorInfo {
  latest: IndicatorPoint | null;
  yearAgo: IndicatorPoint | null;
}

export const CPI_INDICATORS: IndicatorInfo[] = [
  {
    id: "cpi-mom",
    name: "Inflation, month on month",
    group: "Inflation",
    unit: "%",
    frequency: "monthly",
    note: "CPI, change on the previous month (GUS). For January, the preliminary figure the Ministry of Finance uses",
  },
  {
    id: "cpi-index",
    name: "CPI reference index",
    group: "Inflation",
    unit: "index",
    frequency: "monthly",
    note: "Consumer prices chained monthly, June 2003 = 100 (Ministry of Finance); drives the indexation of IZ bonds",
  },
];

/** Exchange-rate indicators: `fx-eur` → EUR. */
export const fxIndicator = (currency: string): IndicatorInfo => ({
  id: `fx-${currency.toLowerCase()}`,
  name: `${currency.toUpperCase()}/PLN`,
  group: "Exchange rates",
  unit: "PLN",
  frequency: "daily",
  note: `NBP mid rate (table A): PLN per 1 ${currency.toUpperCase()}; used to value instruments priced in ${currency.toUpperCase()}`,
});

export const fxCurrencyOf = (id: string): string | undefined => /^fx-([a-z]{3})$/.exec(id)?.[1]?.toUpperCase();

/** CPI month on month and the CPI reference index, oldest first. */
export function cpiIndicators(months: { month: string; wr: number; w: number }[]): Indicator[] {
  const sorted = [...months].sort((a, b) => a.month.localeCompare(b.month));
  const [mom, index] = CPI_INDICATORS as [IndicatorInfo, IndicatorInfo];
  return [
    { ...mom, points: sorted.map((m) => ({ date: m.month, value: Number((m.wr * 100).toFixed(2)) })) },
    { ...index, points: sorted.map((m) => ({ date: m.month, value: m.w })) },
  ];
}

/** The same date a year earlier: "2026-08" → "2025-08", "2026-10-12" → "2025-10-12". */
export const yearBefore = (date: string): string => `${Number(date.slice(0, 4)) - 1}${date.slice(4)}`;

/** Latest point and the last one on or before the same date a year earlier (points oldest first). */
export function summarize(info: IndicatorInfo, points: IndicatorPoint[]): IndicatorSummary {
  const latest = points.at(-1) ?? null;
  const target = latest && yearBefore(latest.date);
  const yearAgo = target ? ([...points].reverse().find((p) => p.date <= target) ?? null) : null;
  return { ...info, latest, yearAgo };
}
