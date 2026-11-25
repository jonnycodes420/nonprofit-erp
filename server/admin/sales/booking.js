// server/admin/sales/booking.js · ONBOARD-4 item 3. THE BOOKING PAGE LANDS IN THE SALES CRM.
//
// /book is the website's one action (Jonathan, 23 Nov: nobody signs up cold). The form's answers
// are kept in `sales_bookings` with the optional file; SALES-2's inbound path makes or matches the
// contact and organization and opens the deal, and the task is Jonathan's: read the answers before
// the call. The slots themselves are the booking tool's (client/src/marketing/booking/), which
// sends the prospect its own confirmation. Steward sends a prospect nothing.
//
// A partner code (/book?partner=<code>) is a row in `partners` (code, name, market; no commission
// field). A known code puts "Recommended by <name>" on the page and tags the deal with the code, so
// the give-back fund can count bookings by market. An unknown code is ignored, never an error: the
// person still books.
//
// THE PLANTED DEFECT (ONBOARD4_PLANT=nopartner on the server, tests only): the deal is not tagged.
"use strict";
const { newId } = require("../../shared/newId");
const INBOUND = require("./inbound");

const PLANT = process.env.TEST_MODE === "1" ? process.env.ONBOARD4_PLANT || "" : "";
const SYSTEM = { id: "system:public-book", name: "Steward (booking page)" };
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// The donor-count bands the form offers, in its words.
const DONOR_COUNTS = ["Under 500", "500 to 2,500", "2,500 to 10,000", "Over 10,000", "Not sure"];
// SECURE-1: an anonymous request is read by the 5 MB parser only, so a file sent with the form is
// at most 3 MB (about 4 MB once encoded). A larger file comes to the call, or after it.
const MAX_FILE_BYTES = 3 * 1024 * 1024;
const FILE_TYPES = /\.(csv|tsv|txt|xlsx|xls|zip)$/i;
const CODE_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
const clean = (v, n = 500) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const cleanCode = v => String(v || "").trim().toLowerCase();

// ── partner codes ─────────────────────────────────────────────────────────────
async function partnerByCode(query, code) {
  const c = cleanCode(code);
  if (!CODE_RE.test(c)) return null;
  const [p] = await query(`SELECT code, name, market FROM partners WHERE code = ? AND deleted_at IS NULL`, [c]);
  return p || null;
}

async function listPartners(query) {
  return query(`SELECT p.code, p.name, p.market, p.created_at, p.created_by_name,
                       (SELECT COUNT(*)::int FROM sales_bookings b WHERE b.partner_code = p.code) AS bookings
                  FROM partners p WHERE p.deleted_at IS NULL ORDER BY p.market, p.name`);
}

async function savePartner(ctx, b, who) {
  const code = cleanCode(b.code), name = clean(b.name, 120), market = clean(b.market, 120);
  if (!CODE_RE.test(code)) return { error: "invalid", field: "code", message: "A code is 2 to 40 lowercase letters, numbers or dashes, like mi-gulf-coast." };
  if (!name) return { error: "invalid", field: "name", message: "Name the partner, as the page should show it." };
  if (!market) return { error: "invalid", field: "market", message: "Name the market, like Gulf Coast." };
  const [had] = await ctx.query(`SELECT code, deleted_at FROM partners WHERE code = ?`, [code]);
  if (had && !had.deleted_at) return { error: "taken", field: "code", message: `The code ${code} is already in use.` };
  if (had) await ctx.run(`UPDATE partners SET name = ?, market = ?, deleted_at = NULL WHERE code = ?`, [name, market, code]);
  else await ctx.run(`INSERT INTO partners (code, name, market, created_by, created_by_name) VALUES (?, ?, ?, ?, ?)`, [code, name, market, who.id, who.name]);
  return { ok: true, code, link: `/book?partner=${code}` };
}

async function removePartner(ctx, code) {
  const r = await ctx.run(`UPDATE partners SET deleted_at = NOW() WHERE code = ? AND deleted_at IS NULL`, [cleanCode(code)]);
  return r.changes ? { ok: true } : { error: "not_found" };
}

// ── the form ──────────────────────────────────────────────────────────────────
function readFile(f) {
  if (!f || !f.data) return { file: null };
  const name = clean(f.name, 200);
  if (!FILE_TYPES.test(name)) return { error: "invalid", field: "file", message: "Send a spreadsheet: CSV, Excel (.xlsx or .xls), a text export or a .zip of them." };
  const buf = Buffer.from(String(f.data).replace(/^data:[^,]*,/, ""), "base64");
  if (!buf.length) return { error: "invalid", field: "file", message: "That file was empty. Choose it again, or bring it to the call." };
  if (buf.length > MAX_FILE_BYTES) return { error: "too_large", field: "file", message: "That file is over 3 MB. Book the call without it and bring it with you; we'll load it together." };
  return { file: { name, type: clean(f.type, 100) || "application/octet-stream", size: buf.length, data: buf } };
}

