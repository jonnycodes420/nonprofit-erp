// shared/p2p.js — BUILD-103. WHAT PEER-TO-PEER SAYS, AND WHAT IT REFUSES TO.
//
// Supporters raising money for the org from their own networks: a walk, a
// ride, a birthday, a church team. The machinery underneath it already
// existed; what this file holds is the part that has to be the same on the
// fundraiser's dashboard, the org's screen and the public page — the words,
// the arithmetic and the two things a fundraiser is never shown.
//
// THE TWO THINGS. A fundraiser never sees a donor's email, and never sees a
// gift the donor made to the organisation outside this page. `donorLine`
// below is the ONLY thing that turns a gift row into something a fundraiser
// reads, and it takes a first name and an amount or it takes neither.
//
// Pure: no DB, no clock of its own, no network.

export const TEAM_STATUSES = ["active", "archived"];
export const MAX_TEAM_NAME = 80;
export const MAX_STORY = 5000;

export const money = cents => {
  const n = Math.round(Number(cents) || 0) / 100;
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
};

const firstNameOf = name => String(name || "").trim().split(/\s+/)[0] || "";

// ── WHAT A FUNDRAISER MAY READ OF A GIFT ─────────────────────────────────
// A first name and an amount, and only when the donor said so. Everything
// else — surname, email, address, what they have given before, what they gave
// the organisation elsewhere — is not the fundraiser's to have, and the way
// to be certain of that is for there to be exactly one function that decides.
//
// `showName` false is the DEFAULT, on purpose. A gift given through a
// friend's page is still a gift to the organisation, and the friend is not
// entitled to a list of who gave unless each person chose it.
export function donorLine({ donorName, amountCents, showName, date }) {
  return {
    who: showName && firstNameOf(donorName) ? firstNameOf(donorName) : "Someone",
    amount: money(amountCents),
    amountCents: Math.round(Number(amountCents) || 0),
    date: String(date == null ? "" : date).slice(0, 10),
  };
}

// ── THE SENTENCE UNDER EVERY NUMBER ──────────────────────────────────────
export function raisedSentence({ raisedCents, goalCents }) {
  const raised = money(raisedCents);
  if (!goalCents) return `${raised} raised through your page. It counts every gift given through your own link, as it arrives.`;
  const pct = Math.round((Number(raisedCents) / Number(goalCents)) * 100);
  const left = Number(goalCents) - Number(raisedCents);
  return left > 0
    ? `${raised} of your ${money(goalCents)} goal, ${pct}% of the way. ${money(left)} to go.`
    : `${raised} of your ${money(goalCents)} goal. You are past it by ${money(-left)}.`;
}

export function teamSentence({ teamName, raisedCents, goalCents, memberCount }) {
  const base = `${teamName} has raised ${money(raisedCents)} between ${memberCount} ${memberCount === 1 ? "fundraiser" : "fundraisers"}`;
  return goalCents ? `${base}, against a goal of ${money(goalCents)}.` : `${base}.`;
}

export const PAGE_TOTAL_SENTENCE =
  "Everything given through this campaign: gifts through a team, gifts through a fundraiser with no team, and gifts given to the page directly. Every gift is counted once, in cents.";

export const NOT_YET_SENTENCE =
  "Fundraisers who have signed up and have not received a gift yet. This is the list to pick up the phone about; nobody is emailed from here.";

export const SOFT_CREDIT_SENTENCE =
  "A soft credit records that this person brought the gift in. The money stays counted once, on the person who gave it: nothing here changes any total.";

// ── SLUGS ────────────────────────────────────────────────────────────────
export function teamSlug(name) {
  return String(name || "").toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "team";
}

export function validateTeam(raw) {
  const errors = [];
  const name = String(raw?.name || "").trim().slice(0, MAX_TEAM_NAME);
  if (!name) errors.push("a team needs a name");
  const goalRaw = raw?.goalAmount;
  let goalCents = null;
  if (goalRaw !== undefined && goalRaw !== null && goalRaw !== "") {
    const n = Number(goalRaw);
    if (!Number.isFinite(n) || n <= 0) errors.push("a team goal is a number greater than zero, or none at all");
    else goalCents = Math.round(n * 100);
  }
  return errors.length ? { ok: false, errors } : { ok: true, team: { name, slug: teamSlug(name), goalCents } };
}

