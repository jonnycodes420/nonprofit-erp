// shared/brandKit.js — COMMS-2. The org's brand kit and its template library.
//
// The palette, the template kinds with Steward's starting wording, and the
// merge fields are defined ONCE here: the Settings brand kit, the template
// editor's picker and preview, and the server's renderer all read this file.
//
// STEWARD'S STARTING WORDING IS A STARTING POINT. A template shows "Not yet
// reviewed" until a person at the org has saved it, because a letter that goes
// out in an organisation's name should be in its own words.

// Two colours, from a palette that is already legible on cream and white (the
// same accents Settings offers for the app). No free hex: a brand colour a
// reader cannot read on a printed letter is not a brand colour.
export const PALETTE = Object.freeze([
  { hex: "#0d5c3a", name: "Emerald" },
  { hex: "#0f1a12", name: "Ink" },
  { hex: "#c9a84c", name: "Brass" },
  { hex: "#7c3a12", name: "Rust" },
  { hex: "#3f5c8a", name: "Slate" },
  { hex: "#6b3f8a", name: "Plum" },
  { hex: "#8a5a1f", name: "Ochre" },
]);
export const PALETTE_HEX = PALETTE.map(p => p.hex);
export const isPaletteColour = c => PALETTE_HEX.includes(String(c || "").toLowerCase());

export const DEFAULT_TAX_LANGUAGE = (legalName) =>
  `${legalName || "This organisation"} is a tax-exempt organisation. No goods or services were provided in exchange for your gift unless this receipt says so. Please keep this for your tax records.`;

// ── MERGE FIELDS ────────────────────────────────────────────────────────────
// Each is filled from the donor's own record. A template that uses a field this
// donor has no value for renders with that field listed as missing, so the
// preview shows the gap instead of printing an empty space.
export const MERGE_FIELDS = Object.freeze([
  { key: "first_name",      label: "First name",                  sample: "Margaret" },
  { key: "full_name",       label: "Full name",                   sample: "Margaret Chen" },
  { key: "gift_amount",     label: "Their latest gift",           sample: "$250" },
  { key: "gift_date",       label: "Date of that gift",           sample: "September 14, 2026" },
  { key: "fund",            label: "Fund of that gift",           sample: "Youth Arts Access" },
  { key: "tribute",         label: "In memory or honour of",      sample: "in memory of Walter Chen" },
  { key: "year",            label: "This year",                   sample: "2026" },
  { key: "year_total",      label: "Given this year",             sample: "$1,250" },
  { key: "lifetime_total",  label: "Given in all",                sample: "$4,800" },
  { key: "monthly_amount",  label: "Their monthly gift",          sample: "$25" },
  { key: "event_name",      label: "Last event they came to",     sample: "Harbor Lights Gala" },
  { key: "volunteer_hours", label: "Volunteer hours this year",   sample: "36" },
  { key: "org_name",        label: "Organisation name",           sample: "Harborlight Youth Collective" },
  { key: "signature",       label: "Signature block",             sample: "Dana Reyes\nExecutive Director" },
  { key: "org_address",     label: "Organisation address",        sample: "12 Wharf Street, Salem, MA 01970" },
  { key: "tax_language",    label: "Tax language",                sample: "Harborlight Youth Collective is a tax-exempt organisation." },
]);
export const MERGE_KEYS = MERGE_FIELDS.map(f => f.key);

