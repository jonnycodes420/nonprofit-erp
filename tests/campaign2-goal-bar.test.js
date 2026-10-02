// CAMPAIGN-2 — THE ONE TEST. A campaign page's goal bar equals the sum of the
// campaign's recorded gifts, to the cent, including gifts given through a
// supporter's own peer-to-peer page.
//
// It earns its place under CLAUDE.md's one-test rule because a thermometer is
// money on a public screen: it is the number a donor decides on, the number a
// board asks about, and the one figure on this product that a stranger can
// check against nothing. If it ever stops footing, nothing else on the page
// says so.
//
// ── WHAT WOULD MAKE IT FAIL (the guard-must-be-able-to-fail rule) ──────────
// Four plantable defects, each the shape of a real one:
//   1. Count the PAGE's gifts instead of the CAMPAIGN's → §2 drops the gift
//      recorded straight to the campaign by a staff member (a posted cheque),
//      and §3 drops the peer-to-peer gifts, which arrive on the p2p page and
//      not on the campaign page at all.
//   2. Count the CHARGED amount instead of donor intent → §4 goes red by the
//      exact fee a donor covered. (Campaign progress counts what the donor
//      meant for the mission; receipts and the ledger keep the charged total.
//      That is the attribution-FIX rule and this pins it.)
//   3. Let the match claim money that arrived before anybody promised it →
//      §5 goes red.
//   4. Default `show_name_publicly` on, or read the wrong column → §6 names
//      somebody who never agreed to be named.
// Each was planted and watched go red before this suite was trusted.
//
// Runs against the scratch server + scratch Postgres, never production.
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, api, q, closeDb } = require("./helpers");

const ORG = "org_c2bar", SLUG = "c2bar-harbor-test";
const uniq = () => Math.random().toString(36).slice(2, 8);
const cents = v => Math.round((Number(v) || 0) * 100);

async function reset() {
  const CHILD = ["gift_soft_credits", "p2p_teams", "peer_fundraisers", "giving_pages", "receipts",
    "fin_audit_log", "fin_transactions", "gifts", "interactions", "tasks", "threads"];
  for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  for (const t of ["donors", "campaigns", "fin_funds", "accounts", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone)
           VALUES ($1,'Harbor Bar Trust',$2,1,'active','growth','America/New_York')`, [ORG, SLUG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ($1,$2,$3,$4,'Bar Admin','admin')`,
    ["u_c2bar", ORG, "c2bar@example.org", bcrypt.hashSync("demo1234", 10)]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ($1,$2,'General Operating',false)`, ["ff_c2bar", ORG]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type,subtype)
           VALUES ($1,$2,'4010','Individual Contributions','revenue','contributions')`, ["acc_c2bar", ORG]);
}

// A gift written straight into the table, the way the deposit sheet and the
// importer write one. The suite is about what the BAR counts, not about which
// door the money came through — which is the point: every door has to count.
async function gift({ id, donorId, amount, campaignId = null, campaignName = null,
                      pageId = null, peerId = null, coverFee = 0, date, publicName = false }) {
  await q(
    `INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign_id,campaign,giving_page_id,
                        peer_fundraiser_id,cover_fee_amount,show_name_publicly,created_by,created_by_name)
     VALUES ($1,$2,$3,$4,$5,'cash',$6,$7,$8,$9,$10,$11,'system:test','Test')`,
    [id, ORG, donorId, amount, date, campaignId, campaignName || "", pageId, peerId, coverFee, publicName]);
  return id;
}

async function donor(id, name) {
  await q(`INSERT INTO donors (id,org_id,name,email,created_by,created_by_name)
           VALUES ($1,$2,$3,$4,'system:test','Test')`,
    [id, ORG, name, `${id}@example.org`]);
  return id;
}

