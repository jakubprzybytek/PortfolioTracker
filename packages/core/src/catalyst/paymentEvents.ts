// What an issuer's own reports say about its bonds' payments (Docs/catalyst.md, "Payment events"): a missed or late
// payment, changed terms, a bondholders' meeting, a covenant breach or waiver, insolvency proceedings, a buy-back below
// par, or a payment made on time. Recorded by the AI agent (`catalyst events put`) from a stored document, with the
// passage that says it; never overwritten, only retracted. The track record (trackRecord.ts) reads them: they
// confirm or override what trading alone suggests.

import type { IsoDate } from "../dates.ts";

export const PAYMENT_EVENT_KINDS = ["missed-payment", "late-payment", "terms-changed", "bondholders-meeting", "covenant-breach", "waiver", "insolvency", "buyback-below-par", "paid", "reviewed"] as const;
export type PaymentEventKind = (typeof PAYMENT_EVENT_KINDS)[number];

/**
 * How an event reads in the track record: a red flag, worth a look, a confirmation, or (`reviewed`) only a note that
 * the current reports were read up to a date and nothing else was found.
 */
export type PaymentEventWeight = "flag" | "attention" | "confirmation" | "note";

export const PAYMENT_EVENT_WEIGHT: Record<PaymentEventKind, PaymentEventWeight> = {
  "missed-payment": "flag",
  "late-payment": "flag",
  "terms-changed": "flag",
  "covenant-breach": "flag",
  insolvency: "flag",
  "buyback-below-par": "flag",
  "bondholders-meeting": "attention",
  waiver: "attention",
  paid: "confirmation",
  reviewed: "note",
};

export const PAYMENT_EVENT_LABEL: Record<PaymentEventKind, string> = {
  "missed-payment": "payment missed",
  "late-payment": "paid late",
  "terms-changed": "terms changed",
  "bondholders-meeting": "bondholders' meeting",
  "covenant-breach": "covenant breached",
  waiver: "waiver",
  insolvency: "insolvency proceedings",
  "buyback-below-par": "buy-back below par",
  paid: "paid",
  reviewed: "reports read",
};

export interface PaymentEvent {
  /** The event's id within its company. */
  id: string;
  kind: PaymentEventKind;
  /** When it happened (the payment's due date, the meeting's date), not when it was reported. */
  date: IsoDate;
  /** The bonds it concerns; none: the company as a whole. */
  isins: string[];
  /** What happened, in a sentence. */
  text: string;
  amount?: { value: number; currency: string };
  /** For a missed payment: when it was paid after all. */
  resolvedOn?: IsoDate;
  /**
   * The report it comes from (e.g. "ESPI 14/2019"), the stored document that holds it, and the passage. `reviewed`
   * has neither document nor passage: its source says what was read.
   */
  source: string;
  documentSha?: string;
  quote?: string;
  sourceUrl?: string;
  by: string;
  at: string;
  retracted?: { at: string; by: string; reason: string };
}

const squash = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/[­​]/g, "")
    .replace(/[„”“’‚‘']/g, '"')
    .replace(/[‐-—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** Whether a quoted passage stands in a document's text, whatever its line breaks, hyphens and quotation marks. */
export function quoteIn(text: string, quote: string): boolean {
  const q = squash(quote);
  if (q.length < 12) return false;
  const t = squash(text);
  // A PDF may break a word at a line's end ("wy- kupu"): also compare without spaces and hyphens.
  const bare = (s: string) => s.replace(/[\s-]/g, "");
  return t.includes(q) || bare(t).includes(bare(q));
}

/** A web page's or a text file's readable text (tags, scripts and entities out). */
export function plainText(source: string): string {
  return source
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCodePoint(Number.parseInt(n, 16)));
}

/** The line an event adds to the track record ("2019-06-28: payment missed: …"). */
export function paymentEventLine(e: Pick<PaymentEvent, "kind" | "date" | "text" | "resolvedOn" | "source">): string {
  return `${e.date}: ${PAYMENT_EVENT_LABEL[e.kind]}${e.kind === "missed-payment" && e.resolvedOn ? `, paid ${e.resolvedOn}` : ""}: ${e.text} (${e.source})`;
}
