// FIX-53 · MAIL STARTS OFF, AND ONLY A SUPER-ADMIN TURNS IT ON.
//
// 27 Oct: a real customer file was loaded on prod, and the only thing between
// those donors and an automatic email was a switch someone had to remember to
// check. So every org's Staff mail and Donor mail start OFF however the org was
// made, and the one way either goes ON is the super-admin console toggle
// (POST /admin/orgs/:id/mail-switches with confirm: true). This guards donor
// mail. Close a deal and the paid checkout webhook are asserted in
// tests/close-link.test.js, which owns the billing Stripe mock.
//
// WHAT WOULD MAKE THIS FAIL (each planted and watched go red):
//   · the schema default for emails_enabled back to TRUE                  → §1, §4
//   · a signup leaving Staff mail NULL (it then follows Donor mail on)    → §1
//   · /email-switch accepting emailsEnabled: true again                   → §3
//   · /mail-switches turning a switch on without confirm: true            → §3
//   · any code outside that handler writing TRUE to either switch         → §4
//
// Run on the scratch stack: BASE, DATABASE_URL (see tests/run-all.sh).

const fs = require("fs");
const path = require("path");
const { BASE, ok, summary, login, api, q, closeDb, waitFor } = require("./helpers");

const uniq = () => require("crypto").randomBytes(5).toString("hex");
const PW = "loadtest1234";
const ROOT = path.join(__dirname, "..");
// SELECT * so a missing stamp column reads as missing, by name, not a crash.
const switches = async id => {
  const o = (await q(`SELECT * FROM orgs WHERE id=$1`, [id]))[0] || {};
  return { emails_enabled: o.emails_enabled, staff_mail_enabled: o.staff_mail_enabled,
           donor_mail_set_at: o.donor_mail_set_at, donor_mail_set_by_name: o.donor_mail_set_by_name, staff_mail_set_at: o.staff_mail_set_at };
};
const bothOff = s => s.emails_enabled === false && s.staff_mail_enabled === false;

