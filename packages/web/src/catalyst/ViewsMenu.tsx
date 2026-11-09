// Saved views of the Catalyst view: filters and sort under a name. In the header, above the filters it holds.
import { useState } from "react";
import { apiSend } from "../api.ts";
import { Icon } from "../Icons.tsx";
import { useApi } from "../useApi.ts";
import type { SavedView } from "./types.ts";
import { FILTER_KEYS } from "./filters.ts";

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
  const save = async (next: SavedView[]) => {
    setError(null);
    try {
      await apiSend("PUT", "/catalyst/views", { views: next });
      views.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const same = (v: SavedView) => JSON.stringify(v.params) === JSON.stringify(current);
  // The view in use: the one chosen (`view` in the URL), even after its filters changed, or one that matches them.
  const active = list.find((v) => v.name === params["view"]) ?? list.find(same);
  const changed = active !== undefined && !same(active);
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
    void save(next).then(() => {
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
          <button type="submit" className="icon-button" title={naming === "rename" ? "Rename" : "Save"} aria-label={naming === "rename" ? "Rename" : "Save"} disabled={!name.trim()} data-testid="catalyst-view-save">
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
            <button type="button" className="icon-button" onClick={() => void save(list.map((v) => (v === active ? { name: v.name, params: current } : v)))} title={`Save changes: these filters and the sort into "${active.name}"`} aria-label="Save changes" data-testid="catalyst-view-update">
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
                      void save(list.filter((v) => v !== active)).then(() => {
                        setConfirming(false);
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
      {error && <span className="error">{error}</span>}
    </div>
  );
}
