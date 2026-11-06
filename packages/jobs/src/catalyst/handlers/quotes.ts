// The Catalyst quotes (Docs/catalyst.md, "Jobs"): the six quotes pages at the end of the session, archived, and the
// best bid and ask of every known bond that has one, stored for that session (core/catalyst/quotes.ts). The morning
// run fills a session the evening missed and leaves a stored one alone. A missed session can't be fetched later (the
// pages show only the last one), so a failure alerts (runJob).

import { CATALYST_QUOTES_PAGES, parseCatalystQuotes, type CatalystQuote } from "@portfolio/core";
import { planQuotes, QUOTES_SOURCE, quotesSession } from "@portfolio/core/catalyst/index";
import { archiveRaw, runJob } from "../../lib/context.ts";
import { catalystRepo } from "../context.ts";
import { fetchQuotesPage } from "../gpwCatalyst.ts";

export async function handler(event: { morning?: boolean } = {}) {
  return runJob("catalyst-quotes", async () => {
    const date = quotesSession(new Date());
    if (event.morning && (await catalystRepo.getQuoteDay(date))) return { itemsWritten: 0, idle: true, note: `${date}: stored in the evening` };

    const fetchedAt = new Date().toISOString();
    const quotes: CatalystQuote[] = [];
    for (const page of CATALYST_QUOTES_PAGES) {
      const html = await fetchQuotesPage(page);
      await archiveRaw(QUOTES_SOURCE, date, `${page}.html`, new TextEncoder().encode(html));
      quotes.push(...parseCatalystQuotes(html));
    }
    if (quotes.length === 0) throw new Error("No quotes on any page (the layout changed?)");

    const isinByCode = new Map((await catalystRepo.listBonds()).filter((b) => b.status !== "ended").map((b) => [b.code, b.isin]));
    const plan = planQuotes(quotes, isinByCode, date, fetchedAt);
    const written = await catalystRepo.putQuotes(plan.quotes);
    await catalystRepo.putQuoteDay({ date, quotes: written, fetchedAt });
    const unknown = plan.unknown.length ? `; not in the table yet: ${plan.unknown.slice(0, 10).join(", ")}${plan.unknown.length > 10 ? ` and ${plan.unknown.length - 10} more` : ""}` : "";
    return { itemsWritten: written, note: `${date}: ${quotes.length} rows, ${written} with a bid or an ask${unknown}` };
  });
}
