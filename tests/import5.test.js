// tests/import5.test.js: IMPORT-5. DATES ARE ASKED, NEVER INVENTED; THE GUESTS
// WHO CAME AND DIDN'T GIVE; THE OPEN PLEDGE UP FRONT. Guards money and donor
// data: on Justin's Place the dinner's date was optional, so 63 gifts landed
// "No date" and 43 pledges were due from the day of the import (a made-up day).
//
//   §1 the dinner file (real-shaped, no dates): Import waits for the event's
//      date (the preview is not ready and the write refuses); the gifts take
//      the date only on Yes; the pledges are due from the event's date, a date
//      she chose, or have no set due date, and never from the import day;
//      every "x 3 years" installment is there. Undo restores each run.
//   §2 the Finding Joy workbook: "Came, didn't give" is the file's own count
//      (attended, no gift or pledge row for that record), to the person, on
//      the event page, as Home's Grow moves (one person, one move) and in Ask.
//   §3 the truth check: a person's open pledge is the same on the profile, in
//      Fundraising's open-pledge rows and on Home (assertSurfacesAgree).
//   §4 FIX-58: "Same as the event date" is Dec 31 of the event's year, then
//      each Dec 31, so nothing is overdue the week after the dinner; and Data
//      health moves pledges an older import dated the event's own day, with
//      before and after, on her click, with Undo.
//   §5 FIX-58, one accounting: the Finding Joy receipt says "106 rows · 100
//      gifts $111,790 · 6 first payments on pledges $12,500 · $124,290 in
//      all", each part opening its rows; Dollars in is "given · pledged"; the
//      gift history's Imports line is its gifts ($571,129.93), not the file's
//      net ($566,183.93); an undone import says Undone only.
//   §6 FIX-58, people once: the dinner's gift sheet and its guest list read
//      "Registered 263" (party places plus declines); Registered is people,
//      and came / gave add up. Red on main: 9 of 41. FIX-60: on the combined
//      Finding Joy workbook (guest list and gifts in one file, Jonathan's key
//      in expected-finding-joy.json), the people registered and came are the
//      key's 219 and 172 rows (a couple's row is two people, one household).
//
// HOW IT GOES RED ON MAIN: the dinner preview is ready with no date (§1), the
// pledges are due from the import day (§1), the event report has no guest
// lists and Home no came-didn't-give moves (§2), and the profile's pledge read
// carries no installments (§3).
//
// Standard scratch stack (tests/README.md). Sends nothing. The clock is not pinned.
"use strict";
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
const { assertSurfacesAgree } = require("./lib/surfacesAgree");

const XLSX = require(path.join(__dirname, "..", "client", "node_modules", "xlsx"));
const RS = path.join(__dirname, "fixtures", "import", "real-shaped");
const FX4 = path.join(__dirname, "fixtures", "import", "import4");
const PASSWORD = "loadtest1234";
const EVENT_DAY = "2026-10-22";

let R = null;
async function sheetsOf(full) {
  R = R || await import("../shared/sheetRead.js");
  return R.gridsFromWorkbook(XLSX.read(fs.readFileSync(full), { type: "buffer", cellDates: true }), XLSX);
}
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

