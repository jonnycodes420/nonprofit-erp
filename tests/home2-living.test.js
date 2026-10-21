// tests/home2-living.test.js · HOME-2. HOME CHANGES WITH THE DAY.
//
// Home's lead slot (GET /home/lead, shared/homeLead.js) puts the one or two
// things that matter most today at the top, each with the line that says why.
// This suite builds a small Harborlight-shaped org of its own (no suite logs in
// to the demo) and reads Home as of three pinned moments (`?at=`, TEST_MODE):
//   §1  a Tuesday with a lunch in two hours: the meeting leads, with its reason
//   §2  the morning after a $7,500 gift, with 5 gifts waiting: both lead
//   §3  15 December: the year-end card leads, naming who gave last December
//   §4  a day with nothing on it: the lead is never empty
//   §5  a director and an officer see different leads (the officer's own day)
//   §6  three "Not now"s of a kind rank that kind lower, for that person only
//   §7  the Ask box, the Thread and the mic never move: the rail only orders
//       its own blocks, and the lead is drawn under Ask, above the Thread
//
// HOW IT WOULD GO RED. On main there is no /home/lead (every section fails).
// Planted: dropping the officer's `assigned_to` filter turned §5 red; making
// DISMISS_RUN 99 turned §6 red; returning [] from rankLead's quiet fallback
// turned §4 red.
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
const { BASE, ok, summary, q, closeDb } = require("./helpers");
const { testNow } = require("./clock");

const ORG = "org_home2t";
const TZ = "America/New_York";
const DIR = `u_${ORG}_dir`, OFF = `u_${ORG}_off`;
// The year whose 15 December is next.
const now = new Date(testNow());
const Y = now.getUTCMonth() === 11 && now.getUTCDate() > 15 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
const DAY1 = `${Y}-10-20`, DAY2 = `${Y}-10-21`, DAY3 = `${Y}-12-15`, QUIET = `${Y}-08-04`;
// New York: daylight time in August and October, standard time in December.
const at = (day, hhmm, off = day.slice(5, 7) === "12" ? "-05:00" : "-04:00") => new Date(`${day}T${hhmm}:00${off}`).toISOString();

