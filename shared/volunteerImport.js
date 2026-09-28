// shared/volunteerImport.js — VOL-2 Part 2. A VOLUNTEER FILE, NOT AN HOURS FILE.
//
// VOL-1 could read an HOURS export: who, when, how long. That is one column
// family out of four, and it is not what a coordinator actually has. What she
// has is the file her old system gave her when she left it, and that file
// carries PEOPLE (with phone numbers and addresses), their HOURS HISTORY,
// their SHIFTS, and the two dated things that decide whether they may work at
// all: a waiver and a background check.
//
// So this reads all four out of one file, and it is a PRESET ON THE ONE
// MAPPER rather than a second importer (the BUILD-89d rule): the file is read
// by `parseFileToSheets`, the same parser every other import uses, and every
// decision — which vendor wrote it, which column is which, what is refused
// and why — is made by the SERVER in POST /volunteer-hub/import/preview,
// which writes nothing.
//
// WHAT IT NEVER DOES: create a donor. A person who arrives through this file
// is a person with the Volunteer role and no giving history, because they
// have not given. Nothing here writes a gift, a stage or a donor tag.
//
// Pure: no DB, no network, no clock (today is passed in), no JSX.

import {
  MAX_SHIFT_HOURS, hoursToHundredths, validateShift, shiftKey,
  hoursFromTimes, parseShiftDate,
} from "./volunteerHours.js";

const norm = h => String(h || "").trim().toLowerCase().replace(/[_\s]+/g, " ");

