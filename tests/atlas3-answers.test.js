// tests/atlas3-answers.test.js · ATLAS-3. ATLAS ANSWERS WITH THE PEOPLE, USES WHAT WE KNOW,
// AND THE MORE MENU DOES ITS JOB.
//
// Donor data and money, from Muse's walks (4 and 5 Nov), on a made-up org
// (tests/atlas3/fixture.js). Every model call is a stand-in below, so the
// answers are the same every run.
//   §1 a list question ("who gave last December but not this year?") comes
//      back as the people: the right four, each with why, and the count;
//   §2 Open list opens the same set three times out of three;
//   §3 Tell me more keeps the conversation: the dialog's thread keeps the
//      answer (client/src/lib/atlasThread.js), and the next ask follows it
//      ("remind me to call her" after "tell me about Marlowe" is Marlowe);
//   §4 a person answer carries the About note, conversations and next step;
//   §5 a thank-you "for his $10,000 gift" that is not on record asks to
//      record it first, and writes no email;
//   §6 "link Stephen and Margaret" asks how, then links; never "I never merge";
//   §7 the More menu: Call script is a script, Draft an email is a draft,
//      Impact summary is a summary, Brief me cites in words and never says
//      "this organization calls somebody like this";
//   §8 nothing was sent to anyone.
// Planted (ATLAS-3 report): Tell me more resetting the thread turns §3 red;
// dropping the About note from the person answer turns §4 red.
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.MATRIX_PORT || 5698);
const MOCK = Number(process.env.CALENDAR_MOCK_PORT || 5619);
const SINK = Number(process.env.SINK_PORT || 5617);
process.env.PORT = String(PORT);
process.env.BASE = `http://localhost:${PORT}`;
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest";
if (/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)) process.env.DB_SSL = "disable";
process.env.DISABLE_BACKGROUND_TICKS = "1";
process.env.DISABLE_RATE_LIMIT = "1";
process.env.SESSION_CACHE_TTL_MS = "0";
process.env.JWT_SECRET = process.env.JWT_SECRET || "local-test-secret";
process.env.RESEND_API_KEY = "re_dummy_local";
process.env.RESEND_BASE_URL = `http://localhost:${SINK}`;
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_dummy";
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";
process.env.STEWARD_CREDENTIAL_KEY = process.env.STEWARD_CREDENTIAL_KEY || "local-scratch-credential-key-0123456789";
process.env.ANTHROPIC_API_KEY = "sk-ant-atlas3-standin";
process.env.ANTHROPIC_BASE_URL = `http://localhost:${MOCK}`;

const { ok, summary, login, api, q, closeDb, civilToday, atlasSaved } = require("./helpers");
const F = require("./atlas3/fixture");
const ROOT = path.join(__dirname, "..");

const MAIL = [];
const sink = http.createServer((req, res) => {
  let b = ""; req.on("data", d => { b += d; });
  req.on("end", () => { MAIL.push(b); res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ id: "re_sink_" + MAIL.length })); });
});

// ── THE STAND-IN MODEL ─────────────────────────────────────────────────────
const step = o => ({ kind: "other", who: "", target: "", amount_words: "", when_words: "", how: "", words: "", ...o });
const READS = [
  [/^Who gave last December/, [step({ kind: "question", target: "Who gave last December but not this year?", words: "Who gave last December but not this year?" })]],
  [/^Tell me about Marlowe/, [step({ kind: "about", who: "Marlowe", words: "Tell me about Marlowe" })]],
  [/^Remind me to call her/, [step({ kind: "reminder", who: "", when_words: "next week", words: "Remind me to call her next week" })]],
  [/^Thank Henrik/, [step({ kind: "draft_email", who: "Henrik", words: "Thank Henrik for his $10,000 gift" })]],
  // The read Muse saw: a link, read as a merge.
  [/^Link Stephen and Margaret/, [step({ kind: "merge", who: "Stephen", target: "Margaret", words: "Link Stephen and Margaret" })]],
  [/^Draft an email to Marlowe/, [step({ kind: "draft_email", who: "Marlowe Quince", words: "Draft an email to Marlowe Quince" })]],
];
const DEC_PLAN = y => ({ answerable: true, unsupported: null, entity: "people", where: [], measure: { fn: "count" }, list: true,
  related: [{ entity: "gifts", where: [{ field: "date", op: "between", value: [`${y - 1}-12-01`, `${y - 1}-12-31`] }] },
            { entity: "gifts", where: [{ field: "date", op: "gte", value: `${y}-01-01` }], none: true }] });
