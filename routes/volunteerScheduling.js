// routes/volunteerScheduling.js — VOL-1. THE THINGS A COORDINATOR DOES EVERY WEEK.
//
// Steward already knew who volunteered and how many hours they had given
// (BUILD-98, FIX-1). What it could not do is the job: put a shift on a page,
// let people sign up for it, tell them when it is, know who turned up, and
// keep a waiver from quietly lapsing. That is this file.
//
// ── THE FOUR NOUNS, AND WHY THEY ARE FOUR ────────────────────────────────
//   OPPORTUNITY  a standing thing to do        "Saturday harbour clean-up"
//   SLOT         one dated occurrence of it    "Sat 4 Oct, 9am to 1pm, 8 places"
//   SIGN-UP      one person on one slot        confirmed | waitlisted | cancelled
//   SHIFT        hours that were WORKED        the BUILD-98 volunteer_shifts row
// A slot becomes a shift at CHECK-OUT and never before. A sign-up nobody
// attended is not hours anybody gave, and a tool that counts it as hours is a
// tool whose grant report is a lie.
//
// ── WHAT THIS FILE REFUSES ───────────────────────────────────────────────
//   · Capacity is decided inside a TRANSACTION with the count re-read under a
//     lock, never by an if-statement over a number a page read a minute ago.
//     The failure mode of every volunteer tool is twelve confirmations for
//     eight places and four people finding out at the door.
//   · A public page never reveals who else signed up. A volunteer list is a
//     list of names, addresses and availability, and it is not public because
//     the shift is.
//   · NOTHING IS SENT that the org did not turn on. Shift reminders are OFF
//     by default per org, and the demo org never sends at all.
//   · An hour milestone writes a DRAFT for the coordinator. It does not thank
//     anybody. The line that is never crossed.
const SL = require("../surveyLinks");   // SURVEY-1: the volunteer follow-up link
const express = require("express");
const routers = { r0: express.Router() };

function mount(ctx) {
const {
  actor, checkWriteAccess, crypto, donateLimiter, escapeHtml, insertShift, markVolunteer, requireAdmin,
  orgToday, orgTz, publicAppUrl, query, requireAuth, resolveOrgBrandTheme, run, uuid,
  volunteerSummary, withTransaction, queryTx, runTx, wrap, maybeStartJourneyFromServer, orgMaySendEmail, donorMailDecision, resend,
  displayNameCase, donorFacingOrgName, supporterSession,
} = ctx;

let app = routers.r0;

// The pure half. Loaded the same way every other ESM module in this codebase
// is: a promise set at boot, awaited before the first read.
let VS = null;
const VS_READY = import("../shared/volunteerShifts.js").then(m => { VS = m; return m; });
// EVENTS-1 — the public shell moved to shared/publicPage.js so the event
// registration page wears the SAME brand band, cards and 16px inputs. One
// renderer, two surfaces; `footer` is the only thing that differs.
let PP = null;
const PP_READY = import("../shared/publicPage.js").then(m => { PP = m; return m; });
const publicPage = opts => PP.publicPage({ footer: "Volunteer scheduling by Steward.", ...opts });
// Every route that renders a public page awaits THIS, not VS_READY alone: the
// shell arrives by dynamic import like the shape module does, and a request
// landing between boot and its resolution would read `PP` as null.
const READY = Promise.all([VS_READY, PP_READY]);

const slug = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "shift";
const SYS_PUBLIC = { id: "system:volunteer-public", name: "The volunteer, from the sign-up page" };
const SYS_KIOSK = { id: "system:volunteer-kiosk", name: "The kiosk at the door" };

// ── THE ORG'S BRAND, ON A PUBLIC PAGE ────────────────────────────────────
// The same resolver the receipt, the portal and every donor-facing artifact
// read (resolveOrgBrandTheme), so a volunteer page cannot be the one surface
// carrying a different colour from everything else the org sends.
async function brandOf(orgId) {
  const t = await resolveOrgBrandTheme(orgId).catch(() => null);
  return t || { band: "#0d5c3a", bandFg: "#ffffff", displayName: "", logoDataUri: null, logoAbsUrl: null };
}

// One shell for every public volunteer page. Mobile first, because a
// volunteer reads this on a phone in a car park: one column, 16px gutters,
// nothing that needs a pointer, and tap targets at 44px.
const dayWords = iso => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return String(iso || "");
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
    .toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
};

// ── READING A SLOT'S STATE ───────────────────────────────────────────────
// One query, one shape, read by the public page, the coordinator's hub and
// the sign-up route, so none of them can disagree about whether a slot is
// full. `FOR UPDATE` is only taken by the sign-up path, inside its
// transaction; a read here is a read.
const SLOT_COUNTS = `
  (SELECT COUNT(*) FROM volunteer_signups su WHERE su.slot_id = s.id AND su.status = 'confirmed')::int AS confirmed,
  (SELECT COUNT(*) FROM volunteer_signups su WHERE su.slot_id = s.id AND su.status = 'waitlisted')::int AS waitlisted`;

function shapeSlot(r) {
  const st = VS.slotState({ capacity: r.capacity, confirmed: r.confirmed, waitlisted: r.waitlisted });
  return {
    id: r.id, opportunityId: r.opportunity_id, date: r.date,
    startTime: r.start_time, endTime: r.end_time,
    when: `${dayWords(r.date)}, ${VS.timeRangeWords(r.start_time, r.end_time)}`,
    hours: VS.slotHundredths({ startTime: r.start_time, endTime: r.end_time }) / 100,
    notes: r.notes || null, cancelled: !!r.cancelled_at,
    ...st,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  THE COORDINATOR'S ROUTES
// ═══════════════════════════════════════════════════════════════════════════

app.get("/volunteer-hub/opportunities", requireAuth, wrap(async (req, res) => {
  await READY;
  const orgId = req.user.orgId;
  const today = orgToday(await orgTz(orgId));                      // ORG_TZ_SEAM_OK
  const opps = await query(
    `SELECT * FROM volunteer_opportunities WHERE org_id=? AND archived_at IS NULL ORDER BY name`, [orgId]);
  const slots = await query(
    `SELECT s.*, ${SLOT_COUNTS} FROM volunteer_slots s
      WHERE s.org_id=? AND s.cancelled_at IS NULL AND s.date >= ?
      ORDER BY s.date, s.start_time`, [orgId, today]);
  const byOpp = new Map();
  for (const s of slots) {
    if (!byOpp.has(s.opportunity_id)) byOpp.set(s.opportunity_id, []);
    byOpp.get(s.opportunity_id).push(shapeSlot(s));
  }
  res.json({
    opportunities: opps.map(o => ({
      id: o.id, name: o.name, slug: o.slug, description: o.description, location: o.location,
      program: o.program, isPublic: o.is_public !== false,
      requiresWaiver: !!o.requires_waiver, requiresBackgroundCheck: !!o.requires_background_check,
      publicUrl: `${publicAppUrl()}/volunteer/${o.slug}`,
      slots: byOpp.get(o.id) || [],
    })),
    today,
    sentence: opps.length
      ? `${opps.length} ${opps.length === 1 ? "opportunity" : "opportunities"}, with every upcoming shift and how full it is.`
      : "No opportunities yet. An opportunity is a standing thing to do; a shift is one dated occurrence of it with a capacity.",
  });
}));

app.post("/volunteer-hub/opportunities", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  await READY;
  const v = VS.validateOpportunity(req.body || {});
  if (!v.ok) return res.status(400).json({ error: "invalid", errors: v.errors, message: v.errors[0].message });
  const who = actor(req), id = "vo_" + uuid().slice(0, 10);
  // The slug is what the public URL reads. A collision gets a suffix rather
  // than a refusal: two "Saturday clean-up" opportunities is a real thing an
  // org does, and making somebody rename one is making them do paperwork.
  let s = slug(v.opportunity.name);
  for (let n = 2; n < 60; n++) {
    const [clash] = await query("SELECT id FROM volunteer_opportunities WHERE org_id=? AND slug=?", [req.user.orgId, s]);
    if (!clash) break;
    s = slug(v.opportunity.name) + "-" + n;
  }
  await run(
    `INSERT INTO volunteer_opportunities (id,org_id,name,slug,description,location,program,is_public,requires_waiver,requires_background_check,created_by,created_by_name)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, req.user.orgId, v.opportunity.name, s, v.opportunity.description, v.opportunity.location,
     v.opportunity.program, v.opportunity.isPublic, v.opportunity.requiresWaiver,
     v.opportunity.requiresBackgroundCheck, who.id, who.name]);
  res.status(201).json({ id, slug: s, publicUrl: `${publicAppUrl()}/volunteer/${s}` });
}));

app.patch("/volunteer-hub/opportunities/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  await READY;
  const [cur] = await query("SELECT * FROM volunteer_opportunities WHERE id=? AND org_id=? AND archived_at IS NULL",
    [req.params.id, req.user.orgId]);
  if (!cur) return res.status(404).json({ error: "Not found" });
  const b = req.body || {};
  const v = VS.validateOpportunity({
    name: b.name !== undefined ? b.name : cur.name,
    description: b.description !== undefined ? b.description : cur.description,
    location: b.location !== undefined ? b.location : cur.location,
    program: b.program !== undefined ? b.program : cur.program,
    isPublic: b.isPublic !== undefined ? b.isPublic : cur.is_public,
    requiresWaiver: b.requiresWaiver !== undefined ? b.requiresWaiver : cur.requires_waiver,
    requiresBackgroundCheck: b.requiresBackgroundCheck !== undefined ? b.requiresBackgroundCheck : cur.requires_background_check,
  });
  if (!v.ok) return res.status(400).json({ error: "invalid", errors: v.errors, message: v.errors[0].message });
  await run(
    `UPDATE volunteer_opportunities SET name=?, description=?, location=?, program=?, is_public=?,
            requires_waiver=?, requires_background_check=?, updated_at=NOW() WHERE id=? AND org_id=?`,
    [v.opportunity.name, v.opportunity.description, v.opportunity.location, v.opportunity.program,
     v.opportunity.isPublic, v.opportunity.requiresWaiver, v.opportunity.requiresBackgroundCheck,
     req.params.id, req.user.orgId]);
  res.json({ ok: true });
}));

app.post("/volunteer-hub/opportunities/:id/archive", requireAuth, wrap(async (req, res) => {
  const { changes } = await run(
    "UPDATE volunteer_opportunities SET archived_at=NOW() WHERE id=? AND org_id=? AND archived_at IS NULL",
    [req.params.id, req.user.orgId]);
  if (!changes) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true, message: "Archived. Its shifts stay on the record and the hours already logged are untouched." });
}));

app.post("/volunteer-hub/slots", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  await READY;
  const [opp] = await query("SELECT id FROM volunteer_opportunities WHERE id=? AND org_id=? AND archived_at IS NULL",
    [String(req.body?.opportunityId || ""), req.user.orgId]);
  if (!opp) return res.status(404).json({ error: "Not found", message: "That opportunity does not exist." });
  const v = VS.validateSlot(req.body || {});
  if (!v.ok) return res.status(400).json({ error: "invalid", errors: v.errors, message: v.errors[0].message });
  const who = actor(req), id = "vsl_" + uuid().slice(0, 10);
  await run(
    `INSERT INTO volunteer_slots (id,org_id,opportunity_id,date,start_time,end_time,capacity,notes,created_by,created_by_name)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, req.user.orgId, opp.id, v.slot.date, v.slot.startTime, v.slot.endTime, v.slot.capacity, v.slot.notes, who.id, who.name]);
  res.status(201).json({ id, hours: v.slot.hundredths / 100 });
}));

