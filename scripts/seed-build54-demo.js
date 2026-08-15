// BUILD-54 §7 — the pilot-org demo: dress ONE campaign with donor-facing
// content, attribute a large demo gift, and publish a full widget layout on
// the portal page. API-only (goes through the same validated routes staff
// use), idempotent (re-running re-PUTs the same content).
//
// LOCAL (default):  DB not touched directly — BASE=http://localhost:5601
//                   with the scratch demo admin.
// PROD (deliberate opt-in): BASE=https://nonprofit-erp-production.up.railway.app \
//                   DEMO_EMAIL=admin@creoarts.org DEMO_PASSWORD=… node scripts/seed-build54-demo.js
// org_creo is DEMO-ONLY (fabricated identity — see CLAUDE.md); its donors and
// gifts are demo fiction end to end.
const BASE = process.env.BASE || "http://localhost:5601";
const EMAIL = process.env.DEMO_EMAIL || "admin@creoarts.org";
const PASSWORD = process.env.DEMO_PASSWORD || "demo1234";
const CAMPAIGN_NAME = process.env.CAMPAIGN_NAME || "Studio Expansion Capital Campaign";
const DONOR_EMAIL = process.env.DONOR_EMAIL || "xjca2006+demo@gmail.com";
const GIFT_AMOUNT = Number(process.env.GIFT_AMOUNT || 25000);

async function api(method, path, token, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => null);
  if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  return j;
}

(async () => {
  const auth = await api("POST", "/auth/login", null, { email: EMAIL, password: PASSWORD });
  const tok = auth.token;
  console.log("logged in:", auth.org?.name);

  // 1) the campaign — donor-facing content (org-authored demo copy)
  const camps = await api("GET", "/fundraising/campaigns", tok);
  let camp = camps.find(c => c.name === CAMPAIGN_NAME) || camps[0];
  if (!camp) {
    camp = await api("POST", "/fundraising/campaigns", tok, { name: CAMPAIGN_NAME, goalAmount: 120000, goalCategory: "capital" });
    console.log("created the demo campaign (none existed)");
  }
  const ps = await api("GET", "/portal-settings", tok);
  const heroPath = ps.header_image_url || null;   // reuse the org's stored banner asset (a /portal-assets path echoes through)
  await api("PUT", `/fundraising/campaigns/${camp.id}`, tok, {
    donorFacingName: "Steeples and Studios Campaign",
    donorDescription: "We're restoring the chapel and opening three new working studios — room for forty more young artists every week.",
    donorStory: [
      { type: "h2", text: "Why this matters" },
      { type: "p", text: "Our waitlist has doubled in two years. The building next door gives us the space to say yes — a restored chapel for performances, and three studios built for teaching." },
      { type: "ul", items: ["Chapel restoration and sound work", "Three teaching studios", "Accessible entrance and gallery hall"] },
      { type: "p", text: "Every gift to this campaign goes to the building fund. We publish progress updates here as the work happens." },
    ],
    ...(heroPath ? { heroImageData: heroPath } : {}),
    goalProgressPublic: true,
  });
  console.log(`campaign dressed: ${camp.name} → "Steeples and Studios Campaign"`);

  // 2) a large attributed demo gift (idempotency key = stable per seed)
  const donors = await api("GET", "/donors/summaries", tok);
  const donor = donors.find(d => (d.email || "").toLowerCase() === DONOR_EMAIL.toLowerCase()) || donors.find(d => d.email);
  if (!donor) throw new Error("no donor with an email to attribute the demo gift to");
  const gifts = await fetch(BASE + `/donors/${donor.id}`, { headers: { Authorization: "Bearer " + tok } }).then(r => r.json());
  const already = JSON.stringify(gifts).includes("build54 demo gift");
  if (already) {
    console.log("demo gift already present — skipping (idempotent)");
  } else {
    await api("POST", `/donors/${donor.id}/gifts`, tok, {
      amount: GIFT_AMOUNT, date: new Date().toISOString().slice(0, 10), type: "cash",
      campaignId: camp.id, notes: "build54 demo gift — Steeples and Studios",
      idempotencyKey: "build54-demo-" + donor.id,
    });
    console.log(`attributed $${GIFT_AMOUNT.toLocaleString()} demo gift for ${donor.name}`);
  }

  // 3) the full widget layout, published
  const funds = await api("GET", "/finance/funds", tok);
  const widgets = [
    { type: "hero", heading: "Making the arts belong to everyone", sub: "What your giving builds, in one place.", image: heroPath, size: "tall" },
    { type: "mygiving" },
    { type: "campaign", campaignId: camp.id },
    { type: "impact", heading: "What your giving made possible" },
    ...(funds.length ? [{ type: "funds", heading: "Where you can give", fundIds: funds.slice(0, 3).map(f => f.id) }] : []),
    { type: "quote", text: "This place taught my daughter that her voice matters.", attribution: "A CREO parent (demo)" },
    { type: "give", heading: "Make a new gift", buttonLabel: "Give" },
  ];
  await api("PUT", "/portal-page/draft", tok, { widgets });
  await api("POST", "/portal-page/publish", tok, {});
  console.log(`published a ${widgets.length}-widget portal page`);
  console.log("done — open the portal:", ps.portal_url || "(portal url in Settings)");
})().catch(e => { console.error("SEED FAILED:", e.message); process.exit(1); });
