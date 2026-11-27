// server/shared/requestKey.js · SAFE-EDIT-1 item 1. A DOUBLE-CLICK MAKES ONE.
//
// Duet double-clicked Save on Add person and got two records, 5 ms apart. The browser now
// sends one key per form (the header X-Request-Key, or `requestKey` in the body) and keeps
// it until the form closes; this middleware answers every repeat of that key with the row
// the first request made, so two clicks, a retried request or a second tab's resend make
// one person or one task.
//
//   app.post("/donors", requireAuth, checkWriteAccess, onceByKey("person", reread), wrap(...))
//
// How: the first request claims (org, kind, key) in request_keys (INSERT … ON CONFLICT DO
// NOTHING), runs, and stamps the id it made; a failed or refused create gives the claim up,
// so a corrected resend is a fresh try. A repeat that finds the claim waits for the id
// (the first request is milliseconds ahead) and answers 200 with `reread(id)`, the same row
// the first got, plus `repeated: true`; it writes nothing and its audit row is skipped.
// Without a key the route runs as it always did.
//
// Gifts and pledges already carry their own key (gifts.idempotency_key, pledges.idempotency_key,
// enforced by a unique index); this is the same idea for the rows that had none.
"use strict";

const KEY = /^[A-Za-z0-9_:.-]{8,128}$/;
const KEEP = "2 days";
const WAIT_MS = 10000, STEP_MS = 120;

function keyOf(req) {
  const k = (req.get && req.get("X-Request-Key")) || (req.body && req.body.requestKey);
  return typeof k === "string" && KEY.test(k.trim()) ? k.trim() : null;
}

function onceByKey(kind, reread) {
  return async (req, res, next) => {
    const key = keyOf(req);
    if (!key || !req.user || !req.user.orgId) return next();
    const { query, run } = require("../../db");
    const orgId = req.user.orgId;
    try {
      const who = { id: req.user.userId || "system:request-key", name: req.user.name || req.user.email || null };
      const claimed = await query(
        `INSERT INTO request_keys (org_id, kind, key, created_by, created_by_name) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (org_id, kind, key) DO NOTHING RETURNING key`, [orgId, kind, key, who.id, who.name]);
      if (claimed.length) {
        // the first: watch what it answers, keep the id it made (or give the claim up)
        const json = res.json.bind(res);
        let made = null;
        res.json = body => { if (res.statusCode < 300 && body && typeof body.id === "string") made = body.id; return json(body); };
        res.on("finish", () => {
          const done = made
            ? run(`UPDATE request_keys SET record_id = ? WHERE org_id = ? AND kind = ? AND key = ?`, [made, orgId, kind, key])
            : run(`DELETE FROM request_keys WHERE org_id = ? AND kind = ? AND key = ? AND record_id IS NULL`, [orgId, kind, key]);
          done.catch(e => console.error("[request-key] stamp:", e.message));
          run(`DELETE FROM request_keys WHERE org_id = ? AND created_at < NOW() - INTERVAL '${KEEP}'`, [orgId]).catch(() => {});
        });
        return next();
      }
      // a repeat: wait for the first to finish, then answer with what it made
      for (let waited = 0; waited <= WAIT_MS; waited += STEP_MS) {
        const [k] = await query(`SELECT record_id FROM request_keys WHERE org_id = ? AND kind = ? AND key = ?`, [orgId, kind, key]);
        if (!k) return onceByKey(kind, reread)(req, res, next);   // the first gave up: this one is a fresh try
        if (k.record_id) {
          const row = await reread(orgId, k.record_id);
          if (req.audit && req.audit.skip) req.audit.skip("a repeated click: the first request made it");
          if (!row) return res.status(404).json({ error: "gone", sentence: "The record this made is no longer there." });
          return res.status(200).json({ ...row, repeated: true });
        }
        await new Promise(r => setTimeout(r, STEP_MS));
      }
      if (req.audit && req.audit.skip) req.audit.skip("a repeated click still waiting on the first");
      return res.status(409).json({ error: "in_progress", sentence: "That is still being saved. Wait a moment, then look before you try again." });
    } catch (e) { return next(e); }
  };
}

module.exports = { onceByKey, keyOf };
