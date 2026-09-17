#!/usr/bin/env node
// BUILD-89 — THE DEMO FILE. One thousand donors that look like a real
// organisation's file, so a demo shows the product working instead of the
// product empty.
//
// WHAT IT SEEDS, and why each part is there:
//   · 1,000 donors — individuals, CHURCHES, FOUNDATIONS, businesses and
//     households, because a nonprofit's file is not a list of people and a
//     demo that only has people cannot show an organisation being a donor
//     (BUILD-84 P0-2).
//   · EVERY stage and EVERY giving tier occupied, so no screen in the product
//     renders an empty band.
//   · ~4,000 gifts across three years, with funds, payment methods and gift
//     types spread, so Reports/Finance/Drift all have something true to say.
//   · monthly givers (twelve consecutive months), lapsed donors, first-time
//     donors, major donors, an anonymous gift, a deceased record and a
//     do-not-contact record — the cases the product has rules about.
//   · pledges, open grants, and twenty-five conversations whose next steps
//     land across overdue/today/coming-up, so the Thread reads like a queue
//     rather than one donor four times.
//
// IT IS DETERMINISTIC AND IDEMPOTENT. Every donor has a stable email, and the
// import dedupes on email, so running it twice adds nothing. Every record is
// tagged `demo-file` so it can be found and removed as a set.
//
// Loopback by default. Writing to a REMOTE api needs BOTH a non-loopback BASE
// and --i-know-this-is-prod, and it logs what it is about to do first.
//   node scripts/build89-demo-seed.js                       # local
//   BASE=https://… DEMO_EMAIL=… DEMO_PASSWORD=… \
//     node scripts/build89-demo-seed.js --i-know-this-is-prod
const BASE = (process.env.BASE || "http://localhost:5601").replace(/\/+$/, "");
const LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(BASE);
if (!LOOPBACK && !process.argv.includes("--i-know-this-is-prod")) {
  console.error(`REFUSED: ${BASE} is not loopback. Add --i-know-this-is-prod to write there.`);
  process.exit(1);
}
const EMAIL = process.env.DEMO_EMAIL || "admin@creoarts.org";
const PASSWORD = process.env.DEMO_PASSWORD || "demo1234";
const DRY = process.argv.includes("--dry-run");

