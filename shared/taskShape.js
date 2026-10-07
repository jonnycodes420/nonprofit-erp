// shared/taskShape.js — TASKS-2. WHAT A TASK IS, IN ONE PLACE.
//
// The server (counts, the views, completion rules, recurrence) and the screen
// (Tasks, Home's numbers, quick add) read these functions, so a count on Home
// and the rows it opens in Tasks can never be two different rules. Pure: no
// clock of its own. `today` is the org's civil day ("YYYY-MM-DD").

// ── Kinds ──────────────────────────────────────────────────────────────────
export const TASK_KINDS = [
  { key: "call",      label: "Call",      action: "Log the call" },
  { key: "email",     label: "Email",     action: "Draft the email" },
  { key: "meeting",   label: "Meeting",   action: "Book it" },
  { key: "thank_you", label: "Thank-you", action: "Draft the thank-you" },
  { key: "write",     label: "Write",     action: "Open Drafts" },
  { key: "other",     label: "Other",     action: null },
];
const KIND_KEYS = new Set(TASK_KINDS.map(k => k.key));

// A call or a meeting ends in "How did it go?" and "What's next?".
export const NEEDS_OUTCOME = new Set(["call", "meeting"]);

const VERB_KIND = [
  [/^(call|ring|phone|try)\b/i, "call"],
  [/^(email|e-mail|send|forward|reply)\b/i, "email"],
  [/^(meet|meeting|visit|lunch|coffee|tour|book)\b/i, "meeting"],
  [/^(thank)\b/i, "thank_you"],
  [/^(write|draft)\b/i, "write"],
];

export function kindFromTitle(title) {
  const s = String(title || "").trim();
  for (const [re, k] of VERB_KIND) if (re.test(s)) return k;
  return "other";
}

// The task's kind: the one somebody chose, else the one its words say.
export function kindOf(task) {
  const k = task && task.kind;
  if (k && KIND_KEYS.has(k)) return k;
  return kindFromTitle(task && task.title);
}

export function normalizeKind(k) { return KIND_KEYS.has(String(k)) ? String(k) : null; }

// ── Civil-day arithmetic (UTC on dates, so no zone can shift a day) ────────
const P = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || "")); return m ? [+m[1], +m[2], +m[3]] : null; };
const fmt = d => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
const asDate = s => { const p = P(s); return p ? new Date(Date.UTC(p[0], p[1] - 1, p[2])) : null; };
export function addDays(day, n) { const d = asDate(day); if (!d) return null; d.setUTCDate(d.getUTCDate() + n); return fmt(d); }
export function daysBetween(a, b) { const x = asDate(a), y = asDate(b); return x && y ? Math.round((y - x) / 86400000) : null; }
export function weekdayOf(day) { const d = asDate(day); return d ? d.getUTCDay() : null; }

// ── The views ──────────────────────────────────────────────────────────────
// Every task is in exactly ONE view. Upcoming is the next seven days; past
// that is Later. The server's SQL (routes/crm.js TASK_VIEW_SQL) says the same
// thing, and tests/tasks2-thread.test.js checks the two agree.
export const TASK_VIEWS = [
  { key: "today",    label: "Today",    definition: "Open tasks and next steps due today, in your organization's timezone." },
  { key: "upcoming", label: "Upcoming", definition: "Open tasks due in the next seven days, after today." },
  { key: "overdue",  label: "Overdue",  definition: "Open tasks whose day has passed." },
  { key: "later",    label: "Later",    definition: "Open tasks due more than seven days from now." },
  { key: "nodate",   label: "No date",  definition: "Open tasks with no day set." },
  { key: "done",     label: "Done",     definition: "Tasks finished in the last 30 days." },
];
export function viewOf(task, today) {
  if (task && (task.done === 1 || task.done === true)) return "done";
  const due = String((task && task.due) || "").slice(0, 10);
  if (!P(due)) return "nodate";
  const d = daysBetween(today, due);
  if (d < 0) return "overdue";
  if (d === 0) return "today";
  if (d <= 7) return "upcoming";
  return "later";
}

