// LANDING-4 · the approved language (docs/MESSAGING.md), in one place. Every
// page that opens with a pillar reads it from here, so the words cannot drift
// apart. Pure data: Node imports it (tests/landing2-marketing.test.js checks
// the six headings against docs/MESSAGING.md word for word).
//
// KEEP IT TRUE. Two sentences differ from MESSAGING.md on purpose, because
// they are not true on prod yet (MESSAGING.md's own "Keep it true" rule):
//   pillar 5  "your payments, your books, your email" says "your payments and
//             your email": QuickBooks and Xero sending are not live
//   how       "It never sends anything on its own" says "Steward never sends
//             anything you haven't approved" (receipts an org turns on do send)
//   pillar 6  "never holds or moves your money" says "never holds your money":
//             a person can issue a refund from Steward, through their own Stripe

export const HEADLINE = "Raise more from the people who <b>already believe in you.</b>";
export const UNDER = "Your reports tell you what happened. Steward tells you why, and who to call tomorrow.";
export const FEELING = "Imagine never losing track of a single person who believes in what you do.";
// LANDING-5 · the vision line stands alone on Home; the rest of the paragraph
// opens About.
export const VISION_LINE = "Steward is the institutional memory of <b>generosity.</b>";
export const VISION_ABOUT = "Small nonprofits run on relationships and lose them to turnover, spreadsheets and sheer overload. Someone gives from the heart, and a year later nobody remembers to call. Steward holds every donor, every conversation, every promise, gently, so that no one who ever believed in the cause is forgotten by it.";
export const VISION = "Small nonprofits run on relationships and lose them to turnover, spreadsheets and sheer overload. Someone gives from the heart, and a year later nobody remembers to call. Steward is the institutional memory of generosity: every donor, every conversation, every promise, held gently, so that no one who ever believed in the cause is forgotten by it.";

// t: the heading exactly as MESSAGING.md has it. h: the same words with the
// house emphasis. p: the paragraph. short: the first sentence or two, for a
// page that opens with the pillar and then gets on with its own subject.
export const PILLARS = [
  { n: 1, line: "Steward notices who's gone quiet and tells you who to call.", t: "Never lose a single believer.", h: "Never lose <b>a single believer.</b>",
    p: "Every donor is someone who raised their hand for your mission. Steward notices who has gone quiet, not as a report you have to pull but as a tap on the shoulder. When you ask why, it shows the reasons in dollars, and every number opens the gifts and conversations behind it. Then it tells you who to call tomorrow morning and puts each step on your list for the day it's due. No one who ever believed in the cause is forgotten by it.",
    short: "Every donor is someone who raised their hand for your mission. Steward notices who has gone quiet, not as a report you have to pull but as a tap on the shoulder." },
  { n: 2, line: "It drafts and prepares. Nothing goes out unless you approve it.", t: "Technology that knows its place.", h: "Technology that <b>knows its place.</b>",
    p: "Every nonprofit leader has the same nightmare: software that says the wrong thing to the right donor. So we built the opposite. Steward remembers everything and assumes nothing. It drafts the note, suggests the call and prepares the brief, and it never sends, publishes or acts without your yes. It's the staff member who does all the homework and none of the talking out of turn. The relationship stays yours. It just never has to rely on your memory alone.",
    short: "Steward remembers everything and assumes nothing. It drafts the note, suggests the call and prepares the brief, and it never sends, publishes or acts without your yes." },
  { n: 3, line: "Gifts, volunteer hours and conversations, one story per person.", t: "One home for everyone who believes.", h: "One home for <b>everyone who believes.</b>",
    p: "Right now your people are scattered: donors in a spreadsheet, volunteers in another app, gala guests on a clipboard. But they're not separate people. The woman who gave $500 also worked Saturdays and brought two friends to the gala. Steward keeps one story per person, every gift, every hour, every conversation, so when you reach out you know the whole relationship, not just the last transaction. Your community isn't donors plus volunteers. It's people, whole people, with whole histories.",
    short: "Steward keeps one story per person, every gift, every hour, every conversation, so when you reach out you know the whole relationship, not just the last transaction." },
  { n: 4, line: "Every figure opens the gifts behind it, to the cent.", t: "Numbers you can stand behind.", h: "Numbers you can <b>stand behind.</b>",
    p: "When the board asks how the year went, you should be able to answer without a weekend in spreadsheets. Every figure in Steward opens the gifts behind it and adds up to the cent, so you can say it out loud and know it's true. Your story, told in numbers you trust.",
    short: "Every figure in Steward opens the gifts behind it and adds up to the cent, so you can say it out loud and know it's true." },
  { n: 5, line: "Works with your payments and email. Nothing slips between systems.", t: "You don't have to tear anything down.", h: "You don't have to <b>tear anything down.</b>",
    p: "The last thing an overstretched team needs is a migration project. So Steward doesn't ask for one. It connects to the tools you already use, your payments and your email, and quietly watches them, so nothing slips through the cracks between systems. You keep your world. We just make sure nothing in it gets lost.",
    short: "The last thing an overstretched team needs is a migration project. So Steward doesn't ask for one." },
  { n: 6, line: "Talk to the person who built it. Month to month, no platform fee.", t: "A partner, not a vendor.", h: "A partner, <b>not a vendor.</b>",
    p: "You'll talk to the person who built it. Month to month, no platform fee on your gifts, and Steward never holds your money. We'd rather earn your trust every month than lock it in for a year.",
    short: "You'll talk to the person who built it. Month to month, no platform fee on your gifts, and Steward never holds your money." },
];
export const PILLAR = Object.fromEntries(PILLARS.map(p => [p.n, p]));

