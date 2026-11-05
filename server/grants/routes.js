// server/grants/routes.js — grants: the list, award and decline, milestones and deadlines, documents, spend, restricted money, import and the report outline.
//
// SPLIT-1: moved VERBATIM from routes/crm.js. Nothing in it changed.
//
// routes/crm.js mounts it: each router below sits inside crm.js's r0 or r1 at the
// place its routes held in the one file, so Express tries them in the same order.
// mount() runs once at the end of boot with server.js's ctx and what the helper
// modules hand back. A relative require() or import() reads from this folder.
// Tests read it through readSource("server.js") (scripts/lib/readSource.js).
const express = require("express");
const { newId } = require("../shared/newId");   // IDS-1: every new row id is prefix + 20 hex
// FIX-12 Part 3: the one door to a model (asks the org's AI switch on every call).
const { anthropicFor, requireAi, transcribeAudio, AiOffError, AI_OFF_MESSAGE, recordAiFallback } = require("../../aiClient");
const TL = require("../../timelineLine");
const NUMBERS = require("../../shared/numbers");   // NUMBERS-3 — one home for every giving number
const PW = require("../../pledgeWrite");   // FIX-60: the one writer of a pledge and its installments
const FL = require("./funderLink");   // GRANTS-FIX: the one resolver of a grant's funder

const routers = {
  r1: express.Router(),
};

function mount(ctx) {
const {
  AGENT_MODEL, NOT_YOURS, OU, SYS_AUTO, actor, agentGate, checkWriteAccess, ensureOrgLedger, grantBalanceFrom,
  grantDocRow, grantDocs, grantImportMod, grantMoneyRows, grantMsMod, grantRow, grantShapeMod,
  markMilestoneDone, mayEditLogged, milestoneRow, money, orgFundNamesG, orgLeadDays, orgOfficerNames,
  orgToday, orgTz, parseMoneyOrThrow, processGrantMilestones, putThemeAsset, query, queryTx,
  raiseGrantMilestone, recordAssetPointerHistory, reopenMilestone, requireAdmin, requireAuth, requireCrm,
  restrictedMod, run, runTx, staffWho, testMode, thresholdsMod, toCents, toDollars, uuid, withTransaction,
  wrap, writeAuditLog,
} = ctx;

// ── Grants ─────────────────────────────────────────────────────────────────
// Optional ?search= (lower LIKE on funder/program) + ?limit= for the top-bar
// global search; no params → unchanged full list (plain array either way).
// HARDEN-1g: A GRANT'S RECEIVED IS THE GIFTS THAT PAID ITS AWARD. The legacy
// `grants.received` column is a hand-typed number from before awards were
// paid in instalments; once a grant has an award pledge, the money received
// is the gifts linked to that pledge, the same sum grantMoneyRows and
// /grants/:id/award-plan give. Without this the grant's own profile read
// "$0 of $6,000" while the award plan beside it said $3,000 received.
async function withGrantReceived(orgId, grants) {
  const pledged = grants.filter(g => g && g.award_pledge_id);
  if (!pledged.length) return grants;
  // GIFTS-1: the one received (shared/numbers/pledges GRANT_RECEIVED), and
  // what the funder still owes beside it.
  const sums = await query(
    `SELECT gr.id, ${NUMBERS.pledges.GRANT_RECEIVED("gr")} AS s FROM grants gr WHERE gr.org_id=? AND gr.id = ANY(?::text[])`,
    [orgId, pledged.map(g => g.id)]);
  const by = new Map(sums.map(r => [r.id, money.toCents(r.s) || 0]));
  for (const g of pledged) {
    const rc = by.get(g.id) || 0, ac = money.toCents(g.amount_awarded) || 0;
    g.received = money.toDollars(rc).toFixed(2);
    g.remaining = money.toDollars(Math.max(0, ac - rc)).toFixed(2);
  }
  return grants;
}
let app = routers.r1;

app.get("/grants", requireAuth, wrap(async (req, res) => {
  const where = ["org_id = ?"];
  const params = [req.user.orgId];
  if (req.query.search && String(req.query.search).trim()) {
    const s = "%" + String(req.query.search).trim().toLowerCase() + "%";
    where.push("(lower(funder) LIKE ? OR lower(program) LIKE ?)");
    params.push(s, s);
  }
  let sql = `SELECT * FROM grants WHERE ${where.join(" AND ")} ORDER BY deadline ASC`;
  const limit = parseInt(req.query.limit, 10);
  if (limit > 0) { sql += " LIMIT ?"; params.push(Math.min(limit, 50)); }
  const grants = await withGrantReceived(req.user.orgId, await query(sql, params));
  res.json(grants.map(g => ({ ...g, history: JSON.parse(g.history || "[]") })));
}));

// Finance entity-routing FIX (2026-08-04) — the ONE grant-award → ledger stamp.
// source='grant' (badged in the unified ledger), grant_id + the partial-unique
// uq_fin_txns_grant (db.js) make it idempotent BY CONSTRUCTION: re-award after
// un-award, a redundant awarded→awarded PUT, or a manual row already adopted as
// this grant's stamp (grant_id taken) can never double-insert. Fund matching is
// the original BUILD-09 heuristic (funder/program-named fund, else the first
// unrestricted fund).
async function stampGrantAward(orgId, grantId, funder, program, amount, by = SYS_AUTO) {
  const matchFund = await query(
    "SELECT id FROM fin_funds WHERE org_id=? AND (name ILIKE ? OR name ILIKE ?) LIMIT 1",
    [orgId, `%${funder}%`, `%${program || ""}%`]
  );
  // BUILD-58 W-3: the award stamp resolves its accounts through the ONE
  // ledger helper (grants revenue account, contributions fallback) — a
  // chartless org is provisioned loudly, never a null-account booking.
  const ledgerA = await ensureOrgLedger(orgId, { heal: true });
  const fundId = matchFund[0]?.id || ledgerA.genFundId;
  await run(
    `INSERT INTO fin_transactions (id,org_id,date,description,vendor_donor,amount,type,account_id,fund_id,grant_id,source,created_by,created_by_name)
     VALUES (?,?,?,?,?,?,'income',?,?,?,'grant',?,?)
     ON CONFLICT (grant_id) WHERE grant_id IS NOT NULL DO NOTHING`,
    [newId("ft"), orgId, orgToday(await orgTz(orgId)), // ORG_TZ_SEAM_OK (BUILD-75)
     `Grant awarded: ${funder} · ${program || ""}`, funder,
     parseFloat(amount) || 0, ledgerA.grantAcctId, fundId, grantId, by.id, by.name]
  ).catch(e => console.error("[ledger] grant award stamp failed:", e.message));
}

app.post("/grants", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { funder, program, amount, status, deadline, reportDue, officer, notes } = req.body;
  const campaignId = req.body.campaignId || req.body.campaign_id || null;
  if (!funder) return res.status(400).json({ error: "Funder required" });

  // Attribution FIX — optional campaign link (org-scoped; foreign → 404).
  // The awarded amount counts toward the linked campaign's raised once the
  // grant is AWARDED (awarded_at) — general-operating grants stay unattributed.
  if (campaignId) {
    const camp = await query("SELECT id FROM campaigns WHERE id=? AND org_id=?", [campaignId, req.user.orgId]);
    if (!camp.length) return res.status(404).json({ error: "Campaign not found" });
  }

  // GRANTS-FIX: a grant is never born Awarded. Awarded means money promised,
  // and the promise is written by the award (PUT /grants/:id/award), which
  // puts the pledge on the funder. Add it at the stage before, then award it.
  const GS = await grantShapeMod();
  if (GS.AWARDED_STATUS_KEYS.includes(GS.normalizeStatus(status))) {
    return res.status(400).json({ code: "award_required", error: "award_required",
      sentence: "Add the grant at the stage it was in before the yes, then record the award, so the pledge goes on the funder." });
  }
  // GRANTS-FIX: the funder is resolved through the one resolver (funderLink.js):
  // the organization with exactly that name, else a new one.
  const fl = await FL.resolveGrantFunder({ q: query, r: run }, req.user.orgId, funder, actor(req));

  const id = newId("gr");
  const isAwarded = false;
  await run(
    "INSERT INTO grants (id,org_id,funder,funder_donor_id,program,amount,status,deadline,report_due,officer,notes,campaign_id,awarded_at,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [id, req.user.orgId, funder, fl.donorId, program || "", amount || 0,
     status || "prospecting", deadline || "", reportDue || "", officer || "", notes || "",
     campaignId, isAwarded ? new Date().toISOString() : null, actor(req).id, actor(req).name]
  );
  // A grant created directly IN 'awarded' books its income too (this path
  // previously never stamped the ledger — only the PUT transition did).
  if (isAwarded) await stampGrantAward(req.user.orgId, id, funder, program, amount, actor(req));
  const rows = await query("SELECT * FROM grants WHERE id = ?", [id]);
  res.status(201).json({ ...rows[0], funderLink: { how: fl.how, why: fl.why || null } });
}));

