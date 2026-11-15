// server/shared/journeySchedule.js · FLOWS-12 item 4 (W-1114-Fundraising-28X).
// WHEN A PERSON'S JOURNEY STEPS FALL, FROM ONE FUNCTION.
//
// The batch preview for three people quoted Oct 31, 2027 for all three while
// Margaret Chen's own step was due Oct 29, 2027: the preview dated everyone
// from the first person's day (a birthday journey counts from each person's
// own birthday), while the start dated each person from theirs. Now the start
// (journeyStart.js maybeStartJourney) and the preview
// (server/outreach/journeyBatchPeople.js) both ask this, person by person, so
// the date a preview shows is the date the step is written with.
"use strict";
const orgTime = require("../../orgTime");

// template: the journey row (trigger_key, trigger_filters). steps: its
// validated steps (planShape.validateTemplate). person: the donor row (with
// birth_month, birth_day). byHand: a by-hand start of a dated journey counts
// from its own date (FLOWS-3); a triggered start counts from today.
async function scheduleFor({ template, steps, person, today, byHand = true }) {
  const JR = await import("../../shared/journeyStartRule.js");
  const PL = await import("../../shared/planShape.js");
  const anchor = byHand ? JR.journeyAnchor(template, person, today) : today;
  return { anchor, steps: PL.planFromTemplate({ steps, today: anchor }, orgTime.addDays) };
}

// The first step only, for a preview: { label, dueDate } or null.
async function firstStepFor(args) {
  const { anchor, steps } = await scheduleFor(args);
  return { anchor, first: steps[0] ? { label: steps[0].label, dueDate: steps[0].dueDate } : null };
}

module.exports = { scheduleFor, firstStepFor };
