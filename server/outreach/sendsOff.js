// server/outreach/sendsOff.js · SENDS-1 item 1. OFF MEANS NOTHING GOES OUT.
//
// One master switch: the org's Donor mail (`orgs.emails_enabled`, with the
// onboarding and demo rules of mailPolicy.orgMailDecision). Each email type
// in Settings, Automatic email ("Journey and sequence steps" among them) only
// narrows what the master allows. While the master is Off:
//   - no journey or sequence step sends. A step that falls due becomes a draft
//     in Communications that a person reads and sends herself (one per step
//     per person, never twice), and the enrollment moves on. It is never
//     closed as "unsubscribed": the person did nothing.
//   - every surface says Off (routes/mailTypes.js reads `masterOff` from here).
//
// And a sequence with an empty step or no trigger can't be Active: turning it
// on is refused with the reason (sequenceActivationProblem).
"use strict";
const { query, run } = require("../../db");
const mailPolicy = require("../../mailPolicy");
const { newId } = require("../shared/newId");
const DRAFT_KEYS = require("../../shared/numbers/draftRender");   // TRUTH-3: a draft stores figure keys, never numbers

const DRAFT_ACTOR = { id: "system:sequence", name: "Steward (email is off, so this waits for you)" };

// The master, as the sweeps and the page read it. `org` may be passed when the
// caller already has the row.
async function master(orgId, org = undefined) {
  if (org === undefined) {
    [org] = await query(`SELECT id, emails_enabled, staff_mail_enabled, billing_mail_enabled, onboarded_at, org_kind FROM orgs WHERE id = ?`, [orgId]);
  }
  const d = mailPolicy.orgMailDecision(org || null, mailPolicy.CATEGORY.DONOR);
  return { on: d.send === true, reason: d.reason || null };
}

// A sequence step that would have sent, written as a draft instead. Keyed on
// the enrollment and the step, so a second tick (or ten at once) writes one.
async function sequenceStepDraft({ orgId, enrollmentId, donorId, stepOrder, subject, body }) {
  const key = `sequence-step:${enrollmentId}:${stepOrder}`;
  const r = await run(
    `INSERT INTO milestone_drafts (id,org_id,donor_id,sequence_enrollment_id,milestone_key,subject,body,status,source,created_by,created_by_name)
     SELECT ?::text,?::text,?::text,?::text,?::text,?::text,?::text,'pending_review','sequence',?::text,?::text
      WHERE NOT EXISTS (SELECT 1 FROM milestone_drafts WHERE org_id=?::text AND milestone_key=?::text)`,
    [newId("md"), orgId, donorId, enrollmentId, key, DRAFT_KEYS.templatize(subject || ""), DRAFT_KEYS.templatize(body || ""), DRAFT_ACTOR.id, DRAFT_ACTOR.name, orgId, key]);
  return !!(r && r.changes);
}

// A step is empty when its body has no words once tags and blanks are gone.
const isBlank = s => !String(s || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").trim();
// The milestone sequence is the one exception: it never sends its step. Each
// email is written for the person when the moment comes and waits as a draft
// (processSequences' milestone branch), so its one step has no words of its own.
const DRAFTS_PER_PERSON = new Set(["milestone"]);

// Why this sequence can't be turned on, or null. `steps` are its rows.
function sequenceActivationProblem(seq, steps) {
  const trigger = String((seq && seq.trigger) || "").trim();
  if (!trigger) return { error: "no_trigger", sentence: "This sequence can't be turned on: it has no trigger, so nobody would ever start it. Choose a trigger first." };
  if (DRAFTS_PER_PERSON.has(trigger)) return null;
  const list = Array.isArray(steps) ? steps : [];
  if (!list.length) return { error: "no_steps", sentence: "This sequence can't be turned on: it has no steps yet. Write its first email first." };
  const empty = list.findIndex(s => isBlank(s.body));
  if (empty >= 0) return { error: "empty_step", sentence: `This sequence can't be turned on: step ${empty + 1} has no words yet. Write it, then turn it on.` };
  return null;
}

module.exports = { master, sequenceStepDraft, sequenceActivationProblem, isBlank, DRAFTS_PER_PERSON, DRAFT_ACTOR };
