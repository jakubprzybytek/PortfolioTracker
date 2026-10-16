import { useEffect, useMemo, useRef, useState } from "react";
import { FilterBar, FilterSelect, uniqueOptions } from "./Filters.tsx";
import { TX_TYPE_LABELS, fmtInt, fmtMoney, fmtNum, signClass, typeLabel } from "./format.ts";
import { InstrumentLabel } from "./InstrumentLabel.tsx";
import { SkeletonRows } from "./Placeholders.tsx";
import { useTxForm } from "./txForm.ts";
import type { TransactionRow } from "./types.ts";
import { useApi } from "./useApi.ts";

/** Filter value for transactions without an instrument (deposits, fees …). */
const NO_INSTRUMENT = "none";
const assetType = (t: TransactionRow) => t.instrument?.type ?? "CASH";
/** Rows drawn at first, and added each time the list's end comes near: a long history stays a short page. */
const PAGE = 200;

/**
 * All transactions, newest first (the API sorts), filtered by account, instrument and asset type. "Add transaction"
 * opens the form; a row opens it to edit (or delete) that transaction. Notes show as a one-line excerpt (all of it on
 * hover and in the form). A long list is drawn 200 rows at a time, the next ones as you scroll near its end (a page
 * with every row of a long history is very tall: slow to redraw, e.g. on every width while resizing).
 */
export function TransactionsView({ params, setParams }: { params: Record<string, string>; setParams: (p: Record<string, string | undefined>) => void }) {
  const txs = useApi<TransactionRow[]>("/transactions");
  const form = useTxForm();
  const all = txs.data ?? [];
  const { instrument = "", account = "", type = "" } = params;

  const options = useMemo(
    () => ({
      instrument: uniqueOptions(all, (t) => (t.isin ? { value: t.isin, label: t.instrument?.code ?? t.isin } : { value: NO_INSTRUMENT, label: "(no instrument)" })),
      account: uniqueOptions(all, (t) => ({ value: t.account, label: t.account })),
      type: uniqueOptions(all, (t) => ({ value: assetType(t), label: typeLabel(assetType(t)) })),
    }),
    [all],
  );

  const rows = useMemo(
    () =>
      all.filter(
        (t) =>
          (!instrument || (instrument === NO_INSTRUMENT ? !t.isin : t.isin === instrument)) &&
          (!account || t.account === account) &&
          (!type || assetType(t) === type),
      ),
    [all, instrument, account, type],
  );
  // Rows of one date share a background; the next date switches to the other one (as shown, after the filters).
  const bands = useMemo(() => {
    let band: "a" | "b" = "b";
    return rows.map((t, i) => (band = i > 0 && t.date === rows[i - 1]!.date ? band : band === "a" ? "b" : "a"));
  }, [rows]);

  // Drawn so far; back to the first rows when the filters change.
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [instrument, account, type]);
  const more = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    const el = more.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setLimit((n) => n + PAGE), { rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [limit, rows.length]);

  const set = (key: string) => (value: string) => setParams({ ...params, [key]: value || undefined });

  return (
    <>
      <header className="view-header">
        <h2 className="view-title">Transactions</h2>
      </header>
      {txs.error && <p className="error">{txs.error}</p>}

      <FilterBar active={!!(instrument || account || type)} onReset={() => setParams({})} summary={txs.loading ? "Loading…" : `${rows.length} of ${all.length} transactions`}>
        <FilterSelect label="Account" value={account} options={options.account} onChange={set("account")} testId="filter-account" width="13rem" />
        <FilterSelect label="Instrument" value={instrument} options={options.instrument} onChange={set("instrument")} testId="filter-instrument" width="16rem" />
        <FilterSelect label="Asset type" value={type} options={options.type} onChange={set("type")} testId="filter-type" />
      </FilterBar>

      <div className="table-wrap">
        <table data-testid="transactions-table" className="static">
          <thead>
            <tr>
              <th className="left">Date ▼</th>
              <th className="left">Account</th>
              <th className="left">Type</th>
              <th className="left">Instrument</th>
              <th className="left">Asset type</th>
              <th>Qty</th>
              <th>Price</th>
              <th>Amount</th>
              <th>Fee</th>
              <th className="left">Note</th>
            </tr>
          </thead>
          <tbody>
            {!txs.data && txs.loading && <SkeletonRows rows={12} cols={10} />}
            {rows.slice(0, limit).map((t, i) => (
              <tr
                key={`${t.account}/${t.id}`}
                data-testid="transaction-row"
                data-id={t.id}
                className={`clickable band-${bands[i]}`}
                onClick={() => form.open(t)}
                title="Edit or delete"
              >
                <td className="left">{t.date}</td>
                <td className="left">{t.account}</td>
                <td className="left">{TX_TYPE_LABELS[t.type] ?? t.type}</td>
                <td className="left instrument">
                  {t.instrument ? (
                    <InstrumentLabel code={t.instrument.code} name={t.instrument.name} />
                  ) : (
                    <span className="muted">{t.isin ?? "–"}</span>
                  )}
                </td>
                <td className="left">{typeLabel(assetType(t))}</td>
                <td>{t.quantity === undefined ? "–" : fmtInt(t.quantity)}</td>
                <td>{t.price === undefined ? "–" : fmtNum(t.price)}</td>
                <td className={t.type === "EXCHANGE" ? "" : signClass(t.amount)} data-testid="tx-amount-cell">
                  {t.type === "EXCHANGE" ? (
                    <>
                      {fmtMoney(t.amount, t.currency)} <span className="faint">→</span> {fmtMoney(t.toAmount, t.toCurrency ?? t.currency)}
                    </>
                  ) : (
                    fmtMoney(t.amount, t.currency)
                  )}
                </td>
                <td>{t.fee ? fmtMoney(t.fee, t.currency) : "–"}</td>
                <td className="left muted note" title={t.note} data-testid="tx-note-cell">
                  {t.note ?? ""}
                </td>
              </tr>
            ))}
            {rows.length > limit && (
              <tr ref={more} data-testid="transactions-more">
                <td className="left muted" colSpan={10}>
                  {rows.length - limit} more…
                </td>
              </tr>
            )}
            {!txs.loading && rows.length === 0 && (
              <tr>
                <td className="left muted" colSpan={10}>
                  {all.length === 0 ? "No transactions yet. Import a transactions file (see data/README.md)." : "No transactions match the filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
