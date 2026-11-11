// Ported from CatalystViewer (packages/core/src/bonds/fundamentals/maturities.ts, 7e8a24c) for the Catalyst module's
// phase 2 (Docs/catalyst-phase2-plan.md, N4): functionality kept, imports adapted.

// Bond maturities vs cash: an issuer's listed bonds due in the next 12 and 24 months against the cash
// and operating cash flow of its latest imported report. Design: docs/superpowers/specs/2026-11-03-bond-maturities-vs-cash-design.md
import type { Bands, DimensionResult, Signal } from "./scorecard.ts";
import type { DbIssuerFinancialsRecord } from "./financialsRecord.ts";

// issueValue: the amount still owed (issued, less instalments already repaid); issued: as issued, when more;
// instalments: the payments still due before maturity (from the terms of issue: an amortization schedule), the
// rest of the amount owed at maturity. Absent: the schedule isn't known; empty: none (a bullet bond).
export type Instalment = { date: string; amount: number };
export type ListedBond = { isin: string; name: string; currency: string; issueValue: number; maturityDay: string; issued?: number; instalments?: Instalment[] };

/**
 * The instalments still ahead of a bond, in its currency, from its amortization schedule (the nominal per bond after
 * each instalment): `issueValue` as issued at `issuedNominal`, the bond at `nominal` now. An instalment whose nominal
 * the bond is already at or below has been paid.
 */
export function instalmentsAhead(issueValue: number, issuedNominal: number, nominal: number, schedule: { date: string; nominalAfter: number }[]): Instalment[] {
    const out: Instalment[] = [];
    let before = nominal;
    for (const s of [...schedule].sort((a, b) => a.date.localeCompare(b.date))) {
        if (s.nominalAfter >= before) continue;
        out.push({ date: s.date, amount: issueValue * (before - s.nominalAfter) / issuedNominal });
        before = s.nominalAfter;
    }
    return out;
}

// What a bond still owes: the issue value at its current nominal. An instalment redemption lowers the nominal
// (Kruk KRU0228: 1,000 → 550), so 350m issued is 192.5m owed; `issued` is set then. An indexed nominal
// (IZ treasury bonds) rises with inflation: the owed amount follows it, with no instalments.
export function amountOwed(issueValue: number, nominal: number, issuedNominal: number | undefined): { owed: number; issued?: number } {
    if (!issuedNominal || !(nominal > 0) || Math.abs(nominal - issuedNominal) < 0.005) return { owed: issueValue };
    const owed = issueValue * nominal / issuedNominal;
    return nominal < issuedNominal ? { owed, issued: issueValue } : { owed };
}

// PLN per one unit of a currency (NBP table A); PLN itself is 1.
export type Rates = Record<string, number>;

export type ScheduledBond = {
    isin: string;
    name: string;
    maturityDay: string;      // YYYY-MM-DD
    currency: string;
    amount: number;           // owed, units of its currency
    issued?: number;          // as issued, when instalments have been repaid
    inReportCurrency?: number;  // undefined when there's no rate for its currency
    // Every payment of principal still due, instalments first, the rest at maturity; only when the schedule is known.
    payments?: { date: string; amount: number; inReportCurrency?: number }[];
};

export type Refinancing = {
    bonds: ScheduledBond[];   // by maturity
    report?: {
        periodEnd: string;
        scope: 'single' | 'group';
        currency: string;
        cash?: number;
        operatingCashFlow?: number;
        balanceSheetBonds?: number;   // the bonds line(s) of the balance sheet, listed or not
        due12: number;                // in the report's currency, bonds with a rate only
        due24: number;
        listed: number;               // all listed bonds
        cashCover12?: number;         // cash ÷ due in 12 months
        liquidityCover24?: number;    // (cash + 2 × operating cash flow) ÷ due in 24 months
    };
    signal: Signal;
    notes: string[];
};

const GREEN = 1.5;
const YELLOW = 0.75;

