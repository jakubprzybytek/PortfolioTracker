// GUS BDL API: monthly CPI, previous month = 100 (variable id to confirm; see Docs/README.md open items).

const BDL = "https://bdl.stat.gov.pl/api/v1";
/** BDL variable: "Wskaźniki cen towarów i usług konsumpcyjnych, miesiąc poprzedni = 100" (ogółem). */
export const GUS_CPI_MOM_VARIABLE = process.env["GUS_CPI_VARIABLE_ID"] ?? "217230";

/** Fetches CPI m/m for the given "YYYY-MM" months as fractions (100.3 → 0.003). Months GUS doesn't have yet are omitted. */
export async function fetchGusCpiMonthOnMonth(months: string[], apiKey: string): Promise<{ month: string; wr: number }[]> {
  const years = [...new Set(months.map((m) => m.slice(0, 4)))];
  const out: { month: string; wr: number }[] = [];
  for (const year of years) {
    const url = `${BDL}/data/by-variable/${GUS_CPI_MOM_VARIABLE}?unit-level=0&year=${year}&format=json&page-size=100`;
    const res = await fetch(url, { headers: { "X-ClientId": apiKey, Accept: "application/json" } });
    if (!res.ok) throw new Error(`GUS BDL: HTTP ${res.status} for ${url}`);
    const json = (await res.json()) as { results?: { values?: { year: string; attrId: number; val: number }[] }[] };
    const values = json.results?.[0]?.values ?? [];
    // BDL monthly values carry the period in `attrId`? No: monthly data uses "id" per period; keep it defensive.
    for (const v of values as unknown as { year: string; val: number; period?: string | number }[]) {
      const period = Number(String(v.period ?? "").replace(/\D/g, ""));
      if (!period || period < 1 || period > 12) continue;
      const month = `${v.year}-${String(period).padStart(2, "0")}`;
      if (months.includes(month)) out.push({ month, wr: Math.round((v.val - 100) * 1000) / 100000 });
    }
  }
  return out.sort((a, b) => a.month.localeCompare(b.month));
}
