// FIX-2 finding 11 — THE DONOR PROFILE'S "day 0" AND ITS RED.
//
// FIX-1's handoff §5: the profile said "day 0" on a step opened today, drew a
// stale last contact ("117d ago") in red, and drew the Lapsed pill in red. The
// four-colour rule: overdue is brass, not red; red is only for a destructive
// confirm. A lapsed donor is not a destructive confirm, and neither is a
// contact that is overdue.
//
//   §1 source (runs anywhere): the open-step line has a words-for-today
//      branch, moveUrgency's overdue colour is brass, and the header pill
//      does not paint Lapsed in terracotta
//   §2 browser (the stack): a fixture org with a donor whose step was opened
//      today and a lapsed donor last heard from 200 days ago; the profile
//      reads "opened today", never "day 0", and neither the stale contact nor
//      the Lapsed pill is terracotta (rgb(184, 89, 63)) in any part.

const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? " — " + String(JSON.stringify(extra)).slice(0, 600) : "")); }
};
const strip = t => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const TERRA = "rgb(184, 89, 63)";
const ORG = "org_fx2eprof", EMAIL = "fx2eprof@example.org", PW = "loadtest1234";

(async () => {
  console.log("fix2-e-profile");
  console.log("\n— §1 · the source —");
  const dp = strip(fs.readFileSync(path.join(root, "client/src/components/DonorProfile.jsx"), "utf8"));
  const sh = strip(fs.readFileSync(path.join(root, "client/src/components/shared.jsx"), "utf8"));
  const stepLine = (dp.match(/data-open-item[\s\S]{0,900}?daysOpen[^\n]*/) || [""])[0];
  ok("§1 the open-step line says a step opened today in words, not \"day 0\"",
     /daysOpen\s*(===|<)\s*[01]|daysOpen\s*>=?\s*[01]/.test(stepLine) && /opened today/.test(stepLine), stepLine.slice(-200));
  const urg = (sh.match(/export function moveUrgency[\s\S]*?\n\}/) || [""])[0];
  ok("§1 moveUrgency draws an overdue contact in brass, not terracotta",
     /critical:\s*T\.gold/.test(urg) && !/critical:\s*T\.terracotta/.test(urg), urg.slice(0, 400));
  const header = (dp.match(/donor-profile-header[\s\S]*?<DriftBadge/) || [""])[0];
  ok("§1 the header's stage pill has a brass case for Lapsed", /lapsed/.test(header) && /T\.gold/.test(header), header.slice(-400));

  console.log("\n— §2 · the profile, as drawn —");
  let chromium;
  try { ({ chromium } = require("playwright")); } catch { console.log("  SKIP  §2 browser: Playwright is not installed here (CI has none)"); return done(); }
  if (!process.env.APP_URL) { console.log("  SKIP  §2 browser: APP_URL is not set"); return done(); }
  const h = require("./helpers");
  const bcrypt = require("bcryptjs");
  const reset = async () => {
    for (const t of ["threads", "interactions", "gifts", "tasks", "donors", "fin_audit_log", "users"])
      await h.q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
    await h.q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  };
  await reset();
  await h.q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status) VALUES ($1,'Profile Fixture','fx2e-prof',1,'team','active')`, [ORG]);
  await h.q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_fx2eprof',$1,$2,$3,'Pia Prof','admin')`, [ORG, EMAIL, bcrypt.hashSync(PW, 4)]);
  const ago = n => h.civilPlusDays ? h.civilPlusDays(-n) : new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  // The stale one: lapsed, last heard from 200 days ago (past the lapsed
  // stage's 180-day line, so the contact is overdue).
  await h.q(`INSERT INTO donors (id,org_id,name,email,stage,status,total_giving,gift_count,last_gift_date)
             VALUES ('d_fx2e_stale',$1,'Lorna Lapsewell','lorna@example.org','lapsed','lapsed',500,1,$2)`, [ORG, ago(200)]);
  await h.q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ('g_fx2e_stale',$1,'d_fx2e_stale',500,$2,'cash','u_fx2eprof','Pia Prof')`, [ORG, ago(200)]);
  // The open one: a conversation logged today with a next step.
  await h.q(`INSERT INTO donors (id,org_id,name,email,stage,status,total_giving,gift_count,last_gift_date)
             VALUES ('d_fx2e_open',$1,'Otto Openshaw','otto@example.org','cultivate','active',250,1,$2)`, [ORG, ago(30)]);
  await h.q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ('g_fx2e_open',$1,'d_fx2e_open',250,$2,'cash','u_fx2eprof','Pia Prof')`, [ORG, ago(30)]);
  const tok = await h.login(EMAIL, PW);
  const cv = await h.api("POST", "/donors/d_fx2e_open/conversations", tok,
    { touch: "call_reached", line: "Talked about the spring visit.", nextStep: { type: "follow_up", label: "Send the visit dates", due: ago(-3) } });
  ok("§2 fixture: the conversation and its step were logged", cv.status === 200 || cv.status === 201, cv.body);

  const lr = await h.api("POST", "/auth/login", null, { email: EMAIL, password: PW });
  const browser = await chromium.launch();
  const shots = path.join(root, "docs/fix-2/E");
  fs.mkdirSync(shots, { recursive: true });
  for (const [w, hgt] of [[1440, 900], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width: w, height: hgt } });
    await page.addInitScript(([t, u, o]) => { localStorage.setItem("npe_token", t); localStorage.setItem("npe_user", u); localStorage.setItem("npe_org", o); },
      [lr.body.token, JSON.stringify(lr.body.user), JSON.stringify(lr.body.org)]);

    await page.goto(`${process.env.APP_URL}/donors/d_fx2e_open`, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-testid=dp-open-items]", { timeout: 15000 }).catch(() => {});
    const openText = await page.evaluate(() => (document.querySelector("[data-testid=dp-open-items]") || {}).innerText || "");
    ok(`§2 @${w} the open step is on the profile`, /Send the visit dates/.test(openText), openText.slice(0, 200));
    ok(`§2 @${w} a step opened today never reads "day 0"`, !/\bday\s*0\b/i.test(openText), openText.slice(0, 200));
    ok(`§2 @${w} …it reads "opened today"`, /opened today/i.test(openText), openText.slice(0, 200));
    ok(`§2 @${w} …and its due date reads as a date, not ISO`, !/\d{4}-\d{2}-\d{2}/.test(openText), openText.slice(0, 200));
    await page.screenshot({ path: path.join(shots, `${w}-profile-open-step.png`) });

    await page.goto(`${process.env.APP_URL}/donors/d_fx2e_stale`, { waitUntil: "networkidle" });
    await page.waitForSelector(".donor-stat-grid", { timeout: 15000 }).catch(() => {});
    const drawn = await page.evaluate(() => {
      const tile = [...document.querySelectorAll(".donor-stat-grid > div")].find(d => /contact/i.test(d.innerText));
      const val = tile && [...tile.querySelectorAll("div")].find(d => /\d+d ago/.test(d.innerText) && !d.querySelector("div"));
      const pill = [...document.querySelectorAll(".donor-profile-header span")].find(s => s.innerText.trim() === "Lapsed");
      const cs = el => el ? getComputedStyle(el) : null;
      return {
        contact: val ? val.innerText : null, contactColor: val ? cs(val).color : null,
        pill: !!pill, pillColor: pill ? cs(pill).color : null, pillBg: pill ? cs(pill).backgroundColor : null,
        pillBorder: pill ? cs(pill).borderTopColor : null,
      };
    });
    ok(`§2 @${w} the stale contact is on the tile`, /^\d+d ago$/.test(drawn.contact || ""), drawn);
    ok(`§2 @${w} a stale contact is not drawn in red`, drawn.contactColor && drawn.contactColor !== TERRA, drawn);
    ok(`§2 @${w} the Lapsed pill is on the header`, drawn.pill, drawn);
    ok(`§2 @${w} the Lapsed pill is not red (text, ground or edge)`,
       drawn.pill && ![drawn.pillColor, drawn.pillBg, drawn.pillBorder].some(c => String(c).startsWith("rgb(184, 89, 63") || String(c).startsWith("rgba(184, 89, 63")), drawn);
    await page.screenshot({ path: path.join(shots, `${w}-profile-lapsed-stale.png`) });
    await page.close();
  }
  await browser.close();
  await reset();
  await h.closeDb();
  done();
})().catch(e => { console.error(e); process.exit(1); });

function done() { console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }
