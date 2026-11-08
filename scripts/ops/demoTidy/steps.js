// scripts/ops/demoTidy/steps.js · DEMO-TIDY-1. WHAT THE TIDY CHANGES, ONE STEP PER BRIEF ITEM.
//
// Every step runs inside the apply's transaction on client `c`, records each
// change on the journal `J`, and is a no-op when its work is already done, so
// a second apply changes nothing. Every name it writes is made up.
"use strict";
const { fundKey, liveFunds, mergeInTx } = require("../../../server/finance/fundMerge");
const { addMonths, nthDate } = require("../../../server/donors/offlinePlans");

// A walk's own records: a name that starts with the word QA ("QA", "QA Nov5",
// "QA A3 …"). Upper case and a whole word, so "Qadir" and "Quality" are not.
const QA = `^\\s*QA\\M`;
const QA_RE = /^\s*QA\b/;
const HAS_QA = /\bQA\b/;   // QA text anywhere in a field (residue left on a real record)

const pg = sql => { let i = 0; return sql.replace(/\?/g, () => "$" + (++i)); };
const tx = c => ({ queryTx: async (cl, s, a) => (await cl.query(pg(s), a)).rows, runTx: async (cl, s, a) => ({ changes: (await cl.query(pg(s), a)).rowCount }) });

// ── 1 · QA residue ───────────────────────────────────────────────────────
// [table, the name column, how it is "deleted"]. A person goes to the trash
// (deleted_at), as Delete does on screen; the rest are removed with what
// cascades from them, all kept for --undo.
const QA_TABLES = [
  ["donor_list_views", "name", "saved views"],
  ["audiences", "name", "groups"],
  ["cultivation_plans", "template_name", "journeys on a person"],
  ["cultivation_templates", "name", "journeys"],
  ["tasks", "title", "tasks"],
  ["volunteer_shifts", "role", "logged shifts"],
  ["volunteer_slots", "name", "scheduled shifts"],
  ["events", "name", "events"],
  ["agent_drafts", "subject", "drafts"],
  ["campaigns", "name", "campaigns and their drafts"],
];

// Marlowe's demo baseline. No seed in the repo holds org_creo's imported
// people, so these made-up values ARE the seed for these fields. A field is
// set only when it is empty or carries QA text.
const MARLOWE = {
  about_them: "Retired architect and a season subscriber since 2019. Prefers a phone call to email and likes to hear how the youth ensemble is doing.",
  birth_month: 4, birth_day: 12, birth_year: 1956,
  address: "214 Linden Avenue", city: "Hudson", state: "NY", zip: "12534",
};

