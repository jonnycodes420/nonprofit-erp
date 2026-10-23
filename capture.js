// capture.js · CAPTURE-1. NOBODY TYPES A GIFT.
//
// A check photo, a scanned PDF of checks, a pledge form, a donor-advised fund's
// grant letter, a matching-gift letter, a stock transfer notice, an address
// change: each becomes ONE card in "To confirm". The card says what Steward
// read and proposes a person, an amount and a fund. Nothing records money until
// a person taps Confirm, and then the gift is written by recordGift like every
// other gift, so dedupe, the ledger, the thank-you draft and the after-change
// step are the ones that already exist.
//
// THE MODEL TRANSCRIBES; CODE DECIDES. The read schema can carry what is
// written on the page and a sentence; it cannot carry a donor id, a fund id, a
// resolved amount or a confidence. A check's amount is filled only when the
// figures and the words agree to the cent (shared/chequeRead.js, BUILD-95).
//
// BANK DETAILS ARE NEVER DATA. A check's MICR line (routing and account
// numbers) has no field in the schema, the prompt says to ignore it, and every
// string Steward keeps from a read passes scrubBank() first, so a model that
// copied the MICR line into the memo anyway still writes nothing of it down.
// The image itself carries the line; it is stored private to the org's staff,
// served only through a signed, expiring link, and attached to the gift.
"use strict";

const crypto = require("crypto");
const personPhoto = require("./personPhoto");
const { matchPerson } = require("./personMatch");
const DM = require("./donorMatch");

let D = null;                        // server.js hands its helpers over at boot
function configure(deps) { D = deps; }

const MAX_BYTES = 10 * 1024 * 1024;  // per file; the attachment cap reported to Jonathan
const UNDO_DAYS = 30;
const PDF = "application/pdf";
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MONEY_KINDS = ["check", "pledge", "daf_grant", "matching_gift", "stock_gift"];
const LOW_KINDS = ["address_change", "email_change", "note", "receipt_request", "document"];
const KINDS = [...MONEY_KINDS, ...LOW_KINDS, "deposit_slip", "other"];

// ── BANK NUMBERS NEVER LEAVE THIS FUNCTION ─────────────────────────────────
// MICR symbols (⑆ transit, ⑇ amount, ⑈ on-us, ⑉ dash) and any run of eight or
// more digits, however spaced or dashed, are removed. A check number is at most
// six or seven digits and an amount has a point, so nothing a card needs is
// lost. Keys that name a bank number are dropped whatever they hold.
const BANK_KEY = /routing|account|micr|aba|transit|iban|swift|bank_?number/i;
const MICR_CHARS = /[⑆-⑉]/g;
const LONG_DIGITS = /\d(?:[\s-]?\d){7,}/g;
function scrubBank(v) {
  if (v == null) return v;
  if (typeof v === "string") {
    return v.replace(MICR_CHARS, " ").replace(LONG_DIGITS, "[bank number not kept]").replace(/\s{2,}/g, " ").trim();
  }
  if (Array.isArray(v)) return v.map(scrubBank);
  if (typeof v === "object") {
    const out = {};
    for (const [k, x] of Object.entries(v)) if (!BANK_KEY.test(k)) out[k] = scrubBank(x);
    return out;
  }
  return v;
}

// ── THE READ ───────────────────────────────────────────────────────────────
// Every field is a string ("" when absent): a strict tool caps nullable unions
// (FIX-29), and "" reads the same to the code below.
const S = d => ({ type: "string", description: d });
const ITEM_FIELDS = {
  kind: { type: "string", enum: KINDS, description: "What this item is." },
  payer: S("Check: the name PRINTED on the check (top left), not the signature. Letter: the person or organisation the money comes from."),
  payee: S("Check: the name on the Pay to the order of line, verbatim, exactly as written. Otherwise empty."),
  amountDigits: S("Check: the amount in the box, exactly as written. Deposit slip: its total. Otherwise empty."),
  amountWords: S("Check: the amount line, verbatim, including any fraction such as 00/100. Otherwise empty."),
  amountStated: S("Letter or form: the amount as written. Otherwise empty."),
  memo: S("Check: the memo line, verbatim. Otherwise empty."),
  date: S("The date written on the item, verbatim."),
  chequeNumber: S("Check: the check number at the top right. Otherwise empty."),
  donorName: S("The person the item is about or from, as written."),
  email: S("An email address written on the item, if any."),
  line1: S("Street address as written (new address for an address change)."),
  city: S("City as written."), state: S("State as written."), postal: S("ZIP or postal code as written."),
  fundName: S("The fund, designation or purpose named, as written."),
  advisorName: S("Donor-advised fund grant: the advisor or recommender named."),
  employer: S("Matching gift: the employer or company matching."),
  frequency: S("Pledge: how often, as written (monthly, quarterly, annually, once)."),
  installments: S("Pledge: the number of payments, as written."),
  startDate: S("Pledge: the first payment date, as written."),
  shares: S("Stock gift: number of shares, as written."),
  ticker: S("Stock gift: the security name or ticker, as written."),
  originalGiftDate: S("Matching gift: the date of the employee's gift being matched, as written."),
  sentence: S("One plain sentence saying what this item is and who it is from. No numbers that are not written on it."),
};
const READ_SCHEMA = {
  type: "object", additionalProperties: false, required: ["items"],
  properties: {
    items: { type: "array", description: "One entry per check or document on the page(s). A scan of four checks is four items.",
      items: { type: "object", additionalProperties: false, required: Object.keys(ITEM_FIELDS), properties: ITEM_FIELDS } },
  },
};
const READ_PROMPT = [
  "You are reading a document a small nonprofit received: a photographed check, a scan of several checks, a deposit slip,",
  "a pledge form, a donor-advised fund grant letter, a matching-gift letter, a stock transfer notice, or a note.",
  "",
  "Transcribe ONLY what is written. Do not interpret, correct, complete or tidy anything.",
  "- A check: transcribe the amount in the box and the amount in words SEPARATELY and independently; they are checked",
  "  against each other afterwards. The payer is the name printed on the check, not the signature. The payee is",
  "  whoever is written on the Pay to the order of line, verbatim, even when it is not this organization.",
  "- NEVER transcribe the MICR line at the bottom of a check (the routing number, the account number). Leave it out of",
  "  every field, including the memo.",
  "- Leave a field empty when it is not on the item or you cannot read it. A blank costs a line of typing; a guess costs",
  "  somebody's record.",
  "- One item per check or document. Use kind \"other\" for anything that is not one of the listed kinds.",
].join("\n");

