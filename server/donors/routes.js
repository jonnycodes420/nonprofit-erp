// server/donors/routes.js — the person record: the list, the profile and its rail, contact, stage and assignment.
//
// SPLIT-1: moved VERBATIM from routes/crm.js. Nothing in it changed.
//
// routes/crm.js mounts it: each router below sits inside crm.js's r0 or r1 at the
// place its routes held in the one file, so Express tries them in the same order.
// mount() runs once at the end of boot with server.js's ctx and what the helper
// modules hand back. A relative require() or import() reads from this folder.
// Tests read it through readSource("server.js") (scripts/lib/readSource.js).
const express = require("express");
const DTAGS = require("../../donorTags");   // FIX-33: internal flags never reach a screen as tags
const ItemRefs = require("../../itemRefs");   // THREAD-2: the things a sentence names
const SEALED_MAIL = require("../mail/sealedMail");   // SECURE-3: a synced email's body opens only here
const { newId } = require("../shared/newId");   // IDS-1: every new row id is prefix + 20 hex
const { sql } = require("../db/sql");   // REDTEAM-2: SQL text only from the code

const routers = {
  r1: express.Router(),
  r1_2: express.Router(),
};

function mount(ctx) {
const {
  GR, OU, PT_READY, UNDO_SECONDS, UNKNOWN_ROLE, UNKNOWN_STATUS, actor, birthdayMod, buildDonorListFilter,
  calcWealthScore, checkPlanLimit, checkWriteAccess, computeDriftForDonors, computeRetentionRate, donorLock,
  donorPhotoUrl, driftBadgeField, enrollInSequences, figureSources, givingSourcesMod, keepImportedTotals,
  livePlanSentence, livePlansFor, lookupMatchingGift, markDonorsForGeocoding, orgFiscalYearStart,
  orgStewardStart, orgToday, orgTz, query, requireAdmin, requireAuth, requireCrm, run, uuid, wrap,
} = ctx;
let PT = null;
PT_READY.then(m => { PT = m; });
let app = routers.r1;

// GET /donors — unpaginated legacy shape (plain array) when `limit` is
// absent, so every pre-pagination caller keeps working; `{donors, total}`
// when `limit` is present. Filters (search/stage/status/assignedTo/sort)
// are honored in both modes.
app.get("/donors", requireAuth, wrap(async (req, res) => {
  // LIST-2: each step's time, in the Server-Timing header and in the log when
  // the whole read passes two seconds, so a slow list says where it was slow.
  const t0 = Date.now(), steps = [];
  let tl = t0;
  const lap = name => { const now = Date.now(); steps.push([name, now - tl]); tl = now; };
  // IMPORT-6 · Everyone · Donors · Contacts, each counted (groups.directoryRoles)
  const { roleCounts, role } = await GR.directoryRoles(req.user.orgId, req.query, rq => buildDonorListFilter({ ...req, query: rq }));
  lap("roles");
  const filter = await buildDonorListFilter(role === req.query.role ? req : { ...req, query: { ...req.query, role } });
  lap("filter");
  if (filter.badFilter) return res.status(400).json({ error: "bad_filter", sentence: filter.badFilter });   // LIST-1
  if (filter.badRole) return res.status(400).json(UNKNOWN_ROLE);
  if (filter.badStatus) return res.status(400).json(UNKNOWN_STATUS);
  if (!(await OU.orgUser(req.user.orgId, req.query.assignedTo, { allowInactive: true })).ok) return OU.refuse(res, "assignedTo");
  let { whereSql, params, orderBy, selectCols, selectArgs } = filter;
  // WALKB-1 · A SEARCH SAYS WHY EACH PERSON MATCHED, NAMES FIRST
  // (server/donors/personMatch.js personMatchReasonSql).
  const searchQ = String(req.query.search || "").trim();
  if (searchQ) {
    const PM = require("./personMatch");
    const why = PM.personMatchReasonSql(PM.foldedPattern(searchQ));
    selectCols = `${selectCols}, ${why.sql} AS match_reason`;
    selectArgs = [...selectArgs, ...why.args];
    // the ORDER BY's argument goes after the WHERE's (orderArgs, below)
    if (!req.query.dir) orderBy = `(${PM.FOLD("donors.name")} LIKE ? ESCAPE '\\') DESC, ${orderBy}`;
  }
  const orderArgs = searchQ && !req.query.dir ? [require("./personMatch").foldedPattern(searchQ)] : [];
  const PRm = require("../../prospect");
  const roomWord = a => (a ? { word: a.word, label: a.label, rank: a.rank } : { word: "unknown", label: "Not yet known", rank: 0 });
  const mayRoom = await PRm.canSee(req.user.userId, req.user.orgId);
  let roomMap = null;
  // BUILD-76 Part 2 — every donor row carries the drift badge field, computed
  // fresh by the same function as the home list (one computation, one truth).
  const mapDonor = (tpMap, driftMap) => d => ({
    ...d,
    tags: DTAGS.visibleTags(d.tags),
    last_touchpoint: tpMap[d.id] || null,
    matching_gift: lookupMatchingGift(d.employer),
    drift: driftBadgeField(driftMap.get(d.id)),
    // BUILD-94 Part 1 — the signed, expiring URL for this donor's photograph,
    // or null. Minted here rather than stored so a payload can never carry a
    // link that outlives its signature.
    photo_url: donorPhotoUrl(req.user.orgId, d.photo_asset_id),
    // BUILD-94 Part 2 — normalised here so a NULL legacy column and an
    // explicit ["donor"] reach the client as the same thing.
    person_types: PT.typesOf(d),
    // FIX-33 · Room to give rides on the row, from prospect.roomToGive, the
    // one function the profile's block reads too. Only for someone who may
    // see it (admin or the major gifts permission); null for anyone else.
    room: roomMap ? roomWord(roomMap.get(d.id)) : null,
    // FIX-33 · the owner in words. An imported person with nobody assigned
    // read "?"; they read "No owner", beside an Assign that uses the one
    // assign route (PATCH /donors/:id/assign).
    owner_label: d.assigned_to_name || d.pending_assignee_name || "No owner",
    // WALKB-1: why a search found them, in words ("email: marlowe@…"); null with no search.
    match_why: d.match_reason ? require("./personMatch").matchReasonWords(d.match_reason) : null,
    archived: !!d.archived_at,
  });

  // SECURE-2 item 3: this list always pages (default 100, at most 500). The
  // old no-limit form read every person in the org in one answer.
  const limit  = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const [donors, cnt] = await Promise.all([
    query(...require("./listPage").pageSql({ selectCols, selectArgs, whereSql, params, orderBy, orderArgs, limit, offset })),
    query(`SELECT COUNT(*) AS c FROM donors WHERE ${whereSql}`, params),
  ]);
  await require("./ownerName").withLiveOwnerNames(query, donors);   // INTEGRITY-1: one owner field
  lap("page");
  // Touchpoints + drift only for the page's donors — not the org-wide GROUP BY
  const ids = donors.map(d => d.id);
  const waitingAtDrift = require("../../db").poolStats().waiting;
  const [touchpoints, { map: driftMap }] = await Promise.all([
    ids.length
      ? query("SELECT donor_id, MAX(date) AS last_touchpoint FROM interactions WHERE org_id = ? AND donor_id = ANY(?) GROUP BY donor_id", [req.user.orgId, ids])
      : Promise.resolve([]),
    computeDriftForDonors(req.user.orgId, { donorIds: ids.length ? ids : ["_none_"], store: false }),   // LIST-2: a GET writes nothing
  ]);
  const tpMap = Object.fromEntries(touchpoints.map(r => [r.donor_id, r.last_touchpoint]));
  lap("drift");
  if (mayRoom && ids.length) roomMap = await PRm.roomToGive(req.user.orgId, ids);
  lap("room");
  // LIST-1: the columns she chose, for this page only (donorList.js cellsFor).
  const cols = String(req.query.cols || "").split(",").map(s => s.trim()).filter(Boolean).slice(0, 40);
  const cells = cols.length ? await require("../../donorList").cellsFor(req.user.orgId, donors, cols) : null;
  lap("cells");
  const out = donors.map(mapDonor(tpMap, driftMap));
  if (cells) for (const d of out) d.cells = cells.get(d.id) || {};
  // LIST-2: the Lifetime on each row is the profile's (shared/numbers/lifetime.js),
  // one read for the page, so the column and the Lifetime filter agree with it.
  if (ids.length) {
    const lt = await require("../../shared/numbers/lifetime").lifetimeCents(query, req.user.orgId, ids);
    for (const d of out) if (lt.has(d.id)) {
      d.total_giving = lt.get(d.id) / 100;
      if (d.cells && "lifetime" in d.cells) d.cells.lifetime = d.total_giving;
    }
  }
  lap("lifetime");
  res.setHeader("Server-Timing", steps.map(([n, ms]) => `${n};dur=${ms}`).join(", "));
  if (Date.now() - t0 > 2000) {
    const ps = require("../../db").poolStats();
    console.warn(`[donors-list] slow read ${Date.now() - t0}ms org=${req.user.orgId} ${steps.map(([n, ms]) => `${n}=${ms}`).join(" ")} pool=${ps.total}/${ps.max} waiting=${ps.waiting} waitingAtDrift=${waitingAtDrift}`);
  }
  res.json({ donors: out, total: parseInt(cnt[0].c, 10), ...(roleCounts ? { roleCounts, role: role === "donor" ? "donors" : role === "contact" ? "contacts" : "everyone" } : {}) });
}));

// Lightweight whole-org list for consumers that need every donor but not the
// heavy text columns (notes, score_rationale — the bulk of GET /donors'
// 21.7MB payload at 25k donors). Feeds the app shell's shared donor state:
// Kanban/team/re-engage/map views, onboarding snapshot, Communications
// audience counts, AI context builders. Column names match GET /donors so
// adaptDonor works unchanged on the subset.
app.get("/donors/summaries", requireAuth, wrap(async (req, res) => {
  // SECURE-2 item 3: a page at a time (default 100, at most 500); a screen
  // that wants everyone pages through (client/src/lib/pages.js).
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  // FIX-60: a pledge keeps a person off Lapsed (lapseRule.js), on every list.
  const _sumToday = orgToday(await orgTz(req.user.orgId));   // ORG_TZ_SEAM_OK
  const _sumHold = require("../../shared/numbers/lapse").holdSql("donors.id", _sumToday);
  // POLISH-4: who Re-engage names, decided once (shared/numbers/lapse.js).
  const _sumRe = require("../../shared/numbers/lapse").reengageSql("donors", _sumToday);
  const _sumLost = require("../../shared/numbers/lapse").lostSql("donors", _sumToday);   // COUNTS-1: Re-engage's Lost & Found
  const [donors, touchpoints, { map: driftMap }] = await Promise.all([
    query(`SELECT id, name, email, phone, stage, status, total_giving, last_gift_date,
                  last_gift_amount, gift_count, assigned_to, assigned_to_name,
                  pending_assignee_invite_id, pending_assignee_name,
                  city, state, zip, country, address, kind, contact_name,
                  latitude, longitude, geocode_status,
                  tags, wealth_score, capacity_tier, planned_giving,
                  employer, stripe_subscription_status,
                  deceased, do_not_contact, do_not_solicit, do_not_mail, do_not_email,
                  imported_sustainer, imported_sustainer_amount, imported_sustainer_last_gift,
                  birth_month, birth_day, birth_year, ${_sumHold.sql} AS pledge_hold, ${_sumRe.sql} AS reengage, ${_sumLost.sql} AS lost,
                  ${require("../../shared/numbers/atRisk").LAST_YEAR_OF_GIVING("donors")} AS last_year_giving
           FROM donors WHERE org_id = ? AND deleted_at IS NULL ORDER BY total_giving DESC, id LIMIT ? OFFSET ?`, [..._sumHold.args, ..._sumRe.args, ..._sumLost.args, req.user.orgId, limit, offset]),
    query("SELECT donor_id, MAX(date) AS last_touchpoint FROM interactions WHERE org_id = ? GROUP BY donor_id", [req.user.orgId]),
    computeDriftForDonors(req.user.orgId),   // BUILD-76 — the shared-state views badge from the same computation
  ]);
  await require("./ownerName").withLiveOwnerNames(query, donors);   // INTEGRITY-1: one owner field
  res.setHeader("X-Total-Count", String(await require("../../shared/numbers/everyone").everyoneCount(query, req.user.orgId)));   // INTEGRITY-1: Everyone
  const tpMap = Object.fromEntries(touchpoints.map(r => [r.donor_id, r.last_touchpoint]));
  res.json(donors.map(d => ({
    ...d,
    tags: DTAGS.visibleTags(d.tags),
    last_touchpoint: tpMap[d.id] || null,
    matching_gift: lookupMatchingGift(d.employer),
    drift: driftBadgeField(driftMap.get(d.id)),
  })));
}));

// (route deleted, BUILD-75 B.4 — zero references anywhere: client, tests, scripts, docs. See audit/BUILD-75-FINDINGS.md B.1 orphan verdicts.)

app.get("/donors/custom-field-values/all", requireAuth, wrap(async (req, res) => {
  // BUILD-78: values live on the donor row (JSONB, keyed by the immutable
  // field key), so this is one column read — no EAV join, no pivot.
  const rows = await query(
    "SELECT id, custom_fields FROM donors WHERE org_id = ? AND deleted_at IS NULL AND custom_fields IS NOT NULL",
    [req.user.orgId]
  );
  res.json(rows.map(r => ({ donorId: r.id, values: r.custom_fields || {} })));
}));

// Pipeline stage counts — reuses the same grouping the Dashboard's Donor
// Pipeline/funnel widgets compute, exposed as its own callable endpoint.
// BUILD-83 Part 3.5 — PLACED vs SUGGESTED, side by side and never conflated.
// `placed` counts donors a human actually put in a stage; `suggested` counts
// what the giving history proposes for the ones nobody has touched. A caller
// that shows the suggestion must say it is one (Home does).
app.get("/donors/stage-counts", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    `SELECT COALESCE(stage, suggested_stage) AS stage,
            (stage IS NOT NULL) AS placed,
            COUNT(*) AS count, COALESCE(SUM(total_giving),0) AS total
       FROM donors WHERE org_id = ? AND deleted_at IS NULL
        AND COALESCE(stage, suggested_stage) IS NOT NULL
      GROUP BY 1, 2`,
    [req.user.orgId]
  );
  const merge = (acc, r) => {
    const k = r.stage;
    acc[k] = acc[k] || { stage: k, count: 0, total: 0 };
    acc[k].count += parseInt(r.count, 10);
    acc[k].total += parseFloat(r.total) || 0;
    return acc;
  };
  const placedRows = rows.filter(r => r.placed === true || r.placed === "t");
  const suggestedRows = rows.filter(r => !(r.placed === true || r.placed === "t"));
  const placed = Object.values(placedRows.reduce(merge, {}));
  const suggested = Object.values(suggestedRows.reduce(merge, {}));
  const anyPlaced = placed.reduce((n, r) => n + r.count, 0) > 0;
  // An OBJECT, deliberately: the caller must know whether it is holding the
  // board a human built or a suggestion the file proposed, and an array cannot
  // carry that without a caller that silently ignores it.
  res.json({ counts: anyPlaced ? placed : suggested, placed, suggested, anyPlaced });
}));

