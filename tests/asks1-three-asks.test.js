// tests/asks1-three-asks.test.js · ASKS-1. THREE CUSTOMER ASKS FROM 10 NOV.
//
//   §1  Street address in People reports (Sarah, CKRH): a People report that
//       ticks Street address returns it, its CSV has it, the catalogue offers
//       it before City with Address line 2 and Full mailing address, and the
//       donors CSV and the Donors list's columns offer the same fields
//   §2  Major Gifts in the main menu (Allie, Justin's Place): the rail puts it
//       under Raise between Fundraising and Events; an admin lands on Top 100;
//       old Fundraising links (top100, portfolios, pipeline, plans) open it;
//       somebody without the permission is sent Home and GET /me says so
//       (the browser leg is the walk, docs/history/ASKS-1.md)
//   §3  Auction purchases from a spreadsheet (Sarah, CKRH): the 10-row sheet
//       with FMV (tests/fixtures/asks1-gala-auction.csv) makes 10 gifts, type
//       auction, each deductible for what was paid over the value; the gala's
//       Raised is what was paid; the items are in the gala's auction, paid;
//       the receipt says paid $500, value $200, deductible $300. A sheet with
//       no value column is ASKED (409 until answered), never assumed.
//
// HOW IT GOES RED (each watched red on main before trusting the green):
//   - on main: §1's "Street address" is not a report field (400 unknown field),
//     §2's routeMajorGifts module does not exist, §3's sheet makes 0 gifts
//   - planted: drop the fmv from recordGifts' insert → §3's deductible checks go red
//
// Standard scratch stack (tests/README.md). Never reaches the network, sends nothing.
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, q, closeDb } = require("./helpers");

const ORG = "org_asks1t";
const EVENT = "ev_asks1_gala";
const ROOT = path.join(__dirname, "..");

