// Who issued a bond (Docs/catalyst.md, "Issuers"; phase 2, N2): bonds are joined to companies through identity,
// never by matching names. The bond's ISIN → its issuer's LEI (GLEIF's ISIN mapping, or the LEI on GPW's measures),
// the LEI record → the company (legal name, KRS number, legal form, status), the KRS extract → its business and
// register entries. The company id is the KRS number for a company in the Polish register, else `LEI:<lei>`.
// Clients take a fetch function: the job passes its polite one, the CLI its own.

import { issuerKey } from "./exits.ts";
import type { CatalystEntityItem, CatalystLinkItem, CatalystNameItem } from "./items.ts";

/** GLEIF's id of the Polish National Court Register (KRS) among business registers. */
export const KRS_REGISTER = "RA000484";

export interface LeiRecord {
  lei: string;
  legalName: string;
  /** The register's id ("RA000484" = KRS) and the company's number in it. */
  registeredAt: string | null;
  registeredAs: string | null;
  country: string | null;
  legalForm: string | null;
  /** ACTIVE / INACTIVE (the entity). */
  status: string | null;
  /** ISSUED / LAPSED / … (the LEI's registration). */
  leiStatus: string | null;
}

export interface KrsExtract {
  krs: string;
  name: string;
  legalForm: string | null;
  /** The main business activity (PKD) as described. */
  pkd: string | null;
  /**
   * The register's section 6: a liquidation opened and not ended (`liquidationOpen`), and which kinds of entries it
   * holds at all (history: a liquidation lifted years ago stays there).
   */
  register: KrsRegister;
}

export interface KrsRegister {
  liquidationOpen: boolean;
  /** "likwidacja", "rozwiazanieUniewaznienie", "polaczeniePodzialPrzeksztalcenie" … when present. */
  entries: string[];
}

export type Fetcher = (url: string) => Promise<Response>;

const GLEIF = "https://api.gleif.org/api/v1/lei-records";
/** LEIs asked for in one GLEIF request. */
export const GLEIF_BATCH = 25;

interface GleifRecord {
  id: string;
  attributes: {
    entity: { legalName: { name: string }; registeredAt?: { id?: string }; registeredAs?: string | null; legalAddress?: { country?: string }; legalForm?: { id?: string }; status?: string };
    registration?: { status?: string };
  };
}

function leiRecord(r: GleifRecord): LeiRecord {
  const e = r.attributes.entity;
  return {
    lei: r.id,
    legalName: e.legalName.name,
    registeredAt: e.registeredAt?.id ?? null,
    registeredAs: e.registeredAs ?? null,
    country: e.legalAddress?.country ?? null,
    legalForm: e.legalForm?.id ?? null,
    status: e.status ?? null,
    leiStatus: r.attributes.registration?.status ?? null,
  };
}

async function gleif(fetcher: Fetcher, filter: "isin" | "lei", values: string[]): Promise<GleifRecord[]> {
  const res = await fetcher(`${GLEIF}?filter%5B${filter}%5D=${values.map(encodeURIComponent).join(",")}&page%5Bsize%5D=100`);
  if (!res.ok) throw new Error(`GLEIF ${filter}: HTTP ${res.status}`);
  return ((await res.json()) as { data?: GleifRecord[] }).data ?? [];
}

/**
 * The issuers' LEI records of `isins` (GLEIF's ISIN mapping), by ISIN. One ISIN per request: a batch's answer doesn't
 * say which record is which ISIN's. ISINs GLEIF doesn't know are left out.
 */
export async function leiByIsin(fetcher: Fetcher, isins: string[]): Promise<Map<string, LeiRecord>> {
  const out = new Map<string, LeiRecord>();
  for (const isin of isins) {
    const [record] = await gleif(fetcher, "isin", [isin]);
    if (record) out.set(isin, leiRecord(record));
  }
  return out;
}

/** LEI records by LEI. */
export async function leiRecords(fetcher: Fetcher, leis: string[]): Promise<Map<string, LeiRecord>> {
  const out = new Map<string, LeiRecord>();
  for (let i = 0; i < leis.length; i += GLEIF_BATCH) for (const r of await gleif(fetcher, "lei", leis.slice(i, i + GLEIF_BATCH))) out.set(r.id, leiRecord(r));
  return out;
}

