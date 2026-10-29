// SEND-GATE-2 (28 Oct 2026) · WHICH EMAILS STEWARD SENDS ON ITS OWN, AND WHO
// TURNED EACH ONE ON.
//
// The rule, in Jonathan's words: nothing ever sends to a donor automatically
// without a clear flip of a switch from Jonathan (the org's Donor mail, in
// super-admin) AND from the org's director (the email type, in Steward). Both
// of them always see and know exactly what is going out.
//
// This file is the ONE list of every automatic donor email Steward can send.
// Each type names the send kinds (`_stewardKind`) that are it. sendGate.js
// reads a send's kind, finds its type here, and asks the org's switch for that
// type. A kind that is not here is either the sign-in link the donor asked for
// (EXEMPT), or mail that only goes when a person on staff presses Send
// (BY_HAND), and anything else is held. tests/send-gate-2.test.js fails if a
// send path uses a kind that is in none of the three lists, or if a type here
// names a kind that no path sends, so the page can never be out of date.
//
// Words on screen never say "type", "registry" or "audience": they say
// "which emails" and "who gets it".
"use strict";

const GROUPS = [
  { key: "gifts", label: "Gifts" },
  { key: "monthly", label: "Monthly giving" },
  { key: "pledges", label: "Pledges" },
  { key: "events", label: "Events and pages" },
  { key: "journeys", label: "Journeys and campaigns" },
];
// Membership renewals send nothing on their own: a renewal note is a journey
// step (the membership_renewal starter template) or a draft a person sends.
// The Memberships page shows the Journey steps switch for that reason.

// key       the stored name (org_mail_types.type_key). Never renamed.
// kinds     the `_stewardKind` values a send of this type carries.
// sentence  what it does and when, in one plain sentence.
// turnOn    the confirm's one sentence when it is turned on for everyone.
// offLine   what "off" means, for the one line in the place it is used.
// place     where in Steward the switch also shows (the editor).
const TYPES = [
  { key: "gift_receipt", group: "gifts", name: "Gift receipts", short: "receipts", kinds: ["receipt"],
    sentence: "When a gift comes in online, the donor gets a receipt by email within a minute.",
    turnOn: "Every online gift from now on will get a receipt by email.",
    offLine: "Receipts are off, so donors won't get one by email when they give online.",
    place: "Giving pages" },
  { key: "year_end", group: "gifts", name: "Year-end tax statements", short: "year-end statements", kinds: ["year_end"],
    sentence: "In January, each donor gets one statement of last year's gifts for their taxes.",
    turnOn: "Year-end statements will go by email to donors when you send them for the year.",
    offLine: "Year-end statements are off, so none go by email.",
    place: "Finance" },
  { key: "recovered_thankyou", group: "gifts", name: "Thank-you when a card works again", short: "card-worked thank-yous", kinds: ["recovered_thankyou"],
    sentence: "When a monthly gift that failed goes through again, the donor gets a short thank-you.",
    turnOn: "Donors whose failed monthly gift goes through again will get a thank-you by email.",
    offLine: "These thank-yous are off, so donors won't hear when a failed card works again.",
    place: "Monthly giving" },
  { key: "card_failed", group: "monthly", name: "Card failed", short: "card-failed notices", kinds: ["dunning"],
    sentence: "When a monthly gift's card is declined, the donor gets a note with a link to update it.",
    turnOn: "Donors whose monthly gift is declined will get a note with a link to update their card.",
    offLine: "Card-failed notes are off, so donors won't hear that a monthly gift was declined.",
    place: "Monthly giving" },
  { key: "card_expiring", group: "monthly", name: "Card expiring", short: "card-expiring notices", kinds: ["card_expiring"],
    sentence: "About two weeks before a monthly donor's card expires, they get a note asking them to update it.",
    turnOn: "Monthly donors whose card is about to expire will get a note asking them to update it.",
    offLine: "Card-expiring notes are off, so donors won't hear before their card runs out.",
    place: "Monthly giving" },
  { key: "recurring_change", group: "monthly", name: "Monthly gift changed", short: "monthly-gift changes", kinds: ["recurring_change", "portal_change"],
    sentence: "When a monthly gift is changed, paused or ended, the donor gets a short note saying what changed.",
    turnOn: "Donors will get a short note whenever their monthly gift is changed, paused or ended.",
    offLine: "Change notes are off, so donors won't get an email when their monthly gift changes.",
    place: "Monthly giving" },
  { key: "pledge_reminder", group: "pledges", name: "Pledge reminders", short: "pledge reminders", kinds: ["pledge_reminder"],
    sentence: "When a pledge is past due, the donor gets a friendly reminder, and up to three more over the next two weeks. Pledges brought in from a file never get one.",
    turnOn: "Every pledge that comes due from now on will get one reminder by email.",
    offLine: "Pledge reminders are off, so donors won't be reminded when a pledge is due.",
    place: "Pledges" },
  { key: "event_ticket", group: "events", name: "Event tickets and confirmations", short: "event confirmations", kinds: ["event_ticket"],
    sentence: "When someone registers or buys a ticket, they get a confirmation with their ticket.",
    turnOn: "Everyone who registers for an event from now on will get a confirmation by email.",
    offLine: "Ticket emails are off, so buyers won't get a confirmation.",
    place: "Event pages" },
  { key: "waitlist_offer", group: "events", name: "Waitlist offers", short: "waitlist offers", kinds: ["event_waitlist_offer"],
    sentence: "When a place comes free at a full event, the next person on the waitlist gets an email offering it.",
    turnOn: "People on an event's waitlist will get an email when a place comes free.",
    offLine: "Waitlist offers are off, so nobody on a waitlist hears when a place frees up.",
    place: "Event pages" },
  { key: "auction_signin", group: "events", name: "Auction sign-in links", short: "auction sign-in links", kinds: ["auction_signin"],
    sentence: "When a bidder asks to bid from another phone, they get a sign-in link by email.",
    turnOn: "Bidders who ask for a sign-in link will get it by email.",
    offLine: "Auction sign-in links are off, so a bidder can't sign in on a second phone by email.",
    place: "Auctions" },
  { key: "p2p_link", group: "events", name: "Fundraiser page links", short: "fundraiser page links", kinds: ["your_page_link", "fundraiser_manage", "fundraiser_manage_link"],
    sentence: "When someone starts a peer-to-peer page, or asks for their link again, they get a link to manage it.",
    turnOn: "People who start a fundraiser page, or ask for its link, will get it by email.",
    offLine: "Fundraiser page links are off, so fundraisers won't get their page link by email.",
    place: "Peer-to-peer" },
  { key: "journey_steps", group: "journeys", name: "Journey and sequence steps", short: "journey steps", kinds: ["sequence"],
    sentence: "The email steps you set to send on their own in a journey or sequence go on their day. Each journey's steps also have their own switch.",
    turnOn: "Journey and sequence steps set to send on their own will go on their day.",
    offLine: "Journey emails are off, so steps set to send on their own will wait.",
    place: "Journeys" },
  { key: "campaign", group: "journeys", name: "Campaign emails", short: "campaign emails", kinds: ["campaign"],
    sentence: "A campaign email you schedule goes out at the time you picked.",
    turnOn: "Campaign emails you schedule will go out at the time you picked.",
    offLine: "Campaign emails are off, so a scheduled campaign will wait.",
    place: "Campaigns" },
];

