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
import { useEffect, useRef, useState } from "react";
import { onWrite } from "../api";
import { useStewardTold } from "./stewardTold";

const TOUCHES = /^\/(tasks|interactions|threads|attachments|volunteer|notes|conversations|events\/[^/]+\/(attendees|guests))/;
export function writeTouches(donorId, w) {
  if (!w || w.phase !== "after" || !w.path) return false;
  const path = String(w.path).split("?")[0];
  return (!!donorId && path.includes("/" + donorId)) || TOUCHES.test(path);
}

// fn({ fromWrite }) runs on Tell Steward (fromWrite false) and, shortly
// after, on any write that touches this record (fromWrite true).
export function useProfileRefresh(donorId, fn) {
  const ref = useRef(fn);
  ref.current = fn;
  useStewardTold(d => { if (ref.current) ref.current({ ...(d || {}), fromWrite: false }); });
  useEffect(() => {
    let t = null;
    const off = onWrite(w => {
      if (!writeTouches(donorId, w)) return;
      if (t) clearTimeout(t);
      t = setTimeout(() => { if (ref.current) ref.current({ fromWrite: true }); }, 120);
    });
    return () => { off(); if (t) clearTimeout(t); };
  }, [donorId]);
}

// The same signal as a number, for a hook's dependency list.
export function useWriteStamp(donorId) {
  const [n, setN] = useState(0);
  useProfileRefresh(donorId, () => setN(x => x + 1));
  return n;
}