async function dinner() {
  const ORG = "org_import5_dinner";
  const tok = await freshOrg(ORG, "IMPORT-5 dinner (test)");
  const today = (await one("SELECT to_char(now() AT TIME ZONE 'America/New_York','YYYY-MM-DD') AS d")).d;
  const sheets = await sheetsOf(path.join(RS, "jp-dinner-gifts-106.xlsx"));
  // the answer key, from the file's own cells
  const rows = sheets[0].grid.slice(1).filter(r => r[0] || r[1]);
  const gave = rows.filter(r => /^yes$/i.test(String(r[5]).trim()));
  const owes = rows.filter(r => /^no$/i.test(String(r[5]).trim()));
  const multi = owes.filter(r => /x\s*3\s*years/i.test(String(r[4])));
  ok("§1 the key, from the cells: 106 rows, 63 gifts, 43 pledges, 7 over three years", rows.length === 106 && gave.length === 63 && owes.length === 43 && multi.length === 7,
     [rows.length, gave.length, owes.length, multi.length]);

  const base = { fileName: "jp-dinner-gifts-106.xlsx", sheets };
  // §1a no answers: the date is asked and Import waits
  const u0 = (await api("POST", "/sheet-import/understand", tok, base)).body || {};
  const evQ = (u0.questions || []).find(x => x.id === "event") || {};
  ok("§1 a file that names a dinner and holds no dates: the event's date is required, and the preview is not ready",
     u0.ready === false && evQ.required === true && evQ.optional === false && /106 rows, no dates/.test(evQ.holds || "") && /Dinner/.test(evQ.text || ""), JSON.stringify(evQ));
  ok("§1 the button waits for the answer", /^Answer \d+ questions? first/.test((u0.button && u0.button.text) || ""), u0.button && u0.button.text);
  const refused = await importJob(tok, { ...base, importId: "imp_import5_refused" });
  const wrote = await one("SELECT (SELECT COUNT(*) FROM gifts WHERE org_id=$1)::int + (SELECT COUNT(*) FROM pledges WHERE org_id=$1)::int AS n", [ORG]);
  ok("§1 the write refuses an unanswered date and writes nothing", refused.end && refused.end.status === "failed" && /question/.test(refused.end.error || "") && wrote.n === 0,
     JSON.stringify([refused.end && refused.end.status, refused.end && refused.end.error, wrote.n]));
  // §1b the date alone: the gifts and the pledges are still asked
  const u1 = (await api("POST", "/sheet-import/understand", tok, { ...base, answers: { eventDate: EVENT_DAY } })).body || {};
  const q1 = (u1.questions || []).map(x => x.id);
  const gq = (u1.questions || []).find(x => x.id === "eventGifts") || {};
  ok("§1 with the date, two questions remain: the 63 gifts (Yes or No) and the 43 pledges' due dates",
     u1.ready === false && q1.includes("eventGifts") && q1.includes("pledgeDue") && gq.count === 63 && /Use the .* date for these 63 gifts\?/.test(gq.text || ""), JSON.stringify(q1) + " " + gq.text);
  const pq = (u1.questions || []).find(x => x.id === "pledgeDue") || {};
  ok("§1 the pledge question offers the event's date, a date she chooses, and No set due date",
     JSON.stringify((pq.options || []).map(o => o.key)) === JSON.stringify(["event", "choose", "none"]) && pq.count === 43, JSON.stringify(pq));

  // §1c Yes, and due from the event's date
  const A = { eventDate: EVENT_DAY, useEventDate: true, pledgeDue: "event", eventName: "Finding Joy Dinner" };
  const u2 = (await api("POST", "/sheet-import/understand", tok, { ...base, answers: A })).body || {};
  ok("§1 answered, the preview is ready and no gift is undated", u2.ready === true && u2.counts.undatedGifts === 0 && !/undated/.test(u2.button.text), u2.button && u2.button.text);
  const j1 = await importJob(tok, { ...base, answers: A });
  ok("§1 the import ends done", j1.end && j1.end.status === "done", JSON.stringify(j1.end).slice(0, 300));
  const g1 = await one("SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE date='2026-10-22')::int AS dated FROM gifts WHERE org_id=$1 AND import_id=$2", [ORG, j1.importId]);
  ok("§1 Yes: all 63 gifts are dated the event's day", g1.n === 63 && g1.dated === 63, JSON.stringify(g1));
  const inst = await q(`SELECT p.id, p.due_date AS pdue, p.installment_count AS k, i.seq, i.due_date FROM pledges p JOIN pledge_installments i ON i.pledge_id=p.id
                         WHERE p.org_id=$1 AND p.import_id=$2 ORDER BY p.id, i.seq`, [ORG, j1.importId]);
  const pledgeIds = [...new Set(inst.map(r => r.id))];
  ok("§1 no pledge and no installment is due on the day of the import", pledgeIds.length === 43 && inst.every(r => r.due_date !== today && r.pdue !== today) && inst.every(r => r.due_date),
     JSON.stringify({ n: pledgeIds.length, today, onToday: inst.filter(r => r.due_date === today).length }));
  const byP = new Map();
  for (const r of inst) (byP.get(r.id) || byP.set(r.id, []).get(r.id)).push(r.due_date);
  const threes = [...byP.values()].filter(d => d.length === 3);
  // FIX-58 (Jonathan, 29 Oct): "Same as the event date" is Dec 31 of the event's year, then each Dec 31
  ok("§1 every \"x 3 years\" pledge has three yearly installments, each on Dec 31 from the event's year",
     threes.length === multi.length && threes.every(d => JSON.stringify(d) === JSON.stringify(["2026-12-31", "2027-12-31", "2028-12-31"])), JSON.stringify(threes.slice(0, 2)));
  ok("§1 a one-year pledge is due by the end of the event's year", [...byP.values()].filter(d => d.length === 1).every(d => d[0] === "2026-12-31"), "");
  const weekAfter = "2026-10-29";   // the event's day + 7
  const early = await q(`SELECT i.due_date FROM pledges p JOIN pledge_installments i ON i.pledge_id=p.id
                          WHERE p.org_id=$1 AND p.import_id=$2 AND i.paid_gift_id IS NULL AND i.due_date <= $3`, [ORG, j1.importId, weekAfter]);
  ok("§1 FIX-58: nothing is overdue the week after the event (no unpaid installment due on or before Oct 29)", early.length === 0, JSON.stringify(early.slice(0, 3)));

  // §4 FIX-58 · Data health: pledges an older import dated from the event's own day
  // (planted the way the import wrote them before 29 Oct: each "x 3 years" one on Oct 22, yearly)
  await q(`UPDATE pledge_installments i SET due_date = (2026 + i.seq - 1)::text || '-10-22' FROM pledges p
            WHERE i.pledge_id=p.id AND p.org_id=$1 AND p.import_id=$2 AND p.installment_count=3`, [ORG, j1.importId]);
  await q(`UPDATE pledges SET due_date='2028-10-22' WHERE org_id=$1 AND import_id=$2 AND installment_count=3`, [ORG, j1.importId]);
  const snap = async () => (await q(`SELECT p.id, p.due_date, array_agg(i.due_date ORDER BY i.seq) AS d FROM pledges p JOIN pledge_installments i ON i.pledge_id=p.id
                                      WHERE p.org_id=$1 GROUP BY p.id ORDER BY p.id`, [ORG])).map(r => `${r.id}:${r.due_date}:${r.d.join(",")}`).join("|");
  const planted = await snap();
  const hc = ((await api("GET", "/data-health", tok)).body || {}).counts || {};
  const dh = (await api("GET", "/data-health/pledge-dates", tok)).body || {};
  const r0 = (dh.rows || [])[0] || {};
  ok(`§4 Data health reads "${multi.length} pledges have a first installment dated the event day", the count and its rows the same`,
     hc.pledgesOnEventDay === multi.length && (dh.rows || []).length === multi.length && dh.sentence === `${multi.length} pledges have a first installment dated the event day`, JSON.stringify([hc.pledgesOnEventDay, (dh.rows || []).length, dh.sentence]));
  ok("§4 each row shows before and after: Oct 22 yearly becomes Dec 31 yearly",
     JSON.stringify((r0.installments || []).map(i => [i.before, i.after])) === JSON.stringify([["2026-10-22", "2026-12-31"], ["2027-10-22", "2027-12-31"], ["2028-10-22", "2028-12-31"]]) && r0.pledgeDueAfter === "2028-12-31",
     JSON.stringify(r0).slice(0, 300));
  const viaGet = await snap();
  ok("§4 reading the review changes nothing", viaGet === planted, "");
  const ap = await api("POST", "/data-health/pledge-dates/apply", tok, {});
  const moved = await q(`SELECT array_agg(i.due_date ORDER BY i.seq) AS d, MIN(p.due_date) AS pd FROM pledges p JOIN pledge_installments i ON i.pledge_id=p.id
                          WHERE p.org_id=$1 AND p.installment_count=3 GROUP BY p.id`, [ORG]);
  const stamped = await one(`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE created_by='u_${ORG}' AND created_by_name='Allie Test')::int AS mine FROM pledge_date_fixes WHERE org_id=$1 AND batch_id=$2`, [ORG, ap.body && ap.body.batchId]);
  ok("§4 Move to Dec 31 applies on her click: every three-year pledge due Dec 31 yearly, each change stamped with her",
     ap.status === 201 && ap.body.applied === multi.length && moved.length === multi.length && moved.every(r => JSON.stringify(r.d) === JSON.stringify(["2026-12-31", "2027-12-31", "2028-12-31"]) && r.pd === "2028-12-31")
     && stamped.n === multi.length * 4 && stamped.mine === stamped.n, JSON.stringify([ap.status, ap.body, stamped, moved.slice(0, 1)]));
  const after = (await api("GET", "/data-health/pledge-dates", tok)).body || {};
  const again = await api("POST", "/data-health/pledge-dates/apply", tok, {});
  ok("§4 then the item is clear, and a second click moves nothing", (after.rows || []).length === 0 && again.body && again.body.applied === 0, JSON.stringify([(after.rows || []).length, again.body]));
  let agree4 = null;
  try { agree4 = await assertSurfacesAgree(ORG, { token: tok, label: "after Move to Dec 31", soft: true }); } catch (e) { agree4 = { ok: false, diffs: [String(e.message)] }; }
  ok("§4 the truth check after the move", agree4.ok, (agree4.diffs || []).join("\n"));
  const ud = await api("POST", "/data-health/pledge-dates/undo", tok, { batchId: ap.body && ap.body.batchId });
  ok("§4 Undo puts every date back exactly as it was", ud.status === 200 && (await snap()) === planted, JSON.stringify([ud.status, ud.body]));
  await api("POST", "/data-health/pledge-dates/apply", tok, {});

  // §3 the truth check, with these pledges on file
  let agree = null;
  try { agree = await assertSurfacesAgree(ORG, { token: tok, label: "after the dinner", soft: true }); } catch (e) { agree = { ok: false, diffs: [String(e.message)] }; }
  ok("§3 the truth check: profile, Fundraising and Home agree on each open pledge (and every other surface)", agree.ok, (agree.diffs || []).join("\n"));
  const king = await one(`SELECT p.donor_id FROM pledges p WHERE p.org_id=$1 AND p.installment_count=3 ORDER BY p.amount DESC, p.id LIMIT 1`, [ORG]);
  const prof = (await api("GET", `/donors/${king.donor_id}/pledges`, tok)).body || [];
  const pl = prof.find(x => x.installmentCount === 3) || {};
  ok("§3 the profile's pledge read carries each installment with its state, and its open figure's source",
     (pl.installments || []).length === 3 && pl.installments.every(i => i.dueDate && i.paid === false) && pl.openSource && pl.openSource.key === "pledges-open", JSON.stringify(pl).slice(0, 300));
  const un1 = await undo(tok, j1.importId);
  const left = await one("SELECT (SELECT COUNT(*) FROM gifts WHERE org_id=$1)::int AS g, (SELECT COUNT(*) FROM pledges WHERE org_id=$1)::int AS p, (SELECT COUNT(*) FROM events WHERE org_id=$1)::int AS e", [ORG]);
  ok("§1 Undo restores everything: no gift, pledge or event left", un1.status === 200 && left.g === 0 && left.p === 0 && left.e === 0, JSON.stringify([un1.status, left]));

  // §1d No, and No set due date
  const B = { eventDate: EVENT_DAY, useEventDate: false, pledgeDue: "none" };
  const j2 = await importJob(tok, { ...base, answers: B });
  const g2 = await one("SELECT COUNT(*) FILTER (WHERE date IS NULL)::int AS undated FROM gifts WHERE org_id=$1 AND import_id=$2", [ORG, j2.importId]);
  const p2 = await one(`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE i.due_date IS NOT NULL)::int AS dated FROM pledges p JOIN pledge_installments i ON i.pledge_id=p.id
                         WHERE p.org_id=$1 AND p.import_id=$2`, [ORG, j2.importId]);
  ok("§1 No: the 63 gifts stay No date; No set due date: no installment gets a date", j2.end && j2.end.status === "done" && g2.undated === 63 && p2.n === 43 - multi.length + 3 * multi.length && p2.dated === 0,
     JSON.stringify([j2.end && j2.end.status, g2, p2]));
  const ev = (await api("GET", "/events", tok)).body || [];
  const evRow = (Array.isArray(ev) ? ev : ev.events || []).find(e => /Dinner/.test(e.name)) || {};
  const rep = (await api("GET", `/events/${evRow.id}/report`, tok)).body || {};
  // each row's Amount is its first year; a "x 3 years" row's two later years are later
  const firstYearC = owes.reduce((n, r) => n + Math.round(Number(r[2]) * 100), 0), laterC = multi.reduce((n, r) => n + 2 * Math.round(Number(r[2]) * 100), 0);
  ok("§1 the event's raised still counts the pledges with no set due date: the first year pledged, the rest later",
     rep.money && rep.money.pledgedCents === firstYearC && rep.money.laterCents === laterC, JSON.stringify(rep.money && [rep.money.pledgedCents, rep.money.laterCents, firstYearC, laterC]));
  await undo(tok, j2.importId);

  // §1e a date she chooses: that day, then yearly
  const C = { eventDate: EVENT_DAY, useEventDate: false, pledgeDue: "choose", pledgeDueDate: "2027-01-15" };
  const j3 = await importJob(tok, { ...base, answers: C });
  const d3 = await q(`SELECT p.id, array_agg(i.due_date ORDER BY i.seq) AS d FROM pledges p JOIN pledge_installments i ON i.pledge_id=p.id WHERE p.org_id=$1 AND p.import_id=$2 GROUP BY p.id`, [ORG, j3.importId]);
  ok("§1 A date I choose: a one-year pledge is due that day, a three-year one that day and yearly after",
     d3.length === 43 && d3.every(r => (r.d.length === 1 && r.d[0] === "2027-01-15") || JSON.stringify(r.d) === JSON.stringify(["2027-01-15", "2028-01-15", "2029-01-15"])), JSON.stringify(d3.slice(0, 2)));
  await undo(tok, j3.importId);
}

