import { describe, expect, it } from "vitest";
import { corporateAccrued, couponChecks, couponPerBond, mergePublishedTerms, quantityHeld, taxFromNote, type InterestPeriod } from "../src/bonds/couponPeriods.ts";
import type { TransactionItem } from "../src/db/items.ts";

const ISIN = "PLKRK0000713";
// KRU0827's published dates (quarterly, nominal 100); rates and positions made up.
const periods: InterestPeriod[] = [
  { isin: ISIN, start: "2026-02-12", end: "2026-05-12", recordDate: "2026-05-04", paymentDate: "2026-05-12", datesSource: "obligacje.pl", rate: 0.0742, rateSource: "coupons" },
  { isin: ISIN, start: "2026-05-12", end: "2026-08-12", recordDate: "2026-08-04", paymentDate: "2026-08-12", datesSource: "obligacje.pl", rate: 0.0713, rateSource: "manual" },
  { isin: ISIN, start: "2026-08-12", end: "2026-11-12", recordDate: "2026-11-03", paymentDate: "2026-11-12", datesSource: "obligacje.pl" },
];

let n = 0;
const tx = (t: Partial<TransactionItem>): TransactionItem =>
  ({ PK: "ACCT#a", SK: "TX#x", GSI1PK: "TX", GSI1SK: "x", id: String(++n), account: "Broker", date: "2026-01-02", type: "BUY", isin: ISIN, amount: 0, currency: "PLN", source: "t", ...t }) as TransactionItem;

describe("corporate bond accrued interest", () => {
  const held = (q: number) => () => q;

  it("grows by day within a period (ACT/365, per bond rounded to the grosz)", () => {
    // 30 days of 7.13 % on 100: 0.586 → 0.59 per bond.
    expect(corporateAccrued(periods, 100, "2026-06-11", 10, held(10))).toEqual({ total: 5.9, rate: { current: 0.0713, previous: 0.0742 } });
    expect(corporateAccrued(periods, 100, "2026-05-12", 10, held(10)).total).toBe(0);
  });

  it("counts the whole coupon from the record day, for the bonds held that day", () => {
    expect(couponPerBond(100, periods[1]!)).toBe(1.8); // 92 days: 1.797
    expect(corporateAccrued(periods, 100, "2026-08-05", 10, held(10)).total).toBe(18);
    // 4 of the 10 bought after the record day: no coupon for them.
    expect(corporateAccrued(periods, 100, "2026-08-05", 10, (d) => (d < "2026-08-05" ? 6 : 10)).total).toBe(10.8);
  });

  it("keeps an ended period's coupon until its payment day", () => {
    const late = [{ ...periods[1]!, paymentDate: "2026-08-14" }, periods[2]!];
    expect(corporateAccrued(late, 100, "2026-08-13", 10, held(10))).toMatchObject({ total: null, missingFrom: "2026-08-12" });
    const rated = [late[0]!, { ...late[1]!, rate: 0.07 }];
    expect(corporateAccrued(rated, 100, "2026-08-13", 10, held(10)).total).toBe(18 + 0.2); // + 1 day of 7 %: 0.019 → 0.02
  });

  it("gives nothing without a rate for the period, or without periods", () => {
    expect(corporateAccrued(periods, 100, "2026-09-01", 10, held(10))).toEqual({ total: null, missingFrom: "2026-08-12" });
    expect(corporateAccrued([], 100, "2026-09-01", 10, held(10))).toEqual({ total: null, missingFrom: null });
  });
});

