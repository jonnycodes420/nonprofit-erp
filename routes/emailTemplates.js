// routes/emailTemplates.js · EMAIL-1. EMAIL TEMPLATES, BUILT FROM BLOCKS.
//
//   GET  /email-templates                  the org's saved templates + the starters not yet saved
//   POST /email-templates                  {starterKey} or {copyOf}: a new saved template
//   PUT  /email-templates/:id              name, subject, preheader, blocks (validated)
//   POST /email-templates/:id/archive      hide it (Undo is /restore)
//   POST /email-templates/:id/restore
//   POST /email-templates/:id/preview      {device, dark} -> {html, problems}, the org's live brand, sample fields
//   POST /email-templates/:id/test         send me a test: to the caller only, through the campaign test's gates
//   POST /email-templates/:id/draft-ai     {instructions?} -> proposed words, never saved by itself
//   GET  /watch/:orgSlug/:provider/:videoId  the public "Steward video page" an email's video links to
//
// THE RULES IT KEEPS. Steward prepares and a person sends: nothing here mails a
// donor. The test goes to the person pressing the button, kind campaign_test,
// so it waits for onboarding exactly like the campaign test, and the demo org
// gets the rendered email back with the sentence instead of a send. The model
// proposes words through aiClient.js (thinking off, end_turn or nothing), and
// the client shows them for approval; this file never saves them. Every write
// is recorded by middleware/auditTrail.js: nothing here writes an audit row.
// A GET writes nothing, the watch page included.
"use strict";
const express = require("express");
const { publicAppUrl } = require("../publicUrl");
const { aiGate, anthropicFor } = require("../aiClient");
const mailPolicy = require("../mailPolicy");

const routers = { r0: express.Router() };

let EB = null, LIB = null, PW = null, PP = null;
const READY = Promise.all([
  import("../shared/emailBlocks.js").then(m => { EB = m; }),
  import("../shared/emailTemplateLibrary.js").then(m => { LIB = m; }),
  import("../shared/pageWidgets.js").then(m => { PW = m; }),
  import("../shared/publicPage.js").then(m => { PP = m; }),
]);

const DRAFT_MODEL = "claude-opus-5";
const ID_RE = /^et_[a-f0-9]{12}$/;
const VIDEO_ID = { youtube: /^[A-Za-z0-9_-]{6,20}$/, vimeo: /^\d{6,12}$/ };
const clip = (v, n) => String(v == null ? "" : v).slice(0, n);
const firstName = name => String(name || "").trim().split(/\s+/)[0] || "";

let C = null;   // the mounted context; buildEmailContext needs query and the brand resolver

// The URL an email's video links to: Steward's own page for it, on the app
// domain (vercel.json rewrites /watch/ to the API).
function videoPageUrl(orgSlug, provider, videoId) {
  return `${publicAppUrl()}/watch/${encodeURIComponent(orgSlug || "org")}/${provider}/${encodeURIComponent(videoId)}`;
}

