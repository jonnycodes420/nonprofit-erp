// tests/fix11-seating.test.js — FIX-11 Part 2. THE ONE GUARD THIS BUILD EARNED.
//
//     SEATING NEVER PUTS MORE PEOPLE AT A TABLE THAN ITS SEATS, AND A GUEST
//     IS NEVER AT TWO TABLES.
//
// Both halves are the same promise. A seating chart is a physical claim about
// a room: twelve round tables, ten chairs each. A chart that seats eleven at a
// table of ten is not a chart, it is a person standing up at a wedding, and a
// guest listed at two tables is a name tag that sends them to the wrong room.
//
// Before this build a table existed only because somebody was sitting at it —
// `event_attendees.table_label`, a free string — so there was no number of
// seats to exceed and nothing to check. On a real gala that meant a seating
// card with no tables on it and no way to add one.
//
// WHAT IS ASSERTED:
//   §1  a table is a row with seats, and adding "12 tables of 10" makes twelve
//   §2  seating refuses the eleventh guest at a table of ten, with a reason
//       that names the table, and the refusal leaves the chart untouched
//   §3  a party on one ticket moves together, and only where they ALL fit; a
//       party of four is refused by a table with three seats open rather than
//       being split across two
//   §4  a guest is at ONE table: seating somebody who is already seated moves
//       them, and the database is asked directly rather than the screen
//   §5  "Seat everyone" is a PLAN until it is applied, it never overfills and
//       never splits a party, and what it does is undoable
//   §6  removing a table returns its guests to Not seated rather than deleting
//       them, and the undo puts both back
//   §7  shrinking a table below the people at it is refused
//   §8  org A cannot see, seat at, rename or remove org B's tables
//
// HOW IT WOULD GO RED: drop the capacity check in applySeating (§2, §3, §5);
// write table_label without clearing the old one (§4); let seatEveryonePlan
// split a party (§3, §5); cascade-delete attendees with the table (§6); allow
// a seats value below the seated count (§7); forget the org scope (§8). Every
// one was planted and watched to go red while this was written.
//
// Standard scratch stack (tests/README.md).

const bcrypt = require("bcryptjs");
const { BASE, ok, summary, login, api, q, closeDb } = require("./helpers");

const A = "org_f11seatA", B = "org_f11seatB";
const PW = bcrypt.hashSync("loadtest1234", 10);

async function wipe(orgId) {
  const tables = await q(
    `SELECT table_name FROM information_schema.columns
      WHERE table_schema='public' AND column_name='org_id' ORDER BY table_name`);
  for (const r of tables) await q(`DELETE FROM ${r.table_name} WHERE org_id=$1`, [orgId]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [orgId]).catch(() => {});
}

async function seedOrg(orgId, tag) {
  await wipe(orgId);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
           VALUES ($1,$2,$3,1,'active','team')`, [orgId, "Seat " + tag, "seat-" + tag]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ($1,$2,$3,$4,'Dana Reyes','admin')`,
    [`u_${orgId}`, orgId, `admin-${tag}@f11seat.local`, PW]);
  await q(`INSERT INTO events (id,org_id,name,event_type,date,status)
           VALUES ($1,$2,'Harbor Lights Gala','gala','2026-11-14','planned')`, [`ev_${orgId}`, orgId]);
  return `ev_${orgId}`;
}

// n guests, plus one party: a host and three on the host's ticket.
async function seedGuests(orgId, eventId, n) {
  const ids = [];
  for (let i = 0; i < n; i++) {
    const id = `att_${orgId}_${String(i).padStart(3, "0")}`;
    await q(`INSERT INTO event_attendees (id,event_id,org_id,name,email,status)
             VALUES ($1,$2,$3,$4,$5,'registered')`,
      [id, eventId, orgId, `Guest ${i + 1}`, `g${i}@f11seat.local`]);
    ids.push(id);
  }
  const host = `att_${orgId}_party`;
  await q(`INSERT INTO event_attendees (id,event_id,org_id,name,email,status)
           VALUES ($1,$2,$3,'Jon Halloran','jon@f11seat.local','registered')`, [host, eventId, orgId]);
  const party = [host];
  for (let i = 0; i < 3; i++) {
    const id = `att_${orgId}_party${i}`;
    await q(`INSERT INTO event_attendees (id,event_id,org_id,name,status,guest_of)
             VALUES ($1,$2,$3,$4,'registered',$5)`, [id, eventId, orgId, `Halloran guest ${i + 1}`, host]);
    party.push(id);
  }
  return { ids, host, party };
}

