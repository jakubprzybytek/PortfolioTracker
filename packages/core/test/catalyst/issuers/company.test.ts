import { describe, expect, it } from "vitest";
import { companyAnalysis, companyRuleSet, DIMENSIONS, sixDimensions } from "../../../src/catalyst/issuers/company.ts";
import type { DimensionResult } from "../../../src/catalyst/issuers/scorecard.ts";
import type { FinancialYear } from "../../../src/catalyst/financials.ts";

const dim = (name: string, signal: DimensionResult["signal"], metrics: [string, DimensionResult["signal"]][] = []): DimensionResult => ({
  name,
  signal,
  metrics: metrics.map(([n, s]) => ({ name: n, value: 1, formattedValue: "1", signal: s })),
});

describe("six dimensions", () => {
  it("turns Financial trend into arrows on Debt burden and Profitability, in the fixed order", () => {
    const out = sixDimensions([
      dim("Liquidity", "green"),
      dim("Debt Burden", "yellow"),
      dim("Financial Trend", "red", [
        ["Revenue CAGR", "green"],
        ["EBITDA Margin Trend", "red"],
        ["Net Debt/EBITDA Trend", "green"],
      ]),
      dim("Profitability", "green"),
      dim("Refinancing", "yellow"),
    ]);
    expect(out.map((d) => d.name)).toEqual(["Debt Burden", "Liquidity", "Profitability", "Refinancing"]);
    expect(out.find((d) => d.name === "Debt Burden")).toMatchObject({ signal: "yellow", trend: { arrow: "up" } });
    // A worsening margin outweighs growing revenue; the colour stays.
    expect(out.find((d) => d.name === "Profitability")).toMatchObject({ signal: "green", trend: { arrow: "down" } });
    expect(out.find((d) => d.name === "Liquidity")!.trend).toBeUndefined();
    expect(DIMENSIONS).toHaveLength(6);
  });

  it("gives no arrow under three years (trend metrics n/a), a flat one for yellow", () => {
    expect(sixDimensions([dim("Debt Burden", "green"), dim("Financial Trend", "na", [["Net Debt/EBITDA Trend", "na"]])])[0]!.trend).toBeUndefined();
    expect(sixDimensions([dim("Profitability", "green"), dim("Financial Trend", "yellow", [["Revenue CAGR", "green"], ["EBITDA Margin Trend", "yellow"]])])[0]!.trend!.arrow).toBe("flat");
  });
});

describe("rule sets", () => {
  it("takes a lender's kind, then an override, then the industry's rules", () => {
    expect(companyRuleSet({ industry: "Finance", financeRuleSet: "leasing" }, [])).toEqual({ ruleSet: "leasing", lender: true });
    expect(companyRuleSet({ industry: "Finance" }, ["Kruk S.A."])).toEqual({ ruleSet: "collector", lender: true });
    expect(companyRuleSet({ industry: "Retail", ruleSetOverride: { ruleSet: "general", reason: "distributor" } }, [])).toEqual({ ruleSet: "general", lender: false });
    expect(companyRuleSet({ industry: "Developer" }, [])).toEqual({ ruleSet: "developer", lender: false });
    expect(companyRuleSet({}, [])).toEqual({ ruleSet: "general", lender: false });
  });
});

describe("a company's analysis", () => {
  const year = (periodEnd: string, values: Record<string, number>): FinancialYear =>
    ({
      entityId: "E",
      period: `${periodEnd}#group`,
      companyName: "X",
      scope: "group",
      periodStart: "",
      periodEnd,
      months: 12,
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
      filing: { key: "k", sha256: "s", format: "esef", schema: "", checks: [] },
      enteredBy: "t",
      importedAt: "2026-01-01T00:00:00Z",
    }) as FinancialYear;
  const figures = { revenue: 500, ebit: 60, depreciation: 20, interestExpense: 10, netProfit: 40, totalAssets: 800, equity: 400, financialDebt: 200, cash: 50, currentAssets: 300, currentLiabilities: 150 };

  it("scores a company with reports: six dimensions with refinancing, arrows from three years, confidence", () => {
    const years = [year("2025-12-31", figures), year("2024-12-31", { ...figures, revenue: 450 }), year("2023-12-31", { ...figures, revenue: 400 })];
    const bonds = [{ isin: "PL1", name: "ABC0127", currency: "PLN", issueValue: 50e6, maturityDay: "2027-01-15" }];
    const a = companyAnalysis({ industry: "Manufacturing" }, [], years, bonds, {}, "2026-11-08");
    expect(a.state).toBe("scored");
    expect(a.scorecard!.dimensions.map((d) => d.name)).toEqual([...DIMENSIONS]);
    expect(a.scorecard!.dimensions.find((d) => d.name === "Profitability")!.trend).toBeDefined();
    expect(a.scorecard!.confidence!.level).toBeDefined();
    expect(a.source).toMatchObject({ format: "esef", scope: "group", latestPeriodEnd: "2025-12-31", years: 3 });
    expect(a.refinancing!.bonds).toHaveLength(1);
  });

  it("says when there's no report, and leaves banks and a Finance company without its kind unscored", () => {
    expect(companyAnalysis({ industry: "Developer" }, [], [], [], {}, "2026-11-08").state).toBe("no-report");
    expect(companyAnalysis({ industry: "Finance" }, ["Some Bank S.A."], [year("2025-12-31", figures)], [], {}, "2026-11-08").state).toBe("out-of-scope");
    expect(companyAnalysis({ industry: "Municipal" }, [], [], [], {}, "2026-11-08").state).toBe("out-of-scope");
  });
});
