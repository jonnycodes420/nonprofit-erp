#!/usr/bin/env node
// MAIL-1 · THE MAIL PRE-FLIGHT. Read-only. Run it before the real Resend key
// goes back on, and again before switching an org's donor mail on:
//
//   DATABASE_URL=<prod url> node scripts/mail-preflight.js
//
// For every org it prints what the mail policy (mailPolicy.js) would do right
// now with each family of mail: staff, donor, account, billing. Then the things
// that would fire the moment ticks resume: open onboarding enrolments (there
// should be none: the deploy stops them), queued failed sends, and active donor
// sequences. It reads; it never writes. The whole session runs inside a READ
// ONLY transaction, so even a mistake in this file cannot change a row.
//
// It prints no email address and no donor name: counts and org names only.
//
// FIX-49 · it reads all three per-org switches (FIX-48): Staff mail
// (`staff_mail_enabled`), Donor mail (`emails_enabled`) and Billing mail
// (`billing_mail_enabled`), and `org_kind`, so the decision it prints for each
// family is the one the server makes. `--org <id>` limits it to one org.

const { Client } = require("pg");
const mailPolicy = require("../mailPolicy");

const url = process.env.DATABASE_URL || "";
if (!url) { console.error("Set DATABASE_URL. This script only reads."); process.exit(2); }
const local = /localhost|127\.0\.0\.1/.test(url);

const FAMILIES = ["staff", "donor", "account", "billing"];
const orgArg = (() => { const i = process.argv.indexOf("--org"); return i > 0 ? process.argv[i + 1] : null; })();
const onOff = v => (v ? "on" : "off");
const word = d => (d.send ? "SENDS" : "held: " + d.reason);

(async () => {
  const db = new Client({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false } });
  await db.connect();
  await db.query("BEGIN TRANSACTION READ ONLY");
  try {
    console.log(`mail pre-flight · ${new Date().toISOString()} · ${local ? "local database" : "REMOTE database (read only)"}`);
    console.log(`MAIL_WAIT_FOR_ONBOARDING=${mailPolicy.waitsForOnboarding() ? "on" : "OFF"} · ` +
                `billing before onboarding=${mailPolicy.billingBeforeOnboarding() ? "on" : "off"} ` +
                "(as set in THIS shell; the server reads its own env)\n");

    const { rows: orgs } = await db.query(
      `SELECT o.id, o.name, o.emails_enabled, o.staff_mail_enabled, o.billing_mail_enabled, o.org_kind, o.onboarded_at, o.onboarded_via,
              o.sending_domain, o.sending_domain_status,
              (SELECT COUNT(*)::int FROM donors d WHERE d.org_id=o.id AND d.deleted_at IS NULL AND d.is_sample IS NOT TRUE) AS real_people,
              (SELECT COUNT(*)::int FROM imports i WHERE i.org_id=o.id) AS imports
         FROM orgs o WHERE ($1::text IS NULL OR o.id = $1) ORDER BY o.created_at`, [orgArg]);
    for (const o of orgs) {
      const fam = FAMILIES.map(f => `${f} ${word(mailPolicy.orgMailDecision(o, f))}`).join(" · ");
      console.log(`${o.id}  ${o.name}`);
      const sw = mailPolicy.mailSwitches(o);
      console.log(`  switches: staff ${onOff(sw.staff)}${o.staff_mail_enabled == null ? " (follows donor)" : ""} · donor ${onOff(sw.donor)} · billing ${onOff(sw.billing)}`);
      console.log(`  demo ${mailPolicy.isDemoOrg(o) ? "yes" : "no"} · ` +
                  `onboarded ${o.onboarded_at ? new Date(o.onboarded_at).toISOString().slice(0, 10) + " (" + o.onboarded_via + ")" : "not yet"} · ` +
                  `${o.real_people} real people, ${o.imports} imports · domain ${o.sending_domain ? o.sending_domain + " " + o.sending_domain_status : "none"}`);
      console.log(`  ${fam}`);
    }

    const one = async (sql) => (await db.query(sql)).rows[0];
    const onb = await one(`SELECT COUNT(*)::int AS n FROM sequence_enrollments e JOIN sequences s ON s.id=e.sequence_id
                            WHERE s.trigger='onboarding' AND e.status='active'`);
    const onbSeq = await one(`SELECT COUNT(*)::int AS n FROM sequences WHERE trigger='onboarding' AND status='active'`);
    const failed = await one(`SELECT COUNT(*)::int AS n FROM notification_failures`);
    const seqs = await one(`SELECT COUNT(*)::int AS n FROM sequence_enrollments e JOIN sequences s ON s.id=e.sequence_id
                             WHERE s.trigger<>'onboarding' AND e.status='active'`);
    console.log("\nWould fire when ticks resume:");
    console.log(`  onboarding sequences still active: ${onbSeq.n}, enrolments still active: ${onb.n}` +
                (onb.n || onbSeq.n ? "  <- deploy MAIL-1 first; its boot stops these" : "  (none, as it should be)"));
    console.log(`  queued failed sends (retried every 5 min): ${failed.n}`);
    console.log(`  active donor-sequence enrolments: ${seqs.n} (each still passes the policy and the per-person rules)`);
  } finally {
    await db.query("ROLLBACK").catch(() => {});
    await db.end();
  }
})().catch(e => { console.error("pre-flight failed:", e.message); process.exit(1); });
