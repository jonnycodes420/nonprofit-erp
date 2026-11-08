// tests/truth2-money-counts.test.js — TRUTH-2. DONOR-FACING MONEY IS NEVER
// WRONG, AND EVERY COUNT AGREES TO THE LAST PERSON.
//
// Walk A (5 Nov, evening) found a milestone thank-you saying "your giving has
// now reached $12,500" to a person whose lifetime was $21,000, and counts one
// apart on two screens. This suite builds the shapes that did it, in its own
// org with made-up people, and asks the real routes:
//   §1 three milestone moments (one note, two drafts) for people whose stored
//      donors.total_giving is stale: every figure is shared/numbers' lifetime;
//      a stored draft whose figure went stale is refused at Send, with why
//   §2 a person whose only gift this year is $0 is no donor this year:
//      Fundraising, the Giving summary, LYBUNT and SYBUNT and the group page
//      agree, by the rules in shared/numbers (money.GIVERS, bunt.js)
//   §3 LYBUNT's header total is its rows' total
//   §5 an erased person is in no count (Everyone, the roster, givers, LYBUNT)
//      and their gifts stay in the money
//   §6 a $0 gift can be deleted; a receipted one says why not, the receipt is
//      voided with a note kept, and its number is never issued again
//
// HOW IT GOES RED (planted, see the PR): figuresForDraft reading
// donors.total_giving turns §1 red; givingBetween counting every money row
// turns §2 red; buntPredicate counting any row turns §2 and §3 red.
"use strict";
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, mailTypesOn } = require("./helpers");
const { testNow } = require("./clock");
const orgTime = require("../orgTime");
const { assertSurfacesAgree } = require("./lib/surfacesAgree");

// One org per run (its own id, its own owner), so a rerun never meets the last run's rows.
const RUN = require("crypto").randomBytes(4).toString("hex");
const ORG = `org_truth2_${RUN}`;
const OWNER = `owner-${RUN}@truth2.local`;
const MD = `md_t2_${RUN}`, RCP = `rcp_t2_${RUN}`;
const PW = "loadtest1234";
// helpers.q takes $n; shared/numbers is written for the app's `?` query.
const qq = (sql, args) => { let i = 0; return q(sql.replace(/\?/g, () => `$${++i}`), args); };

async function reset() {
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,emails_enabled,timezone,onboarded_at)
           VALUES ($1,'Truth Two Trust',$1,1,'active','team',true,'America/New_York',NOW())`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($3,$1,$4,$2,'Owner','admin')`,
    [ORG, bcrypt.hashSync(PW, 10), `u_truth2_${RUN}`, OWNER]);
  await mailTypesOn(ORG);
}

// The way a draft writes a figure: "$21,000", "$1,050.50".
const usd = v => "$" + Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: Number(v) % 1 ? 2 : 0, maximumFractionDigits: 2 });