async function register(route, body) {
  const r = await fetch(BASE + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const b = await r.json().catch(() => ({}));
  const [u] = await q(`SELECT org_id FROM users WHERE lower(email)=lower($1)`, [body.email]);
  return { status: r.status, body: b, orgId: u && u.org_id };
}

// ── §4 · the static guard ────────────────────────────────────────────────
// Every .js file Steward runs or seeds with (tests and the client excepted)
// is read, comments dropped, and each write to either switch must be a FALSE
// literal. The one exception is the console toggle's handler, found by its
// route, so moving or renaming it fails here too.
const SWITCH = "(?:emails_enabled|staff_mail_enabled)";
const SKIP_DIRS = new Set(["node_modules", ".git", ".claude", "tests", "client", "docs", "audit", "dist", "support", "coverage"]);
function jsFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) jsFiles(path.join(dir, e.name), out); }
    else if (/\.(c|m)?js$/.test(e.name)) out.push(path.join(dir, e.name));
  }
  return out;
}
const stripComments = src => src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, " "))
  .split("\n").map(l => /^\s*\/\//.test(l) ? "" : l.replace(/\s\/\/\s.*$/, "")).join("\n");
// The text inside the parentheses that open at `i`, nesting respected.
function balanced(src, i) {
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === "(") depth++;
    else if (src[j] === ")" && --depth === 0) return src.slice(i + 1, j);
  }
  return null;
}
function topLevelSplit(s) {
  const parts = []; let depth = 0, cur = "", quote = null;
  for (const ch of s) {
    if (quote) { if (ch === quote) quote = null; }
    else if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "(") depth++; else if (ch === ")") depth--;
    if (ch === "," && depth === 0 && !quote) { parts.push(cur.trim()); cur = ""; } else cur += ch;
  }
  parts.push(cur.trim());
  return parts;
}
const FALSE_LITERAL = /^(false|FALSE|0)$/;
function violations(file, src) {
  const out = [];
  const lineOf = idx => src.slice(0, idx).split("\n").length;
  const where = idx => `${path.relative(ROOT, file)}:${lineOf(idx)}`;
  // An assignment: `emails_enabled = <value>` (never ==, !=, <=, >=).
  for (const m of src.matchAll(new RegExp(`\\b${SWITCH}\\s*(?<![=!<>])=(?!=)\\s*([^,\\s)\`'"]+)`, "g"))) {
    const v = m[1];
    if (FALSE_LITERAL.test(v)) continue;
    // `emails_enabled=${x}` is a log line or a sentence; SQL here binds ? or $n.
    if (v.startsWith("${")) continue;
    // A CASE may keep the switch as it is or turn it off, never on.
    if (/^CASE$/i.test(v)) {
      const end = src.indexOf("END", m.index);
      if (!/\b(THEN|ELSE)\s+(true|TRUE|\?|\$\d)/.test(src.slice(m.index, end))) continue;
    }
    out.push(`${where(m.index)} writes ${m[0].trim()}`);
  }
  // A default: `... emails_enabled BOOLEAN DEFAULT true` or `SET DEFAULT true`.
  for (const m of src.matchAll(new RegExp(`\\b${SWITCH}\\b[^\\n;]*?DEFAULT\\s+(\\S+)`, "gi"))) {
    if (!FALSE_LITERAL.test((/^\w+/.exec(m[1]) || [""])[0])) out.push(`${where(m.index)} defaults ${m[0].trim()}`);
  }
  // A JS object: `{ emails_enabled: true }`.
  for (const m of src.matchAll(new RegExp(`\\b${SWITCH}\\s*:\\s*(true|1)\\b`, "g"))) out.push(`${where(m.index)} sets ${m[0]}`);
  // An insert into orgs: the switch's value, by position, is a FALSE literal.
  for (const m of src.matchAll(/INSERT\s+INTO\s+orgs\s*\(/gi)) {
    const colsAt = m.index + m[0].length - 1;
    const cols = balanced(src, colsAt);
    if (cols == null || !new RegExp(`\\b${SWITCH}\\b`).test(cols)) continue;
    const after = src.slice(colsAt + cols.length + 2);
    const vm = /^\s*VALUES\s*\(/i.exec(after);
    if (!vm) { out.push(`${where(m.index)} inserts a mail switch from a SELECT`); continue; }
    const vals = topLevelSplit(balanced(after, vm[0].length - 1) || "");
    topLevelSplit(cols).forEach((c, i) => {
      if (new RegExp(`^${SWITCH}$`).test(c) && !FALSE_LITERAL.test(vals[i] || ""))
        out.push(`${where(m.index)} inserts ${c} = ${vals[i]}`);
    });
  }
  return out;
}
function handlerRange(src) {
  const start = src.indexOf(`app.post("/admin/orgs/:id/mail-switches"`);
  if (start < 0) return null;
  const end = src.indexOf("\napp.", start + 10);
  return [start, end < 0 ? src.length : end];
}

(async () => {
  console.log("— §4 · the static guard —");
  const billing = path.join(ROOT, "routes", "billing.js");
  const found = [];
  let range = null;
  for (const f of jsFiles(ROOT)) {
    let src = stripComments(fs.readFileSync(f, "utf8"));
    if (f === billing) {
      range = handlerRange(src);
      if (range) src = src.slice(0, range[0]) + src.slice(range[0], range[1]).replace(/[^\n]/g, " ") + src.slice(range[1]);
    }
    found.push(...violations(f, src));
  }
  ok("§4 the console toggle's handler is where the guard expects it", !!range);
  ok("§4 nothing outside the console toggle writes either switch ON", found.length === 0, found);
  // The guard is proven able to fail on the shapes it reads, here and every run.
  const planted = [
    "await q(`UPDATE orgs SET emails_enabled = true WHERE emails_enabled IS NULL`);",
    "await q(`ALTER TABLE orgs ALTER COLUMN staff_mail_enabled SET DEFAULT true`);",
    "await run(`UPDATE orgs SET emails_enabled=? WHERE id=?`, [on, id]);",
    "await q(`INSERT INTO orgs (id, name, emails_enabled) VALUES ($1, $2, true)`);",
    "await q(`INSERT INTO orgs (id, ${col()}, staff_mail_enabled) VALUES (?, ?, ?)`, [a, b, c]);",
    "patch({ staff_mail_enabled: true });",
  ];
  const caught = planted.filter(p => violations(path.join(ROOT, "planted.js"), p).length === 1);
  ok("§4 the guard catches each planted write", caught.length === planted.length, planted.filter(p => !caught.includes(p)));
  const fine = [
    "await q(`UPDATE orgs SET emails_enabled=FALSE WHERE id=$1`);",
    "if (org.emails_enabled === false) return;",
    "await q(`INSERT INTO orgs (id, name, emails_enabled, staff_mail_enabled) VALUES ($1, $2, false, false)`);",
    "emails_enabled = CASE WHEN is_demo_org IS TRUE THEN FALSE ELSE emails_enabled END",
  ];
  ok("§4 …and passes the writes that keep a switch off", fine.every(p => violations("x.js", p).length === 0),
    fine.filter(p => violations("x.js", p).length));

  console.log("\n— §1 · every way an org is made starts with both switches off —");
  const signup = await register("/auth/register", { orgName: "F53 Signup " + uniq(), name: "Sam Signup", email: `f53-signup-${uniq()}@test.local`, password: PW });
  ok("§1 a signup's org starts with Staff mail and Donor mail off", signup.status < 300 && bothOff(await switches(signup.orgId)),
    { status: signup.status, s: await switches(signup.orgId) });
  const supEmail = `f53-super-${uniq()}@test.local`;
  const hq = await register("/auth/register-org", { orgName: "F53 HQ " + uniq(), userName: "Jonathan", email: supEmail, password: PW });
  await q(`UPDATE users SET is_super_admin=true WHERE lower(email)=lower($1)`, [supEmail]);
  const sup = await login(supEmail);
  const prov = await register("/auth/register-org", { orgName: "F53 Prospect " + uniq(), userName: "Pat Prospect",
    email: `f53-prov-${uniq()}@test.local`, password: PW, provisioned: true });
  ok("§1 an org a super-admin provisions (prospect trial) starts with both off", prov.status < 300 && bothOff(await switches(prov.orgId)),
    { status: prov.status, s: await switches(prov.orgId) });
  ok("§1 so does a register-org signup", hq.status < 300 && bothOff(await switches(hq.orgId)), await switches(hq.orgId));
  const bare = "org_f53_bare_" + uniq();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'F53 Script Org',$1,1,'active','team')`, [bare]);
  const b = await switches(bare);
  ok("§1 an org a script inserts without naming the switches gets the schema's default: Donor mail off",
    b.emails_enabled === false && b.staff_mail_enabled !== true, b);
  const [cols] = await q(`SELECT
      (SELECT column_default FROM information_schema.columns WHERE table_name='orgs' AND column_name='emails_enabled' AND table_schema=current_schema()) AS donor,
      (SELECT column_default FROM information_schema.columns WHERE table_name='orgs' AND column_name='staff_mail_enabled' AND table_schema=current_schema()) AS staff`);
  ok("§1 the schema default for both switches is false", cols.donor === "false" && cols.staff === "false", cols);

  console.log("\n— §2 · nothing else turns them on —");
  const org = signup.orgId;
  const [admin] = await q(`SELECT email FROM users WHERE org_id=$1`, [org]);
  const tok = await login(admin.email);
  const runId = "imp_f53" + uniq();
  const im = await api("POST", "/donors/import-combined", tok, { donors: [{ name: "Ivy Imported", email: `f53-ivy-${uniq()}@test.local` }], gifts: [], importId: runId });
  const rec = await api("POST", "/imports", tok, { id: runId, name: "donors.csv", sourceFilename: "donors.csv", shape: "donors", donorsCreated: 1, rowsIn: 1 });
  ok("§2 an import (which onboards the org) leaves both off", im.status < 300 && rec.status < 300 && bothOff(await switches(org)),
    { im: im.status, rec: rec.status, s: await switches(org) });
  const mk = await api("POST", `/admin/orgs/${hq.orgId}/mark-onboarded`, sup, {});
  ok("§2 Mark onboarded leaves both off", mk.status < 300 && bothOff(await switches(hq.orgId)), { s: mk.status, sw: await switches(hq.orgId) });
  const plan = await api("POST", `/admin/orgs/${org}/change-plan`, sup, { plan: "team" });
  ok("§2 a plan change leaves both off", plan.status < 300 && bothOff(await switches(org)), { s: plan.status, sw: await switches(org) });

  console.log("\n— §3 · the console toggle is the one way on —");
  const old = await api("POST", `/admin/orgs/${org}/email-switch`, sup, { emailsEnabled: true });
  ok("§3 the older /email-switch refuses to turn Donor mail on", old.status === 409 && (await switches(org)).emails_enabled === false,
    { s: old.status, b: old.body });
  const unasked = await api("POST", `/admin/orgs/${org}/mail-switches`, sup, { donor: true });
  ok("§3 the toggle without confirm asks first, saying what it will allow, and changes nothing",
    unasked.status === 409 && unasked.body.error === "confirm_required"
      && /automatic emails this organization turned on/.test(unasked.body.message || "") && bothOff(await switches(org)),
    { s: unasked.status, b: unasked.body });
  const notSuper = await api("POST", `/admin/orgs/${org}/mail-switches`, tok, { donor: true, confirm: true });
  ok("§3 an org's own admin cannot turn it on", notSuper.status === 403 && bothOff(await switches(org)), notSuper.status);
  const before = (await q(`SELECT COUNT(*)::int AS n FROM fin_audit_log WHERE org_id=$1 AND request_path LIKE '%/mail-switches'`, [org]))[0].n;
  const on = await api("POST", `/admin/orgs/${org}/mail-switches`, sup, { donor: true, confirm: true });
  const s = await switches(org);
  ok("§3 confirmed, Donor mail is on, and Staff mail stays off (its own switch)",
    on.status === 200 && s.emails_enabled === true && s.staff_mail_enabled === false, { st: on.status, s });
  ok("§3 …it records who and when", !!s.donor_mail_set_at && s.donor_mail_set_by_name === "Jonathan" && s.staff_mail_set_at === null, s);
  ok("§3 …and the console label says so; Staff mail reads off since created",
    /^Turned on by Jonathan, /.test(on.body.switchSince?.donor || "") && on.body.switchSince?.staff === "Off since created.", on.body.switchSince);
  // The audit row is written when the response finishes, so it is waited for.
  const audRows = () => q(`SELECT user_id, created_at, before_fields, after_fields FROM fin_audit_log
                            WHERE org_id=$1 AND request_path LIKE '%/mail-switches' ORDER BY created_at`, [org]);
  const aud = (await waitFor(async () => { const r = await audRows(); return r.length > before ? r : null; })) || await audRows();
  ok("§3 one audit row, with who and when, donor mail off to on",
    aud.length === before + 1 && !!aud[aud.length - 1].user_id && !!aud[aud.length - 1].created_at
      && aud[aud.length - 1].before_fields?.donor_mail === false && aud[aud.length - 1].after_fields?.donor_mail === true,
    aud);

  await q(`DELETE FROM orgs WHERE id=$1`, [bare]).catch(() => {});
  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
