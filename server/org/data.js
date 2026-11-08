// server/org/data.js — sample data and the organization's export.
//
// SPLIT-1: moved VERBATIM from routes/crm.js. Nothing in it changed.
//
// routes/crm.js mounts it: each router below sits inside crm.js's r0 or r1 at the
// place its routes held in the one file, so Express tries them in the same order.
// mount() runs once at the end of boot with server.js's ctx and what the helper
// modules hand back. A relative require() or import() reads from this folder.
// Tests read it through readSource("server.js") (scripts/lib/readSource.js).
const express = require("express");
const SEALED_MAIL = require("../mail/sealedMail");   // SECURE-3: a synced email's body opens only here

const routers = {
  r1: express.Router(),
};

function mount(ctx) {
const {
  cfShape, crypto, loadCfDefs, orgTime, orgToday, orgTz, query, requireAdmin, requireAuth, run, sampleDataMod,
  seedOrgData, toCsv, wrap,
} = ctx;
let app = routers.r1;

// ── Sample data ────────────────────────────────────────────────────────────
app.get("/org/sample-data-status", requireAuth, wrap(async (req, res) => {
  // BUILD-96 Part 2 — this route now carries the whole picture, because Home
  // reads it to decide whether to say "you're looking at sample data". A
  // banner driven by a different count from the one the clear acts on would
  // eventually outlive the rows it is about.
  const counts = await sampleDataMod.countSampleData(query, req.user.orgId);
  // TASKS-2 — "your own donors arrive when your file is loaded" is only true
  // while NOTHING real is here. An org that imported 1,000 donors and still
  // carries the samples was told its file had not arrived.
  const [real] = await query(
    "SELECT COUNT(*)::int AS n FROM donors WHERE org_id=? AND deleted_at IS NULL AND (is_sample IS NULL OR is_sample=false)",
    [req.user.orgId]);
  res.json({
    hasSampleData: counts.people > 0 || counts.gifts > 0,
    realDonorCount: real ? real.n : 0,
    sampleDonorCount: counts.people,
    counts,
  });
}));

app.post("/org/load-sample-data", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const userId = req.user.userId;

  const existing = await query(
    "SELECT COUNT(*) as cnt FROM donors WHERE org_id=? AND (is_sample IS NULL OR is_sample=false)",
    [orgId]
  );
  if (parseInt(existing[0].cnt) > 5) {
    return res.status(400).json({ error: "Org already has data" });
  }

  const userRows = await query("SELECT name FROM users WHERE id=?", [userId]);
  const userName = userRows[0]?.name || "Sample User";

  // ── BUILD-96 Part 2 FIX — A SAMPLE ID BELONGS TO ONE ORG ─────────────────
  // Every sample row used a FIXED id: smpl_d1…smpl_d25, smpl_g*,
  // fund_smpl_general. `donors.id` is a bare global PRIMARY KEY, not
  // (org_id, id), and every insert below is ON CONFLICT (id) DO NOTHING.
  //
  // So the SECOND org on an installation to load sample data got NOTHING, and
  // was told it worked — every insert conflicted with the first org's rows and
  // did nothing, and the response reported `donors.length`, a constant, rather
  // than a count of anything written. On production org_creo holds those ids,
  // which means this has been broken for every other org since the feature
  // existed, silently, in the direction where the screen says yes.
  //
  // It was found by a battery run, not by a test: another suite's org held the
  // ids and ten assertions in build96-sample-data failed for what looked like
  // this build's bug. It was the product lying about a write.
  //
  // The ids are now namespaced per org. The arrays below keep their RAW keys
  // because they cross-reference each other (a task points at "smpl_d3"), and
  // `sid` is applied at every insert — one function, so a reference and its
  // target can never be namespaced differently.
  const sidTag = crypto.createHash("sha1").update(String(orgId)).digest("hex").slice(0, 8);
  const sid = key => `${key}__${sidTag}`;

  // ORG_TZ_SEAM_OK (BUILD-75 A.5) — sample dates are civil dates in the ORG's
  // timezone; the old UTC slice dated every demo row for tomorrow when the
  // sample data was loaded in the local evening.
  const sampleToday = orgToday(await orgTz(orgId));
  function dAgo(n) { return orgTime.addDays(sampleToday, -n); }

  // Insert 3 sample funds
  const fGen = sid("fund_smpl_general"), fEdu = sid("fund_smpl_edu"), fCap = sid("fund_smpl_capital");
  await run(`INSERT INTO fin_funds (id,org_id,name,description,restricted,is_sample) VALUES (?,?,?,?,false,true) ON CONFLICT (id) DO NOTHING`,
    [fGen, orgId, "General Operating", "Unrestricted operating support"]);
  await run(`INSERT INTO fin_funds (id,org_id,name,description,restricted,is_sample) VALUES (?,?,?,?,true,true) ON CONFLICT (id) DO NOTHING`,
    [fEdu, orgId, "Education Program", "Restricted to youth education programs"]);
  await run(`INSERT INTO fin_funds (id,org_id,name,description,restricted,is_sample) VALUES (?,?,?,?,true,true) ON CONFLICT (id) DO NOTHING`,
    [fCap, orgId, "Capital Campaign", "New facility construction"]);

  // 25 donors across all 6 stages, all assigned to current user
  const donors = [
    {id:"smpl_d1",name:"Margaret Whitfield",email:"mwhitfield@example.com",phone:"212-555-0101",stage:"steward",total:485000,last:150000,lastGift:dAgo(45),giftCount:12,city:"New York",state:"NY",zip:"10021"},
    {id:"smpl_d2",name:"James & Carol Thorne",email:"thornegiving@example.com",phone:"617-555-0102",stage:"steward",total:225000,last:75000,lastGift:dAgo(60),giftCount:8,city:"Boston",state:"MA",zip:"02116"},
    {id:"smpl_d3",name:"David Okonkwo",email:"dokonkwo@example.com",phone:"312-555-0103",stage:"solicit",total:95000,last:50000,lastGift:dAgo(180),giftCount:5,city:"Chicago",state:"IL",zip:"60611"},
    {id:"smpl_d4",name:"Patricia Hernandez",email:"phernandez@example.com",phone:"415-555-0104",stage:"solicit",total:42000,last:20000,lastGift:dAgo(120),giftCount:4,city:"San Francisco",state:"CA",zip:"94105"},
    {id:"smpl_d5",name:"Robert Chen",email:"rchen@example.com",phone:"202-555-0105",stage:"solicit",total:58000,last:25000,lastGift:dAgo(90),giftCount:6,city:"Washington",state:"DC",zip:"20001"},
    {id:"smpl_d6",name:"Linda Abramowitz",email:"labramowitz@example.com",phone:"212-555-0106",stage:"cultivate",total:28000,last:10000,lastGift:dAgo(210),giftCount:3,city:"New York",state:"NY",zip:"10022"},
    {id:"smpl_d7",name:"Thomas Nakamura",email:"tnakamura@example.com",phone:"310-555-0107",stage:"cultivate",total:15000,last:5000,lastGift:dAgo(300),giftCount:2,city:"Los Angeles",state:"CA",zip:"90025"},
    {id:"smpl_d8",name:"Sarah Obi",email:"sobi@example.com",phone:"512-555-0108",stage:"cultivate",total:8500,last:3500,lastGift:dAgo(400),giftCount:3,city:"Austin",state:"TX",zip:"78701"},
    {id:"smpl_d9",name:"Michael Russo",email:"mrusso@example.com",phone:"305-555-0109",stage:"cultivate",total:12000,last:4000,lastGift:dAgo(350),giftCount:2,city:"Miami",state:"FL",zip:"33101"},
    {id:"smpl_d10",name:"Eleanor Park",email:"epark@example.com",phone:"206-555-0110",stage:"cultivate",total:6000,last:2000,lastGift:dAgo(500),giftCount:3,city:"Seattle",state:"WA",zip:"98101"},
    {id:"smpl_d11",name:"William Foster",email:"wfoster@example.com",phone:"404-555-0111",stage:"qualify",total:4000,last:1500,lastGift:dAgo(450),giftCount:2,city:"Atlanta",state:"GA",zip:"30303"},
    {id:"smpl_d12",name:"Amanda Kowalski",email:"akowalski@example.com",phone:"303-555-0112",stage:"qualify",total:2500,last:1000,lastGift:dAgo(600),giftCount:2,city:"Denver",state:"CO",zip:"80202"},
    {id:"smpl_d13",name:"Kevin Patel",email:"kpatel@example.com",phone:"480-555-0113",stage:"qualify",total:1800,last:800,lastGift:dAgo(700),giftCount:2,city:"Phoenix",state:"AZ",zip:"85001"},
    {id:"smpl_d14",name:"Nancy Williams",email:"nwilliams@example.com",phone:"614-555-0114",stage:"qualify",total:900,last:500,lastGift:dAgo(800),giftCount:1,city:"Columbus",state:"OH",zip:"43215"},
    {id:"smpl_d15",name:"Gregory Martin",email:"gmartin@example.com",phone:"215-555-0115",stage:"qualify",total:1200,last:600,lastGift:dAgo(550),giftCount:2,city:"Philadelphia",state:"PA",zip:"19103"},
    {id:"smpl_d16",name:"Priya Sharma",email:"psharma@example.com",phone:"617-555-0116",stage:"prospect",total:0,last:null,lastGift:null,giftCount:0,city:"Cambridge",state:"MA",zip:"02139"},
    {id:"smpl_d17",name:"Christopher Hughes",email:"chughes@example.com",phone:"502-555-0117",stage:"prospect",total:0,last:null,lastGift:null,giftCount:0,city:"Louisville",state:"KY",zip:"40202"},
    {id:"smpl_d18",name:"Diana Moss",email:"dmoss@example.com",phone:"901-555-0118",stage:"prospect",total:0,last:null,lastGift:null,giftCount:0,city:"Memphis",state:"TN",zip:"38101"},
    {id:"smpl_d19",name:"Frank Delgado",email:"fdelgado@example.com",phone:"505-555-0119",stage:"prospect",total:0,last:null,lastGift:null,giftCount:0,city:"Albuquerque",state:"NM",zip:"87101"},
    {id:"smpl_d20",name:"Helen Kim",email:"hkim@example.com",phone:"503-555-0120",stage:"prospect",total:0,last:null,lastGift:null,giftCount:0,city:"Portland",state:"OR",zip:"97201"},
    {id:"smpl_d21",name:"Arthur Blake",email:"ablake@example.com",phone:"212-555-0121",stage:"lapsed",total:35000,last:15000,lastGift:dAgo(800),giftCount:5,city:"New York",state:"NY",zip:"10001"},
    {id:"smpl_d22",name:"Meredith Stone",email:"mstone@example.com",phone:"619-555-0122",stage:"lapsed",total:18000,last:8000,lastGift:dAgo(950),giftCount:3,city:"San Diego",state:"CA",zip:"92101"},
    {id:"smpl_d23",name:"George Tremblay",email:"gtremblay@example.com",phone:"718-555-0123",stage:"lapsed",total:9000,last:3000,lastGift:dAgo(750),giftCount:4,city:"Brooklyn",state:"NY",zip:"11201"},
    {id:"smpl_d24",name:"Beatrice Nguyen",email:"bnguyen@example.com",phone:"619-555-0124",stage:"lapsed",total:7500,last:2500,lastGift:dAgo(820),giftCount:3,city:"San Diego",state:"CA",zip:"92103"},
    {id:"smpl_d25",name:"Oscar Campbell",email:"ocampbell@example.com",phone:"401-555-0125",stage:"lapsed",total:500,last:500,lastGift:dAgo(900),giftCount:1,city:"Providence",state:"RI",zip:"02903"},
  ];

  for (const d of donors) {
    await run(
      `INSERT INTO donors (id,org_id,name,email,phone,stage,total_giving,last_gift_amount,last_gift_date,gift_count,city,state,zip,assigned_to,assigned_to_name,is_sample,created_by,created_by_name)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,true,?,?) ON CONFLICT (id) DO NOTHING`,
      [sid(d.id),orgId,d.name,d.email,d.phone,d.stage,d.total,d.last,d.lastGift,d.giftCount,d.city,d.state,d.zip,userId,userName,userId,userName]
    );
  }

  // Gifts for donors with giving history
  for (const d of donors.filter(x => x.total > 0)) {
    const n = d.id.replace("smpl_d","");
    const fundId = d.stage==="steward" ? fEdu : fGen;
    const method = (d.stage==="steward"||d.stage==="solicit") ? "check" : "credit_card";
    await run(
      `INSERT INTO gifts (id,org_id,donor_id,amount,date,type,fund_id,payment_method,is_sample,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,true,?,?) ON CONFLICT (id) DO NOTHING`,
      [sid("smpl_g"+n), orgId, sid(d.id), d.last, d.lastGift, "cash", fundId, method, userId, userName]
    );
    await run(
      `INSERT INTO fin_transactions (id,org_id,date,description,vendor_donor,amount,type,account_id,fund_id,is_sample,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,?,true,?,?) ON CONFLICT (id) DO NOTHING`,
      [sid("smpl_ftx"+n), orgId, d.lastGift, `Gift · ${d.name}`, d.name, d.last, "income", null, fundId, userId, userName]
    );
  }
  // Additional historical gifts for top donors
  const oldGifts = [
    {id:"smpl_g1b",donor:"smpl_d1",amount:125000,date:dAgo(400),fund:fEdu,method:"check"},
    {id:"smpl_g1c",donor:"smpl_d1",amount:100000,date:dAgo(750),fund:fCap,method:"check"},
    {id:"smpl_g2b",donor:"smpl_d2",amount:60000,date:dAgo(390),fund:fGen,method:"check"},
    {id:"smpl_g3b",donor:"smpl_d3",amount:25000,date:dAgo(540),fund:fEdu,method:"check"},
    {id:"smpl_g21b",donor:"smpl_d21",amount:12000,date:dAgo(400),fund:fGen,method:"check"},
  ];
  for (const g of oldGifts) {
    await run(
      `INSERT INTO gifts (id,org_id,donor_id,amount,date,type,fund_id,payment_method,is_sample,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,true,?,?) ON CONFLICT (id) DO NOTHING`,
      [sid(g.id),orgId,sid(g.donor),g.amount,g.date,"cash",g.fund,g.method,userId,userName]
    );
    await run(
      `INSERT INTO fin_transactions (id,org_id,date,description,vendor_donor,amount,type,account_id,fund_id,is_sample,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,?,true,?,?) ON CONFLICT (id) DO NOTHING`,
      [sid(g.id+"_ftx"),orgId,g.date,`Historical gift`,donors.find(d=>d.id===g.donor)?.name||"",g.amount,"income",null,g.fund,userId,userName]
    );
  }

  // Expense transactions to make Finance Overview show P&L
  const expenses = [
    {id:"smpl_exp1",date:dAgo(30),desc:"Program staff salaries",vendor:"Payroll",amount:28000,fund:fGen},
    {id:"smpl_exp2",date:dAgo(30),desc:"Facilities & rent",vendor:"Property Management",amount:8500,fund:fGen},
    {id:"smpl_exp3",date:dAgo(60),desc:"Arts supplies & materials",vendor:"Dick Blick Art Materials",amount:3200,fund:fEdu},
    {id:"smpl_exp4",date:dAgo(60),desc:"Program staff salaries",vendor:"Payroll",amount:28000,fund:fGen},
    {id:"smpl_exp5",date:dAgo(90),desc:"Annual Spring Gala event costs",vendor:"The Plaza Hotel",amount:42000,fund:fGen},
    {id:"smpl_exp6",date:dAgo(15),desc:"Marketing & communications",vendor:"Design Agency",amount:4800,fund:fGen},
  ];
  for (const e of expenses) {
    await run(
      `INSERT INTO fin_transactions (id,org_id,date,description,vendor_donor,amount,type,account_id,fund_id,is_sample,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,?,true,?,?) ON CONFLICT (id) DO NOTHING`,
      [sid(e.id),orgId,e.date,e.desc,e.vendor,e.amount,"expense",null,e.fund,userId,userName]
    );
  }

  // 4 grants
  const grants = [
    {id:"smpl_gr1",funder:"W.K. Kellogg Foundation",program:"Arts Education Grant",amount:120000,status:"submitted",deadline:dAgo(-45),notes:"Annual renewal - strong history with this funder. Proposal submitted on time."},
    {id:"smpl_gr2",funder:"MacArthur Foundation",program:"Enduring Commitment Grant",amount:250000,status:"prospecting",deadline:dAgo(-120),notes:"LOI approved. Invited to submit full proposal. Strongest funding prospect for capital campaign."},
    {id:"smpl_gr3",funder:"NYC Dept. of Cultural Affairs",program:"Cultural Development Fund",amount:75000,status:"draft",deadline:dAgo(-200),notes:"LOI drafted. Awaiting program officer feedback before submitting."},
    {id:"smpl_gr4",funder:"National Endowment for the Arts",program:"Arts Education Partnership",amount:50000,status:"awarded",deadline:dAgo(90),notes:"Year 2 of 3-year grant. Mid-year report due in 60 days. On track."},
  ];
  for (const g of grants) {
    await run(
      `INSERT INTO grants (id,org_id,funder,program,amount,status,deadline,notes,is_sample,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,true,?,?) ON CONFLICT (id) DO NOTHING`,
      [sid(g.id),orgId,g.funder,g.program,g.amount,g.status,g.deadline,g.notes,userId,userName]
    );
  }

  // 2 events
  const ev1 = sid("smpl_ev1"), ev2 = sid("smpl_ev2");
  await run(
    `INSERT INTO events (id,org_id,name,event_type,date,end_date,location,description,capacity,status,revenue,cost,is_sample,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,true,?,?) ON CONFLICT (id) DO NOTHING`,
    [ev1,orgId,"Annual Spring Gala","gala",dAgo(30),dAgo(30),"The Plaza Hotel, NYC","Our signature annual fundraising gala celebrating 10 years of impact.",200,"completed",185000,42000,userId,userName]
  );
  await run(
    `INSERT INTO events (id,org_id,name,event_type,date,end_date,location,description,capacity,status,revenue,cost,is_sample,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,true,?,?) ON CONFLICT (id) DO NOTHING`,
    [ev2,orgId,"Fall Cultivation Dinner","cultivation",dAgo(-60),dAgo(-60),"Private Dining Room, One World Trade","Intimate dinner for prospective major donors.",30,"upcoming",0,8500,userId,userName]
  );
  // Gala attendees
  const galaGuests = [
    {aId:"smpl_ea1",dId:"smpl_d1",gift:5000},
    {aId:"smpl_ea2",dId:"smpl_d2",gift:2500},
    {aId:"smpl_ea3",dId:"smpl_d3",gift:1000},
    {aId:"smpl_ea4",dId:"smpl_d5",gift:1000},
    {aId:"smpl_ea5",dId:"smpl_d6",gift:500},
  ];
  for (const a of galaGuests) {
    const dn = donors.find(d=>d.id===a.dId);
    if (!dn) continue;
    await run(
      `INSERT INTO event_attendees (id,event_id,org_id,donor_id,name,email,status,gift_amount,is_sample) VALUES (?,?,?,?,?,?,?,?,true) ON CONFLICT DO NOTHING`,
      [sid(a.aId),ev1,orgId,sid(a.dId),dn.name,dn.email,"attended",a.gift]
    );
  }

  // 1 email campaign
  await run(
    `INSERT INTO campaigns (id,org_id,name,subject,body,status,briefing,goal_amount,raised_amount,start_date,end_date,is_sample,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,true,?,?) ON CONFLICT (id) DO NOTHING`,
    [sid("smpl_camp1"),orgId,"Year-End Giving Appeal","Make a difference before the year ends",
     "Dear {{first_name}},\n\nAs the year draws to a close, we reflect on the incredible impact your support has made possible. This year, our students performed on stages across New York City, received 47 scholarships, and logged over 12,000 hours of instruction.\n\nYour gift today, doubled by a board matching challenge, will fund another year of transformative programming.\n\nWith gratitude,\n{{user_name}}",
     "sent",
     "Lead with the 3 scholarship recipient stories. Emphasize the 2:1 board match, expires Dec 31. Subject line A/B: test urgency vs. impact angle. Send to all active donors + lapsed within 2 years.",
     200000,142000,dAgo(45),dAgo(-20),userId,userName]
  );

  // 15 interactions
  const interactions = [
    {id:"smpl_i1",donor:"smpl_d1",type:"meeting",note:"Stewardship lunch at Per Se. Discussed Capital Campaign leadership gift opportunity. Very enthusiastic about naming the rehearsal hall. Will bring husband to site visit next month.",date:dAgo(15)},
    {id:"smpl_i2",donor:"smpl_d1",type:"call",note:"Called to thank for $150k Annual Fund renewal. She mentioned interest in an endowed scholarship. Will follow up with proposal.",date:dAgo(45)},
    {id:"smpl_i3",donor:"smpl_d2",type:"meeting",note:"Portfolio review with James and Carol. Carol is particularly interested in scholarship outcomes. James wants to see facility plans for capital campaign.",date:dAgo(25)},
    {id:"smpl_i4",donor:"smpl_d3",type:"call",note:"Discovery call, board member referral. David runs a PE firm, has significant capacity. Deep interest in youth workforce development. Scheduled site visit for next week.",date:dAgo(8)},
    {id:"smpl_i5",donor:"smpl_d3",type:"meeting",note:"Site visit to after-school program. Deeply moved by student presentations. Ask conversation: mid-six figures for endowed scholarship. Strategy session with ED scheduled.",date:dAgo(45)},
    {id:"smpl_i6",donor:"smpl_d4",type:"email",note:"Subject: Follow-up on proposal\n\nSent $20k proposal documents as discussed. Patricia confirmed receipt and said she would review with her financial advisor this month.",date:dAgo(30)},
    {id:"smpl_i7",donor:"smpl_d5",type:"meeting",note:"Met at Kennedy Center gala. Strong connection to arts education mission, has given to 3 similar organizations. Invited to Fall Cultivation Dinner.",date:dAgo(18)},
    {id:"smpl_i8",donor:"smpl_d6",type:"call",note:"Follow-up after proposal submission. Linda said the grants committee meets next month. Asked about a board matching gift opportunity.",date:dAgo(12)},
    {id:"smpl_i9",donor:"smpl_d8",type:"event",note:"Attended Spring Gala with spouse. Made $3,500 gift at the event. Very engaged during student performances, a strong cultivation prospect.",date:dAgo(30)},
    {id:"smpl_i10",donor:"smpl_d9",type:"call",note:"Cold outreach from board referral. Michael is a real estate developer, new to NYC philanthropy. Invited to a site visit. Very responsive.",date:dAgo(22)},
    {id:"smpl_i11",donor:"smpl_d21",type:"email",note:"Subject: Reconnecting, 2 years since your last gift\n\nSent personalized re-engagement email. Arthur's company was recently acquired. New email confirmed by EA.",date:dAgo(40)},
    {id:"smpl_i12",donor:"smpl_d22",type:"call",note:"Left voicemail, 3rd attempt this quarter. Meredith has not responded to outreach since her major gift 3 years ago. May need board member warm intro.",date:dAgo(60)},
    {id:"smpl_i13",donor:"smpl_d1",type:"stewardship",note:"Mailed annual impact report with personal handwritten note. Highlighted the scholarship recipients she funded this year.",date:dAgo(20)},
    {id:"smpl_i14",donor:"smpl_d2",type:"gift",note:"Received $75,000 annual fund gift via wire transfer. Acknowledgement letter sent same day.",date:dAgo(60)},
    {id:"smpl_i15",donor:"smpl_d3",type:"meeting",note:"Strategy session with ED and board chair. Confirmed ask of $75,000 for named scholarship fund. Meeting scheduled for next week.",date:dAgo(5)},
  ];
  for (const i of interactions) {
    await run(
      `INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name,is_sample) VALUES (?,?,?,?,?,?,?,?,true) ON CONFLICT (id) DO NOTHING`,
      [sid(i.id),orgId,sid(i.donor),i.type,i.note,i.date,userId,userName]
    );
  }

  // 5 tasks
  const tasks = [
    {id:"smpl_t1",title:"Call David Okonkwo: schedule formal ask meeting",priority:"high",due:dAgo(-3),donor:"smpl_d3"},
    {id:"smpl_t2",title:"Draft MacArthur Foundation full proposal",priority:"high",due:dAgo(-14),donor:null},
    {id:"smpl_t3",title:"Send Fall Cultivation Dinner invitations to Prospect-stage donors",priority:"medium",due:dAgo(-7),donor:null},
    {id:"smpl_t4",title:"Prepare NEA mid-year grant report",priority:"medium",due:dAgo(-30),donor:null},
    {id:"smpl_t5",title:"Follow up with Arthur Blake, re-engagement email",priority:"low",due:dAgo(-2),donor:"smpl_d21"},
  ];
  for (const t of tasks) {
    await run(
      `INSERT INTO tasks (id,org_id,title,due,priority,type,done,donor_id,is_sample,created_by,created_by_name) VALUES (?,?,?,?,?,?,0,?,true,?,?) ON CONFLICT (id) DO NOTHING`,
      [sid(t.id),orgId,t.title,t.due,t.priority,"donor",t.donor?sid(t.donor):null,userId,userName]
    );
  }

  // 4 volunteers
  const volunteers = [
    {id:"smpl_v1",name:"Jessica Kim",email:"jkim@example.com",hours:42,skills:JSON.stringify(["Arts instruction","Curriculum design"]),notes:"Lead instructor for after-school program. Available Mon/Wed/Fri."},
    {id:"smpl_v2",name:"Marco Alvarez",email:"malvarez@example.com",hours:28,skills:JSON.stringify(["Event planning","Marketing"]),notes:"Coordinates all signature events. Very reliable."},
    {id:"smpl_v3",name:"Denise Okafor",email:"dokafor@example.com",hours:35,skills:JSON.stringify(["Youth mentorship","Career development"]),notes:"Board-matched mentor for senior students. Board candidate."},
    {id:"smpl_v4",name:"Alex Brennan",email:"abrennan@example.com",hours:15,skills:JSON.stringify(["Audiovisual","IT support"]),notes:"Manages tech for performances and webinars."},
  ];
  for (const v of volunteers) {
    await run(
      `INSERT INTO volunteers (id,org_id,name,email,hours,skills,notes,is_sample,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,true,?,?) ON CONFLICT (id) DO NOTHING`,
      [sid(v.id),orgId,v.name,v.email,v.hours,v.skills,v.notes,userId,userName]
    );
  }

  // 5 board members
  const board = [
    {id:"smpl_bm1",name:"Catherine Worthington",role:"Chair",giving_level:"100,000+",committees:JSON.stringify(["Executive","Finance"])},
    {id:"smpl_bm2",name:"Daniel Fontaine",role:"Treasurer",giving_level:"50,000+",committees:JSON.stringify(["Finance","Audit"])},
    {id:"smpl_bm3",name:"Rosalind Chen",role:"Secretary",giving_level:"25,000+",committees:JSON.stringify(["Governance"])},
    {id:"smpl_bm4",name:"Victor Osei",role:"Member",giving_level:"10,000+",committees:JSON.stringify(["Programs","Development"])},
    {id:"smpl_bm5",name:"Sylvia Brennan",role:"Member",giving_level:"10,000+",committees:JSON.stringify(["Development"])},
  ];
  for (const b of board) {
    await run(
      `INSERT INTO board_members (id,org_id,name,role,giving_level,committees,is_sample,created_by,created_by_name) VALUES (?,?,?,?,?,?,true,?,?) ON CONFLICT (id) DO NOTHING`,
      [sid(b.id),orgId,b.name,b.role,b.giving_level,b.committees,userId,userName]
    );
  }

  // BUILD-96 Part 2 — THE LOADER TAGS EVERYTHING IT IS RESPONSIBLE FOR.
  // Every INSERT above carries `is_sample` in its own column list. These three
  // tables the loader does not write at all — a Thread, a household, an
  // enrolment appear later, because of the people it just wrote — so the sweep
  // runs here and again before any clear. Without it the columns BUILD-96
  // added would be a default nobody ever sets.
  const tagged = await sampleDataMod.tagSampleRows({ query, run }, orgId).catch(err => {
    console.error("[sample-data] post-load tagging failed:", err.message);
    return {};
  });

  // WHAT WAS ACTUALLY WRITTEN. `donors.length` is a constant and reported 25
  // even when every insert had conflicted away to nothing, which is how the
  // id collision above stayed invisible. A route that writes rows reports the
  // rows it wrote.
  const [wrote] = await query(
    "SELECT COUNT(*)::int AS c FROM donors WHERE org_id=? AND is_sample=true", [orgId]);

  // FIX-32 · THE DEMO DOOR GOES TO HOME. "Explore the demo" is the first page
  // after signup, before onboarding is complete, and it sent her to /dashboard,
  // where RequireOnboarded bounced her straight back to /welcome: 25 sample
  // donors loaded and a start page that never moved. Choosing the demo IS
  // finishing onboarding (the same structural seed /onboarding/complete runs),
  // and it happens here, server side, so no client can load the sample and
  // forget the second half.
  let onboarded = false;
  const [o] = await query("SELECT onboarding_complete FROM orgs WHERE id=?", [orgId]);
  if (o && !Number(o.onboarding_complete)) {
    await seedOrgData(orgId);
    await run("UPDATE orgs SET onboarding_complete = 1 WHERE id = ?", [orgId]);
    onboarded = true;
  }
  res.json({ ok: true, donorCount: (wrote && wrote.c) || 0, tagged, onboarded });
}));

