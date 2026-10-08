// shared/emailMarketing.js — INT-3. ONE EMAIL-MARKETING ADAPTER, TWO PROVIDERS.
//
// An organisation keeps sending its newsletter from the tool it already pays
// for. Steward does not take that over, and does not want to: what it wants is
// the one thing the tool knows and the CRM does not, which is who opened, who
// clicked and who asked to stop. That belongs on the donor's record.
//
//     STEWARD NEVER SENDS THE EMAIL. Nothing in this file or downstream of it
//     can express a send. The only direction that leaves Steward is a list of
//     names, emails and tags, and the only direction that comes back is
//     activity.
//
// ── WHY ONE ADAPTER AND NOT TWO INTEGRATIONS ───────────────────────────────
// Mailchimp and Constant Contact differ in their nouns (an "audience" against
// a "list"), their auth (a token that never expires against one that expires
// every day) and their webhooks (Mailchimp has them, Constant Contact does
// not). They do not differ in any of the JUDGEMENT below: who may be pushed,
// what a preview says, which status wins when the two systems disagree, how a
// campaign reads on a timeline. So the judgement is here once, the differences
// are registry entries, and a third provider is an entry plus a fetcher.
//
// ── THE RULE THAT IS NOT NEGOTIABLE ────────────────────────────────────────
// BUILD-94 already holds the opt-out truth: `email_suppressions` plus
// `do_not_email`, and `donorMailDecision` reads them. INT-3 adds NO second
// opted-out flag. An unsubscribe arriving from Mailchimp is written through the
// same path a Resend complaint is, and the audience sync reads the same fields
// the campaign sender does. Two flags would eventually disagree, and the half
// that lost would mail somebody who asked to stop.
//
// Pure: no DB, no network, no clock (today is always a parameter), no JSX.

// ── THE PROVIDER REGISTRY ──────────────────────────────────────────────────
// `oauthKey` is the entry in shared/oauth.js. `audienceNoun` is the provider's
// OWN word, because a screen that calls a Constant Contact list an "audience"
// is Steward's vocabulary leaking into somebody else's product.
export const PROVIDERS = {
  mailchimp: {
    key: "mailchimp", label: "Mailchimp", oauthKey: "mailchimp",
    audienceNoun: "audience", audienceNounPlural: "audiences",
    tagNoun: "tag", tagNounPlural: "tags",
    // Mailchimp's token never expires and it has no refresh token, so a
    // connection only breaks when the org revokes Steward in Mailchimp.
    tokenExpires: false,
    // Unsubscribe and cleaned events, pushed. That is why an unsubscribe in
    // Mailchimp reaches Steward the same day rather than at the next pull.
    webhooks: true,
    webhookEvents: ["unsubscribe", "cleaned"],
    // Mailchimp verifies nothing itself: the secret is IN the webhook URL, and
    // a request that does not carry it is not read. That is the mechanism
    // Mailchimp offers, so it is the one used, and the secret is per org.
    webhookAuth: "url_secret",
    // The API host is not fixed: it is the account's own data centre, learned
    // from the OAuth metadata endpoint after the exchange and stored beside
    // the token. Guessing it is how every Mailchimp integration breaks on its
    // second customer.
    needsServerPrefix: true,
    help: "Steward asks Mailchimp for permission once. You stay signed in to Mailchimp and keep sending from there.",
    steps: [
      "Click Connect and sign in to Mailchimp.",
      "Choose the account the organisation sends from.",
      "Approve the request.",
      "Back in Steward, pick which audience to keep in step.",
    ],
  },
  constantcontact: {
    key: "constantcontact", label: "Constant Contact", oauthKey: "constantcontact",
    audienceNoun: "list", audienceNounPlural: "lists",
    tagNoun: "tag", tagNounPlural: "tags",
    // Constant Contact's access token lasts a day and its refresh token 180
    // days, so this one genuinely refreshes and can genuinely lose
    // authorization. That is an incident, and INT-1's watching layer says so.
    tokenExpires: true,
    // Constant Contact v3 has no outbound webhook for contact changes, so
    // unsubscribes arrive on the daily pull instead. Saying that plainly beats
    // implying a same-day guarantee that does not exist.
    webhooks: false,
    webhookEvents: [],
    webhookAuth: null,
    needsServerPrefix: false,
    help: "Steward asks Constant Contact for permission once. You keep sending from Constant Contact.",
    steps: [
      "Click Connect and sign in to Constant Contact.",
      "Approve the request.",
      "Back in Steward, pick which list to keep in step.",
    ],
  },
};
export const PROVIDER_KEYS = Object.keys(PROVIDERS);
export const isProvider = k => PROVIDER_KEYS.includes(String(k || ""));
export const providerLabel = k => PROVIDERS[k]?.label || String(k || "");
export const audienceNoun = k => PROVIDERS[k]?.audienceNoun || "audience";

