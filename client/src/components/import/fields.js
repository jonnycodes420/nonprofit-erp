import { MEMBERSHIP_FIELDS, MEMBERSHIP_FIELD_LABELS } from "../../../../shared/membershipImport.js";
import { headerMatchesLabel, detectFlagColumns, containsTokenRun } from "../../../../shared/importShape";
import { NEGATOR_PHRASES } from "../donorShared";

// ── CSV Import helpers ─────────────────────────────────────────────────────
// ── Import field registry ──────────────────────────────────────────────────
export const CSV_FIELDS = [
  { key:"name",      labels:["name","full name","donor name","contact","display name"] },
  { key:"email",     labels:["email","email address","e-mail","e mail"] },
  { key:"phone",     labels:["phone","phone number","mobile","cell","telephone"] },
  { key:"total",     labels:["total","total giving","lifetime","lifetime giving","total donated","cumulative giving"] },
  { key:"lastAmount",labels:["last gift amount","last amount","last donation amount","recent gift","most recent gift"] },
  { key:"lastGift",  labels:["last gift date","last donation date","most recent date","last gift"] },
  { key:"gifts",     labels:["gifts","gift count","# gifts","number of gifts","donations","gift #","# donations"] },
  { key:"status",    labels:["status","donor status","type"] },
  // BUILD-84 P0-2 — an organization is a donor. Mapped on its own, never
  // folded into `name`: when a row carries both, the organization IS the
  // donor and the person in `name` becomes the contact on it.
  { key:"organization", labels:["organization","organisation","org","org name","organization name","organisation name","company","company name","business","business name","institution","employer name"] },
  { key:"city",      labels:["city","town"] },
  { key:"state",     labels:["state","province","region"] },
  // BUILD-84 P0-4 — the map geocodes from the stored address, so the CSV path
  // has to be able to carry one.
  { key:"address",   labels:["address","street","street address","address 1","address line 1","mailing address"] },
  { key:"zip",       labels:["zip","zip code","postal","postal code","postcode","zipcode"] },
  { key:"notes",     labels:["notes","note","comments","memo","background"] },
  // owner = the gift officer this donor is assigned to (Team import routing). The
  // raw cell value is matched to an org user (email→name) before submit; on Core
  // it's ignored server-side. Labels mirror importShape.js's OWNER_HDR_PAT.
  { key:"owner",     labels:["assigned officer","assigned to","owner","solicitor","gift officer","relationship manager","account manager","managed by","assigned fundraiser"] },
  // BUILD-58 Part 2 — safety flags, never silently discarded again. Values
  // parse through parseBoolFlag; deceased blocks ALL outbound mail,
  // doNotContact blocks marketing (donorMailDecision, server-side).
  // BUILD-94 Part 1 — a column holding an image URL. Equal Force, Bloomerang
  // and Little Green Light all export one, each under a different name. The
  // URL is FETCHED at import time under the BUILD-37 G5 rules (https only, no
  // private ranges, no metadata endpoints, 10s timeout) and a failure costs
  // that row its photo and nothing else.
  { key:"photo",     labels:["photo","photo url","photo_url","photourl","image","image url","image_url","picture","picture url","headshot","avatar","profile photo","profile image","constituent photo","photo link"] },
  { key:"deceased",     labels:["deceased","is deceased"] },
  { key:"doNotContact", labels:["do not contact","do not solicit","do not mail","do not email","dnc","dns","no contact"] },
  // BUILD-101 Part 6 — memberships. No label matching here: a bare "Level" or
  // "Expires" is claimed only when shared/membershipImport.js recognises the
  // whole file as a membership file (a level AND a membership date).
  ...MEMBERSHIP_FIELDS.map(key => ({ key, labels: [] })),
];
export const VALID_IMPORT_KEYS = new Set([...CSV_FIELDS.map(f => f.key), "_firstName", "_lastName"]);
// FIX (2026-09-09) — the CSV donor shape's standard vocabulary in the shape the
// ONE column-target dropdown takes. Labels are what a person reads, not the
// internal key: "lastAmount" was rendered raw in the old flat list.
export const CSV_FIELD_LABELS = {
  name: "Full name", email: "Email", phone: "Phone", total: "Lifetime giving",
  lastAmount: "Last gift amount", lastGift: "Last gift date", gifts: "Gift count",
  status: "Status", organization: "Organization", city: "City", state: "State",
  address: "Address", zip: "ZIP", notes: "Notes", owner: "Owner",
  deceased: "Deceased", doNotContact: "Do not contact", photo: "Photo",
  ...MEMBERSHIP_FIELD_LABELS,
};
// ── FIX-10 D · NO INTERNAL FIELD NAME REACHES A LABEL ───────────────────────
// The gift-field dropdown showed `paymentMethod`, `softCreditName` and
// `donorName` as its option labels, because the label was the ROLE KEY. Three
// of them were spelled out plainly somewhere and the rest were not, which is
// the shape of the bug: the fix is not three more entries, it is that no code
// path may fall back to a key.
//
// `plainFieldLabel` is that floor. Every label table below falls through to it,
// so a role added tomorrow reads "Pledge ID" and never `pledgeId`, and a
// camelCase word can no longer reach a screen through this file.
export function plainFieldLabel(key) {
  const k = String(key || "").replace(/^_/, "");
  if (!k) return "";
  const words = k
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")     // donorName  → donor Name
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")  // ZIPCode    → ZIP Code
    .replace(/[_-]+/g, " ")
    .trim().split(/\s+/);
  const KEEP = { id: "ID", ein: "EIN", zip: "ZIP", url: "URL", usd: "USD" };
  return words.map((w, i) => {
    const low = w.toLowerCase();
    if (KEEP[low]) return KEEP[low];
    return i === 0 ? low.charAt(0).toUpperCase() + low.slice(1) : low;
  }).join(" ");
}

