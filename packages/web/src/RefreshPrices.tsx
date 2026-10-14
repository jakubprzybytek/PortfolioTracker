import { Icon } from "./Icons.tsx";
import { useTxForm } from "./txForm.ts";

/**
 * "Refresh" next to the valuation date (Dashboard, Holdings, Prices): today's quotes of the instruments with a live
 * source, then a revaluation of today. Disabled while that or any other revaluation runs; the icon turns while prices
 * are fetched. Progress and the outcome show in the corner (App).
 */
export function RefreshPrices() {
  const { refreshPrices, busy } = useTxForm();
  return (
    <button
      type="button"
      className="refresh"
      onClick={refreshPrices}
      disabled={busy !== null}
      title="Fetch today's prices (ETFs, IBKR and corporate bonds) and revalue"
      aria-label="Refresh prices"
      data-testid="refresh-prices"
    >
      <Icon name="refresh" size={14} className={busy === "prices" ? "spin" : undefined} />
      Refresh
    </button>
  );
}