describe("coupons received", () => {
  const txs = [
    tx({ date: "2026-01-02", quantity: 120, account: "Broker" }),
    tx({ date: "2026-03-02", quantity: 50, account: "IKZE Broker" }),
    tx({ date: "2026-08-07", quantity: 20, account: "Broker" }), // after the record day
    // 120 × 1.80 = 216.00 gross, 41.04 withheld.
    tx({ date: "2026-08-12", type: "COUPON", amount: 174.96, note: "Pobrany podatek: 41.04 PLN", account: "Broker" }),
    tx({ date: "2026-08-12", type: "COUPON", amount: 90, account: "IKZE Broker" }),
    // Paid on Monday for a Saturday payment day; tax not noted: assumed 19 %.
    tx({ date: "2026-05-12", type: "COUPON", amount: 147.67, account: "Broker" }),
    tx({ date: "2026-09-30", type: "COUPON", amount: 5, account: "Broker" }),
  ];

  it("reads the tax from the note", () => {
    expect(taxFromNote("Pobrany podatek: 41.04 PLN")).toBe(41.04);
    expect(taxFromNote(undefined)).toBeUndefined();
    expect(quantityHeld(txs, "Broker", ISIN, "2026-08-04")).toBe(120);
    // Settled T+2: bought on Thursday 2026-07-30, owned from Monday 2026-08-03.
    const buy = [tx({ date: "2026-07-30", quantity: 5 })];
    expect(quantityHeld(buy, "Broker", ISIN, "2026-07-31")).toBe(0);
    expect(quantityHeld(buy, "Broker", ISIN, "2026-08-03")).toBe(5);
    // A write-off counts on its date, like a redemption.
    const lost = [...buy, tx({ date: "2026-09-01", type: "WRITE_OFF", quantity: 5, amount: 0 })];
    expect(quantityHeld(lost, "Broker", ISIN, "2026-08-31")).toBe(5);
    expect(quantityHeld(lost, "Broker", ISIN, "2026-09-01")).toBe(0);
  });

  it("matches each coupon to its period and works out the rates it fits", () => {
    const { periods: out, unmatched } = couponChecks(periods, 100, txs, ISIN);
    expect(unmatched.map((t) => t.date)).toEqual(["2026-09-30"]);
    const aug = out.find((p) => p.start === "2026-05-12")!;
    expect(aug.checks.map((c) => [c.account, c.gross, c.quantity, c.expected, c.mismatch, c.taxAssumed])).toEqual([
      ["Broker", 216, 120, 216, false, false],
      ["IKZE Broker", 90, 50, 90, false, false],
    ]);
    // 1.80 per bond over 92 days: 7.12–7.16 %; the middle in 0.01 % steps.
    expect(aug.checks[0]!.rateRange[0]).toBeCloseTo(0.07121, 4);
    expect(aug.checks[0]!.rateRange[1]).toBeCloseTo(0.07161, 4);
    expect(aug.suggestedRate).toBe(0.0714);
    // 147.67 / 0.81 = 182.31 for 120 bonds: 1.52 per bond over 89 days → 6.23 %, not the stored 7.42 %.
    const may = out.find((p) => p.start === "2026-02-12")!;
    expect(may.checks[0]).toMatchObject({ gross: 182.31, taxAssumed: true, quantity: 120, expected: 217.2, mismatch: true });
    expect(may.suggestedRate).toBe(0.0623);
  });
});

describe("merging the terms from obligacje.pl", () => {
  const published = {
    periods: [
      { start: "2026-05-12", end: "2026-08-12", recordDate: "2026-08-04", paymentDate: "2026-08-12" },
      { start: "2026-08-12", end: "2026-11-12", recordDate: "2026-11-03", paymentDate: "2026-11-12" },
      { start: "2026-11-12", end: "2027-02-12", paymentDate: "2027-02-12" },
    ],
    currentRate: 0.0713,
  };
  const now = "2026-10-14T10:00:00Z";

  it("adds missing periods and fills the current period's missing rate", () => {
    const { put, ratesFrom } = mergePublishedTerms(ISIN, periods.slice(0, 2), published, "2026-10-14", now);
    expect(put.map((p) => [p.start, p.rate, p.rateSource, p.datesSource])).toEqual([
      ["2026-08-12", 0.0713, "obligacje.pl", "obligacje.pl"],
      ["2026-11-12", undefined, undefined, "obligacje.pl"],
    ]);
    expect(ratesFrom).toBe("2026-08-12");
  });

  it("never replaces a stored rate: a different one is kept aside", () => {
    const stored = [...periods.slice(0, 2), { ...periods[2]!, rate: 0.07, rateSource: "manual" as const }];
    const { put, ratesFrom } = mergePublishedTerms(ISIN, stored, { ...published, periods: published.periods.slice(0, 2) }, "2026-10-14", now);
    expect(put).toEqual([{ ...stored[2], otherRate: { rate: 0.0713, source: "obligacje.pl", seenAt: now } }]);
    expect(ratesFrom).toBeUndefined();
    // Seen again: nothing new to write.
    expect(mergePublishedTerms(ISIN, put, { ...published, periods: [] }, "2026-10-14", now).put).toEqual([]);
  });

  it("waits a week into a new period when the rate shown is still the previous one's", () => {
    const stored = [{ ...periods[1]!, rate: 0.0713 }, periods[2]!];
    expect(mergePublishedTerms(ISIN, stored, { ...published, periods: [] }, "2026-08-14", now).put).toEqual([]);
    expect(mergePublishedTerms(ISIN, stored, { ...published, periods: [] }, "2026-08-19", now).put).toHaveLength(1);
    expect(mergePublishedTerms(ISIN, stored, { ...published, periods: [], currentRate: 0.069 }, "2026-08-14", now).put[0]).toMatchObject({ rate: 0.069 });
  });

  it("gives a fixed rate to every period without one", () => {
    const { put } = mergePublishedTerms(ISIN, periods, { periods: [], currentRate: null, fixedRate: 0.075 }, "2026-10-14", now);
    expect(put.map((p) => [p.start, p.rate, p.otherRate?.rate])).toEqual([
      ["2026-02-12", 0.0742, 0.075],
      ["2026-05-12", 0.0713, 0.075],
      ["2026-08-12", 0.075, undefined],
    ]);
  });

  it("skips a published period that overlaps a stored one", () => {
    const { put } = mergePublishedTerms(ISIN, [{ ...periods[2]!, end: "2026-11-20" }], { periods: published.periods.slice(2), currentRate: null }, "2026-10-14", now);
    expect(put).toEqual([]);
  });
});