async function readDocument(orgId, { buffer, contentType }) {
  const gate = await D.aiGate(orgId);
  if (!gate.ok) return { ai: "off", reason: gate.reason, items: [] };
  const cr = await import("./shared/chequeRead.js");
  const data = buffer.toString("base64");
  const block = contentType === PDF
    ? { type: "document", source: { type: "base64", media_type: PDF, data } }
    : { type: "image", source: { type: "base64", media_type: contentType, data } };
  try {
    const msg = await D.anthropicFor(orgId).messages.create({
      model: cr.CHEQUE_READ_MODEL,
      max_tokens: 4096,
      system: READ_PROMPT,
      tools: [{ name: "record_items", description: "Record exactly what is written on each item.", strict: true, input_schema: READ_SCHEMA }],
      tool_choice: { type: "tool", name: "record_items" },
      messages: [{ role: "user", content: [block, { type: "text", text: "Read this." }] }],
    });
    const use = (msg.content || []).find(b => b.type === "tool_use" && b.name === "record_items");
    const items = use && use.input && Array.isArray(use.input.items) ? use.input.items : null;
    if (!items) return { ai: "failed", items: [] };
    // Scrubbed HERE, before anything else sees the read: nothing downstream
    // (a card, a log line, an audit row) can hold what never left this line.
    return { ai: "read", items: items.slice(0, 20).map(it => scrubBank(it)) };
  } catch (e) {
    console.error("[capture] read failed:", e && e.status ? e.status : "", String(e && e.message || e).slice(0, 120));
    await D.recordAiFallback?.(orgId, "capture_read", e).catch?.(() => {});
    return { ai: "failed", items: [] };
  }
}

// ── STORING THE FILE ───────────────────────────────────────────────────────
// Private (never public), the BUILD-94/95 person-photo kind, so it is served
// only through the signed, expiring /person-photos door to the org's staff.
function sniff(buffer) {
  if (buffer.slice(0, 5).toString("latin1") === "%PDF-") return PDF;
  if (buffer[0] === 0x89 && buffer.slice(1, 4).toString("latin1") === "PNG") return "image/png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
  if (buffer.slice(0, 4).toString("latin1") === "RIFF" && buffer.slice(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}
function decodeDataUrl(dataUrl) {
  const m = /^data:([^;,]*);base64,(.*)$/s.exec(String(dataUrl || ""));
  if (!m) return null;
  try { return Buffer.from(m[2], "base64"); } catch { return null; }
}
// Checked by CONTENT, not by the name or type it arrived with (the BUILD-86 rule).
async function prepareFile(buffer) {
  const type = sniff(buffer);
  if (!type) return { error: "That file isn't a photo or a PDF Steward can read. Use a JPG, PNG, WEBP or PDF." };
  if (buffer.length > MAX_BYTES) return { error: "That file is over 10 MB. Take the photo again, or scan fewer pages." };
  if (type === PDF) return { buffer, contentType: PDF, width: null, height: null };
  try {
    const sharp = require("sharp");
    const r = await sharp(buffer, { failOn: "none" }).rotate()
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 86 }).toBuffer({ resolveWithObject: true });   // higher than a headshot: it has to stay readable
    return { buffer: r.data, contentType: "image/webp", width: r.info.width, height: r.info.height };
  } catch { return { error: "Steward couldn't open that photo. Take it again in better light." }; }
}
async function putFile(orgId, f) {
  const asset = await D.putThemeAsset({ orgId, kind: personPhoto.PHOTO_ASSET_KIND, buffer: f.buffer, contentType: f.contentType, width: f.width, height: f.height });
  return asset.id;
}
async function storeFile(orgId, buffer) {
  const f = await prepareFile(buffer);
  if (f.error) return f;
  return { assetId: await putFile(orgId, f), contentType: f.contentType, readBuffer: f.buffer, readType: f.contentType };
}
const fileUrl = (orgId, assetId) => assetId ? personPhoto.signPhotoUrl({ orgId, assetId }) : null;

// ── THE PROPOSAL: person, amount, fund ─────────────────────────────────────
const lc = s => String(s || "").trim().toLowerCase();
const cents$ = c => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function amountFor(item) {
  const cr = await import("./shared/chequeRead.js");
  const { normalizeMoney } = await import("./shared/importShape.js");
  const toC = s => { const m = normalizeMoney(String(s || "")); return m.value == null ? null : Math.round(m.value * 100); };
  if (item.kind === "check" || item.kind === "deposit_slip") {
    const rec = cr.reconcileAmount(cr.chequeDigitsToCents(item.amountDigits, toC), cr.writtenAmountToCents(item.amountWords));
    if (item.kind === "deposit_slip" && rec.cents == null && rec.digits != null) return { cents: rec.digits, settled: true, sentence: null };
    return { cents: rec.agreed ? rec.cents : null, settled: rec.agreed, sentence: rec.agreed ? null : cr.unsettledSentence(rec, cents$) };
  }
  const c = toC(item.amountStated);
  return c != null && c > 0 ? { cents: c, settled: true, sentence: null }
    : { cents: null, settled: false, sentence: item.amountStated ? `Steward read "${item.amountStated}" and couldn't make an amount of it. Type it in.` : null };
}