// ── Recurrence ─────────────────────────────────────────────────────────────
// { every: "week" | "month" | "quarter", nth?: 1..4 | -1, weekday?: 0..6 }
// nth+weekday is "the first Monday" of each month or quarter.
export function normalizeRecur(r) {
  if (!r || typeof r !== "object") return null;
  const every = ["week", "month", "quarter"].includes(r.every) ? r.every : null;
  if (!every) return null;
  const out = { every };
  if (every !== "week" && Number.isInteger(r.nth) && (r.nth === -1 || (r.nth >= 1 && r.nth <= 4))
      && Number.isInteger(r.weekday) && r.weekday >= 0 && r.weekday <= 6) { out.nth = r.nth; out.weekday = r.weekday; }
  return out;
}
function nthWeekday(year, month0, nth, weekday) {
  if (nth === -1) {
    const last = new Date(Date.UTC(year, month0 + 1, 0));
    last.setUTCDate(last.getUTCDate() - ((last.getUTCDay() - weekday + 7) % 7));
    return fmt(last);
  }
  const first = new Date(Date.UTC(year, month0, 1));
  first.setUTCDate(1 + ((weekday - first.getUTCDay() + 7) % 7) + (nth - 1) * 7);
  return fmt(first);
}
// The next due day after `due` (or after today when the task had none).
export function nextDue(recur, due, today) {
  const r = normalizeRecur(recur);
  if (!r) return null;
  const from = P(due) ? String(due).slice(0, 10) : today;
  if (r.every === "week") return addDays(from, 7);
  const months = r.every === "month" ? 1 : 3;
  const p = P(from);
  const y = p[0], m0 = p[1] - 1 + months;
  const Y = y + Math.floor(m0 / 12), M = ((m0 % 12) + 12) % 12;
  if (r.nth != null) return nthWeekday(Y, M, r.nth, r.weekday);
  const lastDay = new Date(Date.UTC(Y, M + 1, 0)).getUTCDate();
  return fmt(new Date(Date.UTC(Y, M, Math.min(p[2], lastDay))));
}
export function recurPhrase(recur) {
  const r = normalizeRecur(recur);
  if (!r) return "";
  const W = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const N = { 1: "first", 2: "second", 3: "third", 4: "fourth", "-1": "last" };
  if (r.every === "week") return "Every week";
  const base = r.every === "month" ? "Every month" : "Every quarter";
  return r.nth != null ? `${base}, ${N[r.nth]} ${W[r.weekday]}` : base;
}

// ── Quick add ──────────────────────────────────────────────────────────────
// "Call Bill Harmon Friday 2pm about the gala" →
//   { title: "Call about the gala", kind: "call", due: <Friday>, time: "14:00",
//     nameSpans: ["Bill Harmon"] }
// The parser finds the day, the time, a repeat and the priority by rule, and
// offers the capitalised runs it could not place as possible names. The
// server looks those up among the org's people; nothing here guesses a person.
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WD_RE = "(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|sday|nesday|rsday|urday)?";
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MON_RE = "(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\\.?";
const wdIndex = w => { const s = w.toLowerCase().slice(0, 3); return WEEKDAYS.findIndex(d => d.startsWith(s)); };
const NTH = { first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4, last: -1 };

