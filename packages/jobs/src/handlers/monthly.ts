// Monthly job: extend the IZ reference index with the latest GUS CPI m/m and cross-check
// the current month's index ratio against the Ministry of Finance page.

import { buildReferenceIndex, indexRatioAt, shiftMonth, toReferenceIndex, today } from "@portfolio/core";
import { Resource } from "sst";
import { repo, runJob } from "../lib/context.ts";
import { fetchGusCpiMonthOnMonth } from "../lib/gus.ts";
import { fetchMfIndexRatios } from "../lib/mfPage.ts";

export async function handler() {
  return runJob("monthly", async () => {
    const stored = await repo.listReferenceIndex();
    const months = stored.map((m) => ({ month: m.month, wr: m.wr })).sort((a, b) => a.month.localeCompare(b.month));
    const last = months.at(-1)?.month;
    if (!last) return { itemsWritten: 0, note: "reference index empty; import the MF calculator first" };

    const notes: string[] = [];
    let itemsWritten = 0;

    // 1. Append missing months from GUS (CPI for month M is final around the 15th of M+1).
    const apiKey = Resource.GusApiKey.value;
    const wanted: string[] = [];
    for (let m = shiftMonth(last, 1); m < today().slice(0, 7); m = shiftMonth(m, 1)) wanted.push(m);
    if (wanted.length > 0 && apiKey !== "not-set") {
      const fetched = await fetchGusCpiMonthOnMonth(wanted, apiKey);
      if (fetched.length > 0) {
        const rebuilt = buildReferenceIndex([...months, ...fetched]);
        const newOnes = rebuilt.filter((m) => fetched.some((f) => f.month === m.month));
        itemsWritten += await repo.putReferenceIndex(newOnes, "gus-bdl");
        notes.push(`added ${newOnes.map((m) => `${m.month}=${m.w}`).join(", ")}`);
      } else notes.push(`GUS has no CPI yet for ${wanted.join(", ")}`);
    } else if (wanted.length > 0) notes.push(`GUS key not set; missing ${wanted.join(", ")}`);

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
    return { itemsWritten, note: notes.join("; ") };
  });
}