async function guests() {
  const ORG = "org_import5_guests";
  const tok = await freshOrg(ORG, "IMPORT-5 guests (test)");
  const sheets = await sheetsOf(path.join(FX4, "Finding_Joy_Combined.xlsx"));
  // the answer key, from the cells: attended records with no gift or pledge row
  // by their ID, each counted by the people its First Name holds ("A & B" is two)
  const P = sheets.find(s => s.name === "People").grid, G = sheets.find(s => s.name === "Gifts").grid;
  const ph = P.findIndex(r => r[0] === "ID"), people = P.slice(ph + 1).filter(r => r[0]);
  const gid = new Set(G.slice(1).map(r => r[0]).filter(Boolean));
  const yes = v => String(v || "").trim().toLowerCase() === "yes";
  const members = r => (/\s(&|and)\s/i.test(String(r[1] || "")) ? 2 : 1);
  const noGift = people.filter(r => yes(r[11]) && !gid.has(r[0]));
  const KEY = noGift.reduce((n, r) => n + members(r), 0);
  const KEY_GAVE = people.filter(r => yes(r[11]) && gid.has(r[0])).reduce((n, r) => n + members(r), 0);
  ok(`§2 the key, from the cells: ${noGift.length} attended records with no gift, ${KEY} people`, noGift.length > 0 && KEY >= noGift.length, KEY);

  const body = { fileName: "Finding_Joy_Combined.xlsx", sheets, answers: { eventDate: EVENT_DAY, useEventDate: true, pledgeDue: "event" } };
  const j = await importJob(tok, body);
  ok("§2 the workbook imports", j.end && j.end.status === "done", JSON.stringify(j.end).slice(0, 300));
  const [ev] = await q("SELECT id, name FROM events WHERE org_id=$1", [ORG]);
  const rep = (await api("GET", `/events/${ev.id}/report`, tok)).body || {};
  const G2 = rep.guests || {};
  console.log(`  [import5] came, didn't give: ${(G2.cameNoGift || []).length} (key ${KEY}); came, gave: ${(G2.cameGave || []).length} (key ${KEY_GAVE}); invited, didn't come: ${(G2.invitedNoShow || []).length}`);
  ok(`§2 the event page: "Came, didn't give" is the file's ${KEY}, to the person`, (G2.cameNoGift || []).length === KEY, (G2.cameNoGift || []).length);
  ok(`§2 and "Came, gave" beside it is the file's ${KEY_GAVE}`, (G2.cameGave || []).length === KEY_GAVE, (G2.cameGave || []).length);
  const giverIds = new Set((await q(`SELECT donor_id AS id FROM gifts WHERE org_id=$1 UNION SELECT donor_id FROM pledges WHERE org_id=$1`, [ORG])).map(r => r.id));
  ok("§2 nobody on the didn't-give list has a gift or pledge on file", (G2.cameNoGift || []).every(p => !giverIds.has(p.id)), "");
  const rows = (await api("GET", `/events/${ev.id}/rows?rows=cameNoGift`, tok)).body || {};
  const fig = (await api("GET", `/figures/event-guests/rows?event=${ev.id}&list=cameNoGift&page=1&pageSize=500`, tok)).body || {};
  ok("§2 the list opens its rows, and the figure source says the same", rows.count === KEY && (fig.rows || []).length === KEY && Number(fig.value) === KEY, JSON.stringify([rows.count, (fig.rows || []).length, fig.value]));

  // Home: one Grow move per person, the event named, no ask on the first touch
  const deck = ((await api("GET", "/insights?view=deck", tok)).body || {}).deck || {};
  const all = (deck.tabs || []).flatMap(t => t.moves || []);
  const came = all.filter(m => m.kind === "came_no_gift");
  const also = all.filter(m => (m.also || []).some(a => a.kind === "came_no_gift"));
  const ids = all.flatMap(m => m.ids || []);
  // Grow ranks by dollars and draws at most 150 cards; a $0 thank-you can sit past the cap, still counted on the tab
  const grow = (deck.tabs || []).find(t => t.key === "grow") || { moves: [], count: 0 };
  const hidden = grow.count - grow.moves.length;
  ok(`§2 Home: every one of the ${KEY} is a Grow move or an "also" on their one move (the tab counts any past its 150 cards)`,
     came.every(m => m.tab === "grow") && (came.length + also.length === KEY || (grow.moves.length === 150 && came.length + also.length < KEY && came.length + also.length + hidden >= KEY)),
     JSON.stringify([came.length, also.length, grow.count, grow.moves.length]));
  ok("§2 one person, one move", ids.length === new Set(ids).size, ids.length - new Set(ids).size);
  const m0 = came[0] || {};
  ok("§2 the move says the event and its day, asks nothing, drafts a thank-you for coming, and links to all of them",
     /^Came to the Finding Joy Dinner on Oct 22, 2026 and didn't give\. Thank them for coming\.$/.test(m0.what || "") && m0.ask === null && m0.action && m0.action.taskKind === "write"
     && /thank you for coming/i.test(m0.say || "") && m0.group && m0.group.count === KEY && m0.group.eventId === ev.id, JSON.stringify(m0).slice(0, 400));

  // Ask (and Atlas, which asks Ask)
  const ask = (await api("POST", "/ask", tok, { text: "Who came to the dinner and didn't give?" })).body || {};
  ok(`§2 Ask: "who came and didn't give" is the same ${KEY}, and opens the same rows`, ask.answered === true && ask.figures && ask.figures.value.value === KEY
     && ask.figures.value.source.key === "event-guests" && (ask.people || []).length === KEY, ask.sentence);

  // §5 FIX-58 one accounting: the preview's 106 gifts are the receipt's 106 rows
  const res = (j.end && j.end.result) || {};
  const line = res.giftLine || {};
  ok("§5 the receipt says every part: 106 rows · 100 gifts $111,790 · 6 first payments on pledges $12,500 · $124,290 in all",
     line.sentence === "106 rows · 100 gifts $111,790 · 6 first payments on pledges $12,500 · $124,290 in all" && /6 first payments on pledges \(\$12,500\)/.test(res.sentence || ""),
     JSON.stringify([line.sentence, res.sentence]));
  const figI = async part => (await api("GET", `/figures/import-gifts/rows?import=${j.importId}${part ? "&part=" + part : ""}&page=1&pageSize=200`, tok)).body || {};
  const [fg, ff, fa] = [await figI("gifts"), await figI("first"), await figI(null)];
  ok("§5 each part opens its rows, footing to the cent: 100 gifts $111,790, 6 first payments $12,500, 106 in all $124,290",
     fg.totalRows === 100 && Number(fg.value) === 111790 && ff.totalRows === 6 && Number(ff.value) === 12500 && fa.totalRows === 106 && Number(fa.value) === 124290,
     JSON.stringify([[fg.totalRows, fg.value], [ff.totalRows, ff.value], [fa.totalRows, fa.value]]));
  const listed = ((await api("GET", "/imports", tok)).body.imports || []).find(x => x.id === j.importId) || {};
  ok("§5 Dollars in reads what was given and what is pledged, never one sum: $124,290 given · $78,950 pledged",
     listed.dollarsInWords === "$124,290 given · $78,950 pledged" && listed.dollarsGiven === 124290 && listed.dollarsPledged === 78950, JSON.stringify([listed.dollarsInWords, listed.dollarsGiven, listed.dollarsPledged]));
  ok("§5 Who is the person's name", listed.by === "Allie Test", listed.by);
  const rec = ((await api("GET", `/imports/${j.importId}`, tok)).body || {}).import || {};
  ok("§5 the stored receipt carries the same line, with each part's source", rec.giftLine && rec.giftLine.sentence === line.sentence && rec.giftLine.sources.first.key === "import-gifts", JSON.stringify(rec.giftLine));
  await undo(tok, j.importId);
  const after = ((await api("GET", "/imports", tok)).body.imports || []).find(x => x.id === j.importId) || {};
  ok("§5 an undone import says Undone, and only that", after.state === "undone" && after.reconciled === true && (after.findings || []).length === 0, JSON.stringify([after.state, after.reconciled, after.findings]));
}

