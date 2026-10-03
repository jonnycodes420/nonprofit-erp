// tests/prospect1-room-to-give.test.js · PROSPECT-1, Test 1. ROOM TO GIVE
// SAYS WHAT THE FILE SAYS, AND NOTHING IT CAN'T SHOW.
//
// A fixture org gets the same ten prospects the Harborlight seed writes (the
// seed module itself, with this org's ids), so this also proves the seed.
//   §1  each person's word and reasons match their rows exactly: three
//       Strong, four Some, three Not yet known, and the reason sentences for
//       one of each read word for word from the facts
//   §2  the sample screening file comes back through the column mapper's
//       preview and the import: six matched (by Steward ID or email), the one
//       stranger listed as unmatched and never guessed, and exactly the four
//       whose capacity range starts at five times what they gave this year
//       move to Strong, each showing the provider and the date
//   §3  "Who could give more?" lists nobody outside its counted rows: every
//       person it names is in a reason's rows (the figure source), and the
//       reasons' counts add up to the people it names
//   §4  deleting one person's screening takes them back to their own-file
//       word, and the org-wide delete leaves no row
//
// HOW IT WOULD GO RED. Change BIG_GIFT_MULTIPLE or STRONG_CAPACITY_MULTIPLE
// (§1/§2 words), let matchRows fall back to a name alone (§2 Penelope is
// matched), or let `more` name a Not yet known person (§3). Planted: setting
// STRONG_CAPACITY_MULTIPLE to 50 turned §2 red (Solvang stayed Some).
//
// Standard scratch stack (tests/README.md). Never reaches the network.
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
const { BASE, ok, summary, q, closeDb } = require("./helpers");
const SEED = require("../scripts/seed/prospect1-prospects");

const ORG = "org_pr1t1";
const PRE = "d_pr1t1_";
const ADMIN = `admin@${ORG}.test`;

async function reset() {
  for (const t of ["screening_results", "screening_imports", "public_filings", "threads", "interactions", "event_attendees", "volunteer_shifts",
    "recurring_subscriptions", "gifts", "donor_scores", "events", "question_log_none"]) {
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  }
  await q(`DELETE FROM donors WHERE org_id=$1`, [ORG]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,'Prospect One Test','prospect-one-test',1,'active','team','America/New_York')
           ON CONFLICT (id) DO NOTHING`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Room Admin','admin')
           ON CONFLICT (id) DO UPDATE SET password_hash=EXCLUDED.password_hash, role='admin'`, [`u_${ORG}`, ORG, ADMIN, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ($1,$2,'General',false) ON CONFLICT (id) DO NOTHING`, [`fund_${ORG}_gen`, ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ($1,$2,'Scholarships',true) ON CONFLICT (id) DO NOTHING`, [`fund_${ORG}_sch`, ORG]);
}
const call = async (tok, method, p, body) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = {}; try { json = JSON.parse(text); } catch { json = { text }; }
  return { status: r.status, body: json };
};