// "How does it work?" The three steps, in MESSAGING.md's words.
export const HOW_INTRO = "Three things, all from your own records.";
export const HOW = [
  ["Notices who's gone quiet", "Steward notices who's gone quiet, not as a report you have to pull, but as a tap on the shoulder: these eleven people gave last spring and haven't this year."],
  ["Shows you why", "When you ask why, why the appeal came in under, why she stopped giving, it shows you the reasons in dollars, and every number opens the actual gifts and conversations behind it, so you can trust it."],
  ["Tells you who to call", "It tells you who to call tomorrow morning and why, and puts each step on your list for the day it's due."],
];
// LANDING-5 · the same three steps, twelve words or fewer each, for Home.
export const HOW_SHORT = [
  ["Notices who's gone quiet", "A tap on the shoulder, not a report you have to pull."],
  ["Shows you why", "The reasons in dollars. Every number opens the gifts behind it."],
  ["Tells you who to call", "Tomorrow morning's calls, each on your list the day it's due."],
];
export const GIFT_SHORT = "Ten minutes, your own file. Nothing is uploaded or stored.";
// MESSAGING.md says "It never sends anything on its own." Receipts and
// sequences an organisation has turned on do send, so its own rule applies.
export const HOW_CLOSE = "Steward never sends anything you haven't approved. It's your judgment, with a perfect memory.";

export const CAREFUL = "You've spent years building these relationships. Steward doesn't replace any of that. It just makes sure nobody you've ever thanked falls through the cracks again.";
export const GIFT = "Here are the people who stood with you last year. Let's make sure none of them slip away unnoticed.";
export const GIFT_TERMS = "Ten minutes, no pitch, your own file.";
// "Never sends without your yes" is the Agent and drafts. Anything wider says this.
export const NEVER_SENDS = "Steward never sends anything you haven't approved.";

// Which pillar each feature page serves (its first line, above its own h1).
export const FEATURE_PILLAR = { drift: 1, journeys: 1, "major-gifts": 1, audit: 2, forms: 3, p2p: 3, events: 3, memberships: 3,
  reports: 4, ask: 4, grants: 4, finance: 4, receipts: 4, inbox: 5, import: 5 };
