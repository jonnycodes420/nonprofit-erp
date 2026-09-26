// BUILD-97 Part 5 — OBSERVABILITY, BECAUSE YOU CANNOT RUN WHAT YOU CANNOT SEE.
//
// The 22 September incident ran for TWELVE DAYS. It was found in a Resend log
// at eleven at night, by somebody who went looking because three delivered
// messages turned up. The brief's own sentence: "The incident on the 22nd would
// have shown here in one line at 3 PM instead of in a Resend log at 11."
//
//   §1  THE CHOKE POINT THAT DID NOT EXIST. The incident write-up's last open
//       item was that server.js has ~20 separate `resend.emails.send(` call
//       sites and no single place they pass through. There are 26. Wrapping the
//       CLIENT catches every one of them and every future one — a refactor of
//       26 call sites would not have caught the 27th.
//
//   §2  THE RECIPIENT DOMAIN, NEVER THE ADDRESS. A super-admin needs to see
//       that mail went to yahoo.com from a demo org. They do not need a list of
//       donors' email addresses in an ops table.
//
//   §3  THE ONE LINE THAT WOULD HAVE ENDED THE INCIDENT ON DAY ONE, reproduced:
//       a demo org, a real mailbox provider, and the page saying so as a
//       headline rather than as a row somebody has to spot.
//
//   §4  A TICK THAT FAILS IS VISIBLE. Nine jobs ran on timers with nowhere to
//       report to.
//
//   §5  IT IS SUPER-ADMIN ONLY, and it is a READ.
//
// Standard scratch stack (tests/README.md).

const fs = require("fs"), path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
const { readSource } = require("../scripts/lib/readSource");

const root = path.join(__dirname, "..");
const ORG_DEMO = "org_b97obs_demo", ORG_REAL = "org_b97obs_real";
const PASS = "loadtest1234";
const SUPER = "obs-super@b97.example.org", PLAIN = "obs-plain@b97.example.org";

