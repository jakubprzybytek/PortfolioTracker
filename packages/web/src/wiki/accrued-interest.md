# Accrued interest and settlement

## Clean and dirty price

Bonds on Catalyst are quoted at a **clean price**: a percentage of the nominal, without interest. A price of 99.50 on a bond of 1,000 zł means 995 zł.

The coupon goes to whoever holds the bond on the record day (see [Interest period and record day](#/wiki?page=interest-period)), for the whole period. So the buyer pays the seller the interest earned so far in the period: the **accrued interest** (in Polish: *narosłe odsetki*). Price plus accrued interest is the **dirty price**, what you actually pay.

`accrued interest = coupon for the period × days from the period's start to settlement / days in the period`

The bond's terms set the exact day count; the app follows them (and the Ministry of Finance's calculator for treasury bonds). The daily Catalyst file publishes each bond's accrued interest too.

## Settlement: T+2

A trade on the Warsaw exchange settles two session days later (**T+2**): that's when the bonds and the money change hands (KDPW), and the day the accrued interest is counted to. Session days are weekdays without a holiday; the exchange is also closed on Good Friday, 24 and 31 December.

- Bought on Wednesday: settles on Friday.
- Bought on Friday: settles on Tuesday, so you pay three more days of interest than on Wednesday, but you also get them back with the coupon.

## An example

20 bonds of 1,000 zł at 8.73%, bought 82 days into the period:

`1,000 × 8.73% × 82 / 365 = 19.61 zł a bond, 392 zł for 20`

You pay those 392 zł on top of the price. The next coupon pays you the whole period, accrued part included.

## Is accrued interest a cost?

Economically, no: it comes back with the next coupon. For tax it's different, and it matters when you buy: see [Tax on coupons](#/wiki?page=coupon-tax).

## In the app

- **Holdings**: the "Accrued" column, per bond, on the valuation day; a bond's value is its price plus accrued interest.
- **Catalyst** and **Buy, hold or sell**: yields assume you buy today at the last price plus accrued interest to T+2 plus the commission.
- A corporate bond with no rate for its current period is valued at the clean price only, and says so.
