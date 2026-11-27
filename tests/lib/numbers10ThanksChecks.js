// tests/lib/numbers10ThanksChecks.js · NUMBERS-10 items 2 and 4. THE TRUTH CHECK'S PAIRS FOR THEM.
//
//   · one thank-you backlog (W-1125-Finance-T7): Home's "Gifts not yet thanked", the thank-you card's
//     backlog and Reports' Acknowledgment backlog (opened on its default range) are one count and one
//     total over one window, and that window is the same day on all three; the report's "Older than the
//     window" figure is the waiting gifts dated before it, and window + older = every waiting gift.
//   · a draft and a header say what the rows say (W-1127-Finance-01): an open thank-you draft for
//     several gifts names each gift's amount and never their sum as one; the Gift History header's
//     count (rows flagged in the count) is the profile's glance count, its total is the money rows
//     listed, and every listed row is either counted or carries the reason it is not.
"use strict";

async function numbers10ThanksChecks({ orgId, get, q, agree, skip }) {
  if (skip && skip.has("numbers10thanks")) return;
  const money = c => `$${(Number(c) / 100).toFixed(2)}`;
  const cents = v => Math.round(Number(v || 0) * 100);
  const TB = require("../../shared/numbers/thankBacklog");

  // ── item 2 ──
  const dash = await get("/dashboards/people").catch(() => null);
  const m = ((dash && dash.metrics) || []).find(x => x.key === "giftsNotYetThanked");
  const rep = await get("/saved-reports/std:ack-backlog/run").catch(() => null);
  const ty = await get("/thank-yous").catch(() => null);
  if (m && rep && rep.figures && ty && ty.backlog) {
    const since = m.source && m.source.params && m.source.params.since;
    agree("numbers10 thank-you backlog: the window's first day", [["Home", since], ["the Acknowledgment backlog", rep.paging && rep.paging.from],
      ["the thank-you card", ty.backlog.since]], String);
    agree("numbers10 thank-you backlog: gifts waiting", [["Home", Number(m.value)], ["the Acknowledgment backlog", Number(rep.figures.count.value)],
      ["the thank-you card", ty.backlog.n]], String);
    agree("numbers10 thank-you backlog: their total", [["the thank-you card", ty.backlog.cents], ["the Acknowledgment backlog", cents(rep.figures.total.value)]], money);
    const P = s => s.replace(/\?/g, ((i) => () => "$" + (++i))(0));
    const [all] = await q(P(`SELECT COUNT(*)::int AS n FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
                               WHERE g.org_id = ? AND ${TB.WAITING("g", "d")}`), [orgId, TB.EVER]);
    const [old] = await q(P(`SELECT COUNT(*)::int AS n FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
                               WHERE g.org_id = ? AND ${TB.WAITING("g", "d")} AND g.date < ?`), [orgId, TB.EVER, since]);
    const older = rep.figures.older;
    agree("numbers10 thank-you backlog: older than the window", [["the rows (any date, before the window)", old.n],
      ["the report's Older than the window", older ? Number(older.value) : "missing"]], String);
    agree("numbers10 thank-you backlog: the window and older foot to every waiting gift", [["every waiting gift", all.n],
      ["window + older", Number(rep.figures.count.value) + (older ? Number(older.value) : 0)]], String);
  }

  // ── item 4: drafts ──
  const drafts = await q(`SELECT t.id, t.body, t.gift_id, t.also_gift_ids FROM thank_you_drafts t
                           WHERE t.org_id = $1 AND t.sent_at IS NULL AND t.skipped_at IS NULL AND cardinality(t.also_gift_ids) > 0 LIMIT 25`, [orgId]).catch(() => []);
  const words = c => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
  for (const d of drafts) {
    const gs = await q(`SELECT ROUND(amount * 100)::bigint AS c FROM gifts WHERE org_id = $1 AND id = ANY($2::text[])`, [orgId, [d.gift_id, ...d.also_gift_ids]]);
    const each = gs.map(g => Number(g.c)), sum = each.reduce((n, c) => n + c, 0);
    // A gift whose donor covered the card fee is grossed up after its draft is written, so the draft may
    // name it before the fee; the defect here is the day's gifts said as ONE gift of their sum.
    const named = /\bgifts of\b/.test(String(d.body || ""));
    const merged = !each.includes(sum) && String(d.body || "").includes(`gift of ${words(sum)}`);
    agree(`numbers10 draft ${d.id}: names each of its ${each.length} gifts`, [["its gifts", "each named"], ["the draft", named && !merged ? "each named" : `${merged ? "one gift of " + words(sum) : "not named as gifts"} (${each.map(words).join(" + ")}: "${String(d.body || "").replace(/\s+/g, " ").slice(0, 220)}")`]], String);
  }

  // ── item 4: the Gift History header ──
  const people = await q(`SELECT DISTINCT g.donor_id FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
                           WHERE g.org_id = $1 AND d.deleted_at IS NULL ORDER BY g.donor_id LIMIT 12`, [orgId]).catch(() => []);
  for (const { donor_id } of people) {
    const p = await get(`/donors/${encodeURIComponent(donor_id)}`).catch(() => null);
    if (!p || !Array.isArray(p.gifts)) continue;
    const counted = p.gifts.filter(g => g.in_count === true).length;
    const unexplained = p.gifts.filter(g => g.in_count !== true && !g.not_counted).length;
    agree(`numbers10 Gift History header ${donor_id}: its count`, [["the profile's glance", p.gift_count], ["the header (rows listed, counted)", counted]], String);
    agree(`numbers10 Gift History header ${donor_id}: every listed row counted or named`, [["rows listed", p.gifts.length], ["counted + named", p.gifts.length - unexplained]], String);
    const head = p.gift_history_head;
    agree(`numbers10 Gift History header ${donor_id}: its total`, [["the rows listed (money)", p.gifts.filter(g => g.in_total === true).reduce((n, g) => n + cents(g.amount), 0)],
      ["the header", head ? head.totalCents : "missing"]], money);
  }
}

module.exports = { numbers10ThanksChecks };
