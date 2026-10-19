import type { View } from "./route.ts";

// Line icons (24 × 24, currentColor) for the menu and buttons.

const paths: Record<View | "menu" | "close" | "logout" | "clear-filters" | "reload" | "update-prices", string> = {
  dashboard: "M4 3h6a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM15 3h5a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM15 12h5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1zM4 17h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1z",
  holdings: "M4 6h16M4 12h16M4 18h10",
  prices: "M3 17l6-6 4 4 8-8M15 7h6v6",
  indicators: "M5 20V10M12 20V4M19 20v-7",
  // scales: hold or sell
  holdsell: "M12 3v18M8 21h8M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z",
  // a receipt: sales
  sales: "M6 3v18l2-1.5 2 1.5 2-1.5 2 1.5 2-1.5 2 1.5V3l-2 1.5L14 3l-2 1.5L10 3 8 4.5zM9 9h6M9 13h6",
  transactions: "M7 4v16M4 17l3 3 3-3M17 20V4M14 7l3-3 3 3",
  notes: "M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7",
  // a cog (Feather "settings"): the instrument's settings
  instrument:
    "M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z",
  menu: "M4 7h16M4 12h16M4 17h16",
  close: "M6 6l12 12M18 6L6 18",
  logout: "M9 4H5v16h4M16 16l4-4-4-4M20 12H10",
  "clear-filters": "M13 3H2l8 9.46V19l4 2v-8.54l.9-1.06M22 3l-5 5M17 3l5 5",
  reload: "M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5",
  "update-prices": "M12 13v8M8 17l4 4 4-4M20 16.6A5 5 0 0 0 18 7h-1.3A8 8 0 1 0 4 15.3",
};

export function Icon({ name, size = 20, className }: { name: keyof typeof paths; size?: number; className?: string }) {
  return (
    <svg className={className ? `icon ${className}` : "icon"} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={paths[name]} />
    </svg>
  );
}
