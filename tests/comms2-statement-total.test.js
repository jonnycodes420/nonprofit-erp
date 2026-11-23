// COMMS-2 — THE ONE TEST: a year-end statement's gift total equals the sum of
// that donor's receipted gifts for the year to the cent, and excludes
// non-deductible amounts the way receipts already do.
//
// The donor's year is built from the gifts that break arithmetic and receipts:
//   $100.10 · $0.10 + $0.20 (0.1 + 0.2 in floating point is not 0.3) ·
//   a $150 event ticket of which $50 bought the dinner (deductible $100) ·
//   a gift partially refunded from $100 to $80 whose stored deductible still
//   says $100 · a $10.01 refund · and three that must not count: a sample gift,
//   a gift from the year before, and a gift whose dispute the org lost.
// Then:
//   1. the statement's total deductible is exactly $270.39 (27039 cents), and the
//      total given is $320.39;
//   2. it equals, to the cent, the sum of each gift's own receipt (POST
//      /gifts/:id/receipt) for the gifts on the statement: one rule, two documents;
//   3. no line on it says more is deductible than was given.
//
// How it fails, planted and watched: add the dollars as floats (1 goes red at
// the cent), or trust the stored deductible after a refund (1 and 3 go red).
//
// RECEIPTS-1 (the donor's address, and in-kind receipts the IRS way):
//   4. a donor with no address gets a receipt whose donor block has no address; the org's
//      address is in the header band only (red on main: the org's address printed under the
//      donor's name, on every receipt); a donor with one gets theirs, frozen in the snapshot;
//   5. an in-kind receipt describes the property, says the date received and that Steward states
//      no value, and has no AMOUNT box and no dollar figure (red on main: AMOUNT $300.00); a new
//      in-kind gift with no description is refused, and an old one gets no receipt until it has
//      one; a stock receipt names its shares and ticker;
//   6. Reissue voids a receipt and makes it again as the same number with -R1, then -R2, and the
//      list flags a receipt issued with the org's address in the donor block.
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const zlib = require("zlib");
const ORG = "org_cm2t", DONOR = "d_cm2t", BARE = "d_cm2t_bare";
const ORG_ADDR = "7 Lantern Row, Gloucester, MA 01930";

// The PDF's text runs, in drawing order (pdfkit deflates its content streams; each kerned TJ
// array is one run). An extractor that finds nothing agrees with everything, so the suite checks
// it can read the header first.
function pdfRuns(buf) {
  const raw = buf.toString("latin1"), out = [];
  const re = /stream\r?\n/g; let m;
  const streams = [];
  while ((m = re.exec(raw))) { const a = m.index + m[0].length, b = raw.indexOf("endstream", a); if (b < 0) break;
    try { streams.push(zlib.inflateSync(Buffer.from(raw.slice(a, b), "latin1")).toString("latin1")); } catch { /* an image */ } }
  const hex = h => Buffer.from(h.replace(/[^0-9a-fA-F]/g, ""), "hex").toString("latin1");
  for (const st of streams) {
    const arr = /\[((?:<[0-9a-fA-F\s]*>|\((?:\\.|[^\\()])*\)|[-\d.\s])*)\]\s*TJ/g;
    while ((m = arr.exec(st))) { let t = ""; const piece = /<([0-9a-fA-F\s]*)>|\(((?:\\.|[^\\()])*)\)/g; let p;
      while ((p = piece.exec(m[1]))) t += p[1] !== undefined ? hex(p[1]) : p[2].replace(/\\([()\\])/g, "$1");
      if (t) out.push(t); }
  }
  return out;
}
const PW = bcrypt.hashSync("loadtest1234", 10);

async function clear() {
  // RECEIPTS-1: a gift through the form also writes its ledger row, timeline and audit; every org table goes.
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 4; pass++) {
    for (const t of ["receipts", "gifts", "donors", "users", ...all]) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false)) break;
  }
}

