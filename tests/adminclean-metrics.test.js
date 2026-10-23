// ADMIN-CLEAN · THE CONSOLE COUNTS ONLY WHAT IS REAL.
//
// THE ONE TEST THIS BUILD ADDS, and it guards money: the super-admin Metrics
// counted the two demo orgs as $998 of MRR while Steward had no paying
// customer, and its delete would remove an org with a live subscription.
//
// WHAT WOULD MAKE THIS FAIL (each planted and watched go red):
//   · MRR from a plan's list price again (PLAN_MRR[o.plan])      → §1 fails
//   · a demo org with a plan counted in MRR                       → §1 fails
//   · the webhook not recording the subscription's real amount    → §2 fails
//   · dropping the delete guard                                   → §3 fails
//   · the cleanup script writing on a dry run                     → §4 fails
//   · archive not hiding the org, or restore not bringing it back → §5 fails
//   · billing mail allowed for an internal test org               → §6 fails
//   · Kind changed off Demo while the old demo flag stays set, so
//     the Email section still says "demonstration organization"   → §7 fails
//   · the panel not re-reading its Email section after a Kind save → §7 fails
//
// Run on the scratch stack: BASE, DATABASE_URL (see tests/run-all.sh).

const bcrypt = require("bcryptjs");
const path = require("path");
const { execFileSync } = require("child_process");
const { ok, summary, login, api, q, closeDb, BASE } = require("./helpers");
const ORG_KIND = require("../orgKind");
const mailPolicy = require("../mailPolicy");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY || "sk_test_dummy");
const SECRET = process.env.STRIPE_BILLING_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";

const HQ = "org_acm_hq", PAY = "org_acm_paying", DEMO = "org_acm_demo", EMPTY = "org_acm_empty", JUNK = "org_acm_junk";
const FLAG = "org_acm_flag";
const ORGS = [HQ, PAY, DEMO, EMPTY, JUNK, FLAG];
const SUPER = "acm-super@t.local", PW = "loadtest1234";

async function reset() {
  await q(`DELETE FROM platform_payments WHERE org_id = ANY($1)`, [ORGS]).catch(() => {});
  await q(`DELETE FROM users WHERE org_id = ANY($1)`, [ORGS]).catch(() => {});
  await q(`DELETE FROM donors WHERE org_id = ANY($1)`, [ORGS]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id = ANY($1)`, [ORGS]).catch(() => {});
}

async function seed() {
  await reset();
  const hash = bcrypt.hashSync(PW, 10);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,org_kind)
           VALUES ($1,'ACM Console HQ','acm-console-hq',1,'trialing','trial','internal_test')`, [HQ]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin)
           VALUES ('u_acm_super',$1,$2,$3,'Jonathan','admin',true)`, [HQ, SUPER, hash]);
  // A paying customer on the $499 plan whose Stripe subscription really
  // charges $123: MRR must say $123. Its login is a real-looking address so
  // the kind is inferred from the subscription, not set.
  // (Not "Riverbend": ONBOARD-1 seeds a demo org by that name, and two orgs
  // with one name is the cleanup's DECIDE rule, not the KEEP this checks.)
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,stripe_customer_id,stripe_subscription_id)
           VALUES ($1,'Millbrook Food Pantry','acm-millbrook',1,'trialing','team','cus_acm_paying','sub_acm_paying')`, [PAY]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_acm_pay',$1,'director@riverbend-pantry.org',$2,'Dee','admin')`, [PAY, hash]);
  // A demo org "on" Team, active, with a subscription id and an amount: the
  // exact shape that put Harborlight and CREO into MRR.
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,is_demo_org,stripe_subscription_id,billing_mrr_cents)
           VALUES ($1,'Lakeside Arts Collective','acm-lakeside',1,'active','team',true,'sub_acm_demo',49900)`, [DEMO]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_acm_demo',$1,'director@lakeside-arts.org',$2,'Lee','admin')`, [DEMO, hash]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
           VALUES ($1,'Hillcrest Youth Choir','acm-hillcrest',1,'trialing','trial')`, [EMPTY]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_acm_empty',$1,'office@hillcrest-choir.org',$2,'Hal','admin')`, [EMPTY, hash]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
           VALUES ($1,'ACM-9 Walk (fixture)','acm-walk',1,'trialing','trial')`, [JUNK]);
  // Justin's Place on prod (23 Oct): a real org carrying the old demo flag,
  // donor mail on, onboarded. Kind is the one control the console shows.
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,is_demo_org,org_kind,emails_enabled,onboarded_at)
           VALUES ($1,'Corner House Ministries','acm-corner',1,'trialing','trial',true,'demo',true,NOW())`, [FLAG]);
}

