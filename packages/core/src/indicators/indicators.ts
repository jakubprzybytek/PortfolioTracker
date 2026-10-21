// Indicators from data already stored: CPI (GUS's figures as published: 12 months, since December and so per year;
// CPI_REF items: monthly CPI m/m and the IZ reference index W(n)) and NBP exchange rates (FX#<currency> items).
// Inflation over 12 months or a year is GUS's own figure, not compounded from the one-decimal monthly ones (that
// misses it by up to ~0.3 pp: 2026-08 3.13 vs 3.4).

export interface IndicatorPoint {
  /** "YYYY" for yearly indicators, "YYYY-MM" for monthly ones, "YYYY-MM-DD" for daily ones. */
  date: string;
  value: number;
}

export interface IndicatorInfo {
  id: string;
  name: string;
  group: "Inflation" | "Exchange rates";
  unit: "%" | "index" | "PLN";
  frequency: "yearly" | "monthly" | "daily";
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
    id: "cpi-yoy",
    name: "Inflation, 12 months",
    group: "Inflation",
    unit: "%",
    frequency: "monthly",
    note: "CPI, change on the same month a year earlier (GUS): the inflation usually quoted",
  },
  {
    id: "cpi-annual",
    name: "Inflation per year",
    group: "Inflation",
    unit: "%",
    frequency: "yearly",
    note: "CPI, December on December (GUS): how much prices rose over each calendar year; Performance's returns by year compare with it",
  },
  {
    id: "cpi-ytd",
    name: "Inflation since December",
    group: "Inflation",
    unit: "%",
    frequency: "monthly",
    note: "CPI, change since December of the year before (GUS): the year so far; December's is the year's inflation",
  },
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

/**
 * The inflation indicators, oldest first: 12 months and since December from GUS's figures as published (`yoy`, `ytd`:
 * e.g. 104.1 → 4.1 %), per year from December's since-December figure, and from the IZ reference index (`months`)
 * the month on month change and the index itself.
 */
export function cpiIndicators(
  months: { month: string; wr: number; w: number }[],
  gus: { yoy: { month: string; value: number }[]; ytd: { month: string; value: number }[] } = { yoy: [], ytd: [] },
): Indicator[] {
  const byMonth = <T extends { month: string }>(xs: T[]) => [...xs].sort((a, b) => a.month.localeCompare(b.month));
  const change = (v: number) => Number((v - 100).toFixed(1));
  const sorted = byMonth(months);
  const ytd = byMonth(gus.ytd);
  const [yoyInfo, annualInfo, ytdInfo, mom, index] = CPI_INDICATORS as [IndicatorInfo, IndicatorInfo, IndicatorInfo, IndicatorInfo, IndicatorInfo];
  return [
    { ...yoyInfo, points: byMonth(gus.yoy).map((m) => ({ date: m.month, value: change(m.value) })) },
    { ...annualInfo, points: ytd.filter((m) => m.month.endsWith("-12")).map((m) => ({ date: m.month.slice(0, 4), value: change(m.value) })) },
    { ...ytdInfo, points: ytd.map((m) => ({ date: m.month, value: change(m.value) })) },
    { ...mom, points: sorted.map((m) => ({ date: m.month, value: Number((m.wr * 100).toFixed(2)) })) },
    { ...index, points: sorted.map((m) => ({ date: m.month, value: m.w })) },
  ];
}

/** The same date a year earlier: "2026" → "2025", "2026-08" → "2025-08", "2026-10-12" → "2025-10-12". */
export const yearBefore = (date: string): string => `${Number(date.slice(0, 4)) - 1}${date.slice(4)}`;

/** Latest point and the last one on or before the same date a year earlier (points oldest first). */
export function summarize(info: IndicatorInfo, points: IndicatorPoint[]): IndicatorSummary {
  const latest = points.at(-1) ?? null;
  const target = latest && yearBefore(latest.date);
  const yearAgo = target ? ([...points].reverse().find((p) => p.date <= target) ?? null) : null;
  return { ...info, latest, yearAgo };
}
