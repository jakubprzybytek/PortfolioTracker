import { describe, expect, it } from 'vitest';
import { computeScorecard, type FinancialYearData } from "../../../src/catalyst/issuers/scorecard.ts";
import { dataConfidence, yearsBehind } from "../../../src/catalyst/issuers/confidence.ts";

const TODAY = '2026-11-03';

// Atal's FY2025 group figures (m PLN), as imported
const ATAL: FinancialYearData = { issuerName: 'Atal', year: 2025, revenue: 1540, ebit: 397, depreciation: 10, interestExpense: 20, netProfit: 300, totalAssets: 5600,
    intangibleAssets: 2, equity: 1960, financialDebt: 1629, cash: 146, currentAssets: 5000, inventory: 4438, currentLiabilities: 1786,
    investmentProperty: 77, interestPaid: 68, leases: 119 };
const report = (years = 2) => ({ kind: 'filing' as const, format: 'esef' as const, scope: 'group' as const, periodEnd: '2025-12-31', years });
const ai = (periodEnd: string, years: number) => ({ kind: 'ai' as const, performedAt: '2026-05-28T10:00:00Z', periodEnd, years });

describe('yearsBehind', () => {
    it('counts the later years whose report is due, 9 months after the year end', () => {
        expect(yearsBehind('2025-12-31', TODAY)).toBe(0);
        expect(yearsBehind('2025-09-30', TODAY)).toBe(0);
        expect(yearsBehind('2024-12-31', TODAY)).toBe(1);
        expect(yearsBehind('2023-12-31', TODAY)).toBe(2);
        expect(yearsBehind('2024-12-31', '2026-09-30')).toBe(1);
        expect(yearsBehind('2024-12-31', '2026-09-29')).toBe(0);
    });
});

describe('dataConfidence', () => {
    it('is high for a current report with every metric', () => {
        const c = dataConfidence(computeScorecard([ATAL, { ...ATAL, year: 2024 }], 'developer'), report(), TODAY);
        expect(c.level).toBe('high');
        expect(c.metrics).toEqual({ computed: 8, scored: 8 });
        expect(c.facts).toEqual(['ESEF report, group accounts, FY2025', '8 of 8 metrics computed', '2 years of figures: no trend (needs 3)']);
    });

    it('is medium for a report without EBIT (KGHM, Polenergia)', () => {
        const c = dataConfidence(computeScorecard([{ ...ATAL, ebit: undefined }], 'general'), report(1), TODAY);
        expect(c.level).toBe('medium');
        expect(c.missing).toEqual(['Net Debt/EBITDA', 'ICR', 'EBIT Margin']);
    });

    it('is at most medium for AI-collected figures, and says when they are a year behind', () => {
        const years = [2024, 2023, 2022].map(year => ({ ...ATAL, year }));
        const current = dataConfidence(computeScorecard(years.map(y => ({ ...y, year: y.year + 1 })), 'developer'), ai('2025-12-31', 3), TODAY);
        expect(current.level).toBe('medium');
        const behind = dataConfidence(computeScorecard(years, 'developer'), ai('2024-12-31', 3), TODAY);
        expect(behind.level).toBe('medium');
        expect(behind.yearsBehind).toBe(1);
        expect(behind.facts[0]).toBe('AI-collected figures (2026-05-28), not checked against a report, FY2024');
        expect(behind.facts[1]).toBe('a year behind: a later report should be out');
    });

    it('is low for one figure (Domesta: revenue and net profit only) and marks a dimension coloured by one metric', () => {
        const c = dataConfidence(computeScorecard([{ issuerName: 'Domesta', year: 2024, revenue: 25.21, netProfit: 18.03 }], 'developer'), ai('2024-12-31', 1), TODAY);
        expect(c.level).toBe('low');
        expect(c.metrics).toEqual({ computed: 1, scored: 8 });
        expect(c.thinDimensions).toEqual(['Profitability']);
        expect(c.facts).toContain('Profitability: from one metric');
    });

    it('is low two years behind, however complete', () => {
        expect(dataConfidence(computeScorecard([{ ...ATAL, year: 2023 }], 'developer'), { ...report(1), periodEnd: '2023-12-31' }, TODAY).level).toBe('low');
    });

    it('leaves Refinancing and not-scored metrics out of the count', () => {
        const scorecard = computeScorecard([ATAL], 'developer');
        const withRefinancing = { ...scorecard, dimensions: [...scorecard.dimensions, { name: 'Refinancing', signal: 'na' as const, metrics: [{ name: 'Bonds due in 12 months', value: 0, formattedValue: '0', signal: 'na' as const }] }] };
        expect(dataConfidence(withRefinancing, report(1), TODAY).metrics).toEqual({ computed: 8, scored: 8 });
    });
});
