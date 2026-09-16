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
// One sentence naming the donor, the amount and the fund. It says what the gift
// WAS, not what it will do: Steward does not know what it will do, and a
// sentence that claims otherwise is the org's promise made in its absence.
export function thankYouDraft({ donorName, giftCents, fundName, orgName, voice = { ready: false }, date = null } = {}) {
  const first = firstName(donorName) || "friend";
  const amt = money(giftCents);
  const middle = fundName
    ? `Thank you for your gift of ${amt} to ${fundName}. It is a real help, and we are grateful you thought of us.`
    : `Thank you for your gift of ${amt}. It is a real help, and we are grateful you thought of us.`;
  const body = wrap(voice, donorName, middle, orgName);
  return { body, voice: voice.ready ? "org_samples" : "default", first, amount: amt, fundName: fundName || null, date };
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
