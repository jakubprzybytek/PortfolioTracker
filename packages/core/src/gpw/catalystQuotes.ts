// The Catalyst quotes pages (gpwcatalyst.pl/notowania-obligacji-<segment>): the current (or last) session of every
// bond of a segment, with the best bid and ask. One table per trading currency; one row per bond and market. The
// page has no session date: the last-trade cell shows a time for trades in that session and a date for older ones,
// so the caller decides which session the page shows (Docs/catalyst.md, "Checked 2026-11-06").

import type { IsoDate } from "../dates.ts";

/** The six quotes pages, by their path segment. */
export const CATALYST_QUOTES_PAGES = [
  "obligacje-korporacyjne",
  "obligacje-skarbowe",
  "obligacje-komunalne",
  "obligacje-spoldzielcze",
  "bankowe-papiery-wartosciowe",
  "listy-zastawne",
] as const;
export type CatalystQuotesPage = (typeof CATALYST_QUOTES_PAGES)[number];

export interface CatalystOrder {
  price: number;
  volume: number;
  orders: number;
}

/** One bond on one market. Prices clean, in % of nominal; turnover in the table's currency. */
export interface CatalystQuote {
  /** The issuer as the page names it (its card is `emitenci-obligacji-karta?nazwa=<issuer>`). */
  issuer: string;
  code: string;
  /** Listed in the Warsaw Sustainable Segment (" /S" after the code). */
  sustainable: boolean;
  /** "GPW ASO", "GPW RR", "BS RR" … */
  market: string;
  currency: string;
  reference: number | null;
  open: number | null;
  low: number | null;
  high: number | null;
  /** The last trade: a time when it was in the page's session, a date when earlier; null without any. */
  lastTrade: { time: string } | { date: IsoDate } | null;
  lastTradeVolume: number | null;
  last: number | null;
  changePct: number | null;
  bid: CatalystOrder | null;
  ask: CatalystOrder | null;
  trades: number;
  volume: number;
  turnover: number;
}

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** A number as printed ("103,0100", "0.40", "1 234"); null for "-" or empty. */
function num(s: string | undefined): number | null {
  const t = (s ?? "").replace(/\s/g, "").replace(",", ".");
  if (t === "" || /^-+$/.test(t)) return null;
  const n = Number(t);
  if (Number.isNaN(n)) throw new Error(`Not a number: "${s}"`);
  return n;
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

function order(price: number | null, volume: number | null, orders: number | null): CatalystOrder | null {
  return price === null ? null : { price, volume: volume ?? 0, orders: orders ?? 0 };
}

/** Parses one quotes page. Throws when a bond row doesn't have the expected cells (the layout changed). */
export function parseCatalystQuotes(html: string): CatalystQuote[] {
  const out: CatalystQuote[] = [];
  // Each quotes table follows a heading ending in its currency: "Obligacje przedsiębiorstw (PLN)".
  const tables = [...html.matchAll(/<table class="table footable"[^>]*>([\s\S]*?)<\/table>/g)];
  for (const t of tables) {
    const before = decode(html.slice(Math.max(0, t.index! - 2000), t.index!));
    const currency = [...before.matchAll(/\(([A-Z]{3})\)/g)].at(-1)?.[1];
    if (!currency) throw new Error("Quotes table without a currency in its heading");
    let issuer = "";
    for (const row of t[1]!.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
      const cells = [...row[1]!.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)].map((c) => ({ cls: /class="([^"]*)"/.exec(c[1]!)?.[1] ?? "", html: c[2]! }));
      const by = (n: number) => cells.filter((c) => c.cls.split(/\s+/).includes(`col${n}`)).map((c) => decode(c.html));
      const issuerCell = cells.find((c) => c.cls.split(/\s+/).includes("col0"));
      // The issuer's cell spans all its bonds' rows: it is in the first of them only.
      if (issuerCell) issuer = decode(issuerCell.html);
      const name = by(1)[0];
      if (!name) continue; // header rows
      const bid = by(12);
      const ask = by(13);
      const turnover = by(15);
      if (bid.length !== 3 || ask.length !== 3 || turnover.length !== 2 || by(4).length !== 1)
        throw new Error(`Quotes row ${name}: unexpected cells (bid ${bid.length}, ask ${ask.length}, turnover ${turnover.length})`);
      const last = by(8)[0] ?? "";
      const code = name.replace(/\s*\/S$/, "");
      out.push({
        issuer,
        code,
        sustainable: code !== name,
        market: by(2)[0] ?? "",
        currency,
        reference: num(by(4)[0]),
        open: num(by(5)[0]),
        low: num(by(6)[0]),
        high: num(by(7)[0]),
        lastTrade: /^\d{2}:\d{2}(:\d{2})?$/.test(last) ? { time: last } : /^\d{4}-\d{2}-\d{2}$/.test(last) ? { date: last } : null,
        lastTradeVolume: num(by(9)[0]),
        last: num(by(10)[0]),
        changePct: num(by(11)[0]),
        bid: order(num(bid[2]), num(bid[1]), num(bid[0])),
        ask: order(num(ask[0]), num(ask[1]), num(ask[2])),
        trades: num(by(14)[0]) ?? 0,
        volume: num(turnover[0]) ?? 0,
        turnover: round((num(turnover[1]) ?? 0) * 1000, 2),
      });
    }
  }
  return out;
}
