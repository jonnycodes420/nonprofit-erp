// tests/fix37-import-thanks.test.js, FIX-37. AN IMPORT NEVER FLOODS THE
// THANK-YOU QUEUE, AND BIG FILES DON'T MAKE HER WAIT.
//
// Guards donor mail and donor data: LIVE-1 made a CSV's recent gifts draft
// thank-yous, which is right for a monthly file and wrong for a move from
// another system (those gifts were thanked there). Its test file made 9,644
// drafts in one go, and a file of recent gifts held the request for minutes.
//
// WHAT IS ASSERTED, with a first-gift journey switched on:
//   §1  a first import of 300 recent gifts: the preview defaults to "already
//       thanked", and with no answer the import drafts none and starts no
//       first-gift journey; its readout is "What your history shows" with no
//       "new donors" line; the run's history says what was answered
//   §2  the same file answered "No, draft them all" drafts 300 (and starts
//       the journey); answered "Only $250 or more" drafts exactly the gifts
//       of $250 or more
//   §3  a later import with a few recent gifts defaults to "draft them" and
//       its readout has the "new donors" line; the same count from a
//       Salesforce export defaults to "already thanked" and drafts none
//   §4  5,000 recent gifts: the request answers in under 3 seconds, progress
//       is shown while the work runs, and it finishes
//   §5  undo during the work stops it and removes everything it did
//
// HOW IT WOULD GO RED: on main the preview has no default and every recent
// gift drafts a thank-you (§1, §3), and the 5,000-gift request waits on every
// recordGift (§4). Drop `alreadyThanked` from recordGift and §1 drafts 300.

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, civilPlusDays, waitFor, importAutoSettle } = require("./helpers");
// This suite watches the background work run, so imports here do not wait for it.
importAutoSettle(false);

const ORG = "org_fix37thanks";
const ADMIN = "fix37-admin@example.org";
const DOMAIN = "fix37-thanks.org";

