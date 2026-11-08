import { describe, expect, it } from 'vitest';
import { filingFromTranscript, findKrs, findLei, findStatementPages, isoDate, numberStyle, parsePrinted, statementsPrompt, transcriptToFiling, type Transcript } from "../../../src/catalyst/filings/transcript.ts";
import { isPdf, readPdfPages } from "../../../src/catalyst/filings/pdfText.ts";
import { makePdf } from "./fixtures/makePdf.ts";
import { asPages, reportPages, transcript } from "./fixtures/pdfReport.ts";

const EXTRACTION = { model: 'test-model', promptVersion: 'test', pages: [2, 3, 4, 5] };
const millions = (filing: ReturnType<typeof transcriptToFiling>, column: number) =>
    Object.fromEntries(Object.entries(filing.periods[column]!.figures).map(([k, v]) => [k, v!.value / 1e6]));

describe('parsePrinted', () => {
    it.each([['1 000,0', 1000], ['(1 792,2)', -1792.2], ['-', 0], ['', 0], ['–', 0], ['-35,3', -35.3], ['12', 12], ['n/a', undefined], ['2025-12', undefined]])('%s → %s', (printed, value) => {
        expect(parsePrinted(printed)).toBe(value);
    });
    it.each([['4,523,463', 4523463], ['(175,803)', -175803], ['1,234.5', 1234.5], ['–', 0], ['12', 12], ['1 234,5', undefined]])('English %s → %s', (printed, value) => {
        expect(parsePrinted(printed, 'en')).toBe(value);
    });
});

describe('numberStyle', () => {
    it('tells English amounts from Polish ones', () => {
        expect(numberStyle(['4,523,463', '(175,803)', '–', '12'])).toBe('en');
        expect(numberStyle(['1 000,0', '(1 792,2)', '-', '35,3'])).toBe('pl');
        expect(numberStyle(['7 001 511', '5 447 865', '9 220'])).toBe('pl');
        expect(numberStyle(['1.792,2', '1.000'])).toBe('pl');
    });
});

describe('isoDate', () => {
    it.each([['2025-12-31', '2025-12-31'], ['31.12.2025', '2025-12-31'], ['30 September 2025', '2025-09-30'], ['1.01.2025', '2025-01-01'], ['2025-13-45', undefined], ['grudzień 2025', undefined], [undefined, undefined]])('%s → %s', (printed, iso) => {
        expect(isoDate(printed)).toBe(iso);
    });
});

describe('identifiers in the text', () => {
    const page = (...lines: string[]) => [{ page: 1, lines }];
    it.each([
        ['wpisana do Krajowego Rejestru Sądowego pod numerem 0000123456', '0000123456'],
        ['Krajowego Rejestru Sądowego, numer rejestru KRS 23302, na terenie', '0000023302'],
        ['KRS: 0000217207', '0000217207'],
        ['no number here', undefined],
    ])('KRS in "%s"', (text, krs) => expect(findKrs(page(text))).toBe(krs));
    it('finds a LEI next to its label', () => {
        expect(findLei(page('6920000013 | (NIP) | G30CO71KTT9JDYJESN22 | (LEI)'))).toBe('G30CO71KTT9JDYJESN22');
        expect(findLei(page('LEI: 259400EM1ITR201TTX36'))).toBe('259400EM1ITR201TTX36');
        expect(findLei(page('REGON 390021764'))).toBeUndefined();
    });
});

