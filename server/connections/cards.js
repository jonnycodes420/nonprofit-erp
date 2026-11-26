// server/connections/cards.js · HONEST-1 item 1. THE CONNECTION CARDS, BUILT IN ONE PLACE.
//
// This is the body GET /connections had in routes/give.js (INT-1 and every build since), moved
// here unchanged so Home can read the same cards the Settings page reads. Each card then gets its
// one `flow` from ./status.js. Dependencies come in as arguments, as the routes hand them over.
"use strict";

// FIX-34 Y · ONE CONNECTION, ONE STATUS. A giving source is connected when its
// row is not disconnected. The Connections card and the "Connects directly"
// tile both read THIS, so the two can never disagree about one row.
function sourceIsConnected(s) { return !!s && s.status !== "disconnected"; }

// The assessment's own `label`/`key`/`definition` are about the STATUS, and a
// card already has a label of its own — spreading the whole object put "Quiet"
// where "PayPal" belongs, on the screen and in the attention sentence. Only the
// four fields the card actually wants cross over.
function connectionState(a) {
  return { status: a.status, sentence: a.sentence, statusDefinition: a.definition,
           rhythmSentence: a.rhythm ? a.rhythm.sentence : null,
           silentDays: a.silentDays ?? null, quietAfterDays: a.quietAfterDays ?? null,
           rhythm: a.rhythm || null };   // HONEST-1: status.js says the usual rhythm in words
}

