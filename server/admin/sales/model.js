// server/admin/sales/model.js · SALES-1. THE THREE OBJECTS AND THEIR FIELDS.
//
// Organizations (the prospect nonprofits), contacts (people) and deals (a sale),
// each a first-class record in its own sales_ table. OBJECTS names each one's
// table and its core fields; custom properties (sales_properties) sit beside
// them in the row's `props`. Pure: no database here, so the list, the import
// and the test all read one definition.
"use strict";

const PROP_TYPES = ["text", "long_text", "number", "currency", "date", "picklist", "multiselect", "checkbox", "url"];
const ROLES = ["ED", "Development Director", "Board", "Other"];
const ACTIVITY_KINDS = ["call", "meeting", "note", "task"];

// field: { key, label, type, col?, options? }. `col` is the column; computed fields have none.
const OBJECTS = {
  org: {
    table: "sales_orgs", label: "Organization", plural: "Organizations",
    fields: [
      { key: "name", label: "Name", type: "text", col: "name", required: true },
      { key: "domain", label: "Domain", type: "text", col: "domain" },
      { key: "website", label: "Website", type: "url", col: "website" },
      { key: "phone", label: "Phone", type: "text", col: "phone" },
      { key: "address", label: "Address", type: "text", col: "address" },
      { key: "city", label: "City", type: "text", col: "city" },
      { key: "state", label: "State", type: "text", col: "state" },
      { key: "revenue_band", label: "Annual revenue", type: "picklist", col: "revenue_band",
        options: ["Under $250K", "$250K–$1M", "$1M–$5M", "$5M–$20M", "Over $20M"] },
      { key: "current_crm", label: "Current CRM", type: "text", col: "current_crm" },
      { key: "nonprofit_type", label: "Type", type: "text", col: "nonprofit_type" },
      { key: "owner_id", label: "Owner", type: "owner", col: "owner_id" },
      { key: "created_at", label: "Created", type: "date", col: "created_at", readOnly: true },
      { key: "updated_at", label: "Updated", type: "date", col: "updated_at", readOnly: true },
    ],
    defaultColumns: ["name", "domain", "city", "state", "current_crm", "owner_id", "updated_at"],
  },
  contact: {
    table: "sales_contacts", label: "Contact", plural: "Contacts",
    fields: [
      { key: "first_name", label: "First name", type: "text", col: "first_name" },
      { key: "last_name", label: "Last name", type: "text", col: "last_name" },
      { key: "title", label: "Title", type: "text", col: "title" },
      { key: "emails", label: "Emails", type: "list", col: "emails" },
      { key: "phones", label: "Phones", type: "list", col: "phones" },
      { key: "role", label: "Role", type: "picklist", col: "role", options: ROLES },
      { key: "owner_id", label: "Owner", type: "owner", col: "owner_id" },
      { key: "created_at", label: "Created", type: "date", col: "created_at", readOnly: true },
      { key: "updated_at", label: "Updated", type: "date", col: "updated_at", readOnly: true },
    ],
    defaultColumns: ["name", "title", "emails", "role", "owner_id", "updated_at"],
  },
  deal: {
    table: "sales_deals", label: "Deal", plural: "Deals",
    fields: [
      { key: "name", label: "Name", type: "text", col: "name", required: true },
      { key: "pipeline_id", label: "Pipeline", type: "pipeline", col: "pipeline_id" },
      { key: "stage_id", label: "Stage", type: "stage", col: "stage_id" },
      { key: "value_cents", label: "Value (MRR)", type: "currency", col: "value_cents" },
      { key: "close_date", label: "Close date", type: "date", col: "close_date" },
      { key: "source", label: "Source", type: "text", col: "source" },
      { key: "owner_id", label: "Owner", type: "owner", col: "owner_id" },
      { key: "next_step", label: "Next step", type: "text", col: "next_step" },
      { key: "next_step_on", label: "Next step due", type: "date", col: "next_step_on" },
      { key: "trial_ends_on", label: "Trial or beta ends", type: "date", col: "trial_ends_on" },
      { key: "revisit_on", label: "Revisit on", type: "date", col: "revisit_on" },
      { key: "lost_reason", label: "Lost reason", type: "text", col: "lost_reason" },
      { key: "created_at", label: "Created", type: "date", col: "created_at", readOnly: true },
      { key: "updated_at", label: "Updated", type: "date", col: "updated_at", readOnly: true },
    ],
    defaultColumns: ["name", "stage_id", "value_cents", "close_date", "source", "owner_id", "next_step"],
  },
};
const OBJECT_IDS = Object.keys(OBJECTS);
// DATE columns are read as text ("2026-11-03"), never as a JS Date at the server's midnight.
const DATE_COLS = new Set(["close_date", "next_step_on", "trial_ends_on", "revisit_on"]);
const sel = col => (DATE_COLS.has(col) ? `${col}::text AS ${col}` : col);

