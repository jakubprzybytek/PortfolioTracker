import { Fragment, useEffect, useState } from "react";
import type { BuyMoreRow, HoldSellAssumptions, HoldSellRow, HoldSellSkipped } from "@portfolio/core";
import { apiSend } from "./api.ts";
import { BuyMoreTable } from "./BuyMoreTable.tsx";
import { fmtNum, fmtPln, parseNum, signClass } from "./format.ts";
import { InstrumentLabel } from "./InstrumentLabel.tsx";
import { SkeletonRows } from "./Placeholders.tsx";
import { useNarrow } from "./useNarrow.ts";
import { reloadAll, useApi } from "./useApi.ts";

interface Offer {
  series: string;
  kind: string;
  termMonths: number;
  firstRate: number | null;
  margin: number | null;
}

export interface HoldSellResponse {
  date: string;
  assumptions: HoldSellAssumptions;
  defaults: HoldSellAssumptions;
  saved: boolean;
  offers: Offer[];
  rows: HoldSellRow[];
  skipped: HoldSellSkipped[];
  /** "Buy more": one more bond of each held, bought today (core/holdsell, buyMore). */
  buy?: BuyMoreRow[];
}

export const VERDICT_LABELS: Record<HoldSellRow["verdict"], string> = { HOLD: "hold", SELL: "sell", EVEN: "about the same" };
const KIND_LABELS: Record<string, string> = { coupon: "coupon", interest: "interest", redemption: "redemption" };
/** A fraction as "2,50 %" (yields, rates). */
const fmtRate = (r: number | null | undefined) => (r === null || r === undefined ? "–" : `${fmtNum(r * 100, 2)} %`);
const term = (months: number) => (months >= 12 ? `${months / 12} y` : `${months} m`);
const rowKey = (r: Pick<HoldSellRow, "account" | "isin">) => `${r.account}#${r.isin}`;

/** The assumptions as typed: percentages as text ("2,5"), blank = the account's own commission. */
interface Draft {
  cpi: string;
  wibor: string;
  nbpRate: string;
  alternative: "retail" | "rate";
  altRate: string;
  commission: string;
}
const pctText = (r: number | undefined) => (r === undefined ? "" : fmtNum(r * 100, 2).replace(/\s/g, ""));
const draftOf = (a: HoldSellAssumptions): Draft => ({ cpi: pctText(a.cpi), wibor: pctText(a.wibor), nbpRate: pctText(a.nbpRate), alternative: a.alternative, altRate: pctText(a.altRate), commission: pctText(a.commission) });

/**
 * Hold or sell (road map 19): every bond position kept to maturity against sold today with the money in the
 * alternative until then. The assumptions on top (future CPI, WIBOR, NBP rate, the alternative, a sale's commission);
 * a row opens its breakdown: what a sale brings, the flows still to come, and what the result rests on.
 */
