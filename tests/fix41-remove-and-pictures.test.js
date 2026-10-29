// tests/fix41-remove-and-pictures.test.js · FIX-41. ANYTHING YOU CAN ADD, YOU
// CAN REMOVE, AND EVERY PAGE AND ITEM CAN HAVE A PICTURE.
//
// Guards money and donor data: what removing a ticket type, a paid guest, an
// auction winner or a page with gifts does to the people and money on it.
//
//   §inventory every list in docs/fix-41/inventory.md that takes an add has a
//              Remove: its kind is in removal.js and its screen uses it.
//   §ticket    removing a ticket type with sales RETIRES it: the guests keep it,
//              the public page and checkout stop offering it; Undo brings it back.
//   §guest     removing a paid guest says no refund is made, makes NO call to
//              Stripe, and leaves their gift; Undo puts them back, seat and all.
//   §bulk      several guests at once: one confirm, one Undo for all.
//   §winner    removing an auction winner returns the item to unassigned and
//              never touches a payment; a paid item's winner stays.
//   §page      a page with gifts archives and cannot be deleted (also through
//              the old DELETE route); a page with none deletes; Undo restores.
//   §tenant    another org can neither read the plan nor remove.
//   §pictures  an auction item's photo shows on the row, the public page and
//              the winner email preview; page history names who saved.
//
// RED ON MAIN: no /removals routes (every § 404s), DELETE /giving-pages/:id
// hard-deleted a page with gifts, the public auction page had no alt/focal box.
const fs = require("fs");
const path = require("path");
const http = require("http");
const bcrypt = require("bcryptjs");
const h = require("./helpers");
const { ok, api, q, STRIPE_MOCK_PORT } = h;

const ORG = "org_fix41_rm";
const OTHER = "org_fix41_other";
const ADMIN = "admin@fix41-rm.test";
const OTHER_ADMIN = "admin@fix41-other.test";
const EV = "ev_fix41_gala";
const L = { vip: "el_fix41_vip", ga: "el_fix41_ga", spare: "el_fix41_spare" };
const D = { ada: "d_fix41_ada", ben: "d_fix41_ben", cy: "d_fix41_cy", dee: "d_fix41_dee" };
const ROOT = path.join(__dirname, "..");
// A datetime-local string a day either side of now, in the org's zone.
const localStamp = off => new Date(Date.now() + off).toLocaleString("sv-SE", { timeZone: "America/New_York" }).replace(" ", "T").slice(0, 16);

// Every request that reaches the Stripe stand-in. Removing anything must add none.
const stripeSeen = [];
function startStripeMock() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      stripeSeen.push(req.method + " " + req.url);
      req.resume();
      req.on("end", () => { res.setHeader("Content-Type", "application/json"); res.end("{}"); });
    });
    srv.on("error", () => resolve(null));
    srv.listen(STRIPE_MOCK_PORT, () => resolve(srv));
  });
}

