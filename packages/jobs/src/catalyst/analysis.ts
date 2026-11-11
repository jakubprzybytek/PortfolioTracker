// A company's analysis from what the table holds (core/catalyst/issuers/company.ts): its listed bonds with what they
// still owe, its stored years, its names; NBP's exchange rates for bonds in other currencies (fetched once a day per
// instance). Used by the API (the company view) and the metrics (the bonds' signals).

import type { CatalystBondItem, CatalystEntityItem, CatalystLinkItem, CatalystNameItem, CatalystScheduleItem, CatalystTermsItem, FinancialYear } from "@portfolio/core/catalyst/index";
import { companyAnalysis, instalmentsAhead, nbpRates, type CompanyAnalysis, type ListedBond } from "@portfolio/core/catalyst/issuers/index";
import { catalystRepo } from "./context.ts";

export const ratesToday = nbpRates();

/**
 * A company's listed bonds with the amount each still owes (issue value at the current nominal), and the instalments
 * still ahead when the bond's amortization schedule is stored.
 */
export function listedBondsOf(entityId: string, bonds: CatalystBondItem[], links: CatalystLinkItem[], terms: Map<string, CatalystTermsItem>, schedules: Map<string, CatalystScheduleItem> = new Map()): ListedBond[] {
  const own = new Set(links.filter((l) => l.entityId === entityId).map((l) => l.isin));
  return bonds
    .filter((b) => own.has(b.isin) && b.status === "listed" && b.maturity)
    .flatMap((b) => {
      const value = terms.get(b.isin)?.issueValue;
      if (!value) return [];
      const owed = b.nominal && value.nominal ? (value.amount * b.nominal) / value.nominal : value.amount;
      const s = schedules.get(b.isin);
      const issuedNominal = value.nominal ?? s?.issuedNominal;
      const instalments = s && issuedNominal ? instalmentsAhead(value.amount, issuedNominal, b.nominal ?? issuedNominal, s.instalments) : undefined;
      return [{ isin: b.isin, name: b.code, currency: value.currency ?? b.currency, issueValue: owed, maturityDay: b.maturity!, ...(owed !== value.amount ? { issued: value.amount } : {}), ...(instalments ? { instalments } : {}) }];
    });
}

export interface AnalysisInputs {
  bonds: CatalystBondItem[];
  links: CatalystLinkItem[];
  terms: Map<string, CatalystTermsItem>;
  schedules: Map<string, CatalystScheduleItem>;
  names: CatalystNameItem[];
  today: string;
}

/** Reads what every company's analysis needs, once. */
export async function analysisInputs(today: string): Promise<AnalysisInputs> {
  const [bonds, links, terms, names, schedules] = await Promise.all([catalystRepo.listBonds(), catalystRepo.listLinks(), catalystRepo.listTerms(), catalystRepo.listNames(), catalystRepo.listSchedules()]);
  return { bonds, links, terms: new Map(terms.map((t) => [t.isin, t])), schedules: new Map(schedules.map((s) => [s.isin, s])), names, today };
}

/** A financing vehicle's bonds are judged on its group's reports (`financialsEntityId`). */
export async function analysisOf(entity: Pick<CatalystEntityItem, "entityId" | "industry" | "financeRuleSet" | "ruleSetOverride" | "financialsEntityId">, inputs: AnalysisInputs, years?: FinancialYear[]): Promise<CompanyAnalysis> {
  const own = entity.financialsEntityId ? await catalystRepo.listYears(entity.financialsEntityId) : (years ?? (await catalystRepo.listYears(entity.entityId)));
  const names = inputs.names.filter((n) => n.entityId === entity.entityId).map((n) => n.name);
  return companyAnalysis(
    { ...(entity.industry ? { industry: entity.industry } : {}), ...(entity.financeRuleSet ? { financeRuleSet: entity.financeRuleSet } : {}), ...(entity.ruleSetOverride ? { ruleSetOverride: entity.ruleSetOverride } : {}) },
    names,
    own,
    listedBondsOf(entity.entityId, inputs.bonds, inputs.links, inputs.terms, inputs.schedules),
    await ratesToday(),
    inputs.today,
  );
}
