// tests/grants1-system.test.js · GRANTS-1's one test. GRANTS AS THEIR OWN SYSTEM.
//
// §1 award instalments: an awarded grant paid in two instalments links each
//    cheque (recorded through the ordinary gift form, the one gift path) to
//    its instalment, and the grant's received total foots to the cent; a gift
//    of another amount from the same funder is not grant money.
// §2 email: what goes to and comes from a funder lands on the funder and its
//    grant, attachments included, and nothing else lands on any grant.
//
// §2 runs the real mailbox sync (POST /mailbox/google/sync {what:"mail"})
// against a stand-in for Gmail on CALENDAR_MOCK_PORT (the server's
// GMAIL_API_BASE, the same stand-in port as GOOGLE_CALENDAR_API_BASE). The
// stand-in returns four messages whatever Steward asks for:
//   · Dana -> the funder's program officer, a real PDF attached and a "PDF"
//     that is really HTML: lands on the funder and on the OPEN grant (not the
//     more recently touched closed one), a grant_sends row direction out, the
//     PDF in the grant's documents (source mailbox, sent_to = the officer,
//     typed "report" from its name, dated in the org's zone), the HTML refused;
//   · the officer's reply: lands too, direction in;
//   · Dana -> an ordinary donor with a PDF: the donor's own line as before, and
//     nothing on any grant or funder, and the attachment is never fetched;
//   · Dana -> somebody not on file: nothing anywhere.
// Then the BCC path: Dana BCCs the logging address on an email to the officer
// with the PDF in the payload; it lands on the same grant through the same
// function (source bcc). A second sync adds nothing.
//
// Donor data and email: a funder report filed on the wrong grant, or a
// stranger's mail filed on a grant, is the record lying about who was told what.
//
// HOW IT WOULD GO RED (§1): sum the funder's gifts instead of the award
// pledge's (the stray gift counts and received is wrong); skip the instalment
// apply in recordGift (no instalment shows its gift). Proven able to fail by
// summing by donor: §1 went red.
// HOW IT WOULD GO RED (§2): skip the attachment store (no grant document, §2
// "the PDF is in the grant's documents"); pick the grant by recency alone (the
// closed grant gets the email); route on any matched person rather than a
// funder contact (the ordinary donor's email lands on a grant); drop the type
// sniff (the HTML "PDF" is stored); stop deduping on message_id (the re-sync
// doubles the rows). Proven able to fail by skipping the attachment store
// (routeToFunderGrant never calling storeAttachment): §2 went red.

const http = require("http");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const BASE = process.env.BASE || "http://localhost:5601";
const PORT = Number(process.env.CALENDAR_MOCK_PORT || 5618);
process.env.STEWARD_CREDENTIAL_KEY = process.env.STEWARD_CREDENTIAL_KEY || "local-scratch-credential-key-0123456789";

const ORG = "org_grants1_a", ORG2 = "org_grants1_b";
const SLUG = "grants1-a";
const USER = `u_${ORG}`, DANA = `dana@${ORG}.example.com`;
const OFFICER = "officer@riverbend-fdn.example.com";
const DONOR = "marion@donor.example.com";
const STRANGER = "stranger@nowhere.example.com";
const SECRET_SUBJECT = "Weekend plans, nothing to do with work";

// A real PDF's first bytes, and an HTML page wearing a .pdf name.
const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n");
const FAKE_PDF = Buffer.from("<!doctype html><html><script>alert(1)</script></html>");
const b64url = b => b.toString("base64url");
const b64 = s => Buffer.from(s).toString("base64url");

// 02:30 UTC on 6 Oct is still 5 Oct in New York: the date must be the org's.
const T_OUT = Date.parse("2026-10-06T02:30:00Z");
const T_IN = Date.parse("2026-10-06T15:00:00Z");