app.post("/org/clear-sample-data", requireAuth, wrap(async (req, res) => {
  // An org clearing its OWN sample data. This is the "get the demo donors out
  // of the way before I import my real file" path, and it deliberately does
  // NOT carry the super-admin route's refuse-on-real-gift guard: an org that
  // has already entered one real gift would otherwise be stuck with the demo
  // people forever. It is safe without it because the set it deletes is
  // defined by membership, not by judgement — only rows tagged sample, or
  // hanging off a person who is.
  const orgId = req.user.orgId;
  const { deleted, errors } = await sampleDataMod.clearSampleData({ query, run }, orgId);
  // Sample funds predate the is_sample column on fin_funds and were seeded
  // with fixed ids; the tagged delete covers them now, this covers a row
  // seeded before the tag existed.
  await run("DELETE FROM fin_funds WHERE org_id=? AND id IN (?,?,?)",
    [orgId, "fund_smpl_general", "fund_smpl_edu", "fund_smpl_capital"]).catch(() => {});
  if (errors.length) return res.status(500).json({ error: "Some sample rows could not be removed", errors, deleted });
  res.json({ ok: true, deleted });
}));

// SECURE-1: the whole organization's data leaves with an admin, never with a
// staff login (the CSV and full exports below were already admin's).
app.get("/org/export", requireAuth, requireAdmin, wrap(async (req, res) => {
  const orgId = req.user.orgId;

  const orgRows = await query("SELECT name, org_slug FROM orgs WHERE id=?", [orgId]);
  const orgSlug = (orgRows[0]?.org_slug || orgId).replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  const date = orgToday(await orgTz(orgId)); // ORG_TZ_SEAM_OK — filename carries the org's civil date

  // BUILD-78: defs are the authority; values ride the rows (JSONB, keyed by
  // the immutable field key — a rename never changes what an export means).
  // Archived fields are excluded and their stored values untouched (6.3).
  const cfDonorDefs = await loadCfDefs("donor", orgId);
  const cfGiftDefs = await loadCfDefs("gift", orgId);
  const liveCf = (row, defs) => {
    const live = new Set(defs.map(f => f.key));
    const out = {};
    for (const f of defs) out[f.key] = row.custom_fields && row.custom_fields[f.key] !== undefined && live.has(f.key) ? row.custom_fields[f.key] : null;
    return out;
  };

  const [donors, gifts, pledges, grants, txns, events, attendees, campaigns, interactions, volunteers, board, tasks] = await Promise.all([
    query("SELECT * FROM donors WHERE org_id=? AND deleted_at IS NULL ORDER BY name", [orgId]),
    query("SELECT g.*, d.name as donor_name FROM gifts g LEFT JOIN donors d ON d.id=g.donor_id WHERE g.org_id=? AND (d.id IS NULL OR d.deleted_at IS NULL) ORDER BY g.date DESC NULLS LAST, g.created_at DESC NULLS LAST, g.id DESC", [orgId]),
    query("SELECT pg.*, d.name as donor_name FROM planned_gifts pg LEFT JOIN donors d ON d.id=pg.donor_id WHERE pg.org_id=? AND (d.id IS NULL OR d.deleted_at IS NULL) ORDER BY pg.created_at DESC", [orgId]),
    query("SELECT * FROM grants WHERE org_id=? ORDER BY deadline", [orgId]),
    query("SELECT * FROM fin_transactions WHERE org_id=? ORDER BY date DESC NULLS LAST", [orgId]),
    query("SELECT * FROM events WHERE org_id=? ORDER BY date DESC NULLS LAST", [orgId]),
    query("SELECT ea.*, d.name as donor_name, e.name as event_name FROM event_attendees ea LEFT JOIN donors d ON d.id=ea.donor_id LEFT JOIN events e ON e.id=ea.event_id WHERE ea.org_id=? AND (d.id IS NULL OR d.deleted_at IS NULL) ORDER BY ea.created_at DESC", [orgId]),
    query("SELECT * FROM campaigns WHERE org_id=? ORDER BY created_at DESC", [orgId]),
    // SECURE-3: the org's own export is its whole record, so a synced email is
    // opened through the one reader, as it was in the clear before sealing.
    query("SELECT i.*, d.name as donor_name FROM interactions i LEFT JOIN donors d ON d.id=i.donor_id WHERE i.org_id=? AND (d.id IS NULL OR d.deleted_at IS NULL) ORDER BY i.date DESC NULLS LAST", [orgId]).then(rs => SEALED_MAIL.openInteractions(rs)),
    query("SELECT * FROM volunteers WHERE org_id=? ORDER BY name", [orgId]),
    query("SELECT * FROM board_members WHERE org_id=? ORDER BY name", [orgId]),
    query("SELECT t.*, d.name as donor_name FROM tasks t LEFT JOIN donors d ON d.id=t.donor_id WHERE t.org_id=? AND (d.id IS NULL OR d.deleted_at IS NULL) ORDER BY t.due", [orgId]),
  ]);

  const donorsEnriched = donors.map(d => ({ ...d, custom_fields: liveCf(d, cfDonorDefs) }));
  const giftsEnriched = gifts.map(g => (g.custom_fields ? { ...g, custom_fields: liveCf(g, cfGiftDefs) } : g));

  // SECURE-2 item 8: the audit row says how many rows left, every table counted.
  if (req.audit) req.audit.rows([donors, gifts, pledges, grants, txns, events, attendees, campaigns, interactions, volunteers, board, tasks].reduce((n, a) => n + a.length, 0));
  res.setHeader("Content-Disposition", `attachment; filename="steward-export-${orgSlug}-${date}.json"`);
  res.json({
    exported_at: new Date().toISOString(),
    org: orgRows[0] || {},
    custom_field_defs: [...cfDonorDefs, ...cfGiftDefs].map(f => ({
      id: f.id, entity: f.entity, key: f.key, label: f.label, type: f.type, options: f.options, position: f.position,
    })),
    donors: donorsEnriched,
    gifts: giftsEnriched,
    planned_gifts: pledges,
    grants,
    transactions: txns,
    events,
    event_attendees: attendees,
    campaigns,
    interactions,
    volunteers,
    board_members: board,
    tasks,
  });
}));

