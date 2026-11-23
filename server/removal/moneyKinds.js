// server/removal/moneyKinds.js · TRASH-1 item 3. THE DELETES THAT SKIPPED THE ONE REMOVE.
//
// About a dozen delete routes that carry money or people hard-deleted their
// row and said nothing about what hung off it: a grant took its deadlines,
// documents and notes with it (ON DELETE CASCADE) and left its gift and pledge
// live on the funder; a ledger row, an ask, a program, a volunteer's hours went
// for good. Each is now a kind in removal.js's registry, so its confirm is
// built from what is attached and the row moves to the trash (deleted_records),
// where Undo puts back exactly what was there.
//
// Kinds here use the same shape as removal.js's own (noun, table, attached,
// decide, words), plus three optional hooks removal.js reads:
//   title(row)        a title in words when "Delete the <name> <noun>?" reads wrong
//   choice(att)       two ways forward, e.g. keep a grant's gift on the funder
//   ownerOrAdmin      the person who entered it, or an admin (gifts, pledges, grants)
"use strict";
const { formatCentsPlain: usd } = require("../../money");

const n = (x, one, many) => `${x} ${x === 1 ? one : (many || one + "s")}`;
const q1 = async (q, sql, args) => (await q(sql, args))[0] || null;
const count = async (q, sql, args) => Number((await q1(q, sql, args))?.n || 0);
const cents = x => Math.round(Number(x || 0) * 100);
const list = parts => parts.length > 1 ? parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1] : (parts[0] || "");

// The tables that hang off a grant by grant_id with ON DELETE CASCADE. They go
// into the grant's trash row and come back with it (routes/removal.js WITH).
const GRANT_CHILDREN = ["program_grants", "grant_interactions", "grant_milestones", "grant_documents", "grant_spend", "grant_reports", "grant_sends"];

