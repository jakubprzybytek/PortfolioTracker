// Reads the Ministry of Finance page with daily index ratios for IZ bonds
// (https://www.gov.pl/web/finanse/wspolczynniki-indeksacji2). HTML table, current and next month only.

const URL = "https://www.gov.pl/web/finanse/wspolczynniki-indeksacji2";

/** Returns bond code → (date → ratio). Dates in ISO. */
export async function fetchMfIndexRatios(): Promise<Map<string, Map<string, number>>> {
  const res = await fetch(URL, { headers: { "User-Agent": "portfolio-tracker (personal use)" } });
  if (!res.ok) throw new Error(`MF page: HTTP ${res.status}`);
  return parseMfIndexRatios(await res.text());
}

const cellText = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const num = (s: string) => Number(s.replace(/\s/g, "").replace(",", "."));

/**
 * The table has header cells naming the bonds (e.g. "IZ0831", "IZ0836"), and rows of one or more blocks
 * date | ratio, accrued (first bond) | ratio, accrued (second bond) | … (two months side by side).
 * Each date is followed by a (ratio, accrued) pair per bond, in header order.
 */
export function parseMfIndexRatios(html: string): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) ?? [];
  for (const table of tables) {
    const rows = (table.match(/<tr[\s\S]*?<\/tr>/gi) ?? []).map((r) => (r.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) ?? []).map(cellText));
    const codes = [...new Set(rows.flatMap((r) => r.flatMap((c) => c.match(/IZ\d{4}/g) ?? [])))];
    if (codes.length === 0) continue;
    for (const r of rows) {
      r.forEach((cell, i) => {
        const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(cell);
        if (!m) return;
        const date = `${m[3]}-${m[2]}-${m[1]}`;
        codes.forEach((code, b) => {
          const ratio = num(r[i + 1 + 2 * b] ?? "");
          if (!Number.isFinite(ratio) || ratio < 0.5 || ratio > 5) return;
          if (!out.has(code)) out.set(code, new Map());
          out.get(code)!.set(date, ratio);
        });
      });
    }
  }
  return out;
}