// The "your data is yours" export: one zip of clean, spreadsheet-openable
// CSVs of everything, streamed (archiver pipes straight to the response, so
// a big org never buffers a whole zip in memory). Admin-gated — this is a
// full-org PII dump, matching the billing/org-settings convention; staff can
// already export the per-view slices they see on screen. NEVER
// checkWriteAccess-gated: a lapsed (read_only) org must always be able to
// leave with its data — that's the whole point of the feature.
// Sample rows are INCLUDED, identified by an is_sample column where the
// table has one — honest and reversible (filter the column in a spreadsheet)
// beats silently dropping rows from "everything".
// ── BUILD-98 (switch) Part 8 — EVERYTHING, ONE BUTTON ──────────────────────
// Every table that carries this org's id, found by asking the database rather
// than by a list somebody has to remember to extend: a table added next month
// is in the export the day it exists. The org's own row comes first.
// NEVER write-gated (a lapsed org must always be able to leave with its data).
// Credentials, tokens and hashes are LEFT OUT by column name, and the ids of
// other organisations cannot appear because every read is `WHERE org_id = ?`.
const EXPORT_WITHHELD_COLUMN = /password|token|secret|sealed|(^|_)hash($|_)|api_key|credential|pdf_data/i;
app.get("/org/export/full", requireAuth, requireAdmin, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const tables = (await query(
    `SELECT table_name FROM information_schema.columns
      WHERE table_schema='public' AND column_name='org_id' GROUP BY table_name ORDER BY table_name`)).map(r => r.table_name);
  const strip = row => { const o = {}; for (const [k, v] of Object.entries(row)) if (!EXPORT_WITHHELD_COLUMN.test(k)) o[k] = v; return o; };
  const [org] = await query(`SELECT * FROM orgs WHERE id=?`, [orgId]);
  const stamp = orgToday(await orgTz(orgId)); // ORG_TZ_SEAM_OK — filename carries the org's civil date
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="steward-everything-${(org && org.org_slug) || orgId}-${stamp}.json"`);
  res.write(`{"exportedAt":${JSON.stringify(new Date().toISOString())},"organization":${JSON.stringify(strip(org || {}))},` +
            `"withheld":${JSON.stringify("Passwords, sign-in secrets, tokens, key fingerprints and stored receipt PDFs are left out; the receipts themselves are in the tables.")},"tables":{`);
  let first = true, total = 0;
  for (const t of tables) {
    const rows = await query(`SELECT * FROM "${t.replace(/"/g, "")}" WHERE org_id=?`, [orgId]);
    res.write(`${first ? "" : ","}${JSON.stringify(t)}:${JSON.stringify(rows.map(strip))}`);
    first = false; total += rows.length;
  }
  if (req.audit) req.audit.rows(total);   // SECURE-2 item 8
  res.end("}}");
}));