// ── WHAT CROSSES THE LINE OUTWARDS, AND NOTHING ELSE ───────────────────────
// Pinned as a list rather than left to each caller, because the temptation is
// always the next field: a lifetime total "so the tool can segment by it", a
// lapse label "so she can send a win-back". Both put a judgement Steward made
// into a system with different sharing rules, and neither is needed to send a
// newsletter. Name, email, and the tags the org itself chose. That is all.
export const FIELDS_PUSHED = ["firstName", "lastName", "email", "tags"];
export const FIELDS_PUSHED_SENTENCE =
  "Steward sends a first name, a last name, an email address and the tags you chose. It never sends gift amounts, giving history, drift or lapse labels, or anything from notes.";

// ── WHO IS NEVER PUSHED ────────────────────────────────────────────────────
// Four reasons, each with the sentence the preview shows. `reason` is a key so
// the preview can count them; `sentence` is what a person reads.
export const EXCLUSIONS = {
  no_email: { key: "no_email", label: "No email address",
    sentence: "There is no email address on file, so there is nothing to send to a list." },
  deceased: { key: "deceased", label: "Recorded as deceased",
    sentence: "Recorded as deceased. Steward never puts them on a mailing list, and never removes the record." },
  do_not_contact: { key: "do_not_contact", label: "Do not contact",
    sentence: "Marked do not contact, which covers every channel." },
  opted_out: { key: "opted_out", label: "Unsubscribed from email",
    sentence: "Unsubscribed from email, here or in the email tool. The more restrictive of the two always wins." },
  unreachable: { key: "unreachable", label: "Email bounced",
    sentence: "Email has hard bounced, so the address does not work. Pushing it would hurt the sending reputation of every other send." },
  sample: { key: "sample", label: "Sample data",
    sentence: "Part of the sample data Steward created to show the screens, or a record tagged demo-file. It is never pushed anywhere." },
  // MAILCHIMP-1. An address Steward can already see is not real is never
  // offered to the tool. Sending it only earns a refusal, and before this build
  // one refusal stopped the whole run and turned the card BROKEN.
  bad_address: { key: "bad_address", label: "Not a real address",
    sentence: "The address is malformed, or on a domain kept for examples and tests, so the email tool would refuse it." },
};
export const EXCLUSION_KEYS = Object.keys(EXCLUSIONS);

/**
 * May this person be pushed to the email tool?
 *
 * The order matters only for which sentence a person is shown; any one of
 * these is enough to stop the push. `optedOut` is the caller's read of
 * BUILD-94's fields (`do_not_email` OR a row in `email_suppressions`), passed
 * in rather than recomputed, so there is exactly one definition of opted out.
 *
 * @param {object} p {email, deceased, doNotContact, optedOut, emailUnreachable, isSample}
 * @returns {{push:boolean, reason:string|null, sentence:string|null}}
 */
export function pushDecision(p) {
  const person = p || {};
  const no = k => ({ push: false, reason: k, sentence: EXCLUSIONS[k].sentence });
  const email = String(person.email || "").trim();
  if (person.isSample === true) return no("sample");
  if (!email) return no("no_email");
  if (addressProblem(email)) return no("bad_address");
  if (person.deceased === true) return no("deceased");
  if (person.doNotContact === true) return no("do_not_contact");
  if (person.optedOut === true) return no("opted_out");
  if (person.emailUnreachable === true) return no("unreachable");
  return { push: true, reason: null, sentence: null };
}

// ── AN ADDRESS STEWARD ALREADY KNOWS IS NOT REAL ───────────────────────────
// Deliberately narrow. This is not Mailchimp's validator and does not try to
// be: it catches the shapes no mailbox can have, and the domains RFC 2606 and
// RFC 6761 set aside so they can never receive mail. Anything subtler is left
// to the tool, whose refusal is now listed rather than fatal.
const RESERVED_DOMAIN = /(^|\.)(example\.(com|org|net)|example|test|invalid|localhost|local)$/i;
export function addressProblem(email) {
  const e = String(email || "").trim();
  if (!e) return "empty";
  if (/\s/.test(e)) return "malformed";
  const at = e.lastIndexOf("@");
  if (at < 1 || e.indexOf("@") !== at) return "malformed";
  const local = e.slice(0, at), domain = e.slice(at + 1).toLowerCase();
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return "malformed";
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain) && !RESERVED_DOMAIN.test(domain)) return "malformed";
  if (domain.includes("..") || domain.startsWith(".") || domain.startsWith("-")) return "malformed";
  if (RESERVED_DOMAIN.test(domain)) return "reserved";
  return null;
}

