// Items of the Catalyst module's own table (`catalyst`, Docs/catalyst.md, "Storage"). The module is separate from the
// portfolio: nothing here refers to transactions or holdings.

import type { IsoDate } from "../dates.ts";
import type { InterestPeriod } from "../bonds/couponPeriods.ts";
import type { CatalystSegment } from "../gpw/catalystDailyFile.ts";
import type { Coupon } from "./terms.ts";
import type { CurvePoint } from "./curve.ts";
import type { ScreenRow } from "./screen.ts";
import type { ExitAction, ExitSignal } from "./exits.ts";
import type { FinancialYear } from "./financials.ts";

export type CatalystBondStatus = "listed" | "suspended" | "ended";

/** A bond of the Catalyst market (one per ISIN, whatever the markets it's listed on). */
export interface CatalystBondItem {
  PK: `BOND#${string}`;
  SK: "META";
  GSI1PK: "BOND";
  GSI1SK: string; // code
  isin: string;
  code: string;
  segment: CatalystSegment;
  currency: string;
  /** The markets it's listed on ("GPW RR", "BS ASO" …), from the latest session it appeared in. */
  markets: string[];
  maturity: IsoDate | null;
  /** The nominal per bond in the latest session (instalments and IZ indexation change it). */
  nominal: number | null;
  status: CatalystBondStatus;
  firstSeen: IsoDate;
  lastSeen: IsoDate;
  updatedAt: string;
}

/** One bond on one market in one session (the daily file; bid/ask added from the quotes pages). */
export interface CatalystSessionItem {
  PK: `BOND#${string}`;
  SK: `D#${IsoDate}#${string}`; // D#<date>#<market>
  isin: string;
  date: IsoDate;
  market: string;
  rate: number | null;
  accruedInterest: number | null;
  nominal: number | null;
  close: number | null;
  reference: number | null;
  open: number | null;
  low: number | null;
  high: number | null;
  last: number | null;
  trades: number;
  volume: number;
  turnover: number;
  blockVolume: number;
  blockTurnover: number;
  bid?: { price: number; volume: number; orders: number };
  ask?: { price: number; volume: number; orders: number };
  source: string;
  fetchedAt: string;
}

export const catalystKeys = {
  bond: (isin: string) => ({ PK: `BOND#${isin}` as const, SK: "META" as const }),
  session: (isin: string, date: IsoDate, market: string) => ({ PK: `BOND#${isin}` as const, SK: `D#${date}#${market}` as const }),
  day: (date: IsoDate) => ({ PK: "DAYS" as const, SK: date }),
  terms: (isin: string) => ({ PK: `BOND#${isin}` as const, SK: "TERMS" as const }),
  coupon: (isin: string, start: IsoDate) => ({ PK: `BOND#${isin}` as const, SK: `COUPON#${start}` as const }),
  quoteDay: (date: IsoDate) => ({ PK: "QUOTEDAYS" as const, SK: date }),
  screen: (isin: string) => ({ PK: `BOND#${isin}` as const, SK: "SCREEN" as const }),
  curve: (date: IsoDate) => ({ PK: "CURVE#PLGOV" as const, SK: date }),
  setting: (name: string) => ({ PK: `SETTING#${name}` as const, SK: "META" as const }),
  quote: (isin: string, date: IsoDate, market: string) => ({ PK: `BOND#${isin}` as const, SK: `Q#${date}#${market}` as const }),
  event: (isin: string, published: string, action: ExitAction) => ({ PK: `BOND#${isin}` as const, SK: `EVENT#${published}#${action}` as const }),
  marking: (issuer: string, marking: string) => ({ PK: "MARKS" as const, SK: `${issuer}#${marking}` }),
  exitsNow: () => ({ PK: "EXITS" as const, SK: "CURRENT" as const }),
  link: (isin: string) => ({ PK: `BOND#${isin}` as const, SK: "ENTITY" as const }),
  name: (name: string) => ({ PK: `NAME#${name}` as const, SK: "META" as const }),
  entity: (entityId: string) => ({ PK: `ENTITY#${entityId}` as const, SK: "META" as const }),
  year: (entityId: string, period: string) => ({ PK: `ENTITY#${entityId}` as const, SK: `FIN#${period}` as const }),
  replacedYear: (entityId: string, period: string, importedAt: string) => ({ PK: `ENTITY#${entityId}` as const, SK: `FINOLD#${period}#${importedAt}` as const }),
  filing: (entityId: string, sha256: string) => ({ PK: `ENTITY#${entityId}` as const, SK: `FILING#${sha256}` as const }),
  known: (entityId: string, period: string) => ({ PK: `KNOWN#${entityId}` as const, SK: period }),
  analysis: (entityId: string, at: string) => ({ PK: `ENTITY#${entityId}` as const, SK: `ANALYSIS#${at}` as const }),
  collected: (entityId: string, at: string) => ({ PK: `ENTITY#${entityId}` as const, SK: `AIFIG#${at}` as const }),
};

