// shared/draftNote.js — BUILD-88b B.2/B.3. WHAT STEWARD WRITES, AND WHOSE VOICE.
//
// Two drafts live here: the pledge-instalment reminder (B.2) and the thank-you
// (B.3). They share one module because they share the only hard part — whose
// words these are.
//
// THE RULE: **Steward never sends either one.** It writes a draft, she reads
// it, she copies it, and it leaves from her own mail where she can see it as
// the donor will. So the draft is allowed to be plainer than a template would
// be, and it is NEVER allowed to invent a voice.
//
// VOICE COMES FROM THREE SAMPLES SHE PASTES IN SETTINGS. Until they exist the
// default is ONE SENTENCE naming the donor, the amount and the fund — because a
// warm four-paragraph letter in nobody's voice is worse than a plain line she
// finishes herself. With samples, the draft opens on her own greeting and
// closes on her own sign-off, lifted verbatim; the middle stays Steward's plain
// sentence rather than a pastiche of her. Copying somebody's habits is
// defensible; copying their sentences into a letter they did not write is not.
//
// Pure: no clock, no database, no fetch. Everything arrives as arguments so the
// suites can drive it directly and nothing here can accidentally send.

export const VOICE_SAMPLE_MIN = 3;

const money = cents => {
  const n = (Number(cents) || 0) / 100;
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
};
const firstName = full => String(full || "").trim().split(/\s+/)[0] || "";

// ── Her greeting and her sign-off, out of her own samples ─────────────────
// The FIRST line of a sample that addresses somebody is a greeting; the last
// non-empty line before a bare name is a sign-off. Both are lifted verbatim,
// with the sample's donor name swapped for this one. Nothing else is copied.
const GREETING = /^(dear|hi|hello|hey|good morning|good afternoon)\b[^\n]*/i;
const SIGNOFF = /^(thank you|thanks|with (?:thanks|gratitude|appreciation)|gratefully|warmly|sincerely|in (?:christ|his service)|blessings|yours|all the best|best)\b[^\n]*/i;

export function voiceFrom(samples = []) {
  const usable = (Array.isArray(samples) ? samples : []).map(s => String(s || "").trim()).filter(s => s.length >= 40);
  if (usable.length < VOICE_SAMPLE_MIN) return { ready: false, count: usable.length, greeting: null, signoff: null, signature: null };
  let greeting = null, signoff = null, signature = null;
  for (const s of usable) {
    const lines = s.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!greeting && lines.length && GREETING.test(lines[0])) greeting = lines[0];
    for (let i = lines.length - 1; i >= 0 && !signoff; i--) {
      if (SIGNOFF.test(lines[i])) {
        signoff = lines[i].replace(/[,\s]*$/, "");
        // A bare name on the line after a sign-off is her signature.
        if (lines[i + 1] && lines[i + 1].split(/\s+/).length <= 4 && !/[.!?]$/.test(lines[i + 1])) signature = lines[i + 1];
      }
    }
    if (greeting && signoff) break;
  }
  return { ready: true, count: usable.length, greeting, signoff, signature };
}

