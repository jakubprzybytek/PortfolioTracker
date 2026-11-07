import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bondHistory, codePrefix, exitSignal, issuerKey, onCatalyst, parseCatalystMarkings, parseGpwExits, planExits, trackRecord, type TrackBond } from "../src/catalyst/index.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/catalyst/${name}`, import.meta.url), "utf8");

describe("GPW's suspensions and exclusions", () => {
  const current = parseGpwExits(fixture("gpw-exits-current.html"));
  const archive = parseGpwExits(fixture("gpw-exits-archive.html"));

  it("reads every row of the current page with its columns", () => {
    expect(current).toHaveLength(129);
    expect(current[0]).toMatchObject({
      published: "2026-11-06T17:06:04",
      action: "suspension",
      reason: "na wniosek emitenta",
      signal: "routine",
      from: "2026-11-13T00:00:00",
      to: "2026-11-26T00:00:00",
      inForce: true,
      mics: ["WBON"],
      issuer: "Gmina Podgórzyn",
      lei: "9845006EA6601B629406",
      isins: ["PLO276900035"],
      codes: ["PDG1128"],
    });
    expect(current.filter(onCatalyst).length).toBeGreaterThan(40);
  });

  it("splits a row naming a whole series and reads the archive's exclusions", () => {
    const ghelamco = archive.find((r) => r.codes.includes("GHE0128"))!;
    expect(ghelamco.codes).toEqual(["GHE0128", "GHE1027"]);
    expect(ghelamco.isins).toHaveLength(2);
    expect(ghelamco).toMatchObject({ action: "lifting", reason: "na żądanie KNF", signal: "routine" });
    expect(archive.find((r) => r.reason === "przedterminowy wykup obligacji")?.signal).toBe("early-redemption");
    expect(archive.some((r) => r.signal === "distress")).toBe(true);
  });

  it("drops the placeholder LEI of rows without one", () => {
    expect(current.find((r) => r.codes.includes("KDMSHIPNG"))?.lei).toBeNull();
  });

  it("refuses a page without the table", () => {
    expect(() => parseGpwExits("<html></html>")).toThrow("no table");
  });

  it("reads the reasons as signals", () => {
    expect(exitSignal("suspension", "na żądanie KNF")).toBe("distress");
    expect(exitSignal("suspension", "ze względu na interes i bezpieczeństwo uczestników obrotu")).toBe("attention");
    expect(exitSignal("exclusion", "upadłość (likwidacja)")).toBe("distress");
    expect(exitSignal("exclusion", "wykup/umorzenie instrumentu finansowego")).toBe("redemption");
    expect(exitSignal("suspension", "brak informacji o odsetkach na dzień rozliczenia")).toBe("data");
    expect(exitSignal("lifting", "ustanie przesłanki zawieszenia")).toBe("routine");
    expect(exitSignal("lifting", "na żądanie KNF")).toBe("routine");
  });
});

describe("Catalyst's special markings", () => {
  it("reads issuer and marking", () => {
    expect(parseCatalystMarkings(fixture("catalyst-markings.html"))).toEqual([{ issuer: "KANCELARIA MEDIUS S.A. W RESTRUKTURYZACJI", marking: "/8" }]);
  });

  it("matches names across sources without legal forms", () => {
    expect(issuerKey("KANCELARIA MEDIUS S.A. W RESTRUKTURYZACJI")).toBe(issuerKey("Kancelaria Medius S.A."));
    expect(issuerKey("Vantage Development Spółka Akcyjna")).toBe("vantage development");
  });
});