const part = (filename, mimeType, attachmentId, size) => ({ filename, mimeType, body: { attachmentId, size } });
const msg = (id, t, from, to, subject, text, parts = []) => ({
  id, internalDate: String(t), snippet: text,
  payload: { mimeType: "multipart/mixed",
    headers: [{ name: "From", value: from }, { name: "To", value: to }, { name: "Subject", value: subject }],
    parts: [{ mimeType: "text/plain", filename: "", body: { data: b64(text) } }, ...parts] },
});
const MESSAGES = {
  m_g1_out: msg("m_g1_out", T_OUT, `Dana <${DANA}>`, `Ruth Okafor <${OFFICER}>`, "Our spring report",
    "Ruth, the spring report is attached.", [part("Spring Report 2026.pdf", "application/pdf", "att_pdf", PDF.length),
                                              part("invoice.pdf", "application/pdf", "att_fake", FAKE_PDF.length)]),
  m_g1_in: msg("m_g1_in", T_IN, `Ruth Okafor <${OFFICER}>`, DANA, "Re: Our spring report", "Thank you, received."),
  m_g1_donor: msg("m_g1_donor", T_IN, DANA, DONOR, "Thank you, Marion", "Your gift arrived.",
    [part("Receipt.pdf", "application/pdf", "att_donor", PDF.length)]),
  m_g1_stranger: msg("m_g1_stranger", T_IN, DANA, STRANGER, SECRET_SUBJECT, "See you Saturday.",
    [part("Plans.pdf", "application/pdf", "att_stranger", PDF.length)]),
};
const ATTACHMENTS = { att_pdf: PDF, att_fake: FAKE_PDF, att_donor: PDF, att_stranger: PDF };

const hits = [];
const mock = http.createServer((req, res) => {
  hits.push(req.url);
  const u = new URL(req.url, "http://x");
  const send = (code, body) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  let m;
  if ((m = u.pathname.match(/^\/gmail\/v1\/users\/me\/messages\/([^/]+)\/attachments\/([^/]+)$/))) {
    const buf = ATTACHMENTS[decodeURIComponent(m[2])];
    return buf ? send(200, { size: buf.length, data: b64url(buf) }) : send(404, {});
  }
  if ((m = u.pathname.match(/^\/gmail\/v1\/users\/me\/messages\/([^/]+)$/))) {
    const full = MESSAGES[decodeURIComponent(m[1])];
    return full ? send(200, full) : send(404, {});
  }
  if (u.pathname === "/gmail/v1/users/me/messages") return send(200, { messages: Object.keys(MESSAGES).map(id => ({ id })) });
  send(200, { items: [] });
});

const TABLES = ["grant_documents", "grant_sends", "interactions", "donor_relationships", "grant_milestones", "grants",
  "mailbox_connections", "inbound_email_unmatched", "inbound_email_drops", "asset_pointer_history", "portal_assets",
  "threads", "donors", "users", "fin_transactions", "budgets", "accounts", "fin_funds"];
