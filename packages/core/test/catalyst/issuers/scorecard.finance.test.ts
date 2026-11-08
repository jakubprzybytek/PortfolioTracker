import { describe, expect, it } from 'vitest';
import { computeScorecard, financeRuleSetFor, ruleSetFor, type FinancialYearData, type RuleSet } from "../../../src/catalyst/issuers/scorecard.ts";

// Latest-year figures as imported (m PLN), see the design's table
const KRUK: FinancialYearData = { issuerName: 'Kruk', year: 2025, revenue: 3190.7, ebit: 1577.8, interestExpense: 444.0, netProfit: 1085.6,
    totalAssets: 13032.2, equity: 5326.5, financialDebt: 7227.0, cash: 212.6, bonds: 3460.9, debtDueWithinYear: 1000, operatingCashFlow: 293.3 };
const KRUK_2024: FinancialYearData = { issuerName: 'Kruk', year: 2024, equity: 4550 };
const VEHIS: FinancialYearData = { issuerName: 'Vehis', year: 2025, revenue: 134.1, ebit: 138.7, interestExpense: 113.4, netProfit: 11.0,
    totalAssets: 3200.7, equity: 95.1, profitBeforeTax: 13.8, financialDebt: 2832.1, cash: 111.8, bonds: 283.6, securitisation: 2395.2, debtDueWithinYear: 705.8 };
const MCI: FinancialYearData = { issuerName: 'MCI', year: 2025, revenue: 26.5, ebit: -3.5, interestExpense: 55.0, netProfit: 0.5,
    totalAssets: 2412.0, equity: 1256.7, financialDebt: 593.2, bonds: 222 };
const CORPUS: FinancialYearData = { issuerName: 'Corpus Iuris', year: 2025, revenue: 22.4, ebit: 43.1, interestExpense: 6.6, netProfit: 29.8,
    totalAssets: 201.2, equity: 91.8, financialDebt: 70.9, cash: 4.2, profitBeforeTax: 36.5 };

const signals = (years: FinancialYearData[], rules: RuleSet) => computeScorecard(years, rules).dimensions.map(d => d.signal);
const dim = (years: FinancialYearData[], rules: RuleSet, name: string) => computeScorecard(years, rules).dimensions.find(d => d.name === name)!;

describe('finance rule sets', () => {
    it('are chosen by name; other Finance issuers have none', () => {
        expect(ruleSetFor('Finance', 'Kruk S.A.')).toBe('collector');
        expect(ruleSetFor('Finance', 'Vehis Finanse Sp. z o.o.')).toBe('leasing');
        expect(ruleSetFor('Finance', 'MCI Management Sp. z o.o.')).toBe('investment');
        expect(financeRuleSetFor('PKO Bank Polski S.A.')).toBeUndefined();
    });

    it('judge a debt collector by leverage against equity, interest cover, returns and the equity ratio', () => {
        // Debt Burden, Debt Service, Liquidity, Profitability, Asset Coverage, Trend
        expect(signals([KRUK, KRUK_2024], 'collector')).toEqual(['green', 'green', 'yellow', 'green', 'green', 'na']);
        const profit = dim([KRUK, KRUK_2024], 'collector', 'Profitability');
        expect(profit.metrics[0]!.value).toBeCloseTo(1085.6 / ((5326.5 + 4550) / 2), 4);   // average equity
        const debt = dim([KRUK], 'collector', 'Debt Burden');
        expect(debt.metrics.map(x => [x.name, x.signal])).toEqual([['Net Debt/Equity', 'green'], ['Bonds/Financial Debt', 'na']]);
        expect(debt.metrics[1]!.scored).toBe(false);
        expect(dim([KRUK], 'collector', 'Liquidity').metrics[1]).toMatchObject({ name: 'Operating Cash Flow', scored: false });
    });

    it('show a securitised lessor\'s leverage, with a note', () => {
        // interest cover (13.8 + 113.4) / 113.4 = 1.12 (red), cash 111.8 against 705.8 due within a year (yellow)
        expect(signals([VEHIS], 'leasing')).toEqual(['red', 'red', 'yellow', 'red', 'red', 'na']);
        expect(dim([VEHIS], 'leasing', 'Debt Burden').notes?.[0]).toMatch(/2,395.2 m of securitisation/);
    });

    it('score only the balance sheet of an investment firm, with gross debt when there is no cash figure', () => {
        const card = computeScorecard([MCI], 'investment');
        const debt = card.dimensions[0]!;
        expect(debt.metrics[0]).toMatchObject({ name: 'Net Debt/Total Assets', signal: 'green' });
        expect(debt.notes).toContain('No cash figure: net debt is gross debt');
        expect(card.dimensions.map(d => d.signal)).toEqual(['green', 'na', 'na', 'na', 'green', 'na']);
    });

    it('take interest cover from profit before tax: portfolio income is often below EBIT', () => {
        // EBIT 3.5 / 6.6 would be 0.53; with finance income, (36.5 + 6.6) / 6.6
        const icr = dim([{ ...CORPUS, ebit: 3.5 }], 'collector', 'Debt Service').metrics[0]!;
        expect(icr).toMatchObject({ name: 'ICR (profit before tax + interest)', signal: 'green' });
        expect(icr.value).toBeCloseTo(43.1 / 6.6, 3);
        expect(dim([KRUK], 'collector', 'Debt Service').metrics[0]!.name).toBe('ICR');   // no profit before tax: EBIT
    });

    it('note a net profit above revenue', () => {
        expect(dim([CORPUS], 'collector', 'Profitability').notes?.[0]).toMatch(/above revenue/);
    });
});