async function reset() {
  for (const o of [ORG_DEMO, ORG_REAL]) {
    await q(`DELETE FROM email_log WHERE org_id=$1`, [o]).catch(() => {});
    for (const t of ["agent_writes", "agent_drafts", "agent_runs", "agent_instructions",
                     "donors", "users", "fin_transactions", "budgets", "accounts", "fin_funds"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
  await q(`DELETE FROM tick_log WHERE name LIKE 'b97obs%'`).catch(() => {});
}

(async () => {
  console.log("build97-observability");
  const serverSrc = readSource("server.js");

  await reset();
  // A DEMO org (mail off, marked fiction) and an ordinary one.
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,
                             receipt_address,is_demo_org,emails_enabled)
           VALUES ($1,'Fiction Works','b97obs-demo',1,'team','active','1 Main St',TRUE,FALSE)`, [ORG_DEMO]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,
                             receipt_address,is_demo_org,emails_enabled)
           VALUES ($1,'Real Customer','b97obs-real',1,'team','active','1 Main St',FALSE,TRUE)`, [ORG_REAL]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin)
           VALUES ($1,$2,$3,$4,'Ops','admin',TRUE)`,
    ["u_b97obs_s", ORG_REAL, SUPER, bcrypt.hashSync(PASS, 4)]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ($1,$2,$3,$4,'Staff','admin')`,
    ["u_b97obs_p", ORG_DEMO, PLAIN, bcrypt.hashSync(PASS, 4)]);
  const superTok = await login(SUPER, PASS);
  const plainTok = await login(PLAIN, PASS);

  // ── §1 · THE CHOKE POINT ─────────────────────────────────────────────────
  console.log("\n— §1 · every send passes through ONE place —");
  // There is exactly ONE construction of the real client, and the name it is
  // bound to is not the one the 26 call sites use.
  ok("the raw Resend client is constructed once, under its own name",
     (serverSrc.match(/const _rawResend = new Resend\(/g) || []).length === 1,
     (serverSrc.match(/new Resend\(/g) || []).length);
  ok("…and `resend` is a PROXY over it, not a replacement for it",
     /const resend = new Proxy\(_rawResend,/.test(serverSrc));
  // A WRAPPER THAT REPLACES AN OBJECT DELETES EVERYTHING IT DID NOT COPY. The
  // first cut of this was an object literal with one method on it, and
  // `resend.domains.create` silently became undefined — the sending-domain
  // claim route started answering "could not reach the mail provider", and the
  // full battery caught it (build88c-domain). A proxy passes through what it
  // did not come to change, and this asserts it still can.
  ok("…so the rest of the client still works (domains, and anything a future SDK adds)",
     /Reflect\.get\(target, prop, receiver\)/.test(serverSrc));
  ok("…and the one route that needs it still calls it",
     /resend\.domains\.create\(/.test(serverSrc));
  ok("…which logs every send", /_logOutboundEmail\(opts, out, thrown/.test(serverSrc));
  // THE PROPERTY THAT MATTERS: only the ops alert reaches past the wrapper, and
  // it does so deliberately — an alert about mail must not depend on the thing
  // it is alerting about. Any OTHER use would be a send nothing recorded, which
  // is the state the incident write-up described.
  const rawUses = [...serverSrc.matchAll(/_rawResend\.emails\.send/g)].length;
  ok("only the ops alert reaches past the wrapper", rawUses === 1, rawUses);
  ok("…and that is the alert, deliberately",
     /_rawResend\.emails\.send\(\{[\s\S]{0,200}\[Steward\]/.test(serverSrc));
  const sendSites = (serverSrc.match(/\bresend\.emails\.send\(/g) || []).length;
  ok("…and every one of the call sites still goes through `resend`", sendSites >= 20, sendSites);
  // Proven by BEHAVIOUR, not only by reading: send something and find the row.
  const before = await q(`SELECT COUNT(*)::int AS n FROM email_log`);
  // A password reset is the simplest real send path in the product, and it is
  // one nobody has to be a donor to trigger.
  await api("POST", "/auth/forgot-password", null, { email: SUPER });
  await new Promise(r => setTimeout(r, 1200));
  const afterRows = await q(`SELECT COUNT(*)::int AS n FROM email_log`);
  ok("a real send through a real route lands in the log",
     afterRows[0].n > before[0].n, { before: before[0].n, after: afterRows[0].n });
  // The local stack's key is a dummy, so the send FAILS — and a failure is
  // logged too, which is the half a happy-path-only log would miss.
  const [last] = await q(`SELECT status, recipient_domain FROM email_log ORDER BY created_at DESC LIMIT 1`);
  ok("…with its status, whether it went or not", ["sent", "failed"].includes(last.status), last);

  // ── §2 · THE DOMAIN, NEVER THE ADDRESS ───────────────────────────────────
  console.log("\n— §2 · a domain is enough; an address is not ours to keep —");
  const cols = await q(`SELECT column_name FROM information_schema.columns
                         WHERE table_name='email_log' ORDER BY column_name`);
  const names = cols.map(c => c.column_name);
  ok("the log records the recipient DOMAIN", names.includes("recipient_domain"), names);
  ok("…and has no column for an address at all",
     !names.some(n => /(^|_)(email|recipient_email|to)$/.test(n)), names);
  ok("…and the domain is all the wrapper extracts",
     /String\(to \|\| ""\)\.split\("@"\)\[1\]/.test(serverSrc));
  ok("no full address is in the table", (await q(
     `SELECT COUNT(*)::int AS n FROM email_log WHERE recipient_domain LIKE '%@%'`))[0].n === 0);

  // ── §3 · THE INCIDENT, REPRODUCED AND CAUGHT ─────────────────────────────
  console.log("\n— §3 · a demo org reaching a real mailbox is a HEADLINE —");
  // Exactly the 10 September shape: an org marked as fiction, sending to a real
  // mailbox provider.
  await q(`INSERT INTO email_log (id,org_id,recipient_domain,kind,subject,status)
           VALUES ('eml_b97a',$1,'yahoo.com','pledge_reminder','A quick reminder about your pledge','sent')`,
    [ORG_DEMO]);
  await q(`INSERT INTO email_log (id,org_id,recipient_domain,kind,subject,status)
           VALUES ('eml_b97b',$1,'example.com','pledge_reminder','A quick reminder','sent')`, [ORG_DEMO]);
  await q(`INSERT INTO email_log (id,org_id,recipient_domain,kind,subject,status)
           VALUES ('eml_b97c',$1,'gmail.com','receipt','Your receipt','sent')`, [ORG_REAL]);

  const page = await api("GET", "/admin/observability", superTok);
  ok("the page answers", page.status === 200, page.status);
  ok("…over seven days", page.body.window === "7 days", page.body.window);
  ok("THE ONE LINE: it counts the demo org's real-provider send",
     page.body.alarm.demoOrgRealSends === 1, page.body.alarm);
  ok("…and says it in a sentence a person reads",
     /reached a real mailbox provider/.test(page.body.alarm.sentence || ""), page.body.alarm.sentence);
  // THE DISTINCTION THAT MAKES IT USABLE: an unroutable address from a demo org
  // is FINE and must not raise the alarm, or the alarm fires on every fixture
  // in the product and nobody reads it.
  ok("…and an example.com send from the SAME demo org does not raise it",
     page.body.alarm.demoOrgRealSends === 1 && page.body.alarm.demoOrgSendsAny >= 2,
     page.body.alarm);
  ok("…and a real org emailing gmail is not an alarm at all",
     !page.body.alarm.sentence.includes("Real Customer"), page.body.alarm.sentence);
  ok("every email in the window is listed with its org, domain, template and status",
     page.body.emails.some(e => e.recipient_domain === "yahoo.com" && e.kind === "pledge_reminder"
       && e.status === "sent" && e.org_name === "Fiction Works"),
     page.body.emails.slice(0, 3));

  // ── §4 · A TICK THAT FAILS IS VISIBLE ────────────────────────────────────
  console.log("\n— §4 · a background job that fails says so —");
  ok("the watched ticks are wrapped", (serverSrc.match(/recordTick\("/g) || []).length >= 13,
     (serverSrc.match(/recordTick\("/g) || []).length);
  ok("…including the ones that can SEND",
     /recordTick\("processDigests"/.test(serverSrc) && /recordTick\("processDunning"/.test(serverSrc)
     && /recordTick\("processThreadNudges"/.test(serverSrc));
  ok("…and the one that syncs money in", /recordTick\("processGivingSources"/.test(serverSrc));
  // A tick that merely refreshes a cached number is deliberately NOT watched —
  // alerting on it would teach somebody to ignore the alert.
  ok("a cosmetic refresh is deliberately not watched",
     !/recordTick\("refreshAssetFallbackCount"/.test(serverSrc));

  await q(`INSERT INTO tick_log (id,name,finished_at,ok,error)
           VALUES ('tick_b97a','b97obs-failing',NOW(),FALSE,'it threw')`);
  await q(`INSERT INTO tick_log (id,name,finished_at,ok,detail)
           VALUES ('tick_b97b','b97obs-fine',NOW(),TRUE,'nothing to do')`);
  const page2 = await api("GET", "/admin/observability", superTok);
  ok("a failing tick is on the page", page2.body.alarm.failedTicks.includes("b97obs-failing"),
     page2.body.alarm.failedTicks);
  ok("…and a healthy one is not", !page2.body.alarm.failedTicks.includes("b97obs-fine"),
     page2.body.alarm.failedTicks);
  ok("every tick shows its last run and result",
     page2.body.ticks.some(t => t.name === "b97obs-fine" && t.ok === true && t.detail === "nothing to do"),
     page2.body.ticks.filter(t => /b97obs/.test(t.name)));

  // ── §5 · AGENT RUNS, SOURCES, AND WHO MAY LOOK ───────────────────────────
  console.log("\n— §5 · the other two sections, and the wall —");
  await q(`INSERT INTO agent_runs (id,org_id,status,drafted,sent,declined,withheld,withheld_reason)
           VALUES ('arun_b97o',$1,'done',6,0,1,3,'cites no row')`, [ORG_REAL]);
  const page3 = await api("GET", "/admin/observability", superTok);
  ok("every agent run is listed with what it proposed AND what it withheld",
     page3.body.agentRuns.some(r => r.id === "arun_b97o" && r.drafted === 6 && r.withheld === 3),
     page3.body.agentRuns.slice(0, 2));
  ok("…and why it withheld", page3.body.agentRuns.some(r => r.withheld_reason === "cites no row"));
  ok("the giving-source section is present", Array.isArray(page3.body.sources), typeof page3.body.sources);

  // WHO IT ALERTS, STATED RATHER THAN ASSUMED.
  ok("the page says who gets alerted", page3.body.alerting !== undefined, page3.body.alerting);
  ok("…and on what", page3.body.alerting.triggers.length === 3, page3.body.alerting.triggers);
  ok("…and whether it is actually configured",
     typeof page3.body.alerting.configured === "boolean", page3.body.alerting);

  // SUPER-ADMIN ONLY. An org admin is not an operator.
  const denied = await api("GET", "/admin/observability", plainTok);
  ok("an org admin cannot open it", denied.status === 403, denied.status);
  const anon = await api("GET", "/admin/observability", null);
  ok("…and neither can a stranger", anon.status === 401, anon.status);
  const deniedRun = await api("POST", "/admin/observability/run-checks", plainTok, {});
  ok("…nor run its checks", deniedRun.status === 403, deniedRun.status);

  // IT IS A READ. Running the page must not change anything.
  const hashBefore = await q(`SELECT COUNT(*)::int AS e FROM email_log`);
  await api("GET", "/admin/observability", superTok);
  const hashAfter = await q(`SELECT COUNT(*)::int AS e FROM email_log`);
  ok("opening the page writes nothing", hashBefore[0].e === hashAfter[0].e,
     { before: hashBefore[0].e, after: hashAfter[0].e });

  // The check runs, records itself as a tick, and finds the demo-org send.
  const checks = await api("POST", "/admin/observability/run-checks", superTok, {});
  ok("the demo-org check runs", checks.status === 200, checks.body);
  ok("…and reports what it found", /ALERTED/.test(String(checks.body.demo || "")), checks.body);
  const [checkTick] = await q(
    `SELECT ok, detail FROM tick_log WHERE name='demo-org-send-check' ORDER BY started_at DESC LIMIT 1`);
  ok("…and records itself as a tick, like everything else", !!checkTick && checkTick.ok === true, checkTick);

  await reset();
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
