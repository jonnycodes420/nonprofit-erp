// ASK-4 · 52 questions across every kind of record, asked on Harborlight the
// way the Ask box asks them (POST /ask, text only), scored against truth
// written by hand in SQL that shares nothing with askQuery.js or askEngine.js.
//
//   node docs/ask-4/eval.cjs run <label>     (PORT, default 5821) → docs/ask-4/<label>.json
//   node docs/ask-4/eval.cjs score <label>   → docs/ask-4/<label>-score.json
//
// right    the number (or the top group, or the first person) is the truth
// refused  answered: false
// wrong    answered with a number that is not the truth, or about something else
// For the last two questions a refusal IS right: nothing on file can answer them.
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const API = "http://localhost:" + (process.env.PORT || 5821);
const DB = process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_ask3";
const O = "'org_b72demo'";
const G = `FROM gifts g JOIN donors d ON d.id=g.donor_id AND d.org_id=g.org_id WHERE g.org_id=${O} AND d.deleted_at IS NULL AND g.amount>0`;
const D = `FROM donors d WHERE d.org_id=${O} AND d.deleted_at IS NULL`;
const Y = "LEFT(g.date,10) BETWEEN '2026-01-01' AND '2026-12-31'";
const LY = "LEFT(g.date,10) BETWEEN '2025-01-01' AND '2025-12-31'";
const gave = (cond) => `EXISTS (SELECT 1 FROM gifts g WHERE g.org_id=d.org_id AND g.donor_id=d.id AND g.amount>0 AND ${cond})`;

