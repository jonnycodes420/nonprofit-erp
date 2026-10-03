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
  volunteerSummary, wrap, markVolunteer, publicAppUrl, writeAuditLog, maybeStartJourneyFromServer,
  makeVolunteer, volunteerRecordSentence, checkVolunteerFields,
} = ctx;
// server.js loads these ESM modules at boot and sets its own binding when each
// arrives; the code below reads them only after awaiting the same promise, so
// this module keeps its own binding, set from that promise the same way.
let VH = null;
VH_READY.then(m => { VH = m; });
// The one name for the role that may not see giving. Declared here, above
// every line that reads it (the TDZ rule), because two of them are now in
// different halves of this file and a security constant may not exist twice.
const COORD = "volunteer_coordinator";
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

// PARITY-3 — change a logged shift: its date, its hours (as hours, hours and
// minutes, or a start and end time), its opportunity and its note. The audit
// write records before and after; nothing here writes an audit row itself.
app.patch("/volunteer-shifts/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [cur] = await query("SELECT * FROM volunteer_shifts WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!cur) return res.status(404).json({ error: "Not found" });
  const VHm = await import("../shared/volunteerHours.js");
  const b = req.body || {};
  let opp = null;
  if (b.opportunityId) {
    [opp] = await query("SELECT id, name FROM volunteer_opportunities WHERE id=? AND org_id=?", [String(b.opportunityId), orgId]);
    if (!opp) return res.status(404).json({ error: "That opportunity is not one of yours." });
  }
  const timed = b.startTime !== undefined || b.endTime !== undefined || b.minutes !== undefined || b.hours !== undefined;
  const v = VHm.validateShift({
    date: b.date !== undefined ? b.date : cur.date,
    ...(timed ? { hours: b.hours, minutes: b.minutes, startTime: b.startTime, endTime: b.endTime } : { hours: cur.hours }),
    role: opp ? opp.name : cur.role, note: b.note !== undefined ? b.note : cur.note,
  });
  if (!v.ok) return res.status(400).json({ error: `A shift needs ${v.errors.join("; ")}.` });
  if (req.audit) req.audit.before({ date: cur.date, hours: Number(cur.hours), opportunityId: cur.opportunity_id, note: cur.note });
  await run(`UPDATE volunteer_shifts SET date=?, hours=?, role=?, note=?, opportunity_id=?, start_time=?, end_time=?, updated_at=NOW()
              WHERE id=? AND org_id=?`,
    [v.shift.date, v.shift.hundredths / 100, v.shift.role, v.shift.note,
     b.opportunityId !== undefined ? (opp ? opp.id : null) : cur.opportunity_id,
     timed ? v.shift.startTime : cur.start_time, timed ? v.shift.endTime : cur.end_time, cur.id, orgId]);
  if (req.audit) req.audit.after({ date: v.shift.date, hours: v.shift.hundredths / 100, opportunityId: b.opportunityId !== undefined ? (opp ? opp.id : null) : cur.opportunity_id, note: v.shift.note });
  res.json({ ok: true, hours: v.shift.hundredths / 100 });
}));

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
    // VOL-1 — a SignUpGenius export is a SIGN-UP sheet: one row per person
    // per slot, with a start and an end and often no hours column at all.
    // The times become the hours when, and only when, the row does not
    // carry a number of its own. The server re-derives it rather than
    // trusting the browser, because this is the number a grant report is
    // built from.
    const withHours = (r && (r.hours === undefined || r.hours === null || String(r.hours).trim() === ""))
      && (r.startTime || r.endTime)
      ? { ...r, hours: (VH.hoursFromTimes(r.startTime, r.endTime) ?? 0) / 100 }
      : r;
    const v = VH.validateShift(withHours);
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

// ═══════════════════════════════════════════════════════════════════════════
//  VOL-2 · IMPORT VOLUNTEERS, NOT ONLY HOURS
// ═══════════════════════════════════════════════════════════════════════════
//
// The hours import above reads one column family. This reads the file a
// coordinator actually has when she leaves her old system: PEOPLE, their
// CONTACT DETAILS, their HOURS HISTORY, and the two dated things that decide
// whether they may work at all. Same shape as the donor and grant imports:
// the browser parses the file with the one parser, the SERVER decides
// everything, preview writes nothing, and the import is undoable.
//
// NOBODY WHO ARRIVES THIS WAY IS A DONOR. Every person created here gets
// person_types ["volunteer"] and nothing else: no stage that implies a gift,
// no donor tag, no gift. They have not given, and the record must not imply it.
let VI = null;
const VI_READY = import("../shared/volunteerImport.js").then(m => { VI = m; return m; });

// ── VOL-2 item 1 · ADD ONE VOLUNTEER, BY HAND ────────────────────────────
// The other half of "actions up front". A coordinator with one new person in
// front of her should not have to build a spreadsheet, and she should not have
// to go to Donors and tag somebody either: that is the donor way in, and this
// screen is not for that.
//
// WHAT IT CREATES IS A VOLUNTEER. person_types is ["volunteer"], there is no
// gift, no donor tag and no stage that implies one. If the email is already on
// file it is the SAME PERSON: they gain the Volunteer role on the record they
// already have, which is the one-person-one-record rule, and the answer says
// so rather than quietly doing something different from what was asked.
// FIX-24 Part 1: searching for somebody already on file. Name, email and
// phone only, never giving: a volunteer coordinator uses this screen too.
app.get("/volunteer-hub/people/search", requireAuth, wrap(async (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase().slice(0, 80);
  if (q.length < 2) return res.json({ people: [] });
  const like = "%" + q.replace(/[%_\\]/g, m => "\\" + m) + "%";
  const rows = await query(`SELECT id, name, email, phone, person_types FROM donors
                             WHERE org_id=? AND deleted_at IS NULL AND (LOWER(name) LIKE ? OR LOWER(COALESCE(email,'')) LIKE ?)
                             ORDER BY (LOWER(name) LIKE ?) DESC, name LIMIT 8`, [req.user.orgId, like, like, q + "%"]);
  const types = v => { try { return Array.isArray(v) ? v : JSON.parse(v || "[]"); } catch { return []; } };
  res.json({ people: rows.map(r => ({ id: r.id, name: r.name, email: r.email || "", phone: r.phone || "",
    volunteer: types(r.person_types).includes("volunteer") })) });
}));

