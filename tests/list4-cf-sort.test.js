// tests/list4-cf-sort.test.js · LIST-4. THE DONORS LIST SORTS BY ANY CUSTOM FIELD.
//
//   §1  a Number field ("Wealth Score") sorts numerically both ways (10 above 5),
//       blanks last both ways
//   §2  a 1-to-5 Select sorts in the field's own option order both ways, never
//       alphabetically, blanks last both ways
//   §3  a saved view keeps a custom field sort, and its column says it sorts;
//       a multi-select says it can't, and its sort is refused with a sentence
//   §4  another org's field key is refused: on the list (400, with a sentence)
//       and on a saved view (400, nothing saved)
//   §5  W-2: a filter on a custom Number field answers (it was a 500 on main:
//       the "?" in its pattern was read as an argument)
//
// HOW IT GOES RED (planted and watched red before trusting the green):
//   - the select sorted alphabetically by label: in server/donors/cfSort.js make
//     the select case `return \`NULLIF(lower(trim(${val})),'') ${d} NULLS LAST, donors.id\`;`
//     → §2's two order checks go red (Five, Four, One, Three, Two)
//   - run against main: §1–§4 go red (header not sortable, the sort ignored,
//     the view's cf: sort dropped) and §5 is a 500
//
// Standard scratch stack (tests/README.md). Never reaches the network. Reads no
// clock: nothing here depends on a date.
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, q, closeDb } = require("./helpers");

const ORG = "org_list4t", RIVAL = "org_list4t_rival";
const P = k => `d_l4t_${k}`;
const ADMIN = `u_${ORG}_admin`;

