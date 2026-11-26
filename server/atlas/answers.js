// server/atlas/answers.js · ATLAS-3. WHAT ATLAS ANSWERS WITH, NOT ONLY WHAT IT SAYS.
//
// Muse's walks (4 and 5 Nov) found four answers that were one line of text:
//   1. A LIST QUESTION ("who gave last December but not this year?") came back
//      as "22 people match … Sterling Nakamura first", with no names to click.
//      listAnswer keeps the people the Ask answer already carries (names, what
//      each gave, the count) and every id behind it, so "Open list" opens the
//      same set every time: one static group made on the first click and
//      reopened after that (routes/atlas.js POST /atlas/actions/:id/list).
//   2. A PERSON ANSWER ("tell me about Marlowe") had the numbers and not the
//      About note. personAnswer reads the About note, the last three
//      conversations and the next step beside the giving.
//   3. A THANK-YOU "for his $10,000 gift" was drafted for a gift that is not
//      on record. unrecordedAmount says when her words name an amount the
//      record does not have, and Atlas asks to record it first.
//   4. "Link Stephen and Margaret" was read as a merge and refused. linkKind
//      reads the relation from her words; with none, the profile's own link
//      picker opens with both people found.
// Every number here is read from the record (the donor row the profile reads,
// shared/numbers for the totals). Nothing is computed from the model's words.
"use strict";

const MAX_IDS = 5000;          // a group of more than this is a filter, not a list
const SHOWN = 10;              // names in the dialog; Open list has all of them
const usd = cents => require("../../money").formatCentsPlain(cents || 0);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = d => { const s = String(d || "").slice(0, 10); const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : ""; };
const { toCents: moneyCents } = require("../../money");
const { endOnName } = require("../../shared/endOnName.js");   // POLISH-12
const toCents = v => moneyCents(v) || 0;

// ── 1. A LIST ──────────────────────────────────────────────────────────────
// The people an Ask answer carries, whatever its shape: the query layer's
// `people`, Show me's `rows`, a why answer's `people`.
function answerPeople(ask) {
  if (!ask || ask.answered === false) return [];
  const list = Array.isArray(ask.people) && ask.people.length ? ask.people : Array.isArray(ask.rows) ? ask.rows : [];
  return list.filter(p => p && p.donorId && p.name);
}
const answerSource = ask => (ask && (ask.peopleSource || ask.countSource)) || null;
// What every one of them has in common, in Steward's own words for the filter.
function sharedReason(ask) {
  if (!ask) return "";
  // MONEY-3's plain words ("gave last December, nothing since Jan 1"), the one Ask shows.
  if (ask.reasonWords) return String(ask.reasonWords);
  if (ask.planWords) return String(ask.planWords).split(" · ").slice(1).join(" · ") || String(ask.planWords);
  if (Array.isArray(ask.words) && ask.words.length) return ask.words.join(" · ");
  return "";
}

// ATLAS-4 · WHAT EACH PERSON GAVE THAT MATCHED. Asked "who gave last
// December", the figure that answers is what they gave last December ("$2,144
// in Dec 2025"). TRUTH-5: the window and the amounts are shared/numbers/
// periodAmounts.js's, the rule the Ask answer's people read too, and Lifetime is
// labeled "Lifetime" (the profile's figure, never the stored rollup).
const PA = require("../../shared/numbers/periodAmounts");
const matchWindow = PA.windowOf;

