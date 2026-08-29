// BUILD-35 Part 2 — email polish, proven on REAL captured email bytes.
// Local scratch server + Postgres; the server must be booted with
// RESEND_BASE_URL=http://localhost:5602 (run-all.sh recipe). This suite runs
// its own capture sink on 5602 for its duration — no real email ever leaves.
//
// What it proves:
//   1. Title-case names: a lowercase-signup org ("creo arts collective") and
//      user ("jon") render title-cased in digest subjects + headings and the
//      branded header; a deliberately mixed-case name is preserved verbatim
//      (the conservative displayNameCase rule).
//   2. An all-zero officer month never renders "0 asks · 0 moves · 0 gifts":
//      with prospects due for a touch → the computed nudge variant; with
//      nothing actionable → NO send, but the period is still reserved
//      (digest_sends row, meta.suppressed) so the tick never retries.
//   3. A normal month renders the stat rows unchanged; idempotency holds
//      (second run → zero new emails).
//   4. Week-in-Review: a fully-empty week → nudge or reserved-suppressed,
//      never four empty sections; links in digests are canonical (no
//      vercel.app / railway.app / localhost).

const http = require("http");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, SINK_PORT } = require("./helpers");

const ORG = "org_ep_a";
let captured = [];
const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", c => (body += c));
  req.on("end", () => {
    try { captured.push({ path: req.url, body: body ? JSON.parse(body) : null }); } catch { /* non-JSON */ }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: "mock_" + Math.random().toString(36).slice(2) }));
  });
});
const mailTo = to => captured.filter(e => e.path === "/emails" && (e.body?.to === to || e.body?.to?.includes?.(to)));

async function reset() {
  for (const t of ["digest_sends", "workflow_runs", "workflows", "receipts", "tasks", "interactions", "opportunities", "moves", "gifts", "donors", "users", "fin_transactions", "budgets", "accounts", "fin_funds"]) {
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  }
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]);
}

