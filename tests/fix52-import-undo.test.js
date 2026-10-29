// tests/fix52-import-undo.test.js: FIX-52. IMPORT UNDO, HONEST RECEIPTS, NO
// TIMEOUTS. The build's one new test (it guards donor data: an import that
// went wrong must come back out, whole).
//
// 27 Oct: a real event workbook (people, gifts, a "Check these" notes sheet)
// was imported on prod. The page waited two minutes and went back to the start
// three times while one import committed; its receipt said "Does not reconcile"
// (the 43 unpaid rows went in as pledges and the receipt did not count them)
// and had no Undo. The preview counted the notes sheet as people, every person
// was a Prospect, and deleting the people left them in other counts. The
// fixture is fake, in the same shape: tests/fixtures/import/fix52/make.cjs
// writes it and its answer key, never from the reader.
//
//   §1 the preview: 443 people, 422 invited, 230 RSVP'd, 172 attended, the
//      sheet's own figures, and "Check these" is notes, not people or fields.
//   §2 Import twice at once: one job, one import, one receipt; under 20 s.
//   §3 the receipt reconciles (gifts + pledges + set aside + errored), offers
//      Undo, and gifts + pledges = the Gifts sheet to the cent.
//   §4 stage follows role: gave → Ongoing care (steward), only pledged → Solicit.
//   §5 a request dropped mid-write: the job is still there, then the receipt.
//   §6 delete every imported person: Home, onboarding, Events, Fundraising,
//      search and Ask no longer show them or count their money.
//   §7 Undo from the receipt after the deletes: the org is its pre-import
//      snapshot, the three people already here exactly as they were.
//   §8 an import whose receipt does not reconcile still undoes.
//   §9 a job that fails partway rolls back whole and says why.
//   §10 HARDEN-2: twenty requests at once for one preview (the same click,
//      retries, the API's waiting call, and two that reached the server with
//      no file, as a tab closed mid-send did on CI): one job, one receipt, the
//      file's counts to the cent. Then a failed first run and twenty retries
//      at once: it runs again exactly once.
//
// HOW IT GOES RED ON MAIN: the commit takes no background job (no 202, no
// /sheet-import/jobs), the preview counts 465 records and 440 invited and
// keeps "What to check" as a field, "Not yet paid" rows are gifts, the
// receipt's Undo is absent (canUndo), and an undo after the deletes leaves
// event, attendance and household rows behind.
//
// Standard scratch stack (tests/README.md). Sends nothing.
"use strict";
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, BASE } = require("./helpers");
// IMPORT-5: an event file with no dates is answered: the day, gifts left "No date", pledges due from the event's date
const IMPORT5_DATES = { eventDate: "2026-10-22", useEventDate: false, pledgeDue: "event" };
const { assertSurfacesAgree } = require("./lib/surfacesAgree");   // HARDEN-1
async function surfacesAgree(label, orgId, token) {
  const r = await assertSurfacesAgree(orgId, { token, soft: true, label });
  ok(`every surface agrees ${label} (${r.ms}ms)`, r.ok, r.diffs.length);
  for (const d of r.diffs) console.log("        " + d);
}

const { testNow } = require("./clock");

const XLSX = require(path.join(__dirname, "..", "client", "node_modules", "xlsx"));
const FX = path.join(__dirname, "fixtures", "import", "fix52");
const E = JSON.parse(fs.readFileSync(path.join(FX, "expected.json"), "utf8"));
const PASSWORD = "loadtest1234";
const TABLES = ["data_health_runs", "event_attendees", "email_suppressions", "pledge_installments", "pledges", "thank_you_drafts", "interactions", "gifts", "events",
  "fin_transactions", "imports", "sheet_import_jobs", "donor_scores", "readouts", "tasks", "cultivation_plans", "deleted_records", "donors", "households",
  "custom_field_defs", "fin_funds", "budgets", "accounts", "users"];
const SNAP = ["donors", "households", "gifts", "pledges", "pledge_installments", "events", "event_attendees", "interactions", "email_suppressions",
  "custom_field_defs", "fin_funds", "fin_transactions", "tasks", "cultivation_plans", "thank_you_drafts"];
const SNAP_SKIP = new Set(["updated_at", "last_scored_at", "score_updated_at", "engagement_updated_at"]);

