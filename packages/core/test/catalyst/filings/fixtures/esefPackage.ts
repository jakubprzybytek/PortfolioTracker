// Builds an ESEF report package (zip) around fixtures/esef-group.xhtml for tests, with the filer's
// calculation, definition (anchoring), label and presentation linkbases.
import { readFileSync } from "node:fs";
import path from "node:path";
import { deflateRawSync } from "node:zlib";

export const esefReport = readFileSync(path.join(import.meta.dirname, 'esef-group.xhtml'));

const IFRS = 'https://xbrl.ifrs.org/taxonomy/2022-03-24/full_ifrs/full_ifrs-cor_2022-03-24.xsd';
const loc = (label: string, concept: string) => {
    const [prefix, name] = concept.split(':');
    const href = prefix === 'ifrs-full' ? `${IFRS}#ifrs-full_${name}` : `testowa-2025-12-31.xsd#${prefix}_${name}`;
    return `<link:loc xlink:type="locator" xlink:label="${label}" xlink:href="${href}"/>`;
};
const linkbase = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<link:linkbase xmlns:link="http://www.xbrl.org/2003/linkbase" xmlns:xlink="http://www.w3.org/1999/xlink">${body}</link:linkbase>`;

function calculation(parent: string, children: string[]): string {
    return `<link:calculationLink xlink:type="extended" xlink:role="http://testowa.pl/role/bs">
${loc('p', parent)}
${children.map((c, i) => `${loc(`c${i}`, c)}<link:calculationArc xlink:type="arc" xlink:arcrole="http://www.xbrl.org/2003/arcrole/summation-item" xlink:from="p" xlink:to="c${i}" weight="1"/>`).join('\n')}
</link:calculationLink>`;
}

const cal = linkbase([
    calculation('ifrs-full:NoncurrentLiabilities', ['ifrs-full:LongtermBorrowings', 'ifrs-full:NoncurrentPortionOfNoncurrentBondsIssued', 'ifrs-full:NoncurrentLeaseLiabilities', 'ifrs-full:NoncurrentProvisions']),
    calculation('ifrs-full:CurrentLiabilities', ['testowa:BondsAndLoansCurrent', 'testowa:InterestPayableOnBonds', 'ifrs-full:CurrentLeaseLiabilities', 'ifrs-full:TradeAndOtherCurrentPayables']),
].join('\n'));

const anchor = (wider: string, narrower: string, i: number) =>
    `${loc(`w${i}`, wider)}${loc(`n${i}`, narrower)}<link:definitionArc xlink:type="arc" xlink:arcrole="http://www.esma.europa.eu/xbrl/esef/arcrole/wider-narrower" xlink:from="w${i}" xlink:to="n${i}"/>`;

const def = linkbase(`<link:definitionLink xlink:type="extended" xlink:role="http://www.esma.europa.eu/xbrl/esef/role/esef_role-999999">
${anchor('ifrs-full:CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings', 'testowa:BondsAndLoansCurrent', 1)}
${anchor('ifrs-full:OtherCurrentFinancialLiabilities', 'testowa:InterestPayableOnBonds', 2)}
${anchor('ifrs-full:Revenue', 'testowa:RentalRevenue', 3)}
</link:definitionLink>`);

const lab = linkbase(`<link:labelLink xlink:type="extended" xlink:role="http://www.xbrl.org/2003/role/link">
${loc('l1', 'testowa:BondsAndLoansCurrent')}<link:label xlink:type="resource" xlink:label="t1" xlink:role="http://www.xbrl.org/2003/role/label" xml:lang="pl">Kredyty, pożyczki i obligacje krótkoterminowe</link:label><link:labelArc xlink:type="arc" xlink:arcrole="http://www.xbrl.org/2003/arcrole/concept-label" xlink:from="l1" xlink:to="t1"/>
${loc('l2', 'testowa:InterestPayableOnBonds')}<link:label xlink:type="resource" xlink:label="t2" xlink:role="http://www.xbrl.org/2003/role/label" xml:lang="pl">Zobowiązania z tytułu odsetek od obligacji</link:label><link:labelArc xlink:type="arc" xlink:arcrole="http://www.xbrl.org/2003/arcrole/concept-label" xlink:from="l2" xlink:to="t2"/>
</link:labelLink>`);

// Presentation: one role per statement, a root abstract with the lines (arcs written in reverse: the order
// attribute decides). Changes in equity too, which holds profit as well and must not be taken for the income statement.
function presentation(role: string, concepts: string[]): string {
    return `<link:presentationLink xlink:type="extended" xlink:role="http://testowa.pl/role/${role}">
