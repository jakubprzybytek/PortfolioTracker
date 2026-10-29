import { assetClassOf } from "@portfolio/core/valuation/history";
import { AssetClassSelect } from "./AssetClassSelect.tsx";
import { CouponPeriods } from "./CouponPeriods.tsx";
import { fmtNum, typeLabel } from "./format.ts";
import { Icon } from "./Icons.tsx";
import { ManualValues } from "./ManualValues.tsx";
import { toHash, type View } from "./route.ts";
import type { Instrument } from "./types.ts";
import { useApi } from "./useApi.ts";

/** Where prices come from, by venue. */
const SOURCE_LABELS: Record<string, string> = {
  XWAR: "GPW (Warsaw Stock Exchange)",
  CATALYST: "Catalyst (BiznesRadar)",
  CALC: "calculated",
  MANUAL: "entered by hand",
  XSTU: "Börse Stuttgart (onvista)",
  IBKR: "IBKR mark prices (Flex)",
};

/**
 * The cog in a chart panel (Prices, Holdings): opens the instrument's settings. A new history entry, so "back" (the
 * view's own or the browser's) returns to the panel it came from.
 */
export function InstrumentSettingsButton({ isin, from }: { isin: string; from: View }) {
  return (
    <button
      type="button"
      className="settings-open"
      onClick={() => {
        window.location.hash = toHash("instrument", { isin, from });
      }}
      title="Instrument settings: asset class, values entered by hand, coupon periods"
      aria-label="Instrument settings"
      data-testid="instrument-settings"
    >
      <Icon name="instrument" size={16} />
    </button>
  );
}

/**
 * One instrument's properties in one place (`#/instrument?isin=…`): what it is, its asset class, and, by kind, the
 * values of an asset valued by hand or a corporate bond's coupon periods. Opened from a chart panel's cog; not in the menu.
 */
export function InstrumentView({ params }: { params: Record<string, string> }) {
  const isin = params["isin"] ?? "";
  const from = params["from"];
  const instruments = useApi<Instrument[]>("/instruments");
  const inst = instruments.data?.find((i) => i.isin === isin);
  // Came from a view of the app: back to it (its open chart included); otherwise to Prices.
  const back = () => {
    if (from) window.history.back();
    else window.location.hash = toHash("prices", { chart: isin || undefined });
  };

  return (
    <>
      <header className="view-header">
        <h2 className="view-title instrument-title" data-testid="instrument-title">
          <button type="button" className="link back" onClick={back} title="Back" aria-label="Back" data-testid="instrument-back">
            <Icon name="back" size={22} />
          </button>
          <span>{inst?.code ?? isin}</span>
          {inst && inst.name !== inst.code && <span className="muted instrument-name">{inst.name}</span>}
        </h2>
      </header>
      {instruments.error && <p className="error">{instruments.error}</p>}
      {!inst && !instruments.loading && !instruments.error && <p className="muted">No instrument {isin}.</p>}
      {!inst && instruments.loading && <p className="muted">Loading…</p>}
      {inst && (
        <div className="instrument-sections">
          <section className="panel" data-testid="instrument-facts">
            <h3>Instrument</h3>
            <dl className="facts">
              <dt>ISIN</dt>
              <dd>{inst.isin}</dd>
              <dt>Type</dt>
              <dd>{typeLabel(inst.type)}</dd>
              <dt>Currency</dt>
              <dd>{inst.currency}</dd>
              <dt>Prices</dt>
              <dd>{inst.type === "BOND_RETAIL" ? "calculated from the published rates" : inst.type === "ETF" ? `Yahoo (${inst.venue})` : (SOURCE_LABELS[inst.venue] ?? inst.venue)}</dd>
              {(inst.nominal ?? inst.terms?.nominal) !== undefined && (
                <>
                  <dt>Nominal</dt>
                  <dd>{fmtNum(inst.nominal ?? inst.terms!.nominal)}</dd>
                </>
              )}
              {inst.terms?.maturity && (
                <>
                  <dt>Maturity</dt>
                  <dd>{inst.terms.maturity}</dd>
                </>
              )}
            </dl>
          </section>

          <section className="panel" data-testid="instrument-class">
            <h3>Asset class</h3>
            <p className="muted hint">The class the Dashboard's asset mix and allocation over time count it in. Changing it revalues its history.</p>
            <AssetClassSelect key={inst.isin} isin={inst.isin} code={inst.code} type={inst.type} name={inst.name} value={assetClassOf(inst)} />
          </section>

          {inst.venue === "MANUAL" && (
            <section className="panel" data-testid="instrument-values">
              <h3>Values</h3>
              <p className="muted hint">No price source: its value per unit is what you enter here, from that day on.</p>
              <ManualValues key={inst.isin} isin={inst.isin} code={inst.code} currency={inst.currency} />
            </section>
          )}

          {inst.type === "BOND_CORPORATE" && (
            <section className="panel" data-testid="instrument-coupons">
              <h3>Coupon periods</h3>
              <CouponPeriods key={inst.isin} isin={inst.isin} code={inst.code} />
            </section>
          )}
        </div>
      )}
    </>
  );
}
