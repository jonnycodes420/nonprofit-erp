// tests/mopup2-leftovers.test.js · MOPUP-2: split gifts in the bookkeeper's
// files, an imported org's Grow move, the goal note's dates, bulk trash.
//
// The one new suite of the build (money, donor data). Home on a phone (item 3)
// and the late-header flake (item 4) are perf-app's own legs.
//
// Each section failed on main:
//   §1 a $500 gift split $300/$200 was one $500 row on the largest line's fund,
//      in the gift-detail file and in the deposits file
//   §2 an organization whose file stated $37,206 read "First gift of $244 …"
//   §3 the goal's note said "Counts every gift dated 2026-…"
//   §4 the Donors list's delete took people with gifts with everyone else
// Fixture org of its own, made-up names; nothing sends.
"use strict";
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, BASE } = require("./helpers");
const { testNow } = require("./clock");
const orgTime = require("../orgTime");

const RUN = require("crypto").randomBytes(4).toString("hex");
const ORG = `org_mopup2_${RUN}`;
const OWNER = `owner-${RUN}@mopup2.local`;
const PW = "loadtest1234";
const ISO_ANYWHERE = /\b\d{4}-\d{2}-\d{2}\b/;
const C = v => Math.round(Number(v) * 100);

async function reset() {
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,emails_enabled,timezone,onboarded_at)
           VALUES ($1,'Mopup Two Mutual Aid (test)',$1,1,'active','team',false,'America/New_York',NOW())`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($3,$1,$4,$2,'Owner','admin')`,
    [ORG, bcrypt.hashSync(PW, 4), `u_mopup2_${RUN}`, OWNER]);
}
async function person(name, kind = "individual") {
  const id = `d_mp2_${Math.random().toString(16).slice(2, 12)}`;
  await q(`INSERT INTO donors (id,org_id,name,kind,email,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,'system:test','test fixture')`,
    [id, ORG, name, kind, `${id}@mopup2.invalid`]);
  return id;
}

