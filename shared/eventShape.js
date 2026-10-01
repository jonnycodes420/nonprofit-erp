// shared/eventShape.js — BUILD-98 (switch) Part 4. THE DONOR SIDE OF A GALA.
//
// Not a ticketing system. Enough that an organisation running a gala or a
// barn open house does not need Eventbrite for the part that is about DONORS:
// ticket and sponsorship levels, a guest list, tables, who came, and a receipt
// that tells the truth about what was deductible.
//
// ── THE RULE THIS MODULE EXISTS TO HOLD ────────────────────────────────────
//     A TICKET IS A GIFT THAT BOUGHT SOMETHING, AND THE RECEIPT SAYS SO.
// A $150 ticket to a dinner worth $60 is a $150 gift of which $90 is
// deductible (IRS Publication 1771, the quid pro quo rule). The FULL amount is
// the gift — it is what the donor paid and what the org received, so totals,
// Drift and the ledger see $150 — and the receipt states the $60 and the $90.
// Everything is integer cents; the split is never re-derived from a float.
//
// A level's fair-market value can never exceed its price: that would be a
// negative deductible, which is a data-entry error, not a tax position.
//
// Pure: no DB, no network, no clock, no JSX.

export const LEVEL_KINDS = ["ticket", "sponsor"];
export const ATTENDANCE = ["registered", "attended", "no_show", "cancelled"];
export const MAX_QTY = 50;

const toCents = v => Math.round(Number(v) * 100);

export function validateLevel(raw) {
  const errors = [];
  const kind = LEVEL_KINDS.includes(raw?.kind) ? raw.kind : "ticket";
  const name = String(raw?.name || "").trim().slice(0, 120);
  if (!name) errors.push("a level needs a name");
  const price = toCents(raw?.price);
  if (!Number.isFinite(price) || price <= 0) errors.push("a price greater than zero");
  const fmv = raw?.fmv === undefined || raw?.fmv === null || raw?.fmv === "" ? 0 : toCents(raw.fmv);
  if (!Number.isFinite(fmv) || fmv < 0) errors.push("a fair-market value of zero or more");
  if (Number.isFinite(price) && Number.isFinite(fmv) && fmv > price)
    errors.push("the fair-market value cannot be more than the price — the deductible part would be negative");
  // EVENTS-2 — the member price. Null means the level has one price. It is
  // never above the full price and never below the fair-market value: a
  // ticket whose deductible part is negative is not a discount, it is a
  // mistake, and the same CHECK stands behind this in the database.
  const memberPrice = raw?.memberPrice === undefined || raw?.memberPrice === null || raw?.memberPrice === ""
    ? null : toCents(raw.memberPrice);
  if (memberPrice !== null) {
    if (!Number.isFinite(memberPrice) || memberPrice <= 0) errors.push("a member price greater than zero, or none at all");
    else {
      if (Number.isFinite(price) && memberPrice > price) errors.push("a member price cannot be more than the price");
      if (Number.isFinite(fmv) && memberPrice < fmv) errors.push("a member price below the fair-market value would make the deductible part negative");
    }
  }
  const capacity = raw?.capacity === undefined || raw?.capacity === null || raw?.capacity === "" ? null : Number(raw.capacity);
  if (capacity !== null && (!Number.isInteger(capacity) || capacity <= 0)) errors.push("capacity is a whole number of places");
  const recognition = String(raw?.recognition || "").trim().slice(0, 200) || null;
  return errors.length ? { ok: false, errors }
    : { ok: true, level: { kind, name, priceCents: price, fmvCents: fmv, memberPriceCents: memberPrice, capacity, recognition } };
}

// The split for a purchase of `qty` at this level, in cents.
export function ticketSplit({ priceCents, fmvCents = 0, qty = 1 }) {
  const q = Math.max(1, Math.min(MAX_QTY, Math.floor(Number(qty) || 1)));
  const total = priceCents * q;
  const received = fmvCents * q;
  return { qty: q, totalCents: total, fmvCents: received, deductibleCents: total - received };
}

// What the receipt says the donor received, in the donor's own terms.
export function quidProQuoDescription({ eventName, levelName, qty = 1, kind = "ticket" }) {
  const what = kind === "sponsor" ? `${levelName} sponsorship benefits` : `${qty === 1 ? "one" : qty} ${levelName} ${qty === 1 ? "ticket" : "tickets"}`;
  return `${what} to ${eventName}`;
}

