// BUILD-94 FIRST RUN — the greeting an organisation gets once.
//
// The property that matters most here is the one that is easy to get wrong in
// the other direction: a full-screen greeting that shows when it should not is
// a takeover in front of somebody trying to work. So:
//   · "already welcomed" is the DEFAULT — an existing user, and any row
//     inserted without thinking about it, is never greeted;
//   · a genuinely new signup IS greeted, exactly once;
//   · everything on it comes from the org's own record, never invented;
//   · seeing it stamps it, and the stamp is idempotent.
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "org_b94w";
const root = path.join(__dirname, "..");

async function fixture() {
  await q(`DELETE FROM users WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,mission,welcome_motif,welcome_words)
           VALUES ($1,'Welcome Arts','b94w',1,'active','team','An Hour of JOY for kids who need it most.','horse',
                   '["Recreation","Restoration","Education"]'::jsonb)
           ON CONFLICT (id) DO UPDATE SET mission=EXCLUDED.mission, welcome_motif='horse',
             welcome_words=EXCLUDED.welcome_words, subscription_status='active', plan='team'`, [ORG]);
  // Inserted WITHOUT naming welcomed_at — exactly what every other fixture in
  // this repo does, and the case that must not be greeted.
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_b94w',$1,'b94w@test.local',$2,'Allie Barnett','admin')`,
    [ORG, bcrypt.hashSync("loadtest1234", 10)]);
}

(async () => {
  await fixture();
  const tok = await login("b94w@test.local", "loadtest1234");

  console.log("— a fixture user is never greeted —");
  const w = await api("GET", "/org/welcome", tok);
  ok("the route answers", w.status === 200, w.body);
  ok("a user inserted without naming welcomed_at is ALREADY welcomed", w.body.show === false, w.body);

  console.log("— …and everything it would say is the org's own —");
  await q(`UPDATE users SET welcomed_at = NULL WHERE id='u_b94w'`);
  const w2 = await api("GET", "/org/welcome", tok);
  ok("now it shows", w2.body.show === true, w2.body);
  ok("her first name, from her own user row", w2.body.firstName === "Allie", w2.body.firstName);
  ok("the org's name", w2.body.orgName === "Welcome Arts", w2.body.orgName);
  ok("the org's mission, in the org's words", /An Hour of JOY/.test(w2.body.mission || ""), w2.body.mission);
  ok("the org's own words", JSON.stringify(w2.body.words) === JSON.stringify(["Recreation", "Restoration", "Education"]), w2.body.words);
  ok("and the motif it has", w2.body.motif === "horse", w2.body.motif);

  console.log("— once, and the stamp is idempotent —");
  const seen = await api("POST", "/org/welcome/seen", tok, {});
  ok("marking it seen succeeds", seen.status === 200);
  const [after] = await q(`SELECT welcomed_at FROM users WHERE id='u_b94w'`);
  ok("the stamp landed", after.welcomed_at != null);
  ok("it does not show again", (await api("GET", "/org/welcome", tok)).body.show === false);
  await api("POST", "/org/welcome/seen", tok, {});
  const [after2] = await q(`SELECT welcomed_at FROM users WHERE id='u_b94w'`);
  ok("a second call leaves the FIRST timestamp alone",
    String(after.welcomed_at) === String(after2.welcomed_at), [after.welcomed_at, after2.welcomed_at]);

  console.log("— an org with no motif still gets a greeting, just a plain one —");
  await q(`UPDATE orgs SET welcome_motif=NULL, welcome_words=NULL WHERE id=$1`, [ORG]);
  await q(`UPDATE users SET welcomed_at=NULL WHERE id='u_b94w'`);
  const w3 = await api("GET", "/org/welcome", tok);
  ok("it still shows", w3.body.show === true);
  ok("with no motif and no words", w3.body.motif === null && w3.body.words.length === 0, w3.body);

  console.log("— it stays inside the four colours —");
  const src = fs.readFileSync(path.join(root, "client/src/components/shared.jsx"), "utf8");
  const block = src.slice(src.indexOf("BUILD-94 FIRST RUN"));
  // No confetti and no second palette: the product's one celebration pattern
  // is a gold moment, and this is its larger sibling.
  const anims = [...new Set([...src.matchAll(/animation:(fr[A-Za-z]+)/g)].map(m => m[1]))].sort();
  ok("the greeting's animations are exactly the enumerated set — a confetti burst cannot arrive without changing this line",
    anims.join(",") === "frCross,frIn,frOut,frRise,frSheen", anims);
  ok("it uses tokens, not raw hex", !/#[0-9a-fA-F]{6}/.test(block.split("export function FirstRunWelcome")[1] || ""));
  ok("the motif is an SVG, never an emoji",
    /<path d=/.test(block) && !/[\u{1F300}-\u{1FAFF}]/u.test(block));
  const css = src.slice(src.indexOf("BUILD-94 FIRST RUN — the gold moment"));
  ok("every movement is off under prefers-reduced-motion",
    /prefers-reduced-motion: reduce\)\{[\s\S]{0,700}?\.fr-welcome[\s\S]{0,700}?animation:none/.test(css));
  ok("the motif crosses ONCE — a loop would make it a screensaver",
    /animation:frCross [^;]*1 backwards/.test(css) && !/frCross[^;]*infinite/.test(css));

  console.log("— and the signup path is the one thing that opts IN —");
  const srv = fs.readFileSync(path.join(root, "server.js"), "utf8");
  ok("register-org inserts welcomed_at NULL on purpose",
    /INSERT INTO users \(id, org_id, email, password_hash, name, role, welcomed_at\) VALUES \(\?,\?,\?,\?,\?,\?,NULL\)/.test(srv));
  const dbsrc = fs.readFileSync(path.join(root, "db.js"), "utf8");
  ok("the column defaults to NOW(), so nothing is greeted by accident",
    /welcomed_at TIMESTAMPTZ DEFAULT NOW\(\)/.test(dbsrc));

  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
