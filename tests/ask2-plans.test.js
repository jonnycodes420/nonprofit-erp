// tests/ask2-plans.test.js · ASK-2 Test 1. THE PLAN'S NUMBERS ARE THE FILE'S.
//
//     Twenty questions, each answered from a FIXED plan a stand-in model hands
//     back (the model never writes a number). For each, every number in the
//     answer equals the value worked out by hand in this file from the
//     fixture's own gift list, to the cent; and every figure opens rows that
//     foot to it (a percentage through its two parts).
//
// Money and donor data: a number on the box that disagrees with its rows is a
// wrong number told to a director, the thing this build exists to stop.
//
// The suite starts its OWN server process pointed at a stand-in for the
// Anthropic API (ANTHROPIC_BASE_URL, a dummy key), as parity4-show-me does.
// Its own fixture org; it never logs in to the demo. The questions are worded
// so no template reads them ("Ledger item 07"), so each answer comes from the
// stand-in's plan.
//
// HOW IT WOULD GO RED (proven before it was trusted, see the build report):
//   · count refunds in average_gift → §1 "average" goes red;
//   · take the median of every gift instead of the positive ones → §1 median;
//   · let a breakdown cell read the whole set → §2 a group does not foot.

const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const bcrypt = require("bcryptjs");
const { ok, summary, q, closeDb } = require("./helpers");