const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", d => { body += d; });
  req.on("end", () => {
    const send = (code, x) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(x)); };
    let x = {}; try { x = JSON.parse(body); } catch { /* empty */ }
    const name = x.tools && x.tools[0] && x.tools[0].name;
    const user = (x.messages || []).map(m => (typeof m.content === "string" ? m.content : (m.content || []).map(c => c.text || "").join("\n"))).join("\n");
    let input = null;
    if (name === "atlas_read") {
      const said = (/What she said: (.*)$/m.exec(user) || [])[1] || "";
      const hit = READS.find(([re]) => re.test(said));
      input = { steps: hit ? hit[1] : [] };
    } else if (name === "query_plan" && /December/.test(user)) input = DEC_PLAN(Number(civilToday().slice(0, 4)));
    else if (name === "atlas_draft") input = { subject: "Thank you, Marlowe", body: "Dear Marlowe,\n\nThank you for standing with the young artists here.\n\nWarmly," };
    else if (name === "call_script") input = { opening: "Hi Marlowe, this is (your name) from Lantern Bay Arts.", thank_for: "Thank you for your $150 gift last December.",
      ask: "Would you like to come to the spring showcase?", questions: ["What drew you to youth arts?", "Is weekday email still best?"], close: "Thank you again; I'll send the invitation." };
    else if (name === "brief") {
      const gifts = [...user.matchAll(/^(gift:[\w-]+) /gm)].map(m => m[1]);
      const person = (/^(person:[\w-]+) /m.exec(user) || [])[1];
      const note = (/^(note:[\w-]+):/m.exec(user) || [])[1];
      input = { headline: "A supporter of the youth arts programs", sections: [
        { key: "giving", sentences: [{ text: "They gave last December.", cites: gifts.length ? gifts : [person] }] },
        { key: "notes", sentences: [{ text: "The team notes they prefer email on weekdays.", cites: [note || person] },
          { text: "This organization calls somebody like this a sponsor.", cites: [person] }] }] };
    }
    if (!input) return send(500, { type: "error", error: { type: "api_error", message: "no stand-in for " + name } });
    send(200, { id: "msg_standin", type: "message", role: "assistant", model: x.model, stop_reason: "tool_use",
      usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "tool_use", id: "tu_1", name, input }] });
  });
});

