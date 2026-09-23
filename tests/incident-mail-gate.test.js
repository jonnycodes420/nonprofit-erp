// INCIDENT 2026-09-22 — PRODUCTION SENT REAL EMAIL TO INVENTED PEOPLE.
//
// Three messages left Steward that evening and reached real mailboxes:
//
//   · "A quick reminder about your pledge to F…" — a seeded donor's pledge
//     reminder, DELIVERED to levi.johnson88@yahoo.com. Seven more were
//     attempted; five were caught by Resend's own suppression list, which is
//     luck, not a control.
//   · "You just made a great decision for your mission" — the founder
//     onboarding drip, DELIVERED to a real prospect eight hours before anyone
//     meant to tell her the product existed.
//   · "Week in Review — Justin's Place" — a staff digest composed ENTIRELY
//     from invented gifts, DELIVERED to that same prospect.
//
// Three messages, three different send paths, one shape of mistake: nothing in
// the mail system could tell a person who exists from a person somebody made
// up, or an organisation that had agreed to hear from us from one that had
// been created FOR it an hour earlier.
//
// The fixes are two gates, and this suite exists to keep them:
//
//   1. donorMailDecision — the one function every donor-facing send passes
//      through — refuses a donor carrying is_sample, for EVERY kind,
//      transactional included.
//   2. orgMaySendEmail — one org-level answer, read by all three seams
//      (donor mail, digests, the onboarding drip) rather than patched into
//      whichever one happened to be on fire.
//
// And the rule the third message demands: PROVISIONING AN ORG IS NOT A
// SIGNUP. It must not arm the drip, and it must not arm the digest.
//
// Standard scratch stack (tests/README.md).

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "org_inc01";          // ordinary org, mail on
const DEMO = "org_inc02";         // marked as fiction
const OFF = "org_inc03";          // real org, mail switched off
const HQ = "org_inc04";           // where the super-admin lives
const PW = "loadtest1234";

const ADMIN = "inc-admin@example.org";
const SUPER = "inc-super@example.org";

async function reset() {
  for (const o of [ORG, DEMO, OFF, HQ]) {
    for (const t of ["interactions", "pledges", "gifts", "sequence_enrollments",
                     "sequence_steps", "sequences", "digest_sends", "donors",
                     "users", "accounts", "fin_funds", "orgs"]) {
      if (t === "sequence_steps") {
        await q(`DELETE FROM sequence_steps WHERE sequence_id IN (SELECT id FROM sequences WHERE org_id=$1)`, [o]).catch(() => {});
      } else if (t === "orgs") {
        await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
      } else {
        await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
      }
    }
  }
  await q(`DELETE FROM users WHERE email LIKE 'inc-prov%'`).catch(() => {});
  await q(`DELETE FROM orgs WHERE name LIKE 'Incident Provision%'`).catch(() => {});
}

const mkOrg = async (id, name, emailsEnabled, isDemo) =>
  q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,emails_enabled,is_demo_org)
     VALUES ($1,$2,$3,1,'core','active',$4,$5)`,
    [id, name, id.replace(/_/g, "-"), emailsEnabled, isDemo]);

const mkUser = async (id, org, email, isSuper = false) =>
  q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin)
     VALUES ($1,$2,$3,$4,'Tester','admin',$5)`,
    [id, org, email, bcrypt.hashSync(PW, 4), isSuper]);

// A donor row, sample or not, with an address that is deliberately shaped like
// a real mailbox — because that is exactly what bit us.
const mkDonor = async (id, org, email, isSample) =>
  q(`INSERT INTO donors (id,org_id,name,email,is_sample) VALUES ($1,$2,$3,$4,$5)`,
    [id, org, "Test Person", email, isSample]);

