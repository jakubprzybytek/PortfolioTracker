import type { View } from "./route.ts";

// Line icons (24 × 24, currentColor) for the menu.

const paths: Record<View | "menu" | "close" | "logout", string> = {
  dashboard: "M4 3h6a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM15 3h5a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM15 12h5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1zM4 17h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1z",
  holdings: "M4 6h16M4 12h16M4 18h10",
  prices: "M3 17l6-6 4 4 8-8M15 7h6v6",
  indicators: "M5 20V10M12 20V4M19 20v-7",
  transactions: "M7 4v16M4 17l3 3 3-3M17 20V4M14 7l3-3 3 3",
  menu: "M4 7h16M4 12h16M4 17h16",
  close: "M6 6l12 12M18 6L6 18",
  logout: "M9 4H5v16h4M16 16l4-4-4-4M20 12H10",
};

export function Icon({ name, size = 20 }: { name: keyof typeof paths; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={paths[name]} />
    </svg>
  );
}
