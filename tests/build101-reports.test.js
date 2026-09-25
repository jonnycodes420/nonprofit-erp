// BUILD-101 Part 5 — DIRECTORY, CARD AND REPORTS.
//
//   §1  the five membership reports reconcile to a HAND count of the fixture,
//       money in cents: by level, expiring in 60 days, lapsed, new vs renewed
//       by month, and membership revenue BESIDE donation revenue (two lines,
//       never one total);
//   §2  the saved-report registry runs the same functions (one computation);
//   §3  the member card PDF is one page;
//   §4  the directory CSV carries the formula-injection guard;
//   §5  org B cannot read org A's members or print org A's card.
//
// The fixture, by hand (all payments dated today, this fiscal year):
//   Ann   Family  $100 joined today (gift)          current
//         …and a $55 DONATION today
//   Ben   Patron  $250 joined today (gift), then renewed early with a second
//                 $250 (gift): the first term 'renewed', the second current
//   Cal   Family  lapsed, started 500 days ago, no gift        lapsed person
//   Dee   Friend  started 200 days ago, expires in 30 days, no gift   current
//   Eve   Family  started 10 days ago, no gift, a formula for a name  current
//   Ed    not a member, a $20 DONATION today
// So: current Family 2 (Ann, Eve) · Patron 1 (Ben) · Friend 1 (Dee) = 4;
//     lapsed 1 (Cal, Family); membership revenue 100+250+250 = $600.00;
//     donation revenue 55+20 = $75.00; expiring in 60 days: Dee alone;
//     new 4 (Ann, Ben's first term, Dee, Eve), renewed 1 (Ben's second).

const bcrypt = require("bcryptjs");
const { BASE, ok, summary, login, api, q, closeDb } = require("./helpers");

const O = "b101_rep", B = "b101_rep_b";
const PW = "loadtest1234";
const addDays = (d, n) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const cents = v => Math.round(Number(v) * 100);