// Cancelling a slot cancels its sign-ups. It does NOT mail anybody: an org
// that has reminders off has said it does not want Steward writing to its
// volunteers, and a cancellation is not the exception that overrules that.
// The coordinator is told how many people to tell.
app.post("/volunteer-hub/slots/:id/cancel", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [slot] = await query("SELECT * FROM volunteer_slots WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!slot) return res.status(404).json({ error: "Not found" });
  const affected = await query(
    `UPDATE volunteer_signups SET status='cancelled', cancelled_at=NOW(), updated_at=NOW()
      WHERE slot_id=? AND org_id=? AND status IN ('confirmed','waitlisted') RETURNING person_id`, [slot.id, orgId]);
  await run("UPDATE volunteer_slots SET cancelled_at=NOW() WHERE id=? AND org_id=?", [slot.id, orgId]);
  res.json({ ok: true, told: 0, affected: affected.length,
    message: affected.length
      ? `Shift cancelled. ${affected.length} ${affected.length === 1 ? "person was" : "people were"} signed up. `
        + `Steward has not written to them: telling them is yours, so the words are yours.`
      : "Shift cancelled. Nobody was signed up." });
}));

// Who is on one slot. Staff only, and the reason it is staff only is that
// this is names and email addresses.
app.get("/volunteer-hub/slots/:id/signups", requireAuth, wrap(async (req, res) => {
  await READY;
  const orgId = req.user.orgId;
  const [slot] = await query(`SELECT s.*, ${SLOT_COUNTS}, o.name AS opp_name, o.requires_waiver, o.requires_background_check
                                FROM volunteer_slots s JOIN volunteer_opportunities o ON o.id=s.opportunity_id
                               WHERE s.id=? AND s.org_id=?`, [req.params.id, orgId]);
  if (!slot) return res.status(404).json({ error: "Not found" });
  const today = orgToday(await orgTz(orgId));                      // ORG_TZ_SEAM_OK
  const rows = await query(
    `SELECT su.*, d.name, d.email, g.name AS group_name
       FROM volunteer_signups su
       JOIN donors d ON d.id=su.person_id AND d.org_id=su.org_id
       LEFT JOIN volunteer_groups g ON g.id=su.group_id
      WHERE su.slot_id=? AND su.org_id=? AND su.status <> 'cancelled'
      ORDER BY (su.status='waitlisted'), su.position NULLS FIRST, su.created_at`, [req.params.id, orgId]);
  // The credential state of everyone on this shift, if the opportunity needs
  // one. Read here rather than on the roster because THIS is where it
  // matters: the coordinator is looking at who is coming on Saturday.
  const creds = await credentialsFor(orgId, rows.map(r => r.person_id), today);
  res.json({
    slot: { ...shapeSlot(slot), opportunityName: slot.opp_name,
            requiresWaiver: !!slot.requires_waiver, requiresBackgroundCheck: !!slot.requires_background_check },
    people: rows.map(r => ({
      signupId: r.id, personId: r.person_id, name: r.name, email: r.email || null,
      status: r.status, groupName: r.group_name || null, source: r.source,
      checkedInAt: r.checked_in_at, checkedOutAt: r.checked_out_at,
      hoursShiftId: r.hours_shift_id || null,
      waiver: (creds.get(r.person_id) || {}).waiver || null,
      backgroundCheck: (creds.get(r.person_id) || {}).background_check || null,
    })),
    definitions: {
      confirmed: "People with a place on this shift.",
      waitlisted: "People who signed up after it filled, in the order they signed up. The first of them takes the next place that frees.",
      hours: "Hours are written when somebody is checked OUT, not when they sign up.",
    },
  });
}));

// The credential state for a set of people, on the org's today. One query.
async function credentialsFor(orgId, personIds, today) {
  const out = new Map();
  const ids = [...new Set((personIds || []).filter(Boolean))];
  if (!ids.length) return out;
  const rows = await query(
    `SELECT DISTINCT ON (person_id, kind) person_id, kind, signed_on, expires_on, reference
       FROM volunteer_credentials
      WHERE org_id=? AND person_id = ANY(?) AND superseded_at IS NULL
      ORDER BY person_id, kind, signed_on DESC`, [orgId, ids]);
  for (const id of ids) out.set(id, {});
  for (const r of rows) {
    const state = VS.credentialState(
      { kind: r.kind, signedOn: r.signed_on, expiresOn: r.expires_on }, today);
    out.get(r.person_id)[r.kind] = { ...state, signedOn: r.signed_on, expiresOn: r.expires_on, reference: r.reference || null };
  }
  return out;
}

// ── CREDENTIALS ──────────────────────────────────────────────────────────

app.get("/volunteer-hub/credentials", requireAuth, wrap(async (req, res) => {
  await READY;
  const orgId = req.user.orgId;
  const today = orgToday(await orgTz(orgId));                      // ORG_TZ_SEAM_OK
  const rows = await query(
    `SELECT DISTINCT ON (c.person_id, c.kind) c.person_id, c.kind, c.signed_on, c.expires_on, c.reference, d.name
       FROM volunteer_credentials c JOIN donors d ON d.id=c.person_id AND d.org_id=c.org_id
      WHERE c.org_id=? AND c.superseded_at IS NULL AND d.deleted_at IS NULL
      ORDER BY c.person_id, c.kind, c.signed_on DESC`, [orgId]);
  const items = rows.map(r => {
    const state = VS.credentialState({ kind: r.kind, signedOn: r.signed_on, expiresOn: r.expires_on }, today);
    return { personId: r.person_id, name: r.name, kind: r.kind,
             signedOn: r.signed_on, expiresOn: r.expires_on, reference: r.reference || null, ...state };
  });
  const needsYou = items.filter(i => i.status === "lapsed" || i.status === "expiring");
  res.json({
    credentials: items, today,
    needsYou: needsYou.map(i => ({ ...i,
      nextStep: VS.credentialNextStep({ personName: i.name, kind: i.kind, state: i }) })),
    sentence: needsYou.length
      ? `${needsYou.length} ${needsYou.length === 1 ? "credential needs" : "credentials need"} you: lapsed, or expiring within ${VS.EXPIRING_SOON_DAYS} days.`
      : "Every waiver and background check on file is current.",
    definitions: {
      lapsed: "The expiry date has passed. Brass, not red: nobody did anything wrong, somebody has to book the next one.",
      expiring: `The expiry date is within ${VS.EXPIRING_SOON_DAYS} days. A background check takes two to three weeks to come back, which is why the warning is thirty days and not seven.`,
    },
  });
}));

