import { describe, expect, it } from "vitest";
import { parseNbpRates } from "../../src/lib/nbp.ts";

describe("parseNbpRates", () => {
  it("reads table A mid rates", () => {
    // GET https://api.nbp.pl/api/exchangerates/rates/a/eur/2026-10-09/2026-10-12/?format=json (trimmed)
    const json = {
      table: "A",
      currency: "euro",
      code: "EUR",
      rates: [
        { no: "197/A/NBP/2026", effectiveDate: "2026-10-09", mid: 4.3801 },
        { no: "198/A/NBP/2026", effectiveDate: "2026-10-12", mid: 4.3889 },
      ],
    };
    expect(parseNbpRates(json)).toEqual([
      { currency: "EUR", date: "2026-10-09", mid: 4.3801, table: "197/A/NBP/2026" },
      { currency: "EUR", date: "2026-10-12", mid: 4.3889, table: "198/A/NBP/2026" },
    ]);
  });
});
