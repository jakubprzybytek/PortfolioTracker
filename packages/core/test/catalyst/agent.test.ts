import { describe, expect, it } from "vitest";
import { AGENT_SCHEMAS, AnalysisInput, agentMayCall, annualDue, assumedBasis, workItems, type WorkInput } from "../../src/catalyst/agent.ts";

const entity = (entityId: string, over: Partial<WorkInput["entities"][number]> = {}): WorkInput["entities"][number] => ({
  entityId,
  shortName: entityId === "0000000001" ? "Abc" : "Kruk",
  legalName: "x",
  country: "PL",
  krs: entityId,
  lei: null,
  leiStatus: "ISSUED",
  status: "ACTIVE",
  legalForm: "SA",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  aiAnalysis: { on: true, by: "you", at: "2026-11-01" },
  industry: "Developer",
  businessSummary: "Builds flats.",
  ...over,
} as WorkInput["entities"][number]);
const input = (over: Partial<WorkInput> = {}): WorkInput => ({
  today: "2026-11-08",
  entities: [],
  names: [],
  years: new Map(),
  judged: new Map(),
  collected: new Map(),
  checklist: [],
  measures: new Map(),
  lenderByName: () => false,
  outOfScope: (e) => e.industry === "Municipal",
  ...over,
});
const fy = (periodEnd: string, importedAt = "2026-06-01T00:00:00Z") => ({ periodEnd, scope: "group" as const, months: 12, importedAt });

describe("the annual report due", () => {
  it("year end + 5 months: FY2025 is due from 2026-05-31", () => {
    expect(annualDue([fy("2024-12-31")], "2026-05-30")).toBeNull();
    expect(annualDue([fy("2024-12-31")], "2026-05-31")).toEqual({ periodEnd: "2025-12-31", dueOn: "2026-05-31" });
    expect(annualDue([fy("2025-12-31")], "2026-11-08")).toBeNull();
  });
  it("a fiscal year ending in June: due at the end of November", () => {
    expect(annualDue([fy("2025-06-30")], "2026-11-08")).toBeNull();
    expect(annualDue([fy("2025-06-30")], "2026-11-30")).toEqual({ periodEnd: "2026-06-30", dueOn: "2026-11-30" });
  });
  it("no year stored: the last December's report already due", () => {
    expect(annualDue([], "2026-11-08")).toEqual({ periodEnd: "2025-12-31", dueOn: "2026-05-31" });
    expect(annualDue([], "2026-03-01")).toEqual({ periodEnd: "2024-12-31", dueOn: "2025-05-31" });
  });
  it("part years don't count as the year", () => {
    expect(annualDue([{ periodEnd: "2026-06-30", months: 6 }, { periodEnd: "2025-12-31", months: 12 }], "2026-11-08")).toBeNull();
  });
});