/**
 * MAILCHIMP'S REFUSAL OF ONE ADDRESS, IN ITS OWN WORDS. Mailchimp answers a
 * refused member with a problem document whose `detail` is already a sentence
 * ("Please provide a valid email address."). That sentence is what a person
 * reads beside the address; the JSON around it is not.
 */
export function refusalReason(text) {
  let detail = "";
  try { const b = JSON.parse(String(text || "")); detail = b.detail || b.title || ""; }
  catch { detail = String(text || ""); }
  detail = String(detail).replace(/\s+/g, " ").trim().slice(0, 200);
  return detail || "The email tool refused this address and gave no reason.";
}

/**
 * The tags this person carries into the tool, from the org's own mapping.
 *
 * `mapping` is {audienceId: tagName} and `memberOf` is the set of audience ids
 * this person is in. Tags are de-duplicated and sorted so two runs of the same
 * sync produce the same payload, which is what makes a diff mean something.
 */
export function tagsFor(memberOf, mapping) {
  const inGroups = new Set(Array.isArray(memberOf) ? memberOf.map(String) : []);
  const out = new Set();
  for (const [audienceId, tag] of Object.entries(mapping || {})) {
    const name = String(tag || "").trim();
    if (name && inGroups.has(String(audienceId))) out.add(name);
  }
  return [...out].sort();
}

/** A tag name the provider will accept: no commas, trimmed, length-capped. */
export const TAG_MAX = 100;
export function validTagName(t) {
  const s = String(t == null ? "" : t).trim();
  if (!s) return { ok: false, error: "A tag needs a name." };
  if (s.includes(",")) return { ok: false, error: "A tag name cannot contain a comma." };
  if (s.length > TAG_MAX) return { ok: false, error: `A tag name is at most ${TAG_MAX} characters.` };
  return { ok: true, value: s };
}

/**
 * THE PREVIEW THAT RUNS BEFORE ANYTHING IS PUSHED.
 *
 * Nothing leaves Steward until the org has seen this and saved the mapping.
 * The count is the whole point: "412 people" is a number somebody can sanity
 * check against what they believe their list to be, and "38 new" is the number
 * that tells them whether they are about to change their bill.
 *
 * @param {object[]} people each {id, email, deceased, doNotContact, optedOut, emailUnreachable, isSample, memberOf}
 * @param {object} opts {mapping, knownEmails} — knownEmails is the set already in the tool
 */
export function previewCounts(people, { mapping = {}, knownEmails = [] } = {}) {
  const known = new Set((knownEmails || []).map(e => String(e || "").trim().toLowerCase()).filter(Boolean));
  const excluded = {};
  const push = [];
  for (const p of people || []) {
    const d = pushDecision(p);
    if (!d.push) { excluded[d.reason] = (excluded[d.reason] || 0) + 1; continue; }
    push.push({ id: p.id, email: String(p.email).trim().toLowerCase(), tags: tagsFor(p.memberOf, mapping) });
  }
  const newToTool = push.filter(p => !known.has(p.email)).length;
  const excludedList = EXCLUSION_KEYS
    .filter(k => excluded[k])
    .map(k => ({ ...EXCLUSIONS[k], count: excluded[k] }));
  return {
    total: push.length,
    newToTool,
    alreadyThere: push.length - newToTool,
    excluded: excludedList,
    excludedTotal: excludedList.reduce((a, e) => a + e.count, 0),
    people: push,
  };
}

/** "412 people, 38 new to Mailchimp" — the preview in one line. */
export function previewSentence(counts, providerKey) {
  const label = providerLabel(providerKey);
  const c = counts || { total: 0, newToTool: 0 };
  const people = `${c.total.toLocaleString()} ${c.total === 1 ? "person" : "people"}`;
  if (!c.total) return `Nobody to send. Every person on file is held back for a reason listed below.`;
  return `${people}, ${c.newToTool.toLocaleString()} new to ${label}.`;
}

/** The definition that rides beside the preview number. */
export const PREVIEW_DEFINITION =
  "Everyone in the groups you chose who has an email address and has not asked to stop. Counted from the person records themselves, not from a stored total.";

