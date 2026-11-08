import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { entityIdOf, krsExtract, leiByIsin, leiRecords, planFallbackLinks, planIdentity, sameName, shortName, type Fetcher, type LeiRecord } from "../src/catalyst/index.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/catalyst/${name}`, import.meta.url), "utf8");
const vantageRecord = JSON.parse(fixture("gleif-259400EV3V1EI11FS544.json")).data;

/** A fake GLEIF and KRS: Vantage's record for its ISIN and LEI, nothing for anything else. */
const fetcher: Fetcher = async (url) => {
  if (url.includes("api-krs.ms.gov.pl")) return url.includes("0000030117") ? new Response(fixture("krs-0000030117.json")) : new Response("", { status: 404 });
  const known = url.includes("PLVTGDL00184") || url.includes("259400EV3V1EI11FS544");
  return new Response(JSON.stringify({ data: known ? [vantageRecord] : [] }));
};

describe("identity sources", () => {
  it("maps an ISIN to its issuer's LEI record (GLEIF)", async () => {
    const byIsin = await leiByIsin(fetcher, ["PLVTGDL00184", "PLXXXXXXXXX0"]);
    expect([...byIsin.keys()]).toEqual(["PLVTGDL00184"]);
    expect(byIsin.get("PLVTGDL00184")).toEqual({
      lei: "259400EV3V1EI11FS544",
      legalName: "VANTAGE DEVELOPMENT SPÓŁKA AKCYJNA",
      registeredAt: "RA000484",
      registeredAs: "0000030117",
      country: "PL",
      legalForm: "FJ0E",
      status: "ACTIVE",
      leiStatus: "ISSUED",
    });
    expect((await leiRecords(fetcher, ["259400EV3V1EI11FS544"])).get("259400EV3V1EI11FS544")?.registeredAs).toBe("0000030117");
  });

  it("reads a KRS extract: name, legal form, main business, section 6", async () => {
    expect(await krsExtract(fetcher, "0000030117")).toEqual({
      krs: "0000030117",
      name: "VANTAGE DEVELOPMENT SPÓŁKA AKCYJNA",
      legalForm: "SPÓŁKA AKCYJNA",
      pkd: "REALIZACJA PROJEKTÓW BUDOWLANYCH ZWIĄZANYCH ZE WZNOSZENIEM BUDYNKÓW MIESZKALNYCH",
      // A liquidation opened in 2001 and lifted in 2006: history, not open.
      register: { liquidationOpen: false, entries: ["likwidacja", "rozwiazanieUniewaznienie", "polaczeniePodzialPrzeksztalcenie"] },
    });
    expect(await krsExtract(fetcher, "0000000001")).toBeUndefined();
  });

  it("uses the KRS number as the id of a company in the Polish register, else the LEI", () => {
    const r: LeiRecord = { lei: "L", legalName: "X", registeredAt: "RA000484", registeredAs: "0000030117", country: "PL", legalForm: null, status: null, leiStatus: null };
    expect(entityIdOf(r)).toBe("0000030117");
    expect(entityIdOf({ ...r, registeredAt: "RA000463", registeredAs: "B123" })).toBe("LEI:L");
  });

  it("shortens names to show", () => {
    expect(shortName("VANTAGE DEVELOPMENT SPÓŁKA AKCYJNA")).toBe("Vantage Development");
    expect(shortName("Kruk S.A.")).toBe("Kruk");
    expect(shortName("PragmaGO S.A.")).toBe("PragmaGO");
    expect(shortName("Ghelamco Invest Sp. z o.o.")).toBe("Ghelamco Invest");
    expect(sameName("Kruk S.A.", "KRUK SPÓŁKA AKCYJNA")).toBe(true);
    expect(sameName("PEU (FIN) PLC", "Pepco Group N.V.")).toBe(false);
  });
});

