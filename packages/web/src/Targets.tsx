import { useEffect, useState } from "react";
import { rebalance, type RebalanceMode, type Targets } from "@portfolio/core/targets/targets";
import { ASSET_CLASSES, valueByClass, type AssetClass } from "@portfolio/core/valuation/history";
import { apiSend } from "./api.ts";
import { CLASS_LABELS } from "./Allocation.tsx";
import { fmtNum, fmtPln, parseNum } from "./format.ts";
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
const pct = (v: number) => `${fmtNum(v, v % 1 ? 1 : 0)} %`;

/** Whether "Rebalance" is open, remembered in this browser (closed when storage isn't there). */
const OPEN_KEY = "dashboard.rebalanceOpen";
const readOpen = () => {
  try {
    return localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
};
const writeOpen = (open: boolean) => {
  try {
    localStorage.setItem(OPEN_KEY, open ? "1" : "0");
  } catch {
    // a private window: not remembered
  }
};

/**
 * The asset mix with its targets (road map 8): one bar split into shares, bonds (incl. bond ETFs), cash and other
 * (positions + cash of the fully tracked accounts), with a tick where each class's target ends; the legend gives each
 * class's share, its target and the difference (red outside the band). "Rebalance" folds out the calculator: "New
 * money" splits a deposit across the classes below target without selling, "Sell and buy" takes every class to its
 * target. Whether it's open is remembered.
 */
export function AssetMixPanel({ snapshot }: { snapshot: Snapshot }) {
  const res = useApi<TargetsResponse>("/targets");
  const saved = res.data?.targets ?? null;
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(readOpen);
  const byClass = valueByClass(snapshot);
  const total = ASSET_CLASSES.reduce((s, k) => s + byClass[k], 0);
  const rows = saved ? rebalance(byClass, saved, "SELL_AND_BUY") : null;
  // Without targets the empty classes are left out; with targets every class with a target shows.
  const shown = ASSET_CLASSES.filter((k) => byClass[k] > 0 || (saved && saved.targets[k] > 0));
  // A tick where each class's target ends, adding up from the left (none at the right edge).
  const ticks: { key: (typeof ASSET_CLASSES)[number]; at: number }[] = [];
  let edge = 0;
  for (const k of ASSET_CLASSES) {
    if (!saved || !(saved.targets[k] > 0)) continue;
    edge += saved.targets[k];
    if (edge < 99.95) ticks.push({ key: k, at: edge });
  }
  const toggle = () => {
    writeOpen(!open);
    setOpen(!open);
  };
  return (
    <section className="asset-mix" data-testid="asset-mix" aria-label="Asset mix">
      <div className="mix-track">
        <div className="mix-bar" aria-hidden>
          {ASSET_CLASSES.filter((k) => byClass[k] > 0).map((k) => (
            <span key={k} className={`mix-${k}`} style={{ width: `${((byClass[k] / total) * 100).toFixed(2)}%` }} title={`${CLASS_LABELS[k]}: ${fmtNum((byClass[k] / total) * 100, 1)} %`} />
          ))}
        </div>
        {ticks.map((t) => (
          <i key={t.key} className="mix-target" style={{ left: `${t.at.toFixed(2)}%` }} title={`${CLASS_LABELS[t.key]} target ends at ${fmtNum(t.at, 1)} %`} data-testid={`mix-target-${t.key}`} />
        ))}
      </div>
      <div className="mix-foot">
        <ul className={`mix-legend ${rows ? "with-targets" : ""}`}>
          {shown.map((k) => {
            const row = rows?.find((r) => r.assetClass === k);
            return (
              <li key={k} data-testid={`asset-mix-${k}`} title={fmtPln(byClass[k])}>
                <span className="mix-name">
                  <i className={`mix-dot mix-${k}`} aria-hidden /> {CLASS_LABELS[k]}
                </span>
                <strong>{fmtNum(total ? (byClass[k] / total) * 100 : 0, 1)} %</strong>
                {row && saved && (
                  <>
                    <span className="muted" data-testid={`asset-mix-${k}-target`}>
                      of {pct(row.target)}
                    </span>
                    <span className={row.status === "WITHIN" ? "muted" : "neg"} data-testid={`asset-mix-${k}-diff`} title={`${row.status === "WITHIN" ? "within" : "outside"} the ± ${fmtNum(saved.bands[k], 1)} pp band`}>
                      {signedPp(row.diff)}
                    </span>
                  </>
                )}
                <span className="muted mix-value">{fmtPln(byClass[k])}</span>
              </li>
            );
          })}
        </ul>
        {res.data && !editing && (
          <div className="mix-actions">
            {saved && (
              <button type="button" className="link" aria-expanded={open} onClick={toggle} data-testid="targets-rebalance">
                Rebalance {open ? "▾" : "▸"}
              </button>
            )}
            <button type="button" className="link" onClick={() => setEditing(true)} data-testid="targets-edit">
              {saved ? "Edit targets" : "Set targets"}
            </button>
          </div>
        )}
      </div>
      {editing ? (
        <TargetsForm
          saved={saved}
          onDone={(t) => {
            res.update(() => ({ targets: t }));
            setEditing(false);
          }}
        />
      ) : (
        saved && open && <Rebalance byClass={byClass} saved={saved} />
      )}
    </section>
  );
}

/** The calculator: the switch, the amount (new money), and per class the trade and the share after it. */
function Rebalance({ byClass, saved }: { byClass: Record<AssetClass, number>; saved: Targets }) {
  const [mode, setMode] = useState<RebalanceMode>("NEW_MONEY");
  const [amount, setAmount] = useState("");
  const narrow = useNarrow();
  const money = parseNum(amount);
  const badAmount = mode === "NEW_MONEY" && amount.trim() !== "" && !(money !== undefined && money > 0);
  const rows = rebalance(byClass, saved, mode, money && money > 0 ? money : 0);
  const showTrades = mode === "SELL_AND_BUY" || (money !== undefined && money > 0);
  return (
    <div className="targets" data-testid="targets">
      <div className="targets-controls">
        {/* biome-ignore lint/a11y/useSemanticElements: a segmented control; a <fieldset> would bring its own box and legend */}
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
      </div>
      {badAmount && <p className="error">The amount needs a number above 0.</p>}
      <table className="static" data-testid="targets-table">
        <thead>
          <tr>
            <th>Class</th>
            {!narrow && <th>Value</th>}
            <th title={mode === "NEW_MONEY" ? "Where the new money goes" : "What to sell and buy to be on target"}>
              {narrow ? (mode === "NEW_MONEY" ? "Buy zł" : "Trade zł") : mode === "NEW_MONEY" ? "Buy" : "Buy / sell"}
            </th>
            <th title="The share after the trades, and the target">After</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.assetClass} data-testid={`targets-${r.assetClass}`}>
              <td>
                <i className={`mix-dot mix-${r.assetClass}`} aria-hidden /> {CLASS_LABELS[r.assetClass]}
              </td>
              {!narrow && <td className="muted">{fmtPln(r.value)}</td>}
              <td className={r.trade > 0 ? "pos" : r.trade < 0 ? "neg" : "muted"} data-testid={`targets-${r.assetClass}-trade`}>
                {!showTrades || Math.abs(r.trade) < 0.5 ? "–" : narrow ? `${sign(r.trade)}${fmtNum(Math.abs(r.trade), 0)}` : `${r.trade > 0 ? "buy" : "sell"} ${fmtPln(Math.abs(r.trade))}`}
              </td>
              <td data-testid={`targets-${r.assetClass}-after`}>
                {showTrades ? `${fmtNum(r.after, 1)} %` : "–"}
                <span className="sub muted">of {pct(r.target)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {mode === "NEW_MONEY" && !showTrades && <p className="muted hint">Type the amount you're putting in: it goes to the classes furthest below their target first, nothing is sold.</p>}
      {mode === "SELL_AND_BUY" && <p className="muted hint">Every class to its target; the sales pay for the buys. Before tax and commission.</p>}
    </div>
  );
}

/** Setting the targets (adding up to 100 %) and the bands, in the asset mix panel. */
function TargetsForm({ saved, onDone }: { saved: Targets | null; onDone: (t: Targets | null) => void }) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(saved));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(draftOf(saved)), [saved]);
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
    <div className="targets" data-testid="targets-form">
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
          <button type="button" className="link" disabled={pending} onClick={() => onDone(saved)} data-testid="targets-cancel">
            Cancel
          </button>
          {saved && (
            <button type="button" className="link" disabled={pending} onClick={() => void send({ reset: true })} data-testid="targets-remove">
              Remove targets
            </button>
          )}
        </span>
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  );
}
