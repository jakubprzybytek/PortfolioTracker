import { fmtNum, fmtPln, typeLabel } from "./format.ts";
import { ASSET_CLASSES, valueByClass, type AssetClass } from "@portfolio/core/valuation/history";
import type { Snapshot } from "./types.ts";

interface Slice {
  key: string;
  label: string;
  value: number;
}

function Bars({ title, slices, testId }: { title: string; slices: Slice[]; testId: string }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  return (
    <section className="allocation" data-testid={testId}>
      <h3>{title}</h3>
      {slices.map((s) => {
        const share = total ? s.value / total : 0;
        return (
          <div className="alloc-row" key={s.key} data-testid={`${testId}-${s.key}`} title={`${s.label}: ${fmtPln(s.value)}`}>
            <span className="alloc-label">{s.label}</span>
            <span className="alloc-bar" aria-hidden>
              <span style={{ width: `${(share * 100).toFixed(2)}%` }} />
            </span>
            <span className="alloc-pct">{fmtNum(share * 100, 1)} %</span>
            <span className="alloc-value muted">{fmtPln(s.value)}</span>
          </div>
        );
      })}
    </section>
  );
}

const sorted = (m: Map<string, Slice>) => [...m.values()].filter((s) => s.value > 0).sort((a, b) => b.value - a.value);

/**
 * Where the money is (latest snapshot): by asset type and by currency. Positions of every account plus the cash of
 * fully tracked accounts (as in the totals). Foreign cash (EUR, USD at IBKR) is cash, in its currency.
 */
export function Allocation({ snapshot }: { snapshot: Snapshot }) {
  const byType = new Map<string, Slice>();
  const byCurrency = new Map<string, Slice>();
  const add = (m: Map<string, Slice>, key: string, label: string, value: number) => {
    const s = m.get(key) ?? { key, label, value: 0 };
    s.value += value;
    m.set(key, s);
  };
  for (const h of snapshot.holdings) {
    if (!h.value) continue;
    const type = h.type === "CURRENCY" ? "CASH" : h.type;
    add(byType, type, typeLabel(type), h.value);
    add(byCurrency, h.currency, h.currency, h.value);
  }
  const cash = snapshot.totals.cash ?? 0;
  add(byType, "CASH", typeLabel("CASH"), cash);
  // Cash in its own currency (fully tracked accounts, as in the totals).
  for (const a of Object.values(snapshot.accounts ?? {})) {
    if (a.incomplete?.length) continue;
    if (!a.currencies) add(byCurrency, "PLN", "PLN", a.cash);
    else for (const [ccy, c] of Object.entries(a.currencies)) add(byCurrency, ccy, ccy, c.value ?? 0);
  }
  return (
    <div className="allocations">
      <Bars title="By asset type" slices={sorted(byType)} testId="alloc-type" />
      <Bars title="By currency" slices={sorted(byCurrency)} testId="alloc-currency" />
    </div>
  );
}

export const CLASS_LABELS: Record<AssetClass, string> = { SHARES: "Shares", BONDS: "Bonds", CASH: "Cash", OTHER: "Other" };
/** The classes' colours, as in the asset mix (`.mix-*` in styles.css). */
export const CLASS_COLORS: Record<AssetClass, string> = { SHARES: "var(--mix-shares)", BONDS: "var(--mix-bonds)", CASH: "var(--mix-cash)", OTHER: "var(--mix-other)" };

/**
 * The big picture in one bar: shares, bonds (incl. bond ETFs), cash and other (manually valued), as shares of positions + cash of
 * the fully tracked accounts.
 */
export function AssetMix({ snapshot }: { snapshot: Snapshot }) {
  const byClass = valueByClass(snapshot);
  const total = ASSET_CLASSES.reduce((s, k) => s + byClass[k], 0);
  const slices = ASSET_CLASSES.filter((k) => byClass[k] > 0).map((key) => ({ key, value: byClass[key], share: total ? byClass[key] / total : 0 }));
  return (
    <section className="asset-mix" data-testid="asset-mix" aria-label="Asset mix">
      <div className="mix-bar" aria-hidden>
        {slices.map((s) => (
          <span key={s.key} className={`mix-${s.key}`} style={{ width: `${(s.share * 100).toFixed(2)}%` }} title={`${CLASS_LABELS[s.key]}: ${fmtNum(s.share * 100, 1)} %`} />
        ))}
      </div>
      <ul className="mix-legend">
        {slices.map((s) => (
          <li key={s.key} data-testid={`asset-mix-${s.key}`} title={fmtPln(s.value)}>
            <i className={`mix-dot mix-${s.key}`} aria-hidden />
            {CLASS_LABELS[s.key]} <strong>{fmtNum(s.share * 100, 1)} %</strong> <span className="muted">{fmtPln(s.value)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