app.post("/volunteer-hub/credentials", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  await READY;
  const orgId = req.user.orgId;
  const today = orgToday(await orgTz(orgId));                      // ORG_TZ_SEAM_OK
  const [p] = await query("SELECT id, name FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL",
    [String(req.body?.personId || ""), orgId]);
  if (!p) return res.status(404).json({ error: "Not found", message: "That person is not on file." });
  const v = VS.validateCredential(req.body || {}, today);
  if (!v.ok) return res.status(400).json({ error: "invalid", errors: v.errors, message: v.errors[0].message });
  const who = actor(req);
  // A NEW ONE SUPERSEDES THE OLD, it does not delete it. When a background
  // check was last done is a fact about the organisation's diligence, and a
  // renewal is not a reason to lose the previous date.
  await run(`UPDATE volunteer_credentials SET superseded_at=NOW()
              WHERE org_id=? AND person_id=? AND kind=? AND superseded_at IS NULL`, [orgId, p.id, v.credential.kind]);
  const id = "vc_" + uuid().slice(0, 12);
  await run(
    `INSERT INTO volunteer_credentials (id,org_id,person_id,kind,signed_on,expires_on,reference,created_by,created_by_name)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [id, orgId, p.id, v.credential.kind, v.credential.signedOn, v.credential.expiresOn, v.credential.reference, who.id, who.name]);
  await markVolunteer(orgId, p.id);
  res.status(201).json({ id, ...VS.credentialState({ ...v.credential }, today) });
}));

// ── GROUPS ───────────────────────────────────────────────────────────────

app.get("/volunteer-hub/groups", requireAuth, wrap(async (req, res) => {
  await READY;
  const rows = await query(
    `SELECT g.*, (SELECT COUNT(DISTINCT person_id) FROM volunteer_signups su
                   WHERE su.group_id=g.id AND su.status <> 'cancelled')::int AS people
       FROM volunteer_groups g WHERE g.org_id=? ORDER BY g.name`, [req.user.orgId]);
  res.json({ groups: rows.map(g => ({ id: g.id, name: g.name, kind: g.kind, people: g.people })),
    kinds: VS.GROUP_KINDS,
    sentence: "A group is a label on a set of sign-ups. Every member is still their own record with their own hours." });
}));

// ── FIX-9 Part B · A GROUP YOU CAN OPEN ────────────────────────────────────
// "Groups on file" was a list of names and a count you could not press. A
// group is how a church, a company or a family arrives, and the coordinator's
// questions about one are: who is in it, what have they given in hours, when
// did they last come, do any of them also give, and what have they signed up
// for. All of that is one read.
//
// EVERY MEMBER IS STILL THEIR OWN RECORD. The group is a label on sign-ups,
// never a second kind of person, so the hours below are each member's own and
// the group's total is their sum rather than a figure kept beside them.
app.get("/volunteer-hub/groups/:id", requireAuth, wrap(async (req, res) => {
  await READY;
  const orgId = req.user.orgId;
  const [g] = await query("SELECT * FROM volunteer_groups WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!g) return res.status(404).json({ error: "Not found" });

  const coordinator = req.user.role === "volunteer_coordinator";
  const members = await query(
    `SELECT d.id, d.name, d.email, d.total_giving,
            COALESCE((SELECT SUM(vs.hours) FROM volunteer_shifts vs
                       WHERE vs.org_id=d.org_id AND vs.person_id=d.id
                         AND vs.date >= date_trunc('year', CURRENT_DATE)::text),0)::float AS hours_this_year,
            (SELECT MAX(vs.date)::text FROM volunteer_shifts vs
               WHERE vs.org_id=d.org_id AND vs.person_id=d.id) AS last_shift
       FROM donors d
      WHERE d.org_id=? AND d.deleted_at IS NULL AND d.id IN (
        SELECT m.person_id FROM volunteer_group_members m WHERE m.org_id=? AND m.group_id=?
        UNION
        SELECT su.person_id FROM volunteer_signups su
         WHERE su.org_id=? AND su.group_id=? AND su.status <> 'cancelled')
      ORDER BY d.name`, [orgId, orgId, g.id, orgId, g.id]);

  const shifts = await query(
    `SELECT DISTINCT s.id, s.date::text AS date, o.name AS opportunity, o.location,
            (SELECT COUNT(*)::int FROM volunteer_signups x
              WHERE x.slot_id=s.id AND x.group_id=? AND x.status <> 'cancelled') AS from_group
       FROM volunteer_signups su
       JOIN volunteer_slots s ON s.id = su.slot_id
       JOIN volunteer_opportunities o ON o.id = s.opportunity_id
      WHERE su.org_id=? AND su.group_id=? AND su.status <> 'cancelled'
      ORDER BY s.date DESC LIMIT 60`, [g.id, orgId, g.id]);

  // The lead is a PERSON on file, never a name typed twice.
  const [lead] = g.contact_person_id
    ? await query("SELECT id, name, email FROM donors WHERE id=? AND org_id=?", [g.contact_person_id, orgId])
    : [];
  const totalHours = members.reduce((t, m) => t + (Number(m.hours_this_year) || 0), 0);
  res.json({
    id: g.id, name: g.name, kind: g.kind,
    lead: lead ? { id: lead.id, name: lead.name, email: lead.email || null } : null,
    members: members.map(m => ({
      id: m.id, name: m.name, email: m.email || null,
      hoursThisYear: Math.round((Number(m.hours_this_year) || 0) * 100) / 100,
      lastShift: m.last_shift || null,
      // The "gives" mark is a YES or NOTHING, never an amount: this is the
      // volunteer side, and a coordinator does not get giving figures at all.
      gives: coordinator ? null : Number(m.total_giving) > 0,
    })),
    shifts: shifts.map(x => ({ id: x.id, date: x.date, opportunity: x.opportunity,
      location: x.location || null, fromGroup: Number(x.from_group) || 0 })),
    totalHoursThisYear: Math.round(totalHours * 100) / 100,
    sentence: `${members.length} ${members.length === 1 ? "person" : "people"} in ${g.name}`
      + `, ${Math.round(totalHours * 100) / 100} hours between them this year.`,
    definition: "Everybody signed up under this group's name. Each one is their own record with their own hours; the group is a label on their sign-ups, never a second kind of person.",
  });
}));

// FIX-9 Part B.4 — the group's members as a file, through the ONE csv writer.
app.get("/volunteer-hub/groups/:id/csv", requireAuth, wrap(async (req, res) => {
  await READY;
  const orgId = req.user.orgId;
  const [g] = await query("SELECT id, name FROM volunteer_groups WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!g) return res.status(404).json({ error: "Not found" });
  const rows = await query(
    `SELECT d.name, d.email,
            COALESCE((SELECT SUM(vs.hours) FROM volunteer_shifts vs
                       WHERE vs.org_id=d.org_id AND vs.person_id=d.id
                         AND vs.date >= date_trunc('year', CURRENT_DATE)::text),0)::float AS hours,
            (SELECT MAX(vs.date)::text FROM volunteer_shifts vs
               WHERE vs.org_id=d.org_id AND vs.person_id=d.id) AS last_shift
       FROM donors d
      WHERE d.org_id=? AND d.deleted_at IS NULL AND d.id IN (
        SELECT m.person_id FROM volunteer_group_members m WHERE m.org_id=? AND m.group_id=?
        UNION
        SELECT su.person_id FROM volunteer_signups su
         WHERE su.org_id=? AND su.group_id=? AND su.status <> 'cancelled')
      ORDER BY d.name`, [orgId, orgId, g.id, orgId, g.id]);
  const { reportHooks } = require("./crm");
  reportHooks.sendCsv(res, `${String(g.name).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-members.csv`,
    ["Name", "Email", "Hours this year", "Last shift"],
    rows.map(r => [r.name, r.email || "", r.hours, r.last_shift || ""]));
}));

// FIX-9 Part B.2 — ADD PEOPLE TO A GROUP, and take them out again. Adding
// somebody who is already on file uses THAT record (one person, one record);
// a name nobody has seen becomes a volunteer, never a donor, because they have
// not given a penny. Removing takes them off the group's sign-ups and leaves
// every hour they logged exactly where it is.
app.post("/volunteer-hub/groups/:id/members", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  await READY;
  const orgId = req.user.orgId, who = actor(req);
  const [g] = await query("SELECT id, name FROM volunteer_groups WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!g) return res.status(404).json({ error: "Not found" });
  const remove = req.body?.remove === true;
  let personId = req.body?.personId ? String(req.body.personId) : null;

  if (personId) {
    const [p] = await query("SELECT id FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [personId, orgId]);
    if (!p) return res.status(404).json({ error: "Not found", message: "That person is not in this organisation." });
  }

  if (remove) {
    if (!personId) return res.status(400).json({ error: "person_required" });
    // Membership goes; the shifts they worked WITH the group keep their label,
    // because that is a fact about those shifts and not about the list.
    const r = await run(`DELETE FROM volunteer_group_members WHERE org_id=? AND group_id=? AND person_id=?`,
      [orgId, g.id, personId]);
    return res.json({ ok: true, removed: (r && r.changes) || 0,
      sentence: `Taken out of ${g.name}. Every hour they logged is still on their record, and so is every shift.`,
      undo: { personId, groupId: g.id } });
  }

  if (!personId) {
    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!name && !email) return res.status(400).json({ error: "name_or_email_required" });
    if (email) {
      const hit = await query(
        `SELECT id FROM donors WHERE org_id=? AND LOWER(email)=? AND deleted_at IS NULL ORDER BY created_at LIMIT 2`,
        [orgId, email]);
      if (hit.length === 1) personId = hit[0].id;
    }
    if (!personId) {
      personId = "d_" + uuid().slice(0, 10);
      await run(
        `INSERT INTO donors (id,org_id,name,email,stage,status,tags,person_types,created_by,created_by_name)
         VALUES (?,?,?,?,'prospect','active','[]','["volunteer"]'::jsonb,?,?)`,
        [personId, orgId, name || email, email || null, who.id, who.name]);
    }
  }
  // A member with no shift yet is still a member. Asked once: adding somebody
  // twice is not an error, it is the same membership.
  await run(
    `INSERT INTO volunteer_group_members (id,org_id,group_id,person_id,created_by,created_by_name)
     VALUES (?,?,?,?,?,?) ON CONFLICT (org_id, group_id, person_id) DO NOTHING`,
    ["vgm_" + uuid().slice(0, 10), orgId, g.id, personId, who.id, who.name]);
  res.json({ ok: true, personId, sentence: `Added to ${g.name}. They keep their own record and their own hours.` });
}));

// A group signs up together: one action, many people, each of them their own
// record. Anybody whose email is already on file joins on THAT record — one
// person, one record — and the rest are created as volunteers.
app.post("/volunteer-hub/groups/signup", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  await READY;
  const orgId = req.user.orgId, who = actor(req);
  const [slot] = await query("SELECT * FROM volunteer_slots WHERE id=? AND org_id=? AND cancelled_at IS NULL",
    [String(req.body?.slotId || ""), orgId]);
  if (!slot) return res.status(404).json({ error: "Not found", message: "That shift does not exist." });
  const people = Array.isArray(req.body?.people) ? req.body.people.slice(0, 200) : [];
  if (!people.length) return res.status(400).json({ error: "no_people", message: "Name who is coming." });
  const groupName = String(req.body?.groupName || "").trim().slice(0, 160);
  if (!groupName) return res.status(400).json({ error: "no_group", message: "What is the group called?" });
  const kind = VS.GROUP_KEYS.includes(req.body?.kind) ? req.body.kind : "other";

  let [group] = await query("SELECT id FROM volunteer_groups WHERE org_id=? AND lower(name)=lower(?)", [orgId, groupName]);
  if (!group) {
    const gid = "vg_" + uuid().slice(0, 10);
    await run(`INSERT INTO volunteer_groups (id,org_id,name,kind,created_by,created_by_name) VALUES (?,?,?,?,?,?)`,
      [gid, orgId, groupName, kind, who.id, who.name]);
    group = { id: gid };
  }

  const out = { confirmed: 0, waitlisted: 0, alreadyOn: 0, created: 0, groupId: group.id, groupName };
  for (const raw of people) {
    const name = String(raw?.name || "").trim().slice(0, 200);
    const email = String(raw?.email || "").trim().toLowerCase().slice(0, 200);
    if (!name && !email) continue;
    const pid = await findOrCreatePerson(orgId, { name, email }, who, out);
    const r = await signUp(orgId, slot.id, pid, { source: "group", groupId: group.id, who });
    if (r.status === "confirmed") out.confirmed++;
    else if (r.status === "waitlisted") out.waitlisted++;
    else out.alreadyOn++;
  }
  res.status(201).json({ ...out,
    message: `${groupName}: ${out.confirmed} confirmed`
      + (out.waitlisted ? `, ${out.waitlisted} on the waiting list` : "")
      + (out.alreadyOn ? `, ${out.alreadyOn} already signed up` : "")
      + ". Each of them is their own record with their own hours." });
}));

async function findOrCreatePerson(orgId, { name, email }, who, out) {
  if (email) {
    const m = await query("SELECT id FROM donors WHERE org_id=? AND deleted_at IS NULL AND LOWER(email)=? LIMIT 2", [orgId, email]);
    if (m.length === 1) { await markVolunteer(orgId, m[0].id); return m[0].id; }
  }
  if (name) {
    const m = await query("SELECT id FROM donors WHERE org_id=? AND deleted_at IS NULL AND LOWER(name)=LOWER(?) LIMIT 2", [orgId, name]);
    if (m.length === 1) { await markVolunteer(orgId, m[0].id); return m[0].id; }
  }
  const pid = "d_" + uuid().slice(0, 10);
  await run(`INSERT INTO donors (id,org_id,name,email,stage,status,tags,person_types,created_by,created_by_name)
             VALUES (?,?,?,?,'prospect','active','[]','["volunteer"]'::jsonb,?,?)`,
    [pid, orgId, name || email, email || null, who.id, who.name]);
  if (out) out.created++;
  return pid;
}

// ═══════════════════════════════════════════════════════════════════════════
//  SIGNING UP — THE ONE PATH, AND THE ONLY PLACE CAPACITY IS DECIDED
// ═══════════════════════════════════════════════════════════════════════════
//
// Inside a transaction, with the slot row locked, the confirmed count is
// re-read and the status decided from it. Two people pressing the button in
// the same second cannot both take the last place: the second one waits for
// the lock, re-reads, and is waitlisted with the sentence that says so.
async function signUp(orgId, slotId, personId, { source, groupId = null, who, note = null }) {
  await READY;
  return withTransaction(async tx => {
    const q = (sql, params) => queryTx(tx, sql, params);
    // THE SLOT ROW IS LOCKED FIRST. Everything below reads the counts under
    // that lock, so two people pressing the button in the same second cannot
    // both take the last place: the second waits, re-reads, and is
    // waitlisted with the sentence that says so.
    const [slot] = await q("SELECT * FROM volunteer_slots WHERE id=? AND org_id=? AND cancelled_at IS NULL FOR UPDATE", [slotId, orgId]);
    if (!slot) return { status: null, error: "slot_gone" };
    const [existing] = await q(
      "SELECT id, status FROM volunteer_signups WHERE org_id=? AND slot_id=? AND person_id=? AND status <> 'cancelled'",
      [orgId, slotId, personId]);
    if (existing) return { status: existing.status, already: true, signupId: existing.id };
    const [counts] = await q(
      `SELECT COUNT(*) FILTER (WHERE status='confirmed')::int AS confirmed,
              COUNT(*) FILTER (WHERE status='waitlisted')::int AS waitlisted
         FROM volunteer_signups WHERE slot_id=?`, [slotId]);
    const st = VS.slotState({ capacity: slot.capacity, confirmed: counts.confirmed, waitlisted: counts.waitlisted });
    if (st.closed) return { status: null, error: "closed" };
    const status = st.nextStatus;
    const position = status === "waitlisted" ? counts.waitlisted + 1 : null;
    const id = "vsu_" + uuid().slice(0, 12);
    await runTx(tx,
      `INSERT INTO volunteer_signups (id,org_id,slot_id,person_id,group_id,status,position,source,note,created_by,created_by_name)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [id, orgId, slotId, personId, groupId, status, position, source, note, who.id, who.name]);
    await runTx(tx, `UPDATE donors SET person_types = CASE
        WHEN person_types IS NULL THEN '["donor","volunteer"]'::jsonb
        WHEN person_types @> '["volunteer"]'::jsonb THEN person_types
        ELSE (person_types - 'other') || '["volunteer"]'::jsonb END
      WHERE id=? AND org_id=?`, [personId, orgId]);
    return { status, position, signupId: id, slot };
  });
}