/** The current extract of a company in the KRS register (business register "P"); undefined when it's not there. */
export async function krsExtract(fetcher: Fetcher, krs: string): Promise<KrsExtract | undefined> {
  const res = await fetcher(`https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/${krs}?rejestr=P&format=json`);
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`KRS ${krs}: HTTP ${res.status}`);
  const odpis = ((await res.json()) as { odpis?: { dane?: Record<string, Record<string, unknown>> } }).odpis;
  const dane = odpis?.dane ?? {};
  const podmiot = (dane["dzial1"]?.["danePodmiotu"] ?? {}) as { nazwa?: string; formaPrawna?: string };
  const pkd = ((dane["dzial3"]?.["przedmiotDzialalnosci"] as { przedmiotPrzewazajacejDzialalnosci?: { opis?: string }[] } | undefined)?.przedmiotPrzewazajacejDzialalnosci ?? [])[0]?.opis ?? null;
  const d6 = dane["dzial6"] ?? {};
  const present = (v: unknown) => (Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && Object.keys(v as object).length > 0);
  const liquidations = (Array.isArray(d6["likwidacja"]) ? d6["likwidacja"] : d6["likwidacja"] ? [d6["likwidacja"]] : []) as { otwarcieLikwidacji?: string; zakonczenieLikwidacji?: string }[];
  return {
    krs,
    name: podmiot.nazwa ?? "",
    legalForm: podmiot.formaPrawna ?? null,
    pkd,
    register: { liquidationOpen: liquidations.some((l) => l.otwarcieLikwidacji && !l.zakonczenieLikwidacji), entries: Object.keys(d6).filter((k) => present(d6[k])) },
  };
}

/** The company id: the KRS number for a company in the Polish register, else `LEI:<lei>`. */
export function entityIdOf(r: LeiRecord): string {
  return r.registeredAt === KRS_REGISTER && r.registeredAs && /^\d{10}$/.test(r.registeredAs) ? r.registeredAs : `LEI:${r.lei}`;
}

const LOWER = new Set(["i", "w", "z", "na", "do", "of", "and", "the", "de"]);

