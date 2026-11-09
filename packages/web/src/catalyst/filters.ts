// The Catalyst view's filters (in the URL).
import { matchesAny, type Option } from "../Filters.tsx";
import type { BondRow, Level } from "./types.ts";
import { confidenceAtLeast, scorecardMatches, stateMatches } from "./issuer.tsx";
import { LEVELS, baseOf } from "./labels.ts";

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
export const FILTER_KEYS = ["q", "type", "cur", "base", "mat", "nom", "liq", "yield", "prem", "sc", "state", "conf", "ai", "ind", "rule", "co", "cm", "stale", "sort"] as const;

export function matches(r: BondRow, p: Record<string, string>): boolean {
  if (p["q"] && !matchesAny(p["q"], r.code, r.issuer ?? undefined, r.issuerShort, r.issuerLegal, r.isin)) return false;
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
  // The issuer: its scorecard, state, confidence, AI analysis switch, industry, rule set; one company's bonds.
  if (p["sc"] && !scorecardMatches(r.scorecard, p["sc"])) return false;
  if (p["state"] && !stateMatches(r.scorecard, r.aiAnalysis, p["state"])) return false;
  if (p["conf"] && !confidenceAtLeast(r.scorecard, p["conf"])) return false;
  if (p["ai"] && (p["ai"] === "on") !== !!r.aiAnalysis) return false;
  if (p["ind"] && r.industry !== p["ind"]) return false;
  if (p["rule"] && r.scorecard?.ruleSet !== p["rule"]) return false;
  const list = companyList(p);
  if (list.length && inList(r, list) === (p["cm"] === "out")) return false;
  if (!p["stale"] && r.flags.includes("stale")) return false;
  return true;
}

/** Distinct values as filter options, sorted. */
export const opt = (values: string[], label: (v: string) => string = (v) => v): Option[] => [...new Set(values)].sort().map((v) => ({ value: v, label: label(v) }));

/**
 * The view's companies (`co`, comma-separated; `cm=out`: all but these). A company is its id, or its group's for a
 * financing vehicle (so a vehicle the group sets up later counts too); a bond not yet linked, its listed name (`n:`).
 */
export const companyList = (p: Record<string, string | undefined>): string[] => (p["co"] ? p["co"].split(",").filter(Boolean).map(decode) : []);
const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
export const companyParam = (list: string[]): string | undefined => (list.length ? list.map(encodeURIComponent).join(",") : undefined);
/** The key a row is added under: its group, its company, or its listed name. */
export const companyKey = (r: BondRow): string | undefined => r.groupId ?? r.entityId ?? (r.issuer ? `n:${r.issuer}` : undefined);
/** The row's company name as the list shows it. */
export const companyName = (r: BondRow): string => r.groupShort ?? r.issuerShort ?? r.issuer ?? "";
/** Whether a row's company is on the list: by its group, its own company or its name (a list from before a link still matches). */
export const inList = (r: BondRow, list: string[]): boolean => [r.groupId, r.entityId, r.issuer ? `n:${r.issuer}` : undefined].some((k) => k !== undefined && list.includes(k));
/** The list with the row's company added, or taken off (under every key it may be listed by). */
export function toggleCompany(r: BondRow, list: string[]): string[] {
  if (inList(r, list)) return list.filter((k) => k !== r.groupId && k !== r.entityId && k !== `n:${r.issuer}`);
  const key = companyKey(r);
  return key ? [...list, key] : list;
}
