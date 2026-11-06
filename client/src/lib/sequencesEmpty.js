// lib/sequencesEmpty.js · ATLAS-4. THE SEQUENCES PAGE SAYS "NONE" ONLY WHEN THERE ARE NONE.
// Feel 3 (Muse): "No sequences yet" sat above two Earlier sequences. The
// builder's list and the Earlier list are read separately; the line over the
// builder's list now reads both. Pure.
export function sequencesEmptyLine(builderList, earlierList) {
  const built = Array.isArray(builderList) ? builderList.length : 0;
  const earlier = Array.isArray(earlierList) ? earlierList.length : 0;
  if (built) return null;
  return earlier ? "No active sequences." : "No sequences yet.";
}
export default { sequencesEmptyLine };