async function listAnswer({ ask, query, orgId, asHer, req, today = null }) {
  const people = answerPeople(ask);
  if (!people.length) return null;
  // FLOWS-15 item 3 (W-1116-Atlas-01X): the count is a count of PEOPLE, from the answer's own
  // unit (shared/numbers/answerUnit.js), never its money or date. A money or date answer about
  // one person is that figure, said in the sentence, and not a list of one.
  const AU = require("../../shared/numbers/answerUnit");
  const count = AU.answerPeopleCount(ask, people.length) || people.length;
  if (!AU.isPeopleList(ask, count)) return null;
  // Every id behind the answer, read once now, so the list she opens later is
  // this answer's list and not a fresh reading of the question.
  let ids = people.map(p => p.donorId);
  const src = answerSource(ask);
  if (src && src.key && count > ids.length) {
    const qs = new URLSearchParams(Object.entries(src.params || {}).map(([k, v]) => [k, String(v)])).toString();
    const r = await asHer(req, "GET", `/figures/${encodeURIComponent(src.key)}/people${qs ? "?" + qs : ""}`);
    if (r.status < 300 && r.body && Array.isArray(r.body.donorIds) && r.body.donorIds.length) ids = r.body.donorIds;
  }
  ids = [...new Set(ids)].slice(0, MAX_IDS);
  const shown = people.slice(0, SHOWN);
  const rows = shown.length ? await query(
    `SELECT id, last_gift_amount, last_gift_date FROM donors WHERE org_id=? AND id = ANY(?::text[])`, [orgId, shown.map(p => p.donorId)]) : [];
  const life = await PA.lifetimeCents(query, orgId, shown.map(p => p.donorId));
  const byId = new Map(rows.map(r => [r.id, r]));
  const why = sharedReason(ask);
  const day0 = today || new Date().toISOString().slice(0, 10);
  const w = matchWindow(ask.qplan || ask.plan, day0);
  const matched = w ? await PA.periodCents(query, orgId, shown.map(p => p.donorId), w, day0).catch(e => { console.error("[atlas] matched:", e.message); return null; }) : null;
  // ATLAS-9 item 4 (Jarvis, 23 Nov: "a $19,049 donor reads as an $80 donor"): a ranking by what each
  // gave in a period ("top donors this year") carries each person's own period total, the figure its
  // sentence adds up and Reports > Top donors shows. Never their last gift in its place.
  const pw = !w ? periodTotalWords(ask) : null;
  return {
    count, unit: "people", ids, reason: why, more: Math.max(0, count - shown.length),
    people: shown.map(p => {
      const r = byId.get(p.donorId) || {};
      const last = toCents(r.last_gift_amount) > 0 && r.last_gift_date ? `last gift ${usd(toCents(r.last_gift_amount))} on ${day(r.last_gift_date)}` : "no gift on record";
      const lifetime = `Lifetime ${usd(life.get(p.donorId) || 0)}`;
      const m = matched && matched.get(p.donorId);
      if (pw && Number.isFinite(Number(p.cents))) { const a4 = `${usd(Math.round(Number(p.cents)))} ${pw}`; return { donorId: p.donorId, name: p.name, amount: a4, lifetime, reason: `${a4}; ${lifetime}` }; }
      // The matched amount first; with no window to read, what they last gave.
      if (m > 0) return { donorId: p.donorId, name: p.name, amount: `${usd(m)} ${w.words}`, lifetime, reason: `${usd(m)} ${w.words}; ${lifetime}` };
      return { donorId: p.donorId, name: p.name, amount: last, lifetime, reason: `${last}; ${lifetime}` };
    }),
    countSentence: `${count.toLocaleString("en-US")} ${count === 1 ? "person matches" : "people match"}${why ? ` (${why})` : ""}.`,
  };
}

// The words for a period-total ranking's figure ("this year"), or null when the answer is not one:
// Ask's plan ranks people by money raised over a period and each person carries their own cents.
function periodTotalWords(ask) {
  const plan = ask && (ask.plan || ask.qplan);
  const people = answerPeople(ask);
  if (!plan || plan.metric !== "raised" || plan.kind !== "who" || !plan.period || !people.length || !people.every(p => Number.isFinite(Number(p.cents)))) return null;
  const label = String((ask.figures && ask.figures.value && ask.figures.value.label) || "");
  const said = label.includes(" · ") ? label.split(" · ").slice(1).join(" · ").replace(/\s*\([^)]*\)\s*$/, "").trim() : "";
  if (said) return said;
  const K = { this_year: "this year", last_year: "last year", all_time: "in all", this_month: "this month", last_month: "last month" };
  return K[plan.period.kind] || "in the period asked";
}

