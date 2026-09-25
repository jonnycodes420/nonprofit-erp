// BUILD-98 (switch) Part 6 — THE PUBLIC API, AND A WEALTH SCREEN THAT SURVIVES AN IMPORT.
//
//   §1  an admin makes a key and sees it ONCE; staff cannot; a name is required;
//   §2  the key reads its own org: me, people, gifts — newest first, capped;
//   §3  THE WALL: org B's key reads none of org A, whatever it sends;
//   §4  TWO DOORS: a key does not open a staff route, a staff login does not
//       open /api/v1;
//   §5  read only: a write under /api/v1 is a 404 and creates nothing;
//   §6  a revoked key reads exactly like one that never existed, and org A
//       cannot revoke org B's key;
//   §7  the key is stored as a fingerprint, never as itself;
//   §8  a wealth screen in an import file lands on the person as written.
//
// Standard scratch stack (tests/README.md).

const bcrypt = require("bcryptjs");
const { BASE, ok, summary, login, api, q, closeDb } = require("./helpers");

const A = "org_b98a", B = "org_b98a2";
const PW = "loadtest1234";

async function reset() {
  for (const o of [A, B]) {
    for (const t of ["api_keys", "thank_you_drafts", "threads", "tasks", "workflow_runs", "fin_transactions", "interactions", "gifts",
                     "imports", "donors", "users", "budgets", "accounts", "fin_funds"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}
const keyGet = (key, path, headers = {}) =>
  fetch(BASE + path, { headers: { "X-Api-Key": key, ...headers } }).then(async r => ({ status: r.status, text: await r.text() }))
    .then(r => ({ ...r, body: (() => { try { return JSON.parse(r.text); } catch { return null; } })() }));

(async () => {
  console.log("build98-api");
  await reset();
  for (const [id, name] of [[A, "Barn Helpers"], [B, "Somebody Else"]])
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status) VALUES ($1,$2,$3,1,'team','active')`, [id, name, id.replace(/_/g, "-")]);
  const hash = bcrypt.hashSync(PW, 4);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_b98a',$1,'b98a@example.org',$2,'Allie Barnett','admin')`, [A, hash]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_b98as',$1,'b98a-s@example.org',$2,'Sam Staff','staff')`, [A, hash]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_b98a2',$1,'b98a-o@example.org',$2,'Other','admin')`, [B, hash]);
  await q(`INSERT INTO donors (id,org_id,name,email,stage,created_at) VALUES ('a98_old',$1,'Olive Older','olive@example.org','prospect',NOW()-INTERVAL '2 days')`, [A]);
  await q(`INSERT INTO donors (id,org_id,name,email,stage,created_at) VALUES ('a98_new',$1,'Nora Newer','nora@example.org','prospect',NOW())`, [A]);
  await q(`INSERT INTO donors (id,org_id,name,email,stage) VALUES ('b98_x',$1,'Bea Other','bea@example.org','prospect')`, [B]);
  const tok = await login("b98a@example.org"), staff = await login("b98a-s@example.org"), tokB = await login("b98a-o@example.org");
  await api("POST", "/donors/a98_new/gifts", tok, { amount: 25, date: "2026-09-01", idempotencyKey: "b98a-g1" });

  // ── §1 making a key ──────────────────────────────────────────────────────
  const noName = await api("POST", "/api-keys", tok, { name: "  " });
  ok("§1 a key needs a name", noName.status === 400);
  ok("§1 staff cannot make a key", (await api("POST", "/api-keys", staff, { name: "Mine" })).status === 403);
  const made = await api("POST", "/api-keys", tok, { name: "Zapier" });
  const KEY = made.body.key;
  ok("§1 the admin's key comes back once, read-only, with its sentence",
    made.status === 200 && /^stw_/.test(KEY || "") && made.body.scopes.join() === "read" && /only time/.test(made.body.sentence || ""));
  const list = await api("GET", "/api-keys", tok);
  const listed = (list.body.keys || [])[0] || {};
  // A key is random, so a leaf that CONTAINS its secret part is a leak wherever
  // it sits — this walks the leaves, never a stringified payload (BUILD-84 rule).
  const leaves = []; (function walk(x) { if (x && typeof x === "object") Object.values(x).forEach(walk); else leaves.push(String(x)); })(list.body.keys);
  ok("§1 the list never carries the key again", listed.name === "Zapier" && !("key" in listed) && !leaves.some(v => v.includes(KEY.slice(10))));
  ok("§1 …and names who made it", listed.createdBy === "Allie Barnett");
  const KEYB = (await api("POST", "/api-keys", tokB, { name: "B's" })).body.key;

  // ── §2 reading ───────────────────────────────────────────────────────────
  const me = await keyGet(KEY, "/api/v1/me");
  ok("§2 /me names the org and the key (the Zapier auth test)", me.status === 200 && me.body.organization === "Barn Helpers" && me.body.key === "Zapier");
  const bearer = await fetch(BASE + "/api/v1/me", { headers: { Authorization: "Bearer " + KEY } });
  ok("§2 a Bearer header works the same", bearer.status === 200);
  const people = await keyGet(KEY, "/api/v1/people");
  const ids = (people.body.data || []).map(p => p.id);
  ok("§2 people come newest first (what a polling trigger needs)", ids[0] === "a98_new" && ids.includes("a98_old"), ids);
  ok("§2 a person carries lifetime giving from the record", people.body.data[0].lifetimeGiving === 25 && people.body.data[0].giftCount === 1);
  const gifts = await keyGet(KEY, "/api/v1/gifts");
  ok("§2 gifts carry the person they belong to", gifts.status === 200 && gifts.body.data.length === 1 && gifts.body.data[0].personId === "a98_new" && gifts.body.data[0].amount === 25);
  ok("§2 a limit over 100 is held to 100", (await keyGet(KEY, "/api/v1/people?limit=5000")).body.limit === 100);

  // ── §3 the wall ──────────────────────────────────────────────────────────
  ok("§3 org B's key cannot read org A's person", (await keyGet(KEYB, "/api/v1/people/a98_new")).status === 404);
  const bList = await keyGet(KEYB, "/api/v1/people?org_id=" + A + "&orgId=" + A);
  ok("§3 …and naming org A in the query changes nothing", bList.status === 200 && bList.body.data.every(p => p.id === "b98_x"), bList.body.data.map(p => p.id));
  const bGifts = await keyGet(KEYB, "/api/v1/gifts", { "X-Org-Id": A });
  ok("§3 …nor does a header", bGifts.body.data.length === 0);

  // ── §4 two doors ─────────────────────────────────────────────────────────
  const staffRoute = await fetch(BASE + "/donors", { headers: { Authorization: "Bearer " + KEY } });
  ok("§4 a key does not open a staff route", staffRoute.status === 401);
  const jwtOnApi = await fetch(BASE + "/api/v1/people", { headers: { Authorization: "Bearer " + tok } });
  ok("§4 a staff login does not open /api/v1", jwtOnApi.status === 401);

  // ── §5 read only ─────────────────────────────────────────────────────────
  const before = (await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1`, [A]))[0].n;
  const w = await fetch(BASE + "/api/v1/people", { method: "POST", headers: { "X-Api-Key": KEY, "Content-Type": "application/json" }, body: JSON.stringify({ name: "Sneaky" }) });
  const after = (await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1`, [A]))[0].n;
  ok("§5 a write is a plain 404 and creates nobody", w.status === 404 && before === after);

  // ── §6 revoking ──────────────────────────────────────────────────────────
  const [aKey] = await q(`SELECT id FROM api_keys WHERE org_id=$1`, [A]);
  ok("§6 org B cannot revoke org A's key", (await api("DELETE", `/api-keys/${aKey.id}`, tokB)).status === 404);
  ok("§6 …and org A's key still works", (await keyGet(KEY, "/api/v1/me")).status === 200);
  await api("DELETE", `/api-keys/${aKey.id}`, tok);
  const revoked = await keyGet(KEY, "/api/v1/me");
  const never = await keyGet("stw_" + "x".repeat(32), "/api/v1/me");
  ok("§6 a revoked key reads exactly like one that never existed", revoked.status === 401 && revoked.text === never.text);
  const [row] = await q(`SELECT revoked_at FROM api_keys WHERE id=$1`, [aKey.id]);
  ok("§6 the revoked key stays on the list, marked", !!row.revoked_at);

  // ── §7 fingerprint ───────────────────────────────────────────────────────
  const [stored] = await q(`SELECT * FROM api_keys WHERE id=$1`, [aKey.id]);
  const crypto = require("crypto");
  ok("§7 the key is stored as its SHA-256, never as itself",
    stored.key_hash === crypto.createHash("sha256").update(KEY).digest("hex") && !Object.values(stored).some(v => String(v) === KEY));

  // ── §8 a wealth screen survives an import ────────────────────────────────
  const IS = await import("../shared/importShape.js");
  const map = IS.autoDetectTxMapping(["Name", "Email", "Amount", "Date", "DS Rating", "DS Capacity", "Score"], []);
  ok("§8 DonorSearch columns are recognised", map.wealthRating === "DS Rating" && map.wealthCapacity === "DS Capacity");
  ok("§8 …and a bare 'Score' is not claimed", !Object.values(map).includes("Score"));
  const imp = await api("POST", "/donors/import-combined", tok, {
    donors: [{ name: "Wendy Wealth", email: "wendy@example.org",
      wealthScreen: { source: "DonorSearch", rating: "DS1-2", capacity: "$100,000 - $249,999", date: "2025-03-01" } }], gifts: [] });
  ok("§8 the import succeeds", imp.status === 200, imp.body);
  const k2 = (await api("POST", "/api-keys", tok, { name: "Check" })).body.key;
  const wendy = ((await keyGet(k2, "/api/v1/people")).body.data || []).find(p => p.name === "Wendy Wealth");
  ok("§8 the screen lands on the person AS WRITTEN (a range stays a range)",
    wendy && wendy.wealthScreen && wendy.wealthScreen.source === "DonorSearch" && wendy.wealthScreen.capacity === "$100,000 - $249,999" && wendy.wealthScreen.rating === "DS1-2", wendy);
  const [ws] = await q(`SELECT wealth_score FROM donors WHERE org_id=$1 AND email='wendy@example.org'`, [A]);
  ok("§8 …and never becomes Steward's own wealth score", ws.wealth_score == null);

  await reset();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