app.put("/grants/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { funder, program, amount, status, deadline, reportDue, officer, notes, description, requirements, adoptTxnId } = req.body;
  if (!funder) return res.status(400).json({ error: "Funder required" });
  const orgId = req.user.orgId;

  // Capture previous status/attribution before update
  const prevRows = await query("SELECT status, campaign_id, awarded_at, funder_donor_id, award_pledge_id FROM grants WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!prevRows.length) return res.status(404).json({ error: "Grant not found" });
  const prevStatus = prevRows[0]?.status;

  // GRANTS-FIX: no status change into an award-holding stage without the award.
  // From a never-awarded stage, Awarded (and Reporting or Closed) is reached
  // only through PUT /grants/:id/award, which writes the pledge on the funder.
  { const GS = await grantShapeMod();
    const to = GS.normalizeStatus(status), from = GS.normalizeStatus(prevStatus);
    if (GS.AWARDED_STATUS_KEYS.includes(to) && !GS.AWARDED_STATUS_KEYS.includes(from) && !prevRows[0].award_pledge_id) {
      return res.status(409).json({ code: "award_required", error: "award_required", target: to,
        funderLinked: !!prevRows[0].funder_donor_id,
        sentence: "Record the award to move this grant to " + GS.statusLabel(to) + ": the amount, the payment schedule and the restriction. That writes the pledge on the funder." });
    }
  }
  // GRANTS-FIX: an unlinked grant is linked through the one resolver when saved.
  // A linked grant keeps its link; editing the typed name never relinks it.
  if (!prevRows[0].funder_donor_id) {
    const fl = await FL.resolveGrantFunder({ q: query, r: run }, orgId, funder, actor(req));
    if (fl.donorId) await FL.linkGrant({ q: query, r: run }, orgId, req.params.id, fl.donorId);
  }

  // Finance entity-routing FIX — the award-side double-count guard's "link,
  // don't double-book" arm. `adoptTxnId` names an EXISTING manual money-in row
  // (org-scoped, source='manual', type='income', not already a grant's stamp)
  // that IS this award's money: instead of inserting a second income row, that
  // row becomes the award stamp (grant_id set, source→'grant'). Validated up
  // front so a foreign/wrong-shaped id 404s before any state changes — never
  // silently double-books.
  if (adoptTxnId !== undefined && adoptTxnId !== null && adoptTxnId !== "") {
    if (status !== "awarded") return res.status(400).json({ error: "adoptTxnId only applies when marking a grant awarded" });
    const adoptRows = await query(
      "SELECT id FROM fin_transactions WHERE id=? AND org_id=? AND source='manual' AND type='income' AND grant_id IS NULL",
      [adoptTxnId, orgId]
    );
    if (!adoptRows.length) return res.status(404).json({ error: "Transaction not found or not adoptable" });
  }

  // Attribution FIX — set / change / clear (campaignId:"" → NULL), org-scoped.
  const campaignIdRaw = req.body.campaignId !== undefined ? req.body.campaignId
    : req.body.campaign_id !== undefined ? req.body.campaign_id : undefined;
  let newCampaignId = prevRows[0]?.campaign_id || null;
  if (campaignIdRaw !== undefined) {
    if (campaignIdRaw) {
      const camp = await query("SELECT id FROM campaigns WHERE id=? AND org_id=?", [campaignIdRaw, orgId]);
      if (!camp.length) return res.status(404).json({ error: "Campaign not found" });
      newCampaignId = campaignIdRaw;
    } else {
      newCampaignId = null;
    }
  }

  // awarded_at is the attribution fact (see db.js): stamped entering
  // 'awarded' (the same moment as the ledger income stamp below), kept while
  // the grant moves through active/closed, cleared if it moves BACK to a
  // still-pursuing or rejected status (an un-award — the thermometer reverses).
  let newAwardedAt = prevRows[0]?.awarded_at || null;
  if (status === "awarded" && prevStatus !== "awarded" && !newAwardedAt) newAwardedAt = new Date().toISOString();
  if (["prospecting", "researching", "loi", "invited", "applied", "submitted", "draft", "pending", "rejected", "declined"].includes(status)) newAwardedAt = null;

  const affected = await run(
    `UPDATE grants
     SET funder=?,program=?,amount=?,status=?,deadline=?,report_due=?,officer=?,notes=?,description=?,requirements=?,campaign_id=?,awarded_at=?,updated_at=NOW()
     WHERE id=? AND org_id=?`,
    // GIFTS-1: Received is not typed any more. It is the payments recorded on
    // the award (Record a payment received); the old typed column is kept as
    // it was, for scripts/ops/gifts1-grant-received.js to reconcile.
    [funder, program || "", amount || 0, status, deadline || "",
     reportDue || "", officer || "", notes || "", description || "", requirements || "",
     newCampaignId, newAwardedAt,
     req.params.id, orgId]
  );
  if (!affected.changes) return res.status(404).json({ error: "Grant not found" });

  // Grant awarded → the ledger income books EXACTLY ONCE (uq_fin_txns_grant).
  // Either by adopting the caller-named manual row as the stamp (the money was
  // already logged — link it, don't double-book) or by inserting the auto
  // stamp. Adoption keeps the treasurer's own date/fund/account and re-badges
  // the row source='grant'.
  if (status === 'awarded' && prevStatus !== 'awarded') {
    let adopted = false;
    if (adoptTxnId) {
      // Adoption keeps source='manual' (it stays the treasurer's own entry —
      // un-award UNLINKS it rather than deleting user-entered data); grant_id
      // is what marks it as the award's single ledger booking.
      const upd = await run(
        `UPDATE fin_transactions SET grant_id=?
         WHERE id=? AND org_id=? AND source='manual' AND type='income' AND grant_id IS NULL`,
        [req.params.id, adoptTxnId, orgId]
      ).catch(() => ({ changes: 0 }));
      adopted = !!upd.changes;
      if (adopted) writeAuditLog(orgId, req.user.userId, req.user.email, "updated", "transaction", adoptTxnId, {
        description: `Linked existing manual income to grant award: ${funder} · ${program || ""} (books once, not twice)`,
        new: { grant_id: req.params.id },
      }).catch(() => {});
    }
    if (!adopted) await stampGrantAward(orgId, req.params.id, funder, program, amount, actor(req));
  }

  // Un-award (awarded_at cleared — the grant moved BACK to a pursuing or
  // rejected status): the income reverses out of the ledger too, same
  // discipline as a voided/refunded gift removing its stamp. The AUTO stamp
  // (source='grant') is deleted; an ADOPTED manual row is unlinked back to a
  // plain manual entry (never delete treasurer-entered data on a status move).
  if (newAwardedAt === null && prevRows[0]?.awarded_at) {
    await run("DELETE FROM fin_transactions WHERE org_id=? AND grant_id=? AND source='grant'", [orgId, req.params.id]).catch(() => {});
    await run("UPDATE fin_transactions SET grant_id=NULL WHERE org_id=? AND grant_id=?", [orgId, req.params.id]).catch(() => {});
  }

  // Grant closed/rejected → follow-up task in 6 months
  if ((status === 'closed' || status === 'rejected') && prevStatus !== status) {
    const sixMonths = new Date(Date.now() + 180*24*60*60*1000).toISOString().slice(0, 10);
    await run(
      "INSERT INTO tasks (id,org_id,title,priority,done,due,created_by,created_by_name) VALUES (?,?,?,'medium',0,?,?,?)",
      [newId("t"), orgId, `Follow up with ${funder} re: next cycle`, sixMonths, actor(req).id, actor(req).name]
    ).catch(() => {});
  }

  const rows = await withGrantReceived(orgId, await query("SELECT * FROM grants WHERE id = ? AND org_id = ?", [req.params.id, orgId]));
  const g = rows[0];
  g.history = JSON.parse(g.history || "[]");
  res.json(g);
}));

// PUT /grants/:id/award — AWARDED WRITES THE AWARD AS A PLEDGE ON THE FUNDER.
//
// Not a gift: a foundation saying yes in March and paying in two instalments
// across the year is a COMMITMENT, and Steward already has exactly the right
// object for that (88b's pledge path, with instalments that close themselves
// when the money arrives through any door). Writing a gift here would book money
// that has not arrived; writing nothing would lose the schedule.
//
// It is its own route rather than a branch inside the general PUT because the
// general PUT already carries the ledger stamp, the campaign attribution and the
// adopt-an-existing-row guard, and threading a pledge writer through all of that
// is how one of those stops working.
app.put("/grants/:id/award", requireAuth, requireCrm, checkWriteAccess, wrap(async (req, res) => {
  const G = await grantShapeMod();
  const orgId = req.user.orgId;
  const [g] = await query(
    `SELECT g.*, d.name AS funder_name FROM grants g
       LEFT JOIN donors d ON d.id = g.funder_donor_id AND d.org_id = g.org_id
      WHERE g.id=? AND g.org_id=?`, [req.params.id, orgId]);
  if (!g) return res.status(404).json({ error: "Grant not found" });
  if (!g.funder_donor_id) {
    return res.status(400).json({ code: "funder_not_linked", action: "link_funder", grantId: g.id, typedName: g.funder || "",
      error: "Link this grant to the funder's organization record before awarding it, the pledge has to belong to somebody." });
  }
  let awardedCents;
  try { awardedCents = parseMoneyOrThrow(req.body.amountAwarded, "amountAwarded"); }
  catch (e) { return res.status(400).json({ error: e.message, code: e.code }); }
  const v = G.validateGrant({ status: "awarded", amountAwardedCents: awardedCents,
                              restriction: req.body.restriction !== undefined ? req.body.restriction : g.restriction,
                              restrictedFrom: req.body.restrictedFrom !== undefined ? req.body.restrictedFrom : g.restricted_from,
                              restrictedUntil: req.body.restrictedUntil !== undefined ? req.body.restrictedUntil : g.restricted_until },
                            { mode: "patch" });
  if (!v.ok) return res.status(400).json({ error: v.errors[0].message, code: "invalid_grant", errors: v.errors });

  const org = await orgTz(orgId);
  const today = orgToday(org);                                  // ORG_TZ_SEAM_OK
  // ALREADY AWARDED WRITES NOTHING NEW. A second press must not produce a second
  // pledge — the commitment exists, and a duplicate would double it in every
  // total the funder appears in.
  let pledgeId = g.award_pledge_id || null;
  if (!pledgeId) {
    const due = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.firstDue || "")) ? String(req.body.firstDue) : today;
    // THE ONE PLEDGE WRITER (FIX-60), with its schedule. A frequency and a
    // count give the funder's real payment schedule; neither given is one
    // installment for the whole award, so recordGift applies their cheque to it
    // to the cent from whichever door it arrives through.
    try {
      ({ id: pledgeId } = await PW.writePledge({ orgId, donorId: g.funder_donor_id, amountCents: awardedCents, dueDate: due,
        notes: `Grant award: ${g.program || "grant"}`, createdBy: actor(req).id, createdByName: actor(req).name,
        plan: { schedule: req.body.installments, frequency: req.body.frequency, count: req.body.installmentCount, firstDue: due } },
        { door: "pledge" }));
    } catch (e) {
      if (e.code === "schedule_does_not_sum" || e.code === "bad_amount") return res.status(400).json({ error: e.message, code: e.code });
      throw e;
    }
  }

  await run(
    `UPDATE grants SET status='awarded', amount_awarded=?, award_pledge_id=?,
       restriction=COALESCE(?, restriction), restricted_from=COALESCE(?, restricted_from),
       restricted_until=COALESCE(?, restricted_until),
       awarded_at=COALESCE(awarded_at, NOW()), updated_at=NOW()
     WHERE id=? AND org_id=?`,
    [toDollars(awardedCents), pledgeId,
     req.body.restriction || null, req.body.restrictedFrom || null, req.body.restrictedUntil || null,
     g.id, orgId]);

  // WIRE-1: the award is on the funder's timeline, once (the board drag that
  // first awards it writes the same key).
  { const who = await staffWho(req);
    await TL.timelineLine({ orgId, donorId: g.funder_donor_id, actorId: who.id, actorName: who.name,
      note: `Awarded ${TL.lineMoney(toDollars(awardedCents))} for ${g.program || g.funder || "grant"}.`,
      key: `grant_awarded:${g.id}`, metadata: { via: "grant", grant_id: g.id, pledge_id: pledgeId } }); }

  const [row] = await query(
    `SELECT g.*, d.name AS funder_name, d.funder_type FROM grants g
       JOIN donors d ON d.id = g.funder_donor_id AND d.org_id = g.org_id WHERE g.id=?`, [g.id]);
  const [inst] = await query("SELECT COUNT(*)::int AS c FROM pledge_installments WHERE pledge_id=?", [pledgeId]);
  res.json({ ...grantRow({ ...row, status_canonical: "awarded" },
                         { funds: await orgFundNamesG(orgId), officers: await orgOfficerNames(orgId) }),
             pledgeId, installments: inst.c });
}));