(async () => {
  console.log("incident-mail-gate (2026-09-22)");
  await reset();

  await mkOrg(ORG, "Incident Ordinary", true, false);
  await mkOrg(DEMO, "Incident Demo", true, true);      // mail "on", but fiction
  await mkOrg(OFF, "Incident Switched Off", false, false);
  await mkOrg(HQ, "Incident HQ", true, false);
  await mkUser("u_inc_admin", ORG, ADMIN);
  await mkUser("u_inc_super", HQ, SUPER, true);

  await mkDonor("d_inc_real", ORG, "real.person@example.org", false);
  await mkDonor("d_inc_smpl", ORG, "invented.person@example.org", true);
  await mkDonor("d_inc_demo", DEMO, "demo.person@example.org", false);
  await mkDonor("d_inc_off", OFF, "off.person@example.org", false);

  // ── §1 · A MADE-UP PERSON HAS NO MAILBOX ─────────────────────────────────
  // Read through the server's own decision function rather than re-deriving
  // the rule here: a test that reimplements the gate proves only that the
  // test agrees with itself.
  console.log("\n— §1 · a made-up person has no mailbox —");
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "server.js"), "utf8");

  ok("donorMailDecision reads is_sample off the donor row",
    /bool_or\(is_sample\)\s+AS\s+sample/.test(src), null);
  ok("…and refuses on it, by name",
    /if\s*\(flags\?\.sample\)\s*return\s*\{\s*send:\s*false,\s*reason:\s*"sample_donor"\s*\}/.test(src), null);

  // The refusal must sit ABOVE the marketing/transactional branch, or a
  // receipt to an invented donor would still go out. This is the assertion
  // that would have caught the original bug.
  const fnStart = src.indexOf("async function donorMailDecision(");
  const fnBody = src.slice(fnStart, src.indexOf("\n}", fnStart));
  const iSample = fnBody.indexOf('reason: "sample_donor"');
  const iCls = fnBody.indexOf('if (cls === "marketing")');
  ok("the sample refusal outranks the marketing/transactional split — a receipt to an invented donor is not a receipt",
    iSample > -1 && iCls > -1 && iSample < iCls, { iSample, iCls });

  // ── §2 · ONE ORG-LEVEL GATE, READ BY ALL THREE SEAMS ─────────────────────
  console.log("\n— §2 · one org-level gate, read by all three seams —");
  ok("orgMaySendEmail exists", /async function orgMaySendEmail\(orgId\)/.test(src), null);
  ok("it fails CLOSED when the org row cannot be read",
    /org_gate_unreadable/.test(src), null);
  ok("it names the two refusals it exists for",
    /"org_emails_disabled"/.test(src) && /"demo_org"/.test(src), null);
  // A gate read through a database blip must not be REMEMBERED — neither as a
  // refusal (which would silence a real org for the cache window) nor, far
  // worse, as an allow.
  ok("an unreadable org is never cached", /NOT cached/.test(src), null);

  for (const [seam, re] of [
    ["donorMailDecision", /const orgGate = await orgMaySendEmail\(orgId\)/],
    ["sendDigestEmail", /const digestGate = await orgMaySendEmail\(org && org\.id\)/],
    ["runDigestsForOrg", /const gate = await orgMaySendEmail\(org && org\.id\)/],
    ["sendOnboardingSequence", /\[onboarding\] NOT creating drip/],
  ]) ok(`${seam} consults the org gate`, re.test(src), null);

  // ── §3 · PROVISIONING IS NOT A SIGNUP ────────────────────────────────────
  console.log("\n— §3 · provisioning an org is not a signup —");

  const provEmail = "inc-prov-a@example.org";
  const prov = await api("POST", "/auth/register-org", null, {
    orgName: "Incident Provision A", userName: "Allie", email: provEmail,
    password: "provision-pw-1234", provisioned: true,
  });
  ok("a provisioned org is created", prov.status === 201, { s: prov.status, b: prov.body });
  const provOrgId = prov.body?.org?.id;

  const [provOrg] = await q(`SELECT emails_enabled, is_demo_org FROM orgs WHERE id=$1`, [provOrgId]);
  ok("…with outbound mail OFF", provOrg && provOrg.emails_enabled === false, provOrg);
  ok("…and marked as fiction until somebody says otherwise", provOrg && provOrg.is_demo_org === true, provOrg);

  // THE ASSERTION THE INCIDENT IS ABOUT. Not "no email was sent" — no
  // enrolment exists at all, because a dormant drip is a loaded gun: the
  // hourly engine would deliver a "welcome!" the moment mail came back on.
  const provSeq = await q(`SELECT id, name, trigger FROM sequences WHERE org_id=$1`, [provOrgId]);
  ok("NO onboarding sequence is created for a provisioned org — not merely unsent, absent",
    provSeq.length === 0, provSeq);

  // And the digest cannot reserve a period for it either.
  const digestRows = await q(`SELECT COUNT(*)::int c FROM digest_sends WHERE org_id=$1`, [provOrgId]);
  ok("…and no digest period is reserved for it", digestRows[0].c === 0, digestRows[0]);

  // ── §4 · …BUT A REAL SIGNUP IS UNTOUCHED ─────────────────────────────────
  // The guard must not have bought safety by breaking the ordinary path.
  console.log("\n— §4 · a real signup still gets its welcome —");
  const realEmail = "inc-prov-b@example.org";
  const real = await api("POST", "/auth/register-org", null, {
    orgName: "Incident Provision B", userName: "Ordinary", email: realEmail,
    password: "ordinary-pw-1234",
  });
  ok("an ordinary signup succeeds", real.status === 201, { s: real.status, b: real.body });
  const realOrgId = real.body?.org?.id;
  const [realOrg] = await q(`SELECT emails_enabled, is_demo_org FROM orgs WHERE id=$1`, [realOrgId]);
  ok("…with mail ON", realOrg && realOrg.emails_enabled === true, realOrg);
  ok("…and not marked as fiction", realOrg && realOrg.is_demo_org === false, realOrg);

  // The drip is created asynchronously (fire-and-forget after the response).
  let realSeq = [];
  for (let i = 0; i < 30 && realSeq.length === 0; i++) {
    realSeq = await q(`SELECT id FROM sequences WHERE org_id=$1 AND trigger='onboarding'`, [realOrgId]);
    if (!realSeq.length) await new Promise(r => setTimeout(r, 200));
  }
  ok("the onboarding drip IS created for a genuine signup", realSeq.length === 1, realSeq);

  // ── §5 · THE SWITCH, AND THE DISAGREEMENT IT REFUSES ─────────────────────
  console.log("\n— §5 · the org-level switch —");
  const superTok = await login(SUPER, PW);

  const offRes = await api("POST", `/admin/orgs/${ORG}/email-switch`, superTok, { emailsEnabled: false });
  ok("a super-admin can switch an org's mail off", offRes.status === 200 && offRes.body.org.emails_enabled === false,
    { s: offRes.status, b: offRes.body });

  // Turning mail back on for an org still marked as fiction is how this
  // repeats: somebody unblocks a customer and does not notice what is in it.
  const badOn = await api("POST", `/admin/orgs/${DEMO}/email-switch`, superTok, { emailsEnabled: true });
  ok("enabling mail on an org still marked as a demo org is REFUSED",
    badOn.status === 409 && /demo org/i.test(badOn.body.error || ""), { s: badOn.status, b: badOn.body });

  const goodOn = await api("POST", `/admin/orgs/${DEMO}/email-switch`, superTok, { emailsEnabled: true, isDemoOrg: false });
  ok("…but clearing the mark in the same breath is allowed",
    goodOn.status === 200 && goodOn.body.org.emails_enabled === true && goodOn.body.org.is_demo_org === false,
    { s: goodOn.status, b: goodOn.body });

  const adminTok = await login(ADMIN, PW);
  const notSuper = await api("POST", `/admin/orgs/${OFF}/email-switch`, adminTok, { emailsEnabled: true });
  ok("an ordinary org admin cannot touch the switch", notSuper.status === 403, { s: notSuper.status });

  // ── §5b · THE GATE, PROVEN THROUGH A REAL SEND PATH ──────────────────────
  // Everything above reads the source. This runs it: ORG's mail was switched
  // off two assertions ago, so the digest — the exact thing that delivered a
  // Week in Review built from fiction — must now refuse, by name, and reserve
  // no period. A source regex cannot tell you the wiring is live; this can.
  console.log("\n— §5b · and the digest actually refuses —");
  const digestRun = await api("POST", "/digests/run", adminTok, { type: "weekly" });
  ok("the digest route answers", digestRun.status === 200, { s: digestRun.status, b: digestRun.body });
  ok("…and it is GATED, naming the reason",
    digestRun.body?.weekly?.gated === "org_emails_disabled" || digestRun.body?.gated === "org_emails_disabled",
    digestRun.body);
  const reserved = await q(`SELECT COUNT(*)::int c FROM digest_sends WHERE org_id=$1`, [ORG]);
  ok("…and reserved no period, so the week is still there when mail comes back",
    reserved[0].c === 0, reserved[0]);

  // ── §6 · NO SEEDED ADDRESS IS A REAL MAILBOX ─────────────────────────────
  // The other half of the night: the addresses themselves. Every gate above
  // is code, and code can be edited out. A fixture person owning a DELIVERABLE
  // mailbox is what turned a bug into mail landing in a stranger's inbox, so
  // the last line of defence is that there is nowhere for it to land.
  //
  // Every seeded address now reads <local>@<provider>.example.com. The
  // provider is kept as a SUBDOMAIN rather than flattened away, so two people
  // who differed only by provider still differ — flattening jduong@icloud.com
  // and jduong@twc.com to one address would have silently merged two donors
  // and moved a dedupe answer key. example.com is IANA-reserved (RFC 2606)
  // and publishes no MX: nothing addressed there can be delivered, ever.
  //
  // Scope is DATA — fixtures and seed scripts, the things that become donor
  // rows. Deliberately not tests/*.js: build88c-domain asserts that
  // ada@gmail.com is REFUSED as a sending domain, and this file's own header
  // names the address that was delivered. Both should stay exactly as written.
  console.log("\n— §6 · a seeded person can never be a real mailbox —");
  const fs = require("fs"), path = require("path");
  const ROOT = path.join(__dirname, "..");
  const PROVIDERS = "yahoo|gmail|hotmail|outlook|aol|icloud|comcast|twc|verizon|sbcglobal|att|cox|msn|live|ymail";
  // The trailing (?![A-Za-z0-9.-]) is what stops this matching the cure:
  // "@yahoo.example.com" must NOT read as "@yahoo.com".
  const DELIVERABLE = new RegExp("[A-Za-z0-9._%+-]+@(?:" + PROVIDERS + ")\\.(?:com|net)(?![A-Za-z0-9.-])", "i");
  const offenders = [];
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { walk(f); continue; }
      if (!/\.(csv|json|js|mjs|tsv|txt)$/.test(e.name)) continue;
      // read as text, not through grep: this repo has already been bitten by
      // grep silently skipping a fixture it decided was binary, which is
      // exactly how a 440-address file stayed hidden through one clean scan.
      const hit = fs.readFileSync(f, "utf8").match(DELIVERABLE);
      if (hit) offenders.push(path.relative(ROOT, f) + ": " + hit[0]);
    }
  };
  [path.join(__dirname, "fixtures"), path.join(ROOT, "scripts")].forEach(walk);
  ok("no fixture or seed carries an address at a real mailbox provider",
    offenders.length === 0, offenders.slice(0, 8));

  // …and the cure is not mistaken for the disease.
  ok("the assertion does not false-positive on <provider>.example.com",
    DELIVERABLE.test("jduong@twc.example.com") === false, null);
  ok("…but still catches a genuine one",
    DELIVERABLE.test("levi.johnson88@yahoo.com") === true, null);

  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
