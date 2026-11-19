// NUMBERS-7 · ONE ANSWER TO "IS THIS PERSON LAPSED?", OVER GENERATED HISTORIES.
//
// The one test this build earns (it guards donor data: who is told they are
// lapsing, and who Communications' "Lapsing or lapsed" segment mails). The
// nightly check read Justin's Place's two people one way and the tags another,
// three nights running, after the recompute: two code paths answered the same
// question differently for some shape of history.
//
// Made-up people, from a fixed seed, in two orgs whose "today" is minutes
// from midnight (Los Angeles at 23:50, when UTC is already tomorrow; Auckland
// at 00:10, when UTC is still yesterday): gift dates a day either side of the
// 9- and 12-month edges, a refund in full as the latest gift, a negative
// refund row, a $0 row, soft and matching credit rows (some typed with
// capitals and spaces), a gift dated after today, undated gifts, open,
// overdue, finished and cancelled pledges, a usual time to give a day ahead or
// a day behind, and spouses, partners, owners and colleagues (some deleted)
// whose gifts and pledges hold the person (POLISH-4, PEOPLE-1).
//
// For every person, four answers must be one:
//   the key        lapseRule.lapseState over the made-up history itself (this file)
//   the tag        donorStatus.statusSql, with the org's today from DS.todayFor
//   the segment    donorStatus.quietIds (Communications' Lapsing or lapsed)
//   the check      scripts/ci/check-numbers.js checkOrg: no `lapse` or `quiet` problem
// A shape that disagreed once is kept below as a fixed case (FIXED), so it is
// run on every run whatever the seed draws.
//
// WHAT WOULD MAKE THIS FAIL (each planted and seen red, NUMBERS-7 report):
//   · the check judging a person by their own gifts and pledges only, not their
//     giving unit's (main: the check's `lapse` and `quiet`, FIXED u1..u3);
//   · the check counting a gift refunded in full as their last gift (main: FIXED r1);
//   · a linked person's gift dated after today holding their partner (main: the
//     tag and the segment, FIXED f1);
//   · DS.todayFor answering the UTC day instead of the org's;
//   · the pledge hold missing from one path (lapse.js lapsedSql without holdSql);
//   · a once-a-year giver tagged Lapsing before their usual month (lapsingSql
//     without rhythmAheadSql).
//
//   DATABASE_URL=postgresql://steward@localhost:5544/steward_x node tests/numbers7-lapse.test.js
"use strict";
const { ok, summary, q, closeDb } = require("./helpers");
const lapseRule = require("../lapseRule");
const orgTime = require("../orgTime");
const { isCredit } = require("../creditTypes");

const SEED = Number(process.env.NUMBERS7_SEED || 70707);
const PER_ORG = Number(process.env.NUMBERS7_PER_ORG || 2600);
// Two orgs, each a few minutes from midnight in its own zone.
const ORGS = [
  { id: "org_n7west", name: "Lapse Rule West (made-up)", tz: "America/Los_Angeles", at: new Date("2026-03-01T07:50:00Z") },
  { id: "org_n7east", name: "Lapse Rule East (made-up)", tz: "Pacific/Auckland", at: new Date("2026-08-30T12:10:00Z") },
];
const UNIT = new Set(require("../shared/numbers/lapse").UNIT_LINK_TYPES);

