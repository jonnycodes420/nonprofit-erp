// tests/lib/home7Checks.js · HOME-7. HOME'S FIGURES AGAINST THEIR REPORTS (the truth check's pairs).
//
//   · thank-yous: Home's Thank-yous tab and rail card (GET /home/cards), the thank-you card's backlog
//     (GET /thank-yous) and Reports' Acknowledgment backlog are one count
//   · year-end so far: Home's figure against the Giving figure for the same dates (figureSources
//     `gifts`, the drawer the Giving report opens) and the gifts themselves, summed here by hand
//   · retention: Home's rail card against the Retention figure Reports opens, and its own counts
//   · Major gifts: Home's open asks and "said yes" against the Major Gifts page's own tiles
"use strict";

async function home7Checks({ orgId, get, q, agree, skip }) {
  if (skip && skip.has("home7")) return;
  const cards = await get("/home/cards").catch(() => null);
  if (!cards) return;
  const money = c => `$${(Number(c) / 100).toFixed(2)}`;
  const cents = v => Math.round(Number(v || 0) * 100);
  const ty = await get("/thank-yous").catch(() => null);
  const rep = await get("/saved-reports/std:ack-backlog/run").catch(() => null);
  if (cards.thankYous) agree("home7 thank-yous: gifts waiting", [["Home's Thank-yous tab and rail", cards.thankYous.n],
    ["the thank-you card", ty && ty.backlog ? ty.backlog.n : undefined], ["the Acknowledgment backlog", rep && rep.figures ? Number(rep.figures.count.value) : undefined]], String);
  const ye = cards.yearEnd;
  if (ye) {
    const f = await get(`/figures/gifts/rows?from=${ye.from}&to=${ye.to}&pageSize=1`).catch(() => null);
    // by hand: every gift row dated in the span, hard credit only, from a person not deleted, none scheduled past today
    const [r] = await q(`SELECT COALESCE(SUM(ROUND(g.amount * 100)), 0)::bigint AS c FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
                          WHERE g.org_id = $1 AND d.deleted_at IS NULL AND g.date >= $2 AND g.date <= $3
                            AND LOWER(TRIM(COALESCE(g.type, ''))) <> ALL($4::text[])
                            AND (g.scheduled_on IS NULL OR g.scheduled_on::text <= $3)`, [orgId, ye.from, ye.to, require("../../creditTypes").CREDIT_TYPES]).catch(() => [{ c: null }]);
    agree(`home7 year-end so far (${ye.from} to ${ye.to})`, [["Home's rail", ye.cents], ["the Giving figure for the same dates", f && f.value != null ? cents(f.value) : undefined],
      ["the gifts, summed by hand", r && r.c != null ? Number(r.c) : undefined]], money);
  }
  const rt = cards.retention;
  if (rt && rt.rate != null) {
    const f = await get(`/figures/retention/rows?pageSize=1`).catch(() => null);
    agree("home7 retention", [["Home's rail", rt.rate], ["the Retention figure", f ? f.value : undefined], ["its counts", rt.prior ? Math.round(rt.retained / rt.prior * 100) : undefined]], String);
  }
  if (cards.major) {
    const mg = await get("/major-gifts/dashboard").catch(() => null);
    if (mg && mg.tiles) {
      agree("home7 Major gifts: open asks", [["Home's card", cards.major.open.cents], ["the Major Gifts page", cents(mg.tiles.pipeline.amount)]], money);
      agree("home7 Major gifts: said yes this year", [["Home's card", cards.major.yes.cents], ["the Major Gifts page", cents(mg.tiles.committedThisYear.amount)]], money);
    }
  }
}

module.exports = { home7Checks };
