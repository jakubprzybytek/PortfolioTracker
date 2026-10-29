// Account metadata import file (imports/accounts/*.json): the account's own currency, if not PLN.

import { z } from "zod";

export const AccountInput = z.object({
  account: z.string().min(1),
  /** The account's own currency (e.g. EUR at IBKR); its summary is also shown in it. */
  baseCurrency: z.string().length(3).optional(),
});
export type AccountInput = z.output<typeof AccountInput>;

export const parseAccountsFile = (json: string): AccountInput[] => z.array(AccountInput).parse(JSON.parse(json));
