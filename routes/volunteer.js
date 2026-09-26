// routes/volunteer.js — volunteers, shifts and hours.
//
// FIX-1 split: these routes and the helpers only they use were moved here
// VERBATIM from server.js. Nothing in them changed.
//
// How it is wired, so it behaves exactly as it did inside server.js:
//   * Each router below is mounted in server.js with app.use(...) at the place
//     its first route used to be declared, so it keeps its place in the stack
//     (before or after the same middleware, before or after the same routes).
//   * server.js calls mount() once, at the end of boot, when every binding the
//     code below reads exists. `app` inside mount() is the current router, so
//     the unchanged `app.get(...)` lines register on it.
//   * `__dirname` is server.js's own, so every path built from it resolves as
//     before; a relative require()/import() reads "../x" because it resolves
//     against this file, one folder down (readSource reads it back as "./x").
// Tests read this file through readSource("server.js") (scripts/lib/readSource.js).
const express = require("express");

const routers = {
  r0: express.Router(),
};

function mount(ctx) {
const {
  SYS_AUTO, VH_READY, actor, checkWriteAccess, crypto, donateLimiter, donorFacingOrgName,
  escapeHtml, express, insertShift, orgToday, orgTz, query, requireAuth, run, uuid,
  volunteerSummary, wrap, markVolunteer, publicAppUrl,
} = ctx;
// server.js loads these ESM modules at boot and sets its own binding when each
// arrives; the code below reads them only after awaiting the same promise, so
// this module keeps its own binding, set from that promise the same way.
let VH = null;
VH_READY.then(m => { VH = m; });
let app = routers.r0;
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

app.delete("/volunteer-shifts/:id", requireAuth, wrap(async (req, res) => {
  const { changes } = await run("DELETE FROM volunteer_shifts WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!changes) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
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
// Anything else under /api/v1 — including a write — falls through to the
// app's one 404 handler: a plain not-found, not a hint.

app.get("/volunteers", requireAuth, wrap(async (req, res) => {
  const vols = await query(
    "SELECT * FROM volunteers WHERE org_id = ? ORDER BY hours DESC",
    [req.user.orgId]
  );
  res.json(vols.map(v => ({ ...v, skills: JSON.parse(v.skills || "[]") })));
}));

app.post("/volunteers", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { name, email, hours, skills, employer, notes, convertPotential } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });

  const id = "v_" + uuid().slice(0, 8);
  await run(
    "INSERT INTO volunteers (id,org_id,name,email,hours,skills,employer,notes,convert_potential,last_active,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    [id, req.user.orgId, name, email || "", hours || 0,
     JSON.stringify(skills || []), employer || "", notes || "",
     convertPotential || "medium", new Date().toISOString().split("T")[0], actor(req).id, actor(req).name]
  );
  const rows = await query("SELECT * FROM volunteers WHERE id = ?", [id]);
  res.status(201).json(rows[0]);
}));

