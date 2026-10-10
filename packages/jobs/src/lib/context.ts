// Shared wiring for all handlers: linked resources, the repository and the raw-file archive.

import { Resource } from "sst";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { gzipSync } from "node:zlib";
import { Repository, type IsoDate } from "@portfolio/core";

export const repo = new Repository(Resource.Table.name);
export const bucketName = Resource.Files.name;

const s3 = new S3Client({});
const lambda = new LambdaClient({});

/** Stores an original download under raw/<source>/<yyyy>/<mm>/<dd>/<file>.gz. Nothing reads it back except reprocessing. */
export async function archiveRaw(source: string, date: IsoDate, fileName: string, content: Uint8Array): Promise<string> {
  const [y, m, d] = date.split("-");
  const key = `raw/${source}/${y}/${m}/${d}/${fileName}.gz`;
  await s3.send(new PutObjectCommand({ Bucket: bucketName, Key: key, Body: gzipSync(content), ContentEncoding: "gzip" }));
  return key;
}

/** Fire-and-forget invocation of another function (used to queue a valuation re-run). */
export async function invokeAsync(functionName: string, payload: object): Promise<void> {
  await lambda.send(new InvokeCommand({ FunctionName: functionName, InvocationType: "Event", Payload: JSON.stringify(payload) }));
}

/** Runs a job body and records a JOB#/RUN# item with the outcome. Rethrows so Lambda retries apply. */
export async function runJob<T extends { itemsWritten?: number; note?: string }>(job: string, body: () => Promise<T>): Promise<T> {
  const startedAt = new Date().toISOString();
  try {
    const result = await body();
    await repo.putJobRun({ job, startedAt, finishedAt: new Date().toISOString(), status: "ok", ...result });
    console.log(`${job}: ok`, JSON.stringify(result));
    return result;
  } catch (err) {
    await repo.putJobRun({ job, startedAt, finishedAt: new Date().toISOString(), status: "failed", note: String((err as Error).message ?? err) });
    console.error(`${job}: failed`, err);
    throw err;
  }
}
