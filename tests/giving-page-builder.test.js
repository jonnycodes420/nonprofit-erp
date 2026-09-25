// BUILD-95 §5B — THE GIVING-PAGE BUILDER.
//
// The same widgets, the same renderer, the same draft/published rule the
// portal has had since BUILD-54. What this suite holds is the handful of
// properties that are NOT inherited, each of which would be silent if it broke:
//
//   · A DRAFT NEVER REACHES A DONOR. She rearranges at four in the afternoon;
//     the page a QR code opens is the one she published.
//   · THE SURFACE IS A FILTER AT BOTH ENDS. The server refuses a widget that
//     does not belong here, so a hand-rolled request cannot put a donor's own
//     giving history on a page a stranger opens from a flyer.
//   · THE FORM CANNOT BE LOST. It is not a widget; only its side of the page
//     is hers. A giving page that stopped taking gifts says nothing on screen.
//   · AN UNBUILT PAGE IS UNCHANGED. An org that never opens the builder must
//     see exactly what it saw before — that is what makes this safe to ship.
//   · AND THE RETENTION SWEEP READS EVERY PAGE, not just the portal's one row.
//     `portal_pages` is org-keyed and giving pages are many; a sweep that read
//     only the portal would soft-delete a photo a live giving page was showing
//     and make it permanent ninety days later.
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "org_gpb", ORG_B = "org_gpb2";

