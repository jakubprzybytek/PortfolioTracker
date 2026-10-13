import { fmtNum, fmtPln, typeLabel } from "./format.ts";
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
  add(byCurrency, "PLN", "PLN", cash);
  return (
    <div className="allocations">
      <Bars title="By asset type" slices={sorted(byType)} testId="alloc-type" />
      <Bars title="By currency" slices={sorted(byCurrency)} testId="alloc-currency" />
    </div>
  );
}

/** Asset classes of the big picture; instrument types map onto them (ETFs: by what they hold, see assetClassOf). */
const ASSET_CLASS: Record<string, string> = {
  ETF: "SHARES",
  BOND_LISTED: "BONDS",
  BOND_CORPORATE: "BONDS",
  BOND_RETAIL: "BONDS",
  BOND_IBKR: "BONDS",
  CURRENCY: "CASH",
  CASH: "CASH",
  FUND_MANUAL: "OTHER",
};
const CLASS_LABELS: Record<string, string> = { SHARES: "Shares", BONDS: "Bonds", CASH: "Cash", OTHER: "Other" };
const CLASS_ORDER = ["SHARES", "BONDS", "CASH", "OTHER"];

/** An ETF holding bonds ("… Corporate Bond UCITS ETF") counts as bonds; other ETFs as shares. */
export const assetClassOf = (h: { type: string; name: string }): string => (h.type === "ETF" && /\bbond/i.test(h.name) ? "BONDS" : (ASSET_CLASS[h.type] ?? "OTHER"));

/**
 * The big picture in one bar: shares, bonds (incl. bond ETFs), cash and other (manually valued), as shares of positions + cash of
 * the fully tracked accounts.
 */
export function AssetMix({ snapshot }: { snapshot: Snapshot }) {
  const byClass = new Map<string, number>();
  const add = (key: string, value: number) => byClass.set(key, (byClass.get(key) ?? 0) + value);
  for (const h of snapshot.holdings) if (h.value) add(assetClassOf(h), h.value);
  add("CASH", snapshot.totals.cash ?? 0);
  const total = [...byClass.values()].reduce((s, v) => s + v, 0);
  const slices = CLASS_ORDER.filter((k) => (byClass.get(k) ?? 0) > 0).map((key) => ({ key, value: byClass.get(key)!, share: total ? byClass.get(key)! / total : 0 }));
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