app.put("/volunteers/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { name, email, hours, skills, employer, notes, convertPotential } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });

  // Capture old hours before update to detect 20-hour threshold crossing
  const prevRows = await query("SELECT hours FROM volunteers WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  const prevHours = parseFloat(prevRows[0]?.hours || 0);
  const newHours = parseFloat(hours || 0);

  const affected = await run(
    "UPDATE volunteers SET name=?,email=?,hours=?,skills=?,employer=?,notes=?,convert_potential=? WHERE id=? AND org_id=?",
    [name, email || "", newHours, JSON.stringify(skills || []),
     employer || "", notes || "", convertPotential || "medium", req.params.id, req.user.orgId]
  );
  if (!affected.changes) return res.status(404).json({ error: "Volunteer not found" });

  // 20-hour threshold: auto-create donor prospect + task
  if (prevHours < 20 && newHours >= 20 && email) {
    const orgId = req.user.orgId;
    const existing = await query("SELECT id FROM donors WHERE org_id=? AND email ILIKE ?", [orgId, email]);
    if (!existing.length) {
      const donorId = "d_" + uuid().slice(0, 8);
      await run(
        "INSERT INTO donors (id,org_id,name,email,stage,notes,gift_count,total_giving,created_by,created_by_name) VALUES (?,?,?,?,'prospect',?,0,0,?,?)",
        [donorId, orgId, name, email.toLowerCase(), "Auto-created from volunteer record. 20+ hours logged.", SYS_AUTO.id, SYS_AUTO.name]
      ).catch(() => {});
      const today = orgToday(await orgTz(orgId)); // ORG_TZ_SEAM_OK (BUILD-75)
      await run("INSERT INTO interactions (id,org_id,donor_id,type,note,date) VALUES (?,?,?,'note',?,?)",
        ["i_"+uuid().slice(0,8), orgId, donorId, "Volunteer prospect — 20+ hours logged", today]).catch(() => {});
    }
    const dueDate = new Date(Date.now() + 7*24*60*60*1000).toISOString().slice(0, 10);
    await run("INSERT INTO tasks (id,org_id,title,priority,done,due,created_by,created_by_name) VALUES (?,?,?,'high',0,?,?,?)",
      ["t_"+uuid().slice(0,8), orgId, `Cultivate volunteer ${name} as donor prospect — 20+ hours logged`, dueDate, SYS_AUTO.id, SYS_AUTO.name]).catch(() => {});
  }

  const rows = await query("SELECT * FROM volunteers WHERE id = ?", [req.params.id]);
  res.json(rows[0]);
}));

app.get("/volunteers/donor-prospects", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const vols = await query(
    "SELECT * FROM volunteers WHERE org_id=? AND hours >= 20 ORDER BY hours DESC",
    [orgId]
  );
  const result = await Promise.all(vols.map(async v => {
    const donor = v.email
      ? await query("SELECT id FROM donors WHERE org_id=? AND email ILIKE ?", [orgId, v.email])
      : [];
    return { ...v, skills: JSON.parse(v.skills || "[]"), hasDonorRecord: donor.length > 0 };
  }));
  res.json(result.filter(v => !v.hasDonorRecord));
}));

// ════════════════════════════════════════════════════════════════════════════
// FIX-1 C — THE VOLUNTEER COORDINATOR'S HUB
// ════════════════════════════════════════════════════════════════════════════
// Volunteers lived under Donors with a paragraph explaining why. The model was
// right and does not move: one person, one record, and the VOLUNTEER ROLE is
// BUILD-94's person_types. What changed is that the coordinator has a place.
//   · ROSTER — everyone with the volunteer role, and nobody else. Workstream
//     D's role chip writes person_types; the roster reads it, no second record.
//   · HOURS are hundredths summed as integers — the same round(hours*100) sum
//     volunteerSummary gives the person's own record, so the two are one number.
//   · NOTES are the coordinator's own (volunteer_notes) and never touch
//     interactions: the donor timeline, Drift, thank-you drafts and the agent
//     all read interactions, and this table is not it.
//   · "ALSO GIVES" means a gift row exists — the fact, not a stage.
//   · SIGN-UP LINK — one signed link per org that anyone can use to join the
//     roster. Steward never sends it; the coordinator copies it.
// The old `volunteers` table and routes above are left exactly as they were.
const VOLUNTEER_ROLE = `d.person_types @> '["volunteer"]'::jsonb`;
const NOTE_KINDS = ["training", "background_check", "availability", "note"];
const HOURS_DEFINITION = "Every shift logged for this person, by staff, by the volunteer from their own link, or from an import, summed to the hundredth of an hour.";

