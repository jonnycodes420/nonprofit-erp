// server/drafts/dismiss.js · COMMS-1 item 4. EVERY DRAFT CAN BE DISMISSED.
//
// Drafts to review holds three kinds of draft, each in its own table:
//   milestone   milestone_drafts  (milestones, anniversaries, journey steps)  waiting = status 'pending_review'
//   agent       agent_drafts      (Atlas)                                    waiting = status 'pending'
//   thank_you   thank_you_drafts  (a gift's thank-you)                       waiting = not sent, not skipped
// Dismissing one ARCHIVES it, never deletes it: archived_at/by are stamped,
// and it leaves every queue and count (the two status tables move to
// 'archived'; a thank-you is stamped skipped as well, which is what every
// reader of thank_you_drafts already leaves out). An archived draft is never
// sent: each send path reads only its waiting status. It never comes back on
// its own; Restore (here, or Undo) puts it back exactly where it waited.
//
// An Atlas draft also has its line in atlas_actions ("Drafted an email to
// Marlowe. Review and send."). Dismissing the draft discards the line, and
// Restore makes it wait again.
//
//   POST /drafts/dismiss    { drafts: [{ kind, id }] }   one audit row (middleware/auditTrail.js)
//   POST /drafts/restore    { drafts: [{ kind, id }] }
//   GET  /drafts/dismissed  the archived drafts, newest first, for "Dismissed (n)"
"use strict";
const express = require("express");

const routers = { r1: express.Router() };
const KINDS = ["milestone", "agent", "thank_you"];
const MAX = 500;

function parse(body) {
  const list = Array.isArray(body && body.drafts) ? body.drafts : [];
  const out = { milestone: [], agent: [], thank_you: [] };
  for (const d of list.slice(0, MAX)) if (d && KINDS.includes(d.kind) && d.id) out[d.kind].push(String(d.id));
  return out;
}
const flat = by => KINDS.flatMap(k => by[k].map(id => ({ kind: k, id })));
const j = v => { if (v == null || typeof v !== "string") return v; try { return JSON.parse(v); } catch { return null; } };

async function archive({ query, run }, orgId, by, who) {
  const done = { milestone: [], agent: [], thank_you: [] };
  if (by.milestone.length) done.milestone = (await query(
    `UPDATE milestone_drafts SET status = 'archived', archived_at = NOW(), archived_by = ?, archived_by_name = ?
      WHERE org_id = ? AND id = ANY(?::text[]) AND status = 'pending_review' AND sent_at IS NULL RETURNING id`,
    [who.id, who.name, orgId, by.milestone])).map(r => r.id);
  if (by.agent.length) {
    done.agent = (await query(
      `UPDATE agent_drafts SET status = 'archived', archived_at = NOW(), archived_by = ?, archived_by_name = ?
        WHERE org_id = ? AND id = ANY(?::text[]) AND status = 'pending' AND sent_at IS NULL RETURNING id`,
      [who.id, who.name, orgId, by.agent])).map(r => r.id);
    // The Atlas line that asked for this draft stops waiting.
    if (done.agent.length) await run(
      `UPDATE atlas_actions SET state = 'discarded', waits = false, updated_at = NOW()
        WHERE org_id = ? AND kind = 'draft' AND state = 'waiting' AND place_id = ANY(?::text[])`, [orgId, done.agent]);
  }
  if (by.thank_you.length) done.thank_you = (await query(
    `UPDATE thank_you_drafts SET skipped_at = NOW(), archived_at = NOW(), archived_by = ?, archived_by_name = ?
      WHERE org_id = ? AND id = ANY(?::text[]) AND sent_at IS NULL AND skipped_at IS NULL RETURNING id`,
    [who.id, who.name, orgId, by.thank_you])).map(r => r.id);
  return done;
}

async function restore({ query, run }, orgId, by) {
  const done = { milestone: [], agent: [], thank_you: [] };
  if (by.milestone.length) done.milestone = (await query(
    `UPDATE milestone_drafts SET status = 'pending_review', archived_at = NULL, archived_by = NULL, archived_by_name = NULL
      WHERE org_id = ? AND id = ANY(?::text[]) AND status = 'archived' AND archived_at IS NOT NULL RETURNING id`,
    [orgId, by.milestone])).map(r => r.id);
  if (by.agent.length) {
    done.agent = (await query(
      `UPDATE agent_drafts SET status = 'pending', archived_at = NULL, archived_by = NULL, archived_by_name = NULL
        WHERE org_id = ? AND id = ANY(?::text[]) AND status = 'archived' AND archived_at IS NOT NULL RETURNING id`,
      [orgId, by.agent])).map(r => r.id);
    if (done.agent.length) {
      const lines = await query(`SELECT id, request_id, card_id FROM atlas_actions
                                  WHERE org_id = ? AND kind = 'draft' AND state = 'discarded' AND place_id = ANY(?::text[])`, [orgId, done.agent]);
      for (const a of lines) {
        await run(`UPDATE atlas_actions SET state = 'waiting', waits = true, updated_at = NOW() WHERE id = ? AND org_id = ?`, [a.id, orgId]);
        // A card the line settled as discarded waits again too.
        if (!a.request_id || !a.card_id) continue;
        const [m] = await query("SELECT cards FROM voice_memos WHERE id = ? AND org_id = ?", [a.request_id, orgId]);
        const cards = j(m && m.cards);
        if (!Array.isArray(cards)) continue;
        let changed = false;
        const next = cards.map(c => {
          if (c.id !== a.card_id || c.state !== "discarded") return c;
          changed = true; const { by: _by, ...rest } = c; return { ...rest, state: "waiting" };
        });
        if (changed) await run("UPDATE voice_memos SET cards = ? WHERE id = ? AND org_id = ?", [JSON.stringify(next), a.request_id, orgId]);
      }
    }
  }
  if (by.thank_you.length) done.thank_you = (await query(
    `UPDATE thank_you_drafts SET skipped_at = NULL, archived_at = NULL, archived_by = NULL, archived_by_name = NULL
      WHERE org_id = ? AND id = ANY(?::text[]) AND sent_at IS NULL AND archived_at IS NOT NULL RETURNING id`,
    [orgId, by.thank_you])).map(r => r.id);
  return done;
}