// FIX-10 E — the three shapes, named the same way in the banner, in the
// override dropdown and in "You chose". Before this the dropdown said "One row
// per gift (build history)" and the banner said "individual gifts", so the
// sentence about her choice used none of the words she had picked.
export const SHAPE_CHOICE = {
  aggregate:   "one row per donor (totals)",
  transaction: "one row per gift",
  wide:        "year columns",
};

// The gift-row (transaction) targets, with the label each one shows. This is
// the ONE table for them: the picker list and the "what does this column
// become?" dropdown both read it, so the two cannot drift.
export const TX_ROLE_LABELS = {
  donorName: "Donor name", donorEmail: "Email", firstName: "First name", lastName: "Last name",
  orgName: "Organization name", donorType: "Donor type", donorId: "Donor ID",
  amount: "Gift amount", date: "Gift date", type: "Gift type", campaign: "Campaign / fund",
  fund: "Fund", paymentMethod: "Payment method", notes: "Notes",
  externalId: "Gift / transaction ID", stage: "Payment status",
  phone: "Phone", address: "Address", city: "City", state: "State", zip: "ZIP",
  owner: "Assigned officer (portfolio owner)",
  softCreditName: "Soft credit to", softCreditAmount: "Soft credit amount",
  tributeName: "In honor or memory of", tributeType: "Tribute type",
  tributeNotify: "Tribute: who to tell", matchEmployer: "Matching employer",
  wealthRating: "Wealth screen rating", wealthCapacity: "Wealth screen capacity",
  wealthDate: "Wealth screen date",
  wealthScore: "Wealth Score (1 to 5)",   // WEALTH-1
  birthday: "Birthday (month and day; year optional)",
  aboutThem: "About them (a short note read first)",   // DATES-1
  proposalPurpose: "Proposal: what the ask is for",
  proposalAmount: "Proposal: ask amount (NOT a gift)",
  proposalStage: "Proposal: stage",
  proposalCloseDate: "Proposal: expected close date",
  proposalProbability: "Proposal: probability",
};
export const txRoleLabel = role => TX_ROLE_LABELS[role] || plainFieldLabel(role);
// Either family, for the receipt, which lists donor columns and gift columns
// side by side and printed the raw key for both ("Payment Method → paymentMethod").
export const anyFieldLabel = key =>
  CSV_FIELD_LABELS[String(key || "").replace(/^_/, "")] || TX_ROLE_LABELS[key] || plainFieldLabel(key);

export const CSV_STANDARD_FIELDS = [
  { key: "_firstName", label: "First name" },
  { key: "_lastName", label: "Last name" },
  ...CSV_FIELDS.map(f => ({ key: f.key, label: CSV_FIELD_LABELS[f.key] || plainFieldLabel(f.key),
                            flag: f.key === "deceased" || f.key === "doNotContact" })),
  { key: "deceased", label: "Deceased" },
  { key: "doNotContact", label: "Do not contact" },
].filter((f, i, arr) => arr.findIndex(x => x.key === f.key) === i)
 .map(f => ({ ...f, flag: false }));

// FIX (2026-09-09) item 3 — WHOLE-HEADER MATCHING, never substring. The old
// rule was `h.includes(label)`, which is how a 30-column prospect-research
// export mapped `contact_confidence` to NAME (it contains "contact"),
// `capacity_estimate` to CITY (it contains "capacity"→"city") and `region_code`
// to STATE. This is the same defect BUILD-82 fixed for the workbook mapper
// ("Unnamed: 31" became the name column and threw away 23,867 donors); the CSV
// path still had it. A label now matches only as the WHOLE normalised header or
// a whole word-run inside it — "last gift date" still matches "Last Gift Date",
// "contact" no longer matches "contact_confidence".
// BUILD-84 census — the normaliser, the qualifier list and the whole-token
// matcher moved to shared/importShape.js (normalizeHeader / MEASUREMENT_QUALIFIERS
// / headerMatchesLabel) so the CSV mapper, the workbook mapper and the value
// scanner all read ONE definition of what a column header means. The copy that
// lived here is why P0-1 could ship: the mapper knew "min" was a measurement
// and the scanner did not.
export const _headerMatchesLabel = headerMatchesLabel;
export function guessField(header) {
  if (!header || !String(header).trim()) return "";
  const h = String(header).toLowerCase().trim();
  // BUILD-58 Part 2 — the flag columns come FIRST: "Do Not Contact" used to
  // hit the negator list below and be silently dropped from the mapping.
  const flags = detectFlagColumns([header]);
  if (flags.deceasedCol) return "deceased";
  if (flags.doNotContactCol) return "doNotContact";
  // Reject headers that signal a negation/flag ("do not email", "opt out of email", etc.)
  // BUILD-84 census — a negator phrase matches as a whole token run, not as
  // letters: `h.includes("no mail")` refused "Casino Mailing List", and
  // `h.includes("do not")` would refuse any header containing "…do notes".
  if (NEGATOR_PHRASES.some(n => containsTokenRun(header, n))) return "";
  // Separate first/last name columns → internal keys combined into name on build
  if (h === "first" || h === "first name" || h === "firstname" || h === "given name") return "_firstName";
  if (h === "last"  || h === "last name"  || h === "lastname"  || h === "surname" || h === "family name") return "_lastName";
  for (const f of CSV_FIELDS) {
    if (f.labels.some(l => _headerMatchesLabel(header, l))) return f.key;
  }
  return "";
}
