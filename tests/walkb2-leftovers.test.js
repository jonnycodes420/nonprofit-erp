// tests/walkb2-leftovers.test.js · WALKB-2. WHAT MUSE'S WALK B (5 NOV) LEFT.
//
//   §1 a Staff invite shows under Invited (GET /org/invites) with its role, and
//      a second invite to the same address, or to a member, is refused in one
//      sentence; Revoke withdraws it and its link stops working.
//   §2 an event guest with $40,709 lifetime and no pipeline stage is a Donor,
//      never "Not a donor yet" (shared/numbers/donorLabel.js); someone who has
//      never given still is. The Edit Event dialog's form opens with the
//      event's own date and start time (client/src/lib/eventEditForm.js).
//   §3 the walk's $900 pledge in three $300 installments, two in this
//      calendar year and one in the next, for a calendar-year org: due in
//      "FY <year>" is $600, then $300 after a $300 payment, and 3 then 2
//      installments are unpaid. A July-year org says "FY yyyy–yy".
//   §4 a grant with a typed Received and no award record (the NEA case) says
//      "Received $35,000, award not recorded." with Record the award.
//   §5 an event with no gifts and no guests is deleted; one with a gift is
//      refused (409), archived instead, and its Raised and the giver's
//      lifetime are unchanged.
//
// What makes it fail: on main, GET /org/invites does not exist and the second
// invite goes through (§1); the guest label is not on the answer (§2); the
// edit form module does not exist (§2); no FY label or unpaid count on the
// pledge (§3); no grantAwardLine (§4); DELETE removes an event with a gift (§5).
// Planted: dueThisFiscalYear returning the balance turns §3 red ($900).
"use strict";
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");
const { civilDay, civilYear } = require("./clock");

const ORG = "org_walkb2cal", ORG_JULY = "org_walkb2july";
const PASSWORD = "loadtest1234";
const C = v => Math.round(Number(v || 0) * 100);

async function wipe(id) {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  await q("SET session_replication_role = replica").catch(() => {});
  for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [id]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [id]).catch(() => {});
  await q("SET session_replication_role = origin").catch(() => {});
}
async function freshOrg(id, fyStart) {
  await wipe(id);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,vocabulary_json)
           VALUES ($1,$2,$3,1,'active','team','America/New_York',$4)`,
    [id, `Walk B leftovers ${fyStart} (test)`, id.replace(/_/g, "-"), JSON.stringify({ fiscal_year_start_month: fyStart })]);
  const email = `${id}@test.local`;
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Tamsin Reed','admin')`, ["u_" + id, id, email, bcrypt.hashSync(PASSWORD, 4)]);
  return { tok: await login(email, PASSWORD), email };
}
async function person(orgId, name) {
  const id = "d_wb2_" + Math.random().toString(16).slice(2, 12);
  await q(`INSERT INTO donors (id,org_id,name,stage,created_by,created_by_name) VALUES ($1,$2,$3,NULL,'system:test','Test')`, [id, orgId, name]);
  return id;
}

async function invites(tok, adminEmail) {
  const addr = "wren.halloway@walkb2.test";
  const a = await api("POST", "/auth/invite", tok, { email: addr, role: "staff" });
  const list = await api("GET", "/org/invites", tok);
  const rows = (list.body && list.body.invites) || [];
  const mine = rows.find(r => r.email === addr);
  ok("§1 the Staff invite shows under Invited, with its role, date and link",
     a.status === 200 && list.status === 200 && !!mine && mine.role === "staff" && !!mine.createdAt && /\/invite\//.test(mine.link || ""),
     JSON.stringify({ a: a.status, list: list.status, rows }));
  const b = await api("POST", "/auth/invite", tok, { email: "Wren.Halloway@walkb2.test", role: "staff" });
  const n = await q(`SELECT COUNT(*)::int AS n FROM invites WHERE org_id=$1 AND lower(email)=$2`, [ORG, addr]);
  ok("§1 a second invite to the same address is refused in a sentence, and none is written",
     b.status === 409 && /already has an invite waiting/.test((b.body && b.body.message) || "") && n[0].n === 1, JSON.stringify({ b: b.status, body: b.body, n: n[0].n }));
  const m = await api("POST", "/auth/invite", tok, { email: adminEmail, role: "staff" });
  ok("§1 an invite to a member is refused: already on your team", m.status === 409 && /already on your team/.test((m.body && m.body.message) || ""), JSON.stringify(m.body));
  const token = String((a.body && a.body.inviteLink) || "").split("/invite/")[1];
  const r = mine ? await api("POST", `/org/invites/${mine.id}/resend`, tok, {}) : { status: 0 };
  ok("§1 Resend answers with a sentence and keeps the same link", r.status === 200 && r.body.link === mine.link && !!r.body.message, JSON.stringify(r.body));
  const v = mine ? await api("DELETE", `/org/invites/${mine.id}`, tok) : { status: 0 };
  const after = ((await api("GET", "/org/invites", tok)).body || {}).invites || [];
  const link = await api("GET", `/auth/invite/${token}`, null);
  ok("§1 Revoke withdraws it: gone from Invited, and its link answers 410", v.status === 200 && !after.some(x => x.email === addr) && link.status === 410,
     JSON.stringify({ v: v.status, after: after.length, link: link.status }));
  const again = await api("POST", "/auth/invite", tok, { email: addr, role: "staff" });
  ok("§1 after Revoke the address can be invited again", again.status === 200, JSON.stringify(again.body));
}

