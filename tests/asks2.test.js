// tests/asks2.test.js — ASKS-2. WHAT A REAL CUSTOMER'S FILE SHOWED ON ITS FIRST DAY.
//
// Made-up people only, one org shaped like the customer's findings:
//   §1 W-ASK-jump    largest $35,712, last three $35,712 / $2,600 / $1,880
//                    newest first (rising) was asked $75,000. The ask is at
//                    most 1.5 × the anchor, rounded naturally, Room to give
//                    known or not, and the sentence's working is the ask.
//   §2 W-DATE-gone   the Year-end givers card said "Create tasks for Nov 1" on
//                    Nov 12. With the clock at Nov 12 (asOf, TEST_MODE) no
//                    action names a day gone, and the tasks are due from
//                    today, spread largest givers first.
//   §3 W-NOTGIFT-bulk  150 program-fee rows took 150 clicks. They are one
//                    group with Not a gift / Partly / Keep for all, a preview
//                    that changes nothing, one Undo, and a group action that
//                    never touches a row outside its group. Raffles stay
//                    never partly a gift.
//
// HOW IT GOES RED (planted, see the PR):
//   §1 the step applied to the rounded-up rung (rungAbove(toFriendlyCents(anchor))): $50,000 → $75,000
//   §2 the label hard-coded "Create tasks for Nov 1"
//   §3 reviewGroup.rowsOf without the groupKey check: the ticket row is decided too
"use strict";
const bcrypt = require("bcryptjs");
const { ok, summary, api, q, login, closeDb, mailTypesOn } = require("./helpers");

const PW = "loadtest1234";
const NOV12 = "2026-11-12", OCT27 = "2026-10-27";
const query = (sql, args = []) => { let i = 0; return q(sql.replace(/\?/g, () => `$${++i}`), args); };