let R = null;
async function sheetsOf(file) {
  R = R || await import("../shared/sheetRead.js");
  return R.gridsFromWorkbook(XLSX.read(fs.readFileSync(file), { type: "buffer", cellDates: true }), XLSX);
}
async function freshOrg(id, name) {
  for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [id]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [id]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,'active','team')`, [id, name, id.replace(/_/g, "-")]);
  const email = `${id}@test.local`;
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Allie Test','admin')`, ["u_" + id, id, email, bcrypt.hashSync(PASSWORD, 4)]);
  return login(email, PASSWORD);
}
const one = async (sql, args) => (await q(sql, args))[0];
const centsOf = v => Math.round(Number(v || 0) * 100);
async function snapshot(org) {
  const out = {};
  for (const t of SNAP) {
    const rows = await q(`SELECT * FROM ${t} WHERE org_id=$1 ORDER BY id`, [org]).catch(() => []);
    // setup every org gets with its first gift (the unrestricted fund), never import data
    out[t] = rows.filter(r => !(t === "fin_funds" && r.description === "General unrestricted operating fund"))
      .map(r => JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => !SNAP_SKIP.has(k)).sort())));
  }
  return out;
}
function snapDiff(a, b) {
  const diffs = [];
  for (const t of Object.keys(a)) {
    const byId = list => new Map(list.map(x => { const o = JSON.parse(x); return [o.id, o]; }));
    const A = byId(a[t]), B = byId(b[t]);
    const gone = [...A.keys()].filter(k => !B.has(k)), extra = [...B.keys()].filter(k => !A.has(k));
    const moved = [...A.keys()].filter(k => B.has(k)).map(k => [k, Object.keys(A.get(k)).filter(c => JSON.stringify(A.get(k)[c]) !== JSON.stringify(B.get(k)[c]))]).filter(([, cs]) => cs.length);
    if (gone.length || extra.length || moved.length) diffs.push(`${t}: ${gone.length} gone, ${extra.length} left behind${extra.length ? " (" + JSON.stringify(B.get(extra[0])).slice(0, 160) + ")" : ""}`
      + (moved.length ? `, changed ${moved.map(([k, cs]) => `${k}[${cs.map(c => `${c}: ${JSON.stringify(A.get(k)[c])} → ${JSON.stringify(B.get(k)[c])}`).join(", ")}]`).join(" ").slice(0, 600)}` : ""));
  }
  return diffs;
}
// The modal's way in: start the job, then read its state until it ends.
async function importJob(tok, body) {
  const r = await api("POST", "/sheet-import/commit", tok, { ...body, background: true });
  if (r.status === 201) return { start: r, end: { status: "done", result: r.body } };   // main: no job, the request held the write
  if (r.status !== 202) return { start: r, end: null };
  return { start: r, end: await jobEnd(tok, r.body.importId) };
}
async function jobEnd(tok, id, ms = 60000) {
  const t0 = performance.now();
  for (;;) {
    const j = await api("GET", `/sheet-import/jobs/${encodeURIComponent(id)}`, tok);
    if (j.status === 200 && j.body.status !== "running") return j.body;
    if (performance.now() - t0 > ms) return { status: "timeout", last: j.body };
    await new Promise(res => setTimeout(res, 150));
  }
}

