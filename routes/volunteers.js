// routes/volunteers.js — BUILD-98 (switch) Part 5, moved here by FIX-1 C, plus
// the coordinator's hub.
//
// FIX-1's rule for server.js: a workstream that touches routes moves them into
// a module instead of editing them in place. server.js mounts this at the
// point in the router the routes always sat, so nothing registers in a new
// order. Every dependency comes in through `deps` — this file opens no pool of
// its own (routes/migc.js does, and it is a different product).
//
// THE HUB (FIX-1 C). Volunteers lived under Donors with a paragraph explaining
// why. The model was right and does not move: one person, one record, and the
// VOLUNTEER ROLE is BUILD-94's person_types. What changed is the screen.
//   · ROSTER — everyone with the volunteer role, and nobody else.
//   · HOURS are hundredths summed as integers (shared/volunteerHours.js), read
//     by the SAME summary the person's own record reads, so the two are one
//     number by construction.
//   · NOTES are the coordinator's own (volunteer_notes) and never touch
//     interactions: the donor timeline, Drift, thank-you drafts and the agent
//     all read interactions, and this table is not it.
//   · "ALSO GIVES" means a gift row exists — the fact, not a stage.

module.exports = function mountVolunteers(app, deps) {
const { express, crypto, query, run, uuid, requireAuth, checkWriteAccess, wrap, actor,
        publicAppUrl, donateLimiter, escapeHtml, donorFacingOrgName, orgTz, orgToday } = deps;

// ════════════════════════════════════════════════════════════════════════════
// BUILD-98 (switch) Part 5 — VOLUNTEERS AND HOURS
// ════════════════════════════════════════════════════════════════════════════
// shared/volunteerHours.js holds the rules (hundredths, a 24-hour ceiling, an
// import key). Hours live on the PERSON (donors row, BUILD-94's person types),
// so a volunteer who gives is one record with both roles. Not scheduling.
let VH = null;
const VH_READY = import("./shared/volunteerHours.js").then(m => { VH = m; return m; });

// A person who logged a shift IS a volunteer, on the same record — the
// recordGift rule for "donor", applied to hours. "other" means "we do not know"
// and a shift answers that.
async function markVolunteer(orgId, personId) {
  await run(`UPDATE donors SET person_types = CASE
      WHEN person_types IS NULL THEN '["donor","volunteer"]'::jsonb
      WHEN person_types @> '["volunteer"]'::jsonb THEN person_types
      ELSE (person_types - 'other') || '["volunteer"]'::jsonb END
    WHERE id=? AND org_id=?`, [personId, orgId]);
}

async function insertShift(orgId, personId, shift, { via, importKey = null, who }) {
  const rows = await query(
    `INSERT INTO volunteer_shifts (id,org_id,person_id,date,hours,role,note,via,import_key,created_by,created_by_name)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT (org_id, import_key) WHERE import_key IS NOT NULL DO NOTHING RETURNING id`,
    ["vs_" + uuid().slice(0, 10), orgId, personId, shift.date, shift.hundredths / 100, shift.role, shift.note || null,
     via, importKey, who.id, who.name]);
  if (rows.length) await markVolunteer(orgId, personId);
  return rows[0]?.id || null;
}

async function volunteerSummary(orgId, personId) {
  const [t] = await query(`SELECT COALESCE(SUM(round(hours*100)),0)::bigint AS h, COUNT(*)::int AS n, MIN(date) AS first, MAX(date) AS last
                             FROM volunteer_shifts WHERE org_id=? AND person_id=?`, [orgId, personId]);
  return { hundredths: Number(t?.h || 0), totalHours: Number(t?.h || 0) / 100, shiftCount: t?.n || 0, firstShift: t?.first || null, lastShift: t?.last || null };
}

// The volunteer's own link — signed, expiring, and it names ONE person in ONE
// org. The signature covers both, so a token cannot be pointed at somebody
// else. It is a link staff hand over; Steward never emails it on its own.
function signVolunteerToken(orgId, personId, exp) {
  const body = `${orgId}.${personId}.${exp}`;
  const sig = crypto.createHmac("sha256", process.env.JWT_SECRET || "").update("volunteer-log:" + body).digest("base64url");
  return Buffer.from(body).toString("base64url") + "." + sig;
}
function verifyVolunteerToken(token) {
  const [b, sig] = String(token || "").split(".");
  if (!b || !sig) return null;
  let body; try { body = Buffer.from(b, "base64url").toString(); } catch { return null; }
  const want = crypto.createHmac("sha256", process.env.JWT_SECRET || "").update("volunteer-log:" + body).digest("base64url");
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  const [orgId, personId, exp] = body.split(".");
  if (!orgId || !personId || !(Number(exp) > Date.now())) return null;
  return { orgId, personId };
}

app.get("/donors/:id/volunteer-hours", requireAuth, wrap(async (req, res) => {
  const [d] = await query("SELECT id FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [req.params.id, req.user.orgId]);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  const shifts = await query(`SELECT id, date, hours, role, note, via, created_by_name FROM volunteer_shifts
                               WHERE org_id=? AND person_id=? ORDER BY date DESC, created_at DESC LIMIT 100`, [req.user.orgId, d.id]);
  res.json({ ...(await volunteerSummary(req.user.orgId, d.id)),
    sentence: "Every shift logged for this person, by staff, by the volunteer from their link, or from an import.",
    shifts: shifts.map(s => ({ ...s, hours: Number(s.hours) })) });
}));

app.post("/donors/:id/volunteer-hours", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  await VH_READY;
  const [d] = await query("SELECT id FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [req.params.id, req.user.orgId]);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  const v = VH.validateShift(req.body || {});
  if (!v.ok) return res.status(400).json({ error: v.errors.join("; ") });
  const id = await insertShift(req.user.orgId, d.id, v.shift, { via: "staff", who: actor(req) });
  res.status(201).json({ id, ...(await volunteerSummary(req.user.orgId, d.id)) });
}));

app.delete("/volunteer-shifts/:id", requireAuth, wrap(async (req, res) => {
  const { changes } = await run("DELETE FROM volunteer_shifts WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!changes) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
}));

// The link staff hand to a volunteer so they can log their own hours.
app.post("/donors/:id/volunteer-link", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  await VH_READY;
  const [d] = await query("SELECT id FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [req.params.id, req.user.orgId]);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  const exp = Date.now() + VH.SELF_LOG_DAYS * 86400000;
  res.json({ url: `${publicAppUrl()}/volunteer/log?token=${signVolunteerToken(req.user.orgId, d.id, exp)}`,
    expiresInDays: VH.SELF_LOG_DAYS,
    sentence: `Anyone with this link can log hours for this person for the next ${VH.SELF_LOG_DAYS} days. Steward does not send it; you do.` });
}));

// The volunteer's page. A GET renders and CHANGES NOTHING (mail clients and
// link scanners fetch links); the form POSTs.
function volunteerPage(title, inner) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:#f0ede6;font-family:Arial,sans-serif;color:#0f1a12"><div style="max-width:440px;margin:40px auto;background:#fff;border:1px solid #e8e4db;border-radius:14px;padding:28px">${inner}</div></body></html>`;
}
app.get("/volunteer/log", donateLimiter, wrap(async (req, res) => {
  const t = verifyVolunteerToken(req.query.token);
  if (!t) return res.status(404).send(volunteerPage("Link expired", "<p>This link has expired or is not valid. Ask the organisation for a new one.</p>"));
  const [p] = await query("SELECT d.name, o.name AS org FROM donors d JOIN orgs o ON o.id = d.org_id WHERE d.id=? AND d.org_id=? AND d.deleted_at IS NULL", [t.personId, t.orgId]);
  if (!p) return res.status(404).send(volunteerPage("Link expired", "<p>This link is no longer valid.</p>"));
  const orgName = await donorFacingOrgName(t.orgId, p.org).catch(() => p.org);
  const first = String(p.name || "").split(/\s+/)[0];
  const inp = "width:100%;box-sizing:border-box;border:1px solid #e8e4db;border-radius:8px;padding:10px;font-size:15px;margin:4px 0 12px";
  res.setHeader("Cache-Control", "no-store");
  res.send(volunteerPage(`Log your hours · ${orgName}`, `
    <div style="font-size:13px;color:#5a554f">${escapeHtml(orgName)}</div>
    <h1 style="font-family:Georgia,serif;font-weight:400;font-size:24px;margin:6px 0 16px">Thank you, ${escapeHtml(first)}. How long did you help?</h1>
    <form method="post" action="/volunteer/log">
      <input type="hidden" name="token" value="${escapeHtml(String(req.query.token))}">
      <label>Date<input name="date" type="date" required style="${inp}"></label>
      <label>Hours<input name="hours" type="number" step="0.25" min="0.25" max="24" required style="${inp}"></label>
      <label>What you did (optional)<input name="role" maxlength="120" style="${inp}"></label>
      <button type="submit" style="background:#0d5c3a;color:#fff;border:none;border-radius:10px;padding:12px 18px;font-size:15px;font-weight:700">Log my hours</button>
    </form>`));
}));
app.post("/volunteer/log", donateLimiter, express.urlencoded({ extended: false }), wrap(async (req, res) => {
  await VH_READY;
  const t = verifyVolunteerToken(req.body?.token);
  if (!t) return res.status(404).send(volunteerPage("Link expired", "<p>This link has expired or is not valid.</p>"));
  const [p] = await query("SELECT id FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [t.personId, t.orgId]);
  if (!p) return res.status(404).send(volunteerPage("Link expired", "<p>This link is no longer valid.</p>"));
  const v = VH.validateShift(req.body || {});
  if (!v.ok) return res.status(400).send(volunteerPage("Check the form", `<p>Please give ${escapeHtml(v.errors.join(" and "))}.</p><p><a href="/volunteer/log?token=${encodeURIComponent(req.body.token)}">Go back</a></p>`));
  await insertShift(t.orgId, p.id, v.shift, { via: "self", who: { id: "system:volunteer-link", name: "The volunteer, from their link" } });
  const s = await volunteerSummary(t.orgId, p.id);
  res.send(volunteerPage("Thank you", `<h1 style="font-family:Georgia,serif;font-weight:400;font-size:24px">Thank you.</h1><p>${v.shift.hundredths / 100} hours logged. That makes ${s.totalHours} in all.</p><p><a href="/volunteer/log?token=${encodeURIComponent(req.body.token)}">Log another shift</a></p>`));
}));

// Hours from Wranglr or VolunteerHub. The client parses the file with the
// preset; the server re-validates every row and matches people by email, then
// by exact name, creating a Volunteer only when nobody answers to either.
app.post("/volunteer-hours/import", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  await VH_READY;
  const orgId = req.user.orgId, who = actor(req);
  const rows = Array.isArray(req.body?.shifts) ? req.body.shifts.slice(0, 20000) : [];
  if (!rows.length) return res.status(400).json({ error: "No shifts to import." });
  const out = { imported: 0, alreadyThere: 0, peopleCreated: 0, refused: [] };
  const cache = new Map();
  for (const [i, r] of rows.entries()) {
    const v = VH.validateShift(r);
    const name = String(r?.name || "").trim().slice(0, 200), email = String(r?.email || "").trim().toLowerCase().slice(0, 200);
    if (!v.ok || (!name && !email)) { out.refused.push({ line: r?.line || i + 2, why: v.ok ? "no name or email" : v.errors.join("; ") }); continue; }
    const ck = email || "n:" + name.toLowerCase();
    let pid = cache.get(ck);
    if (!pid) {
      if (email) { const m = await query("SELECT id FROM donors WHERE org_id=? AND deleted_at IS NULL AND LOWER(email)=? LIMIT 2", [orgId, email]); if (m.length === 1) pid = m[0].id; }
      if (!pid && name) { const m = await query("SELECT id FROM donors WHERE org_id=? AND deleted_at IS NULL AND LOWER(name)=LOWER(?) LIMIT 2", [orgId, name]); if (m.length === 1) pid = m[0].id; }
      if (!pid) {
        pid = "d_" + uuid().slice(0, 10);
        await run(`INSERT INTO donors (id,org_id,name,email,stage,status,tags,person_types,created_by,created_by_name) VALUES (?,?,?,?,'prospect','active','[]','["volunteer"]'::jsonb,?,?)`,
          [pid, orgId, name || email, email || null, who.id, who.name]);
        out.peopleCreated++;
      }
      cache.set(ck, pid);
    }
    const key = VH.shiftKey({ email, name, date: v.shift.date, hundredths: v.shift.hundredths, role: v.shift.role });
    const id = await insertShift(orgId, pid, v.shift, { via: "import", importKey: key, who });
    if (id) out.imported++; else out.alreadyThere++;
  }
  res.json(out);
}));


// ════════════════════════════════════════════════════════════════════════════
// FIX-1 C — THE COORDINATOR'S HUB
// ════════════════════════════════════════════════════════════════════════════
const VOLUNTEER_ROLE = `d.person_types @> '["volunteer"]'::jsonb`;
const NOTE_KINDS = ["training", "background_check", "availability", "note"];

// The roster query, once. `hundredths` is summed exactly as volunteerSummary
// sums it (round(hours*100), integer), so the roster and the record agree.
async function rosterRows(orgId, { onlyGivers = false } = {}) {
  const today = orgToday(await orgTz(orgId));
  const yearStart = String(today).slice(0, 4) + "-01-01";
  const rows = await query(
    `SELECT d.id, d.name, d.email, d.total_giving, d.last_gift_date,
            COALESCE(s.h, 0)::bigint AS h, COALESCE(s.hy, 0)::bigint AS hy, COALESCE(s.n, 0)::int AS n, s.last,
            EXISTS (SELECT 1 FROM gifts g WHERE g.donor_id = d.id AND g.org_id = d.org_id) AS gives
       FROM donors d
       LEFT JOIN (SELECT person_id, SUM(round(hours*100)) AS h,
                         SUM(CASE WHEN date >= ? THEN round(hours*100) ELSE 0 END) AS hy,
                         COUNT(*) AS n, MAX(date) AS last
                    FROM volunteer_shifts WHERE org_id = ? GROUP BY person_id) s ON s.person_id = d.id
      WHERE d.org_id = ? AND d.deleted_at IS NULL AND ${VOLUNTEER_ROLE}
      ORDER BY COALESCE(s.hy, 0) DESC, d.name, d.id`, [yearStart, orgId, orgId]);
  const people = rows.map(r => ({
    id: r.id, name: r.name, email: r.email || null,
    hundredths: Number(r.h), hundredthsThisYear: Number(r.hy), shiftCount: r.n,
    lastShift: r.last || null, alsoGives: !!r.gives,
    lifetimeGiving: Number(r.total_giving || 0), lastGiftDate: r.last_gift_date || null,
  }));
  return { people: onlyGivers ? people.filter(p => p.alsoGives) : people, year: yearStart.slice(0, 4) };
}

const spell = n => ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"][n] || String(n);
const hoursWords = h => { const v = h / 100; return `${Number.isInteger(v) ? v : v.toFixed(2).replace(/0$/, "")} hour${v === 1 ? "" : "s"}`; };

app.get("/volunteer-hub/roster", requireAuth, wrap(async (req, res) => {
  const { people, year } = await rosterRows(req.user.orgId);
  const total = people.reduce((a, p) => a + p.hundredthsThisYear, 0);
  const givers = people.filter(p => p.alsoGives).length;
  // A sentence with no holes: each clause only when there is something in it.
  const parts = [`${people.length === 1 ? "One volunteer" : spell(people.length)[0].toUpperCase() + spell(people.length).slice(1) + " volunteers"} on the roster`];
  if (total) parts.push(`${hoursWords(total)} given so far in ${year}`);
  if (givers) parts.push(`${spell(givers)} of them also give${givers === 1 ? "s" : ""}`);
  res.json({ people, year,
    sentence: people.length ? parts.join(", ") + "." : "Nobody is marked as a volunteer yet. Log a shift on someone's record, or import hours, and they join the roster.",
    definition: "Everyone whose record carries the Volunteer role. Hours are every shift logged for them, by staff, from their own link, or from an import." });
}));

app.get("/volunteer-hub/givers", requireAuth, wrap(async (req, res) => {
  const { people } = await rosterRows(req.user.orgId, { onlyGivers: true });
  people.sort((a, b) => b.lifetimeGiving - a.lifetimeGiving || a.name.localeCompare(b.name));
  res.json({ people, definition: "Volunteers with at least one gift on their record. One person, one record: the same row as their giving." });
}));

app.get("/volunteer-hub/shifts", requireAuth, wrap(async (req, res) => {
  const limit = Math.max(1, Math.min(200, parseInt(req.query.limit, 10) || 50));
  const rows = await query(
    `SELECT s.id, s.person_id, d.name AS person_name, s.date, s.hours, s.role, s.via, s.created_by_name
       FROM volunteer_shifts s JOIN donors d ON d.id = s.person_id AND d.org_id = s.org_id AND d.deleted_at IS NULL
      WHERE s.org_id = ? ORDER BY s.date DESC, s.created_at DESC LIMIT ?`, [req.user.orgId, limit]);
  res.json({ shifts: rows.map(r => ({ ...r, hours: Number(r.hours) })) });
}));

async function hubPerson(orgId, personId) {
  const [p] = await query(`SELECT d.id, d.name, (${VOLUNTEER_ROLE}) AS is_volunteer FROM donors d
                            WHERE d.id = ? AND d.org_id = ? AND d.deleted_at IS NULL`, [String(personId || ""), orgId]);
  return p || null;
}

app.get("/volunteer-hub/notes", requireAuth, wrap(async (req, res) => {
  const p = await hubPerson(req.user.orgId, req.query.personId);
  if (!p) return res.status(404).json({ error: "Not found" });
  const notes = await query(`SELECT id, kind, body, note_date, created_by_name, created_at FROM volunteer_notes
                              WHERE org_id = ? AND person_id = ? ORDER BY created_at DESC LIMIT 200`, [req.user.orgId, p.id]);
  res.json({ notes, sentence: "Notes about volunteering. They stay here: they never appear on the giving record, in Drift, or in anything drafted to this person." });
}));

app.post("/volunteer-hub/notes", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const p = await hubPerson(req.user.orgId, req.body?.personId);
  if (!p) return res.status(404).json({ error: "Not found" });
  if (!p.is_volunteer) return res.status(400).json({ error: "not_a_volunteer", sentence: `${p.name} is not marked as a volunteer, so there is nowhere on the roster for this note.` });
  const kind = String(req.body?.kind || "");
  if (!NOTE_KINDS.includes(kind)) return res.status(400).json({ error: "Pick training, background check, availability or note." });
  const body = String(req.body?.body || "").trim().slice(0, 2000);
  if (!body) return res.status(400).json({ error: "A note needs words." });
  const nd = String(req.body?.noteDate || "").slice(0, 10);
  const noteDate = /^\d{4}-\d{2}-\d{2}$/.test(nd) ? nd : null;
  const who = actor(req);
  const [me] = await query(`SELECT name FROM users WHERE id=? AND org_id=?`, [req.user.userId, req.user.orgId]);
  const id = "vn_" + uuid().slice(0, 12);
  await run(`INSERT INTO volunteer_notes (id,org_id,person_id,kind,body,note_date,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?)`,
    [id, req.user.orgId, p.id, kind, body, noteDate, who.id, (me && me.name) || who.name]);
  res.status(201).json({ id });
}));

// Removal takes the id in the BODY (no identifier in the path) and, like
// every delete here, is never write-gated.
app.post("/volunteer-hub/notes/delete", requireAuth, wrap(async (req, res) => {
  const { changes } = await run(`DELETE FROM volunteer_notes WHERE id=? AND org_id=?`, [String(req.body?.id || ""), req.user.orgId]);
  if (!changes) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
}));

};
