// tests/gifts1-money.test.js · GIFTS-1's one test. A GIFT CAN BELONG TO AN
// EVENT, A PLEDGE CAN BE PAID IN INSTALLMENTS, A GRANT RECORDS ITS PAYMENTS.
//
// §1 event gifts: a $250 gift recorded with an event (the gift form's route)
//    makes the event's Raised $250, the attendee's Gift $250 and the guest
//    "Came, gave"; the person's profile shows the gift with its event. Clearing
//    the event on an edit, and deleting the gift, put all three back. A foreign
//    event is refused. An imported gift whose Campaign column names the event
//    exactly is linked to it.
// §2 installments: a $1,200 pledge in 4 monthly installments from Dec 1 is
//    written as 4 × $300 on Dec 1, Jan 1, Feb 1, Mar 1; $1,000 in 3 is $333.33,
//    $333.33, $333.34 (the remainder on the last). A $300 payment marks the
//    FIRST installment paid, and Pledged, due by Jan 15 (pledges-due) is $300.
//    Re-planning the schedule keeps the payment applied.
// §3 grant payments: a $10,000 payment received on a $15,000 awarded grant
//    (Record a payment received: the gift route with the award pledge) is on
//    the funder's profile, the grant shows $10,000 received and $5,000
//    remaining, Finance has the income row, and the general PUT no longer
//    writes a typed Received. scripts/ops/gifts1-grant-received.js lists a
//    grant with a typed Received, --apply writes one payment for the
//    difference, a second run writes nothing.
// §4 (browser leg) the attendee menu's "Record a gift" opens with the person
//    and the event filled in.
//
// Money and donor data: a gift that belongs to no event, a pledge whose
// payments land on the wrong installment and a grant whose money is a typed
// number are money every total disagrees about.
//
// HOW IT GOES RED (planted, seen red, then fixed):
//   · drop the event from the Raised sum (shared/numbers/events.js
//     EVENT_GIFT_MATCH without `g.event_id = e.id`): §1 "Raised is $250" fails.
//   · apply payments newest-first (recordGift's installment ORDER BY
//     i.due_date DESC): §2 "the first installment is the one paid" fails.
// On main every section fails: the gift route ignores eventId, the generator
// has no weekly and puts the remainder first, and the grant keeps a typed figure.

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { Client } = require("pg");
const { ok, summary, login, api, q, closeDb, browserLegOrSkip } = require("./helpers");
const { DIST } = require("./lib/dist");

const ORG = "org_gifts1_a";
const EMAIL = `kestrel@${ORG}.local`;
const P = s => `${ORG}_${s}`;
const APP = process.env.APP_URL || "http://localhost:4173";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");
const cents = v => Math.round((Number(v) || 0) * 100);

async function reset() {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  await q(`UPDATE pledges SET fulfilled_gift_id=NULL WHERE org_id=$1`, [ORG]).catch(() => {});
  for (let pass = 0; pass < 3; pass++) for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
}
async function person(key, name, extra = "") {
  await q(`INSERT INTO donors (id,org_id,name,email,stage,status,tags,created_by,created_by_name${extra ? ",person_types,funder_type" : ""})
           VALUES ($1,$2,$3,$4,'steward','active','[]','system:test','test'${extra ? ",'[\"organization\"]','private_foundation'" : ""})`,
    [P(key), ORG, name, `${key}@${ORG}.local`]);
  return P(key);
}
const eventRead = async (tok, id) => (await api("GET", `/events/${id}`, tok)).body || {};
const reportOf = async (tok, id) => (await api("GET", `/events/${id}/report`, tok)).body || {};
const inList = (list, id) => (list || []).some(p => p.id === id || (p.members || []).some(m => m.id === id));

