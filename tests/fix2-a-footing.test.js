// FIX-2 A — EVERY NUMBER OPENS, AND WHAT IT OPENS ADDS UP TO IT.
//
// The second guard of "every number opens" (claude/FIX-2.md): for every figure
// with a `source`, fetch the rows behind it and check they foot to the figure,
// in cents. A percentage foots through its numerator and its denominator. A
// blank foots to a sentence that says what is missing and when it appears.
//
// The fixture is an organisation with known gifts across this fiscal year and
// the last, restricted and unrestricted funds, monthly gifts in every state,
// pledges, a goal, a grant, a milestone and a week's activity, so that every
// figure on all four dashboards has rows behind it.
//
//   §1  every figure on all four dashboards carries a source, and foots
//   §2  the endpoint's shape: paginated, tenant-scoped, read-only, refuses
//       what it does not know
//   §3  the guard can fail: a figure one cent off does not foot
//
// Run on the scratch stack: BASE, DATABASE_URL (see tests/run-all.sh).

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
const orgTime = require("../orgTime");

const ORG = "org_fx2afoot", ORG2 = "org_fx2afoot2";
const EMAIL = "fx2afoot@example.org", EMAIL2 = "fx2afoot2@example.org";
const PW = "loadtest1234";
const cents = n => Math.round((Number(n) || 0) * 100);
const qs = params => Object.entries(params || {}).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");

const TABLES = ["gift_soft_credits", "payment_recovery_events", "recurring_subscriptions", "giving_recurring",
  "giving_sources", "milestone_drafts", "interactions", "threads", "tasks", "pledges", "grants", "campaigns",
  "fin_transactions", "gifts", "donors", "fin_audit_log", "metric_snapshots", "users", "budgets", "accounts", "fin_funds"];
