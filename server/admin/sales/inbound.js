// server/admin/sales/inbound.js · SALES-2 items 7, 8 and 10. INBOUND LANDS IN THE SALES CRM.
//
// note(ctx, { source, name, email, phone, orgName, orgDomain, note, partner?, referredByOrgId? })
// matches or creates the contact (by email) and the organization (by the email's domain unless
// it is a free mailbox, else by name), opens a deal in Lead with the source, and adds a task due
// today: "New inbound: call within the hour." A partner's referral attaches the partner and their
// default term (their first) to the deal; a customer's referral names the customer.
//
// The public forms call it AFTER they have answered, never awaiting it, so their response is
// byte-for-byte what it was (tests/sales2-inbound.test.js), and a failure here only logs.
// Nothing is emailed to anyone.
"use strict";
const M = require("./model");
const REC = require("./records");
const LINKS = require("./links");
const ACT = require("./activities");
const { civil } = require("./today");

const TZ = "America/New_York";
// THE PLANTED DEFECT (SALES2_PLANT=demoresp on the server, tests only): the demo request's answer changes.
const PLANT = process.env.TEST_MODE === "1" ? process.env.SALES2_PLANT || "" : "";
const SOURCES = { demo: "Website demo request", signup: "Signup", lostfound: "Lost & Found", partner: "Partner referral", customer: "Customer referral" };
const SYSTEM = { id: "system:sales-inbound", name: "Steward (inbound form)" };
const FREE = new Set(["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com", "icloud.com", "me.com", "msn.com", "live.com", "comcast.net", "att.net", "protonmail.com", "proton.me", "ymail.com", "mail.com", "gmx.com"]);
const split = full => { const p = String(full || "").trim().replace(/\s+/g, " ").split(" ").filter(Boolean); return p.length > 1 ? { first_name: p.slice(0, -1).join(" "), last_name: p.at(-1) } : { first_name: p[0] || null }; };

async function note(ctx, b, who = SYSTEM, now = Date.now()) {
  const source = SOURCES[b.source] || String(b.source || "Inbound");
  const email = M.emailOf(b.email);
  const name = M.clean(b.name);
  if (!email && !name) return { error: "invalid", message: "An inbound needs a name or an email." };
  const domain = email && !FREE.has(email.split("@")[1]) ? M.domainOf(email) : (M.domainOf(b.orgDomain) || null);
  const orgName = M.clean(b.orgName) || (domain ? domain : null);

  // The organization: its domain, else its name.
  let org = null;
  if (domain) [org] = await ctx.query(`SELECT id, name FROM sales_orgs WHERE deleted_at IS NULL AND domain = ? ORDER BY created_at LIMIT 1`, [domain]);
  if (!org && orgName) [org] = await ctx.query(`SELECT id, name FROM sales_orgs WHERE deleted_at IS NULL AND lower(name) = lower(?) ORDER BY created_at LIMIT 1`, [orgName]);
  if (!org && orgName) {
    const r = await REC.create(ctx, "org", { name: orgName, domain: domain || undefined, phone: b.orgPhone || undefined }, who, { force: true });
    if (r.error) return r;
    org = { id: r.id, name: orgName, created: true };
  }
  // The person: their email, else their name at that organization.
  let contact = null;
  if (email) [contact] = await REC.findDuplicates(ctx.query, "contact", { emails: [email] });
  if (!contact && name && org) contact = await require("./importCsv").contactByNameAt(ctx.query, split(name), org.id);
  if (!contact) {
    const r = await REC.create(ctx, "contact", { ...split(name), emails: email ? [email] : [], phones: b.phone ? [String(b.phone).slice(0, 40)] : [] }, who, { force: true });
    if (r.error) return r;
    contact = { id: r.id, created: true };
  }
  if (org) await LINKS.associate(ctx, "contact", contact.id, "org", org.id, {}, who);

  // The deal, in the pipeline's first stage (Lead).
  const dealName = `${org ? org.name : name || email} · ${source}`;
  const d = await REC.create(ctx, "deal", { name: dealName, source }, who, { force: true });
  if (d.error) return d;
  if (org) await LINKS.associate(ctx, "deal", d.id, "org", org.id, { primary: true }, who);
  await LINKS.associate(ctx, "deal", d.id, "contact", contact.id, {}, who);
  if (b.referralLinkId || b.referredByOrgId) await ctx.run(`UPDATE sales_deals SET referral_link_id = ?, referred_by_sales_org_id = ? WHERE id = ?`, [b.referralLinkId || null, b.referredByOrgId || null, d.id]);
  if (b.partnerId) {
    const [term] = await ctx.query(`SELECT id FROM sales_partner_terms WHERE partner_id = ? AND deleted_at IS NULL ORDER BY created_at LIMIT 1`, [b.partnerId]);
    if (term) await require("./partners").attach(ctx, d.id, { term_id: term.id }, who);
  }
  const recs = [{ type: "deal", id: d.id }, { type: "contact", id: contact.id }, ...(org ? [{ type: "org", id: org.id }] : [])];
  const said = String(b.note || "").trim().slice(0, 4000);
  if (said) await ACT.create(ctx, { kind: "note", body: `${source}: ${said}`, records: recs }, who);
  const t = await ACT.create(ctx, { kind: "task", body: `New inbound: call within the hour. ${name || email}${org ? `, ${org.name}` : ""} (${source})`, due_on: civil(now, TZ), records: recs }, who);
  return { ok: true, dealId: d.id, contactId: contact.id, orgId: org ? org.id : null, taskId: t.id };
}

// For a public form: after the answer is sent, never awaited by it.
function after(query, run, fields) {
  setImmediate(() => {
    require("../../db/query").withAmbientTransaction(() => note({ query, run }, fields))
      .then(r => { if (r && r.error) console.warn(`[sales-inbound] ${fields.source}: ${r.message || r.error}`); },
        e => console.error(`[sales-inbound] ${fields.source} failed:`, e.message));
  });
}

module.exports = { SOURCES, note, after, FREE, PLANT };
