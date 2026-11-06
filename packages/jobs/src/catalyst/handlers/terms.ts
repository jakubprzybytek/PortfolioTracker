// The Catalyst bond terms (Docs/catalyst.md, "Jobs"): obligacje.pl's page of each bond the table has no terms for
// (core/catalyst/terms.ts, termsWork: corporate first), and floating bonds a week into a new interest period. Each
// page is archived; its issuer, issue value, security and coupon go into the bond's terms item, its interest periods
// into its coupon periods (PT's rules: missing periods and rates added, nothing stored changed). Only this job reads
// obligacje.pl (it blocks AI assistants), one page every 2 s.

import { currentPeriodStart, parseCoupon, termsWork } from "@portfolio/core/catalyst/index";
import { mergePublishedTerms, today } from "@portfolio/core";
import { archiveRaw, runJob } from "../../lib/context.ts";
import { fetchBondPage, parseBondPage } from "../../lib/obligacjePl.ts";
import { catalystRepo } from "../context.ts";

/** Pages a run (2 s apart: about 5 minutes). */
const PER_RUN = 150;
const SOURCE = "obligacje.pl";

export async function handler() {
  return runJob("catalyst-terms", async () => {
    const day = today();
    const [bonds, terms] = await Promise.all([catalystRepo.listBonds(), catalystRepo.listTerms()]);
    const work = termsWork(bonds, new Map(terms.map((t) => [t.isin, t])), day, PER_RUN);
    if (work.length === 0) return { itemsWritten: 0, idle: true, note: "nothing to read" };

    let written = 0;
    let read = 0;
    const notFound: string[] = [];
    const failed: string[] = [];
    const noPeriods: string[] = [];
    for (const bond of work) {
      try {
        const fetchedAt = new Date().toISOString();
        const html = await fetchBondPage(bond.code);
        if (!html) {
          await catalystRepo.putTerms({ isin: bond.isin, code: bond.code, notFound: true, coupon: { kind: "OTHER" }, source: SOURCE, fetchedAt });
          notFound.push(bond.code);
          continue;
        }
        await archiveRaw("catalyst-terms", day, `${bond.code}.html`, new TextEncoder().encode(html));
        const page = parseBondPage(html, { lenient: true });
        // The site's page for the code is another bond's (GRU1138, 2026-11-06): recorded as not found, read again in a month.
        if (page.isin !== bond.isin) {
          await catalystRepo.putTerms({ isin: bond.isin, code: bond.code, notFound: true, periodsProblem: `obligacje.pl's page is ${page.isin}`, coupon: { kind: "OTHER" }, source: SOURCE, fetchedAt });
          notFound.push(`${bond.code} (the page is ${page.isin})`);
          continue;
        }
        const coupon = parseCoupon(page.couponType);
        const running = currentPeriodStart(page.periods, day);
        await catalystRepo.putTerms({
          isin: bond.isin,
          code: bond.code,
          ...(page.issuer ? { issuer: page.issuer } : {}),
          ...(page.series ? { series: page.series } : {}),
          ...(page.issueValue ? { issueValue: { ...page.issueValue, nominal: page.nominal } } : {}),
          ...(page.secured !== undefined ? { secured: page.secured } : {}),
          couponText: page.couponType,
          coupon,
          currentRate: page.currentRate,
          ...(running ? { currentPeriodStart: running } : {}),
          periods: page.periods.length,
          ...(page.periodsProblem ? { periodsProblem: page.periodsProblem } : {}),
          source: SOURCE,
          fetchedAt,
        });
        const stored = await catalystRepo.listCoupons(bond.isin);
        const { put } = mergePublishedTerms(bond.isin, stored, { periods: page.periods, currentRate: page.currentRate, fixedRate: page.fixedRate }, day, fetchedAt);
        written += 1 + (put.length ? await catalystRepo.putCoupons(put) : 0);
        read++;
        if (page.periodsProblem) noPeriods.push(`${bond.code} (${page.periodsProblem})`);
      } catch (err) {
        failed.push(`${bond.code} (${String((err as Error).message ?? err).slice(0, 120)})`);
      }
    }
    if (read === 0 && failed.length > 0) throw new Error(`no page read: ${failed.slice(0, 5).join("; ")}`);
    const left = termsWork(bonds, new Map((await catalystRepo.listTerms()).map((t) => [t.isin, t])), day, Number.MAX_SAFE_INTEGER).length;
    return {
      itemsWritten: written,
      note: `${read} bonds read${noPeriods.length ? `, ${noPeriods.length} without periods (the page's dates don't add up: ${noPeriods.slice(0, 3).join("; ")})` : ""}${notFound.length ? `, ${notFound.length} not on obligacje.pl (${notFound.slice(0, 5).join(", ")})` : ""}${failed.length ? `, ${failed.length} failed: ${failed.slice(0, 3).join("; ")}` : ""}; ${left} left`,
    };
  });
}