async function fireBilling(id, type, object) {
  const payload = JSON.stringify({ id, type, data: { object } });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
  const r = await fetch(BASE + "/billing/webhook", {
    method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": header }, body: payload,
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

const snapshot = async () => JSON.stringify(await q(
  `SELECT id, name, org_kind, archived_at, subscription_status FROM orgs ORDER BY id`));

(async () => {
  await seed();
  const supr = await login(SUPER);

  console.log("§2 · the webhook records what Stripe really charges");
  const evt = "evt_acm_" + Date.now();
  const sub = await fireBilling(evt + "_sub", "customer.subscription.updated", {
    id: "sub_acm_paying", object: "subscription", customer: "cus_acm_paying", status: "active",
    current_period_end: Math.floor(Date.now() / 1000) + 20 * 86400,
    items: { data: [{ quantity: 1, price: { id: "price_test_team", unit_amount: 12300, recurring: { interval: "month", interval_count: 1 } } }] },
  });
  ok("the subscription event is accepted", sub.status === 200, sub.status + " " + JSON.stringify(sub.body));
  const inv = await fireBilling(evt + "_inv", "invoice.payment_succeeded", {
    id: "in_acm_paying_1", object: "invoice", customer: "cus_acm_paying", amount_paid: 12300, billing_reason: "subscription_cycle",
    created: Math.floor(Date.now() / 1000) - 5 * 86400,
    lines: { data: [{ amount: 12300, period: { start: Math.floor(Date.now() / 1000) - 10 * 86400, end: Math.floor(Date.now() / 1000) + 20 * 86400 },
                      price: { unit_amount: 12300, recurring: { interval: "month", interval_count: 1 } } }] },
  });
  ok("the paid invoice is accepted", inv.status === 200, inv.status);
  const [paid] = await q(`SELECT billing_mrr_cents, subscription_status FROM orgs WHERE id=$1`, [PAY]);
  ok("the org's MRR is the subscription's $123, not Team's $499 list price", Number(paid.billing_mrr_cents) === 12300, paid.billing_mrr_cents);
  ok("…and it is active", paid.subscription_status === "active", paid.subscription_status);
  const pays = await q(`SELECT amount_paid_cents, monthly_cents, created_by FROM platform_payments WHERE org_id=$1`, [PAY]);
  ok("one platform payment row, $123, stamped with a system actor",
     pays.length === 1 && Number(pays[0].amount_paid_cents) === 12300 && pays[0].created_by === "system:billing-webhook", JSON.stringify(pays));
  const again = await fireBilling(evt + "_inv2", "invoice.payment_succeeded", {
    id: "in_acm_paying_1", object: "invoice", customer: "cus_acm_paying", amount_paid: 12300, billing_reason: "subscription_cycle", lines: { data: [] } });
  const pays2 = await q(`SELECT COUNT(*)::int AS c FROM platform_payments WHERE org_id=$1`, [PAY]);
  ok("the same invoice twice is still one payment", again.status === 200 && pays2[0].c === 1, pays2[0].c);
  const zero = await fireBilling(evt + "_inv0", "invoice.payment_succeeded", {
    id: "in_acm_empty_0", object: "invoice", customer: "cus_none", metadata: { orgId: EMPTY }, amount_paid: 0, billing_reason: "subscription_create", lines: { data: [] } });
  const pays0 = await q(`SELECT COUNT(*)::int AS c FROM platform_payments WHERE org_id=$1`, [EMPTY]);
  ok("a $0 trial-start invoice is not a payment", zero.status === 200 && pays0[0].c === 0, pays0[0].c);

  console.log("\n§1 · Metrics counts the paying customer and ignores the demo");
  const m = await api("GET", "/admin/metrics", supr);
  ok("Metrics answers", m.status === 200, m.status);
  const mrrRows = m.body.rows?.mrr || [];
  const payRow = mrrRows.find(r => r.id === PAY);
  ok("the paying customer is in MRR's rows at $123", payRow && payRow.monthly_revenue_cents === 12300, JSON.stringify(payRow));
  ok("…as a Customer, inferred from the subscription", payRow && payRow.kind === "customer", payRow && payRow.kind);
  ok("the demo org with a plan, a subscription id and $499 is NOT in MRR", !mrrRows.some(r => r.id === DEMO), mrrRows.map(r => r.id));
  ok("…it is in the left-out rows as a Demo", (m.body.rows?.left_out || []).some(r => r.id === DEMO && r.kind === "demo"));
  ok("…and so is Jonathan's own org, as an Internal test", (m.body.rows?.left_out || []).some(r => r.id === HQ && r.kind === "internal_test"));
  ok("…and the walk fixture, as a Fixture", (m.body.rows?.left_out || []).some(r => r.id === JUNK && r.kind === "fixture"));
  ok("MRR foots to its rows to the cent", m.body.mrr_cents === mrrRows.reduce((s, r) => s + r.monthly_revenue_cents, 0),
     m.body.mrr_cents + " vs rows");
  ok("paying customers is the count of those rows", m.body.paying_customers === (m.body.rows?.paying || []).length);
  ok("ARR is MRR times twelve", Math.abs(m.body.arr - m.body.mrr * 12) < 0.001);
  ok("Metrics says in one line how many it left out",
     /^Left out \d+ org/.test(m.body.left_out_sentence || "") && m.body.left_out_count === (m.body.rows?.left_out || []).length,
     m.body.left_out_sentence);
  const month = new Date().toISOString().slice(0, 7);
  const thisMonth = (m.body.by_month || []).find(r => r.month === month);
  ok("MRR by month counts the paid invoice this month", thisMonth && thisMonth.customers >= 1 && thisMonth.mrr_cents >= 12300, JSON.stringify(thisMonth));
  const dec = (m.body.by_month || []).find(r => r.month === "2026-12");
  ok("the default plan line reads 8 customers at December 2026", dec && dec.target === 8, JSON.stringify(dec));
  const tgt = await api("POST", "/admin/metrics/target", supr, { startMonth: "2026-12", startCustomers: 10, monthlyNet: 4, through: "2027-12" });
  const m2 = await api("GET", "/admin/metrics", supr);
  const feb = (m2.body.by_month || []).find(r => r.month === "2027-02");
  ok("Jonathan can set the plan line (10 by Dec, then 4 a month: 18 by Feb)", tgt.status === 200 && feb && feb.target === 18, JSON.stringify(feb));
  await q(`DELETE FROM admin_settings WHERE key='mrr_target'`);
  const list = await api("GET", "/admin/orgs", supr);
  const demoRow = (list.body || []).find(o => o.id === DEMO);
  ok("the org list shows the demo org's MRR as $0, not $499", demoRow && demoRow.monthly_revenue === 0 && demoRow.kind === "demo", JSON.stringify(demoRow && { k: demoRow.kind, m: demoRow.monthly_revenue }));

  console.log("\n§3 · an org with a Stripe subscription can't be deleted");
  const del = await api("DELETE", "/admin/orgs/" + PAY, supr, { confirm: true, confirmName: "Millbrook Food Pantry" });
  const still = await q(`SELECT id FROM orgs WHERE id=$1`, [PAY]);
  ok("delete is refused with 409 and says why", del.status === 409 && /subscription/.test(del.body.message || ""), del.status + " " + JSON.stringify(del.body));
  ok("…and the org is still there", still.length === 1);
  const noName = await api("DELETE", "/admin/orgs/" + EMPTY, supr, { confirm: true });
  ok("an empty org asks twice: without its name typed, nothing is deleted",
     noName.status === 400 && (await q(`SELECT id FROM orgs WHERE id=$1`, [EMPTY])).length === 1, noName.status);
  await q(`INSERT INTO donors (id, org_id, name, is_sample) VALUES ('d_acm_real', $1, 'Real Person', false)`, [EMPTY]);
  const realDel = await api("DELETE", "/admin/orgs/" + EMPTY, supr, { confirm: true, confirmName: "Hillcrest Youth Choir" });
  ok("an org with one real donor can't be deleted either", realDel.status === 409 && /real/.test(realDel.body.message || ""), realDel.status);
  await q(`DELETE FROM donors WHERE id='d_acm_real'`);

  console.log("\n§4 · the cleanup dry run changes nothing");
  const before = await snapshot();
  const auditBefore = (await q(`SELECT COUNT(*)::int AS c FROM fin_audit_log WHERE user_id='system:scripts/admin-clean'`))[0].c;
  const out = execFileSync("node", [path.join(__dirname, "..", "scripts", "admin-clean.js")],
    { env: { ...process.env }, encoding: "utf8", timeout: 60000 });
  ok("the dry run says it is a dry run", /DRY RUN/.test(out) && /nothing was changed/i.test(out), out.slice(0, 200));
  ok("…prints the walk fixture for delete, by name and id", new RegExp(`DELETE\\s+Fixture\\s+${JUNK}\\s+ACM-9 Walk`).test(out));
  ok("…never proposes deleting the paying customer", !new RegExp(`DELETE\\s+\\S+( \\S+)?\\s+${PAY}`).test(out)
     && new RegExp(`KEEP\\s+Customer\\s+${PAY}`).test(out));
  ok("…and keeps the internal test org", new RegExp(`KEEP\\s+Internal test\\s+${HQ}`).test(out));
  // ONBOARD-1: Riverbend is a demo seeded BEFORE setup, so it has no donor;
  // the cleanup proposed deleting it until it joined the demo list.
  ok("…and keeps the Riverbend demo, which is empty on purpose",
     !/DELETE\s+\S+\s+org_riverbend_demo/.test(out) && (!/org_riverbend_demo/.test(out) || /KEEP\s+Demo\s+org_riverbend_demo/.test(out)), out.split("\n").filter(l => /riverbend/.test(l)));
  ok("nothing in orgs changed", (await snapshot()) === before);
  ok("…and no audit row was written",
     (await q(`SELECT COUNT(*)::int AS c FROM fin_audit_log WHERE user_id='system:scripts/admin-clean'`))[0].c === auditBefore);
  const plan = require("../scripts/admin-clean").decide;
  const guarded = plan({ id: "org_x", name: "f", stripe_subscription_id: "sub_1" }, { users: [{ email: "xjca2006+f@gmail.com" }], payments: 0, realDonors: 0 });
  ok("a junk org with a Stripe subscription is archived, never deleted", guarded.action === "archive", JSON.stringify(guarded));

  console.log("\n§5 · archive hides an org and undo brings it back");
  const arc = await api("POST", `/admin/orgs/${EMPTY}/archive`, supr, {});
  const l1 = await api("GET", "/admin/orgs", supr);
  const m3 = await api("GET", "/admin/metrics", supr);
  const e1 = l1.body.find(o => o.id === EMPTY);
  ok("archive answers", arc.status === 200, arc.status);
  ok("the org is archived and no longer counted", e1.archived === true && e1.counted === false);
  ok("…Metrics leaves it out as archived", !(m3.body.rows?.counted || []).some(r => r.id === EMPTY)
     && (m3.body.rows?.left_out || []).some(r => r.id === EMPTY));
  const un = await api("POST", `/admin/orgs/${EMPTY}/unarchive`, supr, {});
  const l2 = await api("GET", "/admin/orgs", supr);
  const e2 = l2.body.find(o => o.id === EMPTY);
  ok("undo brings it back, counted again", un.status === 200 && e2.archived === false && e2.counted === true, JSON.stringify({ a: e2.archived, c: e2.counted }));
  const audit = await q(`SELECT action FROM fin_audit_log WHERE request_path LIKE $1 ORDER BY created_at`, [`/admin/orgs/${EMPTY}/%archive`]).catch(() => []);
  ok("both are on the audit trail", audit.length >= 2, audit.length);

  console.log("\n§6 · Jonathan's orgs never get billing mail");
  ok("billing mail to an internal test org is refused",
     mailPolicy.orgMailDecision({ id: HQ, org_kind: "internal_test", onboarded_at: new Date() }, "billing").send === false);
  ok("…and to a fixture", mailPolicy.orgMailDecision({ id: JUNK, org_kind: "fixture" }, "billing").send === false);
  ok("…but a customer still gets it", mailPolicy.orgMailDecision({ id: PAY, org_kind: "customer", onboarded_at: new Date() }, "billing").send === true);
  ok("a +alias of Jonathan's address is Jonathan",
     ORG_KIND.inferKind({ id: "o", name: "Lit & culture" }, { users: [{ email: "xjca2006+lit@gmail.com" }] }).kind === "internal_test");
  const kindSet = await api("POST", `/admin/orgs/${EMPTY}/kind`, supr, { kind: "fixture" });
  const l3 = await api("GET", "/admin/orgs", supr);
  ok("a kind set in /admin wins over the guess", kindSet.status === 200 && l3.body.find(o => o.id === EMPTY).kind_source === "set"
     && l3.body.find(o => o.id === EMPTY).kind === "fixture");

  // §7 · KIND AND THE DEMO FLAG ARE ONE THING. Turning an org's Kind off Demo
  // must unlock its Email section; the old is_demo_org flag cannot keep it
  // locked behind the operator's back, and the mail it reads is read again.
  const s7m0 = await api("GET", `/admin/orgs/${FLAG}/mail`, supr);
  ok("§7 a demo-flagged org starts locked", s7m0.status === 200 && s7m0.body.locked === true);
  const toCustomer = await api("POST", `/admin/orgs/${FLAG}/kind`, supr, { kind: "customer" });
  const s7m1 = await api("GET", `/admin/orgs/${FLAG}/mail`, supr);
  ok("§7 Kind set to Customer unlocks the Email section", toCustomer.status === 200 && s7m1.body.locked === false && s7m1.body.demo === false,
     JSON.stringify({ locked: s7m1.body.locked, sentence: s7m1.body.lockedSentence }));
  const [f1] = await q(`SELECT is_demo_org, emails_enabled FROM orgs WHERE id=$1`, [FLAG]);
  ok("§7 …and clears the old demo flag", f1.is_demo_org === false);
  ok("§7 …but donor mail waits for the switch: it does not turn on by itself", f1.emails_enabled === false
     && s7m1.body.donorMailOn === false && s7m1.body.families.donor.sends === false);
  ok("§7 the /kind answer carries the Email section, so the panel can show it", toCustomer.body.mail && toCustomer.body.mail.locked === false);
  await api("POST", `/admin/orgs/${FLAG}/kind`, supr, { kind: "demo" });
  const [f2] = await q(`SELECT is_demo_org FROM orgs WHERE id=$1`, [FLAG]);
  const s7m2 = await api("GET", `/admin/orgs/${FLAG}/mail`, supr);
  ok("§7 Kind set back to Demo locks it again and sets the flag", f2.is_demo_org === true && s7m2.body.locked === true);
  await api("POST", `/admin/orgs/${FLAG}/kind`, supr, { kind: null });
  const s7m3 = await api("GET", `/admin/orgs/${FLAG}/mail`, supr);
  ok("§7 Steward's guess on a flagged org stays Demo, and says so", s7m3.body.locked === true);
  const panel = require("fs").readFileSync(path.join(__dirname, "../client/src/pages/AdminDashboard.jsx"), "utf8");
  const saveKind = (panel.match(/async function saveKind\([\s\S]*?\n  \}\n/) || [""])[0];
  ok("§7 the panel re-reads its Email section after a Kind save", /setMail\(/.test(saveKind) && /\/mail/.test(saveKind));

  await reset();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
