// Saved views of the Catalyst view: filters and sort under a name. In the header, above the filters it holds.
import { useEffect, useRef, useState } from "react";
import { apiSend } from "../api.ts";
import { Icon } from "../Icons.tsx";
import { useApi } from "../useApi.ts";
import type { SavedView } from "./types.ts";
import { FILTER_KEYS } from "./filters.ts";

/** The view last chosen (picked, saved or renamed), remembered in this browser: Catalyst opens with it. */
const VIEW_KEY = "pt.catalyst.view";
const remembered = (): string | null => {
  try {
    return localStorage.getItem(VIEW_KEY);
  } catch {
    return null; // storage blocked: not remembered
  }
};
const remember = (name: string | undefined) => {
  try {
    if (name) localStorage.setItem(VIEW_KEY, name);
    else localStorage.removeItem(VIEW_KEY);
  } catch {
    // storage blocked: not remembered
  }
};

const sameParams = (a: Record<string, string>, b: Record<string, string>) => {
  // Only the filters and the sort count: another key stored with a view (an older one) doesn't make it "changed".
  const keys = (o: Record<string, string>) => Object.keys(o).filter((k) => (FILTER_KEYS as readonly string[]).includes(k) && o[k] !== undefined && o[k] !== "");
  return keys(a).length === keys(b).length && keys(a).every((k) => String(a[k]) === String(b[k]));
};

