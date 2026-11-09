// Ported from CatalystViewer (packages/core/src/bonds/fundamentals/scorecard.ts, 7e8a24c) for the Catalyst module's
// phase 2 (Docs/catalyst-phase2-plan.md, N4): functionality kept, imports adapted.

import type { DataConfidence } from "./confidence.ts";

export type Signal = 'green' | 'yellow' | 'red' | 'na';

export type FinancialYearData = {
  issuerName: string;
  year: number;
  revenue?: number;
  ebit?: number;
  depreciation?: number;
  interestExpense?: number;
  netProfit?: number;
  totalAssets?: number;
  intangibleAssets?: number;
  equity?: number;
  financialDebt?: number;
  cash?: number;
  currentAssets?: number;
  inventory?: number;
  currentLiabilities?: number;
  // From imported reports only (statement lines); the AI-collected figures don't have them
  operatingCashFlow?: number;
  capex?: number;              // paid, positive
  investmentProperty?: number;
  contractLiabilities?: number;  // customer and buyer advances
  leases?: number;             // lease liabilities, part of financialDebt
  interestPaid?: number;       // cash flow, positive
  writeDowns?: number;         // write-downs of non-financial assets in EBIT, not in depreciation
  ebitDerived?: number;        // 1 when EBIT is profit before tax and net finance costs: the income statement prints no operating profit
  // Lenders' inputs, from imported reports only
  profitBeforeTax?: number;
  bonds?: number;              // bonds lines, part of financialDebt
  securitisation?: number;     // securitisation funding, part of financialDebt
  debtDueWithinYear?: number;  // debt lines under current liabilities
  bondsInOtherFinancialLiabilities?: number;  // bonds read from "other financial liabilities" (no bonds line)
};

export type MetricResult = {
  name: string;
  value: number | null;
  formattedValue: string;
  signal: Signal;
  scored?: false;      // shown for context, not counted in the dimension's signal
};

export type DimensionResult = {
  name: string;
  signal: Signal;
  metrics: MetricResult[];
  notes?: string[];   // caveats shown with the metrics
};

export type FundamentalScorecard = {
  dimensions: DimensionResult[];
  ruleSet?: RuleSet;
  confidence?: DataConfidence;   // added by the API, from the figures' source
};

// ─── Rule sets ────────────────────────────────────────────────────────────────

// Which metrics and thresholds a company is judged by, from its industry (design: 2026-11-03-sector-rules-design.md).
export type RuleSet = 'general' | 'developer' | 'contractor' | 'consumer' | FinanceRuleSet;

// Lenders' rule sets (design: 2026-11-05-finance-rules-design.md). Industry "Finance" doesn't tell a debt
// collector from a bank, so they're chosen by name; a Finance issuer not listed has no scorecard.
export type FinanceRuleSet = 'collector' | 'leasing' | 'investment';
const FINANCE_RULE_SETS: Record<string, FinanceRuleSet> = {
  'Kruk S.A.': 'collector',
  'Best S.A.': 'collector',
  'Best Niestandaryzowany FIZ Wierzytelności': 'collector',
  'Kredyt Inkaso S.A.': 'collector',
  'Vindexus Giełda Praw Majątkowych S.A.': 'collector',
  'Grupa Corpus Iuris S.A.': 'collector',
  'Indos S.A.': 'collector',
  'Vehis Finanse Sp. z o.o.': 'leasing',
  'Internetowy Fundusz Leasingowy S.A.': 'leasing',
  'AOW Faktoring S.A.': 'leasing',
  'PragmaGO S.A.': 'leasing',
  'MCI Management Sp. z o.o.': 'investment',
};

export function financeRuleSetFor(issuerName: string | undefined): FinanceRuleSet | undefined {
  return issuerName ? FINANCE_RULE_SETS[issuerName] : undefined;
}

const isLender = (rules: RuleSet): rules is FinanceRuleSet => rules === 'collector' || rules === 'leasing' || rules === 'investment';

