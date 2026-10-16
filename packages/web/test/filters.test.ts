import { describe, expect, it } from "vitest";
import { matchesText } from "../src/Filters.tsx";

describe("free-text filter", () => {
  const iz = { code: "IZ0836", name: "Obligacje skarbowe IZ0836 (indeksowane inflacją)" };
  it("finds the text in the name or the code, ignoring case and Polish accents", () => {
    expect(matchesText("INFLACJA", iz)).toBe(true);
    expect(matchesText("iz08", iz)).toBe(true);
    expect(matchesText("  skarbowe ", iz)).toBe(true);
    expect(matchesText("łódź", { code: "X", name: "Lodz S.A." })).toBe(true);
    expect(matchesText("kruk", iz)).toBe(false);
    expect(matchesText("", iz)).toBe(true);
  });
});
