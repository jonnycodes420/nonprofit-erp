// tests/parity1-groups-journeys.test.js · PARITY-1 test 2. A GROUP BY RULE
// MOVES WITH THE MONEY, AND A JOURNEY ENROLS ONCE.
//
//   §1 A dynamic group whose rule is level=mid (giving level Mid: $1,000 to
//      $9,999.99 in the last 12 months). A donor at $900 is not in it. A $200
//      gift recorded through the real gift route (POST /donors/:id/gifts, the
//      recordGift path) takes them to $1,100 and the group's member list now
//      has them, with no stored membership to update. A $200 refund (a gift
//      with a negative amount, as the Stripe refund branch writes it) takes
//      them back under and they are gone. The group's own figures open rows
//      that foot to the figure at every step.
//   §2 A journey with the "first ever gift" trigger, switched on. A new donor's
//      first gift through the real route enrols them: one plan. A second gift:
//      still one plan. Then the trigger path is replayed: the plan is stopped,
//      both gifts are deleted and the first gift is entered again, so the
//      gift path sees gift_count = 1 and fires first_gift a second time. Still
//      one plan, because the plan holds its event (trigger_event "first_gift")
//      under a unique index.
//
// HOW IT WOULD GO RED: a group membership stored at save time and never
// re-read (§1's join and leave both fail); a refund counted as giving (§1's
// leave fails); a journey that enrols on every first-gift event rather than
// once (§2's replay makes a second plan).
//
// PROVEN ABLE TO FAIL (2026-10-02), each planted on a running server:
//   1. maybeStartJourney's event key forced to null (no "already enrolled for
//      this event" check, trigger_event written as NULL: the engine as it was
//      before PARITY-1 Part D). Red: §2 "the first gift enrols them: one
//      plan, held to its event" and §2 "the replayed first gift does not enrol
//      them a second time" (2 plans).
//   2. groups.js memberSql for a group by rule frozen at its first read (the
//      ids cached in a Map, a stored membership). Red: §1 "a $200 gift moves
//      them into the group", "the member row says Mid" and "the group and the
//      donor list's Mid filter agree".
//
// Its own fixture org (org_par1g), never the demo org. Standard scratch stack
// (tests/README.md), on the battery's own server.

const bcrypt = require("bcryptjs");
const { ok, summary, q, closeDb, login, api, civilToday, civilPlusDays } = require("./helpers");

const ORG = "org_par1g";
const ADMIN = "admin@par1g.local";
const T = civilToday();
const EARLIER = civilPlusDays(-30);
const MID = "d_par1g_mid";
const NEW = "d_par1g_new";

