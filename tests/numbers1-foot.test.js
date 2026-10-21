// NUMBERS-1 · EVERY NUMBER ADDS UP, AFTER EVERY CHANGE.
//
// Jonathan added a $25,000 gift to Margaret Chen (21 Oct): Average stayed at
// "$14,423.08 of 13 gifts", Largest at $15,000, and the gift counted toward
// GivingTuesday 2026, which had not started. This suite proves the numbers
// three ways:
//   §1 the checker passes on every demo org and fixture org on this database;
//   §2 Margaret's case: a $25,000 gift moves Average (over 14) and Largest on
//      the ONE read the header draws from, and a gift dated before a campaign
//      starts is refused it and never counts toward it;
//   §3 hundreds of random sequences of the things people do to gifts (add,
//      edit amount, edit date, move campaign, refund, delete, Undo, split,
//      soft credit, merge two donors, import a file, a voice gift card's Yes),
//      each in a fresh small org, with scripts/check-numbers.js run after every
//      step. A failure prints the shortest sequence that still breaks a rule.
//
// It boots server.js IN-PROCESS (like voice1-tell-steward) so the voice card
// is real, read by a stand-in model on a local port, and so the checker reads
// the Fundraising roll-up through the function that draws it.
//   NUMBERS1_SEQUENCES (default 500) · NUMBERS1_SEED (default: the time)
const http = require("http");
const bcrypt = require("bcryptjs");

const PORT = Number(process.env.MATRIX_PORT || 5699);
const MOCK = Number(process.env.CALENDAR_MOCK_PORT || 5618);
process.env.PORT = String(PORT);
process.env.BASE = `http://localhost:${PORT}`;
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest";
if (/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)) process.env.DB_SSL = "disable";
process.env.DISABLE_BACKGROUND_TICKS = "1";
process.env.DISABLE_RATE_LIMIT = "1";
process.env.SESSION_CACHE_TTL_MS = "0";
process.env.JWT_SECRET = process.env.JWT_SECRET || "local-test-secret";
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || "re_dummy_local";
process.env.RESEND_BASE_URL = process.env.RESEND_BASE_URL || "http://localhost:5602";
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_dummy";
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";
process.env.STEWARD_CREDENTIAL_KEY = process.env.STEWARD_CREDENTIAL_KEY || "local-scratch-credential-key-0123456789";
process.env.ANTHROPIC_API_KEY = "sk-ant-numbers1-standin";
process.env.ANTHROPIC_BASE_URL = `http://localhost:${MOCK}`;

const { ok, summary, login, api, q, closeDb, civilToday, civilPlusDays } = require("./helpers");

const SEQUENCES = Number(process.env.NUMBERS1_SEQUENCES || 500);
const SEED = Number(process.env.NUMBERS1_SEED || Date.now() % 1e9);
const PREFIX = "org_n1_";
const sys = "'system:test','test'";

// ── the stand-in model: a voice memo's one gift card ─────────────────────
const queued = [];
const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", d => { body += d; });
  req.on("end", () => {
    const send = (code, j) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(j)); };
    if (req.url.startsWith("/v1/messages") && body.includes('"memo_actions"')) {
      return send(200, { id: "msg_standin", type: "message", role: "assistant", model: "claude-opus-5", stop_reason: "tool_use",
        usage: { input_tokens: 1, output_tokens: 1 },
        content: [{ type: "tool_use", id: "tu_1", name: "memo_actions", input: queued.shift() || read({}) }] });
    }
    if (req.url.startsWith("/v1/messages")) return send(200, { id: "msg_x", type: "message", role: "assistant", model: "claude-opus-5", stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: "" }] });
    send(404, {});
  });
});
const read = o => ({ how: "", when: "", summary: "", people: [], follow_ups: [], interests: [], email: { subject: "", body: "" },
  money: [], contact: [], sensitive: [], ...o });

// ── a seeded random source, so a failure can be replayed ─────────────────
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, xs) => xs[Math.floor(r() * xs.length)];
const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));

