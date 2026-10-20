// The spreadsheet feed's token (GET /feeds/cash-flows.csv?token=…, Docs/ui.md "Cash flows"): one at a time, made in the
// app and shown once; only its SHA-256 is stored (setting `feedToken`), so a copy of the table can't be used to read the feed.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Where the token's hash is kept (settings). */
export const FEED_TOKEN_SETTING = "feedToken";

export interface FeedToken {
  /** SHA-256 of the token, hex. */
  hash: string;
  createdAt: string;
  lastUsedAt?: string;
}

/** `lastUsedAt` is written at most this often (IMPORTDATA refetches about hourly; a write per request isn't needed). */
export const TOUCH_EVERY_MS = 60 * 60_000;

export const hashToken = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");

/** 32 random bytes, base64url (43 characters, safe in a URL). */
export function newFeedToken(now = new Date()): { token: string; stored: FeedToken } {
  const token = randomBytes(32).toString("base64url");
  return { token, stored: { hash: hashToken(token), createdAt: now.toISOString() } };
}

/** Whether `token` is the stored one, compared in constant time (on the hashes, so the lengths always match). */
export function tokenMatches(token: string | undefined, stored: FeedToken | undefined): boolean {
  if (!token || !stored || token.length > 200) return false;
  return timingSafeEqual(Buffer.from(hashToken(token), "hex"), Buffer.from(stored.hash, "hex"));
}

/** Whether to record a use now: never recorded, or longer ago than TOUCH_EVERY_MS. */
export const shouldTouch = (stored: FeedToken, now = new Date()): boolean => !stored.lastUsedAt || now.getTime() - Date.parse(stored.lastUsedAt) >= TOUCH_EVERY_MS;
