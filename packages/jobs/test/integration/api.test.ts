import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { settlementDate, type HoldingSnapshot, type SnapshotItem } from "@portfolio/core";
import { API, get, repoRoot, send, uploadImport, waitFor } from "./setup.ts";

const IZ = "PL0000117024";
const DS = "PL0000113783";
const SPXS = "IE00B3YCGJ38"; // sample ETF (EUR, Yahoo), split 100:1 on 2025-12-15
const KRU = "PLKRK0000713"; // sample Catalyst corporate bond KRU0827 (BiznesRadar), nominal 100
const BUND = "DE0001102523"; // sample foreign bond at IBKR: calculated prices
const EUR_CASH = "ZZWALUTYEUR0";

/** The sample's coupon periods of KRU (data/coupons.sample.json). */
const samplePeriods = JSON.parse(readFileSync(path.join(repoRoot, "data/coupons.sample.json"), "utf8")) as { start: string; end: string; recordDate: string; rate: number }[];

/** `date` moved by `days` (ISO dates). */
const addDaysIso = (date: string, days: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

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
    // 2b. The corporate bond's coupon periods (public dates of KRU0827, rates made up).
    await uploadImport("coupons", "sample.json", readFileSync(path.join(repoRoot, "data/coupons.sample.json")));
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
      // The corporate bond valued with its sample coupon periods (imported just before).
      const kru = r.body.holdings.find((h) => h.code === "KRU0827");
      const periods = samplePeriods.some((p) => p.start <= r.body.date && r.body.date < p.end) ? kru?.accruedInterest != null : true;
      return codes.has("DS0432") && codes.has("IZ0836") && codes.has("EDO0935") && codes.has("SAMPLE-APARTMENT") && etf && periods && ike === 99.49 && r.body.accounts?.["closed"] && r.body.accounts?.["eur"] && clean ? true : undefined; // "closed", "eur": the latest sample rows
    }, 420_000); // revaluations run one at a time (queued), each up to a minute
    // The NBP import (EUR and USD back to 2002) writes rates as it goes; wait for the run to finish.
    await waitFor(async () => ((await get<{ jobs: Record<string, { status: string } | null> }>("/status")).body.jobs["fx"]?.status === "ok" ? true : undefined), 300_000);
  });

  it("GET /status lists the last run of every job", async () => {
    const { status, body } = await get<{ now: string; jobs: Record<string, unknown> }>("/status");
    expect(status).toBe(200);
    expect(Object.keys(body.jobs).sort()).toEqual(["backfill", "benchmarks", "coupons", "eod-bonds", "eod-catalyst", "eod-etf", "eod-gpw", "eod-gpw-recheck", "export", "fx", "import", "live", "monthly", "quality", "valuation"]);
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
    // An IZ bond also carries its indexed nominal per bond (1000 × the MF index ratio of 2026-10-09: 1.10553)
    expect((body.at(-1) as { nominal?: number }).nominal).toBe(1105.53);
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
    // Catalyst corporate bond: clean price (% of nominal) x nominal 100, plus accrued interest from the sample periods
    // (ACT/365, to the settlement day T+2; from the record day the whole coupon); the coupon counts as received.
    const kru = by["bonds/KRU0827"]!;
    expect(kru).toMatchObject({ type: "BOND_CORPORATE", quantity: 40, nominal: 100, cost: 4056.1, couponsReceived: 70 });
    expect(kru.cleanPrice!).toBeGreaterThan(90);
    const settle = settlementDate(snap.date);
    const period = samplePeriods.find((p) => p.start <= settle && settle < p.end);
    if (period) {
      const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
      const accrued = Math.round(100 * period.rate * (settle >= period.recordDate ? days(period.start, period.end) : days(period.start, settle)) / 365 * 100) / 100;
      expect(kru).toMatchObject({ accruedInterest: accrued, flags: [], rate: { current: period.rate } });
      expect(kru.value!).toBeCloseTo(40 * (kru.cleanPrice! + accrued), 1);
    } else expect(kru).toMatchObject({ accruedInterest: null, flags: ["no_coupon_rate"] }); // after the sample's last period
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

  it("GET /holdings gives each position's own cash flows (PLN, one a day) for its XIRR", async () => {
    const r = await get<SnapshotItem & { flows: Record<string, [string, number][]> }>("/holdings");
    expect(r.status).toBe(200);
    // DS0432 at broker: bought with its fee, two coupons; at IKE the same bond is its own position.
    expect(r.body.flows["broker|PL0000113783"]).toEqual([["2025-02-05", -15931.8], ["2025-04-28", 350], ["2026-04-27", 350]]);
    expect(r.body.flows["ike|PL0000113783"]).toEqual([["2026-05-15", -4013.01]]);
    // The hand-valued asset: its buy and the income booked on it.
    expect(r.body.flows["ike|ZZSAMPLEAPA0"]).toEqual([["2026-06-01", -900], ["2026-09-30", 12.5]]);
    // Every held position has flows, its first one a buy.
    for (const h of r.body.holdings) expect(r.body.flows[`${h.account}|${h.isin}`]![0]![1]).toBeLessThan(0);
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
    // per asset class: the bond bought, the rest cash; together the total
    const byClass = (body[2] as unknown as { byClass: Record<"SHARES" | "BONDS" | "CASH" | "OTHER", number> }).byClass;
    expect(byClass.BONDS).toBeCloseTo(body[2]!.totals.value, 1);
    expect(byClass.SHARES + byClass.BONDS + byClass.CASH + byClass.OTHER).toBeCloseTo(body[2]!.total, 1);
  });

  it("GET /portfolio/years gives each year's return against inflation, and the whole history's", async () => {
    type Period = { year: number | null; from: string; to: string; partial: boolean; startValue: number; netDeposits: number; endValue: number; profit: number; twr: number | null; xirr: number | null; inflation: number | null; real: number | null; cpiThrough: string | null };
    const { status, body } = await get<{ years: Period[]; total: Period & { twrPerYear: number | null }; cpi: { month: string; level: number }[] }>("/portfolio/years");
    expect(status).toBe(200);
    // The sample starts on 2025-02-03: 2025 from then (part of a year), then the years after it, newest first.
    const [first, ...rest] = [...body.years].reverse();
    expect(first).toMatchObject({ year: 2025, from: "2025-02-03", partial: true, startValue: 0 });
    expect(body.years[0]!.partial).toBe(true); // the year so far
    let chained = 1;
    let prev = first!;
    for (const y of [first!, ...rest]) {
      if (y !== first) expect(y).toMatchObject({ from: `${y.year! - 1}-12-31`, startValue: prev.endValue });
      expect(y.profit).toBeCloseTo(y.endValue - y.startValue - y.netDeposits, 1);
      expect(y.twr).not.toBeNull();
      expect(y.inflation).not.toBeNull(); // CPI since 2003 (the IZ reference index), GUS's since-December figures where there
      expect(y.real!).toBeCloseTo((1 + y.twr!) / (1 + y.inflation!) - 1, 4);
      chained *= 1 + y.twr!;
      prev = y;
    }
    // The years chain into the whole history; its XIRR is the Dashboard's (deposits, withdrawals and today's total).
    expect(body.total).toMatchObject({ year: null, from: "2025-02-03", startValue: 0, endValue: body.years[0]!.endValue });
    expect(1 + body.total.twr!).toBeCloseTo(chained, 4);
    const accounts = (await get<{ total: { xirr: number | null } }>("/accounts")).body;
    expect(body.total.xirr!).toBeCloseTo(accounts.total.xirr!, 2);
    // CPI levels from the month before the first day, for the growth of 100 zł chart
    expect(body.cpi[0]!.month).toBe("2025-01");
    // The benchmarks, in PLN from a fortnight before the first day (empty until the stage's benchmarks job has run)
    const benchmarks = (body as unknown as { benchmarks: { id: string; points: { date: string; value: number }[] }[] }).benchmarks;
    expect(benchmarks.map((b) => b.id)).toEqual(["WIG", "MSCI_WORLD", "MIX_40_60"]);
    for (const b of benchmarks) {
      expect(b.points.every((p, i) => p.value > 0 && p.date >= "2025-01-20" && (i === 0 || p.date > b.points[i - 1]!.date))).toBe(true);
    }
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

  it("?closed=1 adds what's held no more: none in the sample (every position is open), the rest unchanged", async () => {
    const [plain, closed] = await Promise.all([get<SnapshotItem>("/holdings"), get<SnapshotItem & { closed: unknown[] }>("/holdings?closed=1")]);
    expect(closed.status).toBe(200);
    expect(closed.body.closed).toEqual([]);
    expect(closed.body.holdings).toEqual(plain.body.holdings);
    const prices = await get<{ code: string; closed?: unknown }[]>("/prices?closed=1");
    expect(prices.status).toBe(200);
    expect(prices.body.map((r) => r.code)).toEqual(["DE0001102523", "DS0432", "EDO0935", "IZ0836", "KRU0827", "SAMPLE-APARTMENT", "SPXS"]);
    expect(prices.body.some((r) => r.closed)).toBe(false);
  });

  it("GET /sales: none in the sample (ibkr's EUR spent on a bond is foreign cash, not a sale), so no PIT-38 years", async () => {
    const { status, body } = await get<{ sales: unknown[]; years: unknown[] }>("/sales");
    expect(status).toBe(200);
    expect(body).toEqual({ sales: [], years: [] });
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
      ["cpi-yoy", "Inflation", "%"],
      ["cpi-annual", "Inflation", "%"],
      ["cpi-ytd", "Inflation", "%"],
      ["cpi-mom", "Inflation", "%"],
      ["cpi-index", "Inflation", "index"],
      ["fx-eur", "Exchange rates", "PLN"],
      ["fx-usd", "Exchange rates", "PLN"],
    ]);
    for (const cpi of body.slice(0, 5)) expect(cpi.latest!.date >= "2025").toBe(true);
    expect(body[0]!.latest!.date >= "2026-08").toBe(true);
    // a year's inflation: its year a year earlier
    expect(body[1]!.yearAgo!.date).toBe(String(Number(body[1]!.latest!.date) - 1));
    for (const fx of body.slice(5)) {
      expect(fx.latest!.value).toBeGreaterThan(3);
      expect(fx.latest!.value).toBeLessThan(6);
      expect(fx.yearAgo!.date <= `${Number(fx.latest!.date.slice(0, 4)) - 1}${fx.latest!.date.slice(4)}`).toBe(true);
    }
  });

  it("GET /indicators/{id} gives one series in a range, oldest first", async () => {
    const mom = (await get<{ date: string; value: number }[]>("/indicators/cpi-mom?from=2003-01-01&to=2026-08-31")).body;
    expect(mom[0]).toEqual({ date: "2003-07", value: -0.4 }); // the index starts in July 2003
    expect(mom.find((p) => p.date === "2026-08")).toEqual({ date: "2026-08", value: 0.3 });
    // GUS's own figures: 12 months, per year (December on December, by year), since December
    expect((await get<{ date: string; value: number }[]>("/indicators/cpi-yoy?from=2026-08-01&to=2026-08-31")).body).toEqual([{ date: "2026-08", value: 3.4 }]);
    expect((await get<{ date: string; value: number }[]>("/indicators/cpi-annual?from=2022-01-01&to=2025-12-31")).body).toEqual([
      { date: "2022", value: 16.6 },
      { date: "2023", value: 6.2 },
      { date: "2024", value: 4.7 },
      { date: "2025", value: 2.4 },
    ]);
    expect((await get<{ date: string; value: number }[]>("/indicators/cpi-ytd?from=2026-08-01&to=2026-08-31")).body).toEqual([{ date: "2026-08", value: 3 }]);
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

  it("a position that's gone after a deletion loses its daily history (row chart) too", async () => {
    // A recent buy in an account of its own: the revaluation from that day is short.
    const day = (await get<SnapshotItem>("/holdings")).body.date;
    const date = addDaysIso(day, -3);
    const history = async () => (await get<{ date: string }[]>(`/holdings/history?isin=${DS}&account=api-test-pos&from=${date}&to=${day}`)).body;
    const created = await send<{ id: string }>("POST", "/transactions", { date, account: "api-test-pos", type: "BUY", isin: DS, quantity: 1, price: 100, amount: -1000, note: "integration test" });
    expect(created.status).toBe(201);
    try {
      expect((await waitFor(async () => ((await history()).length > 0 ? await history() : undefined), 180_000))[0]!.date).toBe(date);
    } finally {
      expect((await send("DELETE", `/transactions/${created.body.id}?account=api-test-pos`)).status).toBe(200);
    }
    await waitFor(async () => ((await history()).length === 0 ? true : undefined), 180_000);
  }, 400_000);

  it("POST/DELETE /instruments/{isin}/prices record and remove a value of a hand-valued asset, checking it first", async () => {
    // Dated before the sample's latest value (950 on 2026-09-30), so today's valuation doesn't change meanwhile.
    const APT = "ZZSAMPLEAPA0";
    const values = async () => (await get<{ date: string; close: number; venue: string }[]>(`/instruments/${APT}/prices?from=2026-01-01&to=2026-12-31`)).body;
    expect((await send<{ error: string }>("POST", `/instruments/${DS}/prices`, { date: "2026-07-15", price: 99 })).body.error).toContain("price source");
    expect((await send("POST", `/instruments/${APT}/prices`, { date: "2099-01-01", price: 920 })).status).toBe(400);
    expect((await send("POST", `/instruments/${APT}/prices`, { date: "2026-02-30", price: 920 })).status).toBe(400);
    expect((await send("POST", `/instruments/${APT}/prices`, { date: "2026-07-15", price: 0 })).status).toBe(400);

    const created = await send<{ date: string; close: number; venue: string; source: string }>("POST", `/instruments/${APT}/prices`, { date: "2026-07-15", price: 920 });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ date: "2026-07-15", close: 920, venue: "MANUAL", source: "app" });
    expect((await values()).map((p) => [p.date, p.close])).toEqual([
      ["2026-06-01", 900],
      ["2026-07-15", 920],
      ["2026-09-30", 950],
    ]);

    expect((await send("DELETE", `/instruments/${APT}/prices/2026-07-15`)).status).toBe(200);
    expect((await values()).map((p) => p.date)).toEqual(["2026-06-01", "2026-09-30"]);
    expect((await send("DELETE", `/instruments/${APT}/prices/2026-07-15`)).status).toBe(404);
    expect((await send("DELETE", `/instruments/${DS}/prices/2026-07-15`)).status).toBe(400);
  });

  it("PUT /instruments/{isin}/asset-class sets an instrument's class by hand (revalued), and the rule's class clears it", async () => {
    type Row = { isin: string; assetClass: string; assetClassSet?: boolean };
    const spxsHolding = async () => (await get<SnapshotItem>("/holdings")).body.holdings.find((h) => h.isin === SPXS);
    expect((await send("PUT", `/instruments/${SPXS}/asset-class`, { assetClass: "GOLD" })).status).toBe(400);
    expect((await send("PUT", `/instruments/ZZNOSUCHONE0/asset-class`, { assetClass: "OTHER" })).status).toBe(404);
    expect((await get<Row[]>("/prices")).body.find((r) => r.isin === SPXS)).toMatchObject({ assetClass: "SHARES" });

    const set = await send<{ assetClass: string; set: boolean }>("PUT", `/instruments/${SPXS}/asset-class`, { assetClass: "OTHER" });
    expect(set.body).toEqual({ isin: SPXS, assetClass: "OTHER", set: true });
    expect((await get<Row[]>("/prices")).body.find((r) => r.isin === SPXS)).toMatchObject({ assetClass: "OTHER", assetClassSet: true });
    // The valuation writes it into the holding, and the allocation over time counts the ETF as other.
    await waitFor(async () => ((await spxsHolding())?.assetClass === "OTHER" ? true : undefined), 180_000);
    const day = (await get<SnapshotItem>("/holdings")).body.date;
    const [point] = (await get<{ byClass: Record<string, number> }[]>(`/portfolio/history?from=${day}&to=${day}`)).body;
    expect(point!.byClass["OTHER"]).toBeGreaterThanOrEqual((await spxsHolding())!.value! - 0.01);

    // The rule's class again: no longer set by hand.
    expect((await send<{ set: boolean }>("PUT", `/instruments/${SPXS}/asset-class`, { assetClass: "SHARES" })).body).toMatchObject({ assetClass: "SHARES", set: false });
    expect((await get<Row[]>("/prices")).body.find((r) => r.isin === SPXS)).not.toHaveProperty("assetClassSet");
    await waitFor(async () => ((await spxsHolding())?.assetClass === undefined ? true : undefined), 180_000);
  });

  it("GET/POST/PUT/DELETE /instruments/{isin}/coupons list a corporate bond's periods with the coupons received, and change them", async () => {
    const list = async () => (await get<{ nominal: number; periods: { start: string; end: string; rate?: number; rateSource?: string; datesSource: string }[]; coupons: { start: string; checks: { gross: number; quantity: number; mismatch?: boolean; taxAssumed: boolean }[]; suggestedRate?: number }[] }>(`/instruments/${KRU}/coupons`)).body;
    const before = await list();
    expect(before.nominal).toBe(100);
    expect(before.periods.find((p) => p.start === "2026-02-12")).toMatchObject({ end: "2026-05-12", rate: 0.0886, rateSource: "manual" });
    // The sample's coupon (70 after an assumed 19 % tax = 86.42 for 40 bonds) fits the period's 8.86 %.
    expect(before.coupons.find((c) => c.start === "2026-02-12")).toMatchObject({ checks: [{ gross: 86.42, quantity: 40, mismatch: false, taxAssumed: true }], suggestedRate: 0.0886 });

    // Far in the future, so today's value doesn't change meanwhile.
    expect((await send("POST", `/instruments/${DS}/coupons`, { start: "2031-01-01", end: "2031-04-01", paymentDate: "2031-04-01" })).status).toBe(400); // not a corporate bond
    expect((await send("POST", `/instruments/${KRU}/coupons`, { start: "2031-04-01", end: "2031-01-01", paymentDate: "2031-04-01" })).status).toBe(400);
    expect((await send("POST", `/instruments/${KRU}/coupons`, { start: "2031-01-01", end: "2031-04-01", paymentDate: "2031-04-01", recordDate: "2030-12-01" })).status).toBe(400);
    const created = await send<{ start: string; datesSource: string; rate?: number }>("POST", `/instruments/${KRU}/coupons`, { start: "2031-01-01", end: "2031-04-01", recordDate: "2031-03-24", paymentDate: "2031-04-01" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ start: "2031-01-01", datesSource: "manual" });
    expect(created.body.rate).toBeUndefined();
    expect((await send("POST", `/instruments/${KRU}/coupons`, { start: "2031-02-01", end: "2031-05-01", paymentDate: "2031-05-01" })).status).toBe(400); // overlaps
    const edited = await send<{ rate: number; rateSource: string; datesSource: string }>("PUT", `/instruments/${KRU}/coupons/2031-01-01`, { rate: 0.0735 });
    expect(edited.body).toMatchObject({ rate: 0.0735, rateSource: "manual", datesSource: "manual" });
    expect((await list()).periods.find((p) => p.start === "2031-01-01")).toMatchObject({ rate: 0.0735 });
    expect((await send("PUT", `/instruments/${KRU}/coupons/2031-01-01`, { rate: 5 })).status).toBe(400); // a fraction, not %
    expect((await send("DELETE", `/instruments/${KRU}/coupons/2031-01-01`)).status).toBe(200);
    expect((await list()).periods.some((p) => p.start === "2031-01-01")).toBe(false);
    expect((await send("DELETE", `/instruments/${KRU}/coupons/2031-01-01`)).status).toBe(404);
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

  it("a body that isn't JSON is a 400 with a plain message, not a 500", async () => {
    for (const [method, route] of [["POST", "/transactions"], ["POST", "/notes"], ["POST", "/instruments"]] as const) {
      const r = await send<{ error: string }>(method, route, undefined, { raw: "{not json" });
      expect(r.status, route).toBe(400);
      expect(r.body.error, route).toBe("The request body isn't valid JSON");
    }
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

  it("GET/POST/PUT/DELETE /notes keep Markdown notes, the last changed first, checking them first", async () => {
    type Note = { id: string; title: string; body: string; createdAt: string; updatedAt: string };
    expect((await send("POST", "/notes", { title: " ", body: "x" })).status).toBe(400);
    expect((await send("POST", "/notes", { body: "no title" })).status).toBe(400);
    const a = await send<Note>("POST", "/notes", { title: "Integration A", body: "# Heading\n\n- one" });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ title: "Integration A", body: "# Heading\n\n- one" });
    const b = await send<Note>("POST", "/notes", { title: "Integration B", body: "" });
    expect(b.status).toBe(201);
    const edited = await send<Note>("PUT", `/notes/${a.body.id}`, { title: "Integration A2", body: "changed" });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ id: a.body.id, title: "Integration A2", body: "changed", createdAt: a.body.createdAt });
    expect(edited.body.updatedAt >= a.body.updatedAt).toBe(true);
    const list = (await get<Note[]>("/notes")).body.filter((n) => n.title.startsWith("Integration"));
    expect(list.map((n) => n.title)).toEqual(["Integration A2", "Integration B"]);
    expect((await send("PUT", "/notes/nonexistent", { title: "x", body: "" })).status).toBe(404);
    for (const n of [a.body, b.body]) expect((await send("DELETE", `/notes/${n.id}`)).status).toBe(200);
    expect((await send("DELETE", `/notes/${a.body.id}`)).status).toBe(404);
    expect((await get<Note[]>("/notes")).body.some((n) => n.title.startsWith("Integration"))).toBe(false);
  });

  it("GET /hold-sell compares every bond position kept to maturity with selling it today; PUT keeps the assumptions", async () => {
    type Row = { account: string; code: string; maturity: string; taxFree: boolean; verdict: string; flows: { date: string; kind: string; amount: number }[]; sellNow: { net: number }; alternative: { label: string; series?: string; yield: number }; difference: number; holdAtMaturity: number; sellAtMaturity: number };
    type Body = { date: string; assumptions: { cpi: number; alternative: string }; saved: boolean; offers: { series: string }[]; rows: Row[]; skipped: { code: string; reason: string }[] };
    await send("PUT", "/hold-sell/assumptions", { reset: true });
    const { status, body } = await get<Body>("/hold-sell");
    expect(status).toBe(200);
    expect(body.saved).toBe(false);
    expect(body.assumptions.alternative).toBe("retail");
    // Every bond of the sample: listed fixed and IZ, retail, the floating corporate, the IBKR Bund.
    expect(body.rows.map((r) => r.code).sort()).toEqual(expect.arrayContaining(["DE0001102523", "DS0432", "EDO0935", "IZ0836", "KRU0827"]));
    for (const r of body.rows) {
      expect(["HOLD", "SELL", "EVEN"]).toContain(r.verdict);
      expect(r.flows.at(-1)).toMatchObject({ kind: "redemption", date: r.maturity });
      expect(r.sellNow.net).toBeGreaterThan(0);
      expect(r.difference).toBeCloseTo(r.holdAtMaturity - r.sellAtMaturity, 0);
      if (body.offers.length) expect(r.alternative.series).toBeTruthy();
    }
    expect(body.rows.find((r) => r.account === "ike")?.taxFree ?? true).toBe(true);
    // Buy more: one more bond of each held at its last price; retail rows are the series on offer, one per account and kind.
    const buy = (body as unknown as { buy: { code: string; type: string; netYield: number; grossYield: number | null; realYield: number; spread: number | null; offerSeries?: string; weight: number | null }[] }).buy;
    expect(buy.map((b) => b.code)).toEqual(expect.arrayContaining(["DS0432", "IZ0836", "KRU0827"]));
    expect(buy.map((b) => b.netYield)).toEqual([...buy.map((b) => b.netYield)].sort((x, y) => y - x));
    for (const b of buy) {
      expect(b.netYield).toBeGreaterThan(-0.5);
      if (b.type === "BOND_RETAIL") expect(b.offerSeries).toBe(b.code);
      else expect(b.netYield).toBeLessThanOrEqual(b.grossYield! + 1e-9);
    }

    expect((await send("PUT", "/hold-sell/assumptions", { cpi: "a lot" })).status).toBe(400);
    const put = await send("PUT", "/hold-sell/assumptions", { cpi: 0.03, wibor: 0.05, nbpRate: 0.04, alternative: "rate", altRate: 0.06 });
    expect(put.status).toBe(200);
    const after = (await get<Body>("/hold-sell")).body;
    expect(after).toMatchObject({ saved: true, assumptions: { cpi: 0.03, alternative: "rate" } });
    const ds = after.rows.find((r) => r.code === "DS0432")!;
    expect(ds.alternative.label).toContain("6,00 %");
    expect(ds.alternative.yield).toBeCloseTo(ds.account === "ike" ? 0.06 : 0.06 * 0.81, 6);
    await send("PUT", "/hold-sell/assumptions", { reset: true });
    expect((await get<Body>("/hold-sell")).body.saved).toBe(false);
  });

  it("PUT /targets keeps the target allocation (adding up to 100 %), GET /targets returns it, reset removes it", async () => {
    type Body = { targets: { targets: Record<string, number>; bands: Record<string, number> } | null };
    await send("PUT", "/targets", { reset: true });
    expect((await get<Body>("/targets")).body.targets).toBeNull();
    const bands = { SHARES: 5, BONDS: 5, CASH: 2, OTHER: 0 };
    expect((await send("PUT", "/targets", { targets: { SHARES: 60, BONDS: 35, CASH: 10, OTHER: 0 }, bands })).status).toBe(400);
    const put = await send("PUT", "/targets", { targets: { SHARES: 60, BONDS: 35, CASH: 5, OTHER: 0 }, bands });
    expect(put.status).toBe(200);
    const { status, body } = await get<Body>("/targets");
    expect(status).toBe(200);
    expect(body.targets).toEqual({ targets: { SHARES: 60, BONDS: 35, CASH: 5, OTHER: 0 }, bands });
    await send("PUT", "/targets", { reset: true });
    expect((await get<Body>("/targets")).body.targets).toBeNull();
  });

  it("rejects bad input", async () => {
    expect((await get("/instruments/not-an-isin/prices")).status).toBe(400);
    expect((await get("/nope")).status).toBe(404);
  });

  // Last: it revalues today with live quotes.
  it("POST /prices/refresh starts the Live job (today's quotes, then the valuation), at most once every 5 minutes", async () => {
    type Live = { status: string; startedAt: string; finishedAt?: string; note?: string };
    const first = await send<{ now?: string; retryAt?: string }>("POST", "/prices/refresh");
    expect([202, 429]).toContain(first.status);
    if (first.status === 202) {
      const run = await waitFor(async () => {
        const r = (await get<{ jobs: Record<string, Live | null> }>("/status")).body.jobs["live"];
        return r?.finishedAt && r.finishedAt > first.body.now! ? r : undefined;
      }, 180_000);
      expect(run).toMatchObject({ status: "ok" });
      expect(run.note).toMatch(/of 4 prices updated/); // the sample's ETF, Catalyst bond and two treasury bonds; the Bund is calculated
    }
    const again = await send<{ error: string; retryAt: string }>("POST", "/prices/refresh");
    expect(again.status).toBe(429);
    expect(again.body.retryAt > new Date().toISOString()).toBe(true);
  });

  it("GET /cash-flows: deposits and withdrawals per account and month of a year, in PLN (EUR at NBP D-1)", async () => {
    expect((await get("/cash-flows", { auth: false })).status).toBe(401);
    expect((await get("/cash-flows?year=25")).status).toBe(400);
    const { status, body } = await get<{ year: number; accounts: { account: string; net: number[]; totals: { deposits: number; withdrawals: number; net: number } }[]; total: { net: number[] }; years: number[] }>("/cash-flows?year=2025");
    expect(status).toBe(200);
    expect(body.year).toBe(2025);
    expect(body.years.slice(-1)).toEqual([2025]);
    const of = (a: string) => body.accounts.find((x) => x.account === a);
    // In use in 2025, by name; "etf" and "bonds" got their first money in 2026.
    expect(body.accounts.map((a) => a.account).filter((a) => !a.startsWith("api-") && !a.startsWith("e2e"))).toEqual(["broker", "closed", "eur", "foreign", "ibkr", "ike"]);
    expect(of("broker")!.net[1]).toBe(30000);
    expect(of("closed")!.net).toEqual([0, 0, 1000, 0, 0, 0, -1020, 0, 0, 0, 0, 0]);
    expect(of("closed")!.totals).toEqual({ deposits: 1000, withdrawals: 1020, net: -20 });
    const eurDec = of("eur")!.net[11]!; // 100 EUR at the NBP mid of 2025-11-28
    expect(eurDec).toBeGreaterThan(400);
    expect(eurDec).toBeLessThan(450);
    expect(body.total.net[1]).toBe(30000);
  });

  it("the spreadsheet feed: a token made in the app reads the CSV; wrong, missing, replaced and revoked tokens get a bare 404", async () => {
    const feed = async (query: string) => {
      const res = await fetch(`${API}/feeds/cash-flows.csv${query}`);
      return { status: res.status, type: res.headers.get("content-type"), cache: res.headers.get("cache-control"), text: await res.text() };
    };
    const made = await send<{ token: string; createdAt: string }>("POST", "/feed-token");
    expect(made.status).toBe(201);
    expect(made.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const state = await get<{ feed: { createdAt: string; lastUsedAt: string | null } | null }>("/cash-flows?year=2025");
    expect(state.body.feed).toEqual({ createdAt: made.body.createdAt, lastUsedAt: null });
    expect(JSON.stringify(state.body)).not.toContain(made.body.token);

    const ok = await feed(`?year=2025&token=${made.body.token}`);
    expect(ok).toMatchObject({ status: 200, type: "text/csv; charset=utf-8", cache: "no-store" });
    const lines = ok.text.trimEnd().split("\r\n");
    expect(lines[0]).toBe("Podsumowanie,styczeń,luty,marzec,kwiecień,maj,czerwiec,lipiec,sierpień,wrzesień,październik,listopad,grudzień,");
    expect(lines[1]).toMatch(/^Bilans wpływów,,30000,/);
    expect(lines).toContain("closed,0,0,1000,0,0,0,-1020,0,0,0,0,0,-20");
    expect((await get<{ feed: { lastUsedAt: string | null } }>("/cash-flows")).body.feed?.lastUsedAt).not.toBeNull();

    for (const q of ["?year=2025", `?year=2025&token=${made.body.token.slice(1)}`, `?year=2025&token=${"A".repeat(43)}`]) expect(await feed(q)).toMatchObject({ status: 404, text: "Not found" });
    expect((await feed(`?year=x&token=${made.body.token}`)).status).toBe(400);

    // A new token replaces the old one at once.
    const next = await send<{ token: string }>("POST", "/feed-token");
    expect((await feed(`?year=2025&token=${made.body.token}`)).status).toBe(404);
    expect((await feed(`?year=2025&token=${next.body.token}`)).status).toBe(200);
    // Revoked: nothing reads it.
    expect((await send("DELETE", "/feed-token")).status).toBe(200);
    expect((await feed(`?year=2025&token=${next.body.token}`)).status).toBe(404);
    expect((await get<{ feed: unknown }>("/cash-flows")).body.feed).toBeNull();
  });
});
