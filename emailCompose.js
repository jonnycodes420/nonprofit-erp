// emailCompose.js · EMAIL-1. ONE EMAIL, RENDERED FOR ONE PERSON.
//
// shared/emailBlocks.js is pure: it turns blocks, a brand, fields and links
// into HTML and text. This module is the seam that READS those inputs for a
// real organisation and a real person, so the campaign send, "Send me a test",
// a journey step's draft and the review queue's "Start from a template" all
// fill a template the same way:
//
//   brand   the org's one brand, read at render time by buildEmailContext
//           (routes/emailTemplates.js), never stored on the template
//   fields  first_name, last_name, last_gift_amount, last_gift_date,
//           campaign, give_link, org_name
//   links   the public video page, the org's events and giving pages
//
// THE GIVE LINK carries the person's name and email in the URL FRAGMENT, never
// the query string (docs/decisions/portal-and-donor-network.md): a fragment is
// not sent to a server, not written to an access log and not passed on in a
// Referer. Donate.jsx reads it, fills the empty fields and clears it.
//
// Nothing here sends. The send path takes the html, puts the footer where the
// renderer left FOOTER_SLOT, and goes through the wrapped resend client and
// donorMailDecision exactly as before.
"use strict";

const { query } = require("./db");
const { publicAppUrl } = require("./publicUrl");

// Server functions this module needs but cannot require (they live in
// server.js). server.js calls configure() once at boot.
const deps = { displayNameCase: null };
function configure(d) { Object.assign(deps, d || {}); }

let _blocks = null;
async function blocksMod() {
  if (!_blocks) _blocks = await import("./shared/emailBlocks.js");
  return _blocks;
}

const toArray = v => {
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v.trim()) { try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch { return []; } }
  return [];
};

// A campaign is a template campaign when it carries blocks.
function hasBlocks(campaign) { return toArray(campaign && campaign.email_blocks).length > 0; }

// ── THE ORG HALF, read once per send ───────────────────────────────────────
// The brand and links come from routes/emailTemplates.js buildEmailContext,
// the same context the template editor's preview and test use, so what a
// person previews is what each donor gets.
async function orgRenderContext(orgId) {
  const ectx = await require("./routes/emailTemplates").buildEmailContext(orgId);
  const base = publicAppUrl();
  const m = /\/give\/([^/?#]+)$/.exec(ectx.giveLink || "");
  return {
    orgId, orgSlug: m ? decodeURIComponent(m[1]) : "", orgName: ectx.orgName,
    brand: ectx.brand, links: ectx.links, base, giveBase: ectx.giveLink || "",
  };
}

// ── THE PERSON HALF ────────────────────────────────────────────────────────
function giveLink(ctx, person) {
  const url = ctx.giveBase || `${ctx.base}/give/${encodeURIComponent(ctx.orgSlug)}`;
  if (!person) return url;
  const frag = new URLSearchParams();
  if (person.email) frag.set("email", String(person.email).trim());
  if (person.firstName) frag.set("first_name", person.firstName);
  if (person.lastName) frag.set("last_name", person.lastName);
  const s = frag.toString();
  return s ? `${url}#${s}` : url;
}

function formatMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "";
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
}
function formatDate(d) {
  if (!d) return "";
  const iso = d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
  const dt = new Date(iso + "T12:00:00Z");
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function splitName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || "", lastName: parts.slice(1).join(" ") };
}

// Fields for a donor row. `campaignName` fills {{campaign}}.
async function personFields(ctx, donor, { campaignName = "" } = {}) {
  const nameCase = deps.displayNameCase || (s => s);
  const { firstName, lastName } = splitName(nameCase(donor && donor.name ? donor.name : ""));
  let last = null;
  if (donor && donor.id) {
    [last] = await query(
      "SELECT amount, date FROM gifts WHERE donor_id=? AND org_id=? ORDER BY date DESC, created_at DESC LIMIT 1",
      [donor.id, ctx.orgId]).catch(() => []);
  }
  return {
    // Empty means "use the renderer's own fallback" ("friend", "your gift").
    first_name: firstName,
    last_name: lastName,
    last_gift_amount: last ? formatMoney(last.amount) : "",
    last_gift_date: last ? formatDate(last.date) : "",
    campaign: campaignName || "",
    give_link: giveLink(ctx, donor ? { email: donor.email, firstName, lastName } : null),
    org_name: ctx.orgName,
  };
}

