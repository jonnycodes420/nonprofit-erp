// tests/atlas4-brief.test.js · ATLAS-4. BRIEF ME SAYS SOMETHING REAL, AND THE LAST WORDS THAT READ WRONG.
//
// Donor data, from Muse's Walk A (evening, 5 Nov) and Walk B, on a made-up org
// (tests/atlas4/fixture.js). Every model call is a stand-in below, written to
// misbehave the way the walks saw: a lead-in with no quote, a quote cut short,
// "(your name)", a call's labels dropped from its words.
//   §1 Brief me: every line of the brief is complete (no dangling colon, no
//      empty quote), the About note and the conversation are quoted in full,
//      and the call script has the signed-in person's name and title;
//   §2 Atlas answers in good time: a people and a person answer are timed, and
//      a question past its budget answers with what it has, not a long wait;
//   §3 a list answer shows each person's matched amount, lifetime second;
//   §4 a call logged through Atlas keeps her words, labels included;
//   §5 the More menu offers Add to a journey, and Export downloads a file
//      with their record, gifts and notes, and writes an audit row;
//   §6 a never-giver's appeal has no "given before"; the email-on line is
//      hidden while every switch is off; the Sequences empty state is right;
//   §7 nothing was sent to anyone.
// Planted (ATLAS-4 report): dropping the About note from the brief turns §1 red.
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
process.env.ANTHROPIC_API_KEY = "sk-ant-atlas4-standin";
process.env.ANTHROPIC_BASE_URL = `http://localhost:${MOCK}`;
process.env.ATLAS_ANSWER_MS = "4000";   // the budget, short for the suite (20 s in production)

const { ok, summary, login, api, q, closeDb, civilToday, atlasSaved } = require("./helpers");
const F = require("./atlas4/fixture");
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
  [/^Slowly, who/, [step({ kind: "question", target: "Slowly, who gave the most?", words: "Slowly, who gave the most?" })]],
  // The read Walk B saw: the call's words without her labels.
  [/^Log a call with Marlowe/, [step({ kind: "log_conversation", who: "Marlowe", how: "call", words: "she wants to bring her niece" })]],
];
const DEC_PLAN = y => ({ answerable: true, unsupported: null, entity: "people", where: [], measure: { fn: "count" }, list: true,
  related: [{ entity: "gifts", where: [{ field: "date", op: "between", value: [`${y - 1}-12-01`, `${y - 1}-12-31`] }] },
            { entity: "gifts", where: [{ field: "date", op: "gte", value: `${y}-01-01` }], none: true }] });
const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", d => { body += d; });
  req.on("end", async () => {
    const send = (code, x) => { if (!res.writableEnded) { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(x)); } };
    let x = {}; try { x = JSON.parse(body); } catch { /* empty */ }
    const name = x.tools && x.tools[0] && x.tools[0].name;
    const user = (x.messages || []).map(m => (typeof m.content === "string" ? m.content : (m.content || []).map(c => c.text || "").join("\n"))).join("\n");
    if (/Slowly/.test(user) && name !== "atlas_read") await new Promise(r => setTimeout(r, 9000));   // the 60 s path, shortened
    let input = null;
    if (name === "atlas_read") {
      const said = (/What she said: (.*)$/m.exec(user) || [])[1] || "";
      const hit = READS.find(([re]) => re.test(said));
      input = { steps: hit ? hit[1] : [] };
    } else if (name === "query_plan" && /December/.test(user)) input = DEC_PLAN(Number(civilToday().slice(0, 4)));
    else if (name === "call_script") input = { opening: "Hi Marlowe, this is (your name), (your title), from Kestrel Point Arts.", thank_for: "Thank you for your $150 gift last December.",
      ask: "Would you like to come to the spring showcase?", questions: ["What drew you to youth arts?", "Is weekday email still best?"], close: "Thank you again; I'll send the invitation." };
    else if (name === "brief") {
      const conv = (/^(conversation:[\w-]+) /m.exec(user) || [])[1];
      const note = (/^(note:[\w-]+):/m.exec(user) || [])[1];
      const person = (/^(person:[\w-]+) /m.exec(user) || [])[1];
      input = { headline: "A supporter of the youth arts programs", sections: [
        { key: "conversations", sentences: [{ text: "Henderson noted:", cites: [conv || person] }] },
        { key: "notes", sentences: [{ text: "The profile note reads:", cites: [note || person] },
          { text: "They said \"\" about the gala.", cites: [person] }] }] };
    }
    if (!input) return send(500, { type: "error", error: { type: "api_error", message: "no stand-in for " + name } });
    send(200, { id: "msg_standin", type: "message", role: "assistant", model: x.model, stop_reason: "tool_use",
      usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "tool_use", id: "tu_1", name, input }] });
  });
});

