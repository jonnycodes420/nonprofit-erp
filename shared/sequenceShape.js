// shared/sequenceShape.js — BUILD-94 Part 3. SEQUENCES.
//
// ── THE RULE THIS BUILD CHANGES, AND HOW FAR ───────────────────────────────
// Since BUILD-88c: nothing goes to a donor she did not press send on.
// Sequences change it to this, and NO FURTHER:
//
//     SHE WROTE EVERY WORD, SHE TURNED IT ON, AND EACH SEND IS HERS.
//
// Steward still writes nothing to a donor. Personalization comes from her data
// through merge fields and per-track copy — never from a model. There is no
// path in this module by which a sentence a human did not type reaches an
// inbox, and the suite asserts it.
//
// ── TRACKS ARE WHERE THE PERSONALIZATION LIVES ─────────────────────────────
// One sequence, several tracks, one chosen at enrollment by a rule she can
// READ. A person is on exactly one track. Each track has its own copy. Within
// a track, merge fields carry the person's own data. That is as personal as
// Steward gets without a model writing to a donor, and it is what "customized
// by demographic, personal to each donor" means in this build.
//
// Pure: no DB, no network, no clock (every "now" is a parameter).

// ── TRIGGERS: A CLOSED SET ─────────────────────────────────────────────────
// No "anyone in a segment" trigger. That is a campaign, and Communications
// already does it — a second way to mail a whole segment is a second place for
// the same mistake.
export const TRIGGERS = [
  { key: "first_gift",      label: "Their first gift ever" },
  { key: "first_recurring", label: "Their first recurring gift" },
  { key: "added_volunteer", label: "Added as a volunteer" },
  { key: "manual",          label: "Enrolled by hand from a profile" },
];
export const TRIGGER_KEYS = TRIGGERS.map(t => t.key);

// ── STOPS: A CLOSED SET ────────────────────────────────────────────────────
// A LOGGED CONVERSATION DOES NOT STOP A SEQUENCE. Say so in the settings copy
// so nobody assumes it does — the assumption is silent and the consequence is
// an email going out the day after a real conversation.
export const STOPS = [
  { key: "unsubscribed", label: "They unsubscribed" },
  { key: "do_not_email", label: "Marked do-not-email" },
  { key: "deceased",     label: "Marked deceased" },
  { key: "removed",      label: "Removed by someone here" },
  { key: "another_gift", label: "They gave again" },
];
export const STOP_NOT_A_STOP =
  "Logging a call or a note does NOT stop a sequence. Someone here still has to remove them.";

// ── TRACK RULES ────────────────────────────────────────────────────────────
// Every rule is a SENTENCE, because she has to be able to read which track
// somebody landed on and agree with it. Amounts are in whole dollars, matching
// every other amount a user types in this product.
export const TRACK_RULE_KINDS = [
  { key: "gift_under",   label: "First gift under $100",        test: (c) => c.amount != null && c.amount < 100 },
  { key: "gift_mid",     label: "First gift $100 to $999",      test: (c) => c.amount != null && c.amount >= 100 && c.amount < 1000 },
  { key: "gift_major",   label: "First gift $1,000 and up",     test: (c) => c.amount != null && c.amount >= 1000 },
  { key: "recurring",    label: "A recurring gift",             test: (c) => c.recurring === true },
  { key: "one_time",     label: "A one-time gift",              test: (c) => c.recurring === false },
  { key: "fund",         label: "A named fund",                 test: (c, v) => !!v && String(c.fund || "").trim().toLowerCase() === String(v).trim().toLowerCase() },
  { key: "source",       label: "A named source",              test: (c, v) => !!v && String(c.source || "").trim().toLowerCase() === String(v).trim().toLowerCase() },
  { key: "everyone_else",label: "Everyone else",                test: () => true },
];
const RULE_BY_KEY = Object.fromEntries(TRACK_RULE_KINDS.map(r => [r.key, r]));

export function trackRuleSentence(track) {
  const r = RULE_BY_KEY[track && track.rule];
  if (!r) return "Everyone else";
  if (track.rule === "fund")   return `Gave to ${track.value || "(no fund named)"}`;
  if (track.rule === "source") return `Gave through ${track.value || "(no source named)"}`;
  return r.label;
}

