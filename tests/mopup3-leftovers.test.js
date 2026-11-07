// tests/mopup3-leftovers.test.js · MOPUP-3: an imported org's ask uses its
// stated history, and the bookkeeper's fund filter finds split lines.
//
// The one new suite of the build (money, donor data). QuickBooks' split lines
// (item 1) extend parity2-qbo-sync's stub (§9); LYBUNT's speed (item 3) is the
// nightly load test's; the phone deck (item 4) is perf-app's phone legs.
//
// Each section failed on main:
//   §1 an organization whose file stated $37,206 and has one $244 gift in
//      Steward was asked "$250: largest gift $244", on Home and on the profile
//   §2 filtered to General, the bookkeeper's file did not have the $200 line of
//      a $500 gift split $300 Food Pantry / $200 General (it read gifts.fund_id,
//      the largest line); filtered to Food Pantry it was one $500 row
// Fixture org of its own, made-up names; nothing sends.
"use strict";
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
const { testNow } = require("./clock");
const orgTime = require("../orgTime");

const RUN = require("crypto").randomBytes(4).toString("hex");
const ORG = `org_mopup3_${RUN}`;
const OWNER = `owner-${RUN}@mopup3.local`;
const PW = "loadtest1234";
const C = v => Math.round(Number(v) * 100);

async function reset() {
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,emails_enabled,timezone,onboarded_at)
           VALUES ($1,'Mopup Three Tide Pool Trust (test)',$1,1,'active','team',false,'America/New_York',NOW())`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($3,$1,$4,$2,'Owner','admin')`,
    [ORG, bcrypt.hashSync(PW, 4), `u_mopup3_${RUN}`, OWNER]);
}
async function person(name, kind = "individual") {
  const id = `d_mp3_${Math.random().toString(16).slice(2, 12)}`;
  await q(`INSERT INTO donors (id,org_id,name,kind,email,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,'system:test','test fixture')`,
    [id, ORG, name, kind, `${id}@mopup3.invalid`]);
  return id;
}

