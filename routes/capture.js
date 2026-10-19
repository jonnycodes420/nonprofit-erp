// routes/capture.js · CAPTURE-1. "To confirm": the cards, and the one tap that
// turns a card into a gift. See capture.js for the read and the rules.
"use strict";
const express = require("express");
const K = require("../capture");

const routers = { r0: express.Router() };

function mount(ctx) {
const { query, run, wrap, requireAuth, checkWriteAccess, actor, recordGift, openGiftThread, openThreadTx,
  withTransaction, orgTz, orgToday, giftHooks, checkGiftExtras } = ctx;
const app = routers.r0;

async function whoOf(req) {
  const a = actor(req);
  const [u] = await query(`SELECT name FROM users WHERE id=? AND org_id=?`, [a.id, req.user.orgId]);
  return { id: a.id, name: (u && u.name) || a.name };
}

function cardOut(orgId, c) {
  return {
    id: c.id, kind: c.kind, stakes: c.stakes, status: c.status, source: c.source,
    fileUrl: K.fileUrl(orgId, c.asset_id), contentType: c.content_type, fileName: c.file_name, page: c.page,
    receivedAt: c.received_at, batchId: c.batch_id,
    read: c.read || {}, amount: (c.proposal || {}).amount || null, donor: (c.proposal || {}).donor || null,
    fund: (c.proposal || {}).fund || null, advisor: (c.proposal || {}).advisor || null, matches: (c.proposal || {}).matches || null,
    headline: c.headline, sentence: c.sentence, ai: c.ai,
    giftId: c.gift_id, pledgeId: c.pledge_id, donorId: c.donor_id, skipReason: c.skip_reason,
    appliedSummary: (c.applied || {}).summary || null, undoUntil: c.undo_until,
    decidedAt: c.decided_at, decidedByName: c.decided_by_name,
  };
}

// `loggedId` is a card being confirmed in the same moment: it counts as logged
// before its own row says so, so the confirm can answer with the batch line in
// the same round trip as the card's update.
async function batchOut(orgId, batchId, { loggedId = null } = {}) {
  if (!batchId) return null;
  const [[b], cards] = await Promise.all([
    query("SELECT * FROM capture_batches WHERE id=? AND org_id=?", [batchId, orgId]),
    query("SELECT id, proposal, status FROM capture_items WHERE org_id=? AND batch_id=? ORDER BY created_at, page", [orgId, batchId])]);
  if (!b) return null;
  const amounts = cards.map(c => (c.proposal && c.proposal.amount && c.proposal.amount.cents) ?? null);
  const unread = amounts.filter(a => a == null).length;
  const checks = amounts.reduce((s, a) => s + (a || 0), 0);
  const slip = b.slip_cents == null ? null : Number(b.slip_cents);
  let sentence = null, matches = null;
  if (slip != null) {
    if (unread) sentence = `${unread} of the ${cards.length} checks has no amount yet, so Steward can't compare them with the deposit slip's ${K.cents$(slip)}.`;
    else if (checks === slip) { matches = true; sentence = `The ${cards.length} checks add up to ${K.cents$(checks)}, the same as the deposit slip.`; }
    else { matches = false; sentence = `The ${cards.length} checks add up to ${K.cents$(checks)}, but the deposit slip says ${K.cents$(slip)}. ${K.cents$(Math.abs(slip - checks))} ${slip > checks ? "is missing from the checks" : "more than the slip"}.`; }
  }
  // FIX-45: the line moves as the checks are logged. It used to read the same
  // after every confirm, as if nothing had happened.
  const isLogged = c => c.status === "confirmed" || c.id === loggedId;
  const logged = cards.filter(isLogged).length;
  const leftCents = cards.filter(c => !isLogged(c) && c.status !== "skipped")
    .reduce((s, c) => s + ((c.proposal && c.proposal.amount && c.proposal.amount.cents) || 0), 0);
  if (sentence && logged === cards.length) sentence += ` All ${cards.length} are logged.`;
  else if (sentence && logged) sentence += ` ${logged} of ${cards.length} logged, ${K.cents$(leftCents)} still to confirm.`;
  return { id: b.id, cardIds: cards.map(c => c.id), slipCents: slip, checksCents: checks, matches, sentence, logged, leftCents };
}

async function captureAddress(orgId) {
  const domain = process.env.INBOUND_EMAIL_DOMAIN;
  if (!domain) return null;
  const [o] = await query("SELECT org_slug FROM orgs WHERE id=?", [orgId]);
  return o && o.org_slug ? `capture+${o.org_slug}@${domain}` : null;
}

app.get("/thank-yous/clock", requireAuth, wrap(async (req, res) => {
  res.json(await K.clock(req.user.orgId));
}));

app.get("/capture/count", requireAuth, wrap(async (req, res) => {
  const [r] = await query("SELECT COUNT(*)::int AS n FROM capture_items WHERE org_id=? AND status='waiting'", [req.user.orgId]);
  res.json({ waiting: r.n });
}));

app.get("/capture", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const waiting = await query("SELECT * FROM capture_items WHERE org_id=? AND status='waiting' ORDER BY received_at DESC, created_at DESC, page LIMIT 200", [orgId]);
  const done = await query(
    `SELECT * FROM capture_items WHERE org_id=? AND status IN ('applied','undone') AND decided_at > NOW() - INTERVAL '${K.UNDO_DAYS} days'
      ORDER BY decided_at DESC LIMIT 100`, [orgId]);
  const [o] = await query("SELECT major_gift_line_cents FROM orgs WHERE id=?", [orgId]);
  const gate = await ctx.aiGate(orgId);
  const batchIds = [...new Set(waiting.map(c => c.batch_id).filter(Boolean))];
  const batches = [];
  for (const b of batchIds) batches.push(await batchOut(orgId, b));
  res.json({
    waiting: waiting.map(c => cardOut(orgId, c)), doneForYou: done.map(c => cardOut(orgId, c)), batches: batches.filter(Boolean),
    counts: { waiting: waiting.length }, address: await captureAddress(orgId),
    majorGiftLineCents: Number(o && o.major_gift_line_cents) || 100000, ai: { on: gate.ok, reason: gate.reason },
    capBytes: K.MAX_BYTES,
  });
}));