async function qaResidue(c, J, ctx) {
  const org = ctx.orgId;
  const out = [];
  const [p] = (await c.query(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id = $1 AND deleted_at IS NULL AND name ~ $2`, [org, QA])).rows;
  if (p.n) out.push(`${p.n} QA people to the trash`);
  await J.update("donors", `org_id = $1 AND deleted_at IS NULL AND name ~ $2`, [org, QA], { deleted_at: ctx.now }, `${p.n} QA people`);
  for (const [t, col, words] of QA_TABLES) {
    // A journey on a person also goes when its journey does.
    const extra = t === "cultivation_plans" ? ` OR template_id IN (SELECT id FROM cultivation_templates WHERE org_id = $1 AND name ~ $2)` : "";
    const n = await J.del(t, `org_id = $1 AND (${col} ~ $2${extra})`, [org, QA], `QA ${words}`);
    if (n) out.push(`${n} QA ${words}`);
  }
  // An event's "Came to" / "Registered for" lines go with the event (STALE-2's rule).
  const goneEvents = J.entries.filter(e => e.op === "delete" && e.table === "events").flatMap(e => e.rows.map(r => r.id));
  if (goneEvents.length) {
    const n = await J.del("interactions", `org_id = $1 AND metadata->>'event_id' = ANY($2::text[]) AND metadata->>'via' = ANY($3::text[])`,
      [org, goneEvents, require("../../../server/events/attendanceLines").VIAS], "the QA events' timeline lines");
    if (n) out.push(`${n} timeline lines of those events`);
  }
  // Marlowe: QA text out of About and the address, and the baseline back.
  const ms = (await c.query(`SELECT id, name, about_them, address, city, state, zip, birth_month FROM donors
                              WHERE org_id = $1 AND deleted_at IS NULL AND name ~ '\\mMarlowe\\M' AND name !~ $2
                                AND COALESCE(kind, '') <> 'organisation' ORDER BY created_at, id`, [org, QA])).rows;
  if (ms.length > 1 && !ctx.marlowe) out.push(`Marlowe: ${ms.length} people match (${ms.map(m => m.id).join(", ")}); pass --marlowe=<id> to pick one. Left as is.`);
  const m = ctx.marlowe ? ms.find(x => x.id === ctx.marlowe) : ms.length === 1 ? ms[0] : null;
  if (m) {
    const dirty = v => v == null || String(v).trim() === "" || HAS_QA.test(String(v));
    const set = {};
    if (dirty(m.about_them)) set.about_them = MARLOWE.about_them;
    if (dirty(m.address)) Object.assign(set, { address: MARLOWE.address, city: MARLOWE.city, state: MARLOWE.state, zip: MARLOWE.zip });
    if (m.birth_month == null) Object.assign(set, { birth_month: MARLOWE.birth_month, birth_day: MARLOWE.birth_day, birth_year: MARLOWE.birth_year });
    if (Object.keys(set).length) {
      await J.update("donors", `org_id = $1 AND id = $2`, [org, m.id], set, `Marlowe's ${Object.keys(set).join(", ")}`);
      out.push(`${m.name}: ${Object.keys(set).filter(k => !/^(city|state|zip|birth_day|birth_year)$/.test(k)).map(k => ({ about_them: "About", address: "address", birth_month: "birthday" })[k]).join(", ")} set to the demo baseline`);
    }
  } else if (!ms.length) out.push("Marlowe: no person by that name here. Nothing to restore.");
  return out;
}

// ── 2 · Receipt details ──────────────────────────────────────────────────
const DEMO_EIN = "84-2917365";   // made up; not on shared/placeholderCopy.js's list
async function receipt(c, J, ctx) {
  const { isPlaceholderEin } = await import("../../../shared/placeholderCopy.js");
  if (isPlaceholderEin(DEMO_EIN)) throw new Error("The demo EIN is on the placeholder list.");
  const [o] = (await c.query(`SELECT ein, receipt_signature_name, receipt_signature_title FROM orgs WHERE id = $1`, [ctx.orgId])).rows;
  // The director: an admin whose signature title says Director, else the first admin.
  const users = (await c.query(`SELECT id, name, sign_name, sign_title, created_at FROM users
                                 WHERE org_id = $1 AND role = 'admin' AND deactivated_at IS NULL ORDER BY created_at, id`, [ctx.orgId])).rows;
  const d = users.find(u => /director/i.test(u.sign_title || "")) || users[0];
  const out = [];
  const set = {};
  if (!o.ein || isPlaceholderEin(o.ein)) set.ein = DEMO_EIN;
  if (d) {
    const name = (d.sign_name || d.name || "").trim(), title = (d.sign_title || "Executive Director").trim();
    if (name && o.receipt_signature_name !== name) set.receipt_signature_name = name;
    if (name && o.receipt_signature_title !== title) set.receipt_signature_title = title;
  } else out.push("No admin user to sign receipts. Signer left as is.");
  if (!Object.keys(set).length) return out;
  await J.update("orgs", `id = $1`, [ctx.orgId], set, "receipt details");
  if (set.ein) out.push(`EIN ${o.ein || "(none)"} → ${DEMO_EIN}`);
  if (set.receipt_signature_name || set.receipt_signature_title) out.push(`Signer ${o.receipt_signature_name || "(none)"} → ${set.receipt_signature_name || o.receipt_signature_name}, ${set.receipt_signature_title || o.receipt_signature_title}`);
  return out;
}

