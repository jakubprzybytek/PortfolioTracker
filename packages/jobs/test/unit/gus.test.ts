import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeCpiCsv, findCpiCsvLink, parseCpiCsv, parseCpiYoyCsv, parseCpiYtdCsv } from "../../src/lib/gus.ts";

describe("findCpiCsvLink", () => {
  it("finds the monthly CPI CSV on the GUS page", () => {
    const html = `
      <a href="/download/gfx/portalinformacyjny/pl/defaultstronaopisowa/4741/1/1/inny_plik.xlsx">XLSX</a>
      <a onClick="ga('send', 'event', 'Pobranie CSV', 'Click', 'Miesięczne wskaźniki cen towarów i usług konsumpcyjnych od 1982 r. Tablica w formacie CSV');" href="/download/gfx/portalinformacyjny/pl/defaultstronaopisowa/4741/1/1/miesiecznewskaznikicentowarowiuslugkonsumpcyjnychod1982roku_8.csv" title="Miesięczne wskaźniki cen towarów i usług konsumpcyjnych od 1982 r. Tablica w formacie CSV">
        Miesięczne wskaźniki cen towarów i usług konsumpcyjnych od 1982 r. Tablica w formacie CSV</a>`;
    expect(findCpiCsvLink(html)).toBe("/download/gfx/portalinformacyjny/pl/defaultstronaopisowa/4741/1/1/miesiecznewskaznikicentowarowiuslugkonsumpcyjnychod1982roku_8.csv");
    expect(findCpiCsvLink("<a href='/x'>nothing</a>")).toBeUndefined();
  });
});

describe("parseCpiCsv", () => {
  // An excerpt of the real file (2025-12 … 2026-12, all five bases), as downloaded: Windows-1250.
  const rows = parseCpiCsv(decodeCpiCsv(readFileSync(new URL("../fixtures/gus-cpi-excerpt.csv", import.meta.url))));

  it("reads the previous-month = 100 rows as fractions, oldest first", () => {
    expect(rows.map((r) => r.month)).toEqual(["2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]);
    // Same values as the MF calculator (WR_k), except January: MF keeps GUS's preliminary 0.006.
    expect(rows.find((r) => r.month === "2026-06")!.wr).toBe(-0.005);
    expect(rows.find((r) => r.month === "2026-07")!.wr).toBe(0.008);
    expect(rows.find((r) => r.month === "2026-08")!.wr).toBe(0.003);
    expect(rows.find((r) => r.month === "2026-01")!.wr).toBe(0.007);
  });

  it("skips months GUS hasn't published yet (empty value)", () => {
    expect(rows.some((r) => r.month === "2026-09")).toBe(false);
  });
});

describe("parseCpiYtdCsv", () => {
  const rows = parseCpiYtdCsv(decodeCpiCsv(readFileSync(new URL("../fixtures/gus-cpi-excerpt.csv", import.meta.url))));

  it("reads the December of the previous year = 100 rows as GUS has them, oldest first", () => {
    expect(rows[0]).toEqual({ month: "2025-12", value: 102.4 }); // 2025's inflation, December on December
    expect(rows.find((r) => r.month === "2026-08")).toEqual({ month: "2026-08", value: 103 });
    expect(rows.at(-1)!.month).toBe("2026-08"); // later months not published yet
  });
});

describe("parseCpiYoyCsv", () => {
  it("reads the same month of the previous year = 100 rows (12-month inflation), oldest first", () => {
    const rows = parseCpiYoyCsv(decodeCpiCsv(readFileSync(new URL("../fixtures/gus-cpi-excerpt.csv", import.meta.url))));
    expect(rows[0]!.month).toBe("2025-12");
    expect(rows.at(-1)!.month).toBe("2026-08");
    expect(rows.every((r) => r.value > 95 && r.value < 110)).toBe(true);
  });
});
