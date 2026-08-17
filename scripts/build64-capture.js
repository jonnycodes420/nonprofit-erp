// BUILD-64 — render the donor-facing ARTIFACTS Jonathan has never seen: the
// receipt cover email, the year-end cover email, the magic-link sign-in email,
// and the receipt / year-end PDFs — for TWO themed demo orgs (terracotta, blue)
// and ONE unthemed org (the neutral default). Emails render to PNG via
// Playwright; the PDFs are committed as their real bytes (this environment has
// no PDF→image converter — pdftoppm/mutool/gs/imagemagick are all absent, and
// headless Chromium treats a PDF as a download, not an inline render; the
// brand battery already asserts each PDF's band color + that it renders, and
// the .pdf files here open directly). → docs/build64/artifacts/
//
// LOOPBACK ONLY — self-seeds throwaway orgs in the scratch DB. Boot the scratch
// server with RESEND_BASE_URL=:5602 (this script starts the sink) so it can
// capture the real outbound bytes.
//
//   PLAYWRIGHT_DIR=$HOME/steward-qa BASE=http://localhost:5601 \
//   DATABASE_URL=postgres://steward@localhost:5544/steward_loadtest DB_SSL=disable \
//   node scripts/build64-capture.js

const fs = require("fs");
const path = require("path");
const http = require("http");
const bcrypt = require("bcryptjs");
const { Client } = require("pg");
const { writerBase, writerDbUrl } = require("./lib/prodGuard"); // self-seeds the scratch DB — guarded like every writer