describe('findStatementPages', () => {
    it('takes each statement page and the next one, not the contents', () => {
        expect(findStatementPages(asPages(reportPages))).toEqual([2, 3, 4, 5]);
    });

    it('finds headings with words in between, over two lines, and the comprehensive income statement', () => {
        const table = Array.from({ length: 14 }, (_, i) => `Pozycja ${i} | 1 000 | 2 000`);
        const pages = [
            { page: 1, lines: ['Wstęp', 'tekst'] },
            { page: 2, lines: ['MARVIPOL \\ RAPORT ROCZNY | 66', 'SKONSOLIDOWANY RACHUNEK ZYSKÓW LUB STRAT', ...table] },
            { page: 3, lines: ['MARVIPOL \\ RAPORT ROCZNY | 68', 'SKONSOLIDOWANE ROCZNE SPRAWOZDANIE', 'Z SYTUACJI FINANSOWEJ (TYS. PLN)', ...table] },
            { page: 4, lines: ['MARVIPOL \\ RAPORT ROCZNY | 71', 'SKONSOLIDOWANE ROCZNE SPRAWOZDANIE', 'Z PRZEPŁYWÓW PIENIĘŻNYCH (TYS. PLN)', ...table] },
        ];
        expect(findStatementPages(pages)).toEqual([2, 3, 4]);
    });

    it('finds Hungarian headings (MOL)', () => {
        const table = Array.from({ length: 14 }, (_, i) => `Tétel ${i} | 1.000 | 2.000`);
        const pages = [
            { page: 1, lines: ['Konszolidált pénzügyi kimutatások 2025 | 209', 'A KONSZOLIDÁLT', 'EREDMÉNYKIMUTATÁS', ...table] },
            { page: 3, lines: ['Konszolidált pénzügyi kimutatások 2025 | 211', 'A KONSZOLIDÁLT PÉNZÜGYI', 'HELYZETRE VONATKOZÓ', 'KIMUTATÁS', ...table] },
            { page: 5, lines: ['Konszolidált pénzügyi kimutatások 2025 | 213', 'A KONSZOLIDÁLT CASH FLOW-RA VONATKOZÓ KIMUTATÁS', ...table] },
            { page: 6, lines: ['Megjegyzések'] },
        ];
        expect(findStatementPages(pages)).toEqual([1, 3, 5, 6]);
    });

    it('skips a narrative page with numbers in its prose', () => {
        const prose = Array.from({ length: 20 }, (_, i) => `up ${i}% on FY24 (6.2 Euro cents), subject to approval of ${i + 1} shareholders`);
        expect(findStatementPages([{ page: 1, lines: ['Financial review', 'balance sheet strength', ...prose] }])).toEqual([]);
    });

    it('skips a table of contents without dot leaders', () => {
        const table = Array.from({ length: 14 }, (_, i) => `Pozycja ${i} | 1 000 | 2 000`);
        const contents = (page: number, title: string[]) => ({ page, lines: [...title, ...Array.from({ length: 14 }, (_, i) => `NOTA ${i} Opis noty | ${10 + i}`)] });
        const pages = [
            contents(1, ['Spis treści', '1.1 | Skonsolidowany rachunek zysków i strat | 7', '1.2 | Skonsolidowane sprawozdanie z sytuacji finansowej | 8']),
            contents(2, ['NOTA 11 Podatek | 66']),
            { page: 7, lines: ['Skonsolidowany rachunek zysków i strat [tys. PLN]', ...table] },
            { page: 8, lines: ['Skonsolidowane sprawozdanie', 'z sytuacji finansowej [tys. PLN]', ...table] },
        ];
        expect(findStatementPages(pages)).toEqual([7, 8]);
        expect(findStatementPages([{ page: 3, lines: ['(PLN thousand)', 'Consolidated profit and loss account', ...table] }])).toEqual([3]);
    });
});

describe('findStatementPages: headings seen in 2026 half-year reports', () => {
    const table = (n: number) => Array.from({ length: 14 }, (_, i) => `Pozycja ${n}.${i} | ${i + 1} 234 | ${i + 2} 345`);
    it('a section number between the lines of a heading (Archicom)', () => {
        const pages = [
            { page: 4, lines: ['Skonsolidowane sprawozdanie', '1.', 'z sytuacji finansowej', '1', ...table(4)] },
            { page: 11, lines: ['Skonsolidowane sprawozdanie', '5. | z przepływów pieniężnych', '5', ...table(11)] },
        ];
        expect(findStatementPages(pages)).toEqual([4, 11]);
    });
    it('"sprawozdanie z zysków lub strat" (Vindexus)', () => {
        const pages = [{ page: 53, lines: ['1. Śródroczne skrócone skonsolidowane sprawozdanie z zysków lub strat i innych całkowitych', 'dochodów', ...table(53)] }];
        expect(findStatementPages(pages)).toEqual([53]);
    });
    it('not a segment note laid out like the statements (Echo)', () => {
        const pages = [
            { page: 18, lines: ['Segmenty Grupy', '1.5', 'Skonsolidowane sprawozdanie z sytuacji finansowej', '– struktura segmentowa', ...table(18)] },
            { page: 22, lines: ['Skonsolidowany rachunek zysków i strat', '– struktura segmentowa', ...table(22)] },
            { page: 86, lines: ['Skrócony śródroczny skonsolidowany', 'rachunek zysków i strat [tys. PLN]', ...table(86)] },
            { page: 87, lines: ['Skrócone śródroczne skonsolidowane', 'sprawozdanie z sytuacji finansowej [tys. PLN]', ...table(87)] },
        ];
        expect(findStatementPages(pages)).toEqual([86, 87]);
    });
});

describe('findStatementPages over three pages', () => {
    it('takes a statement whose heading is printed again two pages on (assets on two pages, then equity and liabilities)', () => {
        const table = (n: number) => Array.from({ length: 14 }, (_, i) => `Pozycja ${n}.${i} | ${i + 1} 234,56 | ${i + 2} 345,67`);
        const page = (n: number, heading: string) => ({ page: n, lines: [heading, ...table(n)] });
        const pages = [page(11, 'Wprowadzenie'), page(12, 'Skonsolidowany bilans'), page(13, 'Okres zakończony'), page(14, 'Skonsolidowany bilans'), page(15, 'Notes'), page(30, 'Skonsolidowany bilans')];
        expect(findStatementPages(pages)).toEqual([12, 13, 14, 15]);
    });
});

