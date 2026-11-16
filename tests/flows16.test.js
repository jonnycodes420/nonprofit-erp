// tests/flows16.test.js — FLOWS-16. NINE MEETINGS, ATLAS'S SAVES AND QUESTIONS, SKIPPED ROWS, NO RAW CODES.
//
// One made-up org per run (no real name anywhere), one section per item:
//   §1  cancelling or deleting one thing never touches another meeting: a meeting
//       cancelled, an event deleted, a person erased, a timeline line deleted; every
//       other meeting keeps its day, its people and its place on the calendar
//   §3  a follow-up asked for from a neutral page attaches to the person the
//       conversation named; with nobody to attach it to, Atlas asks; a Save that
//       wrote nothing never says "Saved"
//   §4  a dated question about an ambiguous name keeps its date after "Which X?";
//       a question nobody answered for 7 days closes itself with a line
//   §5  every skipped journey row says why and when, and which entry it was
//   §6  a publish with nothing to publish answers with a sentence; the client
//       never puts a bare code on a banner; previews say they are a sample
//
// HOW IT GOES RED (each planted by hand and run, see the PR):
//   §1 SM.cancel deleting every meeting in the org (`WHERE org_id=?` alone)
//   §3 main's code: "him" on Reports has no person, the save says "Saved 0 things."
//   §4 main's /atlas/:id/answer rebuilding steps without `period`
//   §5 main's DISTINCT rows with the raw reason
//   §6 main's apiFetch (`err.message || err.error`)
"use strict";
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, api, q, login, closeDb, civilPlusDays, mailTypesOn } = require("./helpers");

const ROOT = path.join(__dirname, "..");
const PASSWORD = "loadtest1234";
// The app's query helpers take `?`; the suite's q takes $n.
const qq = (sql, params = []) => { let i = 0; return q(sql.replace(/\?/g, () => `$${++i}`), params); };
const runq = async (sql, params) => { const r = await qq(sql, params); return { changes: r.length }; };

