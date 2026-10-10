import { useEffect, useState } from "react";
import { api } from "./api.ts";
import { fmtPct, fmtPln, rangeFrom, signClass, today, type RangeKey } from "./format.ts";
import { HoldingsTable } from "./HoldingsTable.tsx";
import { PortfolioChart } from "./PortfolioChart.tsx";
import { PriceChart } from "./PriceChart.tsx";
import { RangePicker } from "./RangePicker.tsx";
import type { HistoryPoint, Instrument, Price, Snapshot, Status, Transaction } from "./types.ts";

function useApi<T>(path: string | null, params: Record<string, string | undefined> = {}, deps: unknown[] = []) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: path !== null });
  useEffect(() => {
    if (path === null) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    api<T>(path, params)
      .then((data) => !cancelled && setState({ data, loading: false }))
      .catch((e: Error) => !cancelled && setState({ error: e.message, loading: false }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  return state;
}

function Card({ label, value, className, testId }: { label: string; value: string; className?: string; testId: string }) {
  return (
    <div className="card" data-testid={testId}>
      <div className="label">{label}</div>
      <div className={`value ${className ?? ""}`}>{value}</div>
    </div>
  );
}

export function App() {
  const [range, setRange] = useState<RangeKey>("1Y");
  const [priceRange, setPriceRange] = useState<RangeKey>("1Y");
  const [selected, setSelected] = useState<string | null>(null);

  const holdings = useApi<Snapshot>("/holdings");
  const history = useApi<HistoryPoint[]>("/portfolio/history", { from: rangeFrom(range), to: today() }, [range]);
  const instruments = useApi<Instrument[]>("/instruments");
  const status = useApi<Status>("/status");
  const prices = useApi<Price[]>(selected ? `/instruments/${selected}/prices` : null, { from: rangeFrom(priceRange), to: today() }, [selected, priceRange]);
  const transactions = useApi<Transaction[]>(selected ? `/instruments/${selected}/transactions` : null, {}, [selected]);

  useEffect(() => {
    if (!selected && holdings.data?.holdings[0]) setSelected(holdings.data.holdings[0].isin);
  }, [holdings.data, selected]);

  const snap = holdings.data;
  const totals = snap?.totals;
  const selectedInst = instruments.data?.find((i) => i.isin === selected);
  const failedJobs = Object.entries(status.data?.jobs ?? {}).filter(([, j]) => j?.status === "failed");

  return (
    <main>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <h1>Portfolio Tracker</h1>
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
      <HoldingsTable holdings={snap?.holdings ?? []} selected={selected} onSelect={setSelected} />

      {selected && (
        <>
          <h2 data-testid="price-title">
            {selectedInst?.code ?? snap?.holdings.find((h) => h.isin === selected)?.code ?? selected}{" "}
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
    </main>
  );
}
