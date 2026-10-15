import { Fragment, useEffect, useState } from "react";
import type { CouponCheck, InterestPeriod, PeriodCoupons } from "@portfolio/core";
import { apiSend } from "./api.ts";
import { fmtMoney, fmtNum, parseNum, today } from "./format.ts";
import { useTxForm } from "./txForm.ts";
import type { Transaction } from "./types.ts";
import { useApi } from "./useApi.ts";

interface CouponsResponse {
  isin: string;
  code: string;
  nominal: number;
  periods: InterestPeriod[];
  coupons: PeriodCoupons[];
  unmatched: Transaction[];
}

const SOURCE_LABELS: Record<string, string> = { manual: "yours", "obligacje.pl": "obligacje.pl", coupons: "from coupons" };
/** 0.0713 → "7,13 %". */
const fmtRate = (r: number | undefined) => (r === undefined ? "–" : `${fmtNum(r * 100, 2)} %`);
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** "Coupon periods" toggles the bond's chart panel between the chart and this table. */
export function CouponPeriodsButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="manual-open" onClick={onToggle} title="The bond's interest periods and their rates (accrued interest)" data-testid="coupon-periods-open">
      {open ? "Chart" : "Coupon periods"}
    </button>
  );
}

interface Draft {
  start: string;
  end: string;
  recordDate: string;
  paymentDate: string;
  rate: string;
}
const draftOf = (p: InterestPeriod): Draft => ({ start: p.start, end: p.end, recordDate: p.recordDate ?? "", paymentDate: p.paymentDate, rate: p.rate === undefined ? "" : fmtNum(p.rate * 100, 2).replace(/\s/g, "") });

/**
 * A corporate bond's interest periods, newest first: dates, the rate and who set it, the coupon per bond, and the
 * coupons you received for that period (before tax, with the rates they fit). A period without a rate gives no
 * accrued interest. Rates are set by hand, or by accepting the one your coupons imply or the one obligacje.pl shows.
 */
