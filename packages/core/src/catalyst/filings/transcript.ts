// Ported from CatalystViewer (packages/core/src/bonds/fundamentals/filings/AiPdfExtractor.ts, 7e8a24c) for the Catalyst module's
// phase 2 (Docs/catalyst-phase2-plan.md, N3): functionality kept, imports adapted.

// Reads the primary statements from a PDF annual report through a transcript, verified in code. In PT the app has no
// AI: the agent (Claude Code, through the `catalyst` CLI) writes the transcript; CatalystViewer's Bedrock call isn't
// ported.
//
//   1. Code finds the statement pages (heading near the top, mostly table lines) and prints only those.
//   2. The agent copies every statement line in a fixed schema (STATEMENTS_TOOL): label as printed,
//      page, the amount per fiscal-year column exactly as printed, and the standard item it is.
//      It doesn't compute, convert or round anything.
//   3. Code turns printed amounts into numbers and checks them: every amount appears on its page,
//      total assets = total equity and liabilities, the key totals are there. Figures are summed from
//      the classified lines here, not by the model.
//
// For reports with no structure to parse: PDFs of unlisted IFRS reporters, foreign issuers, and
// issuers whose website only has the PDF.
import { UnsupportedFilingError, type FilingExtraction, type FilingField, type FilingPeriod, type ParsedFiling, type SourcedFigure } from "./filingParser.ts";
import type { PdfPage } from "./pdfText.ts";
import { LINE_ITEMS, markLineItems, type StatementLine } from "./statementLines.ts";

export const PROMPT_VERSION = 'pdf-statements-6';

// ─── 1. Statement pages ─────────────────────────────────────────────────────────

type Statement = 'balance' | 'income' | 'cashFlow';

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/ł/g, 'l');

// "Skonsolidowane roczne sprawozdanie / z sytuacji finansowej": up to two words between, and the
// heading may run over two lines. Also English and Hungarian (MOL: "pénzügyi helyzetre vonatkozó kimutatás").
const HEADINGS: Record<Statement, RegExp> = {
    balance: /(sprawozdani\w*(?: \w+){0,2} z sytuacji finansowej|^.{0,40}\bbilans\b|statement of financial position|balance sheet|penzugyi helyzetre vonatkozo)/,
    income: /(rachunek zyskow (?:i|lub) strat|sprawozdani\w*(?: \w+){0,2} z (?:wyniku|calkowitych dochodow)|statement of (?:profit(?: or |\/)loss|comprehensive income)|profit and loss account|income statement|eredmenykimutatas)/,
    cashFlow: /(sprawozdani\w*(?: \w+){0,2} z przeplywow pienieznych|rachunek przeplywow pienieznych|statement of cash flows|cash flow statement|cash.?flow-?ra vonatkozo)/,
};
// Polish "1 792,2" / "1.792,2" or English "1,792.2" (thousands groups, then decimals)
const AMOUNT = /\(?-?\d{1,3}(?:[\s.,]\d{3})*(?:[.,]\d+)?\)?/g;
const ENDS_IN_AMOUNT = /\d\)?\s*\|?\s*$/;
const MIN_TABLE_LINES = 12;
// A table of contents: dot leaders, a "contents" title, or most lines ending in a page number.
const isContents = (page: PdfPage) => page.lines.some(l => /\.{6,}/.test(l))
    || page.lines.slice(0, 5).some(l => /^(spis tresci|table of contents|contents)\b/.test(fold(l.trim())))
    || page.lines.filter(l => /\|\s*\d{1,3}\s*$/.test(l)).length > page.lines.length * 0.6;
// Table lines: two amounts or more, the last cell an amount (prose with numbers in it rarely ends in one).
const tableLines = (page: PdfPage) => page.lines.filter(l => (l.match(AMOUNT) ?? []).length >= 2 && ENDS_IN_AMOUNT.test(l)).length;

// The page's first short lines, each alone and joined with the next.
const headingLines = (page: PdfPage) => {
    const top = page.lines.slice(0, 12).filter(l => l.length < 120);
    return [...top, ...top.slice(0, -1).map((l, i) => `${l} ${top[i + 1]}`)];
};