const RULE_SET_OF: Record<string, RuleSet> = {
  Developer: 'developer',
  Construction: 'contractor',
  Retail: 'consumer', Telecommunications: 'consumer', Media: 'consumer', Other: 'consumer',
};

// Issuers whose industry's rules don't fit their business model.
const RULE_SET_OVERRIDES: Record<string, RuleSet> = {
  // An IT distributor classified Retail: it holds stock on its own money, unlike a shop
  'AB S.A.': 'general',
};

export function ruleSetFor(industry: string | undefined, issuerName?: string): RuleSet {
  return financeRuleSetFor(issuerName) || (issuerName && RULE_SET_OVERRIDES[issuerName]) || (industry && RULE_SET_OF[industry]) || 'general';
}

// ─── Signal helpers ────────────────────────────────────────────────────────────

function signalFromValue(
  value: number | null | undefined,
  greenFn: (v: number) => boolean,
  yellowFn: (v: number) => boolean,
): Signal {
  if (value == null || !Number.isFinite(value)) return 'na';
  if (greenFn(value)) return 'green';
  if (yellowFn(value)) return 'yellow';
  return 'red';
}

function div(a: number | undefined, b: number | undefined): number | null {
  if (a == null || b == null || b === 0) return null;
  return a / b;
}

function pct(value: number | null): string {
  if (value == null) return 'n/a';
  return `${(value * 100).toFixed(1)}%`;
}

function mult(value: number | null, decimals = 2): string {
  if (value == null) return 'n/a';
  return `${value.toFixed(decimals)}×`;
}

// EBITDA and EBIT before write-downs of non-financial assets (a non-cash one-off, e.g. a goodwill write-down)
function ebitBeforeWriteDowns(year: FinancialYearData): number | undefined {
  return year.ebit == null ? undefined : year.ebit + Math.max(0, year.writeDowns ?? 0);
}
function ebitdaOf(year: FinancialYearData): number | undefined {
  const ebit = ebitBeforeWriteDowns(year);
  return ebit != null && year.depreciation != null ? ebit + year.depreciation : undefined;
}
function netDebtOf(year: FinancialYearData): number | undefined {
  return year.financialDebt != null && year.cash != null ? year.financialDebt - year.cash : undefined;
}
function ebitNotes(year: FinancialYearData): string[] {
  return [
    ...(year.ebitDerived ? ['EBIT derived as profit before tax plus net finance costs (no operating profit line in the report); it includes results of associates and joint ventures'] : []),
    ...(year.writeDowns != null && year.writeDowns > 0
      ? [`EBIT and EBITDA before a ${year.writeDowns.toLocaleString('en-US', { maximumFractionDigits: year.writeDowns < 10 ? 1 : 0 })} m write-down of non-financial assets`]
      : []),
  ];
}

const metric = (name: string, value: number | null, formattedValue: string, signal: Signal): MetricResult => ({ name, value, formattedValue, signal });
const shown = (name: string, value: number | null, formattedValue: string): MetricResult => ({ name, value, formattedValue, signal: 'na', scored: false });
const dimension = (name: string, metrics: MetricResult[], notes: string[] = []): DimensionResult => ({
  name, signal: worstSignal(metrics.filter(m => m.scored !== false)), metrics, ...(notes.length ? { notes } : {}),
});
const lower = (green: number, yellow: number) => (v: number | null) => signalFromValue(v, x => x < green, x => x <= yellow);
const higher = (green: number, yellow: number) => (v: number | null) => signalFromValue(v, x => x > green, x => x >= yellow);

// ─── Dimension 1 — Debt Burden ────────────────────────────────────────────────

function deMetric(year: FinancialYearData, name = 'D/E', green = 1.0, yellow = 2.0, debt = year.financialDebt): MetricResult {
  const de = div(debt, year.equity);
  // Negative equity means the company owes more than it owns — always red
  const signal: Signal = de == null ? 'na' : year.equity != null && year.equity <= 0 ? 'red' : lower(green, yellow)(de);
  return metric(name, de, mult(de), signal);
}

