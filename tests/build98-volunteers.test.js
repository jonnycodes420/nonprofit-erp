// BUILD-98 (switch) Part 5 — VOLUNTEERS AND HOURS.
//
//   §1  fifty hours across ten shifts total exactly fifty (hundredths, never
//       floats), and a shift longer than a day is refused;
//   §2  a volunteer who gives is ONE record carrying both roles;
//   §3  the volunteer's own link: the page is a GET that changes nothing, the
//       form logs the shift, a tampered or expired link is refused;
//   §4  a Wranglr / VolunteerHub export imports once — the second time adds
//       nothing — and every refused row says why;
//   §5  volunteer-to-donor conversion is a saved report, and hours are a
//       column in the builder;
//   §6  another org can touch none of it.
//
// Standard scratch stack (tests/README.md).

const bcrypt = require("bcryptjs");
const fs = require("fs"), path = require("path");
const APP = process.env.APP_URL || "http://localhost:4173";
const PW_DIR = process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa");
const haveBrowser = () => { try { require(path.join(PW_DIR, "node_modules", "playwright")); } catch { return false; }
  return fs.existsSync(path.join(__dirname, "..", "client", "dist", "index.html")); };
const { BASE, ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "org_b98v", OTHER = "org_b98v2";
const PW = "loadtest1234";

async function reset() {
  for (const o of [ORG, OTHER]) {
    for (const t of ["volunteer_shifts", "saved_reports", "thank_you_drafts", "threads", "tasks", "workflow_runs", "fin_transactions",
                     "interactions", "gifts", "donors", "users", "budgets", "accounts", "fin_funds"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}

(async () => {
  console.log("build98-volunteers");
  await reset();
  for (const [id, name] of [[ORG, "Barn Helpers"], [OTHER, "Somebody Else"]])
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,receipt_address) VALUES ($1,$2,$3,1,'team','active','1 Main St, Lexington, KY 40507')`,
      [id, name, id.replace(/_/g, "-")]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_b98v',$1,'b98v@example.org',$2,'Allie Barnett','admin')`, [ORG, bcrypt.hashSync(PW, 4)]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_b98v2',$1,'b98v-o@example.org',$2,'Other','admin')`, [OTHER, bcrypt.hashSync(PW, 4)]);
  await q(`INSERT INTO donors (id,org_id,name,email,stage,person_types,total_giving,gift_count) VALUES ('v98_ann',$1,'Annie Helper','annie@example.org','prospect','["volunteer"]'::jsonb,0,0)`, [ORG]);
  const tok = await login("b98v@example.org"), tok2 = await login("b98v-o@example.org");

  // ── §1 fifty hours ───────────────────────────────────────────────────────
  const hours = [4, 6, 5.5, 4.5, 5, 5, 3.25, 6.75, 5, 5];   // = 50.00
  for (const [i, h] of hours.entries())
    await api("POST", "/donors/v98_ann/volunteer-hours", tok, { date: `2026-0${1 + (i % 9)}-1${i % 9}`, hours: h, role: i % 2 ? "Barn crew" : "Lessons" });
  const s1 = await api("GET", "/donors/v98_ann/volunteer-hours", tok);
  ok("§1 ten shifts", s1.body.shiftCount === 10, s1.body);
  ok("§1 total EXACTLY fifty hours", s1.body.totalHours === 50 && s1.body.hundredths === 5000, s1.body.totalHours);
  ok("§1 the total carries its sentence", /Every shift logged/.test(s1.body.sentence || ""));
  const tooLong = await api("POST", "/donors/v98_ann/volunteer-hours", tok, { date: "2026-02-01", hours: 40 });
  ok("§1 a 40-hour 'shift' is refused", tooLong.status === 400 && /24 hours/.test(tooLong.body.error || ""));
  const zero = await api("POST", "/donors/v98_ann/volunteer-hours", tok, { date: "2026-02-01", hours: 0 });
  ok("§1 zero hours is refused", zero.status === 400);

  // ── §2 one record, two roles ─────────────────────────────────────────────
  await api("POST", "/donors/v98_ann/gifts", tok, { amount: 40, date: "2026-03-01", idempotencyKey: "b98v-gift" });
  const [ann] = await q(`SELECT person_types, total_giving FROM donors WHERE id='v98_ann'`);
  ok("§2 a volunteer who gives is a donor too", (ann.person_types || []).includes("donor") && (ann.person_types || []).includes("volunteer"), ann.person_types);
  const [cnt] = await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1 AND LOWER(email)='annie@example.org'`, [ORG]);
  ok("§2 …on ONE record, never a second row", cnt.n === 1);
  await q(`INSERT INTO donors (id,org_id,name,email,stage,person_types,total_giving,gift_count) VALUES ('v98_don',$1,'Dee Donor','dee@example.org','steward','["donor"]'::jsonb,100,1)`, [ORG]);
  await api("POST", "/donors/v98_don/volunteer-hours", tok, { date: "2026-04-02", hours: 2 });
  const [dee] = await q(`SELECT person_types FROM donors WHERE id='v98_don'`);
  ok("§2 a donor who volunteers is a volunteer too", (dee.person_types || []).includes("volunteer") && (dee.person_types || []).includes("donor"), dee.person_types);

  // ── §3 the volunteer's own link ──────────────────────────────────────────
  const link = await api("POST", "/donors/v98_ann/volunteer-link", tok);
  ok("§3 staff get a link, and are told Steward will not send it", /\/volunteer\/log\?token=/.test(link.body.url || "") && /does not send it/.test(link.body.sentence || ""));
  const token = decodeURIComponent((link.body.url || "").split("token=")[1] || "");
  const before = (await q(`SELECT COUNT(*)::int AS n FROM volunteer_shifts WHERE org_id=$1`, [ORG]))[0].n;
  const page = await fetch(`${BASE}/volunteer/log?token=${encodeURIComponent(token)}`);
  const html = await page.text();
  const after = (await q(`SELECT COUNT(*)::int AS n FROM volunteer_shifts WHERE org_id=$1`, [ORG]))[0].n;
  ok("§3 the page greets them by first name and names the org", page.status === 200 && html.includes("Thank you, Annie") && html.includes("Barn Helpers"));
  ok("§3 …and a GET changes nothing", before === after);
  const post = await fetch(`${BASE}/volunteer/log`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token, date: "2026-05-05", hours: "3", role: "Feed round" }).toString() });
  const postHtml = await post.text();
  ok("§3 the form logs the shift", post.status === 200 && /3 hours logged/.test(postHtml) && /53 in all/.test(postHtml), postHtml.slice(0, 200));
  const [self] = await q(`SELECT via, role FROM volunteer_shifts WHERE org_id=$1 AND date='2026-05-05'`, [ORG]);
  ok("§3 …marked as logged by the volunteer", self && self.via === "self" && self.role === "Feed round");
  const bad = await fetch(`${BASE}/volunteer/log?token=${encodeURIComponent(token.slice(0, -3) + "abc")}`);
  ok("§3 a tampered link is refused", bad.status === 404);
  const forged = token.split(".")[0].length ? Buffer.from(Buffer.from(token.split(".")[0], "base64url").toString().replace("v98_ann", "v98_don")).toString("base64url") + "." + token.split(".")[1] : "";
  ok("§3 …and cannot be pointed at somebody else", (await fetch(`${BASE}/volunteer/log?token=${encodeURIComponent(forged)}`)).status === 404);

  // ── §4 imports ───────────────────────────────────────────────────────────
  const VH = await import("../shared/volunteerHours.js");
  const headers = ["Volunteer Name", "Email", "Shift Date", "Shift Name", "Hours Worked"];
  ok("§4 a Wranglr export is recognised", VH.detectHoursPreset(headers) === "wranglr");
  ok("§4 a VolunteerHub export is recognised", VH.detectHoursPreset(["First Name", "Last Name", "Email", "Event Date", "Event Name", "Hours Served"]) === "volunteerhub");
  const map = VH.mapHoursColumns(headers, "wranglr");
  const rows = [
    { "Volunteer Name": "Annie Helper", Email: "annie@example.org", "Shift Date": "6/1/2026", "Shift Name": "Barn crew", "Hours Worked": "2" },
    { "Volunteer Name": "New Person", Email: "newbie@example.org", "Shift Date": "2026-06-02", "Shift Name": "Lessons", "Hours Worked": "3.5" },
    { "Volunteer Name": "", Email: "", "Shift Date": "2026-06-02", "Shift Name": "x", "Hours Worked": "1" },
    { "Volunteer Name": "Too Long", Email: "long@example.org", "Shift Date": "2026-06-02", "Shift Name": "x", "Hours Worked": "30" },
  ];
  const parsed = VH.rowsToShifts(rows, map);
  ok("§4 the preset reads two good rows and names two refusals by line", parsed.shifts.length === 2 && parsed.refused.length === 2 && parsed.refused[0].line === 4, parsed.refused);
  ok("§4 …and each shift carries the hours the server re-checks", parsed.shifts.every(x => x.hours > 0 && Math.round(x.hours * 100) === x.hundredths));
  const imp1 = await api("POST", "/volunteer-hours/import", tok, { shifts: parsed.shifts });
  ok("§4 the import writes both", imp1.body.imported === 2 && imp1.body.peopleCreated === 1, imp1.body);
  const imp2 = await api("POST", "/volunteer-hours/import", tok, { shifts: parsed.shifts });
  ok("§4 importing the same export again adds NOTHING", imp2.body.imported === 0 && imp2.body.alreadyThere === 2 && imp2.body.peopleCreated === 0, imp2.body);
  const [newbie] = await q(`SELECT person_types FROM donors WHERE org_id=$1 AND email='newbie@example.org'`, [ORG]);
  ok("§4 a new person from an hours file is a Volunteer, not a donor", JSON.stringify(newbie.person_types) === '["volunteer"]', newbie.person_types);

  // ── §5 the conversion report ─────────────────────────────────────────────
  const conv = await api("GET", "/saved-reports/std:volunteers-who-give/run", tok);
  const names = (conv.body.rows || []).map(r => r.c0).sort();
  ok("§5 'Volunteers who give' lists exactly the two who do both", JSON.stringify(names) === JSON.stringify(["Annie Helper", "Dee Donor"]), conv.body);
  const hrs = await api("POST", "/report-builder/run", tok, { definition: { entity: "people", columns: ["name", "volunteer_hours"],
    filter: { op: "and", rules: [{ field: "volunteer_hours", cmp: "gte", value: 50 }] } } });
  ok("§5 hours are a column and a filter in the builder", (hrs.body.rows || []).length === 1 && hrs.body.rows[0].c0 === "Annie Helper" && Number(hrs.body.rows[0].c1) === 55, hrs.body);

  // ── §6 the wall ──────────────────────────────────────────────────────────
  ok("§6 another org cannot read the hours", (await api("GET", "/donors/v98_ann/volunteer-hours", tok2)).status === 404);
  ok("§6 …or log them", (await api("POST", "/donors/v98_ann/volunteer-hours", tok2, { date: "2026-01-01", hours: 1 })).status === 404);
  ok("§6 …or mint a link", (await api("POST", "/donors/v98_ann/volunteer-link", tok2)).status === 404);
  const [sh] = await q(`SELECT id FROM volunteer_shifts WHERE org_id=$1 LIMIT 1`, [ORG]);
  ok("§6 …or delete a shift", (await api("DELETE", `/volunteer-shifts/${sh.id}`, tok2)).status === 404);

  // ── §7 the screen ────────────────────────────────────────────────────────
  if (!haveBrowser()) console.log("  SKIP — no Playwright or client/dist (browser leg)");
  else {
    const { chromium } = require(path.join(PW_DIR, "node_modules", "playwright"));
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errs = []; page.on("pageerror", e => errs.push(e.message));
    page.on("console", m => { if (m.type() === "error" && /ErrorBoundary/.test(m.text())) errs.push(m.text()); });
    const lj = await (await page.request.post(BASE + "/auth/login", { data: { email: "b98v@example.org", password: PW } })).json();
    await page.goto(APP, { waitUntil: "domcontentloaded" });
    await page.evaluate(d => { localStorage.setItem("npe_token", d.token); localStorage.setItem("npe_user", JSON.stringify(d.user)); localStorage.setItem("npe_org", JSON.stringify(d.org)); }, lj);
    await page.goto(`${APP}/donors/v98_ann`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    const total = await page.locator('[data-testid="volunteer-total"]').innerText().catch(() => "");
    ok("§7 the profile shows her hours and shifts", /55\s*hours across 12 shifts/.test(total.replace(/\n/g, " ")), total);
    ok("§7 …with the sentence that says what they count", /Every shift logged/.test(await page.locator('[data-testid="volunteer-total"]').getAttribute("title").catch(() => "") || ""));
    ok("§7 with no page errors", errs.length === 0, errs);
    await browser.close();
  }

  await reset();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
