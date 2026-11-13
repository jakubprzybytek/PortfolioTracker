// The time axis of the charts over dates (ISO "YYYY-MM-DD", one point a session or a day): ticks on the first point of
// a month ("Feb"), of a year ("2026", stronger), or of a week on a short range ("3 Nov"), never on a day picked at
// random. Recharts' own choice (every n-th point) labelled "11-27", "12-22", "01-22".

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Up to about two months: a tick a week. */
const WEEKLY_UP_TO_DAYS = 62;
/** Months between ticks, the fewest that keep the ticks within `maxTicks`. */
const MONTH_STEPS = [1, 2, 3, 6, 12, 24, 60, 120];

export interface TimeAxis {
  /** The dates to label (each one of the data's). */
  ticks: string[];
  /** The first point of each year in the data: a stronger label, and a line across the chart. */
  yearStarts: string[];
  format: (date: string) => string;
  isYearStart: (date: string) => boolean;
}

const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;
const monthIndex = (d: string) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1;

/**
 * Ticks for `dates` (ascending), at most `maxTicks` of them. The first point isn't a tick: it's where the data starts,
 * not the start of a month (an earlier point may exist that the range left out).
 */
export function timeAxis(dates: string[], maxTicks: number): TimeAxis {
  const monthStarts = dates.filter((d, i) => i > 0 && d.slice(0, 7) !== dates[i - 1]!.slice(0, 7));
  const yearStarts = monthStarts.filter((d) => d.slice(5, 7) === "01");
  const years = new Set(yearStarts);
  const isYearStart = (d: string) => years.has(d);
  const span = dates.length > 1 ? days(dates[0]!, dates.at(-1)!) : 0;

  if (span <= WEEKLY_UP_TO_DAYS) {
    // The first point of each week (Monday on), every n-th week to fit.
    const weekStarts = dates.filter((d, i) => i > 0 && Math.floor((days("1970-01-05", d) + 0.5) / 7) !== Math.floor((days("1970-01-05", dates[i - 1]!) + 0.5) / 7));
    const step = Math.max(1, Math.ceil(weekStarts.length / Math.max(1, maxTicks)));
    const ticks = weekStarts.filter((_, i) => i % step === 0);
    return { ticks, yearStarts, isYearStart, format: (d) => (isYearStart(d) ? d.slice(0, 4) : `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`) };
  }

  // A month's first point, every `step` months counted from January, so a year's start always stays a tick.
  const step = MONTH_STEPS.find((s) => monthStarts.filter((d) => monthIndex(d) % s === 0).length <= maxTicks) ?? MONTH_STEPS.at(-1)!;
  const ticks = monthStarts.filter((d) => monthIndex(d) % step === 0);
  return { ticks, yearStarts, isYearStart, format: (d) => (isYearStart(d) ? d.slice(0, 4) : MONTHS[Number(d.slice(5, 7)) - 1]!) };
}
