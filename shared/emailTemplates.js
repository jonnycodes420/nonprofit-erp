// shared/emailTemplates.js — BUILD-88c C.2. NEVER A BLANK BOX.
//
// Communications opened on an empty rich-text editor and a blinking cursor.
// That is the moment a fundraiser closes the tab: writing an appeal from
// nothing, in a box, with a send button underneath, is the hardest thing on the
// screen and Steward was asking for it first.
//
// So it opens on six real emails. Not "templates" in the sense of a skeleton
// with `[YOUR TEXT HERE]` in it — each one is a message somebody could send
// today, with the org's name, its colours and its logo already in it, written
// the way a small shop writes. She changes the parts that are hers and presses
// send.
//
// TWO RULES THE COPY FOLLOWS, and they are the same two the rest of Steward
// follows. **It never claims an outcome Steward cannot back** — no "your gift
// fed forty children", because Steward does not know that and the organisation
// would be the one who said it. And **it is her voice, not a brand's**: short
// sentences, no exclamation marks, no "Dear Friend", nothing a person would
// not say out loud.
//
// Pure: no clock, no database, no JSX. The org's vocabulary (BUILD-86) decides
// whether the sponsor template is offered at all, because an organisation that
// calls its monthly givers "monthly donors" has no sponsors to update.

export const MERGE_FIELDS = [
  { token: "{{first_name}}", label: "First name", sample: "Margaret" },
  { token: "{{donor_name}}", label: "Full name", sample: "Margaret Chen" },
  { token: "{{org_name}}", label: "Your organisation", sample: "Sparrow Missions" },
  { token: "{{gift_amount}}", label: "Their last gift", sample: "$250" },
  { token: "{{total_giving}}", label: "Their lifetime giving", sample: "$4,150" },
  { token: "{{year}}", label: "This year", sample: String(new Date().getUTCFullYear()) },
];

// `{{first}}` is the shorthand a person types; it means the same as
// `{{first_name}}` and is normalised on the way in rather than refused.
export const MERGE_ALIASES = { "{{first}}": "{{first_name}}", "{{name}}": "{{donor_name}}", "{{org}}": "{{org_name}}" };

export function normalizeMergeFields(html) {
  let out = String(html || "");
  for (const [alias, real] of Object.entries(MERGE_ALIASES)) out = out.split(alias).join(real);
  return out;
}

// One renderer for the preview and for the send, so what she reads on the right
// of the screen is the email that leaves.
export function renderMergeFields(html, values = {}) {
  const v = {
    first_name: values.first_name || "Margaret",
    donor_name: values.donor_name || "Margaret Chen",
    org_name: values.org_name || "your organisation",
    gift_amount: values.gift_amount || "your last gift",
    total_giving: values.total_giving || "$0",
    year: values.year || String(new Date().getUTCFullYear()),
  };
  return normalizeMergeFields(html)
    .replace(/{{first_name}}/g, v.first_name)
    .replace(/{{donor_name}}/g, v.donor_name)
    .replace(/{{org_name}}/g, v.org_name)
    .replace(/{{gift_amount}}/g, v.gift_amount)
    .replace(/{{total_giving}}/g, v.total_giving)
    .replace(/{{year}}/g, v.year);
}

const p = t => `<p>${t}</p>`;

