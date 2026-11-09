// The view's companies (Docs/ui.md, "Catalyst"): only these, or all but these; a button in the filters that opens
// the list, its mode, a search to add one, and Remove all.
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { matchesAny } from "../Filters.tsx";
import { Icon } from "../Icons.tsx";
import type { BondRow } from "./types.ts";
import { companyKey, companyList, companyName, companyParam } from "./filters.ts";

export interface Company {
  key: string;
  name: string;
  bonds: number;
}

/** Every company in the table, by the key a view lists it under, with its name and how many bonds it has. */
export function companiesOf(rows: BondRow[]): Company[] {
  const by = new Map<string, Company>();
  for (const r of rows) {
    const key = companyKey(r);
    if (!key) continue;
    const c = by.get(key) ?? { key, name: companyName(r), bonds: 0 };
    // A group's own bond names it better than its vehicle's.
    if (r.entityId === key && r.issuerShort) c.name = r.issuerShort;
    c.bonds++;
    by.set(key, c);
  }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name, "pl"));
}

export function CompaniesFilter({ companies, params, setParams }: { companies: Company[]; params: Record<string, string>; setParams: (p: Record<string, string | undefined>) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const list = companyList(params);
  const out = params["cm"] === "out";
  const nameOf = useMemo(() => new Map(companies.map((c) => [c.key, c.name])), [companies]);
  const label = (k: string) => nameOf.get(k) ?? (k.startsWith("n:") ? k.slice(2) : k);
  const setList = (next: string[]) => setParams({ ...params, co: companyParam(next), cm: next.length ? params["cm"] : undefined, peek: undefined });
  const found = q.trim() ? companies.filter((c) => !list.includes(c.key) && matchesAny(q, c.name)).slice(0, 8) : [];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: Event) => !box.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  const summary = list.length === 0 ? "All" : `${out ? "All except" : "Only"} ${list.length === 1 ? label(list[0]!) : list.length}`;
  return (
    <div className={`filter cat-companies${list.length ? "" : " unset"}`} ref={box} style={{ "--w": "10rem" } as CSSProperties}>
      <span className="muted">Companies</span>
      <button type="button" className={`cat-companies-button${list.length ? " active" : ""}`} aria-expanded={open} onClick={() => setOpen((o) => !o)} title={list.length ? `${out ? "All companies except" : "Only"} ${list.map(label).join(", ")}` : "Every company's bonds"} data-testid="catalyst-co">
        <span>{summary}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="cat-companies-pop" role="dialog" aria-label="The view's companies" data-testid="catalyst-co-pop">
          {/* biome-ignore lint/a11y/useSemanticElements: a segmented control, not a form's fieldset */}
          <div className="segmented" role="group" aria-label="Mode">
            <button type="button" className={out ? "" : "active"} aria-pressed={!out} onClick={() => setParams({ ...params, cm: undefined })} data-testid="catalyst-co-only">
              Only these
            </button>
            <button type="button" className={out ? "active" : ""} aria-pressed={out} onClick={() => setParams({ ...params, cm: "out" })} data-testid="catalyst-co-except">
              All except these
            </button>
          </div>
          <p className="muted cat-companies-hint">{out ? "Every company's bonds but these: new issuers show up." : "These companies' bonds only: their new bonds show up."}</p>
          {list.length > 0 ? (
            <ul className="cat-companies-list" data-testid="catalyst-co-list">
              {list.map((k) => (
                <li key={k}>
                  <span>{label(k)}</span>
                  <button type="button" className="icon-button" onClick={() => setList(list.filter((x) => x !== k))} title={`Remove ${label(k)}`} aria-label={`Remove ${label(k)}`} data-testid="catalyst-co-remove">
                    <Icon name="close" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No companies yet: every company's bonds are shown. Add one below, or with ＋ by its name in the table.</p>
          )}
          <input type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add a company…" aria-label="Add a company" data-testid="catalyst-co-search" />
          {found.length > 0 && (
            <ul className="cat-companies-found">
              {found.map((c) => (
                <li key={c.key}>
                  <button
                    type="button"
                    onClick={() => {
                      setList([...list, c.key]);
                      setQ("");
                    }}
                    data-testid="catalyst-co-add"
                  >
                    <Icon name="plus" size={14} /> {c.name} <span className="muted">{c.bonds === 1 ? "1 bond" : `${c.bonds} bonds`}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {list.length > 0 && (
            <button type="button" className="link-button" onClick={() => setList([])} data-testid="catalyst-co-clear">
              Remove all
            </button>
          )}
        </div>
      )}
    </div>
  );
}
