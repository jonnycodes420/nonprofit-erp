// lib/relationshipOptions.js · FLOWS-10 item 7 (W-1113-Donors-49X). THE RELATIONSHIP BOX SHOWS
// THE TYPE THAT IS STORED.
//
// Granville Thistlewood's link to Tidewater Community Foundation is stored as program_officer
// (a grant contact, made from Grants), but the Household and related dialog's box offered only the
// household and work types, so the browser showed its first option, "Spouse". The box now offers
// every type the profile can show, the stored one always among them, so it reads what is stored
// and opening it changes nothing. A type made elsewhere (Grants) is shown, named, and kept.
export const OTHER_TYPE_LABELS = {
  program_officer: "Program officer",
  funder_contact: "Funder contact",
  introduced_by: "Introduced by",
  guest_of: "Guest of",
};

// labels: [[type, label]] as this record reads them (profileShared relationshipLabelsFor).
export function relationshipOptions(labels, storedType) {
  const list = (labels || []).slice();
  const t = String(storedType || "");
  if (t && !list.some(([v]) => v === t)) list.push([t, OTHER_TYPE_LABELS[t] || t.replace(/_/g, " ")]);
  return list;
}

export function relationshipTypeLabel(labels, type) {
  const hit = (labels || []).find(([v]) => v === type);
  return hit ? hit[1] : OTHER_TYPE_LABELS[type] || String(type || "").replace(/_/g, " ");
}
