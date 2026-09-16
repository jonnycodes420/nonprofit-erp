// BUILD-86 Part B — the DEMO ORG'S OWN WORDS.
//
// "The demo org gets a vocabulary that is deliberately not the default, so a
// demo never shows generic words." These are Heart of Africa's, from the brief:
// sponsors, designations named for church partners, a spring campaign closing
// 30 June. Adjust after Thursday if Henderson says something else — that is a
// settings screen, not a rebuild.
//
//   BASE=http://localhost:5601 node scripts/seed-build86-vocabulary.js
// Writes through the API; prodGuard decides the target (script-guards class:
// GUARDED_WRITERS).
const guard = require("./lib/prodGuard");
const BASE = guard.writerBase("http://localhost:5601");

const EMAIL = process.env.DEMO_EMAIL || "admin@creoarts.org";
const PASSWORD = process.env.DEMO_PASSWORD || "demo1234";

// Heart of Africa's words. The fiscal year stays July (7) — nothing in the
// brief says otherwise, and changing it would move every "this year" figure.
const VOCABULARY = {
  giver_singular: "sponsor",
  giver_plural: "sponsors",
  monthly_giver_singular: "sponsor",
  monthly_giver_plural: "sponsors",
  fund_singular: "designation",
  fund_plural: "designations",
  fiscal_year_start_month: 7,
  season_name: "Spring Campaign",
  season_date: "2027-06-30",
};

(async () => {
  const login = await fetch(BASE + "/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  }).then(r => r.json());
  if (!login.token) { console.error("login failed:", login); process.exit(1); }
  const auth = { "Content-Type": "application/json", Authorization: "Bearer " + login.token };

  const before = await fetch(BASE + "/org/vocabulary", { headers: auth }).then(r => r.json());
  guard.logOverwrite("build86-vocabulary", { current: before.stored || {} }, { base: BASE });

  const r = await fetch(BASE + "/org/vocabulary", { method: "PUT", headers: auth, body: JSON.stringify(VOCABULARY) })
    .then(x => x.json());
  if (!r.vocabulary) { console.error("save failed:", r); process.exit(1); }
  console.log("demo vocabulary set:");
  for (const [k, v] of Object.entries(r.vocabulary)) console.log(`  ${k.padEnd(26)} ${v}`);
})();