async function dismissed({ query }, orgId) {
  const rows = await query(`
    SELECT 'milestone' AS kind, m.id, m.donor_id, d.name AS donor_name, m.subject, m.archived_at, m.archived_by_name
      FROM milestone_drafts m LEFT JOIN donors d ON d.id = m.donor_id AND d.org_id = m.org_id
     WHERE m.org_id = ? AND m.status = 'archived' AND m.archived_at IS NOT NULL
    UNION ALL
    SELECT 'agent', a.id, a.donor_id, d.name, a.subject, a.archived_at, a.archived_by_name
      FROM agent_drafts a LEFT JOIN donors d ON d.id = a.donor_id AND d.org_id = a.org_id
     WHERE a.org_id = ? AND a.status = 'archived' AND a.archived_at IS NOT NULL
    UNION ALL
    SELECT 'thank_you', t.id, t.donor_id, d.name, NULL::text, t.archived_at, t.archived_by_name
      FROM thank_you_drafts t LEFT JOIN donors d ON d.id = t.donor_id AND d.org_id = t.org_id
     WHERE t.org_id = ? AND t.archived_at IS NOT NULL AND t.sent_at IS NULL
     ORDER BY archived_at DESC LIMIT 200`, [orgId, orgId, orgId]);
  return rows.map(r => ({ kind: r.kind, id: r.id, donorId: r.donor_id, who: r.donor_name || "Someone no longer on file",
    subject: r.subject || "", archivedAt: r.archived_at, by: r.archived_by_name || null }));
}

const count = by => KINDS.reduce((n, k) => n + by[k].length, 0);
const drafts = n => `${n} ${n === 1 ? "draft" : "drafts"}`;

function mount(ctx) {
  const { query, run, requireAuth, checkWriteAccess, wrap, actor } = ctx;
  const app = routers.r1;
  const gate = checkWriteAccess || ((req, res, next) => next());

  app.post("/drafts/dismiss", requireAuth, gate, wrap(async (req, res) => {
    const by = parse(req.body);
    if (!count(by)) return res.status(400).json({ error: "no_drafts", sentence: "Say which drafts to dismiss." });
    const who = actor ? actor(req) : { id: req.user.userId, name: null };
    const done = await archive({ query, run }, req.user.orgId, by, who);
    const n = count(done);
    req.audit.entity("draft", n === 1 ? flat(done)[0].id : null, n === 1 ? "a draft" : drafts(n));
    req.audit.action(n === 1 ? "dismissed a draft" : `dismissed ${drafts(n)}`);
    req.audit.before({ waiting: flat(done) });
    req.audit.after({ archived: flat(done) });
    res.json({ ok: true, dismissed: flat(done), count: n,
      sentence: n ? `${n === 1 ? "Draft" : drafts(n)} dismissed. ${n === 1 ? "It won't" : "They won't"} be sent.` : "Nothing was waiting to dismiss." });
  }));

  app.post("/drafts/restore", requireAuth, gate, wrap(async (req, res) => {
    const by = parse(req.body);
    if (!count(by)) return res.status(400).json({ error: "no_drafts", sentence: "Say which drafts to restore." });
    const done = await restore({ query, run }, req.user.orgId, by);
    const n = count(done);
    req.audit.entity("draft", n === 1 ? flat(done)[0].id : null, n === 1 ? "a draft" : drafts(n));
    req.audit.action(n === 1 ? "restored a draft" : `restored ${drafts(n)}`);
    req.audit.before({ archived: flat(done) });
    req.audit.after({ waiting: flat(done) });
    res.json({ ok: true, restored: flat(done), count: n, sentence: n ? `${n === 1 ? "The draft is" : drafts(n) + " are"} back in Drafts to review.` : "Nothing to restore." });
  }));

  app.get("/drafts/dismissed", requireAuth, wrap(async (req, res) => {
    const list = await dismissed({ query }, req.user.orgId);
    res.json({ drafts: list, count: list.length });
  }));
  return {};
}

module.exports = { routers, mount, archive, restore, dismissed, parse, KINDS };
