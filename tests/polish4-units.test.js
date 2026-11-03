// tests/polish4-units.test.js: POLISH-4. RE-ENGAGE TELLS THE TRUTH ABOUT PEOPLE
// AND THE BUSINESSES THEY GIVE THROUGH, TWO RECORDS MERGE BY HAND, AND EVERY
// GREETING IS ONE RULE. Guards donor data (who is called lapsed and asked to
// come back, a merge and its Undo) and email (what a draft calls somebody).
//
//   §1 greetings (pure): the shapes that went wrong ("Dear Dr.,", "Hi &,",
//      "Hi K,", a business name as a first name) and every name in the
//      real-shaped and messy fixtures: none opens with a title alone, a bare
//      "&", an initial or a word with a digit; "Hello," only with no name.
//   §2 a pledger whose stored stage is Lapsed (set by an officer) is off
//      Re-engage: the badge (/donors/counts reengage) and the list's rows
//      (/donors/summaries reengage) both leave them out; an automatic Lapsed
//      clears itself when the pledge arrives.
//   §3 a business and its owner are one giving unit: the business is on
//      Re-engage, its owner (linked as Owner · Gives through) gives, and it
//      leaves; each profile shows the other with its giving; money stays with
//      whoever gave it; the truth check holds.
//   §4 the link suggestion (Data health, people and their businesses) fires
//      on a shared email domain and on last name + address, never on a last
//      name alone; one click links them, and Undo takes the link back.
//   §5 merge by hand: "Kathy Crossfield" into "Katherine Crossfield"; gifts
//      and lifetime combine, the truth check holds, Undo restores both. The
//      profile's More menu and the Directory offer it (client source).
//
// HOW IT GOES RED ON MAIN (cdf9a7f): §1 "Dear Dr.," from a title salutation,
// "Hi K," and "Hi Redshaw,"; greetingLine does not exist. §2 the badge counts
// the officer's Lapsed stage; summaries carry no reengage. §3 "owner" is not a
// relationship type (400), so the business stays Lapsed. §4 no endpoint (404).
// §5 nothing on the profile or in the Directory opens a merge.
//
// Standard scratch stack (tests/README.md). Sends nothing. Made-up people only.
"use strict";
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, waitFor } = require("./helpers");
const { assertSurfacesAgree } = require("./lib/surfacesAgree");
const { testNow } = require("./clock");

const PASSWORD = "loadtest1234";
const ORG = "org_polish4_units";
const P = s => `${ORG}_${s}`;
const day = n => new Date(testNow() - n * 86400000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

async function freshOrg(id, name) {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 5; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [id]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [id]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,$2,$3,1,'active','team','America/New_York')`, [id, name, id.replace(/_/g, "-")]);
  const email = `${id}@test.local`;
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Allie Test','admin')`, ["u_" + id, id, email, bcrypt.hashSync(PASSWORD, 4)]);
  return login(email, PASSWORD);
}
const person = (id, name, extra = {}) => q(
  `INSERT INTO donors (id,org_id,name,kind,email,phone,address,city,state,zip,stage,created_by,created_by_name,created_at,updated_at)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'system:test/polish4','POLISH-4 test',NOW()-INTERVAL '3 years',NOW()-INTERVAL '3 years')`,
  [P(id), ORG, name, extra.kind || "person", extra.email || null, extra.phone || null, extra.address || null,
   extra.address ? "Portland" : null, extra.address ? "ME" : null, extra.address ? "04101" : null, extra.stage || "steward"]);
const gift = (tok, id, amount, date) => api("POST", `/donors/${P(id)}/gifts`, tok, { amount, date, type: "one-time", payment_method: "check" });
const counts = async tok => (await api("GET", "/donors/counts", tok)).body;
async function summaries(tok) {
  const out = [];
  for (let off = 0; ; off += 500) {
    const r = await api("GET", `/donors/summaries?limit=500&offset=${off}`, tok);
    out.push(...r.body);
    if (r.body.length < 500) break;
  }
  return new Map(out.map(d => [d.id, d]));
}
async function surfacesAgree(label, tok) {
  const r = await assertSurfacesAgree(ORG, { token: tok, soft: true, label });
  ok(`every surface agrees ${label} (${r.ms}ms)`, r.ok, r.diffs.join(" | "));
}

