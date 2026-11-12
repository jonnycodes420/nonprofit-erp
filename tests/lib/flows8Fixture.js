// tests/lib/flows8Fixture.js · FLOWS-8. AN ORG SHAPED LIKE THE FIRST STAGING NIGHT'S FINDINGS.
//
// Made-up people only. One org with no Stripe connected and:
//   · Wren Halloway, Odo Pellam and Ines Quarry, who gave 380+ days ago and not
//     since: LYBUNT, and the top donors by lifetime (W-34X, W-11X)
//   · Zoë Ångström, a contact who has never given (W-20, W-17)
//   · an event today with Wren on its guest list, Confirmed (W-21, W-01X)
//   · a sequence whose one email step has no words (W-Fundraising-21)
//   · a giving page, published (W-35)
// Returns { org, email, password, token, ids, eventId, attId, pageId, seqId }.
"use strict";
const bcrypt = require("bcryptjs");
const { login, api, q, civilPlusDays } = require("../helpers");

const PASSWORD = "loadtest1234";

async function buildFlows8Org(run = require("crypto").randomBytes(4).toString("hex")) {
  const ORG = `org_flows8_${run}`;
  const EMAIL = `owner-${run}@flows8.local`;
  const ME = `u_flows8_${run}`;
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,emails_enabled,onboarded_at,mission)
           VALUES ($1,'Flows Eight Tidewater Youth',$1,1,'active','team','America/New_York',true,NOW(),'Mentoring for kids and youth after school')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Perrin Lisle','admin')`,
    [ME, ORG, EMAIL, bcrypt.hashSync(PASSWORD, 4)]);
  const tok = await login(EMAIL, PASSWORD);
  const ids = {};
  const P = async (key, name, extra = {}) => {
    const r = await api("POST", "/donors", tok, { name, email: `${key}-${run}@flows8.invalid`, ...extra });
    if (!r.body || !r.body.id) throw new Error(`fixture ${name}: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
    return (ids[key] = r.body.id);
  };
  const gift = async (id, amount, date) => {
    const r = await api("POST", `/donors/${id}/gifts`, tok, { amount, date, payment_method: "check" });
    if (!(r.status === 200 || r.status === 201)) throw new Error(`fixture gift ${amount}: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  };
  // LYBUNT and the top donors: last gift 380+ days ago, so in last year and never this one.
  for (const [key, name, amt, d] of [["wren", "Wren Halloway", 2400, -380], ["odo", "Odo Pellam", 1500, -390], ["ines", "Ines Quarry", 600, -400]]) {
    await P(key, name); await gift(ids[key], amt, civilPlusDays(d));
  }
  // A contact who has never given.
  await P("zoe", "Zoë Ångström");

  // An event today, Wren Confirmed on its list.
  const ev = await api("POST", "/events", tok, { name: "Lantern walk", date: civilPlusDays(0), eventType: "other" });
  const eventId = ev.body && (ev.body.id || (ev.body.event && ev.body.event.id));
  if (!eventId) throw new Error(`fixture event: ${ev.status} ${JSON.stringify(ev.body).slice(0, 160)}`);
  const add = await api("POST", `/events/${eventId}/attendees`, tok, { donorIds: [ids.wren] });
  const attId = add.body && add.body.ids && add.body.ids[0];
  if (!attId) throw new Error(`fixture guest: ${add.status} ${JSON.stringify(add.body).slice(0, 160)}`);
  await api("PATCH", `/events/${eventId}/attendees/${attId}`, tok, { status: "confirmed" });

  // A sequence whose one email step has no words, paused.
  const seqId = `seq_flows8_${run}`;
  await q(`INSERT INTO sequences (id, org_id, name, trigger, status, created_by, created_by_name) VALUES ($1,$2,'Welcome series','new_donor','paused','system:test','test')`, [seqId, ORG]);
  await q(`INSERT INTO sequence_steps (id, sequence_id, step_order, delay_days, subject, body) VALUES ($1,$2,0,0,'Welcome','')`, [`ss_flows8_${run}`, seqId]);

  // A giving page, live in Steward's eyes, with no Stripe behind it.
  const gp = await api("POST", "/giving-pages", tok, { title: "Winter lights", slug: `winter-lights-${run}` });
  const pageId = gp.body && gp.body.id;
  if (!pageId) throw new Error(`fixture page: ${gp.status} ${JSON.stringify(gp.body).slice(0, 160)}`);

  return { org: ORG, email: EMAIL, password: PASSWORD, token: tok, ids, eventId, attId, pageId, pageSlug: `winter-lights-${run}`, seqId };
}

module.exports = { buildFlows8Org };
