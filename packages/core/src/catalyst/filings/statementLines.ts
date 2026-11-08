// Ported from CatalystViewer (packages/core/src/bonds/fundamentals/filings/statementLines.ts, 7e8a24c) for the Catalyst module's
// phase 2 (Docs/catalyst-phase2-plan.md, N3): functionality kept, imports adapted.

// Every line of a filing's primary statements (balance sheet, income statement, cash flow), stored with
// each fiscal year so that new metrics can be computed from stored data, without reading the file again.
// `item` puts lines of different formats and filers on one vocabulary.
import type { FilingField, SourcedFigure } from "./filingParser.ts";

export type StatementName = 'balance' | 'income' | 'cashFlow';

export const LINE_ITEMS = [
    // income statement
    'revenue', 'costOfSales', 'grossProfit', 'ebit', 'depreciation', 'interestExpense', 'financeCosts', 'financeIncome',
    'profitBeforeTax', 'incomeTax', 'netProfit', 'impairment',
    // balance sheet: assets
    'totalAssets', 'noncurrentAssets', 'propertyPlantEquipment', 'investmentProperty', 'intangibleAssets', 'goodwill',
    'loansGranted', 'currentAssets', 'inventory', 'tradeReceivables', 'cash',
    // balance sheet: equity and liabilities
    'equity', 'minorityInterests', 'totalLiabilities', 'noncurrentLiabilities', 'currentLiabilities', 'totalEquityAndLiabilities',
    'debtBankLoans', 'debtBonds', 'debtLeases', 'debtMixed', 'debtOther', 'debtSecuritisation', 'otherFinancialLiabilities', 'tradePayables', 'contractLiabilities', 'provisions',
    // cash flow
    'operatingCashFlow', 'capex', 'investingCashFlow', 'financingCashFlow', 'interestPaid', 'dividendsPaid',
    'borrowingsRaised', 'borrowingsRepaid',
] as const;
export type LineItem = typeof LINE_ITEMS[number];

export type StatementLine = {
    statement: StatementName;
    order: number;        // position in its statement, from 0
    label: string;        // as printed, in the filing's language (KRS XML: from the line code table)
    value: number;        // units of the row's currency; sign per ParsedFiling.lineSigns
    code?: string;        // the filing's own identifier: KRS XML "Pasywa_B_III_3_A", ESEF "ifrs-full:Inventories"
    anchor?: string;      // ESEF extension concept: the wider IFRS concept it is anchored to
    parent?: number;      // `order` of the subtotal this line adds up into, when known
    item?: LineItem;
    page?: number;        // PDF page
};

// The scorecard figure a line makes up, as a line item (the debt and intangible figures are split by line).
const FIELD_ITEM: Partial<Record<FilingField, LineItem>> = {
    revenue: 'revenue', ebit: 'ebit', depreciation: 'depreciation', interestExpense: 'interestExpense', netProfit: 'netProfit',
    totalAssets: 'totalAssets', equity: 'equity', cash: 'cash', currentAssets: 'currentAssets', inventory: 'inventory',
    currentLiabilities: 'currentLiabilities', minorityInterests: 'minorityInterests', operatingCashFlow: 'operatingCashFlow', capex: 'capex',
};

const SUMMED = new Set<FilingField>(['capex', 'inventory', 'depreciation']);

// The kind of a debt line, from its label or concept name.
export function debtKind(text: string, isBondLine: boolean): LineItem {
    const t = text.toLowerCase();
    const loan = /kredyt|po[zż]ycz|loan|borrowing|credit/.test(t);
    const bond = isBondLine || /obligac|bond|note|debenture|d[lł]u[zż]n/.test(t);
    const lease = /leas/.test(t);
    if ([loan, bond, lease].filter(Boolean).length > 1) return 'debtMixed';
    if (bond) return 'debtBonds';
    if (lease) return 'debtLeases';
    if (loan) return 'debtBankLoans';
    return 'debtOther';
}