async function labels(tok) {
  const giver = await person(ORG, "Odessa Brightwater (test)");
  const never = await person(ORG, "Linus Fairweather (test)");
  const g = await api("POST", `/donors/${giver}/gifts`, tok, { amount: "40709.00", date: civilDay(), type: "cash", payment_method: "check" });
  const day = `${civilYear()}-12-30`;
  const ev = await api("POST", "/events", tok, { name: "Lantern Supper (test)", eventType: "gala", date: day });
  const evId = ev.body && (ev.body.id || (ev.body.event && ev.body.event.id));
  await api("POST", `/events/${evId}/attendees`, tok, { donorIds: [giver, never] });
  await api("PUT", `/events/${evId}`, tok, { startTime: "18:30" });
  const e = (await api("GET", `/events/${evId}`, tok)).body || {};
  const att = id => (e.attendees || []).find(a => a.donor_id === id) || {};
  const lab = a => (a.donor_label && a.donor_label.label) || null;
  ok("§2 a guest with $40,709 lifetime and no stage is a Donor, not \"Not a donor yet\"",
     g.status < 300 && lab(att(giver)) === "Donor", JSON.stringify({ g: g.status, label: att(giver).donor_label, stage: att(giver).stage }));
  ok("§2 a guest who has never given is \"Not a donor yet\"", lab(att(never)) === "Not a donor yet", JSON.stringify(att(never).donor_label));
  let EF = null;
  try { EF = await import("../client/src/lib/eventEditForm.js"); } catch { /* main: no module */ }
  const form = EF ? EF.eventEditForm(e) : {};
  ok("§2 the Edit Event dialog opens with the event's own date and start time",
     !!EF && form.date === day && form.startTime === "18:30" && form.name === "Lantern Supper (test)", JSON.stringify({ raw: e.date, form }));
}

async function pledges(tok) {
  const Y = civilYear();
  const who = await person(ORG, "Marisol Okafor (test)");
  const p = await api("POST", `/donors/${who}/pledges`, tok, { amount: "900.00", dueDate: `${Y}-12-30`,
    installments: [{ dueDate: `${Y}-12-30`, amount: "300.00" }, { dueDate: `${Y}-12-31`, amount: "300.00" }, { dueDate: `${Y + 1}-01-15`, amount: "300.00" }] });
  const read = async () => (((await api("GET", `/donors/${who}/pledges`, tok)).body) || [])[0] || {};
  const before = await read();
  ok(`§3 $900 in three installments, $600 in FY ${Y}: due in FY ${Y} is $600, not the balance`,
     p.status < 300 && C(before.dueThisYear) === 60000 && before.dueYearLabel === `FY ${Y}`, JSON.stringify({ p: p.status, due: before.dueThisYear, label: before.dueYearLabel, bal: before.balance }));
  ok("§3 three installments are unpaid", before.unpaidCount === 3, JSON.stringify(before.unpaidCount));
  const pay = await api("POST", `/donors/${who}/gifts`, tok, { amount: "300.00", date: civilDay(), type: "cash", payment_method: "check", pledgeId: before.id });
  const after = await read();
  ok(`§3 after a $300 payment, $300 is due in FY ${Y} (the balance is $600)`,
     pay.status < 300 && C(after.dueThisYear) === 30000 && C(after.balance) === 60000, JSON.stringify({ pay: pay.status, due: after.dueThisYear, bal: after.balance }));
  ok("§3 and two installments are unpaid (the open pledge says \"2 installments left\")", after.unpaidCount === 2, JSON.stringify(after.unpaidCount));
  const PW = await import("../shared/pledgeWords.js");
  ok("§3 the profile's words name the year", PW.pledgeMoneyWords({ dueThisYearCents: 30000, openCents: 60000, years: 2, yearLabel: `FY ${Y}` }) === `$300 due in FY ${Y} · $600 over 2 years`,
     PW.pledgeMoneyWords({ dueThisYearCents: 30000, openCents: 60000, years: 2, yearLabel: `FY ${Y}` }));

  const { tok: jt } = await freshOrg(ORG_JULY, 7);
  const jw = "d_wb2_" + Math.random().toString(16).slice(2, 12);
  await q(`INSERT INTO donors (id,org_id,name,created_by,created_by_name) VALUES ($1,$2,'Ines Calloway (test)','system:test','Test')`, [jw, ORG_JULY]);
  await api("POST", `/donors/${jw}/pledges`, jt, { amount: "900.00", dueDate: `${Y}-12-30` });
  const j = (((await api("GET", `/donors/${jw}/pledges`, jt)).body) || [])[0] || {};
  ok("§3 a July-year org names its year as a range (FY yyyy–yy)", /^FY \d{4}–\d{2}$/.test(j.dueYearLabel || ""), JSON.stringify(j.dueYearLabel));
}

