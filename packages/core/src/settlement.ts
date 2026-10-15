// Settlement days of the Warsaw exchange (GPW, Catalyst; settled by KDPW): weekdays without a session.
import { addDays, type IsoDate } from "./dates.ts";

/** Easter Sunday of `year` (Gregorian; the anonymous algorithm). */
export function easterSunday(year: number): IsoDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const closedDays = new Map<number, Set<IsoDate>>();

/**
 * Weekdays without a session in `year`: Polish public holidays, plus Good Friday, 24 and 31 December (the exchange is
 * closed then too).
 */
function closedIn(year: number): Set<IsoDate> {
  let set = closedDays.get(year);
  if (!set) {
    const easter = easterSunday(year);
    const fixed = ["01-01", "01-06", "05-01", "05-03", "08-15", "11-01", "11-11", "12-24", "12-25", "12-26", "12-31"];
    set = new Set([...fixed.map((md) => `${year}-${md}`), addDays(easter, -2), addDays(easter, 1), addDays(easter, 60)]);
    closedDays.set(year, set);
  }
  return set;
}

/** A day the exchange trades and KDPW settles: a weekday that isn't a holiday. */
export function isSettlementDay(date: IsoDate): boolean {
  const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
  return wd !== 0 && wd !== 6 && !closedIn(Number(date.slice(0, 4))).has(date);
}

/** `date` plus `n` settlement days (`date` itself not counted). */
export function addSettlementDays(date: IsoDate, n: number): IsoDate {
  let d = date;
  while (n > 0) {
    d = addDays(d, 1);
    if (isSettlementDay(d)) n--;
  }
  return d;
}

/** Trades on GPW and Catalyst settle two settlement days after the trade (T+2). */
export const SETTLEMENT_DAYS = 2;

/**
 * The settlement day of a sale on `date` (T+2). A bond's market value on `date` carries accrued interest to this day,
 * as the exchange quotes it: the buyer pays the interest up to it. A weekend or holiday gives the same day as the
 * session before it.
 */
export const settlementDate = (date: IsoDate): IsoDate => addSettlementDays(date, SETTLEMENT_DAYS);
