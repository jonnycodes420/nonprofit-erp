// routes/templates.js — COMMS-2. The brand kit and the template library.
//
// BRAND KIT (Settings): two colours from the safe palette, the signature block,
// the address and the tax language. The logo is the existing PUT /orgs/branding;
// the signer and the address are the columns receipts already read, so a
// receipt and a letter cannot be signed by two different people.
//
// TEMPLATES (Communications → Templates, "Letters and thank-yous"): Steward's
// starting wording for each kind until somebody at the org saves their own,
// which is what marks it reviewed. An unreviewed template cannot be used: it
// shows "Not yet reviewed", it previews, and it waits. A reviewed email becomes
// a DRAFT in Drafts to review for a person to send; a reviewed letter PRINTS.
// Nothing here sends anything.
const express = require("express");
const routers = { r0: express.Router() };

function mount(ctx) {
const { actor, checkWriteAccess, money, orgTime, query, requireAdmin, requireAuth, run, uuid, volunteerSummary, wrap } = ctx;

let B = null;
const READY = import("../shared/brandKit.js").then(m => { B = m; });
const app = routers.r0;
const fmt$ = cents => "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });
const longDate = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || "")); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : ""; };

async function orgOf(orgId) { const [o] = await query("SELECT * FROM orgs WHERE id=?", [orgId]); return o; }
function kitOf(o) {
  return {
    logo: o.logo_data || null,
    primary: B.isPaletteColour(o.brand_primary) ? o.brand_primary : "#0d5c3a",
    secondary: B.isPaletteColour(o.brand_secondary) ? o.brand_secondary : "#c9a84c",
    signatureName: o.receipt_signature_name || "", signatureTitle: o.receipt_signature_title || "", signatureExtra: o.brand_signature_extra || "",
    address: o.receipt_address || "",
    taxLanguage: o.tax_language || "", taxLanguageDefault: B.DEFAULT_TAX_LANGUAGE(o.legal_name || o.name),
    statementYourYear: o.statement_your_year !== false,
    legalName: o.legal_name || o.name, orgName: o.name,
  };
}
const signatureOf = k => [k.signatureName, k.signatureTitle, k.signatureExtra].filter(Boolean).join("\n");

// ── BRAND KIT ──────────────────────────────────────────────────────────────
app.get("/brand-kit", requireAuth, wrap(async (req, res) => {
  await READY;
  const o = await orgOf(req.user.orgId);
  res.json({ ...kitOf(o), palette: B.PALETTE });
}));
app.put("/brand-kit", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  await READY;
  const b = req.body || {};
  for (const k of ["primary", "secondary"]) {
    if (b[k] !== undefined && !B.isPaletteColour(b[k])) return res.status(400).json({ error: "Choose a colour from the palette: they are the ones that stay readable on paper." });
  }
  const o = await orgOf(req.user.orgId);
  const clip = (v, n) => (v === undefined ? undefined : String(v || "").trim().slice(0, n));
  const next = {
    brand_primary: b.primary !== undefined ? b.primary.toLowerCase() : o.brand_primary,
    brand_secondary: b.secondary !== undefined ? b.secondary.toLowerCase() : o.brand_secondary,
    receipt_signature_name: clip(b.signatureName, 120) ?? o.receipt_signature_name,
    receipt_signature_title: clip(b.signatureTitle, 120) ?? o.receipt_signature_title,
    brand_signature_extra: clip(b.signatureExtra, 200) ?? o.brand_signature_extra,
    receipt_address: clip(b.address, 400) ?? o.receipt_address,
    tax_language: clip(b.taxLanguage, 800) ?? o.tax_language,
    statement_your_year: b.statementYourYear !== undefined ? !!b.statementYourYear : o.statement_your_year !== false,
  };
  if (req.audit) req.audit.before(Object.fromEntries(Object.keys(next).map(k => [k, o[k] ?? null])));
  await run(`UPDATE orgs SET brand_primary=?, brand_secondary=?, receipt_signature_name=?, receipt_signature_title=?, brand_signature_extra=?,
                             receipt_address=?, tax_language=?, statement_your_year=? WHERE id=?`,
    [next.brand_primary, next.brand_secondary, next.receipt_signature_name || null, next.receipt_signature_title || null,
     next.brand_signature_extra || null, next.receipt_address || null, next.tax_language || null, next.statement_your_year, o.id]);
  if (req.audit) req.audit.after(next);
  res.json({ ...kitOf(await orgOf(o.id)), palette: B.PALETTE });
}));

