// shared/pledgeCover.js · PLEDGES-3 (W-1107-Finance-25X). WHAT A PAYMENT COVERS, SAID BEFORE IT IS SAVED.
//
// $150 against a $100 installment was saved with no word, and the schedule
// then still said the next installment was $100 when $50 was open. A payment
// on a pledge applies oldest due first across its installments (as
// server/donors/pledgePayments.js relays it, and as Bloomerang and Raiser's
// Edge do), and the form says where the money goes before Save:
//   "This covers the Dec installment and $50 of Jan."
// Above the whole open balance it says so; the server then asks (409
// over_balance) and offers the extra as its own gift.
// `installments` are the pledge's, each with `left` (what is still open on it,
// shared/numbers/pledges.js installmentsLeft) and `dueDate`; `open` its balance.

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const cents = v => Math.round((Number(v) || 0) * 100);
const usd = c => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });

// The installments' names: "Dec" alone; "Dec 3" when two open ones share a
// month; "Dec 2027" when the same month comes round again in another year.
function namer(list) {
  const months = list.map(i => String(i.dueDate || "").slice(0, 7));
  const clash = new Set(months.filter((m, k) => m && months.indexOf(m) !== k));
  const mm = list.map(i => String(i.dueDate || "").slice(5, 7));
  const again = new Set(mm.filter((m, k) => m && mm.indexOf(m) !== k && months[mm.indexOf(m)] !== months[k]));
  return i => {
    const d = String(i.dueDate || "");
    if (!/^\d{4}-\d{2}-\d{2}/.test(d)) return "undated";
    const m = MON[Number(d.slice(5, 7)) - 1];
    const day = clash.has(d.slice(0, 7)) ? ` ${Number(d.slice(8, 10))}` : "";
    const yr = again.has(d.slice(5, 7)) ? ` ${d.slice(0, 4)}` : "";
    return `${m}${day}${yr}`;
  };
}

export function pledgeCoverWords(pledge, amount) {
  const pay = cents(amount);
  if (!pledge || !(pay > 0)) return "";
  const open = cents(pledge.balance != null ? pledge.balance : (pledge.summary && pledge.summary.open));
  const list = (pledge.installments || []).filter(i => cents(i.left) > 0)
    .slice().sort((a, b) => String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999")) || (a.seq || 0) - (b.seq || 0));
  if (open <= 0) return "Nothing is open on this pledge. Save asks whether to record it as a separate gift.";
  const over = pay > open ? pay - open : 0;
  if (!list.length) {
    const head = over ? `This pays the pledge's ${usd(open)} in full` : pay === open ? "This pays the pledge in full" : `This pays ${usd(pay)} of the ${usd(open)} still open`;
    return over ? `${head}, and ${usd(over)} is more than is open. Save asks whether to record the extra as a separate gift.` : head + ".";
  }
  const name = namer(list);
  let rest = Math.min(pay, open);
  const full = [], parts = [];
  for (const i of list) {
    if (rest <= 0) break;
    const l = cents(i.left), use = Math.min(l, rest);
    rest -= use;
    if (use === l) full.push(name(i)); else parts.push(`${usd(use)} of ${name(i)}`);
  }
  const fullWords = !full.length ? "" : full.length === 1 ? `the ${full[0]} installment`
    : `the ${full.slice(0, -1).join(", ")} and ${full[full.length - 1]} installments`;
  const said = [fullWords, ...parts].filter(Boolean).join(" and ");
  if (over) return `This covers ${said}, which pays the pledge in full, and ${usd(over)} is more than is open. Save asks whether to record the extra as a separate gift.`;
  return `This covers ${said}.`;
}