(async () => {
  console.log("asks2 (ASKS-2)");
  const run = require("crypto").randomBytes(4).toString("hex");
  const ORG = `org_asks2_${run}`, OWNER = `owner-${run}@asks2.local`;
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,emails_enabled,timezone,onboarded_at)
           VALUES ($1,'Asks Two Collective',$1,1,'active','team',true,'America/New_York',NOW())`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($3,$1,$4,$2,'Nell Ardent','admin')`, [ORG, bcrypt.hashSync(PW, 10), `u_asks2_${run}`, OWNER]);
  await mailTypesOn(ORG);
  const tok = await login(OWNER, PW);
  const person = async (name) => {
    const r = await api("POST", "/donors", tok, { name, email: `${name.split(" ")[0].toLowerCase()}-${run}@asks2.invalid` });
    if (!r.body || !r.body.id) throw new Error(`fixture: ${name} ${r.status}`);
    return r.body.id;
  };
  const gift = async (id, amount, date, memo) => {
    const r = await api("POST", `/donors/${id}/gifts`, tok, { amount, date, payment_method: "check", ...(memo ? { notes: memo } : {}) });
    if (!(r.status === 200 || r.status === 201)) throw new Error(`fixture gift ${amount} ${date}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    return r.body && (r.body.id || (r.body.gift && r.body.gift.id));
  };

  // ── §1 W-ASK-jump ─────────────────────────────────────────────────────────
  const SA = await import("../shared/smartAmounts.js");
  const ASK = require("../shared/numbers/ask");
  await ASK.ready;
  const tess = await person("Tessaly Brandt");
  await gift(tess, 1880, "2024-09-04"); await gift(tess, 2600, "2025-09-04"); await gift(tess, 35712, "2026-09-04");
  const rows = await query(ASK.GIFTS_SQL, [ORG, tess]);
  const cap = SA.naturalAskCents(Math.round(1.5 * 3571200));
  const known = ASK.askFor(rows, { roomKnown: true }), held = ASK.askFor(rows, { roomKnown: false });
  const working = a => a && /^Largest gift \$35,712, last 3 averaged \$13,397 and rising: ask \$([\d,]+)/.exec(a.sentence);
  ok("§1 rising, Room to give known: the step is at most 1.5 × $35,712, rounded naturally ($54,000), not $75,000",
    known && known.rising && known.askCents > 3600000 && known.askCents <= cap && known.askCents === SA.naturalAskCents(known.askCents), known);
  ok("§1 …and the sentence's working is that ask", working(known) && Number(working(known)[1].replace(/,/g, "")) * 100 === known.askCents, known && known.sentence);
  ok("§1 Room to give unknown: held at the natural $36,000, and the sentence says so", held && held.held && held.askCents === 3600000 && working(held) && /Room to give is not yet known/.test(held.sentence), held);
  const prof = await require("../engagement").suggestedAsk(query, ORG, tess);
  const profKnown = (await ASK.roomKnown(query, ORG, [tess])).has(tess);
  ok("§1 the profile reads the same function (and the same Room to give) as Home and Insights", prof && prof.askCents === ASK.askFor(rows, { roomKnown: profKnown }).askCents && prof.askCents <= cap, { prof, profKnown });
  let worst = 0;
  for (let c = 2500; c < 20000000; c = Math.ceil(c * 1.017)) worst = Math.max(worst, SA.suggestedAskCents({ largestCents: c, lastThreeCents: [c, Math.round(c / 3)] }).askCents / c);
  ok("§1 no rising anchor from $25 to $200,000 is asked more than 1.5 × itself", worst <= 1.5, worst);

  // ── §2 W-DATE-gone ────────────────────────────────────────────────────────
  const decIds = [];
  for (let i = 0; i < 12; i++) { const id = await person(`Yule Giver ${String.fromCharCode(65 + i)}${run.slice(0, 3)}`); decIds.push(id); await gift(id, 200 + i * 75, "2025-12-1" + (i % 9)); }
  const insights = async (asOf) => {
    let r;
    for (let i = 0; i < 40; i++) { r = await api("GET", `/insights?asOf=${asOf}`, tok); if (r.status === 200 && !r.body.preparing && !r.body.stale) break; await new Promise(z => setTimeout(z, 750)); }
    return (r && r.body) || {};
  };
  const cardsOf = b => [...(b.cards || []), ...((b.ladder || {}).cards || [])];
  const MON = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
  const pastNamed = (label, today) => { const m = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* (\d{1,2})\b/.exec(label || ""); return m && `${today.slice(0, 4)}-${MON[m[1]]}-${m[2].padStart(2, "0")}` < today; };
  const n12 = await insights(NOV12);
  const ye = cardsOf(n12).find(c => c.kind === "year_end");
  const act = ye && (ye.does || []).find(d => d.action === "task");
  ok("§2 Nov 12: the Year-end givers card is there with its 12 givers", ye && ye.items.length === 12, ye && ye.items.length);
  ok("§2 Nov 12: no card action names a day gone", cardsOf(n12).every(c => (c.does || []).every(d => !pastNamed(d.label, NOV12))),
    cardsOf(n12).flatMap(c => (c.does || []).map(d => d.label)).filter(l => pastNamed(l, NOV12)));
  ok("§2 Nov 12: the button says when, from today (\"Create tasks for the next two weeks\")", act && /^Create tasks for (today|this week|the next two weeks)$/.test(act.label), act);
  const dues = ye ? [...ye.items].sort((a, b) => b.cents - a.cents).map(i => i.taskDue) : [];
  ok("§2 Nov 12: every task is due from today, spread over working days, the largest givers first",
    dues.length === 12 && dues.every(d => d >= NOV12) && dues[0] === NOV12 && new Set(dues).size > 1 && dues.every((d, i) => !i || d >= dues[i - 1]) && dues.every(d => ![0, 6].includes(new Date(d + "T12:00:00Z").getUTCDay())), dues);
  const o27 = await insights(OCT27);
  const ye27 = cardsOf(o27).find(c => c.kind === "year_end");
  const act27 = ye27 && (ye27.does || []).find(d => d.action === "task");
  ok("§2 Oct 27: before Nov 1 the button names the season's first working day (Mon, Nov 2) and every task is due on it",
    act27 && act27.label === "Create tasks for Nov 2" && ye27.items.every(i => i.taskDue === "2026-11-02"), act27 && [act27.label, ye27.items.map(i => i.taskDue)]);

  // ── §3 W-NOTGIFT-bulk ─────────────────────────────────────────────────────
  const fee = (name, year, season) => `Posted: ${name} Service Income - ${year} ${season} Session`;
  const kids = ["Orla Fenwick", "Piet Lazaro", "Quill Amaro", "Rhona Vesk"];
  const kidIds = [];
  for (const n of kids) kidIds.push(await person(n));
  const feeIds = [];
  const seasons = [["2022", "Fall"], ["2023", "Spring"], ["2023", "Fall"]];
  for (let i = 0; i < kids.length; i++) {
    // as the customer's rows came: from a file (no thank-you opened), the memo as the old system posted it
    for (const [y, s] of seasons.slice(0, i < 2 ? 2 : 1)) {
      const id = `g_asks2_${run}_${feeIds.length}`;
      await q(`INSERT INTO gifts (id,org_id,donor_id,date,amount,memo,created_at,created_by,created_by_name) VALUES ($1,$2,$3,$4,$5,$6,NOW(),'system:test','Fixture')`,
        [id, ORG, kidIds[i], `${y}-${s === "Fall" ? "09" : "02"}-15`, 410 + i * 10, fee(kids[i], y, s)]);
      feeIds.push(id);
    }
  }
  // two of the four have a real gift too; the other two have only fees
  await gift(kidIds[0], 150, "2024-05-02"); await gift(kidIds[2], 90, "2024-06-02");
  const gala = await person("Sabine Corrow");
  const ticket = `g_asks2_${run}_ticket`;
  await q(`INSERT INTO gifts (id,org_id,donor_id,date,amount,memo,created_at,created_by,created_by_name) VALUES ($1,$2,$3,'2024-04-20',250,'Spring gala tickets x2',NOW(),'system:test','Fixture')`, [ticket, ORG, gala]);
  const raff = await person("Tobin Raye");
  await gift(raff, 20, "2024-03-01", "Raffle tickets 2024"); await gift(raff, 40, "2025-03-01", "Raffle tickets 2025");
  const lifetimeNow = async () => Number((await q(`SELECT ROUND(COALESCE(SUM(${require("../shared/numbers/lifetime").LIFETIME("d")}), 0) * 100)::bigint AS c FROM donors d WHERE d.org_id = $1 AND ${require("../shared/numbers/everyone").EVERYONE("d")}`, [ORG]))[0].c);
  const giftCount = async () => Number((await q(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id = $1`, [ORG]))[0].n);
  const n12b = await insights(NOV12);
  const rev = cardsOf(n12b).find(c => c.kind === "review");
  if (!rev) console.log("  (cards:", cardsOf(n12b).map(c => c.kind).join(", "), "stale:", n12b.stale, ")");
  const grp = rev && (rev.groups || []).find(g => /Service Income - <year> <season> Session/.test(g.pattern));
  ok("§3 the program fees are one group: 6 rows, the reason and the memo's pattern, their dollars", grp && grp.count === 6 && grp.giftIds.slice().sort().join() === feeIds.slice().sort().join() && grp.cents === (410 * 2 + 420 * 2 + 430 + 440) * 100, rev && rev.groups);
  ok("§3 the ticket row is in no group (one row is not a group)", rev && !(rev.groups || []).some(g => g.giftIds.includes(ticket)), rev && rev.groups);
  const raffleGrp = rev && (rev.groups || []).find(g => g.kind === "raffle");
  const before = await lifetimeNow(), countBefore = await giftCount();
  const pv = (await api("POST", "/insights/review-preview", tok, { groupKey: grp && grp.key, giftIds: grp && grp.giftIds, decision: "not_gift" })).body || {};
  const fees = (410 * 2 + 420 * 2 + 430 + 440) * 100;
  ok("§3 the preview: Lifetime giving from $X to $Y, and 2 people would have no gifts left and become contacts",
    pv.lifetimeBeforeCents === before && pv.lifetimeAfterCents === before - fees && pv.contacts === 2 && /^Lifetime giving goes from \$[\d,]+ to \$[\d,]+; 2 people would have no gifts left and become contacts\.$/.test(pv.sentence || ""), pv);
  ok("§3 …and the preview changed nothing", (await giftCount()) === countBefore && (await lifetimeNow()) === before);
  // the group action, handed a row from outside its group: that row is left exactly as it was
  const r = (await api("POST", "/insights/review-group", tok, { groupKey: grp && grp.key, giftIds: [...(grp ? grp.giftIds : []), ticket], decision: "not_gift" })).body || {};
  const ticketStill = (await q(`SELECT 1 FROM gifts WHERE id = $1 AND org_id = $2`, [ticket, ORG])).length === 1;
  const ticketReviewed = (await q(`SELECT 1 FROM insight_reviews WHERE gift_id = $1 AND org_id = $2`, [ticket, ORG])).length;
  ok("§3 Not a gift (all 6): the six rows leave giving, the row outside the group is untouched", r.done === 6 && r.outside === 1 && ticketStill && !ticketReviewed, { r, ticketStill, ticketReviewed });
  const after = await lifetimeNow();
  ok("§3 Lifetime giving is what the preview said", after === pv.lifetimeAfterCents, { after, said: pv.lifetimeAfterCents });
  const roles = (await q(`SELECT id, person_types FROM donors WHERE org_id = $1 AND id = ANY($2::text[])`, [ORG, kidIds]));
  const contactIds = roles.filter(x => !(x.person_types || []).includes("donor")).map(x => x.id).sort();
  ok("§3 the two with no gift left are contacts now; the two with a real gift are still donors", contactIds.join() === [kidIds[1], kidIds[3]].sort().join(), roles);
  const un = (await api("POST", r.undo || "/insights/review-group/none/undo", tok, {})).body || {};
  const rolesBack = (await q(`SELECT person_types FROM donors WHERE org_id = $1 AND id = ANY($2::text[])`, [ORG, kidIds]));
  ok("§3 one Undo puts every row back, Lifetime giving and the donors' roles with it",
    un.undone === 6 && (await giftCount()) === countBefore && (await lifetimeNow()) === before && rolesBack.every(x => (x.person_types || ["donor"]).includes("donor")), { un, rolesBack });
  if (raffleGrp) {
    const pr = await api("POST", "/insights/review-group", tok, { groupKey: raffleGrp.key, giftIds: raffleGrp.giftIds, decision: "partly", value: "5" });
    ok("§3 a raffle group is never partly a gift (the raffle rule, unchanged)", pr.status === 400 && pr.body && pr.body.error === "raffle", pr.body);
  } else ok("§3 the two raffle rows are one group", false, rev && rev.groups);

  await closeDb();
  summary();
})().catch(async e => { console.error(e); try { await closeDb(); } catch {} process.exit(1); });