// Gives lines the item of the scorecard figure they make up, where they have none yet. `find` maps a
// figure's source entry to its line. Debt lines get their kind, intangible lines intangible or goodwill.
export function itemsFromFigures(
    _lines: StatementLine[],
    figures: Partial<Record<FilingField, SourcedFigure>>,
    find: (source: string) => StatementLine | undefined,
): void {
    const set = (line: StatementLine | undefined, item: LineItem) => { if (line && !line.item) line.item = item; };
    const bondLines = new Set((figures.bonds?.source ?? []).map(find).filter(Boolean));
    for (const [field, figure] of Object.entries(figures) as [FilingField, SourcedFigure][]) {
        for (const source of figure.source) {
            const line = find(source);
            if (!line) continue;
            if (field === 'financialDebt') set(line, debtKind(`${line.code ?? ''} ${line.label}`, bondLines.has(line)));
            else if (field === 'intangibleAssets') set(line, (line.code ?? '').endsWith(':Goodwill') || /goodwill|warto[sś][cć] firmy/i.test(line.label) ? 'goodwill' : 'intangibleAssets');
            // A figure summed from several lines tags them only where each line is that item too.
            else if (FIELD_ITEM[field] && (figure.source.length === 1 || SUMMED.has(field))) set(line, FIELD_ITEM[field]!);
        }
    }
}

// Balance sheet lines whose parent is known must add up to it (tolerance in units of currency).
export function lineChecks(lines: StatementLine[], label: string, tolerance: number, totals: LineItem[] = ['totalAssets', 'totalEquityAndLiabilities']): string[] {
    const checks: string[] = [];
    const byOrder = new Map(lines.filter(l => l.statement === 'balance').map(l => [l.order, l]));
    const sums = new Map<number, number>();
    for (const l of byOrder.values()) if (l.parent !== undefined) sums.set(l.parent, (sums.get(l.parent) ?? 0) + l.value);
    for (const item of totals) {
        const total = [...byOrder.values()].find(l => l.item === item);
        if (!total || !sums.has(total.order)) continue;
        const sum = sums.get(total.order)!;
        if (Math.abs(sum - total.value) > tolerance) {
            checks.push(`${label}: the lines under "${total.label}" add up to ${sum.toLocaleString('en-US')}, not ${total.value.toLocaleString('en-US')}`);
        }
    }
    return checks;
}

// ─── Write-downs and item totals ───────────────────────────────────────────────

// A write-down of non-financial assets (goodwill, property, intangibles) in the income statement, by
// its label or concept: not of receivables, loans or other financial assets, not a reversal (a gain),
// not a subtotal or a depreciation line that includes it.
const WRITE_DOWN = /impairment|writedown|write-down|utrat\w* wartości|odpis\w* aktualizując|aktualizacja wartości aktywów niefinansowych|értékveszt/i;
const NOT_WRITE_DOWN = /(?<!nie)finansow|(?<!non-)financial|należno|pożycz|instrument|receivabl|loan|kredyt|udział|before|przed|ebitda|operating profit|zysk operac|amortyz|amortis|depreci|értékcsökken/i;
const REVERSAL = /^\W*(odwróc|reversal|reversed|zysk|gain)/i;

export function isWriteDown(line: Pick<StatementLine, 'statement' | 'label' | 'code'>): boolean {
    const text = `${line.label} ${line.code ?? ''}`;
    return line.statement === 'income' && WRITE_DOWN.test(text) && !NOT_WRITE_DOWN.test(text) && !REVERSAL.test(line.label);
}

// Balance sheet lines the parsers leave out of debt, found by label or concept: a lessor's securitisation
// funding (Vehis), and "other financial liabilities", where some lenders put their bonds (Vindexus FY2025).
const SECURITISATION = /sekurytyz|securiti[sz]/i;
const OTHER_FINANCIAL = /(pozosta\S*|inne) (krótkoterminowe |długoterminowe )?zobowiązania finansowe|other (current |non-?current )?financial liabilities|:Other(Current|Noncurrent)?FinancialLiabilities/i;

export function financeItem(line: Pick<StatementLine, 'statement' | 'label' | 'code'>): LineItem | undefined {
    if (line.statement !== 'balance') return undefined;
    const text = `${line.label} ${line.code ?? ''}`;
    if (SECURITISATION.test(text)) return 'debtSecuritisation';
    if (OTHER_FINANCIAL.test(text)) return 'otherFinancialLiabilities';
    return undefined;
}

// Gives lines the items found by label rather than by the figures: the income statement's write-downs
// (impairment) and the finance lines above, where they have no item yet.
export function markLineItems(lines: StatementLine[]): void {
    for (const line of lines) {
        if (line.item) continue;
        const item = isWriteDown(line) ? 'impairment' : financeItem(line);
        if (item) line.item = item;
    }
}

// Item totals, plus the debt due within 12 months (debt lines under current liabilities).
export type ItemTotals = Partial<Record<LineItem | 'debtDueWithinYear' | 'otherFinancialDueWithinYear', number>>;