// For each statement: the first page (past the table of contents) whose heading is near the top and
// which is mostly a table, and the page after it (statements often run over two pages); also a
// matching page right after it, with its next page.
export function findStatementPages(pages: PdfPage[]): number[] {
    const chosen = new Set<number>();
    for (const re of Object.values(HEADINGS)) {
        const hits = pages.filter(p => !isContents(p)
            && headingLines(p).some(l => re.test(fold(l)))
            && tableLines(p) >= MIN_TABLE_LINES);
        if (hits.length === 0) continue;
        // Also a heading page soon after the first: a section title page before the statement, or the statement's
        // heading printed again on a page it runs over to (GCI's H1 2026 balance sheet: pages 12, 13 and 14).
        for (const hit of hits.filter(h => h.page - hits[0]!.page <= 3)) {
            chosen.add(hit.page);
            if (pages.some(p => p.page === hit.page + 1)) chosen.add(hit.page + 1);
        }
    }
    return [...chosen].sort((a, b) => a - b);
}

// ─── 2. Transcription ───────────────────────────────────────────────────────────

// The model classifies each line as one of the standard line items, or other.
// Write-downs (impairment) and the finance lines (securitisation, other financial liabilities) are found
// by code (markLineItems), not asked of the model, so the prompt stays as it is.
type ByCode = 'impairment' | 'debtSecuritisation' | 'otherFinancialLiabilities';
const BY_CODE: readonly string[] = ['impairment', 'debtSecuritisation', 'otherFinancialLiabilities'];
export const LINE_FIELDS = [...LINE_ITEMS.filter((i): i is Exclude<typeof i, ByCode> => !BY_CODE.includes(i)), 'other'] as const;
export type LineField = typeof LINE_FIELDS[number];

export type Transcript = {
    companyName: string;
    scope: 'group' | 'single';
    currency: string;
    standard?: 'ifrs' | 'pl-uor';
    unit: 1 | 1000 | 1000000;
    columns: { id: string; periodStart?: string; periodEnd: string }[];
    lines: { statement: Statement; page: number; label: string; field: LineField; values: { column: string; printed: string }[] }[];
};

export const STATEMENTS_TOOL = {
    name: 'record_statements',
    description: 'Record the primary financial statements exactly as printed.',
    inputSchema: {
        type: 'object',
        required: ['companyName', 'scope', 'currency', 'unit', 'columns', 'lines'],
        properties: {
            companyName: { type: 'string' },
            scope: { enum: ['group', 'single'], description: 'group = consolidated statements' },
            currency: { type: 'string', description: 'ISO code, e.g. PLN' },
            standard: { enum: ['ifrs', 'pl-uor'], description: 'ifrs = IFRS (MSSF); pl-uor = the Polish accounting act (ustawa o rachunkowości)' },
            unit: { enum: [1, 1000, 1000000], description: 'multiplier of the printed amounts (thousands = 1000, millions = 1000000)' },
            columns: {
                type: 'array', description: 'the fiscal-year columns, current year first; ignore quarter columns',
                items: { type: 'object', required: ['id', 'periodEnd'], properties: { id: { type: 'string' }, periodStart: { type: 'string', description: 'YYYY-MM-DD' }, periodEnd: { type: 'string', description: 'YYYY-MM-DD' } } },
            },
            lines: {
                type: 'array',
                items: {
                    type: 'object', required: ['statement', 'page', 'label', 'field', 'values'],
                    properties: {
                        statement: { enum: ['balance', 'income', 'cashFlow'] },
                        page: { type: 'integer' },
                        label: { type: 'string', description: 'the line label as printed (joined if wrapped)' },
                        field: { enum: LINE_FIELDS, description: 'the standard item this line is, or other' },
                        values: {
                            type: 'array',
                            items: { type: 'object', required: ['column', 'printed'], properties: { column: { type: 'string' }, printed: { type: 'string', description: 'the amount exactly as printed, e.g. "(1 792,2)", "(1,792.2)" or "-"' } } },
                        },
                    },
                },
            },
        },
    },
} as const;

