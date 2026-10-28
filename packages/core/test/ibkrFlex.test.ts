import { describe, expect, it } from "vitest";
import { ibkrPrices, isFlexStatement, parseFlexReply, parseFlexStatement, tradeDayPrices } from "../src/prices/ibkrFlex.ts";

// The shape of a real reply (Activity Flex Query: Open Positions + Prior Period Positions, XML); made-up account.
const STATEMENT = `<FlexQueryResponse queryName="Positions" type="AF">
<FlexStatements count="1">
<FlexStatement accountId="U0000000" fromDate="2026-10-15" toDate="2026-10-16" period="" whenGenerated="2026-10-28;08:11:28">
<OpenPositions>
<OpenPosition currency="EUR" assetCategory="BOND" symbol="DBR 0 11/15/27" description="DBR 0 11/15/27" conid="420668636" isin="DE0001102523" expiry="" reportDate="2026-10-16" position="8000" markPrice="97.009" positionValue="7760.72" levelOfDetail="SUMMARY" accruedInt="0" />
<OpenPosition currency="USD" assetCategory="BILL" symbol="912797WJ2" description="B 09/30/27" conid="929911231" isin="US912797WJ22" expiry="" reportDate="2026-10-16" position="22000" markPrice="95.930752" positionValue="21104.77" levelOfDetail="SUMMARY" accruedInt="" />
</OpenPositions><PriorPeriodPositions>
<PriorPeriodPosition currency="USD" assetCategory="BILL" symbol="912797WJ2" description="B 09/30/27" conid="929911231" isin="US912797WJ22" expiry="" date="2026-10-15" price="95.870651" />
<PriorPeriodPosition currency="EUR" assetCategory="BOND" symbol="OAT0%25FEB27" description="FRTR 0 02/25/27 &amp; co" conid="483472362" isin="FR0014003513" expiry="" date="2026-10-15" price="99.066" />
</PriorPeriodPositions>
</FlexStatement>
</FlexStatements>
</FlexQueryResponse>`;

const bill = { isin: "US912797WJ22", venue: "IBKR", currency: "USD", sourceIds: { ibkr: "929911231" } };

describe("parseFlexReply", () => {
  it("reads the reference code of SendRequest", () => {
    const xml = `<FlexStatementResponse timestamp='28 October, 2026 08:11 AM EDT'>
<Status>Success</Status>
<ReferenceCode>6042164273</ReferenceCode>
<Url>https://gdcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement</Url>
</FlexStatementResponse>`;
    expect(parseFlexReply(xml)).toEqual({
      status: "Success",
      referenceCode: "6042164273",
      url: "https://gdcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement",
    });
  });

  it("reads an error (statement not ready yet)", () => {
    const xml = "<FlexStatementResponse><Status>Warn</Status><ErrorCode>1019</ErrorCode><ErrorMessage>Statement generation in progress. Please try again shortly.</ErrorMessage></FlexStatementResponse>";
    expect(parseFlexReply(xml)).toMatchObject({ status: "Warn", errorCode: "1019" });
    expect(isFlexStatement(xml)).toBe(false);
  });
});

describe("parseFlexStatement", () => {
  it("reads the period, open positions and daily prices", () => {
    const s = parseFlexStatement(STATEMENT);
    expect(s.from).toBe("2026-10-15");
    expect(s.to).toBe("2026-10-16");
    expect(s.open).toHaveLength(2);
    expect(s.open[1]).toMatchObject({ isin: "US912797WJ22", assetCategory: "BILL", quantity: 22000, markPrice: 95.930752, accruedInterest: null });
    expect(s.open[0]!.accruedInterest).toBe(0);
    expect(s.prices.map((p) => [p.isin, p.date, p.price])).toEqual([
      ["US912797WJ22", "2026-10-15", 95.870651],
      ["FR0014003513", "2026-10-15", 99.066],
    ]);
  });

  it("refuses a status reply", () => {
    expect(() => parseFlexStatement("<FlexStatementResponse><Status>Fail</Status></FlexStatementResponse>")).toThrow(/not a statement/);
  });
});

describe("ibkrPrices", () => {
  it("takes the instrument's daily prices and the last day's mark, as final prices of its venue", () => {
    const items = ibkrPrices(bill, parseFlexStatement(STATEMENT), "2026-10-28T08:00:00Z");
    expect(items.map((i) => [i.SK, i.close, i.source, i.status])).toEqual([
      ["PX#IBKR#2026-10-15", 95.870651, "ibkr", "final"],
      ["PX#IBKR#2026-10-16", 95.930752, "ibkr", "final"],
    ]);
  });

  it("matches by IBKR's id when the ISIN differs", () => {
    const items = ibkrPrices({ ...bill, isin: "US912797WJ2X" }, parseFlexStatement(STATEMENT), "now");
    expect(items).toHaveLength(2);
  });

  it("refuses a price in another currency", () => {
    expect(() => ibkrPrices({ ...bill, currency: "EUR" }, parseFlexStatement(STATEMENT), "now")).toThrow(/priced in USD/);
  });
});

describe("tradeDayPrices", () => {
  const inst = { ...bill, pricePath: [{ date: "2026-10-14", price: 95.8046667 }, { date: "2027-09-30", price: 100 }] };

  it("prices the trade day before IBKR's first price at the trade price", () => {
    expect(tradeDayPrices(inst, "2026-10-15", "now").map((i) => [i.date, i.close, i.source])).toEqual([["2026-10-14", 95.8046667, "trade"]]);
  });

  it("adds nothing when IBKR has the trade day, or no price at all", () => {
    expect(tradeDayPrices(inst, "2026-10-14", "now")).toEqual([]);
    expect(tradeDayPrices(inst, undefined, "now")).toEqual([]);
  });
});
