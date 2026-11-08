import { describe, expect, it } from 'vitest';
import { readFileSync } from "node:fs";
import path from "node:path";
import { UnsupportedFilingError } from "../../../src/catalyst/filings/filingParser.ts";
import { parseIfrsText } from "../../../src/catalyst/filings/ifrsTextParser.ts";

const html = readFileSync(path.join(import.meta.dirname, 'fixtures', 'ifrs-text-single.xhtml'), 'utf-8');

const figures = (filing: ReturnType<typeof parseIfrsText>, column: number) =>
    Object.fromEntries(Object.entries(filing.periods[column]!.figures).map(([k, v]) => [k, v!.value / 1000]));

describe('parseIfrsText', () => {
    const filing = parseIfrsText(html);

    it('reads the header: company, KRS number, scope, periods', () => {
        expect(filing).toMatchObject({ format: 'ifrs-text', scope: 'single', companyName: 'TESTOWA DEWELOPER S.A.', krs: '0000123456', currency: 'PLN', unitMultiplier: 1000, checks: [] });
        expect(filing.periods.map(p => [p.column, p.periodStart, p.periodEnd])).toEqual([
            ['current', '2025-01-01', '2025-12-31'],
            ['previous', '2024-01-01', '2024-12-31'],
        ]);
    });

    // Not from the table of contents, the running text, the comprehensive income statement or the notes.
    it('reads the statements by label, through dropped letters, notes, dashes and brackets', () => {
        expect(figures(filing, 0)).toEqual({
            totalAssets: 10_000, currentAssets: 9_500, inventory: 6_000, cash: 3_500, intangibleAssets: 200, equity: 4_000,
            currentLiabilities: 3_900, revenue: 5_000, ebit: 1_000, interestExpense: 120, netProfit: 700,
            depreciation: 60, operatingCashFlow: 900, capex: 80,
            financialDebt: 3_100, bonds: 2_500,
        });
        expect(figures(filing, 1)).toMatchObject({ operatingCashFlow: -200, financialDebt: 2_080, netProfit: 560 });
    });

    it('keeps every row of the statements as printed, with items where the figures use them', () => {
        expect(filing).toMatchObject({ standard: 'ifrs', presentedUnit: 1000, lineSigns: 'printed' });
        const lines = filing.periods[0]!.lines;
        expect(lines.slice(0, 3)).toEqual([
            { statement: 'balance', order: 0, label: 'Wartości niematerialne', value: 200_000, item: 'intangibleAssets' },
            { statement: 'balance', order: 1, label: 'Rzeczowe aktywa trwałe', value: 300_000 },
            { statement: 'balance', order: 2, label: 'AKTYWA TRWAŁE RAZEM', value: 500_000 },
        ]);
        expect(lines.find(l => l.label === 'Obligacje – czść krtkoterminowa')!.item).toBe('debtBonds');
        expect(lines.filter(l => l.item === 'totalEquityAndLiabilities')).toHaveLength(1);
        expect(new Set(lines.map(l => l.statement))).toEqual(new Set(['balance', 'income', 'cashFlow']));
    });

    it('takes borrowings, bonds and leases as debt, not interest payable or loans granted', () => {
        expect(filing.periods[0]!.figures.financialDebt!.source).toEqual([
            'balance/Obligacje – czść długoterminowa',
            'balance/Zobowiązania z tytułu leasingu - czść długoterminowa',
            'balance/Kredyty – czść krtkoterminowa',
            'balance/Obligacje – czść krtkoterminowa',
        ]);
    });

    it('flags a balance sheet that does not add up', () => {
        const broken = html.replace('<div class="t">KAPITAŁ WŁASNY I ZOBOWIĄZANIA RAZEM</div><div class="t">10 000</div>', '<div class="t">KAPITAŁ WŁASNY I ZOBOWIĄZANIA RAZEM</div><div class="t">10 500</div>');
        expect(parseIfrsText(broken).checks).toEqual(['2025-12-31: total assets 10,000,000 ≠ total equity and liabilities 10,500,000']);
    });

    it('reads an English statement with the older year first', () => {
        const english = `<html><body><table>
<tr><td>Consolidated statement of financial position</td></tr>
<tr><td>PLN thousand</td><td>31.12.2024</td><td>31.12.2025</td></tr>
<tr><td>Inventories</td><td>50</td><td>60</td></tr>
<tr><td>Total current assets</td><td>80</td><td>90</td></tr>
<tr><td>Total assets</td><td>100</td><td>120</td></tr>
<tr><td>Total equity</td><td>40</td><td>50</td></tr>
<tr><td>Bank loans and borrowings</td><td>30</td><td>35</td></tr>
<tr><td>Lease liabilities</td><td>5</td><td>5</td></tr>
<tr><td>Total current liabilities</td><td>25</td><td>30</td></tr>
<tr><td>Total equity and liabilities</td><td>100</td><td>120</td></tr>
<tr><td>Consolidated statement of profit or loss</td></tr>
<tr><td>Revenue</td><td>200</td><td>240</td></tr>
<tr><td>Operating profit</td><td>20</td><td>25</td></tr>
<tr><td>Net profit</td><td>15</td><td>18</td></tr>
</table></body></html>`;
        const parsed = parseIfrsText(english);
        expect(parsed.scope).toBe('group');
        expect(parsed.periods[0]!.periodEnd).toBe('2025-12-31');
        expect(figures(parsed, 0)).toMatchObject({ totalAssets: 120, equity: 50, financialDebt: 40, revenue: 240, ebit: 25, netProfit: 18, inventory: 60 });
        expect(parsed.krs).toBeUndefined();
    });

    it('refuses a document without a balance sheet', () => {
        expect(() => parseIfrsText('<html><body><p>Sprawozdanie zarządu</p></body></html>')).toThrow(UnsupportedFilingError);
    });
});
