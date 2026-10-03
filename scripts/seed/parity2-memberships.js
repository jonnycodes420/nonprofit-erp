// scripts/seed/parity2-memberships.js: PARITY-2 Part 1. THE MEMBERSHIP PAGE.
//
// Called with one line from scripts/seed-demo.js main(), after the MEMBERS-2
// block has written Harborlight's three levels. It gives each a description
// for its card and an order on the page, and adds one monthly level so the
// page shows both terms a member can choose. Pinned to the demo org; the
// caller's guards (identity, database allowlist, prod path) have already run.

const LEVEL_WORDS = [
  ["mbl_b72_friend", 1, "The simplest way to stand with the harbor programmes all year."],
  ["mbl_b72_family", 2, "For a household that wants to be on the water with us, not only on the mailing list."],
  ["mbl_b72_circle", 4, "Our closest supporters, who make the scholarship boats possible every summer."],
];

// A monthly level: $10 a month, nothing received, so all of it is deductible.
const MONTHLY = {
  id: "mbl_b72_crew", name: "Crew", price: 10, fmv: 0, position: 3,
  description: "Ten dollars a month keeps a young sailor on the water. Stop any month.",
  benefits: ["A monthly note from the dock", "Your name on the crew board at the harbor center"],
};

async function seedParity2Memberships({ q, ORG }) {
  for (const [id, position, description] of LEVEL_WORDS)
    await q(`UPDATE membership_levels SET description=$1, position=$2, hidden=false WHERE id=$3 AND org_id=$4`,
      [description, position, id, ORG]);
  await q(`INSERT INTO membership_levels (id,org_id,name,price,fmv,term,scope,benefits,description,position,hidden,created_by,created_by_name)
           VALUES ($1,$2,$3,$4,$5,'1_month','individual',$6::jsonb,$7,$8,false,'u_b72demo','Dana Reyes')
           ON CONFLICT (id) DO NOTHING`,
    [MONTHLY.id, ORG, MONTHLY.name, MONTHLY.price, MONTHLY.fmv, JSON.stringify(MONTHLY.benefits), MONTHLY.description, MONTHLY.position]);
  const [{ n }] = await q(`SELECT COUNT(*)::int AS n FROM membership_levels
                            WHERE org_id=$1 AND active IS NOT FALSE AND hidden IS NOT TRUE AND description IS NOT NULL`, [ORG]);
  if (n < 4) { console.error(`\nREFUSED: the membership page has ${n} described levels (need 4).`); process.exit(1); }
  console.log(`[assert] membership page: ${n} levels with descriptions, in order Friend, Family, Crew (monthly), Harbor Circle`);
}

module.exports = { seedParity2Memberships };