// mulberry32: a fixed seed gives the same people on every run.
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ── the made-up history ─────────────────────────────────────────────────
// A person: { gifts: [{ date, amount, type, refunded }], pledges: [...], expectedNext, links: [{ to, type }], deleted }
function generate(r, today, n, prefix) {
  const pick = a => a[Math.floor(r() * a.length)];
  const b = lapseRule.bounds(today);
  const edges = [today, b.lapsingOnOrBefore, b.lapsedOnOrBefore, b.lapsingFrom, b.lostBefore, orgTime.addDays(today, -120), orgTime.addDays(today, -500)];
  const near = () => orgTime.addDays(pick(edges), Math.floor(r() * 5) - 2);
  const people = [];
  for (let i = 0; i < n; i++) {
    const p = { id: `${prefix}${String(i).padStart(5, "0")}`, gifts: [], pledges: [], links: [], expectedNext: null, deleted: r() < 0.03 };
    const ng = Math.floor(r() * 4);
    for (let k = 0; k < ng; k++) {
      const roll = r();
      const g = { date: near(), amount: pick([25, 100, 250, 1500]), type: null, refunded: false };
      if (roll < 0.08) g.amount = 0;                                          // a $0 row
      else if (roll < 0.16) g.type = pick(["soft credit", "Soft Credit ", "matching gift credit", "soft_credit"]);
      else if (roll < 0.22) g.refunded = true;                                // refunded in full
      else if (roll < 0.26) g.amount = -pick([25, 100]);                      // a refund row
      else if (roll < 0.29) g.date = orgTime.addDays(today, 1 + Math.floor(r() * 40));   // dated after today
      else if (roll < 0.31) g.date = null;                                    // undated
      else if (roll < 0.35) g.type = pick(["One-time", "recurring", "In-kind"]);
      p.gifts.push(g);
    }
    // A refund in full as the latest row: a later gift, then refunded.
    if (p.gifts.length && r() < 0.08) p.gifts.push({ date: orgTime.addDays(today, -Math.floor(r() * 60)), amount: 100, type: null, refunded: true });
    if (r() < 0.22) {
      const np = 1 + Math.floor(r() * 2);
      for (let k = 0; k < np; k++) {
        const made = near();
        const pl = { status: pick(["open", "open", "fulfilled", "fulfilled", "cancelled"]), made, due: r() < 0.5 ? orgTime.addDays(made, pick([30, 200, 400])) : null, inst: [] };
        const ni = r() < 0.5 ? Math.floor(r() * 3) : 0;
        for (let j = 0; j < ni; j++) {
          const due = orgTime.addDays(made, 30 * (j + 1) * pick([1, 3, 6]));
          // A paid installment is paid by a gift on its day (a real gift row of theirs).
          const paid = due <= today && r() < 0.5;
          if (paid) p.gifts.push({ date: due, amount: 250, type: null, refunded: false });
          pl.inst.push({ due, paid: paid ? p.gifts.length - 1 : null });
        }
        p.pledges.push(pl);
      }
    }
    // Their usual time to give: a day ahead, today, a day behind, or further out.
    if (r() < 0.4) p.expectedNext = orgTime.addDays(today, pick([-40, -1, 0, 1, 2, 30, 200]));
    people.push(p);
  }
  // The giving unit: spouses, partners, owners, colleagues, and a link that is not one.
  for (const p of people) if (r() < 0.14) {
    const o = pick(people);
    if (o !== p) p.links.push({ to: o.id, type: pick(["spouse", "partner", "owner", "works_at", "friend", "sibling"]) });
  }
  return people;
}

// FIXED: shapes that disagreed once (found by this file on main), always run.
// u*: the giving unit; f1: a linked gift dated after today; r1: a refund in full as the latest gift.
function fixed(today, prefix) {
  const b = lapseRule.bounds(today);
  const ago = n => orgTime.addDays(today, -n);
  const P = (s, o) => ({ id: `${prefix}${s}`, gifts: [], pledges: [], links: [], expectedNext: null, deleted: false, ...o });
  return [
    // u1: lapsed alone, but their spouse gave last month: one giving unit, so not lapsed.
    P("u1a", { gifts: [{ date: ago(420), amount: 100, type: null, refunded: false }], links: [{ to: `${prefix}u1b`, type: "spouse" }] }),
    P("u1b", { gifts: [{ date: ago(30), amount: 100, type: null, refunded: false }] }),
    // u2: lapsing alone (10 months), their business gave last week.
    P("u2a", { gifts: [{ date: orgTime.addDays(b.lapsingOnOrBefore, -20), amount: 100, type: null, refunded: false }] }),
    P("u2b", { gifts: [{ date: ago(7), amount: 500, type: null, refunded: false }], links: [{ to: `${prefix}u2a`, type: "owner" }] }),
    // u3: lapsed, their partner (who never gave) has an open pledge.
    P("u3a", { gifts: [{ date: ago(500), amount: 100, type: null, refunded: false }], links: [{ to: `${prefix}u3b`, type: "partner" }] }),
    P("u3b", { pledges: [{ status: "open", made: ago(100), due: orgTime.addDays(today, 200), inst: [] }] }),
    // f1: lapsed, and their spouse's only gift is dated next month (not scheduled): still lapsed.
    P("f1a", { gifts: [{ date: ago(430), amount: 100, type: null, refunded: false }], links: [{ to: `${prefix}f1b`, type: "spouse" }] }),
    P("f1b", { gifts: [{ date: ago(600), amount: 100, type: null, refunded: false }, { date: orgTime.addDays(today, 25), amount: 100, type: null, refunded: false }] }),
    // r1: gave 14 months ago, and last month, refunded in full: lapsed.
    P("r1", { gifts: [{ date: ago(425), amount: 100, type: null, refunded: false }, { date: ago(30), amount: 100, type: null, refunded: true }] }),
  ];
}

