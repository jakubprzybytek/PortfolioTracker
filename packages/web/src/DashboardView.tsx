import { useState } from "react";
import { fmtPct, fmtPln, rangeFrom, signClass, today, type RangeKey } from "./format.ts";
import { AccountsTable } from "./AccountsTable.tsx";
import { Allocation } from "./Allocation.tsx";
import { Skeleton, SkeletonRows } from "./Placeholders.tsx";
import { PortfolioChart } from "./PortfolioChart.tsx";
import { RangePicker } from "./RangePicker.tsx";
import type { HistoryPoint, Snapshot, Status } from "./types.ts";
import { useApi } from "./useApi.ts";

function Card({ label, value, className, testId, note, loading }: { label: string; value: string; className?: string; testId: string; note?: string; loading: boolean }) {
  return (
    <div className="card" data-testid={testId}>
      <div className="label">{label}</div>
      <div className={`value ${className ?? ""}`}>{loading ? <span className="skeleton-bar" /> : value}</div>
      {note && <div className="note muted">{note}</div>}
    </div>
  );
}

export function DashboardView() {
  const [range, setRange] = useState<RangeKey>("1Y");

  const holdings = useApi<Snapshot>("/holdings");
  const history = useApi<HistoryPoint[]>("/portfolio/history", { from: rangeFrom(range), to: today() }, [range]);
  const status = useApi<Status>("/status");

  const snap = holdings.data;
  const totals = snap?.totals;
  const incomplete = Object.values(snap?.accounts ?? {}).filter((a) => a.incomplete?.length).length;
  const cash = totals?.cash;
  const cardsLoading = !snap && holdings.loading;
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
        <Card loading={cardsLoading} label="Total" value={fmtPln(totals && cash !== undefined ? totals.value + cash : totals?.value)} testId="total-all" note="positions + cash" />
        <Card loading={cardsLoading} label="Value" value={fmtPln(totals?.value)} testId="total-value" note="positions" />
        <Card loading={cardsLoading} label="Cash" value={fmtPln(cash)} testId="total-cash" note={incomplete ? `${incomplete} incomplete account${incomplete > 1 ? "s" : ""} not included` : undefined} />
        <Card loading={cardsLoading} label="Cost" value={fmtPln(totals?.cost)} testId="total-cost" />
        <Card loading={cardsLoading} label="Gain" value={`${fmtPln(totals?.gain)}${totals && totals.cost ? ` (${fmtPct((totals.gain / totals.cost) * 100)})` : ""}`} className={signClass(totals?.gain)} testId="total-gain" />
        <Card loading={cardsLoading} label="Coupons received" value={fmtPln(totals?.couponsReceived)} testId="total-coupons" />
      </section>

      <h2>Portfolio value</h2>
      <RangePicker value={range} onChange={setRange} testId="portfolio-range" />
      {history.error ? <p className="error">{history.error}</p> : <PortfolioChart history={history.data ?? []} loading={!history.data && history.loading} />}

      <h2>Accounts</h2>
      <AccountsTable />

      <h2>Allocation</h2>
      {snap ? <Allocation snapshot={snap} /> : holdings.loading && <Skeleton height={230} testId="allocation-skeleton" />}

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
            {!status.data && status.loading && <SkeletonRows rows={9} cols={4} />}
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