// ── THE ONE RENDER CONTEXT ─────────────────────────────────────────────────
// The brand and links for renderEmail, read live for one org. Exported so the
// campaign and sequence send paths render with exactly what the preview used.
async function buildEmailContext(orgId) {
  await READY;
  const { query, resolveOrgBrandTheme, portalCardTheme } = C;
  const [org] = await query(`SELECT o.id, o.name, o.org_slug, o.website, ps.primary_color, ps.accent_color, ps.button_color, ps.type_pairing
                                FROM orgs o LEFT JOIN portal_settings ps ON ps.org_id = o.id WHERE o.id=?`, [orgId]);
  const theme = await resolveOrgBrandTheme(orgId).catch(() => null) || {};
  const card = portalCardTheme(org || {});
  const app = publicAppUrl();
  const brand = {
    band: theme.band || card.primary, bandFg: theme.bandFg || card.primaryFg,
    accent: theme.accent || card.accent, accentFg: theme.accentFg || card.accentFg,
    buttonColor: card.buttonColor, buttonFg: card.buttonFg,
    typePairing: card.typePairing,
    // A base64 logo is not sent in an email (many inboxes block data images);
    // only an asset URL rides as the header's src. Without one the header is the name.
    logoUrl: theme.logoAbsUrl || null,
    displayName: theme.displayName || (org && org.name) || "",
  };
  const events = await query(
    `SELECT id, name, date, public_slug FROM events WHERE org_id=? ORDER BY date DESC LIMIT 500`, [orgId]);
  const pages = await query(
    `SELECT id, title, slug, image_url FROM giving_pages WHERE org_id=? ORDER BY created_at DESC LIMIT 500`, [orgId]);
  const evMap = new Map(events.map(e => [e.id, e]));
  const gpMap = new Map(pages.map(p => [p.id, p]));
  const slug = org && org.org_slug;
  const links = {
    assetBase: app,
    videoPage: (provider, videoId) => videoPageUrl(slug, provider, videoId),
    event: id => {
      const e = evMap.get(id);
      if (!e) return null;
      const d = e.date instanceof Date ? e.date.toISOString().slice(0, 10) : String(e.date || "").slice(0, 10);
      const pretty = d ? new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : "";
      return { name: e.name, date: pretty, url: e.public_slug ? `${app}/e/${encodeURIComponent(e.public_slug)}` : "" };
    },
    givingPage: id => {
      const p = gpMap.get(id);
      if (!p || !slug) return null;
      return { title: p.title, url: `${app}/give/${encodeURIComponent(slug)}/${encodeURIComponent(p.slug)}`, image: p.image_url || null };
    },
  };
  return {
    brand, links,
    giveLink: slug ? `${app}/give/${encodeURIComponent(slug)}` : "",
    volunteerLink: slug ? `${app}/volunteer/${encodeURIComponent(slug)}` : "",
    website: org && /^https?:\/\//i.test(String(org.website || "")) ? org.website : "",
    orgName: brand.displayName,
    events, pages,
  };
}

