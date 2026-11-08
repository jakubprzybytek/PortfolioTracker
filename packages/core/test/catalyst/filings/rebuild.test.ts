import { describe, expect, it } from "vitest";
import { readPdfPages } from "../../../src/catalyst/filings/pdfText.ts";
import { rebuildTranscript } from "../../../src/catalyst/filings/rebuild.ts";
import { filingFromTranscript } from "../../../src/catalyst/filings/transcript.ts";
import { makePdf } from "./fixtures/makePdf.ts";
import { reportPages, transcript } from "./fixtures/pdfReport.ts";

describe("a PDF's transcript rebuilt from stored lines", () => {
  it("finds every stored value on its page and reads the report again to the same figures", async () => {
    const pages = await readPdfPages(makePdf(reportPages));
    const read = filingFromTranscript(pages, transcript, "test");
    // What CatalystViewer kept: each year's lines (label, page, value), not the amounts as printed.
    const rows = read.periods.map((p) => ({ column: p.column, periodStart: p.periodStart, periodEnd: p.periodEnd, companyName: read.companyName, scope: read.scope, currency: read.currency, standard: read.standard, presentedUnit: read.presentedUnit, lines: p.lines }));
    const { transcript: rebuilt, unmatched } = rebuildTranscript(rows, pages);
    expect(unmatched).toEqual([]);
    const again = filingFromTranscript(pages, rebuilt, "rebuilt");
    expect(again.checks).toEqual([]);
    expect(again.periods.map((p) => p.figures)).toEqual(read.periods.map((p) => p.figures));
  });

  it("lists a value that isn't on its page instead of inventing one", async () => {
    const pages = await readPdfPages(makePdf(reportPages));
    const read = filingFromTranscript(pages, transcript, "test");
    const p = read.periods[0]!;
    const lines = p.lines.map((l, i) => (i === 0 ? { ...l, value: l.value + 123_456_789 } : l));
    const { unmatched } = rebuildTranscript([{ column: "current", periodEnd: p.periodEnd, companyName: "x", scope: "group", currency: "PLN", presentedUnit: read.presentedUnit, lines }], pages);
    expect(unmatched).toHaveLength(1);
  });

  it("reads a cell the PDF merged piece by piece (English amounts: note and amount, or both years)", () => {
    // Pepco's 2025 income statement as its PDF comes out (page 163).
    const pages = [{ page: 163, lines: ["Revenue | 3 4,523,463 | 4,160,416", "Cost of sales | (2,356,937) (2,207,036)"] }];
    const line = (order: number, label: string, value: number) => ({ statement: "income" as const, order, label, value, page: 163 });
    const rows = [
      { column: "current" as const, periodEnd: "2025-09-30", companyName: "Pepco", scope: "group" as const, currency: "EUR", presentedUnit: 1000 as const, lines: [line(0, "Revenue", 4_523_463_000), line(1, "Cost of sales", -2_356_937_000)] },
      { column: "previous" as const, periodEnd: "2024-09-30", companyName: "Pepco", scope: "group" as const, currency: "EUR", presentedUnit: 1000 as const, lines: [line(0, "Revenue", 4_160_416_000), line(1, "Cost of sales", -2_207_036_000)] },
    ];
    const { transcript: rebuilt, unmatched } = rebuildTranscript(rows, pages);
    expect(unmatched).toEqual([]);
    expect(rebuilt.lines.map((l) => l.values.map((v) => v.printed))).toEqual([["4,523,463", "4,160,416"], ["(2,356,937)", "(2,207,036)"]]);
  });

  it("splits a merged Polish-style cell only where a negative amount starts", () => {
    // MOL's 2025 cash flow (page 213), and a Polish amount with a space that must stay whole.
    const pages = [{ page: 213, lines: ["Kölcsönök és hitelek törlesztése | -1.314.375 -2.061.963", "Przychody | 1 792,2 | 5"] }];
    const line = (order: number, label: string, value: number) => ({ statement: "cashFlow" as const, order, label, value, page: 213 });
    const rows = [
      { column: "current" as const, periodEnd: "2025-12-31", companyName: "MOL", scope: "group" as const, currency: "HUF", presentedUnit: 1000000 as const, lines: [line(0, "Kölcsönök és hitelek törlesztése", -1_314_375_000_000), line(1, "Przychody", 1_792_200_000)] },
      { column: "previous" as const, periodEnd: "2024-12-31", companyName: "MOL", scope: "group" as const, currency: "HUF", presentedUnit: 1000000 as const, lines: [line(0, "Kölcsönök és hitelek törlesztése", -2_061_963_000_000), line(1, "Przychody", 792_200_000)] },
    ];
    const { transcript: rebuilt, unmatched } = rebuildTranscript(rows, pages);
    expect(rebuilt.lines.map((l) => l.values.map((v) => v.printed))).toEqual([["-1.314.375", "-2.061.963"], ["1 792,2"]]);
    expect(unmatched).toEqual(['p. 213 cashFlow "Przychody" (2024-12-31): 792200000']);
  });
});
