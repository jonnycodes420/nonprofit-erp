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