function mount(ctx) {
C = ctx;
const {
  actor, checkWriteAccess, query, run, requireAuth, uuid, wrap,
  unsubscribeEmailFooterHtml, orgSendingIdentity, resend, orgMaySendEmail, demoMailNote, videoLimiter,
} = ctx;
const app = routers.r0;

const shape = r => ({
  id: r.id, starterKey: r.starter_key || null, name: r.name, purpose: r.purpose,
  subject: r.subject, preheader: r.preheader, blocks: Array.isArray(r.blocks) ? r.blocks : [],
  archived: !!r.archived_at, archivedAt: r.archived_at || null,
  createdByName: r.created_by_name || null, createdAt: r.created_at, updatedAt: r.updated_at,
});
const starterShape = s => ({ starterKey: s.key, name: s.name, purpose: s.purpose, subject: s.subject, preheader: s.preheader, blocks: s.blocks, starter: true });

async function templateRow(orgId, id) {
  if (!ID_RE.test(String(id || ""))) return null;
  const [r] = await query(`SELECT * FROM email_templates WHERE id=? AND org_id=?`, [id, orgId]);
  return r || null;
}
async function me(req) {
  const [u] = await query(`SELECT id, name, email FROM users WHERE id=? AND org_id=?`, [req.user.userId, req.user.orgId]);
  return u || {};
}
// The signed-in person as the sample donor: their own name, and their own
// last gift if they are on the donor file under the same address.
async function sampleFields(orgId, person, ectx) {
  let lastAmount = "$250", lastDate = "March 3, 2026";
  if (person.email) {
    const [g] = await query(
      `SELECT g.amount, g.date FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
        WHERE g.org_id=? AND lower(d.email)=lower(?) AND d.deleted_at IS NULL ORDER BY g.date DESC LIMIT 1`, [orgId, person.email]).catch(() => []);
    if (g) {
      lastAmount = "$" + Number(g.amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\.00$/, "");
      const d = g.date instanceof Date ? g.date.toISOString().slice(0, 10) : String(g.date || "").slice(0, 10);
      if (d) lastDate = new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
    }
  }
  return {
    first_name: firstName(person.name) || "Margaret",
    last_gift_amount: lastAmount, last_gift_date: lastDate,
    campaign: "your next appeal", give_link: ectx.giveLink, org_name: ectx.orgName,
  };
}
// Starter buttons with no link get the org's own: its volunteer page, its website.
function fillStarterLinks(blocks, ectx) {
  return blocks.map(b => {
    if (!b || b.type !== "button" || b.url) return b;
    if (b.action === "volunteer" && ectx.volunteerLink) return { ...b, url: ectx.volunteerLink };
    if (b.action === "readmore" && ectx.website) return { ...b, url: ectx.website };
    return b;
  });
}
function renderFor(row, ectx, fields, mode) {
  return EB.renderEmail({
    blocks: row.blocks || [], brand: ectx.brand, fields, links: ectx.links,
    subject: row.subject || "", preheader: row.preheader || "", mode,
  });
}

// ── THE LIBRARY ────────────────────────────────────────────────────────────
app.get("/email-templates", requireAuth, wrap(async (req, res) => {
  await READY;
  const orgId = req.user.orgId;
  const rows = await query(`SELECT * FROM email_templates WHERE org_id=? ORDER BY archived_at IS NOT NULL, updated_at DESC`, [orgId]);
  const saved = new Set(rows.filter(r => !r.archived_at && r.starter_key).map(r => r.starter_key));
  res.json({
    templates: rows.map(shape),
    starters: LIB.EMAIL_STARTERS.filter(s => !saved.has(s.key)).map(starterShape),
    mergeFields: EB.EMAIL_MERGE_FIELDS.map(f => ({ token: f.token, label: f.label })),
    blockTypes: PW.widgetsForSurface("email").map(w => ({ key: w.key, label: w.label, hint: w.hint, defaults: w.defaults })),
  });
}));

app.post("/email-templates", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  await READY;
  const orgId = req.user.orgId;
  const b = req.body || {};
  let base;
  if (b.starterKey) {
    const s = LIB.starterByKey(String(b.starterKey));
    if (!s) return res.status(400).json({ error: "unknown_starter", sentence: "That starting point is not one Steward has." });
    const person = await me(req);
    const ectx = await buildEmailContext(orgId);
    base = { starter_key: s.key, name: s.name, purpose: s.purpose, subject: s.subject, preheader: s.preheader,
             blocks: fillStarterLinks(LIB.signStarterBlocks(s.blocks, { name: person.name }), ectx) };
  } else if (b.copyOf) {
    const src = await templateRow(orgId, b.copyOf);
    if (!src) return res.status(404).json({ error: "Template not found" });
    base = { starter_key: src.starter_key, name: clip(`${src.name} (copy)`, 120), purpose: src.purpose,
             subject: src.subject, preheader: src.preheader, blocks: src.blocks || [] };
  } else {
    return res.status(400).json({ error: "starter_or_copy", sentence: "Start from one of the emails, or copy one of yours." });
  }
  const id = "et_" + uuid().replace(/-/g, "").slice(0, 12);
  const who = actor(req);
  await run(`INSERT INTO email_templates (id, org_id, starter_key, name, purpose, subject, preheader, blocks, created_by, created_by_name)
             VALUES (?,?,?,?,?,?,?,?::jsonb,?,?)`,
    [id, orgId, base.starter_key || null, base.name, base.purpose || "appeal", base.subject || "", base.preheader || "",
     JSON.stringify(base.blocks || []), who.id, who.name]);
  if (req.audit) req.audit.entity("email_template", id, base.name);
  res.status(201).json({ template: shape(await templateRow(orgId, id)) });
}));

app.put("/email-templates/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  await READY;
  const orgId = req.user.orgId;
  const row = await templateRow(orgId, req.params.id);
  if (!row) return res.status(404).json({ error: "Template not found" });
  const b = req.body || {};
  const name = b.name != null ? clip(b.name, 120).trim() : row.name;
  if (!name) return res.status(400).json({ error: "name_required", sentence: "Give the template a name." });
  const subject = b.subject != null ? clip(b.subject, 200) : row.subject;
  const preheader = b.preheader != null ? clip(b.preheader, 200) : row.preheader;
  let blocks = row.blocks || [];
  if (b.blocks != null) {
    const v = EB.validateEmailBlocks(b.blocks, PW.typesForSurface("email"));
    if (!v.ok) return res.status(400).json({ error: "invalid_blocks", sentence: v.error });
    blocks = v.blocks;
  }
  for (const s of [name, subject, preheader]) {
    if (/\u2014/.test(s)) return res.status(400).json({ error: "em_dash", sentence: "Use a comma or a full stop instead of a long dash." });
  }
  await run(`UPDATE email_templates SET name=?, subject=?, preheader=?, blocks=?::jsonb, updated_at=NOW() WHERE id=? AND org_id=?`,
    [name, subject, preheader, JSON.stringify(blocks), row.id, orgId]);
  if (req.audit) req.audit.entity("email_template", row.id, name);
  res.json({ template: shape(await templateRow(orgId, row.id)) });
}));

