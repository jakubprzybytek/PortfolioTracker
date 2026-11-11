import { describe, expect, it } from 'vitest';
import { amountOwed, instalmentsAhead, latestReport, refinancing, refinancingDimension, type ListedBond } from "../../../src/catalyst/issuers/refinancing.ts";
import { nbpRates, parseNbpTable } from "../../../src/catalyst/issuers/nbp.ts";
import type { DbIssuerFinancialsRecord } from "../../../src/catalyst/issuers/financialsRecord.ts";

const M = 1_000_000;
const TODAY = '2026-11-03';

const report = (figures: Record<string, number>, over: Partial<DbIssuerFinancialsRecord> = {}): DbIssuerFinancialsRecord => ({
    entityId: '0000000001', period: '2025-12-31#group', issuerName: 'X', companyName: 'X', scope: 'group',
    periodStart: '2025-01-01', periodEnd: '2025-12-31', months: 12, currency: 'PLN', column: 'current',
    figures: Object.fromEntries(Object.entries(figures).map(([k, v]) => [k, { value: v * M, source: [] }])),
    filing: { key: 'k', sha256: 's', format: 'esef', schema: 'x', checks: [] }, importedAt: '2026-01-01T00:00:00Z',
    ...over,
}) as DbIssuerFinancialsRecord;
const bond = (name: string, maturityDay: string, millions: number, currency = 'PLN', isin = `PL${name}`): ListedBond =>
    ({ isin, name, currency, issueValue: millions * M, maturityDay });

// Atal on 2026-11-03: 130 m due in 12 months, 430 m in 24, cash 146 m, operating cash flow −657 m
const ATAL = [bond('ATA0327', '2027-03-15', 130), bond('ATA0628', '2028-06-20', 300), bond('ATA1029', '2029-10-01', 260)];

describe('refinancing', () => {
    it("compares bonds due with cash and operating cash flow, red when they don't cover", () => {
        const r = refinancing(ATAL, report({ cash: 146, operatingCashFlow: -657 }), TODAY, {});
        expect(r.report).toMatchObject({ due12: 130 * M, due24: 430 * M, listed: 690 * M });
        expect(r.report!.cashCover12).toBeCloseTo(146 / 130);
        expect(r.report!.liquidityCover24).toBeCloseTo((146 - 2 * 657) / 430);
        expect(r.signal).toBe('red');
    });

    it('is green when nothing is due within 24 months, and yellow in between', () => {
        expect(refinancing([bond('A', '2030-01-01', 500)], report({ cash: 10, operatingCashFlow: 5 }), TODAY, {}).signal).toBe('green');
        // Murapol: 150 due in 12 months, 250 in 24; cash 278, operating cash flow 311
        const murapol = [bond('M1', '2027-06-01', 150), bond('M2', '2028-05-01', 100)];
        const r = refinancing(murapol, report({ cash: 278, operatingCashFlow: 311 }), TODAY, {});
        expect(r.report!.cashCover12).toBeCloseTo(1.85);
        expect(r.signal).toBe('green');
        expect(refinancing(murapol, report({ cash: 200, operatingCashFlow: 0 }), TODAY, {}).signal).toBe('yellow');
    });

    it('counts a bond listed on two markets once, and leaves out bonds already matured', () => {
        const r = refinancing([bond('A', '2027-01-01', 100), bond('A', '2027-01-01', 100), bond('OLD', '2026-10-01', 50)], report({ cash: 1000 }), TODAY, {});
        expect(r.bonds.map(b => b.name)).toEqual(['A']);
        expect(r.report!.due12).toBe(100 * M);
    });

    it("converts other currencies into the report's at NBP rates, or leaves them out with a note", () => {
        const bonds = [bond('E', '2027-02-01', 10, 'EUR'), bond('P', '2027-03-01', 100)];
        const r = refinancing(bonds, report({ cash: 500 }), TODAY, { EUR: 4.4233 });
        expect(r.report!.due12).toBeCloseTo(144.233 * M);
        // Pepco reports in EUR, its bonds are in PLN
        const pepco = refinancing([bond('P', '2027-03-01', 442.33)], report({ cash: 464 }, { currency: 'EUR' }), TODAY, { EUR: 4.4233 });
        expect(pepco.report!.due12).toBeCloseTo(100 * M);
        const none = refinancing(bonds, report({ cash: 500 }), TODAY, {});
        expect(none.report!.due12).toBe(100 * M);
        expect(none.notes[0]).toBe('no exchange rate for EUR: those bonds are left out of the totals');
    });

    it('says when listed bonds differ from the balance sheet, and gives no signal without cash', () => {
        const r = refinancing([bond('C', '2031-01-01', 2670)], report({ cash: 3183, bonds: 4020 }), TODAY, {});
        expect(r.notes).toContain('listed bonds 2,670 m vs 4,020 m of bonds in the balance sheet');
        expect(refinancing(ATAL, report({}), TODAY, {}).signal).toBe('na');
    });

    it('without a report, gives the schedule alone', () => {
        const r = refinancing(ATAL, undefined, TODAY, {});
        expect(r).toMatchObject({ signal: 'na', bonds: [{ name: 'ATA0327' }, { name: 'ATA0628' }, { name: 'ATA1029' }] });
        expect(r.report).toBeUndefined();
        expect(refinancingDimension(r)).toBeUndefined();
    });

    it('makes a scorecard dimension', () => {
        const d = refinancingDimension(refinancing(ATAL, report({ cash: 146, operatingCashFlow: -657 }), TODAY, {}))!;
        expect(d.name).toBe('Refinancing');
        expect(d.signal).toBe('red');
        expect(d.metrics.map(m => `${m.name}: ${m.formattedValue}`)).toEqual([
            'Bonds due in 12 months: 130 m PLN',
            'Bonds due in 24 months: 430 m PLN',
            'Cash cover, 12 months: 1.12×',
            'Cash + operating cash flow cover, 24 months: -2.72×',
        ]);
        expect(d.notes).toContain('cash from the report at 2025-12-31; bonds due counted from 2026-11-03');
    });
});

