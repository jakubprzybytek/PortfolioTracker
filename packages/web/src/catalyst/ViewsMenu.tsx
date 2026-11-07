// Saved views of the Catalyst view: filters and sort under a name.
import { useState } from "react";
import { apiSend } from "../api.ts";
import { FilterSelect } from "../Filters.tsx";
import { useApi } from "../useApi.ts";
import type { SavedView } from "./types.ts";
import { FILTER_KEYS, } from "./filters.ts";

export function ViewsMenu({ params, setParams }: { params: Record<string, string>; setParams: (p: Record<string, string | undefined>) => void }) {
  const views = useApi<{ views: SavedView[] }>("/catalyst/views");
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
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
  return (
    <span className="cat-views">
      <FilterSelect
        label="View"
        value={active?.name ?? ""}
        options={list.map((v) => ({ value: v.name, label: v === active && changed ? `${v.name} (changed)` : v.name }))}
        onChange={(v) => {
          const view = list.find((x) => x.name === v);
          setParams({ ...(view?.params ?? {}), view: view?.name, bond: params["bond"], chart: params["chart"] });
        }}
        testId="catalyst-view"
        width="9rem"
      />
      {naming ? (
        <form
          className="cat-view-name"
          onSubmit={(e) => {
            e.preventDefault();
            const n = name.trim();
            if (!n) return;
            void save([...list.filter((v) => v.name !== n), { name: n, params: current }]).then(() => {
              setNaming(false);
              setName("");
              setParams({ ...params, view: n });
            });
          }}
        >
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" maxLength={60} data-testid="catalyst-view-name" />
          <button type="submit" className="link" data-testid="catalyst-view-save">
            Save
          </button>
          <button type="button" className="link" onClick={() => setNaming(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <>
          {active && changed && (
            <button type="button" className="link" onClick={() => void save(list.map((v) => (v === active ? { name: v.name, params: current } : v)))} title={`Save these filters and the sort into the view "${active.name}"`} data-testid="catalyst-view-update">
              Save changes
            </button>
          )}
          <button type="button" className="link" onClick={() => setNaming(true)} title="Save these filters and the sort as a new view" data-testid="catalyst-view-new">
            {active ? "Save as…" : "Save view"}
          </button>
        </>
      )}
      {active && !naming && (
        <button
          type="button"
          className="link"
          onClick={() => void save(list.filter((v) => v !== active)).then(() => setParams({ ...params, view: undefined }))}
          title={`Delete the view "${active.name}"`}
          data-testid="catalyst-view-delete"
        >
          Delete
        </button>
      )}
      {error && <span className="error">{error}</span>}
    </span>
  );
}
