import { type ReactNode, useEffect, useState } from "react";
import { type KeyTargets, rebalanceBy, type RebalanceMode, type Targets } from "@portfolio/core/targets/targets";
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

/**
 * What makes a mix panel: the asset mix (classes) or the regions. The keys in the bar's order, their names and colour
 * classes, the legend (left column first, then the right one), the band a new target starts with, where the targets
 * are saved, and the test ids (`panel-<key>`, `<targets>-<key>-trade`, `<tick>-<key>`…).
 */
export interface MixConfig<K extends string> {
  keys: readonly K[];
  labels: Record<K, string>;
  /** The CSS class giving a key its colour (`.mix-SHARES`, `.region-US`). */
  color: (k: K) => string;
  legendLeft: readonly K[];
  legendRight: readonly K[];
  defaultBand: (k: K) => number;
  /** PUT path of the targets (`{ targets, bands }` or `{ reset: true }`, answering `{ targets }`). */
  targetsPath: string;
  /** Column header in the calculator and the form: "Class", "Region". */
  noun: string;
  /** "classes", "regions", in the hints. */
  plural: string;
  /** Whether "Rebalance" is open, remembered in this browser under this key. */
  openKey: string;
  ariaLabel: string;
  ids: { panel: string; tick: string; targets: string };
}

/** A row of the form: target and band as typed ("60", "2,5"). */
type Draft<K extends string> = Record<K, { target: string; band: string }>;
const numText = (v: number) => fmtNum(v, v % 1 ? 1 : 0).replace(/\s/g, "");
const sign = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "");
const signedPp = (v: number) => `${sign(v)}${fmtNum(Math.abs(v), 1)} pp`;
const pct = (v: number) => `${fmtNum(v, v % 1 ? 1 : 0)}%`;

const readOpen = (key: string) => {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
};
const writeOpen = (key: string, open: boolean) => {
  try {
    localStorage.setItem(key, open ? "1" : "0");
  } catch {
    // a private window: not remembered
  }
};

/** A folding section's open state, remembered in this browser (closed when storage isn't there). */
export function useRememberedOpen(key: string): [boolean, () => void] {
  const [open, setOpen] = useState(() => readOpen(key));
  return [
    open,
    () => {
      writeOpen(key, !open);
      setOpen(!open);
    },
  ];
}

const ASSET_MIX: MixConfig<AssetClass> = {
  keys: ASSET_CLASSES,
  labels: CLASS_LABELS,
  color: (k) => `mix-${k}`,
  legendLeft: ["BONDS", "SHARES"],
  legendRight: ["CASH", "OTHER"],
  defaultBand: (k) => (k === "CASH" ? 2 : 5),
  targetsPath: "/targets",
  noun: "Class",
  plural: "classes",
  openKey: "dashboard.rebalanceOpen",
  ariaLabel: "Asset mix",
  ids: { panel: "asset-mix", tick: "mix-target", targets: "targets" },
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
  return <MixPanel config={ASSET_MIX} values={valueByClass(snapshot)} saved={res.data?.targets ?? null} ready={!!res.data} onSaved={(t) => res.update(() => ({ targets: t }))} />;
}

/**
 * A mix with its targets: the bar (a tick where each key's target ends), the legend (share, "of" the target, the
 * difference, the amount), "Rebalance ▸" (the calculator) and "Set / Edit targets" (the form). `actions` go before
 * "Edit targets", `children` under the legend (before the calculator or the form).
 */
