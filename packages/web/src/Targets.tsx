import { useEffect, useState } from "react";
import { rebalance, type RebalanceMode, type Targets } from "@portfolio/core/targets/targets";
import { ASSET_CLASSES, valueByClass, type AssetClass } from "@portfolio/core/valuation/history";
import { apiSend } from "./api.ts";
import { CLASS_LABELS } from "./Allocation.tsx";
import { fmtNum, fmtPln, parseNum } from "./format.ts";
import { Skeleton } from "./Placeholders.tsx";
import type { Snapshot } from "./types.ts";
import { useApi } from "./useApi.ts";
import { useNarrow } from "./useNarrow.ts";

export interface TargetsResponse {
  targets: Targets | null;
}

/** A row of the form: target and band as typed ("60", "2,5"). */
type Draft = Record<AssetClass, { target: string; band: string }>;
const numText = (v: number) => fmtNum(v, v % 1 ? 1 : 0).replace(/\s/g, "");
const draftOf = (t: Targets | null): Draft =>
  Object.fromEntries(ASSET_CLASSES.map((k) => [k, { target: t ? numText(t.targets[k]) : "", band: t ? numText(t.bands[k]) : k === "CASH" ? "2" : "5" }])) as Draft;
const sumOf = (d: Draft) => ASSET_CLASSES.reduce((s, k) => s + (parseNum(d[k].target) ?? 0), 0);
const sign = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "");
const signedPp = (v: number) => `${sign(v)}${fmtNum(Math.abs(v), 1)} pp`;

/**
 * Targets and rebalancing (road map 8), under the asset mix: per class the actual share against its target and band,
 * and the calculator: "New money" splits a deposit across the classes below target without selling, "Sell and buy"
 * takes every class to its target.
 */