async function fixture() {
  for (const o of [ORG, ORG_B]) {
    for (const t of ["gifts", "peer_fundraisers", "giving_pages", "donors", "users", "fin_transactions", "budgets", "accounts", "fin_funds"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
  }
  for (const [id, slug, name] of [[ORG, "gpb", "Builder Arts"], [ORG_B, "gpb2", "Other Arts"]]) {
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone)
             VALUES ($1,$2,$3,1,'active','team','America/New_York')
             ON CONFLICT (id) DO UPDATE SET subscription_status='active', plan='team'`, [id, name, slug]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
             VALUES ($1,$2,$3,$4,'Allie Barnett','admin') ON CONFLICT (id) DO UPDATE SET org_id=EXCLUDED.org_id`,
      ["u_" + id, id, id + "@test.local", bcrypt.hashSync("loadtest1234", 10)]);
  }
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('ff_gpb',$1,'Barn Buddies',false)
           ON CONFLICT (id) DO NOTHING`, [ORG]);
}

(async () => {
  await fixture();
  const reg = await import("../shared/pageWidgets.js");
  const tok = await login(ORG + "@test.local", "loadtest1234");
  const tokB = await login(ORG_B + "@test.local", "loadtest1234");

  const made = await api("POST", "/giving-pages", tok, { title: "Sponsor a horse", slug: "sponsor", story: "The old story." });
  const PAGE = made.body?.id || made.body?.page?.id;
  ok("a giving page exists", !!PAGE, made.body);

  console.log("— it starts UNBUILT, and that is not an error —");
  const fresh = await api("GET", `/giving-pages/${PAGE}/page`, tok);
  ok("no draft, no published", fresh.status === 200 && fresh.body.draft === null && fresh.body.published === null, fresh.body);
  ok("the form already has a side of the page", reg.FORM_POSITIONS.includes(fresh.body.formPosition), fresh.body.formPosition);
  ok("…and the palette it offers is the GIVE surface, from the one registry",
    JSON.stringify(fresh.body.widgetTypes) === JSON.stringify(reg.typesForSurface("give")), fresh.body.widgetTypes);

  console.log("— AN UNBUILT PAGE RENDERS EXACTLY AS IT DID BEFORE —");
  const pub0 = await api("GET", "/org/gpb/giving-page/sponsor/public", null);
  ok("the public payload says the page is unbuilt", pub0.status === 200 && pub0.body.givingPage.page === null, pub0.body.givingPage?.page);
  ok("…and still carries its title, story and goal", pub0.body.givingPage.title === "Sponsor a horse" && pub0.body.givingPage.story === "The old story.");

  console.log("— the draft saves, and the surface filters at the SERVER —");
  const widgets = [
    { type: "hero", heading: "Meet the herd", sub: "An hour of joy", size: "tall" },
    { type: "richtext", blocks: [{ type: "p", text: "Barn Buddies pairs a child with a horse." }] },
    { type: "funds", heading: "Where you can give", fundIds: ["ff_gpb"] },
  ];
  const d1 = await api("PUT", `/giving-pages/${PAGE}/page/draft`, tok, { widgets, formPosition: "bottom" });
  ok("it saves", d1.status === 200, d1.body);
  ok("…and answers in the SAME shape the portal's route does (`draft`), because it is one editor",
    Array.isArray(d1.body.draft) && !("widgets" in d1.body), Object.keys(d1.body));
  ok("…and mints stable widget ids", d1.body.draft.every(w => /^wid_[a-f0-9]{8}$/.test(w.id)), d1.body.draft.map(w => w.id));
  ok("…and keeps the side of the page she chose", d1.body.formPosition === "bottom", d1.body.formPosition);

  for (const wrong of ["mygiving", "give"]) {
    const bad = await api("PUT", `/giving-pages/${PAGE}/page/draft`, tok, { widgets: [...widgets, { type: wrong }] });
    ok(`a "${wrong}" widget is REFUSED here, naming it`,
      bad.status === 400 && bad.body.error === "wrong_surface" && bad.body.message.includes(wrong), bad.body);
  }
  const still = await api("GET", `/giving-pages/${PAGE}/page`, tok);
  ok("…and the refusal left the good draft alone", still.body.draft.length === 3, still.body.draft?.length);

  console.log("— A DRAFT NEVER REACHES A DONOR —");
  const pub1 = await api("GET", "/org/gpb/giving-page/sponsor/public", null);
  ok("the saved draft is invisible publicly", pub1.body.givingPage.page === null, pub1.body.givingPage.page);

  console.log("— publishing is the act that makes it public —");
  const pubd = await api("POST", `/giving-pages/${PAGE}/page/publish`, tok);
  ok("it publishes", pubd.status === 200, pubd.body);
  const pub2 = await api("GET", "/org/gpb/giving-page/sponsor/public", null);
  ok("now a donor sees the built page", Array.isArray(pub2.body.givingPage.page) && pub2.body.givingPage.page.length === 3, pub2.body.givingPage.page);
  ok("…with the form on the side she chose", pub2.body.givingPage.formPosition === "bottom");
  ok("…and the funds widget RESOLVED through the one pipeline, with real fund names",
    pub2.body.givingPage.page.find(w => w.type === "funds")?.funds?.[0]?.name === "Barn Buddies",
    pub2.body.givingPage.page.find(w => w.type === "funds")?.funds);

  console.log("— and an edit AFTER publishing is still hers alone until she says —");
  await api("PUT", `/giving-pages/${PAGE}/page/draft`, tok, { widgets: widgets.slice(0, 1), formPosition: "top" });
  const pub3 = await api("GET", "/org/gpb/giving-page/sponsor/public", null);
  ok("the published page has not moved", pub3.body.givingPage.page.length === 3, pub3.body.givingPage.page.length);
  const rev = await api("POST", `/giving-pages/${PAGE}/page/revert`, tok);
  ok("revert puts the published page back into the draft",
    rev.status === 200 && (await api("GET", `/giving-pages/${PAGE}/page`, tok)).body.draft.length === 3);

  console.log("— publishing nothing is refused, rather than publishing an empty page —");
  const empty = await api("POST", "/giving-pages", tok, { title: "Empty", slug: "empty" });
  const emptyId = empty.body?.id || empty.body?.page?.id;
  ok("nothing to publish is a 400",
    (await api("POST", `/giving-pages/${emptyId}/page/publish`, tok)).status === 400);

  console.log("— THE FORM IS NOT A WIDGET, so it cannot be deleted —");
  ok("there is no form widget in the registry", !reg.typesForSurface("give").includes("form"));
  const noWidgets = await api("PUT", `/giving-pages/${PAGE}/page/draft`, tok, { widgets: [], formPosition: "top" });
  ok("a page with NO widgets still saves — the form is what makes it a giving page",
    noWidgets.status === 200, noWidgets.body);
  await api("PUT", `/giving-pages/${PAGE}/page/draft`, tok, { widgets, formPosition: "bottom" });

  console.log("— the tenant wall —");
  for (const [verb, path, body] of [
    ["GET", `/giving-pages/${PAGE}/page`, null],
    ["PUT", `/giving-pages/${PAGE}/page/draft`, { widgets: [] }],
    ["POST", `/giving-pages/${PAGE}/page/publish`, {}],
    ["POST", `/giving-pages/${PAGE}/page/revert`, {}],
  ]) {
    const r = await api(verb, path, tokB, body);
    ok(`org B gets 404 on ${verb} ${path.replace(PAGE, ":id")}`, r.status === 404, r.status);
  }
  const untouched = await api("GET", `/giving-pages/${PAGE}/page`, tok);
  ok("…and org A's page is untouched by every one of those", untouched.body.draft.length === 3);

  console.log("— THE RETENTION SWEEP READS EVERY PAGE OF THE ORG —");
  // The survey's own finding: portal_pages is org-keyed, giving pages are many.
  const fs = require("fs");
  const src = fs.readFileSync(require("path").join(__dirname, "..", "server.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const sweep = src.slice(src.indexOf("async function pruneWidgetAssets"), src.indexOf("async function pruneWidgetAssets") + 900);
  ok("it reads giving_pages, not only portal_pages",
    /FROM giving_pages WHERE org_id/.test(sweep) && /FROM portal_pages WHERE org_id/.test(sweep), sweep.slice(0, 300));

  console.log("— and both surfaces resolve through ONE pipeline —");
  ok("there is exactly one widget resolver",
    (src.match(/async function resolveWidgetsPublic/g) || []).length === 1);
  ok("…and the portal page calls it rather than keeping its own loop",
    /resolvePortalPagePublic[\s\S]{0,400}resolveWidgetsPublic\(org, widgets\)/.test(src));

  // ── THE BROWSER LEG ──────────────────────────────────────────────────────
  // Everything above passed while the page was rendering an error boundary,
  // and then while it read as two pages glued together. These four are what
  // LOOKING at it found, and no server assertion could have.
  const path = require("path");
  // BUILD-96 Part 6 — DEFAULT TO ~/steward-qa, like the other 22 browser
  // suites. With no default, an unset PLAYWRIGHT_DIR resolved to
  // `node_modules/playwright` relative to nothing, so this leg SKIPPED in every
  // plain `bash tests/run-all.sh` — a silent skip inside a green suite inside a
  // green battery, which is the shape that makes a battery worth nothing. The
  // four things this leg checks are the ones the brief says only LOOKING found.
  const PW_DIR = process.env.PLAYWRIGHT_DIR || path.join(process.env.HOME || "", "steward-qa");
  let chromium = null;
  try { chromium = require(path.join(PW_DIR, "node_modules/playwright")).chromium; } catch { /* not installed */ }
  // APP_URL, NEVER A LITERAL PORT — the BUILD-92 B2 rule, which every other
  // browser suite already follows and this one did not. A machine running a
  // second checkout of this repo has a preview on :4173 serving a DIFFERENT
  // stack, so the hardcoded port found a live page, declined to skip, and drove
  // the wrong app: both assertions failed with "Page not found" while the
  // product was fine. A false red is worse than a skip, because somebody spends
  // an hour on it (BUILD-100 paid that hour).
  const PREVIEW = (process.env.APP_URL || "http://localhost:4173").replace(/\/+$/, "");
  let previewUp = false;
  try { previewUp = (await fetch(PREVIEW + "/give/gpb/sponsor")).ok; } catch { /* not served */ }

  if (!chromium || !previewUp) {
    console.log(`— browser leg SKIPPED (playwright at ${PW_DIR}: ${chromium ? "found" : "MISSING"}; preview on ${PREVIEW}: ${previewUp ? "up" : "DOWN"}) —`);
  } else {
    console.log("— and it reads as ONE page in a browser —");
    await api("PUT", `/giving-pages/${PAGE}/page/draft`, tok, { widgets, formPosition: "bottom" });
    await api("POST", `/giving-pages/${PAGE}/page/publish`, tok);
    const b = await chromium.launch();
    const look = async () => {
      const pg = await b.newPage({ viewport: { width: 1280, height: 1400 } });
      const errs = []; pg.on("pageerror", e => errs.push(String(e)));
      await pg.goto(PREVIEW + "/give/gpb/sponsor", { waitUntil: "networkidle" });
      await pg.waitForTimeout(700);
      const txt = await pg.innerText("body");
      const box = sel => pg.locator(sel).first().boundingBox();
      return { pg, errs, txt, box };
    };

    let v = await look();
    // The TDZ class, third appearance in this repo — the page rendered its
    // error boundary while every server assertion above was green.
    ok("the page throws nothing", v.errs.length === 0, v.errs);
    ok("the widgets she built are drawn", (await v.pg.locator(".pt-widgets > div").count()) === 3);
    ok("the hero LEADS — a page must not open on a bare $0",
      v.txt.indexOf("Meet the herd") < v.txt.indexOf("Start your own fundraiser"), v.txt.slice(0, 120));
    // A built page IS the title. Rendering the record's title above the hero
    // she wrote is the builder arguing with the record it was built from.
    ok("…and the old title and story are NOT repeated above it",
      !v.txt.includes("The old story.") && !v.txt.includes("Sponsor a horse"), v.txt.slice(0, 200));
    const wb = await v.box(".pt-widgets"), fb = await v.box("form");
    ok("ONE column — the story and the form are the same width",
      Math.abs(wb.width - fb.width) < 2, [wb.width, fb.width]);
    ok("the story leads and the form follows it", wb.y < fb.y, [wb.y, fb.y]);
    await v.pg.close();

    console.log("— …and the other side of the page is the other side —");
    await api("PUT", `/giving-pages/${PAGE}/page/draft`, tok, { widgets, formPosition: "top" });
    await api("POST", `/giving-pages/${PAGE}/page/publish`, tok);
    v = await look();
    const wb2 = await v.box(".pt-widgets"), fb2 = await v.box("form");
    ok("the form leads and the story follows it", fb2.y < wb2.y, [fb2.y, wb2.y]);
    ok("…and the widgets are still all there", (await v.pg.locator(".pt-widgets > div").count()) === 3);
    await v.pg.close();

    console.log("— ONE EDITOR, and it says which page it is arranging —");
    // Four things the editor got wrong until somebody LOOKED at it: it called
    // itself the Portal editor, it badged SAMPLE DONOR DATA on a page with no
    // donor data at all, the form control vanished the moment she had widgets,
    // and the form itself — the one thing that cannot be removed — was absent
    // from the preview she was arranging around.
    const ed = await b.newPage({ viewport: { width: 1440, height: 1000 } });
    const edErrs = []; ed.on("pageerror", e => edErrs.push(String(e).slice(0, 200)));
    await ed.goto(PREVIEW + "/login");
    await ed.evaluate(d => {
      localStorage.setItem("npe_token", d.token);
      localStorage.setItem("npe_user", JSON.stringify(d.user));
      localStorage.setItem("npe_org", JSON.stringify(d.org));
    }, await (await fetch(process.env.BASE + "/auth/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: ORG + "@test.local", password: "loadtest1234" }) })).json());
    await ed.goto(`${PREVIEW}/portal-editor?page=${PAGE}`, { waitUntil: "networkidle" });
    await ed.waitForTimeout(1200);
    const et = await ed.innerText("body");

    ok("the editor opens on the giving page", edErrs.length === 0 && !et.includes("Something went wrong"), edErrs);
    ok("it calls itself a Giving page, not the Portal editor",
      et.includes("Giving page") && !et.includes("Portal editor"), et.slice(0, 80));
    ok("…and names WHICH page", et.includes("Sponsor a horse"));
    ok("…and does not badge SAMPLE DONOR DATA on a page that has no donor data",
      !et.toUpperCase().includes("SAMPLE DONOR DATA"));
    ok("her widgets are there with their chrome", (await ed.locator(".pt-widgets > div").count()) === 3);
    ok("THE FORM IS IN THE PREVIEW — she is arranging around something she can see",
      et.toUpperCase().includes("THE DONATION FORM"));
    ok("…and the control that moves it is in the CHROME, not inside the phone",
      (await ed.locator('select[aria-label="Where the donation form sits"]').count()) === 1);

    await ed.locator("button", { hasText: "+ Add widget" }).first().click();
    await ed.waitForTimeout(400);
    const palette = ed.locator("text=Add a widget").locator("xpath=../..");
    const lib = await palette.innerText();
    for (const gone of ["My Giving", "Give button"])
      ok(`the palette does not offer "${gone}" here`, !lib.includes(gone), lib.slice(0, 160));
    for (const there of ["Hero", "Programs & funds", "FAQ", "Video"])
      ok(`…and does offer "${there}"`, lib.includes(there), lib.slice(0, 160));
    ok("…and offers EXACTLY the give surface, no more and no fewer",
      (await palette.locator("button").count()) === reg.typesForSurface("give").length + 1,
      await palette.locator("button").count());

    await ed.close();
    await b.close();
  }

  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
