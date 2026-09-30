// shared/movePlan.js — TRANS-1. MOVING TAKES ABOUT A DAY.
//
// The objection is no longer the product, it is the move. A director on
// DonorPerfect with eleven years of history does not doubt that Steward is
// nicer; she doubts that her file will arrive whole, and she is right to,
// because nobody has ever shown her the proof. This module is that proof, and
// the three things around it:
//
//   1. THE TILE (Part 1). "Where are your donors today?" is asked BEFORE the
//      file, not guessed after it. Picking a tile pre-maps the vendor's
//      documented export so the mapper opens already filled in. The presets
//      themselves are shared/migrationPresets.js and shared/npspPreset.js and
//      are NOT duplicated here: a tile is a pointer, so a spelling is fixed in
//      one place (the BUILD-98 rule, applied to the front door).
//
//   2. THE HOW-TO (Part 2). Which report to run in the old system, in what
//      order, which columns to include, and what will not come across — in
//      the vendor's own menu names, printable, sendable before the call.
//      `includeColumns` is DERIVED from the preset's own column table rather
//      than typed again, so the page cannot drift from the mapping it
//      describes.
//
//   3. THE MOVE REPORT (Part 3). Every figure Steward holds beside the same
//      figure from the file. The headline is the proof, and it may only say
//      "Matches your file to the cent" when the cents actually match — the
//      BUILD-87 rule that a sentence never claims a balance it cannot back.
//
// A tile that has no documented export says so and claims no integration.
// eKYROS is the honest case: it is a client-services system for pregnancy
// centres, it holds clients and appointments rather than donors, and no donor
// export format is published. Its tile takes the spreadsheet path and its
// page says where the donor list actually lives.
//
// Pure: no DB, no network, no clock, no JSX. Money is integer cents
// throughout, and `formatCents` is imported rather than written again.

import { MIGRATION_PRESETS } from "./migrationPresets.js";
import { NPSP_CONTACT_COLUMNS, NPSP_OPPORTUNITY_COLUMNS } from "./npspPreset.js";
import { formatCents } from "./importSentence.js";

// ── PART 1 · THE TILES ─────────────────────────────────────────────────────
//
// `kind` is what picking the tile DOES, and it is the only thing the UI
// branches on:
//   preset      one file, pre-mapped from shared/migrationPresets.js
//   npsp        two files (Contacts and Donations) in one import
//   spreadsheet the generic mapper, with no vendor claim of any kind
//
// `presetKey` points at the preset table. A tile never carries column
// spellings of its own.

export const MOVE_TILES = [
  { key: "donorperfect",    kind: "preset", presetKey: "donorperfect" },
  { key: "salesforce",      kind: "npsp",   label: "Salesforce",
    sub: "NPSP, or a consultant's setup like Equi-Force" },
  { key: "bloomerang",      kind: "preset", presetKey: "bloomerang" },
  { key: "neon",            kind: "preset", presetKey: "neon" },
  { key: "littlegreenlight", kind: "preset", presetKey: "littlegreenlight" },
  { key: "ekyros",          kind: "spreadsheet", label: "eKYROS",
    sub: "your donors are most likely in a spreadsheet" },
  { key: "zeffy",           kind: "preset", presetKey: "zeffy" },
  { key: "givebutter",      kind: "preset", presetKey: "givebutter" },
  { key: "kindful",         kind: "preset", presetKey: "kindful" },
  { key: "networkforgood",  kind: "preset", presetKey: "networkforgood" },
  { key: "spreadsheet",     kind: "spreadsheet", label: "A spreadsheet",
    sub: "Excel, Numbers, Google Sheets, or a CSV from anywhere" },
];

export const MOVE_TILE_KEYS = MOVE_TILES.map(t => t.key);

export function moveTile(key) {
  return MOVE_TILES.find(t => t.key === key) || null;
}

// The label a tile shows. A preset tile borrows the preset's own label so the
// two can never disagree about how a vendor spells its name.
export function moveTileLabel(key) {
  const t = moveTile(key);
  if (!t) return "";
  if (t.label) return t.label;
  const p = t.presetKey ? MIGRATION_PRESETS[t.presetKey] : null;
  return p ? p.label : t.key;
}

// Is this a real preset, or the generic path wearing a vendor's name? The
// import screen and the report both need to answer this honestly.
export function moveTileIsPreset(key) {
  const t = moveTile(key);
  return !!(t && (t.kind === "preset" || t.kind === "npsp"));
}

// ── PART 2 · HOW TO GET YOUR FILE OUT ──────────────────────────────────────