// Fields for a staff member's test copy: their own name and address, and a
// sample gift so the email reads the way a donor's will.
function sampleFields(ctx, { name, email, campaignName = "" } = {}) {
  const { firstName, lastName } = splitName(name);
  return {
    first_name: firstName || "Margaret",
    last_name: lastName,
    last_gift_amount: "$250",
    last_gift_date: formatDate(new Date()),
    campaign: campaignName || "",
    give_link: giveLink(ctx, { email, firstName, lastName }),
    org_name: ctx.orgName,
  };
}

// The renderer's problems that stop a send. The contract returns strings; a
// renderer that marks some as advisory ({ message, blocking: false }) is
// honoured, and anything else blocks, because an email with a hole in it is
// not one to send to four thousand people. (renderEmail itself throws in mode
// "send" when it has any problem; render() below turns that into this list.)
function blockingProblems(problems) {
  return (Array.isArray(problems) ? problems : [])
    .filter(p => !(p && typeof p === "object" && p.blocking === false))
    .map(p => (typeof p === "string" ? p : (p && (p.message || p.sentence)) || String(p)));
}

async function render(ctx, { blocks, subject, preheader, fields, mode = "send" }) {
  const B = await blocksMod();
  let out;
  try {
    out = B.renderEmail({
      blocks: toArray(blocks), brand: ctx.brand, fields, preheader: preheader || "",
      subject: subject || "", links: ctx.links, mode,
    });
  } catch (e) {
    // In mode "send" the renderer THROWS on any problem (code EMAIL_NOT_READY)
    // so there is no html to send by mistake. Said here as problems.
    if (e && e.code === "EMAIL_NOT_READY") {
      const problems = blockingProblems(e.problems);
      return { html: "", text: "", images: [], problems: problems.length ? problems : ["The email is not ready."], slot: B.FOOTER_SLOT };
    }
    throw e;
  }
  const html = String((out && out.html) || "");
  const slots = html.split(B.FOOTER_SLOT).length - 1;
  const problems = blockingProblems(out && out.problems);
  if (mode === "send" && slots !== 1) problems.push("The email has no place for the unsubscribe footer, so it cannot be sent.");
  return { html, text: String((out && out.text) || ""), images: (out && out.images) || [], problems, slot: B.FOOTER_SLOT };
}

// The subject line, filled the way the renderer fills the body: a known field
// takes the person's value or the renderer's own fallback, never braces.
async function subjectFor(subject, fields) {
  const B = await blocksMod();
  const defs = new Map((B.EMAIL_MERGE_FIELDS || []).map(f => [f.key, f]));
  return String(subject || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m, k) => {
    const key = k === "first" ? "first_name" : k === "org" ? "org_name" : k;
    const v = fields && fields[key];
    if (v != null && String(v).trim() !== "") return String(v);
    return defs.has(key) ? defs.get(key).fallback : m;
  });
}

// The send's HTML: the footer goes where the renderer left its slot, exactly
// once, and the open pixel follows. No brand header on top: the header block
// IS the header.
function withFooter(rendered, footerHtml, pixelHtml = "") {
  const i = rendered.html.indexOf(rendered.slot);
  if (i < 0) return null;
  return rendered.html.slice(0, i) + footerHtml + rendered.html.slice(i + rendered.slot.length) + pixelHtml;
}

// One sentence for a refusal, naming the first problem.
function refusalSentence(problems) {
  const first = problems[0] || "The email is not ready.";
  const more = problems.length > 1 ? ` (and ${problems.length - 1} more)` : "";
  return `This email cannot go out yet: ${first.replace(/\.$/, "")}${more}. Nothing was sent.`;
}

