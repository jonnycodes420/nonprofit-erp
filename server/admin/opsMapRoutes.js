// DEVBOARD-2 · /ops's Map tab and Jonathan's own checks (super-admins only).
//
//   GET  /ops/map               every area, its checks, each check's last walk
//                               result and last mark, its open board items, and
//                               the "Open in demo" links
//   POST /ops/checks            { area, check, verdict: pass|fail, note, shot? }
//                               A Fail opens a board item (source "jonathan");
//                               a Pass verifies the open one on that check.
//   GET  /ops/checks/:id/shot   a Fail's screenshot
//
// Every route is behind the same door as GET /ops: 404 to anyone who is not a
// live super-admin (and to a support session). ops_checks is append-only to
// this code (an item's state is derived from its rows, opsMap.itemsFromChecks)
// and holds no org's data: it names an area and a check of the demo, never a
// customer. Demo people are looked up in the demo org alone.
"use strict";
const crypto = require("crypto");
const BOARD = require("./board");
const MAP = require("./opsMap");

const SHOT_MAX = 2_500_000;                             // characters of the data URL (~1.8 MB image)
const SHOT_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

function ensureTable(run) {
  if (!ensureTable.p) ensureTable.p = run(`CREATE TABLE IF NOT EXISTS ops_checks (
      id TEXT PRIMARY KEY, seq BIGSERIAL, area_id TEXT NOT NULL, check_id TEXT NOT NULL,
      verdict TEXT NOT NULL CHECK (verdict IN ('pass','fail')), note TEXT, shot TEXT,
      created_at TIMESTAMPTZ NOT NULL, created_by TEXT NOT NULL, created_by_name TEXT NOT NULL)`, [])
    .catch(e => { ensureTable.p = null; throw e; });
  return ensureTable.p;
}
// A read never makes the table (a GET changes nothing): before the first
// boot has made it, there are simply no checks.
async function readChecks(query) {
  return query(`SELECT id, seq, area_id, check_id, verdict, note, (shot IS NOT NULL) AS has_shot, created_at, created_by_name
                FROM ops_checks ORDER BY seq`, [])
    .catch(e => { if (e && (e.code === "42P01" || /ops_checks.*does not exist/.test(e.message))) return []; throw e; });
}
// Demo people by name, in the demo org only. Anything not found there gets no id.
async function demoPeople(query, names) {
  if (!names.length || MAP.NEVER.includes(MAP.DEMO_ORG)) return {};
  const rows = await query(`SELECT d.id, d.name FROM donors d JOIN orgs o ON o.id = d.org_id
      WHERE d.org_id = ? AND o.is_demo_org = true AND d.deleted_at IS NULL AND d.name = ANY(?)
      ORDER BY d.id`, [MAP.DEMO_ORG, names]);
  const out = {};
  for (const r of rows) if (!out[r.name]) out[r.name] = r.id;
  return out;
}

function mount(app, { query, run, wrap, opsOnly, opsLimiter }) {
  // Additive schema: the table is made at boot (and again, idempotently, before a write).
  setImmediate(() => ensureTable(run).catch(e => console.warn(`[ops] ops_checks could not be made yet: ${e.message}`)));
  app.get("/ops/map", opsLimiter, opsOnly, wrap(async (req, res) => {
    let map, board;
    try { map = MAP.readMap(); } catch (e) { return res.json({ ok: false, error: `The map file could not be read: ${e.message}` }); }
    try { board = BOARD.readBoard(); } catch (e) { board = { items: [], walks: [], results: {}, error: e.message }; }
    const rows = await readChecks(query);
    const names = [...new Set(map.areas.flatMap(a => (a.checks || []).map(c => c.person).filter(Boolean)))];
    const people = await demoPeople(query, names).catch(() => ({}));
    const areas = MAP.buildMap(map, board, rows, people);
    res.json({ ok: true, areas, boardError: board.error || null,
      lastWalk: board.walks.length ? board.walks[board.walks.length - 1].date : null,
      demo: { org: MAP.DEMO_ORG, signIn: MAP.DEMO_DIRECTOR, missing: names.filter(n => !people[n]) } });
  }));

  app.post("/ops/checks", opsLimiter, opsOnly, wrap(async (req, res) => {
    const b = req.body || {};
    const map = MAP.readMap();
    const area = map.areas.find(a => a.id === b.area);
    const check = area && (area.checks || []).find(c => c.id === b.check);
    // A walk check the map does not name can be marked too, in its own area.
    const walkCheck = area && !check && typeof b.check === "string" && /^[A-Za-z]+[-.]?\d+[a-z]?$/.test(b.check)
      && (area.prefixes || []).some(p => MAP.norm(p) === MAP.norm(MAP.lettersOf(b.check)));
    if (!area || (!check && !walkCheck)) return res.status(400).json({ error: "unknown_check", message: "That check is not on the map." });
    const verdict = b.verdict === "pass" || b.verdict === "fail" ? b.verdict : null;
    if (!verdict) return res.status(400).json({ error: "bad_verdict", message: "A check is marked pass or fail." });
    const note = String(b.note || "").replace(/\s+/g, " ").trim().slice(0, 500);
    if (verdict === "fail" && !note) return res.status(400).json({ error: "note_required", message: "Say in one line what went wrong." });
    let shot = null;
    if (verdict === "fail" && b.shot) {
      if (typeof b.shot !== "string" || b.shot.length > SHOT_MAX || !SHOT_RE.test(b.shot))
        return res.status(400).json({ error: "bad_shot", message: "The screenshot must be a PNG, JPEG or WebP under about 1.8 MB." });
      shot = b.shot;
    }
    await ensureTable(run);
    const k = MAP.norm(b.check);
    const openBefore = MAP.itemsFromChecks(await readChecks(query)).find(i => MAP.norm(i.check) === k && i.state === "open") || null;
    const id = "opc_" + crypto.randomBytes(9).toString("hex");
    const name = String(req.user.name || req.user.email || "super-admin").slice(0, 120);
    await run(`INSERT INTO ops_checks (id, area_id, check_id, verdict, note, shot, created_at, created_by, created_by_name)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, area.id, b.check, verdict, note || null, shot, new Date().toISOString(), req.user.userId, name]);
    if (req.audit) { req.audit.entity("ops_check", id, `${b.check} ${verdict}`); req.audit.label(`/ops check ${b.check}: ${verdict}`); }
    let item = null;
    if (verdict === "pass") item = openBefore ? { id: openBefore.id, state: "verified" } : null;
    else {
      const now = MAP.itemsFromChecks(await readChecks(query)).find(i => MAP.norm(i.check) === k && i.state === "open");
      item = now ? { id: now.id, state: now.state, joined: !!openBefore } : null;
    }
    res.status(201).json({ id, verdict, item });
  }));

  app.get("/ops/checks/:id/shot", opsLimiter, opsOnly, wrap(async (req, res) => {
    const [row] = await query(`SELECT shot FROM ops_checks WHERE id = ?`, [String(req.params.id)]).catch(() => []);
    const m = row && row.shot && /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(row.shot);
    if (!m) return res.status(404).json({ error: "not_found" });
    res.set("Content-Type", m[1]).set("Cache-Control", "private, max-age=3600").set("X-Content-Type-Options", "nosniff");
    res.send(Buffer.from(m[2], "base64"));
  }));
}

module.exports = { mount, readChecks, demoPeople, ensureTable };
