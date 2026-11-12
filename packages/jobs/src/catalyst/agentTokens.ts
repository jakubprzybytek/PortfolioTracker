// The AI agent's tokens (Docs/catalyst.md, "The catalyst CLI"): several at once, one per machine or routine, each with
// a name you give it so you can tell them apart and revoke one without the others. Each is shown once; only its
// SHA-256 is stored, in the module's setting `agentTokens` (a list). The single token of before (setting `agentToken`)
// keeps working: it's listed as an unnamed one, and moved into the list at the next make or revoke.

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { newFeedToken, tokenMatches, type FeedToken } from "../lib/feedToken.ts";

/** The list's setting. */
export const AGENT_TOKENS_SETTING = "agentTokens";
/** The single token of before (until 2026-11-12). */
export const LEGACY_AGENT_TOKEN_SETTING = "agentToken";
/** The id the legacy token is listed under until it's moved into the list. */
export const LEGACY_ID = "legacy";
/** At most this many tokens at once. */
export const MAX_AGENT_TOKENS = 10;

export interface AgentToken extends FeedToken {
  id: string;
  name: string;
}

/** What the app shows of a token: never its hash. */
export interface AgentTokenView {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** A token's name: what tells it apart ("Laptop", "Cloud routine"); the characters a record's `enteredBy` can carry. */
export const AgentTokenInput = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "a name, to tell the token apart")
      .max(40)
      .regex(/^[\p{L}\p{N} ._:/()-]+$/u, "letters, digits, spaces and . _ : / ( ) -"),
  })
  .strict();

/** The legacy token as a list entry (named after when it was made, since it has no name). */
const fromLegacy = (t: FeedToken): AgentToken => ({ ...t, id: LEGACY_ID, name: `Unnamed (made ${t.createdAt.slice(0, 10)})` });

/** Every token in force: the list, and the legacy token while it's still in its own setting. */
export const allTokens = (list: AgentToken[] | null | undefined, legacy: FeedToken | null | undefined): AgentToken[] => [...(legacy ? [fromLegacy(legacy)] : []), ...(list ?? [])];

export const viewOf = (t: AgentToken): AgentTokenView => ({ id: t.id, name: t.name, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt ?? null });

/** The token a bearer value is, if any (each compared in constant time). */
export const matchToken = (token: string | undefined, tokens: AgentToken[]): AgentToken | undefined => tokens.find((t) => tokenMatches(token, t));

/** A new token named `name` added to `tokens` (the legacy one moved into the list with a fresh id); or why not. */
export function addToken(tokens: AgentToken[], name: string, now = new Date()): { error: string } | { token: string; made: AgentToken; list: AgentToken[] } {
  if (tokens.some((t) => t.name.toLowerCase() === name.toLowerCase())) return { error: `name: a token named "${name}" exists already` };
  if (tokens.length >= MAX_AGENT_TOKENS) return { error: `at most ${MAX_AGENT_TOKENS} tokens: revoke one first` };
  const { token, stored } = newFeedToken(now);
  const made: AgentToken = { id: newId(), name, ...stored };
  return { token, made, list: [...settled(tokens), made] };
}

/** `tokens` without the one `id` (the legacy one moved into the list with a fresh id); undefined: no such token. */
export function removeToken(tokens: AgentToken[], id: string): AgentToken[] | undefined {
  if (!tokens.some((t) => t.id === id)) return undefined;
  return settled(tokens.filter((t) => t.id !== id));
}

/** The list as stored: the legacy token gets an id of its own. */
const settled = (tokens: AgentToken[]) => tokens.map((t) => (t.id === LEGACY_ID ? { ...t, id: newId() } : t));

const newId = () => randomBytes(6).toString("hex");