(async () => {
  console.log("atlas4-brief (ATLAS-4)");
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
  // The checker reads lines the way a person does; on main it is copied in to read main's brief.
  const BC = require(path.join(ROOT, "server/donors/briefComplete.js"));

  // ── §1 BRIEF ME IS COMPLETE ──────────────────────────────────────────────
  console.log("\n§1 Brief me says every sentence to the end");
  const b1 = await api("POST", "/donors/d_a4_marlowe/brief", tok, {});
  const lines = BC.briefLines(b1.body);
  const problems = BC.briefProblems(lines);
  ok("§1 the brief was written", b1.status === 200 && lines.length >= 2, b1.body);
  ok("§1 no line ends on a colon and no quote is empty", problems.length === 0, { problems, lines });
  ok("§1 the About note is quoted in full", lines.some(l => l.includes(F.ABOUT)), lines);
  ok("§1 \"Henderson noted:\" carries the conversation, whole", lines.some(l => /^Henderson noted: “Called about the spring showcase; she wants to bring her niece and asked whether the mural program needs volunteers\.”$/.test(l)), lines);
  ok("§1 a sentence quoting nothing the record holds is left out, and said", (b1.body.dropped || []).some(d => /gala/.test(d.text)) && /left out/.test(b1.body.droppedSentence || ""), b1.body.dropped);
  // The first words, in the stream, carry the About note whole too.
  const st = await fetch(`${process.env.BASE}/donors/d_a4_marlowe/brief?stream=1&fresh=1`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` }, body: "{}" });
  const streamed = (await st.text()).trim().split("\n").map(l => JSON.parse(l));
  const opening = (streamed.find(x => x.type === "start") || {}).opening || [];
  const sb = (streamed.find(x => x.type === "brief") || {}).brief;
  ok("§1 the streamed brief: first words quote the About note whole, and every line is complete",
    opening.some(l => l.endsWith(F.ABOUT)) && !!sb && BC.briefProblems(BC.briefLines(sb, opening)).length === 0, { opening, sb });
  const cs = await api("POST", "/donors/d_a4_marlowe/call-script", tok, {});
  const opening1 = cs.body && cs.body.script && cs.body.script.opening;
  ok("§1 the call script has her name and title, not \"(your name)\"", cs.status === 200 && /Rowan Pike, Development Director, from Kestrel Point Arts/.test(opening1 || "")
    && !/your name|your title/i.test(JSON.stringify(cs.body.script)), cs.body);

  // ── §2 ATLAS ANSWERS IN GOOD TIME ────────────────────────────────────────
  console.log("\n§2 Atlas answers in good time");
  let t0 = performance.now();
  const r3 = await atlas({ text: "Who gave last December but not this year?" });
  const peopleMs = Math.round(performance.now() - t0);
  t0 = performance.now();
  const rp = await atlas({ text: "Tell me about Marlowe" });
  const personMs = Math.round(performance.now() - t0);
  console.log(`    people answer ${peopleMs} ms · person answer ${personMs} ms`);
  ok("§2 the people and person answers come back well inside 15 s", peopleMs < 15000 && personMs < 15000 && lineOf(rp).answer && lineOf(rp).answer.type === "person", { peopleMs, personMs });
  t0 = performance.now();
  const rs = await atlas({ text: "Slowly, who gave the most?" });
  const slowMs = Math.round(performance.now() - t0);
  ok("§2 a question past its budget answers at the budget with what it has and where it will finish", slowMs < 8000 && /^I stopped after 4 seconds/.test(lineOf(rs).line || "") && lineOf(rs).link && lineOf(rs).link.tab === "ask",
    { slowMs, line: lineOf(rs) });
  const ts = fs.readFileSync(path.join(ROOT, "client/src/components/TellSteward.jsx"), "utf8");
  ok("§2 the dialog says \"Still working: <step>\" past 15 s", /const SLOW_MS = 15000;/.test(ts) && /Still working: \$\{l\}/.test(ts), null);

  // ── §3 A LIST SHOWS THE MATCHED AMOUNT ───────────────────────────────────
  console.log("\n§3 lists show the matched amount");
  const a3 = lineOf(r3).answer || {};
  const ster = (a3.people || []).find(p => p.donorId === "d_a4_sterling") || {};
  const y = Number(civilToday().slice(0, 4));
  ok("§3 Sterling: what he gave last December, not his lifetime", ster.amount === `$900 in Dec ${y - 1}`, a3.people);
  ok("§3 lifetime is there, second", ster.lifetime === "$2,144 in all" && /^\$900 in Dec \d{4}; \$2,144 in all$/.test(ster.reason || ""), ster);

  // ── §4 ATLAS KEEPS HER WORDS ─────────────────────────────────────────────
  console.log("\n§4 a logged call keeps her words");
  const said = "Log a call with Marlowe. Notes: she wants to bring her niece. Next step: send the showcase invitation.";
  const r4 = await atlas({ text: said });
  const [n4] = await q(`SELECT note, created_by FROM interactions WHERE org_id=$1 AND donor_id='d_a4_marlowe' AND type='call' ORDER BY created_at DESC LIMIT 1`, [F.ORG]);
  ok("§4 the note is her words, labels included", !!n4 && n4.note.includes(said), { n4, lines: r4.body.request && r4.body.request.lines });
  ok("§4 and the labelled lines were not read as requests of their own", !((r4.body.request && r4.body.request.lines) || []).some(l => l.kind === "cant"), r4.body.request && r4.body.request.lines);

  // ── §5 THE MORE MENU ─────────────────────────────────────────────────────
  console.log("\n§5 the More menu");
  const ph = fs.readFileSync(path.join(ROOT, "client/src/components/profile/ProfileHeader.jsx"), "utf8");
  const ma = fs.readFileSync(path.join(ROOT, "client/src/components/profile/MoreActions.jsx"), "utf8");
  ok("§5 More offers Add to a journey, opening the rail's own picker", /\["Add to a journey",\(\)=>openJourneyPicker\(onNavigate\)/.test(ph) && /querySelector\("\[data-testid=dp-journey-pick\]"\)/.test(ma), null);
  const ex = await fetch(`${process.env.BASE}/donors/d_a4_sterling/export-data`, { headers: { Authorization: `Bearer ${tok}` } });
  const exText = await ex.text();
  let exData = {}; try { exData = JSON.parse(exText); } catch { /* not a file */ }
  ok("§5 Export produces a file: their record, gifts and notes", ex.status === 200 && /attachment/.test(ex.headers.get("content-disposition") || "")
    && exData.profile && exData.profile.id === "d_a4_sterling" && Array.isArray(exData.gifts) && exData.gifts.length === 2 && Array.isArray(exData.notesEmailsAndMeetingsLogged), { status: ex.status, head: exText.slice(0, 200) });
  await new Promise(r => setTimeout(r, 300));
  const audit = await q(`SELECT user_id, request_path FROM fin_audit_log WHERE org_id=$1 AND request_path LIKE '%/donors/d_a4_sterling/export-data%'`, [F.ORG]);
  ok("§5 and writes an audit row, with who", audit.length === 1 && audit[0].user_id === F.USER, audit);
  ok("§5 the menu says it downloaded, on screen", /data-testid="export-done"/.test(ma) && /\["Export this person's data",exportData,/.test(ph), null);

  // ── §6 COPY ──────────────────────────────────────────────────────────────
  console.log("\n§6 the words that read wrong");
  const GS = await import(path.join(ROOT, "shared/giftSentence.js"));
  const ET = await import(path.join(ROOT, "shared/emailTemplates.js"));
  const withClause = ET.emailTemplates({ orgName: "Kestrel Point Arts" }).filter(t => /given before/.test(JSON.stringify(t.html || t.body || t.blocks || "")));
  ok("§6 every appeal template with the clause loses it for a never-giver", withClause.length >= 1
    && typeof GS.withoutGivenBefore === "function"
    && withClause.every(t => { const b = String(t.html || t.body || ""); return !/given before/.test(GS.withoutMissingGift(b, { hasGift: false })) && !/given before/.test(GS.withoutGivenBefore(b, { hasGift: false })); }), withClause.map(t => t.key || t.name));
  const appeal = withClause[0] && String(withClause[0].html || withClause[0].body || "");
  await q(`INSERT INTO sequence_steps (id,sequence_id,step_order,delay_days,subject,body) VALUES ('ss_a4_1','seq_a4_1',1,0,'Will you go first?',$1)`, [appeal || "x"]);
  await q(`INSERT INTO sequence_sends (id,org_id,sequence_id,donor_id,step_order,status,sent_at) VALUES ('sq_a4_1',$1,'seq_a4_1','d_a4_wren',1,'sent',NOW())`, [F.ORG]);
  const as = await api("GET", "/sequences/seq_a4_1/steps/1/as-sent", tok);
  ok("§6 a never-giver's copy has no \"given before\"", as.status === 200 && as.body.example && as.body.example.donorId === "d_a4_wren"
    && !/given before/.test(JSON.stringify(as.body.example)) && /asking friends of Kestrel Point Arts to join us/.test(JSON.stringify(as.body.example)), as.body);
  const h6 = fs.readFileSync(path.join(ROOT, "server/boot/helpers-6.js"), "utf8");
  ok("§6 and the send writes the same (sendStaffWrittenEmail)", /withoutGivenBefore\(bodyTpl, \{ hasGift, orgName: values\.org_name \}\)/.test(h6), null);
  const mt = await api("GET", "/mail-types", tok);
  const st6 = await api("GET", "/mail-types/status", tok);
  ok("§6 the email-on line is hidden while every switch is off", mt.status === 200 && mt.body.mailOn === true && mt.body.onCount === 0 && mt.body.mailSentence === null && st6.body.mailSentence === null, { mt: mt.body.mailSentence, st: st6.body.mailSentence });
  await q(`INSERT INTO org_mail_types (org_id, type_key, is_on, audience, set_at, set_by_name, created_by, created_by_name) VALUES ($1,'gift_receipt',true,'everyone',NOW(),'Rowan Pike','system:test','test')
           ON CONFLICT DO NOTHING`, [F.ORG]).catch(() => {});
  const mt2 = await api("GET", "/mail-types", tok);
  ok("§6 with one on, it says who turned email on and when", mt2.body.onCount === 1 && /^Steward support turned email on for you on [A-Z][a-z]{2} \d+, \d{4}\.$/.test(mt2.body.mailSentence || ""), mt2.body);
  const SE = await import(path.join(ROOT, "client/src/lib/sequencesEmpty.js")).catch(() => ({ sequencesEmptyLine: () => "No sequences yet." }));
  const comm = fs.readFileSync(path.join(ROOT, "client/src/components/Communications.jsx"), "utf8");
  const earlier = await api("GET", "/sequences", tok);
  ok("§6 the Sequences empty state: none at all says \"No sequences yet.\"; with Earlier ones, it points at them by count (SENDS-1: never \"No active sequences\" above Active ones)",
    /\{sequencesEmptyLine\(list, earlier\)\}/.test(comm) && SE.sequencesEmptyLine([], []) === "No sequences yet." && Array.isArray(earlier.body) && earlier.body.length === 2
    && SE.sequencesEmptyLine([], earlier.body) === "None made here yet. Your 2 earlier sequences are below." && SE.sequencesEmptyLine([{ id: "x" }], earlier.body) === null, earlier.body);

  ok("§7 nothing was sent to anyone", MAIL.length === 0, MAIL);
  mock.close(); sink.close();
  await F.reset(q);
  await closeDb();
  summary();
  process.exit(process.exitCode || 0);
})().catch(async e => { console.error("SUITE ERROR:", e); mock.close(); sink.close(); await F.reset(q).catch(() => {}); await closeDb().catch(() => {}); process.exit(1); });