async function wipe() {
  const tables = (await q(`SELECT table_name FROM information_schema.columns
                            WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (let pass = 0; pass < 4; pass++) {
    for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false)) return;
  }
}

const runId = tag => `imp_fix37${tag}${Date.now().toString(36)}`;
// n people, one recent gift each (1 to 29 days ago); every other gift $300, the rest $100.
const file = (tag, n, perDonor = 1) => ({
  donors: Array.from({ length: n }, (_, i) => ({ name: `Person ${tag} ${i}`, email: `${tag}${i}@${DOMAIN}` })),
  gifts: Array.from({ length: n * perDonor }, (_, k) => ({ donorIndex: Math.floor(k / perDonor), amount: k % 2 ? 300 : 100,
    date: civilPlusDays(-(1 + (k % 29))), type: "cash", paymentMethod: "Check", externalId: `F37-${tag}-${k}` })),
});

(async () => {
  console.log("FIX-37: an import never floods the thank-you queue\n");
  await wipe();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
           VALUES ($1,'Cedar Row Youth','cedar-row-youth',1,'active','team')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_fix37',$1,$2,$3,'Sam Admin','admin')`,
    [ORG, ADMIN, bcrypt.hashSync("loadtest1234", 10)]);
  const tok = await login(ADMIN);
  const j = await api("POST", "/journeys", tok, { name: "Welcome, first gift", trigger: "first_gift", enabled: true,
    steps: [{ type: "thank", label: "Call to say thank you", offsetDays: 2 }] });
  ok("a first-gift journey is made and switched on", j.status === 201 && j.body?.enabled === true, j.body);

  const drafts = async run => Number((await q(
    `SELECT COUNT(*)::int AS n FROM thank_you_drafts t JOIN gifts g ON g.id = t.gift_id WHERE t.org_id=$1 AND g.import_id=$2`, [ORG, run]))[0].n);
  const plans = async run => Number((await q(
    `SELECT COUNT(*)::int AS n FROM cultivation_plans WHERE org_id=$1 AND started_import_id=$2`, [ORG, run]))[0].n);
  const giftsOf = async run => Number((await q(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1 AND import_id=$2`, [ORG, run]))[0].n);
  const settled = async (run, timeout = 60000) => (await waitFor(async () => {
    const r = await api("GET", `/imports/${run}/progress`, tok);
    return r.body?.status === "done" ? r : null;
  }, { timeout, interval: 250 }).catch(() => null)) || { body: null };
  // One import, the way the screen does it: the rows, then the run recorded.
  const importFile = async (run, f, extra = {}) => {
    const t0 = Date.now();
    const imp = await api("POST", "/donors/import-combined", tok, { importId: run, ...f, ...extra });
    const ms = Date.now() - t0;
    const rec = await api("POST", "/imports", tok, { id: run, name: `File ${run.slice(-6)}`, shape: "gift_file_with_donors",
      rowsIn: f.gifts.length, giftsCreated: f.gifts.length, donorsCreated: f.donors.length, summary: {},
      ...(extra.thanks ? { thanks: extra.thanks } : {}) });
    return { imp, rec, ms };
  };
  const readoutOf = async run => {
    const [r] = await q(`SELECT id, title, lines FROM readouts WHERE org_id=$1 AND source_id=$2 AND removed_at IS NULL`, [ORG, run]);
    return r ? { ...r, kinds: (typeof r.lines === "string" ? JSON.parse(r.lines) : r.lines).map(l => l.kind) } : null;
  };
  const undo = run => api("POST", `/imports/${run}/reverse`, tok, {});

  // ── §1 · A FIRST IMPORT ASSUMES ITS RECENT GIFTS WERE THANKED ──────────
  const f300 = file("a", 300);
  const pv1 = await api("POST", "/imports/thank-you-preview", tok, { dates: f300.gifts.map(g => g.date), headers: ["Name", "Email", "Date", "Amount"] });
  ok("§1 the preview asks, for 300 recent gifts, and defaults to 'already thanked' because it is the first import",
     pv1.status === 200 && pv1.body?.ask === true && pv1.body?.thankYous === 300 && pv1.body?.defaultAnswer?.mode === "none"
       && pv1.body?.defaultWhy === "first_import", pv1.body);
  const runA = runId("a");
  const a = await importFile(runA, f300);
  ok("§1 the import is saved", a.imp.status === 200 && a.imp.body?.giftsInserted === 300, a.imp.body);
  const doneA = await settled(runA);
  ok("§1 its work finishes", doneA.body?.status === "done" && doneA.body?.done === 300, doneA.body);
  ok("§1 every gift is recorded", (await giftsOf(runA)) === 300);
  ok("§1 no thank-you is drafted", (await drafts(runA)) === 0 && doneA.body?.thankYouDrafts === 0, await drafts(runA));
  ok("§1 no first-gift journey starts", (await plans(runA)) === 0, await plans(runA));
  const roA = await readoutOf(runA);
  ok("§1 the readout is 'What your history shows'", roA && roA.title === "What your history shows", roA);
  ok("§1 …with no 'new donors' line", roA && !roA.kinds.includes("new_donors") && !roA.kinds.includes("new_above_median"), roA && roA.kinds);
  const hist = await api("GET", "/imports", tok);
  const histA = (hist.body?.imports || []).find(r => r.id === runA);
  ok("§1 the run's history says what was answered", /already been thanked/.test(histA?.thanks || ""), histA);
  ok("§1 undo", (await undo(runA)).body?.reversed === true);

  // ── §2 · THE OTHER TWO ANSWERS ─────────────────────────────────────────
  const runB = runId("b");
  await importFile(runB, file("b", 300), { thanks: { mode: "all" } });
  await settled(runB);
  ok("§2 'No, draft them all' drafts 300", (await drafts(runB)) === 300, await drafts(runB));
  ok("§2 …and starts no journey: an import fires no trigger (SEND-GATE-1)", (await plans(runB)) === 0, await plans(runB));
  ok("§2 undo", (await undo(runB)).body?.reversed === true);
  const runC = runId("c");
  await importFile(runC, file("c", 300), { thanks: { mode: "min", min: 250 } });
  await settled(runC);
  const big = Number((await q(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1 AND import_id=$2 AND amount >= 250`, [ORG, runC]))[0].n);
  ok("§2 'Only $250 or more' drafts only those", big === 150 && (await drafts(runC)) === 150, { big, drafts: await drafts(runC) });
  const big0 = Number((await q(
    `SELECT COUNT(*)::int AS n FROM thank_you_drafts t JOIN gifts g ON g.id=t.gift_id WHERE t.org_id=$1 AND g.import_id=$2 AND g.amount < 250`, [ORG, runC]))[0].n);
  ok("§2 …and none below it", big0 === 0, big0);

  // ── §3 · A LATER IMPORT, AND A SALESFORCE EXPORT ───────────────────────
  const fewDates = [civilPlusDays(-3), civilPlusDays(-4), civilPlusDays(-5)];
  const pv2 = await api("POST", "/imports/thank-you-preview", tok, { dates: fewDates, headers: ["Name", "Email", "Date", "Amount"] });
  ok("§3 a later import of a few recent gifts defaults to drafting them", pv2.body?.defaultAnswer?.mode === "all" && pv2.body?.firstImport === false, pv2.body);
  const sfHeaders = ["Opportunity Name", "Close Date", "Amount", "Stage", "Primary Contact", "Email"];
  const pv3 = await api("POST", "/imports/thank-you-preview", tok, { dates: fewDates, headers: sfHeaders });
  ok("§3 the same gifts from a Salesforce export default to 'already thanked'",
     pv3.body?.defaultAnswer?.mode === "none" && pv3.body?.system === "Salesforce", pv3.body);
  const runD = runId("d");
  await importFile(runD, file("d", 3));
  await settled(runD);
  ok("§3 the later import drafts its thank-yous", (await drafts(runD)) === 3, await drafts(runD));
  const roD = await readoutOf(runD);
  ok("§3 the second import's readout keeps the 'new donors' line", roD && roD.kinds.includes("new_donors") && roD.title !== "What your history shows", roD);
  const runS = runId("s");
  await importFile(runS, file("s", 3), { headers: sfHeaders });
  await settled(runS);
  ok("§3 a Salesforce export with no answer drafts none", (await giftsOf(runS)) === 3 && (await drafts(runS)) === 0, await drafts(runS));

  // ── §4 · 5,000 RECENT GIFTS DON'T MAKE HER WAIT ────────────────────────
  const runE = runId("e");
  const e = await importFile(runE, file("e", 1000, 5));
  ok(`§4 5,000 recent gifts: the request answers in under 3 seconds (${e.ms}ms)`, e.imp.status === 200 && e.ms < 3000, { ms: e.ms, body: e.imp.body });
  ok("§4 …and says the gifts are queued", e.imp.body?.recentQueued === 5000 && e.rec.body?.working === true, { imp: e.imp.body?.recentQueued, rec: e.rec.body });
  const p1 = await api("GET", `/imports/${runE}/progress`, tok);
  ok("§4 progress is shown while it runs", p1.body?.status === "running" && p1.body?.total === 5000
     && /^(Thanking and checking|Checking) 5,000 recent gifts: [\d,]+ done$/.test(p1.body?.sentence || ""), p1.body);
  const t0 = Date.now();
  const doneE = await settled(runE, 240000);
  ok(`§4 it finishes (${Math.round((Date.now() - t0) / 1000)}s after the request)`, doneE.body?.status === "done" && doneE.body?.done === 5000, doneE.body);
  ok("§4 every gift is recorded", (await giftsOf(runE)) === 5000);
  ok("§4 the readout appears when it finishes", !!doneE.body?.readout?.id, doneE.body);

  // ── §5 · UNDO DURING THE WORK ──────────────────────────────────────────
  const runF = runId("f");
  const fF = await importFile(runF, file("f", 1000, 5), { thanks: { mode: "all" } });
  ok("§5 a second 5,000-gift import answers quickly too", fF.imp.status === 200 && fF.ms < 3000, fF.ms);
  await waitFor(async () => { const r = await api("GET", `/imports/${runF}/progress`, tok); return r.body?.done > 0 ? r : null; }, { timeout: 30000, interval: 100 }).catch(() => null);
  const mid = await api("GET", `/imports/${runF}/progress`, tok);
  ok("§5 the work is part way through", mid.body?.status === "running" && mid.body.done > 0 && mid.body.done < 5000, mid.body);
  const u = await undo(runF);
  ok("§5 undo during the work answers", u.status === 200 && u.body?.reversed === true, u.body);
  ok("§5 no gift from it is left", (await giftsOf(runF)) === 0, await giftsOf(runF));
  ok("§5 no person it created is left", Number((await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND created_import_id=$2`, [ORG, runF]))[0].n) === 0);
  ok("§5 no thank-you draft or journey from it is left",
     (await drafts(runF)) === 0 && (await plans(runF)) === 0
       && Number((await q(`SELECT COUNT(*)::int AS n FROM thank_you_drafts WHERE org_id=$1 AND gift_id NOT IN (SELECT id FROM gifts)`, [ORG]))[0].n) === 0);
  ok("§5 nothing is left to do", Number((await q(`SELECT COUNT(*)::int AS n FROM import_recent_work WHERE import_id=$1`, [runF]))[0].n) === 0);
  await new Promise(r => setTimeout(r, 1500));
  ok("§5 and nothing is written after the undo", (await giftsOf(runF)) === 0, await giftsOf(runF));
  const pF = await api("GET", `/imports/${runF}/progress`, tok);
  ok("§5 its progress says it stopped", pF.body?.status === "cancelled", pF.body);

  // ── §6 · FIX-45 1.4: A JOINT RECORD IS THANKED AS BOTH PEOPLE ──────────
  // "Desmond & Ruth Okafor" used to open "Dear Desmond,". The draft and the
  // queue read the record's greeting: both names, or its salutation.
  const mk = async (name) => (await api("POST", "/donors", tok, { name, email: `${name.replace(/\W+/g, "").toLowerCase()}@${DOMAIN}` })).body;
  const joint = await mk("Desmond & Ruth Okafor");
  const saluted = await mk("Ann Lee");
  await q(`UPDATE donors SET salutation='Dr. Lee' WHERE id=$1 AND org_id=$2`, [saluted.id, ORG]);
  for (const d of [joint, saluted]) await api("POST", `/donors/${d.id}/gifts`, tok, { amount: 1500, date: civilPlusDays(0), paymentMethod: "Check" });
  const draftOf = async id => (await q(`SELECT body FROM thank_you_drafts WHERE org_id=$1 AND donor_id=$2`, [ORG, id]))[0]?.body || "";
  const jb = await draftOf(joint.id), sb = await draftOf(saluted.id);
  ok("§6 a joint record's thank-you greets both people", /^Dear Desmond and Ruth,/.test(jb), jb.slice(0, 60));
  ok("§6 a record's salutation is the greeting", /^Dear Dr\. Lee,/.test(sb), sb.slice(0, 60));
  const queue = await api("GET", "/thank-yous", tok);
  const qj = (queue.body?.drafts || []).find(d => d.donorId === joint.id);
  ok("§6 …and the thank-you queue reads it the same way", !!qj && /^Dear Desmond and Ruth,/.test(qj.body), qj && qj.body.slice(0, 60));

  // ── §7 · FIX-46: A SAVED TEMPLATE'S "Dear {{donor_name}}" GREETS ─────────
  // The merge field that greets is the greeting, not the full name ("Dear
  // Margaret Chen,"): an Agent draft started from a saved email template, and
  // a one-person template previewed against the record.
  await q(`INSERT INTO email_templates (id,org_id,name,purpose,subject,preheader,blocks,created_by,created_by_name)
           VALUES ('et_fix46g',$1,'Greets','person','Hello {{donor_name}}','',$2::jsonb,'system:test','test')`,
    [ORG, JSON.stringify([{ type: "header" }, { type: "richtext", blocks: [{ type: "p", text: "Dear {{donor_name}}," }, { type: "p", text: "A gift from {{first_name}} matters." }] }])]);
  for (const [d, want, tag] of [[joint, "Desmond and Ruth", "j"], [saluted, "Dr. Lee", "s"]]) {
    await q(`INSERT INTO agent_drafts (id,org_id,donor_id,subject,body,status,purpose) VALUES ($1,$2,$3,'x','x','pending','thank')`, [`ad_fix46${tag}`, ORG, d.id]);
    const ft = await api("POST", `/agent/drafts/ad_fix46${tag}/from-template`, tok, { templateId: "et_fix46g" });
    const body = ft.body?.body || "";
    ok(`§7 an Agent draft from a saved template greets "Dear ${want},"`, body.includes(`Dear ${want},`) && !body.includes("{{"), body.slice(0, 120));
    ok(`§7 …and its subject's greeting too`, ft.body?.subject === `Hello ${want}`, ft.body?.subject);
  }
  // Jonathan, 19 Oct: "Dear {{first_name}}" is first names only (both on a
  // joint record), never the salutation; only the full-name field greets.
  await q(`INSERT INTO email_templates (id,org_id,name,purpose,subject,preheader,blocks,created_by,created_by_name)
           VALUES ('et_fix46f',$1,'First names','person','Hi {{first_name}}','',$2::jsonb,'system:test','test')`,
    [ORG, JSON.stringify([{ type: "header" }, { type: "richtext", blocks: [{ type: "p", text: "Dear {{first_name}}," }, { type: "p", text: "Thank you." }] }])]);
  for (const [d, want, tag] of [[saluted, "Ann", "sf"], [joint, "Desmond and Ruth", "jf"]]) {
    await q(`INSERT INTO agent_drafts (id,org_id,donor_id,subject,body,status,purpose) VALUES ($1,$2,$3,'x','x','pending','thank')`, [`ad_fix46${tag}`, ORG, d.id]);
    const ft = await api("POST", `/agent/drafts/ad_fix46${tag}/from-template`, tok, { templateId: "et_fix46f" });
    ok(`§7 "Dear {{first_name}}" in an Agent draft reads first names only: "Dear ${want},"`,
       (ft.body?.body || "").includes(`Dear ${want},`) && ft.body?.subject === `Hi ${want}`, { body: ft.body?.body, subject: ft.body?.subject });
  }
  const pf = await api("POST", "/templates/thanks_first/preview", tok, { donorId: saluted.id, subject: "Thanks", body: "Dear {{first_name}},\n\nThank you." });
  ok("§7 …and in a one-person template, never the salutation", /^Dear Ann,/.test(pf.body?.body || ""), pf.body?.body);
  const pv = await api("POST", "/templates/thanks_first/preview", tok, { donorId: joint.id, subject: "Thanks", body: "Dear {{full_name}},\n\nThank you, {{full_name}}." });
  ok("§7 a one-person template's greeting reads both people, the rest keeps the full name",
     /^Dear Desmond and Ruth,/.test(pv.body?.body || "") && (pv.body?.body || "").includes("Thank you, Desmond & Ruth Okafor."), pv.body?.body);

  // ── §8 · FIX-56: AN ORGANISATION IS GREETED AS ONE, AND THE SIGNATURE IS
  // THE SENDER'S. A foundation's thank-you opened "Dear Lynn and Rovena," and
  // its preview said the foundation had "nothing on file for: signature". Red
  // on main (970d9cf): §8 greets "Dear Alder and Birch,", reports signature
  // missing, and the email editor's preview is signed by the sample person.
  const fdn = await mk("Alder & Birch Family Foundation");
  await q(`UPDATE donors SET kind='organisation' WHERE id=$1 AND org_id=$2`, [fdn.id, ORG]);
  const withContact = await mk("Harbor Tools Inc.");
  await q(`UPDATE donors SET kind='organisation', contact_name='Pat Rivera' WHERE id=$1 AND org_id=$2`, [withContact.id, ORG]);
  await q(`UPDATE orgs SET receipt_signature_name=NULL, receipt_signature_title=NULL, brand_signature_extra=NULL WHERE id=$1`, [ORG]);
  const thanks = "Dear {{first_name}},\n\nThank you.\n\nWith thanks,\n{{signature}}";
  const pfd = await api("POST", "/templates/thanks_first/preview", tok, { donorId: fdn.id, subject: "Thanks", body: thanks });
  const [orgRow] = await q(`SELECT name FROM orgs WHERE id=$1`, [ORG]);
  ok("§8 a foundation is greeted \"Dear friends at <name>,\", never by the first words of its name",
     /^Dear friends at Alder & Birch Family Foundation,/.test(pfd.body?.body || ""), pfd.body?.body);
  ok("§8 with no signature in Brand, it is signed with the org's name and nothing is missing for the donor",
     (pfd.body?.body || "").trim().endsWith(orgRow.name) && !(pfd.body?.missing || []).includes("signature") && pfd.body?.signatureFromBrand === false,
     { body: pfd.body?.body, missing: pfd.body?.missing, fromBrand: pfd.body?.signatureFromBrand });
  const pfc = await api("POST", "/templates/thanks_first/preview", tok, { donorId: withContact.id, subject: "Thanks", body: thanks });
  ok("§8 an organisation with a named contact is greeted by the contact", /^Dear Pat,/.test(pfc.body?.body || ""), pfc.body?.body);
  await api("PUT", "/brand-kit", tok, { signatureName: "Sam Ortiz", signatureTitle: "Director" });
  const pfs = await api("POST", "/templates/thanks_first/preview", tok, { donorId: fdn.id, subject: "Thanks", body: thanks });
  ok("§8 with a signature in Brand, that is the signature", (pfs.body?.body || "").includes("Sam Ortiz\nDirector") && pfs.body?.signatureFromBrand === true, pfs.body?.body);
  await q(`UPDATE orgs SET receipt_signature_name=NULL, receipt_signature_title=NULL WHERE id=$1`, [ORG]);
  const et = await api("POST", "/email-templates", tok, { starterKey: "person_thanks_first" });
  ok("§8 the first-gift thank-you opens in the email editor as a one-person email", (et.status === 201 || et.status === 200) && et.body?.template?.personKind === "thanks_first", et.body);
  if (et.body?.template?.id) {
    const pe = await api("POST", `/email-templates/${et.body.template.id}/preview`, tok, {});
    const html = JSON.stringify(pe.body || {});
    ok("§8 the email editor's preview is never signed by the brand kit's sample person", !/Dana Reyes/.test(html) && html.includes(orgRow.name), html.slice(0, 200));
  }

  await wipe();
  await closeDb();
  summary();
})().catch(async e => { ok("ran to the end", false, e.stack || e.message); await closeDb().catch(() => {}); summary(); });
