// tests/order1.test.js · ORDER-1. SHE READS HER ORDER, SIGNS IT, AND PUTS A CARD ON FILE.
//
// Money and the legal record, on fixture orgs with made-up names:
//   §1 the order page shows exactly the figures Jonathan typed (monthly and waived; yearly
//      with a setup fee), and opening it changes nothing;
//   §2 the signature can't be taken without the box and a name (and a title);
//   §3 a signature stores the snapshot as shown, the Terms version, the IP and the hash; the
//      PDF carries every figure of the snapshot to the cent and the "Signed by … ET" stamp;
//      the deal moves to Signed; the signed copy goes to the signer and nobody else;
//   §4 a changed order can't reuse an old signature: an edit after she opened it refuses the
//      old page ("This order was updated on …"), a signed order can't be edited, and a new
//      order needs its own signature;
//   §5 nothing charges before the first charge date: Checkout holds trial_end at the date she
//      saw, the setup fee waits for the subscription's first invoice, and no request that
//      moves money today is made; the deal moves to Card on file;
//   §6 item 5: the dry-run list of paid or closed orgs with no signed order, and Send.
//
// THE PLANTED DEFECTS (server env ORDER1_PLANT, TEST_MODE=1):
//   stale        → §4 goes red (a stale page's signature is taken)
//   chargeearly  → §5 goes red (Checkout has no trial_end)
const http = require("http");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const zlib = require("zlib");
const { ok, summary, login, api, q, closeDb, BILLING_MOCK_PORT, SINK_PORT, BASE } = require("./helpers");
const O = require("../server/onboard/order");
const TERMS = require("../shared/terms.json");

const SECRET = "whsec_localtest";
const stripe = require("stripe")("sk_test_dummy");
const PASS = "loadtest1234";
const ORG_A = "org_ord1_alder", ORG_B = "org_ord1_birch", ORG_C = "org_ord1_cedar", ORG_D = "org_ord1_dogwood";
const SUPER = "ord1-super@example.org", STAFF = "ord1-staff@example.org";
const PIPE = "spl_ord1";
const DAY = 86400000;

// ── The billing Stripe mock: answers, and remembers every request ──
const seen = [];
function startBillingMock() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", c => b += c);
      req.on("end", () => {
        seen.push({ method: req.method, url: req.url, form: new URLSearchParams(b) });
        res.setHeader("Content-Type", "application/json");
        const send = o => res.end(JSON.stringify(o));
        const u = req.url.split("?")[0];
        if (req.method === "POST" && u === "/v1/checkout/sessions") return send({ id: "cs_test_ord1_" + seen.length, object: "checkout.session", url: "https://checkout.stripe.test/ord1" });
        if (req.method === "GET" && /^\/v1\/prices\//.test(u)) return send({ id: u.split("/")[3], object: "price", product: "prod_test_steward", unit_amount: 19900, currency: "usd", recurring: { interval: "month", interval_count: 1 } });
        if (req.method === "GET" && /^\/v1\/subscriptions\//.test(u)) {
          const link = seen.filter(r => r.url === "/v1/checkout/sessions").pop();
          const te = link && link.form.get("subscription_data[trial_end]");
          return send({ id: u.split("/")[3], object: "subscription", status: "trialing", trial_end: te ? Number(te) : null,
            default_payment_method: { id: "pm_ord1", card: { brand: "visa", last4: "4242" } } });
        }
        if (req.method === "POST" && u === "/v1/invoiceitems") return send({ id: "ii_ord1_" + seen.length, object: "invoiceitem" });
        if (req.method === "POST" && u === "/v1/customers") return send({ id: "cus_ord1_new", object: "customer" });
        res.statusCode = 404; send({ error: { message: "mock: " + req.method + " " + req.url } });
      });
    });
    srv.listen(BILLING_MOCK_PORT, () => resolve(srv));
  });
}
function startSink() {
  const captured = [];
  const srv = http.createServer((req, res) => {
    let b = ""; req.on("data", c => b += c);
    req.on("end", () => { try { captured.push(JSON.parse(b)); } catch (_) { captured.push({}); } res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ id: "sunk_" + captured.length })); });
  });
  return new Promise(resolve => { srv.on("error", () => resolve(null)); srv.listen(SINK_PORT, () => resolve({ srv, captured })); });
}
async function fireBilling(id, type, object) {
  const payload = JSON.stringify({ id, type, data: { object } });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
  const r = await fetch(BASE + "/billing/webhook", { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": header }, body: payload });
  return r.status;
}
const pub = (method, path, body, headers = {}) => fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined })
  .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const tokenOf = url => String(url).split("/start/")[1];
