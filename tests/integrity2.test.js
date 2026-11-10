// tests/integrity2.test.js: INTEGRITY-2. TRASH YOU CAN RESTORE FROM, DELETES
// THAT CLEAN UP AFTER THEMSELVES. Guards donor data. Every name, file and
// address here is made up.
//
//   §1 W-1107-Finance-35: the Trash lists 300 people with who, when and why,
//      finds one by search, and Restore brings back exactly that one; Empty
//      trash still asks first.
//   §2 W-1107-Finance-35, the undo: a donor who was here before an import never
//      moves with its undo. Shape A (the fleet's): another user pressed "Bring
//      them back" for the same fixture file, and this user's import matched
//      her by email. Shape B: a merge put her history on a record the file
//      created. Neither moves, even with "Move them too".
//   §3 W-1107-Finance-17: Undo's confirm lists who has activity since and
//      offers the choice up front; "Move them too" happens in the same undo;
//      a line Steward wrote by itself is not activity.
//   §4 W-1108-Donors-45X: deleting a person takes their household and
//      relationship links (no "Owner: … $0" left), and Restore brings them back;
//      the delete's confirm counts what goes.
//   §5 W-1108-Volunteers-17X: deleting a meeting takes its open tasks and the
//      "How did it go" prompt; Done tasks and notes stay, labelled; Undo puts
//      all of it back.
//   §6 W-1107-Prod-04: "Where does N come from?" adds up to Everyone and never
//      counts the trash.
//   §7 browser: Delete on a profile asks first; Trash, Restore one person.
"use strict";
const bcrypt = require("bcryptjs");
const path = require("path");
const fs = require("fs");
const { ok, summary, login, api, q, closeDb, browserLegOrSkip } = require("./helpers");
const { DIST } = require("./lib/dist");

const BASE = process.env.BASE || "http://localhost:5601";
const PASSWORD = "integritytwo12345";
const TODAY = "2026-11-08";
const SUITE_DEADLINE_MS = 300000;
const APP = process.env.APP_URL || "http://localhost:4173";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");

