// shared/depositSheet.js — BUILD-88b B.1. THE DEPOSIT SHEET.
//
// A church treasurer sits down on Monday with a bank deposit slip: eleven
// lines, a name, an amount, and a memo somebody wrote on the back of a cheque.
// Getting that into Steward was eleven trips through the gift form, and the
// only thing that told her she had finished was adding the numbers up herself.
//
// THE RULE THIS FILE EXISTS TO ENFORCE: **nothing is placed by guess.** Every
// line leaves with exactly one of four states, and two of them are Steward
// saying so out loud:
//
//   placed            — a donor on file, and a fund the memo actually named
//   placed_new_donor  — nobody on file answers to this name. That is a FACT
//                       Steward checked, not a guess, so the line places and
//                       the commit creates the person.
//   needs_you         — anything Steward cannot stand behind: a name that
//                       matches two people, a memo that matches no fund, an
//                       amount NEAR an instalment but not equal to it, an
//                       amount it cannot read. A short list, with the answer
//                       it needs named.
//   not_a_gift        — a refund, a transfer, a grant draw, a store deposit, a
//                       programme fee, a subtotal. Real money on the slip, and
//                       not a contribution. On a known person it is recorded as
//                       a PAYMENT on their record, out of every giving total.
//
// A GUESSED DESIGNATION IS AN AUDIT FINDING. A memo that matches no fund is
// `needs_you` carrying the fund list — never General, and never the org's
// default either. A BLANK memo takes the org's unrestricted default ONLY if
// somebody chose one (orgs.default_fund_id); with nothing chosen it is also
// needs_you, because "we do not know" is not the same as "unrestricted".
//
// Pure and JSX-free: the org's own data (donors, funds, open instalments)
// arrives as arrays, so the whole engine is unit-testable and the route's only
// job is to fetch and to write. Every matching rule here is BUILD-88a A.7's —
// `matchNameKey`/`matchNamesCompatible` for people, `normalizeMoney` for money,
// `containsTokenRun` for text — so the deposit sheet and the importer cannot
// come to different conclusions about the same name.

import { normalizeMoney, normalizeName, matchNameKey, matchNamesCompatible, normalizeHeader } from "./importShape.js";
import { containsTokenRun } from "./textMatch.js";

export const DEPOSIT_STATES = ["placed", "placed_new_donor", "needs_you", "not_a_gift"];

// ── The paste, turned into a table ─────────────────────────────────────────
// A slip is typed, not exported: tabs from a spreadsheet, or two-and-more
// spaces from a screen, or commas. It becomes { headers, rows } — the same
// shape a parsed CSV has — so ONE mapper reads both.
const MONEY_CELL = /^[-(]?\s*(?:usd\s*)?[$€£]?\s*[\d][\d,. ]*\)?-?$/i;
const CHECK_CELL = /^(?:c(?:k|hk|heck)?|chq|cheque)?\s*#?\s*(\d{2,8})$/i;
const CHECK_WORD = /\b(?:ck|chk|check|cheque|chq)\b/i;

function splitLine(line) {
  if (line.includes("\t")) return line.split("\t").map(c => c.trim());
  if (/\s{2,}/.test(line)) return line.split(/\s{2,}/).map(c => c.trim());
  if (line.includes(",")) return line.split(",").map(c => c.trim());
  // One run of single spaces: the LAST money-shaped token is the amount and
  // the words before it are the name. A memo needs a real separator.
  const parts = line.trim().split(/\s+/);
  for (let i = parts.length - 1; i > 0; i--) {
    if (MONEY_CELL.test(parts[i]) && normalizeMoney(parts[i]).value != null) {
      return [parts.slice(0, i).join(" "), parts[i], parts.slice(i + 1).join(" ")].filter((c, j) => j < 2 || c);
    }
  }
  return [line.trim()];
}

