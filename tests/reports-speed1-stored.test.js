// tests/reports-speed1-stored.test.js · REPORTS-SPEED-1. RETENTION, ANNUAL AND
// SYBUNT FROM A STORED PER-ORG ANSWER, AND NOT ONE NUMBER DIFFERENT.
//
// The three reports answer from the per-org store (orgSummary.js, org_summary)
// while nothing they read has changed (server/reports/storedReports.js). A
// stored report is only worth having if it can never show a number the gifts
// don't support, so this guards the money figures they carry.
//
//   §1  five orgs (calendar and fiscal years, refunds, imported first gifts,
//       a deleted person, households): every stored ask is read once from the
//       gifts and again from the store; the bytes are identical, the second
//       says it was stored, and with the store wiped a fresh computation gives
//       the same bytes again. A filtered ask (a fund) is never stored.
//   §2  a gift through the gift form, a gift logged on a conversation, and a
//       gift written straight into the table: the next read is fresh and has
//       moved, never the stored answer from before; after one after-change
//       step (the queue drained) the next read is stored again and equals a
//       fresh computation.
//   §3  what is NOT a change to these reports leaves them stored: a logged
//       call (which rescores the person) and a task. A renamed person is a
//       change (SYBUNT lists names).
//   §4  the nightly pass compares every org's stored answers with a fresh
//       computation and finds no difference, and finds the one planted in a
//       stored answer (the check is proven able to fail).
//
// HOW IT GOES RED (planted, seen red before green, REPORTS-SPEED-1 report):
//   * serve a stale answer after a gift: take "gifts" out of storedReports.DEPS,
//     and §2's reads after each door come back stored with the old totals.
//   * any reshaping of the stored body breaks §1's byte equality.
//   Against main: none of the three is ever stored (§1 and §3's "stored"
//   headers are absent) and §4's check route is a 404.
//
// Standard scratch stack (tests/README.md), booted with TEST_MODE=1. Sends nothing.
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, q, closeDb, api, civilPlusDays, drainQueue } = require("./helpers");
const { civilDay } = require("./clock");

const ORGS = ["org_rs1a", "org_rs1b", "org_rs1c", "org_rs1d", "org_rs1e"];
const FISCAL = { org_rs1a: 7, org_rs1b: 1, org_rs1c: 10, org_rs1d: 4, org_rs1e: 7 };
const day = n => civilPlusDays(n);
const rows = r => (r && r.rows) || r || [];
const NAMES = ["Ada Quill", "Bram Stoke", "Cora Lind", "Dex Morrow", "Edda Vance", "Finn Hale", "Gia Thorne", "Hugo Pell",
  "Iris Wren", "Jude Calloway", "Kit Ambrose", "Lena Fosse", "Milo Dunst", "Nora Pike"];

