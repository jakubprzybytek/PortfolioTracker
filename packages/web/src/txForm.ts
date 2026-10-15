import { createContext, useContext } from "react";
import type { Transaction } from "./types.ts";

/**
 * The transaction form lives in the app frame (any view can open it). `saved` shows a toast and reloads the views'
 * data (useApi) after any edit (a transaction, a value of a hand-valued asset, a coupon rate).
 * `refreshPrices` starts "Update prices" (live quotes, then the valuation); `busy` says what's running in the background.
 */
export const TxFormContext = createContext<{
  open: (editing?: Transaction) => void;
  saved: (message: string) => void;
  refreshPrices: () => void;
  busy: "prices" | "valuation" | null;
}>({
  open: () => undefined,
  saved: () => undefined,
  refreshPrices: () => undefined,
  busy: null,
});

export const useTxForm = () => useContext(TxFormContext);
