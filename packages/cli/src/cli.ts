// The commands of `catalyst` (Docs/catalyst.md, "The catalyst CLI"); main.ts runs them. Reading reports, the checks,
// GLEIF and KRS lookups run here; the app is called (through the agent route, with the agent token) only to read
// stored rows and to write results. JSON by default; `--table` for people; `--dry-run` on every write.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { z } from "zod";
import { AGENT_SCHEMAS, AgentEntityInput, AnalysisInput, ChecklistInput, CollectedFiguresInput, KnownInput, PaymentEventInput, REPORTS_READ_WITHIN_DAYS, RetractInput, ScheduleInput, plainText, quoteIn, KRS_REGISTER, krsExtract, leiByIsin, leiRecords, sameName, type Fetcher, type LeiRecord, type WorkItem } from "@portfolio/core/catalyst/index";
import { isPdf, pdfStatementPages, readFiling, readPdfFiling, readPdfPages, sha256Of } from "@portfolio/core/catalyst/filings/index";
import { ApiError, CliError, Client, enc, forgetToken, saveToken, type Io } from "./client.ts";
import { apiUrl } from "./stage.ts";

const VERSION = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

const HELP = `catalyst ${VERSION}: the Catalyst module's command line (the AI agent's interface)

Usage: catalyst <command> [options]   (--stage <stage>: dev by default; --by <model>: who you are, recorded on writes)

Access (you, once per stage):
  login --stage <stage> [--from-clipboard]   store the agent token: at a hidden prompt in a terminal, or from the
                                        clipboard after "Copy" in the app (\`! npx catalyst login --stage dev --from-clipboard\` in Claude Code)
  logout --stage <stage>                forget it
  where                                 the stage's API and where the CLI keeps its settings

Reading:
  work                                  what needs doing, for the companies (and names) with AI analysis on
  bonds [--entity <id>] [--q <text>]    listed bonds: amounts, yields, liquidity, the company's signals
  bond <code>                           one bond
  entity <id> [--lines]                 a company: identity, names, bonds, years (--lines: with their lines), scorecard, judgements
  checklist                             reports waiting to be downloaded by hand from the KRS repository

Identity and description:
  identity resolve <name> | --lei <lei> | --krs <krs>   GLEIF (the name's bonds' ISINs, a full-text search) and the KRS register
  identity set <name> (--entity <id> | --lei <lei>) --evidence "…" [--financials <id>] [--dry-run]
  entity set <id> --file entity.json [--dry-run]        short name, industry, summary, website (not a lender's kind)

Reports:
  filings pages <pdf> [--out pages.txt]               the statement pages and the copying rules
  filings import <file> --entity <id> [--transcript t.json] [--dry-run] [--force]
                                        read and check here; --dry-run: what the app would store and the scorecard it would give
  checklist --add <id> <year> <scope> [--where "…"]    a report for you to download from the KRS repository
  checklist --set <id> <year> <scope> <missing|downloaded|imported|not-available>
  known put <id> --file known.json      figures read by hand from a printed report (for filings check)
  figures put <id> --file fig.json [--dry-run]         figures collected from the web, when there's no report

Documents (what a judgement rests on beside the statements; never stored twice):
  documents put <id> <file> --kind <audit|management|interim|annual|current-report|terms|other> --date <yyyy-mm-dd>
                [--title "…"] [--source <url>] [--dry-run]

Payments (what the company's own reports say: missed or late payments, changed terms, meetings, breaches; or paid):
  events list <id>                      the recorded events, the retracted ones too
  events put <id> --file event.json --document <file> [--dry-run]
                                        the document is one stored with documents put; the event's quote must stand in it
  events put <id> --file event.json     kind "reviewed" only: the current reports were read to a date, nothing else found
  events retract <id> <event id> --reason "…" [--dry-run]

Bond terms (read each listed bond's terms of issue before a judgement):
  bonds schedule <code> --file schedule.json --document <file> [--dry-run]
                                        its amortization schedule (instalments: [] when repaid at maturity in one go);
                                        the document is the terms, stored with documents put

Judgement:
  analysis put <id> --file judgement.md --meta meta.json [--dry-run] [--provisional]
                                        refused while a listed bond's terms or the last ${REPORTS_READ_WITHIN_DAYS} days of current reports
                                        are unread (entity <id> shows judgementGaps); --provisional stores it marked so

Other:
  schema <entity|name|analysis|figures|known|checklist|document|event|schedule|transcript>   an input as JSON Schema
  --version, --help`;

