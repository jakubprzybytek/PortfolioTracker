// The Catalyst chart: yield against years to maturity, with the State's curve.
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import { fmtNum } from "../format.ts";
import { chartMargin, useNarrow } from "../useNarrow.ts";
import { DIMENSIONS, SIGNAL_COLOR, dimensionSignal } from "./issuer.tsx";
import type { BondRow, CurvePoint, Level } from "./types.ts";

export const LEVEL_COLOR: Record<Level, string> = { high: "var(--pos)", medium: "var(--accent)", low: "var(--muted)", none: "var(--border)" };

/** What the dots' colour shows: one of the six dimensions (by its letter) or liquidity ("liq"). */
export function YieldChart({ rows, curve, onPick, dots, setDots }: { rows: BondRow[]; curve: CurvePoint[]; onPick: (isin: string) => void; dots: string; setDots: (v: string) => void }) {
  const narrow = useNarrow();
  const points = rows
    .filter((r) => r.years !== null && r.yieldGross !== null && r.currency === "PLN" && r.yieldGross < 0.3)
    .map((r) => ({
      x: r.years!,
      y: r.yieldGross! * 100,
      isin: r.isin,
      code: r.code,
      color: dots === "liq" ? LEVEL_COLOR[r.liquidity.level] : SIGNAL_COLOR[dimensionSignal(r.scorecard, dots)],
      // Low confidence: faded, as in the table.
      faded: dots !== "liq" && r.scorecard?.confidence === "low",
    }));
  const maxX = Math.min(12, Math.ceil(Math.max(1, ...points.map((p) => p.x))));
  // The curve as far as the bonds go (its long end would stretch the axis), with its value at the axis' end.
  const inside = curve.filter((p) => p.years <= maxX);
  const beyond = curve.find((p) => p.years > maxX);
  const line = [...inside, ...(beyond ? [beyond] : [])].map((p) => ({ x: Math.min(p.years, maxX), curve: p.value * 100 }));
  return (
    <section className="panel catalyst-chart" data-testid="catalyst-chart">
      <p className="muted chart-legend">
        Yield to maturity before tax against years to maturity (PLN bonds); the line: the State's fixed-rate bonds. Dots by{" "}
        <select value={dots} onChange={(e) => setDots(e.target.value)} aria-label="Colour the dots by" data-testid="catalyst-chart-dots">
          {DIMENSIONS.map((d) => (
            <option key={d.short} value={d.short}>
              {d.label.toLowerCase()}
            </option>
          ))}
          <option value="liq">liquidity</option>
        </select>
        {dots === "liq" ? "." : " (green, yellow, red; grey: not scored)."}
      </p>
      <ResponsiveContainer width="100%" height={narrow ? 260 : 340}>
        <ComposedChart margin={chartMargin(narrow)}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
          <XAxis type="number" dataKey="x" domain={[0, maxX]} unit=" y" allowDecimals={false} allowDataOverflow allowDuplicatedCategory={false} />
          <YAxis type="number" unit="%" domain={["auto", "auto"]} width={narrow ? 40 : 48} />
          <Tooltip
            content={({ payload }) => {
              const p = payload?.[0]?.payload as { code?: string; x: number; y?: number; curve?: number } | undefined;
              if (!p) return null;
              return (
                <div className="chart-tip">
                  {p.code ? `${p.code}: ${fmtNum(p.y ?? 0)}% at ${fmtNum(p.x, 1)} y` : `State: ${fmtNum(p.curve ?? 0)}% at ${fmtNum(p.x, 1)} y`}
                </div>
              );
            }}
          />
          <Line data={line} dataKey="curve" type="monotone" stroke="var(--fg)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
          <Scatter
            data={points}
            dataKey="y"
            isAnimationActive={false}
            onClick={(d: { isin?: string; payload?: { isin: string } }) => onPick(d.payload?.isin ?? d.isin ?? "")}
            shape={(props: { cx?: number; cy?: number; payload?: { color: string; faded: boolean } }) => <circle cx={props.cx} cy={props.cy} r={4} fill={props.payload?.color ?? "var(--border)"} opacity={props.payload?.faded ? 0.4 : 1} style={{ cursor: "pointer" }} />}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </section>
  );
}
