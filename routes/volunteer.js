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
  volunteerSummary, wrap,
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
}

module.exports = { routers, mount };
