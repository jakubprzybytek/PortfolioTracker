import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseHistory, parseSnapshot } from "../../src/lib/onvista.ts";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"));

describe("onvista", () => {
  it("reads a snapshot: the instrument's id and the quote per exchange, dated in Frankfurt", () => {
    const snap = parseSnapshot(fixture("onvista-snapshot-DE0001102523.json"));
    expect(snap).toMatchObject({ idInstrument: "175499953", isin: "DE0001102523" });
    expect(snap.quotes.map((q) => q.exchange)).toEqual(["FRA", "STU", "@DE"]); // @DE: Baader Trading, no volume
    expect(snap.quotes.find((q) => q.exchange === "STU")).toEqual({
      exchange: "STU",
      idNotation: 293356300,
      currency: "EUR",
      date: "2026-10-14",
      open: 96.843,
      high: 96.879,
      low: 96.843,
      close: 96.879,
      volume: 3100000,
    });
  });

  it("reads the daily history, oldest first, skipping days without a close", () => {
    const bars = parseHistory(fixture("onvista-history-DE0001102523.json"));
    expect(bars.map((b) => b.date)).toEqual(["2026-10-07", "2026-10-09", "2026-10-12", "2026-10-13"]);
    expect(bars.at(-1)).toEqual({ date: "2026-10-13", open: 96.831, high: 96.931, low: 96.831, close: 96.834, volume: 1848000 });
  });

  it("an empty history has no bars", () => {
    expect(parseHistory({})).toEqual([]);
  });
});
