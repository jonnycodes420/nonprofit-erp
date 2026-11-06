// tests/feel1.test.js · FEEL-1: no number disagrees, no word reads like code.
//
// The one new suite of the build (it guards money, donor data and email). Home
// never jumping (item 1) is perf-app's desktop leg with the moves deck held late,
// 10 runs out of 10 (tests/perf-app.spec.js). The word fixes (item 4) are in
// tests/feel1-words.part.js and run from here.
//
// Each section failed on main:
//   §2a the lifetime moved $244 when an import's undated gift was dated
//   §2b the Tasks badge never said why it differs from Home's follow-ups
//   §2c an attendance line was stored as "Wed Nov 04" (read back as 2001)
//   §2d the fund cards never re-read on a gift change
//   §2e a shift said 5 on the Calendar and 2 on the Volunteers schedule
//   §2f the Donors CSV export read the stored total_giving
//   §3  "Skip the next step" closed a different open follow-up
//   §4  the words, and a $0 gift offered "Send receipt"
// Fixture org of its own, made-up names; nothing sends.
"use strict";
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, BASE } = require("./helpers");
const { testNow } = require("./clock");
const orgTime = require("../orgTime");
const { wordsChecks } = require("./feel1-words.part");

const RUN = require("crypto").randomBytes(4).toString("hex");
const ORG = `org_feel1_${RUN}`;
const OWNER = `owner-${RUN}@feel1.local`;
const PW = "loadtest1234";
const ROOT = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const ISO = /^\d{4}-\d{2}-\d{2}$/;

async function reset() {
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,emails_enabled,timezone,onboarded_at)
           VALUES ($1,'Feel One Fellowship',$1,1,'active','team',false,'America/New_York',NOW())`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($3,$1,$4,$2,'Owner','admin')`,
    [ORG, bcrypt.hashSync(PW, 10), `u_feel1_${RUN}`, OWNER]);
}