// ── PROFILE-1 — THE FOUR FIGURES AT THE TOP OF A PERSON'S RECORD ───────────
// Lifetime giving, the last gift, how long since we last spoke, and what we
// are asking them for. Each one is a figure like every other number in
// Steward: its VALUE comes from figureSources.figureValue, and the `source`
// it carries is exactly what the drawer re-fetches for the rows behind it, so
// the number on the record and the rows in the drawer are one computation and
// cannot drift apart.
//
// A figure with NO ROWS BEHIND IT IS NOT A ZERO. "£0 lifetime" and "nobody
// has given yet" are different facts and a record that says the first when it
// means the second is lying. So an empty figure comes back with value null
// and a sentence saying what will appear there and when.
const PROFILE_FIGURE_BLANKS = {
  softCredit: {
    blank: "No one has credited a gift to this person. When someone else's gift is credited to them, or a matching gift is, it shows here and never in Lifetime.",
    short: "No soft credit.",
  },
  lifetime: {
    blank: "Nothing has been given on this record yet. The first gift, logged here, imported, or given online, starts this total, and it never resets.",
    short: "No giving yet.",
  },
  lastGift: {
    blank: "No gift has come in from this person yet. The first one shows here the day it lands, with its date, its fund and how it was paid.",
    short: "No gift yet.",
  },
  contact: {
    blank: "Nobody has logged a conversation with this person yet. Log a call, a meeting, an email, an ask or a note and this becomes the days since the last one.",
    short: "Never contacted.",
  },
  openAsk: {
    blank: "There is no ask in flight with this person. Open a proposal and what you are asking for sits here until they say yes or no.",
    short: "No open ask.",
  },
  lastMet: {
    blank: "Nobody here has met this person yet, on a connected calendar or logged by hand. The first meeting shows here the day it happens.",
    short: "Not met yet.",
  },
  thisYear: {
    blank: "Nothing given yet this fiscal year. A gift dated in it shows here the day it is recorded.",
    short: "Nothing yet this fiscal year.",   // PROFILE-2: the number is the fiscal year
  },
  lastEmail: {
    blank: "No email with this person is on the record. Connect your inbox, or BCC Steward, and the next one lands here.",
    short: "No email yet.",
  },
};

