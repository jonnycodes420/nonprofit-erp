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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS grant_interactions (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      grant_id TEXT REFERENCES grants(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      note TEXT,
      date TEXT,
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

  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS assigned_to TEXT DEFAULT NULL`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS assigned_to_name TEXT DEFAULT NULL`);
  await pool.query(`
    UPDATE donors d
    SET assigned_to = u.id, assigned_to_name = u.name
    FROM (
      SELECT DISTINCT ON (org_id) id, org_id, name
      FROM users WHERE role = 'admin' ORDER BY org_id, created_at ASC
    ) u
    WHERE d.org_id = u.org_id AND d.assigned_to IS NULL
  `);

  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS stripe_account_id TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS stripe_connected BOOLEAN DEFAULT FALSE`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS stripe_connected_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS stripe_payment_id TEXT`);
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS stripe_payment_link TEXT`);
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS campaign_id TEXT`);

  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS org_slug TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS stripe_subscription_status TEXT`);

  // Backfill slugs for existing orgs (safe to re-run)
  await pool.query(`
    UPDATE orgs
    SET org_slug = REGEXP_REPLACE(LOWER(TRIM(name)), '[^a-z0-9]+', '-', 'g') || '-' || SUBSTRING(id FROM 5 FOR 6)
    WHERE org_slug IS NULL
  `);

  await pool.query(`ALTER TABLE grants ADD COLUMN IF NOT EXISTS description TEXT`);
  await pool.query(`ALTER TABLE grants ADD COLUMN IF NOT EXISTS requirements TEXT`);
  await pool.query(`ALTER TABLE grants ADD COLUMN IF NOT EXISTS attachments TEXT DEFAULT '[]'`);

  // ── Finance module ────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      subtype TEXT DEFAULT '',
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS fin_funds (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      restricted BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS fin_transactions (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      date TEXT NOT NULL,
      description TEXT NOT NULL,
      vendor_donor TEXT DEFAULT '',
      amount NUMERIC NOT NULL,
      type TEXT NOT NULL,
      account_id TEXT REFERENCES accounts(id),
      fund_id TEXT REFERENCES fin_funds(id),
      notes TEXT DEFAULT '',
      receipt_url TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS budgets (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      account_id TEXT REFERENCES accounts(id),
      year INTEGER NOT NULL,
      amount NUMERIC DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (org_id, account_id, year)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS fin_audit_log (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      user_id TEXT,
      user_name TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      changes JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS failure_reason TEXT`);

  // ── Email sequences ───────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sequences (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      name TEXT NOT NULL,
      trigger TEXT NOT NULL,
      trigger_stage TEXT,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sequence_steps (
      id TEXT PRIMARY KEY,
      sequence_id TEXT NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
      step_order INTEGER NOT NULL,
      delay_days INTEGER NOT NULL DEFAULT 0,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sequence_enrollments (
      id TEXT PRIMARY KEY,
      sequence_id TEXT NOT NULL,
      org_id TEXT NOT NULL,
      donor_id TEXT NOT NULL,
      enrolled_at TIMESTAMPTZ DEFAULT NOW(),
      current_step INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      next_send_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      UNIQUE(sequence_id, donor_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS custom_fields (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      label TEXT NOT NULL,
      field_type TEXT NOT NULL,
      options JSONB,
      required BOOLEAN DEFAULT false,
      field_order INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS custom_field_values (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      donor_id TEXT NOT NULL,
      field_id TEXT NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
      value TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(donor_id, field_id)
    )
  `);

  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS focus_area TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS annual_budget TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS founded_year INTEGER`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS website TEXT`);
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
    ["acc_5010", orgId, "5010", "Program Services — Salaries",        "expense",   "program"],
    ["acc_5020", orgId, "5020", "Program Services — Supplies",        "expense",   "program"],
    ["acc_5030", orgId, "5030", "Program Services — Contractors",     "expense",   "program"],
    ["acc_5040", orgId, "5040", "Program Services — Occupancy",       "expense",   "program"],
    ["acc_6010", orgId, "6010", "Management & General — Salaries",    "expense",   "management"],
    ["acc_6020", orgId, "6020", "Management & General — Admin",       "expense",   "management"],
    ["acc_6030", orgId, "6030", "Management & General — Technology",  "expense",   "management"],
    ["acc_7010", orgId, "7010", "Fundraising — Salaries",             "expense",   "fundraising"],
    ["acc_7020", orgId, "7020", "Fundraising — Events",               "expense",   "fundraising"],
    ["acc_7030", orgId, "7030", "Fundraising — Marketing",            "expense",   "fundraising"],
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
    ["ff_02", orgId, "NEA Arts Education",         "NEA grant — restricted to arts education programs", true],
    ["ff_03", orgId, "NY Community Trust — Youth", "Community Trust grant — restricted to youth development", true],
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
    ["ft_01", orgId, "2025-01-03",  "Annual Fund Gift — Atkinson",        "Robert Atkinson",       3000,  "income",  "acc_4010", "ff_01"],
    ["ft_02", orgId, "2025-01-15",  "Community Trust Q1 Disbursement",    "NY Community Trust",    25000, "income",  "acc_4020", "ff_03"],
    ["ft_03", orgId, "2025-02-14",  "Valentine Appeal — Torres",          "Diana Torres",          250,   "income",  "acc_4010", "ff_01"],
    ["ft_04", orgId, "2025-03-01",  "NEA Spring Disbursement",            "NEA",                   25000, "income",  "acc_4030", "ff_02"],
    ["ft_05", orgId, "2025-04-05",  "Spring Appeal — Chen",               "Margaret Chen",         1500,  "income",  "acc_4010", "ff_01"],
    ["ft_06", orgId, "2025-03-15",  "Spring Campaign — Park",             "William Park",          600,   "income",  "acc_4010", "ff_01"],
    ["ft_07", orgId, "2025-05-10",  "Foundation Grant — Q2",              "Sunrise Foundation",    10000, "income",  "acc_4020", "ff_02"],
    ["ft_08", orgId, "2025-01-15",  "Program Staff — January",            "Payroll",               8500,  "expense", "acc_5010", "ff_01"],
    ["ft_09", orgId, "2025-01-20",  "Art Supplies — Q1",                  "Blick Art Materials",   1200,  "expense", "acc_5020", "ff_02"],
    ["ft_10", orgId, "2025-01-31",  "Office Rent — January",              "123 Main St LLC",       3200,  "expense", "acc_5040", "ff_01"],
    ["ft_11", orgId, "2025-02-15",  "Program Staff — February",           "Payroll",               8500,  "expense", "acc_5010", "ff_01"],
    ["ft_12", orgId, "2025-02-28",  "Office Rent — February",             "123 Main St LLC",       3200,  "expense", "acc_5040", "ff_01"],
    ["ft_13", orgId, "2025-03-15",  "Program Staff — March",              "Payroll",               8500,  "expense", "acc_5010", "ff_01"],
    ["ft_14", orgId, "2025-03-20",  "Admin Software — Q1",               "Quickbooks, Zoom",      450,   "expense", "acc_6030", "ff_01"],
    ["ft_15", orgId, "2025-03-31",  "Office Rent — March",                "123 Main St LLC",       3200,  "expense", "acc_5040", "ff_01"],
    ["ft_16", orgId, "2025-04-15",  "Program Staff — April",              "Payroll",               8500,  "expense", "acc_5010", "ff_02"],
    ["ft_17", orgId, "2025-04-20",  "Teaching Artist Contractors",        "Carlos Mendez",         3000,  "expense", "acc_5030", "ff_02"],
    ["ft_18", orgId, "2025-04-30",  "Office Rent — April",                "123 Main St LLC",       3200,  "expense", "acc_5040", "ff_01"],
    ["ft_19", orgId, "2025-05-15",  "Program Staff — May",                "Payroll",               8500,  "expense", "acc_5010", "ff_01"],
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
      `INSERT INTO budgets (id,org_id,account_id,year,amount)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (org_id, account_id, year) DO NOTHING`,
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
}

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
    ["5010", "Program Services — Salaries",        "expense",   "program"],
    ["5020", "Program Services — Supplies",        "expense",   "program"],
    ["5030", "Program Services — Contractors",     "expense",   "program"],
    ["5040", "Program Services — Occupancy",       "expense",   "program"],
    ["6010", "Management & General — Salaries",    "expense",   "management"],
    ["6020", "Management & General — Admin",       "expense",   "management"],
    ["6030", "Management & General — Technology",  "expense",   "management"],
    ["7010", "Fundraising — Salaries",             "expense",   "fundraising"],
    ["7020", "Fundraising — Events",               "expense",   "fundraising"],
    ["7030", "Fundraising — Marketing",            "expense",   "fundraising"],
  ];

  for (const [code, name, type, subtype] of chartOfAccounts) {
    await pool.query(
      `INSERT INTO accounts (id, org_id, code, name, type, subtype) VALUES ($1, $2, $3, $4, $5, $6)`,
      [`acc_${uuid().slice(0, 8)}`, orgId, code, name, type, subtype]
    );
  }

  // Single General Operating fund
  await pool.query(
    `INSERT INTO fin_funds (id, org_id, name, description, restricted) VALUES ($1, $2, $3, $4, $5)`,
    [`ff_${uuid().slice(0, 8)}`, orgId, "General Operating", "General unrestricted operating fund", false]
  );
}

module.exports = { getDb, query, run, uuid, seedOrgData };