// PUT /grants/:id/decline — a no, with its reason, its date, and whether to try
// again. Declining does NOT touch the award pledge if one somehow exists: money
// already committed is a fact, and a status is not a reason to delete it.
app.put("/grants/:id/decline", requireAuth, requireCrm, checkWriteAccess, wrap(async (req, res) => {
  const G = await grantShapeMod();
  const orgId = req.user.orgId;
  const [g] = await query("SELECT id, status FROM grants WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!g) return res.status(404).json({ error: "Grant not found" });
  const v = G.validateGrant({ status: "declined", declineReason: req.body.declineReason,
                              declinedOn: req.body.declinedOn, reapply: req.body.reapply }, { mode: "patch" });
  if (!v.ok) return res.status(400).json({ error: v.errors[0].message, code: "invalid_grant", errors: v.errors });
  const org = await orgTz(orgId);
  await run(
    `UPDATE grants SET status='declined', decline_reason=?, declined_on=?, reapply=?, updated_at=NOW()
      WHERE id=? AND org_id=?`,
    [req.body.declineReason, req.body.declinedOn || orgToday(org),    // ORG_TZ_SEAM_OK
     req.body.reapply === undefined ? null : !!req.body.reapply, g.id, orgId]);
  const [row] = await query(
    `SELECT g.*, d.name AS funder_name, d.funder_type FROM grants g
       LEFT JOIN donors d ON d.id = g.funder_donor_id AND d.org_id = g.org_id WHERE g.id=?`, [g.id]);
  res.json(grantRow({ ...row, status_canonical: "declined" },
    { funds: await orgFundNamesG(orgId), officers: await orgOfficerNames(orgId) }));
}));

// GET /grants/pipeline — the Grants screen under Fundraising. By status in
// dollars and count, filtered by program, officer and cycle, sorted by the next
// deadline. EVERY FIGURE CARRIES ITS SENTENCE.
app.get("/grants/pipeline", requireAuth, wrap(async (req, res) => {
  const G = await grantShapeMod();
  const orgId = req.user.orgId;
  const where = ["g.org_id = ?", "g.is_sample IS NOT TRUE"], args = [orgId];
  if (!(await OU.orgUser(orgId, req.query.officerId, { allowInactive: true })).ok) return OU.refuse(res, "officerId");
  if (req.query.officerId) { where.push("g.officer_id = ?"); args.push(String(req.query.officerId)); }
  if (req.query.cycle) { where.push("LOWER(COALESCE(g.cycle_name,'')) = LOWER(?)"); args.push(String(req.query.cycle)); }
  if (req.query.program) { where.push("LOWER(COALESCE(g.program,'')) LIKE LOWER(?)"); args.push("%" + String(req.query.program) + "%"); }
  if (req.query.status) {
    const want = String(req.query.status).split(",").map(x => G.normalizeStatus(x)).filter(Boolean);
    if (!want.length) return res.status(400).json({ error: "Unknown status" });
    // Match the canonical status AND every legacy spelling of it, so a filter
    // does not silently hide rows written before this build.
    const spellings = [...want];
    for (const [alias, canon] of Object.entries(G.STATUS_ALIASES)) if (want.includes(canon)) spellings.push(alias);
    where.push("LOWER(g.status) = ANY(?::text[])"); args.push(spellings);
  }
  const rows = await query(
    `SELECT g.*, d.name AS funder_name, d.funder_type FROM grants g
       LEFT JOIN donors d ON d.id = g.funder_donor_id AND d.org_id = g.org_id
      WHERE ${where.join(" AND ")}`, args);
  const funds = await orgFundNamesG(orgId), officers = await orgOfficerNames(orgId);
  // GRANTS-1: the next open milestone on each grant, in one read.
  const M = await grantMsMod();
  const nextMs = new Map((await query(
    `SELECT DISTINCT ON (grant_id) grant_id, kind, label, due_date FROM grant_milestones
      WHERE org_id=? AND state NOT IN ('done','skipped') ORDER BY grant_id, due_date`, [orgId])).map(m => [m.grant_id, m]));
  const all = rows.map(r => {
    const ms = nextMs.get(r.id);
    const legacy = [r.deadline, r.report_due].filter(x => /^\d{4}-\d{2}-\d{2}$/.test(String(x || ""))).sort()[0] || null;
    const useMs = ms && (!legacy || ms.due_date <= legacy || G.holdsAward(r.status));
    return {
      ...grantRow({ ...r, status_canonical: G.normalizeStatus(r.status) }, { funds, officers }),
      nextDeadline: useMs ? ms.due_date : legacy,
      nextDeadlineLabel: useMs ? M.milestoneName(ms) : (legacy ? (legacy === r.report_due ? "Report due" : "Deadline") : null),
    };
  });
  const sort = ["deadline", "amount", "funder", "status"].includes(String(req.query.sort)) ? String(req.query.sort) : "deadline";
  const grants = G.sortGrants(all, sort);
  const byStatus = G.pipelineByStatus(all).map(r => ({
    ...r, amount: toDollars(r.cents), sentence: G.statusTileSentence(r, money.formatCentsPlain),
  }));
  const open = all.filter(x => G.isOpenStatus(x.status));
  const openCents = open.reduce((s, x) => s + G.pipelineCentsFor(x), 0);
  const cycles = [...new Set(all.map(x => x.cycleName).filter(Boolean))].sort();
  res.json({
    grants, byStatus, sort,
    openPipeline: { cents: openCents, amount: toDollars(openCents), count: open.length,
                    sentence: G.openPipelineSentence({ cents: openCents, count: open.length }, money.formatCentsPlain) },
    statuses: G.GRANT_STATUSES, restrictions: G.RESTRICTIONS, declineReasons: G.DECLINE_REASONS,
    funderTypes: G.FUNDER_TYPES, cycles,
    funds: [...funds.entries()].map(([id, name]) => ({ id, name })),
    officers: [...officers.entries()].map(([id, name]) => ({ id, name })),
  });
}));

// FIX-28: one insert for a deadline. A deadline removed earlier on the same
// kind and day comes back rather than colliding with the unique index.
async function addGrantMilestone(res, { orgId, grantId, kind, due, label, notes, who }) {
  const [same] = await query("SELECT id, state FROM grant_milestones WHERE grant_id=? AND kind=? AND due_date=? AND org_id=?",
    [grantId, kind, due, orgId]);
  if (same && same.state !== "skipped") {
    res.status(400).json({ code: "milestone_exists", error: "This grant already has that deadline on that day." });
    return null;
  }
  if (same) {
    await run(`UPDATE grant_milestones SET state='pending', label=?, notes=?, thread_id=NULL, completed_at=NULL, completed_by=NULL,
                 completed_by_name=NULL, updated_at=NOW() WHERE id=? AND org_id=?`,
      [label || null, String(notes || "").slice(0, 2000), same.id, orgId]);
    return same.id;
  }
  const id = newId("gms");
  await run(`INSERT INTO grant_milestones (id,org_id,grant_id,kind,label,due_date,state,notes,created_by,created_by_name)
             VALUES (?,?,?,?,?,?, 'pending', ?,?,?)`,
    [id, orgId, grantId, kind, label || null, due, String(notes || "").slice(0, 2000), who.id, who.name]);
  return id;
}

// POST /grants/:id/milestones — add a dated thing owed on this grant.
app.post("/grants/:id/milestones", requireAuth, requireCrm, checkWriteAccess, wrap(async (req, res) => {
  const M = await grantMsMod();
  const orgId = req.user.orgId;
  const [g] = await query("SELECT id, status FROM grants WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!g) return res.status(404).json({ error: "Grant not found" });
  const kind = String(req.body.kind || "");
  if (!M.MILESTONE_KEYS.includes(kind)) {
    return res.status(400).json({ code: "bad_milestone_kind",
      error: `A milestone is one of: ${M.MILESTONE_TYPES.map(t => t.label).join(", ")}.` });
  }
  const due = String(req.body.dueDate || "");
  if (!M.isCivilDate(due)) return res.status(400).json({ code: "bad_due_date", error: "The date must be YYYY-MM-DD." });
  // FIX-28: a grant carries any number of deadlines. The one thing refused is
  // the same kind on the same day twice, which is one deadline typed twice.
  const label = String(req.body.label || "").trim().slice(0, 120);
  if (kind === "custom" && !label) return res.status(400).json({ code: "custom_needs_name", error: "Give a custom deadline a name, like Site visit or Budget revision." });
  const id = await addGrantMilestone(res, { orgId, grantId: g.id, kind, due, label, notes: req.body.notes, who: actor(req) });
  if (!id) return;

  // Raise it NOW if its lead time has already arrived — a report due next week
  // typed in today must not wait for a sweep to notice.
  const org = await orgTz(orgId);
  const today = orgToday(org);                                  // ORG_TZ_SEAM_OK
  const leadDays = await orgLeadDays(orgId);
  if (M.dueWithinLead({ kind, dueDate: due }, today, leadDays)) {
    await raiseGrantMilestone(orgId, { id, grant_id: g.id, kind, label, due_date: due }, { today });
  }
  const [row] = await query(
    `SELECT m.*, g.program, g.status, g.funder, d.name AS funder_name
       FROM grant_milestones m JOIN grants g ON g.id=m.grant_id AND g.org_id=m.org_id
       LEFT JOIN donors d ON d.id=g.funder_donor_id AND d.org_id=g.org_id
      WHERE m.id=?`, [id]);
  res.status(201).json(milestoneRow(row, M, today, leadDays));
}));

// PUT /grants/milestones/:msId — MOVING THE DATE MOVES THE THREAD.
// A date that moves and leaves a thread pointing at the old one is how an
// officer ends up chasing a deadline that no longer exists.
app.put("/grants/milestones/:msId", requireAuth, requireCrm, checkWriteAccess, wrap(async (req, res) => {
  const M = await grantMsMod();
  const orgId = req.user.orgId;
  const [ms] = await query("SELECT * FROM grant_milestones WHERE id=? AND org_id=?", [req.params.msId, orgId]);
  if (!ms) return res.status(404).json({ error: "Milestone not found" });
  const due = req.body.dueDate === undefined ? ms.due_date : String(req.body.dueDate || "");
  if (!M.isCivilDate(due)) return res.status(400).json({ code: "bad_due_date", error: "The date must be YYYY-MM-DD." });
  // FIX-28: the kind and a custom name are editable too.
  const kind = req.body.kind === undefined ? ms.kind : String(req.body.kind || "");
  if (!M.MILESTONE_KEYS.includes(kind)) return res.status(400).json({ code: "bad_milestone_kind", error: "That is not a kind of deadline." });
  const label = req.body.label === undefined ? (ms.label || "") : String(req.body.label || "").trim().slice(0, 120);
  if (kind === "custom" && !label) return res.status(400).json({ code: "custom_needs_name", error: "Give a custom deadline a name, like Site visit or Budget revision." });
  if (kind !== ms.kind || due !== ms.due_date) {
    const [clash] = await query("SELECT id FROM grant_milestones WHERE grant_id=? AND kind=? AND due_date=? AND id<>? AND org_id=?",
      [ms.grant_id, kind, due, ms.id, orgId]);
    if (clash) return res.status(400).json({ code: "milestone_exists", error: "This grant already has that deadline on that day." });
  }

  const org = await orgTz(orgId);
  const today = orgToday(org);                                  // ORG_TZ_SEAM_OK
  const leadDays = await orgLeadDays(orgId);

  await run(`UPDATE grant_milestones SET due_date=?, kind=?, label=?, notes=COALESCE(?, notes), updated_at=NOW()
              WHERE id=? AND org_id=?`,
    [due, kind, label || null, req.body.notes === undefined ? null : String(req.body.notes).slice(0, 2000), ms.id, orgId]);

  if (due !== ms.due_date && ms.thread_id) {
    // The thread's own due date follows, through the threads table the Thread
    // engine reads — the label is unchanged because the work is unchanged.
    // `original_due_date` is preserved the way BUILD-81's snooze preserves it
    // (COALESCE, so the FIRST date survives every later move): "we said the
    // 14th" is a fact about the relationship, not a stale value.
    // NB `threads` has no `updated_at` column — naming one 500'd this route
    // and left the thread pointing at a deadline that had moved.
    await run(`UPDATE threads
                  SET due_date = ?,
                      original_due_date = COALESCE(original_due_date, due_date)
                WHERE id=? AND org_id=? AND closed_at IS NULL`, [due, ms.thread_id, orgId]);
  }
  // A date moved OUT beyond its lead time with no thread yet goes back to
  // pending, so a waiting milestone that is no longer urgent stops queueing.
  if (!ms.thread_id && ms.state === "waiting"
      && !M.dueWithinLead({ kind: ms.kind, dueDate: due }, today, leadDays)) {
    await run("UPDATE grant_milestones SET state='pending', updated_at=NOW() WHERE id=? AND org_id=?", [ms.id, orgId]);
  }
  if (!ms.thread_id && M.dueWithinLead({ kind: ms.kind, dueDate: due }, today, leadDays)) {
    await raiseGrantMilestone(orgId, { ...ms, due_date: due }, { today });
  }
  const [row] = await query(
    `SELECT m.*, g.program, g.status, g.funder, d.name AS funder_name
       FROM grant_milestones m JOIN grants g ON g.id=m.grant_id AND g.org_id=m.org_id
       LEFT JOIN donors d ON d.id=g.funder_donor_id AND d.org_id=g.org_id
      WHERE m.id=?`, [ms.id]);
  res.json(milestoneRow(row, M, today, leadDays));
}));

// POST /grants/milestones/:msId/done — somebody did it.
// It does NOT close the thread: the Thread engine's own close is honest
// (BUILD-81's CHECK), and closing it from here would write a close with no
// interaction behind it. The milestone is marked and the thread is the
// officer's to log a line against.
app.post("/grants/milestones/:msId/done", requireAuth, requireCrm, checkWriteAccess, wrap(async (req, res) => {
  const M = await grantMsMod();
  const orgId = req.user.orgId;
  const [ms] = await query("SELECT * FROM grant_milestones WHERE id=? AND org_id=?", [req.params.msId, orgId]);
  if (!ms) return res.status(404).json({ error: "Milestone not found" });
  await markMilestoneDone(orgId, ms.id, actor(req));
  const org = await orgTz(orgId);
  res.json({ ok: true, id: ms.id, state: "done",
    nextDeadlineSentence: M.milestoneTiming({ kind: ms.kind, dueDate: ms.due_date }, orgToday(org)).sentence });  // ORG_TZ_SEAM_OK
}));

// FIX-28: UNDO A DONE, AND TAKE ONE OFF. Done goes back to open (its thread,
// if one was raised and is still open, is still its thread); a removed
// deadline is `skipped`, which every read already leaves out, so putting it
// back is the same reopen.
app.post("/grants/milestones/:msId/reopen", requireAuth, requireCrm, checkWriteAccess, wrap(async (req, res) => {
  const M = await grantMsMod();
  const orgId = req.user.orgId;
  const [ms] = await query("SELECT * FROM grant_milestones WHERE id=? AND org_id=?", [req.params.msId, orgId]);
  if (!ms) return res.status(404).json({ error: "Milestone not found" });
  await reopenMilestone(orgId, ms, M);
  res.json({ ok: true, id: ms.id });
}));

app.post("/grants/milestones/:msId/remove", requireAuth, requireCrm, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [ms] = await query("SELECT id FROM grant_milestones WHERE id=? AND org_id=?", [req.params.msId, orgId]);
  if (!ms) return res.status(404).json({ error: "Milestone not found" });
  await run("UPDATE grant_milestones SET state='skipped', updated_at=NOW() WHERE id=? AND org_id=?", [ms.id, orgId]);
  res.json({ ok: true, id: ms.id });
}));

