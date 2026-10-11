// tests/connect2/constantcontact.js: CONNECT-2 Part 2. CONSTANT CONTACT READS
// WHO ASKED TO STOP, AND NEVER ADDS ANYBODY UNLESS SHE TURNED THAT ON.
//
// Run by tests/connect2-sources.test.js. Nothing real is contacted: the server
// reaches this stand-in through CONSTANT_CONTACT_API_BASE
// (http://localhost:<CONSTANT_CONTACT_MOCK_PORT>/constantcontact/v3). The
// stand-in answers in the shapes Constant Contact's v3 guide documents
// (developer.constantcontact.com/api_guide, read 11 Oct 2026):
//   /contacts?status=unsubscribed   contacts[].email_address.{address,opt_out_date}, _links.next.href
//   /emails                         campaigns[].{campaign_id,name,current_status}
//   /emails/{id}                    campaign_activities[].{campaign_activity_id,role}
//   /reports/stats/email_campaign_activities/{ids}  results[].stats.{em_sends,em_opens,em_clicks}
//   /reports/email_reports/{activity}/tracking/{opens|clicks|optouts}  tracking_activities[]
//
// WHAT IS ASSERTED
//   §1 An unsubscribe in Constant Contact, found on the SECOND page, sets
//      Steward's own opt-out: donors.do_not_email AND an email_suppressions row.
//   §2 An unsubscribed address that is nobody in Steward is ignored: no person
//      is created and nothing is suppressed for it.
//   §3 A contact with no address is skipped and counted; the run carries on.
//   §4 Only a sent ("Done") campaign is read; its counts come from the stats
//      report; an open lands one activity row and one timeline line; an opt-out
//      in the campaign report is Steward's opt-out too.
//   §5 A second read adds no second timeline line and updates no record.
//   §6 With adding off, Steward makes no request that is not a GET.
//   §7 With adding on, only an eligible person is offered, never one who asked
//      to stop.
//   §8 The card reads healthy with a last read time.
//
// HOW IT GOES RED: read only the first page of unsubscribes (§1); leave
// pullActivity's early return for Constant Contact in place (§4); create a
// donor for an unknown address (§2). Proven: with the paging loop cut to one
// page, §1 went red; restored, green.

const http = require("http");
const bcrypt = require("bcryptjs");

process.env.STEWARD_CREDENTIAL_KEY = process.env.STEWARD_CREDENTIAL_KEY || "local-scratch-credential-key-0123456789";

const ORG = "org_c2cc";
const ADMIN = "admin@c2cc-fixture.org";
const LIST = "list_c2cc";
const DOMAIN = "c2cc-fixture.org";
const E = n => `${n}@${DOMAIN}`;
const STRANGER = E("stranger");
const CAMP = "11111111-aaaa-4bbb-8ccc-000000000001";
const DRAFT = "11111111-aaaa-4bbb-8ccc-000000000002";
const ACT = "22222222-aaaa-4bbb-8ccc-000000000001";
const TABLES = ["email_marketing_activity", "email_marketing_campaigns", "email_marketing_connections",
                "email_suppressions", "interactions", "gifts", "donors", "users"];

const seen = { requests: [], signups: [] };
const today = new Date().toISOString();