const ORG = "org_ask2plans";
const freePort = () => new Promise(r => { const s = http.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const cents = v => Math.round(Number(v || 0) * 100);
const pad = n => String(n).padStart(2, "0");

(async () => {
  const now = new Date();
  const T = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
  const Y = now.getUTCFullYear();
  const back = k => { const d = new Date(Date.UTC(Y, now.getUTCMonth(), now.getUTCDate() - k)); const s = d.toISOString().slice(0, 10); return s < `${Y}-01-01` ? `${Y}-01-01` : s; };

  for (const t of ["question_log", "recurring_subscriptions", "gifts", "events", "campaigns", "fin_funds", "donors", "user_sessions", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,ai_enabled) VALUES ($1,'Ask Plans Fixture','ask2-plans',1,'active','team','UTC',true)`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_ask2plans',$1,'staff@ask2plans.local',$2,'Ask Staff','admin')`, [ORG, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('ff_a2_sch',$1,'Scholarship Fund',true),('ff_a2_gen',$1,'General Operating',false)`, [ORG]);
  await q(`INSERT INTO campaigns (id,org_id,name,goal_amount,status,start_date,end_date) VALUES ('c_a2_push',$1,'Spring Push',5000,'active',$2,$3)`, [ORG, `${Y - 1}-01-01`, `${Y}-12-31`]);
  await q(`INSERT INTO events (id,org_id,name,date,event_type) VALUES ('ev_a2_lantern',$1,'Lantern Night',$2,'gala')`, [ORG, back(5)]);
  const D = { a: "Marblehead", b: "Marblehead", c: "Salem", d: "Salem", e: "Salem", f: "Salem", g: "Salem", h: "Salem" };
  for (const [k, city] of Object.entries(D))
    await q(`INSERT INTO donors (id,org_id,name,city,stage,created_by,created_by_name) VALUES ($1,$2,$3,$4,'active','system:test','test')`, [`d_a2_${k}`, ORG, `Plan Fixture ${k.toUpperCase()}`, city]);
  await q(`INSERT INTO recurring_subscriptions (id,org_id,donor_id,stripe_subscription_id,amount,interval,status) VALUES ('rs_a2_b',$1,'d_a2_b','sub_a2_b',25,'month','active')`, [ORG]);
  // THE GIFT LIST. Everything below is worked out from this array by hand.
  const G = [
    ["a", back(2), 1200.50, "ff_a2_sch", "c_a2_push", null],
    ["a", `${Y - 1}-03-10`, 800, "ff_a2_gen", null, null],
    ["b", back(3), 25, "ff_a2_gen", null, null],
    ["b", back(33), 25, "ff_a2_gen", null, null],
    ["b", `${Y - 1}-06-20`, 25, "ff_a2_gen", null, null],
    ["c", back(4), 300, "ff_a2_gen", null, "ev_a2_lantern"],
    ["c", back(4), -50, "ff_a2_gen", null, "ev_a2_lantern"],          // a refund
    ["d", back(6), 75.25, "ff_a2_sch", "c_a2_push", null],
    ["e", back(7), 5000, "ff_a2_gen", null, "ev_a2_lantern"],
    ["e", `${Y - 2}-04-01`, 100, "ff_a2_gen", null, null],             // came back after two years
    ["f", `${Y - 1}-11-05`, 640, "ff_a2_sch", "c_a2_push", null],      // first gift last year, gave again
    ["f", back(9), 60, "ff_a2_sch", null, null],
    ["g", `${Y - 1}-02-14`, 410, "ff_a2_gen", null, null],             // first gift last year, not again
    ["h", back(1), 10, "ff_a2_gen", null, null],
  ];
  let gi = 0;
  for (const [k, date, amt, fund, camp, ev] of G)
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,fund_id,campaign_id,event_id,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'system:test','test')`,
      [`g_a2_${++gi}`, ORG, `d_a2_${k}`, amt, date, fund, camp, ev]);

  // ── BY HAND ──────────────────────────────────────────────────────────
  const inY = g => g[1] >= `${Y}-01-01` && g[1] <= T, inLast = g => g[1] >= `${Y - 1}-01-01` && g[1] <= `${Y - 1}-12-31`;
  const sumC = gs => gs.reduce((s, g) => s + cents(g[2]), 0);
  const pos = gs => gs.filter(g => g[2] > 0);
  const thisY = G.filter(inY), lastY = G.filter(inLast);
  const posY = pos(thisY).map(g => cents(g[2])).sort((a, b) => a - b);
  const firstOf = k => G.filter(g => g[0] === k && g[2] > 0).map(g => g[1]).sort()[0];
  const people = gs => [...new Set(pos(gs).map(g => g[0]))];
  const sameDayLastY = `${Y - 1}${T.slice(4)}`;
  const byDonorY = Object.entries(pos(thisY).reduce((m, g) => ((m[g[0]] = (m[g[0]] || 0) + cents(g[2])), m), {})).sort((a, b) => b[1] - a[1]);
  const prevBefore = (k, d) => G.filter(g => g[0] === k && g[2] > 0 && g[1] < d).map(g => g[1]).sort().pop();
  const cameBack = people(thisY).filter(k => { const f = pos(thisY).filter(g => g[0] === k).map(g => g[1]).sort()[0]; const p = prevBefore(k, f); return p && p < `${+f.slice(0, 4) - 1}${f.slice(4)}`; });
  const firstLast = Object.keys(D).filter(k => (firstOf(k) || "").startsWith(String(Y - 1)));
  const keptFirst = firstLast.filter(k => people(thisY).includes(k));
  const median = posY.length % 2 ? posY[(posY.length - 1) / 2] : Math.round((posY[posY.length / 2 - 1] + posY[posY.length / 2]) / 2);

  const P = (metric, extra = {}) => ({ kind: "metric", metric, period: { kind: "this_year" }, ...extra });
  const CASES = [
    ["01", P("raised"), { value: sumC(thisY) }],
    ["02", P("gift_count"), { value: pos(thisY).length }],
    ["03", P("donor_count"), { value: people(thisY).length }],
    ["04", P("average_gift"), { value: Math.round(sumC(pos(thisY)) / pos(thisY).length) }],
    ["05", P("median_gift"), { value: median }],
    ["06", P("largest_gift"), { value: posY[posY.length - 1] }],
    ["07", P("new_donor_count"), { value: Object.keys(D).filter(k => (firstOf(k) || "") >= `${Y}-01-01`).length }],
    ["08", P("raised", { period: { kind: "last_year" } }), { value: sumC(lastY) }],
    ["09", P("raised", { filters: { fund: "ff_a2_sch" } }), { value: sumC(thisY.filter(g => g[3] === "ff_a2_sch")) }],
    ["10", P("raised", { period: { kind: "all_time" }, filters: { campaign: "c_a2_push" } }), { value: sumC(G.filter(g => g[4] === "c_a2_push")) }],
    ["11", { kind: "metric", metric: "event_revenue", filters: { event: "ev_a2_lantern" } }, { value: sumC(G.filter(g => g[5] === "ev_a2_lantern")) }],
    ["12", P("raised", { filters: { rules: { city: "Marblehead" } } }), { value: sumC(thisY.filter(g => D[g[0]] === "Marblehead")) }],
    ["13", P("raised", { filters: { rules: { monthly: "1" } } }), { value: sumC(thisY.filter(g => g[0] === "b")) }],
    ["14", { kind: "who", metric: "raised", period: { kind: "this_year" }, top: 2 }, { value: byDonorY[0][1] + byDonorY[1][1] }],
    ["15", P("recaptured_count"), { value: cameBack.length }],
    ["16", { kind: "metric", metric: "first_year_retention" }, { value: Math.round(keptFirst.length / firstLast.length * 100), parts: [keptFirst.length, firstLast.length] }],
    ["17", P("raised", { groupBy: "fund" }), { value: sumC(thisY), groups: { "Scholarship Fund": sumC(thisY.filter(g => g[3] === "ff_a2_sch")), "General Operating": sumC(thisY.filter(g => g[3] === "ff_a2_gen")) } }],
    ["18", P("raised", { compare: "last_year" }), { value: sumC(thisY), compare: sumC(G.filter(g => g[1] >= `${Y - 1}-01-01` && g[1] <= sameDayLastY)) }],
    ["19", P("gift_count", { period: { kind: "last_year" }, groupBy: "month" }), { value: pos(lastY).length, groups: Object.fromEntries([...new Set(lastY.map(g => g[1].slice(0, 7)))].map(m => [m, pos(lastY).filter(g => g[1].startsWith(m)).length])) }],
    ["20", P("donor_count", { period: { kind: "all_time" } }), { value: people(G).length }],
  ];
  const PLANS = Object.fromEntries(CASES.map(([k, plan]) => [k, plan]));

  // The stand-in model: the plan for the ledger item the question names.
  const mock = http.createServer((req, res) => {
    let b = ""; req.on("data", c => b += c);
    req.on("end", () => {
      const m = /Ledger item (\d\d)/.exec(b);
      const input = m && PLANS[m[1]] ? { ...PLANS[m[1]], unsupported: null } : { kind: "metric", metric: "nothing_known", unsupported: "unknown" };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "msg_t", type: "message", role: "assistant", model: "x", stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "tu_1", name: "ask_plan", input }], usage: { input_tokens: 1, output_tokens: 1 } }));
    });
  });
  await new Promise(r => mock.listen(0, r));
  const port = await freePort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT: String(port), ANTHROPIC_API_KEY: "sk-ant-test-dummy", ANTHROPIC_BASE_URL: `http://localhost:${mock.address().port}`,
           DISABLE_BACKGROUND_TICKS: "1", TEST_MODE: "1", JWT_SECRET: process.env.JWT_SECRET || "local-test-secret",
           RESEND_API_KEY: process.env.RESEND_API_KEY || "re_dummy_local", SENTRY_DSN: "" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let errs = ""; child.stderr.on("data", d => { errs += d; });
  const B = `http://localhost:${port}`;
  let up = false;
  for (let i = 0; i < 90 && !up; i++) { await new Promise(r => setTimeout(r, 1000)); up = await fetch(B + "/health").then(r => r.ok).catch(() => false); }
  ok("the ask server started", up, errs.slice(-300));

  try {
    const login = await (await fetch(B + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "staff@ask2plans.local", password: "loadtest1234" }) })).json();
    const H = { "Content-Type": "application/json", Authorization: "Bearer " + login.token };
    const get = async u => (await fetch(B + u, { headers: H })).json();
    const allRows = async src => {
      const rows = []; let page = 1, first = null;
      for (;;) {
        const p = new URLSearchParams({ ...src.params, page: String(page), pageSize: "200" });
        const b = await get(`/figures/${src.key}/rows?${p}`);
        first = first || b; rows.push(...(b.rows || []));
        if (rows.length >= (b.totalRows || 0) || !(b.rows || []).length) break;
        page++;
      }
      return { body: first, rows };
    };
    const measureOf = (m, rows) => m === "sum" ? rows.reduce((s, r) => s + cents(r.amount), 0)
      : m === "mean" ? (rows.length ? Math.round(rows.reduce((s, r) => s + cents(r.amount), 0) / rows.length) : 0) : rows.length;
    const valueC = f => (f.kind === "money" ? cents(f.value) : Number(f.value));
    const foots = async f => {
      const got = await allRows(f.source);
      const b = got.body || {};
      if (b.measure === "ratio") {
        const out = [];
        for (const part of b.parts || []) { const r = await allRows(part.source); out.push(measureOf(part.measure, r.rows) === (part.measure === "count" ? part.value : cents(part.value))); }
        return out.length === 2 && out.every(Boolean);
      }
      const v = measureOf(b.measure, got.rows);
      return v === valueC(f) && got.rows.length === b.totalRows;
    };

    console.log("\n— §1 · twenty plans, each number the hand-worked one —");
    let footed = 0, figs = 0;
    for (const [k, , want] of CASES) {
      const a = await (await fetch(B + "/ask", { method: "POST", headers: H, body: JSON.stringify({ text: `Ledger item ${k} for the treasurer` }) })).json();
      const f = a.figures || {};
      const okValue = a.answered === true && a.planSource === "ai" && f.value && valueC(f.value) === want.value;
      const okCmp = want.compare === undefined || (f.compare && cents(f.compare.value) === want.compare);
      const okParts = !want.parts || (a.parts && a.parts[0].value === want.parts[0] && a.parts[1].value === want.parts[1]);
      const okGroups = !want.groups || (a.table && Object.entries(want.groups).every(([label, v]) => {
        const row = a.table.rows.find(r => r.label === label);
        return row && valueC(row.value) === v;
      }) && a.table.rows.length === Object.keys(want.groups).length);
      ok(`§1 ${k} ${PLANS[k].metric}: ${JSON.stringify(want).slice(0, 80)}`, okValue && okCmp && okParts && okGroups,
        { got: f.value && f.value.value, compare: f.compare && f.compare.value, parts: a.parts && a.parts.map(p => p.value), table: a.table && a.table.rows.map(r => [r.label, r.value.value]), sentence: a.sentence, src: a.planSource });
      // §2 every figure the answer draws opens rows that foot to it.
      const drawn = [f.value, f.compare, f.change, ...(a.parts || []), ...((a.table && a.table.rows) || []).flatMap(r => [r.value, r.compare])].filter(x => x && x.source);
      for (const x of drawn) { figs++; if (await foots(x)) footed++; else console.log("   does not foot:", k, x.label, x.value); }
    }
    console.log("\n— §2 · every figure opens rows that foot —");
    ok(`§2 all ${figs} figures on the twenty answers foot to their rows`, figs >= 30 && footed === figs, { figs, footed });
    const planted = await foots({ ...((await (await fetch(B + "/ask", { method: "POST", headers: H, body: JSON.stringify({ text: "Ledger item 01 for the treasurer" }) })).json()).figures.value), value: (sumC(thisY) + 1) / 100 });
    ok("§2 …and a figure one cent off its rows does not foot", planted === false);
  } finally {
    child.kill();
    mock.close();
    for (const t of ["question_log", "recurring_subscriptions", "gifts", "events", "campaigns", "fin_funds", "donors", "user_sessions", "users"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
    summary();
    await closeDb();
  }
})().catch(async e => { console.error(e); process.exitCode = 1; await closeDb().catch(() => {}); });
