// shared/emailTemplateLibrary.js · EMAIL-1. THIRTEEN EMAILS TO START FROM.
//
// Each starter is an email somebody could send after changing the parts that
// are theirs: the photo, the name it is signed with, and any blank in square
// brackets. The words follow docs/MESSAGING.md: invitation, not pressure;
// short sentences; no exclamation marks; nothing a person would not say out
// loud. They never claim an outcome: an impact number is a blank the org fills
// with its own figure, never one Steward made up.
//
// Deliberate blanks, reported by renderEmail as problems until filled, so a
// send cannot leave with them: every photo (a grey box until chosen), the
// signature's name (the template route fills it with the person who started
// the template), the event or giving page a card points at, and [bracketed]
// figures in the two reporting emails.
//
// Pure: no clock, no DB. Blocks are email-surface widgets (shared/pageWidgets.js).

const header = () => ({ type: "header" });
const footer = () => ({ type: "footer" });
const hero = (heading, sub, alt = "") => ({ type: "hero", heading, sub, image: null, alt, size: "standard" });
const text = (...paras) => ({ type: "richtext", blocks: paras.map(p => (typeof p === "string" ? { type: "p", text: p } : p)) });
const button = (action, label, url = "") => ({ type: "button", action, label, url });
const signature = () => ({ type: "signature", name: "", title: "", photo: null });
const quote = (t, attribution) => ({ type: "quote", text: t, attribution });

