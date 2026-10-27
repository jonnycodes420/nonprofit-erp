// FIX-50 · AN ORG IS A DEMO ONLY IF ITS KIND IS DEMO.
//
// Justin's Place (prod, 26 Oct): Kind = Customer, yet the super-admin Email
// section said "This is a demonstration organization, so it never sends email"
// for every family and the org's app showed the demo banner. It was created as
// a demo (is_demo_org) and set to Customer before #234, and #234 only cleared
// the flag when Kind CHANGED, so nothing ever cleared it. The banner, 2FA, the
// mailbox, QuickBooks, Xero and the receipts each read the flag on their own.
//
// This guards donor mail: which orgs may email their donors, and which tell a
// real customer that everything in it is invented.
//
// WHAT WOULD MAKE THIS FAIL (each planted and watched go red):
//   · the banner reading is_demo_org again (GET /org demo from the flag)  → §1
//   · mailPolicy.isDemoOrg reading the flag or the id list again          → §1, §2
//   · mail-preflight not selecting org_kind                               → §2
//   · the Demo switch not taking effect, or not being logged              → §3
//   · Kind = Demo not making the org a demo                               → §4
//   · the migration leaving a flag that disagrees with Kind               → §5
//
// Run on the scratch stack: BASE, DATABASE_URL (see tests/run-all.sh).

const bcrypt = require("bcryptjs");
const path = require("path");
const { execFileSync } = require("child_process");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const HQ = "org_f50_hq", JP = "org_f50_jp", MIS = "org_f50_mismatch";
const ORGS = [HQ, JP, MIS];
const SUPER = "f50-super@t.local", STAFF = "f50-staff@t.local", PW = "loadtest1234";
const DEMO_SENTENCE = "This is a demonstration organization, so it never sends email.";

async function reset() {
  await q(`DELETE FROM users WHERE org_id = ANY($1)`, [ORGS]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id = ANY($1)`, [ORGS]).catch(() => {});
}

// The Justin's Place shape, written the way it happened: created as a demo by
// the flag, then Kind set to Customer by a write that never touched the flag.
// The user triggers are off only for that one write, so the old shape exists.
async function createdAsDemoThenCustomer(id, name) {
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,is_demo_org,emails_enabled,staff_mail_enabled,billing_mail_enabled)
           VALUES ($1,$2,$3,1,'active','impact',true,true,true,true)`, [id, name, id.replace(/_/g, "-")]);
  await q(`ALTER TABLE orgs DISABLE TRIGGER USER`);
  try { await q(`UPDATE orgs SET org_kind='customer', is_demo_org=true WHERE id=$1`, [id]); }
  finally { await q(`ALTER TABLE orgs ENABLE TRIGGER USER`); }
}