function ndEbitdaMetric(year: FinancialYearData, name: string, green: number, yellow: number, netDebt = netDebtOf(year)): MetricResult {
  const ebitda = ebitdaOf(year);
  const value = div(netDebt, ebitda);
  // Negative EBITDA means no operating cash generation — always red
  const signal: Signal = value == null ? 'na' : ebitda != null && ebitda <= 0 ? 'red' : lower(green, yellow)(value);
  return metric(name, value, mult(value), signal);
}

function lenderDebtNotes(year: FinancialYearData): string[] {
  const m = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 1 });
  return [
    ...(year.securitisation ? [`Debt includes ${m(year.securitisation)} m of securitisation funding${year.financialDebt ? ` (${pct(year.securitisation / year.financialDebt)} of debt)` : ''}; bondholders rank behind it`] : []),
    ...(year.bondsInOtherFinancialLiabilities ? [`Bonds taken from "other financial liabilities" (${m(year.bondsInOtherFinancialLiabilities)} m): the report has no bonds line`] : []),
  ];
}

function computeLenderDebtBurden(year: FinancialYearData, rules: FinanceRuleSet): DimensionResult {
  const netDebt = netDebtOf(year) ?? year.financialDebt;   // no cash figure: gross debt
  const notes = [...lenderDebtNotes(year), ...(netDebtOf(year) == null && year.financialDebt != null ? ['No cash figure: net debt is gross debt'] : [])];
  const bondsShare = div(year.bonds, year.financialDebt);
  const bondsMetric = shown('Bonds/Financial Debt', bondsShare, pct(bondsShare));
  if (rules === 'investment') {
    const ltv = div(netDebt, year.totalAssets);
    return dimension('Debt Burden', [metric('Net Debt/Total Assets', ltv, pct(ltv), lower(0.25, 0.40)(ltv)), bondsMetric], notes);
  }
  const [green, yellow] = rules === 'collector' ? [1.5, 2.5] : [4.0, 6.0];
  return dimension('Debt Burden', [deMetric(year, 'Net Debt/Equity', green, yellow, netDebt), bondsMetric], notes);
}

function computeDebtBurden(year: FinancialYearData, rules: RuleSet): DimensionResult {
  if (isLender(rules)) return computeLenderDebtBurden(year, rules);
  const notes = ebitNotes(year);
  if (rules === 'developer') {
    const netDebt = netDebtOf(year);
    const stock = year.inventory != null ? year.inventory + (year.investmentProperty ?? 0) : undefined;
    const ndStock = div(netDebt, stock);
    return dimension('Debt Burden', [
      metric('Net Debt/(Inventory + Investment Property)', ndStock, mult(ndStock), lower(0.3, 0.6)(ndStock)),
      deMetric(year, 'Net Debt/Equity', 0.5, 1.0, netDebt),
    ]);
  }
  if (rules === 'consumer') {
    const netDebt = netDebtOf(year);
    const exLeases = netDebt != null && year.leases != null ? netDebt - year.leases : undefined;
    const exLeasesRatio = div(exLeases, ebitdaOf(year));
    const fcf = year.operatingCashFlow != null && year.capex != null ? year.operatingCashFlow - Math.abs(year.capex) : undefined;
    const fcfToDebt = netDebt != null && netDebt <= 0 && fcf != null ? null : div(fcf, netDebt);
    const fcfSignal: Signal = netDebt != null && netDebt <= 0 && fcf != null ? 'green' : higher(0.15, 0.05)(fcfToDebt);
    return dimension('Debt Burden', [
      ndEbitdaMetric(year, 'Net Debt incl. Leases/EBITDA', 3.0, 4.5),
      shown('Net Debt excl. Leases/EBITDA', exLeasesRatio, mult(exLeasesRatio)),
      metric('Free Cash Flow/Net Debt', fcfToDebt, netDebt != null && netDebt <= 0 && fcf != null ? 'net cash' : pct(fcfToDebt), fcfSignal),
    ], notes);
  }
  return dimension('Debt Burden', [deMetric(year), ndEbitdaMetric(year, 'Net Debt/EBITDA', 2.5, 4.0)], notes);
}

