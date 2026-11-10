// SCALE-3 · THE LOAD BAR FOR RETENTION, AND THE CAPACITY GAUGE ON /ops.
//
// Guards production's capacity decisions: the gauge is what tells Jonathan to
// add a web replica or give the worker more room (Railway settings that cost
// money), and the load bar is what the nightly holds every route to.
//
//   §1 the load bar (scripts/load/ten-orgs.js report): retention at 700 ms p95
//      passes; the planted slow retention (1,200 ms, and 850 ms against its own
//      800 ms bar) fails, by name.
//   §2 the gauge (server/perf/capacity.js summarize) on a fixture of samples:
//      each line's colour against its threshold, and the sentence:
//        three days of web lag over 100 ms   → "Add a second web replica"
//        three days of request p95 over 800  → the same
//        two days only                       → nothing to add
//        three nights of jobs waiting 15 min → "Give the worker more room"
//        both                                → both
//        no samples                          → says there are none
//   §3 /ops carries the card's answer, for a super-admin only (the door is
//      devboard1-ops's; this checks the field is there and has the sentence).
//
// PLANTED: the retention bar removed from report() turns §1's 850 ms case
// green (red here); summarize()'s three-in-a-row made two turns §2 red.
const { ok, summary, q, closeDb, api, login } = require("./helpers");
const { testNow } = require("./clock");
const TEN = require("../scripts/load/ten-orgs");
const CAP = require("../server/perf/capacity");

const route = (name, p95) => [name, Array.from({ length: 40 }, (_, i) => (i < 36 ? 100 : p95))];
const bar = (retentionP95) => TEN.report({
  stats: new Map([route("GET /donors", 300), route("GET /reports/retention", retentionP95)]),
  fivexx: new Map(), slowest: { ms: retentionP95, route: "GET /reports/retention" }, profileOpens: [400, 500], checkoutTimeouts: 0, USERS: 20, DURATION: 300000,
});

// Samples every five minutes for `days` days, ending at `now`.
function samples(now, days, f) {
  const out = [];
  for (let t = now - days * 864e5 + 3e5; t <= now; t += 3e5) out.push({ at: new Date(t).toISOString(), ...f(t) });
  return out;
}
const web = (o = {}) => ({ process: "web-a", role: "web", lagP95: 20, busyPct: 30, reqP95: 200, poolWaitP95: 5, poolPeakPct: 40, queueOldestS: null, failedHour: null, ...o });
const wkr = (o = {}) => ({ process: "worker-a", role: "worker", lagP95: 10, busyPct: 20, reqP95: null, poolWaitP95: 2, poolPeakPct: 20, queueOldestS: 30, failedHour: 0, ...o });
const nyHour = t => Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hourCycle: "h23" }).format(new Date(t)));
const line = (c, key) => c.lines.find(l => l.key === key);

