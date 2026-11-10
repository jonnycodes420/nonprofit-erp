// server/onboard/verifyRoutes.js · ONBOARD-1 Stage 2. STAGE, VERIFY, ACCEPT.
//
//   GET  /onboard/preview-eligible    may this org stage a file? (first file only)
//   GET  /imports/:id/verify          the footing, the funds, the 10-donor spot check
//   POST /imports/:id/accept          "These match, make it live" (who and when; a
//                                     super-admin acting for the customer types a reason)
//   POST /imports/:id/flag            "Something's off": a note to Jonathan, on the record
//   GET  /admin/onboard/flags         super-admin: every open note, newest first
"use strict";
const express = require("express");
const ST = require("./staging");
const V = require("./verify");
const { MONEY_CENTS, MONEY } = require("../../shared/numbers/money");
const { LIFETIME } = require("../../shared/numbers/lifetime");
const { GIFT_COUNT } = require("../../shared/numbers/giftCount");
const { LAST_DATE } = require("../../shared/numbers/lastGift");

const routers = { r1: express.Router() };
const REASON_MIN = 10;

function mount(ctx) {
  const { query, run, wrap, requireAuth, requireAdmin, requireSuperAdmin } = ctx;
  const app = routers.r1;
  const parse = v => (v == null ? {} : typeof v === "string" ? JSON.parse(v) : v);
  const actingForCustomer = req => !!(req.user && (req.user.isSuperAdmin || req.user.support));
  async function nameOf(req) {
    const [u] = await query(`SELECT name, email FROM users WHERE id=?`, [req.user.userId]);
    return (u && (u.name || u.email)) || req.user.email || "Steward";
  }
  async function importRow(req) {
    const [r] = await query(`SELECT * FROM imports WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
    return r || null;
  }
  const stateOf = r => (r.undone_at ? "undone" : r.accepted_at ? "accepted" : r.staged_at ? "staged" : "live");

  app.get("/onboard/preview-eligible", requireAuth, wrap(async (req, res) => {
    res.json(await ST.previewEligible(query, req.user.orgId));
  }));

  app.get("/imports/:id/verify", requireAuth, wrap(async (req, res) => {
    const r = await importRow(req);
    if (!r) return res.status(404).json({ error: "import_not_found" });
    const summary = parse(r.summary_json);
    const file = summary.moveFile || null;
    const vf = summary.verifyFile || {};
    const held = await ST.heldFacts(query, req.user.orgId, r.id, MONEY_CENTS, MONEY);
    // A spreadsheet import (the one reader since HARDEN-1) stored its own file
    // figures and gaps (sheetVerify.js); the older mapper stored moveFile and
    // its reconciliation.
    const sheet = vf.source === "sheet";
    const fileFacts = sheet ? { people: vf.people, gifts: vf.gifts, cents: vf.fileGiftCents, byYear: vf.byYear, byFund: vf.byFund }
      : file ? { ...file, byFund: vf.byFund || null } : { byFund: vf.byFund || null };
    const side = V.lines({ file: fileFacts, held: sheet ? { ...held, people: held.peopleAll } : held });
    const money = sheet ? V.moneyFootingFromGaps({ fileCents: vf.fileCents, gaps: vf.gaps, heldCents: held.cents })
      : V.moneyFooting({ reconciliation: summary.reconciliation, refusedRows: summary.refusedRows || [], heldCents: held.cents });
    const spotKeys = (vf.spot || []).map(s => s.key).filter(Boolean);
    const heldByKey = sheet ? await ST.heldForIds(query, req.user.orgId, r.id, spotKeys, { LIFETIME, GIFT_COUNT, LAST_DATE })
      : await ST.heldForKeys(query, req.user.orgId, r.id, spotKeys, { LIFETIME, GIFT_COUNT, LAST_DATE });
    const spot = V.spotCheck({ fileSpot: vf.spot || [], heldByKey });
    res.json({
      import: { id: r.id, name: r.name, sourceFilename: r.source_filename, committedAt: r.committed_at, by: r.actor_user_name,
        state: stateOf(r), stagedAt: r.staged_at, acceptedAt: r.accepted_at, acceptedByName: r.accepted_by_name,
        acceptReason: r.accept_reason, acceptedOnBehalf: !!r.accepted_on_behalf,
        flaggedAt: r.flagged_at, flaggedByName: r.flagged_by_name, flagNote: r.flag_note },
      money, lines: side.lines, byYear: side.byYear,
      funds: vf.byFund ? side.funds : null,
      fundsUnavailable: vf.byFund ? null : "This file was imported before Steward kept its funds, so there is no file side to compare.",
      spot,
      spotUnavailable: (vf.spot || []).length ? null : "This file was imported before Steward kept a sample of its rows, so there is no spot check.",
      canAccept: stateOf(r) === "staged",
      reasonRequired: actingForCustomer(req),
      sentences: {
        money: "Your file's total is every row in it, read once when the file was opened. In Steward is what this import holds, to the cent.",
        spot: "Ten donors picked at random from the file when it was imported: the file's own rows for each, beside their lifetime, last gift and gift count in Steward.",
      },
    });
  }));

  app.post("/imports/:id/accept", requireAuth, requireAdmin, wrap(async (req, res) => {
    const r = await importRow(req);
    if (!r) return res.status(404).json({ error: "import_not_found" });
    if (stateOf(r) !== "staged") return res.status(409).json({ error: "not_staged", message: r.accepted_at ? "This import is already live." : "Only a staged import can be made live." });
    const onBehalf = actingForCustomer(req);
    const reason = String((req.body || {}).reason || "").trim().slice(0, 1000);
    if (onBehalf && reason.length < REASON_MIN) {
      return res.status(400).json({ error: "reason_required",
        message: "You are making this live for the customer. Type why (at least 10 characters); it is shown on the record." });
    }
    const byName = await nameOf(req);
    const ids = await ST.acceptImport({ query, run }, req.user.orgId, r.id, { by: req.user.userId, byName, reason: onBehalf ? reason : null, onBehalf });
    // LIVE-1: after any write to a person, the one after-change step.
    if (ids.length) await require("../../afterChange").afterChange(req.user.orgId, ids, { door: "csv_import" })
      .catch(e => console.error("[onboard] after-change on accept:", e.message));
    // MAIL-1's "first real donor file" and Data health run now, on live rows.
    await require("../../onboarded").stampOnboardedFromImport(query, req.user.orgId, r.id).catch(() => {});
    try { require("../../routes/dataHealth").afterImport(req.user.orgId, r.id); } catch (e) { console.error("[onboard] data health:", e.message); }
    if (req.audit) req.audit.summary = `${byName} made import "${r.name}" live (${ids.length} people)` + (onBehalf ? ` on the customer's behalf: ${reason}` : "");
    res.json({ ok: true, people: ids.length,
      sentence: `Live. ${ids.length.toLocaleString("en-US")} ${ids.length === 1 ? "person is" : "people are"} now in every count and list. Made live by ${byName}${onBehalf ? `, for the customer, because: ${reason}` : ""}.` });
  }));

  app.post("/imports/:id/flag", requireAuth, requireAdmin, wrap(async (req, res) => {
    const r = await importRow(req);
    if (!r) return res.status(404).json({ error: "import_not_found" });
    const note = String((req.body || {}).note || "").trim().slice(0, 4000);
    if (note.length < 3) return res.status(400).json({ error: "note_required", message: "Say what looks off, so Jonathan can find it." });
    const byName = await nameOf(req);
    await run(`UPDATE imports SET flagged_at=NOW(), flagged_by=?, flagged_by_name=?, flag_note=? WHERE id=? AND org_id=?`,
      [req.user.userId, byName, note, r.id, req.user.orgId]);
    if (req.audit) req.audit.summary = `${byName} said something is off with import "${r.name}"`;
    res.json({ ok: true, sentence: "Sent to Jonathan. The file stays hidden until it is made live, and you can still Undo it." });
  }));

  app.get("/admin/onboard/flags", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
    const rows = await query(`SELECT i.id, i.org_id, o.name AS org_name, i.name, i.flagged_at, i.flagged_by_name, i.flag_note, i.staged_at, i.accepted_at
        FROM imports i JOIN orgs o ON o.id = i.org_id WHERE i.flagged_at IS NOT NULL AND i.undone_at IS NULL ORDER BY i.flagged_at DESC LIMIT 200`, []);
    res.json({ flags: rows });
  }));
}

module.exports = { routers, mount };