// ── FACTS FOR A PERSON ─────────────────────────────────────────────────────
// Every merge field's value for one donor, from their own record.
async function factsFor(org, donorId) {
  const [d] = await query("SELECT * FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [donorId, org.id]);
  if (!d) return null;
  const year = orgTime.orgToday(org).slice(0, 4);
  const [last] = await query(
    `SELECT g.amount::text AS amount, g.date, g.tribute_type, g.tribute_name, f.name AS fund FROM gifts g LEFT JOIN fin_funds f ON f.id = g.fund_id
      WHERE g.org_id=? AND g.donor_id=? AND g.amount > 0 ORDER BY g.date DESC, g.id DESC LIMIT 1`, [org.id, d.id]);
  const [tot] = await query(
    `SELECT COALESCE(SUM(amount),0)::text AS life, COALESCE(SUM(amount) FILTER (WHERE LEFT(date,4)=?),0)::text AS yr FROM gifts WHERE org_id=? AND donor_id=?`,
    [year, org.id, d.id]);
  const [sub] = await query(`SELECT amount::text AS amount FROM recurring_subscriptions WHERE org_id=? AND donor_id=? AND status='active' LIMIT 1`, [org.id, d.id]).catch(() => []);
  const [ev] = await query(
    `SELECT e.name FROM event_attendees a JOIN events e ON e.id = a.event_id WHERE a.org_id=? AND a.donor_id=?
        AND (a.status='attended' OR a.checked_in_at IS NOT NULL) ORDER BY e.date DESC LIMIT 1`, [org.id, d.id]);
  const [vh] = await query(`SELECT COALESCE(SUM(ROUND(hours*100)),0)::int AS hh FROM volunteer_shifts WHERE org_id=? AND person_id=? AND LEFT(date,4)=?`, [org.id, d.id, year]);
  const c = v => money.toCents(String(v ?? "0")) ?? 0;
  const k = kitOf(org);
  return {
    donor: { id: d.id, name: d.name, email: d.email || "", address: [d.address, [d.city, d.state, d.zip].filter(Boolean).join(" ")].filter(Boolean).join("\n") },
    values: {
      first_name: String(d.name || "").trim().split(/\s+/)[0] || "", full_name: d.name || "",
      gift_amount: last ? fmt$(c(last.amount)) : "", gift_date: last ? longDate(last.date) : "", fund: last && last.fund ? last.fund : "",
      tribute: last && last.tribute_name ? `${last.tribute_type === "memory" ? "in memory of" : "in honour of"} ${last.tribute_name}` : "",
      year, year_total: c(tot.yr) > 0 ? fmt$(c(tot.yr)) : "", lifetime_total: c(tot.life) > 0 ? fmt$(c(tot.life)) : "",
      monthly_amount: sub ? fmt$(c(sub.amount)) : "", event_name: ev ? ev.name : "",
      volunteer_hours: vh && vh.hh ? String(vh.hh / 100) : "",
      org_name: org.name, signature: signatureOf(k), org_address: k.address, tax_language: k.taxLanguage || k.taxLanguageDefault,
    },
  };
}

// ── TEMPLATES ──────────────────────────────────────────────────────────────
async function templateOf(orgId, kind) {
  const def = B.kindDef(kind);
  if (!def) return null;
  const [row] = await query("SELECT * FROM message_templates WHERE org_id=? AND kind=?", [orgId, kind]);
  return { ...def, subject: row ? row.subject : def.subject, body: row ? row.body : def.body,
    reviewed: !!(row && row.reviewed_at), reviewedAt: row ? row.reviewed_at : null, reviewedBy: row ? row.reviewed_by_name : null };
}
app.get("/templates", requireAuth, wrap(async (req, res) => {
  await READY;
  const out = [];
  for (const def of B.TEMPLATE_KINDS) out.push(await templateOf(req.user.orgId, def.kind));
  res.json({ templates: out, mergeFields: B.MERGE_FIELDS });
}));
app.put("/templates/:kind", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  await READY;
  if (!B.kindDef(req.params.kind)) return res.status(404).json({ error: "Not found" });
  const subject = String((req.body && req.body.subject) || "").trim().slice(0, 200);
  const body = String((req.body && req.body.body) || "").trim().slice(0, 8000);
  if (!subject || !body) return res.status(400).json({ error: "A template needs a subject and a body." });
  const unknown = [...B.unknownFields(subject), ...B.unknownFields(body)];
  if (unknown.length) return res.status(400).json({ error: "unknown_fields", sentence: `These are not merge fields: ${unknown.map(u => "{{" + u + "}}").join(", ")}. Pick fields from the list.` });
  const who = actor(req);
  const [prior] = await query("SELECT * FROM message_templates WHERE org_id=? AND kind=?", [req.user.orgId, req.params.kind]);
  if (req.audit) req.audit.before(prior ? { subject: prior.subject, body: prior.body } : null);
  await run(`INSERT INTO message_templates (id,org_id,kind,subject,body,reviewed_at,reviewed_by_name,created_by,created_by_name)
             VALUES (?,?,?,?,?,NOW(),?,?,?)
             ON CONFLICT (org_id, kind) DO UPDATE SET subject=EXCLUDED.subject, body=EXCLUDED.body, reviewed_at=NOW(),
               reviewed_by_name=EXCLUDED.reviewed_by_name, updated_at=NOW()`,
    ["mt_" + uuid().slice(0, 10), req.user.orgId, req.params.kind, subject, body, who.name, who.id, who.name]);
  if (req.audit) { req.audit.after({ subject, body }); req.audit.entity("message_template", req.params.kind, B.kindDef(req.params.kind).label); }
  res.json(await templateOf(req.user.orgId, req.params.kind));
}));