async function main() {
  const ORG = "org_fix52a";
  const tok = await freshOrg(ORG, "Harbor Lights (test)");
  // three of the file's people are already here (by ID, by email, by name), and two who are not in it
  const sheets = await sheetsOf(path.join(FX, "event-workbook-shape.xlsx"));
  const peopleRows = sheets.find(s => s.name === "People").grid.slice(8);
  const row = id => peopleRows.find(r => r[0] === id);
  const r5 = row("HL-2005"), r6 = row("HL-2006"), r7 = row("HL-2007");
  await q(`INSERT INTO donors (id,org_id,name,email,phone,external_donor_id,stage,status,tags,person_types,custom_fields,created_by,created_by_name) VALUES
           ('d_f52_byid',$1,'Someone Renamed',NULL,NULL,'HL-2005','cultivate','active','["Gala 2025"]','["donor"]',NULL,'system:test','test'),
           ('d_f52_bymail',$1,$2,$3,NULL,NULL,'qualify','active','[]','["volunteer"]','{"shoe":"9"}','system:test','test'),
           ('d_f52_byname',$1,$4,NULL,NULL,NULL,'prospect','active','[]','["other"]',NULL,'system:test','test'),
           ('d_f52_other1',$1,'Unrelated Person','unrelated@example.org',NULL,NULL,'steward','active','[]','["donor"]',NULL,'system:test','test'),
           ('d_f52_other2',$1,'Second Unrelated',NULL,'(555) 000-1111',NULL,'prospect','active','[]','["other"]',NULL,'system:test','test')`,
    [ORG, String(r6[1]), String(r6[2]), String(r7[1])]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign,notes,payment_method,created_by,created_by_name)
           VALUES ('g_f52_other',$1,'d_f52_other1',500,'2026-03-01','cash','','','Check','system:test','test')`, [ORG]);
  await q(`UPDATE donors SET total_giving=500, last_gift_date='2026-03-01' WHERE id='d_f52_other1'`);
  const before = await snapshot(ORG);
  const body = { fileName: E.file, sheets, answers: IMPORT5_DATES };

  // §1 the preview
  const u = await api("POST", "/sheet-import/understand", tok, body);
  const U = u.body || {}, c = U.counts || {};
  ok("§1 understand answers 200, ready", u.status === 200 && U.ready === true, u.status + " " + JSON.stringify((U.questions || []).filter(x => !x.optional)).slice(0, 300));
  const rec = { people: c.records, invited: c.invitedRecords, rsvp: c.rsvpRecords, attended: c.attendedRecords };
  ok(`§1 the preview counts ${E.people} people, ${E.invited} invited, ${E.rsvp} RSVP'd, ${E.attended} attended, as the sheet says`,
     rec.people === E.people && rec.invited === E.invited && rec.rsvp === E.rsvp && rec.attended === E.attended, JSON.stringify({ rec, persons: c.persons, invited: c.invited }));
  const checks = U.figureChecks || [];
  ok("§1 each of the sheet's own figures is checked, and agrees", checks.length === 4 && checks.every(x => x.agrees), JSON.stringify(checks));
  const notes = (U.notesSheets || []).find(x => x.sheet === "Check these");
  ok("§1 \"Check these\" is recognised as notes about people already on the list, not imported",
     !!notes && /Sheet 'Check these' looks like notes about people already on the list\. Not imported\./.test(notes.sentence || ""), JSON.stringify(U.notesSheets));
  ok("§1 the notes columns do not become custom fields", !(U.keptHeaders || []).some(k => E.notesColumns.includes(k.header)), JSON.stringify(U.keptHeaders));
  ok(`§1 ${E.gifts} gifts ${E.giftCents / 100} and ${E.pledges} pledges ${E.pledgeCents / 100} from the Gifts sheet`,
     c.gifts === E.gifts && c.giftCents === E.giftCents && c.pledges === E.pledges && c.pledgeCents === E.pledgeCents, JSON.stringify({ g: c.gifts, gc: c.giftCents, p: c.pledges, pc: c.pledgeCents }));
  const anyway = await api("POST", "/sheet-import/understand", tok, { ...body, answers: { notesSheets: ["Check these"] } });
  ok("§1 \"Import it anyway\" reads the notes sheet after all", anyway.status === 200 && (anyway.body.keptHeaders || []).some(k => k.header === "What to check"), JSON.stringify((anyway.body || {}).keptHeaders));

  // §2 Import, clicked twice at once
  const RUN = "imp_fix52_main";
  const t0 = performance.now();
  const [a, b] = await Promise.all([
    api("POST", "/sheet-import/commit", tok, { ...body, importId: RUN, background: true }),
    api("POST", "/sheet-import/commit", tok, { ...body, importId: RUN, background: true }),
  ]);
  ok("§2 Import starts a job and returns at once (202), both clicks the same job", a.status === 202 && b.status === 202 && a.body.importId === RUN && b.body.importId === RUN,
     JSON.stringify([a.status, a.body, b.status, b.body]).slice(0, 400));
  const end = await jobEnd(tok, RUN);
  const ms = performance.now() - t0;
  ok("§2 the job ends done, with its receipt", end.status === "done" && end.result && end.result.importId === RUN, JSON.stringify(end).slice(0, 400));
  ok(`§2 the import commits in under 20 seconds (${ms} ms)`, ms < 20000, ms);
  await surfacesAgree("after the workbook import", ORG, tok);
  const runs = await q("SELECT id FROM imports WHERE org_id=$1", [ORG]);
  const jobs = await q("SELECT id FROM sheet_import_jobs WHERE org_id=$1", [ORG]);
  ok("§2 two clicks at once: one import, one job", runs.length === 1 && jobs.length === 1, JSON.stringify({ runs, jobs }));
  // the browser lost the answer and asks again under the same run id: the
  // same job and its receipt come back, and nothing is written twice
  const retry = await api("POST", "/sheet-import/commit", tok, { ...body, importId: RUN, background: true });
  ok("§2 a retry after it finished is the same job, never a second write", retry.status === 202 && retry.body.status === "done" && retry.body.importId === RUN
     && (await q("SELECT id FROM imports WHERE org_id=$1", [ORG])).length === 1
     && (await one("SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1 AND import_id IS NOT NULL", [ORG])).n === E.gifts,
     JSON.stringify([retry.status, retry.body && retry.body.status]).slice(0, 300));

  // §3 the receipt
  const g = await one("SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0)::numeric AS s FROM gifts WHERE org_id=$1 AND import_id=$2", [ORG, RUN]);
  const pl = await one("SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0)::numeric AS s FROM pledges WHERE org_id=$1 AND import_id=$2", [ORG, RUN]);
  ok(`§3 ${E.gifts} gifts (${E.giftCents / 100}) and ${E.pledges} pledges (${E.pledgeCents / 100}), each for its own row`,
     g.n === E.gifts && centsOf(g.s) === E.giftCents && pl.n === E.pledges && centsOf(pl.s) === E.pledgeCents, JSON.stringify({ g, pl }));
  ok("§3 gifts received + pledges open = the Gifts sheet's total, to the cent", centsOf(g.s) + centsOf(pl.s) === E.fileCents, centsOf(g.s) + centsOf(pl.s));
  const rc = (await api("GET", `/imports/${RUN}`, tok)).body.import || {};
  ok("§3 the receipt reconciles", rc.reconciled === true, JSON.stringify(rc.findings));
  ok("§3 rows = gifts + pledges + set aside + errored", rc.rowsIn === rc.giftsCreated + (rc.pledgesCreated || 0) + rc.rowsSetAside + rc.rowsErrored && rc.pledgesCreated === E.pledges,
     JSON.stringify([rc.rowsIn, rc.giftsCreated, rc.pledgesCreated, rc.rowsSetAside, rc.rowsErrored]));
  ok("§3 dollars = gifts + pledges + set aside + errored", centsOf(rc.dollarsIn) === centsOf(rc.dollarsCreated) + centsOf(rc.pledgeDollarsCreated), JSON.stringify([rc.dollarsIn, rc.dollarsCreated, rc.pledgeDollarsCreated]));
  ok("§3 the receipt offers Undo, for 30 days", rc.canUndo === true && rc.undoUntil && (new Date(rc.undoUntil) - testNow()) > 29 * 86400e3, JSON.stringify([rc.canUndo, rc.undoUntil]));
  const list = (await api("GET", "/imports", tok)).body.imports || [];
  ok("§3 the Imports list shows it done, reconciled", list.some(x => x.id === RUN && x.reconciled && x.state === "done"), JSON.stringify(list.map(x => [x.id, x.state, x.reconciled])));

  // §4 stage follows role
  const st = await q(`SELECT external_donor_id AS x, stage FROM donors WHERE org_id=$1 AND created_import_id=$2`, [ORG, RUN]);
  const stageOf = new Map(st.map(r => [r.x, r.stage]));
  const giverStages = E.donorIds.filter(x => stageOf.has(x)).map(x => stageOf.get(x));
  const pledgerStages = E.pledgerOnlyIds.filter(x => stageOf.has(x)).map(x => stageOf.get(x));
  ok("§4 every new person with a received gift is at Ongoing care (steward)", giverStages.length > 40 && giverStages.every(s => s === "steward"), JSON.stringify([...new Set(giverStages)]));
  ok("§4 every new person with only an open pledge is at Solicit", pledgerStages.length > 20 && pledgerStages.every(s => s === "solicit"), JSON.stringify([...new Set(pledgerStages)]));
  // a couple's second member has no ID of their own and shares the household's stage
  ok("§4 nobody else is moved past Prospect", st.filter(r => r.x && !E.donorIds.includes(r.x) && !E.pledgerOnlyIds.includes(r.x)).every(r => r.stage === "prospect"),
     JSON.stringify(st.filter(r => r.x && !E.donorIds.includes(r.x) && !E.pledgerOnlyIds.includes(r.x) && r.stage !== "prospect").slice(0, 5)));
  const dl = await api("GET", `/donors?search=${encodeURIComponent(String(row("HL-2010")[1]))}`, tok);
  const dlRows = Array.isArray(dl.body) ? dl.body : (dl.body.donors || []);
  ok("§4 the Donors list shows a giver's stage as steward", dlRows.some(d => d.stage === "steward"), JSON.stringify(dlRows.map(d => [d.name, d.stage])));

  // §6 delete every person the import made, from the Donors page
  const made = (await q("SELECT id FROM donors WHERE org_id=$1 AND created_import_id=$2", [ORG, RUN])).map(r => r.id);
  const evId = (await one("SELECT id FROM events WHERE org_id=$1 AND import_id=$2", [ORG, RUN]) || {}).id;
  for (let k = 0; k < made.length; k += 200) {
    const del = await api("POST", "/donors/bulk-delete", tok, { ids: made.slice(k, k + 200) });
    if (del.status !== 200) { ok("§6 bulk delete answers 200", false, del.status + " " + JSON.stringify(del.body)); break; }
  }
  await surfacesAgree("after deleting everyone the import made", ORG, tok);
  // what is still here: the five people who were here before, and the gifts and
  // attendance of the three of them the file named (they were not deleted)
  const live = await one(`SELECT (SELECT COUNT(*)::int FROM gifts g JOIN donors d ON d.id=g.donor_id WHERE g.org_id=$1 AND d.deleted_at IS NULL) AS gifts,
                                 (SELECT COUNT(*)::int FROM event_attendees a JOIN donors d ON d.id=a.donor_id WHERE a.event_id=$2 AND d.deleted_at IS NULL AND a.status='attended') AS attended,
                                 (SELECT COUNT(*)::int FROM event_attendees a JOIN donors d ON d.id=a.donor_id WHERE a.event_id=$2 AND d.deleted_at IS NULL) AS listed`, [ORG, evId]);
  const setup = (await api("GET", "/org/setup-status", tok)).body || {};
  const dItem = (setup.items || []).find(i => i.key === "donors") || {};
  ok("§6 onboarding counts only the people still here, and their gifts", dItem.count === 5 && dItem.giftCount === live.gifts, JSON.stringify([dItem, live]));
  const mv = (await api("GET", "/move", tok)).body || {};
  ok("§6 Home's file line no longer counts the deleted people or their gifts", !new RegExp(`\\b${made.length}\\b|${E.gifts} gifts`).test(JSON.stringify(mv.homeLine || "")), JSON.stringify(mv.homeLine));
  const evs = (await api("GET", "/events", tok)).body;
  const evRow = (Array.isArray(evs) ? evs : (evs.events || [])).find(e => e.id === evId) || {};
  const liveRaised = await one(`SELECT COALESCE(SUM(g.amount),0)::numeric AS s FROM gifts g JOIN donors d ON d.id=g.donor_id WHERE g.event_id=$1 AND d.deleted_at IS NULL`, [evId]);
  ok("§6 Events counts no deleted guest and none of their money", Number(evRow.attendee_count) === live.attended && centsOf(evRow.raised) === centsOf(liveRaised.s) && live.attended < E.attended,
     JSON.stringify([evRow.attendee_count, evRow.raised, live, liveRaised]));
  const evd = (await api("GET", `/events/${evId}`, tok)).body || {};
  ok("§6 the event's own page lists no deleted guest", (evd.attendees || []).length === live.listed, [(evd.attendees || []).length, live.listed]);
  const fr = (await api("GET", "/fundraising/campaigns", tok)).body;
  ok("§6 Fundraising counts no deleted person's pledge", !JSON.stringify(fr).includes(String(E.pledgeCents / 100)), JSON.stringify(fr).slice(0, 300));
  const home = (await api("GET", "/dashboard/home", tok)).body;
  ok("§6 Home counts no deleted person's money", !JSON.stringify(home).includes(String(E.giftCents / 100)), JSON.stringify(home).slice(0, 300));
  const srch = (await api("GET", `/search?q=${encodeURIComponent(String(row("HL-2010")[1]))}`, tok)).body;
  ok("§6 search finds no deleted person", !JSON.stringify(srch.results || srch.groups || []).includes(String(row("HL-2010")[1])), JSON.stringify(srch).slice(0, 300));
  const ask = await api("POST", "/ask", tok, { question: "How many donors do we have?" });
  ok("§6 Ask counts only the people still here", ask.status !== 200 || !JSON.stringify(ask.body).includes(String(made.length)), JSON.stringify(ask.body).slice(0, 300));

  // §7 Undo from the receipt, after the deletes
  const un = await api("POST", `/imports/${RUN}/reverse`, tok, {});
  ok("§7 undo answers 200 and says how many were already deleted", un.status === 200 && un.body.alreadyDeleted === made.length && /already deleted/.test(un.body.sentence || ""),
     un.status + " " + JSON.stringify(un.body));
  const after = await snapshot(ORG);
  const diff = snapDiff(before, after);
  ok("§7 the org matches its pre-import snapshot, the people already here exactly as they were", diff.length === 0, diff.join("\n"));
  await surfacesAgree("after the undo", ORG, tok);
  const rc2 = (await api("GET", `/imports/${RUN}`, tok)).body.import || {};
  ok("§7 the receipt says it was undone, and offers Undo no more", rc2.canUndo === false && !!rc2.reversedAt, JSON.stringify([rc2.canUndo, rc2.reversedAt]));
}