(async () => {
  // §1 the load bar
  const fine = bar(700), slow = bar(1200), tight = bar(850);
  ok("§1 retention at 700 ms p95 is inside the bar", fine.pass === true, JSON.stringify(fine.misses));
  ok("§1 the planted slow retention (1,200 ms) fails the run", slow.pass === false && slow.misses.some(m => /GET \/reports\/retention p95 1200 ms/.test(m)), JSON.stringify(slow.misses));
  ok("§1 retention has its own 800 ms bar (850 ms fails, by name)", tight.pass === false && tight.misses.some(m => /retention p95 850 ms \(its bar is 800 ms\)/.test(m)), JSON.stringify(tight.misses));
  ok("§1 another route at 850 ms is still inside the 1 s bar", !tight.misses.some(m => /GET \/donors/.test(m)));

  // §2 the gauge
  const now = testNow();
  const pass = { ok: true, level: "ok", detail: "last run 3h ago · slowest GET /donors p95 640 ms" };
  const quiet = CAP.summarize([...samples(now, 7, () => web()), ...samples(now, 7, () => wkr())], pass, now);
  ok("§2 a quiet week: nothing to add", quiet.advice === "none" && quiet.sentence === CAP.SAY.none, quiet.sentence);
  ok("§2 every line green, with its threshold beside it", quiet.lines.filter(l => l.key !== "load").every(l => l.dayColour === "green" && l.weekColour === "green" && /amber at .* red at /.test(l.threshold)),
    JSON.stringify(quiet.lines.map(l => [l.key, l.dayColour, l.weekColour])));
  ok("§2 the nightly load result is a line, green when it passed", line(quiet, "load").dayColour === "green" && /slowest GET \/donors/.test(line(quiet, "load").day));
  ok("§2 a failed nightly is red", line(CAP.summarize([web({ at: new Date(now).toISOString() })], { ok: true, level: "red", detail: "misses: retention" }, now), "load").dayColour === "red");

  const amber = CAP.summarize(samples(now, 1, () => web({ lagP95: 70, busyPct: 70, reqP95: 600, poolWaitP95: 100, poolPeakPct: 75 })), pass, now);
  ok("§2 lag 70 ms, busy 70%, requests 600 ms, wait 100 ms, 75% of the pool: amber each",
    ["lagP95", "busyPct", "reqP95", "poolWaitP95", "poolPeakPct"].every(k => line(amber, k).dayColour === "amber"), JSON.stringify(amber.lines.map(l => [l.key, l.day, l.dayColour])));
  const lag3 = CAP.summarize(samples(now, 3, () => web({ lagP95: 150 })), pass, now);
  ok("§2 three days of web lag over 100 ms: add a second web replica", lag3.advice === "replica" && /^Add a second web replica/.test(lag3.sentence), lag3.sentence);
  ok("§2 and the lag line is red", line(lag3, "lagP95").dayColour === "red" && line(lag3, "lagP95").day === 150);
  const req3 = CAP.summarize(samples(now, 3, () => web({ reqP95: 950 })), pass, now);
  ok("§2 three days of request p95 over 800 ms: add a second web replica", req3.advice === "replica", req3.sentence);
  const two = CAP.summarize([...samples(now - 864e5 * 1, 2, () => web({ lagP95: 150 })), ...samples(now, 1, () => web())], pass, now);
  ok("§2 two bad days and a good one: nothing to add yet", two.advice === "none", `${two.advice} ${two.days}`);
  const nyDay = t => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(t));
  const lastTwo = new Set([nyDay(now), nyDay(now - 864e5)]);
  const onlyTwo = CAP.summarize(samples(now, 3, () => web({ lagP95: 150 })).filter(r => lastTwo.has(nyDay(r.at))), pass, now);
  ok("§2 only two days of samples, both bad: not three in a row yet, and it says the web is over today", onlyTwo.advice === "watch" && onlyTwo.sentence === CAP.SAY.watch, `${onlyTwo.advice} ${onlyTwo.days}`);
  const nights = CAP.summarize([...samples(now, 3, () => web()), ...samples(now, 3, t => wkr({ queueOldestS: nyHour(t) < 6 ? 900 : 30 }))], pass, now);
  ok("§2 three nights of jobs waiting 15 minutes: give the worker more room", nights.advice === "worker" && /^Give the worker more room/.test(nights.sentence), nights.sentence);
  ok("§2 the oldest-job line is red at 900 s", line(nights, "queueOldestS").weekColour === "red" && line(nights, "queueOldestS").week === 900);
  const days = CAP.summarize([...samples(now, 3, () => web()), ...samples(now, 3, t => wkr({ queueOldestS: nyHour(t) >= 12 && nyHour(t) < 13 ? 900 : 30 }))], pass, now);
  ok("§2 a long wait in the afternoon is not a night: nothing to add", days.advice === "none", days.advice);
  const both = CAP.summarize([...samples(now, 3, () => web({ lagP95: 150 })), ...samples(now, 3, t => wkr({ queueOldestS: nyHour(t) < 6 ? 900 : 30 }))], pass, now);
  ok("§2 both at once: both steps", both.advice === "both" && both.sentence === CAP.SAY.both);
  const two2 = CAP.summarize([...samples(now, 7, () => web({ process: "web-a" })), ...samples(now, 7, () => web({ process: "web-b", lagP95: 130 }))], pass, now);
  ok("§2 one line per web replica", two2.lines.filter(l => l.key === "lagP95").length === 2
    && two2.lines.find(l => l.key === "lagP95" && /web-b/.test(l.label)).dayColour === "red");
  const failed = CAP.summarize(samples(now, 1, () => wkr({ failedHour: 7 })), pass, now);
  ok("§2 seven jobs failed in an hour is red", line(failed, "failedHour").dayColour === "red");
  const empty = CAP.summarize([], null, now);
  ok("§2 no samples: says so, and no colour", empty.advice === "empty" && empty.lines.every(l => l.dayColour === null), empty.sentence);
  ok("§2 a stored row reads back as a sample (pool peak as a share of the pool)",
    CAP.fromRow({ at: new Date(now), process: "p", role: "web", lag_p95: 12.5, busy_pct: 40, req_p95: 300, pool_wait_p95: 1, pool_peak: 9, pool_max: 10, queue_oldest_s: null, failed_hour: null }).poolPeakPct === 90);

  // §3 /ops carries it (its own super-admin; the door itself is devboard1-ops's)
  const ORG = "org_scale3cap", SUPER = "super@scale3cap.local";
  await q(`DELETE FROM users WHERE org_id = $1`, [ORG]);
  await q(`DELETE FROM orgs WHERE id = $1`, [ORG]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,org_kind) VALUES ($1,'Scale Three HQ','scale3cap',1,'active','team','internal_test')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin) VALUES ('u_scale3cap',$1,$2,$3,'Scale Three','admin',true)`,
    [ORG, SUPER, require("bcryptjs").hashSync("loadtest1234", 8)]);
  const tok = await login(SUPER);
  const r = await api("GET", "/ops", tok);
  const c = r && r.body && r.body.capacity;
  ok("§3 /ops answers the capacity card with its sentence and lines", r.status === 200 && !!c && typeof c.sentence === "string" && c.sentence.length > 10
    && Array.isArray(c.lines) && c.lines.some(l => l.key === "load") && c.lines.some(l => l.key === "lagP95"), `${r.status} ${JSON.stringify(c).slice(0, 300)}`);
  await q(`DELETE FROM users WHERE org_id = $1`, [ORG]);
  await q(`DELETE FROM orgs WHERE id = $1`, [ORG]);
})().catch(e => ok("suite ran without throwing", false, e.stack))
  .finally(async () => { await closeDb().catch(() => {}); summary(); });