// ── WHEN THE TWO SYSTEMS DISAGREE ──────────────────────────────────────────
// She unsubscribes in Mailchimp on Tuesday; somebody re-adds her in Steward on
// Wednesday from a paper form nobody dated. One of those two is wrong and
// there is no way to know which from here, so the rule is not "newest wins",
// it is THE MORE RESTRICTIVE WINS. The cost of being wrong in that direction is
// one newsletter she did not get. The cost in the other direction is mailing
// somebody who asked to stop, which is the thing her list's reputation and her
// relationship with that person both hang on.
export const STATUSES = ["subscribed", "unsubscribed", "cleaned"];
const RESTRICTIVENESS = { subscribed: 0, unsubscribed: 1, cleaned: 2 };
export function moreRestrictive(a, b) {
  const ra = RESTRICTIVENESS[a] === undefined ? -1 : RESTRICTIVENESS[a];
  const rb = RESTRICTIVENESS[b] === undefined ? -1 : RESTRICTIVENESS[b];
  if (ra < 0 && rb < 0) return null;
  if (ra < 0) return b;
  if (rb < 0) return a;
  return ra >= rb ? a : b;
}
export const RESTRICTIVE_SENTENCE =
  "When Steward and the email tool disagree about whether somebody may be emailed, the more restrictive answer wins. Steward never re-subscribes anybody.";

/**
 * Does this provider status mean "stop emailing"? `cleaned` is Mailchimp's word
 * for an address that bounced hard enough to remove, which is unreachable
 * rather than unsubscribed, and BUILD-94 keeps those two apart.
 */
export function optOutFromStatus(status) {
  const s = String(status || "").toLowerCase();
  if (s === "unsubscribed") return { optOut: true, kind: "unsubscribed", reason: "unsubscribed" };
  if (s === "cleaned" || s === "bounced") return { optOut: true, kind: "unreachable", reason: "bounced in the email tool" };
  return { optOut: false, kind: null, reason: null };
}

// ── ONE LINE ON THE TIMELINE ───────────────────────────────────────────────
// One campaign is ONE line, not three. A donor who opened and clicked has not
// done two things worth two rows; she has read the appeal, and the record
// should read like a person describing it.
/**
 * @param {object} a {campaignName, opened, clicked, clickedLabel, unsubscribed}
 */
export function activitySentence(a) {
  const act = a || {};
  const name = String(act.campaignName || "").trim() || "a campaign";
  if (act.unsubscribed) return `Unsubscribed from ${name}.`;
  const parts = [];
  if (act.opened) parts.push(`Opened ${name}`);
  if (act.clicked) {
    const what = String(act.clickedLabel || "").trim();
    parts.push(act.opened ? (what ? `clicked ${what}` : "clicked a link")
                          : (what ? `Clicked ${what} in ${name}` : `Clicked a link in ${name}`));
  }
  if (!parts.length) return `Sent ${name}.`;
  return parts.join(", ") + ".";
}

// ── THE GIFT AFTER THE CLICK, WHICH IS NOT THE GIFT BECAUSE OF THE CLICK ───
// A gift inside the window is shown NEXT TO the campaign and never described
// as caused by it. Attribution is a claim, and this is a coincidence in time
// that a human can interpret. The sentence says so on the screen, every time,
// because a number in an "appeal results" column is read as attribution
// whether or not anybody wrote the word.
export const GIFT_WINDOW_DAYS = 30;
// The window is scoped to the campaign's OWN people by the caller. A count over
// every gift the organisation took in a month is that month standing next to an
// appeal, and a number that large reads as the appeal's result whatever the
// footnote says.
export const GIFT_WINDOW_SENTENCE =
  "Gifts from the people who opened or clicked this campaign, that arrived within 30 days of it going out. Shown beside it, not credited to it: Steward cannot know what made somebody give.";

const DAY = 86400000;
const civil = d => {
  if (!d) return null;
  if (d instanceof Date) return isNaN(d) ? null : d.toISOString().slice(0, 10);
  const s = String(d).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};
const dayDiff = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / DAY);

/**
 * Gifts within GIFT_WINDOW_DAYS AFTER a send. Never before it: a gift that
 * arrived the day before the appeal went out has nothing to do with it, and
 * counting it is how an "appeal raised" figure quietly becomes fiction.
 */
export function giftsNearSend(sentAt, gifts, { windowDays = GIFT_WINDOW_DAYS } = {}) {
  const sent = civil(sentAt);
  if (!sent) return { count: 0, cents: 0, giftIds: [] };
  let count = 0, cents = 0; const giftIds = [];
  for (const g of gifts || []) {
    const d = civil(g.date);
    if (!d) continue;
    const gap = dayDiff(sent, d);
    if (gap < 0 || gap > windowDays) continue;
    count++; cents += Number(g.cents) || 0; giftIds.push(g.id);
  }
  return { count, cents, giftIds };
}

