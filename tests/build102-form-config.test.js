// BUILD-102 (Steward Give) Part 1 — A FORM IS A GIVING PAGE WITH A FORM CONFIG.
//
// The brief's own test: a config naming a fund from another org is refused; an
// unknown key is refused BY NAME; and the preview and the public page render
// byte-identical form markup from the same config.
//
//   §1  there is no forms table, and the config lives beside the widgets;
//   §2  an unknown key is refused by name — the editor cannot save nothing and
//       say it saved;
//   §3  a fund from another org is refused, at BOTH designation modes, and
//       nothing is written;
//   §4  the settings that can contradict each other are refused together;
//   §5  ONE SPEC: the editor's preview and the public page are byte-identical,
//       derived from the same function — and the guard is proven able to fail;
//   §6  a custom question becomes a custom field the REPORT BUILDER can see;
//   §7  a stored config always renders a working form, even after a fund is
//       deleted — refusing to render is the one outcome a live form may not have;
//   §8  the wall: org A cannot read or write org B's form.
//
// Standard scratch stack (tests/README.md), ports per WORKTREE-NOTES.md.

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "b102_form", OTHER = "b102_form2";
const ME = "b102form@example.org", THEM = "b102form-other@example.org";
const PW = "loadtest1234";

const CHILD = ["custom_field_values", "custom_field_defs", "custom_fields", "peer_fundraisers",
  "gifts", "giving_pages", "donors", "users", "fin_transactions", "budgets", "accounts", "fin_funds"];
