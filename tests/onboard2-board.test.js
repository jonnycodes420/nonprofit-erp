// tests/onboard2-board.test.js · ONBOARD-2. THE ONBOARDING BOARD.
//
// A fixture org walks through all five stages from signals alone, and the
// board shows the right next action at each one. The red windows fire on the
// right days (the pure model, at exact instants off the test clock). The
// customer's "Getting set up" hides itself after the first month. A manual
// click on /ops cannot move a stage.
//
// THE PLANTED DEFECT (ONBOARD2_PLANT=manual on the SERVER): POST
// /ops/onboarding/:org honours a `stage` in its body. §6 goes red.
//
// Fake fixtures only, made-up names. Nothing sends.
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
const { testNow } = require("./clock");
const STAGES = require("../server/onboard/stages");
const BOARD = require("../server/onboard/board");

const PASS = "loadtest1234";
const ORG = "org_onb2walk", HOME = "org_onb2home";
const SUPER = "onb2-super@example.org", CHAMP = "onb2-champ@example.org";
const DAY = 86400000, HOUR = 3600000;
const at = ms => new Date(ms).toISOString();
// The app's `?` placeholders, for the board module run in this process.
const qq = (sql, p = []) => { let i = 0; return q(sql.replace(/\?/g, () => "$" + (++i)), p); };

