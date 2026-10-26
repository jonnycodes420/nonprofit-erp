// tests/thread2-links.test.js · THREAD-2. EVERY NAME IS A LINK.
//
// If Steward names a person, a gift, a task or a meeting, you are one click
// from it, in the app and in the email, and never into another org.
//   §1 every Thread item type (a thread opened by an email, by a gift, by a
//      journey, with a meeting step, and a task made for a gift) carries refs
//      for what it names, and each ref's path is that record's page
//   §2 every one of those pages answers for this org after sign-in
//   §3 no Thread item shows a blank name, "null" or "Unknown"; a person with
//      no name on file shows their email; "   " and "null" are refused as names
//   §4 the morning email and the task-assignment email link every name and
//      end with one button to the main thing, and every link resolves
//   §5 a link to another org's record is refused (404), and a name in a step
//      never links to another org's record of the same name
//
// Against main: 25 of 37 fail (no refs on a Thread item, "   " and "null"
// saved as names, the blank name printed as an empty link in the morning
// email, no button, no GET /tasks/:id). Planted defects that turned it red:
// the org filter dropped from orgCatalog's events (§2, §5), the email
// fallback removed from nameOrFallback (§3, §4), the button left off the
// morning email (§4).
"use strict";

const http = require("http");
const bcrypt = require("bcryptjs");
const H = require("./helpers");
const { ok, summary, login, q, closeDb, SINK_PORT, civilToday } = H;
// The body, or { error, status } for a refusal.
const api = async (m, p, t, b) => { const r = await H.api(m, p, t, b); return r.status >= 400 ? { error: (r.body && r.body.error) || String(r.status), status: r.status } : r.body; };

const ORG = "org_thread2", OTHER = "org_thread2b";
const PW = "loadtest1234";
const sys = "'system:test','test'";

const captured = [];
function startSink() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let body = "";
      req.on("data", c => (body += c));
      req.on("end", () => {
        let j = {}; try { j = JSON.parse(body); } catch { /* not json */ }
        captured.push({ to: [].concat(j.to || []).join(","), subject: j.subject || "", html: j.html || "" });
        // SINK_DUMP=<dir> keeps each email's HTML, for the walk's screenshots.
        if (process.env.SINK_DUMP) require("fs").writeFileSync(`${process.env.SINK_DUMP}/${captured.length}-${(j.subject || "email").replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}.html`, j.html || "");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: "sink_" + captured.length }));
      });
    });
    srv.listen(SINK_PORT, () => resolve(srv));
  });
}

