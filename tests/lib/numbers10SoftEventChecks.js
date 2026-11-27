// tests/lib/numbers10SoftEventChecks.js · NUMBERS-10 items 3 and 5. Two figures checked against keys written
// from the rows with no app code, and against each other.
//
//   Gives through (W-1125-Finance-37, third night). For every person linked to an organization as its Owner or
//   its program officer, and every soft credit on an organization's gift: the person's Gives through, the
//   organization's Given through it row for them and the `gives-through` figure's rows are one number, and it is
//   the key: the soft credit's amount on each gift that carries one for them, else the whole gift when they are
//   linked. Money is the organization's own gift above $0, not a credit row, not scheduled for a later day.
//
//   First-time givers (W-1127-Volunteers-01). For each event: the people whose first gift ever (the earliest
//   gift above $0, not a credit row, not refunded in full; on one day, the one recorded first) belongs to the
//   event (stamped with it, or unstamped with its campaign, or its name when it has no campaign), with no earlier
//   first gift from an old system, each once. The After the event tile, the `event-first-time` figure and its
//   rows must all be that set.
//
// numbers10SoftEventChecks: the truth-check pass (surfacesAgree.js, skip name "numbers10softevent").
// n10SoftEvent: real-shaped's fixture step (REAL_SHAPED_ONLY=N10C), the shapes the fleet saw, built in a fresh org.
"use strict";

const CREDIT = `LOWER(TRIM(COALESCE(%.type, ''))) IN ('soft credit','soft-credit','soft_credit','matching gift credit','matched gift credit','hard credit reversal')`;
const credit = a => CREDIT.replace("%", a);
const ORG = o => `(LOWER(COALESCE(${o}.kind,'')) IN ('organisation','organization') OR COALESCE(${o}.person_types,'[]'::jsonb) @> '["organization"]'::jsonb)`;

// The key: Map "person|org" -> cents.
async function throughKey(q, orgId) {
  const rows = await q(
    `WITH og AS (
       SELECT g.id, g.donor_id AS org, ROUND(g.amount * 100)::bigint AS cents FROM gifts g
         JOIN donors o ON o.id = g.donor_id AND o.org_id = g.org_id AND o.deleted_at IS NULL
        WHERE g.org_id = $1 AND g.amount > 0 AND NOT ${credit("g")} AND (g.scheduled_on IS NULL OR g.scheduled_on <= TO_CHAR(NOW(), 'YYYY-MM-DD'))),
     links AS (
       SELECT DISTINCT donor_id_a AS person, donor_id_b AS org FROM donor_relationships WHERE org_id = $1 AND relationship_type = 'owner'
       UNION SELECT DISTINCT donor_id_b, donor_id_a FROM donor_relationships WHERE org_id = $1 AND relationship_type = 'program_officer'),
     credited AS (
       SELECT sc.donor_id AS person, og.org, og.id, ROUND(sc.amount * 100)::bigint AS cents
         FROM gift_soft_credits sc JOIN og ON og.id = sc.gift_id WHERE sc.org_id = $1 AND sc.donor_id <> og.org
       UNION ALL
       SELECT l.person, og.org, og.id, og.cents FROM links l JOIN og ON og.org = l.org
         JOIN donors o ON o.id = l.org AND o.org_id = $1 AND ${ORG("o")}
        WHERE l.person <> l.org AND NOT EXISTS (SELECT 1 FROM gift_soft_credits x WHERE x.org_id = $1 AND x.gift_id = og.id AND x.donor_id = l.person))
     SELECT c.person, c.org, SUM(c.cents)::bigint AS cents FROM credited c
       JOIN donors p ON p.id = c.person AND p.org_id = $1 AND p.deleted_at IS NULL
      GROUP BY 1, 2 ORDER BY 3 DESC, 1, 2 LIMIT 15`, [orgId]);
  return rows.map(r => ({ person: r.person, org: r.org, cents: Number(r.cents) }));
}

// The key: Map eventId -> sorted [donor ids].
async function firstTimeKey(q, orgId) {
  const rows = await q(
    `WITH firsts AS (
       SELECT DISTINCT ON (g.donor_id) g.donor_id, g.event_id, g.campaign_id, g.campaign, g.date
         FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id AND d.deleted_at IS NULL
        WHERE g.org_id = $1 AND g.amount > 0 AND NOT ${credit("g")} AND g.refunded_in_full IS NOT TRUE
          AND (g.scheduled_on IS NULL OR g.scheduled_on <= TO_CHAR(NOW(), 'YYYY-MM-DD'))
        ORDER BY g.donor_id, g.date ASC NULLS LAST, g.created_at ASC, g.amount DESC, g.import_row ASC NULLS LAST, g.id ASC)
     SELECT e.id AS event_id, f.donor_id
       FROM events e JOIN firsts f
         ON (f.event_id = e.id OR (f.event_id IS NULL AND e.campaign_id IS NOT NULL AND f.campaign_id = e.campaign_id)
             OR (f.event_id IS NULL AND e.campaign_id IS NULL AND f.campaign = e.name))
       JOIN donors d ON d.id = f.donor_id AND d.org_id = $1
      WHERE e.org_id = $1
        AND (COALESCE(NULLIF(d.imported_first_gift_date, ''), NULLIF(d.imported_last_gift_date, '')) IS NULL
             OR LEFT(COALESCE(NULLIF(d.imported_first_gift_date, ''), NULLIF(d.imported_last_gift_date, '')), 10) >= LEFT(f.date::text, 10))`, [orgId]);
  const out = new Map();
  for (const r of rows) { if (!out.has(r.event_id)) out.set(r.event_id, []); out.get(r.event_id).push(r.donor_id); }
  for (const v of out.values()) v.sort();
  return out;
}

