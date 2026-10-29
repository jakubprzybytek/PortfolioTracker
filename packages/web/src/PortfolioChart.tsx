import { fmtPln, signClass } from "./format.ts";
import type { HistoryPoint } from "./types.ts";
import { ValueChart } from "./ValueChart.tsx";

/**
 * The whole portfolio: positions + cash (area) and the money put in so far (dashed); the gap is the profit. Money
 * moving between a position and cash (a sale, a redemption) doesn't move the line. Older API answers without
 * `total`/`netDeposits`: positions and their cost. Under it, the same as a table (one row per month's last day),
 * for screen readers and for reading the numbers.
 */
export function PortfolioChart({ history, loading }: { history: HistoryPoint[]; loading: boolean }) {
  const data = history.map((h) => ({ date: h.date, value: h.total ?? h.totals.value, cost: h.netDeposits ?? h.totals.cost }));
  // The last point of each month, newest first, and the latest day.
  const monthEnds = data.filter((p, i) => i === data.length - 1 || data[i + 1]!.date.slice(0, 7) !== p.date.slice(0, 7)).reverse();
  return (
    <>
      <ValueChart testId="portfolio-chart" height={260} loading={loading} labels={{ value: "Value (positions + cash)", cost: "Net deposits" }} data={data} />
      {monthEnds.length > 0 && (
        <details className="chart-table" data-testid="portfolio-table">
          <summary>As a table</summary>
          <div className="table-wrap">
            <table className="static">
              <caption className="sr-only">Portfolio value and net deposits at each month's end</caption>
              <thead>
                <tr>
                  <th className="left">Date</th>
                  <th>Value</th>
                  <th>Net deposits</th>
                  <th>Profit</th>
                </tr>
              </thead>
              <tbody>
                {monthEnds.map((p) => (
                  <tr key={p.date}>
                    <td className="left">{p.date}</td>
                    <td>{fmtPln(p.value)}</td>
                    <td>{fmtPln(p.cost)}</td>
                    <td className={signClass(p.value - p.cost)}>{fmtPln(p.value - p.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </>
  );
}