export function HoldSellView({ params, setParams }: { params: Record<string, string>; setParams: (p: Record<string, string | undefined>) => void }) {
  const data = useApi<HoldSellResponse>("/hold-sell");
  const d = data.data;
  const open = params["row"] ?? null;
  // Two halves sharing the assumptions: hold or sell what's held, or buy more of it (`?mode=buy`).
  const buyMode = params["mode"] === "buy";
  const setMode = (buy: boolean) => setParams({ ...params, mode: buy ? "buy" : undefined, row: undefined });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // The form follows the saved assumptions (first load, after a save or a reset), not every background refetch.
  const assumptionsKey = d ? JSON.stringify(d.assumptions) : "";
  useEffect(() => {
    if (d) setDraft(draftOf(d.assumptions));
  }, [assumptionsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (body: unknown, message: string) => {
    setPending(true);
    setError(null);
    try {
      await apiSend("PUT", "/hold-sell/assumptions", body);
      setDone(message);
      reloadAll(); // Holdings' badges too
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };
  const save = () => {
    if (!draft) return;
    const n = (s: string) => (s.trim() === "" ? undefined : (parseNum(s) ?? NaN) / 100);
    const body = { cpi: n(draft.cpi), wibor: n(draft.wibor), nbpRate: n(draft.nbpRate), alternative: draft.alternative, ...(draft.alternative === "rate" ? { altRate: n(draft.altRate) } : {}), ...(n(draft.commission) !== undefined ? { commission: n(draft.commission) } : {}) };
    if ([body.cpi, body.wibor, body.nbpRate].some((v) => v === undefined || Number.isNaN(v))) return setError("CPI, WIBOR and the NBP rate need a number (in %).");
    if (draft.alternative === "rate" && !(body.altRate! >= 0)) return setError("The alternative's rate needs a number (in %).");
    void send(body, "Assumptions saved.");
  };
  const field = (key: "cpi" | "wibor" | "nbpRate" | "altRate" | "commission", label: string, title: string, placeholder = "") =>
    draft && (
      <label className="hs-field" title={title}>
        <span className="muted">{label}</span>
        <span className="with-unit">
          <input inputMode="decimal" value={draft[key]} placeholder={placeholder} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} data-testid={`hs-${key}`} />
          <span className="muted">%</span>
        </span>
      </label>
    );

  const sells = d?.rows.filter((r) => r.verdict === "SELL").length ?? 0;
  const narrow = useNarrow();
  const toggle = (r: HoldSellRow) => setParams({ ...params, row: open === rowKey(r) ? undefined : rowKey(r) });
  return (
    <>
      <header className="view-header hs-header">
        <h2 className="view-title">Hold or sell</h2>
        <div className="range hs-mode" role="group" aria-label="Hold or sell, or buy more" data-testid="hs-mode">
          <button type="button" className={buyMode ? "" : "active"} aria-pressed={!buyMode} onClick={() => setMode(false)}>
            Hold or sell
          </button>
          <button type="button" className={buyMode ? "active" : ""} aria-pressed={buyMode} onClick={() => setMode(true)}>
            Buy more
          </button>
        </div>
        <span className="muted" data-testid="hs-date">
          {d ? `as of ${d.date}` : data.loading ? "Loading…" : ""}
        </span>
      </header>
      <p className="muted hs-intro">
        {buyMode
          ? "Each bond held, one more bought today at its last price and kept to maturity: its yield before and after tax (none in IKE/IKZE), after inflation, and over the retail bond on offer for a similar term, at the assumptions below. Retail bonds: the series on offer now."
          : "Each bond kept to maturity against sold today, with the money in the alternative until the same day. What you paid doesn't matter; after tax (none in IKE/IKZE), at the assumptions below."}
      </p>
      {data.error && <p className="error">{data.error}</p>}

      <section className="panel hs-assumptions" data-testid="hs-assumptions">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          {field("cpi", "CPI", "Inflation y/y from now on: IZ indexation, EDO/COI/ROS/ROD after their first year")}
          {field("wibor", "WIBOR", "WIBOR from now on: floating corporate bonds' coupons not set yet (WIBOR + margin)")}
          {field("nbpRate", "NBP rate", "NBP reference rate from now on: ROR and DOR (rate + margin)")}
          {draft && (
            <label className="hs-field" title="What the money from a sale goes into until the bond's maturity">
              <span className="muted">Alternative</span>
              <select value={draft.alternative} onChange={(e) => setDraft({ ...draft, alternative: e.target.value as Draft["alternative"] })} data-testid="hs-alternative">
                <option value="retail">Retail bond on offer</option>
                <option value="rate">A rate (before tax)</option>
              </select>
            </label>
          )}
          {draft?.alternative === "rate" && field("altRate", "Rate", "The alternative's annual rate before tax (a deposit, a bond fund …)")}
          {field("commission", "Commission", "A sale's commission, % of its value; blank: each account's own, from its trades", "account's")}
          <span className="hs-buttons">
            <button type="submit" className="primary" disabled={pending || !draft} data-testid="hs-save">
              {pending && <span className="spinner" aria-hidden />}
              Save
            </button>
            {d?.saved && (
              <button type="button" className="link" disabled={pending} onClick={() => void send({ reset: true }, "Assumptions back to the defaults.")} data-testid="hs-reset">
                Defaults
              </button>
            )}
          </span>
        </form>
        {done && !error && (
          <p className="muted" role="status" data-testid="hs-done">
            {done}
          </p>
        )}
        {error && (
          <p className="error" data-testid="hs-error">
            {error}
          </p>
        )}
        {d && d.offers.length > 0 && (
          <p className="muted hs-offers" data-testid="hs-offers">
            On offer:{" "}
            {d.offers.map((o, i) => (
              <Fragment key={o.series}>
                {i > 0 && " · "}
                <span title={o.margin !== null ? `then ${o.kind === "ROR" || o.kind === "DOR" ? "NBP rate" : "CPI"} + ${fmtRate(o.margin)}` : "fixed"}>
                  {o.series} ({term(o.termMonths)}) {fmtRate(o.firstRate)}
                </span>
              </Fragment>
            ))}
          </p>
        )}
      </section>

      {buyMode ? (
        <>
          {d?.buy && (
            <p className="muted" data-testid="bm-summary">
              {d.buy.length} bonds. Best yield after tax first; a row opens what it rests on.
            </p>
          )}
          <BuyMoreTable rows={d?.buy} today={d?.date ?? ""} loading={data.loading} open={open} toggle={(key) => setParams({ ...params, row: open === key ? undefined : key })} />
        </>
      ) : (
      <>
      {d && (
        <p className="muted" data-testid="hs-summary">
          {d.rows.length} bond positions{sells ? `, ${sells} worth selling` : ""}. Most worth selling first.
        </p>
      )}
      {narrow ? (
        <ul className="hs-list panel" data-testid="hs-table">
          {!d && data.loading && <li className="muted">Loading…</li>}
          {d?.rows.map((r) => (
            <li key={rowKey(r)} className={open === rowKey(r) ? "selected" : ""} data-testid="hs-row" data-code={r.code}>
              <button type="button" className="hs-item" onClick={() => toggle(r)}>
                <span className="hs-line">
                  <span className="hs-what">
                    <InstrumentLabel code={r.code} name={r.name} />
                  </span>
                  <span className={`flag verdict ${r.verdict.toLowerCase()}`} data-testid="hs-verdict">
                    {VERDICT_LABELS[r.verdict]}
                  </span>
                </span>
                <span className="hs-line muted">
                  {r.account} · {r.maturity} ({fmtNum(r.years, 1)} y) · sell now {fmtPln(r.sellNow.net)}
                </span>
                <span className="hs-line">
                  <span>
                    held <strong data-testid="hs-yield">{fmtRate(r.yieldIfHeld)}</strong> vs {fmtRate(r.alternative.yield)} <span className="muted">{r.alternative.series ?? ""}</span>
                  </span>
                  <span className={signClass(r.difference)} data-testid="hs-difference">
                    {fmtPln(r.difference)}
                  </span>
                </span>
              </button>
              {open === rowKey(r) && <Breakdown r={r} />}
            </li>
          ))}
          {d && d.rows.length === 0 && <li className="muted">No bonds held.</li>}
        </ul>
      ) : (
      <div className="table-wrap">
        <table data-testid="hs-table" className="static">
          <thead>
            <tr>
              <th className="left">Bond</th>
              <th>Maturity</th>
              <th title="What a sale (or an early redemption) brings today, after its commission or fee and the tax due now">Sell now</th>
              <th title="The annual yield of keeping it: giving up the sale's amount today for what it still pays, after tax">If held</th>
              <th className="left" title="What the money from a sale goes into until the bond's maturity, its yield after tax">Alternative</th>
              <th title="At maturity: kept (its payments reinvested at the alternative's yield) − sold today and put into the alternative">Difference</th>
              <th className="left"></th>
            </tr>
          </thead>
          <tbody>
            {!d && data.loading && <SkeletonRows rows={5} cols={7} />}
            {d?.rows.map((r) => {
              const isOpen = open === rowKey(r);
              return (
                <Fragment key={rowKey(r)}>
                  <tr className={`clickable${isOpen ? " selected" : ""}`} onClick={() => toggle(r)} data-testid="hs-row" data-code={r.code}>
                    <td className="left instrument">
                      <InstrumentLabel code={r.code} name={r.name} />
                      <div className="sub muted">{r.account}</div>
                    </td>
                    <td>
                      {r.maturity}
                      <div className="sub muted">{fmtNum(r.years, 1)} y</div>
                    </td>
                    <td>{fmtPln(r.sellNow.net)}</td>
                    <td data-testid="hs-yield">{fmtRate(r.yieldIfHeld)}</td>
                    <td className="left">
                      {fmtRate(r.alternative.yield)}
                      <div className="sub muted">{r.alternative.label}</div>
                    </td>
                    <td className={signClass(r.difference)} data-testid="hs-difference">
                      {fmtPln(r.difference)}
                    </td>
                    <td className="left">
                      <span className={`flag verdict ${r.verdict.toLowerCase()}`} data-testid="hs-verdict">
                        {VERDICT_LABELS[r.verdict]}
                      </span>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="hs-detail">
                      <td colSpan={7}>
                        <Breakdown r={r} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {d && d.rows.length === 0 && (
              <tr>
                <td className="left muted" colSpan={7}>
                  No bonds held.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      )}
      {d && d.skipped.length > 0 && (
        <p className="muted hs-skipped" data-testid="hs-skipped">
          Not compared:{" "}
          {d.skipped.map((s, i) => (
            <Fragment key={`${s.account}#${s.isin}`}>
              {i > 0 && "; "}
              <strong>{s.code}</strong> ({s.account}): {s.reason}
            </Fragment>
          ))}
        </p>
      )}
      </>
      )}
    </>
  );
}

/** One position's numbers: the sale today, the flows to maturity, both sides at maturity, the assumptions used. */
function Breakdown({ r }: { r: HoldSellRow }) {
  const s = r.sellNow;
  return (
    <div className="hs-breakdown" data-testid="hs-breakdown">
      <div>
        <h4>Sold today</h4>
        <table className="static compact">
          <tbody>
            <tr>
              <td className="left">Value ({fmtNum(r.quantity, 0)} bonds)</td>
              <td>{fmtPln(s.value)}</td>
            </tr>
            {s.commission > 0 && (
              <tr>
                <td className="left">Commission ({fmtRate(r.commissionRate)})</td>
                <td>−{fmtPln(s.commission)}</td>
              </tr>
            )}
            {s.fee > 0 && (
              <tr>
                <td className="left">Early-redemption fee</td>
                <td>−{fmtPln(s.fee)}</td>
              </tr>
            )}
            {s.tax > 0 && (
              <tr>
                <td className="left">Tax due now</td>
                <td>−{fmtPln(s.tax)}</td>
              </tr>
            )}
            <tr className="total">
              <td className="left">Net</td>
              <td>{fmtPln(s.net)}</td>
            </tr>
            <tr>
              <td className="left">At maturity in the alternative</td>
              <td>{fmtPln(r.sellAtMaturity)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div>
        <h4>Kept to maturity</h4>
        <table className="static compact" data-testid="hs-flows">
          <thead>
            <tr>
              <th className="left">Date</th>
              <th className="left">What</th>
              <th>Amount</th>
              <th>Tax</th>
            </tr>
          </thead>
          <tbody>
            {r.flows.map((f) => (
              <tr key={`${f.date}#${f.kind}`} title={f.projected ? "From the assumptions (a rate or an index not published yet)" : ""}>
                <td className="left">{f.date}</td>
                <td className="left">
                  {KIND_LABELS[f.kind]}
                  {f.projected && <span className="muted"> *</span>}
                </td>
                <td>{fmtPln(f.amount)}</td>
                <td>{f.tax ? `−${fmtPln(f.tax)}` : "–"}</td>
              </tr>
            ))}
            <tr className="total">
              <td className="left" colSpan={3}>
                At maturity, payments reinvested at {fmtRate(r.alternative.yield)}
              </td>
              <td>{fmtPln(r.holdAtMaturity)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <ul className="muted hs-notes">
        {r.flows.some((f) => f.projected) && <li>* from the assumptions</li>}
        {r.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </div>
  );
}

/** Holdings: the verdict per position (account#isin), for the small badge on bond rows. */
export const holdSellKey = rowKey;
