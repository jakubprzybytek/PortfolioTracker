import { describe, expect, it } from "vitest";
import { hashToken, newFeedToken, shouldTouch, tokenMatches } from "../../src/lib/feedToken.ts";

describe("feed token", () => {
  const { token, stored } = newFeedToken(new Date("2026-10-20T10:00:00Z"));

  it("is 32 random bytes, URL-safe; only its hash is stored", () => {
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(stored).toEqual({ hash: hashToken(token), createdAt: "2026-10-20T10:00:00.000Z" });
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(newFeedToken().token).not.toBe(token);
  });

  it("matches only the stored token", () => {
    expect(tokenMatches(token, stored)).toBe(true);
    expect(tokenMatches(token.slice(1), stored)).toBe(false);
    expect(tokenMatches(newFeedToken().token, stored)).toBe(false);
    expect(tokenMatches(undefined, stored)).toBe(false);
    expect(tokenMatches("", stored)).toBe(false);
    expect(tokenMatches(token, undefined)).toBe(false);
    expect(tokenMatches("x".repeat(500), stored)).toBe(false);
  });

  it("records a use at most hourly", () => {
    expect(shouldTouch(stored)).toBe(true);
    const used = { ...stored, lastUsedAt: "2026-10-20T10:00:00.000Z" };
    expect(shouldTouch(used, new Date("2026-10-20T10:59:00Z"))).toBe(false);
    expect(shouldTouch(used, new Date("2026-10-20T11:00:00Z"))).toBe(true);
  });
});