describe("planIdentity", () => {
  const vantage: LeiRecord = { lei: "259400EV3V1EI11FS544", legalName: "VANTAGE DEVELOPMENT SPÓŁKA AKCYJNA", registeredAt: "RA000484", registeredAs: "0000030117", country: "PL", legalForm: "FJ0E", status: "ACTIVE", leiStatus: "ISSUED" };
  const base = {
    listedName: new Map([
      ["PLVTGDL00184", "Vantage Development S.A."],
      ["PLVTGDL00200", "Vantage Development S.A."],
      ["PLOTHER00001", "Other Sp. z o.o."],
    ]),
    byIsin: new Map([["PLVTGDL00184", vantage]]),
    exitsLei: new Map([["PLVTGDL00200", "259400EV3V1EI11FS544"]]),
    records: new Map([["259400EV3V1EI11FS544", vantage]]),
    krs: new Map(),
    entities: new Map(),
    names: new Map(),
    listedNames: new Set(["Vantage Development S.A.", "Other Sp. z o.o."]),
    now: "2026-11-08T00:00:00Z",
  };

  it("links bonds through GLEIF or GPW's LEI, makes the company once, points the name at it", () => {
    const plan = planIdentity({
      ...base,
      bonds: [
        { isin: "PLVTGDL00184", code: "VAN0727" },
        { isin: "PLVTGDL00200", code: "VAN0329" },
        { isin: "PLOTHER00001", code: "OTH0128" },
      ],
    });
    expect(plan.links.map((l) => [l.code, l.entityId, l.via])).toEqual([
      ["VAN0727", "0000030117", "gleif-isin"],
      ["VAN0329", "0000030117", "gpw-exits"],
      ["OTH0128", null, "none"],
    ]);
    expect(plan.entities).toHaveLength(1);
    expect(plan.entities[0]).toMatchObject({ entityId: "0000030117", shortName: "Vantage Development", krs: "0000030117", lei: "259400EV3V1EI11FS544" });
    expect(plan.entities[0]!.aiAnalysis).toBeUndefined();
    expect(plan.names.find((n) => n.name === "Vantage Development S.A.")).toMatchObject({ entityId: "0000030117", status: "resolved" });
    expect(plan.names.find((n) => n.name === "Other Sp. z o.o.")).toMatchObject({ entityId: null, status: "unresolved" });
    expect(plan.unlinked).toEqual(["OTH0128"]);
  });

  it("keeps what you set on a company, and passes a name's AI switch to its company", () => {
    const entities = new Map([["0000030117", { entityId: "0000030117", shortName: "Vantage", legalName: "x", country: "PL", krs: "0000030117", lei: vantage.lei, leiStatus: null, status: null, legalForm: null, createdAt: "2026-01-01", updatedAt: "2026-01-01" }]]);
    const names = new Map([["Vantage Development S.A.", { name: "Vantage Development S.A.", entityId: null, status: "unresolved" as const, evidence: "", aiAnalysis: { on: true, by: "me", at: "2026-11-01" }, updatedAt: "2026-11-01" }]]);
    const plan = planIdentity({ ...base, entities, names, bonds: [{ isin: "PLVTGDL00184", code: "VAN0727" }] });
    expect(plan.entities[0]).toMatchObject({ shortName: "Vantage", createdAt: "2026-01-01", aiAnalysis: { on: true, by: "me" } });
  });

  it("marks a name for review when the legal name differs", () => {
    const plan = planIdentity({ ...base, listedName: new Map([["PLVTGDL00184", "VTG Finance"]]), bonds: [{ isin: "PLVTGDL00184", code: "VAN0727" }], listedNames: new Set() });
    expect(plan.names[0]).toMatchObject({ name: "VTG Finance", status: "review" });
  });
});

describe("names and fallback links", () => {
  it("drops quotes, keeps acronyms, ignores diacritics", () => {
    expect(shortName('"ARCTIC PAPER" SPÓŁKA AKCYJNA')).toBe("Arctic Paper");
    expect(shortName('"FAST FINANCE SPÓŁKA AKCYJNA"')).toBe("Fast Finance");
    expect(shortName("AB SPÓŁKA AKCYJNA")).toBe("AB");
    expect(shortName("7R SPÓŁKA AKCYJNA")).toBe("7R");
    expect(sameName("Żabka Group", "Zabka Group")).toBe(true);
  });

  it("links a bond through its listed name, and an ended bond through a prefix only one company has", () => {
    const links = planFallbackLinks(
      [
        { isin: "PLORL1", code: "ORL0730", status: "listed" },
        { isin: "PLGHE1", code: "GHE0420", status: "ended" },
        { isin: "PLXYZ1", code: "XYZ0420", status: "ended" },
        { isin: "PLABC1", code: "ABC0420", status: "listed" },
      ],
      new Map([["PLORL1", "Orlen S.A."]]),
      new Map([["Orlen S.A.", { entityId: "0000028860" }]]),
      [
        { code: "GHE0128", entityId: "0000137399" },
        { code: "XYZ0128", entityId: "0000000001" },
        { code: "XYZ0228", entityId: "0000000002" },
        { code: "ABC0128", entityId: "0000000003" },
      ],
      "2026-11-08T00:00:00Z",
    );
    // XYZ: two companies share the prefix; ABC0420: listed, so its own name decides, not the prefix.
    expect(links.map((l) => [l.code, l.entityId, l.via])).toEqual([
      ["ORL0730", "0000028860", "listed-name"],
      ["GHE0420", "0000137399", "code-prefix"],
    ]);
  });
});

describe("short names with several legal forms", () => {
  it("strips them all", () => {
    expect(shortName("OLIVIA FIN SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ SPÓŁKA KOMANDYTOWO-AKCYJNA")).toBe("Olivia FIN");
    expect(shortName("Olivia Fin Sp. z o.o. SKA")).toBe("Olivia Fin");
    expect(shortName("OKAM INCITY SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ")).toBe("Okam Incity");
  });
});
