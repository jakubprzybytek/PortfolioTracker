import { useEffect, useState } from "react";
import { useTxForm } from "./txForm.ts";
import { api } from "./api.ts";

/** Fetches `path` (skipped when null) and refetches when it or `deps` change, and after a transaction is saved. */
export function useApi<T>(path: string | null, params: Record<string, string | undefined> = {}, deps: unknown[] = []) {
  const { version } = useTxForm();
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: path !== null });
  useEffect(() => {
    if (path === null) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    api<T>(path, params)
      .then((data) => !cancelled && setState({ data, loading: false }))
      .catch((e: Error) => !cancelled && setState({ error: e.message, loading: false }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, version, ...deps]);
  return state;
}
