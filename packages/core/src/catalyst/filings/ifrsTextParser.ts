// Ported from CatalystViewer (packages/core/src/bonds/fundamentals/filings/IfrsTextParser.ts, 7e8a24c) for the Catalyst module's
// phase 2 (Docs/catalyst-phase2-plan.md, N3): functionality kept, imports adapted.

// Parses an IFRS financial statement that has no XBRL tags: the separate (single-company) statements
// listed companies publish as XHTML (often a PDF converted with pdf2htmlEX) or HTML. The statements are
// found by their headings and lines are matched by label (Polish or English), so this is best effort:
// the result is only accepted when total assets tie to total equity and liabilities.
//
// Labels are matched loosely, because PDF conversions drop Polish letters ("krótkoterminowe" →
// "krtkoterminowe"): diacritics are stripped and letters that have a Polish accented form are optional.
import { UnsupportedFilingError, type FilingField, type FilingPeriod, type FilingScope, type ParsedFiling, type SourcedFigure } from "./filingParser.ts";
import { itemsFromFigures, type StatementLine, markLineItems } from "./statementLines.ts";

type Row = { label: string; joined: string; values: [number, number | undefined] };
type SectionName = 'balance' | 'income' | 'cashFlow';

// ─── Text ───────────────────────────────────────────────────────────────────────

const decode = (s: string) => s
    .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));

// One line per block, table cell or line break.
export function htmlToLines(html: string): string[] {
    const text = html
        .replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, '')
        .replace(/<\/(div|p|td|th|tr|li|h\d)>|<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '');
    // Glyphs a PDF font maps to the private use area (often Polish letters) carry no text: dropped.
    return decode(text).replace(/[\uE000-\uF8FF]/g, '').split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

export function normalize(s: string): string {
    return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/ł/g, 'l').replace(/Ł/g, 'L')
        .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// A label written with its Polish letters ("krótkoterminowe") also matches the text with those letters
// dropped ("krtkoterminowe"), as some PDF conversions do; other letters must match.
const ACCENTED: Record<string, string> = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };
function loose(pattern: string): string {
    return pattern.toLowerCase().split('').map(c => (ACCENTED[c] ? `${ACCENTED[c]}?` : /[a-z0-9]/.test(c) ? c : ' ?')).join('').replace(/( \?)+/g, ' ?');
}

const NUMBER = /^\(?[-–]?\s?\d{1,3}(?:[\s.]\d{3})*(?:,\d+)?\)?$/;
const DASH = /^[-–—]$/;
// Note references: "7.21" always; a plain "12" only when two amounts follow it (see flush)
const NOTE = /^\d{1,2}(\.\d{1,2}){1,2}\.?$|^\d{1,2}[a-z]$/;

function parseNumber(token: string): number | undefined {
    if (DASH.test(token)) return 0;
    if (!NUMBER.test(token)) return undefined;
    const negative = /^\(.*\)$/.test(token) || /^[-–]/.test(token);
    const value = Number(token.replace(/[()\-–\s.]/g, '').replace(',', '.'));
    return Number.isFinite(value) ? (negative ? -value : value) : undefined;
}

// ─── Sections and rows ──────────────────────────────────────────────────────────

// Whole words only: "bilans" must not match "bilansowy".
const words = (alternatives: string) => new RegExp(`(^| )(${alternatives})( |$)`);

const HEADINGS: Record<SectionName, RegExp> = {
    balance: words(`${loose('bilans')}|${loose('sprawozdanie z sytuacji finansowej')}|statement of financial position|balance sheet`),
    income: words(`${loose('rachunek zysków i strat')}|${loose('sprawozdanie z wyniku')}|income statement|statement of profit or loss`),
    cashFlow: words(`${loose('rachunek przepływów pieniężnych')}|${loose('sprawozdanie z przepływów pieniężnych')}|statement of cash flows|cash flow statement`),
};
const END = words(`${loose('zestawienie zmian w kapitale')}|${loose('sprawozdanie ze zmian w kapitale')}|statement of changes in equity|${loose('dodatkowe informacje')}|${loose('informacja dodatkowa')}|notes to the`);
const OTHER = words(`${loose('całkowitych dochodów')}|comprehensive income`);

type Section = { rows: Row[]; header: string[] };

// Statement headings are short lines without a table-of-contents dot leader.
function headingOf(line: string): SectionName | 'end' | 'other' | undefined {
    if (line.length > 90 || /\.{4,}/.test(line)) return undefined;
    const n = normalize(line);
    if (END.test(n)) return 'end';
    if (OTHER.test(n)) return 'other';
    for (const [name, re] of Object.entries(HEADINGS) as [SectionName, RegExp][]) if (re.test(n)) return name;
    return undefined;
}