export function parseDepositPaste(text) {
  const lines = String(text || "").split(/\r?\n/).map(l => l.replace(/\s+$/, "")).filter(l => l.trim() !== "");
  const rows = [], refused = [];
  // A header row, if the paste came out of a spreadsheet with one.
  let start = 0;
  if (lines.length) {
    const first = splitLine(lines[0]).map(normalizeHeader);
    if (first.some(h => h === "name" || h === "donor" || h === "donor name") && first.some(h => /amount|total/.test(h))) start = 1;
  }
  for (let i = start; i < lines.length; i++) {
    const cells = splitLine(lines[i]);
    const line = i + 1;
    // The amount: the money-shaped cell whose value actually parses. A cell
    // that LOOKS like money and does not parse is kept as the amount anyway,
    // so the line refuses with its own text rather than silently becoming a memo.
    let amountIdx = -1;
    for (let c = cells.length - 1; c >= 0; c--) {
      if (!MONEY_CELL.test(cells[c])) continue;
      if (CHECK_CELL.test(cells[c]) && normalizeMoney(cells[c]).value != null && !/[.,]/.test(cells[c]) && cells.length > 2) continue;
      amountIdx = c; break;
    }
    if (amountIdx === -1) {
      const moneyish = cells.findIndex(c => /\d/.test(c));
      if (moneyish === -1) { refused.push({ line, raw: lines[i], reason: "no amount on the line" }); continue; }
      amountIdx = moneyish;
    }
    const rest = cells.filter((_, c) => c !== amountIdx);
    // A cheque number is a number wearing a cheque's clothes, or a bare short
    // integer beside a memo. It is never the amount and never the name.
    let check = "";
    const checkIdx = rest.findIndex((c, j) => j > 0 && (CHECK_WORD.test(c) || /^\d{3,8}$/.test(c)) && CHECK_CELL.test(c.replace(CHECK_WORD, "").trim() || c));
    if (checkIdx > 0) { check = (rest[checkIdx].match(/\d{2,8}/) || [""])[0]; rest.splice(checkIdx, 1); }
    rows.push({
      line, raw: lines[i],
      name: (rest[0] || "").trim(),
      amount: cells[amountIdx],
      memo: rest.slice(1).filter(Boolean).join(" ").trim(),
      check,
    });
  }
  return { headers: ["Name", "Amount", "Memo", "Check"], rows, refused };
}

// ── What is NOT a gift ─────────────────────────────────────────────────────
// Money on the slip that is not a contribution. Every phrase here is one a
// treasurer writes; the match is a WHOLE TOKEN RUN (BUILD-84's rule), so
// "transfer" does not fire on "Transferrin Research Fund".
export const NOT_A_GIFT_RULES = [
  { kind: "refund", phrases: ["refund", "refunded", "reversal", "returned check", "returned cheque", "nsf", "chargeback"] },
  { kind: "transfer", phrases: ["transfer", "bank transfer", "internal transfer", "between accounts", "sweep"] },
  { kind: "grant_draw", phrases: ["grant draw", "grant drawdown", "drawdown", "reimbursement request", "grant reimbursement"] },
  { kind: "store", phrases: ["store", "bookstore", "book sales", "merch", "merchandise", "t shirt", "t shirts", "tshirt sales", "coffee bar", "cafe"] },
  { kind: "program_fee", phrases: ["program fee", "programme fee", "tuition", "registration fee", "class fee", "camp fee", "retreat fee", "ticket sales", "dues"] },
  { kind: "rent", phrases: ["rent", "facility use", "hall rental", "building use"] },
  { kind: "interest", phrases: ["interest", "dividend", "bank interest"] },
  { kind: "subtotal", phrases: ["subtotal", "sub total", "total", "deposit total", "slip total", "grand total", "page total"] },
];

export function classifyDepositLine({ name = "", memo = "" } = {}) {
  const text = `${memo} ${name}`;
  for (const rule of NOT_A_GIFT_RULES) {
    for (const phrase of rule.phrases) {
      if (containsTokenRun(text, phrase)) return { kind: "not_a_gift", reason: rule.kind, matched: phrase };
    }
  }
  return { kind: "gift", reason: null, matched: null };
}

