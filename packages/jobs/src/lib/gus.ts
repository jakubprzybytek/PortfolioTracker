// GUS monthly CPI, from the CSV "Miesięczne wskaźniki cen towarów i usług konsumpcyjnych od 1982 roku"
// (the same file the reference spreadsheet uses). No API key. The file name changes with updates, so the
// link is found on the page. Windows-1250, ";"-separated, columns:
// Nazwa zmiennej;Jednostka terytorialna;Sposób prezentacji;Rok;Miesiąc;Wartość;Flaga
// Each month has five rows (bases); we use "Poprzedni miesiąc = 100" (IZ indexation), "Grudzień poprzedniego
// roku = 100" (returns by year against inflation, Indicators) and "Analogiczny miesiąc poprzedniego roku = 100"
// (12-month inflation, Indicators). Months not published yet have an empty value.

import { FILE_TIMEOUT_MS, fetchWithTimeout } from "./http.ts";

const PAGE =
  "https://stat.gov.pl/obszary-tematyczne/ceny-handel/wskazniki-cen/wskazniki-cen-towarow-i-uslug-konsumpcyjnych-pot-inflacja-/miesieczne-wskazniki-cen-towarow-i-uslug-konsumpcyjnych-od-1982-roku/";
const HEADERS = { "User-Agent": "portfolio-tracker (personal use)" };
const MONTH_ON_MONTH = "poprzedni miesiąc = 100";
const SINCE_DECEMBER = "grudzień poprzedniego roku = 100";
const YEAR_ON_YEAR = "analogiczny miesiąc poprzedniego roku = 100";

/** The CSV's path on stat.gov.pl, e.g. "/download/gfx/…/miesiecznewskaznikicen…_8.csv", or undefined. */
export function findCpiCsvLink(html: string): string | undefined {
  const links = [...html.matchAll(/<a\b[^>]*\bhref="([^"]+\.csv)"[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => ({ href: m[1]!, text: m[0] }));
  return (links.find((l) => /wskaźniki cen towarów i usług konsumpcyjnych/i.test(l.text)) ?? links[0])?.href;
}

/** CPI m/m per "YYYY-MM" as a fraction (100.3 → 0.003), oldest first; months without a value are left out. */
export function parseCpiCsv(text: string): { month: string; wr: number }[] {
  // One decimal from GUS: (v − 100) / 100, rounded to drop float noise.
  return rowsOf(text, MONTH_ON_MONTH).map((r) => ({ month: r.month, wr: Math.round((r.value - 100) * 10) / 1000 }));
}

/** CPI with December of the previous year = 100 per "YYYY-MM" (e.g. 102.4), oldest first; December's is the year's inflation. */
export function parseCpiYtdCsv(text: string): { month: string; value: number }[] {
  return rowsOf(text, SINCE_DECEMBER);
}

/** CPI with the same month of the previous year = 100 per "YYYY-MM" (e.g. 104.1: 12-month inflation 4.1 %), oldest first. */
export function parseCpiYoyCsv(text: string): { month: string; value: number }[] {
  return rowsOf(text, YEAR_ON_YEAR);
}

function rowsOf(text: string, wanted: string): { month: string; value: number }[] {
  const out: { month: string; value: number }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const [, , basis, year, month, value] = line.split(";");
    if (basis?.trim().toLowerCase() !== wanted || !value?.trim()) continue;
    const v = Number(value.replace(",", "."));
    if (!/^\d{4}$/.test(year!) || !(Number(month) >= 1 && Number(month) <= 12) || !Number.isFinite(v)) continue;
    out.push({ month: `${year}-${month!.padStart(2, "0")}`, value: v });
  }
  return out.sort((a, b) => a.month.localeCompare(b.month));
}

export function decodeCpiCsv(content: Uint8Array): string {
  return new TextDecoder("windows-1250").decode(content);
}

export async function fetchGusCpiFile(): Promise<{ url: string; content: Uint8Array }> {
  const page = await fetchWithTimeout(PAGE, { headers: HEADERS });
  if (!page.ok) throw new Error(`GUS CPI page: HTTP ${page.status}`);
  const link = findCpiCsvLink(await page.text());
  if (!link) throw new Error("GUS CPI page: no link to the CSV (page layout changed?)");
  const url = new URL(link, "https://stat.gov.pl").toString();
  const res = await fetchWithTimeout(url, { headers: HEADERS }, FILE_TIMEOUT_MS);
  if (!res.ok) throw new Error(`GUS CPI file: HTTP ${res.status}`);
  return { url, content: new Uint8Array(await res.arrayBuffer()) };
}
