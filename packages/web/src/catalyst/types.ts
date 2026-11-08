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