(async () => {
  console.log("atlas3-answers (ATLAS-3)");
  await new Promise(r => mock.listen(MOCK, r));
  await new Promise(r => sink.listen(SINK, r));
  require("../server.js");
  await require("./helpers").untilReady();
  await F.reset(q);
  await F.seed(q, civilToday());
  const tok = await login(F.ADMIN);
  ok("fixture admin signed in", !!tok, tok);
  await api("POST", "/onboarding/complete", tok, {}).catch(() => {});
  const atlas = body => atlasSaved(tok, body);
  const lineOf = r => ((r.body && r.body.request && r.body.request.lines) || [])[0] || {};

  // ── §1 A LIST IS A LIST ──────────────────────────────────────────────────
  console.log("\n§1 a list question returns the people");
  const r1 = await atlas({ text: "Who gave last December but not this year?" });
  const a1 = lineOf(r1).answer;
  const names = a1 && a1.people ? a1.people.map(p => p.name).sort() : [];
  ok("§1 the answer is a list of people, not one line", !!a1 && a1.type === "list", r1.body);
  ok("§1 the right four: gave last December, nothing this year (Tamsin gave both years, Henrik only this year)",
    names.join(",") === "Marlowe Quince,Odette Varga,Piers Lindqvist,Sterling Nakamura", names);
  ok("§1 each has a name that opens their record and why they matched", !!a1 && a1.people.every(p => /^d_a3_/.test(p.donorId) && /^\$[\d,]+ in Dec \d{4}$/.test(p.amount) && /in all$/.test(p.lifetime)),   // ATLAS-4: the matched amount
    a1 && a1.people);
  ok("§1 Sterling's reason is his own gift ($900 in December)", !!a1 && /^\$900 in Dec \d{4}/.test((a1.people.find(p => p.donorId === "d_a3_sterling") || {}).reason || ""), a1 && a1.people);
  ok("§1 and the count", !!a1 && a1.count === 4, a1 && a1.count);
  ok("§1 the dialog never gets the server's id list", !!a1 && a1.ids === undefined, a1 && Object.keys(a1));

  // ── §2 OPEN LIST, THE SAME SET EVERY TIME ────────────────────────────────
  console.log("\n§2 Open list opens the same set, three times out of three");
  const id1 = lineOf(r1).id;
  const opens = [];
  for (let i = 0; i < 3; i++) opens.push(await api("POST", `/atlas/actions/${id1}/list`, tok, {}));
  const gids = opens.map(o => o.body && o.body.groupId);
  ok("§2 three clicks, one group", opens.every(o => o.status < 300) && !!gids[0] && gids.every(g => g === gids[0]), opens.map(o => [o.status, o.body]));
  const members = gids[0] ? (await q(`SELECT donor_id FROM group_members WHERE org_id=$1 AND group_id=$2 ORDER BY donor_id`, [F.ORG, gids[0]])).map(r => r.donor_id) : [];
  ok("§2 the group is exactly the four people in the answer", members.join(",") === "d_a3_marlowe,d_a3_odette,d_a3_piers,d_a3_sterling", members);
  const [grp] = gids[0] ? await q(`SELECT kind, created_by FROM audiences WHERE id=$1`, [gids[0]]) : [];
  ok("§2 a group kept by hand, stamped with who made it", !!grp && grp.kind === "static" && grp.created_by === F.USER, grp);
  const r1b = await atlas({ text: "Who gave last December but not this year?" });
  ok("§2 asking again gives the same people", (lineOf(r1b).answer || {}).count === 4
    && (lineOf(r1b).answer.people || []).map(p => p.donorId).sort().join() === a1.people.map(p => p.donorId).sort().join(), lineOf(r1b));

  // ── §3 TELL ME MORE KEEPS THE CONVERSATION ───────────────────────────────
  console.log("\n§3 Tell me more keeps context");
  const TH = await import(path.join(ROOT, "client/src/lib/atlasThread.js"));
  const req1 = r1.body.request;
  const thread = TH.continueThread([], req1);
  ok("§3 Tell me more keeps the answer on screen", thread.length === 1 && thread[0].id === req1.id, thread.map(t => t.id));
  const thread2 = TH.continueThread(thread, { id: "vm_next", lines: [] });
  ok("§3 and the one before it", thread2.length === 2 && thread2[0].id === req1.id, thread2.map(t => t.id));
  ok("§3 the next ask follows the last answer", TH.askBody("and?", { thread }).followsId === req1.id, TH.askBody("and?", { thread }));
  const r3a = await atlas({ text: "Tell me about Marlowe" });
  const r3b = await atlas(TH.askBody("Remind me to call her next week", { thread: TH.continueThread([], r3a.body.request) }));
  const [t3] = await q(`SELECT donor_id, title FROM tasks WHERE org_id=$1 AND title ILIKE 'call%' ORDER BY created_at DESC LIMIT 1`, [F.ORG]);
  ok("§3 \"call her\" after \"tell me about Marlowe\" is Marlowe", !!t3 && t3.donor_id === "d_a3_marlowe" && /Call Marlowe/.test(t3.title), { t3, lines: r3b.body.request && r3b.body.request.lines });
  ok("§3 the request says what it followed", r3b.body.request && r3b.body.request.follows === r3a.body.request.id, r3b.body.request && r3b.body.request.follows);

  // ── §4 A PERSON ANSWER USES WHAT STEWARD KNOWS ───────────────────────────
  console.log("\n§4 a person answer");
  const a4 = lineOf(r3a).answer || {};
  const facts = (a4.facts || []).map(f => f.line);
  ok("§4 it carries the About note", facts.some(l => /prefers email on weekdays; loves youth arts/i.test(l)), facts);
  ok("§4 their last conversations", facts.some(l => /spring showcase/.test(l)) && facts.some(l => /mural program/.test(l)), facts);
  ok("§4 their next step", facts.some(l => /^Next step: Send Marlowe the showcase invitation/.test(l)), facts);
  ok("§4 and their giving, from the record", facts.some(l => /\$150 across 1 gift/.test(l)), facts);

  // ── §5 A GIFT THAT IS NOT ON RECORD ──────────────────────────────────────
  console.log("\n§5 an unrecorded $10,000");
  const draftsBefore = (await q(`SELECT COUNT(*)::int n FROM agent_drafts WHERE org_id=$1`, [F.ORG]))[0].n;
  const r5 = await atlas({ text: "Thank Henrik for his $10,000 gift" });
  const l5 = (r5.body.request && r5.body.request.lines) || [];
  ok("§5 Atlas asks to record it first", l5.some(l => /don't see a \$10,000 gift from Henrik Vale on record/.test(l.line) && /Record it first/.test(l.line) && l.waits), l5);
  ok("§5 and writes no thank-you for it", (await q(`SELECT COUNT(*)::int n FROM agent_drafts WHERE org_id=$1`, [F.ORG]))[0].n === draftsBefore && !l5.some(l => l.kind === "draft"), l5);
  ok("§5 no gift is recorded without her tap", !(await q(`SELECT 1 FROM gifts WHERE org_id=$1 AND donor_id='d_a3_henrik' AND amount=10000`, [F.ORG])).length, null);

  // ── §6 LINK, NOT MERGE ───────────────────────────────────────────────────
  console.log("\n§6 link two people");
  const r6 = await atlas({ text: "Link Stephen and Margaret" });
  const q6 = (r6.body.request && r6.body.request.questions) || [];
  ok("§6 never \"I never merge people\"", !JSON.stringify(r6.body).includes("I never merge"), r6.body);
  ok("§6 it asks how they are related, both people found", q6.length === 1 && q6[0].kind === "relation" && /Stephen and Margaret/.test(q6[0].sentence) && q6[0].options.some(o => o.id === "spouse"), q6);
  const r6b = await atlasSaved(tok, { answers: { [q6[0] && q6[0].id]: "spouse" } }, `/atlas/${r6.body.request && r6.body.request.id}/answer`);
  const [rel] = await q(`SELECT relationship_type, created_by FROM donor_relationships WHERE org_id=$1 AND ((donor_id_a='d_a3_stephen' AND donor_id_b='d_a3_margaret') OR (donor_id_a='d_a3_margaret' AND donor_id_b='d_a3_stephen'))`, [F.ORG]);
  ok("§6 one click links them as spouses", !!rel && rel.relationship_type === "spouse" && rel.created_by === F.USER
    && ((r6b.body.request && r6b.body.request.lines) || []).some(l => /^Linked Stephen Hollis and Margaret Hollis \(spouses\)\.$/.test(l.line)), { rel, body: r6b.body });
  ok("§6 nobody was merged", (await q(`SELECT COUNT(*)::int n FROM donors WHERE org_id=$1 AND deleted_at IS NULL`, [F.ORG]))[0].n === 8, null);

  // ── §7 THE MORE MENU ─────────────────────────────────────────────────────
  console.log("\n§7 the More menu");
  const cs = await api("POST", "/donors/d_a3_marlowe/call-script", tok, {});
  const s7 = cs.body && cs.body.script;
  ok("§7 Call script returns a script: opening, thanks, ask, questions, close", cs.status === 200 && !!s7 && ["opening", "thank_for", "ask", "close"].every(k => typeof s7[k] === "string" && s7[k].length > 10)
    && Array.isArray(s7.questions) && s7.questions.length >= 2 && !/^Dear\b|Subject:/m.test(JSON.stringify(s7)), cs.body);
  const cs2 = await api("POST", "/donors/d_a3_henrik/call-script", tok, {});
  ok("§7 a call script never states an amount that is not on record", cs2.status === 200 && !/\$150\b/.test(JSON.stringify(cs2.body.script)) && cs2.body.source === "template", cs2.body);
  const de = await atlas({ text: "Draft an email to Marlowe Quince", donorId: "d_a3_marlowe" });
  const [dr] = await q(`SELECT status, subject, body FROM agent_drafts WHERE org_id=$1 AND donor_id='d_a3_marlowe' ORDER BY created_at DESC LIMIT 1`, [F.ORG]);
  ok("§7 Draft an email returns a draft for this person, waiting for her (not sent)", !!dr && dr.status === "pending" && /^Dear Marlowe/.test(dr.body)
    && ((de.body.request && de.body.request.lines) || []).some(l => l.kind === "draft" && /Review and send/.test(l.line)), { dr, lines: de.body.request && de.body.request.lines });
  const im = await api("GET", "/donors/d_a3_marlowe/impact-summary", tok);
  ok("§7 Impact summary returns a summary: giving, milestones, impact lines, recent gifts", im.status === 200 && im.body.giftCount === 1 && im.body.totalCents === 15000
    && Array.isArray(im.body.milestones) && Array.isArray(im.body.impactLines) && im.body.recentGifts.length === 1 && im.body.recentGifts[0].cents === 15000, im.body);
  const b1 = await api("POST", "/donors/d_a3_marlowe/brief", tok, {});
  const said = JSON.stringify(b1.body.sections || []);
  ok("§7 Brief me never says \"this organization calls somebody like this\"", b1.status === 200 && (b1.body.sections || []).length >= 1 && !/calls somebody like this/i.test(said), b1.body);
  const rows = await api("GET", "/donors/d_a3_marlowe/brief-rows", tok);
  ok("§7 nor is it handed that line to repeat", rows.status === 200 && !/calls somebody like this/i.test(JSON.stringify(rows.body.lines)), rows.body.lines);
  const BC = await import(path.join(ROOT, "shared/briefCite.js"));
  const cites = (b1.body.sections || []).flatMap(s => s.sentences.map(x => BC.citeWords(x.cites)));
  ok("§7 citations read in words (\"from a gift\"), never \"(1 row)\"", cites.length >= 2 && cites.every(c => /^from (a|an|\d+|their) /.test(c)) && !cites.some(c => /\brows?\b/.test(c))
    && !/\(\$\{s\.cites\.length\}|"row" : "rows"/.test(fs.readFileSync(path.join(ROOT, "client/src/components/MajorGifts.jsx"), "utf8")), cites);
  const b2 = await api("POST", "/donors/d_a3_marlowe/brief", tok, {});
  ok("§7 the brief is kept until something changes", b2.status === 200 && b2.body.cached === true && b2.body.runId === b1.body.runId, b2.body);
  await q(`INSERT INTO interactions (id,org_id,donor_id,type,date,note,logged_by_name,created_by) VALUES ('i_a3_new',$1,'d_a3_marlowe','call',$2,'Said yes to the showcase.','Rowan Pike','system:test')`, [F.ORG, civilToday()]);
  const b3 = await api("POST", "/donors/d_a3_marlowe/brief", tok, {});
  ok("§7 and written fresh after a new conversation", b3.status === 200 && !b3.body.cached && b3.body.runId !== b1.body.runId, b3.body);

  ok("§8 nothing was sent to anyone", MAIL.length === 0, MAIL);
  mock.close(); sink.close();
  await F.reset(q);
  await closeDb();
  summary();
  process.exit(process.exitCode || 0);
})().catch(async e => { console.error("SUITE ERROR:", e); mock.close(); sink.close(); await F.reset(q).catch(() => {}); await closeDb().catch(() => {}); process.exit(1); });