async function grant(tok) {
  const cg = await api("POST", "/grants", tok, { funder: "National Endowment for Lanterns (test)", program: "Reading Lights (test)", amount: 35000, status: "applied" });
  const gid = cg.body && (cg.body.id || (cg.body.grant && cg.body.grant.id));
  // the legacy typed Received, as a grant from before GIFTS-1 holds it
  await q(`UPDATE grants SET received=35000, status='awarded' WHERE id=$1 AND org_id=$2`, [gid, ORG]);
  const g = ((await api("GET", "/grants", tok)).body || []).find(x => x.id === gid) || {};
  ok("§4 the cause: no award record, so Received is the typed column ($35,000)", !g.award_pledge_id && C(g.received) === 3500000, JSON.stringify({ pl: g.award_pledge_id, rec: g.received }));
  let GL = null;
  try { GL = await import("../shared/grantAwardLine.js"); } catch { /* main */ }
  const line = GL ? GL.grantAwardLine({ status: g.status, awardPledgeId: g.award_pledge_id, received: g.received }) : null;
  ok("§4 the status line says what is true: \"Received $35,000, award not recorded.\" · Record the award",
     !!line && line.text === "Received $35,000, award not recorded." && line.action === "Record the award", JSON.stringify(line));
  ok("§4 an award on file has no line; awarded with nothing in says no award recorded",
     !!GL && GL.grantAwardLine({ status: "awarded", awardPledgeId: "pl_x", received: 35000 }) === null
       && GL.grantAwardLine({ status: "awarded", awardPledgeId: null, received: 0 }).text === "Awarded, but no award recorded.");
}

async function events(tok) {
  const day = `${civilYear()}-12-29`;
  const mk = async name => { const r = await api("POST", "/events", tok, { name, eventType: "gala", date: day }); return r.body && (r.body.id || (r.body.event && r.body.event.id)); };
  const empty = await mk("Quiet Evening (test)");
  const rm = await api("GET", `/events/${empty}/removal`, tok);
  const d = await api("DELETE", `/events/${empty}`, tok);
  const gone = await api("GET", `/events/${empty}`, tok);
  ok("§5 an event with no gifts and no guests can be deleted", rm.body && rm.body.canDelete === true && d.status === 200 && gone.status === 404,
     JSON.stringify({ rm: rm.body, d: d.status, gone: gone.status }));

  const full = await mk("Harvest Table (test)");
  const giver = await person(ORG, "Corin Ashdown (test)");
  const g = await api("POST", `/donors/${giver}/gifts`, tok, { amount: "1250.00", date: civilDay(), type: "cash", payment_method: "check", eventId: full });
  const raised = async () => C((((await api("GET", `/events/${full}`, tok)).body || {}).money || {}).received);
  const life = async () => C(((await q(`SELECT total_giving FROM donors WHERE id=$1`, [giver]))[0] || {}).total_giving);
  const r0 = await raised(), l0 = await life();
  const d2 = await api("DELETE", `/events/${full}`, tok);
  const still = await api("GET", `/events/${full}`, tok);
  ok("§5 an event with a gift is not deleted: 409, with a sentence saying archive", g.status < 300 && d2.status === 409 && still.status === 200 && /Archive it instead/.test((d2.body && d2.body.message) || ""),
     JSON.stringify({ g: g.status, d2: d2.status, body: d2.body, still: still.status }));
  const ar = await api("POST", `/events/${full}/archive`, tok, {});
  const e = (await api("GET", `/events/${full}`, tok)).body || {};
  const gifts = await q(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1 AND event_id=$2`, [ORG, full]);
  ok("§5 it is archived, and its gift stays counted (Raised and lifetime unchanged)",
     ar.status === 200 && !!e.archived_at && r0 === 125000 && (await raised()) === r0 && (await life()) === l0 && l0 >= 125000 && gifts[0].n === 1,
     JSON.stringify({ ar: ar.status, archived: e.archived_at, r0, l0, gifts: gifts[0].n }));
}

(async () => {
  try {
    const { tok, email } = await freshOrg(ORG, 1);
    await invites(tok, email);
    await labels(tok);
    await pledges(tok);
    await grant(tok);
    await events(tok);
  } catch (e) { ok("suite ran to the end", false, e && e.stack); }
  finally {
    await wipe(ORG).catch(() => {}); await wipe(ORG_JULY).catch(() => {});
    await closeDb();
    summary();
  }
})();
