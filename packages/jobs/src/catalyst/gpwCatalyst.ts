// gpwcatalyst.pl: the daily statistics file of a session (Docs/catalyst.md, "Checked 2026-11-06"). Allowed by its
// robots.txt; one request per 2 s, the app's user agent (fetchSource).

import type { IsoDate } from "@portfolio/core";
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
