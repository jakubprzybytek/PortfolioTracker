// Labels, formats and sort values of the Catalyst view.
import { fmtMoney, fmtNum, fmtPct } from "../format.ts";
import type { SortValue } from "../sort.ts";
import type { BondRow, Level, Liquidity } from "./types.ts";

export const SEGMENTS: Record<string, string> = {
  corporate: "Corporate",
  municipal: "Municipal",
  treasury: "Treasury",
  "mortgage-covered": "Covered (mortgage)",
  "public-covered": "Covered (public)",
  cooperative: "Co-operative",
  bank: "Bank",
  convertible: "Convertible",
  other: "Other",
};
export const LEVELS: Level[] = ["none", "low", "medium", "high"];
export const LEVEL_LABEL: Record<Level, string> = { high: "high", medium: "medium", low: "low", none: "none" };
export const FLAG_LABEL: Record<string, string> = {
  stale: "stale",
  "new-listing": "new",
  "no-terms": "no terms yet",
  "no-periods": "no periods",
  "periods-extended": "periods extended",
  amortising: "amortising",
  "matures-soon": "matures soon",
  indexed: "indexed",
  suspended: "suspended",
  marked: "marked",
};
export const FLAG_TITLE: Record<string, string> = {
  stale: "No trade in the last 30 sessions: the price is the exchange's reference price; no premium",
  "new-listing": "Listed under 10 sessions ago: its liquidity rests on a few days",
  "no-terms": "obligacje.pl not read yet (new bonds: within a week) or no page for it: no yield",
  "no-periods": "obligacje.pl's interest periods don't add up: no yield",
  "periods-extended": "obligacje.pl lists the periods only up to the current one: the rest repeat its length to maturity (projected)",
  amortising: "Part of the nominal has been repaid (instalments)",
  "matures-soon": "Under 90 days to maturity: an annualised yield says nothing",
  indexed: "Inflation-indexed (IZ): not computed here",
  suspended: "Trading suspended by GPW (the reason in the panel's Track record)",
  marked: "GPW marks the issuer's instruments (bankruptcy, restructuring, liquidation …): see the panel's Track record",
};

export const pct = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? "–" : `${fmtNum(v * 100, d)}%`);
export const pp = (v: number | null | undefined) => (v === null || v === undefined ? "–" : fmtPct(v * 100));
export const couponLabel = (r: BondRow) => {
  const c = r.coupon;
  if (!c) return r.segment === "treasury" && /^(DS|PS|WS)\d/.test(r.code) ? "fixed" : r.segment === "treasury" && /^OK\d/.test(r.code) ? "zero" : "–";
  if (c.kind === "FIXED") return c.rate !== undefined ? `${fmtNum(c.rate * 100)}%` : "fixed";
  if (c.kind === "FLOATING") return `${(c.base ?? "").replace("WIBOR ", "W")}+${fmtNum((c.margin ?? 0) * 100)}`;
  if (c.kind === "ZERO") return "zero";
  return "–";
};
export const baseOf = (r: BondRow) => (r.coupon?.kind === "FLOATING" ? (r.coupon.base ?? "other") : r.coupon?.kind === "FIXED" || /^(DS|PS|WS)\d/.test(r.code) ? "fixed" : r.coupon?.kind === "ZERO" || /^OK\d/.test(r.code) ? "zero" : "");

export const SORT_KEYS = ["bond", "issuer", "type", "coupon", "maturity", "price", "yield", "vsalt", "premium", "liquidity"] as const;
export function sortValue(r: BondRow, key: string): SortValue {
  switch (key) {
    case "bond":
      return r.code;
    case "issuer":
      return r.issuerShort ?? r.issuer ?? null;
    case "type":
      return SEGMENTS[r.segment] ?? r.segment;
    case "coupon":
      return r.coupon?.kind === "FLOATING" ? (r.coupon.margin ?? null) : (r.coupon?.rate ?? null);
    case "maturity":
      return r.years;
    case "price":
      return r.price;
    case "yield":
      return r.yieldNet;
    case "vsalt":
      return r.vsAlternative;
    case "premium":
      return r.premium;
    case "liquidity":
      return LEVELS.indexOf(r.liquidity.level) * 1e9 + (r.liquidity.medianTurnover30 ?? 0);
  }
  return null;
}

export function liquidityTitle(l: Liquidity, currency: string): string {
  const parts = [
    `traded on ${Math.round(l.traded30 * 100)}% of the last 30 sessions (${Math.round(l.traded90 * 100)}% of 90)`,
    l.medianTurnover30 !== null ? `median turnover ${fmtMoney(Math.round(l.medianTurnover30), currency).replace(",00", "")}` : "",
    l.medianSpread30 !== null ? `bid–ask spread ${fmtNum(l.medianSpread30)} pp` : "",
    // Sessions to buy or sell bonds worth 10 000 when taking at most a fifth of an average session's turnover.
    l.daysToSell10k !== null ? `trading 10 000 ${currency === "PLN" ? "zł" : currency} ≈ ${l.daysToSell10k} sessions` : "",
  ];
  return `${LEVEL_LABEL[l.level]}: ${parts.filter(Boolean).join(" • ")}`;
}