// [n, question, kind, truth SQL] — kind: value (SELECT v), top (SELECT k), person (SELECT k = a name), refuse
const Q = [
  [1, "How much came in by check this year?", "value", `SELECT SUM(g.amount) v ${G} AND g.payment_method='Check' AND ${Y}`],
  [2, "How many gifts were made by card in September 2026?", "value", `SELECT COUNT(*) v ${G} AND g.payment_method='Card' AND LEFT(g.date,7)='2026-09'`],
  [3, "What was the largest gift of stock we've ever received?", "value", `SELECT MAX(g.amount) v ${G} AND g.payment_method='Stock'`],
  [4, "What's the average ACH gift?", "value", `SELECT ROUND(AVG(g.amount),2) v ${G} AND g.payment_method='ACH'`],
  [5, "How much did we raise for Youth Arts Access this year?", "value", `SELECT COALESCE(SUM(g.amount),0) v ${G} AND ${Y} AND g.fund_id IN (SELECT id FROM fin_funds WHERE org_id=${O} AND name='Youth Arts Access')`],
  [6, "Which fund raised the most in 2025?", "top", `SELECT COALESCE(f.name,'Unrestricted') k FROM gifts g JOIN donors d ON d.id=g.donor_id AND d.org_id=g.org_id LEFT JOIN fin_funds f ON f.id=g.fund_id WHERE g.org_id=${O} AND d.deleted_at IS NULL AND g.amount>0 AND ${LY} GROUP BY 1 ORDER BY SUM(g.amount) DESC LIMIT 1`],
  [7, "How many gifts from the last 30 days haven't been thanked?", "value", `SELECT COUNT(*) v ${G} AND COALESCE(g.acknowledgement_sent,false)=false AND LEFT(g.date,10) >= '2026-09-06'`],
  [8, "How much did donors in Salem give this year?", "value", `SELECT SUM(g.amount) v ${G} AND lower(d.city)='salem' AND ${Y}`],
  [9, "How many DAF gifts did we get last year?", "value", `SELECT COUNT(*) v ${G} AND g.payment_method='DAF' AND ${LY}`],
  [10, "What's the total of gifts over $10,000 this year?", "value", `SELECT SUM(g.amount) v ${G} AND g.amount>10000 AND ${Y}`],
  [11, "How many gifts were given in tribute?", "value", `SELECT COUNT(*) v ${G} AND COALESCE(g.tribute_type,'')<>''`],
  [12, "Which month this year had the most gifts?", "top", `SELECT LEFT(g.date,7) k ${G} AND ${Y} GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1`],
  [13, "How many people gave by check this year?", "value", `SELECT COUNT(DISTINCT g.donor_id) v ${G} AND g.payment_method='Check' AND ${Y}`],
  [14, "How many people live in Marblehead?", "value", `SELECT COUNT(*) v ${D} AND lower(d.city)='marblehead'`],
  [15, "How many donors have given more than $10,000 in their lifetime?", "value", `SELECT COUNT(*) v ${D} AND d.total_giving>10000`],
  [16, "How many people have no email address on file?", "value", `SELECT COUNT(*) v ${D} AND COALESCE(d.email,'')=''`],
  [17, "How many people are marked do not contact?", "value", `SELECT COUNT(*) v ${D} AND d.do_not_contact IS TRUE`],
  [18, "What is the highest lifetime giving of any one donor?", "value", `SELECT MAX(d.total_giving) v ${D}`],
  [19, "How many people made their first gift in 2026?", "value", `SELECT COUNT(*) v ${D} AND LEFT(d.first_gift_date,4)='2026'`],
  [20, "How many donors in Beverly gave this year?", "value", `SELECT COUNT(*) v ${D} AND lower(d.city)='beverly' AND ${gave(Y.replace(/g\./g, "g."))}`],
  [21, "How many donors have made more than five gifts?", "value", `SELECT COUNT(*) v ${D} AND d.gift_count>5`],
  [22, "How many calls were logged this year?", "value", `SELECT COUNT(*) v FROM interactions i JOIN donors d ON d.id=i.donor_id AND d.org_id=i.org_id WHERE i.org_id=${O} AND d.deleted_at IS NULL AND i.type='call' AND LEFT(i.date,4)='2026'`],
  [23, "How many meetings have we logged in total?", "value", `SELECT COUNT(*) v FROM interactions i JOIN donors d ON d.id=i.donor_id AND d.org_id=i.org_id WHERE i.org_id=${O} AND d.deleted_at IS NULL AND i.type='meeting'`],
  [24, "What kind of conversation do we log most often?", "top", `SELECT i.type k FROM interactions i JOIN donors d ON d.id=i.donor_id AND d.org_id=i.org_id WHERE i.org_id=${O} AND d.deleted_at IS NULL GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1`],
  [25, "How many people have at least one conversation logged?", "value", `SELECT COUNT(DISTINCT i.donor_id) v FROM interactions i JOIN donors d ON d.id=i.donor_id AND d.org_id=i.org_id WHERE i.org_id=${O} AND d.deleted_at IS NULL`],
  [26, "How many guests are on the Scholarship Supper list?", "value", `SELECT COUNT(*) v FROM event_attendees a JOIN events e ON e.id=a.event_id WHERE a.org_id=${O} AND e.name='Scholarship Supper'`],
  [27, "Which event has the most guests?", "top", `SELECT e.name k FROM event_attendees a JOIN events e ON e.id=a.event_id WHERE a.org_id=${O} GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1`],
  [28, "How many VIP guests are there across all our events?", "value", `SELECT COUNT(*) v FROM event_attendees a WHERE a.org_id=${O} AND a.vip IS TRUE`],
  [29, "How many people came to the Harbor Lights Gala and also gave this year?", "value", `SELECT COUNT(*) v ${D} AND EXISTS (SELECT 1 FROM event_attendees a JOIN events e ON e.id=a.event_id WHERE a.org_id=d.org_id AND a.donor_id=d.id AND e.name LIKE 'Harbor Lights Gala%') AND ${gave(Y)}`],
  [30, "What's the total fundraising goal across our events?", "value", `SELECT SUM(goal_amount) v FROM events WHERE org_id=${O}`],
  [31, "How many volunteer hours have been logged in total?", "value", `SELECT SUM(s.hours) v FROM volunteer_shifts s JOIN donors d ON d.id=s.person_id AND d.org_id=s.org_id WHERE s.org_id=${O} AND d.deleted_at IS NULL`],
  [32, "How many volunteer hours were logged this year?", "value", `SELECT SUM(s.hours) v FROM volunteer_shifts s JOIN donors d ON d.id=s.person_id AND d.org_id=s.org_id WHERE s.org_id=${O} AND d.deleted_at IS NULL AND LEFT(s.date,4)='2026'`],
  [33, "Who has volunteered the most hours?", "person", `SELECT d.name k FROM volunteer_shifts s JOIN donors d ON d.id=s.person_id AND d.org_id=s.org_id WHERE s.org_id=${O} AND d.deleted_at IS NULL GROUP BY d.id, d.name ORDER BY SUM(s.hours) DESC, d.name LIMIT 1`],
  [34, "How many people have volunteered?", "value", `SELECT COUNT(DISTINCT s.person_id) v FROM volunteer_shifts s JOIN donors d ON d.id=s.person_id AND d.org_id=s.org_id WHERE s.org_id=${O} AND d.deleted_at IS NULL`],
  [35, "How many volunteers also gave a gift this year?", "value", `SELECT COUNT(*) v ${D} AND EXISTS (SELECT 1 FROM volunteer_shifts s WHERE s.org_id=d.org_id AND s.person_id=d.id) AND ${gave(Y)}`],
  [36, "How many recurring gifts are active?", "value", `SELECT COUNT(*) v FROM recurring_subscriptions r JOIN donors d ON d.id=r.donor_id AND d.org_id=r.org_id WHERE r.org_id=${O} AND d.deleted_at IS NULL AND r.status='active'`],
  [37, "What do our active recurring gifts add up to each time they're charged?", "value", `SELECT SUM(r.amount) v FROM recurring_subscriptions r JOIN donors d ON d.id=r.donor_id AND d.org_id=r.org_id WHERE r.org_id=${O} AND d.deleted_at IS NULL AND r.status='active'`],
  [38, "How many recurring gifts are past due?", "value", `SELECT COUNT(*) v FROM recurring_subscriptions r JOIN donors d ON d.id=r.donor_id AND d.org_id=r.org_id WHERE r.org_id=${O} AND d.deleted_at IS NULL AND r.status='past_due'`],
  [39, "How many campaigns have a goal over $50,000?", "value", `SELECT COUNT(*) v FROM campaigns WHERE org_id=${O} AND sent_at IS NULL AND COALESCE(subject,'')='' AND goal_amount>50000`],
  [40, "What's the combined goal of all our campaigns?", "value", `SELECT SUM(goal_amount) v FROM campaigns WHERE org_id=${O} AND sent_at IS NULL AND COALESCE(subject,'')=''`],
  [41, "How many open next steps are overdue?", "value", `SELECT COUNT(*) v FROM threads t JOIN donors d ON d.id=t.donor_id AND d.org_id=t.org_id WHERE t.org_id=${O} AND d.deleted_at IS NULL AND t.closed_at IS NULL AND LEFT(t.due_date,10) < '2026-10-06'`],
  [42, "How many open next steps does Dana own?", "value", `SELECT COUNT(*) v FROM threads t JOIN donors d ON d.id=t.donor_id AND d.org_id=t.org_id WHERE t.org_id=${O} AND d.deleted_at IS NULL AND t.closed_at IS NULL AND t.owner_name ILIKE 'Dana%'`],
  [43, "How many tasks are still not done?", "value", `SELECT COUNT(*) v FROM tasks WHERE org_id=${O} AND voided_at IS NULL AND COALESCE(done,0)<>1`],
  [44, "How many open asks are there?", "value", `SELECT COUNT(*) v FROM opportunities o JOIN donors d ON d.id=o.donor_id AND d.org_id=o.org_id WHERE o.org_id=${O} AND d.deleted_at IS NULL AND o.status='open'`],
  [45, "What's the total amount of our open asks?", "value", `SELECT SUM(o.target_amount) v FROM opportunities o JOIN donors d ON d.id=o.donor_id AND d.org_id=o.org_id WHERE o.org_id=${O} AND d.deleted_at IS NULL AND o.status='open'`],
  [46, "How many grants have we been awarded?", "value", `SELECT COUNT(*) v FROM grants WHERE org_id=${O} AND status='awarded'`],
  [47, "How many memberships are active?", "value", `SELECT COUNT(*) v FROM memberships m JOIN donors d ON d.id=m.donor_id AND d.org_id=m.org_id WHERE m.org_id=${O} AND d.deleted_at IS NULL AND m.status='active'`],
  [48, "How many people in Danvers have given over $1,000 lifetime but never had a conversation logged?", "value", `SELECT COUNT(*) v ${D} AND lower(d.city)='danvers' AND d.total_giving>1000 AND NOT EXISTS (SELECT 1 FROM interactions i WHERE i.org_id=d.org_id AND i.donor_id=d.id)`],
  [49, "How many people gave to Spring Appeal 2026 and came to the Harbor Lights Gala?", "value", `SELECT COUNT(*) v ${D} AND ${gave("g.campaign_id IN (SELECT id FROM campaigns WHERE org_id=" + O + " AND name='Spring Appeal 2026')")} AND EXISTS (SELECT 1 FROM event_attendees a JOIN events e ON e.id=a.event_id WHERE a.org_id=d.org_id AND a.donor_id=d.id AND e.name LIKE 'Harbor Lights Gala%')`],
  [50, "How many people have a recurring gift and also volunteer?", "value", `SELECT COUNT(*) v ${D} AND EXISTS (SELECT 1 FROM recurring_subscriptions r WHERE r.org_id=d.org_id AND r.donor_id=d.id) AND EXISTS (SELECT 1 FROM volunteer_shifts s WHERE s.org_id=d.org_id AND s.person_id=d.id)`],
  [51, "What's the weather going to be like for the Harbor Run?", "refuse", null],
  [52, "Which of our donors have the best credit scores?", "refuse", null],
];

