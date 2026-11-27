// tests/household1.test.js · HOUSEHOLD-1. A COUPLE IS ONE GIVING UNIT ON EVERY
// LIST, AND EACH PERSON KEEPS THEIR OWN CONTACT DETAILS.
//
// A pilot customer merged couples to see them as one line on her Top 100 and
// lost one person's email, phone and photo each time. This suite guards the
// money and the donor data of the fix:
//   §1  a household on the Top 100 holds one place, and its Lifetime and This
//       year are both people's gifts added to the cent, the same figures as
//       the household panel and Reports' top donors by household; adding the
//       household when one person is listed replaces that place at its rank
//   §2  the Donors list's households view: one row, combined giving, both
//       people under it; the counts say households and people
//   §3  an export of a household reaches both people's own emails, with a
//       household column and the addressee line; collapsed to one row per
//       household address for a mailing; a person whose own preference is No
//       email stays out of an email list
//   §4  the household view: each person's own email and phone, giving by
//       year footing to Lifetime, the shared address
//   §5  logging a touch from the household logs it on both people, one Undo
//   §6  a merge from 10 days ago splits back into two people in one household
//       with every gift where it was; a merge past 30 days says it can't
//   §7  the truth check (assertSurfacesAgree) with a household row on the list
//   §8  SAFE-EDIT-1 (Duet m15): when every member is in the trash the household
//       goes with them (not listed with 0 members), and Restore brings it back
//       with both people in it; one person back is enough to bring it back
//
// SAFE-EDIT-1, red on main: the household stays listed with no live member (§8).
//
// HOW IT GOES RED (planted, see the HOUSEHOLD-1 report): main has no
// household place (§1 400 "Pick at least one person"); summing only the lead
// person's gifts fails §1's footing; the export without the second person
// fails §3; the split without re-making the household fails §4.
//
// Standard scratch stack (tests/README.md). Never sends anything.
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, q, closeDb, api } = require("./helpers");
const { civilDay, dayOffset } = require("./clock");

const ORG = "org_hh1a";
const U = who => `u_${ORG}_${who}`;
const cents = v => Math.round(Number(v || 0) * 100);