// ── THE THREE DRAFTS A FUNDRAISER SENDS THEMSELVES ───────────────────────
// Steward sends NOTHING to a fundraiser's contacts. These are words the
// fundraiser copies, or opens in their own mail client through a mailto:, and
// sends from their own inbox with their own name on it.
//
// The merge fields are the FUNDRAISER'S: their name, their goal, what they
// have raised, their link. A donor's details are not available to this
// function and never will be — that is why it takes no donor argument.
export function drafts({ fundraiserName, orgName, causeName, goalCents, raisedCents, link }) {
  const first = firstNameOf(fundraiserName) || "I";
  const goal = goalCents ? money(goalCents) : null;
  const raised = money(raisedCents);
  const cause = causeName || orgName;
  return [
    {
      key: "launch",
      label: "The ask",
      when: "Send this first, to the people who would want to know.",
      subject: `I'm raising money for ${cause}`,
      body: [
        `Hi,`,
        ``,
        `I'm raising money for ${cause}${goal ? `, and I've set myself a goal of ${goal}` : ""}.`,
        ``,
        `If you can give anything at all, it goes straight to ${orgName}, not to me, and you can do it here:`,
        link,
        ``,
        `Thank you,`,
        fundraiserName,
      ].join("\n"),
    },
    {
      key: "halfway",
      label: "The nudge",
      when: "Send this when you are part of the way there. It works because it is specific.",
      subject: `${raised} so far for ${cause}`,
      body: [
        `Hi,`,
        ``,
        `${raised} so far${goal ? ` towards ${goal}` : ""} for ${cause}. Thank you to everybody who has given.`,
        ``,
        goal ? `Still some way to go, and every bit counts:` : `If you have been meaning to, here is the link:`,
        link,
        ``,
        `Thank you,`,
        fundraiserName,
      ].join("\n"),
    },
    {
      key: "thanks",
      label: "The thank-you",
      when: "Send this at the end, to everybody, whether they gave or not.",
      subject: `Thank you. ${raised} for ${cause}`,
      body: [
        `Hi,`,
        ``,
        `We finished at ${raised} for ${cause}. Thank you, genuinely.`,
        ``,
        `Every bit of it goes to ${orgName}, and it will do real work.`,
        ``,
        `${first}`,
      ].join("\n"),
    },
  ];
}

// ── SHARING ──────────────────────────────────────────────────────────────
// Every share link carries UTM tags, so attribution sees where a gift came
// from through the same columns every other gift is attributed by. The medium
// is the channel; the campaign is the fundraiser's own slug, because "which
// of my fundraisers brought this in" is the question the org asks.
export function shareLinks({ link, fundraiserSlug, text }) {
  const tagged = medium => {
    const u = new URL(link);
    u.searchParams.set("utm_source", "peer");
    u.searchParams.set("utm_medium", medium);
    u.searchParams.set("utm_campaign", fundraiserSlug || "fundraiser");
    return u.toString();
  };
  const msg = text || "I'm raising money for a cause I care about.";
  return {
    copy: tagged("copy"),
    text: `sms:?&body=${encodeURIComponent(`${msg} ${tagged("sms")}`)}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(tagged("facebook"))}`,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(`${msg} ${tagged("whatsapp")}`)}`,
    email: `mailto:?subject=${encodeURIComponent(msg)}&body=${encodeURIComponent(`${msg}\n\n${tagged("email")}`)}`,
  };
}

// A mailto: for one of the drafts above. The fundraiser's own mail client
// opens with the words already in it; Steward never touches the send.
export function mailtoFor(draft) {
  return `mailto:?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`;
}

// ── PARITY-2 Part 2 · THE PUBLIC CAMPAIGN PAGE ───────────────────────────
// A fundraiser page is 'active' (public, takes gifts), 'pending' (waiting for
// a staff member to approve it; the page asked for approval) or 'archived'
// (taken down). Only 'active' is ever shown to the public or takes a gift.
export const FUNDRAISER_STATUSES = ["active", "pending", "archived"];

// THE NUMBER BESIDE THE THERMOMETER. Computed once, on the server, over the
// same gift rows the bar sums; this is the sentence that defines it.
export const DONOR_COUNT_SENTENCE =
  "Each person who has given to this campaign counts once, however many gifts they made, including gifts given through a supporter's own page.";

export function donorCountLine(n) {
  const c = Math.max(0, Math.round(Number(n) || 0));
  return c === 1 ? "1 donor" : `${c.toLocaleString("en-US")} donors`;
}

// The goal bar on a fundraiser's own public page, in a stranger's voice
// (raisedSentence above is in the fundraiser's own voice, for their dashboard).
export function publicRaisedSentence({ name, raisedCents, goalCents }) {
  const first = firstNameOf(name) || "This fundraiser";
  const raised = money(raisedCents);
  const what = `Every gift given through ${first}'s page, as it arrives. It all goes to the organisation.`;
  if (!goalCents) return `${raised} raised. ${what}`;
  const left = Number(goalCents) - Number(raisedCents);
  return left > 0
    ? `${raised} of ${first}'s ${money(goalCents)} goal. ${what}`
    : `${raised}, past ${first}'s ${money(goalCents)} goal. ${what}`;
}

