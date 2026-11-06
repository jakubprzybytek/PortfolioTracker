import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSource, fetchWithTimeout, USER_AGENT } from "../../src/lib/http.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("fetchWithTimeout", () => {
  it("gives up on a request that doesn't answer, naming the URL", async () => {
    // A fetch that only ends when its signal aborts, as a hung connection would.
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason))));
    await expect(fetchWithTimeout("https://example.test/slow", {}, 50)).rejects.toThrow("https://example.test/slow: no answer within 0.05 s");
  });

  it("passes the request through, with a signal", async () => {
    const seen: RequestInit[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      seen.push(init);
      return new Response("ok");
    });
    const res = await fetchWithTimeout("https://example.test/", { headers: { A: "1" } });
    expect(await res.text()).toBe("ok");
    expect(seen[0]).toMatchObject({ headers: { A: "1" } });
    expect(seen[0]!.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("fetchSource", () => {
  const record = () => {
    const calls: { url: string; at: number; headers: Record<string, string> }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), at: Date.now(), headers: init.headers as Record<string, string> });
      return new Response("ok");
    });
    return calls;
  };

  it("sends the app's user agent with the caller's headers", async () => {
    const calls = record();
    await fetchSource("https://api.example.test/x", { headers: { Accept: "application/json" } });
    expect(calls[0]!.headers).toEqual({ "User-Agent": USER_AGENT, Accept: "application/json" });
  });

  it("keeps the spacing per host, also for concurrent callers, and not across hosts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-06T10:00:00Z"));
    const calls = record();
    const start = Date.now();
    const done = Promise.all([
      fetchSource("https://site-a.test/1", { minIntervalMs: 2000 }),
      fetchSource("https://site-a.test/2", { minIntervalMs: 2000 }),
      fetchSource("https://site-b.test/1", { minIntervalMs: 2000 }),
      fetchSource("https://site-a.test/3", { minIntervalMs: 2000 }),
    ]);
    await vi.runAllTimersAsync();
    await done;
    const at = (url: string) => calls.find((c) => c.url === url)!.at - start;
    expect([at("https://site-a.test/1"), at("https://site-a.test/2"), at("https://site-a.test/3")]).toEqual([0, 2000, 4000]);
    expect(at("https://site-b.test/1")).toBe(0);
  });
});
