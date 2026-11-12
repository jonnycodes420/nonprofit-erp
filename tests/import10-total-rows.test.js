// tests/import10-total-rows.test.js: IMPORT-10. A LOT NAMED "TOTAL WINE" IS A
// GIFT, NOT A TOTAL ROW. Guards donor data and money: on 11 Nov a customer's
// 251-row silent-auction winners file previewed 249 rows. Two winners whose lot
// names held the word "Total" were read as total rows and left out ($280 paid),
// said only in a warning. The fixture is made up in that shape
// (tests/fixtures/import/import10/make.cjs): 45 winners, two with "Total" in the
// lot name, a "Subtotal - Live Auction" row mid-sheet and a "Total" row at the
// bottom, both of which foot.
//
//   §1 every winner is read: the two "Total" lot rows are people with gifts.
//   §2 the real subtotal and grand total are recognized, checked, foot, and are
//      never imported as gifts.
//   §3 a total-looking row that does not foot is listed (totalChecks, the set-
//      aside ledger, "N rows: R read, 1 needs a look"), and Include reads it.
//   §4 the server commits the file: 45 auction gifts, $4,530 paid, Iris Quarryu's
//      $120 and Elm Quarryo's $160 among them, and no gift from a total row.
//
// (Include then leaves the bottom "Total" short by $75, so that row is listed in
// its turn: the check is honest, never silent.)
//
// HOW IT GOES RED (each planted and seen red, 12 Nov):
//   §1/§4: put back the old rule in shared/totalRows.js readTotalRow: return
//          "total" whenever any non-money cell matches /\btotal\b/ (the line-22
//          and line-43 winners vanish; 43 gifts, $4,250).
//   §2:    make readTotalRow return null for a footing label ("Total" at the
//          bottom becomes a no-name row; "Subtotal - Live Auction" a gift to a
//          person called Subtotal).
//   §3:    make the not-footing branch return "total" (the row disappears into
//          totals with no Include).
"use strict";
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
const { build, csvOf } = require("./fixtures/import/import10/make.cjs");

const TODAY = "2026-11-12";
const PASSWORD = "importten12345";
const ORG = "org_import10_totals";
const DEADLINE_MS = 180000;

async function freshOrg(id, name) {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 5; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [id]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [id]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,'active','team')`, [id, name, id.replace(/_/g, "-")]);
  const email = `${id}@test.local`;
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Wren Tester','admin')`, ["u_" + id, id, email, bcrypt.hashSync(PASSWORD, 4)]);
  return login(email, PASSWORD);
}

