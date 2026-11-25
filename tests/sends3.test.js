// tests/sends3.test.js · SENDS-3. The build's one new suite: it guards email (and donor data on the way).
// Nothing happens that she didn't ask for.
//
// §1 Pledge reminders use the one overdue rule (pledgeSchedule.overdueOf). A pledge stamped "56 days
//    overdue" whose installments are paid or not yet due gets no reminder; a pledge that really is
//    overdue still gets one; the dry-run script lists the stale stamp and not the real one.
// §2 "Send me a test" goes in an org whose donor and staff switches are both off (it is her own
//    address, on her press), and a refusal is a 409 with words, never a bare 502.
// §3 Atlas's Open list makes no group: the People list reads the answer's saved ids; only Save as
//    group makes one, and the same one every time.
// §4 Import undo's "Remove them too" asks about live receipts once for the batch (how many people,
//    how many receipts), moves nobody until she says yes, and voids them on yes.
// §5 The Journeys rail's Mark done is a Recent changes line with Undo; Undo puts the step, the
//    journey and the next step back, and the next step's timeline line and draft go with it.
// §6 An email that points at a WebP photo goes with its JPEG: rendered in send mode (the test
//    send), every image URL is one the server answers as image/jpeg.
//
// PROVEN ABLE TO FAIL (each planted, each red, then put back):
//   · helpers-7.js step 2 sending every picked row again (no overdueOf) → §1 "no reminder" red.
//   · mailPolicy STAFF_ON_REQUEST check removed from the donor-switch line → §2 "goes" red (409).
//   · groups.js `fromAtlas` removed → §3 "exactly the answer's people" red.
//   · records.js `!voidReceipts` back to `!voidReceipts && !req.body.importId` → §4 "asks" red.
//   · planStepUndo.beginDone not called → §5 "one Recent changes line" red.
//   · emailCompose.render without emailSafeHtml → §6 "every image is a JPEG" red.
"use strict";
const http = require("http");
const path = require("path");
const { execFileSync } = require("child_process");
const { ok, summary, api, q, closeDb, BASE, SINK_PORT, civilPlusDays, mailTypesOn } = require("./helpers");

const PASSWORD = "loadtest1234";
const settle = (ms = 700) => new Promise(r => setTimeout(r, ms));
const SYS = "'system:test','Test'";

function startSink(port = SINK_PORT) {
  const state = { captured: [] };
  const srv = http.createServer((req, res) => {
    let b = ""; req.on("data", c => b += c);
    req.on("end", () => {
      let parsed = {}; try { parsed = JSON.parse(b); } catch (_) { /* not json */ }
      state.captured.push(parsed);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ id: "sunk_" + state.captured.length }));
    });
  });
  return new Promise(resolve => {
    srv.on("error", e => { console.error("sink bind failed:", e.message); resolve(null); });
    srv.listen(port, () => resolve({ srv, state }));
  });
}