// ── 3 · Near-duplicate funds, through TRUTH-3's merge ────────────────────
// Funds whose names are one fund in other words (fundKey). The keeper is the
// fuller name ("General Operating" over "General"), then the older.
async function funds(c, J, ctx) {
  const rows = (await c.query(`SELECT id, name, restricted, created_at FROM fin_funds WHERE org_id = $1 AND retired_at IS NULL ORDER BY created_at, id`, [ctx.orgId])).rows;
  const by = new Map();
  for (const r of rows) { const k = fundKey(r.name); if (!k) continue; if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
  const out = [];
  for (const g of by.values()) {
    if (g.length < 2) continue;
    const keeper = [...g].sort((a, b) => b.name.length - a.name.length)[0];
    const merging = g.filter(f => f.id !== keeper.id);
    if (merging.some(f => !!f.restricted !== !!keeper.restricted)) { out.push(`${g.map(f => f.name).join(" / ")}: one is restricted and one is not. Never merged; left for a person.`); continue; }
    const q = async (s, a) => (await c.query(pg(s), a)).rows;
    const [K] = await liveFunds(q, ctx.orgId, [keeper.id]);
    const M = await liveFunds(q, ctx.orgId, merging.map(f => f.id));
    const id = J.rid("fm_");
    const { moved } = await mergeInTx(c, { orgId: ctx.orgId, keeper: K, merged: M, keeperId: K.id, mergeIds: M.map(f => f.id) }, ctx.actor, id, tx(c));
    J.note({ op: "fund_merge", mergeId: id, label: `${M.map(f => f.name).join(", ")} into ${K.name}` });
    const n = Object.entries(moved).filter(([k]) => k !== "orgs").reduce((s, [, v]) => s + v, 0);
    out.push(`${M.map(f => `"${f.name}"`).join(" and ")} merged into "${K.name}" (${n} rows moved)`);
  }
  return out;
}

// ── 4 · Believable demo data ─────────────────────────────────────────────
// Fixed ids, so a second apply sees them and adds nothing.
const RECURRING = [
  { id: "dt1_rec_halvorsen", name: "Corinne Halvorsen", email: "corinne.halvorsen@example.org", amount: 50, months: 6, method: "check" },
  { id: "dt1_rec_okafor", name: "Desmond Okafor", email: "desmond.okafor@example.org", amount: 25, months: 8, method: "bank transfer" },
];
const FUNDER = { id: "dt1_fdn_alder", name: "Alder Creek Foundation", email: "grants@aldercreek.example.org" };
const GRANT = { id: "dt1_grant_alder", ms: "dt1_ms_alder_report", program: "Youth Ensemble Program", amount: 18000, reportInDays: 21 };

const addDays = (d, n) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) + n * 864e5).toISOString().slice(0, 10);
const person = (ctx, p, extra = {}) => ({ id: p.id, org_id: ctx.orgId, name: p.name, email: p.email, stage: "steward", status: "active",
  person_types: ["donor"], created_by: ctx.actor.id, created_by_name: ctx.actor.name, ...extra });

async function demoData(c, J, ctx) {
  const out = [];
  const have = async (t, id) => (await c.query(`SELECT 1 FROM ${t} WHERE id = $1`, [id])).rows.length > 0;
  const [gen] = (await c.query(`SELECT id FROM fin_funds WHERE org_id = $1 AND retired_at IS NULL AND restricted IS NOT TRUE ORDER BY (name ILIKE 'general%') DESC, created_at LIMIT 1`, [ctx.orgId])).rows;
  for (const r of RECURRING) {
    if (await have("donors", r.id)) continue;
    const start = addMonths(ctx.today, -r.months);
    await J.insert("donors", person(ctx, r), r.name);
    const planId = r.id.replace("dt1_rec_", "dt1_plan_");
    await J.insert("offline_recurring_plans", { id: planId, org_id: ctx.orgId, donor_id: r.id, amount: r.amount, frequency: "monthly", start_date: start,
      fund_id: gen ? gen.id : null, method: r.method, status: "active", created_by: ctx.actor.id, created_by_name: ctx.actor.name }, `${r.name}'s plan`);
    const plan = { start_date: start, frequency: "monthly" };
    const dates = [];
    for (let k = 0; ; k++) { const d = nthDate(plan, k); if (d > ctx.today) break; dates.push(d); }
    ctx.gifts.push(...dates.map((d, k) => ({ id: `${planId}_g${k + 1}`, donorId: r.id, planId, amount: r.amount, date: d, fundId: gen ? gen.id : null, method: r.method })));
    out.push(`${r.name}: $${r.amount} a month by ${r.method} since ${start}, ${dates.length} payments, next ${nthDate(plan, dates.length)}`);
  }
  if (!(await have("grants", GRANT.id))) {
    if (!(await have("donors", FUNDER.id))) await J.insert("donors", person(ctx, FUNDER, { kind: "organisation", person_types: ["donor"], stage: "steward" }), FUNDER.name);
    const due = addDays(ctx.today, GRANT.reportInDays), awarded = addMonths(ctx.today, -5);
    await J.insert("grants", { id: GRANT.id, org_id: ctx.orgId, funder: FUNDER.name, funder_donor_id: FUNDER.id, program: GRANT.program,
      amount: GRANT.amount, amount_awarded: GRANT.amount, amount_requested: GRANT.amount, status: "reporting", report_due: due,
      awarded_at: awarded, created_by: ctx.actor.id, created_by_name: ctx.actor.name }, "the Alder Creek grant");
    await J.insert("grant_milestones", { id: GRANT.ms, org_id: ctx.orgId, grant_id: GRANT.id, kind: "report_due", due_date: due, state: "pending",
      label: "Interim report", created_by: ctx.actor.id, created_by_name: ctx.actor.name }, "its report due");
    // The database's trigger makes the milestone a task (trg_milestone_task_sync); it goes when the milestone goes.
    out.push(`${FUNDER.name}: $${GRANT.amount.toLocaleString("en-US")} for ${GRANT.program}, in Reporting, interim report due ${due}`);
  }
  return out;
}