/**
 * One row of the Communications campaign list. Every number here opens its
 * people, which is why each count ships with the ids it was counted from
 * rather than a bare integer.
 */
export function campaignRow(c, { gifts = [], windowDays = GIFT_WINDOW_DAYS } = {}) {
  const row = c || {};
  const sends = Number(row.sends) || 0;
  const opens = Number(row.opens) || 0;
  const clicks = Number(row.clicks) || 0;
  const near = giftsNearSend(row.sentAt, gifts, { windowDays });
  return {
    id: row.id, provider: row.provider, name: row.name || "Untitled campaign",
    sentAt: civil(row.sentAt),
    sends, opens, clicks,
    // Rates are derived, never stored, and they are null rather than zero when
    // there is nothing to divide by: 0% of nothing reads as a failed campaign.
    openRate: sends ? opens / sends : null,
    clickRate: sends ? clicks / sends : null,
    giftsWithin: near.count, giftCentsWithin: near.cents, giftIds: near.giftIds,
  };
}

// ── THE SYNC LOG, IN PLAIN SENTENCES ───────────────────────────────────────
// INT-1's rule: one sync log a person can read, not a JSON dump. The shapes
// are here so the card, the log and the incident email all say the same thing.
export function syncSentence(run) {
  const r = run || {};
  const label = providerLabel(r.provider);
  if (r.error) return `${label} check failed: ${r.error}`;
  const bits = [];
  if (r.pushed) bits.push(`${r.pushed.toLocaleString()} ${r.pushed === 1 ? "person" : "people"} sent to ${label}`);
  if (r.campaigns) bits.push(`${r.campaigns.toLocaleString()} ${r.campaigns === 1 ? "campaign" : "campaigns"} read back`);
  if (r.optOuts) bits.push(`${r.optOuts.toLocaleString()} ${r.optOuts === 1 ? "unsubscribe" : "unsubscribes"} brought in`);
  if (r.updated) bits.push(`${r.updated.toLocaleString()} ${r.updated === 1 ? "record" : "records"} updated`);
  const refused = Number(r.refused) || 0;
  const tail = refused ? ` ${refusedSentence(refused, r.provider)}` : "";
  if (!bits.length) return `Checked ${label}. Nothing had changed.${tail}`;
  return bits.join(", ") + "." + tail;
}

/** "3 addresses Mailchimp refused": the count the healthy card carries. */
export function refusedSentence(n, providerKey) {
  const c = Number(n) || 0;
  return `${c.toLocaleString()} ${c === 1 ? "address" : "addresses"} ${providerLabel(providerKey)} refused.`;
}

/**
 * The mapping an org saves once on the card. Validated here so the route and
 * the screen agree about what a complete mapping is.
 */
export function validateMapping(input) {
  const m = input || {};
  const errors = [];
  const audienceId = String(m.audienceId || "").trim();
  if (!audienceId) errors.push(`Choose which ${audienceNoun(m.provider)} to keep in step.`);
  const groups = {};
  for (const [k, v] of Object.entries(m.groups || {})) {
    if (v === null || v === undefined || String(v).trim() === "") continue;
    const t = validTagName(v);
    if (!t.ok) { errors.push(t.error); continue; }
    groups[String(k)] = t.value;
  }
  // MAILCHIMP-1. READING IS THE DEFAULT; ADDING PEOPLE IS A SECOND, DELIBERATE
  // YES. Choosing an audience is enough for Steward to read who opened,
  // clicked and asked to stop. Steward adds or updates contacts in that
  // audience only when `push` is literally true, and then it needs the groups.
  const push = m.push === true;
  if (push && !Object.keys(groups).length) errors.push("Choose at least one group to send, and the tag it should carry.");
  return errors.length
    ? { ok: false, errors }
    : { ok: true, value: { audienceId, audienceName: String(m.audienceName || "").trim() || null,
                           push, groups: push ? groups : {} } };
}

export default {
  PROVIDERS, PROVIDER_KEYS, isProvider, providerLabel, audienceNoun,
  FIELDS_PUSHED, FIELDS_PUSHED_SENTENCE, EXCLUSIONS, EXCLUSION_KEYS,
  pushDecision, tagsFor, validTagName, previewCounts, previewSentence, PREVIEW_DEFINITION,
  moreRestrictive, RESTRICTIVE_SENTENCE, optOutFromStatus, STATUSES,
  activitySentence, giftsNearSend, campaignRow, GIFT_WINDOW_DAYS, GIFT_WINDOW_SENTENCE,
  syncSentence, validateMapping, addressProblem, refusalReason, refusedSentence,
};
