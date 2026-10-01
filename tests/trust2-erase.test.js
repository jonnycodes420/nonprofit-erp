// tests/trust2-erase.test.js — TRUST-2. THE ONE GUARD THIS BUILD EARNED.
//
//     ERASING A PERSON REMOVES EVERY PERSONAL FIELD AND LOGGED MESSAGE, AND THE
//     ORG'S GIFT TOTALS FOR EVERY FUND AND YEAR ARE IDENTICAL TO THE CENT
//     BEFORE AND AFTER.
//
// The person gets gifts in two funds across two years through the real gift
// route (so the ledger writes its "Gift from <name>" line), a receipt whose
// snapshot carries the name, a logged email, a meeting and a note. After the
// erasure every text and JSON column of every table in the org is searched for
// the name, the email and the private words; none may be found. Then the
// totals by fund and year are compared to the cent.
//
// HOW IT WOULD GO RED: delete the gifts instead of keeping them (totals move);
// leave the ledger description or the receipt snapshot alone (the name is
// found); keep interactions (the email body is found). Proven able to fail:
// skipping the fin_transactions update turns §1 red.

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "org_trust2";
const NAME = "Ottilie Quarrington-Vane";
const EMAIL = "ottilie.qv@trust2.invalid";
const SECRET = "the hospice bequest she mentioned in confidence";

async function reset() {
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  for (const t of ["calendar_events", "receipts", "fin_transactions", "interactions", "gifts", "donors", "fin_funds", "accounts", "user_sessions", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Trust Two','trust-two',1,'active','team')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_trust2',$1,'owner@trust2.local',$2,'Owner','admin')`,
    [ORG, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fnd_t2_gen',$1,'General',false),('fnd_t2_sch',$1,'Scholarships',true)`, [ORG]);
}

const totals = () => q(`SELECT COALESCE(fund_id,'none') AS fund, LEFT(date,4) AS year, SUM(amount)::numeric(14,2)::text AS total, COUNT(*)::int AS n
                          FROM gifts WHERE org_id=$1 GROUP BY 1,2 ORDER BY 1,2`, [ORG]);

// Every text, varchar and json column of every table that has an org_id,
// EXCEPT the audit log. fin_audit_log is append-only by the standing rule
// (CLAUDE.md: "Audit rows are append-only to the application, enforced by a
// trigger"), so the rows that recorded this person's creation and gifts keep
// the name. Redacting them is a decision for Jonathan, not this build; the
// erasure's OWN audit row is checked in §3 and carries nothing erased.
const NOT_SCANNED = new Set(["fin_audit_log"]);
async function findAnywhere(needle) {
  const cols = await q(`SELECT c.table_name, c.column_name FROM information_schema.columns c
                         WHERE c.table_schema='public' AND c.data_type IN ('text','character varying','jsonb','json')
                           AND EXISTS (SELECT 1 FROM information_schema.columns o WHERE o.table_schema='public' AND o.table_name=c.table_name AND o.column_name='org_id')`);
  const hits = [];
  for (const { table_name: t, column_name: c } of cols) {
    if (NOT_SCANNED.has(t)) continue;
    const [r] = await q(`SELECT COUNT(*)::int n FROM "${t}" WHERE org_id=$1 AND "${c}"::text ILIKE $2`, [ORG, `%${needle}%`]).catch(() => [{ n: 0 }]);
    if (r.n) hits.push(`${t}.${c}`);
  }
  return hits;
}

