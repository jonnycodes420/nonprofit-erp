// tests/letters1-word-letters.test.js · LETTERS-1. The build's one new suite: it guards donor
// data (who gets a tax letter, and the deductible amount printed on it).
//
// §1 HER WORD LETTER. A .docx with a letterhead and three fields written three ways
//    ([First Name], <<Gift Amount>>, Word's «EventName») is read: the three are offered with the
//    right Steward field, the text box that cannot carry over is named, an unknown {{token}} is
//    refused at save, and the saved template's PDF carries all three for each donor, under her
//    letterhead, with the signature image on the page.
// §2 LETTERS FOR AN EVENT. Exactly the people who gave to the event in the range get a letter;
//    do not contact, no address, a refund in full, another event and a gift outside the range
//    are left out, each with its reason; the deductible amount is paid less fair market value,
//    to the cent, on the screen and in the PDF; the Word file holds the same people.
//    Downloading marks nothing; "Mark these as sent" records the acknowledgment and not a thank-you.
// §3 TWO CAMPAIGNS OF ONE NAME MERGE. The gifts move to the one kept, the picker lists it once,
//    the surfaces agree, and Undo puts both back.
//
// PROVEN ABLE TO FAIL: see the PR. Tests set their own clock (tests/clock.js). Sends nothing.
"use strict";
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const JSZip = require("jszip");
const { ok, summary, login, api, q, closeDb, BASE } = require("./helpers");
const { civilDay, dayOffset } = require("./clock");
const { assertSurfacesAgree } = require("./lib/surfacesAgree");
const { letterDocx, bluePng } = require("./lib/letterDocx");

const ORG = "org_letters1";
const PASSWORD = "loadtest1234";
const EMAIL = `${ORG}@test.local`;
const TODAY = civilDay(undefined, "America/New_York");
const ACT = ["system:test/letters1", "LETTERS-1 test"];
const one = async (sql, a) => (await q(sql, a))[0] || {};

