// Ported from CatalystViewer (packages/core/src/bonds/fundamentals/filings/FilingParser.ts, 7e8a24c) for the Catalyst module's
// phase 2 (Docs/catalyst-phase2-plan.md, N3): functionality kept, imports adapted.

// Parses an annual financial statement as filed with the court register (KRS, Repozytorium Dokumentów
// Finansowych): the Ministry of Finance XML structures for companies under the Polish accounting act
// (JednostkaInna, SkonsolidowanaJednostkaInna; in złoty or in thousands). Each statement line has a fixed
// code (e.g. Pasywa_B_III_3_A = short-term bank loans), the same in schema versions 1-2 (2018) and
// 2-0E (2025), so figures are read in code, with no LLM, and every figure keeps the codes it came from.
//
// Not supported: small and micro entity structures (JednostkaMala, JednostkaMikro), banks, insurers,
// and IFRS reporters (they file ESEF/PDF, not these structures).
import { XMLParser } from 'fast-xml-parser';
import { itemsFromFigures, lineChecks, type LineItem, type StatementLine, type StatementName, markLineItems } from "./statementLines.ts";
import { KRS_LINE_LABELS } from "./krsLineLabels.ts";

export type FilingScope = 'single' | 'group';

export type FilingField =
    | 'revenue' | 'ebit' | 'depreciation' | 'interestExpense' | 'netProfit'
    | 'totalAssets' | 'intangibleAssets' | 'equity' | 'financialDebt' | 'cash'
    | 'currentAssets' | 'inventory' | 'currentLiabilities'
    | 'bonds' | 'minorityInterests' | 'operatingCashFlow' | 'capex';

// A figure in the filing's currency, with the statement lines or XBRL concepts it was computed from
// (e.g. "Bilans/Pasywa_B_III_3_A", "ifrs-full:NoncurrentLeaseLiabilities").
export type SourcedFigure = { value: number; source: string[] };

export type FilingPeriod = {
    column: 'current' | 'previous';  // KwotaA or KwotaB in the filing
    periodStart: string;             // YYYY-MM-DD
    periodEnd: string;
    months: number;                  // 12 for a full fiscal year
    figures: Partial<Record<FilingField, SourcedFigure>>;
    lines: StatementLine[];          // every line of the primary statements for this year
};

// How a PDF was read by a model (AiPdfExtractor)
export type FilingExtraction = { model: string; promptVersion: string; pages: number[]; inputTokens?: number; outputTokens?: number };

export type ParsedFiling = {
    // Polish accounting act XML (this file), IFRS inline XBRL (EsefParser), untagged IFRS (IfrsTextParser), PDF read by a model (AiPdfExtractor)
    format: 'krs-xml' | 'esef' | 'ifrs-text' | 'ai-pdf';
    scope: FilingScope;
    companyName: string;
    krs?: string;
    nip?: string;
    lei?: string;                    // ESEF filings identify the company by LEI only
    currency: string;                // ISO 4217; always PLN for krs-xml
    standard: 'ifrs' | 'pl-uor';     // IFRS, or the Polish accounting act (ustawa o rachunkowości)
    presentedUnit: 1 | 1000 | 1000000;  // how the filing printed amounts; values are always in units
    // Line values: 'printed' as the statement shows them (a cost in brackets is negative), or 'tagged'
    // as the filing's data has them (XBRL facts, KRS XML amounts: a cost is positive).
    lineSigns: 'printed' | 'tagged';
    schema: string;                  // e.g. "SFJINZ (2) 2-0E", "ESEF dom-2022-12-31-pl.xhtml"
    unitMultiplier?: 1 | 1000;       // krs-xml: filed in złoty or in thousands; figures are in units of currency
    preparedOn?: string;             // DataSporzadzenia
    incomeStatement?: 'comparative' | 'cost-of-sales';
    cashFlow?: 'indirect' | 'direct';
    periods: FilingPeriod[];         // current year first
    checks: string[];                // failed consistency checks; empty when the filing adds up
    notes?: string[];                // how figures were derived where the filing left a choice
    extraction?: FilingExtraction;   // ai-pdf: model, prompt version, pages read
};

