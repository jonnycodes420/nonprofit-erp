// shared/numbers/financeBasis.js · TRUTH-6 (W-1107-Finance-39X). EACH FINANCE TOTAL NAMES ITS BASIS, AND ONE LINE RECONCILES.
//
// The fleet read "Waiting to post $1.7M / 4,383 gifts", "Posted $148k" and
// "FY revenue $368k" beside Fundraising's FY $224,991, with no stated basis.
// They are different questions, each true:
//   Posted           gifts the ledger carries (posted in deposit batches)
//   Waiting to post  gifts recorded in Steward, not posted yet
//   FY revenue       income in the ledger dated in the year: posted gifts (by
//                    the ledger's date), grants and other income
//   Fundraising FY   every gift dated in the year so far (money.js MONEY), the
//                    Reports and Fundraising figure
// and one line goes from Fundraising's to Finance's:
//   Fundraising $A − gifts not posted yet $W + income that is not a gift $O
//   + scheduled gifts already in the ledger $S ± posted gifts dated in another
//   year $Z = Finance FY revenue $R
// Every part is computed; Z is what the ledger holds for gifts dated outside
// the year (or posted at another amount), so the line always foots.
"use strict";
const { MONEY, LIVE } = require("./money");
const { POSTED } = require("./ledgerStatus");
const { SCHEDULED } = require("./scheduled");

const BASIS = {
  posted: "Posted to the ledger (deposit batches): gifts the ledger carries, each posted as revenue to its fund.",
  waiting: "Waiting to post: gifts recorded in Steward that have not posted yet. Each posts with its deposit.",
  revenue: "Income in the ledger dated in this period: posted gifts (by the ledger's date), grants and other income. A gift waiting to post is not in it until it posts.",
  fundraising: "Every gift dated in this period so far, refunds taken off, credits left out: the figure Reports and Fundraising show.",
};

const usd = c => (c < 0 ? "−" : "") + "$" + (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: Math.abs(c) % 100 ? 2 : 0, maximumFractionDigits: 2 });

// { fundraisingCents, waitingCents, otherIncomeCents, elsewhereCents, revenueCents, line, sentence }
async function financeBasis(query, orgId, { from, to, today, revenueCents }) {
  const giftTo = to < today ? to : today;
  const [[a], [o], [sc]] = await Promise.all([
    query(`SELECT COALESCE(SUM(ROUND(g.amount * 100)), 0)::bigint AS all_c,
                  COALESCE(SUM(ROUND(g.amount * 100)) FILTER (WHERE NOT ${POSTED("g")}), 0)::bigint AS waiting_c
             FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
            WHERE g.org_id = ? AND ${LIVE("d")} AND ${MONEY("g")} AND LEFT(g.date, 10) >= ? AND LEFT(g.date, 10) <= ?`, [orgId, from, giftTo]),
    query(`SELECT COALESCE(SUM(ROUND(t.amount * 100)), 0)::bigint AS c FROM fin_transactions t
            WHERE t.org_id = ? AND t.type = 'income' AND t.gift_id IS NULL AND t.date >= ? AND t.date <= ?`, [orgId, from, to]),
    // A scheduled gift (dated after today) that a ledger row already carries.
    query(`SELECT COALESCE(SUM(ROUND(t.amount * 100)), 0)::bigint AS c FROM fin_transactions t JOIN gifts g ON g.id = t.gift_id AND g.org_id = t.org_id
            WHERE t.org_id = ? AND t.type = 'income' AND t.date >= ? AND t.date <= ? AND ${SCHEDULED("g")}`, [orgId, from, to]),
  ]);
  const A = Number(a.all_c) || 0, W = Number(a.waiting_c) || 0, O = Number(o.c) || 0, R = Number(revenueCents) || 0;
  const S = Number(sc.c) || 0;
  const Z = R - (A - W + O + S);
  const X = R - A;
  return {
    fundraisingCents: A, waitingCents: W, otherIncomeCents: O, scheduledCents: S, elsewhereCents: Z, revenueCents: R,
    // The line the brief asks for, then each part of X, each computed.
    line: `Fundraising ${usd(A)} ${X < 0 ? "−" : "+"} pledges, grants and other income ${usd(Math.abs(X))} = Finance ${usd(R)}.`,
    sentence: `Fundraising ${usd(A)} − gifts not posted yet ${usd(W)} + income that is not a gift (grants, pledges paid to the ledger, other income) ${usd(O)}`
      + (S ? ` + scheduled gifts (dated after today) the ledger already carries ${usd(S)}` : "")
      + (Z ? ` ${Z < 0 ? "−" : "+"} gifts posted in this period dated in another, or at another amount, ${usd(Math.abs(Z))}` : "")
      + ` = Finance ${usd(R)}.`,
  };
}

module.exports = { financeBasis, BASIS };
