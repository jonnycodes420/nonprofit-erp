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
// Items 5 to 8, found on the same customer import (12 Nov):
//   §5 an event typed "Night of The Stars" (or "night of the  stars 2026")
//      never makes a second "NIght of the Stars 2026": the same name links,
//      a close one asks "Did you mean …?" and Import waits for the answer.
//   §6 the same file again within 30 days asks "You imported this file on …
//      Import again anyway?", and the commit refuses until she says yes.
//   §7 an imported auction purchase is a SOLD item with its winner: Won, Items
//      sold and Bidders agree with Raised; Undo takes the bids and bidders too.
//   §8 people with no gift are not Donors: the combined import and the
//      donor-only import store them as contacts, and the Directory counts so.
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
//   §5-§8: run on main's code (no eventMatch, no importedBefore, no
//          recordWinners, the "donor" default): a second event, an importable
//          second preview, Won $0 / Items sold 0 / Bidders 0, Donors 3 of 3.
"use strict";
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
const { build, csvOf } = require("./fixtures/import/import10/make.cjs");
const { undoAndWait } = require("./lib/undoWait");

const TODAY = "2026-11-12";
const PASSWORD = "importten12345";
const ORG = "org_import10_totals";
const BASE = process.env.BASE || "http://localhost:5601";
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

  // ── §6 the same file again within 30 days is asked, never one click
  const again = await api("POST", "/sheet-import/understand", tok, body);
  const ib = (again.body.questions || []).find(x => x.id === "importedBefore");
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const today = (await q(`SELECT to_char(committed_at, 'YYYY-MM-DD') d FROM imports WHERE org_id=$1 ORDER BY committed_at DESC LIMIT 1`, [ORG]))[0].d.split("-").map(Number);
  ok("§6 the second preview asks: 'You imported this file on … (45 gifts). Import again anyway?'",
     !!ib && ib.text === `You imported this file on ${mon[today[1] - 1]} ${today[2]} (45 gifts). Import again anyway?` && again.body.ready === false, { ib, ready: again.body.ready });
  const twice = await api("POST", "/sheet-import/commit", tok, { ...body, previewOrgId: ORG });
  const giftsNow = (await q(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1`, [ORG]))[0].n;
  ok("§6 the commit refuses without her answer, and nothing is written twice", twice.status === 409 && giftsNow === 45, { status: twice.status, giftsNow });
  const yes = await api("POST", "/sheet-import/understand", tok, { ...body, answers: { importAgain: ib && ib.importId } });
  ok("§6 'Import again anyway' clears the question", yes.status === 200 && !(yes.body.questions || []).some(x => x.id === "importedBefore"), (yes.body.questions || []).map(x => x.id));

  // ── §5 one event, however it is typed
  {
    const O5 = "org_import10_events";
    const t5 = await freshOrg(O5, "Import Ten Events");
    await q(`INSERT INTO events (id, org_id, name, event_type, date, status, created_by, created_by_name) VALUES ('evt_i10_stars',$1,'NIght of the Stars 2026','fundraiser','2026-10-03','completed','system:test','Test')`, [O5]);
    const sheet = n => [{ name: "Sheet1", grid: [["Name", "Email", "Amount", "Date"], ...[0, 1, 2].map(i => [`Wren Lantern${n}${i}`, `wren${n}${i}@i10ev.test`, String(40 + i), "2026-10-03"])] }];
    const evBody = (n, answers) => ({ fileName: `stars-${n}.csv`, sheets: sheet(n), useModel: false, today: TODAY, answers: { linkEvent: true, ...answers } });
    const events = async () => (await q(`SELECT COUNT(*)::int n FROM events WHERE org_id=$1`, [O5]))[0].n;
    const p1 = await api("POST", "/sheet-import/understand", t5, evBody("a", { eventName: "Night of The Stars" }));
    const em = (p1.body.questions || []).find(x => x.id === "eventMatch");
    ok("§5 'Night of The Stars' asks: Did you mean NIght of the Stars 2026?", !!em && em.text === "Did you mean NIght of the Stars 2026?" && em.eventId === "evt_i10_stars" && p1.body.ready === false, em);
    ok("§5 the preview offers the org's events to pick from, newest first", (p1.body.orgEvents || []).some(e => e.id === "evt_i10_stars"), p1.body.orgEvents);
    const c1 = await api("POST", "/sheet-import/commit", t5, { ...evBody("a", { eventName: "Night of The Stars" }), previewOrgId: O5 });
    ok("§5 Import waits for the answer: no second event", c1.status === 409 && await events() === 1, { status: c1.status, events: await events() });
    const c2 = await api("POST", "/sheet-import/commit", t5, { ...evBody("a", { eventName: "NIght of the Stars 2026", eventId: em && em.eventId }), previewOrgId: O5 });
    ok("§5 'Yes, use it' links the gifts to the existing event", c2.status === 201 && c2.body.eventId === "evt_i10_stars" && await events() === 1, { status: c2.status, ev: c2.body.eventId });
    const c3 = await api("POST", "/sheet-import/commit", t5, { ...evBody("b", { eventName: "night of the  stars 2026" }), previewOrgId: O5 });
    ok("§5 a name that differs only by case and spacing links without asking", c3.status === 201 && c3.body.eventId === "evt_i10_stars" && await events() === 1, { status: c3.status, ev: c3.body.eventId, events: await events() });
    const p4 = await api("POST", "/sheet-import/understand", t5, evBody("c", { eventName: "Night of The Stars", newEvent: "night of the stars" }));
    ok("§5 'No, create it' is her choice, and then nothing is asked", !(p4.body.questions || []).some(x => x.id === "eventMatch"), (p4.body.questions || []).map(x => x.id));
  }

  // ── §7 an imported purchase is a sold item with its winner
  {
    const O7 = "org_import10_auction";
    const t7 = await freshOrg(O7, "Import Ten Auction");
    const grid = [["Bidder", "Email", "Item", "Winning bid", "FMV"],
      ["Quill Harrow", "quill@i10auc.test", "Lake Cabin Weekend", "500", "200"],
      ["Sable Fenwick", "sable@i10auc.test", "Signed Guitar", "350", "150"],
      ["Quill Harrow", "quill@i10auc.test", "Pottery Class", "90", "60"],
      ["Moss Ardent", "", "Bakery Box", "45", "30"]];
    const ab = { fileName: "lantern-auction.csv", sheets: [{ name: "Sheet1", grid }], useModel: false, today: TODAY,
                 answers: { eventName: "Lantern Auction Night", linkEvent: true, date: "2026-10-03" } };
    const c = await api("POST", "/sheet-import/commit", t7, { ...ab, previewOrgId: O7 });
    const [auc] = await q(`SELECT id FROM auctions WHERE org_id=$1`, [O7]);
    const a = auc ? await api("GET", `/auctions/${auc.id}`, t7) : { body: {} };
    const F = k => ((a.body.figures || {})[k] || {}).value;
    ok("§7 the import placed 4 paid items in the event's auction", c.status === 201 && !!auc, { status: c.status, body: JSON.stringify(c.body).slice(0, 300) });
    ok("§7 Items sold 4, Items unsold 0", Number(F("auction-sold")) === 4 && Number(F("auction-unsold")) === 0, a.body.figures);
    ok("§7 Won equals Raised ($985)", Number(F("auction-committed")) === 985 && Number(F("auction-raised")) === 985, a.body.figures);
    ok("§7 Bidders 3 (Quill bought two)", Number(F("auction-bidders")) === 3, a.body.figures);
    const back = await undoAndWait(BASE, t7, c.body.importId, { timeoutMs: 60000, pollMs: 100 });
    const left = (await q(`SELECT (SELECT COUNT(*) FROM auction_bids WHERE org_id=$1)::int b, (SELECT COUNT(*) FROM auction_bidders WHERE org_id=$1)::int d,
                                  (SELECT COUNT(*) FROM auction_items WHERE org_id=$1)::int i`, [O7]))[0];
    ok("§7 Undo takes the bids, the bidders and the items with the gifts", back.status === 200 && left.b === 0 && left.d === 0 && left.i === 0, { status: back.status, left });
  }

  // ── §8 people with no gift are not Donors
  {
    const O8 = "org_import10_roles";
    const t8 = await freshOrg(O8, "Import Ten Roles");
    const comb = await api("POST", "/donors/import-combined", t8, {
      donors: [{ name: "Fern Gaveonce", email: "fern@i10roles.test" }, { name: "Linden Nevergave", email: "linden@i10roles.test" }, { name: "Briar Nevergave", email: "briar@i10roles.test" }],
      gifts: [{ donorIndex: 0, externalId: "g_i10_1", date: "2024-03-02", amount: 60, type: "cash", campaign: "", notes: "" }] });
    const only = await api("POST", "/donors/import", t8, { donors: [{ name: "Juniper Listonly", email: "juniper@i10roles.test" }, { name: "Cedar Statedtotal", email: "cedar@i10roles.test", total: "250" }] });
    const rc = ((await api("GET", "/donors?people=everyone&roleCounts=1&limit=1", t8)).body || {}).roleCounts || {};
    const types = Object.fromEntries((await q(`SELECT name, person_types FROM donors WHERE org_id=$1`, [O8])).map(r => [r.name, r.person_types]));
    ok("§8 both imports ran", comb.status < 300 && only.status < 300, { comb: comb.status, only: only.status, body: JSON.stringify(only.body).slice(0, 200) });
    ok("§8 the people with no gift are contacts, the giver is a donor", JSON.stringify(types["Fern Gaveonce"]) === '["donor"]' && JSON.stringify(types["Linden Nevergave"]) === '["other"]'
       && JSON.stringify(types["Briar Nevergave"]) === '["other"]' && JSON.stringify(types["Juniper Listonly"]) === '["other"]', types);
    ok("§8 a row whose file states a total keeps the donor role", JSON.stringify(types["Cedar Statedtotal"]) === '["donor"]', types);
    ok("§8 the Directory counts Donors 2, Contacts 3", rc.everyone === 5 && rc.donors === 2 && rc.contacts === 3, rc);
  }

  clearTimeout(deadline);
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch {} process.exit(1); });