// ── 5 · One email, one invite, no campaign "sent to 0" ───────────────────
async function people(c, J, ctx) {
  const org = ctx.orgId, out = [];
  // An email on two live people stays on the one with the most gifts (then the older record).
  const shared = (await c.query(
    `SELECT LOWER(TRIM(d.email)) AS e, array_agg(d.id ORDER BY (SELECT COUNT(*) FROM gifts g WHERE g.org_id = d.org_id AND g.donor_id = d.id AND g.amount > 0) DESC, d.created_at, d.id) AS ids
       FROM donors d WHERE d.org_id = $1 AND d.deleted_at IS NULL AND COALESCE(TRIM(d.email), '') <> ''
      GROUP BY 1 HAVING COUNT(*) > 1`, [org])).rows;
  for (const s of shared) {
    const others = s.ids.slice(1);
    await J.update("donors", `org_id = $1 AND id = ANY($2::text[])`, [org, others], { email: null }, `a shared email off ${others.length} record(s)`);
    out.push(`An email on ${s.ids.length} people now sits on one (${s.ids[0]}); taken off ${others.join(", ")}`);
  }
  // Pending invites to one address: the newest stays, the rest are revoked.
  const dup = (await c.query(
    `SELECT LOWER(TRIM(email)) AS e, array_agg(id ORDER BY created_at DESC, id DESC) AS ids FROM invites
      WHERE org_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())
      GROUP BY 1 HAVING COUNT(*) > 1`, [org])).rows;
  for (const d of dup) {
    await J.update("invites", `org_id = $1 AND id = ANY($2::text[])`, [org, d.ids.slice(1)], { revoked_at: ctx.now }, "duplicate invites");
    out.push(`${d.ids.length} pending invites to one address: ${d.ids.length - 1} revoked, the newest kept`);
  }
  // A campaign marked sent that reached no one is archived (retired), not deleted.
  const zero = (await c.query(
    `SELECT id, name FROM campaigns c WHERE org_id = $1 AND status = 'sent' AND COALESCE(recipient_count, 0) = 0 AND retired_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM campaign_recipients r WHERE r.campaign_id = c.id)`, [org])).rows;
  if (zero.length) {
    await J.update("campaigns", `org_id = $1 AND id = ANY($2::text[])`, [org, zero.map(z => z.id)],
      { retired_at: ctx.now, retired_by: ctx.actor.id, retired_by_name: ctx.actor.name }, "campaigns sent to no one");
    out.push(`Archived ${zero.map(z => `"${z.name}"`).join(", ")}: marked sent, reached 0 people`);
  }
  return out;
}

const STEPS = [
  ["1 QA residue", qaResidue],
  ["2 Receipt details", receipt],
  ["3 Near-duplicate funds", funds],
  ["4 Demo data", demoData],
  ["5 One email, one invite, no empty send", people],
];

module.exports = { STEPS, QA, QA_RE, QA_TABLES, MARLOWE, DEMO_EIN, RECURRING, FUNDER, GRANT };
