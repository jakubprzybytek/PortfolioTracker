# Redemptions and interest

When a bond matures, its owner gets the principal back plus the last interest. This page explains how to enter that. Whichever way you choose, the portfolio's value, profit and XIRR come out the same. The only difference is where the interest shows: in the holding's **Coupons**, or as a **realised gain** in Sales. Choose by the kind of bond, so each holding's interest stays in one place.

## Bonds that pay interest out: COI, ROR, DOR, listed bonds

These pay interest every month or year, and you enter each payment as a **Coupon**. Enter the last payment the same way:

- a **Redemption** of the principal: the number of bonds, price 100, no tax;
- a **Coupon** with the last interest: the gross amount and the tax withheld.

On a new Redemption, the **Interest paid with it** field saves both at once.

This keeps all of the holding's interest under Coupons. The redemption has no gain, because the bonds were bought at 100 and are redeemed at 100. If you put the interest inside the Redemption instead, the last year's interest would show as a realised gain in Sales, apart from the earlier years'.

Example: 236 COI bonds redeemed on 14 November 2026. Redemption 236 × 100 = 23,600 zł. Interest 920.40 zł, tax 174.88 zł: the Coupon saved is 745.52 zł.

## Bonds that add interest to the bond: EDO, ROS, ROD, TOS

These pay nothing until the end, and the bank pays the bond's grown value in one sum. Enter it as one **Redemption**:

- the number of bonds;
- the price: the value per bond, e.g. 131.52;
- the amount: the gross total, with the tax in the tax field.

The interest is the redemption's gain over the cost. It shows in Sales, marked as not in PIT-38, because the tax was withheld at source.

## Early redemption

Before maturity, the bank deducts a fee per bond from the interest. Enter it as above, by the kind of bond, with the interest the statement shows after the fee. The fee is already deducted, so leave the fee field empty. A **Sell** at the same values works too: the app treats a sell and a redemption alike.

## Rollover (zamiana)

A rollover pays the old series out and buys a new one with the money, at the rollover price (*cena zamiany*). This is 99.90 zł for EDO instead of 100 zł. Enter two things:

1. the redemption of the old series, as above;
2. a **Buy** of the new series:
   - the date: the day the old series matured, which is also when the new one starts earning interest;
   - the price: the rollover price;
   - the amount: number of bonds × rollover price.

The new bonds can't cost more than the money paid out, so a few złoty are left over. The bank pays them to your account. If the app keeps cash for that account, enter a **Withdrawal** of what's left.

Example: 236 COI bonds rolled over into 243 EDO on 14 November 2026. 23,600 zł principal + 745.52 zł interest after tax = 24,345.52 zł. The buy is 243 × 99.90 = 24,275.70 zł, and 69.82 zł is left over.

## A new month's series

A new series is on sale from the 1st of the month. The app takes series from the Ministry of Finance's file, which is updated a few days into the month. If **Find** doesn't know a series yet, it loads the file again on the spot. If that also fails, try again later.
