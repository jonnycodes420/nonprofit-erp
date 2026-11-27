// server/donors/briefTemplate.js · FLOWS-12 item 2 (W-1113-Donors-26, SECOND REPEAT).
// BRIEF ME WITH AI OFF: STEWARD'S OWN SENTENCES, THE ABOUT NOTE FIRST.
//
// Muse, third staging night: Brief me for Margaret Chen "is complete and
// accurate on gifts … but does not mention her About note (Harbor Skills Boat
// program, Lily's pottery wheel)". FLOWS-10 fixed the AI path (the note led
// the rows, and completeBrief puts it first) and tested it with a stand-in
// model. Staging has no AI key, so the fleet never reached that path: with AI
// off the More menu hid Brief me and POST /donors/:id/brief answered 503.
//
// Now the AI-off answer is a brief written here, from exactly the rows the
// model would be handed (interactions.js briefRowsFor, ctx.facts), every
// sentence citing its row, and finished by the same completeBrief, which puts
// the About note first and in full. WHY-1: with AI off, the same answer shows
// in template sentences. Nothing here calls a model.
"use strict";
const { storedCentsOr0 } = require("../../money");   // IMPORT-11: a stored amount, read exactly; none is 0
const BF = require("./briefFast");
const BC = require("./briefComplete");
const money = require("../../money");

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDay = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || "")); return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : ""; };
const TYPE = { call: "A call", meeting: "A meeting", email: "An email", ask: "An ask", note: "A note", stewardship: "A thank-you" };
const OPEN = "“", CLOSE = "”";
const q = t => `${OPEN}${String(t || "").replace(/\s+/g, " ").trim()}${CLOSE}`;

// The brief, in the shape the model answers in (shared/briefShape.js), from rows.
function templateBrief(ctx, toCents) {
  const d = ctx.donor, f = ctx.facts || {};
  const $ = v => money.formatCentsPlain(storedCentsOr0(v));
  const first = String(d.name || "").split(/\s+/)[0] || "They";
  const person = `person:${d.id}`;
  const sec = (key, title, sentences) => (sentences.length ? [{ key, title, sentences }] : []);
  const n = Number(d.gift_count) || 0;

  const giving = [{ cites: [person], text: n
    ? `${first} has given ${$(d.total_giving)} across ${n} ${n === 1 ? "gift" : "gifts"}${d.first_gift_date ? `, first on ${longDay(d.first_gift_date)}` : ""}${d.last_gift_date ? `, most recently on ${longDay(d.last_gift_date)}` : ""}.`
    : `${first} has no gifts on record yet.` }];
  for (const g of (f.gifts || []).slice(0, 3)) giving.push({ cites: [`gift:${g.id}`],
    text: `${$(g.amount)} on ${longDay(g.date) || "a date not on record"}${g.fund_name ? ` to ${g.fund_name}` : ""}${g.campaign ? `, for ${g.campaign}` : ""}.` });
  for (const p of (f.pledges || []).slice(0, 2)) giving.push({ cites: [`pledge:${p.id}`],
    text: `A pledge of ${$(p.amount)}${p.due_date ? ` due ${longDay(p.due_date)}` : ""}, ${p.status || "open"}. A pledge is a promise, not money received.` });

  const rel = [];
  if (f.household) rel.push({ cites: [`household:${f.household.id}`],
    text: `${first} is in the household ${q(f.household.name)}${f.household.members.length ? `, with ${f.household.members.join(" and ")}` : ""}.` });
  for (const sc of (f.softCredits || []).slice(0, 3)) rel.push({ cites: [`softcredit:${sc.id}`],
    text: `${first} was soft-credited for ${$(sc.amount)} given by ${sc.giver}${sc.date ? ` on ${longDay(sc.date)}` : ""}. The money was ${sc.giver}'s; this is recognition, not their own giving.` });

  const ask = (f.proposals || []).map(o => ({ cites: [`proposal:${o.id}`],
    text: `There is an open ask of ${$(o.target_amount)} for ${q(o.name)}, at the stage ${q(o.stageLabel)}${o.expected_close_civil ? `, expected to close ${longDay(o.expected_close_civil)}` : ""}.` }));

  const convs = (f.conversations || []).map(i => ({ cites: [`conversation:${i.id}`],
    text: `${TYPE[i.type] || "A conversation"} on ${longDay(i.date) || "an undated day"}${i.logged_by_name ? `, logged by ${i.logged_by_name}` : ""}, said ${q(i.note)}` }));

  const plan = f.plan ? [{ cites: [`plan:${f.plan.id}`], text: f.plan.step
    ? `${first} is on the plan ${q(f.plan.name)}; ${f.plan.open ? "the open step" : "the next step"} is ${q(f.plan.step.label)}${f.plan.step.due_date ? `, due ${longDay(f.plan.step.due_date)}` : ""}.`
    : `${first} is on the plan ${q(f.plan.name)}, and every step is closed.` }] : [];

  const notes = String(d.notes || "").trim() ? [{ cites: [`note:${d.id}`], text: `The note on their record reads ${q(d.notes)}` }] : [];

  return {
    headline: `What Steward holds on ${d.name}, for your visit`,
    sections: [...sec("giving", "Their giving", giving), ...sec("relationships", "Who they are to you", rel), ...sec("proposal", "The open ask", ask),
      ...sec("conversations", "Last five conversations", convs), ...sec("plan", "What is next", plan), ...sec("notes", "What you wrote", notes)],
    dropped: [],
  };
}