export function statementsPrompt(pages: PdfPage[], chosen: number[]): string {
    const text = chosen.map(n => `=== Page ${n} ===\n${pages.find(p => p.page === n)!.lines.join('\n')}`).join('\n\n');
    return `Below are pages of a company's annual financial statements, as text lines (" | " separates table cells).
Record every line of the statement of financial position, the income statement (profit or loss; not other comprehensive income) and the cash flow statement through the record_statements tool:
- copy labels and amounts exactly as printed; don't compute, convert or round anything; a note number column is not an amount;
- columns: the full fiscal years only (if quarters are also shown, skip them);
- field: classify each line. Totals: totalAssets, totalEquityAndLiabilities, equity (total equity incl. non-controlling interests), etc.
  Debt lines: debtBankLoans (bank loans, credits, borrowings), debtBonds (bonds, notes, debt securities), debtLeases (lease liabilities), debtMixed (a line combining several kinds, e.g. "financial liabilities" or "loans, borrowings and bonds", when the statement doesn't split them), debtOther (other interest-bearing financing, e.g. loans from related parties); interest payable, trade payables and derivatives are other, and so is an "other financial liabilities" line when the statement shows borrowings on their own lines.
  Other items: costOfSales, grossProfit, financeIncome, profitBeforeTax, incomeTax; propertyPlantEquipment, investmentProperty, loansGranted (loans the company gave to others), tradeReceivables (trade receivables, also "trade and other receivables"), tradePayables (likewise), contractLiabilities (contract liabilities, customer advances), provisions; investingCashFlow and financingCashFlow (the net totals), interestPaid, dividendsPaid, borrowingsRaised (proceeds from loans, borrowings and bond issues), borrowingsRepaid (repayment of loans and borrowings, bond redemption; not lease payments).
  depreciation: every depreciation and amortisation line in the income statement or the cash flow statement, including right-of-use asset depreciation when it is a separate line. capex: purchases of property, plant and equipment and intangible assets (investing cash flow). interestExpense: interest costs if shown; financeCosts: total finance costs.
  Several lines of one kind each get the field: every intangible assets line (e.g. mining intangibles and other intangibles; goodwill is goodwill), every capex line (purchases of property, plant and equipment or intangible assets, e.g. "mining assets" and "other property, plant and equipment and intangibles"; not investment property, subsidiaries or financial assets), every depreciation or amortisation line, every debt line. minorityInterests: the non-controlling interests line in equity.
  Total fields (totalAssets, noncurrentAssets, currentAssets, totalLiabilities, noncurrentLiabilities, currentLiabilities, totalEquityAndLiabilities, equity) go on the total line only, never on the lines that make it up; when the total has no label, use the section name (e.g. "Current assets").
  When a line is a subtotal of lines you also record, still give it its field only if it is the standard total (e.g. currentAssets); otherwise other.

${text}`;
}

// ─── 3. Verification and figures ────────────────────────────────────────────────

const DASH = /^[-–—]?$/;   // a dash or an empty cell: nothing in that column

// 'pl': "1 792,2", "1.792,2"; 'en': "1,792.2"
export type NumberStyle = 'pl' | 'en';

