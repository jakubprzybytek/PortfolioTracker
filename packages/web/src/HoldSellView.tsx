import { Fragment, useEffect, useState } from "react";
import type { Decision, HoldSellAssumptions, HoldSellSkipped, ReviewRow } from "@portfolio/core";
import { apiSend } from "./api.ts";
import { BoughtToday } from "./BoughtToday.tsx";
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
  /** One per bond position: kept vs sold today, one more bought today, the decision (core/holdsell, buyHoldOrSell). */
  rows: ReviewRow[];
  skipped: HoldSellSkipped[];
}

export const DECISION_LABELS: Record<Decision, string> = { BUY: "buy more", HOLD: "hold", SELL: "sell", MATURES: "matures soon" };
const KIND_LABELS: Record<string, string> = { coupon: "coupon", interest: "interest", redemption: "redemption" };
/** A fraction as "2,50 %" (yields, rates). */
const fmtRate = (r: number | null | undefined) => (r === null || r === undefined ? "–" : `${fmtNum(r * 100, 2)} %`);
const term = (months: number) => (months >= 12 ? `${months / 12} y` : `${months} m`);
const rowKey = (r: Pick<ReviewRow, "account" | "isin">) => `${r.account}#${r.isin}`;

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
 * Buy, hold or sell (road map 19, with Buy more since 2026-10-23): every bond position kept to maturity against sold
 * today (the yield if held, from what a sale brings) and one more bought today (the yield if bought, from what it
 * costs), both against the same alternative: sell, hold, buy more, or matures soon. The assumptions on top (future CPI,
 * WIBOR, NBP rate, the alternative, the commission); a row opens its breakdown: the sale, the flows still to come, one
 * more bought, and what it rests on.
 */