const BASE = writerBase("http://localhost:5601");
const DB_URL = writerDbUrl();
const PW = require(path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright"));
const OUT = path.join(__dirname, "..", "docs", "build64", "artifacts");

const db = new Client({ connectionString: DB_URL, ssl: process.env.DB_SSL === "disable" ? false : { rejectUnauthorized: false } });
const q = (t, p) => db.query(t, p).then(r => r.rows);

async function api(method, pth, token, body) {
  const r = await fetch(BASE + pth, {
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}

// Three orgs: two themed (the "for each demo org" shape) + one unthemed.
const ORGS = [
  { id: "org_b64_terra", slug: "b64-brushworks", staff: "Brushworks Collective (Demo)", display: "Brushworks Collective", primary: "#b8593f", accent: "#7a5230", admin: "b64-a@test.local", donor: "sam.b64a@test.local" },
  { id: "org_b64_blue",  slug: "b64-harbor",     staff: "Harbor Music School (Demo)",   display: "Harbor Music School",   primary: "#33538a", accent: "#7a5230", admin: "b64-b@test.local", donor: "sam.b64b@test.local" },
  { id: "org_b64_plain", slug: "b64-riverkeep",  staff: "Riverkeepers Alliance (Demo)", display: "Riverkeepers Alliance", primary: null,      accent: null,      admin: "b64-c@test.local", donor: "sam.b64c@test.local" },
];

async function cleanup(id) {
  for (const t of ["receipts", "portal_magic_links", "portal_sessions", "fin_transactions", "budgets", "accounts", "fin_funds", "gifts", "donors", "users", "portal_settings"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [id]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [id]).catch(() => {});
}

async function seed(o) {
  await cleanup(o.id);
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,stripe_account_id,mission,
             legal_name,ein,receipt_address,receipt_signature_name,receipt_signature_title,receipts_enabled)
           VALUES ($1,$2,$3,1,'active','core',$4,'Every gift, put to work.',
             $5,'81-7654321','200 Harbor Way, Portland, OR 97201','Dana Ruiz','Executive Director',true)`,
    [o.id, o.staff, o.slug, "acct_" + o.id, o.display + ", Inc."]);
  if (o.primary) {
    await q(`INSERT INTO portal_settings (org_id,enabled,network_listed,display_name,primary_color,accent_color,button_color)
             VALUES ($1,true,true,$2,$3,$4,$3)`, [o.id, o.display, o.primary, o.accent]);
  } else {
    // Unthemed: portal enabled + listed, NO colors → the designed neutral default.
    await q(`INSERT INTO portal_settings (org_id,enabled,network_listed,display_name) VALUES ($1,true,true,$2)`, [o.id, o.display]);
  }
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Admin','admin')`, ["u_" + o.id, o.id, o.admin, hash]);
  await q(`INSERT INTO donors (id,org_id,name,email,total_giving,gift_count) VALUES ($1,$2,'Sam Rivera',$3,240,2)`, ["d_" + o.id, o.id, o.donor]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,payment_method) VALUES ($1,$2,$3,120,'2026-03-14','Credit card')`, ["g1_" + o.id, o.id, "d_" + o.id]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,payment_method) VALUES ($1,$2,$3,120,'2026-08-14','Credit card')`, ["g2_" + o.id, o.id, "d_" + o.id]);
}

async function login(email) {
  return (await api("POST", "/auth/login", null, { email, password: "loadtest1234" })).body?.token;
}

// Render one captured email's HTML into a light "inbox card" and screenshot it.
async function renderEmail(browser, html, from, subject, file) {
  const page = await browser.newPage({ viewport: { width: 720, height: 900 }, deviceScaleFactor: 2 });
  const wrap = `<!doctype html><html><head><meta charset="utf-8">
    <style>body{margin:0;background:#eef0ee;font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:28px;}
    .env{max-width:640px;margin:0 auto;background:#fff;border-radius:14px;box-shadow:0 6px 30px rgba(0,0,0,.10);overflow:hidden;}
    .hd{padding:14px 20px;border-bottom:1px solid #eee;font-size:13px;color:#555;}
    .hd b{color:#111;} .bd{padding:0;}</style></head>
    <body><div class="env"><div class="hd"><div><b>From:</b> ${from.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div><div><b>Subject:</b> ${subject.replace(/</g, "&lt;")}</div></div>
    <div class="bd">${html}</div></div></body></html>`;
  await page.setContent(wrap, { waitUntil: "networkidle" });
  const card = await page.$(".env");
  await card.screenshot({ path: path.join(OUT, file) });
  await page.close();
  console.log("  email →", file);
}

async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  await db.connect();

  // Capturing Resend sink (the server's RESEND_BASE_URL=:5602).
  const captured = [];
  const sink = http.createServer((req, res) => {
    let b = ""; req.on("data", c => b += c);
    req.on("end", () => { try { if (req.url === "/emails" && b) captured.push(JSON.parse(b)); } catch {} res.writeHead(200, { "Content-Type": "application/json" }); res.end("{}"); });
  });
  await new Promise(r => { sink.on("error", () => r()); sink.listen(5602, r); });

  const browser = await PW.chromium.launch();
  for (const o of ORGS) {
    console.log(`\n== ${o.display} (${o.primary || "unthemed"}) ==`);
    await seed(o);
    const tok = await login(o.admin);

    // (a) gift receipt → cover email + PDF
    captured.length = 0;
    const rc = await api("POST", `/gifts/g2_${o.id}/receipt`, tok);
    if (rc.status !== 201) console.log("  receipt issue failed:", rc.status, rc.body);
    // (b) year-end statement → cover email + PDF
    const ye = await api("POST", `/donors/d_${o.id}/year-end-statement`, tok, { year: 2026, send: true });
    if (ye.status >= 400) console.log("  year-end failed:", ye.status, ye.body);
    // (c) magic-link sign-in email
    await api("POST", `/portal/${o.slug}/request-link`, null, { email: o.donor });

    await new Promise(r => setTimeout(r, 400)); // let sends flush to the sink

    for (const m of captured) {
      const to = m.to || "";
      let tag = /year-end/i.test(m.subject) ? "year-end-email" : /sign-in/i.test(m.subject) ? "magic-link-email" : "receipt-email";
      await renderEmail(browser, m.html || "", m.from || "", m.subject || "", `${o.slug}--${tag}.png`);
    }

    // PDFs — the real bytes (openable; no converter in this env).
    const recs = await q(`SELECT type, pdf_data FROM receipts WHERE org_id=$1 AND voided_at IS NULL ORDER BY created_at ASC`, [o.id]);
    for (const r of recs) {
      const f = `${o.slug}--${r.type === "year_end" ? "year-end" : "receipt"}.pdf`;
      fs.writeFileSync(path.join(OUT, f), Buffer.from(r.pdf_data, "base64"));
      console.log("  pdf   →", f);
    }
  }
  await browser.close();
  await new Promise(r => sink.close(r));
  await db.end();
  console.log("\nDone →", path.relative(process.cwd(), OUT));
}
run().catch(e => { console.error(e); process.exit(1); });