(async () => {
  const deadline = setTimeout(() => { console.error(`import10: past its ${DEADLINE_MS / 1000} s deadline`); process.exit(1); }, DEADLINE_MS);
  const R = await import("../shared/sheetRead.js");
  const read = (grid, answers = {}) => R.understand({ sheets: [{ name: "Sheet1", grid }], fileName: "winners.csv", today: TODAY, answers });
  const fx = build();
  const grid = R.gridFromText(csvOf(fx));
  const u = read(grid);
  const lines = new Set(u.gifts.map(g => g.line));

  // ── §1 every winner is read
  const supp = u.gifts.find(g => g.line === 22), wine = u.gifts.find(g => g.line === 43);
  ok("§1 all 45 winners are people with a gift", u.people.length === fx.winners && u.gifts.length === fx.winners, { people: u.people.length, gifts: u.gifts.length });
  ok("§1 'Total Joint Care Supplement' is Iris Quarryu's $120 auction gift", !!supp && supp.who === "Iris Quarryu" && supp.cents === 12000 && supp.auction && supp.auction.fmvCents === 9000, supp);
  ok("§1 'Private Wine Class at Total Wine & More' is Elm Quarryo's $160 auction gift", !!wine && wine.who === "Elm Quarryo" && wine.cents === 16000 && wine.auction && wine.auction.fmvCents === 12000, wine);
  ok("§1 the gifts add up to every winner's bid", u.gifts.reduce((a, g) => a + g.cents, 0) === fx.paidCents, { cents: u.gifts.reduce((a, g) => a + g.cents, 0), want: fx.paidCents });
  ok("§1 no row needs a look and the ledger balances", (u.totalChecks || []).length === 0 && !u.checkLine && u.rowLedger.balanced, { checks: u.totalChecks, ledger: u.rowLedger.missing });

  // ── §2 the real subtotal and total are recognized, foot, and are not gifts
  const sub = u.totals.find(t => t.line === 32), tot = u.totals.find(t => t.line === 48);
  ok("§2 'Subtotal - Live Auction' is a subtotal that foots ($2,835)", !!sub && sub.subtotal && sub.matches && sub.statedCents === 283500, sub);
  ok("§2 'Total' at the bottom is the grand total and foots ($4,530)", !!tot && !tot.subtotal && tot.matches && tot.statedCents === fx.paidCents, tot);
  ok("§2 neither total row is a gift or a person", !lines.has(32) && !lines.has(48) && !u.people.some(p => /total/i.test(p.name)), u.people.filter(p => /total/i.test(p.name)).map(p => p.name));
  ok("§2 exactly two total rows, both set aside with their reason", u.totals.length === 2 && u.rowLedger.setAside.filter(x => /total row/.test(x.reason)).length === 2, u.totals);

  // ── §3 a total-looking row that does not foot is listed, counted and can be included
  const bad = grid.map(r => r.slice());
  bad.splice(bad.length - 1, 0, ["Total Wine & More", "", "", "", "", "", "", "Store gift card", "75", ""]);   // a business in the name column, no email
  const v = read(bad);
  const chk = (v.totalChecks || [])[0];
  ok("§3 the row is listed under Not read, check these", (v.totalChecks || []).length === 1 && chk.line === 48 && chk.label === "Total Wine & More" && chk.statedCents === 7500, v.totalChecks);
  ok("§3 it is not a gift, not a total, and the ledger lists it with its reason",
     !v.gifts.some(g => g.line === 48) && !v.totals.some(t => t.line === 48) && v.rowLedger.setAside.some(x => x.line === 48 && /check it/.test(x.reason)) && v.rowLedger.balanced, v.rowLedger.setAside);
  ok("§3 the headline counts it: '46 rows: 45 read, 1 needs a look'", v.checkLine === "46 rows: 45 read, 1 needs a look", v.checkLine);
  const inc = read(bad, { includeRows: ["Sheet1:48"] });
  const g48 = inc.gifts.find(g => g.line === 48);
  ok("§3 Include reads it as a $75 gift from Total Wine & More, no longer listed",
     !!g48 && g48.cents === 7500 && g48.who === "Total Wine & More" && !(inc.totalChecks || []).some(x => x.line === 48), { g48, checks: inc.totalChecks });

  // ── §4 the server commits the file with every winner
  const tok = await freshOrg(ORG, "Import Ten Totals");
  const body = { fileName: "winners.csv", sheets: [{ name: "Sheet1", grid }], useModel: false, today: TODAY };
  const pre = await api("POST", "/sheet-import/understand", tok, body);
  ok("§4 the preview reads 45 gifts and no check rows", pre.status === 200 && (pre.body.gifts || []).length === 45 && !(pre.body.totalChecks || []).length, { status: pre.status, gifts: (pre.body.gifts || []).length });
  const c = await api("POST", "/sheet-import/commit", tok, { ...body, previewOrgId: ORG });
  ok("§4 the commit succeeds", c.status === 201, { status: c.status, body: JSON.stringify(c.body).slice(0, 400) });
  const g = (await q(`SELECT COUNT(*)::int n, COALESCE(SUM(ROUND(amount*100)),0)::bigint cents FROM gifts WHERE org_id=$1`, [ORG]))[0];
  ok("§4 45 gifts written, $4,530 paid", g.n === 45 && Number(g.cents) === fx.paidCents, g);
  const named = await q(`SELECT d.name, ROUND(g.amount*100)::int cents FROM gifts g JOIN donors d ON d.id=g.donor_id WHERE g.org_id=$1 AND d.name IN ('Iris Quarryu','Elm Quarryo') ORDER BY d.name`, [ORG]);
  ok("§4 Elm Quarryo's $160 and Iris Quarryu's $120 are written", named.length === 2 && named[0].cents === 16000 && named[1].cents === 12000, named);
  const totalPeople = (await q(`SELECT COUNT(*)::int n FROM donors WHERE org_id=$1 AND (name ILIKE '%total%')`, [ORG]))[0].n;
  ok("§4 no person named after a total row", totalPeople === 0, { totalPeople });

  clearTimeout(deadline);
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch {} process.exit(1); });