for (const [path, archived] of [["archive", true], ["restore", false]]) {
  app.post(`/email-templates/:id/${path}`, requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const orgId = req.user.orgId;
    const row = await templateRow(orgId, req.params.id);
    if (!row) return res.status(404).json({ error: "Template not found" });
    await run(`UPDATE email_templates SET archived_at=${archived ? "NOW()" : "NULL"}, updated_at=NOW() WHERE id=? AND org_id=?`, [row.id, orgId]);
    if (req.audit) req.audit.entity("email_template", row.id, row.name);
    res.json({ template: shape(await templateRow(orgId, row.id)) });
  }));
}

// ── PREVIEW ────────────────────────────────────────────────────────────────
// The email as it will look, with the org's brand read now and the signed-in
// person as the sample donor. The footer slot gets the real MAIL-1 footer for
// the person's own address (it reads; it writes nothing). Dark forces the
// dark block on, so the person can see it without changing their own settings.
async function previewHtml(req, row) {
  const orgId = req.user.orgId;
  const person = await me(req);
  const ectx = await buildEmailContext(orgId);
  const fields = await sampleFields(orgId, person, ectx);
  const r = renderFor(row, ectx, fields, "preview");
  const footer = await unsubscribeEmailFooterHtml(person.email || "you@example.org", orgId, "campaign");
  const html = r.html.replace(EB.FOOTER_SLOT, footer);
  const lint = EB.lintEmailHtml(r.html);
  return { html, problems: [...r.problems, ...lint.filter(p => !r.problems.includes(p))], person, fields, ectx };
}

app.post("/email-templates/:id/preview", requireAuth, wrap(async (req, res) => {
  await READY;
  const row = await templateRow(req.user.orgId, req.params.id);
  if (!row) return res.status(404).json({ error: "Template not found" });
  // A preview of unsaved edits: the body may carry the blocks being edited.
  const b = req.body || {};
  const draft = { ...row };
  if (b.blocks != null) {
    const v = EB.validateEmailBlocks(b.blocks, PW.typesForSurface("email"));
    if (!v.ok) return res.status(400).json({ error: "invalid_blocks", sentence: v.error });
    draft.blocks = v.blocks;
  }
  if (b.subject != null) draft.subject = clip(b.subject, 200);
  if (b.preheader != null) draft.preheader = clip(b.preheader, 200);
  const p = await previewHtml(req, draft);
  let html = p.html;
  if (b.dark === true) html = html.split(EB.DARK_MEDIA).join("@media all");
  res.json({ html, problems: p.problems, device: b.device === "phone" ? "phone" : "desktop", width: b.device === "phone" ? 375 : 600 });
}));

// ── SEND ME A TEST ─────────────────────────────────────────────────────────
// One copy to the person pressing the button, under the org's sending identity,
// kind campaign_test (staff mail: it waits for onboarding, and the demo org
// never sends). Not counted, not on anybody's timeline. Problems do not block
// a test to yourself; they are listed with it, and a send to donors refuses them.
app.post("/email-templates/:id/test", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  await READY;
  const orgId = req.user.orgId;
  const row = await templateRow(orgId, req.params.id);
  if (!row) return res.status(404).json({ error: "Template not found" });
  const person = await me(req);
  const to = String((req.body && req.body.to) || person.email || "").trim();
  if (!to) return res.status(400).json({ error: "No address to send the test to." });
  if (to.toLowerCase() !== String(person.email || "").toLowerCase()) return res.status(403).json({ error: "test_to_self",
    message: "A test goes to you. Sending to somebody else is a send, and it belongs on a campaign." });
  const p = await previewHtml(req, row);
  const gate = await orgMaySendEmail(orgId, mailPolicy.categoryOf("campaign_test"));
  if (!gate.send) {
    const demo = await demoMailNote(orgId, { what: "this test", to });
    return res.json({ sent: false, to, html: p.html, problems: p.problems, reason: gate.reason,
      sentence: demo || mailPolicy.REASON_SENTENCE[gate.reason] || "Nothing was sent." });
  }
  const subj = EB.renderSubject(row.subject || row.name, p.fields) || row.name;
  const identity = await orgSendingIdentity(orgId);
  let delivered = false;
  if (process.env.RESEND_API_KEY) {
    try {
      const { error } = await resend.emails.send({
        from: identity.from, ...(identity.replyTo ? { replyTo: identity.replyTo } : {}),
        to, subject: `[Test] ${subj}`,
        _stewardOrgId: orgId, _stewardKind: "campaign_test",
        html: p.html,
      });
      if (error) throw new Error(error.message);
      delivered = true;
    } catch (e) {
      console.error("[email-template] test send failed:", e.message);
      return res.status(502).json({ error: "send_failed", message: "The test could not be sent just now. Nothing about the template changed." });
    }
  }
  res.json({ sent: delivered, to, from: identity.from, problems: p.problems, counted: false,
    sentence: delivered ? `A test is on its way to ${to}. Nobody else received it.` : "Email is not configured on this server, so nothing was sent." });
}));

