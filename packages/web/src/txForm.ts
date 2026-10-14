import { createContext, useContext } from "react";
import type { Transaction } from "./types.ts";

/**
 * The transaction form lives in the app frame (any view can open it). `version` goes up after every save, so the
 * views' data (useApi) reloads. `saved` does the same for other edits (a new value of a hand-valued asset), with a toast.
 * `refreshPrices` starts "Refresh prices" (live quotes, then the valuation); `busy` says what's running in the background.
 */
export const TxFormContext = createContext<{
  open: (editing?: Transaction) => void;
  saved: (message: string) => void;
  version: number;
  refreshPrices: () => void;
  busy: "prices" | "valuation" | null;
}>({
  open: () => undefined,
  saved: () => undefined,
  version: 0,
  refreshPrices: () => undefined,
  busy: null,
});

export const useTxForm = () => useContext(TxFormContext);