// ─── Dimension 2 — Debt Service ───────────────────────────────────────────────

function computeDebtService(year: FinancialYearData, rules: RuleSet): DimensionResult {
  // Developers add interest to the cost of the flats: the interest paid is what they owe
  const paid = rules === 'developer' && year.interestPaid != null && year.interestPaid > 0;
  const icr = div(ebitBeforeWriteDowns(year), paid ? year.interestPaid : year.interestExpense);
  if (isLender(rules)) {
    // A lender's income from its portfolios and loans is often finance income, below EBIT (Polish accounting
    // rules): its interest cover is profit before tax plus interest, over interest
    const interest = year.interestExpense != null ? Math.abs(year.interestExpense) : undefined;
    const pbtCover = year.profitBeforeTax != null && interest ? (year.profitBeforeTax + interest) / interest : null;
    const lenderIcr = pbtCover ?? icr;
    const name = pbtCover != null ? 'ICR (profit before tax + interest)' : 'ICR';
    if (rules === 'investment') return dimension('Debt Service', [shown(name, lenderIcr, mult(lenderIcr))]);
    const [green, yellow] = rules === 'collector' ? [2.5, 1.5] : [1.5, 1.2];
    return dimension('Debt Service', [metric(name, lenderIcr, mult(lenderIcr), higher(green, yellow)(lenderIcr))], pbtCover != null ? [] : ebitNotes(year));
  }
  return dimension('Debt Service', [metric(paid ? 'ICR (interest paid)' : 'ICR', icr, mult(icr), higher(3.0, 1.5)(icr))], ebitNotes(year));
}

// ─── Dimension 3 — Liquidity ──────────────────────────────────────────────────

function computeLiquidity(year: FinancialYearData, rules: RuleSet): DimensionResult {
  const cr = div(year.currentAssets, year.currentLiabilities);
  const crMetric = (green: number, yellow: number) => metric('Current Ratio', cr, mult(cr), higher(green, yellow)(cr));
  if (isLender(rules)) {
    // Buying portfolios or writing leases is an operating outflow: operating cash flow is shown, not scored
    const due = year.debtDueWithinYear;
    const cashToDue = due === 0 && year.cash != null ? null : div(year.cash, due);
    const signal: Signal = due === 0 && year.cash != null ? 'green' : rules === 'leasing' ? higher(0.3, 0.1)(cashToDue) : higher(0.5, 0.2)(cashToDue);
    return dimension('Liquidity', [
      metric('Cash/Debt due within 12 Months', cashToDue, due === 0 && year.cash != null ? 'none due' : mult(cashToDue), signal),
      shown('Operating Cash Flow', year.operatingCashFlow ?? null, year.operatingCashFlow == null ? 'n/a' : `${year.operatingCashFlow.toLocaleString('en-US', { maximumFractionDigits: 1 })} m`),
    ]);
  }
  if (rules === 'developer') {
    const presales = div(year.contractLiabilities, year.inventory);
    return dimension('Liquidity', [crMetric(2.0, 1.3), shown('Buyer Advances/Inventory', presales, pct(presales))]);
  }
  if (rules === 'contractor') {
    const netOfAdvances = year.cash != null && year.contractLiabilities != null ? div(year.cash - year.contractLiabilities, year.revenue) : null;
    return dimension('Liquidity', [crMetric(1.2, 1.0), metric('Cash net of Advances/Revenue', netOfAdvances, pct(netOfAdvances), signalFromValue(netOfAdvances, v => v > 0.05, v => v >= 0))]);
  }
  if (rules === 'consumer') {
    const ocfCl = div(year.operatingCashFlow, year.currentLiabilities);
    return dimension('Liquidity', [metric('Operating Cash Flow/Current Liabilities', ocfCl, mult(ocfCl), higher(0.5, 0.3)(ocfCl)), shown('Current Ratio', cr, mult(cr))]);
  }
  return dimension('Liquidity', [crMetric(1.5, 1.0)]);
}

