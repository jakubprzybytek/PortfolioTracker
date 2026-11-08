// Linking bonds to companies (Docs/catalyst.md, "Issuers"; core/catalyst/identity.ts): for bonds without a link,
// GLEIF's ISIN mapping, else the issuer LEI on GPW's measures; the LEI records; the KRS extracts of new Polish
// companies. Run after the terms job (a few new bonds a day) and once for the backlog (scripts/catalyst-identity.ts).

import { bestShortName, KRS_REGISTER, krsExtract, leiByIsin, leiRecords, planFallbackLinks, planIdentity, type CatalystBondItem, type Fetcher, type KrsExtract } from "@portfolio/core/catalyst/index";
import { fetchSource } from "../lib/http.ts";
import { catalystRepo } from "./context.ts";

/** Segments whose issuers are companies (not the State or municipalities). */
const SEGMENTS: CatalystBondItem["segment"][] = ["corporate", "convertible", "cooperative", "bank", "mortgage-covered", "public-covered"];
/** A bond no source could link is asked again after this many days. */
const RETRY_DAYS = 30;
/** GLEIF allows 60 requests a minute; the KRS API asks for restraint too. */
const API_INTERVAL_MS = 1100;

/** Bonds looked up and saved together: a failure loses at most one chunk's work. */
const CHUNK = 50;

/** One request a second, retried on a rate limit or a server error (3 tries, 5 s and 15 s apart). */
const polite: Fetcher = async (url) => {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchSource(url, { minIntervalMs: API_INTERVAL_MS });
    if ((res.status !== 429 && res.status < 500) || attempt >= 2) return res;
    await res.body?.cancel();
    await new Promise((r) => setTimeout(r, attempt === 0 ? 5000 : 15000));
  }
};