export function parsePrinted(printed: string, style: NumberStyle = 'pl'): number | undefined {
    const t = printed.trim();
    if (DASH.test(t)) return 0;
    const [shape, group, decimal] = style === 'en'
        ? [/^\(?[-–]?\s?\d{1,3}(,\d{3})*(\.\d+)?\)?$/, /,/g, '.']
        : [/^\(?[-–]?\s?\d[\d\s.]*(,\d+)?\)?$/, /[\s.]/g, ','];
    if (!shape.test(t)) return undefined;
    const value = Number(t.replace(/[()\-–]/g, '').replace(group, '').replace(decimal, '.'));
    if (!Number.isFinite(value)) return undefined;
    return /^\(|^[-–]/.test(t) ? -value : value;
}

// The report's number style, from the printed amounts: English when commas separate thousands
// ("4,523,463") in more amounts than show Polish signs (space or dot groups, a comma before 1–2 decimals).
export function numberStyle(printed: string[]): NumberStyle {
    const enGroups = (p: string) => /\d,\d{3}(?!\d)/.test(p);
    const en = printed.filter(p => enGroups(p) && !/\d\s\d{3}/.test(p)).length;
    const pl = printed.filter(p => (/\d[\s.]\d{3}(?!\d)/.test(p) && !enGroups(p)) || /\d,\d{1,2}\)?$/.test(p.trim())).length;
    return en > pl ? 'en' : 'pl';
}

const squash = (s: string) => s.replace(/\s/g, '');

// KRS number printed near "KRS" or "Rejestr Sądowy" anywhere in the report, also without its leading
// zeros ("numer rejestru KRS 23302"); the court register check confirms it.
export function findKrs(pages: PdfPage[]): string | undefined {
    const text = pages.map(p => p.lines.join(' ')).join(' ');
    const full = text.match(/(?:KRS|Rejestr\w*\s+S\S*dow\w*)[^.]{0,120}?\b(00\d{8})\b/i)?.[1];
    if (full) return full;
    const short = text.match(/\bKRS\b[\s:]*(?:nr\.?|numer|no\.?)?\s*(\d{3,10})\b/i)?.[1];
    return short ? short.padStart(10, '0') : undefined;
}

