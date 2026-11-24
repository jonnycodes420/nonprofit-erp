// server/events/freeTickets.js · EVENTS-4 item 1. A FREE TICKET NEEDS NO STRIPE.
//
// "No ticket-type creation UI is reachable on staging: tickets are entirely
// gated behind Stripe" and "$0 tickets cannot be created" (fleet, 22-23 Nov).
// Ticket types sat behind the payments gate as a whole: a $0 price was refused
// (shared/eventShape.js and a CHECK), and the public page, with its register
// form, was "Not open yet" for any org without Stripe. So an org with no
// payments (every staging org, and plenty of small real ones) could not make
// or offer any ticket at all.
//
// The rule now:
//   - a ticket may be $0. Registering for it writes the guest (registered) and
//     NO gift, no pledge and no receipt (registerForEvent, the one writer);
//   - the public page is open when payments are connected, OR when the event
//     has a current free ticket. A paid ticket on a page without payments says
//     "Tickets go on sale once payments are connected" on that ticket only;
//   - a free ticket is registered at once from the page, capacity checked by
//     the same writer. A paid ticket still goes through Checkout, or, with no
//     payments, is not offered at all.
// Nothing is emailed for a free registration: the ticket email is the paid
// confirmation, and a new trigger for donor mail is Jonathan's decision.
"use strict";

const NOT_ON_SALE = {
  ticket: "Tickets go on sale once payments are connected.",
  sponsor: "Sponsorships open once payments are connected.",
};

// Can this org take a card, and does this event have a current free ticket?
async function pageState(query, orgId, eventId) {
  const [o] = await query("SELECT stripe_connected, stripe_account_id FROM orgs WHERE id=?", [orgId]);
  const canTakeACard = !!(o && o.stripe_connected && o.stripe_account_id);
  const [f] = await query(
    `SELECT COUNT(*)::int AS n FROM event_levels
      WHERE org_id=? AND event_id=? AND kind='ticket' AND price = 0 AND retired_at IS NULL`, [orgId, eventId]);
  const hasFree = !!(f && f.n > 0);
  return { canTakeACard, hasFree, open: canTakeACard || hasFree };
}

const isFree = l => !!l && l.kind === "ticket" && Math.round(Number(l.price) * 100) === 0;

// A free registration from the public page: the person (matched by email
// first), then the one registration writer with no money. Returns
// { attendee } or throws { status, message } (capacity, as the writer says it).
async function registerFree(ctx, { e, level, name, email, qty, guests, dietary }) {
  const { query, run, registerForEvent } = ctx;
  const PM = require("../../personMatch");
  const { newId } = require("../shared/newId");
  const who = { id: "system:event-registration", name: "The registration page" };
  let donorId = await PM.findPersonId(e.org_id, { email, name });   // WIRE-1 rule 1
  if (!donorId) {
    donorId = newId("d");
    await run(`INSERT INTO donors (id,org_id,name,email,stage,status,tags,created_by,created_by_name)
               VALUES (?,?,?,?,'prospect','active','[]',?,?)`, [donorId, e.org_id, name, email, who.id, who.name]);
  }
  const r = await registerForEvent({ orgId: e.org_id, event: e, level, donorId, qty, paid: false,
    who, guests, dietary: dietary || null, notify: false });
  await query("UPDATE event_attendees SET source = COALESCE(source, 'public') WHERE id=? AND org_id=?", [r.attendee.id, e.org_id]).catch(() => {});
  return r;
}

module.exports = { NOT_ON_SALE, pageState, isFree, registerFree };