async function greetings() {
  const { greetingName, greetingLine } = await import("../shared/greeting.js");
  const L = (p, word = "Hi") => greetingLine(typeof p === "string" ? { name: p } : p, { word });
  const table = [
    [{ name: "Eugene Ramirez", salutation: "Dr." }, "Dear Dr. Ramirez,"],
    ["Dr. Eugene Ramirez", "Dear Dr. Ramirez,"],
    ["Dr.", "Hello,"],
    ["& Ruth Okafor", "Hi Ruth,"],
    ["&", "Hello,"],
    ["K", "Hello,"],
    ["K Valon Lane", "Hi Valon,"],
    ["K. Lane", "Dear K. Lane,"],
    ["Redshaw Holville Wine Spirits", "Dear friends at Redshaw Holville Wine Spirits,"],
    ["Corman Excavating, Inc", "Dear friends at Corman Excavating, Inc,"],
    ["Ellen Church", "Hi Ellen,"],
    ["Desmond & Ruth Okafor", "Hi Desmond and Ruth,"],
    ["Mr. and Mrs. Okafor", "Dear Mr. and Mrs. Okafor,"],
    ["Smith, John", "Hi John,"],
    ["J. Robert Smith Jr.", "Hi Robert,"],
    ["Ivoin. Milina Rosville", "Hi Ivoin,"],
    ["Birchfield5", "Hello,"],
    ["", "Hello,"],
    [{ name: "CMC, Inc", kind: "organization", contactName: "Lee Varno" }, "Hi Lee,"],
  ];
  const wrong = table.map(([p, want]) => [p, want, L(p)]).filter(([, want, got]) => want !== got);
  ok("§1 every hard name shape opens the way it should", !wrong.length, JSON.stringify(wrong));
  ok("§1 a Dear letter to a title salutation reads the title and the last name, never \"Dear Dr.,\"",
     L({ name: "Eugene Ramirez", salutation: "Dr." }, "Dear") === "Dear Dr. Ramirez," && greetingName({ name: "Eugene Ramirez", salutation: "Dr." }) === "Dr. Ramirez");

  // every name in the real-shaped and messy fixtures
  const XLSX = require(path.join(__dirname, "..", "client", "node_modules", "xlsx"));
  const roots = ["real-shaped", "messy", "people-shapes"].map(r => path.join(__dirname, "fixtures", "import", r)).filter(r => fs.existsSync(r));
  const names = new Set();
  for (const r of roots) for (const f of fs.readdirSync(r)) {
    if (!/\.(xlsx|xls|csv|tsv)$/.test(f)) continue;
    const wb = XLSX.readFile(path.join(r, f), { raw: false });
    for (const sn of wb.SheetNames) for (const row of XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: "" })) {
      const k = Object.keys(row);
      const full = k.find(x => /^(name|full name|donor|donor name|constituent( name)?|account name|contact( name)?|guest|guest name|organization|company|payer|from|addressee)$/i.test(x.trim()));
      const fn = k.find(x => /^first( name)?$/i.test(x.trim())), ln = k.find(x => /^last( name)?$/i.test(x.trim()));
      if (full && String(row[full]).trim()) names.add(String(row[full]).trim());
      if (fn && ln && String(row[fn] || row[ln]).trim()) names.add(`${row[fn]} ${row[ln]}`.trim());
    }
  }
  const bad = [];
  for (const n of names) {
    for (const word of ["Hi", "Dear"]) {
      const g = L(n, word);
      if (/^(Dear|Hi) ((mr|mrs|ms|mx|dr|rev|prof)\.?|[&+]|[A-Za-z]\.?),$/i.test(g) || /^(Dear|Hi) ,/.test(g) || (/\d/.test(g) && !/^Dear friends at /.test(g)) || / there,$/.test(g)) bad.push([n, g]);
    }
  }
  ok(`§1 none of the ${names.size} fixture names opens with a title alone, a bare "&", an initial or a digit`, names.size > 500 && !bad.length, JSON.stringify(bad.slice(0, 8)));
}

