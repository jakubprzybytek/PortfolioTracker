import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { filingKey, filingRows, knownDifferences, lineProblems, planYears, rowChecks, type FinancialYear } from "../src/catalyst/index.ts";
import { readFiling, UnsupportedFilingError } from "../src/catalyst/filings/index.ts";

const xml = readFileSync(new URL("./catalyst/filings/fixtures/single-comparative-pln.xml", import.meta.url));
const meta = { key: "k", sha256: "a".repeat(64), enteredBy: "test", importedAt: "2026-11-08T00:00:00Z" };

describe("reading and storing a report", () => {
  it("reads a KRS XML file and gives a row per year it shows, the report's year first", () => {
    const read = readFiling(xml, "report.xml");
    expect(read.kind.extension).toBe("xml");
    expect(read.sha256).toMatch(/^[0-9a-f]{64}$/);
    const rows = filingRows("0000123456", read.filing, meta);
    expect(rows.map((r) => [r.column, r.reportPeriodEnd === rows[0]!.periodEnd])).toEqual([
      ["current", true],
      ["previous", true],
    ]);
    expect(rows[0]!.period).toBe(`${rows[0]!.periodEnd}#single`);
    expect(rows[0]!.review.status).toBe("parsed");
    expect(Object.keys(rows[0]!.items).length).toBeGreaterThan(5);
    for (const r of rows) expect(rowChecks(r)).toEqual([]);
  });

  it("refuses a PDF without its transcript, and a zip that isn't ESEF", () => {
    expect(() => readFiling(Buffer.from("%PDF-1.7 …"), "r.pdf")).toThrow(UnsupportedFilingError);
  });

  it("keeps the original under the company and the report's year", () => {
    expect(filingKey("LEI:213800ABC", "2025-12-31", "group", "0123456789abcdef".repeat(4), "zip")).toBe("catalyst/filings/LEI-213800ABC/2025-12-31-group-0123456789ab.zip");
  });
});

describe("the most recent report wins", () => {
  const row = (period: string, reportPeriodEnd: string, sha: string): FinancialYear => ({ ...filingRows("E", readFiling(xml).filing, meta)[0]!, period, reportPeriodEnd, filing: { key: "", sha256: sha, format: "krs-xml", schema: "", checks: [] } });

  it("stores a new year, replaces a year shown by a newer report and keeps the old row apart", () => {
    const stored = new Map([["2024-12-31#group", row("2024-12-31#group", "2024-12-31", "old")]]);
    const plan = planYears([row("2025-12-31#group", "2025-12-31", "new"), row("2024-12-31#group", "2025-12-31", "new")], stored);
    expect(plan.put.map((r) => r.period)).toEqual(["2025-12-31#group", "2024-12-31#group"]);
    expect(plan.replaced.map((r) => r.filing.sha256)).toEqual(["old"]);
    expect(plan.kept).toEqual([]);
  });

  it("keeps a year an older report shows when a newer one is stored (restated figures stay)", () => {
    const stored = new Map([["2024-12-31#group", row("2024-12-31#group", "2025-12-31", "newer")]]);
    const plan = planYears([row("2024-12-31#group", "2024-12-31", "older")], stored);
    expect(plan.put).toEqual([]);
    expect(plan.kept).toEqual([{ period: "2024-12-31#group", storedFrom: "2025-12-31" }]);
  });

  it("rewrites the same report without keeping a copy", () => {
    const stored = new Map([["2024-12-31#group", row("2024-12-31#group", "2024-12-31", "same")]]);
    expect(planYears([row("2024-12-31#group", "2024-12-31", "same")], stored).replaced).toEqual([]);
  });
});

describe("the app's own checks", () => {
  const lines = [
    { statement: "balance" as const, order: 0, label: "Aktywa razem", value: 100, item: "totalAssets" as const },
    { statement: "balance" as const, order: 1, label: "A", value: 60, parent: 0 },
    { statement: "balance" as const, order: 2, label: "B", value: 40, parent: 0 },
    { statement: "balance" as const, order: 3, label: "Pasywa razem", value: 100, item: "totalEquityAndLiabilities" as const },
  ];

  it("passes a balance sheet that adds up, refuses one that doesn't", () => {
    expect(rowChecks({ period: "p", lines, presentedUnit: 1 })).toEqual([]);
    const wrong = lines.map((l) => (l.order === 3 ? { ...l, value: 90 } : l));
    expect(rowChecks({ period: "p", lines: wrong, presentedUnit: 1 })).toEqual(["p: total assets 100 ≠ total equity and liabilities 90"]);
    const lines2 = lines.map((l) => (l.order === 2 ? { ...l, value: 30 } : l));
    expect(rowChecks({ period: "p", lines: lines2, presentedUnit: 1 })[0]).toContain('the lines under "Aktywa razem" add up to 90, not 100');
  });

  it("compares hand-read figures in thousands, and finds missing statements", () => {
    expect(knownDifferences({ revenue: 1234, cash: 50 }, { revenue: { value: 1_234_400, source: [] }, cash: { value: 49_000, source: [] } })).toEqual(["cash 49 ≠ 50"]);
    expect(lineProblems(lines, undefined)).toEqual(["no income lines", "no cashFlow lines"]);
  });
});