// FIX-24 Part 1: "Make a volunteer" from the profile, and Add a volunteer when
// it picked somebody already on file. Both are makeVolunteer (server.js), the
// one function the Agent calls too. The same person, never a second one.
async function makeVolunteerAnswer(req, res, personId) {
  const r = await makeVolunteer(req.user.orgId, personId, req.body || {}, actor(req));
  if (r.error === "not_found") return res.status(404).json({ error: "not_found", message: r.message });
  if (r.error) return res.status(400).json({ error: r.error, message: r.message });
  if (r.created) maybeStartJourneyFromServer(req.user.orgId, r.personId, "new_volunteer", {}).catch(e => console.error("[journey] make volunteer:", e.message));
  if (req.audit) { req.audit.action(r.created ? "made a volunteer" : "updated the volunteer record"); req.audit.entity("donor", r.personId, r.name); }
  res.status(r.created ? 201 : 200).json({ ...r, id: r.personId, linked: true, sentence: volunteerRecordSentence(r) });
}
app.post("/donors/:id/make-volunteer", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  return makeVolunteerAnswer(req, res, String(req.params.id));
}));

app.post("/volunteer-hub/people", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId, who = actor(req);
  const b = req.body || {};
  if (b.personId) return makeVolunteerAnswer(req, res, String(b.personId));
  const name = String(b.name || "").trim().slice(0, 200);
  const email = String(b.email || "").trim().toLowerCase().slice(0, 200);
  const phone = String(b.phone || "").trim().slice(0, 40);
  if (!name && !email) {
    return res.status(400).json({ error: "no_person", message: "A volunteer needs a name, or an email address." });
  }
  if (email) {
    const m = await query("SELECT id, name, total_giving FROM donors WHERE org_id=? AND deleted_at IS NULL AND LOWER(email)=? LIMIT 2", [orgId, email]);
    if (m.length === 1) {
      if (phone) await run("UPDATE donors SET phone=? WHERE id=? AND org_id=? AND COALESCE(phone,'')=''", [phone, m[0].id, orgId]);
      const r = await makeVolunteer(orgId, m[0].id, b, who);
      if (r.error) return res.status(400).json({ error: r.error, message: r.message });
      return res.json({ id: m[0].id, name: m[0].name, created: false, linked: true,
        sentence: `${m[0].name} was already on file, so they keep the one record they have and are now a volunteer on it.` });
    }
  }
  // FIX-24: the record's fields are checked before anybody is made.
  const chk = await checkVolunteerFields(b);
  if (chk.errors.length) return res.status(400).json({ error: "bad_fields", message: chk.errors[0] });
  const id = "d_" + uuid().slice(0, 10);
  await run(
    `INSERT INTO donors (id,org_id,name,email,phone,stage,status,tags,person_types,created_by,created_by_name)
     VALUES (?,?,?,?,?,'prospect','active','[]','["volunteer"]'::jsonb,?,?)`,
    [id, orgId, name || email, email || null, phone || null, who.id, who.name]);
  await makeVolunteer(orgId, id, b, who);   // their volunteer record: on Volunteers from now
  res.status(201).json({ id, name: name || email, created: true, linked: false,
    sentence: `${name || email} is on the roster. Nothing on this record says donor, because they have not given.` });
}));

app.get("/volunteer-hub/import/presets", requireAuth, wrap(async (req, res) => {
  await VI_READY;
  res.json({
    presets: Object.entries(VI.VOLUNTEER_PRESETS).map(([key, p]) => ({
      key, label: p.label, confidence: p.confidence,
    })),
    sentence: "Steward reads the export and tells you what it found before anything is written. "
      + "People are matched by email first, then by name, so a volunteer who already gives is linked to the record they already have.",
    writes: "People, their contact details, hours already worked, and waivers and background checks with their dates.",
    doesNotWrite: "No gifts, and no donor record. Somebody who arrives in this file is a volunteer, and nothing on their record says donor until they give.",
  });
}));

