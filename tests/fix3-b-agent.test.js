// FIX-3 B — THE AGENT'S ASK (claude/FIX-3.md Part 0, findings 4–7).
//
// The 27 September walk, after FIX-2, typed into Agent:
//
//     "ada just became a volunteer and wants to do 15 hours a week"
//
// and got "Read your 398 people", then a donor-style note, a task "Confirm
// which Ada", a follow-up and a draft, under a headline that ran every step
// into one sentence. And the ask itself had no obvious go button.
//
//   §5  AN INSTRUCTION THAT NAMES ONE PERSON READS THAT PERSON. The class was a
//       person named by a first name alone ("ada", in lower case): the scoping
//       rule needed two tokens of a person's name, so a first name named nobody
//       and the plan read the whole file. Replayed with the EXACT sentence
//       against a fixture org holding one "Ada …" and 400 others.
//   §6  THE PLAN FITS THE INSTRUCTION, deterministically (no model on this
//       stack): tag Ada Volunteer (person_types, one record), her availability
//       as a volunteer INTERNAL note (volunteer_notes, never interactions), and
//       one welcome DRAFT (agent_drafts, never a send). Two Adas → Steward asks
//       which BEFORE planning, and writes nothing.
//   §7  THE HEADLINE IS ONE SHORT SENTENCE, for every plan: at most three
//       clauses, at most 100 characters, one full stop, no "then".
//   §4  THE GO BUTTON (browser): a visible primary button beside the box at all
//       times, disabled until there is text; Enter submits (Shift+Enter is a
//       new line in the Ask box). Screenshots at 1440 and 390.
//
// Needs the stack (BASE, DATABASE_URL). §4 needs Playwright + a built dist and
// SKIPs (exit 0) without them. The stack runs WITHOUT an ANTHROPIC_API_KEY, so
// every plan here is Steward's own code.

const fs = require("fs"), path = require("path");
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, BASE } = require("./helpers");

const root = path.join(__dirname, "..");
const ORG = "org_fx3bagent";
const OTHER = "org_fx3bother";
const PASS = "loadtest1234";
const ADMIN = "director@fx3bagent.example.org";
const THEM = "director@fx3bother.example.org";
const APP = process.env.APP_URL || "http://localhost:4173";
const PW_DIR = process.env.PLAYWRIGHT_DIR || (process.env.HOME + "/steward-qa");
const DIST = path.join(root, "client", "dist", "index.html");
const SHOTS = process.env.FIX3B_SHOTS || "";
const haveBrowser = () => { try { require(path.join(PW_DIR, "node_modules", "playwright")); } catch { return false; } return fs.existsSync(DIST); };

// THE EXACT SENTENCE from the walk. Not paraphrased, not capitalised.
const ADA = "ada just became a volunteer and wants to do 15 hours a week";
const ADA_HEADLINE = "Make Ada Lovelace a volunteer, note 15 hours a week, and draft a welcome.";

const CHILD = ["agent_writes", "agent_drafts", "agent_runs", "agent_instructions", "volunteer_notes", "volunteer_shifts",
  "interactions", "threads", "tasks", "ai_log", "donors", "users"];
async function reset() {
  for (const o of [ORG, OTHER]) {
    for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}
const WRITES = ["agent_instructions", "agent_runs", "agent_writes", "agent_drafts", "volunteer_notes", "interactions",
  "threads", "tasks", "gifts", "ai_log"];
async function counts() {
  const out = {};
  for (const t of WRITES) out[t] = (await q(`SELECT COUNT(*)::int AS n FROM ${t} WHERE org_id=$1`, [ORG]))[0].n;
  out.types = JSON.stringify((await q(`SELECT id, person_types FROM donors WHERE org_id=$1 AND person_types @> '["volunteer"]'::jsonb ORDER BY id`, [ORG])));
  return out;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Four hundred other people, several of whom share letters with "Ada" but not
// the whole word: Adam, Adaline, Adara, Rada, Nada. And a few whose first name
// is also an ordinary English word, which an instruction may say in lower case.
const FIRST = ["Adam", "Adaline", "Adara", "Rada", "Nada", "Margaret", "Robert", "Diana", "Otis", "Ruth", "Samuel",
  "Henry", "Alice", "Clara", "Joseph", "Miriam", "Walter", "Esther", "Leonard", "Pauline", "Marcus", "Delia"];
const LAST = ["Okonkwo", "Brennan", "Whitfield", "Castellano", "Pryce", "Ibarra", "Lindqvist", "Moreau", "Haddad",
  "Szabo", "Ferreira", "Nakamura", "Abernathy", "Quintero", "Olsen", "Vance", "Kowalski", "Achebe", "Duarte", "Tamura"];
function others(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `d_fx3b_${String(i).padStart(3, "0")}`, name: `${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / FIRST.length) % LAST.length]}${i >= FIRST.length * LAST.length ? " " + i : ""}`,
    kind: "person" }));
}