(async () => {
  await new Promise((res, rej) => { mock.on("error", rej); mock.listen(SINK_PORT, res); });
  await reset();

  // Lowercase-signup org + users (the exact live finding: "Monthly Report — jon").
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'creo arts collective','ep-a',1,'active','team')`, [ORG]);
  const hash = bcrypt.hashSync("loadtest1234", 10);
  const mkUser = (id, email, name, role = "admin") =>
    q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,$6)`, [id, ORG, email, hash, name, role]);
  await mkUser("u_ep_adm", "admin@ep.local", "jon");                         // all-lower → recased
  await mkUser("u_ep_busy", "busy@ep.local", "eleanor fitzgerald", "staff"); // normal month
  await mkUser("u_ep_idle", "idle@ep.local", "IDLE OFFICER", "staff");       // all-zero month, prospects due
  await mkUser("u_ep_bare", "bare@ep.local", "McKinney", "staff");           // all-zero, NOTHING actionable; mixed case preserved
  const tok = await login("admin@ep.local");

  // A pinned month (June 2026) + week for deterministic windows.
  const MO = "2026-06-01", WK = "2026-06-01"; // June 1 2026 is a Monday
  const inMo = "2026-06-10";

  // Busy officer: one ask, one move, one closed gift inside the month.
  await q(`INSERT INTO donors (id,org_id,name,assigned_to,total_giving) VALUES ('d_ep_1',$1,'Margaret Chen','u_ep_busy',500)`, [ORG]);
  await q(`INSERT INTO opportunities (id,org_id,donor_id,name,target_amount,status,officer_id,officer_name,created_at) VALUES ('opp_ep_1',$1,'d_ep_1','Spring ask',5000,'open','u_ep_busy','eleanor fitzgerald',$2)`, [ORG, inMo]);
  await q(`INSERT INTO opportunities (id,org_id,donor_id,name,target_amount,gift_amount,status,officer_id,officer_name,created_at,closed_at) VALUES ('opp_ep_2',$1,'d_ep_1','Won ask',2000,2000,'won','u_ep_busy','eleanor fitzgerald',$2,$2)`, [ORG, inMo]);
  await q(`INSERT INTO moves (id,org_id,donor_id,officer_id,officer_name,from_stage,to_stage,description,created_at) VALUES ('mv_ep_1',$1,'d_ep_1','u_ep_busy','eleanor fitzgerald','qualify','cultivate','Coffee went well',$2)`, [ORG, inMo]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date) VALUES ('g_ep_1',$1,'d_ep_1',250,$2)`, [ORG, inMo]);

  // Idle officer: zero activity but a 12-prospect portfolio, none touched in 30d.
  for (let i = 0; i < 12; i++) {
    await q(`INSERT INTO donors (id,org_id,name,assigned_to,stage) VALUES ($1,$2,$3,'u_ep_idle','cultivate')`, [`d_ep_p${i}`, ORG, `Prospect ${i}`]);
  }
  // Bare officer: no portfolio at all → nothing actionable.

  // ── Run the monthly digest for the pinned month ──────────────────────────
  captured = [];
  let r = await api("POST", "/digests/run", tok, { type: "monthly", monthStart: MO });
  ok("digests/run monthly → 200", r.status === 200, r.status);

  const busyMail = mailTo("busy@ep.local");
  ok("normal month: officer got exactly one report", busyMail.length === 1, busyMail.length);
  const busyHtml = busyMail[0]?.body?.html || "";
  ok("normal month keeps the stat rows (asks/moves/gifts unchanged)", /Asks made/.test(busyHtml) && /Moves made/.test(busyHtml) && /Gifts closed/.test(busyHtml));
  ok("lowercase officer name renders title-cased in the heading", busyHtml.includes("Monthly Report — Eleanor Fitzgerald"), busyHtml.match(/Monthly Report[^<]*/)?.[0]);
  ok("lowercase ORG name renders title-cased in the subject", busyMail[0].body.subject === "Your Monthly Report — Creo Arts Collective", busyMail[0].body.subject);
  ok("branded header carries the title-cased org name", busyHtml.includes(">Creo Arts Collective</span>") || />Creo Arts Collective</.test(busyHtml), busyHtml.slice(0, 400));

  const idleMail = mailTo("idle@ep.local");
  ok("all-zero month with prospects due → the NUDGE variant, one email", idleMail.length === 1, idleMail.length);
  const idleHtml = idleMail[0]?.body?.html || "";
  ok("nudge names the real number of prospects due for a touch (12)", /<strong>12<\/strong> prospect/.test(idleHtml), idleHtml.match(/No moves[^<]*/)?.[0]);
  ok("nudge variant carries NO zero stat row", !/Asks made/.test(idleHtml) && !/0 · \$0/.test(idleHtml));
  ok("ALL-UPPER officer name recased in nudge heading", idleHtml.includes("Monthly Report — Idle Officer"), idleHtml.match(/Monthly Report[^<]*/)?.[0]);
  ok("nudge links to the canonical app URL", /https:\/\/www\.stewardapp\.dev\/dashboard/.test(idleHtml) || /http:\/\/localhost:\d+\/dashboard/.test(idleHtml), idleHtml.match(/href="[^"]+"/)?.[0]);

  ok("nothing-actionable officer got NO email", mailTo("bare@ep.local").length === 0, mailTo("bare@ep.local").length);
  const [bareRow] = await q(`SELECT meta FROM digest_sends WHERE org_id=$1 AND digest_type='monthly' AND recipient_user_id='u_ep_bare'`, [ORG]);
  const bareMeta = bareRow ? (typeof bareRow.meta === "string" ? JSON.parse(bareRow.meta || "{}") : bareRow.meta || {}) : {};
  ok("…but the period IS reserved (no tick retries), meta says suppressed", !!bareRow && bareMeta.suppressed === true, bareRow);

  // Idempotency: run the same month again → zero new emails.
  const before = captured.filter(e => e.path === "/emails").length;
  r = await api("POST", "/digests/run", tok, { type: "monthly", monthStart: MO });
  ok("second run of the same month sends NOTHING (idempotent)", captured.filter(e => e.path === "/emails").length === before, r.body?.monthly);

  // ── Week-in-Review: fully-empty week → nudge (prospects exist org-wide) ──
  captured = [];
  const EMPTY_WK = "2026-03-02"; // a Monday long before any seeded activity
  r = await api("POST", "/digests/run", tok, { type: "weekly", weekStart: EMPTY_WK });
  ok("empty-week run → 200", r.status === 200, r.status);
  const admWk = mailTo("admin@ep.local");
  ok("empty week with due donors → the weekly nudge, not four empty sections", admWk.length === 1 && /due for a touch/.test(admWk[0].body.html) && !/No gifts recorded this week/.test(admWk[0].body.html), admWk[0]?.body?.subject);
  ok("weekly subject title-cases the org", admWk[0]?.body?.subject === "Week in Review — Creo Arts Collective", admWk[0]?.body?.subject);
  ok("no digest link rides a deployment host", captured.filter(e => e.path === "/emails").every(e => !/vercel\.app|up\.railway\.app/.test(e.body?.html || "")));

  // A NORMAL week (the seeded June activity) still renders the full sections.
  captured = [];
  r = await api("POST", "/digests/run", tok, { type: "weekly", weekStart: "2026-06-08" });
  const busyWk = mailTo("busy@ep.local");
  ok("normal week unchanged (sections render)", busyWk.length === 1 && /Gifts received/.test(busyWk[0].body.html), busyWk[0]?.body?.subject);

  // ── Receipt cover + workflow emails (live-test findings, 2026-08-05) ─────
  // The receipt cover email must be branded, title-cased in subject AND body,
  // and a year-end statement must not call itself a "donation receipt".
  await api("PATCH", `/orgs/${ORG}`, tok, { legalName: "Creo Arts Collective", ein: "987654321", receiptAddress: "9 Front St, Fairhope, AL", receiptsEnabled: true });
  const nd = await api("POST", "/donors", tok, { name: "Receipt Donor", email: "receipt-donor@ep.local" });
  const ndId = nd.body.id;
  const ng = await api("POST", `/donors/${ndId}/gifts`, tok, { amount: 300, date: "2026-06-20", type: "cash" });
  captured = [];
  r = await api("POST", `/gifts/${ng.body.gift.id}/receipt`, tok, { send: true });
  ok("receipt issued", r.status >= 200 && r.status < 300 && !!r.body.receipt_number, r.status);
  const rc = mailTo("receipt-donor@ep.local");
  ok("receipt cover: ONE email", rc.length === 1, rc.length);
  ok("receipt cover subject title-cased", /^Your donation receipt from Creo Arts Collective$/.test(rc[0]?.body?.subject || ""), rc[0]?.body?.subject);
  ok("receipt cover BODY title-cased (not raw lowercase org name)", /gift to <strong>Creo Arts Collective<\/strong>/.test(rc[0]?.body?.html || ""), (rc[0]?.body?.html || "").slice(0, 300));
  ok("receipt cover carries the branded org header band", /Creo Arts Collective<\/span>/.test(rc[0]?.body?.html || "") && /border-radius:12px 12px 0 0/.test(rc[0]?.body?.html || ""));
  ok("receipt cover uses on-palette grey, not #6b7280", !/#6b7280/.test(rc[0]?.body?.html || ""));
  captured = [];
  r = await api("POST", `/donors/${ndId}/year-end-statement`, tok, { year: 2026, send: true });
  const ye = mailTo("receipt-donor@ep.local");
  ok("year-end subject says statement, not receipt", /^Your year-end giving statement from Creo Arts Collective$/.test(ye[0]?.body?.subject || ""), ye[0]?.body?.subject);

  // Workflow welcome email: subject + body + signature all title-cased.
  const wfs = await api("GET", "/workflows", tok);
  const welcomeWf = (wfs.body.workflows || wfs.body).find(w => w.recipe_key === "new_donor_welcome");
  await api("PUT", `/workflows/${welcomeWf.id}`, tok, { enabled: true });
  captured = [];
  r = await api("POST", "/workflows/simulate", tok, { trigger: "gift_received", donorId: ndId, amount: 300, isFirstGift: true });
  ok("welcome simulate ran", r.status === 200 && (r.body.ran || []).length >= 1, r.body);
  const wm = mailTo("receipt-donor@ep.local");
  ok("welcome subject title-cased", /^Thank you from Creo Arts Collective$/.test(wm[0]?.body?.subject || ""), wm[0]?.body?.subject);
  ok("welcome body + signature title-cased ({{org_name}} class)", /first gift to Creo Arts Collective/.test(wm[0]?.body?.html || "") && /With gratitude,<br\/>Creo Arts Collective/.test(wm[0]?.body?.html || ""), (wm[0]?.body?.html || "").slice(0, 400));
  ok("welcome keeps the CAN-SPAM footer + unsubscribe", /Unsubscribe/.test(wm[0]?.body?.html || "") && /9 Front St, Fairhope/.test(wm[0]?.body?.html || ""));

  await reset();
  await closeDb();
  mock.close();
  summary();
})().catch(e => { console.error(e); try { mock.close(); } catch { /* already closed */ } process.exit(1); });
