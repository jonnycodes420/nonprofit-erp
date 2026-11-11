// server/atlas/grounded.js · ATLAS-6. ATLAS NEVER STATES A FACT IT DIDN'T READ.
//
// The fleet (10 Nov) heard Atlas give a lifetime for a date range
// (W-1109-Atlas-01), name a gift in a month it was not given (W-1110-Atlas-02),
// fail to name the executive director that three settings screens name
// (W-1110-Atlas-07X), and echo a two-part question back as one garbled
// sentence (W-1110-Atlas-07). The rules, here, in code:
//
//   AN AMOUNT FOR A PERIOD reads shared/numbers (givingBetween) for the window
//   shared/atlasDates.js periodOf read from her words. Lifetime only when she
//   asked for it, and then labeled.
//   A NAMED GIFT is quoted from a gift row this answer fetched; the row ids
//   stay on the answer (`rows`).
//   EVERY REPLY that came from a model, or carries one, passes groundedIn: each
//   $ amount and each date in its words must be one the answer read. One that
//   is not makes the reply refused, and a template sentence goes instead.
//   ORG FACTS (executive director, signer, EIN, address, fiscal year, time
//   zone) come from the org's settings and the team's titles.
//   A COMPOUND QUESTION is split, and each part answered in plain words.
"use strict";
const { givingBetween, IN_SPAN } = require("../../shared/numbers/givingBetween");
const { LIVE } = require("../../shared/numbers/money");
const GT = require("./givingTotal");
const FY = require("../../shared/numbers/fiscalYear");   // the one home of a fiscal-year boundary

const MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayWords = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || "")); return m ? `${MON3[+m[2] - 1]} ${+m[3]}, ${m[1]}` : ""; };
const gifts = n => `${n} ${n === 1 ? "gift" : "gifts"}`;

// ── An amount for a period ─────────────────────────────────────────────────
// Each person's money in the window (shared/numbers givingBetween, cut at
// today), the gift rows that make it (ids kept), and their Lifetime, labeled.
async function periodFigures(query, orgId, ids, period, today) {
  const life = new Map((await GT.figuresFor(query, orgId, ids)).map(p => [p.id, p]));
  const out = [];
  for (const id of ids) {
    const p = life.get(id);
    if (!p) continue;
    const g = await givingBetween(query, orgId, { from: period.from, to: period.to, today, donorId: id });
    const rows = await query(
      `SELECT g.id, LEFT(g.date, 10) AS date, ROUND(g.amount * 100)::bigint AS cents FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
        WHERE g.org_id = ? AND ${LIVE("d")} AND ${IN_SPAN("g")} AND g.donor_id = ? AND g.amount > 0 ORDER BY g.date, g.id LIMIT 6`,
      [orgId, g.from, g.to, id]);
    out.push({ id, name: p.name, cents: g.cents, giftCount: g.gifts, lifetimeCents: p.cents,
      rows: rows.map(r => ({ id: r.id, date: String(r.date), cents: Number(r.cents) })) });
  }
  return out;
}
function periodSentence(people, period) {
  const one = p => {
    if (!p.giftCount && !p.cents) return `${p.name} gave nothing ${period.words}. Lifetime: ${GT.usd(p.lifetimeCents)}.`;
    const listed = p.rows.length && p.rows.length <= 5 ? `: ${p.rows.map(r => `${GT.usd(r.cents)} on ${dayWords(r.date)}`).join(", ")}` : "";
    return `${p.name} gave ${GT.usd(p.cents)} ${period.words}, ${gifts(p.giftCount)}${listed}. Lifetime: ${GT.usd(p.lifetimeCents)}.`;
  };
  if (people.length === 1) return one(people[0]);
  const total = people.reduce((s, p) => s + p.cents, 0);
  return `Together they gave ${GT.usd(total)} ${period.words}. ` + people.map(one).join(" ");
}
async function periodAnswer(query, orgId, ids, period, today) {
  const people = await periodFigures(query, orgId, ids, period, today);
  return { sentence: periodSentence(people, period), people, rows: people.flatMap(p => p.rows.map(r => ({ ...r, donorId: p.id }))),
    period: { from: period.from, to: period.to, words: period.words },
    definition: "Money given in the window (hard credit, refunds off, gifts dated from its first day to its last, never past today), by the rule every report uses. Lifetime is the profile's figure." };
}