// LEI printed in the report: 20 characters, next to "LEI".
export function findLei(pages: PdfPage[]): string | undefined {
    const text = pages.map(p => p.lines.join(' ')).join(' ');
    return text.match(/\b([A-Z0-9]{18}\d{2})\b[\s|]*\(?LEI\)?|\bLEI\b[\s:|]*([A-Z0-9]{18}\d{2})\b/)?.slice(1).find(Boolean);
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

// "2025-12-31", "31.12.2025" or "30 September 2025" → ISO date; anything else is undefined.
export function isoDate(printed: string | undefined): string | undefined {
    const t = (printed ?? '').trim();
    const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const pl = t.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
    const en = t.match(/^(\d{1,2}) ([A-Za-z]+) (\d{4})$/);
    const month = en ? MONTHS.indexOf(en[2]!.toLowerCase()) + 1 : 0;
    const [y, m, d] = iso ? [iso[1], iso[2], iso[3]]
        : pl ? [pl[3]!, pl[2]!.padStart(2, '0'), pl[1]!.padStart(2, '0')]
        : en && month ? [en[3]!, String(month).padStart(2, '0'), en[1]!.padStart(2, '0')] : [];
    if (!y || Number.isNaN(new Date(`${y}-${m}-${d}T00:00:00Z`).getTime())) return undefined;
    return `${y}-${m}-${d}`;
}

function yearStart(end: string): string {
    const d = new Date(`${end}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    d.setUTCFullYear(d.getUTCFullYear() - 1);
    return d.toISOString().slice(0, 10);
}

function monthsBetween(start: string, end: string): number {
    return Math.round((new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) / 86_400_000 / 30.44);
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const fmt = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 2 });

export function transcriptToFiling(transcript: Transcript, pages: PdfPage[], extraction: FilingExtraction): ParsedFiling {
    const t = transcript;
    if (!t.columns?.length || !t.lines?.length) throw new UnsupportedFilingError('The model found no statement lines');
    const unit = [1, 1000, 1000000].includes(t.unit) ? t.unit : 1;
    const checks: string[] = [];

    // Every amount must be on the page the model cites.
    const pageText = new Map(pages.map(p => [p.page, squash(p.lines.join('|'))]));
    const numbers = new Map<object, number | undefined>();
    const style = numberStyle(t.lines.flatMap(l => l.values.map(v => v.printed)));
    for (const line of t.lines) {
        for (const v of line.values) {
            const value = parsePrinted(v.printed, style);
            numbers.set(v, value);
            if (value === undefined) {
                checks.push(`p. ${line.page} "${line.label}": "${v.printed}" isn't an amount`);
            } else if (!DASH.test(v.printed.trim()) && !(pageText.get(line.page) ?? '').includes(squash(v.printed).replace(/^\(|\)$/g, ''))) {
                checks.push(`p. ${line.page} "${line.label}": ${v.printed} isn't on that page`);
            }
        }
    }

    const notes: string[] = [`Read from the PDF by ${extraction.model} (${extraction.promptVersion}, pages ${extraction.pages.join(', ')}); amounts checked against the page text`];
    if (style === 'en') notes.push('Amounts printed in English number format (1,234.5)');
    let mixedDebt = false;
    const periods: FilingPeriod[] = t.columns.slice(0, 2).map((column, i) => {
        const of = (field: LineField, statement?: Statement) => t.lines
            .filter(l => l.field === field && (!statement || l.statement === statement))
            .flatMap(l => l.values.filter(v => v.column === column.id).map(v => ({ line: l, value: numbers.get(v) })))
            .filter((x): x is { line: Transcript['lines'][number]; value: number } => x.value !== undefined);
        const figure = (items: { line: Transcript['lines'][number]; value: number }[], abs = false): SourcedFigure | undefined => {
            if (items.length === 0) return undefined;
            const total = items.reduce((a, x) => a + x.value, 0) * unit;
            return { value: round2(abs ? Math.abs(total) : total), source: items.map(x => `p. ${x.line.page}/${x.line.label}`) };
        };
        const first = (field: LineField, statement?: Statement, abs = false) => figure(of(field, statement).slice(0, 1), abs);
        // A total the model also gave to the lines making it up: the largest of them is the total.
        const total = (field: LineField, statement: Statement) => figure(of(field, statement).sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 1));

        const debtItems = (['debtBankLoans', 'debtBonds', 'debtLeases', 'debtMixed', 'debtOther'] as const).flatMap(f => of(f, 'balance'));
        if (of('debtMixed', 'balance').length && !of('debtBonds', 'balance').length) mixedDebt = true;
        const figures: Partial<Record<FilingField, SourcedFigure>> = {
            revenue: first('revenue', 'income'),
            ebit: first('ebit', 'income'),
            // all cash flow lines: IFRS 16 reports often add right-of-use depreciation separately
            depreciation: figure(of('depreciation', 'cashFlow'), true) ?? first('depreciation', 'income', true),
            interestExpense: first('interestExpense', 'income', true) ?? first('financeCosts', 'income', true),
            netProfit: first('netProfit', 'income'),
            totalAssets: first('totalAssets', 'balance'),
            intangibleAssets: figure([...of('intangibleAssets', 'balance'), ...of('goodwill', 'balance')]),
            equity: first('equity', 'balance'),
            financialDebt: figure(debtItems),
            bonds: figure(of('debtBonds', 'balance')),
            cash: first('cash', 'balance'),
            currentAssets: total('currentAssets', 'balance'),
            inventory: figure(of('inventory', 'balance')),
            currentLiabilities: total('currentLiabilities', 'balance'),
            minorityInterests: first('minorityInterests', 'balance'),
            operatingCashFlow: first('operatingCashFlow', 'cashFlow'),
            capex: figure(of('capex', 'cashFlow'), true),
        };
        for (const key of Object.keys(figures) as FilingField[]) if (figures[key] === undefined) delete figures[key];

        // Every line with an amount in this column, as printed
        const lines: StatementLine[] = [];
        const count: Partial<Record<Statement, number>> = {};
        for (const line of t.lines) {
            const value = line.values.filter(v => v.column === column.id).map(v => numbers.get(v)).find(v => v !== undefined);
            if (value === undefined) continue;
            count[line.statement] = (count[line.statement] ?? -1) + 1;
            lines.push({
                statement: line.statement, order: count[line.statement]!, label: line.label, value: round2(value * unit), page: line.page,
                ...(line.field && line.field !== 'other' && (LINE_ITEMS as readonly string[]).includes(line.field) ? { item: line.field } : {}),
            });
        }
        markLineItems(lines);

        const end = isoDate(column.periodEnd);
        if (!end) throw new UnsupportedFilingError(`The model gave an unreadable date for column ${column.id}: "${column.periodEnd}"`);
        const label = i === 0 ? end : `${end} (comparative)`;
        const assets = figures.totalAssets?.value;
        // UK-style statements show net assets instead: then equity + total liabilities
        const liabilities = figure(of('totalLiabilities', 'balance').slice(0, 1))?.value;
        const equityAndLiabilities = figure(of('totalEquityAndLiabilities', 'balance').slice(0, 1))?.value
            ?? (figures.equity && liabilities !== undefined ? round2(figures.equity.value + liabilities) : undefined);
        const tolerance = Math.max(unit, Math.abs(assets ?? 0) * 0.0005);
        const start = isoDate(column.periodStart) ?? yearStart(end);
        const months = monthsBetween(start, end);
        // An interim report's comparative column often has the income statement and cash flows only (its balance
        // sheet compares with the last year end, which the annual report holds): no balance sheet checks then.
        const flowsOnly = i > 0 && months < 12 && !lines.some(l => l.statement === 'balance');
        if (!flowsOnly) {
            if (assets === undefined) checks.push(`${label}: no total assets`);
            else if (equityAndLiabilities === undefined) checks.push(`${label}: no total equity and liabilities`);
            else if (Math.abs(assets - equityAndLiabilities) > tolerance) checks.push(`${label}: total assets ${fmt(assets)} ≠ total equity and liabilities ${fmt(equityAndLiabilities)}`);
            if (!figures.equity) checks.push(`${label}: no total equity`);
        } else notes.push(`${end} (comparative): income statement and cash flows only`);
        if (!figures.netProfit) checks.push(`${label}: no net profit`);
        return { column: i === 0 ? 'current' : 'previous', periodStart: start, periodEnd: end, months, figures, lines };
    });
    // An interim report: its year to date and the comparative are labelled with their periods, the same months apart
    // by a year (H1 2026 against H1 2025), never a year end against a half-year.
    const [now, then] = periods;
    if (now && now.months < 12 && then && (then.months !== now.months || then.periodEnd.slice(5) !== now.periodEnd.slice(5)))
        checks.push(`${now.periodEnd}: ${now.months} months, but the comparative column is ${then.months} months to ${then.periodEnd}: an interim's comparative is the same months a year earlier (give each column its periodStart)`);
    if (mixedDebt) notes.push('Debt: the balance sheet has combined financing lines (e.g. "financial liabilities"), so bonds aren\'t split out');

    return {
        format: 'ai-pdf',
        scope: t.scope === 'single' ? 'single' : 'group',
        companyName: t.companyName ?? '',
        krs: findKrs(pages),
        lei: findLei(pages),
        currency: /^[A-Z]{3}$/.test(t.currency) ? t.currency : 'PLN',
        standard: t.standard === 'pl-uor' ? 'pl-uor' : 'ifrs',
        presentedUnit: unit as 1 | 1000 | 1000000,
        lineSigns: 'printed',
        schema: `PDF read by ${extraction.model} (${extraction.promptVersion})`,
        periods,
        checks,
        notes,
        extraction,
    };
}

// ─── Entry point ────────────────────────────────────────────────────────────────

/**
 * A PDF's statements from a transcript (the agent's copy of its statement lines): every amount checked against its
 * page, the totals checked, the figures summed in code. `by` names who copied it (a model or a person).
 */
export function filingFromTranscript(pages: PdfPage[], input: unknown, by: string): ParsedFiling {
    const chosen = findStatementPages(pages);
    if (chosen.length === 0) throw new UnsupportedFilingError('No financial statement pages found in this PDF (scanned, or not an annual report?)');
    return transcriptToFiling(input as Transcript, pages, { model: by, promptVersion: PROMPT_VERSION, pages: chosen });
}
