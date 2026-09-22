// BUILD-94 Part 2 — PEOPLE WHO ARE NOT DONORS.
//
// The brief's one test, and it is a before/after: a fixture of 40 Mailchimp
// rows lands on an org that already has donors, and the MONEY must not move.
//   12 rows match existing donors by email → merge, add nothing
//    5 rows are unsubscribed                → unreachable, never reachable
//    6 rows are tagged Volunteer            → typed Volunteer
//   → 28 new people, zero duplicates, Drift and giving totals unchanged IN CENTS.
//
// Plus the rule that is the point of the part: a person who is not a Donor is
// out of every number that means money — and a volunteer who gives becomes a
// Donor too, on the SAME record.
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "org_b94p";
const YEAR = new Date().getFullYear();

// 12 existing donors whose emails the Mailchimp file will also carry.
const EXISTING = Array.from({ length: 12 }, (_, i) => ({
  id: `d_b94p_${String(i).padStart(2, "0")}`,
  name: `Existing Giver ${i}`,
  email: `existing${i}@b94p.test`,
  total: 100 + i * 37,           // deliberately uneven — a cents comparison, not a round one
}));

async function fixture() {
  for (const t of ["email_suppressions", "campaign_recipients", "campaigns", "sequence_enrollments",
                   "threads", "tasks", "fin_transactions", "donor_designations", "pledges",
                   "recurring_subscriptions", "interactions", "gifts", "donors", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  // The org row is re-used rather than dropped: a scratch DB accumulates
  // references a suite has no business knowing about, and a failed DELETE that
  // is swallowed turns into a duplicate-key on the next run.
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone)
           VALUES ($1,'Justin Place','b94p',1,'active','team','America/Chicago')
           ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, timezone=EXCLUDED.timezone,
             subscription_status=EXCLUDED.subscription_status, plan=EXCLUDED.plan`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_b94p',$1,'b94p@test.local',$2,'Allie Barnett','admin')`,
    [ORG, bcrypt.hashSync("loadtest1234", 10)]);
  for (const [i, d] of EXISTING.entries()) {
    await q(`INSERT INTO donors (id,org_id,name,email,total_giving,gift_count,status,stage,last_gift_date)
             VALUES ($1,$2,$3,$4,$5,2,'mid','steward',$6)`,
      [d.id, ORG, d.name, d.email, d.total, `${YEAR - 1}-0${(i % 9) + 1}-15`]);
    // Two real gifts each, so Drift has a cadence to reason about.
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type) VALUES ($1,$2,$3,$4,$5,'cash')`,
      [`g_${d.id}_a`, ORG, d.id, d.total / 2, `${YEAR - 2}-0${(i % 9) + 1}-15`]);
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type) VALUES ($1,$2,$3,$4,$5,'cash')`,
      [`g_${d.id}_b`, ORG, d.id, d.total / 2, `${YEAR - 1}-0${(i % 9) + 1}-15`]);
  }
}

// The 40-row Mailchimp audience, in the shape the mapper hands the import.
function mailchimpRows() {
  const rows = [];
  // 12 that match an existing donor by email — they must MERGE and add nothing.
  for (const d of EXISTING) rows.push({ name: d.name, email: d.email, personTypes: ["other"] });
  // 6 tagged Volunteer.
  for (let i = 0; i < 6; i++) rows.push({ name: `Vera Volunteer ${i}`, email: `vol${i}@b94p.test`, personTypes: ["volunteer"] });
  // 5 unsubscribed.
  for (let i = 0; i < 5; i++) rows.push({ name: `Una Unsub ${i}`, email: `unsub${i}@b94p.test`, personTypes: ["other"], unsubscribed: true });
  // 17 ordinary new contacts with no tag — Other, because calling a Mailchimp
  // contact a donor is how a giving total goes wrong.
  for (let i = 0; i < 17; i++) rows.push({ name: `Con Tact ${i}`, email: `contact${i}@b94p.test`, personTypes: ["other"] });
  return rows;
}

const cents = (n) => Math.round(Number(n || 0) * 100);

