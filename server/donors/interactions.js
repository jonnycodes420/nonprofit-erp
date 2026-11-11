// server/donors/interactions.js — interactions and conversations, attachments, voice memos and briefs.
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
// PARITY-1 Part B — a file on a conversation or a note (types, bytes, signed door).
const IXF = require("../../interactionFiles");
const { requireAuth404 } = require("../../auth");   // FIX-20 Part 0: the file doors
const SEALED_MAIL = require("../mail/sealedMail");   // SECURE-3: a synced email's body opens only here
const { fileLimiter } = require("../shared/fileLimiter");   // one limiter, shared by the two file doors

const routers = {
  r1: express.Router(),
};

const LOG_CLOSE = require("../tasks/logClose");   // SENDS-1: what logging a conversation closes
function mount(ctx) {
const {
  AGENT_MODEL, ASSET_ID_RE, NOT_YOURS, UNDO_SECONDS, actor, advanceCultivationPlan, agentGate,
  calcWealthScore, checkWriteAccess, getThemeAsset, journeyMod, lastName, mayEditLogged, openThreadTx,
  orgOwns, orgTime, orgToday, orgTz, parseMoneyOrThrow, proposalMod, pruneUnreferencedAssets, putThemeAsset,
  query, queryTx, recordAssetPointerHistory, recordGift, requireAuth, requireCrm, round2, run, runTx,
  threadShapeMod, thresholdsMod, toCents, toDollars, trashRow, uuid, withTransaction, wrap,
} = ctx;
let app = routers.r1;
// TOUCH-1: the kinds of touch, an org's own, and the plan of care a touch completes.
const TOUCH = require("./touchTypes").register(app, { ...ctx, actor });

// ── Interactions ───────────────────────────────────────────────────────────
app.post("/donors/:id/interactions", requireAuth, wrap(async (req, res) => {
  const { type, note, date, metadata } = req.body;
  if (!type) return res.status(400).json({ error: "Interaction type required" });

  const donorExists = await query(
    "SELECT id FROM donors WHERE id = ? AND org_id = ?",
    [req.params.id, req.user.orgId]
  );
  if (!donorExists.length) return res.status(404).json({ error: "Donor not found" });

  const userRow = await query("SELECT name FROM users WHERE id=?", [req.user.userId]);
  const userName = userRow[0]?.name || "";
  const id = newId("int");
  await run(
    "INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name,metadata) VALUES (?,?,?,?,?,?,?,?,?)",
    [id, req.user.orgId, req.params.id, type, note || "",
     // FIX-14 Part 1 — no date means the ORG's today (this was the UTC day).
     /^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) ? date : orgToday(await orgTz(req.user.orgId)), req.user.userId,   // ORG_TZ_SEAM_OK
     userName, metadata ? JSON.stringify(metadata) : null]
  );
  const rows = await query("SELECT * FROM interactions WHERE id = ?", [id]);
  calcWealthScore(req.params.id, req.user.orgId).catch(e => console.error("score recalc:", e.message));
  // LIVE-1 — a logged touch is a change to the person: the after-change step.
  await require("../../afterChange").afterChange(req.user.orgId, [req.params.id], { door: "logged_touch", recalc: false });
  res.status(201).json(rows[0]);
}));
// A meeting from a connected calendar: its time and place belong to the
// calendar. Steward never edits the event; it says where to change it.
function calendarDayUrl(provider, date) {
  const d = String(date || "").slice(0, 10).replace(/-/g, "/");
  return provider === "outlook" || provider === "microsoft"
    ? `https://outlook.office.com/calendar/view/day/${d}`
    : `https://calendar.google.com/calendar/r/day/${d}`;
}
const parseMeta = m => { try { return (typeof m === "string" ? JSON.parse(m || "{}") : m) || {}; } catch { return {}; } };
const EDITABLE_TYPES = new Set(["meeting", "call", "email", "note", "visit", "event", "other", "letter", "text", "stewardship", "ask", "gift_sent", "event_invite"]);   // TOUCH-1: the new kinds

app.put("/interactions/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { orgId, userId } = req.user;
  const [row] = await query("SELECT * FROM interactions WHERE id = ? AND org_id = ?", [req.params.id, orgId]);
  if (!row) return res.status(404).json({ error: "Interaction not found" });
  if (!(await mayEditLogged(req, row))) return res.status(403).json(NOT_YOURS);
  if (row.type === "gift" || row.gift_id) {
    return res.status(409).json({ error: "gift_entry", sentence: "A gift is changed on the gift itself, in Giving." });
  }
  const meta = parseMeta(row.metadata);
  const b = req.body || {};
  const sets = [], vals = [];
  const fromCalendar = !!meta.calendar_event_id;
  // SECURE-3: a sealed email is edited as she sees it (opened), and sealed again.
  const shown = SEALED_MAIL.openInteraction(row);
  if (shown.body_unreadable && b.note !== undefined) return res.status(409).json({ error: "sealed_unreadable", sentence: SEALED_MAIL.UNREADABLE });
  if (b.type !== undefined && b.type !== row.type) {
    if (fromCalendar) return res.status(409).json({ error: "calendar_owned", sentence: "This meeting came from a calendar. Change it in your calendar.", calendarUrl: calendarDayUrl(meta.provider, row.date) });
    if (!EDITABLE_TYPES.has(String(b.type))) return res.status(400).json({ error: "Unknown conversation type" });
    sets.push("type=?"); vals.push(String(b.type));
  }
  if (b.date !== undefined && b.date !== row.date) {
    if (fromCalendar) return res.status(409).json({ error: "calendar_owned", sentence: "The time and place come from your calendar. Change it in your calendar.", calendarUrl: calendarDayUrl(meta.provider, row.date) });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.date))) return res.status(400).json({ error: "date must be YYYY-MM-DD" });
    sets.push("date=?"); vals.push(b.date);
  }
  if (b.note !== undefined && String(b.note) !== String(shown.note || "")) {
    if (!String(b.note).trim()) return res.status(400).json({ error: "The note cannot be empty. Delete the entry instead." });
    if (row.body_sealed) {
      const cols = SEALED_MAIL.resealEdited(orgId, row.id, String(b.note).slice(0, 20000));
      sets.push("note=?", "body_sealed=?", "body_key_id=?"); vals.push(cols.note, cols.body_sealed, cols.body_key_id);
    } else { sets.push("note=?"); vals.push(String(b.note).slice(0, 20000)); }
  }
  if (b.donorId !== undefined && b.donorId !== row.donor_id) {
    if (!(await orgOwns("donors", b.donorId, orgId))) return res.status(404).json({ error: "Donor not found" });
    sets.push("donor_id=?"); vals.push(b.donorId);
  }
  if (b.metadata && typeof b.metadata === "object") {
    const next = { ...meta };
    for (const k of ["location", "attendees", "next_step", "touch_kind", "touch_label", "call_result"]) {   // TOUCH-1: a touch's kind is changed in place
      if (b.metadata[k] === undefined) continue;
      if (fromCalendar && k === "location" && String(b.metadata[k] || "") !== String(meta.location || "")) {
        return res.status(409).json({ error: "calendar_owned", sentence: "The time and place come from your calendar. Change it in your calendar.", calendarUrl: calendarDayUrl(meta.provider, row.date) });
      }
      next[k] = b.metadata[k] === "" ? null : String(b.metadata[k]).slice(0, 500);
    }
    if (JSON.stringify(next) !== JSON.stringify(meta)) { sets.push("metadata=?"); vals.push(JSON.stringify(next)); }
  }
  if (!sets.length) return res.json({ ...shown, unchanged: true });
  const [u] = await query("SELECT name FROM users WHERE id=?", [userId]);
  sets.push("edited_at=NOW()", "edited_by=?", "edited_by_name=?");
  vals.push(userId, u?.name || req.user.email || "");
  await run(`UPDATE interactions SET ${sets.join(", ")} WHERE id = ? AND org_id = ?`, [...vals, req.params.id, orgId]);
  // A calendar meeting's note lives on the meeting too: keep the two saying
  // the same thing (Steward's own part only; the event is never touched).
  if (fromCalendar && b.note !== undefined) {
    const title = String(row.note || "").split("\n\n")[0];
    const own = String(b.note).startsWith(title + "\n\n") ? String(b.note).slice(title.length + 2) : String(b.note);
    await run("UPDATE calendar_events SET note=?, updated_at=NOW() WHERE id=? AND org_id=?", [own || null, meta.calendar_event_id, orgId]).catch(() => {});
  }
  const [out] = await query("SELECT * FROM interactions WHERE id = ?", [req.params.id]);
  if (out.donor_id) calcWealthScore(out.donor_id, orgId).catch(e => console.error("score recalc:", e.message));
  res.json(SEALED_MAIL.openInteraction(out));
}));

