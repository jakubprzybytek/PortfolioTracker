import { useState } from "react";
import { type FundExposure, type FundRegions, REGIONS, type Region, type RegionTargets, type RegionWeights, regionExposure } from "@portfolio/core/regions/regions";
import { apiSend } from "./api.ts";
import { addDays, fmtNum, fmtPln, parseNum, today } from "./format.ts";
import { MixPanel, type MixConfig, useRememberedOpen } from "./Targets.tsx";
import type { Snapshot } from "./types.ts";
import { useApi } from "./useApi.ts";

export interface RegionsResponse {
  funds: Record<string, FundRegions>;
  targets: RegionTargets | null;
}

export const REGION_LABELS: Record<Region, string> = { US: "US", EUROPE: "Europe", JAPAN: "Japan", EM: "Emerging", OTHER: "Other" };
const REGION_TITLES: Record<Region, string> = {
  US: "United States",
  EUROPE: "Europe, incl. the UK and Switzerland",
  JAPAN: "Japan",
  EM: "Emerging markets (China, Taiwan, India, Korea…)",
  OTHER: "Other developed markets (Canada, Australia, Hong Kong, Singapore…)",
};

const REGION_MIX: MixConfig<Region> = {
  keys: REGIONS,
  labels: REGION_LABELS,
  color: (k) => `region-${k}`,
  legendLeft: ["US", "EUROPE", "JAPAN"],
  legendRight: ["EM", "OTHER"],
  defaultBand: () => 3,
  targetsPath: "/regions/targets",
  noun: "Region",
  plural: "regions",
  openKey: "dashboard.regionRebalanceOpen",
  ariaLabel: "Regions",
  ids: { panel: "region-mix", tick: "region-target", targets: "region-targets" },
};

/** A global fund's regions drift: due for a look after a quarter (a single-region fund never is). */
const DUE_DAYS = 92;
const isDue = (f: FundExposure) => !!f.regions && Object.keys(f.regions).length > 1 && !!f.regionsAsOf && f.regionsAsOf < addDays(today(), -DUE_DAYS);

/**
 * The shares by world region (road map 8, regions): each equity fund (bond ETFs left out) split by the regions typed
 * for it, summed over all accounts; targets, bands and the calculator as in the asset mix. "Funds ▸" lists the funds
 * with their regions to set or update them by hand (a global fund's split from its factsheet, about once a quarter).
 */
export function RegionsPanel({ snapshot }: { snapshot: Snapshot }) {
  const res = useApi<RegionsResponse>("/regions");
  const funds = res.data?.funds ?? {};
  const exp = regionExposure(snapshot.holdings, (isin) => funds[isin]);
  const [open, toggle] = useRememberedOpen("dashboard.regionFundsOpen");
  const missing = exp.funds.filter((f) => !f.regions);
  const due = exp.funds.filter(isDue);
  return (
    <MixPanel
      config={REGION_MIX}
      values={exp.byRegion}
      saved={res.data?.targets ?? null}
      ready={!!res.data}
      onSaved={(t) => res.update((d) => d && { ...d, targets: t })}
      actions={
        <button type="button" className="link" aria-expanded={open} onClick={toggle} data-testid="region-funds-toggle">
          Funds {open ? "▾" : "▸"}
        </button>
      }
    >
      {res.error && <p className="error">{res.error}</p>}
      {res.data && missing.length > 0 && (
        <p className="muted hint region-note" data-testid="region-missing">
          {exp.total ? "Left out, no regions yet" : "Set each fund's regions under Funds"}: {missing.map((f) => f.code).join(", ")} ({fmtPln(exp.unassigned)}).
        </p>
      )}
      {res.data && due.length > 0 && (
        <p className="muted hint region-note" data-testid="region-due">
          Regions typed over {DUE_DAYS} days ago: {due.map((f) => f.code).join(", ")}. Check the factsheet.
        </p>
      )}
      {open && res.data && (
        <RegionFunds
          funds={exp.funds}
          onSaved={(isin, kept) =>
            res.update((d) => {
              if (!d) return d;
              const next = { ...d.funds };
              if (kept) next[isin] = kept;
              else delete next[isin];
              return { ...d, funds: next };
            })
          }
        />
      )}
    </MixPanel>
  );
}

const weightsText = (w: RegionWeights) =>
  REGIONS.filter((k) => (w[k] ?? 0) > 0)
    .map((k) => `${REGION_LABELS[k]} ${fmtNum(w[k] ?? 0, (w[k] ?? 0) % 1 ? 1 : 0)}%`)
    .join(" · ");

