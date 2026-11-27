// BUILD-54 §6 — unsaved-state handling, one mechanism for every settings/
// editor surface. A form with unsaved edits registers itself via
// useDirtyGuard(dirty); navigation choke points (App tab switches, Settings
// section switches) call confirmIfDirty() before moving, and the browser's
// own beforeunload guard covers closing/refreshing the tab. Born of a real
// incident: an image was uploaded, Save was never clicked, and the product
// appeared broken.
//
// SAFE-EDIT-1 item 2 · LEAVING AN EDIT WITH CHANGES ASKS FIRST, IN STEWARD'S OWN DIALOG.
// Duet changed a profile's name and employer in Edit, pressed Back, and the
// changes were gone with no question: the profile's forms never registered
// here, and Back (a URL change inside the same tab) never asked. Now every
// edit form on the profile registers, every navigation asks through
// leaveIfClean (App's navigateTo, which Back and every rail link go through,
// and Settings' sections), and the question is the app's own confirm
// (ConfirmDialog.jsx), not the browser's window.confirm. confirmIfDirty keeps
// its old synchronous answer for a caller that cannot wait (none today).
import { useEffect, useRef } from "react";
// ConfirmDialog (and the shared Modal it pulls in) loads only when there is
// something unsaved to ask about, so Home's first look stays in its budget (perf-app).
const askLeave = () => import("../components/ConfirmDialog").then(m => m.askConfirm({ title: "Leave without saving?", body: "You have changes you haven't saved. If you leave now, they are gone.", yes: "Leave without saving", no: "Keep editing", danger: true }));

const holders = new Set();

export function markDirty(token, dirty) {
  if (dirty) holders.add(token); else holders.delete(token);
}
export const isDirty = () => holders.size > 0;

// Returns true when it's OK to navigate. Confirming clears the registry (the
// forms unmount with the navigation).
export function confirmIfDirty(message) {
  if (!holders.size) return true;
  const ok = window.confirm(message || "You have unsaved changes, leave without saving them?");
  if (ok) holders.clear();
  return ok;
}

// Runs go() now when nothing is unsaved (and answers true). Otherwise asks in
// Steward's dialog and answers false; go() runs on "Leave without saving",
// onStay() on "Keep editing". One question at a time: a second navigation
// while it is open waits on the same answer.
let asking = null;
export function leaveIfClean(go, onStay) {
  if (!holders.size) { go(); return true; }
  if (!asking) asking = askLeave().then(ok => { asking = null; if (ok === true) holders.clear(); return ok === true; });
  asking.then(ok => { if (ok) go(); else if (onStay) onStay(); });
  return false;
}

// Returns release(): a form that just saved calls it before it moves on, so
// its own save never asks "Leave without saving?".
export function useDirtyGuard(dirty) {
  const token = useRef({});
  const released = useRef(false);
  const live = !!dirty && !released.current;
  useEffect(() => {
    const t = token.current;
    markDirty(t, live);
    return () => markDirty(t, false);
  }, [live]);
  useEffect(() => {
    if (!live) return;
    const h = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [live]);
  return () => { released.current = true; markDirty(token.current, false); };
}
// The form hooks (useFormDirty, useOpenFormDirty) live in lib/formDirty.js, off Home's first look.
