import { useMemo, useState } from "react";
import { fmtInt, fmtNum, fmtPct, fmtPln, signClass } from "./format.ts";
import type { Holding } from "./types.ts";

type SortKey = "code" | "quantity" | "cleanPrice" | "accruedInterest" | "valuePerUnit" | "value" | "cost" | "gain" | "gainPct" | "couponsReceived";

const COLUMNS: { key: SortKey; label: string; left?: boolean }[] = [
  { key: "code", label: "Instrument", left: true },
  { key: "quantity", label: "Qty" },
  { key: "cleanPrice", label: "Price %" },
  { key: "accruedInterest", label: "Accrued" },
  { key: "valuePerUnit", label: "Value / bond" },
  { key: "value", label: "Value" },
  { key: "cost", label: "Cost" },
  { key: "gain", label: "Gain" },
  { key: "gainPct", label: "Gain %" },
  { key: "couponsReceived", label: "Coupons" },
];

const FLAG_LABELS: Record<string, string> = {
  stale_price: "stale price",
  no_price: "no price",
  unknown_instrument: "unknown instrument",
  missing_coupon_rate: "coupon rate missing",
  missing_reference_index: "CPI index missing",
  no_period: "outside coupon periods",
  rate_pending: "rate not published yet",
  matured: "matured",
  missing_terms: "series terms missing",
};

export function HoldingsTable({ holdings, selected, onSelect }: { holdings: Holding[]; selected: string | null; onSelect: (isin: string) => void }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "value", dir: -1 });

  const rows = useMemo(() => {
    const cmp = (a: Holding, b: Holding) => {
      const x = a[sort.key];
      const y = b[sort.key];
      if (typeof x === "string" || typeof y === "string") return String(x ?? "").localeCompare(String(y ?? "")) * sort.dir;
      return ((x ?? -Infinity) - (y ?? -Infinity)) * sort.dir;
    };
    return [...holdings].sort(cmp);
  }, [holdings, sort]);

  const toggle = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "code" ? 1 : -1 }));

  return (
    <div className="table-wrap">
      <table data-testid="holdings-table">
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <th key={c.key} className={c.left ? "left" : ""} onClick={() => toggle(c.key)} aria-sort={sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
                {c.label}
                {sort.key === c.key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((h) => (
            <tr key={h.isin} className={h.isin === selected ? "selected" : ""} onClick={() => onSelect(h.isin)} data-testid={`holding-${h.code}`} style={{ cursor: "pointer" }}>
              <td className="left instrument">
                <strong>{h.code}</strong> <span className="muted">{h.name !== h.code ? h.name : ""}</span>
                {h.flags.map((f) => (
                  <span key={f} className="flag" title={f}>
                    {FLAG_LABELS[f] ?? f}
                  </span>
                ))}
              </td>
              <td>{fmtInt(h.quantity)}</td>
              <td title={h.priceDate ?? ""}>{fmtNum(h.cleanPrice)}</td>
              <td>{fmtNum(h.accruedInterest)}</td>
              <td>{fmtNum(h.valuePerUnit)}</td>
              <td>{fmtPln(h.value)}</td>
              <td>{fmtPln(h.cost)}</td>
              <td className={signClass(h.gain)}>{fmtPln(h.gain)}</td>
              <td className={signClass(h.gainPct)}>{fmtPct(h.gainPct)}</td>
              <td>{fmtPln(h.couponsReceived)}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td className="left muted" colSpan={COLUMNS.length}>
                No open positions. Import transactions to get started (see data/README.md).
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