// CHECK-2: who the item is from is donorMatch.js's answer (email, every name
// on it with nicknames and initials, the household, the address). One strong
// match is selected with its reasons; several are choices; none is never a
// silent new person: "New donor" is a choice she makes, with the name in
// proper case when the check printed it in capitals.
const JOINT_RULES = ["first_named", "primary"];
async function donorFor(orgId, item) {
  const raw = item.kind === "check" ? (item.payer || item.donorName) : (item.donorName || item.payer);
  const names = DM.splitNames(raw);
  const prefill = { name: names.length ? DM.properCase(names[0].text) : DM.properCase(raw || ""), email: item.email || "",
    line1: item.line1 || "", city: item.city || "", state: item.state || "", postal: item.postal || "" };
  const m = await DM.matchDonor(orgId, { name: raw, email: item.email, line1: item.line1, postal: item.postal }, D.query);
  const out = { state: m.state, selectedId: m.selectedId, choices: m.choices, prefill, by: m.by || null, sentence: m.sentence, joint: [], credit: null };
  if (m.state === "matched" && m.joint.length) Object.assign(out, await jointCredit(orgId, m));
  return out;
}

// THE HOUSEHOLD RULE (orgs.joint_gift_credit). A joint check is one gift, and
// hard credit never moves (BUILD-14): it goes to ONE person, the first name on
// the check ("first_named", the default) or the household's primary contact
// ("primary"). The other name is credited as the record allows: a member of the
// same household shares it through the household (derived, nothing stored);
// another record gets a soft credit row; a spouse on file is greeted in the
// letter; somebody not in Steward is named and left out. The card says which.
async function jointCredit(orgId, m) {
  const [o] = await D.query("SELECT joint_gift_credit FROM orgs WHERE id=?", [orgId]);
  const rule = JOINT_RULES.includes(o && o.joint_gift_credit) ? o.joint_gift_credit : "first_named";
  let selectedId = m.selectedId, choices = m.choices, joint = m.joint;
  const [p] = await D.query("SELECT id, name, household_id FROM donors WHERE id=? AND org_id=?", [selectedId, orgId]);
  if (rule === "primary" && p && p.household_id) {
    const [h] = await D.query("SELECT primary_donor_id FROM households WHERE id=? AND org_id=?", [p.household_id, orgId]);
    const primary = h && h.primary_donor_id && joint.find(j => j.id === h.primary_donor_id);
    if (primary) {
      const [pp] = await D.query("SELECT id, name FROM donors WHERE id=? AND org_id=?", [primary.id, orgId]);
      joint = [...joint.filter(j => j !== primary), { name: p.name, id: p.id, relation: "household", recordName: p.name }];
      selectedId = pp.id;
      choices = [{ ...choices[0], id: pp.id, name: pp.name, why: "the household's primary contact" }];
    }
  }
  const who = choices[0].name;
  const bits = joint.map(j => j.relation === "household" ? `${j.recordName || j.name} shares it through the household`
    : j.relation === "other_record" ? `${j.recordName || j.name} gets soft credit`
    : j.relation === "spouse_on_file" ? `${j.name} is the spouse on file, so the thank-you greets them both`
    : `${j.name} isn't in Steward, so the whole gift is ${who}'s`);
  const ruleWords = rule === "primary" ? "your rule credits the household's primary contact" : "your rule credits the first name on the check";
  return { selectedId, choices, joint, credit: { rule, sentence: `A joint check: ${who} gets the gift (${ruleWords}). ${bits.join(". ")}.` } };
}