export function CouponPeriods({ isin, code }: { isin: string; code: string }) {
  const { saved } = useTxForm();
  const data = useApi<CouponsResponse>(`/instruments/${isin}/coupons`);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  /** What's being sent: a period's start, or "new". */
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  useEffect(() => {
    if (!confirm) return;
    const t = setTimeout(() => setConfirm(null), 4000);
    return () => clearTimeout(t);
  }, [confirm]);

  const d = data.data;
  const now = today();
  const byStart = new Map((d?.coupons ?? []).map((c) => [c.start, c]));
  const periods = [...(d?.periods ?? [])].sort((a, b) => b.start.localeCompare(a.start));
  // Future periods beyond the next one only add rows: shown folded.
  const [showFuture, setShowFuture] = useState(false);
  const future = periods.filter((p) => p.start > now);
  const shown = showFuture ? periods : periods.filter((p) => p.start <= now || p === future.at(-1));

  const send = async (key: string, run: () => Promise<unknown>, message: string) => {
    setPending(key);
    setError(null);
    try {
      await run();
      setEditing(null);
      setDraft(null);
      setConfirm(null);
      saved(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(null);
    }
  };
  const setRate = (p: InterestPeriod, rate: number, rateSource: string) =>
    void send(p.start, () => apiSend("PUT", `/instruments/${isin}/coupons/${p.start}`, { rate, rateSource }), `${code}: rate ${fmtRate(rate)} for the period from ${p.start} saved.`);
  const saveDraft = () => {
    if (!draft) return;
    const rate = parseNum(draft.rate);
    if (rate !== undefined && !(rate > 0 && rate < 100)) return setError("Rate: a percentage, e.g. 7,13.");
    const body = { start: draft.start, end: draft.end, recordDate: draft.recordDate || null, paymentDate: draft.paymentDate, rate: rate === undefined ? null : Number((rate / 100).toFixed(6)) };
    const isNew = editing === "new";
    void send(
      isNew ? "new" : draft.start,
      () => (isNew ? apiSend("POST", `/instruments/${isin}/coupons`, body) : apiSend("PUT", `/instruments/${isin}/coupons/${draft.start}`, body)),
      `${code}: period from ${draft.start} saved.`,
    );
  };
  const remove = (p: InterestPeriod) => {
    if (confirm !== p.start) return setConfirm(p.start);
    void send(p.start, () => apiSend("DELETE", `/instruments/${isin}/coupons/${p.start}`), `${code}: period from ${p.start} deleted.`);
  };
  const startNew = () => {
    const last = periods[0];
    setEditing("new");
    setError(null);
    setDraft(last ? { start: last.end, end: "", recordDate: "", paymentDate: "", rate: "" } : { start: "", end: "", recordDate: "", paymentDate: "", rate: "" });
  };

  const field = (k: keyof Draft, label: string, type = "date") => (
    <input
      type={type}
      inputMode={type === "text" ? "decimal" : undefined}
      value={draft?.[k] ?? ""}
      onChange={(e) => setDraft((x) => x && { ...x, [k]: e.target.value })}
      aria-label={label}
      placeholder={type === "text" ? "% a year" : undefined}
      data-testid={`coupon-edit-${k}`}
    />
  );
  const editRow = (key: string) => (
    <tr className="coupon-edit" key={`edit-${key}`}>
      <td className="left">{key === "new" ? field("start", "First day") : draft?.start}</td>
      <td className="left ends">{field("end", "Next period starts")}</td>
      <td className="left">{field("recordDate", "Record day")}</td>
      <td className="left">{field("paymentDate", "Payment day")}</td>
      <td>{field("rate", "Rate, % a year", "text")}</td>
      <td colSpan={2} className="left">
        <button type="button" className="primary" onClick={saveDraft} disabled={pending !== null} data-testid="coupon-edit-save">
          {pending === key && <span className="spinner" aria-hidden />}
          {pending === key ? "Saving…" : "Save"}
        </button>{" "}
        <button type="button" onClick={() => (setEditing(null), setDraft(null))} disabled={pending !== null}>
          Cancel
        </button>
      </td>
    </tr>
  );

  return (
    <div className="coupon-periods" data-testid="coupon-periods">
      {data.error && <p className="error">{data.error}</p>}
      {error && (
        <p className="error" data-testid="coupon-error">
          {error}
        </p>
      )}
      <div className="table-wrap">
        <table className="static compact">
          <thead>
            <tr>
              <th className="left">Period</th>
              <th className="left ends">Ends</th>
              <th className="left">Record day</th>
              <th className="left">Paid</th>
              <th>Rate</th>
              <th>Coupon / bond</th>
              <th className="left">Your coupons (before tax)</th>
            </tr>
          </thead>
          <tbody>
            {data.loading && !d && (
              <tr>
                <td className="left muted" colSpan={7}>
                  Loading…
                </td>
              </tr>
            )}
            {editing === "new" && editRow("new")}
            {shown.map((p) => {
              if (editing === p.start) return editRow(p.start);
              const c = byStart.get(p.start);
              const current = p.start <= now && now < p.end;
              const perBond = p.rate === undefined || !d ? undefined : Math.round(((d.nominal * p.rate * days(p.start, p.end)) / 365) * 100) / 100;
              const suggestion = p.rate === undefined || (c?.suggestedRate !== undefined && Math.abs(c.suggestedRate - p.rate) > 1e-7 && c.checks.some((x) => x.mismatch)) ? c?.suggestedRate : undefined;
              return (
                <Fragment key={p.start}>
                  <tr data-testid="coupon-period" data-start={p.start} className={`${current ? "current" : ""}${pending === p.start ? " pending" : ""}`}>
                    <td className="left">
                      {p.start}
                      {current && <span className="flag">now</span>}
                    </td>
                    <td className="left ends">{p.end}</td>
                    <td className="left">{p.recordDate ?? <span className="muted">–</span>}</td>
                    <td className="left">{p.paymentDate}</td>
                    <td title={p.rateSource ? `Set by: ${SOURCE_LABELS[p.rateSource] ?? p.rateSource}` : "No rate: no accrued interest in this period (clean price only)"} data-testid="coupon-rate">
                      {p.rate === undefined ? <span className="flag warn">no rate</span> : fmtRate(p.rate)}
                      {p.rateSource && <span className="faint small"> · {SOURCE_LABELS[p.rateSource] ?? p.rateSource}</span>}
                    </td>
                    <td>{perBond === undefined ? "–" : fmtMoney(perBond, "PLN")}</td>
                    <td className="left wrap">
                      {(c?.checks ?? []).map((x: CouponCheck) => (
                        <div key={`${x.account}${x.date}`} className={x.mismatch ? "neg" : ""} title={`${x.account}, ${x.date}: ${fmtMoney(x.amount, "PLN")} received${x.taxAssumed ? ", 19 % tax assumed" : ""}; ${x.quantity} bonds on the record day; fits ${fmtRate(x.rateRange[0])} – ${fmtRate(x.rateRange[1])}`}>
                          {fmtMoney(x.gross, "PLN")} <span className="muted">· {x.quantity} bonds</span>
                          {x.mismatch && x.expected !== undefined && <span> · expected {fmtMoney(x.expected, "PLN")}</span>}
                        </div>
                      ))}
                      <div className="coupon-actions">
                        {suggestion !== undefined && (
                          <button type="button" className="link" onClick={() => setRate(p, suggestion, "coupons")} disabled={pending !== null} data-testid="coupon-use-suggested">
                            Use {fmtRate(suggestion)} (your coupons)
                          </button>
                        )}
                        {p.otherRate && (
                          <button type="button" className="link" onClick={() => setRate(p, p.otherRate!.rate, p.otherRate!.source)} disabled={pending !== null} data-testid="coupon-use-other" title={`Seen ${p.otherRate.seenAt.slice(0, 10)}; yours is kept until you choose`}>
                            ⚠ {SOURCE_LABELS[p.otherRate.source]} shows {fmtRate(p.otherRate.rate)}: use it
                          </button>
                        )}
                        <button type="button" className="link" onClick={() => (setEditing(p.start), setDraft(draftOf(p)), setError(null))} disabled={pending !== null} data-testid="coupon-edit">
                          Edit
                        </button>
                        <button
                          type="button"
                          className={confirm === p.start ? "danger" : "link"}
                          onClick={() => remove(p)}
                          disabled={pending !== null}
                          title={confirm === p.start ? "Click again to delete" : "Delete this period"}
                          data-testid="coupon-delete"
                        >
                          {confirm === p.start ? "Delete?" : "✕"}
                        </button>
                      </div>
                    </td>
                  </tr>
                </Fragment>
              );
            })}
            {d && periods.length === 0 && editing !== "new" && (
              <tr>
                <td className="left muted" colSpan={7}>
                  No periods yet: valued at the clean price only. They come from obligacje.pl each morning, or add them here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="coupon-footer">
        <button type="button" onClick={startNew} disabled={pending !== null || editing !== null} data-testid="coupon-add">
          Add a period
        </button>
        {future.length > 1 && (
          <button type="button" className="link" onClick={() => setShowFuture((v) => !v)} data-testid="coupon-future">
            {showFuture ? "Hide later periods" : `Show ${future.length - 1} later periods`}
          </button>
        )}
        {(d?.unmatched.length ?? 0) > 0 && (
          <span className="muted small" data-testid="coupon-unmatched">
            Coupons that fit no period: {d!.unmatched.map((t) => `${t.date} ${fmtMoney(t.amount, t.currency)} (${t.account})`).join("; ")}
          </span>
        )}
      </div>
    </div>
  );
}