async function wipe(org) {
  for (const t of ["interactions", "tasks", "threads", "gift_fund_lines", "gifts", "org_summary"]) {
    await q(`DELETE FROM ${t} WHERE ${t === "org_summary" ? "org_key" : "org_id"}=$1`, [org]).catch(() => {});
  }
  await q(`DELETE FROM donors WHERE org_id=$1`, [org]);
  await q(`DELETE FROM households WHERE org_id=$1`, [org]).catch(() => {});
}
async function fixture(org, i) {
  await wipe(org);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,vocabulary_json)
           VALUES ($1,$2,$3,1,'active','team','America/New_York',$4) ON CONFLICT (id) DO UPDATE SET vocabulary_json=EXCLUDED.vocabulary_json`,
    [org, `Report Speed ${i + 1}`, `report-speed-${i + 1}`, JSON.stringify({ fiscal_year_start_month: FISCAL[org] })]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Rhea Speed','admin')
           ON CONFLICT (id) DO UPDATE SET password_hash=EXCLUDED.password_hash, org_id=EXCLUDED.org_id`,
    [`u_${org}`, org, `admin@${org}.test`, bcrypt.hashSync("loadtest1234", 4)]);
  if (i === 4) await q(`INSERT INTO households (id,org_id,name,created_by,created_by_name) VALUES ($1,$2,'The Pell household',$3,'Rhea Speed') ON CONFLICT DO NOTHING`, [`hh_${org}`, org, `u_${org}`]).catch(() => {});
  let g = 0;
  for (let p = 0; p < NAMES.length; p++) {
    const id = `d_${org}_${p}`;
    // org c: two people came in with an imported first gift years back; org d: one person is deleted.
    await q(`INSERT INTO donors (id,org_id,name,email,kind,created_by,created_by_name,imported_first_gift_date,deleted_at,household_id)
             VALUES ($1,$2,$3,$4,'individual',$5,'Rhea Speed',$6,$7,$8)`,
      [id, org, NAMES[p], `p${p}@${org}.test`, `u_${org}`, i === 2 && p < 2 ? day(-2400) : null,
       i === 3 && p === 5 ? new Date(Date.parse(day(-3) + "T12:00:00Z")).toISOString() : null, i === 4 && p > 10 ? `hh_${org}` : null]);
    // A rhythm per person: some every year, some lapsed, some first-time this year, amounts by org and person.
    const years = (p + i) % 4 === 0 ? [4, 3, 2, 1, 0] : (p + i) % 4 === 1 ? [4, 3, 2] : (p + i) % 4 === 2 ? [1, 0] : [3, 1, 0];
    for (const y of years) {
      for (const k of [0, 1].slice(0, 1 + ((p + y) % 2))) {
        g++;
        const amt = (25 + ((p * 37 + y * 11 + i * 7 + k * 5) % 400)) + (k ? 0.5 : 0);
        await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,payment_method) VALUES ($1,$2,$3,$4,$5,'cash','Check')`,
          [`g_${org}_${g}`, org, id, amt, day(-(y * 365 + 20 + ((p * 13 + k * 40 + i * 9) % 300)))]);
      }
    }
    // org b: a refund against one gift.
    if (i === 1 && p === 3) await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,payment_method,refund_of) VALUES ($1,$2,$3,-40,$4,'cash','Check',$5)`,
      [`g_${org}_refund`, org, id, day(-30), `g_${org}_${g}`]).catch(() => {});
  }
}
async function token(org) { return (await api("POST", "/auth/login", null, { email: `admin@${org}.test`, password: "loadtest1234" })).body.token; }
async function get(tok, path) {
  const r = await fetch(BASE + path, { headers: { authorization: `Bearer ${tok}` } });
  return { status: r.status, stored: r.headers.get("x-org-summary") === "stored", body: await r.text() };
}
const asksFor = () => {
  const y = Number(civilDay().slice(0, 4));
  return ["/reports/retention", "/reports/retention?yearMode=fiscal", "/reports/retention?yearMode=calendar",
    "/reports/annual", `/reports/annual?year=${y}&yearMode=calendar`, "/reports/sybunt", `/reports/sybunt?year=${y}&yearMode=calendar`];
};

