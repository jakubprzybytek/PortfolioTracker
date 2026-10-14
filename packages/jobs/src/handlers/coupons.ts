// Daily job for corporate bonds' coupon periods (obligacje.pl): new periods, and the current period's rate where none
// is stored yet. Revalues from the first period whose rate is new. By hand: { all: true } also covers bonds no longer
// held (their past values), { isins: [...] } only those.

import { today } from "@portfolio/core";
import { queueValuation, repo, runJob } from "../lib/context.ts";
import { couponInstruments, syncCouponTerms } from "../lib/couponJobs.ts";

const PAUSE_MS = 1500;

export async function handler(event: { all?: boolean; isins?: string[] } = {}) {
  return runJob("coupons", async () => {
    let bonds = couponInstruments(await repo.listInstruments(), event.all || !!event.isins);
    if (event.isins) bonds = bonds.filter((b) => event.isins!.includes(b.isin));
    if (bonds.length === 0) return { itemsWritten: 0, note: "no corporate bonds" };
    const day = today();
    let itemsWritten = 0;
    let from: string | undefined;
    const failed: string[] = [];
    for (const [n, inst] of bonds.entries()) {
      if (n > 0) await new Promise((r) => setTimeout(r, PAUSE_MS));
      try {
        const r = await syncCouponTerms(inst, day);
        itemsWritten += r.written;
        if (r.ratesFrom && (!from || r.ratesFrom < from)) from = r.ratesFrom;
      } catch (err) {
        failed.push(`${inst.code}: ${(err as Error).message}`);
      }
    }
    if (from) await queueValuation({ reason: "coupon rates", from });
    if (failed.length) throw new Error(`${failed.length}/${bonds.length} bonds failed: ${failed.join("; ")}`);
    return { itemsWritten, note: `${bonds.length} bonds${from ? `; new rates from ${from}` : ""}` };
  });
}
