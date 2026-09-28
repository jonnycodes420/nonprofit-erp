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
  const capacity = raw?.capacity === undefined || raw?.capacity === null || raw?.capacity === "" ? null : Number(raw.capacity);
  if (capacity !== null && (!Number.isInteger(capacity) || capacity <= 0)) errors.push("capacity is a whole number of places");
  const recognition = String(raw?.recognition || "").trim().slice(0, 200) || null;
  return errors.length ? { ok: false, errors }
    : { ok: true, level: { kind, name, priceCents: price, fmvCents: fmv, capacity, recognition } };
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
export function seatingChart(guests = [], { perTable = 10 } = {}) {
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
  const tables = [...byTable.keys()].sort(natural).map(label => {
    const seats = byTable.get(label).sort((x, y) => String(x.name).localeCompare(String(y.name)));
    return { label, seats, count: seats.length, over: perTable ? Math.max(0, seats.length - perTable) : 0 };
  });
  return {
    tables, unseated, perTable,
    seated: tables.reduce((s, t) => s + t.count, 0),
    sentence: tables.length
      ? `${tables.reduce((s, t) => s + t.count, 0)} seated across ${tables.length} ${tables.length === 1 ? "table" : "tables"}`
        + (unseated.length ? `, ${unseated.length} still without a seat.` : ".")
      : "Nobody has been given a seat yet.",
    over: tables.filter(t => t.over > 0).map(t => ({ label: t.label, over: t.over })),
  };
}

// A name tag is a name and, when there is one, the table to find. Nothing
// else: a badge that prints somebody's giving level is a badge that tells the
// room what they gave.
export function nameTags(guests = []) {
  return seatingChart(guests).tables.flatMap(t => t.seats.map(g => ({ name: g.name, table: t.label })))
    .concat(seatingChart(guests).unseated.map(g => ({ name: g.name, table: null })));
}