// ── The fund the memo actually named ───────────────────────────────────────
// `funds` = [{ id, name, aliases: [] , restricted }]. A memo matches a fund
// when it contains the fund's name or one of the org's own aliases as a whole
// token run. Two different funds matching is AMBIGUOUS, which is a question,
// not a coin toss.
export function matchFundFromMemo(memo, funds = []) {
  const text = String(memo || "").trim();
  if (!text) return { fundId: null, fundName: null, via: "blank", ambiguous: false };
  const hits = [];
  for (const f of funds) {
    const candidates = [f.name, ...(Array.isArray(f.aliases) ? f.aliases : [])].filter(Boolean);
    for (const cand of candidates) {
      if (containsTokenRun(text, cand)) { hits.push({ fundId: f.id, fundName: f.name, via: cand === f.name ? "name" : "alias", matched: cand, len: String(cand).length }); break; }
    }
  }
  if (!hits.length) return { fundId: null, fundName: null, via: "no_match", ambiguous: false };
  const distinct = [...new Set(hits.map(h => h.fundId))];
  if (distinct.length > 1) {
    // The LONGEST match wins only when one candidate contains the other
    // ("Xenia" inside "Xenia Mission Trip"); two unrelated funds is a question.
    return { fundId: null, fundName: null, via: "ambiguous", ambiguous: true,
             candidates: hits.map(h => ({ fundId: h.fundId, fundName: h.fundName, matched: h.matched })) };
  }
  const best = hits.sort((a, b) => b.len - a.len)[0];
  return { fundId: best.fundId, fundName: best.fundName, via: best.via, matched: best.matched, ambiguous: false };
}

// ── Who this is ────────────────────────────────────────────────────────────
// `donors` = [{ id, name, email }]. The SAME name rule the importer uses, so a
// name the importer would fold and a name the deposit sheet would fold are the
// same name. Two matches is `ambiguous`; none is a new person, which is a fact
// rather than a guess.
export function matchDepositDonor(name, donors = []) {
  const mk = matchNameKey(name);
  if (!mk.key) return { donorId: null, donorName: null, ambiguous: false, nameable: false };
  const hits = donors.filter(d => matchNamesCompatible(matchNameKey(d.name), mk));
  if (hits.length === 1) return { donorId: hits[0].id, donorName: hits[0].name, ambiguous: false, nameable: true };
  if (hits.length > 1) return { donorId: null, donorName: null, ambiguous: true, nameable: true, candidates: hits.slice(0, 5).map(d => ({ id: d.id, name: d.name })) };
  return { donorId: null, donorName: normalizeName(name), ambiguous: false, nameable: true };
}

// ── An instalment, or nearly one ───────────────────────────────────────────
// `installments` = [{ id, pledgeId, donorId, dueDate, amountCents }] — OPEN
// ones only. An exact amount on the right donor places as a pledge payment. An
// amount WITHIN TEN PER CENT is `needs_you`: it is probably the instalment and
// probably is not, and the difference matters to a balance somebody reports.
export const INSTALLMENT_NEAR_PCT = 0.10;

export function matchInstallment(donorId, cents, installments = []) {
  if (!donorId || !cents) return { installmentId: null, near: false };
  const mine = installments.filter(i => i.donorId === donorId);
  const exact = mine.find(i => i.amountCents === cents);
  if (exact) return { installmentId: exact.id, pledgeId: exact.pledgeId, dueDate: exact.dueDate, near: false, amountCents: exact.amountCents };
  const near = mine.find(i => i.amountCents > 0 && Math.abs(i.amountCents - cents) <= Math.round(i.amountCents * INSTALLMENT_NEAR_PCT));
  if (near) return { installmentId: null, nearInstallmentId: near.id, pledgeId: near.pledgeId, dueDate: near.dueDate, near: true, amountCents: near.amountCents };
  return { installmentId: null, near: false };
}