function addMonths(day: string, months: number): string {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + months);
    return d.toISOString().slice(0, 10);
}

const fmt = (units: number) => (units / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 0 });

// The latest full fiscal year, group accounts first (as the scorecard takes it).
export function latestReport(filings: DbIssuerFinancialsRecord[]): DbIssuerFinancialsRecord | undefined {
    const full = filings.filter(r => r.months === 12);
    const scope = full.some(r => r.scope === 'group') ? 'group' : 'single';
    return full.filter(r => r.scope === scope).sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))[0];
}

export function refinancing(bonds: ListedBond[], report: DbIssuerFinancialsRecord | undefined, today: string, rates: Rates): Refinancing {
    const reportCurrency = report?.currency ?? 'PLN';
    const rate = (c: string) => (c === 'PLN' ? 1 : rates[c]);
    const byIsin = new Map<string, ListedBond>();
    for (const b of bonds) if (b.maturityDay.slice(0, 10) >= today && !byIsin.has(b.isin)) byIsin.set(b.isin, b);
    const scheduled = [...byIsin.values()]
        .map((b): ScheduledBond => {
            const from = rate(b.currency);
            const to = rate(reportCurrency);
            const conv = (v: number) => (from && to ? { inReportCurrency: v * from / to } : {});
            const maturityDay = b.maturityDay.slice(0, 10);
            const ahead = b.instalments?.filter(i => i.date >= today && i.date < maturityDay && i.amount > 0);
            const early = ahead?.reduce((s, i) => s + i.amount, 0) ?? 0;
            const payments = ahead && [...ahead, { date: maturityDay, amount: Math.max(0, b.issueValue - early) }].map(p => ({ ...p, ...conv(p.amount) }));
            return {
                isin: b.isin, name: b.name, maturityDay, currency: b.currency, amount: b.issueValue,
                ...(b.issued !== undefined ? { issued: b.issued } : {}),
                ...conv(b.issueValue),
                ...(payments && payments.length > 1 ? { payments } : {}),
            };
        })
        .sort((a, b) => a.maturityDay.localeCompare(b.maturityDay) || a.name.localeCompare(b.name));

    const notes: string[] = [];
    const unconverted = [...new Set(scheduled.filter(b => b.inReportCurrency === undefined).map(b => b.currency))];
    if (unconverted.length) notes.push(`no exchange rate for ${unconverted.join(', ')}: those bonds are left out of the totals`);
    if (!report) return { bonds: scheduled, signal: 'na', notes };

    // Instalments on their own dates when the schedule is known, else the whole amount at maturity.
    const due = (until: string) => scheduled.reduce((s, b) => s + (b.inReportCurrency === undefined ? 0
        : b.payments ? b.payments.filter(p => p.date <= until).reduce((t, p) => t + (p.inReportCurrency ?? 0), 0)
        : b.maturityDay <= until ? b.inReportCurrency : 0), 0);
    const due12 = due(addMonths(today, 12));
    const due24 = due(addMonths(today, 24));
    const listed = scheduled.reduce((s, b) => s + (b.inReportCurrency ?? 0), 0);
    const cash = report.figures.cash?.value;
    const operatingCashFlow = report.figures.operatingCashFlow?.value;
    const balanceSheetBonds = report.figures.bonds?.value;
    const cashCover12 = cash !== undefined && due12 > 0 ? cash / due12 : undefined;
    const liquidityCover24 = cash !== undefined && operatingCashFlow !== undefined && due24 > 0 ? (cash + 2 * operatingCashFlow) / due24 : undefined;

    let signal: Signal;
    if (cash === undefined) signal = 'na';
    else if (due24 === 0) signal = 'green';
    else {
        // The weaker cover; without an operating cash flow, cash alone against 24 months
        const covers = [cashCover12, liquidityCover24 ?? cash / due24].filter((c): c is number => c !== undefined);
        const weakest = Math.min(...covers);
        signal = weakest >= GREEN ? 'green' : weakest >= YELLOW ? 'yellow' : 'red';
    }

    notes.push(`cash from the report at ${report.periodEnd}; bonds due counted from ${today}`);
    notes.push('listed bonds only, as issued less instalments repaid: loans, unlisted bonds and bonds bought back are not included');
    const amortizing = scheduled.filter(b => b.payments);
    if (amortizing.length) notes.push(`${amortizing.map(b => `${b.name} (${b.payments!.slice(0, -1).map(p => `${(p.amount / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 1 })} m on ${p.date}`).join(', ')})`).join('; ')}: instalments counted on their dates, from the terms of issue`);
    const unknown = scheduled.filter(b => b.issued !== undefined && !b.payments && !bonds.find(x => x.isin === b.isin)?.instalments);
    if (unknown.length) notes.push(`${unknown.map(b => b.name).join(', ')}: repaid in instalments, the amount still owed is counted at maturity (the dates of later instalments aren't known)`);
    if (balanceSheetBonds !== undefined && balanceSheetBonds > 0 && Math.abs(listed - balanceSheetBonds) > 0.05 * balanceSheetBonds) {
        notes.push(`listed bonds ${fmt(listed)} m vs ${fmt(balanceSheetBonds)} m of bonds in the balance sheet`);
    }
    if (cash !== undefined && due24 > 0 && operatingCashFlow === undefined) notes.push('no operating cash flow in the report: cash alone');

    return {
        bonds: scheduled,
        report: {
            periodEnd: report.periodEnd, scope: report.scope, currency: reportCurrency,
            ...(cash !== undefined ? { cash } : {}),
            ...(operatingCashFlow !== undefined ? { operatingCashFlow } : {}),
            ...(balanceSheetBonds !== undefined ? { balanceSheetBonds } : {}),
            due12, due24, listed,
            ...(cashCover12 !== undefined ? { cashCover12 } : {}),
            ...(liquidityCover24 !== undefined ? { liquidityCover24 } : {}),
        },
        signal,
        notes,
    };
}

