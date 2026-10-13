import type { HistoryPoint } from "./types.ts";
import { ValueChart } from "./ValueChart.tsx";

/**
 * The whole portfolio: positions + cash (area) and the money put in so far (dashed); the gap is the profit. Money
 * moving between a position and cash (a sale, a redemption) doesn't move the line. Older API answers without
 * `total`/`netDeposits`: positions and their cost.
 */
export function PortfolioChart({ history, loading }: { history: HistoryPoint[]; loading: boolean }) {
  return (
    <ValueChart
      testId="portfolio-chart"
      height={260}
      loading={loading}
      labels={{ value: "Value (positions + cash)", cost: "Net deposits" }}
      data={history.map((h) => ({ date: h.date, value: h.total ?? h.totals.value, cost: h.netDeposits ?? h.totals.cost }))}
    />
  );
}
