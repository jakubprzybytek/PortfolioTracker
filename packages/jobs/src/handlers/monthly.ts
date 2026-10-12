// Monthly job: extend the IZ reference index with the latest GUS CPI m/m, cross-check the current month's
// index ratio against the Ministry of Finance page, and refresh the retail-bond rates from the Ministry file.

import { buildReferenceIndex, indexRatioAt, shiftMonth, toReferenceIndex, today } from "@portfolio/core";
import { Resource } from "sst";
import { archiveRaw, invokeAsync, repo, runJob } from "../lib/context.ts";
import { fetchRetailFile } from "../lib/mfRetail.ts";
import { importRetailRates } from "./import.ts";
import { decodeCpiCsv, fetchGusCpiFile, parseCpiCsv } from "../lib/gus.ts";
import { fetchMfIndexRatios } from "../lib/mfPage.ts";

export async function handler() {
  return runJob("monthly", async () => {
    const stored = await repo.listReferenceIndex();
    const months = stored.map((m) => ({ month: m.month, wr: m.wr })).sort((a, b) => a.month.localeCompare(b.month));
    const last = months.at(-1)?.month;
    if (!last) return { itemsWritten: 0, note: "reference index empty; import the MF calculator first" };

    const notes: string[] = [];
    let itemsWritten = 0;

    // 1. Append missing months from the GUS CPI file (CPI for month M is published around the 15th of M+1).
    // Append only: stored months are never overwritten. January matters here: the MF index keeps GUS's first
    // (preliminary) January figure, while the GUS file later shows the revised one.
    const wanted: string[] = [];
    for (let m = shiftMonth(last, 1); m < today().slice(0, 7); m = shiftMonth(m, 1)) wanted.push(m);
    if (wanted.length > 0) {
      try {
        const { url, content } = await fetchGusCpiFile();
        await archiveRaw("gus-cpi", today(), "cpi-monthly.csv", content);
        // Only consecutive months after the last stored one: the index is a chain.
        const published = new Map(parseCpiCsv(decodeCpiCsv(content)).map((r) => [r.month, r.wr]));
        const fetched: { month: string; wr: number }[] = [];
        for (const month of wanted) {
          const wr = published.get(month);
          if (wr === undefined) break;
          fetched.push({ month, wr });
        }
        if (fetched.length > 0) {
          const rebuilt = buildReferenceIndex([...months, ...fetched]);
          const newOnes = rebuilt.filter((m) => fetched.some((f) => f.month === m.month));
          itemsWritten += await repo.putReferenceIndex(newOnes, url);
          notes.push(`added ${newOnes.map((m) => `${m.month}=${m.w}`).join(", ")}`);
        }
        const missing = wanted.slice(fetched.length);
        if (missing.length > 0) notes.push(`GUS has no CPI yet for ${missing.join(", ")}`);
      } catch (err) {
        notes.push(`GUS CPI failed: ${(err as Error).message}`);
      }
    }

    // 2. Cross-check against the MF published ratios for IZ bonds we track.
    const index = toReferenceIndex(buildReferenceIndex([...months, ...(await repo.listReferenceIndex()).map((m) => ({ month: m.month, wr: m.wr }))]));
    const izBonds = (await repo.listInstruments()).filter((i) => i.terms?.couponType === "INDEXED" && i.terms.baseRef);
    const published = await fetchMfIndexRatios().catch((err) => {
      notes.push(`MF page unavailable: ${(err as Error).message}`);
      return new Map<string, Map<string, number>>();
    });
    if (published.size === 0) notes.push("MF page: no ratios parsed");
    for (const bond of izBonds) {
      const theirs = published.get(bond.code);
      if (!theirs) {
        notes.push(`${bond.code}: not on the MF page`);
        continue;
      }
      const mismatches = [...theirs].filter(([date, ratio]) => indexRatioAt(index, bond.terms!.baseRef!, date) !== ratio);
      notes.push(`${bond.code}: ${theirs.size} MF ratios checked, ${mismatches.length} mismatches${mismatches.length ? " " + JSON.stringify(mismatches.slice(0, 3)) : ""}`);
      if (mismatches.length > 0) console.error(`${bond.code}: index ratio mismatch vs MF`, mismatches);
    }
    // 3. Retail bonds: newly published rates (a series' new interest year) → refresh and revalue the history.
    try {
      const { url, content } = await fetchRetailFile();
      const day = today();
      await archiveRaw("mf-retail", day, "Dane_dotyczace_obligacji_detalicznych.xls", content);
      const r = await importRetailRates(content, url);
      itemsWritten += r.series + r.refreshed;
      notes.push(`retail: ${r.series} series, ${r.refreshed} instruments refreshed`);
      if (r.refreshed > 0) await invokeAsync(Resource.Valuation.name, { reason: "retail-rates" });
    } catch (err) {
      notes.push(`retail file failed: ${(err as Error).message}`);
    }

    return { itemsWritten, note: notes.join("; ") };
  });
}
