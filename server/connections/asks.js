// server/connections/asks.js · HONEST-1 item 4. "NOT AVAILABLE YET. TELL US YOU NEED IT."
//
// Xero and Constant Contact carried full cards with a dead Connect button. They are one line now,
// and its link records the ask here, once per org and provider, for /ops to read (GET /ops,
// `connectionAsks`). Nothing is emailed. The actor is stamped on the row.
//
//   POST /connections/ask   { provider }   admins and staff; a viewer cannot
"use strict";

const PROVIDER_RE = /^[a-z][a-z0-9_]{1,40}$/;

function ensureTable(run) {
  if (!ensureTable.p) ensureTable.p = run(`CREATE TABLE IF NOT EXISTS connection_asks (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, provider TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_by TEXT NOT NULL, created_by_name TEXT NOT NULL,
      UNIQUE (org_id, provider))`, [])
    .catch(e => { ensureTable.p = null; throw e; });
  return ensureTable.p;
}

// What /ops shows: each provider, how many organizations asked, and the latest ask. A read never
// makes the table: before the first ask there is nothing to show.
async function readAsks(query) {
  return query(`SELECT a.provider, COUNT(*)::int AS orgs, MAX(a.created_at) AS last_at,
                       STRING_AGG(o.name, ', ' ORDER BY a.created_at DESC) AS org_names
                  FROM connection_asks a LEFT JOIN orgs o ON o.id = a.org_id
                 GROUP BY a.provider ORDER BY COUNT(*) DESC, MAX(a.created_at) DESC`, [])
    .catch(e => { if (e && (e.code === "42P01" || /connection_asks.*does not exist/.test(e.message))) return []; throw e; });
}

function mount(app, { query, run, wrap, requireAuth, checkWriteAccess, actor }) {
  app.post("/connections/ask", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const provider = String((req.body && req.body.provider) || "").trim().toLowerCase();
    if (!PROVIDER_RE.test(provider)) return res.status(400).json({ error: "bad_provider", sentence: "Steward did not recognize that connection." });
    const O = await import("../../shared/oauth.js");
    const EM = await import("../../shared/emailMarketing.js");
    const BK = await import("../../shared/bookkeeping.js");
    const known = new Set([...O.PROVIDER_KEYS.map(k => O.vendorKeyOf(k)), ...EM.PROVIDER_KEYS, ...BK.VENDOR_KEYS]);
    if (!known.has(provider)) return res.status(400).json({ error: "bad_provider", sentence: "Steward did not recognize that connection." });
    await ensureTable(run);
    const { newId } = require("../shared/newId");
    const rows = await query(
      `INSERT INTO connection_asks (id, org_id, provider, created_by, created_by_name) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (org_id, provider) DO NOTHING RETURNING id`,
      [newId("cask"), req.user.orgId, provider, actor(req).id || "system:connections/ask", actor(req).name || "Someone"]);
    res.json({ recorded: true, already: !rows.length,
      sentence: rows.length ? "Thank you. We've noted that you need it." : "We already have your ask for this one. Thank you." });
  }));
}

module.exports = { mount, readAsks, ensureTable };
