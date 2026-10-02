// shared/campaignPage.js — CAMPAIGN-2. A CAMPAIGN'S PUBLIC PAGE, AND ITS PLAN.
//
// ── A CAMPAIGN PAGE IS A GIVING PAGE ──────────────────────────────────────
// There is no second kind of public page and there is not going to be one.
// BUILD-95 §5B settled that a public giving page is `giving_pages` plus a
// widget list, BUILD-103 added peer-to-peer to the same row, and
// `giving_pages.campaign_id` already makes a page's thermometer the CAMPAIGN's
// (the attribution FIX of 2026-08-04). A campaign's page is therefore a giving
// page pointed at it, created from a template — which is also what makes
// peer-to-peer fundraisers roll into the same bar for free, because they
// already roll into the page's.
//
// What this module holds is the part that is not already built: the two
// starting points an organisation actually asks for by name, the words on the
// page, and the plan of dated reminders that turns "GivingTuesday" from a blank
// page into a fortnight of work somebody can do.
//
// ── THE PLAN IS REMINDERS, AND NOTHING IS SENT ────────────────────────────
// Every step here becomes a dated staff task. Not an email, not a scheduled
// send, not a draft that goes out on a timer: a line on somebody's list, which
// they do or do not do. "She wrote every word, she turned it on, and each send
// is hers" is the standing rule and a campaign template is exactly the sort of
// thing that quietly breaks it.
//
// Pure: integer cents, civil date strings, no DB, no clock of its own (the
// caller passes today), no network, no JSX.

// ── GIVINGTUESDAY ─────────────────────────────────────────────────────────
// The Tuesday after US Thanksgiving, which is the fourth Thursday of November.
// It moves every year, so it is computed rather than listed: a hard-coded table
// is a thing that silently stops being true, and this one would stop being true
// on a date the whole campaign is about.
export function thanksgivingDate(year) {
  let thursdays = 0;
  for (let day = 1; day <= 30; day++) {
    const d = new Date(Date.UTC(year, 10, day));
    if (d.getUTCDay() === 4 && ++thursdays === 4) return d.toISOString().slice(0, 10);
  }
  return null;
}

export function givingTuesdayDate(year) {
  const t = thanksgivingDate(year);
  if (!t) return null;
  const d = new Date(t + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 5);          // Thursday + 5 = the following Tuesday
  return d.toISOString().slice(0, 10);
}

export function addDays(dateStr, n) {
  const d = new Date(String(dateStr).slice(0, 10) + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + Number(n || 0));
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from, to) {
  const a = new Date(String(from).slice(0, 10) + "T00:00:00Z");
  const b = new Date(String(to).slice(0, 10) + "T00:00:00Z");
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.round((b - a) / 86400000);
}

const money = cents => {
  const n = Math.round(Number(cents) || 0) / 100;
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
};