export const EMAIL_STARTERS = [
  {
    key: "year_end_appeal", name: "Year-end appeal", purpose: "Invite a gift before the year closes",
    subject: "Before the year ends, {{first_name}}",
    preheader: "A note about what this year held, and an invitation for the next.",
    blocks: [
      header(),
      hero("This year, you were part of it", "What happened at {{org_name}} this year happened because people like you chose to stand with us."),
      text(
        "Hi {{first_name}},",
        "As the year comes to a close, I wanted to write and say thank you. Your support gave us room to say yes when people came to our door.",
        "If you are able to give once more before December 31, it would help us begin the new year ready. Any amount is welcome, and every gift is put to work close to home.",
      ),
      button("give", "Give before the year ends"),
      text("Whatever you decide, thank you for believing in this work."),
      signature(),
      footer(),
    ],
  },
  {
    key: "spring_appeal", name: "Spring appeal", purpose: "A seasonal invitation to give",
    subject: "Something is growing, {{first_name}}",
    preheader: "Spring is a season of new starts here. Would you be part of one?",
    blocks: [
      header(),
      hero("A season of new starts", "Spring is when we plan for the months ahead, and we would love you to be part of it."),
      text(
        "Hi {{first_name}},",
        "This is the time of year we look at what is ahead and ask what we can make possible. Your gift of {{last_gift_amount}} helped us get here.",
        "Would you consider a spring gift? It goes straight to the work you already know and care about.",
      ),
      button("give", "Give a spring gift"),
      signature(),
      footer(),
    ],
  },
  {
    key: "thank_you", name: "Thank you", purpose: "Thank someone for a gift",
    subject: "Thank you, {{first_name}}",
    preheader: "Your gift arrived, and we wanted you to hear it from a person.",
    blocks: [
      header(),
      hero("Thank you", "Your gift of {{last_gift_amount}} on {{last_gift_date}} arrived, and it matters."),
      text(
        "Hi {{first_name}},",
        "I wanted you to hear this from a person, not a receipt: thank you. Gifts like yours are how {{org_name}} keeps showing up for the people who count on us.",
        "If you ever want to see the work up close, just reply to this email. I would love to show you around.",
      ),
      signature(),
      footer(),
    ],
  },
  {
    key: "first_gift_welcome", name: "First gift welcome", purpose: "Welcome a new donor after their first gift",
    subject: "Welcome to {{org_name}}, {{first_name}}",
    preheader: "Your first gift means you are one of us now. Here is what happens next.",
    blocks: [
      header(),
      hero("Welcome, {{first_name}}", "Your first gift means you are part of this now."),
      text(
        "Thank you for your first gift to {{org_name}}. We do not take it lightly when someone new decides to stand with us.",
        { type: "h2", text: "What happens next" },
        { type: "ul", items: [
          "You will hear from us a few times a year with stories from the work, never a flood of email.",
          "Your receipt is on its way separately for your records.",
          "You can reply to any email from us and a person will read it.",
        ] },
      ),
      button("readmore", "See what we do", ""),
      signature(),
      footer(),
    ],
  },
  {
    key: "monthly_welcome", name: "Monthly giver welcome", purpose: "Welcome someone who began giving monthly",
    subject: "You are now a monthly giver, {{first_name}}",
    preheader: "Steady gifts let us plan. Thank you for choosing to give every month.",
    blocks: [
      header(),
      hero("Thank you for giving every month", "Steady gifts let us plan ahead, and that changes what we can promise people."),
      text(
        "Hi {{first_name}},",
        "Choosing to give every month is a quiet kind of commitment, and it means a great deal here. It lets us say yes to things months ahead instead of week to week.",
        "You can change or pause your monthly gift at any time. Just reply to this email and we will take care of it.",
      ),
      signature(),
      footer(),
    ],
  },
  {
    key: "failed_card", name: "Update your card", purpose: "Ask a monthly giver to update a card that did not go through",
    subject: "Your monthly gift did not go through",
    preheader: "Nothing is wrong on your side that cannot be fixed in a minute.",
    blocks: [
      header(),
      text(
        "Hi {{first_name}},",
        "Your most recent monthly gift to {{org_name}} did not go through. This usually happens when a card expires or is replaced, and it is quick to fix.",
        "If you would like to keep giving monthly, you can update your card here:",
      ),
      button("give", "Update my card"),
      text("If you meant to stop, that is completely fine, and thank you for every month you gave. Just reply and let us know."),
      signature(),
      footer(),
    ],
  },
  {
    key: "event_invitation", name: "Event invitation", purpose: "Invite people to one of your events",
    subject: "You are invited, {{first_name}}",
    preheader: "We would love to see you there.",
    blocks: [
      header(),
      hero("Come and be with us", "We are gathering, and it would not be the same without you."),
      text(
        "Hi {{first_name}},",
        "We would love for you to join us. It is a chance to meet the people behind the work, hear a few stories and spend an evening together.",
      ),
      { type: "event", eventId: "" },
      text("Bring a friend if you like. Everyone is welcome."),
      signature(),
      footer(),
    ],
  },
  {
    key: "event_thank_you", name: "Event thank you", purpose: "Thank people who came, with photos from the day",
    subject: "Thank you for coming, {{first_name}}",
    preheader: "A few photos from the day, and our thanks.",
    blocks: [
      header(),
      hero("Thank you for being there", "It was good to be in one room together."),
      text("Hi {{first_name}},", "Thank you for coming. Here are a few moments from the day."),
      { type: "photos2", images: [{ src: null, alt: "" }, { src: null, alt: "" }] },
      text("If you took photos of your own, reply and send them our way. We would love to see the day through your eyes."),
      signature(),
      footer(),
    ],
  },
  {
    key: "volunteer_thank_you", name: "Volunteer thank you", purpose: "Thank a volunteer for their hours",
    subject: "Thank you for your time, {{first_name}}",
    preheader: "The hours you gave made a difference here.",
    blocks: [
      header(),
      hero("Thank you for your time", "Time is the one thing nobody gets back, and you chose to give it here."),
      text(
        "Hi {{first_name}},",
        "Thank you for the [hours] hours you gave this season. The work simply would not happen without people like you showing up.",
        "If there is a kind of help you would like to try next, reply and tell us. We will find a place for it.",
      ),
      button("volunteer", "See upcoming shifts", ""),
      signature(),
      footer(),
    ],
  },
  {
    key: "impact_report", name: "Impact newsletter", purpose: "A newsletter sharing what giving made possible",
    subject: "What you made possible this season",
    preheader: "A few numbers, one story and our thanks.",
    blocks: [
      header(),
      hero("What you made possible", "A short look back at this season at {{org_name}}."),
      { type: "stats", items: [{ value: "", label: "People served" }, { value: "", label: "Volunteer hours" }, { value: "", label: "Programs running" }] },
      text(
        "Hi {{first_name}},",
        { type: "h2", text: "One story" },
        "[Tell one story from this season in a few sentences: who, what changed, and what it meant.]",
      ),
      quote("[A few words from someone your work reached.]", "[Their first name]"),
      button("readmore", "Read the full update", ""),
      signature(),
      footer(),
    ],
  },
  {
    key: "p2p_share", name: "Share my page", purpose: "A supporter shares their fundraising page with friends",
    subject: "Would you help me reach my goal?",
    preheader: "I am raising money for {{org_name}}, and I would love your help.",
    blocks: [
      header(),
      hero("I am fundraising for {{org_name}}", "And I would love your help."),
      text(
        "Hi {{first_name}},",
        "I have set up a page to raise money for {{org_name}}, because their work matters to me. Any gift, of any size, gets me closer to my goal.",
        "If you cannot give, sharing my page with one friend helps just as much.",
      ),
      { type: "givingpage", givingPageId: "" },
      signature(),
      footer(),
    ],
  },
  {
    key: "membership_renewal", name: "Membership renewal", purpose: "Invite a member to renew",
    subject: "Your membership is up for renewal, {{first_name}}",
    preheader: "We would love to have you with us for another year.",
    blocks: [
      header(),
      hero("Another year together?", "Your membership is coming up for renewal."),
      text(
        "Hi {{first_name}},",
        "Thank you for being a member of {{org_name}}. Members are the steady core of everything we do.",
        "Your membership is due for renewal. If you would like to continue, you can renew in a minute here.",
      ),
      button("give", "Renew my membership"),
      text("If anything has changed for you, just reply. We are glad you have been with us."),
      signature(),
      footer(),
    ],
  },
  {
    key: "grant_funder_update", name: "Funder update", purpose: "A progress update to a grant funder",
    subject: "An update on our work together",
    preheader: "Where the grant stands, what has happened and what comes next.",
    blocks: [
      header(),
      hero("An update on our work together", "Thank you for your partnership with {{org_name}}."),
      text(
        "Hi {{first_name}},",
        "I wanted to share where things stand with the work your grant supports.",
        { type: "h2", text: "Where things stand" },
        "[Two or three sentences on progress against what you proposed.]",
        { type: "h2", text: "What comes next" },
        "[The next milestone and when you expect to reach it.]",
      ),
      { type: "stats", items: [{ value: "", label: "Participants to date" }, { value: "", label: "Of the goal" }] },
      text("I would welcome a conversation any time. Thank you for believing in this work."),
      signature(),
      footer(),
    ],
  },
];

