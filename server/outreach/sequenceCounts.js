// server/outreach/sequenceCounts.js · COUNTS-1. "SEQUENCES RUNNING", DEFINED ONCE.
//
// Communications' overview said "Sequences running 2" while the Sequences
// page said both were paused: the tile counted status = 'active' among the
// five newest rows, and the page says "Paused until you set your timezone"
// for the same rows when no human has chosen the org's zone (BUILD-84's gate),
// and nothing sends while email is off for the org. A sequence is RUNNING when
// it is turned on (status 'active'), the org's timezone has been chosen, and
// the org's email is going out. Onboarding sequences are Steward's own and are
// not hers to count. Every sequence is counted, never the newest five.
"use strict";

async function sequencesRunning(query, orgId, { mailSends = true } = {}) {
  const [org] = await query("SELECT timezone_confirmed_at FROM orgs WHERE id=?", [orgId]);
  const rows = await query(
    `SELECT id, status FROM sequences WHERE org_id=? AND COALESCE(trigger, '') <> 'onboarding'`, [orgId]).catch(() => []);
  const on = rows.filter(s => s.status === "active").length;
  const SS = await import("../../shared/sequenceShape.js");
  const gate = SS.timezoneGate(org || null);
  const held = !on ? null : !gate.ok ? "timezone" : !mailSends ? "mail" : null;
  const running = held ? 0 : on;
  const n = k => `${k} ${k === 1 ? "sequence" : "sequences"}`;
  const sentence = held === "timezone"
    ? `${n(on)} turned on, paused until you set your organization's timezone in Settings. Running means turned on and able to send.`
    : held === "mail"
      ? `${n(on)} turned on, waiting while email is off for your organization. Running means turned on and able to send.`
      : `Sequences turned on and able to send. A paused or turned-off sequence is not counted.`;
  return { running, on, held, sentence };
}

module.exports = { sequencesRunning };
