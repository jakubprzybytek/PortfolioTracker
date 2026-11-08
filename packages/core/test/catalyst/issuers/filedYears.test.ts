import { describe, expect, it } from 'vitest';
import type { DbIssuerFinancialsRecord } from "../../../src/catalyst/issuers/financialsRecord.ts";
import { ebitFromProfitBeforeTax, filedYears } from "../../../src/catalyst/issuers/filedYears.ts";

function row(periodEnd: string, scope: 'single' | 'group', revenue: number, months = 12): DbIssuerFinancialsRecord {
    return {
        entityId: '0000123456', period: `${periodEnd}#${scope}`, issuerName: 'Testowa S.A.', companyName: 'TESTOWA S.A.',
        scope, periodStart: '', periodEnd, months, currency: 'PLN',
        figures: { revenue: { value: revenue, source: ['RZiSPor/A'] } },
        column: 'current', filing: { key: 'k', sha256: 's', format: 'krs-xml', schema: 'x', checks: [] }, importedAt: '',
    } as unknown as DbIssuerFinancialsRecord;
}

describe('filedYears', () => {
    it('is undefined without full-year rows', () => {
        expect(filedYears([])).toBeUndefined();
        expect(filedYears([row('2025-06-30', 'single', 1, 6)])).toBeUndefined();
    });

    it('prefers group accounts and converts PLN to millions, newest first', () => {
        const result = filedYears([
            row('2024-12-31', 'single', 9_000_000),
            row('2024-12-31', 'group', 12_000_000),
            row('2025-12-31', 'group', 15_500_000),
        ]);
        expect(result?.scope).toBe('group');
        expect(result?.latestPeriodEnd).toBe('2025-12-31');
        expect(result?.years.map(y => [y.year, y.revenue, y.ebit])).toEqual([[2025, 15.5, null], [2024, 12, null]]);
    });

    it('uses single-company accounts when there are no group ones, at most five years', () => {
        const rows = [2019, 2020, 2021, 2022, 2023, 2024, 2025].map(y => row(`${y}-12-31`, 'single', y));
        const result = filedYears(rows);
        expect(result?.scope).toBe('single');
        expect(result?.years.map(y => y.year)).toEqual([2025, 2024, 2023, 2022, 2021]);
    });

    it('derives EBIT from profit before tax when the report prints no operating profit (Polenergia FY2025)', () => {
        const polenergia = { ...row('2025-12-31', 'group', 4_225_771_000), items: { profitBeforeTax: -59_124_000, financeCosts: -299_817_000, financeIncome: 75_466_000 } };
        const year = filedYears([polenergia])!.years[0]!;
        expect(year.ebit).toBeCloseTo(165.227, 3);
        expect(year.ebitDerived).toBe(1);
        // costs printed as positive amounts give the same
        expect(ebitFromProfitBeforeTax({ profitBeforeTax: -59_124_000, financeCosts: 299_817_000, financeIncome: 75_466_000 })).toBe(165_227_000);
    });

    it('keeps a printed EBIT, and derives nothing without profit before tax or finance lines', () => {
        const printed = { ...row('2025-12-31', 'group', 100), figures: { ebit: { value: 20_000_000, source: ['x'] } }, items: { profitBeforeTax: 1, financeCosts: -1 } };
        expect(filedYears([printed])!.years[0]).toMatchObject({ ebit: 20 });
        expect(filedYears([printed])!.years[0]!.ebitDerived).toBeUndefined();
        expect(ebitFromProfitBeforeTax({ profitBeforeTax: 5 })).toBeUndefined();
        expect(ebitFromProfitBeforeTax({ financeCosts: -5 })).toBeUndefined();
    });
});