// The columns to keep in the export, derived from the preset's column table:
// the FIRST documented spelling of each field the mapper can use, in a fixed
// reading order rather than object order, so the page reads like a person
// wrote it. Derived, never typed again — see the header.
const COLUMN_ORDER = [
  "externalId", "donorId", "firstName", "lastName", "donorName", "donorEmail",
  "date", "amount", "fund", "campaign", "paymentMethod", "type", "stage",
];

// A column a person can find in a report builder. Salesforce's rollup and
// custom fields (npo02__TotalOppAmount__c) are real columns Steward reads
// when they are there, but telling a director to tick "Npo02__totaloppamount__c"
// is telling her to read a database schema. Steward totals the gifts itself,
// so the printable list stays to the columns with human names.
const isApiName = (h) => String(h || "").includes("__");

function deriveIncludeColumns(columns = {}) {
  const seen = new Set();
  const out = [];
  const push = (field) => {
    const cands = columns[field];
    if (!Array.isArray(cands) || !cands.length) return;
    const first = cands.find(c => !isApiName(c));
    if (!first) return;
    const k = String(first).toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(titleCaseHeader(first));
  };
  for (const f of COLUMN_ORDER) push(f);
  for (const f of Object.keys(columns)) if (!COLUMN_ORDER.includes(f)) push(f);
  return out;
}

// The acronyms a vendor writes in capitals. "gl code" is GL Code on
// DonorPerfect's own report builder, and a page that quotes a menu has to
// quote it the way the menu reads.
const ACRONYMS = new Set(["gl", "lgl", "id", "npsp", "ein", "zip", "usa", "cc", "ach"]);

// "gift date" → "Gift Date". The vendor's own menus title-case their columns,
// and the page quotes the vendor, so it does too.
function titleCaseHeader(h) {
  return String(h || "")
    .split(/\s+/)
    .filter(Boolean)
    .map(w => {
      const lower = w.toLowerCase();
      if (ACRONYMS.has(lower)) return w.toUpperCase();
      if (w.length <= 3 && w === w.toUpperCase()) return w;
      return w[0].toUpperCase() + w.slice(1);
    })
    .join(" ");
}

// What eKYROS's page says instead of a checklist. It is not a preset and the
// copy never implies one: it says where the donor list really is.
const EKYROS_PAGE = {
  steps: [
    "eKYROS holds your clients, appointments and services. It is not where your donors live, and Steward does not read it.",
    "Your donor list is almost certainly a spreadsheet, your bank's deposit report, or QuickBooks. Find the file you use at year end for your accountant.",
    "Save it as CSV or Excel and import it here. The mapper will ask you which column is the name, the date and the amount, and nothing else.",
    "If your gifts are only on paper or in a chequebook, start with the last two years. You can add more later, and a second file never duplicates a gift.",
  ],
  loses: [
    "Nothing from eKYROS: client records are not donor records and are deliberately left where they are",
  ],
  note: "Steward has no eKYROS integration and does not claim one. This is the spreadsheet path with eKYROS's name on the door, because that is the honest description of it.",
};

const SPREADSHEET_PAGE = {
  steps: [
    "Open your spreadsheet and put the donors on one sheet, and the gifts on another if you keep them apart. One sheet with a row per gift also works.",
    "Make sure the first row is column headings, not a title. Delete any subtotal rows at the bottom; Steward totals the file itself.",
    "Save as CSV or Excel and import it here. Every column is either mapped, set aside with a reason, or shown to you as unrecognised. Nothing is dropped quietly.",
    "Compare the total on the Move Report against the total your spreadsheet shows for the same dates.",
  ],
  loses: [
    "Formulas, which arrive as the number they worked out",
    "Cell colours and notes, which are not data Steward can act on",
  ],
  note: null,
};

// Salesforce is the two-file case, and its page has to say so before the
// person runs one report and thinks they are finished.
const NPSP_PAGE = {
  steps: [
    "In Salesforce, open Reports and run the Contacts report: all contacts, no date filter. Export it as CSV (\"Details Only\").",
    "Then run the Opportunities report: all opportunities, no date filter, with the Contact or Account column included. Export that as CSV too.",
    "Import BOTH files here in one go. Steward reads the Contacts file as your people and the Opportunities file as their gifts, and links them for you.",
    "Only Closed Won opportunities count as money received. Pledges and open opportunities are read as commitments and proposals, not as gifts.",
    "If a consultant set your org up (Equi-Force and others rename things), the column names may differ. The mapper shows you every column and what it did with it before anything is written.",
  ],
  loses: [
    "Campaign hierarchies (Steward keeps the campaign itself)",
    "Reports, dashboards and validation rules, which are Salesforce configuration rather than your data",
    "Attachments and Chatter",
  ],
  note: null,
};

