import { describe, expect, it } from "vitest";
import { companyAnalysis } from "../../../src/catalyst/issuers/company.ts";
import { filedYears } from "../../../src/catalyst/issuers/filedYears.ts";
import { periodLabel, withInterim } from "../../../src/catalyst/issuers/interim.ts";
import type { FinancialYear } from "../../../src/catalyst/financials.ts";

const row = (periodEnd: string, months: number, values: Record<string, number>, over: Partial<FinancialYear> = {}): FinancialYear =>
  ({
    entityId: "E",
    period: `${periodEnd}#group`,
    companyName: "X",
    scope: "group",
    periodStart: "",
    periodEnd,
    months,
    currency: "PLN",
    standard: "ifrs",
    presentedUnit: 1000,
    lineSigns: "tagged",
    figures: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { value: v * 1e6, source: [] }])),
    lines: [],
    items: {},
    review: { status: "parsed" },
    column: "current",
    reportPeriodEnd: periodEnd,
    filing: { key: "k", sha256: "s", format: months < 12 ? "ai-pdf" : "esef", schema: "", checks: [] },
    enteredBy: "t",
    importedAt: "2026-01-01T00:00:00Z",
    ...over,
  }) as FinancialYear;

const year = { revenue: 500, ebit: 60, depreciation: 20, interestExpense: 10, netProfit: 40, totalAssets: 800, equity: 400, financialDebt: 200, cash: 50, currentAssets: 300, currentLiabilities: 150, operatingCashFlow: 70 };
const h1 = { revenue: 300, ebit: 40, depreciation: 11, interestExpense: 6, netProfit: 25, totalAssets: 900, equity: 420, financialDebt: 280, cash: 120, currentAssets: 380, currentLiabilities: 160, operatingCashFlow: 30 };
const h1Before = { revenue: 250, ebit: 30, depreciation: 10, interestExpense: 5, netProfit: 20, operatingCashFlow: 35 };
const fy2025 = row("2025-12-31", 12, year);
const fy2024 = row("2024-12-31", 12, { ...year, revenue: 450 });
const fy2023 = row("2023-12-31", 12, { ...year, revenue: 400 });

const apply = (rows: FinancialYear[]) => {
  const filed = filedYears(rows)!;
  return withInterim(rows, filed.years, { periodEnd: filed.latestPeriodEnd, scope: filed.scope });
};

describe("an interim period in the scorecard", () => {
  it("the balance sheet at the interim's date; flows over the 12 months to it (year + year to date − a year earlier)", () => {
    const r = apply([fy2025, fy2024, row("2026-06-30", 6, h1), row("2025-06-30", 6, h1Before)]);
    expect(r.interim).toEqual({ periodEnd: "2026-06-30", months: 6, label: "H1 2026", ttm: ["revenue", "ebit", "depreciation", "interestExpense", "netProfit", "operatingCashFlow"], comparative: "H1 2025" });
    const y = r.years[0]!;
    // 500 + 300 − 250, 60 + 40 − 30, 40 + 25 − 20, 70 + 30 − 35
    expect([y.revenue, y.ebit, y.netProfit, y.operatingCashFlow]).toEqual([550, 70, 45, 65]);
    expect([y.cash, y.financialDebt, y.equity, y.totalAssets]).toEqual([120, 280, 420, 900]);
    // The earlier years stay as they were.
    expect(r.years[1]!.revenue).toBe(450);
  });

  it("an item the comparative lacks stays the year's (never part TTM, part year); no comparative: flows stay the year's", () => {
    const { capex: _c, ...noCapex } = { ...h1Before, capex: 0 };
    const r = apply([fy2025, row("2026-06-30", 6, { ...h1, capex: 15 }), row("2025-06-30", 6, noCapex)]);
    expect(r.interim!.ttm).not.toContain("capex");
    const alone = apply([fy2025, row("2026-06-30", 6, h1)]);
    expect(alone.interim).toMatchObject({ ttm: [], label: "H1 2026" });
    expect(alone.interim!.comparative).toBeUndefined();
    expect(alone.years[0]!.revenue).toBe(500);
    expect(alone.years[0]!.cash).toBe(120);
  });

  it("another scope or standard: the scorecard stays on the full year and says why", () => {
    const single = apply([fy2025, row("2026-06-30", 6, h1, { scope: "single", period: "2026-06-30#single" })]);
    expect(single.interim).toBeUndefined();
    expect(single.skipped).toContain("single accounts, the year group");
    const pl = apply([fy2025, row("2026-06-30", 6, h1, { standard: "pl-uor" })]);
    expect(pl.skipped).toContain("another standard");
  });

  it("only an interim newer than the year, within the next year: an older one, or one the next year covers, isn't used", () => {
    expect(apply([fy2025, row("2025-06-30", 6, h1)]).interim).toBeUndefined();
    const fy2026 = row("2026-12-31", 12, { ...year, revenue: 600 });
    expect(apply([fy2026, fy2025, row("2026-06-30", 6, h1), row("2025-06-30", 6, h1Before)]).interim).toBeUndefined();
    expect(apply([fy2025, row("2027-03-31", 3, h1)]).interim).toBeUndefined();
  });

  it("a part year is never a year: a company with only an interim has no report", () => {
    expect(filedYears([row("2026-06-30", 6, h1)])).toBeUndefined();
  });

  it("labels: H1, Q1, Q1–Q3", () => {
    expect([periodLabel("2026-06-30", 6), periodLabel("2026-03-31", 3), periodLabel("2026-09-30", 9)]).toEqual(["H1 2026", "Q1 2026", "Q1–Q3 2026"]);
  });
});

describe("a company's analysis with an interim report", () => {
  it("names the interim in the source, the notes and the confidence; the trend arrows stay the full years'", () => {
    const annual = companyAnalysis({ industry: "Manufacturing" }, [], [fy2025, fy2024, fy2023], [], {}, "2026-11-08");
    const a = companyAnalysis({ industry: "Manufacturing" }, [], [fy2025, fy2024, fy2023, row("2026-06-30", 6, h1), row("2025-06-30", 6, h1Before)], [], {}, "2026-11-08");
    expect(a.source).toMatchObject({ latestPeriodEnd: "2025-12-31", interim: { label: "H1 2026", comparative: "H1 2025" } });
    const arrows = (x: typeof a) => x.scorecard!.dimensions.map((d) => d.trend?.arrow ?? null);
    expect(arrows(a)).toEqual(arrows(annual));
    const notes = (name: string) => a.scorecard!.dimensions.find((d) => d.name === name)!.notes ?? [];
    expect(notes("Liquidity")).toContain("balance sheet at 2026-06-30 (H1 2026, interim)");
    expect(notes("Debt Service").join()).toContain("flows over the 12 months to 2026-06-30 (FY2025 + H1 2026 − H1 2025)");
    expect(a.scorecard!.confidence!.facts.join()).toContain("H1 2026: interim figures");
    // The cash refinancing counts on is the interim's.
    expect(a.refinancing!.report).toMatchObject({ periodEnd: "2026-06-30", cash: 120e6 });
  });

  it("back on the full year once the next one is stored", () => {
    const a = companyAnalysis({ industry: "Manufacturing" }, [], [row("2026-12-31", 12, year), fy2025, row("2026-06-30", 6, h1)], [], {}, "2027-04-01");
    expect(a.source!.interim).toBeUndefined();
    expect(a.source!.latestPeriodEnd).toBe("2026-12-31");
  });
});
