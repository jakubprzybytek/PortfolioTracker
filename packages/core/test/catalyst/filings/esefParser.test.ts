import { describe, expect, it } from 'vitest';
import { UnsupportedFilingError } from "../../../src/catalyst/filings/filingParser.ts";
import { looksLikeEsef, openEsef, parseEsef, parseIxNumber, reportingEntityName } from "../../../src/catalyst/filings/esefParser.ts";
import { esefPackage, esefReport, makeZip } from "./fixtures/esefPackage.ts";

const value = (filing: ReturnType<typeof parseEsef>, column: number, field: string) =>
    (filing.periods[column]!.figures as Record<string, { value: number; source: string[] }>)[field]!;

describe('parseIxNumber', () => {
    it.each([
        ['1,234,567', 'ixt:num-dot-decimal', 1234567],
        ['1,250.5', 'ixt:num-dot-decimal', 1250.5],
        ['1 234 567', 'ixt:num-comma-decimal', 1234567],
        ['1.234,5', 'ixt:num-comma-decimal', 1234.5],
        ['-', 'ixt:fixed-zero', 0],
        ['–', 'ixt:num-dot-decimal', 0],
        ['12', 'ixt:numcommadecimal', 12],
    ])('%s (%s) → %d', (raw, format, expected) => {
        expect(parseIxNumber(raw, format)).toBe(expected);
    });
});

