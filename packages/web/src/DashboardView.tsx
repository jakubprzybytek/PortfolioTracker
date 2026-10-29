import { useState } from "react";
import { fmtPct, fmtPln, rangeFrom, signClass, today, type RangeKey } from "./format.ts";
import { AccountsTable, type AccountsResponse } from "./AccountsTable.tsx";
import { Allocation } from "./Allocation.tsx";
import { Skeleton } from "./Placeholders.tsx";
import { PortfolioChart } from "./PortfolioChart.tsx";
import { RangePicker } from "./RangePicker.tsx";
import type { AccountSummary, HistoryPoint, Snapshot, Status } from "./types.ts";
import { useApi } from "./useApi.ts";
import { RefreshPrices } from "./RefreshPrices.tsx";
import { AssetMixPanel } from "./Targets.tsx";
import type { YearsResponse } from "./Returns.tsx";

function Card({ label, value, className, testId, note, loading, href }: { label: string; value: string; className?: string; testId: string; note?: string; loading: boolean; href?: string }) {
  const body = (
    <>
      <div className="label">{label}</div>
      <div className={`value ${className ?? ""}`}>{loading ? <span className="skeleton-bar" /> : value}</div>
      {note && <div className="note muted">{note}</div>}
    </>
  );
  return href ? (
    <a className="card link-card" href={href} data-testid={testId}>
      {body}
    </a>
  ) : (
    <div className="card" data-testid={testId}>
      {body}
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
  const years = useApi<YearsResponse>("/portfolio/years");
  const sum = summaries.data?.total;
  // The latest year (the year so far) from the returns by year; the rest is in the Performance view.
  const thisYear = years.data?.years[0];
  const yearsLoading = !years.data && years.loading;
  // CPI comes a month or two later: "to Sep" when it stops before the year's last day.
  const cpiEarly = thisYear?.cpiThrough && thisYear.cpiThrough !== thisYear.to.slice(0, 7) ? new Date(`${thisYear.cpiThrough}-15`).toLocaleString("en-GB", { month: "short" }) : null;
  const sumLoading = !summaries.data && summaries.loading;

  const snap = holdings.data;
  const totals = snap?.totals;
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
          Failed jobs: {failedJobs.map(([name, j]) => `${name} (${j?.finishedAt?.slice(0, 16)}): ${j?.note ?? ""}`).join("; ")} · <a href="#/status">Status</a>
        </p>
      )}

      <section className="cards" data-testid="totals">
        <Card loading={cardsLoading} label="Total" value={fmtPln(totals && cash !== undefined ? totals.value + cash : totals?.value)} testId="total-all" note={totals ? `positions ${fmtPln(totals.value)} + cash` : undefined} />
        <Card loading={cardsLoading} label="Cash" value={fmtPln(cash)} testId="total-cash" />
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
        <Card
          loading={yearsLoading}
          label={thisYear ? `${thisYear.year}${thisYear.partial && thisYear.to.slice(0, 4) === today().slice(0, 4) ? " so far" : ""}` : "This year"}
          value={thisYear?.twr != null ? fmtPct(thisYear.twr * 100) : "–"}
          className={signClass(thisYear?.twr)}
          testId="year-return"
          href="#/performance"
          note={thisYear?.inflation != null ? `inflation ${fmtPct(thisYear.inflation * 100)}${cpiEarly ? ` (to ${cpiEarly})` : ""}, real ${fmtPct((thisYear.real ?? 0) * 100)}` : "time-weighted; by year in Performance"}
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

      <h2>Accounts</h2>
      <AccountsTable data={summaries} />

      <h2>Allocation</h2>
      {snap ? <Allocation snapshot={snap} /> : holdings.loading && <Skeleton height={230} testId="allocation-skeleton" />}
    </>
  );
}
