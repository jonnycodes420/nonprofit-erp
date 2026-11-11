// tests/lib/flows5Fixture.js · FLOWS-5. AN ORG SHAPED LIKE THE FLEET'S FINDINGS.
//
// Made-up people only. One org with:
//   · Wren and Tam, volunteers; a 3-hour shift on day D (10 days back) and one
//     on D+1, so a range that ends on D counts only the first (W-1109-Volunteers-26)
//   · a meeting booked 3 days out, with Mae (W-1110-Volunteers-06X)
//   · a draft shift 5 days out whose only sign-up was taken off, and a
//     published one (W-1110-Volunteers-08X)
//   · three events this year: one past, one archived, one to come (W-1110-Volunteers-04X)
//   · donors who gave last fiscal year and not this one, and one last seen 3
//     years ago (W-1110-Fundraising-14: LYBUNT, SYBUNT, Lost)
//   · Pip, a $1 gift with two open thank-you tasks written for it, the shape
//     rows from before thankYouOnce.js carry (W-1107-Volunteers-14X)
//   · eight recent givers, so Home has moves to snooze (Area 1)
// Returns { org, email, password, token, ids, today, D }.
"use strict";
const bcrypt = require("bcryptjs");
const { login, api, q, civilPlusDays } = require("../helpers");

const PASSWORD = "loadtest1234";