// The one email that is not a switch: the sign-in link the donor asked for,
// seconds ago, on the giving page or portal.
const EXEMPT = {
  express_link: "Donor portal sign-in links",
};
const EXEMPT_SENTENCE = "Always sent, because the donor asked for it.";

// Mail that goes only when a person on staff presses Send for that one message
// (sendGate.js arm 2). Without that press it is held, never sent.
const BY_HAND = {
  milestone: "Notes you write and send",
  auction_winner: "Auction pay links",
  volunteer_link: "Volunteer page links",
  volunteer_reminder: "Volunteer shift reminders",
  gift_unfinished: "Unfinished-gift notes",
  reconnect: "Reconnect-your-gift notes",
  supporter: "Other notes you send",
};

const AUDIENCES = ["everyone", "chosen"];
const MODES = ["follows", "always", "never"];   // the donor's own setting

const BY_KEY = Object.fromEntries(TYPES.map(t => [t.key, t]));
const KIND_TO_TYPE = {};
for (const t of TYPES) for (const k of t.kinds) KIND_TO_TYPE[k] = t.key;

function typeOfKind(kind) { return KIND_TO_TYPE[String(kind || "")] || null; }
function isKnownKind(kind) {
  const k = String(kind || "");
  return !!KIND_TO_TYPE[k] || k in EXEMPT || k in BY_HAND;
}

// A donor's setting, from the two columns (donors.auto_email = Always include,
// donors.auto_email_never = Never; neither = Follows your settings).
function modeOf(row) {
  if (!row) return "follows";
  if (row.auto_email_never === true) return "never";
  if (row.auto_email === true) return "always";
  return "follows";
}

// THE RULE for one person and one type. `type` is the org's row for it
// ({ on, audience }) or null (off since created). `mailOn` is Jonathan's
// switch. Returns null to send, or the reason it is held.
function holdReason({ mailOn, type, mode, skipped = false }) {
  if (!mailOn) return "org_mail_off";
  if (!type || type.on !== true) return "type_off";
  if (mode === "never") return "donor_never";
  if (skipped) return "skipped";
  if (type && type.audience === "chosen" && mode !== "always") return "not_chosen";
  return null;
}

// The words for each reason, for the Held list and the profile's held line.
function reasonSentence(reason, t) {
  const name = t ? t.short : "these emails";
  switch (reason) {
    case "org_mail_off": return "email is off for your organization";
    case "type_off": return `${name} are off for your organization`;
    case "donor_never": return "this person is set to Never";
    case "not_chosen": return `${name} go only to donors you choose, and this person isn't one`;
    case "skipped": return "you skipped this person";
    case "by_hand": return "this kind of email goes only when someone presses Send";
    // FIX-57 item 4
    case "no_org_address": return "it needs your mailing address. Add your mailing address in Settings, then send it again";
    case "placeholder": return "it still has a blank in it (like [org address]). Fill it in, then send it again";
    default: return "automatic emails are off";
  }
}

const WAITING = "Waiting for Steward to turn email on";
const ORG_OFF_TOP = "Email is off for your organization, so nothing on this page sends yet. Steward turns it on with you once your data is in.";

module.exports = { GROUPS, TYPES, BY_KEY, EXEMPT, EXEMPT_SENTENCE, BY_HAND, AUDIENCES, MODES, KIND_TO_TYPE,
  typeOfKind, isKnownKind, modeOf, holdReason, reasonSentence, WAITING, ORG_OFF_TOP };