// Before a template campaign is sent, scheduled or approved: render it once
// with sample fields. A problem that is in the blocks (a picture with no alt,
// a field Steward does not fill) is in everybody's copy.
async function campaignPreflight(campaign, orgId) {
  if (!hasBlocks(campaign)) return { ok: true };
  const ctx = await orgRenderContext(orgId);
  const r = await render(ctx, {
    blocks: campaign.email_blocks, subject: campaign.subject, preheader: campaign.preheader,
    fields: sampleFields(ctx, { name: "Margaret Chen", email: "margaret@example.com", campaignName: campaign.name }),
    mode: "send",
  });
  if (r.problems.length) return { ok: false, problems: r.problems, message: refusalSentence(r.problems) };
  return { ok: true };
}

// A template, read for an org, never another's.
async function templateFor(orgId, templateId) {
  if (!templateId) return null;
  const [t] = await query(
    "SELECT * FROM email_templates WHERE id=? AND org_id=? AND archived_at IS NULL", [String(templateId), orgId]);
  return t || null;
}

// The template's words for one person, as plain text: what a draft holds.
async function templateTextFor(orgId, template, donor, { campaignName = "" } = {}) {
  const ctx = await orgRenderContext(orgId);
  const fields = await personFields(ctx, donor, { campaignName });
  const r = await render(ctx, { blocks: template.blocks, subject: template.subject, preheader: template.preheader, fields, mode: "preview" });
  return { subject: await subjectFor(template.subject, fields), body: r.text.replace(/\n{3,}/g, "\n\n").trim(), problems: r.problems };
}

// ── A CAMPAIGN FROM A TEMPLATE ─────────────────────────────────────────────
// The campaign keeps the template's BLOCKS, and each person's copy is rendered
// from them at send time (runCampaignSend). `body` holds a preview rendering
// so the older list views that read it still show the words. Reached through
// the one route POST /campaigns/from-template (routes/give.js) when the body
// carries `templateId`; `{ template }` there is the campaign-page starters.
// A route registered twice on one path breaks the tenant matrix, so this is a
// handler the one route calls, not a second registration.
async function templatePreviewHtml(orgId, t, campaignName) {
  const ctx = await orgRenderContext(orgId);
  const fields = {
    first_name: "{{first_name}}", last_name: "{{last_name}}", last_gift_amount: "{{gift_amount}}",
    last_gift_date: "", campaign: campaignName || "", give_link: giveLink(ctx, null), org_name: ctx.orgName,
  };
  const r = await render(ctx, { blocks: t.blocks, subject: t.subject, preheader: t.preheader, fields, mode: "preview" });
  return r.html.split(r.slot).join("");
}

async function campaignFromTemplate(req, res, { run, uuid, actor }) {
  const orgId = req.user.orgId;
  const t = await templateFor(orgId, req.body.templateId);
  if (!t) return res.status(404).json({ error: "template_not_found", message: "That template is not one of yours." });
  const name = String(req.body.name || t.name || "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!name) return res.status(400).json({ error: "Name required" });
  let body = "";
  try { body = await templatePreviewHtml(orgId, t, name); }
  catch (e) { console.error("[campaigns] template preview:", e.message); }
  const id = "cmp_" + uuid().slice(0, 8);
  const who = actor(req);
  await run(
    `INSERT INTO campaigns (id,org_id,name,type,subject,preheader,body,email_blocks,template_id,status,segment,
                            recipient_count,open_count,created_by,created_by_name)
     VALUES (?,?,?,?,?,?,?,?::jsonb,?,'draft',?,0,0,?,?)`,
    [id, orgId, name, "appeal", t.subject || "", t.preheader || "", body,
     JSON.stringify(toArray(t.blocks)), t.id, JSON.stringify({ mode: "all" }), who.id, who.name]);
  if (req.audit) { req.audit.entity("campaign", id, name); req.audit.action(`started a campaign from the template ${t.name}`); }
  const [row] = await query("SELECT * FROM campaigns WHERE id=?", [id]);
  return res.status(201).json({ ...row, sentence: `${name} is a draft, from the template ${t.name}. Nothing has been sent.` });
}

module.exports = {
  campaignFromTemplate,
  configure, blocksMod, hasBlocks, orgRenderContext, personFields, sampleFields, giveLink,
  render, withFooter, subjectFor, blockingProblems, refusalSentence, campaignPreflight, templateFor, templateTextFor, toArray,
};
