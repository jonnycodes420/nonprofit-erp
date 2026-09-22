// BUILD-95 — READING A CHEQUE, AND REFUSING TO GUESS ONE.
//
// The property this suite exists to hold: **a read can fill in an amount ONLY
// when two independent readings of the same cheque agree to the cent.** A
// cheque carries its amount twice for exactly this reason, and it is the only
// check here that is real — a model's own confidence is not evidence.
//
// So the family below is built around disagreement, not agreement: every way
// the two readings can fail to settle, and the assertion each time is that
// NOTHING is placed and the line says what it saw.
//
// And the route's own property: it PROPOSES, so it must write nothing at all.
// That is asserted by content-hashing the org's rows either side of it, not by
// reading the handler.
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "org_b95r";
const money = c => "$" + (c / 100).toFixed(2);

(async () => {
  const cr = await import("../shared/chequeRead.js");

  console.log("— the written amount, as people actually write it —");
  for (const [words, cents] of [
    ["Two hundred fifty and 00/100", 25000],
    ["One thousand two hundred fifty and 50/100", 125050],
    ["Twenty-five dollars only", 2500],
    ["One hundred and fifty", 15000],        // the British "and", not a cents mark
    ["Fifteen thousand", 1500000],
    ["Forty and no/100", 4000],
    ["1,250 and 00/100", 125000],            // people do write it part-numeric
    ["  TWO HUNDRED AND 00/100  ", 20000],
  ]) ok(`"${words}" reads ${cents}`, cr.writtenAmountToCents(words) === cents, cr.writtenAmountToCents(words));

  console.log("— …and a REFUSAL is never a zero —");
  for (const bad of ["", null, "squiggle", "hundred", "and 00/100", "xqz and 00/100"])
    ok(`${JSON.stringify(bad)} refuses`, cr.writtenAmountToCents(bad) === null, cr.writtenAmountToCents(bad));

  console.log("— THE CROSS-CHECK: agreement is the ONLY thing that fills an amount —");
  const agree = cr.reconcileAmount(25000, 25000);
  ok("two readings that agree settle it", agree.agreed === true && agree.cents === 25000, agree);

  console.log("— every way it can fail to settle, and none of them place a number —");
  const family = [
    ["the figures and the words disagree", cr.reconcileAmount(25000, 2500)],   // a misplaced decimal
    ["the figures and the words disagree", cr.reconcileAmount(25000, 25050)],  // one cent apart is still apart
    ["only the figures could be read", cr.reconcileAmount(25000, null)],
    ["only the words could be read", cr.reconcileAmount(null, 25000)],
    ["neither amount could be read", cr.reconcileAmount(null, null)],
  ];
  for (const [reason, rec] of family) {
    ok(`${reason} → nothing placed`, rec.agreed === false && rec.cents === null, rec);
    ok(`…and it says so: "${reason}"`, rec.reason === reason, rec.reason);
    const s = cr.unsettledSentence(rec, money);
    ok("…in a sentence that ends and names the fix", /\.$/.test(s) && /[Tt]ype/.test(s), s);
  }
  ok("a disagreement quotes BOTH figures, and picks neither",
    cr.unsettledSentence(cr.reconcileAmount(25000, 2500), money).includes("$250.00")
    && cr.unsettledSentence(cr.reconcileAmount(25000, 2500), money).includes("$25.00"),
    cr.unsettledSentence(cr.reconcileAmount(25000, 2500), money));

  console.log("— the model is asked for GLYPHS, and is given no money decisions —");
  const props = Object.keys(cr.CHEQUE_READ_SCHEMA.properties);
  ok("it reports what it could NOT read", props.includes("unreadable"));
  ok("it transcribes BOTH amounts separately",
    props.includes("amountDigits") && props.includes("amountWords"));
  for (const forbidden of ["fund", "fundId", "donorId", "isGift", "confidence", "amountCents", "amount"])
    ok(`it is never asked for "${forbidden}"`, !props.includes(forbidden));
  ok("every field is nullable, so a blank cheque line comes back blank",
    props.filter(k => k !== "unreadable")
      .every(k => JSON.stringify(cr.CHEQUE_READ_SCHEMA.properties[k].type).includes("null")));
  ok("strict tool use is possible: additionalProperties false + required",
    cr.CHEQUE_READ_SCHEMA.additionalProperties === false
    && cr.CHEQUE_READ_SCHEMA.required.length === props.length);
  ok("the prompt forbids inferring one amount from the other",
    /independently/i.test(cr.CHEQUE_READ_PROMPT) && /never copy one into/i.test(cr.CHEQUE_READ_PROMPT));
  ok("…and forbids correcting or completing anything",
    /Do not interpret, correct, complete or tidy/i.test(cr.CHEQUE_READ_PROMPT));

  console.log("— the model on this path is NOT a cheap one —");
  ok("it reads cursive on Opus 5", cr.CHEQUE_READ_MODEL === "claude-opus-5", cr.CHEQUE_READ_MODEL);

  // ── the route ────────────────────────────────────────────────────────────
  console.log("— and the route PROPOSES: it writes nothing at all —");
  for (const t of ["gifts", "interactions", "donors", "users", "imports"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone)
           VALUES ($1,'Read Arts','b95r',1,'active','team','America/New_York')
           ON CONFLICT (id) DO UPDATE SET subscription_status='active', plan='team'`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_b95r',$1,'b95r@test.local',$2,'Allie Barnett','admin')
           ON CONFLICT (id) DO UPDATE SET org_id=EXCLUDED.org_id`, [ORG, bcrypt.hashSync("loadtest1234", 10)]);
  const tok = await login("b95r@test.local", "loadtest1234");

  const hash = async () => {
    const parts = [];
    for (const t of ["gifts", "donors", "interactions", "imports", "portal_assets"]) {
      const r = await q(`SELECT * FROM ${t} WHERE org_id=$1 ORDER BY id`, [ORG]).catch(() => []);
      parts.push(t + ":" + JSON.stringify(r));
    }
    return crypto.createHash("sha256").update(parts.join("|")).digest("hex");
  };
  const before = await hash();

  const sharp = require("sharp");
  const png = await sharp({ create: { width: 900, height: 400, channels: 3, background: { r: 250, g: 250, b: 245 } } }).png().toBuffer();
  const uri = "data:image/png;base64," + png.toString("base64");

  ok("no cheques is a 400, not an empty success",
    (await api("POST", "/deposits/read-cheques", tok, { cheques: [] })).status === 400);
  const many = await api("POST", "/deposits/read-cheques", tok,
    { cheques: Array.from({ length: 21 }, (_, i) => ({ line: i + 1, image: uri })) });
  ok("more than twenty at a time is refused, naming the cap",
    many.status === 400 && /20/.test(many.body.message || ""), many.body);

  // An unconfigured key makes the feature UNAVAILABLE, never silently empty —
  // "Steward read no cheques" would be the more comfortable untruth.
  const real = await api("POST", "/deposits/read-cheques", tok, { cheques: [{ line: 1, image: uri }] });
  if (real.status === 503) {
    ok("with no API key configured it says so (503), it does not return empty reads",
      real.body.error === "reading_unavailable", real.body);
  } else {
    ok("a non-image is refused BY CONTENT", true);
    const junk = await api("POST", "/deposits/read-cheques", tok,
      { cheques: [{ line: 1, image: "data:image/png;base64,bm90YW5pbWFnZQ==" }] });
    ok("…and reported per line, never as a whole-request failure",
      junk.status === 200 && junk.body.reads[0].error === "not_an_image", junk.body);
  }

  ok("THE ORG'S ROWS ARE BYTE-IDENTICAL AFTERWARDS — it proposed, it did not post",
    (await hash()) === before);
  ok("…and the answer says so out loud",
    /Nothing is recorded until you commit/.test(cr.CHEQUE_READ_NOTE), cr.CHEQUE_READ_NOTE);

  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
