// server/volunteers/alreadyVolunteer.js · ATLAS-10 item 4. AN APPLICATION FROM SOMEONE WHO ALREADY
// VOLUNTEERS IS NOT WAITING FOR ANYONE.
//
// The fleet (24 Nov): "Fenwick Elmsworth is already a volunteer (14 hours) yet his application is
// still pending." An application whose email belongs to a person on file with the Volunteer role
// and an Active status closes itself: a new one closes as it arrives (approved onto their record,
// by `system:already-volunteer`); one already waiting is left out of the pending list and every
// pending count, and is listed as "Already a volunteer" instead. A GET never writes, so the rows
// already waiting are closed by scripts/ops/close-already-volunteer-apps.js (dry run first).
"use strict";
const { ACTIVE_SQL } = require("../../shared/numbers/volunteerStatus");

const ACTOR = { id: "system:already-volunteer", name: "Steward: already a volunteer" };

// SQL: the person on file an application `a` belongs to, when they already volunteer (their id), else NULL.
const VOLUNTEER_OF = (a = "a") => `(SELECT av.id FROM donors av WHERE av.org_id = ${a}.org_id AND av.deleted_at IS NULL AND av.erased_at IS NULL
    AND LOWER(av.email) = LOWER(${a}.email) AND COALESCE(${a}.email, '') <> ''
    AND jsonb_exists(COALESCE(av.person_types, '[]'::jsonb), 'volunteer') AND ${ACTIVE_SQL("av")}
  ORDER BY av.created_at, av.id LIMIT 1)`;
// SQL: application `a` is waiting for a person's Approve or Decline.
const WAITING = (a = "a") => `(${a}.status = 'pending' AND ${VOLUNTEER_OF(a)} IS NULL)`;

// FRESH-3 item 5 (W-1126-Volunteers-02): what the applicant reads when the application closed as it
// arrived. "You're in." told an active volunteer they had just joined; and the coordinator's list showed
// only applications still pending, so one closed on arrival was listed nowhere. It is listed for
// RECENT_DAYS under Already a volunteer (routes/volunteerScheduling.js), with the person it went to.
const RECENT_DAYS = 30;
function alreadyBody(orgName, slug, esc) {
  return `<div class="card" data-testid="vol-apply-already"><h1>You're already one of our volunteers.</h1>
    <p>${esc(orgName)} has you on the team now, so there is nothing more to fill in. Your application is with your volunteer record, and the coordinator can see it.</p>
    <p class="small"><a href="/volunteer-with/${esc(slug)}">Back to the volunteer page</a></p></div>`;
}

const SENTENCE = "Already a volunteer: the email on this application belongs to someone who volunteers with you now, so there is nothing for you to approve.";

module.exports = { ACTOR, VOLUNTEER_OF, WAITING, SENTENCE, RECENT_DAYS, alreadyBody };