// PREVIEW against a real person of the org's choosing. Unsaved edits can be
// previewed too: pass subject/body.
app.post("/templates/:kind/preview", requireAuth, wrap(async (req, res) => {
  await READY;
  const t = await templateOf(req.user.orgId, req.params.kind);
  if (!t) return res.status(404).json({ error: "Not found" });
  const org = await orgOf(req.user.orgId);
  const f = await factsFor(org, String((req.body && req.body.donorId) || ""));
  if (!f) return res.status(404).json({ error: "Choose one of your people to preview against." });
  const s = B.renderTemplate(req.body && req.body.subject != null ? req.body.subject : t.subject, f.values);
  const b = B.renderTemplate(req.body && req.body.body != null ? req.body.body : t.body, f.values);
  res.json({ donor: f.donor, subject: s.text, body: b.text, missing: [...new Set([...s.missing, ...b.missing])],
    unknown: [...new Set([...s.unknown, ...b.unknown])], brand: kitOf(org), reviewed: t.reviewed, channel: t.channel });
}));

async function usable(req, res) {
  const t = await templateOf(req.user.orgId, req.params.kind);
  if (!t) { res.status(404).json({ error: "Not found" }); return null; }
  if (!t.reviewed) { res.status(409).json({ error: "not_reviewed", sentence: "This template is still in Steward's starting words. Read it, change what you like and save it, then use it." }); return null; }
  const org = await orgOf(req.user.orgId);
  const f = await factsFor(org, String((req.body && req.body.donorId) || ""));
  if (!f) { res.status(404).json({ error: "Choose one of your people." }); return null; }
  const s = B.renderTemplate(t.subject, f.values), b = B.renderTemplate(t.body, f.values);
  const missing = [...new Set([...s.missing, ...b.missing])];
  if (missing.length) { res.status(409).json({ error: "missing_fields", missing, sentence: `${f.donor.name} has nothing on file for: ${missing.map(m => m.replace(/_/g, " ")).join(", ")}. Choose another template or fill those in first.` }); return null; }
  return { t, org, f, subject: s.text, body: b.text };
}

// AN EMAIL becomes a draft for a person to read and send.
app.post("/templates/:kind/draft", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  await READY;
  const u = await usable(req, res); if (!u) return;
  if (!u.f.donor.email) return res.status(409).json({ error: "no_email", sentence: `${u.f.donor.name} has no email address on file. Print it as a letter instead.` });
  const who = actor(req), id = "md_" + uuid().slice(0, 12);
  await run(`INSERT INTO milestone_drafts (id,org_id,donor_id,milestone_key,subject,body,status,source,created_by,created_by_name)
             VALUES (?,?,?,?,?,?,'pending_review','template',?,?)`,
    [id, req.user.orgId, u.f.donor.id, `template:${u.t.kind}:${Date.now()}`, u.subject, u.body, who.id, who.name]);
  res.status(201).json({ draftId: id, sentence: `A draft to ${u.f.donor.name} is waiting in Drafts to review. Nothing has been sent.` });
}));

// A LETTER prints, in the brand kit: logo, primary band, secondary rule,
// signature, address and nothing else.
app.post("/templates/:kind/letter.pdf", requireAuth, wrap(async (req, res) => {
  await READY;
  const u = await usable(req, res); if (!u) return;
  const k = kitOf(u.org);
  const PDFDocument = require("pdfkit");
  const doc = new PDFDocument({ size: "LETTER", margin: 64 });
  const chunks = []; doc.on("data", c => chunks.push(c));
  const done = new Promise(r => doc.on("end", r));
  const W = doc.page.width;
  doc.rect(0, 0, W, 10).fill(k.primary);
  let y = 40;
  const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(k.logo || "");
  if (m) { try { doc.image(Buffer.from(m[2], "base64"), 64, y, { fit: [150, 48] }); y += 58; } catch { /* a logo pdfkit cannot read is left off */ } }
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#0f1a12").text(u.org.name, 64, y); y = doc.y + 2;
  if (k.address) { doc.font("Helvetica").fontSize(9).fillColor("#5a554f").text(k.address, 64, y); y = doc.y; }
  y += 10; doc.moveTo(64, y).lineTo(W - 64, y).strokeColor(k.secondary).lineWidth(1.5).stroke(); y += 22;
  doc.font("Helvetica").fontSize(10).fillColor("#0f1a12").text(orgTime.formatCivil(orgTime.orgToday(u.org)), 64, y); y = doc.y + 14;
  if (u.f.donor.address) { doc.text(`${u.f.donor.name}\n${u.f.donor.address}`, 64, y); y = doc.y + 18; }
  doc.font("Helvetica").fontSize(11).fillColor("#0f1a12").text(u.body, 64, y, { width: W - 128, lineGap: 3 });
  doc.end(); await done;
  // A printed letter is a disclosure of a person's record: logged as one.
  if (req.audit) { req.audit.action("printed a letter"); req.audit.entity("donor", u.f.donor.id, u.f.donor.name); }
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${u.t.kind}-${u.f.donor.id}.pdf"`);
  res.send(Buffer.concat(chunks));
}));
}

module.exports = { routers, mount };
