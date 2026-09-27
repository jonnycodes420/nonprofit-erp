// FIX-1 — HOME'S INSTITUTIONAL LIST SAYS WHAT EACH ORGANISATION GAVE.
//
// Jonathan (27 September): the list under Drift called every organisation's
// last gift a "last grant" and printed the date as ISO (2026-01-14). A church's
// collection and a business's cheque are gifts; only foundations and
// donor-advised funds make grants. Dates read as "Jan 14, 2026".
//
//   §1 the rule, pure: shared/institutional.js lastGiftWord + shortCivilDate
//   §2 the server decides it once: /drift's institutional rows carry lastWord
//      and the civil date, from the same module
//   §3 Home renders the server's word and the short date, never ISO

const bcrypt = require("bcryptjs");
const fs = require("fs"), path = require("path");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "org_fx1inst";
const PW = "loadtest1234";
const root = path.join(__dirname, "..");

async function reset() {
  for (const t of ["fin_transactions", "interactions", "gifts", "threads", "donors", "fin_audit_log", "users", "budgets", "accounts", "fin_funds"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
}

(async () => {
  console.log("fix1-institutional");
  let I = null;
  try { I = await import(path.join(root, "shared/institutional.js")); } catch (e) { I = { __missing: String(e.message).slice(0, 120) }; }
  const has = n => I && typeof I[n] === "function";

  // ── §1 the rule ─────────────────────────────────────────────────────────
  console.log("\n— §1 · the word and the date, pure —");
  ok("§1 shared/institutional.js exports lastGiftWord and shortCivilDate", has("lastGiftWord") && has("shortCivilDate"), I.__missing);
  if (has("lastGiftWord")) {
    const w = r => I.lastGiftWord({ kind: "organisation", ...r });
    ok("§1 a foundation's is a grant", w({ funder_type: "private_foundation", name: "Ridgeline Trust" }) === "last grant");
    ok("§1 a community foundation's is a grant", w({ funder_type: "community_foundation", name: "Tidewater CF" }) === "last grant");
    ok("§1 a donor-advised fund's is a grant", w({ funder_type: "daf_sponsor", name: "Schwab Charitable" }) === "last grant");
    ok("§1 a DAF known only by its name is a grant", w({ name: "Fidelity Charitable" }) === "last grant", w({ name: "Fidelity Charitable" }));
    ok("§1 a foundation known only by its name is a grant", w({ name: "Sunrise Foundation" }) === "last grant");
    ok("§1 a church's is a gift", w({ funder_type: "church", name: "Grace Chapel" }) === "last gift");
    ok("§1 a church known only by its name is a gift", w({ name: "First Baptist Church" }) === "last gift");
    ok("§1 a business's is a gift", w({ funder_type: "corporate", name: "Saltbox Printing" }) === "last gift");
    ok("§1 a business known only by its name is a gift", w({ name: "Kiln & Co. LLC" }) === "last gift");
    ok("§1 an organisation nobody classified is a gift, not a grant", w({ name: "Riverside Neighbors" }) === "last gift");
  }
  if (has("shortCivilDate")) {
    ok("§1 2026-01-14 reads Jan 14, 2026", I.shortCivilDate("2026-01-14") === "Jan 14, 2026", I.shortCivilDate("2026-01-14"));
    ok("§1 the civil day never moves with a timezone (Dec 31 stays Dec 31)", I.shortCivilDate("2025-12-31") === "Dec 31, 2025", I.shortCivilDate("2025-12-31"));
    ok("§1 a stamped value keeps its date part", I.shortCivilDate("2026-03-02T00:00:00.000Z") === "Mar 2, 2026", I.shortCivilDate("2026-03-02T00:00:00.000Z"));
    ok("§1 nothing reads as nothing", I.shortCivilDate(null) === "" && I.shortCivilDate("not a date") === "");
  }

  // ── §2 the server says it once ──────────────────────────────────────────
  console.log("\n— §2 · /drift's institutional rows —");
  await reset();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status) VALUES ($1,'Institutional Fixture','fx1-inst',1,'team','active')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_fx1inst',$1,'fx1inst@example.org',$2,'Ina Inst','admin')`, [ORG, bcrypt.hashSync(PW, 4)]);
  const orgs = [
    ["fi_fdn", "Ridgeline Family Foundation", "family_foundation", 5000, "2026-01-14"],
    ["fi_daf", "Schwab Charitable", null, 2500, "2025-12-31"],
    ["fi_chu", "Grace Chapel", "church", 1200, "2026-03-02"],
    ["fi_biz", "Saltbox Printing", "corporate", 750, "2026-02-09"],
  ];
  for (const [id, name, ft, amt, date] of orgs)
    await q(`INSERT INTO donors (id,org_id,name,kind,funder_type,stage,total_giving,gift_count,last_gift_date)
             VALUES ($1,$2,$3,'organisation',$4,'steward',$5,1,$6)`, [id, ORG, name, ft, amt, date]);
  const tok = await login("fx1inst@example.org", PW);
  const dr = await api("GET", "/drift", tok);
  const inst = (dr.body && dr.body.institutional) || [];
  const by = Object.fromEntries(inst.map(r => [r.donorId, r]));
  ok("§2 all four organisations are on the list", orgs.every(([id]) => by[id]), inst.map(r => r.name));
  ok("§2 the foundation's row says last grant", by.fi_fdn && by.fi_fdn.lastWord === "last grant", by.fi_fdn);
  ok("§2 the DAF's row says last grant", by.fi_daf && by.fi_daf.lastWord === "last grant", by.fi_daf);
  ok("§2 the church's row says last gift", by.fi_chu && by.fi_chu.lastWord === "last gift", by.fi_chu);
  ok("§2 the business's row says last gift", by.fi_biz && by.fi_biz.lastWord === "last gift", by.fi_biz);
  ok("§2 each row carries the date as it reads", by.fi_fdn && by.fi_fdn.lastGiftLabel === "Jan 14, 2026"
     && by.fi_daf && by.fi_daf.lastGiftLabel === "Dec 31, 2025", [by.fi_fdn && by.fi_fdn.lastGiftLabel, by.fi_daf && by.fi_daf.lastGiftLabel]);

  // ── §3 Home renders it ──────────────────────────────────────────────────
  console.log("\n— §3 · Home —");
  const dash = fs.readFileSync(path.join(root, "client/src/components/Dashboard.jsx"), "utf8");
  ok("§3 Home no longer calls every organisation's gift a grant", !/last grant \$\{String\(inst\.lastGiftDate\)/.test(dash));
  ok("§3 Home prints the server's word and the short date", /inst\.lastWord/.test(dash) && /inst\.lastGiftLabel/.test(dash));
  ok("§3 the list's heading names churches and businesses too", /Institutional giving[^<]*church/i.test(dash));

  await reset();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch {} process.exit(1); });
