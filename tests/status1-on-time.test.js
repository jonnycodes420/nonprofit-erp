// tests/status1-on-time.test.js · STATUS-1. ONE PERSON, ONE ANSWER TO "ARE THEY ON TIME?"
//
// Seen on prod (3 Nov): a once-a-year donor six weeks past their expected gift
// read "On track: gives about once a year, latest gift on time" under a
// Lapsing tag, and a twice-a-year donor read "Nothing for 9 months" (268 days:
// the rule says under 9) beside Current. Whole months: due Aug 10, today Nov 3
// is 2 months 24 days past, said "2 months". The one rhythm is
// shared/numbers/rhythm.js; every door reads it.
//
//   §1 the rule, pure, on the brief's own dates (2026-11-03): case 1 is
//      Lapsing and past their usual time; case 2 is Current, "Nothing for 8
//      months. Now 2 months past their usual time."; a December giver is not
//      late in October and is in January; a span never rounds up across the
//      9-month line; the org's today at 00:05 UTC is New York's day.
//   §2 the same two people (made-up names) on a real server, dated from the
//      run's today: the profile's tag, its sentence, the Directory's filters
//      and Drift's line agree.
//   §3 a gift landing moves the tag, the sentence and the Directory row together.
//   §4 TRUTH-1's key (tests/lib/surfacesAgree.js) agrees, and goes red when the
//      lists read a stale rhythm (the planted defect).
"use strict";
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, civilToday } = require("./helpers");
const { assertSurfacesAgree } = require("./lib/surfacesAgree");
const RHY = require("../shared/numbers/rhythm");
const lapseRule = require("../lapseRule");
const drift = require("../drift");
const orgTime = require("../orgTime");
const engagement = require("../engagement");

const PASSWORD = "loadtest1234";
const ORG = "org_status1_ontime";
const EMAIL = `${ORG}@test.local`;
const P = s => `${ORG}_${s}`;
const add = orgTime.addDays;
const gifts = dates => dates.map(date => ({ date, amount: 717 }));
const stateOf = (gs, today) => lapseRule.lapseState(gs.map(g => g.date).sort().pop(), today, RHY.rhythmFor(gs, today));
const patternOf = (gs, today) => engagement.patternOf(gs.map(g => ({ date: g.date, cents: Math.round(g.amount * 100) })), today);

// The two people of the brief, as gift dates ending on their last gift.
function caseOne(last) {            // about once a year, a 259-day gap: due 259 days after the last gift
  const g2 = add(last, -259), g1 = add(g2, -259);
  return [add(g1, -300), g1, g2, last];
}
function caseTwo(last, gap) {       // about twice a year, `gap` days apart, five gifts
  return [4, 3, 2, 1, 0].map(k => add(last, -gap * k));
}