async function reset() {
  for (const o of [O, B]) {
    for (const t of ["memberships", "receipts", "fin_transactions", "interactions", "thank_you_drafts", "threads", "tasks", "workflow_runs",
                     "gifts", "membership_levels", "donors", "users", "budgets", "accounts", "fin_funds"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}

(async () => {
  console.log("build101-reports");
  await reset();
  for (const [id, slug] of [[O, "b101-rep"], [B, "b101-rep-b"]])
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,timezone,timezone_confirmed_at)
             VALUES ($1,$2,$3,1,'team','active','America/New_York',NOW())`, [id, id === O ? "Hillside Zoo" : "Elsewhere", slug]);
  const hash = bcrypt.hashSync(PW, 4);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_b101rep',$1,'b101-rep@example.org',$2,'Rex Admin','admin')`, [O, hash]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_b101repb',$1,'b101-repb@example.org',$2,'Bo Admin','admin')`, [B, hash]);
  const tok = await login("b101-rep@example.org"), tokB = await login("b101-repb@example.org");
  await api("POST", "/onboarding/complete", tok, {});
  const today = (await api("GET", "/dashboard/home", tok)).body.today;
  const lv = async (name, price, fmv, term) => (await api("POST", "/membership-levels", tok, { name, price, fmv, term })).body.id;
  const FAM = await lv("Family", 100, 25, "12_months"), PAT = await lv("Patron", 250, 40, "12_months"), FRI = await lv("Friend", 40, 0, "calendar_year");
  const donor = (id, name) => q(`INSERT INTO donors (id,org_id,name,email,stage) VALUES ($1,$2,$3,$4,'steward')`, [id, O, name, id + "@example.org"]);
  for (const [id, name] of [["b101p_ann", "Ann Arbor"], ["b101p_ben", "Ben Birch"], ["b101p_cal", "Cal Cedar"], ["b101p_dee", "Dee Dogwood"],
                            ["b101p_eve", "=HYPERLINK(\"http://x.example\")"], ["b101p_ed", "Ed Elm"]]) await donor(id, name);
  const annJ = await api("POST", "/donors/b101p_ann/memberships", tok, { levelId: FAM, paymentMethod: "check", idempotencyKey: "b101p-ann" });
  const benJ = await api("POST", "/donors/b101p_ben/memberships", tok, { levelId: PAT, paymentMethod: "check", idempotencyKey: "b101p-ben" });
  const benR = await api("POST", `/memberships/${benJ.body.membership.id}/renew`, tok, { paymentMethod: "check", idempotencyKey: "b101p-ben-r" });
  ok("§0 the fixture's payments land", annJ.status === 201 && benJ.status === 201 && benR.status === 201, [annJ.body, benJ.body, benR.body]);
  const sqlMem = (id, d, lvId, starts, expires, status) => q(
    `INSERT INTO memberships (id,org_id,donor_id,level_id,joined_on,starts_on,expires_on,status,created_by,created_by_name)
     VALUES ($1,$2,$3,$4,$5,$5,$6,$7,'system:test','test')`, [id, O, d, lvId, starts, expires, status]);
  await sqlMem("mb_p_cal", "b101p_cal", FAM, addDays(today, -500), addDays(today, -136), "lapsed");
  await sqlMem("mb_p_dee", "b101p_dee", FRI, addDays(today, -200), addDays(today, 30), "active");
  await sqlMem("mb_p_eve", "b101p_eve", FAM, addDays(today, -10), addDays(today, 354), "active");
  await api("POST", "/donors/b101p_ann/gifts", tok, { amount: 55, date: today, type: "cash", idempotencyKey: "b101p-ann-don" });
  await api("POST", "/donors/b101p_ed/gifts", tok, { amount: 20, date: today, type: "cash", idempotencyKey: "b101p-ed-don" });

  // ── §1 · by level ─────────────────────────────────────────────────────────
  const byL = (await api("GET", "/reports/members-by-level", tok)).body;
  const L = n => byL.rows.find(r => r.name === n) || {};
  ok("§1 by level: Family 2 current / 1 lapsed / $100.00",
     L("Family").current === 2 && L("Family").lapsed === 1 && L("Family").revenueCents === 10000, L("Family"));
  ok("§1 by level: Patron 1 current / $500.00 (the join and the renewal)", L("Patron").current === 1 && L("Patron").revenueCents === 50000, L("Patron"));
  ok("§1 by level: Friend 1 current / $0.00", L("Friend").current === 1 && L("Friend").revenueCents === 0, L("Friend"));
  ok("§1 by level totals: 4 current, 1 lapsed, 60000 cents",
     byL.totals.current === 4 && byL.totals.lapsed === 1 && byL.totals.revenueCents === 60000, byL.totals);

  // ── §1 · expiring, lapsed, new vs renewed ─────────────────────────────────
  const exp = (await api("GET", "/reports/members-expiring", tok)).body;
  ok("§1 expiring in 60 days: Dee alone", exp.rows.length === 1 && exp.rows[0].name === "Dee Dogwood", exp.rows);
  const lap = (await api("GET", "/reports/members-lapsed", tok)).body;
  ok("§1 lapsed members: Cal alone, one year", lap.rows.length === 1 && lap.rows[0].name === "Cal Cedar" && lap.rows[0].years === 1, lap.rows);
  const nr = (await api("GET", "/reports/members-new-renewed", tok)).body;
  ok("§1 new vs renewed: 4 new, 1 renewed", nr.totals.newMembers === 4 && nr.totals.renewed === 1, nr);
  const thisMonth = nr.rows.find(r => r.month === today.slice(0, 7)) || {};
  ok("§1 …this month holds Ann, Ben's first term, Eve (new) and Ben's renewal",
     thisMonth.new_members === (addDays(today, -10).slice(0, 7) === today.slice(0, 7) ? 3 : 2) && thisMonth.renewed === 1, thisMonth);

  // ── §1 · revenue: two lines, in cents ─────────────────────────────────────
  const rev = (await api("GET", "/reports/membership-revenue", tok)).body;
  ok("§1 membership revenue $600.00 beside donation revenue $75.00",
     rev.totals.membershipCents === 60000 && rev.totals.donationCents === 7500, rev.totals);
  const [allGifts] = await q(`SELECT COALESCE(SUM(round(amount::numeric*100)),0)::bigint AS c FROM gifts WHERE org_id=$1`, [O]);
  ok("§1 …and the two together are every gift, each counted once", rev.totals.membershipCents + rev.totals.donationCents === Number(allGifts.c), { rev: rev.totals, all: allGifts.c });
  ok("§1 …and never summed into one revenue figure", Object.keys(rev.totals).sort().join(",") === "donationCents,membershipCents", rev.totals);
  const revCsv = await (await fetch(`${BASE}/reports/membership-revenue?format=csv`, { headers: { Authorization: "Bearer " + tok } })).text();
  ok("§1 the revenue CSV has two money columns and a total row of each", /Membership revenue,Donation revenue/.test(revCsv) && /TOTAL,600\.00,75\.00/.test(revCsv), revCsv);

  // ── §2 · the saved reports are the same computation ───────────────────────
  const saved = await api("GET", "/saved-reports/std:members-by-level/run", tok);
  const savedFamily = (saved.body.rows || []).find(r => r.c0 === "Family");
  ok("§2 the saved 'Members by level' reads the same numbers", saved.status === 200 && savedFamily && Number(savedFamily.c2) === 2 && savedFamily.c4 === "100.00", saved.body);
  for (const k of ["members-expiring", "members-lapsed", "members-new-renewed", "membership-revenue"])
    ok(`§2 the saved '${k}' runs`, (await api("GET", `/saved-reports/std:${k}/run`, tok)).status === 200);

  // ── §3 · the card ─────────────────────────────────────────────────────────
  const annMem = annJ.body.membership.id;
  const card = await fetch(`${BASE}/memberships/${annMem}/card.pdf`, { headers: { Authorization: "Bearer " + tok } });
  const pdf = Buffer.from(await card.arrayBuffer()).toString("latin1");
  const pages = (pdf.match(/\/Type\s*\/Page(?!s)/g) || []).length;
  ok("§3 the member card is a PDF of ONE page", card.status === 200 && pdf.startsWith("%PDF") && pages === 1, { status: card.status, pages });

  // ── §4 · the directory CSV ────────────────────────────────────────────────
  const dir = await (await fetch(`${BASE}/reports/members-directory?format=csv`, { headers: { Authorization: "Bearer " + tok } })).text();
  const lines = dir.trim().split(/\r?\n/);
  ok("§4 the directory lists the four current members", lines.length === 5 && /Ann Arbor/.test(dir) && /Dee Dogwood/.test(dir) && !/Cal Cedar/.test(dir), lines);
  ok("§4 a formula in a name is neutralised, never live", /"'=HYPERLINK/.test(dir) && !/(^|,)=HYPERLINK/m.test(dir), lines.find(l => /HYPERLINK/.test(l)));

  // ── §5 · the wall ─────────────────────────────────────────────────────────
  const bDir = (await api("GET", "/reports/members-directory", tokB)).body;
  ok("§5 org B's directory holds none of org A's members", bDir.rows.length === 0, bDir.rows);
  ok("§5 org B cannot print org A's card", (await fetch(`${BASE}/memberships/${annMem}/card.pdf`, { headers: { Authorization: "Bearer " + tokB } })).status === 404);
  ok("§5 org B's revenue report is its own (nothing)", (await api("GET", "/reports/membership-revenue", tokB)).body.totals.membershipCents === 0);

  await reset();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
