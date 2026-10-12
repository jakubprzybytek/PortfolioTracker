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
          <div className="alloc-row" key={s.key} data-testid={`${testId}-${s.key}`}>
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
 * fully tracked accounts (as in the totals).
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
    add(byType, h.type, typeLabel(h.type), h.value);
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
