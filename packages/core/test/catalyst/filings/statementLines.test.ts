import { describe, expect, it } from 'vitest';
import { debtKind, isWriteDown, itemsFromFigures, itemTotals, lineChecks, type LineItem, type StatementLine } from "../../../src/catalyst/filings/statementLines.ts";

const line = (order: number, label: string, value: number, extra: Partial<StatementLine> = {}): StatementLine => ({ statement: 'balance', order, label, value, ...extra });

describe('debtKind', () => {
    it.each([
        ['Kredyty i pożyczki', false, 'debtBankLoans'],
        ['Obligacje', false, 'debtBonds'],
        ['Zobowiązania z tytułu leasingu', false, 'debtLeases'],
        ['Kredyty, pożyczki i obligacje', false, 'debtMixed'],
        ['ifrs-full:NoncurrentPortionOfNoncurrentBondsIssued Obligacje długoterminowe', true, 'debtBonds'],
        ['inne zobowiązania finansowe', false, 'debtOther'],
    ] as const)('%s → %s', (text, bond, kind) => expect(debtKind(text, bond)).toBe(kind));
});

describe('itemsFromFigures', () => {
    it('tags the lines a figure is made of, and leaves summed parts of a total alone', () => {
        const lines = [line(0, 'Przychody A', 10, { statement: 'income' }), line(1, 'Przychody B', 5, { statement: 'income' }), line(2, 'Zapasy', 7), line(3, 'Kredyty', 3)];
        itemsFromFigures(lines, {
            revenue: { value: 15, source: ['Przychody A', 'Przychody B'] },
            inventory: { value: 7, source: ['Zapasy'] },
            financialDebt: { value: 3, source: ['Kredyty'] },
        }, s => lines.find(l => l.label === s));
        expect(lines.map(l => l.item)).toEqual([undefined, undefined, 'inventory', 'debtBankLoans']);
    });
});

describe('lineChecks', () => {
    it('reports a total its lines do not add up to', () => {
        const lines = [line(0, 'Aktywa trwałe', 40, { parent: 2 }), line(1, 'Aktywa obrotowe', 50, { parent: 2 }), line(2, 'Aktywa razem', 100, { item: 'totalAssets' })];
        expect(lineChecks(lines, '2025-12-31', 1)).toEqual(['2025-12-31: the lines under "Aktywa razem" add up to 90, not 100']);
        expect(lineChecks(lines, '2025-12-31', 10)).toEqual([]);
    });
});

describe('write-downs', () => {
    const income = (label: string, code?: string) => ({ statement: 'income' as const, label, ...(code ? { code } : {}) });
    it.each([
        ['Odpis aktualizujący wartość firmy', 'ifrs-full:ImpairmentLossRecognisedInProfitOrLossGoodwill', true],
        ['Odpis z tytułu utraty wartości niefinansowych', 'ifrs-full:WritedownsReversalsOfPropertyPlantAndEquipment', true],
        ['Impairment of non-financial assets', undefined, true],
        ['Aktualizacja wartości aktywów niefinansowych', 'RZiSPor_H_II', true],
        ['Utrata wartości aktywów niematerialnych', 'ifrs-full:ImpairmentLossReversalOfImpairmentLossRecognisedInProfitOrLoss', true],
        ['(Strata) z tytułu utraty wartości należności handlowych', 'orlen:ImpairmentLossReversalOfImpairmentLossTradeReceivables', false],
        ['Net impairment losses on financial and contract assets', 'ifrs-full:ImpairmentLossImpairmentGainAndReversalOfImpairmentLossDeterminedInAccordanceWithIFRS9', false],
        ['Operating profit before amortisation and depreciation and impairment', 'ALE:OperatingProfitBeforeAmortisationAndDepreciationAndImpairment', false],
        ['Zysk z tytułu odwrócenia utraty wartości pożyczek', undefined, false],
        ['Odwrócenie odpisu z tytułu utraty wartości udziałów', undefined, false],
        ['Amortyzacja, utrata wartości i likwidacja', undefined, false],
    ])('%s: %s', (label, code, expected) => {
        expect(isWriteDown(income(label, code))).toBe(expected);
    });

    it('only in the income statement', () => {
        expect(isWriteDown({ statement: 'cashFlow', label: 'Odpis aktualizujący wartość firmy' })).toBe(false);
    });
});

describe('itemTotals', () => {
    const line = (statement: 'balance' | 'income' | 'cashFlow', order: number, item: LineItem | undefined, value: number, parent?: number): StatementLine =>
        ({ statement, order, label: String(order), value, ...(item ? { item } : {}), ...(parent !== undefined ? { parent } : {}) });

    it('sums each item, not counting a line under a subtotal of the same item, outflows positive', () => {
        const lines = [
            line('balance', 0, 'debtLeases', 100), line('balance', 1, 'debtLeases', 40),
            line('balance', 2, 'contractLiabilities', 300), line('balance', 3, 'contractLiabilities', 120, 2),
            line('cashFlow', 0, 'interestPaid', -44), line('cashFlow', 1, 'capex', -24), line('cashFlow', 2, undefined, 5),
            line('income', 0, 'impairment', -65),
        ];
        expect(itemTotals(lines, 'printed')).toEqual({ debtLeases: 140, contractLiabilities: 300, interestPaid: 44, capex: 24, impairment: 65 });
        // Tagged write-downs keep their sign: positive is a loss, negative a net reversal
        expect(itemTotals([line('income', 0, 'impairment', -12)], 'tagged')).toEqual({ impairment: -12 });
    });
});
