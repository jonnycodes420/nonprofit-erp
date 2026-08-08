// Item 2 (2026-08-08) — /reports/solicitations win rate used the WRONG
// denominator: won/(won+open) instead of won/(won+lost). Open asks are not
// losses. This pins the corrected definition against a fixture with KNOWN
// won/lost/open counts. Local scratch server + Postgres (tests/README.md recipe).
//
// THE FIXTURE (one officer, one window):
//   2 won · 1 lost · 4 open
//   old (buggy):  won/(won+open) = 2/(2+4) = 2/6 = 33.3%
//   correct:      won/(won+lost) = 2/(2+1) = 2/3 = 66.7%
// A second officer has 0 won · 0 lost · 2 open → win rate is null ("—"), not 0%.

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q } = require("./helpers");

const ORG = "org_wr_main", OTHER = "org_wr_other";
const now = new Date();
const Y = now.getMonth() < 6 ? now.getFullYear() : now.getFullYear() + 1; // current fiscal year
const CLOSED = now.toISOString().slice(0, 10) + " 10:00:00"; // decided today → inside the current-FY window

async function reset() {
  for (const org of [ORG, OTHER]) {
    for (const t of ["opportunities", "gifts", "donors", "users"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]);
  }
}
async function seedOrg(o, tag) {
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,'active','growth')`, [o, `WR ${tag}`, `wr-${tag}`]);
}
async function seedUser(o, id, tag) {
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,'admin')`,
    [id, o, `${id}@wr.local`, bcrypt.hashSync("loadtest1234", 10), `Officer ${tag}`]);
}
async function seedDonor(o, id) {
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage) VALUES ($1,$2,$3,$4,'mid','solicit')`, [id, o, `Donor ${id}`, `${id}@wr.local`]);
}
// status ∈ open|won|lost. won/lost stamp closed_at (as the real PUT route does).
async function seedOpp(o, donorId, officerId, target, status, giftAmount = null) {
  await q(`INSERT INTO opportunities (id,org_id,donor_id,officer_id,officer_name,name,target_amount,status,gift_amount,closed_at)
           VALUES ($1,$2,$3,$4,'x','ask',$5,$6,$7,$8)`,
    ["op_" + Math.random().toString(36).slice(2, 9), o, donorId, officerId, target, status, giftAmount,
     status === "open" ? null : CLOSED]);
}

(async () => {
  await reset();
  await seedOrg(ORG, "main");
  await seedUser(ORG, "uwr_a", "A");   // the 2-won / 1-lost / 4-open officer
  await seedUser(ORG, "uwr_b", "B");   // 0-won / 0-lost / 2-open officer
  for (let i = 0; i < 8; i++) await seedDonor(ORG, `wr_d${i}`);

  // Officer A: 2 won, 1 lost, 4 open.
  await seedOpp(ORG, "wr_d0", "uwr_a", 10000, "won", 9000);
  await seedOpp(ORG, "wr_d1", "uwr_a", 5000, "won", 6000);
  await seedOpp(ORG, "wr_d2", "uwr_a", 8000, "lost");
  await seedOpp(ORG, "wr_d3", "uwr_a", 3000, "open");
  await seedOpp(ORG, "wr_d4", "uwr_a", 4000, "open");
  await seedOpp(ORG, "wr_d5", "uwr_a", 2000, "open");
  await seedOpp(ORG, "wr_d6", "uwr_a", 1000, "open");
  // Officer B: only open asks.
  await seedOpp(ORG, "wr_d7", "uwr_b", 5000, "open");
  await seedOpp(ORG, "wr_d0", "uwr_b", 1500, "open");

  const tok = await login(`uwr_a@wr.local`, "loadtest1234");
  const sol = (await api("GET", `/reports/solicitations?year=${Y}&yearMode=fiscal`, tok)).body;

  const a = sol.byOfficer.find(o => o.officerId === "uwr_a");
  const b = sol.byOfficer.find(o => o.officerId === "uwr_b");
  ok("officer A found in byOfficer", !!a, sol.byOfficer);

  // The counts the win rate is computed from.
  ok("A won = 2", a.giftsClosed === 2, a);
  ok("A lost = 1", a.lostAsks === 1, a);
  ok("A open = 4 (surfaced separately, labeled open)", a.openAsks === 4, a);
  ok("A decidedAsks = won + lost = 3", a.decidedAsks === 3, a);

  // THE DEFINITION: won/(won+lost) = 2/3 = 66.7% — NOT the old won/(won+open)=33.3%.
  ok("A win rate = 66.7% (won ÷ won+lost)", a.winRate === 66.7, a.winRate);
  ok("A win rate is NOT the old 33.3% (won ÷ won+open)", a.winRate !== 33.3, a.winRate);

  // Zero decided → null (client renders "—"/"No decided asks yet"), never 0%.
  ok("officer B found", !!b, sol.byOfficer);
  ok("B has open asks but 0 decided", b.openAsks === 2 && b.decidedAsks === 0, b);
  ok("B win rate is null (no decided asks yet), not 0", b.winRate === null, b.winRate);

  // Open asks are never counted as losses.
  ok("A lostAsks (1) excludes the 4 open asks", a.lostAsks === 1, a);

  summary();
})();