// THE BAR, as the public page computes it — read through the live route, never
// re-derived here. A test that recomputes the number it is checking is a test
// that agrees with itself.
async function publicPage(pageSlug) {
  const r = await fetch(`${BASE}/org/${SLUG}/giving-page/${pageSlug}/public`);
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

(async () => {
  await reset();
  const tok = (await api("POST", "/auth/login", null, { email: "c2bar@example.org", password: "demo1234" })).body.token;
  const today = new Date().toISOString().slice(0, 10);
  // The gifts in §2 to §4 arrive BEFORE the match in §5, so "before" is a
  // different civil date rather than a different hour: `gifts.date` is a civil
  // date and an hour is not a thing it can hold.
  const lastWeek = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n§1 a campaign from a template stands up a page that can take a gift");
  // ════════════════════════════════════════════════════════════════════════
  let campaignId = null, pageSlug = null, pageId = null;
  {
    const t = await api("GET", "/campaign-templates", tok);
    ok("the templates answer", t.status === 200 && t.body.templates.length === 2, t.body);
    ok("every template says what pressing the button creates",
      (t.body.templates || []).every(x => x.campaign.name && x.campaign.startDate && x.campaign.endDate && x.steps.length >= 5),
      (t.body.templates || []).map(x => [x.key, x.steps && x.steps.length]));

    const made = await api("POST", "/campaigns/from-template", tok, { template: "yearend", goalAmount: 50000 });
    ok("the template created the campaign, the page and the plan", made.status === 201, made.body);
    campaignId = made.body.campaignId; pageSlug = made.body.slug; pageId = made.body.pageId;

    const again = await api("POST", "/campaigns/from-template", tok, { template: "yearend" });
    ok("pressing it twice is refused, with the campaign it already made",
      again.status === 409 && again.body.campaignId === campaignId, again.body);

    const plan = await api("GET", `/campaigns/${campaignId}/plan`, tok);
    ok(`the plan reads back as dated steps (${plan.body.steps?.length})`,
      plan.status === 200 && plan.body.steps.length >= 5 && plan.body.steps.every(s => s.due && s.title),
      plan.body.steps?.slice(0, 2));
    // NOTHING WAS SENT. The whole promise of a template is that it writes a
    // list, not a schedule — and the way to be sure is that nothing anywhere
    // claims a send.
    const sends = await q(
      `SELECT COUNT(*)::int AS n FROM notification_sends WHERE org_id=$1`, [ORG]).catch(() => [{ n: 0 }]);
    ok("the template sent nothing to anybody", (sends[0]?.n || 0) === 0, sends[0]);
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n§2 the bar counts EVERY gift recorded to the campaign, online and offline");
  // ════════════════════════════════════════════════════════════════════════
  const d1 = await donor("d_c2_online", "Online Giver");
  const d2 = await donor("d_c2_cheque", "Cheque Poster");
  {
    // One given through the campaign's own page, one a staff member recorded
    // from a cheque that arrived in the post and never touched the page.
    await gift({ id: "g_c2_a", donorId: d1, amount: 250, campaignId, pageId, date: lastWeek });
    await gift({ id: "g_c2_b", donorId: d2, amount: 1000, campaignId, date: lastWeek });

    const p = await publicPage(pageSlug);
    ok("the page is live", p.status === 200, p.body?.error);
    const expected = cents(250) + cents(1000);
    ok(`the bar is ${expected}¢, the sum of both gifts`,
      cents(p.body.givingPage.campaignRaised) === expected,
      { bar: cents(p.body.givingPage.campaignRaised), expected });
    ok("the offline gift counted the moment it was recorded, with no page of its own",
      cents(p.body.givingPage.campaignRaised) - cents(250) === cents(1000), null);
    ok("and the bar carries the sentence that says what it counts",
      typeof p.body.givingPage.goalSentence === "string" && /recorded to this campaign/.test(p.body.givingPage.goalSentence),
      p.body.givingPage.goalSentence);
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n§3 a gift through a supporter's OWN page counts toward the same bar");
  // ════════════════════════════════════════════════════════════════════════
  {
    // BUILD-103's shape: a fundraiser hangs off a giving page, and a gift
    // through their page carries BOTH ids. Here the fundraiser's parent is a
    // SECOND page linked to the same campaign — a walk beside the appeal — which
    // is exactly the case the brief names and the case a page-scoped sum misses.
    await q(`INSERT INTO giving_pages (id,org_id,slug,title,status,campaign_id,p2p_enabled,created_by,created_by_name)
             VALUES ($1,$2,'c2-walk','The Walk','active',$3,TRUE,'system:test','Test')`,
      ["gp_c2_walk", ORG, campaignId]);
    await q(`INSERT INTO peer_fundraisers (id,org_id,giving_page_id,name,email,slug,edit_token,status)
             VALUES ($1,$2,'gp_c2_walk','Rosalind','rosalind@example.org','rosalind',$3,'active')`,
      ["pf_c2_ros", ORG, "tok_" + uniq() + uniq()]);
    const d3 = await donor("d_c2_peer", "Peer Giver");
    await gift({ id: "g_c2_c", donorId: d3, amount: 75, campaignId, pageId: "gp_c2_walk", peerId: "pf_c2_ros", date: lastWeek });

    const p = await publicPage(pageSlug);
    const expected = cents(250) + cents(1000) + cents(75);
    ok(`the bar is ${expected}¢ — the peer-to-peer gift is in it`,
      cents(p.body.givingPage.campaignRaised) === expected,
      { bar: cents(p.body.givingPage.campaignRaised), expected });
    // AND IT FOOTS AGAINST THE ROWS. The identity, printed rather than assumed.
    const rows = await q(
      `SELECT COALESCE(SUM(round((g.amount - COALESCE(g.cover_fee_amount,0))*100))::bigint,0) AS c, COUNT(*)::int AS n
         FROM gifts g JOIN campaigns c ON c.id=$2 AND c.org_id=g.org_id
        WHERE g.org_id=$1 AND (g.campaign_id=c.id OR g.campaign=c.name)`, [ORG, campaignId]);
    ok(`the bar equals the ${rows[0].n} rows behind it, to the cent`,
      Number(rows[0].c) === cents(p.body.givingPage.campaignRaised),
      { rows: Number(rows[0].c), bar: cents(p.body.givingPage.campaignRaised) });
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n§4 a covered fee is NOT campaign progress");
  // ════════════════════════════════════════════════════════════════════════
  {
    // The donor meant $100 for the mission and was charged $103.30. The receipt
    // and the ledger keep $103.30; the thermometer counts $100. Both are right
    // for their own screen (attribution FIX, 2026-08-04) and this is the line.
    const d4 = await donor("d_c2_cover", "Fee Coverer");
    await gift({ id: "g_c2_d", donorId: d4, amount: 103.30, coverFee: 3.30, campaignId, pageId, date: lastWeek });
    const p = await publicPage(pageSlug);
    const expected = cents(250) + cents(1000) + cents(75) + cents(100);
    ok(`the bar moved by the intended $100, not the charged $103.30`,
      cents(p.body.givingPage.campaignRaised) === expected,
      { bar: cents(p.body.givingPage.campaignRaised), expected, charged: expected + cents(3.30) });
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n§5 the matching challenge: shown only when entered, claimed only from then");
  // ════════════════════════════════════════════════════════════════════════
  {
    let p = await publicPage(pageSlug);
    const before = (p.body.givingPage.page || []).find(w => w.type === "matchchallenge");
    ok("with no match entered, the page says nothing about one",
      before && before.match === null, before);

    const put = await api("PUT", `/campaigns/${campaignId}/match`, tok, { matchCents: 500000, sponsor: "Meridian Bank" });
    ok("a match can be entered", put.status === 200 && put.body.match.potCents === 500000, put.body);

    p = await publicPage(pageSlug);
    const after = (p.body.givingPage.page || []).find(w => w.type === "matchchallenge");
    // EVERY GIFT ABOVE ARRIVED A WEEK BEFORE THE MATCH DID. Money that was
    // already in was never part of the promise, so none of it is claimed —
    // which is the one thing a matching challenge can be wrong about in a
    // direction that costs a donor: a page that says more is left than really
    // is takes a gift from somebody who believed it would be doubled.
    ok("nothing given before the match is claimed against it",
      after && after.match && after.match.claimedCents === 0 && after.match.remainingCents === 500000,
      after && after.match);
    ok("and it names who is matching", /Meridian Bank/.test(after.match.sentence), after.match.sentence);

    // A GIFT ON THE DAY THE MATCH BEGAN DOES COUNT, and that is deliberate.
    // `gifts.date` is a civil date, so "the same day" is the finest the record
    // gets; counting the whole day can only ever say that LESS of the match is
    // left than really is, which errs against the organisation rather than
    // against a donor deciding whether their gift will be doubled.
    const d6 = await donor("d_c2_matched", "Matched Giver");
    await gift({ id: "g_c2_m", donorId: d6, amount: 200, campaignId, pageId, date: today });
    p = await publicPage(pageSlug);
    const now = (p.body.givingPage.page || []).find(w => w.type === "matchchallenge");
    ok("a gift on the day the match began is claimed against it",
      now && now.match && now.match.claimedCents === cents(200), now && now.match);

    const off = await api("PUT", `/campaigns/${campaignId}/match`, tok, { matchCents: null });
    ok("turning it off takes it off the page", off.status === 200 && off.body.match === null, off.body);
    p = await publicPage(pageSlug);
    ok("…and the page stops mentioning it",
      ((p.body.givingPage.page || []).find(w => w.type === "matchchallenge") || {}).match === null, null);
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n§6 a name appears only where that donor chose it");
  // ════════════════════════════════════════════════════════════════════════
  {
    const d5 = await donor("d_c2_named", "Perpetua Wyndham");
    await gift({ id: "g_c2_e", donorId: d5, amount: 40, campaignId, pageId, date: today, publicName: true });
    const p = await publicPage(pageSlug);
    const rg = (p.body.givingPage.page || []).find(w => w.type === "recentgifts");
    const who = (rg?.gifts || []).map(g => g.who);
    ok("the donor who chose it is there by FIRST NAME only", who.includes("Perpetua"), who);
    ok("no surname reaches the page", !who.some(n => /Wyndham/.test(n)), who);
    ok("everybody who did not choose is Anonymous",
      who.filter(n => n === "Anonymous").length === who.length - 1, who);
    // AMOUNTS ARE OFF BY DEFAULT, and with them off the server sends no number
    // at all — so a page cannot leak one by rendering a field it was handed.
    ok("with amounts off, no amount leaves the server",
      (rg?.gifts || []).every(g => g.amount === undefined && g.amountCents === undefined),
      (rg?.gifts || [])[0]);
    // AND NO EMAIL, EVER.
    ok("and no email is anywhere in the public payload",
      !/@example\.org/.test(JSON.stringify(p.body)), null);
  }

  await closeDb();
  summary();
})().catch(async e => {
  console.error(e);
  try { await closeDb(); } catch { /* shutting down */ }
  process.exit(1);
});