describe('amountOwed', () => {
    it('counts a bond repaid in instalments at its current nominal (Kruk KRU0228: 1,000 → 550)', () => {
        expect(amountOwed(350 * M, 550, 1000)).toEqual({ owed: 192.5 * M, issued: 350 * M });
    });

    it('follows an indexed nominal up, with no instalments (IZ0836)', () => {
        expect(amountOwed(1000 * M, 1109.02, 1023.34)).toEqual({ owed: 1000 * M * 1109.02 / 1023.34 });
    });

    it('keeps the issue value when the nominal is unchanged or the issue-day nominal unknown', () => {
        expect(amountOwed(100 * M, 1000, 1000)).toEqual({ owed: 100 * M });
        expect(amountOwed(100 * M, 550, undefined)).toEqual({ owed: 100 * M });
    });

    it('in refinancing, counts what is owed and says which bonds are repaid in instalments', () => {
        const kru = { ...bond('KRU0228', '2028-02-10', 192.5), issued: 350 * M };
        const r = refinancing([kru], report({ cash: 213, operatingCashFlow: 293 }), TODAY, {});
        expect(r.report!.due24).toBe(192.5 * M);
        expect(r.bonds[0]).toMatchObject({ amount: 192.5 * M, issued: 350 * M });
        expect(r.notes).toContain("KRU0228: repaid in instalments, the amount still owed is counted at maturity (the dates of later instalments aren't known)");
    });
});

describe('latestReport', () => {
    it('takes the latest full year of group accounts when there are any', () => {
        const rows = [
            report({}, { periodEnd: '2025-12-31', scope: 'single' }),
            report({}, { periodEnd: '2024-12-31', scope: 'group' }),
            report({}, { periodEnd: '2026-06-30', scope: 'group', months: 6 }),
        ];
        expect(latestReport(rows)).toMatchObject({ periodEnd: '2024-12-31', scope: 'group' });
    });
});

