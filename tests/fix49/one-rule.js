// FIX-49 Part 3 · ONE RULE EACH (Jonathan, 25 Oct). A section of
// tests/fix49-decisions.test.js; it calls ok() and never summary().
//   6. Lapsed is no gift in the last 12 months after giving before; lapsing is
//      a last gift 9 to 12 months ago. The profile tag, the Directory's counts
//      and filter, groups, the journey triggers, Drift and Lost & Found name
//      the same people. "Retained" is the org's fiscal year.
//   7. Giving levels come from the org's cut points and nothing else: no
//      lifetime mid/major promotion, and every "Major" list reads the level.
//   8. Households: the household record is the only grouping. A spouse link
//      puts the two in one household, and the old links are migrated.
// Runs against a booted server ($BASE) on the scratch database.
const bcrypt = require("bcryptjs");
const { ok, api, q, login, civilToday } = require("../helpers");

const SEED = require("crypto").randomBytes(4).toString("hex");
const PREFIX = "org_f49b_";
const PW = bcrypt.hashSync("loadtest1234", 4);
const sys = "'system:test','test'";
const day = n => { const d = new Date(civilToday() + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function monthsBack(today, n) {
  const [y, m, d] = today.split("-").map(Number);
  const idx = y * 12 + (m - 1) - n, yy = Math.floor(idx / 12), mm = idx - yy * 12 + 1;
  const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  return `${yy}-${String(mm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}
const addDays = (s, n) => { const d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function wipe(like) {
  const tables = await q(`SELECT DISTINCT table_name FROM information_schema.columns WHERE column_name='org_id' AND table_schema='public' AND table_name <> 'orgs'`);
  for (let pass = 0; pass < 3; pass++) for (const t of tables) await q(`DELETE FROM ${t.table_name} WHERE org_id LIKE $1`, [like]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id LIKE $1`, [like]).catch(() => {});
}

module.exports = async function run() {
  console.log(`\nfix49 Part 3 · one rule each · seed ${SEED}`);
  await wipe(`${PREFIX}%`);
  const org = `${PREFIX}${SEED}`, email = `f49b-${SEED}@example.org`, user = `u_${org}`;
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at,receipts_enabled,vocabulary_json,emails_enabled,staff_mail_enabled)
           VALUES ($1,'One rule each',$2,1,'active','team','America/New_York',NOW(),false,$3,true,NULL)`,
    [org, `f49b-${SEED}`, JSON.stringify({ fiscal_year_start_month: 7 })]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Dana Reyes','admin')`, [user, org, email, PW]);
  const tok = await login(email);
  const today = civilToday();
  let n = 0;
  // A person made a long time ago (so a lapse happened while they were in
  // Steward), with gifts written straight to the table and the one summary
  // statement run after, the way an import leaves them.
  const person = async (name, gifts, { madeDaysAgo = 1500, kind = null } = {}) => {
    const id = `d_${org}_${++n}`;
    await q(`INSERT INTO donors (id,org_id,name,email,stage,person_types,kind,created_at,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,'steward','["donor"]'::jsonb,$5,NOW() - ($6 || ' days')::interval,${sys})`,
      [id, org, name, `${id}@example.org`, kind, String(madeDaysAgo)]);
    for (const [date, amount] of gifts)
      await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,'online',${sys})`,
        [`g_${id}_${date}_${amount}`, org, id, amount, date]);
    return id;
  };
  const lapsingDay = monthsBack(today, 9);
  const P = {
    lapsedNow: await person("Lapsed Five Days", [[addDays(today, -370), 400], [addDays(today, -800), 300]]),
    lapsedEdge: await person("Lapsed On The Day", [[addDays(today, -365), 250], [addDays(today, -700), 250]]),
    lapsedOld: await person("Lapsed Long Ago", [[addDays(today, -900), 900], [addDays(today, -1200), 900]]),
    lapsedImported: await person("Lapsed Before Steward", [[addDays(today, -380), 500], [addDays(today, -760), 500]], { madeDaysAgo: 2 }),
    lapsingNow: await person("Lapsing Three Days", [[addDays(lapsingDay, -3), 120], [addDays(today, -500), 120]]),
    lapsingEdge: await person("Lapsing Last Day", [[addDays(today, -364), 75], [addDays(today, -600), 75]]),
    giving: await person("Giving Now", [[addDays(today, -30), 60], [addDays(today, -400), 60]]),
    monthly: await person("Monthly, Three Months Quiet", [[addDays(today, -95), 25], [addDays(today, -125), 25], [addDays(today, -155), 25], [addDays(today, -185), 25]]),
  };
  await q(require("../../donorSummary").DONOR_SUMMARY_UPDATE(), [org]);
  const LAPSED = [P.lapsedNow, P.lapsedEdge, P.lapsedOld, P.lapsedImported].sort();
  const LAPSING = [P.lapsingNow, P.lapsingEdge].sort();
  const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

  // ── the profile tag ─────────────────────────────────────────────────────
  const tagsOf = async id => ((await api("GET", `/donors/${id}/status`, tok)).body.tags || []).map(t => t.key);
  const tagged = {};
  for (const [k, id] of Object.entries(P)) tagged[k] = await tagsOf(id);
  ok("§6 the profile tags Lapsed exactly the people with no gift in the last 12 months",
    same(Object.entries(P).filter(([k]) => tagged[k].includes("lapsed")).map(([, id]) => id), LAPSED), tagged);
  ok("§6 a last gift 365 days ago is lapsed, 364 days ago is lapsing", tagged.lapsedEdge.includes("lapsed") && tagged.lapsingEdge.includes("lapsing") && !tagged.lapsingEdge.includes("lapsed"), [tagged.lapsedEdge, tagged.lapsingEdge]);
  ok("§6 the profile tags Lapsing exactly the people whose last gift was 9 to 12 months ago",
    same(Object.entries(P).filter(([k]) => tagged[k].includes("lapsing")).map(([, id]) => id), LAPSING), tagged);

  // ── the Directory: its counts and its filter ───────────────────────────
  const counts = (await api("GET", "/donors/counts", tok)).body || {};
  ok("§6 the Directory counts the same lapsed people (it read a status nothing wrote)", counts.lapsed === LAPSED.length, counts);
  ok("§6 ...and the same lapsing people", counts.lapsing === LAPSING.length, counts);
  ok("§6 ...and the Re-engage badge is the lapsed who may be asked", counts.reengage === LAPSED.length, counts);
  const listOf = async qs => ((await api("GET", `/donors?${qs}&limit=500`, tok)).body || {});
  const ids = b => (Array.isArray(b) ? b : b.donors || b.rows || []).map(d => d.id);
  ok("§6 the Directory's Lapsed filter finds them", same(ids(await listOf("lifecycle=lapsed")), LAPSED), ids(await listOf("lifecycle=lapsed")));
  ok("§6 the Directory's Lapsing filter finds them", same(ids(await listOf("lifecycle=lapsing")), LAPSING), ids(await listOf("lifecycle=lapsing")));

  // ── groups ──────────────────────────────────────────────────────────────
  const starters = ((await api("GET", "/groups/starters", tok)).body || {}).starters || [];
  const st = k => starters.find(s => s.key === k) || {};
  ok("§6 the Lapsed and Lapsing starter groups count the same people", st("lapsed").count === LAPSED.length && st("lapsing").count === LAPSING.length,
    starters.map(s => [s.key, s.count]));

  // ── the journey triggers ────────────────────────────────────────────────
  const plans = {};
  for (const key of ["lapsed", "lapsing"]) {
    const made = await api("POST", "/journeys", tok, { name: `F49 ${key}`, trigger: key, steps: [{ type: "follow_up", label: `Call (${key})`, offsetDays: 0 }] });
    ok(`§6 a journey can start on "${key}"`, made.status === 201 && made.body.trigger === key, JSON.stringify(made.body).slice(0, 160));
    if (made.body.id) await api("PATCH", `/journeys/${made.body.id}`, tok, { enabled: true });
  }
  await api("POST", "/journeys/run-sweep", tok, {});
  await api("POST", "/journeys/run-sweep", tok, {});
  for (const key of ["lapsed", "lapsing"])
    plans[key] = (await q(`SELECT p.donor_id FROM cultivation_plans p JOIN cultivation_templates t ON t.id=p.template_id
                             WHERE p.org_id=$1 AND t.trigger_key=$2`, [org, key])).map(r => r.donor_id);
  ok("§6 the lapsed journey starts for the people who just lapsed while in Steward, once each",
    same(plans.lapsed, [P.lapsedNow, P.lapsedEdge]), plans.lapsed);
  ok("§6 ...never for a lapse long ago, or one that came in on a file already lapsed", !plans.lapsed.includes(P.lapsedOld) && !plans.lapsed.includes(P.lapsedImported), plans.lapsed);
  ok("§6 the lapsing journey starts for someone 9 months past their last gift", plans.lapsing.includes(P.lapsingNow) && !plans.lapsing.includes(P.giving), plans.lapsing);

  // ── Drift and Lost & Found ──────────────────────────────────────────────
  const drift = require("../../drift");
  const giftsOf = async id => (await q(`SELECT date, amount::float AS amount FROM gifts WHERE donor_id=$1`, [id])).map(g => ({ date: String(g.date).slice(0, 10), amount: g.amount }));
  ok("§6 Drift calls the lapsed lapsed", drift.assessDrift(await giftsOf(P.lapsedNow), today).state === "lapsed");
  ok("§6 Drift does not call a monthly giver three months quiet lapsed (it used 2.5 times their gap)", drift.assessDrift(await giftsOf(P.monthly), today).state === "drifting",
    drift.assessDrift(await giftsOf(P.monthly), today).state);
  const LF = await import("../../shared/lostAndFound.js");
  const rows = [];
  for (const [k, id] of Object.entries(P)) for (const g of await giftsOf(id)) rows.push({ name: k, date: g.date, cents: Math.round(g.amount * 100), year: Number(g.date.slice(0, 4)) });
  const audit = LF.audit(rows, { today });
  const sec = k => audit.sections.find(s => s.key === k) || {};
  ok("§6 Lost & Found's Lapsed and Lapsing are the same rule", sec("lapsed").count === LAPSED.length && sec("lapsing").count === LAPSING.length,
    audit.sections.map(s => [s.key, s.count]));

  // ── Retained, on the org's fiscal year ──────────────────────────────────
  const fy = require("../../orgTime").orgFiscalYearStart({ timezone: "America/New_York", vocabulary_json: { fiscal_year_start_month: 7 } });
  const lastFy = addDays(fy, -20), thisFy = addDays(fy, 5) <= today ? addDays(fy, 5) : today;
  const ret = await person("Retained On The Fiscal Year", [[lastFy, 100], [thisFy, 100]]);
  await q(require("../../donorSummary").DONOR_SUMMARY_UPDATE("AND d.id = $2"), [org, ret]);
  ok("§6 Retained is gave last fiscal year and again this fiscal year", (await tagsOf(ret)).includes("retained"), { lastFy, thisFy, tags: await tagsOf(ret) });

  // ── 7. giving levels ────────────────────────────────────────────────────
  const lv = await person("Level Three Thousand", [[addDays(today, -20), 3000]]);
  await q(require("../../donorSummary").DONOR_SUMMARY_UPDATE("AND d.id = $2"), [org, lv]);
  const add = await api("POST", `/donors/${lv}/gifts`, tok, { amount: 3500, date: today, type: "check" });
  ok("§7 a gift is recorded", add.status === 200 || add.status === 201, add.status);
  const [st1] = await q(`SELECT status, total_giving::float AS t FROM donors WHERE id=$1`, [lv]);
  ok("§7 a $6,500 lifetime no longer writes a second level onto the person (mid)", st1.status !== "mid" && st1.status !== "major", st1);
  ok("§7 the tag reads Mid on the default cut points ($6,500 in 12 months)", (await tagsOf(lv)).includes("mid"), await tagsOf(lv));
  const put = await api("PUT", "/settings/giving-levels", tok, { mid: 1000, major: 5000 });
  ok("§7 the cut points change in Settings", put.status === 200, put.body);
  ok("§7 ...and the tag follows them (Major)", (await tagsOf(lv)).includes("major"), await tagsOf(lv));
  ok("§7 the Directory's level filter agrees", ids(await listOf("level=major")).includes(lv));
  ok("§7 a list asked for status=major (the Board's majors) reads the same level", same(ids(await listOf("status=major")), ids(await listOf("level=major"))), ids(await listOf("status=major")));
  const aud = ((await api("GET", "/communications/audience", tok)).body || {}).segments || [];
  const major = aud.find(s => s.id === "major") || { rows: [] };
  ok("§7 Communications' Major is the Major level, not $10,000 lifetime", major.rows.map(r => r.id).includes(lv), major);

  // ── 8. one household grouping ───────────────────────────────────────────
  const a = await person("Ada Lovelace", [[addDays(today, -40), 200]]), b = await person("Ben Lovelace", [[addDays(today, -50), 300]]);
  const c = await person("Cleo Marsh", [[addDays(today, -60), 50]]), dd = await person("Dev Marsh", [[addDays(today, -70), 70]]);
  await q(require("../../donorSummary").DONOR_SUMMARY_UPDATE(), [org]);
  const link = await api("POST", `/donors/${a}/relationships`, tok, { relatedDonorId: b, relationshipType: "spouse" });
  ok("§8 two people are linked as spouses", link.status === 201, link.body);
  const hhOf = async id => (await q(`SELECT household_id FROM donors WHERE id=$1`, [id]))[0].household_id;
  ok("§8 a spouse link puts them in one household", (await hhOf(a)) && (await hhOf(a)) === (await hhOf(b)), [await hhOf(a), await hhOf(b)]);
  const rel = (await api("GET", `/donors/${a}/relationships`, tok)).body || {};
  ok("§8 the household total is the household's own figure, not a sum over links", rel.householdTotalSource && rel.householdTotalSource.key === "household-giving" && Number(rel.householdTotal) === 500, rel);
  // A link made before this build (straight into the table) is migrated.
  await q(`INSERT INTO donor_relationships (id,org_id,donor_id_a,donor_id_b,relationship_type,created_by,created_by_name) VALUES ($1,$2,$3,$4,'household',${sys})`, [`drel_${org}`, org, c, dd]);
  const { checkOrg } = require("../../scripts/check-numbers");
  const before = (await checkOrg(org)).problems.find(p => p.rule === "household-one");
  ok("§8 the checker sees a linked pair that is not one household", before && before.count === 1, before);
  const db = require("../../db");
  if (typeof db.householdsFromLinks === "function") await db.householdsFromLinks(org);
  ok("§8 the migration puts an old linked pair in one household", (await hhOf(c)) && (await hhOf(c)) === (await hhOf(dd)), [await hhOf(c), await hhOf(dd)]);
  const [h] = await q(`SELECT created_by FROM households WHERE id=$1`, [await hhOf(c)]);
  ok("§8 ...stamped with the system actor", h && h.created_by === "system:fix49-households", h);

  // ── the checker holds the org to these rules ────────────────────────────
  const r = await checkOrg(org);
  const bad = r.problems.filter(p => ["lapse", "giving-level", "household-one"].includes(p.rule));
  ok("§6-8 the numbers checker finds every lapse, level and household rule holding", bad.length === 0, r.problems);
  ok("§6-8 ...and it knows the rules", ["lapse", "giving-level", "household-one"].every(k => require("../../scripts/check-numbers").RULES[k]));
  await wipe(`${PREFIX}%`);
};