async function reset() {
  for (const t of ["home_lead_dismissals", "capture_items", "calendar_events", "thank_you_drafts", "threads", "gifts", "campaigns", "donors"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,'Harborlight Test','home2-living-test',1,'active','team',$2)
           ON CONFLICT (id) DO UPDATE SET timezone=EXCLUDED.timezone`, [ORG, TZ]);
  const hash = bcrypt.hashSync("loadtest1234", 10);
  for (const [id, role, name] of [[DIR, "admin", "Dana Test"], [OFF, "member", "Priya Test"]])
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (id) DO UPDATE SET password_hash=EXCLUDED.password_hash, role=EXCLUDED.role`, [id, ORG, `${role}@${ORG}.test`, hash, name, role]);
  const donor = (id, name, owner, kind = null) => q(`INSERT INTO donors (id,org_id,name,kind,assigned_to,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,$6,'Test')`,
    [id, ORG, name, kind, owner, DIR]);
  const gift = (id, donorId, amount, date, extra = {}) => q(
    `INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name,received_at,created_at,acknowledgement_sent,thanked_at)
     VALUES ($1,$2,$3,$4,$5,'donation',$6,'Test',$7,COALESCE($7::timestamptz, ($5::text || 'T12:00:00Z')::timestamptz),$8,$9)`,
    [id, ORG, donorId, amount, date, extra.by || DIR, extra.receivedAt || null, extra.thanked ? true : false, extra.thanked ? extra.thanked : null]);
  await donor("d_h2_ansel", "Ansel Pendlebury", DIR);
  await donor("d_h2_halv", "Halvorsen Family Foundation", DIR, "organisation");
  await donor("d_h2_leo", "Leopold Gillingwater", OFF);
  await donor("d_h2_wil", "Wilhelmina Ashenhurst", DIR);
  await donor("d_h2_fen", "Fenwick Ravensmere", OFF);
  for (let i = 0; i < 8; i++) await donor(`d_h2_small${i}`, `Small Giver ${i}`, i % 2 ? OFF : DIR);
  // Lifetimes: Ansel is the org's largest; the small givers set the line.
  // Every February, this year included, so he is not drifting on any day this suite reads.
  for (let k = 0; k < 4; k++) await gift(`g_h2_ansel${k}`, "d_h2_ansel", 40000, `${Y - k}-02-10`, { thanked: `${Y - k}-02-11T12:00:00Z` });
  for (let i = 0; i < 8; i++) await gift(`g_h2_small${i}`, `d_h2_small${i}`, 100 + i * 25, `${Y}-03-0${i + 1}`, { thanked: `${Y}-03-10T12:00:00Z` });
  await gift("g_h2_leo", "d_h2_leo", 12000, `${Y - 1}-06-01`, { thanked: `${Y - 1}-06-02T12:00:00Z` });
  // Last December, and nothing since: Wilhelmina (Dana's) and Fenwick (Priya's).
  await gift("g_h2_wil_dec", "d_h2_wil", 2500, `${Y - 1}-12-10`, { thanked: `${Y - 1}-12-11T12:00:00Z` });
  await gift("g_h2_fen_dec", "d_h2_fen", 1800, `${Y - 1}-12-12`, { thanked: `${Y - 1}-12-13T12:00:00Z` });
  // Halvorsen gave $5,000 a year before; $7,500 arrives at 9:42 the night before DAY2, through the giving page.
  await gift("g_h2_halv0", "d_h2_halv", 5000, `${Y - 1}-09-15`, { thanked: `${Y - 1}-09-16T12:00:00Z` });
  await gift("g_h2_halv1", "d_h2_halv", 7500, DAY1, { by: "system:stripe-webhook", receivedAt: at(DAY1, "21:42") });
  // Dana's lunch on DAY1 at noon; Priya's coffee on DAY1 at 3:30.
  for (const [id, owner, title, person, hhmm] of [["cal_h2_lunch", DIR, "Lunch with Ansel Pendlebury", "d_h2_ansel", "12:00"], ["cal_h2_coffee", OFF, "Coffee with Leopold Gillingwater", "d_h2_leo", "15:30"]])
    await q(`INSERT INTO calendar_events (id,org_id,owner_user_id,provider,provider_event_id,title,starts_at,ends_at,location,person_ids,created_by)
             VALUES ($1,$2,$3,'google',$1,$4,$5,$6,'Windy Corner',$7,'system:test')`,
      [id, ORG, owner, title, at(DAY1, hhmm), at(DAY1, String(Number(hhmm.slice(0, 2)) + 1).padStart(2, "0") + hhmm.slice(2)), [person]]);
  // Five gifts waiting in To confirm, $3,325, arriving the evening of DAY1.
  for (const [i, kind, cents] of [[1, "check", 100000], [2, "check", 75000], [3, "check", 50000], [4, "pledge", 50000], [5, "daf_grant", 57500]])
    await q(`INSERT INTO capture_items (id,org_id,kind,stakes,status,source,proposal,received_at,created_by)
             VALUES ($1,$2,$3,'money','waiting','photo',$4,$5,'system:test')`,
      [`cap_h2_${i}`, ORG, kind, JSON.stringify({ amount: { cents } }), at(DAY1, "19:00")]);
  // Lifetime totals from the gifts, the rollup the seed and recordGift keep.
  await q(`UPDATE donors d SET total_giving=s.t, gift_count=s.n, first_gift_date=s.f, last_gift_date=s.l
             FROM (SELECT donor_id, SUM(amount) t, COUNT(*) n, MIN(date) f, MAX(date) l FROM gifts WHERE org_id=$1 GROUP BY donor_id) s
            WHERE d.id=s.donor_id AND d.org_id=$1`, [ORG]);
  // The year-end appeal.
  await q(`INSERT INTO campaigns (id,org_id,name,type,status,goal_amount,start_date,end_date) VALUES ('camp_h2_ye',$1,$2,'appeal','active',60000,$3,$4)`,
    [ORG, `Year-end ${Y}`, `${Y}-11-16`, `${Y}-12-31`]);
}

