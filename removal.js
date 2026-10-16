// FIX-41 · ANYTHING YOU CAN ADD, YOU CAN REMOVE.
//
// THE ONE retire-or-delete function. Every list in Fundraising (and tags,
// groups, funds and campaigns elsewhere) removes a row through here, so every
// screen asks the same question in the same words and follows the same rule:
//
//   · Something with money or people attached (a ticket type with sales, an
//     auction item with bids, a fund with gifts, a level with members, a role
//     with sign-ups) is NEVER hard-deleted. It is RETIRED: hidden from new use,
//     kept on every past record and report.
//   · A live page (giving, volunteer, membership, peer-to-peer) with gifts or
//     sign-ups is ARCHIVED, never deleted. A page with none can be deleted.
//   · Removing a guest who paid makes no refund. Removing an auction winner
//     returns the item to unassigned and never touches a payment.
//   · Nothing a donor already received changes: no receipt, no sent email.
//   · A delete is a MOVE, into deleted_records, the same trash Undo already
//     reads (routes/crm.js trashRow). Undo puts back exactly what was there.
//
// The confirm sentence is built HERE from what is attached, and the screen
// shows it as given: "Remove the VIP ticket type? 3 guests hold it; they keep
// their tickets." A screen never writes its own.
//
// Pure where it can be: plan() reads, decide/sentence are plain functions,
// and apply()/undo() take the transaction client the route opens.

const n = (x, one, many) => `${x} ${x === 1 ? one : (many || one + "s")}`;
const q1 = async (q, sql, args) => (await q(sql, args))[0] || null;
const count = async (q, sql, args) => Number((await q1(q, sql, args))?.n || 0);

// What a removal does, in the words the confirm uses for its button.
const YES = { delete: "Delete", remove: "Remove", retire: "Retire", archive: "Archive", unassign: "Remove winner" };

