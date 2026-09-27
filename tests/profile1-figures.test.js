// PROFILE-1 — THE FOUR NUMBERS AT THE TOP OF A PERSON'S RECORD OPEN.
//
// Lifetime giving, the last gift, how long since we last spoke, and what we
// are asking them for. The rule FIX-2 A set for the dashboards now holds on a
// person's record too: every number opens, and what it opens adds up to it.
//
// The fixture is one organisation with one person who has given across four
// years (including a refund, which comes off), two conversations, one open
// proposal and one they already said yes to — and a second person with
// nothing at all, because "£0" and "nobody has given yet" are different facts
// and the record must not say the first when it means the second.
//
//   §1  each of the four figures is worth what the fixture says, to the cent
//   §2  each one FOOTS: every row of its drill-through, recomputed
//   §3  the profile payload carries all four sources, and each one fetches
//   §4  a second organisation gets none of it
//   §5  an unknown source is a 404 and a malformed parameter a 400
//   §6  the blank case: value null, and a sentence saying what appears there
//   §7  the guard can fail: one cent off does not foot
//
// Run on the scratch stack: BASE, DATABASE_URL (see tests/run-all.sh).

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, civilToday, civilPlusDays } = require("./helpers");

const ORG = "org_p1fig", ORG2 = "org_p1fig2";
const EMAIL = "p1fig@example.org", EMAIL2 = "p1fig2@example.org";
const PW = "loadtest1234";
const GIVER = "d_p1fig_giver", BLANK = "d_p1fig_blank", OTHER = "d_p1fig_other";
// The two donors whose lifetime is NOT the sum of the gifts you can list.
const IMPORTED = "d_p1fig_imported", STALE = "d_p1fig_stale";

const cents = n => Math.round((Number(n) || 0) * 100);
const qs = params => Object.entries(params || {}).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");

// The FK order the repo learned the hard way: a suite that deletes an org
// must clear its money tables first or the delete fails silently and the next
// run inherits the last one's rows.
const CHILD = ["threads", "donor_designations", "workflow_runs", "workflows", "moves", "opportunities",
  "tasks", "receipts", "pledges", "fin_audit_log", "fin_transactions", "gifts", "interactions",
  "notification_sends", "metric_snapshots"];