async function wipe(like) {
  const tables = await q(`SELECT DISTINCT table_name FROM information_schema.columns WHERE column_name='org_id' AND table_schema='public' AND table_name <> 'orgs'`);
  for (let pass = 0; pass < 3; pass++) for (const t of tables) await q(`DELETE FROM ${t.table_name} WHERE org_id LIKE $1`, [like]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id LIKE $1`, [like]).catch(() => {});
}

// ── one small org: five people (two a household), three funds, four campaigns ──
const PW = bcrypt.hashSync("loadtest1234", 4);
let orgSeq = 0;
async function makeOrg(today) {
  const n = ++orgSeq, org = `${PREFIX}${SEED}_${n}`, email = `n1-${SEED}-${n}@example.org`;
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at,receipts_enabled,stripe_account_id,stripe_connected)
           VALUES ($1,$2,$3,1,'active','team','America/New_York',NOW(),false,$4,true)`, [org, `Numbers ${n}`, `n1-${SEED}-${n}`, `acct_${org}`]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Dana Reyes','admin')`, [`u_${org}`, org, email, PW]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ($2,$1,'General Operating',false),($3,$1,'Arena Fund',true),($4,$1,'Scholarships',false)`,
    [org, `f_${org}_a`, `f_${org}_b`, `f_${org}_c`]);
  await q(`INSERT INTO households (id,org_id,name,created_by,created_by_name) VALUES ($1,$2,'The Hales',${sys})`, [`h_${org}`, org]);
  const people = ["Margaret Hale", "Tom Hale", "Ruth Okafor", "Sam Lee", "Pat Ng"];
  for (const [i, name] of people.entries())
    await q(`INSERT INTO donors (id,org_id,name,email,stage,person_types,household_id,created_by,created_by_name) VALUES ($1,$2,$3,$4,'active','["donor"]'::jsonb,$5,${sys})`,
      [`d_${org}_${i}`, org, name, `p${i}-${org}@example.org`, i < 2 ? `h_${org}` : null]);
  // Past, running, starting next month (the GivingTuesday case), and one with no dates.
  const C = [["spring", -220, -120], ["fall", -60, 30], ["gt", 27, 48], ["open", null, null]];
  for (const [k, s, e] of C)
    await q(`INSERT INTO campaigns (id,org_id,name,type,status,goal_amount,start_date,end_date,parent_goal_id) VALUES ($1,$2,$3,'appeal','active',$4,$5::date,$6::date,$7)`,
      [`c_${org}_${k}`, org, `Campaign ${k}`, 10000, s == null ? null : civilPlusDays(s), e == null ? null : civilPlusDays(e), k === "fall" ? `c_${org}_open` : null]);
  const tok = await login(email);
  // Four gifts to start from, through the one gift path, so every kind of
  // step has something to act on.
  for (const [i, days, cid] of [[0, -150, "spring"], [1, -20, "fall"], [2, -300, null], [3, -5, "open"]])
    await api("POST", `/donors/d_${org}_${i}/gifts`, tok, { amount: 100 * (i + 1) + 0.5, date: civilPlusDays(days), campaignId: cid ? `c_${org}_${cid}` : undefined });
  return { org, tok, today, undo: [] };
}

