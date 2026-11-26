// tests/lib/numbers9/givesThrough.js · NUMBERS-9 item 5 (W-1125-Finance-37, repeat). A BUSINESS AND ITS LINKED GIVER AGREE.
//
// Corran Boatyard (an organization) gives $25,000 in two gifts. Its owner, Tamsin Velloway, is linked to it as
// Owner ("gives through it", HOUSEHOLD-1) and holds no soft credit on either gift. Her Gives through reads the
// boatyard at $25,000, the boatyard's Given through it names her at $25,000, the figure opens rows that foot to
// $25,000, and her own lifetime stays $0 (soft credit is recognition, never her money). A program officer of the
// same boatyard (Ilse Partridge, no credit) has no Gives through figure, and the rail says why (creditsNothing).
//
// RED ON MAIN: Gives through read gift_soft_credits only, so Tamsin's givesThrough was [] and the boatyard's
// throughPeople was []; Ilse's link carried no creditsNothing.
"use strict";

async function check({ tok, run, api, q, ok, person, give }) {
  const yard = await person(`Corran Boatyard ${run}`);
  await q(`UPDATE donors SET kind = 'organization', person_types = '["organization"]'::jsonb WHERE id = $1`, [yard]);
  const tamsin = await person(`Tamsin Velloway ${run}`);
  const ilse = await person(`Ilse Partridge ${run}`);
  const link = await api("POST", `/donors/${tamsin}/relationships`, tok, { relatedDonorId: yard, relationshipType: "owner" });
  ok("§5 fixture: Tamsin is linked to the boatyard as Owner", link.status < 300, { status: link.status, body: link.body });
  const lk = await q(`SELECT donor_id_a, donor_id_b FROM donor_relationships WHERE relationship_type = 'owner' AND $1 IN (donor_id_a, donor_id_b)`, [tamsin]);
  ok("§5 fixture: the person is first on the Owner link", lk.length === 1 && lk[0].donor_id_a === tamsin, lk);
  const officer = await api("POST", `/donors/${ilse}/relationships`, tok, { relatedDonorId: yard, relationshipType: "works_at" });
  ok("§5 fixture: Ilse works at the boatyard", officer.status < 300, { status: officer.status });
  await give(yard, { amount: 15000, date: "2026-03-02" });
  await give(yard, { amount: 10000, date: "2026-06-15" });

  const mine = (await api("GET", `/donors/${tamsin}/relationships`, tok)).body || {};
  const theirs = (await api("GET", `/donors/${yard}/relationships`, tok)).body || {};
  const a = (mine.givesThrough || []).find(x => x.id === yard);
  const b = (theirs.throughPeople || []).find(x => x.id === tamsin);
  ok("§5 Tamsin's Gives through reads the boatyard at $25,000", !!a && a.cents === 2500000, { givesThrough: mine.givesThrough });
  ok("§5 it says it is soft credit through the Owner link", !!a && a.how === "gives_through_link" && /Owner/.test(a.howWords || ""), a);
  ok("§5 the boatyard's Given through it names Tamsin at the same $25,000", !!b && b.cents === 2500000, { throughPeople: theirs.throughPeople });
  const open = (await api("GET", `/figures/gives-through/rows?donor=${encodeURIComponent(tamsin)}&through=${encodeURIComponent(yard)}`, tok)).body || {};
  const rowsCents = (open.rows || []).reduce((n, r) => n + Math.round(Number(r.amount) * 100), 0);
  ok("§5 the figure opens two rows that foot to $25,000", Math.round(Number(open.value) * 100) === 2500000 && rowsCents === 2500000 && (open.rows || []).length === 2,
    { value: open.value, rows: (open.rows || []).length, rowsCents });
  const [t] = await q(`SELECT total_giving FROM donors WHERE id = $1`, [tamsin]);
  ok("§5 Tamsin's own lifetime stays $0 (soft credit is never her money)", Number(t.total_giving || 0) === 0, t);

  const ilseRel = (await api("GET", `/donors/${ilse}/relationships`, tok)).body || {};
  ok("§5 Ilse (works at, no credit) has no Gives through figure", !(ilseRel.givesThrough || []).length, ilseRel.givesThrough);
  ok("§5 her link to the boatyard says nothing is credited to her", (ilseRel.relationships || []).some(r => r.relatedDonorId === yard && r.creditsNothing === true), ilseRel.relationships);
  return { tamsin, yard };
}

module.exports = { check };