// What the file holds, decided HERE. A POST because the rows travel in the
// body, and it writes NOTHING: no person, no shift, no credential, no import
// row. The same planner runs again at import time, so this screen can never
// talk the server into writing something it did not decide for itself.
app.post("/volunteer-hub/import/preview", requireAuth, wrap(async (req, res) => {
  await VI_READY;
  const b = req.body || {};
  const headers = Array.isArray(b.headers) ? b.headers : [];
  const rows = Array.isArray(b.rows) ? b.rows : [];
  if (!headers.length || !rows.length) {
    return res.status(400).json({ error: "empty_file", message: "There are no rows in that file." });
  }
  const det = VI.detectVolunteerPreset(headers);
  const key = VI.VOLUNTEER_PRESET_KEYS.includes(b.preset) ? b.preset : det.key;
  const map = VI.mapVolunteerColumns(headers, key);
  const today = orgToday(await orgTz(req.user.orgId));               // ORG_TZ_SEAM_OK
  const plan = VI.planVolunteerImport(rows, map, { today });

  // WHO IS ALREADY HERE. Matched by EMAIL FIRST so a volunteer who already
  // gives is linked to the record they already have and never duplicated;
  // by name only when there is exactly one person with that name, because
  // two people called the same thing is a question, not a match.
  const emails = plan.people.map(p => p.email).filter(Boolean);
  const names = plan.people.filter(p => !p.email).map(p => p.name.toLowerCase());
  const byEmail = new Map();
  if (emails.length) {
    for (const r of await query(
      `SELECT id, name, LOWER(email) AS email, total_giving, person_types FROM donors
        WHERE org_id=? AND deleted_at IS NULL AND LOWER(email) = ANY(?)`, [req.user.orgId, emails])) {
      byEmail.set(r.email, r);
    }
  }
  const byName = new Map();
  if (names.length) {
    for (const r of await query(
      `SELECT LOWER(name) AS n, COUNT(*)::int c, MIN(id) AS id, MIN(name) AS name,
              MIN(total_giving) AS total_giving
         FROM donors WHERE org_id=? AND deleted_at IS NULL AND LOWER(name) = ANY(?)
        GROUP BY 1`, [req.user.orgId, names])) {
      if (r.c === 1) byName.set(r.n, r);
    }
  }
  let matched = 0, newPeople = 0, alsoGive = 0;
  const people = plan.people.map(p => {
    const hit = p.email ? byEmail.get(p.email) : byName.get(p.name.toLowerCase());
    if (hit) { matched++; if (Number(hit.total_giving) > 0) alsoGive++; } else newPeople++;
    return {
      name: p.name, email: p.email, phone: p.phone, group: p.group,
      shifts: p.shifts.length, hours: Math.round(p.hundredths) / 100,
      credentials: p.credentials.map(c => `${c.kind === "waiver" ? "Waiver" : "Background check"} signed ${c.signedOn}${c.expiresOn ? `, expires ${c.expiresOn}` : ""}`),
      matchedTo: hit ? { id: hit.id, name: hit.name, by: p.email && byEmail.get(p.email) ? "email" : "name" } : null,
    };
  });

  res.json({
    preset: key, presetLabel: VI.presetLabel(key),
    confidence: (VI.VOLUNTEER_PRESETS[key] || {}).confidence,
    detected: det, mapping: map, headers,
    counts: { ...plan.counts, matched, newPeople, alsoGive },
    sentence: VI.previewSentence(plan.counts, VI.presetLabel(key)),
    matchSentence: matched
      ? `${matched} of them ${matched === 1 ? "is" : "are"} already on file and will be linked to the record they have, never duplicated`
        + `${alsoGive ? `, including ${alsoGive} who already ${alsoGive === 1 ? "gives" : "give"}` : ""}. `
        + `${newPeople} ${newPeople === 1 ? "is" : "are"} new.`
      : `All ${newPeople} ${newPeople === 1 ? "is" : "are"} new to your file.`,
    people: people.slice(0, 500),
    refused: plan.refused.slice(0, 200),
    // Said before the button, in the server's own words.
    writes: "People, contact details, hours already worked, and waivers and background checks with their dates.",
    doesNotWrite: "No gifts. Nobody here becomes a donor, and you can undo the whole import afterwards.",
  });
}));