// §5 a dropped request, and §8 an import that does not reconcile
async function dropped() {
  const ORG = "org_fix52b";
  const tok = await freshOrg(ORG, "Harbor Lights B (test)");
  const before = await snapshot(ORG);
  const body = { fileName: E.file, sheets: await sheetsOf(path.join(FX, "event-workbook-shape.xlsx")), answers: IMPORT5_DATES };
  const RUN = "imp_fix52_drop";
  const ac = new AbortController();
  const req = fetch(BASE + "/sheet-import/commit", { method: "POST", signal: ac.signal,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok }, body: JSON.stringify({ ...body, importId: RUN }) }).catch(e => ({ aborted: e.name }));
  await new Promise(res => setTimeout(res, 120));
  ac.abort();
  const gone = await req;
  ok("§5 the browser lost the request", gone && gone.aborted === "AbortError", JSON.stringify(gone && gone.status));
  const seen = await api("GET", "/sheet-import/jobs?running=1", tok);
  const listed = (await api("GET", "/imports", tok)).body.imports || [];
  ok("§5 reopening Import or the Imports list shows the job, never an empty screen",
     (seen.status === 200 && (seen.body.jobs || []).some(j => j.id === RUN)) || listed.some(x => x.id === RUN), JSON.stringify([seen.status, seen.body, listed.map(x => [x.id, x.state])]).slice(0, 300));
  const end = await jobEnd(tok, RUN);
  ok("§5 the job ends done with the receipt", end.status === "done" && end.result && end.result.giftsCreated === E.gifts, JSON.stringify(end).slice(0, 300));
  ok("§5 one import", (await q("SELECT id FROM imports WHERE org_id=$1", [ORG])).length === 1);

  // §8 the 27 Oct receipt: its rows did not reconcile. A dropped row shows it, and Undo still works.
  await q("UPDATE imports SET rows_in = rows_in + 1 WHERE id=$1", [RUN]);
  const rc = (await api("GET", `/imports/${RUN}`, tok)).body.import || {};
  ok("§8 a deliberately dropped row still shows \"Does not reconcile\"", rc.reconciled === false && /Rows do not reconcile/.test((rc.findings || []).join(" ")), JSON.stringify(rc.findings));
  ok("§8 and the receipt still offers Undo", rc.canUndo === true, rc.canUndo);
  const un = await api("POST", `/imports/${RUN}/reverse`, tok, {});
  ok("§8 undo answers 200", un.status === 200, un.status + " " + JSON.stringify(un.body));
  const diff = snapDiff(before, await snapshot(ORG));
  ok("§8 the org is exactly as before", diff.length === 0, diff.join("\n"));
  await surfacesAgree("after the undo of a dropped request", ORG, tok);
}