async function reset() {
  for (const org of [ORG, RIVAL]) for (const t of ["donor_list_views", "donor_list_layouts", "custom_field_defs", "donors"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
  for (const [id, name, slug] of [[ORG, "List Four Test", "list-four-test"], [RIVAL, "List Four Rival", "list-four-rival"]])
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,'active','team') ON CONFLICT (id) DO NOTHING`, [id, name, slug]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Wren Admin','admin')
           ON CONFLICT (id) DO UPDATE SET password_hash=EXCLUDED.password_hash, role='admin'`,
    [ADMIN, ORG, `admin@${ORG}.test`, bcrypt.hashSync("loadtest1234", 10)]);
  const def = (org, key, label, type, options = []) => q(`INSERT INTO custom_field_defs (id,org_id,entity,key,label,type,options,created_by,created_by_name)
      VALUES ($1,$2,'donor',$3,$4,$5,$6::jsonb,$7,'Wren Admin')`, [`cfd_${org}_${key}`, org, key, label, type, JSON.stringify(options), ADMIN]);
  await def(ORG, "wealth_score_cf", "Wealth Score", "number");
  // A 1-to-5 select whose words sort differently from their order: alphabetically it reads Five, Four, One, Three, Two.
  await def(ORG, "capacity", "Capacity", "select", ["One", "Two", "Three", "Four", "Five"]);
  await def(ORG, "interests", "Interests", "multi_select", ["Music", "Film"]);
  await def(RIVAL, "rival_score", "Rival score", "number");
  // Made-up people.
  const people = [["juno", "Juno Ferris", { wealth_score_cf: 5, capacity: "Five" }], ["pell", "Pell Arbor", { wealth_score_cf: 2, capacity: "Two" }],
    ["odo", "Odo Vance", { wealth_score_cf: 4, capacity: "Four", interests: ["Film"] }], ["ash", "Ash Lindqvist", { wealth_score_cf: 1, capacity: "One" }],
    ["bly", "Bly Okafor", {}], ["cato", "Cato Merriweather", { wealth_score_cf: 3, capacity: "Three" }],
    ["dov", "Dov Ellery", { wealth_score_cf: 10 }], ["esme", "Esme Quarrel", { capacity: "" }]];
  for (const [k, name, cf] of people)
    await q(`INSERT INTO donors (id,org_id,name,email,kind,stage,custom_fields,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,'individual','cultivate',$5::jsonb,$6,'Wren Admin')`, [P(k), ORG, name, `${k}@list4.test`, JSON.stringify(cf), ADMIN]);
}
const call = async (tok, method, p, body) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { json = null; }
  return { status: r.status, body: json || {} };
};
const list = (tok, sort, dir, extra = "") => call(tok, "GET", `/donors?limit=50&sort=${encodeURIComponent(sort)}&dir=${dir}&cols=name,${encodeURIComponent(sort)}${extra}`);
const keys = r => (r.body.donors || []).map(d => d.id.replace("d_l4t_", ""));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  console.log("LIST-4: the Donors list sorts by any custom field\n");
  await reset();
  const tok = (await (await fetch(BASE + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `admin@${ORG}.test`, password: "loadtest1234" }) })).json()).token;
  ok("signs in", !!tok);

  // §1 the Number field
  const nDesc = await list(tok, "cf:wealth_score_cf", "desc"), nAsc = await list(tok, "cf:wealth_score_cf", "asc");
  ok("§1 Wealth Score high to low (10 above 5), blanks last", nDesc.status === 200 && same(keys(nDesc), ["dov", "juno", "odo", "cato", "pell", "ash", "bly", "esme"]), keys(nDesc));
  ok("§1 Wealth Score low to high, blanks still last", nAsc.status === 200 && same(keys(nAsc), ["ash", "pell", "cato", "odo", "juno", "dov", "bly", "esme"]), keys(nAsc));

  // §2 the 1-to-5 select, in its own option order (Bly has no value, Esme an empty one: both last)
  const sAsc = await list(tok, "cf:capacity", "asc"), sDesc = await list(tok, "cf:capacity", "desc");
  ok("§2 Capacity ascending is One, Two, Three, Four, Five", sAsc.status === 200 && same(keys(sAsc).slice(0, 5), ["ash", "pell", "cato", "odo", "juno"]), keys(sAsc));
  ok("§2 Capacity ascending puts the blanks last", same(keys(sAsc).slice(5).sort(), ["bly", "dov", "esme"]), keys(sAsc));
  ok("§2 Capacity descending is Five, Four, Three, Two, One", sDesc.status === 200 && same(keys(sDesc).slice(0, 5), ["juno", "odo", "cato", "pell", "ash"]), keys(sDesc));
  ok("§2 Capacity descending still puts the blanks last", same(keys(sDesc).slice(5).sort(), ["bly", "dov", "esme"]), keys(sDesc));

  // §3 the column says it sorts; a saved view keeps the sort
  const setup = await call(tok, "GET", "/donors/list-setup");
  const fld = k => (setup.body.fields || []).find(f => f.key === k) || {};
  ok("§3 the Number and Select columns say they sort", fld("cf:wealth_score_cf").sortable === true && fld("cf:capacity").sortable === true, [fld("cf:wealth_score_cf"), fld("cf:capacity")]);
  ok("§3 the multi-select says it can't, in a sentence", fld("cf:interests").sortable === false && /more than one choice/.test(fld("cf:interests").sortNote || ""), fld("cf:interests"));
  const ms = await list(tok, "cf:interests", "asc");
  ok("§3 a multi-select sort is refused with a sentence", ms.status === 400 && /more than one choice/.test(ms.body.sentence || ""), ms);
  const v = await call(tok, "POST", "/donors/list-views", { name: "By capacity", columns: ["name", "cf:capacity"], sort: "cf:capacity", sortDir: "desc" });
  const kept = (await call(tok, "GET", "/donors/list-setup")).body.views.find(x => x.name === "By capacity") || {};
  ok("§3 a saved view keeps the custom field sort and its direction", v.status === 200 && kept.sort === "cf:capacity" && kept.sortDir === "desc", { v, kept });

  // §4 another org's key
  const rival = await list(tok, "cf:rival_score", "desc");
  ok("§4 another org's field key is refused on the list, with a sentence", rival.status === 400 && /isn't one of your custom fields/.test(rival.body.sentence || ""), rival);
  const rv = await call(tok, "POST", "/donors/list-views", { name: "Rival", columns: ["name"], sort: "cf:rival_score", sortDir: "asc" });
  const [{ n }] = await q(`SELECT COUNT(*)::int AS n FROM donor_list_views WHERE org_id=$1 AND name='Rival'`, [ORG]);
  ok("§4 another org's field key is refused on a saved view, and nothing is saved", rv.status === 400 && n === 0, { rv, n });
  const odd = await list(tok, "cf:wealth_score_cf'; DROP TABLE donors; --", "asc");
  ok("§4 a key that isn't a field's shape is refused, never written into SQL", odd.status === 400, odd);

  // §5 W-2: the Number field's filter
  const where = encodeURIComponent(JSON.stringify({ join: "and", conditions: [{ field: "cf:wealth_score_cf", op: "gte", value: "4" }] }));
  const f = await call(tok, "GET", `/donors?limit=50&where=${where}&sort=cf:wealth_score_cf&dir=desc`);
  ok("§5 Wealth Score at least 4 answers, high to low", f.status === 200 && same(keys(f), ["dov", "juno", "odo"]), { status: f.status, keys: keys(f) });

  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
