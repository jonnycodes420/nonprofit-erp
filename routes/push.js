// routes/push.js · PUSH-1. THE THREE DOORS GOOGLE AND MICROSOFT KNOCK ON.
//
//   POST /push/google/gmail     Cloud Pub/Sub push for a Gmail watch
//   POST /push/google/calendar  a Google Calendar watch channel
//   POST /push/microsoft        Graph change notifications (and its validation)
//
// Each one verifies the notice before it reads anything (mailboxPush.js says
// how), answers at once, and then runs the connection's normal incremental
// read with trigger "push". A notice never carries mail or a meeting into
// Steward: the read does, under every rule the tick's read follows.
//
// NEVER TWO READS AT ONCE: the read takes the same per-connection advisory
// lock as the tick. A notice that lands while a read is running is not
// dropped: it waits and tries again (the running read may have started before
// the change arrived), and further notices for the same connection in the
// meantime fold into that one retry.
const express = require("express");
const MP = require("../mailboxPush");

const RETRY_MS = Number(process.env.PUSH_RETRY_MS || 4000);
const RETRY_TIMES = 8;
const waiting = new Set();

function router(getDeps) {
  const r = express.Router();
  const refuse = (res, kind, why, ip) => {
    console.warn(`[push] refused a ${kind} notice from ${ip || "unknown"}: ${why}`);
    return res.status(401).json({ error: "unverified" });
  };
  const audit = (req, conn, provider) => {
    if (!req.audit || !conn) return;
    req.audit.org(conn.org_id);
    req.audit.actor({ kind: "system", id: `system:push/${provider}`, name: `${provider === "google" ? "Google" : "Microsoft"} change notice` });
    req.audit.entity("mailbox_connection", conn.id, "Instant update");
  };
  // One read, now, for this connection; folded and retried while one runs.
  function readSoon(conn, what) {
    const key = `${conn.id}:${what}`;
    if (waiting.has(key)) return;
    waiting.add(key);
    const { syncMailbox, syncCalendar } = getDeps();
    const once = () => what === "mail"
      ? syncMailbox(conn.user_id, conn.org_id, conn.provider, { trigger: "push" })
      : syncCalendar(conn.user_id, conn.org_id, conn.provider, { trigger: "push" });
    (async () => {
      try {
        for (let i = 0; i < RETRY_TIMES; i++) {
          const out = await once().catch(e => { console.error(`[push] ${what} read for ${conn.id}:`, e.message); return null; });
          if (!out || out.reason !== "running") break;
          await new Promise(res => setTimeout(res, RETRY_MS));
        }
      } finally { waiting.delete(key); }
    })();
  }
  async function noted(ids) {
    const { run } = getDeps();
    if (ids.length) await run(`UPDATE mailbox_push SET last_notified_at=NOW(), notices=notices+1, updated_at=NOW() WHERE id = ANY(?)`, [ids]);
  }

  // ── Gmail, through Pub/Sub ───────────────────────────────────────────────
  r.post("/push/google/gmail", async (req, res) => {
    const cfg = MP.config();
    if (!MP.kindEnabled("gmail", cfg)) return refuse(res, "Gmail", "instant updates are not set up", req.ip);
    const v = await MP.verifyPubsubToken(req.headers.authorization, cfg).catch(() => ({ ok: false, why: "check failed" }));
    if (!v.ok) return refuse(res, "Gmail", v.why, req.ip);
    let note = null;
    try { note = JSON.parse(Buffer.from(String((req.body && req.body.message && req.body.message.data) || ""), "base64").toString("utf8")); } catch { note = null; }
    const address = note && typeof note.emailAddress === "string" ? note.emailAddress.trim().toLowerCase() : null;
    // Verified but about nobody here: acknowledged, so Pub/Sub stops retrying.
    if (!address) return res.status(204).end();
    const { query } = getDeps();
    const rows = await query(
      `SELECT p.id AS push_id, m.* FROM mailbox_push p JOIN mailbox_connections m ON m.id = p.connection_id
        WHERE p.kind='gmail' AND p.status='on' AND m.provider='google' AND m.status='active' AND m.paused IS NOT TRUE
          AND LOWER(m.address)=?`, [address]);
    await noted(rows.map(x => x.push_id));
    if (rows[0]) audit(req, rows[0], "google");
    res.status(204).end();
    for (const conn of rows) readSoon(conn, "mail");
  });

  // ── Google Calendar, through a watch channel ─────────────────────────────
  r.post("/push/google/calendar", async (req, res) => {
    const id = req.get("X-Goog-Channel-ID"), tok = req.get("X-Goog-Channel-Token"),
      resource = req.get("X-Goog-Resource-ID"), state = req.get("X-Goog-Resource-State");
    if (!id || !tok) return refuse(res, "Google Calendar", "no channel id or token", req.ip);
    const { query } = getDeps();
    const [row] = await query(
      `SELECT p.id AS push_id, p.secret_hash, p.resource_id AS push_resource, p.status AS push_status, m.*
         FROM mailbox_push p JOIN mailbox_connections m ON m.id = p.connection_id
        WHERE p.kind='gcal' AND p.channel_id=?`, [id]);
    if (!row || !MP.secretMatches(tok, row.secret_hash) || (row.push_resource && resource !== row.push_resource))
      return refuse(res, "Google Calendar", row ? "token or resource did not match" : "unknown channel", req.ip);
    audit(req, row, "google");
    // "sync" is Google saying the channel now exists; nothing changed yet.
    if (state === "sync") return res.status(200).json({ ok: true });
    if (row.push_status === "on") await noted([row.push_id]);
    res.status(200).json({ ok: true });
    if (row.status === "active" && row.paused !== true) readSoon(row, "calendar");
  });

  // ── Outlook, through Graph ───────────────────────────────────────────────
  r.post("/push/microsoft", async (req, res) => {
    // Graph proves the URL before it creates a subscription: the token comes
    // back as plain text within 10 seconds. It reads nothing and changes nothing.
    if (req.query && typeof req.query.validationToken === "string") {
      return res.status(200).type("text/plain").send(req.query.validationToken);
    }
    const items = Array.isArray(req.body && req.body.value) ? req.body.value : [];
    if (!items.length) return refuse(res, "Outlook", "no notifications in the body", req.ip);
    const { query, run } = getDeps();
    const ids = [...new Set(items.map(n => n && n.subscriptionId).filter(x => typeof x === "string"))];
    const rows = ids.length ? await query(
      `SELECT p.id AS push_id, p.kind, p.channel_id, p.secret_hash, p.status AS push_status, m.*
         FROM mailbox_push p JOIN mailbox_connections m ON m.id = p.connection_id
        WHERE p.kind LIKE 'graph_%' AND p.channel_id = ANY(?)`, [ids]) : [];
    const bySub = new Map(rows.map(x => [x.channel_id, x]));
    const good = items.filter(n => { const x = n && bySub.get(n.subscriptionId); return x && MP.secretMatches(n.clientState, x.secret_hash); });
    if (!good.length) return refuse(res, "Outlook", "unknown subscription or wrong client state", req.ip);
    if (good.length < items.length) console.warn(`[push] refused ${items.length - good.length} of ${items.length} Outlook notices: unknown subscription or wrong client state`);
    const reads = new Map();
    const notedIds = [];
    for (const n of good) {
      const x = bySub.get(n.subscriptionId);
      const what = MP.whatOf(x.kind);
      if (n.lifecycleEvent === "subscriptionRemoved") {
        // Microsoft took it away: paused now, made again on the next tick.
        await run(`UPDATE mailbox_push SET status='paused', paused_reason='stopped', paused_at=NOW(), retry_at=NOW(), updated_at=NOW() WHERE id=?`, [x.push_id]);
      } else if (n.lifecycleEvent === "reauthorizationRequired") {
        // Renewed on the next tick, well before it lapses.
        await run(`UPDATE mailbox_push SET expires_at=LEAST(expires_at, NOW() + INTERVAL '1 hour'), updated_at=NOW() WHERE id=?`, [x.push_id]);
      } else if (x.push_status === "on") notedIds.push(x.push_id);
      // A change, or "missed" (Graph dropped some): either way, read.
      if (n.lifecycleEvent !== "subscriptionRemoved" && n.lifecycleEvent !== "reauthorizationRequired") reads.set(`${x.id}:${what}`, [x, what]);
    }
    await noted([...new Set(notedIds)]);
    audit(req, bySub.get(good[0].subscriptionId), "microsoft");
    res.status(202).end();
    for (const [conn, what] of reads.values()) if (conn.status === "active" && conn.paused !== true) readSoon(conn, what);
  });
  return r;
}

module.exports = { router };
