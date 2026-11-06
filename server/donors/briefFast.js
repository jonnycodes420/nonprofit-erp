// server/donors/briefFast.js · ATLAS-3. BRIEF ME, FAST, PLAIN, AND KEPT.
//
// Prof 7 (Muse, 5 Nov): Brief me took about 25 seconds, wrote "this
// organization calls somebody like this a sponsor" (the model repeating a
// line of the rows it was handed), and showed "(1 row)" after every sentence.
//   · KEPT: the last brief for a person is served again until one of the rows
//     it was written from changes (a gift, a conversation, a note, the plan).
//     The fingerprint is a hash of exactly the lines the model was handed.
//   · FIRST WORDS AT ONCE: with ?stream=1 the answer is a stream of lines
//     (application/x-ndjson). The first is written from the record in code,
//     before the model is asked; the brief follows when it is checked.
//   · FASTER: the brief is one short structured call on the faster model
//     (BRIEF_MODEL overrides it), as Atlas's read moved in AGENT-5.
//   · PLAIN: the org's word for a donor goes to the model as an instruction,
//     not as a row to repeat, and a sentence about what "this organization
//     calls" anyone is dropped whatever the model wrote.
"use strict";
const crypto = require("crypto");

const BRIEF_MODEL = () => process.env.BRIEF_MODEL || "claude-sonnet-4-6";
const VERSION = "atlas4-v1";   // ATLAS-4: quotes completed in code (briefComplete.js)   // a change to the prompt or the check writes every brief fresh

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDay = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || "")); return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : ""; };
const fingerprint = lines => crypto.createHash("sha1").update(VERSION + "\n" + (lines || []).join("\n")).digest("hex");

async function cachedBrief(query, orgId, donorId, fp) {
  const [r] = await query(`SELECT id, actions, finished_at FROM agent_runs
                            WHERE org_id=? AND status='done' AND plan->>'kind'='prospect_brief' AND plan->>'donorId'=? AND plan->>'fingerprint'=?
                            ORDER BY finished_at DESC NULLS LAST LIMIT 1`, [orgId, donorId, fp]);
  return r && r.actions && r.actions.brief ? { runId: r.id, brief: r.actions.brief, writtenAt: r.finished_at } : null;
}

// What the model is told about the org's words, as an instruction.
function vocabularyRule(givingWord) {
  const w = String(givingWord || "").trim();
  return w && w.toLowerCase() !== "donor" ? `- This organization says "${w}" where others say donor. Use that word; never explain or mention the choice of word.` : null;
}

const META = /\b(this|the) organi[sz]ation calls\b|\bcalls (somebody|someone|people) like this\b/i;
function scrub(checked) {
  // Not a claim about them, so not one of the "left out" lines: it just goes.
  const sections = (checked.sections || []).map(sec => ({ ...sec, sentences: (sec.sentences || []).filter(s => !META.test(s.text)) })).filter(sec => sec.sentences.length);
  return { ...checked, sections, headline: META.test(checked.headline || "") ? "" : checked.headline };
}

// The first words, from the record in code: who, their giving, the last
// conversation. Each a fact Steward holds; none is the model's.
function openingLines(ctx, money, toCents) {
  const d = ctx.donor;
  const first = String(d.name).split(/\s+/)[0];
  const n = Number(d.gift_count) || 0;
  const out = [n
    ? `${first} has given ${money.formatCentsPlain(toCents(d.total_giving) || 0)} across ${n} ${n === 1 ? "gift" : "gifts"}, most recently on ${longDay(d.last_gift_date) || "a date not on record"}.`
    : `${first} has no gifts on record yet.`];
  if (String(d.about_them || "").trim()) out.push(`About ${first}: ${String(d.about_them).trim()}`);   // ATLAS-4: in full, never cut
  return out;
}

const wantsStream = req => req.query && (req.query.stream === "1" || req.query.stream === "true");
function startStream(res) {
  res.status(200);
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Accel-Buffering", "no");
  return obj => { res.write(JSON.stringify(obj) + "\n"); if (typeof res.flush === "function") res.flush(); };
}

module.exports = { BRIEF_MODEL, fingerprint, cachedBrief, vocabularyRule, scrub, openingLines, wantsStream, startStream, META };
