// FIX-3 C, finding 14 — THE DEMO GIVES LIKE A REAL MID-SIZED NONPROFIT.
//
// The walk: Harborlight's Reports read "Online $2 (2)" against $433,215
// offline. The report decides online by `g.stripe_payment_id IS NOT NULL`
// (routes/crm.js reportGivingSummary), and the seed wrote every gift as a
// cheque with no Stripe id, so the demo had no online giving at all; the $2
// was a real charge (finding 8). The fix is in the SEED's fields, never in the
// report: online gifts carry what the Stripe webhook writes (a payment id,
// payment_method Card), monthly givers carry an active subscription and one
// charge a month, and the gala is an event with ticket and sponsor levels, a
// guest list, and a paddle raise on the night.
//
// Ranges come from the seed's own SHAPE (scripts/seed-demo.js), which the seed
// also asserts on every run, prod included.
//
//   §1  the report's online rule is the field the seed sets
//   §2  the online share of the trailing twelve months: 30–45% of dollars,
//       well over half of gifts
//   §3  monthly givers: active subscriptions, a Stripe-style charge every month
//   §4  the gala: tickets, sponsorships and a paddle raise on one night
//   §5  no gift is dated after today (a demo that has "raised" December's
//       money in September reads as fake)
//
// SELECTs only against the demo org, like tests/demo-shape.test.js §1 (no
// login, no writes: tests/fix1-walk.test.js §11).

const fs = require("fs");
const path = require("path");
const { ok, summary, q, closeDb } = require("./helpers");
const { ORG, SHAPE, GALA } = require("../scripts/seed-demo.js");
const orgTime = require("../orgTime");

const root = path.join(__dirname, "..");
const pct = n => (n * 100).toFixed(1) + "%";