function mock(req, res) {
  const url = new URL(req.url, "http://x");
  if (!url.pathname.startsWith("/constantcontact/v3")) { res.writeHead(404); return res.end("{}"); }
  const path = url.pathname.replace(/^\/constantcontact\/v3/, "");
  const send = (status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  let raw = "";
  req.on("data", c => { raw += c; });
  req.on("end", () => {
    seen.requests.push({ method: req.method, path, search: url.search });
    if (req.method === "GET" && path === "/contacts" && url.searchParams.get("status") === "unsubscribed") {
      // Page one: a stranger and a contact with no address. Page two: Marion.
      if (!url.searchParams.get("cursor"))
        return send(200, { contacts: [
          { contact_id: "c1", email_address: { address: STRANGER, permission_to_send: "unsubscribed", opt_out_date: today } },
          { contact_id: "c2", email_address: { permission_to_send: "unsubscribed" } }],
          _links: { next: { href: "/v3/contacts?status=unsubscribed&limit=500&cursor=p2" } } });
      return send(200, { contacts: [
        { contact_id: "c3", email_address: { address: E("marion").toUpperCase(), permission_to_send: "unsubscribed", opt_out_date: today } }],
        _links: {} });
    }
    if (req.method === "GET" && path === "/emails")
      return send(200, { campaigns: [
        { campaign_id: CAMP, name: "October letter", current_status: "Done", updated_at: today },
        { campaign_id: DRAFT, name: "Unsent draft", current_status: "Draft", updated_at: today }] });
    if (req.method === "GET" && path === `/emails/${CAMP}`)
      return send(200, { campaign_id: CAMP, campaign_activities: [
        { campaign_activity_id: "33333333-perm-reminder", role: "permission_reminder" },
        { campaign_activity_id: ACT, role: "primary_email" }] });
    if (req.method === "GET" && path === `/reports/stats/email_campaign_activities/${ACT}`)
      return send(200, { errors: [], results: [{ campaign_id: CAMP, campaign_activity_id: ACT,
        stats: { em_sends: 4, em_opens: 2, em_clicks: 1, em_optouts: 1 } }] });
    if (req.method === "GET" && path === `/reports/email_reports/${ACT}/tracking/opens`)
      return send(200, { tracking_activities: [
        { contact_id: "k1", email_address: E("christine"), tracking_activity_type: "em_opens", created_time: today },
        { contact_id: "k9", email_address: STRANGER, tracking_activity_type: "em_opens", created_time: today }], _links: {} });
    if (req.method === "GET" && path === `/reports/email_reports/${ACT}/tracking/clicks`)
      return send(200, { tracking_activities: [
        { contact_id: "k1", email_address: E("christine"), tracking_activity_type: "em_clicks",
          link_url: "https://c2cc-fixture.org/give", created_time: today }], _links: {} });
    if (req.method === "GET" && path === `/reports/email_reports/${ACT}/tracking/optouts`)
      return send(200, { tracking_activities: [
        { contact_id: "k2", email_address: E("david"), tracking_activity_type: "em_optouts", created_time: today }] });
    if (req.method === "POST" && path === "/contacts/sign_up_form") {
      const body = JSON.parse(raw || "{}");
      seen.signups.push(String(body.email_address || "").toLowerCase());
      return send(201, { contact_id: "new", action: "created" });
    }
    send(404, { error_key: "not_found", error_message: path });
  });
}

async function seal(token) {
  const { sealBag } = await import("../../shared/secretBox.js");
  return sealBag({ accessToken: token, refreshToken: null, scope: null }, { aad: ORG });
}

async function reset(q) {
  for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM email_suppressions WHERE LOWER(email) LIKE $1`, [`%@${DOMAIN}`]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
}

async function setup(q, push) {
  await reset(q);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
           VALUES ($1,'C2 Constant Contact','c2-constant-contact',1,'active','team')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_c2cc',$1,$2,$3,'Admin','admin')`, [ORG, ADMIN, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO email_marketing_connections
             (id,org_id,provider,status,credentials_sealed,audience_id,audience_name,mapping,created_by,created_by_name)
           VALUES ('emc_c2cc',$1,'constantcontact','active',$2,$3,'Newsletter',$4::jsonb,'system:test','test')`,
    [ORG, await seal("tok_good"), LIST,
     JSON.stringify({ audienceId: LIST, push, groups: push ? { "builtin:donors": "Donors" } : {} })]);
  for (const [id, name, email] of [["d_c2cc_christine", "Christine Hale", E("christine")],
                                   ["d_c2cc_david", "David Ortiz", E("david")],
                                   ["d_c2cc_marion", "Marion Reed", E("marion")]]) {
    await q(`INSERT INTO donors (id,org_id,name,email,stage,total_giving,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,'active',100,'system:test','test')`, [id, ORG, name, email]);
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,created_by,created_by_name)
             VALUES ($1,$2,$3,100,CURRENT_DATE,'system:test','test')`, [`g_${id}`, ORG, id]);
  }
}

