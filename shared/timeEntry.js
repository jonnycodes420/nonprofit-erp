// shared/timeEntry.js · FLOWS-5 (W-1110-Volunteers-09X). A TIME AS SHE TYPES IT.
//
// Typing 11:00 into a shift's start gave 9:11 AM: the box was the browser's
// own time control, pre-filled with 09:00, and the keystrokes landed in its
// minutes. A time box now takes what a person types, in 12- or 24-hour form:
//   "11" "11:00" "1100" "11am" "11 a.m." "11:30pm" "23:00" "9.30"
// and says what it read ("11:00 AM") before anything is saved.
// A bare hour from 1 to 6 with no am/pm is read as afternoon ("3" is 3 PM),
// the way a shift is said out loud; 7 to 11 is morning; 12 is noon.

export function parseTimeEntry(text) {
  const t = String(text == null ? "" : text).trim().toLowerCase().replace(/\s+/g, " ");
  if (!t) return { ok: true, value: "" };
  const m = t.match(/^(\d{1,2})(?:[:.h]?(\d{2}))?\s*(a\.?m?\.?|p\.?m?\.?|noon|midnight)?$/);
  if (!m) return { ok: false, error: "Type a time like 11, 11:00, 11am or 23:00." };
  let h = Number(m[1]); const min = m[2] == null ? 0 : Number(m[2]); const ap = m[3] || "";
  if (min > 59) return { ok: false, error: "Minutes run from 00 to 59." };
  if (ap === "noon") { if (h !== 12) return { ok: false, error: "Noon is 12." }; }
  else if (ap === "midnight") { if (h !== 12) return { ok: false, error: "Midnight is 12." }; h = 0; }
  else if (ap.startsWith("a")) { if (h < 1 || h > 12) return { ok: false, error: "With am, the hour is 1 to 12." }; if (h === 12) h = 0; }
  else if (ap.startsWith("p")) { if (h < 1 || h > 12) return { ok: false, error: "With pm, the hour is 1 to 12." }; if (h !== 12) h += 12; }
  else {
    if (h > 23) return { ok: false, error: "The hour runs from 0 to 23." };
    const twoDigits = /^\d{2}/.test(m[1]);
    if (!twoDigits && m[2] == null && h >= 1 && h <= 6) h += 12;   // "3" said for a shift is the afternoon
  }
  const value = `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  return { ok: true, value };
}

// "13:30" → "1:30 PM".
export function showTime(hhmm) {
  const m = String(hhmm || "").match(/^(\d{2}):(\d{2})/);
  if (!m) return "";
  const h = Number(m[1]), min = m[2];
  return `${h % 12 === 0 ? 12 : h % 12}:${min} ${h < 12 ? "AM" : "PM"}`;
}
