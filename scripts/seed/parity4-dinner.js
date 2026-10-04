// scripts/seed/parity4-dinner.js: PARITY-4 Part 4. TONIGHT'S SUPPER, HALF SEATED.
//
// Called with one line from scripts/seed-demo.js main(). It only ever writes
// org_b72demo, through the `q` the seed hands it, and only seed-demo calls it.
//
// The gala is over and the 5K is a run (nobody sits down at a 5K), so neither
// can show a seating chart being worked on or a door being worked. This is the
// event that shows both: the Scholarship Supper, dated the day the seed runs,
// with doors at six.
//
//   · six tables: five rounds of eight and one long head table of twelve
//     (52 chairs), on the FIX-11 table rows with PARITY-4's `shape`
//   · forty guests, 24 of the chairs filled on numbered chairs, the rest
//     waiting in Not seated so the chart has work left on it
//   · one party of three (a host and two guests on one ticket), unseated, so
//     the move-a-party case is there to try
//   · four VIP marks, two of them at the head table
//   · five guests already through the door, checked in a few minutes apart
//
// Every guest is an existing Harborlight person (one person record), and every
// one of them has a valid ticket QR, because a ticket code is DERIVED from the
// attendee id (shared/passCode.js) and never stored.
async function seedParity4Dinner(q, ORG, { TODAY }) {
  const EV_ID = "ev_b72_supper";
  await q(`INSERT INTO events (id,org_id,name,event_type,date,end_date,location,description,capacity,status,revenue,cost,goal_amount,start_time,end_time,created_by,created_by_name)
           VALUES ($1,$2,'Scholarship Supper','gala',$3,$3,'The Boathouse, Harborlight',$4,52,'upcoming',0,2600,15000,'18:00','21:30','u_b72demo','Dana Reyes')
           ON CONFLICT (id) DO NOTHING`,
    [EV_ID, ORG, TODAY, "A sit-down supper for the families and friends of this year's scholarship students."]);
  await q(`INSERT INTO event_levels (id,org_id,event_id,kind,name,price,fmv,position,created_by,created_by_name)
           VALUES ('evl_b72_supper',$1,$2,'ticket','Supper place',120,45,0,'u_b72demo','Dana Reyes')
           ON CONFLICT (id) DO NOTHING`, [ORG, EV_ID]);

  const TABLES = [
    ["etb_b72_sup_head", "Head table", 12, "long"],
    ["etb_b72_sup_1", "Table 1", 8, "round"], ["etb_b72_sup_2", "Table 2", 8, "round"],
    ["etb_b72_sup_3", "Table 3", 8, "round"], ["etb_b72_sup_4", "Table 4", 8, "round"],
    ["etb_b72_sup_5", "Table 5", 8, "round"],
  ];
  for (const [i, [id, label, seats, shape]] of TABLES.entries())
    await q(`INSERT INTO event_tables (id,org_id,event_id,label,seats,shape,sort,created_by,created_by_name)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'u_b72demo','Dana Reyes') ON CONFLICT (event_id,label) DO NOTHING`,
      [id, ORG, EV_ID, label, seats, shape, i + 1]);

  // Forty people from the middle of the file, with an email, past the 5K's
  // entrants (those come from OFFSET 40).
  const people = await q(
    `SELECT id, name, email FROM donors WHERE org_id=$1 AND deleted_at IS NULL
       AND email IS NOT NULL AND email <> '' ORDER BY total_giving DESC, id OFFSET 80 LIMIT 40`, [ORG]);
  // Who sits where: [table index, chair] for the first 24. The head table gets
  // 6 of its 12, each round 3 or 4 of its 8, spread round the table rather than
  // packed from chair 1, so the drawn room reads as half full.
  const PLACES = [
    [0, 1], [0, 2], [0, 4], [0, 6], [0, 7], [0, 9],
    [1, 1], [1, 3], [1, 5], [1, 7],
    [2, 1], [2, 2], [2, 5],
    [3, 2], [3, 4], [3, 6], [3, 8],
    [4, 1], [4, 4], [4, 6],
    [5, 1], [5, 3], [5, 5], [5, 7],
  ];
  const VIP = new Set([0, 2, 7, 30]);   // two at the head table, one at Table 1, one not yet seated
  const DIETS = { 3: "Vegetarian", 11: "Gluten free", 19: "Nut allergy", 33: "Vegan" };
  const ids = [];
  for (const [k, p] of people.entries()) {
    const id = `att_b72_sup${String(k + 1).padStart(2, "0")}`;
    ids.push(id);
    const place = PLACES[k] || null;
    const t = place ? TABLES[place[0]] : null;
    await q(`INSERT INTO event_attendees (id,event_id,org_id,donor_id,name,email,status,level_id,quantity,table_label,table_id,seat_no,vip,dietary,gift_amount)
             VALUES ($1,$2,$3,$4,$5,$6,'confirmed','evl_b72_supper',1,$7,$8,$9,$10,$11,0)
             ON CONFLICT (event_id, donor_id) DO NOTHING`,
      [id, EV_ID, ORG, p.id, p.name, p.email, t ? t[1] : null, t ? t[0] : null, place ? place[1] : null,
       VIP.has(k), DIETS[k] || null]);
  }
  // ONE PARTY OF THREE, unseated: guests 38 and 39 came on guest 37's ticket.
  if (ids.length >= 39) {
    await q(`UPDATE event_attendees SET guest_of=$1, quantity=0 WHERE id = ANY($2) AND org_id=$3`,
      [ids[36], [ids[37], ids[38]], ORG]);
    await q(`UPDATE event_attendees SET quantity=3 WHERE id=$1 AND org_id=$2`, [ids[36], ORG]);
  }
  // FIVE THROUGH THE DOOR already, a few minutes apart, all seated guests so
  // the kiosk shows tables beside the green rows.
  const inNow = [ids[0], ids[6], ids[10], ids[13], ids[17]].filter(Boolean);
  for (const [i, id] of inNow.entries())
    await q(`UPDATE event_attendees SET status='attended', checked_in_at = NOW() - make_interval(mins => $1)
              WHERE id=$2 AND org_id=$3`, [25 - i * 4, id, ORG]);

  const [{ n: seated }] = await q(`SELECT COUNT(*)::int AS n FROM event_attendees WHERE org_id=$1 AND event_id=$2 AND table_id IS NOT NULL`, [ORG, EV_ID]);
  const [{ n: inside }] = await q(`SELECT COUNT(*)::int AS n FROM event_attendees WHERE org_id=$1 AND event_id=$2 AND checked_in_at IS NOT NULL`, [ORG, EV_ID]);
  console.log(`[assert] the Scholarship Supper (${TODAY}): ${people.length} guests, ${seated} of 52 chairs filled across 6 tables, ${VIP.size} VIP, ${inside} checked in`);
}

module.exports = { seedParity4Dinner };
