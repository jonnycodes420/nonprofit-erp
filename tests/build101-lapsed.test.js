// BUILD-101 Part 3 — LAPSED MEMBERS ARE THEIR OWN LIST.
//
//   §1  a member who lapsed but gave a gift last month is in lapsed members,
//       shown as still giving, with their years as a member counted;
//   §2  …and NOT in LYBUNT; a lapsed DONOR is in LYBUNT and not in lapsed
//       members;
//   §3  somebody who lapsed and then rejoined is not lapsed, and the lapsed
//       COUNT is people, matching a hand count and the list;
//   §4  Drift, LYBUNT and SYBUNT are byte-identical with and without the
//       membership rows (and Drift is shown non-empty, so the comparison
//       compares something);
//   §5  org B cannot see org A's lapsed members.
//
// Standard scratch stack. Fixture orgs are b101_.

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const O = "b101_lap", B = "b101_lap_b";
const PW = "loadtest1234";
const addDays = (d, n) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

async function reset() {
  for (const o of [O, B]) {
    for (const t of ["memberships", "receipts", "fin_transactions", "interactions", "thank_you_drafts", "threads", "tasks", "workflow_runs",
                     "gifts", "membership_levels", "donors", "users", "budgets", "accounts", "fin_funds"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}

(async () => {
  console.log("build101-lapsed");
  await reset();
  for (const [id, slug] of [[O, "b101-lap"], [B, "b101-lap-b"]])
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,timezone,timezone_confirmed_at)
             VALUES ($1,$2,$3,1,'team','active','America/New_York',NOW())`, [id, id === O ? "Harbor Museum" : "Other Place", slug]);
  const hash = bcrypt.hashSync(PW, 4);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_b101lap',$1,'b101-lap@example.org',$2,'Lou Admin','admin')`, [O, hash]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_b101lapb',$1,'b101-lapb@example.org',$2,'Bo Admin','admin')`, [B, hash]);
  const tok = await login("b101-lap@example.org"), tokB = await login("b101-lapb@example.org");
  await api("POST", "/onboarding/complete", tok, {});
  const today = (await api("GET", "/dashboard/home", tok)).body.today;
  const [ty, tm] = today.split("-").map(Number);
  const FY = tm >= 7 ? ty + 1 : ty, fyStart = `${FY - 1}-07-01`;
  const lv = (await api("POST", "/membership-levels", tok, { name: "Patron", price: 250, fmv: 40, term: "12_months" })).body.id;

  const donor = (id, name) => q(`INSERT INTO donors (id,org_id,name,email,stage) VALUES ($1,$2,$3,$4,'steward')`, [id, O, name, id + "@example.org"]);
  const gift = (id, d, amt, date) => q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type) VALUES ($1,$2,$3,$4,$5,'cash')`, [id, O, d, amt, date]);
  const recalc = d => q(`UPDATE donors SET total_giving=(SELECT COALESCE(SUM(amount),0) FROM gifts WHERE donor_id=$1),
                           gift_count=(SELECT COUNT(*) FROM gifts WHERE donor_id=$1),
                           last_gift_date=(SELECT MAX(date) FROM gifts WHERE donor_id=$1),
                           last_gift_amount=(SELECT amount FROM gifts WHERE donor_id=$1 ORDER BY date DESC LIMIT 1) WHERE id=$1`, [d]);

  // Lena: two membership years, lapsed, and a donation last month.
  await donor("b101l_lena", "Lena Hart");
  const lenaGiftDate = addDays(today, -30) >= fyStart ? addDays(today, -30) : today;
  await gift("g_b101l_lena", "b101l_lena", 60, lenaGiftDate);
  // Don: gave last fiscal year, nothing this year, never a member.
  await donor("b101l_don", "Don Reed");
  await gift("g_b101l_don", "b101l_don", 80, addDays(fyStart, -40));
  // Dave: a quarterly giver gone quiet — Drift's business, not ours.
  await donor("b101l_dave", "Dave Quarter");
  for (const [i, back] of [200, 290, 380, 470].entries()) await gift(`g_b101l_dave${i}`, "b101l_dave", 500, addDays(today, -back));
  // Rita: lapsed once, then rejoined.
  await donor("b101l_rita", "Rita Back");
  for (const d of ["b101l_lena", "b101l_don", "b101l_dave", "b101l_rita"]) await recalc(d);

  // ── Before any membership rows exist: the three computations ──────────────
  const snap = async () => ({
    drift: (await api("GET", "/drift?uncapped=1", tok)).body,
    lybunt: (await api("GET", `/reports/lybunt?year=${FY}&yearMode=fiscal`, tok)).body,
    sybunt: (await api("GET", `/reports/sybunt?year=${FY}&yearMode=fiscal`, tok)).body,
  });
  const before = await snap();
  ok("§4 Drift has something to compare (Dave is drifting)",
     before.drift.list.some(r => (r.donorId || r.id) === "b101l_dave"), before.drift.list.map(r => r.donorId || r.id));

  // ── The membership rows ───────────────────────────────────────────────────
  const mem = (id, d, starts, status, changed = null) => q(
    `INSERT INTO memberships (id,org_id,donor_id,level_id,joined_on,starts_on,expires_on,status,status_changed_on,created_by,created_by_name)
     VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8,'system:test','test')`, [id, O, d, lv, starts, addDays(starts, 364), status, changed]);
  await mem("mb_l_lena1", "b101l_lena", addDays(today, -800), "renewed");
  await mem("mb_l_lena2", "b101l_lena", addDays(today, -435), "lapsed", addDays(today, -40));
  await mem("mb_l_dave", "b101l_dave", addDays(today, -600), "lapsed", addDays(today, -200));
  await mem("mb_l_rita1", "b101l_rita", addDays(today, -600), "lapsed", addDays(today, -200));
  await mem("mb_l_rita2", "b101l_rita", addDays(today, -20), "active");

  // ── §4 · byte-identical with the membership rows ──────────────────────────
  const after = await snap();
  ok("§4 Drift is byte-identical with and without membership rows", JSON.stringify(after.drift) === JSON.stringify(before.drift));
  ok("§4 LYBUNT is byte-identical", JSON.stringify(after.lybunt) === JSON.stringify(before.lybunt));
  ok("§4 SYBUNT is byte-identical", JSON.stringify(after.sybunt) === JSON.stringify(before.sybunt));

  // ── §1 · Lena ─────────────────────────────────────────────────────────────
  const lap = (await api("GET", "/memberships/lapsed", tok)).body;
  const lena = lap.members.find(m => m.donor_id === "b101l_lena");
  ok("§1 Lena is a lapsed member", !!lena, lap.members);
  ok("§1 …on her last level, with when it lapsed", lena && lena.level_name === "Patron" && lena.lapsed_on === addDays(today, -40), lena);
  ok("§1 …two years as a member", lena && lena.membership_years === 2, lena);
  ok("§1 …and shown as still giving, honestly", lena && lena.lastGiftDate === lenaGiftDate, lena);
  ok("§1 the list carries its sentence", /membership payment/.test(lap.sentence || ""));

  // ── §2 · the two lists do not feed each other ─────────────────────────────
  ok("§2 Lena is NOT in LYBUNT", !after.lybunt.rows.some(r => r.id === "b101l_lena"));
  ok("§2 Don (a lapsed donor) IS in LYBUNT", after.lybunt.rows.some(r => r.id === "b101l_don"));
  ok("§2 …and NOT in lapsed members", !lap.members.some(m => m.donor_id === "b101l_don"));

  // ── §3 · people, once ─────────────────────────────────────────────────────
  ok("§3 Rita rejoined, so she is not a lapsed member", !lap.members.some(m => m.donor_id === "b101l_rita"));
  const list = (await api("GET", "/memberships", tok)).body;
  const filtered = (await api("GET", "/memberships?status=lapsed", tok)).body;
  // By hand: Lena and Dave. Rita's old row is not a person who lapsed.
  ok("§3 the lapsed count is people (2), and the list and filter agree",
     list.byStatus.lapsed === 2 && lap.members.length === 2 && filtered.members.length === 2,
     { count: list.byStatus.lapsed, list: lap.members.length, filter: filtered.members.length });
  ok("§3 Dave (lapsed member, quiet donor) is in both lists honestly",
     lap.members.some(m => m.donor_id === "b101l_dave") && after.drift.list.some(r => (r.donorId || r.id) === "b101l_dave"));

  // ── §5 · the wall ─────────────────────────────────────────────────────────
  const other = (await api("GET", "/memberships/lapsed", tokB)).body;
  ok("§5 org B sees none of org A's lapsed members", Array.isArray(other.members) && other.members.length === 0, other.members);

  await reset();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
