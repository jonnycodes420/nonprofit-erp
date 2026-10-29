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
  const t0 = Date.now();
  for (;;) {
    const j = await api("GET", `/sheet-import/jobs/${encodeURIComponent(r.body.importId)}`, tok);
    if (j.status === 200 && j.body.status !== "running") return { start: r, end: j.body, importId: r.body.importId };
    if (Date.now() - t0 > 120000) return { start: r, end: { status: "timeout" }, importId: r.body.importId };
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
  ok("§1 every \"x 3 years\" pledge has all three yearly installments, from the event's date",
     threes.length === multi.length && threes.every(d => JSON.stringify(d) === JSON.stringify(["2026-10-22", "2027-10-22", "2028-10-22"])), JSON.stringify(threes.slice(0, 2)));
  ok("§1 a one-year pledge is due by the end of the event's year", [...byP.values()].filter(d => d.length === 1).every(d => d[0] === "2026-12-31"), "");

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
  await undo(tok, j.importId);
}

(async () => {
  try {
    await dinner();
    await guests();
  } catch (e) { ok("the suite ran to the end", false, e.stack); }
  await closeDb();
  summary();
})();
