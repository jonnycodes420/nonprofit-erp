// BUILD-98 — A FACE IS ATTACHED TO THE PERSON, NOT TO ONE SCREEN.
//
// Reported from the real product: Grant Stidham's photograph appeared on his
// profile and nowhere else. The donor directory — the list she reads every
// day — showed a letter in a circle.
//
// The cause was not the photo pipeline, which was fine. It was that the
// directory rows never asked: they hand-rolled their own initials circle
// instead of rendering PersonMark, so the photo map that BUILD-94 fetches
// once per session had no way to reach them. Four such circles existed.
//
// The profile is the ONE screen where a face adds least — she already knows
// whose record she opened. Every other surface is where it earns its keep.
//
// Two things are pinned here:
//   1. no donor surface hand-rolls an initials avatar any more, and a new one
//      cannot be added without this suite noticing;
//   2. a donor who HAS a photo actually renders an <img> in the directory —
//      asserted in a browser, because that is the only place the original
//      defect was visible. Every server assertion about photos was green
//      while the list showed letters.
//
// Standard scratch stack (tests/README.md).

const fs = require("fs"), path = require("path");
const { BASE, ok, summary, login, api, q, closeDb } = require("./helpers");

const APP = process.env.APP_URL || "http://localhost:4173";
const PW = process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa");
const DIST = path.join(__dirname, "..", "client", "dist", "index.html");
const SRC = path.join(__dirname, "..", "client", "src");
const haveDeps = () => { try { require(path.join(PW, "node_modules", "playwright")); } catch { return false; } return fs.existsSync(DIST); };

// A 1x1 is not enough — the server resizes and re-encodes, so give it a real image.
async function realJpeg() {
  const sharp = require("sharp");
  return sharp({ create: { width: 400, height: 520, channels: 3, background: { r: 196, g: 122, b: 74 } } }).jpeg().toBuffer();
}