/** Links up to `limit` bonds (listed ones first, newest first), saving every chunk. Returns what was written. */
export async function resolveIdentities(limit = Number.POSITIVE_INFINITY, fetcher: Fetcher = polite, { retryNow = false } = {}): Promise<{ itemsWritten: number; note: string }> {
  const [bonds, links, terms, entities, names] = await Promise.all([catalystRepo.listBonds(), catalystRepo.listLinks(), catalystRepo.listTerms(), catalystRepo.listEntities(), catalystRepo.listNames()]);
  const retryBefore = new Date(Date.now() - RETRY_DAYS * 86_400_000).toISOString();
  // Bonds no source could link are asked again a month later, or now (`retryNow`: a new source, e.g. GPW's measures).
  const linked = new Set(links.filter((l) => l.entityId || (!retryNow && l.at > retryBefore)).map((l) => l.isin));
  const segmentOf = new Map(bonds.map((b) => [b.isin, b.segment]));
  const waiting = bonds
    .filter((b) => SEGMENTS.includes(b.segment) && !linked.has(b.isin))
    .sort((a, b) => Number(a.status !== "listed") - Number(b.status !== "listed") || b.lastSeen.localeCompare(a.lastSeen));
  const todo = waiting.slice(0, limit);
  const listedName = new Map(terms.filter((t) => t.issuer).map((t) => [t.isin, t.issuer!]));
  const listedNow = new Set(bonds.filter((b) => b.status === "listed").map((b) => b.isin));
  const listedNames = new Set(terms.filter((t) => t.issuer && listedNow.has(t.isin) && SEGMENTS.includes(segmentOf.get(t.isin) ?? "other")).map((t) => t.issuer!));
  const known = new Map(entities.map(({ PK: _p, SK: _s, GSI1PK: _g, GSI1SK: _gs, ...e }) => [e.entityId, e]));
  const knownNames = new Map(names.map(({ PK: _p, SK: _s, GSI1PK: _g, GSI1SK: _gs, ...n }) => [n.name, n]));

  let written = 0;
  let linkedNow = 0;
  const unlinked: string[] = [];
  const krsFailed: string[] = [];
  for (let i = 0; i < Math.max(todo.length, 1); i += CHUNK) {
    const chunk = todo.slice(i, i + CHUNK);
    const byIsin = await leiByIsin(fetcher, chunk.map((b) => b.isin));
    // Bonds GLEIF doesn't map: the issuer LEI GPW gives on its measures (suspensions, exclusions).
    const exitsLei = new Map<string, string>();
    for (const b of chunk.filter((x) => !byIsin.has(x.isin))) {
      const lei = (await catalystRepo.listEvents(b.isin)).find((e) => e.lei)?.lei;
      if (lei) exitsLei.set(b.isin, lei);
    }
    const records = await leiRecords(fetcher, [...new Set(exitsLei.values())]);
    // KRS extracts of companies not seen before (or seen without one); one that fails is fetched again next time.
    const krsNumbers = new Set(
      [...byIsin.values(), ...records.values()]
        .filter((r) => r.registeredAt === KRS_REGISTER && r.registeredAs && /^\d{10}$/.test(r.registeredAs) && !known.get(r.registeredAs)?.pkd)
        .map((r) => r.registeredAs!),
    );
    const krs = new Map<string, KrsExtract>();
    for (const n of krsNumbers) {
      try {
        const extract = await krsExtract(fetcher, n);
        if (extract) krs.set(n, extract);
      } catch (err) {
        krsFailed.push(`${n} (${String((err as Error).message ?? err).slice(0, 60)})`);
      }
    }
    const plan = planIdentity({ bonds: chunk, listedName, byIsin, exitsLei, records, krs, entities: known, names: knownNames, listedNames, now: new Date().toISOString() });
    written += (await catalystRepo.putEntities(plan.entities)) + (await catalystRepo.putLinks(plan.links)) + (await catalystRepo.putNames(plan.names));
    for (const e of plan.entities) known.set(e.entityId, e);
    for (const n of plan.names) knownNames.set(n.name, n);
    linkedNow += plan.links.filter((l) => l.entityId).length;
    unlinked.push(...plan.unlinked);
  }
  // Bonds still without a company: through their listed name or, ended ones, their code prefix (no request).
  const nowLinks = await catalystRepo.listLinks();
  const withCompany = new Set(nowLinks.filter((l) => l.entityId).map((l) => l.isin));
  const fallback = planFallbackLinks(
    bonds.filter((b) => SEGMENTS.includes(b.segment) && !withCompany.has(b.isin)),
    listedName,
    knownNames,
    nowLinks,
    new Date().toISOString(),
  );
  written += await catalystRepo.putLinks(fallback);
  // Short names the code made, made again from what's known now (a short name you set is kept).
  const renamed = [...known.values()]
    .filter((e) => !e.shortNameSet)
    .map((e) => ({ e, name: bestShortName(e.legalName, [...knownNames.values()].filter((n) => n.entityId === e.entityId).map((n) => n.name)) }))
    .filter(({ e, name }) => name !== e.shortName)
    .map(({ e, name }) => ({ ...e, shortName: name, updatedAt: new Date().toISOString() }));
  written += await catalystRepo.putEntities(renamed);
  const all = [...knownNames.values()];
  return {
    itemsWritten: written,
    note: `identity: ${linkedNow} of ${todo.length} bonds linked (${waiting.length - todo.length} waiting), ${fallback.length} more through their listed name or code prefix; ${known.size} companies; names: ${all.filter((n) => n.status === "review").length} to review, ${all.filter((n) => n.status === "unresolved").length} unresolved${krsFailed.length ? `; KRS failed for ${krsFailed.slice(0, 3).join(", ")}${krsFailed.length > 3 ? ` and ${krsFailed.length - 3} more` : ""}` : ""}; not mapped: ${unlinked.slice(0, 8).join(", ")}${unlinked.length > 8 ? ` and ${unlinked.length - 8} more` : ""}`,
  };
}
