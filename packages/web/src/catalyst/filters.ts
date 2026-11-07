// The Catalyst view's filters (in the URL).
import { matchesAny, type Option } from "../Filters.tsx";
import type { BondRow, Level } from "./types.ts";
import { LEVELS, baseOf, } from "./labels.ts";

export const MATURITIES: Option[] = [
  { value: "0-1", label: "Up to 1 y" },
  { value: "1-3", label: "1–3 y" },
  { value: "3-5", label: "3–5 y" },
  { value: "5-", label: "Over 5 y" },
];
export const NOMINALS: Option[] = [
  { value: "100", label: "≤ 100" },
  { value: "1000", label: "≤ 1 000" },
  { value: "10000", label: "≤ 10 000" },
];
export const LIQUIDITY: Option[] = [
  { value: "low", label: "Low or better" },
  { value: "medium", label: "Medium or better" },
  { value: "high", label: "High" },
];
export const MIN_YIELD: Option[] = ["3", "4", "5", "6", "7", "8"].map((v) => ({ value: v, label: `≥ ${v}% net` }));
export const MIN_PREMIUM: Option[] = ["0", "1", "2", "3", "5"].map((v) => ({ value: v, label: `≥ ${v} pp` }));
/** The URL parameters that are filters (a saved view keeps these and the sort). */
export const FILTER_KEYS = ["q", "type", "cur", "base", "mat", "nom", "liq", "yield", "prem", "stale", "sort"] as const;

export function matches(r: BondRow, p: Record<string, string>): boolean {
  if (p["q"] && !matchesAny(p["q"], r.code, r.issuer ?? undefined, r.isin)) return false;
  if (p["type"] && r.segment !== p["type"]) return false;
  if (p["cur"] && r.currency !== p["cur"]) return false;
  if (p["base"] && baseOf(r) !== p["base"]) return false;
  if (p["mat"]) {
    const [lo, hi] = p["mat"].split("-").map((x) => (x === "" ? undefined : Number(x)));
    if (r.years === null || (lo !== undefined && r.years < lo) || (hi !== undefined && r.years > hi)) return false;
  }
  if (p["nom"] && (r.nominal === null || r.nominal > Number(p["nom"]))) return false;
  if (p["liq"] && LEVELS.indexOf(r.liquidity.level) < LEVELS.indexOf(p["liq"] as Level)) return false;
  if (p["yield"] && (r.yieldNet === null || r.yieldNet * 100 < Number(p["yield"]))) return false;
  if (p["prem"] && (r.premium === null || r.premium * 100 < Number(p["prem"]))) return false;
  if (!p["stale"] && r.flags.includes("stale")) return false;
  return true;
}

/** Distinct values as filter options, sorted. */
export const opt = (values: string[], label: (v: string) => string = (v) => v): Option[] => [...new Set(values)].sort().map((v) => ({ value: v, label: label(v) }));