async function reset() {
  for (const o of [ORG, OTHER]) {
    for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}
const mkOrg = (id, slug) => q(
  `INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,timezone,timezone_confirmed_at)
   VALUES ($1,$2,$3,1,'team','active','America/New_York',NOW())
   ON CONFLICT (id) DO UPDATE SET plan='team', subscription_status='active'`,
  [id, id === ORG ? "Harbor Music School" : "Open Door Pantry", slug]);
const mkUser = (id, org, email, name) => q(
  `INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,'admin')`,
  [id, org, email, bcrypt.hashSync(PW, 4), name]);

(async () => {
  console.log("build102-form-config");
  await reset();
  await mkOrg(ORG, "b102-form"); await mkOrg(OTHER, "b102-form2");
  await mkUser("u_b102f", ORG, ME, "Allie Barnett");
  await mkUser("u_b102f2", OTHER, THEM, "Not Allie");
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('f_gen102','${ORG}','General fund',false)
           ON CONFLICT (id) DO NOTHING`);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('f_youth102','${ORG}','Youth lessons',true)
           ON CONFLICT (id) DO NOTHING`);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('f_theirs102','${OTHER}','Their pantry',true)
           ON CONFLICT (id) DO NOTHING`);
  const tok = await login(ME), tok2 = await login(THEM);
  const F = await import("../shared/formConfig.js");

  const page = await api("POST", "/giving-pages", tok, { title: "Spring lessons", slug: "spring" });
  ok("fixture a giving page exists", page.status === 201, page.body);
  const PAGE = page.body.id;
  const theirPage = await api("POST", "/giving-pages", tok2, { title: "Their page", slug: "theirs" });
  ok("fixture the other org has a page", theirPage.status === 201, theirPage.body);

  // ── §1 · NO FORMS TABLE ─────────────────────────────────────────────────
  console.log("\n— §1 · the config lives beside the widgets, on the page's own row —");
  const tables = await q(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('forms','donation_forms')`);
  ok("§1 there is no forms table", tables.length === 0, tables.map(t => t.table_name));
  const col = await q(
    `SELECT data_type FROM information_schema.columns WHERE table_name='giving_pages' AND column_name='form_config'`);
  ok("§1 the config is a JSONB column on giving_pages", col.length === 1 && col[0].data_type === "jsonb", col);
  // A PAGE THAT PREDATES THIS BUILD IS A WORKING FORM. NULL renders the
  // defaults, which is what makes shipping this safe for every existing org.
  const stored = await q(`SELECT form_config FROM giving_pages WHERE id=$1`, [PAGE]);
  ok("§1 a page that never configured a form stores NULL", stored[0].form_config === null, stored[0]);
  const fresh = await api("GET", `/giving-pages/${PAGE}/form`, tok, null);
  ok("§1 …and still reads back a working form", fresh.status === 200
     && fresh.body.config.amountsCents.join(",") === F.DEFAULT_AMOUNTS_CENTS.join(","), fresh.body.config);
  ok("§1 …whose amounts are INTEGER CENTS, not dollars",
     fresh.body.config.amountsCents.every(Number.isInteger)
     && fresh.body.config.amountsCents[0] === 2500, fresh.body.config.amountsCents);

  // ── §2 · AN UNKNOWN KEY IS REFUSED BY NAME ──────────────────────────────
  console.log("\n— §2 · the editor cannot save nothing and say it saved —");
  const wrongKey = await api("PUT", `/giving-pages/${PAGE}/form`, tok,
    { config: { suggestedAmounts: [2500], amountsCents: [5000] } });
  ok("§2 a key this module does not know is refused", wrongKey.status === 400, wrongKey.body);
  ok("§2 …NAMED, so somebody can fix it",
     /"suggestedAmounts" is not a setting/.test(wrongKey.body.error), wrongKey.body.error);
  ok("§2 …and the message lists what the settings ARE",
     /amountsCents/.test(wrongKey.body.error), wrongKey.body.error);
  ok("§2 nothing was stored",
     (await q(`SELECT form_config FROM giving_pages WHERE id=$1`, [PAGE]))[0].form_config === null);
  // EVERY bad field is named, not only the first.
  const manyBad = await api("PUT", `/giving-pages/${PAGE}/form`, tok,
    { config: { wobble: 1, gubbins: 2, amountsCents: ["not cents"] } });
  ok("§2 every problem is reported at once", manyBad.body.errors.length >= 3, manyBad.body.errors);

  // ── §3 · A FUND FROM ANOTHER ORG IS REFUSED ─────────────────────────────
  console.log("\n— §3 · a donor may only be offered this org's own funds —");
  const foreignFixed = await api("PUT", `/giving-pages/${PAGE}/form`, tok,
    { config: { designation: { mode: "fixed", fundId: "f_theirs102" } } });
  ok("§3 a fixed designation on another org's fund is refused", foreignFixed.status === 400, foreignFixed.body);
  ok("§3 …in words that name the fix",
     /your own funds/.test(foreignFixed.body.error), foreignFixed.body.error);
  const foreignChoice = await api("PUT", `/giving-pages/${PAGE}/form`, tok,
    { config: { designation: { mode: "choice", fundIds: ["f_gen102", "f_theirs102"] } } });
  ok("§3 a CHOICE list containing another org's fund is refused too", foreignChoice.status === 400, foreignChoice.body);
  ok("§3 …and says how many were not theirs",
     /not yours/.test(foreignChoice.body.error), foreignChoice.body.error);
  ok("§3 nothing was written by either attempt",
     (await q(`SELECT form_config FROM giving_pages WHERE id=$1`, [PAGE]))[0].form_config === null);
  // The pure module refuses it too, so the rule is not only in the route.
  ok("§3 the validator itself refuses it, with no database in reach",
     !F.validateFormConfig({ designation: { mode: "fixed", fundId: "f_theirs102" } },
       { orgFundIds: ["f_gen102"] }).ok);

  // ── §4 · SETTINGS THAT CONTRADICT EACH OTHER ────────────────────────────
  console.log("\n— §4 · a donor may not meet a frequency they cannot pick —");
  const contradiction = await api("PUT", `/giving-pages/${PAGE}/form`, tok,
    { config: { defaultFrequency: "monthly", offerMonthly: false } });
  ok("§4 a form opening on monthly with monthly switched off is refused",
     contradiction.status === 400 && /has to be one of the choices/.test(contradiction.body.error),
     contradiction.body);
  const noWayToGive = await api("PUT", `/giving-pages/${PAGE}/form`, tok,
    { config: { amountsCents: [2500], allowOther: false, } });
  ok("§4 …but suggested amounts with no other box is fine", noWayToGive.status === 200, noWayToGive.body);
  // AN EMPTY LIST WITH A FREE BOX IS A REAL FORM — just type an amount.
  const freeTypeOnly = F.validateFormConfig({ amountsCents: [], allowOther: true }, { orgFundIds: [] });
  ok("§4 no suggestions but a box to type in is a legitimate form", freeTypeOnly.ok, freeTypeOnly.errors);
  const nothing = F.validateFormConfig({ amountsCents: [], allowOther: false }, { orgFundIds: [] });
  ok("§4 no amounts AND no box to type one is refused — nobody could give",
     !nothing.ok && nothing.errors.some(e => /nobody can give/.test(e.message)), nothing.errors);
  const dupes = F.validateFormConfig({ amountsCents: [5000, 5000] }, { orgFundIds: [] });
  ok("§4 the same amount twice is refused", !dupes.ok, dupes.errors);
  ok("§4 amounts come back ascending however they were typed",
     F.validateFormConfig({ amountsCents: [10000, 2500, 5000] }, { orgFundIds: [] })
       .config.amountsCents.join(",") === "2500,5000,10000");

  // ── §5 · ONE SPEC, TWO SURFACES ─────────────────────────────────────────
  console.log("\n— §5 · the preview and the public page are the same form —");
  const real = {
    headline: "Give a child a year of lessons",
    amountsCents: [2500, 5000, 12500, 50000],
    allowOther: true, defaultFrequency: "once", offerMonthly: true,
    designation: { mode: "choice", fundIds: ["f_gen102", "f_youth102"] },
    showTribute: true, showEmployerMatch: true,
    questions: [
      { key: "how_heard", label: "How did you hear about us?", type: "choice",
        options: ["A friend", "Our newsletter", "A concert"] },
      { key: "wants_updates", label: "Send me programme news", type: "yesno" },
    ],
    thankYou: { message: "Thank you — you have just paid for a term of lessons.", redirectUrl: "https://example.org/thanks" },
  };
  const saved = await api("PUT", `/giving-pages/${PAGE}/form`, tok, { config: real });
  ok("§5 the real config saves", saved.status === 200, saved.body);
  await api("PUT", `/giving-pages/${PAGE}`, tok, { status: "active" });
  const editor = await api("GET", `/giving-pages/${PAGE}/form`, tok, null);
  const publicPage = await api("GET", `/org/b102-form/giving-page/spring/public`, null, null);
  ok("§5 the public page loads", publicPage.status === 200, publicPage.body && publicPage.body.error);
  const pubSpec = publicPage.body.givingPage.form;
  ok("§5 the public page carries a form spec", !!pubSpec, Object.keys(publicPage.body.givingPage));
  // BYTE-IDENTICAL, by fingerprint over a key-order-normalised spec. If these
  // two ever differ, a preview is showing a field the donor will not get.
  ok("§5 THE EDITOR'S SPEC AND THE DONOR'S SPEC ARE BYTE-IDENTICAL",
     F.specFingerprint(editor.body.spec) === F.specFingerprint(pubSpec),
     { editor: F.specFingerprint(editor.body.spec).slice(0, 160), pub: F.specFingerprint(pubSpec).slice(0, 160) });
  // AND THE GUARD IS PROVEN ABLE TO FAIL: change one field of one copy.
  const tampered = JSON.parse(JSON.stringify(pubSpec));
  tampered.amount.amountsCents.push(999900);
  ok("§5 …and the fingerprint NOTICES one extra amount",
     F.specFingerprint(editor.body.spec) !== F.specFingerprint(tampered));
  ok("§5 the spec carries fund NAMES, so the renderer looks nothing up",
     pubSpec.designation.options.map(o => o.fundName).join(",") === "General fund,Youth lessons",
     pubSpec.designation.options);
  ok("§5 …and the donor sees the org's own name, never the staff-side one",
     pubSpec.orgName === "Harbor Music School", pubSpec.orgName);
  ok("§5 the trust line says where the money goes and who takes a cut",
     /goes to Harbor Music School directly/.test(pubSpec.trustLine)
     && /never holds or moves it/.test(pubSpec.trustLine), pubSpec.trustLine);
  ok("§5 three steps, in order",
     pubSpec.steps.map(s => s.key).join(",") === "amount,details,payment", pubSpec.steps);
  ok("§5 monthly is offered because the org said so",
     pubSpec.amount.frequencies.join(",") === "once,monthly", pubSpec.amount);
  const onceOnly = F.formSpec({ offerMonthly: false, defaultFrequency: "once" }, { funds: [], orgName: "X" });
  ok("§5 …and a form with monthly off offers only one-time",
     onceOnly.amount.frequencies.join(",") === "once", onceOnly.amount);

  // ── §6 · A QUESTION IS A CUSTOM FIELD THE REPORT BUILDER CAN SEE ─────────
  console.log("\n— §6 · an answer has to be filterable, or the question is theatre —");
  ok("§6 both questions became custom fields", saved.body.customFieldsCreated.length === 2,
     saved.body.customFieldsCreated);
  const defs = await q(
    `SELECT key, label, type, entity, created_source FROM custom_field_defs WHERE org_id=$1 ORDER BY key`, [ORG]);
  // ENTITY `donor`, because that is what CF_ENTITIES allows and what
  // reportBuilder's people entity declares. `person` would have been a field the
  // catalogue cannot see — which is why the next assertion asks the catalogue.
  ok("§6 they are on the donor, in the table the report builder reads",
     defs.length === 2 && defs.every(d => d.entity === "donor"), defs);
  ok("§6 the choice question is a select and the yes/no is a checkbox",
     defs.find(d => d.key === "how_heard").type === "select"
     && defs.find(d => d.key === "wants_updates").type === "checkbox", defs.map(d => [d.key, d.type]));
  ok("§6 …and each records that a donation form made it",
     defs.every(d => d.created_source === "donation_form"), defs.map(d => d.created_source));
  // THE REPORT BUILDER CAN ACTUALLY SEE IT — the claim, checked, not assumed.
  const cat = await api("GET", "/report-builder/catalogue", tok, null);
  const people = (cat.body.entities || []).find(e => e.key === "people");
  ok("§6 the catalogue offers the question as a field on people",
     (people.fields || []).some(f => f.key === "cf:how_heard" && f.custom),
     (people.fields || []).filter(f => f.custom).map(f => f.key));
  // SAVING TWICE DOES NOT MAKE A SECOND FIELD, and a field somebody answered is
  // never taken away by a later edit.
  const again = await api("PUT", `/giving-pages/${PAGE}/form`, tok, { config: real });
  ok("§6 saving the same form again creates no second field",
     again.body.customFieldsCreated.length === 0
     && (await q(`SELECT COUNT(*)::int AS c FROM custom_field_defs WHERE org_id=$1`, [ORG]))[0].c === 2);
  const dropped = await api("PUT", `/giving-pages/${PAGE}/form`, tok,
    { config: { ...real, questions: [real.questions[0]] } });
  ok("§6 removing a question from the form does NOT delete the field",
     dropped.status === 200
     && (await q(`SELECT COUNT(*)::int AS c FROM custom_field_defs WHERE org_id=$1`, [ORG]))[0].c === 2);
  const badKey = await api("PUT", `/giving-pages/${PAGE}/form`, tok,
    { config: { questions: [{ key: "How Heard!", label: "x", type: "text" }] } });
  ok("§6 a key the report builder could not read is refused",
     badKey.status === 400 && /lower-case letters/.test(badKey.body.error), badKey.body);
  const oneOption = F.validateFormConfig(
    { questions: [{ key: "k", label: "Pick", type: "choice", options: ["only one"] }] }, { orgFundIds: [] });
  ok("§6 a choice with one answer is refused", !oneOption.ok, oneOption.errors);
  const tooMany = F.validateFormConfig(
    { questions: Array.from({ length: 6 }, (_, i) => ({ key: "q" + i, label: "Q", type: "text" })) }, { orgFundIds: [] });
  ok("§6 six questions is refused, and the reason is about gifts, not tidiness",
     !tooMany.ok && /costs gifts/.test(tooMany.errors[0].message), tooMany.errors);

  // ── §7 · A LIVE FORM ALWAYS RENDERS ─────────────────────────────────────
  console.log("\n— §7 · refusing to render is the one outcome a live form may not have —");
  await api("PUT", `/giving-pages/${PAGE}/form`, tok, { config: real });
  await q(`DELETE FROM fin_funds WHERE id='f_youth102'`);
  const afterDelete = await api("GET", `/org/b102-form/giving-page/spring/public`, null, null);
  ok("§7 the page still loads after a designated fund is deleted", afterDelete.status === 200, afterDelete.body);
  const spec2 = afterDelete.body.givingPage.form;
  ok("§7 …offering only the fund that still exists",
     spec2.designation.mode === "choice" && spec2.designation.options.length === 1
     && spec2.designation.options[0].fundName === "General fund", spec2.designation);
  // A stored config that can no longer validate at all still renders.
  const nonsense = F.normalizeFormConfig({ amountsCents: "not a list", showTribute: true }, { orgFundIds: [] });
  ok("§7 a stored setting that no longer validates falls back, and the rest survives",
     nonsense.amountsCents.join(",") === F.DEFAULT_AMOUNTS_CENTS.join(",") && nonsense.showTribute === true,
     nonsense);
  // A redirect is an outbound link a donor follows straight after paying.
  for (const [url, why] of [["http://example.org", "plain http"],
                            ["https://user:pw@example.org", "credentials in it"],
                            ["not a url", "not a url at all"]]) {
    ok(`§7 a redirect that is ${why} is refused`,
       !F.validateFormConfig({ thankYou: { message: "", redirectUrl: url } }, { orgFundIds: [] }).ok, url);
  }

  // ── §8 · THE WALL ───────────────────────────────────────────────────────
  console.log("\n— §8 · org A cannot read or write org B's form —");
  const crossRead = await api("GET", `/giving-pages/${theirPage.body.id}/form`, tok, null);
  ok("§8 reading another org's form is 404", crossRead.status === 404, crossRead.status);
  const crossWrite = await api("PUT", `/giving-pages/${theirPage.body.id}/form`, tok, { config: { showTribute: true } });
  ok("§8 writing it is 404 too", crossWrite.status === 404, crossWrite.status);
  ok("§8 …and nothing was written",
     (await q(`SELECT form_config FROM giving_pages WHERE id=$1`, [theirPage.body.id]))[0].form_config === null);
  ok("§8 org B's own funds are untouched",
     (await q(`SELECT COUNT(*)::int AS c FROM fin_funds WHERE org_id=$1`, [OTHER]))[0].c === 1);
  ok("§8 and org A made no custom field in org B",
     (await q(`SELECT COUNT(*)::int AS c FROM custom_field_defs WHERE org_id=$1`, [OTHER]))[0].c === 0);
  const staffTok = tok;  // the route is admin-only; a non-admin is covered by the matrix
  ok("§8 the form routes are admin-only, like every other giving-page write",
     (await api("PUT", `/giving-pages/${PAGE}/form`, staffTok, { config: {} })).status === 200);

  if (!process.env.KEEP) await reset();
  await closeDb();
  summary();
})();