const seatedTableOf = async (orgId, attId) => {
  const [r] = await q(`SELECT table_label, table_id FROM event_attendees WHERE id=$1 AND org_id=$2`, [attId, orgId]);
  return r || null;
};

(async () => {
  console.log("fix11-seating (FIX-11 Part 2)");
  const evA = await seedOrg(A, "a");
  const evB = await seedOrg(B, "b");
  const tokA = await login("admin-a@f11seat.local");
  const tokB = await login("admin-b@f11seat.local");
  ok("fixture logins minted", !!tokA && !!tokB);
  if (!tokA || !tokB) return summary();

  // ── §1 · A TABLE IS A ROW WITH SEATS ────────────────────────────────────
  const add = await api("POST", `/events/${evA}/tables`, tokA, { count: 12, seats: 10 });
  ok("§1 twelve tables of ten were added", add.status === 201 && add.body.created === 12,
    { status: add.status, created: add.body && add.body.created });
  const rows = await q(`SELECT label, seats FROM event_tables WHERE event_id=$1 AND org_id=$2 ORDER BY sort`, [evA, A]);
  ok("§1 …as twelve rows, each with ten seats",
    rows.length === 12 && rows.every(r => Number(r.seats) === 10), { rows: rows.length, seats: [...new Set(rows.map(r => Number(r.seats)))] });
  ok("§1 …named Table 1 through Table 12",
    rows[0].label === "Table 1" && rows[11].label === "Table 12", { first: rows[0].label, last: rows[11].label });
  const again = await api("POST", `/events/${evA}/tables`, tokA, { count: 12, seats: 10 });
  const after = await q(`SELECT COUNT(*)::int AS n FROM event_tables WHERE event_id=$1`, [evA]);
  ok("§1 …and asking for twelve again adds twelve MORE rather than duplicating names",
    after[0].n === 24 && again.body.created === 12, { total: after[0].n, created: again.body && again.body.created });
  // Back to twelve for the rest of the suite.
  for (const r of await q(`SELECT id FROM event_tables WHERE event_id=$1 ORDER BY sort OFFSET 12`, [evA]))
    await q(`DELETE FROM event_tables WHERE id=$1`, [r.id]);

  const { ids, host, party } = await seedGuests(A, evA, 14);

  // ── §2 · THE SEATS ARE A LIMIT ──────────────────────────────────────────
  for (let i = 0; i < 10; i++) {
    const r = await api("POST", `/events/${evA}/seat`, tokA, { attendeeIds: [ids[i]], table: "Table 1" });
    if (r.status >= 300) { ok(`§2 guest ${i + 1} of ten seated at Table 1`, false, { status: r.status, body: r.body }); break; }
  }
  const t1 = await q(`SELECT COUNT(*)::int AS n FROM event_attendees WHERE table_label='Table 1' AND org_id=$1`, [A]);
  ok("§2 ten guests fit at a table of ten", t1[0].n === 10, { seated: t1[0].n });
  const eleventh = await api("POST", `/events/${evA}/seat`, tokA, { attendeeIds: [ids[10]], table: "Table 1" });
  ok("§2 the ELEVENTH is refused", eleventh.status === 409, { status: eleventh.status, body: eleventh.body });
  ok("§2 …with a reason that names the table",
    /Table 1/.test(String(eleventh.body && eleventh.body.error)), { error: eleventh.body && eleventh.body.error });
  const stillTen = await q(`SELECT COUNT(*)::int AS n FROM event_attendees WHERE table_label='Table 1' AND org_id=$1`, [A]);
  const stray = await seatedTableOf(A, ids[10]);
  ok("§2 …and the refusal changed nothing",
    stillTen[0].n === 10 && !stray.table_label, { seated: stillTen[0].n, refusedGuestTable: stray.table_label });

  // ── §3 · A PARTY MOVES TOGETHER, OR NOT AT ALL ──────────────────────────
  // Table 2 is given exactly three open seats, so a party of four cannot fit.
  await api("PUT", `/events/${evA}/tables/${rows.find(r => r.label === "Table 2") ? (await q(`SELECT id FROM event_tables WHERE event_id=$1 AND label='Table 2'`, [evA]))[0].id : ""}`,
    tokA, { seats: 3 });
  const partyTry = await api("POST", `/events/${evA}/seat`, tokA, { attendeeIds: [host], table: "Table 2" });
  ok("§3 a party of four is refused by a table with three seats", partyTry.status === 409,
    { status: partyTry.status, body: partyTry.body });
  const splitCheck = await q(
    `SELECT COUNT(*)::int AS n FROM event_attendees WHERE id = ANY($1) AND table_label IS NOT NULL`, [party]);
  ok("§3 …and NOT ONE of them was seated, so the party was not split", splitCheck[0].n === 0, { seated: splitCheck[0].n });

  const partyOk = await api("POST", `/events/${evA}/seat`, tokA, { attendeeIds: [host], table: "Table 3" });
  const partySeated = await q(
    `SELECT DISTINCT table_label FROM event_attendees WHERE id = ANY($1)`, [party]);
  ok("§3 naming only the host seats the whole party, at one table",
    partyOk.status === 200 && partySeated.length === 1 && partySeated[0].table_label === "Table 3",
    { status: partyOk.status, tables: partySeated.map(r => r.table_label) });

  // ── §4 · ONE GUEST, ONE TABLE ───────────────────────────────────────────
  await api("POST", `/events/${evA}/seat`, tokA, { attendeeIds: [ids[0]], table: "Table 4" });
  const moved = await q(
    `SELECT table_label, table_id FROM event_attendees WHERE id=$1 AND org_id=$2`, [ids[0], A]);
  ok("§4 re-seating MOVES a guest rather than adding a second seat",
    moved[0].table_label === "Table 4", { now: moved[0].table_label });
  const dupes = await q(
    `SELECT a.id FROM event_attendees a
       JOIN event_tables t ON t.id = a.table_id
      WHERE a.org_id=$1 AND a.table_label IS NOT NULL AND a.table_label <> t.label`, [A]);
  ok("§4 …and no guest's label and table row disagree about where they sit",
    dupes.length === 0, { mismatched: dupes.map(r => r.id) });
  const overfull = await q(
    `SELECT t.label, t.seats, COUNT(a.id)::int AS n
       FROM event_tables t LEFT JOIN event_attendees a
         ON a.table_id = t.id AND a.status <> 'cancelled'
      WHERE t.org_id=$1 GROUP BY t.id, t.label, t.seats HAVING COUNT(a.id) > t.seats`, [A]);
  ok("§4 …and no table anywhere holds more people than it has seats",
    overfull.length === 0, { over: overfull });

  // ── §5 · SEAT EVERYONE IS A PLAN FIRST ──────────────────────────────────
  const before = await q(`SELECT id, table_label FROM event_attendees WHERE org_id=$1 ORDER BY id`, [A]);
  const preview = await api("POST", `/events/${evA}/seat-everyone`, tokA, {});
  ok("§5 a preview says what it would do", preview.status === 200 && preview.body.preview === true
    && Array.isArray(preview.body.moves), { status: preview.status, sentence: preview.body && preview.body.sentence });
  const unchanged = await q(`SELECT id, table_label FROM event_attendees WHERE org_id=$1 ORDER BY id`, [A]);
  ok("§5 …and changes nothing",
    JSON.stringify(before) === JSON.stringify(unchanged), { before: before.length, after: unchanged.length });

  const applied = await api("POST", `/events/${evA}/seat-everyone`, tokA, { apply: true });
  ok("§5 applying it seats people", applied.status === 200, { status: applied.status, sentence: applied.body && applied.body.sentence });
  const over2 = await q(
    `SELECT t.label, t.seats, COUNT(a.id)::int AS n
       FROM event_tables t LEFT JOIN event_attendees a
         ON a.table_id = t.id AND a.status <> 'cancelled'
      WHERE t.org_id=$1 GROUP BY t.id, t.label, t.seats HAVING COUNT(a.id) > t.seats`, [A]);
  ok("§5 …and still never overfills a table", over2.length === 0, { over: over2 });
  const partyAfter = await q(`SELECT DISTINCT table_label FROM event_attendees WHERE id = ANY($1)`, [party]);
  ok("§5 …and the party is still at one table", partyAfter.length === 1, { tables: partyAfter.map(r => r.table_label) });

  if (Array.isArray(applied.body.undo) && applied.body.undo.length) {
    const undo = await api("POST", `/events/${evA}/seat`, tokA, { moves: applied.body.undo, withParty: false });
    const restored = await q(`SELECT id, table_label FROM event_attendees WHERE org_id=$1 ORDER BY id`, [A]);
    ok("§5 …and the undo puts the chart back exactly as it was",
      undo.status === 200 && JSON.stringify(restored) === JSON.stringify(before),
      { status: undo.status, differs: restored.filter((r, i) => r.table_label !== before[i].table_label).length });
  } else ok("§5 …and the undo puts the chart back exactly as it was", false, "no undo was returned");

  // ── §6 · REMOVING A TABLE DOES NOT REMOVE THE GUESTS ────────────────────
  const [t3] = await q(`SELECT id FROM event_tables WHERE event_id=$1 AND label='Table 3'`, [evA]);
  const sittingAt3 = await q(`SELECT id FROM event_attendees WHERE table_id=$1`, [t3.id]);
  const del = await api("DELETE", `/events/${evA}/tables/${t3.id}`, tokA);
  ok("§6 the table is gone", del.status === 200
    && (await q(`SELECT id FROM event_tables WHERE id=$1`, [t3.id])).length === 0, { status: del.status });
  const survivors = await q(`SELECT id, table_label FROM event_attendees WHERE id = ANY($1)`,
    [sittingAt3.map(r => r.id)]);
  ok("§6 …and every guest who was at it is still a guest, now Not seated",
    survivors.length === sittingAt3.length && survivors.every(s => !s.table_label),
    { were: sittingAt3.length, now: survivors.length, labels: survivors.map(s => s.table_label) });
  ok("§6 …and the response says who moved so the screen can offer to put them back",
    Array.isArray(del.body.undo) && del.body.undo.length === sittingAt3.length,
    { undo: del.body.undo && del.body.undo.length, expected: sittingAt3.length });

  // ── §7 · A SEATS NUMBER THAT WOULD LIE IS REFUSED ───────────────────────
  const [t1row] = await q(`SELECT id FROM event_tables WHERE event_id=$1 AND label='Table 1'`, [evA]);
  const atT1 = await q(`SELECT COUNT(*)::int AS n FROM event_attendees WHERE table_id=$1`, [t1row.id]);
  const shrink = await api("PUT", `/events/${evA}/tables/${t1row.id}`, tokA, { seats: Math.max(1, atT1[0].n - 1) });
  ok("§7 shrinking a table below the people at it is refused", shrink.status === 400,
    { status: shrink.status, at: atT1[0].n, body: shrink.body });
  ok("§7 …and the refusal says how many are sitting there",
    new RegExp(String(atT1[0].n)).test(String(shrink.body && shrink.body.error)),
    { error: shrink.body && shrink.body.error });

  // Renaming carries the guests' labels with it, because the print chart, the
  // name tags and the kiosk all read the label.
  const rename = await api("PUT", `/events/${evA}/tables/${t1row.id}`, tokA, { label: "Lighthouse table" });
  const renamed = await q(`SELECT COUNT(*)::int AS n FROM event_attendees WHERE table_id=$1 AND table_label='Lighthouse table'`, [t1row.id]);
  ok("§7 renaming a table renames it for every guest at it",
    rename.status === 200 && renamed[0].n === atT1[0].n, { status: rename.status, moved: renamed[0].n, expected: atT1[0].n });

  // ── §8 · ONE ORG'S ROOM ─────────────────────────────────────────────────
  await api("POST", `/events/${evB}/tables`, tokB, { count: 2, seats: 8 });
  const [bTable] = await q(`SELECT id, label FROM event_tables WHERE event_id=$1 LIMIT 1`, [evB]);
  const bGuests = await seedGuests(B, evB, 1);
  const peek = await api("GET", `/events/${evB}/guests`, tokA);
  ok("§8 org A cannot read org B's guest list", peek.status === 404, { status: peek.status });
  const renameB = await api("PUT", `/events/${evB}/tables/${bTable.id}`, tokA, { label: "Taken" });
  ok("§8 org A cannot rename org B's table", renameB.status === 404, { status: renameB.status });
  const killB = await api("DELETE", `/events/${evB}/tables/${bTable.id}`, tokA);
  ok("§8 org A cannot remove org B's table", killB.status === 404, { status: killB.status });
  const seatB = await api("POST", `/events/${evB}/seat`, tokA, { attendeeIds: [bGuests.host], table: bTable.label });
  ok("§8 org A cannot seat anybody in org B's room", seatB.status === 404, { status: seatB.status });
  const bIntact = await q(`SELECT label FROM event_tables WHERE id=$1`, [bTable.id]);
  ok("§8 …and org B's table is untouched", bIntact.length === 1 && bIntact[0].label === bTable.label,
    { label: bIntact[0] && bIntact[0].label });

  await wipe(A); await wipe(B);
  await closeDb();
  summary();
})().catch(async e => {
  console.error(e);
  try { await closeDb(); } catch { /* already closed */ }
  process.exit(1);
});