export function MixPanel<K extends string>({
  config: c,
  values,
  saved,
  ready,
  onSaved,
  actions,
  children,
}: {
  config: MixConfig<K>;
  values: Record<K, number>;
  saved: KeyTargets<K> | null;
  ready: boolean;
  onSaved: (t: KeyTargets<K> | null) => void;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [open, toggle] = useRememberedOpen(c.openKey);
  const total = c.keys.reduce((s, k) => s + values[k], 0);
  const rows = saved ? rebalanceBy(c.keys, values, saved, "SELL_AND_BUY") : null;
  // Without targets the empty keys are left out; with targets every key with a target shows. The left column first
  // (on a wide screen), then the right one.
  const shown = [...c.legendLeft, ...c.legendRight].filter((k) => values[k] > 0 || (saved && saved.targets[k] > 0));
  // A tick where each key's target ends, adding up from the left (none at the right edge).
  const ticks: { key: K; at: number }[] = [];
  let edge = 0;
  for (const k of c.keys) {
    if (!saved || !(saved.targets[k] > 0)) continue;
    edge += saved.targets[k];
    if (edge < 99.95) ticks.push({ key: k, at: edge });
  }
  const p = c.ids.panel;
  return (
    <section className="asset-mix" data-testid={p} aria-label={c.ariaLabel}>
      <div className="mix-track">
        <div className="mix-bar" aria-hidden>
          {c.keys
            .filter((k) => values[k] > 0)
            .map((k) => (
              <span key={k} className={c.color(k)} style={{ width: `${((values[k] / total) * 100).toFixed(2)}%` }} title={`${c.labels[k]}: ${fmtNum((values[k] / total) * 100, 1)}%`} />
            ))}
        </div>
        {ticks.map((t) => (
          <i key={t.key} className="mix-target" style={{ left: `${t.at.toFixed(2)}%` }} title={`${c.labels[t.key]} target ends at ${fmtNum(t.at, 1)}%`} data-testid={`${c.ids.tick}-${t.key}`} />
        ))}
      </div>
      <div className="mix-foot">
        <ul className={`mix-legend ${rows ? "with-targets" : ""}`}>
          {shown.map((k) => {
            const row = rows?.find((r) => r.key === k);
            return (
              <li key={k} className={c.legendRight.includes(k) ? "mix-right" : "mix-left"} data-testid={`${p}-${k}`} title={fmtPln(values[k])}>
                <span className="mix-name">
                  <i className={`mix-dot ${c.color(k)}`} aria-hidden /> {c.labels[k]}
                </span>
                <strong>{fmtNum(total ? (values[k] / total) * 100 : 0, 1)}%</strong>
                {row && saved && (
                  <>
                    <span className="muted" data-testid={`${p}-${k}-target`}>
                      of {pct(row.target)}
                    </span>
                    <span className={row.status === "WITHIN" ? "muted" : "neg"} data-testid={`${p}-${k}-diff`} title={`${row.status === "WITHIN" ? "within" : "outside"} the ± ${fmtNum(saved.bands[k], 1)} pp band`}>
                      {signedPp(row.diff)}
                    </span>
                  </>
                )}
                <span className="muted mix-value">{fmtPln(values[k])}</span>
              </li>
            );
          })}
        </ul>
        {ready && !editing && (
          <div className="mix-actions">
            {(saved || actions) && (
              <span className="mix-actions-left">
                {saved && (
                  <button type="button" className="link" aria-expanded={open} onClick={toggle} data-testid={`${c.ids.targets}-rebalance`}>
                    Rebalance {open ? "▾" : "▸"}
                  </button>
                )}
                {actions}
              </span>
            )}
            <button type="button" className="link" onClick={() => setEditing(true)} data-testid={`${c.ids.targets}-edit`}>
              {saved ? "Edit targets" : "Set targets"}
            </button>
          </div>
        )}
      </div>
      {children}
      {editing ? (
        <TargetsForm
          config={c}
          saved={saved}
          onDone={(t) => {
            onSaved(t);
            setEditing(false);
          }}
        />
      ) : (
        saved && open && <Rebalance config={c} values={values} saved={saved} />
      )}
    </section>
  );
}

/** The calculator: the switch, the amount (new money), and per key the trade and the share after it. */
function Rebalance<K extends string>({ config: c, values, saved }: { config: MixConfig<K>; values: Record<K, number>; saved: KeyTargets<K> }) {
  const [mode, setMode] = useState<RebalanceMode>("NEW_MONEY");
  const [amount, setAmount] = useState("");
  const narrow = useNarrow();
  const money = parseNum(amount);
  const badAmount = mode === "NEW_MONEY" && amount.trim() !== "" && !(money !== undefined && money > 0);
  const rows = rebalanceBy(c.keys, values, saved, mode, money && money > 0 ? money : 0);
  const showTrades = mode === "SELL_AND_BUY" || (money !== undefined && money > 0);
  const t = c.ids.targets;
  return (
    <div className="targets" data-testid={t}>
      <div className="targets-controls">
        {/* biome-ignore lint/a11y/useSemanticElements: a segmented control; a <fieldset> would bring its own box and legend */}
        <span className="segmented" role="group" aria-label="Calculator" data-testid={`${t}-mode`}>
          {(["NEW_MONEY", "SELL_AND_BUY"] as const).map((m) => (
            <button key={m} type="button" className={m === mode ? "active" : ""} aria-pressed={m === mode} onClick={() => setMode(m)}>
              {m === "NEW_MONEY" ? "New money" : "Sell and buy"}
            </button>
          ))}
        </span>
        {mode === "NEW_MONEY" && (
          <label className="targets-amount" title={`The money to put in: split across the ${c.plural} below target, nothing sold`}>
            <input inputMode="decimal" placeholder="amount" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="New money" data-testid={`${t}-amount`} />
            <span className="muted">zł</span>
          </label>
        )}
      </div>
      {badAmount && <p className="error">The amount needs a number above 0.</p>}
      <table className="static" data-testid={`${t}-table`}>
        <thead>
          <tr>
            <th>{c.noun}</th>
            {!narrow && <th>Value</th>}
            <th title={mode === "NEW_MONEY" ? "Where the new money goes" : "What to sell and buy to be on target"}>
              {narrow ? (mode === "NEW_MONEY" ? "Buy zł" : "Trade zł") : mode === "NEW_MONEY" ? "Buy" : "Buy / sell"}
            </th>
            <th title="The share after the trades, and the target">After</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} data-testid={`${t}-${r.key}`}>
              <td>
                <i className={`mix-dot ${c.color(r.key)}`} aria-hidden /> {c.labels[r.key]}
              </td>
              {!narrow && <td className="muted">{fmtPln(r.value)}</td>}
              <td className={r.trade > 0 ? "pos" : r.trade < 0 ? "neg" : "muted"} data-testid={`${t}-${r.key}-trade`}>
                {!showTrades || Math.abs(r.trade) < 0.5 ? "–" : narrow ? `${sign(r.trade)}${fmtNum(Math.abs(r.trade), 0)}` : `${r.trade > 0 ? "buy" : "sell"} ${fmtPln(Math.abs(r.trade))}`}
              </td>
              <td data-testid={`${t}-${r.key}-after`}>
                {showTrades ? `${fmtNum(r.after, 1)}%` : "–"}
                <span className="sub muted">of {pct(r.target)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {mode === "NEW_MONEY" && !showTrades && <p className="muted hint">Type the amount you're putting in: it goes to the {c.plural} furthest below their target first, nothing is sold.</p>}
      {mode === "SELL_AND_BUY" && <p className="muted hint">Every {c.noun.toLowerCase()} to its target; the sales pay for the buys. Before tax and commission.</p>}
    </div>
  );
}

/** Setting the targets (adding up to 100%) and the bands, in the panel. */
function TargetsForm<K extends string>({ config: c, saved, onDone }: { config: MixConfig<K>; saved: KeyTargets<K> | null; onDone: (t: KeyTargets<K> | null) => void }) {
  const draftOf = (s: KeyTargets<K> | null): Draft<K> => Object.fromEntries(c.keys.map((k) => [k, { target: s ? numText(s.targets[k]) : "", band: numText(s ? s.bands[k] : c.defaultBand(k)) }])) as Draft<K>;
  const [draft, setDraft] = useState<Draft<K>>(() => draftOf(saved));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the form only when the saved targets change
  useEffect(() => setDraft(draftOf(saved)), [saved]);
  const sum = c.keys.reduce((s, k) => s + (parseNum(draft[k].target) ?? 0), 0);
  const sumOk = Math.abs(sum - 100) < 0.005;
  const t = c.ids.targets;
  const send = async (body: unknown) => {
    setPending(true);
    setError(null);
    try {
      const r = await apiSend<{ targets: KeyTargets<K> | null }>("PUT", c.targetsPath, body);
      onDone(r.targets);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };
  const save = () => {
    const parsed = c.keys.map((k) => [k, parseNum(draft[k].target) ?? 0, parseNum(draft[k].band) ?? 0] as const);
    if (parsed.some(([, tv, b]) => Number.isNaN(tv) || Number.isNaN(b) || tv < 0 || b < 0)) return setError("Targets and bands need numbers of 0 or more.");
    void send({ targets: Object.fromEntries(parsed.map(([k, tv]) => [k, tv])), bands: Object.fromEntries(parsed.map(([k, , b]) => [k, b])) });
  };
  const cell = (k: K, f: "target" | "band", label: string) => (
    <span className="with-unit">
      <input inputMode="decimal" value={draft[k][f]} placeholder="0" aria-label={`${c.labels[k]} ${label}`} onChange={(e) => setDraft({ ...draft, [k]: { ...draft[k], [f]: e.target.value } })} data-testid={`${t}-${k}-${f}`} />
      <span className="muted">{f === "target" ? "%" : "pp"}</span>
    </span>
  );
  return (
    <div className="targets" data-testid={`${t}-form`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <table className="static targets-inputs">
          <thead>
            <tr>
              <th>{c.noun}</th>
              <th>Target</th>
              <th title={`How far a ${c.noun.toLowerCase()} may drift from its target before it counts as off target`}>± Band</th>
            </tr>
          </thead>
          <tbody>
            {c.keys.map((k) => (
              <tr key={k}>
                <td>
                  <i className={`mix-dot ${c.color(k)}`} aria-hidden /> {c.labels[k]}
                </td>
                <td>{cell(k, "target", "target")}</td>
                <td>{cell(k, "band", "band")}</td>
              </tr>
            ))}
            <tr className="total">
              <td>Total</td>
              <td className={sumOk ? "" : "neg"} data-testid={`${t}-sum`}>
                {fmtNum(sum, sum % 1 ? 1 : 0)}%{sumOk ? " ✓" : ""}
              </td>
              <td />
            </tr>
          </tbody>
        </table>
        {!sumOk && <p className="muted hint">The targets must add up to 100%.</p>}
        <span className="hs-buttons">
          <button type="submit" className="primary" disabled={pending || !sumOk} data-testid={`${t}-save`}>
            {pending && <span className="spinner" aria-hidden />}
            Save
          </button>
          <button type="button" className="link" disabled={pending} onClick={() => onDone(saved)} data-testid={`${t}-cancel`}>
            Cancel
          </button>
          {saved && (
            <button type="button" className="link" disabled={pending} onClick={() => void send({ reset: true })} data-testid={`${t}-remove`}>
              Remove targets
            </button>
          )}
        </span>
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  );
}