// ─── Dimension 4 — Profitability ──────────────────────────────────────────────

const MARGINS: Record<Exclude<RuleSet, FinanceRuleSet>, { ebit: [number, number]; net: [number, number] }> = {
  general: { ebit: [0.10, 0.05], net: [0.05, 0.01] },
  consumer: { ebit: [0.10, 0.05], net: [0.05, 0.01] },
  developer: { ebit: [0.15, 0.08], net: [0.10, 0.05] },
  contractor: { ebit: [0.04, 0.02], net: [0.025, 0.005] },
};

// Return on equity over the average of the year's and the previous year's equity, when there is one
function computeLenderProfitability(year: FinancialYearData, previous: FinancialYearData | undefined, rules: FinanceRuleSet): DimensionResult {
  const averageEquity = year.equity != null && previous?.equity != null && previous.year === year.year - 1 ? (year.equity + previous.equity) / 2 : year.equity;
  const roe = averageEquity != null && averageEquity <= 0 ? null : div(year.netProfit, averageEquity);
  const roa = div(year.netProfit, year.totalAssets);
  if (rules === 'investment') {
    return dimension('Profitability', [shown('Return on Equity', roe, pct(roe)), shown('Return on Assets', roa, pct(roa))],
      ['An investment firm\'s profit is mostly revaluation of its holdings: shown, not scored']);
  }
  const roeSignal: Signal = averageEquity != null && averageEquity <= 0 ? 'red' : higher(0.12, 0.06)(roe);
  return dimension('Profitability', [
    metric('Return on Equity', roe, pct(roe), roeSignal),
    metric('Return on Assets', roa, pct(roa), rules === 'collector' ? higher(0.05, 0.02)(roa) : higher(0.015, 0.0075)(roa)),
  ], year.netProfit != null && year.revenue != null && year.revenue > 0 && year.netProfit > year.revenue
    ? ['Net profit above revenue: a one-off or a revaluation is likely in it'] : []);
}

function computeProfitability(year: FinancialYearData, rules: RuleSet, previous?: FinancialYearData): DimensionResult {
  if (isLender(rules)) return computeLenderProfitability(year, previous, rules);
  const { ebit, net } = MARGINS[rules];
  // Negative revenue (a lender's portfolio written down, GetBack 2017): a loss over it would come out as a positive
  // margin. No margin then: red when the result is a loss, n/a otherwise.
  if (year.revenue != null && year.revenue < 0) {
    const noMargin = (name: string, result: number | undefined) => metric(name, null, 'n/m', result == null ? 'na' : result < 0 ? 'red' : 'na');
    return dimension('Profitability', [noMargin('EBIT Margin', year.ebit), noMargin('Net Margin', year.netProfit)], ['Negative revenue: margins have no meaning; a loss counts as red']);
  }
  const ebitMargin = div(year.ebit, year.revenue);
  const netMargin = div(year.netProfit, year.revenue);
  return dimension('Profitability', [
    metric('EBIT Margin', ebitMargin, pct(ebitMargin), higher(...ebit)(ebitMargin)),
    metric('Net Margin', netMargin, pct(netMargin), higher(...net)(netMargin)),
  ], year.ebitDerived ? ebitNotes(year).slice(0, 1) : []);
}

// ─── Dimension 5 — Asset Coverage ────────────────────────────────────────────

const EQUITY_RATIO: Record<RuleSet, [number, number]> = {
  general: [0.30, 0.15], contractor: [0.30, 0.15], developer: [0.35, 0.25], consumer: [0.20, 0.10],
  collector: [0.35, 0.25], leasing: [0.15, 0.10], investment: [0.50, 0.35],
};