async function token(role) {
  const r = await fetch(BASE + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `${role}@${ORG}.test`, password: "loadtest1234" }) });
  return (await r.json()).token;
}
const lead = async (tok, iso) => {
  const r = await fetch(`${BASE}/home/lead?explain=1&at=${encodeURIComponent(iso)}`, { headers: { Authorization: "Bearer " + tok } });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body, kinds: (body.lead || []).map(c => c.kind), score: k => ((body.ranked || []).find(c => c.kind === k) || {}).score };
};

(async () => {
  try {
    await reset();
    const dir = await token("admin"), off = await token("member");

    // §1 A Tuesday with a lunch in two hours.
    const d1 = await lead(dir, at(DAY1, "10:00"));
    ok("§1 /home/lead answers", d1.status === 200, d1.status);
    ok("§1 the lunch leads", d1.kinds[0] === "meeting" && /Ansel/.test(d1.body.lead[0].title), d1.kinds);
    ok("§1 it says why, in words", /in 2 hours/.test((d1.body.lead[0] || {}).why || ""), (d1.body.lead[0] || {}).why);
    // The card carries VOICE-3's brief (routes/finance.js meetingBrief). After
    // VOICE-3 the brief's export went missing and the card came back empty.
    const b1 = (d1.body.lead[0] || {}).brief;
    ok("§1 the meeting card carries the brief: what he has given", b1 && b1.giving && /\$160,000/.test(b1.giving.text), b1);
    ok("§1 the rail puts the meeting first", (d1.body.rail || [])[0] === "meetings", d1.body.rail);
    ok("§1 the score never reaches the card", d1.body.lead && !("score" in d1.body.lead[0]) && !("points" in d1.body.lead[0]));

    // §2 The morning after the $7,500 gift, with 5 gifts waiting.
    const d2 = await lead(dir, at(DAY2, "08:05"));
    const g = (d2.body.lead || []).find(c => c.kind === "gift"), c = (d2.body.lead || []).find(c => c.kind === "confirm");
    ok("§2 the gift leads", d2.kinds[0] === "gift" && g && g.amount === 7500 && /Halvorsen/.test(g.title), d2.kinds);
    ok("§2 its reason says it is their largest and when it came", g && /largest/.test(g.why) && /9:42 pm last night/.test(g.why), g && g.why);
    ok("§2 the 5 waiting gifts are second, $3,325", c && c.count === 5 && c.amount === 3325, c);
    ok("§2 the thank-you tile is at the top of the rail", (d2.body.rail || [])[0] === "thankClock", d2.body.rail);

    // §3 15 December.
    const d3 = await lead(dir, at(DAY3, "08:10"));
    const s = (d3.body.lead || [])[0] || {};
    ok("§3 the year-end card leads", s.kind === "season" && s.goal === 60000, d3.kinds);
    ok("§3 it names who gave last December", /2 people who gave last December/.test(s.why || ""), s.why);
    // The fixture's five cards are still waiting in December, and $3,325 not
    // yet confirmed can outrank a $2,500 call; the call is in the top three.
    const call = (d3.body.ranked || []).findIndex(x => x.key === "seasonCall:d_h2_wil");
    ok("§3 the first of them, Wilhelmina, is a call in the top three", call >= 0 && call <= 2, d3.body.ranked);
    ok("§3 the October suggestions give way to the season's", (d3.body.tries || [])[0] === "Who gave last December but not this one?", d3.body.tries);

    // §4 A day with nothing on it.
    const q4 = await lead(dir, at(QUIET, "09:00"));
    ok("§4 the lead is never empty", q4.kinds.length === 1 && q4.kinds[0] === "quiet" && !!q4.body.lead[0].title, q4.kinds);

    // §5 Director and officer.
    const o1 = await lead(off, at(DAY1, "10:00"));
    ok("§5 the officer leads with her own coffee, not the director's lunch", o1.kinds[0] === "meeting" && /Leopold/.test(o1.body.lead[0].title), o1.body.lead && o1.body.lead.map(x => x.title));
    const o2 = await lead(off, at(DAY2, "08:05"));
    ok("§5 the officer is not shown the director's gift or the org's To confirm", !o2.kinds.includes("gift") && !o2.kinds.includes("confirm"), o2.kinds);
    const o3 = await lead(off, at(DAY3, "08:10"));
    ok("§5 on 15 December the officer's list is her portfolio", /1 person who gave last December in your portfolio/.test((o3.body.lead[0] || {}).why || "") && /Fenwick/.test((o3.body.lead[1] || {}).title || ""), o3.body.lead && o3.body.lead.map(x => x.why || x.title));
    ok("§5 the two leads differ", JSON.stringify(d1.body.lead) !== JSON.stringify(o1.body.lead));

    // §6 Three "Not now"s of a kind.
    const before = d3.score("season"), offBefore = o3.score("season");
    for (let i = 0; i < 3; i++) {
      const r = await fetch(BASE + "/home/lead/dismiss", { method: "POST", headers: { Authorization: "Bearer " + dir, "Content-Type": "application/json" }, body: JSON.stringify({ kind: "season", key: `season:camp_h2_ye` }) });
      ok(`§6 Not now #${i + 1} is accepted`, r.status === 200, r.status);
    }
    const d3b = await lead(dir, at(DAY3, "08:10")), o3b = await lead(off, at(DAY3, "08:10"));
    ok("§6 the kind ranks lower for that person", d3b.score("season") < before, { before, after: d3b.score("season"), lead: d3b.kinds });
    ok("§6 and not for anybody else", o3b.score("season") === offBefore && o3b.kinds[0] === "season", { offBefore, after: o3b.score("season") });
    const bad = await fetch(BASE + "/home/lead/dismiss", { method: "POST", headers: { Authorization: "Bearer " + dir, "Content-Type": "application/json" }, body: JSON.stringify({ kind: "quiet", key: "quiet" }) });
    ok("§6 the quiet card cannot be set aside", bad.status === 400, bad.status);

    // §7 Ask, the Thread and the mic never move.
    const RAIL = new Set(["meetings", "thankClock", "mailbox", "firstThing", "tiles"]);
    ok("§7 the rail only orders its own five blocks", [d1, d2, d3, q4, o1].every(x => (x.body.rail || []).length === 5 && x.body.rail.every(k => RAIL.has(k))));
    const src = f => fs.readFileSync(path.join(__dirname, "..", "client", "src", f), "utf8");
    const hero = src("components/AskRail.jsx"), dash = src("components/Dashboard.jsx"), app = src("App.jsx");
    ok("§7 the lead is drawn under the Ask box", hero.indexOf('data-testid="ask-hero-input"') > 0 && hero.indexOf('data-testid="ask-hero-input"') < hero.indexOf("{lead}"));
    ok("§7 the Ask box heads Home and the Thread stays in the work column", dash.indexOf("<AskHero") > 0 && dash.indexOf("<AskHero") < dash.indexOf("home-shell-main") && /homeHead/.test(dash));
    ok("§7 the mic is App's, outside Home", /<MicGlyph size=\{24\}\/>/.test(app) && !/MicGlyph/.test(src("components/HomeLead.jsx")));
  } catch (e) {
    ok("suite ran", false, e.stack);
  } finally {
    await closeDb();
    summary();
  }
})();
