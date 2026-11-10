// tests/onboard1-paper-and-preview.test.js · ONBOARD-1. PAPER AND DATA IN.
//
// Stage 1, the start link on a fixture org: the agreement record is stored
// with its SHA-256, Checkout is mocked, the trial ends on the fixed date, and
// nothing is charged. The link is single use and it expires. A $0 price still
// saves the card (setup mode). Signature and card are one gate.
//
// Stage 2, a staged import: invisible to every count until Accepted. The
// Verify page foots a fixture file with set-aside rows to the cent. "These
// match" makes it live; Undo before accepting leaves nothing behind.
//
// THE PLANTED DEFECT (ONBOARD1_PLANT=everyone): staging tags the batch but
// leaves its people live, so Everyone counts them. §6 goes red.
//
// Fake fixtures only, made-up names. The billing Stripe is a local mock that
// records every request, so "nothing is charged" is a statement about what
// Stripe was asked, not what the route answered.
const http = require("http");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, BILLING_MOCK_PORT, civilPlusDays } = require("./helpers");
const { testNow } = require("./clock");
const { assertSurfacesAgree } = require("./lib/surfacesAgree");

const SECRET = "whsec_localtest";
const stripe = require("stripe")("sk_test_dummy");
const PASS = "loadtest1234";
const ORG_P = "org_onb1paper", ORG_Z = "org_onb1zero", ORG_X = "org_onb1expire";
const ORG_S = "org_onb1stage", ORG_U = "org_onb1undo";
const SUPER = "onb1-super@example.org", STAFF = "onb1-staff@example.org";
const ADMIN_P = "onb1-paper-admin@example.org", ADMIN_S = "onb1-stage-admin@example.org", ADMIN_U = "onb1-undo-admin@example.org";
const PLANT = process.env.ONBOARD1_PLANT || "";

// ── The billing Stripe mock: answers what the routes ask, and remembers it ──
const seen = [];
const FIRST_CHARGE = civilPlusDays(60);            // tests set their own clock
const TRIAL_END = Math.floor(Date.parse(FIRST_CHARGE + "T17:00:00Z") / 1000);
function startBillingMock(port = BILLING_MOCK_PORT) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", c => b += c);
      req.on("end", () => {
        seen.push({ method: req.method, url: req.url, form: new URLSearchParams(b) });
        res.setHeader("Content-Type", "application/json");
        const send = o => res.end(JSON.stringify(o));
        if (req.method === "POST" && req.url.startsWith("/v1/checkout/sessions")) {
          const id = "cs_test_onb1_" + seen.length;
          return send({ id, object: "checkout.session", url: "https://checkout.stripe.test/" + id });
        }
        if (req.method === "GET" && /^\/v1\/prices\//.test(req.url)) {
          const id = req.url.split("/")[3].split("?")[0];
          return send({ id, object: "price", product: "prod_test_steward", unit_amount: 19900, currency: "usd", recurring: { interval: "month", interval_count: 1 } });
        }
        if (req.method === "GET" && /^\/v1\/subscriptions\//.test(req.url)) {
          return send({ id: "sub_onb1", object: "subscription", status: "trialing", trial_start: Math.floor(testNow() / 1000), trial_end: TRIAL_END,
            metadata: { plan: "r500_monthly" }, items: { data: [{ price: { id: "price_inline", unit_amount: 14900, recurring: { interval: "month" } } }] },
            default_payment_method: { id: "pm_1", card: { brand: "visa", last4: "4242" } } });
        }
        if (req.method === "GET" && /^\/v1\/setup_intents\//.test(req.url)) {
          return send({ id: "seti_onb1", object: "setup_intent", payment_method: { id: "pm_2", card: { brand: "mastercard", last4: "5454" } } });
        }
        if (req.method === "POST" && req.url.startsWith("/v1/customers")) return send({ id: "cus_onb1_new", object: "customer" });
        if (req.method === "GET" && req.url.startsWith("/v1/customers/")) return send({ id: req.url.split("/")[3].split("?")[0], object: "customer" });
        res.statusCode = 404; send({ error: { message: "mock: " + req.method + " " + req.url } });
      });
    });
    srv.listen(port, () => resolve(srv));
  });
}
async function fireBilling(id, type, object) {
  const payload = JSON.stringify({ id, type, data: { object } });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
  const r = await fetch(process.env.BASE + "/billing/webhook", { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": header }, body: payload });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const pub = (method, path, body, headers = {}) => fetch(process.env.BASE + path, {
  method, headers: { "Content-Type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined,
}).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})), type: r.headers.get("content-type") }));
const sha = s => crypto.createHash("sha256").update(s, "utf8").digest("hex");
const tokenOf = url => String(url).split("/start/")[1];