// THE ONE PLACE A PERSON IS PUT ON A TRACK. Tracks are tried IN ORDER and the
// FIRST match wins, so "a person is on exactly one track" is true by
// construction rather than by hoping the rules are disjoint. A sequence whose
// last track is not `everyone_else` can leave somebody with no track — that is
// a refusal at save time (validateSequence), never a silent non-enrollment.
export function chooseTrack(tracks, context) {
  for (const t of tracks || []) {
    const r = RULE_BY_KEY[t.rule];
    if (r && r.test(context || {}, t.value)) return t;
  }
  return null;
}

// ── MERGE FIELDS ───────────────────────────────────────────────────────────
// Her data, in her sentence. NOT a model. An unknown field renders as EMPTY
// and is reported, never left as a visible {{token}} in somebody's inbox —
// "Dear {{frist}}," is the failure mode this exists to prevent.
export const MERGE_FIELDS = [
  { key: "first",             label: "Their first name" },
  { key: "last",              label: "Their last name" },
  { key: "name",              label: "Their full name" },
  { key: "last_gift_amount",  label: "Their last gift" },
  { key: "last_gift_date",    label: "When they last gave" },
  { key: "fund",              label: "The fund they gave to" },
  { key: "sponsor_name",      label: "Your word for a giver" },
  { key: "org_name",          label: "Your organisation" },
  { key: "gift",              label: "Your word for a gift" },
];
const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

// values: { first, last, ... } plus every custom field by its key.
// Returns { text, missing: [keys] }.
export function renderMerge(template, values) {
  const missing = [];
  const text = String(template || "").replace(TOKEN_RE, (_m, key) => {
    const v = values ? values[key] : undefined;
    if (v === undefined || v === null || v === "") { missing.push(key); return ""; }
    return String(v);
  });
  return { text, missing: [...new Set(missing)] };
}

// Every token a template uses — so the editor can say "this one is not a
// field" before she turns anything on, rather than after.
export function tokensIn(template) {
  const out = [];
  String(template || "").replace(TOKEN_RE, (_m, k) => { out.push(k); return ""; });
  return [...new Set(out)];
}

// ── THE SEND WINDOW ────────────────────────────────────────────────────────
// Weekday mornings in the ORG's timezone. Not the server's, not the donor's —
// the organisation's, which is the only zone anybody here has agreed on
// (BUILD-72's seam, BUILD-84's rule).
export const SEND_WINDOW = { startHour: 8, endHour: 11, days: [1, 2, 3, 4, 5] }; // Mon–Fri

// Is this org-local clock reading inside the window?
export function inSendWindow(clock) {
  if (!clock) return false;
  return SEND_WINDOW.days.includes(clock.weekday) &&
    clock.hour >= SEND_WINDOW.startHour && clock.hour < SEND_WINDOW.endHour;
}

// How many whole days forward from `weekday` until the next weekday morning
// (0 when today still qualifies and the hour has not passed).
export function daysUntilNextWindow(weekday, hour) {
  const openToday = SEND_WINDOW.days.includes(weekday) && hour < SEND_WINDOW.endHour;
  if (openToday) return 0;
  for (let d = 1; d <= 7; d++) {
    if (SEND_WINDOW.days.includes((weekday + d) % 7)) return d;
  }
  return 1;
}

// ── TIMEZONE GATE (BUILD-84's rule) ────────────────────────────────────────
// NO TIMEZONE ON FILE, NO SEQUENCES — and the screen says why. The column has
// a default, so "has a timezone" is true for every org and means nothing; what
// this needs is a zone A HUMAN CHOSE (timezone_confirmed_at).
export function timezoneGate(org) {
  const confirmed = org && (org.timezone_confirmed_at || org.timezoneConfirmedAt);
  if (confirmed) return { ok: true };
  return {
    ok: false,
    reason: "no_timezone",
    message: "A sequence sends on weekday mornings where you are, so Steward has to know where that is. " +
             "Set your organisation's timezone in Settings and this turns on.",
  };
}