// Her greeting with her own donor's name swapped for this one. A greeting whose
// name cannot be found is used as-is with the name appended, never mangled.
function greetingFor(voice, donorName) {
  const first = firstName(donorName) || "friend";
  if (!voice.greeting) return `Dear ${first},`;
  const swapped = voice.greeting.replace(/\b(?:dear|hi|hello|hey)\s+([A-Z][\w'’-]*)/i, (m, g0) => m.replace(g0, first));
  return swapped === voice.greeting && !new RegExp(`\\b${first}\\b`, "i").test(voice.greeting)
    ? voice.greeting.replace(/[,:\s]*$/, "") + ` ${first},`
    : swapped;
}

function wrap(voice, donorName, middle, orgName) {
  if (!voice.ready) return middle;
  const tail = [voice.signoff || "Thank you", voice.signature || orgName || ""].filter(Boolean).join(",\n");
  return [greetingFor(voice, donorName), "", middle, "", tail].join("\n");
}

// ── B.3 — the thank-you ────────────────────────────────────────────────────
// It says what the gift WAS, not what it will do: Steward does not know what
// it will do, and a sentence that claims otherwise is the org's promise made
// in its absence.
//
// ── FIX-6 follow-up 8 · IT VARIES WITH THE RECORD NOW ────────────────────
// It used to be ONE sentence with the amount swapped in, so a queue of three
// thank-yous was the same line three times and read as a mail merge, which is
// the opposite of the point. It now chooses its middle from FACTS IT IS GIVEN:
// whether this is their first gift, whether it is a monthly one, how long
// since their last, and what fund or campaign it came to.
//
// NOTHING IS INVENTED, and that is the constraint that shapes all of this. A
// fact the caller does not pass is a fact the draft does not mention: no
// "your continued support" for somebody whose history we were not told, no
// "as you have every year" without the years. Every branch below is reachable
// only when the caller supplied the fact it rests on, and the plainest
// sentence is what you get when nothing was supplied.
//
// It is also NOT the AI. This is the template layer, and it works with the
// Anthropic key off; the audit read three identical drafts on a demo with the
// key off and the template was the whole reason.
const TIER = cents => {
  const d = (Number(cents) || 0) / 100;
  if (d >= 5000) return "major";
  if (d >= 1000) return "large";
  if (d >= 250) return "mid";
  return "small";
};

export function thankYouDraft({
  donorName, giftCents, fundName, orgName, voice = { ready: false }, date = null,
  // Every one of these is optional, and an absent one is never guessed at.
  isFirstGift = null,          // true when this is the first gift on their record
  isRecurring = null,          // true when it came from a monthly commitment
  monthsSinceLastGift = null,  // whole months between this gift and the one before
  giftCountBefore = null,      // how many gifts they had before this one
  campaignName = null,         // the appeal it came to, when it came to one
} = {}) {
  const first = firstName(donorName) || "friend";
  const amt = money(giftCents);
  const to = fundName ? ` to ${fundName}` : campaignName ? ` to ${campaignName}` : "";
  const tier = TIER(giftCents);
  const months = Number.isFinite(Number(monthsSinceLastGift)) ? Math.round(Number(monthsSinceLastGift)) : null;
  const before = Number.isFinite(Number(giftCountBefore)) ? Number(giftCountBefore) : null;

  let middle;
  if (isRecurring === true) {
    // A monthly giver is thanked for the ARRANGEMENT, not for one charge.
    middle = `Thank you for your monthly gift of ${amt}${to}. Giving every month is the steadiest kind of help there is, and we notice it.`;
  } else if (isFirstGift === true) {
    middle = tier === "major" || tier === "large"
      ? `Thank you for your first gift${to}, and for making it ${amt}. Starting here means a great deal, and we would like you to see what it does.`
      : `Thank you for your first gift of ${amt}${to}. It is the beginning of something, and we are glad you chose us to begin it with.`;
  } else if (months !== null && months >= 12) {
    // We know the gap because we were told it. Saying "welcome back" to
    // somebody who never left is the failure this guards against.
    middle = `Thank you for your gift of ${amt}${to}. It has been a while since we last heard from you, and it is good to have you back.`;
  } else if (before !== null && before >= 5) {
    middle = `Thank you for your gift of ${amt}${to}. That is ${before + 1} now, and giving again and again is its own kind of message.`;
  } else if (tier === "major") {
    middle = `Thank you for your gift of ${amt}${to}. A gift this size changes what we can plan for, not only what we can pay for, and we do not take it lightly.`;
  } else if (tier === "large") {
    middle = `Thank you for your gift of ${amt}${to}. It is a significant amount and it will be treated that way.`;
  } else if (before !== null && before >= 1) {
    middle = `Thank you for your gift of ${amt}${to}. You have given before, and choosing to do it again is the part we are most grateful for.`;
  } else {
    // What you get when we were told nothing beyond the amount. Unchanged
    // from the original, deliberately: it is the honest floor.
    middle = `Thank you for your gift of ${amt}${to}. It is a real help, and we are grateful you thought of us.`;
  }

  const body = wrap(voice, donorName, middle, orgName);
  return { body, voice: voice.ready ? "org_samples" : "default", first, amount: amt,
           fundName: fundName || null, date, tier,
           basis: { isFirstGift, isRecurring, monthsSinceLastGift: months, giftCountBefore: before, campaignName } };
}

// ── B.2 — the pledge-instalment reminder ───────────────────────────────────
// A reminder is the most delicate note a fundraiser sends: the donor has
// already said yes, and being chased for it is how a yes becomes a last gift.
// So it states the fact and asks nothing twice — no "as you may recall", no
// second deadline, no total outstanding unless she adds it. And it never goes
// out by itself.
export function pledgeReminderDraft({ donorName, installmentCents, dueDate, pledgeCents = null,
                                      paidCents = null, orgName, voice = { ready: false } } = {}) {
  const amt = money(installmentCents);
  const when = dueDate ? ` that was due ${dueDate}` : "";
  const remaining = pledgeCents != null && paidCents != null && pledgeCents > paidCents
    ? ` That would leave ${money(pledgeCents - paidCents - installmentCents > 0 ? pledgeCents - paidCents - installmentCents : 0)} on the pledge.`
    : "";
  const middle = `I am writing about the ${amt} instalment${when}. If it has already gone out, please ignore this — and if it is easier to move the date, just say and we will.${remaining}`;
  return { body: wrap(voice, donorName, middle, orgName), voice: voice.ready ? "org_samples" : "default", amount: amt, dueDate: dueDate || null };
}

// The step a late instalment opens, from ONE place so the thread, the digest
// and the test all read the same words.
export const PLEDGE_REMINDER_STEP = { type: "pledge_reminder", label: "Pledge instalment reminder" };
export const PLEDGE_LATE_DAYS = 30;

// ── BUILD-101 Part 2 — the renewal note ────────────────────────────────────
// A renewal is the easiest ask an org makes: the member already chose them.
// So the note states the date and the price and asks once. It says nothing
// about what the membership "makes possible" — Steward does not know, and a
// sentence that claims it is the org's promise made in its absence. It never
// goes out by itself.
export const MEMBERSHIP_RENEWAL_STEP = { type: "membership_renewal", label: "Renew membership" };
export function membershipRenewalDraft({ donorName, levelName, expiresOnLong, priceCents, orgName, voice = { ready: false } } = {}) {
  const amt = money(priceCents);
  const middle = `Your ${levelName} membership runs through ${expiresOnLong}. Renewing is ${amt} for another year, and your new year starts the day this one ends, so renewing early costs you nothing. We would love to have you with us again.`;
  return { body: wrap(voice, donorName, middle, orgName), voice: voice.ready ? "org_samples" : "default", amount: amt };
}

// ── FIX-3 B — the volunteer welcome ────────────────────────────────────────
// Somebody just joined the volunteers (the Agent's "Ada just became a
// volunteer…"). The welcome says thank you and that the office will be in
// touch. It names no hours, role or date: those are the coordinator's to
// arrange, and a sentence that promises one is the org's promise made in its
// absence. It never goes out by itself.
export function volunteerWelcomeDraft({ personName, orgName, voice = { ready: false } } = {}) {
  const at = orgName ? ` at ${orgName}` : "";
  const middle = `Welcome to the volunteers${at}, and thank you for offering your time. We are glad to have you, and we will be in touch soon about where you can help first.`;
  return { subject: "Welcome to the volunteers", body: wrap(voice, personName, middle, orgName),
           voice: voice.ready ? "org_samples" : "default" };
}
