// BUILD-98 (switch) Part 2 — ACKNOWLEDGMENTS AND LETTERS THAT PRINT.
//
// What a Bloomerang user does on a Monday: open the gifts nobody has thanked,
// print a letter for each, fold them into window envelopes, and mark them
// sent. Each assertion below is a way that goes wrong on paper:
//   §1  the backlog is the org's own N days, and only gifts nobody thanked;
//   §2  twenty gifts are ONE PDF of TWENTY pages, with the right name and
//       amount merged into each, and the address where the window is;
//   §3  a letter that cannot be finished is left out and named, never printed
//       blank — no address, a deceased donor, a field with nothing in it;
//   §4  a template with a field Steward does not know is refused at save;
//   §5  marking them sent stamps who, when and how, once;
//   §6  labels are one per donor; a year-end statement foots to the cent;
//   §7  another org's gifts are not found.
//
// Standard scratch stack (tests/README.md).

const bcrypt = require("bcryptjs");
const { BASE, ok, summary, login, api, q, closeDb, civilToday } = require("./helpers");

const ORG = "org_b98l", OTHER = "org_b98l2";
const ME = "b98l@example.org", THEM = "b98l-other@example.org";
const PW = "loadtest1234";

async function reset() {
  for (const o of [ORG, OTHER]) {
    for (const t of ["receipts", "ack_letter_templates", "thank_you_drafts", "fin_transactions", "interactions", "threads",
                     "gifts", "donors", "users", "budgets", "accounts", "fin_funds"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}
const cents = v => Math.round(Number(v) * 100);
async function pdfPost(path, token, body) {
  const r = await fetch(BASE + path, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, headers: r.headers, buf };
}
// pdfkit writes each page's dictionary uncompressed; "/Type /Page" not
// followed by "s" is one page.
const pageCount = buf => (buf.toString("latin1").match(/\/Type \/Page(?!s)/g) || []).length;

(async () => {
  console.log("build98-letters");
  await reset();
  for (const [id, name] of [[ORG, "Barn Buddies"], [OTHER, "Somebody Else"]])
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,receipt_address,legal_name,ein,receipt_signature_name,receipt_signature_title,receipts_enabled,timezone,timezone_confirmed_at)
             VALUES ($1,$2,$3,1,'team','active','12 Barn Lane, Lexington, KY 40507',$2,'12-3456789','Allie Barnett','Executive Director',true,'America/New_York',NOW())`,
      [id, name, id.replace(/_/g, "-")]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_b98l',$1,$2,$3,'Allie Barnett','admin')`, [ORG, ME, bcrypt.hashSync(PW, 4)]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_b98l2',$1,$2,$3,'Other','admin')`, [OTHER, THEM, bcrypt.hashSync(PW, 4)]);
  const tok = await login(ME), tok2 = await login(THEM);

  // Twenty donors with postal addresses, one gift each, three weeks ago.
  const giftIds = [];
  for (let i = 1; i <= 20; i++) {
    const d = `d98l_${i}`;
    await q(`INSERT INTO donors (id,org_id,name,email,address,city,state,zip,stage,total_giving,gift_count)
             VALUES ($1,$2,$3,$4,$5,'Lexington','KY','40507','cultivate',0,0)`,
      [d, ORG, `Person${i} Surname${i}`, `${d}@example.org`, `${100 + i} Main St`]);
    const g = `g98l_${i}`;
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type) VALUES ($1,$2,$3,$4,$5,'cash')`,
      [g, ORG, d, 10 * i + 0.25, "2026-08-2" + (i % 9)]);
    giftIds.push(g);
  }
  // One who cannot be written to: no address.
  await q(`INSERT INTO donors (id,org_id,name,stage,total_giving) VALUES ('d98l_noaddr',$1,'Nobody Addressed','cultivate',0)`, [ORG]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type) VALUES ('g98l_noaddr',$1,'d98l_noaddr',50,'2026-08-20','cash')`, [ORG]);
  // One thanked already, and one from yesterday (inside the org's 7 days).
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,acknowledgement_sent,acknowledgement_sent_at) VALUES ('g98l_done',$1,'d98l_1',5,'2026-08-10','cash',true,NOW())`, [ORG]);
  // The ORG's civil today (America/New_York, as the org is set up above) —
  // never the UTC date, which is already tomorrow on a US evening and would
  // make "today's gift" a future one (the BUILD-84 calendar class).
  const today = civilToday();
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type) VALUES ('g98l_new',$1,'d98l_2',7,$2,'cash')`, [ORG, today]);

  // ── §1 the backlog ────────────────────────────────────────────────────────
  const b = await api("GET", "/acknowledgments/backlog", tok);
  const bIds = new Set((b.body.gifts || []).map(g => g.id));
  ok("§1 the backlog holds the twenty and the unaddressed one", giftIds.every(id => bIds.has(id)) && bIds.has("g98l_noaddr"), b.body.gifts?.length);
  ok("§1 a gift already thanked is not in it", !bIds.has("g98l_done"));
  ok("§1 a gift inside the org's seven days is not in it yet", !bIds.has("g98l_new"));
  ok("§1 the count carries its sentence", /nobody has marked as thanked/.test(b.body.sentence || ""));
  await api("PUT", "/acknowledgments/settings", tok, { backlogDays: 0 });
  const b0 = await api("GET", "/acknowledgments/backlog", tok);
  ok("§1 N is the org's own: at zero days, today's gift is in the backlog", (b0.body.gifts || []).some(g => g.id === "g98l_new"));
  await api("PUT", "/acknowledgments/settings", tok, { backlogDays: 7 });

  // ── §2 twenty letters, one PDF, twenty pages ─────────────────────────────
  const prev = await api("POST", "/acknowledgments/letters/preview", tok, { giftIds });
  ok("§2 twenty letters", prev.body.letters?.length === 20, prev.body);
  const l7 = (prev.body.letters || []).find(l => l.donorId === "d98l_7");
  ok("§2 the salutation is their first name", l7 && l7.text.startsWith("Dear Person7,"));
  ok("§2 the amount is theirs to the cent", l7 && l7.text.includes("$70.25"));
  ok("§2 the signer is the org's", l7 && l7.text.includes("Allie Barnett") && l7.text.includes("Executive Director"));
  ok("§2 the address block is theirs", l7 && l7.address.join("|") === "Person7 Surname7|107 Main St|Lexington, KY 40507");
  ok("§2 no field was left showing its braces", (prev.body.letters || []).every(l => !l.text.includes("{{")));
  const pdf = await pdfPost("/acknowledgments/letters/pdf", tok, { giftIds });
  ok("§2 the PDF is a PDF", pdf.status === 200 && pdf.buf.slice(0, 4).toString() === "%PDF");
  ok("§2 ONE PDF of TWENTY pages", pageCount(pdf.buf) === 20, pageCount(pdf.buf));
  ok("§2 it says how many it printed", pdf.headers.get("x-letters-printed") === "20");
  const [still] = await q(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1 AND id = ANY($2) AND acknowledgement_sent_at IS NOT NULL`, [ORG, giftIds]);
  ok("§2 printing changes nothing — marking sent is its own step", still.n === 0);

  // ── §3 what cannot be printed is named ───────────────────────────────────
  const p3 = await api("POST", "/acknowledgments/letters/preview", tok, { giftIds: [...giftIds, "g98l_noaddr"] });
  const sk = (p3.body.skipped || []).find(s => s.donorId === "d98l_noaddr");
  ok("§3 a donor with no address is left out, with the reason", sk && /no postal address/.test(sk.why));
  await q(`UPDATE donors SET deceased=true WHERE id='d98l_20'`);
  const p3b = await api("POST", "/acknowledgments/letters/preview", tok, { giftIds });
  ok("§3 a deceased donor gets no thank-you letter", (p3b.body.skipped || []).some(s => s.donorId === "d98l_20" && /deceased/.test(s.why)));
  await q(`UPDATE donors SET deceased=false WHERE id='d98l_20'`);
  const fundTpl = await api("POST", "/acknowledgments/templates", tok, { name: "Fund letter", body: "Dear {{salutation}},\n\nThank you for your gift to the {{fund}} fund.\n\n{{signer}}" });
  const p3c = await api("POST", "/acknowledgments/letters/preview", tok, { giftIds: giftIds.slice(0, 2), templateId: fundTpl.body.id });
  ok("§3 a letter needing a fund the gift does not have is NOT printed blank",
     (p3c.body.letters || []).length === 0 && (p3c.body.skipped || []).every(s => /\{\{fund\}\}/.test(s.why)), p3c.body);

  // An org that never set a signer in Tax Receipts still gets letters: they are
  // signed by the person printing them, never left unsigned and never refused.
  await q(`UPDATE orgs SET receipt_signature_name=NULL, receipt_signature_title=NULL WHERE id=$1`, [ORG]);
  const p3d = await api("POST", "/acknowledgments/letters/preview", tok, { giftIds: giftIds.slice(0, 1) });
  ok("§3 with no signer on file, the letter is signed by the person printing it",
     p3d.body.letters?.length === 1 && p3d.body.letters[0].text.trim().endsWith("Allie Barnett") && !p3d.body.letters[0].text.includes("Executive Director"), p3d.body);
  await q(`UPDATE orgs SET receipt_signature_name='Allie Barnett', receipt_signature_title='Executive Director' WHERE id=$1`, [ORG]);

  // ── §4 an unknown field is refused at save ───────────────────────────────
  const bad = await api("POST", "/acknowledgments/templates", tok, { name: "Typo", body: "Dear {{frist}},\n\nThank you so much for everything you do." });
  ok("§4 {{frist}} is refused, by name", bad.status === 400 && /\{\{frist\}\}/.test(bad.body.error || ""));

  // ── §5 marking sent ──────────────────────────────────────────────────────
  const m = await api("POST", "/acknowledgments/mark", tok, { giftIds, via: "letter" });
  ok("§5 all twenty are marked", m.body.marked === 20);
  const stamped = await q(`SELECT acknowledged_by_name, acknowledged_via, acknowledgement_sent_at FROM gifts WHERE org_id=$1 AND id = ANY($2)`, [ORG, giftIds]);
  ok("§5 each carries who, when and how", stamped.every(r => r.acknowledged_by_name === "Allie Barnett" && r.acknowledged_via === "letter" && r.acknowledgement_sent_at));
  const firstAt = stamped[0].acknowledgement_sent_at;
  await api("POST", "/acknowledgments/mark", tok, { giftIds: [giftIds[0]], via: "phone" });
  const [again] = await q(`SELECT acknowledged_via, acknowledgement_sent_at FROM gifts WHERE id=$1`, [giftIds[0]]);
  ok("§5 marking twice keeps the first stamp", again.acknowledged_via === "letter" && String(again.acknowledgement_sent_at) === String(firstAt));
  const b2 = await api("GET", "/acknowledgments/backlog", tok);
  ok("§5 and they leave the backlog", !(b2.body.gifts || []).some(g => giftIds.includes(g.id)));
  const badVia = await api("POST", "/acknowledgments/mark", tok, { giftIds, via: "carrier pigeon" });
  ok("§5 an unknown 'how' is refused", badVia.status === 400);

  // ── §6 labels and the year-end statement ─────────────────────────────────
  const lab = await pdfPost("/acknowledgments/labels/pdf", tok, { giftIds });
  ok("§6 twenty labels on ONE sheet of thirty", lab.status === 200 && lab.headers.get("x-labels") === "20" && pageCount(lab.buf) === 1);
  const ye = await api("POST", "/donors/d98l_7/year-end-statement", tok, { year: 2026, send: false });
  const [yeRow] = await q(`SELECT amount FROM receipts WHERE org_id=$1 AND donor_id='d98l_7' AND type='year_end' AND voided_at IS NULL`, [ORG]);
  const [sum] = await q(`SELECT COALESCE(SUM(amount),0) AS t FROM gifts WHERE org_id=$1 AND donor_id='d98l_7' AND LEFT(date,4)='2026'`, [ORG]);
  ok("§6 a year-end statement is issued", (ye.status === 200 || ye.status === 201) && !!yeRow, ye.body);
  ok("§6 and foots to their 2026 gifts in cents", yeRow && cents(yeRow.amount) === cents(sum.t), { statement: yeRow?.amount, gifts: sum.t });

  // ── §7 the wall ──────────────────────────────────────────────────────────
  const w = await api("POST", "/acknowledgments/letters/preview", tok2, { giftIds });
  ok("§7 another org finds none of these gifts", (w.body.letters || []).length === 0 && w.body.giftsNotFound === 20);
  const wm = await api("POST", "/acknowledgments/mark", tok2, { giftIds: ["g98l_noaddr"], via: "letter" });
  const [na] = await q(`SELECT acknowledgement_sent_at FROM gifts WHERE id='g98l_noaddr'`);
  ok("§7 and cannot mark them thanked", wm.body.marked === 0 && !na.acknowledgement_sent_at);
  const wt = await api("PUT", `/acknowledgments/templates/${fundTpl.body.id}`, tok2, { name: "x", body: "Dear {{salutation}}, thank you so much." });
  ok("§7 or edit this org's template", wt.status === 404);

  await reset();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