// The import. Re-plans from the rows rather than trusting the preview, writes
// inside one `imports` row so the undo is exact, and stamps that id on every
// row it creates.
app.post("/volunteer-hub/import", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  await VI_READY;
  await VH_READY;
  const orgId = req.user.orgId, who = actor(req);
  const b = req.body || {};
  const headers = Array.isArray(b.headers) ? b.headers : [];
  const rows = Array.isArray(b.rows) ? b.rows : [];
  if (!headers.length || !rows.length) {
    return res.status(400).json({ error: "empty_file", message: "There are no rows in that file." });
  }
  const key = VI.VOLUNTEER_PRESET_KEYS.includes(b.preset) ? b.preset : VI.detectVolunteerPreset(headers).key;
  const map = VI.mapVolunteerColumns(headers, key);
  const today = orgToday(await orgTz(orgId));                        // ORG_TZ_SEAM_OK
  const plan = VI.planVolunteerImport(rows, map, { today });
  if (!plan.people.length) {
    return res.status(400).json({ error: "nobody_in_file", message: "Nothing in that file could be read as a volunteer. Nothing was written." });
  }

  const importId = "imp_" + uuid().replace(/-/g, "").slice(0, 16);
  await run(
    `INSERT INTO imports (id,org_id,name,source_filename,shape,started_at,rows_in,actor_user_id,actor_user_name,summary_json)
     VALUES (?,?,?,?,'volunteers',NOW(),?,?,?,?::jsonb)`,
    [importId, orgId, `Volunteers from ${VI.presetLabel(key)}`, String(b.filename || "").slice(0, 200) || null,
     plan.counts.rows, who.id, who.name, JSON.stringify({ preset: key, counts: plan.counts })]);

  const out = { importId, peopleCreated: 0, peopleMatched: 0, shifts: 0, shiftsAlreadyThere: 0,
                credentials: 0, refused: plan.refused.slice(0, 200) };
  for (const p of plan.people) {
    // EMAIL FIRST. A volunteer who already gives is one person with two roles,
    // never a second row, and this is the line that makes that true.
    let pid = null;
    if (p.email) {
      const m = await query("SELECT id FROM donors WHERE org_id=? AND deleted_at IS NULL AND LOWER(email)=? LIMIT 2", [orgId, p.email]);
      if (m.length === 1) pid = m[0].id;
    }
    if (!pid && p.name) {
      const m = await query("SELECT id FROM donors WHERE org_id=? AND deleted_at IS NULL AND LOWER(name)=LOWER(?) LIMIT 2", [orgId, p.name]);
      if (m.length === 1) pid = m[0].id;
    }
    if (pid) {
      out.peopleMatched++;
      // Fill a blank phone, never overwrite one: the record already here is
      // the one somebody maintained.
      if (p.phone) await run("UPDATE donors SET phone=? WHERE id=? AND org_id=? AND COALESCE(phone,'')=''", [p.phone, pid, orgId]);
      await markVolunteer(orgId, pid);
    } else {
      pid = "d_" + uuid().slice(0, 10);
      await run(
        `INSERT INTO donors (id,org_id,name,email,phone,stage,status,tags,person_types,volunteer_import_id,created_by,created_by_name)
         VALUES (?,?,?,?,?,'prospect','active','[]','["volunteer"]'::jsonb,?,?,?)`,
        [pid, orgId, p.name || p.email, p.email || null, p.phone || null, importId, who.id, who.name]);
      out.peopleCreated++;
    }

    for (const s of p.shifts) {
      const id = await insertShift(orgId, pid, s, { via: "import", importKey: s.key, who });
      if (id) { out.shifts++; await run("UPDATE volunteer_shifts SET import_id=? WHERE id=?", [importId, id]); }
      else out.shiftsAlreadyThere++;
    }

    for (const c of p.credentials) {
      // The newest signing supersedes the last, exactly as the by-hand route
      // does: a credential is a thing that was true and then was replaced.
      await run(
        `UPDATE volunteer_credentials SET superseded_at=NOW()
          WHERE org_id=? AND person_id=? AND kind=? AND superseded_at IS NULL AND signed_on < ?`,
        [orgId, pid, c.kind, c.signedOn]);
      const [dupe] = await query(
        `SELECT id FROM volunteer_credentials WHERE org_id=? AND person_id=? AND kind=? AND signed_on=? AND superseded_at IS NULL`,
        [orgId, pid, c.kind, c.signedOn]);
      if (dupe) continue;                 // the same signing, imported twice
      await run(
        `INSERT INTO volunteer_credentials (id,org_id,person_id,kind,signed_on,expires_on,import_id,created_by,created_by_name)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        ["vc_" + uuid().slice(0, 12), orgId, pid, c.kind, c.signedOn, c.expiresOn, importId, who.id, who.name]);
      out.credentials++;
    }
  }

  await run(
    `UPDATE imports SET committed_at=NOW(), donors_created=?, rows_errored=?, summary_json=?::jsonb WHERE id=?`,
    [out.peopleCreated, plan.refused.length, JSON.stringify({ preset: key, counts: plan.counts, result: out }), importId]);

  res.status(201).json({
    ...out,
    sentence: `${out.peopleCreated + out.peopleMatched} ${out.peopleCreated + out.peopleMatched === 1 ? "volunteer" : "volunteers"} imported: `
      + `${out.peopleCreated} added, ${out.peopleMatched} linked to a record already here. `
      + `${out.shifts} ${out.shifts === 1 ? "shift" : "shifts"}${out.shiftsAlreadyThere ? ` (${out.shiftsAlreadyThere} were already here)` : ""}`
      + `${out.credentials ? `, ${out.credentials} ${out.credentials === 1 ? "waiver or check" : "waivers and checks"}` : ""}.`,
    undoSentence: "Undo removes the people this file added and the hours and checks it wrote. Anyone who was already here stays.",
  });
}));

// THE UNDO. Exact, by import id, and it never removes somebody who was here
// before the file arrived: only people this import CREATED, and only those who
// have nothing else on them. Anyone who gave, or who has a shift or a sign-up
// this import did not write, is KEPT and named in the answer.
app.post("/volunteer-hub/import/:id/undo", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [imp] = await query(
    "SELECT * FROM imports WHERE id=? AND org_id=? AND shape='volunteers'", [req.params.id, orgId]);
  if (!imp) return res.status(404).json({ error: "Not found", message: "There is no volunteer import by that id." });
  // INT-BUILD-1 0e — an admin, or the person who ran it. Nobody else.
  if (imp.actor_user_id !== req.user.userId) {
    const [me] = await query("SELECT role FROM users WHERE id=? AND org_id=?", [req.user.userId, orgId]);
    if (!(me && me.role === "admin"))
      return res.status(403).json({ error: "not_yours", message: "Only an admin, or the person who ran this import, can undo it." });
  }

  const shifts = await run("DELETE FROM volunteer_shifts WHERE org_id=? AND import_id=?", [orgId, req.params.id]);
  const creds = await run("DELETE FROM volunteer_credentials WHERE org_id=? AND import_id=?", [orgId, req.params.id]);
  // Only the people it created, and only the ones with nothing else on them.
  const candidates = await query(
    "SELECT id, name FROM donors WHERE org_id=? AND deleted_at IS NULL AND volunteer_import_id=?", [orgId, req.params.id]);
  let removed = 0; const kept = [];
  for (const c of candidates) {
    const [busy] = await query(
      `SELECT (SELECT COUNT(*) FROM gifts WHERE org_id=? AND donor_id=?)::int gifts,
              (SELECT COUNT(*) FROM volunteer_shifts WHERE org_id=? AND person_id=?)::int shifts,
              (SELECT COUNT(*) FROM volunteer_signups WHERE org_id=? AND person_id=? AND status <> 'cancelled')::int signups`,
      [orgId, c.id, orgId, c.id, orgId, c.id]);
    if (Number(busy.gifts) || Number(busy.shifts) || Number(busy.signups)) {
      kept.push({ id: c.id, name: c.name,
        reason: Number(busy.gifts) ? "they have given since" : "they have hours or a shift that this file did not write" });
      continue;
    }
    // Trashed, not hard-deleted: the same door every other person removal uses.
    await run("UPDATE donors SET deleted_at=NOW() WHERE id=? AND org_id=?", [c.id, orgId]);
    removed++;
  }
  await run("UPDATE imports SET summary_json = COALESCE(summary_json,'{}'::jsonb) || ?::jsonb WHERE id=?",
    [JSON.stringify({ undoneAt: new Date().toISOString(), removed, kept: kept.length }), req.params.id]);

  res.json({
    importId: req.params.id, removed, shifts: shifts.changes || 0, credentials: creds.changes || 0, kept,
    sentence: `Undone. ${removed} ${removed === 1 ? "person" : "people"} removed, `
      + `${shifts.changes || 0} ${(shifts.changes || 0) === 1 ? "shift" : "shifts"} and `
      + `${creds.changes || 0} ${(creds.changes || 0) === 1 ? "waiver or check" : "waivers and checks"} taken back.`
      + (kept.length ? ` ${kept.length} ${kept.length === 1 ? "person was" : "people were"} kept because they have something on their record now.` : ""),
  });
}));

// ── VOL-2 item 4 · ONE PERSON, THE VOLUNTEER VIEW FIRST ──────────────────
// Everything the coordinator needs about somebody in one read: what they have
// given in hours, what they are signed up for next, whether their waiver and
// check are good, and which groups they come with.
//
// GIVING IS THE LAST FIELD AND IT IS CONDITIONAL. It is present only when the
// person has actually given, and NEVER for the volunteer coordinator role,
// which is a security boundary decided in auth.js and re-decided here rather
// than assumed: a role that must not see giving must not receive it in a
// payload either, whatever the screen chooses to draw.
app.get("/volunteer-hub/person/:id", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [p] = await query(
    `SELECT id, name, email, phone, person_types, total_giving, gift_count, last_gift_date
       FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL`, [req.params.id, orgId]);
  if (!p) return res.status(404).json({ error: "Not found" });
  const today = orgToday(await orgTz(orgId));                        // ORG_TZ_SEAM_OK

  const summary = await volunteerSummary(orgId, p.id);
  const shifts = await query(
    `SELECT id, date, hours, role, via FROM volunteer_shifts
      WHERE org_id=? AND person_id=? ORDER BY date DESC LIMIT 25`, [orgId, p.id]);
  const upcoming = await query(
    `SELECT su.id, su.status, su.position, s.date, s.start_time, s.end_time, o.name AS opportunity, o.location
       FROM volunteer_signups su
       JOIN volunteer_slots s ON s.id=su.slot_id
       JOIN volunteer_opportunities o ON o.id=s.opportunity_id
      WHERE su.org_id=? AND su.person_id=? AND su.status <> 'cancelled'
        AND s.cancelled_at IS NULL AND s.date >= ?
      ORDER BY s.date, s.start_time LIMIT 20`, [orgId, p.id, today]);
  const credentials = await query(
    `SELECT id, kind, signed_on, expires_on FROM volunteer_credentials
      WHERE org_id=? AND person_id=? AND superseded_at IS NULL ORDER BY kind`, [orgId, p.id]);
  const groups = await query(
    `SELECT DISTINCT g.id, g.name, g.kind FROM volunteer_signups su
       JOIN volunteer_groups g ON g.id=su.group_id
      WHERE su.org_id=? AND su.person_id=? AND su.group_id IS NOT NULL ORDER BY g.name`, [orgId, p.id]);

  const coordinator = req.user.role === COORD;
  const gave = Number(p.total_giving) > 0;
  // FIX-9 Part D.1 — "Volunteer since 2023". The earliest shift on file is the
  // honest answer: a person's donors row does not know when they started
  // volunteering, and the first shift is the first time anybody recorded them
  // doing it. Null when they have never been on one, and the header then just
  // says "Volunteer".
  const [firstShift] = await query(
    `SELECT MIN(date)::text AS since FROM volunteer_shifts WHERE org_id=? AND person_id=?`, [orgId, p.id]);
  res.json({
    id: p.id, name: p.name, email: p.email, phone: p.phone,
    since: (firstShift && firstShift.since) || null,
    personTypes: p.person_types || [],
    hours: { ...summary, sentence: summary.shiftCount
      ? `${summary.totalHours} hours across ${summary.shiftCount} ${summary.shiftCount === 1 ? "shift" : "shifts"}`
        + `${summary.lastShift ? `, the last on ${summary.lastShift}` : ""}.`
      : "No hours logged yet." },
    shifts, upcoming, credentials, groups,
    upcomingSentence: upcoming.length
      ? `${upcoming.length} ${upcoming.length === 1 ? "shift" : "shifts"} coming up.`
      : "Nothing on the schedule yet.",
    // The one conditional block. Absent means absent: there is no key to read.
    giving: coordinator || !gave ? null : {
      total: Number(p.total_giving), gifts: Number(p.gift_count) || 0, lastGift: p.last_gift_date,
      sentence: "They give as well as volunteer. Their giving is defined on their record, where it belongs.",
    },
    givingHidden: coordinator ? "A volunteer coordinator does not see giving, here or anywhere." : null,
  });
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
     convertPotential || "medium", orgToday(await orgTz(req.user.orgId)), actor(req).id, actor(req).name]   // ORG_TZ_SEAM_OK (FIX-14 Part 2b)
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
    const dueDate = orgToday(await orgTz(orgId), new Date(Date.now() + 7*24*60*60*1000));   // ORG_TZ_SEAM_OK (FIX-14 Part 2b)
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

// VOL-1 — A COORDINATOR DOES NOT SEE GIVING. The allowlist in auth.js lets
// this role reach the roster; this is the other half of the same boundary,
// because a roster that carries `lifetimeGiving` would hand over exactly
// what the allowlist refused. One helper, used by every hub read.
// VOL-2 — `COORD` itself moved to the const block under the destructure, so
// the person route above can read the SAME constant instead of carrying a
// second copy of a security-relevant string.
const stripGiving = (req, people) => req.user.role !== COORD ? people
  : people.map(({ lifetimeGiving, lastGiftDate, alsoGives, ...rest }) => rest);

app.get("/volunteer-hub/roster", requireAuth, wrap(async (req, res) => {
  const { people, year } = await rosterRows(req.user.orgId);
  const total = people.reduce((a, p) => a + p.hundredthsThisYear, 0);
  const givers = people.filter(p => p.alsoGives).length;
  const parts = [`${cap(spell(people.length))} ${people.length === 1 ? "volunteer" : "volunteers"} on the roster`];
  if (total) parts.push(`${hoursWords(total)} given so far in ${year}`);
  // "…and three of them also give" is a COUNT OF DONORS. It belongs on this
  // sentence for an admin and not on a coordinator's screen, where the whole
  // point of the role is that giving is not theirs to see. The walk caught
  // this: the rows were stripped and the summary of the rows was not.
  if (givers && req.user.role !== COORD) parts.push(`${spell(givers)} of them also ${givers === 1 ? "gives" : "give"}`);
  res.json({ people: stripGiving(req, people), year, hundredthsThisYear: total,
    sentence: people.length ? parts.join(", ") + "."
      : "Nobody is marked as a volunteer yet. Tag someone Volunteer on their record, log a shift, import hours, or share the sign-up link, and they join the roster.",
    definitions: {
      roster: "Everyone whose record carries the Volunteer role, and nobody else.",
      hoursThisYear: `Hours from shifts dated ${year}-01-01 or later, in your organization's time zone.`,
      hours: HOURS_DEFINITION,
      lastShift: "The date of the most recent shift logged for this person.",
      ...(req.user.role === COORD ? {} : { alsoGives: "Yes when at least one gift is on this person's record." }),
    } });
}));