// moveHowTo(key) -> the whole page, or null for an unknown tile.
//   label          the vendor, spelled the way the preset spells it
//   kind           preset | npsp | spreadsheet
//   claimsPreset   whether Steward really has a table for this vendor
//   steps          which report to run, in what order, in the vendor's words
//   includeColumns which columns to keep in the export
//   loses          what will not come across, said BEFORE the file arrives
//   note           the honest caveat, where there is one
export function moveHowTo(key) {
  const tile = moveTile(key);
  if (!tile) return null;
  const label = moveTileLabel(key);

  if (tile.kind === "npsp") {
    // Two files, so two column lists. A flat list would have her tick
    // Close Date on the Contacts report and wonder why it is not there.
    const groups = [
      { file: "Contacts report", columns: deriveIncludeColumns(NPSP_CONTACT_COLUMNS) },
      { file: "Opportunities report", columns: deriveIncludeColumns(NPSP_OPPORTUNITY_COLUMNS) },
    ];
    return {
      key, label, sub: tile.sub || null, kind: tile.kind, claimsPreset: true,
      files: 2,
      steps: NPSP_PAGE.steps,
      columnGroups: groups,
      includeColumns: groups.flatMap(g => g.columns).filter((c, i, a) => a.indexOf(c) === i),
      loses: NPSP_PAGE.loses,
      note: NPSP_PAGE.note,
      confidence: "documented-not-walked",
    };
  }

  if (tile.kind === "spreadsheet") {
    const page = key === "ekyros" ? EKYROS_PAGE : SPREADSHEET_PAGE;
    return {
      key, label, sub: tile.sub || null, kind: tile.kind, claimsPreset: false,
      files: 1,
      steps: page.steps,
      // The generic path maps by asking, so there is no documented column list
      // to print. Printing one would be inventing a vendor's export.
      includeColumns: [],
      loses: page.loses,
      note: page.note,
      confidence: "no-preset",
    };
  }

  const p = MIGRATION_PRESETS[tile.presetKey];
  if (!p) return null;
  return {
    key, label, sub: tile.sub || null, kind: "preset", claimsPreset: true,
    files: 1,
    steps: p.checklist || [],
    includeColumns: deriveIncludeColumns(p.columns),
    loses: p.loses || [],
    note: null,
    confidence: p.confidence || "documented-not-walked",
  };
}

// ── PART 3 · THE MOVE REPORT ───────────────────────────────────────────────
//
// THE FILE SIDE, computed from the rows the mapper parsed, at commit time,
// and stored on the `imports` row. It is never recomputed later (the BUILD-87
// rule): the file is gone, and a figure that can be recomputed from the
// database is not evidence about the file.
//
// Rows arrive already through the mapper's money and date grammar:
//   { donorKey, donorName, amountCents, year, recurring, householdKey }
// donorKey is whatever identity the mapper resolved (an id, an email, a
// name) — this module does not resolve identity, it counts what it was given.

export function buildMoveFileFacts(rows = []) {
  const donors = new Map();        // donorKey → { name, cents, gifts }
  const households = new Set();
  const recurring = new Set();
  const byYear = new Map();        // year → cents
  let gifts = 0, cents = 0, undated = 0;

  for (const r of rows) {
    const c = Math.trunc(Number(r && r.amountCents) || 0);
    const key = String((r && r.donorKey) || "").trim().toLowerCase();
    gifts++;
    cents += c;
    if (key) {
      if (!donors.has(key)) donors.set(key, { name: (r.donorName || "").trim(), cents: 0, gifts: 0 });
      const d = donors.get(key);
      d.cents += c; d.gifts++;
      if (!d.name && r.donorName) d.name = String(r.donorName).trim();
    }
    const hh = String((r && r.householdKey) || "").trim().toLowerCase();
    if (hh) households.add(hh);
    if (r && r.recurring && key) recurring.add(key);
    const y = Number(r && r.year);
    if (Number.isFinite(y) && y > 1900 && y < 3000) byYear.set(y, (byYear.get(y) || 0) + c);
    else undated++;
  }

  return {
    people: donors.size,
    households: households.size,
    gifts,
    cents,
    undatedGifts: undated,
    recurringPeople: recurring.size,
    byYear: [...byYear.entries()].sort((a, b) => b[0] - a[0]).map(([year, c]) => ({ year, cents: c })),
    topDonors: [...donors.entries()]
      .map(([key, d]) => ({ key, name: d.name, cents: d.cents, gifts: d.gifts }))
      .sort((a, b) => b.cents - a.cents || String(a.name).localeCompare(String(b.name)))
      .slice(0, 25),
  };
}

