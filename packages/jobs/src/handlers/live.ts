// Live prices on demand ("Refresh prices" in the app, POST /prices/refresh): the current quote of every instrument with
// an intraday source, stored as today's provisional price, then a revaluation of today. The evening jobs overwrite
// these with the day's close; a final price already stored for today is left alone.
//   - foreign bonds at IBKR: onvista (Börse Stuttgart), near real time
//   - ETFs: Yahoo, today's bar so far (about 15 minutes delayed)
//   - Catalyst corporate bonds and GPW treasury bonds: BiznesRadar quote page, the last trade (15 minutes delayed;
//     2 s between pages). Treasury bonds' daily source is GPW's end-of-day file; their page is under the same code.
// Each price keeps when the source set it (quoteTime), shown in the app. Not covered: retail bonds and hand-valued
// assets (no market).
// A source failing for one instrument is reported in the note; the run fails only when nothing could be fetched.

import { today, type InstrumentItem, type IsoDate, type PriceItem } from "@portfolio/core";
import { queueValuation, repo, runJob } from "../lib/context.ts";
import { fetchQuotePage, parseQuotePage, type BrBar } from "../lib/biznesradar.ts";
import { BIZNESRADAR_SOURCE_ID, catalystInstruments } from "../lib/catalystJobs.ts";
import { YAHOO_SOURCE_ID, yahooInstruments } from "../lib/etfJobs.ts";
import { GPW_SOURCE_ID, gpwInstruments } from "../lib/gpwJobs.ts";
import { fetchSnapshot } from "../lib/onvista.ts";
import { ONVISTA_SOURCE_ID, onvistaInstruments } from "../lib/onvistaJobs.ts";
import { fetchYahooDaily } from "../lib/yahoo.ts";

const PAUSE_MS = 2000;
const pause = () => new Promise((r) => setTimeout(r, PAUSE_MS));

type Bar = BrBar;

/** The BiznesRadar page of a Catalyst bond, or of a treasury bond (its GPW code). */
const biznesradarCode = (inst: InstrumentItem) => inst.sourceIds[BIZNESRADAR_SOURCE_ID] ?? inst.sourceIds[GPW_SOURCE_ID];

/** Today's quote so far, or undefined when the market hasn't traded or quoted today. */
async function quote(inst: InstrumentItem, day: IsoDate): Promise<{ bar?: Bar; source: string }> {
  if (inst.sourceIds[ONVISTA_SOURCE_ID]) {
    const snap = await fetchSnapshot(inst.isin);
    const q = snap?.quotes.find((x) => x.exchange === inst.sourceIds[ONVISTA_SOURCE_ID]);
    if (!q) throw new Error("no quote on onvista");
    return { bar: q.date === day ? q : undefined, source: ONVISTA_SOURCE_ID };
  }
  if (inst.sourceIds[YAHOO_SOURCE_ID]) {
    const data = await fetchYahooDaily(inst.sourceIds[YAHOO_SOURCE_ID]!, day, day);
    if (data.currency !== inst.currency) throw new Error(`Yahoo quotes it in ${data.currency}`);
    const b = data.closes.find((x) => x.date === day);
    return { bar: b && { ...b, ...(data.lastTime ? { time: data.lastTime } : {}) }, source: YAHOO_SOURCE_ID };
  }
  const html = await fetchQuotePage(biznesradarCode(inst)!);
  const b = html ? parseQuotePage(html) : undefined;
  return { bar: b?.date === day ? b : undefined, source: BIZNESRADAR_SOURCE_ID };
}

export async function handler(event: { date?: IsoDate } = {}) {
  return runJob("live", async () => {
    const day = event.date ?? today();
    const all = await repo.listInstruments();
    const bonds = onvistaInstruments(all);
    const etfs = yahooInstruments(all);
    const pages = [...catalystInstruments(all), ...gpwInstruments(all)];
    const tracked = [...new Set([...bonds, ...etfs, ...pages])];
    if (tracked.length === 0) return { itemsWritten: 0, idle: true, note: "no instruments with live quotes" };

    const fetchedAt = new Date().toISOString();
    const items: PriceItem[] = [];
    const failed: string[] = [];
    let notToday = 0;
    let final = 0;
    let fetched = 0;
    for (const inst of tracked) {
      if (pages.includes(inst) && fetched++ > 0) await pause();
      try {
        const { bar, source } = await quote(inst, day);
        if (!bar) {
          notToday++;
          continue;
        }
        const stored = (await repo.queryPrices(inst.isin, inst.venue, day, day))[0];
        if (stored?.status === "final") {
          final++;
          continue;
        }
        items.push({
          PK: `INST#${inst.isin}`,
          SK: `PX#${inst.venue}#${day}`,
          isin: inst.isin,
          venue: inst.venue,
          date: day,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume,
          trades: 0,
          turnover: 0,
          traded: bar.volume > 0,
          ...(bar.volume > 0 ? { lastTradeDate: day } : {}),
          ...(bar.time ? { quoteTime: bar.time } : {}),
          currency: inst.currency,
          source,
          fetchedAt,
          status: "provisional",
        });
      } catch (err) {
        failed.push(`${inst.code}: ${(err as Error).message}`);
      }
    }
    if (failed.length === tracked.length) throw new Error(`no quotes: ${failed.join("; ")}`);
    const itemsWritten = await repo.putPrices(items);
    if (itemsWritten > 0) await queueValuation({ reason: "live prices", from: day });
    const notes = [
      `${itemsWritten} of ${tracked.length} prices updated`,
      ...(notToday ? [`${notToday} not traded today yet`] : []),
      ...(final ? [`${final} already closed`] : []),
      ...failed,
    ];
    return { itemsWritten, note: notes.join("; ") };
  });
}
