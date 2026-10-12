import { describe, expect, it } from "vitest";
import { parseMfIndexRatios } from "../../src/lib/mfPage.ts";

// Shape of https://www.gov.pl/web/finanse/wspolczynniki-indeksacji2 (October 2026): two months side by side,
// each date followed by (ratio, accrued interest) per bond; the shorter month ends with &nbsp; cells.
const html = `
<table cellspacing="0"></table>
<table border="1"><tbody>
<tr><th rowspan="2"><strong>Data</strong></th><th colspan="2">IZ0831</th><th colspan="2">IZ0836</th>
    <th rowspan="2"><strong>Data</strong></th><th colspan="2">IZ0831</th><th colspan="2">IZ0836</th></tr>
<tr><td><strong>Wsp&oacute;łczynnik indeksacji</strong></td><td><strong>Narosłe odsetki</strong></td>
    <td><strong>Wsp&oacute;łczynnik indeksacji</strong></td><td><strong>Narosłe odsetki</strong></td>
    <td><strong>Wsp&oacute;łczynnik indeksacji</strong></td><td><strong>Narosłe odsetki</strong></td>
    <td><strong>Wsp&oacute;łczynnik indeksacji</strong></td><td><strong>Narosłe odsetki</strong></td></tr>
<tr><td>01.09.2026</td><td>1,06707</td><td>0,36</td><td>1,09590</td><td>0,42</td><td>01.10.2026</td><td>1,07561</td><td>1,91</td><td>1,10467</td><td>2,24</td></tr>
<tr><td>30.09.2026</td><td>1,07533</td><td>1,86</td><td>1,10438</td><td>2,18</td><td>30.10.2026</td><td>1,07863</td><td>3,41</td><td>1,10777</td><td>4,01</td></tr>
<tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>31.10.2026</td><td>1,07873</td><td>3,47</td><td>1,10788</td><td>4,07</td></tr>
</tbody></table>`;

describe("parseMfIndexRatios", () => {
  it("reads each bond's ratio per date, both months", () => {
    const r = parseMfIndexRatios(html);
    expect([...r.keys()]).toEqual(["IZ0831", "IZ0836"]);
    expect(Object.fromEntries(r.get("IZ0836")!)).toEqual({
      "2026-09-01": 1.0959,
      "2026-10-01": 1.10467,
      "2026-09-30": 1.10438,
      "2026-10-30": 1.10777,
      "2026-10-31": 1.10788,
    });
    expect(r.get("IZ0831")!.get("2026-10-31")).toBe(1.07873);
    expect(r.get("IZ0831")!.size).toBe(5);
  });
});