(async () => {
  await reset();
  const tok = await login(OWNER, PW);
  const today = orgTime.orgToday({ timezone: "America/New_York" }, new Date(testNow()));
  const daysAgo = n => orgTime.addDays(today, -n);

  // ── §1 · AN IMPORTED ORG'S ASK USES ITS STATED HISTORY ─────────────────────
  {
    const imp = `imp_mp3_${RUN}`;
    await q(`INSERT INTO imports (id,org_id,name) VALUES ($1,$2,'Saltmarsh ledger (test)')`, [imp, ORG]);
    const org = await person("Quarrendon Kelp Cooperative", "organization");
    await q(`UPDATE donors SET total_giving=37450, imported_total=37206, imported_import_id=$3, imported_through=$4, imported_source='Saltmarsh ledger (test)'
              WHERE id=$1 AND org_id=$2`, [org, ORG, imp, daysAgo(200)]);
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ($1,$2,$3,244,$4,'gift','system:test','test fixture')`,
      [`g_mp3_qkc_${RUN}`, ORG, org, daysAgo(30)]);
    // The same stated total WITHOUT imported_import_id (a total typed in, not
    // stated by a file) keeps the ask from gifts in Steward.
    const typed = await person("Pellow Harbour Rowing Club", "organization");
    await q(`UPDATE donors SET total_giving=37450, imported_total=37206 WHERE id=$1 AND org_id=$2`, [typed, ORG]);
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ($1,$2,$3,244,$4,'gift','system:test','test fixture')`,
      [`g_mp3_phr_${RUN}`, ORG, typed, daysAgo(31)]);
    // A file that stated a count: 12 gifts of $37,206 is about $3,100 each.
    const counted = await person("Tamsin Orrell");
    await q(`UPDATE donors SET total_giving=37450, imported_total=37206, imported_gift_count=12, imported_import_id=$3, imported_through=$4
              WHERE id=$1 AND org_id=$2`, [counted, ORG, imp, daysAgo(200)]);
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ($1,$2,$3,244,$4,'gift','system:test','test fixture')`,
      [`g_mp3_to_${RUN}`, ORG, counted, daysAgo(29)]);
    await q(`UPDATE donors SET updated_at=NOW() WHERE org_id=$1`, [ORG]);

    let moves = [];
    for (let i = 0; i < 60; i++) {
      const r = (await api("GET", "/insights?view=deck&moves=all", tok)).body || {};
      moves = r.deck && !r.stale ? (r.deck.tabs || []).flatMap(t => t.moves || []) : [];
      if ([org, typed, counted].every(id => moves.some(m => (m.ids || []).includes(id)))) break;
      await new Promise(z => setTimeout(z, 500));
    }
    const askOf = id => { const m = moves.find(x => (x.ids || []).includes(id) && x.ask); return m ? m.ask.words : null; };
    const a1 = askOf(org);
    ok("§1 the imported org's ask is based on its stated lifetime, and says so: \"Ask $37,…: based on $37,206 given before Steward …\"",
       /^Ask \$37,\d{3}: based on \$37,206 given before Steward\b/.test(a1 || "") && !/largest gift \$244\b/.test(a1 || ""), a1);
    ok("§1 …and still names the gift since", /a largest gift of \$244 since/.test(a1 || ""), a1);
    const a2 = askOf(typed);
    ok("§1 a total NOT stated by an import keeps the ask from gifts in Steward", /^Ask \$250: largest gift \$244/.test(a2 || ""), a2);
    const a3 = askOf(counted);
    ok("§1 a file that stated 12 gifts asks at their stated average (about $3,100 each)",
       /^Ask \$3,\d{3}: based on \$37,206 given before Steward \(12 gifts, about \$3,101 each\)/.test(a3 || ""), a3);

    const st = (await api("GET", `/donors/${org}/status`, tok)).body || {};
    const pAsk = st.next && st.next.ask;
    const homeCents = (() => { const m = /^Ask \$([\d,]+)/.exec(a1 || ""); return m ? Number(m[1].replace(/,/g, "")) * 100 : null; })();
    ok("§1 the profile's suggested ask is the same amount, on the same base",
       !!pAsk && pAsk.cents === homeCents && /based on \$37,206 given before Steward/i.test(pAsk.sentence || ""), { pAsk, homeCents });
  }

  // ── §2 · THE BOOKKEEPER'S FUND FILTER FINDS THE SPLIT LINE ─────────────────
  {
    const month = { from: daysAgo(40), to: today };
    const funds0 = (await api("GET", "/finance/funds", tok)).body || [];
    let general = funds0.find(f => f.isOrgDefault);
    if (!general) {
      const seed = await api("POST", `/donors/${await person("Seed Person")}/gifts`, tok, { amount: 1, date: today, payment_method: "check" });
      await api("DELETE", `/gifts/${seed.body.gift.id}`, tok);
      general = ((await api("GET", "/finance/funds", tok)).body || []).find(f => f.isOrgDefault);
    }
    const pantry = (await api("POST", "/finance/funds", tok, { name: "Food Pantry", restricted: true })).body;
    const pantryId = pantry && (pantry.id || (pantry.fund && pantry.fund.id));
    const ada = await person("Ada Wrenfield");
    const made = await api("POST", `/donors/${ada}/gifts`, tok, { amount: 500, date: daysAgo(3), payment_method: "card",
      fundLines: [{ fundId: pantryId, amount: 300 }, { fundId: general.id, amount: 200 }] });
    const giftId = made.body && made.body.gift && made.body.gift.id;
    await q(`UPDATE gifts SET processor_fee_amount=15 WHERE id=$1 AND org_id=$2`, [giftId, ORG]);
    // An unsplit $80 gift on General beside it.
    const ben = await person("Ben Aldercott");
    const plain = await api("POST", `/donors/${ben}/gifts`, tok, { amount: 80, date: daysAgo(4), payment_method: "check", fund_id: general.id });
    const plainId = plain.body && plain.body.gift && plain.body.gift.id;
    ok("§2 setup: a $500 gift split $300 Food Pantry / $200 General, and an $80 gift on General",
       !!giftId && !!plainId && !!general && !!pantryId, made.status + " " + plain.status);

    const g = (await api("GET", `/reports/bookkeeper?from=${month.from}&to=${month.to}&fundId=${general.id}`, tok)).body || {};
    const gRows = (g.rows || []).filter(r => r.giftId === giftId);
    ok("§2 filtered to General, the file has the split gift's $200 line (fee $6), and only that line",
       gRows.length === 1 && C(gRows[0].amount) === 20000 && gRows[0].feeCents === 600 && gRows[0].fund === general.name,
       (g.rows || []).map(r => [r.giftId, r.fund, r.amount]));
    ok("§2 …with the $80 gift, $280 in all, footing (no refusal)",
       (g.rows || []).some(r => r.giftId === plainId) && g.totalCents === 28000 && g.giftCount === 2 && g.balanced === true && !g.exportRefused,
       { total: g.totalCents, n: g.giftCount, balanced: g.balanced, refused: g.exportRefused });
    const p = (await api("GET", `/reports/bookkeeper?from=${month.from}&to=${month.to}&fundId=${pantryId}`, tok)).body || {};
    ok("§2 filtered to Food Pantry, it is the $300 line alone, not the $500 gift",
       (p.rows || []).length === 1 && C(p.rows[0].amount) === 30000 && p.rows[0].fund === "Food Pantry" && p.totalCents === 30000 && p.balanced === true && !p.exportRefused,
       { rows: (p.rows || []).map(r => [r.fund, r.amount]), total: p.totalCents, refused: p.exportRefused });
    const all = (await api("GET", `/reports/bookkeeper?from=${month.from}&to=${month.to}`, tok)).body || {};
    const mine = (all.rows || []).filter(r => r.giftId === giftId || r.giftId === plainId);
    ok("§2 unfiltered, the file is unchanged: both lines and the $80, $580 of it, footing",
       mine.length === 3 && mine.reduce((n, r) => n + C(r.amount), 0) === 58000 && all.balanced === true && !all.exportRefused, mine.map(r => [r.fund, r.amount]));
  }

  for (const t of ["gift_fund_lines", "gifts", "fin_transactions", "donors", "fin_funds", "imports", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