// ── The six ────────────────────────────────────────────────────────────────
// `vocab` is BUILD-86's `t()`; each template is built with the org's own words
// for a donor and a monthly giver, so a shop that says "partners" never reads
// the word "donor" in its own appeal.
export function emailTemplates({ orgName = "your organisation", t = (k) => DEFAULT_WORDS[k] || k } = {}) {
  const org = orgName;
  const sponsorWord = t("monthly_giver", 1);
  const sponsorWordPl = t("monthly_giver", 2);
  const all = [
    {
      key: "appeal",
      label: "Appeal",
      blurb: "The ask, in four sentences. Send it to the people who have given before.",
      subject: `A short ask from ${org}`,
      body: [
        p("Hello {{first_name}},"),
        p(`I am writing with one ask, and I will keep it short.`),
        p(`We are raising money for the year ahead at ${org}, and we are asking the people who have given before to go first. Whatever you can do makes the next ask easier to make.`),
        p("If now is not the time, that is genuinely all right. Reply and tell me and I will not ask again this year."),
        p("Thank you for reading this far."),
      ].join("\n"),
    },
    {
      key: "thank_you",
      label: "Thank-you",
      blurb: "For a gift that has already arrived. Says what it was, and nothing it cannot back.",
      subject: `Thank you, {{first_name}}`,
      body: [
        p("Hello {{first_name}},"),
        p(`Thank you for your gift of {{gift_amount}} to ${org}. It arrived safely and it is already at work.`),
        p("I know you have a choice about where this goes, and I am grateful you chose us."),
        p("If you ever want to know exactly what your giving has paid for, write back and ask. I will tell you."),
      ].join("\n"),
    },
    {
      key: "year_end",
      label: "Year-end",
      blurb: "The December letter. One year named, one ask, one deadline that is real.",
      subject: `Before {{year}} ends`,
      body: [
        p("Hello {{first_name}},"),
        p(`This is the last thing you will hear from ${org} this year.`),
        p("A gift before the 31st counts for this tax year, and it lands with us while the year's work is still in front of us rather than behind."),
        p("Your giving so far comes to {{total_giving}}. Thank you for every part of it."),
        p("Whatever you decide, I hope the end of the year is a kind one."),
      ].join("\n"),
    },
    {
      key: "event_invitation",
      label: "Event invitation",
      blurb: "An invitation with the three things people need: what, when, and whether to reply.",
      subject: `An evening at ${org}, and you are invited`,
      body: [
        p("Hello {{first_name}},"),
        p(`We are having an evening at ${org} and I would like you to come.`),
        p("<strong>What:</strong> [name the evening]<br /><strong>When:</strong> [date and time]<br /><strong>Where:</strong> [the address]"),
        p("There is no ask on the night. It is an hour, some food, and the people doing the work."),
        p("Reply to this email and I will put your name down."),
      ].join("\n"),
    },
    {
      key: "sponsor_update",
      label: `${cap(sponsorWord)} update`,
      blurb: `Only for the people giving every month. One thing, told properly, beats five things listed.`,
      // OFFERED ONLY when the organisation's own word for a monthly giver is a
      // sponsor. A shop that says "monthly donors" has no sponsors to update,
      // and a template for a relationship they do not have is the blank box
      // wearing a costume.
      requiresSponsorVocabulary: true,
      subject: `An update for our ${sponsorWordPl}`,
      body: [
        p("Hello {{first_name}},"),
        p(`You give every month, which means ${org} can plan. That is rarer and more useful than it sounds.`),
        p("[One thing that has happened since you last wrote.]"),
        p("Nothing is needed from you. This is just so you know where your giving is going."),
      ].join("\n"),
    },
    {
      key: "newsletter",
      label: "Newsletter",
      blurb: "The regular note. Three short things, and no ask.",
      subject: `What has been happening at ${org}`,
      body: [
        p("Hello {{first_name}},"),
        p("Three short things from the last few weeks."),
        p("<strong>One.</strong> [What happened.]"),
        p("<strong>Two.</strong> [What happened.]"),
        p("<strong>Three.</strong> [What is coming.]"),
        p("No ask in this one. Thank you for reading."),
      ].join("\n"),
    },
  ];
  return all;
}

const DEFAULT_WORDS = { monthly_giver: "monthly donor" };
function cap(s) { const x = String(s || ""); return x.charAt(0).toUpperCase() + x.slice(1); }

// Which of the six this organisation is offered. The sponsor update is the only
// conditional one, and the condition is the org's own vocabulary.
export function templatesFor({ orgName, t, monthlyGiverWord } = {}) {
  const word = String(monthlyGiverWord || (t ? t("monthly_giver", 1) : "monthly donor")).toLowerCase();
  const hasSponsors = /sponsor/.test(word);
  return emailTemplates({ orgName, t }).filter(tpl => !tpl.requiresSponsorVocabulary || hasSponsors);
}

// ── The segment, as PEOPLE ─────────────────────────────────────────────────
// "17 recipients" is a number. "17 sponsors, including Margaret Chen and Bob
// Harmon" is a group of people, and it is the sentence that catches a segment
// that is wrong — nobody notices 17 is too many, everybody notices a name that
// should not be on the list.
export function segmentSentence(count, names = [], noun = "people") {
  const n = Number(count) || 0;
  if (n === 0) return `Nobody yet. Widen the segment and this will say who.`;
  const word = n === 1 ? singular(noun) : noun;
  const shown = names.filter(Boolean).slice(0, 2);
  if (!shown.length) return `${n.toLocaleString()} ${word}.`;
  const who = shown.length === 1 ? shown[0] : `${shown[0]} and ${shown[1]}`;
  return n <= shown.length ? `${n.toLocaleString()} ${word}: ${who}.`
    : `${n.toLocaleString()} ${word}, including ${who}.`;
}
function singular(noun) { return String(noun).replace(/s$/, ""); }
