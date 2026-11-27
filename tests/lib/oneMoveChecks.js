// tests/lib/oneMoveChecks.js · ONE-MOVE-1, run by tests/insights.test.js (§OM). Made-up people only.
//
//   §OM1 one person's move and ask is the same on Home, the profile's Next move (the Activity
//        banner), the Giving tab's "Next:" line and its suggested ask. A lapsing $10,000 donor
//        whose largest gift was $50,000 and who also has a legacy signal: every surface reads
//        "Ask $10,000: what they gave last, on <day>." (main: Home asked $50,000 under "Ask for
//        what they gave last", and the profile led with the Planned card's "No money ask").
//   §OM2 a household member's step is labelled a household step and names whose gift it is; a
//        household member moved to the trash drives nobody's move (main: "thank Bravo for the
//        $50 gift" on the member who gave nothing; the trashed member's pledge still asked).
//   §OM3 one donor's gifts on one day make one thank-you draft, for the day's total; marking
//        it sent thanks both gifts and Undo puts both back (main: two drafts).
//
// Dates are the run's own (tests/clock.js), so the server's today and the fixture agree.
"use strict";
const { dayOffset } = require("../clock");

async function oneMove({ ok, api, q, freshOrg }) {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const settled = async (tok, path) => { let r; for (let i = 0; i < 30; i++) { r = await api("GET", path, tok); if (r.status === 200 && r.body && !r.body.preparing && !r.body.stale) return r; await wait(1000); } return r; };

  // ── §OM1 ────────────────────────────────────────────────────────────────
  {
    const tok = await freshOrg("org_om1one", "One Move (test)");
    const d = (await api("POST", "/donors", tok, { name: "Quinn Lapsewell", email: "quinn@om1.test" })).body;
    let lastDay = null;
    for (let k = 0; k < 11; k++) {   // every six months, the largest $50,000, the last $10,000 fourteen months ago
      const day = dayOffset(-425 - 180 * (10 - k)), amt = k === 3 || k === 8 ? "50000" : "10000";
      await api("POST", `/donors/${d.id}/gifts`, tok, { amount: amt, date: day, type: "cash", confirmFarOutside: true });
      lastDay = day;
    }
    for (let i = 0; i < 20; i++) { const x = (await api("POST", "/donors", tok, { name: `Filler Person${i}`, email: `f${i}@om1.test` })).body; await api("POST", `/donors/${x.id}/gifts`, tok, { amount: String(100 + i), date: dayOffset(-30 - i), type: "cash" }); }
    const home = await settled(tok, "/insights");
    const hm = [].concat(...((home.body.deck && home.body.deck.tabs) || []).map(t => t.moves)).find(m => (m.ids || []).includes(d.id));
    const pm = (await settled(tok, `/insights/donor/${d.id}`)).body.move;
    const st = (await api("GET", `/donors/${d.id}/status`, tok)).body;
    const sc = (await api("GET", `/donors/${d.id}/scores`, tok)).body;
    const words = hm && hm.ask && hm.ask.words;
    ok("§OM1 Home leads with Lapsing and asks for what they gave last: \"Ask $10,000: what they gave last, on …\"",
      !!hm && hm.kind === "lapsing" && /^Ask \$10,000: what they gave last, on /.test(words || ""), JSON.stringify(hm && { kind: hm.kind, ask: hm.ask, also: hm.also }));
    ok("§OM1 the profile's Next move is the same move and the same ask", !!pm && pm.kind === "lapsing" && pm.item.how.ask.words === words, JSON.stringify(pm && { kind: pm.kind, ask: pm.item.how.ask }));
    ok("§OM1 the Giving tab's Next line and its suggested ask are $10,000, the same ask",
      st.next && /\$10,000/.test(st.next.text) && !/\$50,000/.test(st.next.text) && sc.suggestedAsk && sc.suggestedAsk.askCents === 1000000 && sc.suggestedAsk.sentence === words,
      JSON.stringify([st.next && st.next.text, sc.suggestedAsk]));
    ok("§OM1 the ask names the gift it came from", pm && pm.item.how.ask.gift && pm.item.how.ask.gift.date === lastDay && pm.item.how.ask.gift.cents === 1000000, JSON.stringify(pm && pm.item.how.ask));
  }

  // ── §OM2 ────────────────────────────────────────────────────────────────
  {
    const ORG = "org_om1house";
    const tok = await freshOrg(ORG, "One Move House (test)");
    const a = (await api("POST", "/donors", tok, { name: "Alma Brightcourt", email: "alma@om1.test" })).body;
    const b = (await api("POST", "/donors", tok, { name: "Bram Brightcourt", email: "bram@om1.test" })).body;
    const hh = await api("POST", "/households", tok, { memberIds: [a.id, b.id], primaryDonorId: a.id });
    await api("POST", `/donors/${a.id}/gifts`, tok, { amount: "50", date: dayOffset(-1), type: "cash" });
    const bm = (await settled(tok, `/insights/donor/${b.id}`)).body;
    const sayBram = bm.move ? !!bm.move.household : bm.after ? bm.after.giverId === a.id && bm.after.giver === "Alma Brightcourt" : false;
    ok("§OM2 on the member who gave nothing, the step is the household's and names whose gift it is", hh.status < 300 && sayBram,
      JSON.stringify({ hh: hh.status, move: bm.move && { kind: bm.move.kind, household: bm.move.household }, after: bm.after && { giverId: bm.after.giverId, giver: bm.after.giver } }));
    const pl = await api("POST", `/donors/${a.id}/pledges`, tok, { amount: "1200", dueDate: dayOffset(60) });
    const del = await api("DELETE", `/donors/${a.id}`, tok);
    const after = (await settled(tok, `/insights/donor/${b.id}`)).body;
    const pledgeMove = after.move && after.move.item && after.move.item.pledgeId;
    const alma = after.after && after.after.giverId === a.id;
    ok("§OM2 after the member who gave is trashed, their pledge and gift drive nobody's move", pl.status < 300 && del.status < 300 && !pledgeMove && !alma,
      JSON.stringify({ pledge: pl.status, del: del.status, move: after.move && after.move.kind, after: after.after }));
  }

  // ── §OM3 ────────────────────────────────────────────────────────────────
  {
    const ORG = "org_om1thanks";
    const tok = await freshOrg(ORG, "One Move Thanks (test)");
    const d = (await api("POST", "/donors", tok, { name: "Tamsin Twicegift", email: "tamsin@om1.test" })).body;
    await api("POST", `/donors/${d.id}/gifts`, tok, { amount: "40", date: dayOffset(-1), type: "cash" });
    await api("POST", `/donors/${d.id}/gifts`, tok, { amount: "60", date: dayOffset(-1), type: "cash" });
    let drafts = [];
    for (let i = 0; i < 20 && drafts.length === 0; i++) { await wait(500); drafts = await q(`SELECT id, also_gift_ids, body FROM thank_you_drafts WHERE org_id=$1 AND donor_id=$2`, [ORG, d.id]).catch(() => []); }
    await wait(1500);
    drafts = await q(`SELECT id, also_gift_ids, body FROM thank_you_drafts WHERE org_id=$1 AND donor_id=$2`, [ORG, d.id]).catch(e => [{ err: e.message }]);
    ok("§OM3 one donor's two gifts on one day make one thank-you draft, for the day's $100", drafts.length === 1 && /\$100\b/.test(drafts[0].body || ""), JSON.stringify(drafts.map(x => ({ also: x.also_gift_ids, amt: (String(x.body || "").match(/\$[\d,.]+/) || [])[0] }))));
    const thanked = async () => (await q(`SELECT COUNT(*) FILTER (WHERE thanked_at IS NOT NULL)::int AS n FROM gifts WHERE org_id=$1 AND donor_id=$2`, [ORG, d.id]))[0].n;
    const s = drafts[0] ? await api("POST", `/thank-yous/${drafts[0].id}/sent`, tok, {}) : { status: 0 };
    const n1 = await thanked();
    const u = drafts[0] ? await api("POST", `/thank-yous/${drafts[0].id}/unsent`, tok, {}) : { status: 0 };
    const n2 = await thanked();
    ok("§OM3 marking it sent thanks both gifts, and Undo puts both back", s.status === 200 && n1 === 2 && u.status === 200 && n2 === 0, JSON.stringify([s.status, n1, u.status, n2]));
  }
}

module.exports = { oneMove };
