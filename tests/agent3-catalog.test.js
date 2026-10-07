// tests/agent3-catalog.test.js · AGENT-3's one test. THE AGENT SEES EVERYTHING.
//
//     Five instructions, one per object the Agent could not see before:
//     a grant (a report due), a membership (ending next month), a campaign
//     (the spring appeal's givers), a peer-to-peer page (waiting for
//     approval) and an auction (a winner who has not paid). Each builds a plan
//     for exactly the right people, read from SQL here and never through the
//     code under test, and after the run each draft or task is in Drafts to
//     review or the task list AND on the person: their Thread and timeline.
//     A second org holding the same kinds of rows is never planned for.
//
//     Then: a 150-person plan of tasks, calls and tags finishes (the plan
//     call is batched); every phrasing of "gone quiet" is understood by the
//     Agent and by Ask; a model reply Ask cannot use is counted as a
//     fallback; and a plan's list status agrees with its steps.
//
// It stands in for the model on a local port (ANTHROPIC_BASE_URL), as
// golden-journeys does. AGENT3_REAL=1 with PROXY=<the nightly spend proxy>
// sends the five prompts to the real model through it instead, once, to price
// them (scripts/nightly-ai/proxy.js counts the spend).
//
// HOW IT GOES RED: on main, none of the five finds its people (no rule reads
// a grant report, a membership's end, a pending page or an auction win), a
// 150-person task plan is refused as too long, "gone quiet" is refused, and
// a task is on nobody's Thread or timeline.
"use strict";
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const bcrypt = require("bcryptjs");
const { ok, summary, q, closeDb, civilToday, civilPlusDays } = require("./helpers");

const ORG = "org_agent3", OTHER = "org_agent3x";
const DANA = "dana@agent3.test", PW = "loadtest1234";
const REAL = process.env.AGENT3_REAL === "1";
const T = civilToday();
const nextMonthDay = (() => { const [y, m] = T.split("-").map(Number); const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1; return `${ny}-${String(nm).padStart(2, "0")}-10`; })();

const P = {   // the people, by role
  fiona: "d_a3_fiona", frank: "d_a3_frank",            // funders: report due in 20 days / in 60 days
  mel: "d_a3_mel", max: "d_a3_max",                    // members: ends next month / in 100 days
  cara: "d_a3_cara", carl: "d_a3_carl", dan: "d_a3_dan", // spring appeal givers, and one who gave elsewhere
  pat: "d_a3_pat", pia: "d_a3_pia",                    // fundraisers: pending / live
  will: "d_a3_will", wanda: "d_a3_wanda",              // auction winners: unpaid / paid
  xmel: "d_a3x_mel",                                   // the other org's member ending next month
};
const BATCH = Array.from({ length: 150 }, (_, i) => `d_a3_b${String(i).padStart(3, "0")}`);