// HELD OUT: written after the tuning above and run once, to see what the 52 cannot.
const HELD = [
  [101, "How much was given by cash last year?", "value", `SELECT SUM(g.amount) v ${G} AND g.payment_method='Cash' AND ${LY}`],
  [102, "How many emails were logged in the last 60 days?", "value", `SELECT COUNT(*) v FROM interactions i JOIN donors d ON d.id=i.donor_id AND d.org_id=i.org_id WHERE i.org_id=${O} AND d.deleted_at IS NULL AND i.type='email' AND LEFT(i.date,10) >= '2026-08-07'`],
  [103, "How many people in Peabody have given more than $2,500 in their lifetime?", "value", `SELECT COUNT(*) v ${D} AND lower(d.city)='peabody' AND d.total_giving>2500`],
  [104, "What's the smallest gift we received this year?", "value", `SELECT MIN(g.amount) v ${G} AND ${Y}`],
  [105, "How many gifts to the General Operating fund were made in 2025?", "value", `SELECT COUNT(*) v ${G} AND ${LY} AND g.fund_id IN (SELECT id FROM fin_funds WHERE org_id=${O} AND name='General Operating')`],
  [106, "How many guests are on the Harbor Run list?", "value", `SELECT COUNT(*) v FROM event_attendees a JOIN events e ON e.id=a.event_id WHERE a.org_id=${O} AND e.name LIKE 'Harbor Run%'`],
  [107, "Which payment method brought in the most money this year?", "top", `SELECT g.payment_method k ${G} AND ${Y} GROUP BY 1 ORDER BY SUM(g.amount) DESC LIMIT 1`],
  [108, "How many people have never given a gift?", "value", `SELECT COUNT(*) v ${D} AND NOT EXISTS (SELECT 1 FROM gifts g WHERE g.org_id=d.org_id AND g.donor_id=d.id AND g.amount>0)`],
  [109, "How many volunteer shifts were logged in 2025?", "value", `SELECT COUNT(*) v FROM volunteer_shifts s JOIN donors d ON d.id=s.person_id AND d.org_id=s.org_id WHERE s.org_id=${O} AND d.deleted_at IS NULL AND LEFT(s.date,4)='2025'`],
  [110, "How many donors in Manchester gave by card this year?", "value", `SELECT COUNT(*) v ${D} AND lower(d.city)='manchester' AND ${gave("g.payment_method='Card' AND " + Y)}`],
  [111, "What's the average gift from donors in Marblehead?", "value", `SELECT ROUND(AVG(g.amount),2) v ${G} AND lower(d.city)='marblehead'`],
  [112, "How many people gave both last year and this year?", "value", `SELECT COUNT(*) v ${D} AND ${gave(LY)} AND ${gave(Y)}`],
  [113, "How many people have had a meeting logged and given over $5,000 in their lifetime?", "value", `SELECT COUNT(*) v ${D} AND d.total_giving>5000 AND EXISTS (SELECT 1 FROM interactions i WHERE i.org_id=d.org_id AND i.donor_id=d.id AND i.type='meeting')`],
  [114, "Which city do most of our donors live in?", "top", `SELECT d.city k ${D} GROUP BY 1 ORDER BY COUNT(*) DESC, 1 LIMIT 1`],
  [115, "How many of our donors' horoscopes are Scorpio?", "refuse", null],
];
if (process.env.HELD) Q.splice(0, Q.length, ...HELD);