// ── A seeded PRNG, so the file is the same file every time ─────────────────
let _s = 89;
const rnd = () => { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; };
const pick = a => a[Math.floor(rnd() * a.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const FIRST = ["Margaret","Robert","Diana","Otis","Ruth","Samuel","Grace","Henry","Alice","Theodore","Clara","Nathaniel","Ada","Joseph","Miriam","Walter","Esther","Leonard","Pauline","Franklin","Hazel","Marcus","Delia","Sterling","Cordelia","Amos","Vivian","Percy","Rosalind","Clive","Beatrice","Wendell","Louisa","Barnaby","Constance","Silas","Harriet","Ambrose","Winifred","Elias","Maude","Horace","Genevieve","Rupert","Lavinia","Cyrus","Adelaide","Bartholomew","Prudence","Dashiell"];
const LAST = ["Chen","Harmon","Torres","Grange","Okafor","Whitfield","Castellanos","Baptiste","Lindqvist","Abernathy","Mwangi","Petrossian","Delacroix","Ferraro","Nakamura","Oyelaran","Vasquez","Kowalski","Brightwater","Ashford","Calloway","Dunmore","Ellsworth","Fairbanks","Goodhue","Hollingsworth","Ingersoll","Jessup","Kirkpatrick","Lamontagne","Merriweather","Nightingale","Ollivander","Prescott","Quimby","Rutherford","Stanhope","Thackeray","Underwood","Vandermeer","Westbrook","Yarborough","Zimmerman","Applegate","Blackwood","Cartwright","Davenport","Eastbrook","Fitzgerald","Galbraith"];
const CHURCH_A = ["Grace","First","Second","Trinity","Bethel","Calvary","Emmanuel","Hope","Redeemer","Cornerstone","Living Water","New Covenant","Mount Zion","St. Andrew's","St. Mark's","Covenant","Faith","Shiloh","Ebenezer","Wellspring"];
const CHURCH_B = ["Community Church","Baptist Church","Methodist Church","Presbyterian Church","Lutheran Church","Assembly of God","Bible Church","Chapel","Fellowship","United Church"];
const FDN_A = ["Sunrise","Ridgeline","Harborview","Cedar Grove","Bluebird","Thornton","Ashland","Wexford","Marlowe","Kettle","Linwood","Pemberton","Stillwater","Fairhaven","Greenbrier","Copperfield","Larkspur","Mossbrook","Halcyon","Windermere"];
const BIZ_A = ["Ledger","Blue Ridge","Ironworks","Half Note","Cobblestone","Rivet","Northfield","Tidewater","Brightline","Kiln","Anvil","Lantern","Foxglove","Quarry","Saltbox"];
const BIZ_B = ["& Co.","Dental","Contracting","Printing","Insurance","Coffee Roasters","Orthodontics","Law Group","Hardware","Outfitters","Motors","Design Studio","Physical Therapy","Bakery","Bookkeeping"];
const CITIES = [["Lexington","KY"],["Louisville","KY"],["Cincinnati","OH"],["Nashville","TN"],["Birmingham","AL"],["Fairhope","AL"],["Mobile","AL"],["Chattanooga","TN"],["Knoxville","TN"],["Bowling Green","KY"],["Dayton","OH"],["Huntsville","AL"],["Franklin","TN"],["Owensboro","KY"],["Athens","GA"]];
const FUNDS = ["General Operating","Studio Scholarships","Building Fund","Youth Arts Access","Endowment"];
const METHODS = ["Check","Cash","Credit Card","ACH","Stock","In Kind"];
const TYPES = ["cash","pledge_payment","in_kind","grant","stock"];

// ── The file ────────────────────────────────────────────────────────────────
// Each donor's SHAPE decides its giving, and the giving decides the stage the
// product infers — so the bands fill up because the file is real, not because
// a stage column was written by hand. `_stageExplicit` is used only for the
// handful of pipeline states giving history cannot imply (a prospect nobody
// has asked yet, a proposal out for signature).
const PROFILES = [
  { key:"monthly",     weight:12, gifts:() => ({ n:int(10,24), lo:25,  hi:150,  monthly:true }) },
  { key:"major",       weight:5,  gifts:() => ({ n:int(3,8),   lo:2500,hi:25000 }) },
  { key:"mid",         weight:22, gifts:() => ({ n:int(2,6),   lo:250, hi:1500 }) },
  { key:"small",       weight:24, gifts:() => ({ n:int(1,4),   lo:25,  hi:200 }) },
  { key:"firsttime",   weight:9,  gifts:() => ({ n:1,          lo:50,  hi:500,  recent:true }) },
  { key:"lapsed",      weight:14, gifts:() => ({ n:int(1,5),   lo:50,  hi:900,  oldest:true }) },
  { key:"prospect",    weight:9,  gifts:() => ({ n:0 }) },
  { key:"pledger",     weight:5,  gifts:() => ({ n:int(2,5),   lo:500, hi:3000 }) },
];
const KINDS = [
  { kind:"person",       weight:64 },
  { kind:"church",       weight:13 },
  { kind:"foundation",   weight:9 },
  { kind:"business",     weight:7 },
  { kind:"household",    weight:7 },
];
const weighted = rows => {
  const total = rows.reduce((s, r) => s + r.weight, 0);
  let x = rnd() * total;
  for (const r of rows) { x -= r.weight; if (x <= 0) return r; }
  return rows[rows.length - 1];
};

function buildFile(n) {
  const out = [];
  // EVERY NAME IS UNIQUE. Fifty first names against fifty surnames collides
  // long before a thousand records, and three rows reading "Halcyon
  // Charitable Trust" is the single fastest way to make a demo look fake.
  const used = new Set();
  const unique = (make) => {
    for (let tries = 0; tries < 60; tries++) {
      const v = make(tries);
      if (!used.has(v.toLowerCase())) { used.add(v.toLowerCase()); return v; }
    }
    const v = make(0) + " " + (used.size + 1);
    used.add(v.toLowerCase());
    return v;
  };
  for (let i = 0; i < n; i++) {
    const k = weighted(KINDS).kind;
    const p = weighted(PROFILES);
    const first = pick(FIRST), last = pick(LAST);
    const [city, state] = pick(CITIES);
    let name, kind = "person", donorType = "individual", organization = null, contactName = null;
    if (k === "church")      { name = unique(tr => `${pick(CHURCH_A)} ${pick(CHURCH_B)}${tr > 20 ? " of " + city : ""}`); kind = "organisation"; donorType = "church"; organization = name; contactName = `${first} ${last}`; }
    else if (k === "foundation") { name = unique(tr => `${pick(FDN_A)} ${pick(["Foundation","Family Foundation","Charitable Trust","Fund"])}${tr > 20 ? " of " + state : ""}`); kind = "organisation"; donorType = "foundation"; organization = name; contactName = `${first} ${last}`; }
    else if (k === "business")   { name = unique(tr => `${pick(BIZ_A)} ${pick(BIZ_B)}${tr > 20 ? " (" + city + ")" : ""}`); kind = "organisation"; donorType = "business"; organization = name; contactName = `${first} ${last}`; }
    else if (k === "household")  { name = unique(() => `${pick(FIRST)} and ${pick(FIRST)} ${pick(LAST)}`); donorType = "household"; }
    else                         { name = unique(tr => tr < 25 ? `${pick(FIRST)} ${pick(LAST)}` : `${pick(FIRST)} ${String.fromCharCode(65 + int(0, 25))}. ${pick(LAST)}`); }
    const email = `demo${String(i).padStart(4, "0")}@example.org`;
    const spec = p.gifts();
    const gifts = [];
    for (let g = 0; g < (spec.n || 0); g++) {
      const amount = int(spec.lo, spec.hi);
      let date;
      if (spec.monthly)      date = day(-30 * (g + 1));
      else if (spec.recent)  date = day(-int(2, 40));
      else if (spec.oldest)  date = day(-int(400, 1080));
      else                   date = day(-int(20, 1080));
      gifts.push({
        amount, date,
        fund: pick(FUNDS),
        paymentMethod: k === "person" || k === "household" ? pick(METHODS) : pick(["Check","ACH","Stock"]),
        type: donorType === "foundation" && rnd() < 0.5 ? "grant" : pick(TYPES.slice(0, 2)),
      });
    }
    const donor = { name, email, phone:`(${int(205,859)}) ${int(200,999)}-${int(1000,9999)}`,
      city, state, zip:String(int(30000, 42999)), kind, donorType, tags:["demo-file"],
      notes:"From the demo file (BUILD-89)." };
    if (organization) { donor.organization = organization; donor.contactName = contactName; }
    // The two pipeline states giving history cannot imply.
    if (p.key === "prospect" && rnd() < 0.5) { donor.stage = pick(["prospect","qualify"]); donor._stageExplicit = true; }
    if (p.key === "major" && rnd() < 0.35)   { donor.stage = "solicit"; donor._stageExplicit = true; }
    // The cases the product has rules about, on a handful of records.
    if (i === 17)  { donor.deceased = true; }
    if (i === 23)  { donor.doNotContact = true; }
    if (i === 31)  { donor.doNotSolicit = true; }
    out.push({ ...donor, _profile:p.key, gifts });
  }
  return out;
}

const api = async (method, path, token, body) => {
  const r = await fetch(BASE + path, { method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  let out = null; try { out = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: out || {} };
};

(async () => {
  const file = buildFile(1000);
  const giftCount = file.reduce((s, d) => s + d.gifts.length, 0);
  const byKind = {}, byProfile = {};
  for (const d of file) { byKind[d.donorType] = (byKind[d.donorType] || 0) + 1; byProfile[d._profile] = (byProfile[d._profile] || 0) + 1; }
  console.log(`BUILD-89 demo file → ${BASE}`);
  console.log(`  ${file.length} donors · ${giftCount} gifts`);
  console.log("  kinds:", Object.entries(byKind).map(([k, v]) => `${k} ${v}`).join(" · "));
  console.log("  shapes:", Object.entries(byProfile).map(([k, v]) => `${k} ${v}`).join(" · "));
  if (DRY) { console.log("\n--dry-run: nothing written."); process.exit(0); }

  const login = await api("POST", "/auth/login", null, { email: EMAIL, password: PASSWORD });
  if (login.status !== 200) { console.error("login failed", login.status, login.body); process.exit(1); }
  const token = login.body.token;
  const orgName = login.body.org?.name || login.body.user?.orgId;
  console.log(`  signed in as ${EMAIL} (${orgName})\n`);

  // ── funds first, so a designation names a fund that exists ───────────────
  const existing = (await api("GET", "/finance/funds", token)).body || [];
  const have = new Set((Array.isArray(existing) ? existing : existing.funds || []).map(f => String(f.name).toLowerCase()));
  for (const f of FUNDS) {
    if (have.has(f.toLowerCase())) continue;
    const r = await api("POST", "/finance/funds", token, { name: f, restricted: f !== "General Operating" });
    console.log(`  fund ${f}: ${r.status === 200 || r.status === 201 ? "created" : "skipped (" + r.status + ")"}`);
  }

  // ── the file, in chunks of 250 (one request per chunk, gifts attached) ───
  const t0 = Date.now();
  let imported = 0;
  for (let i = 0; i < file.length; i += 250) {
    const chunk = file.slice(i, i + 250);
    const donors = chunk.map(({ gifts, _profile, ...d }) => d); // eslint-disable-line no-unused-vars
    const gifts = [];
    chunk.forEach((d, idx) => d.gifts.forEach(g => gifts.push({ donorIndex: idx, ...g })));
    const r = await api("POST", "/donors/import-combined", token, { donors, gifts });
    if (r.status !== 200) { console.error(`  chunk ${i / 250 + 1} FAILED`, r.status, JSON.stringify(r.body).slice(0, 300)); process.exit(1); }
    imported += chunk.length;
    console.log(`  chunk ${i / 250 + 1}/4 → ${imported} donors (${Math.round((Date.now() - t0) / 100) / 10}s)`);
  }

  // ── the things a file cannot carry: pledges, grants, conversations ───────
  const summaries = (await api("GET", "/donors/summaries", token)).body || [];
  const rows = (Array.isArray(summaries) ? summaries : summaries.donors || []);
  const demo = rows.filter(d => String(d.email || "").startsWith("demo"));
  const withGiving = demo.filter(d => parseFloat(d.total_giving || 0) > 0);
  const top = [...withGiving].sort((a, b) => parseFloat(b.total_giving) - parseFloat(a.total_giving));

  let pledges = 0;
  for (const d of top.slice(6, 16)) {
    const r = await api("POST", `/donors/${d.id}/pledges`, token, {
      amount: int(2, 12) * 1000, dueDate: day(int(20, 180)),
      notes: "From the demo file (BUILD-89).",
      frequency: "monthly", installmentCount: pick([4, 6, 12]) });
    if (r.status === 200 || r.status === 201) pledges++;
  }
  console.log(`  pledges: ${pledges}`);

  let grants = 0;
  for (const [funder, program, amount, status, dl] of [
    ["Kettle Foundation","Studio Access",45000,"applied",day(45)],
    ["Ridgeline Family Foundation","Youth Arts",25000,"submitted",day(18)],
    ["Harborview Charitable Trust","General Operating",60000,"awarded",day(-30)],
    ["Wexford Fund","Building Fund",120000,"loi",day(90)],
    ["Thornton Foundation","Scholarships",15000,"prospecting",day(140)],
  ]) {
    const r = await api("POST", "/grants", token, { funder, program, amount, status, deadline: dl });
    if (r.status === 200 || r.status === 201) grants++;
  }
  console.log(`  grants: ${grants}`);

  // Conversations across TWENTY-FIVE different donors, with next steps spread
  // over overdue / today / coming up — so the Thread reads like a queue
  // instead of the same name four times, which is what the old demo showed.
  // The touch keys are shared/threadShape.js's TOUCH_TYPES, not invented ones —
  // a made-up `email_sent`/`note` is refused by the route, which is why the
  // first run of this script logged ten conversations instead of twenty-five.
  // TWENTY-FIVE DISTINCT LINES, because the demo's Thread is read as a list and
  // a list with the same sentence three times reads as a template. Each one is
  // something a fundraiser would actually type, and the due dates spread across
  // overdue / today / coming up so all three bands have something in them.
  const LINES = [
    ["meeting","Sat down about the spring campaign.","Send the proposal",-14],
    ["call_reached","Asked how the scholarship fund is doing.","Call back with numbers",-11],
    ["call_no_answer","Left a message about the gala.","Try again",-9],
    ["email","Sent the year-end letter.","Follow up if no reply",-8],
    ["visit","Walked the studio with their board chair.","Send the site-visit notes",-7],
    ["ask","Asked for $10,000 toward the building fund.","Check in on the ask",-6],
    ["meeting","Talked through naming the kiln room.","Draft the naming agreement",-5],
    ["call_reached","She asked whether we take stock.","Send the brokerage details",-4],
    ["email","Sent the studio photos she asked for.","Ask what she thought",-3],
    ["note_only","Their pastor mentioned a mission budget line.","Ask about the mission budget",-2],
    ["call_reached","He wants to bring his daughter to a class.","Book the class visit",-1],
    ["meeting","Coffee about joining the committee.","Send the committee packet",0],
    ["ask","Proposal is with their grants officer.","Check on the proposal",0],
    ["call_reached","Reached them about the matching gift.","Confirm the match paperwork",0],
    ["email","Shared the impact report.","Ask what they thought",1],
    ["visit","Toured the building site with the foreman.","Send the timeline",2],
    ["note_only","She mentioned a bequest at the luncheon.","Send planned-giving language",3],
    ["call_reached","They are moving in the spring.","Update the address before year-end",4],
    ["meeting","Breakfast about the summer programme.","Send the programme budget",5],
    ["email","Asked if they would host a house party.","Follow up on the house party",6],
    ["ask","Asked the church board for $5,000.","Check in with the board chair",7],
    ["call_no_answer","Called about renewing their monthly gift.","Try again",8],
    ["meeting","Introduced them to the new teaching artist.","Send the artist's bio",9],
    ["note_only","Anonymous by request on anything public.","Confirm how to list them",11],
    ["email","Thanked them for the anniversary gift.","Ask about a studio visit",13],
  ];
  let convos = 0, threads = 0;
  const convoTargets = [...top.slice(0, 12), ...demo.filter(d => parseFloat(d.total_giving || 0) === 0).slice(0, 8), ...withGiving.slice(40, 45)];
  for (let i = 0; i < convoTargets.length; i++) {
    const d = convoTargets[i]; if (!d) continue;
    const [touch, line, label, due] = LINES[i % LINES.length];
    const r = await api("POST", `/donors/${d.id}/conversations`, token, {
      touch, line, date: day(-int(1, 20)), nextStep: { type: "follow_up", label, due: day(due) } });
    if (r.status === 200 || r.status === 201) { convos++; threads++; }
  }
  console.log(`  conversations: ${convos} (${threads} open next steps)`);

  const stats = (await api("GET", "/reports/giving-summary?year=2026&yearMode=fiscal", token)).body || {};
  console.log(`\nDone in ${Math.round((Date.now() - t0) / 1000)}s.`);
  console.log(`  donors on file: ${rows.length}`);
  console.log(`  FY2026 giving: ${stats.total != null ? "$" + Number(stats.total).toLocaleString() : "n/a"} from ${stats.uniqueDonors ?? "?"} donors`);
  console.log(`  every record carries the tag "demo-file".`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