// ── DRAFT WITH AI ──────────────────────────────────────────────────────────
// Proposed words for the text-bearing blocks, from the org's own name, mission
// and the template as it stands. Nothing is saved: the client shows each
// proposal beside the current words and the person applies and saves.
function textSlots(blocks) {
  const slots = [];
  (blocks || []).forEach((b, i) => {
    if (!b) return;
    if (b.type === "hero") { if (b.heading) slots.push({ id: `${i}.heading`, text: b.heading }); if (b.sub) slots.push({ id: `${i}.sub`, text: b.sub }); }
    if (b.type === "richtext") (b.blocks || []).forEach((p, j) => { if (p && p.type !== "ul" && p.text) slots.push({ id: `${i}.blocks.${j}`, text: p.text }); });
    if (b.type === "quote" && b.text) slots.push({ id: `${i}.text`, text: b.text });
    if (b.type === "button" && b.label) slots.push({ id: `${i}.label`, text: b.label });
  });
  return slots;
}
const numbersIn = s => (String(s).match(/\$?\d[\d,.]*/g) || []).map(x => x.replace(/[,.]+$/, ""));
const tokensIn = s => String(s).match(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g) || [];

app.post("/email-templates/:id/draft-ai", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  await READY;
  const orgId = req.user.orgId;
  const row = await templateRow(orgId, req.params.id);
  if (!row) return res.status(404).json({ error: "Template not found" });
  const instructions = clip(req.body && req.body.instructions, 600).trim();
  const slots = textSlots(row.blocks);
  const starter = row.starter_key ? LIB.starterByKey(row.starter_key) : null;
  const starterSlots = starter ? new Map(textSlots(LIB.signStarterBlocks(starter.blocks, {})).map(s => [s.id, s.text])) : new Map();
  // The template answer: the starter's own words where this template began
  // from one, otherwise the words as they stand.
  const templateAnswer = why => res.json({ source: "template",
    proposals: slots.map(s => ({ id: s.id, current: s.text, proposed: starterSlots.get(s.id) || s.text })),
    sentence: `${why} These are the starting words${starter ? ` from "${starter.name}"` : ""}; change any of them yourself. Nothing is saved until you press Save.` });
  if (!slots.length) return res.json({ source: "template", proposals: [], sentence: "There are no words in this template to redraft yet." });
  const gate = await aiGate(orgId);
  if (!gate.ok) return templateAnswer(gate.reason === "ai_disabled" ? "Drafting is turned off for your organization." : "Drafting is not available on this server.");
  const [org] = await query(`SELECT name, mission FROM orgs WHERE id=?`, [orgId]);
  const ectx = await buildEmailContext(orgId);
  const source = [org && org.mission, row.subject, row.preheader, ...slots.map(s => s.text), instructions].join("\n");
  try {
    const msg = await anthropicFor(orgId).messages.create({
      model: DRAFT_MODEL, max_tokens: 1600, thinking: { type: "disabled" },
      system: "You redraft the words of one email for a small nonprofit, in its own voice: warm, plain, short sentences, an invitation and never pressure. "
        + "No exclamation marks, no em dashes, no 'Dear Friend', no markdown. Never invent a fact, a number, an amount, a date, a name or an outcome: use only what the organization and the current words say. "
        + "Keep every {{merge_field}} that appears in a slot, unchanged. Keep each slot about as long as it is now; a button label stays under five words. "
        + "Reply with ONLY a JSON object: {\"slots\":[{\"id\":\"<slot id>\",\"text\":\"<new words>\"}]} with one entry per slot given.",
      messages: [{ role: "user", content:
        `Organization: ${ectx.orgName || (org && org.name) || ""}\nMission: ${(org && org.mission) || "(not recorded)"}\n`
        + `Email: ${row.name} (${row.purpose})\nSubject: ${row.subject}\n`
        + (instructions ? `What the person asked for: ${instructions}\n` : "")
        + `\nSlots:\n${JSON.stringify(slots)}` }],
    });
    if (msg.stop_reason !== "end_turn") return templateAnswer("The draft did not finish, so Steward did not show it.");
    const raw = (msg.content || []).filter(c => c.type === "text").map(c => c.text).join("").trim();
    let parsed = null;
    try { parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { parsed = null; }
    const got = new Map((parsed && Array.isArray(parsed.slots) ? parsed.slots : []).map(s => [String(s && s.id), String((s && s.text) || "").trim()]));
    const proposals = [];
    for (const s of slots) {
      const t = got.get(s.id);
      if (!t) return templateAnswer("The draft left some of the words out, so Steward set it aside.");
      const bad = numbersIn(t).find(n => !source.includes(n.replace(/^\$/, "")));
      const lostToken = tokensIn(s.text).find(k => !t.includes(k));
      const newToken = tokensIn(t).find(k => !tokensIn(s.text).includes(k) && !EB.EMAIL_MERGE_FIELDS.some(f => f.token === k.replace(/\s+/g, "")));
      if (bad || lostToken || newToken || /\u2014/.test(t) || t.length > 4000) {
        return templateAnswer(`Steward set the written draft aside because it ${bad ? `added a number (${bad}) the record does not hold` : lostToken ? `dropped ${lostToken}` : newToken ? `used ${newToken}, which Steward cannot fill` : "broke the house style"}.`);
      }
      proposals.push({ id: s.id, current: s.text, proposed: t });
    }
    return res.json({ source: "ai", proposals,
      sentence: "Steward proposed these words from your organization's own details and the template as it stands. Read each one; nothing changes until you apply it and press Save." });
  } catch (e) {
    console.warn("[email-template draft-ai] fell back to the template:", e.message);
    return templateAnswer("Drafting could not be reached just now.");
  }
}));