// ── the key: the rule over the history itself ───────────────────────────
// Their last gift: real money above zero, not refunded in full, not a credit
// row, dated on or before today (money.js GIFT, the tags' KEPT).
const ownLast = (p, today) => p.gifts.filter(g => g.date && g.date <= today && g.amount > 0 && !g.refunded && !isCredit(g.type)).map(g => g.date).sort().pop() || null;
function keyOf(people, today) {
  const byId = new Map(people.map(p => [p.id, p]));
  const unitOf = p => {
    const out = [];
    for (const l of p.links) if (UNIT.has(l.type)) out.push(byId.get(l.to));
    for (const o of people) for (const l of o.links) if (l.to === p.id && UNIT.has(l.type)) out.push(o);
    return out.filter(Boolean);
  };
  const pledgeRows = (p, own) => p.pledges.filter(pl => pl.status === "open" || pl.status === "fulfilled").map(pl => {
    const firstInst = pl.inst.map(i => i.due).sort()[0];
    const madeOn = [pl.made, pl.due, firstInst].filter(Boolean).sort()[0];
    const overdue = own && pl.status === "open" && (pl.inst.length ? pl.inst.some(i => i.paid == null && i.due < today) : !!(pl.due && pl.due < today));
    return { status: pl.status, madeOn, overdue };
  });
  const key = new Map();
  for (const p of people) {
    if (p.deleted) continue;
    const own = ownLast(p, today);
    if (!own) { key.set(p.id, null); continue; }
    const unit = unitOf(p);
    // The unit's last gift: a live linked person's last gift, on or before today like their own.
    const linked = unit.filter(o => !o.deleted).map(o => ownLast(o, today)).filter(Boolean).sort().pop() || null;
    const last = [own, linked].filter(Boolean).sort().pop();
    const pledges = [...pledgeRows(p, true), ...unit.flatMap(o => pledgeRows(o, false))];
    key.set(p.id, lapseRule.lapseState(last, today, p.expectedNext ? { expectedNext: p.expectedNext } : null, pledges));
  }
  return key;
}