/** A short name to show: the listed or legal name without its legal form ("KRUK SPÓŁKA AKCYJNA" → "Kruk"). */
export function shortName(name: string): string {
  let stripped = name
    .replace(/["„”]/g, "")
    .replace(/\b(w (restrukturyzacji|likwidacji|upadłości))\b.*$/i, "")
    .trim();
  // Legal forms at the end, as often as they come ("… Sp. z o.o. Spółka komandytowo-akcyjna").
  // A form is stripped only when a name is left ("AB SPÓŁKA AKCYJNA" is "AB", not the Swedish legal form).
  for (let before = ""; before !== stripped; ) {
    before = stripped;
    const next = stripped
      .replace(/\s*(spółka akcyjna|spółka z ograniczoną odpowiedzialnością|spółka komandytowo-akcyjna|spółka komandytowa|s\.\s?a\.?|sp\. z o\.\s?o\.?|s\.k\.a\.?|sp\.\s?k\.?|\bska\b|\bsa\b|\bplc\b|\bn\.v\.|\bnv\b|\bse\b|\bab\b)\s*$/iu, "")
      .replace(/[\s,.-]+$/, "")
      .trim();
    if (next) stripped = next;
  }
  const words = stripped.split(/\s+/);
  // Names written in capitals get title case; mixed-case names are kept as written ("PragmaGO", "mBank").
  if (stripped !== stripped.toUpperCase()) return stripped;
  // Short words in capitals are acronyms (AB, PKO, 7R) and stay so; longer ones get title case.
  return words.map((w, i) => (i > 0 && LOWER.has(w.toLowerCase()) ? w.toLowerCase() : w.length <= 3 && /^[A-Z0-9]+$/.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase())).join(" ");
}

/**
 * The short name the code would give a company: from a listed name pointing at it that agrees with the legal name
 * (they read better: "Kruk" from "Kruk S.A."), else from the legal name.
 */
export function bestShortName(legalName: string, listedNames: string[]): string {
  const agreeing = listedNames.filter((n) => sameName(n, legalName)).sort();
  return shortName(agreeing[0] ?? legalName);
}

/** Whether a listed name and a legal name are the same company's name (beyond legal forms, case and punctuation). */
export const sameName = (a: string, b: string) => issuerKey(a) === issuerKey(b);

type Entity = Omit<CatalystEntityItem, "PK" | "SK" | "GSI1PK" | "GSI1SK">;
type Name = Omit<CatalystNameItem, "PK" | "SK" | "GSI1PK" | "GSI1SK">;
type Link = Omit<CatalystLinkItem, "PK" | "SK" | "GSI1PK" | "GSI1SK">;

export interface IdentityInput {
  /** Bonds to link (in scope, no link yet). */
  bonds: { isin: string; code: string }[];
  /** The issuer name as listed (obligacje.pl), by ISIN. */
  listedName: Map<string, string>;
  /** GLEIF's ISIN mapping, by ISIN. */
  byIsin: Map<string, LeiRecord>;
  /** The issuer LEI on GPW's measures, by ISIN (for bonds GLEIF doesn't map). */
  exitsLei: Map<string, string>;
  /** LEI records of the LEIs from GPW's measures. */
  records: Map<string, LeiRecord>;
  /** KRS extracts, by KRS number. */
  krs: Map<string, KrsExtract>;
  entities: Map<string, Entity>;
  names: Map<string, Name>;
  /** Every issuer name listed now (unlinked ones become `unresolved`). */
  listedNames: Set<string>;
  now: string;
}

export interface IdentityPlan {
  links: Link[];
  entities: Entity[];
  names: Name[];
  /** Bonds left without a link (GLEIF doesn't map them and GPW's measures don't name their issuer). */
  unlinked: string[];
}

/** Links bonds to companies, creates or refreshes the companies, and points the listed names at them. */
export function planIdentity(input: IdentityInput): IdentityPlan {
  const { now } = input;
  const entities = new Map<string, Entity>();
  const names = new Map<string, Name>();
  const links: Link[] = [];
  const unlinked: string[] = [];
  const entityOf = (record: LeiRecord, listed: string | undefined): Entity => {
    const id = entityIdOf(record);
    const before = entities.get(id) ?? input.entities.get(id);
    const krs = id === record.registeredAs ? id : null;
    const extract = krs ? input.krs.get(krs) : undefined;
    const e: Entity = {
      ...before,
      entityId: id,
      // The listed name reads better ("Kruk" from "Kruk S.A."): it replaces one made from the legal name, never one you set.
      shortName: listed && sameName(listed, record.legalName) && (!before || before.shortName === shortName(record.legalName)) ? shortName(listed) : (before?.shortName ?? shortName(record.legalName)),
      legalName: record.legalName,
      country: record.country,
      krs,
      lei: record.lei,
      leiStatus: record.leiStatus,
      status: record.status,
      legalForm: extract?.legalForm ?? before?.legalForm ?? record.legalForm,
      ...(extract ? { pkd: extract.pkd, register: extract.register } : {}),
      createdAt: before?.createdAt ?? now,
      updatedAt: now,
    };
    entities.set(id, e);
    return e;
  };
  for (const bond of input.bonds) {
    const listed = input.listedName.get(bond.isin);
    const viaIsin = input.byIsin.get(bond.isin);
    const exitsLei = input.exitsLei.get(bond.isin);
    const record = viaIsin ?? (exitsLei ? input.records.get(exitsLei) : undefined);
    if (!record) {
      unlinked.push(bond.code);
      links.push({ isin: bond.isin, code: bond.code, entityId: null, lei: null, via: "none", at: now });
      continue;
    }
    const entity = entityOf(record, listed);
    links.push({ isin: bond.isin, code: bond.code, entityId: entity.entityId, lei: record.lei, via: viaIsin ? "gleif-isin" : "gpw-exits", at: now });
    if (!listed) continue;
    const before = names.get(listed) ?? input.names.get(listed);
    if (before?.entityId && before.entityId !== entity.entityId) continue; // linked elsewhere: left for review by hand
    if (before?.entityId === entity.entityId && before.status !== "unresolved") continue;
    const agrees = sameName(listed, record.legalName);
    names.set(listed, {
      ...before,
      name: listed,
      entityId: entity.entityId,
      status: agrees ? "resolved" : "review",
      evidence: `${viaIsin ? "GLEIF's ISIN mapping" : "the issuer LEI on GPW's measures"} (${bond.code}, ${bond.isin}) → LEI ${record.lei}, ${record.legalName}${agrees ? "" : ": the legal name differs from the listed one"}`,
      updatedAt: now,
    });
    // A switch set on the name before it was linked passes to the company.
    if (before?.aiAnalysis && !entity.aiAnalysis) entities.set(entity.entityId, { ...entity, aiAnalysis: before.aiAnalysis });
  }
  for (const listed of input.listedNames)
    if (!input.names.has(listed) && !names.has(listed)) names.set(listed, { name: listed, entityId: null, status: "unresolved", evidence: "no bond of this name is mapped to an LEI yet", updatedAt: now });
  return { links, entities: [...entities.values()], names: [...names.values()], unlinked };
}

/**
 * Links for bonds no source maps, from what's known already (no request):
 * - `listed-name`: the bond's listed name (obligacje.pl) points at a company through another bond of that name that
 *   GLEIF or GPW linked (Orlen's bonds GLEIF doesn't map, beside those it does);
 * - `code-prefix`: an ended bond (no listed name: obligacje.pl doesn't show ended bonds) whose code's leading letters
 *   belong to exactly one company among the linked bonds (inferred: GPW assigns an issuer its prefix).
 */
export function planFallbackLinks(
  bonds: { isin: string; code: string; status: string }[],
  listedName: Map<string, string>,
  names: Map<string, { entityId: string | null }>,
  linked: { code: string; entityId: string | null }[],
  now: string,
): Link[] {
  const prefix = (code: string) => /^[A-Z]+/.exec(code)?.[0] ?? code;
  const byPrefix = new Map<string, Set<string>>();
  for (const l of linked) if (l.entityId) byPrefix.set(prefix(l.code), (byPrefix.get(prefix(l.code)) ?? new Set()).add(l.entityId));
  const out: Link[] = [];
  for (const b of bonds) {
    const name = listedName.get(b.isin);
    const viaName = name ? names.get(name)?.entityId : null;
    if (viaName) {
      out.push({ isin: b.isin, code: b.code, entityId: viaName, lei: null, via: "listed-name", at: now });
      continue;
    }
    const companies = byPrefix.get(prefix(b.code));
    if (b.status === "ended" && companies?.size === 1) out.push({ isin: b.isin, code: b.code, entityId: [...companies][0]!, lei: null, via: "code-prefix", at: now });
  }
  return out;
}