function computeAssetCoverage(year: FinancialYearData, rules: RuleSet): DimensionResult {
  const tangibleNetAssets =
    year.totalAssets != null && year.intangibleAssets != null && year.currentLiabilities != null
      ? year.totalAssets - year.intangibleAssets - year.currentLiabilities
      : undefined;
  const acr = div(tangibleNetAssets, year.financialDebt);
  const equityRatio = div(year.equity, year.totalAssets);
  if (isLender(rules)) {
    // A lender's assets are its loans and portfolios, which the equity ratio already weighs against debt
    return dimension('Asset Coverage', [metric('Equity Ratio', equityRatio, pct(equityRatio), higher(...EQUITY_RATIO[rules])(equityRatio))]);
  }
  return dimension('Asset Coverage', [
    rules === 'consumer' ? shown('Asset Coverage Ratio', acr, mult(acr)) : metric('Asset Coverage Ratio', acr, mult(acr), higher(1.5, 1.0)(acr)),
    metric('Equity Ratio', equityRatio, pct(equityRatio), higher(...EQUITY_RATIO[rules])(equityRatio)),
  ]);
}

// ─── Dimension 6 — Financial Trend ───────────────────────────────────────────

function cagr(oldest: number, newest: number, periods: number): number | null {
  if (oldest <= 0 || periods === 0) return null;
  return (newest / oldest) ** (1 / periods) - 1;
}