export const LEADERBOARD_SENTENCE =
  "Ranked by what each page has raised, summed live from the gifts given through it. A team's total is every gift through its members' pages.";

export const RECENT_DONORS_SENTENCE =
  "Gifts given through this page, newest first. A first name shows only where the donor chose to show it; everybody else is Anonymous.";

// ── COACHING: WORDS STAFF SEND A FUNDRAISER ──────────────────────────────
// The four moments a fundraiser most often needs a word from the office: the
// welcome, the nudge at halfway, the last days and the thank-you. Steward
// sends none of these. A staff member reads one, changes what they like, and
// sends it from their own mail client (a mailto:) or copies it. The merge
// fields are the fundraiser's own; this function takes no donor and so cannot
// leak one.
export function coachDrafts({ fundraiserName, orgName, causeName, goalCents, raisedCents, link, daysLeft = null, staffName = "" }) {
  const first = firstNameOf(fundraiserName) || "there";
  const cause = causeName || orgName;
  const goal = goalCents ? money(goalCents) : null;
  const raised = money(raisedCents);
  const sign = staffName ? staffName : `The team at ${orgName}`;
  const pct = goalCents ? Math.round((Number(raisedCents) / Number(goalCents)) * 100) : null;
  const left = goalCents ? Math.max(0, Number(goalCents) - Number(raisedCents)) : null;
  const daysWords = daysLeft == null ? "the last few days" : daysLeft <= 0 ? "the last day" : daysLeft === 1 ? "one day" : `${daysLeft} days`;
  return [
    {
      key: "welcome",
      label: "Welcome",
      when: "Send when they sign up. The first gift usually comes from the first three people they ask.",
      subject: `Thank you for fundraising for ${cause}`,
      body: [
        `Hi ${first},`,
        ``,
        `Thank you for starting a page for ${cause}. Here it is, ready to share:`,
        link,
        ``,
        `The fastest start is three messages today to the people closest to you. Your page has a few words ready to copy if that helps.`,
        ``,
        `If you have any questions, just reply.`,
        ``,
        sign,
      ].join("\n"),
    },
    {
      key: "halfway",
      label: "Halfway nudge",
      when: goal ? `Send when they reach about half of their goal${pct != null ? ` (they are at ${pct}% now)` : ""}.` : "Send once a few gifts have come in.",
      subject: `${raised} so far. You are doing brilliantly`,
      body: [
        `Hi ${first},`,
        ``,
        `${raised} raised for ${cause}${goal ? `, which is ${pct}% of your ${goal} goal` : ""}. Thank you.`,
        ``,
        goal ? `${money(left)} to go. A short update to the people who have not given yet, saying how far you have come, tends to bring in the next few gifts.` : `A short update to the people who have not given yet, saying how far you have come, tends to bring in the next few gifts.`,
        link,
        ``,
        sign,
      ].join("\n"),
    },
    {
      key: "lastdays",
      label: "Last days",
      when: "Send in the final week. A deadline is the most persuasive thing a page can say.",
      subject: `${daysWords === "the last day" ? "The last day" : `${daysWords.charAt(0).toUpperCase() + daysWords.slice(1)} left`} for ${cause}`,
      body: [
        `Hi ${first},`,
        ``,
        `There ${daysLeft === 1 ? "is" : "are"} ${daysWords} left on ${cause}, and you have raised ${raised}${goal ? ` of your ${goal}` : ""}.`,
        ``,
        `One last message to anyone who meant to give and has not yet, with the date in it, is usually the best-performing message of the whole campaign.`,
        link,
        ``,
        sign,
      ].join("\n"),
    },
    {
      key: "thanks",
      label: "Thank you",
      when: "Send when the campaign closes, whatever they raised.",
      subject: `Thank you, ${first}`,
      body: [
        `Hi ${first},`,
        ``,
        `${cause} has closed, and your page raised ${raised}. Every bit of it goes to ${orgName}, and it will do real work.`,
        ``,
        `Thank you for asking the people you know. It is not an easy thing to do, and you did it.`,
        ``,
        sign,
      ].join("\n"),
    },
  ];
}

// A mailto: TO the fundraiser, for staff. The staff member's own mail client
// opens with the words in it; Steward never touches the send.
export function coachMailto(email, draft) {
  return `mailto:${encodeURIComponent(String(email || "")).replace(/%40/g, "@")}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`;
}