(async () => {
  console.log("REPORTS-SPEED-1: Retention, Annual and SYBUNT from a stored answer, and not one number different\n");
  const toks = {};
  for (const [i, org] of ORGS.entries()) { await fixture(org, i); toks[org] = await token(org); }
  ok("the five orgs sign in", ORGS.every(o => !!toks[o]));

  // ── §1 the same bytes, stored and fresh ─────────────────────────────────
  const drift = [], notStored = [];
  for (const org of ORGS) {
    for (const path of asksFor()) {
      const a = await get(toks[org], path), b = await get(toks[org], path);
      if (a.status !== 200 || a.body !== b.body) drift.push(`${org} ${path} (${a.status})`);
      if (!b.stored) notStored.push(`${org} ${path}`);
      await q(`DELETE FROM org_summary WHERE org_key=$1`, [org]);
      const c = await get(toks[org], path);
      if (c.body !== a.body) drift.push(`${org} ${path} after wipe`);
    }
  }
  ok("§1 every ask, five orgs: the stored answer is the fresh answer, byte for byte", drift.length === 0, drift.slice(0, 6));
  ok("§1 and the second read says it was stored", notStored.length === 0, notStored.slice(0, 6));
  const [fund] = rows(await q(`SELECT id FROM fin_funds WHERE org_id=$1 LIMIT 1`, [ORGS[0]]));
  const f1 = await get(toks[ORGS[0]], `/reports/annual?fundId=${fund ? fund.id : "none"}`), f2 = await get(toks[ORGS[0]], `/reports/annual?fundId=${fund ? fund.id : "none"}`);
  ok("§1 a filtered ask (a fund) is never stored: it computes live, as before", f1.status === 200 && !f2.stored, { status: f1.status, stored: f2.stored });

  // ── §2 a gift through any door ──────────────────────────────────────────
  const ORG = ORGS[0], tok = toks[ORG], P = "/reports/retention?yearMode=calendar", S = "/reports/sybunt";
  // Each door's person gave some years back and not this year, so they are on SYBUNT and a gift today takes them off.
  const priorYearDonor = `d_${ORG}_1`;
  const doors = [
    ["the gift form", () => api("POST", `/donors/${priorYearDonor}/gifts`, tok, { amount: 77, date: day(0), type: "cash", payment_method: "check" })],
    ["a gift logged on a conversation", () => api("POST", `/donors/d_${ORG}_5/conversations`, tok, { touch: "note_only", line: "Handed over a check at the open house.", gift: { amount: "64.25" }, nextStep: { skipped: true } })],
    ["a gift written straight into the table", () => q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,payment_method) VALUES ('g_rs1_direct',$1,$2,51,$3,'cash','Check')`, [ORG, `d_${ORG}_9`, day(0)])],
  ];
  for (const [name, door] of doors) {
    await get(tok, P); await get(tok, S);
    const before = await get(tok, P), sBefore = await get(tok, S);
    await door();
    const after = await get(tok, P), sAfter = await get(tok, S);
    ok(`§2 ${name}: the next read is fresh, not the stored answer from before`, before.stored && !after.stored && !sAfter.stored, { before: before.stored, after: after.stored, sybunt: sAfter.stored });
    ok(`§2 ${name}: and the answer moved with the gift`, after.body !== before.body || sAfter.body !== sBefore.body);
    await drainQueue(q, { orgId: ORG });
    const next = await get(tok, P);
    await q(`DELETE FROM org_summary WHERE org_key=$1 AND key LIKE 'report|%'`, [ORG]);
    const fresh = await get(tok, P);
    ok(`§2 ${name}: after one after-change step it is stored again, and equal to a fresh computation`, next.body === fresh.body && (next.stored || name.includes("straight")), { stored: next.stored });
  }

  // ── §3 what is not a change to these reports ────────────────────────────
  await get(tok, P); await get(tok, S);
  await api("POST", `/donors/d_${ORG}_4/interactions`, tok, { type: "call", date: day(0), note: "Caught up about the spring show." });
  await api("POST", "/tasks", tok, { title: "Send Cora the program", due: day(3), donorId: `d_${ORG}_2` });
  await drainQueue(q, { orgId: ORG, scores: true });
  const afterCall = await get(tok, P), sAfterCall = await get(tok, S);
  ok("§3 a logged call (the person rescored) and a task leave all three stored", afterCall.stored && sAfterCall.stored, { retention: afterCall.stored, sybunt: sAfterCall.stored });
  await api("PUT", `/donors/d_${ORG}_4`, tok, { name: "Dexter Morrow" });
  const sRenamed = await get(tok, S);
  ok("§3 a renamed person is a change: SYBUNT recomputes", !sRenamed.stored, { stored: sRenamed.stored });

  // ── §4 the nightly pass ─────────────────────────────────────────────────
  for (const org of ORGS) for (const path of asksFor()) await get(toks[org], path);
  let c = await api("POST", "/org-summary/stored-reports/check", tok);
  ok("§4 the nightly pass compares the stored answers with a fresh computation: no difference", c.status === 200 && c.body.compared > 0 && c.body.differences.length === 0, c.body);
  const [row] = rows(await q(`SELECT key, body FROM org_summary WHERE org_key=$1 AND key LIKE 'report|*|/reports/retention?yearMode=fiscal%'`, [ORG]));
  const planted = row ? row.body.replace(/"retainedDonors":(\d+)/, (m, n) => `"retainedDonors":${Number(n) + 1}`) : null;
  if (row) await q(`UPDATE org_summary SET body=$3 WHERE org_key=$1 AND key=$2`, [ORG, row.key, planted]);
  c = await api("POST", "/org-summary/stored-reports/check", tok);
  ok("§4 and it finds the difference planted in a stored answer, and logs it", !!row && c.body.differences.length === 1 && /DIFFERENCE org_rs1a \/reports\/retention\?yearMode=fiscal/.test(c.body.lines.join("\n")), c.body);
  const healed = await get(tok, "/reports/retention?yearMode=fiscal");
  ok("§4 the pass stores the fresh answer, so the planted one is gone", healed.stored && healed.body === row.body && healed.body !== planted, { stored: healed.stored });

  for (const org of ORGS) await wipe(org);
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch {} process.exit(1); });
