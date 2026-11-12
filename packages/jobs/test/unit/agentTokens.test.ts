import { describe, expect, it } from "vitest";
import { AgentTokenInput, LEGACY_ID, MAX_AGENT_TOKENS, addToken, allTokens, matchToken, removeToken, viewOf, type AgentToken } from "../../src/catalyst/agentTokens.ts";
import { newFeedToken } from "../../src/lib/feedToken.ts";

const ok = (r: ReturnType<typeof addToken>) => {
  if ("error" in r) throw new Error(r.error);
  return r;
};

describe("agent tokens", () => {
  it("several at once, each with its own name; each matches only itself", () => {
    const a = ok(addToken([], "Laptop"));
    const b = ok(addToken(a.list, "Cloud routine"));
    expect(b.list.map((t) => t.name)).toEqual(["Laptop", "Cloud routine"]);
    expect(matchToken(a.token, b.list)?.name).toBe("Laptop");
    expect(matchToken(b.token, b.list)?.name).toBe("Cloud routine");
    expect(matchToken("A".repeat(43), b.list)).toBeUndefined();
    expect(matchToken(undefined, b.list)).toBeUndefined();
    expect(JSON.stringify(b.list)).not.toContain(a.token);
    expect(viewOf(b.made)).toEqual({ id: b.made.id, name: "Cloud routine", createdAt: b.made.createdAt, lastUsedAt: null });
    expect(Object.keys(viewOf(b.made))).not.toContain("hash");
  });

  it("names are unique (ignoring case); at most MAX_AGENT_TOKENS", () => {
    const a = ok(addToken([], "Laptop"));
    expect(addToken(a.list, "laptop")).toEqual({ error: 'name: a token named "laptop" exists already' });
    let list: AgentToken[] = [];
    for (let i = 0; i < MAX_AGENT_TOKENS; i++) list = ok(addToken(list, `m${i}`)).list;
    expect("error" in addToken(list, "one more")).toBe(true);
  });

  it("revoking one leaves the others working", () => {
    const a = ok(addToken([], "Laptop"));
    const b = ok(addToken(a.list, "Desktop"));
    const left = removeToken(b.list, a.made.id)!;
    expect(matchToken(a.token, left)).toBeUndefined();
    expect(matchToken(b.token, left)?.name).toBe("Desktop");
    expect(removeToken(left, "nosuch")).toBeUndefined();
  });

  it("the single token of before is listed unnamed, still works, and gets an id of its own when the list is written", () => {
    const { token, stored } = newFeedToken(new Date("2026-11-08T10:00:00Z"));
    const all = allTokens(null, stored);
    expect(all).toEqual([{ ...stored, id: LEGACY_ID, name: "Unnamed (made 2026-11-08)" }]);
    expect(matchToken(token, all)?.id).toBe(LEGACY_ID);
    const added = ok(addToken(all, "Laptop"));
    expect(added.list[0]!.id).not.toBe(LEGACY_ID);
    expect(matchToken(token, added.list)?.name).toBe("Unnamed (made 2026-11-08)");
    expect(removeToken(all, LEGACY_ID)).toEqual([]);
  });

  it("a name: trimmed, 1 to 40 characters a record can carry", () => {
    expect(AgentTokenInput.parse({ name: "  Laptop (home)  " })).toEqual({ name: "Laptop (home)" });
    expect(AgentTokenInput.safeParse({ name: " " }).success).toBe(false);
    expect(AgentTokenInput.safeParse({ name: "x".repeat(41) }).success).toBe(false);
    expect(AgentTokenInput.safeParse({ name: "a;b" }).success).toBe(false);
    expect(AgentTokenInput.safeParse({ name: "<script>" }).success).toBe(false);
    expect(AgentTokenInput.safeParse({}).success).toBe(false);
  });
});