// DELETE /interactions/:id — remove a mis-logged touchpoint. Per convention,
// DELETE routes get no checkWriteAccess. Gmail-synced rows are deliberately
// deletable too: the message id is recorded in gmail_sync_exclusions first so
// syncGmail's dedup step doesn't re-insert the same message on its next pass.
// FIX-14 Part 2: only whoever logged it, or an admin; and the row is moved,
// not destroyed, so Undo can put it back.
app.delete("/interactions/:id", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    "SELECT id, metadata, created_by FROM interactions WHERE id = ? AND org_id = ?",
    [req.params.id, req.user.orgId]
  );
  if (!rows.length) return res.status(404).json({ error: "Interaction not found" });
  if (!(await mayEditLogged(req, rows[0]))) return res.status(403).json(NOT_YOURS);

  const meta = parseMeta(rows[0].metadata);
  if (meta?.gmail_message_id) {
    await run(
      "INSERT INTO gmail_sync_exclusions (id, org_id, gmail_message_id) VALUES (?,?,?) ON CONFLICT (org_id, gmail_message_id) DO NOTHING",
      [newId("gse"), req.user.orgId, meta.gmail_message_id]
    );
  }

  const undoId = await trashRow("interactions", req.params.id, req);
  if (!undoId) return res.status(404).json({ error: "Interaction not found" });
  res.json({ deleted: 1, undoId, undoSeconds: UNDO_SECONDS });
}));

// ── BUILD-99 (major gifts) Part 4 — THE PROSPECT BRIEF ─────────────────────
// "Brief me" on a person: one page an officer reads in the car, written from the
// organisation's own rows, every sentence citing one.
//
// THE GUARANTEE IS THE SCHEMA, NOT THE PROMPT. shared/briefShape.js has no
// numeric field anywhere in it, so a model that wanted to assert a capacity has
// nowhere to put it; every figure on the finished page is rendered HERE from the
// rows. A prompt is a request; this is the absence of a place to say it.
async function briefShapeMod() { return import("../../shared/briefShape.js"); }

