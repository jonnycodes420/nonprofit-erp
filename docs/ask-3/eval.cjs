// ASK-3 · the 25 person-scoped questions on Harborlight, asked the way the rail
// asks them (each thread carries the last answer's people, person and appeal),
// scored against truth worked out by hand with separate SQL (below), never
// with the Ask code.
//
//   node docs/ask-3/eval.cjs run <label>    asks all 25 on PORT (default 5821) → docs/ask-3/<label>.json
//   node docs/ask-3/eval.cjs score <label>  scores it → docs/ask-3/<label>-score.json
//
// right   the answer is about the right person (or asks which, or says no one,
//         when that is the truth) and every number in its sentence is true
// refused one plain sentence saying it can't, where an answer was possible
// wrong   another person, an unrelated list, or a number that is not true
// broken  a sentence that is cut off, over-long, or talks about Steward's insides
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const API = "http://localhost:" + (process.env.PORT || 5821);
const DB = process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_ask3";
const ORG = "org_b72demo";
const APPEAL = { key: "appeal", campaign: "camp_b72demo_spring" };
const CALL = { key: "call" };

// Each thread starts from a tapped question (not scored) or from nothing.
// expect: person <id> <intent> | choose | none | list <ids> | given <id> | refuse
const THREADS = [
  { start: APPEAL, qs: [
    [1, "what can I do to get Flavia to give more", "person", "d_b72_44", "ask"],
    [2, "and Margaret?", "person", "d_b72_12", "ask"],
    [3, "what's the next step with her?", "person", "d_b72_12", "next"],
    [4, "why did her giving change?", "person", "d_b72_12", "changed"],
    [5, "what should I ask Zebulon Quatermaine for?", "none"],
  ] },
  { start: APPEAL, qs: [
    [6, "what should I ask them for?", "list", ["d_b72_38", "d_b72_39", "d_b72_40", "d_b72_52", "d_b72_53"]],
    [7, "why did Nerissa stop giving?", "person", "d_b72_38", "stopped"],
    [8, "what about Leopold?", "person", "d_b72_39", "stopped"],
    [9, "what should I ask him for?", "person", "d_b72_39", "ask"],
  ] },
  { start: APPEAL, qs: [
    [10, "the top five", "list", ["d_b72_38", "d_b72_39", "d_b72_40", "d_b72_52", "d_b72_53"]],
  ] },
  { start: APPEAL, qs: [
    [11, "what should I ask Persis for?", "person", "d_b72_41", "ask"],
  ] },
  { start: null, qs: [
    [12, "why did Alaric Applewhite stop giving?", "person", "d_b72_32", "stopped"],
    [13, "what should I ask him for?", "person", "d_b72_32", "ask"],
    [14, "what's the next step with him?", "person", "d_b72_32", "next"],
    [15, "what has he given to?", "given", "d_b72_32"],
    [16, "why did Ondine Cinderhalt stop giving?", "person", "d_b72_1076", "stopped"],
    [17, "and what should I ask her for?", "person", "d_b72_1076", "ask"],
  ] },
  { start: null, qs: [
    [18, "what should I ask Persis for?", "choose"],
    [19, "what should I ask Flavia for?", "choose"],
    [20, "how has Margaret Chen's giving changed?", "person", "d_b72_12", "changed"],
    [21, "what's the next step with Flavia Pentreath?", "person", "d_b72_44", "next"],
    [22, "what can I do to get Margaret Chen to give more?", "person", "d_b72_12", "ask"],
    [23, "why did Bartholomew Nobody stop giving?", "none"],
  ] },
  { start: null, qs: [
    [24, "what should I ask her for?", "refuse"],
  ] },
  { start: CALL, qs: [
    [25, "what should I ask Alaric for?", "person", "d_b72_32", "ask"],
  ] },
];

// ── THE THREAD, AS THE RAIL KEEPS IT (AskRail.jsx threadContext) ────────────
function context(turns) {
  const people = [], seen = new Set();
  let lastPerson = null, campaign = null;
  let list = null;
  for (let i = turns.length - 1; i >= 0; i--) {
    const a = turns[i]; if (!a || a.answered === false) continue;
    for (const p of [...(a.who || []), ...(a.people || []), ...(a.rows || [])]) {
      const id = p.donorId || p.id; if (id && p.name && !seen.has(id)) { seen.add(id); people.push({ id, name: p.name }); }
    }
    if (!list) list = people.slice();
  }
  for (let i = turns.length - 1; i >= 0; i--) {
    const a = turns[i]; if (!a || a.answered === false) continue;
    if (!campaign) campaign = (a.campaign && a.compare && a.campaign.id) || (a.person && a.person.campaign) || null;
    if (!lastPerson) {
      if (a.person) lastPerson = { id: a.person.id, name: a.person.name, intent: a.person.intent };
      else if (a.donor && a.question && a.question.key === "stopped") lastPerson = { id: a.donor.id, name: a.donor.name, intent: "stopped" };
    }
  }
  return { people: people.slice(0, 60), list: (list || []).slice(0, 60), lastPerson, campaign };
}