function linearSlope(values: number[]): number {
  const n = values.length;
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((s, v) => s + v, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (values[i]! - yMean);
    den += (i - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

function computeTrend(years: FinancialYearData[]): DimensionResult {
  if (years.length < 3) {
    const naMetric = (name: string): MetricResult => ({ name, value: null, formattedValue: 'n/a', signal: 'na' });
    const metrics = [naMetric('Revenue CAGR'), naMetric('EBITDA Margin Trend'), naMetric('Net Debt/EBITDA Trend')];
    return { name: 'Financial Trend', signal: 'na', metrics };
  }

  // years sorted descending by year (newest first)
  const sorted = [...years].sort((a, b) => b.year - a.year);
  const newest = sorted[0]!;
  const oldest = sorted[sorted.length - 1]!;
  const periods = sorted.length - 1;

  // Revenue CAGR
  const revCagrValue = newest.revenue != null && oldest.revenue != null
    ? cagr(oldest.revenue, newest.revenue, periods)
    : null;
  const revCagrMetric: MetricResult = {
    name: 'Revenue CAGR',
    value: revCagrValue,
    formattedValue: pct(revCagrValue),
    signal: signalFromValue(revCagrValue, v => v > 0.05, v => v >= 0),
  };

  // EBITDA Margin Trend (slope of EBITDA/revenue across years, sorted ascending)
  const ebitdaMargins = sorted
    .slice()
    .reverse() // oldest first for slope
    .map(y => {
      const ebitda = ebitdaOf(y);
      return ebitda != null && y.revenue != null && y.revenue > 0 ? ebitda / y.revenue : null;
    })
    .filter((v): v is number => v !== null);

  let ebitdaMarginSignal: Signal = 'na';
  let ebitdaSlopeValue: number | null = null;
  if (ebitdaMargins.length >= 3) {
    ebitdaSlopeValue = linearSlope(ebitdaMargins);
    const latestMargin = ebitdaMargins[ebitdaMargins.length - 1]!;
    const isImproving = ebitdaSlopeValue > 0;
    const isStableHigh = Math.abs(ebitdaSlopeValue) <= 0.005 && latestMargin > 0.10;
    if (isImproving || isStableHigh) ebitdaMarginSignal = 'green';
    else if (ebitdaSlopeValue >= -0.005) ebitdaMarginSignal = 'yellow';
    else ebitdaMarginSignal = 'red';
  }
  const ebitdaMarginMetric: MetricResult = {
    name: 'EBITDA Margin Trend',
    value: ebitdaSlopeValue,
    formattedValue: ebitdaSlopeValue != null ? `slope ${ebitdaSlopeValue.toFixed(3)}` : 'n/a',
    signal: ebitdaMarginSignal,
  };

  // Net Debt/EBITDA Trend (slope ascending = worsening if positive)
  const ndEbitdaSeries = sorted
    .slice()
    .reverse() // oldest first
    .map(y => {
      const ebitda = ebitdaOf(y) ?? null;
      const nd = netDebtOf(y) ?? null;
      return ebitda != null && nd != null && ebitda > 0 ? nd / ebitda : null;
    })
    .filter((v): v is number => v !== null);

  let ndEbitdaTrendSignal: Signal = 'na';
  let ndEbitdaSlopeValue: number | null = null;
  if (ndEbitdaSeries.length >= 3) {
    ndEbitdaSlopeValue = linearSlope(ndEbitdaSeries);
    // declining (negative slope) = good
    if (ndEbitdaSlopeValue < -0.1) ndEbitdaTrendSignal = 'green';
    else if (ndEbitdaSlopeValue <= 0.1) ndEbitdaTrendSignal = 'yellow';
    else ndEbitdaTrendSignal = 'red';
  }
  const ndEbitdaTrendMetric: MetricResult = {
    name: 'Net Debt/EBITDA Trend',
    value: ndEbitdaSlopeValue,
    formattedValue: ndEbitdaSlopeValue != null ? `slope ${ndEbitdaSlopeValue.toFixed(3)}` : 'n/a',
    signal: ndEbitdaTrendSignal,
  };

  const metrics = [revCagrMetric, ebitdaMarginMetric, ndEbitdaTrendMetric];
  // Trend signal, over the metrics that could be computed: n/a if none, red if ≥2 red,
  // green if all are green and there are at least two of them, yellow otherwise.
  const available = metrics.filter(m => m.signal !== 'na');
  const redCount = available.filter(m => m.signal === 'red').length;
  const greenCount = available.filter(m => m.signal === 'green').length;
  const trendSignal: Signal =
    available.length === 0 ? 'na'
    : redCount >= 2 ? 'red'
    : greenCount === available.length && available.length >= 2 ? 'green'
    : 'yellow';

  return { name: 'Financial Trend', signal: trendSignal, metrics };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SIGNAL_RANK: Record<Signal, number> = { red: 3, yellow: 2, green: 1, na: 0 };

function worstSignal(metrics: MetricResult[]): Signal {
  return metrics.reduce<Signal>((worst, m) =>
    SIGNAL_RANK[m.signal] > SIGNAL_RANK[worst] ? m.signal : worst,
    'na'
  );
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export function computeScorecard(years: FinancialYearData[], rules: RuleSet = 'general'): FundamentalScorecard {
  if (years.length === 0) {
    return { dimensions: [], ruleSet: rules };
  }

  // Use most recent year for snapshot dimensions
  const sorted = [...years].sort((a, b) => b.year - a.year);
  const current = sorted[0]!;

  const dimensions: DimensionResult[] = [
    computeDebtBurden(current, rules),
    computeDebtService(current, rules),
    computeLiquidity(current, rules),
    computeProfitability(current, rules, sorted[1]),
    computeAssetCoverage(current, rules),
    computeTrend(sorted),
  ];

  return { dimensions, ruleSet: rules };
}

// Scorecard from figures as the analysis agent reports them (null = not found).
// Stored analyses keep these figures, so scorecards can be recomputed when the rules change.
export type ReportedYear = { year: number } & {
  [K in Exclude<keyof FinancialYearData, 'issuerName' | 'year'>]?: number | null;
};

export function scorecardFromReportedYears(issuerName: string, years: ReportedYear[], rules: RuleSet = 'general'): FundamentalScorecard {
  return computeScorecard(years.map(y => {
    const data: FinancialYearData = { issuerName, year: y.year };
    for (const [key, value] of Object.entries(y)) {
      if (key !== 'year' && typeof value === 'number') {
        (data as Record<string, unknown>)[key] = value;
      }
    }
    return data;
  }), rules);
}
