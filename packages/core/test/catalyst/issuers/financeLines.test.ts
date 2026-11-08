import { describe, expect, it } from 'vitest';
import { financeItem, itemTotals, markLineItems, type LineItem, type StatementLine } from "../../../src/catalyst/filings/statementLines.ts";
import type { DbIssuerFinancialsRecord } from "../../../src/catalyst/issuers/financialsRecord.ts";
import { filedYears } from "../../../src/catalyst/issuers/filedYears.ts";

const line = (order: number, label: string, value: number, item?: LineItem, parent?: number): StatementLine =>
    ({ statement: 'balance', order, label, value, ...(item ? { item } : {}), ...(parent !== undefined ? { parent } : {}) });

// Vehis FY2025 (KRS XML, single), liabilities in m PLN as stored; the parents as the KRS codes give them
const VEHIS: StatementLine[] = [
    line(0, 'Zobowiązania i rezerwy na zobowiązania', 3105.7, 'totalLiabilities'),
    line(1, 'Zobowiązania długoterminowe', 2139.2, 'noncurrentLiabilities', 0),
    line(2, 'Wobec pozostałych jednostek', 2126.2, undefined, 1),
    line(3, 'zobowiązania z tytułu sekurytyzacji', 1850.2, undefined, 2),
    line(4, 'kredyty i pożyczki', 32.2, 'debtBankLoans', 2),
    line(5, 'z tytułu emisji dłużnych papierów wartościowych', 243.8, 'debtBonds', 2),
    line(6, 'Zobowiązania krótkoterminowe', 966.1, 'currentLiabilities', 0),
    line(7, 'Zobowiązania wobec pozostałych jednostek', 891.4, undefined, 6),
    line(8, 'zobowiązania z tytułu sekurytyzacji', 545.0, undefined, 7),
    line(9, 'kredyty i pożyczki', 120.1, 'debtBankLoans', 7),
    line(10, 'z tytułu emisji dłużnych papierów wartościowych', 39.8, 'debtBonds', 7),
    line(11, 'inne zobowiązania finansowe', 0.9, 'debtOther', 7),
];

// Vindexus FY2025 (ESEF, group): no parents, the sections in order
const VINDEXUS: StatementLine[] = [
    line(0, '1. Zobowiązania długoterminowe', 91.0, 'noncurrentLiabilities'),
    line(1, 'Kredyty i pożyczki', 0, 'debtBankLoans'),
    line(2, 'Pozostałe zobowiązania finansowe', 72.4),
    line(3, '2. Zobowiązania krótkoterminowe (2a + 2b)', 55.7, 'currentLiabilities'),
    line(4, 'Kredyty i pożyczki', 2.2, 'debtBankLoans'),
    line(5, 'Pozostałe zobowiązania finansowe', 28.2),
    line(6, 'Zobowiązania z tytułu dostaw i usług i pozostałe', 24.2, 'tradePayables'),
    line(7, 'C. PASYWA RAZEM (A+B)', 453.3, 'totalEquityAndLiabilities'),
];

describe('finance lines', () => {
    it('finds securitisation and other financial liabilities by label or concept, on the balance sheet only', () => {
        expect(financeItem({ statement: 'balance', label: 'zobowiązania z tytułu sekurytyzacji' })).toBe('debtSecuritisation');
        expect(financeItem({ statement: 'balance', label: 'Liabilities from securitisation' })).toBe('debtSecuritisation');
        expect(financeItem({ statement: 'balance', label: 'd) zobowiązania z tytułu sekurytzyacji' })).toBe('debtSecuritisation');
        expect(financeItem({ statement: 'balance', label: 'Pozostałe zobowiązania finansowe' })).toBe('otherFinancialLiabilities');
        expect(financeItem({ statement: 'balance', label: 'x', code: 'ifrs-full:OtherCurrentFinancialLiabilities' })).toBe('otherFinancialLiabilities');
        expect(financeItem({ statement: 'balance', label: 'Zobowiązania z tytułu dostaw i usług' })).toBeUndefined();
        expect(financeItem({ statement: 'income', label: 'Koszty sekurytyzacji' })).toBeUndefined();
    });

    it('counts Vehis securitisation, and the debt under current liabilities by parent', () => {
        const lines = VEHIS.map(l => ({ ...l }));
        markLineItems(lines);
        const totals = itemTotals(lines, 'printed');
        expect(totals.debtSecuritisation).toBeCloseTo(2395.2, 1);
        expect(totals.debtDueWithinYear).toBeCloseTo(545.0 + 120.1 + 39.8 + 0.9, 1);
        // a line that already has an item keeps it
        expect(lines[11]!.item).toBe('debtOther');
    });

    it('finds the current section by order when lines have no parents (Vindexus)', () => {
        const lines = VINDEXUS.map(l => ({ ...l }));
        markLineItems(lines);
        const totals = itemTotals(lines, 'tagged');
        expect(totals.otherFinancialLiabilities).toBeCloseTo(100.6, 1);
        expect(totals.debtDueWithinYear).toBeCloseTo(2.2, 1);
        expect(totals.otherFinancialDueWithinYear).toBeCloseTo(28.2, 1);
    });
});

