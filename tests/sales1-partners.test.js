// tests/sales1-partners.test.js · SALES-1 Part B. EMAIL ON THE SALES RECORDS, PARTNERS, PAYOUTS.
//
// One section per numbered item of Part B (§11–§14), and §0 the door.
//
// THE PLANTED DEFECTS (each turns its section red):
//   SALES1_PLANT=storeall   an unrelated email gets stored            → §11 (set it on THIS process: capture runs here)
//   SALES1_PLANT=duration   a partner term pays a month past its end  → §13 (this process: the payout rule runs here)
//   SALES1_PLANT=door       an org admin reaches /ops/sales            → §0  (set it on the SERVER)
//
// Fake fixtures only, made-up names. Nothing sends: no provider is called (the
// mailbox read is handed a fake fetcher), and nothing goes to a partner.
// The server seals and opens email bodies with STEWARD_CREDENTIAL_KEY, and capture runs in this
// process, so both must hold the same key: CI sets it for the whole job; locally tests/shard.sh
// gives the server this default, so this process takes the same one when none is set.
process.env.STEWARD_CREDENTIAL_KEY = process.env.STEWARD_CREDENTIAL_KEY || "local-scratch-credential-key-0123456789";
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
const { testNow } = require("./clock");
const MAIL = require("../server/admin/sales/email");
const PAY = require("../shared/numbers/partnerPayout");

const PASS = "loadtest1234";
const HOME = "org_sales1bhome", CUST = "org_sales1bcust";
const SUPER = "sales1b-super@example.org", ADMIN = "sales1b-admin@example.org";
const DAY = 86400000;
const qq = (sql, p = []) => { let i = 0; return q(sql.replace(/\?/g, () => "$" + (++i)), p); };
const ctx = { query: qq, run: (sql, p) => qq(sql, p).then(() => ({ changes: 1 })) };
const S = (tok, m, p, b) => api(m, `/ops/sales${p}`, tok, b);