const KINDS = {
  grant: {
    noun: "grant", table: "grants", ownerOrAdmin: true,
    label: r => r.funder || r.program || "this",
    attached: async (q, orgId, r) => {
      // The grant's money on the funder's record: its award pledge, and the
      // gifts that paid it (GIFTS-1: a payment is a gift on the award pledge).
      const pledge = r.award_pledge_id
        ? await q1(q, `SELECT id, amount FROM pledges WHERE id=? AND org_id=?`, [r.award_pledge_id, orgId]) : null;
      const gifts = pledge
        ? await q(`SELECT id, amount FROM gifts WHERE org_id=? AND pledge_id=? AND amount > 0 ORDER BY date, id`, [orgId, pledge.id]) : [];
      const kids = {};
      for (const t of GRANT_CHILDREN) {
        kids[t] = await count(q, `SELECT COUNT(*)::int n FROM ${t} WHERE org_id=? AND grant_id=?`, [orgId, r.id]).catch(() => 0);
      }
      return {
        pledgeId: pledge ? pledge.id : null, pledgeCents: pledge ? cents(pledge.amount) : 0,
        giftIds: gifts.map(g => g.id), giftCents: gifts.reduce((a, g) => a + cents(g.amount), 0),
        deadlines: kids.grant_milestones, documents: kids.grant_documents, notes: kids.grant_interactions,
        reports: kids.grant_reports, programs: kids.program_grants, spend: kids.grant_spend,
      };
    },
    decide: () => "delete",
    choice: a => (a.giftIds.length || a.pledgeId) ? { keep: "Keep them on the funder", remove: "Remove them too" } : null,
    words: (r, a) => {
      const money = [
        a.giftIds.length ? `${a.giftIds.length === 1 ? `a ${usd(a.giftCents)} gift` : `${a.giftIds.length} gifts (${usd(a.giftCents)})`}` : "",
        a.pledgeId ? `a ${usd(a.pledgeCents)} pledge` : "",
      ].filter(Boolean);
      const kids = [
        a.deadlines ? n(a.deadlines, "deadline") : "", a.documents ? n(a.documents, "document") : "",
        a.notes ? n(a.notes, "note") : "", a.reports ? n(a.reports, "report") : "",
        a.spend ? n(a.spend, "spending line") : "", a.programs ? n(a.programs, "program link") : "",
      ].filter(Boolean);
      return [
        money.length ? `This grant has ${list(money)} on the funder's record. Keep them on the funder, or remove them too?` : "",
        `It moves to the trash${kids.length ? ` with its ${list(kids)}` : ""}, and Undo brings it all back.`,
        money.length ? "Removing the money too deletes the gift and the pledge for good, each the way a single gift delete does; Undo brings back the grant, not them." : "",
      ].filter(Boolean).join(" ");
    },
  },
  transaction: {
    noun: "transaction", table: "fin_transactions", admin: true,
    label: r => r.description || "this",
    title: r => `Delete the ${usd(cents(r.amount))} ${r.type === "expense" ? "expense" : "income"} transaction${r.description ? ` "${String(r.description).slice(0, 60)}"` : ""}?`,
    attached: async () => ({}),
    // A gift's own ledger line follows the gift (BUILD-33: one stamp per gift);
    // taking it alone would leave a gift the books no longer carry.
    decide: (a, r) => r.gift_id ? "refuse" : "delete",
    refuse: () => "This line is a gift's own ledger line. Delete or edit the gift, and its line follows; the books and the gift never disagree.",
    words: r => `${r.type === "expense" ? "It comes off" : "Its money comes out of"} ${r.fund_id ? "its fund's balance" : "the books"}. It moves to the trash, and Undo brings it back to the cent.`,
  },
  opportunity: {
    noun: "ask", table: "opportunities",
    label: r => r.name || "this",
    attached: async (q, orgId, r) => ({
      gift: !!r.gift_id, pledge: !!r.pledge_id,
      proposals: await count(q, `SELECT COUNT(*)::int n FROM proposals WHERE org_id=? AND opportunity_id=?`, [orgId, r.id]).catch(() => 0),
    }),
    decide: () => "delete",
    words: (r, a) => [
      a.gift ? "The gift it closed on stays on the donor's record." : "",
      a.pledge ? "The pledge it closed on stays on the donor's record." : "",
      a.proposals ? `${n(a.proposals, "proposal stays", "proposals stay")} on file.` : "",
      "It comes off the pipeline and moves to the trash; Undo brings it back.",
    ].filter(Boolean).join(" "),
  },
  program: {
    noun: "program", table: "programs", admin: true,
    attached: async (q, orgId, r) => ({
      grants: await count(q, `SELECT COUNT(*)::int n FROM program_grants WHERE org_id=? AND program_id=?`, [orgId, r.id]),
    }),
    decide: () => "delete",
    words: (r, a) => a.grants
      ? `${n(a.grants, "grant is", "grants are")} linked to it; the grants and their money stay, and the links come back with Undo. It moves to the trash.`
      : "No grant is linked to it. It moves to the trash; Undo brings it back.",
  },
  journey: {
    noun: "journey", table: "cultivation_templates", archives: "archived_at", admin: true,
    where: "archived_at IS NULL",
    attached: async (q, orgId, r) => ({
      inIt: await count(q, `SELECT COUNT(*)::int n FROM cultivation_plans WHERE org_id=? AND template_id=? AND status='active'`, [orgId, r.id]),
    }),
    decide: () => "archive",
    words: (r, a) => `${a.inIt ? `The ${n(a.inIt, "person", "people")} already in it keep the steps they entered with. ` : ""}It is archived and turned off, not deleted: nobody new enters it, and bringing it back leaves it off.`,
  },
  volunteer_hours: {
    noun: "hours entry", table: "volunteer_shifts", people: false,
    load: (q, orgId, id) => q1(q, `SELECT s.*, d.name AS person_name FROM volunteer_shifts s LEFT JOIN donors d ON d.id=s.person_id AND d.org_id=s.org_id
                                    WHERE s.id=? AND s.org_id=?`, [id, orgId]),
    label: r => `${Number(r.hours)} hours on ${r.date}`,
    title: r => `Delete ${Number(r.hours)} ${Number(r.hours) === 1 ? "hour" : "hours"} on ${r.date}${r.person_name ? ` for ${r.person_name}` : ""}?`,
    attached: async () => ({}),
    decide: () => "delete",
    words: r => `They come off ${r.person_name || "the volunteer"}'s record and every hours total. They move to the trash; Undo brings them back. Nobody is emailed.`,
  },
};

module.exports = { KINDS, GRANT_CHILDREN };