const one = async (sql, args) => (await q(sql, args))[0];
async function freshOrg(id, name) {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 5; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [id]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [id]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,'active','team')`, [id, name, id.replace(/_/g, "-")]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Wren Tester','admin')`, ["u_" + id, id, `${id}@test.local`, bcrypt.hashSync(PASSWORD, 4)]);
  return login(`${id}@test.local`, PASSWORD);
}
async function secondUser(org) {
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Quill Other','admin')`, ["u2_" + org, org, `${org}.two@test.local`, bcrypt.hashSync(PASSWORD, 4)]);
  return login(`${org}.two@test.local`, PASSWORD);
}
async function person(org, id, name, email, gifts = []) {
  await q(`INSERT INTO donors (id, org_id, name, email, created_by, created_by_name) VALUES ($1,$2,$3,$4,'system:test','Test')`, [id, org, name, email]);
  for (const [k, [amt, d]] of gifts.entries())
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,created_by,created_by_name,created_at) VALUES ($1,$2,$3,$4,$5,'system:test','Test', NOW() - INTERVAL '30 days')`, [`g_${id}_${k}`, org, id, amt, d]);
  return id;
}
async function importJob(tok, body) {
  const r = await api("POST", "/sheet-import/commit", tok, { ...body, background: true });
  if (r.status !== 202) return { start: r, end: null, importId: null };
  const t0 = performance.now();
  for (;;) {
    const j = await api("GET", `/sheet-import/jobs/${encodeURIComponent(r.body.importId)}`, tok);
    if (j.status === 200 && j.body.status !== "running") return { start: r, end: j.body, importId: r.body.importId };
    if (performance.now() - t0 > 120000) return { start: r, end: { status: "timeout" }, importId: r.body.importId };
    await new Promise(z => setTimeout(z, 300));
  }
}
const FIONA_ROW = ["Fiona Callahan", "fiona.callahan@example.test", "2025-10-01", "50"];
function file(n, tag, extra = []) {
  const grid = [["Name", "Email", "Gift Date", "Amount"]];
  for (let p = 0; p < n; p++) grid.push([`Person ${tag} ${p}`, `${tag}${p}@example.test`, "2025-09-1" + (p % 9), String(20 + p)]);
  for (const r of extra) grid.push(r);
  return [{ name: "Gifts", grid }];
}
const live = async id => !!(await one(`SELECT 1 AS x FROM donors WHERE id=$1 AND deleted_at IS NULL`, [id]));

(async () => {
  const deadline = setTimeout(() => { console.error(`integrity2: the suite passed its ${SUITE_DEADLINE_MS / 1000} s deadline`); process.exit(1); }, SUITE_DEADLINE_MS);

  // ── §1 Restore one person from a trash of 300
  {
    const ORG = "org_integrity2_trash";
    const tok = await freshOrg(ORG, "Integrity Two Trash");
    const ids = [];
    for (let i = 0; i < 299; i++) ids.push(await person(ORG, `d_i2t_${i}`, `Trashed Person ${i}`, `t${i}@example.test`));
    const fiona = await person(ORG, "d_i2t_fiona", "Fiona Callahan", "fiona.callahan@example.test", [[20000, "2023-04-01"], [15000, "2024-04-01"]]);
    const keep = await person(ORG, "d_i2t_keep", "Kept Person", "kept@example.test");
    const del = await api("POST", "/donors/bulk-delete", tok, { ids: [...ids, fiona], count: 300 });
    const list = await api("GET", "/trash/people?limit=50", tok);
    ok("§1 the Trash lists all 300, with who deleted them, when, why and the day they leave",
      del.status === 200 && list.status === 200 && list.body.inTrash === 300 && list.body.total === 300 && list.body.people.length === 50
        && list.body.people.every(p => p.deletedBy === "Wren Tester" && /^Moved to trash from the Donors list, \d+ \w+/.test(p.why) && p.leavesOn),
      { del: del.status, inTrash: list.body && list.body.inTrash, first: list.body && list.body.people && list.body.people[0] });
    const found = await api("GET", "/trash/people?q=callahan", tok);
    ok("§1 search finds Fiona by name, with her 2 gifts", found.body.total === 1 && found.body.people[0].id === fiona && found.body.people[0].gifts === 2, found.body.people);
    const everyoneBefore = (await one(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND deleted_at IS NULL`, [ORG])).n;
    const back = await api("POST", "/trash/people/restore", tok, { ids: [fiona] });
    const after = await api("GET", "/trash/people?limit=1", tok);
    const openRows = (await one(`SELECT COUNT(*)::int AS n FROM deleted_records WHERE org_id=$1 AND record_id=$2 AND restored_at IS NULL`, [ORG, fiona])).n;
    const breakdown = await api("GET", "/people/everyone-breakdown", tok);
    ok("§1 Restore brings back exactly Fiona: 299 stay in the trash, her trash row is closed, Everyone goes up by one",
      back.status === 200 && back.body.restored === 1 && /Fiona Callahan is back/.test(back.body.sentence) && await live(fiona)
        && after.body.inTrash === 299 && openRows === 0 && breakdown.body.everyone === everyoneBefore + 1 && everyoneBefore === 1 && await live(keep),
      { back: back.body, inTrash: after.body.inTrash, openRows, everyoneBefore, everyone: breakdown.body.everyone });
    const sel = await api("POST", "/trash/people/restore", tok, { ids: ids.slice(0, 3) });
    ok("§1 Restore on a selection brings back the three chosen", sel.body.restored === 3 && (await api("GET", "/trash/people?limit=1", tok)).body.inTrash === 296, sel.body);
    const unasked = await api("POST", "/donors/purge-trash", tok, { olderThanDays: null });
    ok("§1 Empty trash asks first: without the confirm, nobody is deleted", unasked.status === 400 && (await api("GET", "/trash/people?limit=1", tok)).body.inTrash === 296, unasked.body);
  }

  // ── §2 an undo never moves a donor who was here before the import
  {
    const ORG = "org_integrity2_undo";
    const tokA = await freshOrg(ORG, "Integrity Two Undo");
    const tokB = await secondUser(ORG);
    const fiona = await person(ORG, "d_i2u_fiona", "Fiona Callahan", "fiona.callahan@example.test", [[20000, "2023-04-01"], [15000, "2024-04-01"]]);
    // Shape A. Earlier QA put her in the trash; another user (B) previewed the
    // shared fixture file and pressed "Bring them back". B never imported it.
    await api("POST", "/donors/bulk-delete", tokA, { ids: [fiona], count: 1 });
    const sheets = file(40, "fin", [FIONA_ROW]);
    const uB = await api("POST", "/sheet-import/understand", tokB, { fileName: "fleet-fixture.csv", sheets, useModel: false, today: TODAY });
    const bB = await api("POST", "/sheet-import/bring-back", tokB, { ids: [fiona], fileKey: uB.body.fileKey });
    // Finance (A) imports the same fixture file: it matches Fiona by her email.
    const jA = await importJob(tokA, { fileName: "fleet-fixture.csv", sheets, useModel: false, previewOrgId: ORG, today: TODAY });
    const pre = await api("GET", `/imports/${jA.importId}/undo-preview`, tokA);
    const undo = await api("POST", `/imports/${jA.importId}/reverse`, tokA, { alsoMove: true });
    ok("§2 shape A: another user's bring-back for the same file is not this import's; its undo (with Move them too) leaves Fiona live",
      bB.status === 200 && bB.body.restored === 1 && jA.end && jA.end.status === "done" && undo.status === 200 && await live(fiona)
        && !(pre.body.activitySince || []).some(p => p.id === fiona),
      { bB: bB.body, job: jA.end && jA.end.status, undo: undo.body && undo.body.sentence, fionaLive: await live(fiona) });
    // Shape B. A file creates Morwenna Stroud (a new record); a merge keeps the new record and moves Fiona's history onto it.
    const sheetsB = file(5, "mrg", [["Morwenna Stroud", "morwenna.stroud@example.test", "2025-10-02", "60"]]);
    const jB = await importJob(tokA, { fileName: "merge-shape.csv", sheets: sheetsB, useModel: false, previewOrgId: ORG, today: TODAY });
    const dup = await one(`SELECT id FROM donors WHERE org_id=$1 AND created_import_id=$2 AND name='Morwenna Stroud'`, [ORG, jB.importId]);
    const merged = await api("POST", "/donors/merge", tokA, { primaryId: dup.id, secondaryId: fiona });
    const preB = await api("GET", `/imports/${jB.importId}/undo-preview`, tokA);
    const held = (preB.body.activitySince || []).find(p => p.id === dup.id);
    const undoB = await api("POST", `/imports/${jB.importId}/reverse`, tokA, { alsoMove: true });
    const stayed = ((undoB.body && undoB.body.stayed) || []).find(p => p.id === dup.id);
    // the receipt's "Remove them too", as the screen sends it
    const movable = ((undoB.body && undoB.body.stayed) || []).filter(p => p.movable !== false).map(p => p.id);
    if (movable.length) await api("POST", "/donors/bulk-delete", tokA, { ids: movable, count: movable.length, importId: jB.importId });
    ok("§2 shape B: the record holding Fiona's $35,000 from before the import is named, never offered to move, and stays live",
      merged.status === 200 && held && held.movable === false && stayed && stayed.movable === false && await live(dup.id),
      { merged: merged.status, held, stayed, live: await live(dup.id), sentence: undoB.body && undoB.body.sentence });
  }

  // ── §3 Finance-17: activity since, the choice up front, one click
  {
    const ORG = "org_integrity2_since";
    const tok = await freshOrg(ORG, "Integrity Two Since");
    const sheets = file(30, "hk", [["Hugo Kovac", "hugo.kovac@example.test", "2025-09-20", "75"]]);
    const j = await importJob(tok, { fileName: "since.csv", sheets, useModel: false, previewOrgId: ORG, today: TODAY });
    const hugo = await one(`SELECT id FROM donors WHERE org_id=$1 AND email='hugo.kovac@example.test'`, [ORG]);
    const quiet = await one(`SELECT id FROM donors WHERE org_id=$1 AND email='hk3@example.test'`, [ORG]);
    // a person did something with Hugo; Steward wrote a line by itself on another
    await api("POST", `/donors/${hugo.id}/interactions`, tok, { type: "note", note: "Called about the gala", date: TODAY });
    await q(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name) VALUES ('ix_i2s_sys',$1,$2,'other','Lapsed (automatic)',$3,'system:lapse','Steward')`, [ORG, quiet.id, TODAY]);
    const pre = await api("GET", `/imports/${j.importId}/undo-preview`, tok);
    const listed = (pre.body.activitySince || []).map(p => p.id);
    ok("§3 Undo's confirm names Hugo (a note since) and not the person with only Steward's own line",
      listed.includes(hugo.id) && !listed.includes(quiet.id) && pre.body.activitySinceCount === 1, pre.body.activitySince);
    const undo = await api("POST", `/imports/${j.importId}/reverse`, tok, { alsoMove: true });
    const tr = await one(`SELECT row_data->'__why'->>'kind' AS k FROM deleted_records WHERE org_id=$1 AND record_id=$2 AND restored_at IS NULL`, [ORG, hugo.id]);
    ok("§3 choosing Move them too moves Hugo in the same undo, to the trash with why; the quiet person is gone with the rest",
      undo.status === 200 && undo.body.movedToo === 1 && !(await live(hugo.id)) && tr && tr.k === "undo_moved_too"
        && !(await one(`SELECT 1 AS x FROM donors WHERE id=$1`, [quiet.id])) && (undo.body.stayed || []).length === 0,
      { body: undo.body && undo.body.sentence, why: tr });
    const t = await api("GET", "/trash/people?q=kovac", tok);
    ok("§3 the Trash says why Hugo is there", t.body.total === 1 && /^Moved with an import undo of since\.csv, /.test(t.body.people[0].why), t.body.people);
  }

  // ── §4 Donors-45X: a person's links go with them and come back
  {
    const ORG = "org_integrity2_links";
    const tok = await freshOrg(ORG, "Integrity Two Links");
    const marlowe = await person(ORG, "d_i2l_marlowe", "Marlowe Dupe", "marlowe@example.test", [[100, "2025-01-01"]]);
    const spouse = await person(ORG, "d_i2l_spouse", "Sorrel Dupe", "sorrel@example.test");
    await q(`UPDATE donors SET kind='organisation' WHERE id IN ('d_i2l_shop','d_i2l_mill')`).catch(() => {});
    for (const [id, nm] of [["d_i2l_shop", "Dupe Hardware"], ["d_i2l_mill", "Dupe Mill"]]) {
      await q(`INSERT INTO donors (id, org_id, name, kind, created_by, created_by_name) VALUES ($1,$2,$3,'organisation','system:test','Test')`, [id, ORG, nm]);
      await api("POST", `/donors/${marlowe}/relationships`, tok, { relatedDonorId: id, relationshipType: "owner" });
    }
    await api("POST", `/donors/${marlowe}/relationships`, tok, { relatedDonorId: spouse, relationshipType: "spouse" });
    const hh = (await one(`SELECT household_id FROM donors WHERE id=$1`, [marlowe])).household_id;
    const check = await api("POST", "/donors/trash-check", tok, { ids: [marlowe] });
    ok("§4 the delete's confirm counts what goes: 1 gift, 3 links, a household", check.body.gifts === 1 && check.body.links === 3 && check.body.households === 1, check.body);
    const del = await api("DELETE", `/donors/${marlowe}`, tok);
    const shopRels = await api("GET", "/donors/d_i2l_shop/relationships", tok);
    const rows = (await one(`SELECT COUNT(*)::int AS n FROM donor_relationships WHERE org_id=$1 AND (donor_id_a=$2 OR donor_id_b=$2)`, [ORG, marlowe])).n;
    const hhNow = (await one(`SELECT household_id FROM donors WHERE id=$1`, [marlowe])).household_id;
    ok("§4 deleting Marlowe leaves no \"Owner: Marlowe Dupe\" on either business, and takes the household link",
      del.status === 200 && hh && rows === 0 && hhNow === null && shopRels.body.relationships.length === 0, { del: del.status, rows, hh, hhNow, shop: shopRels.body.relationships });
    const back = await api("POST", "/trash/people/restore", tok, { ids: [marlowe] });
    const rowsBack = (await one(`SELECT COUNT(*)::int AS n FROM donor_relationships WHERE org_id=$1 AND (donor_id_a=$2 OR donor_id_b=$2)`, [ORG, marlowe])).n;
    const hhBack = (await one(`SELECT household_id FROM donors WHERE id=$1`, [marlowe])).household_id;
    const shopBack = await api("GET", "/donors/d_i2l_shop/relationships", tok);
    ok("§4 Restore brings back all three links and the household", back.body.restored === 1 && rowsBack === 3 && hhBack === hh && shopBack.body.relationships.length === 1,
      { rowsBack, hhBack, hh, shop: shopBack.body.relationships });
    // a link left from before this build (the person trashed without it) is not shown
    await q(`UPDATE donors SET deleted_at=NOW() WHERE id=$1`, [marlowe]);
    const old = await api("GET", "/donors/d_i2l_mill/relationships", tok);
    ok("§4 an old link to someone already in the trash is not shown", old.body.relationships.length === 0, old.body.relationships);
  }

  // ── §5 Volunteers-17X: a deleted meeting takes what it made, keeps the history
  {
    const ORG = "org_integrity2_meet";
    const tok = await freshOrg(ORG, "Integrity Two Meeting");
    const vol = await person(ORG, "d_i2m_vol", "Juniper Vale", "juniper@example.test");
    const ev = "cal_i2m_1";
    await q(`INSERT INTO calendar_events (id, org_id, owner_user_id, provider, provider_event_id, title, starts_at, ends_at, person_ids, interaction_id, logged_at, created_by, created_by_name)
             VALUES ($1,$2,$3,'steward','i2m1','Coffee with Juniper', NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days' + INTERVAL '1 hour', ARRAY[$4], 'ix_i2m_meet', NOW(), $3, 'Wren Tester')`, [ev, ORG, "u_" + ORG, vol]);
    await q(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name,metadata) VALUES
             ('ix_i2m_meet',$1,$2,'meeting','Coffee with Juniper',$3,$4,'Wren Tester',jsonb_build_object('calendar_event_id',$5::text)),
             ('ix_i2m_note',$1,$2,'note','Meeting booked for Fri 6 Nov',$3,'system:meetings','Meetings',jsonb_build_object('calendar_event_id',$5::text))`, [ORG, vol, TODAY, "u_" + ORG, ev]);
    await q(`INSERT INTO tasks (id,org_id,title,due,type,done,donor_id,created_by,created_by_name,calendar_event_id) VALUES
             ('task_i2m_prep',$1,'Prep for Juniper: read the brief',$2,'meeting_prep',1,$3,'system:meetings','Meetings',$4),
             ('task_i2m_after',$1,'How did it go with Juniper?',$2,'meeting_after',0,$3,'system:meetings','Meetings',$4)`, [ORG, TODAY, vol, ev]);
    const del = await api("DELETE", "/interactions/ix_i2m_meet", tok);
    const after = await one(`SELECT voided_reason FROM tasks WHERE id='task_i2m_after'`);
    const prep = await one(`SELECT title, voided_at FROM tasks WHERE id='task_i2m_prep'`);
    const note = await one(`SELECT note FROM interactions WHERE id='ix_i2m_note'`);
    const evNow = await one(`SELECT dismissed_at FROM calendar_events WHERE id=$1`, [ev]);
    ok("§5 deleting the meeting voids its open \"How did it go\" task and stops the prompt; the Done task and the note stay, labelled",
      del.status === 200 && after.voided_reason === "meeting_deleted" && evNow.dismissed_at && !prep.voided_at
        && /\(from a deleted meeting\)$/.test(prep.title) && /\(from a deleted meeting\)$/.test(note.note), { del: del.status, after, prep, note, evNow });
    const undo = await api("POST", `/deleted-records/${del.body.undoId}/restore`, tok);
    const after2 = await one(`SELECT voided_at FROM tasks WHERE id='task_i2m_after'`);
    const prep2 = await one(`SELECT title FROM tasks WHERE id='task_i2m_prep'`);
    const ev2 = await one(`SELECT dismissed_at FROM calendar_events WHERE id=$1`, [ev]);
    ok("§5 Undo puts the meeting, its task, its prompt and the labels back as they were",
      undo.status === 200 && !after2.voided_at && prep2.title === "Prep for Juniper: read the brief" && !ev2.dismissed_at, { undo: undo.status, after2, prep2, ev2 });
  }

  // ── §6 Prod-04: Where does N come from?
  {
    const ORG = "org_integrity2_count";
    const tok = await freshOrg(ORG, "Integrity Two Count");
    await person(ORG, "d_i2c_1", "Donor One", "d1@example.test");
    await q(`INSERT INTO donors (id, org_id, name, person_types, created_by, created_by_name) VALUES ('d_i2c_2',$1,'Volunteer Two','["volunteer"]'::jsonb,'system:test','Test'),
             ('d_i2c_3',$1,'Trashed Three','["donor"]'::jsonb,'system:test','Test')`, [ORG]);
    await api("POST", "/donors/bulk-delete", tok, { ids: ["d_i2c_3"], count: 1 });
    const b = (await api("GET", "/people/everyone-breakdown", tok)).body;
    const contacts = b.parts.find(p => p.key === "contacts");
    ok("§6 the breakdown adds up to Everyone (1 donor + 1 volunteer = 2), and the one in the trash is listed as not counted",
      b.everyone === 2 && b.parts.reduce((s, p) => s + p.n, 0) === 2 && contacts.parts.reduce((s, p) => s + p.n, 0) === contacts.n
        && b.notCounted.trash === 1 && b.newest.length === 2, b);
  }

  // ── §7 browser: Delete asks first; Trash, Restore one
  {
    const why = (() => {
      if (!fs.existsSync(path.join(DIST, "assets"))) return "client/dist not built";
      const apiHost = BASE.replace(/^https?:\/\//, "");
      const js = fs.readdirSync(path.join(DIST, "assets")).filter(f => f.endsWith(".js"));
      if (!js.some(f => fs.readFileSync(path.join(DIST, "assets", f), "utf8").includes(apiHost))) return "client/dist not built against the local API";
      try { require(PW); } catch { return "Playwright not found (set PLAYWRIGHT_DIR)"; }
      return null;
    })();
    if (!browserLegOrSkip(why, "§7 (browser leg)")) {
      const ORG = "org_integrity2_click";
      await freshOrg(ORG, "Integrity Two Click");
      const ada = await person(ORG, "d_i2k_ada", "Ada Thornfield", "ada@example.test", [[250, "2025-03-03"]]);
      await person(ORG, "d_i2k_bo", "Bo Larkspur", "bo@example.test");
      const lg = await api("POST", "/auth/login", null, { email: `${ORG}@test.local`, password: PASSWORD });
      const { chromium } = require(PW);
      const browser = await chromium.launch();
      try {
        const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        await ctx.addInitScript(([tk, u, o]) => { localStorage.setItem("npe_token", tk); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
          [lg.body.token, JSON.stringify(lg.body.user), JSON.stringify(lg.body.org)]);
        const page = await ctx.newPage();
        const deletes = [];
        page.on("request", r => { if (r.method() === "DELETE" && /\/donors\//.test(r.url())) deletes.push(r.url()); });
        await page.goto(`${APP}/donors/${ada}`, { waitUntil: "networkidle", timeout: 60000 });
        await page.locator('[data-testid="dp-more"]').first().click({ timeout: 30000 });
        await page.locator('[data-testid="dp-delete"]').click({ timeout: 10000 });
        await page.waitForSelector('[data-testid="delete-person-yes"]:not([disabled])', { timeout: 15000 });
        const said = await page.locator('[data-testid="delete-person-what"]').innerText();
        const stillLive = await live(ada);
        ok("§7 Delete on a profile asks first, naming her gift, and nothing is deleted until she confirms",
          /1 gift/.test(said) && deletes.length === 0 && stillLive, { said, deletes });
        await page.locator('[data-testid="delete-person-yes"]').click();
        await page.waitForTimeout(1500);
        ok("§7 confirming moves her to the trash", deletes.length === 1 && !(await live(ada)), { deletes });
        await page.goto(`${APP}/app/settings?section=trash`, { waitUntil: "networkidle", timeout: 60000 });   // FLOWS-4: the Trash is its own section
        await page.locator('[data-testid="trash-search"]').fill("Thornfield");
        await page.waitForTimeout(800);
        const rows = await page.locator('[data-testid="trash-row"]').count();
        const rowText = rows ? await page.locator('[data-testid="trash-row"]').first().innerText() : "";
        await page.locator('[data-testid="trash-restore"]').first().click();
        await page.waitForSelector('[data-testid="trash-restored"]', { timeout: 15000 });
        const done = await page.locator('[data-testid="trash-restored"]').innerText();
        ok("§7 Settings, Trash: search finds her with who and why, and Restore brings her back",
          rows === 1 && /Deleted from their record/.test(rowText) && /by Wren Tester/.test(rowText) && /Ada Thornfield is back/.test(done) && await live(ada),
          { rows, rowText, done });
      } finally { await browser.close(); }
    }
  }

  clearTimeout(deadline);
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch { /* closing */ } process.exit(1); });