function answersNote(v, partner) {
  return [
    partner ? `Recommended by ${partner.name} (${partner.market} market).` : null,
    `Phone: ${v.phone || "not given"}.`,
    `Uses for donors today: ${v.currentSystem || "not given"}.`,
    `Donors: ${v.donorCount}.`,
    `What would make this worth it: ${v.worthIt || "not given"}.`,
    v.file ? `Sent a file: ${v.file.name} (${Math.max(1, Math.round(v.file.size / 1024))} KB). It waits for onboarding.` : "No file sent.",
  ].filter(Boolean).join(" ");
}

// b: { name, orgName, email, phone, currentSystem, donorCount, worthIt, partner, file: { name, type, data(base64) }, website (honeypot) }
async function submit(ctx, b, meta = {}) {
  b = b || {};
  if (clean(b.website)) return { ok: true, honeypot: true };   // a bot filled the hidden field: the same answer, nothing kept
  const v = {
    name: clean(b.name, 120), orgName: clean(b.orgName, 200), email: clean(b.email, 200).toLowerCase(), phone: clean(b.phone, 40),
    currentSystem: clean(b.currentSystem, 300), donorCount: DONOR_COUNTS.includes(b.donorCount) ? b.donorCount : "Not sure",
    worthIt: String(b.worthIt == null ? "" : b.worthIt).trim().slice(0, 2000),
  };
  if (!v.name) return { error: "invalid", field: "name", message: "Your name, please." };
  if (!v.orgName) return { error: "invalid", field: "orgName", message: "Your organization's name, please." };
  if (!EMAIL_SHAPE.test(v.email)) return { error: "invalid", field: "email", message: "A work email we can reach you at, please." };
  const f = readFile(b.file);
  if (f.error) return f;
  v.file = f.file;
  const partner = await partnerByCode(ctx.query, b.partner);

  const id = newId("sbk");
  await ctx.run(`INSERT INTO sales_bookings (id, name, org_name, email, phone, current_system, donor_count, worth_it, partner_code,
                   file_name, file_type, file_size, file_data, ip, created_by, created_by_name)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, v.name, v.orgName, v.email, v.phone || null, v.currentSystem || null, v.donorCount, v.worthIt || null, partner ? partner.code : null,
     v.file ? v.file.name : null, v.file ? v.file.type : null, v.file ? v.file.size : null, v.file ? v.file.data : null,
     String(meta.ip || "").slice(0, 60) || null, SYSTEM.id, SYSTEM.name]);

  const r = await INBOUND.note(ctx, { source: "booking", name: v.name, email: v.email, phone: v.phone, orgName: v.orgName,
    note: answersNote(v, partner), task: `Booked a call from the website: ${v.name}, ${v.orgName}. Read their answers before the call.` }, SYSTEM);
  if (r.error) return r;
  if (partner && PLANT !== "nopartner") await ctx.run(`UPDATE sales_deals SET partner_code = ? WHERE id = ?`, [partner.code, r.dealId]);
  await ctx.run(`UPDATE sales_bookings SET sales_deal_id = ?, sales_org_id = ?, sales_contact_id = ? WHERE id = ?`, [r.dealId, r.orgId, r.contactId, id]);
  return { ok: true, id, dealId: r.dealId, partner: partner ? partner.name : null };
}

// The deal page's panel: the answers as she gave them, the partner and market, and the file.
async function forDeal(query, dealId) {
  const rows = await query(`SELECT b.id, b.created_at, b.name, b.org_name, b.email, b.phone, b.current_system, b.donor_count, b.worth_it,
                                   b.file_name, b.file_size, p.code AS partner_code, p.name AS partner_name, p.market
                              FROM sales_bookings b LEFT JOIN partners p ON p.code = b.partner_code
                             WHERE b.sales_deal_id = ? ORDER BY b.created_at DESC`, [dealId]);
  const [d] = await query(`SELECT d.partner_code, p.name AS partner_name, p.market FROM sales_deals d LEFT JOIN partners p ON p.code = d.partner_code WHERE d.id = ?`, [dealId]);
  return { bookings: rows, partner: d && d.partner_code ? { code: d.partner_code, name: d.partner_name, market: d.market } : null };
}

async function fileOf(query, id) {
  const [f] = await query(`SELECT file_name, file_type, file_data FROM sales_bookings WHERE id = ? AND file_data IS NOT NULL`, [id]);
  return f || null;
}

module.exports = { submit, partnerByCode, listPartners, savePartner, removePartner, forDeal, fileOf, DONOR_COUNTS, MAX_FILE_BYTES, PLANT };