/** The equity funds, largest first: value, regions and when they were typed; a row's regions are edited in place. */
function RegionFunds({ funds, onSaved }: { funds: FundExposure[]; onSaved: (isin: string, kept: FundRegions | null) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  if (!funds.length) return <p className="muted hint">No equity funds held.</p>;
  return (
    <div className="targets region-funds" data-testid="region-funds">
      <table className="static">
        <thead>
          <tr>
            <th>Fund</th>
            <th>Regions</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {funds.map((f) =>
            editing === f.isin ? (
              <tr key={f.isin} data-testid={`region-fund-${f.code}`}>
                <td colSpan={3}>
                  <FundLabel f={f} />
                  <RegionsForm
                    fund={f}
                    onDone={(kept) => {
                      if (kept !== undefined) onSaved(f.isin, kept);
                      setEditing(null);
                    }}
                  />
                </td>
              </tr>
            ) : (
              <tr key={f.isin} data-testid={`region-fund-${f.code}`}>
                <td>
                  <FundLabel f={f} />
                </td>
                <td>
                  {f.regions ? <span data-testid={`region-fund-${f.code}-regions`}>{weightsText(f.regions)}</span> : <span className="neg">not set</span>}
                  {f.regionsAsOf && <span className={`sub ${isDue(f) ? "neg" : "muted"}`}>typed {f.regionsAsOf}</span>}
                </td>
                <td className="region-edit">
                  <button type="button" className="link" disabled={editing !== null} onClick={() => setEditing(f.isin)} data-testid={`region-fund-${f.code}-edit`}>
                    {f.regions ? "Edit" : "Set"}
                  </button>
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
      <p className="muted hint">From the fund's factsheet (country breakdown): a single-region fund is 100% its region; a global one is split. Bond ETFs are left out.</p>
    </div>
  );
}

function FundLabel({ f }: { f: FundExposure }) {
  return (
    <span className="region-fund" title={f.name}>
      <strong>{f.code}</strong> <span className="muted">{fmtPln(f.value)}</span>
      <span className="sub muted">{f.name}</span>
    </span>
  );
}

/** One fund's regions: a % per region (adding up to 100), Save, Cancel, and Remove when set. `onDone(undefined)`: cancelled. */
function RegionsForm({ fund, onDone }: { fund: FundExposure; onDone: (kept: FundRegions | null | undefined) => void }) {
  const [draft, setDraft] = useState<Record<Region, string>>(() => Object.fromEntries(REGIONS.map((k) => [k, fund.regions?.[k] ? fmtNum(fund.regions[k], fund.regions[k] % 1 ? 2 : 0).replace(/\s/g, "") : ""])) as Record<Region, string>);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const values = REGIONS.map((k) => [k, draft[k].trim() === "" ? 0 : parseNum(draft[k])] as const);
  const sum = values.reduce((s, [, v]) => s + (v ?? 0), 0);
  const sumOk = Math.abs(sum - 100) < 0.005;
  const send = async (regions: RegionWeights | null) => {
    setPending(true);
    setError(null);
    try {
      const r = await apiSend<{ regions: RegionWeights | null; regionsAsOf?: string }>("PUT", `/instruments/${fund.isin}/regions`, { regions });
      onDone(r.regions ? { regions: r.regions, regionsAsOf: r.regionsAsOf ?? today() } : null);
    } catch (e) {
      setError((e as Error).message);
      setPending(false);
    }
  };
  const save = () => {
    if (values.some(([, v]) => v === undefined || Number.isNaN(v) || v < 0)) return setError("Each region needs a number of 0 or more (empty: 0).");
    void send(Object.fromEntries(values.filter(([, v]) => (v ?? 0) > 0)) as RegionWeights);
  };
  return (
    <form
      className="region-form"
      data-testid="region-form"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="region-inputs">
        {REGIONS.map((k) => (
          <label key={k} title={REGION_TITLES[k]}>
            <span>
              <i className={`mix-dot region-${k}`} aria-hidden /> {REGION_LABELS[k]}
            </span>
            <span className="with-unit">
              <input inputMode="decimal" value={draft[k]} placeholder="0" aria-label={`${REGION_LABELS[k]} %`} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} data-testid={`region-input-${k}`} />
              <span className="muted">%</span>
            </span>
          </label>
        ))}
      </div>
      <p className={`hint ${sumOk ? "muted" : "neg"}`} data-testid="region-sum">
        Total {fmtNum(sum, sum % 1 ? 1 : 0)}%{sumOk ? " ✓" : ": must be 100%"}
      </p>
      <span className="hs-buttons">
        <button type="submit" className="primary" disabled={pending || !sumOk} data-testid="region-save">
          {pending && <span className="spinner" aria-hidden />}
          Save
        </button>
        <button type="button" className="link" disabled={pending} onClick={() => onDone(undefined)} data-testid="region-cancel">
          Cancel
        </button>
        {fund.regions && (
          <button type="button" className="link" disabled={pending} onClick={() => void send(null)} data-testid="region-remove">
            Remove
          </button>
        )}
      </span>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
