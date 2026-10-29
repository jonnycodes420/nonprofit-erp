// tests/fix59-event-import.test.js: FIX-59. ONE DINNER, THREE LISTS. Guards
// donor data and money: on a real event import (29 Oct) the seating chart's
// spellings of guests became new people, notes typed in the name column
// became people or stayed in their names, the guests with no reply were on no
// list, nobody was checked in, the tables were labels with no size, and the
// night's gifts sat in Finance as Not yet on a deposit.
//
// The fixture is tests/fixtures/import/event-patterns (fake names; make.cjs
// computes the answer key from its own rows, never from the reader).
//
//   §1 the preview: one grouped near-duplicate question (7 pairs, Same person
//      by default, never holding Import), one deposited question (Yes by
//      default), the notes read as notes, names cleaned, the event's name
//      with its apostrophe.
//   §2 the import with the defaults: 39 people; the notes on Kerry Lusk, Hugo
//      Ramsey and Ada Whitlock; Neil & Martha Lyle a household with the note;
//      the couples two people; registered 34, came 25, declined 4 from the
//      rows; 25 checked in; the tables sized to the chart; every gift and the
//      pledge on the event; no received gift left off a deposit. Undo takes
//      it all back.
//   §3 Different for one pair is one more person (40); No to deposited leaves
//      the 10 gifts for a deposit.
//
// HOW IT GOES RED ON MAIN (1c0bf5f): no near-duplicate or deposited question,
// 44 people, the parenthetical names kept, no note rows, 0 checked in, no
// event_tables, the three no-reply guests not on the event, and every gift
// undeposited after Yes.
//
// Standard scratch stack (tests/README.md). Sends nothing. The clock is not pinned.
"use strict";
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const XLSX = require(path.join(__dirname, "..", "client", "node_modules", "xlsx"));
const FX = path.join(__dirname, "fixtures", "import", "event-patterns");
const EXP = JSON.parse(fs.readFileSync(path.join(FX, "expected.json"), "utf8"));
const PASSWORD = "loadtest1234";
const EVENT_DAY = "2026-10-03";