// ── The grounding check ────────────────────────────────────────────────────
const MON = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const monIdx = w => ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(String(w).toLowerCase().slice(0, 3)) + 1;
// Every amount and date a piece of text states: { cents: [], days: [{y,m,d}], months: [{y,m}] }.
function claims(text) {
  const t = String(text || "");
  const cents = [];
  for (const m of t.matchAll(/\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s?(k|thousand|million|m)?\b/gi)) {
    let n = Number(m[1].replace(/,/g, "")) * 100 + (m[2] ? Number(m[2].padEnd(2, "0")) : 0);
    const mult = (m[3] || "").toLowerCase();
    if (mult === "k" || mult === "thousand") n *= 1000; else if (mult === "m" || mult === "million") n *= 1000000;
    cents.push(Math.round(n));
  }
  const days = [], months = [];
  const taken = [];
  const note = (i, len) => taken.push([i, i + len]);
  const free = i => !taken.some(([a, b]) => i >= a && i < b);
  for (const m of t.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) { days.push({ y: +m[1], m: +m[2], d: +m[3] }); note(m.index, m[0].length); }
  for (const m of t.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g)) { days.push({ y: m[3].length === 2 ? 2000 + +m[3] : +m[3], m: +m[1], d: +m[2] }); note(m.index, m[0].length); }
  for (const m of t.matchAll(new RegExp(`\\b${MON}\\.? (\\d{1,2})(?:st|nd|rd|th)?\\b(?:,? (\\d{4}))?`, "gi"))) {
    if (!free(m.index)) continue;
    days.push({ y: m[3] ? +m[3] : null, m: monIdx(m[1]), d: +m[2] }); note(m.index, m[0].length);
  }
  for (const m of t.matchAll(new RegExp(`\\b${MON},? (\\d{4})\\b`, "gi"))) {
    if (!free(m.index)) continue;
    months.push({ y: +m[2], m: monIdx(m[1]) }); note(m.index, m[0].length);
  }
  return { cents, days, months };
}
// The facts an answer read: every number (as dollars and as cents) and every
// date in it, walked from whatever it fetched (rows, a figure, a sentence's facts).
function factsOf(...sources) {
  const cents = new Set(), days = [];
  // As whyShape.allowedNumbers reads them: a key ending in "cents" is cents, any
  // other number dollars (and, to be safe, cents too); a sign is not a new number
  // ("$1,000 under" from a variance of -100000 cents).
  const walk = (v, k = "") => {
    if (v == null) return;
    if (typeof v === "number" && Number.isFinite(v)) {
      const a = Math.abs(v);
      if (/cents$/i.test(k)) cents.add(Math.round(a)); else { cents.add(Math.round(a * 100)); cents.add(Math.round(a)); }
      return;
    }
    if (typeof v === "string") {
      const c = claims(v);
      c.cents.forEach(x => cents.add(x));
      c.days.forEach(x => days.push(x));
      c.months.forEach(x => days.push({ y: x.y, m: x.m, d: null }));
      if (/^-?\d+(?:\.\d+)?$/.test(v.trim())) walk(Number(v), k);
      return;
    }
    if (Array.isArray(v)) { v.forEach(x => walk(x, k)); return; }
    if (typeof v === "object") for (const [kk, vv] of Object.entries(v)) walk(vv, kk);
  };
  sources.forEach(walk);
  return { cents, days };
}
// { ok, ungrounded: [words] }: every amount and date in `text` is one of `facts`.
function groundedIn(text, facts) {
  const c = claims(text), bad = [];
  for (const x of c.cents) if (!facts.cents.has(x)) bad.push(GT.usd(x));
  for (const x of c.days) if (!facts.days.some(f => f.m === x.m && f.d === x.d && (x.y == null || f.y === x.y))) bad.push(`${MON3[x.m - 1]} ${x.d}${x.y ? ", " + x.y : ""}`);
  for (const x of c.months) if (!facts.days.some(f => f.m === x.m && f.y === x.y)) bad.push(`${MON3[x.m - 1]} ${x.y}`);
  return { ok: bad.length === 0, ungrounded: bad };
}
// The reply to send: `text` when every figure in it was read, else the template.
function groundedReply(text, facts, template) {
  const g = groundedIn(text, facts);
  return g.ok ? { sentence: text, grounded: true } : { sentence: template, grounded: false, ungrounded: g.ungrounded };
}