async function wipe() {
  for (const o of [ORG, OTHER]) {
    for (const t of ["ai_fallbacks", "agent_writes", "agent_drafts", "agent_runs", "agent_instructions", "ai_log", "interactions", "threads", "tasks",
      "auction_bids", "auction_bidders", "auction_items", "auctions", "peer_fundraisers", "giving_pages", "memberships", "membership_levels",
      "grant_milestones", "grants", "pledges", "fin_transactions", "gifts", "campaigns", "donor_scores", "user_sessions", "users", "donors", "fin_funds", "accounts"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}
let n = 0;
const id = p => `${p}_${++n}`;
async function person(org, pid, name, extra = {}) {
  await q(`INSERT INTO donors (id,org_id,name,email,kind,city,stage,status,tags,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,$6,'donor','active','[]','system:test','agent3 suite')`,
    [pid, org, name, `${pid}@example.org`, extra.kind || "person", extra.city || null]);
}
async function gift(org, donorId, amount, date, extra = {}) {
  const g = id("g_a3");
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,campaign_id,giving_page_id,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,$6,$7,'system:test','agent3 suite')`,
    [g, org, donorId, amount, date, extra.campaignId || null, extra.pageId || null]);
  return g;
}

async function seed() {
  await wipe();
  for (const [o, name] of [[ORG, "Agent Three Collective"], [OTHER, "Agent Three Elsewhere"]]) {
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at,ai_enabled)
             VALUES ($1,$2,$3,1,'active','team','America/New_York',NOW(),true)`, [o, name, o.replace(/_/g, "-")]);
  }
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_a3_dana',$1,$2,$3,'Dana Reyes','admin')`, [ORG, DANA, bcrypt.hashSync(PW, 4)]);
  // Grants: Fiona's report is due in 20 days; Frank's in 60.
  await person(ORG, P.fiona, "Fiona Foundation", { kind: "organization" });
  await person(ORG, P.frank, "Frank Family Fund", { kind: "organization" });
  for (const [funder, days, gid] of [[P.fiona, 20, "gr_a3_fiona"], [P.frank, 60, "gr_a3_frank"]]) {
    await q(`INSERT INTO grants (id,org_id,funder,program,status,amount_awarded,funder_donor_id) VALUES ($1,$2,$3,'Youth arts access','awarded',25000,$4)`,
      [gid, ORG, funder === P.fiona ? "Fiona Foundation" : "Frank Family Fund", funder]);
    await q(`INSERT INTO grant_milestones (id,org_id,grant_id,kind,due_date,state,label) VALUES ($1,$2,$3,'report_due',$4,'pending','Interim report')`,
      [id("gm_a3"), ORG, gid, civilPlusDays(days)]);
  }
  // Memberships: Mel's ends next month, Max's in 100 days. The other org has a Mel too.
  await q(`INSERT INTO membership_levels (id,org_id,name,price,term) VALUES ('ml_a3',$1,'Friend',60,'12_months'),('ml_a3x',$2,'Friend',60,'12_months')`, [ORG, OTHER]);
  await person(ORG, P.mel, "Mel Morrow"); await person(ORG, P.max, "Max Moreau"); await person(OTHER, P.xmel, "Mel Elsewhere");
  for (const [org, d, lvl, ends] of [[ORG, P.mel, "ml_a3", nextMonthDay], [ORG, P.max, "ml_a3", civilPlusDays(100)], [OTHER, P.xmel, "ml_a3x", nextMonthDay]])
    await q(`INSERT INTO memberships (id,org_id,donor_id,level_id,joined_on,starts_on,expires_on,status) VALUES ($1,$2,$3,$4,$5,$5,$6,'active')`,
      [id("mem_a3"), org, d, lvl, civilPlusDays(-300), ends]);
  // The spring appeal: Cara and Carl gave to it; Dan gave, but not to it.
  await q(`INSERT INTO campaigns (id,org_id,name,type,status,start_date) VALUES ('c_a3_spring',$1,'Spring Appeal','appeal','active',$2)`, [ORG, civilPlusDays(-60)]);
  for (const [pid, name] of [[P.cara, "Cara Collins"], [P.carl, "Carl Chen"], [P.dan, "Dan Dorsey"]]) await person(ORG, pid, name);
  await gift(ORG, P.cara, 150, civilPlusDays(-20), { campaignId: "c_a3_spring" });
  await gift(ORG, P.carl, 75, civilPlusDays(-18), { campaignId: "c_a3_spring" });
  await gift(ORG, P.dan, 200, civilPlusDays(-15));
  // Peer-to-peer: Pat's page waits for approval; Pia's is live.
  await q(`INSERT INTO giving_pages (id,org_id,slug,title,p2p_enabled,p2p_requires_approval) VALUES ('gp_a3',$1,'a3-run','Harbor Run',true,true)`, [ORG]);
  await person(ORG, P.pat, "Pat Palmer"); await person(ORG, P.pia, "Pia Park");
  for (const [pid, st] of [[P.pat, "pending"], [P.pia, "active"]])
    await q(`INSERT INTO peer_fundraisers (id,org_id,giving_page_id,name,email,slug,status,person_id,personal_goal_amount) VALUES ($1,$2,'gp_a3',$3,$4,$5,$6,$7,500)`,
      [id("pf_a3"), ORG, pid, `${pid}@example.org`, `${pid}-page`, st, pid]);
  // An auction that has closed: Will won the quilt and has not paid; Wanda won and paid.
  await q(`INSERT INTO auctions (id,org_id,title,public_slug,opens_at,closes_at,status,created_by) VALUES ('au_a3',$1,'Spring Auction','a3-auction',NOW() - interval '10 days',NOW() - interval '2 days','active','system:test')`, [ORG]);
  await person(ORG, P.will, "Will Whitaker"); await person(ORG, P.wanda, "Wanda West");
  const items = [["ai_a3_quilt", "Harbor quilt", P.will, 320, null], ["ai_a3_print", "Gallery print", P.wanda, 180, "now"]];
  let bn = 0;
  for (const [iid, title, winner, amount, paid] of items) {
    await q(`INSERT INTO auction_items (id,org_id,auction_id,title,starting_bid,bid_increment,fmv,paid_at,created_by) VALUES ($1,$2,'au_a3',$3,50,10,100,${paid ? "NOW()" : "NULL"},'system:test')`, [iid, ORG, title]);
    const bid = `ab_a3_${winner}`;
    await q(`INSERT INTO auction_bidders (id,org_id,auction_id,donor_id,name,email,bidder_number,token_hash,created_by) VALUES ($1,$2,'au_a3',$3,$4,$5,$6,$7,'system:test') ON CONFLICT DO NOTHING`,
      [bid, ORG, winner, winner, `${winner}@example.org`, ++bn, `hash_${winner}`]);
    await q(`INSERT INTO auction_bids (id,org_id,auction_id,item_id,bidder_id,amount,created_by) VALUES ($1,$2,'au_a3',$3,$4,$5,'system:test')`, [id("bid_a3"), ORG, iid, bid, amount]);
  }
  // 150 people in one city, for the plans that must finish at any size.
  for (const b of BATCH) await q(`INSERT INTO donors (id,org_id,name,email,city,stage,status,tags,created_by,created_by_name) VALUES ($1,$2,$3,$4,'Batchville','donor','active','[]','system:test','agent3 suite')`,
    [b, ORG, `Batch Person ${b.slice(-3)}`, `${b}@example.org`]);
}

