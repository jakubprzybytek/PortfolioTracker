// Small pieces of the Catalyst view: the liquidity dots, a bond's title.
import type { BondRow, Level } from "./types.ts";
import { LEVELS, couponLabel } from "./labels.ts";

export function LiquidityDots({ level }: { level: Level }) {
  const n = LEVELS.indexOf(level);
  return (
    <span className="cat-liq" role="img" aria-label={`liquidity ${level}`} data-level={level}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={i <= n ? "on" : ""} />
      ))}
    </span>
  );
}

export function BondTitle({ r }: { r: BondRow }) {
  return (
    <span data-testid="catalyst-panel-title">
      <strong>{r.code}</strong> {r.issuer ?? ""} <span className="muted">{r.couponText ?? couponLabel(r)} · matures {r.maturity ?? "–"}</span>
    </span>
  );
}