async function freshOrg() {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 5; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at,receipts_enabled)
           VALUES ($1,'Status Test Fund',$2,1,'active','team','America/New_York',NOW(),false)`, [ORG, ORG.replace(/_/g, "-")]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Robin Vale','admin')`, ["u_" + ORG, ORG, EMAIL, bcrypt.hashSync(PASSWORD, 4)]);
  return login(EMAIL, PASSWORD);
}
async function person(tok, id, name, dates) {
  await q(`INSERT INTO donors (id,org_id,name,stage,person_types,created_by,created_by_name,created_at)
           VALUES ($1,$2,$3,'active','["donor"]'::jsonb,'system:test/status1','STATUS-1 test',NOW() - INTERVAL '4 years')`, [P(id), ORG, name]);
  for (const date of dates) {
    const r = await api("POST", `/donors/${P(id)}/gifts`, tok, { amount: 717, date, type: "cash" });
    if (r.status !== 201) throw new Error(`gift for ${name} on ${date} answered ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  }
}
const idsOf = async (tok, path) => new Set((((await api("GET", `${path}&limit=200&offset=0`, tok)).body || {}).donors || []).map(d => d.id));

(async () => {
  // ── §1 the rule, pure, on the brief's own dates ─────────────────────────
  console.log("§1 the one rhythm, on 2026-11-03");
  const T = "2026-11-03";
  {
    const c1 = gifts(caseOne("2026-01-04"));
    const r = RHY.rhythmFor(c1, T);
    ok("§1 case 1: next gift expected Sep 20, 2026", r.expectedNext === "2026-09-20", r.expectedNext);
    ok("§1 case 1: past their usual time by six weeks", r.late && r.daysPast === 44 && RHY.pastPhrase(r, T) === "Now 6 weeks past their usual time.", [r.late, r.daysPast, RHY.pastPhrase(r, T)]);
    ok("§1 case 1: the tag is Lapsing", stateOf(c1, T) === "lapsing", stateOf(c1, T));
    ok("§1 case 1: the closeness pattern is late, never on track", patternOf(c1, T) === "late", patternOf(c1, T));
    const c2 = gifts(caseTwo("2026-02-08", 183));
    const a = drift.assessDrift(c2, T);
    ok("§1 case 2: the tag is Current (8 months 26 days is under the 9-month line)", stateOf(c2, T) === "giving", stateOf(c2, T));
    ok("§1 case 2: Cooling, past their usual time", patternOf(c2, T) === "late" && a.state === "drifting", [patternOf(c2, T), a.state]);
    ok("§1 case 2: the sentence counts whole months", a.reason === "Gave about twice a year for 2 years, usually around $717. Nothing for 8 months. Now 2 months past their usual time.", a.reason);
    ok("§1 a span never says 9 months while the rule says under 9", RHY.spanBetween("2026-02-08", T) === "8 months" && RHY.spanBetween("2026-02-03", T) === "9 months"
      && lapseRule.lapseState("2026-02-04", T) === "giving" && lapseRule.lapseState("2026-02-03", T) === "lapsing", [RHY.spanBetween("2026-02-08", T), RHY.spanBetween("2026-02-03", T)]);
    const dec = gifts(["2022-12-15", "2023-12-14", "2024-12-16", "2025-12-15"]);
    const oct = RHY.rhythmFor(dec, "2026-10-15"), jan = RHY.rhythmFor(dec, "2027-01-20");
    ok("§1 a December giver on Oct 15 is neither Lapsing nor past their time", !oct.late && oct.onTime && stateOf(dec, "2026-10-15") === "giving" && patternOf(dec, "2026-10-15") === "on_track",
      [oct.expectedNext, stateOf(dec, "2026-10-15"), patternOf(dec, "2026-10-15")]);
    ok("§1 …and on Jan 20 with no gift they are past it (and, a year on, Lapsed)", jan.late && !jan.onTime && stateOf(dec, "2027-01-20") === "lapsed" && patternOf(dec, "2027-01-20") === "lapsed",
      [jan.expectedNext, stateOf(dec, "2027-01-20")]);
    const yearly = gifts(["2024-04-02", "2025-04-04", "2026-04-03"]);
    ok("§1 a once-a-year giver whose gift is not due yet is on track", patternOf(yearly, T) === "on_track" && RHY.rhythmFor(yearly, T).expectedNext === "2027-04-30", RHY.rhythmFor(yearly, T).expectedNext);
    // (three Aprils: their season, so due by the end of April)
    // FIX-33 kept: four gifts in February, twice a year usually, is their year given.
    const burst = gifts(["2024-03-01", "2024-09-01", "2025-03-01", "2025-09-01", "2026-02-02", "2026-02-09", "2026-02-16", "2026-02-23"]);
    ok("§1 FIX-33: a person who has given their usual year is due when it runs out, so on track", patternOf(burst, T) === "on_track" && !RHY.rhythmFor(burst, T).late, RHY.rhythmFor(burst, T).expectedNext);
    // IDS-1's flake: 00:05 UTC on 4 Nov is 3 Nov in New York, and the rule reads New York's day.
    const at = new Date(Date.UTC(2026, 10, 4, 0, 5));
    const ny = orgTime.orgToday({ timezone: "America/New_York" }, at);
    ok("§1 at 00:05 UTC the org's today is New York's (Nov 3), and case 2 is still Current on it", ny === T && stateOf(c2, ny) === "giving"
      && RHY.spanBetween("2026-02-08", ny) === "8 months", ny);
  }

  // ── §2 the two people, on a server ──────────────────────────────────────
  console.log("\n§2 on a server, dated from the run's today");
  const today = civilToday();
  const tok = await freshOrg();
  const lastTwo = add(lapseRule.shiftMonths(today, 9), 5);                  // 8 whole months ago, under the line
  const gapTwo = 183;                                                       // twice a year: due about 2 months 25 days ago
  await person(tok, "one", "Avery Quill", caseOne(add(today, -303)));
  await person(tok, "two", "Bea Marlow", caseTwo(lastTwo, gapTwo));
  await person(tok, "ok", "Cal Penner", [add(today, -830), add(today, -465), add(today, -100)]);
  const status = async id => (await api("GET", `/donors/${P(id)}/status`, tok)).body || {};
  const tagsOf = st => (st.tags || []).map(t => t.key);
  const s1 = await status("one"), s2 = await status("two"), s3 = await status("ok");
  ok("§2 case 1: tagged Lapsing", tagsOf(s1).includes("lapsing"), tagsOf(s1));
  ok("§2 case 1: Cooling, and the sentence says how late", s1.closeness && s1.closeness.key === "cooling"
    && s1.closeness.facts[0] && s1.closeness.facts[0].text === "gives about once a year, now 6 weeks past their usual time", s1.closeness);
  ok("§2 case 2: tagged Current, not Lapsing", tagsOf(s2).includes("current") && !tagsOf(s2).includes("lapsing"), tagsOf(s2));
  const d2 = (await api("GET", `/donors/${P("two")}`, tok)).body || {};
  ok("§2 case 2: Cooling, and Drift's line counts whole months", s2.closeness && s2.closeness.key === "cooling" && d2.drift
    && /Nothing for 8 months\. Now 2 months past their usual time\.$/.test(d2.drift.reason), [s2.closeness && s2.closeness.key, d2.drift]);
  ok("§2 an on-time once-a-year giver: On track, saying only their pattern", s3.closeness && s3.closeness.key === "on_track"
    && s3.closeness.facts[0] && /^gives (every [A-Z][a-z]+|about once a year)$/.test(s3.closeness.facts[0].text), s3.closeness);
  ok("§2 nobody's sentence says on time", ![s1, s2, s3].some(s => JSON.stringify(s.closeness || {}).includes("on time")));
  const rail1 = (await api("GET", `/donors/${P("one")}/rail`, tok)).body || {};
  ok("§2 the rail's Next gift expected is the same date, and Late", rail1.rhythm && rail1.rhythm.expectedNext === add(today, -44) && rail1.rhythm.late === true, rail1.rhythm);
  const lapsingIds = await idsOf(tok, "/donors?lapsing=1"), onTrackIds = await idsOf(tok, "/donors?closeness=on_track");
  ok("§2 the Directory's Lapsing filter is case 1 only", lapsingIds.has(P("one")) && !lapsingIds.has(P("two")) && !lapsingIds.has(P("ok")), [...lapsingIds]);
  ok("§2 the Directory's On track filter is the on-time giver only", onTrackIds.has(P("ok")) && !onTrackIds.has(P("one")) && !onTrackIds.has(P("two")), [...onTrackIds]);

  // ── §3 a gift landing moves everything together ─────────────────────────
  console.log("\n§3 a gift lands");
  const g = await api("POST", `/donors/${P("one")}/gifts`, tok, { amount: 717, date: today, type: "cash" });
  ok("§3 the gift is recorded", g.status === 201, g.status);
  const s1b = await status("one");
  ok("§3 the tag is no longer Lapsing", !tagsOf(s1b).includes("lapsing"), tagsOf(s1b));
  ok("§3 the sentence is On track, with no lateness", s1b.closeness && s1b.closeness.key === "on_track" && !JSON.stringify(s1b.closeness.facts).includes("past their usual time"), s1b.closeness);
  const lapsingB = await idsOf(tok, "/donors?lapsing=1"), onTrackB = await idsOf(tok, "/donors?closeness=on_track");
  ok("§3 …and the Directory row moved with it, no stale pattern", !lapsingB.has(P("one")) && onTrackB.has(P("one")), { lapsing: [...lapsingB], onTrack: [...onTrackB] });

  // ── §4 TRUTH-1's key ─────────────────────────────────────────────────────
  console.log("\n§4 TRUTH-1's key");
  const only = ["homeLine", "drift", "groups", "events", "campaigns", "exports", "ask", "atlas", "moveReport", "search"];
  const r = await assertSurfacesAgree(ORG, { token: tok, soft: true, label: "STATUS-1", skip: only });
  const onTime = r.diffs.filter(x => x.startsWith("on time:"));
  ok(`§4 the profile, the Directory and Re-engage agree on time for every person (${r.facts.timeliness && r.facts.timeliness.people} people)`,
    !onTime.length && r.facts.timeliness && r.facts.timeliness.people === 3, onTime);
  // Planted: the lists read a rhythm that has not caught up (as the stored
  // nightly pattern did). The key must see the profile and the list disagree.
  await q(`UPDATE donor_rhythm SET expected_next = $1 WHERE org_id = $2 AND donor_id = $3`, [add(today, 200), ORG, P("two")]);
  const planted = await assertSurfacesAgree(ORG, { token: tok, soft: true, label: "STATUS-1 planted", skip: only });
  ok("§4 planted: a stale stored rhythm behind a list is caught (the key can fail)", planted.diffs.some(x => x.startsWith("on time:") && x.includes("Bea Marlow")), planted.diffs);

  await summary();
  await closeDb();
})().catch(async e => { console.error(e); try { await closeDb(); } catch (_) {} process.exit(1); });
