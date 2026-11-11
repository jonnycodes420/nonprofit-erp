// tests/connect1.test.js — CONNECT-1. WHO BROUGHT WHOM: INTRODUCED BY, GUEST OF.
//
// One made-up org, one check (or a few) per numbered item of the brief:
//   §1 two directional types in the same table and picker, stored newcomer
//      first from either profile, each read from its own side
//   §2 context only: lapse states, the giving unit and household totals are
//      byte-identical before and after the links are added
//   §3 the profile's relationships card lists them, each opening the other person
//   §4 the connector's line: "Brought in 2 people · $1,300 given since", worked
//      out by hand: a gift before the introduction is out, a refund comes off,
//      and the drawer's rows foot to it
//   §5 adding a guest at an event with "Guest of…" writes the guest_of link with the event
//   §6 the Donors list filters: Introduced by, Guest of (and at one event), Brought people in;
//      a saved view keeps them
//   §7 the import maps Introduced by and Guest of to people already here, lists
//      what it cannot match, and never creates a person for it
//   §8 merge keeps the links, drops a self-link and never doubles one
//
// HOW IT GOES RED (planted, see the PR):
//   · introduced_by pooling into the household total (householdsFromLinks and the
//     route's household list taking introduced_by) turns §2 red
//   · the brought-in number counting a gift dated before the introduction
//     (the `>= since` dropped in shared/numbers/broughtIn.js) turns §4 red
//   · a merge leaving a person linked to themselves (step 1 of mergeInTx
//     skipped) turns §8 red
//   · an unmatched "Introduced by" creating a new person turns §7 red
"use strict";
const bcrypt = require("bcryptjs");
const { ok, summary, api, q, login, closeDb, civilPlusDays } = require("./helpers");

const RUN = require("crypto").randomBytes(4).toString("hex");
const ORG = `org_connect1_${RUN}`;
const EMAIL = `owner-${RUN}@connect1.local`;
const PASSWORD = "loadtest1234";
const one = async (sql, a) => (await q(sql, a))[0];
// HARDEN-1 item 3: a change to import or merge passes the truth check.
const { assertSurfacesAgree } = require("./lib/surfacesAgree");
async function surfacesAgree(label, token) {
  const r = await assertSurfacesAgree(ORG, { token, soft: true, label });
  ok(`every surface agrees ${label} (${r.ms}ms)`, r.ok, r.diffs.length);
  for (const d of r.diffs) console.log("        " + d);
}

