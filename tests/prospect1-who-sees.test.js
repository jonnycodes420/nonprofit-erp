// tests/prospect1-who-sees.test.js · PROSPECT-1, Test 2. SCREENING RESULTS
// STAY WITH THE PEOPLE ALLOWED TO SEE THEM, AND LEAVE WITH THE PERSON.
//
// A screening provider's ranges about a donor are the most sensitive thing
// Steward holds about them. They are for admins and staff with the major gifts
// permission, and nobody else.
//   §1  a staff member WITHOUT the permission gets a refusal from every route
//       that carries them (Room to give, the Donors column, the screening
//       file both ways, the public filing, the prospect brief, the eighth Ask
//       why question and its rows), never sees the question offered, never
//       sees the brief among the person's files, and nothing they CAN open
//       (the profile, the scores, the status line, the files) carries the
//       provider's name or a capacity figure
//   §2  the same staff member, once an admin gives the permission, sees it;
//       and loses it again the moment it is taken away (read live, not from
//       the sign-in token)
//   §3  the donor's own portal page never carries it
//   §4  the default CSV export never carries it; an admin's export with the
//       checkbox does and says so in its headers; a non-admin cannot ask
//   §5  the person export carries it (a donor's request covers it) and
//       erasing the person removes every screening row and the brief
//
// HOW IT WOULD GO RED. Drop `mg` from any route in routes/prospect.js (§1),
// read the permission from the JWT instead of the live row (§2), or let
// /donors/export/csv add the columns by default (§4). Planted: making canSee
// return true for every role turned twenty checks red.
//
// Standard scratch stack (tests/README.md). Never reaches the network.
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { BASE, ok, summary, q, closeDb } = require("./helpers");

const ORG = "org_pr1t2";
const SLUG = "prospect-two-test";
const D = "d_pr1t2_rosa";
const PROVIDER = "Quillfeather Screening";
const MARK = ["Quillfeather", "$75,000", "75,000", "7500000", "Capacity range"];

async function reset() {
  for (const t of ["screening_results", "screening_imports", "public_filings", "donor_materials", "portal_sessions", "portal_settings", "interactions", "threads", "gifts", "donor_scores"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM donors WHERE org_id=$1`, [ORG]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Prospect Two Test',$2,1,'active','team') ON CONFLICT (id) DO NOTHING`, [ORG, SLUG]);
  const hash = bcrypt.hashSync("loadtest1234", 10);
  for (const [id, role] of [["admin", "admin"], ["staff", "member"]]) {
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,can_major_gifts) VALUES ($1,$2,$3,$4,$5,$6,false)
             ON CONFLICT (id) DO UPDATE SET password_hash=EXCLUDED.password_hash, role=EXCLUDED.role, can_major_gifts=false`,
      [`u_${ORG}_${id}`, ORG, `${id}@${ORG}.test`, hash, id === "admin" ? "Ada Admin" : "Sam Staff", role]);
  }
  await q(`INSERT INTO donors (id,org_id,name,email,address,city,state,zip,kind,funder_ein,stage,created_by,created_by_name)
           VALUES ($1,$2,'Rosa Delgado','rosa@pr1t2.test','4 Pier Rd','Portland','ME','04101','individual',NULL,'prospect','u_${ORG}_admin','Ada Admin')`, [D, ORG]);
  for (const [i, amt] of [[1, 100], [2, 120], [3, 900]])
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,payment_method,created_by,created_by_name) VALUES ($1,$2,$3,$4,(CURRENT_DATE - $5::int)::text,'check','Check',$6,'Ada Admin')`,
      [`g_pr1t2_${i}`, ORG, D, amt, i * 100, `u_${ORG}_admin`]);
  await q(`INSERT INTO donors (id,org_id,name,kind,funder_ein,created_by,created_by_name) VALUES ($1,$2,'Halvorsen Family Foundation','organisation','271000101',$3,'Ada Admin')`,
    [`${D}_fdn`, ORG, `u_${ORG}_admin`]);
}
async function token(who) {
  const r = await fetch(BASE + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `${who}@${ORG}.test`, password: "loadtest1234" }) });
  return (await r.json()).token;
}
const call = async (tok, method, p, body, extra = {}) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}), ...extra }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { json = null; }
  return { status: r.status, text, body: json || {} };
};
const carries = t => MARK.some(m => String(t).includes(m));