// Cancelling frees a place, and the first person waiting takes it — inside
// the same transaction, so two cancellations cannot promote the same person.
async function cancelSignUp(orgId, signupId, { by }) {
  await READY;
  return withTransaction(async tx => {
    const q = (sql, params) => queryTx(tx, sql, params);
    const [su] = await q(
      `SELECT su.* FROM volunteer_signups su
        WHERE su.id=? AND su.org_id=? AND su.status <> 'cancelled' FOR UPDATE`, [signupId, orgId]);
    if (!su) return { ok: false, error: "not_found" };
    // The SLOT is locked too, so a cancellation and a sign-up on the same
    // slot serialise: the place freed here cannot be taken twice.
    await q("SELECT id FROM volunteer_slots WHERE id=? FOR UPDATE", [su.slot_id]);
    await runTx(tx, "UPDATE volunteer_signups SET status='cancelled', cancelled_at=NOW(), updated_at=NOW() WHERE id=?", [signupId]);
    if (su.status !== "confirmed") return { ok: true, promoted: null, slotId: su.slot_id };
    const waiting = await q(
      `SELECT id, status, position, created_at AS "createdAt" FROM volunteer_signups
        WHERE slot_id=? AND status='waitlisted' ORDER BY position NULLS LAST, created_at, id`, [su.slot_id]);
    const next = VS.promoteFromWaitlist(waiting);
    if (!next) return { ok: true, promoted: null, slotId: su.slot_id };
    await runTx(tx, "UPDATE volunteer_signups SET status='confirmed', position=NULL, updated_at=NOW() WHERE id=?", [next.id]);
    const [p] = await q(`SELECT d.name FROM volunteer_signups su JOIN donors d ON d.id=su.person_id WHERE su.id=?`, [next.id]);
    return { ok: true, promoted: { signupId: next.id, name: p && p.name }, slotId: su.slot_id, by };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  THE PUBLIC PAGES — on the org's brand, embeddable like a donation form
// ═══════════════════════════════════════════════════════════════════════════
//
// A GET renders and CHANGES NOTHING. The form POSTs. No account, no password,
// no session: somebody who wants to help on Saturday should not have to make
// an account to say so.

async function publicOpportunity(orgSlug, oppSlug) {
  // The slug is unique per org, and the URL carries only the opportunity's.
  // An org's public pages are found through its own domain/slug elsewhere;
  // here the opportunity slug is looked up across public opportunities only,
  // which is why is_public is in the WHERE and not checked afterwards.
  const [o] = await query(
    `SELECT vo.*, org.id AS org_id, org.name AS org_name
       FROM volunteer_opportunities vo JOIN orgs org ON org.id = vo.org_id
      WHERE vo.slug=? AND vo.archived_at IS NULL AND vo.is_public = TRUE
      ${orgSlug ? "AND org.org_slug=?" : ""}
      ORDER BY vo.created_at LIMIT 1`, orgSlug ? [oppSlug, orgSlug] : [oppSlug]);
  return o || null;
}

app.get("/volunteer/:slug", donateLimiter, wrap(async (req, res, next) => {
  await READY;
  // `/volunteer/join` and `/volunteer/log` are the FIX-1 routes and are
  // registered on another router; this must not swallow them.
  if (["join", "log", "me", "kiosk", "checkin"].includes(req.params.slug)) return next();
  const o = await publicOpportunity(null, req.params.slug);
  if (!o) return res.status(404).send(publicPage({ title: "Not found",
    brand: { band: "#0d5c3a", bandFg: "#fff", displayName: "" },
    body: `<div class="card"><h1>That page is not here.</h1><p class="muted">The link may have changed, or this opportunity has been taken down. Ask the organisation for its current link.</p></div>` }));
  const brand = await brandOf(o.org_id);
  const today = orgToday(await orgTz(o.org_id));                   // ORG_TZ_SEAM_OK
  const slots = await query(
    `SELECT s.*, ${SLOT_COUNTS} FROM volunteer_slots s
      WHERE s.opportunity_id=? AND s.cancelled_at IS NULL AND s.date >= ?
      ORDER BY s.date, s.start_time LIMIT 60`, [o.id, today]);
  res.setHeader("Cache-Control", "no-store");
  // EMBEDDABLE. The same rule the donation form follows: an org drops this on
  // its own site in an iframe, so it must not refuse to be framed.
  res.removeHeader("X-Frame-Options");
  res.setHeader("Content-Security-Policy", "frame-ancestors *");

  const cards = slots.length ? slots.map(r => {
    const s = shapeSlot(r);
    const pill = s.closed ? `<span class="pill shut">Closed</span>`
      : s.full ? `<span class="pill full">Full</span>`
      : `<span class="pill open">${s.unlimited ? "Open" : s.remaining + " left"}</span>`;
    const cta = s.closed ? "" :
      `<form method="get" action="/volunteer/${escapeHtml(o.slug)}/signup">
         <input type="hidden" name="slot" value="${escapeHtml(s.id)}">
         <button class="btn" type="submit">${s.full ? "Join the waiting list" : "Sign up"}</button>
       </form>`;
    return `<div class="card">
      <div class="row"><h2>${escapeHtml(dayWords(s.date))}</h2>${pill}</div>
      <p class="muted">${escapeHtml(VS.timeRangeWords(s.startTime, s.endTime))} · ${s.hours} hours</p>
      ${s.notes ? `<p class="small">${escapeHtml(s.notes)}</p>` : ""}
      <p class="small">${escapeHtml(s.sentence)}</p>
      ${cta}
    </div>`;
  }).join("") : `<div class="card"><p class="muted">No dates are up yet. Check back, or ask the organisation when the next one is.</p></div>`;

  const needs = [];
  if (o.requires_waiver) needs.push("a signed waiver");
  if (o.requires_background_check) needs.push("a current background check");

  res.send(publicPage({ title: `${o.name} · ${brand.displayName}`, brand, body: `
    <div class="card">
      <h1>${escapeHtml(o.name)}</h1>
      ${o.location ? `<p class="muted">${escapeHtml(o.location)}</p>` : ""}
      ${o.description ? `<p>${escapeHtml(o.description)}</p>` : ""}
      ${needs.length ? `<p class="small">This one needs ${needs.join(" and ")}. You can do that after you sign up.</p>` : ""}
    </div>
    ${cards}` }));
}));

app.get("/volunteer/:slug/signup", donateLimiter, wrap(async (req, res) => {
  await READY;
  const o = await publicOpportunity(null, req.params.slug);
  if (!o) return res.status(404).send(publicPage({ title: "Not found", brand: { band: "#0d5c3a", bandFg: "#fff", displayName: "" },
    body: `<div class="card"><h1>That page is not here.</h1></div>` }));
  const brand = await brandOf(o.org_id);
  const [r] = await query(`SELECT s.*, ${SLOT_COUNTS} FROM volunteer_slots s
                            WHERE s.id=? AND s.opportunity_id=? AND s.cancelled_at IS NULL`,
    [String(req.query.slot || ""), o.id]);
  if (!r) return res.status(404).send(publicPage({ title: "Shift not found", brand,
    body: `<div class="card"><h1>That shift is not here.</h1><p class="muted"><a href="/volunteer/${escapeHtml(o.slug)}">See the other dates</a>.</p></div>` }));
  const s = shapeSlot(r);
  res.setHeader("Cache-Control", "no-store");
  res.removeHeader("X-Frame-Options");
  res.setHeader("Content-Security-Policy", "frame-ancestors *");
  res.send(publicPage({ title: `Sign up · ${o.name}`, brand, body: `
    <div class="card">
      <h1>${escapeHtml(s.full ? "Join the waiting list" : "Sign up")}</h1>
      <p class="muted">${escapeHtml(o.name)} · ${escapeHtml(s.when)}</p>
      <p class="small">${escapeHtml(s.sentence)}</p>
      ${s.full ? `<div class="ok">This shift is full. Sign up and you go on the waiting list; if somebody drops out, the first person waiting takes the place and the organisation will be in touch.</div>` : ""}
      <form method="post" action="/volunteer/${escapeHtml(o.slug)}/signup">
        <input type="hidden" name="slot" value="${escapeHtml(s.id)}">
        <div class="hp" aria-hidden="true"><label>Leave this empty<input name="website" tabindex="-1" autocomplete="off"></label></div>
        <label for="n">Your name</label><input id="n" name="name" required maxlength="200" autocomplete="name">
        <label for="e">Email</label><input id="e" name="email" type="email" required maxlength="200" autocomplete="email">
        <label for="p">Phone (optional)</label><input id="p" name="phone" maxlength="40" autocomplete="tel">
        <label for="no">Anything we should know (optional)</label><textarea id="no" name="note" maxlength="500"></textarea>
        <button class="btn" type="submit">${s.full ? "Put me on the waiting list" : "Sign me up"}</button>
      </form>
      <p class="small" style="margin-top:14px">Your details go to ${escapeHtml(brand.displayName || "the organisation")} and nowhere else. No account, no password.</p>
    </div>` }));
}));

app.post("/volunteer/:slug/signup", donateLimiter, express.urlencoded({ extended: false }), wrap(async (req, res) => {
  await READY;
  const o = await publicOpportunity(null, req.params.slug);
  if (!o) return res.status(404).send(publicPage({ title: "Not found", brand: { band: "#0d5c3a", bandFg: "#fff", displayName: "" },
    body: `<div class="card"><h1>That page is not here.</h1></div>` }));
  const brand = await brandOf(o.org_id);
  const thanks = extra => publicPage({ title: "Thank you", brand, body: `
    <div class="card"><h1>Thank you.</h1>${extra}
    <p class="small"><a href="/volunteer/${escapeHtml(o.slug)}">See the other dates</a>.</p></div>` });
  // The honeypot: a bot is thanked and nothing is written.
  if (String(req.body?.website || "").trim()) return res.send(thanks("<p>You are signed up.</p>"));
  const name = String(req.body?.name || "").trim().slice(0, 200);
  const email = String(req.body?.email || "").trim().toLowerCase().slice(0, 200);
  const phone = String(req.body?.phone || "").trim().slice(0, 40);
  const note = String(req.body?.note || "").trim().slice(0, 500) || null;
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).send(publicPage({ title: "Check the form", brand, body:
      `<div class="card"><div class="err">Please give your name and an email address.</div>
       <p><a href="/volunteer/${escapeHtml(o.slug)}/signup?slot=${encodeURIComponent(String(req.body?.slot || ""))}">Go back</a></p></div>` }));
  }
  const [slot] = await query("SELECT id FROM volunteer_slots WHERE id=? AND opportunity_id=? AND cancelled_at IS NULL",
    [String(req.body?.slot || ""), o.id]);
  if (!slot) return res.status(404).send(publicPage({ title: "Shift not found", brand,
    body: `<div class="card"><h1>That shift is not here any more.</h1><p class="muted"><a href="/volunteer/${escapeHtml(o.slug)}">See the other dates</a>.</p></div>` }));

  const pid = await findOrCreatePerson(o.org_id, { name, email }, SYS_PUBLIC, null);
  if (phone) await run("UPDATE donors SET phone = COALESCE(NULLIF(phone,''), ?) WHERE id=? AND org_id=?", [phone, pid, o.org_id]);
  const r = await signUp(o.org_id, slot.id, pid, { source: "public", who: SYS_PUBLIC, note });
  if (r.error === "closed") {
    return res.send(publicPage({ title: "That shift is closed", brand,
      body: `<div class="card"><h1>That shift is closed.</h1><p class="muted"><a href="/volunteer/${escapeHtml(o.slug)}">See the other dates</a>.</p></div>` }));
  }
  // THREAD-2a — signing up to help is the new_volunteer trigger. After the
  // response is composed, never in front of it.
  maybeStartJourneyFromServer(o.org_id, pid, "new_volunteer", {})
    .catch(e => console.error("[journey] volunteer signup trigger:", e.message));

  const link = await issueMagicLink(o.org_id, pid);
  const body = r.already
    ? `<p>You were already ${r.status === "waitlisted" ? "on the waiting list" : "signed up"} for this one.</p>`
    : r.status === "waitlisted"
      ? `<p>You are on the waiting list. If somebody drops out, the first person waiting takes the place and ${escapeHtml(brand.displayName || "the organisation")} will be in touch.</p>`
      : `<p>You are signed up.</p>`;
  res.send(thanks(body + `<p class="small">Your shifts, in one place: <a href="${escapeHtml(link)}">open your volunteer page</a>. Keep the link; it works for thirty days.</p>`));
}));

// ═══════════════════════════════════════════════════════════════════════════
//  THE VOLUNTEER'S OWN PAGE — by magic link. Mobile first.
// ═══════════════════════════════════════════════════════════════════════════
//
// A SEPARATE family from the donor portal's magic links, on purpose: a
// volunteer is not a donor account, and a link that opens a roster must never
// open a giving history. Thirty days, because a volunteer signs up in
// September for a shift in October and should not be locked out in between.

const VOL_LINK_DAYS = 30;
const hashTok = t => crypto.createHash("sha256").update(String(t)).digest("hex");

async function issueMagicLink(orgId, personId) {
  const token = crypto.randomBytes(32).toString("base64url");
  await run(
    `INSERT INTO volunteer_magic_links (id,org_id,person_id,token_hash,expires_at)
     VALUES (?,?,?,?, NOW() + (? || ' days')::interval)`,
    ["vml_" + uuid().slice(0, 10), orgId, personId, hashTok(token), String(VOL_LINK_DAYS)]);
  return `${publicAppUrl()}/volunteer/me?t=${token}`;
}

async function readMagicLink(token) {
  if (!token) return null;
  const [r] = await query(
    `SELECT org_id, person_id FROM volunteer_magic_links
      WHERE token_hash=? AND expires_at > NOW()`, [hashTok(token)]);
  return r || null;
}

async function myPage(orgId, personId, { flash = "", error = "" } = {}) {
  const brand = await brandOf(orgId);
  const today = orgToday(await orgTz(orgId));                      // ORG_TZ_SEAM_OK
  const [p] = await query("SELECT id, name FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [personId, orgId]);
  if (!p) return null;
  const mine = await query(
    `SELECT su.id AS signup_id, su.status, su.position, su.checked_in_at, su.checked_out_at,
            s.id AS slot_id, s.date, s.start_time, s.end_time, s.capacity, s.notes,
            o.name AS opp_name, o.slug AS opp_slug, o.location, o.requires_waiver, o.requires_background_check,
            ${SLOT_COUNTS}
       FROM volunteer_signups su
       JOIN volunteer_slots s ON s.id=su.slot_id
       JOIN volunteer_opportunities o ON o.id=s.opportunity_id
      WHERE su.org_id=? AND su.person_id=? AND su.status IN ('confirmed','waitlisted') AND s.date >= ? AND s.cancelled_at IS NULL
      ORDER BY s.date, s.start_time`, [orgId, personId, today]);
  const summary = await volunteerSummary(orgId, personId);
  const creds = await credentialsFor(orgId, [personId], today);
  const mineCreds = creds.get(personId) || {};
  const needWaiver = mine.some(m => m.requires_waiver) && (!mineCreds.waiver || !mineCreds.waiver.ok);

  const shiftCards = mine.length ? mine.map(m => {
    const s = shapeSlot({ ...m, id: m.slot_id, opportunity_id: null });
    const badge = m.status === "waitlisted"
      ? `<span class="pill full">Waiting list${m.position ? ", number " + m.position : ""}</span>`
      : m.checked_out_at ? `<span class="pill open">Done</span>`
      : m.checked_in_at ? `<span class="pill open">Checked in</span>`
      : `<span class="pill open">Confirmed</span>`;
    return `<div class="card">
      <div class="row"><h2>${escapeHtml(m.opp_name)}</h2>${badge}</div>
      <p class="muted">${escapeHtml(s.when)}</p>
      ${m.location ? `<p class="small">${escapeHtml(m.location)}</p>` : ""}
      ${m.notes ? `<p class="small">${escapeHtml(m.notes)}</p>` : ""}
      <form method="post" action="/volunteer/me/cancel" style="margin-top:10px">
        <input type="hidden" name="t" value="${escapeHtml(arguments[2] && arguments[2].token || "")}">
        <input type="hidden" name="signup" value="${escapeHtml(m.signup_id)}">
        <button class="btn quiet small" type="submit">I cannot make this one</button>
      </form>
    </div>`;
  }).join("") : `<div class="card"><p class="muted">You are not signed up for anything yet.</p></div>`;

  return { brand, person: p, today, mine, summary, mineCreds, needWaiver, shiftCards };
}

app.get("/volunteer/me", donateLimiter, wrap(async (req, res) => {
  await READY;
  const token = String(req.query.t || "");
  const link = await readMagicLink(token);
  // MEMBERS-2 — the volunteer's page is a SECTION of "Your page" now. A live
  // link still works: it is exchanged for a supporter session and the person
  // lands on the one page that holds their shifts, their membership, their
  // tickets and their giving. An expired one falls through to the words
  // below, which are the words this page has always answered with.
  if (link) {
    const [o] = await query(`SELECT org_slug FROM orgs WHERE id=?`, [link.org_id]);
    if (o && o.org_slug) {
      supporterSession.setCookie(res, await supporterSession.mint(link.org_id, link.person_id));
      return res.redirect(303, `/you/${encodeURIComponent(o.org_slug)}`);
    }
  }
  if (!link) return res.status(404).send(publicPage({ title: "Link expired",
    brand: { band: "#0d5c3a", bandFg: "#fff", displayName: "" },
    body: `<div class="card"><h1>This link has expired.</h1><p class="muted">Volunteer links last ${VOL_LINK_DAYS} days. Ask the organisation for a new one.</p></div>` }));
  const page = await myPage(link.org_id, link.person_id);
  if (!page) return res.status(404).send(publicPage({ title: "Not found",
    brand: { band: "#0d5c3a", bandFg: "#fff", displayName: "" },
    body: `<div class="card"><h1>This link is no longer valid.</h1></div>` }));
  const { brand, person, mine, summary, mineCreds, needWaiver } = page;
  const first = String(person.name || "").split(/\s+/)[0];
  const T = escapeHtml(token);

  const shiftCards = mine.length ? mine.map(m => {
    const s = shapeSlot({ ...m, id: m.slot_id, opportunity_id: null });
    const badge = m.status === "waitlisted"
      ? `<span class="pill full">Waiting list${m.position ? ", number " + m.position : ""}</span>`
      : m.checked_out_at ? `<span class="pill open">Done</span>`
      : m.checked_in_at ? `<span class="pill open">Checked in</span>`
      : `<span class="pill open">Confirmed</span>`;
    return `<div class="card">
      <div class="row"><h2>${escapeHtml(m.opp_name)}</h2>${badge}</div>
      <p class="muted">${escapeHtml(s.when)}</p>
      ${m.location ? `<p class="small">${escapeHtml(m.location)}</p>` : ""}
      ${m.notes ? `<p class="small">${escapeHtml(m.notes)}</p>` : ""}
      <form method="post" action="/volunteer/me/cancel" style="margin-top:10px">
        <input type="hidden" name="t" value="${T}">
        <input type="hidden" name="signup" value="${escapeHtml(m.signup_id)}">
        <button class="btn quiet small" type="submit">I cannot make this one</button>
      </form>
    </div>`;
  }).join("") : `<div class="card"><p class="muted">You are not signed up for anything yet.</p></div>`;

  const credLines = [];
  for (const k of VS.CREDENTIAL_KEYS) {
    const c = mineCreds[k];
    if (!c) continue;
    credLines.push(`<p class="small">${escapeHtml(c.sentence)}</p>`);
  }

  res.setHeader("Cache-Control", "no-store");
  res.send(publicPage({ title: `Your shifts · ${brand.displayName}`, brand, body: `
    ${req.query.done === "1" ? `<div class="ok">Saved. Thank you.</div>` : ""}
    ${req.query.cancelled === "1" ? `<div class="ok">Taken off that shift. Thank you for telling us.</div>` : ""}
    <div class="card">
      <h1>Hello, ${escapeHtml(first)}.</h1>
      <p class="muted">${summary.totalHours ? `You have given ${summary.totalHours} hours to ${escapeHtml(brand.displayName || "us")}.` : `Thank you for volunteering with ${escapeHtml(brand.displayName || "us")}.`}</p>
      ${credLines.join("")}
    </div>
    ${needWaiver ? `<div class="card">
      <h2>One thing first</h2>
      <p class="small">One of your shifts needs a signed waiver.</p>
      <a class="btn" href="/volunteer/me/waiver?t=${T}">Sign the waiver</a>
    </div>` : ""}
    <h2 style="margin:18px 2px 10px">Your shifts</h2>
    ${shiftCards}
    <div class="card">
      <h2>Log hours</h2>
      <p class="small">If you helped and nobody checked you in, add it here.</p>
      <form method="post" action="/volunteer/me/hours">
        <input type="hidden" name="t" value="${T}">
        <label for="d">Date</label><input id="d" name="date" type="date" required>
        <label for="h">Hours</label><input id="h" name="hours" type="number" step="0.25" min="0.25" max="24" required>
        <label for="r">What you did (optional)</label><input id="r" name="role" maxlength="120">
        <button class="btn" type="submit">Log my hours</button>
      </form>
    </div>` }));
}));

app.post("/volunteer/me/cancel", donateLimiter, express.urlencoded({ extended: false }), wrap(async (req, res) => {
  const link = await readMagicLink(String(req.body?.t || ""));
  if (!link) return res.redirect(303, "/volunteer/me");
  const [su] = await query("SELECT id FROM volunteer_signups WHERE id=? AND org_id=? AND person_id=?",
    [String(req.body?.signup || ""), link.org_id, link.person_id]);
  if (su) await cancelSignUp(link.org_id, su.id, { by: "the volunteer" });
  res.redirect(303, `/volunteer/me?t=${encodeURIComponent(String(req.body.t))}&cancelled=1`);
}));

app.post("/volunteer/me/hours", donateLimiter, express.urlencoded({ extended: false }), wrap(async (req, res) => {
  await READY;
  const link = await readMagicLink(String(req.body?.t || ""));
  if (!link) return res.redirect(303, "/volunteer/me");
  const VH = await import("../shared/volunteerHours.js");
  const v = VH.validateShift(req.body || {});
  if (v.ok) {
    const before = await volunteerSummary(link.org_id, link.person_id);
    await insertShift(link.org_id, link.person_id, v.shift,
      { via: "self", who: { id: "system:volunteer-link", name: "The volunteer, from their own page" } });
    await noteMilestone(link.org_id, link.person_id, before.hundredths);
  }
  res.redirect(303, `/volunteer/me?t=${encodeURIComponent(String(req.body.t))}&done=1`);
}));

// ── THE WAIVER, SIGNED ONLINE ────────────────────────────────────────────
// Steward records WHAT they agreed to (a hash of the words), who typed their
// name, when, and from where. An org that changes its waiver text does not
// silently change what past volunteers signed.
const DEFAULT_WAIVER = `I am taking part as a volunteer of my own free will. I will follow the organisation's instructions and safety directions. I understand that volunteering may involve physical activity and I confirm I am fit to take part. I agree that the organisation may contact me about the shifts I have signed up for.`;

app.get("/volunteer/me/waiver", donateLimiter, wrap(async (req, res) => {
  const link = await readMagicLink(String(req.query.t || ""));
  if (!link) return res.status(404).send(publicPage({ title: "Link expired",
    brand: { band: "#0d5c3a", bandFg: "#fff", displayName: "" },
    body: `<div class="card"><h1>This link has expired.</h1></div>` }));
  const brand = await brandOf(link.org_id);
  const [o] = await query("SELECT volunteer_waiver_text FROM orgs WHERE id=?", [link.org_id]);
  const text = (o && o.volunteer_waiver_text) || DEFAULT_WAIVER;
  res.setHeader("Cache-Control", "no-store");
  res.send(publicPage({ title: "Waiver", brand, body: `
    <div class="card">
      <h1>Waiver</h1>
      <p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>
      <form method="post" action="/volunteer/me/waiver">
        <input type="hidden" name="t" value="${escapeHtml(String(req.query.t))}">
        <label for="sn">Type your full name to sign</label><input id="sn" name="signature" required maxlength="200" autocomplete="name">
        <button class="btn" type="submit">I agree</button>
      </form>
      <p class="small" style="margin-top:12px">Steward records your name, today's date and these exact words. Nothing else.</p>
    </div>` }));
}));

app.post("/volunteer/me/waiver", donateLimiter, express.urlencoded({ extended: false }), wrap(async (req, res) => {
  await READY;
  const link = await readMagicLink(String(req.body?.t || ""));
  if (!link) return res.redirect(303, "/volunteer/me");
  const signature = String(req.body?.signature || "").trim().slice(0, 200);
  if (!signature) return res.redirect(303, `/volunteer/me/waiver?t=${encodeURIComponent(String(req.body.t))}`);
  const [o] = await query("SELECT volunteer_waiver_text FROM orgs WHERE id=?", [link.org_id]);
  const text = (o && o.volunteer_waiver_text) || DEFAULT_WAIVER;
  const today = orgToday(await orgTz(link.org_id));                // ORG_TZ_SEAM_OK
  // A WAIVER SIGNED ONLINE EXPIRES IN A YEAR. Not a rule Steward invents out
  // of nowhere: it is the interval an org can change without losing the
  // record, and an expiry that is never set is a waiver nobody revisits.
  const expires = `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`;
  await run(`UPDATE volunteer_credentials SET superseded_at=NOW()
              WHERE org_id=? AND person_id=? AND kind='waiver' AND superseded_at IS NULL`, [link.org_id, link.person_id]);
  await run(
    `INSERT INTO volunteer_credentials (id,org_id,person_id,kind,signed_on,expires_on,signature_name,signature_ip,waiver_text_sha256,created_by,created_by_name)
     VALUES (?,?,?,'waiver',?,?,?,?,?,?,?)`,
    ["vc_" + uuid().slice(0, 12), link.org_id, link.person_id, today, expires, signature,
     String(req.ip || "").slice(0, 60), crypto.createHash("sha256").update(text).digest("hex"),
     "system:volunteer-waiver", "The volunteer, from their own page"]);
  res.redirect(303, `/volunteer/me?t=${encodeURIComponent(String(req.body.t))}&done=1`);
}));

// Send a volunteer their own link. Staff action, and the ONE mail this file
// sends without the org turning reminders on, because it is a link somebody
// asked for rather than a message Steward decided to write.
app.post("/volunteer-hub/magic-link", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [p] = await query("SELECT id, name, email FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL",
    [String(req.body?.personId || ""), orgId]);
  if (!p) return res.status(404).json({ error: "Not found" });
  const url = await issueMagicLink(orgId, p.id);
  // COPIED, NOT SENT, unless the org asks for it to be sent. The default is
  // the coordinator's clipboard: she knows how she talks to her volunteers.
  if (req.body?.send === true) {
    const decision = await orgMaySendEmail(orgId);
    if (!decision.send) {
      return res.json({ url, sent: false,
        message: `Here is the link. Steward did not email it: ${decision.reason || "this organisation has email turned off"}.` });
    }
    if (!p.email) return res.json({ url, sent: false, message: "Here is the link. There is no email address on this record." });
    // FIX-14 Part 4: the same per-person check as donor mail (deceased,
    // bounced, complained, unreachable, the block list).
    const person = await donorMailDecision("volunteer_link", p.email, orgId);
    if (!person.send) {
      return res.json({ url, sent: false,
        message: `Here is the link. Steward did not email it: ${person.reason}.` });
    }
    const brand = await brandOf(orgId);
    // FIX-15 Part 3 — HONEST "SENT". The provider answers a refusal with
    // { error } and does not throw, so this route said "Sent to x" for mail
    // the provider had turned away. It now reports what the provider said.
    const out = await resend.emails.send({
      from: process.env.DEMO_SMTP_FROM || "noreply@stewardapp.dev",
      to: p.email,
      _stewardOrgId: orgId, _stewardKind: "volunteer_link",
      subject: `Your volunteer page · ${brand.displayName}`,
      html: `<p>Here is your volunteer page. It shows the shifts you are signed up for, and you can cancel or log hours from it.</p>
             <p><a href="${url}">Open my volunteer page</a></p>
             <p style="font-size:13px;color:#5a554f">The link works for ${VOL_LINK_DAYS} days.</p>`,
    }).catch(e => ({ error: { message: e.message } }));
    if (!out || out.error) {
      const why = (out && out.error && out.error.message) || "no answer";
      console.error("[volunteer] magic link mail:", why);
      return res.json({ url, sent: false, providerError: why,
        message: `Here is the link. The email to ${p.email} did not go: the email provider said "${why}". Copy the link and send it yourself.` });
    }
    return res.json({ url, sent: true, message: `Sent to ${p.email}.` });
  }
  res.json({ url, sent: false, message: `Copy this and send it however you talk to ${p.name}. It works for ${VOL_LINK_DAYS} days.` });
}));

