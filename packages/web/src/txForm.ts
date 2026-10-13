import { createContext, useContext } from "react";
import type { Transaction } from "./types.ts";

/**
 * The transaction form lives in the app frame (any view can open it). `version` goes up after every save, so the
 * views' data (useApi) reloads.
 */
export const TxFormContext = createContext<{ open: (editing?: Transaction) => void; version: number }>({ open: () => undefined, version: 0 });

export const useTxForm = () => useContext(TxFormContext);
