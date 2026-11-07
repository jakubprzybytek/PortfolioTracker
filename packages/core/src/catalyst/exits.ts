// GPW's suspensions and exclusions and Catalyst's special markings (Docs/catalyst.md, "Checked 2026-11-07"): why a
// bond stopped trading early or was suspended, and markings of an issuer's instruments (bankruptcy, restructuring …).
// The current page lists the measures in force, the archive everything since 2018, one page each; GPW's robots.txt
// allows both. Redemptions at maturity aren't listed: they come from the daily-file archive (trackRecord.ts).

import type { IsoDate } from "../dates.ts";
import type { CatalystEventItem, CatalystExitsNowItem, CatalystMarkingItem } from "./items.ts";

/** The trading systems of Catalyst on GPW's pages (the alternative system, the regulated one, BondSpot). */
export const CATALYST_MICS = ["WBON", "WMTF", "BOSP"] as const;

export type ExitAction = "suspension" | "lifting" | "exclusion" | "other";

/**
 * What a measure says about the issuer:
 * - `routine`: trading stops for a redemption or at the issuer's request;
 * - `data`: missing or wrong interest or nominal data for settlement (technical);
 * - `early-redemption`, `redemption`: the bond was redeemed (an exclusion's reason);
 * - `distress`: bankruptcy or liquidation, restructuring, the KNF's demand, the BFG;
 * - `attention`: "in the participants' interest and safety": often a short stop (a bondholders' meeting, a late
 *   report), sometimes the start of trouble;
 * - `other`: anything else.
 */
export type ExitSignal = "routine" | "data" | "early-redemption" | "redemption" | "distress" | "attention" | "other";

export interface GpwExitRow {
  /** When GPW published it, Warsaw time, "YYYY-MM-DDTHH:MM:SS". */
  published: string;
  action: ExitAction;
  /** The action as printed ("zawieszenie obrotu"). */
  actionText: string;
  reason: string;
  signal: ExitSignal;
  from: string | null;
  to: string | null;
  inForce: boolean;
  mics: string[];
  issuer: string;
  lei: string | null;
  /** One row can cover several instruments (a whole series of municipal bonds). */
  isins: string[];
  codes: string[];
  notes: string;
}

export interface CatalystMarking {
  issuer: string;
  /** "/8", "/1" … */
  marking: string;
}

const decode = (s: string) =>
  s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&oacute;/g, "ó")
    .replace(/\s+/g, " ")
    .trim();

const list = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

/** "2026-11-13 00:00:00" → "2026-11-13T00:00:00"; empty → null. */
function stamp(s: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}(?::\d{2})?))?$/.exec(s.trim());
  if (!m) return null;
  return m[2] ? `${m[1]}T${m[2].length === 5 ? `${m[2]}:00` : m[2]}` : `${m[1]}T00:00:00`;
}

function action(text: string): ExitAction {
  const t = text.toLowerCase();
  if (t.startsWith("zniesienie zawieszenia")) return "lifting";
  if (t.startsWith("zawieszenie")) return "suspension";
  if (t.startsWith("wycofanie") || t.startsWith("wykluczenie")) return "exclusion";
  return "other";
}

/** What a measure's reason says (ExitSignal); the reasons as GPW words them (checked 2026-11-07). */
export function exitSignal(act: ExitAction, reason: string): ExitSignal {
  // Lifting a suspension ends a measure: its reason is the suspension's.
  if (act === "lifting") return "routine";
  const r = reason.toLowerCase();
  if (/upadło|likwidac|na żądanie knf|na wniosek bfg|restruktury/.test(r)) return "distress";
  if (/interes i bezpieczeństwo/.test(r)) return "attention";
  if (/przedterminow/.test(r)) return "early-redemption";
  if (/wykup|umorzenie/.test(r)) return act === "exclusion" ? "redemption" : "routine";
  if (/odsetk|nominał/.test(r)) return "data";
  if (/na wniosek emitenta|ustanie przesłanki/.test(r)) return "routine";
  return "other";
}

/**
 * Parses GPW's suspensions and exclusions page (current or archive): the table `zawieszenia-i-wykluczenia`, one row
 * per measure. Throws when the table or its columns aren't where they were (the layout changed).
 */
export function parseGpwExits(html: string): GpwExitRow[] {
  const start = html.indexOf('<table class="table zawieszenia-i-wykluczenia"');
  if (start < 0) throw new Error("GPW exits: no table zawieszenia-i-wykluczenia (the layout changed?)");
  const table = html.slice(start, html.indexOf("</table>", start));
  const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((r) => [...r[1]!.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => decode(c[1]!)));
  const header = rows[0] ?? [];
  const col = (label: RegExp) => {
    const i = header.findIndex((h) => label.test(h));
    if (i < 0) throw new Error(`GPW exits: no column ${label} (the layout changed?)`);
    return i;
  };
  const c = {
    published: col(/^Data i godzina publikacji/i),
    action: col(/^Rodzaj działania/i),
    reason: col(/^Przyczyny/i),
    from: col(/^Obowiązuje od/i),
    to: col(/^Obowiązuje do/i),
    inForce: col(/^Obowiązuje$/i),
    mics: col(/^System\(y\) obrotu/i),
    issuer: col(/^Nazwa emitenta/i),
    lei: col(/^Emitent \(Kod LEI\)/i),
    isins: col(/^Identyfikator instrumentu/i),
    codes: col(/^Pełna nazwa instrumentu/i),
    notes: col(/^Uwagi/i),
  };
  const out: GpwExitRow[] = [];
  for (const r of rows.slice(1)) {
    if (r.length < header.length) continue;
    const published = stamp(r[c.published]!);
    if (!published) continue;
    const actionText = r[c.action]!;
    const act = action(actionText);
    const reason = r[c.reason]!.replace(/[,\s]+$/, "");
    const lei = r[c.lei]!;
    out.push({
      published,
      action: act,
      actionText,
      reason,
      signal: exitSignal(act, reason),
      from: stamp(r[c.from]!),
      to: stamp(r[c.to]!),
      inForce: /^tak$/i.test(r[c.inForce]!),
      mics: list(r[c.mics]!),
      issuer: r[c.issuer]!,
      // Rows without an LEI carry a placeholder of zeros and digits.
      lei: /^[A-Z0-9]{20}$/.test(lei) && !/^0{8}/.test(lei) ? lei : null,
      isins: list(r[c.isins]!),
      codes: list(r[c.codes]!),
      notes: r[c.notes]!,
    });
  }
  return out;
}

