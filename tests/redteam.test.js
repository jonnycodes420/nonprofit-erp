// tests/redteam.test.js — REDTEAM-1: Steward attacked the way an outsider or a
// colleague with the wrong role would, on the suite's own made-up orgs.
//
// The cross-org layer (org B's ids in the path and, since this build, in the
// BODY of every write) is tests/tenant-matrix.test.js §1–§8. This suite is the
// rest of the brief:
//
//   §1  A file Steward hands out never carries a live spreadsheet formula. A
//       name, a survey answer or an audit description that starts with = + - @
//       (or a tab, or a carriage return) is text in every CSV. RED ON MAIN for
//       the audit log, the screening file and survey results (no guard), and
//       for a tab-led cell everywhere.
//   §2  A volunteer coordinator reaches volunteers and hours only: every GET in
//       the live router outside the allowlist is a 403, and what the allowlist
//       answers carries no gift amount.
//   §3  Every action the screen hides from staff is refused by the server, and
//       an org admin cannot reach /ops or /admin.
//   §4  Money: bad amounts are refused and write nothing; an edit cannot move a
//       gift to another org or another org's person; an unsigned or re-signed
//       Stripe event writes nothing; a replayed one and a double submit each
//       write one gift.
//   §5  A material's link is a web address or nothing (RED ON MAIN: a
//       "javascript:" link was stored and opened with window.open).
//   §6  Every search and filter parameter in the live router survives quotes and
//       SQL-shaped input: no 5xx anywhere.
//   §7  REDTEAM-2: SQL text only from the code (server/db/sql.js), and a stored
//       table name off the restore list is refused.
//
// Standard scratch stack (tests/README.md). Fixtures are the suite's own orgs.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, BASE, closeDb } = require("./helpers");
const { civilDay } = require("./clock");
const { testNow } = require("./clock");

const A = "org_redteam1", B = "org_redteam1b";
const HASH = bcrypt.hashSync("loadtest1234", 10);
const TODAY = civilDay();
const MARK = "7319.55";            // org A's gift amount: a coordinator must never see it
const FORMULA_NAME = "=1+2 Redteam";

// A CSV, read the way a spreadsheet reads it: cells, with quotes undone.
function cells(text) {
  const out = []; let cell = "", quoted = false, i = 0;
  const s = String(text || "").replace(/^﻿/, "");
  while (i < s.length) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i += 2; continue; }
      if (c === '"') { quoted = false; i++; continue; }
      cell += c; i++; continue;
    }
    if (c === '"' && cell === "") { quoted = true; i++; continue; }
    if (c === ",") { out.push(cell); cell = ""; i++; continue; }
    if (c === "\n" || (c === "\r" && s[i + 1] === "\n")) { out.push(cell); cell = ""; i += c === "\r" ? 2 : 1; continue; }
    cell += c; i++;
  }
  if (cell) out.push(cell);
  return out;
}
const PLAIN_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const liveFormulas = text => cells(text).filter(c => /^[=+\-@\t\r]/.test(c) && !PLAIN_NUMBER.test(c));

