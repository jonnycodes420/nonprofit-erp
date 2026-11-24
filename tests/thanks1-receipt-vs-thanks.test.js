// tests/thanks1-receipt-vs-thanks.test.js · THANKS-1 (Jarvis's 23 Nov re-run). The build's one new suite:
// it guards donor data (what the record says about a thank-you) and the gift delete.
//
// §1 Generating a receipt leaves the gift "Not thanked yet" (its row says "Receipt issued, not thanked
//    yet" and "Receipt #… issued"), the thank-you task open, and the gift on the thank-you backlog
//    rule; marking the thank-you sends it to Thanked and closes nothing it should not.
// (Run order §1, §3, §2: §2's refund-in-full is left out of §3's org-wide truth check.)
// §2 One rule everywhere: on a fixture with every combination (nothing, receipt only, thank-you only,
//    both, a legacy mark with no receipt, a refunded-in-full gift), the profile's thankState, the
//    AWAITING rule (Home's "gifts not yet thanked" filter) and the Report builder's "Thanked" column
//    agree on every gift. The Thanked box on the edit form un-ticked on a receipted gift keeps the
//    receipt's mark.
// §3 Deleting a gift adds nothing to the donor's timeline and one Recent changes line (with Undo, and
//    the audit row says the same); Undo puts the gift, its totals and its thank-you task back, the
//    surfaces agree, and a second Undo is refused. A gift with a live receipt is refused with whether
//    that receipt was sent.
//
// PROVEN ABLE TO FAIL (run against main 5c922c6, red): §1 the profile says thanked after a receipt
// (thankState reads acknowledgement_sent) and the task's gift reads thanked; §2 the receipt-only gift
// disagrees (AWAITING says not waiting); §3 the timeline grows by a "Gift removed" note, there is no
// Recent changes line and no /gifts/:id/restore (404). Planted on the branch: THANKED's
// `thanked_at IS NOT NULL` branch removed → §1 "thank-you sets Thanked" red.
// Tests set their own clock (tests/clock.js). Sends nothing (receipts are made with send:false).
"use strict";
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
const { civilDay, dayOffset } = require("./clock");
const { assertSurfacesAgree } = require("./lib/surfacesAgree");

const ORG = "org_thanks1";
const PASSWORD = "loadtest1234";
const EMAIL = `${ORG}@test.local`;
const TODAY = civilDay(undefined, "America/New_York");
const ACT = ["system:test/thanks1", "THANKS-1 test"];
const one = async (sql, a) => (await q(sql, a))[0] || {};

async function freshOrg() {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 5; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at,legal_name,ein,receipt_address,receipts_enabled)
           VALUES ($1,'Larkspur Thanks One Society','thanks1-larkspur',1,'active','team','America/New_York',NOW(),'Larkspur Thanks One Society Inc','83-2207719','9 Fixture Lane',true)`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Odessa Vantreight','admin')`, ["u_" + ORG, ORG, EMAIL, bcrypt.hashSync(PASSWORD, 4)]);
  return login(EMAIL, PASSWORD);
}
async function person(id, name) {
  await q(`INSERT INTO donors (id,org_id,name,email,kind,person_types,created_by,created_by_name) VALUES ($1,$2,$3,$4,'individual','["donor"]'::jsonb,$5,$6)`,
    [id, ORG, name, `${id}@thanks1.example.org`, ...ACT]);
  return id;
}
const gift = async (tok, donor, body) => {
  const r = await api("POST", `/donors/${donor}/gifts`, tok, { idempotencyKey: crypto.randomUUID(), date: TODAY, type: "cash", payment_method: "check", ...body });
  return r.body && (r.body.gift ? r.body.gift.id : r.body.id);
};
const profileGifts = async (tok, donor) => ((await api("GET", `/donors/${donor}`, tok)).body || {}).gifts || [];
const recent = async tok => ((await api("GET", "/recent-changes", tok)).body || {}).rows || [];
const timeline = async donor => (await one(`SELECT COUNT(*)::int AS n FROM interactions WHERE org_id=$1 AND donor_id=$2`, [ORG, donor])).n;