${loc('root', 'ifrs-full:StatementAbstract')}
${concepts.map((c, i) => `${loc(`c${i}`, c)}<link:presentationArc xlink:type="arc" xlink:arcrole="http://www.xbrl.org/2003/arcrole/parent-child" xlink:from="root" xlink:to="c${i}" order="${i + 1}"/>`).reverse().join('\n')}
</link:presentationLink>`;
}

const pre = linkbase([
    presentation('SprawozdanieZSytuacjiFinansowej', ['ifrs-full:IntangibleAssetsOtherThanGoodwill', 'ifrs-full:Goodwill', 'ifrs-full:NoncurrentAssets',
        'ifrs-full:Inventories', 'ifrs-full:CashAndCashEquivalents', 'ifrs-full:CurrentAssets', 'ifrs-full:Assets',
        'ifrs-full:NoncontrollingInterests', 'ifrs-full:Equity',
        'ifrs-full:LongtermBorrowings', 'ifrs-full:NoncurrentPortionOfNoncurrentBondsIssued', 'ifrs-full:NoncurrentLeaseLiabilities', 'ifrs-full:NoncurrentProvisions', 'ifrs-full:NoncurrentLiabilities',
        'testowa:BondsAndLoansCurrent', 'testowa:InterestPayableOnBonds', 'ifrs-full:CurrentLeaseLiabilities', 'ifrs-full:TradeAndOtherCurrentPayables', 'ifrs-full:CurrentLiabilities',
        'ifrs-full:Liabilities', 'ifrs-full:EquityAndLiabilities']),
    presentation('ZmianyWKapitale', ['ifrs-full:ProfitLoss', 'ifrs-full:Equity']),
    presentation('SprawozdanieZWyniku', ['ifrs-full:RevenueFromSaleOfGoods', 'testowa:RentalRevenue', 'ifrs-full:ProfitLossFromOperatingActivities', 'ifrs-full:FinanceCosts', 'ifrs-full:ProfitLoss']),
    presentation('SprawozdanieZPrzeplywow', ['ifrs-full:ProfitLoss', 'ifrs-full:AdjustmentsForDepreciationAndAmortisationExpense', 'ifrs-full:CashFlowsFromUsedInOperatingActivities',
        'ifrs-full:PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities', 'ifrs-full:PurchaseOfIntangibleAssetsClassifiedAsInvestingActivities']),
].join('\n'));

// Zip writer for tests: deflated entries, CRC left at 0 (the reader doesn't check it).
export function makeZip(files: Record<string, Buffer | string>): Buffer {
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;
    for (const [name, content] of Object.entries(files)) {
        const raw = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8');
        const data = deflateRawSync(raw);
        const nameBytes = Buffer.from(name, 'utf-8');
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(8, 8);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(raw.length, 22);
        local.writeUInt16LE(nameBytes.length, 26);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(8, 10);
        central.writeUInt32LE(data.length, 20);
        central.writeUInt32LE(raw.length, 24);
        central.writeUInt16LE(nameBytes.length, 28);
        central.writeUInt32LE(offset, 42);
        locals.push(local, nameBytes, data);
        centrals.push(central, nameBytes);
        offset += 30 + nameBytes.length + data.length;
    }
    const centralSize = centrals.reduce((a, b) => a + b.length, 0);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(Object.keys(files).length, 8);
    end.writeUInt16LE(Object.keys(files).length, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, ...centrals, end]);
}

export const esefPackage = makeZip({
    'testowa-2025-12-31-pl/META-INF/reportPackage.json': '{"documentInfo":{"documentType":"https://xbrl.org/report-package/2023"}}',
    'testowa-2025-12-31-pl/www.testowa.pl/2025-12-31/testowa-2025-12-31_cal.xml': cal,
    'testowa-2025-12-31-pl/www.testowa.pl/2025-12-31/testowa-2025-12-31_def.xml': def,
    'testowa-2025-12-31-pl/www.testowa.pl/2025-12-31/testowa-2025-12-31_lab-pl.xml': lab,
    'testowa-2025-12-31-pl/www.testowa.pl/2025-12-31/testowa-2025-12-31_pre.xml': pre,
    'testowa-2025-12-31-pl/reports/testowa-2025-12-31-pl.xhtml': esefReport,
});
