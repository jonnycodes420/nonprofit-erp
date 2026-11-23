// tests/define1-populations.test.js · DEFINE-1 (Jarvis, 22 Nov). The build's one new suite: it guards
// donor email (who an audience mails, and how often) and money (who is counted a donor).
//
// §1 The registry. Every population has a name, a unit, one sentence and the builder it points at;
//    Atlas's LYBUNT, SYBUNT and Lapsed are the registry's names and sentences ("Lapsed 12+ months").
// §2 A Donor is someone who has given ("a never-given +Add person counts as a Donor"). A person added
//    as a Donor with no gift is on Contacts, not Donors; the Directory's Donors count and All donors
//    are the same people.
// §3 Audiences are registry populations ("'All donors' also claims 66 members never gave; two
//    audiences are both named 'Volunteers'"). All donors is `donors`, its words the registry's; the
//    Volunteers screen's own group is not offered as a second Volunteers audience; two records with
//    one address are reached once.
// §4 assertSurfacesAgree's define1 pass holds on this org (each population two surfaces count agrees).
//
// PROVEN ABLE TO FAIL (each planted, each red, then put back):
//   · shared/numbers/isDonor.js IS_DONOR back on "marked Donor OR gave" → §2 Dana on Donors red, §4 red.
//   · the A.isVolunteersKeptGroup filter taken out of server/outreach/routes.js → §3 one Volunteers red, §4 red.
//   · audienceReasons without the same-address keeper → §3 reached once red.
"use strict";
const { ok, summary, api, q, closeDb, civilToday } = require("./helpers");

const BASE = process.env.BASE || "http://localhost:5601";
const PASSWORD = "loadtest1234";

