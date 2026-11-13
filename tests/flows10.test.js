// tests/flows10.test.js — FLOWS-10. THE FIRST SCREEN AFTER AN ACTION, DEAD CLICKS, AND TWO FLOWS-8 REPEATS.
//
// One made-up org per run (no real name anywhere), one check per item:
//   §1/§9  a demo org's meeting is kept in Steward: Add saves it, a drag moves it, an invite says why not
//   §2     a failed person search says it failed, never "Nobody on file matches" (browser)
//   §3     an event's guests are the guest list's own count: cancelled rows are not "1 guest"
//   §4     stopping one person's journey skips what is left, never Done; Undo puts it back
//   §5     Brief me leads with the About note; the draft names one real fact, never filler
//   §6     Next shift counts the waiting list: "Waiting, #1, Sat clean-up"
//   §7     the Relationship box offers the stored type (program_officer), so it never reads Spouse
//   §8     the moves dialog sits above the top bar and Escape closes it (browser)
//   §10    every rail link navigates from a profile, Donors too (browser)
//   §11    the chapel photo's alt says what it shows, in both seeds
//   §12    Data health says "1 can't be read and is listed"
//   §13    a logo upload saves itself (browser)
//   §14    Billing's Records says why it differs from the Donors tab, and the people open
//   §15    an empty trash filter names its filter, never "Nobody matches" beside rows
//   §16    roles read Admin and Staff; the demo's EIN is not the placeholder
//
// HOW IT GOES RED (planted with FLOWS10_PLANT and TEST_MODE=1, see the PR):
//   demomeeting (§1/§9), allrows (§3), stopdone (§4), nowaitlist (§6), nogap (§14), nobodymatches (§15).
// The client items (§2, §5, §7, §8, §10, §12, §13, §16) are red against main's code.
"use strict";
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, api, q, login, closeDb, browserLegOrSkip, civilPlusDays } = require("./helpers");