// ── THE STAND-IN MODEL ───────────────────────────────────────────────────────
// It answers from the prompt it is sent, as the real one must: one draft or
// step per person listed, using only the ids under that person. A plan call
// that lists more than 40 people answers "max_tokens", which is what the real
// plan call did past that size; only batching gets a plan for 150 through.
const calls = { plan: 0, drafts: 0, filter_spec: 0, text: 0, truncated: 0 };
function peopleIn(text) {
  const out = []; let cur = null;
  for (const line of text.split("\n")) {
    const m = /^ {2}(d_[A-Za-z0-9_]+) \| ([^|]+) \|/.exec(line);
    if (m) { cur = { id: m[1], name: m[2].trim(), rows: [] }; out.push(cur); continue; }
    const r = /^ {6}(grant|membership|pledge|gift|peer-to-peer page|auction win) ([A-Za-z0-9_]+) \|/.exec(line);
    if (r && cur) cur.rows.push({ kind: r[1], id: r[2], line });
  }
  return out;
}
function planFor(instruction, people) {
  const steps = [];
  const base = { subject: null, body: null, title: null, note: null, stage: null, tag: null, label: null, due: null, dueDays: 7, priority: "medium", grantId: "", purpose: "" };
  for (const p of people) {
    const cites = [p.id];
    if (/grant checklist/i.test(instruction)) {
      const g = p.rows.find(r => r.kind === "grant");
      if (g) steps.push({ ...base, tool: "create_task", donorId: p.id, citesRows: [p.id, g.id], title: `Grant report checklist for ${p.name}`, grantId: g.id });
      if (/funder update/i.test(instruction)) steps.push({ ...base, tool: "draft_note", donorId: p.id, citesRows: cites, subject: "An update on your grant", body: `Dear ${p.name}, here is where the work your grant supports stands. With thanks, Agent Three Collective.`, purpose: "funder_update" });
    } else if (/approval reminder/i.test(instruction)) {
      const f = p.rows.find(r => r.kind === "peer-to-peer page");
      steps.push({ ...base, tool: "create_task", donorId: p.id, citesRows: f ? [p.id, f.id] : cites, title: `Approve ${p.name}'s peer-to-peer page` });
    } else if (/\btag\b/i.test(instruction)) steps.push({ ...base, tool: "add_tag", donorId: p.id, citesRows: cites, tag: "spring-2026" });
    else if (/\bcall\b/i.test(instruction)) steps.push({ ...base, tool: "open_thread", donorId: p.id, citesRows: cites, label: `Call ${p.name}` });
    else steps.push({ ...base, tool: "create_task", donorId: p.id, citesRows: cites, title: `Follow up with ${p.name}` });
  }
  return { steps, sends: 0, headline: "", cannot: "" };
}
const model = http.createServer((req, res) => {
  let b = ""; req.on("data", c => (b += c));
  req.on("end", () => {
    let j = {}; try { j = JSON.parse(b); } catch { j = {}; }
    const tool = ((j.tools || [])[0] || {}).name || "";
    const text = ((j.messages || [])[0] || {}).content;
    const user = typeof text === "string" ? text : JSON.stringify(text || "");
    const instruction = (/Her instruction, verbatim: "([^"]*)"/.exec(user) || [])[1] || "";
    const reply = (content, stop = "tool_use") => { res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "msg_a3", type: "message", role: "assistant", model: "x", stop_reason: stop, content, usage: { input_tokens: 1, output_tokens: 1 } })); };
    if (tool === "plan") {
      calls.plan++;
      const people = peopleIn(user);
      if (people.length > 40) { calls.truncated++; return reply([{ type: "tool_use", id: "tu", name: "plan", input: { steps: [], sends: 0, headline: "", cannot: "" } }], "max_tokens"); }
      return reply([{ type: "tool_use", id: "tu", name: "plan", input: planFor(instruction, people) }]);
    }
    if (tool === "drafts") {
      calls.drafts++;
      // As the real model does: a renewal names the date the membership ends,
      // and a pay-your-bid note names the auction, the item and the bid.
      const M = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
      const words = ymd => { const m = /(\d{4})-(\d{2})-(\d{2})/.exec(ymd || ""); return m ? `${M[+m[2] - 1]} ${+m[3]}, ${m[1]}` : ""; };
      const drafts = peopleIn(user).map(p => {
        const mem = p.rows.find(r => r.kind === "membership"), win = p.rows.find(r => r.kind === "auction win");
        const memEnd = mem && words((/ends (\d{4}-\d{2}-\d{2})/.exec(mem.line) || [])[1]);
        const w = win && /\| (.+) in (.+) \| winning bid (\$[\d,]+)/.exec(win.line);
        const body = /renewal/i.test(instruction) && memEnd ? `Dear ${p.name}, your membership ends ${memEnd}, and we would love you to renew. With gratitude, Agent Three Collective.`
          : /pay-your-bid/i.test(instruction) && w ? `Dear ${p.name}, congratulations on the ${w[1]} at the ${w[2]}. Your winning bid was ${w[3]}, and a payment link will follow from us. With gratitude, Agent Three Collective.`
          : `Dear ${p.name}, thank you for being part of this. With gratitude, Agent Three Collective.`;
        return { donorId: p.id, subject: "A note from us", body };
      });
      return reply([{ type: "tool_use", id: "tu", name: "drafts", input: { drafts } }]);
    }
    if (tool) { calls.filter_spec++; return reply([{ type: "tool_use", id: "tu", name: tool, input: { filters: [], suggestAsk: false, unsupported: "anything" } }]); }
    // A sentence for Ask: cut off, so Ask must fall back to its template and count it.
    calls.text++;
    return reply([{ type: "text", text: "Three people have" }], "max_tokens");
  });
});