type Args = { positional: string[]; flags: Map<string, string | true> };
const VALUE_FLAGS = new Set(["--stage", "--by", "--entity", "--q", "--lei", "--krs", "--evidence", "--financials", "--file", "--meta", "--out", "--transcript", "--where", "--kind", "--date", "--title", "--source", "--document", "--reason"]);

function parse(args: string[]): Args {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (VALUE_FLAGS.has(a)) {
      const v = args[++i];
      if (v === undefined) throw new CliError(`${a} needs a value`);
      flags.set(a, v);
    } else if (a.startsWith("--")) flags.set(a, true);
    else positional.push(a);
  }
  return { positional, flags };
}

export function defaultIo(): Io {
  return {
    out: (s) => console.log(s),
    err: (s) => console.error(s),
    fetch: globalThis.fetch,
    env: process.env,
    secret: hiddenPrompt,
    clipboard: async () => readClipboard(),
    configDir: "",
  };
}

/** Runs one command; 0 on success, 1 on a refusal or an error (printed on stderr). */
export async function run(argv: string[], io: Io): Promise<number> {
  try {
    return await dispatch(parse(argv), io);
  } catch (err) {
    if (err instanceof CliError) {
      io.err(err.message);
      return 1;
    }
    if (err instanceof z.ZodError) {
      io.err(`not valid: ${err.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}`);
      return 1;
    }
    io.err(String((err as Error).stack ?? err));
    return 1;
  }
}

