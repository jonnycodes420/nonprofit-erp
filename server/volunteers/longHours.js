// INPUT-1 item 5 · ONE ENTRY OF MORE THAN 16 HOURS ASKS FIRST.
// Nobody gives 24 hours in one shift often; a typo does it every day (2.4
// typed as 24). Over 16 hours, the entry answers 409 with the question, and
// the form sends it again with `confirmLong: true` once she says it is right.
// Never blocked outright: a weekend retreat is real.
"use strict";
const LONG_HOURS = 16;

function longHoursQuestion(hundredths, body) {
  if (!(Number(hundredths) > LONG_HOURS * 100) || (body && body.confirmLong === true)) return null;
  const h = Number(hundredths) / 100;
  const sentence = `That is ${h} hours in one entry. Is that right?`;
  return { error: sentence, code: "long_hours", hours: h, sentence, yes: `Yes, ${h} hours`, no: "Change it" };
}

module.exports = { LONG_HOURS, longHoursQuestion };
