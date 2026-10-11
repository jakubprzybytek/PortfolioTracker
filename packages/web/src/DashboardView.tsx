import { useEffect, useMemo, useState } from "react";
import { fmtPct, fmtPln, rangeFrom, signClass, today, type RangeKey } from "./format.ts";
import { HoldingsTable } from "./HoldingsTable.tsx";
import { PortfolioChart } from "./PortfolioChart.tsx";
import { PriceChart } from "./PriceChart.tsx";
import { RangePicker } from "./RangePicker.tsx";
import type { HistoryPoint, Holding, Instrument, Price, Snapshot, Status, Transaction } from "./types.ts";
import { useApi } from "./useApi.ts";

function Card({ label, value, className, testId }: { label: string; value: string; className?: string; testId: string }) {
  return (
    <div className="card" data-testid={testId}>
      <div className="label">{label}</div>
      <div className={`value ${className ?? ""}`}>{value}</div>
    </div>
  );
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const sumOrNull = (a: number | null, b: number | null) => (a === null || b === null ? null : round2(a + b));

/** One row per instrument across accounts (the Holdings view shows them per account). */
export function aggregateByInstrument(holdings: Holding[]): Holding[] {
  const byIsin = new Map<string, Holding>();
  for (const h of holdings) {
    const seen = byIsin.get(h.isin);
    if (!seen) {
      byIsin.set(h.isin, { ...h, flags: [...h.flags] });
      continue;
    }
    seen.quantity += h.quantity;
    seen.value = sumOrNull(seen.value, h.value);
    seen.cost = round2(seen.cost + h.cost);
    seen.gain = sumOrNull(seen.gain, h.gain);
    seen.couponsReceived = round2(seen.couponsReceived + h.couponsReceived);
    seen.gainPct = seen.gain === null || seen.cost === 0 ? null : round2((seen.gain / seen.cost) * 100);
    for (const f of h.flags) if (!seen.flags.includes(f)) seen.flags.push(f);
  }
  return [...byIsin.values()];
}

export function DashboardView() {
  const [range, setRange] = useState<RangeKey>("1Y");
  const [priceRange, setPriceRange] = useState<RangeKey>("1Y");
  const [selected, setSelected] = useState<string | null>(null);

  const holdings = useApi<Snapshot>("/holdings");
  const history = useApi<HistoryPoint[]>("/portfolio/history", { from: rangeFrom(range), to: today() }, [range]);
  const instruments = useApi<Instrument[]>("/instruments");
  const status = useApi<Status>("/status");
  const prices = useApi<Price[]>(selected ? `/instruments/${selected}/prices` : null, { from: rangeFrom(priceRange), to: today() }, [selected, priceRange]);
  const transactions = useApi<Transaction[]>(selected ? `/instruments/${selected}/transactions` : null, {}, [selected]);

  const snap = holdings.data;
  const rows = useMemo(() => aggregateByInstrument(snap?.holdings ?? []), [snap]);

  useEffect(() => {
    if (!selected && rows[0]) setSelected(rows[0].isin);
  }, [rows, selected]);

  const totals = snap?.totals;
  const selectedInst = instruments.data?.find((i) => i.isin === selected);
  const failedJobs = Object.entries(status.data?.jobs ?? {}).filter(([, j]) => j?.status === "failed");

  return (
    <>
      <header className="view-header">
        <h2 className="view-title">Dashboard</h2>
        <span className="muted" data-testid="snapshot-date">
          {snap ? `Valuation as of ${snap.date}` : holdings.loading ? "Loading…" : holdings.error ?? ""}
        </span>
      </header>

      {holdings.error && !holdings.loading && (
        <p className="error" data-testid="holdings-error">
          {holdings.error}
        </p>
      )}
      {failedJobs.length > 0 && (
        <p className="error" data-testid="job-errors">
          Failed jobs: {failedJobs.map(([name, j]) => `${name} (${j?.finishedAt?.slice(0, 16)}): ${j?.note ?? ""}`).join("; ")}
        </p>
      )}

      <section className="cards" data-testid="totals">
        <Card label="Value" value={fmtPln(totals?.value)} testId="total-value" />
        <Card label="Cost" value={fmtPln(totals?.cost)} testId="total-cost" />
        <Card label="Gain" value={`${fmtPln(totals?.gain)}${totals && totals.cost ? ` (${fmtPct((totals.gain / totals.cost) * 100)})` : ""}`} className={signClass(totals?.gain)} testId="total-gain" />
        <Card label="Coupons received" value={fmtPln(totals?.couponsReceived)} testId="total-coupons" />
      </section>

      <h2>Portfolio value</h2>
      <RangePicker value={range} onChange={setRange} testId="portfolio-range" />
      {history.error ? <p className="error">{history.error}</p> : <PortfolioChart history={history.data ?? []} />}

      <h2>Holdings</h2>
      <HoldingsTable holdings={rows} selected={selected} onSelect={setSelected} />

      {selected && (
        <>
          <h2 data-testid="price-title">
            {selectedInst?.code ?? rows.find((h) => h.isin === selected)?.code ?? selected}{" "}
            <span className="muted" style={{ fontWeight: 400 }}>
              {selectedInst?.name} · clean price, % of nominal
              {selectedInst?.backfill && selectedInst.backfill.status !== "done" ? ` · history: ${selectedInst.backfill.status}` : ""}
            </span>
          </h2>
          <RangePicker value={priceRange} onChange={setPriceRange} testId="price-range" />
          {prices.error ? <p className="error">{prices.error}</p> : <PriceChart prices={prices.data ?? []} transactions={transactions.data ?? []} />}
        </>
      )}

      <h2>Jobs</h2>
      <div className="table-wrap">
        <table data-testid="jobs-table">
          <thead>
            <tr>
              <th className="left">Job</th>
              <th className="left">Last run</th>
              <th className="left">Status</th>
              <th className="left">Note</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(status.data?.jobs ?? {}).map(([name, j]) => (
              <tr key={name}>
                <td className="left">{name}</td>
                <td className="left muted">{j?.finishedAt?.replace("T", " ").slice(0, 16) ?? "never"}</td>
                <td className={`left ${j?.status === "failed" ? "neg" : j ? "pos" : "muted"}`}>{j?.status ?? "–"}</td>
                <td className="left muted" style={{ whiteSpace: "normal", maxWidth: 600 }}>
                  {j?.note ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
