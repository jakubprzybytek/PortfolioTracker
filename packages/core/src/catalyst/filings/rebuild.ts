// A PDF report's transcript rebuilt from the lines CatalystViewer stored for it (Docs/catalyst-phase2-plan.md, N5):
// it kept each line's label, page and value, not the amounts as printed. Each value is found again on its page (the
// cell whose printed amount, in the report's unit, is that value; on the label's line first), so the transcript goes
// through the same checks as one the agent writes (transcript.ts): nobody copies these reports again.

import type { PdfPage } from "./pdfText.ts";
import type { StatementLine } from "./statementLines.ts";
import { LINE_FIELDS, parsePrinted, type LineField, type Transcript } from "./transcript.ts";

export interface StoredYear {
  column: "current" | "previous";
  periodStart?: string;
  periodEnd: string;
  companyName: string;
  scope: "group" | "single";
  currency: string;
  standard?: "ifrs" | "pl-uor";
  presentedUnit?: 1 | 1000 | 1000000;
  lines?: StatementLine[];
}

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/ł/g, "l").replace(/[^a-z0-9]+/g, " ").trim();

/** The cells of a page that read as amounts, each with its line. */
function amounts(page: PdfPage | undefined, style: "pl" | "en") {
  return (page?.lines ?? []).flatMap((line) =>
    line
      .split(" | ")
      .map((cell) => cell.trim())
      // English amounts have no spaces, so a cell the PDF merged ("3 4,523,463": note and amount; "(2,356,937)
      // (2,207,036)": both years) is read piece by piece too. Polish ones ("1 792,2") are split only where a negative
      // amount starts ("-1.314.375 -2.061.963", MOL).
      .flatMap((cell) => {
        const pieces = cell.split(style === "en" ? /\s+/ : /\s+(?=[(\-−–])/);
        return pieces.length > 1 ? [cell, ...pieces] : [cell];
      })
      .filter((cell) => /\d/.test(cell) && /^[(\-−–]?[\d\s.,]+\)?$/.test(cell))
      .map((cell) => ({ cell, value: parsePrinted(cell, style), line: fold(line) })),
  );
}

/**
 * The transcript of one report from its stored years (its own year and the comparative). Lines whose value isn't on
 * its page are left out and listed in `unmatched`.
 */
export function rebuildTranscript(rows: StoredYear[], pages: PdfPage[]): { transcript: Transcript; unmatched: string[] } {
  // Polish amounts ("1 792,2") or English ones ("4,523,463", Pepco): the format that finds more of the lines.
  const pl = rebuildWith(rows, pages, "pl");
  const en = rebuildWith(rows, pages, "en");
  return en.unmatched.length < pl.unmatched.length ? en : pl;
}

function rebuildWith(rows: StoredYear[], pages: PdfPage[], style: "pl" | "en"): { transcript: Transcript; unmatched: string[] } {
  const current = rows.find((r) => r.column === "current") ?? rows[0];
  if (!current?.lines?.length) throw new Error("No stored lines to rebuild a transcript from");
  const previous = rows.find((r) => r !== current);
  const unit = current.presentedUnit ?? 1;
  const pageOf = new Map(pages.map((p) => [p.page, p]));
  // The comparative's line for each of the year's: same statement and label, the n-th of that label.
  const keyed = (lines: StatementLine[]) => {
    const seen = new Map<string, number>();
    return lines.map((l) => {
      const k = `${l.statement}|${fold(l.label)}`;
      const n = seen.get(k) ?? 0;
      seen.set(k, n + 1);
      return [`${k}|${n}`, l] as const;
    });
  };
  const previousOf = new Map(keyed(previous?.lines ?? []));
  const unmatched: string[] = [];
  const printed = (line: StatementLine, value: number): string | undefined => {
    if (value === 0) return "-";
    const target = value / unit;
    const candidates = amounts(pageOf.get(line.page ?? 0), style).filter((a) => a.value !== undefined && Math.abs(a.value - target) < 0.005 + Math.abs(target) * 1e-9);
    const label = fold(line.label);
    return (candidates.find((c) => label && c.line.includes(label.slice(0, 20))) ?? candidates[0])?.cell;
  };
  const columns = [{ id: "a", ...(current.periodStart ? { periodStart: current.periodStart } : {}), periodEnd: current.periodEnd }, ...(previous ? [{ id: "b", ...(previous.periodStart ? { periodStart: previous.periodStart } : {}), periodEnd: previous.periodEnd }] : [])];
  const lines: Transcript["lines"] = [];
  for (const [key, line] of keyed(current.lines)) {
    const before = previousOf.get(key);
    const values: { column: string; printed: string }[] = [];
    const a = printed(line, line.value);
    const b = before ? printed(before, before.value) : undefined;
    // A value not found leaves out that column's amount only.
    if (a === undefined) unmatched.push(`p. ${line.page} ${line.statement} "${line.label}" (${current.periodEnd}): ${line.value}`);
    if (before && b === undefined) unmatched.push(`p. ${before.page} ${before.statement} "${before.label}" (${previous!.periodEnd}): ${before.value}`);
    if (a !== undefined) values.push({ column: "a", printed: a });
    if (b !== undefined) values.push({ column: "b", printed: b });
    if (values.length === 0) continue;
    const field = (LINE_FIELDS as readonly string[]).includes(line.item ?? "") ? (line.item as LineField) : "other";
    lines.push({ statement: line.statement, page: line.page ?? 0, label: line.label, field, values });
  }
  return {
    transcript: { companyName: current.companyName, scope: current.scope, currency: current.currency, ...(current.standard ? { standard: current.standard } : {}), unit, columns, lines },
    unmatched,
  };
}
