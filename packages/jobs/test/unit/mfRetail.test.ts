import { describe, expect, it } from "vitest";
import { findRetailFileLink } from "../../src/lib/mfRetail.ts";

describe("findRetailFileLink", () => {
  it("finds the retail-bond XLS among the page's attachments by its text", () => {
    const html = `
      <a class="file-download" href="/attachment/3d1b2ae7-1d9a-4b4b-b368-42da05663a8a" download>Rozporządzenie Ministra Finansów … plik w formacie pdf</a>
      <a class="file-download" href="/attachment/3d42a295-18af-43c6-b56d-de975030f64a" download><span>Dane dotyczące obligacji detalicznych</span> plik w formacie xls Dane&#8203;_dotyczace&#8203;_obligacji&#8203;_detalicznych.xls 0.98MB</a>`;
    expect(findRetailFileLink(html)).toBe("/attachment/3d42a295-18af-43c6-b56d-de975030f64a");
    expect(findRetailFileLink("<a href='/x'>nothing</a>")).toBeUndefined();
  });
});