// ── VALIDATION ─────────────────────────────────────────────────────────────
// A sequence that cannot be turned on says so BEFORE she tries.
export function validateSequence(seq) {
  const problems = [];
  if (!seq || !String(seq.name || "").trim()) problems.push("Give the sequence a name.");
  if (!TRIGGER_KEYS.includes(seq && seq.trigger)) problems.push("Choose what starts it.");
  const tracks = (seq && seq.tracks) || [];
  if (!tracks.length) problems.push("A sequence needs at least one track.");
  const keys = new Set();
  for (const t of tracks) {
    if (!t.key) problems.push("Every track needs a key.");
    if (keys.has(t.key)) problems.push(`Two tracks are called "${t.key}".`);
    keys.add(t.key);
    if (!RULE_BY_KEY[t.rule]) problems.push(`"${t.label || t.key}" has no rule anyone can read.`);
    if ((t.rule === "fund" || t.rule === "source") && !String(t.value || "").trim()) {
      problems.push(`"${t.label || t.key}" names no ${t.rule}.`);
    }
  }
  // A person must always land somewhere. Without a catch-all, enrollment can
  // silently do nothing — the worst outcome, because it looks like it worked.
  if (tracks.length && tracks[tracks.length - 1].rule !== "everyone_else") {
    problems.push("The last track has to be “Everyone else”, so nobody falls out of the sequence without anyone noticing.");
  }
  const steps = (seq && seq.steps) || [];
  if (!steps.length) problems.push("A sequence needs at least one step.");
  for (const s of steps) {
    if (!keys.has(s.trackKey)) problems.push(`A step belongs to a track that isn't here ("${s.trackKey}").`);
    if (!Number.isInteger(Number(s.dayOffset)) || Number(s.dayOffset) < 0) problems.push("A step's day has to be a whole number of days from enrollment.");
    if (!String(s.subject || "").trim()) problems.push("Every step needs a subject.");
    if (!String(s.body || "").trim()) problems.push("Every step needs words. Steward will not write them.");
    const unknown = tokensIn(s.subject + " " + s.body)
      .filter(t => !MERGE_FIELDS.some(f => f.key === t) && !(seq.customFieldKeys || []).includes(t));
    for (const u of unknown) problems.push(`“{{${u}}}” is not a field. It would reach somebody blank.`);
  }
  // Every track needs at least one step, or a person lands on a track that
  // sends nothing and the sequence quietly does not exist for them.
  for (const k of keys) {
    if (!steps.some(s => s.trackKey === k)) problems.push(`The track "${k}" has no steps.`);
  }
  return { ok: problems.length === 0, problems: [...new Set(problems)] };
}

// ── THE ACTOR LINE ─────────────────────────────────────────────────────────
// Every send writes ONE email conversation on the person's timeline, and it
// says who turned this on and when — because "why did this donor get this" is
// the question, and the answer is a person and a date.
export function sendActorLine({ sequenceName, stepNumber, turnedOnByName, turnedOnAt }) {
  const when = turnedOnAt ? formatShortCivil(turnedOnAt) : null;
  const who = turnedOnByName || "someone here";
  return `Sequence: ${sequenceName}, step ${stepNumber}, turned on by ${who}` + (when ? ` on ${when}` : "");
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function formatShortCivil(civil) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(civil || ""));
  if (!m) return null;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`;
}

// ── HOME ───────────────────────────────────────────────────────────────────
// One line per sequence. A failure is NEVER swallowed (BUILD-37 H2) — it is
// the end of this sentence, where she is already looking.
export function homeSequenceLine({ name, activeCount, nextSendCivil, failedCount }) {
  const people = `${activeCount} ${activeCount === 1 ? "person" : "people"} in it`;
  const next = nextSendCivil ? `next send ${weekdayName(nextSendCivil)}` : "nothing due";
  const base = `${name}: ${people}, ${next}`;
  if (failedCount > 0) {
    return `${base} · ${failedCount} ${failedCount === 1 ? "email" : "emails"} could not be sent`;
  }
  return base;
}
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function weekdayName(civil) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(civil || ""));
  if (!m) return String(civil || "");
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return DAYS[d.getUTCDay()];
}

// ── ENROLLMENT IS NEVER RETROACTIVE ────────────────────────────────────────
// Turning it on today enrolls NOBODY who gave yesterday. The screen says so at
// the moment of turning it on, and says how many WOULD have been enrolled had
// it been on all year — so she can decide to enroll them by hand rather than
// discovering the gap months later.
export function retroactiveSentence(count, triggerKey) {
  const what = { first_gift: "gave for the first time", first_recurring: "started giving monthly",
                 added_volunteer: "were added as volunteers", manual: "were enrolled by hand" }[triggerKey]
                 || "would have qualified";
  if (!count) return "Nobody would have been enrolled in the past year, so there is nothing to catch up on.";
  return `This starts from today. ${count} ${count === 1 ? "person" : "people"} ${what} in the past year and will NOT be enrolled — ` +
         "you can add them by hand from their records if you want them in it.";
}