(async () => {
  console.log("PROSPECT-1 Test 2: screening results stay with the people allowed to see them\n");
  await reset();
  const admin = await token("admin"), staff = await token("staff");
  ok("both sign in", !!admin && !!staff);

  // The admin brings in a screening file for Rosa, looks up the foundation's
  // filing and writes Rosa's brief.
  const csv = `Steward ID,Capacity Range,Real Estate Value,Business Affiliations\n${D},"$75,000 - $150,000","$900,000 - $1,200,000",Delgado Boatworks (owner)\n`;
  const pv = await call(admin, "POST", "/screening/import/preview", { csv });
  const mapping = Object.fromEntries(Object.entries(pv.body.proposal || {}).map(([h, v]) => [h, v.replace(/^std:/, "")]));
  const im = await call(admin, "POST", "/screening/import", { csv, mapping, provider: PROVIDER, screenedOn: "2026-09-30" });
  ok("the admin brings in Rosa's screening result", im.status === 200 && im.body.matched === 1, im.body);
  // FIX-22: the filing comes from the IRS EO BMF in irs_bmf, never the network.
  // Empty first: the answer says the file is not loaded, and records nothing.
  await q(`DELETE FROM irs_bmf`);
  const nl = await call(admin, "POST", `/donors/${D}_fdn/public-filing/refresh`);
  ok("FIX-22 with no IRS file loaded, the lookup says so plainly and writes nothing",
    nl.status === 200 && nl.body.notLoaded === true && /IRS file .* has not been loaded/.test(nl.body.message) && !nl.body.filing
      && (await q(`SELECT 1 FROM public_filings WHERE org_id=$1`, [ORG])).length === 0, nl.body);
  // Then the fixture, through the loader's own load(): made-up rows in the BMF's columns.
  const { Client } = require("pg");
  const pgc = new Client({ connectionString: process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest", ssl: process.env.DB_SSL === "disable" ? false : { rejectUnauthorized: false } });
  await pgc.connect();
  const loaded = await require("../scripts/load-irs-bmf").load(pgc, { sources: [{ file: require("path").join(__dirname, "fixtures", "irs-bmf", "eo_fixture.csv") }], date: "2026-09-07" });
  await pgc.end();
  const [quoted] = await q(`SELECT name FROM irs_bmf WHERE ein='271000103'`);
  ok("FIX-22 the loader reads every fixture row, a quoted name with a comma whole", loaded[0].rows === 3 && quoted && quoted.name === "BRAMBLEWICK, PELL AND OARSMAN FUND", { loaded, quoted });
  const fl = await call(admin, "POST", `/donors/${D}_fdn/public-filing/refresh`);
  const SRC = "IRS, Exempt Organizations Business Master File, September 2026";
  ok("the admin looks up the foundation's filing (from the IRS file in irs_bmf, never the network)", fl.status === 200 && fl.body.filing && fl.body.filing.taxYear === 2023, fl.body);
  ok("FIX-22 it shows assets, revenue and the last filing year, to the cent, under the IRS source line",
    fl.body.filing && fl.body.filing.totalAssetsCents === 482500000 && fl.body.filing.revenueCents === 59840000 && fl.body.filing.source === SRC
      && /irs\.gov/.test(fl.body.filing.sourceUrl) && !/propublica/i.test(JSON.stringify(fl.body)), fl.body.filing);
  const fg = await call(admin, "GET", `/donors/${D}_fdn/public-filing`);
  ok("FIX-22 the page's read returns the same filing and calls nothing", fg.status === 200 && fg.body.filing && fg.body.filing.source === SRC && fg.body.filing.totalAssetsCents === 482500000, fg.body);
  const fb = await call(admin, "POST", `/donors/${D}_fdn/prospect-brief`);
  ok("FIX-22 the foundation's brief cites the IRS file for its assets and lists grants paid as not known",
    fb.status === 201 && fb.body.brief.lines.some(l => l.section === "Public filing" && /Total assets: \$4,825,000/.test(l.text) && l.source.startsWith(SRC))
      && fb.body.brief.notKnown.some(t => /Grants paid/.test(t)), fb.body.brief && fb.body.brief.lines.filter(l => l.section === "Public filing"));
  const br = await call(admin, "POST", `/donors/${D}/prospect-brief`);
  ok("the admin's brief is written, saved, and carries the screening line with its source",
    br.status === 201 && br.body.brief.lines.some(l => /Capacity range from the screening file/.test(l.text) && new RegExp(PROVIDER).test(l.source)), br.status);
  ok("the brief names what it does not know", br.status === 201 && br.body.brief.notKnown.length > 0);

  // §1 ─────────────────────────────────────────────────────────────────────
  const refused = [
    ["GET", `/donors/${D}/room-to-give`], ["GET", "/prospects/room-to-give"],
    ["POST", "/screening/preview", { donorIds: [D] }], ["POST", "/screening/file", { donorIds: [D] }],
    ["POST", "/screening/import/preview", { csv }], ["POST", "/screening/import", { csv, mapping, provider: "X", screenedOn: "2026-09-30" }],
    ["DELETE", `/donors/${D}/screening`], ["GET", `/donors/${D}_fdn/public-filing`], ["POST", `/donors/${D}_fdn/public-filing/refresh`],
    ["POST", `/donors/${D}/prospect-brief`], ["POST", "/why/ask", { key: "more" }], ["POST", "/why/ask", { text: "Who could give more?" }],
    ["GET", "/figures/why/rows?q=more&part=strong"], ["DELETE", "/screening"],
  ];
  for (const [m, p, b] of refused) {
    const r = await call(staff, m, p, b);
    ok(`§1 without the permission: ${m} ${p} is refused and carries nothing`, r.status === 403 && !carries(r.text), { status: r.status, text: r.text.slice(0, 160) });
  }
  const qs = await call(staff, "GET", "/why/questions");
  ok("§1 the eighth question is not offered to them", qs.status === 200 && !qs.body.taps.some(t => t.key === "more") && !qs.body.all.some(t => t.key === "more"));
  const mats = await call(staff, "GET", `/donors/${D}/materials`);
  ok("§1 the brief is not among Rosa's files for them", mats.status === 200 && Array.isArray(mats.body) && mats.body.length === 0, mats.body);
  for (const p of [`/donors/${D}`, `/donors/${D}/scores`, `/donors/${D}/status`, `/donors/${D}/materials`, "/donors?search=Rosa", "/me"]) {
    const r = await call(staff, "GET", p);
    ok(`§1 ${p} opens for them and carries no screening result`, r.status === 200 && !carries(r.text), { status: r.status, hit: MARK.filter(m => r.text.includes(m)) });
  }
  ok("§1 their /me says they cannot", (await call(staff, "GET", "/me")).body.user.canMajorGifts === false);

  // §2 ─────────────────────────────────────────────────────────────────────
  const notAdmin = await call(staff, "PUT", `/org/users/u_${ORG}_staff/major-gifts`, { on: true });
  ok("§2 a staff member cannot give themselves the permission", notAdmin.status === 403);
  await call(admin, "PUT", `/org/users/u_${ORG}_staff/major-gifts`, { on: true });
  const now = await call(staff, "GET", `/donors/${D}/room-to-give`);
  ok("§2 once an admin gives it, the same session sees Room to give with the provider", now.status === 200 && now.body.screening && now.body.screening.provider === PROVIDER, now.status);
  ok("§2 and the brief appears among the files", (await call(staff, "GET", `/donors/${D}/materials`)).body.length === 1);
  await call(admin, "PUT", `/org/users/u_${ORG}_staff/major-gifts`, { on: false });
  ok("§2 taken away, it is refused on the very next request", (await call(staff, "GET", `/donors/${D}/room-to-give`)).status === 403);

  // §3 ─────────────────────────────────────────────────────────────────────
  await q(`INSERT INTO portal_settings (org_id,enabled,network_listed) VALUES ($1,true,false) ON CONFLICT (org_id) DO UPDATE SET enabled=true`, [ORG]);
  const raw = crypto.randomBytes(24).toString("hex");
  await q(`INSERT INTO portal_sessions (id,org_id,email,token_hash,expires_at) VALUES ($1,$2,'rosa@pr1t2.test',$3,NOW()+INTERVAL '1 hour')`,
    [`ps_${ORG}`, ORG, crypto.createHash("sha256").update(raw).digest("hex")]);
  const portal = await call(null, "GET", `/portal/${SLUG}/me`, null, { Cookie: `steward_portal=${encodeURIComponent(raw)}` });
  ok("§3 Rosa's own portal page opens", portal.status === 200, { status: portal.status, text: portal.text.slice(0, 120) });
  ok("§3 and carries no screening result", !carries(portal.text) && !/screening/i.test(portal.text));

  // §4 ─────────────────────────────────────────────────────────────────────
  const def = await call(admin, "GET", "/donors/export/csv");
  ok("§4 the default CSV export carries no screening result", def.status === 200 && /Rosa Delgado/.test(def.text) && !carries(def.text) && !/Screening/.test(def.text));
  const withS = await call(admin, "GET", "/donors/export/csv?includeScreening=1");
  ok("§4 an admin's export with the checkbox adds the provider, date and ranges, named in the headers",
    withS.status === 200 && /Screening provider,Screening date,Capacity range,Real estate range/.test(withS.text) && withS.text.includes(PROVIDER) && withS.text.includes("$75,000 to $150,000"));
  await call(admin, "PUT", `/org/users/u_${ORG}_staff/major-gifts`, { on: true });
  const staffWith = await call(staff, "GET", "/donors/export/csv?includeScreening=1");
  ok("§4 a non-admin cannot ask for it, even with the permission", staffWith.status === 403 && !carries(staffWith.text));
  await call(admin, "PUT", `/org/users/u_${ORG}_staff/major-gifts`, { on: false });

  // §5 ─────────────────────────────────────────────────────────────────────
  const ex = await call(admin, "GET", `/donors/${D}/export-data`);
  ok("§5 the person export carries their screening result, with provider and date",
    ex.status === 200 && Array.isArray(ex.body.screeningResults) && ex.body.screeningResults[0].provider === PROVIDER && ex.body.screeningResults[0].screened_on === "2026-09-30");
  const er = await call(admin, "POST", `/donors/${D}/erase`, { confirm: "ERASE" });
  ok("§5 the person is erased", er.status === 200, er.body);
  const [{ s, m }] = await q(`SELECT (SELECT COUNT(*) FROM screening_results WHERE org_id=$1 AND donor_id=$2)::int AS s,
                                    (SELECT COUNT(*) FROM donor_materials WHERE org_id=$1 AND donor_id=$2)::int AS m`, [ORG, D]);
  ok("§5 erasing removes every screening row and the brief", s === 0 && m === 0, { s, m });
  ok("§5 the erased record carries nothing for an admin either", !carries((await call(admin, "GET", `/donors/${D}`)).text));

  await reset();
  await q(`DELETE FROM donors WHERE org_id=$1`, [ORG]).catch(() => {});
  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