// WHAT THE MODEL IS HANDED, AND NOTHING ELSE. Each row goes over as a line with
// a `kind:id` reference, and Steward keeps the same reference set to validate the
// citations against — so a cited row it never saw cannot survive.
async function briefRowsFor(orgId, donorId) {
  const P = await proposalMod();
  const V = await import("../../shared/vocabulary.js");
  const [org] = await query("SELECT * FROM orgs WHERE id=?", [orgId]);
  const t = V.makeT(org && org.vocabulary_json);
  const [donor] = await query(
    `SELECT id, name, email, kind, stage, suggested_stage, total_giving, ${require("../../shared/numbers/giftCount").DONOR_GIFT_COUNT("donors")} AS gift_count, first_gift_date,
            last_gift_date, last_gift_amount, notes, about_them, assigned_to_name, household_id, deceased, do_not_contact
       FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL`, [donorId, orgId]);   // TRUTH-5: the count is giftCount.js's
  if (!donor) return null;

  const refs = new Set([`person:${donor.id}`]);
  const lines = [];
  // ATLAS-4: the full words behind each quotable row, so a quote is Steward's (briefComplete.js).
  const quotes = new Map();
  const quote = (ref, kind, text) => { const t = String(text || "").trim(); if (t) quotes.set(ref, [...(quotes.get(ref) || []), { kind, text: t }]); };
  const money = require("../../money");
  const givingWord = t("giver_singular") || "donor";

  lines.push(`person:${donor.id} · ${donor.name}${donor.kind === "organisation" ? " (an organization)" : ""}, `
    + `${money.formatCentsPlain(toCents(donor.total_giving) || 0)} given in total across ${Number(donor.gift_count) || 0} gifts, `
    + `first on ${donor.first_gift_date || "no recorded date"}, most recently on ${donor.last_gift_date || "no recorded date"}`
    + `${donor.stage ? `, at the stage "${donor.stage}"` : ""}.`);   // ATLAS-3: the org's word is an instruction (briefFast.vocabularyRule), not a row

  // GIFTS — the last twelve, each its own row, with its fund and how it came in.
  const gifts = await query(
    `SELECT g.id, g.amount, g.date, g.type, g.payment_method, g.campaign, f.name AS fund_name
       FROM gifts g LEFT JOIN fin_funds f ON f.id = g.fund_id AND f.org_id = g.org_id
      WHERE g.org_id=? AND g.donor_id=? AND g.is_sample IS NOT TRUE
      ORDER BY g.date DESC NULLS LAST, g.id LIMIT 12`, [orgId, donorId]);
  for (const g of gifts) {
    refs.add(`gift:${g.id}`);
    lines.push(`gift:${g.id} · ${money.formatCentsPlain(toCents(g.amount) || 0)} on ${g.date}`
      + `${g.fund_name ? ` to ${t("fund_singular") || "fund"} "${g.fund_name}"` : ""}`
      + `${g.campaign ? `, appeal "${g.campaign}"` : ""}${g.payment_method ? `, by ${g.payment_method}` : ""}.`);
  }

  // PLEDGES — a promise is not money, and the brief must not read it as one.
  for (const p of await query(
    `SELECT id, amount, due_date, status FROM pledges WHERE org_id=? AND donor_id=? ORDER BY due_date DESC NULLS LAST LIMIT 6`, [orgId, donorId])) {
    refs.add(`pledge:${p.id}`);
    lines.push(`pledge:${p.id}, a pledge of ${money.formatCentsPlain(toCents(p.amount) || 0)} due ${p.due_date}, currently ${p.status}. A pledge is a promise, not money received.`);
  }

  // HOUSEHOLD AND RELATED PEOPLE.
  if (donor.household_id) {
    const [h] = await query("SELECT id, name FROM households WHERE id=? AND org_id=?", [donor.household_id, orgId]);
    if (h) {
      refs.add(`household:${h.id}`);
      const members = await query("SELECT name FROM donors WHERE org_id=? AND household_id=? AND id<>? AND deleted_at IS NULL", [orgId, h.id, donorId]);
      lines.push(`household:${h.id}, in the household "${h.name}"${members.length ? `, with ${members.map(m => m.name).join(" and ")}` : ""}.`);
    }
  }
  // SOFT CREDITS (BUILD-98 Part 1) — gifts that were somebody else's money.
  for (const sc of await query(
    `SELECT sc.id, sc.role, g.id AS gift_id, g.amount, g.date, d.name AS giver
       FROM gift_soft_credits sc
       JOIN gifts g ON g.id = sc.gift_id AND g.org_id = sc.org_id
       JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
      WHERE sc.org_id=? AND sc.donor_id=? ORDER BY g.date DESC NULLS LAST LIMIT 6`, [orgId, donorId]).catch(() => [])) {
    refs.add(`softcredit:${sc.id}`);
    lines.push(`softcredit:${sc.id}: soft-credited for ${money.formatCentsPlain(toCents(sc.amount) || 0)} given by ${sc.giver} on ${sc.date}`
      + `${sc.role ? ` as ${sc.role}` : ""}. The money was ${sc.giver}'s; this is recognition, not their own giving.`);
  }

  // THE OPEN PROPOSAL.
  for (const o of await query(
    `SELECT o.id, o.name, o.target_amount, o.proposal_stage, o.probability, o.notes, f.name AS fund_name,
            to_char(o.expected_close,'YYYY-MM-DD') AS expected_close_civil
       FROM opportunities o LEFT JOIN fin_funds f ON f.id = o.fund_id AND f.org_id = o.org_id
      WHERE o.org_id=? AND o.donor_id=? AND o.proposal_stage = ANY(?::text[])
      ORDER BY o.expected_close NULLS LAST LIMIT 3`, [orgId, donorId, P.OPEN_STAGE_KEYS])) {
    refs.add(`proposal:${o.id}`);
    lines.push(`proposal:${o.id}: an open ask of ${money.formatCentsPlain(toCents(o.target_amount) || 0)} for "${o.name}"`
      + `${o.fund_name ? ` (${o.fund_name})` : ""}, at stage "${P.stageLabel(o.proposal_stage)}"`
      + `${o.probability != null ? `, which the officer put at ${o.probability} per cent` : ", with no probability set"}`
      + `${o.expected_close_civil ? `, expected to close ${o.expected_close_civil}` : ""}`
      + `${o.notes ? `. The officer's note on it: "${String(o.notes).slice(0, 400)}"` : "."}`);
  }

  // THE LAST FIVE CONVERSATIONS, QUOTED.
  for (const i of await query(
    `SELECT id, type, date, note, logged_by_name FROM interactions
      WHERE org_id=? AND donor_id=? AND type = ANY(ARRAY['call','meeting','email','ask','note','stewardship'])
        AND COALESCE(note,'') <> '' ORDER BY date DESC NULLS LAST, created_at DESC LIMIT 5`, [orgId, donorId])) {
    refs.add(`conversation:${i.id}`);
    quote(`conversation:${i.id}`, "conversation", i.note);
    lines.push(`conversation:${i.id} · ${i.type} on ${i.date}${i.logged_by_name ? ` logged by ${i.logged_by_name}` : ""}: "${String(i.note).slice(0, 500)}"`);
  }

  // THE PLAN'S NEXT STEP.
  const [plan] = await query("SELECT id, template_name FROM cultivation_plans WHERE org_id=? AND donor_id=? AND status='active'", [orgId, donorId]);
  if (plan) {
    refs.add(`plan:${plan.id}`);
    const [openStep] = await query("SELECT seq, label, due_date FROM cultivation_plan_steps WHERE plan_id=? AND status='open'", [plan.id]);
    const [nextStep] = await query("SELECT seq, label, due_date FROM cultivation_plan_steps WHERE plan_id=? AND status='pending' ORDER BY seq LIMIT 1", [plan.id]);
    const s = openStep || nextStep;
    lines.push(`plan:${plan.id}: on the cultivation plan "${plan.template_name}"`
      + (s ? `; ${openStep ? "the open step" : "the next step"} is "${s.label}", due ${s.due_date}.` : "; every step is closed."));
  }

  // WHAT THE OFFICER WROTE.
  if (String(donor.notes || "").trim()) {
    refs.add(`note:${donor.id}`);
    quote(`note:${donor.id}`, "notes", donor.notes);
    lines.push(`note:${donor.id}: the note on their record reads: "${String(donor.notes).slice(0, 1200)}"`);
  }
  // DATES-1 · the short "About them" note people read first on the profile.
  if (String(donor.about_them || "").trim()) {
    refs.add(`note:${donor.id}`);
    quote(`note:${donor.id}`, "about", donor.about_them);
    lines.push(`note:${donor.id}: what the team wrote about them, read first on their profile: "${String(donor.about_them).slice(0, 500)}"`);
  }

  // The grounded numeric set: every figure that genuinely appears in the rows,
  // so `ungroundedClaims` can tell a fact from an invented rule.
  // THE MONEY SEAM, not Math.round — `tests/money-cents.test.js` is right that a
  // bare `Math.round(Number(x))` on a dollars value is the banned shape wherever
  // it appears, and "it is only feeding a text check" is not an exemption: the
  // next person to copy this line will not be feeding a text check.
  const grounded = [];
  for (const g of gifts) { const c = toCents(g.amount); if (c != null) grounded.push(toDollars(c), c); }
  grounded.push(Number(donor.gift_count) || 0);
  { const c = toCents(donor.total_giving); if (c != null) grounded.push(toDollars(c), c); }
  for (const l of lines) for (const m of String(l).matchAll(/\d+(?:\.\d+)?/g)) grounded.push(Number(m[0]));

  return { donor, org, t, refs, lines, quotes, grounded: [...new Set(grounded)], giftCount: gifts.length, givingWord };
}

// GET /donors/:id/brief-rows — EXACTLY what the model would be handed, and
// nothing else. This is not a test seam: the brief's promise is that every line
// rests on a row you can open, and this is that list. It also means the row
// gathering — which is Steward's code, not a model's — is provable with no key
// configured at all.
app.get("/donors/:id/brief-rows", requireAuth, requireCrm, wrap(async (req, res) => {
  const ctx = await briefRowsFor(req.user.orgId, req.params.id);
  if (!ctx) return res.status(404).json({ error: "Donor not found" });
  res.json({
    donorId: ctx.donor.id, donorName: ctx.donor.name,
    refs: [...ctx.refs], lines: ctx.lines, groundedValues: ctx.grounded,
  });
}));

// POST /donors/:id/brief — write it, validate it, log it as an agent run.
app.post("/donors/:id/brief", requireAuth, requireCrm, checkWriteAccess, wrap(async (req, res) => {
  const B = await briefShapeMod();
  const TH = await thresholdsMod();
  const orgId = req.user.orgId;
  // THE DONOR IS CHECKED FIRST, AND THAT ORDER IS THE POINT. The gate below
  // answers 503 when no key is configured, and running it first meant a probe
  // with ANOTHER ORG's donor id got 503 instead of 404 — breaking "404 is the one
  // answer" for a cross-tenant read and telling the caller both that the route
  // exists and what Steward's key state is. Found by tenant-matrix §3.
  const ctx = await briefRowsFor(orgId, req.params.id);
  if (!ctx) return res.status(404).json({ error: "Donor not found" });

  const gate = await agentGate(orgId);
  // THE ABSENCE HAS A NAME. No key configured is Steward's state, not the org's,
  // and the honest answer is that the control is unavailable — never a 500 and
  // never an invented brief.
  if (!gate.ok) return res.status(503).json({ error: "brief_unavailable", reason: gate.reason,
    message: gate.reason === "ai_disabled" ? AI_OFF_MESSAGE
      : "Not set up yet. Steward support can turn on AI drafting for this server, then an admin switches it on in Settings, Data." });

  // ATLAS-3 · first words at once, the last brief kept until a row changes.
  const BF = require("./briefFast");
  const BC = require("./briefComplete");   // ATLAS-4: no sentence ends on a colon; quotes are the record's, in full
  const fp = BF.fingerprint(ctx.lines);
  const write = BF.wantsStream(req) ? BF.startStream(res) : null;
  if (write) write({ type: "start", donorName: ctx.donor.name, opening: BF.openingLines(ctx, require("../../money"), toCents) });
  const finish = (status, out) => { if (write) { write(status < 300 ? { type: "brief", brief: out } : { type: "error", ...out }); return res.end(); } return res.status(status).json(out); };
  if (!(req.query && req.query.fresh === "1")) {
    const hit = await BF.cachedBrief(query, orgId, ctx.donor.id, fp);
    const kept = hit && BC.completeBrief(hit.brief, ctx);   // ATLAS-4: a brief kept from before is completed too
    if (hit) return finish(200, { runId: hit.runId, donorId: ctx.donor.id, donorName: ctx.donor.name, headline: kept.headline, sections: kept.sections,
      dropped: kept.dropped || [], droppedSentence: B.droppedSentence(kept.dropped || []), rowsRead: ctx.refs.size, footer: B.BRIEF_FOOTER, cached: true, writtenAt: hit.writtenAt });
  }

  const runId = newId("arun");
  await run(`INSERT INTO agent_runs (id,org_id,status,plan,read_summary) VALUES (?,?,?,?,?)`,
    [runId, orgId, "running", JSON.stringify({ kind: "prospect_brief", donorId: ctx.donor.id, fingerprint: fp }),
     `${ctx.refs.size} rows on ${ctx.donor.name}`]);

  const system = [
    "You are writing a one-page brief for a fundraiser who is about to go and see somebody.",
    "",
    "You are given ROWS from this organization's own records. Each row starts with a reference of the form kind:id.",
    "Write short, plain sentences about what those rows say. Every sentence must cite the references it rests on, exactly as given.",
    "",
    "RULES, and the first one is the whole job:",
    "- You may say NOTHING about this person that is not in the rows. No capacity, no wealth, no means, no guess about what they could give.",
    "- Use no figure that is not in the rows you were handed. Never state a rule about how giving works (no 'donors who give twice usually…').",
    "- A pledge is a promise, not money received. A soft credit is recognition, not their own giving. Say so if you mention them.",
    "- Quote a conversation rather than summarizing away the words the officer chose. A quote goes inside the sentence that introduces it, whole; never end a sentence on a colon.",
    "- Leave a section out if the rows say nothing about it. Do not pad.",
    "- Use this organization's own vocabulary where the rows give it.",
    ...[BF.vocabularyRule(ctx.givingWord)].filter(Boolean),
    "- Plain sentences a person would say out loud. Never write about the rows, references or records themselves.",
    "- The headline names who this is and why she is reading it, and contains no figure.",
  ].join("\n");
  const user = [`The rows, on ${ctx.donor.name}:`, "", ...ctx.lines, "", "Write the brief."].join("\n");

  let raw = null, err = null;
  try {
    const client = anthropicFor(orgId);
    const msg = await client.messages.create({
      model: BF.BRIEF_MODEL(), max_tokens: 1500, system,
      tools: [{ name: "brief", description: "The one-page brief she reads in the car.", strict: true, input_schema: B.BRIEF_SCHEMA }],
      tool_choice: { type: "tool", name: "brief" },
      messages: [{ role: "user", content: user }],
    });
    raw = (msg.content || []).find(b => b.type === "tool_use" && b.name === "brief")?.input || null;
  } catch (e) { err = e.message || String(e); }

  if (!raw) {
    await run("UPDATE agent_runs SET status='failed', finished_at=NOW(), error=? WHERE id=?", [err || "no brief returned", runId]);
    return finish(502, { error: "The brief could not be written just now.", runId });
  }

  const checked = BC.completeBrief(BF.scrub(B.validateBrief(raw, {
    rows: ctx.refs,
    ungrounded: (text, opts) => TH.ungroundedClaims(text, opts),
    groundedValues: ctx.grounded,
  })), ctx);
  await run(
    `UPDATE agent_runs SET status='done', finished_at=NOW(), actions=?, declined=?, withheld=?, withheld_reason=? WHERE id=?`,
    [JSON.stringify({ brief: checked, donorId: ctx.donor.id }), checked.dropped.length, checked.dropped.length,
     checked.dropped.length ? B.droppedSentence(checked.dropped) : null, runId]);

  finish(200, {
    runId, donorId: ctx.donor.id, donorName: ctx.donor.name,
    headline: checked.headline, sections: checked.sections,
    dropped: checked.dropped, droppedSentence: B.droppedSentence(checked.dropped),
    rowsRead: ctx.refs.size, footer: B.BRIEF_FOOTER,
  });
}));

// GET /briefs/:runId — read one back. It is an agent run, so it is on the
// Activity screen with everything else the agent did.
app.get("/briefs/:runId", requireAuth, wrap(async (req, res) => {
  const B = await briefShapeMod();
  const [r] = await query("SELECT * FROM agent_runs WHERE id=? AND org_id=?", [req.params.runId, req.user.orgId]);
  if (!r || !r.actions || !r.actions.brief) return res.status(404).json({ error: "Brief not found" });
  const [d] = await query("SELECT id, name FROM donors WHERE id=? AND org_id=?", [r.actions.donorId, req.user.orgId]);
  res.json({
    runId: r.id, donorId: r.actions.donorId, donorName: d ? d.name : "",
    ...r.actions.brief, droppedSentence: B.droppedSentence(r.actions.brief.dropped || []),
    writtenAt: r.finished_at, rowsRead: r.read_summary, footer: B.BRIEF_FOOTER,
  });
}));

// GET /briefs/:runId/pdf — the page she prints for the car, on the org's
// letterhead, through the same renderer discipline the acknowledgment letters use.
app.get("/briefs/:runId/pdf", requireAuth, wrap(async (req, res) => {
  const B = await briefShapeMod();
  const [r] = await query("SELECT * FROM agent_runs WHERE id=? AND org_id=?", [req.params.runId, req.user.orgId]);
  if (!r || !r.actions || !r.actions.brief) return res.status(404).json({ error: "Brief not found" });
  const [org] = await query("SELECT name, legal_name, receipt_address, brand_accent, logo_data FROM orgs WHERE id=?", [req.user.orgId]);
  const [d] = await query("SELECT name FROM donors WHERE id=? AND org_id=?", [r.actions.donorId, req.user.orgId]);
  const pdf = await renderBriefPdf({
    org: { display: org.legal_name || org.name, receipt_address: org.receipt_address,
           brand_accent: org.brand_accent, logo_data: org.logo_data },
    donorName: d ? d.name : "",
    brief: r.actions.brief,
    footer: B.BRIEF_FOOTER,
    droppedSentence: B.droppedSentence(r.actions.brief.dropped || []),
    sectionTitle: B.sectionTitle,
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="brief-${(d ? d.name : "prospect").replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}.pdf"`);
  res.send(pdf);
}));

// ONE page, the org's letterhead, and the footer that says what this is. The
// letterhead block is deliberately the same shape as renderLettersPdf's (BUILD-98
// Part 2) rather than a second idea about where an org's name goes.
function renderBriefPdf({ org, donorName, brief, footer, droppedSentence, sectionTitle }) {
  const PDFDocument = require("pdfkit");
  const doc = new PDFDocument({ size: "LETTER", margins: { top: 50, bottom: 46, left: 72, right: 72 }, autoFirstPage: false });
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", c => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const INK = "#0f1a12", SUB = "#5a554f";
    const accent = org.brand_accent || "#0d5c3a";
    let logo = null;
    if (org.logo_data && /^data:image\/(png|jpe?g);base64,/.test(org.logo_data)) {
      try { logo = Buffer.from(org.logo_data.split(",")[1], "base64"); } catch { logo = null; }
    }
    doc.addPage();
    const PW = doc.page.width;
    doc.rect(0, 0, PW, 6).fill(accent);
    if (logo) { try { doc.image(logo, PW - 72 - 60, 22, { fit: [60, 44] }); } catch { /* a logo that will not draw costs the logo, not the page */ } }
    doc.font("Helvetica-Bold").fontSize(13).fillColor(INK).text(org.display || "", 72, 26, { width: PW - 220, lineBreak: false });
    if (org.receipt_address) doc.font("Helvetica").fontSize(8.5).fillColor(SUB).text(org.receipt_address, 72, 44, { width: PW - 220 });

    let y = 92;
    doc.font("Times-Bold").fontSize(19).fillColor(INK).text(donorName || "Prospect brief", 72, y, { width: PW - 144 });
    y = doc.y + 4;
    if (brief.headline) {
      doc.font("Times-Italic").fontSize(11.5).fillColor(SUB).text(brief.headline, 72, y, { width: PW - 144 });
      y = doc.y + 10;
    }
    const bottom = doc.page.height - 84;
    for (const sec of (brief.sections || [])) {
      if (y > bottom - 40) break;                 // held to ONE page, never spilled
      doc.font("Helvetica-Bold").fontSize(9).fillColor(accent)
        .text(String(sectionTitle(sec.key) || sec.key).toUpperCase(), 72, y, { width: PW - 144, characterSpacing: 0.8 });
      y = doc.y + 4;
      for (const s of sec.sentences) {
        if (y > bottom - 14) break;
        doc.font("Times-Roman").fontSize(10.5).fillColor(INK)
          .text(s.text, 72, y, { width: PW - 144, lineGap: 2, height: bottom - y, ellipsis: true });
        y = doc.y + 3;
      }
      y += 7;
    }
    let fy = doc.page.height - 74;
    if (droppedSentence) {
      doc.font("Helvetica").fontSize(8).fillColor(SUB).text(droppedSentence, 72, fy, { width: PW - 144, height: 12 });
      fy += 12;
    }
    doc.font("Helvetica").fontSize(8).fillColor(SUB).text(footer, 72, fy, { width: PW - 144, height: 26 });
    doc.end();
  });
}

// ── PARITY-1 Part B — A FILE ON A CONVERSATION OR A NOTE ──────────────────
// interactionFiles.js holds the types, the byte checks and the signed door.
// The bytes go through the asset seam (assetStore.js) under kind 'ixfile'.
// There is NO virus scan (the host offers none): see that module's header and
// docs/decisions/people-and-records.md. (IXF is required with the imports.)

function ixAttachmentRow(r, orgId) {
  return {
    id: r.id, interactionId: r.interaction_id, donorId: r.donor_id,
    fileName: r.filename, mime: r.mime, bytes: Number(r.bytes) || 0,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    createdByName: r.created_by_name || "",
    interactionType: r.interaction_type || null,
    interactionDate: r.interaction_date ? String(r.interaction_date instanceof Date ? orgTime.civilOf(r.interaction_date) : r.interaction_date).slice(0, 10) : null,
    // Minted PER READ, thirty minutes. A stored URL outlives its reason.
    url: IXF.signFileUrl({ orgId, assetId: r.asset_id }),
  };
}

// POST /interactions/:id/attachments — one file, on an entry that exists.
app.post("/interactions/:id/attachments", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [ix] = await query("SELECT id, donor_id FROM interactions WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!ix || !ix.donor_id) return res.status(404).json({ error: "Interaction not found" });

  const m = /^data:([a-zA-Z0-9.+/-]*);base64,(.+)$/s.exec(String(req.body.file || ""));
  if (!m) return res.status(400).json({ code: "no_file", error: "Attach a file." });
  const mime = IXF.resolveMime(m[1], req.body.fileName);
  if (!IXF.mimeAllowed(mime)) {
    return res.status(400).json({ code: "bad_file_type",
      error: `Steward stores ${IXF.TYPES_SENTENCE}. It refuses anything that can carry a script.` });
  }
  let buffer;
  try { buffer = Buffer.from(m[2], "base64"); }
  catch { return res.status(400).json({ code: "no_file", error: "That file could not be read." }); }
  if (!buffer.length) return res.status(400).json({ code: "no_file", error: "That file is empty." });
  if (buffer.length > IXF.FILE_MAX_BYTES) {
    return res.status(400).json({ code: "file_too_large",
      error: `That file is ${(buffer.length / 1024 / 1024).toFixed(1)} MB, over the ${IXF.FILE_MAX_BYTES / 1024 / 1024} MB limit.` });
  }
  // THE BYTES DECIDE, before anything is stored.
  if (!IXF.bytesMatchMime(buffer, mime)) {
    return res.status(400).json({ code: "file_type_mismatch",
      error: `That file does not look like a ${IXF.extensionFor(mime) || mime}. Check you attached what you meant to.` });
  }
  const asset = await putThemeAsset({ orgId, kind: IXF.FILE_ASSET_KIND, buffer, contentType: mime });
  const id = newId("iatt");
  const who = actor(req);
  const [u] = await query("SELECT name FROM users WHERE id=? AND org_id=?", [who.id, orgId]);
  await run(
    `INSERT INTO interaction_attachments (id,org_id,interaction_id,donor_id,asset_id,filename,mime,bytes,created_by,created_by_name)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, orgId, ix.id, ix.donor_id, asset.id, IXF.sanitizeFilename(req.body.fileName, mime), mime, buffer.length,
     who.id, (u && u.name) || who.name]);
  await recordAssetPointerHistory(orgId, "interaction.attachment", id, null, asset.id, req.user);
  const [row] = await query("SELECT * FROM interaction_attachments WHERE id=?", [id]);
  if (req.audit) { req.audit.entity("interaction_attachment", id, row.filename); req.audit.after({ ...row, asset_id: undefined }); }
  res.status(201).json(ixAttachmentRow(row, orgId));
}));

// GET /donors/:id/attachments — every live file on this person's entries,
// newest first. An entry in the trash hides its files until it is restored.
app.get("/donors/:id/attachments", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  if (!(await orgOwns("donors", req.params.id, orgId))) return res.status(404).json({ error: "Donor not found" });
  const rows = await query(
    `SELECT a.*, i.type AS interaction_type, i.date AS interaction_date
       FROM interaction_attachments a
       JOIN interactions i ON i.id = a.interaction_id AND i.org_id = a.org_id
      WHERE a.org_id=? AND a.donor_id=? AND a.deleted_at IS NULL
      ORDER BY a.created_at DESC`, [orgId, req.params.id]);
  const attachments = rows.map(r => ixAttachmentRow(r, orgId));
  const n = attachments.length;
  res.json({ attachments,
    sentence: n ? `${n} ${n === 1 ? "file" : "files"} attached to conversations and notes with this person.`
                : "No files attached to conversations or notes yet." });
}));