async function buildConnectionCards({ query, orgTz, orgToday, orgTime }, orgId) {
  const C = await import("../../shared/connections.js");
  const { PROVIDERS, providerLabel } = await import("../../shared/givingSources.js");
  // INT-OAUTH — the two directions between a card's key and an OAuth provider,
  // derived from the registry so a fifth provider is one entry there and
  // nothing here. A key absent from these is a card with no consent screen to
  // open, which is how PayPal's card ends up with no Connect button.
  const O = await import("../../shared/oauth.js");
  const OAUTH_BY_SOURCE = {}, OAUTH_BY_VENDOR = {};
  for (const k of O.PROVIDER_KEYS) {
    const v = O.vendorKeyOf(k);
    if (O.PROVIDERS[k].kind === "bookkeeping") OAUTH_BY_VENDOR[v] = k; else OAUTH_BY_SOURCE[v] = k;
  }
  const today = orgToday(await orgTz(orgId));                       // ORG_TZ_SEAM_OK
  const since30 = orgTime.addDays(today, -30);

  const [org] = await query(
    `SELECT stripe_account_id, stripe_connected, other_giving_sources FROM orgs WHERE id=?`, [orgId]);
  const sources = await query(
    `SELECT * FROM giving_sources WHERE org_id=? ORDER BY created_at ASC`, [orgId]);

  // The gift rows every card's figures are counted from, in one round trip.
  // `giving_source_id IS NULL` with a Stripe payment id is the org's OWN
  // Stripe — money taken through Steward's own donation path, which is a
  // connection like any other and was the one nothing ever said anything about.
  const giftRows = await query(
    `SELECT giving_source_id, stripe_payment_id, date::text AS d,
            (amount * 100)::bigint AS cents
       FROM gifts WHERE org_id=? AND date >= ? AND amount > 0`, [orgId, orgTime.addDays(today, -C.RHYTHM_WINDOW_DAYS)]);
  const bucket = new Map();
  const put = (key, r) => {
    let b = bucket.get(key);
    if (!b) bucket.set(key, b = { dates: [], gifts30: 0, cents30: 0, last: null });
    b.dates.push(r.d);
    if (r.d >= since30) { b.gifts30++; b.cents30 += Number(r.cents) || 0; }
    if (!b.last || r.d > b.last) b.last = r.d;
  };
  for (const r of giftRows) {
    if (r.giving_source_id) put(r.giving_source_id, r);
    else if (r.stripe_payment_id) put("own_stripe", r);
  }
  const empty = { dates: [], gifts30: 0, cents30: 0, last: null };

  const cards = [];
  // 1 · STRIPE IS ONE CARD. FIX-10 D.
  //
  // Stripe appeared TWICE on this screen: "Your Stripe" (money taken through
  // Steward's own giving pages) and "Stripe" (the read-only connection that
  // reads the history Stripe already holds). Both are Stripe, both say
  // "Connect", and a customer has no way to tell which one she is being asked
  // for. They are two THINGS INSIDE ONE CARD now, each with a plain label that
  // says what it does, and the card's `parts` array is the one place either is
  // described. `stripeCard` is filled below, when the provider loop reaches
  // Stripe, so the second part is built from the same code every other API
  // source is.
  let stripeCard = null;
  {
    const b = bucket.get("own_stripe") || empty;
    // FLOWS-15 item 6: whether the pages take gifts, the card's state and its one rate are
    // settled below by server/give/stripeCard.js (the public page's own check), not "any Stripe
    // gift in thirty days", which counted the history Steward reads.
    cards.push(stripeCard = {
      id: "own_stripe", kind: "own_stripe", provider: "stripe", label: "Stripe",
      subtitle: "Two things live here: the gifts your giving pages take, and the history Stripe already holds.",
      // THE TWO PARTS, each named for what it does for her. The second one is
      // appended by the provider loop below.
      parts: [{ key: "pages", label: "Take gifts on your giving pages" }],
      canDisconnect: false,
      lastSyncedAt: null, liveSentence: "Stripe pays Steward the moment a gift is taken; there is nothing to check on a schedule.",
      gifts30: b.gifts30, dollars30Cents: b.cents30, lastGiftDate: b.last,
      figureSource: { key: "connection-gifts", params: { connection: "own_stripe" } },
    });
  }
  // 2 · Every API source, connected or not. A provider the registry knows and
  // this org has not connected is a CARD, not an absence: "not connected" is a
  // state worth showing, because money taken through it is not in any figure
  // on any screen, and silence about that is how a total goes quietly wrong.
  // FIX-9 Part A.5 — A REGISTER COUNTS ITS OWN MONEY. A POS card read
  // "Connected. Nothing has come through it yet." while Square held eleven
  // sales worth $691.50, because the card counted GIFTS and a register's
  // takings are mostly not gifts. That is the one sentence this whole build
  // exists to make true, said backwards on the card that should say it best.
  const posRows = await query(
    `SELECT source_id, occurred_on, total_cents, gift_cents, event_cents, other_cents
       FROM pos_sales WHERE org_id=? AND occurred_on >= ?`, [orgId, since30]);
  const posBy = new Map();
  for (const r of posRows) {
    if (!r.source_id) continue;
    let x = posBy.get(r.source_id);
    if (!x) posBy.set(r.source_id, x = { sales: 0, totalCents: 0, giftCents: 0, last: null });
    x.sales++; x.totalCents += Number(r.total_cents) || 0; x.giftCents += Number(r.gift_cents) || 0;
    if (!x.last || r.occurred_on > x.last) x.last = r.occurred_on;
  }

  const byProvider = new Map(sources.filter(sourceIsConnected).map(s => [s.provider, s]));
  let stripeHistory = null;
  // FIX-10 D — what the SECOND half of the Stripe card says, built from the
  // same row every other API source is built from.
  const stripePart = card => ({
    key: "history", label: "Read your Stripe history",
    id: card.id, connected: card.connected,
    sentence: card.connected
      ? card.sentence
      : "Not connected yet. Connect it and Steward reads the gifts Stripe already holds onto your donor records.",
    action: card.action, actionLabel: card.actionLabel, oauthProvider: card.oauthProvider,
    figureSource: card.figureSource, gifts30: card.gifts30, dollars30Cents: card.dollars30Cents,
    status: card.status,
  });
  for (const key of Object.keys(PROVIDERS)) {
    const s = byProvider.get(key);
    const b = (s && bucket.get(s.id)) || empty;
    const connected = sourceIsConnected(s);
    const isFile = PROVIDERS[key].mode === "file";
    const isPos = PROVIDERS[key].pos === true;
    const pos = (s && posBy.get(s.id)) || null;
    const state = connectionState(C.assessConnection({ connected, lastError: s ? s.last_error : null,
      // A register's rhythm is its SALES, not its gifts.
      lastGiftDate: isPos ? (pos?.last || b.last) : b.last,
      giftDates: isPos && pos ? [] : b.dates, today, fallbackDays: C.QUIET_FALLBACK_DAYS }));
    const card = {
      id: s ? s.id : `unconnected:${key}`, kind: isPos ? "pos" : "source", provider: key,
      label: s ? s.display_name : providerLabel(key),
      mode: PROVIDERS[key].mode,
      subtitle: isFile
        ? "A file somebody drops in. Steward reads the file; it never reaches the provider."
        : "Steward reads it on a schedule. It never writes to it.",
      connected, canDisconnect: !!s,
      // FIX-9 Part A.4 — NO CARD OFFERS AN ACTION IT CANNOT DO. A file-mode
      // provider has no API to connect to, and its own card said so and then
      // offered a Connect button underneath. The verb matches the mode.
      action: connected ? null : isFile ? "import" : "connect",
      actionLabel: connected ? null : isFile ? "Import a file" : "Connect",
      // INT-OAUTH — WHICH CONSENT SCREEN THIS CARD'S BUTTON OPENS, if any.
      // A card that names one gets a button that really starts a handshake;
      // a card that names none keeps the settings link it had. PayPal is
      // deliberately none, and its own sentence says why.
      oauthProvider: isFile ? null : (OAUTH_BY_SOURCE[key] || null),
      lastSyncedAt: s ? s.last_synced_at : null,
      lastTriedAt: s ? (s.last_tried_at || s.last_error_at || s.last_synced_at) : null,
      ...state,
      // A POS card leads with its takings and says plainly how much of it was
      // giving, which on a register is usually none of it.
      ...(isPos && pos ? {
        sales30: pos.sales, takings30Cents: pos.totalCents,
        sentence: `${pos.sales} ${pos.sales === 1 ? "sale" : "sales"} in the last thirty days, ${C.money(pos.totalCents)} taken, `
          + (pos.giftCents ? `${C.money(pos.giftCents)} of it given.` : "none of it gifts."),
      } : {}),
      gifts30: b.gifts30, dollars30Cents: b.cents30, lastGiftDate: b.last,
      figureSource: s ? { key: "connection-gifts", params: { connection: s.id } } : null,
      posFigureSource: isPos && s ? { key: "connection-sales", params: { connection: s.id } } : null,
    };
    // FIX-10 D — Stripe is not its own card. It is the second half of the one
    // Stripe card, so a customer never has to guess which Stripe to connect.
    if (key === "stripe" && stripeCard) {
      stripeCard.parts.push(stripePart(card));
      stripeHistory = { card, dates: b.dates };   // FLOWS-15 item 6: settled below (server/give/stripeCard.js)
      // The card's own status is the worse of its two halves: a screen sorted
      // by what is wrong must not read "healthy" over a broken half.
      if (card.status === "broken" || (card.status === "quiet" && stripeCard.status === "healthy"))
        Object.assign(stripeCard, { status: card.status, sentence: card.sentence,
                                    statusDefinition: card.statusDefinition });
      continue;
    }
    cards.push(card);
  }
  // FLOWS-15 item 6: each half true on its own (pages by the public page's check), one weekly rate.
  require("../give/stripeCard").settleStripeCard(stripeCard, { org, C, ownDates: (bucket.get("own_stripe") || empty).dates,
    historyDates: stripeHistory ? stripeHistory.dates : [], historyCard: stripeHistory ? stripeHistory.card : null, today });
  // 3 · Statement imports. Not a connection anybody can break: a file arrives
  // or it does not, and the card says when the last one did.
  {
    const [imp] = await query(
      `SELECT MAX(committed_at) AS last, COUNT(*)::int AS n FROM imports
        WHERE org_id=? AND shape <> 'source' AND committed_at IS NOT NULL`, [orgId]);
    const last = imp && imp.last ? String(imp.last).slice(0, 10) : null;
    cards.push({
      id: "statements", kind: "statements", provider: "statements", label: "Statement imports",
      subtitle: "Files somebody drops in: a bank statement, a spreadsheet, a report from somewhere with no API.",
      connected: !!(imp && imp.n), canDisconnect: false,
      lastSyncedAt: imp && imp.last ? imp.last : null,
      status: imp && imp.n ? "healthy" : "not_connected",
      label_: null,
      sentence: last ? `The last file was brought in on ${last}.` : C.STATUSES.not_connected.definition,
      gifts30: 0, dollars30Cents: 0, lastGiftDate: last,
      importCount: (imp && imp.n) || 0,
    });
  }

  // 4 · INT-2 · the accounting system. Not a money-in door: a door money goes
  // OUT of Steward through, to the books. It belongs on this screen because
  // the question is the same one ("is it still working?") and because an
  // organisation that has connected QuickBooks and stopped noticing that the
  // send is failing has a month-end it does not know about yet.
  {
    const BK = await import("../../shared/bookkeeping.js");
    const books = await query(
      `SELECT id, vendor, status, last_sent_at, last_error, mapping, realm_id FROM bookkeeping_connections
        WHERE org_id=? AND status <> 'disconnected'`, [orgId]);
    const byVendor = new Map(books.map(b => [b.vendor, b]));
    // PARITY-2 Part 5: QuickBooks is offered only where the founder turned
    // its sync on, until Intuit's app assessment is passed. A connection that
    // already exists is never hidden: what is connected is always on screen.
    const [qboFlag] = await query("SELECT qbo_sync_enabled FROM orgs WHERE id=?", [orgId]);
    for (const key of BK.VENDOR_KEYS) {
      const b = byVendor.get(key);
      if (key === "quickbooks" && !b && !(qboFlag && qboFlag.qbo_sync_enabled === true)) continue;
      // FIX-9 Part A.3 — AN ACCOUNTING CONNECTION HAS ITS OWN SHAPE. It was
      // reusing the money-in card, so QuickBooks and Xero each read
      // "$0 in the last 30 days · 0 gifts · never last gift". An accounting
      // system has no gifts: what it has is deposits sent, anything held, and
      // whether the two sides agree. Those are the figures now, and the
      // gift-shaped ones are deliberately ABSENT rather than zero.
      const [sentRow] = b ? await query(
        `SELECT COUNT(*) FILTER (WHERE status='sent')::int AS sent,
                COALESCE(SUM(net_cents) FILTER (WHERE status='sent'),0)::bigint AS cents,
                COUNT(*) FILTER (WHERE status <> 'sent')::int AS held
           FROM bookkeeping_deposits WHERE org_id=? AND vendor=? AND deposit_on >= ?`,
        [orgId, key, since30]) : [{ sent: 0, cents: 0, held: 0 }];
      let sentN = Number(sentRow.sent) || 0, heldN = Number(sentRow.held) || 0;
      let sentCents = Number(sentRow.cents) || 0, lastSent = b ? b.last_sent_at : null;
      // FIX-34 Q · QUICKBOOKS COUNTS WHAT ITS SYNC SENT. Where the org's
      // QuickBooks sync is on, the gifts go through qboSync.js, which never
      // writes bookkeeping_deposits: this card read "0 deposits sent, $0,
      // never" beside "1 sent to QuickBooks". It reads the sync's own count
      // now, the same one the sync panel shows.
      const QSm = key === "quickbooks" && b && qboFlag && qboFlag.qbo_sync_enabled === true ? require("../../qboSync") : null;
      const qMap = QSm ? QSm.readMapping(b) : null;
      if (QSm) {
        const q = await QSm.sentSummary(orgId, since30);
        sentN = qMap.mode === "deposit" ? q.entries : q.gifts; sentCents = q.cents; heldN = 0;
        lastSent = q.lastAt || null;
      }
      // CONNECT-2: Xero counts what its own sync sent, the same count its panel shows.
      const XSm = key === "xero" && b ? require("../../xeroSync") : null;
      if (XSm) {
        const x = await XSm.sentSummary(orgId, b.realm_id);
        const [m30] = await query(
          `SELECT COUNT(*)::int AS n, COALESCE(SUM(amount_cents),0)::bigint AS cents FROM gift_bookkeeping_syncs
            WHERE org_id=? AND vendor='xero' AND realm_id=? AND status='synced' AND ${orgTime.orgDayWindowSql("synced_at", orgTime.orgTzSql("gift_bookkeeping_syncs.org_id"), "?", null)}`,
          [orgId, String(b.realm_id || ""), since30]);
        sentN = Number(m30 && m30.n) || 0; sentCents = Number(m30 && m30.cents) || 0; heldN = 0;
        lastSent = x.lastAt || null;
      }
      const sentNoun = QSm ? (qMap.mode === "deposit" ? "deposit" : "sales receipt") : XSm ? "bank transaction" : "deposit";
      // FIX-20 Part 4: Xero's send does not exist yet, and its card says so
      // rather than counting deposits that cannot have happened.
      if (BK.VENDORS[key].sends === false) {
        cards.push({
          id: b ? b.id : `unconnected:${key}`, kind: "bookkeeping", provider: key, sends: false,
          label: BK.VENDORS[key].label,
          subtitle: BK.VENDORS[key].notSendingSentence,
          connected: !!b, canDisconnect: !!b,
          action: b ? null : "connect", actionLabel: b ? null : "Connect",
          oauthProvider: OAUTH_BY_VENDOR[key] || null,
          lastSentAt: null, lastSyncedAt: null,
          status: !b ? "not_connected" : "healthy",
          sentence: !b ? C.STATUSES.not_connected.definition
            : `Connected. ${BK.VENDORS[key].notSendingSentence}`,
          deposits30: 0, deposits30Cents: 0, held30: 0, heldSentence: null,
        });
        continue;
      }
      cards.push({
        id: b ? b.id : `unconnected:${key}`, kind: "bookkeeping", provider: key,
        label: BK.VENDORS[key].label,
        subtitle: QSm ? QSm.sendsSentence(qMap)
          : key === "xero" ? "Steward sends one bank transaction per gift when you press Sync. It never sends the same gift twice."
          : "Steward sends one deposit per payout. It never sends the same payout twice.",
        connected: !!b, canDisconnect: !!b,
        action: b ? null : "connect", actionLabel: b ? null : "Connect",
        oauthProvider: OAUTH_BY_VENDOR[key] || null,
        lastSentAt: lastSent,
        lastSyncedAt: lastSent,
        status: !b ? "not_connected" : b.last_error ? "broken" : "healthy",
        sentence: !b ? C.STATUSES.not_connected.definition
          : b.last_error ? String(b.last_error)
          : sentN
            ? `${sentN} ${sentNoun}${sentN === 1 ? "" : "s"} sent this month, ${C.money(sentCents)} in all.`
            : "Connected. Nothing has been sent this month yet.",
        deposits30: sentN, deposits30Cents: sentCents, held30: heldN,
        sentLabel: sentN === 1 ? `${sentNoun} sent` : `${sentNoun}s sent`,
        heldSentence: heldN ? `${heldN} ${heldN === 1 ? "deposit is" : "deposits are"} held and not sent.` : null,
      });
    }
  }

  // ── INT-3 · THE EMAIL TOOL, ON THE SAME SCREEN AND THE SAME CARD ─────────
  // A connection is a connection: it is healthy, quiet, broken or not
  // connected, it has a sync log and an owner, and it gets the same card and
  // the same watching layer as PayPal does. What it does NOT get is a place in
  // any money figure, which is why it carries `money: false` and its own
  // `kind`. Its rhythm is the dates it last SENT something, because a
  // newsletter list that has gone three months without a campaign is the same
  // fact about an organisation that a silent PayPal is.
  {
    const EM = await import("../../shared/emailMarketing.js");
    const emRows = await query(
      `SELECT * FROM email_marketing_connections WHERE org_id=? AND status <> 'disconnected'`, [orgId]);
    const byProvider = Object.fromEntries(emRows.map(r => [r.provider, r]));
    const campaignDates = await query(
      `SELECT provider, sent_at::date::text AS d FROM email_marketing_campaigns
        WHERE org_id=? AND sent_at IS NOT NULL`, [orgId]);
    for (const key of EM.PROVIDER_KEYS) {
      const p = EM.PROVIDERS[key];
      const row = byProvider[key] || null;
      const mapping = row && row.mapping
        ? (typeof row.mapping === "string" ? JSON.parse(row.mapping || "null") : row.mapping) : null;
      const mapped = !!(mapping && mapping.audienceId);
      const refusedRaw = row?.last_refused
        ? (typeof row.last_refused === "string" ? JSON.parse(row.last_refused || "[]") : row.last_refused) : [];
      const refusedList = Array.isArray(refusedRaw) ? refusedRaw : [];
      const dates = campaignDates.filter(c => c.provider === key).map(c => c.d);
      const last = dates.length ? dates.slice().sort().at(-1) : null;
      const connected = !!row;
      // A connection that is on but not mapped is not "healthy": it is doing
      // nothing, and it needs one more decision from a person. Saying healthy
      // there is how a screen tells somebody everything is fine while nothing
      // is happening.
      // THE STATUS COMES FROM THE SHARED LAYER; THE SENTENCE DOES NOT.
      //
      // `assessConnection` decides healthy, quiet, broken or not connected, and
      // that judgement is the whole point of having one watching layer. But its
      // SENTENCES are about money, and it put "the last gift through it arrived
      // 17 days ago, 3 gifts so far" under Mailchimp, which has never carried a
      // gift in its life. That is the FIX-9 A.3 mistake again in a new place: a
      // card that borrows another kind's words says something false in
      // confident language. So the state is shared and the words are this
      // card's own, counted from campaigns.
      const state = connectionState(C.assessConnection({
        connected: connected && mapped, lastError: row?.last_error || null,
        lastGiftDate: last, giftDates: dates, today }));
      const nCampaigns = dates.length;
      const daysSince = last ? orgTime.daysBetween(last, today) : null;
      const campaignSentence =
        state.status === "quiet"
          ? `Connected, but nothing has gone out through it for ${daysSince} days. That is either a quiet spell or a newsletter that has stopped.`
        : nCampaigns
          ? `${nCampaigns} campaign${nCampaigns === 1 ? "" : "s"} read back${daysSince === null ? "" : daysSince === 0 ? ", the last one today" : `, the last one ${daysSince} day${daysSince === 1 ? "" : "s"} ago`}.`
          : "Connected. Nothing has been sent from it yet, so there is nothing to read back.";
      cards.push({
        id: "email:" + key, kind: "email_marketing", provider: key, label: p.label,
        money: false,
        subtitle: "Your own newsletter tool. Steward reads who opened, who clicked and who asked to stop. It adds people to your list only if you turn that on, and it never sends the email.",
        connected, canDisconnect: connected,
        action: connected ? null : "connect", actionLabel: connected ? null : "Connect",
        oauthProvider: p.oauthKey,
        lastSyncedAt: row?.last_synced_at || null,
        // MAILCHIMP-1: WHAT THE LAST READ DID, said on the card. The records it
        // changed, and the addresses the tool refused, each with its own reason.
        // A refusal never makes the card broken; only a dead connection does.
        lastUpdatedCount: row?.last_updated_count ?? null,
        pushOn: mapping?.push === true,
        refused: refusedList,
        refusedSentence: refusedList.length ? EM.refusedSentence(refusedList.length, key) : null,
        lastErrorAt: row?.last_error_at || null,
        mapped, audienceNoun: p.audienceNoun, lastCampaignDate: last,   // HONEST-1
        audienceName: row?.audience_name || null,
        needsMapping: connected && !mapped,
        ...state,
        // NOT THE MONEY SENTENCE. The shared not-connected definition ends
        // "money taken through it is not in these figures", which is true of
        // every other card and nonsense here: no money is ever taken through a
        // mailing list. An email tool gets its own sentence about what is
        // actually being missed, which is what its people did with the last
        // newsletter.
        sentence: !connected
          ? `Steward is not reading this one. Who opened, who clicked and who asked to stop is only in ${p.label}.`
          : row.last_error ? String(row.last_error)
          : !mapped ? `Connected, and reading nothing yet. Choose which ${p.audienceNoun} to read from.`
          : campaignSentence,
        // The rhythm sentence is money-shaped too, so it does not travel here.
        rhythmSentence: null,
      });
    }
  }

  cards.sort((a, b) => (C.STATUS_RANK[a.status] ?? 9) - (C.STATUS_RANK[b.status] ?? 9));
  const needsAttention = cards.filter(c => c.status === "broken" || c.status === "quiet");
  return {
    cards, statuses: C.STATUSES,
    needsAttention: needsAttention.length,
    // Home and Finance link here when this is above zero, and say this.
    attentionSentence: needsAttention.length
      ? `${needsAttention.length} ${needsAttention.length === 1 ? "connection needs" : "connections need"} a look: ${needsAttention.map(c => c.label).join(", ")}.`
      : null,
    definition: "Every way money reaches this organization, whether Steward can see it, and whether what arrived matches what was given. Gifts and dollars are the last thirty days, counted from the gift rows themselves.",
  };
}

module.exports = { buildConnectionCards, sourceIsConnected, connectionState };