(async () => {
  console.log("connect1 (CONNECT-1)");
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,emails_enabled,onboarded_at)
           VALUES ($1,'Connect One Larkspur Commons',$1,1,'active','team','America/New_York',true,NOW())`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Wren Abernathy','admin')`,
    [`u_connect1_${RUN}`, ORG, EMAIL, bcrypt.hashSync(PASSWORD, 4)]);
  const tok = await login(EMAIL, PASSWORD);
  const P = async (key, name) => {
    const r = await api("POST", "/donors", tok, { name, email: `${key}-${RUN}@connect1.invalid` });
    if (!r.body || !r.body.id) throw new Error(`fixture ${name}: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
    return r.body.id;
  };
  const gift = async (id, amount, date) => {
    const r = await api("POST", `/donors/${id}/gifts`, tok, { amount, date, payment_method: "check" });
    if (r.status >= 300) throw new Error(`gift ${amount} ${date}: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
    return (r.body && (r.body.id || (r.body.gift && r.body.gift.id))) || null;
  };
  const dana = await P("dana", "Dana Whitcombe"), pat = await P("pat", "Pat Whitcombe");
  const sam = await P("sam", "Sam Okafor"), rina = await P("rina", "Rina Castellano");
  const theo = await P("theo", "Theo Marsh"), lio = await P("lio", "Lio Branford");
  // Dana and Pat are one household; Dana last gave 18 months ago (lapsed on her own).
  await gift(dana, 400, civilPlusDays(-540));
  await gift(pat, 250, civilPlusDays(-500));
  const hh = await api("POST", "/households", tok, { name: "The Whitcombes", memberIds: [dana, pat], primaryDonorId: dana });
  const hhId = hh.body && (hh.body.id || (hh.body.household && hh.body.household.id));
  // Sam: $500 before he was introduced, $1,000 after, and $200 of that refunded.
  await gift(sam, 500, "2026-02-15");
  const samAfter = await gift(sam, 1000, "2026-04-10");
  if (samAfter) await api("POST", `/gifts/${samAfter}/refund`, tok, { amount: 200, date: "2026-05-01", reason: "Asked for part back" });
  // Rina: $500 on the night of the Spring Supper she came to as Dana's guest.
  await gift(rina, 500, "2026-03-20");
  await gift(rina, 75, "2026-03-19");   // the day before the supper: out
  const ev = await api("POST", "/events", tok, { name: "Spring Supper", date: "2026-03-20", eventType: "community", description: "Supper." });
  const evId = ev.body && (ev.body.id || (ev.body.event && ev.body.event.id));

  // The Donors list's ids for a filter (everyone, not only donors).
  const listIds = async where => {
    const r = await api("GET", `/donors/ids?role=&where=${encodeURIComponent(JSON.stringify(where))}`, tok);
    return { status: r.status, ids: ((r.body && r.body.ids) || []).slice().sort() };
  };
  // What lapse, the giving unit and the household say: before any link, and after.
  const snap = async () => {
    const out = {};
    for (const v of ["new", "current", "recaptured", "lapsed"]) out[v] = (await listIds({ conditions: [{ field: "lifecycle", op: "is", value: v }] })).ids;
    out.lapsing = (await listIds({ conditions: [{ field: "lapse", op: "is", value: "lapsing" }] })).ids;
    out.inHousehold = (await listIds({ conditions: [{ field: "household", op: "yes" }] })).ids;
    const hf = hhId ? (await api("GET", `/figures/household-giving/rows?household=${hhId}`, tok)).body : null;
    out.household = hf && { value: hf.value, rows: (hf.rows || []).map(r => [r.id, r.amount]) };
    const L = require("../shared/numbers/lapse");
    const u = L.unitSetsSql(ORG, civilPlusDays(0));
    let i = 0;
    out.units = await q(`WITH ${u.with} SELECT donor_id, linked_last::text AS linked_last, held FROM unit ORDER BY donor_id`.replace(/\?/g, () => "$" + (++i)), u.args);
    return JSON.stringify(out);
  };
  const before = await snap();

  // ── §1 two directional types, stored newcomer first from either profile ──
  const a1 = await api("POST", `/donors/${sam}/relationships`, tok, { relatedDonorId: dana, relationshipType: "introduced_by" });
  // made from the connector's profile: Dana "Introduced…" Theo
  const a2 = await api("POST", `/donors/${dana}/relationships`, tok, { relatedDonorId: theo, relationshipType: "introduced_by", side: "connector" });
  const rows1 = await q(`SELECT donor_id_a, donor_id_b, relationship_type FROM donor_relationships WHERE org_id=$1 AND relationship_type='introduced_by' ORDER BY donor_id_a`, [ORG]);
  ok("§1 Introduced by is stored newcomer first (donor_id_a), from either profile",
    a1.status === 201 && a2.status === 201 && rows1.length === 2 && rows1.every(r => r.donor_id_b === dana) && rows1.some(r => r.donor_id_a === sam) && rows1.some(r => r.donor_id_a === theo),
    { a1: a1.status, a2: a2.status, rows1 });
  const dup = await api("POST", `/donors/${dana}/relationships`, tok, { relatedDonorId: sam, relationshipType: "introduced_by", side: "connector" });
  const self = await api("POST", `/donors/${sam}/relationships`, tok, { relatedDonorId: sam, relationshipType: "introduced_by" });
  ok("§1 the same link twice is refused (409), and nobody is linked to themselves (400)", dup.status === 409 && self.status === 400, { dup: dup.status, self: self.status });
  const retype = await api("PUT", `/donor-relationships/${a1.body && a1.body.id}`, tok, { relationshipType: "spouse" });
  ok("§1 a direction is never guessed: retyping a how-they-came-in link is refused", retype.status === 400, retype.status);
  // Pat is Dana's spouse AND introduced Lio: a context link sits beside any other link
  const spouseLio = await api("POST", `/donors/${lio}/relationships`, tok, { relatedDonorId: pat, relationshipType: "introduced_by" });
  ok("§1 existing types untouched: a spouse link and the household it made are still there", spouseLio.status === 201
    && (await q(`SELECT 1 FROM donors WHERE org_id=$1 AND id = ANY($2) AND household_id IS NOT NULL`, [ORG, [dana, pat]])).length === 2, spouseLio.status);
  // Guest of, made from the guest's profile, at the supper
  const g1 = await api("POST", `/donors/${rina}/relationships`, tok, { relatedDonorId: dana, relationshipType: "guest_of", eventId: evId });
  const rg = await one(`SELECT donor_id_a, donor_id_b, event_id FROM donor_relationships WHERE org_id=$1 AND relationship_type='guest_of'`, [ORG]);
  ok("§1 Guest of carries its event, guest first", g1.status === 201 && rg && rg.donor_id_a === rina && rg.donor_id_b === dana && rg.event_id === evId, { g1: g1.status, rg });

  // ── §2 context only ─────────────────────────────────────────────────────
  const after = await snap();
  ok("§2 lapse, the giving unit and the household total are byte-identical before and after the links", before === after,
    before === after ? null : (() => { const b = JSON.parse(before), a = JSON.parse(after); return Object.keys(b).filter(k => JSON.stringify(b[k]) !== JSON.stringify(a[k])).map(k => ({ k, before: b[k], after: a[k] })); })());

  const danaTotal = ((await api("GET", `/donors/${dana}/relationships`, tok)).body || {}).householdTotal;
  ok("§2 Dana's card says the household's own $650 ($400 + $250), not a cent of Sam's, Theo's or Rina's", Number(danaTotal) === 650, danaTotal);

  // ── §3 the card, read from each side ────────────────────────────────────
  const relOf = async id => ((await api("GET", `/donors/${id}/relationships`, tok)).body || {});
  const samRel = await relOf(sam), danaRel = await relOf(dana), rinaRel = await relOf(rina);
  const samLink = (samRel.relationships || []).find(r => r.relationshipType === "introduced_by");
  const danaIntro = (danaRel.relationships || []).filter(r => r.relationshipType === "introduced_by");
  const danaHost = (danaRel.relationships || []).find(r => r.relationshipType === "guest_of");
  const rinaLink = (rinaRel.relationships || []).find(r => r.relationshipType === "guest_of");
  ok("§3 Sam's card: the newcomer end, opening Dana", samLink && samLink.direction === "newcomer" && samLink.relatedDonorId === dana && samLink.relatedDonorName === "Dana Whitcombe", samLink);
  ok("§3 Dana's card: the connector end of each, opening Sam, Theo and Rina, with the supper named",
    danaIntro.length === 2 && danaIntro.every(r => r.direction === "connector") && new Set(danaIntro.map(r => r.relatedDonorId)).has(sam)
      && danaHost && danaHost.direction === "connector" && danaHost.relatedDonorId === rina && danaHost.eventName === "Spring Supper"
      && rinaLink && rinaLink.direction === "newcomer" && rinaLink.eventName === "Spring Supper", { danaIntro, danaHost, rinaLink });

  // ── §4 the connector's line, against a key worked out by hand ────────────
  // Sam: introduced 1 Mar 2026: $1,000 (10 Apr) − $200 refund (1 May) = $800; the $500 of 15 Feb is before. Theo: nothing.
  // Rina: guest at the supper, 20 Mar 2026: $500 that night; the $75 of 19 Mar is before.
  // People: Sam, Theo, Rina = 3. Given since: $800 + $500 = $1,300.
  await q(`UPDATE donor_relationships SET created_at = '2026-03-01 12:00:00-05' WHERE org_id=$1 AND donor_id_a=$2 AND relationship_type='introduced_by'`, [ORG, sam]);
  await q(`UPDATE donor_relationships SET created_at = '2026-11-02 12:00:00-05' WHERE org_id=$1 AND donor_id_a=$2 AND relationship_type='guest_of'`, [ORG, rina]);
  const bi = (await relOf(dana)).broughtIn;
  ok("§4 Dana's line: Brought in 3 people · $1,300 given since (hand key)",
    bi && bi.people === 3 && bi.cents === 130000 && bi.sentence === "Brought in 3 people · $1,300 given since", bi);
  const giftsDrawer = (await api("GET", `/figures/brought-in-gifts/rows?donor=${dana}&pageSize=50`, tok)).body || {};
  const drawerCents = (giftsDrawer.rows || []).reduce((n, r) => n + Math.round(Number(r.amount) * 100), 0);
  ok("§4 the number opens exactly those gifts, footing to the cent, none dated before its person came in",
    drawerCents === 130000 && (giftsDrawer.rows || []).length === 3 && !(giftsDrawer.rows || []).some(r => ["2026-02-15", "2026-03-19"].includes(String(r.date).slice(0, 10))),
    { drawerCents, rows: (giftsDrawer.rows || []).map(r => [r.date, r.amount, r.name]) });
  const peopleDrawer = (await api("GET", `/figures/brought-in-people/rows?donor=${dana}&pageSize=50`, tok)).body || {};
  ok("§4 the count opens the three people", (peopleDrawer.rows || []).length === 3 && Number(peopleDrawer.value) === 3, peopleDrawer.value);
  ok("§4 nobody brought in, no line (Sam)", samRel.broughtIn === null, samRel.broughtIn);

  // ── §5 at the event: Guest of… ──────────────────────────────────────────
  await api("POST", `/events/${evId}/attendees`, tok, { donorIds: [dana] });
  const add = await api("POST", `/events/${evId}/attendees`, tok, { name: "Mabry Quill", email: `mabry-${RUN}@connect1.invalid`, guestOfDonorId: dana });
  const mabry = await one(`SELECT id FROM donors WHERE org_id=$1 AND name='Mabry Quill'`, [ORG]);
  const ml = mabry && await one(`SELECT donor_id_b, event_id FROM donor_relationships WHERE org_id=$1 AND donor_id_a=$2 AND relationship_type='guest_of'`, [ORG, mabry.id]);
  const att = mabry && await one(`SELECT guest_of FROM event_attendees WHERE org_id=$1 AND donor_id=$2`, [ORG, mabry.id]);
  ok("§5 adding a guest with Guest of… writes guest_of to the host, with this event; the attendance row is as it was",
    add.status < 300 && ml && ml.donor_id_b === dana && ml.event_id === evId && att && att.guest_of === null, { status: add.status, ml, att });
  const notThere = await api("POST", `/events/${evId}/attendees`, tok, { name: "Ottoline Fenn", guestOfDonorId: lio });
  ok("§5 a host who is not on this event's list is refused, and nobody is added", notThere.status === 400
    && !(await one(`SELECT 1 AS x FROM donors WHERE org_id=$1 AND name='Ottoline Fenn'`, [ORG])), notThere.status);

  // ── §6 the Donors list filters ──────────────────────────────────────────
  const f1 = await listIds({ conditions: [{ field: "introduced_by", op: "is", value: dana }] });
  const f2 = await listIds({ conditions: [{ field: "guest_of", op: "is", value: dana }] });
  const f3 = await listIds({ conditions: [{ field: "guest_of", op: "is", value: `${dana}|${evId}` }] });
  const f4 = await listIds({ conditions: [{ field: "brought_in", op: "yes" }] });
  ok("§6 Introduced by Dana: Sam and Theo", JSON.stringify(f1.ids) === JSON.stringify([sam, theo].sort()), f1);
  ok("§6 Guest of Dana, and Guest of Dana at the supper: Rina and Mabry", JSON.stringify(f2.ids) === JSON.stringify([rina, mabry && mabry.id].sort())
    && JSON.stringify(f3.ids) === JSON.stringify(f2.ids), { f2, f3 });
  ok("§6 Brought people in: Dana and Pat", JSON.stringify(f4.ids) === JSON.stringify([dana, pat].sort()), f4);
  const setup = ((await api("GET", "/donors/list-setup", tok)).body || {});
  const fl = setup.fields || [];
  const intro = Array.isArray(fl) && fl.find(x => x.key === "introduced_by");
  ok("§6 the filter offers the people who introduced someone, never the whole org", intro && intro.filter && (intro.filter.options || []).map(o => o.value).sort().join() === [dana, pat].sort().join(),
    intro && intro.filter);
  const view = await api("POST", "/donors/list-views", tok, { name: "Dana's people", columns: ["name"], filters: { conditions: [{ field: "introduced_by", op: "is", value: dana }] } });
  const kept = (((await api("GET", "/donors/list-setup", tok)).body || {}).views || []).find(v => v.name === "Dana's people");
  const keptWhere = kept && (typeof kept.filters === "string" ? JSON.parse(kept.filters) : kept.filters);
  ok("§6 a saved view keeps the filter", view.status < 300 && keptWhere && keptWhere.conditions && keptWhere.conditions[0].field === "introduced_by", { status: view.status, kept });

  // ── §7 the import ───────────────────────────────────────────────────────
  const peopleBefore = (await one(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1`, [ORG])).n;
  const grid = [["First Name", "Last Name", "Email", "Introduced by", "Guest of"],
    ["Juno", "Pellham", `juno-${RUN}@connect1.invalid`, "Dana Whitcombe", ""],
    ["Kit", "Varga", `kit-${RUN}@connect1.invalid`, "", `rina-${RUN}@connect1.invalid`],
    ["Ash", "Morrow", `ash-${RUN}@connect1.invalid`, "Nobody Atall", ""]];
  const imp = await api("POST", "/sheet-import/commit", tok, { fileName: "connect1-people.csv", sheets: [{ name: "People", grid }], answers: {} });
  const res = imp.body || {};
  const juno = await one(`SELECT id FROM donors WHERE org_id=$1 AND name='Juno Pellham'`, [ORG]);
  const kit = await one(`SELECT id FROM donors WHERE org_id=$1 AND name='Kit Varga'`, [ORG]);
  const jl = juno && await one(`SELECT donor_id_b, import_id FROM donor_relationships WHERE org_id=$1 AND donor_id_a=$2 AND relationship_type='introduced_by'`, [ORG, juno.id]);
  const kl = kit && await one(`SELECT donor_id_b FROM donor_relationships WHERE org_id=$1 AND donor_id_a=$2 AND relationship_type='guest_of'`, [ORG, kit.id]);
  ok("§7 Introduced by (by name) and Guest of (by email) link to people already here, tagged with the import",
    imp.status === 201 && jl && jl.donor_id_b === dana && jl.import_id === res.importId && kl && kl.donor_id_b === rina, { status: imp.status, jl, kl, c: res.connections });
  const peopleAfter = (await one(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1`, [ORG])).n;
  ok("§7 an unmatched Introduced by is listed for review and creates nobody (3 rows, 3 new people, no Nobody Atall)",
    res.connections && res.connections.unmatched.length === 1 && /Nobody Atall/.test(res.connections.unmatched[0].why) && res.connections.linked === 2
      && peopleAfter - peopleBefore === 3 && !(await one(`SELECT 1 AS x FROM donors WHERE org_id=$1 AND lower(name)='nobody atall'`, [ORG])),
    { c: res.connections, added: peopleAfter - peopleBefore });

  await surfacesAgree("after the import with Introduced by and Guest of", tok);

  // ── §8 merge ─────────────────────────────────────────────────────────────
  // A second Sam record, also introduced by Dana (a twin of Sam's link) and
  // linked to Sam himself as Guest of (a self-link once merged).
  const sam2 = await P("sam2", "Sam Okafor");
  await api("POST", `/donors/${sam2}/relationships`, tok, { relatedDonorId: dana, relationshipType: "introduced_by" });
  await api("POST", `/donors/${sam2}/relationships`, tok, { relatedDonorId: sam, relationshipType: "guest_of" });
  await api("POST", `/donors/${sam2}/relationships`, tok, { relatedDonorId: lio, relationshipType: "introduced_by", side: "connector" });
  const pair = (await api("GET", `/data-health/pair?a=${sam}&b=${sam2}`, tok)).body || {};
  const m = await api("POST", "/data-health/merge", tok, { keptId: sam, mergedId: sam2, choices: pair.choices });
  const links = await q(`SELECT donor_id_a, donor_id_b, relationship_type FROM donor_relationships WHERE org_id=$1 AND (donor_id_a=$2 OR donor_id_b=$2) AND relationship_type IN ('introduced_by','guest_of')`, [ORG, sam]);
  const selfLinks = await q(`SELECT id FROM donor_relationships WHERE org_id=$1 AND donor_id_a = donor_id_b`, [ORG]);
  const introByDana = links.filter(l => l.donor_id_a === sam && l.donor_id_b === dana && l.relationship_type === "introduced_by");
  const fromLio = links.filter(l => l.donor_id_a === lio && l.donor_id_b === sam);
  ok("§8 the merge drops the self-link", m.status < 300 && selfLinks.length === 0, { status: m.status, body: m.body && (m.body.error || m.body.sentence), selfLinks });
  ok("§8 the merge never doubles a link (one Introduced by Dana) and keeps the merged person's own (Sam introduced Lio)",
    introByDana.length === 1 && fromLio.length === 1, links);
  const merges = (await api("GET", "/data-health/merges", tok)).body || {};
  const mid = (m.body && m.body.mergeId) || ((merges.merges || merges || [])[0] || {}).id;
  const undo = mid ? await api("POST", `/data-health/merges/${mid}/undo`, tok, {}) : { status: 0 };
  const back = await q(`SELECT donor_id_a, donor_id_b, relationship_type FROM donor_relationships WHERE org_id=$1 AND (donor_id_a=$2 OR donor_id_b=$2)`, [ORG, sam2]);
  ok("§8 Undo puts back all three of the merged record's links, the set-aside ones included", undo.status < 300 && back.length === 3, { undo: undo.status, back });

  await surfacesAgree("after the merge and its Undo", tok);

  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch {} process.exit(1); });