async function wipe(org) {
  const tables = (await q(`SELECT table_name FROM information_schema.columns
                            WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (let pass = 0; pass < 4; pass++) {
    for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [org]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [org]).then(() => true).catch(() => false)) return;
  }
}
async function mkUser(id, org, email, role, superAdmin) {
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, org, email, bcrypt.hashSync(PASS, 10), email.split("@")[0], role, superAdmin]);
}
const rowOf = async (sup) => {
  const b = await api("GET", "/ops/onboarding", sup);
  return { b, row: (b.body.rows || []).find(r => r.orgId === ORG) };
};

// ── §0 · THE RED WINDOWS, AT EXACT INSTANTS (pure) ─────────────────────────
function windows() {
  const now = testNow();
  const base = { id: "x", name: "X", createdAt: at(now - 30 * DAY), manual: {}, connected: {}, namedSources: [], statementSources: [], kickoff: {} };
  const yes = d => new Date(now - d * DAY - 1).toISOString().slice(0, 10);
  // Paper: from the verbal-yes day (its noon UTC). 3 days is inside, 4 is past.
  const p3 = STAGES.compute(base, Date.parse(`${yes(0)}T12:00:00Z`) + 3 * DAY + HOUR, { verbalYesOn: yes(0) });
  const p4 = STAGES.compute(base, Date.parse(`${yes(0)}T12:00:00Z`) + 4 * DAY + HOUR, { verbalYesOn: yes(0) });
  ok("§0 paper: day 3 from the verbal yes is inside the window, day 4 is past it", p3.stage === "paper" && !p3.red && p4.red, { p3: p3.redWhy, p4: p4.redWhy });
  const noYes = STAGES.compute(base, now + 60 * DAY, {});
  ok("§0 paper with no verbal-yes date has no clock, so it is never late", !noYes.red);
  const data = d => STAGES.compute({ ...base, paperDoneAt: at(now - d) }, now, {});
  ok("§0 data: 10 days from paper is inside (even 10 days and 23 hours), 11 is past",
    !data(10 * DAY).red && !data(10 * DAY + 23 * HOUR).red && data(11 * DAY).red && data(11 * DAY).redWhy.includes("11 days"));
  const conn = { ...base, paperDoneAt: at(now - 40 * DAY), stripeOkAt: at(now - 30 * DAY), stripeAccount: true, pageLiveAt: at(now - 30 * DAY), hasLogo: true };
  const kick = d => STAGES.compute({ ...conn, dataInAt: at(now - d) }, now, {});
  ok("§0 kickoff: 7 days from data in is inside, 8 is past", kick(7 * DAY).stage === "kickoff" && !kick(7 * DAY).red && kick(8 * DAY).red);
  // The walk's Juniper: data in 9 days ago, connections finished today. The window is from data in.
  const late = STAGES.compute({ ...conn, pageLiveAt: at(now - HOUR), dataInAt: at(now - 9 * DAY) }, now, {});
  ok("§0 kickoff counts from data in even when connections finished today", late.stage === "kickoff" && late.red && /9 days from data in/.test(late.redWhy), late.redWhy);
  const fm = { ...conn, kickoff: { signedInAt: at(now - 20 * DAY), homeAt: at(now - 20 * DAY), loggedAt: at(now - 20 * DAY) } };
  const d13 = STAGES.compute({ ...fm, dataInAt: at(now - 13 * DAY - 23 * HOUR) }, now, {});
  const d14 = STAGES.compute({ ...fm, dataInAt: at(now - 14 * DAY) }, now, {});
  ok("§0 first month: day 13 has no flag, day 14 with no first gift is flagged (and only Jonathan hears)",
    d13.stage === "first_month" && !d13.flags.length && d14.flags.some(f => f.key === "no_first_gift") && d14.red);
  ok("§0 a date reads in the org's own day: 9:30 PM in New York on Nov 9 is Nov 9, not UTC's Nov 10",
    STAGES.civil("2026-11-10T02:30:00Z", "America/New_York") === "2026-11-09" && STAGES.civil("2026-11-10T05:30:00Z", "America/New_York") === "2026-11-10");
  ok("§0 the morning line names the org and the day", BOARD.morningLines([{ name: "Wrenfield", flags: d14.flags }])[0] === "Wrenfield: Day 14 since data in and no first gift through Steward.");
}

(async () => {
  console.log("ONBOARD-2: the onboarding board\n");
  windows();

  for (const o of [ORG, HOME]) await wipe(o);
  await q(`DELETE FROM users WHERE email LIKE 'onb2-%@example.org'`);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,org_kind) VALUES ($1,$2,$3,1,'trialing','trial','customer')`,
    [HOME, "Onb2 Steward Staff", "onb2-home"]);
  await mkUser("u_onb2_super", HOME, SUPER, "admin", true);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,org_kind,custom_price_cents,trial_ends_at)
           VALUES ($1,$2,$3,1,'trialing','trial','customer',14900,$4)`, [ORG, "Wrenfield Pantry Collective", "onb2-wrenfield", at(testNow() + 20 * DAY)]);
  await mkUser("u_onb2_champ", ORG, CHAMP, "admin", false);
  const sup = await login(SUPER);
  const now = testNow();
  const firstCharge = STAGES.civil(at(testNow() + 20 * DAY), "America/New_York");   // the org's own day

  // ── §1 · THE DOOR ──────────────────────────────────────────────────────
  const champEarly = await login(CHAMP);
  const no = await api("GET", "/ops/onboarding", champEarly);
  ok("§1 a customer gets 404 from /ops/onboarding", no.status === 404, no.status);
  // That sign-in is not kickoff's: the session is wiped below, so her real first sign-in comes at kickoff.
  await q(`DELETE FROM user_sessions WHERE org_id=$1`, [ORG]);

  // ── §2 · PAPER ─────────────────────────────────────────────────────────
  const yes1 = new Date(now - 1 * DAY).toISOString().slice(0, 10);
  const setYes = await api("POST", `/ops/onboarding/${ORG}`, sup, { verbalYesOn: yes1 });
  let { b, row } = await rowOf(sup);
  ok("§2 the verbal yes is entered by hand and the org is on the board at Paper, next: Send start link",
    setYes.status === 200 && row && row.stage === "paper" && row.next === "Send start link" && !row.red, row || b.body);
  await api("POST", `/ops/onboarding/${ORG}`, sup, { verbalYesOn: new Date(now - 6 * DAY).toISOString().slice(0, 10) });
  ({ row } = await rowOf(sup));
  ok("§2 six days from the verbal yes with no paper, the row is past its window", row.red && /verbal yes/.test(row.redWhy), row.redWhy);
  ok("§2 the line at the top counts it as onboarding and stuck",
    b.body.summary && typeof b.body.summary.billing === "number" && (await rowOf(sup)).b.body.summary.stuck >= 1);

  // ── §3 · DATA IN, CONNECTIONS ──────────────────────────────────────────
  await q(`UPDATE orgs SET paper_done_at=$2, billing_card_last4='4242' WHERE id=$1`, [ORG, at(now - 2 * DAY)]);   // ONBOARD-1's signal
  ({ row } = await rowOf(sup));
  ok("§3 paper done: Data in, next: Chase the export: day 2", row.stage === "data" && row.next === "Chase the export: day 2" && !row.red, row.next);
  await q(`UPDATE orgs SET paper_done_at=$2 WHERE id=$1`, [ORG, at(now - 8 * DAY)]);
  ({ row } = await rowOf(sup));
  ok("§3 day 8 of data: call today, still inside the window", row.next === "Chase the export: day 8, call today" && !row.red, row.next);
  await q(`UPDATE orgs SET paper_done_at=$2 WHERE id=$1`, [ORG, at(now - 12 * DAY)]);
  ({ row } = await rowOf(sup));
  ok("§3 day 12 of data is past the window", row.red && row.stage === "data", row.redWhy);

  await q(`UPDATE orgs SET data_in_at=$2, other_giving_sources='["Cash App"]'::jsonb WHERE id=$1`, [ORG, at(now - 2 * DAY)]);
  await q(`INSERT INTO setup_runs (id, org_id, status, tools, created_by, created_by_name) VALUES ('sr_onb2', $1, 'planned', '["stripe","paypal","checks"]', 'u_onb2_champ', 'champ')`, [ORG])
    .catch(e => console.log("  (setup_runs fixture:", e.message, ")"));
  ({ row } = await rowOf(sup));
  const cParts = row.gates.connections.parts.map(p => p.key);
  ok("§3 data in: Connections, naming Stripe, the giving page and PayPal (named at setup); Cash App counts as a monthly statement",
    row.stage === "connections" && row.next === "Connect Stripe Connect, Giving page, PayPal"
      && cParts.includes("statement:cash app") && row.gates.connections.parts.find(p => p.key === "statement:cash app").ok, { next: row.next, cParts });

  // Stripe: the worker asks Stripe (stubbed here); a "no" is not a yes.
  await q(`UPDATE orgs SET stripe_account_id='acct_onb2_test', stripe_connected=true WHERE id=$1`, [ORG]);
  await BOARD.recompute({ query: qq, run: qq, stripeCheck: async () => ({ ok: false, definitive: true }), now }, [ORG]);
  ({ row } = await rowOf(sup));
  ok("§3 an account Stripe has not enabled is not connected (a green check means it works)",
    !row.gates.connections.parts.find(p => p.key === "stripe").ok, row.gates.connections.parts[0]);
  await BOARD.recompute({ query: qq, run: qq, stripeCheck: async () => ({ ok: true, definitive: true }), now: now + 2 * HOUR }, [ORG]);
  await q(`INSERT INTO giving_pages (id, org_id, slug, title, status) VALUES ('gp_onb2', $1, 'give', 'Give to Wrenfield', 'active')`, [ORG]);
  ({ row } = await rowOf(sup));
  ok("§3 charges on; the page is live but without the logo, so it is not done", row.next === "Connect Giving page, PayPal"
    && /without the org's logo/.test(row.gates.connections.parts.find(p => p.key === "page").says), row.next);
  await q(`UPDATE orgs SET logo_data='data:image/png;base64,iVBORw0KGgo=' WHERE id=$1`, [ORG]);
  await q(`INSERT INTO giving_sources (id, org_id, provider, display_name, status) VALUES ('gs_onb2', $1, 'paypal', 'PayPal', 'active')`, [ORG]);
  ({ row } = await rowOf(sup));
  ok("§3 logo and PayPal in: Kickoff, next: Book kickoff", row.stage === "kickoff" && row.next === "Book kickoff", row.next);

  // ── §4 · KICKOFF ───────────────────────────────────────────────────────
  const champ = await login(CHAMP);
  ({ row } = await rowOf(sup));
  ok("§4 she signed in: the next action says she has not opened Home", row.next === "She has signed in but not opened Home: book kickoff", row.next);
  const supOpen = await api("POST", "/onboarding/home-opened", sup);
  ok("§4 Steward's own staff opening Home is not her opening it", supOpen.body.recorded === false, supOpen.body);
  const opened = await api("POST", "/onboarding/home-opened", champ);
  ({ row } = await rowOf(sup));
  ok("§4 she opened Home: next, the first call together", opened.body.recorded === true && row.next === "Kickoff: make the first call from her list together", row.next);
  const kick = await api("GET", "/onboarding/kickoff", champ);
  ok("§4 Who to call tomorrow answers (the top five moves, or that the list is being read)", kick.status === 200 && Array.isArray(kick.body.people) && kick.body.people.length <= 5, kick.body);
  const [donor] = await q(`INSERT INTO donors (id, org_id, name, email, created_by, created_by_name) VALUES ('d_onb2', $1, 'Tamsin Oakhurst', 'tamsin@example.org', 'u_onb2_champ', 'champ') RETURNING id`, [ORG]);
  const plain = await api("POST", `/donors/${donor.id}/conversations`, champ, { touch: "call_reached", line: "Said thanks", date: new Date(now).toISOString().slice(0, 10), nextStep: { skipped: true } });
  ({ row } = await rowOf(sup));
  ok("§4 a call logged from the profile is not a call from a move: still Kickoff", plain.status < 300 && row.stage === "kickoff", { s: plain.status, b: plain.body, stage: row.stage });
  const fromMove = await api("POST", `/donors/${donor.id}/conversations`, champ, { touch: "call_reached", line: "First call from her list", date: new Date(now).toISOString().slice(0, 10), fromMove: true, nextStep: { skipped: true } });
  ({ row } = await rowOf(sup));
  ok("§4 a call logged from a move: First month, next: no first gift yet", fromMove.status < 300 && row.stage === "first_month" && /^No first gift yet: day 2, call her$/.test(row.next), row.next);

  // ── §5 · THE FIRST MONTH, THEN BILLING ─────────────────────────────────
  await q(`UPDATE orgs SET data_in_at=$2 WHERE id=$1`, [ORG, at(now - 15 * DAY)]);
  ({ row } = await rowOf(sup));
  ok("§5 day 15 with no first gift: flagged on /ops", row.red && row.flags.some(f => f.key === "no_first_gift"), row.flags);
  const mine = await api("GET", "/onboarding/mine", champ);
  ok("§5 her checklist says nothing of the flag, the window or MRR", mine.status === 200 && mine.body.show === true
    && !/flag|window|mrr|late|Day 15/i.test(JSON.stringify(mine.body)) && mine.body.steps.find(s => s.id === "kickoff").done, mine.body);
  const gift = await api("POST", `/donors/${donor.id}/gifts`, champ, { amount: "50.00", date: new Date(now).toISOString().slice(0, 10), type: "cash" });
  ({ row } = await rowOf(sup));
  ok("§5 the first gift through Steward: waiting on the first charge", gift.status < 300 && row.next === `Waiting on the first charge, ${STAGES.words(firstCharge)}` && !row.red, { s: gift.status, next: row.next });
  await q(`UPDATE orgs SET subscription_status='past_due' WHERE id=$1`, [ORG]);
  ({ row } = await rowOf(sup));
  ok("§5 a failed payment flags /ops and says to send the update-card link", row.red && row.next === "Payment failed: send the update-card link", row.next);
  const mineFailed = await api("GET", "/onboarding/mine", champ);
  ok("§5 she sees the update-card step, nothing locked", mineFailed.body.steps.find(s => s.id === "charge").words === "Your Steward payment didn't go through: update your card", mineFailed.body.steps);
  await q(`UPDATE orgs SET subscription_status='active', stripe_subscription_id='sub_onb2', billing_mrr_cents=14900 WHERE id=$1`, [ORG]);
  await q(`INSERT INTO platform_payments (id, org_id, stripe_invoice_id, amount_paid_cents, monthly_cents, created_by, created_by_name)
           VALUES ('pp_onb2', $1, 'in_onb2', 14900, 14900, 'system:test', 'test')`, [ORG]);
  ({ b, row } = await rowOf(sup));
  ok("§5 the invoice is paid: Billing, with its MRR counted", row.stage === "billing" && row.mrrNowCents === 14900 && b.body.summary.mrrNowCents >= 14900, row);
  const done = await api("GET", "/onboarding/mine", champ);
  ok("§5 Getting set up hides itself after the first month (Settings still has it)", done.body.tracked === true && done.body.show === false, done.body);

  // ── §6 · A MANUAL CLICK CANNOT MOVE A STAGE ────────────────────────────
  await q(`UPDATE orgs SET data_in_at=NULL WHERE id=$1`, [ORG]);               // back to Data in, by signal
  await BOARD.recompute({ query: qq, run: qq, now }, [ORG]);
  const click = await api("POST", `/ops/onboarding/${ORG}`, sup, { stage: "billing", waitingOn: "their email tool and grant system" });
  const [stored] = await q(`SELECT stage, waiting_on FROM org_onboarding WHERE org_id=$1`, [ORG]);
  ({ row } = await rowOf(sup));
  ok("§6 a stage sent by hand is ignored: stored and shown stage stay Data in; Waiting on is kept",
    click.status === 200 && stored.stage === "data" && row.stage === "data" && row.waitingOn === "their email tool and grant system", { stored, shown: row.stage });
  const onlyStage = await api("POST", `/ops/onboarding/${ORG}`, sup, { stage: "billing" });
  const [stored2] = await q(`SELECT stage FROM org_onboarding WHERE org_id=$1`, [ORG]);
  ok("§6 a request that only sets a stage is refused", onlyStage.status === 400 && stored2.stage === "data", { s: onlyStage.status, stored2 });

  for (const o of [ORG, HOME]) await wipe(o);
  await q(`DELETE FROM users WHERE email LIKE 'onb2-%@example.org'`);
  summary();
  await closeDb();
})().catch(async e => { console.error(e); process.exitCode = 1; await closeDb().catch(() => {}); });
