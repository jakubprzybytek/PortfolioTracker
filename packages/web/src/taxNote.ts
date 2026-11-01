// The tax withheld on money received (a coupon, a dividend …), kept as a line of the transaction's note: the stored
// amount is what came in after the tax, and the note says how much was taken. The form reads the line back on edit.

const LINE = /^Tax paid: (\d+(?:,\d+)?) ([A-Z]{3})$/m;

/** "Tax paid: 19,00 PLN" */
export const taxLine = (tax: number, currency: string): string => `Tax paid: ${tax.toFixed(2).replace(".", ",")} ${currency}`;

/** The note with its tax line (if any) taken out, and the tax that line gave. */
export function splitTaxNote(note: string): { note: string; tax?: number; currency?: string } {
  const m = LINE.exec(note);
  if (!m) return { note };
  const rest = note
    .replace(LINE, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
  return { note: rest, tax: Number(m[1]!.replace(",", ".")), currency: m[2]! };
}

/** The note to store: the user's text, then the tax line when tax was paid. */
export function joinTaxNote(note: string, tax: number | undefined, currency: string): string {
  const text = note.trim();
  if (!tax) return text;
  return text ? `${text}\n${taxLine(tax, currency)}` : taxLine(tax, currency);
}