// §9 a job that fails partway: a trigger on the scratch database refuses the
// first gift for this org, after people, the event and the pledges were
// written. Nothing may remain, and the job says why.
async function failsPartway() {
  const ORG = "org_fix52c";
  const tok = await freshOrg(ORG, "Harbor Lights C (test)");
  const before = await snapshot(ORG);
  await q(`CREATE OR REPLACE FUNCTION fix52_refuse_gift() RETURNS trigger AS $$ BEGIN
             IF NEW.org_id = 'org_fix52c' THEN RAISE EXCEPTION 'fix52 planted failure'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
  await q(`DROP TRIGGER IF EXISTS fix52_refuse_gift ON gifts`);
  await q(`CREATE TRIGGER fix52_refuse_gift BEFORE INSERT ON gifts FOR EACH ROW EXECUTE FUNCTION fix52_refuse_gift()`);
  try {
    const r = await importJob(tok, { fileName: E.file, sheets: await sheetsOf(path.join(FX, "event-workbook-shape.xlsx")), answers: IMPORT5_DATES, importId: "imp_fix52_fail" });
    ok("§9 a job that fails partway ends \"Not imported\", saying it was rolled back", r.end && r.end.status === "failed" && /Not imported\..*rolled back.*Nothing was written/.test(r.end.sentence || ""),
       JSON.stringify(r.end).slice(0, 300));
    const diff = snapDiff(before, await snapshot(ORG));
    ok("§9 and nothing it wrote before the failure remains: no people, event, pledges or attendance", diff.length === 0, diff.join("\n"));
    ok("§9 no receipt is recorded", (await q("SELECT id FROM imports WHERE org_id=$1", [ORG])).length === 0);
    const listed = (await api("GET", "/imports", tok)).body.imports || [];
    ok("§9 the Imports list says it was not imported", listed.some(x => x.id === "imp_fix52_fail" && x.state === "failed"), JSON.stringify(listed.map(x => [x.id, x.state])));
  } finally {
    await q(`DROP TRIGGER IF EXISTS fix52_refuse_gift ON gifts`);
    await q(`DROP FUNCTION IF EXISTS fix52_refuse_gift()`);
  }
}

// §10 HARDEN-2 · ONE PREVIEW IS ONE JOB, HOWEVER MANY TIMES IT ARRIVES. On CI
// the breaker's closed tab left a second, failed job: the browser sent the
// commit again as the tab went, the connection was gone before the body was
// read, and the server started a job for a request that carried no file.
const commitNoFile = tok => fetch(BASE + "/sheet-import/commit", { method: "POST",
  headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok } }).then(r => ({ status: r.status })).catch(e => ({ status: 0, e: e.message }));
async function fileCounts(org, run) {
  return one(`SELECT (SELECT COUNT(*)::int FROM gifts WHERE org_id=$1 AND import_id=$2) AS gifts,
                     (SELECT COALESCE(SUM(ROUND(amount*100)),0)::bigint FROM gifts WHERE org_id=$1 AND import_id=$2) AS "giftCents",
                     (SELECT COUNT(*)::int FROM pledges WHERE org_id=$1 AND import_id=$2) AS pledges,
                     (SELECT COALESCE(SUM(ROUND(amount*100)),0)::bigint FROM pledges WHERE org_id=$1 AND import_id=$2) AS "pledgeCents",
                     (SELECT COUNT(*)::int FROM donors WHERE org_id=$1 AND deleted_at IS NULL) AS people,
                     (SELECT COUNT(*)::int FROM imports WHERE org_id=$1) AS receipts,
                     (SELECT COUNT(*)::int FROM sheet_import_jobs WHERE org_id=$1) AS jobs`, [org, run]);
}
async function twentyAtOnce(ORG, RUN, tok, body) {
  const asks = Array.from({ length: 20 }, (_, i) =>
    i === 7 || i === 13 ? commitNoFile(tok)                                                     // the tab closed as it was sent
    : i % 6 === 5 ? api("POST", "/sheet-import/commit", tok, { ...body, importId: RUN })        // a caller that waits for the receipt
    : api("POST", "/sheet-import/commit", tok, { ...body, importId: RUN, background: true }));   // the click, again and again
  const out = await Promise.all(asks);
  const withFile = out.filter((_, i) => i !== 7 && i !== 13), noFile = [out[7], out[13]];
  return { out, withFile, noFile, end: await jobEnd(tok, RUN) };
}
async function manyAtOnce() {
  const ORG = "org_fix52d";
  const tok = await freshOrg(ORG, "Harbor Lights D (test)");
  const body = { fileName: E.file, sheets: await sheetsOf(path.join(FX, "event-workbook-shape.xlsx")), answers: IMPORT5_DATES };
  const RUN = "imp_fix52_many";
  const r = await twentyAtOnce(ORG, RUN, tok, body);
  ok("§10 twenty requests at once for one preview: every one that carried the file answers the same job",
     r.withFile.every(x => (x.status === 202 || x.status === 201) && x.body && x.body.importId === RUN), JSON.stringify(r.withFile.map(x => [x.status, x.body && x.body.importId])).slice(0, 400));
  ok("§10 a request that reached the server with no file starts nothing (400)", r.noFile.every(x => x.status === 400), JSON.stringify(r.noFile));
  ok("§10 the job ends done, with its receipt", r.end.status === "done" && r.end.result && r.end.result.importId === RUN, JSON.stringify(r.end).slice(0, 300));
  await new Promise(res => setTimeout(res, 500));   // a straggler has time to land
  const c = await fileCounts(ORG, RUN);
  ok("§10 one job and one receipt", c.jobs === 1 && c.receipts === 1, JSON.stringify(await q("SELECT id, status, error FROM sheet_import_jobs WHERE org_id=$1", [ORG])));
  ok(`§10 the file's counts: ${E.gifts} gifts, ${E.pledges} pledges, ${E.persons} people`, c.gifts === E.gifts && c.pledges === E.pledges && c.people === E.persons, JSON.stringify(c));
  ok(`§10 the money foots to the cent: gifts ${E.giftCents / 100} + pledges ${E.pledgeCents / 100} = the file's ${E.fileCents / 100}`,
     Number(c.giftCents) === E.giftCents && Number(c.pledgeCents) === E.pledgeCents && Number(c.giftCents) + Number(c.pledgeCents) === E.fileCents
     && r.end.result && r.end.result.giftCents === E.giftCents, JSON.stringify([c.giftCents, c.pledgeCents, r.end.result && r.end.result.giftCents]));
  await surfacesAgree("after twenty requests for one preview", ORG, tok);
}
// A first run that failed may be retried, and runs again exactly once, never
// twice side by side.
async function failedThenRetried() {
  const ORG = "org_fix52e";
  const tok = await freshOrg(ORG, "Harbor Lights E (test)");
  const body = { fileName: E.file, sheets: await sheetsOf(path.join(FX, "event-workbook-shape.xlsx")), answers: IMPORT5_DATES };
  const RUN = "imp_fix52_again";
  await q(`CREATE OR REPLACE FUNCTION fix52_refuse_gift_e() RETURNS trigger AS $$ BEGIN
             IF NEW.org_id = 'org_fix52e' THEN RAISE EXCEPTION 'fix52 planted failure'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
  await q(`DROP TRIGGER IF EXISTS fix52_refuse_gift_e ON gifts`);
  await q(`CREATE TRIGGER fix52_refuse_gift_e BEFORE INSERT ON gifts FOR EACH ROW EXECUTE FUNCTION fix52_refuse_gift_e()`);
  let first;
  try { first = await importJob(tok, { ...body, importId: RUN }); }
  finally { await q(`DROP TRIGGER IF EXISTS fix52_refuse_gift_e ON gifts`); await q(`DROP FUNCTION IF EXISTS fix52_refuse_gift_e()`); }
  ok("§10 the first run failed and wrote nothing", first.end && first.end.status === "failed" && (await fileCounts(ORG, RUN)).receipts === 0, JSON.stringify(first.end).slice(0, 200));
  const r = await twentyAtOnce(ORG, RUN, tok, body);
  await new Promise(res => setTimeout(res, 500));
  const c = await fileCounts(ORG, RUN);
  ok("§10 twenty retries at once after a failure: it runs again exactly once (one job, done, one receipt)",
     r.end.status === "done" && c.jobs === 1 && c.receipts === 1 && r.withFile.every(x => x.body && x.body.importId === RUN),
     JSON.stringify({ c, jobs: await q("SELECT id, status, error FROM sheet_import_jobs WHERE org_id=$1", [ORG]), answers: r.withFile.map(x => x.status) }).slice(0, 500));
  ok("§10 and the retried run's counts and money are the file's", c.gifts === E.gifts && c.pledges === E.pledges && Number(c.giftCents) === E.giftCents && Number(c.pledgeCents) === E.pledgeCents,
     JSON.stringify(c));
}

(async () => {
  try { await main(); await dropped(); await failsPartway(); await manyAtOnce(); await failedThenRetried(); }
  catch (e) { ok("suite ran without throwing", false, e.stack); }
  finally { for (const o of ["org_fix52a", "org_fix52b", "org_fix52c", "org_fix52d", "org_fix52e"]) for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
            for (const o of ["org_fix52a", "org_fix52b", "org_fix52c", "org_fix52d", "org_fix52e"]) await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {}); await closeDb(); }
  summary();
})();
