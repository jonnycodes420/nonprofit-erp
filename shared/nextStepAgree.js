// shared/nextStepAgree.js · FIX-24 2c. THE NEXT STEP AND THE ASK AGREE.
//
// A next step is words somebody typed ("Send the proposal"), and The Ask is
// the proposals actually on file. They disagreed on Ada's record: the step
// said send the proposal while The Ask said no proposal was open. With no
// proposal open there is nothing to send, so a step that would send, share or
// follow up on one reads as the step that comes first: write it. A step that
// already says write, draft or start is left alone, and so is any step once a
// proposal is open. Read by the profile's rail, its Ask panel and the server's
// "Next:" line (routes/profileStatus.js), so all three say the same thing.
export const WRITE_THE_PROPOSAL = "Write the proposal, then send it";

export function stepAgainstProposals(label, openProposals) {
  const said = String(label || "").trim();
  if (Number(openProposals) > 0 || !/\bproposals?\b/i.test(said)) return { label: said, changed: false, said, why: null };
  if (/\b(write|draft|start|prepare|create|build|put together)\b/i.test(said)) return { label: said, changed: false, said, why: null };
  return { label: WRITE_THE_PROPOSAL, changed: true, said,
    why: `The step said "${said}", and no proposal is open for them yet. Start one on The Ask, then send it.` };
}
