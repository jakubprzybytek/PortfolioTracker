import { CLASS_LABELS } from "./Allocation.tsx";
import { RANGES, rangeFrom, today, type RangeKey } from "./format.ts";
import { AllocationChart, DrawdownChart } from "./HistoryCharts.tsx";
import { RangePicker } from "./RangePicker.tsx";
import { GrowthChart, YearsChart, YearsTable, type YearsResponse } from "./Returns.tsx";
import type { HistoryPoint } from "./types.ts";
import { useApi } from "./useApi.ts";

/**
 * How the portfolio did over time: returns by year against inflation (the whole history), and over the chosen range
 * the growth of 100 zł against CPI, the drawdown and the allocation over time. The range (header) is in the URL (`?range=ALL`).
 */
export function PerformanceView({ params, setParams }: { params: Record<string, string>; setParams: (p: Record<string, string | undefined>) => void }) {
  const range: RangeKey = RANGES.some((r) => r.key === params["range"]) ? (params["range"] as RangeKey) : "1Y";
  const history = useApi<HistoryPoint[]>("/portfolio/history", { from: rangeFrom(range), to: today() });
  const years = useApi<YearsResponse>("/portfolio/years");

  return (
    <>
      <header className="view-header">
        <h2 className="view-title">Performance</h2>
        <RangePicker value={range} onChange={(key) => setParams({ ...params, range: key === "1Y" ? undefined : key })} busy={history.loading} testId="performance-range" />
      </header>

      <h2>
        Returns by year <span className="muted chart-legend">time-weighted (deposits don't count) against inflation, CPI December on December</span>
      </h2>
      {years.error ? <p className="error">{years.error}</p> : <YearsTable data={years.data} loading={years.loading} />}

      <div className="chart-pair" data-testid="returns-pair">
        <div>
          <h2>
            Return and inflation <span className="muted chart-legend">per year; the dot: real return; * part of a year</span>
          </h2>
          <section className="panel">{years.error ? <p className="error">{years.error}</p> : <YearsChart data={years.data} loading={years.loading} />}</section>
        </div>
        <div>
          <h2>
            Growth of 100 zł <span className="muted chart-legend">from the start of the range, against what CPI says it needs to be</span>
          </h2>
          <section className="panel">
            {history.error ? <p className="error">{history.error}</p> : <GrowthChart history={history.data ?? []} cpi={years.data?.cpi} loading={history.loading || (!years.data && years.loading)} />}
          </section>
        </div>
      </div>

      <div className="chart-pair" data-testid="chart-pair">
        <div>
          <h2>
            Drawdown <span className="muted chart-legend">below the best so far in the range; deposits don't count</span>
          </h2>
          <section className="panel">{history.error ? <p className="error">{history.error}</p> : <DrawdownChart history={history.data ?? []} loading={history.loading} />}</section>
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
          <section className="panel">{history.error ? <p className="error">{history.error}</p> : <AllocationChart history={history.data ?? []} loading={history.loading} />}</section>
        </div>
      </div>
    </>
  );
}