async function main() {
  await greetings().catch(e => ok("§1 the greeting rules run", false, e.message));
  const tok = await freshOrg(ORG, "POLISH-4 units (test)");

  // ── §2 a pledger an officer marked Lapsed ───────────────────────────────
  await person("lena", "Lena Vashby");
  await gift(tok, "lena", 400, day(800));
  await q(`UPDATE donors SET stage='lapsed' WHERE id=$1`, [P("lena")]);
  await q(`INSERT INTO moves (id,org_id,donor_id,officer_id,officer_name,from_stage,to_stage,description,created_at) VALUES ($1,$2,$3,$4,'Allie Test','steward','lapsed','Moved by hand',NOW())`,
    [P("mv_lena"), ORG, P("lena"), "u_" + ORG]).catch(e => ok("§2 an officer's move to Lapsed is on file", false, e.message));
  await person("omar", "Omar Pellish");   // Steward placed him in Lapsed
  await gift(tok, "omar", 250, day(700));
  await q(`UPDATE donors SET stage='lapsed' WHERE id=$1`, [P("omar")]);
  await q(`INSERT INTO moves (id,org_id,donor_id,officer_id,officer_name,from_stage,to_stage,description,created_at) VALUES ($1,$2,$3,NULL,'Steward (automatic)','steward','lapsed','Auto: lapsed',NOW())`,
    [P("mv_omar"), ORG, P("omar")]).catch(() => {});
  const before = await counts(tok);
  ok("§2 before the pledges both are on Re-engage", before.reengage === 2, before);
  for (const id of ["lena", "omar"]) {
    const r = await api("POST", `/donors/${P(id)}/pledges`, tok, { amount: 1200, dueDate: day(-200), pledgeDate: day(1) });
    ok(`§2 ${id}'s pledge is recorded`, r.status === 201 || r.status === 200, r.body);
  }
  const after = await counts(tok), sum = await summaries(tok);
  ok("§2 the badge leaves out a pledger, whatever their stored stage says", after.reengage === 0, after);
  ok("§2 the Re-engage list's rows leave them out too", sum.get(P("lena")) && sum.get(P("lena")).reengage === false && sum.get(P("omar")).reengage === false,
     [sum.get(P("lena")), sum.get(P("omar"))].map(d => d && d.reengage));
  // the after-change step runs on the queue (JOBS-1): wait for it, briefly
  await waitFor(async () => (await q(`SELECT stage FROM donors WHERE id=$1`, [P("omar")]))[0].stage === "steward", { timeout: 15000 }).catch(() => null);
  const [lena] = await q(`SELECT stage FROM donors WHERE id=$1`, [P("lena")]), [omar] = await q(`SELECT stage FROM donors WHERE id=$1`, [P("omar")]);
  ok("§2 an automatic Lapsed clears itself when the pledge arrives; an officer's stays as their note", omar.stage === "steward" && lena.stage === "lapsed", [omar.stage, lena.stage]);

  // ── §3 a business and its owner ─────────────────────────────────────────
  await person("pat", "Pat Corvane", { email: "pat@gmail.com" });
  await person("cx", "Corvane Excavating, Inc", { kind: "organization" });
  await gift(tok, "cx", 10500, day(500));
  await gift(tok, "pat", 300, day(900));
  let s3 = await summaries(tok);
  ok("§3 before the link the business is on Re-engage", s3.get(P("cx")).reengage === true && (await counts(tok)).reengage === 2);
  const link = await api("POST", `/donors/${P("cx")}/relationships`, tok, { relatedDonorId: P("pat"), relationshipType: "owner" });
  ok("§3 a business is linked to its owner as Owner · Gives through", link.status === 201, link.body);
  const [stored] = await q(`SELECT donor_id_a, donor_id_b FROM donor_relationships WHERE id=$1`, [link.body && link.body.id]);
  ok("§3 the link is stored person first, from whichever profile it was made", stored && stored.donor_id_a === P("pat") && stored.donor_id_b === P("cx"), stored);
  await gift(tok, "pat", 150, day(10));
  s3 = await summaries(tok);
  const c3 = await counts(tok);
  ok("§3 the owner gives, and the business leaves Re-engage (the badge and the list)", s3.get(P("cx")).reengage === false && c3.reengage === 0, [s3.get(P("cx")).reengage, c3]);
  const tags = await api("GET", `/donors?lifecycle=lapsed&limit=50&offset=0`, tok);
  ok("§3 neither is Lapsed in the Donors list's tags", !(tags.body.donors || []).some(d => [P("cx"), P("pat")].includes(d.id)), (tags.body.donors || []).map(d => d.name));
  const [cxRow] = await q(`SELECT total_giving FROM donors WHERE id=$1`, [P("cx")]), [patRow] = await q(`SELECT total_giving FROM donors WHERE id=$1`, [P("pat")]);
  ok("§3 money stays with whoever gave it: the business $10,500, the owner $450", Number(cxRow.total_giving) === 10500 && Number(patRow.total_giving) === 450, [cxRow, patRow]);
  const relP = (await api("GET", `/donors/${P("pat")}/relationships`, tok)).body.relationships[0];
  const relB = (await api("GET", `/donors/${P("cx")}/relationships`, tok)).body.relationships[0];
  ok("§3 each profile reads the link from its own side, with the other's giving",
     relP && relP.side === "person" && relP.relatedDonorName === "Corvane Excavating, Inc" && relP.relatedDonorTotalGiving === 10500
     && relB && relB.side === "organization" && relB.relatedDonorName === "Pat Corvane", [relP, relB]);
  await surfacesAgree("with a business linked to its owner", tok);

  // ── §4 the suggestions ──────────────────────────────────────────────────
  await person("lee", "Lee Varnott", { email: "lee@cmcenvironment.com" });
  await person("cmc", "CMC, Inc", { kind: "organization" });
  await person("dana", "Dana Morrible", { address: "41 Harbor View Rd" });
  await person("mb", "Morrible Bakery LLC", { kind: "organization", address: "41 Harbor View Road" });
  await person("sam", "Sam Quillon", { address: "9 Elm St" });
  await person("qh", "Quillon Hardware LLC", { kind: "organization", address: "220 Pleasant St" });
  const sg = (await api("GET", "/data-health/businesses?limit=50", tok)).body;
  const has = (a, b) => (sg.rows || []).find(r => r.a === P(a) && r.b === P(b));
  ok("§4 a shared email domain is suggested, with its reason", !!has("lee", "cmc") && /cmcenvironment\.com/.test(has("lee", "cmc").reasons.join(" ")), sg.rows);
  ok("§4 a last name in the business's name and a shared address is suggested", !!has("dana", "mb") && /address/.test(has("dana", "mb").reasons.join(" ")), sg.rows);
  ok("§4 a last name alone is never enough", !has("sam", "qh"), sg.rows);
  ok("§4 a pair already linked is not suggested again", !has("pat", "cx"));
  const health = (await api("GET", "/data-health", tok)).body;
  ok("§4 Data health counts the same suggestions it lists", (health.counts || health).businesses === sg.total, [health.counts && health.counts.businesses, sg.total]);
  const ln = await api("POST", "/data-health/businesses/link", tok, { a: P("dana"), b: P("mb") });
  const linked = await q(`SELECT relationship_type, created_by FROM donor_relationships WHERE id=$1`, [ln.body && ln.body.id]);
  ok("§4 one click links them as Owner, stamped with who did it", ln.status === 201 && linked[0] && linked[0].relationship_type === "owner" && linked[0].created_by === "u_" + ORG, [ln.body, linked]);
  const un = await api("DELETE", `/donor-relationships/${ln.body.id}`, tok);
  const gone = await q(`SELECT 1 FROM donor_relationships WHERE id=$1`, [ln.body.id]);
  ok("§4 Undo takes the link back", un.status === 200 && !gone.length, un.body);

  // ── §5 merge by hand ────────────────────────────────────────────────────
  await person("kathy", "Kathy Crossfield", { email: "kc@example.org" });
  await person("kath", "Katherine Crossfield", { address: "8 Birch Ln" });
  await gift(tok, "kathy", 125, day(40));
  await gift(tok, "kath", 500, day(300));
  await gift(tok, "kath", 75.5, day(20));
  const pair = (await api("GET", `/data-health/pair?a=${P("kath")}&b=${P("kathy")}`, tok)).body;
  ok("§5 the compare screen opens on a pair she chose, with what moves", pair.records && pair.moving && pair.moving[P("kathy")] && pair.moving[P("kathy")]["gifts.donor_id"] === 1, pair.moving);
  const m = await api("POST", "/data-health/merge", tok, { keptId: P("kath"), mergedId: P("kathy"), choices: pair.choices });
  const [kept] = await q(`SELECT total_giving, gift_count, email, deleted_at FROM donors WHERE id=$1`, [P("kath")]);
  const [gone2] = await q(`SELECT deleted_at FROM donors WHERE id=$1`, [P("kathy")]);
  ok("§5 Kathy merges into Katherine: three gifts, $700.50 lifetime, Kathy's email kept, Kathy's record gone",
     m.status === 201 && Number(kept.gift_count) === 3 && Number(kept.total_giving) === 700.5 && kept.email === "kc@example.org" && !!gone2.deleted_at, [m.body && m.body.lifetime, kept]);
  await surfacesAgree("after a hand merge", tok);
  const u = await api("POST", `/data-health/merges/${m.body.mergeId}/undo`, tok);
  const back = await q(`SELECT id, total_giving, gift_count, deleted_at FROM donors WHERE id = ANY($1) ORDER BY id`, [[P("kath"), P("kathy")]]);
  const by = Object.fromEntries(back.map(r => [r.id, r]));
  ok("§5 Undo restores both: Katherine $575.50 in two gifts, Kathy $125 in one",
     u.status === 200 && Number(by[P("kath")].total_giving) === 575.5 && Number(by[P("kath")].gift_count) === 2
     && !by[P("kathy")].deleted_at && Number(by[P("kathy")].total_giving) === 125, [u.body, back]);
  await surfacesAgree("after the merge is undone", tok);
  const src = f => fs.readFileSync(path.join(__dirname, "..", "client", "src", "components", f), "utf8");
  ok("§5 the profile's More menu offers Merge with…, and the Directory offers Merge for two ticked people",
     /\["Merge with…",\(\)=>setMergeOpen\(true\)/.test(src("profile/ProfileHeader.jsx")) && /selFiltered\.length===2&&<button[^>]*dir-merge-two/.test(src("DonorDirectory.jsx")));
}

main().catch(e => { ok("suite ran to the end", false, e.stack); }).finally(async () => { await closeDb(); summary(); });
