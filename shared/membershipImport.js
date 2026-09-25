// shared/membershipImport.js — BUILD-101 Part 6. MEMBERSHIPS FROM A FILE.
//
// Presets on the ONE mapper, never a second importer (the BUILD-89S 89d rule).
// A preset says which of a vendor's column names carry the level and the
// dates; the mapper then treats those columns as mapped rather than asking
// the person to turn them into custom fields. Every preset states that it was
// written from the vendor's documented export and has not yet met a real file.
//
// THREE RULES THE ROWS OBEY:
//   · A LEVEL NAMED IN THE FILE IS MATCHED to the org's own levels,
//     case-insensitively. An unknown level is HELD for a human, by line number,
//     and never created — a level carries a price and a fair-market value, and
//     neither can be guessed from a word in a spreadsheet.
//   · AN IMPORTED MEMBERSHIP IS HISTORY: it carries no payment, so it never
//     posts to the ledger, and a date already past never opens a renewal thread.
//   · A ROW THAT CANNOT BE READ IS SET ASIDE WITH ITS REASON AND ITS LINE, never
//     dropped in silence.
//
// Pure: no DB, no network, no clock. Dates come back as YYYY-MM-DD.

export const MEMBERSHIP_FIELDS = ["membershipLevel", "membershipJoined", "membershipStart", "membershipExpires"];
export const MEMBERSHIP_FIELD_LABELS = {
  membershipLevel: "Membership level",
  membershipJoined: "Member since",
  membershipStart: "Membership start",
  membershipExpires: "Membership expires",
};

// Header words for each field, across every preset. Matched on the whole
// normalised header (lower case, punctuation to spaces), never as a substring:
// "Level" alone is too common a word to claim, so it is only taken when the
// file is recognised as a membership file.
export const MEMBERSHIP_HEADER_LABELS = {
  membershipLevel: ["membership level", "member level", "membership level name", "membership type", "membership program level"],
  membershipJoined: ["member since", "joined", "date joined", "join date", "original join date", "membership join date"],
  membershipStart: ["membership start date", "membership start", "start date", "current term start", "membership begin date"],
  membershipExpires: ["membership end date", "membership expiration date", "membership expiry date", "membership expires", "expires", "expiration date", "expiry date", "end date", "membership end"],
};

export const MEMBERSHIP_PRESETS = {
  plain: {
    label: "A plain spreadsheet",
    signals: [],
    columns: { membershipLevel: ["level", "membership level"], membershipJoined: ["joined", "member since"], membershipStart: ["start", "starts"], membershipExpires: ["expires", "expiry", "end date"] },
    confidence: "the shape the brief names: name, email, level, joined, expires",
  },
  npsp: {
    label: "Salesforce NPSP (Opportunity)",
    signals: ["membership origin", "opportunity name", "account name", "stage"],
    columns: { membershipLevel: ["member level"], membershipStart: ["membership start date"], membershipExpires: ["membership end date"] },
    confidence: "documented-not-walked",
    note: "NPSP keeps membership on the Opportunity (npe01__Member_Level__c, npe01__Membership_Start_Date__c, npe01__Membership_End_Date__c). Export the membership Opportunities, not every Opportunity.",
  },
  bloomerang: {
    label: "Bloomerang",
    signals: ["account number", "membership program"],
    columns: { membershipLevel: ["membership level", "membership program level"], membershipStart: ["membership start date"], membershipExpires: ["membership expiration date", "membership end date"] },
    confidence: "documented-not-walked",
  },
  lgl: {
    label: "Little Green Light",
    signals: ["lgl constituent id", "lgl id"],
    columns: { membershipLevel: ["membership level", "membership level name"], membershipJoined: ["date joined"], membershipStart: ["membership start date"], membershipExpires: ["membership end date"] },
    confidence: "documented-not-walked",
  },
};
export const MEMBERSHIP_PRESET_KEYS = Object.keys(MEMBERSHIP_PRESETS);