export function parseQuickAdd(text, today) {
  let s = " " + String(text || "").replace(/\s+/g, " ").trim() + " ";
  const out = { title: "", kind: "other", due: null, time: null, recur: null, priority: "medium", nameSpans: [], matched: [] };
  const take = (re, fn) => { const m = re.exec(s); if (!m) return false; const r = fn(m); if (r === false) return false; out.matched.push(m[0].trim()); s = s.slice(0, m.index) + " " + s.slice(m.index + m[0].length); return true; };

  // Priority.
  take(/\s(!+|high priority|urgent|important)(?=[\s,.]|$)/i, () => { out.priority = "high"; });

  // A repeat, with its own day where it has one.
  take(new RegExp(`[\\s,]+(?:every|each)\\s+(first|1st|second|2nd|third|3rd|fourth|4th|last)\\s+${WD_RE}(?:\\s+of\\s+(?:the|each|every)\\s+(month|quarter))?(?=[\\s,.]|$)`, "i"), m => {
    out.recur = { every: (m[3] || "month").toLowerCase(), nth: NTH[m[1].toLowerCase()], weekday: wdIndex(m[2]) };
  }) ||
  take(new RegExp(`[\\s,]+(?:monthly|every month|each month)[\\s,]+(?:on\\s+)?(?:the\\s+)?(first|1st|second|2nd|third|3rd|fourth|4th|last)\\s+${WD_RE}(?=[\\s,.]|$)`, "i"), m => {
    out.recur = { every: "month", nth: NTH[m[1].toLowerCase()], weekday: wdIndex(m[2]) };
  }) ||
  take(new RegExp(`[\\s,]+(?:every|each)\\s+${WD_RE}(?=[\\s,.]|$)`, "i"), m => {
    out.recur = { every: "week" }; const w = wdIndex(m[1]); const d = weekdayOf(today);
    out.due = addDays(today, ((w - d) + 7) % 7);
  }) ||
  take(/[\s,]+(weekly|every week|each week|monthly|every month|each month|quarterly|every quarter|each quarter)(?=[\s,.]|$)/i, m => {
    const w = m[1].toLowerCase(); out.recur = { every: w.includes("week") ? "week" : w.includes("month") ? "month" : "quarter" };
  });
  // "Board report draft, first Monday" — an nth weekday with no "every" is monthly.
  if (!out.recur) take(new RegExp(`[\\s,]+(?:on\\s+)?(?:the\\s+)?(first|1st|second|2nd|third|3rd|fourth|4th|last)\\s+${WD_RE}(?:\\s+of\\s+(?:the|each|every)\\s+(month|quarter))?(?=[\\s,.]|$)`, "i"), m => {
    out.recur = { every: (m[3] || "month").toLowerCase(), nth: NTH[m[1].toLowerCase()], weekday: wdIndex(m[2]) };
  });
  if (out.recur && out.recur.nth != null && !out.due) {
    // The first such day on or after today.
    const p = P(today);
    const cand = nthWeekday(p[0], p[1] - 1, out.recur.nth, out.recur.weekday);
    out.due = cand >= today ? cand : nextDue(out.recur, cand, today);
  }

  // The day.
  if (!out.due) {
    take(/\s(today|tonight)(?=[\s,.]|$)/i, () => { out.due = today; }) ||
    take(/\s(tomorrow|tmrw)(?=[\s,.]|$)/i, () => { out.due = addDays(today, 1); }) ||
    take(/\sin\s+(\d{1,2}|a|one|two|three|four|five|six)\s+(day|days|week|weeks)(?=[\s,.]|$)/i, m => {
      const n = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 }[m[1].toLowerCase()] || Number(m[1]);
      out.due = addDays(today, /week/i.test(m[2]) ? n * 7 : n);
    }) ||
    take(/\s(next week)(?=[\s,.]|$)/i, () => { const d = weekdayOf(today); out.due = addDays(today, ((1 - d) + 7) % 7 || 7); }) ||
    take(new RegExp(`\\s(?:on\\s+)?(next\\s+|this\\s+)?${WD_RE}(?=[\\s,.]|$)`, "i"), m => {
      const w = wdIndex(m[2]); if (w < 0) return false;
      const d = weekdayOf(today);
      if (m[1] && /next/i.test(m[1])) {
        // "next Tuesday" is the Tuesday of next week (weeks start Monday).
        const monday = addDays(today, ((8 - d) % 7) || 7);
        out.due = addDays(monday, ((w - 1) + 7) % 7);
      } else out.due = addDays(today, ((w - d) + 7) % 7);
    }) ||
    take(new RegExp(`\\s(?:on\\s+)?${MON_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?(?=[\\s,.]|$)`, "i"), m => {
      const mi = MONTHS.indexOf(m[1].toLowerCase().slice(0, 3)); const day = Number(m[2]);
      if (mi < 0 || day < 1 || day > 31) return false;
      const ty = Number(String(today).slice(0, 4));
      let y = m[3] ? Number(m[3]) : ty;
      let cand = fmt(new Date(Date.UTC(y, mi, day)));
      if (!m[3] && cand < today) cand = fmt(new Date(Date.UTC(y + 1, mi, day)));
      out.due = cand;
    }) ||
    take(/\s(?:on\s+)?(\d{4})-(\d{2})-(\d{2})(?=[\s,.]|$)/, m => { out.due = `${m[1]}-${m[2]}-${m[3]}`; }) ||
    take(/\s(?:on\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?=[\s,.]|$)/, m => {
      const mo = Number(m[1]), da = Number(m[2]); if (mo < 1 || mo > 12 || da < 1 || da > 31) return false;
      const ty = Number(String(today).slice(0, 4));
      let y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : ty;
      let cand = fmt(new Date(Date.UTC(y, mo - 1, da)));
      if (!m[3] && cand < today) cand = fmt(new Date(Date.UTC(y + 1, mo - 1, da)));
      out.due = cand;
    });
  }

  // The time.
  take(/\s(?:at\s+)?(noon|midday)(?=[\s,.]|$)/i, () => { out.time = "12:00"; }) ||
  take(/\s(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)(?=[\s,.]|$)/i, m => {
    let h = Number(m[1]); const mi = Number(m[2] || 0); if (h < 1 || h > 12 || mi > 59) return false;
    const pm = /^p/i.test(m[3]); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0;
    out.time = `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
  }) ||
  take(/\s(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)(?=[\s,.]|$)/, m => { out.time = `${m[1].padStart(2, "0")}:${m[2]}`; }) ||
  take(/\sat\s+(\d{1,2})(?=[\s,.]|$)/i, m => {
    let h = Number(m[1]); if (h < 1 || h > 12) return false;
    if (h < 8) h += 12;                     // "at 2" in a working day is the afternoon
    out.time = `${String(h).padStart(2, "0")}:00`;
  });

  // What is left: the verb, a possible name, and what it is about.
  s = s.replace(/\s+/g, " ").replace(/\s+([,.])/g, "$1").replace(/^[\s,]+|[\s,]+$/g, "");
  const words = s.split(" ").filter(Boolean);
  out.kind = kindFromTitle(words[0] || "");
  // Capitalised runs after the first word, not a month or weekday, are names to look up.
  const STOP = new RegExp(`^(?:${WD_RE}|${MON_RE}|I|The|A|An)$`, "i");
  for (let i = 1; i < words.length; i++) {
    const w = words[i].replace(/[,.;:!?]+$/, "");
    if (!/^[A-Z][\w'’.-]*$/.test(w) || STOP.test(w)) continue;
    let j = i; const run = [w];
    while (j + 1 < words.length && /^[A-Z][\w'’.-]*$/.test(words[j + 1].replace(/[,.;:!?]+$/, "")) && !STOP.test(words[j + 1].replace(/[,.;:!?]+$/, ""))) {
      j++; run.push(words[j].replace(/[,.;:!?]+$/, ""));
      if (/[,.;:]$/.test(words[j])) break;
    }
    out.nameSpans.push(run.join(" "));
    i = j;
  }
  out.rest = s;
  out.title = s.charAt(0).toUpperCase() + s.slice(1);
  return out;
}

// Once the server has matched a span to a person, the person's name leaves
// the title: "Call Bill Harmon about the gala" → "Call about the gala". The
// chip carries the person, so the title does not repeat them.
const HONORIFIC = "(?:(?:Rev|Dr|Mr|Mrs|Ms|Mx|Fr|Sr|Pastor|Prof)\\.?\\s+)?";
export function titleWithout(rest, span) {
  const s = String(rest || "");
  const up = x => x.charAt(0).toUpperCase() + x.slice(1);
  if (!span) return up(s);
  const esc = span.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const t = s.replace(new RegExp(`\\s*(?:\\b(?:the|a)\\s+)?${HONORIFIC}\\b${esc}('s|’s)?\\b`, "i"), "").replace(/\s+/g, " ").replace(/\s+([,.])/g, "$1").trim();
  const clean = t.replace(/^[,\s]+|[,\s]+$/g, "");
  // Nothing left but the verb ("Call", "Thank"): the name stays in the title.
  if (clean.split(" ").length < 2) return up(s);
  return up(clean);
}