const NUM = require("../numbers");
const { checkOrg } = require("../scripts/check-numbers");
const stripeLib = require("stripe");
async function fire(evt) {
  const payload = JSON.stringify(evt);
  const header = stripeLib.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
  const r = await fetch(process.env.BASE + "/stripe/webhook", { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": header }, body: payload });
  return r.status;
}

// ── the things people do to gifts. Each draws its choices from its own seed,
// so a shorter sequence replays the same choices against whatever is there. ──
const KINDS = ["add", "add", "editAmount", "editDate", "moveCampaign", "refund", "delete", "undo", "split", "softCredit", "merge", "import", "voice"];
async function live(o) {
  const donors = (await q(`SELECT id FROM donors WHERE org_id=$1 AND deleted_at IS NULL ORDER BY id`, [o.org])).map(r => r.id);
  const gifts = await q(`SELECT id, donor_id, amount::text AS amount, date, campaign_id, fund_id, stripe_payment_id FROM gifts WHERE org_id=$1 ORDER BY id`, [o.org]);
  return { donors, gifts };
}
const money = r => (int(r, 1, 5000) * 100 + pick(r, [0, 0, 25, 50, 99])) / 100;
// Half the time a date inside a campaign that is running or ran, half anywhere in the last 400 days.
const dateIn = (r, o) => r() < 0.5 ? civilPlusDays(pick(r, [int(r, -220, -120), int(r, -60, 0), -int(r, 0, 400)])) : civilPlusDays(-int(r, 0, 400));
const campaignOf = (r, o) => pick(r, [null, `c_${o.org}_spring`, `c_${o.org}_fall`, `c_${o.org}_gt`, `c_${o.org}_open`]);
async function windowOk(o, cid, date) {
  if (!cid) return true;
  const [c] = await q(`SELECT name, start_date, end_date FROM campaigns WHERE id=$1`, [cid]);
  return !NUM.campaignWindowRefusal(c, date);
}

async function step(o, s) {
  const r = rng(s.seed);
  const { donors, gifts } = await live(o);
  const g = gifts.length ? pick(r, gifts) : null;
  const expect = (res, okStatus, what) => { if (!okStatus.includes(res.status)) throw new Error(`${what} answered ${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`); return res; };
  switch (s.kind) {
    case "add": {
      const donor = pick(r, donors), date = dateIn(r, o), campaignId = campaignOf(r, o), amount = money(r);
      const res = await api("POST", `/donors/${donor}/gifts`, o.tok, { amount, date, campaignId: campaignId || undefined, fund_id: pick(r, [`f_${o.org}_a`, `f_${o.org}_b`, ""]) });
      // A campaign the gift's date is outside is refused it, with the sentence.
      const want = (await windowOk(o, campaignId, date)) ? 201 : 400;
      if (res.status !== want) throw new Error(`add ${amount} on ${date} to ${campaignId} answered ${res.status}, expected ${want}`);
      return `add $${amount} to ${donor.slice(-1)} dated ${date}${campaignId ? ` for ${campaignId.split("_").pop()}` : ""}${want === 400 ? " (refused: outside the campaign's dates)" : ""}`;
    }
    case "editAmount": {
      if (!g || Number(g.amount) <= 0) return "edit amount: no gift";
      const amount = money(r);
      expect(await api("PUT", `/gifts/${g.id}`, o.tok, { amount }), [200], "edit amount");
      return `edit ${g.id} amount to $${amount}`;
    }
    case "editDate": {
      if (!g) return "edit date: no gift";
      const date = dateIn(r, o);
      expect(await api("PUT", `/gifts/${g.id}`, o.tok, { date }), [200], "edit date");
      return `edit ${g.id} date to ${date}`;
    }
    case "moveCampaign": {
      if (!g) return "move campaign: no gift";
      const cid = campaignOf(r, o);
      const res = await api("PUT", `/gifts/${g.id}`, o.tok, { campaignId: cid || "" });
      const want = (await windowOk(o, cid, g.date)) ? 200 : 400;
      if (res.status !== want) throw new Error(`move ${g.id} to ${cid} answered ${res.status}, expected ${want}`);
      return `move ${g.id} to ${cid ? cid.split("_").pop() : "no campaign"}${want === 400 ? " (refused)" : ""}`;
    }
    case "refund": {
      if (!g || Number(g.amount) <= 0) return "refund: no gift";
      const pi = g.stripe_payment_id || `pi_${g.id}`;
      if (!g.stripe_payment_id) await q(`UPDATE gifts SET stripe_payment_id=$1 WHERE id=$2`, [pi, g.id]);   // it was paid online
      const cents = Math.round(Number(g.amount) * 100), full = r() < 0.5, back = full ? cents : int(r, 1, Math.max(1, cents - 1));
      const st = await fire({ id: `evt_${g.id}_${s.seed}`, type: "charge.refunded", account: `acct_${o.org}`,
        data: { object: { id: `ch_${g.id}`, payment_intent: pi, amount: cents, amount_refunded: back } } });
      if (st !== 200) throw new Error(`refund webhook answered ${st}`);
      return `refund ${full ? "all" : `$${back / 100} of`} ${g.id}`;
    }
    case "delete": {
      if (!g) return "delete: no gift";
      expect(await api("DELETE", `/gifts/${g.id}`, o.tok), [200], "delete");
      return `delete ${g.id}`;
    }
    case "undo": {
      const u = o.undo.pop();
      if (!u) return "undo: nothing to undo";
      expect(await api("POST", u.path, o.tok, {}), [200, 201], "undo");
      return `undo ${u.what}`;
    }
    case "split": {
      if (!g || Number(g.amount) < 0.02) return "split: no gift";
      const cents = Math.round(Number(g.amount) * 100), part = int(r, 1, cents - 1);
      expect(await api("PUT", `/gifts/${g.id}`, o.tok, { amount: part / 100 }), [200], "split (edit)");
      const res = await api("POST", `/donors/${g.donor_id}/gifts`, o.tok, { amount: (cents - part) / 100, date: g.date, campaignId: g.campaign_id || undefined, fund_id: pick(r, [`f_${o.org}_c`, g.fund_id || ""]) });
      expect(res, [201, 400], "split (add)");
      return `split ${g.id} into $${part / 100} and $${(cents - part) / 100}`;
    }
    case "softCredit": {
      if (!g || Number(g.amount) <= 0) return "soft credit: no gift";
      const other = pick(r, donors.filter(d => d !== g.donor_id));
      if (!other) return "soft credit: nobody else";
      expect(await api("PUT", `/gifts/${g.id}/extras`, o.tok, { softCredits: [{ donorId: other, pct: pick(r, [25, 50, 100]), role: "household" }] }), [200], "soft credit");
      return `soft credit ${g.id} to ${other.slice(-1)}`;
    }
    case "merge": {
      if (donors.length < 3) return "merge: too few people";
      const kept = pick(r, donors), merged = pick(r, donors.filter(d => d !== kept));
      const res = await api("POST", `/data-health/merge`, o.tok, { keptId: kept, mergedId: merged });
      if (res.status === 409) return `merge ${merged.slice(-1)} into ${kept.slice(-1)} (refused: ${res.body && res.body.sentence})`;
      expect(res, [200, 201], "merge");
      o.undo.push({ path: `/data-health/merges/${res.body.mergeId}/undo`, what: `the merge of ${merged.slice(-1)} into ${kept.slice(-1)}` });
      return `merge ${merged.slice(-1)} into ${kept.slice(-1)}`;
    }
    case "import": {
      const rows = Array.from({ length: int(r, 1, 3) }, () => ({ donorId: pick(r, donors), amount: money(r), date: dateIn(r, o) }));
      const res = expect(await api("POST", `/gifts/import-history`, o.tok, { gifts: rows, importId: `imp_${o.org}_${s.seed}` }), [200, 201], "import");
      return `import ${rows.length} gift(s) (${res.body.inserted} old, ${res.body.recentQueued || 0} recent)`;
    }
    case "voice": {
      const donor = pick(r, donors), dollars = int(r, 5, 900);
      const text = `Quick note: ${donor.slice(-1)} gave $${dollars} today, so kind.`;
      queued.push(read({ summary: "A gift.", money: [{ kind: "gift", fund_words: "", quote: `gave $${dollars} today` }] }));
      const m = expect(await api("POST", `/voice/memos`, o.tok, { text, donorId: donor }), [201], "voice memo");
      const card = ((m.body.memo || {}).waiting || []).find(c => c.kind === "money");
      if (!card) throw new Error(`the memo made no gift card: ${JSON.stringify(m.body.memo && m.body.memo.waiting)}`);
      expect(await api("POST", `/voice/memos/${m.body.memo.id}/cards/${card.id}/yes`, o.tok, {}), [200], "voice yes");
      return `voice card Yes: $${dollars} from ${donor.slice(-1)}`;
    }
  }
  throw new Error(`unknown step ${s.kind}`);
}

// Run a sequence in a fresh org; return the first broken rule, or null.
async function runSequence(seq, today, log) {
  const o = await makeOrg(today);
  for (const [i, s] of seq.entries()) {
    let did;
    try { did = await step(o, s); }
    catch (e) { return { at: i, error: e.message }; }
    if (log) log.push(did);
    const res = await checkOrg(o.org, { screens: NUM.screens });
    if (res.problems.length) return { at: i, problems: res.problems };
  }
  return null;
}

// The shortest sequence that still breaks: drop steps while it still fails.
async function shrink(seq, today) {
  let cur = seq;
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i < cur.length; i++) {
      const shorter = cur.slice(0, i).concat(cur.slice(i + 1));
      if (shorter.length && await runSequence(shorter, today)) { cur = shorter; changed = true; break; }
    }
  }
  const log = [];
  const why = await runSequence(cur, today, log);
  return { seq: cur, log, why };
}

