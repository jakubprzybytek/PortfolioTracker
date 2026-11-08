// The CLI's way into the app: the agent route of a stage's API with the agent token kept in the user's profile
// (Docs/catalyst.md, "The catalyst CLI": `catalyst login --stage <stage>` stores it; the agent never sees it).

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { apiUrl, configDir } from "./stage.ts";

export interface Io {
  out: (s: string) => void;
  err: (s: string) => void;
  fetch: typeof fetch;
  env: NodeJS.ProcessEnv;
  /** A hidden prompt (the token), or a line of stdin when it isn't a terminal. */
  secret: (question: string) => Promise<string>;
  /** The clipboard's text (`login --from-clipboard`). */
  clipboard: () => Promise<string>;
  /** Where the settings live (tests point it elsewhere). */
  configDir: string;
}

const tokenFile = (io: Io, stage: string) => join(io.configDir, `agent-token.${stage}.json`);

export function saveToken(io: Io, stage: string, token: string): void {
  mkdirSync(io.configDir, { recursive: true });
  const file = tokenFile(io, stage);
  writeFileSync(file, JSON.stringify({ stage, token, savedAt: new Date().toISOString() }), { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    // Windows: the profile folder is the user's own.
  }
}

export function forgetToken(io: Io, stage: string): boolean {
  const file = tokenFile(io, stage);
  if (!existsSync(file)) return false;
  rmSync(file);
  return true;
}

function readToken(io: Io, stage: string): string {
  const file = tokenFile(io, stage);
  if (!existsSync(file)) throw new CliError(`No agent token for ${stage}: make one in the Catalyst settings, then run (yourself) \`! npx catalyst login --stage ${stage}\``);
  return (JSON.parse(readFileSync(file, "utf8")) as { token: string }).token;
}

export class CliError extends Error {}

/** An answer of the API that isn't 2xx: its status and error. */
export class ApiError extends CliError {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function defaultConfigDir(): string {
  return configDir();
}

/** The API of one stage, through its agent route, as `by` (who the agent is: a model id). */
export class Client {
  private readonly io: Io;
  readonly stage: string;
  private readonly by: string;
  private readonly base: string;
  private readonly token: string;
  constructor(io: Io, stage: string, by: string) {
    this.io = io;
    this.stage = stage;
    this.by = by;
    this.base = `${apiUrl(stage)}/catalyst/agent`;
    this.token = readToken(io, stage);
  }

  async call<T>(method: "GET" | "PUT" | "POST", path: string, body?: unknown): Promise<T> {
    const res = await this.io.fetch(`${this.base}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.token}`, "x-catalyst-by": this.by, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    const data = text ? (JSON.parse(text) as unknown) : null;
    if (!res.ok) throw new ApiError(res.status, `${method} ${path}: ${res.status} ${(data as { error?: string } | null)?.error ?? text.slice(0, 200)}`);
    return data as T;
  }

  get<T>(path: string): Promise<T> {
    return this.call<T>("GET", path);
  }

  /** Puts a file where the API can read it (a presigned URL; uploads expire after 7 days). */
  async upload(data: Uint8Array, contentType: string): Promise<string> {
    const { key, url } = await this.call<{ key: string; url: string }>("POST", "/filings/upload-url", {});
    const res = await this.io.fetch(url, { method: "PUT", body: new Blob([new Uint8Array(data)]), headers: { "content-type": contentType } });
    if (!res.ok) throw new CliError(`upload: ${res.status} ${(await res.text()).slice(0, 200)}`);
    return key;
  }
}

export const enc = encodeURIComponent;