async function reset() {
  await q(`DELETE FROM auction_items WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM auctions WHERE org_id=$1`, [ORG]).catch(() => {});
  for (const t of ["receipts", "fin_transactions", "interactions", "gifts", "saved_reports", "event_attendees", "events", "sheet_import_jobs", "imports"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM donors WHERE org_id=$1`, [ORG]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,receipts_enabled,legal_name,ein)
           VALUES ($1,'Asks One Test','asks-one-test',1,'active','team',true,'Asks One Test Inc','12-3456789')
           ON CONFLICT (id) DO UPDATE SET receipts_enabled=true, legal_name='Asks One Test Inc'`, [ORG]);
  const hash = bcrypt.hashSync("loadtest1234", 4);
  for (const [id, role] of [["admin", "admin"], ["staff", "member"]])
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,can_major_gifts) VALUES ($1,$2,$3,$4,$5,$6,false)
             ON CONFLICT (id) DO UPDATE SET password_hash=EXCLUDED.password_hash, role=EXCLUDED.role, can_major_gifts=false`,
      [`u_${ORG}_${id}`, ORG, `${id}@${ORG}.test`, hash, id === "admin" ? "Sage Admin" : "Rook Staff", role]);
  // Made-up people with made-up addresses.
  await q(`INSERT INTO donors (id,org_id,name,email,address,address2,city,state,zip,created_by,created_by_name) VALUES
           ('d_a1_bell',$1,'Bell Ardent','bell@asks1.test','12 Elm St','Apt 4','Lexington','KY','40502',$2,'Sage Admin'),
           ('d_a1_cove',$1,'Cove Marlin','cove@asks1.test',NULL,NULL,'Paris','KY',NULL,$2,'Sage Admin')`, [ORG, `u_${ORG}_admin`]);
  await q(`INSERT INTO events (id,org_id,name,event_type,date) VALUES ($1,$2,'Harvest Gala','gala','2026-10-17')`, [EVENT, ORG]);
}
async function token(who) {
  const r = await fetch(BASE + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `${who}@${ORG}.test`, password: "loadtest1234" }) });
  return (await r.json()).token;
}
const call = async (tok, method, p, body) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { json = null; }
  return { status: r.status, text, body: json || {} };
};
const cents = v => Math.round(Number(v) * 100);

(async () => {
  console.log("ASKS-1: street address in reports, Major Gifts in the menu, auction purchases from a spreadsheet\n");
  await reset();
  const admin = await token("admin"), staff = await token("staff");
  ok("both sign in", !!admin && !!staff);

  // ── §1 Street address in People reports ──────────────────────────────────
  console.log("§1 street address");
  const cat = await call(admin, "GET", "/report-builder/catalogue");
  const pf = ((cat.body.entities || []).find(e => e.key === "people") || { fields: [] }).fields.map(f => f.key);
  ok("§1 the People report offers Street address, Address line 2 and Full mailing address, before City",
    pf.indexOf("address") >= 0 && pf.indexOf("address") < pf.indexOf("address2") && pf.indexOf("address2") < pf.indexOf("mailing_address")
      && pf.indexOf("mailing_address") < pf.indexOf("city"), pf);
  const def = { entity: "people", columns: ["name", "address", "address2", "city", "state", "zip", "mailing_address"] };
  const run = await call(admin, "POST", "/report-builder/run", { definition: def });
  // a row is keyed by column position; read it back by the field each column is
  const byField = r => Object.fromEntries(def.columns.map((k, i) => [k, r[(run.body.columns || [])[i] ? run.body.columns[i].key : k]]));
  const named = (run.body.rows || []).map(byField);
  const bell = named.find(r => r.name === "Bell Ardent") || {};
  const cove = named.find(r => r.name === "Cove Marlin") || {};
  ok("§1 a report ticking Street address returns it", run.status === 200 && bell.address === "12 Elm St" && bell.address2 === "Apt 4", run.body);
  ok("§1 the full mailing address is two lines, and a person with only a city is one", bell.mailing_address === "12 Elm St, Apt 4\nLexington, KY 40502"
    && cove.mailing_address === "Paris, KY", [bell.mailing_address, cove.mailing_address]);
  const saved = await call(admin, "POST", "/saved-reports", { name: "Mailing list", definition: def });
  const csv = await call(admin, "GET", `/saved-reports/${saved.body.id}/csv`);
  const head = csv.text.split("\n")[0];
  ok("§1 the report's CSV has the street", csv.status === 200 && /Street address/.test(head) && /Address line 2/.test(head) && csv.text.includes("12 Elm St"), csv.text.slice(0, 300));
  const dcsv = await call(admin, "GET", "/donors/export/csv");
  const dhead = dcsv.text.split("\n")[0];
  ok("§1 the donors CSV has Street address, Address line 2, ZIP and Full mailing address", dcsv.status === 200
    && ["Street address", "Address line 2", "ZIP", "Full mailing address"].every(h => dhead.includes(h)) && dcsv.text.includes("12 Elm St"), dhead);
  const DL = require("../donorList");
  ok("§1 the Donors list's columns offer the same fields", ["address", "address2", "mailing_address", "city", "state", "zip"].every(k => DL.FIELDS.some(f => f.key === k && f.col)));
  const page = await call(admin, "GET", `/donors?limit=50&cols=${encodeURIComponent("name,address,address2,mailing_address")}`);
  const listed = (Array.isArray(page.body) ? page.body : page.body.donors || []).find(d => d.id === "d_a1_bell");
  const cell = listed && listed.cells;
  ok("§1 the Donors list shows them", !!cell && cell.address === "12 Elm St" && cell.address2 === "Apt 4" && cell.mailing_address === "12 Elm St, Apt 4\nLexington, KY 40502", cell || page.body);

  // ── §2 Major Gifts in the main menu ──────────────────────────────────────
  console.log("§2 major gifts");
  const NG = await import("../client/src/lib/navGroups.js");
  const raise = NG.NAV_GROUPS.find(g => g.id === "raise").items;
  ok("§2 Major Gifts sits under Raise, between Fundraising and Events", raise.indexOf("majorgifts") === raise.indexOf("fundraising") + 1 && raise.indexOf("events") === raise.indexOf("majorgifts") + 1, raise);
  const MG = await import("../client/src/lib/majorGiftsTab.js");
  const R = (t, o, c) => JSON.stringify(MG.routeMajorGifts(t, o, c));
  ok("§2 an admin who opens it lands on Top 100", R("majorgifts", {}, true) === JSON.stringify({ tab: "majorgifts", opts: { subtab: "top100" } }));
  ok("§2 the old Fundraising links open it on the same tab",
    ["top100", "portfolios", "pipeline", "plans"].every(p => R("fundraising", { frSection: p }, true) === JSON.stringify({ tab: "majorgifts", opts: { subtab: p } }))
      && R("pipeline", { scope: "all" }, true) === JSON.stringify({ tab: "majorgifts", opts: { scope: "all", subtab: "pipeline" } }));
  ok("§2 somebody without the permission who types the address goes Home",
    R("majorgifts", { subtab: "plans" }, false) === JSON.stringify({ tab: "dashboard", opts: {} }) && R("fundraising", { frSection: "top100" }, false) === JSON.stringify({ tab: "dashboard", opts: {} }));
  ok("§2 Fundraising's other parts are untouched", R("fundraising", { frSection: "proposals" }, false) === JSON.stringify({ tab: "fundraising", opts: { frSection: "proposals" } }));
  const meStaff = await call(staff, "GET", "/me"), meAdmin = await call(admin, "GET", "/me");
  ok("§2 GET /me: staff without the permission may not see it, an admin may", meStaff.body.user && meStaff.body.user.canMajorGifts === false && meAdmin.body.user && meAdmin.body.user.role === "admin");
  const top = await call(staff, "GET", "/top100");
  ok("§2 and the server refuses the staff member's Top 100", top.status === 403, top.status);

  // ── §3 Auction purchases from a spreadsheet ──────────────────────────────
  console.log("§3 auction sheet");
  const SR = await import("../shared/sheetRead.js");
  const text = fs.readFileSync(path.join(ROOT, "tests/fixtures/asks1-gala-auction.csv"), "utf8");
  const sheets = [{ name: "Auction", grid: SR.gridFromText(text) }];
  const answers = { eventName: "Harvest Gala", linkEvent: true, date: "2026-10-17" };
  const look = await call(admin, "POST", "/sheet-import/understand", { fileName: "gala-auction.csv", sheets, answers });
  ok("§3 the reader maps Bidder, Item, Winning bid and FMV, and is ready", look.status === 200 && look.body.ready === true && (look.body.gifts || []).length === 10
    && look.body.gifts.every(g => g.auction && g.auction.fmvCents != null), look.body.questions);
  const start = await call(admin, "POST", "/sheet-import/commit", { fileName: "gala-auction.csv", sheets, answers, background: true, previewOrgId: ORG });
  let job = null;
  for (let i = 0; i < 400 && start.status === 202; i++) {
    const j = await call(admin, "GET", `/sheet-import/jobs/${encodeURIComponent(start.body.importId)}`);
    if (j.status === 200 && j.body.status !== "running") { job = j.body; break; }
    await new Promise(r => setTimeout(r, 150));
  }
  ok("§3 the import finished", !!job && job.status === "done", job || start);
  const gifts = await q(`SELECT g.amount, g.type, g.event_id, g.quid_pro_quo_value, g.quid_pro_quo_desc, g.deductible_amount, g.id, d.name
                           FROM gifts g JOIN donors d ON d.id=g.donor_id WHERE g.org_id=$1 ORDER BY g.amount`, [ORG]);
  const rows = SR.gridFromText(text).slice(1).filter(r => r[0]);
  ok("§3 10 gifts, type auction, each linked to the gala", gifts.length === 10 && gifts.every(g => g.type === "auction" && g.event_id === EVENT), gifts.map(g => [g.name, g.type, g.event_id]));
  const want = new Map(rows.map(r => [String(r[0]), { paid: cents(r[3]), fmv: cents(r[4]), item: String(r[2]) }]));
  const wrong = gifts.filter(g => { const w = want.get(g.name); return !w || cents(g.amount) !== w.paid || cents(g.quid_pro_quo_value) !== w.fmv
    || cents(g.deductible_amount) !== Math.max(0, w.paid - w.fmv) || g.quid_pro_quo_desc !== w.item; });
  ok("§3 each is the amount paid, the item's value received, and deductible for the rest", gifts.length === 10 && wrong.length === 0, wrong);
  const paidTotal = rows.reduce((a, r) => a + cents(r[3]), 0);
  const rep = await call(admin, "GET", `/events/${EVENT}/report`);
  const raised = ((rep.body.figures || []).find(f => f.key === "raised") || {}).value;
  ok(`§3 the gala's Raised is what was paid ($${paidTotal / 100})`, cents(raised) === paidTotal, rep.body.figures || rep.body);
  const items = await q(`SELECT i.title, i.fmv, i.paid_gift_id, a.event_id, a.closes_at <= NOW() AS closed FROM auction_items i JOIN auctions a ON a.id=i.auction_id WHERE i.org_id=$1`, [ORG]);
  ok("§3 the 10 items are in the gala's auction, each paid by its gift, the auction closed", items.length === 10 && items.every(i => i.event_id === EVENT && i.closed
    && gifts.some(g => g.id === i.paid_gift_id && g.quid_pro_quo_desc === i.title && cents(g.quid_pro_quo_value) === cents(i.fmv))), items);
  const cabin = gifts.find(g => g.name === "Wren Halloway") || { id: "none" };
  const rc = await call(admin, "POST", `/gifts/${cabin.id}/receipt`, { send: false });
  const [rrow] = await q(`SELECT amount, deductible_amount, snapshot FROM receipts WHERE gift_id=$1 AND voided_at IS NULL`, [cabin.id]);
  const snap = rrow ? (typeof rrow.snapshot === "string" ? JSON.parse(rrow.snapshot) : rrow.snapshot) : {};
  ok("§3 the receipt: amount paid $500, value received $200, deductible $300", rc.status === 201 && cents(snap.amount) === 50000 && cents(snap.quidProQuoValue) === 20000
    && cents(snap.deductibleAmount) === 30000 && /\$300\.00/.test(snap.goodsServicesSentence || ""), { status: rc.status, snap: { amount: snap.amount, v: snap.quidProQuoValue, d: snap.deductibleAmount, s: snap.goodsServicesSentence } });

  // A sheet with no value column asks first, and never assumes.
  const noFmv = [{ name: "Auction", grid: SR.gridFromText(text.split("\n").map(l => l.split(",").slice(0, 4).join(",")).join("\n").replace(/@asks1/g, "@asks1b")) }];
  const ask = await call(admin, "POST", "/sheet-import/understand", { fileName: "auction-no-value.csv", sheets: noFmv, answers });
  const aq = (ask.body.questions || []).find(x => x.id === "auctionValue");
  ok("§3 with no value column it asks what the items were worth, and offers both answers", !!aq && ask.body.ready === false
    && aq.text === "What were these items worth? Without a value, the receipts can't say what's deductible."
    && aq.options.map(o => o.label).join("|") === "Enter values|Treat as $0 value (fully deductible)", aq);
  const refused = await call(admin, "POST", "/sheet-import/commit", { fileName: "auction-no-value.csv", sheets: noFmv, answers, previewOrgId: ORG });
  const [{ n }] = await q(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1`, [ORG]);
  ok("§3 and Import waits for the answer: nothing is written", refused.status === 409 && n === 10, { status: refused.status, n });
  const zero = await call(admin, "POST", "/sheet-import/understand", { fileName: "auction-no-value.csv", sheets: noFmv, answers: { ...answers, auctionValue: "zero" } });
  ok("§3 \"$0 value\" makes each purchase fully deductible", zero.body.ready === true && zero.body.gifts.every(g => g.auction.fmvCents === 0));

  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
