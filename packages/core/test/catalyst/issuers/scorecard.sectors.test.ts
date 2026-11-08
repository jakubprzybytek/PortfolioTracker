import { describe, expect, it } from 'vitest';
import { computeScorecard, ruleSetFor, type FinancialYearData } from "../../../src/catalyst/issuers/scorecard.ts";

// FY2025 group figures as imported (m PLN)
const ATAL: FinancialYearData = { issuerName: 'Atal', year: 2025, revenue: 1540, ebit: 397, depreciation: 10, interestExpense: 20, netProfit: 300, totalAssets: 5600,
    intangibleAssets: 2, equity: 1960, financialDebt: 1629, cash: 146, currentAssets: 5000, inventory: 4438, currentLiabilities: 1786,
    investmentProperty: 77, interestPaid: 68, leases: 119 };
const UNIBEP: FinancialYearData = { issuerName: 'Unibep', year: 2025, revenue: 2100, ebit: 101, depreciation: 25, interestExpense: 30, netProfit: 60, totalAssets: 1500,
    intangibleAssets: 10, equity: 450, financialDebt: 250, cash: 501, currentAssets: 1100, inventory: 333, currentLiabilities: 900, contractLiabilities: 217 };
const ZABKA: FinancialYearData = { issuerName: 'Żabka', year: 2025, revenue: 26000, ebit: 1800, depreciation: 1900, interestExpense: 900, netProfit: 600, totalAssets: 20000,
    intangibleAssets: 6000, equity: 2560, financialDebt: 9700, cash: 1079, currentAssets: 4000, inventory: 1150, currentLiabilities: 6350,
    operatingCashFlow: 4109, capex: 1624, leases: 5301 };
const POLSAT: FinancialYearData = { issuerName: 'Cyfrowy Polsat', year: 2025, revenue: 14324, ebit: -1417, depreciation: 1716, interestExpense: 900, netProfit: -2603,
    totalAssets: 35269, intangibleAssets: 9000, equity: 14407, financialDebt: 15217, cash: 3183, currentAssets: 9000, inventory: 936, currentLiabilities: 8000,
    operatingCashFlow: 3140, capex: 1153, leases: 711, writeDowns: 2717 };

const dim = (years: FinancialYearData[], rules: Parameters<typeof computeScorecard>[1], name: string) =>
    computeScorecard(years, rules).dimensions.find(d => d.name === name)!;
const m = (d: ReturnType<typeof dim>, name: string) => d.metrics.find(x => x.name === name)!;

describe('rule sets', () => {
    it('chooses the rules from the industry', () => {
        expect(['Developer', 'Construction', 'Retail', 'Telecommunications', 'Media', 'Other', 'Energy', undefined].map(i => ruleSetFor(i)))
            .toEqual(['developer', 'contractor', 'consumer', 'consumer', 'consumer', 'consumer', 'general', 'general']);
        expect(computeScorecard([ATAL], 'developer').ruleSet).toBe('developer');
        expect(ruleSetFor('Retail', 'AB S.A.')).toBe('general');
        expect(ruleSetFor('Retail', 'Pepco Group N.V.')).toBe('consumer');
    });

    it('judges a developer by net debt against its stock, its current ratio and interest paid', () => {
        const debt = dim([ATAL], 'developer', 'Debt Burden');
        expect(m(debt, 'Net Debt/(Inventory + Investment Property)').value).toBeCloseTo(1483 / 4515, 3);
        expect(m(debt, 'Net Debt/(Inventory + Investment Property)').signal).toBe('yellow');
        expect(dim([ATAL], 'developer', 'Liquidity').metrics.map(x => `${x.name} ${x.signal}`)).toEqual(['Current Ratio green', 'Buyer Advances/Inventory na']);
        expect(m(dim([ATAL], 'developer', 'Debt Service'), 'ICR (interest paid)').value).toBeCloseTo(397 / 68, 3);
        expect(m(dim([ATAL], 'developer', 'Asset Coverage'), 'Equity Ratio').signal).toBe('yellow');   // 35%, on the line
        // Under the general rules the same figures had a red quick ratio and net debt / EBITDA 3.6
        expect(dim([ATAL], 'general', 'Debt Burden').metrics.map(x => x.name)).toEqual(['D/E', 'Net Debt/EBITDA']);
    });

    it("judges a contractor's margins by its sector, and its cash net of advances", () => {
        expect(dim([UNIBEP], 'general', 'Profitability').signal).toBe('red');
        expect(m(dim([UNIBEP], 'contractor', 'Profitability'), 'EBIT Margin').signal).toBe('green');
        const cash = m(dim([UNIBEP], 'contractor', 'Liquidity'), 'Cash net of Advances/Revenue');
        expect(cash.value).toBeCloseTo((501 - 217) / 2100, 3);
        expect(cash.signal).toBe('green');
        expect(m(dim([{ ...UNIBEP, cash: 272, contractLiabilities: 309 }], 'contractor', 'Liquidity'), 'Cash net of Advances/Revenue').signal).toBe('red');
    });

    it('judges consumer companies by cash flow and debt with leases, not by working capital', () => {
        const liquidity = dim([ZABKA], 'consumer', 'Liquidity');
        expect(liquidity.signal).toBe('green');        // 4109 / 6350 = 0.65
        expect(m(liquidity, 'Current Ratio').scored).toBe(false);
        const debt = dim([ZABKA], 'consumer', 'Debt Burden');
        expect(m(debt, 'Net Debt incl. Leases/EBITDA').value).toBeCloseTo(8621 / 3700, 3);
        expect(m(debt, 'Net Debt excl. Leases/EBITDA').value).toBeCloseTo(3320 / 3700, 3);
        expect(m(debt, 'Free Cash Flow/Net Debt').value).toBeCloseTo((4109 - 1624) / 8621, 3);
        expect(debt.signal).toBe('green');
        expect(m(dim([ZABKA], 'consumer', 'Asset Coverage'), 'Equity Ratio').signal).toBe('yellow');   // 12.8%
    });

    it('measures EBITDA and interest cover before a write-down, and says so', () => {
        const debt = dim([POLSAT], 'consumer', 'Debt Burden');
        expect(m(debt, 'Net Debt incl. Leases/EBITDA').value).toBeCloseTo(12034 / (-1417 + 2717 + 1716), 3);
        expect(debt.notes).toEqual(['EBIT and EBITDA before a 2,717 m write-down of non-financial assets']);
        expect(m(dim([POLSAT], 'consumer', 'Debt Service'), 'ICR').value).toBeCloseTo(1300 / 900, 3);
        // The loss itself is real
        expect(m(dim([POLSAT], 'consumer', 'Profitability'), 'Net Margin').signal).toBe('red');
    });

    it("doesn't count unscored metrics in a dimension's signal", () => {
        const bad = { ...ZABKA, currentAssets: 100 };
        expect(dim([bad], 'consumer', 'Liquidity').signal).toBe('green');
    });
});
