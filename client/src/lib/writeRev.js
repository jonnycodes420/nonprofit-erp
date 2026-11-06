// WALKB-1 item 4 · A LIST RE-READS AFTER A WRITE THAT TOUCHES IT.
//
// COUNTS-1's way (client/src/lib/profileRefresh.js): api.js tells every write
// hook which write landed ({ path, method, phase }), and a screen re-reads only
// for the writes that touch what it shows. Muse's Walk B found the Volunteers
// header and Recent shifts unchanged after hours were logged, and a deleted
// group's card still on the Groups list, until a reload: each read once and
// heard only about the writes made from its own buttons.
//
// useWriteRev(test) is a number that moves after every landed write whose path
// passes `test` (a RegExp or a function), and whenever Atlas or Tell Steward
// says it changed something (VOICE-4's told(): Atlas logs hours and removes
// records through the server, so no path of the browser's own names them).
// Put it in a read's dependencies.
import { useEffect, useRef, useState } from "react";
import { onWrite } from "../api";
import { useStewardTold } from "./stewardTold";

export function writeTouches(test, w) {
  if (!w || w.phase !== "after") return false;
  const path = String(w.path || "");
  return typeof test === "function" ? !!test(path, w) : test instanceof RegExp ? test.test(path) : false;
}

export function useWriteRev(test) {
  const [rev, setRev] = useState(0);
  const ref = useRef(test);
  ref.current = test;
  useEffect(() => onWrite(w => { if (writeTouches(ref.current, w)) setRev(r => r + 1); }), []);
  useStewardTold(() => setRev(r => r + 1));
  return rev;
}

// The writes that change a volunteer's hours, shifts or roster place.
export const VOLUNTEER_WRITES = /volunteer|\/shifts?\b|\/kiosk|\/check-?in|\/removals\/(shift|volunteer)/i;
// The writes that change the Groups list: a group made, saved, removed or undone.
export const GROUP_WRITES = /^\/groups\b|^\/removals\/group\b|^\/removals\/undo\b|\/undo\b/;