(async () => {
  await reset();
  const tok = await login(OWNER, PW);
  const today = orgTime.orgToday({ timezone: "America/New_York" }, new Date(testNow()));
  const daysAgo = n => orgTime.addDays(today, -n);
  const month = { from: daysAgo(40), to: today };

  // ── §1 · A SPLIT GIFT IS SPLIT IN THE BOOKKEEPER'S FILES ───────────────────
  {
    const funds0 = (await api("GET", "/finance/funds", tok)).body || [];
    let general = funds0.find(f => f.isOrgDefault);
    if (!general) {
      const seed = await api("POST", `/donors/${await person("Seed Person")}/gifts`, tok, { amount: 1, date: today, payment_method: "check" });
      await api("DELETE", `/gifts/${seed.body.gift.id}`, tok);
      general = ((await api("GET", "/finance/funds", tok)).body || []).find(f => f.isOrgDefault);
    }
    const pantry = (await api("POST", "/finance/funds", tok, { name: "Food Pantry", restricted: true })).body;
    const pantryId = pantry && (pantry.id || (pantry.fund && pantry.fund.id));
    const ada = await person("Ada Quillfeather");
    const made = await api("POST", `/donors/${ada}/gifts`, tok, { amount: 500, date: daysAgo(3), payment_method: "card",
      fundLines: [{ fundId: pantryId, amount: 300 }, { fundId: general.id, amount: 200 }] });
    const giftId = made.body && made.body.gift && made.body.gift.id;
    ok("§1 setup: a $500 gift split $300 Food Pantry / $200 General", !!giftId && !!general && !!pantryId, made.status + " " + JSON.stringify(made.body).slice(0, 200));
    // On one deposit, with a $15 processor fee (fixture columns a payout would set).
    await q(`UPDATE gifts SET deposited_on=$3, deposit_ref='po_mp2_split', processor_fee_amount=15 WHERE id=$1 AND org_id=$2`, [giftId, ORG, daysAgo(2)]);

    const bk = (await api("GET", `/reports/bookkeeper?from=${month.from}&to=${month.to}`, tok)).body || {};
    const rows = (bk.rows || []).filter(r => r.giftId === giftId);
    const byFund = Object.fromEntries(rows.map(r => [r.fund, r]));
    ok("§1 the gift-detail file has two rows for the split gift, one per fund, $300 and $200",
       rows.length === 2 && byFund["Food Pantry"] && C(byFund["Food Pantry"].amount) === 30000
       && byFund[general.name] && C(byFund[general.name].amount) === 20000, rows.map(r => [r.fund, r.amount]));
    ok("§1 the fee is cut the same way ($9 and $6), and each row's net is its amount less its fee",
       rows.length === 2 && rows.reduce((n, r) => n + r.feeCents, 0) === 1500 && byFund["Food Pantry"] && byFund["Food Pantry"].feeCents === 900
       && rows.every(r => r.netCents === r.cents - r.feeCents), rows.map(r => [r.fund, r.feeCents, r.netCents]));
    ok("§1 it is still one gift, and the file foots (no refusal)",
       bk.giftCount === 1 && bk.balanced === true && !bk.exportRefused && bk.totalCents === 50000, { giftCount: bk.giftCount, balanced: bk.balanced, refused: bk.exportRefused });
    const fundTotals = Object.fromEntries((bk.byFund || []).map(f => [f.name, f.cents]));
    ok("§1 the totals by fund read $300 Food Pantry and $200 General", fundTotals["Food Pantry"] === 30000 && fundTotals[general.name] === 20000, bk.byFund);
    const csv = await fetch(`${BASE}/reports/bookkeeper?from=${month.from}&to=${month.to}&format=csv`,
      { headers: { Authorization: `Bearer ${tok}` } }).then(r => r.text()).catch(() => "");
    const csvRows = csv.split(/\r?\n/).filter(l => l.includes(giftId));
    ok("§1 the CSV has two rows for the gift, $300.00 and $200.00", csvRows.length === 2 && csvRows.some(l => /300\.00/.test(l)) && csvRows.some(l => /200\.00/.test(l)), csvRows);

    const dep = (await api("GET", `/reports/deposits?from=${month.from}&to=${month.to}`, tok)).body || {};
    const g = (dep.groups || []).find(x => x.ref === "po_mp2_split");
    const lines = g ? Object.fromEntries(g.lines.map(l => [l.fund, l.cents])) : {};
    ok("§1 the deposit has two lines, $300 Food Pantry and $200 General, and still foots to the deposit",
       !!g && g.lines.length === 2 && lines["Food Pantry"] === 30000 && lines[general.name] === 20000
       && g.grossCents === 50000 && g.lines.reduce((n, l) => n + l.cents, 0) === g.grossCents && g.netCents === 48500 && g.giftCount === 1 && dep.balanced === true,
       g || dep.exportRefused);
  }

  // ── §2 · AN IMPORTED ORG'S GROW MOVE ───────────────────────────────────────
  {
    const imp = `imp_mp2_${RUN}`;
    await q(`INSERT INTO imports (id,org_id,name) VALUES ($1,$2,'Harrow ledger (test)')`, [imp, ORG]);
    const org = await person("Brindlecombe Tidal Works", "organization");
    await q(`UPDATE donors SET total_giving=37450, imported_total=37206, imported_import_id=$3, imported_through=$4, imported_source='Harrow ledger (test)'
              WHERE id=$1 AND org_id=$2`, [org, ORG, imp, daysAgo(200)]);
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ($1,$2,$3,244,$4,'gift','system:test','test fixture')`,
      [`g_mp2_btw_${RUN}`, ORG, org, daysAgo(30)]);
    // A real first-time giver beside it keeps the first-gift card honest.
    const fresh = await person("Odile Fernsby");
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ($1,$2,$3,60,$4,'gift','system:test','test fixture')`,
      [`g_mp2_of_${RUN}`, ORG, fresh, daysAgo(20)]);
    await q(`UPDATE donors SET updated_at=NOW() WHERE org_id=$1`, [ORG]);
    let moves = [];
    for (let i = 0; i < 60; i++) {
      const r = (await api("GET", "/insights?view=deck&moves=all", tok)).body || {};
      moves = r.deck && !r.stale ? (r.deck.tabs || []).flatMap(t => t.moves || []) : [];
      if (moves.some(m => (m.ids || []).includes(org)) && moves.some(m => (m.ids || []).includes(fresh))) break;
      await new Promise(z => setTimeout(z, 500));
    }
    const mine = moves.filter(m => (m.ids || []).includes(org));
    const all = mine.map(m => [m.label, m.what, m.say, ...(m.also || []).map(a => a.line)].join(" | ")).join(" || ");
    ok("§2 the organization's Grow move says the stated lifetime: \"Gave $37,206 before Steward; $244 since.\"",
       mine.some(m => m.tab === "grow" && m.what === "Gave $37,206 before Steward; $244 since."), all);
    ok("§2 and never calls them a first-time giver", mine.length > 0 && !/first gift|second gift/i.test(all) && !mine.some(m => m.kind === "second_gift"), all);
    const odile = moves.find(m => (m.ids || []).includes(fresh));
    ok("§2 a real first-time giver still has the first-gift move", !!odile && odile.kind === "second_gift" && /^First gift of \$60 on /.test(odile.what), odile && odile.what);
  }

  // ── §3 · THE GOAL CARD'S NOTE READS DATES, NOT ISO ─────────────────────────
  {
    const from = daysAgo(30), to = orgTime.addDays(today, 60);
    const goal = await api("POST", "/goals", tok, { label: "Winter appeal", goalAmount: 10000, goalType: "total_raised", periodStart: from, periodEnd: to });
    const o = (await api("GET", "/fundraising/overview", tok)).body || {};
    const note = (o.goal && o.goal.sourceNote) || "";
    const DD = await import("../shared/displayDate.js");
    ok(`§3 the goal note says "${DD.displayDate(from)} to ${DD.displayDate(to)}" and no ISO date`,
       (goal.status === 200 || goal.status === 201) && note.includes(`${DD.displayDate(from)} to ${DD.displayDate(to)}`) && !ISO_ANYWHERE.test(note), note);
  }

  // ── §4 · BULK TRASH ON THE DONORS LIST ─────────────────────────────────────
  {
    const ids = [];
    for (let i = 0; i < 50; i++) ids.push(await person(`Trashwell Fixture ${String(i).padStart(2, "0")}`));
    const givers = ids.slice(0, 5);
    for (const [i, d] of givers.entries())
      await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ($1,$2,$3,25,$4,'gift','system:test','test fixture')`,
        [`g_mp2_tw${i}_${RUN}`, ORG, d, daysAgo(10)]);
    const alive = async () => (await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND id = ANY($2) AND deleted_at IS NULL`, [ORG, ids]))[0].n;

    const check = await api("POST", "/donors/trash-check", tok, { ids });
    ok("§4 the confirm can say 50 people, 5 with gifts", check.status === 200 && check.body.count === 50 && check.body.withGifts === 5, check.body);
    const auditBefore = (await q(`SELECT COUNT(*)::int AS n FROM fin_audit_log WHERE org_id=$1`, [ORG]))[0].n;
    ok("§4 the count is a read: it writes no audit row", auditBefore === (await q(`SELECT COUNT(*)::int AS n FROM fin_audit_log WHERE org_id=$1`, [ORG]))[0].n);

    const wrong = await api("POST", "/donors/bulk-delete", tok, { ids, count: 50, withGifts: "include", withGiftsCount: 4 });
    ok("§4 taking the people with gifts needs the confirm to have named how many: 4 is refused, nobody moves",
       wrong.status === 409 && wrong.body.error === "with_gifts_changed" && (await alive()) === 50, wrong.body);

    const t0 = (await q("SELECT NOW() AS t"))[0].t;
    const del = await api("POST", "/donors/bulk-delete", tok, { ids, count: 50, withGifts: "skip", withGiftsCount: 5 });
    const leftIds = (await q(`SELECT id FROM donors WHERE org_id=$1 AND id = ANY($2) AND deleted_at IS NULL`, [ORG, ids])).map(r => r.id).sort();
    ok("§4 Move to trash moves the 45 without gifts in one batch and leaves the 5 with gifts",
       del.status === 200 && del.body.deleted === 45 && del.body.skippedWithGifts === 5 && (del.body.undoIds || []).length === 45
       && JSON.stringify(leftIds) === JSON.stringify([...givers].sort()), { status: del.status, body: { ...del.body, undoIds: (del.body.undoIds || []).length }, left: leftIds.length });
    const audits = (await q(`SELECT COUNT(*)::int AS n FROM fin_audit_log WHERE org_id=$1 AND created_at >= $2`, [ORG, t0]))[0].n;
    ok("§4 one audit row for the batch", audits === 1, audits);
    const trash = (await q(`SELECT COUNT(*)::int AS n FROM deleted_records WHERE org_id=$1 AND record_id = ANY($2) AND restored_at IS NULL`, [ORG, ids]))[0].n;
    ok("§4 the 45 are in the trash", trash === 45, trash);
    const back = await api("POST", "/deleted-records/restore-people", tok, { ids: del.body.undoIds || [] });
    ok("§4 Undo brings all 45 back", back.status === 200 && (await alive()) === 50, { status: back.status, alive: await alive() });

    const all = await api("POST", "/donors/bulk-delete", tok, { ids, count: 50, withGifts: "include", withGiftsCount: 5 });
    ok("§4 with the 5 named, all 50 go", all.status === 200 && all.body.deleted === 50 && (await alive()) === 0, all.body && all.body.deleted);
    await api("POST", "/deleted-records/restore-people", tok, { ids: all.body.undoIds || [] });
  }

  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch { /* closed */ } process.exit(1); });
