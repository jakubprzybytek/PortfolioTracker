// Shapes of the Catalyst API's answers (packages/jobs/src/catalyst/handlers/api.ts).

export type Level = "high" | "medium" | "low" | "none";
export interface Liquidity {
  level: Level;
  traded30: number;
  traded90: number;
  medianTurnover30: number | null;
  trades30: number;
  medianSpread30: number | null;
  bid: { price: number; volume: number } | null;
  daysToSell10k: number | null;
}
export interface Coupon {
  kind: "FIXED" | "FLOATING" | "ZERO" | "OTHER";
  base?: string;
  margin?: number;
  rate?: number;
}
export interface BondRow {
  isin: string;
  code: string;
  segment: string;
  currency: string;
  markets: string[];
  maturity: string | null;
  nominal: number | null;
  /** The issuer name as listed (obligacje.pl). */
  issuer?: string | null;
  /** The company once the bond is linked (phase 2): its id, short and legal name, and whether AI analysis is on. */
  entityId?: string;
  issuerShort?: string;
  issuerLegal?: string;
  aiAnalysis?: boolean;
  /** AI analysis switched off again: since when (the scorecard isn't kept current). */
  aiOffSince?: string;
  industry?: string;
  /** The company's scorecard in short (its six dimensions), once it's linked and analysed. */
  scorecard?: IssuerSignals;
  coupon?: Coupon;
  couponText?: string | null;
  secured?: boolean | null;
  issueAmount?: number | null;
  date: string;
  market: string;
  price: number | null;
  lastTraded: string | null;
  accruedInterest: number | null;
  years: number | null;
  yieldGross: number | null;
  yieldNet: number | null;
  projected: boolean;
  alternative: { label: string; yieldNet: number } | null;
  vsAlternative: number | null;
  premium: number | null;
  premiumBasis: "fixed-curve" | "wz" | null;
  liquidity: Liquidity;
  flags: string[];
}
export interface CurvePoint {
  years: number;
  value: number;
  code: string;
}
export interface Screen {
  date: string | null;
  computedAt: string | null;
  curve: { fixed: CurvePoint[]; wz: CurvePoint[] } | null;
  rows: BondRow[];
}
export interface Assumptions {
  cpi: number;
  wibor: number;
  nbpRate: number;
  wiron: number;
  euribor: number;
  alternative: "retail" | "rate";
  altRate?: number;
  commission?: number;
}
export interface AssumptionsAnswer {
  assumptions: Assumptions;
  defaults: Assumptions;
  saved: Partial<Assumptions> | null;
  offers: { series: string; kind: string; termMonths: number; firstRate: number | null; margin: number | null }[];
}
export interface SavedView {
  name: string;
  params: Record<string, string>;
}
export interface BondDetail {
  bond: { isin: string; code: string; maturity: string | null; firstSeen: string; markets: string[] };
  terms: { issuer?: string; series?: string; couponText?: string; secured?: boolean; issueValue?: { amount: number; currency: string; nominal: number }; periodsProblem?: string } | null;
  coupons: { start: string; end: string; recordDate?: string; paymentDate: string; rate?: number }[];
  market: string;
  sessions: { date: string; close: number | null; trades: number; turnover: number; nominal: number | null }[];
  quotes: { date: string; bid?: { price: number; volume: number }; ask?: { price: number; volume: number } }[];
  /** GPW's measures on this bond (suspensions, liftings, exclusions), oldest first. */
  events: BondEvent[];
  /** The issuer's repayment track record: until companies are linked, the bonds sharing the code's prefix. */
  track: TrackRecord;
}

export interface BondEvent {
  published: string;
  action: "suspension" | "lifting" | "exclusion" | "other";
  reason: string;
  signal: "routine" | "data" | "early-redemption" | "redemption" | "distress" | "attention" | "other";
  from: string | null;
  to: string | null;
  inForce: boolean;
}

export type BondOutcome = "repaid" | "early" | "below-par" | "past-maturity" | "listed" | "unknown";

export interface TrackRecord {
  /** The company whose bonds these are, or, until the bond is linked, the code prefix they share. */
  company: string | null;
  prefix: string | null;
  since: string | null;
  counts: Record<BondOutcome, number>;
  bonds: { isin: string; code: string; maturity: string | null; status: string; lastSeen: string; lastClose: number | null; outcome: BondOutcome; inferred: boolean; note: string; flags: string[]; attention: string[] }[];
  flags: string[];
  attention: string[];
}

/** What `catalyst work` lists (core/catalyst/agent.ts). */
export interface WorkItem {
  kind: string;
  who: "agent" | "you";
  entityId: string | null;
  name: string;
  detail: string;
}

