// AGENT-2 · run the 30 instructions on the fixture and score what really
// happened in the system: a row-level diff of the whole fixture org, judged
// per instruction. Never the plan's own word for it.
//   BASE=http://localhost:5841 DATABASE_URL=…/steward_agent2 node scripts/agent2/run30.js <label>
const fs = require("fs");
const { q, api, closeDb, civilToday, civilPlusDays } = require("../../tests/helpers");
const F = require("./fixture");
const ORG = F.ORG, D = id => `d_${ORG}_${id}`, T = civilToday();
const nextDow = dow => { for (let i = 1; i <= 7; i++) { const d = civilPlusDays(i); if (new Date(d + "T12:00:00Z").getUTCDay() === dow) return d; } };

const NOISE = /^(audit|ai_log|agent_(writes|runs|instructions|questions)|notification|metric_|donor_scores|job_|session|question_log|help_|usage|rate_|api_usage|org_usage|events_log|fin_audit)/;
async function snapshot() {
  const tables = (await q(`SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  const out = {};
  for (const t of tables) {
    const rows = await q(`SELECT row_to_json(x) AS j FROM "${t}" x WHERE org_id=$1`, [ORG]).catch(() => []);
    out[t] = Object.fromEntries(rows.map(r => [r.j.id || JSON.stringify(r.j), r.j]));
  }
  return out;
}
function diff(a, b) {
  const d = {};
  for (const t of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const A = a[t] || {}, B = b[t] || {};
    const ins = [], upd = [], del = [];
    for (const k of Object.keys(B)) { if (!(k in A)) ins.push(B[k]); else if (JSON.stringify(A[k]) !== JSON.stringify(B[k])) upd.push({ before: A[k], after: B[k] }); }
    for (const k of Object.keys(A)) if (!(k in B)) del.push(A[k]);
    if (ins.length || upd.length || del.length) d[t] = { ins, upd, del };
  }
  return d;
}
const has = (d, t) => d[t] || { ins: [], upd: [], del: [] };
const anyRow = (d, pred) => Object.entries(d).some(([t, x]) => !NOISE.test(t) && [...x.ins, ...x.upd.map(u => u.after)].some(r => pred(r, t)));
const anyDel = (d, pred) => Object.entries(d).some(([t, x]) => !NOISE.test(t) && x.del.some(r => pred(r, t)));
const json = r => JSON.stringify(r).toLowerCase();
const donorAfter = async id => (await q(`SELECT row_to_json(d) j FROM donors d WHERE id=$1`, [id]))[0].j;
const ints = (d, who, type) => has(d, "interactions").ins.filter(r => r.donor_id === who && (!type || r.type === type));
const isNotesOnly = d => {
  const real = Object.keys(d).filter(t => !NOISE.test(t));
  const soft = ["interactions", "tasks", "volunteer_notes", "threads", "agent_drafts"];
  const notes = real.every(t => soft.includes(t) || (t === "donors" && d.donors.upd.every(u => JSON.stringify({ ...u.before, tags: 0, updated_at: 0, person_types: 0 }) === JSON.stringify({ ...u.after, tags: 0, updated_at: 0, person_types: 0 }))));
  return real.length > 0 && notes && !has(d, "interactions").ins.some(r => r.type !== "note");
};

// [instruction, judge(diff, ctx) -> "full" | "partial" | false]
const CASES = [
  ["ada just became a volunteer and wants to do 15 hours a week", async d => {
    const r = has(d, "volunteer_applications").ins.find(x => x.person_id === D("ada") && x.status === "approved");
    return r && Number(r.hours_per_week) === 15 ? "full" : r ? "partial" : false; }],
  ["just got a gift from the sunrise foundation, 5,000 dollars", async d => {
    const g = has(d, "gifts").ins.filter(x => x.donor_id === D("sunrise") && Number(x.amount) === 5000);
    return g.length === 1 ? "full" : false; }],
  ["log that I called Margaret today, she wants to meet next month", async d => {
    const call = ints(d, D("margaret"), "call").some(x => String(x.date).slice(0, 10) === T);
    const step = [...has(d, "threads").ins, ...has(d, "threads").upd.map(u => u.after)].some(x => x.donor_id === D("margaret"));
    return call && step ? "full" : call || step ? "partial" : false; }],
  ["add the Smiths to the gala table hosts group", async (d, c) => {
    const inG = who => anyRow(d, r => json(r).includes(c.groupId.toLowerCase()) && json(r).includes(D(who).toLowerCase()));
    return inG("john") && inG("mary") ? "full" : inG("john") || inG("mary") ? "partial" : false; }],
  ["Bob's new email is bob.tran@newmail.org", async () => (await donorAfter(D("bob"))).email === "bob.tran@newmail.org" ? "full" : false],
  ["start the first-year journey for everyone who gave for the first time this month", async (d, c) => {
    const n = ["new1", "new2", "new3"].filter(w => anyRow(d, (r, t) => t !== "donors" && json(r).includes(c.journeyId.toLowerCase()) && json(r).includes(D(w).toLowerCase()))).length;
    return n === 3 ? "full" : n ? "partial" : false; }],
  ["move Ada to Cultivate and make me her owner", async (d, c) => {
    const a = await donorAfter(D("ada")); const st = a.stage === "cultivate", own = a.assigned_to === c.me;
    return st && own ? "full" : st || own ? "partial" : false; }],
  ["sign Ada up for Saturday's food drive shift", async d => has(d, "volunteer_signups").ins.some(x => x.person_id === D("ada")) ? "full" : false],
  ["mark the Sunrise gift thanked", async () => (await q(`SELECT acknowledgement_sent FROM gifts WHERE id=$1`, [`g_${ORG}_sun1`]))[0].acknowledgement_sent === true ? "full" : false],
  ["merge the two Ellen Parks", async d => {
    const proposed = anyRow(d, (r, t) => /merge_proposal/.test(t) && json(r).includes(D("ellen1").toLowerCase()) && json(r).includes(D("ellen2").toLowerCase()));
    const both = (await q(`SELECT COUNT(*)::int n FROM donors WHERE id = ANY($1) AND deleted_at IS NULL`, [[D("ellen1"), D("ellen2")]]))[0].n === 2;
    return proposed && both ? "full" : false; }],
  ["Margaret's new phone number is 617-555-0199", async () => /555.?0199/.test((await donorAfter(D("margaret"))).phone || "") ? "full" : false],
  ["I met with Ada today, we talked about a planned gift", async d => ints(d, D("ada"), "meeting").some(x => String(x.date).slice(0, 10) === T) ? "full" : false],
  ["set a next step for Margaret: send her the annual report by Friday", async d => {
    const th = [...has(d, "threads").ins, ...has(d, "threads").upd.map(u => u.after)].find(x => x.donor_id === D("margaret") && /annual report/i.test(x.next_step_label));
    return th && th.due_date === nextDow(5) ? "full" : th ? "partial" : false; }],
  ["log 3 hours for Ada at the food drive yesterday", async d => has(d, "volunteer_shifts").ins.some(x => x.person_id === D("ada") && Number(x.hours) === 3 && String(x.date).slice(0, 10) === civilPlusDays(-1)) ? "full" : false],
  ["register Bob for the Spring open house", async d => anyRow(d, (r, t) => /attendee|registration|guest/.test(t) && json(r).includes(D("bob").toLowerCase())) ? "full" : false],
  ["take Bob out of the gala table hosts group", async (d, c) => anyDel(d, r => json(r).includes(c.groupId.toLowerCase()) && json(r).includes(D("bob").toLowerCase()))
      || anyRow(d, r => json(r).includes(c.groupId.toLowerCase()) && json(r).includes(D("bob").toLowerCase()) && /removed|left|exited/.test(json(r))) ? "full" : false],
  ["take Margaret out of the first-year journey", async (d, c) => anyDel(d, r => json(r).includes(D("margaret").toLowerCase()) && json(r).includes(c.journeyId.toLowerCase()))
      || anyRow(d, (r, t) => t !== "donors" && json(r).includes(D("margaret").toLowerCase()) && json(r).includes(c.journeyId.toLowerCase()) && /stop|exit|remov|cancel|ended|abandon/.test(json(r))) ? "full" : false],
  ["Bob's new address is 12 Elm Street, Somerville MA 02144", async () => /12 elm/.test(json(await donorAfter(D("bob")))) ? "full" : false],
  ["add Mary Smith to the Smith household", async () => { const m = await donorAfter(D("mary")), j = await donorAfter(D("john"));
      return m.household_id && m.household_id === j.household_id ? "full" : false; }],
  ["emailed the Sunrise Foundation today about their site visit", async d => ints(d, D("sunrise"), "email").some(x => String(x.date).slice(0, 10) === T) ? "full" : false],
  ["make Carlos Mendes a volunteer, Saturdays, as a driver", async d => {
    const r = has(d, "volunteer_applications").ins.find(x => x.person_id === D("carlos") && x.status === "approved");
    return r && json(r).includes("saturdays") && json(r).includes("driver") ? "full" : r ? "partial" : false; }],
  ["move Margaret to Solicit", async () => (await donorAfter(D("margaret"))).stage === "solicit" ? "full" : false],
  ["tag Bob as board prospect", async () => /board prospect/.test(json((await donorAfter(D("bob"))).tags)) ? "full" : false],
  ["remind me to call Ada next Tuesday", async d => has(d, "tasks").ins.some(x => String(x.due || "").slice(0, 10) === nextDow(2)) ? "full" : has(d, "tasks").ins.length ? "partial" : false],
  ["draft a thank-you note to Margaret for her last gift", async d => anyRow(d, (r, t) => /draft/.test(t) && json(r).includes(D("margaret").toLowerCase())) ? "full" : false],
  ["add Carlos to the Spring open house guest list", async d => anyRow(d, (r, t) => /attendee|registration|guest/.test(t) && json(r).includes(D("carlos").toLowerCase())) ? "full" : false],
  ["got a $250 check from Margaret today", async d => has(d, "gifts").ins.filter(x => x.donor_id === D("margaret") && Number(x.amount) === 250).length === 1 ? "full" : false],
  ["make Lena Ortiz the owner of the Sunrise Foundation", async (d, c) => (await donorAfter(D("sunrise"))).assigned_to === c.lena ? "full" : false],
  ["how many people gave this month?", async (d, c, res) => res && res.read ? "full" : false],
  ["put Grace Whitfield in the gala table hosts group and start the first-year journey for her", async (d, c) => {
    const g = anyRow(d, r => json(r).includes(c.groupId.toLowerCase()) && json(r).includes(D("new3").toLowerCase()));
    const j = anyRow(d, (r, t) => t !== "donors" && json(r).includes(c.journeyId.toLowerCase()) && json(r).includes(D("new3").toLowerCase()));
    return g && j ? "full" : g || j ? "partial" : false; }],
];

(async () => {
  const label = process.argv[2] || "run";
  const only = process.env.ONLY ? process.env.ONLY.split(",").map(Number) : null;
  const results = [];
  for (const [i, [text, judge]] of CASES.entries()) {
    if (only && !only.includes(i + 1)) continue;
    const c = await F.build();
    c.me = `u_${ORG}_dir`; c.lena = `u_${ORG}_lena`;
    const before = await snapshot();
    let res = null, plan = null, run = null, said = "";
    const r = await api("POST", "/agent/instructions", c.tok, { text });
    res = r.body;
    if (r.status === 201 && res.plan) {
      plan = res.plan;
      const cf = await api("POST", `/agent/instructions/${res.id}/confirm`, c.tok, {});
      run = cf.body;
      said = `${cf.status} ${run.status || ""} done=${run.done ?? ""}`;
    } else said = `${r.status} ${res.error || (res.read ? "read" : res.which ? "asked which" : res.cannot ? "cannot" : "")} ${String(res.sentence || (res.cannot && res.cannot.sentence) || "").slice(0, 160)}`;
    const after = await snapshot();
    const d = diff(before, after);
    let verdict = await judge(d, c, res).catch(e => "error:" + e.message);
    const saidCannot = (res && res.cannot) || (plan && plan.cannot);
    if (!verdict) verdict = isNotesOnly(d) ? "notes" : Object.keys(d).some(t => !NOISE.test(t)) ? "other" : saidCannot ? "honest" : "nothing";
    if (verdict === "partial" && saidCannot) verdict = "partial+said";
    const tools = plan ? (plan.steps || []).map(s => s.tool).join(",") : "";
    const outcomes = run && run.steps ? run.steps.map(s => `${s.tool}:${s.outcome}${s.reason ? "(" + s.reason + ")" : ""}`).join(" ") : "";
    const changed = Object.keys(d).filter(t => !NOISE.test(t)).join(",");
    results.push({ n: i + 1, text, verdict, said, tools, outcomes, changed, headline: plan && plan.headline || null, cannot: plan && plan.cannot || null });
    console.log(`${String(i + 1).padStart(2)} ${verdict.padEnd(8)} | ${text}\n     ${said} | plan: ${tools} | ${outcomes} | changed: ${changed}${plan ? ` | headline: ${plan.summary}` : ""}${saidCannot ? ` | cannot: ${typeof saidCannot === "string" ? saidCannot : saidCannot.sentence}` : ""}`);
  }
  fs.writeFileSync(`audit/agent2-${label}.json`, JSON.stringify(results, null, 1));
  const tally = results.reduce((a, r) => (a[r.verdict] = (a[r.verdict] || 0) + 1, a), {});
  console.log("\nTALLY", JSON.stringify(tally));
  await closeDb();
})().catch(async e => { console.error(e); await closeDb(); process.exit(1); });
