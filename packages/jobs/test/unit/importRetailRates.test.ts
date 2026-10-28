import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RetailTerms } from "@portfolio/core";

const terms: RetailTerms = {
  series: "EDO0935",
  isin: "PL0000118402",
  kind: "EDO",
  termMonths: 120,
  periodMonths: 12,
  capitalises: true,
  rates: [0.06, 0.05, null, null, null, null, null, null, null, null],
  margin: 0.02,
  rolloverPrice: 99.9,
  publishedInterest: [null],
  saleStart: "2025-09-01",
  saleEnd: "2025-09-30",
};
/** The same terms with their keys sorted, as DynamoDB returns a stored map. */
const asStored = (t: RetailTerms) => Object.fromEntries(Object.entries(t).sort(([a], [b]) => (a < b ? -1 : 1))) as unknown as RetailTerms;

const repo = { putRetailSeries: vi.fn(async (s: unknown[]) => s.length), listInstruments: vi.fn(), putInstrument: vi.fn() };
vi.mock("sst", () => ({ Resource: {} }));
vi.mock("../../src/lib/context.ts", () => ({ repo, invokeAsync: vi.fn(), queueValuation: vi.fn(), runJob: vi.fn() }));
vi.mock("@portfolio/core", async (original) => ({
  ...(await original<typeof import("@portfolio/core")>()),
  parseRetailRates: () => new Map([[terms.series, terms]]),
}));
const { importRetailRates } = await import("../../src/handlers/import.ts");

const instrument = (retail: RetailTerms) => ({ isin: terms.isin, code: terms.series, type: "BOND_RETAIL", retail });

describe("importRetailRates", () => {
  beforeEach(() => vi.clearAllMocks());

  it("leaves an instrument alone when only the stored key order differs", async () => {
    repo.listInstruments.mockResolvedValue([instrument(asStored(terms))]);
    const r = await importRetailRates(new Uint8Array(), "test");
    expect(r.refreshedIsins).toEqual([]);
    expect(repo.putInstrument).not.toHaveBeenCalled();
  });

  it("refreshes an instrument whose terms changed (a new year's rate)", async () => {
    repo.listInstruments.mockResolvedValue([instrument(asStored({ ...terms, rates: [0.06, null, ...terms.rates.slice(2)] }))]);
    const r = await importRetailRates(new Uint8Array(), "test");
    expect(r.refreshedIsins).toEqual([terms.isin]);
    expect(repo.putInstrument).toHaveBeenCalledWith(expect.objectContaining({ retail: terms }));
  });
});