(async () => {
  await reset();
  const tok = await login(OWNER, PW);
  const today = orgTime.orgToday({ timezone: "America/New_York" }, new Date(testNow()));
  // The org's own years (fiscal, as Reports, Fundraising and Groups default
  // to), read from the report, so no fixture date sits on a year's edge.
  const span = (await api("GET", "/reports/lybunt", tok)).body;
  const cur = span.currentPeriod, prior = span.priorPeriod;
  // A gift "this year" is dated the year's first day (never after today); "last year", that year's first day.
  const thisYear = () => cur.from, lastYear = () => prior.from;
  const person = async (name, extra = {}) => {
    const r = await api("POST", "/donors", tok, { name, email: `${name.split(" ")[0].toLowerCase()}-${RUN}@truth2.invalid`, ...extra });
    ok(`${name} exists`, !!(r.body && r.body.id), r.status + " " + JSON.stringify(r.body).slice(0, 200));
    return r.body.id;
  };
  const gift = async (id, amount, date) => {
    const r = await api("POST", `/donors/${id}/gifts`, tok, { amount, date });
    ok(`a ${usd(amount)} gift for ${id} on ${date}`, r.status === 200 || r.status === 201, r.status + " " + JSON.stringify(r.body).slice(0, 200));
    return r.body && (r.body.id || (r.body.gift && r.body.gift.id));
  };
  // A row the gift form refuses ($0) arrives by an import or a webhook. Fixture only.
  const zeroGift = (id, date, gid) => q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name)
                                         VALUES ($1,$2,$3,0,$4,'gift','system:test','test fixture')`, [gid, ORG, id, date]);

  // ── §1 · THE FIGURES IN A DRAFT ARE THE ONE LIFETIME ────────────────────
  // The walk's three: stated $12,500 / $1,050 / $3,200; true $21,000 / $16,050 / $11,200.
  const walk = [
    { name: "Wren Halloway",   gifts: [[12500, lastYear("03-02")], [8500, thisYear("01-03")]], stale: 12500, key: "threshold_10000" },
    { name: "Ansel Moorcroft", gifts: [[1050, lastYear("05-06")], [15000, thisYear("01-04")]], stale: 1050,  key: "threshold_2500" },
    { name: "Tamsin Ridley",   gifts: [[3200, lastYear("06-07")], [8000, thisYear("01-05")]],  stale: 3200,  key: "threshold_1000" },
  ];
  for (const w of walk) {
    w.id = await person(w.name);
    for (const [a, d] of w.gifts) await gift(w.id, a, d);
    // The stored column left behind (an old seed, a missed recompute): the
    // number a draft must never read.
    await q(`UPDATE donors SET total_giving=$1 WHERE id=$2 AND org_id=$3`, [w.stale, w.id, ORG]);
    // The truth, from the rows and no app code: every gift on file (none is imported here).
    w.truth = Number((await q(`SELECT COALESCE(SUM(amount),0)::numeric AS v FROM gifts WHERE org_id=$1 AND donor_id=$2`, [ORG, w.id]))[0].v);
  }
  ok("§1 the fixture: three lifetimes are $21,000, $16,050 and $11,200, from their gifts",
    walk.map(w => w.truth).join(",") === "21000,16050,11200", walk.map(w => w.truth).join(","));
  await q(`INSERT INTO sequences (id,org_id,name,trigger,status,created_by,created_by_name) VALUES ($2,$1,'Milestones','milestone','active','system:test','test')`, [ORG, `seq_t2_${RUN}`]);
  await q(`INSERT INTO sequence_steps (id,sequence_id,step_order,delay_days,subject,body) VALUES ($1,$2,0,0,'Milestone email (AI-drafted per donor)','')`, [`ss_t2_${RUN}`, `seq_t2_${RUN}`]);
  for (const w of walk) {
    const t = Number(w.key.split("_")[1]);
    await q(`INSERT INTO sequence_enrollments (id,sequence_id,org_id,donor_id,status,next_send_at,current_step,metadata)
             VALUES ($1,$5,$2,$3,'active',NOW() - INTERVAL '1 minute',0,$4)`,
      [`se_t2_${w.id}`, ORG, w.id, JSON.stringify({ milestone_key: w.key, milestone_type: "threshold", threshold: t }), `seq_t2_${RUN}`]);
  }
  const run = await api("POST", "/sequences/process", tok, {});
  ok("§1 the milestone job runs", run.status === 200, run.status + " " + JSON.stringify(run.body));
  // TRUTH-3: stored words hold figure keys; what she reads is the rendered note and draft.
  const note = ((await api("GET", "/note-reminders", tok)).body || []).find(r => r.donor_id === walk[0].id);
  const points = note ? note.talking_points || [] : [];
  ok(`§1 ${walk[0].name}'s note says ${usd(walk[0].truth)} total, not the stored ${usd(walk[0].stale)}`,
    points.some(p => p.includes(`${usd(walk[0].truth)} total`)) && !points.join(" ").includes(usd(walk[0].stale)), JSON.stringify(points));
  for (const w of walk.slice(1)) {
    const d = ((await api("GET", "/milestone-drafts", tok)).body || []).find(r => r.donor_id === w.id);
    const text = d ? `${d.subject}\n${d.body}` : "(no draft)";
    ok(`§1 ${w.name}'s draft states ${usd(w.truth)}, read from shared/numbers, never the stored ${usd(w.stale)}`,
      !!d && text.includes(usd(w.truth)) && !text.includes(usd(w.stale)), text);
  }
  const list = await api("GET", "/milestone-drafts", tok);
  const row = (list.body || []).find(r => r.donor_id === walk[2].id);
  ok("§1 the drafts list shows the person's lifetime by the one rule", row && Number(row.donor_total_giving) === walk[2].truth, row && row.donor_total_giving);

  // A draft made days ago, before the last gift: its figure is stale now.
  await q(`INSERT INTO milestone_drafts (id,org_id,donor_id,milestone_key,subject,body,status)
           VALUES ($4,$1,$2,'threshold_1000','Tamsin, a quick thank you',$3,'pending_review')`,
    [ORG, walk[2].id, `Tamsin, I wanted to let you know you've now given ${usd(walk[2].stale)} with us. Your gift of $4,444 last spring made it possible. Thank you.`, MD]);
  // TRUTH-3: a stored total is re-rendered every time the draft opens (and at
  // Send), so the stale total reads true; a figure about one gift that is not
  // theirs is still refused at Send, with the figure named.
  const opened = ((await api("GET", "/milestone-drafts", tok)).body || []).find(r => r.id === MD) || {};
  ok("§1 the stored stale total opens as the true lifetime (TRUTH-3 re-render)",
    String(opened.body).includes(`now given ${usd(walk[2].truth)}`) && !String(opened.body).includes(usd(walk[2].stale)), opened.body);
  const send = await api("POST", `/milestone-drafts/${MD}/send`, tok, {});
  ok("§1 Send refuses a draft whose giving figure is not theirs today, and says which figure",
    send.status === 409 && send.body && send.body.code === "stale_figure" && String(send.body.error).includes("$4,444"), send.status + " " + JSON.stringify(send.body));
  const [still] = await q(`SELECT status FROM milestone_drafts WHERE id=$1`, [MD]);
  ok("§1 the refused draft is still waiting for her, unsent", still && still.status === "pending_review", still && still.status);
  // The stale column was §1's shape; the rest of the file starts true again.
  for (const w of walk) await q(`UPDATE donors SET total_giving=$1 WHERE id=$2 AND org_id=$3`, [w.truth, w.id, ORG]);

  // ── §2 · ONE DONOR COUNT, ONE LYBUNT, ONE SYBUNT ────────────────────────
  // Odile gave last year and this year only a $0 row: no donor this year, on
  // LYBUNT, on SYBUNT, everywhere alike.
  const odile = await person("Odile Fenwick");
  await gift(odile, 640, lastYear("09-10"));
  await zeroGift(odile, thisYear("01-06"), `g_t2_zo_${RUN}`);
  const lapsed = await person("Piers Ashdown");      // a plain LYBUNT person
  await gift(lapsed, 900, lastYear("10-11"));
  const older = await person("Hester Quill");        // SYBUNT, not LYBUNT
  await gift(older, 300, orgTime.addDays(prior.from, -800));

  const ov = await api("GET", "/fundraising/overview", tok);
  const gs = await api("GET", "/reports/giving-summary", tok);
  const fy = { from: cur.from, to: today };
  const [keyGivers] = await qq(`SELECT COUNT(DISTINCT g.donor_id)::int AS n FROM gifts g JOIN donors d ON d.id=g.donor_id AND d.org_id=g.org_id
                                 WHERE g.org_id=? AND d.deleted_at IS NULL AND d.erased_at IS NULL AND g.amount > 0 AND g.date >= ? AND g.date <= ?`, [ORG, fy.from, fy.to]);
  const fr = ov.body && ov.body.period && ov.body.period.donorCount;
  const gsN = gs.body && gs.body.figures && gs.body.figures.uniqueDonors && gs.body.figures.uniqueDonors.value;
  ok(`§2 donor count, rule "a gift above $0 this year": Fundraising ${fr} = Giving summary ${gsN} = Giving summary's own ${gs.body && gs.body.uniqueDonors} = ${keyGivers.n}`,
    fr === keyGivers.n && gsN === keyGivers.n && gs.body.uniqueDonors === keyGivers.n, JSON.stringify({ fr, gsN, raw: gs.body && gs.body.uniqueDonors, key: keyGivers.n }));

  for (const kind of ["lybunt", "sybunt"]) {
    const rep = await api("GET", `/reports/${kind}`, tok);
    const grp = await api("GET", `/donors?bunt=${kind}&limit=500`, tok);
    const ids = (rep.body.rows || []).map(r => r.id);
    const head = rep.body.figures && rep.body.figures.people && rep.body.figures.people.value;
    ok(`§2 ${kind}, rule "gave before, no gift above $0 this year": header ${head} = rows ${ids.length}`, head === ids.length, `${head} vs ${ids.length}`);
    ok(`§2 ${kind}: the person whose only row this year is $0 is on it`, ids.includes(odile), ids.join(","));
    if (kind === "lybunt") {
      const gIds = (grp.body.donors || []).map(d => d.id);
      ok(`§2 lybunt: the group page holds the report's people (${gIds.length} vs ${ids.length})`,
        gIds.length === ids.length && ids.every(i => gIds.includes(i)), JSON.stringify({ gIds, ids }));
    }
    // ── §3 · A TOTAL IS NEVER A CAPPED LIST'S ─────────────────────────────
    const atStake = rep.body.figures && rep.body.figures.atStake && rep.body.figures.atStake.value;
    const footCents = (rep.body.rows || []).reduce((s, r) => s + Math.round(r.priorYearTotal * 100), 0);
    ok(`§3 ${kind}: the header's money ${atStake} is the rows' total ${footCents / 100}`, Math.round(atStake * 100) === footCents, `${atStake} vs ${footCents / 100}`);
  }

  // ── §4 · ONE DUE DATE FOR A JOURNEY STEP ───────────────────────────────
  // Two journeys started in one moment (one created_at), the later step's
  // journey written first. The profile names the step that comes next, on
  // the day the Calendar shows it, every time it is read.
  const ines = await person("Ines Calloway");
  const soon = orgTime.addDays(today, 2), later = orgTime.addDays(today, 4);
  const stamp = new Date(testNow()).toISOString();
  for (const [pid, name, due] of [[`cp_t2_late_${RUN}`, "Spring visits", later], [`cp_t2_soon_${RUN}`, "Thank-you call", soon]]) {
    await q(`INSERT INTO cultivation_plans (id,org_id,donor_id,template_id,template_name,applied_on,status,priority,created_by,created_by_name,created_at)
             VALUES ($1,$2,$3,$4,$5,$6,'active',50,'system:test','test fixture',$7)`, [pid, ORG, ines, `tpl_${pid}`, name, today, stamp]);
    await q(`INSERT INTO cultivation_plan_steps (id,org_id,plan_id,seq,step_type,label,due_date,status) VALUES ($1,$2,$3,1,'call',$4,$5,'pending')`,
      [`cs_${pid}`, ORG, pid, `${name}: first touch`, due]);
  }
  const cal = await api("GET", `/calendar/items?from=${today}&to=${orgTime.addDays(today, 10)}&types=journey`, tok);
  const calDays = ((cal.body && (cal.body.items || cal.body)) || []).filter(i => i.type === "journey" && i.donorId === ines).map(i => String(i.start).slice(0, 10)).sort();
  ok(`§4 the Calendar shows both steps on their stored days (${soon}, ${later})`, calDays.join(",") === `${soon},${later}`, JSON.stringify(calDays));
  const seen = new Set();
  for (let i = 0; i < 5; i++) {
    const plan = (await api("GET", `/donors/${ines}/plan`, tok)).body.plan;
    const next = plan && plan.steps.find(s => s.status === "open" || s.status === "pending");
    seen.add(next ? String(next.dueDate).slice(0, 10) : "none");
  }
  ok(`§4 the profile names the next step on the Calendar's day (${soon}), the same on every reload`, seen.size === 1 && seen.has(soon), [...seen].join(","));

  // ── §5 · AN ERASED PERSON IS IN NO COUNT; THEIR GIFTS STAY ─────────────
  const everyone0 = (await api("GET", "/donors?roleCounts=1&limit=1", tok)).body.roleCounts;
  const money0 = (await api("GET", "/reports/giving-summary", tok)).body;
  const ghost = await person("Corvin Ashgrove", { person_types: ["donor", "volunteer"] });
  await gift(ghost, 410, thisYear("01-02"));
  await gift(ghost, 220, lastYear("02-02"));
  await q(`UPDATE donors SET person_types = '["donor","volunteer"]'::jsonb WHERE id=$1 AND org_id=$2`, [ghost, ORG]);
  const erase = await api("POST", `/donors/${ghost}/erase`, tok, { confirm: "ERASE" });
  ok("§5 the erasure runs", erase.status === 200, erase.status + " " + JSON.stringify(erase.body).slice(0, 200));
  const everyone1 = (await api("GET", "/donors?roleCounts=1&limit=500", tok)).body;
  ok("§5 Everyone and Donors count the same people as before the erased person was made",
    everyone1.roleCounts.everyone === everyone0.everyone && everyone1.roleCounts.donors === everyone0.donors, JSON.stringify({ before: everyone0, after: everyone1.roleCounts }));
  ok("§5 the erased person is on no list", !(everyone1.donors || []).some(d => d.id === ghost));
  const roster = await api("GET", "/volunteer-hub/roster", tok);
  ok("§5 the volunteer roster has no erased row", roster.status === 200 && !(roster.body.people || []).some(p => p.id === ghost), JSON.stringify((roster.body.people || []).map(p => p.name)));
  const money1 = (await api("GET", "/reports/giving-summary", tok)).body;
  ok("§5 their gifts stay in the money, as anonymous gifts: the year's total rose by their $410",
    Math.round(money1.total * 100) - Math.round(money0.total * 100) === 41000, `${money0.total} → ${money1.total}`);
  ok("§5 and they are nobody's donor count", money1.figures.uniqueDonors.value === money0.figures.uniqueDonors.value,
    `${money0.figures.uniqueDonors.value} → ${money1.figures.uniqueDonors.value}`);
  const ly = await api("GET", "/reports/lybunt", tok);
  ok("§5 nor on LYBUNT or SYBUNT", !(ly.body.rows || []).some(r => r.id === ghost));
  // TRUTH-1's key, with TRUTH-2's three counts in it: every surface, one answer.
  const agreeAll = await assertSurfacesAgree(ORG, { token: tok, label: "after the $0 gift and the erasure", soft: true });
  if (!agreeAll.ok) console.log("      surfaces:\n        - " + agreeAll.diffs.join("\n        - "));
  ok("§2 §5 every surface agrees with the key (the donor count, LYBUNT and SYBUNT among them)", agreeAll.ok, agreeAll.diffs.join("\n      "));

  // ── §6 · A GIFT CAN ALWAYS BE REMOVED, OR SAYS WHY NOT ─────────────────
  const zid = `g_t2_zd_${RUN}`;
  await zeroGift(lapsed, thisYear("01-07"), zid);
  const del0 = await api("DELETE", `/gifts/${zid}`, tok);
  const [gone] = await q(`SELECT COUNT(*)::int n FROM gifts WHERE id=$1`, [zid]);
  ok("§6 a $0 gift deletes", del0.status === 200 && gone.n === 0, del0.status + " " + JSON.stringify(del0.body));

  const rg = await gift(lapsed, 125, thisYear("01-08"));
  await q(`INSERT INTO receipts (id,org_id,donor_id,gift_id,type,receipt_number,amount,deductible_amount,snapshot,created_by,created_by_name)
           VALUES ($4,$1,$2,$3,'gift','T2-00001',125,125,'{}'::jsonb,'system:test','test fixture')`, [ORG, lapsed, rg, RCP]);
  const refused = await api("DELETE", `/gifts/${rg}`, tok);
  ok("§6 deleting a receipted gift is refused with the reason, naming the receipt",
    refused.status === 409 && /T2-00001/.test(refused.body && refused.body.message), refused.status + " " + JSON.stringify(refused.body));
  const counter0 = (await q(`SELECT receipt_counter FROM orgs WHERE id=$1`, [ORG]))[0].receipt_counter;
  const v = await api("POST", `/receipts/${RCP}/void`, tok, { reason: "Entered against the wrong person" });
  const [vr] = await q(`SELECT voided_at, void_reason, receipt_number FROM receipts WHERE id=$1`, [RCP]);
  ok("§6 the receipt is voided, its note kept, its number still on it",
    v.status === 200 && vr.voided_at && vr.void_reason === "Entered against the wrong person" && vr.receipt_number === "T2-00001", v.status + " " + JSON.stringify(vr));
  const v2 = await api("POST", `/receipts/${RCP}/void`, tok, {});
  ok("§6 a receipt already void is not voided twice", v2.status === 404, v2.status);
  const del1 = await api("DELETE", `/gifts/${rg}`, tok);
  ok("§6 then the gift deletes", del1.status === 200, del1.status + " " + JSON.stringify(del1.body));
  const counter1 = (await q(`SELECT receipt_counter FROM orgs WHERE id=$1`, [ORG]))[0].receipt_counter;
  ok("§6 the receipt number is never handed out again: the counter never goes back", Number(counter1) >= Number(counter0), `${counter0} → ${counter1}`);
  const [kept] = await q(`SELECT COUNT(*)::int n FROM receipts WHERE id=$1 AND voided_at IS NOT NULL`, [RCP]);
  ok("§6 the voided receipt stays on file", kept.n === 1);
  // A void with nothing typed still keeps a note: who voided it, and when.
  const rg2 = await gift(lapsed, 60, thisYear());
  await q(`INSERT INTO receipts (id,org_id,donor_id,gift_id,type,receipt_number,amount,deductible_amount,snapshot,created_by,created_by_name)
           VALUES ($4,$1,$2,$3,'gift','T2-00002',60,60,'{}'::jsonb,'system:test','test fixture')`, [ORG, lapsed, rg2, RCP + "b"]);
  const v3 = await api("POST", `/receipts/${RCP}b/void`, tok, {});
  const [vr3] = await q(`SELECT void_reason FROM receipts WHERE id=$1`, [RCP + "b"]);
  ok("§6 a void with no note typed still keeps one, naming who voided it",
    v3.status === 200 && /^Voided by Owner on \d{4}-\d{2}-\d{2}\.$/.test(String(vr3 && vr3.void_reason)), v3.status + " " + JSON.stringify(vr3));

  summary();
  await closeDb();
})().catch(async e => { console.error(e); process.exitCode = 1; await closeDb().catch(() => {}); });
