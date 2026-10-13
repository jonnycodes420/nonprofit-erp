// tests/live1-alive.test.js, LIVE-1. EVERY IMPORT AND EVERY ACTION FEEDS THE MACHINE.
//
//     A GIFT IN A CSV BEHAVES LIKE THE SAME GIFT FROM STRIPE, EVERY DOOR RUNS
//     THE ONE AFTER-CHANGE STEP, AND AN IMPORT SAYS WHAT IT TOLD US.
//
// Guards donor data and donor mail: before LIVE-1 a gift from five days ago
// in a CSV got no thank-you and started nothing, and the undo of an import
// left behind the journeys its gifts had started.
//
// WHAT IS ASSERTED, with a first-gift journey switched on:
//   §1  a gift CSV: the 5-day-old gift gets a thank-you draft and starts the
//       first-gift journey, the 200-day-old one does neither, both count on
//       the profile; the preview said 1 thank-you before anything was saved
//   §2  a second file with the same headers maps itself and asks only about
//       its one new column
//   §3  an import with a lapsed donor's new gift, a biggest-ever gift and a
//       monthly gift that stopped: the readout has exactly those three lines,
//       each opening exactly the right person
//   §4  every door in the map calls the after-change step (one assertion per
//       door: the doors this suite can drive are driven and read back from
//       the step's own log; the rest are read from the code that runs them)
//   §5  a line kind dismissed three times running moves down; one click
//       restores it
//   §6  a readout "call" followed by a gift shows in What worked
//   §7  undo of the first import removes its gifts, thank-you drafts, journey
//       starts and readout
//
// HOW IT WOULD GO RED: on main every §1-§7 check is red (the CSV gift starts
// nothing, there is no readout and no after-change step). Remove the recent
// split in /donors/import-combined and §1 goes red; drop stopImportJourneys
// from the undo and §7 goes red.

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const stripe = require("stripe")("sk_test_dummy");
const { ok, summary, login, api, q, closeDb, civilPlusDays, waitFor } = require("./helpers");

const ORG = "org_live1alive";
const ADMIN = "live1-admin@example.org";
const ACCT = "acct_live1alive";
const DOMAIN = "live1-alive.org";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";
const BASE = process.env.BASE || "http://localhost:5601";

