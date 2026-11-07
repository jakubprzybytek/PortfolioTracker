// Bond terms for the Catalyst module (Docs/catalyst.md, "Jobs": catalyst-terms): the coupon as published
// ("zmienne WIBOR 6M + 3.85%", "stałe 7.5%"), and which bonds the terms job reads next. The pages are read by the
// job only (obligacje.pl blocks AI assistants: Docs/catalyst.md, "Rules for every source").

import { addDays, type IsoDate } from "../dates.ts";
import type { CatalystBondItem, CatalystTermsItem } from "./items.ts";

export type CouponKind = "FIXED" | "FLOATING" | "ZERO" | "OTHER";

export interface Coupon {
  kind: CouponKind;
  /** Floating: the reference rate ("WIBOR 3M", "WIRON 1M", "POLSTR 6M" (treasury NZ series), "EURIBOR 6M"). */
  base?: string;
  /** Floating: the margin over it, as a fraction (3.85% → 0.0385). */
  margin?: number;
  /** Fixed: the annual rate, as a fraction. */
  rate?: number;
}

const fraction = (s: string) => Number((Number(s.replace(",", ".")) / 100).toFixed(6));

/** The coupon in obligacje.pl's words: "stałe 7.5%", "zmienne WIBOR 3M + 3.3%", "zmienne WIRON 1M + 1,5%", "zerokuponowe". */
export function parseCoupon(text: string): Coupon {
  const t = text.trim();
  if (/zero/i.test(t)) return { kind: "ZERO" };
  const floating = /\b(WIBOR|WIRON|POLSTR|EURIBOR|WIBID|POLONIA)\s*(\d+[MYD])?\s*([+-])\s*(\d+(?:[.,]\d+)?)\s*%/i.exec(t);
  if (floating) {
    const margin = fraction(floating[4]!) * (floating[3] === "-" ? -1 : 1);
    return { kind: "FLOATING", base: [floating[1]!.toUpperCase(), floating[2]?.toUpperCase()].filter(Boolean).join(" "), margin };
  }
  const bare = /\b(WIBOR|WIRON|POLSTR|EURIBOR)\s*(\d+[MYD])?\b/i.exec(t);
  if (bare && /zmienne/i.test(t)) return { kind: "FLOATING", base: [bare[1]!.toUpperCase(), bare[2]?.toUpperCase()].filter(Boolean).join(" "), margin: 0 };
  const fixed = /^stał\w*\s+(\d+(?:[.,]\d+)?)\s*%/i.exec(t);
  if (fixed) return { kind: "FIXED", rate: fraction(fixed[1]!) };
  return { kind: "OTHER" };
}

/** Segments whose bonds the terms job reads; treasury bonds only for the floating series (WZ, NZ: their margins). */
const READ_SEGMENTS = new Set<CatalystBondItem["segment"]>(["corporate", "convertible", "bank", "mortgage-covered", "public-covered", "cooperative", "municipal"]);
const SEGMENT_ORDER: CatalystBondItem["segment"][] = ["corporate", "convertible", "bank", "mortgage-covered", "public-covered", "cooperative", "treasury", "municipal"];

/** A code obligacje.pl doesn't have is tried again after this many days. */
export const NOT_FOUND_RETRY_DAYS = 30;
/** A floating bond's rate is read again this many days into a new interest period (the site lags a few days). */
export const NEW_PERIOD_LAG_DAYS = 7;

/**
 * The listed bonds to read, at most `limit`: first those without terms (corporate first, municipal last), then
 * floating ones whose current interest period started at least a week ago and were read before that, then codes the
 * site didn't have, or pages whose dates didn't add up, a month ago.
 */
export function termsWork(bonds: CatalystBondItem[], terms: Map<string, CatalystTermsItem>, today: IsoDate, limit: number): CatalystBondItem[] {
  const wanted = bonds.filter((b) => b.status === "listed" && (READ_SEGMENTS.has(b.segment) || (b.segment === "treasury" && /^(WZ|NZ)\d/.test(b.code))));
  const order = (b: CatalystBondItem) => SEGMENT_ORDER.indexOf(b.segment);
  const missing = wanted.filter((b) => !terms.has(b.isin)).sort((a, b) => order(a) - order(b) || a.code.localeCompare(b.code));
  const refresh = wanted.filter((b) => {
    const t = terms.get(b.isin);
    if (!t || t.notFound || t.periodsProblem || t.coupon.kind !== "FLOATING" || !t.currentPeriodStart) return false;
    const due = addDays(t.currentPeriodStart, NEW_PERIOD_LAG_DAYS);
    return due <= today && t.fetchedAt.slice(0, 10) < due;
  });
  const retry = wanted.filter((b) => {
    const t = terms.get(b.isin);
    return !!(t?.notFound || t?.periodsProblem) && addDays(t.fetchedAt.slice(0, 10), NOT_FOUND_RETRY_DAYS) <= today;
  });
  return [...missing, ...refresh, ...retry].slice(0, limit);
}

/** The interest period running on `day` among `starts` (ascending): its first day, if any. */
export function currentPeriodStart(periods: { start: IsoDate; end: IsoDate }[], day: IsoDate): IsoDate | undefined {
  return periods.find((p) => p.start <= day && day < p.end)?.start;
}