async function wipe() {
  const tables = (await q(`SELECT table_name FROM information_schema.columns
                            WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (const org of [ORG, OTHER]) {
    for (let pass = 0; pass < 6; pass++) {
      for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [org]).catch(() => {});
      if (await q(`DELETE FROM orgs WHERE id=$1`, [org]).then(() => true).catch(() => false)) break;
    }
  }
}

async function fixture() {
  for (const [org, name, slug, email, uid] of [[ORG, "FIX-41 Remove", "fix41-rm", ADMIN, "u_fix41"], [OTHER, "FIX-41 Other", "fix41-other", OTHER_ADMIN, "u_fix41_o"]]) {
    // FUNDRAISING-2: a giving page opens only once the org can take money.
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,stripe_connected,stripe_account_id)
             VALUES ($1,$2,$3,1,'active','team','America/New_York',true,'acct_' || $1)`, [org, name, slug]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Fix Admin','admin')`,
      [uid, org, email, bcrypt.hashSync("loadtest1234", 4)]);
  }
  const who = ["u_fix41", "Fix Admin"];
  for (const [id, name, email] of [[D.ada, "Ada Gala", "ada@fix41.test"], [D.ben, "Ben Gala", "ben@fix41.test"], [D.cy, "Cy Bidder", "cy@fix41.test"], [D.dee, "Dee Bidder", "dee@fix41.test"]]) {
    await q(`INSERT INTO donors (id,org_id,name,email,stage,status,person_types,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,'steward','active','["donor"]'::jsonb,$5,$6)`, [id, ORG, name, email, ...who]);
  }
  await q(`INSERT INTO events (id,org_id,name,event_type,date,status,public_slug) VALUES ($1,$2,'Harbor Gala','gala',CURRENT_DATE + 30,'upcoming','fix41-gala')`, [EV, ORG])
    .catch(() => q(`INSERT INTO events (id,org_id,name,event_type,date,status) VALUES ($1,$2,'Harbor Gala','gala',CURRENT_DATE + 30,'upcoming')`, [EV, ORG]));
  for (const [id, name, price] of [[L.vip, "VIP", 250], [L.ga, "General", 75], [L.spare, "Early bird", 50]]) {
    await q(`INSERT INTO event_levels (id,org_id,event_id,kind,name,price,fmv,created_by,created_by_name) VALUES ($1,$2,$3,'ticket',$4,$5,40,$6,$7)`,
      [id, ORG, EV, name, price, ...who]);
  }
  // Three guests hold VIP; Ada paid for hers (a gift on her record), Ben did not.
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,created_by,created_by_name) VALUES ('g_fix41_ada',$1,$2,250,to_char(CURRENT_DATE,'YYYY-MM-DD'),$3,$4)`, [ORG, D.ada, ...who]);
  await q(`INSERT INTO event_tables (id,org_id,event_id,label,seats,created_by,created_by_name) VALUES ('et_fix41_t1',$1,$2,'Table 1',8,$3,$4)`, [ORG, EV, ...who]);
  await q(`INSERT INTO event_attendees (id,event_id,org_id,donor_id,name,email,status,level_id,quantity,registration_gift_id,table_id,table_label)
           VALUES ('ea_fix41_ada',$1,$2,$3,'Ada Gala','ada@fix41.test','registered',$4,2,'g_fix41_ada','et_fix41_t1','Table 1')`, [EV, ORG, D.ada, L.vip]);
  await q(`INSERT INTO event_attendees (id,event_id,org_id,donor_id,name,email,status,level_id,quantity)
           VALUES ('ea_fix41_ben',$1,$2,$3,'Ben Gala','ben@fix41.test','registered',$4,1)`, [EV, ORG, D.ben, L.vip]);
}

async function main() {
  const mock = await startStripeMock();
  await wipe();
  await fixture();
  const T = await h.login(ADMIN);
  const T2 = await h.login(OTHER_ADMIN);

  // ── §inventory ──────────────────────────────────────────────────────────
  {
    const R = require("../removal");
    const inv = fs.readFileSync(path.join(ROOT, "docs/fix-41/inventory.md"), "utf8");
    // The "Remove after FIX-41" column names a kind and the screen it is on:
    // `kind:ticket_type @ client/src/components/Events.jsx`, or an existing
    // remove that was already there: `existing:<route> @ <file>`.
    const table1 = inv.slice(inv.indexOf("## Table 1"), inv.indexOf("## Table 2"));
    const rows = table1.split("\n").filter(l => /^\|/.test(l) && /@\s*client\//.test(l));
    ok("§inventory the table lists the add-able lists", rows.length >= 20, rows.length + " rows");
    for (const r of rows) {
      const thing = r.split("|")[1].trim();
      const m = /(kind:([a-z0-9_]+)|existing:([^@|]+))\s*@\s*(client\/[\w/.-]+\.jsx)/.exec(r);
      if (!m) { ok(`§inventory ${thing}: names how it is removed`, false, r.slice(0, 160)); continue; }
      const file = path.join(ROOT, m[4]);
      const src = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
      if (m[2]) {
        ok(`§inventory ${thing}: kind ${m[2]} is in removal.js`, !!R.kindOf(m[2]));
        ok(`§inventory ${thing}: ${m[4]} removes it through the one Remove`, new RegExp(`kind[=:]\\s*["'{]*${m[2]}["'}]`).test(src) || src.includes(`"${m[2]}"`), m[4]);
      } else {
        ok(`§inventory ${thing}: ${m[4]} has its remove control`, src.length > 0 && /Remove|Delete|onDelete|remove/.test(src), m[3].trim());
      }
    }
  }

  // ── §ticket: a ticket type with sales retires ──────────────────────────
  {
    const plan = await api("GET", `/removals/ticket_type/${L.vip}`, T);
    ok("§ticket the plan answers", plan.status === 200, plan.status);
    ok("§ticket a ticket type with sales retires, it is not deleted", plan.body?.mode === "retire", plan.body?.mode);
    ok("§ticket the confirm says who holds it and that they keep their tickets",
      /3 guests hold it; they keep their tickets/.test(plan.body?.body || ""), plan.body?.body);
    ok("§ticket the confirm names the ticket type", /VIP/.test(plan.body?.title || ""), plan.body?.title);
    const before = stripeSeen.length;
    const r = await api("POST", `/removals/ticket_type/${L.vip}`, T, {});
    ok("§ticket retire answers with an Undo", r.status === 200 && Array.isArray(r.body?.undoIds) && r.body.undoIds.length === 1, JSON.stringify(r.body));
    const [lv] = await q(`SELECT retired_at, retired_by FROM event_levels WHERE id=$1`, [L.vip]);
    ok("§ticket the row is still there, retired, by whom", !!lv && !!lv.retired_at && lv.retired_by === "u_fix41", JSON.stringify(lv));
    const held = await q(`SELECT id FROM event_attendees WHERE level_id=$1 AND org_id=$2`, [L.vip, ORG]);
    ok("§ticket past guests keep it", held.length === 2, held.length);
    const pub = await api("GET", `/org/fix41-rm/event/${EV}/public`, null);
    const names = JSON.stringify(pub.body || {});
    ok("§ticket the public event page no longer offers it", pub.status === 200 && !names.includes("VIP") && names.includes("General"), pub.status + " " + names.slice(0, 200));
    const reg = await api("POST", `/events/${EV}/register`, T, { levelId: L.vip, donorId: D.cy, paid: false });
    ok("§ticket nobody new can register at it", reg.status === 400 && /retired/.test(reg.body?.error || ""), reg.status + " " + JSON.stringify(reg.body));
    const list = await api("GET", `/events/${EV}/levels`, T);
    const vip = (list.body?.levels || list.body || []).find?.(x => x.id === L.vip);
    ok("§ticket staff still see it, marked retired", !!vip && vip.retired === true, JSON.stringify(vip));
    ok("§ticket no Stripe call", stripeSeen.length === before, stripeSeen.slice(before).join(","));
    const u = await api("POST", `/removals/undo`, T, { undoIds: r.body.undoIds });
    const [lv2] = await q(`SELECT retired_at FROM event_levels WHERE id=$1`, [L.vip]);
    ok("§ticket Undo brings it back", u.status === 200 && lv2 && lv2.retired_at === null, u.status + " " + JSON.stringify(lv2));
    const again = await api("POST", `/removals/undo`, T, { undoIds: r.body.undoIds });
    ok("§ticket Undo works once", again.status === 409, again.status);
    // One nobody holds is deleted, and comes back exactly.
    const p2 = await api("GET", `/removals/ticket_type/${L.spare}`, T);
    ok("§ticket an unsold ticket type deletes", p2.body?.mode === "delete" && /Delete/.test(p2.body?.yes || ""), JSON.stringify(p2.body));
    const d2 = await api("POST", `/removals/ticket_type/${L.spare}`, T, {});
    ok("§ticket it is gone", d2.status === 200 && !(await q(`SELECT 1 FROM event_levels WHERE id=$1`, [L.spare])).length, d2.status);
    await api("POST", `/removals/undo`, T, { undoIds: d2.body.undoIds });
    const [back] = await q(`SELECT name, price::float AS price FROM event_levels WHERE id=$1`, [L.spare]);
    ok("§ticket Undo puts it back exactly", back && back.name === "Early bird" && back.price === 50, JSON.stringify(back));
    const audit = await q(`SELECT action, summary FROM fin_audit_log WHERE org_id=$1 AND entity_id=$2 ORDER BY created_at`, [ORG, L.vip]).catch(() => []);
    ok("§ticket the retire is in the audit log", audit.some(a => /Retired the VIP ticket type/.test(a.summary || "")), JSON.stringify(audit));
  }

  // ── §guest: a paid guest, removed, is not refunded ─────────────────────
  {
    const plan = await api("GET", `/removals/guest/ea_fix41_ada`, T);
    ok("§guest a guest is removed", plan.body?.mode === "delete" && /Remove/.test(plan.body?.yes || ""), JSON.stringify(plan.body));
    ok("§guest the confirm says no refund is made", /No refund is made; refund in Stripe if you need to\./.test(plan.body?.body || ""), plan.body?.body);
    const before = stripeSeen.length;
    const r = await api("POST", `/removals/guest/ea_fix41_ada`, T, {});
    ok("§guest removed", r.status === 200 && !(await q(`SELECT 1 FROM event_attendees WHERE id='ea_fix41_ada'`)).length, r.status);
    ok("§guest no refund call reaches Stripe", stripeSeen.length === before, stripeSeen.slice(before).join(","));
    const [g] = await q(`SELECT amount::float AS amount, refunded_at FROM gifts WHERE id='g_fix41_ada'`).catch(async () => q(`SELECT amount::float AS amount FROM gifts WHERE id='g_fix41_ada'`));
    ok("§guest her gift is untouched", g && g.amount === 250 && !g.refunded_at, JSON.stringify(g));
    await api("POST", `/removals/undo`, T, { undoIds: r.body.undoIds });
    const [a] = await q(`SELECT table_id, level_id, registration_gift_id FROM event_attendees WHERE id='ea_fix41_ada'`);
    ok("§guest Undo puts her back, ticket, seat and gift link", a && a.table_id === "et_fix41_t1" && a.level_id === L.vip && a.registration_gift_id === "g_fix41_ada", JSON.stringify(a));
  }

  // ── §bulk: several at once, one Undo ───────────────────────────────────
  {
    const plan = await api("POST", `/removals/guest/plan`, T, { ids: ["ea_fix41_ada", "ea_fix41_ben"] });
    ok("§bulk one confirm for both", plan.status === 200 && /Remove 2 guests\?/.test(plan.body?.title || "") && /No refund is made/.test(plan.body?.body || ""), JSON.stringify(plan.body));
    const r = await api("POST", `/removals/guest`, T, { ids: ["ea_fix41_ada", "ea_fix41_ben"] });
    ok("§bulk both removed in one go", r.status === 200 && r.body?.removed === 2 && r.body.undoIds.length === 2, JSON.stringify(r.body));
    const u = await api("POST", `/removals/undo`, T, { undoIds: r.body.undoIds });
    const n = await q(`SELECT COUNT(*)::int n FROM event_attendees WHERE event_id=$1`, [EV]);
    ok("§bulk one Undo restores both", u.status === 200 && n[0].n === 2, JSON.stringify(u.body) + " " + n[0].n);
  }

  // ── §winner: unassigned, payment untouched ─────────────────────────────
  {
    const A = await api("POST", `/auctions`, T, { title: "Gala auction", opensLocal: localStamp(-864e5), closesLocal: localStamp(864e5) });
    const aid = A.body?.auction?.id || A.body?.id;
    ok("§winner an auction", A.status < 300 && !!aid, A.status + " " + JSON.stringify(A.body).slice(0, 200));
    const it = await api("POST", `/auctions/${aid}/items`, T, { title: "Sailing day", startingBid: "100", bidIncrement: "10", fmv: "50" });
    const iid = it.body?.item?.id || it.body?.id;
    const it2 = await api("POST", `/auctions/${aid}/items`, T, { title: "Signed print", startingBid: "40", bidIncrement: "5", fmv: "20" });
    const iid2 = it2.body?.item?.id || it2.body?.id;
    const w = await api("POST", `/auction-items/${iid}/winner`, T, { donorId: D.cy, amount: "300" });
    ok("§winner recorded", w.status === 200, w.status + " " + JSON.stringify(w.body));
    const plan = await api("GET", `/removals/auction_winner/${iid}`, T);
    ok("§winner the confirm names the winner and says no payment is touched", plan.body?.mode === "unassign" && /Cy Bidder/.test(plan.body?.body || "") && /No payment is touched/.test(plan.body?.body || ""), JSON.stringify(plan.body));
    const before = stripeSeen.length;
    const r = await api("POST", `/removals/auction_winner/${iid}`, T, {});
    const det = await api("GET", `/auctions/${aid}`, T);
    const row = (det.body?.items || []).find(x => x.id === iid);
    ok("§winner the item is unassigned", r.status === 200 && row && !row.winner && !row.highBidder && row.unassigned === true, JSON.stringify(row).slice(0, 300));
    ok("§winner the bid stays on record", row && row.bidCount === 1, row && row.bidCount);
    ok("§winner no Stripe call", stripeSeen.length === before, stripeSeen.slice(before).join(","));
    await api("POST", `/removals/undo`, T, { undoIds: r.body.undoIds });
    const det2 = await api("GET", `/auctions/${aid}`, T);
    const row2 = (det2.body?.items || []).find(x => x.id === iid);
    ok("§winner Undo makes them the winner again", row2 && row2.winner && row2.winner.name === "Cy Bidder", JSON.stringify(row2 && row2.winner));
    // Paid: the winner stays, and the payment columns do not move.
    await q(`UPDATE auction_items SET paid_at=NOW(), paid_gift_id='g_fix41_paid', paid_payment_id='pi_fix41' WHERE id=$1`, [iid]);
    const p2 = await api("GET", `/removals/auction_winner/${iid}`, T);
    ok("§winner a paid item's winner stays, in words", p2.body?.mode === "refuse" && /never touches a payment/.test(p2.body?.body || ""), JSON.stringify(p2.body));
    const r2 = await api("POST", `/removals/auction_winner/${iid}`, T, {});
    const [pay] = await q(`SELECT paid_gift_id, paid_payment_id, unassigned_at FROM auction_items WHERE id=$1`, [iid]);
    ok("§winner refused, payment untouched", r2.status === 409 && pay.paid_gift_id === "g_fix41_paid" && pay.paid_payment_id === "pi_fix41" && !pay.unassigned_at, r2.status + " " + JSON.stringify(pay));
    // An item with bids retires and leaves the public page; one without deletes.
    const p3 = await api("GET", `/removals/auction_item/${iid}`, T);
    ok("§winner an item with bids retires", p3.body?.mode === "retire", JSON.stringify(p3.body));
    const p4 = await api("GET", `/removals/auction_item/${iid2}`, T);
    ok("§winner an item without bids deletes", p4.body?.mode === "delete", JSON.stringify(p4.body));
    globalThis.__fix41 = { aid, iid, iid2 };
  }

  // ── §page: gifts archive, none deletes ─────────────────────────────────
  {
    const mk = async (id, slug) => q(`INSERT INTO giving_pages (id,org_id,slug,title,status) VALUES ($1,$2,$3,$4,'active')`, [id, ORG, slug, "Page " + slug]);
    await mk("gp_fix41_gifts", "spring-gifts");
    await mk("gp_fix41_none", "spring-none");
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,giving_page_id,created_by,created_by_name) VALUES ('g_fix41_pg',$1,$2,40,to_char(CURRENT_DATE,'YYYY-MM-DD'),'gp_fix41_gifts','u_fix41','Fix Admin')`, [ORG, D.ben]);
    const old = await api("DELETE", `/giving-pages/gp_fix41_gifts`, T);
    const still = await q(`SELECT status FROM giving_pages WHERE id='gp_fix41_gifts'`);
    ok("§page the old DELETE route no longer destroys a page with gifts", still.length === 1 && old.status === 409, old.status + " " + JSON.stringify(still));
    const plan = await api("GET", `/removals/giving_page/gp_fix41_gifts`, T);
    ok("§page a page with gifts archives, never deletes", plan.body?.mode === "archive" && /archived, not deleted/.test(plan.body?.body || ""), JSON.stringify(plan.body));
    const r = await api("POST", `/removals/giving_page/gp_fix41_gifts`, T, {});
    const [pg] = await q(`SELECT status FROM giving_pages WHERE id='gp_fix41_gifts'`);
    const [gift] = await q(`SELECT giving_page_id FROM gifts WHERE id='g_fix41_pg'`);
    ok("§page archived; its gift still points at it", r.status === 200 && pg.status === "archived" && gift.giving_page_id === "gp_fix41_gifts", JSON.stringify(pg));
    await api("POST", `/removals/undo`, T, { undoIds: r.body.undoIds });
    const [pg2] = await q(`SELECT status FROM giving_pages WHERE id='gp_fix41_gifts'`);
    ok("§page Undo brings it back live", pg2.status === "active", pg2.status);
    const p2 = await api("GET", `/removals/giving_page/gp_fix41_none`, T);
    ok("§page a page with nothing through it deletes", p2.body?.mode === "delete", JSON.stringify(p2.body));
    const r2 = await api("POST", `/removals/giving_page/gp_fix41_none`, T, {});
    ok("§page gone", r2.status === 200 && !(await q(`SELECT 1 FROM giving_pages WHERE id='gp_fix41_none'`)).length, r2.status);
    await api("POST", `/removals/undo`, T, { undoIds: r2.body.undoIds });
    ok("§page Undo restores it", (await q(`SELECT 1 FROM giving_pages WHERE id='gp_fix41_none'`)).length === 1);
  }

  // ── §tenant ────────────────────────────────────────────────────────────
  {
    const a = await api("GET", `/removals/ticket_type/${L.ga}`, T2);
    const b = await api("POST", `/removals/ticket_type/${L.ga}`, T2, {});
    const c = await api("POST", `/removals/guest`, T2, { ids: ["ea_fix41_ben"] });
    const still = await q(`SELECT retired_at FROM event_levels WHERE id=$1`, [L.ga]);
    ok("§tenant another org cannot read the plan", a.status === 404, a.status);
    ok("§tenant another org cannot remove", b.status === 404 && c.status === 409 && !still[0].retired_at && (await q(`SELECT 1 FROM event_attendees WHERE id='ea_fix41_ben'`)).length === 1, b.status + " " + c.status);
    const t = await api("POST", `/removals/undo`, T2, { undoIds: ["del_nope"] });
    ok("§tenant another org cannot undo", t.status === 404, t.status);
    // A volunteer coordinator removes only what they can edit: the volunteer kinds.
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_fix41_c',$1,'coord@fix41-rm.test',$2,'Fix Coord','volunteer_coordinator')`,
      [ORG, bcrypt.hashSync("loadtest1234", 4)]);
    const TC = await h.login("coord@fix41-rm.test");
    const c1 = await api("POST", `/removals/ticket_type/${L.ga}`, TC, {});
    const c2 = await api("POST", `/volunteer-hub/removals/ticket_type/${L.ga}`, TC, {});
    const c3 = await api("GET", `/volunteer-hub/removals/shift/vs_nope`, TC);
    ok("§tenant a coordinator cannot remove a ticket type", c1.status === 403 && c2.status === 404 && !(await q(`SELECT retired_at FROM event_levels WHERE id=$1`, [L.ga]))[0].retired_at, c1.status + " " + c2.status);
    ok("§tenant a coordinator reaches the volunteer kinds", c3.status === 404 && c3.body?.error === "not_found", c3.status + " " + JSON.stringify(c3.body));
  }

  // ── §pictures ──────────────────────────────────────────────────────────
  await pictures(T);

  // ── §recent (FIX-45): Undo lasts, and Recent changes lists what can still be undone
  await recent(T, T2);

  if (mock) mock.close();
  await wipe();
}

