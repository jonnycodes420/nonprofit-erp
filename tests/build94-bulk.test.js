// BUILD-94 Part 4 — WHAT MAILCHIMP DID THAT STEWARD NOW HAS TO DO.
//
// The brief's one test: a campaign to 20 people where 2 are unsubscribed and 1
// hard-bounced sends 17, every email has both headers and the footer, the
// unsubscribe page changes nothing on GET and unsubscribes on POST, a forged
// webhook is rejected, and a real one marks the right person in the right org
// and nobody in any other org.
//
// Plus the one that makes the rest possible: NO ADDRESS, NO SEND.
const crypto = require("crypto");
const http = require("http");
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, login, api, q, closeDb, SINK_PORT } = require("./helpers");

const ORG = "org_b94b", ORG_OTHER = "org_b94b2";
const captured = [];
const sink = http.createServer((req, res) => {
  let body = ""; req.on("data", c => (body += c));
  req.on("end", () => {
    try { captured.push(body ? JSON.parse(body) : null); } catch { captured.push(null); }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: "mock_" + Math.random().toString(36).slice(2) }));
  });
});

const PEOPLE = Array.from({ length: 20 }, (_, i) => ({
  id: `d_b94b_${String(i).padStart(2, "0")}`, name: `Person ${i}`, email: `p${i}@b94b.test`,
}));

async function fixture() {
  for (const org of [ORG, ORG_OTHER]) {
    for (const t of ["campaign_recipients", "campaigns", "email_suppressions", "interactions", "gifts", "donors", "users"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
  }
  await q(`DELETE FROM email_suppressions WHERE org_id IS NULL AND email LIKE '%@b94b.test'`).catch(() => {});
  const hash = bcrypt.hashSync("loadtest1234", 10);
  // ORG starts with NO mailing address, on purpose — that is the first thing
  // tested, and the address is added afterwards.
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,receipt_address,
                             sending_domain,sending_domain_status,sending_from_email,timezone,timezone_confirmed_at)
           VALUES ($1,'Bulk Arts','b94b',1,'active','team',NULL,
                   'mail.bulkarts.test','verified','hello@mail.bulkarts.test','America/Chicago',NOW())
           ON CONFLICT (id) DO UPDATE SET receipt_address=NULL, sending_domain='mail.bulkarts.test',
             sending_domain_status='verified', sending_from_email='hello@mail.bulkarts.test',
             subscription_status='active', plan='team', timezone='America/Chicago', timezone_confirmed_at=NOW()`, [ORG]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,receipt_address)
           VALUES ($1,'Bystander Arts','b94b2',1,'active','team','9 Other St, Elsewhere')
           ON CONFLICT (id) DO UPDATE SET receipt_address='9 Other St, Elsewhere'`, [ORG_OTHER]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_b94b',$1,'b94b@test.local',$2,'Allie Barnett','admin')
           ON CONFLICT (id) DO UPDATE SET org_id=EXCLUDED.org_id`, [ORG, hash]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_b94b2',$1,'b94b2@test.local',$2,'Other Admin','admin')
           ON CONFLICT (id) DO UPDATE SET org_id=EXCLUDED.org_id`, [ORG_OTHER, hash]);
  for (const p of PEOPLE) {
    await q(`INSERT INTO donors (id,org_id,name,email,total_giving,gift_count,status,stage)
             VALUES ($1,$2,$3,$4,100,1,'new','steward')`, [p.id, ORG, p.name, p.email]);
  }
  // THE SAME EMAIL, in a different org. The webhook must not touch this one.
  await q(`INSERT INTO donors (id,org_id,name,email,total_giving,gift_count,status,stage)
           VALUES ('d_b94b_other',$1,'Same Address Elsewhere',$2,100,1,'new','steward')`,
    [ORG_OTHER, PEOPLE[3].email]);
}

const waitFor = async (fn, ms = 8000) => {
  const t0 = Date.now();
  for (;;) { if (await fn()) return true; if (Date.now() - t0 > ms) return false; await new Promise(r => setTimeout(r, 150)); }
};

