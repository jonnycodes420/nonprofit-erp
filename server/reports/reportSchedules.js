// server/reports/reportSchedules.js · REPORTS-6 item 1. A SCHEDULED REPORT REACHES PEOPLE WITH NO STEWARD SEAT.
//
// A saved report, the board pack or the board deck, weekly, monthly or
// quarterly on the org's day and hour, to the addresses an admin typed in
// (users or not). Each email carries the report AS A PDF, dated and with its
// definitions; nothing in the email needs a login and no link in it opens org
// data. The one link is Unsubscribe, which opens a page that names the report
// and changes nothing until its button is pressed (a GET never changes state).
//
// STAFF MAIL, with three walls, checked here and again inside the wrapped
// Resend client (kind `report_schedule`, mailPolicy.js KIND_CATEGORY):
//   · the org's Staff mail switch: off, nothing is reserved and nothing goes;
//   · mailBlock.js: an address on it is never mailed, from any org;
//   · the recipient's own Unsubscribe for this schedule (report_schedule_unsubs).
// And the board pack's rule: an address on file as a person who is not marked
// staff or board is refused when the schedule is saved and held at send.
//
// The ledger (report_schedule_sends) is reserved before the first email and
// released when nothing was accepted, so a period goes once and a failed run
// goes again on the next tick (the digest_sends discipline). Each send row
// names who it went to and who it did not, with the reason.
"use strict";
const express = require("express");
const R = require("./scheduleRules");
const { renderReportPdf, pdfFilename } = require("./reportPdf");
const { newId } = require("../shared/newId");
const { orgMailDecision } = require("../../mailPolicy");

const routers = { r1: express.Router() };
const SYSTEM = { id: "system:report-schedules", name: "Scheduled reports" };
const KIND = "report_schedule";
const BOARD_PACK = "board-pack", BOARD_DECK = "board-deck";
const isReportTarget = t => /^report:(std:[a-z0-9-]+|[A-Za-z0-9_-]{1,64})$/.test(String(t || ""));
const validTarget = t => t === BOARD_PACK || t === BOARD_DECK || isReportTarget(t);
// The board pack reports on the last COMPLETE month or quarter (shared/boardPack.js), so it is not weekly.
const FREQ_OF_TARGET = t => (t === BOARD_PACK ? ["monthly", "quarterly"] : R.FREQUENCIES);

let hooks = null;   // filled by mount: the one runner the 5-minute tick calls