// ─── Issuers (phase 2) ─────────────────────────────────────────────────────────────────────────────────────────────

export type Signal = "green" | "yellow" | "red" | "na";
export type Arrow = "up" | "flat" | "down";

/** A company's scorecard in short, as the bond rows carry it (core/catalyst/screen.ts). */
export interface IssuerSignals {
  state: "scored" | "no-report" | "out-of-scope";
  ruleSet: string;
  dimensions: { name: string; signal: Signal; arrow?: Arrow }[];
  confidence?: "high" | "medium" | "low";
  latestPeriodEnd?: string;
}

export interface AiSwitch {
  on: boolean;
  by?: string;
  at?: string;
}

export interface Company {
  entityId: string;
  shortName: string;
  legalName: string;
  country?: string;
  krs?: string;
  lei?: string;
  status?: string;
  legalForm?: string;
  industry: string | null;
  financeRuleSet: string | null;
  ruleSetOverride: { ruleSet: string; reason?: string } | null;
  aiAnalysis: AiSwitch;
  businessSummary: string | null;
  website: string | null;
  financialsEntityId: string | null;
}

export interface CompanyListItem extends Company {
  names: string[];
  bonds: number;
  listed: number;
  judgedAt: string | null;
}

export interface Metric {
  name: string;
  value: number | null;
  formattedValue: string;
  signal: Signal;
  scored?: false;
}
export interface Dimension {
  name: string;
  signal: Signal;
  metrics: Metric[];
  notes?: string[];
  trend?: { arrow: Arrow; metrics: Metric[] };
}
export interface Confidence {
  level: "high" | "medium" | "low";
  periodEnd: string;
  yearsBehind: number;
  years: number;
  missing: string[];
  thinDimensions: string[];
  facts: string[];
}
export interface ScheduledBond {
  isin: string;
  name: string;
  maturityDay: string;
  currency: string;
  amount: number;
  issued?: number;
  inReportCurrency?: number;
}
export interface Refinancing {
  bonds: ScheduledBond[];
  report?: { periodEnd: string; scope: string; currency: string; cash?: number; operatingCashFlow?: number; balanceSheetBonds?: number; due12: number; due24: number; listed: number; cashCover12?: number; liquidityCover24?: number };
  signal: Signal;
  notes: string[];
}
export interface CompanyAnalysis {
  state: "scored" | "no-report" | "out-of-scope";
  ruleSet: string;
  scorecard?: { dimensions: Dimension[]; confidence?: Confidence };
  source?: { format: string; scope: string; latestPeriodEnd: string; years: number };
  refinancing?: Refinancing;
}
export type ReviewStatus = "parsed" | "hand-checked" | "flagged";
/** A figure in the report's currency, with the statement lines (codes or labels) or XBRL concepts it came from. */
export interface Figure {
  value: number;
  source: string[];
}
export interface CompanyYear {
  period: string;
  periodStart: string;
  periodEnd: string;
  months: number;
  scope: "group" | "single";
  currency: string;
  standard?: string;
  presentedUnit?: number;
  column: "current" | "previous";
  reportPeriodEnd: string;
  figures: Record<string, Figure | undefined>;
  review: { status: ReviewStatus; note?: string; at?: string; by?: string };
  filing: { key: string; sha256: string; format: string; checks: string[]; notes?: string[] };
  enteredBy: string;
  importedAt: string;
  lines: number;
}
export interface CompanyFiling {
  sha256: string;
  fileName: string;
  format: string;
  scope: string;
  periodEnd: string;
  stored: string[];
  kept: string[];
  replaced: string[];
  checks: string[];
  enteredBy: string;
  importedAt: string;
}
export interface Judgement {
  at: string;
  markdown: string;
  by: string;
  source: "agent" | "you" | "CatalystViewer";
}
export interface CompanyDetail {
  company: Company;
  analysis: CompanyAnalysis;
  years: CompanyYear[];
  filings: CompanyFiling[];
  analyses: Judgement[];
  collected: { at: string; by?: string; source?: string }[];
  names: { name: string; status: string }[];
  bonds: { isin: string; code: string; status: string; maturity: string | null; segment: string }[];
  track: TrackRecord;
}
export interface StatementLineView {
  statement: string;
  order: number;
  label: string;
  value: number;
  code?: string;
  item?: string;
  page?: number;
  parent?: number;
}
export interface YearLines {
  period: string;
  currency: string;
  presentedUnit?: number;
  lines: StatementLineView[];
  figures: Record<string, Figure | undefined>;
}