// The line that thanks a sponsor in the programme and on the website. The org
// may write its own per level; otherwise the donor's name and the level.
export function recognitionLine({ donorName, levelName, recognition }) {
  if (recognition) return recognition.replace(/\{\{\s*name\s*\}\}/g, donorName || "");
  return `${donorName} — ${levelName}`;
}

// Tables: a short label a person types ("Table 4", "Head table"). Normalised
// so "table 4" and "Table 4" are the same table on the seating list.
export function tableLabel(raw) {
  const t = String(raw || "").trim().replace(/\s+/g, " ").slice(0, 40);
  if (!t) return null;
  if (/^\d+$/.test(t)) return `Table ${t}`;
  return t.replace(/^table\b/i, "Table");
}

// The one sentence a receipt for a ticket must carry (Pub. 1771).
export const QPQ_DISCLOSURE =
  "The amount of your contribution that is deductible for federal income tax purposes is limited to the excess of the amount you paid over the value of the goods and services provided.";

// ── EVENTS-1 · WHAT THE NIGHT DID ─────────────────────────────────────────
// The four questions an ED is asked the morning after, and the sentence that
// defines each one. Built here so the card, the report and the PDF all read
// the same number from the same arithmetic, and so a figure can never appear
// without the sentence that says what it counts.
//
// RAISED IS NEVER TYPED. It is the sum of the gifts attributed to the event,
// which is why `raisedCents` arrives already summed from rows the caller can
// open. `revenue` on the events row is a figure somebody typed and it is not
// used here.
export const EVENT_FIGURES = {
  raised: "Every gift attributed to this event: tickets, sponsorships and anything given on the night. The full amount paid, not the deductible part.",
  goal: "What the event was aiming at. Set when the event was created, and changed by a person.",
  registered: "People on the guest list who have not cancelled. A ticket for two counts as two.",
  attended: "People marked as having come. Nobody is counted as attending until somebody says they did.",
  firstTime: "People whose FIRST gift to you was this event. An event that brings new donors has done something a number on its own cannot show.",
  sponsors: "Sponsorships sold, at any level. A sponsorship that has not been paid yet is a pledge and is counted here as sold.",
};

export function eventProgress({ raisedCents = 0, goalCents = null }) {
  const raised = Math.max(0, Math.round(raisedCents));
  const goal = goalCents == null ? null : Math.max(0, Math.round(goalCents));
  if (!goal) {
    return { raised, goal: null, percent: null, met: false,
             sentence: "No goal was set for this event, so there is nothing to measure against." };
  }
  const percent = Math.round((raised / goal) * 100);
  const over = raised - goal;
  return {
    raised, goal, percent, met: raised >= goal,
    sentence: raised >= goal
      ? `${percent}% of the goal, ${fmtCents(over)} over.`
      : `${percent}% of the goal, ${fmtCents(goal - raised)} to go.`,
  };
}

export function attendanceRate({ registered = 0, attended = 0 }) {
  const r = Math.max(0, Number(registered) || 0);
  const a = Math.max(0, Number(attended) || 0);
  if (!r) return { registered: 0, attended: a, percent: null,
                   sentence: "Nobody is registered, so there is no rate to give." };
  return { registered: r, attended: a, percent: Math.round((a / r) * 100),
           sentence: `${a} of ${r} registered came.` };
}

function fmtCents(c) {
  const n = Math.round(Number(c) || 0) / 100;
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
}

