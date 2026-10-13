import { describe, expect, it } from "vitest";
import { cashEffects } from "../src/valuation/cash.ts";
import type { TransactionItem } from "../src/db/items.ts";
import { splitCsvLine, statementTransactions } from "../src/transactions/ibkrStatement.ts";

// A made-up activity statement in IBKR's CSV layout (sections with their own headers; only the columns used matter).
const STATEMENT = `Statement,Header,Field Name,Field Value
Statement,Data,Title,Activity Statement
Deposits & Withdrawals,Header,Currency,Settle Date,Description,Amount
Deposits & Withdrawals,Data,PLN,2025-01-10,Electronic Fund Transfer,10000
Deposits & Withdrawals,Data,Total,,,10000
Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,,Proceeds,Comm in EUR,,,MTM in EUR,Code
Trades,Data,Order,Forex,PLN,EUR.PLN,"2025-01-10, 05:00:00","2,000",4.25,,-8500,-1.8,,,0,
Trades,Data,Order,Forex,PLN,EUR.PLN,"2025-01-10, 17:00:00",0.5,4.2,,-2.1,0,,,0,
Trades,Data,Order,Forex,PLN,USD.PLN,"2025-01-10, 06:00:00",400,3.9,,-1560,-1.8,,,0,
Trades,Data,Order,Forex,PLN,USD.PLN,"2025-01-10, 06:01:00",-100,3.88,,388,0,,,0,AFx
Trades,Data,Order,Forex,PLN,USD.PLN,"2025-01-10, 06:01:00",100,3.89,,-389,0,,,0,AFx
Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,C. Price,Proceeds,Comm/Fee,Basis,Realized P/L,MTM P/L,Code
Trades,Data,Order,Bonds,EUR,DBR 0 11/15/27 2.1%,"2025-01-11, 08:00:00","1,000",96,96,-960,-3,963,0,0,O
Trades,Data,Order,Treasury Bills,USD,912797ZZ1 4.2%,"2025-01-11, 09:00:00","300",98,98,-294,-5,299,0,0,O
Trades,Data,Total,,,,,,,,-1254,-8,,,,
Interest,Header,Currency,Date,Description,Amount
Interest,Data,EUR,2025-01-11,Purchase Accrued Interest DBR 0 11/15/27,-1.5
Interest,Data,EUR,2025-11-15,Bond Coupon Payment (DBR 0 11/15/27 - BUNDESREPUB. DEUTSCHLAND DBR 0 11/15/27),5
Interest,Data,USD,2025-02-05,USD Credit Interest for Jan-2025,0.1
Interest,Data,Total,,,3.6
Withholding Tax,Header,Currency,Date,Description,Amount,Code
Withholding Tax,Data,USD,2025-02-05,Withholding @ 20% on Credit Interest for Jan-2025,-0.02,
Corporate Actions,Header,Asset Category,Currency,Report Date,Date/Time,Description,Quantity,Proceeds,Value,Realized P/L,Code
Corporate Actions,Data,Treasury Bills,USD,2025-06-02,"2025-05-30, 20:25:00","(US912797ZZ10) Treasury Bill Maturity (912797ZZ1, B 06/01/25, US912797ZZ10)",-300,300,0,6,
Corporate Actions,Data,Total,,,,,,300,0,6,
Financial Instrument Information,Header,Asset Category,Symbol,Description,Conid,Security ID,Underlying,Listing Exch,Multiplier,Type,Issuer,Maturity,Code
Financial Instrument Information,Data,Bonds,DBR 0 11/15/27,DBR 0 11/15/27,1,DE0001102523,DBR,,1,Govt,BUND,2027-11-15,
Financial Instrument Information,Header,Asset Category,Symbol,Description,Conid,Security ID,Underlying,Listing Exch,Multiplier,Maturity,Code
Financial Instrument Information,Data,Treasury Bills,912797ZZ1,B 06/01/25,2,US912797ZZ10,BILL,,1,2025-06-01,
`;

describe("splitCsvLine", () => {
  it("keeps quoted commas and quotes", () => {
    expect(splitCsvLine('a,"b, c","say ""hi""",')).toEqual(["a", "b, c", 'say "hi"', ""]);
  });
});

describe("statementTransactions", () => {
  const txs = statementTransactions([STATEMENT]);
  const of = (type: string) => txs.filter((t) => t.type === type);

  it("books deposits on the settle date", () => {
    expect(of("DEPOSIT")).toEqual([{ date: "2025-01-10", account: "IBKR", type: "DEPOSIT", amount: 10000, currency: "PLN" }]);
  });

  it("nets forex trades per day and pair; their commissions become one EUR fee per day", () => {
    expect(of("EXCHANGE")).toEqual([
      { date: "2025-01-10", account: "IBKR", type: "EXCHANGE", amount: -8502.1, currency: "PLN", toAmount: 2000.5, toCurrency: "EUR" },
      { date: "2025-01-10", account: "IBKR", type: "EXCHANGE", amount: -1561, currency: "PLN", toAmount: 400, toCurrency: "USD" },
    ]);
    expect(of("FEE")).toEqual([{ date: "2025-01-10", account: "IBKR", type: "FEE", amount: -3.6, currency: "EUR", note: "FX commission" }]);
  });

  it("books bond and bill trades per 1000 nominal, with the commission as the fee and accrued interest in the cost", () => {
    expect(of("BUY")).toEqual([
      { date: "2025-01-11", account: "IBKR", type: "BUY", isin: "DE0001102523", quantity: 1, price: 96, amount: -961.5, fee: 3, currency: "EUR", note: "incl. 1.50 EUR accrued interest" },
      { date: "2025-01-11", account: "IBKR", type: "BUY", isin: "US912797ZZ10", quantity: 0.3, price: 98, amount: -294, fee: 5, currency: "USD" },
    ]);
  });

  it("books coupons, broker interest, withholding tax and maturities", () => {
    expect(of("COUPON")).toEqual([{ date: "2025-11-15", account: "IBKR", type: "COUPON", isin: "DE0001102523", amount: 5, currency: "EUR" }]);
    expect(of("INTEREST")).toMatchObject([{ date: "2025-02-05", amount: 0.1, currency: "USD" }]);
    expect(of("TAX")).toMatchObject([{ date: "2025-02-05", amount: -0.02, currency: "USD" }]);
    expect(of("REDEMPTION")).toEqual([{ date: "2025-06-02", account: "IBKR", type: "REDEMPTION", isin: "US912797ZZ10", quantity: 0.3, price: 100, amount: 300, currency: "USD" }]);
  });

  it("takes rows repeated in overlapping statements once, and the cash adds up", () => {
    expect(statementTransactions([STATEMENT, STATEMENT])).toEqual(txs);
    const cash = new Map<string, number>();
    for (const t of txs) for (const [c, v] of cashEffects(t as unknown as TransactionItem)) cash.set(c, Math.round(((cash.get(c) ?? 0) + v) * 1e6) / 1e6);
    expect(Object.fromEntries(cash)).toEqual({ PLN: -63.1, EUR: 1037.4, USD: 401.08 }); // 10000 − 8502.1 − 1561; 2000.5 − 3.6 − 961.5 − 3 + 5; 400 − 294 − 5 + 300 + 0.1 − 0.02
  });
});
