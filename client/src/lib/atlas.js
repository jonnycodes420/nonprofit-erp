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
    case "groups": return ["groups", link.groupId ? { groupId: link.groupId } : {}];
    case "tasks": return ["tasks", {}];
    case "communications": return ["communications", { subtab: "milestones", highlightDraftId: link.draftId }];
    case "data-health": return ["donors", { view: "health" }];
    // TOP100-1: the list, and a person's plan of care with Atlas's proposal waiting on it.
    case "top100": return ["fundraising", { frSection: "top100" }];
    case "careplan": return ["donors", { selectDonorId: link.donorId }];
    default: return null;
  }
}

// Following a line (a press, never a render): a plan-of-care proposal waits on
// the person's plan of care for her to confirm (TOP100-1).
export function followLink(link) {
  if (link && link.tab === "careplan") {
    try { sessionStorage.setItem("steward.careProposal", JSON.stringify({ donorId: link.donorId, templateId: link.templateId })); } catch { /* the panel still opens */ }
  }
  return linkTarget(link);
}

// The name, as a React value that updates when /atlas/status answers.
export function useAtlasName() {
  const [n, setN] = useState(known.name);
  useEffect(() => { let live = true; atlasStatus().then(s => { if (live) setN(s.name); }); return () => { live = false; }; }, []);
  return n;
}