// GET /grants/deadlines — the calendar, the list, and the Home line.
app.get("/grants/deadlines", requireAuth, wrap(async (req, res) => {
  const M = await grantMsMod();
  const orgId = req.user.orgId;
  const org = await orgTz(orgId);
  const today = req.query.today && testMode() && M.isCivilDate(String(req.query.today))
    ? String(req.query.today) : orgToday(org);                   // ORG_TZ_SEAM_OK
  const leadDays = await orgLeadDays(orgId);
  const rows = await query(
    `SELECT m.*, g.program, g.status, g.funder, g.officer_id, d.name AS funder_name
       FROM grant_milestones m
       JOIN grants g ON g.id = m.grant_id AND g.org_id = m.org_id
       LEFT JOIN donors d ON d.id = g.funder_donor_id AND d.org_id = g.org_id
      WHERE m.org_id=? AND g.is_sample IS NOT TRUE AND m.state <> 'skipped'
      ORDER BY m.due_date ASC`, [orgId]);
  const all = rows.map(r => milestoneRow(r, M, today, leadDays));
  const open = all.filter(m => m.state !== "done");

  // BUILD-100 Part 4 — A REPORT-DUE MILESTONE CARRIES ITS GRANT'S BALANCE,
  // because the balance is what the report is about. Only for `report_due`: the
  // figure is not relevant to an LOI deadline and a number on a row that does
  // not need it is a number somebody has to decide to ignore. One batched read,
  // never a query per row.
  const reportGrantIds = [...new Set(open.filter(m => m.kind === "report_due").map(m => m.grantId))];
  if (reportGrantIds.length) {
    const R = await restrictedMod();
    const moneyRows = await grantMoneyRows(orgId, `AND g.id = ANY(?::text[])`, [reportGrantIds]);
    const byGrant = new Map(moneyRows.map(r => [r.id, grantBalanceFrom(R, r, today)]));
    for (const m of open) {
      if (m.kind !== "report_due") continue;
      const b = byGrant.get(m.grantId);
      if (b) m.balance = { restricted: b.restricted, remaining: b.remaining, remainingCents: b.remainingCents,
                           spent: b.spent, received: b.received, sentence: b.sentence };
    }
  }
  res.json({
    today,
    milestones: M.sortMilestones(open),
    done: all.filter(m => m.state === "done").length,
    doneMilestones: all.filter(m => m.state === "done"),
    overdue: open.filter(m => m.band === "overdue").length,
    calendar: M.calendarFromMilestones(open, today),
    homeLine: M.homeDeadlineLine(open, today),
    leadDays,
    headsUpDays: ((await query("SELECT grant_headsup_days FROM orgs WHERE id=?", [orgId]))[0] || {}).grant_headsup_days ?? 14,
    milestoneTypes: M.MILESTONE_TYPES,
  });
}));

// POST /grants/milestones/run — the ops/test door onto the sweep (the
// /photos/run, /nudges/run convention). Caller's org only.
app.post("/grants/milestones/run", requireAuth, requireAdmin, wrap(async (req, res) => {
  const summary = await processGrantMilestones(req.user.orgId, { today: req.body && req.body.today });
  res.json(summary);
}));

// POST /grants/:id/documents — one file, on a grant that already exists.
app.post("/grants/:id/documents", requireAuth, requireCrm, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [g] = await query("SELECT id FROM grants WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!g) return res.status(404).json({ error: "Grant not found" });

  const docType = String(req.body.docType || "");
  if (!grantDocs.DOC_TYPE_KEYS.includes(docType)) {
    return res.status(400).json({ code: "bad_doc_type",
      error: `A document is one of: ${grantDocs.DOC_TYPES.map(t => t.label).join(", ")}.` });
  }

  // A data URI, the shape every other upload in this product takes.
  const m = /^data:([a-zA-Z0-9.+/-]+);base64,(.+)$/s.exec(String(req.body.file || ""));
  if (!m) return res.status(400).json({ code: "no_file", error: "Attach a file." });
  const mime = m[1].toLowerCase();
  if (!grantDocs.mimeAllowed(mime)) {
    return res.status(400).json({ code: "bad_file_type",
      error: "Steward stores PDFs, Word documents, images and plain text. It deliberately refuses anything that can carry a script." });
  }
  let buffer;
  try { buffer = Buffer.from(m[2], "base64"); }
  catch { return res.status(400).json({ code: "no_file", error: "That file could not be read." }); }
  if (!buffer.length) return res.status(400).json({ code: "no_file", error: "That file is empty." });
  if (buffer.length > grantDocs.DOC_MAX_BYTES) {
    return res.status(400).json({ code: "file_too_large",
      error: `That file is ${Math.round(buffer.length / 1024 / 1024)} MB. The limit is ${grantDocs.DOC_MAX_BYTES / 1024 / 1024} MB.` });
  }
  // THE BYTES DECIDE. A caller declaring application/pdf over an HTML payload
  // is the hole this closes, and it is checked BEFORE anything is stored.
  if (!grantDocs.bytesMatchMime(buffer, mime)) {
    return res.status(400).json({ code: "file_type_mismatch",
      error: `That file does not look like a ${grantDocs.extensionFor(mime) || mime}. Check you attached what you meant to.` });
  }

  const asset = await putThemeAsset({
    orgId, kind: grantDocs.DOC_ASSET_KIND, buffer, contentType: mime,
  });
  const id = newId("gdoc");
  const fileName = grantDocs.sanitizeFilename(req.body.fileName, mime);
  // The SAME bytes under the SAME type on one grant is a double-click, not two
  // documents — the unique index says so and this answers it as success rather
  // than an error, because from the user's side the file IS on the grant.
  const ins = await query(
    `INSERT INTO grant_documents (id,org_id,grant_id,doc_type,asset_id,file_name,content_type,bytes,notes,uploaded_by,uploaded_by_name)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT (grant_id, doc_type, asset_id) DO NOTHING
     RETURNING id`,
    [id, orgId, g.id, docType, asset.id, fileName, mime, buffer.length,
     String(req.body.notes || "").slice(0, 2000), actor(req).id,
     (await query("SELECT name FROM users WHERE id=? AND org_id=?", [actor(req).id, orgId]))[0]?.name || actor(req).name]);
  const finalId = ins.length ? ins[0].id
    : (await query("SELECT id FROM grant_documents WHERE grant_id=? AND doc_type=? AND asset_id=?",
        [g.id, docType, asset.id]))[0].id;
  await recordAssetPointerHistory(orgId, "grant.document", finalId, null, asset.id, req.user);

  const [row] = await query(
    `SELECT d.*, g.program, g.funder, f.name AS funder_name
       FROM grant_documents d JOIN grants g ON g.id=d.grant_id AND g.org_id=d.org_id
       LEFT JOIN donors f ON f.id=g.funder_donor_id AND f.org_id=g.org_id
      WHERE d.id=?`, [finalId]);
  res.status(201).json({ ...grantDocRow(row, orgId), duplicate: ins.length === 0 });
}));