// ═══════════════════════════════════════════════════════════════════════════
//  CHECK-IN — a kiosk at the door, and a phone link
// ═══════════════════════════════════════════════════════════════════════════
//
// HOURS COME FROM THE CLOCK, not from what somebody remembers a week later.
// Check-in stamps the time, check-out stamps the time, and the difference
// becomes a volunteer_shifts row — the SAME table the total has always been
// summed from, so a checked-out shift and a hand-logged one are one number.
// The coordinator can edit it afterwards, because a clock is not a witness.

app.get("/volunteer-hub/kiosk/:slotId", requireAuth, wrap(async (req, res) => {
  await READY;
  const orgId = req.user.orgId;
  const [slot] = await query(
    `SELECT s.*, ${SLOT_COUNTS}, o.name AS opp_name FROM volunteer_slots s
       JOIN volunteer_opportunities o ON o.id=s.opportunity_id
      WHERE s.id=? AND s.org_id=?`, [req.params.slotId, orgId]);
  if (!slot) return res.status(404).json({ error: "Not found" });
  const rows = await query(
    `SELECT su.id, su.person_id, su.status, su.checked_in_at, su.checked_out_at, d.name
       FROM volunteer_signups su JOIN donors d ON d.id=su.person_id AND d.org_id=su.org_id
      WHERE su.slot_id=? AND su.org_id=? AND su.status IN ('confirmed','waitlisted','completed','no_show')
      ORDER BY d.name`, [req.params.slotId, orgId]);
  res.json({
    slot: { ...shapeSlot(slot), opportunityName: slot.opp_name },
    people: rows.map(r => ({ signupId: r.id, personId: r.person_id, name: r.name, status: r.status,
      checkedInAt: r.checked_in_at, checkedOutAt: r.checked_out_at })),
    sentence: "Tap a name to check somebody in, and again to check them out. Hours are the time between the two, and you can change them afterwards.",
  });
}));