(async () => {
  await reset();
  const pw = bcrypt.hashSync("loadtest1234", 4);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at)
           VALUES ($1,'Gifts one fixture','gifts1-a',1,'active','team','America/New_York',NOW())`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Kestrel Abernathy','admin')`, [`u_${ORG}`, ORG, EMAIL, pw]);
  const tok = await login(EMAIL);
  await api("POST", "/onboarding/complete", tok, {});

  // ── §1 · a gift for an event ───────────────────────────────────────────
  console.log("\n§1 a $250 gift at the Lantern Supper");
  const D = await person("mara", "Mara Quillfeather");
  const ev = await api("POST", "/events", tok, { name: "Lantern Supper Fixture", eventType: "fundraiser", date: "2026-10-30" });
  const EV = ev.body && ev.body.id;
  ok("§1 the event is on file", ev.status < 300 && EV, ev.body);
  const att = await api("POST", `/events/${EV}/attendees`, tok, { donorIds: [D] });
  const attId = ((await eventRead(tok, EV)).attendees || [])[0]?.id;
  await api("PATCH", `/events/${EV}/attendees/${attId}`, tok, { status: "attended" });
  let e0 = await eventRead(tok, EV), r0 = await reportOf(tok, EV);
  ok("§1 before the gift: Raised $0, and she came and didn't give", att.status < 300 && e0.money && e0.money.raisedCents === 0
     && inList(r0.guests && r0.guests.cameNoGift, D), { money: e0.money, guests: r0.guests && r0.guests.cameNoGift });

  const foreign = await api("POST", `/donors/${D}/gifts`, tok, { amount: "250.00", date: "2026-10-30", eventId: "evt_not_this_orgs" });
  ok("§1 an event not in this org is refused, and nothing is written", foreign.status === 404
     && (await q(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1`, [ORG]))[0].n === 0, foreign.body);

  const g = await api("POST", `/donors/${D}/gifts`, tok, { amount: "250.00", date: "2026-10-30", payment_method: "Check", eventId: EV });
  const GID = g.body && g.body.gift && g.body.gift.id;
  const e1 = await eventRead(tok, EV), r1 = await reportOf(tok, EV);
  const a1 = (e1.attendees || []).find(a => a.donor_id === D) || {};
  ok("§1 the gift is recorded with its event", g.status === 201 && g.body.gift.event_id === EV, g.body);
  ok("§1 the event's Raised is $250", e1.money && e1.money.raisedCents === 25000 && e1.money.receivedCents === 25000, e1.money);
  ok("§1 the attendee's row: came, gave $250", a1.status === "attended" && cents(a1.event_given) === 25000, a1);
  ok("§1 the night's lists move her to Came, gave", inList(r1.guests && r1.guests.cameGave, D) && !inList(r1.guests && r1.guests.cameNoGift, D), r1.guests);
  const prof = (await api("GET", `/donors/${D}`, tok)).body || {};
  const onProf = (prof.gifts || []).find(x => x.id === GID);
  ok("§1 the person's profile shows the gift, with the event's name", onProf && onProf.event_id === EV && onProf.event_name === "Lantern Supper Fixture"
     && cents(prof.total_giving) === 25000, { gift: onProf, total: prof.total_giving });

  const cleared = await api("PUT", `/gifts/${GID}`, tok, { eventId: "" });
  const e2 = await eventRead(tok, EV);
  ok("§1 clearing the event on an edit takes it off the event", cleared.status === 200 && e2.money.raisedCents === 0
     && cents(((e2.attendees || []).find(a => a.donor_id === D) || {}).event_given) === 0, e2.money);
  await api("PUT", `/gifts/${GID}`, tok, { eventId: EV });
  ok("§1 and setting it again puts it back", (await eventRead(tok, EV)).money.raisedCents === 25000);

  const del = await api("DELETE", `/gifts/${GID}`, tok);
  const e3 = await eventRead(tok, EV), r3 = await reportOf(tok, EV);
  const p3 = (await api("GET", `/donors/${D}`, tok)).body || {};
  ok("§1 deleting the gift puts all three back", del.status < 300 && e3.money.raisedCents === 0
     && cents(((e3.attendees || []).find(a => a.donor_id === D) || {}).event_given) === 0
     && inList(r3.guests && r3.guests.cameNoGift, D) && !(p3.gifts || []).some(x => x.id === GID) && cents(p3.total_giving) === 0,
     { del: del.status, money: e3.money, total: p3.total_giving });

  // the importer: a Campaign column naming the event exactly links the gift
  // (dated months back, so on any day they are history, written in the import's own batch)
  const imp = await api("POST", "/gifts/import-history", tok, { gifts: [
    { donorId: D, amount: 75, date: "2026-06-01", type: "cash", campaign: "Lantern Supper Fixture", notes: "" },
    { donorId: D, amount: 40, date: "2026-06-02", type: "cash", campaign: "Lantern Supper", notes: "" }] });
  const linked = await q(`SELECT amount::float AS a, event_id FROM gifts WHERE org_id=$1 AND donor_id=$2 ORDER BY amount DESC`, [ORG, D]);
  ok("§1 an imported gift naming the event exactly is linked; a near name is not", imp.status < 300 && linked.length === 2
     && linked[0].event_id === EV && linked[1].event_id === null, { status: imp.status, body: imp.body, linked });

  // ── §2 · a pledge in installments ────────────────────────────────────────
  console.log("\n§2 $1,200 in 4 monthly installments from Dec 1");
  const H = await person("hal", "Halden Brightwater");
  const pl = await api("POST", `/donors/${H}/pledges`, tok, { amount: "1200", dueDate: "2026-12-01", frequency: "monthly", installmentCount: 4 });
  const PID = pl.body && pl.body.id;
  const inst = await q(`SELECT seq, LEFT(due_date::text,10) AS d, amount::float AS a, paid_gift_id FROM pledge_installments WHERE pledge_id=$1 ORDER BY seq`, [PID]);
  ok("§2 the schedule: 4 × $300, Dec 1, Jan 1, Feb 1, Mar 1", pl.status === 201 && inst.map(i => `${i.d}:${i.a}`).join(" ")
     === "2026-12-01:300 2027-01-01:300 2027-02-01:300 2027-03-01:300", inst);
  const { generateInstallments, scheduleWords } = await import("../shared/depositSheet.js");
  const uneven = generateInstallments({ amountCents: 100000, frequency: "monthly", count: 3, firstDue: "2026-12-01" });
  ok("§2 the preview the form shows, from the same generator", scheduleWords(generateInstallments({ amountCents: 120000, frequency: "monthly", count: 4, firstDue: "2026-12-01" }))
     === "4 × $300, Dec 1, Jan 1, Feb 1, Mar 1");
  ok("§2 an uneven split: the remainder rides the last", uneven.map(r => r.amountCents).join(",") === "33333,33333,33334", uneven);
  const wk = generateInstallments({ amountCents: 30000, frequency: "weekly", count: 3, firstDue: "2026-12-29" });
  ok("§2 weekly steps a week at a time, across the year end", wk.map(r => r.dueDate).join(",") === "2026-12-29,2027-01-05,2027-01-12", wk);

  const pay = await api("POST", `/donors/${H}/gifts`, tok, { amount: "300", date: "2026-11-04", pledgeId: PID, payment_method: "Check" });
  const after = await q(`SELECT seq, paid_gift_id FROM pledge_installments WHERE pledge_id=$1 ORDER BY seq`, [PID]);
  ok("§2 a $300 payment marks the FIRST installment paid (oldest due first)", pay.status === 201 && after[0].paid_gift_id === pay.body.gift.id
     && after.slice(1).every(i => !i.paid_gift_id), after);
  const dueRows = (await api("GET", `/figures/pledges-due/rows?to=2027-01-15&pageSize=200`, tok)).body || {};
  const due = (dueRows.rows || []).filter(r => r.id === PID || r.pledgeId === PID || r.donor_id === H || r.donorId === H);
  ok("§2 Pledged, due by Jan 15 is $300", due.length === 1 && cents(due[0].amount) === 30000, dueRows.rows);
  const profPl = ((await api("GET", `/donors/${H}/pledges`, tok)).body || []).find(x => x.id === PID) || {};
  ok("§2 the profile's pledge: $300 paid, the first installment paid, three to come", cents(profPl.paid) === 30000
     && (profPl.installments || []).map(i => i.paid).join(",") === "true,false,false,false", profPl.installments);

  const replan = await api("PUT", `/pledges/${PID}/installments`, tok, { frequency: "quarterly", installmentCount: 2, firstDue: "2026-12-01" });
  const rp = await q(`SELECT seq, LEFT(due_date::text,10) AS d, amount::float AS a, paid_gift_id FROM pledge_installments WHERE pledge_id=$1 ORDER BY seq`, [PID]);
  ok("§2 re-planning keeps the payment applied: $300 paid, the rest on the new plan, to the cent", replan.status === 200
     && rp[0].paid_gift_id === pay.body.gift.id && rp[0].a === 300 && rp.reduce((s, i) => s + cents(i.a), 0) === 120000
     && rp.filter(i => i.paid_gift_id).length === 1, rp);

  // ── §3 · a grant's payment received ──────────────────────────────────────
  console.log("\n§3 $10,000 received on a $15,000 award");
  const F = await person("fdn", "Thistledown Fixture Foundation", "org");
  await q(`INSERT INTO grants (id,org_id,funder,funder_donor_id,program,status,amount,amount_requested,received,created_by,created_by_name)
           VALUES ($1,$2,'Thistledown Fixture Foundation',$3,'Reading rooms','submitted',15000,15000,0,'system:test','test')`, [P("gr"), ORG, F]);
  const aw = await api("PUT", `/grants/${P("gr")}/award`, tok, { amountAwarded: "15000.00", firstDue: "2026-11-01" });
  const plan0 = (await api("GET", `/grants/${P("gr")}/award-plan`, tok)).body || {};
  ok("§3 the award is recorded, a pledge on the funder", aw.status === 200 && plan0.pledge && plan0.funderId === F, plan0);
  const gp = await api("POST", `/donors/${F}/gifts`, tok, { amount: "10000.00", date: "2026-11-03", payment_method: "ACH / bank transfer", pledgeId: plan0.pledge.id });
  const GP = gp.body && gp.body.gift && gp.body.gift.id;
  const plan1 = (await api("GET", `/grants/${P("gr")}/award-plan`, tok)).body || {};
  const grantRow = ((await api("GET", "/grants", tok)).body || []).find(x => x.id === P("gr")) || {};
  ok("§3 the grant: $10,000 received, $5,000 remaining", gp.status === 201 && plan1.receivedCents === 1000000 && plan1.outstandingCents === 500000
     && cents(grantRow.received) === 1000000 && cents(grantRow.remaining) === 500000, { plan: plan1, row: { received: grantRow.received, remaining: grantRow.remaining } });
  const fp = (await api("GET", `/donors/${F}`, tok)).body || {};
  ok("§3 the funder's profile shows the gift", (fp.gifts || []).some(x => x.id === GP && cents(x.amount) === 1000000 && x.pledge_id === plan0.pledge.id), fp.gifts);
  const [fin] = await q(`SELECT amount::float AS a, type FROM fin_transactions WHERE org_id=$1 AND gift_id=$2`, [ORG, GP]);
  ok("§3 Finance has the income", fin && cents(fin.a) === 1000000 && /income|revenue|deposit/i.test(String(fin.type)), fin);
  await api("PUT", `/grants/${P("gr")}`, tok, { funder: "Thistledown Fixture Foundation", program: "Reading rooms", amount: 15000, received: 99999, status: "awarded" });
  const [typedNow] = await q(`SELECT received::float AS r FROM grants WHERE id=$1`, [P("gr")]);
  ok("§3 the edit no longer writes a typed Received", typedNow && typedNow.r === 0, typedNow);

  console.log("\n§3 the typed-Received script");
  await q(`UPDATE grants SET received=12500 WHERE id=$1`, [P("gr")]);   // typed before GIFTS-1: $2,500 more than recorded
  await q(`INSERT INTO grants (id,org_id,funder,program,status,amount,received,created_by,created_by_name)
           VALUES ($1,$2,'Unlinked Fixture Trust','Garden','awarded',4000,4000,'system:test','test')`, [P("gr2"), ORG]);
  const S = require("../scripts/ops/gifts1-grant-received");
  const pg = new Client({ connectionString: process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest" });
  await pg.connect();
  const lines = [];
  const giftsBefore = (await q(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1`, [ORG]))[0].n;
  const dry = await S.run({ client: pg, apply: false, orgId: ORG, log: l => lines.push(l) });
  const giftsDry = (await q(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1`, [ORG]))[0].n;
  const mine = dry.rows.find(r => r.grantId === P("gr")) || {};
  ok("§3 the dry run lists the grant with typed Received, its $2,500 difference, and writes nothing", mine.action === "would_write" && mine.diffCents === 250000
     && giftsDry === giftsBefore && lines.some(l => l.includes(P("gr")) && l.includes("$2,500.00")), lines);
  ok("§3 a typed Received with no award on a funder is left for a person", (dry.rows.find(r => r.grantId === P("gr2")) || {}).action === "left", dry.rows);
  // --apply, through the app's own recordGift, in its own process (as Jonathan runs it)
  const { execFileSync } = require("child_process");
  const applyOut = execFileSync(process.execPath, [path.join(__dirname, "..", "scripts", "ops", "gifts1-grant-received.js"), "--apply", `--org=${ORG}`],
    { env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest", GIFTS1_SCRIPT_PORT: "0" },
      encoding: "utf8", timeout: 180000 });
  const wrote = await q(`SELECT id, amount::float AS a, LEFT(date::text,10) AS d, pledge_id, notes, created_by FROM gifts WHERE org_id=$1 AND external_id=$2`, [ORG, S.extId(P("gr"))]);
  const plan2 = (await api("GET", `/grants/${P("gr")}/award-plan`, tok)).body || {};
  ok("§3 apply writes one $2,500 payment from the funder on the award, marked, with its actor", wrote.length === 1 && cents(wrote[0].a) === 250000
     && wrote[0].pledge_id === plan0.pledge.id && /from typed Received/.test(wrote[0].notes) && /^system:scripts\/ops\/gifts1-grant-received/.test(wrote[0].created_by)
     && plan2.receivedCents === 1250000, { wrote, received: plan2.receivedCents, out: applyOut.slice(-400) });
  const again = await S.run({ client: pg, apply: true, orgId: ORG, log: () => {}, writers: { recordGift: () => { throw new Error("a second run must not write"); } } });
  const giftsAfter = (await q(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1`, [ORG]))[0].n;
  ok("§3 a second run writes nothing", again.written === 0 && !again.rows.some(r => r.grantId === P("gr")) && giftsAfter === giftsBefore + 1, again);
  await pg.end();

  // ── §4 · the attendee menu prefills the person and the event ────────────
  console.log("\n§4 Record a gift from the attendee menu");
  const why = (() => {
    if (!fs.existsSync(path.join(DIST, "assets"))) return "client/dist not built";
    const apiHost = (process.env.BASE || "http://localhost:5601").replace(/^https?:\/\//, "");
    const js = fs.readdirSync(path.join(DIST, "assets")).filter(f => f.endsWith(".js"));
    if (!js.some(f => fs.readFileSync(path.join(DIST, "assets", f), "utf8").includes(apiHost))) return "client/dist not built against the local API";
    try { require(PW); } catch { return "Playwright not found (set PLAYWRIGHT_DIR)"; }
    return null;
  })();
  if (!browserLegOrSkip(why, "(browser leg)")) {
    const lg = await api("POST", "/auth/login", null, { email: EMAIL, password: "loadtest1234" });
    const { chromium } = require(PW);
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      await page.addInitScript(([tk, u, o]) => {
        localStorage.setItem("npe_token", tk); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o);
      }, [lg.body.token, JSON.stringify(lg.body.user), JSON.stringify(lg.body.org)]);
      await page.goto(`${APP}/app/events?event=${EV}`, { waitUntil: "networkidle", timeout: 60000 });
      await page.getByRole("button", { name: "⋯" }).first().click({ timeout: 20000 });
      await page.getByText("Record a gift", { exact: true }).last().click({ timeout: 10000 });
      const dlg = page.locator('[data-testid="ev-gift"]');
      await dlg.waitFor({ timeout: 10000 });
      await dlg.locator(`[data-testid="ev-gift-event"] option[value="${EV}"]`).waitFor({ state: "attached", timeout: 10000 }).catch(() => {});
      const who = (await dlg.locator('[data-testid="ev-gift-who"]').inputValue().catch(() => "")) || "";
      const evPicked = await dlg.locator('[data-testid="ev-gift-event"]').inputValue().catch(() => "");
      ok("§4 the dialog opens with the person and the event filled in", who === "Mara Quillfeather" && evPicked === EV, { who, evPicked });
    } finally { await browser.close(); }
  }

  await reset();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch { /* closing */ } process.exit(1); });
