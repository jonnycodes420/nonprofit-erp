const initSqlJs = require("sql.js");
const { v4: uuid } = require("uuid");
const bcrypt = require("bcryptjs");

let db;

async function getDb() {
  if (db) return db;
  const SQL = await initSqlJs();
  db = new SQL.Database();
  initSchema();
  seedData();
  return db;
}

function initSchema() {
  db.run(`
    CREATE TABLE IF NOT EXISTS orgs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      mission TEXT,
      ein TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT,
      role TEXT DEFAULT 'staff',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS donors (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      status TEXT DEFAULT 'new',
      total_giving INTEGER DEFAULT 0,
      last_gift_amount INTEGER DEFAULT 0,
      last_gift_date TEXT,
      gift_count INTEGER DEFAULT 0,
      tags TEXT DEFAULT '[]',
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
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
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS interactions (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      donor_id TEXT REFERENCES donors(id),
      type TEXT NOT NULL,
      note TEXT,
      date TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
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
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
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
      created_at TEXT DEFAULT (datetime('now'))
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
      created_at TEXT DEFAULT (datetime('now'))
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
      created_at TEXT DEFAULT (datetime('now'))
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
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS funds (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id),
      name TEXT NOT NULL,
      balance INTEGER DEFAULT 0,
      restricted INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ai_log (
      id TEXT PRIMARY KEY,
      org_id TEXT,
      user_id TEXT,
      type TEXT,
      prompt_summary TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

function seedData() {
  const orgId = "org_creo";
  const userId = "user_admin";

  db.run(`INSERT OR IGNORE INTO orgs VALUES (?,?,?,?,datetime('now'))`,
    [orgId, "CREO Arts", "Transformative arts education for underserved NYC youth", "47-1234567"]);

  const hash = bcrypt.hashSync("demo1234", 10);
  db.run(`INSERT OR IGNORE INTO users VALUES (?,?,?,?,?,?,datetime('now'))`,
    [userId, orgId, "admin@creoarts.org", hash, "Admin User", "admin"]);

  const donors = [
    ["d1", orgId, "Margaret Chen",         "m.chen@example.com",    "212-555-0101", "major",  24500, 5000,  "2024-11-15", 8, '["board-adjacent","arts"]',  "Prefers phone calls. Interested in youth programming. Has mentioned potentially increasing giving this year."],
    ["d2", orgId, "Robert & Lisa Atkinson", "ratkinson@example.com", "917-555-0234", "mid",    12000, 3000,  "2025-01-03", 5, '["education","recurring"]',  "Both educators. Very engaged with after-school programs. Anniversary donors."],
    ["d3", orgId, "James Okafor",           "jokafor@example.com",   "646-555-0387", "lapsed",  3200,  500,  "2023-09-22", 4, '["youth"]',                  "Lapsed 18+ months. Was a regular $500 donor. Worth personal outreach."],
    ["d4", orgId, "Sunrise Foundation",     "grants@sunrisefdn.org", "212-555-0199", "major",  75000, 25000, "2025-03-01", 3, '["foundation","arts"]',      "Program officer is Angela Wu. Next grant cycle opens September."],
    ["d5", orgId, "Diana Torres",           "dtorres@example.com",   "718-555-0421", "new",      850,  250,  "2025-02-14", 3, '["online"]',                 "Online donor via Instagram. Young professional. Good upgrade potential."],
    ["d6", orgId, "William Park",           "wpark@example.com",     "347-555-0512", "mid",     6700, 1000,  "2024-06-30", 7, '["recurring","arts"]',       "Long-time supporter. Consistent annual donor. Approaching 11 months since last gift."],
  ];
  donors.forEach(d => db.run(
    `INSERT OR IGNORE INTO donors VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`, d));

  const interactions = [
    ["i1", orgId, "d1", "gift",    "Annual major gift $5,000",                "2024-11-15"],
    ["i2", orgId, "d1", "call",    "Cultivation call - discussed new mural program", "2024-09-10"],
    ["i3", orgId, "d1", "event",   "Attended spring gala, table host",        "2024-06-01"],
    ["i4", orgId, "d2", "gift",    "Annual gift $3,000",                       "2025-01-03"],
    ["i5", orgId, "d3", "gift",    "Last donation $500",                       "2023-09-22"],
    ["i6", orgId, "d4", "meeting", "Site visit with Angela Wu",                "2025-02-15"],
    ["i7", orgId, "d4", "gift",    "Annual grant $25,000",                     "2025-03-01"],
  ];
  interactions.forEach(i => db.run(
    `INSERT OR IGNORE INTO interactions VALUES (?,?,?,?,?,?,null,datetime('now'))`, i));

  const grants = [
    ["g1", orgId, "NEA",                     "Arts Education Initiative", 35000, 35000, "active",      "2025-06-30", "2025-07-15", "Sarah Kim",    "Final report pending.",                           '["2023: $30,000","2024: $35,000"]'],
    ["g2", orgId, "NY Community Trust",       "Youth Development",         50000, 25000, "active",      "2025-12-31", "2026-01-15", "Marcus Reid",  "Mid-year report submitted.",                      '["2024: $40,000"]'],
    ["g3", orgId, "Rockefeller Brothers Fund","Cultural Innovation",        20000,     0, "pending",     "2025-08-01", null,         "Angela Moore", "LOI submitted. Full proposal invited.",            '["First-time applicant"]'],
    ["g4", orgId, "City Council",             "Cultural Programs FY25",    15000, 15000, "closed",      "2024-12-31", "2025-02-01", "James Liu",    "Completed. FY26 opens July.",                     '["2023: $12,000","2024: $15,000"]'],
    ["g5", orgId, "Ford Foundation",          "Creative Communities",     100000,     0, "prospecting", "2025-09-15", null,         "Sarah Kim",    "Competitive. Need strong theory of change.",       '["First-time applicant"]'],
  ];
  grants.forEach(g => db.run(
    `INSERT OR IGNORE INTO grants VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`, g));

  const volunteers = [
    ["v1", orgId, "Priya Nair",    "pnair@example.com",   84,  '["event coordination","social media"]', "2025-04-12", null,  "high",      "Google",   "Very enthusiastic. Works in tech — capacity likely $500-1000 first gift."],
    ["v2", orgId, "Carlos Mendez", "cmendez@example.com", 210, '["teaching","curriculum"]',             "2025-05-01", null,  "high",      "NYC DOE",  "Most dedicated volunteer. Teaches after-school weekly. Deep mission alignment."],
    ["v3", orgId, "Sophie Laurent","slaurent@example.com",  32, '["design","photography"]',             "2025-03-20", null,  "medium",    "Freelance","Provided design work for annual report."],
    ["v4", orgId, "Devon Brooks",  "dbrooks@example.com", 156, '["accounting","admin"]',                "2025-04-28", "d3", "converted", "Deloitte", "Already a donor. Helps with books quarterly. Strong board candidate."],
  ];
  volunteers.forEach(v => db.run(
    `INSERT OR IGNORE INTO volunteers VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`, v));

  const tasks = [
    ["t1", orgId, "Call Margaret Chen — major gift conversation", "2025-05-23", "high",   "donor",     0, "d1"],
    ["t2", orgId, "Submit NEA final report",                      "2025-07-15", "high",   "grant",     0, null],
    ["t3", orgId, "Follow up: Rockefeller LOI status",            "2025-06-01", "medium", "grant",     0, null],
    ["t4", orgId, "Re-engage James Okafor (lapsed 18mo)",         "2025-05-28", "medium", "donor",     0, "d3"],
    ["t5", orgId, "Board packet — Q2 financials",                 "2025-05-30", "high",   "board",     0, null],
    ["t6", orgId, "Volunteer appreciation event planning",        "2025-06-15", "low",    "volunteer", 1, null],
  ];
  tasks.forEach(t => db.run(
    `INSERT OR IGNORE INTO tasks VALUES (?,?,?,?,?,?,?,?,datetime('now'))`, t));

  const board = [
    ["b1", orgId, "Dr. Angela Washington", "Chair",     "Columbia University",       "2023-2026", "$10,000", '["Executive","Finance"]',    92],
    ["b2", orgId, "Marcus Powell",          "Treasurer", "JPMorgan Chase",            "2022-2025", "$5,000",  '["Finance","Audit"]',        100],
    ["b3", orgId, "Keisha Brown",           "Secretary", "Brooklyn Community Foundation","2024-2027","$2,500", '["Programs","DEI"]',          83],
    ["b4", orgId, "Tom Ricci",              "Member",    "Ricci Architecture",        "2023-2026", "$5,000",  '["Facilities","Executive"]',  75],
    ["b5", orgId, "Yun Li",                 "Member",    "Goldman Sachs",             "2024-2027", "$7,500",  '["Finance","Fundraising"]',   92],
  ];
  board.forEach(b => db.run(
    `INSERT OR IGNORE INTO board_members VALUES (?,?,?,?,?,?,?,?,?,datetime('now'))`, b));

  const months = [
    ["f1", orgId, "Jan", 2025,  8200, 12000,    0,  500, 14000, 4200, 2100],
    ["f2", orgId, "Feb", 2025,  5400,     0,    0,  200, 13500, 4200, 1800],
    ["f3", orgId, "Mar", 2025, 11000, 25000, 4200,  800, 15200, 4400, 3200],
    ["f4", orgId, "Apr", 2025,  7300,     0,    0,  300, 14800, 4200, 2400],
    ["f5", orgId, "May", 2025,  9100,     0,    0,  150, 15100, 4300, 2200],
  ];
  months.forEach(m => db.run(
    `INSERT OR IGNORE INTO financials VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`, m));

  const funds = [
    ["fn1", orgId, "General Operating",           42000, 0],
    ["fn2", orgId, "NEA Arts Education",           35000, 1],
    ["fn3", orgId, "NY Community Trust — Youth",   25000, 1],
    ["fn4", orgId, "Gala Reserve",                  8200, 0],
  ];
  funds.forEach(f => db.run(
    `INSERT OR IGNORE INTO funds VALUES (?,?,?,?,?,datetime('now'))`, f));
}

function query(sql, params = []) {
  const stmt = db.prepare(sql);
  const rows = [];
  stmt.bind(params);
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function run(sql, params = []) {
  db.run(sql, params);
  return { changes: db.getRowsModified() };
}

module.exports = { getDb, query, run, uuid };
