import { describe, expect, it } from "vitest";
import { taxFromNoteLine } from "../src/transactions/taxBackfill.ts";

const coupon = (note: string | undefined, extra: Record<string, unknown> = {}) => ({ type: "COUPON" as const, currency: "PLN", note, ...extra });

describe("taxFromNoteLine", () => {
  it("reads the broker's line and leaves no note when that was all of it", () => {
    expect(taxFromNoteLine(coupon("Pobrany podatek: 92.01 PLN"))).toEqual({ tax: 92.01, note: undefined });
    expect(taxFromNoteLine(coupon("Pobrany podatek: 4.1 PLN"))).toEqual({ tax: 4.1, note: undefined });
    expect(taxFromNoteLine({ type: "INTEREST", currency: "PLN", note: "Tax: 2.16 zł" })).toEqual({ tax: 2.16, note: undefined });
    expect(taxFromNoteLine(coupon("Tax paid: 19,00 PLN"))).toEqual({ tax: 19, note: undefined });
  });

  it("keeps the rest of the note", () => {
    expect(taxFromNoteLine(coupon("Kupon KRU0628\nPobrany podatek: 61.56 PLN"))).toEqual({ tax: 61.56, note: "Kupon KRU0628" });
  });

  it("skips what isn't a clean match", () => {
    expect(taxFromNoteLine(coupon("Pobrany podatek: 61.56 PLN", { tax: 61.56 }))).toBeUndefined(); // done already
    expect(taxFromNoteLine({ type: "DEPOSIT", currency: "PLN", note: "Pobrany podatek: 1 PLN" })).toBeUndefined();
    expect(taxFromNoteLine(coupon("Pobrany podatek: 1.5 EUR"))).toBeUndefined(); // another currency
    expect(taxFromNoteLine(coupon("Podatek zapłacę sam w PIT-38"))).toBeUndefined(); // not a line of the tax
    expect(taxFromNoteLine(coupon("Pobrany podatek: 0 PLN"))).toBeUndefined();
    expect(taxFromNoteLine(coupon(undefined))).toBeUndefined();
  });
});