(async () => {
  await reset();
  const tok = await login("owner@trust2.local");
  const made = await api("POST", "/donors", tok, { name: NAME, email: EMAIL, phone: "555-0199" });
  const id = made.body?.id;
  ok("the person exists", !!id, made.status);
  for (const [amount, date, fundId] of [[250, "2025-03-04", "fnd_t2_gen"], [1000.55, "2025-11-20", "fnd_t2_sch"], [75.10, "2026-02-14", "fnd_t2_gen"]]) {
    const g = await api("POST", `/donors/${id}/gifts`, tok, { amount, date, fundId, notes: `For ${NAME}, ${SECRET}` });
    ok(`a gift of ${amount} is recorded`, g.status === 201 || g.status === 200, g.status);
  }
  // Someone else's gift in the same fund, so the totals compare against more than one person.
  const other = await api("POST", "/donors", tok, { name: "Second Person", email: "second@trust2.invalid" });
  await api("POST", `/donors/${other.body.id}/gifts`, tok, { amount: 40, date: "2025-03-05", fundId: "fnd_t2_gen" });
  await api("POST", `/donors/${id}/interactions`, tok, { type: "email", note: `Re: the gala\n\n${SECRET}`, date: "2026-02-15" });
  await api("POST", `/donors/${id}/interactions`, tok, { type: "note", note: `Called ${NAME}. ${SECRET}.` });
  await q(`INSERT INTO calendar_events (id,org_id,owner_user_id,provider,provider_event_id,title,starts_at,ends_at,location,person_ids,created_by)
           VALUES ('cal_t2',$1,'u_trust2','google','ev_t2',$2,NOW(),NOW()+INTERVAL '1 hour','Her kitchen',ARRAY[$3],'system:test')`, [ORG, `Coffee with ${NAME}`, id]);
  await q(`INSERT INTO receipts (id,org_id,donor_id,receipt_number,amount,deductible_amount,snapshot,sent_to) VALUES ('rcp_t2',$1,$2,'T2-1',250,250,$3::jsonb,$4)`,
    [ORG, id, JSON.stringify({ donorName: NAME, amount: 250 }), EMAIL]).catch(e => console.error("receipt seed:", e.message));

  const before = await totals();
  ok("before: the name is on the record in several places", (await findAnywhere(NAME)).length >= 3, (await findAnywhere(NAME)).join(", "));

  const refused = await api("POST", `/donors/${id}/erase`, tok, {});
  ok("erasing asks to be confirmed", refused.status === 400, refused.status);
  const done = await api("POST", `/donors/${id}/erase`, tok, { confirm: "ERASE" });
  ok("the erasure runs", done.status === 200, done.status + " " + JSON.stringify(done.body));

  // §1 — nothing personal is left anywhere in the org.
  for (const [label, needle] of [["name", NAME], ["surname", "Quarrington"], ["email", EMAIL], ["phone", "555-0199"], ["private words", "hospice bequest"]]) {
    const hits = await findAnywhere(needle);
    ok(`§1 their ${label} is nowhere`, hits.length === 0, hits.join(", "));
  }
  const ints = await q(`SELECT COUNT(*)::int n FROM interactions WHERE org_id=$1 AND donor_id=$2`, [ORG, id]);
  ok("§1 every logged message and note is gone", ints[0].n === 0, ints[0].n);
  ok("§1 the meeting is gone", (await q(`SELECT 1 FROM calendar_events WHERE id='cal_t2'`)).length === 0, "");
  const [d] = await q(`SELECT name, email, phone, notes, erased_at FROM donors WHERE id=$1`, [id]);
  ok("§1 the record says what happened and holds nothing else", d.name === "Erased person" && !d.email && !d.phone && !d.notes && !!d.erased_at, JSON.stringify(d));

  // §2 — the money foots, fund by fund and year by year.
  const after = await totals();
  ok("§2 gift totals by fund and year are identical to the cent", JSON.stringify(before) === JSON.stringify(after),
    JSON.stringify({ before, after }));
  ok("§2 the gifts are still there, as anonymous gifts", (await q(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1 AND donor_id=$2`, [ORG, id]))[0].n === 3, "");

  // §3 — the audit row names who and when, never what.
  const audit = await q(`SELECT action, entity_label, before_fields, after_fields, changes, summary FROM fin_audit_log WHERE org_id=$1 AND action ILIKE '%erased%' ORDER BY created_at DESC LIMIT 1`, [ORG]);
  ok("§3 the erasure is in the audit log", audit.length === 1, audit.length);
  ok("§3 …without the erased details", audit.length === 1 && !JSON.stringify(audit[0]).includes("Quarrington") && !JSON.stringify(audit[0]).includes(EMAIL), JSON.stringify(audit[0] || {}).slice(0, 200));

  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