// The group "Open list" opens: named for her question, kept by hand, so it is
// the same people every time it opens.
function groupName(text, today) {
  const q = String(text || "Atlas list").replace(/[?.!]+$/, "").replace(/\s+/g, " ").trim();
  const base = q.length > 52 ? q.slice(0, 52).replace(/\s+\S*$/, "") + "…" : q;
  return `${base} (${day(today).replace(/, \d{4}$/, "")})`;
}

// ── 2. ONE PERSON ──────────────────────────────────────────────────────────
// "Tell me about Marlowe": what is open (ATLAS-9: asks, gifts not yet thanked, the
// next meeting, the next step), then giving, conversations and About, each a line with where it lives.
async function personAnswer({ query, orgId, donorId, today, more = false }) {   // ATLAS-10: `more` is "Tell me more": every open item, more conversations
  // TRUTH-3: lifetime, the gift count and the last gift by the profile's rules (shared/numbers), never the stored rollup.
  const [d] = await query(`SELECT d.id, d.name, d.about_them, ROUND(${require("../../shared/numbers/lifetime").LIFETIME("d")}, 2) AS total_giving, ${require("../../shared/numbers/giftCount").GIFT_COUNT("d")} AS gift_count,
                                    (SELECT lg.amount FROM gifts lg WHERE lg.org_id = d.org_id AND lg.donor_id = d.id AND ${require("../../shared/numbers/money").GIFT("lg")} AND lg.date IS NOT NULL ORDER BY ${require("../../shared/numbers/lastGift").LAST_GIFT_ORDER.replace(/\bg\./g, "lg.")} LIMIT 1) AS last_gift_amount,
                                    (SELECT LEFT(lg.date, 10) FROM gifts lg WHERE lg.org_id = d.org_id AND lg.donor_id = d.id AND ${require("../../shared/numbers/money").GIFT("lg")} AND lg.date IS NOT NULL ORDER BY ${require("../../shared/numbers/lastGift").LAST_GIFT_ORDER.replace(/\bg\./g, "lg.")} LIMIT 1) AS last_gift_date, ${require("../../shared/numbers/firstGift").FIRST_DATE("d")} AS donor_since, d.stage, d.deceased, d.do_not_contact
                             FROM donors d WHERE d.id=? AND d.org_id=? AND d.deleted_at IS NULL`, [donorId, orgId]);
  if (!d) return null;
  const first = String(d.name).split(/\s+/)[0];
  // ATLAS-8 item 5: the last conversation of any kind (the profile's rule, and a volunteer shift), and the About facts.
  const BR = require("./briefReads");
  const [convs, aboutLines] = await Promise.all([BR.lastConversations(query, orgId, donorId, more ? 10 : 3, today), BR.aboutFacts(query, orgId, donorId)]);
  const [task] = await query(`SELECT id, title, due FROM tasks WHERE org_id=? AND donor_id=? AND COALESCE(done,0)=0 AND voided_at IS NULL
                               ORDER BY due NULLS LAST, created_at LIMIT 1`, [orgId, donorId]).catch(() => []);
  const [plan] = task ? [] : await query(`SELECT s.label, s.due_date FROM cultivation_plans p JOIN cultivation_plan_steps s ON s.plan_id = p.id
                               WHERE p.org_id=? AND p.donor_id=? AND p.status='active' AND s.status IN ('open','pending') ORDER BY s.seq LIMIT 1`, [orgId, donorId]).catch(() => []);
  const n = Number(d.gift_count) || 0;
  const giving = n
    ? `${first} has given ${usd(toCents(d.total_giving))} across ${n} ${n === 1 ? "gift" : "gifts"}, most recently ${usd(toCents(d.last_gift_amount))} on ${day(d.last_gift_date)}.${d.donor_since ? ` Donor since ${day(String(d.donor_since).slice(0, 10))}.` : ""}`
    : `${first} has no gifts on record yet.`;
  const about = String(d.about_them || "").trim();
  const TYPE = BR.TYPE;
  // ATLAS-9 item 1: what is open leads (asks, gifts not yet thanked, the next meeting, the next step), then what happened.
  const open = await require("./briefOpen").openItems(query, orgId, donorId, { today, first, ...(more ? { show: 1000 } : {}) });
  // ATLAS-10 item 2: the profile's Next move, from the one function its panel reads (server/insights/nextMoveOf.js).
  const nm = await require("../insights/nextMoveOf").nextMoveOf(query, orgId, donorId, today || require("../../orgTime").civilOf(new Date()).slice(0, 10))
    .catch(e => { console.error("[atlas] next move:", e.message); return {}; });
  const MS = nm.move ? await import("../../shared/moveSentence.js") : null;
  const moveLine = nm.move ? { kind: "next_move", line: `Next move: ${MS.moveSentence(nm.move.item && nm.move.item.how, first, nm.move.title).replace(/\.$/, "")} (${nm.move.title}).`, link: { tab: "donor", donorId } }
    : nm.after && nm.after.thank ? { kind: "next_move", line: `Next: thank ${first} for the ${nm.after.amount} gift on ${nm.after.day}.`, link: { tab: "donor", donorId, section: "giving" } }   // the profile's own words
    : null;
  const step = task ? { kind: "next", line: `Next step: ${task.title}${task.due ? `, due ${day(task.due)}` : ""}.`, link: { tab: "donor", donorId, section: "thread" } }
    : plan ? { kind: "next", line: `Next step: ${plan.label}${plan.due_date ? `, due ${day(plan.due_date)}` : ""}.`, link: { tab: "donor", donorId, section: "thread" } }
    : null;
  const nexts = [moveLine, step].filter(Boolean);
  if (!nexts.length) nexts.push({ kind: "next", line: nm.preparing ? `There is no next step planned for ${first} yet, and Steward is still working out the next moves.` : `There is no next step planned for ${first}.`, link: { tab: "donor", donorId, section: "thread" } });
  const convLines = convs.filter((c, i) => convs.findIndex(x => x.id === c.id) === i).map(c => ({ kind: "conversation", id: c.id, line: `${TYPE[c.type] || "Conversation"}, ${day(c.date)}${String(c.note || "").trim() ? `: "${String(c.note).replace(/\s+/g, " ").slice(0, 160)}"` : ""}`, link: { tab: "donor", donorId, section: c.section || "timeline" } }));
  const facts = [
    ...open,
    ...nexts,
    { kind: "giving", line: giving, link: { tab: "donor", donorId, section: "giving" } },
    ...(convLines.length ? convLines : [{ kind: "conversation", line: `No conversation with ${first} is logged yet.`, link: { tab: "donor", donorId, section: "timeline" } }]),
    about ? { kind: "about", line: `About ${first}: ${about}`, link: { tab: "donor", donorId } }
      : { kind: "about", line: `Nobody has written an About note for ${first} yet.`, link: { tab: "donor", donorId } },
    // ATLAS-5 (W-1108-Atlas-02X): each note once, by its id.
    ...aboutLines.map(l => ({ kind: "about", line: `${l}.`, link: { tab: "donor", donorId } })),
  ];
  if (more) facts.push(...await moreFacts(query, orgId, donorId, first));   // ATLAS-11 item 3: what the brief doesn't say
  if (d.deceased) facts.unshift({ kind: "care", line: `${d.name} is marked as deceased.`, link: { tab: "donor", donorId } });
  else if (d.do_not_contact) facts.unshift({ kind: "care", line: `${d.name} is marked do not contact.`, link: { tab: "donor", donorId } });
  return { donorId, name: d.name, about, spoke: more ? `Here's everything Steward holds on ${endOnName(d.name)}` : `Here's what Steward knows about ${endOnName(d.name)}`, facts, today, more };
}

