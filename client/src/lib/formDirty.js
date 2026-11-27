// SAFE-EDIT-1 · the profile forms' dirty hooks, kept out of lib/dirtyGuard.js so
// they load with the forms, not on Home's first look (perf-app).
import { useRef } from "react";
import { useDirtyGuard } from "./dirtyGuard";

// SAFE-EDIT-1: a form's edits against what it opened with: dirty once any
// field differs. Returns { dirty, release }.
export function useFormDirty(form) {
  const first = useRef(null);
  if (first.current === null) first.current = JSON.stringify(form);
  const dirty = JSON.stringify(form) !== first.current;
  const release = useDirtyGuard(dirty);
  return { dirty, release };
}

// SAFE-EDIT-1: a form that opens and closes in place (the profile's gift and
// pledge forms): dirty while open and changed from what it opened with. What
// the screen fills in as it opens (Record a gift's "Same as last", a date) is
// part of what it opened with: the first 400 ms after opening move the snapshot.
const SETTLE_MS = 400;
export function useOpenFormDirty(open, form) {
  const snap = useRef(null);
  const now = JSON.stringify(form);
  if (!open) snap.current = null;
  else if (snap.current === null || Date.now() - snap.current.at < SETTLE_MS) snap.current = { form: now, at: snap.current ? snap.current.at : Date.now() };
  return useDirtyGuard(!!open && !!snap.current && now !== snap.current.form);
}
