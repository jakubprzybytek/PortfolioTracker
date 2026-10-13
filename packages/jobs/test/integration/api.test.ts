import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { HoldingSnapshot, SnapshotItem } from "@portfolio/core";
import { API, get, repoRoot, send, uploadImport, waitFor } from "./setup.ts";

const IZ = "PL0000117024";
const DS = "PL0000113783";
const SPXS = "IE00B3YCGJ38"; // sample ETF (EUR, Yahoo), split 100:1 on 2025-12-15
const KRU = "PLKRK0000713"; // sample Catalyst corporate bond KRU0827 (BiznesRadar), nominal 100
const BUND = "DE0001102523"; // sample foreign bond at IBKR: calculated prices
const EUR_CASH = "ZZWALUTYEUR0";

interface InstrumentOut {
  isin: string;
  code: string;
  terms?: { couponType: string };
  backfill?: { status: string; rows?: number; from?: string; to?: string };
}

describe(`API ${API}`, () => {
  beforeAll(async () => {
    // Seed, in dependency order; every import is idempotent, so re-running on a seeded stage is safe.
    // 1. MF calculator (reference index + bond terms) — instruments with terms "mf" need it first.
    const mfKey = await uploadImport("mf-calculator", "kalkulatorodsetek.xlsm", readFileSync(path.join(repoRoot, "packages/core/test/fixtures/kalkulatorodsetek.xlsm")));
    await waitFor(async () => {
      const r = await get<{ jobs: Record<string, { status: string; note?: string; finishedAt?: string } | null> }>("/status");
      const run = r.body.jobs["import"];
      return run?.status === "ok" && run.note?.includes(mfKey) ? true : undefined;
    }, 180_000);
    // 1b. Ministry retail-bond file — retail instruments ("mf-retail") need it first.
    const retailKey = await uploadImport("mf-retail", "obligacje-detaliczne.xls", readFileSync(path.join(repoRoot, "packages/core/test/fixtures/obligacje-detaliczne-2026-10.xls")));
    await waitFor(async () => {
      const r = await get<{ jobs: Record<string, { status: string; note?: string } | null> }>("/status");
      const run = r.body.jobs["import"];
      return run?.status === "ok" && run.note?.includes(retailKey) ? true : undefined;
    }, 180_000);
    // 2. Instruments: starts the GPW history backfill; wait for it so the valuation sees prices and names.
    await uploadImport("instruments", "instruments.json", readFileSync(path.join(repoRoot, "data/instruments.json")));
    await uploadImport("instruments", "sample.json", readFileSync(path.join(repoRoot, "data/instruments.sample.json")));
    await uploadImport("prices", "sample.json", readFileSync(path.join(repoRoot, "data/prices.sample.json")));
    await uploadImport("accounts", "sample.json", readFileSync(path.join(repoRoot, "data/accounts.sample.json")));
    await waitFor(async () => {
      const inst = await get<InstrumentOut[]>("/instruments");
      const ok = inst.status === 200 && [IZ, DS, SPXS, KRU, BUND].every((i) => inst.body.find((x) => x.isin === i)?.backfill?.status === "done");
      return ok ? true : undefined;
    }, 240_000);
    // 3. Transactions: triggers the valuation. Wait for a snapshot that knows both instruments.
    await uploadImport("transactions", "sample.json", readFileSync(path.join(repoRoot, "data/transactions.sample.json")));
    await waitFor(async () => {
      const r = await get<SnapshotItem>("/holdings");
      if (r.status !== 200) return undefined;
      const codes = new Set(r.body.holdings.map((h) => h.code));
      // The ETF needs NBP rates too (fetched when the instrument was imported).
      const clean = r.body.holdings.every((h) => !h.flags.includes("unknown_instrument") && !h.flags.includes("no_price") && !h.flags.includes("no_fx"));
      const ike = r.body.accounts?.["ike"]?.cash;
      const etf = r.body.holdings.find((h) => h.code === "SPXS")?.quantity === 200 && r.body.holdings.some((h) => h.code === "KRU0827") && r.body.holdings.some((h) => h.isin === BUND);
      return codes.has("DS0432") && codes.has("IZ0836") && codes.has("EDO0935") && codes.has("SAMPLE-APARTMENT") && etf && ike === 99.49 && r.body.accounts?.["closed"] && r.body.accounts?.["eur"] && clean ? true : undefined; // "closed", "eur": the latest sample rows
    }, 420_000); // revaluations run one at a time (queued), each up to a minute
    // The NBP import (EUR and USD back to 2002) writes rates as it goes; wait for the run to finish.
    await waitFor(async () => ((await get<{ jobs: Record<string, { status: string } | null> }>("/status")).body.jobs["fx"]?.status === "ok" ? true : undefined), 300_000);
  });

  it("GET /status lists the last run of every job", async () => {
    const { status, body } = await get<{ now: string; jobs: Record<string, unknown> }>("/status");
    expect(status).toBe(200);
    expect(Object.keys(body.jobs).sort()).toEqual(["backfill", "eod-catalyst", "eod-etf", "eod-gpw", "eod-gpw-recheck", "fx", "import", "monthly", "valuation"]);
    expect(body.jobs["fx"]).toMatchObject({ status: "ok" });
    expect(body.jobs["import"]).toMatchObject({ status: "ok" });
  });

  it("GET /instruments returns the tracked bonds with terms and a finished backfill", async () => {
    const { status, body } = await get<InstrumentOut[]>("/instruments");
    expect(status).toBe(200);
    const iz = body.find((i) => i.isin === IZ)!;
    const ds = body.find((i) => i.isin === DS)!;
    expect(iz).toMatchObject({ code: "IZ0836", terms: { couponType: "INDEXED" }, backfill: { status: "done", from: "2024-06-24" } });
    expect(ds).toMatchObject({ code: "DS0432", terms: { couponType: "FIXED" }, backfill: { status: "done", from: "2021-06-16" } });
    expect(ds.backfill!.rows!).toBeGreaterThanOrEqual(1334);
    expect(body.some((i) => i.isin === "MF-TERMS")).toBe(false);
  });

  it("GET /instruments/{isin}/prices returns daily clean prices in range, sorted", async () => {
    const { status, body } = await get<{ date: string; close: number; traded: boolean; lastTradeDate?: string }[]>(
      `/instruments/${IZ}/prices?from=2026-10-05&to=2026-10-09`,
    );
    expect(status).toBe(200);
    expect(body.map((p) => p.date)).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]);
    expect(body.at(-1)).toMatchObject({ close: 87.92, traded: true, lastTradeDate: "2026-10-09" });
  });

  it("GET /instruments/{isin}/prices gives a retail bond's calculated value per bond, from its purchase", async () => {
    const { status, body } = await get<{ date: string; close: number; calculated?: boolean }[]>("/instruments/PL0000118402/prices?from=2025-09-01&to=2026-10-11");
    expect(status).toBe(200);
    expect(body[0]).toMatchObject({ date: "2025-09-15", close: 100, calculated: true }); // EDO0935 bought 2025-09-15
    expect(body.find((p) => p.date === "2026-09-15")!.close).toBe(106); // year 1 at 6.00 %, capitalised
    expect(body.at(-1)!.close).toBeGreaterThan(106);
    expect(body.every((p, i) => i === 0 || p.close >= body[i - 1]!.close)).toBe(true);
  });

  it("GET /holdings values the sample portfolio with accrued interest and IZ indexation", async () => {
    const snap = await waitFor(async () => {
      const r = await get<SnapshotItem>("/holdings");
      return r.status === 200 && r.body.holdings.length >= 9 ? r.body : undefined;
    });
    expect(snap.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // one holding per account and instrument, sorted by account then code
    expect(snap.holdings.map((h) => `${h.account}/${h.code}`)).toEqual(["bonds/KRU0827", "broker/DS0432", "broker/IZ0836", "eur/DE0001102523", "foreign/SPXS", "ibkr/DE0001102523", "ibkr/EUR", "ike/DS0432", "ike/EDO0935", "ike/SAMPLE-APARTMENT"]);
    const by = Object.fromEntries(snap.holdings.map((h) => [`${h.account}/${h.code}`, h])) as Record<string, HoldingSnapshot>;
    expect(by["broker/DS0432"]).toMatchObject({ quantity: 20, nominal: 1000, cost: 15931.8, couponsReceived: 700 });
    expect(by["broker/IZ0836"]).toMatchObject({ quantity: 10, cost: 9561.54, couponsReceived: 214.2 });
    expect(by["ike/DS0432"]).toMatchObject({ quantity: 5, cost: 4013.01, couponsReceived: 0 });
    expect(by["broker/IZ0836"]!.nominal!).toBeGreaterThan(1100);
    // Retail bond: valued from the Ministry's rates (6.00 % in year 1, 5.00 % from 2026-09-15), no market price.
    const edo = by["ike/EDO0935"]!;
    expect(edo).toMatchObject({ type: "BOND_RETAIL", quantity: 10, cost: 1000, cleanPrice: null, flags: [], rate: { current: 0.05, previous: 0.06 } });
    expect(edo.valuePerUnit!).toBeGreaterThan(106); // 100 + 6.00 after year 1, plus year-2 interest so far
    // Manually valued: the latest manual price (950 on 2026-09-30), never stale; its income counts as received.
    expect(by["ike/SAMPLE-APARTMENT"]).toMatchObject({ type: "FUND_MANUAL", quantity: 1, cost: 900, value: 950, gain: 50, couponsReceived: 12.5, flags: [] });
    // Cash per account; the incomplete account's cash is shown but not in the total.
    const { eur, ...plnOnly } = snap.accounts!;
    expect(plnOnly).toEqual({ bonds: { cash: 1013.9 }, broker: { cash: 5420.86 }, closed: { cash: 0 }, etf: { cash: 2000, incomplete: ["ETFs"] }, foreign: { cash: 663.14 }, ibkr: { cash: 1400 }, ike: { cash: 99.49 } });
    // An account in several currencies: cash per currency (EUR 1000 − 962 − 1.25 − 20 + 100), each at today's NBP rate.
    expect(eur).toMatchObject({ baseCurrency: "EUR", currencies: { PLN: { amount: 700, value: 700 }, EUR: { amount: 116.75 }, USD: { amount: 23.2 } } });
    for (const c of Object.values(eur!.currencies!)) expect(c.value!).toBeCloseTo(c.amount * (c.rate ?? 1), 1);
    expect(eur!.cash).toBeCloseTo(Object.values(eur!.currencies!).reduce((x, c) => x + c.value!, 0), 1);
    expect(snap.totals.cash).toBeCloseTo(8597.39 + eur!.cash, 1); // the PLN accounts as before, plus this one
    // A bond bought in EUR: cost at the NBP rate of the day before (2025-11-03: 4.2527), and as paid in EUR.
    expect(by["eur/DE0001102523"]).toMatchObject({ quantity: 1, cost: 4096.41, costNative: { amount: 963.25, currency: "EUR" } });
    // IBKR: foreign cash as a position (80.96 EUR left, at its PLN cost), the bond at its calculated price x 1000 x NBP rate
    expect(by["ibkr/EUR"]).toMatchObject({ type: "CURRENCY", currency: "EUR", quantity: 80.96, cost: 348.13, flags: [] });
    expect(by["ibkr/EUR"]!.value!).toBeCloseTo(80.96 * by["ibkr/EUR"]!.fx!.rate, 1);
    const bund = by["ibkr/DE0001102523"]!;
    expect(bund).toMatchObject({ type: "BOND_IBKR", quantity: 2, nominal: 1000, cost: 8251.87, flags: [] });
    expect(bund.cleanPrice!).toBeGreaterThan(95.952); // accreting towards 100 at maturity
    expect(bund.cleanPrice!).toBeLessThan(100);
    expect(bund.value!).toBeCloseTo(2 * 10 * bund.cleanPrice! * bund.fx!.rate, 0);
    // Catalyst corporate bond: clean price (% of nominal) x nominal 100, no accrued interest; the coupon counts as received.
    const kru = by["bonds/KRU0827"]!;
    expect(kru).toMatchObject({ type: "BOND_CORPORATE", quantity: 40, nominal: 100, accruedInterest: null, cost: 4056.1, couponsReceived: 70, flags: [] });
    expect(kru.cleanPrice!).toBeGreaterThan(90);
    expect(kru.value!).toBeCloseTo(40 * kru.cleanPrice!, 1);
    // ETF in EUR: 2 bought, x100 by the split; valued at the EUR close x NBP mid; cost as paid in PLN.
    const spxs = by["foreign/SPXS"]!;
    expect(spxs).toMatchObject({ type: "ETF", currency: "EUR", quantity: 200, cost: 9336.86, flags: [] });
    expect(spxs.cleanPrice!).toBeGreaterThan(5); // ~13 EUR after the split
    expect(spxs.cleanPrice!).toBeLessThan(50);
    expect(spxs.fx!.rate).toBeGreaterThan(3.5);
    expect(spxs.value!).toBeCloseTo(200 * spxs.cleanPrice! * spxs.fx!.rate, 0);
    for (const h of snap.holdings.filter((x) => x.type === "BOND_LISTED")) {
      expect(h.cleanPrice).not.toBeNull();
      expect(h.accruedInterest).not.toBeNull();
      expect(h.value).toBeCloseTo(h.valuePerUnit! * h.quantity, 1);
      expect(h.flags).not.toContain("no_price");
      expect(h.flags).not.toContain("unknown_instrument");
    }
    expect(snap.totals.value).toBeCloseTo(snap.holdings.reduce((s, h) => s + h.value!, 0), 1);
  });

  it("GET /accounts gives each account's net deposits, value, profit, income, costs and XIRR; the total skips incomplete ones", async () => {
    type Row = { account: string; incomplete?: string[]; closed?: true; lastDate: string; netDeposits: number; positions: number; cash: number; total: number; profit: number; income: number; costs: number; xirr: number | null };
    const { status, body } = await get<{ date: string; accounts: Row[]; total: Row }>("/accounts");
    expect(status).toBe(200);
    const snap = (await get<SnapshotItem>("/holdings")).body;
    expect(body.date).toBe(snap.date);
    expect(body.accounts.map((a) => a.account)).toEqual(["bonds", "broker", "closed", "etf", "eur", "foreign", "ibkr", "ike"]);
    const by = Object.fromEntries(body.accounts.map((a) => [a.account, a]));
    // Money in EUR at the NBP rate of the day before (2025-11-28: 4.2369); in the account's own EUR, the PLN at 2025-10-31's 4.2543.
    expect(by["eur"]).toMatchObject({ netDeposits: 5423.69, costs: 5.32, base: { currency: "EUR", netDeposits: 1275.28 } });
    expect(by["broker"]).toMatchObject({ netDeposits: 30000, cash: 5420.86, income: 914.2, costs: 50.88 }); // coupons 350 + 214.2 + 350; fees 31.8 + 19.08
    expect(by["ike"]).toMatchObject({ netDeposits: 6000, cash: 99.49, income: 12.5, costs: 8.01 });
    expect(by["bonds"]).toMatchObject({ netDeposits: 5000, cash: 1013.9, income: 70, costs: 8.1 });
    expect(by["etf"]).toMatchObject({ incomplete: ["ETFs"], netDeposits: 2000, cash: 2000 });
    expect(by["etf"]!.closed).toBeUndefined();
    // emptied (1000 in, 20 interest, 1020 out): closed, its profit still in the total
    expect(by["closed"]).toMatchObject({ closed: true, lastDate: "2025-07-01", netDeposits: -20, positions: 0, cash: 0, total: 0, profit: 20, income: 20 });
    expect(by["broker"]!.closed).toBeUndefined();
    // The profit split: open positions + sales and redemptions + income − fees outside trades + the rest
    expect(by["broker"]).toMatchObject({ realised: 0, fees: 0 });
    expect(by["closed"]).toMatchObject({ unrealised: 0, realised: 0, income: 20, other: 0 });
    for (const a of [...body.accounts, body.total] as (Row & { unrealised: number; realised: number; fees: number; other: number })[])
      expect(a.unrealised + a.realised + a.income - a.fees + a.other, a.account).toBeCloseTo(a.profit, 1);
    for (const a of body.accounts) {
      const positions = Math.round(snap.holdings.filter((h) => h.account === a.account).reduce((s, h) => s + h.value!, 0) * 100) / 100;
      expect(a.positions, a.account).toBeCloseTo(positions, 2);
      expect(a.total).toBeCloseTo(a.positions + a.cash, 2);
      expect(a.profit).toBeCloseTo(a.total - a.netDeposits, 2);
    }
    expect(by["broker"]!.xirr).not.toBeNull();
    expect(by["ibkr"]).toMatchObject({ netDeposits: 10000, cash: 1400 });
    expect(body.total).toMatchObject({ account: "Total", netDeposits: 66403.69 }); // without the incomplete "etf"
    expect(body.total.cash).toBeCloseTo(snap.totals.cash!, 1);
    expect(body.total.total).toBeCloseTo(snap.totals.value + snap.totals.cash!, 1);
  });

  it("GET /portfolio/history returns one snapshot per day since the first transaction", async () => {
    const { status, body } = await get<{ date: string; totals: { value: number; cash?: number }; total: number; netDeposits: number }[]>("/portfolio/history?from=2025-02-01&to=2025-02-10");
    expect(status).toBe(200);
    expect(body.map((s) => s.date)).toEqual(["2025-02-03", "2025-02-04", "2025-02-05", "2025-02-06", "2025-02-07", "2025-02-08", "2025-02-09", "2025-02-10"]);
    expect(body[0]!.totals.value).toBe(0); // deposit only
    // positions + cash, and the money put in so far: the chart's two lines
    expect(body[0]).toMatchObject({ total: 30000, netDeposits: 30000 });
    expect(body[2]!.netDeposits).toBe(30000);
    expect(body[2]!.total).toBeCloseTo(body[2]!.totals.value + body[2]!.totals.cash!, 1);
    expect(body[2]!.totals.value).toBeGreaterThan(15000); // after the DS0432 buy
  });

  it("GET /instruments/{isin}/transactions filters by ISIN", async () => {
    const { status, body } = await get<{ isin: string; type: string }[]>(`/instruments/${DS}/transactions`);
    expect(status).toBe(200);
    expect(body.length).toBeGreaterThanOrEqual(3);
    expect(body.every((t) => t.isin === DS)).toBe(true);
  });

  it("GET /holdings/history gives a position's daily value and cost, or an instrument's total across accounts", async () => {
    const snap = (await get<SnapshotItem>("/holdings")).body;
    const ds = (acct: string) => snap.holdings.find((h) => h.account === acct && h.code === "DS0432")!;
    const one = await waitFor(async () => {
      const r = await get<{ date: string; value: number; cost: number; quantity: number }[]>(`/holdings/history?isin=${DS}&account=broker&from=2025-01-01&to=${snap.date}`);
      return r.status === 200 && r.body.at(-1)?.date === snap.date ? r.body : undefined;
    });
    expect(one[0]).toMatchObject({ date: "2025-02-05", quantity: 20, cost: 15931.8 }); // from the purchase
    expect(one.at(-1)).toMatchObject({ value: ds("broker").value, cost: ds("broker").cost, quantity: 20 });
    const all = (await get<{ date: string; value: number; quantity: number }[]>(`/holdings/history?isin=${DS}&from=2026-01-01&to=${snap.date}`)).body;
    expect(all.at(-1)).toMatchObject({ quantity: 25, value: Math.round((ds("broker").value! + ds("ike").value!) * 100) / 100 });
    expect((await get("/holdings/history?isin=nope")).status).toBe(400);
  });

  it("GET /transactions lists all transactions newest first, with their instrument", async () => {
    const { status, body } = await get<{ date: string; account: string; type: string; isin?: string; instrument: { code: string; type: string } | null }[]>("/transactions");
    expect(status).toBe(200);
    expect(body).toHaveLength(31);
    const dates = body.map((t) => t.date);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(body[0]).toMatchObject({ date: "2026-09-30", account: "ike", type: "INTEREST", instrument: { code: "SAMPLE-APARTMENT", type: "FUND_MANUAL" } });
    expect(body.filter((t) => t.type === "DEPOSIT").every((t) => t.instrument === null)).toBe(true);
    expect(new Set(body.map((t) => t.account))).toEqual(new Set(["bonds", "broker", "closed", "etf", "eur", "foreign", "ibkr", "ike"]));
    expect(body.find((t) => t.type === "SPLIT")).toMatchObject({ account: "foreign", ratio: 100, amount: 0, instrument: { code: "SPXS", type: "ETF" } });
  });

  it("GET /prices lists held instruments with their latest price, its date and the 1-year change", async () => {
    const { status, body } = await get<{ code: string; price: number | null; priceDate: string | null; stale: boolean; change1y: number | null; yearAgo: { date: string } | null; rate?: unknown }[]>("/prices");
    expect(status).toBe(200);
    expect(body.map((r) => r.code)).toEqual(["DE0001102523", "DS0432", "EDO0935", "IZ0836", "KRU0827", "SAMPLE-APARTMENT", "SPXS"]); // no row for the EUR cash
    // ETF: EUR price; the 1-year change compares on today's share basis across the split (not -99 %).
    const spxs = body.find((r) => r.code === "SPXS")!;
    expect(spxs).toMatchObject({ currency: "EUR", stale: false });
    expect(spxs.change1y!).toBeGreaterThan(-0.5);
    expect(spxs.change1y!).toBeLessThan(1);
    expect(body.find((r) => r.code === "EDO0935")).toMatchObject({ price: null, rate: { current: 0.05, previous: 0.06 } });
    expect(body.find((r) => r.code === "SAMPLE-APARTMENT")).toMatchObject({ price: 950, priceDate: "2026-09-30", stale: false, manual: true });
    for (const r of body.filter((x) => x.code === "DS0432" || x.code === "IZ0836")) {
      expect(r.price).toBeGreaterThan(50);
      expect(r.priceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof r.change1y).toBe("number"); // both have more than a year of GPW history
      expect(r.yearAgo!.date < r.priceDate!).toBe(true);
    }
  });

  it("GET /instruments/{isin}/prices: an ETF's prices are stored as traded and charted on today's share basis", async () => {
    const inst = (await get<(InstrumentOut & { splits?: unknown; sourceIds?: unknown })[]>("/instruments")).body.find((i) => i.isin === SPXS)!;
    expect(inst).toMatchObject({ code: "SPXS", splits: [{ date: "2025-12-15", ratio: 100 }], sourceIds: { yahoo: "SPXS.AS" }, backfill: { status: "done" } });
    expect(inst.backfill!.rows!).toBeGreaterThan(2000); // Yahoo history since 2017
    const { status, body } = await get<{ date: string; close: number; currency: string }[]>(`/instruments/${SPXS}/prices?from=2025-12-10&to=2025-12-17`);
    expect(status).toBe(200);
    expect(body.every((p) => p.currency === "EUR" && p.close > 5 && p.close < 50)).toBe(true); // no cliff at the split
    const before = body.filter((p) => p.date < "2025-12-15").at(-1)!.close;
    const after = body.find((p) => p.date >= "2025-12-15")!.close;
    expect(Math.abs(after / before - 1)).toBeLessThan(0.05);
  });

  it("GET /instruments/{isin}/prices: a Catalyst bond's daily clean prices from BiznesRadar, since its listing", async () => {
    const inst = (await get<InstrumentOut[]>("/instruments")).body.find((i) => i.isin === KRU)!;
    expect(inst).toMatchObject({ code: "KRU0827", backfill: { status: "done" } });
    expect(inst.backfill!.from! <= "2022-09-30").toBe(true); // listed in August 2022
    expect(inst.backfill!.rows!).toBeGreaterThan(700);
    const { status, body } = await get<{ date: string; close: number }[]>(`/instruments/${KRU}/prices?from=2026-10-05&to=2026-10-09`);
    expect(status).toBe(200);
    expect(body.find((p) => p.date === "2026-10-09")).toMatchObject({ close: 100.45 });
  });

  it("GET /instruments/{isin}/prices: a foreign bond's calculated prices run from the trade to 100 % at maturity", async () => {
    const inst = (await get<InstrumentOut[]>("/instruments")).body.find((i) => i.isin === BUND)!;
    expect(inst).toMatchObject({ backfill: { status: "done", from: "2025-10-02", to: "2027-11-15" } });
    const { body } = await get<{ date: string; close: number }[]>(`/instruments/${BUND}/prices?from=2025-10-02&to=2025-10-06`);
    expect(body.map((p) => p.date)).toEqual(["2025-10-02", "2025-10-03", "2025-10-06"]); // weekdays
    expect(body[0]!.close).toBe(95.952);
    expect(body[2]!.close).toBeGreaterThan(95.952);
  });

  it("GET /indicators lists inflation and NBP exchange rates with the latest value and a year earlier", async () => {
    const { status, body } = await get<{ id: string; group: string; unit: string; latest: { date: string; value: number } | null; yearAgo: { date: string; value: number } | null }[]>("/indicators");
    expect(status).toBe(200);
    expect(body.map((i) => [i.id, i.group, i.unit])).toEqual([
      ["cpi-mom", "Inflation", "%"],
      ["cpi-index", "Inflation", "index"],
      ["fx-eur", "Exchange rates", "PLN"],
      ["fx-usd", "Exchange rates", "PLN"],
    ]);
    expect(body[0]!.latest!.date >= "2026-08").toBe(true);
    for (const fx of body.slice(2)) {
      expect(fx.latest!.value).toBeGreaterThan(3);
      expect(fx.latest!.value).toBeLessThan(6);
      expect(fx.yearAgo!.date <= `${Number(fx.latest!.date.slice(0, 4)) - 1}${fx.latest!.date.slice(4)}`).toBe(true);
    }
  });

  it("GET /indicators/{id} gives one series in a range, oldest first", async () => {
    const mom = (await get<{ date: string; value: number }[]>("/indicators/cpi-mom?from=2003-01-01&to=2026-08-31")).body;
    expect(mom[0]).toEqual({ date: "2003-07", value: -0.4 }); // the index starts in July 2003
    expect(mom.find((p) => p.date === "2026-08")).toEqual({ date: "2026-08", value: 0.3 });
    const index = (await get<{ date: string; value: number }[]>("/indicators/cpi-index?from=2026-08-01&to=2026-08-31")).body;
    expect(index).toEqual([{ date: "2026-08", value: 215.26519 }]);
    const eur = (await get<{ date: string; value: number }[]>("/indicators/fx-eur?from=2002-01-01&to=2002-01-10")).body;
    expect(eur[0]).toEqual({ date: "2002-01-02", value: 3.5496 }); // NBP table 1/A/NBP/2002, the first of the series
    expect((await get("/indicators/nope")).status).toBe(404);
    expect((await get("/indicators/fx-gbp")).status).toBe(404);
  });

  it("POST/PUT/DELETE /transactions add, edit and delete a transaction from the form, checking it first", async () => {
    // Dated far ahead in its own account: no valuation day covers it, so the other figures don't move meanwhile.
    type Tx = { id: string; account: string; date: string; type: string; amount: number; source: string; isin?: string };
    const bad = await send<{ error: string }>("POST", "/transactions", { date: "2099-01-02", account: "api-test", type: "BUY", quantity: 1, amount: -10 });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toContain("BUY needs an instrument");
    expect((await send<{ error: string }>("POST", "/transactions", { date: "2099-01-02", account: "api-test", type: "BUY", isin: "PL0000999999", quantity: 1, amount: -10 })).body.error).toContain("Unknown instrument");
    expect((await send<{ error: string }>("POST", "/transactions", { date: "2099-01-02", account: "api-test", type: "DEPOSIT", amount: -10 })).body.error).toContain("money in");
    expect((await send("POST", "/transactions", { date: "2099-13-45", account: "api-test", type: "DEPOSIT", amount: 10 })).status).toBe(400);
    expect((await send<{ error: string }>("POST", "/transactions", { date: "2099-01-02", account: "api-test", type: "EXCHANGE", amount: -10, currency: "EUR", toAmount: 11, toCurrency: "EUR" })).body.error).toContain("must differ");
    expect((await send<{ error: string }>("POST", "/transactions", { date: "2099-01-02", account: "api-test", type: "EXCHANGE", amount: -10, currency: "EUR" })).body.error).toContain("needs what came in");

    const created = await send<Tx>("POST", "/transactions", { date: "2099-01-02", account: "api-test", type: "DEPOSIT", amount: 100, note: "integration test" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ account: "api-test", date: "2099-01-02", type: "DEPOSIT", amount: 100, currency: "PLN", source: "app" });
    const id = created.body.id;
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    const mine = async () => (await get<Tx[]>("/transactions")).body.filter((t) => t.account === "api-test");
    expect(await mine()).toEqual([expect.objectContaining({ id, amount: 100 })]);

    // Editing keeps the id; a new date moves it (the old row is gone).
    const edited = await send<Tx>("PUT", `/transactions/${id}?account=api-test`, { date: "2099-01-03", account: "api-test", type: "DEPOSIT", amount: 150 });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ id, date: "2099-01-03", amount: 150, source: "app" });
    expect(await mine()).toEqual([expect.objectContaining({ id, date: "2099-01-03", amount: 150 })]);

    expect((await send("DELETE", `/transactions/${id}?account=api-test`)).status).toBe(200);
    expect(await mine()).toEqual([]);
    expect((await send("DELETE", `/transactions/${id}?account=api-test`)).status).toBe(404);
    expect((await send("PUT", "/transactions/0000000000000000?account=api-test", { date: "2099-01-03", account: "api-test", type: "DEPOSIT", amount: 1 })).status).toBe(404);
  });

  it("GET /instruments/lookup finds a tracked instrument or proposes a treasury series; POST /instruments checks its input", async () => {
    type Lookup = { tracked: boolean; instrument: { isin: string; code: string; name: string; type: string; terms?: unknown; sourceIds: Record<string, string> } };
    const tracked = await get<Lookup>("/instruments/lookup?code=edo0935");
    expect(tracked.body).toMatchObject({ tracked: true, instrument: { code: "EDO0935", type: "BOND_RETAIL" } });
    // Not tracked: a retail series from the Ministry file, a listed one from the MF calculator.
    const retail = await get<Lookup>("/instruments/lookup?code=EDO1036");
    expect(retail.status).toBe(200);
    expect(retail.body).toMatchObject({ tracked: false, instrument: { code: "EDO1036", type: "BOND_RETAIL", terms: "mf-retail", name: "Obligacje skarbowe EDO1036 (emerytalne 10-letnie)" } });
    expect(retail.body.instrument.isin).toMatch(/^PL0000\d{6}$/);
    const listed = await get<Lookup>("/instruments/lookup?code=DS1035");
    expect(listed.body).toMatchObject({ tracked: false, instrument: { code: "DS1035", type: "BOND_LISTED", terms: "mf", sourceIds: { gpw: "DS1035" } } });
    expect(listed.body.instrument.name).toMatch(/^Obligacje skarbowe DS1035 \(stałe/);
    expect((await get("/instruments/lookup?code=NOPE123")).status).toBe(404);

    expect((await send("POST", "/instruments", { isin: "XX", code: "X" })).status).toBe(400);
    const dup = await send<{ error: string }>("POST", "/instruments", { isin: DS, code: "DS0432", name: "DS0432", type: "BOND_LISTED", terms: "mf", sourceIds: { gpw: "DS0432" } });
    expect(dup.status).toBe(409);
    // From the form: a kind and a few fields, completed by the server.
    expect((await send<{ error: string }>("POST", "/instruments", { kind: "treasury", code: "DS0432" })).status).toBe(409);
    expect((await send<{ error: string }>("POST", "/instruments", { kind: "treasury", code: "NOPE123" })).body.error).toContain("no such treasury series");
    expect((await send<{ error: string }>("POST", "/instruments", { kind: "etf", isin: "IE00B3RBWM25", ticker: "XYZ:VWRL", name: "x", currency: "EUR" })).body.error).toContain("Unknown exchange");
    expect((await send("POST", "/instruments", { kind: "corporate", code: "X" })).status).toBe(400);
  });

  it("requires a login: no token or a forged token gets 401", async () => {
    for (const route of ["/holdings", "/transactions", "/prices", "/status", `/instruments/${IZ}/prices`, `/holdings/history?isin=${DS}`, "/indicators", "/indicators/fx-eur", "/accounts"]) {
      expect((await get(route, { auth: false })).status, route).toBe(401);
    }
    for (const [method, route] of [["POST", "/transactions"], ["PUT", "/transactions/x?account=a"], ["DELETE", "/transactions/x?account=a"], ["POST", "/instruments"]] as const) {
      expect((await fetch(API + route, { method, body: method === "DELETE" ? undefined : "{}" })).status, `${method} ${route}`).toBe(401);
    }
    const forged = ["eyJhbGciOiJSUzI1NiJ9", "eyJzdWIiOiJ4IiwiY29nbml0bzpncm91cHMiOlsicG9ydGZvbGlvLXRyYWNrZXIiXX0", "c2ln"].join(".");
    expect((await get("/holdings", { token: forged })).status).toBe(401);
  });

  it("rejects bad input", async () => {
    expect((await get("/instruments/not-an-isin/prices")).status).toBe(400);
    expect((await get("/nope")).status).toBe(404);
  });
});
