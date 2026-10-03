// shared/birthday.js · PARITY-3 Part 6a. A BIRTHDAY IS A MONTH AND A DAY.
//
// The year is optional, because most people will tell a charity the day and
// not their age, and an import from a church file usually has "May 22" and no
// more. So a birthday is three columns on the person (birth_month, birth_day,
// birth_year), month and day required together, year on its own terms.
//
// One parser for every door: the profile's edit, both import paths, and the
// server's re-check. A cell it cannot read is refused, never guessed: "5/6"
// is May 6 here (month first, the US order the rest of the import reads), and
// a cell that is only a year or only a month is not a birthday.
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];
const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];   // Feb 29 is a real birthday
const MON = Object.fromEntries(MONTHS.flatMap((m, i) => [[m.toLowerCase(), i + 1], [m.slice(0, 3).toLowerCase(), i + 1]]));
MON.sept = 9;

export function validBirthday(month, day, year = null) {
  const m = Number(month), d = Number(day);
  if (!Number.isInteger(m) || m < 1 || m > 12) return false;
  if (!Number.isInteger(d) || d < 1 || d > DAYS_IN[m - 1]) return false;
  if (year != null && year !== "") {
    const y = Number(year);
    if (!Number.isInteger(y) || y < 1900 || y > 2100) return false;
    if (m === 2 && d === 29 && !(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0))) return false;
  }
  return true;
}

// A cell from a file, or what somebody typed. Returns { month, day, year|null }
// or null.
export function parseBirthday(raw) {
  if (raw == null) return null;
  if (raw instanceof Date && !isNaN(raw)) return pack(raw.getUTCMonth() + 1, raw.getUTCDate(), raw.getUTCFullYear());
  const s = String(raw).trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, "$1").replace(/,/g, " ").replace(/\s+/g, " ");
  if (!s) return null;
  let m;
  // 1980-05-22 / 1980/5/22
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ t].*)?$/))) return pack(+m[2], +m[3], +m[1]);
  // --05-22 (ISO without a year)
  if ((m = s.match(/^--(\d{1,2})-(\d{1,2})$/))) return pack(+m[1], +m[2], null);
  // 5/22/1980, 5-22-80, 5/22
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2}|\d{4}))?$/))) {
    let y = m[3] ? +m[3] : null;
    if (y != null && y < 100) y += y > 30 ? 1900 : 2000;
    return pack(+m[1], +m[2], y);
  }
  // May 22 1980 / may 22
  if ((m = s.match(/^([a-z]+)\.? (\d{1,2})(?: (\d{4}))?$/)) && MON[m[1]]) return pack(MON[m[1]], +m[2], m[3] ? +m[3] : null);
  // 22 May 1980 / 22 may
  if ((m = s.match(/^(\d{1,2}) ([a-z]+)\.?(?: (\d{4}))?$/)) && MON[m[2]]) return pack(MON[m[2]], +m[1], m[3] ? +m[3] : null);
  return null;
}
function pack(month, day, year) {
  return validBirthday(month, day, year) ? { month, day, year: year == null ? null : year } : null;
}

export function birthdayLabel(month, day, year = null) {
  if (!validBirthday(month, day, year)) return "";
  return `${MONTHS[month - 1]} ${day}${year ? `, ${year}` : ""}`;
}

// Is a civil day (YYYY-MM-DD, the org's own date) this person's birthday?
// Somebody born on February 29 is remembered on February 28 in a year that
// has no 29th, so the journey still starts once a year.
export function isBirthdayOn(month, day, civilDate) {
  const y = +civilDate.slice(0, 4), mm = +civilDate.slice(5, 7), dd = +civilDate.slice(8, 10);
  if (month === mm && day === dd) return true;
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  return month === 2 && day === 29 && !leap && mm === 2 && dd === 28;
}