async function numbers10SoftEventChecks({ orgId, get, q, agree }) {
  const money = c => "$" + (Number(c) / 100).toFixed(2);
  const cents = v => Math.round(Number(v || 0) * 100);
  // ── item 3: Gives through ──
  const rel = new Map();
  const relOf = async id => { if (!rel.has(id)) rel.set(id, await get(`/donors/${encodeURIComponent(id)}/relationships`).catch(() => null)); return rel.get(id); };
  for (const k of await throughKey(q, orgId)) {
    const [mine, theirs] = [await relOf(k.person), await relOf(k.org)];
    if (!mine || !theirs) continue;
    const a = (mine.givesThrough || []).find(x => x.id === k.org);
    const b = (theirs.throughPeople || []).find(x => x.id === k.person);
    const open = await get(`/figures/gives-through/rows?donor=${encodeURIComponent(k.person)}&through=${encodeURIComponent(k.org)}&pageSize=1`).catch(() => null);
    agree(`numbers10 gives through ${k.person} via ${k.org}`, [["the key", k.cents], ["the person's Gives through", a ? a.cents : 0],
      ["the organization's Given through row", b ? b.cents : 0], ["the figure's rows", open ? cents(open.value) : undefined]], money);
    agree(`numbers10 gives through ${k.person} via ${k.org}: the rail does not say nothing is credited`,
      [["the key", false], ["the link's creditsNothing", !!(mine.relationships || []).some(r => r.relatedDonorId === k.org && r.creditsNothing)]], String);
  }
  // ── item 5: First-time givers ──
  const key = await firstTimeKey(q, orgId);
  const events = await q(`SELECT id FROM events WHERE org_id = $1 ORDER BY id LIMIT 12`, [orgId]);
  for (const { id } of events) {
    const want = key.get(id) || [];
    const rep = await get(`/events/${encodeURIComponent(id)}/report`).catch(() => null);
    if (!rep || !rep.figures) continue;
    const tile = (rep.figures.find(f => f.key === "firstTime") || {}).value;
    const open = await get(`/figures/event-first-time/rows?event=${encodeURIComponent(id)}&pageSize=500`).catch(() => null);
    const ids = open && Array.isArray(open.rows) ? open.rows.map(r => r.donor_id || r.id).sort() : undefined;
    agree(`numbers10 event ${id}: first-time givers`, [["the key", want.length], ["After the event's tile", tile], ["the figure", open ? Number(open.value) : undefined]]);
    if (ids) agree(`numbers10 event ${id}: the first-time givers it opens`, [["the key", want.join(",")], ["the figure's rows", ids.join(",")]]);
  }
}

