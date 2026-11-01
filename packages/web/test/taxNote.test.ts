import { describe, expect, it } from "vitest";
import { joinTaxNote, splitTaxNote, taxLine } from "../src/taxNote.ts";

describe("tax note", () => {
  it("writes the tax with a decimal comma and the currency", () => {
    expect(taxLine(19, "PLN")).toBe("Tax paid: 19,00 PLN");
    expect(taxLine(2.345, "EUR")).toBe("Tax paid: 2,35 EUR");
  });

  it("adds the line under the user's note, or alone", () => {
    expect(joinTaxNote("Kupon KRU0628", 19, "PLN")).toBe("Kupon KRU0628\nTax paid: 19,00 PLN");
    expect(joinTaxNote("  ", 19, "PLN")).toBe("Tax paid: 19,00 PLN");
    expect(joinTaxNote("Kupon", undefined, "PLN")).toBe("Kupon");
    expect(joinTaxNote("Kupon", 0, "PLN")).toBe("Kupon");
  });

  it("reads the line back and leaves the rest of the note", () => {
    expect(splitTaxNote("Kupon KRU0628\nTax paid: 19,00 PLN")).toEqual({ note: "Kupon KRU0628", tax: 19, currency: "PLN" });
    expect(splitTaxNote("Tax paid: 2,35 EUR")).toEqual({ note: "", tax: 2.35, currency: "EUR" });
    expect(splitTaxNote("First\nTax paid: 1,50 PLN\nLast")).toEqual({ note: "First\nLast", tax: 1.5, currency: "PLN" });
    expect(splitTaxNote("No tax here")).toEqual({ note: "No tax here" });
  });

  it("round-trips", () => {
    const stored = joinTaxNote("Dywidenda", 12.34, "USD");
    const { note, tax, currency } = splitTaxNote(stored);
    expect(joinTaxNote(note, tax, currency!)).toBe(stored);
  });
});