(async () => {
  console.log("PROSPECT-1 Test 1: Room to give says what the file says\n");
  await reset();
  const [{ today }] = await q(`SELECT to_char((NOW() AT TIME ZONE 'America/New_York')::date, 'YYYY-MM-DD') AS today`);
  await q(`INSERT INTO events (id,org_id,name,event_type,date) VALUES ($1,$2,'Spring supper','gala',$3)`, [`ev_${ORG}`, ORG, today]);
  await SEED.seedProspect1(q, ORG, { TODAY: today, gen: `fund_${ORG}_gen`, sch: `fund_${ORG}_sch`, who: [`u_${ORG}`, "Room Admin"], pre: PRE });
  const tok = (await (await fetch(BASE + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: ADMIN, password: "loadtest1234" }) })).json()).token;
  ok("the admin signs in", !!tok);

  // §1 ─────────────────────────────────────────────────────────────────────
  const words = {};
  for (const p of SEED.PEOPLE) {
    const r = await call(tok, "GET", `/donors/${PRE + p[0]}/room-to-give`);
    words[p[0]] = r.body;
    ok(`§1 ${p[1]} is ${p[4]}`, r.status === 200 && r.body.word === p[4], { status: r.status, word: r.body.word, reasons: (r.body.reasons || []).map(x => x.text) });
  }
  const yearOf = d => new Date(Date.parse(today + "T00:00:00Z") - d * 86400000).toISOString().slice(0, 4);
  const texts = k => (words[k].reasons || []).map(r => r.text);
  ok("§1 Whitcombe's reasons read from her rows, word for word",
    JSON.stringify(texts("whitcombe")) === JSON.stringify([`Gave $2,500 once in ${yearOf(600)}, usually gives $300`, "Gave to two different funds or campaigns", "Came to an event"]), texts("whitcombe"));
  ok("§1 Solvang's monthly gift and one-time gifts are both on the record",
    texts("solvang").includes("Gives $40 a month and gave $700 more in one-time gifts in the last twelve months"), texts("solvang"));
  ok("§1 Pemberton's one reason is the donor-advised fund", JSON.stringify(texts("pemberton")) === JSON.stringify(["Has given through a donor-advised fund"]), texts("pemberton"));
  ok("§1 Ostrowski, with no gifts, says so", words.ostrowski.label === "Not yet known" && texts("ostrowski")[0] === "No gifts on file yet", texts("ostrowski"));
  ok("§1 every own-file reason opens its rows (a figure source)", SEED.PEOPLE.every(p => words[p[0]].reasons.every(r => r.screening || (r.source && r.source.key === "donor-lifetime"))));
  ok("§1 no reason carries an em dash or a score meter", Object.values(words).every(w => w.reasons.every(r => !/—|%|\/100\b/.test(r.text))));

  // §2 ─────────────────────────────────────────────────────────────────────
  const csv = fs.readFileSync(path.join(__dirname, "fixtures", "prospect1", "harborlight-screening-return.csv"), "utf8").replace(/d_pr1_/g, PRE);
  const pv = await call(tok, "POST", "/screening/import/preview", { csv, fileName: "return.csv" });
  ok("§2 the mapper preview reads the headers and proposes each column", pv.status === 200 && pv.body.proposal["Steward ID"] === "std:steward_id"
    && pv.body.proposal["Gift Capacity Range"] === "std:capacity_range" && pv.body.proposal["Email"] === "std:email" && pv.body.rowCount === 7, pv.body.proposal);
  const mapping = Object.fromEntries(Object.entries(pv.body.proposal).map(([h, v]) => [h, v.replace(/^std:/, "")]));
  const refused = await call(tok, "POST", "/screening/import", { csv, mapping, fileName: "return.csv", screenedOn: today });
  ok("§2 a file with no provider named is refused (every result names its source)", refused.status === 400);
  const im = await call(tok, "POST", "/screening/import", { csv, mapping, fileName: "return.csv", provider: "Sample Screening Co", screenedOn: today });
  ok("§2 six rows matched", im.status === 200 && im.body.matched === 6, im.body);
  ok("§2 the stranger is listed as unmatched, not guessed", im.body.unmatched.length === 1 && im.body.unmatched[0].name === "Penelope Marsh-Darrow" && im.body.unmatched[0].row === 8, im.body.unmatched);
  const moved = (im.body.strongNow || []).map(x => x.donorId).sort();
  const expectMoved = ["ashdown", "faraday", "ostrowski", "solvang"].map(k => PRE + k).sort();
  ok("§2 exactly the four whose capacity starts at five times this year's giving moved to Strong", JSON.stringify(moved) === JSON.stringify(expectMoved), moved);
  const ash = (await call(tok, "GET", `/donors/${PRE}ashdown/room-to-give`)).body;
  ok("§2 Ashdown now Strong, with the provider and the date shown", ash.word === "strong" && ash.screening && ash.screening.provider === "Sample Screening Co" && ash.screening.screenedOn === today, ash.screening);
  ok("§2 the screening reason reads from the file, word for word",
    ash.reasons.some(r => r.screening && r.text === "Capacity range from the screening file: $10,000 to $25,000; currently gives $150 a year"), ash.reasons.map(r => r.text));
  const keene = (await call(tok, "GET", `/donors/${PRE}keene/room-to-give`)).body;
  ok("§2 someone not in the file is untouched", keene.word === "unknown" && !keene.screening);

  // §3 ─────────────────────────────────────────────────────────────────────
  const a = await call(tok, "POST", "/why/ask", { key: "more" });
  ok("§3 the eighth question answers", a.status === 200 && a.body.answered && a.body.question.key === "more", a.status);
  const named = (a.body.who || []).map(w => w.donorId);
  const counted = new Set();
  let countSum = 0;
  for (const r of a.body.reasons || []) {
    const qs = new URLSearchParams({ ...r.source.params, pageSize: "200" }).toString();
    const rows = await call(tok, "GET", `/figures/${r.source.key}/rows?${qs}`);
    (rows.body.rows || []).forEach(x => counted.add(x.donorId));
    countSum += r.count;
  }
  ok("§3 nobody is named outside the counted rows", named.length > 0 && named.every(id => counted.has(id)), named.filter(id => !counted.has(id)));
  ok("§3 the reasons' counts add up to the people named, each once", countSum === named.length && new Set(named).size === named.length, { countSum, named: named.length });
  ok("§3 Keene (Not yet known) is not named", !named.includes(PRE + "keene"));
  ok("§3 Strong people come first", a.body.who.findIndex(w => w.word === "some") === -1 || a.body.who.slice(0, a.body.who.findIndex(w => w.word === "some")).every(w => w.word === "strong"));
  ok("§3 each person carries reasons and a step to plan a visit", a.body.who.every(w => w.reasons.length > 0) && a.body.step && /Plan a visit/.test(a.body.step.label));
  ok("§3 the suggested ask says when the screening file moved it", a.body.who.filter(w => w.ask && w.ask.screening).every(w => /screening file \(Sample Screening Co/.test(w.ask.sentence)));

  // §4 ─────────────────────────────────────────────────────────────────────
  const del = await call(tok, "DELETE", `/donors/${PRE}ashdown/screening`);
  ok("§4 one person's screening is deleted", del.status === 200 && del.body.deleted === 1, del.body);
  ok("§4 and they are back to their own-file word", (await call(tok, "GET", `/donors/${PRE}ashdown/room-to-give`)).body.word === "some");
  const [audit] = await q(`SELECT COUNT(*)::int AS n FROM fin_audit_log WHERE org_id=$1 AND request_method='DELETE' AND request_path LIKE '%/screening'`, [ORG]).catch(() => [{ n: -1 }]);
  ok("§4 the delete left an audit row", audit.n >= 1, audit);
  const all = await call(tok, "DELETE", "/screening");
  const [{ n }] = await q(`SELECT COUNT(*)::int AS n FROM screening_results WHERE org_id=$1`, [ORG]);
  ok("§4 the org-wide delete leaves no screening row", all.status === 200 && n === 0, { status: all.status, n });

  await reset();
  await q(`DELETE FROM users WHERE org_id=$1`, [ORG]).catch(() => {});
  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