// Each check becomes one card; a PDF may hold several. A photographed deposit
// slip in the batch is read for its total and kept beside the batch.
app.post("/capture/upload", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const who = await whoOf(req);
  const files = Array.isArray(req.body && req.body.files) ? req.body.files.slice(0, 12) : [];
  if (!files.length) return res.status(400).json({ error: "no_files", sentence: "No photo or file arrived. Choose it again." });
  const slipIndex = Number.isInteger(req.body.slipIndex) ? req.body.slipIndex : null;
  let batchId = typeof req.body.batchId === "string" ? req.body.batchId : null;
  if (batchId) {
    const [b] = await query("SELECT id FROM capture_batches WHERE id=? AND org_id=?", [batchId, orgId]);
    if (!b) return res.status(404).json({ error: "not_found" });
  } else if (req.body.batch || slipIndex != null) {
    batchId = "capb_" + ctx.uuid().replace(/-/g, "").slice(0, 12);
    await run("INSERT INTO capture_batches (id,org_id,created_by,created_by_name) VALUES (?,?,?,?)", [batchId, orgId, who.id, who.name]);
  }
  const cardIds = [], refused = [];
  for (const [i, f] of files.entries()) {
    const name = String((f && f.name) || "photo").slice(0, 120);
    const buffer = K.decodeDataUrl(f && f.dataUrl);
    if (!buffer || !buffer.length) { refused.push({ name, sentence: `${name} didn't arrive. Choose it again.` }); continue; }
    const from = { source: req.body.source === "photo" ? "photo" : "upload", receivedAt: new Date(), actorId: who.id, actorName: who.name };
    const r = await K.cardsFromFile(orgId, buffer, name, from, batchId);
    if (r.refused) { refused.push({ name, sentence: r.refused }); continue; }
    if (i === slipIndex || r.slip) {
      // The slip's total, read; an unread slip keeps its photo and says so.
      const cents = r.slip && r.slip.cents != null ? r.slip.cents : null;
      if (batchId) await run("UPDATE capture_batches SET slip_asset_id=COALESCE(?, slip_asset_id), slip_cents=COALESCE(?, slip_cents) WHERE id=? AND org_id=?",
        [r.assetId || null, cents, batchId, orgId]);
      if (r.cards.length && i === slipIndex) {
        // Read as something else: it stays a card rather than vanishing.
      }
    }
    cardIds.push(...r.cards);
  }
  const rows = cardIds.length ? await query(`SELECT * FROM capture_items WHERE org_id=? AND id IN (${cardIds.map(() => "?").join(",")}) ORDER BY created_at, page`, [orgId, ...cardIds]) : [];
  res.status(201).json({ cards: rows.map(c => cardOut(orgId, c)), batch: await batchOut(orgId, batchId), refused });
}));

