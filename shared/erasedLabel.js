// shared/erasedLabel.js · POLISH-8 (W-1109-Fundraising-03).
// An erased person (personData.js erasePerson: GDPR-style erasure) keeps their
// gifts as anonymous money, and every list that still shows the row names it
// the one way: "Former donor (erased)", with the amount kept. The stored name
// stays "Erased person" (the audit log and the erasure itself read it); this is
// the label a card or row shows, computed on read, so rows erased before this
// build read right with no repair.
export const ERASED_LABEL = "Former donor (erased)";
export const STORED_ERASED_NAME = "Erased person";

export function shownName(name, erasedAt) {
  if (erasedAt || name === STORED_ERASED_NAME) return ERASED_LABEL;
  return name;
}
