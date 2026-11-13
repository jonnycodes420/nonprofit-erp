// routes/atlasMore.js · ATLAS-3. THE PROFILE'S MORE MENU DOES WHAT IT SAYS.
//
// Prof 7 (Muse, 5 Nov): "Call script" opened the same generic suggestion
// panel as "Draft an email". A call script is now its own thing, shaped for a
// phone call: the opening, what to thank them for, the ask or the check-in,
// questions to ask, and the close.
//
// POST /donors/:id/call-script. The facts are read here from the record (the
// same donor row the profile reads, their last conversation, the next step,
// an open ask); the model writes the sentences through the AI switch and is
// handed nothing else. A script whose dollar figure is not one of those facts
// is not shown: the template script is, written from the same facts. With AI
// off, the template is the answer. Nothing is written or sent: it is a read.
"use strict";
const express = require("express");
const { anthropicFor, recordAiFallback } = require("../aiClient");
const money = require("../money");

const routers = { r0: express.Router() };
const SCRIPT_MODEL = () => process.env.ATLAS_MODEL || "claude-sonnet-4-6";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const day = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || "")); return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : ""; };
const usd = v => money.formatCentsPlain(money.toCents(v) || 0);

const SCRIPT_TOOL = {
  name: "call_script",
  description: "A short phone call script for a fundraiser calling one person.",
  input_schema: {
    type: "object", additionalProperties: false, required: ["opening", "thank_for", "ask", "questions", "close"],
    properties: {
      opening: { type: "string", description: "What she says first: who she is, and why she is calling. One or two sentences." },
      thank_for: { type: "string", description: "What to thank them for, from the facts only. One or two sentences." },
      ask: { type: "string", description: "The ask or the check-in, from the facts only. One or two sentences. No amount unless the facts give one." },
      questions: { type: "array", items: { type: "string" }, description: "Two or three open questions to ask them." },
      close: { type: "string", description: "How to end the call: thanks, and the next step. One or two sentences." },
    },
  },
};

// ATLAS-4 · the call script says who is calling. "(your name)" was left for
// her to fill in; the signed-in person's signing name and title (Settings,
// Signature) go in, and any placeholder the model writes is filled the same way.
async function callerFor(query, req) {
  const [u] = await query("SELECT name, sign_name, sign_title FROM users WHERE id=? AND org_id=?", [req.user.userId, req.user.orgId]).catch(() => []);
  const name = String((u && (u.sign_name || u.name)) || (req.user && req.user.name) || "").trim();
  return { name, title: String((u && u.sign_title) || "").trim() };
}
const callerWords = c => (c.name ? `${c.name}${c.title ? `, ${c.title},` : ""}` : "");
function fillCaller(text, c) {
  const who = callerWords(c);
  let t = String(text || "");
  if (who) t = t.replace(/[([]\s*your (?:full )?name\s*[)\]](?:\s*,?\s*[([]\s*your (?:job )?title\s*[)\]],?)?/gi, who);
  t = t.replace(/,?\s*[([]\s*your (?:job )?title\s*[)\]]/gi, c.title ? `, ${c.title}` : "");
  t = t.replace(/,\s*,/g, ",").replace(/\s+,/g, ",");
  return c.title ? t : t.replace(new RegExp(`(${c.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") || "\\uFFFF"}),\\s+from\\b`, "g"), "$1 from");
}
const fillScript = (s, c) => ({ ...s, opening: fillCaller(s.opening, c), thank_for: fillCaller(s.thank_for, c), ask: fillCaller(s.ask, c),
  questions: (s.questions || []).map(q => fillCaller(q, c)), close: fillCaller(s.close, c) });

// Every dollar figure in the script must be one of the facts.
function figuresGrounded(script, lines) {
  const said = JSON.stringify(script).match(/\$\s?\d[\d,]*(?:\.\d+)?/g) || [];
  const known = lines.join(" ");
  return said.every(x => known.includes(x.replace(/\s/g, "")));
}

