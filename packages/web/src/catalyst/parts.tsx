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

/** `onIssuer`: the issuer's name opens its dialog (a bond linked to a company). */
export function BondTitle({ r, onIssuer }: { r: BondRow; onIssuer?: () => void }) {
  const issuer = r.issuerShort ?? r.issuer ?? "";
  return (
    <span data-testid="catalyst-panel-title">
      <strong>{r.code}</strong>{" "}
      {onIssuer && r.entityId ? (
        <button type="button" className="link-button cat-name" onClick={onIssuer} title="The issuer: scorecard, financials, judgements" data-testid="catalyst-panel-issuer">
          {issuer}
        </button>
      ) : (
        issuer
      )}{" "}
      <span className="muted">{r.couponText ?? couponLabel(r)} · matures {r.maturity ?? "–"}</span>
    </span>
  );
}