app.post("/volunteer-hub/checkin", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  await READY;
  const orgId = req.user.orgId;
  const who = req.body?.kiosk === true ? SYS_KIOSK : actor(req);
  const [su] = await query(
    `SELECT su.*, s.date, s.start_time, s.end_time, o.name AS opp_name, d.name AS person_name
       FROM volunteer_signups su
       JOIN volunteer_slots s ON s.id=su.slot_id
       JOIN volunteer_opportunities o ON o.id=s.opportunity_id
       JOIN donors d ON d.id=su.person_id AND d.org_id=su.org_id
      WHERE su.id=? AND su.org_id=?`, [String(req.body?.signupId || ""), orgId]);
  if (!su) return res.status(404).json({ error: "Not found" });

  if (!su.checked_in_at) {
    await run("UPDATE volunteer_signups SET checked_in_at=NOW(), status='confirmed', updated_at=NOW() WHERE id=?", [su.id]);
    return res.json({ ok: true, state: "checked_in",
      message: `${su.person_name} is checked in. Tap again when they leave and Steward writes the hours.` });
  }
  if (su.checked_out_at) {
    return res.json({ ok: true, state: "already_out", message: `${su.person_name} is already checked out.` });
  }

  // CHECK-OUT: the hours are the clock, rounded to the nearest quarter hour.
  // Rounded rather than exact because nobody's day is 3.7166 hours, and a
  // grant report full of six-decimal figures is a report nobody trusts.
  const [now] = await query("SELECT NOW() AS t", []);
  const mins = Math.max(0, Math.round((new Date(now.t) - new Date(su.checked_in_at)) / 60000));
  const quarters = Math.max(1, Math.round(mins / 15));             // never zero: they were here
  const hundredths = Math.min(24 * 100, quarters * 25);
  const before = await volunteerSummary(orgId, su.person_id);
  // THE DATE IS THE DAY THEY WERE HERE, not the day the slot was planned for.
  // Those are the same date almost always and different in the one case that
  // matters: a shift moved, or somebody checked out of next week's slot by
  // mistake. Hours belong to the day they were given, and a grant report
  // built on planned dates is a report about a calendar, not about work.
  const workedOn = orgToday(await orgTz(orgId));                   // ORG_TZ_SEAM_OK
  const shiftId = await insertShift(orgId, su.person_id,
    { date: workedOn, hundredths, role: su.opp_name, note: null },
    { via: "staff", who });
  await run("UPDATE volunteer_signups SET checked_out_at=NOW(), status='completed', hours_shift_id=?, updated_at=NOW() WHERE id=?",
    [shiftId, su.id]);
  const milestone = await noteMilestone(orgId, su.person_id, before.hundredths);
  res.json({ ok: true, state: "checked_out", hours: hundredths / 100, shiftId, milestone,
    message: `${su.person_name} is checked out. ${hundredths / 100} hours logged, rounded to the nearest quarter hour. You can change it on the shift.` });
}));

app.post("/volunteer-hub/signups/:id/no-show", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { changes } = await run(
    "UPDATE volunteer_signups SET status='no_show', updated_at=NOW() WHERE id=? AND org_id=? AND status IN ('confirmed','waitlisted')",
    [req.params.id, req.user.orgId]);
  if (!changes) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true, message: "Marked as not having come. No hours were written, because none were given." });
}));