async function freshOrg() {
  const all = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.t);
  for (let pass = 0; pass < 5; pass++) {
    for (const t of all) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [ORG]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).then(() => true).catch(() => false)) break;
  }
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,timezone_confirmed_at,legal_name,ein,receipt_address,receipts_enabled,receipt_signature_name,receipt_signature_title)
           VALUES ($1,'Riverbend Literacy Circle','letters1-riverbend',1,'active','team','America/New_York',NOW(),'Riverbend Literacy Circle Inc','83-2207719','12 Mill Street, Lexington, KY 40507',true,'Wren Hollister','Executive Director')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,'Tamsin Oakridge','admin')`, ["u_" + ORG, ORG, EMAIL, bcrypt.hashSync(PASSWORD, 4)]);
  return login(EMAIL, PASSWORD);
}
async function person(id, name, extra = {}) {
  const addr = extra.noAddress ? [null, null, null, null] : ["7 Fixture Row", "Lexington", "KY", "40508"];
  await q(`INSERT INTO donors (id,org_id,name,email,kind,person_types,address,city,state,zip,do_not_contact,created_by,created_by_name)
           VALUES ($1,$2,$3,$4,'individual','["donor"]'::jsonb,$5,$6,$7,$8,$9,$10,$11)`,
    [id, ORG, name, `${id}@letters1.example.org`, ...addr, !!extra.dnc, ...ACT]);
  return id;
}
const gift = async (tok, donor, body) => {
  const r = await api("POST", `/donors/${donor}/gifts`, tok, { idempotencyKey: crypto.randomUUID(), date: TODAY, type: "cash", payment_method: "check", ...body });
  return r.body && (r.body.gift ? r.body.gift.id : r.body.id);
};
async function download(path, tok, body) {
  const r = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok }, body: JSON.stringify(body) });
  return { status: r.status, headers: r.headers, buf: Buffer.from(await r.arrayBuffer()) };
}
// The words on each page of a PDF, read by pdf.js (pdfkit compresses its pages).
async function pdfPages(buf) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false, disableFontFace: true, verbosity: 0 }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const tc = await p.getTextContent();
    const ops = await p.getOperatorList();
    pages.push({ text: tc.items.map(t => t.str).join(" ").replace(/\s+/g, " "), images: ops.fnArray.filter(f => f === pdfjs.OPS.paintImageXObject).length });
  }
  return pages;
}
async function docxText(buf) {
  const z = await JSZip.loadAsync(buf);
  const x = await z.file("word/document.xml").async("string");
  // The words are Word's text runs (<w:t>), read one by one; nothing is stripped.
  const words = [...x.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map(m => m[1]).join(" ");
  return { text: words.replace(/\s+/g, " "), pages: (x.match(/<w:sectPr\b/g) || []).length };
}

(async () => {
  console.log("letters1-word-letters (LETTERS-1)");
  const tok = await freshOrg();
  const sig = "data:image/png;base64," + bluePng(8, 3).toString("base64");
  const sigSet = await api("PUT", "/letters/signatures/org", tok, { image: sig });
  ok("§1 the receipt signer's signature is kept", sigSet.status === 200, sigSet);
  const badSig = await api("PUT", "/letters/signatures/org", tok, { image: "data:text/html;base64,PGI+" });
  ok("§1 a signature that is not a PNG or JPEG is refused", badSig.status === 400, badSig);

  // ── §3 two campaigns of one name merge (first: the truth check does not
  // read a refund in full, which §2's fixture has) ─────────────────────────
  const c1 = await api("POST", "/gift-attribution/campaign", tok, { name: "Annual Fund" });
  const keep = c1.body && (c1.body.id || (c1.body.row || {}).id);
  await q(`INSERT INTO campaigns (id,org_id,name,type,subject,body,status,segment,created_at) VALUES ('cmp_letters1_dup',$1,'annual  fund','appeal','','','draft','{}',NOW() + interval '1 minute')`, [ORG]);
  // main-fix: its own id prefix; "d_l1_hal" was live1-alive's too, and donors.id is global, so whichever ran second in a shard failed.
  const HAL = await person("d_lt1_hal", "Hal Penrose"), IRIS = await person("d_lt1_iris", "Iris Vale");
  const gK = await gift(tok, HAL, { amount: 20, campaignId: keep });
  const gD = await gift(tok, IRIS, { amount: 30, campaignId: "cmp_letters1_dup" });
  const pick1 = ((await api("GET", "/gift-attribution/campaign?q=annual", tok)).body || {});
  const rows1 = (pick1.rows || pick1.results || pick1.options || []).filter(r => /annual\s*fund/i.test(r.name));
  const mg = await api("POST", "/campaign-tidy/merge", tok, { keepId: keep, mergeIds: ["cmp_letters1_dup"] });
  const moved = await one(`SELECT campaign_id FROM gifts WHERE id=$1`, [gD]);
  const pick2 = ((await api("GET", "/gift-attribution/campaign?q=annual", tok)).body || {});
  const rows2 = (pick2.rows || pick2.results || pick2.options || []).filter(r => /annual\s*fund/i.test(r.name));
  ok("§3 two campaigns of one name merge: the gifts move to the one kept, and the picker lists it once",
    rows1.length === 2 && mg.status === 200 && moved.campaign_id === keep && rows2.length === 1 && rows2[0].id === keep, { rows1, mg: mg.body, moved, rows2 });
  await assertSurfacesAgree(ORG, { token: tok, label: "after the campaign merge" });
  const undo = mg.body && mg.body.undo ? await api("POST", mg.body.undo.path || mg.body.undo, tok, mg.body.undo.body || {}) : { status: 0 };
  const back = await one(`SELECT campaign_id FROM gifts WHERE id=$1`, [gD]);
  const dupBack = await one(`SELECT id FROM campaigns WHERE id='cmp_letters1_dup' AND org_id=$1`, [ORG]);
  ok("§3 Undo puts both campaigns and the gift back", undo.status === 200 && back.campaign_id === "cmp_letters1_dup" && dupBack.id === "cmp_letters1_dup", { undo: undo.status, back, dupBack });
  await assertSurfacesAgree(ORG, { token: tok, label: "after Undo of the merge" });
  ok("§3 the kept campaign's gift never moved", (await one(`SELECT campaign_id FROM gifts WHERE id=$1`, [gK])).campaign_id === keep);


  // ── §2's fixture first: one event, people around its edges ──────────────
  const IN1 = dayOffset(-20), IN2 = dayOffset(-10), OUT = dayOffset(-90);
  const FROM = dayOffset(-30);
  const ev = await one(`INSERT INTO events (id,org_id,name,event_type,date) VALUES ('ev_letters1_gala',$1,'June Riverbend Gala','gala',$2) RETURNING id`, [ORG, IN1]);
  await q(`INSERT INTO events (id,org_id,name,event_type,date) VALUES ('ev_letters1_other',$1,'Autumn Book Fair','other',$2)`, [ORG, IN1]);
  const EV = ev.id || "ev_letters1_gala";
  const P = {
    ada: await person("d_lt1_ada", "Ada Quillfeather"),            // a ticket: $150 paid, $40 dinner → $110.00 deductible
    bram: await person("d_lt1_bram", "Bram Ellery", { dnc: true }),  // do not contact
    cleo: await person("d_lt1_cleo", "Cleo Marchbanks"),           // gave outside the range
    dov: await person("d_lt1_dov", "Dov Ashgrove"),                 // gave to the other event
    esme: await person("d_lt1_esme", "Esme Tolliver"),              // refunded in full
    fitz: await person("d_lt1_fitz", "Fitz Harrowgate", { noAddress: true }),
    gwen: await person("d_lt1_gwen", "Gwen Larkhill"),              // two gifts: $33.33 + $66.67, nothing received
  };
  const G = {};
  G.ada = await gift(tok, P.ada, { amount: 150, date: IN1, eventId: EV });
  await q(`UPDATE gifts SET quid_pro_quo_value=40, quid_pro_quo_desc='Gala dinner' WHERE id=$1`, [G.ada]);
  G.bram = await gift(tok, P.bram, { amount: 75, date: IN1, eventId: EV });
  G.cleo = await gift(tok, P.cleo, { amount: 200, date: OUT, eventId: EV });
  G.dov = await gift(tok, P.dov, { amount: 60, date: IN1, eventId: "ev_letters1_other" });
  G.esme = await gift(tok, P.esme, { amount: 90, date: IN1, eventId: EV });
  const rf = await api("POST", `/gifts/${G.esme}/refund`, tok, { amount: 90, confirmAmount: 90, date: IN2, reason: "Could not attend" });
  G.fitz = await gift(tok, P.fitz, { amount: 45, date: IN2, eventId: EV });
  G.gwen1 = await gift(tok, P.gwen, { amount: 33.33, date: IN1, eventId: EV });
  G.gwen2 = await gift(tok, P.gwen, { amount: 66.67, date: IN2, eventId: EV });
  const evOk = await one(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=$1 AND event_id=$2`, [ORG, EV]);
  const esme = await one(`SELECT refunded_in_full AS r FROM gifts WHERE id=$1`, [G.esme]);
  ok("fixture: the event's gifts carry the event, and Esme's is refunded in full", evOk.n >= 7 && esme.r === true, { evOk, esme, rf: rf.status });

  // ── §1 her Word letter ───────────────────────────────────────────────────
  const docx = await letterDocx();
  const up = await api("POST", "/acknowledgments/templates/docx", tok, { file: docx.toString("base64") });
  const cands = Object.fromEntries(((up.body || {}).candidates || []).map(c => [c.raw, c.suggest]));
  ok("§1 the three fields written three ways are offered with the right Steward field",
    up.status === 200 && cands["[First Name]"] === "first_name" && cands["<<Gift Amount>>"] === "gift_amount" && cands["«EventName»"] === "event_name", { status: up.status, cands });
  const notes = ((up.body || {}).notCarried || []).join(" | ");
  ok("§1 what did not carry over is said plainly (the text box, the font)", /text box/i.test(notes) && /Join us next June/.test(notes) && /Garamond/.test(notes), notes);
  const head = ((up.body || {}).layout || {}).header || [];
  ok("§1 the letterhead keeps its logo, and the org's name keeps its colour and size",
    head.some(b => b.type === "image" && /^data:image\/png/.test(b.src)) && head.some(b => b.type === "paragraph" && b.runs.some(r => /Riverbend Literacy Circle/.test(r.text) && r.color === "#0D5C3A" && r.size === 16 && r.bold)), head.map(b => b.type));
  const fields = { "[First Name]": "first_name", "<<Gift Amount>>": "gift_amount", "«EventName»": "event_name" };
  const unknown = await api("POST", "/acknowledgments/templates", tok, { name: "Gala tax letter", layout: up.body.layout, fields: { ...fields, "[First Name]": "frist_name" } });
  ok("§1 an unknown field is refused at save, by name", unknown.status === 400 && /frist_name/.test(unknown.body.error || ""), unknown.body);
  const saved = await api("POST", "/acknowledgments/templates", tok, { name: "Gala tax letter", layout: up.body.layout, fields, sourceName: "gala-letter.docx", notCarried: up.body.notCarried });
  const TPL = saved.body && saved.body.id;
  const tpls = ((await api("GET", "/acknowledgments/templates", tok)).body || {}).templates || [];
  const mine = tpls.find(t => t.id === TPL) || {};
  ok("§1 the template is saved from Word, its fields in place", saved.status === 201 && mine.from_word === true && /\{\{first_name\}\}/.test(mine.body) && /\{\{event_name\}\}/.test(mine.body) && /\{\{gift_amount\}\}/.test(mine.body), { saved: saved.status, mine });

  // ── §2 who gets a letter ─────────────────────────────────────────────────
  const choice = { eventId: EV, from: FROM, to: TODAY, templateId: TPL };
  const pv = await api("POST", "/letters/giving/preview", tok, choice);
  const names = ((pv.body || {}).letters || []).map(l => l.name).sort();
  ok("§2 exactly the people who gave to the event in the range get a letter", pv.status === 200 && JSON.stringify(names) === JSON.stringify(["Ada Quillfeather", "Gwen Larkhill"]), { status: pv.status, names, body: pv.status === 200 ? undefined : pv.body });
  const why = Object.fromEntries(((pv.body || {}).skipped || []).map(s => [s.name, s.why]));
  ok("§2 do not contact and no address are left out, each with its reason",
    /do not contact/.test(why["Bram Ellery"] || "") && /no postal address/.test(why["Fitz Harrowgate"] || "") && Object.keys(why).length === 2, why);
  const by = Object.fromEntries(((pv.body || {}).letters || []).map(l => [l.name, l]));
  ok("§2 the deductible amount is paid less fair market value, to the cent",
    by["Ada Quillfeather"] && by["Ada Quillfeather"].total === 150 && by["Ada Quillfeather"].deductible === 110
      && by["Gwen Larkhill"] && by["Gwen Larkhill"].total === 100 && by["Gwen Larkhill"].deductible === 100 && pv.body.deductible === 210 && pv.body.total === 250,
    { ada: by["Ada Quillfeather"], gwen: by["Gwen Larkhill"], total: pv.body && pv.body.total, deductible: pv.body && pv.body.deductible });
  ok("§2 the count carries its sentence", /^2 letters, one for each person who gave to June Riverbend Gala/.test(pv.body.sentence || "") && /3 gifts of \$250\.00/.test(pv.body.sentence || ""), pv.body.sentence);

  // §1 + §2: the PDF of her letter, for each donor
  const pdf = await download("/letters/giving/pdf", tok, choice);
  const pages = pdf.status === 200 ? await pdfPages(pdf.buf) : [];
  const pageOf = n => pages.find(p => p.text.includes(n)) || { text: "", images: 0 };
  const ada = pageOf("Dear Ada,"), gwen = pageOf("Dear Gwen,");
  ok("§1 the PDF is one page per letter", pdf.status === 200 && pages.length === 2 && pdf.headers.get("x-letters-printed") === "2", { status: pdf.status, pages: pages.length });
  ok("§1 every letter carries all three fields for its own donor, under her letterhead",
    /Dear Ada,/.test(ada.text) && /\$150\.00/.test(ada.text) && /June Riverbend Gala/.test(ada.text)
      && /Dear Gwen,/.test(gwen.text) && /\$100\.00/.test(gwen.text) && /June Riverbend Gala/.test(gwen.text)
      && /Riverbend Literacy Circle/.test(ada.text) && !/\[First Name\]|<<|«/.test(ada.text + gwen.text), { ada: ada.text.slice(0, 400), gwen: gwen.text.slice(0, 400) });
  ok("§2 the PDF prints the deductible amount to the cent", /\$110\.00 is deductible/.test(ada.text) && /\$100\.00 is deductible/.test(gwen.text) && /goods or services valued at \$40\.00/.test(ada.text), ada.text);
  ok("§1 the letterhead logo and the signature are both on the page, above the signer's name",
    ada.images >= 2 && /Wren Hollister/.test(ada.text), { images: ada.images });
  const word = await download("/letters/giving/docx", tok, choice);
  const wt = word.status === 200 ? await docxText(word.buf) : { text: "", pages: 0 };
  ok("§2 the Word file holds the same letters, one section each", word.status === 200 && wt.pages === 2 && /Dear Ada,/.test(wt.text) && /Dear Gwen,/.test(wt.text) && !/Bram|Fitz|Cleo|Dov|Esme/.test(wt.text), { status: word.status, pages: wt.pages });
  const after = await one(`SELECT COUNT(*) FILTER (WHERE acknowledgement_sent_at IS NOT NULL)::int AS a FROM gifts WHERE org_id=$1 AND event_id=$2`, [ORG, EV]);
  ok("§2 downloading marks nothing", after.a === 0, after);
  const mk = await api("POST", "/letters/giving/mark", tok, { ...choice, thankYou: false });
  const marks = await q(`SELECT id, acknowledgement_sent_at IS NOT NULL AS a, thanked_at IS NOT NULL AS t, acknowledged_via AS via FROM gifts WHERE org_id=$1 AND event_id=$2`, [ORG, EV]);
  const m = Object.fromEntries(marks.map(r => [r.id, r]));
  ok("§2 Mark these as sent records the acknowledgment on each printed gift, and not a thank-you",
    mk.status === 200 && mk.body.marked === 3 && [G.ada, G.gwen1, G.gwen2].every(id => m[id].a && !m[id].t && m[id].via === "letter")
      && [G.bram, G.fitz, G.cleo, G.esme].every(id => !m[id].a), { mk: mk.body, marks });

  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch {} process.exit(1); });