/** A measure on Catalyst (one of its trading systems). */
export const onCatalyst = (row: GpwExitRow) => row.mics.some((m) => (CATALYST_MICS as readonly string[]).includes(m));

/** Parses Catalyst's special markings page: issuer and marking per row (the current state only). */
export function parseCatalystMarkings(html: string): CatalystMarking[] {
  const out: CatalystMarking[] = [];
  for (const t of html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g)) {
    const rows = [...t[1]!.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((r) => [...r[1]!.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => decode(c[1]!)));
    const header = rows[0] ?? [];
    const issuer = header.findIndex((h) => /^Emitent$/i.test(h));
    const marking = header.findIndex((h) => /^Oznaczenie$/i.test(h));
    if (issuer < 0 || marking < 0) continue;
    for (const r of rows.slice(1)) if (r[issuer] && /^\/\d+/.test(r[marking] ?? "")) out.push({ issuer: r[issuer]!, marking: r[marking]! });
    return out;
  }
  throw new Error("Catalyst markings: no table with Emitent and Oznaczenie (the layout changed?)");
}

/** A company name for matching across sources: lower case, no legal form, no "w restrukturyzacji" and such. */
export function issuerKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(w (restrukturyzacji|likwidacji|upadłości))\b/g, " ")
    .replace(/\b(spółka akcyjna|spółka z ograniczoną odpowiedzialnością|spółka komandytowo-akcyjna|s\.a\.|sp\. z o\.o\.|s\.k\.a\.|sa|plc|n\.v\.|ab|se)(?=\s|$)/g, " ")
    .replace(/[^a-z0-9ąćęłńóśźż]+/g, " ")
    .trim();
}

export interface ExitsPlan {
  events: Omit<CatalystEventItem, "PK" | "SK">[];
  markings: Omit<CatalystMarkingItem, "PK" | "SK">[];
  now: Omit<CatalystExitsNowItem, "PK" | "SK">;
  /** Catalyst rows naming ISINs the table doesn't hold (bonds that ended before 2020). */
  unknownIsins: number;
}

/**
 * What a run stores: an event per Catalyst measure on a bond the table holds (the archive and the current page, the
 * current one winning for the same measure), the markings with their history, and what's in force now.
 */
export function planExits(
  rows: { current: GpwExitRow[]; archive: GpwExitRow[] },
  markings: CatalystMarking[],
  bonds: { isin: string; code: string }[],
  previous: Omit<CatalystMarkingItem, "PK" | "SK">[],
  today: IsoDate,
  fetchedAt: string,
): ExitsPlan {
  const codeBy = new Map(bonds.map((b) => [b.isin, b.code]));
  const events = new Map<string, Omit<CatalystEventItem, "PK" | "SK">>();
  const unknown = new Set<string>();
  for (const row of [...rows.archive, ...rows.current].filter(onCatalyst)) {
    for (const isin of row.isins) {
      const code = codeBy.get(isin);
      if (!code) {
        unknown.add(isin);
        continue;
      }
      const { published, action, reason, signal, from, to, inForce, issuer, lei } = row;
      events.set(`${isin}#${published}#${action}`, { isin, code, published, action, reason, signal, from, to, inForce, issuer, lei, source: "gpw-exits", fetchedAt });
    }
  }
  // In force now: the current page's suspensions not lifted.
  const suspended: CatalystExitsNowItem["suspended"] = {};
  for (const row of rows.current.filter((r) => onCatalyst(r) && r.inForce && r.action === "suspension"))
    for (const isin of row.isins) if (codeBy.has(isin)) suspended[isin] = { reason: row.reason, signal: row.signal, from: row.from };
  const seen = new Set(markings.map((m) => `${m.issuer}#${m.marking}`));
  const before = new Map(previous.map((m) => [`${m.issuer}#${m.marking}`, m]));
  const marks = [
    ...markings.map((m) => ({ ...m, firstSeen: before.get(`${m.issuer}#${m.marking}`)?.firstSeen ?? today, lastSeen: today, current: true })),
    ...previous.filter((m) => m.current && !seen.has(`${m.issuer}#${m.marking}`)).map((m) => ({ ...m, current: false })),
  ];
  return { events: [...events.values()], markings: marks, now: { suspended, marked: markings, fetchedAt }, unknownIsins: unknown.size };
}
