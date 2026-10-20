import { describe, expect, it } from "vitest";
import type { TransactionItem } from "../src/db/items.ts";
import { cashFlows, cashFlowsCsv } from "../src/cashflows/cashFlows.ts";

let n = 0;
const tx = (account: string, date: string, type: TransactionItem["type"], amount: number, currency = "PLN"): TransactionItem =>
  ({ PK: `ACCT#${account}`, SK: `TX#${date}#${++n}`, GSI1PK: "TX", GSI1SK: `${date}#${n}`, id: String(n), account, date, type, amount, currency, source: "test" }) as TransactionItem;
const dep = (account: string, date: string, amount: number) => tx(account, date, "DEPOSIT", amount);
const wd = (account: string, date: string, amount: number) => tx(account, date, "WITHDRAWAL", -amount);

// The deposits and withdrawals behind the sheet's "Wpłaty/wypłaty 2026" tab (2026-10-20).
const txs = [
  dep("Bossa Akcje i Obligacje", "2026-01-05", 9300),
  dep("Bossa Akcje i Obligacje", "2026-03-02", 10000),
  dep("Bossa Akcje i Obligacje", "2026-03-20", 4744),
  wd("Bossa Akcje i Obligacje", "2026-06-10", 13100),
  wd("Bossa Akcje i Obligacje", "2026-07-01", 1900),
  wd("Bossa Akcje i Obligacje", "2026-09-15", 2200),
  ...[["02", 7500], ["04", 5200], ["05", 19500], ["06", 24100], ["07", 13470], ["08", 14500], ["09", 14500]].map(([m, v]) => dep("Bossa Zagranica", `2026-${m}-10`, v as number)),
  dep("IBKR", "2026-10-02", 16300),
  dep("IKE Bossa", "2026-02-03", 20000),
  dep("IKE Bossa", "2026-04-03", 8260),
  dep("IKZE Bossa", "2026-01-07", 3800),
  dep("IKZE Bossa", "2026-03-07", 13156),
  wd("PKO BP Obligacje", "2026-03-11", 1900),
  wd("PKO BP Obligacje", "2026-07-11", 970),
  wd("Santander konto oszcz.", "2026-03-12", 7700),
  dep("Santander konto oszcz.", "2026-05-12", 5000),
  dep("Santander konto oszcz.", "2026-07-12", 2000),
  dep("Santander konto oszcz.", "2026-08-12", 2000),
  wd("Santander konto oszcz.", "2026-10-12", 800),
  // Years before: not in 2026's figures; HRE had money in 2025 and is still open (a coupon in 2026), so it's listed.
  dep("HRE", "2025-06-01", 1000),
  tx("HRE", "2026-06-01", "INTEREST", 12),
  // Emptied and closed in 2025: not listed for 2026.
  dep("Old broker", "2024-01-02", 500),
  wd("Old broker", "2025-02-02", 500),
  // A buy is not a cash flow.
  tx("IKE Bossa", "2026-02-04", "BUY", -19990),
];

describe("cash flows", () => {
  const r = cashFlows(txs, 2026);
  const byName = (a: string) => r.accounts.find((x) => x.account === a)!;

  it("lists the accounts in use in the year, by name", () => {
    expect(r.accounts.map((a) => a.account)).toEqual([
      "Bossa Akcje i Obligacje",
      "Bossa Zagranica",
      "HRE",
      "IBKR",
      "IKE Bossa",
      "IKZE Bossa",
      "PKO BP Obligacje",
      "Santander konto oszcz.",
    ]);
    expect(r.years).toEqual([2026, 2025, 2024]);
  });

  it("gives deposits, withdrawals and their balance per month, as the sheet", () => {
    const a = byName("Bossa Akcje i Obligacje");
    expect(a.deposits).toEqual([9300, 0, 14744, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(a.withdrawals).toEqual([0, 0, 0, 0, 0, 13100, 1900, 0, 2200, 0, 0, 0]);
    expect(a.net).toEqual([9300, 0, 14744, 0, 0, -13100, -1900, 0, -2200, 0, 0, 0]);
    expect(a.totals).toEqual({ deposits: 24044, withdrawals: 17200, net: 6844 });
    expect(byName("Santander konto oszcz.").totals.net).toBe(500);
    expect(byName("PKO BP Obligacje").totals.net).toBe(-2870);
    expect(byName("HRE").totals).toEqual({ deposits: 0, withdrawals: 0, net: 0 });
  });

  it("totals every account per month (Bilans wpływów)", () => {
    expect(r.total.net).toEqual([13100, 27500, 18300, 13460, 24500, 11000, 12600, 16500, 12300, 15500, 0, 0]);
    expect(r.total.totals.net).toBe(164760);
  });

  it("counts another currency at the NBP rate of the day before", () => {
    const fx = new Map([["EUR", [{ date: "2026-10-01", mid: 4.25 }, { date: "2026-10-02", mid: 4.3 }]]]);
    const eur = cashFlows([tx("IBKR", "2026-10-02", "DEPOSIT", 1000, "EUR"), tx("IBKR", "2026-10-05", "DEPOSIT", 1, "USD")], 2026, fx);
    expect(eur.accounts[0]!.deposits[9]).toBe(4250);
    expect(eur.missingRates).toEqual(["2026-10-05 IBKR 1 USD"]);
  });

  it("writes the sheet's summary layout as CSV", () => {
    const lines = cashFlowsCsv(r).split("\r\n");
    expect(lines[0]).toBe("Podsumowanie,styczeń,luty,marzec,kwiecień,maj,czerwiec,lipiec,sierpień,wrzesień,październik,listopad,grudzień,");
    expect(lines[1]).toBe("Bilans wpływów,13100,27500,18300,13460,24500,11000,12600,16500,12300,15500,,,164760");
    expect(lines[2]).toBe("Bossa Akcje i Obligacje,9300,0,14744,0,0,-13100,-1900,0,-2200,0,0,0,6844");
    expect(lines).toHaveLength(r.accounts.length + 3); // header, total, accounts, and the final line break
    expect(cashFlowsCsv({ ...r, accounts: [{ ...r.accounts[0]!, account: 'A, "B"' }] }).split("\r\n")[2]).toMatch(/^"A, ""B""",/);
  });
});