// ── PARITY-3 Part 3 · THE VOLUNTEER LIST, ITS FILTERS AND ITS BULK ACTIONS ──
// The list is the donor list's own filter (groups.js buildDonorFilter) with
// the volunteer rules, so the screen, its CSV and a Group saved from it are
// the same rows. Giving is a column and a filter for staff; a volunteer
// coordinator gets neither, and a giving filter from one is refused here,
// because the role is the boundary and the screen is only a courtesy.
const GR = require("../groups");
const GIVING_RULES = ["given", "gaveFrom", "gaveTo", "level", "lifecycle", "retained"];
const LIST_RULES = ["search", "volActive", "volOpp", "volShiftFrom", "volShiftTo", "volHoursMin", "volHoursMax", "volHoursFrom", "volHoursTo",
  "volQual", "volAnswer", "volAvail", ...GIVING_RULES];

async function volunteerList(req) {
  const orgId = req.user.orgId, q = req.query || {};
  const coord = req.user.role === COORD;
  const rules = { role: "volunteer" };
  for (const k of LIST_RULES) if (q[k] !== undefined && q[k] !== "") rules[k] = String(q[k]);
  if (coord && GIVING_RULES.some(k => rules[k])) return { refused: true };
  const f = await GR.buildDonorFilter(orgId, rules);
  if (f.badRole || f.badStatus) return { bad: true };
  const D = /^\d{4}-\d{2}-\d{2}$/;
  const today = orgToday(await orgTz(orgId));                      // ORG_TZ_SEAM_OK
  const hFrom = D.test(String(q.hoursFrom || "")) ? String(q.hoursFrom) : today.slice(0, 4) + "-01-01";
  const hTo = D.test(String(q.hoursTo || "")) ? String(q.hoursTo) : today;
  const rows = await query(
    `SELECT donors.id, donors.name, donors.email, donors.phone, donors.total_giving, donors.last_gift_date,
            (SELECT COALESCE(SUM(ROUND(vx.hours*100)),0) FROM volunteer_shifts vx WHERE vx.org_id=donors.org_id AND vx.person_id=donors.id)::bigint AS life_h,
            (SELECT COALESCE(SUM(ROUND(vx.hours*100)),0) FROM volunteer_shifts vx WHERE vx.org_id=donors.org_id AND vx.person_id=donors.id AND vx.date >= ? AND vx.date <= ?)::bigint AS range_h,
            (SELECT MAX(vx.date) FROM volunteer_shifts vx WHERE vx.org_id=donors.org_id AND vx.person_id=donors.id) AS last_served,
            (SELECT MIN(lx.date) FROM volunteer_signups sx JOIN volunteer_slots lx ON lx.id=sx.slot_id AND lx.cancelled_at IS NULL
              WHERE sx.org_id=donors.org_id AND sx.person_id=donors.id AND sx.status='confirmed' AND lx.date >= ?) AS next_shift,
            (SELECT string_agg(qx.name, ', ' ORDER BY qx.kind, lower(qx.name)) FROM volunteer_qualifications qx WHERE qx.org_id=donors.org_id AND qx.person_id=donors.id) AS quals,
            (SELECT COUNT(*) FROM gifts gx WHERE gx.org_id=donors.org_id AND gx.donor_id=donors.id AND gx.amount > 0)::int AS gift_count
       FROM donors WHERE ${f.whereSql} ORDER BY lower(donors.name), donors.id LIMIT 2000`,
    [hFrom, hTo, today, ...f.params]);
  return { hFrom, hTo, today, coord, rules,
    rows: rows.map(r => ({ id: r.id, name: r.name, email: r.email || "", phone: r.phone || "",
      lifetimeHours: Number(r.life_h) / 100, rangeHours: Number(r.range_h) / 100,
      lastServed: r.last_served || null, nextShift: r.next_shift || null, qualifications: r.quals || "",
      ...(coord ? {} : { lifetimeGiving: Number(r.total_giving || 0), lastGiftDate: r.last_gift_date || null, gifts: r.gift_count }) })) };
}

