// The repayment track record (Docs/catalyst.md, "Repayment track record"): how an issuer's past bonds ended, from the
// daily-file archive (when a bond stopped trading, its last price) and GPW's exits (why it stopped early, suspensions,
// markings). What the archive only suggests is labelled inferred: "left at maturity, trading near par" reads as
// repaid, but only the issuer's reports confirm a payment.

import { addDays, type IsoDate } from "../dates.ts";
import type { ExitSignal } from "./exits.ts";
import { PAYMENT_EVENT_WEIGHT, paymentEventLine, type PaymentEvent } from "./paymentEvents.ts";

/**
 * - `repaid`: ended at maturity (or excluded as redeemed);
 * - `early`: ended more than 30 days before maturity near par, or excluded for an early redemption;
 * - `below-par`: ended with a last price under 90;
 * - `past-maturity`: still listed or suspended after its maturity (not paid, or paid late);
 * - `listed`: still trading, maturity ahead;
 * - `unknown`: none of these fits;
 * - `not-paid`, `paid-late`: the issuer's own report says a payment was missed (and not made since), or made late.
 *   These come from recorded payment events (paymentEvents.ts) and override what trading suggests.
 */
export type BondOutcome = "repaid" | "early" | "below-par" | "past-maturity" | "not-paid" | "paid-late" | "listed" | "unknown";

export interface TrackEvent {
  published: string;
  action: string;
  reason: string;
  signal: ExitSignal;
}

export interface TrackBond {
  isin: string;
  code: string;
  maturity: IsoDate | null;
  status: "listed" | "suspended" | "ended";
  firstSeen: IsoDate;
  lastSeen: IsoDate;
  /** The close of its last session (null when unknown). */
  lastClose: number | null;
  events: TrackEvent[];
}

export interface BondHistory {
  outcome: BondOutcome;
  /** True when read from trading alone (no GPW measure says it). */
  inferred: boolean;
  note: string;
  /** Red flags of this bond: distress measures, ended below par, past maturity. */
  flags: string[];
  /** Worth a look: suspensions "in the participants' interest and safety" (often short and technical). */
  attention: string[];
  /** True when an issuer's report says it (a recorded payment event). */
  confirmed?: boolean;
}

/** A bond's last session within this many days before its maturity counts as ending at maturity (the record day). */
const AT_MATURITY_DAYS = 21;
/** Ending more than this many days before maturity is an early end. */
const EARLY_DAYS = 30;
/** A last price below this (% of nominal) is an end below par. */
const BELOW_PAR = 90;

const fmt = (x: number) => x.toFixed(2);

/** What trading and GPW's measures say, then what the issuer's reports say of this bond (they win). */
export function bondHistory(b: TrackBond, asOf: IsoDate, events: PaymentEvent[] = []): BondHistory {
  const h = tradingHistory(b, asOf);
  const own = events.filter((e) => !e.retracted && e.isins.includes(b.isin)).sort((x, y) => x.date.localeCompare(y.date));
  if (!own.length) return h;
  const flags = [...h.flags, ...own.filter((e) => PAYMENT_EVENT_WEIGHT[e.kind] === "flag").map(paymentEventLine)];
  const attention = [...h.attention, ...own.filter((e) => PAYMENT_EVENT_WEIGHT[e.kind] === "attention").map(paymentEventLine)];
  const missed = own.filter((e) => e.kind === "missed-payment" && !e.resolvedOn).at(-1);
  if (missed) return { outcome: "not-paid", inferred: false, confirmed: true, note: `${missed.source}: ${missed.text}`, flags, attention };
  const late = own.filter((e) => e.kind === "late-payment" || e.kind === "missed-payment").at(-1);
  // Paid late is the outcome once the bond has ended; while it trades, it stays listed, with the flag.
  if (late && b.status === "ended") return { outcome: "paid-late", inferred: false, confirmed: true, note: `${late.source}: ${late.text}`, flags, attention };
  const paid = own.filter((e) => e.kind === "paid").at(-1);
  if (paid && b.status === "ended" && (h.outcome === "repaid" || h.outcome === "early" || h.outcome === "unknown"))
    return { outcome: h.outcome === "unknown" ? "repaid" : h.outcome, inferred: false, confirmed: true, note: `${paid.source}: ${paid.text}`, flags, attention };
  return { ...h, flags, attention };
}