// ATLAS-11 item 3 (Jarvis: "Tell me more adds nothing"): Tell me more on a person adds what the
// brief never says: how to reach them (contactDetails.js, the profile's Contact section) and their
// gift history, newest first, each gift by the one rule (money.js GIFT) with where it went.
const HISTORY = 12;
async function moreFacts(query, orgId, donorId, first) {
  const [[c], gifts, [n]] = await Promise.all([
    query(`SELECT email, email2, phone, mobile, address, address2, city, state, zip, country FROM donors WHERE id=? AND org_id=?`, [donorId, orgId]).catch(() => [null]),
    query(`SELECT g.id, LEFT(g.date, 10) AS date, ROUND(g.amount * 100)::bigint AS cents, COALESCE(c.name, f.name) AS place
             FROM gifts g LEFT JOIN campaigns c ON c.id = g.campaign_id AND c.org_id = g.org_id LEFT JOIN fin_funds f ON f.id = g.fund_id AND f.org_id = g.org_id
            WHERE g.org_id=? AND g.donor_id=? AND ${require("../../shared/numbers/money").GIFT("g")} AND g.date IS NOT NULL
            ORDER BY ${require("../../shared/numbers/lastGift").LAST_GIFT_ORDER} LIMIT ${HISTORY}`, [orgId, donorId]).catch(() => []),
    query(`SELECT COUNT(*)::int AS n FROM gifts g WHERE g.org_id=? AND g.donor_id=? AND ${require("../../shared/numbers/money").GIFT("g")} AND g.date IS NOT NULL`, [orgId, donorId]).catch(() => [{ n: 0 }]),
  ]);
  const CD = await import("../../shared/contactDetails.js");
  const ways = CD.contactLines(c || null);
  const reach = [ways.email && `email ${ways.email}`, ways.email2 && `also ${ways.email2}`, ways.phone && `phone ${ways.phone}`, ways.mobile && `mobile ${ways.mobile}`, ways.address && `address ${ways.address}`].filter(Boolean);
  const out = [{ kind: "contact", line: reach.length ? `To reach ${first}: ${reach.join("; ")}.` : `Steward has no email, phone or address for ${first}.`, link: { tab: "donor", donorId, section: "contact" } }];
  gifts.forEach((g, i) => out.push({ kind: "gift", id: g.id, line: `${i === 0 ? "Gift history: " : ""}${usd(Number(g.cents))} on ${day(g.date)}${g.place ? `, ${g.place}` : ""}.`, link: { tab: "donor", donorId, section: "giving" } }));
  const total = Number(n && n.n) || 0;
  if (total > gifts.length) out.push({ kind: "gift", line: `And ${total - gifts.length} earlier ${total - gifts.length === 1 ? "gift" : "gifts"} on their Giving tab.`, link: { tab: "donor", donorId, section: "giving" } });
  return out;
}