// DELETE /interactions/:id/attachments — body { attachmentId }. SOFT: the row
// keeps who attached it and who removed it; the bytes age out of the asset
// store's 90-day retention. Ungated, per the DELETE convention. Whoever logged
// the entry, whoever attached the file, or an admin may remove it.
app.delete("/interactions/:id/attachments", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [ix] = await query("SELECT id, created_by FROM interactions WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!ix) return res.status(404).json({ error: "Interaction not found" });
  const attId = String((req.body && req.body.attachmentId) || req.query.attachmentId || "");
  const [a] = await query(
    "SELECT * FROM interaction_attachments WHERE id=? AND interaction_id=? AND org_id=? AND deleted_at IS NULL",
    [attId, ix.id, orgId]);
  if (!a) return res.status(404).json({ error: "Attachment not found" });
  if (a.created_by !== req.user.userId && !(await mayEditLogged(req, ix))) return res.status(403).json(NOT_YOURS);
  await run("UPDATE interaction_attachments SET deleted_at=NOW(), deleted_by=? WHERE id=? AND org_id=?",
    [actor(req).id, a.id, orgId]);
  await recordAssetPointerHistory(orgId, "interaction.attachment", a.id, a.asset_id, null, req.user);
  await pruneUnreferencedAssets(orgId, IXF.FILE_ASSET_KIND, []);
  if (req.audit) { req.audit.entity("interaction_attachment", a.id, a.filename); req.audit.before({ ...a, asset_id: undefined }); }
  res.json({ ok: true, id: a.id });
}));

