// A synthetic PDF report for tests (AiPdfExtractor, importFiling): its pages and the model's answer.
import type { Transcript } from "../../../../src/catalyst/filings/transcript.ts";
import type { PdfPage } from "../../../../src/catalyst/filings/pdfText.ts";

// A synthetic report: contents, the income statement, the balance sheet (two pages) and cash flows.
const filler = (n: number) => Array.from({ length: n }, (_, i) => `Other line ${i + 1} | ${i + 1},0 | ${i},0`);
export const reportPages: string[][] = [
    ['Testowa Group annual report', 'Statement of profit or loss ........ 2', 'Statement of financial position ........ 3', 'The company is entered in the KRS register under number 0000123456.'],
    ['Testowa Group', 'Consolidated statement of profit or loss', 'PLN million | 2025 | 2024', 'Revenue | 3 | 1 000,0 | 900,0', 'Depreciation | (50,0) | (45,0)',
        'Operating profit | 120,0 | 100,0', 'Finance costs | (30,0) | (25,0)', 'Net profit | 70,0 | 60,0', ...filler(8)],
    ['Testowa Group', 'Consolidated statement of financial position', 'PLN million | 31.12.2025 | 31.12.2024', 'Non-current assets | 1 200,0 | 1 100,0',
        'Inventories | 500,0 | 450,0', 'Cash and cash equivalents | 300,0 | 250,0', 'Current assets | 800,0 | 700,0', 'Total assets | 2 000,0 | 1 800,0', ...filler(8)],
    ['Equity | 900,0 | 850,0', 'Bonds | 400,0 | 300,0', 'Bank loans | 200,0 | 150,0', 'Lease liabilities | 50,0 | 40,0', 'Trade payables | 450,0 | 460,0',
        'Total equity and liabilities | 2 000,0 | 1 800,0'],
    ['Testowa Group', 'Consolidated statement of cash flows', 'PLN million | 2025 | 2024', 'Net cash from operating activities | 150,0 | (20,0)',
        'Purchase of property, plant and equipment | (80,0) | (60,0)', ...filler(10)],
];
export const asPages = (pages: string[][]): PdfPage[] => pages.map((lines, i) => ({ page: i + 1, lines }));

const line = (statement: Transcript['lines'][number]['statement'], page: number, label: string, field: Transcript['lines'][number]['field'], a: string, b: string) =>
    ({ statement, page, label, field, values: [{ column: 'c', printed: a }, { column: 'p', printed: b }] });

// What the model returns for the report above
export const transcript: Transcript = {
    companyName: 'Testowa Group', scope: 'group', currency: 'PLN', unit: 1000000,
    columns: [{ id: 'c', periodStart: '2025-01-01', periodEnd: '2025-12-31' }, { id: 'p', periodEnd: '2024-12-31' }],
    lines: [
        line('income', 2, 'Revenue', 'revenue', '1 000,0', '900,0'),
        line('income', 2, 'Depreciation', 'depreciation', '(50,0)', '(45,0)'),
        line('income', 2, 'Operating profit', 'ebit', '120,0', '100,0'),
        line('income', 2, 'Finance costs', 'financeCosts', '(30,0)', '(25,0)'),
        line('income', 2, 'Net profit', 'netProfit', '70,0', '60,0'),
        line('balance', 3, 'Inventories', 'inventory', '500,0', '450,0'),
        line('balance', 3, 'Cash and cash equivalents', 'cash', '300,0', '250,0'),
        line('balance', 3, 'Current assets', 'currentAssets', '800,0', '700,0'),
        line('balance', 3, 'Total assets', 'totalAssets', '2 000,0', '1 800,0'),
        line('balance', 4, 'Equity', 'equity', '900,0', '850,0'),
        line('balance', 4, 'Bonds', 'debtBonds', '400,0', '300,0'),
        line('balance', 4, 'Bank loans', 'debtBankLoans', '200,0', '150,0'),
        line('balance', 4, 'Lease liabilities', 'debtLeases', '50,0', '40,0'),
        line('balance', 4, 'Trade payables', 'other', '450,0', '460,0'),
        line('balance', 4, 'Total equity and liabilities', 'totalEquityAndLiabilities', '2 000,0', '1 800,0'),
        line('cashFlow', 5, 'Net cash from operating activities', 'operatingCashFlow', '150,0', '(20,0)'),
        line('cashFlow', 5, 'Purchase of property, plant and equipment', 'capex', '(80,0)', '(60,0)'),
    ],
};