(async () => {
  console.log("thanks1-receipt-vs-thanks (THANKS-1)");
  const { thankState, receiptWords } = await import("../shared/thankState.js");
  const tok = await freshOrg();

  // ── §1 a receipt is not a thank-you ──────────────────────────────────────
  const IVO = await person("d_thanks1_ivo", "Ivo Penhallow");
  const g1 = await gift(tok, IVO, { amount: 300 });
  const task = await one(`SELECT id FROM tasks WHERE org_id=$1 AND donor_id=$2 AND voided_at IS NULL AND COALESCE(done,0)=0 ORDER BY created_at LIMIT 1`, [ORG, IVO]);
  if (!task.id) await q(`INSERT INTO tasks (id,org_id,donor_id,title,source_gift_id,done,created_by,created_by_name) VALUES ('t_thanks1_ivo',$1,$2,'Thank Ivo for the $300',$3,0,$4,$5)`, [ORG, IVO, g1, ...ACT]);
  const taskId = task.id || "t_thanks1_ivo";
  const rc = await api("POST", `/gifts/${g1}/receipt`, tok, { send: false });
  const row1 = (await profileGifts(tok, IVO)).find(g => g.id === g1) || {};
  const ts1 = thankState(row1);
  ok("§1 a receipt leaves the gift not thanked, and the receipt is its own fact",
    rc.status === 201 && row1.thanked === false && ts1 && ts1.key === "not_yet" && ts1.words === "Receipt issued, not thanked yet"
      && /^Receipt #\S+ issued$/.test(receiptWords(row1) || ""), { rc: rc.status, row1: { thanked: row1.thanked, receipt: row1.receipt }, ts1 });
  const mark = await one(`SELECT acknowledgement_sent AS a, thanked_at FROM gifts WHERE id=$1`, [g1]);
  ok("§1 the receipt keeps its IRS meaning: the mark is set, the thank-you clock is not", mark.a === true && mark.thanked_at === null, mark);
  const tk = await api("GET", `/tasks/${taskId}/thank`, tok);
  const tkRow = await one(`SELECT done, voided_at FROM tasks WHERE id=$1`, [taskId]);
  ok("§1 the thank-you task stays open and its gift reads not thanked", tk.status === 200 && tk.body.gift && tk.body.gift.id === g1
    && tk.body.gift.thanked === false && Number(tkRow.done || 0) === 0 && !tkRow.voided_at, { tk: tk.body, tkRow });
  const aw = await one(`SELECT COUNT(*)::int AS n FROM gifts g WHERE g.id=$1 AND ${require("../shared/numbers/thanks").AWAITING("g")}`, [g1]);
  ok("§1 the one waiting-for-thanks rule (Home, the backlog, the task) still counts it", aw.n === 1, aw);
  const mk = await api("POST", "/acknowledgments/mark", tok, { giftIds: [g1], via: "email" });
  const row1b = (await profileGifts(tok, IVO)).find(g => g.id === g1) || {};
  ok("§1 the thank-you sets Thanked", mk.status === 200 && row1b.thanked === true && thankState(row1b).key === "thanked"
    && !!(await one(`SELECT thanked_at FROM gifts WHERE id=$1`, [g1])).thanked_at, { mk: mk.body, row1b: row1b.thanked });

  // ── §3 deleting a gift: no timeline line, one Recent changes line, and Undo ─
  const SOL = await person("d_thanks1_sol", "Soledad Arkwright");
  await gift(tok, SOL, { amount: 40, date: dayOffset(-40) });
  const g3 = await gift(tok, SOL, { amount: 25 });
  const t3 = await one(`SELECT id FROM tasks WHERE org_id=$1 AND source_gift_id=$2 AND voided_at IS NULL`, [ORG, g3]);
  if (!t3.id) await q(`INSERT INTO tasks (id,org_id,donor_id,title,source_gift_id,done,created_by,created_by_name) VALUES ('t_thanks1_sol',$1,$2,'Thank Soledad for the $25',$3,0,$4,$5)`, [ORG, SOL, g3, ...ACT]);
  const t3id = t3.id || "t_thanks1_sol";
  const tl0 = await timeline(SOL);
  const tot0 = await one(`SELECT total_giving::float AS t, gift_count AS n FROM donors WHERE id=$1`, [SOL]);
  const s0 = await assertSurfacesAgree(ORG, { token: tok, soft: true, label: "before the delete" });
  const del = await api("DELETE", `/gifts/${g3}`, tok);
  const tl1 = await timeline(SOL);
  const tot1 = await one(`SELECT total_giving::float AS t, gift_count AS n FROM donors WHERE id=$1`, [SOL]);
  ok("§3 the delete adds nothing to the timeline", del.status === 200 && tl1 <= tl0
    && !(await one(`SELECT 1 AS x FROM interactions WHERE org_id=$1 AND donor_id=$2 AND note LIKE 'Gift removed%'`, [ORG, SOL])).x, { del: del.body, tl0, tl1 });
  const lines = (await recent(tok)).filter(r => r.kind === "effect_gift_delete");
  ok("§3 one Recent changes line, with Undo", lines.length === 1 && /^Removed Soledad Arkwright's \$25 gift of \d{4}-\d{2}-\d{2}\./.test(lines[0].sentence)
    && lines[0].undo && lines[0].undo.path === `/gifts/${g3}/restore`, lines);
  const aud = await one(`SELECT summary FROM fin_audit_log WHERE org_id=$1 AND request_method='DELETE' AND request_path LIKE $2 ORDER BY created_at DESC LIMIT 1`, [ORG, `/gifts/${g3}%`]);
  ok("§3 the audit row says the same sentence", lines[0] && aud.summary === lines[0].sentence, { aud, line: lines[0] && lines[0].sentence });
  ok("§3 the totals drop by the gift", tot0.t - tot1.t === 25 && tot0.n - tot1.n === 1, { tot0, tot1 });
  const un = await api("POST", `/gifts/${g3}/restore`, tok, {});
  const tot2 = await one(`SELECT total_giving::float AS t, gift_count AS n FROM donors WHERE id=$1`, [SOL]);
  const t3b = await one(`SELECT voided_at FROM tasks WHERE id=$1`, [t3id]);
  const ledger = await one(`SELECT COUNT(*)::int AS n FROM fin_transactions WHERE org_id=$1 AND gift_id=$2`, [ORG, g3]);
  const s1 = await assertSurfacesAgree(ORG, { token: tok, soft: true, label: "after Undo" });
  ok("§3 Undo puts the gift back: totals, its thank-you task, and every surface as before", un.status === 200 && tot2.t === tot0.t && tot2.n === tot0.n
    && !t3b.voided_at && s0.ok && s1.ok && (await timeline(SOL)) <= tl0, { un: un.body, tot2, t3b, ledger, d0: s0.diffs, d1: s1.diffs });
  const again = await api("POST", `/gifts/${g3}/restore`, tok, {});
  ok("§3 the line leaves Recent changes and a second Undo is refused", again.status === 409
    && !(await recent(tok)).some(r => r.kind === "effect_gift_delete"), { again: again.status });
  const g4 = await gift(tok, SOL, { amount: 30 });
  await api("POST", `/gifts/${g4}/receipt`, tok, { send: false });
  const d4 = await api("DELETE", `/gifts/${g4}`, tok);
  ok("§3 a gift with a live receipt is refused, and the answer says the receipt was never sent", d4.status === 409
    && d4.body.error === "receipt_active" && d4.body.receiptSent === false && !!d4.body.receiptNumber, d4.body);

  // ── §2 one rule: every combination ───────────────────────────────────────
  const MARA = await person("d_thanks1_mara", "Mara Quillfeather");
  const amounts = { none: 11, receipt: 12, thanked: 13, both: 14, legacy: 15, refunded: 16 };
  const ids = {};
  for (const [k, a] of Object.entries(amounts)) ids[k] = await gift(tok, MARA, { amount: a });
  for (const k of ["receipt", "both"]) await api("POST", `/gifts/${ids[k]}/receipt`, tok, { send: false });
  await api("POST", "/acknowledgments/mark", tok, { giftIds: [ids.thanked, ids.both], via: "letter" });
  await q(`UPDATE gifts SET acknowledgement_sent=true WHERE id=$1`, [ids.legacy]);   // a mark from before the clock, no receipt
  await api("POST", `/gifts/${ids.refunded}/refund`, tok, { amount: 16, reason: "Entered twice", date: TODAY });
  const want = { none: false, receipt: false, thanked: true, both: true, legacy: true };
  const rows2 = await profileGifts(tok, MARA);
  const { AWAITING } = require("../shared/numbers/thanks");
  const waiting = new Set((await q(`SELECT g.id FROM gifts g WHERE g.org_id=$1 AND g.donor_id=$2 AND ${AWAITING("g")}`, [ORG, MARA])).map(r => r.id));
  const def = { entity: "gifts", columns: ["amount", "acknowledged"], filter: { op: "and", rules: [{ field: "donor", cmp: "eq", value: "Mara Quillfeather" }] } };
  const rb = await api("POST", "/report-builder/run", tok, { definition: def });
  const rbCols = (rb.body.columns || []).map(c => c.key);
  const rbBy = new Map((rb.body.rows || []).map(r => [Number(r[rbCols[0]]), r[rbCols[1]]]));
  const disagree = [];
  for (const [k, thanked] of Object.entries(want)) {
    const r = rows2.find(g => g.id === ids[k]) || {};
    const ts = thankState(r);
    const rbVal = rbBy.get(amounts[k]);
    const okRow = ts && (ts.key === "thanked") === thanked && waiting.has(ids[k]) === !thanked && (rbVal === true || rbVal === "Yes" || rbVal === "true") === thanked;
    if (!okRow) disagree.push({ k, ts, waiting: waiting.has(ids[k]), rbVal });
  }
  const ref = rows2.find(g => g.id === ids.refunded) || {};
  ok("§2 thankState, AWAITING and the Report builder's Thanked column agree on every combination", rb.status === 200 && !disagree.length
    && thankState(ref).key === "refunded" && !waiting.has(ids.refunded), { disagree, rb: rb.status, cols: rbCols, ref: thankState(ref) });
  const ed = await api("PUT", `/gifts/${ids.both}`, tok, { amount: 14, date: TODAY, type: "cash", thanked: false });
  const both = await one(`SELECT acknowledgement_sent AS a, thanked_at FROM gifts WHERE id=$1`, [ids.both]);
  ok("§2 un-ticking Thanked on a receipted gift clears the thank-you and keeps the receipt's mark", ed.status === 200 && both.a === true && both.thanked_at === null, { ed: ed.status, both });

  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
