import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { planQuotes, quotesSession } from "../src/catalyst/quotes.ts";
import { parseCatalystQuotes } from "../src/gpw/catalystQuotes.ts";

describe("quotesSession", () => {
  it("today's session once it has opened on a trading day, else the trading day before (Warsaw time)", () => {
    expect(quotesSession(new Date("2026-11-06T16:20:00Z"))).toBe("2026-11-06"); // Friday 17:20
    expect(quotesSession(new Date("2026-11-06T07:45:00Z"))).toBe("2026-11-05"); // Friday 08:45, before the session
    expect(quotesSession(new Date("2026-11-07T07:30:00Z"))).toBe("2026-11-06"); // Saturday
    expect(quotesSession(new Date("2026-11-12T07:30:00Z"))).toBe("2026-11-10"); // Thursday early, 11 November a holiday
    expect(quotesSession(new Date("2026-06-01T23:30:00Z"))).toBe("2026-06-01"); // 01:30 Warsaw on 2 June: still before the session
  });
});

describe("planQuotes", () => {
  const page = parseCatalystQuotes(readFileSync(new URL("fixtures/catalyst/quotes-obligacje-korporacyjne.html", import.meta.url), "utf8"));
  const AT = "2026-10-26T16:20:00.000Z";

  it("stores the rows with a bid or an ask of known bonds, under the session's date and the row's market", () => {
    const codes = new Map([
      ["ADX1227", "PLADX0000001"],
      ["ACH0628", "PLARCHE00070"],
      ["ANW1126", "PLANW0000001"],
    ]);
    const { quotes, unknown } = planQuotes(page, codes, "2026-10-26", AT);
    expect(quotes.find((q) => q.isin === "PLADX0000001")).toEqual({ isin: "PLADX0000001", date: "2026-10-26", market: "GPW ASO", bid: { price: 100.82, volume: 64, orders: 1 }, ask: { price: 101.2, volume: 652, orders: 1 }, trades: 1, source: "gpwcatalyst-quotes", fetchedAt: AT });
    expect(quotes.find((q) => q.isin === "PLARCHE00070")).toMatchObject({ bid: { price: 101.5 }, ask: { price: 105.18 } });
    // ANW1126 has neither: nothing stored.
    expect(quotes.some((q) => q.isin === "PLANW0000001")).toBe(false);
    expect(unknown.length).toBeGreaterThan(0);
    expect(unknown).not.toContain("ADX1227");
  });
});
