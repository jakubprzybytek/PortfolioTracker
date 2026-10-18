// Hash-based routing: "#/holdings?account=ike". The hash keeps the static site to one page (no CloudFront
// rewrites), and the filters in the query part make every view bookmarkable.

import { useCallback, useEffect, useState } from "react";

export type View = "dashboard" | "holdings" | "prices" | "holdsell" | "indicators" | "transactions" | "notes" | "instrument";
/** `hidden`: not in the menu (opened from another view). */
export const VIEWS: { view: View; label: string; path: string; hidden?: true }[] = [
  { view: "dashboard", label: "Dashboard", path: "#/" },
  { view: "holdings", label: "Holdings", path: "#/holdings" },
  { view: "prices", label: "Prices", path: "#/prices" },
  { view: "holdsell", label: "Hold or sell", path: "#/hold-sell" },
  { view: "indicators", label: "Indicators", path: "#/indicators" },
  { view: "transactions", label: "Transactions", path: "#/transactions" },
  { view: "notes", label: "Notes", path: "#/notes" },
  { view: "instrument", label: "Instrument", path: "#/instrument", hidden: true },
];

export interface Route {
  view: View;
  params: Record<string, string>;
}

export function parseHash(hash: string): Route {
  const [path = "", query = ""] = hash.replace(/^#/, "").split("?");
  const name = path.replace(/^\/+|\/+$/g, "");
  const view: View = VIEWS.find((v) => v.path === `#/${name}` && v.view !== "dashboard")?.view ?? "dashboard";
  return { view, params: Object.fromEntries(new URLSearchParams(query)) };
}

export function toHash(view: View, params: Record<string, string | undefined> = {}): string {
  const base = VIEWS.find((v) => v.view === view)!.path;
  const query = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1])).toString();
  return query ? `${base}?${query}` : base;
}

/** The current route, plus a setter for the current view's params (replaces the history entry, so filters don't pile up in "back"). */
export function useRoute(): [Route, (params: Record<string, string | undefined>) => void] {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const setParams = useCallback(
    (params: Record<string, string | undefined>) => {
      const hash = toHash(route.view, params);
      window.history.replaceState(null, "", hash);
      setRoute(parseHash(hash));
    },
    [route.view],
  );
  return [route, setParams];
}