(async () => {
  console.log("flows16 (FLOWS-16)");
  const run = require("crypto").randomBytes(4).toString("hex");
  const ORG = `org_flows16_${run}`, EMAIL = `owner-${run}@flows16.local`, ME = `u_flows16_${run}`;
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,emails_enabled,onboarded_at)
           VALUES ($1,'Flows Sixteen Tidewater Choir',$1,1,'active','team','America/New_York',true,NOW())`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Hester Quayle','admin')`, [ME, ORG, EMAIL, bcrypt.hashSync(PASSWORD, 4)]);
  await mailTypesOn(ORG).catch(() => {});
  const tok = await login(EMAIL, PASSWORD);
  const ids = {};
  const P = async (key, name, extra = {}) => {
    const r = await api("POST", "/donors", tok, { name, email: `${key}-${run}@flows16.invalid`, ...extra });
    if (!r.body || !r.body.id) throw new Error(`fixture ${name}: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
    return (ids[key] = r.body.id);
  };
  const gift = (id, amount, date) => api("POST", `/donors/${id}/gifts`, tok, { amount, date, payment_method: "check" });

  // ── §1 ONE THING CANCELLED OR DELETED NEVER TAKES ANOTHER MEETING ──────────
  console.log("\n§1 meetings stay put");
  for (const [k, n] of [["ansel", "Ansel Marrowby"], ["bea", "Beatrix Collingham"], ["cyr", "Cyril Wendover"], ["dor", "Dorothea Pask"], ["qa", "Quill Tester"]]) await P(k, n);
  const at = (d, h) => new Date(`${civilPlusDays(d)}T${h}:00Z`).toISOString();
  const book = async (who, d, h, title) => {
    const r = await api("POST", `/donors/${ids[who]}/book-visit`, tok, { startsAt: at(d, h), endsAt: at(d, String(Number(h.slice(0, 2)) + 1).padStart(2, "0") + h.slice(2)), title });
    if (!r.body || !r.body.id) throw new Error(`book ${title}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    return r.body.id;
  };
  // Seven meetings across the next week, as the fleet's calendar had: the same day, the same person twice.
  const keep = [await book("ansel", 1, "14:00", "Coffee with Ansel"), await book("bea", 1, "16:00", "Tea with Beatrix"),
    await book("bea", 3, "15:00", "Studio visit with Beatrix"), await book("cyr", 2, "13:00", "Lunch with Cyril"), await book("dor", 4, "17:00", "Call with Dorothea")];
  const qaMeeting = await book("qa", 2, "18:00", "QA meeting test");
  const shared = await book("dor", 5, "14:00", "Board chat with Dorothea and Quill");
  await api("POST", `/calendar/events/${shared}/people`, tok, { donorId: ids.qa });
  const snap = async () => (await q(`SELECT id, starts_at::text AS s, person_ids, dismissed_at FROM calendar_events WHERE org_id=$1 ORDER BY id`, [ORG]));
  const before = new Map((await snap()).map(r => [r.id, r]));
  const intact = (label, extraGone = []) => async () => {
    const now = new Map((await snap()).map(r => [r.id, r]));
    const lost = keep.filter(id => !now.has(id) || now.get(id).dismissed_at || now.get(id).s !== before.get(id).s
      || JSON.stringify(now.get(id).person_ids) !== JSON.stringify(before.get(id).person_ids));
    ok(`§1 ${label}: the other ${keep.length} meetings keep their day, people and place on the calendar`, lost.length === 0 && extraGone.every(id => !now.has(id)), { lost, gone: extraGone.filter(id => now.has(id)) });
  };
  // A meeting cancelled (the Steward-kept path, as the demo org's is).
  const c1 = await api("POST", `/calendar/events/${qaMeeting}/cancel`, tok, {});
  ok("§1 the QA meeting cancels", c1.status === 200, c1.body);
  await intact("after one meeting is cancelled", [qaMeeting])();
  // An event with a guest from the meetings, deleted.
  const ev = await api("POST", "/events", tok, { name: "QA gala test", date: civilPlusDays(1), eventType: "gala", capacity: 3 });
  const eventId = ev.body && (ev.body.id || (ev.body.event && ev.body.event.id));
  const added = await api("POST", `/events/${eventId}/attendees`, tok, { donorIds: [ids.ansel, ids.bea] });
  for (const a of (added.body && added.body.ids) || []) await api("POST", `/removals/guest/${a}`, tok, {});   // as Area 4 did: the guests off, then the event
  const d1 = await api("DELETE", `/events/${eventId}`, tok);
  ok("§1 the test event deletes", d1.status === 200 || d1.status === 204, d1.body);
  await intact("after an event with their guests is deleted")();
  // A timeline line deleted.
  const ix = await api("POST", `/donors/${ids.ansel}/interactions`, tok, { type: "call", note: "QA call line", date: civilPlusDays(0) });
  const ixId = ix.body && (ix.body.id || (ix.body.interaction && ix.body.interaction.id));
  if (ixId) await api("DELETE", `/interactions/${ixId}`, tok);
  await intact("after a timeline line is deleted")();
  // The QA person erased: their own meeting goes, the shared one keeps Dorothea.
  const er = await api("POST", `/donors/${ids.qa}/erase`, tok, { confirm: "ERASE", confirmName: "Quill Tester", reason: "QA" });
  ok("§1 the QA person erases", er.status === 200, er.body);
  const [sh] = await q(`SELECT person_ids FROM calendar_events WHERE id=$1`, [shared]);
  ok("§1 the meeting they shared stays, with Dorothea on it", !!sh && JSON.stringify(sh.person_ids) === JSON.stringify([ids.dor]), sh);
  await intact("after a person on one meeting is erased")();
  const items = (await api("GET", `/calendar/items?from=${civilPlusDays(0)}&to=${civilPlusDays(7)}&types=meeting`, tok)).body || {};
  const shown = (items.items || []).filter(i => i.type === "meeting").map(i => i.id.replace(/^meeting:/, ""));
  ok("§1 the Calendar still lists every one of them", keep.every(id => shown.includes(id)) && shown.includes(shared), { shown, keep });

  // ── §3 A FOLLOW-UP FROM A NEUTRAL PAGE ────────────────────────────────────
  console.log("\n§3 Atlas's follow-ups");
  await P("lin", "Linwood Ferrars"); await gift(ids.lin, 500, civilPlusDays(-30));
  const asked = await api("POST", "/atlas", tok, { text: "How much did Linwood Ferrars give?" });
  const r1 = asked.body && asked.body.request;
  ok("§3 the question about Linwood is answered", !!r1 && /\$500/.test(JSON.stringify(r1.lines || [])), r1 && r1.lines);
  const fu = await api("POST", "/atlas", tok, { text: "Remind me to follow up with him next Tuesday", followsId: r1 && r1.id });   // no donorId: the Reports page
  const p3 = fu.body && fu.body.request && fu.body.request.proposal;
  const item = p3 && (p3.items || []).find(i => i.kind === "follow_up");
  ok("§3 \"follow up with him\" on Reports, after asking about Linwood, is Linwood's", !!item && item.donorId === ids.lin, fu.body && fu.body.request);
  const s3 = p3 ? await api("POST", `/atlas/${fu.body.request.id}/save`, tok, { proposalId: p3.id }) : { body: {} };
  const [task] = await q(`SELECT donor_id FROM tasks WHERE org_id=$1 AND donor_id=$2 ORDER BY created_at DESC LIMIT 1`, [ORG, ids.lin]);
  ok("§3 Save writes the follow-up on his record", !!task, s3.body);
  const sp = s3.body && s3.body.request && s3.body.request.proposal;
  ok("§3 and says what it saved: one thing", !!sp && sp.savedCount === 1 && JSON.stringify(s3.body.request.lines).includes("Saved one thing."), sp);
  const byName = await api("POST", "/atlas", tok, { text: "Remind me to follow up with Linwood Ferrars next Tuesday" });
  const n3 = byName.body && byName.body.request && byName.body.request.proposal;
  ok("§3 his name in the words is enough, on any page", !!n3 && n3.items.some(i => i.kind === "follow_up" && i.donorId === ids.lin), byName.body && byName.body.request);
  const nobody = await api("POST", "/atlas", tok, { text: "Remind me to follow up with him next Tuesday" });
  const nb = nobody.body && nobody.body.request;
  ok("§3 with nobody talked about, Atlas asks who, and offers no Save", !!nb && !nb.proposal && /Who is this follow-up for\?/.test(JSON.stringify(nb.lines)), nb);
  // A proposal whose person is gone by the time she presses Save writes nothing, and says so.
  await P("gone", "Wilmot Gorringe");
  const g3 = await api("POST", "/atlas", tok, { text: "Remind me to follow up with Wilmot Gorringe next Tuesday" });
  const gp = g3.body && g3.body.request && g3.body.request.proposal;
  await q(`UPDATE donors SET deleted_at=NOW() WHERE id=$1`, [ids.gone]);
  const gs = gp ? await api("POST", `/atlas/${g3.body.request.id}/save`, tok, { proposalId: gp.id }) : { body: {} };
  const said = JSON.stringify((gs.body && gs.body.request) || {});
  ok("§3 a Save that wrote nothing never says \"Saved\"", !!gp && gs.body.request.proposal.savedCount === 0 && /Nothing was saved\./.test(said) && !/Saved 0 things/.test(said), said.slice(0, 500));
  const PC = await import(path.join(ROOT, "client/src/components/atlas/ProposalCard.jsx")).catch(() => null);
  if (PC && PC.savedHead) ok("§3 the card's header for 0 saved is \"Nothing was saved.\"", PC.savedHead(0) === "Nothing was saved." && PC.savedHead(1) === "Saved one thing.", [PC.savedHead(0), PC.savedHead(1)]);

  // ── §4 "WHICH ONE?" RESUMES THE QUESTION, DATE AND ALL ─────────────────────
  console.log("\n§4 a dated question about an ambiguous name");
  await P("pru1", "Prudence Galbraith"); await gift(ids.pru1, 100, "2025-12-02");
  await P("pru2", "Prudence Galbraith", { email: `pru2-${run}@flows16.invalid` });
  for (const [a, d] of [[2000, "2025-12-05"], [885, "2025-12-19"], [3000, "2025-06-01"], [2355, "2026-03-10"]]) await gift(ids.pru2, a, d);
  const w = await api("POST", "/atlas", tok, { text: "How much did Prudence Galbraith give in December 2025?" });
  const wq = ((w.body && w.body.request && w.body.request.questions) || []).find(x => /^Which Prudence Galbraith\?$/.test(x.sentence));
  ok("§4 the ambiguous name asks \"Which Prudence Galbraith?\"", !!wq, w.body);
  if (wq) {
    const a = await api("POST", `/atlas/${w.body.request.id}/answer`, tok, { answers: { [wq.id]: ids.pru2 } });
    const s = JSON.stringify((a.body && a.body.request && a.body.request.lines) || []);
    ok("§4 her choice answers the December 2025 question: $2,885 in Dec 2025, not \"has given $8,240 across 4 gifts\"",
      /gave \$2,885 in Dec 2025/.test(s) && !/has given \$8,240 across 4 gifts/.test(s), s.slice(0, 500));
  }
  // A question nobody answered for 8 days closes itself.
  const old = `vm_f16old_${run}`, fresh = `vm_f16new_${run}`;
  const read = JSON.stringify({ atlas: { steps: [], questions: [{ id: "p:walter", sentence: "Which Walter?" }] } });
  await q(`INSERT INTO voice_memos (id,org_id,text,source,status,ai,donor_ids,read,cards,run_ids,created_by,created_by_name,created_at)
           VALUES ($1,$2,'How much has Walter given','atlas','needs_answers','off','[]',$3,'[]','[]',$4,'Hester Quayle',NOW() - interval '8 days'),
                  ($5,$2,'How much has Walter given','atlas','needs_answers','off','[]',$3,'[]','[]',$4,'Hester Quayle',NOW() - interval '2 days')`, [old, ORG, read, ME, fresh]);
  const bell0 = (await api("GET", "/atlas/activity", tok)).body || {};
  ok("§4 the bell no longer lists a question 8 days old, and still lists one 2 days old",
    !(bell0.items || []).some(i => i.requestId === old) && (bell0.items || []).some(i => i.requestId === fresh), (bell0.items || []).map(i => i.requestId));
  const { newId } = require("../server/shared/newId");
  const R = require("../server/atlas/resume");
  await R.expireQuestions({ query: qq, run: runq, newId });
  const [o4] = await q(`SELECT status FROM voice_memos WHERE id=$1`, [old]);
  const [f4] = await q(`SELECT status FROM voice_memos WHERE id=$1`, [fresh]);
  const [line4] = await q(`SELECT line, created_by FROM atlas_actions WHERE request_id=$1`, [old]);
  ok("§4 the daily job closes it, with a line that says so and an actor", o4.status === "expired" && f4.status === "needs_answers" && !!line4
    && /Nobody answered this for 7 days, so I closed it/.test(line4.line) && /^system:/.test(line4.created_by), { o4, f4, line4 });

  // ── §5 EVERY SKIPPED ROW SAYS WHY ─────────────────────────────────────────
  console.log("\n§5 skipped journey rows");
  const tpl = `ct_f16_${run}`;
  await q(`INSERT INTO cultivation_templates (id,org_id,name,steps,created_by,created_by_name) VALUES ($1,$2,'Birthday card','[]',$3,'Hester Quayle')`, [tpl, ORG, ME]).catch(e => console.log("tpl", e.message));
  const plan = async (key, entered) => { const id = `cp_f16_${key}_${run}`;
    await q(`INSERT INTO cultivation_plans (id,org_id,donor_id,template_id,template_name,applied_on,status,created_by,created_by_name) VALUES ($1,$2,$3,$4,'Birthday card',$5,'abandoned',$6,'Hester Quayle')`,
      [id, ORG, ids[key.replace(/\d$/, "")], tpl, entered, ME]); return id; };
  const step = (pid, seq, label, reason, by, byName, closed) => q(`INSERT INTO cultivation_plan_steps (id,org_id,plan_id,seq,step_type,label,due_date,status,closed_at,closed_by,closed_by_name,skip_reason)
      VALUES ($1,$2,$3,$4,'task',$5,$6,'skipped',$7,$8,$9,$10)`, [`cps_f16_${pid}_${seq}`, ORG, pid, seq, label, civilPlusDays(-3), closed, by, byName, reason]);
  const pa = await plan("ansel1", "2026-10-02"), pb = await plan("ansel2", "2026-11-01"), pc = await plan("bea", "2026-10-20");
  await step(pa, 1, "Birthday card", null, null, null, "2026-11-10T15:00:00Z");                       // before reasons were kept
  await step(pb, 1, "Birthday card", "Skipped, journey stopped", ME, "Hester Quayle", "2026-11-13T15:00:00Z");
  await step(pc, 0, "Send the card", "No address on file", "system:journey", "Steward (journey)", "2026-11-12T15:00:00Z");
  const fig = ((await api("GET", `/journeys/${tpl}/stats`, tok)).body || {}).figures || [];
  const sk = fig.find(f => f.key === "skipped") || {};
  const rows = (await api("GET", `/journeys/${tpl}/rows?rows=skipped`, tok)).body || {};
  const ds = rows.donors || [];
  ok("§5 the figure counts its own rows (3 steps)", sk.value === 3 && rows.count === 3, { value: sk.value, count: rows.count });
  ok("§5 every row says why and when", ds.length === 3 && ds.every(d => d.reason && d.reason.length > 8), ds);
  ok("§5 \"Stopped by Hester, Nov 13\"", ds.some(d => d.reason === "Stopped by Hester, Nov 13"), ds.map(d => d.reason));
  ok("§5 \"Skipped: no address on file, Nov 12\"", ds.some(d => d.reason === "Skipped: no address on file, Nov 12"), ds.map(d => d.reason));
  ok("§5 a skip with no reason kept says so", ds.some(d => d.reason === "Reason not recorded (before Nov 16)"), ds.map(d => d.reason));
  const ans = ds.filter(d => d.id === ids.ansel);
  ok("§5 the same person twice: each row names its entry", ans.length === 2 && new Set(ans.map(d => d.entry)).size === 2 && ans.every(d => /^Entered (Oct 2|Nov 1) · step 2, Birthday card$/.test(d.entry)), ans);

  // ── §6 NO RAW CODE ON A BANNER, AND SAMPLES SAY SO ────────────────────────
  console.log("\n§6 sentences, never codes");
  const pub = await api("POST", "/org-form/page/publish", tok, {});
  ok("§6 Publish with nothing changed answers with a sentence", pub.status === 400 && /^Nothing to publish: this page has no changes since/.test((pub.body && pub.body.sentence) || ""), pub.body);
  const EC = await import(path.join(ROOT, "client/src/lib/errorCodes.js"));
  ok("§6 the banner reads the sentence, not the code", EC.bodySentence(pub.body) === pub.body.sentence, EC.bodySentence(pub.body));
  ok("§6 a bare code is never the banner's words", !EC.isCode(EC.bodySentence({ error: "nothing_to_publish"  }))
    && !EC.isCode(EC.bodySentence({ error: "some_new_code"  })) && EC.bodySentence({ error: "Donor not found"  }) === "Donor not found",
    [EC.bodySentence({ error: "nothing_to_publish"  }), EC.bodySentence({ error: "some_new_code"  })]);
  const fs = require("fs");
  const apiSrc = fs.readFileSync(path.join(ROOT, "client/src/api.js"), "utf8");
  ok("§6 apiFetch builds its error from the sentence (never err.message || err.error)", /bodySentence\(err\)/.test(apiSrc) && !/err\.message \|\| err\.error/.test(apiSrc), null);
  const brand = fs.readFileSync(path.join(ROOT, "client/src/components/settings/BrandingManager.jsx"), "utf8");
  ok("§6 the thank-you preview says it is addressed to a sample donor", /Preview, addressed to a sample donor/.test(brand) && !/Dear Jordan/.test(brand), null);
  const prev = await fetch(`${process.env.BASE || "http://localhost:5601"}/receipts/preview`, { headers: { Authorization: "Bearer " + tok } });
  ok("§6 the receipt preview renders", prev.status === 200, prev.status);

  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