async function freshOrg(id, name) {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 5; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [id]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [id]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,'active','team')`, [id, name, id.replace(/_/g, "-")]);
  const email = `${id}@test.local`;
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Allie Test','admin')`, ["u_" + id, id, email, bcrypt.hashSync(PASSWORD, 4)]);
  return login(email, PASSWORD);
}
const one = async (sql, args) => (await q(sql, args))[0];
async function importJob(tok, body) {
  const r = await api("POST", "/sheet-import/commit", tok, { ...body, background: true });
  if (r.status !== 202) return { start: r, end: null, importId: null };
  const t0 = performance.now();
  for (;;) {
    const j = await api("GET", `/sheet-import/jobs/${encodeURIComponent(r.body.importId)}`, tok);
    if (j.status === 200 && j.body.status !== "running") return { start: r, end: j.body, importId: r.body.importId };
    if (performance.now() - t0 > 120000) return { start: r, end: { status: "timeout" }, importId: r.body.importId };
    await new Promise(res => setTimeout(res, 150));
  }
}
const undo = (tok, id) => api("POST", `/imports/${encodeURIComponent(id)}/reverse`, tok, {});
const people = org => one(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND deleted_at IS NULL`, [org]).then(r => r.n);
const ANSWERED = { eventDate: EVENT_DAY, useEventDate: true, pledgeDue: "event" };

(async () => {
  try {
    const R = await import("../shared/sheetRead.js");
    const sheets = R.gridsFromWorkbook(XLSX.read(fs.readFileSync(path.join(FX, EXP.file)), { type: "buffer", cellDates: true }), XLSX);
    const base = { fileName: EXP.file, sheets };
    const ORG = "org_fix59_event";
    const tok = await freshOrg(ORG, "FIX-59 event (test)");

    // ── §1 the preview
    const u0 = (await api("POST", "/sheet-import/understand", tok, { ...base, answers: {} })).body || {};
    const ids0 = (u0.questions || []).map(x => x.id);
    ok("§1 the file asks the event's date, the near-duplicates once and whether the gifts were deposited",
       ids0.includes("event") && ids0.includes("nearDuplicates") && ids0.includes("giftsDeposited"), JSON.stringify(ids0));
    const u = (await api("POST", "/sheet-import/understand", tok, { ...base, answers: ANSWERED })).body || {};
    const ids = (u.questions || []).map(x => x.id);
    const near = (u.questions || []).find(x => x.id === "nearDuplicates") || {};
    const dep = (u.questions || []).find(x => x.id === "giftsDeposited") || {};
    ok("§1 answered, the questions are the answer key's (event, useEventDate, pledgeDue, nearDuplicates, giftsDeposited) and Import is ready",
       u.ready === true && ["event", "nearDuplicates", "giftsDeposited"].every(x => ids.includes(x)) && !ids.some(x => /^col:|^row:/.test(x)),
       JSON.stringify([u.ready, ids]));
    const pairs = near.pairs || [];
    const want = EXP.nearDuplicates.map(x => `${x.guestList}|${x.seatingChart}`).sort();
    const got = pairs.map(p => `${p.a}|${p.b}`).sort();
    ok(`§1 the near-duplicates are one grouped question of ${EXP.nearDuplicates.length} pairs, the answer key's, each Same person by default and not chosen`,
       near.kind === "nearDuplicates" && near.optional === true && near.default === "same" && JSON.stringify(got) === JSON.stringify(want)
       && pairs.every(p => p.answer === "same" && p.chosen === false && p.aSheet === "Guest List" && p.bSheet === "Seating Chart"),
       JSON.stringify(got));
    ok("§1 each pair asks in words: \"Is Bev Okonjo on the Seating Chart the same as Beverly Okonjo on the Guest List?\"",
       pairs.some(p => p.text === "Is Bev Okonjo on the Seating Chart the same as Beverly Okonjo on the Guest List?"), JSON.stringify(pairs.map(p => p.text)));
    ok(`§1 "Were these ${EXP.money.gifts} gifts already deposited?" Yes by default, not holding Import`,
       dep.optional === true && dep.default === "yes" && dep.count === EXP.money.gifts && dep.text === `Were these ${EXP.money.gifts} gifts already deposited?`
       && (dep.options || []).map(o => o.label).join("|") === "Yes|No, I still need to deposit them", JSON.stringify(dep));
    ok(`§1 the preview reads ${EXP.persons} people, the notes as notes (${EXP.notesAsRows.length}) and the event as "${EXP.eventName}"`,
       u.counts && u.counts.persons === EXP.persons && (u.noteRows || []).length === EXP.notesAsRows.length && u.event && u.event.name === EXP.eventName,
       JSON.stringify([u.counts && u.counts.persons, (u.noteRows || []).map(x => `${x.text}->${x.attachedTo}`), u.event]));

    ok("§1 a name keeps its punctuation: a download's \"Justin_s Place Finding Joy Dinner (1).xlsx\" is Justin's Place Finding Joy Dinner",
       R.eventNameFromFile("Justin_s Place Finding Joy Dinner (1).xlsx") === "Justin's Place Finding Joy Dinner", R.eventNameFromFile("Justin_s Place Finding Joy Dinner (1).xlsx"));

    // ── §2 the import with the defaults
    const j = await importJob(tok, { ...base, answers: ANSWERED });
    ok("§2 the import is done", j.end && j.end.status === "done", JSON.stringify(j.end || j.start.body).slice(0, 300));
    ok(`§2 ${EXP.persons} people, every one once`, await people(ORG) === EXP.persons, await people(ORG));
    const names = (await q(`SELECT name FROM donors WHERE org_id=$1 AND deleted_at IS NULL`, [ORG])).map(r => r.name);
    ok("§2 no name keeps markup or a note, and no note is a person",
       !names.some(n => /[*()]|^\d|gluten|vegan|allergy/i.test(n)) && !names.some(n => /Ketering|Fereira|Dunmoore|^Bev |^Rob |^Sue |Abernathy/.test(n)), names.filter(n => /[*()]|^\d|Ketering|^Bev /.test(n)));
    const noteOf = async who => (await q(`SELECT i.note FROM interactions i JOIN donors d ON d.id=i.donor_id WHERE i.org_id=$1 AND d.name=$2 AND i.type='note'`, [ORG, who])).map(r => r.note).join(" | ");
    for (const n of EXP.notesAsRows) ok(`§2 "${n.text}" (${n.sheet}) is a note on ${n.attachesTo}`, (await noteOf(n.attachesTo)).includes(n.text), await noteOf(n.attachesTo));
    ok(`§2 "**Gideon Pratt" is Gideon Pratt, once`, names.filter(n => n === "Gideon Pratt").length === 1, names.filter(n => /Gideon/.test(n)));
    const ivy = await noteOf("Ivy Brooks");
    ok("§2 \"Ivy (send with Harlan's) Brooks\" is Ivy Brooks, the note on her", names.includes("Ivy Brooks") && ivy.includes("send with Harlan's"), ivy);
    const lyle = await q(`SELECT d.name, h.name AS hh FROM donors d LEFT JOIN households h ON h.id=d.household_id WHERE d.org_id=$1 AND d.name LIKE '%Lyle' ORDER BY d.name`, [ORG]);
    const lyleNote = (await noteOf("Neil Lyle")) + (await noteOf("Martha Lyle"));
    ok("§2 \"Neil (husband) Martha (daughter) Lyle\" is the household Neil & Martha Lyle, with the note \"husband; daughter\"",
       lyle.map(x => x.name).join(",") === "Martha Lyle,Neil Lyle" && lyle.every(x => x.hh === "Neil & Martha Lyle") && lyleNote.includes("husband; daughter"), JSON.stringify([lyle, lyleNote]));
    for (const c of EXP.couples) {
      const hh = await q(`SELECT DISTINCT household_id FROM donors WHERE org_id=$1 AND name = ANY($2) AND household_id IS NOT NULL`, [ORG, c.people]);
      const both = c.people.every(p => names.includes(p));
      ok(`§2 "${c.from}" is two people, one household`, both && hh.length === 1, JSON.stringify([both, hh]));
    }
    const ev = await one(`SELECT id, name FROM events WHERE org_id=$1`, [ORG]);
    ok(`§2 the event keeps its apostrophe: "${EXP.eventName}"`, ev && ev.name === EXP.eventName, ev && ev.name);
    const st = await one(`SELECT COUNT(*) FILTER (WHERE status NOT IN ('cancelled','declined'))::int AS registered,
                                 COUNT(*) FILTER (WHERE status='attended')::int AS came, COUNT(*) FILTER (WHERE status='declined')::int AS declined,
                                 COUNT(*) FILTER (WHERE status='invited')::int AS invited,
                                 COUNT(*) FILTER (WHERE checked_in_at IS NOT NULL)::int AS checked,
                                 COUNT(*) FILTER (WHERE status='attended' AND checked_in_at = ($2::date + time '12:00') AT TIME ZONE COALESCE(NULLIF(o.timezone,''),'UTC'))::int AS noon,
                                 COUNT(DISTINCT donor_id)::int AS people, COUNT(*)::int AS n
                            FROM event_attendees a JOIN orgs o ON o.id=a.org_id WHERE a.org_id=$1 GROUP BY o.timezone`, [ORG, EVENT_DAY]);
    ok(`§2 from the rows: registered ${EXP.figures.registered}, came ${EXP.figures.came}, declined ${EXP.figures.declined}, the 3 with no reply invited, one row per person`,
       st.registered === EXP.figures.registered && st.came === EXP.figures.came && st.declined === EXP.figures.declined && st.invited === 3 && st.people === st.n, JSON.stringify(st));
    ok(`§2 ${EXP.figures.checkedIn} checked in, at noon on the event's day in the org's zone`, st.checked === EXP.figures.checkedIn && st.noon === EXP.figures.checkedIn, JSON.stringify(st));
    const tables = await q(`SELECT t.label, t.seats, (SELECT COUNT(*) FROM event_attendees a WHERE a.table_id=t.id)::int AS seated
                              FROM event_tables t WHERE t.org_id=$1 AND t.event_id=$2 ORDER BY t.label`, [ORG, ev.id]);
    const tablesWant = Object.entries(EXP.tables).map(([label, n]) => ({ label, seats: n, seated: n }));
    ok("§2 the chart's tables are the event's tables, each sized to the people it seats, and the guests sit at them",
       JSON.stringify(tables) === JSON.stringify(tablesWant), JSON.stringify(tables));
    const guests = (await api("GET", `/events/${ev.id}/guests`, tok)).body || {};
    ok("§2 the seating screen reads the same tables", (guests.tables || []).length === 3 && (guests.guests || []).filter(g => g.table_id).length === 25,
       JSON.stringify((guests.tables || []).map(t => [t.label, t.seats])));
    const money = await one(`SELECT (SELECT COUNT(*)::int FROM gifts WHERE org_id=$1 AND event_id=$2) AS gifts, (SELECT COALESCE(SUM(ROUND(amount*100)),0)::int FROM gifts WHERE org_id=$1 AND event_id=$2) AS gift_cents,
                                    (SELECT COUNT(*)::int FROM pledges WHERE org_id=$1 AND event_id=$2) AS pledges, (SELECT COALESCE(SUM(ROUND(amount*100)),0)::int FROM pledges WHERE org_id=$1 AND event_id=$2) AS pledge_cents,
                                    (SELECT COUNT(*)::int FROM gifts WHERE org_id=$1) AS all_gifts`, [ORG, ev.id]);
    ok(`§2 every gift (${EXP.money.gifts}, ${EXP.money.giftCents} cents) and the pledge (${EXP.money.pledgeCents} cents) are tied to the event`,
       money.gifts === EXP.money.gifts && money.gift_cents === EXP.money.giftCents && money.pledges === EXP.money.pledges && money.pledge_cents === EXP.money.pledgeCents && money.all_gifts === money.gifts,
       JSON.stringify(money));
    const undep = await one(`SELECT COUNT(*) FILTER (WHERE deposited_on IS NULL)::int AS n, COUNT(*) FILTER (WHERE deposited_on = date)::int AS on_day, COUNT(*) FILTER (WHERE deposit_ref IS NOT NULL)::int AS refs FROM gifts WHERE org_id=$1 AND import_id=$2`, [ORG, j.importId]);
    ok(`§2 deposited (the default): ${EXP.money.notYetDepositedAfterYes} received gifts left off a deposit, each deposited on its own date`,
       undep.n === EXP.money.notYetDepositedAfterYes && undep.on_day === EXP.money.gifts && undep.refs === 0, JSON.stringify(undep));
    // the Finance figure reads the same mark: a check from this run would not be "Not yet on a deposit"
    await q(`UPDATE gifts SET payment_method='Check', date=to_char(now(),'YYYY-MM-DD') WHERE org_id=$1 AND import_id=$2`, [ORG, j.importId]);
    const fin = (await api("GET", "/finance/overview", tok)).body || {};
    const unmatched = ((fin.needsYou || []).find(x => x.key === "unmatched") || { count: 0 }).count;
    ok("§2 Finance does not list the deposited gifts as Not yet on a deposit", unmatched === 0, JSON.stringify(fin.needsYou && fin.needsYou.map(x => [x.key, x.count])));
    const un = await undo(tok, j.importId);
    const left = await one(`SELECT (SELECT COUNT(*)::int FROM donors WHERE org_id=$1) AS donors, (SELECT COUNT(*)::int FROM gifts WHERE org_id=$1) AS gifts,
                                   (SELECT COUNT(*)::int FROM pledges WHERE org_id=$1) AS pledges, (SELECT COUNT(*)::int FROM events WHERE org_id=$1) AS events,
                                   (SELECT COUNT(*)::int FROM event_tables WHERE org_id=$1) AS tables, (SELECT COUNT(*)::int FROM event_attendees WHERE org_id=$1) AS att,
                                   (SELECT COUNT(*)::int FROM interactions WHERE org_id=$1 AND import_id=$2) AS notes, (SELECT COUNT(*)::int FROM households WHERE org_id=$1) AS hh`, [ORG, j.importId]);
    ok("§2 Undo removes the people, gifts, pledge, event, tables, attendance, notes and households", un.status === 200 && Object.values(left).every(v => v === 0), JSON.stringify([un.status, left]));

    // ── §3 the other answers
    const diff = { ...ANSWERED, nearDuplicates: { "beverly okonjo|bev okonjo": "different" }, giftsDeposited: "no" };
    const ud = (await api("POST", "/sheet-import/understand", tok, { ...base, answers: diff })).body || {};
    const nd = ((ud.questions || []).find(x => x.id === "nearDuplicates") || {}).pairs || [];
    const bev = nd.find(p => p.b === "Bev Okonjo") || {};
    ok("§3 Different on one pair: it is shown as chosen, and the preview reads one more person", bev.answer === "different" && bev.chosen === true && ud.counts.persons === EXP.persons + 1,
       JSON.stringify([bev, ud.counts && ud.counts.persons]));
    const j2 = await importJob(tok, { ...base, answers: diff });
    ok(`§3 the import makes ${EXP.persons + 1} people, Bev Okonjo among them, seated at Table 1`, j2.end && j2.end.status === "done" && await people(ORG) === EXP.persons + 1
       && !!(await one(`SELECT 1 AS x FROM event_attendees WHERE org_id=$1 AND name='Bev Okonjo' AND table_label='Table 1'`, [ORG])), await people(ORG));
    const undep2 = await one(`SELECT COUNT(*) FILTER (WHERE deposited_on IS NULL)::int AS n FROM gifts WHERE org_id=$1 AND import_id=$2`, [ORG, j2.importId]);
    ok(`§3 No to deposited: the ${EXP.money.gifts} gifts wait for a deposit`, undep2.n === EXP.money.gifts, JSON.stringify(undep2));
    await undo(tok, j2.importId);
    ok("§3 Undo leaves nobody", await people(ORG) === 0, await people(ORG));
  } catch (e) { ok("the suite ran to the end", false, e.stack); }
  await closeDb();
  summary();
})();