async function run(label) {
  const { token } = await fetch(API + "/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "director@harborlight.demo", password: "demo-harbor-2026" }) }).then(r => r.json());
  const post = (p, b) => fetch(API + p, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token }, body: JSON.stringify(b) }).then(r => r.json());
  const out = [];
  for (const th of THREADS) {
    const turns = []; let lastPlan = null;
    if (th.start) { const a = await post("/why/ask", th.start); turns.push(a); }
    for (const [n, q, ...expect] of th.qs) {
      const a = await post("/ask", { text: q, previous: lastPlan, context: context(turns) });
      if (a.plan) lastPlan = a.plan;
      turns.push(a);
      out.push({ n, q, expect, answer: a });
      console.log(String(n).padStart(2), (a.answered === false ? "--- " : "") + String(a.sentence || "").slice(0, 150));
    }
  }
  fs.writeFileSync(path.join(__dirname, `${label}.json`), JSON.stringify(out, null, 1));
}

// ── TRUTH, BY HAND (SQL that shares nothing with the Ask code) ─────────────
// For one person, every number a true sentence about them could say: each
// gift, their lifetime total and count, each calendar year's total, this year
// and last year to today's date, each campaign's total, the first year, the
// suggested ask (the profile's own rule, smartAmounts, on these gifts), the
// open step's day, and the parts of their last-gift and contact dates.
async function truthFor(c, id, today) {
  const g = (await c.query(`SELECT LEFT(g.date,10) AS date, g.amount::numeric AS amount, COALESCE(k.name, g.campaign, '') AS camp
     FROM gifts g LEFT JOIN campaigns k ON k.id = g.campaign_id WHERE g.org_id=$1 AND g.donor_id=$2 AND g.amount > 0 ORDER BY g.date DESC, g.id`, [ORG, id])).rows;
  const nums = new Set();
  const add = v => { const n = Math.round(Number(v) * 100) / 100; if (Number.isFinite(n)) nums.add(n); };
  const sum = xs => xs.reduce((s, x) => s + Number(x.amount), 0);
  g.forEach(x => { add(x.amount); for (const p of x.date.split("-")) add(p); });
  add(sum(g)); add(g.length);
  const y = today.slice(0, 4), md = today.slice(5);
  for (const yr of new Set(g.map(x => x.date.slice(0, 4)))) { add(yr); add(sum(g.filter(x => x.date.startsWith(yr)))); }
  add(sum(g.filter(x => x.date.startsWith(y))));
  add(sum(g.filter(x => x.date.startsWith(String(+y - 1)) && x.date.slice(5) <= md)));
  for (const k of new Set(g.map(x => x.camp))) { add(sum(g.filter(x => x.camp === k))); for (const t of String(k).match(/\d+/g) || []) add(t); }
  if (g.length) {
    const SA = await import(path.join(__dirname, "..", "..", "shared", "smartAmounts.js"));
    const cents = g.map(x => Math.round(Number(x.amount) * 100));
    const a = SA.suggestedAskCents({ largestCents: Math.max(...cents), lastThreeCents: cents.slice(0, 3) });
    if (a) add((a.askCents ?? a) / 100);
  }
  const st = (await c.query(`SELECT LEFT(due_date::text,10) AS due, next_step_label FROM threads WHERE org_id=$1 AND donor_id=$2 AND closed_at IS NULL`, [ORG, id])).rows;
  st.forEach(s => { if (s.due) for (const p of s.due.split("-")) add(p); for (const t of String(s.next_step_label || "").match(/\d+/g) || []) add(t); });
  const sub = (await c.query(`SELECT amount FROM recurring_subscriptions WHERE org_id=$1 AND donor_id=$2`, [ORG, id])).rows;
  sub.forEach(s => add(s.amount));
  const vs = (await c.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(hours),0)::numeric AS h FROM volunteer_shifts WHERE org_id=$1 AND person_id=$2`, [ORG, id])).rows[0];
  add(vs.n); add(vs.h);
  const ev = (await c.query(`SELECT COUNT(*)::int AS n FROM event_attendees WHERE org_id=$1 AND donor_id=$2`, [ORG, id])).rows[0];
  add(ev.n);
  const it = (await c.query(`SELECT LEFT(date,10) AS date FROM interactions WHERE org_id=$1 AND donor_id=$2`, [ORG, id])).rows;
  it.forEach(x => { for (const p of x.date.split("-")) add(p); });
  return nums;
}

async function score(label) {
  const S = await import(path.join(__dirname, "..", "..", "shared", "whyShape.js"));
  const G = await import(path.join(__dirname, "..", "..", "shared", "askGuide.js"));
  const rows = JSON.parse(fs.readFileSync(path.join(__dirname, `${label}.json`), "utf8"));
  const c = new Client({ connectionString: DB }); await c.connect();
  const [{ today }] = (await c.query(`SELECT to_char(now() AT TIME ZONE 'America/New_York','YYYY-MM-DD') AS today`)).rows;
  const cache = new Map();
  const truth = async id => (cache.has(id) ? cache.get(id) : (cache.set(id, await truthFor(c, id, today)), cache.get(id)));
  const out = [];
  for (const r of rows) {
    const a = r.answer, [kind, want, intent] = r.expect;
    const s = String(a.sentence || "");
    const plain = G.sentenceIsPlain(s);
    let v = "wrong", why = "";
    const numsOk = async ids => {
      const allowed = new Set();
      for (const id of ids) for (const n of await truth(id)) allowed.add(n);
      for (const n of S.numbersIn(r.q)) allowed.add(n);
      const bad = S.numbersIn(s).filter(n => !allowed.has(Math.round(n * 100) / 100));
      return bad.length ? (why = `numbers not true: ${bad.join(", ")}`, false) : true;
    };
    if (!s || !plain && a.answered !== false) { v = "broken"; why = "sentence fails the plain-sentence check"; }
    else if (kind === "person") {
      const got = a.donor && a.donor.id;
      if (a.answered === false) { v = "refused"; why = a.kind || ""; }
      else if (got !== want) why = `about ${got || (a.who || []).slice(0, 2).map(w => w.name).join(", ") || "nobody"}`;
      else if (intent !== "stopped" && a.question && a.question.key !== "person") why = `answered ${a.question.key}`;
      else if (await numsOk([want])) v = "right";
    } else if (kind === "given") {
      const got = a.plan && a.plan.filters && a.plan.filters.donor;
      if (a.answered === false) v = "refused";
      else if (got !== want) why = `about ${got || "another question"}`;
      else if (await numsOk([want])) v = "right";
    } else if (kind === "list") {
      const ids = (a.who || []).map(w => w.donorId);
      if (a.answered === false) v = "refused";
      else if (JSON.stringify(ids) !== JSON.stringify(want)) why = `people ${ids.slice(0, 6).join(",")}`;
      else if (await numsOk(want)) v = "right";
    } else if (kind === "choose") {
      v = a.kind === "choose" && (a.candidates || []).length >= 2 ? "right" : a.answered === false ? "refused" : "wrong";
      if (v !== "right") why = a.kind || s.slice(0, 60);
    } else if (kind === "none") {
      v = a.answered === false && /no one named/i.test(s) && plain ? "right" : a.answered === false ? "refused" : "wrong";
    } else if (kind === "refuse") {
      v = a.answered === false && plain && !(a.who || []).length ? "right" : "wrong";
      if (v !== "right") why = s.slice(0, 80);
    }
    out.push({ n: r.n, q: r.q, expect: r.expect.join(" "), verdict: v, why, source: a.sentenceSource || null, sentence: s });
  }
  await c.end();
  const tally = out.reduce((m, x) => ((m[x.verdict] = (m[x.verdict] || 0) + 1), m), {});
  fs.writeFileSync(path.join(__dirname, `${label}-score.json`), JSON.stringify({ tally, rows: out }, null, 1));
  for (const x of out) console.log(String(x.n).padStart(2), x.verdict.padEnd(8), (x.source || "").padEnd(9), x.q.slice(0, 48).padEnd(49), x.why);
  console.log("\n" + label, tally);
}

const [cmd, label] = process.argv.slice(2);
(cmd === "run" ? run(label) : score(label)).catch(e => { console.error(e); process.exit(1); });
