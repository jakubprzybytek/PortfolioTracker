# Redemptions and interest

When a bond matures, or you redeem it early, you get the principal back with the interest still owed. The app records these two separately, the same way for every bond:

- **the principal**: a **Redemption** at maturity, or a **Sell** when redeemed early. Price 100, the amount is number of bonds × nominal, no tax;
- **the interest**: a **Coupon** with the gross amount and the tax withheld (none on IKE/IKZE).

On a new Redemption, or a Sell of a retail bond, the **Interest paid with it** field saves both at once.

## Why interest is always a coupon

- **It is income, not a gain on the bond.** Coupons go into the holding's Coupons column, Income by year and the income part of the profit breakdown. A bond bought at 100 and paid back at 100 has no capital gain. If the interest were inside the redemption, it would show in Sales as a realised gain instead.
- **One rule for every bond.** COI, ROR and DOR pay interest every month or year, and the last payment is no different. EDO, ROS, ROD and TOS pay all their interest at the end: it is still interest, taxed at source like the rest. Listed bonds have always worked this way: coupons, then the redemption at 100.
- **Sales then shows only real capital results**: an early redemption's fee, or the 10 grosz of a rollover discount.

Profit, value and XIRR don't depend on the choice; only where the interest shows does. The interest of an EDO, ROS, ROD or TOS counts as income in the year it is paid out, which is when you get it and pay its tax. Until then it is part of the holding's unrealised gain.

## Examples

**COI at maturity**: 236 bonds redeemed on 14 November 2026, interest 920.40 zł, tax 174.88 zł.
- Redemption: 236 × 100 = 23,600 zł.
- Coupon: 920.40 zł gross, 174.88 zł tax, so 745.52 zł is saved.

**EDO redeemed early on IKE**: 1,202 bonds paid out at 131.52 zł each.
- Sell: 1,202 × 100 = 120,200 zł.
- Coupon: 37,887.04 zł, no tax.

## Early redemption

The bank deducts a fee per bond from the interest. The Coupon is the interest as the statement shows it, after the fee.

If the interest was smaller than the fee, the rest comes out of the principal: the statement pays, for example, 99.50 zł a bond. Enter that as a Sell at 100 with the difference in the **fee** field (0.50 × number of bonds). The cash is the same, and the fee shows as a cost.

## Rollover (zamiana)

A rollover pays the old series out and buys a new one with the money, at the rollover price (*cena zamiany*). This is 99.90 zł for EDO instead of 100 zł. Enter it in two steps:

1. the redemption of the old series and its interest, as above;
2. a **Buy** of the new series:
   - the date: the day the old series matured, which is also when the new one starts earning interest;
   - the price: the rollover price;
   - the amount: number of bonds × rollover price.

The new bonds can't cost more than the money paid out, so a few złoty are left over. The bank pays them to your account. If the app keeps cash for that account, enter a **Withdrawal** of what's left.

Example: 236 COI rolled over into 243 EDO on 14 November 2026. 23,600 zł + 745.52 zł = 24,345.52 zł paid out. The buy is 243 × 99.90 = 24,275.70 zł, and 69.82 zł is left over.

## A new month's series

A new series is on sale from the 1st of the month. The app takes series from the Ministry of Finance's file, which is updated a few days into the month. If **Find** doesn't know a series yet, it loads the file again on the spot. If that also fails, try again later.