// ── THE REGISTRY ──────────────────────────────────────────────────────────
// Each kind names its table, how a row is found (always inside the org), what
// is attached to it, and what removing it does. `retire` kinds write
// retired_at/by; `archive` kinds write their own status; the rest move the row
// to the trash. `people: true` means the kind is a person on a list, so the
// verb is Remove; otherwise a thing, Delete.
const KINDS = {
  ticket_type: {
    noun: "ticket type", table: "event_levels", where: "kind = 'ticket'", retires: true,
    attached: async (q, orgId, r) => ({
      holders: await count(q, `SELECT COALESCE(SUM(COALESCE(quantity,1)),0)::int n FROM event_attendees WHERE org_id=? AND level_id=?`, [orgId, r.id]),
    }),
    decide: a => a.holders > 0 ? "retire" : "delete",
    words: (r, a, mode) => mode === "retire"
      ? `${n(a.holders, "guest holds", "guests hold")} it; they keep their tickets. It is retired, not deleted: nobody new can choose it, and every past guest and report keeps it.`
      : `Nobody holds it, so it is deleted.`,
  },
  sponsor_level: {
    noun: "sponsorship level", table: "event_levels", where: "kind = 'sponsor'", retires: true,
    attached: async (q, orgId, r) => ({
      holders: await count(q, `SELECT COUNT(*)::int n FROM event_attendees WHERE org_id=? AND level_id=?`, [orgId, r.id]),
    }),
    decide: a => a.holders > 0 ? "retire" : "delete",
    words: (r, a, mode) => mode === "retire"
      ? `${n(a.holders, "sponsor holds", "sponsors hold")} it; they keep it. It is retired, not deleted: nobody new can choose it, and every past record and report keeps it.`
      : `Nobody holds it, so it is deleted.`,
  },
  guest: {
    noun: "guest", table: "event_attendees", people: true,
    label: r => r.name,
    attached: async (q, orgId, r) => ({
      paid: !!(r.registration_gift_id || Number(r.gift_amount) > 0),
      party: Math.max(1, Number(r.quantity) || 1),
      seated: !!(r.table_id || r.table_label),
    }),
    decide: () => "delete",
    words: (r, a) => [
      a.party > 1 ? `Their ticket covers ${a.party} places, which come free.` : "",
      a.seated ? "They come off their table." : "",
      a.paid ? "No refund is made; refund in Stripe if you need to. Their gift and receipt stay on their record." : "",
    ].filter(Boolean).join(" ") || "They come off the guest list.",
  },
  waitlist: {
    noun: "waiting list entry", table: "event_waitlist", people: true,
    label: r => r.name,
    attached: async () => ({}),
    decide: () => "delete",
    words: () => "They come off the waiting list. Nobody is emailed.",
  },
  table: {
    noun: "table", table: "event_tables",
    label: r => r.label,
    attached: async (q, orgId, r) => ({
      seated: await count(q, `SELECT COUNT(*)::int n FROM event_attendees WHERE org_id=? AND table_id=?`, [orgId, r.id]),
    }),
    decide: () => "delete",
    words: (r, a) => a.seated
      ? `${n(a.seated, "guest goes", "guests go")} back to Not seated. Nobody loses their ticket.`
      : "Nobody is seated at it.",
  },
  auction_item: {
    noun: "auction item", table: "auction_items", retires: true,
    label: r => r.title,
    attached: async (q, orgId, r) => ({
      bids: await count(q, `SELECT COUNT(*)::int n FROM auction_bids WHERE org_id=? AND item_id=?`, [orgId, r.id]),
      paid: !!(r.paid_at || r.paid_gift_id),
      inKind: !!r.in_kind_gift_id,
    }),
    decide: a => (a.bids > 0 || a.paid || a.inKind) ? "retire" : "delete",
    words: (r, a, mode) => mode === "retire"
      ? [a.bids ? `${n(a.bids, "bid has", "bids have")} been made on it.` : "",
         a.paid ? "Its winner has paid; that payment and receipt stay as they are." : "",
         a.inKind ? "Its donor's in-kind gift stays on their record." : "",
         "It is retired, not deleted: it comes off the public auction page, and its bids stay on record."].filter(Boolean).join(" ")
      : "Nobody has bid on it, so it is deleted.",
  },
  auction_winner: {
    noun: "winner", table: "auction_items", unassigns: true,
    label: r => r.title,
    attached: async () => ({}),
    // The winner is read from auctionCore.itemStates by the route (it needs the
    // bid ordering); the route passes it in as r.winner.
    decide: (a, r) => (r.paid_at || r.paid_gift_id) ? "refuse" : "unassign",
    refuse: () => "This item is paid for, so its winner stays. Steward never touches a payment; refund in Stripe if you need to, and the item stays as it was.",
    words: r => `${r.winner ? r.winner + " is" : "The winner is"} taken off ${r.title}, and the item goes back to unassigned. No payment is touched, and their bid stays on record.`,
  },
  giving_page: pageKind("giving page", "give"),
  volunteer_page: pageKind("volunteer page", "volunteer"),
  p2p_page: {
    noun: "peer-to-peer page", table: "peer_fundraisers", archives: "status",
    label: r => r.name,
    attached: async (q, orgId, r) => ({
      gifts: await count(q, `SELECT COUNT(*)::int n FROM gifts WHERE org_id=? AND peer_fundraiser_id=?`, [orgId, r.id]),
    }),
    decide: a => a.gifts > 0 ? "archive" : "delete",
    words: (r, a, mode) => mode === "archive"
      ? `${n(a.gifts, "gift has", "gifts have")} come through it. It is archived, not deleted: the page stops taking gifts, and every gift and receipt stays as it is.`
      : "No gifts have come through it, so it is deleted.",
  },
  p2p_team: {
    noun: "team", table: "p2p_teams", archives: "status",
    label: r => r.name,
    attached: async (q, orgId, r) => ({
      members: await count(q, `SELECT COUNT(*)::int n FROM peer_fundraisers WHERE org_id=? AND team_id=?`, [orgId, r.id]),
    }),
    decide: a => a.members > 0 ? "archive" : "delete",
    words: (r, a, mode) => mode === "archive"
      ? `${n(a.members, "fundraiser is", "fundraisers are")} on it; they keep their pages and their gifts. It is archived, not deleted.`
      : "Nobody is on it, so it is deleted.",
  },
  membership_level: {
    noun: "membership level", table: "membership_levels", retires: true, admin: true,
    attached: async (q, orgId, r) => ({
      members: await count(q, `SELECT COUNT(*)::int n FROM memberships WHERE org_id=? AND level_id=?`, [orgId, r.id]),
    }),
    decide: a => a.members > 0 ? "retire" : "delete",
    words: (r, a, mode) => mode === "retire"
      ? `${n(a.members, "person has", "people have")} held it; they keep it until it ends. It is retired, not deleted: nobody new can join at it, and every past record and report keeps it.`
      : "Nobody has held it, so it is deleted.",
  },
  volunteer_role: {
    noun: "volunteer role", table: "volunteer_opportunities", archives: "archived_at",
    attached: async (q, orgId, r) => ({
      signups: await count(q, `SELECT COUNT(*)::int n FROM volunteer_signups s JOIN volunteer_slots sl ON sl.id=s.slot_id
                                WHERE s.org_id=? AND sl.opportunity_id=?`, [orgId, r.id]),
    }),
    decide: a => a.signups > 0 ? "retire" : "delete",
    words: (r, a, mode) => mode === "retire"
      ? `${n(a.signups, "sign-up is", "sign-ups are")} on it; they keep their hours. It is retired, not deleted: nobody new can sign up for it, and every past shift keeps it.`
      : "Nobody has signed up for it, so it is deleted.",
  },
  shift: {
    noun: "shift", table: "volunteer_slots", retires: true,
    label: r => `${r.date} ${r.start_time}`,
    attached: async (q, orgId, r) => ({
      signups: await count(q, `SELECT COUNT(*)::int n FROM volunteer_signups WHERE org_id=? AND slot_id=?`, [orgId, r.id]),
    }),
    decide: a => a.signups > 0 ? "retire" : "delete",
    words: (r, a, mode) => mode === "retire"
      ? `${n(a.signups, "person is", "people are")} signed up; they keep it on their record and nobody is emailed. It is retired, not deleted: nobody new can sign up.`
      : "Nobody is signed up, so it is deleted.",
  },
  volunteer_signup: {
    noun: "sign-up", table: "volunteer_signups", people: true,
    label: r => r.person_name || "this person",
    load: (q, orgId, id) => q1(q, `SELECT s.*, d.name AS person_name FROM volunteer_signups s LEFT JOIN donors d ON d.id=s.person_id AND d.org_id=s.org_id
                                    WHERE s.id=? AND s.org_id=?`, [id, orgId]),
    attached: async () => ({}),
    decide: () => "delete",
    words: () => "They come off the shift. Hours already logged stay on their record. Nobody is emailed.",
  },
  group: {
    noun: "group", table: "audiences",
    attached: async () => ({}),
    decide: () => "delete",
    words: () => "The people in it are not touched. A draft that named it reaches nobody until you choose another group.",
  },
  fund: {
    noun: "fund", table: "fin_funds", retires: true, admin: true,
    attached: async (q, orgId, r) => ({
      gifts: await count(q, `SELECT COUNT(*)::int n FROM gifts WHERE org_id=? AND fund_id=?`, [orgId, r.id]),
    }),
    decide: a => a.gifts > 0 ? "retire" : "delete",
    words: (r, a, mode) => mode === "retire"
      ? `${n(a.gifts, "gift is", "gifts are")} designated to it; they stay designated. It is retired, not deleted: it is not offered for new gifts, and every past gift and report keeps it.`
      : "No gift is designated to it, so it is deleted.",
  },
  campaign: {
    noun: "campaign", table: "campaigns", retires: true,
    attached: async (q, orgId, r) => ({
      gifts: await count(q, `SELECT COUNT(*)::int n FROM gifts WHERE org_id=? AND campaign_id=?`, [orgId, r.id]),
      sent: r.status === "sent" || !!r.sent_at,
    }),
    decide: a => (a.gifts > 0 || a.sent) ? "retire" : "delete",
    words: (r, a, mode) => mode === "retire"
      ? [a.gifts ? `${n(a.gifts, "gift is", "gifts are")} counted to it; they stay counted.` : "",
         a.sent ? "It was sent; what people received does not change." : "",
         "It is retired, not deleted: it is not offered for new work, and every past record and report keeps it."].filter(Boolean).join(" ")
      : "Nothing is attached to it, so it is deleted.",
  },
  tag: {
    noun: "tag", table: "org_tags", retires: true,
    attached: async (q, orgId, r) => ({
      people: await count(q, `SELECT COUNT(*)::int n FROM donors WHERE org_id=? AND deleted_at IS NULL AND tags::jsonb ? ?`, [orgId, r.name]).catch(() => 0),
    }),
    decide: a => a.people > 0 ? "retire" : "delete",
    words: (r, a, mode) => mode === "retire"
      ? `${n(a.people, "person carries", "people carry")} it; they keep it. It is retired, not deleted: it is not offered for new tagging.`
      : "Nobody carries it, so it is deleted.",
  },
};