// GET /interaction-files/:id — the signed, expiring, PRIVATE door. No auth
// header (a browser fetches a file with none); the URL carries its signature,
// minted only for signed-in staff of the org, and the org comes from the
// STORED ROW. A removed attachment stops serving even inside its thirty minutes.
// FIX-20 Part 0: and a signed-in user of that org, as /grant-documents.
app.get("/interaction-files/:id", fileLimiter, requireAuth404, wrap(async (req, res) => {
  const id = String(req.params.id || "");
  if (!ASSET_ID_RE.test(id)) return res.status(404).json({ error: "not_found" });
  const [row] = await query(
    `SELECT org_id FROM portal_assets WHERE id = ? AND kind = ? AND deleted_at IS NULL`, [id, IXF.FILE_ASSET_KIND]);
  if (!row || row.org_id !== req.user.orgId) return res.status(404).json({ error: "not_found" });
  const v = IXF.verifyFileUrl({ orgId: row.org_id, assetId: id, e: req.query.e, s: req.query.s });
  if (!v.ok) return res.status(403).json({ error: "link_expired" });
  const [meta] = await query(
    "SELECT filename FROM interaction_attachments WHERE asset_id=? AND org_id=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1",
    [id, row.org_id]);
  if (!meta) return res.status(404).json({ error: "not_found" });
  const asset = await getThemeAsset(id);
  if (!asset) return res.status(404).json({ error: "not_found" });
  res.set("Content-Type", asset.contentType);
  // Never rendered inline in our origin: no scan has looked at these bytes.
  const safeName = IXF.sanitizeFilename(meta.filename, asset.contentType);
  res.set("Content-Disposition", `attachment; filename="${safeName.replace(/"/g, "")}"`);
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Cache-Control", `private, max-age=${Math.max(0, Math.floor((v.expiresAt - Date.now()) / 1000))}`);
  res.send(asset.buffer);
}));