(async () => {
  console.log("fix3-b-agent");
  const A = await import("../shared/agentShape.js");
  const fn = n => typeof A[n] === "function";

  // ── §5 · THE SCOPE, PURE ──────────────────────────────────────────────────
  console.log("\n— §5 · an instruction that names one person reads that person (pure) —");
  const LOVELACE = { id: "d_fx3b_ada", name: "Ada Lovelace", kind: "person" };
  const PEOPLE = [LOVELACE, ...others(400),
    { id: "d_fx3b_will", name: "Will Turner", kind: "person" }, { id: "d_fx3b_grace", name: "Grace Abernathy", kind: "person" }];
  const scope = A.scopeFromInstruction(ADA, PEOPLE);
  ok("§5 the exact sentence scopes to exactly one record: Ada Lovelace",
    Array.isArray(scope) && scope.length === 1 && scope[0] === "d_fx3b_ada", scope);
  ok("§5 …in any case: \"Ada\" and \"ADA\" read the same one record",
    same(A.scopeFromInstruction(ADA.replace("ada", "Ada"), PEOPLE), ["d_fx3b_ada"])
    && same(A.scopeFromInstruction(ADA.replace("ada", "ADA"), PEOPLE), ["d_fx3b_ada"]));
  ok("§5 a letter run is not a name: \"Adam\", \"Adaline\", \"Rada\" are not Ada",
    !(scope || []).some(id => id !== "d_fx3b_ada"));
  ok("§5 the full name still wins: \"Ada Lovelace\" reads Ada Lovelace",
    same(A.scopeFromInstruction("Ada Lovelace just became a volunteer", PEOPLE), ["d_fx3b_ada"]));
  ok("§5 an instruction naming nobody is still the whole file (null)",
    A.scopeFromInstruction("Draft a note to everyone who gave last year", PEOPLE) === null);
  ok("§5 a first name that is an ordinary word, in lower case, names nobody (\"will\", \"grace\")",
    A.scopeFromInstruction("draft a note that will say thank you with grace to everyone who gave", PEOPLE) === null);
  ok("§5 …but written as a name it is one (\"Will just became a volunteer\")",
    same(A.scopeFromInstruction("Will just became a volunteer", PEOPLE), ["d_fx3b_will"]));
  ok("§5 a first name inside a full name someone else carries does not also name that first name's others",
    same(A.scopeFromInstruction("Ada Lovelace gave again",
      [...PEOPLE, { id: "d_fx3b_ada2", name: "Ada King", kind: "person" }]), ["d_fx3b_ada"]));
  ok("§5 agentShape says WHICH name is ambiguous (namedIn)", fn("namedIn"));
  if (fn("namedIn")) {
    const two = A.namedIn(ADA, [...PEOPLE, { id: "d_fx3b_ada2", name: "Ada King", kind: "person" }]);
    ok("§5 two Adas: both are named, and the name is marked ambiguous",
      two && same([...two.ids].sort(), ["d_fx3b_ada", "d_fx3b_ada2"]) && two.ambiguous.length === 1
      && same([...two.ambiguous[0].ids].sort(), ["d_fx3b_ada", "d_fx3b_ada2"]) && /^ada$/i.test(two.ambiguous[0].said), two);
    const one = A.namedIn(ADA, PEOPLE);
    ok("§5 one Ada: named, not ambiguous", one && same(one.ids, ["d_fx3b_ada"]) && one.ambiguous.length === 0, one);
  }

  // ── §6 · THE VOLUNTEER NEWS, PURE ────────────────────────────────────────
  console.log("\n— §6 · \"X became a volunteer\" is recognised by Steward, not a model (pure) —");
  ok("§6 agentShape exports volunteerNews and volunteerSteps", fn("volunteerNews") && fn("volunteerSteps"));
  if (fn("volunteerNews")) {
    const n = A.volunteerNews(ADA);
    ok("§6 the exact sentence is volunteer news with 15 hours a week", !!n && n.availability === "15 hours a week", n);
    const n2 = A.volunteerNews("Marcus Pryce signed up to volunteer on Saturday mornings");
    ok("§6 \"signed up to volunteer\" is news too (no hours: no availability number)", !!n2, n2);
    ok("§6 \"Ada Lovelace is now a volunteer\" is news", !!A.volunteerNews("Ada Lovelace is now a volunteer"));
    ok("§6 \"mark Ada as a volunteer, 4 hours a month\" is news with 4 hours a month",
      (A.volunteerNews("mark Ada as a volunteer, 4 hours a month") || {}).availability === "4 hours a month");
    for (const s of ["find the volunteers who gave last year", "how many volunteers do we have",
      "draft a thank-you to every volunteer", "everyone who became a volunteer this year"])
      ok(`§6 not news: "${s}"`, A.volunteerNews(s) === null, A.volunteerNews(s));
    ok("§6 the money refusal does not fire on the exact sentence", A.moneyRefusal(ADA) === null);
    ok("§6 …nor is it gift news, nor a read", !A.isGiftNews(ADA) && A.readIntent(ADA) === null);
  }
  if (fn("volunteerSteps")) {
    const steps = A.volunteerSteps(LOVELACE, A.volunteerNews(ADA), { instruction: ADA, welcome: { subject: "Welcome", body: "Welcome." } });
    ok("§6 three steps: tag Volunteer, note availability, draft a welcome — in that order",
      same(steps.map(s => s.tool), ["mark_volunteer", "note_volunteer", "draft_note"]), steps.map(s => s.tool));
    ok("§6 every step is about Ada and cites her row",
      steps.every(s => s.donorId === "d_fx3b_ada" && same(s.citesRows, ["d_fx3b_ada"])));
    ok("§6 the note is an AVAILABILITY note that says 15 hours a week",
      steps[1] && steps[1].kind === "availability" && /15 hours a week/.test(steps[1].note || ""), steps[1]);
    ok("§6 no step logs a donor note, opens a follow-up or creates a task",
      !steps.some(s => ["log_note", "open_thread", "create_task"].includes(s.tool)));
    const already = A.volunteerSteps({ ...LOVELACE, person_types: ["donor", "volunteer"] }, A.volunteerNews(ADA), { instruction: ADA, welcome: { subject: "W", body: "W." } });
    ok("§6 already a volunteer: no tag step", !already.some(s => s.tool === "mark_volunteer"), already.map(s => s.tool));
    const dnc = A.volunteerSteps({ ...LOVELACE, do_not_contact: true }, A.volunteerNews(ADA), { instruction: ADA, welcome: { subject: "W", body: "W." } });
    ok("§6 do-not-contact: no welcome draft", !dnc.some(s => s.tool === "draft_note"), dnc.map(s => s.tool));
    ok("§6 the new tools are declared, run on their own, and undoable",
      ["mark_volunteer", "note_volunteer"].every(t => A.TOOLS_BY_NAME[t] && A.TOOLS_BY_NAME[t].needsHuman === "never" && A.UNDOABLE.includes(t)));
  }

  // ── §7 · THE HEADLINE, PURE ──────────────────────────────────────────────
  console.log("\n— §7 · the headline is one short sentence, for every plan —");
  const SUN = { id: "d_sun", name: "Sunrise Foundation", kind: "organisation" };
  const MANY = others(40);
  const byName = [LOVELACE, SUN, ...MANY];
  const PLANS = {
    ada: fn("volunteerSteps") ? A.volunteerSteps(LOVELACE, A.volunteerNews(ADA) || {}, { instruction: ADA, welcome: { subject: "W", body: "W." } }) : [],
    gift: [{ tool: "record_gift", donorId: "d_sun", amountCents: 500000 }, { tool: "open_thread", donorId: "d_sun", label: "Thank the Sunrise Foundation", after: "record_gift" }],
    // The walk's run-on: five different tools on one person.
    five: [{ tool: "log_note", donorId: "d_fx3b_ada", note: "x" }, { tool: "add_tag", donorId: "d_fx3b_ada", tag: "Volunteer" },
      { tool: "create_task", donorId: "d_fx3b_ada", title: "Confirm which Ada" }, { tool: "open_thread", donorId: "d_fx3b_ada", label: "Follow up" },
      { tool: "draft_note", donorId: "d_fx3b_ada", subject: "Welcome" }],
    forty: MANY.map(p => ({ tool: "draft_note", donorId: p.id, subject: "Thank you" })),
    mixed: [...MANY.slice(0, 12).map(p => ({ tool: "draft_note", donorId: p.id })), ...MANY.slice(0, 12).map(p => ({ tool: "add_tag", donorId: p.id, tag: "LYBUNT" })),
      { tool: "create_task", title: "Call the top three" }],
    one: [{ tool: "set_stage", donorId: "d_sun", stage: "cultivate" }],
  };
  for (const [k, steps] of Object.entries(PLANS)) {
    const plan = A.compilePlan(steps, { people: byName, withheld: k === "forty" ? 3 : 0 });
    const h = String(plan.summary || "");
    const clauses = h.replace(/\.$/, "").split(/,\s*and\s+|,\s+|\s+and\s+/).filter(Boolean);
    ok(`§7 ${k}: one sentence, ending in a full stop`, /^[A-Z]/.test(h) && /\.$/.test(h) && !/[.!?]\s/.test(h), h);
    ok(`§7 ${k}: at most 100 characters (${h.length})`, h.length <= 100, h);
    ok(`§7 ${k}: at most three clauses, and no "then"`, clauses.length <= 3 && !/\bthen\b/i.test(h), clauses);
    ok(`§7 ${k}: the steps list still carries every step`, plan.steps.length === steps.length
      && plan.steps.every(s => typeof s.describes === "string" && s.describes.length > 4));
  }
  const adaPlan = A.compilePlan(PLANS.ada, { people: byName });
  ok("§7 the Ada headline reads: " + ADA_HEADLINE, adaPlan.summary === ADA_HEADLINE, adaPlan.summary);
  const giftPlan = A.compilePlan(PLANS.gift, { people: byName });
  ok("§7 the gift headline still names the gift and the follow-up",
    /gift/i.test(giftPlan.summary) && /follow/i.test(giftPlan.summary), giftPlan.summary);
  const fortyPlan = A.compilePlan(PLANS.forty, { people: byName, withheld: 3 });
  ok("§7 what was left out is its own line (plan.withheld), not a second sentence in the headline",
    fortyPlan.withheld === 3 && !/left out/.test(fortyPlan.summary), fortyPlan.summary);

  // ── THE STACK ─────────────────────────────────────────────────────────────
  await reset();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,receipt_address,ai_enabled)
           VALUES ($1,'Lantern Street Pantry','fx3bagent',1,'team','active','1 Main St, Lexington, KY 40507',true)`, [ORG]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,receipt_address)
           VALUES ($1,'Other Pantry','fx3bother',1,'team','active','2 Main St, Lexington, KY 40507')`, [OTHER]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_fx3b_a',$1,$2,$3,'Rosa Delgado','admin')`,
    [ORG, ADMIN, bcrypt.hashSync(PASS, 4)]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_fx3b_t',$1,$2,$3,'Them','admin')`,
    [OTHER, THEM, bcrypt.hashSync(PASS, 4)]);
  const mk = (id, name, org = ORG, extra = "'[\"donor\"]'") => q(
    `INSERT INTO donors (id,org_id,name,email,kind,stage,tags,person_types,total_giving,gift_count,created_by,created_by_name)
     VALUES ($1,$2,$3,$4,'person','cultivate','[]',${extra}::jsonb,100,1,'u_fx3b_a','Rosa Delgado')`, [id, org, name, id + "@example.org"]);
  await mk(LOVELACE.id, LOVELACE.name);
  for (const p of others(400)) await mk(p.id, p.name);
  await mk("d_fx3b_ada_x", "Ada Foreign", OTHER);
  const tok = await login(ADMIN, PASS);
  const theirTok = await login(THEM, PASS);
  const [{ n: onFile }] = await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1`, [ORG]);
  ok("fixture: 401 people on file, one of them Ada", onFile === 401, onFile);

  // ── §5 · THE REPLAY ──────────────────────────────────────────────────────
  console.log("\n— §5 · the replay: the exact sentence reads one record —");
  const before = await counts();
  const r = await api("POST", "/agent/instructions", tok, { text: ADA });
  const plan = (r.body && r.body.plan) || {};
  ok("§5 the exact sentence plans (201) with no model on this stack", r.status === 201, { status: r.status, body: r.body });
  ok("§5 the plan read exactly one record", Array.isArray(plan.readIds) && plan.readIds.length === 1 && plan.readIds[0] === LOVELACE.id, plan.readIds);
  ok("§5 …and says so: \"Ada Lovelace's record\", never \"your 401 people\"",
    plan.reads === "Ada Lovelace's record" && !/people/.test(plan.reads || ""), plan.reads);

  // ── §6 · THE PLAN, ON THE STACK ──────────────────────────────────────────
  console.log("\n— §6 · the plan fits the instruction —");
  ok("§6 three steps: tag Volunteer, availability note, welcome draft",
    same((plan.steps || []).map(s => s.tool), ["mark_volunteer", "note_volunteer", "draft_note"]), (plan.steps || []).map(s => s.tool));
  ok("§6 the headline: " + ADA_HEADLINE, plan.summary === ADA_HEADLINE, plan.summary);
  ok("§6 nothing sends", plan.sends === 0);
  const afterPlan = await counts();
  ok("§6 planning wrote the instruction row and nothing else",
    afterPlan.agent_instructions === before.agent_instructions + 1
    && same({ ...afterPlan, agent_instructions: 0 }, { ...before, agent_instructions: 0 }), { before, afterPlan });
  const [{ n: intBefore }] = await q(`SELECT COUNT(*)::int AS n FROM interactions WHERE org_id=$1 AND donor_id=$2`, [ORG, LOVELACE.id]);
  const run = await api("POST", `/agent/instructions/${r.body && r.body.id}/confirm`, tok, {});
  ok("§6 the run finishes", run.status === 200 && run.body.status === "done", run.body);
  ok("§6 …every step done or waiting for her (the draft)", (run.body.steps || []).length === 3
    && run.body.steps.every(s => s.outcome === "done" || s.outcome === "waiting"), run.body.steps);
  const [ada] = await q(`SELECT person_types FROM donors WHERE id=$1 AND org_id=$2`, [LOVELACE.id, ORG]);
  const types = Array.isArray(ada.person_types) ? ada.person_types : JSON.parse(ada.person_types || "[]");
  ok("§6 (a) Ada carries the Volunteer role on her ONE record, and keeps Donor", types.includes("volunteer") && types.includes("donor"), types);
  const [{ n: rows }] = await q(`SELECT COUNT(*)::int AS n FROM donors WHERE org_id=$1`, [ORG]);
  ok("§6 …and no second record was made", rows === 401, rows);
  const notes = await q(`SELECT kind, body, created_by, created_by_name FROM volunteer_notes WHERE org_id=$1 AND person_id=$2`, [ORG, LOVELACE.id]);
  ok("§6 (b) one volunteer INTERNAL note, kind availability, saying 15 hours a week",
    notes.length === 1 && notes[0].kind === "availability" && /15 hours a week/.test(notes[0].body), notes);
  ok("§6 …stamped with the agent as actor", notes[0] && notes[0].created_by === "system:agent" && !!notes[0].created_by_name, notes[0]);
  const [{ n: intAfter }] = await q(`SELECT COUNT(*)::int AS n FROM interactions WHERE org_id=$1 AND donor_id=$2`, [ORG, LOVELACE.id]);
  ok("§6 …and NOTHING on the donor timeline (interactions unchanged)", intAfter === intBefore, { intBefore, intAfter });
  const hub = await api("GET", `/volunteer-hub/notes?personId=${LOVELACE.id}`, tok);
  ok("§6 the note shows in the Volunteers hub", hub.status === 200 && (hub.body.notes || []).some(n => n.kind === "availability" && /15 hours a week/.test(n.body)), hub.body);
  const roster = await api("GET", "/volunteer-hub/roster", tok);
  ok("§6 …and Ada is on the roster", (roster.body.people || []).some(p => p.id === LOVELACE.id));
  const drafts = await q(`SELECT subject, body, status FROM agent_drafts WHERE org_id=$1 AND donor_id=$2`, [ORG, LOVELACE.id]);
  ok("§6 (c) one welcome DRAFT, pending, waiting for her", drafts.length === 1 && drafts[0].status === "pending" && /welcome/i.test(drafts[0].subject || ""), drafts);
  const [runRow] = await q(`SELECT sent, read_summary FROM agent_runs WHERE org_id=$1 ORDER BY started_at DESC LIMIT 1`, [ORG]);
  ok("§6 …nothing sent, and the run says it read Ada's record", runRow && runRow.sent === 0 && runRow.read_summary === "Ada Lovelace's record", runRow);
  // Undo, for thirty days, restores what the record was.
  const writes = await q(`SELECT id, tool FROM agent_writes WHERE org_id=$1 ORDER BY created_at`, [ORG]);
  ok("§6 every write is in the undo ledger", same(writes.map(w => w.tool).sort(), ["draft_note", "mark_volunteer", "note_volunteer"]), writes);
  const undoTag = writes.find(w => w.tool === "mark_volunteer");
  const un = undoTag ? await api("POST", `/agent/writes/${undoTag.id}/undo`, tok, {}) : { status: 0 };
  const [ada2] = await q(`SELECT person_types FROM donors WHERE id=$1 AND org_id=$2`, [LOVELACE.id, ORG]);
  const types2 = Array.isArray(ada2.person_types) ? ada2.person_types : JSON.parse(ada2.person_types || "[]");
  ok("§6 undoing the tag puts her roles back as they were", un.status === 200 && same(types2, ["donor"]), { un: un.body, types2 });
  const undoNote = writes.find(w => w.tool === "note_volunteer");
  const un2 = undoNote ? await api("POST", `/agent/writes/${undoNote.id}/undo`, tok, {}) : { status: 0 };
  const [{ n: notesLeft }] = await q(`SELECT COUNT(*)::int AS n FROM volunteer_notes WHERE org_id=$1 AND person_id=$2`, [ORG, LOVELACE.id]);
  ok("§6 undoing the note removes it", un2.status === 200 && notesLeft === 0, un2.body);

  // TWO ADAS: ask which, before planning, and write nothing.
  console.log("\n— §6 · two Adas: Steward asks which, before any plan —");
  await mk("d_fx3b_ada2", "Ada King");
  const c0 = await counts();
  const which = await api("POST", "/agent/instructions", tok, { text: ADA });
  const w = which.body && which.body.which;
  ok("§6 two Adas → a question, not a plan", which.status === 200 && !!w && !which.body.plan, which.body);
  ok("§6 …naming both, and only them", w && same((w.people || []).map(p => p.id).sort(), ["d_fx3b_ada", "d_fx3b_ada2"]), w);
  ok("§6 …in one sentence that says which name", w && /Ada/.test(w.sentence || "") && /which/i.test(w.sentence || ""), w && w.sentence);
  ok("§6 …and nothing was written (no instruction, no task \"Confirm which\")", same(await counts(), c0));
  const picked = await api("POST", "/agent/instructions", tok, { text: ADA, personId: "d_fx3b_ada2" });
  ok("§6 her pick plans on Ada King alone", picked.status === 201 && same(picked.body.plan.readIds, ["d_fx3b_ada2"])
    && /Ada King/.test(picked.body.plan.summary), picked.body && picked.body.plan);
  // Two ambiguous names, one pick each: "Ada and Adam" with two Adas and
  // several Adams asks about each in turn, and plans once both are picked.
  const TWO = "ada and adam just became volunteers";
  const q1 = await api("POST", "/agent/instructions", tok, { text: TWO });
  const q1ids = ((q1.body.which || {}).people || []).map(p => p.id);
  const q2 = await api("POST", "/agent/instructions", tok, { text: TWO, personId: [q1ids[0]] });
  const q2w = q2.body.which || {};
  ok("§6 two names, each ambiguous: asked one at a time, the second after the first pick",
    q1.status === 200 && q1ids.length >= 2 && q2.status === 200 && !!q2.body.which && q2w.said !== (q1.body.which || {}).said, { q1: q1.body, q2: q2.body });
  const q3 = await api("POST", "/agent/instructions", tok, { text: TWO, personId: [q1ids[0], ((q2w.people || [])[0] || {}).id] });
  ok("§6 …and with both picks it no longer asks (two people named: it says one at a time)",
    q3.status === 400 && q3.body.error === "volunteer_needs_person" && /one new volunteer at a time/.test(q3.body.sentence || ""), q3.body);
  const c1 = await counts();
  const bad = await api("POST", "/agent/instructions", tok, { text: ADA, personId: "d_fx3b_000" });
  ok("§6 a pick that is not one of the Adas is refused", bad.status === 400, bad.body);
  const foreign = await api("POST", "/agent/instructions", tok, { text: ADA, personId: "d_fx3b_ada_x" });
  ok("§6 another organisation's Ada is refused, and nothing is written", foreign.status === 400 && same(await counts(), c1), foreign.body);
  const theirs = await api("POST", "/agent/instructions", theirTok, { text: ADA });
  ok("§6 the other organisation's instruction reads its own Ada", theirs.status === 201 && same(theirs.body.plan.readIds, ["d_fx3b_ada_x"]), theirs.body && theirs.body.plan);
  await q(`DELETE FROM donors WHERE id='d_fx3b_ada2' AND org_id=$1`, [ORG]);

  // A read names one person the same way.
  const find = await api("POST", "/agent/instructions", tok, { text: "show me ada" });
  ok("§5 \"show me ada\" finds Ada's one record", find.status === 200 && find.body.read && find.body.read.kind === "person"
    && find.body.read.donorId === LOVELACE.id, find.body);
  const nobody = await api("POST", "/agent/instructions", tok, { text: "zelda just became a volunteer and wants to do 3 hours a week" });
  ok("§6 volunteer news about somebody not on file says so, and writes nothing",
    nobody.status === 400 && /could not find|not on file|who/i.test(nobody.body.sentence || ""), nobody.body);

  // ── §4 · THE GO BUTTON (browser) ─────────────────────────────────────────
  console.log("\n— §4 · the go button —");
  if (!haveBrowser()) {
    console.log("  SKIP — no Playwright or client/dist (browser leg)");
  } else {
    const { chromium } = require(path.join(PW_DIR, "node_modules", "playwright"));
    const browser = await chromium.launch();
    const errors = [];
    const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name) }); } };
    async function open(width, height) {
      const page = await browser.newPage({ viewport: { width, height }, serviceWorkers: "block" });
      page.on("pageerror", e => { if (!/Unexpected token '<'/.test(e.message)) errors.push(e.message.slice(0, 160)); });
      const lr = await page.request.post(BASE + "/auth/login", { data: { email: ADMIN, password: PASS } });
      const lj = await lr.json();
      await page.goto(APP, { waitUntil: "domcontentloaded" });
      await page.evaluate(d => {
        localStorage.setItem("npe_token", d.token);
        localStorage.setItem("npe_user", JSON.stringify(d.user));
        localStorage.setItem("npe_org", JSON.stringify(d.org));
      }, lj);
      await page.goto(APP, { waitUntil: "networkidle" });
      await page.waitForTimeout(1200);
      if (width > 760) await page.locator('.app-sidebar button:has-text("Agent")').first().click();
      else {
        await page.locator('.mobile-bottom-tab:has-text("More")').first().click();
        await page.waitForTimeout(400);
        await page.locator('.mobile-more-row:has-text("Agent")').first().click();
      }
      await page.waitForSelector('[data-testid="agent-room"]', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(900);
      return page;
    }
    const visibleButton = async (page, sel) => page.evaluate(s => {
      const b = document.querySelector(s);
      if (!b) return { there: false };
      const r = b.getBoundingClientRect(), cs = getComputedStyle(b);
      return { there: true, w: r.width, h: r.height, top: r.top, left: r.left, right: r.right, disabled: b.disabled,
        shown: r.width >= 40 && r.height >= 30 && cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.3,
        text: b.innerText, bg: cs.backgroundColor, inView: r.bottom <= window.innerHeight && r.right <= window.innerWidth };
    }, sel);
    const box = async (page, sel) => page.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; }, sel);
    const noSideways = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    try {
      await q(`DELETE FROM agent_writes WHERE org_id=$1`, [ORG]); await q(`DELETE FROM agent_drafts WHERE org_id=$1`, [ORG]);
      await q(`DELETE FROM agent_runs WHERE org_id=$1`, [ORG]); await q(`DELETE FROM agent_instructions WHERE org_id=$1`, [ORG]);
      await q(`UPDATE donors SET person_types='["donor"]'::jsonb WHERE org_id=$1`, [ORG]);
      for (const [W, H] of [[1440, 900], [390, 844]]) {
        const page = await open(W, H);
        // PLANS: the one-line bar has its go button beside it.
        const bar = await visibleButton(page, '[data-testid="agent-ask-bar-go"]');
        ok(`§4 (${W}) Plans: the go button is there and visible while the bar is empty`, bar.there && bar.shown, bar);
        ok(`§4 (${W}) …disabled until there is text`, bar.disabled === true, bar);
        const barBox = await box(page, '[data-testid="agent-ask-bar"]');
        ok(`§4 (${W}) …beside the bar (same row at 1440; directly under it at 390)`, !!barBox && (W > 760
          ? Math.abs(bar.top - barBox.top) < 30 && bar.left >= barBox.right - 2
          : bar.top >= barBox.bottom - 2 && bar.top - barBox.bottom < 24), { bar, barBox });
        await page.fill('[data-testid="agent-ask-bar"]', "show me ada");
        await page.waitForTimeout(400); // buttons carry a 0.15s transition (shared.jsx)
        const bar2 = await visibleButton(page, '[data-testid="agent-ask-bar-go"]');
        ok(`§4 (${W}) Plans: with text it is enabled and filled with the action colour`, bar2.disabled === false && bar2.bg === "rgb(13, 92, 58)", bar2);
        await page.fill('[data-testid="agent-ask-bar"]', "");
        await page.locator('[data-testid="agent-ask-bar"]').blur();
        await page.waitForTimeout(400);
        await shot(page, `plans-empty-${W}.png`);

        // ASK: the box, and its go button beside it.
        await page.locator('[data-testid="agent-tab-ask"]').click();
        await page.waitForTimeout(400);
        const go = await visibleButton(page, '[data-testid="agent-ask-submit"]');
        ok(`§4 (${W}) Ask: the go button is visible while the box is empty`, go.there && go.shown && go.inView, go);
        ok(`§4 (${W}) …disabled until there is text`, go.disabled === true, go);
        const inBox = await box(page, '[data-testid="agent-ask-input"]');
        ok(`§4 (${W}) …beside the box (its right edge at 1440; directly under it at 390)`, !!inBox && (W > 760
          ? go.left >= inBox.right - 2 && go.top < inBox.bottom
          : go.top >= inBox.bottom - 2 && go.top - inBox.bottom < 24), { go, inBox });
        await shot(page, `ask-empty-${W}.png`);
        await page.fill('[data-testid="agent-ask-input"]', "ada just became a volunteer");
        await page.waitForTimeout(400);
        const go2 = await visibleButton(page, '[data-testid="agent-ask-submit"]');
        ok(`§4 (${W}) …enabled with text, filled with the action colour`, go2.disabled === false && go2.bg === "rgb(13, 92, 58)", go2);
        // Shift+Enter is a new line; it does not submit.
        await page.locator('[data-testid="agent-ask-input"]').press("Shift+Enter");
        await page.waitForTimeout(500);
        const v = await page.locator('[data-testid="agent-ask-input"]').inputValue();
        ok(`§4 (${W}) Shift+Enter adds a line and does not submit`, /\n$/.test(v) && await page.locator('[data-testid="agent-sheet"]').count() === 0, v);
        await page.fill('[data-testid="agent-ask-input"]', ADA);
        await shot(page, `ask-text-${W}.png`);
        // Enter submits.
        await page.locator('[data-testid="agent-ask-input"]').press("Enter");
        await page.waitForSelector('[data-testid="agent-sheet"]', { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(500);
        const sheet = await page.locator('[data-testid="agent-sheet"]').innerText().catch(() => "");
        ok(`§4 (${W}) Enter submits: the Ada plan is on the sheet`, sheet.includes(ADA_HEADLINE), sheet.slice(0, 300));
        ok(`§4 (${W}) …it read one record`, /read one record/i.test(sheet) && /Ada Lovelace's record/.test(sheet), sheet.slice(0, 300));
        ok(`§4 (${W}) …and lists the read and the three steps`, await page.locator('[data-testid="agent-step"]').count() === 4);
        ok(`§4 (${W}) no sideways scroll`, await noSideways(page));
        if (SHOTS) {
          const s = page.locator('[data-testid="agent-sheet"]');
          await s.scrollIntoViewIfNeeded().catch(() => {});
          await page.waitForTimeout(200);
        }
        await shot(page, `ada-plan-${W}.png`);
        // Run it, and the list counts the read it lists (4 of 4, not 3 of 3).
        if (W > 760) {
          await page.locator('[data-testid="agent-sheet-confirm"]').click({ timeout: 8000 }).catch(() => {});
          await page.waitForTimeout(1500);
          await page.locator('[data-testid="agent-tab-plans"]').click();
          await page.waitForTimeout(600);
          const item = await page.locator('[data-testid="agent-plan-item"]').first().innerText().catch(() => "");
          ok("§4 after the run the list counts every row the sheet shows (Done · 4 of 4 steps)", /Done · 4 of 4 steps/.test(item), item);
          await shot(page, `ada-done-${W}.png`);
        }
        // TWO ADAS, ON SCREEN: the question comes before any plan, and her pick plans.
        await mk("d_fx3b_ada2", "Ada King");
        await page.locator('[data-testid="agent-tab-plans"]').click();
        await page.waitForTimeout(400);
        await page.fill('[data-testid="agent-ask-bar"]', ADA);
        await page.locator('[data-testid="agent-ask-bar"]').press("Enter");
        await page.waitForSelector('[data-testid="agent-which"]', { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(400);
        const picks = await page.locator('[data-testid="agent-which-person"]').allInnerTexts().catch(() => []);
        ok(`§6 (${W}) two Adas on screen: "Which Ada?" with both to pick from`, picks.length === 2
          && picks.some(t => /Ada Lovelace/.test(t)) && picks.some(t => /Ada King/.test(t)), picks);
        ok(`§6 (${W}) …and no plan on the sheet yet`, await page.locator('[data-testid="agent-which"] ~ [data-testid="agent-sheet"], [data-testid="agent-view-plans"] [data-testid="agent-sheet"]').count() === 0);
        ok(`§6 (${W}) no sideways scroll`, await noSideways(page));
        await shot(page, `which-ada-${W}.png`);
        await page.locator('[data-testid="agent-which-person"]:has-text("Ada King")').click();
        await page.waitForSelector('[data-testid="agent-sheet"]', { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(400);
        const kingSheet = await page.locator('[data-testid="agent-sheet"]').innerText().catch(() => "");
        ok(`§6 (${W}) her pick plans for Ada King alone`, /Make Ada King a volunteer/.test(kingSheet) && /read one record/i.test(kingSheet), kingSheet.slice(0, 200));
        await q(`DELETE FROM agent_instructions WHERE org_id=$1 AND status='planned'`, [ORG]);
        await q(`DELETE FROM donors WHERE id='d_fx3b_ada2' AND org_id=$1`, [ORG]);
        await page.close();
        await q(`DELETE FROM agent_writes WHERE org_id=$1`, [ORG]); await q(`DELETE FROM agent_drafts WHERE org_id=$1`, [ORG]);
        await q(`DELETE FROM volunteer_notes WHERE org_id=$1`, [ORG]);
        await q(`DELETE FROM agent_runs WHERE org_id=$1`, [ORG]); await q(`DELETE FROM agent_instructions WHERE org_id=$1`, [ORG]);
        await q(`UPDATE donors SET person_types='["donor"]'::jsonb WHERE org_id=$1`, [ORG]);
      }
      ok("§4 no page errors", errors.length === 0, errors.slice(0, 3));
    } finally { await browser.close(); }
  }
})()
  .catch(e => ok("the suite ran to the end", false, String(e && e.stack || e).slice(0, 400)))
  .finally(async () => { await reset().catch(() => {}); await closeDb().catch(() => {}); summary(); });