function pageKind(noun, kind) {
  return {
    noun, table: "giving_pages", where: `COALESCE(page_kind,'give') = '${kind}'`, archives: "status",
    label: r => r.title,
    attached: async (q, orgId, r) => ({
      gifts: await count(q, `SELECT COUNT(*)::int n FROM gifts WHERE org_id=? AND giving_page_id=?`, [orgId, r.id]),
      fundraisers: await count(q, `SELECT COUNT(*)::int n FROM peer_fundraisers WHERE org_id=? AND giving_page_id=?`, [orgId, r.id]),
      signups: kind === "volunteer"
        ? await count(q, `SELECT COUNT(*)::int n FROM volunteer_page_signups WHERE org_id=? AND page_id=?`, [orgId, r.id])
        : 0,
      live: r.status === "active",
    }),
    decide: a => (a.gifts > 0 || a.fundraisers > 0 || a.signups > 0) ? "archive" : "delete",
    words: (r, a, mode) => mode === "archive"
      ? [a.gifts ? `${n(a.gifts, "gift has", "gifts have")} come through it.` : "",
         a.fundraisers ? `${n(a.fundraisers, "fundraiser has", "fundraisers have")} a page under it.` : "",
         a.signups ? `${n(a.signups, "person has", "people have")} signed up through it.` : "",
         "It is archived, not deleted: the page comes down, and every gift, sign-up and receipt stays as it is. You can unarchive it."].filter(Boolean).join(" ")
      : `Nothing has come through it, so it is deleted${a.live ? " and its link stops working" : ""}.`,
  };
}