// ── the rows ─────────────────────────────────────────────────────────────
async function clear(org) {
  const tables = (await q(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (let pass = 0; pass < 6; pass++) {
    for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [org]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [org]).then(() => true).catch(() => false)) break;
  }
}
async function write(org, people) {
  await clear(org.id);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,$2,$3,1,'active','team',$4)`,
    [org.id, org.name, org.id.replace(/_/g, "-"), org.tz]);
  const ids = people.map(p => p.id);
  await q(`INSERT INTO donors (id,org_id,name,kind,stage,created_by,created_by_name,deleted_at)
           SELECT x.id, $1, 'Made-up ' || x.id, 'individual', 'cultivate', 'system:test', 'test', CASE WHEN x.del THEN now() END
             FROM unnest($2::text[], $3::bool[]) AS x(id, del)`, [org.id, ids, people.map(p => p.deleted)]);
  const G = { id: [], donor: [], date: [], amount: [], type: [], ref: [] };
  for (const p of people) p.gifts.forEach((g, i) => {
    G.id.push(`g_${p.id}_${i}`); G.donor.push(p.id); G.date.push(g.date); G.amount.push(g.amount); G.type.push(g.type); G.ref.push(!!g.refunded);
  });
  await q(`INSERT INTO gifts (id,org_id,donor_id,date,amount,type,refunded_in_full,created_by,created_by_name)
           SELECT x.id, $1, x.donor, x.date, x.amount, x.type, x.ref, 'system:test', 'test'
             FROM unnest($2::text[], $3::text[], $4::text[], $5::numeric[], $6::text[], $7::bool[]) AS x(id, donor, date, amount, type, ref)`,
    [org.id, G.id, G.donor, G.date, G.amount, G.type, G.ref]);
  for (const p of people) for (const [i, pl] of p.pledges.entries()) {
    const pid = `pl_${p.id}_${i}`;
    // Recorded at noon UTC on the day it was made: the made day is the same read either way.
    await q(`INSERT INTO pledges (id,org_id,donor_id,amount,due_date,status,created_at,created_by,created_by_name) VALUES ($1,$2,$3,1000,$4,$5,$6::date + interval '12 hours','system:test','test')`,
      [pid, org.id, p.id, pl.due, pl.status, pl.made]);
    for (const [j, it] of pl.inst.entries())
      await q(`INSERT INTO pledge_installments (id,org_id,pledge_id,seq,due_date,amount,paid_gift_id) VALUES ($1,$2,$3,$4,$5,250,$6)`,
        [`${pid}_${j}`, org.id, pid, j + 1, it.due, it.paid != null ? `g_${p.id}_${it.paid}` : null]);
  }
  const R = people.filter(p => p.expectedNext);
  await q(`INSERT INTO donor_rhythm (org_id,donor_id,rhythm,expected_next,created_by,created_by_name)
           SELECT $1, x.id, 'yearly', x.d, 'system:test', 'test' FROM unnest($2::text[], $3::text[]) AS x(id, d)`, [org.id, R.map(p => p.id), R.map(p => p.expectedNext)]);
  let n = 0;
  for (const p of people) for (const l of p.links)
    await q(`INSERT INTO donor_relationships (id,org_id,donor_id_a,donor_id_b,relationship_type,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,'system:test','test')`,
      [`rel_${org.id}_${n++}`, org.id, p.id, l.to, l.type]);
  // The totals kept on a person, by the one writer (NUMBERS-6), as the app leaves them.
  const { recomputeOrgStoredTotals } = require("../shared/numbers/donorTotals");
  const { query } = require("../db");
  await recomputeOrgStoredTotals(query, org.id);
}

(async () => {
  const DS = require("../donorStatus");
  const { checkOrg } = require("../scripts/ci/check-numbers");
  const { query } = require("../db");
  const r = rng(SEED);
  let total = 0;
  for (const org of ORGS) {
    const today = orgTime.orgToday({ timezone: org.tz }, org.at);
    const utcDay = org.at.toISOString().slice(0, 10);
    ok(`${org.tz}: the pinned instant is a different day in UTC (${utcDay}) than in the org (${today})`, utcDay !== today);
    const people = [...generate(r, today, PER_ORG, `d_${org.id.slice(4)}_`), ...fixed(today, `d_${org.id.slice(4)}_fx_`)];
    await write(org, people);
    total += people.length;
    const key = keyOf(people, today);

    // The tag and the segment, with today as the app's doors resolve it.
    const tday = await DS.todayFor(org.id, org.at);
    const st = DS.statusSql(org.id, tday, await DS.cutsFor(org.id));
    const tag = new Map((await query(st.sql, st.args)).map(row => [row.donor_id, row]));
    const quiet = await DS.quietIds(org.id, tday);
    const bad = { tag: [], segment: [] };
    for (const [id, want] of key) {
      const t = tag.get(id);
      const shown = !t ? null : t.lifecycle === "lapsed" ? "lapsed" : t.lapsing ? "lapsing" : "not";
      const wantShown = want === null ? null : want === "lapsed" ? "lapsed" : want === "lapsing" ? "lapsing" : "not";
      if (shown !== wantShown) bad.tag.push({ id, want, shown });
      if (quiet.has(id) !== (want === "lapsed" || want === "lapsing")) bad.segment.push({ id, want, inSegment: quiet.has(id) });
    }
    const show = list => list.slice(0, 5).map(x => JSON.stringify(x)).join("; ");
    ok(`${org.tz}, today ${today}: the tag (statusSql) gives the rule's answer for all ${key.size} people`, !bad.tag.length, `${bad.tag.length} disagree: ${show(bad.tag)}`);
    ok(`${org.tz}: the Lapsing or lapsed segment (quietIds) is exactly the rule's lapsing and lapsed`, !bad.segment.length, `${bad.segment.length} disagree: ${show(bad.segment)}`);

    // The nightly check, on the same instant.
    const res = await checkOrg(org.id, { at: org.at });
    const by = Object.fromEntries(res.problems.map(p => [p.rule, p]));
    for (const rule of ["lapse", "quiet"])
      ok(`${org.tz}: the nightly check finds no "${rule}" problem`, !by[rule], by[rule] && `${by[rule].count}: ${show(by[rule].examples || [])}`);
    // The fixed shapes, named, so a regression says which.
    for (const p of people.filter(x => x.id.includes("_fx_") && key.get(x.id) !== null)) {
      const flagged = ["lapse", "quiet"].filter(rule => (by[rule] && by[rule].examples || []).some(e => e.donor === p.id));
      ok(`${org.tz} fixed ${p.id.split("_fx_")[1]}: the rule says ${key.get(p.id)}, and the tag, the segment and the check agree`,
        !flagged.length && !bad.tag.some(x => x.id === p.id) && !bad.segment.some(x => x.id === p.id), flagged.join(","));
    }
  }
  ok(`at least 5,000 generated histories (seed ${SEED})`, total >= 5000, total);
  if (!process.env.NUMBERS7_KEEP) for (const org of ORGS) await clear(org.id);
  await closeDb();
  summary();
})().catch(async e => { console.error(e); ok("ran to the end", false, e.message); summary(); });