describe('transcriptToFiling', () => {
    const pages = asPages(reportPages);

    it('turns the printed lines into figures, with their sources', () => {
        const filing = transcriptToFiling(transcript, pages, EXTRACTION);
        expect(filing).toMatchObject({ format: 'ai-pdf', scope: 'group', companyName: 'Testowa Group', krs: '0000123456', currency: 'PLN', checks: [], extraction: EXTRACTION });
        expect(filing.periods.map(p => [p.column, p.periodStart, p.periodEnd, p.months])).toEqual([['current', '2025-01-01', '2025-12-31', 12], ['previous', '2024-01-01', '2024-12-31', 12]]);
        expect(millions(filing, 0)).toEqual({
            revenue: 1000, ebit: 120, depreciation: 50, interestExpense: 30, netProfit: 70, totalAssets: 2000, equity: 900,
            financialDebt: 650, bonds: 400, cash: 300, currentAssets: 800, inventory: 500, operatingCashFlow: 150, capex: 80,
        });
        expect(millions(filing, 1)).toMatchObject({ operatingCashFlow: -20, financialDebt: 490 });
        expect(filing.periods[0]!.figures.financialDebt!.source).toEqual(['p. 4/Bank loans', 'p. 4/Bonds', 'p. 4/Lease liabilities']);
    });

    it('keeps every printed line per year, in units, with the model\'s item', () => {
        const filing = transcriptToFiling(transcript, pages, EXTRACTION);
        expect(filing).toMatchObject({ standard: 'ifrs', presentedUnit: 1000000, lineSigns: 'printed' });
        const lines = filing.periods[0]!.lines;
        expect(lines.length).toBe(transcript.lines.filter(l => l.values.some(v => v.column === transcript.columns[0]!.id)).length);
        expect(lines.find(l => l.label === 'Bonds')).toMatchObject({ statement: 'balance', page: 4, value: 400_000_000, item: 'debtBonds' });
        expect(lines.filter(l => l.statement === 'balance').map(l => l.order)).toEqual(lines.filter(l => l.statement === 'balance').map((_, i) => i));
        expect(lines.some(l => (l.item as string) === 'other')).toBe(false);
    });

    it('rejects an amount that is not on the cited page', () => {
        const wrong = structuredClone(transcript);
        wrong.lines[4]!.values[0]!.printed = '75,0';
        expect(transcriptToFiling(wrong, pages, EXTRACTION).checks).toEqual(['p. 2 "Net profit": 75,0 isn\'t on that page']);
    });

    it('flags a balance sheet that does not add up, and missing totals', () => {
        const wrong = structuredClone(transcript);
        wrong.lines[8]!.values[0]!.printed = '1 800,0';    // is on the page, in the other column
        wrong.lines = wrong.lines.filter(l => l.field !== 'equity');
        expect(transcriptToFiling(wrong, pages, EXTRACTION).checks).toEqual([
            '2025-12-31: total assets 1,800,000,000 ≠ total equity and liabilities 2,000,000,000',
            '2025-12-31: no total equity',
            '2024-12-31 (comparative): no total equity',
        ]);
    });

    it('an interim report: a comparative column with flows only passes; one of other months is refused', () => {
        // The same report read as a half-year: H1 2025 against H1 2024, the comparative without its balance sheet.
        const h1 = structuredClone(transcript);
        h1.columns = [{ id: h1.columns[0]!.id, periodStart: '2025-01-01', periodEnd: '2025-06-30' }, { id: h1.columns[1]!.id, periodStart: '2024-01-01', periodEnd: '2024-06-30' }];
        for (const l of h1.lines) if (l.statement === 'balance') l.values = l.values.filter(v => v.column === h1.columns[0]!.id);
        const filing = transcriptToFiling(h1, pages, EXTRACTION);
        expect(filing.checks).toEqual([]);
        expect(filing.periods.map(p => [p.periodEnd, p.months])).toEqual([['2025-06-30', 6], ['2024-06-30', 6]]);
        expect(filing.periods[1]!.figures.totalAssets).toBeUndefined();
        expect(filing.notes).toContain('2024-06-30 (comparative): income statement and cash flows only');
        // A half-year against a full year (no periodStart given for the comparative): refused.
        const mixed = structuredClone(h1);
        mixed.columns[1] = { id: mixed.columns[1]!.id, periodEnd: '2024-12-31' };
        expect(transcriptToFiling(mixed, pages, EXTRACTION).checks.join()).toContain("an interim's comparative is the same months a year earlier");
    });

    it('adds up revenue printed in segments, and takes the total of a breakdown', () => {
        const withParts = (parts: [string, string][], at: number[]) => {
            const ps = structuredClone(reportPages);
            const t = structuredClone(transcript);
            parts.forEach(([label, amount], k) => {
                ps[1]!.splice(4 + k, 0, `${label} | ${amount} | 1,0`);
                t.lines.splice(at[k]!, 0, { statement: 'income', page: 2, label, field: 'revenue', values: [{ column: 'c', printed: amount }] });
            });
            return transcriptToFiling(t, asPages(ps), EXTRACTION).periods[0]!.figures.revenue!.value / 1e6;
        };
        // A total and the lines under it ("of which"): the total.
        expect(withParts([['of which flats', '600,0'], ['of which rent', '400,0']], [1, 2])).toBe(1000);
        // Segments apart from each other, each followed by its costs: the sum.
        expect(withParts([['Rental income', '250,0']], [2])).toBe(1250);
    });

    it('says when combined financing lines hide the bonds', () => {
        const mixed = structuredClone(transcript);
        mixed.lines[10]!.field = 'debtMixed';
        const filing = transcriptToFiling(mixed, pages, EXTRACTION);
        expect(filing.periods[0]!.figures.bonds).toBeUndefined();
        expect(filing.periods[0]!.figures.financialDebt!.value).toBe(650_000_000);
        expect(filing.notes).toContain('Debt: the balance sheet has combined financing lines (e.g. "financial liabilities"), so bonds aren\'t split out');
    });
});