function mount(ctx) {
  const { actor, asJson, brandEmailHeaderHtml, checkWriteAccess, composeBoardPack, crypto, escapeHtml, isBlockedAddress,
    orgTime, orgToday, orgTz, publicAppUrl, query, rbFormatCell, reportHooks, requireAdmin, requireAuth, resend, run,
    runSaved, savedReportFor, wrap } = ctx;
  const UNSUB_SECRET = ctx.UNSUB_SECRET || process.env.JWT_SECRET || "nonprofit_erp_secret_dev";   // the /unsubscribe token's own key (steps-2)
  const app = routers.r1;

  const shape = (s, clock, sentThisPeriod = false) => ({
    id: s.id, target: s.target, targetName: s.target_name, frequency: s.frequency, day: s.day, hour: s.hour,
    recipients: asJson(s.recipients, []), enabled: s.enabled, lastSentAt: s.last_sent_at,
    cadence: R.cadenceWords(s), nextSend: R.nextSend(s, clock, { sentThisPeriod }),
    nextSendSentence: R.nextSendSentence(s, clock, { sentThisPeriod }),
    createdByName: s.created_by_name || "",
  });
  const clockOf = async orgId => orgTime.orgClock(await orgTz(orgId));

  // ── WHAT IS ATTACHED: one builder for the preview and the send ────────────
  async function buildAttachment(orgId, target, { userId, frequency }) {
    const DD = await import("../../shared/displayDate.js");
    const [org] = await query("SELECT id, name, logo_data FROM orgs WHERE id=?", [orgId]);
    const today = orgToday(await orgTz(orgId));   // ORG_TZ_SEAM_OK
    if (target === BOARD_PACK) {
      const pack = await composeBoardPack(orgId, { userId, frequency: frequency === "quarterly" ? "quarterly" : "monthly" });
      if (!pack) return { error: "The board pack could not be made." };
      return { title: pack.title, period: pack.period.label, pdf: await reportHooks.renderBoardPackPdf(pack), filename: reportHooks.boardPackFilename(pack) };
    }
    if (target === BOARD_DECK) {
      const deck = await reportHooks.composeBoardDeck(orgId, { isTeam: await reportHooks.boardDeckIsTeam(orgId) });
      return { title: "Board deck", period: `as of ${deck.asOfLabel}`, pdf: await reportHooks.renderBoardDeckPdf(deck), filename: reportHooks.boardDeckFilename(deck) };
    }
    const id = String(target).slice("report:".length);
    const rep = await savedReportFor(orgId, userId, id);
    if (!rep) return { error: "That report is not one this schedule's owner can open any more." };
    const RB = await import("../../shared/reportBuilder.js");
    if (RB.usesWealth(rep.def) && !(await require("../wealth/access").maySee(userId, orgId))) {
      return { error: "This report reads Wealth Scores, and the person who scheduled it can no longer see them." };
    }
    const out = await runSaved(orgId, rep, { all: true });
    if (out.errors) return { error: out.errors.join(" ") };
    const producedOnLabel = DD.displayDate(today);
    const pdf = await renderReportPdf({ title: rep.name, question: rep.question, orgName: org.name, logo: org.logo_data,
      producedOnLabel, columns: out.columns, rows: out.rows, totals: out.totals, capped: out.capped,
      definitions: rep.question ? [{ label: rep.name, definition: `The question this report answers: ${rep.question}` }] : [] }, rbFormatCell);
    return { title: rep.name, period: `produced ${producedOnLabel}`, pdf, filename: pdfFilename(rep.name, today) };
  }
  reportHooks.renderSavedReportPdf = async (orgId, userId, rep, opts = {}) => {
    const DD = await import("../../shared/displayDate.js");
    const [org] = await query("SELECT id, name, logo_data FROM orgs WHERE id=?", [orgId]);
    const out = await runSaved(orgId, rep, { ...opts, all: true });
    if (out.errors) return { errors: out.errors };
    const today = orgToday(await orgTz(orgId));   // ORG_TZ_SEAM_OK
    return { pdf: await renderReportPdf({ title: rep.name, question: rep.question, orgName: org.name, logo: org.logo_data,
      producedOnLabel: DD.displayDate(today), columns: out.columns, rows: out.rows, totals: out.totals, capped: out.capped,
      definitions: rep.question ? [{ label: rep.name, definition: `The question this report answers: ${rep.question}` }] : [] }, rbFormatCell),
      filename: pdfFilename(rep.name, today) };
  };

  async function targetName(orgId, userId, target) {
    if (target === BOARD_PACK) return "Board pack";
    if (target === BOARD_DECK) return "Board deck";
    const rep = await savedReportFor(orgId, userId, String(target).slice("report:".length));
    return rep ? rep.name : null;
  }

  // People on file under that address who are not marked staff or board.
  async function donorAddresses(orgId, emails) {
    if (!emails.length) return new Set();
    const rows = await query(
      `SELECT DISTINCT LOWER(email) AS e FROM donors
        WHERE org_id = ? AND deleted_at IS NULL AND email IS NOT NULL AND LOWER(email) = ANY(?::text[])
          AND NOT (COALESCE(person_types, '["donor"]'::jsonb) @> '["staff_board"]'::jsonb)`, [orgId, emails]);
    return new Set(rows.map(r => r.e));
  }
  async function refuseRecipients(orgId, emails) {
    for (const e of emails) if (isBlockedAddress(e)) return `Steward does not send to ${e}.`;
    const donors = await donorAddresses(orgId, emails);
    if (donors.size) return `${[...donors][0]} is on file as a donor. A scheduled report goes to your staff and board, never to a donor. Mark them as staff or board on their record first.`;
    return null;
  }

  function unsubscribeUrl(email, orgId, scheduleId) {
    const payload = Buffer.from(JSON.stringify({ email, orgId, staff: KIND, scheduleId })).toString("base64url");
    const sig = crypto.createHmac("sha256", UNSUB_SECRET).update(payload).digest("base64url");
    return `${publicAppUrl()}/unsubscribe?token=${payload}.${sig}`;
  }
  function emailHtml(orgName, a, s, unsubUrl) {
    return `<div style="font-family:Arial,sans-serif;color:#0f1a12">
      <p style="font-size:15px"><strong>${escapeHtml(a.title)}</strong> from ${escapeHtml(orgName)} is attached, ${escapeHtml(a.period)}.</p>
      <p style="font-size:13px;color:#5a554f">It is a PDF: open it, print it or forward it. Every number in it is defined at the end. Nothing in this email needs a login.</p>
      <p style="font-size:13px;color:#5a554f">${escapeHtml(s.created_by_name || "Someone at " + orgName)} put you on this schedule: ${escapeHtml(R.cadenceWords(s).toLowerCase())}.</p>
      <p style="font-size:12px;color:#8fa896;margin-top:24px"><a href="${unsubUrl}" style="color:#8fa896">Stop getting ${escapeHtml(a.title)}</a></p>
    </div>`;
  }
  // TRUE only when the provider accepted it (FIX-15 Part 3's honest "sent").
  async function sendOne(org, to, subject, html, a, unsubUrl) {
    if (isBlockedAddress(to)) return false;
    const from = process.env.DEMO_SMTP_FROM || "noreply@stewardapp.dev";
    if (!process.env.RESEND_API_KEY) return true;   // email not configured: nothing to deliver
    try {
      const { error } = await resend.emails.send({
        from, to, subject, html: (await brandEmailHeaderHtml(org.id)) + html, _stewardOrgId: org.id, _stewardKind: KIND,
        headers: { "List-Unsubscribe": `<${unsubUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
        attachments: [{ filename: a.filename, content: a.pdf.toString("base64") }],
      });
      if (error) { console.error("[report-schedule] email error:", error.message); return false; }
      return true;
    } catch (e) { console.error("[report-schedule] email threw:", e.message); return false; }
  }

  // ── ONE SCHEDULE, ONE PERIOD ──────────────────────────────────────────────
  async function runSchedule(org, s, { clock, force = false }) {
    if (!force && !R.isDue(s, clock)) return { id: s.id, sent: 0, reason: "not due" };
    const [orgRow] = await query("SELECT * FROM orgs WHERE id=?", [org.id]);
    const decision = orgMailDecision(orgRow, "staff", KIND);
    if (!decision.send) return { id: s.id, sent: 0, reason: decision.reason };   // nothing reserved: it goes when mail is on
    const periodKey = R.periodKey(s, clock.date);
    const reserved = await query(
      `INSERT INTO report_schedule_sends (id, org_id, schedule_id, period_key, title, created_by, created_by_name)
       VALUES (?,?,?,?,?,?,?) ON CONFLICT (schedule_id, period_key) DO NOTHING RETURNING id`,
      [newId("rss"), org.id, s.id, periodKey, s.target_name, SYSTEM.id, SYSTEM.name]);
    if (!reserved.length) return { id: s.id, sent: 0, reason: "already sent for this period" };
    const release = async reason => { await run("DELETE FROM report_schedule_sends WHERE id=?", [reserved[0].id]); return { id: s.id, sent: 0, reason }; };
    const recipients = asJson(s.recipients, []).map(e => String(e).toLowerCase());
    const unsubs = new Set((await query(`SELECT email FROM report_schedule_unsubs WHERE schedule_id=? AND org_id=?`, [s.id, org.id])).map(r => r.email));
    const donors = await donorAddresses(org.id, recipients);
    const held = [], go = [];
    for (const e of recipients) {
      if (unsubs.has(e)) held.push({ email: e, reason: "unsubscribed" });
      else if (isBlockedAddress(e)) held.push({ email: e, reason: "on the mail block" });
      else if (donors.has(e)) held.push({ email: e, reason: "on file as a donor" });
      else go.push(e);
    }
    if (!go.length) return release("nobody to send to");
    const a = await buildAttachment(org.id, s.target, { userId: s.created_by, frequency: s.frequency });
    if (a.error) return release(a.error);
    const sentTo = [];
    for (const e of go) {
      const url = unsubscribeUrl(e, org.id, s.id);
      if (await sendOne(org, e, `${a.title} · ${a.period}`, emailHtml(org.name, a, s, url), a, url)) sentTo.push(e);
      else held.push({ email: e, reason: "the mail provider did not accept it" });
    }
    if (!sentTo.length) return release("nothing was accepted");
    await run(`UPDATE report_schedule_sends SET sent_to=?::jsonb, held=?::jsonb WHERE id=?`, [JSON.stringify(sentTo), JSON.stringify(held), reserved[0].id]);
    await run(`UPDATE report_schedules SET last_sent_at=NOW() WHERE id=?`, [s.id]);
    return { id: s.id, sent: sentTo.length, sentTo, held, periodKey };
  }

  async function runReportSchedulesForOrg(org, { clock, force = false, scheduleId = null } = {}) {
    const rows = await query(
      `SELECT * FROM report_schedules WHERE org_id=? AND enabled = true AND deleted_at IS NULL${scheduleId ? " AND id=?" : ""} ORDER BY created_at`,
      scheduleId ? [org.id, scheduleId] : [org.id]);
    const out = [];
    for (const s of rows) out.push(await runSchedule(org, s, { clock, force }));
    return { schedules: out, sent: out.reduce((n, r) => n + r.sent, 0) };
  }
  hooks = { runReportSchedulesForOrg };

  // ── THE SCREEN'S ROUTES ───────────────────────────────────────────────────
  const scheduleOf = async (orgId, id) => (await query(`SELECT * FROM report_schedules WHERE id=? AND org_id=? AND deleted_at IS NULL`, [id, orgId]))[0] || null;
  const sentThisPeriodOf = async (s, clock) => (await query(`SELECT 1 FROM report_schedule_sends WHERE schedule_id=? AND period_key=?`,
    [s.id, R.periodKey(s, clock.date)])).length > 0;

  app.get("/report-schedules", requireAuth, wrap(async (req, res) => {
    const target = String(req.query.target || "");
    if (target && !validTarget(target)) return res.status(400).json({ error: "Unknown report." });
    const clock = await clockOf(req.user.orgId);
    const rows = await query(`SELECT * FROM report_schedules WHERE org_id=? AND deleted_at IS NULL${target ? " AND target=?" : ""} ORDER BY created_at`,
      target ? [req.user.orgId, target] : [req.user.orgId]);
    const ids = rows.map(r => r.id);
    const sends = ids.length ? await query(`SELECT schedule_id, period_key, sent_to, held, created_at FROM report_schedule_sends
       WHERE org_id=? AND schedule_id = ANY(?::text[]) ORDER BY created_at DESC LIMIT 60`, [req.user.orgId, ids]) : [];
    const out = [];
    for (const s of rows) {
      const mine = sends.filter(x => x.schedule_id === s.id);
      out.push({ ...shape(s, clock, mine.some(x => x.period_key === R.periodKey(s, clock.date))),
        sends: mine.slice(0, 6).map(x => ({ periodKey: x.period_key, at: x.created_at, sentTo: asJson(x.sent_to, []), held: asJson(x.held, []) })) });
    }
    const [orgRow] = await query("SELECT * FROM orgs WHERE id=?", [req.user.orgId]);
    const d = orgMailDecision(orgRow, "staff", KIND);
    res.json({ schedules: out, frequencies: target ? FREQ_OF_TARGET(target) : R.FREQUENCIES, dayMin: R.DAY_MIN, dayMax: R.DAY_MAX,
      weekdays: R.WEEKDAYS, today: clock.date,
      staffMailOff: d.send ? null : "Staff mail is off for your organization, so nothing scheduled is sent until it is turned on." });
  }));

  async function readBody(req, res, existing = null) {
    const b = req.body || {};
    const target = existing ? existing.target : String(b.target || "");
    if (!validTarget(target)) { res.status(400).json({ error: "Unknown report." }); return null; }
    const v = R.validateSchedule({ ...b, frequency: b.frequency ?? (existing && existing.frequency), day: b.day ?? (existing && existing.day),
      hour: b.hour ?? (existing && existing.hour), recipients: b.recipients ?? (existing && asJson(existing.recipients, [])) });
    if (v.ok && !FREQ_OF_TARGET(target).includes(v.value.frequency)) v.errors.push("The board pack goes monthly or quarterly: it reports on the last whole month or quarter.");
    if (v.errors.length) { res.status(400).json({ error: v.errors.join(" "), errors: v.errors }); return null; }
    const refused = await refuseRecipients(req.user.orgId, v.value.recipients);
    if (refused) { res.status(400).json({ error: refused }); return null; }
    const name = await targetName(req.user.orgId, req.user.userId, target);
    if (!name) { res.status(400).json({ error: "That report is not one you can open." }); return null; }
    return { target, name, ...v.value };
  }

  app.post("/report-schedules", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
    const v = await readBody(req, res);
    if (!v) return;
    const id = newId("rsc"), a = actor(req);
    await run(`INSERT INTO report_schedules (id, org_id, target, target_name, frequency, day, hour, recipients, enabled, created_by, created_by_name)
               VALUES (?,?,?,?,?,?,?,?::jsonb,?,?,?)`,
      [id, req.user.orgId, v.target, v.name, v.frequency, v.day, v.hour, JSON.stringify(v.recipients), v.enabled, a.id, a.name]);
    if (req.audit) { req.audit.entity("report_schedule", id, v.name); req.audit.summary(`Scheduled ${v.name} to ${v.recipients.length} ${v.recipients.length === 1 ? "person" : "people"}.`); }
    res.status(201).json(shape(await scheduleOf(req.user.orgId, id), await clockOf(req.user.orgId)));
  }));

  app.put("/report-schedules/:id", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
    const s = await scheduleOf(req.user.orgId, req.params.id);
    if (!s) return res.status(404).json({ error: "Not found" });
    const v = await readBody(req, res, s);
    if (!v) return;
    await run(`UPDATE report_schedules SET frequency=?, day=?, hour=?, recipients=?::jsonb, enabled=?, target_name=?, updated_at=NOW() WHERE id=? AND org_id=?`,
      [v.frequency, v.day, v.hour, JSON.stringify(v.recipients), v.enabled, v.name, s.id, req.user.orgId]);
    const clock = await clockOf(req.user.orgId);
    const s2 = await scheduleOf(req.user.orgId, s.id);
    res.json(shape(s2, clock, await sentThisPeriodOf(s2, clock)));
  }));

  // Remove, with Undo: the row is kept (deleted_at) so the Undo puts back exactly what was there.
  app.delete("/report-schedules/:id", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
    const s = await scheduleOf(req.user.orgId, req.params.id);
    if (!s) return res.status(404).json({ error: "Not found" });
    await run(`UPDATE report_schedules SET deleted_at=NOW(), updated_at=NOW() WHERE id=? AND org_id=?`, [s.id, req.user.orgId]);
    res.json({ removed: s.id, message: `${s.target_name} will not be sent on this schedule.`,
      undo: { label: "Undo", path: `/report-schedules/${encodeURIComponent(s.id)}/restore`, body: {} } });
  }));
  app.post("/report-schedules/:id/restore", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
    const r = await run(`UPDATE report_schedules SET deleted_at=NULL, updated_at=NOW() WHERE id=? AND org_id=? AND deleted_at IS NOT NULL`, [req.params.id, req.user.orgId]);
    if (!r.changes) return res.status(404).json({ error: "Not found" });
    res.json(shape(await scheduleOf(req.user.orgId, req.params.id), await clockOf(req.user.orgId)));
  }));

  // THE PREVIEW IS THE EXACT PDF: the same builder the send attaches. A GET; it writes nothing.
  const sendPdf = (res, a) => {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${a.filename}"`);
    res.setHeader("Content-Length", a.pdf.length);
    res.end(a.pdf);
  };
  app.get("/report-schedules/preview.pdf", requireAuth, wrap(async (req, res) => {
    const target = String(req.query.target || "");
    if (!validTarget(target)) return res.status(400).json({ error: "Unknown report." });
    const a = await buildAttachment(req.user.orgId, target, { userId: req.user.userId, frequency: String(req.query.frequency || "monthly") });
    if (a.error) return res.status(400).json({ error: a.error });
    sendPdf(res, a);
  }));
  app.get("/report-schedules/:id/preview.pdf", requireAuth, wrap(async (req, res) => {
    const s = await scheduleOf(req.user.orgId, req.params.id);
    if (!s) return res.status(404).json({ error: "Not found" });
    const a = await buildAttachment(req.user.orgId, s.target, { userId: s.created_by, frequency: s.frequency });
    if (a.error) return res.status(400).json({ error: a.error });
    sendPdf(res, a);
  }));

  // Ops/test hook: drive the exact scheduled path for the caller's org, at a pinned clock.
  app.post("/report-schedules/run", requireAuth, requireAdmin, wrap(async (req, res) => {
    const b = req.body || {};
    const [org] = await query("SELECT id, name, timezone FROM orgs WHERE id=?", [req.user.orgId]);
    const now = await clockOf(req.user.orgId);
    const clock = { date: /^\d{4}-\d{2}-\d{2}$/.test(String(b.today || "")) ? b.today : now.date,
      hour: Number.isInteger(b.hour) ? b.hour : now.hour };
    res.json(await runReportSchedulesForOrg(org, { clock, force: b.force === true, scheduleId: b.scheduleId ? String(b.scheduleId) : null }));
  }));

  // THE UNSUBSCRIBE (routes/webhooks.js /unsubscribe hands a report_schedule token here).
  // GET names the report and writes nothing; POST stops that one schedule for that one address.
  reportHooks.scheduleUnsubscribe = async (decoded, { post }) => {
    const [s] = await query(`SELECT id, org_id, target_name FROM report_schedules WHERE id=? AND org_id=?`, [String(decoded.scheduleId || ""), decoded.orgId]);
    if (!s) return { ok: false };
    if (post) {
      await run(`INSERT INTO report_schedule_unsubs (org_id, schedule_id, email, created_by, created_by_name) VALUES (?,?,?,?,?)
                 ON CONFLICT (schedule_id, email) DO NOTHING`, [s.org_id, s.id, String(decoded.email).toLowerCase(), `unsubscribe:${String(decoded.email).toLowerCase()}`, "Unsubscribe link"]);
    }
    return { ok: true, title: s.target_name };
  };
}

// The 5-minute tick (routes/jobs.js): every org with an enabled schedule, at its own clock.
async function processReportSchedules({ query, orgTime }) {
  if (!hooks) return;
  const orgs = await query(`SELECT DISTINCT o.id, o.name, o.timezone FROM orgs o JOIN report_schedules s ON s.org_id = o.id
                             WHERE s.enabled = true AND s.deleted_at IS NULL`);
  for (const org of orgs) {
    try { await hooks.runReportSchedulesForOrg(org, { clock: orgTime.orgClock(org) }); }
    catch (e) { console.error("[report-schedules]", org.id, e.message); }
  }
}

module.exports = { routers, mount, processReportSchedules, KIND };
