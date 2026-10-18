import { useState } from "react";
import { ASSET_CLASSES, defaultAssetClass, type AssetClass } from "@portfolio/core/valuation/history";
import { apiSend } from "./api.ts";
import { CLASS_LABELS } from "./Allocation.tsx";
import { useTxForm } from "./txForm.ts";

/**
 * The instrument's asset class in its chart panel (Prices, Holdings): the rule's class (by type; an ETF with "bond" in
 * its name = bonds) is marked "(rule)"; choosing another sets it by hand, choosing the rule's again clears it. A change
 * revalues the instrument's days, so the allocation charts follow.
 */
export function AssetClassSelect({ isin, code, type, name, value }: { isin: string; code: string; type: string; name: string; value: AssetClass }) {
  const { saved } = useTxForm();
  const rule = defaultAssetClass({ type, name });
  const [pending, setPending] = useState<AssetClass | null>(null);
  const [error, setError] = useState<string | null>(null);
  const change = async (next: AssetClass) => {
    setPending(next);
    setError(null);
    try {
      await apiSend("PUT", `/instruments/${isin}/asset-class`, { assetClass: next === rule ? null : next });
      saved(`${code}: asset class ${CLASS_LABELS[next]}${next === rule ? " (the rule)" : ""}. Recalculating the valuation…`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(null);
    }
  };
  return (
    <label className="asset-class" title="Asset class in the Dashboard's allocation">
      <span className="muted">Class</span>
      <select value={pending ?? value} disabled={pending !== null} onChange={(e) => void change(e.target.value as AssetClass)} data-testid="asset-class-select">
        {ASSET_CLASSES.map((c) => (
          <option key={c} value={c}>
            {CLASS_LABELS[c]}
            {c === rule ? " (rule)" : ""}
          </option>
        ))}
      </select>
      {pending !== null && <span className="spinner" aria-hidden />}
      {error && (
        <span className="error" role="alert" data-testid="asset-class-error">
          {error}
        </span>
      )}
    </label>
  );
}
