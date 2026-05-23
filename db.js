require("dotenv").config();
const { Pool } = require("pg");
const { randomUUID: uuid } = require("crypto");
const bcrypt = require("bcryptjs");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function getDb() {
  await initSchema();
  await seedData();
  return pool;
}

// Convert SQLite ? placeholders to PostgreSQL $1, $2, ... positional params
async function query(sql, params = []) {
  let i = 0;
  const pgSql = sql.replace(/\?/g, () => `$${++i}`);
  const result = await pool.query(pgSql, params);
  return result.rows;
}

async function run(sql, params = []) {
  let i = 0;
  const pgSql = sql.replace(/\?/g, () => `$${++i}`);
  const result = await pool.query(pgSql, params);
  return { changes: result.rowCount };
}

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orgs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      mission TEXT,
      ein TEXT,
      onboarding_complete INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT,
      role TEXT DEFAULT 'staff',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS donors (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      status TEXT DEFAULT 'new',
      stage TEXT DEFAULT 'cultivate',
      total_giving INTEGER DEFAULT 0,
      last_gift_amount INTEGER DEFAULT 0,
      last_gift_date TEXT,
      gift_count INTEGER DEFAULT 0,
      tags TEXT DEFAULT '[]',
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS gifts (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      donor_id TEXT REFERENCES donors(id),
      amount INTEGER NOT NULL,
      date TEXT NOT NULL,
      type TEXT DEFAULT 'cash',
      campaign TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS interactions (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      donor_id TEXT REFERENCES donors(id),
      type TEXT NOT NULL,
      note TEXT,
      date TEXT,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS grants (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      funder TEXT NOT NULL,
      program TEXT,
      amount INTEGER DEFAULT 0,
      received INTEGER DEFAULT 0,
      status TEXT DEFAULT 'prospecting',
      deadline TEXT,
      report_due TEXT,
      officer TEXT,
      notes TEXT,
      history TEXT DEFAULT '[]',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS volunteers (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      name TEXT NOT NULL,
      email TEXT,
      hours INTEGER DEFAULT 0,
      skills TEXT DEFAULT '[]',
      last_active TEXT,
      donor_id TEXT,
      convert_potential TEXT DEFAULT 'medium',
      employer TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      title TEXT NOT NULL,
      due TEXT,
      priority TEXT DEFAULT 'medium',
      type TEXT DEFAULT 'donor',
      done INTEGER DEFAULT 0,
      donor_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS board_members (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      name TEXT NOT NULL,
      role TEXT DEFAULT 'Member',
      employer TEXT,
      term TEXT,
      giving_level TEXT,
      committees TEXT DEFAULT '[]',
      attendance INTEGER DEFAULT 100,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS financials (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      month TEXT NOT NULL,
      year INTEGER NOT NULL,
      individual INTEGER DEFAULT 0,
      grants INTEGER DEFAULT 0,
      events INTEGER DEFAULT 0,
      other_revenue INTEGER DEFAULT 0,
      programs INTEGER DEFAULT 0,
      admin INTEGER DEFAULT 0,
      fundraising INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (org_id, month, year)
    );

    CREATE TABLE IF NOT EXISTS funds (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      name TEXT NOT NULL,
      balance INTEGER DEFAULT 0,
      restricted INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ai_log (
      id TEXT PRIMARY KEY,
      org_id TEXT,
      user_id TEXT,
      type TEXT,
      prompt_summary TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      name TEXT NOT NULL,
      type TEXT DEFAULT 'appeal',
      subject TEXT DEFAULT '',
      body TEXT DEFAULT '',
      status TEXT DEFAULT 'draft',
      segment TEXT DEFAULT '{}',
      sent_at TIMESTAMPTZ,
      recipient_count INTEGER DEFAULT 0,
      open_count INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS campaign_recipients (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      campaign_id TEXT REFERENCES campaigns(id) ON DELETE CASCADE,
      donor_id TEXT REFERENCES donors(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      sent_at TIMESTAMPTZ,
      opened_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS programs (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      budget INTEGER DEFAULT 0,
      spent INTEGER DEFAULT 0,
      staff TEXT DEFAULT '[]',
      participant_count INTEGER DEFAULT 0,
      start_date TEXT,
      end_date TEXT,
      status TEXT DEFAULT 'active',
      outcomes TEXT DEFAULT '',
      metrics TEXT DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS program_grants (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      program_id TEXT REFERENCES programs(id) ON DELETE CASCADE,
      grant_id TEXT REFERENCES grants(id) ON DELETE CASCADE,
      allocated INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (program_id, grant_id)
    );

    CREATE TABLE IF NOT EXISTS annual_fund_goals (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      year INTEGER NOT NULL,
      goal INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (org_id, year)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS invites (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      email TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      role TEXT DEFAULT 'staff',
      invited_by TEXT,
      accepted_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS smtp_host TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS smtp_port INTEGER DEFAULT 587`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS smtp_user TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS smtp_pass TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS smtp_from TEXT`);

  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS wealth_score INTEGER DEFAULT NULL`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS capacity_tier TEXT DEFAULT NULL`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS score_confidence TEXT DEFAULT NULL`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS score_last_updated TIMESTAMPTZ DEFAULT NULL`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS score_rationale TEXT DEFAULT NULL`);
}

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
    `INSERT INTO users (id, org_id, email, password_hash, name, role)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
    [userId, orgId, "admin@creoarts.org", hash, "Admin User", "admin"]
  );

  const donors = [
    ["d1", orgId, "Margaret Chen",         "m.chen@example.com",    "212-555-0101", "major",  "steward",   24500, 5000,  "2024-11-15", 8, '["board-adjacent","arts"]',  "Prefers phone calls. Interested in youth programming. Has mentioned potentially increasing giving this year."],
    ["d2", orgId, "Robert & Lisa Atkinson", "ratkinson@example.com", "917-555-0234", "mid",    "steward",   12000, 3000,  "2025-01-03", 5, '["education","recurring"]',  "Both educators. Very engaged with after-school programs. Anniversary donors."],
    ["d3", orgId, "James Okafor",           "jokafor@example.com",   "646-555-0387", "lapsed", "lapsed",     3200,  500,  "2023-09-22", 4, '["youth"]',                  "Lapsed 18+ months. Was a regular $500 donor. Worth personal outreach."],
    ["d4", orgId, "Sunrise Foundation",     "grants@sunrisefdn.org", "212-555-0199", "major",  "steward",   75000, 25000, "2025-03-01", 3, '["foundation","arts"]',      "Program officer is Angela Wu. Next grant cycle opens September."],
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
    ["v1", orgId, "Priya Nair",    "pnair@example.com",   84,  '["event coordination","social media"]', "2025-04-12", null,  "high",      "Google",   "Very enthusiastic. Works in tech — capacity likely $500-1000 first gift."],
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
    ["t1", orgId, "Call Margaret Chen — major gift conversation", "2025-05-23", "high",   "donor",     0, "d1"],
    ["t2", orgId, "Submit NEA final report",                      "2025-07-15", "high",   "grant",     0, null],
    ["t3", orgId, "Follow up: Rockefeller LOI status",            "2025-06-01", "medium", "grant",     0, null],
    ["t4", orgId, "Re-engage James Okafor (lapsed 18mo)",         "2025-05-28", "medium", "donor",     0, "d3"],
    ["t5", orgId, "Board packet — Q2 financials",                 "2025-05-30", "high",   "board",     0, null],
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
    ["fn3", orgId, "NY Community Trust — Youth",  25000, 1],
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
      "Help us reach 120 more students — a message from CREO Arts",
      "Dear {{donor_name}},\n\nYour support has made an incredible difference. This year, CREO Arts served 120 students across 4 NYC schools.\n\nAs we plan for fall, we need your help to expand our reach. A gift of any size helps us purchase art supplies, pay teaching artists, and keep our programs free for students who need them most.\n\nYour previous gift of {{gift_amount}} made a real impact. Will you renew your support today?\n\nWith gratitude,\nThe CREO Arts Team",
      "draft",
      '{"stages":["steward","solicit"],"statuses":["major","mid"]}',
      0, 0
    ]
  );

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
}

// ── Scaled org seeding (called from onboarding flow) ──────────────────────────
async function seedOrgData(orgId, answers) {
  const { donorCount = "50-200", budget = "$100K-$500K" } = answers || {};

  const size =
    donorCount === "500+"   ? "xl" :
    donorCount === "200-500" ? "lg" :
    donorCount === "50-200"  ? "md" : "sm";

  const mo = (n) => { const d = new Date(); d.setMonth(d.getMonth() - n); return d.toISOString().split("T")[0]; };

  // ── Donors ─────────────────────────────────────────────────────────────────
  const donorTemplates = [
    ["Alexandra Rivera",   "arivera@example.com",  "212-555-0101", "major",  "steward",   28000, 6000,  8, '["board-adjacent","arts"]',       "Major donor since founding. Board-adjacent. Prefers personal calls."],
    ["Thomas & Gwen Park", "tgpark@example.com",   "917-555-0202", "mid",    "steward",   11500, 2500,  5, '["recurring","education"]',       "Educators. Anniversary donors. Very engaged with programs."],
    ["Diane Osei",         "dosei@example.com",    "646-555-0303", "lapsed", "lapsed",     3400,  500,  4, '["youth"]',                       "Lapsed 14+ months. Was a reliable $500 donor. Worth outreach."],
    ["Meridian Foundation","grants@meridian.org",  "212-555-0404", "major",  "steward",   60000,20000,  3, '["foundation","grants"]',         "Program officer is James Lee. Next cycle opens Q3."],
    ["Carlos Vega",        "cvega@example.com",    "718-555-0505", "new",    "cultivate",   750,  250,  3, '["online","young-professional"]',  "Online donor via social media. Good upgrade potential."],
    ["Susan Holbrook",     "sholbrook@example.com","347-555-0606", "mid",    "solicit",    7200, 1200,  6, '["recurring"]',                   "Consistent annual donor. Approaching renewal window."],
    ["James Whitfield",    "jwhit@example.com",    "212-555-0707", "major",  "cultivate", 15000, 5000,  4, '["arts","board-adjacent"]',       "Recently upgraded to major. Strong cultivation opportunity."],
    ["Priya Anand",        "panand@example.com",   "646-555-0808", "new",    "qualify",    1200,  400,  2, '["education"]',                   "First-time donor from spring event. High potential."],
    ["Marcus & Tia Brown", "mtbrown@example.com",  "917-555-0909", "mid",    "steward",    5500, 1000,  5, '["recurring","community"]',       "Community connectors. Can make valuable introductions."],
    ["Liberty Fund",       "info@libertyfund.org", "212-555-1010", "major",  "steward",   42000,12000,  3, '["foundation"]',                  "Long-term funder. Mid-year check-in due."],
  ];

  const counts = { sm: 3, md: 5, lg: 7, xl: 10 };
  const donorRows = donorTemplates.slice(0, counts[size]);

  for (let i = 0; i < donorRows.length; i++) {
    const [name, email, phone, status, stage, total, last, gifts, tags, notes] = donorRows[i];
    const did = `d_${uuid().slice(0, 8)}`;
    await run(
      `INSERT INTO donors (id,org_id,name,email,phone,status,stage,total_giving,last_gift_amount,last_gift_date,gift_count,tags,notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [did, orgId, name, email, phone, status, stage, total, last, mo(i * 30), gifts, tags, notes]
    );
  }

  // ── Grants ─────────────────────────────────────────────────────────────────
  const grantTemplates = [
    ["State Arts Council",    "General Operating Support", 25000, 25000, "active",      mo(-180), mo(-150), "Sarah Kim",    "Annual operating grant. Report due 6 months post-period.", '["2023: $20,000"]'],
    ["Community Foundation",  "Youth Programs",             40000, 20000, "active",      mo(-90),  mo(-60),  "Marcus Reid",  "Mid-year disbursement expected next quarter.",              '["2024: $35,000"]'],
    ["Regional Arts Fund",    "Cultural Innovation",        15000,     0, "pending",     mo(60),   null,     "Angela Moore", "Full proposal invited. Narrative due next month.",           '["First applicant"]'],
    ["City Council District", "Community Programs",         10000, 10000, "closed",      mo(-365), mo(-300), "James Liu",    "Completed. New cycle opens in July.",                       '["2023: $8,000"]'],
    ["National Endowment",    "Arts Education",             50000,     0, "prospecting", mo(120),  null,     "Lisa Chen",    "Highly competitive. Requires strong theory of change.",      '["First applicant"]'],
    ["Private Family Fund",   "Capacity Building",          20000, 20000, "active",      mo(-30),  mo(60),   "Robert Kim",   "First-time grant. Stewardship priority.",                   '["New relationship"]'],
  ];

  const gCounts = { sm: 2, md: 3, lg: 4, xl: 6 };
  for (const [funder, program, amount, received, status, deadline, reportDue, officer, notes, history] of grantTemplates.slice(0, gCounts[size])) {
    await run(
      `INSERT INTO grants (id,org_id,funder,program,amount,received,status,deadline,report_due,officer,notes,history)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [`gr_${uuid().slice(0, 8)}`, orgId, funder, program, amount, received, status, deadline, reportDue, officer, notes, JSON.stringify(history)]
    );
  }

  // ── Volunteers ─────────────────────────────────────────────────────────────
  const volTemplates = [
    ["Jordan Ellis",  "jellis@example.com",   96, '["event coordination","marketing"]',  "high",      "Accenture",  "Enthusiastic. Has offered to lead annual gala committee."],
    ["Mia Tanaka",    "mtanaka@example.com", 215, '["teaching","curriculum design"]',    "high",      "NYC Schools", "Most dedicated volunteer. Deep mission alignment."],
    ["Derek Shaw",    "dshaw@example.com",    44, '["graphic design","photography"]',    "medium",    "Freelance",  "Produced our last annual report. Engaged but sporadic."],
    ["Faith Okonkwo", "fokonkwo@example.com",162, '["accounting","administration"]',     "converted", "KPMG",       "Already a donor. Quarterly finance help. Board candidate."],
    ["Nadia Santos",  "nsantos@example.com",  28, '["social media","communications"]',   "high",      "Google",     "Works in tech. Ran our Instagram campaign last spring."],
    ["Leo Ramirez",   "lramirez@example.com", 88, '["legal","governance"]',              "medium",    "Law firm",   "Pro-bono legal review of contracts. Board-adjacent."],
  ];

  const vCounts = { sm: 2, md: 3, lg: 4, xl: 6 };
  for (const [name, email, hours, skills, potential, employer, notes] of volTemplates.slice(0, vCounts[size])) {
    await run(
      `INSERT INTO volunteers (id,org_id,name,email,hours,skills,last_active,convert_potential,employer,notes)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [`v_${uuid().slice(0, 8)}`, orgId, name, email, hours, skills, mo(15), potential, employer, notes]
    );
  }

  // ── Tasks ──────────────────────────────────────────────────────────────────
  const taskTemplates = [
    ["Schedule major donor cultivation calls",   7,  "high",   "donor"],
    ["Submit pending grant narrative",           14, "high",   "grant"],
    ["Follow up on LOI status",                  21, "medium", "grant"],
    ["Prepare board packet — quarterly update",  10, "high",   "board"],
    ["Re-engage lapsed donors (14+ months)",      5, "medium", "donor"],
    ["Volunteer appreciation planning",          30, "low",    "volunteer"],
  ];

  const tCounts = { sm: 3, md: 4, lg: 5, xl: 6 };
  for (const [title, daysOut, priority, type] of taskTemplates.slice(0, tCounts[size])) {
    const due = new Date(); due.setDate(due.getDate() + daysOut);
    await run(
      `INSERT INTO tasks (id,org_id,title,due,priority,type,done) VALUES (?,?,?,?,?,?,0)`,
      [`t_${uuid().slice(0, 8)}`, orgId, title, due.toISOString().split("T")[0], priority, type]
    );
  }

  // ── Financials (last 5 months) ─────────────────────────────────────────────
  const budgetMultiplier =
    budget === "$2M+"        ? 6   :
    budget === "$500K-$2M"   ? 3   :
    budget === "$100K-$500K" ? 1.5 : 0.6;

  const base = { ind: 8000, gr: 10000, ev: 2000, oth: 400, prog: 13000, adm: 4000, fund: 2000 };
  const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const now = new Date();

  for (let i = 4; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const m = monthNames[d.getMonth()];
    const yr = d.getFullYear();
    const rand = (n) => Math.round(n * budgetMultiplier * (0.85 + Math.random() * 0.3));
    await run(
      `INSERT INTO financials (id,org_id,month,year,individual,grants,events,other_revenue,programs,admin,fundraising)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT (org_id, month, year) DO NOTHING`,
      [`fin_${uuid().slice(0,8)}`, orgId, m, yr, rand(base.ind), rand(base.gr), rand(base.ev), rand(base.oth), rand(base.prog), rand(base.adm), rand(base.fund)]
    );
  }

  // ── Funds ──────────────────────────────────────────────────────────────────
  const fundBase = Math.round(30000 * budgetMultiplier);
  for (const [name, balance, restricted] of [
    ["General Operating",        Math.round(fundBase * 0.5), 0],
    ["Restricted Program Fund",  Math.round(fundBase * 0.7), 1],
    ["Board Designated Reserve", Math.round(fundBase * 0.2), 0],
  ]) {
    await run(
      `INSERT INTO funds (id,org_id,name,balance,restricted) VALUES (?,?,?,?,?)`,
      [`fn_${uuid().slice(0,8)}`, orgId, name, balance, restricted]
    );
  }
}

module.exports = { getDb, query, run, uuid, seedOrgData };