describe('parseEsef', () => {
    describe('report package', () => {
        const filing = parseEsef(openEsef(esefPackage, 'testowa.zip'));

        it('reads the entity, scope, currency and the two fiscal years', () => {
            expect(filing).toMatchObject({
                format: 'esef', scope: 'group', companyName: 'Testowa Deweloper S.A.', lei: '259400TESTOWA0000001', currency: 'PLN', checks: [],
            });
            expect(filing.periods.map(p => [p.column, p.periodStart, p.periodEnd, p.months])).toEqual([
                ['current', '2025-01-01', '2025-12-31', 12],
                ['previous', '2024-01-01', '2024-12-31', 12],
            ]);
        });

        it('applies scale and sign, and ignores facts with dimensions', () => {
            expect(value(filing, 0, 'totalAssets').value).toBe(100_000_000);
            expect(value(filing, 0, 'equity').value).toBe(40_000_000);       // not the 99,999 of the parent-only column
            expect(value(filing, 1, 'netProfit').value).toBe(-1_250_500);
            expect(value(filing, 1, 'operatingCashFlow').value).toBe(-500_000);
            expect(value(filing, 0, 'intangibleAssets')).toEqual({ value: 1_000_000, source: ['ifrs-full:IntangibleAssetsOtherThanGoodwill', 'ifrs-full:Goodwill'] });
            expect(value(filing, 0, 'capex').value).toBe(350_000);
        });

        it('sums the debt lines of the calculation tree, with filer lines classified by anchor and label', () => {
            expect(value(filing, 0, 'financialDebt')).toEqual({
                value: 29_500_000,
                source: ['ifrs-full:LongtermBorrowings', 'ifrs-full:NoncurrentPortionOfNoncurrentBondsIssued', 'ifrs-full:NoncurrentLeaseLiabilities', 'testowa:BondsAndLoansCurrent', 'ifrs-full:CurrentLeaseLiabilities'],
            });
            // "credits, loans and bonds" can't be split, so bonds are the bond-only lines
            expect(value(filing, 0, 'bonds')).toEqual({ value: 8_000_000, source: ['ifrs-full:NoncurrentPortionOfNoncurrentBondsIssued'] });
        });

        it('keeps the lines of the three statement roles in order, labelled as printed, with parents and items', () => {
            expect(filing).toMatchObject({ standard: 'ifrs', presentedUnit: 1000, lineSigns: 'tagged' });
            const lines = filing.periods[0]!.lines;
            const balance = lines.filter(l => l.statement === 'balance');
            expect(balance.slice(0, 3).map(l => [l.label, l.item])).toEqual([['Wartości niematerialne', 'intangibleAssets'], ['Wartość firmy', 'goodwill'], ['Aktywa trwałe', 'noncurrentAssets']]);
            const loans = balance.find(l => l.code === 'testowa:BondsAndLoansCurrent')!;
            expect(loans).toMatchObject({ label: 'Kredyty, pożyczki i obligacje krótkoterminowe', anchor: 'ifrs-full:CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings', item: 'debtMixed', value: 5_000_000 });
            expect(balance[loans.parent!]!.code).toBe('ifrs-full:CurrentLiabilities');
            // income statement role, not the changes in equity one (which also holds profit)
            expect(lines.filter(l => l.statement === 'income').map(l => l.code)).toEqual([
                'ifrs-full:RevenueFromSaleOfGoods', 'testowa:RentalRevenue', 'ifrs-full:ProfitLossFromOperatingActivities', 'ifrs-full:FinanceCosts', 'ifrs-full:ProfitLoss']);
            expect(lines.filter(l => l.statement === 'cashFlow').map(l => l.item)).toEqual(['netProfit', 'depreciation', 'operatingCashFlow', 'capex', 'capex']);
        });

        it('sums revenue lines when no total is tagged, including filer lines anchored to revenue', () => {
            expect(value(filing, 0, 'revenue')).toEqual({ value: 50_000_000, source: ['ifrs-full:RevenueFromSaleOfGoods', 'testowa:RentalRevenue'] });
            expect(filing.notes).toEqual(expect.arrayContaining(['Revenue: no total tagged, sum of revenue lines', 'Interest: no interest expense tagged, finance costs used']));
        });
    });

    describe('report without its package', () => {
        const filing = parseEsef(openEsef(esefReport, 'testowa.xhtml'));

        it('falls back to the standard IFRS concepts, and says so', () => {
            expect(value(filing, 0, 'financialDebt').value).toBe(24_500_000);
            expect(value(filing, 0, 'revenue').value).toBe(45_000_000);
            expect(filing.notes).toContain('Debt: report without its package, standard IFRS debt concepts only (filer-specific lines are missed)');
        });
    });

    it("reads the filer's own debt lines by name when a report without its package has no standard ones on a side", () => {
        const report = esefReport.toString('utf-8');
        const facts = [...report.matchAll(/<ix:nonFraction\b[^>]*name="ifrs-full:(?:CurrentLeaseLiabilities|LongtermBorrowings|NoncurrentPortionOfNoncurrentBondsIssued|NoncurrentLeaseLiabilities)"[^>]*>[^<]*<\/ix:nonFraction>/g)];
        expect(facts.length).toBeGreaterThan(0);
        // Rename the standard non-current lines to one filer concept
        let renamed = report;
        for (const [i, f] of facts.entries()) {
            const isNoncurrent = !/CurrentLeaseLiabilities"/.test(f[0]) || /NoncurrentLeaseLiabilities/.test(f[0]);
            renamed = renamed.replace(f[0], isNoncurrent ? f[0]!.replace(/name="ifrs-full:\w+"/, `name="testowa:NonCurrentBorrowingsAndLeaseLiabilities${i}"`) : f[0]);
        }
        const filing = parseEsef(openEsef(Buffer.from(renamed), 'testowa.xhtml'));
        expect(value(filing, 0, 'financialDebt').source).toEqual(expect.arrayContaining([expect.stringMatching(/^testowa:NonCurrentBorrowingsAndLeaseLiabilities/), 'ifrs-full:CurrentLeaseLiabilities']));
        expect(filing.notes).toContain("Debt: report without its package; standard IFRS debt concepts, and the filer's own lines recognised by name where a side had none");
    });

    it('falls back per side when the calculation tree covers only one', () => {
        const report = esefReport.toString('utf-8');
        const partial = makeZip({
            'p/reports/r.xhtml': report,
            'p/x/r_cal.xml': `<link:linkbase xmlns:link="http://www.xbrl.org/2003/linkbase" xmlns:xlink="http://www.w3.org/1999/xlink"><link:calculationLink>
<link:loc xlink:label="p" xlink:href="x.xsd#ifrs-full_NoncurrentLiabilities"/><link:loc xlink:label="c" xlink:href="x.xsd#ifrs-full_LongtermBorrowings"/>
<link:calculationArc xlink:from="p" xlink:to="c" weight="1"/></link:calculationLink></link:linkbase>`,
        });
        const filing = parseEsef(openEsef(partial));
        expect(value(filing, 0, 'financialDebt').source).toEqual(['ifrs-full:LongtermBorrowings', 'ifrs-full:CurrentLeaseLiabilities']);
        expect(filing.notes).toContain('Debt: no current borrowing lines in the calculation tree, standard IFRS concepts used');
    });

    describe('balance sheet in order of liquidity (financial companies)', () => {
        // No current or non-current liabilities: debt lines sit directly under total liabilities.
        const fact = (name: string, ctx: string, v: string) =>
            `<ix:nonFraction name="${name}" contextRef="${ctx}" unitRef="PLN" decimals="-3" scale="3" format="ixt:num-dot-decimal">${v}</ix:nonFraction>`;
        const ctx = (id: string, period: string) =>
            `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="http://standards.iso.org/iso/17442">259400FINANSOWA00001</xbrli:identifier></xbrli:entity><xbrli:period>${period}</xbrli:period></xbrli:context>`;
        const report = `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:ix="http://www.xbrl.org/2013/inlineXBRL" xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:iso4217="http://www.xbrl.org/2003/iso4217"><body>
<ix:header><ix:resources>${ctx('D', '<xbrli:startDate>2025-01-01</xbrli:startDate><xbrli:endDate>2025-12-31</xbrli:endDate>')}${ctx('I', '<xbrli:instant>2025-12-31</xbrli:instant>')}
<xbrli:unit id="PLN"><xbrli:measure>iso4217:PLN</xbrli:measure></xbrli:unit></ix:resources></ix:header>
${fact('ifrs-full:ProfitLoss', 'D', '1,000')}${fact('ifrs-full:Assets', 'I', '13,000')}${fact('ifrs-full:EquityAndLiabilities', 'I', '13,000')}
${fact('ifrs-full:Equity', 'I', '5,300')}${fact('ifrs-full:Liabilities', 'I', '7,700')}${fact('ifrs-full:TradeAndOtherPayables', 'I', '400')}
${fact('ifrs-full:LoansReceived', 'I', '3,700')}${fact('ifrs-full:DebtInstrumentsIssuedAtAmortisedCost', 'I', '3,500')}${fact('ifrs-full:LeaseLiabilities', 'I', '100')}
</body></html>`;
        const debtOf = (filing: ReturnType<typeof parseEsef>) => [value(filing, 0, 'financialDebt'), value(filing, 0, 'bonds')];

        it('takes the debt lines under total liabilities from the calculation tree', () => {
            const cal = `<link:linkbase xmlns:link="http://www.xbrl.org/2003/linkbase" xmlns:xlink="http://www.w3.org/1999/xlink"><link:calculationLink>
<link:loc xlink:label="p" xlink:href="x.xsd#ifrs-full_Liabilities"/>
${['TradeAndOtherPayables', 'LoansReceived', 'DebtInstrumentsIssuedAtAmortisedCost', 'LeaseLiabilities'].map((c, i) =>
                `<link:loc xlink:label="c${i}" xlink:href="x.xsd#ifrs-full_${c}"/><link:calculationArc xlink:from="p" xlink:to="c${i}" weight="1"/>`).join('')}
</link:calculationLink></link:linkbase>`;
            const filing = parseEsef(openEsef(makeZip({ 'p/reports/r.xhtml': report, 'p/x/r_cal.xml': cal })));
            expect(debtOf(filing)).toEqual([
                { value: 7_300_000, source: ['ifrs-full:LoansReceived', 'ifrs-full:DebtInstrumentsIssuedAtAmortisedCost', 'ifrs-full:LeaseLiabilities'] },
                { value: 3_500_000, source: ['ifrs-full:DebtInstrumentsIssuedAtAmortisedCost'] },
            ]);
            expect(filing.notes).toContain('Debt: balance sheet in order of liquidity (no current and non-current liabilities), debt lines under total liabilities');
            expect(filing.checks).toEqual([]);
        });

        it('counts a filer line named "...LoansBorrowingsAndBondsPayable" as debt (Murapol)', () => {
            const withPayable = report.replace('ifrs-full:LoansReceived', 'testowa:LoansBorrowingsAndBondsPayable');
            const cal = `<link:linkbase xmlns:link="http://www.xbrl.org/2003/linkbase" xmlns:xlink="http://www.w3.org/1999/xlink"><link:calculationLink>
<link:loc xlink:label="p" xlink:href="x.xsd#ifrs-full_Liabilities"/>
${['ifrs-full_TradeAndOtherPayables', 'testowa_LoansBorrowingsAndBondsPayable', 'ifrs-full_LeaseLiabilities'].map((c, i) =>
                `<link:loc xlink:label="c${i}" xlink:href="x.xsd#${c}"/><link:calculationArc xlink:from="p" xlink:to="c${i}" weight="1"/>`).join('')}
</link:calculationLink></link:linkbase>`;
            const filing = parseEsef(openEsef(makeZip({ 'p/reports/r.xhtml': withPayable, 'p/x/r_cal.xml': cal })));
            expect(value(filing, 0, 'financialDebt')).toEqual({ value: 3_800_000, source: ['testowa:LoansBorrowingsAndBondsPayable', 'ifrs-full:LeaseLiabilities'] });
        });

        it('takes EBIT from the line the calculation tree sums the operating lines into, when the filer swapped the tags', () => {
            const swapped = report.replace('</body>', `${fact('ifrs-full:GrossProfit', 'D', '5,000')}${fact('ifrs-full:SellingExpense', 'D', '1,000')}`
                + `${fact('ifrs-full:ShareOfProfitLossOfAssociatesAndJointVenturesAccountedForUsingEquityMethod', 'D', '4,000')}${fact('ifrs-full:ProfitLossFromOperatingActivities', 'D', '140')}</body>`);
            const arc = (from: string, to: string, w: number, i: number) =>
                `<link:loc xlink:label="f${i}" xlink:href="x.xsd#ifrs-full_${from}"/><link:loc xlink:label="t${i}" xlink:href="x.xsd#ifrs-full_${to}"/><link:calculationArc xlink:from="f${i}" xlink:to="t${i}" weight="${w}"/>`;
            const cal = `<link:linkbase xmlns:link="http://www.xbrl.org/2003/linkbase" xmlns:xlink="http://www.w3.org/1999/xlink"><link:calculationLink>
${arc('ShareOfProfitLossOfAssociatesAndJointVenturesAccountedForUsingEquityMethod', 'GrossProfit', 1, 1)}${arc('ShareOfProfitLossOfAssociatesAndJointVenturesAccountedForUsingEquityMethod', 'SellingExpense', -1, 2)}
${arc('ProfitLossBeforeTax', 'ShareOfProfitLossOfAssociatesAndJointVenturesAccountedForUsingEquityMethod', 1, 3)}${arc('ProfitLossBeforeTax', 'ProfitLossFromOperatingActivities', 1, 4)}
</link:calculationLink></link:linkbase>`;
            const filing = parseEsef(openEsef(makeZip({ 'p/reports/r.xhtml': swapped, 'p/x/r_cal.xml': cal })));
            expect(value(filing, 0, 'ebit')).toEqual({ value: 4_000_000, source: ['ifrs-full:ShareOfProfitLossOfAssociatesAndJointVenturesAccountedForUsingEquityMethod'] });
            expect((filing.notes ?? []).join(' ')).toMatch(/EBIT: the calculation tree sums the operating lines into .*ShareOfProfitLoss/);
            // without the tree: the standard tag
            expect(value(parseEsef(openEsef(Buffer.from(swapped))), 0, 'ebit').value).toBe(140_000);
        });

        it('reads inventories tagged with the newer InventoriesTotal concept', () => {
            const filing = parseEsef(openEsef(Buffer.from(report.replace('</body>', `${fact('ifrs-full:InventoriesTotal', 'I', '2,200')}</body>`))));
            expect(value(filing, 0, 'inventory')).toEqual({ value: 2_200_000, source: ['ifrs-full:InventoriesTotal'] });
        });

        it("takes the filer's operating income total as revenue when operating profit is income less expenses", () => {
            const withIncome = report.replace('</body>', `${fact('ifrs-full:ProfitLossFromOperatingActivities', 'D', '1,500')}${fact('fin:OperatingIncome', 'D', '3,000')}
${fact('ifrs-full:InterestIncomeForFinancialAssetsMeasuredAtAmortisedCost', 'D', '2,500')}${fact('ifrs-full:RevenueFromRenderingOfServices', 'D', '550')}
${fact('fin:OtherIncomeCostsFromPortfolios', 'D', '-50')}${fact('ifrs-full:OperatingExpense', 'D', '1,500')}</body>`);
            const arc = (from: string, to: string, w: number, i: number) => `<link:loc xlink:label="f${i}" xlink:href="x.xsd#${from}"/><link:loc xlink:label="t${i}" xlink:href="x.xsd#${to}"/><link:calculationArc xlink:from="f${i}" xlink:to="t${i}" weight="${w}"/>`;
            const cal = `<link:linkbase xmlns:link="http://www.xbrl.org/2003/linkbase" xmlns:xlink="http://www.w3.org/1999/xlink"><link:calculationLink>
${arc('ifrs-full_ProfitLossFromOperatingActivities', 'fin_OperatingIncome', 1, 1)}${arc('ifrs-full_ProfitLossFromOperatingActivities', 'ifrs-full_OperatingExpense', -1, 2)}
${arc('fin_OperatingIncome', 'ifrs-full_InterestIncomeForFinancialAssetsMeasuredAtAmortisedCost', 1, 3)}${arc('fin_OperatingIncome', 'ifrs-full_RevenueFromRenderingOfServices', 1, 4)}${arc('fin_OperatingIncome', 'fin_OtherIncomeCostsFromPortfolios', 1, 5)}
</link:calculationLink></link:linkbase>`;
            const filing = parseEsef(openEsef(makeZip({ 'p/reports/r.xhtml': withIncome, 'p/x/r_cal.xml': cal })));
            expect(value(filing, 0, 'revenue')).toEqual({ value: 3_000_000, source: ['fin:OperatingIncome'] });
            expect(filing.notes).toContain("Revenue: no revenue total tagged, the filer's operating income total used (fin:OperatingIncome)");
        });

        it('takes a single line of financial liabilities at amortised cost as a last resort', () => {
            const oneLine = report
                .replace(/<ix:nonFraction name="ifrs-full:(LoansReceived|LeaseLiabilities)"[^>]*>[^<]*<\/ix:nonFraction>/g, '')
                .replace('ifrs-full:DebtInstrumentsIssuedAtAmortisedCost" contextRef="I" unitRef="PLN" decimals="-3" scale="3" format="ixt:num-dot-decimal">3,500',
                    'ifrs-full:FinancialLiabilitiesAtAmortisedCost" contextRef="I" unitRef="PLN" decimals="-3" scale="3" format="ixt:num-dot-decimal">7,300');
            const filing = parseEsef(openEsef(Buffer.from(oneLine)));
            expect(debtOf(filing)).toEqual([{ value: 7_300_000, source: ['ifrs-full:FinancialLiabilitiesAtAmortisedCost'] }, undefined]);
            expect(filing.notes).toContain('Debt: one line of financial liabilities at amortised cost (credits, loans, bonds and leases together; may hold other financial liabilities), so no bond split');
        });

        it('falls back to the standard unsplit concepts without a package', () => {
            const filing = parseEsef(openEsef(Buffer.from(report)));
            expect(debtOf(filing)[0]).toEqual({ value: 7_300_000, source: ['ifrs-full:DebtInstrumentsIssuedAtAmortisedCost', 'ifrs-full:LoansReceived', 'ifrs-full:LeaseLiabilities'] });
        });
    });

    it('reads current totals excluding held for sale, and a filer depreciation line less impairment', () => {
        const fact = (name: string, ctx: string, v: string) =>
            `<ix:nonFraction name="${name}" contextRef="${ctx}" unitRef="PLN" decimals="-5" scale="6" format="ixt:num-comma-decimal">${v}</ix:nonFraction>`;
        const ctx = (id: string, period: string) =>
            `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="http://standards.iso.org/iso/17442">259400POLSATLIKE0001</xbrli:identifier></xbrli:entity><xbrli:period>${period}</xbrli:period></xbrli:context>`;
        const report = `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:ix="http://www.xbrl.org/2013/inlineXBRL" xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:iso4217="http://www.xbrl.org/2003/iso4217"><body>
<ix:header><ix:resources>${ctx('D', '<xbrli:startDate>2025-01-01</xbrli:startDate><xbrli:endDate>2025-12-31</xbrli:endDate>')}${ctx('I', '<xbrli:instant>2025-12-31</xbrli:instant>')}
<xbrli:unit id="PLN"><xbrli:measure>iso4217:PLN</xbrli:measure></xbrli:unit></ix:resources></ix:header>
${fact('ifrs-full:ProfitLoss', 'D', '2.602,6')}${fact('ifrs-full:Assets', 'I', '35.269,1')}
${fact('ifrs-full:CurrentAssetsOtherThanAssetsOrDisposalGroupsClassifiedAsHeldForSaleOrAsHeldForDistributionToOwners', 'I', '8.500,0')}
${fact('ifrs-full:NoncurrentAssetsOrDisposalGroupsClassifiedAsHeldForSale', 'I', '28,3')}
${fact('ifrs-full:CurrentLiabilitiesOtherThanLiabilitiesIncludedInDisposalGroupsClassifiedAsHeldForSale', 'I', '6.018,9')}
${fact('cp:DepreciationAmortizationImpairmentAndLiquidation', 'D', '4.433,1')}${fact('ifrs-full:ImpairmentLossRecognisedInProfitOrLossGoodwill', 'D', '2.716,9')}
</body></html>`;
        const def = `<link:linkbase xmlns:link="http://www.xbrl.org/2003/linkbase" xmlns:xlink="http://www.w3.org/1999/xlink"><link:definitionLink>
<link:loc xlink:label="w" xlink:href="x.xsd#ifrs-full_AdjustmentsToReconcileProfitLossOtherThanChangesInWorkingCapital"/><link:loc xlink:label="n" xlink:href="x.xsd#cp_DepreciationAmortizationImpairmentAndLiquidation"/>
<link:definitionArc xlink:arcrole="http://www.esma.europa.eu/xbrl/esef/arcrole/wider-narrower" xlink:from="w" xlink:to="n"/></link:definitionLink></link:linkbase>`;
        const filing = parseEsef(openEsef(makeZip({ 'p/reports/r.xhtml': report, 'p/x/r_def.xml': def })));
        expect(value(filing, 0, 'currentAssets').value).toBe(8_528_300_000);
        expect(value(filing, 0, 'currentLiabilities').value).toBe(6_018_900_000);
        expect(value(filing, 0, 'depreciation')).toEqual({ value: 1_716_200_000, source: ['cp:DepreciationAmortizationImpairmentAndLiquidation', '−ifrs-full:ImpairmentLossRecognisedInProfitOrLossGoodwill'] });
    });

    it('flags a balance sheet that does not add up', () => {
        const broken = Buffer.from(esefReport.toString('utf-8').replace(
            '<ix:nonFraction name="ifrs-full:EquityAndLiabilities" contextRef="I2025" unitRef="PLN" decimals="-3" scale="3" format="ixt:num-dot-decimal">100,000',
            '<ix:nonFraction name="ifrs-full:EquityAndLiabilities" contextRef="I2025" unitRef="PLN" decimals="-3" scale="3" format="ixt:num-dot-decimal">100,900'));
        expect(parseEsef(openEsef(broken)).checks).toEqual([
            '2025-12-31: total assets 100,000,000 ≠ total equity and liabilities 100,900,000',
            '2025-12-31: equity 40,000,000 + liabilities 60,000,000 ≠ 100,900,000',
        ]);
    });

    it('tells ESEF from other files, and refuses an untagged report', () => {
        expect(looksLikeEsef(esefPackage)).toBe(true);
        expect(looksLikeEsef(esefReport)).toBe(true);
        expect(looksLikeEsef(Buffer.from('<?xml version="1.0"?><JednostkaInna/>'))).toBe(false);
        const untagged = Buffer.from('<html xmlns="http://www.w3.org/1999/xhtml" xmlns:ix="http://www.xbrl.org/2013/inlineXBRL"><body>Bilans</body></html>');
        expect(() => parseEsef(openEsef(untagged))).toThrow(UnsupportedFilingError);
        expect(() => openEsef(makeZip({ 'a/readme.txt': 'x' }))).toThrow(/not an ESEF report package/);
    });
});

describe('reportingEntityName', () => {
    it.each([
        ['Jednostką sporządzającą sprawozdanie finansowe jest P.A. NOVA S.A.', 'P.A. NOVA S.A.'],
        ['Jednostką sporządzającą skonsolidowane sprawozdanie finansowe jest P.A. NOVA S.A.', 'P.A. NOVA S.A.'],
        ['KGHM Polska Miedź S.A.', 'KGHM Polska Miedź S.A.'],
        ['AB', 'AB'],
    ])('%s → %s', (tagged, name) => expect(reportingEntityName(tagged)).toBe(name));
});
