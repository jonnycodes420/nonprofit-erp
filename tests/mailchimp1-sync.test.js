// tests/mailchimp1-sync.test.js: MAILCHIMP-1. ONE BAD ADDRESS CAN'T BREAK THE CONNECTION.
//
// On 7 Oct TEST STEWARD's Mailchimp card read BROKEN with a repeating 400
// "Please provide a valid email address", and Steward had never read anything
// back. The 400 was Mailchimp refusing ONE address on the push
// (PUT /lists/{audience}/members/{md5}); `pushAudience` threw on it, the whole
// run was recorded as an error, `last_synced_at` was never set, and the card
// went broken every day.
//
// WHAT IS ASSERTED, against a stand-in for Mailchimp's API (nobody real is
// contacted; MAILCHIMP_API_BASE points the server here):
//   §1  A read where Mailchimp refuses one address still processes the rest:
//       the refused one is listed with Mailchimp's own reason, the others
//       are pushed, and the run is a success.
//   §2  Addresses Steward already knows are not real, and demo-file records,
//       are never offered to Mailchimp at all.
//   §3  The card reads HEALTHY with "1 address Mailchimp refused", the last
//       read time and how many records it updated.
//   §4  An unsubscribe for a known donor sets Steward's own opt-out
//       (`email_suppressions`, which donorMailDecision reads); an address that
//       is nobody in Steward is ignored.
//   §5  Opens and clicks land on the matching person's timeline.
//   §6  Without the push switch on, nothing is added to the audience.
//   §7  A revoked token reads BROKEN, in plain words.
//
// HOW IT WOULD GO RED: let a 400 on one member escape `pushAudience` (§1 and
// §3 go red: the run 502s and the card is broken); drop the `demo-file` or
// address check (§2); write a suppression for an unknown address (§4).
// Proven able to fail: with pushAudience's per-address catch removed, §1, §3
// and §5's "last read" go red.
//
// Standard scratch stack (tests/README.md), with MAILCHIMP_API_BASE set as in
// the run-all.sh header.

const http = require("http");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

process.env.STEWARD_CREDENTIAL_KEY = process.env.STEWARD_CREDENTIAL_KEY || "local-scratch-credential-key-0123456789";
const PORT = Number(process.env.MAILCHIMP_MOCK_PORT || 5618);
const ORG = "org_mc1sync";
const ADMIN = "admin@mc1sync.local";
const AUD = "aud_mc1";
const DOMAIN = "mc1-fixture.org";
const E = n => `${n}@${DOMAIN}`;
const REFUSED = E("gina");                     // Mailchimp refuses this one
const STRANGER = E("stranger");                // on the list, nobody in Steward

const TABLES = ["email_marketing_activity", "email_marketing_campaigns", "email_marketing_connections",
                "email_suppressions", "interactions", "gifts", "donors", "users"];

