# Tax on coupons

On an ordinary brokerage account, the broker withholds 19% tax (*podatek Belki*) from every coupon. On IKE and IKZE nothing is withheld.

## The first coupon after a purchase is taxed in full

If you buy in the middle of a period, part of the first coupon only gives back the [accrued interest](#/wiki?page=accrued-interest) you paid the seller. You might expect the broker to tax only the rest. It doesn't: it taxes the whole coupon.

Checked on your Bossa account: CPS0130's coupon of 12 January 2026 was 1,848.42 zł on 42 bonds; 20 of them had been bought on 29 September 2025, with about 392 zł of accrued interest. Bossa withheld **351.20 zł**, exactly 19% of the whole coupon. Had it deducted the accrued interest, the tax would have been about 277 zł.

## Where the accrued interest goes

The accrued interest you paid is part of the bond's **cost**, with the price and the commission. It counts when the bond is sold or redeemed:

`gain at maturity = nominal − (price + accrued interest paid + commission)`

- Bought **below par**, the gain is reduced by the accrued interest, so the tax paid early on it comes back then.
- Bought **at or above par**, there's no gain to reduce; the accrued interest makes a loss. In your PIT-38 a loss can offset other capital gains; the app doesn't count on that.

So on an ordinary account the 19% on the accrued interest is at best a loan to the tax office until maturity, at worst lost. That's what the amber [period bar](#/wiki?page=interest-period) shows.

## In the app's yields

The net yields (Catalyst's "Yield net", Buy, hold or sell) tax the flows the way the broker does:

- every coupon in full, the first one too;
- at maturity, the gain over what you paid (price + accrued interest + commission);
- a loss at maturity isn't credited.

The accrued interest counts once, as cost. (Before November 2026 the app also took it off the first coupon's tax, counting it twice and making mid-period purchases look better than they are.)

## Retail treasury bonds

The same 19% applies to the interest of retail bonds (TOS, COI, EDO, ROR, DOR): withheld when interest is paid, or at redemption for those that add interest to the bond. There's no accrued interest to pay when you buy them: they're bought from the State at the nominal.