(async () => {
  let child;
  try {
    await seed();
    await new Promise(r => model.listen(0, r));
    const port = await new Promise(r => { const t = http.createServer(); t.listen(0, () => { const p = t.address().port; t.close(() => r(p)); }); });
    const base = REAL ? (process.env.PROXY || "http://localhost:6524") : `http://localhost:${model.address().port}`;
    child = spawn(process.execPath, ["server.js"], {
      cwd: path.join(__dirname, ".."),
      env: { ...process.env, PORT: String(port), ANTHROPIC_API_KEY: "sk-ant-test-dummy", /* the real key lives only in the proxy */ ANTHROPIC_BASE_URL: base,
             DISABLE_BACKGROUND_TICKS: "1", TEST_MODE: "1", SESSION_CACHE_TTL_MS: "0", JWT_SECRET: process.env.JWT_SECRET || "local-test-secret",
             RESEND_API_KEY: process.env.RESEND_API_KEY || "re_dummy_local", SENTRY_DSN: "" },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let errs = ""; child.stderr.on("data", d => { errs += d; });
    if (process.env.AGENT3_LOG) child.stderr.pipe(require("fs").createWriteStream(process.env.AGENT3_LOG));
    const B = `http://localhost:${port}`;
    let up = false;
    for (let i = 0; i < 120 && !up; i++) { await new Promise(r => setTimeout(r, 500)); up = await fetch(B + "/health").then(r => r.ok).catch(() => false); }
    ok("the Agent's server started", up, errs.slice(-400));
    const lg = await (await fetch(B + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: DANA, password: PW }) })).json();
    const H = { "Content-Type": "application/json", Authorization: "Bearer " + lg.token };
    const call = async (m, u, body) => { const r = await fetch(B + u, { method: m, headers: H, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
    const sameSet = (a, b) => JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort());

    // ── §1–§5 · ONE PROMPT PER OBJECT ───────────────────────────────────────
    const cases = [
      { key: "grant", text: "Create a grant checklist task and draft a funder update for everyone with a grant report due in the next 30 days",
        truth: `SELECT DISTINCT g.funder_donor_id AS id FROM grants g JOIN grant_milestones m ON m.grant_id = g.id AND m.org_id = g.org_id
                 WHERE g.org_id = $1 AND m.kind LIKE 'report%' AND m.completed_at IS NULL AND m.due_date BETWEEN $2 AND $3`, args: [T, civilPlusDays(30)],
        tasks: true, drafts: true, purpose: "funder_update" },
      { key: "membership", text: "Draft a renewal to every member expiring next month",
        truth: `SELECT DISTINCT donor_id AS id FROM memberships WHERE org_id = $1 AND cancelled_at IS NULL AND LEFT(expires_on,7) = LEFT($2,7)`, args: [nextMonthDay],
        drafts: true, purpose: "membership_renewal" },
      { key: "campaign", text: "Thank everyone who gave to the spring appeal",
        truth: `SELECT DISTINCT donor_id AS id FROM gifts WHERE org_id = $1 AND campaign_id = 'c_a3_spring' AND amount > 0`, args: [],
        drafts: true, purpose: "thank_you" },
      { key: "p2p", text: "Create an approval reminder for every fundraiser waiting for approval",
        truth: `SELECT DISTINCT person_id AS id FROM peer_fundraisers WHERE org_id = $1 AND status = 'pending'`, args: [], tasks: true },
      { key: "auction", text: "Draft a pay-your-bid note to every auction winner who has not paid",
        truth: `SELECT bw.donor_id AS id FROM auction_items ai JOIN LATERAL (SELECT b.bidder_id FROM auction_bids b WHERE b.org_id = ai.org_id AND b.item_id = ai.id
                 ORDER BY b.amount DESC, b.created_at, b.id LIMIT 1) tb ON true JOIN auction_bidders bw ON bw.id = tb.bidder_id WHERE ai.org_id = $1 AND ai.paid_at IS NULL`, args: [],
        drafts: true, purpose: "auction_pay" },
    ];
    const only = (process.env.AGENT3_ONLY || "").split(",").filter(Boolean);
    for (const c of cases.filter(x => !only.length || only.includes(x.key))) {
      console.log(`\n§ ${c.key}: "${c.text}"`);
      const want = (await q(c.truth, [ORG, ...c.args])).map(r => r.id);
      ok(`${c.key}: the truth set is not empty`, want.length > 0, want);
      const p = await call("POST", "/agent/instructions", { text: c.text });
      const steps = (p.body.plan && p.body.plan.steps) || [];
      const planned = steps.map(s => s.donorId).filter(Boolean);
      ok(`${c.key}: a plan for exactly the right people`, p.status === 201 && sameSet(planned, want), { status: p.status, planned, want, body: JSON.stringify(p.body).slice(0, 300) });
      ok(`${c.key}: nobody from the other organisation`, !planned.some(x => x.startsWith("d_a3x_")), planned);
      if (c.purpose) ok(`${c.key}: each draft says what it is for (${c.purpose})`, steps.filter(s => s.tool === "draft_note").every(s => s.purpose === c.purpose) && steps.some(s => s.tool === "draft_note"), steps.map(s => [s.tool, s.purpose]));
      if (c.key === "grant") ok("grant: the checklist task is on her grant", steps.some(s => s.tool === "create_task" && s.grantId === "gr_a3_fiona"), steps.map(s => [s.tool, s.grantId]));
      if (REAL) continue;   // the real run prices the plans; the run checks need the stand-in's exact steps
      const run = await call("POST", `/agent/instructions/${p.body.id}/confirm`, {});
      ok(`${c.key}: the run finishes`, run.status === 200, run.body);
      const W = (await call("GET", "/agent/waiting")).body;
      const waiting = (W.items || []).filter(i => i.kind === "agent_draft" && i.instructionId === p.body.id).map(i => i.donorId);
      if (c.drafts) ok(`${c.key}: every draft is in Drafts to review`, sameSet(waiting, want), { waiting, want });
      if (c.tasks) {
        const tk = await q(`SELECT donor_id, grant_id FROM tasks WHERE org_id = $1 AND created_by = 'system:agent' AND donor_id = ANY($2::text[])`, [ORG, want]);
        ok(`${c.key}: every task is on the task list, on the person`, sameSet(tk.map(t => t.donor_id), want), tk);
      }
      for (const who of want) {
        const th = (await call("GET", `/threads?donorId=${who}&scope=all`)).body;
        const open = (th.list || []).find(t => t.donorId === who && t.kind === "thread");
        ok(`${c.key}: ${who} has it on their Thread`, !!(open && open.nextStep && open.nextStep.label), th.list && th.list.map(t => t.nextStep));
        const lines = await q(`SELECT note FROM interactions WHERE org_id = $1 AND donor_id = $2 AND type = 'activity' AND created_by = 'system:agent'`, [ORG, who]);
        ok(`${c.key}: ${who} has it on their timeline`, lines.length > 0, lines);
      }
    }
    // The membership draft could name her level and date: they were in her lines.
    const [melLog] = await q(`SELECT prompt_full FROM ai_log WHERE org_id = $1 AND prompt_full LIKE '%people to draft for%' AND prompt_full LIKE '%Mel Morrow%' ORDER BY created_at DESC LIMIT 1`, [ORG]);
    ok("membership: the draft was written from her membership (level and end date)", !!melLog && /membership mem_a3_\d+ \| Friend \| active \| ends /.test(melLog.prompt_full), melLog && melLog.prompt_full.slice(-400));
    const [wLog] = await q(`SELECT prompt_full FROM ai_log WHERE org_id = $1 AND prompt_full LIKE '%people to draft for%' AND prompt_full LIKE '%Will Whitaker%' ORDER BY created_at DESC LIMIT 1`, [ORG]);
    ok("auction: the draft was written from his win (item and winning bid)", !!wLog && /auction win ai_a3_quilt \| Harbor quilt in Spring Auction \| winning bid \$320 \| not paid yet/.test(wLog.prompt_full), wLog && wLog.prompt_full.slice(-300));

    if (!REAL) {
      // ── §6 · ANY PLAN SIZE FINISHES ──────────────────────────────────────
      console.log("\n§6 150 people, every kind of plan");
      for (const [kind, text, tool] of [["tasks", "Create a follow-up task for every donor in Batchville", "create_task"],
                                        ["calls", "Plan a call to every donor in Batchville", "open_thread"],
                                        ["tags", "Add the tag spring-2026 to every donor in Batchville", "add_tag"]]) {
        const before = calls.truncated;
        const p = await call("POST", "/agent/instructions", { text });
        const steps = (p.body.plan && p.body.plan.steps) || [];
        ok(`§6 ${kind}: a plan for all 150, none cut short`, p.status === 201 && steps.length === 150 && steps.every(s => s.tool === tool) && sameSet(steps.map(s => s.donorId), BATCH) && calls.truncated === before,
          { status: p.status, n: steps.length, err: p.body.error || p.body.sentence, truncated: calls.truncated - before });
      }

      // ── §7 · GONE QUIET, EVERY WAY IT IS SAID ────────────────────────────
      console.log("\n§7 gone quiet");
      for (const phrase of ["Who has gone quiet past their own pattern?", "Who went quiet?", "Who is going quiet?", "Which donors stopped giving?",
                            "Who is slipping?", "Who is drifting?", "Who haven't we heard from?"]) {
        const a = await call("POST", "/agent/instructions", { text: phrase });
        ok(`§7 the Agent reads "${phrase}" as a list`, a.status === 200 && a.body.read && a.body.read.kind === "list", { status: a.status, body: JSON.stringify(a.body).slice(0, 200) });
        const k = await call("POST", "/ask", { q: phrase, question: phrase, text: phrase });
        ok(`§7 Ask answers "${phrase}"`, k.status === 200 && k.body && k.body.refused !== true && k.body.answered !== false, JSON.stringify(k.body).slice(0, 200));
      }

      // ── §8 · NO SILENT FALLBACKS ─────────────────────────────────────────
      const fb = await q(`SELECT surface, reason FROM ai_fallbacks WHERE org_id = $1`, [ORG]);
      ok("§8 an Ask sentence the model cut off fell back to the template, and was counted", fb.some(r => r.surface === "ask.sentence" && r.reason === "unfinished"), fb);

      // ── §9 · THE LIST AND THE STEPS AGREE ────────────────────────────────
      const A = await import("../shared/agentShape.js");
      const steps = s => s.map(o => ({ outcome: o }));
      ok("§9 a standing plan with drafts waiting says so", /waiting for you/i.test(A.planListState({ kind: "standing", status: "active", run: { status: "done", finished_at: "x", steps: steps(["done", "waiting"]) } }).word));
      ok("§9 a run that stopped after doing steps counts them", /Did not finish · 2 of 3 steps/.test(A.planListState({ kind: "task", status: "active", run: { status: "failed", finished_at: "x", steps: steps(["done", "failed"]) } }).word));
      const plans = (await call("GET", "/agent/plans")).body.plans || [];
      const mine = plans.filter(p => p.run && p.run.steps && p.run.steps.length);
      ok("§9 every plan's list status is the one rule over its own steps", mine.length > 0 && mine.every(p => p.listState && p.listState.word === A.planListState(p).word), mine.map(p => [p.listState && p.listState.word, A.planListState(p).word]));
    }
    console.log(`\nmodel calls: ${JSON.stringify(calls)}`);
  } catch (e) {
    ok("the suite ran without throwing", false, e.stack || e.message);
  } finally {
    if (child) child.kill("SIGTERM");
    model.close();
    if (!process.env.AGENT3_KEEP) await wipe().catch(() => {});
    await closeDb();
    summary();
  }
})();