(async () => {
  console.log(`numbers1-foot (NUMBERS-1) · seed ${SEED} · ${SEQUENCES} sequences`);
  await new Promise(res => mock.listen(MOCK, res));
  require("../server.js");
  await new Promise(res => setTimeout(res, 3500));   // boot DDL settles
  await wipe(`${PREFIX}%`);
  const today = civilToday();

  // ── §1 every demo and fixture org on this database ─────────────────────
  console.log("\n§1 the checker on every demo and fixture org");
  const orgs = await q(`SELECT id FROM orgs WHERE id NOT LIKE $1 AND id NOT LIKE 'org_n1m_%' ORDER BY id`, [`${PREFIX}%`]);
  const red = [];
  for (const { id } of orgs) {
    const r = await checkOrg(id, { screens: NUM.screens }).catch(e => ({ problems: [{ rule: "error", count: 1, examples: [e.message] }] }));
    if (r.problems.length) red.push({ id, problems: r.problems.map(p => `${p.rule} x${p.count} ${JSON.stringify(p.examples.slice(0, 2))}`) });
  }
  ok(`§1 every rule holds on all ${orgs.length} orgs here (demo and fixture)`, orgs.length > 0 && red.length === 0, red.slice(0, 5));

  // ── §2 Margaret's gift ─────────────────────────────────────────────────
  console.log("\n§2 a $25,000 gift to Margaret, and GivingTuesday");
  {
    const m = { org: "org_n1m_" + SEED, today };
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at,receipts_enabled)
             VALUES ($1,'Numbers Margaret',$2,1,'active','team','America/New_York',NOW(),false)`, [m.org, `n1m-${SEED}`]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Dana Reyes','admin')`, [`u_${m.org}`, m.org, `n1m-${SEED}@example.org`, PW]);
    await q(`INSERT INTO donors (id,org_id,name,email,stage,person_types,created_by,created_by_name) VALUES ($1,$2,'Margaret Chen','mc-${SEED}@example.org','active','["donor"]'::jsonb,${sys})`, [`d_${m.org}`, m.org]);
    // Her thirteen gifts: $187,500 (the demo's numbers).
    const amounts = [15000, 15000, 10000, ...Array(10).fill(14750)];
    for (const [i, a] of amounts.entries())
      await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,'check',${sys})`,
        [`g_${m.org}_${i}`, m.org, `d_${m.org}`, a, civilPlusDays(-(60 + i * 200))]);
    await q(require("../donorSummary").DONOR_SUMMARY_UPDATE(), [m.org]);
    await q(`INSERT INTO campaigns (id,org_id,name,type,status,goal_amount,start_date,end_date) VALUES ($1,$2,'GivingTuesday','appeal','draft',20000,$3::date,$4::date)`,
      [`c_${m.org}`, m.org, civilPlusDays(27), civilPlusDays(48)]);
    m.tok = await login(`n1m-${SEED}@example.org`);
    const before = (await api("GET", `/donors/d_${m.org}`, m.tok)).body.figures || {};
    ok("§2 before: Average is $14,423.08 of 13 gifts", before.average && before.average.value === 14423.08 && before.average.count === 13, before.average);
    const add = await api("POST", `/donors/d_${m.org}/gifts`, m.tok, { amount: 25000, date: today, type: "cash" });
    ok("§2 the $25,000 gift is recorded", add.status === 201, add.status);
    // The header draws all seven tiles from this one read (ProfileHeaderFigures).
    const after = (await api("GET", `/donors/d_${m.org}`, m.tok)).body.figures || {};
    ok("§2 the same read says Lifetime $212,500", after.lifetime && after.lifetime.value === 212500, after.lifetime);
    ok("§2 ...and Average $15,178.57 over 14 gifts", after.average && after.average.value === 15178.57 && after.average.count === 14, after.average);
    ok("§2 ...and Largest $25,000", after.largest && after.largest.value === 25000, after.largest);
    const gt = await api("POST", `/donors/d_${m.org}/gifts`, m.tok, { amount: 500, date: today, campaignId: `c_${m.org}` });
    ok("§2 a gift dated before GivingTuesday starts is refused it, with the dates", gt.status === 400 && /GivingTuesday runs .* and this gift is dated/.test(gt.body.error || ""), gt.body);
    // A gift already on the campaign from before (the prod case) counts toward nothing.
    await q(`UPDATE gifts SET campaign_id=$1, campaign='GivingTuesday' WHERE org_id=$2 AND amount=25000`, [`c_${m.org}`, m.org]);
    const fr = await api("GET", "/fundraising/campaigns", m.tok);
    const row = (fr.body || []).find(c => c.id === `c_${m.org}`) || {};
    ok("§2 GivingTuesday's raised stays $0 with a gift dated before it on it", fr.status === 200 && row.raised === 0 && row.donorCount === 0, row);
    const drawer = await require("../figureSources").figureValue(m.org, { key: "goal-raised", params: { campaign: `c_${m.org}` } }, {});
    ok("§2 ...and its drawer opens no gift", (drawer.cents || 0) === 0 && !drawer.totalRows, drawer);
    const chk = await checkOrg(m.org, { screens: NUM.screens });
    ok("§2 the checker agrees, and counts the one gift attributed outside the dates", chk.problems.length === 0 && chk.giftsOutsideCampaignDates === 1, chk);
    // The guard can fail: a stored count that disagrees is caught.
    await q(`UPDATE donors SET gift_count = gift_count + 1 WHERE id=$1`, [`d_${m.org}`]);
    const planted = await checkOrg(m.org, { screens: NUM.screens });
    ok("§2 a planted wrong gift count is caught (the checker can fail)", planted.problems.some(p => p.rule === "donor-stored"), planted.problems.map(p => p.rule));
    await wipe(m.org);
  }

  // ── §3 random sequences ─────────────────────────────────────────────────
  console.log(`\n§3 ${SEQUENCES} random sequences, the checker after every step`);
  const top = rng(SEED);
  let passed = 0, failed = null, steps = 0;
  const started = Date.now();
  for (let n = 0; n < SEQUENCES && !failed; n++) {
    const seq = Array.from({ length: int(top, 1, 7) }, () => ({ kind: pick(top, KINDS), seed: Math.floor(top() * 1e9) }));
    steps += seq.length;
    const log = process.env.NUMBERS1_LOG ? [] : null;
    const why = await runSequence(seq, today, log);
    if (log) console.log(`  ${n}: ${log.join(" | ")}`);
    if (why) failed = { n, seq, why }; else passed++;
    if (n % 50 === 49) await wipe(`${PREFIX}${SEED}_%`);
  }
  if (failed) {
    const small = await shrink(failed.seq, today);
    console.log(`  the shortest breaking sequence (seed ${SEED}, sequence ${failed.n}):`);
    small.log.forEach((l, i) => console.log(`    ${i + 1}. ${l}`));
    console.log(`  broke: ${JSON.stringify(small.why || failed.why).slice(0, 900)}`);
    console.log(`  replay: NUMBERS1_SEED=${SEED} node tests/numbers1-foot.test.js`);
  }
  ok(`§3 ${passed} of ${SEQUENCES} random sequences (${steps} steps) kept every rule`, !failed && passed === SEQUENCES, failed && failed.why);
  console.log(`  ${Math.round((Date.now() - started) / 1000)}s`);
  await wipe(`${PREFIX}%`);
  await wipe("org_n1m_%");
  mock.close();
  await closeDb();
  summary();
  process.exit(process.exitCode || 0);
})().catch(e => { console.error(e); process.exit(1); });
