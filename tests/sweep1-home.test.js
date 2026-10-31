// tests/sweep1-home.test.js: SWEEP-1. HOME'S MOVES ASK FOR THE RIGHT MONEY,
// IN WORDS A DONOR CAN READ, AND ATLAS ANSWERS THE QUESTION ASKED. Guards money
// and donor drafts: the walk of 31 Oct (docs/sweeps/sweep-1/walk.md) found a
// foundation that gave $25,000 in September asked for last December's $50,000
// on top, every organisation's draft opening "Hello," and "Mr & Mrs." opening
// "Hi &,", an Ask chip offering "the Annual Fund" to an org without one and
// answering with all its giving, an event card counting places as people, and
// every imported person left with no owner and nothing on Home to fix it.
//
//   §1 a year-end move accounts for this fiscal year's giving: the ask is last
//      December's gift less it, and says so; a giver who already gave as much
//      is not a year-end move at all.
//   §2 a move's note greets as shared/greeting.js does: an organisation as its
//      named contact or "friends at" it, never "Hello,"; never "Hi &,".
//   §3 Ask: a fund the org doesn't have is said, never answered with all
//      giving; "top donors" with no number is answered; "how many donors do we
//      have" is everyone who has given; Home never offers the Annual Fund.
//   §4 Home's event card says Registered as the event page counts it (each
//      person once), apart from the places.
//   §5 Owners: an admin is offered her largest givers while nobody has an
//      owner; one click assigns them, Undo takes exactly that batch back; a
//      fundraiser can't.
//
// HOW IT GOES RED ON MAIN (37a702b): §1 asks $50,000 and keeps the giver who
// already gave; §2 says "Hello," and "Hi &,"; §3 answers the Annual Fund with
// a number, refuses "top", counts this year's givers, and the chip is there;
// §4 says "4 guests" for two couples; §5 has no route (404).
//
// Standard scratch stack (tests/README.md). Sends nothing. The clock is not
// pinned: the engine is read as of a fixed day through TEST_MODE's asOf.
"use strict";
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "org_sweep1_home";
const PASSWORD = "loadtest1234";
const AS_OF = "2026-10-20";        // a fiscal year (July) under way, before the year-end season
const D = k => `d_sweep1_${k}`;

async function freshOrg(id, name) {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 5; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [id]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [id]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,$2,$3,1,'active','team','America/New_York')`, [id, name, id.replace(/_/g, "-")]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Allie Staffer','admin')`, ["u_" + id, id, `${id}@test.local`, bcrypt.hashSync(PASSWORD, 4)]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Fran Raiser','fundraiser')`, ["u2_" + id, id, `${id}-2@test.local`, bcrypt.hashSync(PASSWORD, 4)]);
  return [await login(`${id}@test.local`, PASSWORD), await login(`${id}-2@test.local`, PASSWORD)];
}
const person = (k, name, kind, total, extra = {}) => q(
  `INSERT INTO donors (id,org_id,name,kind,total_giving,contact_name,person_types,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,$6,'["donor"]','system:test','test')`,
  [D(k), ORG, name, kind, total, extra.contact || null]);
