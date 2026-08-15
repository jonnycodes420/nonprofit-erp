// BUILD-54 §4 — the portal page: typed widgets, draft/publish lifecycle,
// edit-mode authorization, sample-data-only edit mode.
//
// Contract:
//   • /portal-page* is staff-session + ADMIN-only + org-scoped by the token
//     alone (no cross-org id exists in the API).
//   • Autosave writes the DRAFT; donors see NOTHING until an explicit
//     publish; revert restores the last published page.
//   • Widgets are typed fields only: unknown types/oversized/foreign ids →
//     400; images become asset-seam paths; video is allowlisted
//     provider+id (never a stored URL or embed code); hostile strings are
//     inert data.
//   • Public page resolution carries ZERO donor data; the impact widget
//     resolves org-wide updates only; goal figures only when opted public.
//   • Edit mode renders SAMPLE donor data ONLY — pinned by a source check on
//     PortalEditor.jsx (its API surface is a fixed donor-data-free
//     allowlist).
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
const { BASE, ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG_A = "org_pp54_a", SLUG_A = "portalpage-a";
const ORG_B = "org_pp54_b";
const DONOR_EMAIL = "rowan@pp54.test";

function fakePng(w, h) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0); ihdr.write("IHDR", 4);
  ihdr.writeUInt32BE(w, 8); ihdr.writeUInt32BE(h, 12);
  ihdr[16] = 8; ihdr[17] = 6;
  return Buffer.concat([sig, ihdr]);
}
const pngUri = (w, h) => "data:image/png;base64," + fakePng(w, h).toString("base64");

async function pub(p) {
  const r = await fetch(BASE + p);
  let body = null; try { body = await r.json(); } catch { /* */ }
  return { status: r.status, body };
}