// ── THE TWO TEMPLATES ─────────────────────────────────────────────────────
// Deliberately two, and deliberately these two. They are the two moments a
// small shop runs a campaign it did not design: the one everybody runs on the
// same day, and the one that lands in the last week of December. Anything else
// is a campaign the organisation already has its own reason for, and a starter
// page would be in the way.
//
// Each template answers three questions and no more: when it runs, what the
// page says, and what somebody has to do and by when.
export const TEMPLATES = [
  {
    key: "givingtuesday",
    label: "GivingTuesday",
    blurb: "The global day of giving, the Tuesday after US Thanksgiving. One day, one ask, and the thank-yous out within 48 hours.",
    // The day itself; the campaign opens two weeks before and closes a week after.
    anchor: today => givingTuesdayDate(Number(String(today).slice(0, 4))),
    // If this year's has already passed, next year's is the honest answer.
    rollForward: true,
    window: anchor => ({ start: addDays(anchor, -14), end: addDays(anchor, 7) }),
    page: ({ orgName }) => ({
      titleFor: year => `GivingTuesday ${year}`,
      slugFor: year => `givingtuesday-${year}`,
      story: `On GivingTuesday, people all over the world give to the causes they believe in. ${orgName} is one of them, and one day is all we are asking for.\n\nWrite two or three sentences here about what this year's gifts will pay for. Say the thing you would say to somebody across a table, and name a number if you have one.`,
      headline: "One day. One ask.",
    }),
    plan: anchor => ([
      { at: addDays(anchor, -14), title: "Draft the GivingTuesday appeal", type: "email",
        detail: "One email, one ask, one link to the campaign page. Write it now so the week of is not the week you write it." },
      { at: addDays(anchor, -10), title: "Line up a matching gift", type: "donor",
        detail: "Ask one board member or one major donor to match the day up to a number they choose. A match is the single biggest thing that moves a one-day campaign, and it has to be asked for in advance." },
      { at: addDays(anchor, -7), title: "Write the three social posts", type: "email",
        detail: "Morning, midday and evening of the day itself. Same link, three different reasons." },
      { at: addDays(anchor, -2), title: "Send the heads-up email", type: "email",
        detail: "Short. It says what is coming and when, and it is not the ask." },
      { at: anchor, title: "GivingTuesday: send the appeal, post through the day", type: "email",
        detail: "The appeal in the morning, the posts through the day, and a short progress note in the evening if the page is close to its goal." },
      { at: addDays(anchor, 1), title: "Thank every GivingTuesday donor", type: "donor",
        detail: "Within 48 hours. This is the step the whole thing is for: a donor thanked inside two days gives again at nearly twice the rate of one thanked in two weeks." },
      { at: addDays(anchor, 7), title: "Close the campaign and write down what happened", type: "donor",
        detail: "What it raised, who was new, what the match brought in, and the one thing you would do differently. Next year's plan is this note." },
    ]),
  },
  {
    key: "yearend",
    label: "Year-end",
    blurb: "The last six weeks of the year, when a third of annual giving arrives and most of it in the last three days.",
    anchor: today => `${String(today).slice(0, 4)}-12-31`,
    rollForward: true,
    window: anchor => ({ start: addDays(anchor, -45), end: anchor }),
    page: ({ orgName }) => ({
      titleFor: year => `Year-end ${year}`,
      slugFor: year => `year-end-${year}`,
      story: `This is the last chance to give to ${orgName} in this tax year.\n\nWrite two or three sentences here about what this year made possible and what next year needs. The year-end ask that works is the one that looks back before it looks forward.`,
      headline: "Before the year is out.",
    }),
    plan: anchor => ([
      { at: addDays(anchor, -45), title: "Draft the year-end letter", type: "email",
        detail: "The one that goes in the post as well as the inbox. It looks back at the year before it asks for anything." },
      { at: addDays(anchor, -38), title: "Pull the mailing list and check the addresses", type: "donor",
        detail: "Anyone who has given in the last three years, plus this year's new donors. Fix the returns from last year's mailing before you print." },
      { at: addDays(anchor, -30), title: "Post the year-end letter", type: "donor",
        detail: "It has to be in a letterbox by the first week of December or it arrives with the Christmas cards." },
      { at: addDays(anchor, -21), title: "Send the first year-end email", type: "email",
        detail: "Same words as the letter, shorter, with the link." },
      { at: addDays(anchor, -10), title: "Call the ten largest donors who have not given this year", type: "call",
        detail: "Not an email. Ten calls in two days is the highest-return fortnight of the year." },
      { at: addDays(anchor, -3), title: "Send the last-chance email", type: "email",
        detail: "Most year-end giving arrives in the last three days, and a good share of it on the 31st. One short email, the deadline, the link." },
      { at: addDays(anchor, 2), title: "Thank every year-end donor", type: "donor",
        detail: "Before the receipts go out in January. A receipt is not a thank-you." },
      { at: addDays(anchor, 20), title: "Send the year-end statements", type: "donor",
        detail: "Every donor's giving for the year, in one letter, in time for their tax return." },
    ]),
  },
];

export const TEMPLATE_KEYS = TEMPLATES.map(t => t.key);
export function template(key) { return TEMPLATES.find(t => t.key === String(key)) || null; }

// ── WHAT A TEMPLATE PRODUCES ──────────────────────────────────────────────
// One function, so the preview an organisation reads before pressing the
// button and the rows the button writes are the same thing derived once.
//
// `today` is the ORG's civil date. A template whose day has already gone this
// year rolls to next year's, because the alternative is standing up a campaign
// that ended a fortnight ago.
export function planFor(key, { today, orgName = "this organisation" } = {}) {
  const t = template(key);
  if (!t) return null;
  let anchor = t.anchor(today);
  if (t.rollForward && anchor && anchor < String(today).slice(0, 10)) {
    anchor = t.anchor(`${Number(String(today).slice(0, 4)) + 1}-01-01`);
  }
  if (!anchor) return null;
  const year = Number(anchor.slice(0, 4));
  const w = t.window(anchor);
  const pg = t.page({ orgName });
  return {
    key: t.key,
    label: t.label,
    blurb: t.blurb,
    // ── THE FORM THE PAGE OPENS WITH ───────────────────────────────────────
    // A campaign page created from a template gets a CONFIGURED form, which is
    // what makes it the three-step Steward Give form rather than the one every
    // unbuilt giving page has always had. That matters here and not elsewhere:
    // the name-on-the-page question only exists on the configured form, so a
    // template that left `form_config` null would stand up a page with a
    // recent-gifts list and no way for a donor to join it. (The browser walk
    // found exactly that.)
    //
    // Smart amounts ON, because a campaign page is the surface most likely to
    // be opened by somebody the organisation already knows.
    formConfig: {
      amountsCents: [2500, 5000, 10000, 25000],
      smartAmounts: true,
      allowOther: true,
      defaultFrequency: "once",
      offerMonthly: true,
      designation: { mode: "none", fundId: null, fundIds: [] },
      showTribute: false,
      showEmployerMatch: true,
      questions: [],
      thankYou: { message: "", redirectUrl: "" },
      headline: pg.headline,
    },
    anchor,
    year,
    campaign: { name: pg.titleFor(year), startDate: w.start, endDate: w.end },
    page: { title: pg.titleFor(year), slug: pg.slugFor(year), story: pg.story, headline: pg.headline },
    // Every step is a DATED REMINDER FOR A PERSON. Nothing here sends anything.
    steps: t.plan(anchor).map(s => ({ ...s, due: s.at })),
  };
}