// ── THE PRESETS ────────────────────────────────────────────────────────────
// Five, and the fifth is the honest one. Four vendors whose documented export
// shapes we can name, and "a plain spreadsheet" for the file somebody typed
// themselves, which is what a small organisation usually actually has.
//
// `confidence` is carried through to the screen. "documented-not-walked" means
// the column names come from the vendor's own export documentation and nobody
// here has held a real file from it. A preset that turns out wrong is an edit
// to this table and a suite that fails by name, not a guess a person has to
// discover from a bad import.
export const VOLUNTEER_PRESETS = {
  volunteerhub: {
    label: "VolunteerHub",
    confidence: "documented-not-walked",
    signal: ["event date", "event name", "hours served", "volunteer hours", "user group"],
    columns: {
      name: ["name", "full name"],
      firstName: ["first name", "firstname"], lastName: ["last name", "lastname"],
      email: ["email", "email address"],
      phone: ["phone", "phone number", "mobile", "cell"],
      date: ["event date", "date", "event start"],
      hours: ["hours", "volunteer hours", "total hours", "hours served"],
      role: ["event name", "event", "role"],
      group: ["user group", "group"],
      waiverSignedOn: ["waiver signed", "waiver date", "waiver signed on"],
      waiverExpiresOn: ["waiver expires", "waiver expiration"],
      checkSignedOn: ["background check date", "background check completed", "screening date"],
      checkExpiresOn: ["background check expires", "screening expires"],
    },
  },
  signupgenius: {
    label: "SignUpGenius",
    confidence: "documented-not-walked",
    signal: ["sign up item", "signup", "item", "slot date", "start time", "end time"],
    columns: {
      name: ["name", "full name"],
      firstName: ["first name", "firstname"], lastName: ["last name", "lastname"],
      email: ["email", "email address"],
      phone: ["phone", "phone number"],
      date: ["date", "sign up date", "slot date", "event date"],
      hours: ["hours", "duration", "total hours"],
      // A SignUpGenius report is a SIGN-UP sheet, not an hours sheet: one row
      // per person per slot, with a start and an end and often no hours column
      // at all. The times become the hours when the row carries no number.
      startTime: ["start time", "from", "time"],
      endTime: ["end time", "to"],
      role: ["item", "slot", "sign up item", "signup", "title", "event title"],
      group: ["group"],
    },
  },
  wranglr: {
    label: "Wranglr",
    confidence: "documented-not-walked",
    signal: ["shift date", "shift name", "hours worked"],
    columns: {
      name: ["volunteer name", "volunteer", "name", "full name"],
      firstName: ["first name"], lastName: ["last name"],
      email: ["email", "email address", "volunteer email"],
      phone: ["phone", "phone number", "mobile"],
      date: ["shift date", "date", "start date"],
      hours: ["hours", "hours worked", "duration (hours)", "shift hours"],
      role: ["role", "shift", "shift name", "position", "activity"],
      group: ["team", "crew", "group"],
      waiverSignedOn: ["waiver signed", "waiver date"],
      checkSignedOn: ["background check", "background check date"],
    },
  },
  // VOL-2 — Bloomerang Volunteer (the product formerly sold as InitLive). Its
  // exports are shift-shaped and carry the two screening dates as columns,
  // which is why it is worth its own preset rather than the plain reader.
  bloomerang_volunteer: {
    label: "Bloomerang Volunteer",
    confidence: "documented-not-walked",
    signal: ["shift name", "scheduled start", "scheduled end", "check in", "check out", "position name"],
    columns: {
      name: ["name", "full name", "volunteer name"],
      firstName: ["first name"], lastName: ["last name"],
      email: ["email", "email address"],
      phone: ["phone", "mobile phone", "phone number"],
      date: ["shift date", "date", "scheduled start date"],
      hours: ["hours", "total hours", "hours worked", "duration"],
      startTime: ["scheduled start", "check in", "start"],
      endTime: ["scheduled end", "check out", "end"],
      role: ["position name", "shift name", "position", "role"],
      group: ["team", "group", "department"],
      waiverSignedOn: ["waiver signed", "waiver completed"],
      waiverExpiresOn: ["waiver expires"],
      checkSignedOn: ["background check completed", "screening completed"],
      checkExpiresOn: ["background check expires", "screening expires"],
    },
  },
  // THE ONE FOR THE FILE SOMEBODY TYPED. No signal columns: it is what you get
  // when nothing else matches, and it reads the plainest possible names.
  spreadsheet: {
    label: "A plain spreadsheet",
    confidence: "plain-columns",
    signal: [],
    columns: {
      name: ["name", "full name", "volunteer", "volunteer name"],
      firstName: ["first name", "first"], lastName: ["last name", "last", "surname"],
      email: ["email", "e-mail", "email address"],
      phone: ["phone", "telephone", "mobile", "cell", "phone number"],
      date: ["date", "shift date", "day"],
      hours: ["hours", "hrs", "time", "hours worked"],
      startTime: ["start time", "start"], endTime: ["end time", "end"],
      role: ["role", "what they did", "activity", "task", "job"],
      group: ["group", "team", "crew"],
      waiverSignedOn: ["waiver", "waiver signed", "waiver date"],
      waiverExpiresOn: ["waiver expires"],
      checkSignedOn: ["background check", "background check date", "dbs", "screening"],
      checkExpiresOn: ["background check expires", "screening expires"],
    },
  },
};
export const VOLUNTEER_PRESET_KEYS = Object.keys(VOLUNTEER_PRESETS);
export const presetLabel = k => (VOLUNTEER_PRESETS[k] || {}).label || k;

// Which vendor wrote this file. Scored on the signal columns; the plain reader
// wins by default because it has none, and it is the honest answer to "we do
// not recognise this" — a file nobody can place is still a file full of people.
export function detectVolunteerPreset(headers) {
  const hs = new Set((headers || []).map(norm));
  let best = "spreadsheet", score = 0;
  for (const [key, p] of Object.entries(VOLUNTEER_PRESETS)) {
    const s = (p.signal || []).filter(x => hs.has(x)).length;
    if (s > score) { best = key; score = s; }
  }
  return { key: best, score, confident: score >= 2 };
}