async function buildFlows5Org(run = require("crypto").randomBytes(4).toString("hex")) {
  const ORG = `org_flows5_${run}`;
  const EMAIL = `owner-${run}@flows5.local`;
  const ME = `u_flows5_${run}`;
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,emails_enabled,onboarded_at)
           VALUES ($1,'Flows Five Heron Commons',$1,1,'active','team','America/New_York',true,NOW())`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Ines Varro','admin')`,
    [ME, ORG, EMAIL, bcrypt.hashSync(PASSWORD, 4)]);
  const tok = await login(EMAIL, PASSWORD);
  const today = civilPlusDays(0);
  const ids = {};
  const P = async (key, name, types = ["donor"]) => {
    const r = await api("POST", "/donors", tok, { name, email: `${key}-${run}@flows5.invalid`, personTypes: types });
    if (!r.body || !r.body.id) throw new Error(`fixture ${name}: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
    return (ids[key] = r.body.id);
  };
  const gift = (id, amount, date) => api("POST", `/donors/${id}/gifts`, tok, { amount, date, payment_method: "check" });

  // ── hours: a shift on D and one on D+1 ───────────────────────────────────
  const D = civilPlusDays(-10), D1 = civilPlusDays(-9);
  await P("wren", "Wren Halvorsen", ["volunteer"]); await P("tam", "Tamsin Okafor", ["volunteer"]);
  const opp = await api("POST", "/volunteer-hub/opportunities", tok, { name: "Pantry sorting", program: "Food pantry", location: "Heron Hall" });
  ids.opp = opp.body.id;
  for (const [day, who] of [[D, "wren"], [D1, "tam"]]) {
    const s = await api("POST", "/volunteer-hub/slots", tok, { opportunityId: ids.opp, date: day, startTime: "09:00", endTime: "12:00", name: `Sort ${day}` });
    await api("POST", `/donors/${ids[who]}/volunteer-hours`, tok, { date: day, hours: 3, role: "Pantry sorting", slotId: s.body.id });
  }

  // ── a meeting 3 days out ─────────────────────────────────────────────────
  await P("mae", "Mae Ostrander");
  const t3 = civilPlusDays(3);
  const bv = await api("POST", `/donors/${ids.mae}/book-visit`, tok, { startsAt: `${t3}T15:00:00.000Z`, endsAt: `${t3}T16:00:00.000Z`, title: "Coffee with Mae" });
  ids.meeting = bv.body && bv.body.id;

  // ── a draft shift whose only sign-up was taken off, and a published one ──
  const d5 = civilPlusDays(5);
  const draft = await api("POST", "/volunteer-hub/slots", tok, { opportunityId: ids.opp, date: d5, startTime: "13:00", endTime: "15:00", name: "Draft afternoon", published: false });
  ids.draft = draft.body.id;
  const su = await api("POST", "/volunteer-hub/signups", tok, { slotId: ids.draft, personId: ids.wren });
  if (su.body && su.body.signupId) await api("POST", `/volunteer-hub/signups/${su.body.signupId}/cancel`, tok, {});
  const pub = await api("POST", "/volunteer-hub/slots", tok, { opportunityId: ids.opp, date: d5, startTime: "09:00", endTime: "12:00", name: "Morning sort" });
  ids.published = pub.body.id;
  ids.d5 = d5;

  // ── events this year ─────────────────────────────────────────────────────
  const past = await api("POST", "/events", tok, { name: "Spring Supper", date: civilPlusDays(-20), eventType: "community", description: "Supper." });
  const arch = await api("POST", "/events", tok, { name: "Lantern Walk", date: civilPlusDays(-15), eventType: "community", description: "Walk." });
  await api("POST", `/events/${arch.body.id}/archive`, tok, {});
  const soon = await api("POST", "/events", tok, { name: "Harvest Gala", date: civilPlusDays(12), eventType: "gala", description: "Gala." });
  ids.events = { past: past.body.id, archived: arch.body.id, soon: soon.body.id };

  // ── list reports: gave last FY, not this one; one last seen 3 years ago ─
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const fyStart = `${m >= 7 ? y : y - 1}-07-01`;
  const lastFy = `${Number(fyStart.slice(0, 4)) - 1}-11-03`;
  for (const [k, n] of [["ada", "Ada Kimura"], ["ben", "Ben Oyelaran"], ["cal", "Cal Reyes-Moss"]]) { await P(k, n); await gift(ids[k], 150, lastFy); }
  await P("dot", "Dot Lindqvist"); await gift(ids.dot, 400, civilPlusDays(-1100));

  // ── Pip: a $1 gift with two open thank-you tasks for it ──────────────────
  await P("pip", "Pip Calloway");
  const pg = await gift(ids.pip, 1, today);
  ids.pipGift = pg.body && (pg.body.id || (pg.body.gift && pg.body.gift.id));
  const due = civilPlusDays(1);
  // one keyed by thanks_gift_id (the one-per-gift index allows one), one by
  // source_gift_id (the older writer's column): two open tasks for one gift
  await q(`INSERT INTO tasks (id,org_id,title,priority,done,due,donor_id,type,thanks_gift_id,created_at,created_by,created_by_name)
    VALUES ($1,$2,'Send personal thank-you to Pip Calloway for $1 online gift','high',0,$3,$4,'donor',$5,NOW(),'system:test/flows5','FLOWS-5 test') ON CONFLICT DO NOTHING`,
    [`t_f5_pip1_${run}`, ORG, due, ids.pip, ids.pipGift]);
  await q(`INSERT INTO tasks (id,org_id,title,priority,done,due,donor_id,type,source_gift_id,created_at,created_by,created_by_name)
    VALUES ($1,$2,'Send personal thank-you to Pip Calloway for $1 online gift','high',0,$3,$4,'donor',$5,NOW() + interval '2 seconds','system:test/flows5','FLOWS-5 test')`,
    [`t_f5_pip2_${run}`, ORG, due, ids.pip, ids.pipGift]);

  // ── recent givers, for Home's moves ──────────────────────────────────────
  for (let i = 0; i < 8; i++) { const id = await P(`g${i}`, `${["Iris", "Juno", "Kofi", "Lena", "Milo", "Nell", "Otto", "Pia"][i]} Ashgrove`); await gift(id, 250 + i * 50, civilPlusDays(-(5 + i))); await gift(id, 200, civilPlusDays(-(400 + i))); }

  return { org: ORG, email: EMAIL, password: PASSWORD, token: tok, ids, today, D, D1, fyStart, run };
}

module.exports = { buildFlows5Org };
