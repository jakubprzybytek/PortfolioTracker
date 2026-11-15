// Small pieces of the Catalyst view: the liquidity dots, the interest period bar, a bond's title.
import { fmtNum } from "../format.ts";
import type { BondRow, CurrentPeriod, Level } from "./types.ts";
import { LEVELS, couponLabel, periodPosition } from "./labels.ts";

/** What the bar says, in words: for its title and for screen readers. */
export function periodTitle(p: CurrentPeriod, accrued: number | null, currency: string): string {
  const { day, days, afterRecord } = periodPosition(p);
  const head = `Interest period ${p.start} → ${p.end}, day ${day} of ${days} at settlement (${p.settle})`;
  if (afterRecord) return `${head}. Past the record day (${p.recordDate}): this coupon (paid ${p.paymentDate}) goes to the seller, no accrued interest to pay.`;
  const paid = accrued !== null && accrued > 0 ? `${fmtNum(accrued)} ${currency} accrued interest per bond` : "the accrued interest";
  return `${head}${p.recordDate ? `; record day ${p.recordDate}` : ""}. A purchase pays ${paid}; the broker taxes the coupon in full, so 19% of it is paid early and comes back only as cost at maturity.`;
}

/**
 * The interest period as a bar: filled up to where a purchase settles, the record day as a tick. Amber up to the record
 * day (accrued interest paid, and taxed with the coupon), green past it (none).
 */
export function PeriodBar({ period, accrued, currency, wide }: { period: CurrentPeriod; accrued: number | null; currency: string; wide?: boolean }) {
  const pos = periodPosition(period);
  const title = periodTitle(period, accrued, currency);
  return (
    <span className={`cat-period${wide ? " wide" : ""}`} role="img" aria-label={title} title={title} data-after-record={pos.afterRecord} data-testid="catalyst-period">
      <span className="fill" style={{ width: `${pos.share * 100}%` }} />
      {pos.record !== null && <span className="record" style={{ left: `${pos.record * 100}%` }} />}
    </span>
  );
}

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
