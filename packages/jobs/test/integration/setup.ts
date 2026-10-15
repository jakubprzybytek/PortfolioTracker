// Integration tests run against a deployed stage, inside `sst shell` so the stage's resources (bucket,
// site URL, test user) are available:
//   npx sst shell --stage dev -- npm run test:integration
// API_URL overrides the API address (CI points it at the custom domain).

import path from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Resource } from "sst";

function resources() {
  try {
    return { files: Resource.Files.name, site: Resource.Router.url, user: Resource.TestUser, password: Resource.TestUserPassword.value };
  } catch (err) {
    throw new Error(`Run the tests inside "npx sst shell --stage <stage> -- …" (${(err as Error).message})`);
  }
}

const res = resources();
export const outputs = { files: res.files };
export const API = (process.env["API_URL"] ?? `${res.site.replace(/\/$/, "")}/api`).replace(/\/$/, "");

/** Logs the test user in through the test client (USER_PASSWORD_AUTH) and returns an access token. */
async function login(): Promise<string> {
  const r = await fetch("https://cognito-idp.eu-west-1.amazonaws.com/", {
    method: "POST",
    headers: { "Content-Type": "application/x-amz-json-1.1", "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth" },
    body: JSON.stringify({ AuthFlow: "USER_PASSWORD_AUTH", ClientId: res.user.clientId, AuthParameters: { USERNAME: res.user.email, PASSWORD: res.password } }),
  });
  const body = (await r.json()) as { AuthenticationResult?: { AccessToken: string }; message?: string };
  if (!r.ok || !body.AuthenticationResult) throw new Error(`Test user login failed: ${body.message ?? r.status}`);
  return body.AuthenticationResult.AccessToken;
}
let token: Promise<string> | undefined;

/** GET with the test user's token; `{ auth: false }` sends none. */
export async function get<T = unknown>(path: string, opts: { auth?: boolean; token?: string } = {}): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = {};
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;
  else if (opts.auth !== false) headers["Authorization"] = `Bearer ${await (token ??= login())}`;
  const res = await fetch(API + path, { headers });
  const text = await res.text();
  let body: T;
  try {
    body = JSON.parse(text) as T;
  } catch {
    body = text as unknown as T;
  }
  return { status: res.status, body };
}

/** A write request (POST/PUT/DELETE) with a JSON body (`raw`: this text as the body instead), logged in as the test user. */
export async function send<T = unknown>(method: "POST" | "PUT" | "DELETE", path: string, body?: unknown, opts: { raw?: string } = {}): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = { Authorization: `Bearer ${await (token ??= login())}` };
  const text = opts.raw ?? (body !== undefined ? JSON.stringify(body) : undefined);
  if (text !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(API + path, { method, headers, ...(text !== undefined ? { body: text } : {}) });
  const out = await res.text();
  let parsed: T;
  try {
    parsed = JSON.parse(out) as T;
  } catch {
    parsed = out as unknown as T;
  }
  return { status: res.status, body: parsed };
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