async function wipeOrg(org) {
  const tables = (await q(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (let pass = 0; pass < 4; pass++) {
    for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [org]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [org]).then(() => true).catch(() => false)) return;
  }
}
async function wipeSales() {
  const t = (await q(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'sales\\_%'`)).map(r => r.table_name);
  for (const x of t) await q(`DELETE FROM "${x}"`);
}

(async () => {
  await wipeSales();
  for (const o of [HOME, CUST]) await wipeOrg(o);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Sales1b Home','sales1b-home',1,'active','team')`, [HOME]);
  // The Steward org a won deal became: live subscription, $350 a month (ONBOARD-2's MRR rule).
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,stripe_subscription_id,billing_mrr_cents) VALUES ($1,'Paying Prospect','sales1b-cust',1,'active','team','sub_sales1b',35000)`, [CUST]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin) VALUES ('u_s1b_super',$1,$2,$3,'Sales Super','admin',true)`, [HOME, SUPER, bcrypt.hashSync(PASS, 10)]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin) VALUES ('u_s1b_admin',$1,$2,$3,'Cust Admin','admin',false)`, [CUST, ADMIN, bcrypt.hashSync(PASS, 10)]);
  const sup = await login(SUPER), adm = await login(ADMIN);

  // ── §0 · THE DOOR ──────────────────────────────────────────────────────────
  const probes = [["GET", "/mailbox"], ["POST", "/mailbox/microsoft/start", {}], ["POST", "/mailbox/microsoft/complete", {}], ["POST", "/mailbox/x/read", {}],
    ["POST", "/mailbox/x/disconnect", {}], ["POST", "/mailbox/delete-captured", { confirm: "DELETE" }], ["PUT", "/mailbox/settings", {}], ["GET", "/emails/x"],
    ["GET", "/partners"], ["POST", "/partners", { name: "Sneaky" }], ["GET", "/partners/x"], ["POST", "/partners/x/terms", {}], ["POST", "/deals/x/partners", {}],
    ["GET", "/ledger"], ["POST", "/ledger/paid", {}], ["GET", "/statement/x"]];
  const leaks = [];
  for (const [m, p, b] of probes) { const r = await S(adm, m, p, b); if (r.status !== 404) leaks.push(`${m} ${p} → ${r.status}`); }
  ok("§0 an org admin gets 404 on every Part B sales route", leaks.length === 0, leaks);
  ok("§0 an org admin's partner create wrote nothing", (await q(`SELECT COUNT(*)::int AS n FROM sales_partners`))[0].n === 0);

  // Records to hang email and partners on.
  const org = (await S(sup, "POST", "/rec/org", { name: "Kestrel Lake Library Friends", domain: "kestrel-lake.example.org" })).body.id;
  const c1 = (await S(sup, "POST", "/rec/contact", { first_name: "Winona", last_name: "Abernathy", emails: "winona@kestrel-lake.example.org" })).body.id;
  const c2 = (await S(sup, "POST", "/rec/contact", { first_name: "Basil", last_name: "Ferro", emails: "basil.ferro@mailbox.example.net" })).body.id;
  const meta = (await S(sup, "GET", "/meta")).body;
  const ST = Object.fromEntries(meta.pipelines[0].stages.map(s => [s.name, s.id]));
  const dOpen = (await S(sup, "POST", "/rec/deal", { name: "Kestrel – Core", stage_id: ST["Demo done"], value_cents: 35000 })).body.id;
  const dLost = (await S(sup, "POST", "/rec/deal", { name: "Kestrel – old pilot", stage_id: ST.Lost, lost_reason: "Timing" })).body.id;
  for (const [a, b] of [[["contact", c1], ["org", org]], [["deal", dOpen], ["org", org]], [["deal", dOpen], ["contact", c1]], [["deal", dLost], ["contact", c1]]])
    await S(sup, "POST", "/link", { from: { type: a[0], id: a[1] }, to: { type: b[0], id: b[1] } });

  // ── §11 · EMAIL ON THE RECORDS ─────────────────────────────────────────────
  const OWN = "seller@stewardapp.example.org";
  await q(`INSERT INTO sales_mailboxes (id,provider,address,user_id,status,created_by,created_by_name) VALUES ('smb_t','microsoft',$1,'u_s1b_super','active','system:test','test')`, [OWN]);
  const mb = { id: "smb_t", address: OWN };
  const now = testNow();
  const at = d => new Date(now - d * DAY).toISOString();
  const msgs = [
    { id: "m-out-1", sent: true, from: OWN, to: ["Winona@Kestrel-Lake.example.org"], cc: [], subject: "Next steps on Kestrel", bodyText: "Here is the import guide.", at: at(9) },
    { id: "m-unrelated", sent: false, from: "newsletter@unrelated.example.com", to: [OWN], cc: [], subject: "Weekly digest", bodyText: "Nothing to do with sales.", at: at(3) },
    { id: "m-friend", sent: true, from: OWN, to: ["old.friend@personal.example.com"], cc: [], subject: "Dinner Friday?", bodyText: "Personal.", at: at(2) },
  ];
  const cap1 = await MAIL.capture(ctx, mb, msgs);
  const stored = (await q(`SELECT provider_message_id FROM sales_emails ORDER BY provider_message_id`)).map(r => r.provider_message_id);
  ok("§11 only mail to or from a sales contact is stored: the newsletter and the personal email are never kept", stored.join() === "m-out-1" && cap1.skipped === 2, { stored, cap1 });
  const links = (await q(`SELECT record_type, record_id FROM sales_email_links WHERE email_id = (SELECT id FROM sales_emails WHERE provider_message_id = 'm-out-1')`)).map(r => `${r.record_type}:${r.record_id}`).sort();
  ok("§11 a captured email links to the contact, its organization and its OPEN deal (not the lost one)",
    links.join() === [`contact:${c1}`, `deal:${dOpen}`, `org:${org}`].sort().join(), links);
  const dup = await MAIL.capture(ctx, mb, [msgs[0]]);
  ok("§11 the same message read twice is stored once", dup.stored === 0 && (await q(`SELECT COUNT(*)::int AS n FROM sales_emails`))[0].n === 1);
  // A prospect domain: mail with anyone there is kept, and links to the org with that domain.
  await S(sup, "PUT", "/mailbox/settings", { prospectDomains: "kestrel-lake.example.org", noReplyDays: 5 });
  await MAIL.capture(ctx, mb, [{ id: "m-domain", sent: false, from: "treasurer@kestrel-lake.example.org", to: [OWN], cc: [], subject: "Budget question", bodyText: "Quick one.", at: at(20) }]);
  const dlinks = (await q(`SELECT record_type FROM sales_email_links WHERE email_id = (SELECT id FROM sales_emails WHERE provider_message_id = 'm-domain')`)).map(r => r.record_type);
  ok("§11 mail with someone at a prospect domain is kept and links to that organization", dlinks.join() === "org", dlinks);
  const body = await q(`SELECT body_sealed FROM sales_emails WHERE provider_message_id = 'm-out-1'`);
  ok("§11 the body is sealed at rest", body[0].body_sealed && !body[0].body_sealed.includes("import guide"));

  const cp = await S(sup, "GET", `/rec/contact/${c1}`);
  ok("§11 the email shows on the contact's timeline (subject, date, direction)", cp.body.emails.some(e => e.subject === "Next steps on Kestrel" && e.direction === "out" && e.sent_at));
  const dp = await S(sup, "GET", `/rec/deal/${dOpen}`);
  ok("§11 and on the deal's", dp.body.emails.length === 1);
  const one = await S(sup, "GET", `/emails/${cp.body.emails[0].id}`);
  ok("§11 the body opens on click", one.body.email.body === "Here is the import guide.");
  ok("§11 'Last emailed' and 'No reply in 9 days' show on the contact and the deal (N = 5)",
    cp.body.reply.lastEmailedAt && cp.body.reply.noReplyDays === 9 && dp.body.reply.noReplyDays === 9, cp.body.reply);
  const home = await S(sup, "GET", "/home");
  ok("§11 a line in Today: no reply", home.body.today.lines.noReply.some(x => x.open.id === c1) && home.body.today.lines.noReply.some(x => x.open.id === dOpen));
  await MAIL.capture(ctx, mb, [{ id: "m-in-1", sent: false, from: "winona@kestrel-lake.example.org", to: [OWN], cc: [], subject: "Re: Next steps", bodyText: "Thanks!", at: at(1) }]);
  ok("§11 a reply clears 'no reply'", (await S(sup, "GET", `/rec/contact/${c1}`)).body.reply.noReplyDays === null);
  // The read asks the provider only about sales addresses and prospect domains.
  let asked = null;
  const fake = async (provider, token, terms) => { asked = terms; return { messages: [] }; };
  await q(`UPDATE sales_mailboxes SET credentials_sealed = NULL WHERE id = 'smb_t'`);
  const noToken = await MAIL.readNow(ctx, { ...mb, provider: "microsoft", credentials_sealed: null }, { fetcher: fake });
  ok("§11 with no permission held, the read stops and says to reconnect (no provider is asked)", noToken.error === "reconnect" && asked === null);
  const { sealBag } = await import("../shared/secretBox.js");
  const sealed = sealBag({ accessToken: "fake-token", refreshToken: null }, { aad: "sales" });
  const readOk = await MAIL.readNow(ctx, { ...mb, provider: "microsoft", credentials_sealed: sealed, token_expires_at: new Date(now + DAY).toISOString() }, { fetcher: fake });
  ok("§11 the read asks only for sales contacts' addresses and the prospect domains", readOk.ok && asked.sort().join() === ["basil.ferro@mailbox.example.net", "kestrel-lake.example.org", "winona@kestrel-lake.example.org"].sort().join(), asked);
  const ms = await S(sup, "GET", "/mailbox");
  ok("§11 nothing here sends: the mailbox screen says so", /Nothing is sent/.test(ms.body.sentence));
  const notConfirmed = await S(sup, "POST", "/mailbox/delete-captured", { confirm: "yes" });
  const disc = await S(sup, "POST", "/mailbox/smb_t/disconnect", {});
  const kept = (await q(`SELECT COUNT(*)::int AS n FROM sales_emails`))[0].n;
  ok("§11 Disconnect removes the connection and keeps the captured mail; delete needs DELETE typed", notConfirmed.status === 400 && disc.status === 200 && kept === 3
    && (await q(`SELECT status, credentials_sealed FROM sales_mailboxes WHERE id = 'smb_t'`))[0].status === "disconnected");
  const wipe = await S(sup, "POST", "/mailbox/delete-captured", { confirm: "DELETE" });
  ok("§11 'Delete captured sales email' wipes what was stored", wipe.body.emails === 3 && (await q(`SELECT COUNT(*)::int AS n FROM sales_email_links`))[0].n === 0);

  // ── §12 · PARTNERS AND TERMS ───────────────────────────────────────────────
  const ross = await S(sup, "POST", "/partners", { name: "Juniper Referral Co", company: "Juniper Referral Co", contact_name: "Marlo Quint", contact_email: "marlo@juniper-ref.example.org",
    terms: [{ kind: "finder", percent: 10, recurring: true, months: 12 }, { kind: "closer", percent: 40, recurring: false }] });
  const pj = (await S(sup, "GET", `/partners/${ross.body.id}`)).body;
  ok("§12 a partner with two terms: finder 10% for 12 months, closer 40% one-time", ross.status === 201 && pj.terms.length === 2 && pj.terms[0].says === "10% of MRR, monthly, 12 months" && pj.terms[1].says === "40% of MRR, one-time");
  const finder = pj.terms.find(t => t.kind === "finder").id, closer = pj.terms.find(t => t.kind === "closer").id;
  const badTerm = await S(sup, "POST", `/partners/${ross.body.id}/terms`, { kind: "reseller", percent: 5, flat_cents: 1000 });
  ok("§12 a term is a percent OR a flat amount", badTerm.status === 400);
  const a1 = await S(sup, "POST", `/deals/${dOpen}/partners`, { term_id: finder });
  const a2 = await S(sup, "POST", `/deals/${dOpen}/partners`, { term_id: closer });
  ok("§12 terms that don't stack: finder OR closer on one deal, never both", a1.status === 200 && a2.status === 400 && /don't stack/.test(a2.body.message));
  await S(sup, "PATCH", `/partners/${ross.body.id}`, { terms_stack: true });
  const a3 = await S(sup, "POST", `/deals/${dLost}/partners`, { term_id: finder });
  const a4 = await S(sup, "POST", `/deals/${dLost}/partners`, { term_id: closer });
  ok("§12 terms that stack: both on one deal", a3.status === 200 && a4.status === 200);
  await S(sup, "PATCH", `/partners/${ross.body.id}`, { terms_stack: false });
  const ov = await S(sup, "POST", `/deals/${dOpen}/partners`, { term_id: finder, override_percent: 15 });
  const dl = (await S(sup, "GET", `/rec/deal/${dOpen}`)).body.partners;
  ok("§12 the term is overridden on one deal (15% here), the partner's term is unchanged", ov.status === 200 && Number(dl[0].override.percent) === 15 && pj.terms[0].says.startsWith("10%"));
  await S(sup, "POST", `/partners/${ross.body.id}/orgs`, { org_id: org });
  ok("§12 a partner is associated to organizations", (await S(sup, "GET", `/partners/${ross.body.id}`)).body.orgs.some(o => o.id === org));

  // ── §13 · THE PAYOUT LEDGER ────────────────────────────────────────────────
  // By hand: 10% of $350 = $35.00 a month, months 1–12; month 13 owes nothing.
  const months = Array.from({ length: 14 }, (_, i) => `2026-${String((i % 12) + 1).padStart(2, "0")}`).map((m, i) => (i >= 12 ? `2027-${String(i - 11).padStart(2, "0")}` : m));
  const owed = PAY.owedByMonth(PAY.termOf({ percent: 10, recurring: true, months: 12 }), months, 35000);
  ok("§13 finder 10% of $350 MRR pays $35.00 in each of months 1–12", owed.slice(0, 12).every(m => m.cents === 3500));
  ok("§13 and nothing in month 13 or after: the term has ended", owed[12].cents === 0 && owed[13].cents === 0, owed.slice(11).map(m => m.cents));
  const once = PAY.owedByMonth(PAY.termOf({ percent: 40, recurring: false }), months.slice(0, 3), 35000);
  ok("§13 one-time closer 40%: $140.00 in month 1, then nothing", once.map(m => m.cents).join() === "14000,0,0");
  const capped = PAY.owedByMonth(PAY.termOf({ flat_cents: 10000, recurring: true, months: null, cap_cents: 25000 }), months.slice(0, 4), 0);
  ok("§13 flat $100 a month with no end and a $250 cap: 100, 100, 50, 0", capped.map(m => m.cents).join() === "10000,10000,5000,0" && capped[2].capped);
  ok("§13 a per-deal override wins: 15% of $350 = $52.50", PAY.owedByMonth(PAY.termOf({ percent: 10, recurring: true, months: 12 }, { override_percent: 15 }), ["2026-11"], 35000)[0].cents === 5250);
  // The live ledger: the deal won 2 months back, its org linked to the paying Steward org.
  await q(`UPDATE sales_orgs SET steward_org_id = $1 WHERE id = $2`, [CUST, org]);
  await S(sup, "POST", `/deals/${dOpen}/stage`, { stage_id: ST.Paying });
  await q(`UPDATE sales_deals SET won_at = $1 WHERE id = $2`, [new Date(now - 62 * DAY).toISOString(), dOpen]);
  const led = (await S(sup, "GET", `/ledger?partner=${ross.body.id}`)).body.ledger;
  const line = led.find(l => l.dealId === dOpen);
  ok("§13 the ledger: each month from the win to now, 15% of the org's $350 MRR now (the Onboarding tab's figure)",
    line && line.paying && line.mrrCents === 35000 && line.months.length >= 2 && line.months.every(m => m.owedCents === 5250), line);
  const pay = await S(sup, "POST", "/ledger/paid", { lineId: line.lineId, month: line.months[0].month, paid_on: "2026-10-31", note: "check 1042", amount_cents: 999999 });
  const led2 = (await S(sup, "GET", `/ledger?partner=${ross.body.id}`)).body.ledger.find(l => l.dealId === dOpen);
  const paidRow = (await q(`SELECT amount_cents, created_by FROM sales_payouts`))[0];
  ok("§13 a month marked paid with a day and a note, at the ledger's amount (never the browser's)", pay.status === 200 && led2.months[0].paid.note === "check 1042"
    && Number(paidRow.amount_cents) === 5250 && paidRow.created_by === "u_s1b_super");
  const stmt = await api("GET", `/ops/sales/statement/${ross.body.id}`, sup);
  ok("§13 the per-partner statement exports as CSV", /^Month,Deal,Term,Owed,Paid on,Note\r\n/.test(stmt.body) && /52\.50,2026-10-31,check 1042/.test(stmt.body), String(stmt.body).slice(0, 200));
  const lostLine = led.find(l => l.dealId === dLost);
  ok("§13 a deal never won owes nothing", lostLine && !lostLine.paying && lostLine.months.length === 0);

  // ── §14 · THE PARTNER REPORT ───────────────────────────────────────────────
  const rep = (await S(sup, "GET", "/partners")).body;
  const r = rep.report.find(x => x.partnerId === ross.body.id);
  const owedTotal = led2.months.reduce((n, m) => n + m.owedCents, 0);
  ok("§14 partner report: 2 deals sourced, 1 won, $350 MRR brought, owed = the ledger, paid $52.50",
    r.dealsSourced === 2 && r.dealsWon === 1 && r.mrrBroughtCents === 35000 && r.owedCents === owedTotal && r.paidCents === 5250 && r.dueCents === owedTotal - 5250, r);
  ok("§14 every figure on the report says what it counts", ["dealsSourced", "dealsWon", "mrrBrought", "owed", "paid", "due"].every(k => typeof rep.sentences[k] === "string"));

  await wipeSales();
  for (const o of [HOME, CUST]) await wipeOrg(o);
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch { /* */ } process.exit(1); });
