// tests/dates1.test.js · DATES-1. MANY PEOPLE INTO A JOURNEY AT ONCE, A
// JOURNEY ON A DATE EVERY YEAR, TASKS EVERY YEAR, AND A NOTE YOU SEE FIRST.
//
//   §1 BULK. Four people checked on the Donors list and added to one journey:
//      the preview says three will start and one won't, because a journey
//      that comes first holds them, in those words; a do-not-contact and a
//      deceased person are named the same way. The start answers with the
//      counts in the one request, through the one start path (each plan is
//      the by-hand trigger). One Undo stops all three: no plan running, no
//      open thread; a step already done stays done. A batch older than 30
//      days cannot be undone. Then "select all matching" on a filtered list
//      of 2,500 (gathered from /donors/ids the way the screen does) runs as a
//      job on the queue and finishes with 2,500 started.
//   §2 A DATE EVERY YEAR. A Dec 1 journey for one stage, in an org in New York
//      and one in Los Angeles. Nov 30 starts nobody. An instant that is Dec 1
//      in New York and still Nov 30 in Los Angeles starts New York's and not
//      Los Angeles's. On Dec 1 it starts its audience only, once: the sweep
//      run again starts nobody twice. Somebody in a journey that comes first
//      is skipped, and the journey's stats count them with the reason. A Feb
//      29 journey runs on 2027-02-28 and not on 2028-02-28.
//   §3 TASKS EVERY YEAR. A yearly task due 2026-12-01, done, makes one due
//      2027-12-01; one due 2028-02-29 makes 2029-02-28.
//   §4 ABOUT THEM. Saved, read back on the record, in the person's export and
//      in what Brief me hands the model; refused at 501 characters with a
//      sentence; refused for a read-only org.
//   §5 NOTHING SENDS. A mail sink is bound for the whole suite and sees no
//      request.
//
// HOW IT WOULD GO RED: a preview or start that skips nobody, or says it
// differently (§1); an undo that leaves a journey running (§1); a sweep that
// runs on the wrong day, in the wrong zone, for people outside its audience,
// or twice (§2); a yearly repeat that is not a year, or a Feb 29 that is March
// 1 (§3); a note that does not save or is not refused (§4); any mail (§5).
//
// PROVEN ABLE TO FAIL: against origin/main 05f2cfe every section fails (no
// batch routes, no yearly_date trigger, no yearly repeat, no about_them).
// Planted on this branch: the yearly sweep ignoring its audience turns §2
// "for its audience only" red; the batch undo not stopping the journeys
// turns §1 "Undo stops all three" red.
//
// Its own fixture orgs (org_dates1ny, org_dates1la), never the demo org.

const bcrypt = require("bcryptjs");
const http = require("http");
const { ok, summary, q, closeDb, login, api, SINK_PORT } = require("./helpers");

const NY = "org_dates1ny", LA = "org_dates1la";
const PW = "loadtest1234";
const sleep = ms => new Promise(r => setTimeout(r, ms));
// A section that throws is one red line, and the next section still runs.
async function section(name, fn) {
  try { await fn(); } catch (e) { ok(`${name} ran to the end`, false, String(e && e.message || e).slice(0, 200)); }
}

const captured = [];
function startSink() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let body = ""; req.on("data", c => (body += c));
      req.on("end", () => { captured.push({ url: req.url, body: body.slice(0, 400) }); res.writeHead(200, { "Content-Type": "application/json" }); res.end("{}"); });
    });
    srv.on("error", () => resolve(null));
    srv.listen(SINK_PORT, () => resolve(srv));
  });
}

