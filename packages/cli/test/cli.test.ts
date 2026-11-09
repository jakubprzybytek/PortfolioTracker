import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run, table } from "../src/cli.ts";
import type { Io } from "../src/client.ts";
import { apiUrl, configDir } from "../src/stage.ts";

const TOKEN = "a".repeat(43);

/** A fake API: answers by "<method> <path>", records what was sent. */
function setup(routes: Record<string, (body: unknown) => { status?: number; body: unknown }> = {}, { secret = TOKEN, login = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "catalyst-cli-"));
  const out: string[] = [];
  const err: string[] = [];
  const sent: { method: string; url: string; auth: string | null; by: string | null; body: unknown }[] = [];
  const fetchFake = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
    sent.push({ method, url: u, auth: headers.get("authorization"), by: headers.get("x-catalyst-by"), body });
    const path = u.replace(/^https:\/\/dev\.portfoliotracker\.albedoonline\.com\/api\/catalyst\/agent/, "");
    const route = routes[`${method} ${path}`];
    if (!route) return new Response(JSON.stringify({ error: `no fake for ${method} ${path}` }), { status: 404 });
    const r = route(body);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as typeof fetch;
  const io: Io = { out: (s) => out.push(s), err: (s) => err.push(s), fetch: fetchFake, env: {}, secret: async () => secret, clipboard: async () => `${TOKEN}
`, configDir: dir };
  if (login) writeFileSync(join(dir, "agent-token.dev.json"), JSON.stringify({ stage: "dev", token: TOKEN }));
  const cli = async (...args: string[]) => ({ code: await run(args, io), out: out.splice(0).join("\n"), err: err.splice(0).join("\n") });
  return { cli, sent, dir };
}