// VOICE-4: the line under Last met is one short phrase, never cut mid-word.
// "Lunch. Went well, she made a gift to the boat fund" reads "Lunch, went
// well"; a longer first clause is cut back to the last whole word.
const MEETING_PHRASE_MAX = 22;
const PHRASE_TAIL = /\s+(?:a|an|the|at|to|of|in|on|for|with|and|or|down|up|about|from|by)$/i;
function meetingPhrase(name) {
  const line = String(name || "").split("\n")[0].replace(/\s+/g, " ").trim();
  if (!line) return null;
  const sentences = line.split(/(?<=[.!?])\s+/).map(x => x.replace(/[.!?]+$/, "").trim()).filter(Boolean);
  const clause = x => String(x || "").split(/[,;:(]|\s[-\u2013]\s/)[0].trim();
  let out = clause(sentences[0]);
  // A one- or two-word opener ("Lunch.") takes the first clause of what follows.
  if (out.split(" ").length <= 2 && sentences[1]) out = `${out}, ${clause(sentences[1]).replace(/^./, c => c.toLowerCase())}`;
  if (out.length > MEETING_PHRASE_MAX) {
    const cut = out.slice(0, MEETING_PHRASE_MAX + 1);
    out = cut.slice(0, Math.max(cut.lastIndexOf(" "), 0)).replace(/[\s,;:]+$/, "") || out.split(" ")[0];
    while (PHRASE_TAIL.test(out)) out = out.replace(PHRASE_TAIL, "");
  }
  return out || null;
}

// The four, in one round trip. `today` is the ORGANISATION's civil date,
// computed once by the caller and handed to the source — figureSources.js
// never reads a clock for a calendar day.
async function donorProfileFigures(orgId, donorId, today) {
  const deps = { computeRetentionRate, computeDriftForDonors };
  const wanted = [
    ["lifetime", { key: "donor-lifetime",    params: { donor: donorId } }],
    ["lastGift", { key: "donor-last-gift",   params: { donor: donorId } }],
    ["contact",  { key: "donor-contact-gap", params: { donor: donorId, today } }],
    ["openAsk",  { key: "donor-open-ask",    params: { donor: donorId } }],
    // INT-BUILD-1 — the header reads Lifetime, Last gift, Last met, Last email.
    ["lastMet",   { key: "donor-last-met",   params: { donor: donorId, today } }],
    ["lastEmail", { key: "donor-last-email", params: { donor: donorId, today } }],
    // PROFILE-1 (header) — This year, beside Lifetime in the header's row.
    // NUMBERS-2: the org's own fiscal year, as Home and Fundraising.
    ["thisYear",  { key: "donor-gifts-between", params: { donor: donorId, from: orgFiscalYearStart(await orgTz(orgId)), to: today } }],   // ORG_TZ_SEAM_OK
    // FIX-49: soft and matching credits, their own figure, never in Lifetime.
    ["softCredit", { key: "donor-soft-credit", params: { donor: donorId } }],
  ];
  // PROFILE-1 (header) — the line under three of the numbers is read off the
  // figure's own first row (the same rows its drawer opens), so the date under
  // Last gift is the date of the gift that number is.
  const UNDER = {
    lastGift: r => r.date ? { date: String(r.date).slice(0, 10) } : null,
    lastMet: r => ({ date: String(r.date || "").slice(0, 10) || null, what: meetingPhrase(r.name) }),
    // POLISH-4: an email from them is "from them", not "replied": nothing says
    // it answered one of hers ("Email replied Oct 30" for a first message).
    // COUNTS-1: Last contact is the one rule (meetings.js conversationsWith); its line says which kind.
    contact: r => ({ date: String(r.date || "").slice(0, 10) || null, what: String(r.detail || "").split(" · ")[0] || null }),
    lastEmail: r => ({ date: String(r.date || "").slice(0, 10) || null, direction: /^From them/.test(r.detail || "") ? "from_them" : /^To them/.test(r.detail || "") ? "sent" : null }),
  };
  const got = await Promise.all(wanted.map(async ([k, source]) => {
    const f = await figureSources.figureValue(orgId, source, deps);
    const empty = !f.totalRows;
    let under = null;
    if (!empty && UNDER[k]) {
      const full = await figureSources.figure(orgId, source, deps, { page: 1, pageSize: 1 });
      const r = full && full.rows && full.rows[0];
      under = r ? UNDER[k](r) : null;
      // PROFILE-2: how the last gift was paid, from the gift itself (the drawer
      // row's detail is its thank-you state).
      if (k === "lastGift" && under && r.id) {
        const [g] = await query(`SELECT NULLIF(payment_method, '') AS m FROM gifts WHERE id = ? AND org_id = ?`, [r.id, orgId]);
        // "Needs you" is recordGift's word for a method nobody gave (server.js GIFT_METHOD_UNKNOWN).
        under.method = g && g.m && g.m !== "Needs you" ? g.m : null;
      }
    }
    return [k, {
      value: empty ? null : f.value,
      cents: empty ? null : f.cents,
      under,
      source,
      blank: empty ? PROFILE_FIGURE_BLANKS[k].blank : null,
      blankShort: empty ? PROFILE_FIGURE_BLANKS[k].short : null,
    }];
  }));
  // NUMBERS-1 · First, Largest and Average ride the same read as Lifetime, so
  // whatever refreshes one tile refreshes all of them (they were a second read
  // that the voice card and other doors never re-asked for).
  const glance = await require("../../numbers").donorGlance(query, orgId, donorId);
  const figs = Object.fromEntries(got);
  // IMPORT-4: This year leaves out gifts with no date, and says so on the figure itself.
  if (glance.undated && figs.thisYear) figs.thisYear = { ...figs.thisYear, notCounted: glance.undated.words, undatedSource: glance.undated.source };
  // A person whose every gift is undated has gifts, just no dated last one.
  if (glance.undated && figs.lastGift && figs.lastGift.value == null) figs.lastGift = { ...figs.lastGift, blank: "Their gifts on file have no date, so none is the last one.", blankShort: "No dated gift." };
  return { ...figs, first: glance.first, largest: glance.largest, average: glance.average, imported: glance.imported, undated: glance.undated };
}
app = routers.r1_2;

app.get("/donors/:id", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    "SELECT * FROM donors WHERE id = ? AND org_id = ?",
    [req.params.id, req.user.orgId]
  );
  if (!rows.length) return res.status(404).json({ error: "Donor not found" });

  const d = rows[0];
  d.tags = DTAGS.visibleTags(d.tags);
  // SECURE-3: the timeline is the one reader that opens a synced email's body.
  d.interactions = SEALED_MAIL.openInteractions(await query("SELECT * FROM interactions WHERE donor_id = ? AND org_id = ? ORDER BY date DESC NULLS LAST", [d.id, req.user.orgId]));
  // FIX-11 Part 1 — the gift carries its fund's NAME, not just its id. The
  // timeline line reads "$100,000.00 · General Operating · ACH", and a screen
  // that only had `fund_id` had to either print an id at a fundraiser or load
  // the fund list a second time to translate it.
  d.gifts = await query(
    `SELECT g.*, f.name AS fund_name, ev.name AS event_name,
            -- LEDGER-1: who this gift is soft-credited to, so the row says "Soft credit to …"
            (SELECT COALESCE(json_agg(json_build_object('donorId', sd.id, 'name', sd.name, 'amount', sc.amount) ORDER BY sd.name), '[]'::json)
               FROM gift_soft_credits sc JOIN donors sd ON sd.id = sc.donor_id AND sd.org_id = sc.org_id AND sd.deleted_at IS NULL
              WHERE sc.gift_id = g.id AND sc.org_id = g.org_id) AS soft_credit_to,
            -- GIFTS-2: a gift split across funds carries its lines, largest first
            (SELECT json_agg(json_build_object('fundId', l.fund_id, 'fundName', lf.name, 'amount', l.amount) ORDER BY l.amount DESC, l.fund_id)
               FROM gift_fund_lines l LEFT JOIN fin_funds lf ON lf.id = l.fund_id AND lf.org_id = l.org_id
              WHERE l.gift_id = g.id AND l.org_id = g.org_id) AS fund_lines
       FROM gifts g LEFT JOIN fin_funds f ON f.id = g.fund_id AND f.org_id = g.org_id
       LEFT JOIN events ev ON ev.id = g.event_id AND ev.org_id = g.org_id
      WHERE g.donor_id = ? AND g.org_id = ? ORDER BY g.date DESC NULLS LAST, g.created_at DESC NULLS LAST, g.id DESC`, [d.id, req.user.orgId]);
  d.matching_gift = lookupMatchingGift(d.employer);
  // BUILD-76 — the donor record shows the drift reason inline; same
  // computation as the list and every badge.
  const { map: driftMap } = await computeDriftForDonors(req.user.orgId, { donorIds: [d.id] });
  d.drift = driftBadgeField(driftMap.get(d.id));
  // BUILD-89S 89f — a donor who gives monthly through a connected source says
  // so on the record, in the SAME sentence the recurring dashboard uses
  // (shared/givingSources.js recurringPhrase), so the two cannot drift apart.
  // "Gives $50 monthly through PayPal" when the provider named it; "Looks like
  // $50 monthly through PayPal" while it is still Steward's own reading.
  try {
    const rec = await query(
      `SELECT r.amount_cents, r.interval, r.confidence, r.provider, r.expected_next, r.confirmed_at, s.display_name
         FROM giving_recurring r
         JOIN giving_sources s ON s.id = r.source_id AND s.org_id = r.org_id
        WHERE r.org_id=? AND r.donor_id=? AND r.status <> 'ended' AND s.status <> 'disconnected'
        ORDER BY r.amount_cents DESC LIMIT 1`, [req.user.orgId, d.id]);
    if (rec.length) {
      const { recurringPhrase } = await givingSourcesMod();
      const r = rec[0];
      d.source_recurring = {
        phrase: recurringPhrase({ amountCents: Number(r.amount_cents), interval: r.interval, confidence: r.confidence },
                                { provider: r.provider }),
        amountCents: Number(r.amount_cents), interval: r.interval,
        confidence: r.confidence, confirmed: !!r.confirmed_at,
        sourceName: r.display_name, expectedNext: r.expected_next,
      };
    }
  } catch (e) { console.error("[donor] source recurring:", e.message); }
  // BUILD-94 Part 1 — the record's own photo URL. The header signs its own
  // rather than reading the /people/photos map, so a profile is never the
  // record whose face went missing because a list was capped.
  d.photo_url = donorPhotoUrl(req.user.orgId, d.photo_asset_id);
  d.person_types = PT.typesOf(d);   // BUILD-94 Part 2
  // PROFILE-1 — the four figures, each carrying the source its drawer opens.
  d.figures = await donorProfileFigures(
    req.user.orgId, d.id, orgToday(await orgTz(req.user.orgId)));   // ORG_TZ_SEAM_OK
  // SECURE-2 item 3: an imported address that is not one is kept, and flagged.
  d.contact_flags = await require("../../contactInputs").contactFlags(d);
  res.json(d);
}));

