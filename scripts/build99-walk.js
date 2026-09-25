#!/usr/bin/env node
// BUILD-99 (major gifts) — THE WALK. GUARDED_WRITERS.
//
// The brief's own ending: on the demo org, one proposal walked from Identified to
// Committed with a pledge, one portfolio with three people, one plan applied, one
// brief generated if the key is set, and the dashboard reconciled.
//
// It goes through the REAL routes, and it CHECKS EVERY WRITE. A silently ignored
// 409 is how a walk lies to itself (BUILD-85 paid for that one), so nothing here
// fires and forgets.
//
//   BASE=http://localhost:5661 EMAIL=… PASSWORD=… node scripts/build99-walk.js
//
// Writes to whatever org the login belongs to. Loopback only.

// SELF_REFUSING: it writes through the real routes, so a non-loopback BASE is
// refused outright rather than guarded — there is no read-only mode for a walk
// whose whole point is that the writes land.
const BASE = process.env.BASE || "http://localhost:5661";
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  console.error("Refusing to run: BASE must be loopback (got " + BASE + ")."); process.exit(1);
}
if (process.env.NODE_ENV === "production") { console.error("This walk does not run in production."); process.exit(1); }

const EMAIL = process.env.EMAIL || "walk@b99.example.org";
const PASSWORD = process.env.PASSWORD || "loadtest1234";

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log("  PASS  " + n); }
  else { fail++; console.log("  FAIL  " + n + (x !== undefined ? " — " + JSON.stringify(x).slice(0, 300) : "")); } };

