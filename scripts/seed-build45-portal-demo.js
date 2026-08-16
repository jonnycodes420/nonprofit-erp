// BUILD-45 — dress the demo org's donor portal (deliverable 6).
//
// API-DRIVEN parts (safe anywhere, incl. prod): enable the portal, set the
// CREO theme, publish impact updates with photos. Idempotent — re-running
// updates in place / no-ops.
//
// LOCAL-ONLY parts (need rows only Stripe webhooks create — guarded to a
// localhost DATABASE_URL, never prod): a rich-history donor with an ACTIVE
// portal-manageable subscription, one PAUSED schedule, and one RECENT CANCEL
// whose drift alert shows on the day view.
//
// Usage:
//   local : BASE=http://localhost:5601 DB_SSL=disable node scripts/seed-build45-portal-demo.js
//   prod  : BASE=https://nonprofit-erp-production.up.railway.app \
//           DEMO_EMAIL=admin@creoarts.org DEMO_PASSWORD=… node scripts/seed-build45-portal-demo.js
//           (prod runs the API-driven parts only)

const BASE = require("./lib/prodGuard").writerBase("http://localhost:5601"); // loopback default + --i-know-this-is-prod for remote (BUILD-55)
const EMAIL = process.env.DEMO_EMAIL || "admin@creoarts.org";
const PASSWORD = process.env.DEMO_PASSWORD || "demo1234";
const IS_LOCAL = /localhost|127\.0\.0\.1/.test(BASE);

// Impact photos are REAL photographs committed in scripts/demo-assets/
// (free-tier Unsplash, provenance in scripts/demo-assets/README.md).
// A flat-color SVG placeholder here renders as a solid brand-color block on
// the donor page (objectFit:cover crops the caption away) — never regress to
// a <rect> placeholder for anything donor-visible.
const fs = require("fs");
const path = require("path");
const photo = (file) => "data:image/jpeg;base64," +
  fs.readFileSync(path.join(__dirname, "demo-assets", file)).toString("base64");

async function api(method, path, token, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch { /* raw */ }
  return { status: r.status, body: j };
}