// ── THE STEWARD VIDEO PAGE ─────────────────────────────────────────────────
// An inbox cannot play video, so an email's video is a thumbnail that links
// here: the org's brand and the player, embedded from an id we parsed and a
// URL we built. Anything that does not parse is a 404. A GET writes nothing.
app.get("/watch/:orgSlug/:provider/:videoId", videoLimiter, wrap(async (req, res) => {
  await READY;
  res.setHeader("Cache-Control", "public, max-age=300");
  res.setHeader("X-Robots-Tag", "noindex");
  const esc = PP.escapeHtml;
  const provider = String(req.params.provider || "");
  const videoId = String(req.params.videoId || "");
  const NEUTRAL = { band: "#1a6b4a", bandFg: "#ffffff", displayName: "", logoDataUri: null, logoAbsUrl: null };
  const notFound = brand => res.status(404).send(PP.publicPage({ title: "Not found", brand: brand || NEUTRAL, footer: "Sent with Steward.",
    body: `<div class="card"><h1>That video is not here.</h1><p class="muted">The link may be incomplete. Ask the organisation that sent it for a fresh one.</p></div>` }));
  const slug = String(req.params.orgSlug || "");
  if (!/^[a-z0-9-]{1,80}$/i.test(slug) || !VIDEO_ID[provider] || !VIDEO_ID[provider].test(videoId)) return notFound();
  const [org] = await query(`SELECT id, name FROM orgs WHERE org_slug=?`, [slug]);
  if (!org) return notFound();
  const brand = await C.resolveOrgBrandTheme(org.id).catch(() => null) || NEUTRAL;
  const src = provider === "vimeo"
    ? `https://player.vimeo.com/video/${encodeURIComponent(videoId)}`
    : `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}`;
  const orgName = brand.displayName || org.name || "";
  res.send(PP.publicPage({ title: orgName ? `A video from ${orgName}` : "A video", brand, wide: true, footer: "Sent with Steward.",
    body: `<div class="card"><h1>${orgName ? `A video from ${esc(orgName)}` : "A video"}</h1>
      <div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:10px;background:#0f1a12">
        <iframe title="Video" src="${esc(src)}" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen
          style="position:absolute;top:0;left:0;width:100%;height:100%;border:0"></iframe>
      </div></div>` }));
}));
}

module.exports = { routers, mount, buildEmailContext, videoPageUrl };
