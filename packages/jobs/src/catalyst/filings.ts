// Storing a report read on the user's machine (Docs/catalyst.md, "Reading reports"; core/catalyst/financials.ts):
// the filing as parsed, checked again here (the balance sheet and its lines add up), the original kept in the files
// bucket, its years stored with the most recent report winning, the replaced versions kept apart. Used by the API
// (the CLI's import) and the import scripts.

import { createHash } from "node:crypto";
import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { filingKey, filingRows, MAX_UPLOAD_BYTES, planYears, rowChecks, type FinancialYear } from "@portfolio/core/catalyst/index";
import type { ParsedFiling } from "@portfolio/core/catalyst/filings/filingParser";
import { bucketName } from "../lib/context.ts";
import { catalystRepo, queueCatalyst } from "./context.ts";

const s3 = new S3Client({});

export class FilingRefused extends Error {}

export interface StoreFilingInput {
  entityId: string;
  filing: ParsedFiling;
  sha256: string;
  extension: string;
  contentType: string;
  fileName: string;
  /** The original: its bytes, or where it was uploaded (catalyst/uploads/…). */
  original: { data: Uint8Array } | { uploadKey: string };
  enteredBy: string;
  /** Store a filing whose checks failed (you looked at it and it's right). */
  force?: boolean;
  dryRun?: boolean;
}

export interface StoreFilingResult {
  key: string;
  stored: string[];
  kept: { period: string; storedFrom: string }[];
  replaced: string[];
  checks: string[];
  rows: FinancialYear[];
  dryRun: boolean;
}

export async function storeFiling(input: StoreFilingInput): Promise<StoreFilingResult> {
  const { entityId, filing, sha256, force } = input;
  if (!(await catalystRepo.getEntity(entityId))) throw new FilingRefused(`No company ${entityId}`);
  if (filing.periods.length === 0) throw new FilingRefused("The filing has no years");
  const importedAt = new Date().toISOString();
  const key = filingKey(entityId, filing.periods[0]!.periodEnd, filing.scope, sha256, input.extension);
  const rows = filingRows(entityId, filing, { key, sha256, enteredBy: input.enteredBy, importedAt });
  // The parser's checks, and the app's own on what it's sent; a failure the parser didn't report is the app's find.
  const ours = rows.flatMap(rowChecks).filter((c) => !filing.checks.includes(c));
  const checks = [...filing.checks, ...ours];
  if (checks.length > 0 && !force) throw new FilingRefused(`The filing doesn't add up:\n  ${checks.join("\n  ")}\nLook at it; if it's right, import it with force`);

  // The original must be the file the figures came from.
  const data = "data" in input.original ? input.original.data : await readUpload(input.original.uploadKey);
  const actual = createHash("sha256").update(data).digest("hex");
  if (actual !== sha256) throw new FilingRefused(`The file isn't the one read (SHA-256 ${actual.slice(0, 12)}…, expected ${sha256.slice(0, 12)}…)`);

  const stored = new Map((await catalystRepo.listYears(entityId)).map((r) => [r.period, r as FinancialYear]));
  const plan = planYears(rows, stored);
  const result = { key, stored: plan.put.map((r) => r.period), kept: plan.kept, replaced: plan.replaced.map((r) => `${r.period} (from ${r.reportPeriodEnd})`), checks, rows: plan.put, dryRun: Boolean(input.dryRun) };
  if (input.dryRun) return result;

  if ("uploadKey" in input.original) {
    await s3.send(new CopyObjectCommand({ Bucket: bucketName, CopySource: `${bucketName}/${input.original.uploadKey}`, Key: key, ContentType: input.contentType, MetadataDirective: "REPLACE" }));
    // The upload was only in transit (a dry run keeps it, for the import that follows).
    await s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: input.original.uploadKey }));
  } else await s3.send(new PutObjectCommand({ Bucket: bucketName, Key: key, Body: data, ContentType: input.contentType }));
  await catalystRepo.putYears(plan.put, plan.replaced);
  await catalystRepo.putFiling({
    entityId,
    sha256,
    key,
    fileName: input.fileName,
    format: filing.format,
    scope: filing.scope,
    periodEnd: filing.periods[0]!.periodEnd,
    stored: result.stored,
    kept: plan.kept.map((k) => k.period),
    replaced: result.replaced,
    checks,
    enteredBy: input.enteredBy,
    importedAt,
  });
  await queueCatalyst({ kind: "metrics" });
  return result;
}

/** An upload's bytes; one above the limit (the URL is signed for its size, so only a file put there otherwise) is refused unread. */
export async function readUpload(key: string): Promise<Uint8Array> {
  const res = await s3.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
  if ((res.ContentLength ?? 0) > MAX_UPLOAD_BYTES) {
    res.Body?.transformToWebStream().cancel().catch(() => {});
    throw new FilingRefused(`The upload is ${((res.ContentLength ?? 0) / 1024 / 1024).toFixed(1)} MB; at most ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
  }
  return new Uint8Array(await res.Body!.transformToByteArray());
}