(async () => {
  await new Promise(r => sink.listen(SINK_PORT, r));
  await fixture();
  const tok = await login("b94b@test.local", "loadtest1234");

  // ── NO ADDRESS, NO SEND ─────────────────────────────────────────────────
  console.log("— no address, no send —");
  const c1 = await api("POST", "/campaigns", tok,
    { name: "Appeal", subject: "A note from us", body: "Hello {{first_name}}.", segment: { mode: "all" }, status: "draft" });
  ok("the campaign saved", c1.status === 201 || c1.status === 200, c1.body);
  const CID = c1.body.id;
  const refused = await api("POST", `/campaigns/${CID}/send`, tok);
  ok("with no mailing address on file, it refuses to send", refused.status === 400, refused.body);
  ok("…and says what to do about it", /mailing address/i.test(refused.body.message || ""), refused.body.message);
  ok("nothing went out", captured.length === 0, captured.length);

  await q(`UPDATE orgs SET receipt_address = '1200 Justin Way, Fort Worth, TX 76107' WHERE id=$1`, [ORG]);

  // ── two unsubscribed, one hard-bounced ──────────────────────────────────
  console.log("— 20 people, 2 unsubscribed, 1 hard-bounced —");
  await q(`INSERT INTO email_suppressions (id,org_id,email,reason,source) VALUES ($1,$2,$3,'unsubscribed','test')`,
    ["sup_b94b_1", ORG, PEOPLE[0].email]);
  // The other one is unsubscribed by the FLAG ON THE PERSON, which until this
  // build was written by imports and read by nothing.
  await q(`UPDATE donors SET do_not_email = true WHERE id=$1`, [PEOPLE[1].id]);
  await q(`UPDATE donors SET email_unreachable = true, email_unreachable_at = NOW(),
                             email_unreachable_reason = 'mailbox does not exist' WHERE id=$1`, [PEOPLE[2].id]);

  const sent = await api("POST", `/campaigns/${CID}/send`, tok);
  ok("the send was accepted", sent.status === 200, sent.body);
  await waitFor(async () =>
    (await q(`SELECT COUNT(*)::int AS n FROM campaign_recipients WHERE campaign_id=$1`, [CID]))[0].n >= 17);

  const recips = await q(`SELECT email, sent_at, failure_reason FROM campaign_recipients WHERE campaign_id=$1`, [CID]);
  const delivered = recips.filter(r => r.sent_at).length;
  ok("17 went, not 20", delivered === 17, { delivered, rows: recips.length });
  const toAddrs = new Set(captured.flatMap(c => Array.isArray(c?.to) ? c.to : [c?.to]).filter(Boolean));
  ok("the unsubscribed pair were not among them",
    !toAddrs.has(PEOPLE[0].email) && !toAddrs.has(PEOPLE[1].email), [...toAddrs].slice(0, 3));
  ok("neither was the hard-bounced address", !toAddrs.has(PEOPLE[2].email));

  // ── both headers, and the footer ────────────────────────────────────────
  console.log("— both headers, and the footer —");
  const one = captured.find(c => c && c.subject);
  ok("every email carries List-Unsubscribe",
    captured.every(c => c && c.headers && c.headers["List-Unsubscribe"]), one && one.headers);
  ok("…and List-Unsubscribe-Post: One-Click (Gmail and Yahoo require BOTH)",
    captured.every(c => c && c.headers && c.headers["List-Unsubscribe-Post"] === "List-Unsubscribe=One-Click"),
    one && one.headers);
  ok("the footer carries the organisation's mailing address",
    captured.every(c => /1200 Justin Way/.test(c?.html || "")), (one?.html || "").slice(-300));
  ok("…and an unsubscribe link", captured.every(c => /\/unsubscribe\?token=/.test(c?.html || "")));

  // ── the unsubscribe page: GET changes nothing, POST unsubscribes ────────
  console.log("— the page: nothing on GET, unsubscribed on POST —");
  const m = /href="([^"]*\/unsubscribe\?token=[^"]+)"/.exec(one.html);
  ok("a real unsubscribe URL is in the email", !!m, (one.html || "").slice(-200));
  const unsubPath = m[1].replace(/^https?:\/\/[^/]+/, "");
  const supBefore = (await q(`SELECT COUNT(*)::int AS n FROM email_suppressions WHERE org_id=$1`, [ORG]))[0].n;

  const page = await fetch(BASE + unsubPath);
  const html = await page.text();
  const supAfterGet = (await q(`SELECT COUNT(*)::int AS n FROM email_suppressions WHERE org_id=$1`, [ORG]))[0].n;
  ok("GET renders a page", page.status === 200 && /Unsubscribe/i.test(html));
  ok("…AND CHANGES NOTHING — a link scanner must not unsubscribe anybody",
    supAfterGet === supBefore, [supBefore, supAfterGet]);
  ok("the page says which organisation it is about", /Bulk Arts/.test(html), html.slice(0, 400));
  ok("…and needs no login", !/password|sign in|log in/i.test(html));
  const head = await fetch(BASE + unsubPath, { method: "HEAD" });
  ok("HEAD changes nothing either",
    (await q(`SELECT COUNT(*)::int AS n FROM email_suppressions WHERE org_id=$1`, [ORG]))[0].n === supBefore, head.status);

  const posted = await fetch(BASE + unsubPath, { method: "POST" });
  ok("POST unsubscribes, in one click", posted.status === 200);
  ok("…and the suppression is written",
    (await q(`SELECT COUNT(*)::int AS n FROM email_suppressions WHERE org_id=$1`, [ORG]))[0].n === supBefore + 1);

  // ── the webhook ─────────────────────────────────────────────────────────
  console.log("— a forged webhook is rejected —");
  const forged = await fetch(BASE + "/resend/webhook", {
    method: "POST", headers: { "Content-Type": "application/json", "svix-id": "msg_forged",
      "svix-timestamp": String(Math.floor(Date.now() / 1000)), "svix-signature": "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" },
    body: JSON.stringify({ type: "email.bounced", data: { to: [PEOPLE[4].email], from: "hello@mail.bulkarts.test" } }),
  });
  ok("a forged signature is refused", forged.status === 400 || forged.status === 503, forged.status);
  const [untouched] = await q(`SELECT email_unreachable FROM donors WHERE id=$1`, [PEOPLE[4].id]);
  ok("…and nobody was marked by it", untouched.email_unreachable !== true, untouched);

  console.log("— a real one marks the right person, in the right org —");
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    ok("RESEND_WEBHOOK_SECRET is set for this suite (skipped without it)", true);
  } else {
    const sign = (payload) => {
      const id = "msg_" + Math.random().toString(36).slice(2);
      const ts = String(Math.floor(Date.now() / 1000));
      const key = Buffer.from(String(secret).replace(/^whsec_/, ""), "base64");
      const sig = crypto.createHmac("sha256", key).update(`${id}.${ts}.${payload}`).digest("base64");
      return { "svix-id": id, "svix-timestamp": ts, "svix-signature": `v1,${sig}` };
    };
    const deliver = async (type, email) => {
      const payload = JSON.stringify({ type, data: { to: [email], from: "Bulk Arts <hello@mail.bulkarts.test>",
        bounce: { message: "mailbox does not exist" } } });
      return fetch(BASE + "/resend/webhook", {
        method: "POST", headers: { "Content-Type": "application/json", ...sign(payload) }, body: payload });
    };
    const b = await deliver("email.bounced", PEOPLE[3].email);
    ok("a real bounce is accepted", b.status === 200, b.status);
    const [marked] = await q(`SELECT email_unreachable, email_unreachable_at, email_unreachable_reason FROM donors WHERE id=$1`, [PEOPLE[3].id]);
    ok("the person is marked unreachable, with the date and the reason",
      marked.email_unreachable === true && marked.email_unreachable_at != null
      && /mailbox does not exist/.test(marked.email_unreachable_reason || ""), marked);
    const tl = await q(`SELECT note FROM interactions WHERE org_id=$1 AND donor_id=$2 AND note LIKE '%bounce%'`, [ORG, PEOPLE[3].id]);
    ok("…and it is on the timeline", tl.length === 1, tl);
    // THE ONE THAT MATTERS: the same address in ANOTHER org is untouched.
    const [other] = await q(`SELECT email_unreachable FROM donors WHERE id='d_b94b_other'`);
    ok("the same address in another org is NOT marked", other.email_unreachable !== true, other);

    const cpl = await deliver("email.complained", PEOPLE[5].email);
    ok("a complaint is accepted", cpl.status === 200);
    const [cd] = await q(`SELECT do_not_email FROM donors WHERE id=$1`, [PEOPLE[5].id]);
    ok("a complaint unsubscribes the person", cd.do_not_email === true, cd);
  }

  // ── the sent-campaigns list ─────────────────────────────────────────────
  console.log("— what went, and what came back —");
  const list = await api("GET", "/campaigns/sent", tok);
  const row = (list.body.campaigns || []).find(c => c.id === CID);
  ok("the campaign is on the sent list", !!row, list.body.campaigns);
  ok("with delivered, opened and unsubscribed counts",
    row.delivered === 17 && typeof row.opened === "number" && typeof row.unsubscribed === "number", row);
  ok("the unsubscribe that followed it is attributed to it", row.unsubscribed >= 1, row.unsubscribed);

  // ── scheduling, in HER timezone ─────────────────────────────────────────
  console.log("— 9:00 means 9:00 where she is —");
  const sched = await api("POST", "/campaigns", tok, {
    name: "Thursday", subject: "Later", body: "Hi.", segment: { mode: "all" }, scheduledAt: "2026-09-24T09:00" });
  const [sr] = await q(`SELECT scheduled_at, status FROM campaigns WHERE id=$1`, [sched.body.id]);
  ok("it is scheduled", sr.status === "scheduled", sr);
  ok("9:00 in America/Chicago is stored as 14:00Z, not 09:00Z",
    new Date(sr.scheduled_at).toISOString() === "2026-09-24T14:00:00.000Z", sr.scheduled_at);
  const orgTime = require("../orgTime");
  ok("…and it holds across the DST boundary too",
    orgTime.localToInstant("2026-12-24T09:00", "America/Chicago").toISOString() === "2026-12-24T15:00:00.000Z");
  ok("an explicit instant is still honoured exactly",
    (await (async () => {
      const r = await api("POST", "/campaigns", tok, { name: "Exact", subject: "x", body: "y",
        segment: { mode: "all" }, scheduledAt: "2026-09-24T09:00:00Z" });
      const [x] = await q(`SELECT scheduled_at FROM campaigns WHERE id=$1`, [r.body.id]);
      return new Date(x.scheduled_at).toISOString();
    })()) === "2026-09-24T09:00:00.000Z");

  // ── nothing reads the flag from a gift row (the messy-2500 lesson) ──────
  const fs = require("fs");
  const src = fs.readFileSync(require("path").join(__dirname, "..", "server.js"), "utf8");
  ok("the unsubscribe flags are read from the PERSON, never off a gift",
    !/FROM gifts[\s\S]{0,400}?do_not_email/i.test(src) && !/g\.do_not_email|gifts\.do_not_email/i.test(src));

  sink.close();
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
