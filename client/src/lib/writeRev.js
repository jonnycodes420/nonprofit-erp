// WALKB-1 item 4 · A LIST RE-READS AFTER A WRITE THAT TOUCHES IT.
//
// Muse's Walk B found the Volunteers header and Recent shifts unchanged after
// hours were logged, and a deleted group's card still on the Groups list,
// until a reload: each read once and heard only about the writes made from its
// own buttons.
//
// STALE-1: heard through the one channel (lib/changes.js). useWriteRev(test)
// is a number that moves after every landed write whose path passes `test` (a
// RegExp or a function), and after a change with no path (Atlas, Tell Steward,
// the worker) of the kinds that test stands for. Put it in a read's
// dependencies.
import { useState } from "react";
import { useChanged, KINDS } from "./changes";

// The writes that change a volunteer's hours, shifts or roster place.
export const VOLUNTEER_WRITES = /volunteer|\/shifts?\b|\/kiosk|\/check-?in|\/removals\/(shift|volunteer)/i;
// The writes that change the Groups list: a group made, saved, removed or undone.
export const GROUP_WRITES = /^\/groups\b|^\/removals\/group\b|^\/removals\/undo\b|\/undo\b/;
const KINDS_OF = new Map([[VOLUNTEER_WRITES, ["volunteer"]], [GROUP_WRITES, ["group"]]]);

export function writeTouches(test, c) {
  if (!c) return false;
  if (!c.path) { const k = KINDS_OF.get(test); return !k || k.some(x => c.kinds && c.kinds.has(x)); }
  const path = String(c.path);
  return typeof test === "function" ? !!test(path, c) : test instanceof RegExp ? test.test(path) : false;
}

export function useWriteRev(test) {
  const [rev, setRev] = useState(0);
  useChanged(KINDS.concat("other"), c => { if (writeTouches(test, c)) setRev(r => r + 1); });
  return rev;
}
