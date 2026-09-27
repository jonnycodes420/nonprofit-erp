// The org's plan, as a screen sees it (FIX-3 finding 9).
//
// Three states, never two:
//   PLAN_UNKNOWN  the plan has not loaded yet, or its fetch failed. Nothing
//                 renders as locked: the surface shows its loading state.
//   "team"        the Team feature is included.
//   anything else a KNOWN plan without it ("core", "portal"): the only state
//                 that may draw a lock.
//
// The profile used to hold its tier in useState("core"), so "not loaded yet"
// and "not included" were one value, and the frosted "Unlock with Team"
// preview flashed on every open until the fetch answered. Every lock reads
// planLocks(); no plan state starts as "core" (tests/fix3-d-lock-flash).
export const PLAN_UNKNOWN = "unknown";

export function planKnown(tier) {
  return typeof tier === "string" && tier !== "" && tier !== PLAN_UNKNOWN;
}

export function planLocks(tier) {
  return planKnown(tier) && tier !== "team";
}