export const STARTER_KEYS = EMAIL_STARTERS.map(s => s.key);

export function starterByKey(key) {
  const s = EMAIL_STARTERS.find(x => x.key === key);
  return s ? JSON.parse(JSON.stringify(s)) : null;
}

// Fill the signature the template starts with: the person who started it.
export function signStarterBlocks(blocks, { name, title } = {}) {
  return (Array.isArray(blocks) ? blocks : []).map(b =>
    b && b.type === "signature" && !b.name ? { ...b, name: String(name || "").trim(), title: b.title || String(title || "").trim() } : b);
}

// ── FIX-30 · THE BRIDGE: EVERY EMAIL OPENS IN THIS EDITOR ───────────────────
// Two older stores kept emails outside the block editor: the one-person emails
// (message_templates, COMMS-2: thank-you, receipt, year-end statement and the
// rest) and the campaign starters (shared/emailTemplates.js). Each now opens
// here as a saved template whose starter_key names where it came from:
//   person_<kind>    one person's email. Its words are written back to
//                    message_templates on every save, so every draft path,
//                    journey and sweep that reads that store keeps working.
//   campaign_<key>   a campaign starter, built in the org's own name and words.
// Pure: the routes read the org's current words and hand them in.
export const PERSON_PREFIX = "person_";
export const CAMPAIGN_PREFIX = "campaign_";
export const PERSON_KINDS = ["thanks_monthly", "receipt", "year_end", "event_followup", "volunteer_thanks"];
// The emails whose tax lines are required. Those lines are one locked block:
// the editor shows it, its words come from the brand kit, and a save without it
// is refused.
export const TAX_KINDS = ["receipt", "year_end"];
export const TAX_TOKEN = "{{tax_language}}";
const taxBlock = () => ({ type: "richtext", locked: true, blocks: [{ type: "p", text: TAX_TOKEN }] });

