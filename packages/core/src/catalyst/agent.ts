// The AI agent's side of the module (Docs/catalyst.md, "The catalyst CLI"): what it may send (the inputs, checked
// the same way by the CLI before sending and by the API on arrival), what it may reach through its token (the
// allow-list), and what needs doing (`catalyst work`), only for companies and names with AI analysis on.

import { z } from "zod";
import { INDUSTRIES } from "./issuers/scope.ts";
import type { CatalystChecklistItem, CatalystEntityItem, CatalystEventItem, CatalystNameItem } from "./items.ts";
import type { FinancialYear } from "./financials.ts";

// ─── Inputs ─────────────────────────────────────────────────────────────────────────────────────────────────────

const entityId = z.string().regex(/^(\d{10}|LEI:[A-Z0-9]{20})$/, "a KRS number (10 digits) or LEI:<lei>");

/** A company's description (`catalyst entity set`). Not its lender kind, override or AI analysis switch: those are yours. */
export const AgentEntityInput = z
  .object({
    shortName: z.string().trim().min(1).max(60),
    industry: z.enum(INDUSTRIES),
    businessSummary: z.string().trim().min(1).max(1500),
    website: z.string().trim().max(200).regex(/^(https?:\/\/)?[^\s/$.?#].[^\s]*$/, "a web address"),
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

/** A report to download by hand from the KRS repository (`catalyst checklist --add`), or its new state. */
export const ChecklistInput = z
  .object({
    where: z.string().trim().min(1).max(300).optional(),
    status: z.enum(["missing", "downloaded", "imported", "not-available"]).optional(),
    note: z.string().max(500).optional(),
  })
  .strict();

/** The inputs `catalyst schema <kind>` prints. */
export const AGENT_SCHEMAS = {
  entity: AgentEntityInput,
  name: NameLinkInput,
  analysis: AnalysisInput,
  figures: CollectedFiguresInput,
  known: KnownInput,
  checklist: ChecklistInput,
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
] as const;

export function agentMayCall(routeKey: string): boolean {
  if (routeKey.startsWith("GET /catalyst/")) return !routeKey.startsWith("GET /catalyst/agent-token");
  return (AGENT_WRITES as readonly string[]).includes(routeKey);
}

// ─── What needs doing ───────────────────────────────────────────────────────────────────────────────────────────

export interface WorkItem {
  kind: "identity" | "profile" | "lender-kind" | "report" | "checklist" | "collected" | "judgement" | "measure";
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
  /** Whether a company is a lender of a known kind through CatalystViewer's name lists (scorecard.ts). */
  lenderByName: (entityId: string) => boolean;
  /** Whether a company has no scorecard (banks, insurers, the State, municipalities, a lender of no known kind). */
  outOfScope: (entity: WorkInput["entities"][number]) => boolean;
}

const addMonths = (day: string, months: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  const target = d.getUTCMonth() + months;
  d.setUTCDate(1);
  d.setUTCMonth(target);
  // The month's last day when the year end is one (31 Dec + 5 months = 31 May).
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(new Date(`${day}T00:00:00Z`).getUTCDate(), last));
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

/** The latest full year among stored years: what a judgement written now rests on. */
export const latestFullYear = (years: { periodEnd: string; months: number }[]) => years.filter((y) => y.months >= 12).map((y) => y.periodEnd).sort().at(-1);

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
      const collected = input.collected.get(e.entityId);
      const newest = years.map((y) => y.importedAt).sort().at(-1);
      if (collected && (!newest || newest < collected)) items.push({ kind: "collected", who: "agent", entityId: e.entityId, name, detail: `the scorecard rests on figures collected from the web (${collected.slice(0, 10)}): look for a report` });
    }
    const judgement = input.judged.get(e.entityId);
    const judged = judgement?.at;
    const latestYear = years.filter((y) => y.months >= 12).map((y) => y.periodEnd).sort().at(-1);
    const basedOn = judgement && (judgement.basedOn ?? assumedBasis(years, judgement.at));
    if (latestYear && (!judgement || !basedOn || basedOn < latestYear))
      items.push({ kind: "judgement", who: "agent", entityId: e.entityId, name, detail: judgement ? `the judgement (${judgement.at.slice(0, 10)}) predates FY${latestYear.slice(0, 4)}, stored since${basedOn ? ` (it rests on FY${basedOn.slice(0, 4)})` : ""}` : "no judgement yet" });
    for (const m of (input.measures.get(e.entityId) ?? []).filter((x) => !judged || x.published > judged))
      items.push({ kind: "measure", who: "agent", entityId: e.entityId, name, detail: `GPW, ${m.published.slice(0, 10)}, ${m.code}: ${m.reason} (${m.signal}${judged ? ", after the judgement" : ""})` });
  }
  for (const c of input.checklist.filter((x) => x.status === "missing" && on.some((e) => e.entityId === x.entityId)))
    items.push({ kind: "checklist", who: "you", entityId: c.entityId, name: on.find((e) => e.entityId === c.entityId)!.shortName, detail: `download FY${c.year} (${c.scope}) from the KRS repository: ${c.where}` });
  const order: WorkItem["kind"][] = ["identity", "profile", "report", "collected", "judgement", "measure", "lender-kind", "checklist"];
  return items.sort((a, b) => Number(a.who === "you") - Number(b.who === "you") || order.indexOf(a.kind) - order.indexOf(b.kind) || a.name.localeCompare(b.name));
}
