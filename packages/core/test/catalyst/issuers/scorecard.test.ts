import { describe, it, expect } from 'vitest';
import { computeScorecard } from "../../../src/catalyst/issuers/scorecard.ts";
import type { FinancialYearData } from "../../../src/catalyst/issuers/scorecard.ts";

// Example A from the design spec — low risk, all data present
const exampleA: FinancialYearData[] = [
  { issuerName: 'Polmech', year: 2024, revenue: 48200, ebit: 5100, depreciation: 2700, interestExpense: 1200, netProfit: 2900, totalAssets: 42000, intangibleAssets: 800, equity: 18500, financialDebt: 14000, cash: 3200, currentAssets: 16000, inventory: 4500, currentLiabilities: 9800 },
  { issuerName: 'Polmech', year: 2023, revenue: 43500, ebit: 4600, depreciation: 2500, interestExpense: 1200, netProfit: 2700, totalAssets: 40000, intangibleAssets: 800, equity: 17000, financialDebt: 14200, cash: 2800, currentAssets: 15000, inventory: 4400, currentLiabilities: 9500 },
  { issuerName: 'Polmech', year: 2022, revenue: 39800, ebit: 4100, depreciation: 2400, interestExpense: 1150, netProfit: 2300, totalAssets: 38500, intangibleAssets: 850, equity: 15500, financialDebt: 14500, cash: 2200, currentAssets: 13800, inventory: 4400, currentLiabilities: 9200 },
  { issuerName: 'Polmech', year: 2021, revenue: 35200, ebit: 3400, depreciation: 2400, interestExpense: 1100, netProfit: 1800, totalAssets: 36000, intangibleAssets: 900, equity: 13500, financialDebt: 14800, cash: 1800, currentAssets: 12500, inventory: 4300, currentLiabilities: 8800 },
  { issuerName: 'Polmech', year: 2020, revenue: 31400, ebit: 2900, depreciation: 2200, interestExpense: 1100, netProfit: 1400, totalAssets: 34000, intangibleAssets: 900, equity: 12000, financialDebt: 15000, cash: 1500, currentAssets: 11000, inventory: 4200, currentLiabilities: 8500 },
];

// Example B from the design spec — high risk
const exampleB: FinancialYearData[] = [
  { issuerName: 'Budmax', year: 2024, revenue: 61000, ebit: 1800, depreciation: 1600, interestExpense: 1600, netProfit: 100, totalAssets: 55000, intangibleAssets: 1200, equity: 8000, financialDebt: 28000, cash: 900, currentAssets: 22000, inventory: 3000, currentLiabilities: 24000 },
  { issuerName: 'Budmax', year: 2023, revenue: 63000, ebit: 2400, depreciation: 1800, interestExpense: 1500, netProfit: 400, totalAssets: 53500, intangibleAssets: 1200, equity: 9500, financialDebt: 26500, cash: 1200, currentAssets: 22000, inventory: 2900, currentLiabilities: 23000 },
  { issuerName: 'Budmax', year: 2022, revenue: 65200, ebit: 3100, depreciation: 1900, interestExpense: 1400, netProfit: 900, totalAssets: 52000, intangibleAssets: 1100, equity: 12500, financialDebt: 24000, cash: 1500, currentAssets: 22000, inventory: 2800, currentLiabilities: 21500 },
  { issuerName: 'Budmax', year: 2021, revenue: 68500, ebit: 3800, depreciation: 1800, interestExpense: 1300, netProfit: 1500, totalAssets: 50000, intangibleAssets: 1100, equity: 13000, financialDebt: 21000, cash: 1800, currentAssets: 22500, inventory: 2700, currentLiabilities: 19500 },
  { issuerName: 'Budmax', year: 2020, revenue: 71000, ebit: 4200, depreciation: 1800, interestExpense: 1200, netProfit: 2100, totalAssets: 48000, intangibleAssets: 1000, equity: 12500, financialDebt: 18000, cash: 2000, currentAssets: 22000, inventory: 2500, currentLiabilities: 18000 },
];