/** A financial year of a company, from a report (financials.ts). Replaced versions are kept as `FINOLD#…`. */
export type CatalystYearItem = FinancialYear & { PK: `ENTITY#${string}`; SK: `FIN#${string}` | `FINOLD#${string}` };

/** An original report: where it is, what it gave, who imported it. */
export interface CatalystFilingItem {
  PK: `ENTITY#${string}`;
  SK: `FILING#${string}`;
  entityId: string;
  sha256: string;
  /** The original in the files bucket. */
  key: string;
  fileName: string;
  format: string;
  scope: string;
  /** The report's own year end. */
  periodEnd: string;
  /** Years stored, years kept from a more recent report, years replaced. */
  stored: string[];
  kept: string[];
  replaced: string[];
  checks: string[];
  enteredBy: string;
  importedAt: string;
}

/**
 * A written judgement of a company (§13, §14 layout): append-only, the latest shown. Made by the agent (N7) or
 * migrated from CatalystViewer (its AI analyses, marked so).
 */
export interface CatalystAnalysisItem {
  PK: `ENTITY#${string}`;
  SK: `ANALYSIS#${string}`;
  entityId: string;
  at: string;
  /** The judgement in Markdown. */
  markdown: string;
  /** Who wrote it: a model id, a person, "CatalystViewer (<model>)". */
  by: string;
  /** The scorecard it saw, as it was then. */
  scorecard?: unknown;
  source: "agent" | "you" | "CatalystViewer";
}

/**
 * Figures collected from the web when no report is available (§9): marked as such, confidence medium at most.
 * CatalystViewer's AI analyses carried them (agentFinancials).
 */
export interface CatalystCollectedFiguresItem {
  PK: `ENTITY#${string}`;
  SK: `AIFIG#${string}`;
  entityId: string;
  at: string;
  currency: string;
  unit: string;
  notes?: string;
  years: Record<string, unknown>[];
  by: string;
  source: "agent" | "CatalystViewer";
}

/** Figures read by hand from a printed report (CatalystViewer's expected.json), for `filings check`. */
export interface CatalystKnownItem {
  PK: `KNOWN#${string}`;
  SK: string; // <period end>#<scope>
  GSI1PK: "KNOWN";
  GSI1SK: string; // <entityId>#<period>
  entityId: string;
  period: string;
  currency: string;
  /** In thousands of the currency, as printed. */
  thousands: Record<string, number>;
  /** The original it was read from (files bucket key), and when it was checked. */
  file?: string;
  checkedOn: string;
  source: string;
}

/** Whether the AI agent works on a company (or a listed name not yet linked): off unless you switch it on. */
export interface AiSwitch {
  on: boolean;
  /** Who switched it (the user's e-mail, or "setup" for the first switch-on) and when. */
  by: string;
  at: string;
}

/**
 * A bond's issuer (phase 2, N2): its own item, apart from the bond's (the daily job rewrites that one). Listed on the
 * index (`LINK`) so all links are read in one query.
 */
