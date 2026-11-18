import { describe, expect, it } from "vitest";
import type { HoldingSnapshot } from "../src/db/items.ts";
import { compactWeights, type FundRegions, RegionTargetsInput, RegionWeightsInput, regionExposure } from "../src/regions/regions.ts";
import { rebalanceBy } from "../src/targets/targets.ts";

const h = (isin: string, code: string, name: string, value: number | null, account = "A", type: HoldingSnapshot["type"] = "ETF") => ({ isin, code, name, type, value, account }) as HoldingSnapshot;
const world: FundRegions = { regions: { US: 64, EUROPE: 15, JAPAN: 5, EM: 10, OTHER: 6 }, regionsAsOf: "2026-11-18" };
const sp500: FundRegions = { regions: { US: 100 }, regionsAsOf: "2026-11-18" };
const regions: Record<string, FundRegions> = { WORLD: world, SPX: sp500 };

describe("regionExposure", () => {
  it("splits each equity fund by its regions, one fund over all accounts, largest first", () => {
    const holdings = [h("WORLD", "VWRL", "All-World", 600, "IKE"), h("SPX", "SPXS", "S&P 500", 300), h("WORLD", "VWRL", "All-World", 400, "IKZE")];
    const exp = regionExposure(holdings, (isin) => regions[isin]);
    expect(exp.funds.map((f) => [f.code, f.value])).toEqual([
      ["VWRL", 1000],
      ["SPXS", 300],
    ]);
    expect(exp.byRegion.US).toBeCloseTo(640 + 300, 6);
    expect(exp.byRegion).toMatchObject({ EUROPE: 150, JAPAN: 50, EM: 100, OTHER: 60 });
    expect(exp.total).toBeCloseTo(1300, 6);
    expect(exp.unassigned).toBe(0);
  });

  it("leaves out bond ETFs, other classes, a class set by hand and empty values; counts funds without regions apart", () => {
    const holdings = [
      h("SPX", "SPXS", "S&P 500", 300),
      h("HY", "AYE2", "EUR High Yield Corp Bond", 500),
      h("DS", "DS0432", "Treasury bond", 800, "A", "BOND_LISTED"),
      { ...h("GOLD", "GLD", "Gold ETC", 200), assetClass: "OTHER" } as HoldingSnapshot,
      h("EM", "EMIM", "Emerging Markets IMI", 100),
      h("SOLD", "OLD", "Sold", null),
    ];
    const exp = regionExposure(holdings, (isin) => regions[isin]);
    expect(exp.funds.map((f) => f.code)).toEqual(["SPXS", "EMIM"]);
    expect(exp.total).toBe(300);
    expect(exp.unassigned).toBe(100);
    expect(exp.funds[1]!.regions).toBeUndefined();
  });
});

describe("RegionWeightsInput", () => {
  it("takes regions adding up to 100, any left out", () => {
    expect(RegionWeightsInput.safeParse({ US: 100 }).success).toBe(true);
    expect(RegionWeightsInput.safeParse({ US: 64.6, EUROPE: 15.2, JAPAN: 5, EM: 10.2, OTHER: 5 }).success).toBe(true);
    expect(RegionWeightsInput.safeParse({ US: 60, EUROPE: 30 }).success).toBe(false);
    expect(RegionWeightsInput.safeParse({ US: 100, MARS: 0 }).success).toBe(false);
    expect(RegionWeightsInput.safeParse({ US: 120, EM: -20 }).success).toBe(false);
  });

  it("compactWeights drops the zero regions", () => {
    expect(compactWeights({ US: 100, EM: 0 })).toEqual({ US: 100 });
  });
});

describe("region targets", () => {
  it("need every region, adding up to 100", () => {
    const bands = { US: 3, EUROPE: 3, JAPAN: 2, EM: 2, OTHER: 2 };
    expect(RegionTargetsInput.safeParse({ targets: { US: 60, EUROPE: 20, JAPAN: 5, EM: 10, OTHER: 5 }, bands }).success).toBe(true);
    expect(RegionTargetsInput.safeParse({ targets: { US: 60, EUROPE: 20, JAPAN: 5, EM: 10, OTHER: 0 }, bands }).success).toBe(false);
    expect(RegionTargetsInput.safeParse({ targets: { US: 60, EUROPE: 25, JAPAN: 5, EM: 10 }, bands }).success).toBe(false);
  });

  it("rebalance by region: new money goes to the regions below target", () => {
    const t = { targets: { US: 60, EUROPE: 20, JAPAN: 5, EM: 10, OTHER: 5 }, bands: { US: 3, EUROPE: 3, JAPAN: 2, EM: 2, OTHER: 2 } };
    const values = { US: 70_000, EUROPE: 15_000, JAPAN: 5_000, EM: 5_000, OTHER: 5_000 };
    const rows = rebalanceBy(["US", "EUROPE", "JAPAN", "EM", "OTHER"] as const, values, t, "NEW_MONEY", 10_000);
    const row = (k: string) => rows.find((r) => r.key === k)!;
    expect(row("US")).toMatchObject({ status: "OVER", trade: 0 });
    expect(row("EUROPE").trade + row("EM").trade).toBeCloseTo(10_000, 2);
    expect(row("EM").status).toBe("UNDER");
    expect(rows.reduce((s, r) => s + r.trade, 0)).toBeCloseTo(10_000, 2);
  });
});