async function reset() {
  const tables = (await q(`SELECT table_name FROM information_schema.columns WHERE column_name='org_id' AND table_schema='public'`)).map(r => r.table_name);
  for (const o of [A, B]) {
    for (let pass = 0; pass < 3; pass++) for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM users WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}

async function seed() {
  for (const [o, name, slug] of [[A, "Redteam Riverside Pantry", "redteam-riverside"], [B, "Redteam Hillcrest Choir", "redteam-hillcrest"]]) {
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,stripe_account_id,stripe_connected)
             VALUES ($1,$2,$3,1,'active','team',$4,TRUE) ON CONFLICT (id) DO UPDATE SET plan='team', subscription_status='active'`, [o, name, slug, `acct_${o}`]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Odile Brant','admin')`, [`u_${o}_admin`, o, `admin@${slug}.example.org`, HASH]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Teo Marsh','staff')`, [`u_${o}_staff`, o, `staff@${slug}.example.org`, HASH]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Wren Abara','volunteer_coordinator')`, [`u_${o}_coord`, o, `coord@${slug}.example.org`, HASH]);
    await q(`INSERT INTO donors (id,org_id,name,email,stage,total_giving,gift_count,last_gift_date,created_by,created_by_name)
             VALUES ($1,$2,'Ines Halloway','ines.halloway@example.org','active',$3,1,$4,'system:test','test')`, [`d_${o}`, o, MARK, TODAY]);
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,'cash','u_${o}_admin','Odile Brant')`,
      [`g_${o}`, o, `d_${o}`, MARK, TODAY]);
    await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ($1,$2,'General',FALSE)`, [`fnd_${o}`, o]).catch(() => {});
  }
  // §1: an imported name that starts with a formula, an address with a tab-led city.
  await q(`INSERT INTO donors (id,org_id,name,email,address,city,state,zip,stage,created_by,created_by_name)
           VALUES ($1,$2,$3,'formula.person@example.org','12 Quay St',$4,'OR','97201','active','system:test','test')`,
    [`d_${A}_f`, A, FORMULA_NAME, "\t=2+3"]);
}

// A walk's GET: a connection the server drops is tried once more, then named
// as a failure for that route, never a crash of the whole suite.
async function walkGet(path, tok, dropped) {
  for (let i = 0; i < 2; i++) {
    try { return await api("GET", path, tok); }
    catch (e) { if (i === 1) { dropped.push(`${path}: ${e.cause && e.cause.code || e.message}`); return { status: 0, text: "" }; } }
  }
}

(async () => {
  // The route inventory first: when it is stale, load() boots a server to
  // rebuild it, and a pause of several seconds between requests let the
  // server's 5 s keep-alive close a socket the next request then reused
  // (CI, 7 Nov: "fetch failed: other side closed" on the first §2 read).
  const inv = require("./lib/routeInventoryFile").load().routes;
  const dropped = [];
  await reset();
  await seed();
  const admin = await login("admin@redteam-riverside.example.org");
  const staff = await login("staff@redteam-riverside.example.org");
  const coord = await login("coord@redteam-riverside.example.org");
  ok("fixture logins: admin, staff and coordinator", !!admin && !!staff && !!coord);

  // ── §1 · no live formula in any file Steward hands out ──────────────────
  console.log("\n§1 · a cell that starts with = + - @ (or a tab) is text in every CSV");
  // The audit log names the record: a person created with a formula name.
  const made = await api("POST", "/donors", admin, { name: "+SUM(1,2) Redteam", email: "plus.person@example.org" });
  ok("§1 a person named with a leading + is created (the audit row names them)", made.status === 200 || made.status === 201, made.status);
  // A survey answer typed on the public page.
  await q(`INSERT INTO surveys (id,org_id,slug,title,intro,thank_you,mode,audience,sections,status,created_by,created_by_name)
           VALUES ($1,$2,'rt-feedback','Redteam feedback','','Thanks','named','anyone',$3,'open','system:test','test')`,
    [`sv_${A}`, A, JSON.stringify([{ title: "", questions: [{ id: "q1", type: "short", label: "Anything else?", required: false }] }])]).catch(e => console.log("survey seed:", e.message));
  await q(`INSERT INTO survey_responses (id,org_id,survey_id,anonymous,respondent_name,respondent_email,answers,submitted_at,created_by,created_by_name)
           VALUES ($1,$2,$3,false,'@Visitor','visitor@example.org',$4,NOW(),'system:public','public')`,
    [`svr_${A}`, A, `sv_${A}`, JSON.stringify({ q1: "=HYPERLINK(\"https://example.invalid\",\"open\")" })]).catch(e => console.log("response seed:", e.message));
  const files = [
    ["the donors file", "GET", "/donors/export/csv"],
    ["the audit log", "GET", "/audit/log.csv"],
    ["survey results", "GET", `/surveys/sv_${A}/export.csv`],
    ["the address-update file", "GET", "/data-health/ncoa/file"],
    ["the screening file", "POST", "/screening/file", { donorIds: [`d_${A}_f`, `d_${A}`] }],
    ["Going out's sent list", "GET", "/going-out/sent.csv"],
  ];
  for (const [label, method, path, body] of files) {
    const r = await fetch(BASE + path, { method, headers: { Authorization: "Bearer " + admin, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    const live = liveFormulas(text);
    ok(`§1 ${label}: answered a file and no cell is a live formula (${live.length})`, r.status === 200 && live.length === 0, { status: r.status, live: live.slice(0, 4), head: text.slice(0, 120) });
  }
  // And the formula text itself is still there, as text, where it should be.
  const dfile = await (await fetch(BASE + "/donors/export/csv", { headers: { Authorization: "Bearer " + admin } })).text();
  ok("§1 …the name is kept, as text (a leading apostrophe), not dropped", cells(dfile).includes("'" + FORMULA_NAME), cells(dfile).filter(c => /Redteam/.test(c)));

  // ── §2 · the volunteer coordinator ─────────────────────────────────────
  console.log("\n§2 · a coordinator reaches volunteers and hours, and no giving");
  const { coordinatorMayReach } = require("../auth");
  const fill = p => p.replace(/:donorId|:personId/g, `d_${A}`).replace(/:id\b/g, `d_${A}`).replace(/:[A-Za-z_]+\??/g, "x");
  const leaks = [], open = [], errors = [];
  let walked = 0;
  for (const r of inv) {
    if (r.method !== "GET" || !(r.auth || []).includes("requireAuth")) continue;
    const path = fill(r.path);
    const res = await walkGet(path, coord, dropped);
    walked++;
    if (res.status >= 500) errors.push(`${r.path} → ${res.status}`);
    if (!coordinatorMayReach(path)) {
      if (res.status !== 403) open.push(`${r.path} → ${res.status}`);
    } else if (res.text.includes(MARK) || /"(totalGiving|total_giving|lifetime|lifetimeGiving)"\s*:\s*[1-9]/.test(res.text)) {
      leaks.push(`${r.path} carried giving`);
    }
  }
  ok(`§2 every GET outside the coordinator's allowlist is a 403 (${walked} walked, ${open.length} open)`, open.length === 0 && walked > 300, open.slice(0, 15));
  ok(`§2 nothing the allowlist answers carries a gift amount or a lifetime (${leaks.length})`, leaks.length === 0, leaks.slice(0, 15));
  ok(`§2 no coordinator read is a 5xx (${errors.length})`, errors.length === 0, errors.slice(0, 10));
  for (const [m, p, b] of [["POST", `/donors/d_${A}/gifts`, { amount: 10, date: TODAY }], ["PUT", `/gifts/g_${A}`, { amount: 1 }], ["DELETE", `/gifts/g_${A}`]]) {
    const r = await api(m, p, coord, b);
    ok(`§2 a coordinator's ${m} ${p.replace(A, "A")} is refused (403)`, r.status === 403, r.status);
  }

  // ── §3 · what the screen hides from staff, the server refuses ──────────
  console.log("\n§3 · every action hidden from staff is refused by the server");
  const hidden = [
    ["POST", `/donors/d_${A}/erase`, { confirm: "ERASE" }, "erase a person"],
    ["DELETE", `/donors/d_${A}`, null, "delete a person"],
    ["PATCH", "/donors/bulk-assign", { ids: [`d_${A}`], assignedTo: `u_${A}_staff` }, "assign people in bulk"],
    ["PATCH", `/donors/d_${A}/assign`, { assignedTo: `u_${A}_staff` }, "assign a person"],
    ["POST", "/journeys", { name: "Redteam journey" }, "make a journey"],
    ["PUT", "/journeys/settings", {}, "change journey settings"],
    ["POST", "/auto-send/pause", { paused: true }, "pause all sending"],
    ["PUT", "/privacy", { enabled: true }, "change privacy mode"],
    ["POST", "/membership-levels", { name: "Gold", price: 5 }, "add a membership level"],
    ["POST", "/qbo/sync", {}, "sync to QuickBooks"],
    ["POST", "/billing/band/move-down", {}, "change the billing band"],
    ["POST", "/impact-updates", { title: "x" }, "publish an impact update"],
    ["PUT", "/custom-fields/reorder", { ids: [] }, "reorder custom fields"],
    ["POST", "/org/invites", { email: "new.person@example.org", role: "admin" }, "invite someone"],
  ];
  for (const [m, p, b, what] of hidden) {
    const r = await api(m, p, staff, b || undefined);
    ok(`§3 staff cannot ${what} (${m} ${p.replace(A, "A")} → ${r.status})`, r.status === 403 || r.status === 404, r.status);
  }
  const [{ n: stillThere }] = await q(`SELECT COUNT(*)::int AS n FROM donors WHERE id=$1 AND deleted_at IS NULL AND erased_at IS NULL`, [`d_${A}`]);
  ok("§3 …and the person is still there, unerased", stillThere === 1, stillThere);
  // ACCESS-1's org switcher: a person who is not a member of org B cannot switch into it.
  for (const [who, tok] of [["an admin", admin], ["staff", staff]]) {
    const sw = await api("POST", "/auth/switch-org", tok, { orgId: B });
    const ghost = await api("POST", "/auth/switch-org", tok, { orgId: "org_redteam1_none" });
    ok(`§3 ${who} cannot switch into another org (404, the same as no such org)`, sw.status === 404 && sw.text === ghost.text && !/token/.test(sw.text), { status: sw.status });
  }
  for (const p of ["/ops", "/ops/ship", "/admin/orgs", "/admin/metrics", `/admin/orgs/${B}`]) {
    const r = await api("GET", p, admin);
    ok(`§3 an org admin cannot reach ${p.replace(B, "B")} (${r.status})`, r.status === 403 || r.status === 404, r.status);
  }

  // ── §4 · money tampering ────────────────────────────────────────────────
  console.log("\n§4 · money: bad amounts, moved gifts, forged and replayed webhooks, double submits");
  const giftsOf = async o => (await q(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1`, [o]))[0].n;
  const before = await giftsOf(A);
  for (const bad of [-50, 0, "-0.01", "abc", "1e12", 1e12, "NaN", "Infinity", null, "12.345.6", { amount: 5 }]) {
    const r = await api("POST", `/donors/d_${A}/gifts`, admin, { amount: bad, date: TODAY, type: "cash" });
    ok(`§4 a gift of ${JSON.stringify(bad)} is refused`, r.status === 400, { status: r.status, body: String(r.text).slice(0, 100) });
  }
  ok("§4 …and none of them wrote a gift", (await giftsOf(A)) === before, { before, after: await giftsOf(A) });
  const cur = await api("POST", `/donors/d_${A}/gifts`, admin, { amount: 12, date: TODAY, type: "cash", currency: "XYZ", idempotencyKey: "rt-cur-1" });
  const [curRow] = await q(`SELECT amount FROM gifts WHERE org_id=$1 AND idempotency_key='rt-cur-1'`, [A]);
  ok("§4 a made-up currency is not taken on: the gift is $12 in the org's money or refused", cur.status === 400 || (curRow && Number(curRow.amount) === 12), { status: cur.status, curRow });

  // An edit that tries to carry the gift to org B, or onto org B's person.
  await api("PUT", `/gifts/g_${A}`, admin, { org_id: B, orgId: B, donor_id: `d_${B}`, donorId: `d_${B}`, amount: 7319.55 });
  const [moved] = await q(`SELECT org_id, donor_id FROM gifts WHERE id=$1`, [`g_${A}`]);
  ok("§4 an edit carrying org_id and donor_id leaves the gift in its org, on its person", moved.org_id === A && moved.donor_id === `d_${A}`, moved);
  const pin = await api("PUT", `/gifts/g_${A}`, admin, { fund_id: `fnd_${B}` });
  ok("§4 an edit cannot pin another org's fund on a gift (404)", pin.status === 404, pin.status);
  const cross = await api("POST", `/donors/d_${B}/gifts`, admin, { amount: 5, date: TODAY, type: "cash" });
  ok("§4 a gift on another org's person is a 404 and writes nothing there", cross.status === 404 && (await giftsOf(B)) === 1, cross.status);

  // Stripe: unsigned, wrongly signed, then one event sent twice.
  const evt = id => JSON.stringify({ id, type: "payment_intent.succeeded", account: `acct_${A}`,
    data: { object: { id: `pi_${id}`, amount_received: 4200, receipt_email: "webhook.giver@example.org", metadata: { donor_name: "Webhook Giver" } } } });
  const sign = (body, secret = process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest") => {
    const ts = Math.floor(testNow() / 1000);
    return `t=${ts},v1=${crypto.createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex")}`;
  };
  const post = (body, sig) => fetch(BASE + "/stripe/webhook", { method: "POST", headers: { "Content-Type": "application/json", ...(sig ? { "stripe-signature": sig } : {}) }, body });
  const e1 = evt("evt_rt_unsigned");
  const unsigned = await post(e1, null);
  const forged = await post(e1, sign(e1, "whsec_not_the_secret"));
  const n1 = (await q(`SELECT COUNT(*)::int AS n FROM gifts WHERE stripe_payment_id='pi_evt_rt_unsigned'`))[0].n;
  ok("§4 an unsigned and a wrongly signed Stripe event are refused (400) and write nothing", unsigned.status === 400 && forged.status === 400 && n1 === 0, { unsigned: unsigned.status, forged: forged.status, n1 });
  const e2 = evt("evt_rt_replay");
  const first = await post(e2, sign(e2));
  const again = await post(e2, sign(e2));
  const n2 = (await q(`SELECT COUNT(*)::int AS n FROM gifts WHERE stripe_payment_id='pi_evt_rt_replay'`))[0].n;
  ok("§4 the same signed event delivered twice is one gift", first.status === 200 && again.status < 500 && n2 === 1, { first: first.status, again: again.status, n2 });

  // A double click: the same submit twice, at once.
  const twice = await Promise.all([1, 2].map(() => api("POST", `/donors/d_${A}/gifts`, admin, { amount: 31, date: TODAY, type: "cash", idempotencyKey: "rt-double-1" })));
  const [{ n: dbl }] = await q(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1 AND amount=31`, [A]);
  ok("§4 a double submit is one gift", dbl === 1 && twice.every(r => r.status < 500), { statuses: twice.map(r => r.status), dbl });

  // The giving page: the client cannot set the total, the fee or a negative.
  for (const [what, body] of [["a negative amount", { amount: -25 }], ["a zero", { amount: 0 }], ["above the ceiling", { amount: 1e10 }], ["a word", { amount: "lots" }]]) {
    const r = await api("POST", "/donate/redteam-riverside", null, { ...body, frequency: "once", firstName: "Pell", lastName: "Orsay", email: "pell.orsay@example.org" });
    ok(`§4 the public giving page refuses ${what} (400)`, r.status === 400, { status: r.status, body: String(r.text).slice(0, 100) });
  }

  // ── §5 · a stored link is a web address or nothing ─────────────────────
  console.log("\n§5 · a material's link is a web address");
  const scheme = ["java", "script:"].join("");
  const jsLink = await api("POST", `/donors/d_${A}/materials`, staff, { file_name: "Pledge form", file_url: `${scheme}void(0)` });
  ok("§5 a material whose link is not a web address is refused (400)", jsLink.status === 400, jsLink.status);
  const [{ n: storedJs }] = await q(`SELECT COUNT(*)::int AS n FROM donor_materials WHERE org_id=$1 AND file_url ILIKE $2`, [A, `${scheme}%`]);
  ok("§5 …and nothing of the kind is stored", storedJs === 0, storedJs);
  const web = await api("POST", `/donors/d_${A}/materials`, staff, { file_name: "Annual report", file_url: "example.org/report.pdf" });
  const [webRow] = await q(`SELECT file_url FROM donor_materials WHERE org_id=$1 AND file_name='Annual report'`, [A]);
  ok("§5 a bare address is kept as https", (web.status === 200 || web.status === 201) && webRow && webRow.file_url === "https://example.org/report.pdf", { status: web.status, webRow });

  // ── §6 · quotes and SQL-shaped input on every search and filter ─────────
  console.log("\n§6 · every query parameter survives quotes and SQL-shaped input");
  const evil = ["'", "\"", "1' OR '1'='1", "x'); SELECT pg_sleep(0)--", "%' AND 1=1--", "\\", "1;--", "[]", "{}"];
  const fails = [];
  let probed = 0;
  for (const r of inv) {
    if (r.method !== "GET" || !(r.auth || []).includes("requireAuth") || r.auth.includes("requireSuperAdmin")) continue;
    const params = (r.params && r.params.query) || [];
    if (!params.length) continue;
    const path = r.path.replace(/:donorId|:id\b/g, `d_${A}`).replace(/:[A-Za-z_]+\??/g, "x");
    for (const v of evil) {
      const qs = params.map(p => `${encodeURIComponent(p)}=${encodeURIComponent(v)}`).join("&");
      const res = await walkGet(`${path}?${qs}`, admin, dropped);
      if (res.status >= 500) { fails.push(`${r.path} [${v}] → ${res.status} ${String(res.text).slice(0, 80)}`); break; }
    }
    probed++;
  }
  ok(`§6 no 5xx from SQL-shaped values on ${probed} filtered routes (${fails.length})`, fails.length === 0 && probed > 80, fails.slice(0, 12));
  ok(`§2/§6 no route dropped the connection twice (${dropped.length})`, dropped.length === 0, dropped.slice(0, 10));
  const [{ n: stillB }] = await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1`, [B]);
  ok("§6 …and org B's people are all still there", stillB === 1, stillB);

  // ── §7 · REDTEAM-2: SQL text only from the code (server/db/sql.js) ─────
  // The one door every converted statement goes through. RED if sql.id lets a
  // name off its list, if sql() takes a plain string, if a value lands in the
  // text, if a quote in a catalog name escapes sql.ident, or if a pick takes a
  // key the code didn't write. Then one converted route, live: a restore whose
  // stored table name is not on RESTORABLE is refused and writes nothing.
  console.log("\n§7 · SQL text comes only from the code");
  {
    const { sql, toQuery } = require("../server/db/sql");
    const evil = "x'; DROP TABLE donors; --";
    const st = sql`SELECT id FROM donors WHERE name = ${evil} AND org_id = ${A}`;
    ok("§7 a ${value} is bound, never text", !st.text.includes("DROP") && st.values[0] === evil && (st.text.match(/\?/g) || []).length === 2, st.text);
    const refuses = fn => { try { fn(); return false; } catch { return true; } };
    ok("§7 sql() refuses a plain string (only a template's own literal parts are text)", refuses(() => sql("SELECT 1")) && refuses(() => sql(Object.assign(["SELECT 1"], { raw: ["SELECT 1"] }))));
    ok("§7 sql.id refuses a name off its list", refuses(() => sql.id(evil, ["donors"])) && refuses(() => sql.id("gifts", ["donors"])) && sql.id("donors", ["donors"]).text === "donors");
    ok("§7 sql.ident keeps a catalog name a name (a quote is doubled)", sql.ident('a"b; DROP').text === '"a""b; DROP"');
    ok("§7 sql.pick takes only a key the code wrote", refuses(() => sql.pick(evil, { a: "x" })) && refuses(() => sql.pick("constructor", { a: "x" })) && sql.pick("a", { a: "x" }).text === "x");
    ok("§7 a Sql with bound values takes no params beside it", refuses(() => toQuery(st, [1])));
    // Live: a trash row whose table_name isn't restorable can't steer the INSERT.
    const tid = "del_" + crypto.randomBytes(10).toString("hex");
    await q(`INSERT INTO deleted_records (id, org_id, table_name, record_id, row_data, created_by, created_by_name) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
      [tid, A, "donors_x; DROP TABLE gifts", "zz_none", JSON.stringify({ id: "zz_none" }), `u_${A}_admin`, "Odile Brant"]);
    const r7 = await api("POST", `/deleted-records/${tid}/restore`, admin, {});
    const [{ n: gifts7 }] = await q(`SELECT COUNT(*)::int AS n FROM gifts`);
    ok("§7 a restore of a table not on the list is refused, and gifts are still a table", r7.status === 400 && gifts7 >= 0, { status: r7.status });
    await q(`DELETE FROM deleted_records WHERE id=$1`, [tid]);
  }

  await reset();
  await closeDb();
  summary();
})().catch(e => { console.error("SUITE ERROR:", e); process.exit(1); });