// Staff sign somebody up, and staff cancel. The same two functions the public
// page uses, so capacity behaves identically whichever door it came through.
app.post("/volunteer-hub/signups", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  await READY;
  const orgId = req.user.orgId, who = actor(req);
  const [slot] = await query("SELECT id FROM volunteer_slots WHERE id=? AND org_id=? AND cancelled_at IS NULL",
    [String(req.body?.slotId || ""), orgId]);
  if (!slot) return res.status(404).json({ error: "Not found", message: "That shift does not exist." });
  const personId = String(req.body?.personId || "");
  const [p] = await query("SELECT id, name FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [personId, orgId]);
  if (!p) return res.status(404).json({ error: "Not found", message: "That person is not on file." });
  const r = await signUp(orgId, slot.id, p.id, { source: "staff", who });
  if (r.error === "closed") return res.status(409).json({ error: "closed", message: "That shift is closed." });
  res.status(201).json({ ...r,
    message: r.already ? `${p.name} was already on this shift.`
      : r.status === "waitlisted" ? `${p.name} is on the waiting list, number ${r.position}. The shift is full.`
      : `${p.name} is confirmed.` });
}));

app.post("/volunteer-hub/signups/:id/cancel", requireAuth, wrap(async (req, res) => {
  const r = await cancelSignUp(req.user.orgId, req.params.id, { by: actor(req).name });
  if (!r.ok) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true, promoted: r.promoted,
    message: r.promoted
      ? `Cancelled. ${r.promoted.name} came off the waiting list into the place. Steward has not written to them: telling them is yours.`
      : "Cancelled." });
}));

// ── MILESTONES ───────────────────────────────────────────────────────────
// Crossing 25, 50 or 100 hours writes a DRAFT for the coordinator. It does
// not thank anybody: she wrote every word, she turned it on, and each send
// is hers. Fires ONCE per milestone, which the column enforces.
async function noteMilestone(orgId, personId, previousHundredths) {
  await READY;
  try {
    const after = await volunteerSummary(orgId, personId);
    const crossed = VS.milestoneCrossed(previousHundredths, after.hundredths);
    if (!crossed) return null;
    const [d] = await query("SELECT name, volunteer_milestone_hours AS done FROM donors WHERE id=? AND org_id=?", [personId, orgId]);
    if (!d || Number(d.done || 0) >= crossed) return null;
    await run("UPDATE donors SET volunteer_milestone_hours=? WHERE id=? AND org_id=?", [crossed, personId, orgId]);
    const [org] = await query("SELECT name FROM orgs WHERE id=?", [orgId]);
    const orgName = await donorFacingOrgName(orgId, (org && org.name) || "").catch(() => (org && org.name) || "");
    const today = orgToday(await orgTz(orgId));                    // ORG_TZ_SEAM_OK
    // SURVEY-1 — the optional follow-up. When the org has chosen a volunteer
    // survey (Communications, Surveys), this thank-you carries that person's
    // own link to it. It is still a draft: the coordinator reads it and sends it.
    const [vs] = await query(
      `SELECT s.id, s.slug, s.mode, o.org_slug FROM orgs o JOIN surveys s ON s.id = o.volunteer_survey_id AND s.org_id = o.id
        WHERE o.id=? AND s.status='open'`, [orgId]).catch(() => []);
    const surveyLine = vs
      ? `If you have two minutes, tell us how it has been: ${vs.mode === "named" ? SL.personalUrl(vs.org_slug, vs.slug, vs.id, personId) : SL.publicUrl(vs.org_slug, vs.slug)}\n\n`
      : "";
    const body = `Dear ${String(d.name || "").split(/\s+/)[0]},\n\n`
      + `You have now given ${crossed} hours to ${orgName}.\n\n`
      + `That is a lot of Saturdays, and we notice. Thank you.\n\n`
      + surveyLine
      + `With thanks,\n${orgName}`;
    // INTO `milestone_drafts`, which is the table the review queue already
    // reads — not a second drafts table nobody opens. `milestone_key` makes
    // it idempotent by name as well as by the column above.
    await run(
      `INSERT INTO milestone_drafts (id, org_id, donor_id, milestone_key, subject, body, status)
       VALUES (?,?,?,?,?,?, 'pending_review')`,
      ["md_" + uuid().slice(0, 12), orgId, personId, `volunteer_hours_${crossed}`,
       `Thank you for ${crossed} hours`, body])
      .catch(e => console.error("[volunteer] milestone draft:", e.message));
    console.log(`[volunteer] ${personId} crossed ${crossed} hours on ${today} — draft written for the coordinator`);
    return { hours: crossed };
  } catch (e) { console.error("[volunteer] milestone:", e.message); return null; }
}

// ── REPORTS ──────────────────────────────────────────────────────────────
// Hours by person, by program and by month. EVERY NUMBER OPENS: each figure
// carries the `rows` key its drill-through re-fetches, so the number on the
// screen and the rows behind it are one query and cannot drift.

app.get("/volunteer-hub/report", requireAuth, wrap(async (req, res) => {
  await READY;
  const orgId = req.user.orgId;
  const today = orgToday(await orgTz(orgId));                      // ORG_TZ_SEAM_OK
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || "")) ? String(req.query.from) : `${today.slice(0, 4)}-01-01`;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || "")) ? String(req.query.to) : today;

  const byPerson = await query(
    `SELECT d.id, d.name, SUM(round(s.hours*100))::bigint AS h, COUNT(*)::int AS n
       FROM volunteer_shifts s JOIN donors d ON d.id=s.person_id AND d.org_id=s.org_id
      WHERE s.org_id=? AND s.date >= ? AND s.date <= ? AND d.deleted_at IS NULL
      GROUP BY d.id, d.name ORDER BY h DESC`, [orgId, from, to]);
  // PROGRAM comes off the opportunity where the shift came from a checked-out
  // slot, and off the shift's own role otherwise. Both are recorded; neither
  // is invented.
  const byProgram = await query(
    `SELECT COALESCE(NULLIF(o.program,''), NULLIF(s.role,''), 'Not assigned to a program') AS program,
            SUM(round(s.hours*100))::bigint AS h, COUNT(*)::int AS n
       FROM volunteer_shifts s
       LEFT JOIN volunteer_signups su ON su.hours_shift_id = s.id
       LEFT JOIN volunteer_slots sl ON sl.id = su.slot_id
       LEFT JOIN volunteer_opportunities o ON o.id = sl.opportunity_id
      WHERE s.org_id=? AND s.date >= ? AND s.date <= ?
      GROUP BY 1 ORDER BY h DESC`, [orgId, from, to]);
  const byMonth = await query(
    `SELECT substring(s.date from 1 for 7) AS month, SUM(round(s.hours*100))::bigint AS h, COUNT(*)::int AS n
       FROM volunteer_shifts s WHERE s.org_id=? AND s.date >= ? AND s.date <= ?
      GROUP BY 1 ORDER BY 1`, [orgId, from, to]);

  const total = byPerson.reduce((a, r) => a + Number(r.h), 0);
  res.json({
    from, to,
    totalHundredths: total, totalHours: total / 100, people: byPerson.length,
    byPerson: byPerson.map(r => ({ personId: r.id, name: r.name, hours: Number(r.h) / 100, shifts: r.n, rows: "person:" + r.id })),
    byProgram: byProgram.map(r => ({ program: r.program, hours: Number(r.h) / 100, shifts: r.n, rows: "program:" + r.program })),
    byMonth: byMonth.map(r => ({ month: r.month, hours: Number(r.h) / 100, shifts: r.n, rows: "month:" + r.month })),
    definitions: {
      total: `Every hour on a shift dated between ${from} and ${to}, in your organisation's time zone. Hours come from a check-out, from the coordinator, from the volunteer's own page, or from an import.`,
      program: "The opportunity's program where the hours came from a shift somebody was checked out of, and the role written on the shift otherwise.",
      person: "One row per person, whether or not they also give.",
    },
    sentence: total
      ? `${total / 100} hours from ${byPerson.length} ${byPerson.length === 1 ? "person" : "people"}, between ${from} and ${to}.`
      : `No hours are recorded between ${from} and ${to}.`,
  });
}));

// The rows behind one of those numbers. A GET, and it writes nothing.
app.get("/volunteer-hub/report/rows", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const key = String(req.query.rows || "");
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || "")) ? String(req.query.from) : "0001-01-01";
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || "")) ? String(req.query.to) : "9999-12-31";
  const [kind, ...rest] = key.split(":");
  const value = rest.join(":");
  let where = "", params = [orgId, from, to];
  if (kind === "person") { where = "AND s.person_id = ?"; params.push(value); }
  else if (kind === "month") { where = "AND substring(s.date from 1 for 7) = ?"; params.push(value); }
  else if (kind === "program") {
    where = `AND COALESCE(NULLIF(o.program,''), NULLIF(s.role,''), 'Not assigned to a program') = ?`;
    params.push(value);
  } else return res.status(400).json({ error: "unknown_rows", message: "That is not a figure this report can open." });
  const rows = await query(
    `SELECT s.id, s.date, s.hours, s.role, s.via, d.id AS person_id, d.name,
            o.name AS opportunity, o.program
       FROM volunteer_shifts s
       JOIN donors d ON d.id=s.person_id AND d.org_id=s.org_id
       LEFT JOIN volunteer_signups su ON su.hours_shift_id = s.id
       LEFT JOIN volunteer_slots sl ON sl.id = su.slot_id
       LEFT JOIN volunteer_opportunities o ON o.id = sl.opportunity_id
      WHERE s.org_id=? AND s.date >= ? AND s.date <= ? ${where}
      ORDER BY s.date DESC, s.id LIMIT 2000`, params);
  const total = rows.reduce((a, r) => a + Math.round(Number(r.hours) * 100), 0);
  res.json({ rows: rows.map(r => ({ ...r, hours: Number(r.hours) })), count: rows.length,
    totalHours: total / 100,
    sentence: `${rows.length} ${rows.length === 1 ? "shift" : "shifts"}, ${total / 100} hours. This is every row behind that number.` });
}));