// ── 3. A GIFT SHE NAMED THAT IS NOT ON RECORD ──────────────────────────────
// "Thank him for his $10,000 gift": the cents she said, when no gift or
// pledge of that amount from this person is on record. null when there is
// no amount in her words, or the record has it.
async function unrecordedAmount({ query, orgId, donorId, words, amountFromWords }) {
  const cents = amountFromWords(String(words || ""));
  if (!cents) return null;
  const dollars = cents / 100;
  const [g] = await query(`SELECT 1 AS x FROM gifts WHERE org_id=? AND donor_id=? AND ABS(amount - ?) < 0.005 LIMIT 1`, [orgId, donorId, dollars]).catch(() => []);
  if (g) return null;
  const [p] = await query(`SELECT 1 AS x FROM pledges WHERE org_id=? AND donor_id=? AND ABS(amount - ?) < 0.005 LIMIT 1`, [orgId, donorId, dollars]).catch(() => []);
  return p ? null : cents;
}

// ── 4. LINKING TWO PEOPLE ──────────────────────────────────────────────────
// The relation, when her words say it. None: the picker asks her.
function linkKind(words) {
  const t = String(words || "").toLowerCase();
  if (/\b(spouse|spouses|married|wife|husband)\b/.test(t)) return "spouse";
  if (/\b(partner|partners)\b/.test(t)) return "partner";
  if (/\b(works at|works for|employee of|employer)\b/.test(t)) return "works_at";
  if (/\b(owns|owner of)\b/.test(t)) return "owner";
  if (/\b(household|live together|lives with)\b/.test(t)) return "household";
  if (/\b(sister|brother|sibling|mother|father|son|daughter|cousin|aunt|uncle|family|related)\b/.test(t)) return "family";
  return null;
}
const LINK_WORD = { spouse: "spouses", partner: "partners", works_at: "works at", owner: "owner", household: "one household", family: "family" };