(async () => {
  await reset();
  const tok = await login(OWNER, PW);
  const today = orgTime.orgToday({ timezone: "America/New_York" }, new Date(testNow()));
  const daysAgo = n => orgTime.addDays(today, -n);
  const person = async name => {
    const r = await api("POST", "/donors", tok, { name, email: `${name.split(" ")[0].toLowerCase()}-${RUN}@feel1.invalid` });
    ok(`${name} exists`, !!(r.body && r.body.id), r.status + " " + JSON.stringify(r.body).slice(0, 160));
    return r.body.id;
  };

  // ── §2a · THE $244: AN IMPORT'S OWN UNDATED GIFT, DATED LATER ───────────
  // A file states a total ($37,206) and lists one undated $244 gift. That gift
  // is inside the total it stated. On main it was counted on top ($37,450) and
  // left the total once "Use the event date" dated it: $37,206, no gift changed.
  {
    const DS = require("../donorSummary");
    const imp = `imp_feel1_${RUN}`, d = `d_feel1_kmw_${RUN}`;
    await q(`INSERT INTO imports (id,org_id,name) VALUES ($1,$2,'Kestrel dinner list')`, [imp, ORG]);
    await q(`INSERT INTO donors (id,org_id,name,total_giving,created_by,created_by_name,created_import_id) VALUES ($1,$2,'Kestrel Marine Works',37206,'system:test','test fixture',$3)`, [d, ORG, imp]);
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,import_id,created_by,created_by_name) VALUES ($1,$2,$3,244,NULL,'gift',$4,'system:test','test fixture')`,
      [`g_feel1_kmw_${RUN}`, ORG, d, imp]);
    let kept = true;
    // Main's statement takes four values (no import named): run that, so main shows its own $244 move.
    await q(DS.KEEP_IMPORTED_TOTAL, [ORG, [d], "Kestrel dinner list", daysAgo(1), imp])
      .catch(() => { kept = false; return q(DS.KEEP_IMPORTED_TOTAL, [ORG, [d], "Kestrel dinner list", daysAgo(1)]); });
    ok("§2a the import keeps its stated total, naming the import it came with", kept);
    const life = async () => Number((await q(`SELECT ${require("../shared/numbers/lifetime").LIFETIME("d")} AS v FROM donors d WHERE d.id=$1`, [d]))[0].v);
    const before = await life();
    const dated = await api("POST", `/imports/${imp}/date-undated`, tok, { date: daysAgo(30) });
    const after = await life();
    const [{ total_giving: stored }] = await q(`SELECT total_giving FROM donors WHERE id=$1`, [d]);
    ok(`§2a an organization's lifetime does not move when the import's undated gift is dated ($37,206 before and after; was ${before} → ${after})`,
       dated.status === 200 && before === 37206 && after === 37206 && Number(stored) === 37206, { status: dated.status, before, after, stored });
  }

  // ── §2b · HOME'S FOLLOW-UPS AND THE TASKS BADGE ─────────────────────────
  {
    const badge = read("client/src/lib/taskBadge.js");
    ok("§2b the Tasks badge's tooltip says why it differs from Home's follow-ups (one person per next step, any day; vs her tasks due today or overdue)",
       /Home's follow-ups count something else/.test(badge) && /title: counts \? badgeTitle\(counts\)/.test(badge)
       && /title=\{taskBadge\.title\}/.test(read("client/src/App.jsx")));
  }

  // ── §2c · AN ATTENDANCE LINE IS DATED, NEVER "INVALID DATE" ─────────────
  {
    const pid = await person("Odalys Brightwater");
    const ev = `ev_feel1_${RUN}`, att = `att_feel1_${RUN}`;
    await q(`INSERT INTO events (id,org_id,name,event_type,date) VALUES ($1,$2,'Harbor Lantern Walk','other',$3::date)`, [ev, ORG, daysAgo(2)]);
    await q(`INSERT INTO event_attendees (id,event_id,org_id,donor_id,name,status) VALUES ($1,$2,$3,$4,'Odalys Brightwater','registered')`, [att, ev, ORG, pid]);
    const r = await api("POST", `/events/${ev}/attendance`, tok, { attended: [att] });
    const [line] = await q(`SELECT date FROM interactions WHERE org_id=$1 AND donor_id=$2 AND metadata->>'via'='event_attendance'`, [ORG, pid]);
    ok(`§2c marking attendance writes the event's own day, YYYY-MM-DD (${line && line.date}; main wrote "Wed Nov 04", read back as 2001)`,
       r.status < 300 && !!line && ISO.test(String(line.date)) && line.date === daysAgo(2), { status: r.status, line });
    const mp = read("client/src/components/MeetingPanels.jsx");
    ok("§2c the timeline's month group is never \"Invalid Date\": a day that is not YYYY-MM-DD reads as when it was written, or No date",
       /FEEL-1: never "Invalid Date"/.test(mp) && /it\.date = day; else \{ it\.date = ""; it\.undated = true; \}/.test(mp));
  }

  // ── §2d · FUND TOTALS READ THROUGH STALE-1'S ANNOUNCEMENT ───────────────
  {
    const fin = read("client/src/components/Finance.jsx");
    const cards = fin.slice(fin.indexOf("function FinFundCards"));
    ok("§2d the fund cards and Finance's totals re-read on a gift, pledge or fund change, never left on \"Updating\"",
       /useChanged\(\["gift", "pledge", "fund", "totals"\]/.test(cards.slice(0, 1500)) && (fin.match(/useChanged\(\["gift", "pledge", "fund", "totals"\]/g) || []).length === 2);
  }

  // ── §2e · ONE SHIFT, ONE COUNT ──────────────────────────────────────────
  {
    const opp = `vo_feel1_${RUN}`, slot = `vs_feel1_${RUN}`, role = `vr_feel1_${RUN}`, day = orgTime.addDays(today, 3);
    await q(`INSERT INTO volunteer_opportunities (id,org_id,name,slug) VALUES ($1,$2,'Pantry sorting',$3)`, [opp, ORG, `pantry-${RUN}`]);
    await q(`INSERT INTO volunteer_slots (id,org_id,opportunity_id,date,start_time,end_time) VALUES ($1,$2,$3,$4,'09:00','12:00')`, [slot, ORG, opp, day]);
    await q(`INSERT INTO volunteer_slot_roles (id,org_id,slot_id,name,needed) VALUES ($1,$2,$3,'Sorter',4)`, [role, ORG, slot]);
    const names = ["Ione Calder", "Bram Featherly", "Cosima Wrenfield", "Dashiell Orrin", "Elowen Pike"];
    for (let i = 0; i < names.length; i++) {
      const id = await person(names[i]);
      // Two with the role; three signed up with no role on a shift that has roles.
      await q(`INSERT INTO volunteer_signups (id,org_id,slot_id,person_id,status,role_id) VALUES ($1,$2,$3,$4,'confirmed',$5)`,
        [`su_feel1_${RUN}_${i}`, ORG, slot, id, i < 2 ? role : null]);
    }
    const cal = await api("GET", `/calendar/items?from=${day}&to=${day}&types=shift`, tok);
    const item = ((cal.body && cal.body.items) || []).find(x => x.id === `shift:${slot}`);
    const sch = await api("GET", `/volunteer-hub/schedule?from=${day}&to=${day}`, tok);
    const sh = ((sch.body && sch.body.shifts) || []).find(x => x.id === slot);
    ok(`§2e a shift says one count on the Calendar and the Volunteers schedule (${item && item.filled} and ${sh && sh.footer.scheduled})`,
       !!item && !!sh && item.filled === sh.footer.scheduled && item.needed === sh.footer.needed && item.detail === `${sh.footer.scheduled} of ${sh.footer.needed} filled`,
       { item: item && { filled: item.filled, needed: item.needed, detail: item.detail }, footer: sh && sh.footer });
  }

  // ── §2f · THE DONORS CSV READS THE ONE LIFETIME ─────────────────────────
  {
    const id = await person("Fennimore Ashgrove");
    const g = await api("POST", `/donors/${id}/gifts`, tok, { amount: 125, date: daysAgo(5) });
    ok("§2f a $125 gift", g.status < 300, g.status);
    await q(`UPDATE donors SET total_giving=999 WHERE id=$1`, [id]);   // a stored total that has not caught up
    const res = await fetch(`${BASE}/donors/export/csv`, { headers: { Authorization: `Bearer ${tok}` } });
    const csv = await res.text();
    const head = csv.split(/\r?\n/)[0].split(","), row = csv.split(/\r?\n/).find(l => l.includes("Fennimore Ashgrove")) || "";
    const cell = row.split(",")[head.indexOf("Total giving")];
    ok(`§2f the export's Total giving is the lifetime rule ($125), not the stored total_giving ($999): ${cell}`,
       res.status === 200 && Number(cell) === 125, { status: res.status, cell });
  }

  // ── §3 · A SKIP ONLY SKIPS ITS OWN STEP ─────────────────────────────────
  {
    const id = await person("Galen Thistlewood");
    const th = `th_feel1_${RUN}`;
    await q(`INSERT INTO threads (id,org_id,donor_id,next_step_type,next_step_label,due_date,opened_on,created_by,created_by_name)
             VALUES ($1,$2,$3,'call','Call about the spring visit',$4,$5,'system:test','test fixture')`, [th, ORG, id, orgTime.addDays(today, 4), daysAgo(3)]);
    const note = await api("POST", `/donors/${id}/conversations`, tok, { touch: "note_only", line: "Prefers mornings.", nextStep: { skipped: true } });
    const [t1] = await q(`SELECT closed_at FROM threads WHERE id=$1`, [th]);
    ok("§3 \"Skip the next step\" in a note leaves another open follow-up open (main marked it Done)",
       note.status < 300 && t1 && t1.closed_at == null, { status: note.status, closed: t1 && t1.closed_at });
    const call = await api("POST", `/donors/${id}/conversations`, tok, { touch: "call_reached", line: "We talked about the visit.", threadId: th, nextStep: { skipped: true } });
    const [t2] = await q(`SELECT closed_at, closing_interaction_id FROM threads WHERE id=$1`, [th]);
    ok("§3 a call logged on that follow-up, skipping the next step, closes that one follow-up on its line",
       call.status < 300 && t2 && !!t2.closed_at && t2.closing_interaction_id === call.body.interactionId, { status: call.status, t2 });
    ok("§3 the restored meeting step takes its thread's day back with it (meetingEffects.restoreSteps)",
       /restoreSteps[\s\S]{0,600}UPDATE threads SET due_date=\?/.test(read("meetingEffects.js")));
  }

  // ── §4 · WORDS, NOT CODE; NO RECEIPT FOR $0 ─────────────────────────────
  await wordsChecks({ ok });
  {
    const id = await person("Hollis Marrowby");
    const gid = `g_feel1_zero_${RUN}`;
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ($1,$2,$3,0,$4,'gift','system:test','test fixture')`, [gid, ORG, id, daysAgo(2)]);
    await q(`UPDATE orgs SET receipts_enabled=true WHERE id=$1`, [ORG]);   // receipts on, so only the $0 can refuse it
    const r = await api("POST", `/gifts/${gid}/receipt`, tok, {});
    const [{ n }] = await q(`SELECT COUNT(*)::int n FROM receipts WHERE gift_id=$1`, [gid]);
    ok("§4 a $0 gift makes no receipt (the server refuses, and nothing is written)", r.status === 409 && r.body.error === "zero_gift" && n === 0, { status: r.status, body: r.body, n });
  }

  summary();
  await closeDb();
})().catch(async e => { console.error(e); ok("the suite ran to the end", false, String(e && e.stack || e)); summary(); await closeDb(); });