async function run({ ok, login, api, q, ccPort }) {
  const port = Number(ccPort || process.env.CONSTANT_CONTACT_MOCK_PORT || 5618);
  const srv = await new Promise((resolve) => {
    const s = http.createServer(mock);
    s.on("error", e => { console.error("CC stand-in did not start:", e.message); resolve(null); });
    s.listen(port, () => resolve(s));
  });
  ok("the Constant Contact stand-in is listening (without it this part proves nothing)", !!srv, port);
  if (!srv) return;
  try {
    await setup(q, false);
    const tok = await login(ADMIN);
    seen.requests.length = 0;
    const r = await api("POST", "/email-marketing/constantcontact/sync", tok);
    ok("CC the read succeeds", r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);

    // §1
    const sup = async email => (await q(`SELECT 1 FROM email_suppressions WHERE org_id=$1 AND LOWER(email)=$2`, [ORG, email])).length;
    ok("CC §1 the unsubscribe on page two reached Steward (the second page was read)",
      seen.requests.some(x => x.path === "/contacts" && /cursor=p2/.test(x.search)) && await sup(E("marion")) === 1);
    const [marion] = await q(`SELECT do_not_email FROM donors WHERE id='d_c2cc_marion'`);
    ok("CC §1 Marion carries Steward's own email opt-out", marion && marion.do_not_email === true, JSON.stringify(marion));

    // §2
    ok("CC §2 the address that is nobody in Steward is not suppressed", await sup(STRANGER) === 0);
    const strangers = await q(`SELECT 1 FROM donors WHERE org_id=$1 AND LOWER(email)=$2`, [ORG, STRANGER]);
    ok("CC §2 …and no person is created for it", strangers.length === 0);

    // §3
    ok("CC §3 the contact with no address is skipped and counted", r.body.skipped === 1, JSON.stringify(r.body));
    ok("CC §3 …and the sentence says so", /had no usable address/.test(r.body.sentence || ""), r.body.sentence);

    // §4
    const camps = await q(`SELECT provider_campaign_id, sends, opens, clicks FROM email_marketing_campaigns WHERE org_id=$1`, [ORG]);
    ok("CC §4 only the sent campaign is read, not the draft", camps.length === 1 && camps[0].provider_campaign_id === CAMP, JSON.stringify(camps));
    ok("CC §4 its counts come from the stats report", camps[0] && camps[0].sends === 4 && camps[0].opens === 2 && camps[0].clicks === 1, JSON.stringify(camps));
    const acts = await q(`SELECT donor_id, opened, clicked, unsubscribed FROM email_marketing_activity WHERE org_id=$1 ORDER BY donor_id`, [ORG]);
    const chris = acts.find(a => a.donor_id === "d_c2cc_christine");
    ok("CC §4 Christine's open and click are one activity row", acts.filter(a => a.donor_id === "d_c2cc_christine").length === 1
      && chris.opened === true && chris.clicked === true, JSON.stringify(acts));
    ok("CC §4 the stranger's open lands nowhere", acts.length === 2, JSON.stringify(acts));
    const lines = async () => q(`SELECT note FROM interactions WHERE org_id=$1 AND donor_id='d_c2cc_christine' AND type='email'`, [ORG]);
    const first = await lines();
    ok("CC §4 one line on Christine's timeline", first.length === 1 && /Opened October letter, clicked/.test(first[0].note), JSON.stringify(first));
    ok("CC §4 David's opt-out in the campaign report is Steward's opt-out", await sup(E("david")) === 1);

    // §5
    const r2 = await api("POST", "/email-marketing/constantcontact/sync", tok);
    ok("CC §5 a second read succeeds", r2.status === 200, `${r2.status}`);
    ok("CC §5 …adds no second timeline line", (await lines()).length === 1);
    ok("CC §5 …and updates no record", r2.body.updated === 0, JSON.stringify(r2.body));

    // §6
    const writes = seen.requests.filter(x => x.method !== "GET");
    ok("CC §6 with adding off, every request Steward made was a GET", writes.length === 0, JSON.stringify(writes));

    // §7
    await setup(q, true);
    // The opt-outs from the first read are the org's history; set them again
    // so the push leg starts from the same truth.
    const tok2 = await login(ADMIN);
    seen.signups.length = 0;
    const r3 = await api("POST", "/email-marketing/constantcontact/sync", tok2);
    ok("CC §7 with adding on, the read succeeds", r3.status === 200, `${r3.status} ${JSON.stringify(r3.body)}`);
    ok("CC §7 Christine, who never asked to stop, is offered", seen.signups.includes(E("christine")), JSON.stringify(seen.signups));
    ok("CC §7 nobody who asked to stop is offered back (Constant Contact would re-subscribe them)",
      !seen.signups.includes(E("marion")) && !seen.signups.includes(E("david")) && !seen.signups.includes(STRANGER),
      JSON.stringify(seen.signups));

    // §8
    const cards = (await api("GET", "/connections", tok2)).body.cards || [];
    const card = cards.find(c => c.id === "email:constantcontact");
    ok("CC §8 the card reads healthy", card && card.status === "healthy", JSON.stringify(card && { status: card.status, sentence: card.sentence }));
    ok("CC §8 …with a last read time", !!(card && card.lastSyncedAt));
  } finally {
    await reset(q);
    await new Promise(r => srv.close(r));
  }
}

module.exports = { run };
