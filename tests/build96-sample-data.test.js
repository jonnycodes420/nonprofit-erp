// BUILD-96 Part 2 — CLEARING SAMPLE DATA OFF A REAL ORGANISATION'S ORG.
//
// `org_justinsplace` was provisioned on production with invented people under
// a real organisation's name, so that the fundraiser who signs in to it sees a
// working product rather than an empty one. Her real Salesforce export is
// about to be loaded into that same org. Every invented row has to go, and
// nothing else — not her users, not her five real programmes, not her
// vocabulary, not the Welcome sequence, not a setting.
//
// The dangerous version of this feature is the one that works. A route that
// clears sample data correctly on a demo org is a route that will one day be
// pointed at a customer's org by someone who typed the wrong id, and the
// realistic accident is not a wrong click on the right org — it is the right
// click on the wrong one. So the guard asserted here is not about tidiness:
//
//     THE CLEAR REFUSES TO RUN ON ANY ORG HOLDING A GIFT THE PROVISIONING
//     PATH DID NOT WRITE.
//
// One hand-entered gift means somebody has started using this org, and
// clearing it is never what was meant.
//
// §1  a fresh org is provisioned and every row it wrote is tagged
// §2  one hand-entered gift → the clear is REFUSED, and the refusal is audited
// §3  the gift removed → the clear runs, and the sample rows go to zero
// §4  what survives: users, real funds, vocabulary, the sequence, settings
// §5  another org in the same database is untouched
// §6  the Home line appears while sample rows are present and not after
//
// Standard scratch stack (tests/README.md).

const bcrypt = require("bcryptjs");
const { BASE, ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "org_b96", OTHER = "org_b96other";
const ADMIN = "b96admin@example.org";       // the org's own admin (Allie's stand-in)
const SUPER = "b96super@example.org";       // the operator who runs the clear
const OTHER_ADMIN = "b96other@example.org";

// Her real programmes, entered before the sample data is cleared. Untagged, so
// nothing in the sample machinery may touch them.
const REAL_FUNDS = [
  ["fund_b96_equine", "Equine Therapy"],
  ["fund_b96_resid",  "Residential Programme"],
  ["fund_b96_schol",  "Scholarship Fund"],
];

async function reset() {
  for (const o of [ORG, OTHER]) {
    await q(`DELETE FROM sample_data_audit WHERE org_id=$1`, [o]).catch(() => {});
    for (const t of ["sequence_enrollments","sequence_sends","sequences",
                     "threads","interactions","tasks","event_attendees","events","campaigns",
                     "grants","board_members","volunteers","fin_transactions","receipts",
                     "gifts","households","donors","fin_funds","users","accounts"]) {
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    }
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}

const mkUser = async (id, org, email, role, isSuper = false) => {
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, org, email, hash, email.split("@")[0], role, isSuper]);
};

const count = async (table, org, where = "") =>
  parseInt((await q(`SELECT COUNT(*)::int AS c FROM ${table} WHERE org_id=$1 ${where}`, [org]))[0].c, 10);