export function HoldSellView({ params, setParams }: { params: Record<string, string>; setParams: (p: Record<string, string | undefined>) => void }) {
  const data = useApi<HoldSellResponse>("/hold-sell");
  const d = data.data;
  const open = params["row"] ?? null;
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

  const count = (k: Decision) => d?.rows.filter((r) => r.decision === k).length ?? 0;
  const narrow = useNarrow();
  const toggle = (r: ReviewRow) => setParams({ ...params, row: open === rowKey(r) ? undefined : rowKey(r) });
  return (
    <>
      <header className="view-header">
        <h2 className="view-title">Buy, hold or sell</h2>
        <span className="muted" data-testid="hs-date">
          {d ? `as of ${d.date}` : data.loading ? "Loading…" : ""}
        </span>
      </header>
      <p className="muted hs-intro">
        Each bond held, against the alternative until its maturity: <strong>if held</strong>, from what selling it today would bring; <strong>if bought</strong>, from what one
        more costs today. Sell when keeping it yields less than the alternative; buy more when one more yields more; hold in between. After tax (none in IKE/IKZE), at the
        assumptions below.
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

      {d && (
        <p className="muted" data-testid="hs-summary">
          {d.rows.length} bond positions:{" "}
          {(["SELL", "BUY", "HOLD", "MATURES"] as const)
            .filter((k) => count(k))
            .map((k) => `${count(k)} ${DECISION_LABELS[k]}`)
            .join(", ")}
          . Sells first, then buys.
        </p>
      )}
      {narrow ? (
        <ul className="hs-list panel" data-testid="hs-table">
          {!d && data.loading && <li className="muted">Loading…</li>}
          {d?.rows.map((r) => (
            <li key={rowKey(r)} className={open === rowKey(r) ? "selected" : ""} data-testid="hs-row" data-code={r.code} data-decision={r.decision}>
              <button type="button" className="hs-item" onClick={() => toggle(r)}>
                <span className="hs-line">
                  <span className="hs-what">
                    <InstrumentLabel code={r.code} name={r.name} />
                  </span>
                  <span className={`flag verdict ${r.decision.toLowerCase()}`} data-testid="hs-verdict">
                    {DECISION_LABELS[r.decision]}
                  </span>
                </span>
                <span className="hs-line muted">
                  {r.account} · {r.maturity} ({fmtNum(r.years, 1)} y)
                </span>
                {r.decision !== "MATURES" && (
                  <span className="hs-line">
                    <span>
                      held <strong data-testid="hs-yield">{fmtRate(r.held.yieldIfHeld)}</strong> · bought <strong data-testid="hs-bought">{fmtRate(r.bought?.netYield)}</strong>
                    </span>
                    <span className="muted">
                      vs {fmtRate(r.held.alternative.yield)} {r.held.alternative.series ?? ""}
                    </span>
                  </span>
                )}
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
                <th title="The annual yield of keeping it: giving up what a sale brings today (after its commission or fee and the tax due now) for what it still pays, after tax">If held</th>
                <th title="The annual yield of one more bought today at its last price (+ accrued interest and commission), held to maturity, after tax. Retail bonds: the series of the same kind on offer">
                  If bought
                </th>
                <th className="left" title="What the money goes into otherwise until the bond's maturity (by default the retail bond on offer with the nearest term), its yield after tax">
                  Alternative
                </th>
                <th className="left" title="Sell: keeping it yields less than the alternative. Buy more: one more yields more. Hold: in between (within 0,2 % a year counts as neither). Matures soon: under 3 months left">
                  Verdict
                </th>
              </tr>
            </thead>
            <tbody>
              {!d && data.loading && <SkeletonRows rows={5} cols={6} />}
              {d?.rows.map((r) => {
                const isOpen = open === rowKey(r);
                const soon = r.decision === "MATURES";
                return (
                  <Fragment key={rowKey(r)}>
                    <tr className={`clickable${isOpen ? " selected" : ""}`} onClick={() => toggle(r)} data-testid="hs-row" data-code={r.code} data-decision={r.decision}>
                      <td className="left instrument">
                        <InstrumentLabel code={r.code} name={r.name} />
                        <div className="sub muted">{r.account}</div>
                      </td>
                      <td>
                        {r.maturity}
                        <div className="sub muted">{fmtNum(r.years, 1)} y</div>
                      </td>
                      <td data-testid="hs-yield">
                        {soon ? "–" : fmtRate(r.held.yieldIfHeld)}
                        <div className="sub muted">sell now {fmtPln(r.held.sellNow.net)}</div>
                      </td>
                      <td data-testid="hs-bought">
                        {soon ? "–" : fmtRate(r.bought?.netYield)}
                        {r.bought && <div className="sub muted">{r.bought.offerSeries ? `${r.bought.offerSeries} on offer` : `${fmtNum(r.bought.price.perBond, 2)} ${r.bought.price.currency === "PLN" ? "zł" : r.bought.price.currency}`}</div>}
                      </td>
                      <td className="left">
                        {soon ? "–" : fmtRate(r.held.alternative.yield)}
                        <div className="sub muted">{r.held.alternative.label}</div>
                      </td>
                      <td className="left">
                        <span className={`flag verdict ${r.decision.toLowerCase()}`} data-testid="hs-verdict">
                          {DECISION_LABELS[r.decision]}
                        </span>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="hs-detail">
                        <td colSpan={6}>
                          <Breakdown r={r} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {d && d.rows.length === 0 && (
                <tr>
                  <td className="left muted" colSpan={6}>
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
  );
}

/** One position's numbers: the sale today, the flows to maturity kept, one more bought today, what it rests on. */
function Breakdown({ r: row }: { r: ReviewRow }) {
  const r = row.held;
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
      {row.bought && <BoughtToday b={row.bought} spread={row.boughtSpread} />}
      <ul className="muted hs-notes">
        {row.decision === "MATURES" && <li>matures in under 3 months: a yield over so few weeks, a year, says nothing, so none is compared</li>}
        {r.flows.some((f) => f.projected) && <li>* from the assumptions</li>}
        {[...new Set([...r.notes, ...(row.bought?.notes ?? [])])].map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </div>
  );
}

/** Holdings: the verdict per position (account#isin), for the small badge on bond rows. */
export const holdSellKey = rowKey;
