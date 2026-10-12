import type { HistoryPoint } from "./types.ts";
import { ValueChart } from "./ValueChart.tsx";

export function PortfolioChart({ history }: { history: HistoryPoint[] }) {
  return <ValueChart testId="portfolio-chart" height={260} data={history.map((h) => ({ date: h.date, value: h.totals.value, cost: h.totals.cost }))} />;
}