function row(items: DbIssuerFinancialsRecord['items'], debt: number): DbIssuerFinancialsRecord {
    return {
        entityId: '0000123456', period: '2025-12-31#group', issuerName: 'Testowa S.A.', companyName: 'TESTOWA S.A.',
        scope: 'group', periodStart: '', periodEnd: '2025-12-31', months: 12, currency: 'PLN',
        figures: { financialDebt: { value: debt, source: ['x'] } },
        column: 'current', filing: { key: 'k', sha256: 's', format: 'esef', schema: 'x', checks: [] }, importedAt: '', items,
    } as unknown as DbIssuerFinancialsRecord;
}

describe('filedYears: debt the parsers leave out', () => {
    it('adds securitisation to the debt', () => {
        const year = filedYears([row({ debtSecuritisation: 2_395_200_000, debtBonds: 283_600_000, debtDueWithinYear: 705_800_000 }, 436_900_000)])!.years[0]!;
        expect(year.financialDebt).toBeCloseTo(2832.1, 1);
        expect(year.securitisation).toBeCloseTo(2395.2, 1);
        expect(year.bonds).toBeCloseTo(283.6, 1);
    });

    it('takes bonds from other financial liabilities only when the issuer has listed bonds and there is no bonds line', () => {
        const items = { debtBankLoans: 2_200_000, otherFinancialLiabilities: 100_600_000, otherFinancialDueWithinYear: 28_200_000, debtDueWithinYear: 2_200_000 };
        const listed = filedYears([row(items, 2_200_000)], true)!.years[0]!;
        expect(listed.financialDebt).toBeCloseTo(102.8, 1);
        expect(listed.bonds).toBeCloseTo(100.6, 1);
        expect(listed.bondsInOtherFinancialLiabilities).toBeCloseTo(100.6, 1);
        expect(listed.debtDueWithinYear).toBeCloseTo(30.4, 1);
        expect(filedYears([row(items, 2_200_000)], false)!.years[0]!.financialDebt).toBeCloseTo(2.2, 1);
        expect(filedYears([row({ ...items, debtBonds: 50_000_000 }, 52_200_000)], true)!.years[0]!.financialDebt).toBeCloseTo(52.2, 1);
    });
});

describe('debt due within a year, section total under its lines (Cognor FY2025 PDF)', () => {
    it('takes the lines above the total, up to the non-current total', () => {
        const lines = [
            line(0, 'Kapitał własny razem', 1118.5, 'equity'),
            line(1, 'Zobowiązania z tytułu kredytów, pożyczek oraz innych instrumentów dłużnych', 377.7, 'debtMixed'),
            line(2, 'Zobowiązania długoterminowe razem', 503.7, 'noncurrentLiabilities'),
            line(3, 'Kredyty w rachunku bieżącym', 9.6, 'debtBankLoans'),
            line(4, 'Zobowiązania z tytułu kredytów, pożyczek oraz innych instrumentów dłużnych', 407.8, 'debtMixed'),
            line(5, 'Zobowiązania z tytułu leasingu', 35.0, 'debtLeases'),
            line(6, 'Zobowiązania z tytułu dostaw i usług oraz pozostałe', 484.1, 'tradePayables'),
            line(7, 'Zobowiązania krótkoterminowe razem', 941.6, 'currentLiabilities'),
            line(8, 'Zobowiązania razem', 1445.3, 'totalLiabilities'),
        ];
        expect(itemTotals(lines, 'printed').debtDueWithinYear).toBeCloseTo(452.4, 1);
    });
});
