import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.ts";
import { apiUrl, configDir } from "../src/stage.ts";

describe("catalyst CLI", () => {
  const capture = (args: string[]) => {
    const lines: string[] = [];
    const code = run(args, (s) => lines.push(s));
    return { code, text: lines.join("\n") };
  };

  it("prints its version and help", () => {
    expect(capture(["--version"])).toEqual({ code: 0, text: "0.1.0" });
    expect(capture([]).text).toContain("Usage: catalyst <command>");
  });

  it("refuses an unknown command", () => {
    const r = capture(["nonsense"]);
    expect(r.code).toBe(1);
    expect(r.text).toContain('unknown command "nonsense"');
  });

  it("finds each stage's API: prod at the root domain, others under it", () => {
    expect(apiUrl("prod")).toBe("https://portfoliotracker.albedoonline.com/api");
    expect(apiUrl("dev")).toBe("https://dev.portfoliotracker.albedoonline.com/api");
    expect(() => apiUrl("../evil")).toThrow("not a stage name");
  });

  it("keeps its settings in the user's profile", () => {
    expect(configDir({ APPDATA: "C:/Users/u/AppData/Roaming" }, "win32")).toBe(join("C:/Users/u/AppData/Roaming", "portfolio-tracker"));
    expect(configDir({ XDG_CONFIG_HOME: "/home/u/.config" }, "linux")).toBe(join("/home/u/.config", "portfolio-tracker"));
  });
});