async function reset() {
  for (const t of ["portfolio_members", "portfolio_lists", "care_plans", "interactions", "tasks", "gifts", "donor_relationships", "donor_merges", "touch_batches"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`UPDATE donors SET household_id=NULL WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM households WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM donors WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,'Household Test','household-test',1,'active','team','America/New_York') ON CONFLICT (id) DO NOTHING`, [ORG]);
  // POLISH-12: the Top 100 is off unless an org turns it on; this org uses it.
  await q(`UPDATE orgs SET top100_enabled=true WHERE id=$1`, [ORG]);
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,can_major_gifts) VALUES ($1,$2,$3,$4,'Ada Admin','admin',true)
           ON CONFLICT (id) DO UPDATE SET password_hash=EXCLUDED.password_hash, role='admin', can_major_gifts=true, org_id=EXCLUDED.org_id`,
    [U("admin"), ORG, `admin@${ORG}.test`, hash]);
}
async function token() {
  const r = await fetch(BASE + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `admin@${ORG}.test`, password: "loadtest1234" }) });
  return (await r.json()).token;
}
async function person(t, name, email, phone) {
  const r = await api("POST", "/donors", t, { name, email, phone, kind: "individual" });
  return r.body && (r.body.id || (r.body.donor && r.body.donor.id));
}
const gift = (t, id, amount, date) => api("POST", `/donors/${id}/gifts`, t, { amount, date, type: "one-time", payment_method: "check" });
const rowsSum = r => ((r && r.body && r.body.rows) || []).reduce((n, x) => n + cents(x.amount), 0);

(async () => {
  console.log("HOUSEHOLD-1: a couple is one giving unit on every list, and each keeps their own contact details\n");
  await reset();
  const t = await token();
  ok("the admin signs in", !!t);
  const today = civilDay();
  const thisYearDay = dayOffset(-3), lastYearDay = dayOffset(-500);

  // ── §1 a household holds one place on the Top 100 ────────────────────────
  const debbie = await person(t, "Debra Vantongeren", "debra.v@hh1.test", "555-0101");
  const jeff = await person(t, "Geoffrey Vantongeren", "geoff.v@hh1.test", "555-0102");
  const solo = await person(t, "Solace Ombudsman", "solace@hh1.test", "555-0103");
  await gift(t, debbie, 1234.56, thisYearDay); await gift(t, debbie, 500, lastYearDay);
  await gift(t, jeff, 765.44, thisYearDay); await gift(t, jeff, 1000.01, lastYearDay);
  await gift(t, solo, 300, thisYearDay);
  const hh = await api("POST", "/households", t, { name: "The Vantongeren Household", memberIds: [debbie, jeff], primaryDonorId: debbie });
  ok("§1 the couple is one household", hh.status === 201 && hh.body.member_count === 2, JSON.stringify(hh.body).slice(0, 200));
  const hhId = hh.body.id;
  let r = await api("POST", "/top100/members", t, { donorIds: [solo] });
  r = await api("POST", "/top100/members", t, { donorIds: [jeff] });
  ok("§1 adding one of the couple offers the household instead", r.status === 201 && r.body.householdOffer && r.body.householdOffer.householdId === hhId, JSON.stringify(r.body));
  r = await api("POST", "/top100/members", t, { householdIds: [hhId] });
  ok("§1 adding the household: 201", r.status === 201 && r.body.replaced === 1, JSON.stringify(r.body));
  const places = await q(`SELECT donor_id, household_id, rank FROM portfolio_members WHERE org_id=$1 ORDER BY rank`, [ORG]);
  ok("§1 the household took Geoffrey's place at the same rank (#2), and there is no second place for the couple",
    places.length === 2 && places[0].donor_id === solo && places[1].household_id === hhId && places[1].donor_id === null && Number(places[1].rank) === 2, JSON.stringify(places));
  r = await api("POST", "/top100/members", t, { donorIds: [debbie] });
  ok("§1 adding Debra now adds nobody: she is on it through the household", r.status === 201 && r.body.added === 0 && /through their household/.test(r.body.sentence), JSON.stringify(r.body));
  const top = await api("GET", "/top100", t);
  const row = ((top.body && top.body.rows) || []).find(x => x.kind === "household");
  const lifeKey = 123456 + 50000 + 76544 + 100001, yearKey = 123456 + 76544;
  ok("§1 the household's row reads its name and both people", row && row.name === "The Vantongeren Household" && row.people.length === 2, JSON.stringify(row || top.body).slice(0, 300));
  ok("§1 Lifetime is both people's gifts added, to the cent", row && row.lifetimeCents === lifeKey, row && row.lifetimeCents);
  ok("§1 This year is both people's gifts this fiscal year, to the cent", row && row.thisYearCents === yearKey, row && row.thisYearCents);
  if (row) {
    const lifeRows = await api("GET", `/figures/${row.lifetimeSource.key}/rows?${new URLSearchParams(row.lifetimeSource.params)}`, t);
    ok("§1 Lifetime opens its rows and they foot to the cent", lifeRows.status === 200 && rowsSum(lifeRows) === lifeKey, JSON.stringify(lifeRows.body).slice(0, 200));
    const yearRows = await api("GET", `/figures/${row.thisYearSource.key}/rows?${new URLSearchParams(row.thisYearSource.params)}`, t);
    ok("§1 This year opens both people's gifts and they foot to the cent", yearRows.status === 200 && rowsSum(yearRows) === yearKey && yearRows.body.rows.length === 2, JSON.stringify(yearRows.body).slice(0, 200));
    const panel = await api("GET", `/households/${hhId}`, t);
    ok("§1 the household panel's Combined giving is the same figure", cents(panel.body.combined_giving) === row.lifetimeCents, panel.body.combined_giving);
    const { from, to } = row.thisYearSource.params;
    const rep = await api("GET", `/reports/top-donors?scope=period&view=household&from=${from}&to=${to}&limit=100`, t);
    const repRow = ((rep.body && rep.body.rows) || []).find(x => x.id === hhId);
    ok("§1 Reports' top donors by household: the same household row, the same figure", repRow && cents(repRow.total) === row.thisYearCents, JSON.stringify(repRow || rep.body).slice(0, 200));
    ok("§1 the last gift is the latest of the two people's", row.lastGift && row.lastGift.date === thisYearDay && [debbie, jeff].includes(row.lastGift.donorId), JSON.stringify(row.lastGift));
  }
  r = await api("POST", `/top100/members/${hhId}/rank`, t, { rank: 1 });
  const moved = await q(`SELECT COALESCE(household_id, donor_id) AS k, rank FROM portfolio_members WHERE org_id=$1 ORDER BY rank`, [ORG]);
  ok("§1 the household's place moves by rank like a person's", r.status === 200 && moved[0].k === hhId && moved.map(x => Number(x.rank)).join() === "1,2", JSON.stringify(moved));

  // ── §2 the Donors list, households together ─────────────────────────────
  r = await api("PUT", "/donors/list-layout", t, { columns: ["name", "lifetime"], widths: {}, pageSize: 50, householdsTogether: true });
  const lay = await api("GET", "/donors/list-setup", t);
  ok("§2 \"Show households together\" is remembered for her", r.status === 200 && lay.body && lay.body.layout && lay.body.layout.householdsTogether === true, JSON.stringify(lay.body && lay.body.layout));
  const list = await api("GET", "/donors?role=&households=1&limit=50", t);
  const units = (list.body && list.body.units) || [];
  const hhUnit = units.find(u => u.kind === "household");
  ok("§2 the couple is one row with both people under it", units.length === 2 && hhUnit && hhUnit.householdId === hhId && hhUnit.memberIds.length === 2
    && (list.body.donors || []).filter(d => [debbie, jeff].includes(d.id)).length === 2, JSON.stringify(units).slice(0, 300));
  ok("§2 sorted by giving, the household ranks by its combined Lifetime (above Solace's $300)", units[0] && units[0].kind === "household", JSON.stringify(units.map(u => u.key)));
  ok("§2 the household row's Lifetime is the Top 100's, to the cent", hhUnit && hhUnit.lifetimeCents === lifeKey, hhUnit && hhUnit.lifetimeCents);
  ok("§2 the counts say households and people separately", list.body.unitCounts && list.body.unitCounts.households === 1 && list.body.unitCounts.people === 3 && list.body.unitCounts.units === 2, JSON.stringify(list.body.unitCounts));
  const asc = await api("GET", "/donors?role=&households=1&limit=50&sort=total_giving&dir=asc", t);
  ok("§2 ascending, Solace's own row comes first", ((asc.body && asc.body.units) || [])[0] && asc.body.units[0].donorId === solo, JSON.stringify((asc.body.units || []).map(u => u.key)));
  const off = await api("GET", "/donors?role=&limit=50", t);
  ok("§2 off, the list is one row per person as before", !off.body.units && (off.body.donors || []).length === 3, (off.body.donors || []).length);

  // ── §3 an export reaches both people ─────────────────────────────────────
  const csv = async qs => { const res = await fetch(`${BASE}/donors/export/csv?${qs}`, { headers: { Authorization: `Bearer ${t}` } }); return { status: res.status, text: await res.text() }; };
  const csvRows = text => {   // RFC 4180: quoted cells may hold commas and line breaks
    const out = [[]]; let cell = "", inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') inQ = false; else cell += c; }
      else if (c === '"') inQ = true; else if (c === ",") { out[out.length - 1].push(cell); cell = ""; }
      else if (c === "\n") { out[out.length - 1].push(cell); cell = ""; out.push([]); } else if (c !== "\r") cell += c;
    }
    if (cell || out[out.length - 1].length) out[out.length - 1].push(cell);
    const [head, ...body] = out.filter(r => r.length > 1);
    return body.map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
  };
  let ex = await csv(`role=&households=1&search=${encodeURIComponent("Debra")}`);
  let er = ex.status === 200 ? csvRows(ex.text) : [];
  ok("§3 a search that finds Debra, households together: the file has both people, each with their own email and phone",
    er.length === 2 && er.some(x => x.Email === "debra.v@hh1.test" && x.Phone === "555-0101") && er.some(x => x.Email === "geoff.v@hh1.test" && x.Phone === "555-0102"), ex.text.slice(0, 400));
  ok("§3 each row names the household, and the addressee line is both of them", er.length === 2 && er.every(x => x.Household === "The Vantongeren Household" && x.Addressee === "Debra and Geoffrey Vantongeren"), JSON.stringify(er.map(x => [x.Household, x.Addressee])));
  await q(`UPDATE donors SET address='12 Elm St', city='Easton', zip='02375' WHERE id = ANY($1)`, [[debbie, jeff]]);
  ex = await csv(`role=&households=1&collapse=household`);
  er = ex.status === 200 ? csvRows(ex.text) : [];
  ok("§3 a mailing collapses to one row per household address: 2 rows (the household, Solace)", er.length === 2 && er.some(x => x.Addressee === "Debra and Geoffrey Vantongeren"), JSON.stringify(er.map(x => x.Addressee)));
  await q(`UPDATE donors SET do_not_email=true WHERE id=$1`, [jeff]);
  ex = await csv(`role=&households=1&purpose=email&search=${encodeURIComponent("Debra")}`);
  er = ex.status === 200 ? csvRows(ex.text) : [];
  ok("§3 an email list leaves out Geoffrey, whose own preference is No email; Debra stays", er.length === 1 && er[0].Email === "debra.v@hh1.test", JSON.stringify(er.map(x => x.Email)));
  await q(`UPDATE donors SET do_not_email=false WHERE id=$1`, [jeff]);

  // ── §4 the household view: each person keeps their own ───────────────────
  const view = await api("GET", `/households/${hhId}`, t);
  const vp = (view.body && view.body.people) || [];
  ok("§4 the household view lists each person with their own email and phone", vp.length === 2 && vp.some(p => p.email === "debra.v@hh1.test" && p.phone === "555-0101") && vp.some(p => p.email === "geoff.v@hh1.test" && p.phone === "555-0102"), JSON.stringify(vp));
  const years = (view.body && view.body.by_year) || [];
  ok("§4 combined giving by year foots to Lifetime, to the cent", years.reduce((n, y) => n + y.cents, 0) === lifeKey && years.length >= 2, JSON.stringify(years));
  if (years[0]) {
    const yr = await api("GET", `/figures/${years[0].source.key}/rows?${new URLSearchParams(years[0].source.params)}`, t);
    ok("§4 a year opens its gifts and they foot", rowsSum(yr) === years[0].cents, JSON.stringify(yr.body).slice(0, 200));
  }
  ok("§4 the shared address is the household's, shared by both", view.body.address && view.body.address.sharedBy.length === 2, JSON.stringify(view.body.address));

  // ── §5 a touch from the household logs on both people, one Undo ───────────
  const tb = await api("POST", "/touch-batches", t, { ids: vp.map(p => p.id), touchKind: "call", title: "Household call", date: today });
  const logged = await q(`SELECT donor_id FROM interactions WHERE org_id=$1 AND touch_batch_id=$2`, [ORG, tb.body && tb.body.batchId || tb.body && tb.body.id]);
  ok("§5 logging a touch from the household puts one on each person", tb.status === 201 || tb.status === 200 ? logged.length === 2 : false, JSON.stringify(tb.body).slice(0, 200));
  if (tb.body && tb.body.undo) {
    const u = await api("POST", tb.body.undo, t, {});
    const left = await q(`SELECT COUNT(*)::int AS n FROM interactions WHERE org_id=$1 AND donor_id = ANY($2) AND note ILIKE 'Household call%'`, [ORG, [debbie, jeff]]);
    ok("§5 one Undo takes both back", u.status === 200 && left[0].n === 0, JSON.stringify({ s: u.status, left }));
  }

  // ── §6 a couple merged 10 days ago splits back into a household ───────────
  const anna = await person(t, "Annabel Quillfeather", "anna.q@hh1.test", "555-0201");
  const otto = await person(t, "Ottoline Quillfeather", "otto.q@hh1.test", "555-0202");
  const ga = await gift(t, anna, 250, thisYearDay), go = await gift(t, otto, 175.25, thisYearDay);
  const gAnna = ga.body && (ga.body.id || (ga.body.gift && ga.body.gift.id)), gOtto = go.body && (go.body.id || (go.body.gift && go.body.gift.id));
  const mg = await api("POST", "/donors/merge", t, { primaryId: anna, secondaryId: otto });
  ok("§6 the couple was merged (her workaround)", mg.status === 200 && mg.body.merged, JSON.stringify(mg.body).slice(0, 200));
  const [mrow] = await q(`SELECT id FROM donor_merges WHERE org_id=$1 AND kept_id=$2 ORDER BY created_at DESC LIMIT 1`, [ORG, anna]);
  await q(`UPDATE donor_merges SET created_at = NOW() - INTERVAL '10 days' WHERE id=$1`, [mrow.id]);
  const mf = await api("GET", `/donors/${anna}/merged-from`, t);
  ok("§6 the profile says it was merged from two people and offers the split", mf.body.merge && mf.body.merge.canSplit === true && /Split them back into a household/.test(mf.body.merge.sentence), JSON.stringify(mf.body));
  const sp = await api("POST", `/donors/${anna}/split-to-household`, t, { mergeId: mrow.id });
  const back = await q(`SELECT id, email, phone, household_id, deleted_at FROM donors WHERE id = ANY($1) ORDER BY id`, [[anna, otto]]);
  ok("§6 split: two people again, each with their own email and phone, in one household", sp.status === 200 && back.length === 2 && back.every(d => !d.deleted_at && d.household_id && d.household_id === back[0].household_id)
    && back.some(d => d.email === "otto.q@hh1.test" && d.phone === "555-0202") && back.some(d => d.email === "anna.q@hh1.test"), JSON.stringify({ s: sp.status, b: sp.body, back }));
  const gl = await q(`SELECT id, donor_id FROM gifts WHERE id = ANY($1)`, [[gAnna, gOtto]]);
  ok("§6 every gift is where it was", gl.length === 2 && gl.find(g => g.id === gAnna).donor_id === anna && gl.find(g => g.id === gOtto).donor_id === otto, JSON.stringify(gl));
  const again = await api("GET", `/donors/${anna}/merged-from`, t);
  ok("§6 the offer is gone once split", again.body.merge === null, JSON.stringify(again.body));
  // A merge past 30 days says it can't be split.
  const p1 = await person(t, "Peregrine Underhay", "p.u@hh1.test"), p2 = await person(t, "Prudence Underhay", "pr.u@hh1.test");
  await api("POST", "/donors/merge", t, { primaryId: p1, secondaryId: p2 });
  await q(`UPDATE donor_merges SET created_at = NOW() - INTERVAL '40 days' WHERE org_id=$1 AND kept_id=$2`, [ORG, p1]);
  const old = await api("GET", `/donors/${p1}/merged-from`, t);
  ok("§6 a merge older than 30 days says it can't be split automatically", old.body.merge && old.body.merge.canSplit === false && /can't split it automatically/.test(old.body.merge.sentence), JSON.stringify(old.body));
  const [oldM] = await q(`SELECT id FROM donor_merges WHERE org_id=$1 AND kept_id=$2`, [ORG, p1]);
  const refused = await api("POST", `/donors/${p1}/split-to-household`, t, { mergeId: oldM.id });
  ok("§6 and pressing it anyway changes nothing (409)", refused.status === 409, JSON.stringify(refused.body));

  // ── §8 SAFE-EDIT-1 · the household goes with its last member ────────────────
  { const a = await person(t, "Isolde Marchbanks", "isolde.m@hh1.test"), b = await person(t, "Leopold Marchbanks", "leo.m@hh1.test");
    const hh = await api("POST", "/households", t, { memberIds: [a, b], primaryDonorId: a });
    const hid = hh.body && hh.body.id;
    const listed = async () => ((await api("GET", "/households", t)).body || []).find(h => h.id === hid) || null;
    const del1 = await api("POST", "/donors/bulk-delete", t, { ids: [a] });
    const one = await listed();
    ok("§8 with one member still live the household stays, with that one person", hh.status === 201 && del1.status === 200 && one && one.member_count === 1, [hh.status, del1.status, one]);
    const del2 = await api("DELETE", `/donors/${b}`, t);
    const gone = await listed();
    const [tr] = await q(`SELECT id, row_data->>'__emptied' AS emptied FROM deleted_records WHERE org_id=$1 AND table_name='households' AND record_id=$2 AND restored_at IS NULL`, [ORG, hid]);
    ok("§8 once every member is in the trash the household is not listed with nobody in it: it is in the trash too",
      del2.status === 200 && !gone && tr && tr.emptied === "true", [del2.status, gone, tr]);
    const back1 = await api("POST", "/trash/people/restore", t, { ids: [b] });
    const after1 = await listed();
    const [rb] = await q(`SELECT household_id FROM donors WHERE id=$1`, [b]);
    ok("§8 Restore brings the household back with them, and they are in it", back1.status === 200 && back1.body.restored === 1 && after1 && rb.household_id === hid,
      [back1.status, back1.body, after1, rb]);
    const back2 = await api("POST", "/trash/people/restore", t, { ids: [a] });
    const view = (await api("GET", `/households/${hid}`, t)).body || {};
    const [stillOpen] = await q(`SELECT COUNT(*)::int AS n FROM deleted_records WHERE org_id=$1 AND table_name='households' AND record_id=$2 AND restored_at IS NULL`, [ORG, hid]);
    ok("§8 the second person rejoins it too: both people, the same household, its trash row closed",
      back2.status === 200 && (view.members || []).map(m => m.id).sort().join() === [a, b].sort().join() && stillOpen.n === 0, [back2.status, (view.members || []).map(m => m.name), stillOpen]);
  }

  // ── §7 the truth check, with a household row on the Top 100 ────────────────
  { const { assertSurfacesAgree } = require("./lib/surfacesAgree");
    const tr = await assertSurfacesAgree(ORG, { token: t, soft: true, label: "a household on the Top 100" });
    ok(`§7 every surface agrees, the household's Top 100 row with them (${tr.ms}ms)`, tr.ok, (tr.diffs || []).join(" | ").slice(0, 1500)); }

  summary();
  await closeDb();
})().catch(async e => { console.error(e); ok("the suite ran to the end", false, e.message); summary(); await closeDb(); });