(async () => {
  await clear();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,legal_name,ein,receipts_enabled,receipt_address)
           VALUES ($1,'Statement test org','cm2t',1,'active','team','America/New_York','Statement Test Org Inc.','12-3456789',true,$2)`, [ORG, ORG_ADDR]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Dana','admin')`, [`u_${ORG}`, ORG, `dana@${ORG}.local`, PW]);
  await q(`INSERT INTO donors (id,org_id,name,stage,address,city,state,zip,created_by,created_by_name)
           VALUES ($1,$2,'Perpetua Wexley','active','4 Quay Street','Salem','MA','01970','system:test','test')`, [DONOR, ORG]);
  const Y = 2025;
  const gift = (id, amount, date, extra = {}) => q(
    `INSERT INTO gifts (id,org_id,donor_id,amount,date,type,deductible_amount,is_sample,dispute_status,created_by,created_by_name)
     VALUES ($1,$2,$3,$4,$5,'cash',$6,$7,$8,'system:test','test')`,
    [id, ORG, DONOR, amount, date, extra.deductible ?? null, extra.sample || false, extra.dispute || null]);
  await gift("g_cm2_a", 100.10, `${Y}-02-03`);
  await gift("g_cm2_b", 0.10, `${Y}-03-01`);
  await gift("g_cm2_c", 0.20, `${Y}-03-02`);
  await gift("g_cm2_ticket", 150, `${Y}-05-10`, { deductible: 100 });
  await gift("g_cm2_partial", 80, `${Y}-06-01`, { deductible: 100 });   // refunded from $100; the stored deductible was never lowered
  await gift("g_cm2_refund", -10.01, `${Y}-07-01`);
  await gift("g_cm2_sample", 999, `${Y}-08-01`, { sample: true });
  await gift("g_cm2_lastyear", 500, `${Y - 1}-12-31`);
  await gift("g_cm2_lost", 40, `${Y}-09-01`, { dispute: "lost" });
  // HARDEN-1: a gift with no date (IMPORT-4) belongs to no tax year, so it is
  // not on the statement (the line count and both totals below hold it out).
  await gift("g_cm2_undated", 25, null);

  const tok = await login(`dana@${ORG}.local`);
  const st = await api("POST", `/donors/${DONOR}/year-end-statement`, tok, { year: Y, send: false });
  ok("the statement was issued", st.status === 200 || st.status === 201, st.text.slice(0, 300));
  const [rc] = await q(`SELECT amount::text AS amount, deductible_amount::text AS ded, snapshot FROM receipts WHERE org_id=$1 AND donor_id=$2 AND type='year_end' AND voided_at IS NULL`, [ORG, DONOR]);
  const snap = rc && (typeof rc.snapshot === "string" ? JSON.parse(rc.snapshot) : rc.snapshot);
  const c = v => Math.round(Number(v) * 100);
  ok("total deductible is $270.39 to the cent", rc && c(rc.ded) === 27039 && c(snap.totalDeductible) === 27039, { stored: rc && rc.ded, snapshot: snap && snap.totalDeductible });
  ok("total given is $320.39 to the cent", rc && c(rc.amount) === 32039 && c(snap.totalAmount) === 32039, { stored: rc && rc.amount, snapshot: snap && snap.totalAmount });
  ok("the sample gift, last year's gift and the lost dispute are not on it", snap && snap.lineItems.length === 6, snap && snap.lineItems.length);
  ok("no line claims more deductible than was given", snap && snap.lineItems.every(l => l.amount <= 0 || c(l.deductibleAmount) <= c(l.amount)), snap && snap.lineItems);

  // The same gifts, each receipted on its own: one rule, two documents.
  let receiptedCents = 0;
  for (const id of ["g_cm2_a", "g_cm2_b", "g_cm2_c", "g_cm2_ticket", "g_cm2_partial"]) {
    const r = await api("POST", `/gifts/${id}/receipt`, tok, {});
    const [g] = await q(`SELECT deductible_amount::text AS d FROM receipts WHERE org_id=$1 AND gift_id=$2 AND voided_at IS NULL`, [ORG, id]);
    ok(`${id}: its receipt was issued`, (r.status === 200 || r.status === 201) && !!g, r.text.slice(0, 200));
    receiptedCents += g ? c(g.d) : 0;
  }
  receiptedCents += -1001;   // the refund is a negative gift on the statement and has no receipt of its own
  ok("the statement equals the sum of the gifts' own receipts, to the cent", rc && c(rc.ded) === receiptedCents, { statement: rc && rc.ded, receipts: receiptedCents / 100 });

  // HARDEN-1 · THE UNDATED GIFT. A tax receipt names the day a gift was given,
  // so the undated one gets none until its date is set (red before: a receipt
  // was issued printing a blank gift date). And a thank-you letter for it
  // beside a dated gift is not printed with half a date (red before: "received
  // on February 3, 2025 and ."); the batch says why instead.
  const ur = await api("POST", "/gifts/g_cm2_undated/receipt", tok, {});
  const [urRow] = await q(`SELECT COUNT(*)::int AS n FROM receipts WHERE org_id=$1 AND gift_id='g_cm2_undated'`, [ORG]);
  ok("undated: no tax receipt is issued, and the refusal says to set the date", ur.status === 409 && ur.body?.error === "undated_gift"
     && /no date/.test(ur.body?.message || "") && urRow.n === 0, { s: ur.status, b: ur.body, rows: urRow.n });
  const lp = await api("POST", "/acknowledgments/letters/preview", tok, { giftIds: ["g_cm2_a", "g_cm2_undated"] });
  const lpText = JSON.stringify(lp.body || {});
  ok("undated: a letter for a dated and an undated gift is not printed, and the batch says a gift has no date",
     lp.status === 200 && (lp.body?.letters || []).length === 0 && /a gift here has no date/.test(lp.body?.skipped?.[0]?.why || "")
       && !/ and \./.test(lpText), lp.body);
  const ld = await api("POST", "/acknowledgments/letters/preview", tok, { giftIds: ["g_cm2_a"] });
  ok("undated: the dated gift alone still prints, with its day", ld.status === 200 && /received on February 3, 2025\./.test(ld.body?.letters?.[0]?.text || ""), ld.body);

  // ── RECEIPTS-1 ────────────────────────────────────────────────────────────
  await q(`INSERT INTO donors (id,org_id,name,stage,created_by,created_by_name) VALUES ($1,$2,'Ottoline Brack','active','system:test','test')`, [BARE, ORG]);
  const P = Y - 1;   // RECEIPTS-1's gifts are in the year before, off the statement above
  const rawPdf = async gid => {
    const [row] = await q(`SELECT id, receipt_number, pdf_data, snapshot FROM receipts WHERE org_id=$1 AND gift_id=$2 AND voided_at IS NULL`, [ORG, gid]);
    return row ? { ...row, runs: pdfRuns(Buffer.from(row.pdf_data, "base64")), snap: typeof row.snapshot === "string" ? JSON.parse(row.snapshot) : row.snapshot } : null;
  };
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ('g_cm2_bare',$1,$2,60,$3,'cash','system:test','test')`, [ORG, BARE, `${P}-04-01`]);
  await api("POST", "/gifts/g_cm2_bare/receipt", tok, { send: false });
  const bare = await rawPdf("g_cm2_bare");
  ok("4. the reader reads the receipt: its header names the org and the receipt number",
     !!bare && bare.runs.includes("Statement Test Org Inc.") && bare.runs.some(t => t === `Receipt #${bare.receipt_number}`), bare && bare.runs);
  const nameAt = bare ? bare.runs.indexOf("Ottoline Brack") : -1;
  ok("4. no address on file: nothing under the donor's name but the gift (no org address in the donor block)",
     nameAt > 0 && bare.runs[nameAt + 1] === "GIFT DATE" && bare.snap.donorAddress === "", bare && { after: bare.runs.slice(nameAt, nameAt + 3), snap: bare.snap.donorAddress });
  ok("4. the org's address is in the header band, on the EIN line, and nowhere else",
     !!bare && bare.runs.filter(t => t.includes("7 Lantern Row")).length === 1 && bare.runs.some(t => t.startsWith("EIN: ") && t.includes(ORG_ADDR))
       && bare.runs.findIndex(t => t.includes("7 Lantern Row")) < nameAt, bare && bare.runs.filter(t => /Lantern|EIN/.test(t)));
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ('g_cm2_addr',$1,$2,70,$3,'cash','system:test','test')`, [ORG, DONOR, `${P}-04-02`]);
  await api("POST", "/gifts/g_cm2_addr/receipt", tok, { send: false });
  await q(`UPDATE donors SET address='99 Moved Lane', city='Boston', zip='02108' WHERE id=$1`, [DONOR]);   // she moves after it was issued
  const withAddr = await rawPdf("g_cm2_addr");
  const wAt = withAddr ? withAddr.runs.indexOf("Perpetua Wexley") : -1;
  ok("4. a donor with an address on file: hers under her name, frozen at issue (a later move changes nothing)",
     wAt > 0 && withAddr.runs.slice(wAt + 1, wAt + 3).join(" ").includes("4 Quay Street") && withAddr.snap.donorAddress === "4 Quay Street\nSalem, MA 01970"
       && !withAddr.runs.some(t => t.includes("Moved Lane")), withAddr && { runs: withAddr.runs.slice(wAt, wAt + 3), snap: withAddr.snap.donorAddress });

  // In-kind: described, never valued.
  const refused = await api("POST", `/donors/${DONOR}/gifts`, tok, { amount: 300, date: `${P}-05-01`, type: "in_kind", payment_method: "In-kind" });
  ok("5. a new in-kind gift with no description is refused, saying what it needs", refused.status === 400 && /Description of property/.test(refused.body?.error || ""), refused.body);
  const ik = await api("POST", `/donors/${DONOR}/gifts`, tok, { amount: 300, date: `${P}-05-01`, type: "in_kind", payment_method: "In-kind",
    property_description: "Two cartons of watercolor paper and brushes", idempotencyKey: "cm2t-inkind-1" });
  const ikId = ik.body?.gift?.id || ik.body?.id;
  const ikr = await api("POST", `/gifts/${ikId}/receipt`, tok, { send: false });
  const inkind = await rawPdf(ikId);
  const ikText = inkind ? inkind.runs.join(" | ") : "";
  ok("5. an in-kind receipt: the description of property, the date received, the goods-or-services sentence and Steward's no-value line",
     ikr.status === 201 && /DESCRIPTION OF PROPERTY/.test(ikText) && ikText.includes("Two cartons of watercolor paper and brushes") && /DATE RECEIVED/.test(ikText)
       && ikText.includes("No goods or services were provided") && ikText.includes("Steward does not state a value for donated property. The donor determines its fair market value."), { s: ikr.status, ikText });
  ok("5. an in-kind receipt has no AMOUNT box and no dollar figure; the value stays on the gift",
     !!inkind && !inkind.runs.includes("AMOUNT") && !/\$\s?300|300\.00/.test(ikText) && inkind.snap.amount == null, { ikText, amount: inkind && inkind.snap.amount });
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,created_by,created_by_name) VALUES ('g_cm2_ik_old',$1,$2,45,$3,'in_kind','system:test','test')`, [ORG, DONOR, `${P}-05-02`]);
  const oldIk = await api("POST", "/gifts/g_cm2_ik_old/receipt", tok, { send: false });
  ok("5. an older in-kind gift with no description gets no receipt until it has one, and says so",
     oldIk.status === 409 && oldIk.body?.error === "no_property_description" && /Description of property/.test(oldIk.body?.message || ""), oldIk.body);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,stock_shares,stock_ticker,created_by,created_by_name) VALUES ('g_cm2_stock',$1,$2,5000,$3,'stock',40,'VTI','system:test','test')`, [ORG, DONOR, `${P}-05-03`]);
  await api("POST", "/gifts/g_cm2_stock/receipt", tok, { send: false });
  const stock = await rawPdf("g_cm2_stock");
  ok("5. a stock receipt names its shares and ticker, with no AMOUNT", !!stock && stock.runs.includes("40 shares of VTI") && !stock.runs.includes("AMOUNT"), stock && stock.runs);

  // Reissue: same number with a suffix; the old one voided with a note naming it.
  const re1 = await api("POST", `/receipts/${bare.id}/reissue`, tok, {});
  const re2 = re1.body?.receipt ? await api("POST", `/receipts/${re1.body.receipt.id}/reissue`, tok, {}) : { status: 0 };
  const [oldRow] = await q(`SELECT voided_at, void_reason FROM receipts WHERE id=$1`, [bare.id]);
  const [{ n: activeN }] = await q(`SELECT COUNT(*)::int AS n FROM receipts WHERE org_id=$1 AND gift_id='g_cm2_bare' AND voided_at IS NULL`, [ORG]);
  ok("6. Reissue: the same number with -R1, then -R2; the old one voided with a note naming its successor; one active receipt",
     re1.status === 201 && re1.body.receipt.receipt_number === `${bare.receipt_number}-R1` && re2.status === 201 && re2.body.receipt.receipt_number === `${bare.receipt_number}-R2`
       && oldRow.voided_at && oldRow.void_reason.includes(`#${bare.receipt_number}-R1`) && activeN === 1, { re1: re1.body, re2: re2.body, oldRow, activeN });
  // A receipt as issued before this build: the org's address, and no donor block of its own.
  await q(`INSERT INTO receipts (id,org_id,donor_id,gift_id,type,receipt_number,amount,deductible_amount,snapshot,created_by,created_by_name)
           VALUES ('rcpt_cm2_old',$1,$2,NULL,'gift','2024-00001',0.10,0.10,$3,'system:test','test')`,
    [ORG, BARE, JSON.stringify({ type: "gift", donorName: "Ottoline Brack", orgAddress: ORG_ADDR, amount: 0.1 })]);
  const list = await api("GET", "/receipts?limit=1000", tok);
  const flag = id => (list.body?.receipts || []).find(r => r.id === id)?.org_address_in_donor_block;
  ok("6. the list flags a receipt issued with the org's address in the donor block, and not one issued now",
     flag("rcpt_cm2_old") === true && flag(re2.body?.receipt?.id) === false, { old: flag("rcpt_cm2_old"), now: flag(re2.body?.receipt?.id) });

  await clear();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await clear(); await closeDb(); } catch {} process.exit(1); });