// GET /grants/:id/documents — the grant's own file list, versioned by date.
app.get("/grants/:id/documents", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [g] = await query("SELECT id FROM grants WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!g) return res.status(404).json({ error: "Grant not found" });
  const rows = await query(
    `SELECT d.*, g.program, g.funder, f.name AS funder_name
       FROM grant_documents d JOIN grants g ON g.id=d.grant_id AND g.org_id=d.org_id
       LEFT JOIN donors f ON f.id=g.funder_donor_id AND f.org_id=g.org_id
      WHERE d.grant_id=? AND d.org_id=? ORDER BY d.uploaded_at ASC`, [g.id, orgId]);
  const docs = grantDocs.withVersions(rows.map(r => grantDocRow(r, orgId)));
  res.json({ documents: docs, sentence: grantDocs.documentSentence(docs), docTypes: grantDocs.DOC_TYPES });
}));

// DELETE /grants/documents/:docId — ungated, per the DELETE convention. The
// asset is NOT destroyed here: it is soft-deleted by the retention sweep once
// nothing points at it (BUILD-56's one destruction seam), so a mistaken delete
// is recoverable for ninety days.
app.delete("/grants/documents/:docId", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [d] = await query("SELECT id, asset_id FROM grant_documents WHERE id=? AND org_id=?",
    [req.params.docId, orgId]);
  if (!d) return res.status(404).json({ error: "Document not found" });
  await run("DELETE FROM grant_documents WHERE id=? AND org_id=?", [d.id, orgId]);
  await recordAssetPointerHistory(orgId, "grant.document", d.id, d.asset_id, null, req.user);
  res.json({ ok: true, id: d.id });
}));

// POST /grants/:id/spend — one line of spending against a restricted award.
app.post("/grants/:id/spend", requireAuth, requireCrm, checkWriteAccess, wrap(async (req, res) => {
  const R = await restrictedMod();
  const orgId = req.user.orgId;
  const [g] = await query("SELECT id, restriction FROM grants WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!g) return res.status(404).json({ error: "Grant not found" });
  let cents;
  try { cents = parseMoneyOrThrow(req.body.amount, "amount"); }
  catch (e) { return res.status(400).json({ error: e.message, code: e.code }); }
  const v = R.validateSpend({ amountCents: cents, spentOn: req.body.spentOn, description: req.body.description });
  if (!v.ok) return res.status(400).json({ error: v.errors[0].message, code: "invalid_spend", errors: v.errors });
  const [u] = await query("SELECT name FROM users WHERE id=? AND org_id=?", [actor(req).id, orgId]);
  const id = newId("gsp");
  await run(`INSERT INTO grant_spend (id,org_id,grant_id,amount,spent_on,description,created_by,created_by_name)
             VALUES (?,?,?,?,?,?,?,?)`,
    [id, orgId, g.id, toDollars(cents), String(req.body.spentOn),
     String(req.body.description).trim().slice(0, 500), actor(req).id, (u && u.name) || actor(req).name]);
  const [row] = (await grantMoneyRows(orgId, "AND g.id = ?", [g.id]));
  const org = await orgTz(orgId);
  res.status(201).json({
    id, grantId: g.id, amount: toDollars(cents), amountCents: cents,
    balance: grantBalanceFrom(R, row, orgToday(org)),                   // ORG_TZ_SEAM_OK
    note: R.SPEND_SOURCE_NOTE,
  });
}));

app.delete("/grants/spend/:spendId", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [s] = await query("SELECT id FROM grant_spend WHERE id=? AND org_id=?", [req.params.spendId, orgId]);
  if (!s) return res.status(404).json({ error: "Not found" });
  await run("DELETE FROM grant_spend WHERE id=? AND org_id=?", [s.id, orgId]);
  res.json({ ok: true, id: s.id });
}));

// GET /grants/:id/restricted — one grant's restricted position, with the
// spending lines behind it so a figure can always be taken apart.
app.get("/grants/:id/restricted", requireAuth, wrap(async (req, res) => {
  const R = await restrictedMod();
  const orgId = req.user.orgId;
  const rows = await grantMoneyRows(orgId, "AND g.id = ?", [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: "Grant not found" });
  const org = await orgTz(orgId);
  const today = orgToday(org);                                          // ORG_TZ_SEAM_OK
  const balance = grantBalanceFrom(R, rows[0], today);
  const spend = await query(
    `SELECT id, amount, spent_on, description, created_by_name, created_at
       FROM grant_spend WHERE org_id=? AND grant_id=? ORDER BY spent_on DESC, created_at DESC`,
    [orgId, req.params.id]);
  const payments = rows[0].award_pledge_id ? await query(
    `SELECT g.id, g.amount, g.date FROM gifts g WHERE g.org_id=? AND g.pledge_id=? AND ${NUMBERS.money.MONEY("g")} ORDER BY g.date ASC`,   // NUMBERS-5: the rows behind received
    [orgId, rows[0].award_pledge_id]) : [];
  res.json({
    balance,
    // EVERY FIGURE CARRIES ITS DEFINITION, one string from the registry.
    definitions: Object.fromEntries(R.RESTRICTED_METRICS.map(m => [m.key, m.definition])),
    metrics: R.RESTRICTED_METRICS,
    spend: spend.map(s => ({
      id: s.id, amount: toDollars(toCents(s.amount) || 0), amountCents: toCents(s.amount) || 0,
      spentOn: s.spent_on, description: s.description, byName: s.created_by_name || "",
    })),
    payments: payments.map(p => ({
      id: p.id, amount: toDollars(toCents(p.amount) || 0), amountCents: toCents(p.amount) || 0, date: p.date,
    })),
    spendSourceNote: R.SPEND_SOURCE_NOTE,
  });
}));

// GET /grants/import/preview — what Steward makes of a file, before it writes
// anything. It reads and returns; it changes nothing, which is what makes the
// four-state deposit-sheet discipline available here too.
app.post("/grants/import/preview", requireAuth, wrap(async (req, res) => {
  const out = await planGrantImport(req.user.orgId, req.body || {});
  if (out.error) return res.status(400).json(out);
  res.json({ ...out, wrote: false });
}));

// THE PLAN, shared by the preview and the commit, so the screen can never be
// shown one thing and the database given another (the BUILD-95 rule: the commit
// RE-PLANS server-side and writes from the plan, never from the client's copy).
async function planGrantImport(orgId, body) {
  const I = await grantImportMod();
  const G = await grantShapeMod();
  const headers = Array.isArray(body.headers) ? body.headers.map(h => String(h == null ? "" : h)) : [];
  const rawRows = Array.isArray(body.rows) ? body.rows : [];
  if (!headers.length) return { error: "That file has no header row.", code: "no_headers" };
  if (!rawRows.length) return { error: "That file has no rows.", code: "no_rows" };
  if (rawRows.length > 5000) {
    return { error: "That file has more than 5,000 rows. Split it and import in two passes.", code: "too_many_rows" };
  }

  const detected = I.detectGrantSource(headers);
  // A SOURCE THE PERSON STATES WINS over what Steward detected — they have the
  // file open and Steward has a header row.
  const source = I.GRANT_SOURCE_KEYS.includes(String(body.source || "")) ? String(body.source) : detected.source;
  const { mapping, spellings, unrecognised } = I.grantMapping(headers);
  // A MAPPING THE PERSON CORRECTED wins too, field by field, and only for a
  // field this module knows — an unknown key cannot smuggle a column in.
  if (body.mapping && typeof body.mapping === "object") {
    for (const [f, h] of Object.entries(body.mapping)) {
      if (I.GRANT_FIELD_KEYS.includes(f) && (h === null || headers.includes(String(h)))) {
        if (h === null) delete mapping[f]; else mapping[f] = String(h);
      }
    }
  }
  if (!mapping.funderName && !mapping.funderEin) {
    return { error: "Steward could not find the funder's name in that file. Point it at the column that holds it.",
             code: "no_funder_column", headers, mapping, unrecognised, source, detected };
  }

  const built = I.buildGrantRows(rawRows, {
    mapping, spellings, source, money,
    cell: (row, header) => Array.isArray(row) ? row[headers.indexOf(header)] : (row || {})[header],
  });

  // ── RESOLVING THE FUNDERS ────────────────────────────────────────────────
  // Every candidate the file could be talking about, read ONCE. A per-row query
  // would be forty round trips on a forty-row file and 25,000 on a real one.
  const candidates = (await query(
    `SELECT id, name, kind, funder_ein FROM donors WHERE org_id=? AND deleted_at IS NULL`, [orgId]))
    .map(d => ({ id: d.id, name: d.name, kind: d.kind, funderEin: d.funder_ein }));

  const byKey = new Map();               // one decision per distinct funder in the file
  for (const g of built.grants) {
    const key = (I.normalizeEin(g.funderEin) ? "e:" + I.normalizeEin(g.funderEin) : "n:" + I.funderNameKey(g.funderName));
    if (!byKey.has(key)) {
      byKey.set(key, { key, name: g.funderName, ein: I.normalizeEin(g.funderEin), lines: [],
                       ...I.matchFunder({ name: g.funderName, ein: g.funderEin }, candidates) });
    }
    byKey.get(key).lines.push(g.line);
  }

  // Already on file, by the same key the write path will use.
  const existingKeys = new Set();
  for (const r of await query(
    `SELECT g.id, g.program, g.deadline, g.external_id, d.name AS funder_name
       FROM grants g LEFT JOIN donors d ON d.id = g.funder_donor_id AND d.org_id = g.org_id
      WHERE g.org_id=?`, [orgId])) {
    existingKeys.add(I.grantDedupeKey({ externalId: r.external_id, funderName: r.funder_name || "",
                                        program: r.program || "", deadline: r.deadline || null }));
  }

  const refused = [...built.refused];
  const plan = [], seen = new Set();
  let skipped = 0;
  for (const g of built.grants) {
    const key = (I.normalizeEin(g.funderEin) ? "e:" + I.normalizeEin(g.funderEin) : "n:" + I.funderNameKey(g.funderName));
    const f = byKey.get(key);
    if (f.refused === "funder_is_a_person") {
      refused.push({ line: g.line, funderName: g.funderName, program: g.program,
                     why: I.FUNDER_IS_A_PERSON, code: "funder_is_a_person", person: f.person });
      continue;
    }
    if (f.refused === "funder_not_named") {
      refused.push({ line: g.line, why: "no funder named", code: "funder_not_named" });
      continue;
    }
    const dk = I.grantDedupeKey(g);
    // THE SAME FILE TWICE ADDS NOTHING, and the same row twice INSIDE one file
    // is the same thing — both are skipped and counted, never silently folded.
    if (existingKeys.has(dk) || seen.has(dk)) { skipped++; continue; }
    seen.add(dk);
    plan.push({ ...g, funderKey: key, dedupeKey: dk });
  }

  const pipelineCents = plan.reduce((sum, g) =>
    sum + (G.isOpenStatus(g.status) ? (g.amountRequestedCents || 0) : 0), 0);
  const funders = [...byKey.values()].filter(f => !f.refused);
  return {
    source, detected, mapping, unrecognised,
    grants: plan.map(g => ({ ...g, amountRequested: toDollars(g.amountRequestedCents),
                             amountAwarded: g.amountAwardedCents == null ? null : toDollars(g.amountAwardedCents) })),
    funders: funders.map(f => ({ name: f.name, ein: f.ein, donorId: f.donorId || null,
                                 how: f.how || null, willCreate: !!f.create, grants: f.lines.length })),
    counts: {
      rows: rawRows.length, grants: plan.length, funders: funders.length,
      willCreateFunders: funders.filter(f => f.create).length,
      matchedByEin: funders.filter(f => f.how === "ein").length,
      matchedByName: funders.filter(f => f.how === "name").length,
      skipped, refused: refused.length, ...built.counted,
    },
    refused,
    pipelineCents, pipeline: toDollars(pipelineCents),
    // NOTHING IS INVENTED HERE AND THE PLAN SAYS SO, so nobody has to read the
    // route to know what an import will and will not touch.
    writes: ["grants", "funder organizations that were not on file"],
    doesNotWrite: ["gifts", "pledges", "deadlines Steward watches", "follow-ups"],
    plan_: plan,
  };
}

