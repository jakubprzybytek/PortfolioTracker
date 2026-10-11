// Integration tests run against the deployed `dev` stage (keep `npm run dev -- --stage dev` running,
// or deploy with `npm run deploy -- --stage dev`). Outputs come from .sst/outputs.json or env vars.

import { readFileSync } from "node:fs";
import path from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

interface Outputs {
  api: string;
  files: string;
}

function readOutputs(): Outputs {
  const fromEnv = { api: process.env["API_URL"], files: process.env["FILES_BUCKET"] };
  if (fromEnv.api && fromEnv.files) return fromEnv as Outputs;
  const file = path.resolve(import.meta.dirname, "../../../../.sst/outputs.json");
  try {
    const json = JSON.parse(readFileSync(file, "utf8")) as Partial<Outputs>;
    return { api: fromEnv.api ?? json.api!, files: fromEnv.files ?? json.files! };
  } catch (err) {
    throw new Error(`No deployed stage found: set API_URL/FILES_BUCKET or run "npm run dev -- --stage dev" first (${(err as Error).message})`);
  }
}

export const outputs = readOutputs();
export const API = outputs.api.replace(/\/$/, "");

export async function get<T = unknown>(path: string): Promise<{ status: number; body: T }> {
  const res = await fetch(API + path);
  const text = await res.text();
  let body: T;
  try {
    body = JSON.parse(text) as T;
  } catch {
    body = text as unknown as T;
  }
  return { status: res.status, body };
}

const s3 = new S3Client({});

export async function uploadImport(kind: string, name: string, content: Buffer | string): Promise<string> {
  const key = `imports/${kind}/${name}`;
  await s3.send(new PutObjectCommand({ Bucket: outputs.files, Key: key, Body: content }));
  return key;
}

/** Polls `check` until it returns a value, for up to `timeoutMs`. */
export async function waitFor<T>(check: () => Promise<T | undefined>, timeoutMs = 90_000, everyMs = 3_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const v = await check();
      if (v !== undefined) return v;
    } catch (err) {
      last = err;
    }
    await new Promise((r) => setTimeout(r, everyMs));
  }
  throw new Error(`Timed out after ${timeoutMs} ms${last ? `; last error: ${(last as Error).message}` : ""}`);
}

export const repoRoot = path.resolve(import.meta.dirname, "../../../..");