export const norm = h => String(h || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Which column carries each membership field. A file is a membership file
// only when it carries a LEVEL column and at least one date column.
export function membershipColumns(headers = []) {
  const hs = headers.map(h => ({ raw: h, n: norm(h) }));
  const out = {};
  for (const f of MEMBERSHIP_FIELDS) {
    const hit = hs.find(h => MEMBERSHIP_HEADER_LABELS[f].includes(h.n));
    if (hit) out[f] = hit.raw;
  }
  // The plain spreadsheet's bare "Level" is claimed only beside a membership
  // DATE column: a level with no dates is somebody's own vocabulary, not a
  // membership file.
  const hasDate = !!(out.membershipStart || out.membershipJoined || out.membershipExpires);
  if (!out.membershipLevel && hasDate) {
    const bare = hs.find(h => MEMBERSHIP_PRESETS.plain.columns.membershipLevel.includes(h.n));
    if (bare) out.membershipLevel = bare.raw;
  }
  const isMembershipFile = !!out.membershipLevel && hasDate;
  return isMembershipFile ? out : {};
}

// The vendor, when the file says so (two signals, or one plus a column only
// that vendor names); otherwise "plain" for a membership file, null for none.
export function detectMembershipPreset(headers = []) {
  const cols = membershipColumns(headers);
  if (!cols.membershipLevel) return null;
  const hn = new Set(headers.map(norm));
  let best = null, bestScore = 0;
  for (const [key, p] of Object.entries(MEMBERSHIP_PRESETS)) {
    if (key === "plain") continue;
    const sig = p.signals.filter(s => hn.has(s)).length;
    const own = Object.values(p.columns).flat().filter(c => hn.has(c)).length;
    const score = sig * 2 + own;
    if (sig >= 1 && score > bestScore) { best = key; bestScore = score; }
  }
  return best || "plain";
}

// A date cell, to YYYY-MM-DD. ISO and US month/day/year; a day-first file
// says so through `dayFirst`. Anything else is unreadable, and said.
export function readDate(v, { dayFirst = false } = {}) {
  const s = String(v ?? "").trim();
  if (!s) return { blank: true, value: null };
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return ok3(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return dayFirst ? ok3(y, +m[2], +m[1]) : ok3(y, +m[1], +m[2]);
  }
  return { blank: false, value: null };
}
function ok3(y, mo, d) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return { blank: false, value: null };
  return { blank: false, value: `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
}

// One membership per row that names one. `line` is the spreadsheet line
// (header = 1), so a held row can be found in the file she has open.
export function buildMembershipRows(parsed, cols, { nameCol = null, emailCol = null, firstCol = null, lastCol = null, dayFirst = false, firstLine = 2 } = {}) {
  const out = { memberships: [], setAside: [] };
  if (!cols || !cols.membershipLevel) return out;
  const rows = (parsed && parsed.rows) || [];
  rows.forEach((row, i) => {
    const line = firstLine + i;
    const cell = c => (c ? String(row[c] ?? "").trim() : "");
    const level = cell(cols.membershipLevel);
    if (!level) return;                                   // not a membership row
    const name = cell(nameCol) || [cell(firstCol), cell(lastCol)].filter(Boolean).join(" ");
    const email = cell(emailCol).toLowerCase();
    if (!name && !email) { out.setAside.push({ line, level, why: "no name or email to put it on" }); return; }
    const d = {};
    for (const [k, f] of [["joined", "membershipJoined"], ["starts", "membershipStart"], ["expires", "membershipExpires"]]) {
      const r = readDate(cell(cols[f]), { dayFirst });
      if (!r.blank && !r.value) { out.setAside.push({ line, level, name, why: `the ${MEMBERSHIP_FIELD_LABELS[f].toLowerCase()} date could not be read` }); return; }
      d[k] = r.value;
    }
    const starts = d.starts || d.joined;
    if (!starts) { out.setAside.push({ line, level, name, why: "no start or join date" }); return; }
    out.memberships.push({ line, name: name || null, email: email || null, level, joined: d.joined || starts, starts, expires: d.expires || null });
  });
  return out;
}

// Case-insensitive, whitespace-tolerant; never a fuzzy guess.
export function matchLevel(levels = [], word) {
  const w = String(word || "").trim().toLowerCase().replace(/\s+/g, " ");
  const hits = levels.filter(l => String(l.name || "").trim().toLowerCase().replace(/\s+/g, " ") === w);
  return hits.length === 1 ? hits[0] : null;
}