app.get("/volunteer-hub/list", requireAuth, wrap(async (req, res) => {
  const out = await volunteerList(req);
  if (out.refused) return res.status(403).json({ error: "giving_hidden", message: "Giving is not part of the volunteer coordinator's role, so it cannot be a filter here." });
  if (out.bad) return res.status(400).json({ error: "bad_filter", message: "One of those filters is not one Steward understands." });
  res.json({ ...out, sentence: `${out.rows.length} ${out.rows.length === 1 ? "volunteer matches" : "volunteers match"}.`,
    definitions: {
      lifetimeHours: "Every volunteer shift logged for this person, added up.",
      rangeHours: `Hours from shifts dated ${out.hFrom} to ${out.hTo}.`,
      lastServed: "The most recent shift logged for them.", nextShift: "The next shift they have a place on.",
      ...(out.coord ? {} : { lifetimeGiving: "Every gift on their record, net of refunds.", gifts: "How many gifts they have given." }),
    } });
}));

// The volunteers a request names, kept to this org's own.
async function ownPeople(orgId, raw) {
  const ids = [...new Set((Array.isArray(raw) ? raw : []).map(String).filter(Boolean))].slice(0, 2000);
  if (!ids.length) return [];
  return query(`SELECT id, name, email FROM donors WHERE org_id=? AND deleted_at IS NULL AND id = ANY(?::text[])`, [orgId, ids]);
}

