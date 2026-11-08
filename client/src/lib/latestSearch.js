// lib/latestSearch.js · STALE-2 (W-1107-Donors-44X). A SEARCH BOX SHOWS THE
// ANSWER TO WHAT IS TYPED NOW, NEVER TO WHAT WAS TYPED BEFORE.
//
// Merge with… and Household link searched as she typed and kept the last
// answer on screen until the next one landed, so on prod (~0.9 s a read) the
// list showed "Mar"'s people under "Marl": one query behind. This is LIST-3's
// Cmd+K rule (TopBar.jsx), in one hook any dialog can use:
//   · every question gets a number; an answer lands only when it is newer
//     than the one on screen, so a slow older answer never replaces a newer;
//   · while the newest is on its way, the answer on screen shows only if it
//     was for the start of what is typed now, and then only the rows that
//     still match (narrow), never rows for the older words;
//   · otherwise nothing shows, and `pending` says an answer is coming, so a
//     "nobody matches" line never shows for an answer that has not arrived.
import { useEffect, useRef, useState } from "react";

// fetcher(term) → Promise<rows>. narrow(row, termLower) → still a match?
// key: what makes two questions the same (the term plus any options).
// Returns [rows, pending].
export function useLatestSearch(term, key, fetcher, { delay = 200, enabled = true, narrow = null } = {}) {
  const [shown, setShown] = useState({ key: null, term: "", rows: [] });
  const seqRef = useRef(0);
  const shownSeqRef = useRef(0);
  const fetchRef = useRef(fetcher); fetchRef.current = fetcher;
  useEffect(() => {
    if (!enabled) return undefined;
    const seq = ++seqRef.current;
    const t = setTimeout(() => {
      const land = rows => {
        if (seq < shownSeqRef.current) return;   // a newer answer is already on screen
        shownSeqRef.current = seq;
        setShown({ key, term, rows: Array.isArray(rows) ? rows : [] });
      };
      Promise.resolve().then(() => fetchRef.current(term)).then(land, () => land([]));
    }, term ? delay : 0);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
  if (!enabled) return [[], false];
  if (shown.key === key) return [shown.rows, false];
  const now = String(term || "").toLowerCase(), was = String(shown.term || "").toLowerCase();
  if (narrow && was && now.startsWith(was)) return [shown.rows.filter(r => narrow(r, now)), true];
  return [[], true];
}

// A person row still matches these words: every word is in the name or email.
export function personStillMatches(row, termLower) {
  const hay = `${row && row.name || ""} ${row && row.email || ""}`.toLowerCase();
  return termLower.split(/\s+/).filter(Boolean).every(w => hay.includes(w));
}