const kindOf = k => (Object.prototype.hasOwnProperty.call(KINDS, k) ? KINDS[k] : null);
const nameOf = (K, r) => String((K.label ? K.label(r) : r.name) || "this " + K.noun);

async function loadRow(q, K, orgId, id) {
  if (K.load) return K.load(q, orgId, id);
  return q1(q, `SELECT * FROM ${K.table} WHERE id=? AND org_id=?${K.where ? " AND " + K.where : ""}`, [id, orgId]);
}

// THE SENTENCE. One title, one body, one button, built from what is attached.
function sentence(kind, K, row, att, mode) {
  const name = nameOf(K, row);
  if (mode === "refuse") return { title: `${name} stays as it is`, body: K.refuse(row, att), yes: null };
  const verb = mode === "unassign" ? "Remove the winner of" : (K.people ? "Remove" : mode === "retire" || mode === "archive" ? "Remove" : "Delete");
  const title = mode === "unassign" ? `${verb} ${name}?`
    : K.people ? `${verb} ${name}?` : `${verb} the ${name} ${K.noun}?`;
  return { title, body: K.words(row, att, mode), yes: mode === "delete" && !K.people ? YES.delete : mode === "unassign" ? YES.unassign : mode === "retire" ? YES.retire : mode === "archive" ? YES.archive : YES.remove };
}

async function plan(q, kind, orgId, id, extra = {}) {
  const K = kindOf(kind);
  if (!K) return { error: "unknown_kind" };
  const row = await loadRow(q, K, orgId, id);
  if (!row) return { error: "not_found" };
  Object.assign(row, extra);
  const att = await K.attached(q, orgId, row);
  const mode = K.decide(att, row);
  return { kind, id, mode, attached: att, name: nameOf(K, row), row, ...sentence(kind, K, row, att, mode) };
}

// Several at once: one confirm, built from the sum. "Remove 4 guests? 2 paid:
// no refund is made…"
function bulkSentence(kind, plans) {
  const K = kindOf(kind);
  const ok = plans.filter(p => p.mode !== "refuse");
  const modes = new Set(ok.map(p => p.mode));
  const lines = [];
  const by = m => ok.filter(p => p.mode === m).length;
  if (by("retire")) lines.push(`${n(by("retire"), "has", "have")} people or money attached, so ${by("retire") === 1 ? "it is" : "they are"} retired, not deleted, and kept on every past record.`);
  if (by("archive")) lines.push(`${n(by("archive"), "has", "have")} gifts or sign-ups, so ${by("archive") === 1 ? "it is" : "they are"} archived, not deleted.`);
  if (kind === "guest") {
    const paid = ok.filter(p => p.attached.paid).length;
    if (paid) lines.push(`${n(paid, "of them paid", "of them paid")}. No refund is made; refund in Stripe if you need to.`);
  }
  if (plans.length > ok.length) lines.push(`${plans.length - ok.length} cannot be removed and ${plans.length - ok.length === 1 ? "stays" : "stay"} as ${plans.length - ok.length === 1 ? "it is" : "they are"}.`);
  const many = K.people ? n(ok.length, K.noun) : n(ok.length, K.noun);
  return {
    title: `${K.people || modes.has("retire") || modes.has("archive") ? "Remove" : "Delete"} ${many}?`,
    body: lines.join(" ") || (K.people ? "They come off the list. Nobody is emailed." : "Nothing is attached to them."),
    yes: K.people || modes.has("retire") || modes.has("archive") ? "Remove " + ok.length : "Delete " + ok.length,
  };
}

module.exports = { KINDS, kindOf, plan, bulkSentence, sentence, nameOf, loadRow };
