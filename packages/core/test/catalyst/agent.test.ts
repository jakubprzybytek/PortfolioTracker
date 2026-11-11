import { describe, expect, it } from "vitest";
import { AGENT_SCHEMAS, AnalysisInput, MAX_UPLOAD_BYTES, ScheduleInput, UploadUrlInput, agentMayCall, judgementGaps, annualDue, assumedBasis, halfYearDue, latestPeriod, workItems, type WorkInput } from "../../src/catalyst/agent.ts";

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

describe("the half-year report, on demand", () => {
  it("due 3 months after 30 June, for a company that needs it; not when the next year is due, nor once stored", () => {
    const needs = new Map([["0000533217", "bonds due within 24 months"]]);
    const base = input({ today: "2026-11-08", entities: [entity("0000533217")], years: new Map([["0000533217", [fy("2025-12-31")]]]), judged: new Map([["0000533217", { at: "2026-06-02T00:00:00Z", basedOn: "2025-12-31" }]]), needsInterim: needs });
    expect(workItems(base).map((i) => i.detail)).toEqual(["half-year report H1 2026 (to 2026-06-30) due since 2026-09-30, not stored (bonds due within 24 months); same accounts as the year, with its comparative H1"]);
    expect(workItems({ ...base, today: "2026-09-29" })).toEqual([]);
    expect(workItems({ ...base, needsInterim: new Map() })).toEqual([]);
    expect(halfYearDue([fy("2025-12-31"), { periodEnd: "2026-06-30", months: 6 }], "2026-11-08")).toBeNull();
    // A September year end: the half-year ends on 31 March (a month end stays one).
    expect(halfYearDue([fy("2025-09-30")], "2026-11-08")).toEqual({ periodEnd: "2026-03-31", dueOn: "2026-06-30" });
    // The next annual report due: that one first.
    expect(workItems({ ...base, today: "2027-06-01" }).map((i) => i.kind)).toEqual(["report"]);
  });
});

