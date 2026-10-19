import { useState } from "react";
import { fmtPct, fmtPln, rangeFrom, signClass, today, type RangeKey } from "./format.ts";
import { AccountsTable, type AccountsResponse } from "./AccountsTable.tsx";
import { Allocation, CLASS_LABELS } from "./Allocation.tsx";
import { AllocationChart, DrawdownChart } from "./HistoryCharts.tsx";
import { Skeleton, SkeletonRows } from "./Placeholders.tsx";
import { PortfolioChart } from "./PortfolioChart.tsx";
import { RangePicker } from "./RangePicker.tsx";
import type { AccountSummary, HistoryPoint, Snapshot, Status } from "./types.ts";
import { useApi } from "./useApi.ts";
import { RefreshPrices } from "./RefreshPrices.tsx";
import { AssetMixPanel } from "./Targets.tsx";

function Card({ label, value, className, testId, note, loading }: { label: string; value: string; className?: string; testId: string; note?: string; loading: boolean }) {
  return (
    <div className="card" data-testid={testId}>
      <div className="label">{label}</div>
      <div className={`value ${className ?? ""}`}>{loading ? <span className="skeleton-bar" /> : value}</div>
      {note && <div className="note muted">{note}</div>}
    </div>
  );
}

/**
 * Where the profit comes from (fully tracked accounts): open positions, sales and redemptions, income, fees outside
 * trades, and the rest (exchange-rate effects on cash, positions without a price), adding up to the profit.
 */
function ProfitBreakdown({ summary, loading }: { summary?: AccountSummary; loading: boolean }) {
  const parts: { key: string; label: string; value?: number; title: string }[] = [
    { key: "unrealised", label: "Unrealised gain", value: summary?.unrealised, title: "Open positions: value now − what they cost (FIFO)" },
    { key: "realised", label: "Realised gain", value: summary?.realised, title: "Sales and redemptions: proceeds − what the units sold cost (FIFO); in PLN at NBP D-1, as for tax" },
    { key: "income", label: "Income", value: summary?.income, title: "Dividends, coupons and interest received" },
    { key: "fees", label: "Fees and taxes", value: summary === undefined ? undefined : summary.fees ? -summary.fees : 0, title: "Account fees, taxes, exchange fees (trade commissions are in the cost and the proceeds)" },
    { key: "other", label: "Currency and other", value: summary?.other, title: "The rest of the profit: exchange-rate effects on cash, a broker's spread, positions without a price" },
  ];
  return (
    <section className="breakdown panel" data-testid="profit-breakdown" aria-label="Profit breakdown">
      {parts.map((p) => (
        <div key={p.key} className="breakdown-part" title={p.title} data-testid={`profit-${p.key}`}>
          <span className="label">{p.label}</span>
          <span className={`value ${signClass(p.value)}`}>{loading ? <span className="skeleton-bar" /> : fmtPln(p.value)}</span>
        </div>
      ))}
    </section>
  );
}

export function DashboardView() {
  const [range, setRange] = useState<RangeKey>("1Y");

  const holdings = useApi<Snapshot>("/holdings");
  const history = useApi<HistoryPoint[]>("/portfolio/history", { from: rangeFrom(range), to: today() });
  const status = useApi<Status>("/status");
  const summaries = useApi<AccountsResponse>("/accounts");
  const sum = summaries.data?.total;
  const sumLoading = !summaries.data && summaries.loading;

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
        <span className="view-meta">
          <span className="muted" data-testid="snapshot-date">
            {snap ? <><span className="wide-only">Valuation </span>as of {snap.date}</> : holdings.loading ? "Loading…" : holdings.error ?? ""}
          </span>
          <RefreshPrices />
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
        <Card loading={cardsLoading} label="Total" value={fmtPln(totals && cash !== undefined ? totals.value + cash : totals?.value)} testId="total-all" note={totals ? `positions ${fmtPln(totals.value)} + cash` : undefined} />
        <Card loading={cardsLoading} label="Cash" value={fmtPln(cash)} testId="total-cash" note={incomplete ? `${incomplete} incomplete account${incomplete > 1 ? "s" : ""} not included` : undefined} />
        <Card loading={sumLoading} label="Net deposits" value={fmtPln(sum?.netDeposits)} testId="total-deposits" note="money put in − taken out" />
        <Card
          loading={sumLoading}
          label="Profit"
          value={fmtPln(sum?.profit)}
          className={signClass(sum?.profit)}
          testId="total-profit"
          note={sum?.netDeposits ? `${fmtPct((sum.profit / sum.netDeposits) * 100)} of net deposits` : undefined}
        />
        <Card
          loading={sumLoading}
          label="XIRR"
          value={sum?.xirr != null ? fmtPct(sum.xirr * 100) : "–"}
          className={signClass(sum?.xirr)}
          testId="total-xirr"
          note={sum ? `a year, money-weighted, since ${sum.firstDate}` : undefined}
        />
      </section>
      <ProfitBreakdown summary={sum} loading={sumLoading} />

      {snap ? <AssetMixPanel snapshot={snap} /> : holdings.loading && <div className="asset-mix"><Skeleton height={14} testId="asset-mix-skeleton" /></div>}

      <h2>
        Portfolio value <span className="muted chart-legend">positions + cash; dashed: net deposits</span>
      </h2>
      <section className="panel">
        <RangePicker value={range} onChange={setRange} busy={history.loading} testId="portfolio-range" />
        {history.error ? <p className="error">{history.error}</p> : <PortfolioChart history={history.data ?? []} loading={history.loading} />}
      </section>

      <div className="chart-pair" data-testid="chart-pair">
        <div>
          <h2>
            Drawdown <span className="muted chart-legend">below the best so far in the range; deposits don't count</span>
          </h2>
          <section className="panel">
            {history.error ? <p className="error">{history.error}</p> : <DrawdownChart history={history.data ?? []} loading={history.loading} />}
          </section>
        </div>
        <div>
          <h2>
            Allocation over time{" "}
            <span className="muted chart-legend">
              {(["SHARES", "BONDS", "CASH", "OTHER"] as const).map((k) => (
                <span key={k} className="legend-item">
                  <i className={`mix-dot mix-${k}`} aria-hidden /> {CLASS_LABELS[k]}
                </span>
              ))}
            </span>
          </h2>
          <section className="panel">
            {history.error ? <p className="error">{history.error}</p> : <AllocationChart history={history.data ?? []} loading={history.loading} />}
          </section>
        </div>
      </div>

      <h2>Accounts</h2>
      <AccountsTable data={summaries} />

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
                <td className={`left ${j?.status === "failed" ? "status-failed" : j ? "status-ok" : "muted"}`}>{j?.status ?? "–"}</td>
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