function preflightDemo(orgId) {
  const out = execFileSync(process.execPath, [path.join(__dirname, "..", "scripts", "mail-preflight.js")],
    { env: { ...process.env }, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const lines = out.split("\n");
  const i = lines.findIndex(l => l.startsWith(orgId + " "));
  // The org's block: its id line, then indented lines until the next org.
  let block = "";
  for (let j = i + 1; i >= 0 && j < lines.length && lines[j].startsWith("  "); j++) block += lines[j] + "\n";
  const m = /\bdemo (yes|no)\b/.exec(block);
  return m ? m[1] === "yes" : null;
}

async function state(staffToken, superToken) {
  const org = await api("GET", "/org", staffToken);
  const mail = await api("GET", `/admin/orgs/${JP}/mail`, superToken);
  const list = await api("GET", "/admin/orgs", superToken);
  const row = (list.body || []).find(o => o.id === JP) || {};
  return {
    banner: org.body ? org.body.demo : undefined,       // client/src/api.js isDemoOrg reads this; it must be said, true or false
    locked: mail.body && mail.body.locked === true,
    demoSentences: Object.values((mail.body && mail.body.families) || {}).filter(f => f.sentence === DEMO_SENTENCE).length,
    staffSends: mail.body && mail.body.families && mail.body.families.staff && mail.body.families.staff.sends,
    switches: mail.body && mail.body.switches,
    preflight: preflightDemo(JP),
    listLabel: row.demo === true,
  };
}

(async () => {
  await reset();
  const hash = bcrypt.hashSync(PW, 10);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,org_kind)
           VALUES ($1,'F50 Console HQ','f50-console-hq',1,'trialing','trial','internal_test')`, [HQ]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin)
           VALUES ('u_f50_super',$1,$2,$3,'Jonathan','admin',true)`, [HQ, SUPER, hash]);
  await createdAsDemoThenCustomer(JP, "F50 Harbor Shelter");
  await q(`UPDATE orgs SET onboarded_at=NOW(), onboarded_via='manual' WHERE id=$1`, [JP]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_f50_staff',$1,$2,$3,'Justine','admin')`, [JP, STAFF, hash]);
  const sup = await login(SUPER), staff = await login(STAFF);
  ok("both logins work", !!sup && !!staff);

  // §1–§2 · A Customer org that was created as a demo is not a demo anywhere.
  let s = await state(staff, sup);
  ok("§1 Customer org (created as a demo): no demo banner", s.banner === false, JSON.stringify(s));
  ok("§1 its mail panel is not locked and says no 'demonstration' sentence", s.locked === false && s.demoSentences === 0, JSON.stringify(s));
  ok("§1 its mail panel reports each switch's real state (all on, staff sends)",
    s.switches && s.switches.staff === true && s.switches.donor === true && s.switches.billing === true && s.staffSends === true, JSON.stringify(s));
  ok("§2 mail-preflight agrees: demo no", s.preflight === false, JSON.stringify(s));
  ok("§2 the console list carries no Demo label", s.listLabel === false);

  // §3 · The Demo switch, on, off, on, off.
  const audits0 = (await q(`SELECT COUNT(*)::int AS n FROM fin_audit_log WHERE org_id=$1`, [JP]).catch(() => [{ n: -1 }]))[0].n;
  for (const [i, on] of [true, false, true, false].entries()) {
    const r = await api("POST", `/admin/orgs/${JP}/demo`, sup, { on });
    ok(`§3 flip ${i + 1} (${on ? "on" : "off"}): answered`, r.status === 200 && r.body.demo === on, JSON.stringify(r.body).slice(0, 200));
    ok(`§3 flip ${i + 1}: the answer carries the Email section, ${on ? "locked" : "unlocked"}`, r.body.mail && r.body.mail.locked === on);
    s = await state(staff, sup);
    ok(`§3 flip ${i + 1}: banner ${on ? "on" : "off"}`, s.banner === on, JSON.stringify(s));
    ok(`§3 flip ${i + 1}: mail panel ${on ? "locked" : "unlocked"}`, s.locked === on && (on ? s.demoSentences > 0 : s.demoSentences === 0), JSON.stringify(s));
    ok(`§3 flip ${i + 1}: preflight says demo ${on ? "yes" : "no"}`, s.preflight === on, JSON.stringify(s));
    ok(`§3 flip ${i + 1}: console list label ${on ? "shown" : "gone"}`, s.listLabel === on);
  }
  const [kindAfter] = await q(`SELECT org_kind FROM orgs WHERE id=$1`, [JP]);
  ok("§3 switched off again, the org is Customer again", kindAfter.org_kind === "customer", kindAfter.org_kind);
  const audits1 = (await q(`SELECT COUNT(*)::int AS n FROM fin_audit_log WHERE org_id=$1 AND action LIKE 'turned demo %'`, [JP]).catch(() => [{ n: -1 }]))[0].n;
  ok("§3 each flip is in the org's audit log", audits1 >= 4, `${audits0} -> ${audits1}`);
  // Off means the switches work: donor mail waits for its own switch (a former
  // demo starts with it off), and turning it on is not refused.
  const sw = await api("POST", `/admin/orgs/${JP}/mail-switches`, sup, { donor: true, confirm: true });
  ok("§3 after the switch is off, donor mail turns on and reads on", sw.status === 200 && sw.body.switches.donor === true && sw.body.families.donor.sentence !== DEMO_SENTENCE, JSON.stringify(sw.body).slice(0, 200));

  // §4 · Kind = Demo brings the banner back; Customer takes it away.
  await api("POST", `/admin/orgs/${JP}/kind`, sup, { kind: "demo" });
  s = await state(staff, sup);
  ok("§4 Kind set to Demo: banner back, panel locked, preflight yes", s.banner === true && s.locked === true && s.preflight === true, JSON.stringify(s));
  await api("POST", `/admin/orgs/${JP}/kind`, sup, { kind: "customer" });
  s = await state(staff, sup);
  ok("§4 Kind set to Customer: banner gone, panel unlocked, preflight no", s.banner === false && s.locked === false && s.preflight === false, JSON.stringify(s));

  // §5 · The migration fixes a mismatched org, and is idempotent.
  await createdAsDemoThenCustomer(MIS, "F50 Mismatch Pantry");
  let mig = null;
  try {
    const { Pool } = require("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      mig = await require("../orgDemoMigration").matchDemoFlagToKind(pool);
      const again = await require("../orgDemoMigration").matchDemoFlagToKind(pool);
      ok("§5 a second run changes nothing", again.flagsChanged === 0 && again.kindsSet === 0, JSON.stringify(again));
    } finally { await pool.end(); }
  } catch (e) { mig = { error: e.message }; }
  const [m] = await q(`SELECT org_kind, is_demo_org, emails_enabled FROM orgs WHERE id=$1`, [MIS]);
  ok("§5 the migration changed at least the mismatched row", mig && mig.flagsChanged >= 1, JSON.stringify(mig));
  ok("§5 the mismatched org is Customer, not flagged, donor mail waiting for its switch",
    m.org_kind === "customer" && m.is_demo_org === false && m.emails_enabled === false, JSON.stringify(m));

  await reset();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