async function rosterRows(orgId, { onlyGivers = false } = {}) {
  const today = orgToday(await orgTz(orgId)); // ORG_TZ_SEAM_OK — "this year" is the org's civil year
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
      ORDER BY COALESCE(s.hy, 0) DESC, lower(d.name), d.id`, [yearStart, orgId, orgId]);
  const people = rows.map(r => ({
    id: r.id, name: r.name, email: r.email || null,
    hundredths: Number(r.h), hundredthsThisYear: Number(r.hy), shiftCount: r.n,
    lastShift: r.last || null, alsoGives: !!r.gives,
    lifetimeGiving: Number(r.total_giving || 0), lastGiftDate: r.last_gift_date || null,
  }));
  return { people: onlyGivers ? people.filter(p => p.alsoGives) : people, year: yearStart.slice(0, 4) };
}

const spell = n => ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][n] || String(n);
const cap = w => w.charAt(0).toUpperCase() + w.slice(1);
const hoursWords = h => { const v = h / 100; return `${Number.isInteger(v) ? v : String(v)} hour${h === 100 ? "" : "s"}`; };

app.get("/volunteer-hub/roster", requireAuth, wrap(async (req, res) => {
  const { people, year } = await rosterRows(req.user.orgId);
  const total = people.reduce((a, p) => a + p.hundredthsThisYear, 0);
  const givers = people.filter(p => p.alsoGives).length;
  const parts = [`${cap(spell(people.length))} ${people.length === 1 ? "volunteer" : "volunteers"} on the roster`];
  if (total) parts.push(`${hoursWords(total)} given so far in ${year}`);
  if (givers) parts.push(`${spell(givers)} of them also ${givers === 1 ? "gives" : "give"}`);
  res.json({ people, year, hundredthsThisYear: total,
    sentence: people.length ? parts.join(", ") + "."
      : "Nobody is marked as a volunteer yet. Tag someone Volunteer on their record, log a shift, import hours, or share the sign-up link, and they join the roster.",
    definitions: {
      roster: "Everyone whose record carries the Volunteer role, and nobody else.",
      hoursThisYear: `Hours from shifts dated ${year}-01-01 or later, in your organization's time zone.`,
      hours: HOURS_DEFINITION,
      lastShift: "The date of the most recent shift logged for this person.",
      alsoGives: "Yes when at least one gift is on this person's record.",
    } });
}));

app.get("/volunteer-hub/givers", requireAuth, wrap(async (req, res) => {
  const { people } = await rosterRows(req.user.orgId, { onlyGivers: true });
  people.sort((a, b) => b.lifetimeGiving - a.lifetimeGiving || String(a.name).localeCompare(String(b.name)));
  res.json({ people,
    sentence: people.length
      ? `${cap(spell(people.length))} ${people.length === 1 ? "volunteer also gives" : "volunteers also give"}. Each one is one record: their hours and their giving sit on the same person.`
      : "No volunteer has given yet. When one does, the gift adds the Donor role to the same record and they appear here.",
    definitions: { lifetimeGiving: "Every gift on this person's record, the same total their giving history shows." } });
}));

