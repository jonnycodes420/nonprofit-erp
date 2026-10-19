// scripts/seed/voice1-memos.js · VOICE-1. HARBORLIGHT A WEEK INTO TELL STEWARD.
//
// Three memos the director "said" over the last week, each with what Steward
// did with it, stored exactly the way routes/voice.js stores a live one: the
// memo row, the Notes instruction and its run, the conversation (with the memo
// it came from), the tasks, the interest tag, and an agent_writes row for each
// write so the demo's Undo really undoes it.
//
//   · six days ago, coffee with Margaret Chen: the coffee logged, a task to
//     send her photos of the boat, her interest in the Harbor Skills Boat;
//   · three days ago, a call with Tobias Fairweather: the call logged, a task
//     for early March, and a $2,500 interest card WAITING for her yes (no
//     money is written by this file);
//   · yesterday, a visit with Halvard Bellwether: the visit logged without
//     the personal sentence, which waits as a flagged card in neutral words.
//
// Idempotent: every row it owns starts `vm1_b72demo_`; the tag it adds is
// removed and added again.
"use strict";

const PRE = "vm1_b72demo_";
const AGENT = ["system:agent", "Steward (agent)"];
const HELD = "[A personal detail is held back for your yes.]";

async function seedVoice1(q, ORG, { TODAY, dAdd }) {
  const [t] = await q(`SELECT to_regclass('voice_memos') AS t`);
  if (!t.t) throw new Error("voice1 seed: voice_memos does not exist (db.js has not built it)");
  const [dir] = await q(`SELECT id, name FROM users WHERE org_id=$1 ORDER BY created_at LIMIT 1`, [ORG]);
  if (!dir) throw new Error("voice1 seed: Harborlight has no user");
  const person = async name => {
    const [d] = await q(`SELECT id, name, tags FROM donors WHERE org_id=$1 AND name=$2 AND deleted_at IS NULL`, [ORG, name]);
    if (!d) throw new Error(`voice1 seed: ${name} is not in the demo`);
    return d;
  };
  const fund = async name => {
    const [f] = await q(`SELECT id, name FROM fin_funds WHERE org_id=$1 AND name=$2`, [ORG, name]);
    if (!f) throw new Error(`voice1 seed: the ${name} fund is not in the demo`);
    return f;
  };

  // ── start clean ───────────────────────────────────────────────────────────
  await q(`DELETE FROM agent_writes WHERE org_id=$1 AND id LIKE $2`, [ORG, PRE + "%"]);
  await q(`DELETE FROM interactions WHERE org_id=$1 AND id LIKE $2`, [ORG, PRE + "%"]);
  await q(`DELETE FROM tasks WHERE org_id=$1 AND id LIKE $2`, [ORG, PRE + "%"]);
  await q(`DELETE FROM agent_runs WHERE org_id=$1 AND id LIKE $2`, [ORG, PRE + "%"]);
  await q(`DELETE FROM agent_instructions WHERE org_id=$1 AND id LIKE $2`, [ORG, PRE + "%"]);
  await q(`DELETE FROM voice_memos WHERE org_id=$1 AND id LIKE $2`, [ORG, PRE + "%"]);

  const margaret = await person("Margaret Chen"), tobias = await person("Tobias Fairweather"), halvard = await person("Halvard Bellwether");
  const boat = await fund("Harbor Skills Boat"), scholarship = await fund("Scholarship Fund");
  const [ty, tm] = TODAY.split("-").map(Number);
  const march = `${tm >= 3 ? ty + 1 : ty}-03-01`;

  const memos = [
    { n: 1, ago: 6, how: "coffee", kind: "meeting", source: "speech", who: margaret,
      text: "Coffee with Margaret Chen down at the harbor. She loved seeing the second training boat and wants to hear how the Harbor Skills Boat is coming along. Follow up in a week with photos.",
      note: "Coffee with Margaret down at the harbor; she loved seeing the second training boat and wants to hear how the Harbor Skills Boat is coming along.",
      tasks: [{ title: "Send Margaret photos of the second training boat", dueAgo: -1 }],
      tag: `Interest: ${boat.name}`, cards: [] },
    { n: 2, ago: 3, how: "call", kind: "call", source: "typed", who: tobias,
      text: "Call with Tobias Fairweather. He is thinking about $2,500 for the scholarship fund this spring. Circle back in March.",
      note: "Call. Tobias is thinking about a gift to the Scholarship Fund this spring.",
      tasks: [{ title: "Circle back with Tobias about the scholarship gift", due: march }],
      cards: [{ id: PRE + "c2", kind: "money", moneyKind: "interest", cents: 250000, fundId: scholarship.id, fundName: scholarship.name, donorId: tobias.id,
        quote: "thinking about $2,500 for the scholarship fund", state: "waiting", title: `Log interest in a $2,500 gift to the ${scholarship.name}?` }] },
    { n: 3, ago: 1, how: "visit", kind: "meeting", source: "speech", who: halvard,
      text: `Visit with Halvard Bellwether at the boatyard. ${HELD} He still wants the end-of-season newsletter.`,
      note: "Visit with Halvard at the boatyard; he still wants the end-of-season newsletter.",
      tasks: [{ title: "Send Halvard the end-of-season newsletter", dueAgo: -13 }],
      cards: [{ id: PRE + "c3", kind: "sensitive", category: "health", neutral: "Mentioned a family health matter.", quote: "His wife is recovering from surgery, so he is keeping things quiet this fall.",
        donorId: halvard.id, state: "waiting", title: "Mentioned a family health matter" }] },
  ];

  for (const m of memos) {
    const id = PRE + "m" + m.n, ins = PRE + "i" + m.n, runId = PRE + "r" + m.n;
    const day = dAdd(TODAY, -m.ago);
    const at = `${day} 15:${10 + m.n}:00`;
    const first = m.who.name.split(" ")[0];
    const Label = m.how.charAt(0).toUpperCase() + m.how.slice(1);
    const steps = [{ tool: "log_conversation", donorId: m.who.id, kind: m.kind, how: m.how, date: day, note: m.note, memoId: id, linkedDonorIds: [],
      citesRows: [m.who.id], state: "runs", describes: `Log a ${m.kind} on ${m.who.name}`, line: `${Label} logged on ${m.who.name}` }];
    for (const tk of m.tasks) steps.push({ tool: "create_task", donorId: m.who.id, title: tk.title, due: tk.due || dAdd(TODAY, -tk.dueAgo), citesRows: [m.who.id], state: "runs",
      describes: `Create a task for ${m.who.name}`, line: `${tk.title}, a task` });
    if (m.tag) steps.push({ tool: "add_tag", donorId: m.who.id, tag: m.tag, citesRows: [m.who.id], state: "runs", describes: `Tag ${m.who.name}`,
      line: `Interest in the ${boat.name} noted on ${first}` });
    const plan = { steps, summary: `${Label} with ${first}, filed`, reads: `your memo about ${m.who.name}`, expectedCount: 1, sends: 0, confirms: 0, withheld: 0, cannot: null };

    await q(`INSERT INTO agent_instructions (id,org_id,text,kind,status,send_authorization,persona,plan,last_count,created_by,created_by_name,turned_on_by,turned_on_by_name,turned_on_at,created_at)
             VALUES ($1,$2,$3,'task','done','draft','notes',$4,1,$5,$6,$5,$6,$7,$7)`, [ins, ORG, m.text, JSON.stringify(plan), dir.id, dir.name, at]);
    const actions = [];
    const writes = [];
    const lineId = PRE + "int" + m.n;
    await q(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name,metadata,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [lineId, ORG, m.who.id, m.kind, m.note, day, AGENT[0], AGENT[1], JSON.stringify({ memoId: id, how: m.how, linkedDonorIds: [] }), at]);
    actions.push({ tool: "log_conversation", donorId: m.who.id, outcome: "done", entityId: lineId });
    writes.push(["log_conversation", "interactions", lineId, null, { donor_id: m.who.id, type: m.kind, date: day }]);
    for (const [k, tk] of m.tasks.entries()) {
      const tid = `${PRE}t${m.n}_${k}`;
      await q(`INSERT INTO tasks (id,org_id,title,due,priority,type,done,donor_id,created_by,created_by_name,created_at) VALUES ($1,$2,$3,$4,'medium','donor',0,$5,$6,$7,$8)`,
        [tid, ORG, tk.title, tk.due || dAdd(TODAY, -tk.dueAgo), m.who.id, AGENT[0], AGENT[1], at]);
      actions.push({ tool: "create_task", donorId: m.who.id, outcome: "done", entityId: tid });
      writes.push(["create_task", "tasks", tid, null, { donor_id: m.who.id }]);
    }
    if (m.tag) {
      const [row] = await q(`SELECT tags FROM donors WHERE id=$1`, [m.who.id]);
      let tags = []; try { tags = Array.isArray(row.tags) ? row.tags : JSON.parse(row.tags || "[]"); } catch { tags = []; }
      tags = tags.filter(x => x !== m.tag);
      const next = [...tags, m.tag];
      await q(`UPDATE donors SET tags=$1 WHERE id=$2 AND org_id=$3`, [JSON.stringify(next), m.who.id, ORG]);
      actions.push({ tool: "add_tag", donorId: m.who.id, outcome: "done", entityId: null });
      writes.push(["add_tag", "donors", m.who.id, { tags: JSON.stringify(tags) }, { tags: JSON.stringify(next) }]);
    }
    await q(`INSERT INTO agent_runs (id,org_id,instruction_id,started_at,finished_at,status,plan,read_summary,actions,drafted,sent,declined,withheld)
             VALUES ($1,$2,$3,$4,$4,'done',$5,$6,$7,0,0,0,0)`, [runId, ORG, ins, at, JSON.stringify(plan), plan.reads, JSON.stringify(actions)]);
    for (const [k, w] of writes.entries())
      await q(`INSERT INTO agent_writes (id,org_id,run_id,instruction_id,tool,entity_table,entity_id,before_row,after_row,cites,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [`${PRE}w${m.n}_${k}`, ORG, runId, ins, w[0], w[1], w[2], w[3] ? JSON.stringify(w[3]) : null, JSON.stringify(w[4]), JSON.stringify([m.who.id]), at]);
    await q(`INSERT INTO voice_memos (id,org_id,text,source,status,ai,donor_ids,read,cards,instruction_id,run_ids,created_by,created_by_name,created_at)
             VALUES ($1,$2,$3,$4,'done','on',$5,$6,$7,$8,$9,$10,$11,$12)`,
      [id, ORG, m.text, m.source, JSON.stringify([m.who.id]), JSON.stringify({ how: m.how, kind: m.kind, date: day, pending: null }), JSON.stringify(m.cards),
       ins, JSON.stringify([runId]), dir.id, dir.name, at]);
  }
  // No money: the one amount waits on its card.
  const [g] = await q(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1 AND notes LIKE 'From Tell Steward%'`, [ORG]);
  if (g.n) throw new Error("voice1 seed: a memo recorded money");
}

module.exports = { seedVoice1 };
