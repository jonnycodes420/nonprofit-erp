// tests/flows7-truth.test.js · FLOWS-7. THE FIRST STAGING NIGHT'S TIER 1s:
// NUMBERS AND LABELS THAT TOLD A CUSTOMER SOMETHING FALSE.
//
// Each section is one W-ID, checked against a key worked out by hand here,
// never against the app's own SQL. Red on main for each (planted defect named):
//   §1 Fundraising-04  pace: 50% raised at 50% of the time, projecting $9,902 of
//      $10,000, is Behind pace by $50 (planted: the rule ignoring the projection);
//      4,100 of 10,000 at half time is Behind, not On pace (main: a 10-point band).
//   §3 Fundraising-19  a draft whose video link names no video on file lands in
//      Drafts to review with the warning (planted: no linkCheck); a real one does not.
//   §4 Fundraising-16X the Overview and the campaign editor read one audience:
//      7 people, reasons exclusive and adding to 7, a person both unsubscribed and
//      bounced counted once as bounced, an archived record in neither (main: the
//      editor counted the archived one; planted: the Overview dropping a
//      doubly-suppressed person).
//   §5 Volunteers-19   the morning email counts and lists the tasks Tasks counts,
//      and the team row's overdue is Tasks' for that person (main: 1 of 3; threads).
//   §7 Volunteers-31X  the starter "Volunteers who have never given" = the rule
//      group Role Volunteer + Has never given = the roster's Never given (main: 1 vs 3).
// W-1112-Volunteers-03X is in tests/quickadd1.test.js §B4 (the browser leg);
// W-1112-Fundraising-05 is words on cards, walked, not pinned (CLAUDE.md).
"use strict";
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, civilPlusDays, civilToday, BASE } = require("./helpers");
const P = require("../shared/numbers/pace");

const ORG = "org_flows7", EMAIL = "admin@flows7.local", PASSWORD = "loadtest1234";
const U = { admin: "u_flows7_admin", dana: "u_flows7_dana" };

async function freshOrg() {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 5; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,'Flows Seven','flows-seven',1,'active','team','America/New_York')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Ari Admin','admin'), ($5,$2,'dana@flows7.local',$4,'Dana Field','member')`,
    [U.admin, ORG, EMAIL, bcrypt.hashSync(PASSWORD, 4), U.dana]);
  return login(EMAIL, PASSWORD);
}
const person = (id, name, extra = {}) => {
  const cols = { id, org_id: ORG, name, email: `${id}@flows7.example`, created_by: "test:flows7", created_by_name: "FLOWS-7 test", ...extra };
  const k = Object.keys(cols);
  return q(`INSERT INTO donors (${k.join(",")}) VALUES (${k.map((_, i) => "$" + (i + 1)).join(",")})`, k.map(x => cols[x]));
};