// ═══ PROFILE-1 (header + tabs) · THE RAIL, IN ONE READ ═══════════════════════
// The facts the profile's ink rail adds beside Next step and the scores: the
// giving rhythm LIVE-1 stored, a monthly plan, gifts waiting for a thank-you,
// what is coming up, how to reach them, volunteering and where their gifts
// come from. A card with nothing to say is null or an empty list, never an
// empty object, so the client leaves it out. Every number carries the source
// its rows open from. A read only: nothing here writes or heals.
const RAIL_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const railMeetings = require("../../meetings");
const railMoney = n => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2, maximumFractionDigits: 2 });
const RAIL_PROVIDER_WORD = { paypal: "PayPal", zeffy: "Zeffy", givebutter: "Givebutter", square: "Square", stripe: "Stripe", quickbooks: "QuickBooks" };
function railNextBirthday(month, day, today) {
  if (!month || !day) return null;
  const y = +today.slice(0, 4);
  const on = yr => {
    const leap = yr % 4 === 0 && (yr % 100 !== 0 || yr % 400 === 0);
    const d = month === 2 && day === 29 && !leap ? 28 : day;
    return `${yr}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  };
  const thisYear = on(y);
  return thisYear >= today ? thisYear : on(y + 1);
}
app.get("/donors/:id/rail", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId, id = req.params.id;
  const [d] = await query(
    `SELECT id, name, email, phone, address, address2, city, state, zip, country, birth_month, birth_day,
            deceased, do_not_contact, do_not_solicit, do_not_mail, do_not_email, email_unreachable, address_unmailable,
            phone_unreachable, is_client, (SELECT client_privacy FROM orgs WHERE id = donors.org_id) AS client_privacy
       FROM donors WHERE id = ? AND org_id = ? AND deleted_at IS NULL`, [id, orgId]);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  const today = orgToday(await orgTz(orgId));   // ORG_TZ_SEAM_OK
  const plus = n => { const t = new Date(today + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  const horizon = plus(60);
  const since = await orgStewardStart(orgId);
  const val = s => figureSources.figureValue(orgId, s);
  const [rhy, subs, srcRec, unthanked, events, meetingsAhead, steps, vh, origins, suppressed] = await Promise.all([
    query(`SELECT rhythm, expected_next FROM donor_rhythm WHERE org_id = ? AND donor_id = ?`, [orgId, id]),
    query(`SELECT id, amount, interval, status, TO_CHAR(current_period_end, 'YYYY-MM-DD') AS next_charge
             FROM recurring_subscriptions
            WHERE org_id = ? AND donor_id = ? AND status IN ('active','past_due','recovering','recovered','paused')
            ORDER BY (status IN ('past_due','recovering')) DESC, amount DESC LIMIT 1`, [orgId, id]),
    query(`SELECT r.id, r.amount_cents, r.interval, r.expected_next, r.status, s.provider, s.display_name
             FROM giving_recurring r JOIN giving_sources s ON s.id = r.source_id AND s.org_id = r.org_id
            WHERE r.org_id = ? AND r.donor_id = ? AND r.status <> 'ended' AND s.status <> 'disconnected'
            ORDER BY r.amount_cents DESC LIMIT 1`, [orgId, id]),
    since ? query(`SELECT g.id, g.amount, g.date,
                          (SELECT t.id FROM thank_you_drafts t WHERE t.org_id = g.org_id AND t.gift_id = g.id
                              AND t.sent_at IS NULL AND t.skipped_at IS NULL ORDER BY t.created_at DESC LIMIT 1) AS draft_id
                     FROM gifts g
                    WHERE g.org_id = ? AND g.donor_id = ? AND COALESCE(g.is_sample,false) = false
                      AND g.date >= ? AND COALESCE(g.acknowledgement_sent,false) = false AND g.amount > 0
                    ORDER BY g.date DESC NULLS LAST, g.created_at DESC NULLS LAST, g.id DESC`, [orgId, id, since]) : [],
    query(`SELECT e.id, e.name, LEFT(e.date::text, 10) AS date FROM event_attendees ea JOIN events e ON e.id = ea.event_id AND e.org_id = ea.org_id
            WHERE ea.donor_id = ? AND ea.org_id = ? AND LEFT(e.date::text, 10) >= ?
              AND COALESCE(ea.status, '') NOT IN ('cancelled','canceled','declined')
              AND e.date_unknown IS NOT TRUE   -- IMPORT-4: an imported event whose day the file never gave is past, not coming up
            ORDER BY e.date ASC LIMIT 6`, [id, orgId, today]),
    railMeetings.meetingsWith(orgId, id, { held: false, limit: 50 }),
    query(`SELECT st.id, st.label, st.due_date, p.template_name
             FROM cultivation_plan_steps st JOIN cultivation_plans p ON p.id = st.plan_id AND p.org_id = st.org_id
            WHERE st.org_id = ? AND p.donor_id = ? AND p.status = 'active' AND st.status IN ('open','pending')
              AND st.due_date >= ? AND st.due_date <= ?
            ORDER BY st.due_date ASC LIMIT 6`, [orgId, id, today, horizon]),
    query(`SELECT COALESCE(SUM(hours), 0)::float AS h, TO_CHAR(MAX(date::date), 'YYYY-MM-DD') AS last
             FROM volunteer_shifts WHERE org_id = ? AND person_id = ?`, [orgId, id]),
    query(`SELECT CASE WHEN g.giving_page_id IS NOT NULL THEN 'page'
                       WHEN g.giving_source_id IS NOT NULL THEN 'source'
                       WHEN g.stripe_payment_id IS NOT NULL THEN 'stripe'
                       WHEN g.read_from_vendor = 'quickbooks' THEN 'quickbooks' END AS origin,
                  CASE WHEN g.giving_page_id IS NULL THEN g.giving_source_id END AS ref,
                  COUNT(*)::int AS n
             FROM gifts g WHERE g.org_id = ? AND g.donor_id = ?
              AND (g.giving_page_id IS NOT NULL OR g.giving_source_id IS NOT NULL OR g.stripe_payment_id IS NOT NULL OR g.read_from_vendor = 'quickbooks')
            GROUP BY 1, 2`, [orgId, id]),
    d.email ? query(`SELECT 1 AS y FROM email_suppressions WHERE LOWER(email) = LOWER(?) AND (org_id = ? OR org_id IS NULL) LIMIT 1`, [d.email, orgId]) : [],
  ]);
  const lifetimeSrc = { key: "donor-lifetime", params: { donor: id } };

  // GIVING RHYTHM, said once. STATUS-1: the expected next gift and whether it
  // is late are the one rhythm's (shared/numbers/rhythm.js through
  // drift.assessDrift), read from the gifts as they are now, so this card, the
  // closeness sentence, the Lapsing tag and Drift give one answer. The rhythm's
  // name is still the one afterChange.js stored (donor_rhythm), which is the
  // same rule (drift.rhythmOf).
  let rhythm = null;
  const r = rhy[0];
  const DR = require("../../drift");
  const gsR = await query(`SELECT LEFT(g.date,10) AS date, g.amount::text AS amount FROM gifts g WHERE g.org_id = ? AND g.donor_id = ? AND g.amount > 0 AND LEFT(g.date,10) <= ? AND ${require("../../shared/numbers/money").MONEY("g")}`, [orgId, id, today]);
  const aR = DR.assessDrift(gsR.map(g => ({ date: g.date, amount: Number(g.amount) })), today);
  const name = aR && aR.basis ? DR.rhythmOf(aR) : (r ? r.rhythm : "none");
  const exp = aR && aR.expectedNext ? String(aR.expectedNext).slice(0, 10) : null;
  if (name !== "none" || exp) {
    const sentence = (name === "yearly" || name === "year_end") && exp
      ? `Gives every ${RAIL_MONTHS[+exp.slice(5, 7) - 1]}` : (DR.RHYTHM_WORDS[name] || DR.RHYTHM_WORDS.none);
    // PROFILE-2 Part 4: a steady gap between the named bands (every two
    // months, say) is "none" beside an expected next gift; Drift's own reading
    // names it here, the way routes/profileStatus.js does.
    const said = name === "none" && exp && aR.cadenceDays ? `Gives ${DR.humanCadence(aR.cadenceDays)}` : sentence;
    rhythm = { sentence: said, expectedNext: exp, late: !!aR.late, source: lifetimeSrc };
  }

  // RECURRING: a monthly plan Steward charges, else a schedule in a source.
  let recurring = null;
  if (subs[0]) {
    const s = subs[0], failed = ["past_due", "recovering"].includes(s.status);
    const source = { key: "donor-gifts-from", params: { donor: id, origin: "plan", ref: s.id } };
    const word = s.interval === "year" ? "yearly" : "monthly";
    recurring = { amount: Number(s.amount), interval: s.interval || "month", nextCharge: failed || s.status === "paused" ? null : s.next_charge || null,
      failed, paused: s.status === "paused",
      sentence: failed ? `The card on their ${word} gift is failing` : s.status === "paused" ? `Their ${word} gift is paused` : `Gives ${railMoney(s.amount)} ${word}`,
      source, given: await val(source) };
  } else if (srcRec[0]) {
    const s = srcRec[0], amount = Number(s.amount_cents) / 100;
    const source = { key: "donor-gifts-from", params: { donor: id, origin: "recurring", ref: s.id } };
    const via = RAIL_PROVIDER_WORD[s.provider] || s.display_name;
    recurring = { amount, interval: s.interval || "month", nextCharge: s.expected_next ? String(s.expected_next).slice(0, 10) : null,
      failed: s.status === "missed", paused: false,
      sentence: s.status === "missed" ? `A ${via} gift they give on a schedule did not come in` : `Gives ${railMoney(amount)} ${s.interval === "year" ? "yearly" : "monthly"} through ${via}`,
      source, given: await val(source) };
  }
  if (recurring && recurring.given) recurring.given = { value: recurring.given.value, count: recurring.given.totalRows };

  // THANK-YOUS: the gifts the 0.6 rule says are still owed one.
  const thankYousSource = since ? { key: "unthanked", params: { since, donor: id } } : null;
  // Each gift opens the waiting list it is one row of.
  const thankYous = unthanked.map(g => ({ giftId: g.id, amount: Number(g.amount), date: String(g.date).slice(0, 10),
    draftId: g.draft_id || null, source: thankYousSource }));

  // COMING UP: the next sixty days, soonest first.
  const comingUp = [];
  const bd = railNextBirthday(Number(d.birth_month) || 0, Number(d.birth_day) || 0, today);
  if (bd && bd <= horizon) comingUp.push({ kind: "birthday", label: "Birthday", date: bd });
  for (const e of events) comingUp.push({ kind: "event", label: e.name, date: e.date, id: e.id });
  for (const m of meetingsAhead) if (m.date && m.date >= today && m.date <= horizon) comingUp.push({ kind: "meeting", label: m.title || "Meeting", date: m.date, id: m.id });
  for (const st of steps) comingUp.push({ kind: "journey", label: st.label, date: String(st.due_date).slice(0, 10), id: st.id, journey: st.template_name });
  comingUp.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // VOLUNTEERING: the profile's own volunteer-hours source, lifetime.
  const h = vh[0] && Number(vh[0].h) || 0;
  const volunteering = h > 0 ? { hours: Math.round(h * 100) / 100, lastShift: vh[0].last || null,
    source: { key: "volunteer-hours", params: { from: "1900-01-01", to: "2999-12-31", donor: id } } } : null;

  // CONNECTED: one card per place their gifts came from.
  const srcIds = [...new Set(origins.filter(o => o.origin === "source" && o.ref).map(o => o.ref))];
  const srcNames = srcIds.length ? await query(`SELECT id, provider, display_name FROM giving_sources WHERE org_id = ? AND id = ANY(?)`, [orgId, srcIds]) : [];
  const nameOf = Object.fromEntries(srcNames.map(s => [s.id, s]));
  const connected = await Promise.all(origins.filter(o => o.origin).map(async o => {
    const params = { donor: id, origin: o.origin, ...(o.origin === "source" ? { ref: o.ref } : {}) };
    const source = { key: "donor-gifts-from", params };
    const f = await val(source);
    const s = o.origin === "source" ? nameOf[o.ref] : null;
    const provider = o.origin === "source" ? (s ? s.provider : "source") : o.origin;
    const label = o.origin === "page" ? "A giving page" : o.origin === "source" ? (RAIL_PROVIDER_WORD[provider] || (s && s.display_name) || "A connected source")
      : RAIL_PROVIDER_WORD[o.origin];
    return { provider, label, count: f.totalRows, total: f.value, source };
  }));
  connected.sort((a, b) => b.total - a.total);

  // CONTACT: how to reach them, and every flag that says not to, plainly.
  // The country is said only when it is not the default and there is an
  // address to go with it ("US" alone is not an address).
  const street = [d.address, d.address2, [d.city, [d.state, d.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")]
    .map(x => String(x || "").trim()).filter(Boolean);
  const country = String(d.country || "").trim();
  const address = street.length ? [...street, ...(country && !/^(us|usa|united states)$/i.test(country) ? [country] : [])].join(", ") : null;
  const flags = [];
  if (d.deceased) flags.push({ key: "deceased", label: "Deceased" });
  if (d.do_not_contact) flags.push({ key: "do_not_contact", label: "Do not contact" });
  if (d.do_not_solicit) flags.push({ key: "do_not_solicit", label: "Do not solicit" });
  if (d.do_not_mail) flags.push({ key: "do_not_mail", label: "Do not mail" });
  if (d.do_not_email || suppressed.length) flags.push({ key: "do_not_email", label: "No email: opted out" });
  if (d.email_unreachable) flags.push({ key: "email_unreachable", label: "Email bounced" });
  if (d.address_unmailable) flags.push({ key: "address_unmailable", label: "Address returned mail" });
  if (d.phone_unreachable) flags.push({ key: "phone_unreachable", label: "Phone marked wrong" });
  // CLIENT-SAFE-1: the client flag has its own row (ContactExtras), shown when
  // the org's privacy mode is on or the flag is already set.
  const contact = { email: d.email || null, phone: d.phone || null, address, addressBad: d.address_unmailable === true, preferred: null, flags,
    isClient: d.is_client === true, privacyOn: d.client_privacy === true };

  res.json({ today, rhythm, recurring, thankYous, thankYousSource: thankYous.length ? thankYousSource : null,
    comingUp: comingUp.slice(0, 6), volunteering, connected, contact });
}));

app.post("/donors", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  // SECURE-2 item 3: a real email (with a "did you mean" hint) and a phone in one format.
  { const cv = await require("../../contactInputs").checkContact(req.body || {}, { email: ["email", "email2"], phone: ["phone"] });
    if (cv.error) return res.status(400).json({ error: cv.error, message: cv.error, field: cv.field });
    if (req.body) Object.assign(req.body, cv.values); }
  const { email, phone, status, stage, tags, notes, lastAmount, assignedTo, assignedToName, personTypes } = req.body;
  // ADDRESS-1: the + Add form carries the mailing address too.
  const addr = Object.fromEntries(["address", "address2", "city", "state", "zip"].map(f =>
    [f, req.body[f] == null ? null : (String(req.body[f]).trim().slice(0, f === "address" || f === "address2" ? 200 : 120) || null)]));
  // THREAD-2 · A NAME IS A NAME. "   " and the word "null" (a form that joined
  // two empty fields) were saved as names, and printed on the Thread and in
  // the morning email as a blank or as "null". Refused here, at the source.
  if (!(await ItemRefs.links()).realName(req.body.name)) return res.status(400).json({ error: "Name required" });
  const name = String(req.body.name).replace(/\s+/g, " ").trim();
  // BUILD-94 Part 2 — a person added by hand can be a volunteer from the
  // start. Unknown keys are dropped by normalizeTypes, never stored.
  const types = personTypes === undefined ? ["donor"] : PT.normalizeTypes(personTypes);

  const orgForLimit = await query("SELECT * FROM orgs WHERE id=?", [req.user.orgId]);
  if (orgForLimit.length) {
    const recordCheck = await checkPlanLimit(orgForLimit[0], "records");
    if (!recordCheck.isTrial && recordCheck.limit !== 999999999 && recordCheck.current >= recordCheck.limit) {
      return res.status(403).json({ error: "record_limit", message: `You've reached your donor record limit of ${recordCheck.limit}.`, current: recordCheck.current, limit: recordCheck.limit, plan: orgForLimit[0].plan, isTrial: false });
    }
  }

  // FIX-19: an assignee named here is an active user of this org, and the name
  // beside the id is read off that users row, never the payload.
  const named = await OU.orgUser(req.user.orgId, assignedTo);
  if (!named.ok) return OU.refuse(res, "assignedTo");

  const id = newId("d");
  let selfName = assignedToName;
  if (!assignedTo && !selfName) {
    const uRow = await query("SELECT name FROM users WHERE id = ?", [req.user.userId]);
    selfName = uRow[0]?.name || req.user.email;
  }
  const finalAssignedTo = assignedTo || req.user.userId;
  const finalAssignedToName = assignedTo ? (named.user.name || assignedToName || "") : selfName;
  await run(
    `INSERT INTO donors (id,org_id,name,email,phone,status,stage,total_giving,last_gift_amount,last_gift_date,gift_count,tags,notes,assigned_to,assigned_to_name,created_by,created_by_name,person_types,address,address2,city,state,zip)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    // BUILD-80 Part 10 — the quick form's typed amount carries NO date: a
    // last_gift_date of "today" was a fiction that un-drifted the donor.
    [id, req.user.orgId, name, email || "", phone || "", status || "new", stage || "prospect",
     lastAmount || 0, lastAmount || 0, null, lastAmount ? 1 : 0,
     JSON.stringify(tags || []), notes || "", finalAssignedTo, finalAssignedToName, actor(req).id, actor(req).name,
     JSON.stringify(types), addr.address, addr.address2, addr.city, addr.state, addr.zip]
  );
  if (addr.address || addr.city || addr.zip) {
    try { await markDonorsForGeocoding(req.user.orgId, { donorIds: [id] }); } catch (e) { console.error("[geocode] mark after add failed:", e.message); }
  }
  // NUMBERS-2: a typed amount with no gift behind it is kept as its own figure.
  if (lastAmount) await keepImportedTotals(query, req.user.orgId, [id], "an amount typed in when they were added");
  const rows = await query("SELECT * FROM donors WHERE id = ?", [id]);
  // INTEGRITY-1: an email already on another active person is said on save, never silent
  const warning = await require("../dataHealth/integrity").emailWarning(query, req.user.orgId, rows[0] && rows[0].email, id);
  res.status(201).json(warning ? { ...rows[0], warning } : rows[0]);
}));

// DATES-1 · ABOUT THEM: the short note somebody reads first when the profile
// opens (spouse's name, how they know the founder's family). One column on the
// person, not a timeline Note. Only this field changes; the audit middleware
// keeps the before and after like any other edit.
const ABOUT_THEM_MAX = 500;
app.patch("/donors/:id/about-them", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const raw = req.body && req.body.aboutThem;
  if (raw !== null && raw !== undefined && typeof raw !== "string") return res.status(400).json({ error: "bad_about", sentence: "The note about them is text." });
  const text = String(raw || "").replace(/\r\n?/g, "\n").trim();
  if (text.length > ABOUT_THEM_MAX) {
    return res.status(400).json({ error: "about_too_long", max: ABOUT_THEM_MAX, length: text.length,
      sentence: `That note is ${text.length.toLocaleString("en-US")} characters. Keep it to ${ABOUT_THEM_MAX} or fewer: it is the short note people read first. Longer notes go in the Notes tab.` });
  }
  const [d] = await query("SELECT id, name, about_them FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [req.params.id, orgId]);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  if ((d.about_them || "") === text) return res.json({ id: d.id, aboutThem: text, unchanged: true });
  await run("UPDATE donors SET about_them=?, updated_at=NOW() WHERE id=? AND org_id=?", [text || null, d.id, orgId]);
  res.json({ id: d.id, aboutThem: text, sentence: text ? `The note about ${d.name} is saved.` : `The note about ${d.name} is cleared.` });
}));

// AGENT-2: CHANGE HOW TO REACH SOMEBODY, AND ONLY THAT. PUT /donors/:id
// replaces the whole record (a missing stage there becomes "cultivate"), so a
// new email, phone or address arrives here instead: only the fields given
// change, an email must look like one, and an address change is kept in
// donor_address_history beside the tidy-up's own.
app.patch("/donors/:id/contact", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  // SECURE-2 item 3: a real email (with a "did you mean" hint) and a phone in one format.
  { const cv = await require("../../contactInputs").checkContact(req.body || {}, { email: ["email"], phone: ["phone"] });
    if (cv.error) return res.status(400).json({ error: cv.error, message: cv.error, field: cv.field });
    if (req.body) Object.assign(req.body, cv.values); }
  const orgId = req.user.orgId, b = req.body || {};
  const [d] = await query("SELECT id, name, email, phone, address, address2, city, state, zip FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [req.params.id, orgId]);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  const FIELDS = ["email", "phone", "address", "address2", "city", "state", "zip"];
  const next = {};
  for (const f of FIELDS) if (b[f] !== undefined && b[f] !== null) next[f] = String(b[f]).trim().slice(0, f === "address" || f === "address2" ? 200 : 120);
  if (next.email !== undefined) {
    next.email = next.email.toLowerCase();
    if (next.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.email)) return res.status(400).json({ error: "bad_email", message: "That does not look like an email address." });
  }
  const keys = Object.keys(next).filter(k => String(d[k] || "") !== next[k]);
  if (!keys.length) return res.json({ id: d.id, changed: [], unchanged: true, sentence: `${d.name}'s record already says that.` });
  if (keys.some(k => ["address", "address2", "city", "state", "zip"].includes(k))) {
    const was = { address: d.address, address2: d.address2, city: d.city, state: d.state, zip: d.zip };
    const now = { ...was }; for (const k of keys) if (k in now) now[k] = next[k];
    await run(`INSERT INTO donor_address_history (id, org_id, donor_id, source, before, after, created_by, created_by_name) VALUES (?,?,?,?,?::jsonb,?::jsonb,?,?)`,
      [newId("dah"), orgId, d.id, "edit", JSON.stringify(was), JSON.stringify(now), actor(req).id, actor(req).name]);
  }
  // REDTEAM-2: each column is one of FIELDS (sql.id throws on anything else), each value bound.
  await run(sql`UPDATE donors SET ${sql.join(keys.map(k => sql`${sql.id(k, FIELDS)} = ${next[k] || null}`))}, updated_at=NOW() WHERE id=${d.id} AND org_id=${orgId}`);
  if (keys.some(k => ["address", "city", "state", "zip"].includes(k))) {
    try { await markDonorsForGeocoding(orgId, { donorIds: [d.id] }); } catch (e) { console.error("[geocode] mark after contact edit failed:", e.message); }
  }
  const warning = keys.includes("email") ? await require("../dataHealth/integrity").emailWarning(query, orgId, next.email, d.id) : null;   // INTEGRITY-1
  res.json({ id: d.id, changed: keys, before: Object.fromEntries(keys.map(k => [k, d[k] ?? null])), ...(warning ? { warning } : {}),
    sentence: `${d.name}'s ${keys.map(k => k === "address2" ? "address" : k).filter((x, i, a) => a.indexOf(x) === i).join(", ")} ${keys.length === 1 ? "is" : "are"} changed.` });
}));

