// tests/members2-isolation.test.js — MEMBERS-2. THE ONE GUARD THIS BUILD EARNED.
//
// "Your page" is a page with no password on it. Every defence it has is the
// link and the session behind it, so the only question worth pinning is the
// one that would end the product if it were ever answered wrongly:
//
//   can a link for person A ever show person B's data?
//
// Three ways it could: another person in the SAME org, a person in ANOTHER
// org, and a link that has already been spent or has run out. All three are
// here, and each one is checked against the rendered PAGE, not against a
// route's return code — a page that 200s and prints the wrong name is the
// failure this suite exists to catch.
//
// HOW IT WOULD GO RED. Take the `AND org_id=?` off `youSession`'s donor
// lookup, or take `person_id` out of `whatTheyHave` and read the org's rows
// instead, or drop `used_at IS NULL` from the consume: each one turns a
// different assertion below red. (Verified by planting all three.)
//
// It runs against the scratch server + scratch Postgres, never production.
const { BASE, ok, summary, api, q, closeDb } = require("./helpers");

const ORG_A = "org_m2a", ORG_B = "org_m2b";
const rand = () => Math.random().toString(36).slice(2, 10);

async function makeOrg(orgId, slug, name) {
  await q(`DELETE FROM supporter_sessions WHERE org_id=$1`, [orgId]);
  await q(`DELETE FROM supporter_links WHERE org_id=$1`, [orgId]);
  await q(`DELETE FROM gifts WHERE org_id=$1`, [orgId]);
  await q(`DELETE FROM donors WHERE org_id=$1`, [orgId]);
  await q(`DELETE FROM fin_audit_log WHERE org_id=$1`, [orgId]);
  await q(`DELETE FROM users WHERE org_id=$1`, [orgId]);
  await q(`DELETE FROM orgs WHERE id=$1`, [orgId]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete) VALUES ($1,$2,$3,1)`, [orgId, name, slug]);
}

async function makePerson(orgId, id, name, email) {
  await q(`INSERT INTO donors (id,org_id,name,email,stage,status,tags,created_by,created_by_name)
           VALUES ($1,$2,$3,$4,'prospect','active','[]','system:test','members2 suite')`,
    [id, orgId, name, email]);
}

async function giveTo(orgId, donorId, amount, date) {
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name)
           VALUES ($1,$2,$3,$4,$5,'cash','system:test','members2 suite')`,
    ["g_" + rand(), orgId, donorId, amount, date]);
}

// Mint a link the way the product does, by asking for one. The token itself
// comes back only under TEST_MODE, which is the seam this suite drives.
async function linkFor(slug, personId, adminToken) {
  const r = await api("POST", `/donors/${personId}/your-page-link`, adminToken);
  if (r.status !== 200 || !r.body.link) throw new Error("no link: " + JSON.stringify(r.body).slice(0, 200));
  return String(r.body.link).split("#t=")[1];
}

// Spend a token and keep the cookie.
async function enter(slug, token) {
  const r = await fetch(`${BASE}/you/${slug}/enter`, {
    method: "POST", redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "t=" + encodeURIComponent(token),
  });
  const setCookie = r.headers.get("set-cookie") || "";
  const m = /steward_you=([^;]+)/.exec(setCookie);
  return { status: r.status, cookie: m ? "steward_you=" + m[1] : null };
}

async function pageWith(slug, cookie) {
  const r = await fetch(`${BASE}/you/${slug}`, { headers: cookie ? { Cookie: cookie } : {} });
  return { status: r.status, html: await r.text() };
}