async function reset() {
  for (const o of [ORG, ORG2]) {
    await q(`UPDATE pledges SET fulfilled_gift_id=NULL WHERE org_id=$1`, [o]).catch(() => {});
    for (const t of TABLES) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}

function figuresOf(board) {
  const out = [];
  for (const p of (board.answer?.parts || [])) if (p.figure) out.push({ where: `${board.key} sentence`, ...p.figure });
  for (const m of board.metrics || []) {
    if (m.kind === "breakdown") {
      for (const r of (Array.isArray(m.value) ? m.value : [])) {
        out.push({ where: `${board.key}.${m.key} · ${r.label}`, ...r });
        for (const a of (r.also || [])) out.push({ where: `${board.key}.${m.key} · ${r.label} · ${a.label}`, ...a });
      }
    } else if (m.kind === "series") {
      for (const pt of (Array.isArray(m.value) ? m.value : [])) {
        if (pt.thisYear) out.push({ where: `${board.key}.${m.key} · ${pt.month} this year`, ...pt.thisYear });
        if (pt.lastYear) out.push({ where: `${board.key}.${m.key} · ${pt.month} last year`, ...pt.lastYear });
      }
    } else {
      out.push({ where: `${board.key}.${m.key}`, ...m });
      for (const a of (m.also || [])) out.push({ where: `${board.key}.${m.key} · ${a.label}`, ...a });
    }
  }
  return out;
}

// Every row behind a source, every page of it.
async function allRows(tok, source) {
  const rows = []; let page = 1, first = null;
  for (;;) {
    const r = await api("GET", `/figures/${encodeURIComponent(source.key)}/rows?${qs({ ...source.params, page, pageSize: 200 })}`, tok);
    if (r.status !== 200) return { status: r.status, body: r.body };
    first = first || r.body;
    rows.push(...(r.body.rows || []));
    if (rows.length >= (r.body.totalRows || 0) || !(r.body.rows || []).length) break;
    page++;
  }
  return { status: 200, body: first, rows };
}

// What a measure of a set of rows is. The server says which measure a source
// uses; this recomputes it from the rows, so a figure that disagrees with its
// own rows cannot pass.
function measureOf(measure, rows) {
  if (measure === "sum") return rows.reduce((s, r) => s + cents(r.amount), 0) / 100;
  if (measure === "count") return rows.length;
  if (measure === "avg") return rows.length ? Math.round(rows.reduce((s, r) => s + Number(r.amount || 0), 0) / rows.length) : 0;
  return NaN;
}
const ratioOf = (formula, num, den) => formula === "change"
  ? (den > 0 ? Math.round(((num - den) / den) * 100) : null)
  : (den > 0 ? Math.round((num / den) * 100) : null);

// Does a figure foot to its rows? Returns [true] or [false, why].
async function foots(tok, fig) {
  const got = await allRows(tok, fig.source);
  if (got.status !== 200) return [false, `rows answered ${got.status}`];
  const b = got.body;
  if (fig.value === null || fig.value === undefined) {
    return typeof b.blank === "string" && b.blank.length > 30 && /\.$/.test(b.blank) && b.value === null
      ? [true] : [false, `a blank with no sentence: ${JSON.stringify(b.blank)}`];
  }
  if (b.measure === "ratio" || b.measure === "difference") {
    const [p1, p2] = b.parts || [];
    if (!p1 || !p2) return [false, "a ratio without its two parts"];
    const r1 = await allRows(tok, p1.source), r2 = await allRows(tok, p2.source);
    const v1 = measureOf(p1.measure, r1.rows || []), v2 = measureOf(p2.measure, r2.rows || []);
    if (cents(v1) !== cents(p1.value) || cents(v2) !== cents(p2.value)) return [false, `a part does not foot: ${v1}/${p1.value} ${v2}/${p2.value}`];
    if (b.measure === "difference") {
      return cents(v1) - cents(v2) === cents(fig.value) ? [true] : [false, `${v1} − ${v2} ≠ ${fig.value}`];
    }
    const want = ratioOf(b.formula, v1, v2);
    return want === fig.value ? [true] : [false, `${b.formula}(${v1}, ${v2}) = ${want} ≠ ${fig.value}`];
  }
  const rows = got.rows;
  if (rows.length !== b.totalRows) return [false, `pages returned ${rows.length} of ${b.totalRows}`];
  const v = measureOf(b.measure, rows);
  if (b.measure === "sum") {
    return cents(v) === cents(fig.value) && cents(b.value) === cents(fig.value) && b.cents === cents(fig.value)
      ? [true] : [false, `rows ${v} · endpoint ${b.value} · figure ${fig.value}`];
  }
  return v === fig.value && b.value === fig.value ? [true] : [false, `${b.measure} of rows ${v} · figure ${fig.value}`];
}

(async () => {
  console.log("fix2-a-footing");
  await reset();
  const org = { timezone: orgTime.DEFAULT_TZ };
  const today = orgTime.orgToday(org);
  const fy = orgTime.orgPeriodBounds(org, "fiscal_year", 0);
  const fyPrev = orgTime.orgPeriodBounds(org, "fiscal_year", -1);
  const Y = orgTime.parseCivil(today).y;
  const hash = bcrypt.hashSync(PW, 4);
  for (const [id, email, name, slug] of [[ORG, EMAIL, "Tidewater Youth Choir", "fx2a-foot"], [ORG2, EMAIL2, "Other Shop", "fx2a-foot2"]]) {
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,created_at)
             VALUES ($1,$2,$3,1,'active','growth', NOW() - INTERVAL '900 days')`, [id, name, slug]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Admin','admin')`, ["u_" + id, id, email, hash]);
  }
  await q(`UPDATE orgs SET other_income_enabled=true, other_income_this_year=41250.75 WHERE id=$1`, [ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES
           ('ff_fx2af_sch',$1,'Scholarship Fund',true),('ff_fx2af_bus',$1,'Tour Bus',true),('ff_fx2af_gen',$1,'General Operating',false)`, [ORG]);

  // Twenty-four people. Everyone gave in the previous calendar year (so the
  // retention floor of twenty is met), the first of them two years before
  // that (so the history floor is met), and half of them again this year.
  const donors = [];
  for (let i = 1; i <= 24; i++) donors.push([`d_fx2af_${String(i).padStart(2, "0")}`, `Singer ${String(i).padStart(2, "0")}`]);
  for (const [id, name] of donors) {
    await q(`INSERT INTO donors (id,org_id,name,stage,assigned_to,created_at) VALUES ($1,$2,$3,$4,$5, NOW() - INTERVAL '800 days')`,
      [id, ORG, name, id.endsWith("1") ? "cultivation" : "steward", id.endsWith("1") ? "u_" + ORG : null]);
  }
  let n = 0;
  const gift = async (donor, amount, date, fund = null, extra = {}) => {
    n++;
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,fund_id,campaign_id,pledge_id,acknowledgement_sent,acknowledgement_sent_at,cover_fee_amount)
             VALUES ($1,$2,$3,$4,$5,'cash',$6,$7,$8,$9,CASE WHEN $9 THEN NOW() END,$10)`,
      [`g_fx2af_${n}`, ORG, donor, amount, date, fund, extra.campaign || null, extra.pledge || null,
       !!extra.ack, extra.fee || 0]);
    return `g_fx2af_${n}`;
  };
  const prevCal = `${Y - 1}-03-15`;
  await gift(donors[0][0], 90, `${Y - 3}-11-02`);
  for (const [i, [id]] of donors.entries()) await gift(id, 100 + i * 10.25, prevCal, i % 3 === 0 ? "ff_fx2af_gen" : null);
  // This fiscal year, spread across its months up to today, with cents.
  const clamp = d => (d < fy.start ? fy.start : d > today ? today : d);
  const thisYearDates = [fy.start, clamp(orgTime.addDays(fy.start, 35)), clamp(orgTime.addDays(today, -9)), today];
  for (let i = 0; i < 12; i++) {
    await gift(donors[i][0], 250.5 + i * 33.33, thisYearDates[i % thisYearDates.length],
      ["ff_fx2af_sch", "ff_fx2af_bus", "ff_fx2af_gen", null][i % 4], { ack: i % 2 === 0 });
  }
  // Last fiscal year, inside and outside the same-point stretch.
  const prevSame = orgTime.addDays(fyPrev.start, orgTime.daysBetween(fy.start, today));
  await gift(donors[13][0], 410.4, fyPrev.start, "ff_fx2af_gen");
  await gift(donors[14][0], 199.99, prevSame);
  await gift(donors[15][0], 1500, fyPrev.end);
  // A goal with gifts (one with a covered fee) and an awarded grant toward it.
  await q(`INSERT INTO campaigns (id,org_id,name,goal_amount,status,start_date,end_date) VALUES ('c_fx2af',$1,'New Risers',20000,'active',$2,$3)`,
    [ORG, fy.start, fy.end]);
  await gift(donors[16][0], 750, today, null, { campaign: "c_fx2af", fee: 22.8 });
  await q(`INSERT INTO grants (id,org_id,funder,program,amount,status,campaign_id,awarded_at) VALUES ('gr_fx2af_aw',$1,'Harbor Fund','Risers',5000,'awarded','c_fx2af',NOW())`, [ORG]);
  await q(`INSERT INTO grants (id,org_id,funder,program,amount,status,deadline) VALUES ('gr_fx2af_due',$1,'Ridgeline Trust','Summer tour',15000,'prospecting',$2)`,
    [ORG, orgTime.addDays(today, 30)]);
  // Pledges: one part-paid, one untouched, one fulfilled.
  await q(`INSERT INTO pledges (id,org_id,donor_id,amount,due_date,status) VALUES
           ('p_fx2af_1',$1,$2,5000,$4,'open'),('p_fx2af_2',$1,$3,800,$4,'open'),('p_fx2af_3',$1,$3,300,$4,'fulfilled')`,
    [ORG, donors[2][0], donors[3][0], orgTime.addDays(today, 60)]);
  await gift(donors[2][0], 1250.25, today, null, { pledge: "p_fx2af_1" });
  await gift(donors[3][0], 300, today, null, { pledge: "p_fx2af_3" });
  // Monthly gifts in every state.
  // Instants from the database clock, never the machine's (test-clock-seam).
  const sub = (id, donor, amount, interval, status, { daysAgo = 400, recovered = false, canceled = false } = {}) => q(
    `INSERT INTO recurring_subscriptions (id,org_id,donor_id,stripe_subscription_id,amount,interval,status,created_at,recovered_at,canceled_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW() - make_interval(days => $8::int),CASE WHEN $9 THEN NOW() END,CASE WHEN $10 THEN NOW() END)`,
    [id, ORG, donor, "sub_" + id, amount, interval, status, daysAgo, recovered, canceled]);
  await sub("rs_fx2af_a", donors[4][0], 25, "month", "active");
  await sub("rs_fx2af_y", donors[5][0], 120, "year", "active");
  await sub("rs_fx2af_new", donors[6][0], 40.5, "month", "active", { daysAgo: 0 });
  await sub("rs_fx2af_r", donors[7][0], 30, "month", "recovered", { recovered: true });
  await sub("rs_fx2af_c", donors[8][0], 15, "month", "canceled", { canceled: true });
  await sub("rs_fx2af_p", donors[9][0], 10, "month", "past_due");
  await q(`INSERT INTO payment_recovery_events (id,org_id,donor_id,subscription_id,type) VALUES
           ('pre_fx2af_1',$1,$2,'rs_fx2af_r','payment_failed'),('pre_fx2af_2',$1,$3,'rs_fx2af_p','payment_failed'),
           ('pre_fx2af_3',$1,$2,'rs_fx2af_r','payment_recovered')`, [ORG, donors[7][0], donors[9][0]]);
  // Monthly through a connected source: one the provider named, one inferred.
  await q(`INSERT INTO giving_sources (id,org_id,provider,display_name,status) VALUES ('gs_fx2af',$1,'paypal','PayPal','active')`, [ORG]);
  await q(`INSERT INTO giving_recurring (id,org_id,donor_id,source_id,provider,amount_cents,confidence,status) VALUES
           ('gvr_fx2af_1',$1,$2,'gs_fx2af','paypal',2500,'provider','active'),('gvr_fx2af_2',$1,$3,'gs_fx2af','paypal',1000,'inferred','active')`,
    [ORG, donors[10][0], donors[11][0]]);
  await q(`INSERT INTO milestone_drafts (id,org_id,donor_id,subject,body) VALUES ('md_fx2af',$1,$2,'A milestone','Body')`, [ORG, donors[0][0]]);
  await q(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by) VALUES ('int_fx2af',$1,$2,'call','Rang her.',$3,$4)`,
    [ORG, donors[0][0], today, "u_" + ORG]);
  // Org two: one donor, one gift, to prove nothing crosses.
  await q(`INSERT INTO donors (id,org_id,name,stage) VALUES ('d_fx2af_x',$1,'Outsider Person','steward')`, [ORG2]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type) VALUES ('g_fx2af_x',$1,'d_fx2af_x',777,$2,'cash')`, [ORG2, today]);

  const tok = await login(EMAIL, PW), tok2 = await login(EMAIL2, PW);

  // ── §1 · every figure foots ────────────────────────────────────────────
  console.log("\n— §1 · every figure on all four dashboards opens, and its rows foot —");
  const keys = ["board", "fundraising", "people", "recurring"];
  let figuresSeen = 0;
  const bad = [];
  const sources = new Set(), sourceObjs = [];
  for (const k of keys) {
    const board = (await api("GET", `/dashboards/${k}`, tok)).body || {};
    const figs = figuresOf(board);
    figuresSeen += figs.length;
    for (const f of figs) {
      if (!f.source || typeof f.source.key !== "string") { bad.push(`${f.where}: no source`); continue; }
      sources.add(f.source.key); sourceObjs.push(f.source);
      const [good, why] = await foots(tok, f);
      if (!good) bad.push(`${f.where}: ${why}`);
    }
    ok(`§1 ${k}: every figure carries a source and foots to it`, figs.length > 0 && !bad.some(b => b.startsWith(k)), bad.filter(b => b.startsWith(k)));
  }
  ok(`§1 all ${figuresSeen} figures foot (${sources.size} sources)`, bad.length === 0 && figuresSeen > 60, { figuresSeen, bad });

  const board = (await api("GET", "/dashboards/board", tok)).body;
  const val = key => board.metrics.find(m => m.key === key)?.value;
  ok("§1 the fixture reaches the figures it was built for: retention is a rate, not a blank",
    typeof val("retentionRate") === "number", val("retentionRate"));
  ok("§1 …change on last year is a percentage", typeof val("revenueChangePct") === "number", val("revenueChangePct"));
  ok("§1 …other income is its own line", cents(val("otherIncomeThisYear")) === cents(41250.75), val("otherIncomeThisYear"));
  // Retention is by calendar year (computeRetentionRate); count it by hand.
  const [{ prior: expPrior, retained: expRetained }] = await q(
    `SELECT COUNT(DISTINCT donor_id) FILTER (WHERE LEFT(date,4)=$2)::int AS prior,
            COUNT(DISTINCT donor_id) FILTER (WHERE LEFT(date,4)=$2 AND donor_id IN
              (SELECT donor_id FROM gifts WHERE org_id=$1 AND LEFT(date,4)=$3))::int AS retained
       FROM gifts WHERE org_id=$1`, [ORG, String(Y - 1), String(Y)]);
  const ret = await api("GET", `/figures/${board.metrics.find(m => m.key === "retentionRate").source.key}/rows?${qs(board.metrics.find(m => m.key === "retentionRate").source.params)}`, tok);
  ok("§1 retention opens its numerator (gave again) and its denominator (gave last year)",
    ret.body?.parts?.[0]?.role === "numerator" && ret.body?.parts?.[1]?.role === "denominator"
    && ret.body.parts[0].value === expRetained && ret.body.parts[1].value === expPrior,
    { parts: ret.body?.parts?.map(p => [p.role, p.value]), expRetained, expPrior });

  // ── §2 · the endpoint's shape ──────────────────────────────────────────
  console.log("\n— §2 · paginated, tenant-scoped, read-only —");
  const giving = board.metrics.find(m => m.key === "revenueThisYear");
  const p1 = await api("GET", `/figures/${giving.source.key}/rows?${qs({ ...giving.source.params, page: 1, pageSize: 5 })}`, tok);
  const p2 = await api("GET", `/figures/${giving.source.key}/rows?${qs({ ...giving.source.params, page: 2, pageSize: 5 })}`, tok);
  ok("§2 a page is a page: five rows, and the total is over every row, not the page",
    p1.body.rows.length === 5 && p1.body.totalRows > 5 && cents(p1.body.value) === cents(giving.value), { rows: p1.body.rows.length, total: p1.body.totalRows });
  ok("§2 …and page two continues it without repeating a row",
    p2.body.rows.length > 0 && !p2.body.rows.some(r => p1.body.rows.some(x => x.id === r.id)));
  const counts = async () => (await q(`SELECT (SELECT COUNT(*) FROM gifts)::int + (SELECT COUNT(*) FROM donors)::int
      + (SELECT COUNT(*) FROM metric_snapshots)::int + (SELECT COUNT(*) FROM fin_audit_log)::int
      + (SELECT COUNT(*) FROM interactions)::int + (SELECT COUNT(*) FROM threads)::int AS n`))[0].n;
  const before = await counts();
  for (const s of sourceObjs) await api("GET", `/figures/${s.key}/rows?${qs(s.params)}`, tok);
  ok("§2 a GET for rows writes nothing", (await counts()) === before, { before, after: await counts() });
  const theirs = await api("GET", `/figures/gifts/rows?${qs({ from: "2000-01-01", to: today, donor: donors[0][0] })}`, tok2);
  ok("§2 org B asking for org A's donor gets nothing of org A's", theirs.status === 200 && theirs.body.rows.length === 0 && theirs.body.value === 0, theirs.body);
  const theirAll = await api("GET", `/figures/gifts/rows?${qs({ from: "2000-01-01", to: today })}`, tok2);
  ok("§2 …and its own rows are its own", theirAll.body.rows.length === 1 && theirAll.body.rows[0].name === "Outsider Person", theirAll.body.rows);
  ok("§2 an unknown source is a 404", (await api("GET", "/figures/nope/rows", tok)).status === 404);
  ok("§2 a malformed date is a 400, not a guess", (await api("GET", "/figures/gifts/rows?from=yesterday&to=today", tok)).status === 400);
  ok("§2 signed out, nothing", (await api("GET", `/figures/gifts/rows?${qs(giving.source.params)}`, null)).status === 401);

  // ── §3 · the guard can fail ────────────────────────────────────────────
  console.log("\n— §3 · a figure one cent off does not foot —");
  const [plantedOk] = await foots(tok, { ...giving, value: Math.round(giving.value * 100 + 1) / 100 });
  ok("§3 a money figure one cent off its rows fails the footing", plantedOk === false);
  const cnt = board.metrics.find(m => m.key === "donorCount");
  const [plantedCount] = await foots(tok, { ...cnt, value: cnt.value + 1 });
  ok("§3 a count one off its rows fails too", plantedCount === false);
  const [plantedPct] = await foots(tok, { ...board.metrics.find(m => m.key === "retentionRate"), value: val("retentionRate") + 1 });
  ok("§3 …and a percentage one point off its numerator and denominator", plantedPct === false);

  await reset();
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