async function wipe(org) {
  const tables = (await q(`SELECT table_name FROM information_schema.columns
                            WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (let pass = 0; pass < 4; pass++) {
    for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [org]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [org]).then(() => true).catch(() => false)) return;
  }
}
async function mkOrg(id, name, extra = "") {
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan${extra ? "," + extra.split("=")[0] : ""})
           VALUES ($1,$2,$3,1,'trialing','trial'${extra ? ",$4" : ""})`,
    extra ? [id, name, id.replace(/_/g, "-"), extra.split("=")[1]] : [id, name, id.replace(/_/g, "-")]);
}
async function mkUser(id, org, email, role = "admin", superAdmin = false) {
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, org, email, bcrypt.hashSync(PASS, 10), email.split("@")[0], role, superAdmin]);
}

(async () => {
  console.log("ONBOARD-1: paper and data in\n");
  const mock = await startBillingMock();
  for (const o of [ORG_P, ORG_Z, ORG_X, ORG_S, ORG_U]) await wipe(o);
  await q(`DELETE FROM users WHERE email LIKE 'onb1-%@example.org'`);

  // The org that already exists and is in use: a custom price, a Stripe customer.
  await mkOrg(ORG_P, "Kestrel Ridge Hope");
  await q(`UPDATE orgs SET custom_price_cents=14900, stripe_customer_id_test='cus_onb1_existing', stripe_customer_id='cus_onb1_existing' WHERE id=$1`, [ORG_P]);
  await mkUser("u_onb1_super", ORG_P, SUPER, "admin", true);
  await mkUser("u_onb1_staff", ORG_P, STAFF, "staff", false);
  await mkUser("u_onb1_admp", ORG_P, ADMIN_P, "admin", false);
  await mkOrg(ORG_Z, "Juniper Pantry");
  await q(`UPDATE orgs SET custom_price_cents=0 WHERE id=$1`, [ORG_Z]);
  await mkOrg(ORG_X, "Sycamore Lane Arts");
  const sup = await login(SUPER), staff = await login(STAFF), admP = await login(ADMIN_P);

  // ── §1 · RAISING A LINK ───────────────────────────────────────────────
  const body = { contactName: "Sara Quill", contactEmail: "sara@kestrel-ridge.example", priceSource: "custom",
    chargeMode: "fixed", firstChargeOn: FIRST_CHARGE, note: "beta" };
  const refused = await api("POST", `/admin/orgs/${ORG_P}/start-links`, staff, body);
  ok("§1 a staff user cannot raise a start link", refused.status === 403, refused);
  const made = await api("POST", `/admin/orgs/${ORG_P}/start-links`, sup, body);
  ok("§1 the super-admin raises one: /start/<token>, the org's custom price, the fixed date",
    made.status === 201 && /\/start\/[A-Za-z0-9_-]{20,}$/.test(made.body.url) && made.body.priceUsd === 149 && made.body.firstChargeOn === FIRST_CHARGE, made.body);
  const token = tokenOf(made.body.url);
  const [linkRow] = await q(`SELECT * FROM start_links WHERE id=$1`, [made.body.id]);
  ok("§1 the token is stored only as its hash, and the link lives 14 days",
    linkRow && linkRow.token_hash !== token && !JSON.stringify(linkRow).includes(token)
      && Math.round((new Date(linkRow.expires_at) - new Date(linkRow.created_at)) / 86400000) === 14, linkRow);
  const again = await api("POST", `/admin/orgs/${ORG_P}/start-links`, sup, body);
  ok("§1 a second open link for the same org is refused (two signatures would be two subscriptions)", again.status === 409 && again.body.error === "start_link_open", again.body);

  // ── §2 · THE PAGE, AND A GET THAT CHANGES NOTHING ─────────────────────
  const page = await pub("GET", `/public/start/${token}`);
  const page2 = await pub("GET", `/public/start/${token}`);
  const [afterGets] = await q(`SELECT status, signed_at FROM start_links WHERE id=$1`, [made.body.id]);
  ok("§2 the page carries the org's name and the order form with name, price, date and cancel terms filled in",
    page.status === 200 && page.body.orgName === "Kestrel Ridge Hope" && page.body.agreement.text.includes("Kestrel Ridge Hope")
      && page.body.agreement.text.includes("$149 a month") && page.body.agreement.text.includes(page.body.firstChargeDate)
      && /Cancel any time before .* you pay nothing/.test(page.body.agreement.text) && !/\{\{/.test(page.body.agreement.text), page.body);
  ok("§2 the hash on the page is the SHA-256 of the exact text on the page", page.body.agreement.sha256 === sha(page.body.agreement.text));
  ok("§2 opening it twice changes nothing (a GET never writes)", afterGets.status === "open" && afterGets.signed_at === null && page2.body.agreement.sha256 === page.body.agreement.sha256);

  // ── §3 · SHE SIGNS: THE CLICK-WRAP RECORD, THEN CHECKOUT ──────────────
  const noAgree = await pub("POST", `/public/start/${token}/sign`, { name: "Sara Quill", title: "Executive Director", agree: false, sha256: page.body.agreement.sha256 });
  ok("§3 no \"I agree\", no signature", noAgree.status === 400 && noAgree.body.error === "agree_required", noAgree.body);
  const stale = await pub("POST", `/public/start/${token}/sign`, { name: "Sara Quill", title: "Executive Director", agree: true, sha256: sha("other text") });
  ok("§3 a signature over text that is not what the page shows is refused, and the page is handed the real text",
    stale.status === 409 && stale.body.error === "agreement_changed" && stale.body.agreement.sha256 === page.body.agreement.sha256, stale.body);
  const before = seen.length;
  const signed = await pub("POST", `/public/start/${token}/sign`,
    { name: "Sara Quill", title: "Executive Director", agree: true, sha256: page.body.agreement.sha256 },
    { "User-Agent": "Onb1Browser/1.0", "X-Forwarded-For": "203.0.113.9" });
  ok("§3 signing returns a Stripe Checkout URL", signed.status === 200 && /^https:\/\/checkout\.stripe\.test\//.test(signed.body.checkoutUrl), signed.body);
  const [sig] = await q(`SELECT * FROM start_signatures WHERE start_link_id=$1`, [made.body.id]);
  ok("§3 the record holds name, title, email, time, IP, user agent, version and the SHA-256 of the exact rendered text",
    sig && sig.signer_name === "Sara Quill" && sig.signer_title === "Executive Director" && sig.signer_email === "sara@kestrel-ridge.example"
      && sig.signed_at && sig.ip === "203.0.113.9" && sig.user_agent === "Onb1Browser/1.0" && sig.agreement_version === "2026-11-09"
      && sig.text_sha256 === page.body.agreement.sha256 && sha(sig.rendered_text) === sig.text_sha256 && sig.created_by === "system:onboard/start-link", sig);
  const upd = await q(`UPDATE start_signatures SET signer_name='Someone Else' WHERE id=$1`, [sig.id]).then(() => "updated", e => e.message);
  ok("§3 the signature cannot be edited afterwards (append-only)", /append-only/.test(upd), upd);
  const cs = seen.slice(before).find(r => r.method === "POST" && r.url.startsWith("/v1/checkout/sessions"));
  const f = cs ? cs.form : new URLSearchParams();
  ok("§3 Checkout is subscription mode on the org's EXISTING Stripe customer, trial_end = the first charge date",
    f.get("mode") === "subscription" && f.get("customer") === "cus_onb1_existing"
      && Number(f.get("subscription_data[trial_end]")) > 0
      && new Date(Number(f.get("subscription_data[trial_end]")) * 1000).toISOString().slice(0, 10) === FIRST_CHARGE, Object.fromEntries(f));
  ok("§3 the line is the org's custom $149 on the band's own product: no new product, no setup fee",
    f.get("line_items[0][price_data][unit_amount]") === "14900" && f.get("line_items[0][price_data][product]") === "prod_test_steward"
      && f.get("line_items[0][price_data][recurring][interval]") === "month" && !f.get("line_items[1][price]"), Object.fromEntries(f));
  const [paperBefore] = await q(`SELECT paper_done_at FROM orgs WHERE id=$1`, [ORG_P]);
  ok("§3 a signature alone is not paper: the stage waits for the card", paperBefore.paper_done_at === null);
  const resign = await pub("POST", `/public/start/${token}/sign`, { name: "Mallory", title: "Imposter", agree: true, sha256: page.body.agreement.sha256 });
  const sigCount = (await q(`SELECT COUNT(*)::int n FROM start_signatures WHERE start_link_id=$1`, [made.body.id]))[0].n;
  ok("§3 single use: a second visit gets the card step again, never a second signature", resign.status === 200 && sigCount === 1, { resign: resign.body, sigCount });

  // ── §4 · STRIPE SAYS THE CARD WENT IN ─────────────────────────────────
  const wh = await fireBilling(`evt_onb1_${testNow()}`, "checkout.session.completed", {
    id: "cs_test_onb1_done", object: "checkout.session", mode: "subscription", customer: "cus_onb1_existing", subscription: "sub_onb1",
    payment_status: "no_payment_required", metadata: { startLinkId: made.body.id, orgId: ORG_P, plan: "r500_monthly" } });
  const [org] = await q(`SELECT subscription_status, trial_ends_at, stripe_subscription_id, billing_card_last4, paper_done_at, signed_at, plan FROM orgs WHERE id=$1`, [ORG_P]);
  ok("§4 the org is trialing on the subscription, the trial ends on the fixed date (read off Stripe), the card is on file",
    wh.status === 200 && org.subscription_status === "trialing" && org.stripe_subscription_id === "sub_onb1"
      && new Date(org.trial_ends_at).toISOString().slice(0, 10) === FIRST_CHARGE && org.billing_card_last4 === "4242" && org.plan === "r500_monthly", org);
  ok("§4 signature + card = Paper done", !!org.paper_done_at && !!org.signed_at);
  const charges = seen.filter(r => r.method === "POST" && /\/v1\/(invoices|payment_intents|charges)/.test(r.url));
  ok("§4 nothing was charged: Stripe was never asked for an invoice, a payment intent or a charge", charges.length === 0, charges.map(c => c.url));
  const done = await pub("GET", `/public/start/${token}`);
  ok("§4 the confirmation reads exactly as promised",
    done.body.state === "completed" && done.body.confirmation === `Signed. Nothing is charged today. First charge: ${done.body.firstChargeDate}, $149. Cancel any time before then in Settings → Billing and you pay nothing.`, done.body);
  const used = await pub("POST", `/public/start/${token}/sign`, { name: "Sara Quill", title: "ED", agree: true, sha256: page.body.agreement.sha256 });
  ok("§4 the link is used up", used.status === 410 && used.body.error === "completed", used.body);
  const bill = await api("GET", "/billing/status", admP);
  const agr = await api("GET", "/billing/agreement", admP);
  ok("§4 Settings → Billing: the first charge names the custom $149 and the date, the card's last four, Cancel",
    bill.body.firstChargeSentence === `Your first charge is $149 on ${done.body.firstChargeDate}.` && bill.body.cardLast4 === "4242" && bill.body.canCancel === true, bill.body);
  ok("§4 Settings → Billing shows the signed agreement: who, when, the text she signed",
    agr.body.agreement && agr.body.agreement.signerName === "Sara Quill" && agr.body.agreement.sha256 === sig.text_sha256 && agr.body.agreement.text === sig.rendered_text, agr.body);
  const pdf = await fetch(process.env.BASE + "/billing/agreement/pdf", { headers: { Authorization: "Bearer " + admP } });
  const pdfBytes = Buffer.from(await pdf.arrayBuffer());
  ok("§4 and downloads it as a PDF", pdf.status === 200 && /application\/pdf/.test(pdf.headers.get("content-type")) && pdfBytes.slice(0, 4).toString() === "%PDF");

  // ── §5 · $0 SAVES THE CARD; A LINK EXPIRES ────────────────────────────
  const z = await api("POST", `/admin/orgs/${ORG_Z}/start-links`, sup, { contactName: "Max Fenn", contactEmail: "max@juniper.example", priceSource: "custom", chargeMode: "thirty" });
  const zt = tokenOf(z.body.url);
  const zp = await pub("GET", `/public/start/${zt}`);
  const b0 = seen.length;
  const zs = await pub("POST", `/public/start/${zt}/sign`, { name: "Max Fenn", title: "Director", agree: true, sha256: zp.body.agreement.sha256 });
  const zcs = seen.slice(b0).find(r => r.url.startsWith("/v1/checkout/sessions"));
  ok("§5 a $0 price still saves the card: Checkout in setup mode, no subscription, no line items",
    zs.status === 200 && zcs && zcs.form.get("mode") === "setup" && !zcs.form.get("line_items[0][price]") && !zcs.form.get("subscription_data[trial_end]"), zcs && Object.fromEntries(zcs.form));
  await fireBilling(`evt_onb1z_${testNow()}`, "checkout.session.completed", { id: "cs_z", object: "checkout.session", mode: "setup",
    customer: "cus_onb1_new", setup_intent: "seti_onb1", metadata: { startLinkId: z.body.id, orgId: ORG_Z } });
  const [zo] = await q(`SELECT paper_done_at, billing_card_last4, stripe_subscription_id FROM orgs WHERE id=$1`, [ORG_Z]);
  ok("§5 the $0 org has its card saved and Paper done, and no subscription to charge", !!zo.paper_done_at && zo.billing_card_last4 === "5454" && !zo.stripe_subscription_id, zo);
  const x = await api("POST", `/admin/orgs/${ORG_X}/start-links`, sup, { contactName: "Ada Moss", contactEmail: "ada@sycamore.example", band: "r2500", chargeMode: "thirty" });
  await q(`UPDATE start_links SET expires_at = NOW() - INTERVAL '1 minute' WHERE id=$1`, [x.body.id]);
  const xg = await pub("GET", `/public/start/${tokenOf(x.body.url)}`);
  const xs = await pub("POST", `/public/start/${tokenOf(x.body.url)}/sign`, { name: "Ada Moss", title: "Chair", agree: true, sha256: "x" });
  ok("§5 after 14 days the link is dead: the page says so and signing is refused", xg.status === 410 && xg.body.error === "expired" && xs.status === 410, { xg: xg.body, xs: xs.body });

  // ── §6 · A STAGED IMPORT IS INVISIBLE UNTIL ACCEPTED ──────────────────
  await mkOrg(ORG_S, "Wren Hollow Food Shelf");
  await mkUser("u_onb1_adms", ORG_S, ADMIN_S, "admin", false);
  await mkUser("u_onb1_sups", ORG_S, "onb1-super-s@example.org", "admin", true);
  const admS = await login(ADMIN_S);
  const elig = await api("GET", "/onboard/preview-eligible", admS);
  ok("§6 an org with nobody in it may preview its first file", elig.body.eligible === true, elig.body);
  const grid = fixtureGrid();
  const sS = await sheetImport(admS, grid, "wren-hollow-export.csv", { preview: true });
  const runS = sS.importId;
  if (PLANT === "everyone") await q(`UPDATE donors SET deleted_at=NULL WHERE org_id=$1 AND staged_import_id=$2`, [ORG_S, runS]);
  ok("§6 the file goes in through the one reader with \"Preview first\", and is staged in the same transaction",
    sS.end && sS.end.status === "done" && sS.end.result && sS.end.result.staged && sS.end.result.staged.staged === true, sS.end);
  const ev = await api("GET", "/people/everyone-breakdown", admS);
  const counts = await api("GET", "/donors/counts", admS);
  const trash = await api("GET", "/trash/people", admS);
  ok("§6 Everyone does not count the staged people", ev.body.everyone === 0, ev.body);
  ok("§6 nor does the trash, its count, or any donor count", ev.body.notCounted && ev.body.notCounted.trash === 0 && (trash.body.people || trash.body.rows || []).length === 0
    && Object.values(counts.body || {}).every(v => typeof v !== "number" || v === 0), { trash: trash.body, counts: counts.body });
  await assertSurfacesAgree(ORG_S, { token: admS, label: "while staged" });
  ok("§6 every surface agrees while staged (the truth check: a hidden person is in nothing)", true);

  // ── §7 · THE VERIFY PAGE FOOTS THE FILE TO THE CENT ───────────────────
  const v = await api("GET", `/imports/${runS}/verify`, admS);
  const m = v.body.money || {};
  ok("§7 Your file vs In Steward: $3,140.50 in the file, $2,790.25 held, the $350.25 between them is the two set-aside rows, to the cent",
    m.fileCents === 314050 && m.heldCents === 279025 && m.explainedCents === 35025 && m.unexplainedCents === 0 && m.foots === true, m);
  ok("§7 each gap is explained by row: the two refunded rows, lines 7 and 12",
    m.gaps.length === 1 && m.gaps[0].rows === 2 && m.gaps[0].cents === 35025 && m.gaps[0].lines.join(",") === "7,12" && /Refunded/.test(m.gaps[0].sentence), m.gaps);
  const L = Object.fromEntries((v.body.lines || []).map(l => [l.label, l]));
  ok("§7 people, gifts and dollars match the file", L.People.matches && L.Gifts.matches && L.Dollars.matches && L.Dollars.held === 279025, v.body.lines);
  ok("§7 dollars per year match", v.body.byYear.length === 2 && v.body.byYear.every(y => y.matches), v.body.byYear);
  ok("§7 each fund's total matches, file against Steward", v.body.funds && v.body.funds.length === 2 && v.body.funds.every(fl => fl.matches), v.body.funds);
  ok("§7 the 10-donor spot check: lifetime, last gift and gift count beside the file's rows, all matching",
    v.body.spot.length === 10 && v.body.spot.every(s => s.matches && s.held && s.held.cents === s.file.cents), v.body.spot);

  // ── §8 · "THESE MATCH, MAKE IT LIVE" ──────────────────────────────────
  const supS = await login("onb1-super-s@example.org");
  const noReason = await api("POST", `/imports/${runS}/accept`, supS, {});
  ok("§8 Jonathan accepting for the customer must type a reason", noReason.status === 400 && noReason.body.error === "reason_required", noReason.body);
  const acc = await api("POST", `/imports/${runS}/accept`, admS, {});
  const [impRow] = await q(`SELECT accepted_at, accepted_by, accepted_by_name, accepted_on_behalf FROM imports WHERE id=$1`, [runS]);
  const [os] = await q(`SELECT data_in_at FROM orgs WHERE id=$1`, [ORG_S]);
  ok("§8 the customer's admin makes it live: recorded with who and when, and the stage is Data in",
    acc.status === 200 && impRow.accepted_at && impRow.accepted_by === "u_onb1_adms" && impRow.accepted_on_behalf === false && !!os.data_in_at, { acc: acc.body, impRow });
  const ev2 = await api("GET", "/people/everyone-breakdown", admS);
  ok("§8 now Everyone counts them", ev2.body.everyone === 12, ev2.body);
  await assertSurfacesAgree(ORG_S, { token: admS, label: "after accept" });
  ok("§8 every surface agrees after Accept", true);

  // ── §9 · UNDO BEFORE ACCEPTING LEAVES NOTHING BEHIND ──────────────────
  await mkOrg(ORG_U, "Fernbank Readers");
  await mkUser("u_onb1_admu", ORG_U, ADMIN_U, "admin", false);
  const admU = await login(ADMIN_U);
  const sU = await sheetImport(admU, grid, "fernbank-export.csv", { preview: true });
  const runU = sU.importId;
  const stU = { body: (sU.end && sU.end.result && sU.end.result.staged) || {} };
  const und = await api("POST", `/imports/${runU}/reverse`, admU, {});
  await new Promise(r => setTimeout(r, 300));
  const left = (await q(`SELECT (SELECT COUNT(*)::int FROM donors WHERE org_id=$1) AS people,
                                (SELECT COUNT(*)::int FROM gifts WHERE org_id=$1) AS gifts,
                                (SELECT COUNT(*)::int FROM deleted_records WHERE org_id=$1) AS trash`, [ORG_U]))[0];
  ok("§9 a staged file undone before Accept leaves no person, no gift and nothing in the trash",
    stU.body.staged === true && und.status === 200 && left.people === 0 && left.gifts === 0 && left.trash === 0, { und: und.body, left });
  ok("§9 and the undo does not report the hidden people as 'already deleted'", !(und.body.removed && und.body.removed.alreadyDeleted), und.body.removed);

  mock.close();
  for (const o of [ORG_P, ORG_Z, ORG_X, ORG_S, ORG_U]) await wipe(o);
  await q(`DELETE FROM users WHERE email LIKE 'onb1-%@example.org'`);
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch {} process.exit(1); });

// A fixture file, the way a customer's CSV arrives: 12 gifts from 12 donors
// over two years and two funds, plus two rows marked "Refunded" that the
// reader sets aside with their dollars (lines 7 and 12). The file's own total
// is $3,140.50: $2,790.25 of gifts and $350.25 set aside.
function fixtureGrid() {
  const y = Number(civilPlusDays(0).slice(0, 4));
  const amounts = [100, 250.25, 75, 300, 125.5, 90, 410, 60, 500, 220, 359.5, 300];
  const rows = amounts.map((amt, i) => [`${i % 2 ? y - 1 : y - 2}-0${1 + (i % 9)}-15`, `Wren Donor ${String.fromCharCode(65 + i)}`,
    `wren${i}@onb1.example`, amt.toFixed(2), i % 3 ? "General" : "Pantry Shelves", "Paid"]);
  rows.splice(5, 0, [`${y - 1}-03-02`, "Wren Late One", "late1@onb1.example", "100.00", "General", "Refunded"]);
  rows.splice(10, 0, [`${y - 1}-04-02`, "Wren Late Two", "late2@onb1.example", "250.25", "General", "Refunded"]);
  return [["Date", "Donor", "Email", "Amount", "Fund", "Status"], ...rows];
}
async function sheetImport(tok, grid, fileName, extra = {}) {
  const body = { fileName, sheets: [{ name: "Sheet1", grid }] };
  const u = await api("POST", "/sheet-import/understand", tok, body);
  const c = await api("POST", "/sheet-import/commit", tok, { ...body, background: true, ...extra });
  let end = null;
  for (let i = 0; i < 400 && c.status === 202; i++) {
    const j = await api("GET", `/sheet-import/jobs/${encodeURIComponent(c.body.importId)}`, tok);
    if (j.body.status !== "running") { end = j.body; break; }
    await new Promise(r => setTimeout(r, 150));
  }
  return { u, c, end, importId: c.body && c.body.importId };
}
