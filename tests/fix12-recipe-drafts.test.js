// tests/fix12-recipe-drafts.test.js — FIX-12 Part 2. THE ONE GUARD THIS PART EARNED.
//
//     A WORKFLOW RECIPE FIRING FOR A DONOR CREATES A DRAFT AND MAKES NO CALL
//     TO THE MAIL PROVIDER. STEWARD DRAFTS IT. YOU SEND IT.
//
// The suite starts its OWN server with Resend pointed at a stand-in
// (RESEND_BASE_URL) that counts every request. On a fixture org it turns on
// the three recipes that write to a donor (first-gift thank-you, failed-card
// recovery, lapse re-engagement with its email box ticked), plus one recipe
// row still carrying the pre-FIX-12 `send_email` action, fires each, and
// asserts: a draft per recipe in the drafts queue, and the stand-in heard
// NOTHING. Then a person presses Send on one draft, which MUST reach the
// stand-in: proof the stand-in is wired, so the zero above is a real zero.
//
// HOW IT WOULD GO RED: any recipe action calling a mail function; the engine
// treating a legacy `send_email` row as a send. Proven able to fail: putting
// `await sendWorkflowEmail(...)` back in the draft_email branch turns the
// zero-calls check red.
//
// Standard scratch stack (tests/README.md); the database is the shard's own.

const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const bcrypt = require("bcryptjs");
const { ok, summary, q, closeDb } = require("./helpers");

const ORG = "org_fix12wf";
const DONOR_EMAIL = "jonathan@stewardapp.dev";   // the only address a test may name
const freePort = () => new Promise(r => { const s = http.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });

async function clean() {
  for (const t of ["milestone_drafts", "workflow_runs", "workflows", "tasks", "interactions", "recurring_subscriptions", "donors", "user_sessions", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
}

(async () => {
  await clean();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Fix Twelve Workflow Org','fix-twelve-wf',1,'active','team')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_fix12wf',$1,'staff@fix12wf.local',$2,'Recipe Staff','admin')`, [ORG, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO donors (id,org_id,name,email,stage,total_giving,created_by,created_by_name) VALUES ('d_fix12wf',$1,'Jonathan Fixture',$2,'active',50,'system:test','test')`, [ORG, DONOR_EMAIL]);

  const heard = [];
  const sink = http.createServer((req, res) => {
    let b = ""; req.on("data", c => b += c);
    req.on("end", () => { heard.push(req.url); res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ id: "em_" + heard.length })); });
  });
  await new Promise(r => sink.listen(0, r));
  const port = await freePort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT: String(port), RESEND_API_KEY: "re_dummy_local", RESEND_BASE_URL: `http://localhost:${sink.address().port}`,
           DISABLE_BACKGROUND_TICKS: "1", TEST_MODE: "1", JWT_SECRET: process.env.JWT_SECRET || "local-test-secret", SENTRY_DSN: "" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let errs = ""; child.stderr.on("data", d => { errs += d; });
  const B = `http://localhost:${port}`;
  let up = false;
  for (let i = 0; i < 90 && !up; i++) { await new Promise(r => setTimeout(r, 1000)); up = await fetch(B + "/health").then(r => r.ok).catch(() => false); }
  ok("the recipe server started", up, errs.slice(-300));

  try {
    const login = await (await fetch(B + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "staff@fix12wf.local", password: "loadtest1234" }) })).json();
    const H = { "Content-Type": "application/json", Authorization: "Bearer " + login.token };
    const call = (m, p, body) => fetch(B + p, { method: m, headers: H, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));

    const list = await call("GET", "/workflows");
    ok("the recipes are provisioned", Array.isArray(list.body) && list.body.length > 0, list.status);
    // Only the recipes that write to a DONOR are on: the staff alerts would
    // (rightly) reach the mail provider and muddy the zero.
    await q(`UPDATE workflows SET enabled=false WHERE org_id=$1`, [ORG]);
    await q(`UPDATE workflows SET enabled=true WHERE org_id=$1 AND recipe_key IN ('new_donor_welcome','failed_recurring_recovery','lapsing_reengage')`, [ORG]);
    await q(`UPDATE workflows SET config='{"lapseDays":365,"sendEmail":true}'::jsonb WHERE org_id=$1 AND recipe_key='lapsing_reengage'`, [ORG]);
    // A recipe row exactly as saved before FIX-12: the live recipe on an org
    // that the migration has not reached. It must draft too.
    await q(`UPDATE workflows SET actions='[{"type":"send_email","template":"thankyou"}]'::jsonb WHERE org_id=$1 AND recipe_key='new_donor_welcome'`, [ORG]);

    const fired = [];
    for (const [trigger, extra] of [["gift_received", { amount: 50, isFirstGift: true }], ["recurring_failed", { amount: 25 }], ["donor_lapsed", {}]]) {
      const r = await call("POST", "/workflows/simulate", { trigger, donorId: "d_fix12wf", dedupKey: `fix12:${trigger}`, ...extra });
      fired.push(...((r.body && r.body.ran) || []).map(x => x.recipeKey));
    }
    ok("all three donor recipes fired", ["new_donor_welcome", "failed_recurring_recovery", "lapsing_reengage"].every(k => fired.includes(k)), fired.join(","));

    const drafts = await q(`SELECT * FROM milestone_drafts WHERE org_id=$1 ORDER BY created_at`, [ORG]);
    const keys = drafts.map(d => d.milestone_key);
    ok("a draft per recipe is waiting in the drafts queue",
      ["workflow:new_donor_welcome:thankyou", "workflow:failed_recurring_recovery:recovery", "workflow:lapsing_reengage:reengage"].every(k => keys.includes(k)), keys.join(","));
    ok("every draft is pending review, unsent, and stamped with the workflow as its actor",
      drafts.length >= 3 && drafts.every(d => d.status === "pending_review" && !d.sent_at && /^system:workflow:/.test(d.created_by || "")), JSON.stringify(drafts.map(d => [d.status, d.created_by])));
    const runs = await q(`SELECT actions_taken FROM workflow_runs WHERE org_id=$1`, [ORG]);
    ok("the run log says drafted, not sent", runs.every(r => (r.actions_taken || []).every(a => a.sent !== true)), JSON.stringify(runs.map(r => r.actions_taken)));
    await new Promise(r => setTimeout(r, 500));
    ok("the mail provider heard NOTHING while the recipes fired", heard.length === 0, `${heard.length} call(s): ${heard.join(", ")}`);

    const queue = await call("GET", "/milestone-drafts");
    ok("the drafts show in the queue she reviews", (queue.body || []).filter(d => (d.source || "").startsWith("workflow:")).length >= 3, queue.status);

    // The positive control: her press reaches the provider.
    const one = drafts.find(d => d.milestone_key === "workflow:new_donor_welcome:thankyou");
    const sent = await call("POST", `/milestone-drafts/${one.id}/send`);
    await new Promise(r => setTimeout(r, 300));
    ok("a person pressing Send on a draft DOES reach the mail provider", sent.status === 200 && heard.length === 1, `${sent.status} ${JSON.stringify(sent.body)} heard=${heard.length}`);
  } finally {
    child.kill();
    sink.close();
    await clean();
    await closeDb();
  }
  summary("fix12-recipe-drafts");
})().catch(async e => { console.error(e); process.exitCode = 1; await closeDb().catch(() => {}); });
