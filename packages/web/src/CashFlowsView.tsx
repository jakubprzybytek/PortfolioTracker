import { Fragment, useState } from "react";
import type { CashFlowReport, CashFlowRow } from "@portfolio/core";
import { API_URL, apiSend } from "./api.ts";
import { fmtInt, fmtPln, fmtTime, signClass, today } from "./format.ts";
import { SkeletonRows } from "./Placeholders.tsx";
import { useApi } from "./useApi.ts";
import { useNarrow } from "./useNarrow.ts";

export interface CashFlowsResponse extends CashFlowReport {
  /** The spreadsheet feed's token: when it was made and last used (the token itself is shown only when made). */
  feed: { createdAt: string; lastUsedAt: string | null } | null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** Whole złoty in the grid (the exact amount in its tooltip), empty for nothing. */
const cell = (v: number) => (v === 0 ? "" : fmtInt(Math.round(v)));

/** The feed's URL for IMPORTDATA: on the site's own domain (the Router passes /api to the API). */
export const feedUrl = (token: string, year: string) => {
  const url = new URL(`${API_URL}/feeds/cash-flows.csv`, window.location.origin);
  url.searchParams.set("year", year);
  url.searchParams.set("token", token);
  return url.toString();
};

/**
 * Cash flows (the sheet's "Wpłaty/wypłaty" tab): deposits and withdrawals per account and month of a year, in PLN at
 * the NBP rate of the day before; a row folds out into its deposits and withdrawals. Below, the link that serves the
 * same figures to a spreadsheet (IMPORTDATA).
 */
export function CashFlowsView({ params, setParams }: { params: Record<string, string>; setParams: (p: Record<string, string | undefined>) => void }) {
  const thisYear = today().slice(0, 4);
  const year = params["year"] ?? thisYear;
  const data = useApi<CashFlowsResponse>("/cash-flows", { year });
  const d = data.data?.year === Number(year) ? data.data : undefined;
  const narrow = useNarrow();
  const open = params["account"] ?? null;
  const toggle = (a: string) => setParams({ ...params, account: open === a ? undefined : a });
  const years = [...new Set([Number(thisYear), ...(data.data?.years ?? [])])].sort((a, b) => b - a);

  return (
    <>
      <header className="view-header">
        <h2 className="view-title">Cash flows</h2>
        <label className="cf-year">
          <span className="muted">Year</span>
          <select value={year} onChange={(e) => setParams({ year: e.target.value === thisYear ? undefined : e.target.value })} data-testid="cf-year">
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </header>
      <p className="muted hs-intro">
        Money paid into and taken out of each account, per month: a row folds out into deposits and withdrawals. In PLN, another currency at the NBP rate of the day
        before. Transfers between your own accounts count on both sides.
      </p>
      {data.error && <p className="error">{data.error}</p>}
      {d?.missingRates && <p className="error">No NBP rate for: {d.missingRates.join("; ")}. Those months are incomplete.</p>}

      {narrow ? (
        <ul className="hs-list panel" data-testid="cf-table">
          {!d && data.loading && <li className="muted">Loading…</li>}
          {d && <NarrowRow name="Total" row={d.total} total open={open === "Total"} onToggle={() => toggle("Total")} />}
          {d?.accounts.map((a) => <NarrowRow key={a.account} name={a.account} row={a} open={open === a.account} onToggle={() => toggle(a.account)} />)}
          {d && d.accounts.length === 0 && <li className="muted">No deposits or withdrawals in {year}.</li>}
        </ul>
      ) : (
        <div className="table-wrap">
          <table className="static compact cf-table" data-testid="cf-table">
            <thead>
              <tr>
                <th className="left">Account</th>
                {MONTHS.map((m) => (
                  <th key={m}>{m}</th>
                ))}
                <th>{year}</th>
              </tr>
            </thead>
            <tbody>
              {!d && data.loading && <SkeletonRows rows={6} cols={14} />}
              {d?.accounts.map((a) => {
                const isOpen = open === a.account;
                return (
                  <Fragment key={a.account}>
                    <tr className={`clickable${isOpen ? " selected" : ""}`} onClick={() => toggle(a.account)} aria-expanded={isOpen} data-testid="cf-row" data-account={a.account}>
                      <td className="left">
                        <span className="caret" aria-hidden>
                          {isOpen ? "▾" : "▸"}
                        </span>{" "}
                        {a.account}
                      </td>
                      <MonthCells values={a.net} signed />
                      <td className={signClass(a.totals.net)} title={fmtPln(a.totals.net)} data-testid="cf-year-net">
                        {fmtInt(Math.round(a.totals.net))}
                      </td>
                    </tr>
                    {isOpen && (
                      <>
                        <tr className="sale-pair" data-testid="cf-deposits">
                          <td className="left">└ deposits</td>
                          <MonthCells values={a.deposits} />
                          <td title={fmtPln(a.totals.deposits)}>{cell(a.totals.deposits)}</td>
                        </tr>
                        <tr className="sale-pair" data-testid="cf-withdrawals">
                          <td className="left">└ withdrawals</td>
                          <MonthCells values={a.withdrawals} />
                          <td title={fmtPln(a.totals.withdrawals)}>{cell(a.totals.withdrawals)}</td>
                        </tr>
                      </>
                    )}
                  </Fragment>
                );
              })}
              {d && d.accounts.length === 0 && (
                <tr>
                  <td className="left muted" colSpan={14}>
                    No deposits or withdrawals in {year}.
                  </td>
                </tr>
              )}
              {d && d.accounts.length > 0 && (
                <tr className="total" data-testid="cf-total">
                  <td className="left">Total</td>
                  <MonthCells values={d.total.net} signed />
                  <td className={signClass(d.total.totals.net)} title={fmtPln(d.total.totals.net)}>
                    {fmtInt(Math.round(d.total.totals.net))}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <FeedPanel year={year} feed={data.data?.feed} onChange={data.reload} />
    </>
  );
}

function MonthCells({ values, signed = false }: { values: number[]; signed?: boolean }) {
  return (
    <>
      {values.map((v, i) => (
        <td key={i} className={signed ? signClass(v) : ""} title={v ? `${MONTHS_LONG[i]}: ${fmtPln(v)}` : undefined}>
          {cell(v)}
        </td>
      ))}
    </>
  );
}

/** Phones: the account and the year's balance, money in and out under it; open, the months with any. */
function NarrowRow({ name, row, total = false, open, onToggle }: { name: string; row: CashFlowRow; total?: boolean; open: boolean; onToggle: () => void }) {
  const months = row.net.map((v, i) => ({ i, v })).filter(({ i }) => row.deposits[i] || row.withdrawals[i]);
  return (
    <li className={`${open ? "selected" : ""}${total ? " cf-total" : ""}`} data-testid={total ? "cf-total" : "cf-row"} data-account={total ? undefined : name}>
      <button type="button" className="hs-item" onClick={onToggle} aria-expanded={open}>
        <span className="hs-line">
          <span>{total ? <strong>{name}</strong> : name}</span>
          <span className={signClass(row.totals.net)} data-testid="cf-year-net">
            {fmtPln(row.totals.net)}
          </span>
        </span>
        <span className="hs-line muted">
          <span>in {fmtPln(row.totals.deposits)}</span>
          <span>out {fmtPln(row.totals.withdrawals)}</span>
        </span>
      </button>
      {open && (
        <ul className="sale-pairs" data-testid="cf-months">
          {months.length === 0 && <li className="muted">Nothing this year.</li>}
          {months.map(({ i, v }) => (
            <li key={i}>
              <span className="hs-line">
                <span>{MONTHS_LONG[i]}</span>
                <span className={signClass(v)}>{fmtPln(v)}</span>
              </span>
              <span className="hs-line muted">
                <span>in {fmtPln(row.deposits[i]!)}</span>
                <span>out {fmtPln(row.withdrawals[i]!)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * The spreadsheet link: create one (its token is shown only then, in a ready IMPORTDATA formula), replace it or
 * revoke it; replacing and revoking ask first, since the spreadsheet using the old link stops getting figures.
 */
function FeedPanel({ year, feed, onChange }: { year: string; feed: CashFlowsResponse["feed"] | undefined; onChange: () => void }) {
  const [made, setMade] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"replace" | "revoke" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setConfirm(null);
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const create = () =>
    run(async () => {
      const r = await apiSend<{ token: string }>("POST", "/feed-token");
      setMade(r.token);
      setCopied(false);
    });
  const revoke = () =>
    run(async () => {
      await apiSend("DELETE", "/feed-token");
      setMade(null);
    });
  const formula = made ? `=IMPORTDATA("${feedUrl(made, year)}")` : "";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(formula);
      setCopied(true);
    } catch {
      setError("Couldn't copy: select the formula and copy it.");
    }
  };

  return (
    <section className="panel cf-feed" data-testid="cf-feed">
      <h3>Spreadsheet link</h3>
      <p className="muted">
        The figures above as CSV, for a spreadsheet: paste the formula into a cell and the summary (a header, the total, one row per account) fills in from there. Anyone
        with the link can read these figures, so share the spreadsheet with care.
      </p>
      {feed === undefined && <p className="muted">Loading…</p>}
      {feed === null && !made && <p data-testid="cf-feed-state">No link.</p>}
      {feed && (
        <p data-testid="cf-feed-state">
          Link created {fmtTime(feed.createdAt)}, {feed.lastUsedAt ? `last used ${fmtTime(feed.lastUsedAt)}` : "not used yet"}.
        </p>
      )}
      {made && (
        <div className="cf-made">
          <div className="cf-formula">
            <input readOnly value={formula} onFocus={(e) => e.target.select()} aria-label="IMPORTDATA formula" data-testid="cf-formula" />
            <button type="button" className="primary" onClick={() => void copy()} data-testid="cf-copy">
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="muted">Shown only now: the app keeps only a fingerprint of it. For {year}; change the year in the formula for another.</p>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <div className="cf-buttons">
        {confirm ? (
          <>
            <span>The spreadsheet using the current link stops getting figures.</span>
            <button type="button" className="danger" onClick={() => void (confirm === "replace" ? create() : revoke())} disabled={busy} data-testid="cf-confirm">
              {confirm === "replace" ? "Replace" : "Revoke"}
            </button>
            <button type="button" className="link" onClick={() => setConfirm(null)} disabled={busy}>
              Cancel
            </button>
          </>
        ) : feed ? (
          <>
            <button type="button" className="primary" onClick={() => setConfirm("replace")} disabled={busy} data-testid="cf-replace">
              Create new link
            </button>
            <button type="button" className="danger-link" onClick={() => setConfirm("revoke")} disabled={busy} data-testid="cf-revoke">
              Revoke
            </button>
          </>
        ) : (
          feed === null &&
          !made && (
            <button type="button" className="primary" onClick={() => void create()} disabled={busy} data-testid="cf-create">
              Create link
            </button>
          )
        )}
      </div>
    </section>
  );
}