async function run(label) {
  const { token } = await fetch(API + "/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "director@harborlight.demo", password: "demo-harbor-2026" }) }).then(r => r.json());
  const out = [];
  for (const [n, q] of Q) {
    const a = await fetch(API + "/ask", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token }, body: JSON.stringify({ text: q }) }).then(r => r.json());
    out.push({ n, q, answer: a });
    console.log(String(n).padStart(2), a.answered === false ? "--- " : "", String(a.sentence || "").slice(0, 150));
  }
  fs.writeFileSync(path.join(__dirname, `${label}.json`), JSON.stringify(out, null, 1));
}

const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.011;
async function score(label) {
  const rows = JSON.parse(fs.readFileSync(path.join(__dirname, `${label}.json`), "utf8"));
  const c = new Client({ connectionString: DB }); await c.connect();
  const out = [];
  for (const [n, q, kind, sql] of Q) {
    const a = (rows.find(r => r.n === n) || {}).answer || {};
    let verdict = "wrong", truth = null, got = null;
    if (kind === "refuse") verdict = a.answered === false ? "right" : "wrong";
    else if (a.answered === false) verdict = "refused";
    else {
      const [t] = (await c.query(sql)).rows; truth = t ? (t.v ?? t.k) : null;
      if (kind === "value") {
        const f = a.figures || {};
        const cands = [f.value && f.value.value, a.count, a.peopleCount, f.part0 && f.part0.value].filter(x => x != null);
        got = cands[0] ?? null;
        verdict = cands.some(x => near(x, truth ?? 0)) ? "right" : "wrong";
      } else if (kind === "top") {
        // The group the answer names as largest (its group figure), else its top row.
        const tops = [a.figures && a.figures.group0 && a.figures.group0.label, a.table && a.table.rows && a.table.rows[0] && a.table.rows[0].label].filter(Boolean).map(x => String(x).toLowerCase().split(" · ").pop());
        got = tops[0] || null; verdict = tops[0] === String(truth).toLowerCase() ? "right" : "wrong";
      } else if (kind === "person") {
        // The first person the answer names: its people list, its who list, or the top row of its breakdown.
        const ps = [...(a.people || []).map(p => p.name), ...((a.who || []).map(p => p.name)), ...(a.table && a.table.rows ? [a.table.rows[0] && a.table.rows[0].label] : [])].filter(Boolean);
        got = ps[0] || null; verdict = ps[0] && String(ps[0]).toLowerCase() === String(truth).toLowerCase() ? "right" : "wrong";
      }
    }
    out.push({ n, q, verdict, truth, got, source: a.planSource || a.kind || null, sentence: String(a.sentence || "").slice(0, 200) });
  }
  await c.end();
  const tally = out.reduce((m, x) => ((m[x.verdict] = (m[x.verdict] || 0) + 1), m), {});
  fs.writeFileSync(path.join(__dirname, `${label}-score.json`), JSON.stringify({ tally, rows: out }, null, 1));
  for (const x of out) if (x.verdict !== "right") console.log(String(x.n).padStart(2), x.verdict.padEnd(8), (x.source || "").padEnd(9), x.q.slice(0, 60), "| truth", x.truth, "got", x.got);
  console.log("\n" + label, tally);
}
const [cmd, label] = process.argv.slice(2);
(cmd === "run" ? run(label) : score(label)).catch(e => { console.error(e); process.exit(1); });