app.get("/volunteer-hub/shifts", requireAuth, wrap(async (req, res) => {
  const limit = Math.max(1, Math.min(200, parseInt(req.query.limit, 10) || 50));
  const rows = await query(
    `SELECT s.id, s.person_id, d.name AS person_name, s.date, s.hours, s.role, s.via,
            COALESCE(NULLIF(u.name, ''), s.created_by_name) AS created_by_name
       FROM volunteer_shifts s JOIN donors d ON d.id = s.person_id AND d.org_id = s.org_id AND d.deleted_at IS NULL
       LEFT JOIN users u ON u.id = s.created_by AND u.org_id = s.org_id
      WHERE s.org_id = ? ORDER BY s.date DESC, s.created_at DESC, s.id LIMIT ?`, [req.user.orgId, limit]);
  res.json({ shifts: rows.map(r => ({ ...r, hours: Number(r.hours) })),
    sentence: `The ${limit} most recent shifts, newest first. "Logged by" is staff, the volunteer from their own link, or an import.` });
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
                              WHERE org_id = ? AND person_id = ? ORDER BY created_at DESC, id LIMIT 200`, [req.user.orgId, p.id]);
  res.json({ notes, sentence: "Notes about volunteering. They stay here: they never appear on the giving record, in Drift, or in anything drafted to this person." });
}));

app.post("/volunteer-hub/notes", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const p = await hubPerson(req.user.orgId, req.body?.personId);
  if (!p) return res.status(404).json({ error: "Not found" });
  if (!p.is_volunteer) return res.status(400).json({ error: "not_a_volunteer", message: `${p.name} is not marked as a volunteer, so there is nowhere on the roster for this note.` });
  const kind = String(req.body?.kind || "");
  if (!NOTE_KINDS.includes(kind)) return res.status(400).json({ error: "bad_kind", message: "Pick training, background check, availability or note." });
  const body = String(req.body?.body || "").trim().slice(0, 2000);
  if (!body) return res.status(400).json({ error: "empty", message: "A note needs words." });
  const nd = String(req.body?.noteDate || "").slice(0, 10);
  const noteDate = /^\d{4}-\d{2}-\d{2}$/.test(nd) ? nd : null;
  const who = actor(req);
  const [me] = await query(`SELECT name FROM users WHERE id=? AND org_id=?`, [req.user.userId, req.user.orgId]);
  const id = "vn_" + uuid().slice(0, 12);
  await run(`INSERT INTO volunteer_notes (id,org_id,person_id,kind,body,note_date,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?)`,
    [id, req.user.orgId, p.id, kind, body, noteDate, who.id, (me && me.name) || who.name]);
  res.status(201).json({ id });
}));

// Removal takes the id in the BODY and, like every delete here, is never
// write-gated (a lapsed org can always take something down).
app.post("/volunteer-hub/notes/delete", requireAuth, wrap(async (req, res) => {
  const { changes } = await run(`DELETE FROM volunteer_notes WHERE id=? AND org_id=?`, [String(req.body?.id || ""), req.user.orgId]);
  if (!changes) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
}));

// ── The sign-up link ───────────────────────────────────────────────────────
// ONE standing link per org: an HMAC over the org id, so the link names its org
// and nobody can point it at another one, and nobody can reach a form for an org
// whose coordinator has not handed the link out. A GET renders and CHANGES
// NOTHING; the form POSTs. Somebody who signs up with an email already on a
// record gains the Volunteer role on THAT record (one person, one record) and
// nothing else on it changes; otherwise a new person is created as a Volunteer.
function signupToken(orgId) {
  const sig = crypto.createHmac("sha256", process.env.JWT_SECRET || "").update("volunteer-signup:" + orgId).digest("base64url");
  return Buffer.from(orgId).toString("base64url") + "." + sig;
}
function verifySignupToken(token) {
  const [b, sig] = String(token || "").split(".");
  if (!b || !sig) return null;
  let orgId; try { orgId = Buffer.from(b, "base64url").toString(); } catch { return null; }
  const want = signupToken(orgId).split(".")[1];
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  return orgId || null;
}
const SIGNUP_ACTOR = { id: "system:volunteer-signup", name: "The volunteer, from the sign-up link" };

app.get("/volunteer-hub/signup-link", requireAuth, wrap(async (req, res) => {
  res.json({ url: `${publicAppUrl()}/volunteer/join?token=${signupToken(req.user.orgId)}`,
    sentence: "Anyone with this link can add themselves to your roster as a Volunteer. Steward does not send it; you share it where your volunteers will see it." });
}));

app.get("/volunteer/join", donateLimiter, wrap(async (req, res) => {
  const orgId = verifySignupToken(req.query.token);
  const [o] = orgId ? await query("SELECT id, name FROM orgs WHERE id=?", [orgId]) : [];
  if (!o) return res.status(404).send(volunteerPage("Link not valid", "<p>This sign-up link is not valid. Ask the organisation for its current link.</p>"));
  const orgName = await donorFacingOrgName(o.id, o.name).catch(() => o.name);
  const inp = "width:100%;box-sizing:border-box;border:1px solid #e8e4db;border-radius:8px;padding:10px;font-size:15px;margin:4px 0 12px";
  res.setHeader("Cache-Control", "no-store");
  res.send(volunteerPage(`Volunteer with ${orgName}`, `
    <div style="font-size:13px;color:#5a554f">${escapeHtml(orgName)}</div>
    <h1 style="font-family:Georgia,serif;font-weight:400;font-size:24px;margin:6px 0 16px">Volunteer with us</h1>
    <form method="post" action="/volunteer/join">
      <input type="hidden" name="token" value="${escapeHtml(String(req.query.token))}">
      <div style="position:absolute;left:-9999px" aria-hidden="true"><label>Leave this empty<input name="website" tabindex="-1" autocomplete="off"></label></div>
      <label>Your name<input name="name" required maxlength="200" style="${inp}"></label>
      <label>Email<input name="email" type="email" required maxlength="200" style="${inp}"></label>
      <label>Phone (optional)<input name="phone" maxlength="40" style="${inp}"></label>
      <label>When you can help, and what you would like to do (optional)<textarea name="availability" maxlength="1000" rows="3" style="${inp}"></textarea></label>
      <button type="submit" style="background:#0d5c3a;color:#fff;border:none;border-radius:10px;padding:12px 18px;font-size:15px;font-weight:700">Sign me up</button>
    </form>`));
}));

app.post("/volunteer/join", donateLimiter, express.urlencoded({ extended: false }), wrap(async (req, res) => {
  const orgId = verifySignupToken(req.body?.token);
  const [o] = orgId ? await query("SELECT id, name FROM orgs WHERE id=?", [orgId]) : [];
  if (!o) return res.status(404).send(volunteerPage("Link not valid", "<p>This sign-up link is not valid.</p>"));
  const thanks = volunteerPage("Thank you", `<h1 style="font-family:Georgia,serif;font-weight:400;font-size:24px">Thank you.</h1><p>You are on the volunteer roster. Someone from the organisation will be in touch.</p>`);
  if (String(req.body?.website || "").trim()) return res.send(thanks); // the honeypot: a bot is thanked and nothing is written
  const name = String(req.body?.name || "").trim().slice(0, 200);
  const email = String(req.body?.email || "").trim().toLowerCase().slice(0, 200);
  const phone = String(req.body?.phone || "").trim().slice(0, 40);
  const availability = String(req.body?.availability || "").trim().slice(0, 1000);
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).send(volunteerPage("Check the form", `<p>Please give your name and an email address.</p><p><a href="/volunteer/join?token=${encodeURIComponent(req.body.token)}">Go back</a></p>`));
  const m = await query("SELECT id FROM donors WHERE org_id=? AND deleted_at IS NULL AND LOWER(email)=? LIMIT 2", [o.id, email]);
  let pid;
  if (m.length === 1) {
    pid = m[0].id;
    await markVolunteer(o.id, pid);
  } else {
    pid = "d_" + uuid().slice(0, 10);
    await run(`INSERT INTO donors (id,org_id,name,email,phone,stage,status,tags,person_types,created_by,created_by_name)
               VALUES (?,?,?,?,?,'prospect','active','[]','["volunteer"]'::jsonb,?,?)`,
      [pid, o.id, name, email, phone || null, SIGNUP_ACTOR.id, SIGNUP_ACTOR.name]);
  }
  // What they said about when and how they can help is for the coordinator:
  // an internal availability note, never an interaction.
  if (availability)
    await run(`INSERT INTO volunteer_notes (id,org_id,person_id,kind,body,note_date,created_by,created_by_name) VALUES (?,?,?,'availability',?,?,?,?)`,
      ["vn_" + uuid().slice(0, 12), o.id, pid, availability, orgToday(await orgTz(o.id)), SIGNUP_ACTOR.id, SIGNUP_ACTOR.name]); // ORG_TZ_SEAM_OK
  res.send(thanks);
}));
}

module.exports = { routers, mount };