// THE VENDOR PRESET FIRST, THEN THE PLAIN READER FOR WHAT IT DID NOT NAME.
//
// A vendor's preset only lists the columns that vendor ships. A real export has
// been edited: somebody added a "Waiver Signed" column to their SignUpGenius
// report because SignUpGenius does not have one. Mapping with the vendor preset
// alone silently DROPPED those columns, and the waivers in the file arrived as
// nothing at all — found on the first test file this module was given.
//
// So every field the chosen preset leaves null is filled from the plain
// reader's candidates. It can only FILL a gap, never override a vendor
// mapping, and never take a header another field has already claimed.
export function mapVolunteerColumns(headers, presetKey) {
  const p = VOLUNTEER_PRESETS[presetKey] || VOLUNTEER_PRESETS.spreadsheet;
  const byNorm = new Map((headers || []).map(h => [norm(h), h]));
  const out = {};
  for (const [field, cands] of Object.entries(p.columns)) {
    out[field] = cands.map(c => byNorm.get(c)).find(Boolean) || null;
  }
  const taken = new Set(Object.values(out).filter(Boolean));
  for (const [field, cands] of Object.entries(VOLUNTEER_PRESETS.spreadsheet.columns)) {
    if (out[field]) continue;
    const hit = cands.map(c => byNorm.get(c)).find(h => h && !taken.has(h));
    if (hit) { out[field] = hit; taken.add(hit); }
  }
  return out;
}

// A dated credential cell. Returns null rather than guessing: a waiver with an
// unreadable date is a waiver nobody can prove, and inventing one is worse than
// leaving the column out and saying so.
function credentialDate(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return null;
  // A tick rather than a date ("yes", "y", "true", "signed") is NOT a date and
  // must not become today's: what a screening is worth is entirely its date.
  if (/^(y|yes|true|x|signed|complete|completed|done|ok)$/i.test(s)) return { unusable: "ticked, with no date" };
  const d = parseShiftDate(s);
  return d ? { date: d } : { unusable: `unreadable date "${s.slice(0, 20)}"` };
}

const cell = (row, col) => (col ? String(row[col] == null ? "" : row[col]).trim() : "");