(async () => {
  // A clean slate: every row of this fixture org, in as many passes as the
  // foreign keys need (a gift writes drafts, ledger rows, threads and more).
  const orgTables = (await q(`SELECT table_name FROM information_schema.columns
                                WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (let pass = 0; pass < 6; pass++) {
    for (const t of orgTables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    const gone = await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false);
    if (gone) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,'Parity Groups Fixture','parity-groups-t',1,'active','team','America/New_York')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_par1g',$1,$2,$3,'Parity Admin','admin')`, [ORG, ADMIN, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO donors (id,org_id,name,email,stage,created_by,created_by_name) VALUES ($1,$2,'Mid Fixture','mid@par1g.local','cultivate','system:test','test')`, [MID, ORG]);
  await q(`INSERT INTO donors (id,org_id,name,email,stage,created_by,created_by_name) VALUES ($1,$2,'New Fixture','new@par1g.local','prospect','system:test','test')`, [NEW, ORG]);
  // The $900 already on file, a month ago.
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,created_by,created_by_name) VALUES ('g_par1g_900',$1,$2,900,$3,'system:test','test')`, [ORG, MID, EARLIER]);
  const tok = await login(ADMIN);

  // ── §1 THE GROUP BY RULE ──────────────────────────────────────────────────
  const mk = await api("POST", "/groups", tok, { name: "Mid donors", kind: "dynamic", rules: { level: "mid" } });
  ok("§1 a group by rule is made from the list's own filter", mk.status === 201 && mk.body.kind === "dynamic" && mk.body.rules.level === "mid", JSON.stringify(mk.body));
  const gid = mk.body && mk.body.id;
  const members = async () => {
    const r = await api("GET", `/groups/${gid}`, tok);
    return { status: r.status, ids: ((r.body && r.body.members) || []).map(m => m.id), body: r.body };
  };
  const foots = async (label) => {
    // Every figure on the group's page opens rows that add up to it.
    const page = (await api("GET", `/groups/${gid}`, tok)).body;
    for (const f of page.figures) {
      const p = new URLSearchParams({ ...f.source.params, pageSize: "200" }).toString();
      const r = await api("GET", `/figures/${f.source.key}/rows?${p}`, tok);
      const rows = (r.body && r.body.rows) || [];
      const sumC = rows.reduce((s, w) => s + Math.round(Number(w.amount || 0) * 100), 0);
      const pos = rows.filter(w => Number(w.amount) > 0);
      const want = f.kind === "count" ? rows.length
        : f.label === "Average gift" ? (pos.length ? Math.round(sumC / pos.length) / 100 : 0) : sumC / 100;
      ok(`${label}: "${f.label}" opens rows that foot to it`, r.status === 200 && Number(f.value) === Number(want) && r.body.value === f.value,
        `figure ${f.value}, rows ${want}, drawer ${r.body && r.body.value}`);
    }
  };

  let m = await members();
  ok("§1 at $900 the donor is not in the Mid group", m.status === 200 && !m.ids.includes(MID), m.ids.join(","));
  await foots("§1 before");

  const g200 = await api("POST", `/donors/${MID}/gifts`, tok, { amount: 200, date: T });
  ok("§1 the $200 gift is recorded through the gift route", g200.status === 201 || g200.status === 200, g200.status);
  m = await members();
  ok("§1 a $200 gift moves them into the group", m.ids.includes(MID), m.ids.join(","));
  const mine = (m.body.members || []).find(x => x.id === MID);
  ok("§1 the member row says Mid, at $1,100 in the last 12 months", mine && mine.level === "mid" && mine.last12 === 1100, JSON.stringify(mine));
  const list = await api("GET", `/donors?limit=200&level=mid`, tok);
  ok("§1 the group and the donor list's Mid filter agree", JSON.stringify(((list.body && list.body.donors) || []).map(d => d.id).sort()) === JSON.stringify(m.ids.slice().sort()));
  await foots("§1 after the gift");

  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,created_by,created_by_name) VALUES ('g_par1g_refund',$1,$2,-200,$3,'system:stripe','test')`, [ORG, MID, T]);
  m = await members();
  ok("§1 a refund back under $1,000 takes them out", !m.ids.includes(MID), m.ids.join(","));
  await foots("§1 after the refund");

  // ── §2 THE FIRST-GIFT JOURNEY, ONCE ───────────────────────────────────────
  const j = await api("POST", "/journeys", tok, { name: "Welcome, first gift", trigger: "first_gift", enabled: true,
    steps: [{ type: "thank", label: "Call to say thank you", offsetDays: 2 }] });
  ok("§2 a first-gift journey is made and switched on", j.status === 201 && j.body.enabled === true, JSON.stringify(j.body));
  const plans = async () => (await q(`SELECT id, status, trigger_event FROM cultivation_plans WHERE org_id=$1 AND donor_id=$2 AND template_id=$3`, [ORG, NEW, j.body.id]));

  const first = await api("POST", `/donors/${NEW}/gifts`, tok, { amount: 50, date: T });
  ok("§2 the first gift is recorded through the gift route", first.status === 201 || first.status === 200, first.status);
  let p = await plans();
  ok("§2 the first gift enrols them: one plan, held to its event", p.length === 1 && p[0].status === "active" && p[0].trigger_event === "first_gift", JSON.stringify(p));

  const second = await api("POST", `/donors/${NEW}/gifts`, tok, { amount: 75, date: T });
  p = await plans();
  ok("§2 a second gift does not enrol them again", second.status < 300 && p.length === 1, JSON.stringify(p));

  // Replay the trigger path: stop the plan so nothing active holds them, take
  // both gifts away and give the first gift again.
  const stop = await api("POST", `/plans/${p[0].id}/stop`, tok, {});
  ok("§2 the plan is stopped by hand", stop.status === 200, stop.status);
  for (const g of (await q(`SELECT id FROM gifts WHERE org_id=$1 AND donor_id=$2`, [ORG, NEW]))) {
    const d = await api("DELETE", `/gifts/${g.id}`, tok);
    ok(`§2 gift ${g.id} is deleted`, d.status === 200, d.status);
  }
  const [{ gift_count: gc }] = (await q(`SELECT gift_count FROM donors WHERE id=$1`, [NEW]));
  ok("§2 with no gifts left, the record counts none", Number(gc) === 0, gc);
  const again = await api("POST", `/donors/${NEW}/gifts`, tok, { amount: 50, date: T });
  const [{ gift_count: gc2 }] = (await q(`SELECT gift_count FROM donors WHERE id=$1`, [NEW]));
  ok("§2 the first gift is entered again, and it is their first again", again.status < 300 && Number(gc2) === 1, gc2);
  p = await plans();
  ok("§2 the replayed first gift does not enrol them a second time", p.length === 1, `${p.length} plans: ${JSON.stringify(p)}`);

  summary();
  await closeDb();
})().catch(async e => { console.error(e); process.exitCode = 1; await closeDb().catch(() => {}); });