async function fixture() {
  await q(`DELETE FROM donor_accounts WHERE email LIKE '%@pp54.test'`);
  for (const org of [ORG_A, ORG_B]) {
    for (const t of ["portal_assets", "portal_audit_log", "portal_sessions", "portal_magic_links", "impact_updates", "gifts", "campaigns", "fin_funds", "donors", "users"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM portal_pages WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM portal_settings WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]).catch(() => {});
  }
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Page Arts','${SLUG_A}',1,'active','core')`, [ORG_A]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Other Org','portalpage-b',1,'active','core')`, [ORG_B]);
  await q(`INSERT INTO portal_settings (org_id,enabled,network_listed,display_name) VALUES ($1,true,true,'Page Arts')`, [ORG_A]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_pp54_a',$1,'pp54-a@test.local',$2,'A Admin','admin')`, [ORG_A, hash]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_pp54_s',$1,'pp54-s@test.local',$2,'A Staff','staff')`, [ORG_A, hash]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_pp54_b',$1,'pp54-b@test.local',$2,'B Admin','admin')`, [ORG_B, hash]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fund_pp54',$1,'Music Education',false)`, [ORG_A]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fund_pp54b',$1,'B Fund',false)`, [ORG_B]);
  await q(`INSERT INTO donors (id,org_id,name,email,total_giving,gift_count,status,stage) VALUES ('d_pp54',$1,'Rowan Idle',$2,600,2,'mid','steward')`, [ORG_A, DONOR_EMAIL]);
  const today = new Date().toISOString().slice(0, 10);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign) VALUES ('g_pp54',$1,'d_pp54',600,$2,'cash','')`, [ORG_A, today]);
}

(async () => {
  await fixture();
  const tokA = await login("pp54-a@test.local", "loadtest1234");
  const tokStaff = await login("pp54-s@test.local", "loadtest1234");
  const tokB = await login("pp54-b@test.local", "loadtest1234");

  // ── 1) authorization: admin-only, staff-session-only ─────────────────────
  console.log("— edit-mode authorization —");
  ok("no token → 401", (await api("GET", "/portal-page", null)).status === 401);
  ok("STAFF role → 403 on read", (await api("GET", "/portal-page", tokStaff)).status === 403);
  ok("STAFF role → 403 on draft write", (await api("PUT", "/portal-page/draft", tokStaff, { widgets: [] })).status === 403);
  ok("STAFF role → 403 on publish", (await api("POST", "/portal-page/publish", tokStaff, {})).status === 403);
  ok("admin reads fine (empty)", (await api("GET", "/portal-page", tokA)).status === 200);

  // ── 2) draft/publish lifecycle ───────────────────────────────────────────
  console.log("\n— draft/publish lifecycle —");
  const v1 = [
    { type: "hero", heading: "Welcome to Page Arts", sub: "Version one", image: pngUri(1200, 600), size: "tall" },
    { type: "richtext", blocks: [{ type: "p", text: "Our story, v1." }] },
    { type: "mygiving" },
    { type: "give", heading: "Make a new gift", buttonLabel: "Give" },
  ];
  const put1 = await api("PUT", "/portal-page/draft", tokA, { widgets: v1 });
  ok("draft accepted, widgets get ids", put1.status === 200 && put1.body.draft.length === 4
    && put1.body.draft.every(w => /^wid_[a-f0-9]{8}$/.test(w.id)), put1.body);
  ok("hero image became an asset path in the DRAFT", /^\/portal-assets\/pa_/.test(put1.body.draft[0].image || ""), put1.body.draft[0]);
  let cfg = (await pub(`/portal/${SLUG_A}/config`)).body;
  ok("UNPUBLISHED draft is invisible to donors (config.page null)", cfg.page === null, cfg.page);

  const pubd = await api("POST", "/portal-page/publish", tokA, {});
  ok("publish 200", pubd.status === 200, pubd.body);
  cfg = (await pub(`/portal/${SLUG_A}/config`)).body;
  ok("published page reaches the public config", cfg.page && cfg.page.widgets.length === 4
    && cfg.page.widgets[0].heading === "Welcome to Page Arts", cfg.page && cfg.page.widgets[0]);

  // Draft edits after publish stay invisible until the next publish.
  const v2 = [...v1]; v2[0] = { ...v1[0], heading: "Version TWO heading" };
  await api("PUT", "/portal-page/draft", tokA, { widgets: v2 });
  cfg = (await pub(`/portal/${SLUG_A}/config`)).body;
  ok("post-publish draft edits invisible until republished", cfg.page.widgets[0].heading === "Welcome to Page Arts");
  const rev = await api("POST", "/portal-page/revert", tokA, {});
  ok("revert restores the published page into the draft", rev.status === 200
    && rev.body.draft[0].heading === "Welcome to Page Arts", rev.body.draft && rev.body.draft[0]);

  // ── 3) widget validation battery ─────────────────────────────────────────
  console.log("\n— widget validation —");
  for (const [label, widgets] of [
    ["unknown type", [{ type: "html", html: "<b>x</b>" }]],
    ["not an array", { type: "hero" }],
    ["31 widgets", Array.from({ length: 31 }, () => ({ type: "give" }))],
    ["video: pasted embed code", [{ type: "video", url: "<iframe src='https://evil.example'></iframe>" }]],
    ["video: non-allowlisted host", [{ type: "video", url: "https://evil.example/watch?v=abc12345" }]],
    ["funds: foreign fund id", [{ type: "funds", fundIds: ["fund_pp54b"] }]],
    ["campaign: foreign/unknown id", [{ type: "campaign", campaignId: "cmp_nope" }]],
    ["stats: empty items", [{ type: "stats", items: [] }]],
    ["image: junk bytes", [{ type: "image", image: "data:image/png;base64,AAAA" }]],
    ["richtext: raw html block type", [{ type: "richtext", blocks: [{ type: "script", text: "x" }] }]],
  ]) {
    const r = await api("PUT", "/portal-page/draft", tokA, { widgets });
    ok(`rejected: ${label}`, r.status === 400, r.status);
  }
  const video = await api("PUT", "/portal-page/draft", tokA, {
    widgets: [{ type: "video", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
              { type: "video", url: "https://vimeo.com/76979871" }],
  });
  ok("video URLs parse to provider+id ONLY", video.status === 200
    && video.body.draft[0].provider === "youtube" && video.body.draft[0].videoId === "dQw4w9WgXcQ"
    && video.body.draft[1].provider === "vimeo" && video.body.draft[1].videoId === "76979871", video.body.draft);
  ok("no caller URL survives in the stored page", !JSON.stringify(video.body.draft).includes("youtube.com/watch")
    && !JSON.stringify(video.body.draft).includes("vimeo.com/"));
  const hostile = await api("PUT", "/portal-page/draft", tokA, {
    widgets: [{ type: "quote", text: "<script>alert(1)</script> — a donor", attribution: "<img src=x>" }],
  });
  ok("hostile strings stored as inert text", hostile.status === 200
    && hostile.body.draft[0].text.includes("<script>"), hostile.body.draft);

  // ── 4) public resolution: real data, zero donor data ─────────────────────
  console.log("\n— public resolution —");
  const camp = await api("POST", "/fundraising/campaigns", tokA, {
    name: "Roof Fund", goalAmount: 10000, donorDescription: "Fix the roof.", goalProgressPublic: true,
  });
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign,campaign_id) VALUES
    ('g_pp54c',$1,'d_pp54',2500,$2,'cash','Roof Fund',$3)`, [ORG_A, new Date().toISOString().slice(0, 10), camp.body.id]);
  await api("POST", "/impact-updates", tokA, { title: "Org-wide news", body: "For everyone.", orgWide: true, targets: [] });
  await api("POST", "/impact-updates", tokA, { title: "Targeted news", body: "Roof donors only.", targets: [{ kind: "campaign", id: camp.body.id }] });
  await api("PUT", "/portal-page/draft", tokA, {
    widgets: [
      { type: "funds", heading: "Programs", fundIds: ["fund_pp54"] },
      { type: "campaign", campaignId: camp.body.id },
      { type: "impact", heading: "Impact" },
      { type: "mygiving" },
    ],
  });
  await api("POST", "/portal-page/publish", tokA, {});
  cfg = (await pub(`/portal/${SLUG_A}/config`)).body;
  const [wFunds, wCamp, wImpact] = cfg.page.widgets;
  ok("funds widget resolves the org's REAL fund", wFunds.funds?.length === 1 && wFunds.funds[0].name === "Music Education", wFunds);
  ok("campaign widget resolves donor-facing content + opted-in goal",
    wCamp.campaign?.name === "Roof Fund" && wCamp.campaign.description === "Fix the roof."
    && wCamp.campaign.goal?.amount === 10000 && wCamp.campaign.goal.raised === 2500, wCamp.campaign);
  ok("public impact = ORG-WIDE only (targeted needs attribution)",
    wImpact.updates?.length === 1 && wImpact.updates[0].title === "Org-wide news", wImpact.updates);
  const cfgJson = JSON.stringify(cfg);
  ok("public config carries ZERO donor data", !cfgJson.includes(DONOR_EMAIL) && !cfgJson.includes("Rowan")
    && !cfgJson.includes('"ytd"') && !cfgJson.includes("600"), null);
  // goal opt-out flips the public payload off
  await api("PUT", `/fundraising/campaigns/${camp.body.id}`, tokA, { goalProgressPublic: false });
  cfg = (await pub(`/portal/${SLUG_A}/config`)).body;
  ok("goal OFF → no goal figures on the public page", cfg.page.widgets[1].campaign.goal === null);

  // ── 5) org isolation ─────────────────────────────────────────────────────
  console.log("\n— org isolation —");
  const bPage = await api("GET", "/portal-page", tokB);
  ok("org B sees its OWN (empty) page, never A's", bPage.status === 200 && bPage.body.draft === null, bPage.body);
  ok("org B publish with no draft → 400", (await api("POST", "/portal-page/publish", tokB, {})).status === 400);

  // ── 6) sample-data-only edit mode (source contract) ──────────────────────
  console.log("\n— edit mode: sample data only —");
  const editorSrc = fs.readFileSync(path.join(__dirname, "..", "client", "src", "pages", "PortalEditor.jsx"), "utf8");
  ok("editor declares the fictional donor (SAMPLE_ME)", editorSrc.includes("SAMPLE_ME") && editorSrc.includes("Sam Sample"));
  ok("editor renders the visible SAMPLE DONOR DATA banner", editorSrc.includes("SAMPLE DONOR DATA"));
  const called = [...editorSrc.matchAll(/apiFetch\("([^"]+)"/g)].map(m => m[1]);
  const ALLOWED = new Set(["/portal-page", "/portal-page/draft", "/portal-page/publish", "/portal-page/revert", "/portal-page/starter", "/portal-settings", "/finance/funds", "/fundraising/campaigns"]);
  ok("editor's API surface is the fixed donor-data-free allowlist", called.length > 0 && called.every(p => ALLOWED.has(p)), called);
  ok("editor opens no portal session and reads no donor endpoints",
    !/pfetch|credentials|\/portal\/\$\{|\/donors|\/account\//.test(editorSrc));
  ok("editor phone-default device toggle", /useState\("phone"\)/.test(editorSrc));

  // ── 7) starters ──────────────────────────────────────────────────────────
  console.log("\n— starter layouts —");
  const st = await api("POST", "/portal-page/starter", tokB, { key: "story_first" });
  ok("starter fills an empty draft", st.status === 200 && st.body.draft.length >= 4, st.body);
  ok("unknown starter → 400", (await api("POST", "/portal-page/starter", tokB, { key: "nope" })).status === 400);
  const starterJson = JSON.stringify(st.body.draft);
  ok("starters invent no content (no fake numbers/claims)", !/\$\d|raised|donors? (love|say)/i.test(starterJson), null);

  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