// POST /grants/import — the ONE write path. Everything lands inside one
// transaction, so a file that fails halfway leaves no half-imported pipeline.
app.post("/grants/import", requireAuth, requireCrm, checkWriteAccess, wrap(async (req, res) => {
  const I = await grantImportMod();
  const GS = await grantShapeMod();
  const orgId = req.user.orgId;
  const plan = await planGrantImport(orgId, req.body || {});
  if (plan.error) return res.status(400).json(plan);

  const who = actor(req);
  const [u] = await query("SELECT name FROM users WHERE id=? AND org_id=?", [who.id, orgId]);
  const byName = (u && u.name) || who.name;
  const created = [], written = [];
  // SHEETS-1: a file brought in from Grants is kept with the import, and every
  // column that is not a grant field is kept with it. The file is checked
  // before anything is written, so a bad file writes nothing.
  const SH = req.body && req.body.sheet ? require("../../routes/sheets") : null;
  let sheetFile = null, keptSheet = null;
  if (SH) {
    sheetFile = await SH.prepareSheetFile(orgId, req.body.sheet);
    if (sheetFile.error) return res.status(400).json(sheetFile);
  }

  await withTransaction(async (client) => {
    const trun = (sql, args) => runTx(client, sql, args);
    const tquery = (sql, args) => queryTx(client, sql, args);
    // 1 — THE FUNDERS FIRST, and every one created as an ORGANISATION. A funder
    // created as a person would be refused by Part 1's own door the next time
    // anybody touched it, which is the shape of a bug that looks like data.
    const resolved = new Map();
    for (const f of plan.funders) {
      if (f.donorId) { resolved.set(f.name, f.donorId); continue; }
      const id = newId("dn");
      await trun(
        `INSERT INTO donors (id,org_id,name,kind,stage,status,total_giving,gift_count,funder_ein,
                             person_types,created_by,created_by_name)
         VALUES (?,?,?,'organisation','prospect','new',0,0,?,?,?,?)`,
        [id, orgId, f.name, f.ein || null, JSON.stringify(["donor"]), who.id, byName]);
      resolved.set(f.name, id);
      created.push({ id, name: f.name, ein: f.ein || null });
    }
    // An EIN we now hold for a funder already on file is worth keeping, but it
    // NEVER overwrites one somebody already typed.
    for (const f of plan.funders) {
      if (f.donorId && f.ein) {
        await trun("UPDATE donors SET funder_ein=COALESCE(funder_ein, ?) WHERE id=? AND org_id=?",
          [f.ein, f.donorId, orgId]).catch(() => {});
      }
    }

    // 2 — THE FUND AND THE OFFICER, matched by name to what the org already has.
    // NOTHING IS CREATED on either: a fund is a board decision (BUILD-88a's rule)
    // and a user is a login. An unmatched name is carried into the notes so it is
    // not lost, and counted.
    const funds = new Map((await tquery("SELECT id, name FROM fin_funds WHERE org_id=?", [orgId]))
      .map(f => [String(f.name).trim().toLowerCase(), f.id]));
    const officers = new Map((await tquery("SELECT id, name FROM users WHERE org_id=?", [orgId]))
      .map(o => [String(o.name || "").trim().toLowerCase(), o.id]));

    for (const g of plan.plan_) {
      const funderId = resolved.get(g.funderName);
      const fundId = g.fundName ? funds.get(String(g.fundName).trim().toLowerCase()) || null : null;
      const officerId = g.officerName ? officers.get(String(g.officerName).trim().toLowerCase()) || null : null;
      const unmatched = [
        g.fundName && !fundId ? `The file named the fund "${g.fundName}", which is not on the chart of accounts.` : null,
        g.officerName && !officerId ? `The file named "${g.officerName}" as the officer, who is not a user here.` : null,
      ].filter(Boolean);
      const notes = [g.notes, ...unmatched].filter(Boolean).join(" ").slice(0, 4000) || null;
      const id = newId("gr");
      await trun(
        `INSERT INTO grants (id,org_id,funder,funder_donor_id,program,amount,amount_requested,amount_awarded,
                             status,deadline,restriction,fund_id,officer_id,cycle_name,decline_reason,declined_on,
                             external_id,notes,is_sample,created_by,created_by_name)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,FALSE,?,?)`,
        [id, orgId, g.funderName, funderId, g.program,
         toDollars(g.amountAwardedCents || g.amountRequestedCents),
         toDollars(g.amountRequestedCents),
         g.amountAwardedCents == null ? null : toDollars(g.amountAwardedCents),
         g.status, g.deadline, g.restriction, fundId, officerId, g.cycleName,
         g.declineReason, g.declinedOn, g.externalId, notes, who.id, byName]);
      // AN AWARDED GRANT IMPORTED FROM A FILE GETS NO PLEDGE. Part 1's award door
      // writes one because a live award is money now promised; a historical award
      // in a spreadsheet already had its cheques, and minting instalments for it
      // would put money on the books twice — once as the file's history and once
      // as a promise nobody is waiting for.
      // WIRE-1: every status that holds an award (awarded, reporting, closed)
      // is stamped, and from the file's decision date when it has one, so a
      // 2019 award does not count as this year's. No date: today, as before.
      if (GS.AWARDED_STATUS_KEYS.includes(g.status)) {
        await trun("UPDATE grants SET awarded_at=COALESCE(awarded_at, ?::date::timestamptz, NOW()) WHERE id=? AND org_id=?",
          [g.decidedOn || null, id, orgId]);
      }
      // The report the file says is due becomes the grant's report_due
      // deadline, so it reaches Home, the calendar and the grant's timeline.
      if (g.reportDue) {
        await trun(`INSERT INTO grant_milestones (id,org_id,grant_id,kind,label,due_date,state,notes,created_by,created_by_name)
                    VALUES (?,?,?,'report_due',NULL,?,'pending','',?,?)`,
          [newId("gms"), orgId, id, g.reportDue, who.id, byName]);
      }
      written.push({ id, line: g.line, funderName: g.funderName, program: g.program, status: g.status });
    }
    if (SH) {
      const placed = new Set(Object.values(plan.mapping || {}));
      keptSheet = await SH.sheetRowTx(trun, { orgId, kind: "grant_import", title: String(req.body.sheet.fileName || "Grant tracker"),
        file: sheetFile, sheetName: req.body.sheet.sheetName, headers: req.body.headers, rows: req.body.rows,
        unplacedCols: (req.body.headers || []).map(h => String(h == null ? "" : h).trim()).filter(h => h && !placed.has(h)),
        grantIds: written.map(w => w.id), who: { id: who.id, name: byName } });
    }
  });

  const pipelineCents = plan.pipelineCents;
  res.status(201).json({
    source: plan.source, mapping: plan.mapping, unrecognised: plan.unrecognised,
    counts: { ...plan.counts, created: created.length },
    created, grants: written, refused: plan.refused,
    pipelineCents, pipeline: toDollars(pipelineCents),
    sentence: I.importSentence({ grants: written.length, funders: plan.counts.funders,
      created: created.length, skipped: plan.counts.skipped, refused: plan.refused.length,
      pipelineCents }, money.formatCentsPlain),
    writes: plan.writes, doesNotWrite: plan.doesNotWrite,
    ...(keptSheet ? { sheet: { id: keptSheet.id, unplacedColumns: keptSheet.unplaced.columns } } : {}),
    wrote: true,
  });
}));

// GET /grants/import/sources — what Steward can read, and how sure it is of each.
app.get("/grants/import/sources", requireAuth, wrap(async (req, res) => {
  const I = await grantImportMod();
  res.json({ sources: I.GRANT_SOURCES, fields: I.GRANT_FIELD_KEYS,
             columns: I.GRANT_COLUMNS, statusVocabulary: I.SOURCE_STATUS });
}));

// ── BUILD-100 (grants) Part 5 — THE AGENT DRAFTS A REPORT OUTLINE ───────────
// "Draft the report outline for the Sunrise grant." What comes back is built
// ONLY from that grant's own rows: what was promised, what the funder paid, what
// was spent, and the programme's giving and people in the period.
//
// shared/grantOutline.js is the guarantee — no numeric field anywhere in the
// schema, so every figure a reader sees is rendered HERE from the rows. And the
// rule this part adds: an OUTCOME claim with no citation is dropped and counted,
// because Steward holds no programme outcomes and a grant report is precisely
// where a fluent model will invent one.
async function grantOutlineMod() { return import("../../shared/grantOutline.js"); }

