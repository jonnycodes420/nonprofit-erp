// scripts/seed/journeys4-demo.js: JOURNEYS-4. TWO READY-MADE JOURNEYS ON THE
// NEW TRIGGERS, WITH PEOPLE ALREADY PART WAY THROUGH.
//
// Called with one line from scripts/seed-demo.js main(). It only ever writes
// org_b72demo, through the `q` the seed hands it, and only seed-demo calls it.
//
// The gala was in May and the spring auction is still open, so nothing on the
// file is a recent win or a recent no-show. Two small things that happened
// this month make both journeys true:
//
//   · the Fall art auction, closed five days ago: three items, each won by a
//     different person (two bids each, so a loser exists too)
//   · the Family open studio, four days ago: twelve on the list, nine checked
//     in at the door, three who registered and never came
//
// "Auction winner thank-you" holds the three winners and "Event no-show
// follow-up" the three who did not come, each on step two with step one done
// and the open step on their Thread (FIX-31: the Thread's own trigger makes
// the one task). Both journeys are PAUSED: the people in them carry on, and
// nobody new is swept in while somebody is giving the demo (tonight's supper
// would otherwise make thirty-five no-shows tomorrow morning).
const orgTime = require("../../orgTime");

async function seedJourneys4(q, ORG, { TODAY }) {
  const J = await import("../../shared/journeyShape.js");
  const live = `d.org_id=$1 AND d.deleted_at IS NULL AND COALESCE(d.kind,'') NOT IN ('organisation','anonymous')
                AND d.deceased IS NOT TRUE AND d.do_not_contact IS NOT TRUE AND COALESCE(d.email,'') <> ''
                AND d.name NOT LIKE 'Donor %'
                AND NOT EXISTS (SELECT 1 FROM threads t WHERE t.org_id=d.org_id AND t.donor_id=d.id AND t.closed_at IS NULL)
                AND NOT EXISTS (SELECT 1 FROM cultivation_plans p WHERE p.org_id=d.org_id AND p.donor_id=d.id AND p.status='active')`;
  // One row per name (the name pool repeats), then a stable shuffle so the
  // six people on screen are not all from the top of the alphabet.
  const people = await q(`SELECT * FROM (SELECT DISTINCT ON (d.name) d.id, d.name, d.email, d.phone, d.assigned_to, d.assigned_to_name
                            FROM donors d WHERE ${live} AND d.total_giving BETWEEN 300 AND 6000 ORDER BY d.name, d.id) x
                           ORDER BY md5(x.id) LIMIT 40`, [ORG]);
  if (people.length < 18) { console.log("[seed] JOURNEYS-4: not enough people on file, skipped"); return; }
  const winners = people.slice(0, 3), losers = people.slice(3, 5), noShows = people.slice(5, 8), came = people.slice(8, 17), donorOfItems = people.slice(17, 18);

  // ── The Fall art auction, closed five days ago ───────────────────────────
  const AU = "auc_b72_fall";
  await q(`INSERT INTO auctions (id,org_id,title,description,public_slug,opens_at,closes_at,created_by,created_by_name)
           VALUES ($1,$2,'Fall art auction','Three pieces by Harborlight teaching artists, bid on over one weekend.','harborlight-fall-art-b72',
                   NOW() - INTERVAL '8 days', NOW() - INTERVAL '5 days','u_b72demo','Dana Reyes') ON CONFLICT (id) DO NOTHING`, [AU, ORG]);
  const bidders = [...winners, ...losers];
  for (const [i, b] of bidders.entries()) {
    await q(`INSERT INTO auction_bidders (id,org_id,auction_id,donor_id,name,email,phone,bidder_number,token_hash,created_at,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,md5($1),NOW() - INTERVAL '7 days','system:auction-public','The bidder, from the auction page')
             ON CONFLICT (id) DO NOTHING`, [`aub_b72f_${i + 1}`, ORG, AU, b.id, b.name, b.email, b.phone || "555-0100", 201 + i]);
  }
  const ITEMS = [["Harbor at dusk, oil on board", 400, 250, 25, 520], ["Hand-thrown serving bowl", 120, 60, 10, 180], ["Linocut series, three prints", 200, 100, 10, 260]];
  for (const [i, [title, fmv, start, inc, winning]] of ITEMS.entries()) {
    const item = `aui_b72f_${i + 1}`;
    await q(`INSERT INTO auction_items (id,org_id,auction_id,title,category,donor_id,fmv,starting_bid,bid_increment,position,closed_at,created_at,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,'Art',$5,$6,$7,$8,$9,NOW() - INTERVAL '5 days',NOW() - INTERVAL '9 days','u_b72demo','Dana Reyes') ON CONFLICT (id) DO NOTHING`,
      [item, ORG, AU, title, donorOfItems[0].id, fmv, start, inc, i + 1]);
    // A losing bid first, then the winning one.
    await q(`INSERT INTO auction_bids (id,org_id,auction_id,item_id,bidder_id,amount,created_at,created_by,created_by_name) VALUES
               ($1,$2,$3,$4,$5,$6,NOW() - INTERVAL '6 days','system:auction-public','The bidder, from the auction page'),
               ($7,$2,$3,$4,$8,$9,NOW() - INTERVAL '5 days 2 hours','system:auction-public','The bidder, from the auction page')
             ON CONFLICT (id) DO NOTHING`,
      [`abid_b72f_${i + 1}a`, ORG, AU, item, `aub_b72f_${4 + (i % 2)}`, start + inc, `abid_b72f_${i + 1}b`, `aub_b72f_${i + 1}`, winning]);
  }

  // ── The Family open studio, four days ago ────────────────────────────────
  const EV = "ev_b72_openstudio";
  const evDay = orgTime.addDays(TODAY, -4);
  await q(`INSERT INTO events (id,org_id,name,event_type,date,end_date,location,description,capacity,status,start_time,end_time,created_by,created_by_name)
           VALUES ($1,$2,'Family open studio','open_house',$3,$3,'The studio, Harborlight','An afternoon for families to make something with the students.',30,'completed','14:00','16:30','u_b72demo','Dana Reyes')
           ON CONFLICT (id) DO NOTHING`, [EV, ORG, evDay]);
  for (const [i, p] of [...came, ...noShows].entries()) {
    const cameIn = i < came.length;
    await q(`INSERT INTO event_attendees (id,org_id,event_id,donor_id,name,email,status,quantity,source,checked_in_at,created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,1,'public',$8::timestamptz,NOW() - INTERVAL '12 days') ON CONFLICT DO NOTHING`,
      [`ea_b72os_${i + 1}`, ORG, EV, p.id, p.name, p.email, cameIn ? "attended" : "registered",
       cameIn ? `${evDay} 14:${String(5 + i * 3).padStart(2, "0")}:00-04` : null]);
  }

  // ── The two journeys, and the people part way through them ───────────────
  const journeys = [
    { id: "ct_b72_auctionwin", preset: "auction_winner_thanks", who: winners, enteredAgo: 5, event: d => `auction_won:aui_b72f_${winners.indexOf(d) + 1}` },
    { id: "ct_b72_noshow", preset: "event_no_show", who: noShows, enteredAgo: 3, event: () => `event_no_show:${EV}` },
  ];
  const DONE = { thank: "Called. Delighted, and asked when the spring auction opens.", send: "Sent the we-missed-you note with two photos from the afternoon." };
  for (const jn of journeys) {
    const P = J.presetByKey(jn.preset);
    const steps = P.steps.map(s => ({ type: s.type, label: s.label, offsetDays: s.offsetDays, draft: s.draft || null }));
    await q(`INSERT INTO cultivation_templates
               (id,org_id,name,description,steps,trigger_key,priority,preset_key,journey_enabled,ever_enabled,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,false,true,'u_b72demo','Dana Reyes') ON CONFLICT (id) DO NOTHING`,
      [jn.id, ORG, P.name, P.blurb, JSON.stringify(steps), P.trigger, P.priority, P.key]);
    for (const [k, d] of jn.who.entries()) {
      const entered = orgTime.addDays(TODAY, -jn.enteredAgo);
      const planId = `cp_${jn.id.slice(3)}_${k + 1}`;
      const owner = d.assigned_to || "u_b72demo", ownerName = d.assigned_to_name || "Dana Reyes";
      await q(`INSERT INTO cultivation_plans (id,org_id,donor_id,template_id,template_name,applied_on,status,owner_id,owner_name,
                                              created_by,created_by_name,trigger_key,priority,trigger_event)
               VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8,'system:journey','Steward (journey)',$9,$10,$11) ON CONFLICT (id) DO NOTHING`,
        [planId, ORG, d.id, jn.id, P.name, entered, owner, ownerName, P.trigger, P.priority, jn.event(d)]);
      await q(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name)
               VALUES ($1,$2,$3,'note',$4,$5,'system:journey','Steward (journey)') ON CONFLICT (id) DO NOTHING`,
        [`int_${planId}_s`, ORG, d.id, `Journey started: ${P.name} (${steps.length} steps).`, entered]);
      for (const [i, st] of steps.entries()) {
        const due = orgTime.addDays(entered, st.offsetDays);
        const done = i === 0, open = i === 1;
        let threadId = null;
        if (done) {
          await q(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
            [`int_${planId}_1`, ORG, d.id, st.type === "thank" ? "call" : "email", `${st.label}: ${DONE[st.type] || "Done."}`, due, owner, ownerName]);
        }
        if (open) {
          threadId = `th_${planId.slice(3)}`;
          await q(`INSERT INTO threads (id,org_id,donor_id,next_step_type,next_step_label,due_date,opened_on,owner_id,owner_name,created_by,created_by_name)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'system:journey','Steward (journey)') ON CONFLICT DO NOTHING`,
            [threadId, ORG, d.id, st.type, st.label, due, orgTime.addDays(entered, steps[0].offsetDays), owner, ownerName]);
        }
        await q(`INSERT INTO cultivation_plan_steps (id,org_id,plan_id,seq,step_type,label,due_date,status,thread_id,draft_kind,owner_id,owner_name,
                                                     closed_at,closed_by,closed_by_name,done_note)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT (id) DO NOTHING`,
          [`cs_${planId.slice(3)}_${i + 1}`, ORG, planId, i + 1, st.type, st.label, due, done ? "done" : open ? "open" : "pending",
           threadId, st.draft, owner, ownerName, done ? `${due} 12:00:00+00` : null, done ? owner : null, done ? ownerName : null,
           done ? (DONE[st.type] || "Done.") : null]);
      }
    }
  }
  const [{ n }] = await q(`SELECT COUNT(*)::int AS n FROM cultivation_plans WHERE org_id=$1 AND template_id IN ('ct_b72_auctionwin','ct_b72_noshow') AND status='active'`, [ORG]);
  console.log(`[seed] JOURNEYS-4: Fall art auction (3 won), Family open studio (3 no-shows); ${n} people in "Auction winner thank-you" and "Event no-show follow-up" (paused)`);
}

module.exports = { seedJourneys4 };