type Node = Record<string, unknown>;

const ROOTS: Record<string, FilingScope> = {
    JednostkaInna: 'single',
    SkonsolidowanaJednostkaInna: 'group',
    // The e-sprawozdania app names the root by its unit too (Vehis Finanse FY2024–2025: JednostkaInnaWTys, the
    // 2025 one inside a Dokument/TrescDokumentu envelope); the unit itself is read from KodSprawozdania.
    JednostkaInnaWTys: 'single',
    JednostkaInnaWZlotych: 'single',
    SkonsolidowanaJednostkaInnaWTys: 'group',
    SkonsolidowanaJednostkaInnaWZlotych: 'group',
};
const UNSUPPORTED_ROOTS = [
    'JednostkaMala', 'JednostkaMikro', 'JednostkaOp', 'Bank', 'ZakladUbezpieczen', 'ZakladReasekuracji',
    'SKOK', 'DomMaklerski', 'ASI', 'SkonsolidowanyBank', 'SkonsolidowanyZakladUbezpieczen', 'SkonsolidowanyDomMaklerski',
];

// ─── XML helpers ────────────────────────────────────────────────────────────────

const parser = new XMLParser({
    removeNSPrefix: true,
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
    trimValues: true,
    // Some filers nest deeper than the default 100 (Vehis Finanse's 1.4 MB statement, 2026-11-04)
    maxNestedTags: 1000,
});

