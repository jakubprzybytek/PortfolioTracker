import { useSyncExternalStore } from "react";

// "Show closed" (Holdings and Prices): one switch shared by the views while the app is open; a page reload resets it.
let on = false;
const listeners = new Set<() => void>();

export function setShowClosed(value: boolean) {
  on = value;
  for (const l of listeners) l();
}

export function useShowClosed(): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => on,
  );
  return [value, setShowClosed];
}
