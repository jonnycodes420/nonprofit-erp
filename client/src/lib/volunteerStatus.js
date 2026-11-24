// client/src/lib/volunteerStatus.js · RULES-1 item 7. ENDING A VOLUNTEER ROLE, WHERE SHE LOOKS FOR IT.
//
// Jarvis looked for "end this role" on the profile's role line, next to "+", and in More; it was
// only inside the Volunteer record. The writer is VOL-3's (POST /donors/:id/volunteer-status,
// server/volunteers/volunteerRecord.js): marking somebody former keeps the role, their hours and
// their history, and Undo (…/volunteer-status/undo) puts back the status before it.
//
// The role line (rail) and the More menu (header) are two components, so the status lives here,
// per person, and both read it. `from` says which one asked, so the sentence and its Undo show
// beside the control that was clicked, once.
import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { errorMessage } from "./domainError";

const state = new Map();   // personId → { status, statusWord, sentence, undo, from, busy, error }
const subs = new Map();    // personId → Set<fn>

function put(id, patch) {
  const next = { ...(state.get(id) || {}), ...patch };
  state.set(id, next);
  for (const f of subs.get(id) || []) f(next);
}

export function useVolunteerStatus(id) {
  const [s, setS] = useState(() => state.get(id) || {});
  useEffect(() => {
    setS(state.get(id) || {});
    if (!subs.has(id)) subs.set(id, new Set());
    subs.get(id).add(setS);
    return () => { subs.get(id).delete(setS); };
  }, [id]);
  return s;
}

// What GET /people/:id said (volunteer_status), without clearing a sentence on screen.
export function seedVolunteerStatus(id, rec) {
  if (rec && rec.status) put(id, { status: rec.status, statusWord: rec.statusWord });
}

export async function markFormer(id, from) {
  put(id, { busy: true, error: "", sentence: "", undo: false, from });
  try {
    const r = await apiFetch(`/donors/${id}/volunteer-status`, { method: "POST", body: JSON.stringify({ status: "former" }) });
    put(id, { busy: false, status: r.record.status, statusWord: r.record.statusWord, sentence: r.sentence, undo: !!r.undo, from });
    return r;
  } catch (e) { put(id, { busy: false, error: errorMessage(e, "Could not mark them as a former volunteer."), from }); return null; }
}

export async function undoFormer(id) {
  put(id, { busy: true, error: "" });
  try {
    const r = await apiFetch(`/donors/${id}/volunteer-status/undo`, { method: "POST", body: "{}" });
    put(id, { busy: false, status: r.record.status, statusWord: r.record.statusWord, sentence: r.sentence, undo: false });
    return r;
  } catch (e) { put(id, { busy: false, error: errorMessage(e, "Could not undo that.") }); return null; }
}