describe("what needs doing", () => {
  it("only companies with AI analysis on", () => {
    const items = workItems(input({ entities: [entity("0000000001", { aiAnalysis: { on: false, by: "you", at: "x" } })] }));
    expect(items).toEqual([]);
  });

  it("a report due, then the judgement after it is imported", () => {
    expect(workItems(input({ entities: [entity("0000533217")], years: new Map([["0000533217", [fy("2024-12-31")]]]) })).map((i) => i.kind)).toEqual(["report", "judgement"]);
    const done = input({ entities: [entity("0000533217")], years: new Map([["0000533217", [fy("2025-12-31")]]]), judged: new Map([["0000533217", { at: "2026-06-02T00:00:00Z", basedOn: "2025-12-31" }]]) });
    expect(workItems(done)).toEqual([]);
    // Importing the same year again (a migration, a fresh parse) doesn't make it stale; a later year does.
    done.years.set("0000533217", [fy("2025-12-31", "2026-11-08T00:00:00Z")]);
    expect(workItems(done)).toEqual([]);
    done.years.set("0000533217", [fy("2025-12-31"), fy("2026-12-31", "2027-04-01T00:00:00Z")]);
    expect(workItems({ ...done, today: "2027-04-02" })[0]!.detail).toBe("the judgement (2026-06-02) predates FY2026, stored since (it rests on FY2025)");
  });

  it("a report on the checklist isn't asked for again; the download is yours", () => {
    const items = workItems(input({ entities: [entity("0000533217")], years: new Map([["0000533217", [fy("2024-12-31")]]]), checklist: [{ entityId: "0000533217", krs: "0000533217", year: 2025, scope: "group", where: "KRS repository", status: "missing", by: "agent", at: "x" }] }));
    expect(items.map((i) => [i.kind, i.who])).toEqual([["judgement", "agent"], ["checklist", "you"]]);
  });

  it("a Finance company of no known kind: its kind is yours to set; no report asked for a bank-like one", () => {
    const items = workItems(input({ entities: [entity("0000533217", { industry: "Finance" })], outOfScope: () => true }));
    expect(items.map((i) => [i.kind, i.who])).toEqual([["lender-kind", "you"]]);
    expect(workItems(input({ entities: [entity("0000533217", { industry: "Finance" })], lenderByName: () => true, outOfScope: () => false })).map((i) => i.kind)).toEqual(["report"]);
  });

  it("a name switched on but not linked; a profile missing; a measure after the judgement", () => {
    const items = workItems(
      input({
        names: [{ name: "Nowa Spółka S.A.", entityId: null, status: "unresolved", evidence: "", updatedAt: "x", aiAnalysis: { on: true, by: "you", at: "x" } }],
        entities: [entity("0000533217", { businessSummary: undefined } as never)],
        years: new Map([["0000533217", [fy("2025-12-31")]]]),
        judged: new Map([["0000533217", { at: "2026-07-01T00:00:00Z", basedOn: "2025-12-31" }]]),
        measures: new Map([["0000533217", [{ code: "KRU0829", published: "2026-08-01T08:00:00", reason: "na żądanie KNF", signal: "distress" }, { code: "KRU0829", published: "2026-01-01T08:00:00", reason: "old", signal: "distress" }]]]),
      }),
    );
    expect(items.map((i) => i.kind)).toEqual(["identity", "profile", "measure"]);
    expect(items[2]!.detail).toContain("na żądanie KNF");
  });

  it("a financing vehicle is judged on its group's years", () => {
    const items = workItems(input({ entities: [entity("LEI:259400AAAAAAAAAAAA01", { financialsEntityId: "0000533217" })], years: new Map([["0000533217", [fy("2025-12-31")]]]) }));
    expect(items.map((i) => i.kind)).toEqual(["judgement"]);
  });
});

describe("a migrated judgement's basis", () => {
  it("the latest year ended two months before it was written", () => {
    const years = [fy("2024-12-31"), fy("2025-12-31")];
    expect(assumedBasis(years, "2026-05-28T10:00:00Z")).toBe("2025-12-31");
    expect(assumedBasis(years, "2026-02-15T10:00:00Z")).toBe("2024-12-31");
    expect(assumedBasis(years, "2024-06-01T10:00:00Z")).toBeUndefined();
  });
});

describe("the agent token's reach", () => {
  it("reads of the module, the listed writes; not the switches, reviews, settings or the token", () => {
    expect(agentMayCall("GET /catalyst/entities/{id}")).toBe(true);
    expect(agentMayCall("GET /catalyst/work")).toBe(true);
    expect(agentMayCall("POST /catalyst/entities/{id}/analyses")).toBe(true);
    expect(agentMayCall("PUT /catalyst/names/{name}")).toBe(true);
    for (const refused of ["GET /catalyst/agent-token", "POST /catalyst/agent-token", "PUT /catalyst/entities/{id}/ai", "PUT /catalyst/names/{name}/ai", "PUT /catalyst/entities/{id}/years/{period}", "PUT /catalyst/settings/assumptions", "PUT /catalyst/views", "GET /holdings"])
      expect(agentMayCall(refused)).toBe(false);
  });
});

describe("the agent's inputs", () => {
  it("a judgement needs its sources and the model", () => {
    expect(AnalysisInput.safeParse({ markdown: "x".repeat(60), meta: { model: "claude", sources: [], redFlags: [] } }).success).toBe(false);
    expect(AnalysisInput.safeParse({ markdown: "x".repeat(60), meta: { model: "claude", sources: ["FY2025 annual report"], redFlags: [] } }).success).toBe(true);
  });
  it("a company's description can't carry a lender kind or the switch", () => {
    expect(AGENT_SCHEMAS.entity.safeParse({ industry: "Developer" }).success).toBe(true);
    expect(AGENT_SCHEMAS.entity.safeParse({ financeRuleSet: "collector" }).success).toBe(false);
    expect(AGENT_SCHEMAS.entity.safeParse({ aiAnalysis: { on: true } }).success).toBe(false);
  });
});