function sourceSentence(gate) {
  return gate && gate.reason === "ai_disabled"
    ? "AI is turned off for your organization, so Steward wrote this brief from the record in its own sentences."
    : "AI drafting isn't set up on this server, so Steward wrote this brief from the record in its own sentences.";
}

// The route's answer when the AI gate is shut. Kept like a written brief (an
// agent run with source "template", so the PDF opens it), and served again
// until a row it was written from changes.
async function answer({ req, res, ctx, gate, B, query, run, newId, toCents }) {
  const orgId = req.user.orgId;
  const fp = BF.fingerprint(["template", ...ctx.lines]);
  const write = BF.wantsStream(req) ? BF.startStream(res) : null;
  if (write) write({ type: "start", donorName: ctx.donor.name, opening: BF.openingLines(ctx, money, toCents) });
  const extra = { source: "template", sourceSentence: sourceSentence(gate) };
  const finish = out => { if (write) { write({ type: "brief", brief: out }); return res.end(); } return res.status(200).json(out); };
  const hit = !(req.query && req.query.fresh === "1") ? await BF.cachedBrief(query, orgId, ctx.donor.id, fp) : null;
  if (hit) return finish({ runId: hit.runId, donorId: ctx.donor.id, donorName: ctx.donor.name, headline: hit.brief.headline, sections: hit.brief.sections,
    dropped: [], droppedSentence: null, rowsRead: ctx.refs.size, footer: B.BRIEF_FOOTER, cached: true, writtenAt: hit.writtenAt, ...extra });
  const brief = BC.completeBrief(templateBrief(ctx, toCents), ctx);   // the About note first, in full (FLOWS-10)
  const runId = newId("arun");
  await run(`INSERT INTO agent_runs (id,org_id,status,plan,read_summary,actions,finished_at,declined,withheld) VALUES (?,?,?,?,?,?,NOW(),0,0)`,
    [runId, orgId, "done", JSON.stringify({ kind: "prospect_brief", donorId: ctx.donor.id, fingerprint: fp, source: "template" }),
     `${ctx.refs.size} rows on ${ctx.donor.name}`, JSON.stringify({ brief, donorId: ctx.donor.id, source: "template" })]);
  return finish({ runId, donorId: ctx.donor.id, donorName: ctx.donor.name, headline: brief.headline, sections: brief.sections,
    dropped: brief.dropped || [], droppedSentence: B.droppedSentence(brief.dropped || []), rowsRead: ctx.refs.size, footer: B.BRIEF_FOOTER, ...extra });
}

module.exports = { templateBrief, answer, sourceSentence };
