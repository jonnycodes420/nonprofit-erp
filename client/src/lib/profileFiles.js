// lib/profileFiles.js · STALE-2 (W-1107-Donors-31). A PERSON'S FILES ARE ONE
// NUMBER: THE TAB, THE HEADING AND THE LIST.
//
// The Files tab's count was the timeline's (files attached to conversations
// and notes, and email attachments), its heading added the uploads but not
// the email attachments, and the uploads were read only once the tab was
// opened, so the tab said 0 over a page that listed two. Every one of the
// three reads this tally now: what was uploaded here (and check images), what
// is attached to a conversation or note, and each email that arrived with
// attachments (one line each on the timeline, as the timeline lists them).
export function profileFileTally({ materials = [], materialsKnown = true, attachments = [], rel = null } = {}) {
  const uploaded = Array.isArray(materials) ? materials.length : 0;
  const attached = Array.isArray(attachments) ? attachments.length : 0;
  const mail = ((rel && rel.emailThreads) || []).reduce((n, t) => n + ((t && t.mailFiles) || []).length, 0);
  return { uploaded, attached, mail, total: uploaded + attached + mail, known: !!materialsKnown };
}