(async () => {
  const login = await api("POST", "/auth/login", null, { email: EMAIL, password: PASSWORD });
  if (!login.body?.token) { console.error("login failed", login.body); process.exit(1); }
  const tok = login.body.token;

  // ── Theme + enable (API) ──
  const ps = await api("PUT", "/portal-settings", tok, {
    enabled: true,
    displayName: "CREO Arts",
    footerText: "CREO Arts · Making the arts belong to everyone · 214 Studio Row, Wilmore KY 40390",
    contactEmail: "hello@creoarts.org",
    einLine: "Tax ID (EIN): 82-4331907",
    primaryColor: "#1a6b4a",
    accentColor: "#c9a84c",
    poweredBy: false,
    minRecurringCents: 500,
  });
  console.log("portal-settings:", ps.status, ps.body?.enabled ? "enabled" : ps.body);
  const psGet = await api("GET", "/portal-settings", tok);
  console.log("portal url:", psGet.body?.portal_url);

  // ── Impact updates (API, idempotent by title) ──
  const existing = await api("GET", "/impact-updates", tok);
  const have = new Set((existing.body || []).map(u => u.title));
  const funds = (await api("GET", "/finance/funds", tok)).body || [];
  const scholarships = funds.find(f => /scholar|youth|access/i.test(f.name || ""));
  const updates = [
    {
      title: "Spring scholarships placed 32 young artists in studios",
      body: "Because of scholarship-fund donors, 32 students who couldn't otherwise afford studio time spent this spring learning ceramics, printmaking, and oil painting alongside working artists. Three of them showed work in the May student exhibition.",
      photos: [photo("demo-impact-exhibition.jpg")],
      targets: scholarships ? [{ kind: "fund", id: scholarships.id }] : [],
      orgWide: !scholarships,
    },
    {
      title: "The studio expansion broke ground",
      body: "The back lot is officially a construction site. When it opens next spring, the new wing doubles our teaching space and adds the first fully accessible studio in the county. Every capital-campaign gift moved this from a drawing to a foundation.",
      photos: [photo("demo-impact-studio.jpg")],
      targets: [],
      orgWide: true,
    },
  ];
  for (const u of updates) {
    if (have.has(u.title)) { console.log("impact (exists):", u.title); continue; }
    const r = await api("POST", "/impact-updates", tok, u);
    console.log("impact:", r.status, u.title);
  }

  if (!IS_LOCAL) {
    console.log("\nProd run — API-driven parts done. The paused-schedule and");
    console.log("recent-cancel demo pieces need subscription rows that only");
    console.log("Stripe creates; seed those with a real test subscription or");
    console.log("demo them on the local stack (see docs/build45-portal-demo/).");
    process.exit(0);
  }

  // ── LOCAL-ONLY: subscriptions + a portal cancel's drift trail ──
  const { Pool } = require("pg");
  const DB_URL = process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest";
  if (!/localhost|127\.0\.0\.1/.test(DB_URL)) { console.error("refusing non-local DB"); process.exit(1); }
  const pool = new Pool({ connectionString: DB_URL, ssl: false });
  const q = (sql, p) => pool.query(sql, p).then(r => r.rows);

  const [org] = await q(`SELECT id, org_slug FROM orgs WHERE id='org_creo'`);
  const donors = await q(`SELECT id, name, email FROM donors WHERE org_id=$1 AND deleted_at IS NULL AND email LIKE '%@%' ORDER BY total_giving DESC NULLS LAST LIMIT 3`, [org.id]);
  const [rich, paused, canceled] = donors;
  const ensureSub = async (id, donorId, subId, amount, status, extra = "") =>
    q(`INSERT INTO recurring_subscriptions (id,org_id,donor_id,stripe_subscription_id,amount,interval,status${extra ? "," + extra.split("=")[0] : ""})
       VALUES ($1,$2,$3,$4,$5,'month',$6${extra ? ",NOW()" : ""})
       ON CONFLICT (stripe_subscription_id) DO UPDATE SET status=$6`,
      [id, org.id, donorId, subId, amount, status]);
  await ensureSub("rs_demo_active", rich.id, "sub_demo_active", 50, "active");
  await ensureSub("rs_demo_paused", paused.id, "sub_demo_paused", 25, "paused", "paused_at=NOW()");
  await ensureSub("rs_demo_cxl", canceled.id, "sub_demo_cxl", 40, "canceled", "canceled_at=NOW()");
  // The drift trail a real portal cancel writes (audit + task + timeline).
  await q(`INSERT INTO portal_audit_log (id,org_id,donor_id,email,action,meta)
           VALUES ('pal_demo_cxl',$1,$2,$3,'recurring_cancel','{"subId":"rs_demo_cxl","reason":"budget this season"}')
           ON CONFLICT (id) DO NOTHING`, [org.id, canceled.id, canceled.email]);
  const [adminUser] = await q(`SELECT id, name FROM users WHERE org_id=$1 AND role='admin' ORDER BY created_at ASC LIMIT 1`, [org.id]);
  await q(`INSERT INTO tasks (id,org_id,title,due,priority,type,donor_id,assigned_to,assigned_to_name)
           VALUES ('t_demo_cxl',$1,$2,to_char(NOW(),'YYYY-MM-DD'),'high','donor',$3,$4,$5)
           ON CONFLICT (id) DO NOTHING`,
    [org.id, `${canceled.name} canceled their $40/month recurring gift — reach out today`, canceled.id, adminUser.id, adminUser.name]);
  await q(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,logged_by_name,metadata)
           VALUES ('int_demo_cxl',$1,$2,'note','Portal: canceled their $40/month recurring gift — reason: budget this season',to_char(NOW(),'YYYY-MM-DD'),'Donor portal','{"portal_event":"recurring_cancel"}')
           ON CONFLICT (id) DO NOTHING`, [org.id, canceled.id]);
  console.log(`\nlocal demo dressed: portal ${BASE.replace("5601", "4173")}/portal/${org.org_slug}`);
  console.log(`  rich-history donor w/ active sub: ${rich.name} <${rich.email}>`);
  console.log(`  paused schedule: ${paused.name}; recent portal cancel + drift alert: ${canceled.name}`);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