export interface CatalystLinkItem {
  PK: `BOND#${string}`;
  SK: "ENTITY";
  GSI1PK: "LINK";
  GSI1SK: string; // isin
  isin: string;
  code: string;
  /** Null when no source names the issuer yet ("none": asked again a month later). */
  entityId: string | null;
  lei: string | null;
  /**
   * How: GLEIF's ISIN mapping, the issuer LEI on GPW's measures, the listed name of a bond linked so, the code prefix
   * of an ended bond (inferred), set by hand (the CLI, N7), or not found.
   */
  via: "gleif-isin" | "gpw-exits" | "listed-name" | "code-prefix" | "hand" | "none";
  at: string;
}

/** An issuer name as listed (obligacje.pl), pointing at its company. Several names can point at one company. */
export interface CatalystNameItem {
  PK: `NAME#${string}`;
  SK: "META";
  GSI1PK: "NAME";
  GSI1SK: string; // name
  name: string;
  entityId: string | null;
  /** resolved: by code, names agree; confirmed: by you; review: linked by code but the legal name differs; unresolved: no link. */
  status: "resolved" | "confirmed" | "review" | "unresolved";
  evidence: string;
  /** The switch of a name not yet linked to a company (it passes to the company when linked). */
  aiAnalysis?: AiSwitch;
  updatedAt: string;
}

/** A company behind bonds: identity from GLEIF and the KRS register; the rest by you and the agent (later milestones). */
export interface CatalystEntityItem {
  PK: `ENTITY#${string}`;
  SK: "META";
  GSI1PK: "ENTITY";
  GSI1SK: string; // short name
  entityId: string;
  shortName: string;
  /** True once you set the short name (the code's refresh leaves it alone). */
  shortNameSet?: boolean;
  legalName: string;
  country: string | null;
  krs: string | null;
  lei: string;
  /** The LEI's registration (ISSUED, LAPSED …) and the entity's status (ACTIVE, INACTIVE). */
  leiStatus: string | null;
  status: string | null;
  legalForm: string | null;
  /** The KRS register: main business (PKD) and section 6 (a liquidation open, the kinds of entries it holds). */
  pkd?: string | null;
  register?: { liquidationOpen: boolean; entries: string[] };
  /** From the fixed list (issuers/scope.ts, INDUSTRIES): it picks the rule set. Set by the agent or you. */
  industry?: string;
  /** What the company does (a few sentences) and its website: by the agent or you. */
  businessSummary?: string;
  website?: string;
  /**
   * A financing vehicle's group: the company whose reports judge this one's bonds (PEU (FIN) PLC → Pepco Group N.V.,
   * whose guarantee stands behind them).
   */
  financialsEntityId?: string;
  /** A lender's kind (collector, leasing, investment): set by you; a Finance company has no scorecard without it. */
  financeRuleSet?: "collector" | "leasing" | "investment";
  /** Rules that fit the business model better than the industry's, with the reason (yours). */
  ruleSetOverride?: { ruleSet: "general" | "developer" | "contractor" | "consumer" | "collector" | "leasing" | "investment"; reason: string };
  aiAnalysis?: AiSwitch;
  createdAt: string;
  updatedAt: string;
}

/**
 * A GPW measure on a bond (suspension, lifting, exclusion: gpw.pl's suspensions and exclusions, exits.ts). Rewritten on
 * every run that sees it (whether it's still in force changes).
 */
export interface CatalystEventItem {
  PK: `BOND#${string}`;
  SK: `EVENT#${string}#${ExitAction}`;
  isin: string;
  code: string;
  published: string;
  action: ExitAction;
  reason: string;
  signal: ExitSignal;
  from: string | null;
  to: string | null;
  inForce: boolean;
  issuer: string;
  lei: string | null;
  source: "gpw-exits";
  fetchedAt: string;
}

/** A special marking of an issuer's instruments (gpwcatalyst.pl shows only the current ones: the history is ours). */
export interface CatalystMarkingItem {
  PK: "MARKS";
  SK: string; // <issuer>#<marking>
  issuer: string;
  marking: string;
  firstSeen: IsoDate;
  lastSeen: IsoDate;
  current: boolean;
}