(async () => {
  console.log("MEMBERS-2 — a link opens one person's page and nobody else's\n");

  const suffix = rand();
  const slugA = "m2-alpha-" + suffix, slugB = "m2-beta-" + suffix;
  await makeOrg(ORG_A, slugA, "Alpha Harbour Trust");
  await makeOrg(ORG_B, slugB, "Beta Shore Fund");

  // Two people in org A, one in org B. Each has a gift of a different,
  // unmistakable size, so a leak shows up as a number on a page.
  await makePerson(ORG_A, "d_m2_a1", "Alma Redgrave", `alma.${suffix}@example.test`);
  await makePerson(ORG_A, "d_m2_a2", "Bruno Castellan", `bruno.${suffix}@example.test`);
  await makePerson(ORG_B, "d_m2_b1", "Cleo Winterbourne", `cleo.${suffix}@example.test`);
  await giveTo(ORG_A, "d_m2_a1", 111, "2026-01-05");
  await giveTo(ORG_A, "d_m2_a2", 222, "2026-01-06");
  await giveTo(ORG_B, "d_m2_b1", 333, "2026-01-07");

  // An admin in each org, to drive the staff "send their page link" route.
  // Hashed here rather than pasted, so the suite never depends on a literal
  // that a bcrypt version bump could quietly stop verifying.
  const pw = require("bcryptjs").hashSync("password", 10);
  for (const [orgId, uid, email] of [[ORG_A, "u_m2_a", `admin.a.${suffix}@example.test`],
                                     [ORG_B, "u_m2_b", `admin.b.${suffix}@example.test`]]) {
    await q(`DELETE FROM users WHERE id=$1`, [uid]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Suite Admin','admin')`,
      [uid, orgId, email, pw]);
  }
  const loginAs = async email => {
    const r = await fetch(BASE + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "password" }) });
    const j = await r.json();
    if (!j.token) throw new Error("login failed: " + JSON.stringify(j).slice(0, 200));
    return j.token;
  };
  const tokA = await loginAs(`admin.a.${suffix}@example.test`);
  const tokB = await loginAs(`admin.b.${suffix}@example.test`);

  // ── 1. A's link opens A's page, and A's page is A's ──────────────────────
  const tA1 = await linkFor(slugA, "d_m2_a1", tokA);
  const sA1 = await enter(slugA, tA1);
  ok("A's link mints a session", sA1.status === 303 && !!sA1.cookie, sA1);
  const pageA1 = await pageWith(slugA, sA1.cookie);
  ok("A's page greets A", pageA1.status === 200 && /Hello, Alma/.test(pageA1.html));
  ok("A's page shows A's $111", /\$111\b/.test(pageA1.html));

  // ── 2. NOBODY ELSE IN THE SAME ORG ──────────────────────────────────────
  ok("A's page never names the other person in the same org", !/Bruno/.test(pageA1.html));
  ok("A's page never shows the other person's $222", !/\$222\b/.test(pageA1.html));
  // And the total is A's alone: a leak that summed the org would read $333.
  ok("A's giving total is A's own, to the cent", /\$111 in all/.test(pageA1.html),
    (pageA1.html.match(/\$[\d,]+ in all/) || [])[0]);

  // ── 3. NOBODY IN ANOTHER ORG ────────────────────────────────────────────
  ok("A's page never names the other org's person", !/Cleo/.test(pageA1.html));
  ok("A's page never shows the other org's $333", !/\$333\b/.test(pageA1.html));
  // A session minted in org A is not a session in org B. Same cookie, other
  // org's page: it must fall back to the sign-in form, not open anything.
  const crossOrg = await pageWith(slugB, sA1.cookie);
  ok("A's session opens nothing on the other org's page",
    crossOrg.status === 200 && !/Hello, Alma/.test(crossOrg.html) && /Send me my link/.test(crossOrg.html));
  ok("the other org's page leaks no name to A's cookie", !/Cleo|Bruno/.test(crossOrg.html));

  // A token minted for org B cannot be spent on org A's page.
  const tB1 = await linkFor(slugB, "d_m2_b1", tokB);
  const wrongDoor = await enter(slugA, tB1);
  ok("a token from another org opens no session here", wrongDoor.status === 400 && !wrongDoor.cookie, wrongDoor);

  // ── 4. A SPENT LINK, AND AN EXPIRED ONE, SHOW NOTHING ───────────────────
  const tA2 = await linkFor(slugA, "d_m2_a2", tokA);
  const firstUse = await enter(slugA, tA2);
  ok("a fresh link opens once", firstUse.status === 303 && !!firstUse.cookie);
  const replay = await enter(slugA, tA2);
  ok("the same link opens nothing the second time", replay.status === 400 && !replay.cookie, replay);
  const replayPage = await pageWith(slugA, replay.cookie);
  ok("a replayed link shows no name", !/Hello, Bruno/.test(replayPage.html));

  // An expired one: minted, then aged past its life in the database.
  const tA3 = await linkFor(slugA, "d_m2_a1", tokA);
  await q(`UPDATE supporter_links SET expires_at = NOW() - INTERVAL '1 minute' WHERE used_at IS NULL AND org_id=$1`, [ORG_A]);
  const stale = await enter(slugA, tA3);
  ok("an expired link opens nothing", stale.status === 400 && !stale.cookie, stale);

  // A revoked session (signing out) stops opening the page.
  await q(`UPDATE supporter_sessions SET revoked_at=NOW() WHERE org_id=$1`, [ORG_A]);
  const afterSignOut = await pageWith(slugA, sA1.cookie);
  ok("a revoked session shows no name", !/Hello, Alma/.test(afterSignOut.html) && /Send me my link/.test(afterSignOut.html));

  // ── 5. THE STAFF ROUTE IS ORG-SCOPED TOO ────────────────────────────────
  // An admin in org B asking for a link to org A's person gets a 404, the
  // same answer an unknown id gets: no oracle that the person exists.
  const reach = await api("POST", `/donors/d_m2_a1/your-page-link`, tokB);
  ok("an admin cannot mint a link into another org", reach.status === 404, reach.body);

  // ── 6. THE LINK ITSELF IS NEVER A ROW ANYBODY CAN READ ──────────────────
  const stored = await q(`SELECT token_hash FROM supporter_links WHERE org_id=$1 LIMIT 5`, [ORG_A]);
  ok("every stored link is a hash, never the token",
    stored.length > 0 && stored.every(r => /^[0-9a-f]{64}$/.test(r.token_hash)));

  // Tidy up after ourselves, so a re-run starts where this one did.
  for (const orgId of [ORG_A, ORG_B]) {
    await q(`DELETE FROM supporter_sessions WHERE org_id=$1`, [orgId]);
    await q(`DELETE FROM supporter_links WHERE org_id=$1`, [orgId]);
    await q(`DELETE FROM gifts WHERE org_id=$1`, [orgId]);
    await q(`DELETE FROM fin_audit_log WHERE org_id=$1`, [orgId]);
    await q(`DELETE FROM users WHERE org_id=$1`, [orgId]);
    await q(`DELETE FROM donors WHERE org_id=$1`, [orgId]);
    await q(`DELETE FROM orgs WHERE id=$1`, [orgId]);
  }
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