async function reset() {
  for (const o of [ORG, ORG2]) {
    for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}

(async () => {
  await new Promise(r => mock.listen(PORT, r));
  await reset();

  // ── §1 · an awarded grant's two instalments, each linked to its gift ─────
  // The award is recorded through PUT /grants/:id/award (one pledge, two
  // instalments). Each cheque is recorded through the ordinary gift form, the
  // one gift path, and applies itself to its instalment. The grant's received
  // total is the sum of exactly those gifts and foots to the cent; a gift of
  // another amount from the same funder is not grant money.
  console.log("\n§1 award instalments");
  {
    const A_ORG = "org_grants1_award";
    const clearA = async () => {
      await q(`UPDATE pledges SET fulfilled_gift_id=NULL WHERE org_id=$1`, [A_ORG]).catch(() => {});
      for (const t of ["thank_you_drafts", "pledge_installments", "fin_transactions", "gifts", "pledges", "grants", "interactions", "tasks", "budgets", "accounts", "fin_funds", "donors", "user_sessions", "users"]) await q(`DELETE FROM ${t} WHERE org_id=$1`, [A_ORG]).catch(() => {});
      await q(`DELETE FROM orgs WHERE id=$1`, [A_ORG]).catch(() => {});
    };
    await clearA();
    const pw1 = bcrypt.hashSync("loadtest1234", 4);
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at)
             VALUES ($1,'Grants award fixture','grants1-award',1,'active','team','America/New_York',NOW())`, [A_ORG]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Ada','admin')`, [`u_${A_ORG}`, A_ORG, `ada@${A_ORG}.local`, pw1]);
    const atok = await login(`ada@${A_ORG}.local`);
    await api("POST", "/onboarding/complete", atok, {});
    const f = await api("POST", "/grant-funders", atok, { name: "Award Fixture Foundation", funderType: "private_foundation" });
    ok("§1 the funder is on file", f.status === 201, f.body);
    await q(`INSERT INTO grants (id,org_id,funder,funder_donor_id,program,status,amount_requested,created_by,created_by_name)
             VALUES ('gr_g1_award',$1,'Award Fixture Foundation',$2,'Boats','submitted',12345.67,'system:test','test')`, [A_ORG, f.body.id]);
    const aw = await api("PUT", "/grants/gr_g1_award/award", atok, { amountAwarded: "12345.67", installmentCount: 2, frequency: "semiannual", firstDue: "2026-01-15" });
    ok("§1 the award is recorded with two instalments", aw.status === 200, aw.body);
    let plan = (await api("GET", "/grants/gr_g1_award/award-plan", atok)).body;
    const inst = plan.installments || [];
    ok("§1 two instalments that sum to the award, to the cent", inst.length === 2 && inst[0].amountCents + inst[1].amountCents === 1234567 && plan.awardedCents === 1234567, plan);
    const give = (cents, date) => api("POST", `/donors/${f.body.id}/gifts`, atok, { amount: (cents / 100).toFixed(2), date, type: "cash", paymentMethod: "Check" });
    const g1 = await give(inst[0].amountCents, "2026-01-20");
    plan = (await api("GET", "/grants/gr_g1_award/award-plan", atok)).body;
    ok("§1 the first cheque links itself to the first instalment", g1.status === 201 && plan.installments[0].gift && plan.installments[0].gift.amountCents === inst[0].amountCents && !plan.installments[1].gift, plan.installments);
    ok("§1 received is the first cheque, and the rest is outstanding", plan.receivedCents === inst[0].amountCents && plan.outstandingCents === inst[1].amountCents, plan);
    const stray = await give(5000, "2026-02-01");
    plan = (await api("GET", "/grants/gr_g1_award/award-plan", atok)).body;
    ok("§1 a gift of another amount from the funder is not grant money", stray.status === 201 && plan.receivedCents === inst[0].amountCents, plan);
    const g2 = await give(inst[1].amountCents, "2026-07-20");
    plan = (await api("GET", "/grants/gr_g1_award/award-plan", atok)).body;
    ok("§1 the second cheque links itself to the second instalment", g2.status === 201 && plan.installments.every(i => i.gift) && plan.installments[1].gift.amountCents === inst[1].amountCents, plan.installments);
    const [sum] = await q(`SELECT COALESCE(SUM(gf.amount),0)::numeric AS s FROM gifts gf JOIN pledge_installments pi ON pi.paid_gift_id = gf.id WHERE pi.org_id=$1`, [A_ORG]);
    ok("§1 the received total foots to the cent: $12,345.67, the sum of the two linked gifts", plan.receivedCents === 1234567 && Math.round(Number(sum.s) * 100) === 1234567 && plan.outstandingCents === 0, { plan, sum });
    const restricted = await api("GET", "/grants/gr_g1_award/restricted", atok);
    ok("§1 …and every other screen reads the same received figure", restricted.status === 200 && restricted.body.balance && restricted.body.balance.receivedCents === 1234567, restricted.body);
    await clearA();
    const [left] = await q(`SELECT COUNT(*)::int AS n FROM orgs WHERE id=$1`, [A_ORG]);
    ok("§1 the fixture cleans up after itself", left.n === 0, left);
  }

  // ── §2 email ─────────────────────────────────────────────────────────────
  const pw = bcrypt.hashSync("loadtest1234", 4);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at)
           VALUES ($1,'Grants One',$2,1,'active','team','America/New_York',NOW())`, [ORG, SLUG]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Grants One B','grants1-b',1,'active','team')`, [ORG2]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Dana Reyes','admin')`, [USER, ORG, DANA, pw]);
  const sys = "'system:test','test'";
  await q(`INSERT INTO donors (id,org_id,name,email,stage,person_types,created_by,created_by_name) VALUES
           ('d_g1_fdn',$1,'Riverbend Foundation',NULL,'active','["organization"]'::jsonb,${sys}),
           ('d_g1_officer',$1,'Ruth Okafor',$2,'active','["contact"]'::jsonb,${sys}),
           ('d_g1_donor',$1,'Marion Hale',$3,'active','["donor"]'::jsonb,${sys})`, [ORG, OFFICER, DONOR]);
  // The same officer address in another org: never a match from this one.
  await q(`INSERT INTO donors (id,org_id,name,email,stage,created_by,created_by_name) VALUES ('d_g1_b_officer',$1,'Ruth Okafor',$2,'active',${sys})`, [ORG2, OFFICER]);
  await q(`INSERT INTO donor_relationships (id,org_id,donor_id_a,donor_id_b,relationship_type,created_by,created_by_name)
           VALUES ('rel_g1',$1,'d_g1_fdn','d_g1_officer','program_officer',${sys})`, [ORG]);
  // Two grants from this funder: the closed one touched most recently, the
  // submitted one is the live ask and is where the email belongs.
  await q(`INSERT INTO grants (id,org_id,funder,program,status,funder_donor_id,amount,updated_at) VALUES
           ('g_g1_open',$1,'Riverbend Foundation','Youth reading','submitted','d_g1_fdn',25000,NOW() - INTERVAL '20 days'),
           ('g_g1_old',$1,'Riverbend Foundation','2024 cycle','closed','d_g1_fdn',10000,NOW() - INTERVAL '1 day')`, [ORG]);
  const { sealBag } = await import("../shared/secretBox.js");
  const sealed = sealBag({ accessToken: "tok_test", refreshToken: "ref_test", scope: null }, { aad: ORG });
  await q(`INSERT INTO mailbox_connections (id,org_id,user_id,provider,address,status,credentials_sealed,token_expires_at,created_by,created_by_name)
           VALUES ('mbx_g1',$1,$2,'google',$3,'active',$4,NOW() + INTERVAL '1 day',${sys})`, [ORG, USER, DANA, sealed]);

  const dana = await login(DANA);
  const path = await api("GET", "/grants/email-path", dana);
  ok("§2 the org is on the mailbox path, said in a sentence", path.status === 200 && path.body.path === "mailbox"
    && path.body.connectedPeople === 1 && path.body.sentence === "Email to funders arrives from Dana's Gmail.", path.body);

  const r = await api("POST", "/mailbox/google/sync", dana, { what: "mail" });
  ok("§2 the sync ran", r.status === 200 && r.body.mail, `${r.status} ${r.text}`);

  const sends = await q(`SELECT * FROM grant_sends WHERE org_id=$1 ORDER BY direction DESC`, [ORG]);
  const out = sends.find(s => s.message_id === "m_g1_out"), inn = sends.find(s => s.message_id === "m_g1_in");
  ok("§2 the email to the officer is a send on the OPEN grant", !!out && out.grant_id === "g_g1_open" && out.direction === "out"
    && out.source === "mailbox" && out.what === "email" && out.funder_donor_id === "d_g1_fdn", out);
  ok("§2 the send names the officer and is dated in the org's zone", !!out && out.sent_to_email === OFFICER
    && out.sent_to_name === "Ruth Okafor" && out.sent_on === "2026-10-05" && out.subject === "Our spring report", out);
  ok("§2 the send carries the mailbox's system actor", !!out && out.created_by === `system:mailbox/google/${USER}`, out && out.created_by);
  ok("§2 the officer's reply lands too, direction in", !!inn && inn.grant_id === "g_g1_open" && inn.direction === "in"
    && inn.sent_to_email === OFFICER && inn.sent_on === "2026-10-06", inn);
  ok("§2 exactly the two funder messages are sends", sends.length === 2, sends.map(s => s.message_id));

  const docs = await q(`SELECT * FROM grant_documents WHERE org_id=$1`, [ORG]);
  const pdf = docs.find(d => d.file_name === "Spring Report 2026.pdf");
  ok("§2 the PDF is in the grant's documents", !!pdf && pdf.grant_id === "g_g1_open" && pdf.source === "mailbox"
    && pdf.content_type === "application/pdf" && pdf.bytes === PDF.length, docs);
  ok("§2 the document says who it went to, when, and from which message", !!pdf && pdf.sent_to_email === OFFICER
    && pdf.sent_to_name === "Ruth Okafor" && pdf.sent_on === "2026-10-05" && pdf.message_id === "m_g1_out"
    && pdf.doc_type === "report" && pdf.uploaded_by === `system:mailbox/google/${USER}`, pdf);
  ok("§2 the HTML wearing a .pdf name was refused", !docs.some(d => d.file_name === "invoice.pdf"), docs.map(d => d.file_name));
  ok("§2 the grant's documents read back through the documents route", (await api("GET", "/grants/g_g1_open/documents", dana))
    .body?.documents?.some(d => d.fileName === "Spring Report 2026.pdf"), "missing");

  const funderInts = await q(`SELECT * FROM interactions WHERE org_id=$1 AND donor_id='d_g1_fdn' ORDER BY date`, [ORG]);
  ok("§2 both funder messages are on the funder's own timeline, with the grant",
    funderInts.length === 2 && funderInts.every(i => i.metadata && i.metadata.grant_id === "g_g1_open")
    && funderInts.every(i => i.created_by === `system:mailbox/google/${USER}`), funderInts.map(i => i.metadata));
  ok("§2 and on the officer's", (await q(`SELECT 1 FROM interactions WHERE org_id=$1 AND donor_id='d_g1_officer'`, [ORG])).length === 2, "missing");

  // The ordinary donor: her line as before, and nothing on any grant.
  const donorInts = await q(`SELECT * FROM interactions WHERE org_id=$1 AND donor_id='d_g1_donor'`, [ORG]);
  ok("§2 the ordinary donor's email is on her record as before", donorInts.length === 1, donorInts.length);
  ok("§2 and on no grant and no funder", !sends.some(s => s.message_id === "m_g1_donor")
    && !docs.some(d => d.message_id === "m_g1_donor") && !funderInts.some(i => i.metadata.message_id === "m_g1_donor"), "leaked");
  ok("§2 her attachment was never fetched", !hits.some(h => /att_donor|att_stranger/.test(h)), hits.filter(h => /attachments/.test(h)));

  // Somebody not on file: nothing at all.
  const [{ n: strangerRows }] = await q(
    `SELECT (SELECT COUNT(*) FROM interactions WHERE row_to_json(interactions)::text ILIKE $1)
          + (SELECT COUNT(*) FROM grant_sends WHERE row_to_json(grant_sends)::text ILIKE $1)
          + (SELECT COUNT(*) FROM grant_documents WHERE row_to_json(grant_documents)::text ILIKE $1) AS n`, [`%m_g1_stranger%`]);
  const [{ n: secretRows }] = await q(
    `SELECT (SELECT COUNT(*) FROM interactions WHERE row_to_json(interactions)::text ILIKE $1)
          + (SELECT COUNT(*) FROM grant_sends WHERE row_to_json(grant_sends)::text ILIKE $1) AS n`, [`%${SECRET_SUBJECT}%`]);
  ok("§2 an email to somebody not on file stores nothing", Number(strangerRows) === 0 && Number(secretRows) === 0, { strangerRows, secretRows });
  ok("§2 the other org got nothing", (await q(`SELECT 1 FROM interactions WHERE org_id=$1`, [ORG2])).length === 0, "leaked");

  // Again: the same messages add nothing.
  await api("POST", "/mailbox/google/sync", dana, { what: "mail" });
  const [{ s: s2, d: d2 }] = await q(`SELECT (SELECT COUNT(*) FROM grant_sends WHERE org_id=$1)::int AS s,
                                             (SELECT COUNT(*) FROM grant_documents WHERE org_id=$1)::int AS d`, [ORG]);
  ok("§2 a second sync adds nothing", s2 === 2 && d2 === 1, { s2, d2 });

  // The BCC path, through the same function.
  const bcc = await fetch(`${BASE}/inbound-email?secret=local-inbound-secret`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from: DANA, to: OFFICER, bcc: `log+${SLUG}@log.stewardapp.dev`, subject: "Budget for the renewal",
      text: "Ruth, the budget is attached.", date: "2026-10-06T16:00:00Z", messageId: "<bcc-g1@example.com>",
      attachments: [{ filename: "Renewal budget.pdf", content_type: "application/pdf", content: PDF.toString("base64") }] }),
  });
  const bccBody = await bcc.json().catch(() => ({}));
  ok("§2 the BCC address is on", bcc.status === 200, `${bcc.status} ${JSON.stringify(bccBody)}`);
  const [bs] = await q(`SELECT * FROM grant_sends WHERE org_id=$1 AND message_id='<bcc-g1@example.com>'`, [ORG]);
  ok("§2 a BCC'd email to the officer is a send on the open grant", !!bs && bs.grant_id === "g_g1_open" && bs.source === "bcc"
    && bs.direction === "out" && bs.sent_to_email === OFFICER && bs.created_by === "system:inbound-email", bs);
  const [bd] = await q(`SELECT * FROM grant_documents WHERE org_id=$1 AND message_id='<bcc-g1@example.com>'`, [ORG]);
  ok("§2 its attachment is a grant document", !!bd && bd.source === "bcc" && bd.doc_type === "budget" && bd.sent_to_email === OFFICER, bd);

  mock.close();
  await reset();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); mock.close(); await reset().catch(() => {}); await closeDb().catch(() => {}); process.exit(1); });