export function ViewsMenu({ params, setParams }: { params: Record<string, string>; setParams: (p: Record<string, string | undefined>) => void }) {
  const views = useApi<{ views: SavedView[] }>("/catalyst/views");
  // Naming a new view, or renaming the one in use.
  const [naming, setNaming] = useState<"new" | "rename" | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Deleting asks first, in place (the trash icon turns into a red "Delete?").
  const [confirming, setConfirming] = useState(false);
  const list = views.data?.views ?? [];
  const current = Object.fromEntries(FILTER_KEYS.filter((k) => params[k]).map((k) => [k, params[k]!]));
  const [saving, setSaving] = useState(false);
  // A short confirmation beside the buttons ("Saved", "Renamed", "Deleted"), gone after 4 seconds.
  const [flash, setFlash] = useState<{ text: string; at: number } | null>(null);
  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 4000);
    return () => window.clearTimeout(t);
  }, [flash]);
  /** Stores the views; true when it worked (then `done` is shown). */
  const save = async (next: SavedView[], done: string): Promise<boolean> => {
    setError(null);
    setSaving(true);
    try {
      await apiSend("PUT", "/catalyst/views", { views: next });
      views.reload();
      setFlash({ text: done, at: Date.now() });
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  };
  // The same filters whatever their order (a view comes back from the database with its keys in another order).
  const same = (v: SavedView) => sameParams(v.params, current);
  // The view in use: the one chosen (`view` in the URL), even after its filters changed, or one that matches them.
  const active = list.find((v) => v.name === params["view"]) ?? list.find(same);
  const changed = active !== undefined && !same(active);
  // Opening Catalyst (a reload, the menu, a link) with no view and no filters in the URL: the remembered view. Not after
  // "Clear filters" or choosing "None", which change the URL in place (no hashchange).
  const [arrived, setArrived] = useState(0);
  useEffect(() => {
    const onHash = () => setArrived((n) => n + 1);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const handled = useRef(-1);
  useEffect(() => {
    if (!views.data || handled.current === arrived) return;
    handled.current = arrived;
    if (params["view"] || FILTER_KEYS.some((k) => params[k])) return;
    const view = list.find((v) => v.name === remembered());
    if (view) setParams({ ...view.params, view: view.name, bond: params["bond"], chart: params["chart"] });
  }, [views.data, arrived, list, params, setParams]);

  const startNaming = (mode: "new" | "rename") => {
    setName(mode === "rename" && active ? active.name : "");
    setNaming(mode);
  };
  const submit = () => {
    const n = name.trim();
    if (!n) return;
    const next =
      naming === "rename" && active
        ? list.filter((v) => v === active || v.name !== n).map((v) => (v === active ? { name: n, params: v.params } : v))
        : [...list.filter((v) => v.name !== n), { name: n, params: current }];
    void save(next, naming === "rename" ? `Renamed to "${n}"` : `Saved "${n}"`).then((ok) => {
      if (!ok) return;
      remember(n);
      setNaming(null);
      setName("");
      setParams({ ...params, view: n });
    });
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: a toolbar group; a <fieldset> would bring its own box and legend
    <div className="cat-views" role="group" aria-label="Saved view">
      {naming ? (
        <form
          className="cat-view-name"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {/* biome-ignore lint/a11y/noAutofocus: the name is what the button just asked for */}
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={naming === "rename" ? "New name" : "View name"} aria-label={naming === "rename" ? "New name of the view" : "Name of the new view"} maxLength={60} autoFocus data-testid="catalyst-view-name" />
          <button type="submit" className="icon-button" title={naming === "rename" ? "Rename" : "Save"} aria-label={naming === "rename" ? "Rename" : "Save"} disabled={!name.trim() || saving} data-testid="catalyst-view-save">
            <Icon name="check" size={18} />
          </button>
          <button type="button" className="icon-button" onClick={() => setNaming(null)} title="Cancel" aria-label="Cancel" data-testid="catalyst-view-cancel">
            <Icon name="close" size={18} />
          </button>
        </form>
      ) : (
        <>
          <label className="cat-views-pick">
            <span className="muted">View</span>
            <select
              value={active?.name ?? ""}
              onChange={(e) => {
                setConfirming(false);
                const view = list.find((x) => x.name === e.target.value);
                remember(view?.name);
                setParams({ ...(view?.params ?? {}), view: view?.name, bond: params["bond"], chart: params["chart"] });
              }}
              data-testid="catalyst-view"
            >
              <option value="">{list.length ? "None" : "No saved views"}</option>
              {list.map((v) => (
                <option key={v.name} value={v.name}>
                  {v === active && changed ? `${v.name} (changed)` : v.name}
                </option>
              ))}
            </select>
          </label>
          {active && changed && (
            <button type="button" className="icon-button" onClick={() => void save(list.map((v) => (v === active ? { name: v.name, params: current } : v)), `Saved "${active.name}"`)} disabled={saving} title={`Save changes: these filters and the sort into "${active.name}"`} aria-label="Save changes" data-testid="catalyst-view-update">
              <Icon name="save" size={18} />
            </button>
          )}
          <button type="button" className="icon-button" onClick={() => startNaming("new")} title={active ? "Save as a new view" : "Save these filters and the sort as a view"} aria-label={active ? "Save as" : "Save view"} data-testid="catalyst-view-new">
            <Icon name="save-as" size={18} />
          </button>
          {active && (
            <>
              <button type="button" className="icon-button" onClick={() => startNaming("rename")} title={`Rename "${active.name}"`} aria-label="Rename" data-testid="catalyst-view-rename">
                <Icon name="edit" size={18} />
              </button>
              {confirming ? (
                <>
                  <button
                    type="button"
                    className="danger"
                    onClick={() =>
                      void save(list.filter((v) => v !== active), `Deleted "${active.name}"`).then((ok) => {
                        if (!ok) return;
                        setConfirming(false);
                        if (remembered() === active.name) remember(undefined);
                        setParams({ ...params, view: undefined });
                      })
                    }
                    title={`Delete the view "${active.name}"`}
                    data-testid="catalyst-view-delete-confirm"
                  >
                    Delete?
                  </button>
                  <button type="button" className="icon-button" onClick={() => setConfirming(false)} title="Keep the view" aria-label="Cancel">
                    <Icon name="close" size={18} />
                  </button>
                </>
              ) : (
                <button type="button" className="icon-button view-delete" onClick={() => setConfirming(true)} title={`Delete "${active.name}"`} aria-label="Delete" data-testid="catalyst-view-delete">
                  <Icon name="trash" size={18} />
                </button>
              )}
            </>
          )}
        </>
      )}
      {flash && (
        <span key={flash.at} className="cat-view-flash" role="status" data-testid="catalyst-view-flash">
          <Icon name="check" size={16} /> {flash.text}
        </span>
      )}
      {error && <span className="error">{error}</span>}
    </div>
  );
}