describe('nbpRates', () => {
    const TABLE = [{ table: 'A', effectiveDate: '2026-11-03', rates: [{ code: 'EUR', mid: 4.4233 }, { code: 'HUF', mid: 0.012123 }] }];

    it('reads table A, once a day', async () => {
        expect(parseNbpTable(TABLE)).toEqual({ EUR: 4.4233, HUF: 0.012123 });
        let calls = 0;
        let t = 0;
        const rates = nbpRates(async () => { calls++; return TABLE; }, () => t);
        await rates();
        t = 60 * 60 * 1000;
        expect(await rates()).toEqual({ EUR: 4.4233, HUF: 0.012123 });
        expect(calls).toBe(1);
        t = 25 * 60 * 60 * 1000;
        await rates();
        expect(calls).toBe(2);
    });

    it('gives no rates when NBP fails', async () => {
        expect(await nbpRates(async () => { throw new Error('down'); })()).toEqual({});
    });
});

describe('instalments', () => {
    // Corpus Iuris GCI0729: 33 m at 1,000, cut to 800 on 2027-07-30 and to 600 on 2028-07-30, the rest on 2029-07-30
    const SCHEDULE = [{ date: '2027-07-30', nominalAfter: 800 }, { date: '2028-07-30', nominalAfter: 600 }];

    it('turns a schedule of nominals into the instalments still ahead', () => {
        expect(instalmentsAhead(33 * M, 1000, 1000, SCHEDULE)).toEqual([{ date: '2027-07-30', amount: 6.6 * M }, { date: '2028-07-30', amount: 6.6 * M }]);
        // After the first instalment the bond is at 800: only the second is ahead
        expect(instalmentsAhead(33 * M, 1000, 800, SCHEDULE)).toEqual([{ date: '2028-07-30', amount: 6.6 * M }]);
        expect(instalmentsAhead(33 * M, 1000, 1000, [])).toEqual([]);
    });

    it('counts instalments on their dates in the 12 and 24 month windows, the rest at maturity', () => {
        const gci = { ...bond('GCI0729', '2029-07-30', 33), instalments: instalmentsAhead(33 * M, 1000, 1000, SCHEDULE) };
        const gc1 = { ...bond('GC10729', '2029-07-30', 35), instalments: instalmentsAhead(35 * M, 1000, 1000, SCHEDULE) };
        const r = refinancing([gci, gc1], report({ cash: 34, operatingCashFlow: 2 }), '2026-11-11', {});
        expect(r.report!.due12).toBeCloseTo(13.6 * M);
        expect(r.report!.due24).toBeCloseTo(27.2 * M);
        expect(r.report!.cashCover12).toBeCloseTo(34 / 13.6);
        // (34 + 2 × 2) / 27.2 = 1.40: yellow, where counting everything at maturity gave "nothing due", green
        expect(r.report!.liquidityCover24).toBeCloseTo(38 / 27.2);
        expect(r.signal).toBe('yellow');
        expect(r.bonds[0]!.payments!.map(p => [p.date, p.amount / M])).toEqual([['2027-07-30', 7], ['2028-07-30', 7], ['2029-07-30', 21]]);
        expect(r.notes).toContain('GC10729 (7 m on 2027-07-30, 7 m on 2028-07-30); GCI0729 (6.6 m on 2027-07-30, 6.6 m on 2028-07-30): instalments counted on their dates, from the terms of issue');
        expect(refinancing([bond('GCI0729', '2029-07-30', 33), bond('GC10729', '2029-07-30', 35)], report({ cash: 34, operatingCashFlow: 2 }), '2026-11-11', {}).signal).toBe('green');
    });

    it('a bullet bond (empty schedule) has no payments and no note about unknown instalments', () => {
        const r = refinancing([{ ...bond('B', '2030-01-01', 50), instalments: [] }], report({ cash: 10 }), TODAY, {});
        expect(r.bonds[0]!.payments).toBeUndefined();
        expect(r.notes.join(' ')).not.toMatch(/counted at maturity|counted on their dates/);
    });
});