async function reset() {
  const tables = await q(`SELECT table_name FROM information_schema.columns WHERE column_name='org_id' AND table_schema='public' AND table_name NOT IN ('orgs','fin_audit_log')`).catch(() => []);
  for (const o of [ORG, OTHER]) {
    for (let pass = 0; pass < 2; pass++) for (const r of tables) await q(`DELETE FROM ${r.table_name} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}

const hrefs = html => [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(m => ({ href: m[1].replace(/&amp;/g, "&"), text: m[2].trim() }));
const pathOf = href => { const u = new URL(href); return u.pathname + u.search + u.hash; };
const BLANK = /(^|\s)(null|undefined|unknown|untitled)(\s|$)/i;

(async () => {
  console.log("thread2-links (THREAD-2)");
  const L = await import("../shared/itemLinks.js");
  const sink = await startSink();
  await reset();
  const today = civilToday();
  const pw = bcrypt.hashSync(PW, 4);
  for (const [o, name] of [[ORG, "Thread Two Rowing"], [OTHER, "Other Harbor"]]) {
    // NUMBERS-2: the morning email leaves the Thread out on weekends unless the
    // org turns weekends on, so on a Saturday or Sunday this suite read an
    // email with no Thread in it. The fixture says weekends on.
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,onboarded_at,subscription_status,plan,timezone,timezone_confirmed_at,receipt_address,thread_nudge_weekends)
             VALUES ($1,$2,$3,1,NOW(),'active','team','America/New_York',NOW(),'12 Harbor Rd, Wilmington, NC 28401',true)`, [o, name, o.replace(/_/g, "-")]);
  }
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES
     ('u_t2_admin',$1,'t2-admin@thread2.example',$3,'Dana Reyes','admin'),
     ('u_t2_off',$1,'t2-officer@thread2.example',$3,'Sam Ortiz','member'),
     ('u_t2b_admin',$2,'t2b-admin@thread2.example',$3,'Lee Park','admin')`, [ORG, OTHER, pw]);

  // People. Nadia has a real name; the second was saved with a blank name
  // before this build (a legacy row), and must show her email instead.
  const P = { nadia: "d_t2_nadia", blank: "d_t2_blank", gift: "d_t2_gift", jour: "d_t2_jour", meet: "d_t2_meet", task: "d_t2_task" };
  const names = { nadia: "Nadia Okafor", blank: "   ", gift: "Henry Vale", jour: "Ruth Ames", meet: "Omar Lind", task: "Iris Bell" };
  for (const k of Object.keys(P)) {
    await q(`INSERT INTO donors (id,org_id,name,email,stage,status,tags,created_by,created_by_name) VALUES ($1,$2,$3,$4,'prospect','active','[]',${sys})`,
      [P[k], ORG, names[k], `${k}@thread2.example`]);
  }
  await q(`INSERT INTO donors (id,org_id,name,email,stage,status,tags,created_by,created_by_name) VALUES ('d_t2b_x',$1,'Other Person','x@thread2.example','prospect','active','[]',${sys})`, [OTHER]);

  // The org's named things, and the SAME names in the other org.
  await q(`INSERT INTO events (id,org_id,name,event_type,date) VALUES ('ev_t2','${ORG}','Harbor Run','fundraiser',$1), ('ev_t2b','${OTHER}','Harbor Run','fundraiser',$1)`, [today]);
  await q(`INSERT INTO campaigns (id,org_id,name,type,status) VALUES ('c_t2','${ORG}','Spring Appeal','appeal','active'), ('c_t2b','${OTHER}','Spring Appeal','appeal','active')`);
  await q(`INSERT INTO audiences (id,org_id,name,segment,kind) VALUES ('aud_t2','${ORG}','Board Circle','{}','static'), ('aud_t2b','${OTHER}','Board Circle','{}','static')`);
  await q(`INSERT INTO cultivation_templates (id,org_id,name,steps) VALUES ('ct_t2','${ORG}','Major giving','[]')`);

  // §1 fixtures: one item of each type.
  await q(`INSERT INTO interactions (id,org_id,donor_id,type,date,note,logged_by_name) VALUES ('i_t2_email',$1,$2,'email',$3,'She wrote back about the Harbor Run','Dana Reyes')`, [ORG, P.nadia, today]);
  await q(`INSERT INTO threads (id,org_id,donor_id,next_step_type,next_step_label,due_date,opened_on,opening_interaction_id,owner_id,owner_name,created_by,created_by_name)
           VALUES ('th_t2_email',$1,$2,'invite','Invite her to the Harbor Run and the Board Circle',$3,$3,'i_t2_email','u_t2_admin','Dana Reyes',${sys})`, [ORG, P.nadia, today]);
  await q(`INSERT INTO threads (id,org_id,donor_id,next_step_type,next_step_label,due_date,opened_on,owner_id,owner_name,created_by,created_by_name)
           VALUES ('th_t2_blank',$1,$2,'call','Call about the Spring Appeal',$3,$3,'u_t2_admin','Dana Reyes',${sys})`, [ORG, P.blank, today]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,payment_method,created_by,created_by_name) VALUES ('g_t2',$1,$2,500,$3,'check',${sys})`, [ORG, P.gift, today]);
  await q(`INSERT INTO threads (id,org_id,donor_id,next_step_type,next_step_label,due_date,opened_on,opening_gift_id,owner_id,owner_name,created_by,created_by_name)
           VALUES ('th_t2_gift',$1,$2,'thank','Send a thank-you',$3,$3,'g_t2','u_t2_admin','Dana Reyes',${sys})`, [ORG, P.gift, today]);
  await q(`INSERT INTO threads (id,org_id,donor_id,next_step_type,next_step_label,due_date,opened_on,owner_id,owner_name,created_by,created_by_name)
           VALUES ('th_t2_jour',$1,$2,'send','Send a handwritten note',$3,$3,'u_t2_admin','Dana Reyes','system:journey','Steward (journey)')`, [ORG, P.jour, today]);
  await q(`INSERT INTO cultivation_plans (id,org_id,donor_id,template_id,template_name,applied_on,status,created_by,created_by_name) VALUES ('cp_t2',$1,$2,'ct_t2','Major giving',$3,'active',${sys})`, [ORG, P.jour, today]);
  await q(`INSERT INTO cultivation_plan_steps (id,org_id,plan_id,seq,step_type,label,due_date,status,thread_id) VALUES ('cps_t2',$1,'cp_t2',1,'send','Send a handwritten note',$2,'open','th_t2_jour')`, [ORG, today]);
  await q(`INSERT INTO calendar_events (id,org_id,owner_user_id,provider,provider_event_id,title,starts_at,ends_at,person_ids,created_by)
           VALUES ('ce_t2',$1,'u_t2_admin','google','pe_t2','Coffee with Omar',$2::date + time '15:00',$2::date + time '16:00','{${P.meet}}','system:test')`, [ORG, today]);
  await q(`INSERT INTO threads (id,org_id,donor_id,next_step_type,next_step_label,due_date,opened_on,calendar_event_id,owner_id,owner_name,created_by,created_by_name)
           VALUES ('th_t2_meet',$1,$2,'meeting','Coffee with Omar',$3,$3,'ce_t2','u_t2_admin','Dana Reyes',${sys})`, [ORG, P.meet, today]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,payment_method,created_by,created_by_name) VALUES ('g_t2_task',$1,$2,250,$3,'check',${sys})`, [ORG, P.task, today]);
  await q(`INSERT INTO tasks (id,org_id,title,due,priority,type,done,donor_id,assigned_to,assigned_to_name,source_gift_id,created_by,created_by_name)
           VALUES ('t_t2_task',$1,'Thank Iris for the gift',$2,'high','donor',0,$3,'u_t2_admin','Dana Reyes','g_t2_task',${sys})`, [ORG, today, P.task]);
  await q(`INSERT INTO tasks (id,org_id,title,due,priority,type,done,donor_id,created_by,created_by_name) VALUES ('t_t2b',$1,'Other org task',$2,'high','donor',0,'d_t2b_x',${sys})`, [OTHER, today]);

  const tok = await login("t2-admin@thread2.example", PW);
  const tokB = await login("t2b-admin@thread2.example", PW);
  const th = await api("GET", "/threads?scope=all&cap=50", tok);
  const list = (th && th.list) || [];
  const item = id => list.find(t => t.id === id);

  console.log("§1 every Thread item type links what it names");
  ok("all five items are on the Thread", ["th_t2_email", "th_t2_blank", "th_t2_gift", "th_t2_jour", "th_t2_meet", "t_t2_task"].every(id => item(id)), list.map(t => t.id).join(","));
  const refOf = (id, kind) => ((item(id) || {}).refs || []).find(r => r.kind === kind);
  const expect = [
    ["th_t2_email", "person", `/donors/${P.nadia}`],
    ["th_t2_email", "email", `/donors/${P.nadia}#item-i_t2_email`],
    ["th_t2_email", "event", `/app/events?event=ev_t2`],
    ["th_t2_email", "group", `/app/groups?group=aud_t2`],
    ["th_t2_blank", "campaign", `/app/communications?campaign=c_t2`],
    ["th_t2_gift", "gift", `/donors/${P.gift}#gift-g_t2`],
    ["th_t2_jour", "journey", `/app/journeys?journey=ct_t2`],
    ["th_t2_meet", "meeting", `/app/calendar?day=${today}`],
    ["t_t2_task", "task", `/app/tasks?task=t_t2_task`],
    ["t_t2_task", "gift", `/donors/${P.task}#gift-g_t2_task`],
  ];
  for (const [id, kind, path] of expect) {
    const r = refOf(id, kind);
    ok(`${id}: its ${kind} opens ${path}`, r && L.refPath(r) === path, r ? L.refPath(r) : "no ref");
  }
  ok("a thread's step opens its own task", (item("th_t2_email") || {}).stepRef && L.refPath(item("th_t2_email").stepRef).startsWith("/app/tasks?task="), JSON.stringify((item("th_t2_email") || {}).stepRef));
  ok("a meeting step opens the meeting", item("th_t2_meet") && L.refPath(item("th_t2_meet").stepRef) === `/app/calendar?day=${today}`);
  const segs = L.linkSegments(item("th_t2_email")?.nextStep?.label, item("th_t2_email")?.refs);
  ok("the step's words link the event and the group", segs.filter(s => s.ref).map(s => s.text).join("|") === "Harbor Run|Board Circle", segs.map(s => s.text).join("|"));

  console.log("§2 every page answers for this org");
  const allRefs = list.flatMap(t => [...(t.refs || []), ...(t.stepRef ? [t.stepRef] : [])]);
  const apiFor = r => ({ person: `/donors/${r.id}`, task: `/tasks/${r.id}`, event: `/events/${r.id}`, group: `/groups/${r.id}`,
    journey: `/journeys/${r.id}/stats` })[r.kind];
  let resolved = 0;
  for (const r of allRefs.filter(r => apiFor(r))) {
    const got = await api("GET", apiFor(r), tok);
    if (got && !got.error) resolved++; else console.log("   did not resolve", r.kind, r.id, JSON.stringify(got).slice(0, 120));
  }
  ok("every person, task, event, group and journey link resolves signed in", resolved === allRefs.filter(r => apiFor(r)).length, `${resolved} of ${allRefs.filter(r => apiFor(r)).length}`);

  console.log("§3 no blank names");
  const blank = item("th_t2_blank");
  ok("a person saved with a blank name shows their email", blank && blank.donorName === "blank@thread2.example", blank && JSON.stringify(blank.donorName));
  ok("no Thread item shows a blank, null or Unknown name", list.every(t => t.donorName && !BLANK.test(t.donorName) && (t.refs || []).every(r => L.refLabel(r) && !BLANK.test(L.refLabel(r)))));
  ok("no label is a raw id", allRefs.every(r => L.refLabel(r) !== r.id));
  for (const bad of ["   ", "null", "undefined"]) {
    const r = await api("POST", "/donors", tok, { name: bad, email: "bad@thread2.example" });
    ok(`"${bad}" is refused as a name`, r && r.error === "Name required", JSON.stringify(r).slice(0, 80));
  }

  console.log("§4 staff emails link every name and end with one button");
  captured.length = 0;
  await api("POST", "/nudges/run", tok, { today, force: true });
  const brief = captured.find(c => c.to.includes("t2-admin@thread2.example"));
  ok("the morning email was sent", !!brief, captured.map(c => c.to + " " + c.subject).join("; "));
  const links = brief ? hrefs(brief.html) : [];
  for (const [k, who] of [["nadia", "Nadia Okafor"], ["gift", "Henry Vale"], ["blank", "blank@thread2.example"]]) {
    ok(`the email links ${who} to their record`, links.some(a => a.text === who && pathOf(a.href).startsWith(`/donors/${P[k]}`)), links.map(a => a.text).join(" | "));
  }
  ok("a step in the email links its task", links.some(a => /^\/app\/tasks\?task=/.test(pathOf(a.href))));
  ok("the morning email ends with one button", brief && (brief.html.match(/data-email-button/g) || []).length === 1 && /Open /.test(brief.html.split("data-email-button")[1] || ""));
  ok("no blank or null name in the morning email", brief && !/>\s*(null|undefined|Unknown)?\s*<\/a>/.test(brief.html) && !/ · \s*· /.test(brief.html));

  captured.length = 0;
  const made = await api("POST", "/tasks", tok, { title: "Call Nadia about the Harbor Run", due: today, type: "call", donorId: P.nadia, assignedTo: "u_t2_off" });
  for (let i = 0; i < 20 && !captured.some(c => c.to.includes("t2-officer@")); i++) await new Promise(r => setTimeout(r, 100));
  const assign = captured.find(c => c.to.includes("t2-officer@thread2.example"));
  ok("the task-assignment email was sent", !!assign);
  const aLinks = assign ? hrefs(assign.html) : [];
  ok("it links the task", made && aLinks.some(a => pathOf(a.href) === `/app/tasks?task=${made.id}`), aLinks.map(a => pathOf(a.href)).join(" "));
  ok("its one button opens Nadia Okafor", assign && /data-email-button[\s\S]*Open Nadia Okafor/.test(assign.html) && aLinks.some(a => a.text === "Open Nadia Okafor" && pathOf(a.href) === `/donors/${P.nadia}`));
  // After sign-in, every link in both emails is a page this person can open.
  let emailOk = 0, emailAll = 0;
  for (const a of [...links, ...aLinks]) {
    const p = pathOf(a.href);
    const m = p.match(/^\/donors\/([^?#]+)/) || null;
    const t = p.match(/^\/app\/tasks\?task=([^&#]+)/);
    if (!m && !t) continue;
    emailAll++;
    const got = await api("GET", m ? `/donors/${decodeURIComponent(m[1])}` : `/tasks/${decodeURIComponent(t[1])}`, tok);
    if (got && !got.error) emailOk++;
  }
  ok("every person and task link in the emails resolves after sign-in", emailAll > 3 && emailOk === emailAll, `${emailOk} of ${emailAll}`);

  console.log("§5 tenants");
  const t404 = await api("GET", "/tasks/t_t2b", tok);
  ok("another org's task is refused", t404 && t404.error === "not_found", JSON.stringify(t404).slice(0, 80));
  const d404 = await api("GET", "/donors/d_t2b_x", tok);
  ok("another org's person is refused", d404 && d404.error, JSON.stringify(d404).slice(0, 80));
  const mine = await api("GET", "/tasks/t_t2b", tokB);
  ok("the other org opens its own task", mine && mine.id === "t_t2b");
  ok("a name shared with another org links only to this org's record",
    allRefs.filter(r => ["event", "campaign", "group"].includes(r.kind)).every(r => !/t2b$/.test(r.id)));
  const otherSees = await api("GET", "/threads?scope=all", tokB);
  ok("the other org's Thread names none of these people", !JSON.stringify(otherSees).includes("d_t2_"));

  await reset();
  sink.close();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch { /* closed */ } process.exit(1); });