// Every run of lines after a statement heading. Headings also occur in running text and notes,
// so there can be several candidates per statement; the caller picks one.
function readSections(lines: string[]): { name: SectionName; section: Section }[] {
    const candidates: { name: SectionName; section: Section }[] = [];
    let current: Section | undefined;
    let label: string | undefined;
    let previousLabel: string | undefined;
    let numbers: number[] = [];

    const flush = () => {
        if (current && label !== undefined && numbers.length > 0) {
            // A note reference may precede the two amount columns.
            const values = numbers.length >= 2 ? numbers.slice(-2) : [numbers[0]];
            current.rows.push({ label, joined: `${previousLabel ?? ''} ${label}`.trim(), values: [values[0]!, values[1]!] });
        }
        numbers = [];
    };

    for (const line of lines) {
        const heading = headingOf(line);
        if (heading) {
            flush();
            label = undefined;
            if (heading === 'end' || heading === 'other') { current = undefined; continue; }
            current = { rows: [], header: [] };
            candidates.push({ name: heading, section: current });
            continue;
        }
        if (!current) continue;
        const value = parseNumber(line);
        if (value !== undefined && label !== undefined) {
            numbers.push(value);
            continue;
        }
        if (NOTE.test(line)) continue;
        flush();
        if (current.rows.length === 0) current.header.push(line);
        previousLabel = label;
        label = line;
    }
    flush();
    return candidates;
}

// The statement is the first candidate that has its key total line (total assets, net profit,
// operating cash flow); failing that, the longest.
const KEY_LINE: Record<SectionName, FilingField> = { balance: 'totalAssets', income: 'netProfit', cashFlow: 'operatingCashFlow' };

function pickSections(candidates: { name: SectionName; section: Section }[]): Partial<Record<SectionName, Section>> {
    const sections: Partial<Record<SectionName, Section>> = {};
    for (const name of Object.keys(KEY_LINE) as SectionName[]) {
        const own = candidates.filter(c => c.name === name).map(c => c.section);
        const key = RULES[KEY_LINE[name]]!;
        sections[name] = own.find(s => s.rows.some(row => matches(row, key.labels, key.english)))
            ?? own.sort((a, b) => b.rows.length - a.rows.length)[0];
    }
    return sections;
}

// ─── Lines to figures ───────────────────────────────────────────────────────────

type Rule = { section: SectionName; labels: string[]; english?: RegExp; sum?: boolean; negate?: boolean };

const rule = (section: SectionName, labels: string[], english?: RegExp, opts: Partial<Rule> = {}): Rule => ({ section, labels, english, ...opts });

const RULES: Partial<Record<FilingField, Rule>> = {
    totalAssets: rule('balance', ['aktywa razem', 'suma aktywów', 'aktywa ogółem'], /^total assets$/),
    currentAssets: rule('balance', ['aktywa obrotowe razem', 'aktywa obrotowe'], /^(total )?current assets$/),
    inventory: rule('balance', ['zapasy'], /^inventor(y|ies)$/),
    cash: rule('balance', ['środki pieniężne i ich ekwiwalenty', 'środki pieniężne i ekwiwalenty środków pieniężnych'], /^cash and cash equivalents$/),
    intangibleAssets: rule('balance', ['wartości niematerialne', 'wartość firmy'], /^(intangible assets|goodwill)$/, { sum: true }),
    equity: rule('balance', ['kapitał własny razem', 'kapitał własny ogółem', 'razem kapitał własny'], /^(total equity|equity total)$/),
    currentLiabilities: rule('balance', ['zobowiązania krótkoterminowe razem', 'zobowiązania krótkoterminowe'], /^(total )?current liabilities$/),
    revenue: rule('income', ['przychody ze sprzedaży', 'przychody z umów z klientami', 'przychody netto ze sprzedaży', 'przychody'], /^(revenue|revenues|sales revenue)/),
    ebit: rule('income', ['zysk na działalności operacyjnej', 'zysk z działalności operacyjnej', 'zysk (strata) na działalności operacyjnej', 'zysk (strata) z działalności operacyjnej', 'wynik na działalności operacyjnej'], /^(operating profit|profit from operations|operating income)/),
    interestExpense: rule('income', ['koszty finansowe'], /^finance (costs|expenses)$/, { negate: true }),
    netProfit: rule('income', ['zysk netto', 'zysk (strata) netto', 'zysk netto za okres', 'zysk netto za rok obrotowy'], /^(net profit|profit for the (year|period))/),
    depreciation: rule('cashFlow', ['amortyzacja'], /^depreciation/),
    operatingCashFlow: rule('cashFlow', ['środki pieniężne netto z działalności operacyjnej', 'przepływy pieniężne netto z działalności operacyjnej', 'przepływy środków pieniężnych netto z działalności operacyjnej'], /^net cash (from|generated|flows? from)( used in)? operating/),
    capex: rule('cashFlow', ['nabycie wartości niematerialnych oraz rzeczowych aktywów trwałych', 'nabycie rzeczowych aktywów trwałych', 'nabycie wartości niematerialnych', 'wydatki na nabycie rzeczowych aktywów trwałych'], /^(purchase|acquisition) of (property|intangible)/, { sum: true, negate: true }),
};