// The defaults a fresh CRM starts with. Probabilities are a percent.
// Kinds: open, won, and two closed ones. Later is not lost: it needs a revisit
// day, comes back in Today on that day, and is never counted as a loss. Lost
// needs a reason. ONBOARD-2's gates show from Verbal yes on.
const DEFAULT_STAGES = [
  { name: "Lead", probability: 5, kind: "open" },
  { name: "Contacted", probability: 10, kind: "open" },
  { name: "Meeting booked", probability: 20, kind: "open" },
  { name: "Demo done", probability: 35, kind: "open" },
  { name: "Donors loaded", probability: 55, kind: "open" },   // the second meeting, with their own donor file in Steward
  { name: "Verbal yes", probability: 80, kind: "open", onboarding: true },
  { name: "Trial", probability: 90, kind: "open", onboarding: true },
  { name: "Paying", probability: 100, kind: "won", onboarding: true },
  { name: "Later", probability: 0, kind: "later" },
  { name: "Lost", probability: 0, kind: "lost" },
];
const STAGE_KINDS = ["open", "won", "later", "lost"];
const DEFAULT_GOAL = { cents: 1000000, by: "2027-06-30", says: "$10,000 MRR by Jun 30 2027" };
const DEFAULT_STAGE_LIMIT_DAYS = 21;

// The display name of a record of any object.
function nameOf(type, r) {
  if (!r) return "";
  if (type === "contact") return [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || (r.emails && r.emails[0]) || "(no name)";
  return r.name || "(no name)";
}

const clean = v => (v == null ? null : String(v).replace(/\s+/g, " ").trim() || null);
// A domain from a website, an email or a typed domain: "https://www.Harbor.org/x" → "harbor.org".
function domainOf(v) {
  const s = String(v || "").trim().toLowerCase();
  if (!s) return null;
  const at = s.lastIndexOf("@");
  const host = (at >= 0 ? s.slice(at + 1) : s).replace(/^[a-z]+:\/\//, "").split(/[/?#:]/)[0].replace(/^www\./, "");
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ? host : null;
}
const emailOf = v => { const s = String(v || "").trim().toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null; };
const listOf = v => (Array.isArray(v) ? v : String(v == null ? "" : v).split(/[;,\n]/)).map(x => String(x).trim()).filter(Boolean);

// A custom property's value, coerced to its type, or a reason it can't be.
function coerceProp(type, v, options = []) {
  if (v === "" || v == null) return { value: null };
  switch (type) {
    case "number": case "currency": {
      const n = Number(String(v).replace(/[$,\s]/g, ""));
      return Number.isFinite(n) ? { value: n } : { error: "a number" };
    }
    case "date": {
      const s = String(v).slice(0, 10);
      return /^\d{4}-\d{2}-\d{2}$/.test(s) ? { value: s } : { error: "a day, like 2026-11-03" };
    }
    case "checkbox": return { value: v === true || /^(true|yes|1|on|x)$/i.test(String(v)) };
    case "picklist": return !options.length || options.includes(String(v)) ? { value: String(v) } : { error: `one of ${options.join(", ")}` };
    case "multiselect": {
      const vals = listOf(v);
      const bad = options.length ? vals.filter(x => !options.includes(x)) : [];
      return bad.length ? { error: `from ${options.join(", ")}` } : { value: vals };
    }
    case "url": return { value: String(v).trim().slice(0, 500) };
    case "long_text": return { value: String(v).slice(0, 20000) };
    default: return { value: String(v).slice(0, 2000) };
  }
}

module.exports = { OBJECTS, OBJECT_IDS, DATE_COLS, sel, STAGE_KINDS, PROP_TYPES, ROLES, ACTIVITY_KINDS, DEFAULT_STAGES, DEFAULT_GOAL, DEFAULT_STAGE_LIMIT_DAYS,
  nameOf, clean, domainOf, emailOf, listOf, coerceProp };