// ── THE STAND-IN ───────────────────────────────────────────────────────────
const seen = { puts: [], auth: [] };
const today = new Date().toISOString();
function mock(req, res) {
  const url = new URL(req.url, "http://x");
  const path = url.pathname.replace(/^\/mailchimp\/3\.0/, "");
  const send = (status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  let raw = "";
  req.on("data", c => { raw += c; });
  req.on("end", () => {
    seen.auth.push(req.headers.authorization || "");
    if (req.headers.authorization === "Bearer tok_revoked")
      return send(401, { title: "API Key Invalid", status: 401, detail: "Your API key may be invalid, or you've attempted to access the wrong datacenter." });
    if (req.method === "GET" && path === `/lists/${AUD}/members`) {
      const status = url.searchParams.get("status");
      if (status === "unsubscribed")
        return send(200, { members: [
          { email_address: E("marion"), status: "unsubscribed", last_changed: today },
          { email_address: STRANGER, status: "unsubscribed", last_changed: today }] });
      return send(200, { members: [], total_items: 0 });
    }
    if (req.method === "GET" && path === "/campaigns")
      return send(200, { campaigns: [{ id: "camp1", settings: { title: "October letter", subject_line: "October" },
        send_time: today, emails_sent: 4, report_summary: { unique_opens: 3, subscriber_clicks: 1 } }] });
    if (req.method === "GET" && path === "/reports/camp1/email-activity")
      return send(200, { emails: [
        { email_address: E("christine"), activity: [{ action: "open", timestamp: today }, { action: "click", timestamp: today, url: "https://x.org/give" }] },
        { email_address: E("david"), activity: [{ action: "open", timestamp: today }, { action: "unsub", timestamp: today }] },
        { email_address: STRANGER, activity: [{ action: "open", timestamp: today }] }] });
    if (req.method === "PUT" && path.startsWith(`/lists/${AUD}/members/`)) {
      const body = JSON.parse(raw || "{}");
      seen.puts.push(body.email_address);
      if (body.email_address === REFUSED)
        return send(400, { type: "https://mailchimp.com/developer/marketing/docs/errors/",
          title: "Invalid Resource", status: 400, detail: "Please provide a valid email address." });
      return send(200, { id: crypto.createHash("md5").update(body.email_address).digest("hex"), status: "subscribed" });
    }
    send(404, { title: "Resource Not Found", status: 404, detail: path });
  });
}

async function seal(token) {
  const { sealBag } = await import("../shared/secretBox.js");
  return sealBag({ accessToken: token, refreshToken: null, scope: null }, { aad: ORG });
}

async function reset() {
  for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
}

async function setup(push) {
  await reset();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
           VALUES ($1,'MC1 Sync','mc1-sync',1,'active','team')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_mc1sync',$1,$2,$3,'Admin','admin')`, [ORG, ADMIN, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO email_marketing_connections
             (id,org_id,provider,status,credentials_sealed,server_prefix,audience_id,audience_name,mapping,
              created_by,created_by_name)
           VALUES ('emc_mc1',$1,'mailchimp','active',$2,'us14',$3,'Newsletter',$4::jsonb,'system:test','test')`,
    [ORG, await seal("tok_good"), AUD,
     JSON.stringify({ audienceId: AUD, push, groups: push ? { "builtin:donors": "Donors" } : {} })]);
  const people = [
    ["d_mc1_christine", "Christine Hale", E("christine"), "[]"],
    ["d_mc1_david", "David Ortiz", E("david"), "[]"],
    ["d_mc1_marion", "Marion Reed", E("marion"), "[]"],
    ["d_mc1_gina", "Gina Park", REFUSED, "[]"],
    ["d_mc1_bad", "Bad Address", "frank@@mc1", "[]"],
    ["d_mc1_demo", "Demo Person", E("demo0001"), JSON.stringify(["demo-file"])],
  ];
  for (const [id, name, email, tags] of people) {
    await q(`INSERT INTO donors (id,org_id,name,email,tags,stage,total_giving,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,$5,'active',100,'system:test','test')`, [id, ORG, name, email, tags]);
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,created_by,created_by_name)
             VALUES ($1,$2,$3,100,CURRENT_DATE,'system:test','test')`, [`g_${id}`, ORG, id]);
  }
}

const card = async tok => {
  const r = await api("GET", "/connections", tok);
  return (r.body.cards || []).find(c => c.id === "email:mailchimp");
};

