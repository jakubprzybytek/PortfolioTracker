import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  FilterBar,
  FilterSelect,
  FilterText,
  matchesAny,
  uniqueOptions,
} from "./Filters.tsx";
import {
  TX_TYPE_LABELS,
  fmtInt,
  fmtMoney,
  fmtNum,
  signClass,
  typeLabel,
} from "./format.ts";
import { InstrumentLabel } from "./InstrumentLabel.tsx";
import { SkeletonRows } from "./Placeholders.tsx";
import { useStickyToolbar } from "./sticky.tsx";
import { useTxForm } from "./txForm.ts";
import { useMedia, useNarrow } from "./useNarrow.ts";
import type { TransactionRow } from "./types.ts";
import { useApi } from "./useApi.ts";

/** Filter value for transactions without an instrument (deposits, fees …). */
const NO_INSTRUMENT = "none";
const assetType = (t: TransactionRow) => t.instrument?.type ?? "CASH";
/** Rows drawn at first, and added each time the list's end comes near: a long history stays a short page. */
const PAGE = 200;

const monthName = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
/** "2026-10" → "October 2026". */
const monthLabel = (month: string) =>
  monthName.format(new Date(`${month}-15T00:00:00Z`));

/**
 * All transactions, newest first (the API sorts), filtered by account, type, instrument, asset type and free text
 * (instrument code or name, ISIN, account, type, note), with a row per month above its transactions. "Add transaction"
 * opens the form; a row opens it to edit (or delete) that transaction. Notes show as a one-line excerpt (all of it on
 * hover and in the form). A long list is drawn 200 rows at a time, the next ones as you scroll near its end (a page
 * with every row of a long history is very tall: slow to redraw, e.g. on every width while resizing). On a phone it's a
 * list of two-line rows instead of the table: date, type, account and amount; then instrument, quantity × price, fee
 * and the note's start. The filters and the table's header stay at the top while the list scrolls; on a phone the
 * filters fold into a search and a "Filters" button, so they take two short lines there.
 */
/** A retail bond bought on one day whose interest starts on another (issued later, a rollover): said in the date's tooltip. */
const interestNote = (t: TransactionRow): string | undefined =>
  t.valueDate && t.valueDate !== t.date
    ? `Interest from ${t.valueDate}`
    : undefined;