describe("planExits", () => {
  const current = parseGpwExits(fixture("gpw-exits-current.html"));
  const archive = parseGpwExits(fixture("gpw-exits-archive.html"));
  const bonds = [
    { isin: "PLO276900035", code: "PDG1128" },
    { isin: "PLVTGDL00184", code: "VAN0727" },
  ];

  it("stores the measures on known bonds, what's suspended now, and the markings' history", () => {
    const previous = [
      { issuer: "OLD S.A.", marking: "/1", firstSeen: "2026-01-02", lastSeen: "2026-11-06", current: true },
      { issuer: "KANCELARIA MEDIUS S.A. W RESTRUKTURYZACJI", marking: "/8", firstSeen: "2026-10-01", lastSeen: "2026-11-06", current: true },
    ];
    const plan = planExits({ current, archive }, [{ issuer: "KANCELARIA MEDIUS S.A. W RESTRUKTURYZACJI", marking: "/8" }], bonds, previous, "2026-11-07", "2026-11-07T09:00:00Z");
    expect(plan.events.map((e) => `${e.code} ${e.action}`).sort()).toEqual(["PDG1128 suspension", "VAN0727 exclusion", "VAN0727 suspension"]);
    expect(plan.events.find((e) => e.code === "VAN0727" && e.action === "exclusion")).toMatchObject({ action: "exclusion", reason: "na wniosek emitenta", lei: "259400EV3V1EI11FS544" });
    expect(Object.keys(plan.now.suspended)).toEqual(["PLO276900035"]);
    expect(plan.unknownIsins).toBeGreaterThan(10);
    expect(plan.markings).toEqual([
      { issuer: "KANCELARIA MEDIUS S.A. W RESTRUKTURYZACJI", marking: "/8", firstSeen: "2026-10-01", lastSeen: "2026-11-07", current: true },
      { issuer: "OLD S.A.", marking: "/1", firstSeen: "2026-01-02", lastSeen: "2026-11-06", current: false },
    ]);
  });
});

describe("track record", () => {
  const bond = (b: Partial<TrackBond>): TrackBond => ({ isin: "PLX", code: "ABC0126", maturity: "2026-01-20", status: "ended", firstSeen: "2020-01-02", lastSeen: "2026-01-12", lastClose: 100, events: [], ...b });
  const asOf = "2026-11-07";

  it("reads an end at maturity near par as repaid, inferred", () => {
    expect(bondHistory(bond({}), asOf)).toMatchObject({ outcome: "repaid", inferred: true, flags: [] });
  });

  it("reads an end long before maturity as early, and a GPW exclusion as stated", () => {
    expect(bondHistory(bond({ lastSeen: "2025-06-02" }), asOf)).toMatchObject({ outcome: "early", inferred: true });
    const excluded = bond({ lastSeen: "2025-06-02", events: [{ published: "2025-06-03T17:00:00", action: "exclusion", reason: "przedterminowy wykup obligacji", signal: "early-redemption" }] });
    expect(bondHistory(excluded, asOf)).toMatchObject({ outcome: "early", inferred: false });
  });

  it("flags an end below par, a bond past its maturity and distress measures", () => {
    expect(bondHistory(bond({ lastClose: 42.5, lastSeen: "2024-03-01" }), asOf)).toMatchObject({ outcome: "below-par", flags: ["ended below par (42.50 on 2024-03-01)"] });
    expect(bondHistory(bond({ status: "suspended", maturity: "2026-06-30" }), asOf)).toMatchObject({ outcome: "past-maturity" });
    const knf = bond({ status: "listed", maturity: "2028-01-01", events: [{ published: "2026-05-04T08:30:00", action: "suspension", reason: "na żądanie KNF", signal: "distress" }] });
    expect(bondHistory(knf, asOf)).toMatchObject({ outcome: "listed", flags: ["2026-05-04: suspension, na żądanie KNF"] });
  });

  it("keeps the participants'-interest suspensions apart from the red flags", () => {
    const b = bond({ status: "listed", maturity: "2028-01-01", events: [{ published: "2025-06-16T17:00:00", action: "suspension", reason: "ze względu na interes i bezpieczeństwo uczestników obrotu", signal: "attention" }] });
    expect(bondHistory(b, asOf)).toMatchObject({ flags: [], attention: ["2025-06-16: suspension, ze względu na interes i bezpieczeństwo uczestników obrotu"] });
    expect(trackRecord([b], asOf).attention).toHaveLength(1);
  });

  it("sums an issuer's bonds, newest maturity first, with the markings among the flags", () => {
    const r = trackRecord([bond({ code: "ABC0126" }), bond({ code: "ABC0128", status: "listed", maturity: "2028-01-01" }), bond({ code: "ABC0124", maturity: "2024-05-01", lastSeen: "2023-01-02" })], asOf, ["/8"]);
    expect(r.counts).toMatchObject({ repaid: 1, listed: 1, early: 1 });
    expect(r.bonds.map((b) => b.code)).toEqual(["ABC0128", "ABC0126", "ABC0124"]);
    expect(r.since).toBe("2020-01-02");
    expect(r.flags).toEqual(["GPW marking /8"]);
  });

  it("groups by the code's issuer prefix", () => {
    expect(codePrefix("KRU0228")).toBe("KRU");
    expect(codePrefix("PCR0827")).toBe("PCR");
  });
});
