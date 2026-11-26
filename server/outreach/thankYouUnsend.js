// server/outreach/thankYouUnsend.js · COMMS-3 item 1. "I SENT IT" HAS AN UNDO.
//
// Drafts to review takes the row away the moment she says she sent it, with the
// shared Undo toast. Marking it sent did three things (server/outreach/thanks.js
// POST /thank-yous/:id/sent): logged "Thank-you sent." on the timeline in her
// name, marked the gift acknowledged and thanked, and closed a thank-you thread
// as an outcome. Undo puts back exactly those, and only those:
//   · the interaction it logged is removed (the one whose metadata names this draft);
//   · the gift's acknowledgement columns go back to what they were, which the send
//     kept in that interaction's metadata (previousGift);
//   · the thread it closed opens again, unless a newer step is already open;
//   · the draft is waiting again (sent_at cleared).
// Nothing is sent by Steward either way: she sent it from her own email.
"use strict";

const UNDO_WINDOW_MINUTES = 60;   // an undo is for a slip, not a history edit

function makeUnsend({ query, run, withTransaction, runTx }) {
  return async function unsend(orgId, draftId) {
    const [d] = await query("SELECT id, donor_id, gift_id, sent_at FROM thank_you_drafts WHERE id=? AND org_id=?", [draftId, orgId]);
    if (!d) return { status: 404, body: { error: "Draft not found" } };
    if (!d.sent_at) return { status: 200, body: { ok: true, alreadyWaiting: true } };
    if (Date.now() - new Date(d.sent_at).getTime() > UNDO_WINDOW_MINUTES * 60000)
      return { status: 409, body: { error: "too_late", sentence: "This was marked sent over an hour ago, so it stays sent. The timeline keeps the record." } };
    const [int] = await query(
      `SELECT id, metadata FROM interactions WHERE org_id=? AND donor_id=? AND metadata->>'draftId' = ? AND metadata->>'via' = 'thank_you_queue'
        ORDER BY created_at DESC LIMIT 1`, [orgId, d.donor_id, d.id]);
    const meta = int ? (typeof int.metadata === "string" ? JSON.parse(int.metadata || "{}") : (int.metadata || {})) : {};
    const prev = meta.previousGift || null;
    const body = async exec => {
      if (int) {
        const [th] = await query("SELECT id FROM threads WHERE org_id=? AND donor_id=? AND closing_interaction_id=?", [orgId, d.donor_id, int.id]);
        if (th) {
          const [busy] = await query("SELECT id FROM threads WHERE org_id=? AND donor_id=? AND closed_at IS NULL AND id<>?", [orgId, d.donor_id, th.id]);
          if (!busy) await exec("UPDATE threads SET closed_at=NULL, close_kind=NULL, close_reason=NULL, closing_interaction_id=NULL WHERE id=? AND org_id=?", [th.id, orgId]);
          else await exec("UPDATE threads SET closing_interaction_id=NULL WHERE id=? AND org_id=?", [th.id, orgId]);
        }
        await exec("DELETE FROM interactions WHERE id=? AND org_id=? AND metadata->>'via' = 'thank_you_queue'", [int.id, orgId]);
      }
      // Only what this send set goes back: a gift acknowledged before it stays acknowledged.
      if (prev) await exec("UPDATE gifts SET acknowledgement_sent=?, acknowledgement_sent_at=?, thanked_at=? WHERE id=? AND org_id=?",
        [!!prev.acknowledgement_sent, prev.acknowledgement_sent_at || null, prev.thanked_at || null, d.gift_id, orgId]);
      await exec("UPDATE thank_you_drafts SET sent_at=NULL WHERE id=? AND org_id=?", [d.id, orgId]);
    };
    if (withTransaction) await withTransaction(client => body((sql, args) => runTx(client, sql, args)));
    else await body((sql, args) => run(sql, args));
    return { status: 200, body: { ok: true, sentence: "Back in Drafts to review. Nothing was sent by Steward." } };
  };
}

module.exports = { makeUnsend, UNDO_WINDOW_MINUTES };