export function TargetsPanel({ snapshot }: { snapshot?: Snapshot }) {
  const res = useApi<TargetsResponse>("/targets");
  const saved = res.data?.targets ?? null;
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<RebalanceMode>("NEW_MONEY");
  const [amount, setAmount] = useState("");
  const narrow = useNarrow();

  const heading = (
    <h2 className="targets-heading">
      Targets <span className="muted chart-legend wide-only">target vs actual per class; what to buy or sell</span>
      {saved && !editing && (
        <button type="button" className="link" onClick={() => setEditing(true)} data-testid="targets-edit">
          Edit targets
        </button>
      )}
    </h2>
  );
  if (!res.data || !snapshot) {
    return (
      <>
        {heading}
        {res.error ? <p className="error">{res.error}</p> : <section className="panel targets"><Skeleton height={120} testId="targets-skeleton" /></section>}
      </>
    );
  }
  if (editing || !saved) {
    return (
      <>
      {heading}
      <TargetsForm
        saved={saved}
        editing={editing}
        onEdit={() => setEditing(true)}
        onDone={(t) => {
          res.update(() => ({ targets: t }));
          setEditing(false);
        }}
      />
      </>
    );
  }

  const money = parseNum(amount);
  const badAmount = mode === "NEW_MONEY" && amount.trim() !== "" && !(money !== undefined && money > 0);
  const rows = rebalance(valueByClass(snapshot), saved, mode, money && money > 0 ? money : 0);
  const showTrades = mode === "SELL_AND_BUY" || (money !== undefined && money > 0);
  const off = rows.filter((r) => r.status !== "WITHIN").length;
  return (
    <>
    {heading}
    <section className="panel targets" data-testid="targets">
      <div className="targets-controls">
        <span className="segmented" role="group" aria-label="Calculator" data-testid="targets-mode">
          {(["NEW_MONEY", "SELL_AND_BUY"] as const).map((m) => (
            <button key={m} type="button" className={m === mode ? "active" : ""} aria-pressed={m === mode} onClick={() => setMode(m)}>
              {m === "NEW_MONEY" ? "New money" : "Sell and buy"}
            </button>
          ))}
        </span>
        {mode === "NEW_MONEY" && (
          <label className="targets-amount" title="The money to put in: split across the classes below target, nothing sold">
            <input inputMode="decimal" placeholder="amount" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="New money" data-testid="targets-amount" />
            <span className="muted">zł</span>
          </label>
        )}
        {!narrow && (
          <span className={`muted targets-summary ${off ? "off" : ""}`} data-testid="targets-summary">
            {off ? `${off} ${off > 1 ? "classes" : "class"} outside the band` : "All within their bands"}
          </span>
        )}
      </div>
      {badAmount && <p className="error">The amount needs a number above 0.</p>}
      <div className="table-wrap flat">
        <table className="static" data-testid="targets-table">
          <thead>
            <tr>
              <th>Class</th>
              {/* On a phone four columns: the target under the actual share, the trade in whole złoty. */}
              <th>{narrow ? "Now" : "Actual"}</th>
              {!narrow && <th>Value</th>}
              {!narrow && <th>Target</th>}
              <th>Diff</th>
              <th title={mode === "NEW_MONEY" ? "Where the new money goes" : "What to sell and buy to be on target"}>
                {narrow ? (mode === "NEW_MONEY" ? "Buy zł" : "Trade zł") : mode === "NEW_MONEY" ? "Buy" : "Buy / sell"}
              </th>
              {!narrow && <th title="Share after the trades">After</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.assetClass} data-testid={`targets-${r.assetClass}`} className={r.status !== "WITHIN" ? "off-band" : ""} title={narrow ? fmtPln(r.value) : undefined}>
                <td>
                  <i className={`mix-dot mix-${r.assetClass}`} aria-hidden /> {CLASS_LABELS[r.assetClass]}
                </td>
                <td>
                  {fmtNum(r.actual, 1)} %
                  {narrow && <span className="sub muted">of {fmtNum(r.target, r.target % 1 ? 1 : 0)} %</span>}
                </td>
                {!narrow && <td className="muted">{fmtPln(r.value)}</td>}
                {!narrow && (
                  <td title={`band ± ${fmtNum(saved.bands[r.assetClass], 1)} pp`}>
                    {fmtNum(r.target, r.target % 1 ? 1 : 0)} %<span className="muted"> ± {fmtNum(saved.bands[r.assetClass], saved.bands[r.assetClass] % 1 ? 1 : 0)}</span>
                  </td>
                )}
                <td data-testid={`targets-${r.assetClass}-diff`}>
                  {r.target === 0 && r.value === 0 ? "–" : signedPp(r.diff)}
                  {r.status !== "WITHIN" && <span className="flag warn-soft">{r.status === "OVER" ? "over" : "under"}</span>}
                </td>
                <td className={`trade ${r.trade > 0 ? "pos" : r.trade < 0 ? "neg" : "muted"}`} data-testid={`targets-${r.assetClass}-trade`}>
                  {!showTrades || Math.abs(r.trade) < 0.5 ? "–" : narrow ? `${sign(r.trade)}${fmtNum(Math.abs(r.trade), 0)}` : `${r.trade > 0 ? "buy" : "sell"} ${fmtPln(Math.abs(r.trade))}`}
                </td>
                {!narrow && <td className="muted">{showTrades ? `${fmtNum(r.after, 1)} %` : "–"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {mode === "NEW_MONEY" && !showTrades && <p className="muted hint">Type the amount you're putting in: it goes to the classes furthest below their target first, nothing is sold.</p>}
      {mode === "SELL_AND_BUY" && <p className="muted hint">Every class to its target; the sales pay for the buys. Before tax and commission.</p>}
    </section>
    </>
  );
}

/** Setting the targets (adding up to 100 %) and the bands; also shown in place of the table until targets are set. */
function TargetsForm({ saved, editing, onEdit, onDone }: { saved: Targets | null; editing: boolean; onEdit: () => void; onDone: (t: Targets | null) => void }) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(saved));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(draftOf(saved)), [saved]);
  if (!saved && !editing) {
    return (
      <section className="panel targets" data-testid="targets">
        <p className="muted targets-empty">
          No targets yet. Set a target share per class to see how far the mix is from it and what to buy or sell.{" "}
          <button type="button" className="link" onClick={onEdit} data-testid="targets-edit">
            Set targets
          </button>
        </p>
      </section>
    );
  }
  const sum = sumOf(draft);
  const sumOk = Math.abs(sum - 100) < 0.005;
  const send = async (body: unknown) => {
    setPending(true);
    setError(null);
    try {
      const r = await apiSend<TargetsResponse>("PUT", "/targets", body);
      onDone(r.targets);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };
  const save = () => {
    const parsed = ASSET_CLASSES.map((k) => [k, parseNum(draft[k].target) ?? 0, parseNum(draft[k].band) ?? 0] as const);
    if (parsed.some(([, t, b]) => Number.isNaN(t) || Number.isNaN(b) || t < 0 || b < 0)) return setError("Targets and bands need numbers of 0 or more.");
    void send({ targets: Object.fromEntries(parsed.map(([k, t]) => [k, t])), bands: Object.fromEntries(parsed.map(([k, , b]) => [k, b])) });
  };
  const cell = (k: AssetClass, f: "target" | "band", label: string) => (
    <span className="with-unit">
      <input inputMode="decimal" value={draft[k][f]} placeholder="0" aria-label={`${CLASS_LABELS[k]} ${label}`} onChange={(e) => setDraft({ ...draft, [k]: { ...draft[k], [f]: e.target.value } })} data-testid={`targets-${k}-${f}`} />
      <span className="muted">{f === "target" ? "%" : "pp"}</span>
    </span>
  );
  return (
    <section className="panel targets" data-testid="targets-form">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <table className="static targets-inputs">
          <thead>
            <tr>
              <th>Class</th>
              <th>Target</th>
              <th title="How far a class may drift from its target before it counts as off target">± Band</th>
            </tr>
          </thead>
          <tbody>
            {ASSET_CLASSES.map((k) => (
              <tr key={k}>
                <td>
                  <i className={`mix-dot mix-${k}`} aria-hidden /> {CLASS_LABELS[k]}
                </td>
                <td>{cell(k, "target", "target")}</td>
                <td>{cell(k, "band", "band")}</td>
              </tr>
            ))}
            <tr className="total">
              <td>Total</td>
              <td className={sumOk ? "" : "neg"} data-testid="targets-sum">
                {fmtNum(sum, sum % 1 ? 1 : 0)} %{sumOk ? " ✓" : ""}
              </td>
              <td />
            </tr>
          </tbody>
        </table>
        {!sumOk && <p className="muted hint">The targets must add up to 100 %.</p>}
        <span className="hs-buttons">
          <button type="submit" className="primary" disabled={pending || !sumOk} data-testid="targets-save">
            {pending && <span className="spinner" aria-hidden />}
            Save
          </button>
          {editing && (
            <button type="button" className="link" disabled={pending} onClick={() => onDone(saved)} data-testid="targets-cancel">
              Cancel
            </button>
          )}
          {saved && (
            <button type="button" className="link" disabled={pending} onClick={() => void send({ reset: true })} data-testid="targets-remove">
              Remove targets
            </button>
          )}
        </span>
        {error && <p className="error">{error}</p>}
      </form>
    </section>
  );
}
