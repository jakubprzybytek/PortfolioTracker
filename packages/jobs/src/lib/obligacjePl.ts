// obligacje.pl bond pages (no key): the terms of Catalyst corporate bonds, used for their coupon periods.
//   /pl/obligacja/<CODE>  issuer, ISIN, nominal, coupon type ("zmienne WIBOR 3M + 3.3%"), the current rate, and three
//                         lists: first days of the interest periods, record days, payment days (past and future)
// Only the current rate is published, never past ones. The site has had wrong values, so what it gives is a
// suggestion: it fills a period that has no rate yet and never replaces one (core/bonds/couponPeriods.ts).

import { daysBetween, type IsoDate } from "@portfolio/core";
import { fetchWithTimeout } from "./http.ts";

const BASE = "https://obligacje.pl/pl/obligacja/";
const HEADERS = { "User-Agent": "Mozilla/5.0 (portfolio-tracker, personal use)" };

export interface ObligacjePeriod {
  start: IsoDate;
  /** Exclusive: the next period's first day (the last period ends on its payment day). */
  end: IsoDate;
  /** Left out when the site's day doesn't fit the period (it has listed a record day a whole period early). */
  recordDate?: IsoDate;
  paymentDate: IsoDate;
}

export interface ObligacjeBond {
  isin: string;
  nominal: number;
  currency: string;
  /** As published, e.g. "zmienne WIBOR 3M + 3.3%" or "stałe 7.5%". */
  couponType: string;
  /** Annual rate of the current period (0.0713), when shown. */
  currentRate: number | null;
  /** Fixed-coupon bonds ("stałe 7.5%"): the rate of every period. */
  fixedRate: number | null;
  periods: ObligacjePeriod[];
}

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

function cell(html: string, label: string): string | undefined {
  const m = new RegExp(`<th>\\s*${label}\\s*</th>\\s*<td>([\\s\\S]*?)</td>`).exec(html);
  return m ? text(m[1]!) : undefined;
}

function dates(html: string, heading: string): IsoDate[] {
  const m = new RegExp(`<h4>\\s*${heading}\\s*</h4>\\s*<div class="txt">([\\s\\S]*?)</div>`).exec(html);
  return m ? [...m[1]!.matchAll(/<li>\s*(\d{4}-\d{2}-\d{2})\s*<\/li>/g)].map((d) => d[1]!) : [];
}

const pct = (s: string | undefined) => {
  const m = /(-?\d+(?:[.,]\d+)?)\s*%/.exec(s ?? "");
  return m ? Number((Number(m[1]!.replace(",", ".")) / 100).toFixed(6)) : null;
};

/**
 * The bond's terms. The three date lists are paired by position (period i: its first day, record day and payment
 * day); a list of a different length means the page is inconsistent, so it throws.
 */
export function parseBondPage(html: string): ObligacjeBond {
  const isin = cell(html, "ISIN:");
  if (!isin || !/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isin)) throw new Error("obligacje.pl: no ISIN on the page");
  const nominalText = cell(html, "Wartość nominalna:") ?? "";
  const nm = /([\d\s]+(?:[.,]\d+)?)\s*([A-Z]{3})/.exec(nominalText);
  if (!nm) throw new Error(`obligacje.pl ${isin}: no nominal`);
  const starts = dates(html, "Pierwsze dni okresów odsetkowych");
  const records = dates(html, "Dni ustalenia prawa do odsetek");
  const payments = dates(html, "Dni wypłaty odsetek");
  if (starts.length !== records.length || starts.length !== payments.length)
    throw new Error(`obligacje.pl ${isin}: ${starts.length} period starts, ${records.length} record days, ${payments.length} payment days`);
  const periods = starts.map((start, i): ObligacjePeriod => {
    const end = starts[i + 1] ?? payments[i]!;
    const paymentDate = payments[i]!;
    const record = records[i]!;
    if (!(start < end && end <= paymentDate)) throw new Error(`obligacje.pl ${isin}: period from ${start} doesn't add up`);
    // A record day lies a few days before the payment, inside the period.
    const fits = record > start && record <= paymentDate && daysBetween(record, paymentDate) <= 31;
    return { start, end, ...(fits ? { recordDate: record } : {}), paymentDate };
  });
  const couponType = cell(html, "Typ oprocentowania:") ?? "";
  return {
    isin,
    nominal: Number(nm[1]!.replace(/\s/g, "").replace(",", ".")),
    currency: nm[2]!,
    couponType,
    fixedRate: /^stałe/i.test(couponType) ? pct(couponType) : null,
    currentRate: pct(cell(html, "Oprocentowanie bieżące:")),
    periods,
  };
}

/** The bond's page, or undefined when obligacje.pl doesn't know the code. */
export async function fetchBondPage(code: string): Promise<string | undefined> {
  const res = await fetchWithTimeout(BASE + encodeURIComponent(code), { headers: HEADERS });
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`obligacje.pl ${code}: HTTP ${res.status}`);
  return res.text();
}