function tradingHistory(b: TrackBond, asOf: IsoDate): BondHistory {
  const said = (e: TrackEvent) => `${e.published.slice(0, 10)}: ${e.action}, ${e.reason}`;
  const flags = b.events.filter((e) => e.signal === "distress").map(said);
  const attention = b.events.filter((e) => e.signal === "attention").map(said);
  const out = (h: Omit<BondHistory, "attention">): BondHistory => ({ ...h, attention });
  const exclusion = [...b.events].reverse().find((e) => e.action === "exclusion");
  if (b.status !== "ended") {
    if (b.maturity && b.maturity < asOf) return out({ outcome: "past-maturity", inferred: false, note: `matured ${b.maturity}, still ${b.status}`, flags: [...flags, `past maturity (${b.maturity})`] });
    return out({ outcome: "listed", inferred: false, note: b.status === "suspended" ? "suspended" : "trading", flags });
  }
  const last = b.lastClose === null ? "" : `, last price ${fmt(b.lastClose)}`;
  if (exclusion?.signal === "early-redemption") return out({ outcome: "early", inferred: false, note: `excluded ${exclusion.published.slice(0, 10)}: ${exclusion.reason}${last}`, flags });
  if (exclusion?.signal === "redemption") return out({ outcome: "repaid", inferred: false, note: `excluded ${exclusion.published.slice(0, 10)}: ${exclusion.reason}${last}`, flags });
  if (b.lastClose !== null && b.lastClose < BELOW_PAR)
    return out({ outcome: "below-par", inferred: true, note: `last traded ${b.lastSeen} at ${fmt(b.lastClose)}`, flags: [...flags, `ended below par (${fmt(b.lastClose)} on ${b.lastSeen})`] });
  if (b.maturity && b.lastSeen >= addDays(b.maturity, -AT_MATURITY_DAYS)) return out({ outcome: "repaid", inferred: true, note: `left at maturity (${b.maturity})${last}`, flags });
  if (b.maturity && b.lastSeen < addDays(b.maturity, -EARLY_DAYS)) return out({ outcome: "early", inferred: true, note: `left ${b.lastSeen}, before its maturity ${b.maturity}${last}`, flags });
  return out({ outcome: "unknown", inferred: true, note: `left ${b.lastSeen}${b.maturity ? `, maturity ${b.maturity}` : ""}${last}`, flags });
}

export interface TrackRecord {
  /** The first session the archive covers for these bonds (the archive starts 2020-01-02). */
  since: IsoDate | null;
  counts: Record<BondOutcome, number>;
  bonds: (TrackBond & BondHistory)[];
  /** Every red flag, with the bond's code. */
  flags: string[];
  /** Everything worth a look, with the bond's code. */
  attention: string[];
  /** The payment events recorded from the issuer's reports (not the retracted ones), newest first, with the bonds' codes. */
  reported: (PaymentEvent & { codes: string[] })[];
  /** The date the issuer's current reports were last read to (its latest `reviewed` event); null: never read through. */
  reviewedTo: IsoDate | null;
}

export function trackRecord(bonds: TrackBond[], asOf: IsoDate, markings: string[] = [], events: PaymentEvent[] = []): TrackRecord {
  const counts: Record<BondOutcome, number> = { repaid: 0, early: 0, "below-par": 0, "past-maturity": 0, "not-paid": 0, "paid-late": 0, listed: 0, unknown: 0 };
  const live = events.filter((e) => !e.retracted);
  const isins = new Set(bonds.map((b) => b.isin));
  // An event naming no bond, or none of these, is the company's: it stands at the record's level.
  const general = live.filter((e) => !e.isins.some((i) => isins.has(i))).sort((x, y) => x.date.localeCompare(y.date));
  const out = bonds
    .map((b) => ({ ...b, ...bondHistory(b, asOf, live) }))
    .sort((a, b) => (b.maturity ?? "").localeCompare(a.maturity ?? "") || a.code.localeCompare(b.code));
  for (const b of out) counts[b.outcome]++;
  const since = bonds.length ? bonds.map((b) => b.firstSeen).sort()[0]! : null;
  return {
    since,
    counts,
    bonds: out,
    flags: [...markings.map((m) => `GPW marking ${m}`), ...general.filter((e) => PAYMENT_EVENT_WEIGHT[e.kind] === "flag").map(paymentEventLine), ...out.flatMap((b) => b.flags.map((f) => `${b.code}: ${f}`))],
    attention: [...general.filter((e) => PAYMENT_EVENT_WEIGHT[e.kind] === "attention").map(paymentEventLine), ...out.flatMap((b) => b.attention.map((f) => `${b.code}: ${f}`))],
    reviewedTo: reviewedTo(live),
    reported: live
      .filter((e) => e.kind !== "reviewed")
      .sort((x, y) => y.date.localeCompare(x.date))
      .map((e) => ({ ...e, codes: bonds.filter((b) => e.isins.includes(b.isin)).map((b) => b.code) })),
  };
}

/** How far a company's current reports were read: its latest `reviewed` event's date (an event alone doesn't say the rest was read). */
export const reviewedTo = (events: PaymentEvent[]): IsoDate | null => events.filter((e) => !e.retracted && e.kind === "reviewed").map((e) => e.date).sort().at(-1) ?? null;

/** The code's issuer prefix ("KRU0228" → "KRU"): bonds of one issuer share it; used until companies are known. */
export const codePrefix = (code: string) => /^[A-Z]+/.exec(code)?.[0] ?? code;