// §5 FIX-58: the gift history's Imports line is its 278 gifts, $571,129.93,
// not the file's net with its refunds ($566,183.93)
async function giftHistory() {
  const ORG = "org_import5_history";
  const tok = await freshOrg(ORG, "IMPORT-5 gift history (test)");
  const sheets = await sheetsOf(path.join(RS, "jp-gift-history-287.xlsx"));
  const j = await importJob(tok, { fileName: "jp-gift-history-287.xlsx", sheets });
  const db = await one("SELECT COUNT(*)::int AS n, ROUND(SUM(amount)*100)::bigint AS c FROM gifts WHERE org_id=$1 AND import_id=$2", [ORG, j.importId]);
  const listed = ((await api("GET", "/imports", tok)).body.imports || []).find(x => x.id === j.importId) || {};
  ok("§5 the gift history: the Imports list says $571,129.93 given, its 278 gifts to the cent",
     db.n === 278 && Number(db.c) === 57112993 && Math.round(listed.dollarsGiven * 100) === 57112993 && listed.dollarsInWords === "$571,129.93", JSON.stringify([db, listed.dollarsGiven, listed.dollarsInWords]));
  let agree = null;
  try { agree = await assertSurfacesAgree(ORG, { token: tok, label: "after the gift history", soft: true }); } catch (e) { agree = { ok: false, diffs: [String(e.message)] }; }
  ok("§5 the truth check agrees with the receipt", agree.ok, (agree.diffs || []).join("\n"));
  await undo(tok, j.importId);
}