const TOTAL_EQUITY_AND_LIABILITIES = ['kapitał własny i zobowiązania razem', 'pasywa razem', 'suma pasywów', 'razem kapitał własny i zobowiązania', 'pasywa ogółem'];
const DEBT = new RegExp(`(${['kredyt', 'pożyczk', 'obligacj', 'leasing', 'dłużn'].map(loose).join('|')}|borrowing|loan|bond|lease liabilit|notes issued)`);
const NOT_DEBT = new RegExp(`(${['odset', 'udzielon', 'należnoś'].map(loose).join('|')}|interest|receivable|granted)`);
const BOND = new RegExp(`(${loose('obligacj')}|bond|notes issued|${loose('dłużn')})`);

function matches(row: Row, labels: string[], english?: RegExp): boolean {
    for (const text of [row.label, row.joined]) {
        const n = normalize(text);
        if (labels.some(l => new RegExp(`^${loose(l)}( ${loose("ogółem")}| razem)?$`).test(n))) return true;
        if (english?.test(n)) return true;
    }
    return false;
}

// ─── Entry point ────────────────────────────────────────────────────────────────

export function parseIfrsText(html: string): ParsedFiling {
    const lines = htmlToLines(html);
    const sections = pickSections(readSections(lines));
    const balance = sections.balance;
    if (!balance || balance.rows.length < 5) {
        throw new UnsupportedFilingError('No balance sheet (statement of financial position) found in this document');
    }
    const head = normalize(lines.slice(0, 60).join(' '));
    const all = normalize(lines.join(' '));

    // Columns: the balance sheet header's two dates, current year usually first.
    const dates = [...balance.header.join(' ').matchAll(/(\d{2})[./-](\d{2})[./-](\d{4})/g)].map(m => `${m[3]!}-${m[2]!}-${m[1]!}`);
    if (dates.length < 1) throw new UnsupportedFilingError('No balance sheet dates found (dd.mm.yyyy in the header)');
    const swapped = dates.length >= 2 && dates[0]! < dates[1]!;
    const ends = swapped ? [dates[1], dates[0]] : [dates[0], dates[1]];
    const columnOf = (i: 0 | 1): 0 | 1 => (swapped ? (1 - i) as 0 | 1 : i);

    const unit = /w tysi\w* z\w*otych|w tysi\w* pln|in thousands|tys zl|pln 000|pln thousand|thousand pln/.test(all) ? 1000
        : /w milion\w* z\w*otych|in millions|mln zl/.test(all) ? 1_000_000 : 1;
    const scope: FilingScope = /skonsolidowan|consolidated/.test(head) ? 'group' : 'single';

    const take = (field: FilingField, column: 0 | 1): SourcedFigure | undefined => {
        const r = RULES[field]!;
        const rows = (sections[r.section]?.rows ?? []).filter(row => matches(row, r.labels, r.english));
        const used = r.sum ? rows : rows.slice(0, 1);
        const values = used.map(row => row.values[columnOf(column)]).filter((v): v is number => v !== undefined);
        if (values.length === 0) return undefined;
        const total = values.reduce((a, v) => a + v, 0) * unit;
        return { value: round2(r.negate ? Math.abs(total) : total), source: used.map(row => `${r.section}/${row.label}`) };
    };

    // Debt: equity and liability rows (after total assets) for borrowings, bonds and leases.
    const assetsIndex = balance.rows.findIndex(row => matches(row, RULES.totalAssets!.labels, RULES.totalAssets!.english));
    const liabilityRows = balance.rows.slice(assetsIndex + 1).filter(row => {
        const n = normalize(row.label);
        return DEBT.test(n) && !NOT_DEBT.test(n) && !/razem|ogolem|total/.test(n);
    });

    const checks: string[] = [];
    const periods: FilingPeriod[] = ([0, 1] as const).flatMap(column => {
        const end = ends[column];
        if (!end) return [];
        const start = shiftYearStart(end);
        const figures: FilingPeriod['figures'] = {};
        for (const field of Object.keys(RULES) as FilingField[]) {
            const f = take(field, column);
            if (f) figures[field] = f;
        }
        if (assetsIndex >= 0) {
            const values = liabilityRows.map(row => row.values[columnOf(column)] ?? 0);
            figures.financialDebt = { value: round2(values.reduce((a, v) => a + v, 0) * unit), source: liabilityRows.map(r => `balance/${r.label}`) };
            const bondRows = liabilityRows.filter(row => BOND.test(normalize(row.label)));
            if (bondRows.length) figures.bonds = { value: round2(bondRows.reduce((a, row) => a + (row.values[columnOf(column)] ?? 0), 0) * unit), source: bondRows.map(r => `balance/${r.label}`) };
        }

        const period = column === 0 ? end : `${end} (comparative)`;
        const totalRow = balance.rows.find(row => matches(row, TOTAL_EQUITY_AND_LIABILITIES, /^total (equity and liabilities|liabilities and equity)$/));

        // Every row of the three statements, as printed
        const lines: StatementLine[] = [];
        const lineOf = new Map<string, StatementLine>();
        const rowLine = new Map<Row, StatementLine>();
        for (const name of ['balance', 'income', 'cashFlow'] as const) {
            let order = 0;
            for (const row of sections[name]?.rows ?? []) {
                const v = row.values[columnOf(column)];
                if (v === undefined) continue;
                const line: StatementLine = { statement: name, order: order++, label: row.label, value: round2(v * unit) };
                lines.push(line);
                rowLine.set(row, line);
                if (!lineOf.has(`${name}/${row.label}`)) lineOf.set(`${name}/${row.label}`, line);
            }
        }
        if (totalRow && rowLine.has(totalRow)) rowLine.get(totalRow)!.item = 'totalEquityAndLiabilities';
        itemsFromFigures(lines, figures, source => lineOf.get(source));
        markLineItems(lines);

        const total = totalRow?.values[columnOf(column)];
        const assets = figures.totalAssets?.value;
        if (assets === undefined) checks.push(`${period}: total assets not found`);
        else if (total === undefined) checks.push(`${period}: total equity and liabilities not found`);
        else if (Math.abs(assets - total * unit) > unit) checks.push(`${period}: total assets ${fmt(assets)} ≠ total equity and liabilities ${fmt(total * unit)}`);
        if (!figures.equity) checks.push(`${period}: total equity not found`);
        if (!figures.revenue && !figures.netProfit) checks.push(`${period}: no income statement figures found`);

        return [{ column: column === 0 ? 'current' : 'previous', periodStart: start, periodEnd: end, months: 12, figures, lines }];
    });

    // Identity: the KRS number next to "KRS" or "Rejestru Sądowego" (else --krs); the company name from the title page.
    const text = lines.join(' ');
    const krs = text.match(/(?:KRS|Rejestr\w*\s+S\S*dow\w*)[^.]{0,120}?\b(00\d{8})\b/i)?.[1];
    const companyName = lines.slice(0, 40).find(l => /\b(S\.\s?A\.|SPÓŁKA AKCYJNA|SP\. Z O\. ?O\.|SE|N\.V\.|S\.K\.A\.)\s*$/i.test(l)) ?? '';

    return {
        format: 'ifrs-text',
        scope,
        companyName,
        krs,
        currency: 'PLN',
        standard: 'ifrs',
        presentedUnit: unit,
        lineSigns: 'printed',
        schema: `IFRS text (${scope === 'group' ? 'consolidated' : 'separate'} statements, untagged)`,
        unitMultiplier: unit === 1000 ? 1000 : 1,
        periods,
        checks,
        notes: [
            'Read by statement line labels (no XBRL tags): check the figures against the document',
            ...(unit === 1_000_000 ? ['Amounts in millions'] : []),
        ],
    };
}

// 12-month fiscal year ending on this date
function shiftYearStart(end: string): string {
    const d = new Date(`${end}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    d.setUTCFullYear(d.getUTCFullYear() - 1);
    return d.toISOString().slice(0, 10);
}

const round2 = (v: number) => Math.round(v * 100) / 100;

function fmt(value: number): string {
    return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}
