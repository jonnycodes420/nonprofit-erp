// COUNTS-1 · A PROFILE RE-READS AFTER ANY CHANGE TO IT.
//
// The profile's tab counts (Giving, Conversations, Tasks, Notes, Files) and
// lists are one list built from a few reads (PROFILE-1), but those reads ran
// once, when the record opened, and after the few forms that remembered to ask
// again. A task added from the rail showed in Tasks and the rail while the
// profile's Tasks tab still said 8; a note saved elsewhere showed on one tab
// and not the next.
//
// Now every write the app makes (api.js onWrite, after it lands) that touches
// this person, or a task, note, conversation, next step, file or volunteer
// shift, re-reads them, and so does Tell Steward (VOICE-4's told()).
//
// STALE-1: the same behaviour, heard through the one channel (lib/changes.js):
// a change that names this person, or any task, note, conversation, file,
// volunteer shift or event guest row. `money` is true when it moved a gift or
// a pledge of theirs (the header's figures re-read too).
import { useState } from "react";
import { useStewardTold } from "./stewardTold";
import { useChanged } from "./changes";

export const PROFILE_KINDS = ["person", "task", "note", "volunteer", "event"];

// fn({ fromWrite, money }) runs on Tell Steward (fromWrite false) and, shortly
// after, on any other change that reaches this record (fromWrite true).
export function useProfileRefresh(donorId, fn) {
  useStewardTold(d => { if (fn) fn({ ...(d || {}), fromWrite: false }); });
  useChanged(PROFILE_KINDS, c => {
    if (c.source === "told" || !fn) return;   // told() is heard above, at once
    const mine = c.kinds.has("person") && (!c.ids.person || c.ids.person.has(String(donorId)));
    fn({ fromWrite: true, money: mine && (c.kinds.has("gift") || c.kinds.has("pledge")) });
  }, donorId ? { person: donorId } : null);
}

// The same signal as a number, for a hook's dependency list.
export function useWriteStamp(donorId) {
  const [n, setN] = useState(0);
  useProfileRefresh(donorId, () => setN(x => x + 1));
  return n;
}