async function wipe() {
  const tables = (await q(`SELECT table_name FROM information_schema.columns
                            WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (let pass = 0; pass < 4; pass++) {
    for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false)) return;
  }
}

async function fireStripe(evtId, piId, cents, email, name) {
  const payload = JSON.stringify({
    id: evtId, type: "payment_intent.succeeded", account: ACCT,
    data: { object: { id: piId, amount_received: cents, receipt_email: email, metadata: { donor_name: name } } },
  });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const r = await fetch(BASE + "/stripe/webhook", {
    method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": header }, body: payload });
  return r.status;
}

const runId = tag => `imp_live1${tag}${Date.now().toString(36)}`;

(async () => {
  console.log("LIVE-1: every import and every action feeds the machine\n");
  await wipe();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,stripe_account_id)
           VALUES ($1,'Lantern Hill Arts','lantern-hill-arts',1,'active','team',$2)`, [ORG, ACCT]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_live1',$1,$2,$3,'Rowan Admin','admin')`,
    [ORG, ADMIN, bcrypt.hashSync("loadtest1234", 10)]);
  const tok = await login(ADMIN);
  const donorByEmail = async email => (await q(`SELECT id, gift_count, total_giving FROM donors WHERE org_id=$1 AND email=$2`, [ORG, email]))[0];

  const j = await api("POST", "/journeys", tok, { name: "Welcome, first gift", trigger: "first_gift", enabled: true,
    steps: [{ type: "thank", label: "Call to say thank you", offsetDays: 2 }] });
  ok("a first-gift journey is made and switched on", j.status === 201 && j.body?.enabled === true, j.body);
  const plansOf = async donorId => (await q(
    `SELECT id FROM cultivation_plans WHERE org_id=$1 AND donor_id=$2 AND template_id=$3`, [ORG, donorId, j.body.id])).length;
  const draftsOf = async donorId => (await q(`SELECT id FROM thank_you_drafts WHERE org_id=$1 AND donor_id=$2`, [ORG, donorId])).length;

  // FIX-37: an org's first import assumes its recent gifts were thanked in
  // the old system. LIVE-1's checks are about a later, monthly file, so an
  // earlier run is on file first. And the recent-gift work now runs behind
  // the screen: `settled` waits for it.
  await api("POST", "/imports", tok, { name: "An earlier file", shape: "donors", summary: {} });
  const settled = async run => waitFor(async () => {
    const r = await api("GET", `/imports/${run}/progress`, tok);
    return r.body?.status === "done" ? r : null;
  }, { timeout: 20000 }).catch(() => ({ body: null }));

  // ── §1 · A GIFT CSV ────────────────────────────────────────────────────
  const headers1 = ["Name", "Email", "Gift Date", "Gift Amount", "Gift ID"];
  const preview = await api("POST", "/imports/thank-you-preview", tok, { dates: [civilPlusDays(-5), civilPlusDays(-200)] });
  ok("§1 the preview says the file will draft 1 thank-you, before anything is saved",
     preview.status === 200 && preview.body?.thankYous === 1 && /up to 1 thank-you note/.test(preview.body?.sentence || ""), preview.body);
  const run1 = runId("a");
  const imp1 = await api("POST", "/donors/import-combined", tok, { importId: run1,
    donors: [{ name: "Nia Fresh", email: `nia@${DOMAIN}` }, { name: "Otto Older", email: `otto@${DOMAIN}` }],
    gifts: [{ donorIndex: 0, amount: 75, date: civilPlusDays(-5), type: "cash", paymentMethod: "Check", externalId: "L1-NIA-1" },
            { donorIndex: 1, amount: 60, date: civilPlusDays(-200), type: "cash", paymentMethod: "Check", externalId: "L1-OTTO-1" }],
  });
  ok("§1 the import records both gifts", imp1.status === 200 && imp1.body?.giftsInserted === 2, imp1.body);
  const rec1 = await api("POST", "/imports", tok, { id: run1, name: "September gifts", shape: "gift_file_with_donors",
    rowsIn: 2, giftsCreated: 2, donorsCreated: 2, dollarsIn: 135, dollarsCreated: 135, summary: {} });
  ok("§1 the run is recorded", rec1.status === 200 && rec1.body?.id === run1, rec1.body);
  const done1 = await settled(run1);
  ok("§1 it says it drafted 1 thank-you", done1.body?.thankYouDrafts === 1, done1.body);
  const nia = await donorByEmail(`nia@${DOMAIN}`), otto = await donorByEmail(`otto@${DOMAIN}`);
  ok("§1 the 5-day-old gift gets a thank-you draft", nia && (await draftsOf(nia.id)) === 1, nia);
  ok("§1 …and starts the first-gift journey", nia && (await plansOf(nia.id)) === 1, nia && await plansOf(nia.id));
  ok("§1 the 200-day-old gift gets no thank-you draft", otto && (await draftsOf(otto.id)) === 0, otto);
  ok("§1 …and starts no journey", otto && (await plansOf(otto.id)) === 0, otto);
  ok("§1 both count on the profile (lifetime and gift count)",
     Number(nia.total_giving) === 75 && Number(nia.gift_count) === 1 && Number(otto.total_giving) === 60 && Number(otto.gift_count) === 1,
     { nia, otto });

  // ── §2 · THE SAME HEADERS MAP THEMSELVES ───────────────────────────────
  const map1 = { "Name": "name", "Email": "email", "Gift Date": "giftDate", "Gift Amount": "giftAmount", "Gift ID": "giftId" };
  const saved = await api("POST", "/import-shapes", tok, { headers: headers1, mapping: map1 });
  ok("§2 the first file's answers are saved against its headers", saved.status === 200 && saved.body?.ok, saved.body);
  const headers2 = ["Gift ID", "Email", "Name", "Gift Amount", "Gift Date", "Appeal"];
  const m2 = await api("POST", "/import-shapes/match", tok, { headers: headers2 });
  ok("§2 a second file with the same headers (and one more) maps itself",
     m2.status === 200 && m2.body?.matched === true && Object.keys(m2.body.mapping || {}).length === 5 && m2.body.mapping["Gift Date"] === "giftDate", m2.body);
  ok("§2 …and asks only about the one new column",
     JSON.stringify(m2.body?.newHeaders) === JSON.stringify(["Appeal"]), m2.body?.newHeaders);

  // ── §3 · THE READOUT ───────────────────────────────────────────────────
  const person = async (id, name, email) => q(
    `INSERT INTO donors (id,org_id,name,email,person_types) VALUES ($1,$2,$3,$4,'["donor"]'::jsonb)`, [id, ORG, name, email]);
  const gift = async (id, donor, amount, daysAgo, type = "cash") => q(
    `INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,$6,'system:test','Test')`,
    [id, ORG, donor, amount, civilPlusDays(-daysAgo), type]);
  await person("d_l1_lena", "Lena Returning", `lena@${DOMAIN}`);
  await gift("g_l1_lena0", "d_l1_lena", 200, 800);
  await person("d_l1_bo", "Bo Biggest", `bo@${DOMAIN}`);
  await gift("g_l1_bo0", "d_l1_bo", 100, 60);
  await person("d_l1_mo", "Mo Monthly", `mo@${DOMAIN}`);
  for (const [i, d] of [150, 120, 90, 60].entries()) await gift(`g_l1_mo${i}`, "d_l1_mo", 25, d, "recurring");
  const run2 = runId("b");
  const imp2 = await api("POST", "/donors/import-combined", tok, { importId: run2, linkToExisting: true, donors: [],
    gifts: [{ email: `lena@${DOMAIN}`, name: "Lena Returning", amount: 50, date: civilPlusDays(-10), type: "cash", externalId: "L1-LENA-1" },
            { email: `bo@${DOMAIN}`, name: "Bo Biggest", amount: 1000, date: civilPlusDays(-5), type: "cash", externalId: "L1-BO-1" }],
  });
  ok("§3 the second import records both gifts", imp2.status === 200 && imp2.body?.giftsInserted === 2, imp2.body);
  const rec2 = await api("POST", "/imports", tok, { id: run2, name: "October gifts", shape: "gifts",
    rowsIn: 2, giftsCreated: 2, dollarsIn: 1050, dollarsCreated: 1050, summary: {} });
  const roId = rec2.body?.readout?.id || (await settled(run2)).body?.readout?.id;
  ok("§3 recording the run writes a readout", rec2.status === 200 && !!roId, rec2.body);
  const ro = await api("GET", `/readouts/${roId}`, tok);
  const kinds = (ro.body?.lines || []).map(l => l.kind).sort();
  ok("§3 the readout has exactly three lines: came back, biggest ever, monthly stopped",
     JSON.stringify(kinds) === JSON.stringify(["biggest_ever", "lapsed_returned", "recurring_stopped"]), ro.body?.lines);
  ok("§3 every line has a count, one action and a one-sentence Why",
     (ro.body?.lines || []).length === 3 && ro.body.lines.every(l => l.count === 1 && l.actionLabel && /\.$/.test(l.why || "")), ro.body?.lines);
  ok("§3 the headline names the first two lines", /^Your \w+ import: 1 lapsed donor came back, 1 gave their biggest gift ever$/.test(ro.body?.headline || ""), ro.body?.headline);
  for (const [kind, who] of [["lapsed_returned", "d_l1_lena"], ["biggest_ever", "d_l1_bo"], ["recurring_stopped", "d_l1_mo"]]) {
    const rows = await api("GET", `/figures/readout-line/rows?readout=${roId}&kind=${kind}`, tok);
    ok(`§3 the ${kind} line opens exactly ${who}`,
       rows.status === 200 && (rows.body?.rows || []).length === 1 && rows.body.rows[0].donorId === who, rows.body);
  }
  const ask1 = await api("POST", "/ask", tok, { text: "who came back this month?" });
  ok("§3 Ask: 'who came back this month?' names Lena, from the readout",
     ask1.status === 200 && ask1.body?.answered === true && (ask1.body?.people || []).map(p => p.donorId).join() === "d_l1_lena"
       && ask1.body?.figures?.value?.source?.key === "readout-line", ask1.body);
  const ask2 = await api("POST", "/ask", tok, { text: "what did the latest import tell us?" });
  ok("§3 Ask: 'what did the latest import tell us?' is the readout, each count opening its line",
     ask2.status === 200 && (ask2.body?.table?.rows || []).length === 3 && ask2.body.table.rows.every(r => r.value?.source?.key === "readout-line"), ask2.body);
  const thread = await api("GET", "/readouts/latest", tok);
  ok("§3 the readout is the Thread's newest readout item", thread.body?.readout?.id === roId, thread.body);

  // ── §4 · EVERY DOOR CALLS THE AFTER-CHANGE STEP ────────────────────────
  // Driven here: the gift form, Stripe, a CSV, a giving-source read, hours,
  // a logged touch. The rest are read from the code that runs them.
  await api("POST", "/donors/d_l1_lena/gifts", tok, { amount: 20, date: civilPlusDays(0), paymentMethod: "Cash" });
  await fireStripe("evt_live1_1", "pi_live1_1", 3000, `sky@${DOMAIN}`, "Sky Online");
  await q(`INSERT INTO giving_sources (id,org_id,provider,display_name,status) VALUES ('gs_live1',$1,'paypal','PayPal','active')`, [ORG]);
  await api("POST", "/giving-sources/gs_live1/sync-fixture", tok, { rows: [{ externalId: "L1-PP-1", occurredAt: civilPlusDays(-2),
    amountCents: 4000, feeCents: 150, currency: "USD", donorName: "Pip Paypal", donorEmail: `pip@${DOMAIN}`, recurringRef: null, status: "completed", memo: "" }] });
  await api("POST", "/donors/d_l1_bo/volunteer-hours", tok, { date: civilPlusDays(-1), hours: 3, role: "Usher" });
  await api("POST", "/donors/d_l1_bo/interactions", tok, { type: "call", note: "Said thank you" });
  const log = await waitFor(async () => {
    const r = await api("GET", "/after-change-log", tok);
    const doors = new Set((r.body?.runs || []).map(x => x.door));
    return ["gift_form", "stripe_webhook", "csv_import", "giving_source_read", "volunteer_hours", "logged_touch"].every(d => doors.has(d)) ? r : null;
  }, { timeout: 8000 }).catch(() => null) || await api("GET", "/after-change-log", tok);
  const ran = new Set((log.body?.runs || []).map(x => x.door));
  const doors = log.body?.doors || [];
  ok("§4 the door list is the twelve in the map", doors.length === 12, doors);
  const SRC = ["server.js", "qboRead.js", "meetingEffects.js", "routes/crm.js", "routes/webhooks.js", "routes/historyImport.js",
               "routes/oldReports.js"].map(f => fs.readFileSync(path.join(__dirname, "..", f), "utf8")).join("\n");
  for (const d of doors) {
    if (ran.has(d)) ok(`§4 ${d}: driven, and the step ran for it`, true);
    else ok(`§4 ${d}: the code that runs this door calls the step with its name`,
            new RegExp(`door: (?:[^,}]*\\? )?"${d}"`).test(SRC), d);
  }
  // A door that writes no gift must not recompute totals: run late (hours and
  // mail are coalesced), that recompute read the gifts before a merge and
  // wrote them back after it (wire-journey §8, CI, the first LIVE-1 push).
  const noGift = (log.body?.runs || []).filter(r => ["volunteer_hours", "logged_touch"].includes(r.door));
  ok("§4 hours and a logged touch run the step without recomputing totals",
     noGift.length >= 2 && noGift.every(r => r.recalc === false), noGift);
  const csvRun = (log.body?.runs || []).find(r => r.door === "csv_import" && r.donors >= 2);
  ok("§4 a whole file is ONE run of the step, not one per row", !!csvRun, log.body?.runs);

  // ── §5 · WHAT STAFF IGNORE ─────────────────────────────────────────────
  const demotedNow = async () => ((await api("GET", "/readouts", tok)).body?.learned?.demoted || []).map(x => x.kind);
  for (let i = 0; i < 2; i++) await api("POST", `/readouts/${roId}/lines/recurring_stopped/dismiss`, tok, {});
  ok("§5 two dismissals do not move a kind down", !(await demotedNow()).includes("recurring_stopped"), await demotedNow());
  const third = await api("POST", `/readouts/${roId}/lines/recurring_stopped/dismiss`, tok, {});
  ok("§5 the third dismissal running moves it down, and says so", third.body?.demoted === true && /bottom/.test(third.body?.sentence || ""), third.body);
  ok("§5 the learned rules list it with a Why", (await demotedNow()).includes("recurring_stopped"));
  const back = await api("POST", "/readout-kinds/recurring_stopped/restore", tok, {});
  ok("§5 one click puts it back", back.status === 200 && back.body?.demoted === false && !(await demotedNow()).includes("recurring_stopped"), back.body);

  // ── §6 · WHAT WORKED ───────────────────────────────────────────────────
  const act = await api("POST", `/readouts/${roId}/lines/biggest_ever/act`, tok, {});
  ok("§6 the biggest-ever line's action makes a call task for Bo",
     act.status === 200 && act.body?.made === 1
       && (await q(`SELECT 1 FROM tasks WHERE org_id=$1 AND donor_id='d_l1_bo' AND title LIKE 'Call Bo Biggest%'`, [ORG])).length === 1, act.body);
  await api("POST", "/donors/d_l1_bo/gifts", tok, { amount: 250, date: civilPlusDays(0), paymentMethod: "Check" });
  const ww = (await api("GET", "/readouts", tok)).body?.whatWorked;
  ok("§6 What worked counts Bo's gift after the call, and says 'gave', never 'because'",
     ww && ww.people === 1 && ww.cents === 25000 && /gave \$250/.test(ww.sentence || "") && !/because|thanks to/i.test(ww.sentence || ""), ww);

  // ── §6b · A READOUT ACTION KEEPS FIX-36's RULE ────────────────────────
  // Found by the LIVE-1 walk: "Draft thank-yous" on a first import's new-donor
  // line drafted a note for every first gift, three years old included.
  const ro1 = rec1.body?.readout?.id || done1.body?.readout?.id;
  const act1 = await api("POST", `/readouts/${ro1}/lines/new_donors/act`, tok, {});
  ok("§6b drafting thank-yous from a readout skips the 200-day-old gift",
     act1.status === 200 && act1.body?.tooOld === 1 && (await draftsOf(otto.id)) === 0, { act1: act1.body, otto: await draftsOf(otto.id) });

  // ── §7 · UNDO ──────────────────────────────────────────────────────────
  const undo = await api("POST", `/imports/${run1}/reverse`, tok, {});
  ok("§7 the first import undoes", undo.status === 200 && undo.body?.reversed === true, undo.body);
  ok("§7 its gifts are gone", (await q(`SELECT 1 FROM gifts WHERE org_id=$1 AND import_id=$2`, [ORG, run1])).length === 0);
  ok("§7 its thank-you draft is gone", (await q(`SELECT 1 FROM thank_you_drafts WHERE org_id=$1 AND donor_id=$2`, [ORG, nia.id])).length === 0);
  ok("§7 the journey it started is gone", (await q(`SELECT 1 FROM cultivation_plans WHERE org_id=$1 AND started_import_id=$2`, [ORG, run1])).length === 0
     && undo.body?.journeysStopped === 1, undo.body);
  ok("§7 its readout is gone", (await q(`SELECT 1 FROM readouts WHERE org_id=$1 AND source_id=$2 AND removed_at IS NULL`, [ORG, run1])).length === 0);

  await wipe();
  await closeDb();
  summary();
})().catch(async e => { ok("ran to the end", false, e.stack || e.message); await closeDb().catch(() => {}); summary(); });
