// shared/supporterPage.js — MEMBERS-2. THE SHAPE OF "YOUR PAGE".
//
// One page per person per org. It is the only place a supporter ever has to
// go, and it holds only what that person has: a membership, tickets, shifts,
// a fundraiser page, gifts and receipts.
//
// THE RULE THIS FILE EXISTS FOR: a section with nothing in it does not
// render. Not an empty state, not a "you have no tickets" card — nothing.
// A member who has never volunteered should not be told, on their own page,
// about a part of the organisation they have no relationship with; a page
// that is four empty boxes and one real one reads as a page that is broken.
//
// Pure: no DB, no clock of its own, no network. It decides what shows and
// what each number's sentence says; routes/supporter.js renders it.

export const SECTIONS = [
  { key: "membership",  title: "Your membership" },
  { key: "tickets",     title: "Your tickets" },
  { key: "shifts",      title: "Your shifts" },
  { key: "fundraising", title: "Your fundraising" },
  { key: "giving",      title: "Your giving" },
];

const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
                "August", "September", "October", "November", "December"];

// "14 March" — how a person says a date out loud, and how the membership
// sentence has to read. Civil text in, civil text out: never through a Date.
export function dayWords(civil) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(civil == null ? "" : civil).slice(0, 10));
  if (!m) return "";
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`;
}
export function dayWordsFull(civil) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(civil == null ? "" : civil).slice(0, 10));
  if (!m) return "";
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

export const money = cents => {
  const n = Number(cents || 0) / 100;
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
};

// THE MEMBERSHIP SENTENCE. Level, status and the date, said once, in a
// sentence rather than a row of labelled fields — this is the first thing a
// member reads on their own page and "Status: active" is not English.
//
// `autoRenew` changes the verb and nothing else: a membership that renews
// itself "renews on"; one that does not "runs through", because telling
// somebody their membership renews when it is about to lapse is the one
// mistake on this page that costs the org a member.
export function membershipSentence({ levelName, status, expiresOn, autoRenew = false, term = "12_months" }) {
  const lvl = String(levelName || "").trim() || "Member";
  if (term === "lifetime" || !expiresOn) return `Your ${lvl} membership does not expire.`;
  const when = dayWords(expiresOn);
  if (status === "lapsed")    return `Your ${lvl} membership lapsed on ${when}.`;
  if (status === "cancelled") return `Your ${lvl} membership was cancelled.`;
  if (status === "grace")     return `Your ${lvl} membership ran out on ${when}. There is still time to renew it.`;
  return autoRenew
    ? `Your ${lvl} membership renews on ${when}.`
    : `Your ${lvl} membership runs through ${when}.`;
}

// "Member since March 2024." Its own sentence, because it is the one number
// on this page that is about the person rather than about the money.
export function memberSinceSentence(joinedOn) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(joinedOn || "").slice(0, 10));
  if (!m) return "";
  return `Member since ${MONTHS[Number(m[2]) - 1]} ${m[1]}.`;
}

// The sentence under the giving total. Every number on a Steward screen comes
// with the one sentence that says what it counts, and a supporter's own page
// is not an exception — it is the screen where being wrong is most expensive.
export function givingSentence({ year }) {
  return `Every gift you have given, newest first. The total is what was charged, not what was deductible; each receipt states the deductible part${year ? ` for ${year}` : ""}.`;
}

export function recurringSentence({ amountCents, interval, status, nextOn }) {
  const amt = money(amountCents);
  const per = interval === "year" ? "a year" : "a month";
  if (status === "paused")   return `Your ${amt} ${per} gift is paused. Nothing is being charged.`;
  if (status === "canceled") return `Your ${amt} ${per} gift is cancelled. Nothing more will be charged.`;
  if (status === "past_due") return `Your ${amt} ${per} gift did not go through. Updating your card starts it again.`;
  return nextOn ? `You give ${amt} ${per}. The next one is ${dayWords(nextOn)}.` : `You give ${amt} ${per}.`;
}

// WHICH SECTIONS RENDER. `counts` is what the person actually has; a section
// is in the page only when its count is above zero. The order is fixed: it is
// the order of how close the thing is to happening.
export function sectionsFor(counts = {}) {
  return SECTIONS.filter(s => Number(counts[s.key] || 0) > 0);
}

// A page with nothing on it at all is not an empty page: it is a person whose
// email we know and whose records are somewhere else. Say so plainly rather
// than showing five headings and no content.
export function nothingYetLine(orgName) {
  return `There is nothing on your page yet. When ${orgName || "the organisation"} records a membership, a ticket, a shift or a gift for you, it appears here.`;
}

export const CARD_SENTENCE = "Show this at the door. The code is read by the organisation and says who you are; it carries nothing else.";
