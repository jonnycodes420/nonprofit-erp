// server/tasks/dupThanks.js · FLOWS-17 item 1. THE OPEN THANK-YOU TASKS THAT SIT BESIDE ANOTHER.
//
// The rows the old writers left (Justin's Place: "every time I put in a gift, two tasks pop up
// to mail a thank you"), read by the same rule thankYouOnce.js now writes by: a person's open
// thank-you step on the Thread IS the thank-you, and a gift has one thank-you task. A row here is
// an open, not-voided task with no Thread of its own that is a gift's thank-you (thanks_gift_id,
// or written by the "Gift received → notify the team" workflow, which stamped only
// source_gift_id) and either
//   · the person has an open thank-you step on their Thread (its own task is the one kept), or
//   · an earlier open thank-you task for the same gift is already kept.
// (The db layer reads every question mark as a parameter, so the regex writes {0,1}.)
// scripts/ops/flows17-dup-thanks.js lists them, and with --apply voids them (voided, never deleted).
"use strict";
const { THANK_TYPES } = require("../shared/thankYouOnce");

const GIFT_THANKS = `(t.thread_id IS NULL AND t.voided_at IS NULL AND COALESCE(t.done::text, '0') NOT IN ('1','true')
  AND (t.thanks_gift_id IS NOT NULL OR (t.created_by = 'system:workflow:instant_gift_thanks' AND t.source_gift_id IS NOT NULL)))`;

// $1 = the thank-you step types, $2 = one org or NULL for every org; $3 = orgs never read.
const DUP_THANKS_SQL = `
  SELECT t.org_id, t.id, t.title, t.donor_id, d.name AS donor_name, t.created_at,
         COALESCE(t.thanks_gift_id, t.source_gift_id) AS gift_id,
         CASE WHEN th.id IS NOT NULL THEN 'step' ELSE 'twin' END AS why,
         COALESCE(th.task_id, tw.id) AS kept_id, COALESCE(th.label, tw.title) AS kept_title
    FROM tasks t
    LEFT JOIN donors d ON d.id = t.donor_id AND d.org_id = t.org_id
    LEFT JOIN LATERAL (
      SELECT x.id, x.next_step_label AS label, (SELECT k.id FROM tasks k WHERE k.thread_id = x.id AND k.org_id = x.org_id LIMIT 1) AS task_id
        FROM threads x
       WHERE x.org_id = t.org_id AND x.donor_id = t.donor_id AND x.closed_at IS NULL
         AND (x.next_step_type = ANY($1::text[]) OR x.next_step_label ~* '^(call to ){0,1}(say |send ){0,1}(a ){0,1}(personal ){0,1}thank')
       LIMIT 1) th ON t.donor_id IS NOT NULL
    LEFT JOIN LATERAL (
      SELECT e.id, e.title FROM tasks e
       WHERE e.org_id = t.org_id AND e.id <> t.id AND COALESCE(e.thanks_gift_id, e.source_gift_id) = COALESCE(t.thanks_gift_id, t.source_gift_id)
         AND ${GIFT_THANKS.replace(/\bt\./g, "e.")}
         AND (e.created_at, e.id) < (t.created_at, t.id)
       ORDER BY e.created_at, e.id LIMIT 1) tw ON true
   WHERE ${GIFT_THANKS}
     AND (th.id IS NOT NULL OR tw.id IS NOT NULL)
     AND ($2::text IS NULL OR t.org_id = $2)
     AND NOT (t.org_id = ANY($3::text[]))
   ORDER BY t.org_id, t.donor_id, t.created_at, t.id`;

const VOID_SQL = `UPDATE tasks SET voided_at = NOW(), voided_reason = 'one_thank_you', updated_at = NOW()
                   WHERE org_id = $1 AND id = ANY($2::text[]) AND voided_at IS NULL AND COALESCE(done::text, '0') NOT IN ('1','true')
                   RETURNING id`;

module.exports = { DUP_THANKS_SQL, VOID_SQL, THANK_TYPES };