(async () => {
  const lj = await (await fetch(BASE + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }) })).json();
  if (!lj.token) { console.error("Login failed:", JSON.stringify(lj)); process.exit(1); }
  const H = { "Content-Type": "application/json", Authorization: "Bearer " + lj.token };
  const call = async (m, p, b) => {
    const r = await fetch(BASE + p, { method: m, headers: H, body: b === undefined ? undefined : JSON.stringify(b) });
    let j = null; try { j = await r.json(); } catch {}
    return { status: r.status, body: j };
  };
  const cents = v => Math.round(Number(v) * 100);
  const plus = n => { const d = new Date(); d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

  console.log("\n── the people and the fund ──────────────────────────────────");
  const funds = await call("GET", "/finance/funds");
  const fundId = (funds.body || []).find(f => !f.restricted)?.id || null;
  ok("the org has a fund to designate to", !!fundId, fundId);
  const me = await call("GET", "/portfolio/officers");
  const officer = (me.body.officers || [])[0];
  ok("the org has an officer", !!officer, officer);

  const people = [];
  for (const nm of ["Walk Margaret Ruiz", "Walk Hal Ruiz", "Walk Grace Giver"]) {
    const ex = await call("GET", `/donors?search=${encodeURIComponent(nm)}&limit=1`);
    const found = (Array.isArray(ex.body) ? ex.body : ex.body.donors || [])[0];
    if (found) { people.push(found.id); continue; }
    const c = await call("POST", "/donors", { name: nm, email: nm.toLowerCase().replace(/\s+/g, ".") + "@walk.example.org" });
    ok(`created ${nm}`, c.status === 201 || c.status === 200, c.body);
    people.push(c.body.id || c.body.donor?.id);
  }
  ok("three people to work with", people.filter(Boolean).length === 3, people);

  console.log("\n── one portfolio with three people ─────────────────────────");
  for (const id of people) {
    const a = await call("PATCH", `/donors/${id}/assign`, { assignedTo: officer.id });
    ok(`assigned ${id}`, a.status === 200, a.body);
  }
  const t = await call("PUT", `/portfolio/${officer.id}/target`, { target: 250000, countCap: 120 });
  ok("her target and cap save", t.status === 200, t.body);
  const pf = await call("GET", `/portfolio/${officer.id}`);
  ok("the portfolio holds at least the three", pf.body.people.length >= 3, pf.body.people.length);
  ok("the count sentence names her", /assigned to /.test(pf.body.count.sentence), pf.body.count.sentence);
  ok("the target sentence says the target is hers", /the one you typed|over\./.test(pf.body.target.sentence), pf.body.target.sentence);

  console.log("\n── one proposal, Identified → Committed, with a pledge ──────");
  const before = await call("GET", `/donors/${people[0]}/pledges`);
  const pledgesBefore = (before.body || []).length;
  const prop = await call("POST", `/donors/${people[0]}/proposals`, {
    purpose: "Lead gift for the new barn", askAmount: 25000, expectedClose: plus(45),
    stage: "identified", probability: 50, fundId, notes: "Wants the arena named." });
  ok("the proposal opens at Identified", prop.status === 201 && prop.body.stage === "identified", prop.body);
  const mv1 = await call("PUT", `/proposals/${prop.body.id}`, { stage: "cultivating" });
  ok("→ Cultivating", mv1.status === 200 && mv1.body.stage === "cultivating", mv1.body);
  const mv2 = await call("PUT", `/proposals/${prop.body.id}`, { stage: "asked", probability: 75 });
  ok("→ Asked, at 75%", mv2.status === 200 && mv2.body.probability === 75, mv2.body);
  const mv3 = await call("PUT", `/proposals/${prop.body.id}`, { stage: "committed", commitKind: "pledge" });
  ok("→ Committed", mv3.status === 200 && mv3.body.stage === "committed", mv3.body);
  ok("…and it wrote a pledge", !!mv3.body.pledgeId, mv3.body);
  ok("…and NOT a gift as well", mv3.body.giftId === null, mv3.body);
  const after = await call("GET", `/donors/${people[0]}/pledges`);
  ok("EXACTLY ONE new pledge", (after.body || []).length === pledgesBefore + 1, { before: pledgesBefore, after: (after.body || []).length });
  const pl = (after.body || []).find(p => p.id === mv3.body.pledgeId);
  ok("…for $25,000 to the cent", pl && cents(pl.amount) === cents(25000), pl && pl.amount);

  console.log("\n── one plan applied ────────────────────────────────────────");
  const tpls = await call("GET", "/cultivation-templates");
  let tplId = (tpls.body.templates || []).find(x => x.name === "Walk: board prospect")?.id;
  if (!tplId) {
    const ct = await call("POST", "/cultivation-templates", { name: "Walk: board prospect", steps: [
      { type: "follow_up", label: "Visit her at the farm", offsetDays: 7 },
      { type: "follow_up", label: "Invite her to the barn", offsetDays: 30 },
      { type: "send", label: "Send the annual report", offsetDays: 60 },
      { type: "check_in_ask", label: "Ask for the lead gift", offsetDays: 90 }] });
    ok("the template saves", ct.status === 201, ct.body);
    tplId = ct.body.id;
  }
  const ap = await call("POST", `/donors/${people[2]}/plan`, { templateId: tplId });
  ok("the plan applies", ap.status === 201 || (ap.status === 409 && ap.body.code === "plan_already_active"), ap.body);
  const plan = (await call("GET", `/donors/${people[2]}/plan`)).body.plan;
  ok("four steps", plan && plan.steps.length === 4, plan && plan.steps.length);
  ok("exactly one of them open or all waiting on her own follow-up",
     plan.steps.filter(s => s.status === "open").length <= 1, plan.steps.map(s => s.status));
  ok("the plan carries its sentence", /step \d of 4|finished/.test(plan.sentence), plan.sentence);

  console.log("\n── one brief ───────────────────────────────────────────────");
  const rows = await call("GET", `/donors/${people[0]}/brief-rows`);
  ok("the rows Steward would hand over are readable", rows.status === 200 && rows.body.refs.length > 1, rows.body && rows.body.refs);
  ok("…and every one is a well-formed citation", (rows.body.refs || []).every(r => /^[a-z]+:[A-Za-z0-9_.:-]+$/.test(r)), rows.body.refs);
  const br = await call("POST", `/donors/${people[0]}/brief`, {});
  if (br.status === 503) {
    ok("no key configured, so the brief says UNAVAILABLE rather than inventing one",
       br.body.error === "brief_unavailable", br.body);
    console.log("      (set ANTHROPIC_API_KEY and re-run, or use scripts/build99-brief-drill.js, to walk the writing)");
  } else {
    ok("the brief is written", br.status === 200 && Array.isArray(br.body.sections), br.body);
    ok("every sentence cites a row that exists",
       br.body.sections.every(s => s.sentences.every(x => x.cites.every(c => rows.body.refs.includes(c)))),
       br.body.sections.flatMap(s => s.sentences.flatMap(x => x.cites)));
    ok("the footer says Steward has not estimated her means", /has not estimated/.test(br.body.footer), br.body.footer);
    const pdf = await fetch(`${BASE}/briefs/${br.body.runId}/pdf`, { headers: H });
    ok("the PDF renders", pdf.status === 200, pdf.status);
  }

  console.log("\n── the dashboard, reconciled ───────────────────────────────");
  const d = await call("GET", "/major-gifts/dashboard");
  const scr = await call("GET", "/proposals");
  ok("the dashboard loads", d.status === 200, d.body && Object.keys(d.body));
  ok("open pipeline equals the Proposals screen's open ask",
     d.body.tiles.pipeline.value === scr.body.openAsk.cents, { dash: d.body.tiles.pipeline.value, screen: scr.body.openAsk.cents });
  ok("weighted equals the Proposals screen's weighted",
     d.body.tiles.weighted.value === scr.body.weighted.cents, { dash: d.body.tiles.weighted.value, screen: scr.body.weighted.cents });
  const stageOff = d.body.byStage.filter(r => {
    const s = scr.body.byStage.find(x => x.stage === r.stage);
    return !s || s.count !== r.count || s.askCents !== r.askCents;
  }).map(r => r.stage);
  ok("every stage row agrees with the Proposals screen", stageOff.length === 0, stageOff);
  ok("committed this year includes the $25,000 just committed",
     d.body.tiles.committedThisYear.value >= cents(25000), d.body.tiles.committedThisYear);
  ok("every tile carries a definition",
     Object.values(d.body.tiles).every(x => x.definition && x.definition.length > 40),
     Object.entries(d.body.tiles).map(([k, v]) => [k, (v.definition || "").length]));
  ok("the follow-up backlog counts overdue separately from open",
     d.body.threadBacklog.rows.every(r => r.overdue <= r.open), d.body.threadBacklog.rows);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
