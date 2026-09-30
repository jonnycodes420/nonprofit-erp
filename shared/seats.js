// shared/seats.js — FIX-10 Part F.
//
// ── HOW MANY USERS DOES A PLAN INCLUDE? ONE ANSWER. ────────────────────────
//
// Every plan sold today includes UNLIMITED users. `PLAN_LIMITS` in server.js
// gives each tier `seats: 999999999` and its own comment says so ("UNLIMITED
// USERS, on every tier, because that is what the page sells"), and the signup
// page says "there is no limit on users".
//
// Two other surfaces said something else. Onboarding's invite step read "Team
// includes up to 10 users", and its seat-limit fallback said the same thing
// again. Both were left over from the old Core/Team seat bands. The product
// was right and the onboarding was wrong, which is the worst way round: the
// first screen a new customer reads told her she had a cap she does not have,
// on the step where she is deciding whom to invite.
//
// So the answer lives HERE, once, and every surface says it from here. The
// figure and the sentence are the same fact stated two ways, because a limit
// check needs a number and a screen needs a sentence.
//
// Pure: no DB, no network, no clock, no JSX.

// The figure `PLAN_LIMITS` uses to mean "no limit". Infinity serialises to
// null in JSON, which is why it is a big number rather than Infinity.
export const SEATS_UNLIMITED = 999999999;

// Is this plan's seat figure "no limit"? A missing or zero figure is treated
// as unlimited too: on a product that sells unlimited users, an absent number
// must never be read as a cap.
export const seatsAreUnlimited = seats => {
  const n = Number(seats);
  return !Number.isFinite(n) || n <= 0 || n >= SEATS_UNLIMITED;
};

// The sentence a screen shows. One sentence, so onboarding, signup and Settings
// cannot each phrase it differently.
export const USERS_SENTENCE = "Every plan includes unlimited users.";

// The same fact as a clause, for a sentence that already has a subject.
export const USERS_PHRASE = "no limit on users";

// What to say when an invite is refused for seats. A plan that sells unlimited
// users should never reach this, so the sentence does not invent a cap: it says
// the invite did not go through and that nothing is wrong with her plan.
export const SEAT_REFUSED_SENTENCE =
  "That invitation did not go through. Every plan includes unlimited users, so this is not a limit on your plan. Try again, or write to us and we will sort it out.";

export default { SEATS_UNLIMITED, seatsAreUnlimited, USERS_SENTENCE, USERS_PHRASE, SEAT_REFUSED_SENTENCE };