// POST /donors/:id/conversations — THE write path of the Thread. Logs the
// touch (one line, an interactions row with the BUILD-75 actor), and the
// next-step decision travels IN THE SAME REQUEST: {type, due} opens the next
// thread, {skipped:true} is recorded as skipped on the interaction (the
// BUILD-76 rule — never as nothing). If the donor had an open thread, this
// conversation IS its outcome: the thread closes pointing at this
// interaction, and the next-step prompt's answer decides whether another
// opens. One request, one transaction — no half-logged state.
app.post("/donors/:id/conversations", requireAuth, wrap(async (req, res) => {
  const { orgId, userId } = req.user;
  const [donor] = await query(
    "SELECT id, assigned_to, assigned_to_name FROM donors WHERE id = ? AND org_id = ? AND deleted_at IS NULL",
    [req.params.id, orgId]);
  if (!donor) return res.status(404).json({ error: "Donor not found" });

  const shape = await threadShapeMod();
  // TOUCH-1: "Log a touch" names `touchKind` (shared/touchKinds.js); its words
  // are optional except for Other, and its day is today or earlier.
  const t1 = req.body && req.body.touchKind != null
    ? await TOUCH.prepare(orgId, req.params.id, req.body, orgToday(await orgTz(orgId)), actor(req)) : null;   // ORG_TZ_SEAM_OK
  if (t1 && t1.refused) return res.status(t1.refused.status).json(t1.refused.body);
  const touch = t1 ? t1.touch : shape.touchTypeFor(String(req.body?.touch || ""));
  if (!touch) return res.status(400).json({ error: "Unknown touch type" });
  const line = t1 ? t1.line : typeof req.body?.line === "string" ? req.body.line.trim().slice(0, 8000) : "";
  if (!line) return res.status(400).json({ error: "The one line is required, what happened?" });
  // FIX-14 Part 1 — where it happened, for a meeting or a visit. The card is
  // titled by it ("Meeting at Starbucks").
  const place = typeof req.body?.place === "string" ? req.body.place.trim().slice(0, 200) : "";

  const org = await orgTz(orgId);
  const today = orgToday(org);                          // ORG_TZ_SEAM_OK
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.date || "")) ? req.body.date : today;

  const ns = req.body?.nextStep;
  const nsSkipped = !!(ns && ns.skipped === true);
  let step = null;
  if (!nsSkipped) {
    const typeLabel = shape.nextStepLabelFor(ns?.type);
    if (!ns || !typeLabel) return res.status(400).json({ error: "nextStep must be {type, due} from the offered set, or {skipped:true}: a skip is recorded, silence is not accepted" });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ns.due || ""))) return res.status(400).json({ error: "nextStep.due must be a date (YYYY-MM-DD)" });
    // The label is the user's own sentence when they wrote one (a note-derived
    // step, or one they retyped in the row); the type's label otherwise. A
    // suggestion the user has to retype costs time instead of saving it.
    const label = shape.sanitizeStepLabel(ns.label) || typeLabel;
    // BUILD-84 FEATURE — the optional time. A 2:00 reminder does not forgive
    // being an hour off, so it is refused outright for an org whose timezone
    // is still Steward's default guess rather than a choice someone made.
    let time = shape.sanitizeStepTime(ns.time);
    if (ns.time != null && ns.time !== "" && !time)
      return res.status(400).json({ error: "nextStep.time must be a 24-hour HH:MM, or omitted for a date-only step" });
    if (time && !org.timezone_confirmed_at) {
      return res.status(400).json({ error: "timezone_unset",
        message: "Set your organization's timezone in Settings before scheduling a reminder at a specific time, Steward will not fire one at a guessed hour." });
    }
    step = { type: ns.type, label, due: ns.due, time };
  }
  // Which rule produced the proposal — "note" or "touch" — recorded with the
  // conversation so a wrong guess can be found later, not just corrected once.
  const nsSource = ["note", "touch"].includes(String(req.body?.nextStep?.source || "")) ? req.body.nextStep.source : null;
  // JOURNEYS-4 — how it ended, if she picked one. Anything else is dropped.
  const outcome = (await journeyMod()).TASK_OUTCOME_KEYS.includes(String(req.body?.outcome || "")) ? String(req.body.outcome) : null;

  const userRow = await query("SELECT name FROM users WHERE id=?", [userId]);
  const userName = userRow[0]?.name || "";

  // ── BUILD-88a A.1 — THE OPTIONAL AMOUNT ──────────────────────────────────
  // A gift mentioned in a conversation IS a gift: it is written as a gift row,
  // through the one function, with its fund and method inline. It defaults to
  // the org's unrestricted fund and to "Needs you" as the method — a blank
  // reads the same as "nobody has looked", and this one is worth asking about.
  // The gift is written BEFORE the conversation, because the money must land
  // even if the follow-up write fails; the idempotency key is this exact
  // conversation, so a retried save cannot mint a second gift.
  let giftWritten = null;
  const giftIn = req.body && req.body.gift;
  if (giftIn && giftIn.amount != null && String(giftIn.amount).trim() !== "") {
    let giftAmt;
    try { giftAmt = toDollars(parseMoneyOrThrow(giftIn.amount, "gift.amount")); }
    catch (e) { return res.status(400).json({ error: e.message, code: e.code }); }
    if (!(giftAmt > 0)) return res.status(400).json({ error: "A gift on a conversation must be more than zero, leave it blank if there was none." });
    if (giftIn.fundId && !(await orgOwns("fin_funds", giftIn.fundId, orgId)))
      return res.status(404).json({ error: "Fund not found" });
    giftWritten = await recordGift({
      orgId, donorId: req.params.id, amount: giftAmt, date, type: "cash",
      fundId: giftIn.fundId || null, paymentMethod: giftIn.paymentMethod,
      notes: line, timeline: false,          // the conversation IS the timeline entry
      idempotencyKey: `conversation:${req.params.id}:${date}:${giftAmt}:${line}`.slice(0, 128),
      conflict: "idempotency",
      actorId: userId, actorName: userName, source: "conversation",
    });
  }
  const giftIdForTimeline = giftWritten && giftWritten.gift ? giftWritten.gift.id : null;

  const out = await withTransaction(async (client) => {
    const intId = newId("int");
    await runTx(client,
      "INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name,gift_id,metadata) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [intId, orgId, req.params.id, touch.interactionType, line, date, userId, userName, giftIdForTimeline,
       JSON.stringify({ via: "thread_log", touch: touch.key, next_step: nsSkipped ? "skipped" : "set", ...(place ? { location: place } : {}),
                        // COUNTS-1: a note she marks as a conversation is a contact (meetings.js).
                        ...(touch.interactionType === "note" && req.body?.conversation === true ? { conversation: true } : {}),
                        ...(step ? { next_step_label: step.label } : {}), ...(nsSource ? { next_step_source: nsSource } : {}),
                        ...(outcome ? { outcome } : {}), ...(t1 ? t1.meta : {}),
                        // ONBOARD-2: logged from one of Steward's moves (Home's deck, or Who to call tomorrow): a kickoff signal.
                        ...(req.body?.fromMove === true ? { from_move: true } : {}) })]);

    // An open thread on this donor closes on this conversation, the outcome.
    // SENDS-1: a skip closes nothing at all, the follow-up it was opened on
    // included (server/tasks/logClose.js, the one rule for every log path).
    const closedRows = await LOG_CLOSE.closeOnLog(client, queryTx, { orgId, donorId: req.params.id, interactionId: intId, skipped: nsSkipped });

    let thread = null;
    if (step) {
      // The meeting/visit chain: when the user KEPT the thank-you-note
      // default, the second thread (Follow up, +14 from the touch) rides
      // along and prefills the prompt when this one closes. A changed type
      // is the user's decision replacing the plan — no follow-on.
      const def = shape.NEXT_STEP_DEFAULTS[touch.key];
      const followon = def?.followon && step.type === def.type && step.label === def.label
        ? { type: def.followon.type, label: def.followon.label, due: shape.addCivilDays(date, def.followon.plusDays) }
        : null;
      thread = await openThreadTx(client, {
        orgId, donorId: req.params.id, step, openedOn: today,
        // COUNTS-1: the follow-up she set while logging is HERS, so it is in
        // her Tasks and on her Thread, not only on the person's rail. It went
        // to the person's officer, and a director who logged a call on Priya's
        // donor saw "Follow up · Due Nov 9" in the rail and nowhere else.
        ownerId: userId, ownerName: userName,
        actorId: userId, actorName: userName, openingInteractionId: intId, followon,
      });
    }
    return { interactionId: intId, closedThreadId: closedRows[0]?.id || null, thread };
  });

  calcWealthScore(req.params.id, orgId).catch(e => console.error("score recalc:", e.message));
  // JOURNEYS-4 — a call or meeting logged on the Thread closes its step's task
  // (FIX-31), and that task is the one finished with this outcome.
  if (outcome && out.closedThreadId && ["call", "meeting"].includes(touch.interactionType)) {
    await run(`UPDATE tasks SET outcome=?, completed_at=COALESCE(completed_at, NOW()) WHERE thread_id=? AND org_id=? AND done=1`,
      [outcome, out.closedThreadId, orgId]).catch(e => console.error("[journey] task outcome:", e.message));
  }
  // FIX-14 Part 2 — the audit row names the conversation that was logged
  // (the response's first object is the thread, which is the wrong record),
  // and carries it, so the log can say "Logged a meeting with ...".
  if (req.audit) {
    const [logged] = await query("SELECT * FROM interactions WHERE id = ?", [out.interactionId]);
    req.audit.entity("interaction", out.interactionId);
    req.audit.after(logged ? { ...logged, next_step: step ? { label: step.label, due: step.due } : "skipped" } : null);
  }
  // BUILD-99 Part 3 — A PLAN STEP IS DONE WHEN ITS THREAD CLOSES, and the next
  // one opens. Called AFTER the transaction, so the plan reads the thread rows
  // this conversation actually committed. It is idempotent and self-healing: if
  // the officer's own next step already took the donor's one open thread slot,
  // the plan's next step stays PENDING and the next close advances it — which is
  // what makes this work with no background tick (production has none).
  await advanceCultivationPlan(orgId, req.params.id, {
    actorId: actor(req).id, actorName: actor(req).name, today: date,
  }).catch(e => console.error("[plan] advance:", e.message));
  // A.1 — the gift the conversation carried, named in the response so the
  // screen can say what it recorded instead of the user going to look.
  const giftOut = giftWritten && giftWritten.gift
    ? { id: giftWritten.gift.id, amount: round2(parseFloat(giftWritten.gift.amount) || 0),
        fundId: giftWritten.fundId, paymentMethod: giftWritten.paymentMethod }
    : (giftWritten && giftWritten.duplicate ? { duplicate: true } : null);
  // LIVE-1 — the conversation (and any gift it carried) is a change to the
  // person: the after-change step. A gift written above ran it already with
  // the gift form's name; this is the touch's own call.
  await require("../../afterChange").afterChange(orgId, [req.params.id], { door: "logged_touch", recalc: false });
  // TOUCH-1: a planned touch of this kind is done by logging it (early is fine).
  const completed = t1 && t1.completes ? await TOUCH.completePlanned(orgId, req.params.id, t1.completes.taskId, t1.kind.key, actor(req)) : null;
  // COUNTS-1: the one Last contact, in the same response as the log.
  const lastContact = await require("../../meetings").lastContactWith(orgId, req.params.id);
  res.status(201).json({ ...out, skipped: nsSkipped, gift: giftOut, lastContact, ...(completed ? { completed } : {}) });
}));