function isNode(value: unknown): value is Node {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function first(value: unknown): unknown {
    return Array.isArray(value) ? value[0] : value;
}

function text(value: unknown): string | undefined {
    const v = first(value);
    if (typeof v === 'string') return v.trim();
    if (typeof v === 'number') return String(v);
    if (isNode(v) && typeof v['#text'] === 'string') return (v['#text'] as string).trim();
    return undefined;
}

// Depth-first search for the first element with this local name.
function find(node: unknown, name: string): Node | undefined {
    const n = first(node);
    if (!isNode(n)) return undefined;
    if (name in n) {
        const hit = first(n[name]);
        if (isNode(hit)) return hit;
    }
    for (const [key, child] of Object.entries(n)) {
        if (key.startsWith('@_') || key === '#text') continue;
        for (const c of Array.isArray(child) ? child : [child]) {
            const hit = find(c, name);
            if (hit) return hit;
        }
    }
    return undefined;
}

function allTexts(node: unknown, out: string[] = []): string[] {
    const n = first(node);
    if (typeof n === 'string') out.push(n.trim());
    else if (isNode(n)) for (const [key, child] of Object.entries(n)) {
        if (key.startsWith('@_')) continue;
        for (const c of Array.isArray(child) ? child : [child]) allTexts(c, out);
    }
    return out;
}

function findRoot(doc: Node): { name: string; node: Node } | undefined {
    for (const name of [...Object.keys(ROOTS), ...UNSUPPORTED_ROOTS]) {
        const node = find(doc, name);
        if (node) return { name, node };
    }
    return undefined;
}

// ─── Statement sections ─────────────────────────────────────────────────────────

// One statement (balance sheet, income statement, cash flow): line code → [current, previous] in PLN.
class Section {
    readonly label: string;
    readonly node: Node | undefined;
    readonly multiplier: number;

    constructor(label: string, node: Node | undefined, multiplier: number) {
        this.label = label;
        this.node = node;
        this.multiplier = multiplier;
    }

    get present(): boolean {
        return this.node !== undefined;
    }

    // Lines missing from a present statement are zero: filers leave empty lines out.
    amount(code: string, column: 0 | 1): number | undefined {
        if (!this.node) return undefined;
        const line = code === this.rootCode ? this.node : find(this.node, code);
        if (!line) return undefined;
        const raw = text(line[column === 0 ? 'KwotaA' : 'KwotaB']);
        if (raw === undefined || raw === '') return undefined;
        const value = Number(raw.replace(/\s/g, '').replace(',', '.'));
        return Number.isFinite(value) ? value * this.multiplier : undefined;
    }

    has(code: string): boolean {
        return this.node !== undefined && (code === this.rootCode || find(this.node, code) !== undefined);
    }

    // Root lines like "Aktywa" are the section node itself in some files.
    private rootCode: string | undefined;
    withRootCode(code: string): this {
        this.rootCode = code;
        return this;
    }
}

function figure(section: Section, codes: string[], column: 0 | 1, opts: { sumMissingAsZero?: boolean } = {}): SourcedFigure | undefined {
    let total = 0;
    let found = 0;
    for (const code of codes) {
        const v = section.amount(code, column);
        if (v !== undefined) {
            total += v;
            found++;
        }
    }
    if (found === 0 && !(opts.sumMissingAsZero && section.present)) return undefined;
    return { value: round2(total), source: codes.map(c => `${section.label}/${c}`) };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

// ─── Statement lines ────────────────────────────────────────────────────────────

const STATEMENT_OF: Record<string, StatementName> = {
    Bilans: 'balance', RZiSPor: 'income', RZiSKalk: 'income', PrzeplywyPosr: 'cashFlow', PrzeplywyBezp: 'cashFlow',
};

// Items the scorecard figures don't give: [statement, code pattern, label pattern, item].
const KRS_ITEMS: [StatementName, RegExp, RegExp, LineItem][] = [
    ['balance', /^Aktywa_A$/, /./, 'noncurrentAssets'],
    ['balance', /^Aktywa_A_[IV]+$/, /^Rzeczowe aktywa trwałe$/, 'propertyPlantEquipment'],
    ['balance', /^Aktywa_A_[IV]+_1$/, /^Nieruchomości$/, 'investmentProperty'],
    ['balance', /^Pasywa$/, /./, 'totalEquityAndLiabilities'],
    ['balance', /^Pasywa_[BD]$/, /^Zobowiązania i rezerwy na zobowiązania$/, 'totalLiabilities'],
    ['balance', /^Pasywa_[BD]_II$/, /^Zobowiązania długoterminowe$/, 'noncurrentLiabilities'],
    ['balance', /^Pasywa_[BD]_I$/, /^Rezerwy na zobowiązania$/, 'provisions'],
    ['balance', /^Aktywa_B_II_/, /^z tytułu dostaw i usług/, 'tradeReceivables'],
    ['balance', /^Aktywa_/, /udzielone pożyczki/, 'loansGranted'],
    ['balance', /^Pasywa_/, /^z tytułu dostaw i usług/, 'tradePayables'],
    ['balance', /^Pasywa_/, /^zaliczki otrzymane na dostawy/, 'contractLiabilities'],
    ['income', /^[A-Z]$/, /^Koszty sprzedanych produktów, towarów i materiałów/, 'costOfSales'],
    ['income', /^[A-Z]$/, /^Zysk \(strata\) brutto ze sprzedaży/, 'grossProfit'],
    ['income', /^[A-Z]$/, /^Zysk \(strata\) brutto( \(|$)/, 'profitBeforeTax'],
    ['income', /^[A-Z]$/, /^Podatek dochodowy$/, 'incomeTax'],
    ['income', /^[A-Z]$/, /^Przychody finansowe$/, 'financeIncome'],
    ['income', /^[A-Z]$/, /^Koszty finansowe$/, 'financeCosts'],
    ['cashFlow', /^B_III$/, /./, 'investingCashFlow'],
    ['cashFlow', /^C_III$/, /./, 'financingCashFlow'],
    ['cashFlow', /^C_I_[23]$/, /./, 'borrowingsRaised'],
    ['cashFlow', /^C_II_2$/, /./, 'dividendsPaid'],
    ['cashFlow', /^C_II_[45]$/, /./, 'borrowingsRepaid'],
    ['cashFlow', /^C_II_8$/, /./, 'interestPaid'],
];

// Every line with an amount in the column, in the filing's order; a line's parent is the element it sits in.
function krsLines(sections: { section: Section; root?: string }[], scope: FilingScope, column: 0 | 1): StatementLine[] {
    const lines: StatementLine[] = [];
    const count: Partial<Record<StatementName, number>> = {};
    for (const { section, root } of sections) {
        if (!section.node) continue;
        const statement = STATEMENT_OF[section.label]!;
        const labels = KRS_LINE_LABELS[scope][section.label] ?? {};
        const visit = (node: Node, code: string | undefined, parent: number | undefined) => {
            let order = parent;
            if (code) {
                const amounts = isNode(first(node['KwotyPozycji'])) ? first(node['KwotyPozycji']) as Node : node;
                const raw = text(amounts[column === 0 ? 'KwotaA' : 'KwotaB']);
                const value = raw === undefined || raw === '' ? NaN : Number(raw.replace(/\s/g, '').replace(',', '.'));
                if (Number.isFinite(value)) {
                    // Detail lines the filer adds (PozycjaUszczegolawiajaca) carry their own name.
                    const ownName = text(node['NazwaPozycji']);
                    order = count[statement] = (count[statement] ?? -1) + 1;
                    lines.push({
                        statement, order,
                        label: ownName ?? labels[code] ?? code,
                        value: round2(value * section.multiplier),
                        ...(ownName ? {} : { code }),
                        ...(parent !== undefined ? { parent } : {}),
                    });
                }
            }
            for (const [key, child] of Object.entries(node)) {
                if (key.startsWith('@_') || key === '#text' || key.startsWith('Kwot') || key === 'NazwaPozycji') continue;
                for (const c of Array.isArray(child) ? child : [child]) if (isNode(c)) visit(c, key, order);
            }
        };
        // The balance sheet's root lines (Aktywa, Pasywa) are the section nodes themselves.
        visit(section.node, root, undefined);
    }
    for (const line of lines) {
        const rule = line.code && KRS_ITEMS.find(([s, code, label]) => s === line.statement && code.test(line.code!) && label.test(line.label));
        if (rule) line.item = rule[3];
    }
    markLineItems(lines);
    return lines;
}

// ─── Line codes ─────────────────────────────────────────────────────────────────

// Balance sheet lines per scope. Group balance sheets add goodwill of subsidiaries (Aktywa_A_II) and
// minority interests (Pasywa_B), so liabilities move from Pasywa_B to Pasywa_D and cash from _C to _D.
const BALANCE: Record<FilingScope, {
    intangible: string[]; cash: string; liabilities: string; longTerm: string; shortTerm: string; minority?: string; netProfit: string;
}> = {
    single: { intangible: ['Aktywa_A_I'], cash: 'Aktywa_B_III_1_C', liabilities: 'Pasywa_B', longTerm: 'Pasywa_B_II', shortTerm: 'Pasywa_B_III', netProfit: 'Pasywa_A_VI' },
    group: { intangible: ['Aktywa_A_I', 'Aktywa_A_II'], cash: 'Aktywa_B_III_1_D', liabilities: 'Pasywa_D', longTerm: 'Pasywa_D_II', shortTerm: 'Pasywa_D_III', minority: 'Pasywa_B', netProfit: 'Pasywa_A_VII' },
};

// Financial debt owed to third parties: bank loans (A), bonds (B), other financial liabilities incl.
// leases (C), bills of exchange (D long-term, F short-term). Liabilities to related parties
// (…_1) aren't itemised in the filing, so they aren't included.
function debtCodes(longTerm: string, shortTerm: string): { all: string[]; bonds: string[] } {
    return {
        all: [`${longTerm}_3_A`, `${longTerm}_3_B`, `${longTerm}_3_C`, `${longTerm}_3_D`,
              `${shortTerm}_3_A`, `${shortTerm}_3_B`, `${shortTerm}_3_C`, `${shortTerm}_3_F`],
        bonds: [`${longTerm}_3_B`, `${shortTerm}_3_B`],
    };
}

// Income statement lines per variant and scope: [revenue, EBIT, depreciation, interest, net profit].
const INCOME: Record<'comparative' | 'cost-of-sales', Record<FilingScope, { ebit: string; interest: string; netProfit: string; depreciation?: string }>> = {
    'comparative': {
        single: { ebit: 'F', interest: 'H_I', netProfit: 'L', depreciation: 'B_I' },
        group: { ebit: 'F', interest: 'H_I', netProfit: 'S', depreciation: 'B_I' },
    },
    'cost-of-sales': {
        single: { ebit: 'I', interest: 'K_I', netProfit: 'O' },
        group: { ebit: 'I', interest: 'K_I', netProfit: 'W' },
    },
};

// ─── Periods ────────────────────────────────────────────────────────────────────

function monthsBetween(start: string, end: string): number {
    const s = new Date(`${start}T00:00:00Z`);
    const e = new Date(`${end}T00:00:00Z`);
    e.setUTCDate(e.getUTCDate() + 1); // the end date is inclusive
    return (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + (e.getUTCMonth() - s.getUTCMonth()) + (e.getUTCDate() - s.getUTCDate()) / 31;
}

function shiftYear(date: string, years: number): string {
    const d = new Date(`${date}T00:00:00Z`);
    const day = d.getUTCDate();
    d.setUTCFullYear(d.getUTCFullYear() + years);
    if (d.getUTCDate() !== day) d.setUTCDate(0); // 29 Feb → 28 Feb
    return d.toISOString().slice(0, 10);
}

// ─── Entry point ────────────────────────────────────────────────────────────────

export class UnsupportedFilingError extends Error {}

// A statement inside a binary signature file (CAdES / PKCS#7, e.g. "….xml.cfg.xades" from the KRS browser):
// the XML is stored as it is between binary headers, so it's cut out from its first tag to the root's end.
export function embeddedStatementXml(text: string): string | undefined {
    if (text.replace(/^\uFEFF/, '').trimStart().startsWith('<')) return undefined;
    const start = text.search(/<\?xml|<(?:[\w-]+:)?(?:Skonsolidowana)?Jednostka\w*[\s>]/);
    if (start < 0) return undefined;
    const ends = [...text.slice(start).matchAll(/<\/(?:[\w-]+:)?(?:Skonsolidowana)?Jednostka\w*>/g)];
    const last = ends.at(-1);
    return last ? text.slice(start, start + last.index + last[0].length) : undefined;
}

export function parseFiling(xml: string): ParsedFiling {
    xml = embeddedStatementXml(xml) ?? xml;
    let doc = parser.parse(xml) as Node;
    let root = findRoot(doc);

    // A signed file (XAdES) can carry the statement base64-encoded inside the signature. The signature value
    // and certificates are base64 too, so every long block is tried, longest first, and the one that decodes to a
    // statement is used (Vehis Finanse's KRS files: the signature value comes first). A signature can wrap another.
    for (let depth = 0; !root && depth < 3; depth++) {
        const blocks = allTexts(doc).filter(t => t.length > 200 && /^[A-Za-z0-9+/=\s]+$/.test(t)).sort((a, b) => b.length - a.length);
        let inner: Node | undefined;
        for (const block of blocks) {
            const text = Buffer.from(block.replace(/\s/g, ''), 'base64').toString('utf-8');
            if (!/<(?:[\w-]+:)?(?:Skonsolidowana)?Jednostka\w*[\s>]|<(?:[\w-]+:)?Signature[\s>]/.test(text)) continue;
            inner = parser.parse(text) as Node;
            break;
        }
        if (!inner) break;
        doc = inner;
        root = findRoot(doc);
    }
    if (!root) {
        throw new UnsupportedFilingError('Not a financial statement in the Ministry of Finance XML structure (JednostkaInna / SkonsolidowanaJednostkaInna)');
    }
    const scope = ROOTS[root.name];
    if (!scope) {
        throw new UnsupportedFilingError(`Structure "${root.name}" isn't supported yet: only JednostkaInna (single company) and SkonsolidowanaJednostkaInna (group)`);
    }
    const r = root.node;

    // Header
    const header = find(r, 'Naglowek');
    const codeNode = first(header?.['KodSprawozdania']);
    const reportCode = text(codeNode) ?? '';
    const unitMultiplier = /WTysiacach/i.test(reportCode) ? 1000 : 1;
    const schema = isNode(codeNode)
        ? `${codeNode['@_kodSystemowy'] ?? reportCode} ${codeNode['@_wersjaSchemy'] ?? ''}`.trim()
        : reportCode;
    const periodStart = text(header?.['OkresOd']);
    const periodEnd = text(header?.['OkresDo']);
    if (!periodStart || !periodEnd) {
        throw new UnsupportedFilingError('The filing has no reporting period (Naglowek/OkresOd, OkresDo)');
    }

    // Identity: company name, NIP, KRS (field positions differ between schema versions, so by pattern:
    // a KRS number is 10 digits starting with 00, a NIP never starts with 0).
    const identity = find(r, 'P_1');
    const companyName = text(find(identity, 'P_1A')?.['NazwaFirmy']) ?? text(find(r, 'NazwaFirmy')) ?? '';
    const ids = allTexts(identity).map(t => t.replace(/[\s-]/g, '')).filter(t => /^\d{10}$/.test(t));
    const krs = ids.find(t => t.startsWith('00'));
    const nip = ids.find(t => !t.startsWith('0'));

    // Statements
    const balanceNode = find(r, 'Bilans');
    const incomeNode = find(r, 'RZiS');
    const comparative = find(incomeNode, 'RZiSPor');
    const costOfSales = find(incomeNode, 'RZiSKalk');
    const cashFlowNode = find(r, 'RachPrzeplywow');
    const indirect = find(cashFlowNode, 'PrzeplywyPosr');
    const direct = find(cashFlowNode, 'PrzeplywyBezp');
    if (!balanceNode || !(comparative || costOfSales)) {
        throw new UnsupportedFilingError('The filing has no balance sheet (Bilans) or income statement (RZiSPor / RZiSKalk)');
    }

    const incomeStatement = comparative ? 'comparative' : 'cost-of-sales';
    const assets = new Section('Bilans', find(balanceNode, 'Aktywa'), unitMultiplier).withRootCode('Aktywa');
    const liabilities = new Section('Bilans', find(balanceNode, 'Pasywa'), unitMultiplier).withRootCode('Pasywa');
    const income = new Section(comparative ? 'RZiSPor' : 'RZiSKalk', comparative ?? costOfSales, unitMultiplier);
    const cashFlow = new Section(indirect ? 'PrzeplywyPosr' : 'PrzeplywyBezp', indirect ?? direct, unitMultiplier);

    const b = BALANCE[scope];
    const inc = INCOME[incomeStatement][scope];
    const debt = debtCodes(b.longTerm, b.shortTerm);
    const checks: string[] = [];

    const periods: FilingPeriod[] = ([0, 1] as const).flatMap(column => {
        const start = column === 0 ? periodStart : shiftYear(periodStart, -1);
        const end = column === 0 ? periodEnd : shiftYear(periodEnd, -1);
        const label = column === 0 ? periodEnd : `${end} (comparative)`;

        const figures: FilingPeriod['figures'] = {
            revenue: figure(income, ['A'], column),
            ebit: figure(income, [inc.ebit], column),
            // The cost-of-sales income statement has no depreciation line; the indirect cash flow does.
            depreciation: inc.depreciation ? figure(income, [inc.depreciation], column)
                : indirect ? figure(cashFlow, ['A_II_1'], column) : undefined,
            interestExpense: figure(income, [inc.interest], column, { sumMissingAsZero: true }),
            netProfit: figure(income, [inc.netProfit], column),
            totalAssets: figure(assets, ['Aktywa'], column),
            intangibleAssets: figure(assets, b.intangible, column, { sumMissingAsZero: true }),
            equity: figure(liabilities, ['Pasywa_A'], column),
            financialDebt: figure(liabilities, debt.all, column, { sumMissingAsZero: true }),
            bonds: figure(liabilities, debt.bonds, column, { sumMissingAsZero: true }),
            cash: figure(assets, [b.cash], column, { sumMissingAsZero: true }),
            currentAssets: figure(assets, ['Aktywa_B'], column),
            inventory: figure(assets, ['Aktywa_B_I'], column, { sumMissingAsZero: true }),
            currentLiabilities: figure(liabilities, [b.shortTerm], column, { sumMissingAsZero: true }),
            minorityInterests: b.minority ? figure(liabilities, [b.minority], column, { sumMissingAsZero: true }) : undefined,
            operatingCashFlow: cashFlow.present ? figure(cashFlow, ['A_III'], column) : undefined,
            capex: cashFlow.present ? figure(cashFlow, ['B_II_1'], column, { sumMissingAsZero: true }) : undefined,
        };
        for (const key of Object.keys(figures) as FilingField[]) {
            if (figures[key] === undefined) delete figures[key];
        }
        const lines = krsLines([{ section: assets, root: 'Aktywa' }, { section: liabilities, root: 'Pasywa' }, { section: income }, { section: cashFlow }], scope, column);
        const byCode = new Map(lines.filter(l => l.code).map(l => [`${l.statement}|${l.code}`, l]));
        itemsFromFigures(lines, figures, source => {
            const [section, code] = source.split('/');
            return byCode.get(`${STATEMENT_OF[section!]}|${code}`);
        });

        // No comparative column at all (first fiscal year): only the current period.
        if (column === 1 && figures.totalAssets === undefined && figures.revenue === undefined) return [];

        // Consistency checks (tolerance: one unit as filed, for rounding)
        const tolerance = unitMultiplier;
        const totalAssets = assets.amount('Aktywa', column);
        const totalLiabilities = liabilities.amount('Pasywa', column);
        if (totalAssets !== undefined && totalLiabilities !== undefined && Math.abs(totalAssets - totalLiabilities) > tolerance) {
            checks.push(`${label}: total assets ${fmt(totalAssets)} ≠ total equity and liabilities ${fmt(totalLiabilities)}`);
        }
        const assetParts = ['Aktywa_A', 'Aktywa_B', 'Aktywa_C', 'Aktywa_D'].map(c => assets.amount(c, column) ?? 0).reduce((a, v) => a + v, 0);
        if (totalAssets !== undefined && Math.abs(totalAssets - assetParts) > tolerance) {
            checks.push(`${label}: total assets ${fmt(totalAssets)} ≠ sum of fixed and current assets ${fmt(assetParts)}`);
        }
        const netProfitIncome = income.amount(inc.netProfit, column);
        const netProfitBalance = liabilities.amount(b.netProfit, column);
        if (netProfitIncome !== undefined && netProfitBalance !== undefined && Math.abs(netProfitIncome - netProfitBalance) > tolerance) {
            checks.push(`${label}: net profit ${fmt(netProfitIncome)} in the income statement ≠ ${fmt(netProfitBalance)} in the balance sheet`);
        }
        checks.push(...lineChecks(lines, label, tolerance, ['totalEquityAndLiabilities']));   // assets are checked above

        return [{ column: column === 0 ? 'current' : 'previous', periodStart: start, periodEnd: end, months: Math.round(monthsBetween(start, end)), figures, lines }];
    });

    return {
        format: 'krs-xml',
        scope,
        companyName,
        krs,
        nip,
        currency: 'PLN',
        standard: 'pl-uor',
        presentedUnit: unitMultiplier,
        lineSigns: 'tagged',
        schema,
        unitMultiplier,
        preparedOn: text(header?.['DataSporzadzenia']),
        incomeStatement,
        cashFlow: indirect ? 'indirect' : direct ? 'direct' : undefined,
        periods,
        checks,
    };
}

function fmt(value: number): string {
    return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}
