// connections/statementUpload.jsx · POLISH-15 item 5 (W-1127-Settings-03). THE STATEMENT
// IMPORTS CARD SAYS ITS LAST FILE, AND ITS UPLOAD VISIBLY DOES SOMETHING.
//
// "The Statement imports card has no last-file line while its Upload button gives no visible
// feedback." Upload opened the whole giving-sources panel below the fold, so nothing on screen
// moved. Now Upload opens the file import itself (the one SpreadsheetImport, with its own reading
// and importing progress), the button says "Opening…" while it loads, and the card's line names
// the last file and its day (GET /connections' statements card, server/connections/cards.js).
import { lazy, Suspense, useEffect, useState } from "react";
import { retryImport } from "../../lib/lazyRetry";
import { displayDateShort } from "../../../../shared/displayDate";
import { orgTodayCivil } from "../../lib/orgToday";

// SpreadsheetImport is big; it loads when Upload is pressed, not with the page.
const SpreadsheetImport = lazy(() => retryImport(() => import("../SpreadsheetImport")));

// "Last file: october-statement.csv, brought in Nov 25." The day is the org's (the server's last_day).
export function lastFileLine(card) {
  const f = card && card.lastFile;
  if (!f || !f.name) return "";
  return `Last file: ${f.name}, brought in ${f.day ? displayDateShort(f.day, orgTodayCivil()) : "on a day not recorded"}${f.undone ? ", since undone" : ""}.`;
}

// The card's Upload: { opening, open(), node }. `node` is rendered once by the page.
export function useStatementUpload(onImported) {
  const [state, setState] = useState("");   // "" | "opening" | "open"
  const close = () => setState("");
  const node = state ? (
    <Suspense fallback={null}>
      <Loaded onReady={() => setState(s => (s === "opening" ? "open" : s))} />
      <SpreadsheetImport onClose={close} onImported={() => { close(); if (onImported) onImported(); }} />
    </Suspense>
  ) : null;
  return { opening: state === "opening", open: () => setState(s => s || "opening"), node };
}

// Mounted beside SpreadsheetImport inside the same Suspense: it runs only once the import has loaded.
function Loaded({ onReady }) {
  useEffect(() => { onReady(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
