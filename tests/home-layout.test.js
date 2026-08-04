// BUILD-34 — customizable Home (per-user section layout).
// Local scratch server + Postgres (tests/README.md recipe). No external creds.
//
// What it proves:
//   - GET/PUT/DELETE /me/home-layout round-trips a per-USER preference:
//     saved on one login, visible from a second login (the "second device"),
//     never leaking to another user or another org
//   - server-side validation: non-arrays, malformed rows, oversized configs
//     → 400; duplicates deduped; the hero can never be STORED hidden
//   - reset (DELETE) → NULL, back to the canonical default
//   - the client merge rule (client/src/lib/homeLayout.js, dynamic-imported
//     like money.js): saved order respected, retired/unknown ids dropped,
//     NEW canonical section ids appended visible for users with an older
//     saved config, hero forced visible, dedupe, default detection

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG_A = "org_hl_a", ORG_B = "org_hl_b";

async function reset() {
  for (const o of [ORG_A, ORG_B]) {
    await q(`DELETE FROM users WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]);
  }
}
async function seedOrg(o, tag) {
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,'active','team')`, [o, `HL ${tag}`, `hl-${tag}`]);
}
async function seedUser(o, id, tag) {
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,'admin')`, [id, o, `${tag}@hl.local`, hash, `User ${tag}`]);
}

(async () => {
  await reset();
  await seedOrg(ORG_A, "a"); await seedOrg(ORG_B, "b");
  await seedUser(ORG_A, "u_hl_a1", "a1");
  await seedUser(ORG_A, "u_hl_a2", "a2");
  await seedUser(ORG_B, "u_hl_b1", "b1");

  const tokA1 = await login("a1@hl.local");
  const tokA2 = await login("a2@hl.local");
  const tokB1 = await login("b1@hl.local");

  // ── Defaults + auth ───────────────────────────────────────────────────────
  let r = await api("GET", "/me/home-layout", tokA1);
  ok("fresh user GET → 200 with layout:null (canonical default)", r.status === 200 && r.body.layout === null, r.body);
  r = await api("GET", "/me/home-layout", null);
  ok("no token → 401", r.status === 401, r.status);

  // ── Save + round-trip + the "second device" ──────────────────────────────
  const custom = [
    { id: "myPortfolio", visible: true },
    { id: "hero", visible: true },
    { id: "work", visible: true },
    { id: "retention", visible: false },
    { id: "commandCenter", visible: true },
    { id: "goalCards", visible: false },
    { id: "impact", visible: true },
  ];
  r = await api("PUT", "/me/home-layout", tokA1, { layout: custom });
  ok("PUT saves a reordered/hidden layout", r.status === 200 && Array.isArray(r.body.layout) && r.body.layout.length === 7, r.body);
  r = await api("GET", "/me/home-layout", tokA1);
  ok("GET returns the saved order", r.status === 200 && r.body.layout.map(x => x.id).join(",") === custom.map(x => x.id).join(","), r.body);
  ok("GET returns the saved visibility (retention hidden)", r.body.layout.find(x => x.id === "retention").visible === false, r.body);

  const tokA1b = await login("a1@hl.local"); // fresh session = the second device
  r = await api("GET", "/me/home-layout", tokA1b);
  ok("second login (second device) sees the same saved layout", r.status === 200 && r.body.layout?.map(x => x.id).join(",") === custom.map(x => x.id).join(","), r.body);

  // ── Per-user + per-org isolation ─────────────────────────────────────────
  r = await api("GET", "/me/home-layout", tokA2);
  ok("another user in the SAME org still has the default (per-user pref)", r.status === 200 && r.body.layout === null, r.body);
  r = await api("GET", "/me/home-layout", tokB1);
  ok("a user in another org is untouched", r.status === 200 && r.body.layout === null, r.body);

  // ── Validation + rails ───────────────────────────────────────────────────
  r = await api("PUT", "/me/home-layout", tokA2, { layout: "nope" });
  ok("non-array layout → 400", r.status === 400, r.status);
  r = await api("PUT", "/me/home-layout", tokA2, { layout: [{ id: "hero" }] });
  ok("row missing visible:boolean → 400", r.status === 400, r.status);
  r = await api("PUT", "/me/home-layout", tokA2, { layout: [{ id: 42, visible: true }] });
  ok("non-string id → 400", r.status === 400, r.status);
  r = await api("PUT", "/me/home-layout", tokA2, { layout: Array.from({ length: 33 }, (_, i) => ({ id: "s" + i, visible: true })) });
  ok("oversized (33-entry) layout → 400", r.status === 400, r.status);
  r = await api("PUT", "/me/home-layout", tokA2, { layout: [{ id: "hero", visible: false }, { id: "work", visible: true }] });
  ok("hero can never be STORED hidden (forced visible on write)", r.status === 200 && r.body.layout.find(x => x.id === "hero").visible === true, r.body);
  r = await api("PUT", "/me/home-layout", tokA2, { layout: [{ id: "work", visible: true }, { id: "work", visible: false }] });
  ok("duplicate ids deduped (first occurrence wins)", r.status === 200 && r.body.layout.length === 1 && r.body.layout[0].visible === true, r.body);

  // ── Reset ────────────────────────────────────────────────────────────────
  r = await api("DELETE", "/me/home-layout", tokA2);
  ok("DELETE resets to default", r.status === 200 && r.body.layout === null, r.body);
  r = await api("GET", "/me/home-layout", tokA2);
  ok("after reset, GET → null again", r.status === 200 && r.body.layout === null, r.body);

  // ── The client merge rule (the canonical list + stale-config guarantee) ──
  const { mergeLayout, DEFAULT_LAYOUT, HOME_SECTIONS, isDefaultLayout, sectionMeta, moveToTop } =
    await import("../client/src/lib/homeLayout.js");

  ok("canonical list has the hero first and 7 sections", HOME_SECTIONS.length === 7 && HOME_SECTIONS[0].id === "hero", HOME_SECTIONS.map(s => s.id));
  ok("hero is the ONLY unhideable section", HOME_SECTIONS.filter(s => s.hideable === false).map(s => s.id).join(",") === "hero");

  const m0 = mergeLayout(null);
  ok("merge(null) = the full default, everything visible", m0.length === DEFAULT_LAYOUT.length && m0.every(x => x.visible) && isDefaultLayout(m0));

  // A user's OLD saved config predates two sections (retention, impact) and
  // contains a retired id — the new sections must appear (visible, appended in
  // canonical order) and the retired id must drop.
  const stale = [
    { id: "work", visible: true },
    { id: "retiredSection", visible: true },
    { id: "hero", visible: true },
    { id: "commandCenter", visible: false },
    { id: "myPortfolio", visible: true },
    { id: "goalCards", visible: true },
  ];
  const m1 = mergeLayout(stale);
  ok("merge keeps the user's order for known ids", m1.slice(0, 5).map(x => x.id).join(",") === "work,hero,commandCenter,myPortfolio,goalCards", m1);
  ok("merge drops retired/unknown ids", !m1.some(x => x.id === "retiredSection"));
  ok("NEW section ids appear for a stale config, visible, in canonical order", m1.slice(5).map(x => `${x.id}:${x.visible}`).join(",") === "retention:true,impact:true", m1);
  ok("merge preserves saved hidden flags", m1.find(x => x.id === "commandCenter").visible === false);
  ok("merged stale config is a full layout", m1.length === DEFAULT_LAYOUT.length);

  const m2 = mergeLayout([{ id: "hero", visible: false }]);
  ok("merge forces the hero visible even if a saved config hid it", m2.find(x => x.id === "hero").visible === true);
  const m3 = mergeLayout([{ id: "work", visible: false }, { id: "work", visible: true }, { id: 7 }, "junk", null]);
  ok("merge survives garbage rows + dedupes (first wins)", m3.length === DEFAULT_LAYOUT.length && m3.find(x => x.id === "work").visible === false, m3);
  ok("isDefaultLayout flags a reorder as non-default", !isDefaultLayout(mergeLayout(stale)));
  ok("sectionMeta resolves labels for the tray", sectionMeta("myPortfolio")?.label === "My Portfolio" && sectionMeta("nope") === null);

  // ── moveToTop (the edit-mode "↑ Top" affordance) ─────────────────────────
  // Hero rail: while the hero is the first VISIBLE section, "top" for any
  // other section means directly under the hero; hero moved down → genuinely
  // first. A no-op returns the SAME reference (the UI hides the button on it).
  const heroFirst = mergeLayout(null); // hero, goalCards, commandCenter, ...
  const t1 = moveToTop(heroFirst, "impact");
  ok("hero first → moved section lands directly UNDER the hero", t1.map(x => x.id).slice(0, 2).join(",") === "hero,impact", t1.map(x => x.id));
  ok("moveToTop keeps every section exactly once", t1.length === DEFAULT_LAYOUT.length && new Set(t1.map(x => x.id)).size === t1.length);
  const t2 = moveToTop(t1, "impact");
  ok("already at top → no-op returns the same reference", t2 === t1);
  ok("hero itself at position 1 → its Top affordance is a no-op", moveToTop(heroFirst, "hero") === heroFirst);

  const heroDown = mergeLayout([
    { id: "work", visible: true }, { id: "goalCards", visible: true }, { id: "hero", visible: true },
  ]);
  const t3 = moveToTop(heroDown, "impact");
  ok("hero moved down → moved section goes GENUINELY first", t3[0].id === "impact" && t3.map(x => x.id).indexOf("hero") > 0, t3.map(x => x.id));
  const t4 = moveToTop(heroDown, "hero");
  ok("hero itself moves to genuinely first", t4[0].id === "hero", t4.map(x => x.id));

  // A hidden section sitting above the hero in the ARRAY doesn't break the
  // rail — "first" means first VISIBLE.
  const hiddenAbove = mergeLayout([
    { id: "goalCards", visible: false }, { id: "hero", visible: true }, { id: "work", visible: true },
  ]);
  const t5 = moveToTop(hiddenAbove, "impact");
  const t5vis = t5.filter(x => x.visible).map(x => x.id);
  ok("hidden row above the hero: visible order is still hero-then-moved", t5vis[0] === "hero" && t5vis[1] === "impact", t5vis);
  ok("moveToTop tolerates junk input", moveToTop(null, "work") === null && moveToTop(heroFirst, "nope") === heroFirst);

  await reset();
  await closeDb();
  summary();
})();
