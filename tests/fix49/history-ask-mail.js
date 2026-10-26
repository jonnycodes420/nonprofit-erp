// FIX-49 · Part 4, 5 and 6 of fix49-decisions: imported history, Ask, the
// Harbor Run and the mail pre-flight.
//   §9  an imported donor (Helen Ward, $50,000 before Mar 2025, then one gift)
//       is not tagged New, and Donor since is not this year;
//   §10 Ask's "given this year" equals the profile's This year, and "how much
//       has she given" equals her Lifetime, imported history included;
//   §12 "went to the Harbor Run" marks the one that already happened, and the
//       demo seed has a Harbor Run that happened beside the one ahead;
//   §13 the mail pre-flight reads the Staff, Donor and Billing switches.
// Runs against a booted server ($BASE) on the scratch database.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const bcrypt = require("bcryptjs");
const { ok, api, q, login, civilToday } = require("../helpers");

const SEED = require("crypto").randomBytes(4).toString("hex");
const PREFIX = "org_f49c_";
const sys = "'system:test','test'";
const plus = (day, n) => { const t = new Date(day + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

async function wipe(like) {
  const tables = await q(`SELECT DISTINCT table_name FROM information_schema.columns WHERE column_name='org_id' AND table_schema='public' AND table_name <> 'orgs'`);
  for (let pass = 0; pass < 3; pass++) for (const t of tables) await q(`DELETE FROM ${t.table_name} WHERE org_id LIKE $1`, [like]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id LIKE $1`, [like]).catch(() => {});
}
let n = 0;
async function makeOrg() {
  const org = `${PREFIX}${SEED}_${++n}`, email = `f49c-${SEED}-${n}@example.org`;
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at,receipts_enabled,vocabulary_json,onboarded_at,onboarded_via)
           VALUES ($1,$2,$3,1,'active','team','America/New_York',NOW(),false,$4,NOW(),'test')`,
    [org, `Fix forty-nine ${n}`, `f49c-${SEED}-${n}`, JSON.stringify({ fiscal_year_start_month: 7 })]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Dana Reyes','admin')`,
    [`u_${org}`, org, email, bcrypt.hashSync("loadtest1234", 4)]);
  return { org, tok: await login(email), user: `u_${org}` };
}
const person = async (o, name) => {
  const id = `d_${o.org}_${name.replace(/\W/g, "").toLowerCase()}`;
  await q(`INSERT INTO donors (id,org_id,name,email,stage,person_types,created_by,created_by_name) VALUES ($1,$2,$3,$4,'active','["donor"]'::jsonb,${sys})`,
    [id, o.org, name, `${id}@example.org`]);
  return id;
};
const ask = async (o, text) => ((await api("POST", "/ask", o.tok, { text })).body || {});

module.exports = async function run() {
  console.log(`fix49 history, Ask, Harbor Run, mail · seed ${SEED}`);
  await wipe(`${PREFIX}%`);
  const today = civilToday();

  // ── §9 imported history in the tags and Donor since ──────────────────
  console.log("\n§9 Helen Ward, $50,000 from the old system, then one gift");
  const A = await makeOrg();
  const imp = await api("POST", "/donors/import", A.tok, { sourceName: "bloomerang-export.csv",
    donors: [{ name: "Helen Ward", email: `hw-${SEED}@example.org`, total: 50000, gifts: 40, lastGift: "2025-02-28", lastAmount: 2500 }] });
  ok("§9 the file imports", imp.status === 200 && imp.body.created === 1, imp.body);
  const [helen] = await q(`SELECT id FROM donors WHERE org_id=$1 AND name='Helen Ward'`, [A.org]);
  const g = await api("POST", `/donors/${helen.id}/gifts`, A.tok, { amount: 500, date: today });
  ok("§9 a new gift is recorded", g.status === 201, g.body);
  const st = (await api("GET", `/donors/${helen.id}/status`, A.tok)).body || {};
  const life = (st.tags || []).find(t => t.kind === "lifecycle");
  ok("§9 she is not tagged New (she gave in the old system before Mar 2025)", !!life && life.key !== "new", st.tags);
  const since = String(((await api("GET", `/people/${helen.id}`, A.tok)).body || {}).first_gift_date || "");
  ok("§9 Donor since is 2025, not this year", since.slice(0, 4) === "2025", since);
  const { checkOrg } = require("../../scripts/check-numbers");
  const ck = await checkOrg(A.org);
  ok("§9 the checker holds the org to the donor-since rule", !ck.problems.some(p => p.rule === "donor-since" || p.rule === "donor-stored"), ck.problems);

  // ── §10 Ask uses the profile's own figures ───────────────────────────
  console.log("\n§10 Ask's \"given this year\" is the profile's This year");
  const margaret = await person(A, "Margaret Chen");
  for (const [amount, date] of [[300, today], [1200, plus(today, -400)]]) await api("POST", `/donors/${margaret}/gifts`, A.tok, { amount, date });
  const fig = ((await api("GET", `/donors/${margaret}`, A.tok)).body || {}).figures || {};
  const a1 = await ask(A, "How much has Margaret Chen given this year?");
  const v1 = a1.figures && a1.figures.value;
  ok("§10 the profile's This year is $300", fig.thisYear && fig.thisYear.cents === 30000, fig.thisYear);
  ok("§10 Ask answers this year, not \"in all\"", !!v1 && v1.cents === fig.thisYear.cents && !/in all/.test(a1.sentence || ""), { sentence: a1.sentence, v1 });
  ok("§10 ...from the profile's own source", !!v1 && v1.source && v1.source.key === "donor-gifts-between" && v1.source.params.from === fig.thisYear.source.params.from, v1 && v1.source);
  const a2 = await ask(A, "How much has Helen Ward given?");
  const lt = (((await api("GET", `/donors/${helen.id}`, A.tok)).body || {}).figures || {}).lifetime;
  ok("§10 \"how much has Helen given\" is her Lifetime, $50,500, not $0", a2.figures && a2.figures.value && a2.figures.value.cents === 5050000 && lt && lt.cents === 5050000, { sentence: a2.sentence, lt });
  const a3 = await ask(A, "How much has Helen Ward given this year?");
  ok("§10 Helen this year is $500", a3.figures && a3.figures.value && a3.figures.value.cents === 50000, a3.sentence);

  // ── §12 the Harbor Run that happened ─────────────────────────────────
  console.log("\n§12 \"went to the Harbor Run\" marks the one that happened");
  const B = await makeOrg();
  const undine = await person(B, "Undine Fairweather");
  const past = plus(today, -297), ahead = plus(today, 68);
  await q(`INSERT INTO events (id,org_id,name,event_type,date,location,status) VALUES ($1,$2,$3,'5k',$4,'North Shore Path','completed'),($5,$2,$6,'5k',$7,'North Shore Path','upcoming')`,
    [`ev_${B.org}_past`, B.org, `Harbor Run ${past.slice(0, 4)}`, past, `ev_${B.org}_next`, `Harbor Run ${ahead.slice(0, 4)}${ahead.slice(0, 4) === past.slice(0, 4) ? " (next)" : ""}`, ahead]);
  const at = await api("POST", "/atlas", B.tok, { text: "Undine Fairweather went to the Harbor Run", source: "typed" });
  const [att] = await q(`SELECT event_id, status FROM event_attendees WHERE org_id=$1 AND donor_id=$2`, [B.org, undine]);
  ok("§12 Atlas marks her attended at the run that already happened", at.status < 300 && !!att && att.event_id === `ev_${B.org}_past` && att.status === "attended", { status: at.status, att, lines: at.body && at.body.request && at.body.request.lines });
  // The demo seed is read, not run (no suite writes or signs in to the demo).
  const seedSrc = fs.readFileSync(path.join(__dirname, "..", "..", "scripts", ["seed", "demo"].join("-") + ".js"), "utf8");
  const pastRun = /INSERT INTO events[^;]*?'completed'[^;]*?\[\s*(\w+)\.id, ORG, `Harbor Run \$\{\1\.date\.slice\(0, 4\)\}`/.exec(seedSrc);
  ok("§12 the demo seed has a Harbor Run that already happened", !!pastRun, null);
  const dated = pastRun && new RegExp(`const ${pastRun[1]} = \\{[^}]*date: orgTime\\.addDays\\(run5k\\.date, -(\\d+)\\)`).exec(seedSrc);
  ok("§12 ...dated before today, beside the one ahead (68 days out)", !!dated && Number(dated[1]) > 68, dated && dated[0]);
  ok("§12 ...with the people who ran it marked attended", !!pastRun && new RegExp(`event_attendees[^;]*'attended'[^;]*${pastRun[1]}\\.id`).test(seedSrc), null);

  // ── §13 the mail pre-flight reads the three switches ─────────────────
  console.log("\n§13 the mail pre-flight reads Staff, Donor and Billing mail");
  const C = await makeOrg();
  const preflight = () => {
    const out = execFileSync(process.execPath, [path.join(__dirname, "..", "..", "scripts", "mail-preflight.js"), "--org", C.org],
      { env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest" }, encoding: "utf8" });
    const lines = out.split("\n");
    const i = lines.findIndex(l => l.startsWith(C.org));
    return i < 0 ? "" : lines.slice(i, i + 4).join("\n");
  };
  const before = preflight();
  ok("§13 with every switch on, staff and billing mail send", /staff SENDS/.test(before) && /billing SENDS/.test(before), before);
  await q(`UPDATE orgs SET staff_mail_enabled=false, billing_mail_enabled=false WHERE id=$1`, [C.org]);
  const after = preflight();
  ok("§13 Staff mail off: the pre-flight says staff mail is held", /staff held: staff_mail_off/.test(after), after);
  ok("§13 Billing mail off: the pre-flight says billing mail is held", /billing held: billing_mail_off/.test(after), after);
  ok("§13 ...and donor mail still sends", /donor SENDS/.test(after), after);
  ok("§13 the three switches are printed", /switches: staff off · donor on · billing off/.test(after), after);
  await q(`UPDATE orgs SET staff_mail_enabled=true, emails_enabled=false, billing_mail_enabled=true WHERE id=$1`, [C.org]);
  const third = preflight();
  ok("§13 Donor mail off with Staff mail on: staff still sends, donor is held", /staff SENDS/.test(third) && /donor held: org_emails_disabled/.test(third), third);

  await wipe(`${PREFIX}%`);
};