// CHECK-2 · WHAT ELSE THE MEMO SAYS. A tribute ("in memory of Walter", "IHO
// Grace", "IMO Dad") becomes the gift's tribute; "pledge pmt 2 of 4" offers
// the matching open pledge payment. The memo itself is saved as written.
const TRIBUTE_RE = /\b(in\s+(?:loving\s+)?memory\s+of|in\s+hono(?:u)?r\s+of|imo|iho)\b[\s:.-]*([A-Za-z][A-Za-z .'’-]{0,60})/i;
function tributeFrom(memo) {
  const m = String(memo || "").match(TRIBUTE_RE);
  if (!m) return null;
  const type = /memory|imo/i.test(m[1]) ? "memory" : "honor";
  const name = DM.properCase(m[2].replace(/[\s.,;-]+$/, "").trim());
  if (!name) return null;
  return { type, name, sentence: `The memo says this gift is ${type === "memory" ? "in memory of" : "in honor of"} ${name}.` };
}
const PLEDGE_RE = /\bpledge\b\s*(?:pmt|pymt|payment|pay|instal+ment|#)?\.?\s*(\d{1,2})\s*(?:of|\/)\s*(\d{1,2})\b/i;
async function pledgeFor(orgId, donorId, memo) {
  const m = String(memo || "").match(PLEDGE_RE);
  if (!m || !donorId) return null;
  const seq = Number(m[1]), of = Number(m[2]);
  const rows = await D.query(
    `SELECT p.id, p.amount::float AS amount, i.id AS inst_id, i.seq, i.amount::float AS inst_amount, i.due_date,
            (SELECT COUNT(*)::int FROM pledge_installments x WHERE x.pledge_id = p.id AND x.org_id = p.org_id) AS n
       FROM pledges p LEFT JOIN pledge_installments i ON i.pledge_id = p.id AND i.org_id = p.org_id AND i.seq = ? AND i.paid_gift_id IS NULL
      WHERE p.org_id=? AND p.donor_id=? AND p.status='open' AND COALESCE(p.is_match,false)=false
      ORDER BY p.created_at`, [seq, orgId, donorId]);
  const fit = rows.filter(r => r.inst_id && r.n === of);
  const pick = fit.length === 1 ? fit[0] : rows.length === 1 && !rows[0].n ? rows[0] : null;
  if (!pick) return { seq, of, pledgeId: null, installmentId: null,
    sentence: `The memo says pledge payment ${seq} of ${of}, but Steward found no open pledge of ${of} payments to put it on.` };
  return { seq, of, pledgeId: pick.id, installmentId: pick.inst_id || null,
    sentence: pick.inst_id ? `The memo says pledge payment ${seq} of ${of}. Apply it to payment ${seq} of her ${cents$(Math.round(pick.amount * 100))} pledge?`
      : `The memo says pledge payment ${seq} of ${of}. Apply it to her open ${cents$(Math.round(pick.amount * 100))} pledge?` };
}

async function defaultFund(orgId) {
  // READ ONLY: a proposal never heals a ledger or creates a fund (POLISH-2).
  const [o] = await D.query("SELECT default_fund_id FROM orgs WHERE id=?", [orgId]);
  if (o && o.default_fund_id) {
    const [f] = await D.query("SELECT id, name FROM fin_funds WHERE id=? AND org_id=?", [o.default_fund_id, orgId]);
    if (f) return f;
  }
  const [g] = await D.query("SELECT id, name FROM fin_funds WHERE org_id=? AND restricted=false ORDER BY created_at ASC LIMIT 1", [orgId]);
  return g || null;
}

// The memo line or the letter's designation, against the org's funds, in four
// steps (FIX-45): the words this org taught Steward on earlier confirms; a
// fund named outright; a close word ("boathouse" for Harbor Skills Boat); and
// last, with AI on, the model's pick with its confidence. Unsure means the
// org's default fund (or the model's low-confidence pick), highlighted.
const FUND_STOP = new Set(["the", "for", "and", "our", "your", "with", "from", "this", "that", "fund", "funds", "gift", "gifts",
  "general", "donation", "memo", "please", "use", "towards", "toward", "support", "program", "programs"]);
const fundWords = t => lc(t).split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !FUND_STOP.has(w));
// Two words are close when one begins with the other and the shorter has four
// letters or more: boat and boathouse, scholar and scholarships, art and arts
// does not count (three letters is too short to mean anything).
const closeWord = (a, b) => { const [s, l] = a.length <= b.length ? [a, b] : [b, a]; return s.length >= 4 && l.startsWith(s); };
// A word close to the organisation's own name says who the check is to, not
// which fund: "Harborlight" on a memo is not the Harbor Skills Boat fund.
function closeFund(text, funds, orgName = "") {
  const own = fundWords(orgName);
  const memo = fundWords(text).filter(w => !own.some(o => o === w || closeWord(o, w)));
  if (!memo.length) return null;
  const scored = funds.map(f => {
    const names = fundWords([f.name, f.public_name].filter(Boolean).join(" "));
    const pairs = [];
    for (const n of new Set(names)) { const m = memo.find(w => closeWord(w, n)); if (m) pairs.push([m, n]); }
    return { f, pairs };
  }).filter(x => x.pairs.length);
  if (!scored.length) return null;
  const best = Math.max(...scored.map(x => x.pairs.length));
  const top = scored.filter(x => x.pairs.length === best);
  return top.length === 1 ? top[0] : null;
}
const FUND_PICK_SCHEMA = {
  type: "object", additionalProperties: false, required: ["fund", "confidence"],
  properties: {
    fund: { type: "string", description: "The id of the one fund the money is meant for, copied exactly from the list, or none." },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
};
async function modelFund(orgId, text, funds) {
  if (!funds.length || !D.aiGate || !D.anthropicFor) return null;
  const gate = await D.aiGate(orgId);
  if (!gate.ok) return null;
  try {
    const msg = await D.anthropicFor(orgId).messages.create({
      model: "claude-haiku-4-5-20251001", max_tokens: 200, thinking: { type: "disabled" },
      tools: [{ name: "pick_fund", description: "Say which fund the memo means, and how sure you are.", strict: true, input_schema: FUND_PICK_SCHEMA }],
      tool_choice: { type: "tool", name: "pick_fund" },
      messages: [{ role: "user", content: [
        "A donor wrote this on a check or a letter: " + JSON.stringify(String(text).slice(0, 120)),
        "The organisation's funds, one per line as id: name:",
        ...funds.map(f => `${f.id}: ${f.name}${f.public_name ? " (" + f.public_name + ")" : ""}`),
        "Pick the fund the donor means. Say none if no fund fits. High confidence only when the words clearly mean that fund.",
      ].join("\n") }],
    });
    const use = (msg.content || []).find(b => b.type === "tool_use" && b.name === "pick_fund");
    const pick = use && use.input;
    const f = pick && funds.find(x => x.id === pick.fund);
    if (!f || !["high", "medium", "low"].includes(pick.confidence)) return null;
    return { f, confidence: pick.confidence };
  } catch (e) {
    console.error("[capture] fund pick failed:", e && e.status ? e.status : "", String(e && e.message || e).slice(0, 120));
    return null;
  }
}
async function fundFor(orgId, item) {
  const text = [item.fundName, item.memo].filter(Boolean).join(" ");
  const funds = await D.query("SELECT id, name, public_name FROM fin_funds WHERE org_id=? ORDER BY name", [orgId]);
  if (text) {
    const words = await D.query("SELECT phrase, fund_id FROM capture_fund_words WHERE org_id=?", [orgId]);
    const t = lc(text);
    const learned = words.find(w => t.includes(w.phrase));
    if (learned) {
      const f = funds.find(x => x.id === learned.fund_id);
      if (f) return { id: f.id, name: f.name, unsure: false, why: `"${learned.phrase}" went to ${f.name} last time` };
    }
    const tm = await import("./shared/textMatch.js");
    const hits = funds.filter(f => [f.name, f.public_name].filter(Boolean).some(n => tm.eitherContainsTokenRun(text, n)));
    if (hits.length === 1) return { id: hits[0].id, name: hits[0].name, unsure: false, why: `the ${item.kind === "check" ? "memo" : "letter"} names it` };
    const [org] = await D.query("SELECT name FROM orgs WHERE id=?", [orgId]);
    const close = closeFund(text, hits.length > 1 ? hits : funds, org && org.name);
    if (close) return { id: close.f.id, name: close.f.name, unsure: false,
      why: `the ${item.kind === "check" ? "memo" : "letter"} says "${close.pairs[0][0]}", close to ${close.f.name}` };
    const m = await modelFund(orgId, text, funds);
    if (m) return { id: m.f.id, name: m.f.name, unsure: m.confidence !== "high", confidence: m.confidence,
      why: m.confidence === "high" ? `Steward read "${text.slice(0, 60)}" as ${m.f.name}`
        : `Steward thinks "${text.slice(0, 60)}" means ${m.f.name}, but isn't sure; check it` };
  }
  const d = await defaultFund(orgId);
  return { id: d ? d.id : null, name: d ? d.name : null, unsure: true,
    why: text ? `Steward couldn't place "${text.slice(0, 60)}"; this is your default fund` : "nothing names a fund; this is your default fund" };
}

const KIND_WORD = { check: "check", pledge: "pledge", daf_grant: "donor-advised fund grant", matching_gift: "matching gift",
  stock_gift: "stock gift", address_change: "address change", email_change: "email change", note: "note",
  receipt_request: "receipt request", document: "document", other: "document", deposit_slip: "deposit slip" };

function headlineFor(kind, amount, donorName, fundName, read) {
  const amt = amount.cents != null ? cents$(amount.cents) + " " : "";
  const who = donorName ? ` from ${donorName}` : "";
  const fund = fundName ? `, ${fundName}` : "";
  if (kind === "pledge") {
    const how = read.frequency ? `, paid ${lc(read.frequency)}` : "";
    return `Log ${amt}pledge${who}${how}${fund}?`;
  }
  if (MONEY_KINDS.includes(kind)) return `Log ${amt}${KIND_WORD[kind]}${who}${fund}?`;
  if (kind === "address_change") return `Update ${donorName || "this person"}'s address?`;
  if (kind === "email_change") return `Update ${donorName || "this person"}'s email?`;
  if (kind === "receipt_request") return `${donorName || "Someone"} asked for a receipt.`;
  return `Keep this ${KIND_WORD[kind] || "document"} on ${donorName || "a person"}'s record?`;
}

function templateSentence(kind, read, amount) {
  if (kind === "check") {
    const bits = [read.payer ? `printed name ${DM.properCase(read.payer)}` : null, read.chequeNumber ? `check ${read.chequeNumber}` : null,
      read.date ? `dated ${read.date}` : null, read.memo ? `memo "${read.memo}"` : null].filter(Boolean);
    return `A check${bits.length ? ": " + bits.join(", ") : ""}.${amount.sentence ? " " + amount.sentence : ""}`;
  }
  return `A ${KIND_WORD[kind] || "document"}${read.donorName || read.payer ? " from " + DM.properCase(read.donorName || read.payer) : ""}.`;
}
const AI_OFF_SENTENCE = "Steward didn't read this one because AI is off. Fill it in from the image.";
const AI_FAILED_SENTENCE = "Steward couldn't read this one just now. Fill it in from the image.";

// Every name the org goes by, the donor-facing one first (VOICE-2's payee check).
async function orgNamesFor(orgId) {
  const [o] = await D.query(`SELECT o.name, o.legal_name, ps.display_name FROM orgs o LEFT JOIN portal_settings ps ON ps.org_id = o.id WHERE o.id=?`, [orgId]);
  if (!o) return [];
  return [...new Set([o.display_name, o.name, o.legal_name].map(n => String(n || "").replace(/\s*\(demo\)\s*$/i, "").trim()).filter(Boolean))];
}

// The model's sentence repeats the printed name as printed; a name in capitals
// reads in proper case wherever Steward shows it.
function properNames(sentence, read) {
  let out = String(sentence || "");
  for (const n of [read.payer, read.donorName]) {
    if (!n) continue;
    for (const part of [n, ...DM.splitNames(n).map(x => x.text)]) if (part && out.includes(part)) out = out.split(part).join(DM.properCase(part));
  }
  return out;
}

// One read item, as a card row (not yet inserted).
async function cardFromItem(orgId, item, ai) {
  const kind = KINDS.includes(item.kind) ? item.kind : "other";
  const read = scrubBank(item);
  const amount = MONEY_KINDS.includes(kind) ? await amountFor(read) : { cents: null, settled: false, sentence: null };
  const donor = await donorFor(orgId, read);
  const fund = MONEY_KINDS.includes(kind) && kind !== "matching_gift" ? await fundFor(orgId, read) : { id: null, name: null, unsure: false, why: null };
  const extra = {};
  if (kind === "daf_grant" && read.advisorName) {
    const m = await matchPerson(orgId, { name: read.advisorName }, D.query);
    extra.advisor = m.status === "matched" ? { id: m.id, selectedId: m.id, name: read.advisorName, state: "matched", choices: [{ id: m.id, name: read.advisorName, why: "the advisor the letter names" }] }
      : { id: null, selectedId: null, name: read.advisorName, state: m.status === "ambiguous" ? "choices" : "new",
          choices: (m.candidates || []).map(c => ({ id: c.id, name: c.name, why: [c.email, c.address].filter(Boolean).join(", ") || "same name" })) };
  }
  if (kind === "matching_gift") extra.matches = await originalGiftFor(orgId, read);
  if (kind === "check" && read.payee) {
    const mis = (await import("./shared/chequeRead.js")).payeeMismatch(read.payee, await orgNamesFor(orgId));
    if (mis) extra.payee = { ...mis, mismatch: true };
  }
  if (MONEY_KINDS.includes(kind) && kind !== "pledge" && read.memo) {
    const t = tributeFrom(read.memo);
    if (t) extra.tribute = t;
    const pl = donor.state === "matched" ? await pledgeFor(orgId, donor.selectedId, read.memo) : null;
    if (pl) extra.pledge = pl;
  }
  const dName = donor.state === "matched" ? donor.choices[0].name : (donor.prefill.name || null);
  const sentence = ai === "read" ? (properNames(scrubBank(read.sentence), read) || templateSentence(kind, read, amount)) + (amount.sentence && !String(read.sentence || "").includes(amount.sentence) ? " " + amount.sentence : "")
    : ai === "off" ? AI_OFF_SENTENCE : AI_FAILED_SENTENCE;
  return {
    kind, stakes: MONEY_KINDS.includes(kind) ? "money" : "low",
    read, proposal: { amount, donor, fund, ...extra },
    headline: ai === "read" ? headlineFor(kind, amount, dName, fund.name, read) : "What is this?",
    sentence,
  };
}

// A matching-gift letter links to the gift it matches when exactly one fits.
async function originalGiftFor(orgId, read) {
  const name = read.donorName;
  if (!name) return { state: "ask", giftId: null, choices: [] };
  const m = await matchPerson(orgId, { name, email: read.email }, D.query);
  if (m.status !== "matched") return { state: "ask", giftId: null, choices: [] };
  const gifts = await D.query(
    `SELECT id, amount::float AS amount, date FROM gifts WHERE org_id=? AND donor_id=? AND amount > 0
      ORDER BY date DESC LIMIT 6`, [orgId, m.id]);
  const want = read.originalGiftDate ? String(read.originalGiftDate) : null;
  const hit = want ? gifts.filter(g => String(g.date).slice(0, 10) === want.slice(0, 10)) : [];
  const toC = g => ({ id: g.id, amountCents: Math.round(g.amount * 100), date: String(g.date).slice(0, 10) });
  if (hit.length === 1) return { state: "found", giftId: hit[0].id, choices: [toC(hit[0])], employeeId: m.id };
  return { state: "ask", giftId: null, choices: gifts.map(toC), employeeId: m.id };
}

// ── MAKING CARDS ───────────────────────────────────────────────────────────
// from: { source: photo|upload|email|forward, receivedAt, sourceRef, actorId, actorName }
async function cardsFromFile(orgId, buffer, fileName, from, batchId = null) {
  const f = await prepareFile(buffer);
  if (f.error) return { refused: f.error, cards: [] };
  // An emailed attachment is READ before it is kept, and kept only if it
  // becomes a card. With AI off an email attachment is not kept at all:
  // Steward cannot tell a pledge form from a logo without reading it.
  // Anything a person uploaded or forwarded on purpose always becomes a card.
  const email = from.source === "email";
  const r = await readDocument(orgId, { buffer: f.buffer, contentType: f.contentType });
  if (email && r.ai !== "read") return { cards: [], ignored: "not_read" };
  // CLIENT-SAFE-1: in privacy mode a health sentence in what was read off an
  // emailed attachment is replaced before the card is written.
  if (from.healthScreen && r.ai === "read") {
    const C = await import("./shared/clientSafe.js");
    let held = 0;
    r.items = r.items.map(it => Object.fromEntries(Object.entries(it).map(([k, v]) => {
      if (typeof v !== "string" || !v) return [k, v];
      const h = C.holdHealth(v); held += h.held; return [k, h.text];
    })));
    if (held) await require("./clientSafe").recordHold(orgId, { donorIds: from.senderDonorId ? [from.senderDonorId] : [], source: "capture", actorId: from.actorId });
  }
  const items = r.ai === "read" ? r.items.filter(i => i.kind !== "deposit_slip" && !(email && i.kind === "other")) : [];
  const slip = r.ai === "read" ? r.items.find(i => i.kind === "deposit_slip") : null;
  if (email && !items.length) return { cards: [], ignored: "not_a_card" };
  const assetId = await putFile(orgId, f);
  const at = { ...from, ai: r.ai, assetId, contentType: f.contentType, fileName, batchId };
  if (!items.length) {
    if (slip) return { slip: await amountFor(scrubBank(slip)), assetId, cards: [] };
    // AI off or nothing read: the image beside an empty form, never nothing.
    const id = await insertCard(orgId, { kind: "other", stakes: "money", read: {}, headline: "What is this?",
      proposal: { amount: { cents: null, settled: false, sentence: null }, donor: { state: "new", selectedId: null, choices: [], prefill: {} }, fund: await fundFor(orgId, {}) },
      sentence: r.ai === "off" ? AI_OFF_SENTENCE : AI_FAILED_SENTENCE }, { ...at, page: 1 });
    return { cards: [id].filter(Boolean), assetId };
  }
  const out = [];
  let page = 0;
  for (const it of items) {
    page += 1;
    const c = await cardFromItem(orgId, it, r.ai);
    // Emailed by a person Steward knows: when the page names nobody Steward
    // can find, the sender is the likeliest person, and the card says so.
    if (from.senderDonorId && (c.proposal.donor.state === "none" || c.proposal.donor.state === "new")) {
      const [d] = await D.query("SELECT id, name FROM donors WHERE id=? AND org_id=?", [from.senderDonorId, orgId]);
      if (d) c.proposal.donor = { ...c.proposal.donor, state: "matched", selectedId: d.id, by: "email", choices: [{ id: d.id, name: d.name, why: "sent it by email" }] };
    }
    out.push(await insertCard(orgId, c, { ...at, page }));
  }
  return { cards: out.filter(Boolean), assetId, slip: slip ? await amountFor(scrubBank(slip)) : null };
}

// ── EMAIL: INT-4's matched mail, and the forward address ───────────────────
// INT-4 calls this only for a message it already logged to a person in Steward
// (an exact email match), so a stranger's attachment is never even fetched.
// PDFs and images only, each at most MAX_BYTES; everything else stays unstored.
async function fromMailboxMessage(orgId, { donorIds, direction, attachmentCount, provider, messageId, receivedAt, actorId, actorName, loadAttachments }) {
  if (direction !== "inbound" || !Array.isArray(donorIds) || donorIds.length !== 1 || !attachmentCount) return { cards: 0 };
  // CLIENT-SAFE-1: an attachment from a person marked as a client is never a card.
  const privacy = await require("./clientSafe").privacyFor(orgId);
  if (privacy.on && privacy.clientIds.has(donorIds[0])) return { cards: 0 };
  const done = await D.query("SELECT 1 FROM capture_items WHERE org_id=? AND source_ref LIKE ? LIMIT 1", [orgId, `${provider}:${messageId}:%`]);
  if (done.length) return { cards: 0 };
  const atts = (await loadAttachments()) || [];
  let cards = 0;
  for (const [i, a] of atts.entries()) {
    if (!a || !a.buffer || a.buffer.length > MAX_BYTES) continue;
    const t = sniff(a.buffer);
    if (t !== PDF && !IMAGE_TYPES.includes(t)) continue;
    const r = await cardsFromFile(orgId, a.buffer, a.fileName || "attachment", {
      source: "email", receivedAt, sourceRef: `${provider}:${messageId}:${i}`, actorId, actorName, senderDonorId: donorIds[0], healthScreen: privacy.on });
    cards += (r.cards || []).length;
  }
  return { cards };
}

// capture+<slug>@<inbound domain>: forward anything. The sender must be on the
// org's staff; anyone else gets nothing stored, not even a drop with content.
function captureSlug(addresses, domain) {
  const dom = String(domain || "").trim().toLowerCase();
  for (const a of addresses || []) {
    const m = /^capture\+([a-z0-9][a-z0-9-]*)@(.+)$/.exec(String(a || "").trim().toLowerCase());
    if (m && m[2] === dom) return m[1];
  }
  return null;
}

function receivedAtFor(read, arrived) {
  // The later of the check's date and its arrival, never in the future.
  const now = Date.now();
  const a = arrived ? new Date(arrived).getTime() : now;
  const d = read && read.date ? Date.parse(read.date) : NaN;
  let t = Math.max(Number.isFinite(d) ? d : 0, Number.isFinite(a) ? a : now);
  if (!Number.isFinite(t) || t <= 0 || t > now) t = Math.min(Number.isFinite(a) ? a : now, now);
  return new Date(t);
}

async function insertCard(orgId, c, f) {
  const id = "cap_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const receivedAt = receivedAtFor(c.read, f.receivedAt);
  const rows = await D.query(
    `INSERT INTO capture_items (id,org_id,kind,stakes,status,source,batch_id,asset_id,content_type,file_name,page,received_at,
                                read,proposal,ai,headline,sentence,source_ref,created_by,created_by_name)
     VALUES (?,?,?,?, 'waiting', ?,?,?,?,?,?,?, ?::jsonb,?::jsonb,?,?,?,?,?,?)
     ON CONFLICT (org_id, source_ref, page) WHERE source_ref IS NOT NULL DO NOTHING RETURNING id`,
    [id, orgId, c.kind, c.stakes, f.source, f.batchId || null, f.assetId || null, f.contentType || null,
     String(f.fileName || "").slice(0, 200), f.page || 1, receivedAt,
     JSON.stringify(scrubBank(c.read || {})), JSON.stringify(scrubBank(c.proposal || {})), f.ai, c.headline, scrubBank(c.sentence),
     f.sourceRef || null, f.actorId, f.actorName || null]);
  if (!rows.length) return null;
  // A low-stakes card for exactly one known person is done for her at once.
  if (c.stakes === "low" && ["address_change", "email_change", "note"].includes(c.kind) && c.proposal.donor.state === "matched") {
    await applyLow(orgId, id, { id: f.actorId, name: f.actorName });
  }
  return id;
}

// ── LOW STAKES: applied at once, undoable for 30 days ──────────────────────
async function applyLow(orgId, cardId, who) {
  const [c] = await D.query("SELECT * FROM capture_items WHERE id=? AND org_id=?", [cardId, orgId]);
  if (!c) return null;
  const donorId = c.proposal.donor.selectedId;
  const [d] = await D.query("SELECT id, name, email, address, city, state, zip FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [donorId, orgId]);
  if (!d) return null;
  const r = c.read || {};
  let applied = null, summary = "";
  if (c.kind === "address_change" && (r.line1 || r.postal)) {
    const before = { address: d.address, city: d.city, state: d.state, zip: d.zip };
    const after = { address: r.line1 || d.address, city: r.city || d.city, state: r.state || d.state, zip: r.postal || d.zip };
    await D.run("UPDATE donors SET address=?, city=?, state=?, zip=?, updated_at=NOW() WHERE id=? AND org_id=?",
      [after.address, after.city, after.state, after.zip, donorId, orgId]);
    applied = { table: "donors", before, after };
    summary = `Updated ${d.name}'s address to ${[after.address, after.city, after.state, after.zip].filter(Boolean).join(", ")}.`;
  } else if (c.kind === "email_change" && r.email) {
    applied = { table: "donors", before: { email: d.email }, after: { email: lc(r.email) } };
    await D.run("UPDATE donors SET email=?, updated_at=NOW() WHERE id=? AND org_id=?", [lc(r.email), donorId, orgId]);
    summary = `Updated ${d.name}'s email to ${lc(r.email)}.`;
  } else if (c.kind === "note") {
    const intId = "int_" + crypto.randomUUID().slice(0, 8);
    await D.run(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name,metadata)
                 VALUES (?,?,?,?,?,?,?,?,?::jsonb)`,
      [intId, orgId, donorId, "note", scrubBank(c.sentence || "A note arrived."), new Date().toISOString().slice(0, 10), who.id, who.name || null,
       JSON.stringify({ via: "capture", capture_id: cardId })]);
    applied = { table: "interactions", id: intId };
    summary = `Added a note to ${d.name}'s record.`;
  } else return null;
  await D.run(`UPDATE capture_items SET status='applied', donor_id=?, applied=?::jsonb, undo_until=NOW() + INTERVAL '${UNDO_DAYS} days',
                      decided_at=NOW(), decided_by=?, decided_by_name=?, sentence=COALESCE(sentence,'') WHERE id=? AND org_id=?`,
    [donorId, JSON.stringify({ ...applied, summary }), who.id, who.name || null, cardId, orgId]);
  await D.afterChange(orgId, [donorId], { door: "capture" }).catch(() => {});
  return summary;
}

async function undoLow(orgId, cardId, who) {
  const [c] = await D.query("SELECT * FROM capture_items WHERE id=? AND org_id=? AND status='applied'", [cardId, orgId]);
  if (!c) return { error: "not_found" };
  if (!c.undo_until || new Date(c.undo_until) < new Date()) return { error: "too_late", sentence: "This was done more than 30 days ago, so change it on the record instead." };
  const a = c.applied || {};
  if (a.table === "donors") {
    const cols = Object.keys(a.before);
    // Only put back what this card changed and nobody has changed since.
    const [d] = await D.query(`SELECT ${cols.join(",")} FROM donors WHERE id=? AND org_id=?`, [c.donor_id, orgId]);
    const same = d && cols.every(k => String(d[k] ?? "") === String(a.after[k] ?? ""));
    if (!same) return { error: "changed_since", sentence: "This record has changed since, so Steward won't put the old value back. Change it on the record." };
    await D.run(`UPDATE donors SET ${cols.map(k => `${k}=?`).join(",")}, updated_at=NOW() WHERE id=? AND org_id=?`,
      [...cols.map(k => a.before[k]), c.donor_id, orgId]);
  } else if (a.table === "interactions") {
    await D.run("DELETE FROM interactions WHERE id=? AND org_id=?", [a.id, orgId]);
  }
  await D.run("UPDATE capture_items SET status='undone', decided_at=NOW(), decided_by=?, decided_by_name=? WHERE id=? AND org_id=?",
    [who.id, who.name || null, cardId, orgId]);
  if (c.donor_id) await D.afterChange(orgId, [c.donor_id], { door: "capture" }).catch(() => {});
  return { ok: true };
}

// ── THE GIFT-TO-THANKED CLOCK ──────────────────────────────────────────────
// Every gift thanked in the last 30 days: from when it came in (received_at,
// or when Steward recorded it for a door that does not say) to when it was
// thanked (a thank-you sent, a call, a note). One row per gift, its days to two
// places, slowest first; the line's number is the mean of exactly these rows.
const CLOCK_DAYS = 30;
// Dates are the ORG's days, never the database session's (on a UTC database a
// gift thanked at 9pm in New York would land on tomorrow): the zone is read
// once, checked against Postgres's own list, New York when unset or unknown.
const ORG_ZONE = `(SELECT COALESCE((SELECT z.name FROM orgs o JOIN pg_timezone_names z ON z.name = o.timezone WHERE o.id = ?), 'America/New_York') AS tz)`;
function clockSql(orgId) {
  return {
    sql: `WITH zone AS ${ORG_ZONE}
          SELECT g.id, 'gift' AS type, g.donor_id, d.name, TO_CHAR(g.thanked_at AT TIME ZONE zone.tz, 'YYYY-MM-DD') AS date,
                 ROUND((GREATEST(EXTRACT(EPOCH FROM (g.thanked_at - COALESCE(g.received_at, g.created_at))), 0) / 86400.0)::numeric, 2) AS amount,
                 '$' || TO_CHAR(g.amount, 'FM999,999,990.00') || ' gift, came in ' || TO_CHAR(COALESCE(g.received_at, g.created_at) AT TIME ZONE zone.tz, 'Mon FMDD')
                   || ', thanked ' || TO_CHAR(g.thanked_at AT TIME ZONE zone.tz, 'Mon FMDD') AS detail
            FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id CROSS JOIN zone
           WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.amount > 0 AND g.thanked_at IS NOT NULL
             AND g.thanked_at > NOW() - INTERVAL '${CLOCK_DAYS} days'`,
    args: [orgId, orgId],
    order: "amount DESC, id",
  };
}
const CLOCK_SENTENCE = `Every gift thanked in the last ${CLOCK_DAYS} days, by a thank-you sent, a call or a note: the days from when it came in to when it was thanked, slowest first. A receipt is not a thank-you, so it does not stop the clock.`;
// The line, plus Home's tile: the same rows by the org's day they were
// thanked (30 bars ending today, a day with nothing thanked is null), and how
// many cards wait in To confirm.
async function clock(orgId) {
  const q = clockSql(orgId);
  const [r] = await D.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(ROUND(amount*100)),0)::bigint AS c FROM (${q.sql}) x`, q.args);
  const n = Number(r.n) || 0;
  const days = n ? Math.round(Number(r.c) / n) / 100 : null;
  const byDay = await D.query(`SELECT date, COUNT(*)::int AS n, SUM(ROUND(amount*100))::bigint AS c FROM (${q.sql}) x GROUP BY date`, q.args);
  const [t] = await D.query(`WITH zone AS ${ORG_ZONE} SELECT TO_CHAR((NOW() AT TIME ZONE zone.tz)::date, 'YYYY-MM-DD') AS today FROM zone`, [orgId]);
  const map = new Map(byDay.map(b => [b.date, b]));
  const trend = [];
  const end = new Date(t.today + "T12:00:00Z");
  for (let i = CLOCK_DAYS - 1; i >= 0; i--) {
    const date = new Date(end.getTime() - i * 86400000).toISOString().slice(0, 10);
    const b = map.get(date);
    trend.push({ date, count: b ? b.n : 0, days: b ? Math.round(Number(b.c) / b.n) / 100 : null });
  }
  const [w] = await D.query("SELECT COUNT(*)::int AS n FROM capture_items WHERE org_id=? AND status='waiting' AND stakes='money'", [orgId]);
  return { days, count: n, source: "gift-to-thanked",
    sentence: n ? `Average time from gift to thank-you, last ${CLOCK_DAYS} days: ${days} ${days === 1 ? "day" : "days"}` : `No gifts were thanked in the last ${CLOCK_DAYS} days.`,
    definition: CLOCK_SENTENCE, trend, waiting: w.n };
}

module.exports = {
  fromMailboxMessage, captureSlug, prepareFile,
  clockSql, clock, CLOCK_SENTENCE, CLOCK_DAYS,
  configure, scrubBank, readDocument, storeFile, decodeDataUrl, sniff, cardsFromFile, cardFromItem, insertCard,
  applyLow, undoLow, receivedAtFor, orgNamesFor, fundFor, closeFund, FUND_PICK_SCHEMA, donorFor, amountFor, tributeFrom, pledgeFor, jointCredit, JOINT_RULES, defaultFund, fileUrl,
  MAX_BYTES, UNDO_DAYS, MONEY_KINDS, LOW_KINDS, KINDS, READ_SCHEMA, READ_PROMPT, AI_OFF_SENTENCE, cents$,
};
