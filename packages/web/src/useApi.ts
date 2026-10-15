import { useSyncExternalStore } from "react";
import useSWR, { mutate } from "swr";
import { api } from "./api.ts";
import { apiKey, parseApiKey } from "./apiKey.ts";

/**
 * Fetches `path` (skipped when null) with `params`, through SWR's cache: a view visited before shows its last data at
 * once and refetches it in the background (stale-while-revalidate). `loading` is true only while there's nothing to
 * show for this path and params yet (placeholders); `refreshing` while data is shown and a newer copy is on its way.
 * When the path or params change, the previous data stays until the new arrives (a chart keeps its line). A view shown
 * again within 2 s of its last fetch doesn't fetch again (SWR's deduping). `update` changes the cached data at once
 * (after an edit) and then refetches it.
 */
export function useApi<T>(path: string | null, params: Record<string, string | undefined> = {}) {
  const res = useSWR<T, Error>(path === null ? null : apiKey(path, params), fetcher, { keepPreviousData: true, shouldRetryOnError: false });
  return {
    data: res.data,
    error: res.error?.message,
    loading: res.isLoading,
    refreshing: res.isValidating && !res.isLoading,
    reload: () => void res.mutate(),
    update: (change: (data: T | undefined) => T | undefined) => void res.mutate(change),
  };
}

function fetcher<T>(key: string): Promise<T> {
  const { path, params } = parseApiKey(key);
  inFlight.change(1);
  return api<T>(path, params).finally(() => inFlight.change(-1));
}

/**
 * Refetches everything on screen (the mounted hooks; the rest refetches when next shown, as always). After a save,
 * a finished valuation, and the "Reload" button.
 */
export const reloadAll = () => void mutate(() => true);

/** Forgets every cached response (logout: the next user must not see them). */
export const clearApiCache = () => void mutate(() => true, undefined, { revalidate: false });

/** How many requests of useApi are under way: the "Reload" icon turns while any is. */
const inFlight = (() => {
  let count = 0;
  const listeners = new Set<() => void>();
  return {
    get: () => count,
    change(by: number) {
      count += by;
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
  };
})();

export const useApiBusy = () => useSyncExternalStore(inFlight.subscribe, inFlight.get) > 0;
