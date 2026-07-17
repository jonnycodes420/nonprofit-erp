// Full-org CSV zip export (BUILD-03's uncommitted verification, rebuilt as the
// committed suite in BUILD-06 Phase B). Asserts the access matrix (staff 403,
// no token 401, trial_expired admin 200 — the whole point of the export),
// every expected file present, edit_token absent from both extracted files and
// raw zip bytes, the formula-injection guard, and two-way org isolation.
// Needs the `unzip` binary (present on macOS/Linux).
//
//   node tests/export-zip.test.js
//
const bcrypt = require("bcryptjs");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { BASE, ok, summary, login, q, closeDb } = require("./helpers");

const ORG = "org_test_export";
const EDIT_TOKEN = "deadbeef".repeat(8); // 64 hex chars, the invites.token shape

async function seed() {
  for (const t of ["gifts", "donors", "giving_pages", "peer_fundraisers", "users", "fin_funds"]) {
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  }
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]);
  await q(`INSERT INTO orgs (id, name, onboarding_complete, org_slug) VALUES ($1,'Export Fixture Org',1,'export-fixture')`, [ORG]);
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO users (id, org_id, email, password_hash, name, role) VALUES
    ('u_exp_admin',$1,'exp-admin@test.local',$2,'Exp Admin','admin'),
    ('u_exp_staff',$1,'exp-staff@test.local',$2,'Exp Staff','staff')`, [ORG, hash]);
  await q(`INSERT INTO donors (id, org_id, name, email, total_giving, tags) VALUES
    ('d_exp_1',$1,'=SUM(A1:A9)','evil@test.local',100,'["vip","board-adjacent"]'),
    ('d_exp_2',$1,'Plain Donor','plain@test.local',50,'[]')`, [ORG]);
  await q(`INSERT INTO gifts (id, org_id, donor_id, amount, date, type) VALUES
    ('g_exp_1',$1,'d_exp_1',100,'2026-01-15','cash')`, [ORG]);
  await q(`INSERT INTO giving_pages (id, org_id, slug, title, status) VALUES ('gp_exp_1',$1,'spring','Spring Campaign','active')`, [ORG]);
  await q(`INSERT INTO peer_fundraisers (id, org_id, giving_page_id, name, email, slug, edit_token, status) VALUES
    ('pf_exp_1',$1,'gp_exp_1','Peer Person','peer@test.local','peer-person',$2,'active')`, [ORG, EDIT_TOKEN]);
}

async function fetchZip(token) {
  const res = await fetch(BASE + "/org/export/csv", { headers: token ? { Authorization: "Bearer " + token } : {} });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, buf };
}

async function main() {
  await seed();
  const tAdmin = await login("exp-admin@test.local");
  const tStaff = await login("exp-staff@test.local");
  const tOther = await login("admin@willow.test");

  // ── Access matrix ─────────────────────────────────────────────────────────
  console.log("\n── Access ──");
  ok("staff → 403", (await fetchZip(tStaff)).status === 403);
  ok("no token → 401", (await fetchZip(null)).status === 401);

  await q(`UPDATE orgs SET subscription_status='trial_expired', trial_ends_at=NOW() - INTERVAL '10 days' WHERE id=$1`, [ORG]);
  const lapsed = await fetchZip(tAdmin);
  ok("trial_expired (read_only) admin → 200 — a lapsed org can always leave with its data", lapsed.status === 200, lapsed.status);
  await q(`UPDATE orgs SET subscription_status='trialing', trial_ends_at=NOW() + INTERVAL '10 days' WHERE id=$1`, [ORG]);

  // ── Contents ──────────────────────────────────────────────────────────────
  console.log("\n── Zip contents ──");
  const { status, buf } = await fetchZip(tAdmin);
  ok("admin → 200 zip", status === 200 && buf.slice(0, 2).toString() === "PK", { status, magic: buf.slice(0, 2).toString() });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "steward-export-test-"));
  const zipPath = path.join(dir, "export.zip");
  fs.writeFileSync(zipPath, buf);
  execFileSync("unzip", ["-o", "-q", zipPath, "-d", dir]);
  const files = fs.readdirSync(dir).filter(f => f !== "export.zip");

  const expected = ["README.txt", "donors.csv", "gifts.csv", "interactions.csv", "grants.csv", "pledges.csv", "planned_gifts.csv", "recurring.csv", "giving_pages.csv", "peer_fundraisers.csv", "receipts.csv"];
  ok("every expected file present", expected.every(f => files.includes(f)), expected.filter(f => !files.includes(f)));

  const donorsCsv = fs.readFileSync(path.join(dir, "donors.csv"), "utf-8");
  ok("formula-name donor '-escaped in donors.csv", donorsCsv.includes("'" + "=SUM(A1:A9)"), donorsCsv.split("\n").find(l => l.includes("SUM")));
  ok("tags pipe-joined", donorsCsv.includes("vip|board-adjacent"), null);

  const peersCsv = fs.readFileSync(path.join(dir, "peer_fundraisers.csv"), "utf-8");
  ok("peer_fundraisers.csv present but edit_token column absent", peersCsv.includes("Peer Person") && !peersCsv.toLowerCase().includes("edit_token") && !peersCsv.includes(EDIT_TOKEN), peersCsv.split("\n")[0]);
  ok("edit_token value absent from RAW zip bytes", !buf.includes(EDIT_TOKEN));

  const readme = fs.readFileSync(path.join(dir, "README.txt"), "utf-8");
  ok("README carries row counts", /donors\.csv/.test(readme) && /\d/.test(readme), readme.slice(0, 100));

  // ── Org isolation, both directions ────────────────────────────────────────
  console.log("\n── Org isolation ──");
  ok("fixture export has no other-org donors", !donorsCsv.includes("willow") && !buf.includes("admin@riverbend.test"));
  const other = await fetchZip(tOther);
  ok("other org export has none of the fixture's data", other.status === 200 && !other.buf.includes("=SUM(A1:A9)") && !other.buf.includes("Peer Person") && !other.buf.includes(EDIT_TOKEN), other.status);

  fs.rmSync(dir, { recursive: true, force: true });
  await closeDb();
  summary();
}
main().catch(e => { console.error(e); process.exit(1); });
