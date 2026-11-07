// lib/sequencesEmpty.js · ATLAS-4, SENDS-1. THE SEQUENCES PAGE SAYS "NONE" ONLY WHEN THERE ARE NONE.
// Feel 3 (Muse): "No sequences yet" sat above two Earlier sequences. ATLAS-4 made
// it "No active sequences.", which then sat above two Active ones (W-1107-
// Fundraising-21). The line over the builder's list now says what is true of
// the builder, and points at the Earlier list by its count. Pure.
export function sequencesEmptyLine(builderList, earlierList) {
  const built = Array.isArray(builderList) ? builderList.length : 0;
  const earlier = Array.isArray(earlierList) ? earlierList.length : 0;
  if (built) return null;
  if (!earlier) return "No sequences yet.";
  return `None made here yet. Your ${earlier === 1 ? "earlier sequence is" : `${earlier} earlier sequences are`} below.`;
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
