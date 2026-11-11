// The AI agent's side of the module (Docs/catalyst.md, "The catalyst CLI"): what it may send (the inputs, checked
// the same way by the CLI before sending and by the API on arrival), what it may reach through its token (the
// allow-list), and what needs doing (`catalyst work`), only for companies and names with AI analysis on.

import { z } from "zod";
import { INDUSTRIES } from "./issuers/scope.ts";
import type { CatalystChecklistItem, CatalystEntityItem, CatalystEventItem, CatalystNameItem } from "./items.ts";
import type { FinancialYear } from "./financials.ts";
import { PAYMENT_EVENT_KINDS } from "./paymentEvents.ts";

// ─── Inputs ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** A link the app shows: http or https only (a javascript: or data: URL would run when clicked). */
const webUrl = z.url({ protocol: /^https?$/, error: "an http or https address" }).max(500);

const entityId = z.string().regex(/^(\d{10}|LEI:[A-Z0-9]{20})$/, "a KRS number (10 digits) or LEI:<lei>");

/** A company's description (`catalyst entity set`). Not its lender kind, override or AI analysis switch: those are yours. */
export const AgentEntityInput = z
  .object({
    shortName: z.string().trim().min(1).max(60),
    industry: z.enum(INDUSTRIES),
    businessSummary: z.string().trim().min(1).max(1500),
    // A host with a dot, optionally after http(s)://: no other scheme (javascript:, data: …), since the app links it.
    website: z.string().trim().max(200).regex(/^(https?:\/\/)?[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)+(:\d+)?([/?#]\S*)?$/iu, "a web address (http or https)"),
    /** A financing vehicle judged on its group's reports. */
    financialsEntityId: entityId.nullable(),
  })
  .partial()
  .strict();

/** A listed name linked to a company (`catalyst identity set`); `lei` makes the company when it isn't known yet. */
export const NameLinkInput = z
  .object({
    entityId: entityId.nullable().optional(),
    lei: z.string().regex(/^[A-Z0-9]{20}$/).optional(),
    evidence: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();

const RedFlag = z.object({ text: z.string().min(1).max(500), source: z.string().min(1).max(500), quote: z.string().max(1000).optional() }).strict();

/** A judgement (`catalyst analysis put`): Markdown in the §14 layout, and what it rests on. */
export const AnalysisInput = z
  .object({
    markdown: z.string().min(50).max(40_000),
    meta: z
      .object({
        /** Who wrote it: the model id, or a person. */
        model: z.string().min(1).max(100),
        sources: z.array(z.string().min(1).max(500)).min(1).max(100),
        redFlags: z.array(RedFlag).max(50),
        /** The scorecard it saw (`catalyst entity <id>`'s `analysis.scorecard`), as it was. */
        scorecard: z.unknown().optional(),
      })
      .strict(),
    /**
     * Store it although the bond terms or the recent current reports weren't read (judgementGaps): marked provisional,
     * with what's missing. Without it, such a judgement is refused.
     */
    provisional: z.boolean().optional(),
    dryRun: z.boolean().optional(),
  })
  .strict();

const FigureYear = z
  .object({
    periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    months: z.number().int().min(1).max(24),
    scope: z.enum(["group", "single"]),
    figures: z.record(z.string(), z.number()),
    source: z.string().min(1).max(500),
  })
  .strict();

/** Figures collected from the web when there's no report (`catalyst figures put`, §9): operating companies only. */
export const CollectedFiguresInput = z
  .object({
    currency: z.string().regex(/^[A-Z]{3}$/),
    unit: z.enum(["units", "thousands", "millions"]),
    notes: z.string().max(2000).optional(),
    years: z.array(FigureYear).min(1).max(6),
    dryRun: z.boolean().optional(),
  })
  .strict();

/** Figures read by hand from a printed report, for `filings check` (`catalyst known put`): thousands, as printed. */
export const KnownInput = z
  .object({
    period: z.string().regex(/^\d{4}-\d{2}-\d{2}#(group|single)$/),
    currency: z.string().regex(/^[A-Z]{3}$/),
    thousands: z.record(z.string(), z.number()),
    file: z.string().max(300).optional(),
    checkedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    source: z.string().min(1).max(300),
  })
  .strict();

/** A document a judgement rests on (`catalyst documents put`): the auditor's report, an interim report, a current report. */
export const DocumentInput = z
  .object({
    uploadKey: z.string().regex(/^catalyst\/uploads\/[0-9a-f-]{36}$/),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    fileName: z.string().min(1).max(200),
    kind: z.enum(["audit", "management", "interim", "annual", "current-report", "terms", "other"]),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    title: z.string().trim().min(1).max(300),
    sourceUrl: webUrl.optional(),
    dryRun: z.boolean().optional(),
  })
  .strict();

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a date, yyyy-mm-dd");

/**
 * What a company's report says about its bonds' payments (`catalyst events put`, paymentEvents.ts). Every kind but
 * `reviewed` rests on a stored document (`catalyst documents put` first) and the passage that says it; `reviewed`
 * notes that the current reports were read up to `date` and nothing else was found.
 */
export const PaymentEventInput = z
  .object({
    kind: z.enum(PAYMENT_EVENT_KINDS),
    /** When it happened (the payment's due date, the meeting's date); for `reviewed`, the date read up to. */
    date: day,
    /** The bonds it concerns (ISINs); none: the company as a whole. */
    isins: z.array(z.string().regex(/^[A-Z]{2}[A-Z0-9]{9}\d$/, "an ISIN")).max(60).default([]),
    text: z.string().trim().min(5).max(500),
    amount: z.object({ value: z.number().positive(), currency: z.string().regex(/^[A-Z]{3}$/) }).strict().optional(),
    /** A missed payment made after all: when. */
    resolvedOn: day.optional(),
    /** The report ("ESPI 14/2019, 2019-06-03"); for `reviewed`, what was read ("ESPI and EBI reports 2024-01..2026-11 on bankier.pl"). */
    source: z.string().trim().min(3).max(300),
    documentSha: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    quote: z.string().trim().min(12).max(1000).optional(),
    sourceUrl: webUrl.optional(),
    dryRun: z.boolean().optional(),
  })
  .strict()
  .superRefine((e, ctx) => {
    if (e.kind !== "reviewed" && !e.documentSha) ctx.addIssue({ code: "custom", path: ["documentSha"], message: "the stored document that says it (catalyst documents put first)" });
    if (e.kind !== "reviewed" && !e.quote) ctx.addIssue({ code: "custom", path: ["quote"], message: "the passage that says it, as printed" });
    if (e.resolvedOn && e.kind !== "missed-payment") ctx.addIssue({ code: "custom", path: ["resolvedOn"], message: "only for a missed payment" });
    if (e.resolvedOn && e.resolvedOn < e.date) ctx.addIssue({ code: "custom", path: ["resolvedOn"], message: "before the payment's date" });
  });

/**
 * A bond's amortization schedule from its terms of issue (`catalyst bonds schedule <code>`): the nominal per bond after
 * each instalment before maturity, oldest first; `instalments: []` for a bond repaid at maturity in one go. It rests on
 * the terms stored with `documents put` and the passage that sets the instalments (or the single redemption).
 */
export const ScheduleInput = z
  .object({
    issuedNominal: z.number().positive(),
    instalments: z.array(z.object({ date: day, nominalAfter: z.number().positive() }).strict()).max(60),
    /** Where in the terms: "Warunki emisji obligacji serii K, pkt 8.3". */
    source: z.string().trim().min(3).max(300),
    documentSha: z.string().regex(/^[0-9a-f]{64}$/),
    quote: z.string().trim().min(12).max(1000),
    dryRun: z.boolean().optional(),
  })
  .strict()
  .superRefine((s, ctx) => {
    s.instalments.forEach((i, n) => {
      const prev = n === 0 ? undefined : s.instalments[n - 1]!;
      if (i.nominalAfter >= (prev?.nominalAfter ?? s.issuedNominal)) ctx.addIssue({ code: "custom", path: ["instalments", n, "nominalAfter"], message: "each instalment lowers the nominal" });
      if (prev && i.date <= prev.date) ctx.addIssue({ code: "custom", path: ["instalments", n, "date"], message: "instalments oldest first, one per date" });
    });
  });

/** Why a recorded payment event is withdrawn (`catalyst events retract`): it stays stored, marked, and is no longer read. */
export const RetractInput = z.object({ reason: z.string().trim().min(5).max(500), dryRun: z.boolean().optional() }).strict();

/** A report to download by hand from the KRS repository (`catalyst checklist --add`), or its new state. */
export const ChecklistInput = z
  .object({
    where: z.string().trim().min(1).max(300).optional(),
    status: z.enum(["missing", "downloaded", "imported", "not-available"]).optional(),
    note: z.string().max(500).optional(),
  })
  .strict();

/** The largest report or document the CLI may upload (ESEF packages run to 30 MB). */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** An upload URL (`POST /catalyst/filings/upload-url`): the file's exact size, signed into the URL, so S3 takes no other. */
export const UploadUrlInput = z.object({ size: z.number().int().positive().max(MAX_UPLOAD_BYTES, `at most ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`) }).strict();

/** The inputs `catalyst schema <kind>` prints. */
export const AGENT_SCHEMAS = {
  entity: AgentEntityInput,
  name: NameLinkInput,
  analysis: AnalysisInput,
  figures: CollectedFiguresInput,
  known: KnownInput,
  checklist: ChecklistInput,
  document: DocumentInput,
  event: PaymentEventInput,
  schedule: ScheduleInput,
} as const;

// ─── The token's reach ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * The writes an agent token may make (route keys of the Catalyst API). Every read of /catalyst/* is allowed but the
 * token's own; nothing of PT, no market data, settings, saved views, AI analysis switches or year reviews.
 */
export const AGENT_WRITES = [
  "PUT /catalyst/names/{name}",
  "PUT /catalyst/entities/{id}",
  "POST /catalyst/filings/upload-url",
  "POST /catalyst/filings",
  "POST /catalyst/entities/{id}/analyses",
  "POST /catalyst/entities/{id}/figures",
  "POST /catalyst/entities/{id}/known",
  "PUT /catalyst/checklist/{id}/{year}/{scope}",
  "POST /catalyst/entities/{id}/documents",
  "POST /catalyst/entities/{id}/events",
  "POST /catalyst/entities/{id}/events/{eventId}/retract",
  "PUT /catalyst/bonds/{isin}/schedule",
] as const;

export function agentMayCall(routeKey: string): boolean {
  if (routeKey.startsWith("GET /catalyst/")) return !routeKey.startsWith("GET /catalyst/agent-token");
  return (AGENT_WRITES as readonly string[]).includes(routeKey);
}

// ─── What a judgement must rest on ─────────────────────────────────────────────────────────────────────────────

/** A judgement needs the current reports read to within this many days. */
export const REPORTS_READ_WITHIN_DAYS = 45;

/**
 * What a judgement written today would miss (an empty list: nothing): the terms of each listed bond, shown by its
 * stored amortization schedule (amortization, covenants, collateral and call options are all in the terms), and the
 * company's current reports read recently (its latest `reviewed` event).
 */
export function judgementGaps(input: { listed: { isin: string; code: string }[]; schedules: Set<string>; reviewedTo: string | null; today: string }): string[] {
  const gaps: string[] = [];
  const unread = input.listed.filter((b) => !input.schedules.has(b.isin)).map((b) => b.code).sort();
  if (unread.length) gaps.push(`terms of issue not read for ${unread.join(", ")}: read each bond's terms (amortization, covenants, collateral, call) and store its schedule (catalyst bonds schedule <code>)`);
  const since = new Date(Date.parse(`${input.today}T00:00:00Z`) - REPORTS_READ_WITHIN_DAYS * 86_400_000).toISOString().slice(0, 10);
  if (!input.reviewedTo || input.reviewedTo < since)
    gaps.push(`current reports ${input.reviewedTo ? `read only to ${input.reviewedTo}` : "never read"}: read the ESPI/EBI reports to within ${REPORTS_READ_WITHIN_DAYS} days and record it (catalyst events put, kind "reviewed")`);
  return gaps;
}

// ─── What needs doing ───────────────────────────────────────────────────────────────────────────────────────────

export interface WorkItem {
  kind: "identity" | "profile" | "lender-kind" | "report" | "interim" | "checklist" | "collected" | "judgement" | "measure" | "payments";
  /** Who does it: the agent, or you (a lender's kind, a download from the KRS repository). */
  who: "agent" | "you";
  entityId: string | null;
  name: string;
  detail: string;
}

export interface WorkInput {
  today: string;
  entities: Omit<CatalystEntityItem, "PK" | "SK" | "GSI1PK" | "GSI1SK">[];
  names: Omit<CatalystNameItem, "PK" | "SK" | "GSI1PK" | "GSI1SK">[];
  /** Each company's stored years (period end, scope, months, imported). */
  years: Map<string, Pick<FinancialYear, "periodEnd" | "scope" | "months" | "importedAt">[]>;
  /** Each company's latest judgement: when, and the latest full year it was based on (unknown for migrated ones). */
  judged: Map<string, { at: string; basedOn?: string | undefined }>;
  /** Each company's latest collected figures' date. */
  collected: Map<string, string>;
  checklist: Omit<CatalystChecklistItem, "PK" | "SK" | "GSI1PK" | "GSI1SK">[];
  /** GPW's measures on each company's bonds (distress and attention only). */
  measures: Map<string, Pick<CatalystEventItem, "code" | "published" | "reason" | "signal">[]>;
  /**
   * What the payment check goes by (plan: red flags from reports): the date each company's current reports were read
   * to (its latest `reviewed` event, absent when never), and its bonds that have ended, with the day each left trading.
   */
  reviewedTo?: Map<string, string>;
  ended?: Map<string, { code: string; lastSeen: string }[]>;
  /** Whether a company is a lender of a known kind through CatalystViewer's name lists (scorecard.ts). */
  lenderByName: (entityId: string) => boolean;
  /**
   * Why a company needs its half-year report (on demand, plan N8): bonds due within 24 months, or debt service,
   * liquidity or refinancing yellow or red. Absent: it doesn't.
   */
  needsInterim?: Map<string, string>;
  /** Whether a company has no scorecard (banks, insurers, the State, municipalities, a lender of no known kind). */
  outOfScope: (entity: WorkInput["entities"][number]) => boolean;
}

const addMonths = (day: string, months: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  const target = d.getUTCMonth() + months;
  d.setUTCDate(1);
  d.setUTCMonth(target);
  // A month end stays a month end (31 Dec + 5 months = 31 May; 30 Sep + 6 months = 31 Mar), else the same day.
  const from = new Date(`${day}T00:00:00Z`);
  const fromLast = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0)).getUTCDate();
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(from.getUTCDate() === fromLast ? last : Math.min(from.getUTCDate(), last));
  return d.toISOString().slice(0, 10);
};

/** The annual report due by now and not stored: year end + 5 months (Catalyst's deadline, Annex 4 §11). */
export function annualDue(years: { periodEnd: string; months: number }[], today: string): { periodEnd: string; dueOn: string } | null {
  const full = years.filter((y) => y.months >= 12).map((y) => y.periodEnd).sort();
  const latest = full.at(-1);
  // A company without a year: the last 31 December whose report is due.
  let next = latest ? addMonths(latest, 12) : `${Number(today.slice(0, 4)) - 1}-12-31`;
  if (!latest && addMonths(next, 5) > today) next = `${Number(today.slice(0, 4)) - 2}-12-31`;
  const dueOn = addMonths(next, 5);
  return dueOn <= today ? { periodEnd: next, dueOn } : null;
}

/**
 * The full year a judgement without its basis (CatalystViewer's) most likely rested on: the latest stored one that
 * ended at least two months before it was written (an annual report rarely comes out sooner).
 */
export function assumedBasis(years: { periodEnd: string; months: number }[], at: string): string | undefined {
  const cutoff = addMonths(at.slice(0, 10), -2);
  return years.filter((y) => y.months >= 12 && y.periodEnd <= cutoff).map((y) => y.periodEnd).sort().at(-1);
}

/** The latest full year among stored years. */
export const latestFullYear = (years: { periodEnd: string; months: number }[]) => years.filter((y) => y.months >= 12).map((y) => y.periodEnd).sort().at(-1);

/** The latest period stored, a full year or a half-year after it: what a judgement written now rests on. */
export const latestPeriod = (years: { periodEnd: string }[]) => years.map((y) => y.periodEnd).sort().at(-1);

/** The half-year report after the latest full year, due by now (period end + 3 months, Annex 4 §19) and not stored. */
export function halfYearDue(years: { periodEnd: string; months: number }[], today: string): { periodEnd: string; dueOn: string } | null {
  const latest = years.filter((y) => y.months >= 12).map((y) => y.periodEnd).sort().at(-1);
  if (!latest) return null;
  const periodEnd = addMonths(latest, 6);
  const dueOn = addMonths(periodEnd, 3);
  if (dueOn > today || years.some((y) => y.months === 6 && y.periodEnd === periodEnd)) return null;
  return { periodEnd, dueOn };
}

/** What `catalyst work` lists: for companies and names with AI analysis on, the agent's items first. */
export function workItems(input: WorkInput): WorkItem[] {
  const items: WorkItem[] = [];
  const on = input.entities.filter((e) => e.aiAnalysis?.on);
  for (const n of input.names.filter((x) => x.aiAnalysis?.on && (!x.entityId || x.status === "review" || x.status === "unresolved")))
    items.push({ kind: "identity", who: "agent", entityId: n.entityId, name: n.name, detail: n.entityId ? `"${n.name}" is linked by code but the legal name differs: check it (you confirm it)` : `"${n.name}" isn't linked to a company: resolve its identity` });
  for (const n of input.names.filter((x) => x.entityId && x.status === "review" && on.some((e) => e.entityId === x.entityId) && !x.aiAnalysis?.on))
    items.push({ kind: "identity", who: "you", entityId: n.entityId, name: n.name, detail: `"${n.name}": the legal name differs from the listed one; confirm the link in the app` });
  for (const e of on) {
    const name = e.shortName;
    const years = e.financialsEntityId ? (input.years.get(e.financialsEntityId) ?? []) : (input.years.get(e.entityId) ?? []);
    if (!e.industry || !e.businessSummary) items.push({ kind: "profile", who: "agent", entityId: e.entityId, name, detail: `no ${[!e.industry && "industry", !e.businessSummary && "summary"].filter(Boolean).join(" or ")} yet (catalyst entity set)` });
    const lender = e.industry === "Finance" && !e.financeRuleSet && !e.ruleSetOverride && !input.lenderByName(e.entityId);
    if (lender) items.push({ kind: "lender-kind", who: "you", entityId: e.entityId, name, detail: "a Finance company of no known kind (debt collector, leasing and factoring, investment firm, or a bank): propose it; you set it in the app" });
    if (input.outOfScope(e) || e.financialsEntityId) {
      // Banks and the like have no scorecard; a financing vehicle's reports are its group's.
    } else {
      const due = annualDue(years, input.today);
      const waiting = input.checklist.find((c) => c.entityId === e.entityId && due && c.year === Number(due.periodEnd.slice(0, 4)));
      if (due && !waiting) items.push({ kind: "report", who: "agent", entityId: e.entityId, name, detail: `annual report FY${due.periodEnd.slice(0, 4)} (year end ${due.periodEnd}) due since ${due.dueOn}, not stored; group accounts first` });
      const why = input.needsInterim?.get(e.entityId);
      const half = !due && why ? halfYearDue(years, input.today) : null;
      if (half) items.push({ kind: "interim", who: "agent", entityId: e.entityId, name, detail: `half-year report H1 ${half.periodEnd.slice(0, 4)} (to ${half.periodEnd}) due since ${half.dueOn}, not stored (${why}); same accounts as the year, with its comparative H1` });
      const collected = input.collected.get(e.entityId);
      const newest = years.map((y) => y.importedAt).sort().at(-1);
      if (collected && (!newest || newest < collected)) items.push({ kind: "collected", who: "agent", entityId: e.entityId, name, detail: `the scorecard rests on figures collected from the web (${collected.slice(0, 10)}): look for a report` });
    }
    const judgement = input.judged.get(e.entityId);
    const judged = judgement?.at;
    const latestYear = years.filter((y) => y.months >= 12).map((y) => y.periodEnd).sort().at(-1);
    const basedOn = judgement && (judgement.basedOn ?? assumedBasis(years, judgement.at));
    // A half-year report after the latest full year, newer than the judgement's basis. Judgements written before
    // basedOn counted half-years rest on the full year: those are stale only when the half-year came in after them.
    const interim = years.filter((y) => y.months < 12 && latestYear && y.periodEnd > latestYear).sort((a, b) => a.periodEnd.localeCompare(b.periodEnd)).at(-1);
    const interimStale = judgement && basedOn && interim && basedOn < interim.periodEnd && (!interim.importedAt || interim.importedAt > judgement.at);
    if (latestYear && (!judgement || !basedOn || basedOn < latestYear))
      items.push({ kind: "judgement", who: "agent", entityId: e.entityId, name, detail: judgement ? `the judgement (${judgement.at.slice(0, 10)}) predates FY${latestYear.slice(0, 4)}, stored since${basedOn ? ` (it rests on FY${basedOn.slice(0, 4)})` : ""}` : "no judgement yet" });
    else if (interimStale)
      items.push({ kind: "judgement", who: "agent", entityId: e.entityId, name, detail: `the judgement (${judgement.at.slice(0, 10)}) predates the half-year report to ${interim.periodEnd}, stored since; read it and write a new one` });
    // The payment record: never read, or bonds ended or GPW took a measure after the reports were last read.
    if (input.ended) {
      const read = input.reviewedTo?.get(e.entityId);
      const ended = input.ended.get(e.entityId) ?? [];
      const since = read ? ended.filter((b) => b.lastSeen > read) : ended;
      const acted = (input.measures.get(e.entityId) ?? []).filter((m) => !read || m.published.slice(0, 10) > read);
      const codes = (list: { code: string }[]) => `${list.slice(0, 4).map((b) => b.code).join(", ")}${list.length > 4 ? ` and ${list.length - 4} more` : ""}`;
      const why = [...(since.length ? [`${since.length} bond${since.length === 1 ? "" : "s"} ended${read ? " since" : ""} (${codes(since)})`] : []), ...(acted.length ? [`${acted.length} GPW measure${acted.length === 1 ? "" : "s"}${read ? " since" : ""} (${codes(acted)})`] : [])];
      if (why.length || !read)
        items.push({ kind: "payments", who: "agent", entityId: e.entityId, name, detail: `${read ? `current reports read to ${read}; ` : "payment record never checked against the current reports; "}${why.join("; ") || "no bond has ended yet"}: read the ESPI/EBI reports${read ? ` after ${read}` : ""} and record what they say (catalyst events put)` });
    }
    for (const m of (input.measures.get(e.entityId) ?? []).filter((x) => !judged || x.published > judged))
      items.push({ kind: "measure", who: "agent", entityId: e.entityId, name, detail: `GPW, ${m.published.slice(0, 10)}, ${m.code}: ${m.reason} (${m.signal}${judged ? ", after the judgement" : ""})` });
  }
  for (const c of input.checklist.filter((x) => x.status === "missing" && on.some((e) => e.entityId === x.entityId)))
    items.push({ kind: "checklist", who: "you", entityId: c.entityId, name: on.find((e) => e.entityId === c.entityId)!.shortName, detail: `download FY${c.year} (${c.scope}) from the KRS repository: ${c.where}` });
  const order: WorkItem["kind"][] = ["identity", "profile", "report", "interim", "collected", "judgement", "measure", "payments", "lender-kind", "checklist"];
  return items.sort((a, b) => Number(a.who === "you") - Number(b.who === "you") || order.indexOf(a.kind) - order.indexOf(b.kind) || a.name.localeCompare(b.name));
}