// §6 FIX-58: an event counts people once. The dinner's guest list and its
// gifts, one event: "Registered 263" was 233 party places for 165 guests plus
// 30 who declined. FIX-60: read from the combined Finding Joy workbook, whose
// guest list and gifts are the same people (the old guest list belonged to
// another gift sheet).
async function eventPeople() {
  const ORG = "org_import5_people";
  const tok = await freshOrg(ORG, "IMPORT-5 event people (test)");
  const A = { eventDate: EVENT_DAY, useEventDate: true, pledgeDue: "event", eventName: "Finding Joy Dinner" };
  const FJ = "jp-finding-joy-combined-443.xlsx", K = JSON.parse(fs.readFileSync(path.join(RS, "expected-finding-joy.json"), "utf8"));
  const jd = await importJob(tok, { fileName: FJ, sheets: await sheetsOf(path.join(RS, FJ)), answers: A });
  ok("§6 the Finding Joy workbook imports into one event", jd.end && jd.end.status === "done", JSON.stringify([jd.end && jd.end.status]));
  const evs = await q("SELECT id FROM events WHERE org_id=$1", [ORG]);
  const ev = evs[0] || {};
  const key = await one(`SELECT COUNT(DISTINCT donor_id) FILTER (WHERE status IN ('registered','confirmed','attended','no_show'))::int AS reg,
                                COUNT(*) FILTER (WHERE status='attended')::int AS came FROM event_attendees WHERE org_id=$1 AND event_id=$2`, [ORG, ev.id]);
  const byRow = await one(`SELECT COUNT(DISTINCT COALESCE(d.household_id, d.id)) FILTER (WHERE a.status IN ('registered','confirmed','attended','no_show'))::int AS reg,
                                   COUNT(DISTINCT COALESCE(d.household_id, d.id)) FILTER (WHERE a.status='attended')::int AS came
                              FROM event_attendees a JOIN donors d ON d.id = a.donor_id WHERE a.org_id=$1 AND a.event_id=$2 AND d.deleted_at IS NULL`, [ORG, ev.id]);
  ok(`§6 the people registered and came are the key's ${K.rsvp_yes} and ${K.attended} rows`, byRow.reg === K.rsvp_yes && byRow.came === K.attended, JSON.stringify([byRow, K.rsvp_yes, K.attended]));
  const rep = (await api("GET", `/events/${ev.id}/report`, tok)).body || {};
  const fig = k => ((rep.figures || []).find(f => f.key === k) || {}).value;
  const card = (((await api("GET", "/events", tok)).body) || []).find(e => e.id === ev.id) || {};
  ok(`§6 Registered is each person who said they were coming or came, once: ${key.reg}, on the page and the card`,
     evs.length === 1 && fig("registered") === key.reg && card.registered_count === key.reg && rep.story && rep.story.registered === key.reg,
     JSON.stringify([evs.length, key, fig("registered"), card.registered_count, rep.story && rep.story.registered]));
  const st = rep.story || {};
  ok("§6 Came = came and gave + came and didn't; Gave = came and gave + gave and didn't come",
     st.attended === key.came && st.cameGave + st.cameDidntGive === st.attended && st.gave === st.cameGave + st.gaveNotCame && typeof st.addsUp === "string",
     JSON.stringify([st.attended, st.cameGave, st.cameDidntGive, st.gave, st.gaveNotCame, st.addsUp]));
  const reg = (await api("GET", `/figures/event-registered/rows?event=${ev.id}&page=1&pageSize=200`, tok)).body || {};
  const regRows = (await api("GET", `/events/${ev.id}/rows?rows=registered`, tok)).body || {};
  ok("§6 Registered opens its people, the same number", Number(reg.value) === key.reg && reg.totalRows === key.reg && regRows.count === key.reg, JSON.stringify([reg.value, reg.totalRows, regRows.count]));
  let agree = null;
  try { agree = await assertSurfacesAgree(ORG, { token: tok, label: "after the dinner and its guest list", soft: true }); } catch (e) { agree = { ok: false, diffs: [String(e.message)] }; }
  ok("§6 the truth check: registered on the database, the page, the story and the card, and the counts add up", agree.ok, (agree.diffs || []).join("\n"));
  await undo(tok, jd.importId);
}

(async () => {
  try {
    await dinner();
    await guests();
    await giftHistory();
    await eventPeople();
  } catch (e) { ok("the suite ran to the end", false, e.stack); }
  await closeDb();
  summary();
})();
