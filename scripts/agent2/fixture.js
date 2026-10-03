// AGENT-2 · the fixture org the 30 instructions run against (scratch only).
// BASE=http://localhost:5841 DATABASE_URL=…/steward_agent2 node scripts/agent2/fixture.js
const bcrypt = require("bcryptjs");
const { q, api, login, civilToday, civilPlusDays } = require("../../tests/helpers");
const ORG = process.env.A2_ORG || "org_agent30";
const ADMIN = `director@${ORG.replace(/_/g, "")}.local`;
const T = civilToday();
const monthStart = T.slice(0, 8) + "01";
// The coming Saturday (at least one day ahead).
const sat = (() => { for (let i = 1; i <= 7; i++) { const d = civilPlusDays(i); if (new Date(d + "T12:00:00Z").getUTCDay() === 6) return d; } })();

async function build({ twoAdas = false } = {}) {
  const tables = (await q(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (let pass = 0; pass < 6; pass++) {
    for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone)
           VALUES ($1,'Riverbend Community Pantry',$2,1,'active','team','America/New_York')`, [ORG, ORG.replace(/_/g, "-")]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Dana Director','admin'),
           ($5,$2,$6,$4,'Lena Ortiz','admin')`,
    [`u_${ORG}_dir`, ORG, ADMIN, bcrypt.hashSync("loadtest1234", 10), `u_${ORG}_lena`, `lena@${ORG.replace(/_/g, "")}.local`]);
  const P = (id, name, email, extra = {}) => ({ id: `d_${ORG}_${id}`, name, email, ...extra });
  const people = [
    P("ada", "Ada Petrossian", "ada@petrossian.test", { stage: "steward", phone: "617-555-0142" }),
    ...(twoAdas ? [P("ada2", "Ada Brennan", "ada.brennan@test.test", { stage: "prospect" })] : []),
    P("margaret", "Margaret Lee", "margaret.lee@test.test", { stage: "cultivate" }),
    P("john", "John Smith", "john.smith@test.test", { stage: "steward" }),
    P("mary", "Mary Smith", "mary.smith@test.test", { stage: "steward" }),
    P("sam", "Sam Smith", "sam.smith@test.test", { stage: null }),
    P("bob", "Bob Tran", "bob@oldmail.test", { stage: "qualify" }),
    P("sunrise", "Sunrise Foundation", "grants@sunrise.test", { stage: "steward", kind: "organisation" }),
    P("ellen1", "Ellen Park", "ellen.park@test.test", { stage: "steward" }),
    P("ellen2", "Ellen Park", "epark@test.test", { stage: null }),
    P("carlos", "Carlos Mendes", "carlos@test.test", { stage: "prospect" }),
    P("new1", "Priya Natarajan", "priya@test.test", { stage: null }),
    P("new2", "Tom Okafor", "tom.okafor@test.test", { stage: null }),
    P("new3", "Grace Whitfield", "grace@test.test", { stage: null }),
  ];
  for (const p of people)
    await q(`INSERT INTO donors (id,org_id,name,email,phone,stage,kind,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,$6,$7,'system:fixture','Fixture')`,
      [p.id, ORG, p.name, p.email, p.phone || null, p.stage, p.kind || null]);
  const gift = (id, who, amount, date, ack = true) => q(
    `INSERT INTO gifts (id,org_id,donor_id,amount,date,created_by,created_by_name${ack ? ",acknowledgement_sent" : ""}) VALUES ($1,$2,$3,$4,$5,'system:fixture','Fixture'${ack ? ",true" : ""})`,
    [`g_${ORG}_${id}`, ORG, `d_${ORG}_${who}`, amount, date]);
  await gift("ada1", "ada", 100000, civilPlusDays(-200));
  await gift("mar1", "margaret", 500, civilPlusDays(-400)); await gift("mar2", "margaret", 750, civilPlusDays(-60));
  await gift("john1", "john", 1000, civilPlusDays(-90)); await gift("mary1", "mary", 250, civilPlusDays(-90));
  await gift("bob1", "bob", 100, civilPlusDays(-500));
  await gift("sun0", "sunrise", 25000, civilPlusDays(-380));
  await gift("sun1", "sunrise", 5000, civilPlusDays(-6), false);      // the unthanked Sunrise gift
  await gift("ell1", "ellen1", 300, civilPlusDays(-120)); await gift("ell2", "ellen2", 50, civilPlusDays(-30));
  for (const [i, w] of ["new1", "new2", "new3"].entries()) await gift(`first${i}`, w, 50 + i * 25, T >= monthStart ? monthStart : T);
  // keep the stored totals honest for the fixture (the screens read them)
  await q(`UPDATE donors d SET total_giving = COALESCE(s.t,0), gift_count = COALESCE(s.n,0), last_gift_date = s.l, last_gift_amount = s.la,
             first_gift_date = s.f, person_types = CASE WHEN s.n > 0 THEN '["donor"]'::jsonb ELSE '["other"]'::jsonb END
           FROM (SELECT donor_id, SUM(amount) t, COUNT(*) n, MAX(date) l, MIN(date) f,
                        (ARRAY_AGG(amount ORDER BY date DESC))[1] la FROM gifts WHERE org_id=$1 GROUP BY donor_id) s
           WHERE d.id = s.donor_id AND d.org_id=$1`, [ORG]);
  await q(`UPDATE donors SET person_types='["other"]'::jsonb WHERE org_id=$1 AND gift_count=0`, [ORG]);

  const tok = await login(ADMIN);
  const must = (label, r) => { if (r.status >= 300) throw new Error(`${label}: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`); return r.body; };
  must("household", await api("POST", "/households", tok, { name: "The Smith household", memberIds: [`d_${ORG}_john`, `d_${ORG}_sam`], primaryDonorId: `d_${ORG}_john` }));
  must("group", await api("POST", "/groups", tok, { name: "Gala table hosts", kind: "static" }));
  const g = must("group list", await api("GET", "/groups", tok));
  const hosts = (g.groups || g).find(x => x.name === "Gala table hosts");
  must("group bob", await api("POST", `/groups/${hosts.id}/members`, tok, { donorIds: [`d_${ORG}_bob`] }));
  const j = must("journey", await api("POST", "/journeys", tok, { presetKey: "new_donor_first_year" }));
  must("journey margaret", await api("POST", `/journeys/${j.id}/apply`, tok, { donorIds: [`d_${ORG}_margaret`] }));
  const opp = must("opportunity", await api("POST", "/volunteer-hub/opportunities", tok, { name: "Food drive", isPublic: true }));
  must("slot", await api("POST", "/volunteer-hub/slots", tok, { opportunityId: opp.id, date: sat, startTime: "09:00", endTime: "12:00", name: "Saturday food drive", capacity: 10 }));
  must("event", await api("POST", "/events", tok, { name: "Spring open house", eventType: "open_house", date: civilPlusDays(20), location: "The pantry", cost: 0 }));
  return { ORG, ADMIN, tok, sat, journeyId: j.id, groupId: hosts.id, oppId: opp.id };
}
module.exports = { build, ORG, ADMIN };
if (require.main === module) build({ twoAdas: process.argv.includes("--two-adas") })
  .then(r => { console.log(JSON.stringify({ ...r, tok: undefined })); return require("../../tests/helpers").closeDb(); })
  .catch(async e => { console.error(e.message); await require("../../tests/helpers").closeDb(); process.exit(1); });