// ── §recent (FIX-45) ──────────────────────────────────────────────────────
// The walk lost three Undos to a ten-second toast. The toast now offers a
// minute, and Recent changes lists this person's undoable changes from the
// seams that already undo them: the trash, a skipped To confirm card, a person
// added by hand. Each row carries the request that undoes it, and running it
// puts the CURRENT row back.
async function recent(T, T2) {
  await q(`INSERT INTO event_levels (id,org_id,event_id,kind,name,price,fmv,created_by,created_by_name) VALUES ('el_fix45_tmp',$1,$2,'ticket','Student',10,0,'u_fix41','Fix Admin')`, [ORG, EV]);
  const rm = await api("POST", `/removals/ticket_type/el_fix45_tmp`, T, {});
  ok("§recent a removal offers Undo for a minute, not ten seconds", rm.status === 200 && rm.body?.undoSeconds >= 60, JSON.stringify(rm.body));
  await q(`INSERT INTO capture_items (id,org_id,kind,stakes,status,source,headline,created_by) VALUES ('cap_fix45_pl',$1,'pledge','money','waiting','upload','A pledge form from Ada Gala','u_fix41')`, [ORG]);
  const sk = await api("POST", `/capture/cap_fix45_pl/skip`, T, { reason: "duplicate" });
  const skipped = await api("GET", `/capture/skipped`, T);
  ok("§recent a skipped card is listed under Skipped", sk.status === 200 && (skipped.body?.skipped || []).some(c => c.id === "cap_fix45_pl" && c.status === "skipped"), JSON.stringify(skipped.body).slice(0, 200));
  const added = await api("POST", `/donors`, T, { name: "Fay Added", email: "fay@fix45.test" });
  const list = await api("GET", `/recent-changes`, T);
  const rows = list.body?.rows || [];
  const byId = id => rows.find(r => r.id === id);
  const rmRow = byId(rm.body?.undoIds?.[0]), skRow = byId("skip:cap_fix45_pl"), addRow = byId("add:" + added.body?.id);
  ok("§recent Recent changes lists the removal, the skipped card and the added person, newest first, each with its Undo",
    list.status === 200 && !!rmRow && !!skRow && !!addRow && rmRow.undo?.path === "/removals/undo" && skRow.undo?.path === "/capture/cap_fix45_pl/unskip"
      && addRow.undo?.method === "DELETE" && rows.indexOf(addRow) < rows.indexOf(rmRow) && rows.length <= 50,
    JSON.stringify(rows.map(r => [r.id, r.sentence])).slice(0, 400));
  ok("§recent each row says what it was in words", /Student/.test(rmRow?.sentence || "") && /Ada Gala/.test(skRow?.sentence || "") && /Fay Added/.test(addRow?.sentence || ""),
    JSON.stringify([rmRow?.sentence, skRow?.sentence, addRow?.sentence]));
  const other = await api("GET", `/recent-changes`, T2);
  ok("§recent another org sees none of it", other.status === 200 && !(other.body?.rows || []).some(r => [rmRow?.id, skRow?.id, addRow?.id].includes(r.id)), JSON.stringify(other.body).slice(0, 200));
  const run = r => api(r.undo.method, r.undo.path, T, r.undo.body);
  const u1 = await run(rmRow), u2 = await run(skRow), u3 = await run(addRow);
  const [lv] = await q(`SELECT 1 AS n FROM event_levels WHERE id='el_fix45_tmp'`);
  const [cp] = await q(`SELECT status FROM capture_items WHERE id='cap_fix45_pl'`);
  const [fd] = await q(`SELECT deleted_at FROM donors WHERE id=$1`, [added.body?.id]);
  ok("§recent each Undo from the list puts it back: the ticket type, the card (waiting again), the person taken out",
    u1.status === 200 && u2.status === 200 && u3.status === 200 && !!lv && cp?.status === "waiting" && !!fd?.deleted_at,
    `${u1.status} ${u2.status} ${u3.status} ${!!lv} ${cp?.status} ${fd?.deleted_at}`);
  const after = await api("GET", `/recent-changes`, T);
  ok("§recent what was undone leaves the list", !(after.body?.rows || []).some(r => [rmRow?.id, skRow?.id, addRow?.id].includes(r.id)),
    JSON.stringify((after.body?.rows || []).map(r => r.id)));
}