(async () => {
  await fixture();
  const tok = await login("b94p@test.local", "loadtest1234");

  // ── the BEFORE picture, in cents ────────────────────────────────────────
  const before = {
    giving: cents((await q(`SELECT COALESCE(SUM(total_giving),0) AS t FROM donors WHERE org_id=$1`, [ORG]))[0].t),
    gifts:  cents((await q(`SELECT COALESCE(SUM(amount),0) AS t FROM gifts WHERE org_id=$1`, [ORG]))[0].t),
    drift:  (await api("GET", "/drift", tok)).body,
    people: (await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1`, [ORG]))[0].n,
  };
  const driftCountOf = (b) => Array.isArray(b) ? b.length : (b && Array.isArray(b.list) ? b.list.length : (b && b.count) || 0);

  // ── the import ──────────────────────────────────────────────────────────
  console.log("— 40 Mailchimp rows onto an org that already has donors —");
  const imp = await api("POST", "/donors/import", tok, { donors: mailchimpRows() });
  ok("the import succeeded", imp.status === 200, imp.body);
  ok("28 new people, not 40", imp.body.created === 28, { created: imp.body.created, duplicates: imp.body.duplicates });
  ok("the 12 matching rows merged instead of forking a second record",
    imp.body.duplicates === 12, imp.body.duplicates);
  ok("5 unsubscribed contacts were suppressed", imp.body.unsubscribedImported === 5, imp.body.unsubscribedImported);

  const all = await q(`SELECT id,name,email,person_types,do_not_email,total_giving FROM donors WHERE org_id=$1`, [ORG]);
  ok("the org holds 40 people now, not 52", all.length === before.people + 28, all.length);
  const byEmail = Object.fromEntries(all.map(r => [r.email, r]));
  ok("zero duplicate emails", new Set(all.map(r => (r.email || "").toLowerCase())).size === all.length);

  const types = (e) => (byEmail[e] && byEmail[e].person_types) || null;
  ok("6 people are typed Volunteer",
    all.filter(r => (r.person_types || []).includes("volunteer")).length === 6,
    all.filter(r => (r.person_types || []).includes("volunteer")).length);
  ok("an existing donor is untouched by a Mailchimp row claiming Other",
    JSON.stringify(types("existing0@b94p.test")) === JSON.stringify(["donor"]), types("existing0@b94p.test"));
  ok("a new contact with no tag is Other, never Donor",
    JSON.stringify(types("contact0@b94p.test")) === JSON.stringify(["other"]), types("contact0@b94p.test"));

  // ── unsubscribed means unsubscribed, in the place the SEND path reads ───
  console.log("— unreachable, and unreachable where it counts —");
  ok("the row says so", byEmail["unsub0@b94p.test"].do_not_email === true);
  const sup = await q(`SELECT email FROM email_suppressions WHERE org_id=$1 AND reason='unsubscribed'`, [ORG]);
  ok("and the suppression list the send path consults says so too", sup.length === 5, sup.length);

  // ── the money did not move ──────────────────────────────────────────────
  console.log("— and the money did not move —");
  const after = {
    giving: cents((await q(`SELECT COALESCE(SUM(total_giving),0) AS t FROM donors WHERE org_id=$1`, [ORG]))[0].t),
    gifts:  cents((await q(`SELECT COALESCE(SUM(amount),0) AS t FROM gifts WHERE org_id=$1`, [ORG]))[0].t),
    drift:  (await api("GET", "/drift", tok)).body,
  };
  ok("giving totals unchanged, in cents", after.giving === before.giving, [before.giving, after.giving]);
  ok("gift total unchanged, in cents", after.gifts === before.gifts, [before.gifts, after.gifts]);
  ok("Drift is unchanged — 28 new people are not 28 new drifting donors",
    driftCountOf(after.drift) === driftCountOf(before.drift),
    [driftCountOf(before.drift), driftCountOf(after.drift)]);

  const dash = await api("GET", "/dashboard", tok);
  const donorCount = dash.body?.donorCount ?? dash.body?.donors ?? null;
  if (donorCount !== null) {
    ok("a count that reads \"donors\" counts donors, not people", donorCount === 12, donorCount);
  } else { ok("dashboard answered", dash.status === 200, dash.status); }

  // ── the segments that let Mailchimp go ──────────────────────────────────
  console.log("— the four segments —");
  const seg = async (mode) => (await api("POST", "/campaigns/segment-preview", tok, { segment: { mode } })).body.count;
  ok("Everyone with an email = every person", await seg("everyone") === 40, await seg("everyone"));
  ok("Volunteers = 6", await seg("volunteers") === 6, await seg("volunteers"));
  ok("Donors = 12, not 40", await seg("donors") === 12, await seg("donors"));
  ok("and \"All Donors\" still means donors", await seg("all") === 12, await seg("all"));
  ok("Staff and board = 0 here, and an empty segment is zero people", await seg("staff_board") === 0);

  // ── a volunteer who gives becomes a donor, on the SAME record ───────────
  console.log("— a volunteer who gives —");
  const volId = all.find(r => (r.person_types || []).includes("volunteer")).id;
  const gift = await api("POST", `/donors/${volId}/gifts`, tok, { amount: 250, date: `${YEAR}-01-15`, type: "cash" });
  ok("the gift was recorded", gift.status === 200 || gift.status === 201, gift.body);
  const [vol] = await q(`SELECT person_types FROM donors WHERE id=$1`, [volId]);
  ok("they are now BOTH volunteer and donor", vol.person_types.includes("volunteer") && vol.person_types.includes("donor"), vol.person_types);
  ok("and there is still exactly one of them",
    (await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND id=$2`, [ORG, volId]))[0].n === 1);
  ok("the Donors segment picked them up", await seg("donors") === 13, await seg("donors"));

  // ── and "other" is replaced by a gift, never accumulated ────────────────
  const otherId = all.find(r => r.email === "contact0@b94p.test").id;
  await api("POST", `/donors/${otherId}/gifts`, tok, { amount: 40, date: `${YEAR}-02-02`, type: "cash" });
  const [oth] = await q(`SELECT person_types FROM donors WHERE id=$1`, [otherId]);
  ok("a gift answers \"we don't know what they are\" — other is replaced, not kept",
    JSON.stringify(oth.person_types) === JSON.stringify(["donor"]), oth.person_types);

  // ── the Mailchimp preset, as a unit ─────────────────────────────────────
  console.log("— the preset that reads her file —");
  const MC = await import("../shared/mailchimpPreset.js");
  const headers = ["Email Address","First Name","Last Name","Address","Phone","Tags",
                   "MEMBER_RATING","OPTIN_TIME","CONFIRM_TIME","LEID","GMTOFF"];
  ok("a Mailchimp audience is recognised", MC.detectMailchimpAudience(headers).isMailchimp);
  ok("an ordinary donor CSV is NOT", !MC.detectMailchimpAudience(["Name","Email","Total Giving"]).isMailchimp);
  const map = MC.mailchimpMapping(headers).mapping;
  ok("the named columns map", map["Email Address"] === "email" && map["First Name"] === "_firstName"
    && map["Last Name"] === "_lastName" && map["Address"] === "address" && map["Phone"] === "phone", map);
  ok("Tags becomes ONE custom field named Tags", map["Tags"] === "cf:tags"
    && MC.MAILCHIMP_CUSTOM_FIELDS.find(f => f.key === "tags").type === "multi_select");
  ok("MEMBER_RATING / OPTIN_TIME / CONFIRM_TIME are kept, not thrown away",
    map["MEMBER_RATING"] === "cf:member_rating" && map["OPTIN_TIME"] === "cf:optin_time"
    && map["CONFIRM_TIME"] === "cf:confirm_time");
  ok("Mailchimp plumbing is ignored", map["LEID"] === "ignore" && map["GMTOFF"] === "ignore");

  ok("a whole tag \"Volunteer\" types a volunteer", MC.typeSuggestionForTags("Volunteer, Gala 2025") === "volunteer");
  ok("a whole tag \"Board\" types staff and board", MC.typeSuggestionForTags("Board") === "staff_board");
  // The one that matters: a substring match here would make every guest at a
  // games night a trustee.
  ok("\"Board Game Night 2024\" is NOT a board member", MC.typeSuggestionForTags("Board Game Night 2024") === null);
  ok("no tags suggests nothing", MC.typeSuggestionForTags("") === null);

  ok("the unsubscribed FILE marks every row it carries",
    MC.rowIsUnsubscribed({}, { fileStatus: "unsubscribed" }) === true);
  ok("a status column marks its own row",
    MC.rowIsUnsubscribed({ Status: "unsubscribed" }) === true
    && MC.rowIsUnsubscribed({ Status: "cleaned" }) === true);
  ok("a subscribed row in a subscribed file is reachable",
    MC.rowIsUnsubscribed({ Status: "subscribed" }, { fileStatus: "subscribed" }) === false);
  ok("Mailchimp's own file name preselects the answer",
    MC.fileStatusFromName("creo unsubscribed members_Sep 22 2026.csv") === "unsubscribed");

  // ── the type model, as a unit ───────────────────────────────────────────
  const PT = await import("../shared/personType.js");
  ok("an unknown type is dropped, never stored",
    JSON.stringify(PT.normalizeTypes(["donor", "wizard"])) === JSON.stringify(["donor"]));
  ok("an empty list floors at Other, never Donor",
    JSON.stringify(PT.normalizeTypes([])) === JSON.stringify(["other"]));
  ok("a legacy NULL row is a donor", PT.isDonor({ person_types: null }));
  ok("the predicate is NULL-tolerant", /IS NULL OR/.test(PT.donorOnlySql("d")));

  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