app.get("/capture/:id/file", requireAuth, wrap(async (req, res) => {
  const [c] = await query("SELECT asset_id FROM capture_items WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!c || !c.asset_id) return res.status(404).json({ error: "not_found" });
  res.json({ url: K.fileUrl(req.user.orgId, c.asset_id) });
}));

app.post("/capture/settings", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const c = Math.round(Number(req.body && req.body.majorGiftLineCents));
  if (!Number.isFinite(c) || c < 0) return res.status(400).json({ error: "bad_amount", sentence: "The major-gift line is an amount of zero or more." });
  await run("UPDATE orgs SET major_gift_line_cents=? WHERE id=?", [c, req.user.orgId]);
  res.json({ majorGiftLineCents: c });
}));

app.post("/capture/:id/skip", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const who = await whoOf(req);
  const reason = String((req.body && req.body.reason) || "").trim().slice(0, 300);
  if (!reason) return res.status(400).json({ error: "reason", sentence: "Say why you're skipping it, so the next person knows." });
  const r = await query(`UPDATE capture_items SET status='skipped', skip_reason=?, decided_at=NOW(), decided_by=?, decided_by_name=?
                          WHERE id=? AND org_id=? AND status='waiting' RETURNING *`, [reason, who.id, who.name, req.params.id, req.user.orgId]);
  if (!r.length) return res.status(404).json({ error: "not_found" });
  res.json({ card: cardOut(req.user.orgId, r[0]) });
}));

app.post("/capture/:id/unskip", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const r = await query(`UPDATE capture_items SET status='waiting', skip_reason=NULL, decided_at=NULL, decided_by=NULL, decided_by_name=NULL
                          WHERE id=? AND org_id=? AND status='skipped' RETURNING *`, [req.params.id, req.user.orgId]);
  if (!r.length) return res.status(404).json({ error: "not_found" });
  res.json({ card: cardOut(req.user.orgId, r[0]) });
}));

app.post("/capture/:id/undo", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const out = await K.undoLow(req.user.orgId, req.params.id, await whoOf(req));
  if (out.error === "not_found") return res.status(404).json({ error: "not_found" });
  if (out.error) return res.status(409).json(out);
  const [c] = await query("SELECT * FROM capture_items WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  res.json({ card: cardOut(req.user.orgId, c) });
}));

// A low-stakes card that needed a choice (two people of one name): applying it
// once she has picked.
app.post("/capture/:id/apply", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [c] = await query("SELECT * FROM capture_items WHERE id=? AND org_id=? AND status='waiting' AND stakes='low'", [req.params.id, orgId]);
  if (!c) return res.status(404).json({ error: "not_found" });
  const donorId = String((req.body && req.body.donorId) || "");
  const [d] = await query("SELECT id FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [donorId, orgId]);
  if (!d) return res.status(400).json({ error: "who", sentence: "Choose the person this is about." });
  const proposal = { ...c.proposal, donor: { ...c.proposal.donor, state: "matched", selectedId: d.id } };
  await run("UPDATE capture_items SET proposal=?::jsonb WHERE id=? AND org_id=?", [JSON.stringify(proposal), c.id, orgId]);
  const summary = await K.applyLow(orgId, c.id, await whoOf(req));
  if (!summary) return res.status(400).json({ error: "nothing", sentence: "There was nothing Steward could apply from this one. Skip it, or change the record by hand." });
  const [after] = await query("SELECT * FROM capture_items WHERE id=? AND org_id=?", [c.id, orgId]);
  res.json({ card: cardOut(orgId, after) });
}));

