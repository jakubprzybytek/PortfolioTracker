// Date helpers. All dates are ISO strings "YYYY-MM-DD" handled in UTC, so no local time zone leaks in.

export type IsoDate = string;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function assertIsoDate(value: string): IsoDate {
  if (!ISO_DATE.test(value) || Number.isNaN(Date.parse(value + "T00:00:00Z"))) {
    throw new Error(`Not a YYYY-MM-DD date: "${value}"`);
  }
  return value;
}

export function toIsoDate(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

export function parseIsoDate(date: IsoDate): Date {
  return new Date(date + "T00:00:00Z");
}

const WARSAW_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit" });

/**
 * Today's date in Warsaw (the market's and the schedules' time zone), not UTC: between midnight and 01:00 (02:00 in
 * summer) Polish time UTC still says yesterday. `now` for tests.
 */
export function today(now: Date = new Date()): IsoDate {
  return WARSAW_DAY.format(now) as IsoDate; // en-CA formats as YYYY-MM-DD
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = parseIsoDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDate(d);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((parseIsoDate(to).getTime() - parseIsoDate(from).getTime()) / 86_400_000);
}

/** "YYYY-MM" shifted by `months` (negative allowed). */
export function shiftMonth(month: string, months: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + months, 1));
  return d.toISOString().slice(0, 7);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isWeekend(date: IsoDate): boolean {
  const day = parseIsoDate(date).getUTCDay();
  return day === 0 || day === 6;
}

/** Dates from `from` to `to` inclusive. */
export function eachDay(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Converts an Excel serial date number to an ISO date. */
export function excelSerialToIsoDate(serial: number): IsoDate {
  // Excel's epoch is 1899-12-30 (because of the fictitious 1900-02-29).
  return toIsoDate(new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000));
}
