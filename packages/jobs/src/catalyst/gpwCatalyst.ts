// gpwcatalyst.pl: the daily statistics file of a session and the quotes pages (Docs/catalyst.md, "Checked
// 2026-11-06"). Allowed by its robots.txt; one request per 2 s, the app's user agent (fetchSource).

import type { CatalystQuotesPage, IsoDate } from "@portfolio/core";
import { FILE_TIMEOUT_MS, fetchSource, POLITE_INTERVAL_MS } from "../lib/http.ts";

const BASE = "https://gpwcatalyst.pl/pub/CATALYST/statystyki/statystyki_dzienne/";
/** The first session published as .xlsx (GPW's move to WATS); earlier ones are .xls. */
const XLSX_FROM = "2026-10-05";

/** A session's file, or undefined when there's none (not published yet, or no session that day). */
export async function fetchDailyFile(date: IsoDate): Promise<{ content: Uint8Array; fileName: string } | undefined> {
  const stamp = date.replaceAll("-", "");
  // The format of the day first; the other in case GPW changes it again.
  for (const ext of date >= XLSX_FROM ? ["xlsx", "xls"] : ["xls", "xlsx"]) {
    const fileName = `catalyst_${stamp}.${ext}`;
    const res = await fetchSource(BASE + fileName, { minIntervalMs: POLITE_INTERVAL_MS, timeoutMs: FILE_TIMEOUT_MS, redirect: "manual" });
    if (res.status === 200) return { content: new Uint8Array(await res.arrayBuffer()), fileName };
    await res.body?.cancel();
    if (res.status !== 302 && res.status !== 404) throw new Error(`gpwcatalyst.pl ${fileName}: HTTP ${res.status}`);
  }
  return undefined;
}

/** A quotes page (e.g. "obligacje-korporacyjne"): the session under way, or the last one. */
export async function fetchQuotesPage(page: CatalystQuotesPage): Promise<string> {
  const res = await fetchSource(`https://gpwcatalyst.pl/notowania-obligacji-${page}`, { minIntervalMs: POLITE_INTERVAL_MS, timeoutMs: FILE_TIMEOUT_MS });
  if (!res.ok) throw new Error(`gpwcatalyst.pl ${page}: HTTP ${res.status}`);
  return res.text();
}

/** GPW's suspensions and exclusions: the measures in force (`current`) or everything since 2018 (`archive`, ~2 MB). */
export async function fetchGpwExits(page: "current" | "archive"): Promise<string> {
  const url = `https://www.gpw.pl/zawieszenia-i-wykluczenia${page === "archive" ? "-archiwum" : ""}`;
  const res = await fetchSource(url, { minIntervalMs: POLITE_INTERVAL_MS, timeoutMs: FILE_TIMEOUT_MS });
  if (!res.ok) throw new Error(`gpw.pl exits (${page}): HTTP ${res.status}`);
  return res.text();
}

/** Catalyst's special markings of instruments (the issuers marked now). */
export async function fetchCatalystMarkings(): Promise<string> {
  const res = await fetchSource("https://gpwcatalyst.pl/szczegolne-oznaczenia-instrumentow-finansowych", { minIntervalMs: POLITE_INTERVAL_MS });
  if (!res.ok) throw new Error(`gpwcatalyst.pl markings: HTTP ${res.status}`);
  return res.text();
}