describe("a judgement after a half-year report", () => {
  it("stale when the half-year came in after it; not once a judgement rests on it", () => {
    const h1 = (imported: string) => ({ periodEnd: "2026-06-30", scope: "group" as const, months: 6, importedAt: imported });
    const base = input({ today: "2026-11-08", entities: [entity("0000533217")], years: new Map([["0000533217", [fy("2025-12-31"), h1("2026-11-05T00:00:00Z")]]]), judged: new Map([["0000533217", { at: "2026-06-02T00:00:00Z", basedOn: "2025-12-31" }]]) });
    expect(workItems(base).map((i) => i.detail)).toEqual(["the judgement (2026-06-02) predates the half-year report to 2026-06-30, stored since; read it and write a new one"]);
    // Written after the half-year came in (before judgements recorded it), or resting on it: up to date.
    expect(workItems({ ...base, judged: new Map([["0000533217", { at: "2026-11-06T00:00:00Z", basedOn: "2025-12-31" }]]) })).toEqual([]);
    expect(workItems({ ...base, judged: new Map([["0000533217", { at: "2026-11-06T00:00:00Z", basedOn: "2026-06-30" }]]) })).toEqual([]);
    // The next full year makes a judgement resting on the half-year stale.
    const next = { ...base, today: "2027-04-02", years: new Map([["0000533217", [fy("2025-12-31"), h1("2026-11-05T00:00:00Z"), fy("2026-12-31", "2027-04-01T00:00:00Z")]]]), judged: new Map([["0000533217", { at: "2026-11-06T00:00:00Z", basedOn: "2026-06-30" }]]) };
    expect(workItems(next).map((i) => i.kind)).toEqual(["judgement"]);
    expect(latestPeriod([fy("2025-12-31"), h1("x")])).toBe("2026-06-30");
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
  it("an upload URL is asked for the file's size, at most 50 MB", () => {
    expect(UploadUrlInput.safeParse({ size: 1 }).success).toBe(true);
    expect(UploadUrlInput.safeParse({ size: MAX_UPLOAD_BYTES }).success).toBe(true);
    for (const body of [{}, { size: 0 }, { size: 1.5 }, { size: MAX_UPLOAD_BYTES + 1 }, { size: "10" }]) expect(UploadUrlInput.safeParse(body).success).toBe(false);
  });
  it("links are http or https only (the app shows them as links)", () => {
    const site = (website: string) => AGENT_SCHEMAS.entity.safeParse({ website }).success;
    expect(["kruk.eu", "https://www.kruk.eu/relacje", "http://łódź.pl", "ghelamco.com:8080/x?y=1"].map(site)).toEqual([true, true, true, true]);
    expect(["javascript:alert(1)", "data:text/html,x", "localhost", "https://"].map(site)).toEqual([false, false, false, false]);
    const doc = { uploadKey: "catalyst/uploads/00000000-0000-0000-0000-000000000000", sha256: "a".repeat(64), fileName: "r.pdf", kind: "audit", date: "2026-04-30", title: "Audit" };
    const source = (sourceUrl: string) => AGENT_SCHEMAS.document.safeParse({ ...doc, sourceUrl }).success;
    expect(source("https://espi.example.pl/r/1")).toBe(true);
    expect(["javascript:alert(1)", "data:text/html,x", "ftp://a.pl/r"].map(source)).toEqual([false, false, false]);
    const event = { kind: "reviewed", date: "2026-11-01", text: "Nothing found", source: "ESPI 2024-2026" };
    expect(AGENT_SCHEMAS.event.safeParse({ ...event, sourceUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(AGENT_SCHEMAS.event.safeParse({ ...event, sourceUrl: "https://bankier.pl/x" }).success).toBe(true);
  });
});

describe("judgementGaps", () => {
  const listed = [{ isin: "PLO448400013", code: "GCI0729" }, { isin: "PLO448400021", code: "GC10729" }];
  it("lists the bonds whose terms weren't read and current reports not read recently", () => {
    const gaps = judgementGaps({ listed, schedules: new Set(["PLO448400013"]), reviewedTo: "2026-09-01", today: "2026-11-11" });
    expect(gaps).toHaveLength(2);
    expect(gaps[0]).toContain("terms of issue not read for GC10729:");
    expect(gaps[1]).toContain("current reports read only to 2026-09-01");
    expect(judgementGaps({ listed, schedules: new Set(), reviewedTo: null, today: "2026-11-11" })[1]).toContain("never read");
  });
  it("is empty once every listed bond has its schedule and the reports were read within 45 days", () => {
    expect(judgementGaps({ listed, schedules: new Set(listed.map((b) => b.isin)), reviewedTo: "2026-09-27", today: "2026-11-11" })).toEqual([]);
    expect(judgementGaps({ listed: [], schedules: new Set(), reviewedTo: "2026-11-01", today: "2026-11-11" })).toEqual([]);
  });
});

describe("ScheduleInput", () => {
  const base = { issuedNominal: 1000, source: "Warunki emisji serii K, pkt 9", documentSha: "a".repeat(64), quote: "obniżenie wartości nominalnej do 800 zł" };
  it("takes instalments oldest first, each lowering the nominal; none for a bullet bond", () => {
    expect(ScheduleInput.safeParse({ ...base, instalments: [{ date: "2027-07-30", nominalAfter: 800 }, { date: "2028-07-30", nominalAfter: 600 }] }).success).toBe(true);
    expect(ScheduleInput.safeParse({ ...base, instalments: [] }).success).toBe(true);
    expect(ScheduleInput.safeParse({ ...base, instalments: [{ date: "2027-07-30", nominalAfter: 1000 }] }).success).toBe(false);
    expect(ScheduleInput.safeParse({ ...base, instalments: [{ date: "2028-07-30", nominalAfter: 800 }, { date: "2027-07-30", nominalAfter: 600 }] }).success).toBe(false);
    expect(ScheduleInput.safeParse({ ...base, quote: "", instalments: [] }).success).toBe(false);
  });
  it("is a write the agent may make", () => {
    expect(agentMayCall("PUT /catalyst/bonds/{isin}/schedule")).toBe(true);
    expect(AGENT_SCHEMAS.schedule).toBe(ScheduleInput);
    expect(AnalysisInput.safeParse({ markdown: "x".repeat(60), meta: { model: "m", sources: ["s"], redFlags: [] }, provisional: true }).success).toBe(true);
  });
});