(async () => {
  const srv = await new Promise((resolve, reject) => {
    const s = http.createServer(mock);
    s.on("error", reject);
    s.listen(PORT, () => resolve(s));
  }).catch(e => { console.error("mock did not start:", e.message); return null; });
  ok("the Mailchimp stand-in is listening (without it this suite proves nothing)", !!srv, PORT);
  if (!srv) { summary(); await closeDb(); process.exit(1); }

  try {
    await setup(true);
    const tok = await login(ADMIN);

    // ── §2 first, through the preview: who is held back before anything goes ──
    const prev = await api("POST", "/email-marketing/mailchimp/preview", tok, { groups: { "builtin:donors": "Donors" } });
    const held = Object.fromEntries((prev.body.excluded || []).map(e => [e.key, e.count]));
    ok("§2 the preview holds back the address Steward knows is not real", held.bad_address === 1, JSON.stringify(held));
    ok("§2 …and the demo-file record", held.sample === 1, JSON.stringify(held));

    // ── §1 · ONE REFUSAL, AND THE RUN CARRIES ON ─────────────────────────
    seen.puts.length = 0;
    const r = await api("POST", "/email-marketing/mailchimp/sync", tok);
    ok("§1 the read succeeds although Mailchimp refused one address", r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
    const refused = r.body.refused || [];
    ok("§1 the refused address is listed", refused.length === 1 && refused[0].email === REFUSED, JSON.stringify(refused));
    ok("§1 …with Mailchimp's own reason, not its JSON",
      refused[0]?.reason === "Please provide a valid email address.", refused[0]?.reason);
    ok("§1 everybody else eligible was still pushed (Christine)", r.body.pushed === 1 && seen.puts.includes(E("christine")),
      `pushed=${r.body.pushed} puts=${JSON.stringify(seen.puts)}`);
    ok("§2 the not-real address and the demo record never reached Mailchimp",
      !seen.puts.includes("frank@@mc1") && !seen.puts.includes(E("demo0001")), JSON.stringify(seen.puts));
    ok("§4 the people who asked to stop were not pushed back",
      !seen.puts.includes(E("marion")) && !seen.puts.includes(E("david")), JSON.stringify(seen.puts));

    // ── §3 · THE CARD TELLS THE TRUTH ────────────────────────────────────
    const c = await card(tok);
    ok("§3 the card reads healthy, not broken", c && c.status === "healthy", JSON.stringify(c && { status: c.status, sentence: c.sentence }));
    ok("§3 it says how many addresses Mailchimp refused", c?.refusedSentence === "1 address Mailchimp refused.", c?.refusedSentence);
    ok("§3 and lists them for See them", (c?.refused || []).length === 1, JSON.stringify(c?.refused));
    ok("§3 it carries the last read time", !!c?.lastSyncedAt, c?.lastSyncedAt);
    ok("§3 and how many records it updated (Christine, David, Marion)", c?.lastUpdatedCount === 3, c?.lastUpdatedCount);

    // ── §4 · AN UNSUBSCRIBE IS STEWARD'S OPT-OUT ─────────────────────────
    const sup = async email => (await q(`SELECT 1 FROM email_suppressions WHERE org_id=$1 AND LOWER(email)=$2`, [ORG, email])).length;
    ok("§4 Marion, unsubscribed in Mailchimp, is opted out in Steward", await sup(E("marion")) === 1);
    ok("§4 David, who unsubscribed from the campaign, is opted out too", await sup(E("david")) === 1);
    const flags = await q(`SELECT id FROM donors WHERE org_id=$1 AND do_not_email=true ORDER BY id`, [ORG]);
    ok("§4 both records carry Steward's own email opt-out flag",
      flags.map(f => f.id).join(",") === "d_mc1_david,d_mc1_marion", JSON.stringify(flags));
    ok("§4 the address that is nobody in Steward is ignored", await sup(STRANGER) === 0);
    const strangers = await q(`SELECT 1 FROM donors WHERE org_id=$1 AND LOWER(email)=$2`, [ORG, STRANGER]);
    ok("§4 …and no person is created for it", strangers.length === 0);

    // ── §5 · OPENS AND CLICKS LAND ON THE PERSON ─────────────────────────
    const line = await q(`SELECT note FROM interactions WHERE org_id=$1 AND donor_id='d_mc1_christine'`, [ORG]);
    ok("§5 Christine's open and click are on her timeline",
      line.some(l => /Opened October letter, clicked/.test(l.note)), JSON.stringify(line));

    // A second read learns nothing new, so it changes no record.
    const r2 = await api("POST", "/email-marketing/mailchimp/sync", tok);
    ok("§3 a second read that learns nothing reports zero records updated", r2.body.updated === 0, JSON.stringify(r2.body));

    // ── §6 · NO PUSH SWITCH, NOTHING ADDED ───────────────────────────────
    await setup(false);
    const tok2 = await login(ADMIN);
    seen.puts.length = 0;
    const r3 = await api("POST", "/email-marketing/mailchimp/sync", tok2);
    ok("§6 with adding off, the read still runs", r3.status === 200, `${r3.status} ${JSON.stringify(r3.body)}`);
    ok("§6 …and nobody is added to the audience", seen.puts.length === 0 && r3.body.pushed === 0, JSON.stringify(seen.puts));

    // ── §7 · A REVOKED TOKEN IS BROKEN ───────────────────────────────────
    await q(`UPDATE email_marketing_connections SET credentials_sealed=$1 WHERE id='emc_mc1'`, [await seal("tok_revoked")]);
    const r4 = await api("POST", "/email-marketing/mailchimp/sync", tok2);
    ok("§7 a revoked token fails the read", r4.status === 502, `${r4.status}`);
    const c4 = await card(tok2);
    ok("§7 and the card reads broken", c4?.status === "broken", c4?.status);
    ok("§7 in plain words", /no longer accepts Steward's permission/.test(c4?.sentence || ""), c4?.sentence);
  } catch (e) {
    ok("suite ran without throwing", false, e.stack);
  } finally {
    await reset();
    srv.close();
    summary();
    await closeDb();
  }
})();