let gn = 0;
const gift = (k, amount, date) => q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,'system:test','test')`,
  [`g_sweep1_${++gn}`, ORG, D(k), amount, date]);

(async () => {
  try {
    const [tok, tokFundraiser] = await freshOrg(ORG, "Lantern House");
    // Year-end givers: each gave last December. The foundation also gave in
    // September (this fiscal year); the trust already gave more than December.
    await person("found", "Marrow Family Foundation", "organisation", 75000); await gift("found", 50000, "2025-12-16"); await gift("found", 25000, "2026-09-04");
    await person("trust", "Lindell Trust", "organisation", 9000, { contact: "Ruth Lindell" }); await gift("trust", 3000, "2025-12-10"); await gift("trust", 6000, "2026-08-01");
    await person("bank", "Harbor Savings Bank", "organisation", 400); await gift("bank", 400, "2025-12-12");
    await person("mrs", "Mr & Mrs. Ivo G Dunmore", "person", 250); await gift("mrs", 250, "2025-12-20");
    await person("pat", "Pat Okafor", "person", 300); await gift("pat", 100, "2025-12-03"); await gift("pat", 200, "2026-10-15");

    // §1 / §2 · the year-end card, read as of AS_OF
    const ins = await api("GET", `/insights?asOf=${AS_OF}`, tok);
    ok("§0 the moves read", ins.status === 200, ins.status);
    const ye = (ins.body.cards || []).find(c => c.kind === "year_end") || { items: [] };
    const item = name => ye.items.find(i => i.name === name);
    const found = item("Marrow Family Foundation");
    ok("§1 the foundation that gave $25,000 this fiscal year is asked last December's $50,000 less it ($25,000), not $50,000",
      !!found && found.how.ask && found.how.ask.cents === 2500000 && /less the \$25,000 given since/.test(found.how.ask.words), found && found.how.ask);
    ok("§1 its card says what it gave this fiscal year", !!found && /\$25,000 since/.test(found.what || found.facts.map(f => f.join(" ")).join(" ")), found && (found.what || found.facts));
    ok("§1 a giver who already gave more than last December this fiscal year is not a year-end move", !item("Lindell Trust") && !item("Pat Okafor") && !!item("Harbor Savings Bank"),
      ye.items.map(i => i.name));
    const say = name => ((item(name) || {}).how || {}).say || "";
    ok("§2 an organisation with no named contact is greeted as friends at it, never \"Hello,\"",
      /^Dear friends at Harbor Savings Bank,/.test(say("Harbor Savings Bank")) && /^Dear friends at Marrow Family Foundation,/.test(say("Marrow Family Foundation")), [say("Harbor Savings Bank"), say("Marrow Family Foundation")]);
    ok("§2 \"Mr & Mrs.\" is never \"Hi &,\"", !!say("Mr & Mrs. Ivo G Dunmore") && !/^(Hi|Dear) &/.test(say("Mr & Mrs. Ivo G Dunmore")), say("Mr & Mrs. Ivo G Dunmore"));
    const sayAll = (ins.body.cards || []).flatMap(c => c.items.map(i => (i.how && i.how.say) || "")).filter(Boolean);
    ok("§2 no move's note opens \"Hello,\"", sayAll.every(s => !/^Hello,/.test(s)), sayAll.filter(s => /^Hello,/.test(s)).slice(0, 3));

    // §3 · Ask
    const askSays = async text => { const r = await api("POST", "/ask", tok, { text }); return r.body || {}; };
    const fund = await askSays("How is the Annual Fund doing?");
    const fundWords = fund.sentence || (fund.answer && fund.answer.sentence) || "";
    ok("§3 a fund the org doesn't have is said by name, and no number answers it", /no fund, appeal or event called "Annual Fund"/.test(fundWords) && !/\$\d/.test(fundWords), fundWords);
    const top = await askSays("Who are our top donors?");
    ok("§3 \"Who are our top donors?\" is answered with the people", !top.refused && Array.isArray(top.people) && top.people.length > 0, top.sentence || top);
    const many = await askSays("How many donors do we have?");
    ok("§3 \"How many donors do we have?\" counts everyone who has given, all time (5)", many.plan && many.plan.period && many.plan.period.kind === "all_time" && /\b5 people\b/.test(many.sentence || ""), [many.plan, many.sentence]);
    const lead = await api("GET", "/home/lead", tok);
    ok("§3 Home never offers \"How is the Annual Fund doing?\"", lead.status === 200 && !(lead.body.tries || []).some(t => /Annual Fund/.test(t)), lead.body.tries);

    // §4 · the event card: two couples (parties of two) are 2 people registered, 4 places
    const today = require("./clock").civilDay();
    const soon = new Date(Date.parse(today + "T12:00:00Z") + 3 * 864e5).toISOString().slice(0, 10);
    await q(`INSERT INTO events (id,org_id,name,event_type,date,capacity,status,created_by,created_by_name) VALUES ('ev_sweep1',$1,'Lantern Supper','gala',$2,40,'upcoming','system:test','test')`, [ORG, soon]);
    for (const k of ["pat", "mrs"]) await q(`INSERT INTO event_attendees (id,org_id,event_id,donor_id,name,status,quantity) VALUES ($1,$2,'ev_sweep1',$3,'x','registered',2)`, [`ea_sweep1_${k}`, ORG, D(k)]);
    const ev = ((await api("GET", "/home/lead", tok)).body.lead || []).find(c => c.kind === "event");
    ok("§4 Home's event card says 2 people registered (each person once), apart from its 40 places", !!ev && /^2 people registered, for 40 places/.test(ev.why), ev && ev.why);

    // §5 · owners
    const offer = await api("GET", "/home/owners", tok);
    ok("§5 an admin is offered her largest givers while nobody has an owner", offer.status === 200 && offer.body.offer === true && offer.body.unowned === 5 && offer.body.top === 5, offer.body);
    ok("§5 a fundraiser is not offered it and can't do it", (await api("GET", "/home/owners", tokFundraiser)).body.offer === false
      && (await api("POST", "/home/owners/assign", tokFundraiser, {})).status === 403);
    const done = await api("POST", "/home/owners/assign", tok, {});
    const mine = await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND assigned_to=$2 AND assigned_by IS NOT NULL`, [ORG, "u_" + ORG]);
    ok("§5 one click makes them hers, stamped with who assigned them", done.status === 200 && done.body.n === 5 && mine[0].n === 5, [done.body, mine[0]]);
    ok("§5 once someone has an owner, Home stops offering", (await api("GET", "/home/owners", tok)).body.offer === false);
    const undo = await api("POST", "/home/owners/undo", tok, { ids: done.body.ids });
    const left = await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND assigned_to IS NOT NULL`, [ORG]);
    ok("§5 Undo takes exactly that batch back", undo.status === 200 && undo.body.n === 5 && left[0].n === 0, [undo.body, left[0]]);
  } catch (e) {
    ok("suite ran without throwing", false, e.stack);
  } finally {
    await closeDb();
    summary("sweep1-home");
  }
})();