// ── real-shaped's step: the fleet's shapes in a fresh org ──
async function n10SoftEvent({ ok, api, q, freshOrg, surfaces }) {
  const ORG = "org_n10softev";
  const tok = await freshOrg(ORG, "Numbers-10 soft and events (test)");
  const person = async (name, extra = {}) => {
    const r = await api("POST", "/donors", tok, { name, email: `${name.split(" ")[0].toLowerCase()}@n10c.invalid`, ...extra });
    if (!r.body || !r.body.id) throw new Error("person not made: " + JSON.stringify(r.body).slice(0, 200));
    return r.body.id;
  };
  const give = async (id, body) => {
    const r = await api("POST", `/donors/${id}/gifts`, tok, { type: "one-time", ...body });
    const g = r.body && r.body.gift;
    if (!g) throw new Error("gift not recorded: " + JSON.stringify(r.body).slice(0, 200));
    return g.id;
  };
  // §1 the fleet's Tidewater: a foundation's $25,000 in four gifts, its program officer linked organization first.
  const fdn = await person("Saltmarsh Community Foundation");
  await q(`UPDATE donors SET kind = 'organisation' WHERE id = $1`, [fdn]);
  const officer = await person("Barnaby Quillfeather");
  const clerk = await person("Odette Rimmington");
  await q(`INSERT INTO donor_relationships (id, org_id, donor_id_a, donor_id_b, relationship_type, notes, created_by, created_by_name)
           VALUES ('rel_n10c_po', $1, $2, $3, 'program_officer', 'Grants manager', 'system:test', 'numbers10 fixture')`, [ORG, fdn, officer]);
  const wk = await api("POST", `/donors/${clerk}/relationships`, tok, { relatedDonorId: fdn, relationshipType: "works_at" });
  ok("§N10C fixture: a clerk works at the foundation", wk.status < 300, wk.status);
  for (const [amount, date] of [[10000, "2026-02-10"], [7500, "2026-05-04"], [5000, "2026-07-21"], [2500, "2026-09-30"]]) await give(fdn, { amount, date });

  const mine = (await api("GET", `/donors/${officer}/relationships`, tok)).body || {};
  const theirs = (await api("GET", `/donors/${fdn}/relationships`, tok)).body || {};
  const gt = (mine.givesThrough || []).find(x => x.id === fdn);
  ok("§N10C the program officer's Gives through reads the foundation at $25,000", !!gt && gt.cents === 2500000, mine.givesThrough);
  ok("§N10C the rail's how line says it is soft credit through the program officer link", !!gt && gt.how === "officer_link" && /program officer/.test(gt.howWords || ""), gt);
  ok("§N10C the rail does not also say the foundation's gifts are its own", !(mine.relationships || []).some(r => r.creditsNothing), mine.relationships);
  ok("§N10C the sentence names the program officer link", /program officer/.test(mine.givesThroughDefinition || ""), mine.givesThroughDefinition);
  const tp = (theirs.throughPeople || []).find(x => x.id === officer);
  ok("§N10C the foundation's Given through it names him at $25,000", !!tp && tp.cents === 2500000, theirs.throughPeople);
  const open = (await api("GET", `/figures/gives-through/rows?donor=${officer}&through=${fdn}`, tok)).body || {};
  ok("§N10C the figure opens the four gifts, footing to $25,000", Math.round(Number(open.value) * 100) === 2500000 && (open.rows || []).length === 4
     && (open.rows || []).reduce((n, r) => n + Math.round(Number(r.amount) * 100), 0) === 2500000, { value: open.value, rows: (open.rows || []).length });
  const me = (await api("GET", `/donors/${officer}`, tok)).body || {};
  ok("§N10C his own lifetime stays $0 (soft credit is never his money)", Number(me.total_giving ?? me.totalGiving ?? 0) === 0, { total_giving: me.total_giving });
  const clerkRel = (await api("GET", `/donors/${clerk}/relationships`, tok)).body || {};
  ok("§N10C the clerk (works at) holds nothing through it, and the rail says so", !(clerkRel.givesThrough || []).length
     && (clerkRel.relationships || []).some(r => r.relatedDonorId === fdn && r.creditsNothing === true), clerkRel.givesThrough);

  // §2 the fleet's event: a first gift earlier the same day elsewhere is not the event's first-time giver.
  const DAY = "2026-10-17";
  const ev = await api("POST", "/events", tok, { name: "Lantern Walk", date: DAY, eventType: "community", description: "A walk." });
  const EVENT = ev.body && (ev.body.id || (ev.body.event && ev.body.event.id));
  ok("§N10C fixture: the event is made", !!EVENT, ev.body);
  const stamp = id => q(`UPDATE gifts SET event_id = $1 WHERE id = $2 AND org_id = $3`, [EVENT, id, ORG]);
  const early = await person("Wilhelmina Fairweather");   // first gift that morning, not the event's
  await give(early, { amount: 40, date: DAY });
  await stamp(await give(early, { amount: 150, date: DAY }));
  const fresh = await person("Cosmo Brightwater");         // first gift ever was the event's
  await stamp(await give(fresh, { amount: 200, date: DAY }));
  const twice = await person("Philippa Ashgrove");          // two event gifts on her first day: once
  await stamp(await give(twice, { amount: 60, date: DAY })); await stamp(await give(twice, { amount: 25, date: DAY }));
  const before = await person("Delphine Marchwood");       // gave last year, then at the event
  await give(before, { amount: 30, date: "2025-11-01" });
  await stamp(await give(before, { amount: 75, date: DAY }));
  const rep = (await api("GET", `/events/${EVENT}/report`, tok)).body || {};
  const tile = (rep.figures || []).find(f => f.key === "firstTime") || {};
  ok("§N10C First-time givers is 2 (the new giver and the two-gift giver), not the same-day earlier giver", tile.value === 2, { value: tile.value });
  ok("§N10C its sentence says the first gift ever was for this event, the one recorded first on the day", /first gift ever/.test(tile.sentence || "") && /recorded first/.test(tile.sentence || ""), tile.sentence);
  ok("§N10C it is a figure that opens its people", tile.source && tile.source.key === "event-first-time", tile.source);
  const rows = (await api("GET", `/figures/event-first-time/rows?event=${EVENT}`, tok)).body || {};
  const ids = (rows.rows || []).map(r => r.donor_id || r.id).sort();
  ok("§N10C the figure opens exactly those two people", ids.join(",") === [fresh, twice].sort().join(",") && Number(rows.value) === 2, { ids, value: rows.value });
  const list = (await api("GET", `/events/${EVENT}/rows?rows=firstTime`, tok)).body || {};
  ok("§N10C the event's own list says the same two", (list.donors || []).map(d => d.donor_id).sort().join(",") === [fresh, twice].sort().join(","), list.donors);
  await surfaces(ORG, { token: tok, step: "numbers10 soft and events" });
}

module.exports = { numbers10SoftEventChecks, n10SoftEvent, throughKey, firstTimeKey };