(async () => {
  await reset();

  for (const [id, name, slug] of [[ORG, "Justin's Place (fixture)", "b96"],
                                  [OTHER, "Another Organisation", "b96other"]]) {
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
             VALUES ($1,$2,$3,1,'active','team')`, [id, name, slug]);
  }
  await mkUser("u_b96_admin", ORG, ADMIN, "admin");
  await mkUser("u_b96_super", ORG, SUPER, "admin", true);
  await mkUser("u_b96_other", OTHER, OTHER_ADMIN, "admin");

  const adminTok = await login(ADMIN);
  const superTok = await login(SUPER);
  const otherTok = await login(OTHER_ADMIN);

  // ── §1 · provision, and check the provisioning path tagged what it wrote ──
  console.log("\n— §1 · a fresh org is provisioned, and every row it wrote carries the tag —");

  const loaded = await api("POST", "/org/load-sample-data", adminTok, {});
  ok("sample data loads", loaded.status === 200, loaded.body);

  const sampleDonors = await count("donors", ORG, "AND is_sample=true");
  // THE ROUTE REPORTS WHAT IT WROTE, not a constant. `donorCount` used to be
  // `donors.length` — 25 whether or not a single row landed — which is how the
  // global-id collision below stayed invisible.
  ok("...and the route reports the rows it ACTUALLY wrote",
     loaded.body.donorCount === sampleDonors && sampleDonors > 0,
     { reported: loaded.body.donorCount, actual: sampleDonors });

  // A SAMPLE ID BELONGS TO ONE ORG. donors.id is a bare global PRIMARY KEY and
  // every sample insert is ON CONFLICT (id) DO NOTHING, so while the ids were
  // fixed constants the SECOND org on an installation to load sample data got
  // nothing and was told it worked. The ids are namespaced per org now, and
  // §5 is what proves it by loading a second org.
  const ids = (await q(`SELECT id FROM donors WHERE org_id=$1 AND is_sample=true ORDER BY id`, [ORG]))
    .map(r => r.id);
  ok("no sample id is a bare global constant any more",
     ids.length > 0 && ids.every(id => /__[0-9a-f]{8}$/.test(id)), ids.slice(0, 3));
  const D1 = ids.find(id => id.startsWith("smpl_d1__"));
  const D2 = ids.find(id => id.startsWith("smpl_d2__"));
  ok("...and the people are still findable by their own key", !!D1 && !!D2, { D1, D2 });
  const sampleGifts  = await count("gifts", ORG, "AND is_sample=true");
  ok("it wrote sample people", sampleDonors > 0, sampleDonors);
  ok("it wrote sample gifts", sampleGifts > 0, sampleGifts);
  ok("...and NOT ONE untagged person",
     (await count("donors", ORG, "AND is_sample IS NOT TRUE")) === 0);
  ok("...and NOT ONE untagged gift",
     (await count("gifts", ORG, "AND is_sample IS NOT TRUE")) === 0);

  // The three tables BUILD-96 added the column to. The loader does not write
  // them — a Thread, a household and an enrolment appear because of the people
  // it wrote — so they are created here the way the product creates them, and
  // the sweep is what has to find them.
  await q(`INSERT INTO threads (id,org_id,donor_id,next_step_type,next_step_label,due_date,opened_on)
           VALUES ('th_b96',$1,$2,'thank','Thank Margaret',CURRENT_DATE,CURRENT_DATE)`, [ORG, D1]);
  await q(`INSERT INTO households (id,org_id,name,primary_donor_id,joint_acknowledgment)
           VALUES ('hh_b96',$1,'The Whitfield Household',$2,true)`, [ORG, D1]);
  await q(`UPDATE donors SET household_id='hh_b96' WHERE id = ANY($1)`, [[D1, D2]]);
  await q(`INSERT INTO sequences (id,org_id,name,trigger,status)
           VALUES ('seq_b96','${ORG}','Welcome','first_gift','off')`);
  // The placeholder steps BUILD-94 provisions with it — the words she has not
  // written yet. They are the part of "the sequence survives" that matters:
  // a definition with its steps gone is not a sequence she can turn on.
  for (const [n, subj] of [[1, "Thank you for your first gift"], [2, "What your gift does"]]) {
    await q(`INSERT INTO sequence_steps (id,sequence_id,step_order,delay_days,subject,body)
             VALUES ($1,'seq_b96',$2,$3,$4,$5)`,
            [`ss_b96_${n}`, n, (n - 1) * 3, subj, "[placeholder — Allie writes this]"]);
  }
  await q(`INSERT INTO sequence_enrollments (id,sequence_id,org_id,donor_id,current_step,status)
           VALUES ('se_b96','seq_b96',$1,$2,0,'active')`, [ORG, D1]);

  ok("a Thread, a household and an enrolment now exist, untagged",
     (await count("threads", ORG, "AND is_sample IS NOT TRUE")) === 1 &&
     (await count("households", ORG, "AND is_sample IS NOT TRUE")) === 1);

  // Re-running the provisioning path's sweep is how they get tagged. (The
  // route runs it at the end of every load; calling the module directly is the
  // same code on the same connection.)
  // The module speaks the server's `?` placeholders; helpers' `q` speaks
  // Postgres. One shim, so the suite exercises the SAME function the routes
  // call rather than a re-implementation of it.
  const sampleDataMod = require("../sampleData");
  const toPg = sql => { let n = 0; return sql.replace(/\?/g, () => "$" + (++n)); };
  const queryFn = (sql, params) => q(toPg(sql), params);
  const run = async (sql, params) => ({ changes: (await q(toPg(sql), params)).length });
  const tagged = await sampleDataMod.tagSampleRows({ query: queryFn, run }, ORG);
  ok("the sweep tags the Thread", (await count("threads", ORG, "AND is_sample=true")) === 1, tagged);
  ok("the sweep tags the household", (await count("households", ORG, "AND is_sample=true")) === 1, tagged);
  ok("the sweep tags the enrolment", (await count("sequence_enrollments", ORG, "AND is_sample=true")) === 1, tagged);

  // The whole point of the sweep being donor-derived rather than a heuristic:
  // it cannot reach a row whose person is real.
  await q(`INSERT INTO donors (id,org_id,name,email,stage,is_sample)
           VALUES ('d_b96_real','${ORG}','Real Person','real@example.org','prospect',false)`);
  await q(`INSERT INTO threads (id,org_id,donor_id,next_step_type,next_step_label,due_date,opened_on)
           VALUES ('th_b96_real','${ORG}','d_b96_real','call','Call her',CURRENT_DATE,CURRENT_DATE)`);
  await sampleDataMod.tagSampleRows({ query: queryFn, run }, ORG);
  ok("a REAL person's Thread is not tagged by the sweep",
     (await q(`SELECT is_sample FROM threads WHERE id='th_b96_real'`))[0].is_sample !== true);

  // ── §2 · one hand-entered gift, and the clear refuses ────────────────────
  console.log("\n— §2 · one gift the provisioning path did not write, and the clear REFUSES —");

  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,is_sample)
           VALUES ('g_b96_real','${ORG}','d_b96_real',500,CURRENT_DATE,'cash',false)`);

  const preview = await api("GET", `/admin/orgs/${ORG}/sample-data`, superTok);
  ok("the preview says it is not clearable", preview.status === 200 && preview.body.clearable === false, preview.body);
  ok("...and names what is blocking it",
     /1 gift this org entered itself/.test(preview.body.blockedBy || ""), preview.body.blockedBy);

  const refused = await api("POST", `/admin/orgs/${ORG}/clear-sample-data`, superTok, { confirm: true });
  ok("THE CLEAR IS REFUSED", refused.status === 409, refused.status);
  ok("...saying this org has real data in it",
     /real data in it/.test(refused.body.error || ""), refused.body.error);
  ok("...and not one sample person was deleted",
     (await count("donors", ORG, "AND is_sample=true")) === sampleDonors);

  const refusalAudit = await q(
    `SELECT action, actor_email, counts FROM sample_data_audit WHERE org_id=$1 ORDER BY created_at DESC`, [ORG]);
  ok("the REFUSAL is audited — a near-miss on real data is the thing worth finding later",
     refusalAudit.length === 1 && refusalAudit[0].action === "refused", refusalAudit);
  ok("...with the actor who tried it", refusalAudit[0].actor_email === SUPER, refusalAudit[0]);

  // An org admin cannot reach the super-admin route at all.
  const notSuper = await api("POST", `/admin/orgs/${ORG}/clear-sample-data`, adminTok, { confirm: true });
  ok("an ordinary org admin cannot run the super-admin clear", notSuper.status === 403, notSuper.status);

  // ── §3 · remove the gift, and the clear runs ─────────────────────────────
  console.log("\n— §3 · the gift removed, the clear runs, sample rows go to zero —");

  await q(`DELETE FROM gifts WHERE id='g_b96_real'`);
  await q(`DELETE FROM threads WHERE id='th_b96_real'`);
  await q(`DELETE FROM donors WHERE id='d_b96_real'`);

  // Her real funds and her vocabulary, entered before the clear.
  for (const [id, name] of REAL_FUNDS) {
    await q(`INSERT INTO fin_funds (id,org_id,name,restricted,is_sample) VALUES ($1,$2,$3,false,false)`,
            [id, ORG, name]);
  }
  await q(`UPDATE orgs SET vocabulary_json=$1, vocabulary_set_at=NOW() WHERE id=$2`,
          [JSON.stringify({ donor: "supporter", gift: "contribution" }), ORG]);

  const noConfirm = await api("POST", `/admin/orgs/${ORG}/clear-sample-data`, superTok, {});
  ok("a clear without confirm:true is refused", noConfirm.status === 400, noConfirm.status);

  const cleared = await api("POST", `/admin/orgs/${ORG}/clear-sample-data`, superTok, { confirm: true });
  ok("THE CLEAR RUNS", cleared.status === 200, cleared.body);
  ok("...and reports nothing left", cleared.body.after &&
     cleared.body.after.people === 0 && cleared.body.after.gifts === 0, cleared.body.after);

  for (const t of ["donors", "gifts", "threads", "households", "interactions", "tasks",
                   "grants", "events", "campaigns", "board_members", "volunteers", "fin_transactions"]) {
    ok(`no sample rows left in ${t}`, (await count(t, ORG, "AND is_sample=true")) === 0);
  }
  ok("no orphan household survived the people it named",
     (await count("households", ORG)) === 0);

  // BUILD-98 added gift_soft_credits and tribute_notices, both keyed by
  // donor_id AND gift_id, and neither is in sampleData.js's lists. The clear is
  // still correct — both FKs are ON DELETE CASCADE, so removing a sample donor
  // or gift takes its credits and notices with it — but that means THIS
  // GUARANTEE NOW RESTS ON A FOREIGN KEY DEFINED IN SOMEBODY ELSE'S MIGRATION.
  //
  // Change either FK to NO ACTION or RESTRICT and this clear starts returning
  // 500 "Some sample rows could not be removed" on any org whose sample data
  // includes a soft credit. So the cascade is pinned here rather than trusted:
  // if a future build alters it, this line says so instead of a customer's
  // handover failing.
  for (const t of ["gift_soft_credits", "tribute_notices"]) {
    const fks = await q(
      `SELECT a.attname AS col, c.confdeltype
         FROM pg_constraint c
         JOIN unnest(c.conkey) k ON true
         JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k
        WHERE c.contype='f' AND c.conrelid::regclass::text=$1
          AND a.attname IN ('donor_id','gift_id')`, [t]);
    if (!fks.length) continue;   // table not in this schema version
    ok(`${t}'s donor_id/gift_id CASCADE on delete — the clear relies on it`,
       fks.length === 2 && fks.every(f => f.confdeltype === "c"),
       fks.map(f => `${f.col}=${f.confdeltype}`));
  }
  ok("...and no soft credit or tribute notice outlived the sample people",
     (await q(`SELECT COALESCE((SELECT COUNT(*)::int FROM gift_soft_credits WHERE org_id=$1),0) AS c`, [ORG])
       .then(r => r[0].c).catch(() => 0)) === 0);

  const clearAudit = await q(
    `SELECT action, actor_email, counts, detail FROM sample_data_audit
      WHERE org_id=$1 AND action='cleared'`, [ORG]);
  ok("the clear is audited with an actor", clearAudit.length === 1 && clearAudit[0].actor_email === SUPER, clearAudit);
  ok("...and with the counts it removed",
     clearAudit[0].counts && clearAudit[0].counts.people === sampleDonors, clearAudit[0].counts);

  // ── §4 · what survives ───────────────────────────────────────────────────
  console.log("\n— §4 · her org, her users, her funds, her words, her sequence —");

  ok("the org is still there", (await q(`SELECT id FROM orgs WHERE id=$1`, [ORG])).length === 1);
  ok("her users are still there", (await count("users", ORG)) === 2);
  ok("she can still sign in", !!(await login(ADMIN)));

  const funds = await q(`SELECT id,name FROM fin_funds WHERE org_id=$1 ORDER BY id`, [ORG]);
  ok("her three REAL programmes survive", funds.length === REAL_FUNDS.length, funds.map(f => f.name));
  ok("...by name", funds.map(f => f.name).sort().join("|") === REAL_FUNDS.map(f => f[1]).sort().join("|"), funds);
  ok("and the three SAMPLE funds are gone",
     (await q(`SELECT id FROM fin_funds WHERE org_id=$1 AND id LIKE 'fund_smpl_%'`, [ORG])).length === 0);

  const orgRow = (await q(`SELECT vocabulary_json, vocabulary_set_at FROM orgs WHERE id=$1`, [ORG]))[0];
  const vocab = typeof orgRow.vocabulary_json === "string" ? JSON.parse(orgRow.vocabulary_json) : orgRow.vocabulary_json;
  ok("her vocabulary survives", vocab && vocab.donor === "supporter", vocab);
  ok("...and the fact that she SET it survives too — a cleared org is not a new one",
     !!orgRow.vocabulary_set_at, orgRow.vocabulary_set_at);

  const seqs = await q(`SELECT id,status FROM sequences WHERE org_id=$1`, [ORG]);
  ok("the Welcome sequence DEFINITION survives, still off",
     seqs.length === 1 && seqs[0].status === "off", seqs);
  const steps = await q(`SELECT id,subject,body FROM sequence_steps WHERE sequence_id='seq_b96' ORDER BY step_order`);
  ok("...with its placeholder steps intact — the words she has not written yet",
     steps.length === 2 && /placeholder/.test(steps[0].body), steps);
  ok("and the ENROLMENT of an invented person in it is gone",
     (await count("sequence_enrollments", ORG)) === 0);

  // ── §5 · another org in the same database ────────────────────────────────
  console.log("\n— §5 · the org next door is untouched —");

  const otherLoad = await api("POST", "/org/load-sample-data", otherTok, {});
  const otherBefore = await count("donors", OTHER, "AND is_sample=true");
  // THE REGRESSION THIS PINS. With fixed global ids the second org to load
  // sample data wrote nothing at all and was told it had worked.
  ok("A SECOND ORG CAN LOAD SAMPLE DATA TOO", otherBefore > 0, otherBefore);
  ok("...and is told the truth about how many rows it got",
     otherLoad.body.donorCount === otherBefore, { reported: otherLoad.body.donorCount, actual: otherBefore });
  ok("...with ids that do not collide with the first org's",
     (await q(`SELECT COUNT(*)::int AS c FROM donors d1
                 WHERE d1.org_id=$1 AND EXISTS (SELECT 1 FROM donors d2 WHERE d2.org_id=$2 AND d2.id=d1.id)`,
              [ORG, OTHER]))[0].c === 0);

  await api("POST", `/admin/orgs/${ORG}/clear-sample-data`, superTok, { confirm: true });
  ok("clearing THIS org did not touch the other one",
     (await count("donors", OTHER, "AND is_sample=true")) === otherBefore);
  ok("...nor its gifts", (await count("gifts", OTHER, "AND is_sample=true")) > 0);

  const wrongOrg = await api("GET", `/admin/orgs/org_b96_does_not_exist/sample-data`, superTok);
  ok("an org that does not exist is a 404, not a silent success", wrongOrg.status === 404, wrongOrg.status);

  // ── §6 · the line on Home ────────────────────────────────────────────────
  console.log("\n— §6 · the sentence Home shows while sample rows are present —");

  const otherStatus = await api("GET", "/org/sample-data-status", otherTok);
  ok("an org WITH sample rows is told so", otherStatus.body.hasSampleData === true, otherStatus.body);
  ok("...and the count it reports is the count the clear would act on",
     otherStatus.body.counts.people === otherBefore, otherStatus.body.counts);

  const clearedStatus = await api("GET", "/org/sample-data-status", adminTok);
  ok("the CLEARED org is not told so", clearedStatus.body.hasSampleData === false, clearedStatus.body);

  // The line itself is in Dashboard.jsx and is gated on exactly this flag, so
  // the flag going false is what removes it. Pinned here so a future session
  // cannot quietly change the sentence.
  const fs = require("fs");
  const dash = fs.readFileSync(require("path").join(__dirname, "..", "client/src/components/Dashboard.jsx"), "utf8");
  ok("Home carries the sentence, verbatim",
     dash.includes("You're looking at sample data. Your own donors arrive when Jonathan loads your file."), true);
  ok("...gated on the sample-data flag, so it disappears with the rows",
     /surface==="home"&&sampleStatus\?\.hasSampleData/.test(dash), true);

  await reset();
  await closeDb();
  summary();
})();