(async () => {
  const [present] = await q(`SELECT COUNT(*)::int AS n, MAX(o.timezone) AS tz FROM donors d JOIN orgs o ON o.id=d.org_id WHERE d.org_id=$1`, [ORG]);
  if (!present || present.n === 0) {
    console.log("  FAIL — the demo org is not seeded. Run scripts/seed-demo.js (run-all.sh does this first).");
    await closeDb(); process.exit(1);
  }
  const TODAY = orgTime.orgToday({ timezone: present.tz || "America/New_York" });
  const yearAgo = orgTime.addDays(TODAY, -365);

  // ── §1 · the report's rule is the seed's field ────────────────────────────
  console.log("— §1 · what makes a gift online —");
  const crm = fs.readFileSync(path.join(root, "routes", "crm.js"), "utf8");
  const summaryFn = crm.slice(crm.indexOf("async function reportGivingSummary"), crm.indexOf("async function reportByGroup"));
  ok("§1 the giving summary counts a gift online when it carries a Stripe payment id",
     /SUM\(CASE WHEN g\.stripe_payment_id IS NOT NULL THEN g\.amount ELSE 0 END\)/.test(summaryFn), summaryFn.slice(0, 200));
  ok("§1 the seed exports the ranges it asserts (online share, monthly givers, the gala)",
     SHAPE && typeof SHAPE.onlineShareMin === "number" && typeof SHAPE.onlineShareMax === "number"
       && typeof SHAPE.onlineCountShareMin === "number" && typeof SHAPE.monthlyGiversMin === "number"
       && GALA && typeof GALA.name === "string", { SHAPE, GALA });

  // ── §2 · the online share ─────────────────────────────────────────────────
  console.log("\n— §2 · the online share of the last twelve months —");
  const [m] = await q(
    `SELECT COUNT(*)::int n, COALESCE(SUM(g.amount),0)::float total,
            COUNT(*) FILTER (WHERE g.stripe_payment_id IS NOT NULL)::int online_n,
            COALESCE(SUM(CASE WHEN g.stripe_payment_id IS NOT NULL THEN g.amount ELSE 0 END),0)::float online_total
       FROM gifts g JOIN donors d ON d.id = g.donor_id
      WHERE g.org_id=$1 AND d.deleted_at IS NULL AND g.date > $2 AND g.date <= $3`, [ORG, yearAgo, TODAY]);
  const share = m.total ? m.online_total / m.total : 0;
  const countShare = m.n ? m.online_n / m.n : 0;
  const lo = SHAPE.onlineShareMin ?? 0.30, hi = SHAPE.onlineShareMax ?? 0.45;
  ok(`§2 online is ${pct(share)} of the year's dollars ($${Math.round(m.online_total).toLocaleString()} of $${Math.round(m.total).toLocaleString()}) — inside [${pct(lo)}, ${pct(hi)}]`,
     share >= lo && share <= hi, m);
  ok(`§2 ...and ${pct(countShare)} of its gifts (${m.online_n} of ${m.n}) — well over half (≥ ${pct(SHAPE.onlineCountShareMin ?? 0.6)})`,
     countShare >= (SHAPE.onlineCountShareMin ?? 0.6), m);
  const [shape] = await q(
    `SELECT COUNT(*) FILTER (WHERE stripe_payment_id IS NOT NULL AND (payment_method <> 'Card' OR type <> 'cash'))::int bad_online,
            COUNT(*) FILTER (WHERE stripe_payment_id IS NOT NULL AND stripe_payment_id NOT LIKE 'pi\\_demo\\_%')::int unminted,
            COUNT(*) FILTER (WHERE stripe_payment_id IS NULL AND COALESCE(payment_method,'') IN ('', 'Card'))::int bad_offline
       FROM gifts WHERE org_id=$1`, [ORG]);
  ok("§2 every online gift looks like the webhook's (payment_method Card, type cash)", shape.bad_online === 0, shape);
  ok("§2 every Stripe id in the demo is one the seed minted (pi_demo_…), never a real charge", shape.unminted === 0, shape);
  ok("§2 every offline gift says how it came (Check, ACH, Stock, DAF, Cash)", shape.bad_offline === 0, shape);
  // Majors mostly give by cheque, stock and DAF; the small tail mostly online.
  const bands = await q(
    `WITH t AS (SELECT donor_id, SUM(amount) life FROM gifts WHERE org_id=$1 GROUP BY donor_id)
     SELECT CASE WHEN t.life >= 40000 THEN 'major' WHEN t.life < 2000 THEN 'small' ELSE 'mid' END band,
            AVG(CASE WHEN g.stripe_payment_id IS NOT NULL THEN 1.0 ELSE 0 END)::float online
       FROM gifts g JOIN t ON t.donor_id = g.donor_id WHERE g.org_id=$1 GROUP BY 1`, [ORG]);
  const band = Object.fromEntries(bands.map(b => [b.band, b.online]));
  ok(`§2 the channel follows the gift size: small ${pct(band.small || 0)} online > mid ${pct(band.mid || 0)} > major ${pct(band.major || 0)}`,
     (band.small || 0) > (band.mid || 0) && (band.mid || 0) > (band.major || 0) && (band.major || 0) < 0.25, band);

  // ── §3 · monthly givers ───────────────────────────────────────────────────
  console.log("\n— §3 · monthly givers, charged every month —");
  const subs = await q(
    `SELECT rs.id, rs.donor_id, rs.amount::float amount, rs.interval, rs.created_at::date::text started,
            rs.stripe_subscription_id, rs.card_last4
       FROM recurring_subscriptions rs WHERE rs.org_id=$1 AND rs.status='active'`, [ORG]);
  ok(`§3 at least ${SHAPE.monthlyGiversMin} active monthly givers (${subs.length})`, subs.length >= (SHAPE.monthlyGiversMin || 30), subs.length);
  ok("§3 each is monthly, with a card on file and a subscription id",
     subs.length > 0 && subs.every(s => s.interval === "month" && s.card_last4 && /^sub_demo_/.test(s.stripe_subscription_id)), subs.slice(0, 2));
  const charges = await q(
    `SELECT g.recurring_subscription_id sid, array_agg(LEFT(g.date,7) ORDER BY g.date) months,
            bool_and(g.stripe_payment_id IS NOT NULL) all_online, MAX(g.date) last
       FROM gifts g WHERE g.org_id=$1 AND g.recurring_subscription_id IS NOT NULL GROUP BY 1`, [ORG]);
  const bySub = Object.fromEntries(charges.map(c => [c.sid, c]));
  const monthsBetween = (a, b) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));
  const gaps = [], stale = [], offline = [];
  for (const s of subs) {
    const c = bySub[s.id];
    if (!c) { gaps.push(`${s.id}: no charges`); continue; }
    if (!c.all_online) offline.push(s.id);
    for (let k = 1; k < c.months.length; k++) if (monthsBetween(c.months[k - 1], c.months[k]) !== 1) gaps.push(`${s.id}: ${c.months[k - 1]} → ${c.months[k]}`);
    if (monthsBetween(c.last.slice(0, 7), TODAY.slice(0, 7)) > 1 || orgTime.addDays(TODAY, -32) > c.last) stale.push(`${s.id}: last ${c.last}`);
  }
  ok("§3 every monthly gift is a Stripe charge", offline.length === 0, offline.slice(0, 5));
  ok("§3 one charge every month, no month skipped", gaps.length === 0, gaps.slice(0, 5));
  ok("§3 ...through this month (each last charged within the past month)", stale.length === 0, stale.slice(0, 5));
  const long = subs.filter(s => (bySub[s.id]?.months.length || 0) >= 12).length;
  ok(`§3 most have given a year or more (${long} of ${subs.length})`, long >= subs.length / 2, long);

  // ── §4 · the gala ─────────────────────────────────────────────────────────
  console.log("\n— §4 · the gala —");
  const [ev] = await q(`SELECT id, name, event_type, date::text date, status, revenue::float revenue FROM events WHERE org_id=$1 AND event_type='gala' ORDER BY date DESC LIMIT 1`, [ORG]);
  ok("§4 the demo has a gala, and it has happened", !!ev && ev.date <= TODAY && ev.date > yearAgo && ev.status === "completed", ev);
  if (ev) {
    const levels = await q(`SELECT kind, name, price::float price, fmv::float fmv FROM event_levels WHERE event_id=$1 AND org_id=$2`, [ev.id, ORG]);
    ok("§4 it sells tickets (with a fair-market value) and sponsorships",
       levels.some(l => l.kind === "ticket" && l.fmv > 0 && l.fmv < l.price) && levels.filter(l => l.kind === "sponsor").length >= 2, levels);
    const guests = await q(
      `SELECT a.status, l.kind, a.registration_gift_id, g.amount::float amount, g.quid_pro_quo_value::float qpq, g.date, g.stripe_payment_id
         FROM event_attendees a JOIN event_levels l ON l.id = a.level_id
         LEFT JOIN gifts g ON g.id = a.registration_gift_id AND g.org_id = a.org_id
        WHERE a.event_id=$1 AND a.org_id=$2`, [ev.id, ORG]);
    const tickets = guests.filter(g => g.kind === "ticket"), sponsors = guests.filter(g => g.kind === "sponsor");
    ok(`§4 a real guest list: ${tickets.length} ticket buyers, ${sponsors.length} sponsors`, tickets.length >= (GALA.ticketBuyersMin || 60) && sponsors.length >= 3, { tickets: tickets.length, sponsors: sponsors.length });
    ok("§4 every registration is a gift that bought something (its receipt states the fair-market value)",
       guests.every(g => g.registration_gift_id && g.amount > 0 && g.qpq > 0 && g.qpq < g.amount), guests.filter(g => !(g.registration_gift_id && g.qpq > 0)).slice(0, 3));
    ok("§4 tickets were bought online, before the night", tickets.every(g => g.stripe_payment_id && g.date <= ev.date), tickets.filter(g => !g.stripe_payment_id).length);
    ok("§4 most guests came", guests.filter(g => g.status === "attended").length >= guests.length * 0.8, guests.map(g => g.status).slice(0, 5));
    const [night] = await q(
      `SELECT COUNT(*)::int n, COALESCE(SUM(amount),0)::float total FROM gifts
        WHERE org_id=$1 AND date=$2 AND campaign=$3 AND id NOT IN (SELECT registration_gift_id FROM event_attendees WHERE event_id=$4 AND registration_gift_id IS NOT NULL)`,
      [ORG, ev.date, ev.name, ev.id]);
    ok(`§4 the paddle raise: ${night.n} gifts on the night, $${Math.round(night.total).toLocaleString()}`, night.n >= (GALA.paddleGiftsMin || 30) && night.total >= 20000, night);
    const [all] = await q(`SELECT COALESCE(SUM(amount),0)::float total FROM gifts WHERE org_id=$1 AND campaign=$2`, [ORG, ev.name]);
    ok(`§4 the event's revenue is the sum of its gifts ($${Math.round(ev.revenue).toLocaleString()})`, Math.abs(ev.revenue - all.total) < 0.01 && ev.revenue >= 75000, { revenue: ev.revenue, gifts: all.total });
  }

  // ── §5 · nothing from the future ──────────────────────────────────────────
  console.log("\n— §5 · no gift dated after today —");
  const [fut] = await q(`SELECT COUNT(*)::int n, COALESCE(SUM(amount),0)::float amt FROM gifts WHERE org_id=$1 AND date > $2`, [ORG, TODAY]);
  ok(`§5 no gift is dated after ${TODAY} (${fut.n})`, fut.n === 0, fut);

  await closeDb();
  summary();
})().catch(async e => { console.error("SUITE ERROR:", e); await closeDb().catch(() => {}); process.exit(1); });
