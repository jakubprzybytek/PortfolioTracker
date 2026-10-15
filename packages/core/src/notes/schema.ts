// Notes: free text in Markdown, written in the app (Notes view) or restored from imports/notes/*.json (the monthly
// backup's notes.json). User input, so they live in the transactions table.

import { randomBytes } from "node:crypto";
import { z } from "zod";

/** A note from the form: a title and the Markdown text. */
export const NoteFields = z.object({
  title: z.string().trim().min(1, "needs a title").max(200),
  body: z.string().max(200_000),
});
export type NoteFields = z.output<typeof NoteFields>;

/** A note as stored and backed up (import file record). */
export const NoteInput = NoteFields.extend({
  id: z.string().regex(/^[a-z0-9]{1,32}$/),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type NoteInput = z.output<typeof NoteInput>;

export const parseNotesFile = (json: string): NoteInput[] => z.array(NoteInput).parse(JSON.parse(json));

export const newNoteId = (): string => randomBytes(8).toString("hex");