async function reset() {
  for (const o of [ORG, ORG2]) {
    for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    for (const t of ["donors", "campaigns", "fin_funds", "accounts", "budgets", "users"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}

// Every row behind a source, every page of it. (The shape fix2-a-footing uses,
// so the two suites cannot disagree about what "paging through" means.)
async function allRows(tok, source) {
  const rows = []; let page = 1, first = null;
  for (;;) {
    const r = await api("GET", `/figures/${encodeURIComponent(source.key)}/rows?${qs({ ...source.params, page, pageSize: 200 })}`, tok);
    if (r.status !== 200) return { status: r.status, body: r.body, rows: [] };
    first = first || r.body;
    rows.push(...(r.body.rows || []));
    if (rows.length >= (r.body.totalRows || 0) || !(r.body.rows || []).length) break;
    page++;
  }
  return { status: 200, body: first, rows };
}

function measureOf(measure, rows) {
  if (measure === "sum") return rows.reduce((s, r) => s + cents(r.amount), 0) / 100;
  if (measure === "count") return rows.length;
  if (measure === "avg") return rows.length ? Math.round(rows.reduce((s, r) => s + Number(r.amount || 0), 0) / rows.length) : 0;
  return NaN;
}

// Does a figure foot to its rows? Returns [true] or [false, why]. `fig` is a
// figure as the PROFILE hands it over: { value, cents, source }.
async function foots(tok, fig) {
  const got = await allRows(tok, fig.source);
  if (got.status !== 200) return [false, `rows answered ${got.status}`];
  const b = got.body;
  if (got.rows.length !== b.totalRows) return [false, `pages returned ${got.rows.length} of ${b.totalRows}`];
  const v = measureOf(b.measure, got.rows);
  if (b.measure !== "sum") return [false, `a profile figure should be a sum, not ${b.measure}`];
  return cents(v) === cents(fig.value) && cents(b.value) === cents(fig.value)
    && b.cents === cents(fig.value) && fig.cents === cents(fig.value)
    ? [true] : [false, `rows ${v} · endpoint ${b.value}/${b.cents} · figure ${fig.value}/${fig.cents}`];
}

(async () => {
  console.log("profile1-figures");
  await reset();
  const today = civilToday();

  for (const [id, email, name, slug] of [[ORG, EMAIL, "Kettle Creek Conservancy", "p1fig"],
                                         [ORG2, EMAIL2, "Someone Else Entirely", "p1fig2"]]) {
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,created_at)
             VALUES ($1,$2,$3,1,'active','team', NOW() - INTERVAL '900 days')`, [id, name, slug]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
             VALUES ($1,$2,$3,$4,'Admin User','admin')`, ["u_" + id, id, email, bcrypt.hashSync(PW, 4)]);
  }
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('ff_p1fig',$1,'Creek Restoration',true)`, [ORG]);

  await q(`INSERT INTO donors (id,org_id,name,stage) VALUES
           ($1,$3,'Marguerite Delacroix-Okonkwo','steward'),($2,$3,'Nobody Has Given Yet','prospect')`,
    [GIVER, BLANK, ORG]);

  // FOUR YEARS OF GIVING, AND A REFUND. The refund is a gift with a negative
  // amount — exactly how the `gifts` source treats one — so lifetime giving
  // must come out LOWER than the four positives add to.
  const GIFTS = [
    ["g_p1fig_1",  250.00, `${Number(today.slice(0, 4)) - 3}-02-14`, "ff_p1fig", "Cheque"],
    ["g_p1fig_2", 1000.50, `${Number(today.slice(0, 4)) - 2}-06-01`, null, "Card"],
    ["g_p1fig_3",   75.25, `${Number(today.slice(0, 4)) - 1}-11-20`, "ff_p1fig", "Cash"],
    ["g_p1fig_ref", -50.00, `${Number(today.slice(0, 4)) - 1}-12-01`, "ff_p1fig", "Card"],
    ["g_p1fig_4",  400.10, civilPlusDays(-5), "ff_p1fig", "Card"],
  ];
  for (const [id, amount, date, fund, method] of GIFTS) {
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,fund_id,payment_method)
             VALUES ($1,$2,$3,$4,$5,'cash',$6,$7)`, [id, ORG, GIVER, amount, date, fund, method]);
  }
  const EXPECT_LIFETIME = 250.00 + 1000.50 + 75.25 - 50.00 + 400.10;   // 1675.85
  const EXPECT_LAST_GIFT = 400.10;
  // Her rollup column agrees with her gifts to the cent, so she is the
  // control: nothing synthetic should ever appear in her drawer.
  await q(`UPDATE donors SET total_giving=$2, gift_count=$3 WHERE id=$1`, [GIVER, EXPECT_LIFETIME, GIFTS.length]);

  // HISTORY THAT ARRIVED AS A TOTAL (BUILD-57 §2c). The column is the real
  // lifetime; only part of it has individual gifts behind it.
  const IMPORTED_TOTAL = 485000.00, IMPORTED_ITEMIZED = 375000.00;
  const IMPORTED_GAP = IMPORTED_TOTAL - IMPORTED_ITEMIZED;              // 110,000.00
  const IMPORTED_FIRST = `${Number(today.slice(0, 4)) - 9}-01-15`;
  await q(`INSERT INTO donors (id,org_id,name,stage,total_giving,gift_count,first_gift_date)
           VALUES ($1,$2,'Thaddeus Wrenfield-Amaya','steward',$3,2,$4)`, [IMPORTED, ORG, IMPORTED_TOTAL, IMPORTED_FIRST]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,payment_method) VALUES
           ('g_p1fig_i1',$1,$2,200000.00,$3,'cash','Wire'),('g_p1fig_i2',$1,$2,175000.00,$4,'cash','Wire')`,
    [ORG, IMPORTED, `${Number(today.slice(0, 4)) - 3}-04-04`, `${Number(today.slice(0, 4)) - 2}-09-09`]);

  // THE OTHER DIRECTION: the rollup column is STALE and lower than the gifts
  // actually on file. The gifts are the primary record; the column is not.
  const STALE_ITEMIZED = 900.00;
  await q(`INSERT INTO donors (id,org_id,name,stage,total_giving,gift_count)
           VALUES ($1,$2,'Perpetua Halvorsen','steward',100.00,1)`, [STALE, ORG]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,payment_method)
           VALUES ('g_p1fig_s1',$1,$2,900.00,$3,'cash','Cheque')`, [ORG, STALE, civilPlusDays(-30)]);

  // TWO CONVERSATIONS. The gap is measured to the most recent.
  const LAST_TALK_DAYS = 12;
  await q(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name) VALUES
           ($1,$5,$6,'meeting','Walked the north bank with her.',$2,$7,'Admin User'),
           ($3,$5,$6,'call','Rang about the culvert.',$4,$7,'Admin User')`,
    ["int_p1fig_old", civilPlusDays(-40), "int_p1fig_new", civilPlusDays(-LAST_TALK_DAYS), ORG, GIVER, "u_" + ORG]);

  // ONE OPEN PROPOSAL, ONE THEY ALREADY SAID YES TO. Only the open one counts.
  await q(`INSERT INTO opportunities (id,org_id,donor_id,name,target_amount,status,proposal_stage,expected_close)
           VALUES ($1,$2,$3,'Culvert replacement',25000.00,'open','asked',$4)`,
    ["opp_p1fig_open", ORG, GIVER, civilPlusDays(45)]);
  await q(`INSERT INTO opportunities (id,org_id,donor_id,name,target_amount,status,proposal_stage,expected_close)
           VALUES ($1,$2,$3,'Boardwalk, already committed',99999.00,'won','committed',$4)`,
    ["opp_p1fig_won", ORG, GIVER, civilPlusDays(10)]);
  const EXPECT_OPEN_ASK = 25000.00;

  // Org two: its own person, with one of everything, to prove nothing crosses.
  await q(`INSERT INTO donors (id,org_id,name,stage) VALUES ($1,$2,'Outsider Person','steward')`, [OTHER, ORG2]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type) VALUES ('g_p1fig_x',$1,$2,777.00,$3,'cash')`, [ORG2, OTHER, today]);
  await q(`INSERT INTO interactions (id,org_id,donor_id,type,note,date) VALUES ('int_p1fig_x',$1,$2,'call','Theirs.',$3)`, [ORG2, OTHER, today]);
  await q(`INSERT INTO opportunities (id,org_id,donor_id,name,target_amount,status,proposal_stage)
           VALUES ('opp_p1fig_x',$1,$2,'Theirs',4242.00,'open','asked')`, [ORG2, OTHER]);

  const tok = await login(EMAIL, PW), tok2 = await login(EMAIL2, PW);

  // ── §1 · each figure is worth what the fixture says ─────────────────────
  console.log("\n— §1 · the four figures, to the cent —");
  const prof = await api("GET", `/donors/${GIVER}`, tok);
  ok("§1 the profile answers 200 and still carries what it always did",
    prof.status === 200 && prof.body.id === GIVER && Array.isArray(prof.body.gifts)
    && Array.isArray(prof.body.interactions) && prof.body.person_types !== undefined,
    { status: prof.status, keys: Object.keys(prof.body || {}).length });
  const F = prof.body.figures || {};
  ok("§1 the payload carries a `figures` object with all four",
    ["lifetime", "lastGift", "contact", "openAsk"].every(k => F[k] && typeof F[k] === "object"), Object.keys(F));
  ok(`§1 lifetime giving is ${EXPECT_LIFETIME} — four gifts less the refund`,
    cents(F.lifetime?.value) === cents(EXPECT_LIFETIME) && F.lifetime?.cents === cents(EXPECT_LIFETIME),
    { value: F.lifetime?.value, cents: F.lifetime?.cents });
  ok(`§1 the last gift is ${EXPECT_LAST_GIFT}, the most recent one alone`,
    cents(F.lastGift?.value) === cents(EXPECT_LAST_GIFT) && F.lastGift?.cents === cents(EXPECT_LAST_GIFT),
    { value: F.lastGift?.value });
  ok(`§1 last contact is ${LAST_TALK_DAYS} days — the gap to the most recent conversation, not to the older one`,
    F.contact?.value === LAST_TALK_DAYS, { value: F.contact?.value });
  ok(`§1 the open ask is ${EXPECT_OPEN_ASK}: the proposal in flight, not the one they said yes to`,
    cents(F.openAsk?.value) === cents(EXPECT_OPEN_ASK), { value: F.openAsk?.value });
  ok("§1 a figure with rows behind it carries no blank sentence",
    [F.lifetime, F.lastGift, F.contact, F.openAsk].every(f => f.blank === null && f.blankShort === null),
    [F.lifetime?.blank, F.contact?.blank]);

  // ── §2 · every one of them foots ────────────────────────────────────────
  console.log("\n— §2 · every row of the drill-through, recomputed —");
  for (const k of ["lifetime", "lastGift", "contact", "openAsk"]) {
    const [good, why] = await foots(tok, F[k]);
    ok(`§2 ${k} (${F[k].source.key}) foots to its rows in cents`, good, why);
  }
  const lifeRows = await allRows(tok, F.lifetime.source);
  ok("§2 lifetime opens every gift, most recent first, with the fund as the line and how it was paid as the detail",
    lifeRows.rows.length === GIFTS.length && lifeRows.rows[0].id === "g_p1fig_4"
    && lifeRows.rows[0].name === "Creek Restoration" && lifeRows.rows[0].detail === "Card"
    && lifeRows.rows.some(r => r.name === "Unrestricted") && lifeRows.rows.some(r => cents(r.amount) === -5000),
    lifeRows.rows.map(r => [r.id, r.name, r.amount, r.detail]));
  const lastRows = await allRows(tok, F.lastGift.source);
  ok("§2 the last gift opens exactly one row, and it is that gift",
    lastRows.rows.length === 1 && lastRows.body.totalRows === 1 && lastRows.rows[0].id === "g_p1fig_4",
    lastRows.rows);
  const talkRows = await allRows(tok, F.contact.source);
  ok("§2 last contact opens the history — both conversations, newest first — while only the newest carries the count",
    talkRows.rows.length === 2 && talkRows.rows[0].id === "int_p1fig_new"
    && talkRows.rows[0].amount === LAST_TALK_DAYS && talkRows.rows[1].amount === null
    && /logged by Admin User/.test(talkRows.rows[0].detail || ""),
    talkRows.rows.map(r => [r.id, r.amount, r.detail]));
  ok("§2 …and it says its amounts are DAYS, not money, so nothing renders them as pounds",
    talkRows.body.amountKind === "days" && lifeRows.body.amountKind === "money",
    { contact: talkRows.body.amountKind, lifetime: lifeRows.body.amountKind });
  const askRows = await allRows(tok, F.openAsk.source);
  ok("§2 the open ask opens the open proposal only, named, with its stage in words",
    askRows.rows.length === 1 && askRows.rows[0].id === "opp_p1fig_open"
    && askRows.rows[0].name === "Culvert replacement" && askRows.rows[0].detail === "Asked"
    && /^\d{4}-\d{2}-\d{2}$/.test(askRows.rows[0].date || ""),
    askRows.rows);

  // ── §2b · a lifetime that is bigger than the gifts you can list ─────────
  console.log("\n— §2b · imported history is a row in the drawer, not a footnote beside it —");
  const impProf = await api("GET", `/donors/${IMPORTED}`, tok);
  const IMP = impProf.body.figures?.lifetime || {};
  ok(`§2b lifetime is the TRUE lifetime ${IMPORTED_TOTAL}, not the ${IMPORTED_ITEMIZED} that is itemized`,
    cents(IMP.value) === cents(IMPORTED_TOTAL) && IMP.cents === cents(IMPORTED_TOTAL),
    { value: IMP.value, cents: IMP.cents, itemized: IMPORTED_ITEMIZED });
  const [impFoots, impWhy] = await foots(tok, IMP);
  ok("§2b …and it still foots: every page walked, every row added, to the cent", impFoots, impWhy);
  const impRows = await allRows(tok, IMP.source);
  const synth = impRows.rows.filter(r => r.type === "imported_total");
  ok("§2b exactly one imported-total row, and it carries the difference",
    synth.length === 1 && cents(synth[0].amount) === cents(IMPORTED_GAP),
    impRows.rows.map(r => [r.type, r.amount]));
  ok("§2b …it is LAST, in the oldest position, after every gift that can be named",
    impRows.rows.length === 3 && impRows.rows[2].type === "imported_total"
    && impRows.rows.slice(0, 2).every(r => r.type === "gift"),
    impRows.rows.map(r => [r.id, r.type]));
  ok("§2b …and it says in the drawer what it is, so nobody has to find the explanation elsewhere",
    synth[0]?.name === "Giving before Steward"
    && /imported as a total/i.test(synth[0]?.detail || "") && /no individual gifts/i.test(synth[0]?.detail || ""),
    [synth[0]?.name, synth[0]?.detail]);
  ok("§2b …dated from the person's first known gift, which predates everything itemized",
    synth[0]?.date === IMPORTED_FIRST && synth[0].date < impRows.rows[1].date, [synth[0]?.date, impRows.rows[1]?.date]);
  ok("§2b the paging count includes it — a synthetic row pages like any other",
    impRows.body.totalRows === 3, impRows.body.totalRows);
  const impPaged = await api("GET", `/figures/donor-lifetime/rows?${qs({ donor: IMPORTED, page: 3, pageSize: 1 })}`, tok);
  ok("§2b …and asking for it by page returns it alone, with the figure still whole",
    impPaged.body.rows.length === 1 && impPaged.body.rows[0].type === "imported_total"
    && cents(impPaged.body.value) === cents(IMPORTED_TOTAL), impPaged.body.rows);
  ok("§2b the sentence says an imported total gets a row of its own",
    /imported total/i.test(impRows.body.sentence || "") && /row of its own/i.test(impRows.body.sentence || ""),
    impRows.body.sentence);

  const giverRows = await allRows(tok, F.lifetime.source);
  ok("§2b a person whose column agrees with her gifts gets NO synthetic row",
    giverRows.rows.length === GIFTS.length && !giverRows.rows.some(r => r.type === "imported_total"),
    giverRows.rows.map(r => r.type));

  const staleProf = await api("GET", `/donors/${STALE}`, tok);
  const STL = staleProf.body.figures?.lifetime || {};
  const staleRows = await allRows(tok, STL.source);
  ok(`§2b a STALE column lower than the gifts on file does not invent a negative row: lifetime is the itemized ${STALE_ITEMIZED}`,
    cents(STL.value) === cents(STALE_ITEMIZED) && staleRows.rows.length === 1
    && !staleRows.rows.some(r => r.type === "imported_total"),
    { value: STL.value, rows: staleRows.rows.map(r => [r.type, r.amount]) });
  const [staleFoots, staleWhy] = await foots(tok, STL);
  ok("§2b …and that foots too", staleFoots, staleWhy);

  // ── §3 · every source on the payload fetches ────────────────────────────
  console.log("\n— §3 · every source the record hands out is a source the server serves —");
  const bad = [];
  for (const [k, f] of Object.entries(F)) {
    if (!f.source || typeof f.source.key !== "string" || !f.source.params || f.source.params.donor !== GIVER) { bad.push(`${k}: no usable source`); continue; }
    const r = await api("GET", `/figures/${f.source.key}/rows?${qs(f.source.params)}`, tok);
    if (r.status !== 200) bad.push(`${k}: ${r.status}`);
  }
  ok("§3 all four sources name this person and answer 200", bad.length === 0, bad);
  ok("§3 the days figure hands over the org's today with it, so the drawer re-fetches the same number, never the machine's",
    F.contact.source.params.today === today, F.contact.source.params);
  const nothingWritten = async () => (await q(
    `SELECT (SELECT COUNT(*) FROM gifts WHERE org_id=$1)::int + (SELECT COUNT(*) FROM interactions WHERE org_id=$1)::int
          + (SELECT COUNT(*) FROM opportunities WHERE org_id=$1)::int AS n`, [ORG]))[0].n;
  const before = await nothingWritten();
  for (const f of Object.values(F)) await api("GET", `/figures/${f.source.key}/rows?${qs(f.source.params)}`, tok);
  ok("§3 opening a figure writes nothing", (await nothingWritten()) === before);

  // ── §4 · a second organisation gets none of it ──────────────────────────
  console.log("\n— §4 · nothing crosses between organisations —");
  const crossed = [];
  for (const f of Object.values(F)) {
    const r = await api("GET", `/figures/${f.source.key}/rows?${qs(f.source.params)}`, tok2);
    if (r.status !== 200 || (r.body.rows || []).length !== 0 || r.body.totalRows !== 0 || r.body.value !== 0) {
      crossed.push([f.source.key, r.status, r.body.totalRows, r.body.value]);
    }
  }
  ok("§4 org B asking for org A's person by id gets zero rows from all four", crossed.length === 0, crossed);
  const theirOwn = await api("GET", `/figures/donor-lifetime/rows?${qs({ donor: OTHER })}`, tok2);
  ok("§4 …while its own person's rows are its own", theirOwn.body.totalRows === 1 && cents(theirOwn.body.value) === 77700, theirOwn.body.rows);
  ok("§4 …and org A cannot reach into org B either",
    (await api("GET", `/figures/donor-lifetime/rows?${qs({ donor: OTHER })}`, tok)).body.totalRows === 0);

  // ── §5 · what the endpoint refuses ──────────────────────────────────────
  console.log("\n— §5 · an unknown source, and a parameter that is not one —");
  ok("§5 an unknown source is a 404", (await api("GET", `/figures/donor-lifetimee/rows?${qs({ donor: GIVER })}`, tok)).status === 404);
  ok("§5 a donor id that is not an id is a 400, not a guess",
    (await api("GET", "/figures/donor-lifetime/rows?donor=not%20an%20id%21", tok)).status === 400);
  ok("§5 a missing required donor is a 400", (await api("GET", "/figures/donor-lifetime/rows", tok)).status === 400);
  ok("§5 a malformed `today` on the days figure is a 400",
    (await api("GET", `/figures/donor-contact-gap/rows?${qs({ donor: GIVER, today: "yesterday" })}`, tok)).status === 400);
  ok("§5 signed out, nothing", (await api("GET", `/figures/donor-lifetime/rows?${qs({ donor: GIVER })}`, null)).status === 401);

  // ── §6 · the blank case ─────────────────────────────────────────────────
  console.log("\n— §6 · nobody has given yet is not the same as nothing was given —");
  const blankProf = await api("GET", `/donors/${BLANK}`, tok);
  const B = blankProf.body.figures || {};
  const blanksBad = [];
  for (const k of ["lifetime", "lastGift", "contact", "openAsk"]) {
    const f = B[k] || {};
    if (f.value !== null) blanksBad.push(`${k}: value ${JSON.stringify(f.value)}, not null`);
    if (f.cents !== null) blanksBad.push(`${k}: cents ${JSON.stringify(f.cents)}, not null`);
    if (typeof f.blank !== "string" || f.blank.length <= 30 || !/\.$/.test(f.blank)) blanksBad.push(`${k}: ${JSON.stringify(f.blank)}`);
    if (typeof f.blankShort !== "string" || !f.blankShort.length) blanksBad.push(`${k}: no short blank`);
    if (/^none\.?$/i.test(String(f.blank).trim()) || /^none\.?$/i.test(String(f.blankShort).trim())) blanksBad.push(`${k}: a bare "None"`);
  }
  ok("§6 all four read blank, each with a sentence that says what appears there and when", blanksBad.length === 0, blanksBad);
  ok("§6 a blank figure still carries its source, so the drawer opens and says the same",
    ["lifetime", "lastGift", "contact", "openAsk"].every(k => B[k]?.source?.params?.donor === BLANK), Object.keys(B));
  const blankRows = await allRows(tok, B.lifetime.source);
  ok("§6 …and that source has no rows behind it", blankRows.status === 200 && blankRows.body.totalRows === 0, blankRows.body?.totalRows);

  // ── §7 · the guard can fail ─────────────────────────────────────────────
  console.log("\n— §7 · a figure one cent off does not foot —");
  const [offByCent] = await foots(tok, { ...F.lifetime, value: F.lifetime.value + 0.01, cents: F.lifetime.cents + 1 });
  ok("§7 lifetime one cent over its rows fails the footing", offByCent === false);
  const [offCents] = await foots(tok, { ...F.lifetime, cents: F.lifetime.cents + 1 });
  ok("§7 …and so does a value that is right with a `cents` that is not", offCents === false);
  const [offDay] = await foots(tok, { ...F.contact, value: LAST_TALK_DAYS + 1, cents: (LAST_TALK_DAYS + 1) * 100 });
  ok("§7 …and last contact one day out fails too", offDay === false);
  // The exact regression this section exists for: a lifetime that sums only
  // the gifts it can list, on a donor whose history arrived as a total.
  const [itemizedOnly] = await foots(tok, { ...IMP, value: IMPORTED_ITEMIZED, cents: cents(IMPORTED_ITEMIZED) });
  ok("§7 the itemized-only number fails the footing on an imported-history donor — the under-report cannot pass", itemizedOnly === false);
  const [stillGood] = await foots(tok, F.lifetime);
  ok("§7 …while the untouched figure still passes, so §7 proved a guard and not a broken helper", stillGood === true);
  const [impStillGood] = await foots(tok, IMP);
  ok("§7 …and so does the imported-history one", impStillGood === true);

  await reset();
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
