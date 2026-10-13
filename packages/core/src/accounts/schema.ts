// Account metadata import file (imports/accounts/*.json): which kinds of assets of an account aren't tracked
// yet, so its cash and value are shown as incomplete. Written by scripts/sheet-to-transactions.ts.

import { z } from "zod";

export const AccountInput = z.object({
  account: z.string().min(1),
  incomplete: z.array(z.string()).default([]),
  /** The account's own currency (e.g. EUR at IBKR); its summary is also shown in it. */
  baseCurrency: z.string().length(3).optional(),
});
export type AccountInput = z.output<typeof AccountInput>;

export const parseAccountsFile = (json: string): AccountInput[] => z.array(AccountInput).parse(JSON.parse(json));
