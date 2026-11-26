// server/atlas/conversation.js · ATLAS-11 item 4. CLOSING ATLAS KEEPS THE CONVERSATION.
//
// Jarvis (25 Nov): "Closing Atlas erases the conversation." The thread lived
// in the dialog's memory only. Every ask is already kept server-side (a
// voice_memos row, per org and per person, created_by), and each one names the
// ask it followed (read.atlas.follows). So the conversation is that chain, read
// back, newest last:
//
//   GET  /atlas/conversation             her own asks in this org, the chain ending at
//                                        her latest, at most MAX of them and none older
//                                        than KEEP_DAYS. Nothing when she started over.
//   POST /atlas/conversation/start-over  her latest ask is marked as a conversation's
//                                        end (read.atlas.threadEnd); the next ask starts
//                                        a new one. Nothing is deleted: the activity log
//                                        keeps every request, as before.
//
// THE AI SWITCH. Nothing here goes to a model. The read of a new ask sends the
// model only her new words (routes/atlas.js readSteps), with AI on; with it off
// no model is called at all, whatever the conversation holds.
"use strict";
const express = require("express");

const routers = { r0: express.Router() };
const app = routers.r0;
const KEEP_DAYS = 7;
const MAX = 6;   // the dialog's THREAD_MAX (client/src/lib/atlasThread.js), the last one included
const atlasOf = (parse, r) => ((parse(r && r.read) || {}).atlas) || {};

// The ids of her conversation, oldest first.
async function conversationIds(query, orgId, userId, parse) {
  const rows = await query(`SELECT id, read FROM voice_memos
     WHERE org_id = ? AND created_by = ? AND source LIKE 'atlas%' AND created_at > NOW() - INTERVAL '${KEEP_DAYS} days'
     ORDER BY created_at DESC, id DESC LIMIT 60`, [orgId, userId]);
  if (!rows.length || atlasOf(parse, rows[0]).threadEnd) return [];
  const byId = new Map(rows.map(r => [r.id, r]));
  const out = [];
  for (let cur = rows[0]; cur && out.length < MAX;) {
    out.unshift(cur.id);
    const f = atlasOf(parse, cur).follows;
    cur = f ? byId.get(f) : null;
    if (cur && atlasOf(parse, cur).threadEnd) break;   // an earlier conversation, ended
  }
  return out;
}

// Mounted by routes/atlas.js, whose router runs this one before GET /atlas/:id.
function mount({ query, run, wrap, requireAuth, checkWriteAccess, requestOut, parse }) {
  app.get("/atlas/conversation", requireAuth, wrap(async (req, res) => {
    const ids = await conversationIds(query, req.user.orgId, req.user.userId, parse);
    const requests = (await Promise.all(ids.map(id => requestOut(req.user.orgId, id)))).filter(Boolean);
    res.json({ requests, keptDays: KEEP_DAYS });
  }));
  app.post("/atlas/conversation/start-over", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const [m] = await query(`SELECT id FROM voice_memos WHERE org_id = ? AND created_by = ? AND source LIKE 'atlas%' ORDER BY created_at DESC, id DESC LIMIT 1`, [req.user.orgId, req.user.userId]);
    if (m) await run(`UPDATE voice_memos SET read = jsonb_set(COALESCE(read, '{}'::jsonb), '{atlas,threadEnd}', 'true'::jsonb, true) WHERE id = ? AND org_id = ?`, [m.id, req.user.orgId]);
    res.json({ ok: true, sentence: "Started over. What you asked before is still in Atlas's activity." });
  }));
}

module.exports = { routers, mount, conversationIds, KEEP_DAYS, MAX };
