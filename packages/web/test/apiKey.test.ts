import { describe, expect, it } from "vitest";
import { apiKey, parseApiKey } from "../src/apiKey.ts";

describe("apiKey", () => {
  it("is the path alone without params", () => {
    expect(apiKey("/holdings", {})).toBe("/holdings");
    expect(apiKey("/holdings", { isin: undefined })).toBe("/holdings");
  });

  it("is the same whatever the order of the params, leaving out undefined ones", () => {
    const a = apiKey("/holdings/history", { to: "2026-10-15", isin: "PL0000000001", from: "2026-01-01", account: undefined });
    const b = apiKey("/holdings/history", { from: "2026-01-01", isin: "PL0000000001", to: "2026-10-15" });
    expect(a).toBe(b);
    expect(a).toBe("/holdings/history?from=2026-01-01&isin=PL0000000001&to=2026-10-15");
  });

  it("tells different params apart", () => {
    expect(apiKey("/portfolio/history", { from: "2026-01-01" })).not.toBe(apiKey("/portfolio/history", { from: "2025-01-01" }));
  });

  it("parses back into the path and params, special characters included", () => {
    const params = { account: "IKE & IKZE", q: "a=b?c" };
    expect(parseApiKey(apiKey("/instruments/X/prices", params))).toEqual({ path: "/instruments/X/prices", params });
    expect(parseApiKey("/notes")).toEqual({ path: "/notes", params: {} });
  });
});