describe("catalyst CLI", () => {
  it("prints its version and help; refuses an unknown command", async () => {
    const { cli } = setup();
    expect((await cli("--version")).out).toBe("0.1.0");
    expect((await cli()).out).toContain("Usage: catalyst <command>");
    const r = await cli("nonsense");
    expect(r.code).toBe(1);
    expect(r.err).toContain('unknown command "nonsense"');
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

  it("login: checks the token with the stage before keeping it; prints only its last four characters", async () => {
    const ok = setup({ "GET /work": () => ({ body: { items: [] } }) }, { login: false });
    const r = await ok.cli("login", "--stage", "dev");
    expect(r.out).toBe("Saved the agent token for dev (…aaaa).");
    expect(r.out).not.toContain(TOKEN);
    expect(JSON.parse(readFileSync(join(ok.dir, "agent-token.dev.json"), "utf8")).token).toBe(TOKEN);
    // From the clipboard (Claude Code's `!` has no terminal to type into).
    const clip = setup({ "GET /work": () => ({ body: { items: [] } }) }, { login: false, secret: "" });
    expect((await clip.cli("login", "--stage", "dev", "--from-clipboard")).out).toBe("Saved the agent token for dev (…aaaa).");
    const refused = setup({ "GET /work": () => ({ status: 401, body: { error: "No agent token" } }) }, { login: false });
    expect((await refused.cli("login", "--stage", "dev")).err).toContain("refuses this token");
    expect(existsSync(join(refused.dir, "agent-token.dev.json"))).toBe(false);
  });

  it("without a token: says how to make one", async () => {
    const { cli } = setup({}, { login: false });
    const r = await cli("work");
    expect(r.code).toBe(1);
    expect(r.err).toContain("make one in the Catalyst settings");
  });

  it("work: the token and who the agent is go with every call", async () => {
    const { cli, sent } = setup({ "GET /work": () => ({ body: { items: [{ kind: "report", who: "agent", entityId: "0000533217", name: "Kruk", detail: "annual report FY2025 due" }] } }) });
    const r = await cli("work", "--by", "claude-opus-5-5", "--table");
    expect(r.out).toContain("Kruk");
    expect(sent[0]).toMatchObject({ auth: `Bearer ${TOKEN}`, by: "claude-opus-5-5" });
  });

  it("bond: the app's figures, never obligacje.pl's text", async () => {
    const { cli } = setup({ "GET /bonds": () => ({ body: { date: "2026-11-06", rows: [{ isin: "PLKRU0000001", code: "KRU0829", couponText: "zmienne WIBOR 3M + 3.3%", issuer: "Kruk S.A.", maturity: "2029-08-12", yieldNet: 0.06, premium: 0.03 }] } }) });
    const r = JSON.parse((await cli("bond", "kru0829")).out);
    expect(r.code).toBe("KRU0829");
    expect(r.couponText).toBeUndefined();
  });

  it("entity set: checked here first; a lender's kind is refused before anything is sent", async () => {
    const { cli, sent, dir } = setup({ "PUT /entities/0000533217": (b) => ({ body: { entityId: "0000533217", ...(b as object) } }) });
    writeFileSync(join(dir, "e.json"), JSON.stringify({ industry: "Finance", financeRuleSet: "collector" }));
    const refused = await cli("entity", "set", "0000533217", "--file", join(dir, "e.json"));
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("not valid");
    expect(sent).toHaveLength(0);
    writeFileSync(join(dir, "e.json"), JSON.stringify({ industry: "Finance", businessSummary: "Buys and collects debts." }));
    expect(JSON.parse((await cli("entity", "set", "0000533217", "--file", join(dir, "e.json"), "--dry-run")).out).dryRun).toBe(true);
    expect(sent).toHaveLength(0);
    expect((await cli("entity", "set", "0000533217", "--file", join(dir, "e.json"))).code).toBe(0);
    expect(sent[0]).toMatchObject({ method: "PUT", body: { industry: "Finance" } });
  });

  it("identity set: the evidence is needed; a financing vehicle points at its group", async () => {
    const { cli, sent } = setup({ "PUT /names/PEU%20(fin)": () => ({ body: { entityId: "LEI:213800AAAAAAAAAAAAAA", status: "review" } }), "PUT /entities/LEI%3A213800AAAAAAAAAAAAAA": () => ({ body: {} }) });
    expect((await cli("identity", "set", "PEU (fin)", "--lei", "213800AAAAAAAAAAAAAA")).err).toContain("--evidence is needed");
    const r = await cli("identity", "set", "PEU (fin)", "--lei", "213800AAAAAAAAAAAAAA", "--evidence", "GLEIF: PEU (FIN) PLC, guaranteed by Pepco Group N.V.", "--financials", "LEI:213800OVMJPFP79OB449");
    expect(r.code).toBe(0);
    expect(sent.map((s) => [s.method, s.body])).toEqual([
      ["PUT", { lei: "213800AAAAAAAAAAAAAA", evidence: "GLEIF: PEU (FIN) PLC, guaranteed by Pepco Group N.V." }],
      ["PUT", { financialsEntityId: "LEI:213800OVMJPFP79OB449" }],
    ]);
  });

  it("analysis put: the judgement and what it rests on", async () => {
    const { cli, sent, dir } = setup({ "POST /entities/0000533217/analyses": (b) => ({ status: 201, body: { stored: !(b as { dryRun?: boolean }).dryRun } }) });
    writeFileSync(join(dir, "j.md"), "# Kruk\n\nDebt service is comfortable; the next maturity is covered by cash twice over.");
    writeFileSync(join(dir, "m.json"), JSON.stringify({ model: "claude-opus-5-5", sources: ["FY2025 annual report (ESEF)"], redFlags: [] }));
    const r = await cli("analysis", "put", "0000533217", "--file", join(dir, "j.md"), "--meta", join(dir, "m.json"), "--dry-run");
    expect(JSON.parse(r.out).stored).toBe(false);
    expect((sent[0]!.body as { dryRun: boolean }).dryRun).toBe(true);
  });

  it("documents put: one already held isn't uploaded again; a new one is uploaded, then stored", async () => {
    const { cli, sent, dir } = setup({
      "GET /entities/0000442287": () => ({ body: { documents: [{ sha256: "x".repeat(64), title: "held" }] } }),
      "POST /filings/upload-url": () => ({ body: { key: "catalyst/uploads/11111111-1111-1111-1111-111111111111", url: "https://s3.example/put" } }),
      "PUT https://s3.example/put": () => ({ body: {} }),
      "POST /entities/0000442287/documents": (b) => ({ status: 201, body: { stored: true, ...(b as object) } }),
    });
    writeFileSync(join(dir, "audit.pdf"), "%PDF-1.4 audit");
    const bad = await cli("documents", "put", "0000442287", join(dir, "audit.pdf"), "--kind", "auditor", "--date", "2026-03-31");
    expect(bad.err).toContain("not valid");
    expect(sent).toHaveLength(0);
    const r = JSON.parse((await cli("documents", "put", "0000442287", join(dir, "audit.pdf"), "--kind", "audit", "--date", "2026-03-31", "--title", "Auditor's report FY2025")).out);
    expect(r).toMatchObject({ stored: true, kind: "audit", fileName: "audit.pdf", uploadKey: "catalyst/uploads/11111111-1111-1111-1111-111111111111" });
    expect(sent.map((s) => `${s.method} ${s.url.replace(/^.*\/agent/, "")}`)).toEqual(["GET /entities/0000442287", "POST /filings/upload-url", "PUT https://s3.example/put", "POST /entities/0000442287/documents"]);
  });

  it("events put: the quote must stand in the document; the document's SHA-256 goes with it", async () => {
    const { cli, sent, dir } = setup({
      "POST /entities/0000053415/events": (b) => ({ status: 201, body: { stored: true, id: "ab12cd34", ...(b as object) } }),
      "POST /entities/0000053415/events/ab12cd34/retract": (b) => ({ body: { stored: true, retracted: b } }),
    });
    writeFileSync(join(dir, "espi.html"), "<html><body><p>Zarząd informuje, że Emitent nie dokonał\n wykupu obligacji serii F w&nbsp;terminie.</p></body></html>");
    const event = { kind: "missed-payment", date: "2019-06-24", isins: ["PLZPMHK00044"], text: "series F not redeemed at maturity", source: "ESPI 31/2019" };
    writeFileSync(join(dir, "wrong.json"), JSON.stringify({ ...event, quote: "Emitent dokonał wykupu obligacji serii F" }));
    const bad = await cli("events", "put", "0000053415", "--file", join(dir, "wrong.json"), "--document", join(dir, "espi.html"));
    expect(bad.code).toBe(1);
    expect(bad.err).toContain("The quote isn't in espi.html");
    writeFileSync(join(dir, "e.json"), JSON.stringify({ ...event, quote: "Emitent nie dokonał wykupu obligacji serii F w terminie" }));
    expect((await cli("events", "put", "0000053415", "--file", join(dir, "e.json"))).err).toContain("--document <file> is needed");
    expect(sent).toHaveLength(0);
    const r = JSON.parse((await cli("events", "put", "0000053415", "--file", join(dir, "e.json"), "--document", join(dir, "espi.html"), "--dry-run")).out);
    expect(r.documentSha).toMatch(/^[0-9a-f]{64}$/);
    expect(r.dryRun).toBe(true);
    // Reports read, nothing found: no document.
    writeFileSync(join(dir, "r.json"), JSON.stringify({ kind: "reviewed", date: "2026-11-01", text: "nothing about payments", source: "ESPI reports 2024-01 to 2026-11 on bankier.pl" }));
    expect((await cli("events", "put", "0000053415", "--file", join(dir, "r.json"))).code).toBe(0);
    expect((await cli("events", "retract", "0000053415", "ab12cd34", "--reason", "the wrong series")).code).toBe(0);
    expect((sent.at(-1)!.body as { reason: string }).reason).toBe("the wrong series");
  });

  it("schema: the inputs as JSON Schema", async () => {
    const { cli } = setup();
    const s = JSON.parse((await cli("schema", "analysis")).out);
    expect(s.properties.meta.required).toEqual(["model", "sources", "redFlags"]);
    expect(JSON.parse((await cli("schema", "transcript")).out).required).toContain("lines");
    expect((await cli("schema", "nope")).err).toContain('no schema "nope"');
  });

  it("table: aligned columns", () => {
    expect(table(["a", "bb"], [["x", "y"]])).toBe("a  bb\n-  --\nx  y");
  });
});
