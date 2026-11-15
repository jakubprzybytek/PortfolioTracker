# XIRR and time-weighted return

The app shows two kinds of annual return. They answer different questions, so they can differ a lot, even in sign.

| | XIRR (money-weighted) | Time-weighted return |
|---|---|---|
| Question | How did **my money** do? | How did **the investments** do? |
| Deposits and withdrawals | Count: when you put money in matters | Don't count: they're taken out day by day |
| Where | Dashboard (XIRR card), Accounts, Holdings | Dashboard (this year), Performance: Returns by year, Growth of 100 zł, Drawdown |
| Compare with | Your other options for the same money (a deposit, a retail bond) | Benchmarks (WIG, MSCI World, 40/60), inflation |

## XIRR

XIRR is the annual rate at which all your cash flows add up to zero: every deposit, every withdrawal and, as the last flow, what the account is worth today. It's the rate a savings account would need to pay to end up with the same money, given the same deposits on the same days.

`Σ flow × (1 + r) ^ (−days since the first flow / 365) = 0`

- **An account's XIRR** (Dashboard, Accounts) uses deposits and withdrawals of money, plus today's total.
- **A position's XIRR** (Holdings) uses the position's own flows: buys, sales, redemptions, coupons, dividends, and the fees and taxes on them, plus its value today. A group's XIRR (e.g. all bonds) puts its positions' flows together.

The app solves it by bisection between −99% and +1000% a year. There's no XIRR without flows both in and out; a position held only a few days can show an extreme rate, as a few days' change is turned into a yearly one.

## Time-weighted return

The time-weighted return chains the portfolio's daily growth, leaving out money that came in or went out that day:

`day's growth = (total today − money put in today) / total yesterday`

The days are multiplied together over a year (or any range). The result is what 100 zł invested at the start would have become, whatever you added or took out later. That's why it's the one to compare with the benchmarks and inflation: they don't know about your deposits either.

**Real return** is the time-weighted return after inflation: `(1 + return) / (1 + inflation) − 1`, with inflation from GUS's CPI, December on December.

**Drawdown** is measured on the time-weighted return too, so taking money out isn't a loss.

## Why they differ: an example

- You put in 10,000 zł. In the first year it gains 20%, to 12,000 zł.
- You then add 50,000 zł. The second year it loses 10%: 62,000 → 55,800 zł.

| | Result |
|---|---|
| Time-weighted, 2 years | 1.20 × 0.90 − 1 = **+8.0%** (+3.9% a year) |
| XIRR | **−6.0% a year** |
| Profit | 55,800 − 60,000 = **−4,200 zł** |

The investments made money over the two years, but most of your money arrived just before the bad year, so you lost. The time-weighted return grades the investments; XIRR grades the result, timing included.

## And "% of net deposits"?

The Profit card's percentage is profit divided by money put in minus taken out. It ignores time: 10% over one year and 10% over ten years look the same. Use it as a size, not as a return.
