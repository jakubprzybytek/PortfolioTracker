import { describe, expect, it } from "vitest";
import { PaymentEventInput, workItems, type WorkInput } from "../../src/catalyst/agent.ts";
import { plainText, quoteIn, type PaymentEvent } from "../../src/catalyst/paymentEvents.ts";
import { bondHistory, trackRecord, type TrackBond } from "../../src/catalyst/trackRecord.ts";

const asOf = "2026-11-09";
const bond = (b: Partial<TrackBond> = {}): TrackBond => ({ isin: "PLABC0000011", code: "ABC0126", maturity: "2026-01-20", status: "ended", firstSeen: "2020-01-02", lastSeen: "2026-01-12", lastClose: 100, events: [], ...b });
const event = (e: Partial<PaymentEvent> = {}): PaymentEvent => ({
  id: "e1",
  kind: "missed-payment",
  date: "2026-01-20",
  isins: ["PLABC0000011"],
  text: "series A not redeemed at maturity",
  source: "ESPI 3/2026",
  documentSha: "a".repeat(64),
  quote: "Emitent nie dokonał wykupu obligacji serii A",
  by: "agent",
  at: "2026-01-21T10:00:00Z",
  ...e,
});

describe("payment events in the track record", () => {
  it("a missed payment overrides what trading suggests, whatever the bond's state", () => {
    expect(bondHistory(bond(), asOf)).toMatchObject({ outcome: "repaid", inferred: true });
    const h = bondHistory(bond(), asOf, [event()]);
    expect(h).toMatchObject({ outcome: "not-paid", inferred: false, confirmed: true, note: "ESPI 3/2026: series A not redeemed at maturity" });
    expect(h.flags).toEqual(["2026-01-20: payment missed: series A not redeemed at maturity (ESPI 3/2026)"]);
    expect(bondHistory(bond({ status: "listed", maturity: "2028-01-20" }), asOf, [event({ text: "coupon not paid" })]).outcome).toBe("not-paid");
  });

  it("a missed payment made later, or a late one: paid late once the bond has ended, a flag while it trades", () => {
    const paidLater = event({ resolvedOn: "2026-02-10" });
    expect(bondHistory(bond(), asOf, [paidLater])).toMatchObject({ outcome: "paid-late", confirmed: true });
    expect(bondHistory(bond(), asOf, [paidLater]).flags[0]).toContain("payment missed, paid 2026-02-10");
    const trading = bondHistory(bond({ status: "listed", maturity: "2028-01-20" }), asOf, [event({ kind: "late-payment", text: "coupon paid 5 days late" })]);
    expect(trading).toMatchObject({ outcome: "listed", flags: ["2026-01-20: paid late: coupon paid 5 days late (ESPI 3/2026)"] });
  });

  it("a report of payment confirms the inferred outcome; it never clears a bond that ended below par", () => {
    const paid = event({ kind: "paid", text: "series A redeemed on time" });
    expect(bondHistory(bond(), asOf, [paid])).toMatchObject({ outcome: "repaid", inferred: false, confirmed: true, flags: [] });
    expect(bondHistory(bond({ lastClose: 40 }), asOf, [paid])).toMatchObject({ outcome: "below-par", inferred: true });
  });

  it("meetings and waivers are worth a look; changed terms and breaches are flags; a retracted event isn't read", () => {
    const h = bondHistory(bond({ status: "listed", maturity: "2028-01-20" }), asOf, [event({ id: "a", kind: "bondholders-meeting", text: "meeting called" }), event({ id: "b", kind: "terms-changed", text: "maturity moved by 12 months" }), event({ id: "c", retracted: { at: "x", by: "you", reason: "wrong company" } })]);
    expect(h.outcome).toBe("listed");
    expect(h.attention).toHaveLength(1);
    expect(h.flags).toEqual(["2026-01-20: terms changed: maturity moved by 12 months (ESPI 3/2026)"]);
  });

  it("the record: an event naming no bond is the company's; `reviewed` only says how far the reports were read", () => {
    const r = trackRecord([bond()], asOf, [], [event({ id: "g", isins: [], kind: "insolvency", date: "2026-03-01", text: "arrangement proceedings opened" }), event({ id: "r", kind: "reviewed", isins: [], date: "2026-11-01", text: "nothing else found", source: "ESPI reports to 2026-11-01" }), event()]);
    expect(r.counts["not-paid"]).toBe(1);
    expect(r.flags).toEqual(["2026-03-01: insolvency proceedings: arrangement proceedings opened (ESPI 3/2026)", "ABC0126: 2026-01-20: payment missed: series A not redeemed at maturity (ESPI 3/2026)"]);
    expect(r.reviewedTo).toBe("2026-11-01");
    expect(r.reported.map((e) => [e.id, e.codes])).toEqual([
      ["g", []],
      ["e1", ["ABC0126"]],
    ]);
    expect(trackRecord([bond()], asOf)).toMatchObject({ reported: [], reviewedTo: null });
  });
});