// ── THE SEATING CHART ─────────────────────────────────────────────────────
// Guests grouped by table, with the unseated kept as their own group rather
// than hidden: the people without a seat are the ones the chart exists to
// show. Tables sort naturally, so Table 2 comes before Table 10.
//
// FIX-11 Part 2 — THE TABLES ARE NOW PASSED IN. A table used to exist only
// because somebody was sitting at it, which is why a real gala's chart had no
// tables on it and no way to add one. An empty table is still a table, and a
// table has a NUMBER OF SEATS, which is the fact the whole screen turns on.
// Called without tables it behaves exactly as it did, so every existing caller
// (the print chart, the name tags) is unchanged.
export function seatingChart(guests = [], { perTable = 10, tables: tableRows = null } = {}) {
  const byTable = new Map();
  const unseated = [];
  for (const g of guests) {
    if (g.status === "cancelled") continue;
    const t = tableLabel(g.table_label ?? g.table);
    if (!t) { unseated.push(g); continue; }
    if (!byTable.has(t)) byTable.set(t, []);
    byTable.get(t).push(g);
  }
  const natural = (a, b) => {
    const na = Number(String(a).replace(/\D+/g, "")), nb = Number(String(b).replace(/\D+/g, ""));
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    return String(a).localeCompare(String(b));
  };

  // Every label that exists: the tables the organisation declared, plus any
  // label a guest carries that has no row (legacy data, or a row removed while
  // somebody was still on it). An orphan table is SHOWN rather than dropped,
  // because dropping it would hide a seated guest.
  const declared = Array.isArray(tableRows) ? tableRows : [];
  const declaredByLabel = new Map(declared.map(t => [tableLabel(t.label), t]));
  const labels = [...new Set([...declaredByLabel.keys(), ...byTable.keys()])].filter(Boolean);

  const sortOf = label => {
    const row = declaredByLabel.get(label);
    return row && row.sort != null ? Number(row.sort) : null;
  };
  labels.sort((a, b) => {
    const sa = sortOf(a), sb = sortOf(b);
    if (sa != null && sb != null && sa !== sb) return sa - sb;
    return natural(a, b);
  });

  const tables = labels.map(label => {
    const row = declaredByLabel.get(label) || null;
    const seats = row && row.seats != null ? Number(row.seats) : perTable;
    const list = (byTable.get(label) || []).slice()
      .sort((x, y) => String(x.name).localeCompare(String(y.name)));
    const count = list.length;
    return {
      label, seats, seats_: seats,
      id: row ? row.id : null,
      sponsorName: row ? (row.sponsor_name || null) : null,
      declared: !!row,
      seats_list: list, count,
      open: Math.max(0, seats - count),
      full: count >= seats,
      over: Math.max(0, count - seats),
      // "Table 3 · 6 of 8" — the sentence the card shows, built here so the
      // card, the print-out and anything later say the same words.
      sentence: `${label} · ${count} of ${seats}`,
    };
  });
  // `seats` was the guest ARRAY on this shape before Part 2 and three callers
  // read it that way (the print chart, the name tags, the card). It stays the
  // array; the number of seats is `capacity`.
  for (const t of tables) { t.capacity = t.seats; t.seats = t.seats_list; delete t.seats_; delete t.seats_list; }

  const seated = tables.reduce((s, t) => s + t.count, 0);
  const capacity = tables.reduce((s, t) => s + t.capacity, 0);
  return {
    tables, unseated, perTable, seated, capacity,
    openSeats: Math.max(0, capacity - seated),
    sentence: !tables.length
      ? (unseated.length
          ? `${unseated.length} ${unseated.length === 1 ? "guest" : "guests"} and no tables yet.`
          : "Nobody has been given a seat yet.")
      : `${seated} seated across ${tables.length} ${tables.length === 1 ? "table" : "tables"}`
        + (unseated.length ? `, ${unseated.length} still without a seat.` : "."),
    over: tables.filter(t => t.over > 0).map(t => ({ label: t.label, over: t.over })),
  };
}

// ── A PARTY ───────────────────────────────────────────────────────────────
// Two people on one ticket are a party, and a party sits together: `guest_of`
// names the registration a guest was brought by, so the registrant and their
// guests share one key. A party only fits where there is room for ALL of them,
// which is the rule that stops a couple being split across the room by a
// well-meaning auto-seater.
export function partyKey(g) {
  return String((g && (g.guest_of || g.id)) || "");
}

export function parties(guests = []) {
  const byKey = new Map();
  for (const g of guests) {
    if (g.status === "cancelled") continue;
    const k = partyKey(g);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(g);
  }
  return [...byKey.entries()].map(([key, members]) => ({
    key, members, size: members.length,
    // The party's name is the registrant's, because that is who the office
    // knows it as.
    name: (members.find(m => !m.guest_of) || members[0]).name,
    sponsor: members.some(m => m.sponsor_pledge_id || /sponsor/i.test(String(m.level_kind || ""))),
    sponsorName: (members.find(m => m.recognition) || {}).recognition || null,
  }));
}