async function dispatch({ positional, flags }: Args, io: Io): Promise<number> {
  const [command, sub, ...rest] = positional;
  const flag = (name: string) => {
    const v = flags.get(name);
    return typeof v === "string" ? v : undefined;
  };
  const need = (name: string) => flag(name) ?? fail(`${name} is needed`);
  const stage = flag("--stage") ?? io.env["CATALYST_STAGE"] ?? "dev";
  const dryRun = flags.has("--dry-run");
  const json = (data: unknown) => io.out(JSON.stringify(data, null, 2));
  const print = (data: unknown) => {
    json(data);
    return 0;
  };
  const say = (text: string) => {
    io.out(text);
    return 0;
  };
  const client = () => new Client(io, stage, flag("--by") ?? io.env["CATALYST_BY"] ?? "agent");
  const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8")) as unknown;

  if (flags.has("--version") || command === "version") return say(VERSION);
  if (command === undefined || flags.has("--help") || command === "help") return say(HELP);

  switch (command) {
    case "where":
      json({ stage, api: apiUrl(stage), config: io.configDir });
      return 0;

    case "login": {
      apiUrl(stage);
      // From the clipboard ("Copy" in the token panel) where there's no terminal to type into, e.g. Claude Code's `!`.
      const token = (flags.has("--from-clipboard") ? await io.clipboard() : await io.secret(`Agent token for ${stage} (made in the Catalyst settings; not shown): `)).trim();
      if (!/^[A-Za-z0-9_-]{40,60}$/.test(token))
        throw new CliError(
          flags.has("--from-clipboard")
            ? `The clipboard doesn't hold an agent token (${token.length ? `${token.length} characters of something else` : "it's empty"}). Click Copy by the token in the app (or Replace, if it's no longer shown), copy nothing else, then type this command again.`
            : "That doesn't look like an agent token (43 characters)",
        );
      saveToken(io, stage, token);
      // Checked at once: a wrong or revoked token is found now, not mid-session.
      try {
        await client().get("/work");
      } catch (err) {
        forgetToken(io, stage);
        throw err instanceof ApiError && err.status === 401 ? new CliError(`${stage} refuses this token (revoked, or another stage's): not saved`) : err;
      }
      io.out(`Saved the agent token for ${stage} (…${token.slice(-4)}).`);
      return 0;
    }

    case "logout":
      io.out(forgetToken(io, stage) ? `Forgot the agent token for ${stage}.` : `No agent token for ${stage}.`);
      return 0;

    case "work": {
      const { items } = await client().get<{ items: WorkItem[] }>("/work");
      if (flags.has("--table")) io.out(table(["who", "kind", "company", "id", "what"], items.map((i) => [i.who, i.kind, i.name, i.entityId ?? "", i.detail])));
      else json(items);
      return 0;
    }

    case "bonds":
    case "bond": {
      if (command === "bonds" && sub === "schedule") {
        const code = rest[0] ?? fail("bonds schedule <code> --file schedule.json --document <file>");
        const c = client();
        const { rows } = await c.get<{ rows: BondRow[] }>("/bonds");
        const row = rows.find((r) => r.code === code.toUpperCase() || r.isin === code.toUpperCase()) ?? fail(`No listed bond ${code}`);
        const raw = readJson(need("--file")) as Record<string, unknown>;
        const file = need("--document");
        const data = readFileSync(file);
        // The passage is checked against the document's text; scanned terms can't be: pages with little more text than
        // a running header (under 200 characters; a typed page has thousands).
        const quote = typeof raw["quote"] === "string" ? raw["quote"] : fail("the schedule needs a quote: the passage of the terms that sets the redemption, as printed");
        const pages = isPdf(data) ? await readPdfPages(data) : [{ lines: [plainText(data.toString("utf8"))] }];
        const text = pages.flatMap((pg) => pg.lines).join(" ").replaceAll(" | ", " ");
        const scanned = isPdf(data) && pages.some((pg) => pg.lines.join("").trim().length < 200);
        if (!quoteIn(text, quote) && !scanned) throw new CliError(`The quote isn't in ${basename(file)}: copy the passage as printed (line breaks and hyphenation don't matter).`);
        if (!quoteIn(text, quote)) io.err(`Note: the quote couldn't be checked (${basename(file)} has scanned pages without text).`);
        const body = ScheduleInput.parse({ ...raw, documentSha: sha256Of(data), ...(dryRun ? { dryRun } : {}) });
        return print(await c.call("PUT", `/bonds/${enc(row.isin)}/schedule`, body));
      }
      const { date, rows } = await client().get<{ date: string; rows: BondRow[] }>("/bonds");
      // Figures the app derived, never obligacje.pl's text.
      const slim = rows.map(({ couponText: _c, ...r }) => r);
      if (command === "bond") {
        const code = sub ?? fail("bond <code>");
        const row = slim.find((r) => r.code === code.toUpperCase() || r.isin === code.toUpperCase());
        if (!row) throw new CliError(`No listed bond ${code}`);
        json({ date, ...row });
        return 0;
      }
      const entity = flag("--entity");
      const q = flag("--q")?.toLowerCase();
      const shown = slim.filter((r) => (!entity || r.entityId === entity) && (!q || [r.code, r.issuer, r.issuerShort, r.isin].some((x) => typeof x === "string" && x.toLowerCase().includes(q))));
      if (flags.has("--table")) io.out(table(["code", "company", "maturity", "net yield", "premium", "liquidity", "owed"], shown.map((r) => [r.code, r.issuerShort ?? r.issuer ?? "", r.maturity ?? "", pctText(r.yieldNet), pctText(r.premium), r.liquidity?.level ?? "", r.issueAmount ? String(Math.round(r.issueAmount)) : ""])));
      else json({ date, rows: shown });
      return 0;
    }

    case "entity": {
      if (sub === "set") {
        const id = rest[0] ?? fail("entity set <id> --file entity.json");
        const body = AgentEntityInput.parse(readJson(need("--file")));
        if (dryRun) return print({ dryRun: true, entityId: id, would: body });
        json(await client().call("PUT", `/entities/${enc(id)}`, body));
        return 0;
      }
      const id = sub ?? fail("entity <id>");
      const c = client();
      const detail = await c.get<{ years: { period: string }[] } & Record<string, unknown>>(`/entities/${enc(id)}`);
      if (flags.has("--lines")) {
        const lines = await Promise.all(detail.years.map((y) => c.get<{ lines: unknown[] }>(`/entities/${enc(id)}/years/${enc(y.period)}`).then((l) => [y.period, l.lines] as const)));
        json({ ...detail, lines: Object.fromEntries(lines) });
      } else json(detail);
      return 0;
    }

    case "identity": {
      if (sub === "resolve") return resolve(rest[0], flag("--lei"), flag("--krs"), io, client, json);
      if (sub === "set") {
        const name = rest[0] ?? fail('identity set "<listed name>" --entity <id> --evidence "…"');
        const entityId = flag("--entity");
        const lei = flag("--lei");
        if (!entityId && !lei) throw new CliError("--entity <id> or --lei <lei> is needed");
        const body = { ...(entityId ? { entityId } : {}), ...(lei ? { lei } : {}), evidence: need("--evidence") };
        AGENT_SCHEMAS.name.parse(body);
        const financials = flag("--financials");
        if (dryRun) return print({ dryRun: true, name, would: body, ...(financials ? { financialsOf: entityId, financialsEntityId: financials } : {}) });
        const c = client();
        const linked = await c.call<{ entityId: string; status: string }>("PUT", `/names/${enc(name)}`, body);
        if (financials) await c.call("PUT", `/entities/${enc(linked.entityId)}`, { financialsEntityId: financials });
        json(linked);
        return 0;
      }
      throw new CliError("identity resolve | identity set");
    }

    case "checklist": {
      const c = client();
      if (flags.has("--add") || flags.has("--set")) {
        const [id, year, scope, status] = [sub, ...rest];
        if (!id || !year || !scope) throw new CliError("checklist --add <id> <year> <group|single|any> [--where …]");
        const body = ChecklistInput.parse({ ...(flag("--where") ? { where: flag("--where") } : {}), ...(flags.has("--set") ? { status: status ?? fail("the new status") } : {}) });
        if (dryRun) return print({ dryRun: true, would: { id, year, scope, ...body } });
        json(await c.call("PUT", `/checklist/${enc(id)}/${enc(year)}/${enc(scope)}`, body));
        return 0;
      }
      const { checklist } = await c.get<{ checklist: { entityId: string; krs: string | null; year: number; scope: string; status: string; where: string }[] }>("/checklist");
      if (flags.has("--table")) io.out(table(["status", "company", "KRS", "year", "scope", "where"], checklist.map((x) => [x.status, x.entityId, x.krs ?? "", String(x.year), x.scope, x.where])));
      else json(checklist);
      return 0;
    }

    case "filings": {
      if (sub === "pages") {
        const file = rest[0] ?? fail("filings pages <pdf> [--out pages.txt]");
        const { statementPages, instructions } = await pdfStatementPages(readFileSync(file));
        const out = flag("--out");
        if (out) writeFileSync(out, instructions);
        json({ file: basename(file), statementPages, ...(out ? { written: out } : { instructions }) });
        return 0;
      }
      if (sub === "import") {
        const file = rest[0] ?? fail("filings import <file> --entity <id>");
        const entityId = need("--entity");
        const data = readFileSync(file);
        const transcript = flag("--transcript");
        const by = flag("--by") ?? io.env["CATALYST_BY"] ?? "agent";
        if (isPdf(data) && !transcript) throw new CliError("A PDF needs its transcript: catalyst filings pages, then --transcript t.json");
        // Read and checked here; a report that doesn't add up stops before anything is sent.
        const read = isPdf(data) ? await readPdfFiling(data, readJson(transcript!), by) : readFiling(data, basename(file));
        const summary = {
          format: read.filing.format,
          scope: read.filing.scope,
          companyName: read.filing.companyName,
          currency: read.filing.currency,
          standard: read.filing.standard,
          periods: read.filing.periods.map((p) => ({ periodEnd: p.periodEnd, months: p.months, lines: p.lines.length, figures: Object.fromEntries(Object.entries(p.figures).map(([k, v]) => [k, v?.value])) })),
          checks: read.filing.checks,
        };
        const c = client();
        const uploadKey = await c.upload(data, read.kind.contentType);
        const result = await c.call("POST", "/filings", { entityId, uploadKey, sha256: read.sha256, extension: read.kind.extension, fileName: basename(file), filing: read.filing, force: flags.has("--force"), dryRun });
        json({ read: summary, ...(result as object) });
        return 0;
      }
      throw new CliError("filings pages | filings import");
    }

    case "known":
    case "figures":
    case "analysis": {
      if (sub !== "put") throw new CliError(`${command} put <id> --file …`);
      const id = rest[0] ?? fail(`${command} put <id>`);
      const c = client();
      if (command === "known") {
        const body = KnownInput.parse(readJson(need("--file")));
        if (dryRun) return print({ dryRun: true, would: body });
        json(await c.call("POST", `/entities/${enc(id)}/known`, body));
        return 0;
      }
      if (command === "figures") {
        const body = CollectedFiguresInput.parse({ ...(readJson(need("--file")) as object), ...(dryRun ? { dryRun } : {}) });
        json(await c.call("POST", `/entities/${enc(id)}/figures`, body));
        return 0;
      }
      const body = AnalysisInput.parse({ markdown: readFileSync(need("--file"), "utf8"), meta: readJson(need("--meta")), ...(dryRun ? { dryRun } : {}), ...(flags.has("--provisional") ? { provisional: true } : {}) });
      json(await c.call("POST", `/entities/${enc(id)}/analyses`, body));
      return 0;
    }

    case "documents": {
      if (sub !== "put") throw new CliError("documents put <id> <file> --kind … --date …");
      const [id, file] = rest;
      if (!id || !file) throw new CliError("documents put <id> <file> --kind … --date …");
      const data = readFileSync(file);
      const fileName = basename(file);
      const sha256 = sha256Of(data);
      const meta = { fileName, sha256, kind: need("--kind"), date: need("--date"), title: flag("--title") ?? fileName, ...(flag("--source") ? { sourceUrl: flag("--source") } : {}) };
      // Checked here (no upload when it's refused), with a key for the shape only.
      AGENT_SCHEMAS.document.parse({ ...meta, uploadKey: "catalyst/uploads/00000000-0000-0000-0000-000000000000" });
      const c = client();
      const held = (await c.get<{ documents?: { sha256: string }[] }>(`/entities/${enc(id)}`)).documents?.find((d) => d.sha256 === sha256);
      if (held) return print({ duplicate: true, stored: false, ...held });
      if (dryRun) return print({ dryRun: true, would: { entityId: id, ...meta, size: data.length } });
      const contentType = fileName.toLowerCase().endsWith(".pdf") ? "application/pdf" : fileName.toLowerCase().endsWith(".zip") ? "application/zip" : "application/octet-stream";
      const uploadKey = await c.upload(data, contentType);
      return print(await c.call("POST", `/entities/${enc(id)}/documents`, { uploadKey, ...meta }));
    }

    case "events": {
      const id = rest[0] ?? fail("events list|put|retract <id>");
      const c = client();
      if (sub === "list") return print((await c.get<{ events?: unknown[] }>(`/entities/${enc(id)}`)).events ?? []);
      if (sub === "retract") {
        const eventId = rest[1] ?? fail("events retract <id> <event id> --reason …");
        return print(await c.call("POST", `/entities/${enc(id)}/events/${enc(eventId)}/retract`, RetractInput.parse({ reason: need("--reason"), ...(dryRun ? { dryRun } : {}) })));
      }
      if (sub !== "put") throw new CliError("events list <id> | events put <id> --file event.json --document <file> | events retract <id> <event id> --reason …");
      const raw = readJson(need("--file")) as Record<string, unknown>;
      const file = flag("--document");
      // The passage is checked here against the document's own text: an event whose quote isn't in it goes nowhere.
      let documentSha: string | undefined;
      if (file) {
        const data = readFileSync(file);
        documentSha = sha256Of(data);
        const text = isPdf(data) ? (await readPdfPages(data)).flatMap((pg) => pg.lines).join(" ").replaceAll(" | ", " ") : plainText(data.toString("utf8"));
        const quote = typeof raw["quote"] === "string" ? raw["quote"] : fail("the event needs a quote: the passage that says it, as printed");
        if (!quoteIn(text, quote)) throw new CliError(`The quote isn't in ${basename(file)}: copy the passage as printed (line breaks and hyphenation don't matter).`);
      } else if (raw["kind"] !== "reviewed") throw new CliError('--document <file> is needed: the stored document the quote is from (only kind "reviewed" goes without)');
      const body = PaymentEventInput.parse({ ...raw, ...(documentSha ? { documentSha } : {}), ...(dryRun ? { dryRun } : {}) });
      return print(await c.call("POST", `/entities/${enc(id)}/events`, body));
    }

    case "schema": {
      const kind = sub ?? fail("schema <kind>");
      if (kind === "transcript") return print(TRANSCRIPT_SCHEMA);
      const schema = AGENT_SCHEMAS[kind as keyof typeof AGENT_SCHEMAS];
      if (!schema) throw new CliError(`no schema "${kind}": ${[...Object.keys(AGENT_SCHEMAS), "transcript"].join(", ")}`);
      json(z.toJSONSchema(schema));
      return 0;
    }
  }
  throw new CliError(`unknown command "${command}"\n\n${HELP}`);
}

