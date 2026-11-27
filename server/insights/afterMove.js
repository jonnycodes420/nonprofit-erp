// server/insights/afterMove.js · THANKS-1 item 4. WHEN NO CARD HAS A MOVE, WHAT COMES NEXT, AND WHY.
//
// The fleet (23 Nov, prod): a $25 second gift retired "First gift, no second yet" and the
// profile said only "Nothing due for Quill right now." The second gift moves the giver from
// the second rung to retain, and no retain card speaks until they go quiet, so the panel
// went blank with no reason. Now, when nextMoveFor has nothing, the profile is told the
// step the rules still give, read live from the gifts (never the stored deck, which may be
// rebuilding):
//   · their newest gift waits for a thank-you (shared/numbers/thanks.js AWAITING, the one
//     rule): thank them for it, before any new ask;
//   · otherwise: nothing is due, and why (the newest gift is thanked, and the cards speak
//     again when their usual time to give passes or they give more than before).
// Answers null for a person with no gift (the profile's own empty states say that).
"use strict";
const { COUNTED } = require("../../shared/numbers/giftCount");
const { AWAITING } = require("../../shared/numbers/thanks");
// POLISH-15 item 6: the gift has an open thank-you task (thankYouOnce.js stamps it with thanks_gift_id).
const OPEN_THANK_TASK = g => `EXISTS (SELECT 1 FROM tasks tt WHERE tt.org_id = ${g}.org_id AND tt.thanks_gift_id = ${g}.id AND tt.done = 0 AND tt.voided_at IS NULL)`;

async function afterMove(query, orgId, ids) {
  if (!ids || !ids.length) return null;
  const rows = await query(
    `SELECT g.id, g.donor_id, gd.name AS giver, LEFT(g.date,10) AS date, ROUND(g.amount*100)::bigint AS cents, ${AWAITING("g")} AS awaiting,
            ${OPEN_THANK_TASK("g")} AS open_task
       FROM gifts g JOIN donors gd ON gd.id = g.donor_id AND gd.org_id = g.org_id AND gd.deleted_at IS NULL   -- ONE-MOVE-1: a trashed person's gifts drive no step
      WHERE g.org_id = ? AND g.donor_id = ANY(?::text[]) AND ${COUNTED("g")} AND g.date IS NOT NULL
      ORDER BY g.date DESC, g.created_at DESC, g.id DESC`, [orgId, ids]);
  if (!rows.length) return null;
  const last = rows[0];
  // POLISH-15 item 6 (W-1127-Settings-01): the profile's rail lists the open thank-you task, which
  // names the gift it was made for ("Thank Rufus · $325 just came in"), while this line named the
  // newest gift ($25). With an open thank-you task for a gift that still waits, this line names
  // that gift, so the two Next step lines are one step about one gift.
  const pick = (last.awaiting === true && rows.find(r => r.awaiting === true && r.open_task === true)) || last;
  // ONE-MOVE-1 item 2: whose gift it is, so another member of the household is never thanked for it by name
  return words({ giftId: pick.id, giverId: pick.donor_id, giver: pick.giver || null, date: pick.date, cents: Number(pick.cents),
    nth: pick === last ? rows.length : 0, awaiting: pick.awaiting === true });
}

// The words, server-side so Home's first look carries no extra JavaScript (perf-app's budget).
// The client puts the person's first name into `Next: thank <name> for the <amount> gift on <day>.`
const money = c => { const v = Math.abs(Number(c) || 0) / 100; return "$" + v.toLocaleString("en-US", v % 1 ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : {}); };
const dayWords = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || "")) ? new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "";
function words(a) {
  const amount = money(a.cents), day = dayWords(a.date), on = `${amount} on ${day}`, second = a.nth === 2;
  const why = a.awaiting
    ? (second ? "It is their second gift, so the first-gift move is finished, and it isn't thanked yet. A thank-you comes before any new ask."
              : "It isn't thanked yet. A thank-you comes before any new ask.")
    : `${second ? `Their second gift (${on}) finished the first-gift move, and it is thanked.` : `Their last gift (${on}) is thanked.`} Steward suggests the next step when their usual time to give passes or their giving grows.`;
  return { ...a, thank: a.awaiting, amount, day, why };
}

module.exports = { afterMove };