app.put("/donors/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  // SECURE-2 item 3: a real email (with a "did you mean" hint) and a phone in one format.
  { const cv = await require("../../contactInputs").checkContact(req.body || {}, { email: ["email", "email2"], phone: ["phone"] });
    if (cv.error) return res.status(400).json({ error: cv.error, message: cv.error, field: cv.field });
    if (req.body) Object.assign(req.body, cv.values); }
  const { email, phone, status, stage, tags, notes, city, state, zip, employer } = req.body;
  if (!(await ItemRefs.links()).realName(req.body.name)) return res.status(400).json({ error: "Name required" });   // THREAD-2
  const name = String(req.body.name).replace(/\s+/g, " ").trim();
  // FIX-1 D — DONOR IS SET BY GIVING, on this door too. Checked BEFORE any
  // write, so a refused change leaves the whole record untouched.
  if (req.body.personTypes !== undefined) {
    const refused = await donorRemovalProblem(req.user.orgId, req.params.id, req.body.personTypes);
    if (refused) return res.status(409).json(refused);
  }
  // PARITY-3 6a — the birthday, read once and refused before any write. Only
  // touched when the request carries it, so older callers never clear one.
  // { month, day, year? }, a typed cell ("May 22"), or null / "" to clear.
  let birthday;
  if (req.body.birthday !== undefined) {
    const B = await birthdayMod();
    const v = req.body.birthday;
    if (v === null || v === "" || (typeof v === "object" && !v.month && !v.day && !v.year)) birthday = null;
    else if (typeof v === "object") {
      const year = v.year === "" || v.year == null ? null : Number(v.year);
      if (!B.validBirthday(Number(v.month), Number(v.day), year))
        return res.status(400).json({ error: "A birthday needs a real month and day. The year is optional." });
      birthday = { month: Number(v.month), day: Number(v.day), year };
    } else {
      birthday = B.parseBirthday(v);
      if (!birthday) return res.status(400).json({ error: "A birthday needs a real month and day, like May 22. The year is optional." });
    }
  }

  // FIX-33: the client never sees an internal flag (donorTags.js), so the
  // list it sends back is kept with the row's own flags, never erasing them.
  const [tagRow] = await query("SELECT tags FROM donors WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  const keptTags = DTAGS.keepInternal(tagRow ? tagRow.tags : "[]", tags || []);
  // ADDRESS-1: the street and the apartment line, saved from the Edit form.
  // Only touched when the request carries them, so an older caller never
  // clears a street the import wrote. A change to the mailing address is kept
  // in donor_address_history, as PATCH /donors/:id/contact keeps its own.
  const ADDR = ["address", "address2", "city", "state", "zip"];
  const street = {};
  for (const f of ["address", "address2"]) if (req.body[f] !== undefined) street[f] = req.body[f] == null ? "" : String(req.body[f]).trim().slice(0, 200);
  const [was] = await query(`SELECT ${ADDR.join(", ")} FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL`, [req.params.id, req.user.orgId]);
  const affected = await run(
    `UPDATE donors SET name=?,email=?,phone=?,status=?,stage=?,tags=?,notes=?,city=?,state=?,zip=?,employer=?,updated_at=NOW()
     WHERE id=? AND org_id=?`,
    [name, email || "", phone || "", status, stage || "cultivate", JSON.stringify(keptTags), notes || "",
     city || null, state || null, zip || null, employer || null,
     req.params.id, req.user.orgId]
  );
  if (!affected.changes) return res.status(404).json({ error: "Donor not found" });
  if (Object.keys(street).length) {
    // REDTEAM-2: each column one of the two street lines (sql.id throws on anything else), each value bound.
    await run(sql`UPDATE donors SET ${sql.join(Object.keys(street).map(k => sql`${sql.id(k, ["address", "address2"])} = ${street[k] || null}`))} WHERE id=${req.params.id} AND org_id=${req.user.orgId}`);
  }
  if (was) {
    const now = { ...was, city: city || null, state: state || null, zip: zip || null, ...Object.fromEntries(Object.entries(street).map(([k, v]) => [k, v || null])) };
    if (ADDR.some(k => String(was[k] || "") !== String(now[k] || ""))) {
      await run(`INSERT INTO donor_address_history (id, org_id, donor_id, source, before, after, created_by, created_by_name) VALUES (?,?,?,?,?::jsonb,?::jsonb,?,?)`,
        [newId("dah"), req.user.orgId, req.params.id, "edit", JSON.stringify(was), JSON.stringify(now), actor(req).id, actor(req).name]);
    }
  }
  if (birthday !== undefined) {
    await run(`UPDATE donors SET birth_month=?, birth_day=?, birth_year=? WHERE id=? AND org_id=?`,
      [birthday ? birthday.month : null, birthday ? birthday.day : null, birthday ? birthday.year : null,
       req.params.id, req.user.orgId]);
    // FLOWS-1 item 8: their open birthday tasks move to the new day
    await require("./birthdayTasks").followBirthday({ query, run }, req.user.orgId, req.params.id, birthday, orgToday(await orgTz(req.user.orgId)));
  }

  // BUILD-94 Part 2 — the person's type(s). Only touched when the request
  // carries the field, so every existing caller leaves it alone; a caller that
  // does send it cannot clear it to nothing (normalizeTypes floors at
  // ["other"]) and cannot invent a fifth type.
  if (req.body.personTypes !== undefined) {
    const [wasRow] = await query(`SELECT person_types FROM donors WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
    const next = PT.normalizeTypes(req.body.personTypes);
    await run(`UPDATE donors SET person_types = ?::jsonb WHERE id=? AND org_id=?`,
      [JSON.stringify(next), req.params.id, req.user.orgId]);
    // BUILD-94 Part 3 — ADDED AS VOLUNTEER is a trigger, and it fires on the
    // transition, never on a save that leaves them a volunteer they already
    // were. (Enrollment is idempotent anyway, but firing on every save would
    // put a wrong line in the log.)
    if (!PT.hasType(wasRow || {}, "volunteer") && next.includes("volunteer")) {
      enrollInSequences(req.user.orgId, req.params.id, "added_volunteer", {}, actor(req))
        .catch(e => console.error("[seq] volunteer trigger:", e.message));
    }
  }

  // BUILD-58 Part 2 — the deceased / do-not-contact flags (only touched when
  // the request carries them, so older callers never clobber a stored flag).
  if (req.body.deceased !== undefined || req.body.doNotContact !== undefined) {
    await run(
      `UPDATE donors SET deceased = COALESCE(?, deceased), do_not_contact = COALESCE(?, do_not_contact) WHERE id=? AND org_id=?`,
      [req.body.deceased === undefined ? null : !!req.body.deceased,
       req.body.doNotContact === undefined ? null : !!req.body.doNotContact,
       req.params.id, req.user.orgId]
    );
  }

  // BUILD-84 P0-4 — an address change is the only other thing that makes a
  // donor need geocoding. Marked here, looked up on the tick, never on read.
  try { await markDonorsForGeocoding(req.user.orgId, { donorIds: [req.params.id] }); }
  catch (e) { console.error("[geocode] mark after donor edit failed:", e.message); }

  const rows = await query("SELECT * FROM donors WHERE id = ?", [req.params.id]);
  const d = rows[0];
  d.tags = DTAGS.visibleTags(d.tags);
  d.matching_gift = lookupMatchingGift(d.employer);
  const warning = await require("../dataHealth/integrity").emailWarning(query, req.user.orgId, d.email, d.id);   // INTEGRITY-1
  res.json(warning ? { ...d, warning } : d);
}));

// Managed-stage changes are a Team (major-gifts) capability — the pipeline is
// purely Team (BUILD-19; donor-profile Core/Team split FIX). Core sees stage
// read-only; changing it (single or bulk) requires the Team plan. This
// reverses the earlier "per-donor stage dropdown is Core-fine" note.
app.patch("/donors/:id/stage", requireAuth, requireCrm, checkWriteAccess, wrap(async (req, res) => {
  const { stage, prevStage } = req.body;
  const valid = ["prospect","qualify","cultivate","solicit","steward","lapsed"];
  if (!valid.includes(stage)) return res.status(400).json({ error: "Invalid stage" });

  const donorRow = await query("SELECT stage FROM donors WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!donorRow.length) return res.status(404).json({ error: "Donor not found" });
  const oldStage = prevStage || donorRow[0].stage;

  const affected = await run(
    `UPDATE donors SET stage=?,updated_at=NOW() WHERE id=? AND org_id=?`,
    [stage, req.params.id, req.user.orgId]
  );
  if (!affected.changes) return res.status(404).json({ error: "Donor not found" });

  // Log stage change
  try {
    const userRow = await query("SELECT name FROM users WHERE id=?", [req.user.userId]);
    const userName = userRow[0]?.name || "";
    await run(
      "INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name) VALUES (?,?,?,?,?,?,?,?)",
      [newId("int"), req.user.orgId, req.params.id, "stage_change",
       `Stage moved from ${oldStage || "Not set"} → ${stage}`,
       orgToday(await orgTz(req.user.orgId)), req.user.userId, userName]   // ORG_TZ_SEAM_OK FIX-14 Part 1 — was the UTC day
    );
  } catch(e) { console.error("Stage change log:", e.message); }

  calcWealthScore(req.params.id, req.user.orgId).catch(e => console.error("score recalc:", e.message));
  res.json({ success: true, stage });
}));

app.delete("/donors/:id", requireAuth, requireAdmin, wrap(async (req, res) => {
  const [plan] = await livePlansFor(req.user.orgId, [req.params.id]);
  if (plan) {
    req.audit && req.audit.skip && req.audit.skip("a refused delete changes nothing");
    return res.status(409).json({ error: "active_plan", sentence: livePlanSentence(plan), planId: plan.id, canArchive: true });
  }
  // FIX-22: a donor delete is soft (deleted_at). INTEGRITY-2: through the one
  // door out (personTrash.trashPeople), so their household and relationship
  // links go with them and come back with Restore.
  const [t] = await require("../../personTrash").trashPeople(req.user.orgId, [req.params.id], actor(req), { why: { kind: "delete" } });
  if (!t) return res.status(404).json({ error: "Donor not found" });
  const undoId = t.undoId;
  res.json({ success: true, deleted: 1, undoId, undoSeconds: UNDO_SECONDS });
}));

app.patch("/donors/:id/assign", requireAuth, requireAdmin, requireCrm, checkWriteAccess, wrap(async (req, res) => {
  const { assignedTo } = req.body;
  // Assignment IS pipeline membership (BUILD-30): assigning an officer puts the
  // donor in that officer's portfolio AND on their board immediately; unassigning
  // (assignedTo null) removes them from the board and back to the Directory only.
  //
  // BUILD-99 (major gifts) Part 2 — THREE THINGS THIS ROUTE WAS NOT DOING, and
  // `/donors/bulk-assign` one screen over was doing all three:
  //   · the officer id was never checked against THIS org, so a foreign user id
  //     landed on the row and that person appeared as the owner of a donor they
  //     cannot see;
  //   · the owner's NAME came off the payload, so a caller could write any name
  //     beside any id — an identity the row then asserts on every screen;
  //   · there was no actor, so "why is this person on my list" had no answer.
  // The name is now read from the users row and the actor is stamped, which is
  // the BUILD-75 rule this table was already inside.
  let officerId = null, officerName = null;
  if (assignedTo) {
    const { ok, user: u } = await OU.orgUser(req.user.orgId, assignedTo);
    if (!ok) return OU.refuse(res, "assignedTo");
    officerId = u.id; officerName = u.name;
  }
  // THE NAME ON THE STAMP IS A NAME, NOT A LOGIN. `actor(req).name` is the
  // caller's EMAIL — right for an audit column, wrong the moment a screen reads
  // it back as "assigned by …". This is the third appearance of that class
  // (BUILD-98 Part 2 caught it on "who thanked them"), so the id stays the
  // actor's and the name is read off the users row.
  const byName = (await query("SELECT name FROM users WHERE id=? AND org_id=?", [req.user.userId, req.user.orgId]))[0]?.name
    || actor(req).name;
  // SENDS-1 (W-1107-Donors-32X): the profile PATCHed here and then POSTed its own
  // "Reassigned" interaction, two records for one change. The ONE line is written
  // here, under the person's lock, only when the owner really changed, so every
  // screen that assigns (profile, Directory, Major gifts) writes exactly one.
  const affected = await require("../shared/personLock").withPersonLock("assign", req.user.orgId, req.params.id, async () => {
    const [prev] = await query("SELECT assigned_to, assigned_to_name FROM donors WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
    if (!prev) return { changes: 0 };
    const r = await run(
      `UPDATE donors SET assigned_to=?, assigned_to_name=?,
         assigned_by=?, assigned_by_name=?, assigned_at=CASE WHEN ?::text IS NULL THEN NULL ELSE NOW() END,
         pending_assignee_invite_id=NULL, pending_assignee_name=NULL, updated_at=NOW()
       WHERE id=? AND org_id=?`,
      [officerId, officerName, officerId ? actor(req).id : null, officerId ? byName : null,
       officerId, req.params.id, req.user.orgId]
    );
    if (r.changes && (prev.assigned_to || null) !== officerId) {
      await require("../../timelineLine").timelineLine({ orgId: req.user.orgId, donorId: req.params.id, type: "other",
        note: officerId ? `Reassigned from ${prev.assigned_to_name || "nobody"} to ${officerName}` : `Unassigned from ${prev.assigned_to_name || "nobody"}`,
        actorId: req.user.userId, actorName: byName, key: `reassign:${newId("ra")}`, metadata: { via: "assign", from: prev.assigned_to || null, to: officerId } });
    }
    return r;
  });
  if (!affected.changes) return res.status(404).json({ error: "Donor not found" });
  res.json({ success: true, assignedTo: officerId, assignedToName: officerName });
}));

// null when a personTypes change is fine, otherwise the refusal body. Only a
// change that REMOVES donor from somebody with gifts can be refused.
async function donorRemovalProblem(orgId, donorId, nextTypes) {
  const [row] = await query(
    `SELECT id, name, kind, person_types, gift_count FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL`, [donorId, orgId]);
  if (!row) return null;                        // the caller's own 404 answers it
  if (!PT.typesOf(row).includes("donor") || PT.normalizeTypes(nextTypes).includes("donor")) return null;
  const lock = await donorLock(orgId, row);
  return lock.locked ? { error: "donor_has_gifts", sentence: lock.reason, giftCount: lock.giftCount } : null;
}
}

module.exports = { routers, mount };
