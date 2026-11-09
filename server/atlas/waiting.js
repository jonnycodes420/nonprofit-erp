// server/atlas/waiting.js · ATLAS-5. EVERYTHING THAT WAITS CAN BE LET GO.
//
// W-1108-Atlas-08X: the bell said "3 waiting for you" and nothing in it could
// be dismissed. A proposal she never saved stayed "waiting" for ever (the card
// had Save and Edit, no Discard), and an unanswered "Which Walter?" was not in
// the bell at all, so it could be neither answered nor let go.
//
// Now:
//   discardProposal   the proposal is closed in one UPDATE (only while it is
//                     unsaved, so a Save and a Discard at once do one thing),
//                     and its line stops waiting. Save refuses it after.
//   openQuestions     each of her Atlas requests still asking a question is a
//                     waiting item in the bell, with Answer and Dismiss. It is
//                     read from the request itself, so the ones asked before
//                     this build show too (no row is written for them).
//   dismissQuestion   the request is closed, and nothing in it runs.
// Nothing here writes a gift, a note or an email: it only stops a wait.
"use strict";

const j = v => (typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v);

async function discardProposal({ query, run }, orgId, memoId, at = new Date().toISOString()) {
  const r = await run(
    `UPDATE voice_memos SET read = jsonb_set(read, '{atlas,proposal,discardedAt}', to_jsonb(?::text))
      WHERE id=? AND org_id=? AND read #>> '{atlas,proposal,id}' IS NOT NULL
        AND read #>> '{atlas,proposal,savedAt}' IS NULL AND read #>> '{atlas,proposal,discardedAt}' IS NULL`,
    [at, memoId, orgId]);
  const took = !!(r && r.changes);
  // The line stops waiting either way: one already discarded is not waiting either.
  const [m] = await query("SELECT read #>> '{atlas,proposal,savedAt}' AS saved FROM voice_memos WHERE id=? AND org_id=?", [memoId, orgId]);
  if (m && !m.saved) {
    await run("UPDATE atlas_actions SET state='discarded', waits=false, line=?, updated_at=NOW() WHERE org_id=? AND request_id=? AND kind='proposal' AND state='waiting'",
      ["Discarded. Nothing was saved.", orgId, memoId]);
  }
  return took;
}

// Her own requests that still ask a question, newest first.
async function openQuestions(query, orgId, userId, limit = 10) {
  const rows = await query(`SELECT id, text, read, created_at FROM voice_memos WHERE org_id=? AND created_by=? AND source LIKE 'atlas%' AND status='needs_answers'
                              ORDER BY created_at DESC LIMIT ?`, [orgId, userId, limit]);
  return rows.map(m => {
    const qs = ((j(m.read) || {}).atlas || {}).questions || [];
    const asked = qs.map(x => x.sentence).filter(Boolean).join(" ") || "A question";
    return { id: `q_${m.id}`, requestId: m.id, kind: "question", state: "waiting", waits: true, undoable: false, by: null,
      line: `${asked} You asked: "${String(m.text).slice(0, 80)}${String(m.text).length > 80 ? "…" : ""}"`, link: null, at: m.created_at, seenAt: null };
  });
}

async function dismissQuestion({ run }, orgId, memoId) {
  const r = await run("UPDATE voice_memos SET status='dismissed' WHERE id=? AND org_id=? AND status='needs_answers' AND source LIKE 'atlas%'", [memoId, orgId]);
  return !!(r && r.changes);
}

module.exports = { discardProposal, openQuestions, dismissQuestion };