const fail = (message: string): never => {
  throw new CliError(message);
};

type BondRow = { isin: string; code: string; couponText?: string | null; issuer?: string | null; issuerShort?: string; entityId?: string; maturity: string | null; yieldNet: number | null; premium: number | null; liquidity?: { level: string }; issueAmount?: number | null } & Record<string, unknown>;

const pctText = (v: number | null | undefined) => (v === null || v === undefined ? "" : `${(v * 100).toFixed(2)}%`);

/** Rows as aligned columns. */
export function table(head: string[], rows: string[][]): string {
  const widths = head.map((h, i) => Math.min(60, Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length))));
  const line = (cells: string[]) => cells.map((c, i) => (c.length > widths[i]! ? `${c.slice(0, widths[i]! - 1)}…` : c.padEnd(widths[i]!))).join("  ").trimEnd();
  return [line(head), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)].join("\n");
}

/** GLEIF and the KRS register, asked from here at most once a second, with an honest user agent. */
function politeFetch(io: Io): Fetcher {
  let last = 0;
  return async (url) => {
    const wait = last + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    return io.fetch(url, { headers: { "user-agent": "portfolio-tracker catalyst CLI (personal use)", accept: "application/vnd.api+json, application/json" } });
  };
}

/** Candidates for a listed name (or an LEI, a KRS number) with the evidence, for the agent to weigh (§5). */
async function resolve(name: string | undefined, lei: string | undefined, krs: string | undefined, io: Io, client: () => Client, json: (d: unknown) => void): Promise<number> {
  const fetcher = politeFetch(io);
  const candidates = new Map<string, { record: LeiRecord; via: string[] }>();
  const add = (record: LeiRecord, via: string) => {
    const c = candidates.get(record.lei) ?? { record, via: [] };
    c.via.push(via);
    candidates.set(record.lei, c);
  };
  let listed: { code: string; isin: string }[] = [];
  let stored: unknown = null;
  if (lei) for (const r of (await leiRecords(fetcher, [lei])).values()) add(r, "the LEI given");
  if (name) {
    const c = client();
    const [{ rows }, { names }] = await Promise.all([c.get<{ rows: BondRow[] }>("/bonds"), c.get<{ names: { name: string }[] }>("/names")]);
    stored = names.find((n) => n.name === name) ?? null;
    listed = rows.filter((r) => r.issuer === name).map((r) => ({ code: r.code, isin: r.isin }));
    for (const [isin, r] of await leiByIsin(fetcher, listed.slice(0, 5).map((b) => b.isin))) add(r, `GLEIF's ISIN mapping (${listed.find((b) => b.isin === isin)?.code})`);
    const res = await fetcher(`https://api.gleif.org/api/v1/lei-records?filter%5Bfulltext%5D=${encodeURIComponent(name)}&page%5Bsize%5D=5`);
    if (res.ok) {
      const ids = ((await res.json()) as { data?: { id: string }[] }).data?.map((d) => d.id) ?? [];
      for (const r of (await leiRecords(fetcher, ids)).values()) add(r, "GLEIF full-text search");
    }
  }
  const out = [];
  for (const { record, via } of candidates.values()) {
    const polish = record.registeredAt === KRS_REGISTER && record.registeredAs && /^\d{10}$/.test(record.registeredAs) ? record.registeredAs : null;
    const extract = polish ? await krsExtract(fetcher, polish).catch(() => undefined) : undefined;
    out.push({ entityId: polish ?? `LEI:${record.lei}`, lei: record.lei, legalName: record.legalName, country: record.country, krs: polish, status: record.status, leiStatus: record.leiStatus, legalForm: extract?.legalForm ?? record.legalForm, pkd: extract?.pkd ?? null, liquidationOpen: extract?.register.liquidationOpen ?? null, sameNameAsListed: name ? sameName(name, record.legalName) : null, via });
  }
  if (krs && !out.some((o) => o.krs === krs)) {
    const extract = await krsExtract(fetcher, krs);
    out.push({ entityId: krs, lei: null, legalName: extract?.name ?? null, country: "PL", krs, status: null, leiStatus: null, legalForm: extract?.legalForm ?? null, pkd: extract?.pkd ?? null, liquidationOpen: extract?.register.liquidationOpen ?? null, sameNameAsListed: name && extract ? sameName(name, extract.name) : null, via: ["the KRS register (no LEI: link it with --lei once found)"] });
  }
  json({ name: name ?? null, stored, bonds: listed, candidates: out });
  return 0;
}

