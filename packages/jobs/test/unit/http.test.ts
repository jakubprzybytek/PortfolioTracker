import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithTimeout } from "../../src/lib/http.ts";

afterEach(() => vi.unstubAllGlobals());

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
