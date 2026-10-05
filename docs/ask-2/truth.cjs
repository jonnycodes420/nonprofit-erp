// ASK-2 Part 0/5 — the hand-computed answers for the 60, on Harborlight's
// fixture (local scratch DB, today 2026-10-04 America/New_York). Written
// straight in SQL, NOT through askEngine, so a score is a real check.
const { Client } = require(require("path").join(__dirname, "../../node_modules/pg"));
const ORG = "org_b72demo", T = "2026-10-04";
(async () => {
  const c = new Client({ connectionString: "postgresql://steward@localhost:5544/steward_ask2" });
  await c.connect();
  const one = async (sql, a = []) => (await c.query(sql, [ORG, ...a])).rows[0];
  const G = `FROM gifts g JOIN donors d ON d.id=g.donor_id AND d.org_id=g.org_id WHERE g.org_id=$1 AND d.deleted_at IS NULL`;
  const sum = async (from, to, extra = "", a = []) => Number((await one(`SELECT COALESCE(SUM(g.amount),0)::numeric(14,2) AS v ${G} AND g.date>=$2 AND g.date<=$3 ${extra}`, [from, to, ...a])).v);
  const cnt = async (from, to, extra = "") => Number((await one(`SELECT COUNT(*) AS v ${G} AND g.amount>0 AND g.date>=$2 AND g.date<=$3 ${extra}`, [from, to])).v);
  const donors = async (from, to, extra = "") => Number((await one(`SELECT COUNT(DISTINCT g.donor_id) AS v ${G} AND g.amount>0 AND g.date>=$2 AND g.date<=$3 ${extra}`, [from, to])).v);
  const firstIn = async (from, to) => Number((await one(`SELECT COUNT(*) AS v FROM (SELECT g.donor_id, MIN(g.date) f ${G} AND g.amount>0 GROUP BY g.donor_id) x WHERE f>=$2 AND f<=$3`, [from, to])).v);
  const amounts = (await c.query(`SELECT g.amount::numeric AS a ${G} AND g.amount>0 AND g.date>='2026-01-01' AND g.date<=$2 ORDER BY g.amount`, [ORG, T])).rows.map(r => Number(r.a));
  const med = amounts.length % 2 ? amounts[(amounts.length - 1) / 2] : Math.round((amounts[amounts.length / 2 - 1] + amounts[amounts.length / 2]) / 2 * 100) / 100;
  const avg = Math.round(amounts.reduce((s, x) => s + x * 100, 0) / amounts.length) / 100;
  const top20 = async extra => Number((await one(`SELECT COALESCE(SUM(t),0)::numeric(14,2) v FROM (SELECT SUM(g.amount) t ${G} AND g.amount>0 AND g.date>='2026-01-01' AND g.date<=$2 ${extra} GROUP BY g.donor_id ORDER BY t DESC LIMIT 20) x`, [T])).v);
  const live = `d.deleted_at IS NULL AND d.deceased IS NOT TRUE`;
  const pdon = async where => Number((await one(`SELECT COUNT(*) v FROM donors d WHERE d.org_id=$1 AND ${live} AND ${where}`)).v);
  const camp = (await one(`SELECT name FROM campaigns WHERE org_id=$1 AND id='camp_b72demo'`)).name;
  const ye = await one(`SELECT goal_amount g FROM campaigns WHERE org_id=$1 AND id='camp_b72_yearend'`);
  const yeRaised = Number((await one(`SELECT COALESCE(SUM(g.amount - COALESCE(g.cover_fee_amount,0)),0)::numeric(14,2) v FROM gifts g JOIN campaigns c ON c.org_id=g.org_id AND (g.campaign_id=c.id OR g.campaign=c.name) WHERE c.org_id=$1 AND c.id='camp_b72_yearend'`)).v);
  const priorFirst = (await c.query(`SELECT donor_id FROM (SELECT g.donor_id, MIN(g.date) f ${G} AND g.amount>0 GROUP BY g.donor_id) x WHERE f>='2025-01-01' AND f<='2025-12-31'`, [ORG])).rows.map(r => r.donor_id);
  const keptFirst = Number((await one(`SELECT COUNT(DISTINCT g.donor_id) v ${G} AND g.amount>0 AND g.date>='2026-01-01' AND g.date<=$2 AND g.donor_id = ANY($3)`, [T, priorFirst])).v);
  const gave25 = (await c.query(`SELECT DISTINCT g.donor_id ${G} AND g.amount>0 AND g.date>='2025-01-01' AND g.date<='2025-12-31'`, [ORG])).rows.map(r => r.donor_id);
  const kept25 = Number((await one(`SELECT COUNT(DISTINCT g.donor_id) v ${G} AND g.amount>0 AND g.date>='2026-01-01' AND g.date<=$2 AND g.donor_id = ANY($3)`, [T, gave25])).v);
  const monthly = `EXISTS (SELECT 1 FROM recurring_subscriptions r WHERE r.org_id=d.org_id AND r.donor_id=d.id AND r.interval='month' AND r.status IN ('active','past_due','recovering','recovered'))`;
  const hours = async (from, to) => Number((await one(`SELECT COALESCE(SUM(hours),0)::numeric(10,2) v FROM volunteer_shifts WHERE org_id=$1 AND date>=$2 AND date<=$3`, [from, to])).v);
  const byGroup = async (expr, extra = "") => (await c.query(`SELECT ${expr} k, SUM(g.amount)::numeric(14,2) v FROM gifts g JOIN donors d ON d.id=g.donor_id AND d.org_id=g.org_id
      LEFT JOIN fin_funds f ON f.id=g.fund_id LEFT JOIN campaigns cp ON cp.id=g.campaign_id WHERE g.org_id=$1 AND d.deleted_at IS NULL AND g.date>='2026-01-01' AND g.date<=$2 ${extra} GROUP BY 1 ORDER BY 2 DESC LIMIT 1`, [ORG, T])).rows[0];

  const truth = {
    1: { money: await sum("2026-09-01", "2026-09-30") },
    2: { money: await sum("2026-01-01", T) },
    3: { money: await sum("2026-01-01", T), compare: await sum("2025-01-01", "2025-10-04"), top: (await byGroup("COALESCE(f.name,'Unrestricted')")).k },
    4: { money: Number((await one(`SELECT COALESCE(SUM(g.amount),0)::numeric(14,2) v ${G} AND g.event_id='ev_b72_gala'`)).v) },
    5: { count: await cnt("2026-09-01", "2026-09-30") },
    6: { money: avg },
    7: { money: amounts[amounts.length - 1] },
    8: { money: await sum("2026-07-01", "2026-09-30") },
    9: { money: await sum("2026-01-01", T, "AND g.fund_id='fund_b72demo_sch'") },
    10: { money: med },
    11: { money: await sum("2026-07-01", T) },
    12: { money: await sum("2026-01-01", T) },
    13: { money: await top20("") },
    14: { list: await pdon(`EXISTS (SELECT 1 FROM gifts gu WHERE gu.org_id=d.org_id AND gu.donor_id=d.id AND gu.amount>500 AND gu.acknowledgement_sent IS NOT TRUE AND gu.disputed_at IS NULL)`) },
    15: { count: await donors("2026-01-01", T) },
    16: { list: await pdon(`lower(trim(COALESCE(d.city,'')))='marblehead'`) },
    17: { list: await pdon(`(SELECT COALESCE(SUM(g.amount),0) FROM gifts g WHERE g.org_id=d.org_id AND g.donor_id=d.id AND g.amount>0 AND LEFT(g.date,10)>='2026-01-01' AND LEFT(g.date,10)<='2026-12-31')>10000`) },
    18: { list: await pdon(`EXISTS (SELECT 1 FROM gifts g WHERE g.org_id=d.org_id AND g.donor_id=d.id AND g.amount>0 AND LEFT(g.date,4)='2025') AND NOT EXISTS (SELECT 1 FROM gifts g WHERE g.org_id=d.org_id AND g.donor_id=d.id AND g.amount>0 AND LEFT(g.date,4)='2026')`) },
    19: { count: await firstIn("2026-01-01", T) },
    20: { list: await firstIn("2026-10-01", T) },
    21: { pct: Math.round(kept25 / gave25.length * 100) },
    22: { pct: Math.round(keptFirst / priorFirst.length * 100), count: keptFirst },
    23: { pct: Math.round(keptFirst / priorFirst.length * 100) },
    24: { count: await pdon(`EXISTS (SELECT 1 FROM gifts g WHERE g.org_id=d.org_id AND g.donor_id=d.id AND g.amount>0) AND NOT EXISTS (SELECT 1 FROM gifts g WHERE g.org_id=d.org_id AND g.donor_id=d.id AND g.amount>0 AND g.date > '2025-10-04')`), note: "my reading of Lapsed: a gift ever, none in twelve months" },
    27: { pct: Math.round(yeRaised / Number(ye.g) * 100), money: yeRaised },
    30: { money: Number((await one(`SELECT COALESCE(SUM(g.amount),0)::numeric(14,2) v ${G} AND g.event_id='ev_b72_gala'`)).v) },
    31: { count: Number((await one(`SELECT COUNT(DISTINCT g.donor_id) v ${G} AND g.amount>0 AND g.date>='2026-01-01' AND g.date<=$2 AND (g.campaign_id='camp_b72demo' OR g.campaign=$3)`, [T, camp])).v) },
    32: { top: (await byGroup("COALESCE(cp.name, NULLIF(g.campaign,''), 'No campaign')")).k },
    33: { count: await pdon(monthly) },
    35: { list: await pdon(`${monthly} AND lower(trim(COALESCE(d.city,'')))='salem'`) },
    36: { money: Number((await one(`SELECT COALESCE(SUM(GREATEST(p.amount - COALESCE(pp.paid,0),0)),0)::numeric(14,2) v FROM pledges p LEFT JOIN (SELECT pledge_id, SUM(amount) paid FROM gifts WHERE org_id=$1 AND pledge_id IS NOT NULL GROUP BY pledge_id) pp ON pp.pledge_id=p.id WHERE p.org_id=$1 AND p.status='open'`)).v) },
    37: { count: await hours("2026-10-01", T) },
    38: { count: await hours("2026-01-01", T) },
    48: { list: await pdon(`EXISTS (SELECT 1 FROM gifts gu WHERE gu.org_id=d.org_id AND gu.donor_id=d.id AND gu.amount>0 AND gu.acknowledgement_sent IS NOT TRUE AND gu.disputed_at IS NULL)`) },
    51: { money: await sum("2025-09-01", "2025-09-30") },
    52: { money: await top20(`AND lower(trim(COALESCE(d.city,'')))='marblehead'`) },
    53: { count: await pdon(monthly) },
    54: { money: await sum("2026-01-01", T, `AND ${monthly}`) },
    55: { top: (await byGroup("COALESCE(f.name,'Unrestricted')")).k, money: await sum("2026-01-01", T) },
    56: { count: await donors("2026-01-01", T), compare: await donors("2025-01-01", "2025-10-04") },
    57: { money: await sum("2025-01-01", "2025-12-31", "AND g.fund_id='fund_b72demo_sch'") },
    58: { count: await firstIn("2026-01-01", T) },
  };
  require("fs").writeFileSync(__dirname + "/truth.json", JSON.stringify(truth, null, 1));
  for (const [k, v] of Object.entries(truth)) console.log(k, JSON.stringify(v));
  await c.end();
})();
