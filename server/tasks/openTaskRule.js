// server/tasks/openTaskRule.js · FLOWS-5 (W-1107-Volunteers-14X). WHICH TASKS A SCREEN SHOWS, ONE RULE.
//
// The fleet saw the Calendar list "Send personal thank-you" twice for one $1
// gift while the person's Tasks tab said no tasks: the two screens read tasks
// with two different queries. Both read this now:
//   SHOWN      not voided and not a sample record
//   OPEN       shown, and not done
//   ONE_THANKS one thank-you per gift: a gift's task is not shown while the
//              person has an open thank-you step on their Thread, and of two
//              open tasks for the same gift only the first one written is shown (thankYouOnce.js keeps new ones to one; this covers
//              rows written before it, and scripts/ops/flows5-dup-thanks.js
//              lists them to close).
"use strict";

const SHOWN = (t = "t") => `(${t}.voided_at IS NULL AND COALESCE(${t}.is_sample, false) = false)`;
const NOT_DONE = (t = "t") => `COALESCE(${t}.done::text, '0') NOT IN ('1', 'true')`;
const OPEN = (t = "t") => `(${SHOWN(t)} AND ${NOT_DONE(t)})`;
const GIFT_OF = t => `COALESCE(${t}.thanks_gift_id, ${t}.source_gift_id)`;
// thankYouOnce.js's own rule (its regex, written with {0,1}: a `?` here would be read as a parameter): while the person has an open thank-you step on
// their Thread, that step IS the thank-you, and a gift's task is not shown.
const THANK_STEP = t => `EXISTS (SELECT 1 FROM threads th WHERE th.org_id = ${t}.org_id AND th.donor_id = ${t}.donor_id AND th.closed_at IS NULL
       AND (th.next_step_type IN ('thank', 'thank_you_note') OR th.next_step_label ~* '^(call to ){0,1}(say |send ){0,1}(a ){0,1}(personal ){0,1}thank'))`;
// A Thread step's own task (thread_id set) is that step, and is never hidden.
const ONE_THANKS = (t = "t") => `NOT (${t}.thread_id IS NULL AND ${GIFT_OF(t)} IS NOT NULL AND ${NOT_DONE(t)} AND (${THANK_STEP(t)} OR EXISTS (
    SELECT 1 FROM tasks k WHERE k.org_id = ${t}.org_id AND k.id <> ${t}.id AND k.thread_id IS NULL AND ${OPEN("k")}
       AND ${GIFT_OF("k")} = ${GIFT_OF(t)} AND (k.created_at, k.id) < (${t}.created_at, ${t}.id))))`;

module.exports = { SHOWN, OPEN, ONE_THANKS };
