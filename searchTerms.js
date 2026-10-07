// searchTerms.js · SEARCH-2. WHAT A SEARCH MEANS, BEFORE IT IS RUN.
//
// ⌘K reads a few kinds of words as more than words:
//
//   "$500", "500.00", "$1,250"   an amount: gifts, pledges and monthly plans of exactly that much
//   "1053"                       a bare number: an amount, or a cheque number
//   "Oct 3", "October 3 2025",
//   "10/3", "10/3/2025",
//   "2025-10-03"                 a day: that day's gifts and meetings (no year: that day in any year)
//   "Rafael gift", "Rafael's gifts"
//                                a name and then "gift": that person's gifts
//
// Pure: no database, no clock. Every reading is a plain object the route turns
// into a query; anything not recognised stays words.
"use strict";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function monthIndex(word) {
  const w = String(word || "").toLowerCase().replace(/\.$/, "");
  if (w.length < 3) return -1;
  const i = MONTHS.indexOf(w.slice(0, 3));
  if (i < 0) return -1;
  // "sept" and the full name are fine; "octopus" is not.
  const full = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"][i];
  return (full.startsWith(w) || w === "sept") ? i : -1;
}

function validDay(y, m, d) {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return false;
  const yy = y || 2024; // a leap year, so "Feb 29" with no year is a real day
  const dt = new Date(Date.UTC(yy, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function fullYear(y) {
  if (y == null) return null;
  const n = Number(y);
  if (String(y).length === 2) return 2000 + n;
  return n >= 1900 && n <= 2100 ? n : NaN;
}

// "Oct 3" -> { month: 10, day: 3, year: null }; null when it is not a day.
function readDate(q) {
  const s = String(q || "").trim().replace(/,/g, " ").replace(/\s+/g, " ");
  let m, y, d;
  let hit = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (hit) { y = Number(hit[1]); m = Number(hit[2]); d = Number(hit[3]); }
  if (!hit && (hit = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/))) {
    m = Number(hit[1]); d = Number(hit[2]); y = fullYear(hit[3]);
  }
  if (!hit && (hit = s.match(/^([A-Za-z]+\.?) (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/))) {
    m = monthIndex(hit[1]) + 1; d = Number(hit[2]); y = hit[3] ? Number(hit[3]) : null;
  }
  if (!hit && (hit = s.match(/^(\d{1,2}) ([A-Za-z]+\.?)(?: (\d{4}))?$/))) {
    m = monthIndex(hit[2]) + 1; d = Number(hit[1]); y = hit[3] ? Number(hit[3]) : null;
  }
  if (!hit || Number.isNaN(y) || !validDay(y, m, d)) return null;
  const mm = String(m).padStart(2, "0"), dd = String(d).padStart(2, "0");
  return { year: y || null, month: m, day: d, monthDay: `${mm}-${dd}`, iso: y ? `${y}-${mm}-${dd}` : null,
    label: `${MONTHS[m - 1].charAt(0).toUpperCase()}${MONTHS[m - 1].slice(1)} ${d}${y ? " " + y : ""}` };
}

// "$1,250.50" -> { dollars: 1250.5, explicit: true }; "1053" -> { dollars: 1053, explicit: false }.
function readAmount(q) {
  const s = String(q || "").trim();
  const hit = s.match(/^(\$\s?)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?$/);
  if (!hit) return null;
  const dollars = Number(hit[2].replace(/,/g, "") + (hit[3] || ""));
  if (!(dollars > 0) || dollars > 1e9) return null;
  return { dollars, explicit: !!hit[1] || !!hit[3] || hit[2].includes(","), digits: hit[1] || hit[3] ? null : hit[2].replace(/,/g, "") };
}

// "Rafael's gifts" -> "Rafael". Null when the words do not end in gift/gifts/giving.
function readPersonGifts(q) {
  const hit = String(q || "").trim().match(/^(.{2,}?)(?:'s|’s|s')?\s+(?:gift|gifts|giving)$/i);
  if (!hit) return null;
  const name = hit[1].trim();
  return name.length >= 2 ? name : null;
}

function readSearch(q) {
  return { amount: readAmount(q), date: readDate(q), personGifts: readPersonGifts(q) };
}

module.exports = { readSearch, readDate, readAmount, readPersonGifts };