(async () => {
  console.log("build98-photos");

  // ── §1 · NO DONOR SURFACE HAND-ROLLS AN AVATAR ───────────────────────────
  // The guard that stops this coming back. Scoped to the files that render
  // DONOR rows: volunteers and board members live on their own tables with
  // their own id space, so a PersonMark there would resolve to nothing and
  // pretending otherwise would be worse than initials.
  console.log("\n— §1 · every donor avatar is a PersonMark —");
  const DONOR_SURFACES = ["components/Donors.jsx", "components/Dashboard.jsx", "components/Communications.jsx"];
  // `<div …>{d.name[0]}</div>` and friends — a circle built by hand out of a
  // person's first letter.
  //
  // `member` is deliberately NOT in this list. Donors.jsx renders one avatar
  // for an org TEAM MEMBER (`orgTeam.map(member => …)`), and a team member is
  // a USER: a different table and a different id space from the donor photo
  // map. A PersonMark there would resolve to nothing on every row, so it would
  // buy the appearance of consistency and none of the substance. The same
  // reasoning keeps Volunteers.jsx and Board.jsx out of DONOR_SURFACES —
  // `volunteers` and `board_members` are their own tables too.
  const HANDROLLED = /borderRadius:\s*"50%"[^}]*\}\}\s*>\s*\{\s*\(?\s*(?:d|donor|p|person|r|t)\b[^}]{0,40}\.name[^}]{0,30}\[0\]/;
  for (const f of DONOR_SURFACES) {
    const src = fs.readFileSync(path.join(SRC, f), "utf8");
    const hit = src.match(HANDROLLED);
    ok(`${f} renders no hand-rolled donor initials circle`, !hit, hit && hit[0].slice(0, 120));
  }
  // Proven able to fail: the exact shape this suite exists to catch.
  ok("the guard BITES on a hand-rolled donor circle",
    HANDROLLED.test('<div style={{width:32,height:32,borderRadius:"50%",background:x}}>{d.name[0]}</div>'), null);
  ok("…and does not fire on a PersonMark",
    !HANDROLLED.test('<PersonMark id={d.id} name={d.name} size={32}/>'), null);

  const donorsSrc = fs.readFileSync(path.join(SRC, "components/Donors.jsx"), "utf8");
  ok("the donor DIRECTORY rows render a PersonMark",
    /<PersonMark[^>]*id=\{d\.id\}/.test(donorsSrc), null);

  // The tint must colour the FALLBACK only — a photo tinted by pipeline stage
  // would be a photograph with a colour cast, which is not what was asked for.
  const sharedSrc = fs.readFileSync(path.join(SRC, "components/shared.jsx"), "utf8");
  const markFn = sharedSrc.slice(sharedSrc.indexOf("export function PersonMark("));
  const imgBranch = markFn.slice(markFn.indexOf("if (src && !broken)"), markFn.indexOf("return (\n    <div"));
  ok("PersonMark accepts a tint for the initials fallback", /tint, tintFg/.test(markFn), null);
  ok("…and the tint never touches the photo itself", !/tint/.test(imgBranch), imgBranch.slice(0, 160));

  // ── §2 · THE MAP IS REACHABLE WHERE THE APP RUNS ─────────────────────────
  // The BUILD-95 production defect: /person-photos was not proxied, so every
  // <img> received index.html and fell back to initials. The screen said "no
  // photo" when the truth was "this route is unreachable".
  console.log("\n— §2 · the signed path is proxied where the app is served —");
  const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "vercel.json"), "utf8"));
  const rw = (vercel.rewrites || []).find(r => String(r.source).startsWith("/person-photos"));
  ok("vercel.json proxies /person-photos to the API", !!rw, (vercel.rewrites || []).map(r => r.source));
  const preview = fs.readFileSync(path.join(__dirname, "..", "scripts", "local-preview.js"), "utf8");
  ok("the local preview DERIVES its rewrites from vercel.json rather than copying them",
    /vercel\.json/.test(preview) && /rewrites/.test(preview), null);

  // ── §3 · A DONOR WITH A PHOTO IS IN THE MAP ──────────────────────────────
  console.log("\n— §3 · a photographed donor reaches the map —");
  const tok = await login("admin@creoarts.org", "demo1234");
  const [target] = await q(`SELECT id, name FROM donors WHERE org_id='org_creo' AND deleted_at IS NULL ORDER BY id LIMIT 1`);
  ok("there is a donor to photograph", !!target, target);
  const up = await api("POST", `/donors/${target.id}/photo`, tok,
    { image: "data:image/jpeg;base64," + (await realJpeg()).toString("base64") });
  ok("the photo stores", up.status === 200, up.body);
  ok("…and the URL is the SIGNED, EXPIRING path, never a public one",
    /^\/person-photos\/pa_[a-f0-9]{24}\?e=\d+&s=[a-f0-9]{32}$/.test(up.body.photoUrl || ""), up.body.photoUrl);
  const map = await api("GET", "/people/photos", tok);
  ok("the photo map carries that donor", !!(map.body.photos || {})[target.id], Object.keys(map.body.photos || {}).length);
  ok("…and it serves", (await fetch(BASE + map.body.photos[target.id])).status === 200, null);

  // ── §4 · THE BROWSER: A FACE ON THE LIST ─────────────────────────────────
  // The assertion that would have caught the original report. Everything
  // above was green while the directory showed letters.
  console.log("\n— §4 · the browser: the directory shows her face —");
  if (!haveDeps()) {
    console.log("  SKIP — no Playwright or client/dist (browser leg)");
  } else {
    const { chromium } = require(path.join(PW, "node_modules", "playwright"));
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
    const fellBack = [];
    page.on("console", m => { if (/PersonMark/.test(m.text())) fellBack.push(m.text().slice(0, 140)); });
    const lr = await page.request.post(BASE + "/auth/login", { data: { email: "admin@creoarts.org", password: "demo1234" } });
    const lj = await lr.json();
    await page.goto(APP, { waitUntil: "domcontentloaded" });
    await page.evaluate(d => {
      localStorage.setItem("npe_token", d.token);
      localStorage.setItem("npe_user", JSON.stringify(d.user));
      localStorage.setItem("npe_org", JSON.stringify(d.org));
    }, lj);
    await page.goto(APP, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    const nav = page.locator('button:has-text("Donors")').first();
    await nav.click();
    await page.waitForTimeout(2500);

    const marks = await page.locator('[data-testid="person-mark"]').count();
    const photos = await page.locator('img[data-testid="person-mark"]').count();
    ok("the directory renders person marks at all", marks > 0, { marks });
    ok("…and AT LEAST ONE of them is a photograph, not a letter", photos > 0,
      { marks, photos, fellBack: fellBack.slice(0, 2) });
    // A fallback that fires here means the signed URL did not load — the exact
    // production defect. It must be silent on a healthy stack.
    ok("no mark fell back to initials because its photo failed to load",
      fellBack.length === 0, fellBack.slice(0, 3));
    await browser.close();
  }

  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