// ── The plan ───────────────────────────────────────────────────────────────
// One entry per row, with its state, the reason for it, and the answer it
// needs. Plus the equation: the slip is only recordable when every line is
// explained and the cents add up.
export function buildDepositPlan({ rows = [], refused = [], donors = [], funds = [], installments = [],
                                   defaultFundId = null, slipTotal = null, depositDate = null,
                                   resolutions = {} } = {}) {
  const c = v => { const m = normalizeMoney(v); return m.value == null ? null : Math.round(m.value * 100); };
  const lines = [];

  for (const r of refused) {
    lines.push({ line: r.line, raw: r.raw, name: "", amount: null, cents: null, memo: "",
                 state: "needs_you", reason: "unreadable_line", needs: r.reason });
  }

  for (const r of rows) {
    const res = resolutions[String(r.line)] || {};
    const cents = c(r.amount);
    const base = { line: r.line, raw: r.raw, name: r.name, memo: r.memo, check: r.check || "",
                   amount: r.amount, cents };

    // The user's own answer, given on the Needs-you list, outranks everything
    // below it — that is what resolving one MEANS.
    if (res.notAGift === true) {
      const d = matchDepositDonor(r.name, donors);
      lines.push({ ...base, state: "not_a_gift", reason: res.reason || "marked_by_you",
                   donorId: d.donorId || null, donorName: d.donorName || r.name });
      continue;
    }

    if (cents == null) {
      lines.push({ ...base, state: "needs_you", reason: "unreadable_amount",
                   needs: `Steward could not read "${r.amount}" as money.` });
      continue;
    }

    const cls = classifyDepositLine({ name: r.name, memo: r.memo });
    if (cls.kind === "not_a_gift" && res.isGift !== true) {
      const d = matchDepositDonor(r.name, donors);
      lines.push({ ...base, state: "not_a_gift", reason: cls.reason, matched: cls.matched,
                   donorId: d.donorId || null, donorName: d.donorName || r.name });
      continue;
    }

    // WHO
    const donor = res.donorId ? { donorId: res.donorId, donorName: (donors.find(d => d.id === res.donorId) || {}).name || r.name, ambiguous: false, nameable: true }
      : res.newDonor === true ? { donorId: null, donorName: normalizeName(r.name), ambiguous: false, nameable: true, forced: true }
      : matchDepositDonor(r.name, donors);
    if (!donor.nameable) {
      lines.push({ ...base, state: "needs_you", reason: "no_name", needs: "This line has no name on it. Say whose gift it is." });
      continue;
    }
    if (donor.ambiguous) {
      lines.push({ ...base, state: "needs_you", reason: "ambiguous_donor",
                   needs: `More than one person answers to "${r.name}". Say which.`,
                   candidates: donor.candidates });
      continue;
    }

    // WHICH FUND. A guessed designation is an audit finding, so there are
    // exactly three honest outcomes and one of them is a question.
    let fundId = res.fundId || null, fundVia = res.fundId ? "you" : null, fundName = null;
    if (!fundId) {
      const fm = matchFundFromMemo(r.memo, funds);
      if (fm.ambiguous) {
        lines.push({ ...base, state: "needs_you", reason: "ambiguous_fund", donorId: donor.donorId,
                     donorName: donor.donorName, newDonor: !donor.donorId,
                     needs: `"${r.memo}" could be more than one fund. Say which.`,
                     fundCandidates: fm.candidates, funds: funds.map(f => ({ id: f.id, name: f.name })) });
        continue;
      }
      if (fm.fundId) { fundId = fm.fundId; fundVia = fm.via; fundName = fm.fundName; }
      else if (fm.via === "blank" && defaultFundId) { fundId = defaultFundId; fundVia = "org_default"; }
      else {
        lines.push({ ...base, state: "needs_you", donorId: donor.donorId, donorName: donor.donorName,
                     newDonor: !donor.donorId,
                     reason: fm.via === "blank" ? "no_default_fund" : "unmatched_memo",
                     needs: fm.via === "blank"
                       ? "No memo, and this organisation has not set an unrestricted default. Say which fund."
                       : `Nothing matches the memo "${r.memo}". Say which fund.`,
                     funds: funds.map(f => ({ id: f.id, name: f.name })) });
        continue;
      }
    }
    if (!fundName) fundName = (funds.find(f => f.id === fundId) || {}).name || null;

    // A PLEDGE INSTALMENT, or nearly one.
    let inst = { installmentId: null, near: false };
    if (donor.donorId && res.installmentId !== null) {
      inst = res.installmentId ? { installmentId: res.installmentId, near: false }
        : matchInstallment(donor.donorId, cents, installments);
    }
    if (inst.near && res.installmentId === undefined) {
      lines.push({ ...base, state: "needs_you", reason: "near_installment", donorId: donor.donorId,
                   donorName: donor.donorName, fundId, fundName,
                   needs: `This is within ten per cent of an instalment of ${(inst.amountCents / 100).toFixed(2)} due ${inst.dueDate}. Is it that payment, or a separate gift?`,
                   nearInstallmentId: inst.nearInstallmentId, funds: funds.map(f => ({ id: f.id, name: f.name })) });
      continue;
    }

    lines.push({ ...base,
      state: donor.donorId ? "placed" : "placed_new_donor",
      donorId: donor.donorId, donorName: donor.donorName, newDonor: !donor.donorId,
      fundId, fundName, fundVia,
      installmentId: inst.installmentId || null, pledgeId: inst.pledgeId || null,
      reason: null });
  }

  const sum = pred => lines.filter(pred).reduce((s, l) => s + (l.cents || 0), 0);
  const giftCents = sum(l => l.state === "placed" || l.state === "placed_new_donor");
  const notGiftCents = sum(l => l.state === "not_a_gift");
  const needsCents = sum(l => l.state === "needs_you");
  const slipCents = slipTotal == null || slipTotal === "" ? null : c(slipTotal);
  const accounted = giftCents + notGiftCents;
  const needsYou = lines.filter(l => l.state === "needs_you");

  return {
    depositDate: depositDate || null,
    lines,
    counts: {
      placed: lines.filter(l => l.state === "placed").length,
      placedNewDonor: lines.filter(l => l.state === "placed_new_donor").length,
      needsYou: needsYou.length,
      notAGift: lines.filter(l => l.state === "not_a_gift").length,
      total: lines.length,
    },
    totals: { giftCents, notGiftCents, needsCents, accountedCents: accounted, slipCents },
    // THE GATE. Two conditions, both stated on screen: nothing unexplained,
    // and the cents add up. `balanced` is null when nobody typed a slip total —
    // an unstated total is not a passed check.
    balanced: slipCents == null ? null : accounted + needsCents === slipCents,
    canCommit: needsYou.length === 0 && slipCents != null && accounted === slipCents && giftCents >= 0,
    commitLabel: `Record deposit of ${(giftCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })}, ${lines.filter(l => l.state === "placed" || l.state === "placed_new_donor").length} gift${giftCents === 0 || lines.filter(l => l.state === "placed" || l.state === "placed_new_donor").length === 1 ? "" : "s"}`,
  };
}