/** What `catalyst schema transcript` prints: the PDF transcript the agent writes (core/catalyst/filings/transcript.ts). */
const TRANSCRIPT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  description: "A PDF report's statements, copied (never computed): each line's label, page and amounts as printed per column",
  type: "object",
  required: ["companyName", "scope", "currency", "unit", "columns", "lines"],
  properties: {
    companyName: { type: "string" },
    scope: { enum: ["group", "single"] },
    currency: { type: "string", pattern: "^[A-Z]{3}$" },
    standard: { enum: ["ifrs", "pl-uor"] },
    unit: { enum: [1, 1000, 1000000], description: "the unit the amounts are printed in" },
    columns: { type: "array", items: { type: "object", required: ["id", "periodEnd"], properties: { id: { type: "string" }, periodStart: { type: "string" }, periodEnd: { type: "string" } } } },
    lines: {
      type: "array",
      items: {
        type: "object",
        required: ["statement", "page", "label", "field", "values"],
        properties: {
          statement: { enum: ["balance", "income", "cashFlow"] },
          page: { type: "integer" },
          label: { type: "string" },
          field: { type: "string", description: "the standard item (revenue, ebit, totalAssets …) or other" },
          values: { type: "array", items: { type: "object", required: ["column", "printed"], properties: { column: { type: "string" }, printed: { type: "string", description: "exactly as printed: \"1 792,2\", \"(4,523)\", \"-\"" } } } },
        },
      },
    },
  },
};