// ── CAN THIS PARTY SIT HERE? ──────────────────────────────────────────────
// One answer, used by the route that refuses and by the planner that places,
// so the screen and the server can never disagree about whether a seat exists.
// Returns a reason rather than a boolean, because "Table 3 has 2 seats open and
// this party is 4" is the thing the person needs to read.
export function seatFit({ table, party, movingFrom = null }) {
  const size = Array.isArray(party) ? party.length : Number(party) || 1;
  if (!table) return { ok: false, reason: "That table does not exist." };
  // Somebody already at this table is not taking a NEW seat.
  const already = movingFrom === table.label ? size : 0;
  const open = table.open + already;
  if (size > open) {
    return {
      ok: false,
      reason: open === 0
        ? `${table.label} is full.`
        : `${table.label} has ${open} ${open === 1 ? "seat" : "seats"} open and this party is ${size}.`,
      open,
    };
  }
  return { ok: true, open };
}

// ── SEAT EVERYONE ─────────────────────────────────────────────────────────
// Sponsors first, at their own tables. Then the remaining parties largest
// first, because a party of six placed last has nowhere to go while six
// singles placed last have six choices. Never splits a party. Returns a PLAN
// rather than performing it, so the screen can show what it is about to do and
// the person can say no.
export function seatEveryonePlan(guests = [], tableRows = []) {
  const chart = seatingChart(guests, { tables: tableRows });
  // Work on a copy of the open counts; nothing here mutates the input.
  const room = new Map(chart.tables.map(t => [t.label, { label: t.label, id: t.id, open: t.open, sponsorName: t.sponsorName }]));
  const unseatedIds = new Set(chart.unseated.map(g => g.id));
  const toSeat = parties(chart.unseated.filter(g => unseatedIds.has(g.id)));

  const moves = [];
  const refused = [];
  const place = (party, table) => {
    for (const m of party.members) moves.push({ attendeeId: m.id, name: m.name, table: table.label, tableId: table.id });
    table.open -= party.size;
  };

  const sponsorParties = toSeat.filter(p => p.sponsor);
  const rest = toSeat.filter(p => !p.sponsor).sort((a, b) => b.size - a.size || String(a.name).localeCompare(String(b.name)));

  // A sponsor goes to the table held in their name when there is one, and is
  // otherwise placed like anybody else. A sponsor table nobody claims is left
  // empty rather than filled, which is the whole point of holding it.
  const heldLabels = new Set([...room.values()].filter(t => t.sponsorName).map(t => t.label));
  for (const p of sponsorParties) {
    const held = p.sponsorName
      ? [...room.values()].find(t => t.sponsorName && String(t.sponsorName).toLowerCase() === String(p.sponsorName).toLowerCase())
      : null;
    const target = held && held.open >= p.size ? held : null;
    if (target) { place(p, target); continue; }
    rest.unshift(p);   // largest-first ordering still applies below
  }

  for (const p of rest) {
    const choices = [...room.values()]
      .filter(t => t.open >= p.size && (!heldLabels.has(t.label) || !t.sponsorName))
      // The TIGHTEST table that still fits, so a party of two does not take
      // two seats out of the only table a party of eight could have used.
      .sort((a, b) => a.open - b.open || String(a.label).localeCompare(String(b.label)));
    if (!choices.length) {
      refused.push({ name: p.name, size: p.size,
        reason: p.size > Math.max(0, ...[...room.values()].map(t => t.open))
          ? `No table has ${p.size} seats open together, and a party is never split.`
          : "There are no seats left." });
      continue;
    }
    place(p, choices[0]);
  }

  const seatedNow = moves.length;
  return {
    moves, refused,
    sentence: !toSeat.length
      ? "Everybody already has a seat."
      : refused.length
        ? `${seatedNow} ${seatedNow === 1 ? "guest" : "guests"} would be seated, and ${refused.reduce((s, r) => s + r.size, 0)} would have nowhere to go.`
        : `${seatedNow} ${seatedNow === 1 ? "guest" : "guests"} would be seated.`,
  };
}

// A name tag is a name and, when there is one, the table to find. Nothing
// else: a badge that prints somebody's giving level is a badge that tells the
// room what they gave.
export function nameTags(guests = []) {
  return seatingChart(guests).tables.flatMap(t => t.seats.map(g => ({ name: g.name, table: t.label })))
    .concat(seatingChart(guests).unseated.map(g => ({ name: g.name, table: null })));
}
