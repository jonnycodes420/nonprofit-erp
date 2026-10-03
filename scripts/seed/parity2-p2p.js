// scripts/seed/parity2-p2p.js: PARITY-2 Part 2. THE SPRING PADDLE.
//
// A second peer-to-peer campaign on Harborlight, so the public page has
// everything to show: a thermometer with a donor count, a countdown to a date
// in the future, two teams with captains, eight fundraisers with their own
// stories, and gifts through their pages (some donors chose to show their
// first name publicly, most did not). The page asks for approval of new pages,
// and one fundraiser is waiting for it, so the staff screen has something in
// its "waiting for approval" list.
//
// Gifts are written the way seed-demo.js writes every peer-to-peer gift: one
// row carrying BOTH the fundraiser and the parent page, stamped
// `system:stripe`, with a 100% `peer_fundraiser` soft credit when the
// fundraiser is a person on file. Donors are drawn ONLY from the candidates
// seed-demo hands over (recent givers no story depends on), so one more recent
// gift changes nothing any cadence surface says about them.
"use strict";

const crypto = require("crypto");

const PAGE = "gp_b72_paddle";
const CAMPAIGN = "camp_b72_paddle";
const TEAMS = [
  ["pt_b72_paddle_tide", "The Tide Turners", "the-tide-turners", 5000],
  ["pt_b72_paddle_dock", "Dockside Paddlers", "dockside-paddlers", 4000],
];
// [name, team index or null, goal, story, status]. The first member of each
// team is its captain.
const FUNDRAISERS = [
  ["Marisol Achterberg", 0, 1500, "I learned to paddle on this harbour when I was eleven, in a borrowed boat, with a mentor from Harborlight. Every stroke this spring is for the next kid who gets that chance.", "active"],
  ["Tobias Wren-Okafor", 0, 1000, "My daughter found her voice in the after-school arts room. I am paddling three miles to say thank you, and asking you to help.", "active"],
  ["Ines Halvorsen", 0, 750, "Our office team is small and stubborn. We have set ourselves a goal and we intend to beat it.", "active"],
  ["Gideon Marchetti", 1, 1200, "Twenty years on the dock and I have never once paddled anywhere. This year I am, for the kids on the north shore.", "active"],
  ["Ruth Abernethy-Song", 1, 800, "Mentoring changed the course of my nephew's life. If you can give anything, it goes straight to the programme.", "active"],
  ["Calum Fairweather", 1, 500, "First time fundraising. Be kind, be generous.", "active"],
  ["Noor Delacroix", null, 600, "Paddling solo, raising for the scholarship fund that sent me to art school.", "active"],
  ["Percival Ashdown", null, 400, "Signed up last night. My story is coming.", "pending"],
];
// Amounts through each active fundraiser, in dollars. Calum and Noor are
// deliberately light so the leaderboard has a shape; Percival is pending and
// has nothing.
const GIFTS = [
  [0, 250], [0, 100], [0, 500], [0, 75], [0, 150],
  [1, 200], [1, 50], [1, 300],
  [2, 100], [2, 60],
  [3, 400], [3, 125], [3, 250],
  [4, 100], [4, 80],
  [5, 40],
  [6, 150],
];