// ── CONFIRM: the one tap that records money ───────────────────────────────
// FIX-45: in TEST_MODE, the work still running after a confirm answered, by
// card, so a suite can wait for it (GET /capture/:id/settled) instead of
// guessing with a sleep.
const afterConfirm = new Map();
app.get("/capture/:id/settled", requireAuth, wrap(async (req, res) => {
  if (process.env.TEST_MODE !== "1") return res.status(404).json({ error: "not_found" });
  const p = afterConfirm.get(req.params.id);
  if (p) await p;
  res.json({ settled: true });
}));
const METHOD = { check: "Check", daf_grant: "DAF grant", stock_gift: "Stock", matching_gift: "Matching gift", pledge: null, other: "Check" };

async function newPerson(orgId, p, who) {
  const name = String((p && p.name) || "").trim().slice(0, 200);
  if (!name) return null;
  const id = "d_" + ctx.uuid().slice(0, 8);
  await run(`INSERT INTO donors (id,org_id,name,email,address,city,state,zip,created_by,created_by_name)
             VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, orgId, name, String(p.email || "").trim().toLowerCase() || null, p.line1 || null, p.city || null, p.state || null, p.postal || null,
     who.id, who.name]);
  return id;
}

app.post("/capture/:id/confirm", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const who = await whoOf(req);
  const b = req.body || {};
  // Claimed first, so a double tap cannot record twice (the idempotency key
  // below is the second line of defence).
  const [c] = await query(`UPDATE capture_items SET status='confirming' WHERE id=? AND org_id=? AND status='waiting' AND stakes='money' RETURNING *`,
    [req.params.id, orgId]);
  if (!c) return res.status(404).json({ error: "not_found", sentence: "This card was already confirmed or skipped." });
  const release = () => run("UPDATE capture_items SET status='waiting' WHERE id=? AND org_id=? AND status='confirming'", [c.id, orgId]);
  try {
    const kind = K.MONEY_KINDS.includes(b.kind) ? b.kind : (K.MONEY_KINDS.includes(c.kind) ? c.kind : "check");
    const cents = Math.round(Number(b.amountCents));
    if (!Number.isFinite(cents) || cents <= 0) { await release(); return res.status(400).json({ error: "amount", sentence: "Type the amount from the image before you confirm." }); }
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || "")) ? b.date : orgToday(await orgTz(orgId));   // ORG_TZ_SEAM_OK
    let donorId = b.donorId ? String(b.donorId) : null;
    const fundId = b.fundId ? String(b.fundId) : null;
    // FIX-45: the two checks do not depend on each other, so they are one
    // round trip, not two.
    const [dRows, fRows] = await Promise.all([
      donorId ? query("SELECT id FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [donorId, orgId]) : [],
      fundId ? query("SELECT id FROM fin_funds WHERE id=? AND org_id=?", [fundId, orgId]) : []]);
    if (donorId) {
      if (!dRows[0]) { await release(); return res.status(404).json({ error: "donor_not_found" }); }
    } else if (b.newPerson) {
      donorId = await newPerson(orgId, b.newPerson, who);
    }
    if (!donorId) { await release(); return res.status(400).json({ error: "who", sentence: "Choose who this is from, or add them as a new person." }); }
    if (fundId && !fRows[0]) { await release(); return res.status(404).json({ error: "fund_not_found" }); }

    let giftId = null, pledgeId = null, duplicateOf = null, sentence = "", later = null;
    if (kind === "pledge") {
      pledgeId = "pl_" + ctx.uuid().slice(0, 8);
      const due = /^\d{4}-\d{2}-\d{2}$/.test(String(b.startDate || "")) ? b.startDate : date;
      await run(`INSERT INTO pledges (id,org_id,donor_id,amount,due_date,notes,idempotency_key,created_by,created_by_name)
                 VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT (org_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
        [pledgeId, orgId, donorId, cents / 100, due, "From a pledge form in To confirm.", "capture:" + c.id, who.id, who.name]);
      const freq = String(b.frequency || "").toLowerCase();
      const count = Math.max(0, Math.round(Number(b.installments) || 0));
      if (freq && count > 1 && giftHooks.writePledgeInstallments) {
        await giftHooks.writePledgeInstallments(orgId, pledgeId, { amountCents: cents, frequency: freq, count, firstDue: due });
      }
      sentence = `Logged a ${K.cents$(cents)} pledge${count > 1 ? ` in ${count} ${freq} payments` : ""}. No money is recorded until a payment arrives.`;
    } else if (kind === "matching_gift") {
      const matches = b.matchesGiftId ? String(b.matchesGiftId) : null;
      const [g] = matches ? await query("SELECT id FROM gifts WHERE id=? AND org_id=?", [matches, orgId]) : [];
      if (!g) { await release(); return res.status(400).json({ error: "which_gift", sentence: "Which gift does this match? Choose it, then confirm." }); }
      pledgeId = "pl_" + ctx.uuid().slice(0, 8);
      await run(`INSERT INTO pledges (id,org_id,donor_id,amount,due_date,notes,idempotency_key,is_match,matches_gift_id,created_by,created_by_name)
                 VALUES (?,?,?,?,?,?,?,true,?,?,?) ON CONFLICT (org_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
        [pledgeId, orgId, donorId, cents / 100, date, "From a matching-gift letter in To confirm.", "capture:" + c.id, g.id, who.id, who.name]);
      sentence = `Logged a ${K.cents$(cents)} matching gift as a promise from the employer, linked to the gift it matches.`;
    } else {
      // The same check read from QuickBooks first is the same gift: attach the
      // image to it rather than counting it twice.
      const [qb] = await query(
        `SELECT id, cheque_asset_id FROM gifts WHERE org_id=? AND donor_id=? AND ROUND(amount*100)=? AND read_from_vendor IS NOT NULL
            AND LEFT(date,10)::date BETWEEN (?::date - 7) AND (?::date + 7) ORDER BY date LIMIT 1`, [orgId, donorId, cents, date, date]);
      if (qb) {
        giftId = qb.id; duplicateOf = qb.id;
        if (!qb.cheque_asset_id && c.asset_id) await run("UPDATE gifts SET cheque_asset_id=? WHERE id=? AND org_id=?", [c.asset_id, qb.id, orgId]);
        sentence = `This gift is already in Steward from QuickBooks, so it wasn't counted again. The image is attached to it.`;
      } else {
        const advisorId = kind === "daf_grant" && b.advisorDonorId ? String(b.advisorDonorId) : null;
        // Checked BEFORE the gift is written, exactly as the gift form does:
        // recordGift writes extras that checkGiftExtras has normalised.
        let extras;
        if (advisorId && advisorId !== donorId) {
          const ck = await checkGiftExtras(orgId, donorId, cents, { softCredits: [{ donorId: advisorId, role: "recommender" }] });
          if (ck.notFound) { await release(); return res.status(404).json({ error: "advisor_not_found" }); }
          if (ck.errors) { await release(); return res.status(400).json({ error: "extras", sentence: ck.errors.join("; ") }); }
          extras = ck.extras;
        }
        const w = await recordGift({
          orgId, donorId, amount: cents / 100, date, fundId, paymentMethod: METHOD[kind] || "Check",
          type: kind === "stock_gift" ? "stock" : "cash",
          checkNumber: kind === "check" ? (c.read && c.read.chequeNumber) || null : null,
          chequeAssetId: c.asset_id || null, receivedAt: c.received_at,
          idempotencyKey: "capture:" + c.id, conflict: "idempotency",
          notes: kind === "daf_grant" ? "Donor-advised fund grant, from To confirm." : "",
          actorId: who.id, actorName: who.name, source: "capture", door: "capture", extras,
          // FIX-45: she is waiting on this button. The journeys, groups and
          // after-change step run straight after the answer (see below).
          deferTriggers: true,
        });
        later = w.later || null;
        if (w.duplicate) {
          const [g] = await query("SELECT id FROM gifts WHERE org_id=? AND idempotency_key=?", [orgId, "capture:" + c.id]);
          giftId = g ? g.id : null;
        } else giftId = w.gift.id;
        sentence = `Logged ${K.cents$(cents)}${kind === "daf_grant" && extras ? ", with soft credit to the advisor" : ""}.`;
      }
    }

    // The thank-you draft recordGift queued, and the call for a major gift.
    const [[draft], [o]] = await Promise.all([
      giftId && !duplicateOf ? query("SELECT id, body FROM thank_you_drafts WHERE org_id=? AND gift_id=? LIMIT 1", [orgId, giftId]) : [],
      query("SELECT major_gift_line_cents, receipts_enabled FROM orgs WHERE id=?", [orgId])]);
    const line = o && o.major_gift_line_cents != null ? Number(o.major_gift_line_cents) : 100000;
    // FIX-45 · THE CARD IS DONE WHEN THE GIFT IS. Confirm answers as soon as
    // the gift, its draft and the card are written. What follows a gift (the
    // journeys, the groups, the after-change step, a lapsed donor's stage, the
    // Thread) runs straight after the answer, in the order it always ran.
    // Before this, the first gift after a re-seed waited on 1,300 statements
    // and the button said "Logging..." for over 30 seconds.
    const callOnThread = !!(giftId && !duplicateOf && cents >= line);
    const followUp = async () => {
      // A memo she confirmed into a fund is remembered for next time.
      const phrase = String((c.read && (c.read.memo || c.read.fundName)) || "").trim().toLowerCase().slice(0, 60);
      if (fundId && phrase && phrase.length >= 3) {
        await run(`INSERT INTO capture_fund_words (org_id,phrase,fund_id,created_by,created_by_name) VALUES (?,?,?,?,?)
                   ON CONFLICT (org_id, phrase) DO UPDATE SET fund_id=EXCLUDED.fund_id`, [orgId, phrase, fundId, who.id, who.name]);
      }
      if (later) await later;
      if (!giftId || duplicateOf) return;
      if (giftHooks.autoUnlapseOnGift) await giftHooks.autoUnlapseOnGift(orgId, donorId).catch(() => {});
      if (callOnThread) {
        const tz = await orgTz(orgId);
        const today = orgToday(tz);                                   // ORG_TZ_SEAM_OK
        const label = `Call to thank for the ${K.cents$(cents)} gift`;
        const opened = await withTransaction(cl => openThreadTx(cl, { orgId, donorId, step: { type: "thank", label, due: today },
          openedOn: today, openingGiftId: giftId, actorId: who.id, actorName: who.name }));
        if (!opened) await run(`UPDATE threads SET next_step_type='thank', next_step_label=?, due_date=? WHERE org_id=? AND donor_id=? AND closed_at IS NULL`,
          [label, today, orgId, donorId]);
      } else {
        await openGiftThread(orgId, donorId, { giftId, actorId: who.id, actorName: who.name }).catch(() => {});
      }
    };
    const [[after], batch] = await Promise.all([
      query(`UPDATE capture_items SET status='confirmed', gift_id=?, pledge_id=?, donor_id=?, decided_at=NOW(), decided_by=?, decided_by_name=?
              WHERE id=? AND org_id=? RETURNING *`, [giftId, pledgeId, donorId, who.id, who.name, c.id, orgId]),
      batchOut(orgId, c.batch_id, { loggedId: c.id })]);
    // Receipts follow the org's setting exactly as a hand-entered gift does:
    // Steward never sends one for a gift logged by hand; it is one click on the gift.
    const receipt = giftId && !duplicateOf ? (o && o.receipts_enabled ? "one_click" : "off") : null;
    res.json({ card: cardOut(orgId, after), batch, giftId, pledgeId, duplicateOf, thankYouDraftId: draft ? draft.id : null,
      thankYouDraft: draft ? { id: draft.id, body: draft.body } : null,
      receipt, callOnThread, sentence: [sentence,
        draft ? "A thank-you is drafted for you to read and send." : null,
        receipt === "one_click" ? "Send the receipt from the gift when you're ready." : null,
        callOnThread ? "A call to thank them is on the Thread for today." : null].filter(Boolean).join(" ") });
    const settled = followUp().catch(e => console.error("[capture] after confirm:", e.message));
    if (process.env.TEST_MODE === "1") afterConfirm.set(c.id, settled.then(() => afterConfirm.delete(c.id)));
  } catch (e) {
    await release();
    throw e;
  }
}));
}

module.exports = { routers, mount };