// FLOWS-10 item 5: filled in by mount(), which holds the query these read through.
const shared = { facts: null, factLines: null };
function mount(ctx) {
const { query, wrap, requireAuth, agentGate } = ctx;
const app = routers.r0;
shared.facts = (...a) => facts(...a); shared.factLines = f => factLines(f);   // FLOWS-10 item 5: Atlas's draft reads the facts Call script reads

async function facts(orgId, donorId) {
  // TRUTH-3: lifetime, the gift count and the last gift by the profile's rules (shared/numbers), never the stored rollup.
  const [d] = await query(`SELECT d.id, d.name, d.about_them, ROUND(${require("../shared/numbers/lifetime").LIFETIME("d")}, 2) AS total_giving, ${require("../shared/numbers/giftCount").GIFT_COUNT("d")} AS gift_count,
                                    (SELECT lg.amount FROM gifts lg WHERE lg.org_id = d.org_id AND lg.donor_id = d.id AND ${require("../shared/numbers/money").GIFT("lg")} AND lg.date IS NOT NULL ORDER BY ${require("../shared/numbers/lastGift").LAST_GIFT_ORDER.replace(/\bg\./g, "lg.")} LIMIT 1) AS last_gift_amount,
                                    (SELECT LEFT(lg.date, 10) FROM gifts lg WHERE lg.org_id = d.org_id AND lg.donor_id = d.id AND ${require("../shared/numbers/money").GIFT("lg")} AND lg.date IS NOT NULL ORDER BY ${require("../shared/numbers/lastGift").LAST_GIFT_ORDER.replace(/\bg\./g, "lg.")} LIMIT 1) AS last_gift_date, d.deceased, d.do_not_contact, o.name AS org_name
                             FROM donors d JOIN orgs o ON o.id = d.org_id WHERE d.id=? AND d.org_id=? AND d.deleted_at IS NULL`, [donorId, orgId]);
  if (!d) return null;
  const [conv] = await query(`SELECT type, date, note FROM interactions WHERE org_id=? AND donor_id=? AND COALESCE(note,'') <> '' AND type = ANY(ARRAY['call','meeting','email','visit','ask','note','stewardship']) ORDER BY date DESC NULLS LAST, created_at DESC LIMIT 1`, [orgId, donorId]);
  const [task] = await query(`SELECT title, due FROM tasks WHERE org_id=? AND donor_id=? AND COALESCE(done,0)=0 AND voided_at IS NULL ORDER BY due NULLS LAST LIMIT 1`, [orgId, donorId]).catch(() => []);
  const { OPEN_STAGE_KEYS } = await import("../shared/proposalShape.js");
  const [ask] = await query(`SELECT name, target_amount FROM opportunities WHERE org_id=? AND donor_id=? AND proposal_stage = ANY(?::text[]) ORDER BY expected_close NULLS LAST LIMIT 1`, [orgId, donorId, OPEN_STAGE_KEYS]).catch(() => []);
  return { d, conv: conv || null, task: task || null, ask: ask || null, first: String(d.name).split(/\s+/)[0] };
}

// The script from the facts alone: the answer with AI off, and the one shown
// when a model script names a figure the record does not have.
function templateScript(f, caller = { name: "", title: "" }) {
  const { d, conv, task, ask, first } = f;
  const n = Number(d.gift_count) || 0;
  return {
    opening: `Hi ${first}, this is ${caller.name ? `${caller.name}${caller.title ? `, ${caller.title},` : ""}` : "(your name)"} from ${d.org_name}. Do you have a few minutes? I'm calling to say thank you and to catch up.`,
    thank_for: n ? `Thank you for your ${n === 1 ? "gift" : "support"}: ${usd(d.last_gift_amount)} on ${day(d.last_gift_date)}${n > 1 ? `, and ${usd(d.total_giving)} across ${n} gifts in all` : ""}. It made a real difference.`
      : "Thank you for being part of what we do.",
    ask: ask ? `There is an open ask on record: ${ask.name}${Number(ask.target_amount) > 0 ? ` (${usd(ask.target_amount)})` : ""}. Ask whether they'd like to talk it through.`
      : task ? `Check in on the next step you planned: ${task.title}.` : "Check in: ask how they are, and whether they'd like to hear what their support made possible this year.",
    questions: [
      ...(String(d.about_them || "").trim() ? [`You've told us before: "${String(d.about_them).trim().slice(0, 140)}". Is that still right?`] : []),
      ...(conv ? [`Last time (${day(conv.date)}) we talked about: "${String(conv.note).replace(/\s+/g, " ").slice(0, 120)}". How did that go?`] : []),
      "What drew you to our work in the first place?",
      "Is there anything you'd like to see more of from us?",
    ].slice(0, 3),
    close: `Thank them again, and say what happens next${task ? `: ${task.title}` : ""}. Log the call on ${first}'s profile when you hang up.`,
  };
}

function factLines(f) {
  const { d, conv, task, ask } = f;
  const n = Number(d.gift_count) || 0;
  return [
    `Name: ${d.name}. Calling for: ${d.org_name}.`,
    n ? `Giving on record: ${usd(d.total_giving)} across ${n} gifts; the last was ${usd(d.last_gift_amount)} on ${day(d.last_gift_date)}.` : "Giving on record: none yet.",
    String(d.about_them || "").trim() ? `What the team wrote about them: ${String(d.about_them).trim().slice(0, 400)}` : null,
    conv ? `Last conversation (${conv.type}, ${day(conv.date)}): ${String(conv.note).slice(0, 400)}` : "No conversation logged yet.",
    task ? `The next step planned: ${task.title}${task.due ? `, due ${day(task.due)}` : ""}.` : null,
    ask ? `An open ask: ${ask.name}${Number(ask.target_amount) > 0 ? `, ${usd(ask.target_amount)}` : ""}.` : null,
  ].filter(Boolean);
}

app.post("/donors/:id/call-script", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const f = await facts(orgId, String(req.params.id));
  if (!f) return res.status(404).json({ error: "Donor not found" });
  if (f.d.deceased || f.d.do_not_contact) return res.status(409).json({ error: "no_call", sentence: `${f.d.name} is marked ${f.d.deceased ? "as deceased" : "do not contact"}, so there is no call script.` });
  const caller = await callerFor(query, req);
  const template = fillScript(templateScript(f, caller), caller);
  const gate = await agentGate(orgId);
  if (!gate.ok) return res.json({ donorId: f.d.id, name: f.d.name, script: template, source: "template" });
  const lines = factLines(f);
  try {
    const msg = await anthropicFor(orgId).messages.create({
      model: SCRIPT_MODEL(), max_tokens: 700, thinking: { type: "disabled" },
      system: "You write a short phone call script for a nonprofit fundraiser. Use only the facts given: no amount, date, program or event that is not in them. Plain spoken sentences, no markdown, no em dashes. The caller introduces herself by the name and title given.",
      messages: [{ role: "user", content: `Facts:\n${lines.join("\n")}\nThe caller: ${callerWords(caller).replace(/,$/, "") || "(not on record)"}.\n\nWrite the call script.` }],
      tools: [{ name: SCRIPT_TOOL.name, description: SCRIPT_TOOL.description, strict: true, input_schema: SCRIPT_TOOL.input_schema }],
      tool_choice: { type: "tool", name: SCRIPT_TOOL.name },
    });
    const use = (msg.content || []).find(b => b.type === "tool_use" && b.name === SCRIPT_TOOL.name);
    const s = use && use.input;
    if (s && s.opening && s.thank_for && s.ask && Array.isArray(s.questions) && s.questions.length && s.close && figuresGrounded(s, lines)) {
      const clean = t => fillCaller(String(t).replace(/\s*—\s*/g, ", "), caller).slice(0, 600);
      return res.json({ donorId: f.d.id, name: f.d.name, source: "ai",
        script: { opening: clean(s.opening), thank_for: clean(s.thank_for), ask: clean(s.ask), questions: s.questions.slice(0, 4).map(clean), close: clean(s.close) } });
    }
  } catch (e) {
    console.error("[call-script]", e && e.status ? e.status : "", String(e && e.message || e).slice(0, 160));
    await recordAiFallback(orgId, "call_script", e).catch(() => {});
  }
  res.json({ donorId: f.d.id, name: f.d.name, script: template, source: "template" });
}));
}

// FLOWS-10 item 5: one email fact, from the facts Call script reads; what the template names
// instead of "I wanted to reach out". A gift first, then the last conversation; null when neither.
function oneFact(f) {
  if (!f) return null;
  const n = Number(f.d.gift_count) || 0;
  if (n && f.d.last_gift_amount && f.d.last_gift_date) return `Thank you for your gift of ${usd(f.d.last_gift_amount)} on ${day(f.d.last_gift_date)}. It made a real difference here.`;
  if (f.conv && f.conv.date) return `Thank you for the time you gave us when we spoke on ${day(f.conv.date)}.`;
  return null;
}

module.exports = { routers, mount, SCRIPT_TOOL, oneFact, facts: (...a) => shared.facts(...a), factLines: f => shared.factLines(f), _test: { figuresGrounded, fillCaller } };