/** What the latest exits run found in force: suspended bonds (with the reason) and the issuers marked now. */
export interface CatalystExitsNowItem {
  PK: "EXITS";
  SK: "CURRENT";
  suspended: Record<string, { reason: string; signal: ExitSignal; from: string | null }>;
  marked: { issuer: string; marking: string }[];
  fetchedAt: string;
}

/** A session whose daily file was loaded: the job's look-back skips it, the backfill too. */
export interface CatalystDayItem {
  PK: "DAYS";
  SK: IsoDate;
  date: IsoDate;
  rows: number;
  bonds: number;
  /** The file's name in the archive, e.g. catalyst_20261104.xlsx. */
  file: string;
  fetchedAt: string;
}

/**
 * The order book of one bond on one market at the end of a session (the quotes pages, after the close): the best bid
 * and ask. Its own item, apart from the session (the daily file comes later in the evening). Only rows with a bid or
 * an ask are stored; none for a session means no quotes.
 */
export interface CatalystQuoteItem {
  PK: `BOND#${string}`;
  SK: `Q#${IsoDate}#${string}`; // Q#<date>#<market>
  isin: string;
  date: IsoDate;
  market: string;
  bid?: { price: number; volume: number; orders: number };
  ask?: { price: number; volume: number; orders: number };
  /** The session's trades as the page counted them (the daily file's are the reference). */
  trades: number;
  source: string;
  fetchedAt: string;
}

/** A session whose end-of-day quotes were stored (the morning run only fills a session the evening missed). */
export interface CatalystQuoteDayItem {
  PK: "QUOTEDAYS";
  SK: IsoDate;
  date: IsoDate;
  quotes: number;
  fetchedAt: string;
}

/**
 * A bond's terms from obligacje.pl (the catalyst-terms job), apart from the bond item, which the daily job rewrites.
 * `notFound`: the site has no page for the code (tried again after a month).
 */
export interface CatalystTermsItem {
  PK: `BOND#${string}`;
  SK: "TERMS";
  GSI1PK: "TERMS";
  GSI1SK: string; // isin
  isin: string;
  code: string;
  notFound?: true;
  /** The page's interest periods couldn't be read (its date lists don't add up): kept without them, read again in a month. */
  periodsProblem?: string;
  issuer?: string;
  series?: string;
  /** "Wartość emisji w obrocie": the amount in circulation when read, and the nominal per bond then. */
  issueValue?: { amount: number; currency: string; nominal: number };
  /** "Zabezpieczenie": secured (true), unsecured (false), not said (absent). */
  secured?: boolean;
  /** The coupon as published, and as read (core/catalyst/terms.ts). */
  couponText?: string;
  coupon: Coupon;
  /** The current period's annual rate the site shows. */
  currentRate?: number | null;
  /** First day of the interest period running when read (a floating bond is read again a week into the next one). */
  currentPeriodStart?: IsoDate;
  periods?: number;
  source: string;
  fetchedAt: string;
}

/** One interest period of a bond (dates and rate), as PT's coupon periods (core/bonds/couponPeriods.ts). */
export type CatalystCouponItem = InterestPeriod & { PK: `BOND#${string}`; SK: `COUPON#${IsoDate}`; updatedAt: string };

/** A listed bond's screen row (core/catalyst/screen.ts), recomputed by the metrics; listed on the index as `SCREEN`. */
export type CatalystScreenItem = ScreenRow & { PK: `BOND#${string}`; SK: "SCREEN"; GSI1PK: "SCREEN"; GSI1SK: string; computedAt: string };

/** The State's curves of a session (core/catalyst/curve.ts): fixed-rate yields and WZ price-adjusted margins. */
export interface CatalystCurveItem {
  PK: "CURVE#PLGOV";
  SK: IsoDate;
  date: IsoDate;
  fixed: CurvePoint[];
  wz: CurvePoint[];
  computedAt: string;
}
