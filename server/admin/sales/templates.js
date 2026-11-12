// server/admin/sales/templates.js · SALES-2 item 5. EMAIL TEMPLATES, SENT BY JONATHAN.
//
// Templates live in Sales settings (sales_settings "templates"). From a contact, a deal or
// call mode, "Email" fills one for a person and offers Copy and Open in Mail (a mailto: link
// with the subject and body). STEWARD NEVER SENDS IT. Copying or opening it logs an
// "Email drafted" activity; when Jonathan's mailbox captures the sent message (SALES-1 Part
// B), it lands on the timeline as usual.
//
// Merge fields: {{first_name}} {{last_name}} {{org}} {{city}} {{current_crm}} {{my_name}}.
// A field the record doesn't have is left out and named in `missing`, so nothing reads
// "Hi {{first_name}}" in a sent mail.
"use strict";
const { newId } = require("../../shared/newId");
const M = require("./model");
const ACT = require("./activities");
const LINKS = require("./links");

const FIELDS = ["first_name", "last_name", "org", "city", "current_crm", "my_name"];
const DEFAULT_TEMPLATES = [
  { id: "stp_intro", name: "After a call", subject: "Steward for {{org}}",
    body: "Hi {{first_name}},\n\nThanks for the few minutes today. Steward is a donor CRM built for organizations the size of {{org}}: it notices which donors are slipping and drafts the next thank-you, and you send it.\n\nWould 30 minutes next week work to show you with your own donor list?\n\n{{my_name}}" },
  { id: "stp_vm", name: "After a voicemail", subject: "Following up on my call",
    body: "Hi {{first_name}},\n\nI left you a voicemail today. I help small nonprofits in {{city}} keep their donors giving, and I'd like to show you how Steward could work alongside {{current_crm}}.\n\nIs there a good time for a short call?\n\n{{my_name}}" },
];

function cleanTemplates(stored) {
  const list = Array.isArray(stored) ? stored : DEFAULT_TEMPLATES;
  return list.filter(t => t && M.clean(t.name)).slice(0, 50).map(t => ({ id: String(t.id || newId("stp")).slice(0, 40), name: M.clean(t.name).slice(0, 120),
    subject: String(t.subject || "").slice(0, 300), body: String(t.body || "").slice(0, 20000) }));
}
async function all(query) {
  const [r] = await query(`SELECT value FROM sales_settings WHERE key = 'templates'`);
  return cleanTemplates(r ? r.value : null);
}

// Pure: the template with its fields filled from `v`.
function fill(tpl, v) {
  const missing = new Set();
  const one = s => String(s || "").replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k) => {
    const x = v[k];
    if (x == null || String(x).trim() === "") { missing.add(k); return ""; }
    return String(x);
  });
  return { subject: one(tpl.subject).replace(/\s+/g, " ").trim(), body: one(tpl.body), missing: [...missing] };
}
const mailto = (to, subject, body) => `mailto:${encodeURIComponent(to || "").replace(/%40/g, "@")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

// The values for a contact (and its organization), a deal (its first contact) or an org.
async function valuesFor(query, { contactId, dealId, orgId }, me) {
  let contact = null, org = null;
  if (dealId && !contactId) {
    const l = await LINKS.linkedOf(query, "deal", String(dealId));
    contactId = l.contact[0] ? l.contact[0].id : null;
    orgId = orgId || (l.org.find(o => o.primary) || l.org[0] || {}).id;
  }
  if (contactId) {
    [contact] = await query(`SELECT id, first_name, last_name, emails, dnc_at FROM sales_contacts WHERE id = ? AND deleted_at IS NULL`, [String(contactId)]);
    if (!contact) return { error: "not_found", message: "That contact doesn't exist." };
    if (!orgId) { const l = await LINKS.linkedOf(query, "contact", contact.id); orgId = (l.org.find(o => o.primary) || l.org[0] || {}).id; }
  }
  if (orgId) [org] = await query(`SELECT id, name, city, current_crm, dnc_at FROM sales_orgs WHERE id = ? AND deleted_at IS NULL`, [String(orgId)]);
  return { contact, org, values: { first_name: contact && contact.first_name, last_name: contact && contact.last_name, org: org && org.name,
    city: org && org.city, current_crm: org && org.current_crm, my_name: me } };
}

module.exports = { FIELDS, DEFAULT_TEMPLATES, cleanTemplates, all, fill, mailto, valuesFor, logDrafted };

// Copy or Open in Mail: one "Email drafted" activity on the person, the org and the deal.
async function logDrafted(ctx, { subject, contactId, orgId, dealId, template }, who) {
  const records = [contactId && { type: "contact", id: String(contactId) }, orgId && { type: "org", id: String(orgId) }, dealId && { type: "deal", id: String(dealId) }].filter(Boolean);
  const recs = await ACT.create(ctx, { kind: "note", body: `Email drafted: ${String(subject || "(no subject)").slice(0, 300)}${template ? ` (template: ${template})` : ""}`, records }, who);
  if (recs.error) return recs;
  await ctx.run(`UPDATE sales_activities SET kind = 'email' WHERE id = ?`, [recs.id]);
  return { ok: true, id: recs.id };
}