// Draft an email to the people selected: one DRAFT each, in To send. Staff send.
app.post("/volunteer-hub/bulk/draft", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId, who = actor(req);
  const subject = String(req.body?.subject || "").trim().slice(0, 200), body = String(req.body?.body || "").trim().slice(0, 8000);
  if (!subject || !body) return res.status(400).json({ error: "A message needs a subject and some words." });
  const people = await ownPeople(orgId, req.body?.personIds);
  const batch = uuid().slice(0, 8);
  let drafted = 0, noEmail = 0;
  for (const p of people) {
    if (!p.email) { noEmail++; continue; }
    const first = String(p.name || "").split(/\s+/)[0] || "there";
    await run(`INSERT INTO milestone_drafts (id,org_id,donor_id,milestone_key,subject,body,status,source,created_by,created_by_name)
               VALUES (?,?,?,?,?,?,'pending_review','volunteer_message',?,?) ON CONFLICT DO NOTHING`,
      ["md_" + uuid().slice(0, 12), orgId, p.id, `vol:msg:${batch}:${p.id}`, subject, body.replace(/\{\{\s*first_name\s*\}\}/gi, first), who.id, who.name]);
    drafted++;
  }
  res.json({ drafted, message: `${drafted} ${drafted === 1 ? "draft" : "drafts"} written${noEmail ? `; ${noEmail} with no email were left out` : ""}. Nothing is sent until you press Send in Schedule, To send.` });
}));

// Add or remove a tag on the people selected.
app.post("/volunteer-hub/bulk/tag", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId, who = actor(req);
  const name = String(req.body?.name || "").trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: "Name the tag." });
  const people = await ownPeople(orgId, req.body?.personIds);
  let n = 0;
  for (const p of people) {
    if (req.body?.remove === true) n += (await run(`DELETE FROM volunteer_qualifications WHERE org_id=? AND person_id=? AND kind='tag' AND lower(name)=lower(?)`, [orgId, p.id, name])).changes;
    else n += (await query(`INSERT INTO volunteer_qualifications (id,org_id,person_id,kind,name,created_by,created_by_name) VALUES (?,?,?,'tag',?,?,?)
                             ON CONFLICT DO NOTHING RETURNING id`, ["vq_" + uuid().slice(0, 10), orgId, p.id, name, who.id, who.name])).length;
  }
  res.json({ changed: n, message: req.body?.remove === true ? `${name} taken off ${n} ${n === 1 ? "person" : "people"}.` : `${name} added to ${n} ${n === 1 ? "person" : "people"}.` });
}));