// WHAT THE MODEL IS HANDED, AND NOTHING ELSE — the same shape as the prospect
// brief's row gathering, so there is one idea in this product about how a model
// is grounded rather than two.
async function grantOutlineRowsFor(orgId, grantId, { from = null, to = null } = {}) {
  const R = await restrictedMod();
  const M = await grantMsMod();
  const V = await import("../../shared/vocabulary.js");
  const org = await orgTz(orgId);
  const [orgRow] = await query("SELECT * FROM orgs WHERE id=?", [orgId]);
  const t = V.makeT(orgRow && orgRow.vocabulary_json);
  const today = orgToday(org);                                          // ORG_TZ_SEAM_OK

  const rows = await grantMoneyRows(orgId, "AND g.id = ?", [grantId]);
  if (!rows.length) return null;
  const [g] = await query(
    `SELECT g.*, d.name AS funder_name, u.name AS officer_name, f.name AS fund_name
       FROM grants g
       LEFT JOIN donors d ON d.id = g.funder_donor_id AND d.org_id = g.org_id
       LEFT JOIN users u ON u.id = g.officer_id AND u.org_id = g.org_id
       LEFT JOIN fin_funds f ON f.id = g.fund_id AND f.org_id = g.org_id
      WHERE g.id=? AND g.org_id=?`, [grantId, orgId]);
  const balance = grantBalanceFrom(R, rows[0], today);

  // THE PERIOD. Default is the whole life of the award — from the day it was
  // awarded (else the day the grant was opened) to today. A report period the
  // caller states wins, because a funder names its own.
  const CIVIL = /^\d{4}-\d{2}-\d{2}$/;
  const start = CIVIL.test(String(from || "")) ? String(from)
    : (g.awarded_at ? orgToday(org, g.awarded_at)                       // ORG_TZ_SEAM_OK
       : (g.created_at ? orgToday(org, g.created_at) : today));         // ORG_TZ_SEAM_OK
  const end = CIVIL.test(String(to || "")) ? String(to) : today;

  const refs = new Set([`grant:${g.id}`]);
  const lines = [];
  const fundWord = t("fund_singular") || "fund";

  // 1 — THE GRANT ITSELF: what was promised, in the proposal's own fields.
  lines.push(`grant:${g.id}: a grant from ${g.funder_name || "a funder"} for "${g.program || "no program named"}", `
    + `requested ${money.formatCentsPlain(toCents(g.amount_requested) || 0)}, `
    + `awarded ${money.formatCentsPlain(balance.awardedCents)}, currently ${g.status}`
    + `${g.fund_name ? `, designated to the ${fundWord} "${g.fund_name}"` : ""}`
    + `${g.restriction ? `, restriction "${g.restriction}"` : ""}`
    + `${g.officer_name ? `, on ${g.officer_name}'s desk` : ""}`
    + `${g.cycle_name ? `, cycle "${g.cycle_name}"` : ""}. `
    + `The reporting period here is ${start} to ${end}.`
    + (g.notes ? ` The note on the grant reads: "${String(g.notes).slice(0, 800)}"` : ""));

  // 2 — THE DOCUMENTS. NOTHING IS PARSED: Steward stores a file, types it and
  // dates it, so the row says a proposal EXISTS — never what it said. A model
  // handed a filename must not be able to quote a document nobody read.
  for (const d of await query(
    `SELECT id, doc_type, file_name, uploaded_at FROM grant_documents
      WHERE org_id=? AND grant_id=? ORDER BY uploaded_at ASC`, [orgId, g.id])) {
    refs.add(`document:${d.id}`);
    // THE ORG'S OWN CALENDAR, not UTC. `toISOString().slice(0,10)` on a
    // timestamptz is a day out for every org west of Greenwich after 7pm, and
    // `date-seam` is right to count it as an unrouted site (BUILD-89S's gotcha).
    const storedOn = d.uploaded_at ? orgToday(org, d.uploaded_at) : null;     // ORG_TZ_SEAM_OK
    lines.push(`document:${d.id}: a ${grantDocs.docTypeLabel(d.doc_type).toLowerCase()} on file, "${d.file_name}", `
      + `stored ${storedOn || "on a date the record does not carry"}. `
      + `Steward has NOT read this file; only that it exists is known.`);
  }

  // 3 — WHAT THE FUNDER PAID: payments applied to the award, each its own row.
  for (const p of g.award_pledge_id ? await query(
    `SELECT g.id, g.amount, g.date FROM gifts g WHERE g.org_id=? AND g.pledge_id=? AND ${NUMBERS.money.MONEY("g")} ORDER BY g.date ASC`,   // NUMBERS-5: the rows behind received
    [orgId, g.award_pledge_id]) : []) {
    refs.add(`payment:${p.id}`);
    lines.push(`payment:${p.id}, ${money.formatCentsPlain(toCents(p.amount) || 0)} received on ${p.date}, applied to this award.`);
  }
  lines.push(`grant:${g.id}: of the award, ${money.formatCentsPlain(balance.receivedCents)} has been received and `
    + `${money.formatCentsPlain(balance.outstandingCents)} is still owed by the funder.`);

  // 4 — WHAT WAS SPENT AGAINST IT. Entered by hand; the row says so, because a
  // report that implies a bank feed is a report claiming more than it can.
  for (const s of await query(
    `SELECT id, amount, spent_on, description FROM grant_spend
      WHERE org_id=? AND grant_id=? ORDER BY spent_on ASC`, [orgId, g.id])) {
    refs.add(`spend:${s.id}`);
    lines.push(`spend:${s.id}, ${money.formatCentsPlain(toCents(s.amount) || 0)} spent on ${s.spent_on}: "${s.description}". Entered by hand, not read from a bank.`);
  }
  lines.push(`grant:${g.id} · ${money.formatCentsPlain(balance.spentCents)} has been recorded as spent against this award, `
    + `leaving ${money.formatCentsPlain(balance.remainingCents)} of the money received still to spend.`);

  // 5 — THE PROGRAMME'S OWN GIVING IN THE PERIOD. Only gifts to THIS grant's
  // fund: a gift to another fund is not evidence about this programme.
  let fundGifts = [], givers = [];
  if (g.fund_id) {
    fundGifts = await query(
      `SELECT gi.id, gi.amount, gi.date, gi.donor_id, d.name AS donor_name
         FROM gifts gi LEFT JOIN donors d ON d.id = gi.donor_id AND d.org_id = gi.org_id
        WHERE gi.org_id=? AND gi.fund_id=? AND gi.is_sample IS NOT TRUE AND ${NUMBERS.money.MONEY("gi")}
          AND gi.date >= ? AND gi.date <= ?
        ORDER BY gi.amount DESC NULLS LAST, gi.id LIMIT 25`, [orgId, g.fund_id, start, end]);
    for (const gi of fundGifts) {
      refs.add(`gift:${gi.id}`);
      lines.push(`gift:${gi.id} · ${money.formatCentsPlain(toCents(gi.amount) || 0)} to the ${fundWord} "${g.fund_name}" on ${gi.date}`
        + `${gi.donor_name ? ` from ${gi.donor_name}` : ""}.`);
    }
    givers = await query(
      // NUMBERS-5: a fact the model may state, so it is money (credit rows out).
      `SELECT d.id, d.name, COUNT(gi.id) FILTER (WHERE gi.amount > 0) AS gifts, ${NUMBERS.money.MONEY_SUM("gi")} AS total
         FROM gifts gi JOIN donors d ON d.id = gi.donor_id AND d.org_id = gi.org_id
        WHERE gi.org_id=? AND gi.fund_id=? AND gi.is_sample IS NOT TRUE AND ${NUMBERS.money.MONEY("gi")}
          AND gi.date >= ? AND gi.date <= ? AND d.deleted_at IS NULL
        GROUP BY d.id, d.name ORDER BY total DESC NULLS LAST, d.id LIMIT 12`,
      [orgId, g.fund_id, start, end]);
    for (const p of givers) {
      refs.add(`person:${p.id}`);
      lines.push(`person:${p.id} · ${p.name} gave ${Number(p.gifts)} ${Number(p.gifts) === 1 ? "gift" : "gifts"} `
        + `totalling ${money.formatCentsPlain(toCents(p.total) || 0)} to this ${fundWord} in the period.`);
    }
  }

  // 6 — THE DEADLINES ON IT, so the outline can say what is due and when.
  for (const ms of await query(
    `SELECT id, kind, due_date, state, notes FROM grant_milestones
      WHERE org_id=? AND grant_id=? ORDER BY due_date ASC`, [orgId, g.id])) {
    refs.add(`milestone:${ms.id}`);
    lines.push(`milestone:${ms.id} · ${M.milestoneStepLabel({ kind: ms.kind, funderName: g.funder_name, program: g.program })}, `
      + `due ${ms.due_date}, currently ${ms.state}`
      + `${String(ms.notes || "").trim() ? `. The note on it: "${String(ms.notes).slice(0, 300)}"` : "."}`);
  }

  // 7 — CONVERSATIONS WITH THE FUNDER, quoted rather than summarised away.
  if (g.funder_donor_id) {
    for (const i of await query(
      `SELECT id, type, date, note, logged_by_name FROM interactions
        WHERE org_id=? AND donor_id=? AND COALESCE(note,'') <> ''
        ORDER BY date DESC NULLS LAST, created_at DESC LIMIT 5`, [orgId, g.funder_donor_id])) {
      refs.add(`conversation:${i.id}`);
      lines.push(`conversation:${i.id} · ${i.type} on ${i.date}${i.logged_by_name ? ` logged by ${i.logged_by_name}` : ""}: "${String(i.note).slice(0, 500)}"`);
    }
  }

  // THE GROUNDED NUMERIC SET, through the money seam (never a bare Math.round on
  // a dollars value — `tests/money-cents.test.js` is right about that shape
  // wherever it appears, and a text check is not an exemption).
  const grounded = [];
  const push = v => { const c = toCents(v); if (c != null) { grounded.push(toDollars(c), c); } };
  push(g.amount_requested); push(g.amount_awarded);
  for (const k of ["awardedCents", "receivedCents", "spentCents", "outstandingCents", "remainingCents"]) {
    grounded.push(balance[k], toDollars(balance[k]));
  }
  for (const gi of fundGifts) push(gi.amount);
  for (const p of givers) { push(p.total); grounded.push(Number(p.gifts) || 0); }
  grounded.push(fundGifts.length, givers.length);
  for (const l of lines) for (const m of String(l).matchAll(/\d+(?:\.\d+)?/g)) grounded.push(Number(m[0]));

  return {
    grant: g, org: orgRow, t, balance, refs, lines,
    grounded: [...new Set(grounded.filter(Number.isFinite))],
    period: { from: start, to: end },
    counts: { documents: refs.size, fundGifts: fundGifts.length, people: givers.length },
  };
}

