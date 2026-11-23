// shared/numbers/volunteerStatus.js · VOL-3 item 1. A VOLUNTEER IS ACTIVE, PAUSED OR FORMER.
//
// The status lives on volunteer_records (one row per volunteer, written only by
// server/volunteers/volunteerRecord.js). No row means Active: nobody has said otherwise.
// The roster's first number counts Active volunteers, and says so.
//
//   STATUS_SQL(alias)   SQL: the person's status word ('active' when no row)
//   ACTIVE_SQL(alias)   SQL: true when that status is active
//   STATUS_WORDS        the word a screen shows for each status
"use strict";
const STATUSES = ["active", "paused", "former"];
const STATUS_WORDS = { active: "Active", paused: "Paused", former: "Former" };

const STATUS_SQL = (p = "donors") => `COALESCE((SELECT vr.status FROM volunteer_records vr WHERE vr.org_id = ${p}.org_id AND vr.person_id = ${p}.id), 'active')`;
const ACTIVE_SQL = (p = "donors") => `NOT EXISTS (SELECT 1 FROM volunteer_records vr WHERE vr.org_id = ${p}.org_id AND vr.person_id = ${p}.id AND vr.status <> 'active')`;

const ACTIVE_SENTENCE = "Everyone with the Volunteer role whose status is Active, including anyone added today. Paused and former volunteers are not counted; their hours stay on their record.";

module.exports = { STATUSES, STATUS_WORDS, STATUS_SQL, ACTIVE_SQL, ACTIVE_SENTENCE };