// ── The instalment schedule ────────────────────────────────────────────────
// A pledge that states a cadence but no schedule can generate one. Cents are
// split so the instalments SUM to the pledge: the remainder rides the first,
// never a rounding error that leaves a balance nobody can clear.
export const PLEDGE_FREQUENCIES = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12, yearly: 12 };

export function generateInstallments({ amountCents, frequency, count, firstDue }) {
  const step = PLEDGE_FREQUENCIES[String(frequency || "").toLowerCase()];
  const n = Number(count) || 0;
  if (!step || n < 1 || !amountCents || !/^\d{4}-\d{2}-\d{2}$/.test(String(firstDue || ""))) return [];
  const each = Math.floor(amountCents / n);
  const remainder = amountCents - each * n;
  const [y, m, d] = String(firstDue).split("-").map(Number);
  const out = [];
  for (let i = 0; i < n; i++) {
    const mo = m - 1 + i * step;
    const yy = y + Math.floor(mo / 12);
    const mm = (mo % 12 + 12) % 12;
    // The last day of the target month, so the 31st of a 30-day month is the
    // 30th rather than the 1st of the month after.
    const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
    const day = Math.min(d, last);
    out.push({ seq: i + 1,
               dueDate: `${yy}-${String(mm + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
               amountCents: each + (i === 0 ? remainder : 0) });
  }
  return out;
}
