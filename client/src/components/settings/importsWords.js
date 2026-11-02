import { photoReport } from "../../../../shared/photoMatch";

// ── BUILD-87 Part 1 — THE IMPORTS PAGE ──────────────────────────────────────
// Every run this org has committed, newest first: its name, when, who, rows
// in, gifts created, dollars in. Clicking one reopens the receipt AS IT WAS —
// the stored summary, never a fresh computation over a database that has
// moved on. Read only. Undo is a future part, and the screen says so rather
// than leaving the absence to be discovered.
export const fmtMoney=n=>"$"+Number(n||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
export const fmtCount=n=>Number(n||0).toLocaleString();

// The running sentence, while the chunks are still going. It is the SAME
// wording shared/photoMatch.js builds server-side — imported rather than
// retyped, so a folder sent in eleven chunks and a folder sent in one cannot
// describe themselves differently.
export const photoSentence=(attached,needsYou)=>photoReport({attached,needsYou});