const LINK_CHOICES = [["spouse", "Spouses", "Married; one household"], ["partner", "Partners", "One household"], ["family", "Family", "Related, separate households"],
  ["household", "Same household", "Live together"], ["works_at", "Works at", "A person and the organization they work for"]];
const recordFirstLine = (amount, name) => `I don't see a ${amount} gift from ${name} on record, so I didn't write a thank-you for it. Record it first: tap to record, then ask me for the thank-you.`;

// ── WHAT THE BROWSER GETS ──────────────────────────────────────────────────
// The list's every id stays on the server (Open list reads them); the dialog
// gets the names it shows.
function publicAnswer(a) {
  if (!a || typeof a !== "object") return null;
  if (a.type === "list") return { type: "list", question: a.question, count: a.count, unit: a.unit || null, reason: a.reason, more: a.more, people: a.people, countSentence: a.countSentence, groupId: a.groupId || null };
  if (a.type === "person") return { type: "person", donorId: a.donorId, name: a.name, about: a.about, facts: a.facts };
  // ATLAS-8: a why answer's people, each with their reason and what is at stake, and the total of what is drawn.
  if (a.type === "why") return { type: "why", count: a.count, more: a.more, total: a.total, totalCents: a.totalCents, definition: a.definition, stakeWord: a.stakeWord || null,   // ATLAS-9: "lifetime" on a population's call list
    people: (a.people || []).map(p => ({ donorId: p.donorId, name: p.name, reason: p.reason, atStake: p.atStake, cents: p.cents })) };
  if (a.type === "figure") return { type: "figure", parts: a.parts };   // ATLAS-8: a Home figure, each part named
  // ATLAS-11 item 1: "Did you mean Annual Fund 2026 or Annual Fund 2025?", each a question she can send with one press.
  if (a.type === "choices") return { type: "choices", options: (a.options || []).map(o => ({ label: o.label, ask: o.ask })) };
  return null;
}

// ── TELL ME MORE: THE CONVERSATION GOES ON ─────────────────────────────────
// The request before this one, read for who it was about, so "what did she
// give last year?" after "tell me about Marlowe" is about Marlowe.
async function priorContext({ query, orgId, userId, followsId, parse }) {
  if (!followsId) return null;
  const [m] = await query("SELECT id, read, donor_ids FROM voice_memos WHERE id=? AND org_id=? AND created_by=? AND source LIKE 'atlas%'", [String(followsId), orgId, userId]);
  if (!m) return null;
  const read = parse(m.read) || {};
  const answers = Object.values(read.answers || {});
  const person = answers.reverse().find(a => a && a.type === "person");
  const list = answers.find(a => a && (a.type === "list" || a.type === "why"));   // ATLAS-8: a why answer's people are its list
  const ids = parse(m.donor_ids) || [];
  let last = person ? { id: person.donorId, name: person.name } : null;
  if (!last && ids.length) { const [d] = await query("SELECT id, name FROM donors WHERE id=? AND org_id=?", [ids[ids.length - 1], orgId]); if (d) last = { id: d.id, name: d.name }; }
  const people = list ? list.people.map(p => ({ id: p.donorId, name: p.name })) : last ? [last] : [];
  return { id: m.id, onPage: last, context: { ...(last ? { lastPerson: last } : {}), people, ...(list ? { list: list.people.map(p => ({ donorId: p.donorId, name: p.name })) } : {}) } };
}

module.exports = { periodTotalWords, matchWindow, LINK_CHOICES, recordFirstLine, publicAnswer, priorContext, listAnswer, answerPeople, groupName, personAnswer, unrecordedAmount, linkKind, LINK_WORD, MAX_IDS, SHOWN };