(async () => {
  const tok = await freshOrg();
  const today = civilToday();

  // ── §1 W-1112-Fundraising-04 · one pace rule ─────────────────────────────
  {
    const W = { goal: 10000, start: "2026-01-01", end: "2026-04-11", today: "2026-02-20" };   // 100 days, 50 gone; day 51 of 101
    const even = P.paceOf({ ...W, raised: 5000 });
    // By hand: 5000 ÷ 10000 = 50% ≥ 50 ÷ 100 = 50%, but 5000 × 101 ÷ 51 = 9,902 < 10,000.
    // Gap: what makes both true today, 10000 × 51 ÷ 101 − 5000 = 49.5 → $50.
    ok("§1 50% raised at 50% of the time, projecting $9,902 of $10,000, is Behind pace by $50",
      even && even.state === "behind" && even.label === "Behind pace" && even.math.projected === 9902 && even.gap === 50
      && even.sentence === "50% raised, 50% of the time gone, $50 short of pace", JSON.stringify(even));
    const band = P.paceOf({ ...W, raised: 4100 });   // 41% at 50%: the old band called this On pace
    ok("§1 41% raised at 50% of the time is Behind pace, $950 short (10000 × 51 ÷ 101 − 4100)", band && band.state === "behind" && band.gap === 950, JSON.stringify(band));
    const ahead = P.paceOf({ ...W, raised: 7000 });
    ok("§1 70% at 50% is Ahead, its projection over the goal", ahead && ahead.state === "ahead" && ahead.math.projected >= 10000 && ahead.gap === 0, JSON.stringify(ahead));
    const committed = P.paceOf({ ...W, raised: 6000, basis: "committed" });
    ok("§1 a committed basis says so in its sentence", committed && /% committed,/.test(committed.sentence) && / committed by day /.test(committed.math.sentence), JSON.stringify(committed));

    // The cards: the overview's campaigns read the same rule.
    await q(`INSERT INTO campaigns (id,org_id,name,goal_amount,status,start_date,end_date,goal_category) VALUES
      ('c_f7_behind',$1,'Behind Push',10000,'active',$2,$3,'project'), ('c_f7_ahead',$1,'Ahead Push',10000,'active',$2,$3,'project')`,
      [ORG, civilPlusDays(-50), civilPlusDays(50)]);
    await person("d_f7_giver", "Gale Giver");
    for (const [c, amt] of [["c_f7_behind", 4100], ["c_f7_ahead", 7000]])
      await api("POST", "/donors/d_f7_giver/gifts", tok, { amount: amt, date: civilPlusDays(-1), type: "cash", payment_method: "Check", campaignId: c });
    const ov = (await api("GET", "/fundraising/overview", tok)).body || {};
    const card = id => (ov.goals || []).find(g => g.id === id) || {};
    ok("§1 the Behind Push card says Behind pace with its gap in dollars; Ahead Push is Ahead",
      card("c_f7_behind").paceState === "behind" && card("c_f7_behind").paceGap > 0 && /short of pace/.test(card("c_f7_behind").paceSentence || "")
      && card("c_f7_ahead").paceState === "ahead", JSON.stringify([card("c_f7_behind").paceState, card("c_f7_behind").paceGap, card("c_f7_behind").paceSentence, card("c_f7_ahead").paceState]));
  }

  // ── §4 W-1112-Fundraising-16X · one audience, reasons that add up ────────
  {
    await person("d_f7_a", "Ada Plain");                                                        // type_off (Campaign emails off)
    await person("d_f7_b", "Bo Both", { do_not_email: true, email_unreachable: true });           // unsubscribed AND bounced: one bucket, bounced
    await person("d_f7_c", "Cy Twice");                                                         // suppressed twice: bounced, then unsubscribed later
    await q(`INSERT INTO email_suppressions (id,org_id,email,reason,source,created_at) VALUES
      ('sup_f7_c1',$1,'d_f7_c@flows7.example','bounced','test',NOW() - INTERVAL '3 days'), ('sup_f7_c2',$1,'d_f7_c@flows7.example','unsubscribed','test',NOW() - INTERVAL '1 day'),
      ('sup_f7_f',$1,'d_f7_f@flows7.example','unsubscribe','test',NOW() - INTERVAL '1 day')`, [ORG]);
    await person("d_f7_d", "Dee Archived", { email_unreachable: true, archived_at: new Date("2026-01-05T12:00:00Z") });   // in neither
    await person("d_f7_e", "Eve Noaddress", { email: null });                                   // no_email
    await person("d_f7_f", "Fay Unsub");                                                        // "unsubscribe" spelling
    await person("d_f7_g", "Gus Optout", { do_not_email: true });                               // unsubscribed
    // By hand, Everyone with an email: the giver from §1 and these, the archived one out = 7 people.
    const KEY = { members: 7, groups: { no_email: 1, unsubscribed: 2, bounced: 2, type_off: 2 } };
    const sum = g => Object.values(g).reduce((n, v) => n + v, 0);
    const aud = ((await api("GET", "/audiences", tok)).body.audiences || []).find(a => a.mode === "everyone") || {};
    const ovGroups = Object.fromEntries((aud.cannot || []).map(g => [g.reason, g.count]));
    const ed = (await api("POST", "/campaigns/segment-preview", tok, { segment: { mode: "everyone" } })).body || {};
    const edGroups = Object.fromEntries((ed.leftOut || []).map(g => [g.reason, g.count]));
    ok("§4 the Overview: 7 people, reasons exclusive and adding to 7, both-suppressed counted once as bounced",
      aud.members === KEY.members && JSON.stringify(ovGroups, Object.keys(KEY.groups).sort()) === JSON.stringify(KEY.groups, Object.keys(KEY.groups).sort())
      && sum(ovGroups) + (aud.count || 0) === KEY.members, JSON.stringify({ members: aud.members, ovGroups, reach: aud.count, sentence: aud.sentence }));
    ok("§4 the campaign editor: the same 7 and the same reasons, the archived record in neither",
      ed.audience && ed.audience.total === KEY.members && JSON.stringify(edGroups, Object.keys(KEY.groups).sort()) === JSON.stringify(KEY.groups, Object.keys(KEY.groups).sort())
      && !(ed.leftOut || []).some(g => (g.people || []).some(p => p.id === "d_f7_d")), JSON.stringify({ line: ed.audience && ed.audience.line, edGroups }));
  }

  // ── §5 W-1112-Volunteers-19 · the morning email counts what Tasks counts ──
  {
    const T = (id, title, due, who, extra = "") => q(`INSERT INTO tasks (id,org_id,title,due,assigned_to,done${extra ? ",link_kind" : ""}) VALUES ($1,$2,$3,$4,$5,0${extra ? ",$6" : ""})`,
      extra ? [id, ORG, title, due, who, extra] : [id, ORG, title, due, who]);
    await T("t_f7_1", "Call the Hollis family", civilPlusDays(-3), U.admin);
    await T("t_f7_2", "Send the board packet", civilPlusDays(-1), U.admin, "next_step");   // a next step: Tasks counts it
    await T("t_f7_3", "Unowned follow-up", today, null);                                 // unowned: an admin's "mine" holds it
    await T("t_f7_4", "Next week's visit", civilPlusDays(5), U.admin);                    // upcoming: not due
    await q(`INSERT INTO tasks (id,org_id,title,due,assigned_to,done) VALUES ('t_f7_5',$1,'Done already',$2,$3,1)`, [ORG, civilPlusDays(-2), U.admin]);
    for (let i = 1; i <= 3; i++) await T(`t_f7_d${i}`, `Dana overdue ${i}`, civilPlusDays(-i), U.dana);
    await T("t_f7_d4", "Dana later", civilPlusDays(40), U.dana);
    // By hand: mine = 2 overdue (t1, t2) + 1 today (t3) = 3. Dana: 4 open, 3 overdue.
    const mine = (await api("GET", "/tasks/counts?scope=mine", tok)).body || {};
    const dana = (await api("GET", `/tasks/counts?staff=${U.dana}`, tok)).body || {};
    await q(`UPDATE users SET brief_sections = NULL WHERE org_id = $1`, [ORG]).catch(() => {});
    const mail = (await api("GET", "/me/morning-email", tok)).body || {};
    const html = String(mail.html || "");
    const listed = ["Call the Hollis family", "Send the board packet", "Unowned follow-up"].filter(t => html.includes(t));
    ok("§5 Tasks says 3 due or overdue for the admin (2 overdue, 1 today), and Dana 4 open, 3 overdue (the key)",
      mine.overdue === 2 && mine.today === 1 && dana.overdue === 3 && dana.open === 4, JSON.stringify({ mine, dana }));
    ok("§5 the morning email lists every task Tasks counts, and none it doesn't",
      listed.length === 3 && !html.includes("Next week's visit") && !html.includes("Done already"), JSON.stringify({ listed, subject: mail.subject }));
    const row = /Dana Field<span[^>]*> · (\d+) open(?: · (\d+) overdue)?/.exec(html.replace(/\s+/g, " "));
    ok("§5 the team row's Dana is Tasks' Dana: 4 open, 3 overdue",
      !!row && Number(row[1]) === dana.open && Number(row[2] || 0) === dana.overdue, row ? row[0] : html.slice(html.indexOf("across the team") - 50, html.indexOf("across the team") + 400));
  }

  // ── §3 W-1112-Fundraising-19 · a draft's links open ──────────────────────
  {
    const host = ((await api("GET", "/health")).body || {}).publicUrl || {};
    const base = String(host.url || "http://localhost:4173").replace(/\/+$/, "");
    await person("d_f7_h", "Hana Heard");
    // FLOWS-9: a playable video is one whose recording is in the store, so the real one has its asset.
    await q(`INSERT INTO portal_assets (id,org_id,kind,content_type,bytes,storage,data) VALUES ('pa_f7_real',$1,'video_thanks','video/webm',10,'db','AAAA') ON CONFLICT (id) DO NOTHING`, [ORG]);
    await q(`INSERT INTO video_thanks (id,org_id,donor_id,asset_id,mime,bytes,duration_seconds,token,created_by,created_by_name)
             VALUES ('vt_f7_real',$1,'d_f7_h','pa_f7_real','video/webm',10,3,'realTokenFlows7realTokenFlows7AB','test:flows7','FLOWS-7 test')`, [ORG]);
    const draft = (id, body) => q(`INSERT INTO milestone_drafts (id,org_id,donor_id,milestone_key,subject,body,status,source,created_by,created_by_name)
             VALUES ($1,$2,'d_f7_h',$1,'A thank-you',$3,'pending_review','video_thanks','test:flows7','FLOWS-7 test')`, [id, ORG, body]);
    await draft("md_f7_dead", `Dear Hana,\n\nI recorded a short video to say thank you. You can watch it here:\n\n${base}/v/goneTokenFlows7goneTokenFlows7XY\n\nWith gratitude`);
    await draft("md_f7_real", `Dear Hana,\n\nI recorded a short video to say thank you. You can watch it here:\n\n${base}/v/realTokenFlows7realTokenFlows7AB\n\nWith gratitude`);
    const rows = (await api("GET", "/milestone-drafts", tok)).body || [];
    const dead = rows.find(r => r.id === "md_f7_dead") || {}, real = rows.find(r => r.id === "md_f7_real") || {};
    ok("§3 a draft whose video link names no video lands with the warning naming the link",
      dead.linkCheck && dead.linkCheck.ok === false && /goneTokenFlows7/.test(dead.linkCheck.sentence || "") && /not here/.test(dead.linkCheck.sentence || ""), JSON.stringify(dead.linkCheck));
    ok("§3 the same draft with the real video's link carries no warning", real.linkCheck && real.linkCheck.ok === true, JSON.stringify(real.linkCheck));
    const status = (await q(`SELECT status FROM milestone_drafts WHERE id IN ('md_f7_dead','md_f7_real')`)).map(r => r.status);
    ok("§3 nothing sends: both are still drafts", status.length === 2 && status.every(s => s === "pending_review"), status);
  }

  // ── §7 W-1112-Volunteers-31X · one meaning of "volunteer who never gave" ─
  {
    const VOL = JSON.stringify(["volunteer"]);
    for (const [id, name] of [["d_f7_v1", "Val One"], ["d_f7_v2", "Vic Two"], ["d_f7_v3", "Viv Three"], ["d_f7_v4", "Vera Gave"]])
      await person(id, name, { person_types: VOL, email: null });
    await api("POST", "/donors/d_f7_v4/gifts", tok, { amount: 50, date: civilPlusDays(-10), type: "cash", payment_method: "Cash" });
    await person("d_f7_s1", "Sam Shiftonly", { person_types: JSON.stringify(["donor"]), email: null });   // a shift, never typed Volunteer
    await q(`INSERT INTO volunteer_shifts (id,org_id,person_id,date,hours,created_by,created_by_name) VALUES ('vs_f7_1',$1,'d_f7_s1',$2,2,'test:flows7','FLOWS-7 test')`, [ORG, civilPlusDays(-5)]);
    // By hand: Volunteer type and no gift = v1, v2, v3 = 3.
    const st = ((await api("GET", "/groups/starters", tok)).body.starters || []).find(s => s.key === "volunteers_never_gave") || {};
    const g = (await api("POST", "/groups", tok, { name: "Role Volunteer never gave", kind: "dynamic", rules: { role: "volunteer", given: "never" } })).body || {};
    const gc = (await api("GET", `/groups/${g.id}`, tok)).body || {};
    const groupCount = gc.count ?? gc.memberCount ?? (gc.members || gc.people || []).length;
    const roster = (await api("GET", "/volunteer-hub/list?given=never", tok)).body || {};
    ok("§7 the starter, the rule group and the roster's Never given all say 3",
      st.count === 3 && groupCount === 3 && (roster.rows || []).length === 3, JSON.stringify({ starter: st.count, group: groupCount, roster: (roster.rows || []).length }));
  }

  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
