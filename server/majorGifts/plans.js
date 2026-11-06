// server/majorGifts/plans.js — proposals, planned gifts, cultivation templates and plans.
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
// FIX-11 Part 1 — the audit log's own vocabulary (the sentence a row reads as).
// The WRITING of a row happens in middleware/auditTrail.js and nowhere else.
const auditTrailMod = require("../../auditTrail");
const PW = require("../../pledgeWrite");   // FIX-60: the one writer of a pledge and its installments

const routers = {
  r1: express.Router(),
};

function mount(ctx) {
const {
  NOT_YOURS, OU, PERSON_ONLY_SENTENCE, UNDO_SECONDS, actor, advanceCultivationPlan, checkWriteAccess,
  editStamp, mayEditLogged, money, openProposalConflict, orgFundNames, orgOwns, orgTime, orgToday, orgTz,
  parseMoneyOrThrow, planMod, proposalMod, query, requireAuth, requireCrm, run, toCents, toDollars, trashRow,
  uuid, wrap,
} = ctx;
let app = routers.r1;

app.get("/donors/:id/planned-gifts", requireAuth, wrap(async (req, res) => {
  if (!(await orgOwns("donors", req.params.id, req.user.orgId))) return res.status(404).json({ error: "Donor not found" }); // BUILD-75 B: the parent must be YOURS before children are answered — even an empty list confirms nothing about another tenant
  const rows = await query("SELECT * FROM planned_gifts WHERE donor_id=? AND org_id=? ORDER BY created_at DESC", [req.params.id, req.user.orgId]);
  res.json(rows);
}));

app.post("/donors/:id/planned-gifts", requireAuth, wrap(async (req, res) => {
  const { type, estimated_value, date_indicated, notes } = req.body;
  if (!type) return res.status(400).json({ error: "type required" });
  const donorCheck = await query("SELECT id, name, kind, planned_giving FROM donors WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!donorCheck.length) return res.status(404).json({ error: "Donor not found" });
  // BUILD-97 Part 2 — every planned-gift type is a thing that happens because a
  // PERSON died. A foundation does not leave a bequest.
  if (donorCheck[0].kind === "organisation" || donorCheck[0].kind === "anonymous") {
    return res.status(400).json({ error: PERSON_ONLY_SENTENCE("be given a planned gift", donorCheck[0].name) });
  }
  const id = newId("pg");
  await run(
    "INSERT INTO planned_gifts (id,org_id,donor_id,type,estimated_value,date_indicated,notes,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,?)",
    [id, req.user.orgId, req.params.id, type, estimated_value||null, date_indicated||null, notes||"", actor(req).id, actor(req).name]
  );
  if (!donorCheck[0].planned_giving) {
    await run("UPDATE donors SET planned_giving=true WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  }
  const rows = await query("SELECT * FROM planned_gifts WHERE id=?", [id]);
  // Log interaction
  try {
    const userRow = await query("SELECT name FROM users WHERE id=?", [req.user.userId]);
    const userName = userRow[0]?.name || "";
    await run(
      "INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name) VALUES (?,?,?,?,?,?,?,?)",
      [newId("int"), req.user.orgId, req.params.id, "planned_gift",
       `Planned gift indicated: ${type.replace(/_/g," ")}${estimated_value ? " (est. $" + Number(estimated_value).toLocaleString() + ")" : ""}`,
       orgToday(await orgTz(req.user.orgId)), req.user.userId, userName]   // ORG_TZ_SEAM_OK FIX-14 Part 1 — was the UTC day
    );
  } catch(e) { console.error("Planned gift log:", e.message); }
  res.status(201).json(rows[0]);
}));

app.put("/planned-gifts/:id", requireAuth, wrap(async (req, res) => {
  const existing = await query("SELECT * FROM planned_gifts WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!existing.length) return res.status(404).json({ error: "Not found" });
  const pg = existing[0];
  const { type, estimated_value, date_indicated, notes } = req.body;
  await run(
    "UPDATE planned_gifts SET type=?,estimated_value=?,date_indicated=?,notes=? WHERE id=? AND org_id=?",
    [type||pg.type, estimated_value!==undefined?estimated_value:pg.estimated_value,
     date_indicated!==undefined?date_indicated:pg.date_indicated, notes!==undefined?notes:pg.notes,
     req.params.id, req.user.orgId]
  );
  const rows = await query("SELECT * FROM planned_gifts WHERE id=?", [req.params.id]);
  res.json(rows[0]);
}));

app.delete("/planned-gifts/:id", requireAuth, wrap(async (req, res) => {
  const existing = await query("SELECT * FROM planned_gifts WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!existing.length) return res.status(404).json({ error: "Not found" });
  const undoId = await trashRow("planned_gifts", req.params.id, req);
  if (!undoId) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true, deleted: 1, undoId, undoSeconds: UNDO_SECONDS });
}));

// THE DATABASE FORMATS THE DATE, AND NOTHING HERE PARSES ONE.
// A `DATE` column comes back from pg as a JS Date at LOCAL midnight, so
// `String(d).slice(0,10)` is "Sun Nov 15" — which is what this screen showed on
// its first run. The first fix read the Date's LOCAL calendar parts, which is
// right for THIS input and is still the wrong SHAPE: `tests/date-seam.test.js`
// names any helper that reads a process-local date as tainted, and it is right
// to, because the next caller will hand it something built in a different zone.
// So the date is TO_CHAR'd in SQL (BUILD-86's own gotcha says exactly this) and
// read as the string it already is. There is no date helper here to taint.
// The wire shape. Money leaves as dollars (every other money route does) AND as
// integer cents, because the weighted total is computed in cents and a screen
// that re-derives cents from a float is how a total ends up a penny out.
function proposalRow(r, funds) {
  const askCents = toCents(r.target_amount) || 0;
  return {
    id: r.id, donorId: r.donor_id, donorName: r.donor_name || undefined,
    purpose: r.name || "", askAmount: toDollars(askCents), askCents,
    stage: r.proposal_stage, status: r.status,
    probability: r.probability == null ? null : Number(r.probability),
    expectedClose: r.expected_close_civil || null,
    fundId: r.fund_id || null,
    fundName: r.fund_id ? (funds?.get(r.fund_id) || null) : null,
    officerId: r.officer_id || null, officerName: r.officer_name || "",
    notes: r.notes || "",
    declineReason: r.decline_reason || null, declinedOn: r.declined_on || null,
    commitKind: r.commit_kind || null,
    giftId: r.gift_id || null, pledgeId: r.pledge_id || null,
    giftAmount: r.gift_amount == null ? null : toDollars(toCents(r.gift_amount) || 0),
    createdAt: r.created_at, closedAt: r.closed_at,
    createdByName: r.created_by_name || "",
    // FIX-14 Part 3 — the profile's "Edited" marker reads these.
    edited_at: r.edited_at || null, edited_by_name: r.edited_by_name || null,
  };
}

// A fund id a caller names is checked against THIS org before anything is
// written — never trusted off a payload (the recordGift rule, same reason).
async function checkProposalFund(orgId, fundId) {
  if (!fundId) return { ok: true, fundId: null };
  const rows = await query("SELECT id, name FROM fin_funds WHERE id=? AND org_id=?", [fundId, orgId]);
  if (!rows.length) return { ok: false };
  return { ok: true, fundId: rows[0].id, fundName: rows[0].name };
}

// GET /donors/:id/proposals — the proposals on one person, newest ask first with
// the open ones on top. The profile panel sits ABOVE giving history.
app.get("/donors/:id/proposals", requireAuth, wrap(async (req, res) => {
  if (!(await orgOwns("donors", req.params.id, req.user.orgId))) return res.status(404).json({ error: "Donor not found" });
  const P = await proposalMod();
  const funds = await orgFundNames(req.user.orgId);
  const rows = await query(
    `SELECT *, to_char(expected_close,'YYYY-MM-DD') AS expected_close_civil FROM opportunities WHERE org_id=? AND donor_id=?
      ORDER BY (proposal_stage = ANY(?::text[])) DESC, expected_close NULLS LAST, created_at DESC`,
    [req.user.orgId, req.params.id, P.OPEN_STAGE_KEYS]);
  const proposals = rows.map(r => proposalRow(r, funds));
  const w = P.weightedTotal(proposals);
  res.json({
    proposals,
    weighted: { cents: w.cents, amount: toDollars(w.cents), counted: w.counted, unset: w.unset, openCount: w.openCount,
                sentence: P.weightedSentence(w, money.formatCentsPlain) },
    stages: P.PROPOSAL_STAGES, probabilities: P.PROBABILITIES, declineReasons: P.DECLINE_REASONS,
    // The profile's own form needs the pickers too, or it can only ever offer
    // "no fund" and "the relationship owner" — found by the walk.
    funds: [...funds.entries()].map(([id, name]) => ({ id, name })),
    officers: (await query("SELECT id, name FROM users WHERE org_id=? ORDER BY name", [req.user.orgId]).catch(() => []))
      .map(o => ({ id: o.id, name: o.name })),
  });
}));

// POST /donors/:id/proposals — one ask. Team, because the whole major-gifts
// layer is (the BUILD-19/BUILD-20 split; a Core org sees the panel behind glass).
app.post("/donors/:id/proposals", requireAuth, requireCrm, checkWriteAccess, wrap(async (req, res) => {
  const P = await proposalMod();
  const orgId = req.user.orgId;
  const [donor] = await query("SELECT id, name, assigned_to, assigned_to_name FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL",
    [req.params.id, orgId]);
  if (!donor) return res.status(404).json({ error: "Donor not found" });

  // The money seam, never Number(): "$25,000.00" is how a person writes it.
  let askCents;
  try { askCents = parseMoneyOrThrow(req.body.askAmount !== undefined ? req.body.askAmount : req.body.targetAmount, "askAmount"); }
  catch (e) { return res.status(400).json({ error: e.message, code: e.code }); }

  const stage = String(req.body.stage || "identified").toLowerCase();
  const v = P.validateProposal({
    purpose: req.body.purpose !== undefined ? req.body.purpose : req.body.name,
    askCents, expectedClose: req.body.expectedClose, stage,
    probability: req.body.probability, declineReason: req.body.declineReason,
    declinedOn: req.body.declinedOn,
  }, { mode: "create" });
  if (!v.ok) return res.status(400).json({ error: v.errors[0].message, code: "invalid_proposal", errors: v.errors });

  const fund = await checkProposalFund(orgId, req.body.fundId || null);
  if (!fund.ok) return res.status(404).json({ error: "Fund not found" });

  // Officer = the relationship owner (BUILD-30: assignment IS the portfolio),
  // falling back to whoever is typing. An officer id a caller names must belong
  // to this org.
  let officerId = donor.assigned_to, officerName = donor.assigned_to_name;
  if (req.body.officerId) {
    const { ok, user: u } = await OU.orgUser(orgId, req.body.officerId);
    if (!ok) return OU.refuse(res, "officerId");
    officerId = u.id; officerName = u.name;
  }
  if (!officerId) { officerId = req.user.userId; officerName = (await query("SELECT name FROM users WHERE id=?", [req.user.userId]))[0]?.name || ""; }

  if (P.isOpenStage(stage)) {
    const clash = await openProposalConflict(orgId, donor.id, fund.fundId, null);
    if (clash) return res.status(409).json(clash);
  }

  const id = newId("opp");
  const status = P.statusForStage(stage);
  const prob = P.normalizeProbability(req.body.probability);
  // ONE statement, and the WHERE NOT EXISTS is the race guarantee: two officers
  // saving the same ask at the same second cannot both land. The unique index
  // would catch it too where it exists, but it does not exist on every org
  // (db.js says why), so the rule lives here.
  const ins = await query(
    `INSERT INTO opportunities
       (id,org_id,donor_id,name,target_amount,status,proposal_stage,probability,fund_id,notes,
        officer_id,officer_name,expected_close,created_by,created_by_name,updated_at)
     SELECT ?::text,?::text,?::text,?::text,?::numeric,?::text,?::text,?::integer,?::text,?::text,
            ?::text,?::text,?::date,?::text,?::text,NOW()
      WHERE NOT EXISTS (
        SELECT 1 FROM opportunities x WHERE x.org_id=?::text AND x.donor_id=?::text
          AND COALESCE(x.fund_id,'') = ?::text AND x.proposal_stage = ANY(?::text[]))
     RETURNING id`,
    [id, orgId, donor.id, P.sanitizePurpose(req.body.purpose !== undefined ? req.body.purpose : req.body.name),
     toDollars(askCents), status, stage, prob == null ? null : prob, fund.fundId,
     P.sanitizeNotes(req.body.notes), officerId, officerName || "", req.body.expectedClose,
     actor(req).id, actor(req).name,
     orgId, donor.id, fund.fundId || "", P.isOpenStage(stage) ? P.OPEN_STAGE_KEYS : []]);
  if (!ins.length) {
    const clash = await openProposalConflict(orgId, donor.id, fund.fundId, null);
    return res.status(409).json(clash || { code: "proposal_already_open", error: "There is already an open proposal for that fund." });
  }
  await logProposalLine(orgId, donor.id, req, `Proposal opened: ${P.sanitizePurpose(req.body.purpose !== undefined ? req.body.purpose : req.body.name)} · ${money.formatCentsPlain(askCents)}, ${P.stageLabel(stage)}`);
  const funds = await orgFundNames(orgId);
  const [row] = await query("SELECT *, to_char(expected_close,'YYYY-MM-DD') AS expected_close_civil FROM opportunities WHERE id=?", [id]);
  res.status(201).json(proposalRow(row, funds));
}));

// Every stage change is a line on the person's timeline, because "when did we
// ask, and what happened" has to be answerable from the record and not from
// somebody's memory of a screen.
async function logProposalLine(orgId, donorId, req, note) {
  // THE ORG'S CALENDAR, NOT THE PROCESS'S. `new Date().toISOString().slice(0,10)`
  // is a UTC day, so a proposal moved at 8pm Eastern would be stamped tomorrow
  // — and this row is what "when did we ask" reads off. Found by
  // tests/date-seam.test.js §5, which is what that scan is for.
  const org = await orgTz(orgId);
  await run(
    `INSERT INTO interactions (id,org_id,donor_id,type,date,note,created_by,logged_by_name)
     VALUES (?,?,?,'proposal',?,?,?,?)`,
    [newId("int"), orgId, donorId, orgToday(org), note,   // ORG_TZ_SEAM_OK
     actor(req).id, actor(req).name]).catch(e => console.error("[proposal] timeline:", e.message));
}

// PUT /proposals/:id — move it, edit it, or close it.
//
// THE THREE THINGS THIS ROUTE IS FOR:
//   · Committed writes a PLEDGE or a GIFT, never both. Whichever it writes is
//     linked on the row so the money is traceable to the ask, and the other
//     column stays null — a commitment counted twice is the BUILD-98 rule
//     ("a gift is counted once") wearing a different hat.
//   · Declined stores a reason from the list and the date, and does NOT reopen
//     silently: moving it back to an open stage needs `acknowledgeReopen`.
//   · `status` is never sent by a caller. It is derived from the stage, once,
//     by statusForStage — so the twenty BUILD-15/17/85/86 reads that filter on
//     it cannot disagree with what the screen shows.
app.put("/proposals/:id", requireAuth, requireCrm, checkWriteAccess, wrap(async (req, res) => {
  const P = await proposalMod();
  const orgId = req.user.orgId;
  const [existing] = await query("SELECT *, to_char(expected_close,'YYYY-MM-DD') AS expected_close_civil FROM opportunities WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!existing) return res.status(404).json({ error: "Proposal not found" });
  // FIX-14 Part 2b: the ask's officer, whoever opened it, or an admin.
  if (existing.officer_id !== req.user.userId && !(await mayEditLogged(req, existing))) return res.status(403).json(NOT_YOURS);

  const patch = {}, sets = [], params = [];
  const put = (col, val) => { sets.push(`${col}=?`); params.push(val); };

  if (req.body.purpose !== undefined) { patch.purpose = req.body.purpose; }
  if (req.body.askAmount !== undefined || req.body.targetAmount !== undefined) {
    try { patch.askCents = parseMoneyOrThrow(req.body.askAmount !== undefined ? req.body.askAmount : req.body.targetAmount, "askAmount"); }
    catch (e) { return res.status(400).json({ error: e.message, code: e.code }); }
  }
  if (req.body.expectedClose !== undefined) patch.expectedClose = req.body.expectedClose;
  if (req.body.probability !== undefined) patch.probability = req.body.probability;
  if (req.body.stage !== undefined) patch.stage = String(req.body.stage || "").toLowerCase();
  if (req.body.declineReason !== undefined) patch.declineReason = req.body.declineReason;
  if (req.body.declinedOn !== undefined) patch.declinedOn = req.body.declinedOn;
  if (req.body.commitKind !== undefined) patch.commitKind = req.body.commitKind;
  if (Object.keys(patch).length === 0 && req.body.notes === undefined && req.body.fundId === undefined
      && req.body.officerId === undefined) {
    return res.status(400).json({ error: "Nothing to update" });
  }

  const v = P.validateProposal(patch, { mode: "patch" });
  if (!v.ok) return res.status(400).json({ error: v.errors[0].message, code: "invalid_proposal", errors: v.errors });

  const toStage = patch.stage || existing.proposal_stage;
  const reopen = P.declineReopenRefusal(existing.proposal_stage, toStage, { acknowledged: req.body.acknowledgeReopen === true });
  if (reopen) return res.status(409).json({ code: reopen.code, error: reopen.message });

  let fundId = existing.fund_id;
  if (req.body.fundId !== undefined) {
    const f = await checkProposalFund(orgId, req.body.fundId || null);
    if (!f.ok) return res.status(404).json({ error: "Fund not found" });
    fundId = f.fundId;
  }
  // Moving INTO an open stage, or onto a different fund while open, re-runs the
  // one-open-per-fund rule. Staying put does not — that would refuse a row
  // because of itself.
  if (P.isOpenStage(toStage)) {
    const clash = await openProposalConflict(orgId, existing.donor_id, fundId, existing.id);
    if (clash) return res.status(409).json(clash);
  }

  if (patch.purpose !== undefined) put("name", P.sanitizePurpose(patch.purpose));
  if (patch.askCents !== undefined) put("target_amount", toDollars(patch.askCents));
  if (patch.expectedClose !== undefined) put("expected_close", patch.expectedClose);
  if (patch.probability !== undefined) put("probability", P.normalizeProbability(patch.probability));
  if (req.body.notes !== undefined) put("notes", P.sanitizeNotes(req.body.notes));
  if (req.body.fundId !== undefined) put("fund_id", fundId);
  if (req.body.officerId !== undefined) {
    const { ok, user: u } = await OU.orgUser(orgId, req.body.officerId);
    if (!ok || !u) return OU.refuse(res, "officerId");
    put("officer_id", u.id); put("officer_name", u.name);
  }

  let wrote = null;
  if (patch.stage !== undefined && patch.stage !== existing.proposal_stage) {
    put("proposal_stage", patch.stage);
    put("status", P.statusForStage(patch.stage));          // DERIVED, never sent
    const askCents = patch.askCents !== undefined ? patch.askCents : (toCents(existing.target_amount) || 0);

    if (patch.stage === "declined") {
      put("decline_reason", req.body.declineReason);
      // The date a decline is RECORDED is the org's civil today, never UTC's —
      // a no at 8pm Eastern is today's no, and this date is on the record for
      // good (reopening keeps it).
      put("declined_on", req.body.declinedOn || orgToday(await orgTz(orgId)));   // ORG_TZ_SEAM_OK
      sets.push("closed_at=NOW()");
      put("gift_id", null); put("pledge_id", null); put("commit_kind", null);
    } else if (patch.stage === "committed" || patch.stage === "stewarding") {
      // EXACTLY ONE of the two doors, and the caller says which. A commitment
      // with no door named is a pledge: "they said yes" without money in hand
      // is a promise, which is what a pledge is for.
      const kind = P.COMMIT_KINDS.includes(String(req.body.commitKind)) ? String(req.body.commitKind) : P.COMMIT_PLEDGE;
      const already = existing.pledge_id || existing.gift_id;
      if (!already) {
        if (kind === P.COMMIT_GIFT) {
          if (!req.body.giftId) return res.status(400).json({ error: "Name the gift this proposal closed with, or record it as a pledge.", code: "gift_required" });
          const [g] = await query("SELECT id, amount FROM gifts WHERE id=? AND org_id=?", [req.body.giftId, orgId]);
          if (!g) return res.status(404).json({ error: "Gift not found" });
          put("gift_id", g.id); put("gift_amount", g.amount); put("pledge_id", null);
          put("commit_kind", P.COMMIT_GIFT);
          wrote = { kind: P.COMMIT_GIFT, id: g.id };
        } else {
          const committedCents = req.body.committedAmount !== undefined
            ? (() => { try { return parseMoneyOrThrow(req.body.committedAmount, "committedAmount"); } catch { return null; } })()
            : askCents;
          if (!(committedCents > 0)) return res.status(400).json({ error: "A positive committed amount is required." });
          const due = req.body.pledgeDueDate || existing.expected_close_civil || orgToday(await orgTz(orgId));   // ORG_TZ_SEAM_OK
          // THE ONE PLEDGE WRITER (FIX-60), with its schedule. A frequency and a
          // count give a real schedule; neither given is one installment for the
          // whole commitment, so the existing rule in recordGift applies her
          // cheque to it from any door, to the cent. A schedule that does not
          // sum is refused before anything is written.
          let pid;
          try {
            ({ id: pid } = await PW.writePledge({ orgId, donorId: existing.donor_id, amountCents: committedCents, dueDate: String(due).slice(0, 10),
              notes: `Committed from the proposal: ${existing.name || "Ask"}`, createdBy: actor(req).id, createdByName: actor(req).name,
              plan: { schedule: req.body.installments, frequency: req.body.frequency, count: req.body.installmentCount, firstDue: String(due).slice(0, 10) } },
              { door: "pledge" }));
          } catch (e) {
            if (e.code === "schedule_does_not_sum") return res.status(400).json({ error: e.message, code: e.code });
            throw e;
          }
          put("pledge_id", pid); put("commit_kind", P.COMMIT_PLEDGE); put("gift_id", null); put("gift_amount", null);
          wrote = { kind: P.COMMIT_PLEDGE, id: pid };
        }
      }
      sets.push("closed_at=COALESCE(closed_at, NOW())");
    } else {
      // Back to an open stage: the close is undone, and whatever was written
      // stays written. A pledge is a commitment somebody made; reopening the
      // ask does not un-make it, and deleting it here would lose money.
      sets.push("closed_at=NULL");
    }
    await logProposalLine(orgId, existing.donor_id, req,
      `Proposal ${P.stageLabel(existing.proposal_stage)} → ${P.stageLabel(patch.stage)}: ${existing.name || "Ask"}`
      + (patch.stage === "declined" ? ` ${P.declineReasonLabel(req.body.declineReason)}` : "")
      + (wrote ? ` recorded as a ${wrote.kind}` : ""));
  }

  sets.push("updated_at=NOW()");
  params.push(req.params.id, orgId);
  await run(`UPDATE opportunities SET ${sets.join(",")} WHERE id=? AND org_id=?`, params);
  const funds = await orgFundNames(orgId);
  let [row] = await query("SELECT *, to_char(expected_close,'YYYY-MM-DD') AS expected_close_civil FROM opportunities WHERE id=?", [req.params.id]);
  // FIX-14 Part 2b — the table is `opportunities`, which the middleware cannot
  // find from /proposals, so the route hands it the before and after.
  if (auditTrailMod.diffFields(existing, row)) {
    await run("UPDATE opportunities SET edited_at=NOW(), edited_by=?, edited_by_name=? WHERE id=? AND org_id=?",
      [...(await editStamp(req)), req.params.id, orgId]);
    [row] = await query("SELECT *, to_char(expected_close,'YYYY-MM-DD') AS expected_close_civil FROM opportunities WHERE id=?", [req.params.id]);
  }
  if (req.audit) { req.audit.before(existing); req.audit.after(row); }
  res.json({ ...proposalRow(row, funds), wrote });
}));

// FIX-14 Part 2b: to the trash, so Undo can bring the ask back. A pledge or
// gift it closed with is not touched: a commitment is not un-made here.
app.delete("/proposals/:id", requireAuth, wrap(async (req, res) => {
  const [o] = await query("SELECT * FROM opportunities WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!o) return res.status(404).json({ error: "Not found" });
  if (o.officer_id !== req.user.userId && !(await mayEditLogged(req, o))) return res.status(403).json(NOT_YOURS);
  if (req.audit) req.audit.before(o);
  const undoId = await trashRow("opportunities", req.params.id, req);
  if (!undoId) return res.status(404).json({ error: "Not found" });
  res.json({ success: true, deleted: 1, undoId, undoSeconds: UNDO_SECONDS });
}));

// GET /proposals — the Proposals screen under Fundraising. Pipeline by stage in
// dollars and count, filter by officer and fund, sort by expected date.
// EVERY FIGURE CARRIES ITS SENTENCE, including the weighted total, which may
// not be rendered without one (shared/proposalShape.js says why).
app.get("/proposals", requireAuth, wrap(async (req, res) => {
  const P = await proposalMod();
  const orgId = req.user.orgId;
  const where = ["o.org_id = ?", "d.deleted_at IS NULL"], args = [orgId];
  if (!(await OU.orgUser(orgId, req.query.officerId, { allowInactive: true })).ok) return OU.refuse(res, "officerId");
  if (req.query.officerId) { where.push("o.officer_id = ?"); args.push(String(req.query.officerId)); }
  if (req.query.fundId) { where.push("o.fund_id = ?"); args.push(String(req.query.fundId)); }
  if (req.query.stage) {
    const st = String(req.query.stage).split(",").map(s => s.trim().toLowerCase()).filter(s => P.STAGE_KEYS.includes(s));
    if (!st.length) return res.status(400).json({ error: "Unknown stage" });
    where.push("o.proposal_stage = ANY(?::text[])"); args.push(st);
  }
  if (req.query.open === "1") { where.push("o.proposal_stage = ANY(?::text[])"); args.push(P.OPEN_STAGE_KEYS); }
  const rows = await query(
    `SELECT o.*, to_char(o.expected_close,'YYYY-MM-DD') AS expected_close_civil, d.name AS donor_name FROM opportunities o
       JOIN donors d ON d.id = o.donor_id AND d.org_id = o.org_id
      WHERE ${where.join(" AND ")}`, args);
  const funds = await orgFundNames(orgId);
  const all = rows.map(r => proposalRow(r, funds));
  const sort = ["expected", "amount", "stage"].includes(String(req.query.sort)) ? String(req.query.sort) : "expected";
  const proposals = P.sortProposals(all, sort);
  const byStage = P.pipelineByStage(all).map(r => ({
    ...r, amount: toDollars(r.askCents), sentence: P.stageTileSentence(r, money.formatCentsPlain),
  }));
  const w = P.weightedTotal(all);
  const officers = await query(
    `SELECT id, name FROM users WHERE org_id=? ORDER BY name`, [orgId]).catch(() => []);
  res.json({
    proposals, byStage, sort,
    weighted: { cents: w.cents, amount: toDollars(w.cents), counted: w.counted, unset: w.unset,
                openCount: w.openCount, sentence: P.weightedSentence(w, money.formatCentsPlain) },
    openAsk: { cents: w.askCents, amount: toDollars(w.askCents),
               sentence: w.openCount === 0 ? "No open proposals yet."
                 : `${money.formatCentsPlain(w.askCents)} asked for across ${w.openCount} open ${w.openCount === 1 ? "proposal" : "proposals"}, the ask amounts, not what anybody expects to land.` },
    stages: P.PROPOSAL_STAGES, probabilities: P.PROBABILITIES, declineReasons: P.DECLINE_REASONS,
    funds: [...funds.entries()].map(([id, name]) => ({ id, name })),
    officers: officers.map(o => ({ id: o.id, name: o.name })),
  });
}));

// GET /cultivation-templates — the plans the organisation keeps.
app.get("/cultivation-templates", requireAuth, wrap(async (req, res) => {
  const PL = await planMod();
  const rows = await query(
    "SELECT * FROM cultivation_templates WHERE org_id=? AND archived_at IS NULL ORDER BY name", [req.user.orgId]);
  res.json({
    templates: rows.map(r => ({
      id: r.id, name: r.name, steps: Array.isArray(r.steps) ? r.steps : [],
      createdByName: r.created_by_name || "",
    })),
    stepTypes: PL.PLAN_STEP_TYPES, maxSteps: PL.MAX_STEPS,
  });
}));

app.post("/cultivation-templates", requireAuth, requireCrm, checkWriteAccess, wrap(async (req, res) => {
  const PL = await planMod();
  const v = PL.validateTemplate({ name: req.body.name, steps: req.body.steps });
  if (!v.ok) return res.status(400).json({ error: v.errors[0].message, code: "invalid_template", errors: v.errors });
  const id = newId("ct");
  await run(
    `INSERT INTO cultivation_templates (id,org_id,name,steps,created_by,created_by_name) VALUES (?,?,?,?,?,?)`,
    [id, req.user.orgId, v.name, JSON.stringify(v.steps), actor(req).id, actor(req).name]);
  const [row] = await query("SELECT * FROM cultivation_templates WHERE id=?", [id]);
  res.status(201).json({ id: row.id, name: row.name, steps: row.steps });
}));

app.put("/cultivation-templates/:id", requireAuth, requireCrm, checkWriteAccess, wrap(async (req, res) => {
  const PL = await planMod();
  const [ex] = await query("SELECT * FROM cultivation_templates WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!ex) return res.status(404).json({ error: "Template not found" });
  const v = PL.validateTemplate({
    name: req.body.name !== undefined ? req.body.name : ex.name,
    steps: req.body.steps !== undefined ? req.body.steps : ex.steps,
  });
  if (!v.ok) return res.status(400).json({ error: v.errors[0].message, code: "invalid_template", errors: v.errors });
  await run("UPDATE cultivation_templates SET name=?, steps=?, updated_at=NOW() WHERE id=? AND org_id=?",
    [v.name, JSON.stringify(v.steps), req.params.id, req.user.orgId]);
  // EDITING A TEMPLATE DOES NOT REWRITE AN APPLIED PLAN. A plan copied its name
  // and its steps at apply time precisely so that what an officer is working
  // through cannot change under her.
  res.json({ id: req.params.id, name: v.name, steps: v.steps });
}));

app.delete("/cultivation-templates/:id", requireAuth, wrap(async (req, res) => {
  // ARCHIVED, not deleted: applied plans point at this id, and a plan whose
  // origin vanished is a record with a hole in it.
  const { changes } = await run("UPDATE cultivation_templates SET archived_at=NOW() WHERE id=? AND org_id=? AND archived_at IS NULL",
    [req.params.id, req.user.orgId]);
  if (!changes) return res.status(404).json({ error: "Not found" });
  res.json({ success: true, archived: true });
}));

// POST /donors/:id/plan — apply a template, dates offset from today.
app.post("/donors/:id/plan", requireAuth, requireCrm, checkWriteAccess, wrap(async (req, res) => {
  const PL = await planMod();
  const orgId = req.user.orgId;
  const [donor] = await query("SELECT id, name, assigned_to, assigned_to_name FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL",
    [req.params.id, orgId]);
  if (!donor) return res.status(404).json({ error: "Donor not found" });
  const [tpl] = await query("SELECT * FROM cultivation_templates WHERE id=? AND org_id=?", [req.body.templateId, orgId]);
  if (!tpl) return res.status(404).json({ error: "Template not found" });
  const v = PL.validateTemplate({ name: tpl.name, steps: tpl.steps });
  if (!v.ok) return res.status(400).json({ error: "That template is no longer valid: " + v.errors[0].message, code: "invalid_template" });

  const org = await orgTz(orgId);
  const today = orgToday(org);                                // ORG_TZ_SEAM_OK
  const steps = PL.planFromTemplate({ steps: v.steps, today }, orgTime.addDays);

  const planId = newId("cp");
  // ONE ACTIVE PLAN PER PERSON, decided by the partial unique index rather than
  // by a read-then-write — two officers applying a plan in the same second
  // cannot both land.
  const ins = await query(
    `INSERT INTO cultivation_plans (id,org_id,donor_id,template_id,template_name,applied_on,status,owner_id,owner_name,created_by,created_by_name)
     SELECT ?::text,?::text,?::text,?::text,?::text,?::text,'active',?::text,?::text,?::text,?::text
      WHERE NOT EXISTS (SELECT 1 FROM cultivation_plans x WHERE x.org_id=?::text AND x.donor_id=?::text AND x.status='active')
     RETURNING id`,
    [planId, orgId, donor.id, tpl.id, tpl.name, today,
     donor.assigned_to || req.user.userId, donor.assigned_to_name || actor(req).name,
     actor(req).id, actor(req).name, orgId, donor.id]);
  if (!ins.length) {
    const [cur] = await query("SELECT id, template_name FROM cultivation_plans WHERE org_id=? AND donor_id=? AND status='active'", [orgId, donor.id]);
    return res.status(409).json({ code: "plan_already_active", planId: cur?.id || null,
      error: `${donor.name} is already working through "${cur?.template_name || "a plan"}". Finish or stop that one first.` });
  }
  for (const s of steps) {
    await run(
      `INSERT INTO cultivation_plan_steps (id,org_id,plan_id,seq,step_type,label,due_date,status)
       VALUES (?,?,?,?,?,?,?,'pending')`,
      [newId("cs"), orgId, planId, s.seq, s.type, s.label, s.dueDate]);
  }
  // The first step opens now — or waits, if this person already has an open
  // follow-up of their own. Both are correct; the sentence says which.
  await advanceCultivationPlan(orgId, donor.id, { actorId: actor(req).id, actorName: actor(req).name, today });
  await run(
    `INSERT INTO interactions (id,org_id,donor_id,type,date,note,created_by,logged_by_name)
     VALUES (?,?,?,'note',?,?,?,?)`,
    [newId("int"), orgId, donor.id, today,
     `Cultivation plan applied: ${tpl.name} (${steps.length} ${steps.length === 1 ? "step" : "steps"})`,
     actor(req).id, actor(req).name]).catch(e => console.error("[plan] timeline:", e.message));
  res.status(201).json(await readPlan(orgId, planId));
}));

// The one reader, so the screen and the suite see the same shape.
async function readPlan(orgId, planId) {
  const PL = await planMod();
  const [plan] = await query("SELECT * FROM cultivation_plans WHERE id=? AND org_id=?", [planId, orgId]);
  if (!plan) return null;
  const steps = await query("SELECT * FROM cultivation_plan_steps WHERE plan_id=? ORDER BY seq", [planId]);
  const shaped = steps.map(s => ({
    id: s.id, seq: Number(s.seq), type: s.step_type, label: s.label,
    dueDate: s.due_date, status: s.status, threadId: s.thread_id || null,
    closedByName: s.closed_by_name || null, closedAt: s.closed_at || null,
  }));
  const prog = PL.planProgress(shaped);
  return {
    id: plan.id, donorId: plan.donor_id, templateId: plan.template_id, templateName: plan.template_name,
    appliedOn: plan.applied_on, status: plan.status,
    ownerName: plan.owner_name || "", appliedByName: plan.created_by_name || "",
    steps: shaped, progress: prog, sentence: PL.planSentence(prog, plan.template_name),
  };
}

// GET /donors/:id/plan — the plan on this person, active or the last one.
app.get("/donors/:id/plan", requireAuth, wrap(async (req, res) => {
  if (!(await orgOwns("donors", req.params.id, req.user.orgId))) return res.status(404).json({ error: "Donor not found" });
  const [p] = await query(
    `SELECT p.id FROM cultivation_plans p WHERE p.org_id=? AND p.donor_id=?
      ORDER BY (p.status='active') DESC,
               -- JOURNEYS-3: of several, the one whose step holds their thread
               EXISTS (SELECT 1 FROM cultivation_plan_steps s WHERE s.plan_id=p.id AND s.status='open') DESC,
               -- TRUTH-2: then the one whose step comes next, so the profile names
               -- the same step, on the same stored day, as the Calendar's first; and
               -- a full order, so two journeys started in one moment never swap on
               -- a reload (Walk A: Nov 7 on the Calendar, Nov 9 here, then flipped)
               (SELECT MIN(s.due_date) FROM cultivation_plan_steps s WHERE s.plan_id=p.id AND s.status IN ('open','pending')) ASC NULLS LAST,
               p.priority DESC, p.created_at DESC, p.id ASC LIMIT 1`, [req.user.orgId, req.params.id]);
  if (!p) return res.json({ plan: null });
  res.json({ plan: await readPlan(req.user.orgId, p.id) });
}));

// POST /plan-steps/:id/skip — skipping is RECORDED as skipped, never deleted and
// never quietly marked done. "We decided not to do that" is the fact.
// ── THREAD-2a · MARK DONE ASKS FOR ONE LINE, AND SCHEDULES THE NEXT ──────
// The line is not paperwork: closing a thread has ALWAYS required a reason
// (the BUILD-81 CHECK constraint), because a follow-up that closed with no
// record of what happened is a follow-up nobody can learn from. This route is
// that same close, named for what the officer is actually doing, and it
// advances the plan so the next step opens in the same breath.
//
// IT SENDS NOTHING. It writes a logged interaction and opens the next step.
// That is the entire definition of a journey step completing.
app.post("/plan-steps/:id/done", requireAuth, requireCrm, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [s] = await query(
    `SELECT st.*, p.donor_id, p.status AS plan_status FROM cultivation_plan_steps st
       JOIN cultivation_plans p ON p.id = st.plan_id
      WHERE st.id=? AND st.org_id=?`, [req.params.id, orgId]);
  if (!s) return res.status(404).json({ error: "Step not found" });
  if (s.status === "done" || s.status === "skipped") return res.status(409).json({ error: "That step is already closed." });

  const note = String((req.body && req.body.note) || "").replace(/\s+/g, " ").trim().slice(0, 500);
  if (!note) {
    return res.status(400).json({
      error: "note_required",
      message: `One line about what happened. It goes on ${"their"} record, and it is what makes the next step worth anything.`,
    });
  }
  const today = orgToday(await orgTz(orgId));                 // ORG_TZ_SEAM_OK

  // THE INTERACTION IS WRITTEN FIRST, AND THE THREAD CLOSES ONTO IT.
  //
  // `threads_close_honest` only allows two honest closes: an OUTCOME, which
  // must name the interaction that was its outcome, or a DISMISSAL, which
  // must give a reason. A first cut of this route closed with
  // `close_kind='done'` and the database refused it — correctly. A thread
  // that closed with no logged thing behind it is exactly the hole that
  // constraint exists to keep shut, and "mark done" is the most tempting
  // place in the product to punch through it.
  //
  // So: the line becomes a real interaction on the record, and the thread
  // closes pointing at it. That is also what makes a completed journey step
  // count towards Last contact — a step done that left no trace would leave
  // the record saying nobody had spoken to them.
  const intId = newId("int");
  await run(
    `INSERT INTO interactions (id,org_id,donor_id,type,date,note,created_by,logged_by_name)
     VALUES (?,?,?,?,?,?,?,?)`,
    [intId, orgId, s.donor_id,
     s.step_type === "thank" ? "call" : s.step_type === "send" ? "email" : "note",
     today, `${s.label}: ${note}`, actor(req).id, actor(req).name]);
  if (s.thread_id) {
    await run(`UPDATE threads SET closed_at=NOW(), close_kind='outcome', closing_interaction_id=?
                WHERE id=? AND org_id=? AND closed_at IS NULL`, [intId, s.thread_id, orgId]);
  }
  await run(`UPDATE cultivation_plan_steps SET status='done', closed_at=NOW(), closed_by=?, closed_by_name=?, done_note=?
              WHERE id=? AND org_id=?`, [actor(req).id, actor(req).name, note, req.params.id, orgId]);

  // AND SCHEDULES THE NEXT. Same call the rest of the plan machinery makes.
  await advanceCultivationPlan(orgId, s.donor_id, { actorId: actor(req).id, actorName: actor(req).name, today });
  res.json({ plan: await readPlan(orgId, s.plan_id), done: req.params.id, note, interactionId: intId });
}));

app.post("/plan-steps/:id/skip", requireAuth, requireCrm, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [s] = await query(
    `SELECT st.*, p.donor_id, p.status AS plan_status FROM cultivation_plan_steps st
       JOIN cultivation_plans p ON p.id = st.plan_id
      WHERE st.id=? AND st.org_id=?`, [req.params.id, orgId]);
  if (!s) return res.status(404).json({ error: "Step not found" });
  if (s.status === "done" || s.status === "skipped") return res.status(409).json({ error: "That step is already closed." });
  // Skipping the OPEN step dismisses its thread with a reason — a thread may
  // not close without one (the BUILD-81 CHECK constraint), and "we decided not
  // to" is exactly the kind of reason that rule exists to preserve.
  if (s.status === "open" && s.thread_id) {
    await run("UPDATE threads SET closed_at=NOW(), close_kind='dismissed', close_reason='handled_outside' WHERE id=? AND org_id=? AND closed_at IS NULL",
      [s.thread_id, orgId]);
  }
  // THREAD-2a — SKIP ASKS WHY, IN ONE TAP. The reason is a short phrase, not
  // an essay, and it is stored: six months later "why did nobody send her the
  // impact report?" has an answer. It is optional at the route (an older
  // client, a bulk skip during a replacement) and the screen makes it one tap.
  const why = String((req.body && req.body.reason) || "").replace(/\s+/g, " ").trim().slice(0, 200) || null;
  await run("UPDATE cultivation_plan_steps SET status='skipped', closed_at=NOW(), closed_by=?, closed_by_name=?, skip_reason=? WHERE id=? AND org_id=?",
    [actor(req).id, actor(req).name, why, req.params.id, orgId]);
  if (why) {
    await run(
      `INSERT INTO interactions (id,org_id,donor_id,type,date,note,created_by,logged_by_name)
       VALUES (?,?,?,'note',?,?,?,?)`,
      [newId("int"), orgId, s.donor_id, orgToday(await orgTz(orgId)),  // ORG_TZ_SEAM_OK
       `Skipped "${s.label}": ${why}`, actor(req).id, actor(req).name])
      .catch(e => console.error("[journey] skip note:", e.message));
  }
  await advanceCultivationPlan(orgId, s.donor_id, { actorId: actor(req).id, actorName: actor(req).name });
  const out = await readPlan(orgId, s.plan_id);
  res.json({ plan: out, skipped: req.params.id, reason: why });
}));

// POST /plans/:id/stop — the officer decides the plan is over. The steps keep
// what they were, so "we got three steps in and stopped" stays readable.
app.post("/plans/:id/stop", requireAuth, requireCrm, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [p] = await query("SELECT * FROM cultivation_plans WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!p) return res.status(404).json({ error: "Plan not found" });
  if (p.status !== "active") return res.status(409).json({ error: "That plan is not active." });
  const [open] = await query("SELECT id, thread_id FROM cultivation_plan_steps WHERE plan_id=? AND status='open'", [p.id]);
  if (open && open.thread_id) {
    await run("UPDATE threads SET closed_at=NOW(), close_kind='dismissed', close_reason='handled_outside' WHERE id=? AND org_id=? AND closed_at IS NULL",
      [open.thread_id, orgId]);
    await run("UPDATE cultivation_plan_steps SET status='skipped', closed_at=NOW(), closed_by=?, closed_by_name=? WHERE id=?",
      [actor(req).id, actor(req).name, open.id]);
  }
  await run("UPDATE cultivation_plans SET status='abandoned', closed_at=NOW() WHERE id=? AND org_id=?", [p.id, orgId]);
  res.json({ plan: await readPlan(orgId, p.id) });
}));
}

module.exports = { routers, mount };
