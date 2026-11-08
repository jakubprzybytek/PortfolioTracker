// A company's other documents (plan N8): what a judgement rests on beside the statements, such as the auditor's
// report, the management report, an interim report, a current report (ESPI/EBI). Kept in the files bucket at
// catalyst/documents/<company>/<date>-<kind>-<sha12>.<ext>, never downloaded twice (one SHA-256, one copy).

import { createHash } from "node:crypto";
import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { CatalystDocumentItem } from "@portfolio/core/catalyst/index";
import { bucketName } from "../lib/context.ts";
import { catalystRepo } from "./context.ts";
import { FilingRefused } from "./filings.ts";

const s3 = new S3Client({});

const CONTENT_TYPE: Record<string, string> = { pdf: "application/pdf", zip: "application/zip", xml: "application/xml", xhtml: "application/xhtml+xml", html: "text/html", txt: "text/plain" };

export const documentKey = (entityId: string, date: string, kind: string, sha256: string, extension: string) => `catalyst/documents/${entityId.replace(":", "-")}/${date}-${kind}-${sha256.slice(0, 12)}.${extension}`;

export interface StoreDocumentInput {
  entityId: string;
  uploadKey: string;
  sha256: string;
  fileName: string;
  kind: CatalystDocumentItem["kind"];
  date: string;
  title: string;
  sourceUrl?: string;
  by: string;
  dryRun?: boolean;
}

/** Stores a document uploaded by the CLI; one already held (same SHA-256) is kept as it was. */
export async function storeDocument(input: StoreDocumentInput): Promise<{ document: Omit<CatalystDocumentItem, "PK" | "SK">; stored: boolean; duplicate: boolean }> {
  if (!(await catalystRepo.getEntity(input.entityId))) throw new FilingRefused(`No company ${input.entityId}`);
  const held = (await catalystRepo.listDocuments(input.entityId)).find((d) => d.sha256 === input.sha256);
  if (held) {
    if (!input.dryRun) await s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: input.uploadKey }));
    const { PK: _p, SK: _s, ...document } = held;
    return { document, stored: false, duplicate: true };
  }
  const res = await s3.send(new GetObjectCommand({ Bucket: bucketName, Key: input.uploadKey }));
  const data = new Uint8Array(await res.Body!.transformToByteArray());
  const actual = createHash("sha256").update(data).digest("hex");
  if (actual !== input.sha256) throw new FilingRefused(`The file isn't the one read (SHA-256 ${actual.slice(0, 12)}…, expected ${input.sha256.slice(0, 12)}…)`);
  const extension = (/\.([a-z0-9]{2,5})$/i.exec(input.fileName)?.[1] ?? "bin").toLowerCase();
  const key = documentKey(input.entityId, input.date, input.kind, input.sha256, extension);
  const document = {
    entityId: input.entityId,
    sha256: input.sha256,
    key,
    fileName: input.fileName,
    kind: input.kind,
    date: input.date,
    title: input.title,
    ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
    size: data.length,
    by: input.by,
    at: new Date().toISOString(),
  };
  if (input.dryRun) return { document, stored: false, duplicate: false };
  await s3.send(new CopyObjectCommand({ Bucket: bucketName, CopySource: `${bucketName}/${input.uploadKey}`, Key: key, ContentType: CONTENT_TYPE[extension] ?? "application/octet-stream", MetadataDirective: "REPLACE" }));
  await s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: input.uploadKey }));
  await catalystRepo.putDocuments([document]);
  return { document, stored: true, duplicate: false };
}
