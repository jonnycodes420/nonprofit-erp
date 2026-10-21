// VOICE-4 · THE SCREEN KEEPS UP WITH TELL STEWARD.
//
// Everything Tell Steward does (a memo filed, a yes on a card, Do all of this,
// a plan that ran, an Undo) says so at once with told(), and every screen
// that shows what it may have changed re-reads with useStewardTold(fn): the
// profile (its figures, status, gifts, rail and meeting card), the Thread,
// Tasks and the Calendar. It used to be said only when the sheet closed, and
// only the profile's parent listened, so Last gift stayed $15,000 under a
// gift she had just recorded.
import { useEffect, useRef } from "react";

const TOLD = "steward:told";
export function told(detail) {
  try { window.dispatchEvent(new CustomEvent(TOLD, { detail: detail || {} })); } catch { /* no window */ }
}
export function useStewardTold(fn) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const on = e => { if (ref.current) ref.current((e && e.detail) || {}); };
    window.addEventListener(TOLD, on);
    return () => window.removeEventListener(TOLD, on);
  }, []);
}
