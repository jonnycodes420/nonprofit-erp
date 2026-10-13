// SCALE-2 · a FIRST mailbox read for a 25,000-donor org, timed and counted.
//
//   STANDIN=http://localhost:6748 BASE=http://localhost:6741 node scripts/load/mailbox-first-read.js [org_load000]
//
// Needs a load server on BASE whose GMAIL_API_BASE is the stand-in at STANDIN
// (scripts/load/standins.js with STANDIN_PROVIDER_PORT), on the seeded load
// database. It adds one throwaway person and a Gmail connection to the org
// (the org's own sealed credential, copied), reads it once through "Read now"
// (the same syncMailbox a first read runs), prints the Gmail calls and the
// seconds, and removes what it added. The audit rows its two requests write
// stay: they are append-only by design. Refuses anything not loopback.
const { Pool } = require("pg");

const BASE = process.env.BASE || "http://localhost:6741";
const STANDIN = process.env.STANDIN || "http://localhost:6748";
const DB = process.env.DATABASE_URL || "postgresql://steward@localhost:5546/steward_scale1";
const loop = /^http:\/\/(localhost|127\.0\.0\.1)[:/]/;
if (!loop.test(BASE) || !loop.test(STANDIN) || !/@(localhost|127\.0\.0\.1)[:/]/.test(DB)) {
  console.error("Refusing: BASE, STANDIN and DATABASE_URL must be loopback."); process.exit(1);
}
const ORG = process.argv[2] || "org_load000";
const USER = "usr_scale2mbx", CONN = "mbx_scale2mbx", EMAIL = `scale2-mailbox@${ORG.replace(/^org_/, "")}.load`;

(async () => {
  const p = new Pool({ connectionString: DB, ssl: false, max: 2 });
  const cleanup = async () => {
    await p.query(`DELETE FROM interactions WHERE org_id=$1 AND created_by=$2`, [ORG, `system:mailbox/google/${USER}`]);
    await p.query(`DELETE FROM mailbox_sync_runs WHERE user_id=$1`, [USER]);
    await p.query(`DELETE FROM mailbox_connections WHERE id=$1`, [CONN]);
    await p.query(`DELETE FROM user_sessions WHERE user_id=$1`, [USER]).catch(() => {});
    await p.query(`DELETE FROM users WHERE id=$1`, [USER]);
  };
  await cleanup();
  const [admin] = (await p.query(`SELECT password_hash FROM users WHERE org_id=$1 AND role='admin' ORDER BY id LIMIT 1`, [ORG])).rows;
  const [seal] = (await p.query(`SELECT credentials_sealed FROM mailbox_connections WHERE org_id=$1 AND provider='google' LIMIT 1`, [ORG])).rows;
  const [{ n }] = (await p.query(`SELECT COUNT(*)::int n FROM donors WHERE org_id=$1 AND email <> '' AND deleted_at IS NULL`, [ORG])).rows;
  await p.query(`INSERT INTO users (id, org_id, email, password_hash, name, role) VALUES ($1,$2,$3,$4,'Mailbox Measure','admin')`,
    [USER, ORG, EMAIL, admin.password_hash]);
  // A second Gmail connection in the org, never read before: no history id.
  await p.query(`INSERT INTO mailbox_connections (id, org_id, user_id, provider, address, status, credentials_sealed, token_expires_at,
                   calendar_granted, created_by, created_by_name)
                 VALUES ($1,$2,$3,'google',$4,'active',$5,NOW() + INTERVAL '1 year',false,'system:scale2-measure','SCALE-2 measure')`,
    [CONN, ORG, USER, EMAIL, seal.credentials_sealed]);
  try {
    const login = await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: EMAIL, password: "loadtest1234" }) });
    if (!login.ok) throw new Error(`login ${login.status} ${await login.text()}`);
    const { token } = await login.json();
    await fetch(`${STANDIN}/__reset`);
    const t0 = performance.now();
    const r = await fetch(`${BASE}/mailbox/google/sync`, { method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ what: "mail" }) });
    const secs = (performance.now() - t0) / 1000;
    const body = await r.json();
    const counts = (await (await fetch(`${STANDIN}/__counts`)).json()).providers;
    const gmail = Object.entries(counts).filter(([k]) => k.includes("/gmail/"));
    const calls = gmail.reduce((s, [, v]) => s + v, 0);
    const [run] = (await p.query(`SELECT ok, found, logged, EXTRACT(EPOCH FROM finished_at - started_at)::float AS secs
                                    FROM mailbox_sync_runs WHERE user_id=$1 AND kind='mail' ORDER BY started_at DESC LIMIT 1`, [USER])).rows;
    console.log(JSON.stringify({ org: ORG, addresses: n, status: r.status, ok: body.ok, gmailCalls: calls, byPath: Object.fromEntries(gmail),
      requestSeconds: +secs.toFixed(2), readSeconds: run ? +Number(run.secs).toFixed(2) : null, run }));
  } finally {
    await cleanup();
    await p.end();
  }
})().catch(e => { console.error(e); process.exit(1); });
