const pln = new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 2 });
const num = new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 2 });
const pct = new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 2, signDisplay: "exceptZero" });

export const fmtPln = (v: number | null | undefined): string => (v === null || v === undefined ? "–" : pln.format(v));
export const fmtNum = (v: number | null | undefined, digits = 2): string =>
  v === null || v === undefined ? "–" : new Intl.NumberFormat("pl-PL", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
export const fmtPct = (v: number | null | undefined): string => (v === null || v === undefined ? "–" : `${pct.format(v)} %`);
export const fmtInt = (v: number | null | undefined): string => (v === null || v === undefined ? "–" : num.format(v));
export const signClass = (v: number | null | undefined): string => (v === null || v === undefined || v === 0 ? "" : v > 0 ? "pos" : "neg");

export function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export const today = (): string => new Date().toISOString().slice(0, 10);

export type RangeKey = "1M" | "6M" | "1Y" | "ALL";
export const RANGES: { key: RangeKey; days: number | null }[] = [
  { key: "1M", days: 31 },
  { key: "6M", days: 183 },
  { key: "1Y", days: 365 },
  { key: "ALL", days: null },
];
export const rangeFrom = (key: RangeKey): string => {
  const days = RANGES.find((r) => r.key === key)!.days;
  return days === null ? "2000-01-01" : addDays(today(), -days);
};