module.exports = async function seedParity2P2P({ q, ORG, TODAY, dAdd, candidates, storyIds }) {
  // A spring campaign, open now, closing on the next 16 May. The countdown on
  // the public page runs to that date.
  const y = Number(TODAY.slice(0, 4));
  const end = `${TODAY.slice(5) < "05-16" ? y : y + 1}-05-16`;
  await q(`INSERT INTO campaigns (id,org_id,name,type,status,goal_amount,start_date,end_date)
           VALUES ($1,$2,$3,'event','active',15000,$4::date,$5::date)`,
    [CAMPAIGN, ORG, `Spring Paddle ${end.slice(0, 4)}`, dAdd(TODAY, -21), end]);
  await q(`INSERT INTO giving_pages (id,org_id,slug,title,goal_amount,story,status,campaign_id,p2p_enabled,p2p_requires_approval)
           VALUES ($1,$2,'spring-paddle','Spring Paddle',15000,$3,'active',$4,true,true)`,
    [PAGE, ORG,
     "Three miles across the harbour in kayaks, canoes and anything else that floats, with every paddler raising for after-school arts and mentoring. Start your own page, join a team, or give to someone you know.",
     CAMPAIGN]);
  for (const [id, name, slug, goal] of TEAMS)
    await q(`INSERT INTO p2p_teams (id,org_id,giving_page_id,name,slug,goal_amount,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,$5,$6,'system:p2p-signup','The fundraiser, from the sign-up page')`,
      [id, ORG, PAGE, name, slug, goal]);

  // Two of the eight are people already on file (matched by exact email, so
  // their soft credits land on the record the office knows); the rest are new
  // people typed VOLUNTEER, never donors, because they have not given yet.
  const onFile = candidates.slice(0, 2);
  const givers = candidates.slice(2);
  const tokenHash = t => crypto.createHash("sha256").update(t).digest("hex");
  const made = [];
  for (const [i, [name, team, goal, story, status]] of FUNDRAISERS.entries()) {
    let personId, email, shownName = name;
    if (i < onFile.length) { personId = onFile[i].id; email = onFile[i].email; shownName = onFile[i].name; }
    else {
      personId = `d_b72_pad${i}`;
      email = `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.org`;
      await q(`INSERT INTO donors (id,org_id,name,email,stage,status,tags,person_types,created_by,created_by_name)
               VALUES ($1,$2,$3,$4,'prospect','active','[]','["volunteer"]'::jsonb,'system:p2p-signup','The fundraiser, from the sign-up page')`,
        [personId, ORG, name, email]);
    }
    const id = `pf_b72_pad${i}`;
    const slug = shownName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    await q(`INSERT INTO peer_fundraisers (id,org_id,giving_page_id,name,email,slug,personal_goal_amount,story,image_url,status,edit_token,edit_token_hash,team_id,person_id,created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'',$9,NULL,$10,$11,$12,NOW() - ($13 || ' days')::interval)`,
      [id, ORG, PAGE, shownName, email, slug, goal, story, status, tokenHash(`demo-paddle-${i}-${Date.now()}`),
       team == null ? null : TEAMS[team][0], personId, String(20 - i)]);
    made.push({ id, personId });
  }
  // The person who started each team is its captain.
  for (const [ti, [teamId]] of TEAMS.entries()) {
    const first = FUNDRAISERS.findIndex(f => f[1] === ti);
    await q(`UPDATE p2p_teams SET captain_fundraiser_id=$1 WHERE id=$2 AND org_id=$3`, [made[first].id, teamId, ORG]);
  }

  // The gifts. Every third donor chose to show their first name publicly;
  // every other donor let the fundraiser see it. The default for both is no.
  const fundraiserPeople = new Set(made.map(m => m.personId));
  const pool = givers.filter(d => !fundraiserPeople.has(d.id));
  if (pool.length < GIFTS.length + 2) {
    console.error(`\nREFUSED: the Spring Paddle needs ${GIFTS.length + 2} givers with no giving story and found ${pool.length}.`);
    process.exit(1);
  }
  let raised = 0;
  for (const [i, [fi, amount]] of GIFTS.entries()) {
    const dn = pool[i];
    const f = made[fi];
    const giftId = `g_b72_pad${i}`;
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,payment_method,giving_page_id,peer_fundraiser_id,campaign_id,
                                show_name_to_fundraiser,show_name_publicly,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,$5,'cash','Card',$6,$7,$8,$9,$10,'system:stripe','Stripe (online gift)')`,
      [giftId, ORG, dn.id, amount, dAdd(TODAY, -(i % 18) - 1), PAGE, f.id, CAMPAIGN, i % 2 === 0, i % 3 === 0]);
    raised += amount;
    if (f.personId && f.personId !== dn.id) {
      await q(`INSERT INTO gift_soft_credits (id,org_id,gift_id,donor_id,amount,pct,role,created_by,created_by_name)
               VALUES ($1,$2,$3,$4,$5,100,'peer_fundraiser','system:stripe','Their own fundraiser page')
               ON CONFLICT (gift_id, donor_id) DO NOTHING`,
        [`gsc_b72_pad${i}`, ORG, giftId, f.personId, amount]);
    }
  }
  // Two gifts to the page itself, through no fundraiser.
  for (const [j, amount] of [[0, 100], [1, 250]]) {
    const dn = pool[GIFTS.length + j];
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,payment_method,giving_page_id,campaign_id,show_name_publicly,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,$5,'cash','Card',$6,$7,$8,'system:stripe','Stripe (online gift)')`,
      [`g_b72_paddir${j}`, ORG, dn.id, amount, dAdd(TODAY, -(j + 3)), PAGE, CAMPAIGN, j === 0]);
    raised += amount;
  }

  // The rule seed-demo asserts for the 5K, asserted here too: nobody the
  // demo's story depends on receives a gift dated this month.
  const story = new Set(storyIds);
  const touched = [...made.map(m => m.personId), ...pool.slice(0, GIFTS.length + 2).map(d => d.id)];
  const trespass = touched.filter(id => story.has(id));
  if (trespass.length) {
    console.error(`\nREFUSED: the Spring Paddle drew ${trespass.length} of the story's own people (${trespass.join(", ")}).`);
    process.exit(1);
  }
  console.log(`[assert] spring paddle: ${TEAMS.length} teams with captains, ${FUNDRAISERS.length} fundraisers (one waiting for approval), $${raised.toLocaleString("en-US")} raised, closes ${end}`);
  return { pageId: PAGE, used: touched };
};