/** The clipboard's text, through the system's own tool; never printed. */
function readClipboard(): string {
  const [cmd, args] = process.platform === "win32" ? ["powershell", ["-NoProfile", "-Command", "Get-Clipboard"]] : process.platform === "darwin" ? ["pbpaste", []] : ["xclip", ["-selection", "clipboard", "-o"]];
  try {
    return execFileSync(cmd, args as string[], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    throw new CliError("Couldn't read the clipboard: run `npx catalyst login --stage <stage>` in a terminal and paste the token at the prompt");
  }
}

/** A prompt that doesn't echo what's typed (a token); stdin's first line when it isn't a terminal. */
function hiddenPrompt(question: string): Promise<string> {
  const stdin = process.stdin;
  process.stderr.write(question);
  return new Promise((resolve, reject) => {
    let value = "";
    if (!stdin.isTTY) {
      stdin.setEncoding("utf8");
      stdin.on("data", (d: string) => (value += d));
      stdin.on("end", () => resolve(value.split(/\r?\n/)[0] ?? ""));
      stdin.on("error", reject);
      return;
    }
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();
    const onData = (ch: string) => {
      for (const c of ch) {
        if (c === "\r" || c === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stderr.write("\n");
          return resolve(value);
        }
        if (c === "\u0003") {
          stdin.setRawMode(false);
          return reject(new CliError("cancelled"));
        }
        if (c === "\u007f" || c === "\b") value = value.slice(0, -1);
        else value += c;
      }
    };
    stdin.on("data", onData);
  });
}