const COVER_BANDS: Bands = { better: 'higher', green: GREEN, yellow: YELLOW, unit: 'x' };
const coverSignal = (v: number | undefined, nothingDue: boolean): Signal =>
    v === undefined ? (nothingDue ? 'green' : 'na') : v >= GREEN ? 'green' : v >= YELLOW ? 'yellow' : 'red';

// The scorecard dimension; undefined without a report.
export function refinancingDimension(r: Refinancing): DimensionResult | undefined {
    const rep = r.report;
    if (!rep) return undefined;
    const money = (v: number) => `${fmt(v)} m ${rep.currency}`;
    const ratio = (v: number | undefined, nothingDue: boolean) => (v === undefined ? (nothingDue ? 'nothing due' : 'n/a') : `${v.toFixed(2)}×`);
    return {
        name: 'Refinancing',
        signal: r.signal,
        metrics: [
            { name: 'Bonds due in 12 months', value: rep.due12, formattedValue: money(rep.due12), signal: 'na' },
            { name: 'Bonds due in 24 months', value: rep.due24, formattedValue: money(rep.due24), signal: 'na' },
            { name: 'Cash cover, 12 months', value: rep.cashCover12 ?? null, formattedValue: ratio(rep.cashCover12, rep.due12 === 0), signal: rep.cash === undefined ? 'na' : coverSignal(rep.cashCover12, rep.due12 === 0), bands: COVER_BANDS },
            { name: 'Cash + operating cash flow cover, 24 months', value: rep.liquidityCover24 ?? null, formattedValue: ratio(rep.liquidityCover24, rep.due24 === 0), signal: rep.cash === undefined ? 'na' : coverSignal(rep.liquidityCover24, rep.due24 === 0), bands: COVER_BANDS },
        ],
        notes: r.notes,
    };
}
