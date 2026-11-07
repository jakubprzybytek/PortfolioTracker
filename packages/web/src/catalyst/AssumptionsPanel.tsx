// The Catalyst view's assumptions (the cog): rates, the alternative, the commission.
import { useEffect, useState } from "react";
import { apiSend } from "../api.ts";
import { fmtNum } from "../format.ts";
import { useApi } from "../useApi.ts";
import type { AssumptionsAnswer } from "./types.ts";
import { pct } from "./labels.ts";

export type Draft = Record<"cpi" | "wibor" | "nbpRate" | "wiron" | "euribor" | "altRate" | "commission", string> & { alternative: "retail" | "rate" };
export const show = (v: number | undefined) => (v === undefined ? "" : fmtNum(v * 100));
export const parse = (s: string) => {
  const n = Number(s.replace(/\s/g, "").replace(",", "."));
  return s.trim() === "" ? undefined : Number.isFinite(n) ? n / 100 : Number.NaN;
};

export function AssumptionsPanel({ onSaved }: { onSaved: () => void }) {
  const data = useApi<AssumptionsAnswer>("/catalyst/settings/assumptions");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const a = data.data?.assumptions;
  useEffect(() => {
    if (a) setDraft({ cpi: show(a.cpi), wibor: show(a.wibor), nbpRate: show(a.nbpRate), wiron: show(a.wiron), euribor: show(a.euribor), altRate: show(a.altRate), commission: show(a.commission), alternative: a.alternative });
  }, [a]);
  const send = async (body: unknown, done: string) => {
    setPending(true);
    setError(null);
    try {
      await apiSend("PUT", "/catalyst/settings/assumptions", body);
      data.reload();
      setMessage(done);
      // The worker recomputes the screen in about a quarter of a minute.
      window.setTimeout(onSaved, 20_000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };
  const field = (key: keyof Omit<Draft, "alternative">, label: string, title: string, placeholder = "") =>
    draft && (
      <label className="hs-field" title={title}>
        <span className="muted">{label}</span>
        <span className="with-unit">
          <input inputMode="decimal" value={draft[key]} placeholder={placeholder} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} data-testid={`catalyst-${key}`} />
          <span className="muted">%</span>
        </span>
      </label>
    );
  return (
    <section className="panel hs-assumptions" data-testid="catalyst-assumptions">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft) return;
          const body = {
            cpi: parse(draft.cpi),
            wibor: parse(draft.wibor),
            nbpRate: parse(draft.nbpRate),
            wiron: parse(draft.wiron),
            euribor: parse(draft.euribor),
            alternative: draft.alternative,
            ...(draft.alternative === "rate" ? { altRate: parse(draft.altRate) } : {}),
            ...(parse(draft.commission) !== undefined ? { commission: parse(draft.commission) } : {}),
          };
          if ([body.cpi, body.wibor, body.nbpRate, body.wiron, body.euribor].some((v) => v === undefined || Number.isNaN(v))) return setError("Each rate needs a number (in %).");
          void send(body, "Saved: the yields are being recomputed (about 20 s).");
        }}
      >
        {field("wibor", "WIBOR", "WIBOR 3M/6M from now on: floating coupons not set yet (WIBOR + margin)")}
        {field("wiron", "WIRON", "WIRON and POLSTR from now on (the NZ series, newer floating bonds)")}
        {field("euribor", "EURIBOR", "EURIBOR from now on (EUR floating bonds)")}
        {field("cpi", "CPI", "Inflation y/y from now on: the retail alternatives after their first year (COI, EDO)")}
        {field("nbpRate", "NBP rate", "NBP reference rate: ROR and DOR as the alternative")}
        {draft && (
          <label className="hs-field" title="What the money would go into instead, until the bond's maturity">
            <span className="muted">Alternative</span>
            <select value={draft.alternative} onChange={(e) => setDraft({ ...draft, alternative: e.target.value as Draft["alternative"] })} data-testid="catalyst-alternative">
              <option value="retail">Retail bond on offer</option>
              <option value="rate">A rate (before tax)</option>
            </select>
          </label>
        )}
        {draft?.alternative === "rate" && field("altRate", "Rate", "The alternative's annual rate before tax")}
        {field("commission", "Commission", "A purchase's commission, % of its value", fmtNum((data.data?.defaults.commission ?? 0.0019) * 100))}
        <span className="hs-buttons">
          <button type="submit" className="primary" disabled={pending || !draft} data-testid="catalyst-assumptions-save">
            {pending && <span className="spinner" aria-hidden />}
            Save
          </button>
          {data.data?.saved && (
            <button type="button" className="link" disabled={pending} onClick={() => void send({ reset: true }, "Back to the defaults: the yields are being recomputed (about 20 s).")} data-testid="catalyst-assumptions-reset">
              Defaults
            </button>
          )}
        </span>
      </form>
      {message && !error && (
        <p className="muted" role="status" data-testid="catalyst-assumptions-done">
          {message}
        </p>
      )}
      {error && <p className="error">{error}</p>}
      {data.data && data.data.offers.length > 0 && (
        <p className="muted hs-offers">On offer: {data.data.offers.map((o) => `${o.series} (${o.termMonths >= 12 ? `${o.termMonths / 12} y` : `${o.termMonths} m`}) ${o.firstRate === null ? "" : pct(o.firstRate)}`).join(" · ")}</p>
      )}
    </section>
  );
}
