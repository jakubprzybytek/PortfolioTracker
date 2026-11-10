import { describe, expect, it } from "vitest";
import { webHref } from "../src/catalyst/labels.ts";

describe("webHref", () => {
  it("keeps http(s) and makes a bare address https", () => {
    expect(webHref("https://kruk.eu/x")).toBe("https://kruk.eu/x");
    expect(webHref("HTTP://a.pl")).toBe("HTTP://a.pl");
    expect(webHref("kruk.eu")).toBe("https://kruk.eu");
  });
  it("links nothing else", () => {
    for (const u of ["javascript:alert(1)", " JavaScript:alert(1)", "data:text/html,x", "vbscript:x", "", null, undefined]) expect(webHref(u)).toBeUndefined();
  });
});
