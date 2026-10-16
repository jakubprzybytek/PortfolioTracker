// Thousands grouped from 1000 on ("8 597,39"; Polish style otherwise starts at 10 000), easier to read in columns.
const always = { useGrouping: "always" } as unknown as Intl.NumberFormatOptions;
const pln = new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 2, ...always });
const num = new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 2, ...always });
const pct = new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 2, signDisplay: "exceptZero" });

export const fmtPln = (v: number | null | undefined): string => (v === null || v === undefined ? "–" : pln.format(v));
const money = new Map<string, Intl.NumberFormat>();
/** An amount in any currency: PLN as "1 234,56 zł", others as "1 234,56 EUR". */
export const fmtMoney = (v: number | null | undefined, currency: string): string => {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  if (currency === "PLN") return pln.format(v);
  let f = money.get(currency);
  if (!f) money.set(currency, (f = new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2, ...always })));
  return `${f.format(v)} ${currency}`;
};
export const fmtNum = (v: number | null | undefined, digits = 2): string =>
  v === null || v === undefined ? "–" : new Intl.NumberFormat("pl-PL", { minimumFractionDigits: digits, maximumFractionDigits: digits, ...always }).format(v);
export const fmtPct = (v: number | null | undefined): string => (v === null || v === undefined ? "–" : `${pct.format(v)} %`);
/** Short axis labels for narrow charts: 950, 12,5k, 57k, 1,6M (no space: the chart would wrap the label there). */
export const fmtCompact = (v: number): string => {
  const a = Math.abs(v);
  return a >= 1e6 ? `${fmtNum(v / 1e6, 1)}M` : a >= 1e4 ? `${fmtNum(v / 1e3, 0)}k` : a >= 1e3 ? `${fmtNum(v / 1e3, 1)}k` : fmtNum(v, 0);
};
export const fmtInt = (v: number | null | undefined): string => (v === null || v === undefined ? "–" : num.format(v));
export const signClass = (v: number | null | undefined): string => (v === null || v === undefined || v === 0 ? "" : v > 0 ? "pos" : "neg");

export function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
/** Today on this device's calendar (not UTC: after midnight in Poland UTC still says yesterday). */
export const today = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

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

/** Readable labels for instrument types (the "asset type" filters). Cash movements have no instrument: "CASH". */
export const TYPE_LABELS: Record<string, string> = {
  BOND_LISTED: "Listed bond",
  BOND_CORPORATE: "Corporate bond",
  BOND_RETAIL: "Retail bond",
  BOND_IBKR: "Foreign bond",
  ETF: "ETF",
  FUND_MANUAL: "Manually valued",
  CURRENCY: "Foreign cash",
  CASH: "Cash",
};
export const typeLabel = (type: string): string => TYPE_LABELS[type] ?? type;

export const TX_TYPE_LABELS: Record<string, string> = {
  BUY: "Buy",
  SELL: "Sell",
  COUPON: "Coupon",
  REDEMPTION: "Redemption",
  WRITE_OFF: "Write-off",
  DEPOSIT: "Deposit",
  WITHDRAWAL: "Withdrawal",
  FEE: "Fee",
  TAX: "Tax",
  INTEREST: "Interest",
  DIVIDEND: "Dividend",
  SPLIT: "Split",
  EXCHANGE: "Currency exchange",
};

/** "1 234,56" or "1234.56" → 1234.56; empty → undefined; not a number → NaN. */
const warsawTime = new Intl.DateTimeFormat("pl-PL", { timeZone: "Europe/Warsaw", hour: "2-digit", minute: "2-digit" });
/** Time of day in Warsaw, e.g. "13:38". */
export const fmtTime = (iso: string): string => warsawTime.format(new Date(iso));

/**
 * How fresh a price is, when it's worth saying: the time of a price fetched during the day ("Refresh prices"), or the
 * date of one older than the newest price shown (no trade since). Nothing for an ordinary close.
 */
export function priceAge(date: string | null, time: string | undefined, newest: string | undefined): string | null {
  if (time) return fmtTime(time);
  if (!date || !newest || date >= newest) return null;
  const d = new Date(`${date}T12:00:00Z`);
  return date.slice(0, 4) === newest.slice(0, 4) ? shortDate.format(d) : shortDateYear.format(d);
}
const shortDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const shortDateYear = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
/** Tooltip for a price's age. */
export function priceAgeTitle(date: string | null, time: string | undefined): string {
  if (!date) return "";
  return time ? `Last price at ${fmtTime(time)} on ${date}, fetched during the day ("Refresh"); the day's close replaces it in the evening` : `Price of ${date}`;
}

export const parseNum = (s: string): number | undefined => {
  const t = s.replace(/[\s ]/g, "").replace(",", ".");
  return t === "" ? undefined : Number(t);
};