const ROOT = path.join(__dirname, "..");
const APP = process.env.APP_URL || "http://localhost:4173";
const PW = path.join(process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa"), "node_modules", "playwright");
const { DIST } = require("./lib/dist");
const PASSWORD = "loadtest1234";
const read = p => fs.readFileSync(path.join(ROOT, p), "utf8");

(async () => {
  console.log("flows10 (FLOWS-10)");
  const run = require("crypto").randomBytes(4).toString("hex");
  const ORG = `org_flows10_${run}`, EMAIL = `owner-${run}@flows10.local`, ME = `u_flows10_${run}`;
  // A demonstration org, like Harborlight: its owner has a calendar connected.
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,emails_enabled,onboarded_at,org_kind)
           VALUES ($1,'Flows Ten Saltmarsh Arts',$1,1,'active','team','America/New_York',true,NOW(),'demo')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Rosamund Pell','admin')`, [ME, ORG, EMAIL, bcrypt.hashSync(PASSWORD, 4)]);
  await q(`INSERT INTO mailbox_connections (id,org_id,user_id,provider,address,status,calendar_granted) VALUES ($1,$2,$3,'google',$4,'active',true)`,
    [`mbx_flows10_${run}`, ORG, ME, `rosamund-${run}@flows10.invalid`]);
  const tok = await login(EMAIL, PASSWORD);
  const ids = {};
  const P = async (key, name, extra = {}) => {
    const r = await api("POST", "/donors", tok, { name, email: `${key}-${run}@flows10.invalid`, ...extra });
    if (!r.body || !r.body.id) throw new Error(`fixture ${name}: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
    return (ids[key] = r.body.id);
  };
  const gift = (id, amount, date) => api("POST", `/donors/${id}/gifts`, tok, { amount, date, payment_method: "check" });
  await P("odile", "Odile Marchetti", { about_them: "Sails with the Tuesday crew; her grandson Pip is in the clay class." });
  await gift(ids.odile, 240, civilPlusDays(-40));
  await P("caspar", "Caspar Fenwright");   // marked Donor, no gift
  await P("ysolde", "Ysolde Tarrant");
  await P("linnea", "Linnea Brack", { person_types: ["other"] });   // in a journey (§4)

  // ── §1/§9 a demo org's meeting is kept in Steward ─────────────────────────
  const at = h => new Date(`${civilPlusDays(3)}T${h}:00Z`).toISOString();
  const book = await api("POST", `/donors/${ids.odile}/book-visit`, tok, { startsAt: at("18:00"), endsAt: at("19:00"), title: "Coffee with Odile" });
  ok("§1 Add meeting in a demo org with a calendar connected saves it in Steward and says so",
    book.status === 201 && book.body.inSteward === true && /demonstration organization/.test(book.body.sentence || ""), { status: book.status, body: book.body });
  const rel = (await api("GET", `/donors/${ids.odile}/relationship`, tok)).body || {};
  ok("§1 the meeting is on her record straight after (Coming up)", (rel.upcoming || []).some(e => /Coffee with Odile/.test(e.title || "")), rel.upcoming);
  const calId = book.body && book.body.id;
  const moved = calId ? await api("POST", `/calendar/events/${calId}/move`, tok, { startsAt: at("19:00").replace(civilPlusDays(3), civilPlusDays(4)), endsAt: at("20:00").replace(civilPlusDays(3), civilPlusDays(4)) }) : { status: 0 };
  const [row] = calId ? await q(`SELECT LEFT(starts_at::text,10) AS d FROM calendar_events WHERE id=$1`, [calId]) : [{}];
  ok("§9 a drag to another day moves it and saves", moved.status === 200 && row && row.d === civilPlusDays(4), { status: moved.status, body: moved.body, d: row && row.d });
  const inv = await api("POST", `/donors/${ids.odile}/book-visit`, tok, { startsAt: at("20:00"), endsAt: at("21:00"), inviteDonor: true });
  ok("§1 asking to invite her in the demo says why not, in the dialog's words", inv.status === 409 && /nobody is invited/.test(inv.body.sentence || ""), inv.body);

  // ── §3 cancelled guests are not guests ───────────────────────────────────
  const ev = await api("POST", "/events", tok, { name: "Salt marsh supper", date: civilPlusDays(10), eventType: "other", capacity: 2 });
  const eventId = ev.body && (ev.body.id || (ev.body.event && ev.body.event.id));
  const add = await api("POST", `/events/${eventId}/attendees`, tok, { donorIds: [ids.ysolde] });
  const attId = add.body && add.body.ids && add.body.ids[0];
  await api("PATCH", `/events/${eventId}/attendees/${attId}`, tok, { status: "cancelled" });
  const rem = (await api("GET", `/events/${eventId}/removal`, tok)).body || {};
  ok("§3 after the only guest is removed (cancelled), the event has no guests, and its words say a cancelled registration, not \"1 guest\"",
    rem.holds && rem.holds.guests === 0 && rem.holds.cancelled === 1 && !/\b1 guest\b/.test(rem.sentence || "") && /cancelled or removed registration/.test(rem.sentence || ""), rem);

  // ── §4 Stop skips, never Done; Undo ──────────────────────────────────────
  const plan = `cp_flows10_${run}`, thr = `th_flows10_${run}`;
  await q(`INSERT INTO cultivation_plans (id,org_id,donor_id,template_id,template_name,status,applied_on,created_by,created_by_name)
           VALUES ($1,$2,$3,'ct_flows10','Birthday care','active',$4,'system:test','test')`, [plan, ORG, ids.linnea, civilPlusDays(-5)]);
  await q(`INSERT INTO threads (id,org_id,donor_id,next_step_label,next_step_type,due_date,opened_on,created_by,created_by_name)
           VALUES ($1,$2,$3,'Mail a birthday card','send',$4,$4,'system:test','test')`, [thr, ORG, ids.linnea, civilPlusDays(0)]);
  for (const [n, label, st, th] of [[1, "Mail a birthday card", "open", thr], [2, "Call to say happy birthday", "pending", null], [3, "Invite to the spring show", "pending", null]])
    await q(`INSERT INTO cultivation_plan_steps (id,org_id,plan_id,seq,step_type,label,due_date,status,thread_id) VALUES ($1,$2,$3,$4,'send',$5,$6,$7,$8)`,
      [`cps_flows10_${run}_${n}`, ORG, plan, n, label, civilPlusDays(n - 1), st, th]);
  const stop = await api("POST", `/plans/${plan}/stop`, tok, {});
  const steps = await q(`SELECT seq, status, skip_reason FROM cultivation_plan_steps WHERE plan_id=$1 ORDER BY seq`, [plan]);
  const doneTask = await q(`SELECT t.id FROM tasks t WHERE t.org_id=$1 AND t.thread_id=$2 AND COALESCE(t.done,0)=1`, [ORG, thr]);
  const openThr = await q(`SELECT id FROM threads WHERE id=$1 AND closed_at IS NOT NULL`, [thr]);
  ok("§4 Stop skips every step not done (\"Skipped, journey stopped\"), and no step reads Done",
    stop.status === 200 && steps.every(s => s.status === "skipped" && s.skip_reason === "Skipped, journey stopped") && doneTask.length === 0 && openThr.length === 0,
    { status: stop.status, steps, doneTask: doneTask.length, closedThread: openThr.length });
  const undo = await api("POST", `/plans/${plan}/stop/undo`, tok, {});
  const [p2] = await q(`SELECT status FROM cultivation_plans WHERE id=$1`, [plan]);
  const s2 = await q(`SELECT status FROM cultivation_plan_steps WHERE plan_id=$1 ORDER BY seq`, [plan]);
  ok("§4 Undo puts the journey back: running, and nothing skipped", undo.status === 200 && p2.status === "active" && !s2.some(s => s.status === "skipped"), { status: undo.status, plan: p2, steps: s2 });

  // ── §5 Brief me leads with the About note; the draft names a fact ────────
  const BC = require(path.join(ROOT, "server/donors/briefComplete"));
  const about = "Sails with the Tuesday crew; her grandson Pip is in the clay class.";
  const done = BC.completeBrief({ headline: "Odile gives steadily.", sections: [
    { key: "giving", title: "Giving", sentences: [{ text: "She gave $240 last month.", cites: [`person:${ids.odile}`] }] },
    { key: "notes", title: "What you wrote", sentences: [{ text: "The note reads: “" + about + "”", cites: [`note:${ids.odile}`] }] }] },
    { donor: { id: ids.odile, about_them: about }, quotes: new Map() });
  ok("§5 the brief's first section is the About note, wherever the model put it", JSON.stringify(done.sections[0]).includes("grandson Pip"), done.sections.map(s => s.key));
  const none = BC.completeBrief({ headline: "x", sections: [{ key: "giving", title: "Giving", sentences: [{ text: "She gave $240.", cites: [] }] }] }, { donor: { id: ids.odile, about_them: about }, quotes: new Map() });
  ok("§5 a brief that left it out gets it, first", JSON.stringify(none.sections[0]).includes("grandson Pip"), none.sections.map(s => s.key));
  const AM = require(path.join(ROOT, "routes/atlasMore"));
  const fact = typeof AM.oneFact !== "function" ? null : AM.oneFact({ d: { gift_count: 1, last_gift_amount: "240", last_gift_date: civilPlusDays(-40) }, conv: null });
  const AT = await import(path.join(ROOT, "shared/atlas.js"));
  const prompt = AT.buildDraftPrompt({ firstName: "Odile", words: "draft an email", facts: ["Giving on record: $240 across 1 gifts."] }).messages[0].content;   // main: no facts line
  ok("§5 the draft's template names one real fact (her gift) and the model is given the record's facts and told no filler",
    /^Thank you for your gift of \$240 on /.test(fact || "") && /Facts on their record/.test(prompt) && /Never open with filler/.test(AT.DRAFT_SYSTEM), { fact });

  // ── §6 Next shift counts the waiting list ────────────────────────────────
  const slot = `vs_flows10_${run}`, sat = (() => { for (let i = 1; i < 9; i++) { const d = civilPlusDays(i); if (new Date(d + "T12:00:00Z").getUTCDay() === 6) return d; } return civilPlusDays(7); })();
  await q(`INSERT INTO volunteer_opportunities (id,org_id,name,slug) VALUES ($1,$2,'Saltmarsh clean-up',$1)`, [`vo_flows10_${run}`, ORG]);
  await q(`INSERT INTO volunteer_slots (id,org_id,opportunity_id,name,date,start_time,end_time,capacity,created_by,created_by_name) VALUES ($1,$2,$4,'clean-up',$3,'09:00','12:00',1,'system:test','test')`, [slot, ORG, sat, `vo_flows10_${run}`]);
  await q(`UPDATE donors SET person_types='["volunteer"]'::jsonb WHERE id=$1`, [ids.ysolde]);
  await q(`INSERT INTO volunteer_signups (id,org_id,slot_id,person_id,status,position,created_by,created_by_name) VALUES ($1,$2,$3,$4,'waitlisted',1,'system:test','test')`, [`su_flows10_${run}`, ORG, slot, ids.ysolde]);
  const vl = (await api("GET", "/volunteer-hub/list?limit=2000", tok)).body || {};
  const ys = (vl.rows || []).find(r => r.id === ids.ysolde) || {};
  ok("§6 with no confirmed shift, Next shift says she is waiting: \"Waiting, #1, Sat clean-up\"", ys.nextShift === "Waiting, #1, Sat clean-up", ys);

  // ── §7 the Relationship box offers the stored type ───────────────────────
  const RO = await import(path.join(ROOT, "client/src/lib/relationshipOptions.js")).catch(() => ({ relationshipOptions: () => [], relationshipTypeLabel: () => "" }));
  const labels = [["spouse", "Spouse"], ["partner", "Partner"], ["household", "Household"], ["works_at", "Works at"]];
  const opts = RO.relationshipOptions(labels, "program_officer");
  ok("§7 a program-officer link opens with Program officer in the box (stored, offered, and so selected), never Spouse",
    opts.some(([v, l]) => v === "program_officer" && l === "Program officer") && opts[0][0] === "spouse" && RO.relationshipTypeLabel(labels, "program_officer") === "Program officer", opts);

  // ── §8 the moves dialog: the shared Modal, above the top bar, Escape closes it ─
  const ins = read("client/src/components/Insights.jsx");
  ok("§8 Home's See all and What your data says are the shared Modal (z-index above the top bar, Escape anywhere), not an overlay at z-index 60",
    !/role="dialog"[^>]*\n?[^>]*zIndex: 60/.test(ins) && !/zIndex: 60, overflowY: "auto"/.test(ins) && (ins.match(/<Modal\b/g) || []).length >= 2);

  // ── §11 the chapel photo's alt ───────────────────────────────────────────
  ok("§11 the Year-end chapel photo's alt says what it shows, in both seeds",
    !/A sunlit hall with tall windows/.test(read("scripts/seed/fix41-media.js") + read("scripts/seed/email1-demo.js"))
      && /A small chapel with a bell tower on a grassy hill at dusk/.test(read("scripts/seed/fix41-media.js")));

  // ── §12 Data health grammar ──────────────────────────────────────────────
  ok("§12 Data health says \"1 can't be read and is listed\", and many \"are\"", /=== 1 \? "1 can't be read and is"/.test(read("client/src/components/DataHealth.jsx")) && !/addressesUnreadable\} can't be read and are/.test(read("client/src/components/DataHealth.jsx")));

  // ── §14 Billing's records gap ────────────────────────────────────────────
  const bill = (await api("GET", "/billing/status", tok)).body || {};
  const gap = (bill.pricing1 || bill).recordsGap || bill.recordsGap || {};
  const [dir] = await q(`SELECT COUNT(*)::int AS n FROM donors d WHERE d.org_id=$1 AND d.deleted_at IS NULL AND d.erased_at IS NULL AND ${require(path.join(ROOT, "shared/personType.js")).donorOnlySql("d")}`, [ORG]);
  const records = (bill.pricing1 || bill).records;
  ok("§14 Billing says how many are marked Donor with no gift, the line foots to the Donors tab, and the people open",
    gap.markedNoGift >= 1 && /marked Donor but ha(s|ve) no gift on file/.test(gap.sentence || "") && gap.source && gap.source.key === "marked-donor-no-gift"
      && records + gap.markedNoGift - gap.giftNotMarked === dir.n, { gap, records, directory: dir.n });
  const rows = await api("GET", "/figures/marked-donor-no-gift/rows", tok);
  ok("§14 the figure opens the people behind it", rows.status === 200 && JSON.stringify(rows.body).includes("Caspar Fenwright"), { status: rows.status });

  // ── §15 the trash filter ─────────────────────────────────────────────────
  const tr = (await api("GET", "/donors/purge-trash/preview?olderThanDays=90", tok)).body || {};
  ok("§15 an empty filter names the filter, never \"Nobody matches\"; Empty trash starts at everything",
    !/Nobody in the trash matches/.test(tr.sentence || "") && /more than 90 days ago/.test(tr.sentence || "") && /useState\("all"\)/.test(read("client/src/components/settings/EmptyTrash.jsx")), tr);

  // ── §16 roles and the demo EIN ───────────────────────────────────────────
  const VO = await import(path.join(ROOT, "shared/viewOnly.js"));
  const PH = await import(path.join(ROOT, "shared/placeholderCopy.js"));
  const { DEMO_EIN } = await import(path.join(ROOT, "shared/demoEin.js")).catch(() => ({ DEMO_EIN: "00-0000000" }));
  ok("§16 Team says Admin and Staff, the Invite dialog's words, and \"member\" reads Staff", VO.roleWord("admin") === "Admin" && VO.roleWord("member") === "Staff" && VO.roleWord("staff") === "Staff");
  ok("§16 the demo seeds a made-up EIN in valid form that the receipts check accepts", /^\d{2}-\d{7}$/.test(DEMO_EIN) && !PH.isPlaceholderEin(DEMO_EIN)
    && /DEMO_EIN/.test(read("scripts/ci/seed-demo.js")) && !/ein=COALESCE\(ein,'00-0000000'\)/.test(read("scripts/ci/seed-demo.js")));

  // ── the browser: §2, §8, §10, §13 ────────────────────────────────────────
  const why = (() => {
    if (!fs.existsSync(path.join(DIST, "assets"))) return "client/dist not built";
    const apiHost = (process.env.BASE || "http://localhost:5601").replace(/^https?:\/\//, "");
    const js = fs.readdirSync(path.join(DIST, "assets")).filter(x => x.endsWith(".js"));
    if (!js.some(x => fs.readFileSync(path.join(DIST, "assets", x), "utf8").includes(apiHost))) return "client/dist not built against the local API";
    try { require(PW); } catch { return "Playwright not found (set PLAYWRIGHT_DIR)"; }
    return null;
  })();
  if (!browserLegOrSkip(why, "(browser legs)")) {
    const lg = await api("POST", "/auth/login", null, { email: EMAIL, password: PASSWORD });
    const { chromium } = require(PW);
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 720 } });
    await page.addInitScript(([tk, u, o]) => { localStorage.setItem("npe_token", tk); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
      [lg.body.token, JSON.stringify(lg.body.user), JSON.stringify(lg.body.org)]);
    const step = async (name, fn) => { try { await fn(); } catch (e) { ok(`${name} ran to the end on the screen`, false, String(e.message || e).split("\n").slice(0, 3).join(" | ")); } };

    await step("§2", async () => {
      await page.goto(`${APP}/app/events?eventId=${eventId}`, { waitUntil: "networkidle", timeout: 60000 });
      await page.getByRole("button", { name: "From Directory" }).click({ timeout: 15000 });
      await page.route(/\/donors\/pick\?q=Odile/, r => r.fulfill({ status: 503, contentType: "application/json", body: '{"error":"busy"}' }));
      await page.locator('[data-testid="ev-dir-search"]').fill("Odile");
      await page.waitForTimeout(1500);
      const failed = await page.locator('[data-testid="ev-dir-failed"]').count();
      const none = await page.locator('[data-testid="ev-dir-none"]').count();
      await page.unroute(/\/donors\/pick\?q=Odile/);
      ok("§2 a failed search says it did not answer, never \"Nobody on file matches\"", failed === 1 && none === 0, { failed, none });
    });

    await step("§10", async () => {
      await page.goto(`${APP}/donors/${ids.odile}`, { waitUntil: "networkidle", timeout: 60000 });
      const bad = [];
      for (const id of await page.locator("[data-nav-id]").evaluateAll(es => [...new Set(es.map(e => e.getAttribute("data-nav-id")))])) {
        await page.goto(`${APP}/donors/${ids.odile}`, { waitUntil: "domcontentloaded" });
        await page.locator(`[data-nav-id="${id}"]`).first().click({ timeout: 10000 });
        await page.waitForTimeout(700);
        if (new URL(page.url()).pathname === `/donors/${ids.odile}`) bad.push(id);
      }
      ok("§10 every rail link leaves the profile, Donors too", bad.length === 0, bad);
    });

    await step("§13", async () => {
      await page.goto(`${APP}/app/settings?section=org`, { waitUntil: "networkidle", timeout: 60000 });
      const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC", "base64");
      await page.locator('input[type="file"]').first().setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png });
      await page.waitForTimeout(1500);
      const [o] = await q(`SELECT logo_data IS NOT NULL AS has FROM orgs WHERE id=$1`, [ORG]);
      ok("§13 a logo upload saves itself: it is on the org without pressing Save branding", o && o.has === true, o);
    });
    await browser.close();
  }
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch {} process.exit(1); });