const n = (v) => Math.trunc(Number(v) || 0);

// One row of the report: what the file said, what Steward holds, and the
// difference. `opens` is the figureSources key the UI hangs the rows off, so
// every number on this page opens (the CLAUDE.md rule).
function line(label, sentence, fileVal, heldVal, { money = false, opens = null } = {}) {
  const f = n(fileVal), h = n(heldVal);
  return {
    label, sentence, money, opens,
    file: f, held: h, difference: h - f, matches: f === h,
  };
}

// buildMoveReport({ file, held, typed }) — the page.
//   file   what buildMoveFileFacts stored at commit time
//   held   the same shape, read from the database for this move
//   typed  optional: the totals the org typed in from their old system,
//          { gifts, cents }. A person's own number is never silently
//          overridden and never folded into the headline; it gets its own row.
export function buildMoveReport({ file = {}, held = {}, typed = null, vendor = "" } = {}) {
  const lines = [
    line("People", "Every person the file named, counted once each.",
      file.people, held.people, { opens: "move_people" }),
    line("Households", "Distinct households the file identified. A household is one address, not one person.",
      file.households, held.households, { opens: "move_households" }),
    line("Gifts", "One per gift row in the file. A row set aside is not a gift and is listed by line.",
      file.gifts, held.gifts, { opens: "move_gifts" }),
    line("Total", "The sum of every gift in the file, to the cent.",
      file.cents, held.cents, { money: true, opens: "move_total" }),
    line("Recurring donors", "People the file marked as giving on a schedule. Steward records this as history; it does not start charging anyone.",
      file.recurringPeople, held.recurringPeople, { opens: "move_recurring" }),
  ];

  // Dollars by year, every year either side knows about.
  const years = [...new Set([
    ...(file.byYear || []).map(y => n(y.year)),
    ...(held.byYear || []).map(y => n(y.year)),
  ])].sort((a, b) => b - a);
  const fileYear = new Map((file.byYear || []).map(y => [n(y.year), n(y.cents)]));
  const heldYear = new Map((held.byYear || []).map(y => [n(y.year), n(y.cents)]));
  const byYear = years.map(y => line(
    String(y), `Every gift in the file dated ${y}, to the cent.`,
    fileYear.get(y) || 0, heldYear.get(y) || 0, { money: true, opens: `move_year_${y}` }));

  // Top 25 by what this move brought. Lifetime giving across a move is the
  // sum of the files in it, which is exactly what both sides are counting, so
  // the two columns are comparable. Matched by the identity the mapper
  // resolved, so a fold shows up as one row with both files' money on it.
  const heldTop = new Map((held.topDonors || []).map(d => [String(d.key || "").toLowerCase(), n(d.cents)]));
  const topDonors = (file.topDonors || []).slice(0, 25).map(d => {
    const k = String(d.key || "").toLowerCase();
    const h = heldTop.has(k) ? heldTop.get(k) : 0;
    return { name: d.name, key: d.key, file: n(d.cents), held: h, difference: h - n(d.cents), matches: h === n(d.cents) };
  });

  const differences = [
    ...lines.filter(l => !l.matches),
    ...byYear.filter(l => !l.matches),
  ];
  const mismatchedDonors = topDonors.filter(d => !d.matches);

  // THE HEADLINE. It is the proof, so it is allowed to claim a match only
  // when the gifts AND the cents both agree. Anything else says what differs,
  // in the same breath, rather than leading with a number that is wrong.
  const giftsMatch = n(file.gifts) === n(held.gifts);
  const centsMatch = n(file.cents) === n(held.cents);
  const clean = giftsMatch && centsMatch && !differences.length && !mismatchedDonors.length;
  const count = `${n(held.gifts).toLocaleString("en-US")} gift${n(held.gifts) === 1 ? "" : "s"}, ${formatCents(n(held.cents))}`;
  const headline = clean
    ? `${count}. Matches your file to the cent.`
    : `${count}. ${differenceSentence(file, held)}`;

  // The org's own typed figures are a THIRD column, never merged into the
  // headline: a number a person typed from memory is not evidence about the
  // file, and a mismatch there is a conversation, not a defect.
  let typedRows = null;
  if (typed && (typed.gifts != null || typed.cents != null)) {
    typedRows = [];
    if (typed.gifts != null) typedRows.push({
      label: "Gifts, from your old system", typedValue: n(typed.gifts), held: n(held.gifts),
      difference: n(held.gifts) - n(typed.gifts), matches: n(held.gifts) === n(typed.gifts), money: false,
    });
    if (typed.cents != null) typedRows.push({
      label: "Total, from your old system", typedValue: n(typed.cents), held: n(held.cents),
      difference: n(held.cents) - n(typed.cents), matches: n(held.cents) === n(typed.cents), money: true,
    });
  }

  return {
    vendor: vendor || "",
    headline, clean,
    lines, byYear, topDonors,
    differences, mismatchedDonors,
    typed: typedRows,
    undatedGifts: n(file.undatedGifts),
  };
}