describe('computeScorecard', () => {
  describe('Dimension 1 — Debt Burden', () => {
    it('D/E: green when < 1.0', () => {
      // Polmech current year: 14000 / 18500 = 0.76
      const sc = computeScorecard(exampleA);
      const d1 = sc.dimensions.find(d => d.name === 'Debt Burden')!;
      const de = d1.metrics.find(m => m.name === 'D/E')!;
      expect(de.value).toBeCloseTo(0.757, 2);
      expect(de.signal).toBe('green');
    });

    it('D/E: red when > 2.0', () => {
      // Budmax current year: 28000 / 8000 = 3.5
      const sc = computeScorecard(exampleB);
      const d1 = sc.dimensions.find(d => d.name === 'Debt Burden')!;
      const de = d1.metrics.find(m => m.name === 'D/E')!;
      expect(de.value).toBeCloseTo(3.5, 1);
      expect(de.signal).toBe('red');
    });

    it('Net Debt/EBITDA: green when < 2.5', () => {
      // Polmech: (14000 - 3200) / (5100 + 2700) = 10800 / 7800 = 1.38
      const sc = computeScorecard(exampleA);
      const d1 = sc.dimensions.find(d => d.name === 'Debt Burden')!;
      const ndEbitda = d1.metrics.find(m => m.name === 'Net Debt/EBITDA')!;
      expect(ndEbitda.value).toBeCloseTo(1.385, 2);
      expect(ndEbitda.signal).toBe('green');
    });

    it('Net Debt/EBITDA: red when > 4.0', () => {
      // Budmax: (28000 - 900) / (1800 + 1600) = 27100 / 3400 = 7.97
      const sc = computeScorecard(exampleB);
      const d1 = sc.dimensions.find(d => d.name === 'Debt Burden')!;
      const ndEbitda = d1.metrics.find(m => m.name === 'Net Debt/EBITDA')!;
      expect(ndEbitda.value).toBeCloseTo(7.97, 1);
      expect(ndEbitda.signal).toBe('red');
    });

    it('D/E: red when equity is negative', () => {
      const negativeEquityYear: FinancialYearData[] = [{
        issuerName: 'Test', year: 2024,
        financialDebt: 10000, equity: -2000,
        ebit: 500, depreciation: 200, interestExpense: 400,
        netProfit: -100, revenue: 5000,
        totalAssets: 15000, intangibleAssets: 200,
        cash: 300, currentAssets: 4000, inventory: 500, currentLiabilities: 3000,
      }];
      const sc = computeScorecard(negativeEquityYear);
      const d1 = sc.dimensions.find(d => d.name === 'Debt Burden')!;
      const de = d1.metrics.find(m => m.name === 'D/E')!;
      expect(de.signal).toBe('red');
    });

    it('Net Debt/EBITDA: red when EBITDA is negative', () => {
      const negativeEbitdaYear: FinancialYearData[] = [{
        issuerName: 'Test', year: 2024,
        financialDebt: 10000, cash: 500, equity: 3000,
        ebit: -1000, depreciation: 400, interestExpense: 400,
        netProfit: -1500, revenue: 5000,
        totalAssets: 15000, intangibleAssets: 200,
        currentAssets: 4000, inventory: 500, currentLiabilities: 3000,
      }];
      const sc = computeScorecard(negativeEbitdaYear);
      const d1 = sc.dimensions.find(d => d.name === 'Debt Burden')!;
      const ndEbitda = d1.metrics.find(m => m.name === 'Net Debt/EBITDA')!;
      expect(ndEbitda.signal).toBe('red');
    });
  });

  describe('Dimension 2 — Debt Service', () => {
    it('ICR: green when > 3.0', () => {
      // Polmech: 5100 / 1200 = 4.25
      const sc = computeScorecard(exampleA);
      const d2 = sc.dimensions.find(d => d.name === 'Debt Service')!;
      const icr = d2.metrics.find(m => m.name === 'ICR')!;
      expect(icr.value).toBeCloseTo(4.25, 2);
      expect(icr.signal).toBe('green');
    });

    it('ICR: red when < 1.5', () => {
      // Budmax: 1800 / 1600 = 1.125
      const sc = computeScorecard(exampleB);
      const d2 = sc.dimensions.find(d => d.name === 'Debt Service')!;
      const icr = d2.metrics.find(m => m.name === 'ICR')!;
      expect(icr.value).toBeCloseTo(1.125, 2);
      expect(icr.signal).toBe('red');
    });
  });

  describe('Dimension 3 — Liquidity', () => {
    it('Current Ratio: green when > 1.5', () => {
      // Polmech: 16000 / 9800 = 1.63
      const sc = computeScorecard(exampleA);
      const d3 = sc.dimensions.find(d => d.name === 'Liquidity')!;
      const cr = d3.metrics.find(m => m.name === 'Current Ratio')!;
      expect(cr.value).toBeCloseTo(1.633, 2);
      expect(cr.signal).toBe('green');
    });

    it('Current Ratio: red when < 1.0', () => {
      // Budmax: 22000 / 24000 = 0.917
      const sc = computeScorecard(exampleB);
      const d3 = sc.dimensions.find(d => d.name === 'Liquidity')!;
      const cr = d3.metrics.find(m => m.name === 'Current Ratio')!;
      expect(cr.value).toBeCloseTo(0.917, 2);
      expect(cr.signal).toBe('red');
    });

    it('has no quick ratio: inventory is a fair current asset for most companies (KGHM, developers)', () => {
      const d3 = computeScorecard(exampleA).dimensions.find(d => d.name === 'Liquidity')!;
      expect(d3.metrics.map(m => m.name)).toEqual(['Current Ratio']);
    });
  });

  describe('Dimension 4 — Profitability', () => {
    it('EBIT Margin: green when > 10%', () => {
      // Polmech: 5100 / 48200 = 10.58%
      const sc = computeScorecard(exampleA);
      const d4 = sc.dimensions.find(d => d.name === 'Profitability')!;
      const em = d4.metrics.find(m => m.name === 'EBIT Margin')!;
      expect(em.value).toBeCloseTo(0.1058, 3);
      expect(em.signal).toBe('green');
    });

    it('EBIT Margin: yellow when 5–10%', () => {
      // ebit = 3700, revenue = 61000 → 6.1%
      const yellowYear: FinancialYearData[] = [{
        issuerName: 'Test', year: 2024,
        revenue: 61000, ebit: 3700, depreciation: 1000,
        interestExpense: 500, netProfit: 2000,
        totalAssets: 50000, intangibleAssets: 500,
        equity: 20000, financialDebt: 10000, cash: 2000,
        currentAssets: 15000, inventory: 2000, currentLiabilities: 10000,
      }];
      const sc = computeScorecard(yellowYear);
      const d4 = sc.dimensions.find(d => d.name === 'Profitability')!;
      const em = d4.metrics.find(m => m.name === 'EBIT Margin')!;
      expect(em.signal).toBe('yellow');
    });

    it('Net Margin: red when < 1%', () => {
      // Budmax: 100 / 61000 = 0.16%
      const sc = computeScorecard(exampleB);
      const d4 = sc.dimensions.find(d => d.name === 'Profitability')!;
      const nm = d4.metrics.find(m => m.name === 'Net Margin')!;
      expect(nm.value).toBeCloseTo(0.00164, 4);
      expect(nm.signal).toBe('red');
    });
  });

  describe('Dimension 5 — Asset Coverage', () => {
    it('Asset Coverage Ratio: green when > 1.5', () => {
      // Polmech: (42000 - 800 - 9800) / 14000 = 31400 / 14000 = 2.24
      const sc = computeScorecard(exampleA);
      const d5 = sc.dimensions.find(d => d.name === 'Asset Coverage')!;
      const acr = d5.metrics.find(m => m.name === 'Asset Coverage Ratio')!;
      expect(acr.value).toBeCloseTo(2.243, 2);
      expect(acr.signal).toBe('green');
    });

    it('Equity Ratio: red when < 15%', () => {
      // Budmax: 8000 / 55000 = 14.5%
      const sc = computeScorecard(exampleB);
      const d5 = sc.dimensions.find(d => d.name === 'Asset Coverage')!;
      const er = d5.metrics.find(m => m.name === 'Equity Ratio')!;
      expect(er.value).toBeCloseTo(0.1455, 3);
      expect(er.signal).toBe('red');
    });
  });

  describe('Dimension 6 — Financial Trend', () => {
    it('Revenue CAGR: green for Polmech (>5% growth)', () => {
      const sc = computeScorecard(exampleA);
      const d6 = sc.dimensions.find(d => d.name === 'Financial Trend')!;
      const cagr = d6.metrics.find(m => m.name === 'Revenue CAGR')!;
      // (48200/31400)^(1/4) - 1 ≈ 11.3%
      expect(cagr.value).toBeGreaterThan(0.05);
      expect(cagr.signal).toBe('green');
    });

    it('Revenue CAGR: red for Budmax (shrinking)', () => {
      const sc = computeScorecard(exampleB);
      const d6 = sc.dimensions.find(d => d.name === 'Financial Trend')!;
      const cagr = d6.metrics.find(m => m.name === 'Revenue CAGR')!;
      // (61000/71000)^(1/4) - 1 ≈ -3.7%
      expect(cagr.value).toBeLessThan(0);
      expect(cagr.signal).toBe('red');
    });

    it('returns na signal when fewer than 3 years of data', () => {
      const twoYears = exampleA.slice(0, 2);
      const sc = computeScorecard(twoYears);
      const d6 = sc.dimensions.find(d => d.name === 'Financial Trend')!;
      expect(d6.signal).toBe('na');
    });

    it('EBITDA Margin Trend: green when consistently improving', () => {
      const sc = computeScorecard(exampleA);
      const d6 = sc.dimensions.find(d => d.name === 'Financial Trend')!;
      const ebitdaTrend = d6.metrics.find(m => m.name === 'EBITDA Margin Trend')!;
      // Polmech EBITDA margins ~16.2% stable with slight positive slope → green
      expect(ebitdaTrend.signal).toBe('green');
    });

    it('EBITDA Margin Trend: red when consistently deteriorating', () => {
      const sc = computeScorecard(exampleB);
      const d6 = sc.dimensions.find(d => d.name === 'Financial Trend')!;
      const ebitdaTrend = d6.metrics.find(m => m.name === 'EBITDA Margin Trend')!;
      // Budmax EBITDA margins: 8.5% → 8.2% → 7.7% → 6.7% → 5.6% → red
      expect(ebitdaTrend.signal).toBe('red');
    });

    it('Net Debt/EBITDA Trend: green when declining', () => {
      const sc = computeScorecard(exampleA);
      const d6 = sc.dimensions.find(d => d.name === 'Financial Trend')!;
      const ndTrend = d6.metrics.find(m => m.name === 'Net Debt/EBITDA Trend')!;
      // Polmech: 2.65 → 2.24 → 1.89 → 1.60 → 1.38 (strongly declining) → green
      expect(ndTrend.signal).toBe('green');
    });

    it('Net Debt/EBITDA Trend: red when rapidly rising', () => {
      const sc = computeScorecard(exampleB);
      const d6 = sc.dimensions.find(d => d.name === 'Financial Trend')!;
      const ndTrend = d6.metrics.find(m => m.name === 'Net Debt/EBITDA Trend')!;
      // Budmax: 2.67 → 3.43 → 4.50 → 6.02 → 7.97 (rapidly rising) → red
      expect(ndTrend.signal).toBe('red');
    });
  });

  describe('Dimension 6 — Financial Trend signal with missing data', () => {
    const trendOf = (years: FinancialYearData[]) =>
      computeScorecard(years).dimensions.find(d => d.name === 'Financial Trend')!;

    it('is n/a when no trend metric can be computed', () => {
      // Arche S.A. (stored analysis): 3 years, but revenue missing for the oldest and no debt/D&A
      const trend = trendOf([
        { issuerName: 'Arche', year: 2024, revenue: 743.93, ebit: 136.22, netProfit: 95.77, equity: 699.6 },
        { issuerName: 'Arche', year: 2023, revenue: 731.04, equity: 604.43 },
        { issuerName: 'Arche', year: 2022 },
      ]);
      expect(trend.metrics.every(m => m.signal === 'na')).toBe(true);
      expect(trend.signal).toBe('na');
    });

    it('is not green on a single available metric', () => {
      // Anwim S.A. (stored analysis): only revenue CAGR available (5.1% → green)
      const trend = trendOf([
        { issuerName: 'Anwim', year: 2024, revenue: 13395.3 },
        { issuerName: 'Anwim', year: 2023, revenue: 10707.0 },
        { issuerName: 'Anwim', year: 2022, revenue: 12121.4 },
      ]);
      expect(trend.metrics.find(m => m.name === 'Revenue CAGR')!.signal).toBe('green');
      expect(trend.signal).toBe('yellow');
    });

    it('is green when all available metrics are green and there are at least two', () => {
      const withoutDebt = exampleA.map(({ financialDebt: _debt, ...y }) => y);
      const trend = trendOf(withoutDebt);
      expect(trend.metrics.filter(m => m.signal !== 'na')).toHaveLength(2);
      expect(trend.signal).toBe('green');
    });
  });

  describe('overall scorecard', () => {
    it('Polmech has no red dimensions', () => {
      const sc = computeScorecard(exampleA);
      const redDimensions = sc.dimensions.filter(d => d.signal === 'red');
      expect(redDimensions).toHaveLength(0);
    });

    it('Budmax has multiple red dimensions', () => {
      const sc = computeScorecard(exampleB);
      const redDimensions = sc.dimensions.filter(d => d.signal === 'red');
      expect(redDimensions.length).toBeGreaterThanOrEqual(4);
    });
  });
});