// ── §pictures (Part 2) ────────────────────────────────────────────────────
// One upload door, one picture shape { url, alt, fx, fy }: an auction item's
// photo shows on the staff row, on the public auction page (with its words and
// in a fixed box, cropped from its focal point) and in the winner's note; a
// page cover drafted in the editor records WHO saved it; nobody else's org can
// point a picture at a row that is not theirs.
async function pictures(T) {
  const img = "data:image/jpeg;base64," + fs.readFileSync(path.join(ROOT, "scripts/demo-assets/auction-camera.jpg")).toString("base64");
  const up = await api("POST", "/pictures/upload", T, { image: img });
  ok("§pictures a photo uploads through the one door", up.status === 200 && /^\/portal-assets\/pa_[a-f0-9]{24}$/.test(up.body?.url || ""), up.status + " " + JSON.stringify(up.body));
  const notImage = await api("POST", "/pictures/upload", T, { image: "data:image/png;base64,AAAA" });
  ok("§pictures a file that is not an image is refused in words", notImage.status === 400 && /image/i.test(notImage.body?.message || ""), notImage.status);

  // An auction item with a photo: the row, the public page, the winner's note.
  await q(`INSERT INTO auctions (id,org_id,title,public_slug,opens_at,closes_at,created_by,created_by_name)
           VALUES ('auc_fix41',$1,'Harbor auction','fix41-auction',NOW() - INTERVAL '1 day',NOW() + INTERVAL '3 days','u_fix41','Fix Admin')`, [ORG]);
  const add = await api("POST", "/auctions/auc_fix41/items", T, { title: "Sunset sail", startingBid: "100", bidIncrement: "10", fmv: "50",
    photos: [{ url: up.body.url, alt: "", fx: 0.2, fy: 0.8 }] });
  ok("§pictures an item saves with its photo", add.status === 200 && !!add.body?.id, add.status + " " + JSON.stringify(add.body));
  const det = await api("GET", "/auctions/auc_fix41", T);
  const row = (det.body?.items || []).find(i => i.id === add.body?.id) || {};
  const ph = (row.photos || [])[0] || {};
  ok("§pictures the staff row carries the photo, its words defaulted to the item's name", ph.url === up.body.url && ph.alt === "Sunset sail" && ph.fx === 0.2 && ph.fy === 0.8, JSON.stringify(row.photos));
  const html = await (await fetch(`${h.BASE}/auction/fix41-auction`)).text();
  const card = html.slice(html.indexOf(`data-item="${add.body?.id}"`));
  ok("§pictures the public auction page shows it with its words, in a fixed box, from its focal point",
    card.includes(up.body.url) && card.includes('alt="Sunset sail"') && /aspect-ratio:4 \/ 3/.test(card) && /object-fit:cover;object-position:20% 80%/.test(card), card.slice(0, 300));
  const pv = await api("GET", `/auction-items/${add.body?.id}/winner-preview`, T);
  ok("§pictures the winner email preview leads with the item's photo", pv.status === 200 && pv.body?.photo?.url === up.body.url && /Sunset sail/.test(pv.body?.subject || ""), pv.status + " " + JSON.stringify(pv.body).slice(0, 200));
  const five = await api("PUT", `/auction-items/${add.body?.id}`, T, { photos: Array.from({ length: 7 }, () => ({ url: up.body.url })) });
  const kept = await q(`SELECT jsonb_array_length(photos) AS n FROM auction_items WHERE id=$1`, [add.body?.id]);
  ok("§pictures an item keeps at most five photos", five.status === 200 && kept[0].n === 5, five.status + " " + kept[0]?.n);

  // FIX-45: Undo brings a removed item back WITH its photos. While the item sat
  // in the trash nothing pointed at its picture, so a prune of that kind may
  // have marked it deleted (the retention window: bytes kept, URL 404). The
  // plant below is exactly that mark; Undo must clear it.
  const assetId = up.body.url.slice("/portal-assets/".length);
  const gone = await api("POST", `/removals/auction_item/${add.body?.id}`, T, {});
  await q(`UPDATE portal_assets SET deleted_at = NOW() WHERE id=$1`, [assetId]);
  const dark = await fetch(`${h.BASE}${up.body.url}`);
  const back = await api("POST", `/removals/undo`, T, { undoIds: gone.body?.undoIds });
  const lit = await fetch(`${h.BASE}${up.body.url}`);
  const backRow = await q(`SELECT jsonb_array_length(photos) AS n FROM auction_items WHERE id=$1`, [add.body?.id]);
  ok("§pictures (FIX-45) Undo of a removed auction item brings back its photos, not only the row",
    gone.body?.mode === "delete" && dark.status === 404 && back.status === 200 && backRow[0]?.n === 5 && lit.status === 200,
    `mode ${gone.body?.mode} before-undo ${dark.status} undo ${back.status} photos ${backRow[0]?.n} after ${lit.status}`);

  // A page cover drafted in the editor names who saved it. Before FIX-41 only
  // Publish wrote the pointer history, so a draft cover had no author on record.
  await q(`INSERT INTO giving_pages (id,org_id,slug,title,story,image_url,status) VALUES ('gp_fix41_pic',$1,'fix41-pic','Spring','','','active')`, [ORG]);
  const t0 = new Date();
  const ds = await api("PUT", "/giving-pages/gp_fix41_pic/page/settings", T, { settings: { imageUrl: up.body.url, imageMeta: { alt: "Boats", fx: 0.5, fy: 0.3 } } });
  const hist = await q(`SELECT actor_user_id, actor_email FROM asset_pointer_history
                         WHERE org_id=$1 AND entity='giving_page.draft_image' AND entity_id='gp_fix41_pic' AND created_at >= $2`, [ORG, t0]);
  ok("§pictures a drafted page cover records who saved it", ds.status === 200 && hist.length === 1 && hist[0].actor_user_id === "u_fix41" && hist[0].actor_email === ADMIN,
    ds.status + " " + JSON.stringify(hist));
  const pub = await api("POST", "/giving-pages/gp_fix41_pic/page/publish", T, {});
  const pg = await api("GET", "/org/fix41-rm/giving-page/fix41-pic/public", null);
  ok("§pictures the published cover reaches the public page with its words and focus", pub.status === 200 && pg.body?.givingPage?.cover?.url === up.body.url
    && pg.body.givingPage.cover.alt === "Boats" && pg.body.givingPage.cover.fy === 0.3, pub.status + " " + JSON.stringify(pg.body?.givingPage?.cover));

  // A ticket type's small picture: saved, shown, and out of reach of another org.
  const lv = await api("PUT", `/pictures/event_level/${L.vip}`, T, { picture: { url: up.body.url } });
  ok("§pictures a ticket type takes a small picture", lv.status === 200 && lv.body?.picture?.alt === "VIP", lv.status + " " + JSON.stringify(lv.body));
  const T2 = await h.login(OTHER_ADMIN);
  const cross = await api("PUT", `/pictures/event_level/${L.ga}`, T2, { picture: { url: up.body.url } });
  const borrowed = await api("PUT", `/pictures/membership_cover/org`, T2, { picture: { url: up.body.url } });
  ok("§pictures another org can neither picture our row nor borrow our photo", cross.status === 404 && borrowed.status === 400, cross.status + " " + borrowed.status);
}

main().catch(e => { ok("suite ran", false, e.stack); }).finally(async () => { h.summary(); await h.closeDb(); });
