// The Catalyst view's two lists: bonds and issuers (each with its own route, filters and sort).

export function CatalystTabs({ current }: { current: "bonds" | "issuers" }) {
  return (
    <nav className="segmented cat-view-tabs" aria-label="Catalyst lists">
      <a href="#/catalyst" className={current === "bonds" ? "active" : ""} aria-current={current === "bonds" ? "page" : undefined} data-testid="catalyst-tab-bonds">
        Bonds
      </a>
      <a href="#/catalyst/issuers" className={current === "issuers" ? "active" : ""} aria-current={current === "issuers" ? "page" : undefined} data-testid="catalyst-tab-issuers">
        Issuers
      </a>
    </nav>
  );
}
