// Reading a report file of any supported format (Docs/catalyst.md, "Reading reports"): an ESEF package or inline
// XBRL, an untagged IFRS document, a KRS XML statement; a PDF only with its transcript (the agent copies the lines,
// transcript.ts checks them). Runs where the file is: the CLI and scripts, on the user's machine; the app only stores
// the result (financials.ts). From CatalystViewer's importFiling.readFiling, without its model call.

import { createHash } from "node:crypto";
import { looksLikeEsef, openEsef, parseEsef } from "./esefParser.ts";
import { parseFiling, type ParsedFiling, UnsupportedFilingError } from "./filingParser.ts";
import { parseIfrsText } from "./ifrsTextParser.ts";
import { isPdf, type PdfPage, readPdfPages } from "./pdfText.ts";
import { filingFromTranscript, findStatementPages, statementsPrompt } from "./transcript.ts";
import { isZip } from "./zip.ts";

export type FileKind = { extension: "xml" | "zip" | "xhtml" | "pdf"; contentType: string };

export interface ReadFiling {
  filing: ParsedFiling;
  kind: FileKind;
  sha256: string;
}

export const sha256Of = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

/** A structured report (ESEF, IFRS text, KRS XML). A PDF needs its transcript: `readPdfFiling`. */
export function readFiling(data: Buffer, fileName = ""): ReadFiling {
  const sha256 = sha256Of(data);
  if (isPdf(data)) throw new UnsupportedFilingError("A PDF is read from its transcript: copy its statement lines first (catalyst filings pages)");
  if (looksLikeEsef(data)) {
    const zip = isZip(data);
    return { filing: parseEsef(openEsef(data, fileName)), kind: zip ? { extension: "zip", contentType: "application/zip" } : { extension: "xhtml", contentType: "application/xhtml+xml" }, sha256 };
  }
  if (isZip(data)) throw new UnsupportedFilingError("A zip that is not an ESEF report package (no reports/*.xhtml)");
  const head = data.subarray(0, 20_000).toString("utf-8");
  if (/<html[\s>]/i.test(head) || /\.x?html?$/i.test(fileName)) return { filing: parseIfrsText(data.toString("utf-8")), kind: { extension: "xhtml", contentType: "application/xhtml+xml" }, sha256 };
  return { filing: parseFiling(data.toString("utf-8")), kind: { extension: "xml", contentType: "application/xml" }, sha256 };
}

/** A PDF's statement pages and the copying instructions for them (what the agent reads before writing a transcript). */
export async function pdfStatementPages(data: Buffer): Promise<{ pages: PdfPage[]; statementPages: number[]; instructions: string }> {
  const pages = await readPdfPages(data);
  const statementPages = findStatementPages(pages);
  if (statementPages.length === 0) throw new UnsupportedFilingError("No financial statement pages found in this PDF (scanned, or not an annual report?)");
  return { pages, statementPages, instructions: statementsPrompt(pages, statementPages) };
}

/** A PDF from its transcript: every amount checked against its page (transcript.ts). `by`: who copied it. */
export async function readPdfFiling(data: Buffer, transcript: unknown, by: string): Promise<ReadFiling> {
  return { filing: filingFromTranscript(await readPdfPages(data), transcript, by), kind: { extension: "pdf", contentType: "application/pdf" }, sha256: sha256Of(data) };
}