async function wipe(org) {
  const tables = (await q(`SELECT table_name FROM information_schema.columns
                            WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (let pass = 0; pass < 6; pass++) {
    for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [org]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [org]).then(() => true).catch(() => false)) break;
  }
}
async function makeOrg(org, slug, tz) {
  await wipe(org);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,$2,$3,1,'active','team',$4)`,
    [org, "Dates One " + slug, "dates-one-" + slug, tz]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Dana Fixture','admin')`,
    ["u_" + org, org, `admin@${slug}.dates1.local`, bcrypt.hashSync(PW, 10)]);
  return login(`admin@${slug}.dates1.local`, PW);
}
async function person(org, id, name, extra = {}) {
  await q(`INSERT INTO donors (id,org_id,name,email,stage,deceased,do_not_contact,created_by,created_by_name)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'system:test','test')`,
    [id, org, name, `${id}@dates1.local`, extra.stage || "cultivate", extra.deceased === true, extra.dnc === true]);
}
const journey = (tok, body) => api("POST", "/journeys", tok, body);
const plansOf = (org, tpl) => q(`SELECT id, donor_id, status, trigger_key, batch_id FROM cultivation_plans WHERE org_id=$1 AND template_id=$2 ORDER BY donor_id`, [org, tpl]);

(async () => {
  const sink = await startSink();
  const before = captured.length;
  const tok = await makeOrg(NY, "ny", "America/New_York");
  const tokLA = await makeOrg(LA, "la", "America/Los_Angeles");

  await section("§1", async () => {
  // ── §1 BULK ─────────────────────────────────────────────────────────────
  for (const [id, nm, x] of [["d1_ann", "Ann Ash"], ["d1_ben", "Ben Birch"], ["d1_cy", "Cy Cedar"], ["d1_dot", "Dot Dogwood"],
                             ["d1_eve", "Eve Elm", { dnc: true }], ["d1_fay", "Fay Fir", { deceased: true }]]) await person(NY, id, nm, x);
  const high = await journey(tok, { name: "Major donor care", trigger: "by_hand", priority: 90, exclusive: true,
    steps: [{ type: "follow_up", label: "Visit", offsetDays: 3 }] });
  const bulk = await journey(tok, { name: "Winter thank-you", trigger: "by_hand", priority: 50, exclusive: true,
    steps: [{ type: "thank", label: "Call to say thank you", offsetDays: 2 }, { type: "send", label: "Send the impact report", offsetDays: 30, draft: "impact_report" }] });
  ok("§1 the two journeys are made", high.status === 201 && bulk.status === 201, `${high.status} ${bulk.status}`);
  const inHigh = await api("POST", `/journeys/${high.body.id}/apply`, tok, { donorIds: ["d1_dot"] });
  ok("§1 Dot is already in the journey that comes first", inHigh.status === 200 && inHigh.body.started === 1, JSON.stringify(inHigh.body).slice(0, 200));

  const checked = ["d1_ann", "d1_ben", "d1_cy", "d1_dot", "d1_eve", "d1_fay"];
  const pv = await api("POST", `/journeys/${bulk.body.id}/batch/preview`, tok, { donorIds: checked });
  const pvLines = (pv.body.lines || []).map(l => l.sentence);
  ok("§1 the preview says three will start, with the first step and its date",
     pv.status === 200 && pv.body.willStart === 3 && pv.body.firstStep && pv.body.firstStep.label === "Call to say thank you"
     && /^3 people will start Winter thank-you\. The first step is "Call to say thank you", due /.test(pv.body.sentence), JSON.stringify(pv.body).slice(0, 400));
  ok("§1 the preview says who won't start and why, in plain words",
     pvLines.includes("1 is already in a journey that comes first.") && pvLines.includes("1 is marked do not contact.") && pvLines.includes("1 has died."),
     JSON.stringify(pvLines));
  ok("§1 the preview writes nothing", (await plansOf(NY, bulk.body.id)).length === 0);

  const st = await api("POST", `/journeys/${bulk.body.id}/batch`, tok, { donorIds: checked });
  ok("§1 the start answers in the one request with the counts", st.status === 200 && st.body.job === false && st.body.started === 3 && st.body.skipped === 3
     && (st.body.lines || []).some(l => l.sentence === "1 is already in a journey that comes first."), JSON.stringify(st.body).slice(0, 400));
  let plans = await plansOf(NY, bulk.body.id);
  ok("§1 three are in it, through the one start path, stamped with the batch",
     plans.length === 3 && plans.every(p => p.status === "active" && p.trigger_key === "by_hand" && p.batch_id === st.body.batchId)
     && plans.map(p => p.donor_id).join(",") === "d1_ann,d1_ben,d1_cy", JSON.stringify(plans));
  ok("§1 Dot stays in the journey that comes first", (await plansOf(NY, high.body.id)).some(p => p.donor_id === "d1_dot" && p.status === "active"));
  // Ann's first step is done before the undo: it stays done.
  const annPlan = plans.find(p => p.donor_id === "d1_ann");
  // (A step is done when its thread closes: both, as the Thread does it.)
  await q(`UPDATE threads SET closed_at=NOW(), close_kind='dismissed', close_reason='handled_outside' WHERE org_id=$1 AND id IN (SELECT thread_id FROM cultivation_plan_steps WHERE plan_id=$2 AND seq=1)`, [NY, annPlan.id]);
  await q(`UPDATE cultivation_plan_steps SET status='done', closed_at=NOW(), closed_by='u_${NY}', closed_by_name='Dana Fixture' WHERE plan_id=$1 AND seq=1`, [annPlan.id]);
  const undo = await api("POST", `/journeys/batches/${st.body.batchId}/undo`, tok, {});
  ok("§1 one Undo answers for the whole batch", undo.status === 200 && undo.body.undone === 3, JSON.stringify(undo.body));
  plans = await plansOf(NY, bulk.body.id);
  ok("§1 Undo stops all three: no journey of the batch is running", plans.every(p => p.status !== "active"), JSON.stringify(plans));
  // Stopped, never "completed": the two nobody had worked are taken back out,
  // and Ann's, with a step done, is stopped and kept.
  ok("§1 Undo stops them rather than finishing them: Ben and Cy are taken back out, Ann's is stopped",
     plans.length === 1 && plans[0].donor_id === "d1_ann" && plans[0].status === "abandoned", JSON.stringify(plans));
  const st2 = await api("GET", `/journeys/${bulk.body.id}/stats`, tok);
  ok("§1 and the journey does not count them as completed",
     ((st2.body.figures || []).find(f => f.key === "completed") || {}).value === 0, JSON.stringify((st2.body.figures || []).map(f => [f.key, f.value])));
  const openThreads = await q(`SELECT COUNT(*)::int AS n FROM threads WHERE org_id=$1 AND donor_id = ANY($2) AND closed_at IS NULL`, [NY, ["d1_ann", "d1_ben", "d1_cy"]]);
  ok("§1 and none of the three is left with an open step from it", openThreads[0].n === 0, JSON.stringify(openThreads));
  const annSteps = await q(`SELECT seq, status FROM cultivation_plan_steps WHERE plan_id=$1 ORDER BY seq`, [annPlan.id]);
  ok("§1 Ann's step already done stays done, and the step not started is removed",
     annSteps.length === 1 && annSteps[0].status === "done", JSON.stringify(annSteps));
  ok("§1 a batch is undone once", (await api("POST", `/journeys/batches/${st.body.batchId}/undo`, tok, {})).status === 409);
  const old = await api("POST", `/journeys/${bulk.body.id}/batch`, tok, { donorIds: ["d1_ben"] });
  await q(`UPDATE journey_batches SET created_at = created_at - INTERVAL '31 days' WHERE id=$1`, [old.body.batchId]);
  const late = await api("POST", `/journeys/batches/${old.body.batchId}/undo`, tok, {});
  ok("§1 a batch older than 30 days cannot be undone, and says so", late.status === 409 && /30 days/.test(late.body.sentence || ""), JSON.stringify(late.body));

  // "Select all matching" on a filtered list of 2,500, run as a job.
  await q(`INSERT INTO donors (id,org_id,name,email,stage,created_by,created_by_name)
           SELECT 'd1_bulk_' || lpad(g::text, 4, '0'), $1, 'Bulk Person ' || g, 'bulk' || g || '@dates1.local', 'Spring list', 'system:test', 'test'
             FROM generate_series(1, 2500) g`, [NY]);
  const ids = [];
  let offset = 0;
  for (let i = 0; i < 80 && offset != null; i++) {
    const r = await api("GET", `/donors/ids?stage=${encodeURIComponent("Spring list")}&offset=${offset}`, tok);
    if (Array.isArray(r.body && r.body.ids)) ids.push(...r.body.ids);
    offset = r.body && r.body.next != null ? r.body.next : null;
  }
  ok("§1 everyone matching the filter is gathered the way the screen does", ids.length === 2500, ids.length);
  const big = await journey(tok, { name: "Spring note", trigger: "by_hand", priority: 20, steps: [{ type: "thank", label: "Send a spring note", offsetDays: 5 }] });
  const bpv = await api("POST", `/journeys/${big.body.id}/batch/preview`, tok, { donorIds: ids });
  ok("§1 the preview says a list this big runs in the background", bpv.body.willStart === 2500 && bpv.body.runsAsJob === true, JSON.stringify(bpv.body).slice(0, 200));
  const job = await api("POST", `/journeys/${big.body.id}/batch`, tok, { donorIds: ids });
  ok("§1 over 2,000 people runs as a job on the queue", job.status === 202 && job.body.job === true && job.body.status === "running", JSON.stringify(job.body).slice(0, 300));
  let prog = job.body, sawProgress = false;
  for (let i = 0; i < 900 && prog.status === "running"; i++) {
    await sleep(500);
    prog = (await api("GET", `/journeys/batches/${job.body.batchId}`, tok)).body;
    if (prog.status === "running" && prog.done > 0 && prog.done < 2500) sawProgress = true;
  }
  ok("§1 the job shows its progress while it runs", sawProgress, JSON.stringify(prog));
  ok("§1 the job finishes with the right counts", prog.status === "done" && prog.started === 2500 && prog.skipped === 0, JSON.stringify(prog));
  ok("§1 and 2,500 are in the journey", (await q(`SELECT COUNT(*)::int AS n FROM cultivation_plans WHERE org_id=$1 AND template_id=$2 AND status='active'`, [NY, big.body.id]))[0].n === 2500);
  });

  await section("§2", async () => {
  // ── §2 A DATE EVERY YEAR ────────────────────────────────────────────────
  for (const org of [NY, LA]) {
    const p = org === NY ? "n" : "l";
    await person(org, `d2${p}_gil`, "Gil Gum", { stage: "Board" });
    await person(org, `d2${p}_hal`, "Hal Hazel", { stage: "Board" });
    await person(org, `d2${p}_ivy`, "Ivy Ironwood", { stage: "cultivate" });   // not in the audience
    await person(org, `d2${p}_jo`, "Jo Juniper", { stage: "Board" });           // in a journey that comes first
  }
  const cat = await api("GET", "/journeys", tok);
  ok("§2 the builder lists the calendar triggers first, with A date every year",
     (cat.body.triggerGroups || [])[0] && cat.body.triggerGroups[0].label === "A date on the calendar"
     && cat.body.triggerGroups[0].keys.join(",") === "yearly_date,birthday,giving_anniversary"
     && (cat.body.triggers || []).some(t => t.key === "yearly_date" && t.label === "A date every year"), JSON.stringify(cat.body.triggerGroups));
  ok("§2 the two starter journeys are offered", ["year_end_impact", "birthday_card"].every(k => (cat.body.presets || []).some(p => p.key === k)));
  const yid = {};
  for (const [org, t] of [[NY, tok], [LA, tokLA]]) {
    const p = org === NY ? "n" : "l";
    const first = await journey(t, { name: "Board care", trigger: "by_hand", priority: 90, exclusive: true, steps: [{ type: "follow_up", label: "Visit", offsetDays: 1 }] });
    await api("POST", `/journeys/${first.body.id}/apply`, t, { donorIds: [`d2${p}_jo`] });
    const y = await journey(t, { name: "Year-end report for the board", trigger: "yearly_date", priority: 40, exclusive: true,
      triggerFilters: { month: 12, day: 1, who: "stage", stage: "Board" },
      steps: [{ type: "send", label: "Send the impact report", offsetDays: 0, draft: "impact_report" }, { type: "follow_up", label: "Call about it", offsetDays: 14 }] });
    ok(`§2 a Dec 1 journey for one stage is made (${org})`, y.status === 201, JSON.stringify(y.body).slice(0, 300));
    yid[org] = y.body.id;
    await api("PATCH", `/journeys/${y.body.id}`, t, { enabled: true });
  }
  const sweep = (t, now) => api("POST", "/journeys/run-sweep", t, { now });
  const started = async org => (await plansOf(org, yid[org])).map(p => p.donor_id).join(",");
  await sweep(tok, "2026-11-30T17:00:00Z"); await sweep(tokLA, "2026-11-30T17:00:00Z");
  ok("§2 Nov 30 starts nobody, in either zone", (await started(NY)) === "" && (await started(LA)) === "");
  // 06:30 UTC on Dec 1 is 1:30 AM Dec 1 in New York and 10:30 PM Nov 30 in Los Angeles.
  await sweep(tok, "2026-12-01T06:30:00Z"); await sweep(tokLA, "2026-12-01T06:30:00Z");
  ok("§2 Dec 1 in the org's own zone: New York starts, Los Angeles (still Nov 30) does not",
     (await started(NY)) === "d2n_gil,d2n_hal" && (await started(LA)) === "", `${await started(NY)} | ${await started(LA)}`);
  await sweep(tokLA, "2026-12-01T18:00:00Z");
  ok("§2 for its audience only: the Board, not Ivy, and not Jo (a journey comes first)", (await started(LA)) === "d2l_gil,d2l_hal", await started(LA));
  const steps = await q(`SELECT s.seq, s.due_date FROM cultivation_plan_steps s JOIN cultivation_plans p ON p.id=s.plan_id
                          WHERE p.org_id=$1 AND p.template_id=$2 AND p.donor_id='d2n_hal' ORDER BY s.seq`, [NY, yid[NY]]);
  ok("§2 the step offsets count from Dec 1", steps.map(s => String(s.due_date).slice(0, 10)).join(",") === "2026-12-01,2026-12-15", JSON.stringify(steps));
  const again = await sweep(tok, "2026-12-01T20:00:00Z");
  ok("§2 once a year: the sweep run again starts nobody twice", again.body.fired === 0 && (await plansOf(NY, yid[NY])).length === 2, JSON.stringify(again.body));
  const stats = await api("GET", `/journeys/${yid[NY]}/stats`, tok);
  const sk = (stats.body.figures || []).find(f => f.key === "skippedOnDate");
  ok("§2 the stats count the one skipped, and say why", sk && sk.value === 1 && sk.why[0].sentence === "1 is already in a journey that comes first.", JSON.stringify(sk));
  const skRows = await api("GET", `/journeys/${yid[NY]}/rows?rows=skippedOnDate`, tok);
  ok("§2 the skipped figure opens its row, with the reason", skRows.body.count === 1 && skRows.body.donors[0].id === "d2n_jo"
     && /Board care/.test(skRows.body.donors[0].reason), JSON.stringify(skRows.body).slice(0, 300));
  // Feb 29 runs on Feb 28 in a year without one, and only then.
  const leap = await journey(tok, { name: "Leap day hello", trigger: "yearly_date", priority: 10,
    triggerFilters: { month: 2, day: 29, who: "everyone" }, audience: { stage: "Board" }, steps: [{ type: "thank", label: "Say hello", offsetDays: 0 }] });
  await api("PATCH", `/journeys/${leap.body.id}`, tok, { enabled: true });
  await sweep(tok, "2027-02-27T17:00:00Z");
  ok("§2 Feb 29 does not run on 2027-02-27", (await plansOf(NY, leap.body.id)).length === 0);
  await sweep(tok, "2027-02-28T17:00:00Z");
  ok("§2 Feb 29 runs on 2027-02-28", (await plansOf(NY, leap.body.id)).length > 0, (await plansOf(NY, leap.body.id)).length);
  });

  await section("§3", async () => {
  // ── §3 TASKS EVERY YEAR ─────────────────────────────────────────────────
  for (const [due, want] of [["2026-12-01", "2027-12-01"], ["2028-02-29", "2029-02-28"]]) {
    const t = await api("POST", "/tasks", tok, { title: "Annual call", due, type: "donor", donorId: "d1_ann", recur: { every: "year" } });
    ok(`§3 a yearly task due ${due} is saved`, t.status === 201 && t.body.recur && t.body.recur.every === "year", JSON.stringify(t.body).slice(0, 200));
    const d = await api("POST", `/tasks/${t.body.id}/complete`, tok, { done: 1 });
    const [next] = await q(`SELECT due FROM tasks WHERE recur_parent_id=$1 AND org_id=$2`, [t.body.id, NY]);
    ok(`§3 done, it makes one due ${want}`, d.status === 200 && next && String(next.due).slice(0, 10) === want, `${d.status} ${JSON.stringify(next)}`);
  }
  });

  await section("§4", async () => {
  // ── §4 ABOUT THEM ───────────────────────────────────────────────────────
  const note = "Married to Sam. Knows the founder's family from the lake; prefers a call to an email.";
  const sv = await api("PATCH", "/donors/d1_ben/about-them", tok, { aboutThem: note });
  ok("§4 the note saves", sv.status === 200 && sv.body.aboutThem === note, JSON.stringify(sv.body));
  const back = await api("GET", "/donors/d1_ben", tok);
  ok("§4 it is on the record when the profile opens again", back.body.about_them === note, back.body.about_them);
  const exp = await api("GET", "/donors/d1_ben/export-data", tok);
  ok("§4 it is in the person's data export", JSON.stringify(exp.body).includes(note), exp.status);
  const br = await api("GET", "/donors/d1_ben/brief-rows", tok);
  ok("§4 it is in what Brief me hands the model", JSON.stringify(br.body).includes(note), br.status);
  const tl = await q(`SELECT COUNT(*)::int AS n FROM interactions WHERE org_id=$1 AND donor_id='d1_ben' AND note LIKE '%lake%'`, [NY]);
  ok("§4 it is not a timeline Note", tl[0].n === 0);
  const long = await api("PATCH", "/donors/d1_ben/about-them", tok, { aboutThem: "x".repeat(501) });
  ok("§4 501 characters is refused, with a sentence", long.status === 400 && /501 characters\. Keep it to 500 or fewer/.test(long.body.sentence || ""), JSON.stringify(long.body));
  ok("§4 and the note is unchanged", (await api("GET", "/donors/d1_ben", tok)).body.about_them === note);
  await q(`UPDATE orgs SET subscription_status='trial_expired' WHERE id=$1`, [NY]);
  const ro = await api("PATCH", "/donors/d1_ben/about-them", tok, { aboutThem: "Changed" });
  await q(`UPDATE orgs SET subscription_status='active' WHERE id=$1`, [NY]);
  ok("§4 a read-only org cannot edit it", ro.status === 402 && (await api("GET", "/donors/d1_ben", tok)).body.about_them === note, ro.status);
  });

  // ── §5 NOTHING SENDS ────────────────────────────────────────────────────
  if (sink) {
    ok("§5 nothing in this build sent an email, a letter or a text: the mail sink saw no request",
       captured.length === before, JSON.stringify(captured.slice(before)).slice(0, 300));
    sink.close();
  } else ok("§5 the mail sink is bound", false, "SINK_PORT was taken");

  await wipe(NY); await wipe(LA);
  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