// ── THE PLAN ───────────────────────────────────────────────────────────────
// Rows in, PEOPLE out — one entry per person, with their shifts and their
// credentials folded onto them, because a file with eleven rows for one person
// is eleven shifts and ONE volunteer, and a preview that says "11 people" is a
// preview of the wrong import.
//
// `today` is passed in (the org's civil today). Nothing here reads a clock.
export function planVolunteerImport(rows, map, { today = null, maxRows = 20000 } = {}) {
  const people = new Map();       // key -> person
  const refused = [];
  let shiftRows = 0, credentialRows = 0, futureShifts = 0;

  const keyFor = (email, name) => (email ? "e:" + email.toLowerCase() : "n:" + name.toLowerCase());

  (rows || []).slice(0, maxRows).forEach((r, i) => {
    const line = i + 2;           // +2: a header line, and humans count from 1
    const name = cell(r, map.name)
      || [cell(r, map.firstName), cell(r, map.lastName)].filter(Boolean).join(" ");
    const email = cell(r, map.email).toLowerCase();
    if (!name && !email) { refused.push({ line, why: "no name and no email, so there is nobody to add" }); return; }

    const k = keyFor(email, name);
    let p = people.get(k);
    if (!p) {
      p = { key: k, name: name || email, email: email || null, phone: null,
            group: null, shifts: [], credentials: [], lines: [] };
      people.set(k, p);
    }
    p.lines.push(line);
    // First non-empty wins for the scalar details: a later blank cell must not
    // wipe a phone number an earlier row gave.
    if (!p.name && name) p.name = name;
    if (!p.email && email) p.email = email;
    if (!p.phone) { const ph = cell(r, map.phone); if (ph) p.phone = ph.slice(0, 40); }
    if (!p.group) { const g = cell(r, map.group); if (g) p.group = g.slice(0, 160); }

    // ── the shift on this row, if there is one ──────────────────────────
    const rawDate = cell(r, map.date);
    if (rawDate) {
      const date = parseShiftDate(rawDate);
      let hours = cell(r, map.hours);
      let derived = false;
      if (!hours && (map.startTime || map.endTime)) {
        const h = hoursFromTimes(cell(r, map.startTime), cell(r, map.endTime));
        if (h !== null) { hours = h / 100; derived = true; }
      }
      if (!date) {
        refused.push({ line, name: p.name, why: `unreadable shift date "${rawDate.slice(0, 20)}"` });
      } else if (hours === "" || hours === null || hours === undefined) {
        refused.push({ line, name: p.name, why: "a date with no hours and no start and end time" });
      } else {
        const v = validateShift({ date, hours, role: cell(r, map.role) });
        if (!v.ok) refused.push({ line, name: p.name, why: v.errors.join("; ") });
        else {
          // A shift dated in the FUTURE is a sign-up, not hours worked. It is
          // counted and named rather than imported as hours: hours somebody
          // has not given yet are the fastest way to a grant report that lies.
          if (today && v.shift.date > today) { futureShifts++; refused.push({ line, name: p.name, why: `dated ${v.shift.date}, which is in the future, so it is a shift they have not worked yet` }); }
          else {
            shiftRows++;
            p.shifts.push({ ...v.shift, hours: v.shift.hundredths / 100, line,
                            derivedFromTimes: derived,
                            key: shiftKey({ email, name: p.name, date: v.shift.date, hundredths: v.shift.hundredths, role: v.shift.role }) });
          }
        }
      }
    }

    // ── the two dated things that decide whether they may work ──────────
    for (const [kind, onCol, expCol] of [
      ["waiver", map.waiverSignedOn, map.waiverExpiresOn],
      ["background_check", map.checkSignedOn, map.checkExpiresOn],
    ]) {
      if (!onCol) continue;
      const signed = credentialDate(r[onCol]);
      if (!signed) continue;
      if (signed.unusable) {
        refused.push({ line, name: p.name, why: `${kind === "waiver" ? "waiver" : "background check"} ${signed.unusable}` });
        continue;
      }
      const exp = expCol ? credentialDate(r[expCol]) : null;
      const expires = exp && exp.date ? exp.date : null;
      // One per person per kind, newest signing wins: a file with a row per
      // shift repeats the same waiver on every one of them.
      const existing = p.credentials.find(c => c.kind === kind);
      if (existing) { if (signed.date > existing.signedOn) { existing.signedOn = signed.date; existing.expiresOn = expires; } continue; }
      credentialRows++;
      p.credentials.push({ kind, signedOn: signed.date, expiresOn: expires });
    }
  });

  const list = [...people.values()].map(p => ({
    ...p,
    hundredths: p.shifts.reduce((a, s) => a + s.hundredths, 0),
  }));

  return {
    people: list,
    counts: {
      rows: Math.min((rows || []).length, maxRows),
      people: list.length,
      shifts: shiftRows,
      credentials: credentialRows,
      hundredths: list.reduce((a, p) => a + p.hundredths, 0),
      withEmail: list.filter(p => p.email).length,
      futureShifts,
      refused: refused.length,
    },
    refused,
  };
}

// The sentence over the preview, built from the plan so it cannot describe a
// different import from the one the button will run.
export function previewSentence(counts, label) {
  if (!counts || !counts.people) return "Nothing in this file could be read as a volunteer.";
  const bits = [`${counts.people} ${counts.people === 1 ? "person" : "people"}`];
  if (counts.shifts) bits.push(`${counts.shifts} ${counts.shifts === 1 ? "shift" : "shifts"} (${Math.round(counts.hundredths / 100)} hours)`);
  if (counts.credentials) bits.push(`${counts.credentials} ${counts.credentials === 1 ? "waiver or check" : "waivers and checks"}`);
  return `${label}: ${bits.join(", ")} from ${counts.rows} ${counts.rows === 1 ? "row" : "rows"}.`;
}

export { MAX_SHIFT_HOURS, hoursToHundredths, shiftKey, parseShiftDate };
