// SURVEY-1 — THE ONE TEST: an anonymous response stores no person id, email or
// IP address, and does not appear on any timeline.
//
// The submission is made as hard as possible to keep anonymous: it carries a
// VALID personal link for a real donor, and that donor's own name and email
// typed into the form. None of it may survive:
//   1. the stored response has no person, no name and no email, and nothing in
//      the whole row (or its answers) holds the name, the email, the link or an
//      internet address;
//   2. the audit row for the submission exists (the change is recorded) and has
//      no IP, and holds neither the name nor the email;
//   3. no timeline line was written for anybody;
//   4. the database itself refuses an anonymous row that names a person.
// And the control, so a pass is not a test that cannot see: the same donor
// answering a NAMED survey through the same kind of link IS on their timeline.
//
// How it fails, planted and watched: drop req.audit.withoutIp() (check 2 goes
// red), or let the anonymous path read the personal link (the CHECK refuses the
// row, the page errors, checks 1 and 3 go red).
const { ok, summary, BASE, q, closeDb } = require("./helpers");
// The suite signs links with the same secret the test server runs with.
process.env.JWT_SECRET = process.env.JWT_SECRET || "local-test-secret";
const SL = require("../surveyLinks");

const ORG = "org_svy1t", SLUG = "svy1t";
const DONOR = "d_svy1t", NAME = "Ottoline Brackenbury", EMAIL = "ottoline.brackenbury@example.org";
const sections = JSON.stringify([{ id: "s1", title: "", questions: [
  { id: "why", type: "one", label: "Why do you give?", required: true, options: ["Because", "Other"] },
  { id: "note", type: "long", label: "Anything else?", required: false },
] }]);

async function clear() {
  for (const t of ["fin_audit_log", "interactions", "survey_responses", "surveys", "donors"]) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
}
const post = (path, form) => fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(form).toString() });

(async () => {
  await clear();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,'Survey test org',$2,1,'active','team','America/New_York')`, [ORG, SLUG]);
  await q(`INSERT INTO donors (id,org_id,name,email,stage,created_by,created_by_name) VALUES ($1,$2,$3,$4,'active','system:test','test')`, [DONOR, ORG, NAME, EMAIL]);
  await q(`INSERT INTO surveys (id,org_id,slug,title,mode,audience,sections,created_by) VALUES
             ('sv_t_anon',$1,'anon','Anonymous one','anonymous','anyone',$2::jsonb,'system:test'),
             ('sv_t_named',$1,'named','Named one','named','anyone',$2::jsonb,'system:test')`, [ORG, sections]);

  // The page says it is anonymous before the first question.
  const page = await (await fetch(`${BASE}/survey/${SLUG}/anon?t=${encodeURIComponent(SL.personalToken("sv_t_anon", DONOR))}`)).text();
  ok("the anonymous page says so at the top", /data-privacy="anonymous"/.test(page) && /not saved with them/.test(page));
  ok("the anonymous page asks for no name or email", !/name="__email"/.test(page) && !/name="__name"/.test(page));

  const token = SL.personalToken("sv_t_anon", DONOR);
  const r = await post(`/survey/${SLUG}/anon`, { t: token, __name: NAME, __email: EMAIL, why: "Because", note: "Just because." });
  ok("the anonymous answer was accepted", r.status === 200, r.status);

  const rows = await q(`SELECT * FROM survey_responses WHERE org_id=$1 AND survey_id='sv_t_anon'`, [ORG]);
  ok("one response stored", rows.length === 1, rows.length);
  const row = rows[0] || {};
  ok("it is marked anonymous", row.anonymous === true);
  ok("it has no person id", row.donor_id === null, row.donor_id);
  ok("it has no name and no email", row.respondent_name === null && row.respondent_email === null, row);
  const whole = JSON.stringify(row).toLowerCase();
  ok("nothing in the row holds the name, the email or the link", !whole.includes(EMAIL) && !whole.includes("brackenbury") && !whole.includes(DONOR) && !whole.includes(token.toLowerCase()), whole.slice(0, 400));
  ok("nothing in the row looks like an internet address", !/(\b\d{1,3}(\.\d{1,3}){3}\b|::1|::ffff)/.test(whole), whole.slice(0, 400));
  const cols = (await q(`SELECT column_name FROM information_schema.columns WHERE table_name='survey_responses'`)).map(c => c.column_name);
  ok("the table has no column for an internet address", !cols.some(c => /ip|addr|agent/.test(c)), cols);

  // The audit row is written as the response finishes, so give it a moment.
  let audit = [];
  for (let i = 0; i < 30 && !audit.length; i++) {
    audit = await q(`SELECT * FROM fin_audit_log WHERE org_id=$1 AND request_path LIKE '/survey/%/anon%'`, [ORG]);
    if (!audit.length) await new Promise(r => setTimeout(r, 100));
  }
  ok("the change is recorded in the audit log", audit.length >= 1, audit.length);
  ok("the audit row has no internet address", audit.length && audit.every(a => a.ip === null), audit.map(a => a.ip));
  const auditText = JSON.stringify(audit).toLowerCase();
  ok("the audit row holds neither the name nor the email", !auditText.includes(EMAIL) && !auditText.includes("brackenbury"), auditText.slice(0, 400));

  const tl = await q(`SELECT id, donor_id, note FROM interactions WHERE org_id=$1`, [ORG]);
  ok("no timeline line was written for anybody", tl.length === 0, tl);

  let refused = false;
  try {
    await q(`INSERT INTO survey_responses (id,org_id,survey_id,anonymous,donor_id,answers,created_by) VALUES ('svr_t_bad',$1,'sv_t_anon',true,$2,'{}','system:test')`, [ORG, DONOR]);
  } catch (e) { refused = /survey_anonymous_is_anonymous/.test(e.message); }
  ok("the database refuses an anonymous row that names a person", refused);

  // The control: named, through a personal link, IS on the timeline.
  const rn = await post(`/survey/${SLUG}/named`, { t: SL.personalToken("sv_t_named", DONOR), why: "Other" });
  ok("the named answer was accepted", rn.status === 200, rn.status);
  const [named] = await q(`SELECT donor_id FROM survey_responses WHERE org_id=$1 AND survey_id='sv_t_named'`, [ORG]);
  ok("a named answer through a personal link names the person", named && named.donor_id === DONOR, named);
  const tl2 = await q(`SELECT donor_id FROM interactions WHERE org_id=$1 AND type='survey'`, [ORG]);
  ok("and lands on their timeline, once", tl2.length === 1 && tl2[0].donor_id === DONOR, tl2);

  await clear();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await clear(); await closeDb(); } catch {} process.exit(1); });