// ── THE LIBRARY ─────────────────────────────────────────────────────────────
// `channel` says how it goes out: an email becomes a draft a person sends; a
// letter prints. Plain and warm, short, and no em dashes.
export const TEMPLATE_KINDS = Object.freeze([
  { kind: "thanks_first", label: "Thank you: first gift", channel: "letter",
    subject: "Thank you, {{first_name}}",
    body: "Dear {{first_name}},\n\nThank you for your first gift to {{org_name}}, {{gift_amount}} on {{gift_date}}. It goes straight into the work, and we are glad you are part of it.\n\nWe will write now and then to tell you what your gift made possible.\n\nWith thanks,\n{{signature}}" },
  { kind: "thanks_renewal", label: "Thank you: renewal", channel: "letter",
    subject: "Thank you again, {{first_name}}",
    body: "Dear {{first_name}},\n\nThank you for giving again. Your gift of {{gift_amount}} means you have now given {{lifetime_total}} to {{org_name}}, and every year of it has counted.\n\nWith thanks,\n{{signature}}" },
  { kind: "thanks_monthly", label: "Thank you: monthly gift", channel: "email",
    subject: "Thank you for giving every month",
    body: "Dear {{first_name}},\n\nThank you for your monthly gift of {{monthly_amount}}. Gifts that arrive every month are the ones we can plan around, and yours does exactly that.\n\nWith thanks,\n{{signature}}" },
  { kind: "thanks_major", label: "Thank you: major gift", channel: "letter",
    subject: "Thank you, {{first_name}}",
    body: "Dear {{first_name}},\n\nThank you for your gift of {{gift_amount}}. A gift of this size changes what we can do this year, and I wanted to thank you myself.\n\nI would like to show you what it makes possible. I will be in touch to find a time.\n\nWith gratitude,\n{{signature}}" },
  { kind: "thanks_memorial", label: "Thank you: memorial gift", channel: "letter",
    subject: "Thank you for your gift",
    body: "Dear {{first_name}},\n\nThank you for your gift of {{gift_amount}}, {{tribute}}. It is a generous way to remember someone, and we are honoured you chose {{org_name}}.\n\nWith sympathy and thanks,\n{{signature}}" },
  { kind: "receipt", label: "Receipt", channel: "email",
    subject: "Your receipt from {{org_name}}",
    body: "Dear {{first_name}},\n\nThank you for your gift of {{gift_amount}} on {{gift_date}}. Your receipt is attached.\n\n{{tax_language}}\n\n{{signature}}\n{{org_address}}" },
  { kind: "year_end", label: "Year-end statement", channel: "email",
    subject: "Your {{year}} giving statement",
    body: "Dear {{first_name}},\n\nThank you for everything you gave to {{org_name}} in {{year}}. Your statement for the year is attached: {{year_total}} in all.\n\n{{tax_language}}\n\nWith thanks,\n{{signature}}" },
  { kind: "lapsed", label: "Lapsed donor note", channel: "letter",
    subject: "We have missed you, {{first_name}}",
    body: "Dear {{first_name}},\n\nIt has been a while since we heard from you, and I wanted to say hello. You have given {{lifetime_total}} to {{org_name}} over the years, and it mattered.\n\nIf you would like to hear what we are doing now, I would be glad to tell you.\n\nWarmly,\n{{signature}}" },
  { kind: "event_followup", label: "Event follow-up", channel: "email",
    subject: "Thank you for coming",
    body: "Dear {{first_name}},\n\nThank you for coming to {{event_name}}. It was good to see you there.\n\nWith thanks,\n{{signature}}" },
  { kind: "volunteer_thanks", label: "Volunteer thank-you", channel: "email",
    subject: "Thank you for your time",
    body: "Dear {{first_name}},\n\nThank you for the {{volunteer_hours}} hours you have given {{org_name}} this year. Time is the hardest thing to give, and you gave it.\n\nWith thanks,\n{{signature}}" },
]);
export const KIND_KEYS = TEMPLATE_KINDS.map(t => t.kind);
export const kindDef = k => TEMPLATE_KINDS.find(t => t.kind === k) || null;

// Fill {{field}} tokens. Unknown tokens are left as typed and reported; a
// known field with no value for this person is reported as missing.
export function renderTemplate(text, values) {
  const missing = new Set(), unknown = new Set();
  const out = String(text || "").replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k) => {
    const key = k.toLowerCase();
    if (!MERGE_KEYS.includes(key)) { unknown.add(key); return m; }
    const v = values ? values[key] : null;
    if (v === null || v === undefined || v === "") { missing.add(key); return `[${key.replace(/_/g, " ")}]`; }
    return String(v);
  });
  return { text: out, missing: [...missing], unknown: [...unknown] };
}

// The unknown tokens in a template, for refusing a save that would print one.
export function unknownFields(text) {
  return renderTemplate(text, Object.fromEntries(MERGE_KEYS.map(k => [k, "x"]))).unknown;
}