(async () => {
  console.log("define1-populations (DEFINE-1)");
  const run = require("crypto").randomBytes(4).toString("hex");
  const reg = await fetch(BASE + "/auth/register-org", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgName: `Define One Larchmoor Fund ${run}`, userName: "Perpetua Glanville", email: `owner-${run}@define1.local`, password: PASSWORD, provisioned: true, demoData: false }) });
  const rb = await reg.json();
  if (reg.status !== 201 || !rb.token) throw new Error(`register-org: ${reg.status} ${JSON.stringify(rb).slice(0, 200)}`);
  const tok = rb.token, ORG = rb.org.id, today = civilToday();
  await q(`UPDATE orgs SET onboarding_complete=1, onboarded_at=NOW() WHERE id=$1`, [ORG]);
  await q(`UPDATE users SET welcomed_at=NOW() WHERE org_id=$1`, [ORG]);
  const person = async (name, email) => {
    const r = await api("POST", "/donors", tok, { name, email: email || `${name.split(" ")[0].toLowerCase()}-${run}@define1.invalid` });
    if (!r.body || !r.body.id) throw new Error(`fixture ${name}: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
    return r.body.id;
  };
  const give = async (id, amount) => {
    const g = await api("POST", `/donors/${id}/gifts`, tok, { amount, date: today, type: "cash", paymentMethod: "Check" });
    if (g.status >= 300) throw new Error(`gift: ${g.status} ${JSON.stringify(g.body).slice(0, 160)}`);
  };

  // ── §1 the registry ──────────────────────────────────────────────────────
  const P = require("../shared/numbers/populations");
  const must = ["lapsed", "lapsing", "lost", "lybunt", "sybunt", "reengage", "donors", "everyone", "volunteers", "gave_this_year", "monthly_givers"];
  ok("§1 the registry lists every population the brief names", must.every(id => P.population(id)), must.filter(id => !P.population(id)));
  ok("§1 each has a name, a unit, one sentence that starts with its name, and the builder it points at",
    P.POPULATION_IDS.every(id => { const p = P.population(id); return p.name && /^(people|households)$/.test(p.unit) && p.sentence.startsWith(p.name.split(/[:(,]/)[0].trim()) && p.source; }),
    P.POPULATION_IDS.filter(id => { const p = P.population(id); return !(p.name && p.sentence.startsWith(p.name.split(/[:(,]/)[0].trim()) && p.source); }));
  const A = require("../server/atlas/populations").POPULATIONS;
  ok("§1 Atlas's Lapsed is \"Lapsed 12+ months\", its sentence the registry's (Atlas said 173 under the bare word)",
    A.lapsed.word === "Lapsed 12+ months" && A.lapsed.definition === P.population("lapsed").sentence && A.lybunt.definition === P.population("lybunt").sentence, A.lapsed);

  // ── fixture ──────────────────────────────────────────────────────────────
  const dana = await person("Dana Quillfeather");                  // added as a Donor, never gave
  const gil = await person("Gil Ambrosine"); await give(gil, 120);
  const twinMail = `hal-${run}@define1.invalid`;
  const hal1 = await person("Hal Treadwell", twinMail); await give(hal1, 40);
  const hal2 = await person("Hal Treadwell", twinMail.toUpperCase()); await give(hal2, 15);   // a duplicate not yet merged
  const vera = await person("Vera Lindqvist");
  await q(`UPDATE donors SET person_types = '["volunteer"]'::jsonb WHERE org_id=$1 AND id=$2`, [ORG, vera]);
  const vg = await api("POST", "/volunteer-hub/volunteers-group", tok, {});   // the Volunteers screen's own group
  ok("§3 fixture: the Volunteers screen made its group", vg.status === 200 && !!(vg.body && vg.body.id), vg.body);

  // ── §2 a Donor has given ─────────────────────────────────────────────────
  const dir = (await api("GET", "/donors?roleCounts=1&role=donor&limit=200&offset=0", tok)).body;
  const onDonors = new Set(((dir && dir.donors) || []).map(d => d.id));
  ok("§2 Dana, added as a Donor and never given, is not on Donors", !onDonors.has(dana), [...onDonors]);
  ok("§2 the three givers are, and the Donors count is 3", onDonors.has(gil) && onDonors.has(hal1) && onDonors.has(hal2) && dir.roleCounts && dir.roleCounts.donors === 3, dir && dir.roleCounts);
  const contacts = (await api("GET", "/donors?role=contact&limit=200&offset=0", tok)).body;
  ok("§2 Dana is a contact until she gives", ((contacts && contacts.donors) || []).some(d => d.id === dana));

  // ── §3 audiences ─────────────────────────────────────────────────────────
  const aud = (await api("GET", "/audiences", tok)).body;
  const all = (aud.audiences || []).find(a => a.id === "builtin:donors");
  ok("§3 All donors is the population Donors, said in the registry's words", all && all.population === "donors" && all.description === P.population("donors").sentence, all && { population: all.population, description: all.description });
  ok("§3 All donors holds the three givers and not Dana (it claimed members who never gave)", all && all.members === 3, all && all.members);
  const vols = (aud.audiences || []).filter(a => String(a.name).toLowerCase() === "volunteers");
  ok("§3 one Volunteers audience, the roster's", vols.length === 1 && vols[0].id === "builtin:volunteers" && vols[0].population === "volunteers", vols.map(v => [v.id, v.members]));
  const grp = (await api("GET", "/groups", tok)).body;
  ok("§3 the Volunteers screen's group is still a Group", ((grp && grp.groups) || []).some(g => g.id === vg.body.id));
  const AR = require("../shared/numbers/audienceReasons");
  const rows = await q(`SELECT * FROM donors WHERE org_id=$1 AND id = ANY($2::text[])`, [ORG, [gil, hal1, hal2]]);
  const r = AR.audienceReasons(rows, () => ({ send: true }));
  ok("§3 two records with one address are reached once (the earlier one), the other counted as sharing it",
    r.reach.length === 2 && r.reach.some(d => d.id === hal1) && !r.reach.some(d => d.id === hal2) && r.groups.some(g => g.reason === "same_address" && g.count === 1) && r.reach.length + r.leftOutCount === 3,
    { reach: r.reach.map(d => d.id), groups: r.groups.map(g => [g.reason, g.count]) });

  // ── §4 the truth check (with a campaign that ended short of its goal) ─────
  const addDays = require("../orgTime").addDays;
  await api("POST", "/fundraising/campaigns", tok, { name: "Spring Lanterns", goalAmount: 1000, startDate: addDays(today, -60), endDate: addDays(today, -1) });
  const { assertSurfacesAgree } = require("./lib/surfacesAgree");
  const res = await assertSurfacesAgree(ORG, { token: tok, soft: true, only: ["define1", "populations", "endedPace"] });
  ok("§4 assertSurfacesAgree's define1 pass: each population two surfaces count agrees", res.ok, res.diffs);

  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch { /* closed */ } process.exit(1); });