// Every request that could move money today.
const moneyMoves = from => seen.slice(from).filter(r => r.method === "POST" && (/^\/v1\/(payment_intents|charges|invoices)/.test(r.url)
  || (r.url === "/v1/checkout/sessions" && (!r.form.get("subscription_data[trial_end]") || r.form.get("subscription_data[add_invoice_items][0][price]") || r.form.get("mode") === "payment"))));

// The words in a PDF (pdfkit writes text as hex strings inside TJ arrays; uncompressed here,
// inflated if it ever is not).
function pdfText(buf) {
  let raw = buf.toString("latin1");
  raw = raw.replace(/stream\r?\n([\s\S]*?)\r?\nendstream/g, (m, body) => {
    try { return "stream\n" + zlib.inflateSync(Buffer.from(body, "latin1")).toString("latin1") + "\nendstream"; } catch { return m; }
  });
  const out = [];
  for (const arr of raw.match(/\[([^\]]*)\]\s*TJ/g) || []) {
    out.push((arr.match(/<([0-9a-fA-F]*)>/g) || []).map(h => Buffer.from(h.slice(1, -1), "hex").toString("latin1")).join(""));
  }
  return out.join("\n").replace(/\u0092/g, "'");
}

async function wipe(org) {
  const tables = (await q(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (let pass = 0; pass < 4; pass++) {
    for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [org]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [org]).then(() => true).catch(() => false)) return;
  }
}
async function mkOrg(id, name) {
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,$2,$3,1,'trialing','trial','America/New_York')`, [id, name, id.replace(/_/g, "-")]);
  await q(`UPDATE orgs SET stripe_customer_id_test=$2, stripe_customer_id=$2 WHERE id=$1`, [id, "cus_" + id]);
}
async function mkUser(id, org, email, role, superAdmin = false) {
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, org, email, bcrypt.hashSync(PASS, 10), email.split("@")[0], role, superAdmin]);
}
const SYS = ["system:test", "Test"];
// A pipeline of its own (the shared default one is other suites'), WITHOUT Signed or Card on
// file, as every pipeline made before ORDER-1 is: the first order adds them.
async function mkSales() {
  await q(`DELETE FROM sales_stage_history WHERE deal_id LIKE 'sde_ord1_%'`).catch(() => {});
  await q(`DELETE FROM sales_activity_links WHERE record_id LIKE 'sde_ord1_%'`).catch(() => {});
  await q(`DELETE FROM sales_links WHERE a_id LIKE 'sde_ord1_%'`);
  await q(`DELETE FROM sales_deals WHERE id LIKE 'sde_ord1_%'`);
  await q(`DELETE FROM sales_orgs WHERE id LIKE 'sor_ord1_%'`);
  await q(`DELETE FROM sales_stages WHERE pipeline_id=$1`, [PIPE]);
  await q(`DELETE FROM sales_pipelines WHERE id=$1`, [PIPE]);
  await q(`INSERT INTO sales_pipelines (id,name,position,created_by,created_by_name) VALUES ($1,'Order one',9,$2,$3)`, [PIPE, ...SYS]);
  const names = [["Lead", "open", false], ["Demo done", "open", false], ["Verbal yes", "open", true], ["Trial", "open", true], ["Paying", "won", true], ["Lost", "lost", false]];
  for (let i = 0; i < names.length; i++) {
    await q(`INSERT INTO sales_stages (id,pipeline_id,name,position,probability,kind,onboarding,created_by,created_by_name) VALUES ($1,$2,$3,$4,50,$5,$6,$7,$8)`,
      [`sst_ord1_${i}`, PIPE, names[i][0], i, names[i][1], names[i][2], ...SYS]);
  }
  for (const [org, n] of [[ORG_A, "a"], [ORG_C, "c"]]) {
    await q(`INSERT INTO sales_orgs (id,name,steward_org_id,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5)`, [`sor_ord1_${n}`, `Sales ${n}`, org, ...SYS]);
    await q(`INSERT INTO sales_deals (id,name,pipeline_id,stage_id,created_by,created_by_name) VALUES ($1,$2,$3,'sst_ord1_2',$4,$5)`, [`sde_ord1_${n}`, `Deal ${n}`, PIPE, ...SYS]);
    await q(`INSERT INTO sales_links (id,a_type,a_id,b_type,b_id,is_primary,created_by,created_by_name) VALUES ($1,'deal',$2,'org',$3,true,$4,$5)`,
      [`sli_ord1_${n}`, `sde_ord1_${n}`, `sor_ord1_${n}`, ...SYS]);
  }
}
const stageOf = async id => ((await q(`SELECT s.name FROM sales_deals d JOIN sales_stages s ON s.id=d.stage_id WHERE d.id=$1`, [id]))[0] || {}).name;

const ORDER_A = { signerName: "Marigold Petrakis", signerTitle: "Development Director", signerEmail: "marigold@alder-riding.example",
  planName: "Steward, everything included", interval: "month", price: "149", setupFee: "Waived", freeDays: "30",
  note: "Founding pilot price. Your $149 is locked for as long as you stay with Steward.", band: "r500" };

(async () => {
  console.log("ORDER-1: the order on the close link\n");
  const mock = await startBillingMock();
  const sink = await startSink();
  if (!sink) { console.error(`could not bind the mail sink on :${SINK_PORT}`); process.exit(1); }
  for (const o of [ORG_A, ORG_B, ORG_C, ORG_D]) await wipe(o);
  await q(`DELETE FROM users WHERE email LIKE 'ord1-%@example.org'`);
  await mkOrg(ORG_A, "Alder Creek Riding"); await mkOrg(ORG_B, "Birchwood Pantry"); await mkOrg(ORG_C, "Cedar Hollow Arts"); await mkOrg(ORG_D, "Dogwood Literacy");
  await q(`UPDATE orgs SET stripe_subscription_id='sub_ord1_paid', subscription_status='active', plan='r500_monthly' WHERE id=$1`, [ORG_D]);
  await mkUser("u_ord1_super", ORG_A, SUPER, "admin", true);
  await mkUser("u_ord1_staff", ORG_A, STAFF, "staff");
  await mkUser("u_ord1_dadmin", ORG_D, "ord1-dogwood-admin@example.org", "admin");
  await mkSales();
  const sup = await login(SUPER), staff = await login(STAFF);

  // ── §1 · THE ORDER PAGE SHOWS EXACTLY WHAT JONATHAN TYPED ──────────────
  const refused = await api("POST", `/admin/orgs/${ORG_A}/start-links`, staff, { order: ORDER_A });
  ok("§1 a staff user cannot make an order", refused.status === 403, refused.status);
  const mailBefore = sink.captured.length;
  const made = await api("POST", `/admin/orgs/${ORG_A}/start-links`, sup, { order: ORDER_A });
  ok("§1 the super-admin makes one: an order number SW-YYYY-NNNN, the link, the deal it moves", made.status === 201 && /^SW-\d{4}-\d{4}$/.test(made.body.orderNumber)
    && /\/start\/[A-Za-z0-9_-]{20,}$/.test(made.body.url) && made.body.deal && made.body.deal.id === "sde_ord1_a", made.body);
  const tokA = tokenOf(made.body.url);
  const pageA = await pub("GET", `/public/start/${tokA}`);
  const sA = pageA.body.order && pageA.body.order.snapshot;
  const amounts = sA ? Object.fromEntries([...sA.lines, sA.total].map(l => [l.key, [l.amount, l.cents]])) : {};
  ok("§1 the page: $149 / month, setup Waived, 30 days at $0, first charge $149", pageA.status === 200 && sA
    && amounts.plan[0] === "$149 / month" && amounts.plan[1] === 14900 && amounts.setup[0] === "Waived" && amounts.setup[1] === 0
    && amounts.free[0] === "$0" && sA.lines[2].label === "First 30 days" && amounts.first[0] === "$149" && amounts.first[1] === 14900, amounts);
  const firstAt = sA && Date.parse(sA.figures.firstChargeAt);
  ok("§1 the first charge is 30 days from now, and the cancel-by date and the total name that same day",
    sA && Math.abs(firstAt - (Date.now() + 30 * DAY)) < 5 * 60000 && sA.lines[2].detail.includes(`Cancel any time before ${sA.figures.firstChargeOn}`)
    && sA.total.label === `First charge, ${sA.figures.firstChargeOn}`, sA && sA.figures);
  const dom = Number(new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: "America/New_York" }).format(new Date(firstAt)));
  ok("§1 then \"$149 on the Nth of each month\", the note line, who signs, the billing email and the order number", sA
    && new RegExp(`Then \\$149 on the ${dom}(st|nd|rd|th) of each month`).test(sA.total.detail) && sA.note === ORDER_A.note
    && sA.signer.name === "Marigold Petrakis" && sA.signer.title === "Development Director" && sA.billingEmail === ORDER_A.signerEmail
    && sA.orderNumber === made.body.orderNumber && sA.orgName === "Alder Creek Riding" && sA.termsVersion === TERMS.version, sA);
  ok("§1 the page carries the hash of exactly what it shows", pageA.body.order.sha256 === O.shownSha(sA));
  const [rowA0] = await q(`SELECT status, signed_at FROM start_links WHERE id=$1`, [made.body.id]);
  ok("§1 opening the page and making the order send nothing and sign nothing",
    rowA0.status === "open" && !rowA0.signed_at && sink.captured.length === mailBefore, { rowA0, mails: sink.captured.length - mailBefore });

  const ORDER_C = { ...ORDER_A, signerName: "Tobias Wren", signerEmail: "tobias@cedar-hollow.example", interval: "year", price: "1,490", setupFee: "500", freeDays: "14", note: "" };
  const madeC = await api("POST", `/admin/orgs/${ORG_C}/start-links`, sup, { order: ORDER_C });
  const sC = (await pub("GET", `/public/start/${tokenOf(madeC.body.url)}`)).body.order.snapshot;
  const amC = Object.fromEntries([...sC.lines, sC.total].map(l => [l.key, [l.amount, l.cents]]));
  ok("§1 yearly with a setup fee: $1,490 / year, setup $500, first 14 days, first charge $1,990",
    amC.plan[0] === "$1,490 / year" && amC.plan[1] === 149000 && amC.setup[0] === "$500" && amC.setup[1] === 50000 && sC.lines[2].label === "First 14 days"
    && amC.first[0] === "$1,990" && amC.first[1] === 199000 && /every year on/.test(sC.total.detail) && sC.note === null, amC);

  // ── §2 · NO BOX, NO NAME, NO SIGNATURE ─────────────────────────────────
  const sha = pageA.body.order.sha256;
  const noBox = await pub("POST", `/public/start/${tokA}/sign`, { name: "Marigold Petrakis", title: "Development Director", sha256: sha });
  const noName = await pub("POST", `/public/start/${tokA}/sign`, { name: " ", title: "Development Director", agree: true, sha256: sha });
  const noTitle = await pub("POST", `/public/start/${tokA}/sign`, { name: "Marigold Petrakis", title: "", agree: true, sha256: sha });
  const sigs0 = (await q(`SELECT COUNT(*)::int n FROM order_signatures WHERE org_id=$1`, [ORG_A]))[0].n;
  ok("§2 without the box, a name or a title it refuses, and nothing is stored", noBox.status === 400 && noBox.body.error === "agree_required"
    && noName.status === 400 && noName.body.error === "name_required" && noTitle.status === 400 && sigs0 === 0, { noBox: noBox.body, noName: noName.body, sigs0 });

  // ── §3 · THE SIGNATURE IS THE RECORD ───────────────────────────────────
  const from3 = seen.length, mail3 = sink.captured.length;
  const signed = await pub("POST", `/public/start/${tokA}/sign`, { name: "Marigold A. Petrakis", title: "Development Director", agree: true, sha256: sha },
    { "X-Forwarded-For": "203.0.113.77", "User-Agent": "Order1Test/1.0 (fixture)" });
  ok("§3 she signs and is handed the card step", signed.status === 200 && /checkout\.stripe\.test/.test(signed.body.checkoutUrl), signed.body);
  const [g] = await q(`SELECT * FROM order_signatures WHERE org_id=$1`, [ORG_A]);
  const want = { ...sA, signer: { ...sA.signer, name: "Marigold A. Petrakis" } };
  const sameButSigner = g && JSON.stringify(O.canonical({ ...g.snapshot, figures: { ...g.snapshot.figures, firstChargeAt: null, firstChargeOn: null }, lines: null, total: null }))
    === JSON.stringify(O.canonical({ ...want, figures: { ...want.figures, firstChargeAt: null, firstChargeOn: null }, lines: null, total: null }));
  ok("§3 the row keeps the order as shown, with the name she typed", g && sameButSigner && g.snapshot.lines.map(l => l.amount).join("|") === sA.lines.map(l => l.amount).join("|")
    && g.snapshot.total.amount === "$149" && g.snapshot.signer.name === "Marigold A. Petrakis", g && g.snapshot);
  ok("§3 …the Terms version, the IP address, the browser, and the SHA-256 of the snapshot", g && g.terms_version === TERMS.version && g.ip === "203.0.113.77"
    && g.user_agent === "Order1Test/1.0 (fixture)" && g.snapshot_sha256 === O.snapshotSha(g.snapshot) && g.signer_email === ORDER_A.signerEmail
    && g.order_number === made.body.orderNumber && g.order_version === 1, g && { tv: g.terms_version, ip: g.ip, sha: g.snapshot_sha256 });
  ok("§3 the first charge is 30 days from the moment she signed", g && Math.abs(new Date(g.first_charge_at).getTime() - (new Date(g.signed_at).getTime() + 30 * DAY)) < 1000
    && g.snapshot.figures.firstChargeAt === new Date(g.first_charge_at).toISOString(), g && { s: g.signed_at, f: g.first_charge_at });
  const upd = await q(`UPDATE order_signatures SET signer_name='Someone Else' WHERE id=$1`, [g.id]).then(() => "updated", e => e.message);
  ok("§3 the signature can't be edited (append-only)", /append-only/.test(upd), upd);
  const [ss] = await q(`SELECT rendered_text, text_sha256 FROM start_signatures WHERE start_link_id=$1`, [made.body.id]);
  ok("§3 ONBOARD-1's record is written too, so Settings → Billing and the paper gate read it", ss && ss.rendered_text.includes(made.body.orderNumber) && ss.text_sha256 === g.snapshot_sha256);

  const pdfRes = await fetch(`${BASE}/public/start/${tokA}/order.pdf`);
  const text = pdfText(Buffer.from(await pdfRes.arrayBuffer()));
  const missing = [...g.snapshot.lines, g.snapshot.total].flatMap(l => [l.label, l.amount]).filter(w => !text.includes(w));
  const stamp = O.signedStamp("Marigold A. Petrakis", g.signed_at);
  ok("§3 the PDF carries every line and figure of the snapshot, to the cent", pdfRes.status === 200 && missing.length === 0 && text.includes(made.body.orderNumber)
    && text.includes(g.snapshot.note), { missing, sample: text.slice(0, 400) });
  ok("§3 …stamped \"Signed by … on … at … ET\", with the Terms version, the IP and the hash", /^Signed by Marigold A\. Petrakis on \w{3} \d{1,2}, \d{4} at \d{1,2}:\d{2} (AM|PM) ET$/.test(stamp)
    && text.includes(stamp) && text.includes(TERMS.version) && text.includes("203.0.113.77") && text.includes(g.snapshot_sha256), { stamp });
  ok("§3 the deal moved to Signed (added after Verbal yes in a pipeline that had none)", (await stageOf("sde_ord1_a")) === "Signed"
    && (await q(`SELECT position FROM sales_stages WHERE pipeline_id=$1 AND name='Signed'`, [PIPE]))[0].position === 3);
  const mails3 = sink.captured.slice(mail3);
  const toList = mails3.flatMap(m => [].concat(m.to || [], m.cc || [], m.bcc || []));
  ok("§3 one email, the signed copy, to the signer only, with the signed PDF", mails3.length === 1 && toList.length === 1 && toList[0] === ORDER_A.signerEmail
    && (mails3[0].attachments || []).length === 1 && /signed\.pdf$/.test(mails3[0].attachments[0].filename)
    && pdfText(Buffer.from(mails3[0].attachments[0].content, "base64")).includes(stamp), mails3.map(m => ({ to: m.to, subject: m.subject })));
  const again = await pub("POST", `/public/start/${tokA}/sign`, { name: "Someone Else", title: "Nobody", agree: true, sha256: sha });
  ok("§3 signing again only re-opens the card step; the record is not replaced", again.status === 200
    && (await q(`SELECT COUNT(*)::int n FROM order_signatures WHERE org_id=$1`, [ORG_A]))[0].n === 1, again.body);

  // ── §5 · NOTHING CHARGES BEFORE THE FIRST CHARGE DATE ─────────────────
  const cs = seen.slice(from3).filter(r => r.url === "/v1/checkout/sessions").pop();
  const te = cs && Number(cs.form.get("subscription_data[trial_end]"));
  ok("§5 Checkout is a subscription whose trial ends at the first charge she signed for", cs && cs.form.get("mode") === "subscription"
    && te === Math.floor(new Date(g.first_charge_at).getTime() / 1000) && cs.form.get("line_items[0][price_data][unit_amount]") === "14900"
    && cs.form.get("line_items[0][price_data][recurring][interval]") === "month", cs && Object.fromEntries(cs.form));
  ok("§5 nothing in the card step moves money today", moneyMoves(from3).length === 0, moneyMoves(from3).map(r => r.url));

  // Cedar: yearly with a $500 setup fee. Sign, then Stripe says the card went in.
  const pageC = await pub("GET", `/public/start/${tokenOf(madeC.body.url)}`);
  const from5 = seen.length;
  const signedC = await pub("POST", `/public/start/${tokenOf(madeC.body.url)}/sign`, { name: "Tobias Wren", title: "Board Chair", agree: true, sha256: pageC.body.order.sha256 });
  const csC = seen.slice(from5).filter(r => r.url === "/v1/checkout/sessions").pop();
  const [gC] = await q(`SELECT first_charge_at FROM order_signatures WHERE org_id=$1`, [ORG_C]);
  ok("§5 yearly: the price is per year, the trial ends 14 days on, and the setup fee is not on today's Checkout", signedC.status === 200 && csC
    && csC.form.get("line_items[0][price_data][recurring][interval]") === "year" && csC.form.get("line_items[0][price_data][unit_amount]") === "149000"
    && Number(csC.form.get("subscription_data[trial_end]")) === Math.floor(new Date(gC.first_charge_at).getTime() / 1000)
    && ![...csC.form.keys()].some(k => /add_invoice_items|setup/.test(k)), csC && Object.fromEntries(csC.form));
  const from5b = seen.length;
  const hook = await fireBilling("evt_ord1_c", "checkout.session.completed", { id: csC ? "cs_test_ord1_x" : "cs", object: "checkout.session", mode: "subscription",
    customer: `cus_${ORG_C}`, subscription: "sub_ord1_cedar", metadata: { startLinkId: madeC.body.id, orgId: ORG_C, plan: "r500_yearly" } });
  const ii = seen.slice(from5b).filter(r => r.url === "/v1/invoiceitems");
  ok("§5 the card went in: the $500 setup fee is an invoice item tied to the subscription (its first real invoice), once",
    hook === 200 && ii.length === 1 && ii[0].form.get("amount") === "50000" && ii[0].form.get("subscription") === "sub_ord1_cedar", ii.map(r => Object.fromEntries(r.form)));
  const [orgC] = await q(`SELECT subscription_status, trial_ends_at, paper_done_at, plan FROM orgs WHERE id=$1`, [ORG_C]);
  ok("§5 the org is trialing until the first charge, paper done, on the yearly plan, and nothing moved money", orgC.subscription_status === "trialing"
    && Math.abs(new Date(orgC.trial_ends_at).getTime() - new Date(gC.first_charge_at).getTime()) < 1000 && orgC.paper_done_at && orgC.plan === "r500_yearly"
    && moneyMoves(from5).length === 0, { orgC, moves: moneyMoves(from5).map(r => r.url) });
  ok("§5 the deal moved to Signed, then Card on file", (await stageOf("sde_ord1_c")) === "Card on file"
    && (await q(`SELECT to_name FROM sales_stage_history WHERE deal_id='sde_ord1_c' ORDER BY created_at`)).map(r => r.to_name).join(">") === "Signed>Card on file");
  await fireBilling("evt_ord1_c2", "checkout.session.completed", { id: "cs_test_ord1_y", object: "checkout.session", mode: "subscription",
    customer: `cus_${ORG_C}`, subscription: "sub_ord1_cedar", metadata: { startLinkId: madeC.body.id, orgId: ORG_C, plan: "r500_yearly" } });
  ok("§5 a redelivered event adds no second setup fee", seen.filter(r => r.url === "/v1/invoiceitems").length === 1
    && seen.filter(r => r.url === "/v1/invoiceitems").every(r => r.form.get("amount") === "50000"));

  // ── §4 · A CHANGED ORDER CAN'T REUSE AN OLD SIGNATURE ─────────────────
  const ORDER_B = { ...ORDER_A, signerName: "Odette Lin", signerEmail: "odette@birchwood.example", price: "199", note: "" };
  const madeB = await api("POST", `/admin/orgs/${ORG_B}/start-links`, sup, { order: ORDER_B });
  const tokB = tokenOf(madeB.body.url);
  const seenB = await pub("GET", `/public/start/${tokB}`);   // she opens it: $199
  const edit = await api("PATCH", `/admin/start-links/${madeB.body.id}/order`, sup, { order: { ...ORDER_B, price: "249" } });
  ok("§4 Jonathan edits the open order: version 2, the same link", edit.status === 200 && edit.body.version === 2, edit.body);
  const stale = await pub("POST", `/public/start/${tokB}/sign`, { name: "Odette Lin", title: "Director", agree: true, sha256: seenB.body.order.sha256 });
  ok("§4 her page from before the edit can't be signed: \"This order was updated on …\", and the new one comes back",
    stale.status === 409 && stale.body.error === "order_changed" && /^This order was updated on \w{3} \d{1,2}, \d{4} at .+ ET\. Read the new one and sign it\.$/.test(stale.body.message)
    && stale.body.order && stale.body.order.snapshot.lines[0].amount === "$249 / month" && stale.body.order.updatedOn
    && (await q(`SELECT COUNT(*)::int n FROM order_signatures WHERE org_id=$1`, [ORG_B]))[0].n === 0, stale.body);
  const fresh = await pub("POST", `/public/start/${tokB}/sign`, { name: "Odette Lin", title: "Director", agree: true, sha256: stale.body.order.sha256 });
  const [gB] = await q(`SELECT order_version, snapshot FROM order_signatures WHERE org_id=$1`, [ORG_B]);
  ok("§4 she signs the new one: version 2 at $249 is what is stored", fresh.status === 200 && gB && gB.order_version === 2 && gB.snapshot.lines[0].cents === 24900 && gB.snapshot.version === 2, gB);
  const editSigned = await api("PATCH", `/admin/start-links/${madeB.body.id}/order`, sup, { order: { ...ORDER_B, price: "99" } });
  ok("§4 a signed order is never edited", editSigned.status === 409 && editSigned.body.error === "order_not_editable", editSigned.body);
  const noReplace = await api("POST", `/admin/orgs/${ORG_B}/start-links`, sup, { order: { ...ORDER_B, price: "99" } });
  const replaced = await api("POST", `/admin/orgs/${ORG_B}/start-links`, sup, { order: { ...ORDER_B, price: "99" }, replace: true });
  const resume = await pub("POST", `/public/start/${tokenOf(replaced.body.url)}/sign`, {});
  const oldLink = await pub("POST", `/public/start/${tokB}/sign`, {});
  ok("§4 a change is a new order: a new number, and it needs its own signature (the old one is not reused)",
    noReplace.status === 409 && replaced.status === 201 && replaced.body.orderNumber !== madeB.body.orderNumber
    && resume.status === 400 && resume.body.error === "name_required" && oldLink.status === 410, { resume: resume.body, oldLink: oldLink.status });

  // ── §6 · ITEM 5: THE DRY-RUN LIST, AND SEND ───────────────────────────
  const mail6 = sink.captured.length;
  const list = await api("GET", `/admin/orders/unsigned`, sup);
  const ids = (list.body.orgs || []).map(o => o.id);
  ok("§6 the list names the paid org with no signed order, and not the orgs that signed", list.status === 200 && list.body.dryRun === true
    && ids.includes(ORG_D) && !ids.includes(ORG_A) && !ids.includes(ORG_C) && !ids.includes(ORG_B)
    && list.body.orgs.find(o => o.id === ORG_D).why.includes("paid plan"), list.body);
  const staffList = await api("GET", `/admin/orders/unsigned`, staff);
  ok("§6 only a super-admin reads it, and reading it sends nothing", staffList.status === 403 && sink.captured.length === mail6);
  const madeD = await api("POST", `/admin/orgs/${ORG_D}/start-links`, sup, { order: { ...ORDER_A, signerName: "Rafe Okonkwo", signerEmail: "ord1-dogwood-admin@example.org", note: "" } });
  ok("§6 an org already paying gets an order too (no second subscription is raised)", madeD.status === 201, madeD.body);
  const badSend = await api("POST", `/admin/start-links/${madeD.body.id}/send`, sup, { token: "not-the-token-at-all-0000000" });
  const goodSend = await api("POST", `/admin/start-links/${madeD.body.id}/send`, sup, { token: tokenOf(madeD.body.url) });
  const sent6 = sink.captured.slice(mail6);
  ok("§6 Send needs the link's own token, and sends one \"Review and sign your order\" to the signer only", badSend.status === 400 && goodSend.status === 200 && goodSend.body.sent
    && sent6.length === 1 && [].concat(sent6[0].to).join() === "ord1-dogwood-admin@example.org" && /^Review and sign your Steward order SW-/.test(sent6[0].subject)
    && sent6[0].html.includes(madeD.body.url), sent6.map(m => ({ to: m.to, subject: m.subject })));
  const pageD = await pub("GET", `/public/start/${tokenOf(madeD.body.url)}`);
  const from6 = seen.length;
  const signD = await pub("POST", `/public/start/${tokenOf(madeD.body.url)}/sign`, { name: "Rafe Okonkwo", title: "Executive Director", agree: true, sha256: pageD.body.order.sha256 });
  ok("§6 the paying org signs: no Checkout, no second subscription, the link is done", signD.status === 200 && signD.body.completed === true && !signD.body.checkoutUrl
    && seen.slice(from6).filter(r => r.method === "POST").length === 0
    && (await q(`SELECT status FROM start_links WHERE id=$1`, [madeD.body.id]))[0].status === "completed", signD.body);

  mock.close(); sink.srv.close();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch (_) { /* closing */ } process.exit(1); });