const DEBT_ITEMS = new Set<LineItem>(['debtBankLoans', 'debtBonds', 'debtLeases', 'debtMixed', 'debtOther', 'debtSecuritisation']);

// The statement an item's total comes from (cash and net profit also appear in the others).
const INCOME_ITEMS = new Set<LineItem>(LINE_ITEMS.slice(0, LINE_ITEMS.indexOf('impairment') + 1));
const CASH_FLOW_ITEMS = new Set<LineItem>(LINE_ITEMS.slice(LINE_ITEMS.indexOf('operatingCashFlow')));
export const statementOf = (item: LineItem): StatementName => INCOME_ITEMS.has(item) ? 'income' : CASH_FLOW_ITEMS.has(item) ? 'cashFlow' : 'balance';

// Paid amounts and costs, shown as positive totals whatever sign the statement prints them with.
const OUTFLOWS = new Set<LineItem>(['capex', 'interestPaid', 'dividendsPaid', 'borrowingsRepaid']);

// The sum of each line item over a year's lines, in units of the currency. A line under a subtotal of
// the same item isn't counted again. Outflows are positive; a write-down is positive for a loss (tagged
// lines are signed that way, printed ones are taken as losses).
export function itemTotals(lines: StatementLine[], lineSigns: 'printed' | 'tagged' | undefined): ItemTotals {
    const key = (l: StatementLine) => `${l.statement}#${l.order}`;
    const byKey = new Map(lines.map(l => [key(l), l]));
    const totals: ItemTotals = {};
    for (const line of lines) {
        if (!line.item || line.statement !== statementOf(line.item)) continue;
        const parent = line.parent !== undefined ? byKey.get(`${line.statement}#${line.parent}`) : undefined;
        if (parent?.item === line.item) continue;
        const value = line.item === 'impairment' && lineSigns !== 'tagged' ? Math.abs(line.value) : line.value;
        totals[line.item] = (totals[line.item] ?? 0) + value;
    }
    for (const item of OUTFLOWS) if (totals[item] !== undefined) totals[item] = Math.abs(totals[item]!);
    const current = currentLiabilityLines(lines);
    if (current) {
        const sum = (items: Set<LineItem>) => {
            const counted = current.filter(l => items.has(l.item!) && !(l.parent !== undefined && current.some(p => p.order === l.parent && p.item === l.item)));
            return counted.length ? counted.reduce((a, l) => a + l.value, 0) : undefined;
        };
        const debt = sum(DEBT_ITEMS), other = sum(new Set(['otherFinancialLiabilities']));
        totals.debtDueWithinYear = debt ?? 0;
        if (other !== undefined) totals.otherFinancialDueWithinYear = other;
    }
    return totals;
}

// The balance sheet lines under current liabilities: by the lines' parents when the section's lines
// have them, otherwise the lines after the current liabilities line up to the next section (non-current
// liabilities, or the total of equity and liabilities). Undefined when there's no such line.
function currentLiabilityLines(lines: StatementLine[]): StatementLine[] | undefined {
    const balance = lines.filter(l => l.statement === 'balance').sort((a, b) => a.order - b.order);
    const head = balance.find(l => l.item === 'currentLiabilities');
    if (!head) return undefined;
    const byOrder = new Map(balance.map(l => [l.order, l]));
    const under = (l: StatementLine): boolean => {
        for (let p = l.parent, depth = 0; p !== undefined && depth < 10; p = byOrder.get(p)?.parent, depth++) if (p === head.order) return true;
        return false;
    };
    const byParent = balance.filter(under);
    if (byParent.length) return byParent;
    const boundary = (l: StatementLine) => l.item === 'noncurrentLiabilities' || l.item === 'totalEquityAndLiabilities' || l.item === 'equity' || l.item === 'totalLiabilities';
    // A section total printed under its lines ("Zobowiązania krótkoterminowe razem", "Total current liabilities")
    if (SECTION_TOTAL.test(head.label)) {
        const before = balance.filter(l => l.order < head.order);
        const start = before.findLastIndex(boundary);
        return before.slice(start + 1);
    }
    const after = balance.filter(l => l.order > head.order);
    const end = after.findIndex(boundary);
    return end < 0 ? after : after.slice(0, end);
}
const SECTION_TOTAL = /razem|ogółem|^\W*(total|suma)\b|összesen/i;