// THE GRANT-READY EXPORT. A funder asks for volunteer hours in a form a
// finance officer can check: one row per shift, with the person, the date,
// the hours, the program and where the number came from. No totals row,
// because a spreadsheet's own SUM is the one a funder will trust.
app.get("/volunteer-hub/report/export.csv", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const today = orgToday(await orgTz(orgId));                      // ORG_TZ_SEAM_OK
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || "")) ? String(req.query.from) : `${today.slice(0, 4)}-01-01`;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || "")) ? String(req.query.to) : today;
  const rows = await query(
    `SELECT d.name, d.email, s.date, s.hours, COALESCE(o.name, s.role, '') AS what,
            COALESCE(o.program, '') AS program, s.via
       FROM volunteer_shifts s
       JOIN donors d ON d.id=s.person_id AND d.org_id=s.org_id
       LEFT JOIN volunteer_signups su ON su.hours_shift_id = s.id
       LEFT JOIN volunteer_slots sl ON sl.id = su.slot_id
       LEFT JOIN volunteer_opportunities o ON o.id = sl.opportunity_id
      WHERE s.org_id=? AND s.date >= ? AND s.date <= ? AND d.deleted_at IS NULL
      ORDER BY s.date, d.name`, [orgId, from, to]);
  const esc = v => {
    const s = String(v ?? "");
    // A leading =, +, - or @ is a formula to a spreadsheet, not a value.
    const safe = /^[=+\-@]/.test(s) ? "'" + s : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const head = ["Volunteer", "Email", "Date", "Hours", "What they did", "Program", "How it was recorded"];
  const body = rows.map(r => [r.name, r.email || "", r.date, Number(r.hours), r.what, r.program,
    { staff: "Coordinator", self: "The volunteer", import: "Imported" }[r.via] || r.via].map(esc).join(","));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="volunteer-hours-${from}-to-${to}.csv"`);
  res.send("﻿" + [head.map(esc).join(","), ...body].join("\r\n") + "\r\n");
}));

// ── THE CROSSOVER ────────────────────────────────────────────────────────
// The thing nobody else does. Read here, once, so Home and the profile show
// the same two numbers with the same two sentences.
app.get("/volunteer-hub/crossover", requireAuth, wrap(async (req, res) => {
  await READY;
  // The crossover is a question ABOUT GIVING, asked of volunteers. A
  // coordinator is refused it by name, for the same reason they are refused
  // the givers view: the boundary is what they can see, not where it lives.
  if (req.user.role === "volunteer_coordinator") {
    return res.status(403).json({ error: "coordinator_scope",
      message: "Your account covers volunteers and hours. Who gives is part of giving." });
  }
  const orgId = req.user.orgId;
  const [org] = await query("SELECT name FROM orgs WHERE id=?", [orgId]);
  const orgName = await donorFacingOrgName(orgId, (org && org.name) || "").catch(() => (org && org.name) || "your organisation");
  const V = `d.person_types @> '["volunteer"]'::jsonb`;
  const [both] = await query(
    `SELECT COUNT(*)::int c FROM donors d
      WHERE d.org_id=? AND d.deleted_at IS NULL AND ${V}
        AND EXISTS (SELECT 1 FROM gifts g WHERE g.donor_id=d.id AND g.org_id=d.org_id)`, [orgId]);
  // "Never been asked" is a fact Steward can check: no gift, and no logged
  // conversation of a kind that is an ask. Not "no gift" alone, which would
  // include everybody somebody has already asked and been turned down by.
  const [never] = await query(
    `SELECT COUNT(*)::int c FROM donors d
      WHERE d.org_id=? AND d.deleted_at IS NULL AND ${V}
        AND NOT EXISTS (SELECT 1 FROM gifts g WHERE g.donor_id=d.id AND g.org_id=d.org_id)
        AND NOT EXISTS (SELECT 1 FROM interactions i
                         WHERE i.donor_id=d.id AND i.org_id=d.org_id
                           AND (i.type IN ('ask','solicitation') OR lower(coalesce(i.note,'')) LIKE '%asked%'))`, [orgId]);
  const figures = VS.crossoverSentences({
    bothCount: both.c, volunteerNeverAskedCount: never.c, orgName });
  res.json({ figures, bothCount: both.c, neverAskedCount: never.c,
    nextStep: never.c ? {
      label: `Ask the ${never.c} ${never.c === 1 ? "volunteer" : "volunteers"} who have never been asked`,
      why: `They already say yes to ${orgName} with their time. Nobody has asked them for a gift.`,
    } : null,
    definitions: {
      bothCount: "People whose record carries the Volunteer role and has at least one gift on it.",
      neverAskedCount: "People whose record carries the Volunteer role, has no gift, and has no logged conversation that was an ask.",
    } });
}));

app.get("/volunteer-hub/crossover/rows", requireAuth, wrap(async (req, res) => {
  if (req.user.role === "volunteer_coordinator") return res.status(403).json({ error: "coordinator_scope" });
  const orgId = req.user.orgId;
  const which = String(req.query.which || "");
  const V = `d.person_types @> '["volunteer"]'::jsonb`;
  let sql;
  if (which === "gives_and_volunteers") {
    sql = `SELECT d.id, d.name, d.total_giving,
                  (SELECT COALESCE(SUM(round(vs.hours*100)),0) FROM volunteer_shifts vs WHERE vs.person_id=d.id AND vs.org_id=d.org_id)::bigint AS h
             FROM donors d WHERE d.org_id=? AND d.deleted_at IS NULL AND ${V}
               AND EXISTS (SELECT 1 FROM gifts g WHERE g.donor_id=d.id AND g.org_id=d.org_id)
             ORDER BY d.total_giving DESC NULLS LAST, d.name`;
  } else if (which === "volunteer_never_asked") {
    sql = `SELECT d.id, d.name, d.total_giving,
                  (SELECT COALESCE(SUM(round(vs.hours*100)),0) FROM volunteer_shifts vs WHERE vs.person_id=d.id AND vs.org_id=d.org_id)::bigint AS h
             FROM donors d WHERE d.org_id=? AND d.deleted_at IS NULL AND ${V}
               AND NOT EXISTS (SELECT 1 FROM gifts g WHERE g.donor_id=d.id AND g.org_id=d.org_id)
               AND NOT EXISTS (SELECT 1 FROM interactions i WHERE i.donor_id=d.id AND i.org_id=d.org_id
                                 AND (i.type IN ('ask','solicitation') OR lower(coalesce(i.note,'')) LIKE '%asked%'))
             ORDER BY h DESC, d.name`;
  } else return res.status(400).json({ error: "unknown_rows" });
  const rows = await query(sql, [orgId]);
  res.json({ rows: rows.map(r => ({ id: r.id, name: r.name, lifetimeGiving: Number(r.total_giving || 0), hours: Number(r.h) / 100 })),
    count: rows.length });
}));

// ── SHIFT REMINDERS ──────────────────────────────────────────────────────
// OFF BY DEFAULT, per org, and the demo org never sends at all. Driven by an
// ops route rather than a timer so a suite can run it deliberately, exactly
// like every other sweep in this codebase.
// ADMIN ONLY, the same bar as /workflows/run-sweeps: it is the scheduled
// path, run by hand. It mails volunteers, so it is not a staff button.
app.post("/volunteer-hub/run-reminders", requireAuth, requireAdmin, wrap(async (req, res) => {
  const out = await runVolunteerReminders();
  res.json({ ...out, sentence: out.sent
    ? `${out.sent} reminder${out.sent === 1 ? "" : "s"} sent for tomorrow's shifts.`
    : "Nothing to send. Reminders go out the day before a shift, to confirmed volunteers, and only where the organisation has turned them on." });
}));

// The switch. OFF by default and off on the demo org, and this is the only
// thing that turns it on: an org deciding that Steward may write to its
// volunteers is an org's decision, and a default of ON would make it for them.
app.get("/volunteer-hub/settings", requireAuth, wrap(async (req, res) => {
  const [o] = await query("SELECT volunteer_reminders_enabled, volunteer_waiver_text, is_demo_org FROM orgs WHERE id=?", [req.user.orgId]);
  res.json({
    remindersEnabled: !!(o && o.volunteer_reminders_enabled),
    waiverText: (o && o.volunteer_waiver_text) || null,
    defaultWaiverText: DEFAULT_WAIVER,
    canSend: !(o && o.is_demo_org === true),
    sentence: "A reminder goes out the day before a shift, to the people confirmed on it, once each. "
      + "It is off until you turn it on, and Steward sends nothing else to your volunteers.",
  });
}));

app.patch("/volunteer-hub/settings", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const b = req.body || {};
  const sets = [], params = [];
  if (b.remindersEnabled !== undefined) { sets.push("volunteer_reminders_enabled=?"); params.push(b.remindersEnabled === true); }
  if (b.waiverText !== undefined) {
    const t = String(b.waiverText || "").trim().slice(0, 8000);
    sets.push("volunteer_waiver_text=?"); params.push(t || null);
  }
  if (!sets.length) return res.status(400).json({ error: "nothing_to_change" });
  params.push(req.user.orgId);
  await run(`UPDATE orgs SET ${sets.join(", ")} WHERE id=?`, params);
  const [o] = await query("SELECT volunteer_reminders_enabled, is_demo_org FROM orgs WHERE id=?", [req.user.orgId]);
  res.json({ ok: true, remindersEnabled: !!o.volunteer_reminders_enabled,
    message: o.volunteer_reminders_enabled
      ? (o.is_demo_org === true
          ? "Turned on, and nothing will be sent: this is the demonstration organisation and it never mails anybody."
          : "Turned on. A reminder goes out the day before a shift, to the people confirmed on it, once each.")
      : "Turned off. Steward will not write to your volunteers." });
}));

async function runVolunteerReminders() {
  const out = { orgsConsidered: 0, orgsOff: 0, sent: 0, skipped: 0 };
  const orgs = await query(
    `SELECT id, name, volunteer_reminders_enabled, is_demo_org FROM orgs WHERE volunteer_reminders_enabled = TRUE`, []);
  for (const org of orgs) {
    out.orgsConsidered++;
    // THE DEMO ORG NEVER SENDS. Belt and braces: orgMaySendEmail refuses it
    // too, and this refuses it before the question is even asked.
    if (org.is_demo_org === true) { out.orgsOff++; continue; }
    const decision = await orgMaySendEmail(org.id);
    if (!decision.send) { out.orgsOff++; continue; }
    const today = orgToday(await orgTz(org.id));                   // ORG_TZ_SEAM_OK
    const tomorrow = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10) + 1))
      .toISOString().slice(0, 10);
    const due = await query(
      `SELECT su.id, d.email, d.name, s.date, s.start_time, s.end_time, o.name AS opp_name, o.location
         FROM volunteer_signups su
         JOIN volunteer_slots s ON s.id=su.slot_id
         JOIN volunteer_opportunities o ON o.id=s.opportunity_id
         JOIN donors d ON d.id=su.person_id AND d.org_id=su.org_id
        WHERE su.org_id=? AND su.status='confirmed' AND su.reminded_at IS NULL
          AND s.cancelled_at IS NULL AND s.date = ? AND d.deleted_at IS NULL AND d.email IS NOT NULL`,
      [org.id, tomorrow]);
    const brand = await brandOf(org.id);
    for (const r of due) {
      // FIX-14 Part 4: the same per-person check as donor mail. A deceased,
      // bounced, complained or unreachable volunteer gets nothing, and the
      // row is left unclaimed so the reason is re-asked, never remembered.
      const person = await donorMailDecision("volunteer_reminder", r.email, org.id);
      if (!person.send) { out.skipped++; continue; }
      // The row is CLAIMED first: a second run of the sweep finds it taken,
      // so a retry cannot mail somebody twice.
      const claimed = await query("UPDATE volunteer_signups SET reminded_at=NOW() WHERE id=? AND reminded_at IS NULL RETURNING id", [r.id]);
      if (!claimed.length) { out.skipped++; continue; }
      await resend.emails.send({
        from: process.env.DEMO_SMTP_FROM || "noreply@stewardapp.dev",
        to: r.email,
        _stewardOrgId: org.id, _stewardKind: "volunteer_reminder",
        subject: `Tomorrow: ${r.opp_name}`,
        html: `<p>A reminder that you are signed up for <strong>${escapeHtml(r.opp_name)}</strong> tomorrow, `
          + `${escapeHtml(VS.timeRangeWords(r.start_time, r.end_time))}.</p>`
          + (r.location ? `<p>${escapeHtml(r.location)}</p>` : "")
          + `<p style="font-size:13px;color:#5a554f">${escapeHtml(brand.displayName || org.name)}</p>`,
      }).then(resp => {
        // A refusal (the permanent block, mail off) comes back as an error, not a throw.
        if (resp && resp.error) { out.skipped++; console.error("[volunteer] reminder refused:", resp.error.message); }
        else out.sent++;
      })
        .catch(e => { out.skipped++; console.error("[volunteer] reminder:", e.message); });
    }
  }
  return out;
}

ctx.registerVolunteerReminders && ctx.registerVolunteerReminders(runVolunteerReminders);
}

module.exports = { routers, mount };