// ── Org facts ──────────────────────────────────────────────────────────────
const ORG_FACTS = [
  ["director", /\b(executive director|exec(?:utive)? dir|\bed\b|ceo|chief executive|president)\b/i],
  ["signer", /\b(who (?:signs|signed)|signer|signature)\b.*\breceipts?\b|\breceipts?\b.*\b(signed|signs|signer)\b/i],
  ["ein", /\b(ein|tax[- ]?id|employer identification|tax number)\b/i],
  ["address", /\b(our|the organi[sz]ation'?s?|the org'?s?|mailing|office) address\b|\bwhere are we located\b|\bwhat'?s our address\b/i],
  ["fiscal", /\bfiscal year\b.*\b(start|begin|end|run)s?\b|\bwhen does (?:our|the) (?:fiscal )?year (?:start|begin|end)\b|\bwhat(?:'s| is) our fiscal year\b/i],
  ["timezone", /\btime ?zone\b/i],
];
function orgFactAsked(words) {
  const t = String(words || "");
  if (!/\b(who|what|which|when|where|tell me)\b/i.test(t)) return null;
  for (const [k, re] of ORG_FACTS) if (re.test(t)) return k;
  return null;
}
const DIRECTOR_TITLE = /\b(executive director|exec(?:utive)? dir\.?|ceo|chief executive)\b/i;
async function orgFactAnswer(query, orgId, fact) {
  const [o] = await query(`SELECT name, legal_name, ein, receipt_address, receipt_signature_name, receipt_signature_title, timezone, vocabulary_json
                             FROM orgs WHERE id = ?`, [orgId]);
  if (!o) return { sentence: "I couldn't read your organization's settings just now." };
  const orgName = o.name || "Your organization";
  const orgs = /s$/i.test(orgName) ? `${orgName}'` : `${orgName}'s`;   // a name ending in s takes the apostrophe alone
  if (fact === "director") {
    const team = await query(`SELECT name, sign_title FROM users WHERE org_id = ? AND deactivated_at IS NULL AND COALESCE(sign_title, '') <> ''`, [orgId]);
    const byTitle = team.find(u => DIRECTOR_TITLE.test(u.sign_title));
    const signer = o.receipt_signature_name && DIRECTOR_TITLE.test(o.receipt_signature_title || "") ? o.receipt_signature_name : null;
    const who = (byTitle && byTitle.name) || signer;
    if (who) {
      const at = [byTitle && byTitle.name === who ? "My profile" : null, signer === who ? "Tax Receipts" : null, signer === who ? "the Brand kit" : null].filter(Boolean);
      const where = at.length > 1 ? `${at.slice(0, -1).join(", ")} and ${at[at.length - 1]}` : at.join("");
      return { sentence: `${who} is ${orgs} ${(byTitle && byTitle.name === who ? byTitle.sign_title : o.receipt_signature_title || "executive director").toLowerCase()}${where ? ` (from ${where})` : ""}.`, source: "settings" };
    }
    return { sentence: o.receipt_signature_name
      ? `No one has the title executive director in Steward. Your receipts are signed by ${o.receipt_signature_name}${o.receipt_signature_title ? `, ${o.receipt_signature_title}` : ""}.`
      : "No one has the title executive director in Steward yet. Add it in My profile (your title) or Settings → Tax receipts (the signer)." };
  }
  if (fact === "signer") return { sentence: o.receipt_signature_name ? `Your receipts are signed by ${o.receipt_signature_name}${o.receipt_signature_title ? `, ${o.receipt_signature_title}` : ""} (Settings → Tax receipts).` : "No signer is set yet. Add one in Settings → Tax receipts." };
  if (fact === "ein") return { sentence: o.ein ? `${/s$/i.test(o.legal_name || orgName) ? (o.legal_name || orgName) + "'" : (o.legal_name || orgName) + "'s"} EIN is ${o.ein} (Settings → Tax receipts).` : "No EIN is set yet. Add it in Settings → Tax receipts." };
  if (fact === "address") return { sentence: o.receipt_address ? `${orgs} address on your receipts is ${o.receipt_address}.` : "No address is set yet. Add it in Settings → Tax receipts." };
  if (fact === "timezone") return { sentence: `Steward keeps ${orgs} days in ${o.timezone || "America/New_York"} time.` };
  if (fact === "fiscal") {
    let v = o.vocabulary_json; if (typeof v === "string") { try { v = JSON.parse(v); } catch { v = null; } }
    const mo = Number(v && v.fiscal_year_start_month) || 7;
    const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return { sentence: mo === 1 ? "Your fiscal year is the calendar year, January to December." : `Your fiscal year runs from ${names[mo - 1]} 1 to the end of ${names[(mo + 10) % 12]}.` };
  }
  return null;
}

// ── A compound question ────────────────────────────────────────────────────
// "What's Renee's favorite color, and how much will she give next year?" →
// two parts. Split on "?" and on ", and" / " and also" before a question word.
const Q_START = /^(?:what|who|when|where|why|how|which|is|are|does|do|did|can|could|will|would|tell me)\b/i;
function splitQuestion(words) {
  const t = String(words || "").replace(/\s+/g, " ").trim();
  const parts = t.split(/\?\s*|,?\s+(?:and|but|also|plus)\s+(?=(?:what|who|when|where|why|how|which|is|are|does|do|did|can|could|will|would|tell me)\b)/i)
    .map(x => x.trim().replace(/^(?:and|also|but)\s+/i, "")).filter(Boolean);
  if (parts.length < 2 || !parts.every(p => Q_START.test(p))) return null;
  return parts.map(p => p.replace(/[?.!\s]+$/, "") + "?");
}
// "how much will she give next year", "what will Ada give in 2027": a forecast.
const PREDICT = /\b(?:will|going to|gonna|expect(?:ed)? to|predict|forecast)\b.*\b(?:give|donate|gift|giving)\b|\bnext (?:year|month|quarter|fiscal year)\b.*\b(?:give|giving|donate)\b/i;
const isPrediction = words => PREDICT.test(String(words || ""));

// The window a period names, in days: a named fiscal year through shared/numbers/fiscalYear.
function resolvePeriod(p, org, today) {
  if (!p || !p.fiscal) return p || null;
  const sm = FY.startMonth(org || {});
  const startYear = p.fiscal.endYear != null ? (sm === 1 ? p.fiscal.endYear : p.fiscal.endYear - 1) : FY.startYearOf(today, sm) + p.fiscal.offset;
  const y = FY.yearStarting(startYear, sm);
  return { from: y.start, to: y.end, words: `in ${y.chartLabel}${p.fiscal.offset === 0 ? " so far" : ""}` };
}

// ── Her words, as the steps ATLAS-6 answers in code ────────────────────────
// null when none of these shapes is all of it (the usual read goes on). Each
// part of a compound question is its own step, answered in order:
//   a setting (org fact)   → setting_fact
//   something not kept     → cant_know ("I don't have Renee's favorite color.")
//   a forecast             → giving_total { predict }: what they gave this fiscal year, said as known
//   an amount (a period?)  → giving_total { period }
//   anything else, in a compound → question (Ask, as before)
// `A` is shared/atlas.js (cantKnow) and `D` shared/atlasDates.js (periodOf).
const PRONOUN = /^(?:she|he|they|her|him|them)$/i;
function nameIn(words) {
  const t = String(words || "");
  const m = /\b(?:will|would|is|does|did|has|have|had)\s+([A-Z][\w'-]*(?:\s+[A-Z][\w'-]*)?)\s+(?:give|donate|gift|be giving|going)\b/.exec(t);
  if (m) return m[1];
  // "What's Renee Castillo's favorite color": the possessive that is a name, never the question word.
  for (const p of t.matchAll(/\b([A-Z][\w-]*(?:\s+[A-Z][\w-]*)?)['’]s\b/g)) {
    const w = p[1].replace(/^(?:What|Who|Where|When|Why|How|Which|That|It|Tell|There|Here)\b\s*/, "");
    if (w && /^[A-Z]/.test(w)) return w;
  }
  return null;
}
function questionSteps(text, { today, org, A, D }) {
  const parts = splitQuestion(text);
  const list = parts || [String(text || "").trim()];
  const steps = [];
  let lastName = null;
  for (const part of list) {
    const fact = orgFactAsked(part);
    if (fact) { steps.push({ kind: "setting_fact", fact, words: part }); continue; }
    const ck = A.cantKnow(part, { anyCase: true });
    if (ck) {
      lastName = nameIn(part) || lastName;
      // In a compound, the plain fact alone ("I don't have Renee's favorite color."); alone, with the offer to note it.
      steps.push({ kind: "cant_know", line: parts ? ck.replace(/\s*I can add it as a note if you tell me\.$/, "") : ck, words: part });
      continue;
    }
    if (isPrediction(part)) {
      let who = nameIn(part);
      if (!who || PRONOUN.test(who)) who = lastName;
      const fy = resolvePeriod(D.periodOf("this fiscal year", today), org, today);
      if (who) { steps.push({ kind: "giving_total", predict: true, who, whos: [who], words: part, period: fy }); lastName = who; continue; }
      steps.push({ kind: "cant_know", line: "I can't predict future giving. Ask me what someone has given, and I'll read it from their gifts.", words: part });
      continue;
    }
    const gq = GT.parseGivingQuestion(part);
    if (gq) {
      steps.push({ kind: "giving_total", who: gq.names.join(" and "), whos: gq.names, words: part, period: resolvePeriod(D.periodOf(part, today), org, today) });
      lastName = gq.names[gq.names.length - 1];
      continue;
    }
    if (!parts) return null;
    steps.push({ kind: "question", target: part, words: part });
  }
  return steps;
}

module.exports = { questionSteps, resolvePeriod, periodFigures, periodSentence, periodAnswer, claims, factsOf, groundedIn, groundedReply,
  orgFactAsked, orgFactAnswer, splitQuestion, isPrediction, dayWords };