function differenceSentence(file, held) {
  const dg = n(held.gifts) - n(file.gifts);
  const dc = n(held.cents) - n(file.cents);
  const bits = [];
  if (dg) bits.push(`${Math.abs(dg).toLocaleString("en-US")} ${dg < 0 ? "fewer" : "more"} gift${Math.abs(dg) === 1 ? "" : "s"} than your file`);
  if (dc) bits.push(`${formatCents(Math.abs(dc))} ${dc < 0 ? "less" : "more"} than your file`);
  if (!bits.length) return "The rows that differ are listed below.";
  return `That is ${bits.join(" and ")}. Every row that differs is listed below.`;
}

// A run id, minted by the importer BEFORE the write so the rows it creates
// can carry it. Shape-checked by both server routes; `crypto.randomUUID` where
// it exists, and a plain fallback where it does not (an older Safari, or a
// non-secure origin, where randomUUID is simply absent).
export function newRunId() {
  const raw = (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID().replace(/-/g, "")
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return "imp_" + raw.slice(0, 24);
}

// ── PART 4 · SINCE LAST TIME ───────────────────────────────────────────────
//
// A re-import's own small report. It reads the same stored facts, so it
// cannot disagree with the full report about what a run brought.

export function buildSinceLastTime({ giftsCreated = 0, centsCreated = 0, peopleCreated = 0,
                                     giftsAlreadyHeld = 0, peopleMatched = 0 } = {}) {
  const g = n(giftsCreated), c = n(centsCreated), p = n(peopleCreated);
  const dupes = n(giftsAlreadyHeld), matched = n(peopleMatched);
  if (!g && !p) {
    return {
      sentence: dupes
        ? `Since last time: nothing new. All ${dupes.toLocaleString("en-US")} gift${dupes === 1 ? "" : "s"} in this file were already on file.`
        : "Since last time: nothing new in this file.",
      giftsCreated: 0, centsCreated: 0, peopleCreated: 0, giftsAlreadyHeld: dupes, peopleMatched: matched,
    };
  }
  const bits = [];
  if (g) bits.push(`${g.toLocaleString("en-US")} new gift${g === 1 ? "" : "s"}, ${formatCents(c)}`);
  if (p) bits.push(`${p.toLocaleString("en-US")} new ${p === 1 ? "person" : "people"}`);
  const tail = dupes
    ? ` ${dupes.toLocaleString("en-US")} gift${dupes === 1 ? "" : "s"} ${dupes === 1 ? "was" : "were"} already on file and ${dupes === 1 ? "was" : "were"} not imported again.`
    : "";
  return {
    sentence: `Since last time: ${bits.join(", ")}.${tail}`,
    giftsCreated: g, centsCreated: c, peopleCreated: p, giftsAlreadyHeld: dupes, peopleMatched: matched,
  };
}

// ── PART 6 · THE MOVE ITSELF ───────────────────────────────────────────────
//
// The Settings card's sentence, and the state behind it. `now` is passed in
// rather than read, because this module is clock-free and a date that decides
// whether a button still undoes must be the org's civil date, not the
// browser's guess (the BUILD-84 rule).

export const MOVE_UNDO_DAYS = 30;

export function moveCardSentence({ source = "", startedAt = null, imports = 0, completedAt = null } = {}, fmtDate) {
  const label = moveTileLabel(source) || source;
  const when = startedAt && fmtDate ? fmtDate(startedAt) : null;
  const runs = n(imports);
  const bits = [];
  bits.push(completedAt ? `Moved from ${label}` : `Moving from ${label}`);
  if (when) bits.push(`started ${when}`);
  if (runs) bits.push(`${runs} import${runs === 1 ? "" : "s"}`);
  return bits.join(" · ");
}

// Does the "We've moved" button still undo? 30 days from the day it was
// pressed, compared on whole milliseconds against the caller's `now`.
export function moveUndoOpen(undoUntil, now) {
  if (!undoUntil) return false;
  const u = Date.parse(undoUntil);
  const t = now == null ? NaN : (now instanceof Date ? now.getTime() : Date.parse(now));
  if (!Number.isFinite(u) || !Number.isFinite(t)) return false;
  return t < u;
}
