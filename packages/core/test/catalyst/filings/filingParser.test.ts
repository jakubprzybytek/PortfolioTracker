import { describe, expect, it } from 'vitest';
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseFiling, UnsupportedFilingError } from "../../../src/catalyst/filings/filingParser.ts";

const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, 'fixtures', name), 'utf-8');
const values = (figures: object) => Object.fromEntries(Object.entries(figures).map(([k, v]) => [k, (v as { value: number }).value]));

describe('parseFiling', () => {
    describe('single company, comparative income statement, in złoty', () => {
        const filing = parseFiling(fixture('single-comparative-pln.xml'));

        it('reads the header and identity', () => {
            expect(filing).toMatchObject({
                scope: 'single',
                companyName: 'TESTOWA DEWELOPER S.A.',
                krs: '0000123456',
                nip: '5252123456',
                schema: 'SFJINZ (2) 2-0E',
                unitMultiplier: 1,
                preparedOn: '2026-03-20',
                incomeStatement: 'comparative',
                cashFlow: 'indirect',
                checks: [],
            });
        });

        it('keeps every statement line, with its label from the Ministry schema, parent and item', () => {
            const lines = filing.periods[0]!.lines;
            expect(filing).toMatchObject({ standard: 'pl-uor', presentedUnit: 1, lineSigns: 'tagged' });
            expect(lines[0]).toEqual({ statement: 'balance', order: 0, label: 'Aktywa razem', value: 1_000_000, code: 'Aktywa', item: 'totalAssets' });
            const bonds = lines.find(l => l.code === 'Pasywa_B_II_3_B')!;
            expect(bonds).toMatchObject({ label: 'z tytułu emisji dłużnych papierów wartościowych', value: 150_000, item: 'debtBonds' });
            expect(lines[bonds.parent!]!.code).toBe('Pasywa_B_II_3');
            expect(lines.find(l => l.code === 'Pasywa_B_III_3_E')).toMatchObject({ label: 'zaliczki otrzymane na dostawy i usługi', item: 'contractLiabilities' });
            expect(lines.filter(l => l.statement === 'income').map(l => l.item)).toEqual(['revenue', undefined, 'depreciation', 'ebit', 'financeCosts', 'interestExpense', 'netProfit']);
            expect(filing.periods[1]!.lines.find(l => l.code === 'Aktywa')!.value).toBe(900_000);
        });

        it('reads both columns as full fiscal years', () => {
            expect(filing.periods.map(p => [p.column, p.periodStart, p.periodEnd, p.months])).toEqual([
                ['current', '2025-01-01', '2025-12-31', 12],
                ['previous', '2024-01-01', '2024-12-31', 12],
            ]);
        });

        it('maps statement lines to figures', () => {
            expect(values(filing.periods[0]!.figures)).toEqual({
                revenue: 800000,
                ebit: 90000,
                depreciation: 10000,
                interestExpense: 24000,
                netProfit: 50000,
                totalAssets: 1000000,
                intangibleAssets: 20000,
                equity: 400000,
                // loans 70k + bonds 150k long-term; loans 20k + bonds 50k + other financial 5k short-term.
                // Trade payables, advances and related-party liabilities are left out.
                financialDebt: 295000,
                bonds: 200000,
                cash: 150000,
                currentAssets: 700000,
                inventory: 450000,
                currentLiabilities: 350000,
                operatingCashFlow: -30000,
                capex: 12000,
            });
            expect(values(filing.periods[1]!.figures)).toMatchObject({ revenue: 700000, financialDebt: 234000, bonds: 160000, cash: 120000 });
        });

        it('keeps the source lines of every figure', () => {
            expect(filing.periods[0]!.figures.financialDebt?.source).toEqual([
                'Bilans/Pasywa_B_II_3_A', 'Bilans/Pasywa_B_II_3_B', 'Bilans/Pasywa_B_II_3_C', 'Bilans/Pasywa_B_II_3_D',
                'Bilans/Pasywa_B_III_3_A', 'Bilans/Pasywa_B_III_3_B', 'Bilans/Pasywa_B_III_3_C', 'Bilans/Pasywa_B_III_3_F',
            ]);
            expect(filing.periods[0]!.figures.ebit?.source).toEqual(['RZiSPor/F']);
        });
    });

    describe('group, cost-of-sales income statement, in thousands', () => {
        const filing = parseFiling(fixture('group-costofsales-thousands.xml'));

        it('reads the header, with the KRS number found by pattern', () => {
            expect(filing).toMatchObject({
                scope: 'group',
                companyName: 'Grupa Testowa Sp. z o.o.',
                krs: '0000654321',
                unitMultiplier: 1000,
                incomeStatement: 'cost-of-sales',
                checks: [],
            });
        });

        it('handles a fiscal year that is not the calendar year', () => {
            expect(filing.periods.map(p => [p.periodStart, p.periodEnd, p.months])).toEqual([
                ['2024-04-01', '2025-03-31', 12],
                ['2023-04-01', '2024-03-31', 12],
            ]);
        });

        it('uses the group lines and converts thousands to PLN', () => {
            expect(values(filing.periods[0]!.figures)).toEqual({
                revenue: 6_000_000,
                ebit: 400_000,
                depreciation: 150_000,       // from the cash flow: the cost-of-sales variant has no depreciation line
                interestExpense: 100_000,
                netProfit: 200_000,           // W, after minority interests
                totalAssets: 5_000_000,
                intangibleAssets: 400_000,    // incl. goodwill of subsidiaries
                equity: 2_000_000,
                financialDebt: 1_450_000,     // bonds 1000 + loans 400 + bills 50
                bonds: 1_000_000,
                cash: 500_000,                // Aktywa_B_III_1_D in a group balance sheet
                currentAssets: 3_000_000,
                inventory: 800_000,
                currentLiabilities: 1_750_000,
                minorityInterests: 250_000,
                operatingCashFlow: 380_000,
                capex: 0,
            });
        });
    });

    it('reports a balance sheet that does not add up', () => {
        const xml = fixture('single-comparative-pln.xml').replace(
            '<jin:Pasywa><dtsf:KwotaA>1000000</dtsf:KwotaA>',
            '<jin:Pasywa><dtsf:KwotaA>1000500</dtsf:KwotaA>',
        );
        expect(parseFiling(xml).checks).toEqual([
            '2025-12-31: total assets 1,000,000 ≠ total equity and liabilities 1,000,500',
            '2025-12-31: the lines under "Pasywa razem" add up to 1,000,000, not 1,000,500',
        ]);
    });

    it('reports a net profit that differs between the statements', () => {
        const xml = fixture('single-comparative-pln.xml').replace(
            '<jin:L><dtsf:KwotaA>50000</dtsf:KwotaA>',
            '<jin:L><dtsf:KwotaA>52000</dtsf:KwotaA>',
        );
        expect(parseFiling(xml).checks).toEqual(['2025-12-31: net profit 52,000 in the income statement ≠ 50,000 in the balance sheet']);
    });

    it('marks a period that is not a full year', () => {
        const xml = fixture('single-comparative-pln.xml').replace('<dtsf:OkresOd>2025-01-01', '<dtsf:OkresOd>2025-07-01');
        expect(parseFiling(xml).periods[0]!.months).toBe(6);
    });

    it('reads a statement embedded base64 in a signature', () => {
        const signed = `<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:Object>${
            Buffer.from(fixture('single-comparative-pln.xml')).toString('base64')}</ds:Object></ds:Signature>`;
        expect(parseFiling(signed).krs).toBe('0000123456');
    });

    it('reads the statement block of a signature whose signature value comes first (Vehis Finanse)', () => {
        const noise = Buffer.from('x'.repeat(400)).toString('base64');
        const signed = `<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:SignatureValue>${noise}</ds:SignatureValue><ds:Object>${
            Buffer.from(fixture('single-comparative-pln.xml')).toString('base64')}</ds:Object></ds:Signature>`;
        expect(parseFiling(signed).krs).toBe('0000123456');
    });

    it('reads a root named by its unit, inside a document envelope (e-sprawozdania 2025, Vehis Finanse)', () => {
        const xml = fixture('single-comparative-pln.xml').replace(/tns:JednostkaInna\b/g, 'tns:JednostkaInnaWZlotych').replace(/^<\?xml[^>]*>/, '');
        const wrapped = `<?xml version="1.0"?><d:Dokument xmlns:d="http://crd.gov.pl/wzor/2025/08/04/13810/"><d:TrescDokumentu>${xml}</d:TrescDokumentu></d:Dokument>`;
        expect(parseFiling(wrapped)).toMatchObject({ krs: '0000123456', scope: 'single' });
    });

    it('reads a statement stored as it is inside a binary signature (CAdES)', () => {
        const binary = (n: number) => Buffer.from(Array.from({ length: n }, (_, i) => (i * 37 + 11) % 256)).toString('latin1');
        const signed = binary(40) + fixture('single-comparative-pln.xml') + binary(300);
        expect(parseFiling(signed).krs).toBe('0000123456');
    });

    it('reads a statement nested deeper than 100 elements', () => {
        const deep = '<a>'.repeat(150) + 'x' + '</a>'.repeat(150);
        const xml = fixture('single-comparative-pln.xml').replace('<tns:Naglowek>', `<tns:Extra>${deep}</tns:Extra><tns:Naglowek>`);
        expect(parseFiling(xml).krs).toBe('0000123456');
    });

    it('rejects structures it does not map', () => {
        expect(() => parseFiling('<JednostkaMala><Naglowek/></JednostkaMala>')).toThrow(UnsupportedFilingError);
        expect(() => parseFiling('<JednostkaMala><Naglowek/></JednostkaMala>')).toThrow(/JednostkaMala/);
        expect(() => parseFiling('<Faktura/>')).toThrow(/Not a financial statement/);
    });
});