describe('transcriptToFiling with English amounts', () => {
    it('reads "4,523,463" as thousands, and checks a UK-style balance sheet (net assets) against equity + liabilities', () => {
        const en: Transcript = {
            companyName: 'Test N.V.', scope: 'group', currency: 'EUR', unit: 1000,
            columns: [{ id: 'a', periodEnd: '2025-09-30' }, { id: 'b', periodEnd: '2024-09-30' }],
            lines: [
                ['income', 'Revenue', 'revenue', '4,523,463', '4,160,416'],
                ['income', 'Loss for the year', 'netProfit', '(175,803)', '(734,230)'],
                ['balance', 'Total assets', 'totalAssets', '3,512,004', '3,900,111'],
                ['balance', 'Total equity', 'equity', '236,368', '441,251'],
                ['balance', 'Tax receivable', 'currentAssets', '20', '253'],
                ['balance', 'Current assets total', 'currentAssets', '1,436,142', '1,673,425'],
                ['balance', 'Total liabilities', 'totalLiabilities', '3,275,636', '3,458,860'],
                ['cashFlow', 'Depreciation, amortisation and impairment', 'depreciation', '219,137', '143,572'],
                ['cashFlow', 'Right-of-use asset depreciation', 'depreciation', '301,301', '271,440'],
            ].map(([statement, label, field, a, b]) => ({ statement: statement as 'income', page: 1, label: label!, field: field as 'revenue', values: [{ column: 'a', printed: a! }, { column: 'b', printed: b! }] })),
        };
        const pages = [{ page: 1, lines: en.lines.map(l => `${l.label} | ${l.values.map(v => v.printed).join(' | ')}`) }];
        const filing = transcriptToFiling(en, pages, EXTRACTION);
        expect(filing.checks).toEqual([]);
        expect(filing.periods[0]).toMatchObject({ periodStart: '2024-10-01', periodEnd: '2025-09-30', months: 12 });
        expect(filing.periods[0]!.figures.revenue!.value).toBe(4_523_463_000);
        expect(filing.periods[0]!.figures.netProfit!.value).toBe(-175_803_000);
        expect(filing.periods[0]!.figures.currentAssets!.value).toBe(1_436_142_000);
        expect(filing.periods[0]!.figures.depreciation!.value).toBe(520_438_000);
        expect(filing.notes).toContain('Amounts printed in English number format (1,234.5)');
    });
});

describe('a PDF from its transcript', () => {
    it('reads the PDF text, finds the statement pages and checks the transcript against them', async () => {
        const pdf = makePdf(reportPages);
        expect(isPdf(pdf)).toBe(true);
        const pages = await readPdfPages(pdf);
        expect(pages[1]!.lines.slice(1, 4)).toEqual(['Consolidated statement of profit or loss', 'PLN million | 2025 | 2024', 'Revenue | 3 | 1 000,0 | 900,0']);
        expect(findKrs(pages)).toBe('0000123456');
        expect(statementsPrompt(pages, findStatementPages(pages))).toContain('=== Page 2 ===');
        expect(statementsPrompt(pages, findStatementPages(pages))).not.toContain('=== Page 1 ===');
        const filing = filingFromTranscript(pages, transcript, 'test-agent');
        expect(filing.checks).toEqual([]);
        expect(filing.extraction).toMatchObject({ model: 'test-agent', pages: [2, 3, 4, 5] });
    });
});
