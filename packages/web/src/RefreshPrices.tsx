import { Icon } from "./Icons.tsx";
import { useTxForm } from "./txForm.ts";

/**
 * "Update prices" next to the valuation date (Dashboard, Holdings, Prices): today's quotes of the instruments with a
 * live source, then a revaluation of today. Not the "Reload" of the app frame, which only refetches what's shown. Disabled while that or any other revaluation runs; the icon turns while prices
 * are fetched. Progress and the outcome show in the corner (App). On a phone only the icon, so it fits on the title's row.
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
      aria-label="Update prices"
      data-testid="refresh-prices"
    >
      <Icon name="update-prices" size={14} className={busy === "prices" ? "pulse" : undefined} />
      <span className="wide-only">Update prices</span>
    </button>
  );
}