// ── FIX-14 Part 1 — WHAT STEWARD HEARD IN A LOGGED CONVERSATION ────────────
// The FIX-12 after-meeting engine, for a conversation logged by hand: the
// Agent engine reads the note through the one AI door (aiClient.js asks the
// org's switch), and shared/meetingNote.js's simple reader is the fallback.
// Three chips, and NOTHING is recorded until a person says yes:
//   next     sets the profile's next step: the donor's one open Thread step
//   spouse   links the spouse named in the note into one household, matching
//            a person already on file by name or adding them (the one person
//            record: a row in donors, person type "other")
//   planned  marks the record a planned-giving prospect (the designation)
// A chip answered either way is remembered on the interaction
// (metadata.chips_done), so it is offered once.
const CONVO_CHIP_TTL_MS = 10 * 60 * 1000;
const _convoChipCache = new Map();   // interaction id + note → the engine's chips, briefly
async function loggedConversation(orgId, id) {
  const [i] = await query(
    `SELECT i.id, i.donor_id, i.type, i.note, i.date, i.metadata, d.name AS donor_name, d.household_id
       FROM interactions i JOIN donors d ON d.id = i.donor_id AND d.org_id = i.org_id
      WHERE i.id = ? AND i.org_id = ? AND d.deleted_at IS NULL`, [id, orgId]);
  if (!i) return null;
  i.meta = typeof i.metadata === "string" ? (() => { try { return JSON.parse(i.metadata); } catch { return {}; } })() : (i.metadata || {});
  i.done = Array.isArray(i.meta.chips_done) ? i.meta.chips_done : [];
  return i;
}
async function spouseCandidate(orgId, i, name) {
  const given = String(name || "").trim();
  const ln = lastName(i.donor_name);
  const full = given.includes(" ") || !ln ? given : `${given} ${ln}`;
  const rows = await query(
    `SELECT id, name, household_id FROM donors WHERE org_id = ? AND deleted_at IS NULL AND id <> ?
        AND (LOWER(name) = LOWER(?) OR LOWER(name) = LOWER(?)) ORDER BY (LOWER(name) = LOWER(?)) DESC LIMIT 2`,
    [orgId, i.donor_id, full, given, full]);
  return { full, match: rows.length >= 1 && (rows.length === 1 || rows[0].name.toLowerCase() === full.toLowerCase()) ? rows[0] : null };
}

app.post("/interactions/:id/suggest", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  if (req.audit) req.audit.skip("reads a note and writes nothing");
  const i = await loggedConversation(orgId, req.params.id);
  if (!i) return res.status(404).json({ error: "Not found" });
  const N = await import("../../shared/meetingNote.js");
  const note = String(i.note || "").slice(0, 4000);
  const ctx = { date: String(i.date || "").slice(0, 10) };
  let suggestions = null, source = "reader", aiOff = false;
  const ck = i.id + "\u0000" + note;
  const hit = _convoChipCache.get(ck);
  if (hit && hit.until > Date.now()) { suggestions = hit.chips; source = "agent"; }
  else if (note.trim()) {
    try {
      const r = await anthropicFor(orgId).messages.create({
        model: AGENT_MODEL, max_tokens: 600, system: N.CONVERSATION_CHIP_SYSTEM,
        messages: [{ role: "user", content: `Her note:\n"""${note}"""` }],
        tools: [N.CONVERSATION_CHIP_TOOL], tool_choice: { type: "tool", name: N.CONVERSATION_CHIP_TOOL.name } });
      const use = (r.content || []).find(c => c.type === "tool_use");
      const chips = N.validateConversationChips(use && use.input && use.input.chips, note, ctx);
      if (chips.length) { suggestions = chips; source = "agent"; _convoChipCache.set(ck, { chips, until: Date.now() + CONVO_CHIP_TTL_MS }); }
    } catch (e) {
      if (e instanceof AiOffError) aiOff = e.reason === "ai_disabled";
      else console.error("[conversation-chips] engine:", e.message);
    }
  }
  if (!suggestions) suggestions = N.suggestFromConversation(note, ctx);
  // Only what is not already true, and not already answered.
  const out = [];
  for (const c of suggestions) {
    if (i.done.includes(c.kind)) continue;
    if (c.kind === "planned") {
      const [has] = await query(`SELECT 1 FROM donor_designations WHERE org_id = ? AND donor_id = ? AND kind IN ('planned_prospect','planned_confirmed','estate')`, [orgId, i.donor_id]);
      if (has) continue;
    }
    if (c.kind === "spouse") {
      const { full, match } = await spouseCandidate(orgId, i, c.name);
      if (match && i.household_id && match.household_id === i.household_id) continue;
      out.push({ ...c, fullName: full, matchId: match ? match.id : null,
        label: match ? `Link ${match.name} to the household` : `Add ${full} and link the household` });
      continue;
    }
    if (c.kind === "next") {
      const [open] = await query(`SELECT due_date FROM threads WHERE org_id = ? AND donor_id = ? AND closed_at IS NULL`, [orgId, i.donor_id]);
      if (open && open.due_date === c.due) continue;
    }
    out.push(c);
  }
  res.json({ suggestions: out, source,
    sentence: aiOff ? AI_OFF_MESSAGE + ". These come from Steward's simple reader. Nothing changes until you say yes."
      : "Read from the note. Nothing changes until you say yes." });
}));