(async () => {
  console.log("sends3 (SENDS-3)");
  const sink = await startSink();
  if (!sink) { console.error(`could not bind :${SINK_PORT}`); process.exit(1); }
  const { state } = sink;
  const to = addr => state.captured.filter(m => (Array.isArray(m.to) ? m.to : [m.to]).map(x => String(x).toLowerCase()).includes(addr.toLowerCase()));
  const RUN = require("crypto").randomBytes(4).toString("hex");
  const OWNER = `owner-${RUN}@sends3.local`;

  const reg = await fetch(BASE + "/auth/register-org", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgName: `Sends Three Quillmoor Trust ${RUN}`, userName: "Philippa Dunmore", email: OWNER, password: PASSWORD }) });
  const rb = await reg.json();
  if (reg.status !== 201 || !rb.token) throw new Error(`register-org: ${reg.status} ${JSON.stringify(rb).slice(0, 200)}`);
  const tok = rb.token, ORG = rb.org.id;
  await q(`UPDATE orgs SET emails_enabled=true, staff_mail_enabled=true, onboarded_at=NOW(), onboarded_via='test', onboarding_complete=1 WHERE id=$1`, [ORG]);
  await q(`UPDATE users SET welcomed_at=NOW() WHERE org_id=$1`, [ORG]);
  await new Promise(r => setTimeout(r, 5100));   // the 5 s mail-gate cache the signup filled
  await api("POST", "/onboarding/complete", tok, {});
  await mailTypesOn(ORG, "chosen", ["pledge_reminder"]);

  // ── §1 PLEDGE REMINDERS ASK overdueOf ────────────────────────────────────
  console.log("\n§1 a pledge stamped overdue with nothing past due gets no reminder");
  const today = civilPlusDays(0);
  const people = [["d_s3_paid", "Ottoline Brack", `ottoline-${RUN}@sends3.local`], ["d_s3_late", "Caspian Moorhen", `caspian-${RUN}@sends3.local`]];
  for (const [id, name, email] of people) {
    await q(`INSERT INTO donors (id,org_id,name,email,created_by,created_by_name) VALUES ($1,$2,$3,$4,${SYS})`, [id + RUN, ORG, name, email]);
    const sw = await api("POST", `/donors/${id + RUN}/auto-email`, tok, { on: true, confirm: true });
    ok(`fixture: automatic email on for ${name}`, sw.status === 200, sw.body);
  }
  const PAID = "d_s3_paid" + RUN, LATE = "d_s3_late" + RUN;
  // Ottoline: a $600 pledge "due" 56 days ago, in two installments: $300 then (paid, a linked gift), $300 in 30 days.
  // The old job stamped it from the pledge's own due date; the stamp is 56 days old and the next reminder is due.
  await q(`INSERT INTO pledges (id,org_id,donor_id,amount,due_date,status,first_overdue_at,next_reminder_at,reminder_step,created_by,created_by_name)
           VALUES ($1,$2,$3,600,$4,'open',NOW() - INTERVAL '56 days',NOW() - INTERVAL '1 hour',1,${SYS})`, ["pl_s3_paid" + RUN, ORG, PAID, civilPlusDays(-56)]);
  await q(`INSERT INTO pledge_installments (id,org_id,pledge_id,seq,due_date,amount) VALUES ($1,$2,$3,1,$4,300),($5,$2,$3,2,$6,300)`,
    ["pi_s3_1" + RUN, ORG, "pl_s3_paid" + RUN, civilPlusDays(-56), "pi_s3_2" + RUN, civilPlusDays(30)]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,pledge_id,created_by,created_by_name) VALUES ($1,$2,$3,300,$4,$5,${SYS})`,
    ["g_s3_paid" + RUN, ORG, PAID, civilPlusDays(-58), "pl_s3_paid" + RUN]);
  // Caspian: $300 due 10 days ago, nothing paid, never stamped: really overdue.
  await q(`INSERT INTO pledges (id,org_id,donor_id,amount,due_date,status,created_by,created_by_name) VALUES ($1,$2,$3,300,$4,'open',${SYS})`,
    ["pl_s3_late" + RUN, ORG, LATE, civilPlusDays(-10)]);
  const pr = await api("POST", "/pledges/process-reminders", tok, {});
  await settle(900);
  ok("§1 the job ran for this org and picked one pledge (Caspian's), not the stamped one", pr.status === 200 && pr.body.picked === 1, pr.body);
  ok("§1 the stamped \"56 days overdue\" pledge with nothing past due sends nothing", to(people[0][2]).length === 0, to(people[0][2]).map(m => m.subject));
  ok("§1 the pledge that is really overdue is still reminded", to(people[1][2]).length === 1, state.captured.map(m => [m.to, m.subject]));
  const [paidRow] = await q(`SELECT reminder_step, first_overdue_at IS NOT NULL AS stamped FROM pledges WHERE id=$1`, ["pl_s3_paid" + RUN]);
  ok("§1 nothing about the stamped pledge moved (the job writes nothing; the script clears stamps)", paidRow.reminder_step === 1 && paidRow.stamped, paidRow);
  const dry = execFileSync(process.execPath, [path.join(__dirname, "..", "scripts/ops/sends3-pledge-stamps.js"), "--org", ORG], { env: process.env, encoding: "utf8" });
  ok("§1 the dry run lists the stale stamp, and only it", /: 1 in /.test(dry) && /Ottoline Brack/.test(dry) && !/Caspian/.test(dry) && /Dry run: nothing was written/.test(dry), dry);

  // ── §2 SEND ME A TEST ────────────────────────────────────────────────────
  console.log("\n§2 a test goes with both switches off, and a refusal says why");
  await q(`UPDATE orgs SET emails_enabled=false, staff_mail_enabled=false WHERE id=$1`, [ORG]);
  await settle(5100);   // the mail-gate cache
  const cmp = await api("POST", "/campaigns", tok, { name: "Winter letter", type: "email", subject: "Our winter letter", body: "<p>Dear {{first_name}}, thank you.</p>" });
  const CID = cmp.body && cmp.body.id;
  const before2 = to(OWNER).length;
  const t1 = await api("POST", `/campaigns/${CID}/test`, tok, {});
  await settle();
  ok("§2 with donor and staff mail off, her test to herself goes (was 502 send_failed)", t1.status === 200 && t1.body.sent === true && to(OWNER).length === before2 + 1, t1);
  const t2 = await api("POST", `/campaigns/${CID}/test`, tok, { to: OWNER.toUpperCase() });
  ok("§2 her own address in capitals goes too", t2.status === 200 && t2.body.sent === true, t2);
  await q(`UPDATE orgs SET is_demo_org=true WHERE id=$1`, [ORG]);
  await settle(5100);
  const t3 = await api("POST", `/campaigns/${CID}/test`, tok, {});
  ok("§2 a refusal is a 409 with the reason in words, never a 502", t3.status === 409 && /demonstration organization/i.test(t3.body.sentence || "") && t3.body.message === t3.body.sentence, t3);
  await q(`UPDATE orgs SET is_demo_org=false, emails_enabled=true, staff_mail_enabled=true WHERE id=$1`, [ORG]);
  await settle(5100);

  // ── §3 OPEN LIST MAKES NO GROUP ──────────────────────────────────────────
  console.log("\n§3 Atlas's Open list shows the people and makes nothing");
  const crowd = [];
  for (let i = 0; i < 3; i++) {
    const id = `d_s3_crowd${i}_${RUN}`;
    crowd.push(id);
    await q(`INSERT INTO donors (id,org_id,name,created_by,created_by_name) VALUES ($1,$2,$3,${SYS})`, [id, ORG, ["Hesper Calloway", "Ivo Penhallow", "Juno Ashgrove"][i]]);
  }
  await q(`INSERT INTO donors (id,org_id,name,created_by,created_by_name) VALUES ($1,$2,'Kit Outsider',${SYS})`, ["d_s3_out" + RUN, ORG]);
  const MEMO = "vm_s3_" + RUN, ACT = "aa_s3_" + RUN, QUESTION = "Who came to the spring supper?";
  await q(`INSERT INTO voice_memos (id,org_id,text,source,read,created_by,created_by_name) VALUES ($1,$2,$3,'atlas',$4::jsonb,${SYS})`,
    [MEMO, ORG, QUESTION, JSON.stringify({ answers: { [ACT]: { type: "list", question: QUESTION, ids: crowd } } })]);
  await q(`INSERT INTO atlas_actions (id,org_id,request_id,kind,state,line,actor_id,actor_name,created_by,created_by_name) VALUES ($1,$2,$3,'answer','done','3 people.','system:test','Test',${SYS})`, [ACT, ORG, MEMO]);
  const groupsBefore = (await q(`SELECT COUNT(*)::int AS n FROM audiences WHERE org_id=$1`, [ORG]))[0].n;
  const head = await api("GET", `/atlas/actions/${ACT}/list`, tok);
  const list = await api("GET", `/donors?limit=50&role=&fromAtlas=${ACT}`, tok);
  const ids = ((list.body && (list.body.donors || list.body.rows)) || []).map(d => d.id).sort();
  ok("§3 Open list's heading names the question and the count", head.status === 200 && head.body.question === QUESTION && head.body.count === 3 && head.body.group === null, head.body);
  ok("§3 the People list is exactly the answer's people", list.status === 200 && ids.join() === [...crowd].sort().join(), { status: list.status, ids });
  const groupsAfter = (await q(`SELECT COUNT(*)::int AS n FROM audiences WHERE org_id=$1`, [ORG]))[0].n;
  ok("§3 opening the list made no group", groupsAfter === groupsBefore, { groupsBefore, groupsAfter });
  const s1 = await api("POST", `/atlas/actions/${ACT}/group`, tok, {});
  const s2 = await api("POST", `/atlas/actions/${ACT}/group`, tok, {});
  const members = s1.body && s1.body.groupId ? (await q(`SELECT donor_id FROM group_members WHERE org_id=$1 AND group_id=$2 ORDER BY donor_id`, [ORG, s1.body.groupId])).map(r => r.donor_id) : [];
  ok("§3 Save as group makes one group of those people, and the same one on a second press",
    s1.status === 201 && s1.body.made === true && s2.body.groupId === s1.body.groupId && s2.body.made === false && members.join() === [...crowd].sort().join(), { s1: s1.body, s2: s2.body, members });

  // ── §4 IMPORT UNDO ASKS ABOUT RECEIPTS ───────────────────────────────────
  console.log("\n§4 \"Remove them too\" asks about live receipts, once for the batch");
  const R1 = "d_s3_rcpt" + RUN, R2 = "d_s3_norcpt" + RUN;
  await q(`INSERT INTO donors (id,org_id,name,created_by,created_by_name) VALUES ($1,$3,'Lark Fenwick',${SYS}),($2,$3,'Morrow Tansy',${SYS})`, [R1, R2, ORG]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,created_by,created_by_name) VALUES ($1,$2,$3,120,$4,${SYS}),($5,$2,$3,80,$4,${SYS})`,
    ["g_s3_r" + RUN, ORG, R1, civilPlusDays(-3), "g_s3_r2" + RUN]);
  await q(`INSERT INTO receipts (id,org_id,donor_id,gift_id,receipt_number,amount,deductible_amount,snapshot) VALUES
           ($1,$2,$3,$4,$5,120,120,'{}'::jsonb),($6,$2,$3,$8,$7,80,80,'{}'::jsonb)`, ["rc_s3a" + RUN, ORG, R1, "g_s3_r" + RUN, "S3-" + RUN + "-1", "rc_s3b" + RUN, "S3-" + RUN + "-2", "g_s3_r2" + RUN]);
  const bd = await api("POST", "/donors/bulk-delete", tok, { ids: [R1, R2], count: 2, importId: "imp_s3_" + RUN });
  const stillLive = (await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND id = ANY($2) AND deleted_at IS NULL`, [ORG, [R1, R2]]))[0].n;
  ok("§4 it asks (409 receipts_live) naming people and receipts, and moves nobody",
    bd.status === 409 && bd.body.error === "receipts_live" && bd.body.receipts === 2 && bd.body.people === 1
      && /^2 receipts were issued to 1 of these 2 people\. Void them/.test((bd.body.receiptQuestion || {}).question || "") && stillLive === 2, { bd: bd.body, stillLive });
  const yes = await api("POST", "/donors/bulk-delete", tok, { ids: [R1, R2], count: 2, importId: "imp_s3_" + RUN, voidReceipts: true });
  const voided = (await q(`SELECT COUNT(*)::int AS n FROM receipts WHERE org_id=$1 AND donor_id=$2 AND voided_at IS NOT NULL`, [ORG, R1]))[0].n;
  ok("§4 on her yes both move to the trash and both receipts are void", yes.status === 200 && yes.body.deleted === 2 && voided === 2, { body: yes.body, voided });

  // ── §5 THE RAIL'S MARK DONE HAS AN UNDO ──────────────────────────────────
  console.log("\n§5 Mark done on a journey step is one Recent changes line, and Undo puts it all back");
  const J = "d_s3_journey" + RUN;
  await q(`INSERT INTO donors (id,org_id,name,created_by,created_by_name) VALUES ($1,$2,'Nell Ravensworth',${SYS})`, [J, ORG]);
  const tpl = await api("POST", "/cultivation-templates", tok, { name: "Two-step welcome", steps: [{ type: "follow_up", label: "Call to welcome", offsetDays: 0 }, { type: "send", label: "Send the impact note", offsetDays: 3 }] });
  const plan = await api("POST", `/donors/${J}/plan`, tok, { templateId: tpl.body.id });
  const step1 = ((plan.body && plan.body.steps) || []).find(s => s.status === "open");
  const step2 = ((plan.body && plan.body.steps) || []).find(s => s.status === "pending");
  ok("fixture: the journey's first step is open", !!step1 && !!step2, plan.body);
  const rc0 = await api("GET", "/recent-changes", tok);
  const dn = await api("POST", `/plan-steps/${step1.id}/done`, tok, { note: "Spoke for ten minutes, delighted" });
  // the next step's draft, as journeyTemplateDraft writes one for a step that names a template
  await q(`INSERT INTO milestone_drafts (id,org_id,donor_id,milestone_key,subject,body,status,source,created_by,created_by_name)
           VALUES ($1,$2,$3,$4,'Our impact','Dear Nell,','pending_review','journey',${SYS})`, ["md_s3" + RUN, ORG, J, `journey-step:${step2.id}`]);
  const rc1 = await api("GET", "/recent-changes", tok);
  const fresh = (rc1.body.rows || []).filter(r => !(rc0.body.rows || []).some(x => x.id === r.id));
  const opened = ((dn.body.plan && dn.body.plan.steps) || []).find(s => s.id === step2.id);
  ok("§5 Mark done opened the next step and said `listed`", dn.status === 200 && opened && opened.status === "open" && dn.body.listed === true, dn.body);
  ok("§5 Recent changes has exactly one line for it, with Undo", fresh.length === 1 && fresh[0].sentence === "Marked done: Call to welcome for Nell Ravensworth." && /\/plan-steps\/.+\/reopen$/.test(fresh[0].undo.path), fresh);
  const lines = async () => (await q(`SELECT note FROM interactions WHERE org_id=$1 AND donor_id=$2 ORDER BY created_at`, [ORG, J])).map(r => r.note);
  const l1 = await lines();
  ok("fixture: the timeline has the done line and the next step's line", l1.some(n => /^Call to welcome: Spoke/.test(n)) && l1.some(n => /^Journey step: Send the impact note/.test(n)), l1);
  const undo = await api("POST", fresh[0].undo.path, tok, fresh[0].undo.body || {});
  const steps = ((undo.body && undo.body.plan && undo.body.plan.steps) || []);
  ok("§5 Undo: the step is open again and the next one is waiting again", undo.status === 200 && (steps.find(s => s.id === step1.id) || {}).status === "open"
    && (steps.find(s => s.id === step2.id) || {}).status === "pending", undo.body);
  const l2 = await lines();
  ok("§5 Undo took the next step's \"Journey step\" line and the done line off the timeline", !l2.some(n => /^Journey step: Send the impact note/.test(n)) && !l2.some(n => /^Call to welcome: Spoke/.test(n)) && l2.some(n => /^Journey step: Call to welcome/.test(n)), l2);
  const [draft] = await q(`SELECT status, archived_by FROM milestone_drafts WHERE id=$1`, ["md_s3" + RUN]);
  ok("§5 …and retired the next step's draft", draft.status === "archived" && draft.archived_by === "system:undo", draft);
  const [th] = await q(`SELECT COUNT(*)::int AS n FROM threads WHERE org_id=$1 AND donor_id=$2 AND closed_at IS NULL`, [ORG, J]);
  const rc2 = await api("GET", "/recent-changes", tok);
  ok("§5 one open next step, and the line has left Recent changes", th.n === 1 && !(rc2.body.rows || []).some(r => r.id === fresh[0].id), { open: th.n });
  const again = await api("POST", `/plan-steps/${step1.id}/reopen`, tok, {});
  ok("§5 a second Undo changes nothing and says why", again.status === 409, again.body);

  // ── §6 A WEBP IN AN EMAIL GOES AS ITS JPEG ───────────────────────────────
  console.log("\n§6 every image a sent email points at is a JPEG");
  const sharp = require("sharp");
  const webp = await sharp({ create: { width: 64, height: 40, channels: 3, background: { r: 13, g: 92, b: 58 } } }).webp().toBuffer();
  const AID = "pa_" + require("crypto").createHash("sha256").update("s3" + RUN).digest("hex").slice(0, 24);
  await q(`INSERT INTO portal_assets (id,org_id,kind,content_type,bytes,width,height,storage,data,is_public) VALUES ($1,$2,'campaign','image/webp',$3,64,40,'db',$4,true)`,
    [AID, ORG, webp.length, webp.toString("base64")]);
  const blocks = [{ type: "header" }, { type: "richtext", blocks: [{ type: "p", text: "Dear {{first_name}}, here is the garden." }] },
    { type: "image", image: `/portal-assets/${AID}`, alt: "The new garden beds" }, { type: "footer" }];
  const put6 = await api("PUT", `/campaigns/${CID}`, tok, { name: "Winter letter", subject: "Our winter letter", body: "<p>Dear {{first_name}}, thank you.</p>", segment: { mode: "all" }, status: "draft", emailBlocks: blocks });
  ok("fixture: the campaign carries the photo block", put6.status === 200, put6.body);
  const n6 = to(OWNER).length;
  const t6 = await api("POST", `/campaigns/${CID}/test`, tok, {});
  await settle();
  const mail = to(OWNER)[n6] || {};
  const srcs = [...String(mail.html || "").matchAll(/<img[^>]+src="([^"]+)"/g)].map(m => m[1].replace(/&amp;/g, "&"));
  const ours = srcs.filter(s => s.includes(AID));
  const types = [];
  for (const s of ours) {
    const r = await fetch(BASE + s.slice(s.indexOf("/portal-assets/")));
    const b = Buffer.from(await r.arrayBuffer());
    types.push({ s, type: r.headers.get("content-type"), jpegBytes: b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff });
  }
  ok("§6 the test (rendered in send mode) points at the photo's JPEG", t6.status === 200 && ours.length === 1 && /[?&]fmt=jpeg/.test(ours[0]), { status: t6.status, body: t6.body, srcs });
  ok("§6 every image the email references is a JPEG when fetched", types.length === 1 && types.every(t => t.type === "image/jpeg" && t.jpegBytes), types);
  const plain = await fetch(BASE + `/portal-assets/${AID}`);
  ok("§6 the stored photo is unchanged (the page still gets its WebP)", plain.headers.get("content-type") === "image/webp", plain.headers.get("content-type"));

  sink.srv.close();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch (_) { /* */ } process.exit(1); });
