// Indicators from the stored CPI (CPI_REF items: monthly CPI m/m and the IZ reference index W(n)).
// No 12-month inflation here: compounding the one-decimal monthly figures misses GUS's published y/y by up to
// ~0.3 pp (2026-08: 3.13 vs 3.4), so that needs GUS's own y/y series.

export interface IndicatorPoint {
  /** "YYYY-MM" for monthly indicators. */
  date: string;
  value: number;
}

export interface Indicator {
  id: "cpi-mom" | "cpi-index";
  name: string;
  unit: "%" | "index";
  /** One line on what it is and where it comes from. */
  note: string;
  points: IndicatorPoint[];
}

/** CPI month on month and the CPI reference index, oldest first. */
export function cpiIndicators(months: { month: string; wr: number; w: number }[]): Indicator[] {
  const sorted = [...months].sort((a, b) => a.month.localeCompare(b.month));
  return [
    {
      id: "cpi-mom",
      name: "Inflation, month on month",
      unit: "%",
      note: "CPI, change on the previous month (GUS). For January, the preliminary figure the Ministry of Finance uses",
      points: sorted.map((m) => ({ date: m.month, value: Number((m.wr * 100).toFixed(2)) })),
    },
    {
      id: "cpi-index",
      name: "CPI reference index",
      unit: "index",
      note: "Consumer prices chained monthly, June 2003 = 100 (Ministry of Finance); drives the indexation of IZ bonds",
      points: sorted.map((m) => ({ date: m.month, value: m.w })),
    },
  ];
}
