// tests/lib/flows6Fixture.js · FLOWS-6. AN ORG SHAPED LIKE THE FLEET'S FINDINGS.
//
// Made-up people only. One org with:
//   · Odile, with an open "Follow up" step from a call logged earlier, due on
//     the day the dialog proposes for a call (W-1110-Donors-35X)
//   · Sable, with an open step, for the rail's Mark done and Plan a follow-up
//     (W-1110-Donors-35X, W-1109-Donors-41)
//   · Pell, nothing open (W-1110-Donors-36X)
//   · Rhea, one open task due in 20 days and one due in 15 days done early
//     (W-1110-Donors-23X)
//   · three people lapsed 18 months, owned by nobody, and a teammate, Bram,
//     who owns none of them (W-1109-Donors-18X)
//   · Tobin, whose own yearly gift is a month late, linked as Owner of
//     Harborview Fund, which gave last month (W-1110-Donors-33X)
//   · two Corin Vale records, each assigned to a teammate (W-1110-Donors-44X)
//   · first-time givers of $100 and $600, so Home has a note and a call (W-1110-Donors-03X)
// Returns { org, email, password, token, ids, today, users }.
"use strict";
const path = require("path");
const bcrypt = require("bcryptjs");
const { login, api, q, civilPlusDays } = require("../helpers");

const PASSWORD = "loadtest1234";

async function buildFlows6Org(run = require("crypto").randomBytes(4).toString("hex")) {
  const ORG = `org_flows6_${run}`;
  const EMAIL = `owner-${run}@flows6.local`;
  const ME = `u_flows6_${run}`, BRAM = `u_flows6b_${run}`;
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,emails_enabled,onboarded_at)
           VALUES ($1,'Flows Six Lantern Quay',$1,1,'active','team','America/New_York',true,NOW())`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Ines Varro','admin')`,
    [ME, ORG, EMAIL, bcrypt.hashSync(PASSWORD, 4)]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Bram Ortolan','member')`,
    [BRAM, ORG, `bram-${run}@flows6.local`, bcrypt.hashSync(PASSWORD, 4)]);
  const tok = await login(EMAIL, PASSWORD);
  const today = civilPlusDays(0);
  const ids = {};
  const P = async (key, name, extra = {}) => {
    const r = await api("POST", "/donors", tok, { name, email: `${key}-${run}@flows6.invalid`, ...extra });
    if (!r.body || !r.body.id) throw new Error(`fixture ${name}: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
    return (ids[key] = r.body.id);
  };
  const gift = async (id, amount, date) => {
    const r = await api("POST", `/donors/${id}/gifts`, tok, { amount, date, payment_method: "check" });
    if (!(r.status === 200 || r.status === 201)) throw new Error(`fixture gift ${amount}: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  };
  // The thank-you step a gift opens is closed, so each person starts with only what the item needs.
  const closeSteps = id => q(`UPDATE threads SET closed_at=NOW(), close_kind='dismissed', close_reason='done' WHERE donor_id=$1 AND closed_at IS NULL`, [id]);
  const shape = await import(path.join(__dirname, "..", "..", "shared", "threadShape.js"));

  // ── 35X: Odile's open "Follow up", due on the day a call proposes ────────
  const callStep = shape.nextStepSuggestion("call_reached", today, "Talked about the spring tour.");
  ids.followDue = callStep.due;
  for (const [key, name] of [["odile", "Odile Brasher"], ["sable", "Sable Wrenfield"]]) {
    await P(key, name); await gift(ids[key], 500, civilPlusDays(-200)); await closeSteps(ids[key]);
    const r = await api("POST", `/donors/${ids[key]}/conversations`, tok, { touchKind: "call", line: "Left word about the tour.", date: civilPlusDays(-3),
      nextStep: { type: shape.nextStepTypeForLabel("Follow up"), label: "Follow up", due: ids.followDue } });
    if (r.status !== 201) throw new Error(`fixture step: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  }

  // ── 36X: Pell, nothing open ──────────────────────────────────────────────
  await P("pell", "Pell Tanager"); await gift(ids.pell, 300, civilPlusDays(-200)); await closeSteps(ids.pell);

  // ── 23X: Rhea, one open task and one done early ──────────────────────────
  await P("rhea", "Rhea Calloway"); await gift(ids.rhea, 250, civilPlusDays(-200)); await closeSteps(ids.rhea);
  const open = await api("POST", "/tasks", tok, { title: "Send the annual report", due: civilPlusDays(20), donorId: ids.rhea, type: "donor" });
  const early = await api("POST", "/tasks", tok, { title: "Mail the gala program", due: civilPlusDays(15), donorId: ids.rhea, type: "donor" });
  ids.openTask = open.body && open.body.id; ids.earlyTask = early.body && early.body.id;
  const c = await api("POST", `/tasks/${ids.earlyTask}/complete`, tok, {});
  if (!(c.status === 200 || c.status === 201)) throw new Error(`fixture complete: ${c.status} ${JSON.stringify(c.body).slice(0, 160)}`);

  // ── 18X: three lapsed 18 months, owned by nobody ─────────────────────────
  for (const [k, n, amt] of [["lap1", "Ula Fenwright", 900], ["lap2", "Wystan Pell", 400], ["lap3", "Yara Quillon", 250]]) {
    await P(k, n); await gift(ids[k], amt, civilPlusDays(-540)); await closeSteps(ids[k]);
  }

  // ── 33X: Tobin, a month late on his own, Current through Harborview Fund ─
  await P("tobin", "Tobin Marsh");
  for (const d of [-1125, -760, -395]) await gift(ids.tobin, 1000, civilPlusDays(d));
  await P("fund", "Harborview Fund", { kind: "organization", personTypes: ["organization"] });
  await gift(ids.fund, 5000, civilPlusDays(-30));
  const lk = await api("POST", `/donors/${ids.tobin}/relationships`, tok, { relatedDonorId: ids.fund, relationshipType: "owner" });
  if (lk.status !== 201) throw new Error(`fixture link: ${lk.status} ${JSON.stringify(lk.body).slice(0, 160)}`);
  await closeSteps(ids.tobin); await closeSteps(ids.fund);

  // ── 44X: two Corin Vale records, each with an owner ──────────────────────
  await P("corinA", "Corin Vale"); await P("corinB", "Corin Vale");
  await q(`UPDATE donors SET assigned_to=$1, assigned_to_name=NULL WHERE id=$2`, [BRAM, ids.corinA]);
  await q(`UPDATE donors SET assigned_to=$1, assigned_to_name='Ines Varro' WHERE id=$2`, [ME, ids.corinB]);

  // ── 03X: first-time givers, one note-sized and one call-sized ────────────
  await P("nell", "Nell Ambry"); await gift(ids.nell, 100, civilPlusDays(-40)); await closeSteps(ids.nell);
  await P("ozzie", "Osric Dunmore"); await gift(ids.ozzie, 600, civilPlusDays(-45)); await closeSteps(ids.ozzie);

  return { org: ORG, email: EMAIL, password: PASSWORD, token: tok, ids, today, users: { me: ME, bram: BRAM } };
}

module.exports = { buildFlows6Org };