// ── WHAT A STRANGER MAY READ OF SOMEBODY ELSE'S GIFT ──────────────────────
// A first name, and only when that donor chose it, gift by gift. Everything
// else — surname, email, town, what they have given before — is not the
// public's to have, and the way to be sure of that is for one function to be
// the only thing that turns a gift row into a line on a page.
//
// `showName` false is the DEFAULT and the default IS the decision: a gift to an
// organisation is not a public act unless the person giving it says so. The
// name when they did not is "Anonymous", which is the word a donor expects to
// see and is not a hint that there is a name behind it.
//
// THE AMOUNT IS THE ORG'S CALL, not the donor's, and it is off unless they turn
// it on — the size of a gift beside a name is a second disclosure and a
// different conversation. With amounts off, nothing numeric leaves this
// function at all, so a page cannot leak one by rendering a field it was handed.
export const ANONYMOUS = "Anonymous";

export function publicGiftLine({ donorName, amountCents, showName, date }, { showAmounts = false } = {}) {
  const first = String(donorName || "").trim().split(/\s+/)[0] || "";
  return {
    who: showName && first ? first : ANONYMOUS,
    date: String(date == null ? "" : date).slice(0, 10),
    ...(showAmounts ? { amount: money(amountCents), amountCents: Math.round(Number(amountCents) || 0) } : {}),
  };
}

export const RECENT_GIFTS_DEFINITION =
  "The most recent gifts recorded to this campaign. A first name appears only where that donor chose to show it; everybody else is Anonymous, and nothing else about anybody is shown.";

// ── THE SENTENCE UNDER THE GOAL BAR ───────────────────────────────────────
// Every number has a sentence, and a thermometer is the number a stranger is
// most likely to doubt. It says WHAT IT COUNTS, including the two things people
// assume it does not: a cheque somebody posted, and a gift given through a
// friend's own fundraising page.
export function goalBarSentence({ raisedCents, goalCents, hasPeerPages = false }) {
  const raised = money(raisedCents);
  const where = hasPeerPages
    ? "Every gift recorded to this campaign, online and offline, including gifts given through a supporter's own page."
    : "Every gift recorded to this campaign, online and offline.";
  if (!goalCents) return `${raised} raised. ${where}`;
  const left = Number(goalCents) - Number(raisedCents);
  const pct = Math.round((Number(raisedCents) / Number(goalCents)) * 100);
  return left > 0
    ? `${raised} of ${money(goalCents)}, ${pct}% of the way. ${where}`
    : `${raised} of ${money(goalCents)}, past the goal by ${money(-left)}. ${where}`;
}

// ── THE COUNTDOWN ─────────────────────────────────────────────────────────
// Days, in words, and it stops rather than going negative. A campaign page that
// says "-4 days left" is a page nobody has looked at since it closed.
export function countdownSentence(endDate, today) {
  if (!endDate) return null;
  const n = daysBetween(today, endDate);
  if (n === null) return null;
  if (n < 0) return "This campaign has closed. Thank you to everybody who gave.";
  if (n === 0) return "Today is the last day.";
  if (n === 1) return "One day left.";
  if (n <= 14) return `${n} days left.`;
  const weeks = Math.round(n / 7);
  return `${weeks} week${weeks === 1 ? "" : "s"} left.`;
}

// ── THE MATCHING CHALLENGE ────────────────────────────────────────────────
// It is shown ONLY when the organisation has entered one, and it says what it
// is worth and what is left of it — because a match that has already been
// exhausted and is still on the page is a claim that has stopped being true.
export function matchSentence({ matchCents = 0, raisedSinceMatchCents = 0, sponsor = "" } = {}) {
  const pot = Math.max(0, Math.round(Number(matchCents) || 0));
  if (!pot) return null;
  const used = Math.min(pot, Math.max(0, Math.round(Number(raisedSinceMatchCents) || 0)));
  const left = pot - used;
  const who = String(sponsor || "").trim();
  const head = who ? `${who} is doubling every gift up to ${money(pot)}.` : `Every gift is doubled up to ${money(pot)}.`;
  if (left <= 0) return `${head} The match has been met in full, and every gift from here is still a gift.`;
  return `${head} ${money(left)} of it is still unclaimed, so a gift now is worth twice as much.`;
}

// A GIFT ON THE DAY THE MATCH BEGAN COUNTS AGAINST IT. `gifts.date` is a civil
// date, so "the same day" is the finest the record gets, and counting the whole
// day can only ever say LESS of the match is left than really is. That errs
// against the organisation rather than against a donor deciding whether their
// gift will be doubled, which is the only direction this number is allowed to
// be wrong in.
export const MATCH_DEFINITION =
  "A match is money somebody has promised to give alongside other people's gifts, up to a limit they set. Steward shows what is left of it from the gifts recorded to this campaign since the match began; it does not collect the match, and the organisation records that gift like any other.";