describe("the quote check", () => {
  it("finds a passage whatever the line breaks, hyphenation and quotation marks", () => {
    const text = "Zarząd informuje, że Emitent nie doko-\nnał   wykupu obligacji serii „A” w terminie.";
    expect(quoteIn(text, 'Emitent nie dokonał wykupu obligacji serii "A"')).toBe(true);
    expect(quoteIn(text, "Emitent dokonał wykupu obligacji serii A")).toBe(false);
    expect(quoteIn(text, "wykupu")).toBe(false);
  });

  it("reads a web page's text", () => {
    expect(quoteIn(plainText("<p>Sp&oacute;łka&nbsp;nie wypłaciła <b>odsetek</b> od obligacji</p><script>var odsetek = 1;</script>"), "nie wypłaciła odsetek od obligacji")).toBe(true);
  });
});

describe("the event's input", () => {
  const base = { kind: "missed-payment", date: "2026-01-20", text: "series A not redeemed", source: "ESPI 3/2026" };
  it("needs the stored document and the passage, but for `reviewed`", () => {
    expect(PaymentEventInput.safeParse(base).success).toBe(false);
    expect(PaymentEventInput.safeParse({ ...base, documentSha: "a".repeat(64), quote: "nie dokonał wykupu obligacji" }).success).toBe(true);
    expect(PaymentEventInput.safeParse({ ...base, kind: "reviewed" }).success).toBe(true);
  });
  it("a later payment date only on a missed payment, and not before it", () => {
    const full = { ...base, documentSha: "a".repeat(64), quote: "nie dokonał wykupu obligacji" };
    expect(PaymentEventInput.safeParse({ ...full, resolvedOn: "2026-02-01" }).success).toBe(true);
    expect(PaymentEventInput.safeParse({ ...full, resolvedOn: "2026-01-01" }).success).toBe(false);
    expect(PaymentEventInput.safeParse({ ...full, kind: "paid", resolvedOn: "2026-02-01" }).success).toBe(false);
  });
});

describe("the payment check in `catalyst work`", () => {
  const entity = { entityId: "0000000001", shortName: "Abc", legalName: "x", aiAnalysis: { on: true, by: "you", at: "2026-11-01" }, industry: "Developer", businessSummary: "Builds flats." } as WorkInput["entities"][number];
  const input = (over: Partial<WorkInput>): WorkInput => ({ today: "2026-11-09", entities: [entity], names: [], years: new Map(), judged: new Map(), collected: new Map(), checklist: [], measures: new Map(), lenderByName: () => false, outOfScope: () => true, ...over });
  const payments = (i: WorkInput) => workItems(i).filter((w) => w.kind === "payments");

  it("never read: one item; read and nothing since: none", () => {
    const ended = new Map([["0000000001", [{ code: "ABC0126", lastSeen: "2026-01-12" }]]]);
    expect(payments(input({ ended }))[0]!.detail).toContain("never checked");
    expect(payments(input({ ended, reviewedTo: new Map([["0000000001", "2026-06-30"]]) }))).toEqual([]);
    expect(payments(input({}))).toEqual([]);
  });

  it("a bond ended or GPW acted after the reports were read: read on", () => {
    const ended = new Map([["0000000001", [{ code: "ABC0126", lastSeen: "2026-01-12" }, { code: "ABC1026", lastSeen: "2026-10-12" }]]]);
    const measures = new Map([["0000000001", [{ code: "ABC0128", published: "2026-10-02T12:00:00", reason: "na żądanie KNF", signal: "distress" as const }]]]);
    const [item] = payments(input({ ended, measures, reviewedTo: new Map([["0000000001", "2026-06-30"]]) }));
    expect(item!.detail).toContain("1 bond ended since (ABC1026)");
    expect(item!.detail).toContain("1 GPW measure since (ABC0128)");
  });
});
