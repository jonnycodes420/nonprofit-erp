// shared/volunteerHours.js — BUILD-98 (switch) Part 5. VOLUNTEERS AND HOURS.
//
// BUILD-94 made a volunteer a PERSON TYPE on the same record as a donor, so a
// volunteer who gives is one person with two roles, never two rows. This adds
// the thing a volunteer programme counts: HOURS, one row per shift.
//
// Not scheduling. Wranglr and VolunteerHub schedule; Steward reads their
// exports (the presets below) and keeps the total on the person.
//
// THE RULES
//   1. Hours are counted in HUNDREDTHS, summed as integers — 0.25 + 0.5 is
//      0.75, never 0.7500000001.
//   2. A shift is at most 24 hours and more than zero. A 40-hour "shift" is a
//      week typed into one row, and a total built on it is wrong.
//   3. An imported shift has a KEY (who, day, hours, role), so importing the
//      same export twice adds nothing. Two genuinely separate shifts on one day
//      differ in role or hours; if they do not, the export itself cannot tell
//      them apart either, and the import says it folded them.
//
// Pure: no DB, no network, no clock, no JSX.

export const MAX_SHIFT_HOURS = 24;

export function hoursToHundredths(v) {
  const n = Number(String(v ?? "").trim().replace(/h(ou)?rs?$/i, "").trim());
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}
export function hundredthsToHours(h) { return Math.round(h) / 100; }

export function validateShift(raw) {
  const errors = [];
  const date = String(raw?.date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push("a date (YYYY-MM-DD)");
  const h = hoursToHundredths(raw?.hours);
  if (h === null || h <= 0) errors.push("hours greater than zero");
  else if (h > MAX_SHIFT_HOURS * 100) errors.push(`no more than ${MAX_SHIFT_HOURS} hours in one shift`);
  const role = String(raw?.role || "").trim().slice(0, 120) || null;
  return errors.length ? { ok: false, errors } : { ok: true, shift: { date, hundredths: h, role, note: String(raw?.note || "").trim().slice(0, 500) || null } };
}

export function shiftKey({ email, name, date, hundredths, role }) {
  const who = String(email || "").trim().toLowerCase() || String(name || "").trim().toLowerCase();
  return [who, date, hundredths, String(role || "").trim().toLowerCase()].join("|");
}

// ── THE PRESETS ────────────────────────────────────────────────────────────
// Candidate spellings from each vendor's documented exports, not walked on a
// real file — the same confidence note the NPSP preset carries. A preset that
// turns out wrong is an edit to the table and a suite that fails by name.
const norm = h => String(h || "").trim().toLowerCase().replace(/[_\s]+/g, " ");
export const HOURS_PRESETS = {
  wranglr: {
    label: "Wranglr",
    confidence: "documented-not-walked",
    columns: {
      name: ["volunteer name", "volunteer", "name", "full name"],
      firstName: ["first name"], lastName: ["last name"],
      email: ["email", "email address", "volunteer email"],
      date: ["shift date", "date", "start date"],
      hours: ["hours", "hours worked", "duration (hours)", "shift hours"],
      role: ["role", "shift", "shift name", "position", "activity"],
    },
    signal: ["shift date", "shift name", "hours worked"],
  },
  volunteerhub: {
    label: "VolunteerHub",
    confidence: "documented-not-walked",
    columns: {
      name: ["name", "full name"],
      firstName: ["first name", "firstname"], lastName: ["last name", "lastname"],
      email: ["email", "email address"],
      date: ["event date", "date", "event start"],
      hours: ["hours", "volunteer hours", "total hours", "hours served"],
      role: ["event name", "event", "role", "user group"],
    },
    signal: ["event date", "event name", "hours served", "volunteer hours", "user group"],
  },
};

export function detectHoursPreset(headers) {
  const hs = new Set((headers || []).map(norm));
  let best = null, score = 0;
  for (const [key, p] of Object.entries(HOURS_PRESETS)) {
    const s = p.signal.filter(x => hs.has(x)).length;
    if (s > score) { best = key; score = s; }
  }
  return best;
}

export function mapHoursColumns(headers, presetKey) {
  const p = HOURS_PRESETS[presetKey] || HOURS_PRESETS.wranglr;
  const byNorm = new Map((headers || []).map(h => [norm(h), h]));
  const out = {};
  for (const [field, cands] of Object.entries(p.columns)) out[field] = cands.map(c => byNorm.get(c)).find(Boolean) || null;
  return out;
}

// Parse a date cell a volunteer system writes: ISO, or US m/d/yyyy.
export function parseShiftDate(v) {
  const s = String(v || "").trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? "20" + m[3] : m[3];
    return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  return null;
}

// Rows → shifts, with every refused row counted and named by line.
export function rowsToShifts(rows, map) {
  const shifts = [], refused = [];
  (rows || []).forEach((r, i) => {
    const line = i + 2;
    const name = (map.name && String(r[map.name] || "").trim())
      || [map.firstName && r[map.firstName], map.lastName && r[map.lastName]].filter(Boolean).map(x => String(x).trim()).join(" ");
    const email = map.email ? String(r[map.email] || "").trim().toLowerCase() : "";
    if (!name && !email) { refused.push({ line, why: "no name or email" }); return; }
    const date = parseShiftDate(map.date ? r[map.date] : "");
    const v = validateShift({ date, hours: map.hours ? r[map.hours] : "", role: map.role ? r[map.role] : "" });
    if (!v.ok) { refused.push({ line, name, why: v.errors.join("; ") }); return; }
    // `hours` travels too: the server re-validates every row from `hours`, and
    // a shift that reached it carrying only `hundredths` was refused as zero.
    shifts.push({ name, email, ...v.shift, hours: v.shift.hundredths / 100, line });
  });
  return { shifts, refused };
}

// The volunteer's own link: what it says on the page and in the log.
export const SELF_LOG_DAYS = 180;