app.post("/interactions/:id/chips", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { orgId, userId } = req.user;
  const i = await loggedConversation(orgId, req.params.id);
  if (!i) return res.status(404).json({ error: "Not found" });
  const kind = String(req.body?.kind || "");
  if (!["next", "spouse", "planned"].includes(kind)) return res.status(400).json({ error: "kind must be next, spouse or planned" });
  const answer = req.body?.answer === "no" ? "no" : "yes";
  const who = actor(req);
  let sentence = "Fine. Steward will not offer that again for this note.";
  if (answer === "yes" && kind === "next") {
    const shape = await threadShapeMod();
    const label = shape.sanitizeStepLabel(req.body?.label) || "Follow up";
    const due = String(req.body?.due || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return res.status(400).json({ error: "due must be a date (YYYY-MM-DD)" });
    const [donor] = await query("SELECT assigned_to, assigned_to_name FROM donors WHERE id = ? AND org_id = ?", [i.donor_id, orgId]);
    const today = orgToday(await orgTz(orgId));   // ORG_TZ_SEAM_OK
    const [open] = await query("SELECT id FROM threads WHERE org_id = ? AND donor_id = ? AND closed_at IS NULL", [orgId, i.donor_id]);
    if (open) {
      // One open step per person: her yes replaces what it says and when.
      await run("UPDATE threads SET next_step_type = ?, next_step_label = ?, due_date = ?, snoozed_until = NULL WHERE id = ? AND org_id = ?",
        [shape.nextStepTypeForLabel(label), label, due, open.id, orgId]);
    } else {
      await withTransaction(client => openThreadTx(client, {
        orgId, donorId: i.donor_id, step: { type: shape.nextStepTypeForLabel(label), label, due, time: null }, openedOn: today,
        ownerId: donor?.assigned_to || userId, ownerName: donor?.assigned_to ? donor.assigned_to_name : who.name,
        actorId: who.id, actorName: who.name, openingInteractionId: i.id,
      }));
    }
    sentence = `Next step set: ${label}, due ${(await import("../../shared/displayDate.js")).displayDay(due, today) || due}.`;
  } else if (answer === "yes" && kind === "spouse") {
    const name = String(req.body?.name || "").trim().slice(0, 120);
    if (!name) return res.status(400).json({ error: "name is required" });
    let spouseId = null;
    if (req.body?.matchId) {
      const [m] = await query("SELECT id, household_id FROM donors WHERE id = ? AND org_id = ? AND deleted_at IS NULL", [String(req.body.matchId), orgId]);
      if (!m) return res.status(404).json({ error: "That person is not on file." });
      if (m.household_id && i.household_id && m.household_id !== i.household_id)
        return res.status(400).json({ error: "That person is already in another household." });
      spouseId = m.id;
    }
    await withTransaction(async client => {
      if (!spouseId) {
        // THE ONE PERSON RECORD: a spouse is a row in donors, not a field.
        spouseId = newId("d");
        await runTx(client,
          `INSERT INTO donors (id,org_id,name,email,phone,status,stage,total_giving,last_gift_amount,gift_count,tags,notes,created_by,created_by_name,person_types)
           VALUES (?,?,?,'','','new','prospect',0,0,0,'[]','',?,?,?)`,
          [spouseId, orgId, name, who.id, who.name, JSON.stringify(["other"])]);
      }
      let hh = i.household_id;
      if (!hh) {
        const [sp] = await queryTx(client, "SELECT household_id FROM donors WHERE id = ? AND org_id = ?", [spouseId, orgId]);
        hh = sp && sp.household_id;
      }
      if (!hh) {
        hh = newId("hh");
        const ln = lastName(i.donor_name);
        await runTx(client, "INSERT INTO households (id,org_id,name,primary_donor_id,joint_acknowledgment,created_by,created_by_name) VALUES (?,?,?,?,?,?,?)",
          [hh, orgId, ln ? `The ${ln} Household` : "Household", i.donor_id, true, who.id, who.name]);
      }
      await runTx(client, "UPDATE donors SET household_id = ? WHERE org_id = ? AND id = ANY(?)", [hh, orgId, [i.donor_id, spouseId]]);
    });
    sentence = `${name} is linked to ${i.donor_name}'s household.`;
  } else if (answer === "yes" && kind === "planned") {
    await run("INSERT INTO donor_designations (id,org_id,donor_id,kind) VALUES (?,?,?,?) ON CONFLICT (donor_id, kind) DO NOTHING",
      [newId("dsg"), orgId, i.donor_id, "planned_prospect"]);
    sentence = `${i.donor_name} is marked as a planned-giving prospect.`;
  }
  await run(`UPDATE interactions SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('chips_done', ?::jsonb)
              WHERE id = ? AND org_id = ?`, [JSON.stringify([...new Set([...i.done, kind])]), i.id, orgId]);
  if (req.audit) { req.audit.entity("donor", i.donor_id); req.audit.action(answer === "yes" ? `confirmed the ${kind} suggestion` : `declined the ${kind} suggestion`); }
  res.json({ ok: true, kind, answer, sentence });
}));

// ── Voice memos ──────────────────────────────────────────────────────────────
// Two-step, human-in-the-loop flow: /transcribe uploads + transcribes audio
// and runs one narrow AI extraction pass, but saves NOTHING — the officer
// reviews the transcript and suggestions client-side and only /save persists
// anything (the interaction, and optionally the extracted detail/task, only
// if the officer confirmed each). Requires OPENAI_API_KEY (Whisper) — if
// unset, returns a clear error rather than failing silently or falling back
// to a stub.
app.post("/voice-memos/transcribe", requireAuth, wrap(async (req, res) => {
  const { donorId, audioBase64, mimeType } = req.body;
  if (!donorId || !audioBase64) return res.status(400).json({ error: "A donor and a recording are both needed." });
  if (!process.env.OPENAI_API_KEY) {
    console.error("[voice-memo] transcription refused: no transcription key is configured on this server");
    return res.status(503).json({ error: "Voice notes aren't available yet. We'll let you know when they are." });
  }

  const donorRows = await query("SELECT id, name FROM donors WHERE id=? AND org_id=?", [donorId, req.user.orgId]);
  if (!donorRows.length) return res.status(404).json({ error: "Donor not found" });

  let transcript;
  // FIX-12 Part 3: the recording goes to OpenAI only through the one AI door,
  // which refuses when the org has AI turned off.
  try { await requireAi(req.user.orgId, "openai"); }
  catch (e) { if (e instanceof AiOffError) return res.status(403).json({ error: AI_OFF_MESSAGE, code: "ai_off" }); throw e; }
  try {
    const audioBuffer = Buffer.from(audioBase64, "base64");
    const ext = (mimeType || "").includes("mp4") ? "mp4" : (mimeType || "").includes("wav") ? "wav" : "webm";
    const whisperResp = await transcribeAudio(req.user.orgId, { audioBuffer, mimeType, ext });
    if (!whisperResp.ok) {
      const errText = await whisperResp.text();
      console.error("[voice-memo] Whisper error:", whisperResp.status, errText);
      return res.status(502).json({ error: "Transcription failed, please try again." });
    }
    const whisperJson = await whisperResp.json();
    transcript = (whisperJson.text || "").trim();
  } catch (e) {
    console.error("[voice-memo] transcription failed:", e.message);
    return res.status(502).json({ error: "Transcription failed: " + e.message });
  }

  if (!transcript) return res.json({ transcript: "", suggestedDetail: null, suggestedAction: null });

  // Single narrow extraction pass — not a general chatbot, one specific job.
  let suggestedDetail = null, suggestedAction = null;
  try {
    const client = anthropicFor(req.user.orgId);
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 200,
      thinking: { type: "disabled" },   // FIX-28: a short extraction needs no thinking (the ASK-3 rule)
      system: `Extract from a voice memo a nonprofit development officer just recorded about a donor. Return ONLY valid JSON: {"personalDetail":"..." or null,"suggestedAction":"..." or null}, no markdown, no explanation. personalDetail: one short, specific, worth-remembering fact about the donor (family, interests, preferences, life event) mentioned in the memo, null if nothing like that was mentioned. suggestedAction: one short, concrete next step implied by the memo (e.g. "Send the gala invite", "Follow up after their trip in March"), null if none is implied.`,
      messages: [{ role: "user", content: `Donor: ${donorRows[0].name}\nTranscript: ${transcript}` }],
    });
    // FIX-28: an unfinished reply suggests nothing.
    const text = msg.stop_reason && msg.stop_reason !== "end_turn" ? ""
      : (msg.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      suggestedDetail = parsed.personalDetail || null;
      suggestedAction = parsed.suggestedAction || null;
    }
  } catch (e) {
    console.error("[voice-memo] extraction failed (non-fatal, transcript still returned):", e.message);
  }

  res.json({ transcript, suggestedDetail, suggestedAction });
}));

app.post("/voice-memos/save", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { donorId, transcript, addDetailToNotes, detailText, createFollowUpTask, actionText } = req.body;
  if (!donorId || !transcript) return res.status(400).json({ error: "donorId and transcript required" });
  const donorRows = await query("SELECT * FROM donors WHERE id=? AND org_id=?", [donorId, req.user.orgId]);
  if (!donorRows.length) return res.status(404).json({ error: "Donor not found" });
  const donor = donorRows[0];

  const today = orgToday(await orgTz(req.user.orgId));   // ORG_TZ_SEAM_OK (FIX-14 Part 2b)
  await run(
    "INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by) VALUES (?,?,?,?,?,?,?)",
    [newId("i"), req.user.orgId, donorId, "voice_memo", transcript, today, req.user.userId]
  );

  // Both of these are opt-in — the officer explicitly confirmed each one
  // client-side before this request was sent. Nothing AI-inferred is saved
  // to the donor record without that confirmation.
  if (addDetailToNotes && detailText && detailText.trim()) {
    const updatedNotes = donor.notes ? `${donor.notes}\n\n${detailText.trim()}` : detailText.trim();
    await run("UPDATE donors SET notes=? WHERE id=? AND org_id=?", [updatedNotes, donorId, req.user.orgId]);
  }

  let taskId = null;
  if (createFollowUpTask && actionText && actionText.trim()) {
    taskId = newId("t");
    const due = new Date(); due.setDate(due.getDate() + 7);
    await run(
      "INSERT INTO tasks (id,org_id,title,due,priority,type,done,donor_id,created_by,created_by_name) VALUES (?,?,?,?,?,?,0,?,?,?)",
      [taskId, req.user.orgId, actionText.trim(), due.toISOString().slice(0, 10), "medium", "donor", donorId, actor(req).id, actor(req).name]
    );
  }

  res.json({ success: true, taskId });
}));
}

module.exports = { routers, mount };