app.get("/org/export/csv", requireAuth, requireAdmin, wrap(async (req, res) => {
  const { ZipArchive } = require("archiver"); // archiver v8 API — class export, not a factory function
  const orgId = req.user.orgId;

  const orgRows = await query("SELECT name, org_slug FROM orgs WHERE id=?", [orgId]);
  const orgSlug = (orgRows[0]?.org_slug || orgId).replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  const date = orgToday(await orgTz(orgId)); // ORG_TZ_SEAM_OK — filename carries the org's civil date

  // BUILD-78: custom columns come from the defs table (live fields only,
  // headed with the current label) and the row JSONB, rendered per type.
  const cfDonorDefs = await loadCfDefs("donor", orgId);
  const cfGiftDefs = await loadCfDefs("gift", orgId);
  const { renderCustomValue } = await cfShape();

  const [donors, gifts, interactions, grants, pledges, plannedGifts, recurring, givingPages, peerFundraisers, receipts] = await Promise.all([
    query("SELECT * FROM donors WHERE org_id=? AND deleted_at IS NULL ORDER BY name", [orgId]),
    query(`SELECT g.*, d.name AS donor_name, d.email AS donor_email,
             f.name AS fund_name, COALESCE(c.name, g.campaign) AS campaign_name,
             gp.title AS giving_page_title, pf.name AS peer_fundraiser_name
           FROM gifts g
           LEFT JOIN donors d ON d.id=g.donor_id
           LEFT JOIN fin_funds f ON f.id=g.fund_id
           LEFT JOIN campaigns c ON c.id=g.campaign_id
           LEFT JOIN giving_pages gp ON gp.id=g.giving_page_id
           LEFT JOIN peer_fundraisers pf ON pf.id=g.peer_fundraiser_id
           WHERE g.org_id=? AND (d.id IS NULL OR d.deleted_at IS NULL) ORDER BY g.date DESC NULLS LAST, g.created_at DESC NULLS LAST, g.id DESC`, [orgId]),
    query(`SELECT i.*, d.name AS donor_name, d.email AS donor_email, i.metadata->>'direction' AS direction
           FROM interactions i LEFT JOIN donors d ON d.id=i.donor_id
           WHERE i.org_id=? AND (d.id IS NULL OR d.deleted_at IS NULL) ORDER BY i.date DESC NULLS LAST`, [orgId]),
    query("SELECT * FROM grants WHERE org_id=? ORDER BY deadline", [orgId]),
    query(`SELECT p.*, d.name AS donor_name, d.email AS donor_email
           FROM pledges p LEFT JOIN donors d ON d.id=p.donor_id
           WHERE p.org_id=? AND (d.id IS NULL OR d.deleted_at IS NULL) ORDER BY p.due_date`, [orgId]),
    query(`SELECT pg.*, d.name AS donor_name, d.email AS donor_email
           FROM planned_gifts pg LEFT JOIN donors d ON d.id=pg.donor_id
           WHERE pg.org_id=? AND (d.id IS NULL OR d.deleted_at IS NULL) ORDER BY pg.created_at DESC`, [orgId]),
    query(`SELECT r.*, d.name AS donor_name, d.email AS donor_email
           FROM recurring_subscriptions r LEFT JOIN donors d ON d.id=r.donor_id
           WHERE r.org_id=? AND (d.id IS NULL OR d.deleted_at IS NULL) ORDER BY r.created_at DESC`, [orgId]),
    query(`SELECT gp.*, f.name AS fund_name FROM giving_pages gp
           LEFT JOIN fin_funds f ON f.id=gp.fund_id
           WHERE gp.org_id=? ORDER BY gp.created_at DESC`, [orgId]),
    // Explicit column list — edit_token is a supporter's own credential and
    // never leaves the system (same rule as the admin fundraiser routes).
    query(`SELECT pf.id, pf.name, pf.email, pf.slug, pf.personal_goal_amount, pf.story, pf.status, pf.created_at,
             gp.title AS giving_page_title
           FROM peer_fundraisers pf LEFT JOIN giving_pages gp ON gp.id=pf.giving_page_id
           WHERE pf.org_id=? ORDER BY pf.created_at DESC`, [orgId]),
    query(`SELECT r.receipt_number, r.type, r.tax_year, r.amount, r.deductible_amount,
             r.sent_to, r.sent_at, r.voided_at, r.void_reason, r.created_at,
             d.name AS donor_name, d.email AS donor_email, g.date AS gift_date
           FROM receipts r LEFT JOIN donors d ON d.id=r.donor_id LEFT JOIN gifts g ON g.id=r.gift_id
           WHERE r.org_id=? ORDER BY r.created_at DESC`, [orgId]),
  ]);

  const joinTags = t => { try { return (Array.isArray(t) ? t : JSON.parse(t || "[]")).join("|"); } catch { return String(t || ""); } };

  const files = {
    "donors.csv": toCsv([
      ["Name", "name"], ["Email", "email"], ["Phone", "phone"],
      ["City", "city"], ["State", "state"], ["Zip", "zip"], ["Country", "country"], ["Employer", "employer"],
      ["Stage", "stage"], ["Status (giving tier)", "status"],
      ["Total giving", "total_giving"], ["Last gift date", "last_gift_date"], ["Last gift amount", "last_gift_amount"],
      ["Gift count", "gift_count"], ["First gift date", "first_gift_date"],
      ["Assigned to", "assigned_to_name"], ["Planned giving", "planned_giving"],
      ["Wealth score", "wealth_score"], ["Capacity tier", "capacity_tier"],
      ["Tags", r => joinTags(r.tags)], ["Notes", "notes"], ["Sample data", "is_sample"], ["Created", "created_at"],
      ...cfDonorDefs.map(f => [f.label, r => renderCustomValue(f, (r.custom_fields || {})[f.key])]),
    ], donors),
    "gifts.csv": toCsv([
      ["Donor name", "donor_name"], ["Donor email", "donor_email"],
      ["Date", "date"], ["Amount", "amount"], ["Type", "type"], ["Payment method", "payment_method"],
      ["Fund", "fund_name"], ["Campaign", "campaign_name"], ["Giving page", "giving_page_title"],
      ["Peer fundraiser", "peer_fundraiser_name"], ["Acknowledged", "acknowledgement_sent"],
      ["Notes", "notes"], ["Sample data", "is_sample"],
      ...cfGiftDefs.map(f => [f.label, r => renderCustomValue(f, (r.custom_fields || {})[f.key])]),
    ], gifts),
    "interactions.csv": toCsv([
      ["Donor name", "donor_name"], ["Donor email", "donor_email"],
      ["Type", "type"], ["Date", "date"], ["Note", "note"],
      ["Logged by", "logged_by_name"], ["Direction", "direction"], ["Sample data", "is_sample"],
    ], interactions),
    "grants.csv": toCsv([
      ["Funder", "funder"], ["Program", "program"], ["Amount", "amount"], ["Received", "received"],
      ["Status", "status"], ["Deadline", "deadline"], ["Report due", "report_due"], ["Officer", "officer"],
      ["Description", "description"], ["Requirements", "requirements"], ["Notes", "notes"],
      ["Sample data", "is_sample"], ["Created", "created_at"],
    ], grants),
    "pledges.csv": toCsv([
      ["Donor name", "donor_name"], ["Donor email", "donor_email"],
      ["Amount", "amount"], ["Due date", "due_date"], ["Status", "status"],
      ["Fulfilled by gift", "fulfilled_gift_id"], ["Fulfilled at", "fulfilled_at"],
      ["Notes", "notes"], ["Created", "created_at"],
    ], pledges),
    "planned_gifts.csv": toCsv([
      ["Donor name", "donor_name"], ["Donor email", "donor_email"],
      ["Type", "type"], ["Estimated value", "estimated_value"], ["Date indicated", "date_indicated"],
      ["Notes", "notes"], ["Created", "created_at"],
    ], plannedGifts),
    "recurring.csv": toCsv([
      ["Donor name", "donor_name"], ["Donor email", "donor_email"],
      ["Amount", "amount"], ["Interval", "interval"], ["Status", "status"],
      ["Failure count", "failure_count"], ["First failed", "first_failed_at"],
      ["Card fixed", "recovered_at"], ["Canceled", "canceled_at"],
      ["Stripe subscription", "stripe_subscription_id"], ["Created", "created_at"],
    ], recurring),
    "giving_pages.csv": toCsv([
      ["Title", "title"], ["Slug", "slug"], ["Goal", "goal_amount"], ["Fund", "fund_name"],
      ["Status", "status"], ["Story", "story"], ["Created", "created_at"],
    ], givingPages),
    "peer_fundraisers.csv": toCsv([
      ["Name", "name"], ["Email", "email"], ["Slug", "slug"], ["Giving page", "giving_page_title"],
      ["Personal goal", "personal_goal_amount"], ["Status", "status"], ["Story", "story"], ["Created", "created_at"],
    ], peerFundraisers),
    "receipts.csv": toCsv([
      ["Receipt number", "receipt_number"], ["Type", "type"], ["Tax year", "tax_year"],
      ["Donor name", "donor_name"], ["Donor email", "donor_email"], ["Gift date", "gift_date"],
      ["Amount", "amount"], ["Deductible amount", "deductible_amount"],
      ["Sent to", "sent_to"], ["Sent at", "sent_at"], ["Voided at", "voided_at"], ["Void reason", "void_reason"],
      ["Created", "created_at"],
    ], receipts),
  };

  const counts = { donors, gifts, interactions, grants, pledges, planned_gifts: plannedGifts, recurring, giving_pages: givingPages, peer_fundraisers: peerFundraisers, receipts };
  const readme = [
    `Steward data export · ${orgRows[0]?.name || orgId}`,
    `Exported: ${new Date().toISOString()}`,
    "",
    "This zip contains your organization's complete data as CSV files you can",
    "open in any spreadsheet, import into another system, or archive. Rows",
    "flagged in a \"Sample data\" column came from Steward's demo dataset and",
    "can be filtered out. Your data is yours, this export is available",
    "anytime, including after a subscription ends.",
    "",
    "Row counts:",
    ...Object.entries(counts).map(([k, rows]) => `  ${k}.csv: ${rows.length}`),
    "",
  ].join("\n");

  // Headers go on only after every query has succeeded, so a DB error still
  // returns a clean JSON 500 instead of a half-written zip.
  if (req.audit) req.audit.rows(Object.values(counts).reduce((n, rows) => n + rows.length, 0));   // SECURE-2 item 8
  res.setHeader("Content-Type", "application/zip");
  const filename = `steward-export-${orgSlug}-${date}.zip`;
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  // ── FIX-6 item 4 · THE SCREEN CAN SAY WHAT LEFT ──────────────────────────
  // The export worked and said nothing: the button read "Building export…",
  // the browser saved a file somewhere, and the button went back to its label.
  // Whether anything had happened was unknowable from the screen. The counts
  // already exist here for the README, so they ride out on a header and the
  // screen reports the same numbers the zip contains. Exposed for CORS, or the
  // browser hands the page a response it cannot read the header of.
  res.setHeader("X-Steward-Export-Counts", JSON.stringify(
    Object.fromEntries(Object.entries(counts).map(([k, rows]) => [k, rows.length]))));
  res.setHeader("X-Steward-Export-Filename", filename);
  res.setHeader("Access-Control-Expose-Headers", "X-Steward-Export-Counts, X-Steward-Export-Filename");
  const archive = new ZipArchive({ zlib: { level: 9 } });
  archive.on("error", err => { console.error("[export/csv] archive error:", err); res.destroy(err); });
  archive.pipe(res);
  archive.append(readme, { name: "README.txt" });
  for (const [name, csv] of Object.entries(files)) archive.append(csv, { name });
  await archive.finalize();
}));
}

module.exports = { routers, mount };