export function TransactionsView({
  params,
  setParams,
}: {
  params: Record<string, string>;
  setParams: (p: Record<string, string | undefined>) => void;
}) {
  const txs = useApi<TransactionRow[]>("/transactions");
  const form = useTxForm();
  const all = txs.data ?? [];
  const { instrument = "", account = "", type = "", tx = "", q = "" } = params;

  const options = useMemo(
    () => ({
      instrument: uniqueOptions(all, (t) =>
        t.isin
          ? { value: t.isin, label: t.instrument?.code ?? t.isin }
          : { value: NO_INSTRUMENT, label: "(no instrument)" },
      ),
      account: uniqueOptions(all, (t) => ({
        value: t.account,
        label: t.account,
      })),
      type: uniqueOptions(all, (t) => ({
        value: assetType(t),
        label: typeLabel(assetType(t)),
      })),
      tx: uniqueOptions(all, (t) => ({
        value: t.type,
        label: TX_TYPE_LABELS[t.type] ?? t.type,
      })),
    }),
    [all],
  );

  const rows = useMemo(
    () =>
      all.filter(
        (t) =>
          (!instrument ||
            (instrument === NO_INSTRUMENT ? !t.isin : t.isin === instrument)) &&
          (!account || t.account === account) &&
          (!type || assetType(t) === type) &&
          (!tx || t.type === tx) &&
          matchesAny(
            q,
            t.instrument?.code,
            t.instrument?.name,
            t.isin,
            t.account,
            TX_TYPE_LABELS[t.type] ?? t.type,
            t.note,
          ),
      ),
    [all, instrument, account, type, tx, q],
  );
  // Transactions per month (as shown, after the filters), for the month rows.
  const perMonth = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of rows)
      m.set(t.date.slice(0, 7), (m.get(t.date.slice(0, 7)) ?? 0) + 1);
    return m;
  }, [rows]);
  const monthStarts = (i: number) =>
    i === 0 || rows[i]!.date.slice(0, 7) !== rows[i - 1]!.date.slice(0, 7);
  // Rows of one date share a background; the next date switches to the other one (as shown, after the filters).
  const bands = useMemo(() => {
    let band: "a" | "b" = "b";
    return rows.map(
      (t, i) =>
        (band =
          i > 0 && t.date === rows[i - 1]!.date
            ? band
            : band === "a"
              ? "b"
              : "a"),
    );
  }, [rows]);

  // Drawn so far; back to the first rows when the filters change.
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [instrument, account, type, tx, q]);
  const narrow = useNarrow();
  // The table needs a wide screen: below it (a phone, a narrow window), a list of two-line rows.
  const list = useMedia("(max-width: 1150px)");

  // The toolbar (filters) sticks to the top, under the phone's top bar; the table's header sticks under it.
  const [toolbar, stickyStyle] = useStickyToolbar();
  const more = useRef<HTMLElement | null>(null);
  const moreRef = (el: HTMLElement | null) => {
    more.current = el;
  };
  useEffect(() => {
    const el = more.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) =>
        entries.some((e) => e.isIntersecting) && setLimit((n) => n + PAGE),
      { rootMargin: "800px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [limit, rows.length, list]);

  const set = (key: string) => (value: string) =>
    setParams({ ...params, [key]: value || undefined });

  return (
    <div
      className="tx-view"
      style={stickyStyle}
    >
      <header className="view-header">
        <h2 className="view-title">Transactions</h2>
      </header>
      {txs.error && <p className="error">{txs.error}</p>}

      <div className="tx-toolbar" ref={toolbar} data-testid="tx-toolbar">
        <FilterBar
          compact
          activeCount={[instrument, account, type, tx].filter(Boolean).length}
          search={
            <FilterText
              label="Search"
              value={q}
              onChange={set("q")}
              testId="filter-text"
              placeholder="Instrument, note, account…"
              width="14rem"
            />
          }
          active={!!(instrument || account || type || tx || q)}
          onReset={() => setParams({})}
          summary={
            txs.loading
              ? "Loading…"
              : `${rows.length} of ${all.length} transactions`
          }
        >
          <FilterSelect
            label="Account"
            value={account}
            options={options.account}
            onChange={set("account")}
            testId="filter-account"
            width="12rem"
          />
          <FilterSelect
            label="Type"
            value={tx}
            options={options.tx}
            onChange={set("tx")}
            testId="filter-tx-type"
            width="10rem"
          />
          <FilterSelect
            label="Instrument"
            value={instrument}
            options={options.instrument}
            onChange={set("instrument")}
            testId="filter-instrument"
            width="14rem"
            wide
          />
          <FilterSelect
            label="Asset type"
            value={type}
            options={options.type}
            onChange={set("type")}
            testId="filter-type"
          />
        </FilterBar>
      </div>

      {list ? (
        <ul className="tx-list" data-testid="transactions-list">
          {!txs.data &&
            txs.loading &&
            Array.from({ length: 10 }, (_, i) => (
              <li
                key={i}
                className="tx-item"
                aria-hidden
                data-testid="skeleton-row"
              >
                <span className="skeleton-bar" style={{ width: "60%" }} />
                <span className="skeleton-bar" style={{ width: "40%" }} />
              </li>
            ))}
          {rows.slice(0, limit).map((t, i) => (
            <Fragment key={`${t.account}/${t.id}`}>
              {monthStarts(i) && (
                <li className="tx-month" data-testid="month-row">
                  <span>{monthLabel(t.date.slice(0, 7))}</span>
                  <span className="faint">
                    {perMonth.get(t.date.slice(0, 7))}
                  </span>
                </li>
              )}
              <li
                data-testid="transaction-row"
                data-id={t.id}
                className={`tx-item clickable band-${bands[i]}`}
                onClick={() => form.open(t)}
              >
                <div className="tx-line">
                  <span className="tx-date" title={interestNote(t)}>
                    {t.date}
                    {interestNote(t) && <span className="faint"> *</span>}
                  </span>
                  <span className="tx-what">
                    {TX_TYPE_LABELS[t.type] ?? t.type}{" "}
                    <span className="muted">· {t.account}</span>
                  </span>
                  <span
                    className={`tx-amount ${t.type === "EXCHANGE" ? "" : signClass(t.amount)}`}
                    data-testid="tx-amount-cell"
                  >
                    {t.type === "EXCHANGE" ? (
                      <>
                        {fmtMoney(t.amount, t.currency)}{" "}
                        <span className="faint">→</span>{" "}
                        {fmtMoney(t.toAmount, t.toCurrency ?? t.currency)}
                      </>
                    ) : (
                      fmtMoney(t.amount, t.currency)
                    )}
                  </span>
                </div>
                {(t.instrument || t.isin || t.note || t.fee) && (
                  <div className="tx-line tx-detail muted">
                    {(t.instrument || t.isin) && (
                      <strong className="tx-code">
                        {t.instrument?.code ?? t.isin}
                      </strong>
                    )}
                    {t.quantity !== undefined && (
                      <span>
                        {fmtInt(t.quantity)}
                        {t.price !== undefined && ` × ${fmtNum(t.price)}`}
                      </span>
                    )}
                    {t.fee ? (
                      <span>fee {fmtMoney(t.fee, t.currency)}</span>
                    ) : null}
                    {t.note && (
                      <span
                        className="tx-note"
                        title={t.note}
                        data-testid="tx-note-cell"
                      >
                        {t.note}
                      </span>
                    )}
                  </div>
                )}
              </li>
            </Fragment>
          ))}
          {rows.length > limit && (
            <li
              ref={moreRef}
              className="tx-item muted"
              data-testid="transactions-more"
            >
              {rows.length - limit} more…
            </li>
          )}
          {!txs.loading && rows.length === 0 && (
            <li className="tx-item muted">
              {all.length === 0
                ? "No transactions yet."
                : "No transactions match the filters."}
            </li>
          )}
        </ul>
      ) : (
        <div className="table-wrap tx-table-wrap">
          <table data-testid="transactions-table" className="static">
            <thead>
              <tr>
                <th className="left col-date">Date ▼</th>
                <th className="left col-account">Account</th>
                <th className="left col-type">Type</th>
                <th className="left">Instrument</th>
                <th className="left col-asset">Asset type</th>
                <th className="col-qty">Qty</th>
                <th className="col-price">Price</th>
                <th className="col-amount">Amount</th>
                <th className="col-fee">Fee</th>
                <th className="left col-note">Note</th>
              </tr>
            </thead>
            <tbody>
              {!txs.data && txs.loading && <SkeletonRows rows={12} cols={10} />}
              {rows.slice(0, limit).map((t, i) => (
                <Fragment key={`${t.account}/${t.id}`}>
                  {monthStarts(i) && (
                    <tr className="month" data-testid="month-row">
                      <td className="left" colSpan={10}>
                        {monthLabel(t.date.slice(0, 7))}{" "}
                        <span className="faint">
                          · {perMonth.get(t.date.slice(0, 7))}
                        </span>
                      </td>
                    </tr>
                  )}
                  <tr
                    data-testid="transaction-row"
                    data-id={t.id}
                    className={`clickable band-${bands[i]}`}
                    onClick={() => form.open(t)}
                    title="Edit or delete"
                  >
                    <td className="left" title={interestNote(t)}>
                      {t.date}
                      {interestNote(t) && (
                        <span className="faint" data-testid="tx-interest-mark">
                          {" "}
                          *
                        </span>
                      )}
                    </td>
                    <td className="left tx-account" title={t.account}>
                      {t.account}
                    </td>
                    <td className="left">{TX_TYPE_LABELS[t.type] ?? t.type}</td>
                    <td className="left instrument">
                      {t.instrument ? (
                        <InstrumentLabel
                          code={t.instrument.code}
                          name={t.instrument.name}
                        />
                      ) : (
                        <span className="muted">{t.isin ?? "–"}</span>
                      )}
                    </td>
                    <td className="left col-asset">
                      {typeLabel(assetType(t))}
                    </td>
                    <td>
                      {t.quantity === undefined ? "–" : fmtInt(t.quantity)}
                    </td>
                    <td>{t.price === undefined ? "–" : fmtNum(t.price)}</td>
                    <td
                      className={
                        t.type === "EXCHANGE" ? "" : signClass(t.amount)
                      }
                      data-testid="tx-amount-cell"
                    >
                      {t.type === "EXCHANGE" ? (
                        <>
                          {fmtMoney(t.amount, t.currency)}{" "}
                          <span className="faint">→</span>{" "}
                          {fmtMoney(t.toAmount, t.toCurrency ?? t.currency)}
                        </>
                      ) : (
                        fmtMoney(t.amount, t.currency)
                      )}
                    </td>
                    <td className="col-fee">
                      {t.fee ? fmtMoney(t.fee, t.currency) : "–"}
                    </td>
                    <td
                      className="left muted note col-note"
                      title={t.note}
                      data-testid="tx-note-cell"
                    >
                      {t.note ?? ""}
                    </td>
                  </tr>
                </Fragment>
              ))}
              {rows.length > limit && (
                <tr ref={moreRef} data-testid="transactions-more">
                  <td className="left muted" colSpan={10}>
                    {rows.length - limit} more…
                  </td>
                </tr>
              )}
              {!txs.loading && rows.length === 0 && (
                <tr>
                  <td className="left muted" colSpan={10}>
                    {all.length === 0
                      ? "No transactions yet. Import a transactions file (see data/README.md)."
                      : "No transactions match the filters."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
