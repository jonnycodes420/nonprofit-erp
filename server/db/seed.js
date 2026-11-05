// SPLIT-2: moved VERBATIM from db.js (the backfill helpers and the boot seed). db.js re-exports it, so no caller changed.
// Each "SPLIT-2 db.js piece N" block is db.js's own text; tests read db.js through
// readSource("db.js"), which puts the pieces back in order.
const { pool, newId, bcrypt, orgTime } = require("./pool");

// SPLIT-2 db.js piece 50

// FIX-31 · THE BACKFILL. Every open next step and every open grant deadline
// that has no task yet gets one, by touching the row so its trigger writes
// it. Safe to run twice: the unique indexes make a second task impossible and
// the NOT EXISTS makes a second pass touch nothing. Returns what it made.
async function backfillLinkedTasks() {
  const count = async () => Number((await pool.query(
    `SELECT COUNT(*)::int AS n FROM tasks WHERE thread_id IS NOT NULL OR milestone_id IS NOT NULL`)).rows[0].n);
  const before = await count();
  const t = await pool.query(`UPDATE threads SET due_date = due_date
     WHERE closed_at IS NULL AND NOT EXISTS (SELECT 1 FROM tasks k WHERE k.thread_id = threads.id)
       AND NOT EXISTS (SELECT 1 FROM grant_milestones m WHERE m.thread_id = threads.id AND m.org_id = threads.org_id)`);
  const m = await pool.query(`UPDATE grant_milestones SET due_date = due_date
     WHERE state NOT IN ('done','skipped') AND NOT EXISTS (SELECT 1 FROM tasks k WHERE k.milestone_id = grant_milestones.id AND k.link_kind = 'deadline')`);
  const made = (await count()) - before;
  if (made) console.log(`[fix-31] backfill: ${made} task(s) for ${t.rowCount} next step(s) and ${m.rowCount} deadline(s)`);
  return { made, nextSteps: t.rowCount, deadlines: m.rowCount };
}
// SPLIT-2 end
// SPLIT-2 db.js piece 51

// FIX-49 decision 8 · ONE HOUSEHOLD GROUPING. The household record
// (donors.household_id) is the only way Steward groups people for giving. A
// spouse or household link (donor_relationships) used to make a second
// "household total"; each such pair is now put in one household: the one
// either already belongs to, or a new one named for the first person. A pair
// already in two different households is left as it is (merging two
// households is a person's choice) and counted. Organisations and anonymous
// records never join a household. Safe to run again: a pair in one household
// is skipped. `orgId` narrows it to one org.
async function householdsFromLinks(pool, orgId = null) {
  const q = (sql, args) => pool.query(sql, args).then(r => r.rows);
  const pairs = await q(
    `SELECT dr.org_id, dr.donor_id_a AS a, dr.donor_id_b AS b
       FROM donor_relationships dr
       JOIN donors da ON da.id = dr.donor_id_a AND da.org_id = dr.org_id AND da.deleted_at IS NULL
       JOIN donors db ON db.id = dr.donor_id_b AND db.org_id = dr.org_id AND db.deleted_at IS NULL
      WHERE dr.relationship_type IN ('spouse', 'partner', 'household')
        AND COALESCE(da.kind, 'person') NOT IN ('organisation', 'anonymous') AND COALESCE(db.kind, 'person') NOT IN ('organisation', 'anonymous')
        AND (da.household_id IS NULL OR db.household_id IS NULL OR da.household_id <> db.household_id)${orgId ? " AND dr.org_id = $1" : ""}
      ORDER BY dr.created_at, dr.id`, orgId ? [orgId] : []);
  let joined = 0, made = 0, apart = 0;
  for (const p of pairs) {
    const rows = await q(`SELECT id, name, household_id FROM donors WHERE org_id = $1 AND id = ANY($2)`, [p.org_id, [p.a, p.b]]);
    const A = rows.find(r => r.id === p.a), B = rows.find(r => r.id === p.b);
    if (!A || !B || (A.household_id && A.household_id === B.household_id)) continue;
    if (A.household_id && B.household_id) { apart++; continue; }
    let hh = A.household_id || B.household_id;
    if (!hh) {
      hh = newId("hh");
      const last = String(A.name || "").trim().split(/\s+/).pop();
      await q(`INSERT INTO households (id, org_id, name, primary_donor_id, joint_acknowledgment, created_by, created_by_name)
               VALUES ($1, $2, $3, $4, true, 'system:fix49-households', 'Steward (one household grouping)')`,
        [hh, p.org_id, last ? `The ${last} Household` : "Household", A.id]);
      made++;
    }
    await q(`UPDATE donors SET household_id = $1 WHERE org_id = $2 AND id = ANY($3) AND household_id IS NULL`, [hh, p.org_id, [p.a, p.b]]);
    joined++;
  }
  if (joined || apart) console.log(`[fix-49] households: ${joined} linked pair(s) put in one household (${made} new); ${apart} pair(s) already in two different households, left as they are`);
  return { joined, made, apart };
}
// SPLIT-2 end
// SPLIT-2 db.js piece 52

// NUMBERS-2 · called by the schema init and after the boot seed.
async function keepEarlierTotals(pool, orgId = null) {
  // `orgId` narrows it to one org (the boot seed runs on every boot, prod
  // included, and may only ever touch its own fixture org).
  const only = orgId ? [orgId] : [];
  // A person already carrying a stored total above their gifts (a donor file
  // or the quick-add form, before this build) keeps exactly the Lifetime they
  // show today: the difference becomes the imported total, covering the days
  // before their first gift on file, so every gift on file still counts.
  await pool.query(`
    UPDATE donors d SET
      imported_total = d.total_giving - COALESCE(g.t, 0),
      imported_gift_count = NULLIF(GREATEST(COALESCE(d.gift_count, 0) - COALESCE(g.n, 0), 0), 0),
      imported_first_gift_date = CASE WHEN NULLIF(d.first_gift_date, '') < COALESCE(g.first, '9999') THEN d.first_gift_date END,
      imported_last_gift_date = CASE WHEN g.first IS NULL THEN NULLIF(d.last_gift_date, '') END,
      imported_last_gift_amount = CASE WHEN g.first IS NULL AND NULLIF(d.last_gift_date, '') IS NOT NULL THEN d.last_gift_amount END,
      imported_through = CASE WHEN g.first IS NOT NULL THEN to_char(g.first::date - 1, 'YYYY-MM-DD')
                              ELSE COALESCE(NULLIF(d.last_gift_date, ''), to_char(d.created_at, 'YYYY-MM-DD')) END,
      imported_source = 'an earlier import',
      imported_on = to_char(d.created_at, 'YYYY-MM-DD')
    FROM donors dd LEFT JOIN (SELECT donor_id, org_id, SUM(amount) AS t, COUNT(*) FILTER (WHERE amount > 0) AS n,
                                     MIN(date) FILTER (WHERE amount > 0) AS first
                                FROM gifts GROUP BY donor_id, org_id) g ON g.donor_id = dd.id AND g.org_id = dd.org_id
    WHERE d.id = dd.id AND d.imported_total IS NULL AND d.is_sample IS NOT TRUE
      AND d.total_giving > COALESCE(g.t, 0)${orgId ? " AND d.org_id = $1" : " AND d.org_id <> 'org_creo'"}
  `, only);
  // The first gift, from the gifts above zero in the person's own org, and the
  // old system's first gift when it is older (FIX-49: its last gift date when
  // the file gave no first one). Kept by the one statement since.
  await pool.query(`
    UPDATE donors d
    SET first_gift_date = NULLIF(LEAST(COALESCE(${require("../../donorSummary").IMPORTED_FIRST("d")}, '9999-12-31'),
      COALESCE((SELECT MIN(g.date) FROM gifts g WHERE g.donor_id = d.id AND g.org_id = d.org_id AND g.amount > 0), '9999-12-31')), '9999-12-31')
    WHERE d.first_gift_date IS DISTINCT FROM NULLIF(LEAST(COALESCE(${require("../../donorSummary").IMPORTED_FIRST("d")}, '9999-12-31'),
      COALESCE((SELECT MIN(g.date) FROM gifts g WHERE g.donor_id = d.id AND g.org_id = d.org_id AND g.amount > 0), '9999-12-31')), '9999-12-31')
      AND (d.imported_total IS NOT NULL OR EXISTS (SELECT 1 FROM gifts g WHERE g.donor_id = d.id AND g.org_id = d.org_id AND g.amount > 0))${orgId ? " AND d.org_id = $1" : " AND d.org_id <> 'org_creo'"}
  `, only);
}
// SPLIT-2 end
// SPLIT-2 db.js piece 53

