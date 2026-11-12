// lib/sequencesEmpty.js · ATLAS-4, SENDS-1. THE SEQUENCES PAGE SAYS "NONE" ONLY WHEN THERE ARE NONE.
// Feel 3 (Muse): "No sequences yet" sat above two Earlier sequences. ATLAS-4 made
// it "No active sequences.", which then sat above two Active ones (W-1107-
// Fundraising-21). The line over the builder's list now says what is true of
// the builder, and points at the Earlier list by its count. Pure.
// FLOWS-8 (W-1112-Fundraising-21): "None made here yet" still read as "none"
// above the one sequence the org has. The line is said only when there are
// none at all; with any sequence on the page, the page shows them and no line.
export function sequencesEmptyLine(builderList, earlierList) {
  const built = Array.isArray(builderList) ? builderList.length : 0;
  const earlier = Array.isArray(earlierList) ? earlierList.length : 0;
  return built || earlier ? null : "No sequences yet.";
}

// SENDS-1: one master. A sequence that is on reads Off while the org's email
// (or Journey and sequence steps) is off, because nothing of it goes out.
export function sequenceStatusWord({ active, tzPaused = false, mailOff = false, legacy = false, tzWord = "" }) {
  if (!active) return legacy ? "Paused" : "Off";
  if (mailOff) return "Off: email is off";
  if (tzPaused) return tzWord;
  return legacy ? "Active" : "On";
}

// From the Automatic email page payload: is anything of a sequence allowed out?
export function sequencesMailOff(page, types) {
  if (!page) return false;
  const t = (types || []).find(x => x.key === "journey_steps");
  return !page.mailOn || !(t && t.on);
}

export default { sequencesEmptyLine, sequenceStatusWord, sequencesMailOff };