export const personKindOf = key => {
  const k = String(key || "").startsWith(PERSON_PREFIX) ? String(key).slice(PERSON_PREFIX.length) : "";
  return PERSON_KINDS.includes(k) ? k : null;
};
export const campaignKeyOf = key => (String(key || "").startsWith(CAMPAIGN_PREFIX) ? String(key).slice(CAMPAIGN_PREFIX.length) : null);
export const lockedBlocksFor = key => (TAX_KINDS.includes(personKindOf(key)) ? [taxBlock()] : []);
const sameBlock = (a, b) => JSON.stringify({ t: a && a.type, b: a && a.blocks }) === JSON.stringify({ t: b && b.type, b: b && b.blocks });
// Every required locked block is still there, word for word.
export function missingLocked(key, blocks) {
  const list = Array.isArray(blocks) ? blocks : [];
  return lockedBlocksFor(key).filter(need => !list.some(b => b && b.locked && sameBlock(b, need)));
}

// A one-person email's subject and body (plain text, paragraphs split by a
// blank line) as blocks: the header, the words, the tax lines where they stood
// (locked), the footer.
export function personBlocksFromText(kind, body) {
  const paras = String(body || "").replace(/\r\n/g, "\n").split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
  const out = [header()];
  let run = [];
  const flush = () => { if (run.length) out.push(text(...run)); run = []; };
  let taxed = false;
  for (const p of paras) {
    if (TAX_KINDS.includes(kind) && p === TAX_TOKEN) { flush(); out.push(taxBlock()); taxed = true; }
    else run.push(p);
  }
  flush();
  if (TAX_KINDS.includes(kind) && !taxed) {
    // Required even if somebody's older words left it out: before the signature.
    const at = out.length > 2 ? out.length - 1 : out.length;
    out.splice(at, 0, taxBlock());
  }
  out.push(footer());
  return out;
}

// And back: the words a draft, a journey or the volunteer sweep will read.
export function personTextFromBlocks(blocks) {
  const paras = [];
  for (const b of Array.isArray(blocks) ? blocks : []) {
    if (!b || b.type !== "richtext") continue;
    for (const x of Array.isArray(b.blocks) ? b.blocks : []) {
      if (!x) continue;
      if (x.type === "ul") paras.push((x.items || []).map(i => `- ${i}`).join("\n"));
      else if (String(x.text || "").trim()) paras.push(String(x.text).trim());
    }
  }
  return paras.join("\n\n");
}

// A campaign starter's HTML paragraphs as blocks. Bold and line breaks inside
// a paragraph become plain lines; an ask gets the org's giving button.
const ASKS = new Set(["appeal", "monthly_appeal", "year_end"]);
export function campaignBlocksFromHtml(key, html) {
  const paras = String(html || "").split(/<\/p>/i)
    .map(s => s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim())
    .filter(Boolean);
  const blocks = [header(), text(...paras)];
  if (ASKS.has(key)) blocks.push(button("give", key === "monthly_appeal" ? "Give every month" : "Give", "{{give_link}}"));
  blocks.push(footer());
  return blocks;
}
