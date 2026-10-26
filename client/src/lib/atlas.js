// lib/atlas.js · AGENT-5. Atlas's name, and where each of its lines leads.
//
// The name is one value on the server (ATLAS_NAME), read once per page load
// from /atlas/status, so renaming Atlas is a variable change, never a build.
// "Atlas" shows until the answer arrives.
import { useEffect, useState } from "react";
import { apiFetch } from "../api";

let statusPromise = null;
let known = { name: "Atlas", ai: "on", rules: [], aiOffLine: null };
export function atlasStatus() {
  if (!statusPromise) statusPromise = apiFetch("/atlas/status").then(s => { known = { ...known, ...s }; return known; }).catch(() => known);
  return statusPromise;
}
export const atlasName = () => known.name;

// A line's link -> navigateTo(tab, opts). Every line opens where it happened.
export function linkTarget(link) {
  if (!link || !link.tab) return null;
  switch (link.tab) {
    case "donor": return ["donors", { selectDonorId: link.donorId }];
    case "events": return ["events", { eventId: link.eventId }];
    case "journeys": return ["journeys", { journeyId: link.journeyId }];
    case "groups": return ["groups", {}];
    case "tasks": return ["tasks", {}];
    case "communications": return ["communications", { subtab: "milestones", highlightDraftId: link.draftId }];
    case "data-health": return ["donors", { view: "health" }];
    default: return null;
  }
}

// The name, as a React value that updates when /atlas/status answers.
export function useAtlasName() {
  const [n, setN] = useState(known.name);
  useEffect(() => { let live = true; atlasStatus().then(s => { if (live) setN(s.name); }); return () => { live = false; }; }, []);
  return n;
}