// GET /grants/:id/outline-rows — EXACTLY what the model would be handed. Like
// the brief's, this is not a test seam: the outline's promise is that every
// sentence rests on a row you can open, and this is that list — provable with no
// API key configured at all.
app.get("/grants/:id/outline-rows", requireAuth, wrap(async (req, res) => {
  const ctx = await grantOutlineRowsFor(req.user.orgId, req.params.id,
    { from: req.query.from, to: req.query.to });
  if (!ctx) return res.status(404).json({ error: "Grant not found" });
  res.json({
    grantId: ctx.grant.id, funderName: ctx.grant.funder_name || "", program: ctx.grant.program || "",
    period: ctx.period, refs: [...ctx.refs], lines: ctx.lines, groundedValues: ctx.grounded,
  });
}));

// POST /grants/:id/report-outline — draft it, validate it, log it as an agent run.
app.post("/grants/:id/report-outline", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const O = await grantOutlineMod();
  const TH = await thresholdsMod();
  const orgId = req.user.orgId;
  // THE GRANT IS CHECKED FIRST, and that order is the point — the same defect
  // the prospect brief paid for (BUILD-99): running the key gate first answers
  // 503 to a cross-tenant probe instead of 404, telling the caller both that the
  // route exists and what Steward's key state is.
  const ctx = await grantOutlineRowsFor(orgId, req.params.id, { from: req.body.from, to: req.body.to });
  if (!ctx) return res.status(404).json({ error: "Grant not found" });

  const gate = await agentGate(orgId);
  if (!gate.ok) return res.status(503).json({ error: "outline_unavailable", reason: gate.reason,
    message: gate.reason === "ai_disabled" ? AI_OFF_MESSAGE
      : "Not set up yet. Steward support can turn on AI drafting for this server, then an admin switches it on in Settings, Data." });

  const runId = newId("arun");
  await run(`INSERT INTO agent_runs (id,org_id,status,plan,read_summary) VALUES (?,?,?,?,?)`,
    [runId, orgId, "running", JSON.stringify({ kind: "grant_report_outline", grantId: ctx.grant.id }),
     `${ctx.refs.size} rows on the ${ctx.grant.funder_name || "funder"} grant`]);

  const system = [
    "You are drafting the OUTLINE of a report to a funder about a grant. A human will write the report from it and send it.",
    "",
    "You are given ROWS from this organization's own records. Each row starts with a reference of the form kind:id.",
    "Write short, plain sentences about what those rows say. Every sentence must cite the references it rests on, exactly as given.",
    "",
    "RULES, and the first one is the whole job:",
    "- YOU MAY NOT STATE AN OUTCOME. This organization's records hold money, dates, documents and people, they do not hold",
    "  attendance, results, or what changed for anybody. Do not write that anyone was served, reached, helped or improved.",
    "  The outcomes section is a PROMPT to the human who knows; say plainly that the records cannot supply it.",
    "- Use no figure that is not in the rows you were handed, and state no rule about how grants or giving work.",
    "- A document row means a file EXISTS. You have not read it. Never say what a proposal or report said.",
    "- Money still owed by the funder is not money received, and money received is not money spent. Keep them apart.",
    "- Quote a conversation rather than summarizing away the words the officer chose.",
    "- Leave a section out if the rows say nothing about it. Do not pad.",
    "- The headline names the grant and the period, and contains no figure.",
    "",
    "The sections you may use, and what each rests on:",
    ...O.OUTLINE_SECTIONS.map(s => `- ${s.heading} · ${s.source || "NOTHING IN THE RECORDS. Say so; do not invent it."}`),
  ].join("\n");
  const user = [
    `The rows, on the ${ctx.grant.funder_name || "funder"} grant for "${ctx.grant.program || "no program named"}", `
      + `period ${ctx.period.from} to ${ctx.period.to}:`,
    "", ...ctx.lines, "", "Draft the outline.",
  ].join("\n");

  let raw = null, err = null;
  try {
    const client = anthropicFor(orgId);
    const msg = await client.messages.create({
      model: AGENT_MODEL, max_tokens: 2000, system,
      tools: [{ name: "outline", description: "The report outline a human writes the report from.", strict: true, input_schema: O.OUTLINE_SCHEMA }],
      tool_choice: { type: "tool", name: "outline" },
      messages: [{ role: "user", content: user }],
    });
    raw = (msg.content || []).find(b => b.type === "tool_use" && b.name === "outline")?.input || null;
  } catch (e) { err = e.message || String(e); }

  if (!raw) {
    await run("UPDATE agent_runs SET status='failed', finished_at=NOW(), error=? WHERE id=?", [err || "no outline returned", runId]);
    return res.status(502).json({ error: "The outline could not be drafted just now.", runId });
  }

  const checked = O.validateOutline(raw, {
    rows: ctx.refs,
    ungrounded: text => TH.ungroundedClaims(text, { groundedValues: ctx.grounded }).map(c => c.raw),
  });
  const payload = grantOutlinePayload(ctx, checked);
  // THE FIGURES ARE STORED, NOT RECOMPUTED (the BUILD-87 Part 1 rule). A payment
  // arriving next week must not silently change what an outline drafted today
  // says the funder had paid — a draft somebody is working from is evidence of a
  // moment, and one that edits itself is worth less than none.
  await run(
    `UPDATE agent_runs SET status='done', finished_at=NOW(), actions=?, declined=?, withheld=?, withheld_reason=? WHERE id=?`,
    [JSON.stringify({ outline: checked, grantId: ctx.grant.id, period: ctx.period, payload }),
     checked.droppedCount, checked.droppedCount, checked.droppedSentence, runId]);

  res.json({ runId, ...payload });
}));

// ONE shape for the outline, read by the POST and by the read-back — a second
// assembly is a second place for the figures to disagree with the rows.
function grantOutlinePayload(ctx, checked) {
  return {
    grantId: ctx.grant.id, funderName: ctx.grant.funder_name || "", program: ctx.grant.program || "",
    period: ctx.period,
    headline: checked.headline, sections: checked.sections,
    // EVERY FIGURE IS STEWARD'S, rendered from the rows the model was handed.
    figures: {
      awarded: ctx.balance.awarded, received: ctx.balance.received,
      spent: ctx.balance.spent, outstanding: ctx.balance.outstanding, remaining: ctx.balance.remaining,
      awardedCents: ctx.balance.awardedCents, receivedCents: ctx.balance.receivedCents,
      spentCents: ctx.balance.spentCents, outstandingCents: ctx.balance.outstandingCents,
      remainingCents: ctx.balance.remainingCents,
      programmeGifts: ctx.counts.fundGifts, programmePeople: ctx.counts.people,
    },
    balanceSentence: ctx.balance.sentence,
    dropped: checked.dropped, droppedSentence: checked.droppedSentence,
    outcomesPrompt: checked.outcomesPrompt,
    rowsRead: ctx.refs.size, footer: checked.footer,
  };
}

app.get("/grants/:id/manual-match", requireAuth, wrap(async (req, res) => {
  const rows = await query("SELECT id, funder, program, amount, status FROM grants WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!rows.length) return res.status(404).json({ error: "Grant not found" });
  const g = rows[0];
  const cutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const funder = String(g.funder || "").trim().toLowerCase();
  const amt = parseFloat(g.amount) || 0;
  const matches = await query(
    `SELECT id, date, description, vendor_donor, amount, fund_id
     FROM fin_transactions
     WHERE org_id=? AND source='manual' AND type='income' AND grant_id IS NULL AND date >= ?
       AND (
         (vendor_donor <> '' AND (lower(vendor_donor) LIKE ? OR ? LIKE '%' || lower(vendor_donor) || '%'))
         OR lower(description) LIKE ?
         OR (? > 0 AND amount = ?)
       )
     ORDER BY date DESC NULLS LAST LIMIT 5`,
    [req.user.orgId, cutoff, `%${funder}%`, funder, `%${funder}%`, amt, amt]
  );
  res.json({ grantId: g.id, funder: g.funder, program: g.program || "", amount: amt, matches: matches.map(m => ({ ...m, amount: parseFloat(m.amount) })) });
}));

app.delete("/grants/:id", requireAuth, wrap(async (req, res) => {
  // SECURE-1: whoever entered the grant, or an admin (as gifts and pledges).
  const [gr] = await query("SELECT created_by FROM grants WHERE id = ? AND org_id = ?", [req.params.id, req.user.orgId]);
  if (!gr) return res.status(404).json({ error: "Not found" });
  if (!(await mayEditLogged(req, gr))) return res.status(403).json(NOT_YOURS);
  const { changes } = await run("DELETE FROM grants WHERE id = ? AND org_id = ?", [req.params.id, req.user.orgId]);
  if (!changes) return res.status(404).json({ error: "Not found" }); // BUILD-75 B: a foreign/unknown id answers 404, never a false success — one answer everywhere
  res.json({ success: true });
}));

app.get("/grants/:id", requireAuth, wrap(async (req, res) => {
  const rows = await withGrantReceived(req.user.orgId, await query("SELECT * FROM grants WHERE id = ? AND org_id = ?", [req.params.id, req.user.orgId]));
  if (!rows.length) return res.status(404).json({ error: "Not found" });
  const g = rows[0];
  g.history = JSON.parse(g.history || "[]");
  const ints = await query(
    "SELECT * FROM grant_interactions WHERE grant_id = ? ORDER BY date DESC NULLS LAST, created_at DESC",
    [req.params.id]
  );
  g.interactions = ints;
  res.json(g);
}));

app.post("/grants/:id/interactions", requireAuth, wrap(async (req, res) => {
  const { type, note, date } = req.body;
  if (!note || !note.trim()) return res.status(400).json({ error: "Note required" });
  const rows = await query("SELECT id, program, funder, funder_donor_id FROM grants WHERE id = ? AND org_id = ?", [req.params.id, req.user.orgId]);
  if (!rows.length) return res.status(404).json({ error: "Grant not found" });
  const id = newId("gi");
  const giDate = date || orgToday(await orgTz(req.user.orgId));   // ORG_TZ_SEAM_OK (FIX-14 Part 2b)
  await run(
    "INSERT INTO grant_interactions (id, org_id, grant_id, type, note, date) VALUES (?,?,?,?,?,?)",
    [id, req.user.orgId, req.params.id, type || "note", note.trim(), giDate]
  );
  // WIRE-1: a grant note nobody read: it is also on the funder's timeline,
  // as the conversation it was, so the funder record tells the whole story.
  if (rows[0].funder_donor_id) {
    const who = await staffWho(req);
    await TL.timelineLine({ orgId: req.user.orgId, donorId: rows[0].funder_donor_id,
      type: "note",
      note: `${type && type !== "note" ? String(type).charAt(0).toUpperCase() + String(type).slice(1).replace(/_/g, " ") + " on" : "On"} the ${rows[0].program || rows[0].funder || "grant"} grant: ${note.trim()}`, date: giDate,
      actorId: who.id, actorName: who.name, key: `grant_note:${id}`,
      metadata: { via: "grant_interaction", grant_id: rows[0].id, grant_interaction_id: id } });
  }
  res.status(201).json({ id, type: type || "note", note: note.trim(), date: giDate });
}));
}

module.exports = { routers, mount };