// The default Volunteers group: by rule, everyone with a logged hour or an
// approved application. Made the first time somebody opens Volunteers (a
// POST from the screen, never a GET), once per org, and then it is an
// ordinary Group: its page has the PARITY-1 giving figures, which is the
// "volunteers who give" view.
const VOLUNTEERS_GROUP = "Volunteers";
app.post("/volunteer-hub/volunteers-group", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId, who = actor(req);
  const find = () => query(`SELECT id FROM audiences WHERE org_id=? AND kind='dynamic' AND rules->>'volunteer' = '1' AND name=? LIMIT 1`, [orgId, VOLUNTEERS_GROUP]);
  let [g] = await find();
  if (!g && req.user.role !== COORD) {
    await run(`INSERT INTO audiences (id, org_id, name, description, segment, kind, rules, created_by, created_by_name)
               VALUES (?,?,?,?,?::jsonb,'dynamic',?::jsonb,?,?) ON CONFLICT DO NOTHING`,
      ["grp_" + uuid().slice(0, 10), orgId, VOLUNTEERS_GROUP, "Everyone with a logged volunteer hour or an approved application. Kept by Steward.",
       JSON.stringify({ mode: "group" }), JSON.stringify({ volunteer: "1" }), who.id || "system:volunteers-group", who.name || "Steward"]).catch(() => {});
    [g] = await find();
  }
  res.json({ id: g ? g.id : null });
}));

app.get("/volunteer-hub/givers", requireAuth, wrap(async (req, res) => {
  // This view IS giving, so there is nothing to strip: a coordinator is
  // refused it, with the sentence that says why rather than an empty list
  // that would read as "no volunteer has ever given".
  if (req.user.role === COORD) {
    return res.status(403).json({ error: "coordinator_scope",
      message: "Your account covers volunteers and hours. Which volunteers also give is part of giving, and an admin can see it." });
  }
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
  // PARITY-3 — internal unless she says the volunteer may see it.
  const visibility = req.body?.visibility === "volunteer" ? "volunteer" : "internal";
  await run(`INSERT INTO volunteer_notes (id,org_id,person_id,kind,body,note_date,created_by,created_by_name,visibility) VALUES (?,?,?,?,?,?,?,?,?)`,
    [id, req.user.orgId, p.id, kind, body, noteDate, who.id, (me && me.name) || who.name, visibility]);
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
//
// FIX-1 (Jonathan, 27 Sep) — THE LINK CAN BE TAKEN BACK. The org's
// volunteer_link_version is signed in with its id; "make a new link" bumps it,
// so every link made before stops verifying at once, and nothing else moves.
function signupToken(orgId, version) {
  const sig = crypto.createHmac("sha256", process.env.JWT_SECRET || "")
    .update("volunteer-signup:" + orgId + ":v" + (Number(version) || 0)).digest("base64url");
  return Buffer.from(orgId).toString("base64url") + "." + sig;
}
async function linkVersion(orgId) {
  const [o] = await query("SELECT volunteer_link_version AS v FROM orgs WHERE id=?", [orgId]);
  return o ? Number(o.v) || 0 : null;
}
async function verifySignupToken(token) {
  const [b, sig] = String(token || "").split(".");
  if (!b || !sig) return null;
  let orgId; try { orgId = Buffer.from(b, "base64url").toString(); } catch { return null; }
  if (!orgId) return null;
  const version = await linkVersion(orgId);
  if (version === null) return null;
  const want = signupToken(orgId, version).split(".")[1];
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  return orgId;
}
const LINK_SENTENCE = "Anyone with this link can add themselves to your roster as a Volunteer. Steward does not send it; you share it where your volunteers will see it.";
const SIGNUP_ACTOR = { id: "system:volunteer-signup", name: "The volunteer, from the sign-up link" };

app.get("/volunteer-hub/signup-link", requireAuth, wrap(async (req, res) => {
  const version = await linkVersion(req.user.orgId);
  res.json({ url: `${publicAppUrl()}/volunteer/join?token=${signupToken(req.user.orgId, version)}`,
    sentence: LINK_SENTENCE });
}));

// A new link; the old one stops working the moment this answers.
app.post("/volunteer-hub/signup-link/regenerate", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [row] = await query(
    "UPDATE orgs SET volunteer_link_version = COALESCE(volunteer_link_version, 0) + 1 WHERE id=? RETURNING volunteer_link_version AS v",
    [orgId]);
  const version = Number(row && row.v) || 0;
  const a = actor(req);
  await writeAuditLog(orgId, a.id, a.name, "regenerated", "volunteer_signup_link", orgId, { version });
  res.json({ url: `${publicAppUrl()}/volunteer/join?token=${signupToken(orgId, version)}`,
    sentence: "This is your new link. The old one has stopped working: anyone who opens it is told to ask for the current link. " + LINK_SENTENCE });
}));

app.get("/volunteer/join", donateLimiter, wrap(async (req, res) => {
  const orgId = await verifySignupToken(req.query.token);
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
  const orgId = await verifySignupToken(req.body?.token);
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
  // THREAD-2a — the new_volunteer journey trigger. AFTER the response is
  // composed and never in front of it: somebody signing up to help must get
  // their thank-you page whether or not a journey starts behind it.
  maybeStartJourneyFromServer(o.id, pid, "new_volunteer", {})
    .catch(e => console.error("[journey] volunteer trigger:", e.message));
  res.send(thanks);
}));
}

module.exports = { routers, mount };