async function seedData() {
  const orgId = "org_creo";
  const userId = "user_admin";

  await pool.query(
    `INSERT INTO orgs (id, name, mission, ein, onboarding_complete)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
    [orgId, "CREO Arts", "Transformative arts education for underserved NYC youth", "47-1234567", 1]
  );

  const hash = bcrypt.hashSync("demo1234", 10);
  await pool.query(
    // BUILD-86 C.3 — a REAL first name. The greeting, the actor stamp on every
    // write and the officer chip on every row all render this; "Admin User" on
    // a demo screen tells a prospect they are looking at a fixture.
    //
    // BUILD-87 F.3.7 — AND IT HAS TO REACH THE ORG THAT ALREADY EXISTS. C.3
    // changed the literal and stopped there, so a fresh scratch database got
    // the real name and PRODUCTION's demo org — created long before, and
    // therefore hitting `ON CONFLICT DO NOTHING` on every boot since — kept
    // saying "Admin User" on every row. That is what was on the screen on 16
    // September. The name is the ONE column this upsert may correct: the
    // password, the email and the role are somebody's login and stay put.
    `INSERT INTO users (id, org_id, email, password_hash, name, role)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
    [userId, orgId, "admin@creoarts.org", hash, "Mike Henderson", "admin"]
  );

  // ── BUILD-92 A1 — THE DEMO ORG'S OWN WORDS, ON A FRESH DATABASE ──────────
  // BUILD-86 Part B gave the demo org Heart of Africa's vocabulary, but only
  // through `scripts/once/seed-build86-vocabulary.js`, run by hand against one
  // server. A fresh database therefore came up saying "donors" and "funds" —
  // the generic words BUILD-86 exists to avoid — until somebody remembered to
  // run the script. The words belong to the seed.
  //   Keys are exactly shared/vocabulary.js's VOCAB_KEYS; the values are the
  // ones in that script, kept in step with it.
  //   `WHERE vocabulary_json IS NULL` is what makes this idempotent AND safe:
  // an org that has answered the vocabulary questions (including this demo org
  // once somebody edits it in Settings) is never overwritten on a later boot.
  await pool.query(
    `UPDATE orgs SET vocabulary_json = $2, vocabulary_set_at = NOW()
      WHERE id = $1 AND vocabulary_json IS NULL`,
    [orgId, JSON.stringify({
      giver_singular: "sponsor",
      giver_plural: "sponsors",
      monthly_giver_singular: "sponsor",
      monthly_giver_plural: "sponsors",
      fund_singular: "designation",
      fund_plural: "designations",
      fiscal_year_start_month: 7,
      season_name: "Spring Campaign",
      season_date: "2027-06-30",
    })]
  );

  const donors = [
    ["d1", orgId, "Margaret Chen",         "m.chen@example.com",    "212-555-0101", "major",  "steward",   24500, 5000,  "2024-11-15", 8, '["board-adjacent","arts"]',  "Prefers phone calls. Interested in youth programming. Has mentioned potentially increasing giving this year."],
    ["d2", orgId, "Robert & Lisa Atkinson", "ratkinson@example.com", "917-555-0234", "mid",    "steward",   12000, 3000,  "2025-01-03", 5, '["education","recurring"]',  "Both educators. Very engaged with after-school programs. Anniversary donors."],
    ["d3", orgId, "James Okafor",           "jokafor@example.com",   "646-555-0387", "lapsed", "lapsed",     3200,  500,  "2023-09-22", 4, '["youth"]',                  "Lapsed 18+ months. Was a regular $500 donor. Worth personal outreach."],
    // NUMBERS-1: the six grants seeded below add up to $135,000 (it said $75,000 over 3).
    ["d4", orgId, "Sunrise Foundation",     "grants@sunrisefdn.org", "212-555-0199", "major",  "steward",  135000, 25000, "2025-03-01", 6, '["foundation","arts"]',      "Program officer is Angela Wu. Next grant cycle opens September."],
    ["d5", orgId, "Diana Torres",           "dtorres@example.com",   "718-555-0421", "new",    "cultivate",   850,  250,  "2025-02-14", 3, '["online"]',                 "Online donor via Instagram. Young professional. Good upgrade potential."],
    ["d6", orgId, "William Park",           "wpark@example.com",     "347-555-0512", "mid",    "solicit",    6700, 1000,  "2024-06-30", 7, '["recurring","arts"]',       "Long-time supporter. Consistent annual donor. Approaching 11 months since last gift."],
  ];
  for (const d of donors) {
    await pool.query(
      `INSERT INTO donors (id,org_id,name,email,phone,status,stage,total_giving,last_gift_amount,last_gift_date,gift_count,tags,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (id) DO NOTHING`,
      d
    );
  }

  const interactions = [
    ["i1", orgId, "d1", "gift",    "Annual major gift $5,000",                      "2024-11-15"],
    ["i2", orgId, "d1", "call",    "Cultivation call - discussed new mural program", "2024-09-10"],
    ["i3", orgId, "d1", "event",   "Attended spring gala, table host",               "2024-06-01"],
    ["i4", orgId, "d2", "gift",    "Annual gift $3,000",                             "2025-01-03"],
    ["i5", orgId, "d3", "gift",    "Last donation $500",                             "2023-09-22"],
    ["i6", orgId, "d4", "meeting", "Site visit with Angela Wu",                      "2025-02-15"],
    ["i7", orgId, "d4", "gift",    "Annual grant $25,000",                           "2025-03-01"],
  ];
  for (const i of interactions) {
    await pool.query(
      `INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,null) ON CONFLICT (id) DO NOTHING`,
      i
    );
  }

  const grants = [
    ["g1", orgId, "NEA",                      "Arts Education Initiative", 35000, 35000, "active",      "2025-06-30", "2025-07-15", "Sarah Kim",    "Final report pending.",                          '["2023: $30,000","2024: $35,000"]'],
    ["g2", orgId, "NY Community Trust",        "Youth Development",         50000, 25000, "active",      "2025-12-31", "2026-01-15", "Marcus Reid",  "Mid-year report submitted.",                     '["2024: $40,000"]'],
    ["g3", orgId, "Rockefeller Brothers Fund", "Cultural Innovation",        20000,     0, "pending",     "2025-08-01", null,         "Angela Moore", "LOI submitted. Full proposal invited.",           '["First-time applicant"]'],
    ["g4", orgId, "City Council",              "Cultural Programs FY25",    15000, 15000, "closed",      "2024-12-31", "2025-02-01", "James Liu",    "Completed. FY26 opens July.",                    '["2023: $12,000","2024: $15,000"]'],
    ["g5", orgId, "Ford Foundation",           "Creative Communities",     100000,     0, "prospecting", "2025-09-15", null,         "Sarah Kim",    "Competitive. Need strong theory of change.",      '["First-time applicant"]'],
  ];
  for (const g of grants) {
    await pool.query(
      `INSERT INTO grants (id,org_id,funder,program,amount,received,status,deadline,report_due,officer,notes,history)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING`,
      g
    );
  }

  const volunteers = [
    ["v1", orgId, "Priya Nair",    "pnair@example.com",   84,  '["event coordination","social media"]', "2025-04-12", null,  "high",      "Google",   "Very enthusiastic. Works in tech, capacity likely $500-1000 first gift."],
    ["v2", orgId, "Carlos Mendez", "cmendez@example.com", 210, '["teaching","curriculum"]',             "2025-05-01", null,  "high",      "NYC DOE",  "Most dedicated volunteer. Teaches after-school weekly. Deep mission alignment."],
    ["v3", orgId, "Sophie Laurent","slaurent@example.com",  32, '["design","photography"]',             "2025-03-20", null,  "medium",    "Freelance","Provided design work for annual report."],
    ["v4", orgId, "Devon Brooks",  "dbrooks@example.com", 156, '["accounting","admin"]',                "2025-04-28", "d3", "converted", "Deloitte", "Already a donor. Helps with books quarterly. Strong board candidate."],
  ];
  for (const v of volunteers) {
    await pool.query(
      `INSERT INTO volunteers (id,org_id,name,email,hours,skills,last_active,donor_id,convert_potential,employer,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO NOTHING`,
      v
    );
  }

  const tasks = [
    ["t1", orgId, "Call Margaret Chen: major gift conversation", "2025-05-23", "high",   "donor",     0, "d1"],
    ["t2", orgId, "Submit NEA final report",                      "2025-07-15", "high",   "grant",     0, null],
    ["t3", orgId, "Follow up: Rockefeller LOI status",            "2025-06-01", "medium", "grant",     0, null],
    ["t4", orgId, "Re-engage James Okafor (lapsed 18mo)",         "2025-05-28", "medium", "donor",     0, "d3"],
    ["t5", orgId, "Board packet: Q2 financials",                 "2025-05-30", "high",   "board",     0, null],
    ["t6", orgId, "Volunteer appreciation event planning",        "2025-06-15", "low",    "volunteer", 1, null],
  ];
  for (const t of tasks) {
    await pool.query(
      `INSERT INTO tasks (id,org_id,title,due,priority,type,done,donor_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
      t
    );
  }

  const board = [
    ["b1", orgId, "Dr. Angela Washington", "Chair",     "Columbia University",            "2023-2026", "$10,000", '["Executive","Finance"]',   92],
    ["b2", orgId, "Marcus Powell",          "Treasurer", "JPMorgan Chase",                 "2022-2025", "$5,000",  '["Finance","Audit"]',       100],
    ["b3", orgId, "Keisha Brown",           "Secretary", "Brooklyn Community Foundation",  "2024-2027", "$2,500",  '["Programs","DEI"]',         83],
    ["b4", orgId, "Tom Ricci",              "Member",    "Ricci Architecture",             "2023-2026", "$5,000",  '["Facilities","Executive"]', 75],
    ["b5", orgId, "Yun Li",                 "Member",    "Goldman Sachs",                  "2024-2027", "$7,500",  '["Finance","Fundraising"]',  92],
  ];
  for (const b of board) {
    await pool.query(
      `INSERT INTO board_members (id,org_id,name,role,employer,term,giving_level,committees,attendance)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
      b
    );
  }

  const months = [
    ["f1", orgId, "Jan", 2025,  8200, 12000,    0,  500, 14000, 4200, 2100],
    ["f2", orgId, "Feb", 2025,  5400,     0,    0,  200, 13500, 4200, 1800],
    ["f3", orgId, "Mar", 2025, 11000, 25000, 4200,  800, 15200, 4400, 3200],
    ["f4", orgId, "Apr", 2025,  7300,     0,    0,  300, 14800, 4200, 2400],
    ["f5", orgId, "May", 2025,  9100,     0,    0,  150, 15100, 4300, 2200],
  ];
  for (const m of months) {
    await pool.query(
      `INSERT INTO financials (id,org_id,month,year,individual,grants,events,other_revenue,programs,admin,fundraising)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO NOTHING`,
      m
    );
  }

  const funds = [
    ["fn1", orgId, "General Operating",          42000, 0],
    ["fn2", orgId, "NEA Arts Education",          35000, 1],
    ["fn3", orgId, "NY Community Trust: Youth",  25000, 1],
    ["fn4", orgId, "Gala Reserve",                 8200, 0],
  ];
  for (const f of funds) {
    await pool.query(
      `INSERT INTO funds (id,org_id,name,balance,restricted)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
      f
    );
  }

  // ── Gift history (for annual fund dashboard) ────────────────────────────
  const gifts = [
    ["gft_23_01", orgId, "d1", 4000,  "2023-10-15", "cash",   "Annual Appeal",      ""],
    ["gft_23_02", orgId, "d2", 2500,  "2023-01-10", "check",  "Annual Fund",         ""],
    ["gft_23_03", orgId, "d3",  500,  "2023-09-22", "cash",   "General",             ""],
    ["gft_23_04", orgId, "d4", 20000, "2023-03-15", "wire",   "NEA Grant",           ""],
    ["gft_23_05", orgId, "d6", 1000,  "2023-07-01", "cash",   "Mid-Year",            ""],
    ["gft_23_06", orgId, "d1", 2000,  "2023-06-01", "cash",   "Gala",                ""],
    ["gft_23_07", orgId, "d4", 15000, "2023-09-01", "wire",   "Community Trust",     ""],
    ["gft_24_01", orgId, "d1", 5000,  "2024-11-15", "cash",   "Annual Major Gift",   ""],
    ["gft_24_02", orgId, "d2", 2800,  "2024-01-08", "check",  "Annual Fund",         ""],
    ["gft_24_03", orgId, "d4", 25000, "2024-03-01", "wire",   "NEA Grant",           ""],
    ["gft_24_04", orgId, "d5",  250,  "2024-12-15", "online", "Holiday Appeal",      ""],
    ["gft_24_05", orgId, "d6", 1000,  "2024-06-30", "cash",   "Mid-Year",            ""],
    ["gft_24_06", orgId, "d1", 2000,  "2024-06-01", "cash",   "Gala",                ""],
    ["gft_24_07", orgId, "d4", 25000, "2024-10-01", "wire",   "Community Trust",     ""],
    ["gft_24_08", orgId, "d2",  500,  "2024-08-20", "online", "Giving Tuesday",      ""],
    ["gft_25_01", orgId, "d2", 3000,  "2025-01-03", "check",  "Annual Fund",         ""],
    ["gft_25_02", orgId, "d4", 25000, "2025-03-01", "wire",   "NEA Grant",           ""],
    ["gft_25_03", orgId, "d5",  250,  "2025-02-14", "online", "Valentine Appeal",    ""],
    ["gft_25_04", orgId, "d4", 25000, "2025-01-15", "wire",   "Community Trust Q1",  ""],
    ["gft_25_05", orgId, "d1", 1500,  "2025-04-05", "cash",   "Spring Appeal",       ""],
    ["gft_25_06", orgId, "d6",  600,  "2025-03-15", "online", "Spring Campaign",     ""],
  ];
  for (const g of gifts) {
    await pool.query(
      `INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
      g
    );
  }

  // ── Programs ────────────────────────────────────────────────────────────
  const programs = [
    [
      "prg_01", orgId, "After-School Arts",
      "Weekly arts education for K-8 students in underserved neighborhoods",
      85000, 52000, '["Carlos Mendez","Sophie Laurent"]', 120,
      "2024-09-01", "2025-06-30", "active",
      "Students showed 40% improvement in creative confidence assessments. Program served 120 students across 4 schools in Brooklyn and the Bronx.",
      '{"students_served":120,"schools":4,"sessions_completed":28,"avg_attendance_rate":"87%"}'
    ],
    [
      "prg_02", orgId, "Summer Intensive",
      "6-week intensive program for advanced students ages 14-18, focusing on portfolio development and college readiness.",
      45000, 18000, '["Carlos Mendez"]', 32,
      "2025-07-07", "2025-08-15", "planning",
      "Builds on after-school skills with college-prep portfolio development. Target: 85% of students complete portfolio.",
      '{"students_enrolled":32,"portfolio_completion_target":"100%","college_readiness_goal":"85%"}'
    ],
  ];
  for (const p of programs) {
    await pool.query(
      `INSERT INTO programs (id,org_id,name,description,budget,spent,staff,participant_count,start_date,end_date,status,outcomes,metrics)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (id) DO NOTHING`,
      p
    );
  }

  // ── Annual fund goal ─────────────────────────────────────────────────────
  await pool.query(
    `INSERT INTO annual_fund_goals (id,org_id,year,goal)
     VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`,
    ["afg_01", orgId, 2025, 250000]
  );

  // ── Draft campaign ────────────────────────────────────────────────────────
  await pool.query(
    `INSERT INTO campaigns (id,org_id,name,type,subject,body,status,segment,recipient_count,open_count)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`,
    [
      "cmp_01", orgId, "Spring Appeal 2025", "appeal",
      "Help us reach 120 more students, a message from CREO Arts",
      "Dear {{donor_name}},\n\nYour support has made an incredible difference. This year, CREO Arts served 120 students across 4 NYC schools.\n\nAs we plan for fall, we need your help to expand our reach. A gift of any size helps us purchase art supplies, pay teaching artists, and keep our programs free for students who need them most.\n\nYour previous gift of {{gift_amount}} made a real impact. Will you renew your support today?\n\nWith gratitude,\nThe CREO Arts Team",
      "draft",
      '{"stages":["steward","solicit"],"statuses":["major","mid"]}',
      0, 0
    ]
  );

  // ── Chart of Accounts ────────────────────────────────────────────────────
  const chartOfAccounts = [
    ["acc_1010", orgId, "1010", "Cash & Cash Equivalents",            "asset",     "current"],
    ["acc_1020", orgId, "1020", "Savings / Reserve Account",          "asset",     "current"],
    ["acc_1100", orgId, "1100", "Accounts Receivable",                "asset",     "current"],
    ["acc_1200", orgId, "1200", "Prepaid Expenses",                   "asset",     "current"],
    ["acc_2010", orgId, "2010", "Accounts Payable",                   "liability", "current"],
    ["acc_2100", orgId, "2100", "Accrued Expenses",                   "liability", "current"],
    ["acc_2200", orgId, "2200", "Deferred Revenue",                   "liability", "current"],
    ["acc_3010", orgId, "3010", "Unrestricted Net Assets",            "net_asset", "unrestricted"],
    ["acc_3100", orgId, "3100", "Temporarily Restricted Net Assets",  "net_asset", "restricted"],
    ["acc_3200", orgId, "3200", "Permanently Restricted Net Assets",  "net_asset", "restricted"],
    ["acc_4010", orgId, "4010", "Individual Contributions",           "revenue",   "contributions"],
    ["acc_4020", orgId, "4020", "Foundation Grants",                  "revenue",   "grants"],
    ["acc_4030", orgId, "4030", "Government Grants",                  "revenue",   "grants"],
    ["acc_4040", orgId, "4040", "Program Revenue",                    "revenue",   "program"],
    ["acc_4050", orgId, "4050", "Special Events Revenue",             "revenue",   "events"],
    ["acc_4060", orgId, "4060", "Other Revenue",                      "revenue",   "other"],
    ["acc_5010", orgId, "5010", "Program Services: Salaries",        "expense",   "program"],
    ["acc_5020", orgId, "5020", "Program Services: Supplies",        "expense",   "program"],
    ["acc_5030", orgId, "5030", "Program Services: Contractors",     "expense",   "program"],
    ["acc_5040", orgId, "5040", "Program Services: Occupancy",       "expense",   "program"],
    ["acc_6010", orgId, "6010", "Management & General: Salaries",    "expense",   "management"],
    ["acc_6020", orgId, "6020", "Management & General: Admin",       "expense",   "management"],
    ["acc_6030", orgId, "6030", "Management & General: Technology",  "expense",   "management"],
    ["acc_7010", orgId, "7010", "Fundraising: Salaries",             "expense",   "fundraising"],
    ["acc_7020", orgId, "7020", "Fundraising: Events",               "expense",   "fundraising"],
    ["acc_7030", orgId, "7030", "Fundraising: Marketing",            "expense",   "fundraising"],
  ];
  for (const a of chartOfAccounts) {
    await pool.query(
      `INSERT INTO accounts (id,org_id,code,name,type,subtype)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
      a
    );
  }

  // ── Finance Funds ─────────────────────────────────────────────────────────
  const finFunds = [
    ["ff_01", orgId, "General Operating",         "General unrestricted operating fund", false],
    ["ff_02", orgId, "NEA Arts Education",         "NEA grant: restricted to arts education programs", true],
    ["ff_03", orgId, "NY Community Trust: Youth", "Community Trust grant: restricted to youth development", true],
    ["ff_04", orgId, "Gala Reserve",              "Board-designated reserve for annual gala", false],
  ];
  for (const f of finFunds) {
    await pool.query(
      `INSERT INTO fin_funds (id,org_id,name,description,restricted)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
      f
    );
  }

  // ── Sample Transactions 2025 ──────────────────────────────────────────────
  const finTxns = [
    ["ft_01", orgId, "2025-01-03",  "Annual Fund Gift: Atkinson",        "Robert Atkinson",       3000,  "income",  "acc_4010", "ff_01"],
    ["ft_02", orgId, "2025-01-15",  "Community Trust Q1 Disbursement",    "NY Community Trust",    25000, "income",  "acc_4020", "ff_03"],
    ["ft_03", orgId, "2025-02-14",  "Valentine Appeal: Torres",          "Diana Torres",          250,   "income",  "acc_4010", "ff_01"],
    ["ft_04", orgId, "2025-03-01",  "NEA Spring Disbursement",            "NEA",                   25000, "income",  "acc_4030", "ff_02"],
    ["ft_05", orgId, "2025-04-05",  "Spring Appeal: Chen",               "Margaret Chen",         1500,  "income",  "acc_4010", "ff_01"],
    ["ft_06", orgId, "2025-03-15",  "Spring Campaign: Park",             "William Park",          600,   "income",  "acc_4010", "ff_01"],
    ["ft_07", orgId, "2025-05-10",  "Foundation Grant: Q2",              "Sunrise Foundation",    10000, "income",  "acc_4020", "ff_02"],
    ["ft_08", orgId, "2025-01-15",  "Program Staff: January",            "Payroll",               8500,  "expense", "acc_5010", "ff_01"],
    ["ft_09", orgId, "2025-01-20",  "Art Supplies: Q1",                  "Blick Art Materials",   1200,  "expense", "acc_5020", "ff_02"],
    ["ft_10", orgId, "2025-01-31",  "Office Rent: January",              "123 Main St LLC",       3200,  "expense", "acc_5040", "ff_01"],
    ["ft_11", orgId, "2025-02-15",  "Program Staff: February",           "Payroll",               8500,  "expense", "acc_5010", "ff_01"],
    ["ft_12", orgId, "2025-02-28",  "Office Rent: February",             "123 Main St LLC",       3200,  "expense", "acc_5040", "ff_01"],
    ["ft_13", orgId, "2025-03-15",  "Program Staff: March",              "Payroll",               8500,  "expense", "acc_5010", "ff_01"],
    ["ft_14", orgId, "2025-03-20",  "Admin Software: Q1",               "Quickbooks, Zoom",      450,   "expense", "acc_6030", "ff_01"],
    ["ft_15", orgId, "2025-03-31",  "Office Rent: March",                "123 Main St LLC",       3200,  "expense", "acc_5040", "ff_01"],
    ["ft_16", orgId, "2025-04-15",  "Program Staff: April",              "Payroll",               8500,  "expense", "acc_5010", "ff_02"],
    ["ft_17", orgId, "2025-04-20",  "Teaching Artist Contractors",        "Carlos Mendez",         3000,  "expense", "acc_5030", "ff_02"],
    ["ft_18", orgId, "2025-04-30",  "Office Rent: April",                "123 Main St LLC",       3200,  "expense", "acc_5040", "ff_01"],
    ["ft_19", orgId, "2025-05-15",  "Program Staff: May",                "Payroll",               8500,  "expense", "acc_5010", "ff_01"],
    ["ft_20", orgId, "2025-05-20",  "Spring Gala Expenses",               "Event Venue",           4200,  "expense", "acc_7020", "ff_04"],
  ];
  for (const t of finTxns) {
    await pool.query(
      `INSERT INTO fin_transactions (id,org_id,date,description,vendor_donor,amount,type,account_id,fund_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
      t
    );
  }

  // ── Annual Budgets 2025 ────────────────────────────────────────────────────
  const budgets2025 = [
    ["bgt_4010", orgId, "acc_4010", 2025, 75000],
    ["bgt_4020", orgId, "acc_4020", 2025, 60000],
    ["bgt_4030", orgId, "acc_4030", 2025, 50000],
    ["bgt_4050", orgId, "acc_4050", 2025, 12000],
    ["bgt_5010", orgId, "acc_5010", 2025, 102000],
    ["bgt_5020", orgId, "acc_5020", 2025, 12000],
    ["bgt_5030", orgId, "acc_5030", 2025, 24000],
    ["bgt_5040", orgId, "acc_5040", 2025, 38400],
    ["bgt_6010", orgId, "acc_6010", 2025, 48000],
    ["bgt_6020", orgId, "acc_6020", 2025, 6000],
    ["bgt_6030", orgId, "acc_6030", 2025, 3600],
    ["bgt_7010", orgId, "acc_7010", 2025, 18000],
    ["bgt_7020", orgId, "acc_7020", 2025, 8000],
    ["bgt_7030", orgId, "acc_7030", 2025, 4000],
  ];
  for (const b of budgets2025) {
    await pool.query(
      // BUILD-92 A1 — the conflict target must name the index that SURVIVES.
      // The CREATE TABLE above declares UNIQUE (org_id, account_id, year), but
      // the BUILD-88a fund migration (this file, "A BUDGET HAS A FUND") DROPS
      // that constraint and replaces it with budgets_account_year_fund on
      // (org_id, account_id, year, COALESCE(fund_id, '')). Naming the dropped
      // three-column target threw 42P10 on every boot, and because seedData is
      // one un-chunked async function that aborted the WHOLE REST of the demo
      // seed. These rows are the general, unfunded budget — one per
      // org/account/year with no fund — so COALESCE(fund_id,'') is exactly
      // right, and matches the upsert in server.js's budget route. FIX-60:
      // the surviving index is now budgets_account_year_fund_basis, which adds
      // COALESCE(basis,'calendar'); these rows carry no basis, so calendar.
      `INSERT INTO budgets (id,org_id,account_id,year,amount)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (org_id, account_id, year, COALESCE(fund_id, ''), COALESCE(basis, 'calendar')) DO NOTHING`,
      b
    );
  }

  // ── Program grants ────────────────────────────────────────────────────────
  const programGrants = [
    ["pg_01", orgId, "prg_01", "g1", 35000],
    ["pg_02", orgId, "prg_01", "g2", 25000],
  ];
  for (const pg of programGrants) {
    await pool.query(
      `INSERT INTO program_grants (id,org_id,program_id,grant_id,allocated)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (program_id, grant_id) DO NOTHING`,
      pg
    );
  }

  // ── Impact metrics (for milestone/anniversary donor emails) ────────────────
  const impactMetrics = [
    ["im_01", orgId, "Art Supplies Kit", 50, "Your ${amount} has provided art supplies kits for {n} students"],
    ["im_02", orgId, "After-School Workshop", 300, "Your ${amount} has funded {n} after-school arts workshops"],
    ["im_03", orgId, "Full-Year Scholarship", 2500, "Your ${amount} has covered {n} full-year arts program scholarships"],
  ];
  for (const m of impactMetrics) {
    await pool.query(
      `INSERT INTO impact_metrics (id,org_id,name,dollar_threshold,outcome_template)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
      m
    );
  }

  // ── Dashboard revamp enrichment (2026-07) ─────────────────────────────────
  // org_creo's real donor set (CSV-imported at some point post-launch) only
  // ever lands in 'cultivate' or 'lapsed' — inferStage() never assigns
  // qualify/solicit, and cultivate/lapsed dominate. These fill out the other
  // four pipeline stages, add grants with deadlines that are actually still
  // in the future, some recent activity, and a few pending milestone_drafts
  // so the Dashboard's new milestone widget has real content. Dates are
  // computed relative to seed time rather than hardcoded, so they don't go
  // stale the way g1-g5's 2025 deadlines did.
  // ORG_TZ_SEAM_OK — org_creo sits in the seam's default zone; a seed run in
  // the UTC evening must not date everything for tomorrow.
  const seedToday = orgTime.orgToday({});
  const seedAgo = n => orgTime.addDays(seedToday, -n);
  const seedFromNow = n => orgTime.addDays(seedToday, n);

  const stageDonors = [
    ["dseed_01", orgId, "Priya Anand",     "panand@example.com",    "212-555-0801", "new",   "prospect", 0,     null, null,         0, '["board-referral"]', "Introduced by a board member at the spring gala. Not yet engaged.", null],
    ["dseed_02", orgId, "Marcus Webb",     "mwebb@example.com",     "718-555-0802", "new",   "prospect", 0,     null, null,         0, '["cold"]',           "Identified via prospect research. Local business owner, arts-adjacent.", null],
    ["dseed_03", orgId, "Renee Castillo",  "rcastillo@example.com", "347-555-0803", "new",   "qualify",  0,     null, null,         0, '["referral"]',       "Researching giving capacity. Attended an info session, hasn't given yet.", null],
    ["dseed_04", orgId, "Owen Bishop",     "obishop@example.com",   "929-555-0804", "new",   "qualify",  250,   250,  seedAgo(40),  1, '["first-gift"]',     "Made a small first gift after the winter showcase. Assessing upgrade potential.", seedAgo(40)],
    ["dseed_05", orgId, "Vanessa Cole",    "vcole@example.com",     "917-555-0805", "mid",   "solicit",  8000,  3000, seedAgo(200), 2, '["arts","overdue"]', "Ready for the ask, capacity signals are strong. Overdue for a follow-up call.", seedAgo(650)],
    ["dseed_06", orgId, "Julian Marsh",    "jmarsh@example.com",    "646-555-0806", "mid",   "solicit",  15000, 5000, seedAgo(150), 2, '["recurring"]',      "Consistent annual donor, due for this year's ask conversation.", seedAgo(900)],
    ["dseed_07", orgId, "Camille Torres",  "ctorres@example.com",   "212-555-0807", "mid",   "steward",  3200,  500,  seedAgo(20),  3, '["arts","loyal"]',   "Just crossed $2,500 lifetime giving. Warm relationship, steady giver.", seedAgo(920)],
    ["dseed_08", orgId, "Nathaniel Cross", "ncross@example.com",    "718-555-0808", "new",   "steward",  1050,  300,  seedAgo(35),  2, '["arts"]',           "Recently crossed $1,000 lifetime giving. Responsive to email outreach.", seedAgo(410)],
    ["dseed_09", orgId, "Elena Marchetti", "emarchetti@example.com","212-555-0809", "major", "steward",  12500, 5000, seedAgo(15),  3, '["arts","loyal"]',   "Just crossed $10,000 lifetime giving. High-touch relationship, board-adjacent.", seedAgo(1000)],
  ];
  for (const d of stageDonors) {
    await pool.query(
      `INSERT INTO donors (id,org_id,name,email,phone,status,stage,total_giving,last_gift_amount,last_gift_date,gift_count,tags,notes,first_gift_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (id) DO NOTHING`,
      d
    );
  }

  const stageGifts = [
    ["gftseed_04a", orgId, "dseed_04", 250,  seedAgo(40),   "online", "Winter Showcase",  ""],
    ["gftseed_05a", orgId, "dseed_05", 3000, seedAgo(200),  "check",  "Annual Fund",       ""],
    ["gftseed_05b", orgId, "dseed_05", 5000, seedAgo(650),  "check",  "Gala",              ""],
    ["gftseed_06a", orgId, "dseed_06", 5000, seedAgo(150),  "wire",   "Annual Fund",       ""],
    ["gftseed_06b", orgId, "dseed_06", 10000,seedAgo(900),  "wire",   "Capital Campaign",  ""],
    ["gftseed_07a", orgId, "dseed_07", 500,  seedAgo(20),   "online", "Spring Appeal",     ""],
    ["gftseed_07b", orgId, "dseed_07", 700,  seedAgo(300),  "cash",   "Gala",              ""],
    ["gftseed_07c", orgId, "dseed_07", 2000, seedAgo(920),  "check",  "Annual Fund",       ""],
    ["gftseed_08a", orgId, "dseed_08", 300,  seedAgo(35),   "online", "Spring Appeal",     ""],
    ["gftseed_08b", orgId, "dseed_08", 750,  seedAgo(410),  "cash",   "Annual Fund",       ""],
    ["gftseed_09a", orgId, "dseed_09", 5000, seedAgo(15),   "check",  "Annual Major Gift", ""],
    ["gftseed_09b", orgId, "dseed_09", 4500, seedAgo(400),  "check",  "Capital Campaign",  ""],
    ["gftseed_09c", orgId, "dseed_09", 3000, seedAgo(1000), "check",  "Annual Fund",       ""],
  ];
  for (const g of stageGifts) {
    await pool.query(
      `INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
      g
    );
  }

  // A couple of grants with real near-future deadlines — g1-g5 above are all
  // 2025-dated and have long since passed, which is why the Dashboard's
  // Grant Deadlines widget always read empty.
  const upcomingGrants = [
    ["gseed_01", orgId, "Robert Wood Johnson Foundation", "Arts & Wellbeing Initiative", 45000, 0, "pending",     seedFromNow(12), null, "Dana Whitfield", "LOI accepted, full proposal under review.", '["First-time applicant"]'],
    ["gseed_02", orgId, "Mellon Foundation",               "Community Arts Access",       60000, 0, "prospecting", seedFromNow(25), null, "Priya Raman",    "Site visit completed; decision expected soon.", '["First-time applicant"]'],
  ];
  for (const g of upcomingGrants) {
    await pool.query(
      `INSERT INTO grants (id,org_id,funder,program,amount,received,status,deadline,report_due,officer,notes,history)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING`,
      g
    );
  }

  // Recent activity so the Dashboard feed isn't empty
  const recentActivity = [
    ["iseed_01", orgId, "dseed_07", "gift",    "Gift received: $500 (Spring Appeal)",                                                                        seedAgo(20)],
    ["iseed_02", orgId, "dseed_07", "call",    "Thank-you call for recent gift, warm response",                                                              seedAgo(18)],
    ["iseed_03", orgId, "dseed_08", "email",   "Subject: Thank you for your generous support\n\nSo grateful for your continued generosity toward our after-school program.", seedAgo(9)],
    ["iseed_04", orgId, "dseed_09", "meeting", "Coffee meeting: discussed fall gala sponsorship",                                                             seedAgo(5)],
    ["iseed_05", orgId, "dseed_05", "call",    "Cultivation call: discussed program impact, gauging interest in a leadership gift",                          seedAgo(13)],
    ["iseed_06", orgId, "dseed_02", "note",    "Introduced by board member; interested in youth arts programming",                                            seedAgo(2)],
  ];
  for (const i of recentActivity) {
    await pool.query(
      `INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,null) ON CONFLICT (id) DO NOTHING`,
      i
    );
  }

  // Pending milestone drafts — populates the Dashboard's new review-queue
  // widget with real content on first load instead of another empty state.
  // Mirrors what generateMilestoneDraft() would actually produce: warm,
  // specific, no gamification language.
  const milestoneDrafts = [
    ["mdseed_01", orgId, "dseed_07", null, "threshold_2500",
     "Camille, a quick thank you",
     "Camille, I wanted to pause and let you know you've now given $3,200 with us. That total has now covered a full year of scholarship support for one of our students. It's donors like you, giving steadily and thoughtfully, who make that kind of continuity possible. Thank you for sticking with us.",
     "pending_review"],
    ["mdseed_02", orgId, "dseed_08", null, "threshold_1000",
     "Nathaniel: a thank you at $1,000",
     "Nathaniel, you've now given $1,050 total, and that's enough to fund three after-school arts workshops for our students. I don't think we've properly thanked you for how consistent you've been. It matters more than you probably realize. Thank you.",
     "pending_review"],
    // Elena's $10,000 crossing is NOT here — per the Phase 2 note/email split
    // (isNoteMoment() in server.js), $10k+ thresholds get a "write a note"
    // reminder instead of an AI-drafted email. See noteReminders below.
  ];
  for (const m of milestoneDrafts) {
    await pool.query(
      `INSERT INTO milestone_drafts (id,org_id,donor_id,sequence_enrollment_id,milestone_key,subject,body,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
      m
    );
  }

  // Personal-note reminders — real, computed talking points (not AI-drafted
  // text) for the org's highest-value/most-personal milestone moments.
  // Mirrors the shape computeNoteTalkingPoints() would actually produce.
  const elenaFirst = seedAgo(1000); // civil YYYY-MM-DD, via the seam
  const elenaYears = Math.floor(1000 / 365.25);
  const julianLastGift = seedAgo(150);
  const noteReminders = [
    ["notereminder_01", orgId, "dseed_09", null, "threshold_10000", JSON.stringify([
      "Just crossed $10,000 in total lifetime giving ($12,500 total).",
      'From their file: "Just crossed $10,000 lifetime giving. High-touch relationship, board-adjacent."',
      `They've been giving for ${elenaYears} years, since ${orgTime.formatCivil(elenaFirst).replace(/ \d+,/, "")}.`,
    ]), "pending"],
    ["notereminder_02", orgId, "dseed_06", null, "anniversary_year_2", JSON.stringify([
      "This marks their 2-year anniversary with your organization.",
      'From their file: "Consistent annual donor, due for this year\'s ask conversation."',
      `Most recent gift: $5,000 on ${orgTime.formatCivil(julianLastGift)}.`,
    ]), "pending"],
  ];
  for (const n of noteReminders) {
    await pool.query(
      `INSERT INTO note_reminders (id,org_id,donor_id,sequence_enrollment_id,milestone_key,talking_points,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
      n
    );
  }

  // A real active fundraising goal so the home screen's goal banner has
  // something to show on first load instead of the empty state.
  await pool.query(
    `INSERT INTO fundraising_goals (id,org_id,period_start,period_end,goal_type,goal_amount,label)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
    ["goalseed_01", orgId, seedAgo(30), seedFromNow(60), "total_raised", 25000, "Raise $25,000 this quarter"]
  );

  // Historical trend for the stewardship-debt / first-touch-delay metrics —
  // 21 daily points so the home screen's headline number has a real trend
  // to draw on first load, not just today's single value. The synthetic
  // curve is scaled off a baseline computed with the same formula
  // computeStewardshipDebt() uses (mirrored here since server.js isn't
  // importable from db.js), rather than an arbitrary illustrative number —
  // org_creo's real (mostly CSV-imported) donor set makes the actual value
  // much larger than a hand-picked constant, and a mismatched seed curve
  // would show up as a jarring, misleading cliff on the sparkline the first
  // time this endpoint computes the real live number. Debt trending down
  // (staff catching up on outreach); first-touch delay roughly flat.
  const debtBaselineRows = await pool.query(
    `SELECT d.total_giving,
       COALESCE(
         (SELECT MAX(i.date) FROM interactions i WHERE i.donor_id = d.id AND i.type IN ('call','meeting','email','stewardship')),
         d.first_gift_date
       ) AS last_contact
     FROM donors d
     WHERE d.org_id = $1 AND d.deleted_at IS NULL AND d.total_giving > 0`,
    [orgId]
  );
  let debtBaseline = 0;
  for (const row of debtBaselineRows.rows) {
    if (!row.last_contact) continue;
    // civil-days between the stored civil date and the seam's seed today
    const gap = orgTime.daysBetween(String(row.last_contact).slice(0, 10), seedToday);
    if (gap == null) continue;
    const daysSince = Math.max(0, Math.min(1000, gap));
    debtBaseline += (daysSince / 30) * ((Number(row.total_giving) || 0) / 1000);
  }
  debtBaseline = Math.round(debtBaseline) || 400;

  const touchBaselineRows = await pool.query(
    `SELECT d.first_gift_date,
       (SELECT MIN(i.date) FROM interactions i
        WHERE i.donor_id = d.id AND i.type IN ('call','meeting','email','stewardship') AND i.date >= d.first_gift_date) AS first_touch_date
     FROM donors d
     WHERE d.org_id = $1 AND d.deleted_at IS NULL AND d.first_gift_date IS NOT NULL`,
    [orgId]
  );
  let touchTotalDays = 0, touchSampleSize = 0;
  for (const row of touchBaselineRows.rows) {
    if (!row.first_touch_date) continue;
    touchTotalDays += Math.max(0, Math.floor((new Date(row.first_touch_date) - new Date(row.first_gift_date)) / 86400000));
    touchSampleSize++;
  }
  const touchBaseline = touchSampleSize > 0 ? Math.round(touchTotalDays / touchSampleSize) : 6;

  for (let daysAgo = 20; daysAgo >= 0; daysAgo--) {
    const date = seedAgo(daysAgo);
    const debtValue = Math.round(debtBaseline * (1 + daysAgo * 0.018) + Math.sin(daysAgo) * debtBaseline * 0.02);
    const touchValue = Math.max(1, Math.round(touchBaseline * (1 + Math.sin(daysAgo / 3) * 0.15)));
    await pool.query(
      // DO UPDATE (not DO NOTHING) deliberately: this seed shipped once
      // already with an arbitrary, badly-scaled baseline (see comment
      // above) — an already-deployed org's rows need the corrected,
      // data-derived values to actually replace them, not be skipped.
      `INSERT INTO metric_snapshots (id,org_id,metric_key,value,snapshot_date) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (org_id, metric_key, snapshot_date) DO UPDATE SET value = EXCLUDED.value`,
      // Date-stable id (was msseed_debt_${daysAgo}): with a fixed id and a
      // day-shifting date, the FIRST boot of a new day found no
      // (org,key,date) conflict-target match and fell through to the id
      // PRIMARY KEY → 23505 → db init failed → process exit. A crash-loop
      // time bomb on any deploy/restart crossing a date boundary (found
      // live 2026-08-05 on the scratch stack at local midnight). With the
      // date IN the id, an id collision implies a target match — idempotent
      // by construction, every day.
      [`msseed_debt_${date}`, orgId, "stewardship_debt", debtValue, date]
    );
    await pool.query(
      `INSERT INTO metric_snapshots (id,org_id,metric_key,value,snapshot_date) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (org_id, metric_key, snapshot_date) DO UPDATE SET value = EXCLUDED.value`,
      [`msseed_touch_${date}`, orgId, "first_touch_delay", touchValue, date]
    );
  }
  // NUMBERS-2: the fixture's stated totals are kept as their own figure, on a
  // test boot only (org_creo is never written on prod).
  if (process.env.TEST_MODE) {
    await keepEarlierTotals(pool, orgId);
    await pool.query(require("../../donorSummary").DONOR_SUMMARY_UPDATE(), [orgId]);
  }
}
// SPLIT-2 end
// SPLIT-2 db.js piece 54

// ── Blank org seeding (called from onboarding flow) ───────────────────────────
// Seeds structural data only — no sample donors, grants, or financials.
async function seedOrgData(orgId) {
  // Skip if already seeded
  const existing = await pool.query("SELECT id FROM accounts WHERE org_id = $1 LIMIT 1", [orgId]);
  if (existing.rows.length > 0) return;

  // Standard nonprofit chart of accounts
  const chartOfAccounts = [
    ["1010", "Cash & Cash Equivalents",            "asset",     "current"],
    ["1020", "Savings / Reserve Account",           "asset",     "current"],
    ["1100", "Accounts Receivable",                "asset",     "current"],
    ["1200", "Prepaid Expenses",                   "asset",     "current"],
    ["2010", "Accounts Payable",                   "liability", "current"],
    ["2100", "Accrued Expenses",                   "liability", "current"],
    ["2200", "Deferred Revenue",                   "liability", "current"],
    ["3010", "Unrestricted Net Assets",            "net_asset", "unrestricted"],
    ["3100", "Temporarily Restricted Net Assets",  "net_asset", "restricted"],
    ["3200", "Permanently Restricted Net Assets",  "net_asset", "restricted"],
    ["4010", "Individual Contributions",           "revenue",   "contributions"],
    ["4020", "Foundation Grants",                  "revenue",   "grants"],
    ["4030", "Government Grants",                  "revenue",   "grants"],
    ["4040", "Program Revenue",                    "revenue",   "program"],
    ["4050", "Special Events Revenue",             "revenue",   "events"],
    ["4060", "Other Revenue",                      "revenue",   "other"],
    ["5010", "Program Services: Salaries",        "expense",   "program"],
    ["5020", "Program Services: Supplies",        "expense",   "program"],
    ["5030", "Program Services: Contractors",     "expense",   "program"],
    ["5040", "Program Services: Occupancy",       "expense",   "program"],
    ["6010", "Management & General: Salaries",    "expense",   "management"],
    ["6020", "Management & General: Admin",       "expense",   "management"],
    ["6030", "Management & General: Technology",  "expense",   "management"],
    ["7010", "Fundraising: Salaries",             "expense",   "fundraising"],
    ["7020", "Fundraising: Events",               "expense",   "fundraising"],
    ["7030", "Fundraising: Marketing",            "expense",   "fundraising"],
  ];

  for (const [code, name, type, subtype] of chartOfAccounts) {
    await pool.query(
      `INSERT INTO accounts (id, org_id, code, name, type, subtype) VALUES ($1, $2, $3, $4, $5, $6)`,
      [newId("acc"), orgId, code, name, type, subtype]
    );
  }

  // Single General Operating fund. FIX-45: only when the org has no
  // unrestricted fund yet. An org that made its funds before its chart (the
  // ledger heal in ensureOrgLedger) got a SECOND "General Operating", and every
  // lookup by name then chose between the two by row order: an import put its
  // gifts in one and the old-report check counted the other (reconcile1-checks
  // went red on CI whenever the physical order flipped).
  await pool.query(
    `INSERT INTO fin_funds (id, org_id, name, description, restricted)
     SELECT $1, $2, $3, $4, $5 WHERE NOT EXISTS (SELECT 1 FROM fin_funds WHERE org_id = $2 AND restricted = false)`,
    [newId("ff"), orgId, "General Operating", "General unrestricted operating fund", false]
  );
}
// SPLIT-2 end

module.exports = { backfillLinkedTasks, householdsFromLinks, keepEarlierTotals, seedData, seedOrgData };
