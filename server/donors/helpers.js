// server/donors/helpers.js — what more than one donors file reads.
//
// SPLIT-1: moved VERBATIM from routes/crm.js. Nothing in it changed.
//
// routes/crm.js mounts it before the route modules, and what its mount()
// returns is on ctx for every module mounted after it.
// mount() runs once at the end of boot with server.js's ctx and what the helper
// modules hand back. A relative require() or import() reads from this folder.
// Tests read it through readSource("server.js") (scripts/lib/readSource.js).
// FIX-12 Part 3: the one door to a model (asks the org's AI switch on every call).
const { anthropicFor, requireAi, transcribeAudio, AiOffError, AI_OFF_MESSAGE, recordAiFallback } = require("../../aiClient");

function mount(ctx) {
const {
  ASSET_ID_RE, GR, personPhoto, query, run, giftHooks,
} = ctx;

// ── Wealth Score ────────────────────────────────────────────────────────────
async function calcWealthScore(donorId, orgId) {
  try {
    const [donorRows, gifts, interactions] = await Promise.all([
      query("SELECT * FROM donors WHERE id = ? AND org_id = ?", [donorId, orgId]),
      query("SELECT amount FROM gifts WHERE donor_id = ? AND org_id = ? ORDER BY date DESC NULLS LAST", [donorId, orgId]),
      query("SELECT type, note FROM interactions WHERE donor_id = ? AND org_id = ? ORDER BY date DESC NULLS LAST", [donorId, orgId]),
    ]);
    if (!donorRows.length) return null;
    const d = donorRows[0];

    let score = 0;
    const total = d.total_giving || 0;

    // Lifetime giving (0–3 pts)
    if      (total >= 100000) score += 3;
    else if (total >= 50000)  score += 2.75;
    else if (total >= 25000)  score += 2.5;
    else if (total >= 10000)  score += 2;
    else if (total >= 5000)   score += 1.5;
    else if (total >= 1000)   score += 1;
    else if (total >= 500)    score += 0.5;

    // Largest single gift (0–2 pts)
    const maxGift = gifts.length ? Math.max(...gifts.map(g => g.amount)) : 0;
    if      (maxGift >= 10000) score += 2;
    else if (maxGift >= 5000)  score += 1.5;
    else if (maxGift >= 1000)  score += 1;
    else if (maxGift >= 500)   score += 0.5;
    else if (maxGift >= 100)   score += 0.25;

    // Gift frequency (0–2 pts)
    const gc = d.gift_count || 0;
    if      (gc >= 7) score += 2;
    else if (gc >= 4) score += 1.5;
    else if (gc >= 2) score += 1;
    else if (gc >= 1) score += 0.5;
    // Recency penalty
    if (d.last_gift_date) {
      const daysSince = Math.floor((Date.now() - new Date(d.last_gift_date)) / 86400000);
      if (daysSince > 730) score -= 0.5;
    }

    // Average gift size (0–1 pt)
    const avgGift = gc > 0 ? total / gc : 0;
    if      (avgGift >= 2500) score += 1;
    else if (avgGift >= 1000) score += 0.75;
    else if (avgGift >= 500)  score += 0.5;
    else if (avgGift >= 100)  score += 0.25;

    // Behavioral signals (0–2 pts)
    score += Math.min(interactions.length * 0.1, 0.8);
    const calls = interactions.filter(i => i.type === "call");
    const answered = calls.filter(i => (i.note || "").toLowerCase().includes("answered: yes"));
    if (calls.length > 0 && answered.length / calls.length > 0.5) score += 0.5;
    const eventsAttended = interactions.filter(i => i.type === "event" && (i.note || "").toLowerCase().includes("donor attended: yes"));
    score += Math.min(eventsAttended.length * 0.15, 0.3);
    const stageBonus = { steward: 0.4, major: 0.3, pledge: 0.2, cultivate: 0.1, prospect: 0, lapsed: -0.3 };
    score += stageBonus[d.stage] || 0;

    const finalScore = Math.round(Math.min(10, Math.max(1, score)));
    const capacityTier = finalScore <= 3 ? "Micro" : finalScore <= 5 ? "Small" : finalScore <= 7 ? "Mid" : finalScore <= 9 ? "Major" : "Principal";
    const dataPoints = gc + interactions.length;
    const confidence = dataPoints >= 6 ? "High" : dataPoints >= 3 ? "Medium" : "Low";

    // Claude rationale (2 sentences, non-blocking on failure)
    const avgGiftAmt = gc > 0 ? Math.round(total / gc) : 0;
    let rationale = `${d.name} scored ${finalScore}/10 based on ${gc} gift${gc !== 1 ? "s" : ""} totaling $${total.toLocaleString()} and ${interactions.length} recorded touchpoints.`;
    try {
      const client = anthropicFor(orgId);
      const msg = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 130,
        thinking: { type: "disabled" },   // FIX-28: two sentences need no thinking (the ASK-3 rule)
        messages: [{
          role: "user",
          content: `Write exactly 2 sentences: first explain why this donor scored ${finalScore}/10 (${capacityTier} tier, ${confidence} confidence) referencing their specific numbers; second, name one concrete action that would raise their score. No labels, no headers.

Data: ${d.name} | Total giving: $${total.toLocaleString()} | ${gc} gifts avg $${avgGiftAmt.toLocaleString()} | Largest gift: $${maxGift.toLocaleString()} | Last gift: ${d.last_gift_date || "none"} | Stage: ${d.stage} | Touchpoints: ${interactions.length}`,
        }],
      });
      // FIX-28: an unfinished reply is never shown; the template rationale stands.
      const text = (msg.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
      if ((!msg.stop_reason || msg.stop_reason === "end_turn") && text) rationale = text;
    } catch(e) {
      console.error("Score rationale:", e.message);
    }

    await run(
      "UPDATE donors SET wealth_score=?,capacity_tier=?,score_confidence=?,score_last_updated=NOW(),score_rationale=? WHERE id=? AND org_id=?",
      [finalScore, capacityTier, confidence, rationale, donorId, orgId]
    );
    return { wealthScore: finalScore, capacityTier, scoreConfidence: confidence, scoreRationale: rationale };
  } catch(e) {
    console.error("calcWealthScore:", e.message);
    return null;
  }
}
const UNKNOWN_ROLE = { error: "unknown_role", sentence: "A role is Donor, Volunteer, or Staff and board." };
const UNKNOWN_STATUS = { error: "unknown_status", sentence: "A tag is General, Mid, Major, New, Current, Recaptured, Lapsed or Retained, and closeness is Close, Warm, On track, Cooling or New." };
// PARITY-1 — the filters a Group rule can also use: giving level, lifecycle,
// retained, closeness, and "has never given". Each is donorStatus.js's one
// definition, so a list, a Group and a profile tag cannot disagree.
async function buildDonorListFilter(req) {
  // PARITY-1 Part D · the filter takes a plain params object now (groups.js),
  // so a dynamic Group's rule runs through exactly this code.
  // FIX-22 · the Room to give sort reads the word for the whole org (a
  // handful of set-wise queries side by side, never one per row), and only
  // for someone who may see it; anyone else gets the list's own order.
  const q = req.query || {};
  let opts = {};
  // ACCESS-2: their people only, for a portfolio user (and "" for everyone else).
  const visible = require("../auth/portfolio").visibleSql(req);
  if (q.sort === "room_to_give") {
    const PR = require("../../prospect");
    if (await PR.canSee(req.user.userId, req.user.orgId)) {
      const all = await PR.roomToGive(req.user.orgId);
      const roomRanks = [];
      for (const [id, a] of all) if (a.rank > 0) roomRanks.push([id, a.rank]);
      opts = { roomRanks };
    }
  }
  opts = { ...opts, visible };
  // THREAD-3: archived people leave the list; ?archived=1 shows only them.
  if (String(q.archived || "") === "1") return GR.buildDonorFilter(req.user.orgId, q, opts)
    .then(f => ({ ...f, whereSql: `${f.whereSql} AND archived_at IS NOT NULL` }));
  // WALKB-1: a search finds archived people too (each row says so): Home still
  // names them wherever money is counted, and every name it shows can be found.
  if (String(q.search || "").trim()) return GR.buildDonorFilter(req.user.orgId, q, opts);
  return GR.buildDonorFilter(req.user.orgId, q, { ...opts, hideArchived: true });
}

// Soft delete — same trash model as POST /donors/bulk-delete. A hard DELETE
// here threw FK violations for any donor with gifts/interactions/etc.;
// permanent deletion is POST /donors/purge-trash's job (FK-safe child order).
// THREAD-3 · A PERSON WITH A LIVE MONTHLY PLAN IS NOT DELETED.
// Deleting the record would leave a card being charged every month for
// somebody Steward no longer shows, and Steward never cancels a Stripe plan as
// a side effect of anything. So delete is refused while a plan is live, with
// the two ways out said plainly: cancel the plan first, or archive the person
// (they leave the lists and the plan keeps running).
const LIVE_PLAN_STATUSES = GR.ACTIVE_RECURRING_STATUSES.concat(["paused"]);
async function livePlansFor(orgId, ids) {
  return query(
    `SELECT rs.id, rs.donor_id, rs.amount, rs.interval, d.name FROM recurring_subscriptions rs
       JOIN donors d ON d.id = rs.donor_id AND d.org_id = rs.org_id
      WHERE rs.org_id = ? AND rs.donor_id = ANY(?::text[]) AND rs.status = ANY(?::text[])
      ORDER BY d.name, rs.id`, [orgId, ids, LIVE_PLAN_STATUSES]);
}
function livePlanSentence(p) {
  const amt = "$" + Number(p.amount || 0).toLocaleString("en-US", { minimumFractionDigits: Number(p.amount) % 1 ? 2 : 0, maximumFractionDigits: 2 });
  const per = p.interval === "year" ? "yearly" : p.interval === "week" ? "weekly" : "monthly";
  return `${p.name} has a ${amt} ${per} plan. Cancel it first, or archive them instead.`;
}
// The audit row's picture of a record: a relationship carries its first
// person as donor_id (so that person's History finds it) and a household
// carries its members' ids, so "Removed X from the household" can be said.
async function auditShape(table, row, orgId) {
  if (!row) return row;
  if (table === "donor_relationships") return { ...row, donor_id: row.donor_id_a };
  if (table === "households") {
    const m = await query("SELECT id FROM donors WHERE household_id = ? AND org_id = ? ORDER BY id", [row.id, orgId]);
    return { ...row, member_ids: m.map(d => d.id) };
  }
  return row;
}

// ── Households / soft credit (BUILD-14) ────────────────────────────────────
// A household groups 2+ constituents. HARD CREDIT NEVER MOVES: donors.
// total_giving stays each donor's own gift sum, org hard total = SUM(all
// gifts) regardless of grouping. Combined giving and soft credit are DERIVED
// (never stored counters), so they cannot double-count. See db.js migration.
function lastName(name) {
  const parts = String(name || "").trim().split(/\s+/);
  return parts.length ? parts[parts.length - 1] : "";
}


// ══ BUILD-94 Part 1 — A FACE ON EVERY PROFILE ══════════════════════════════
// The bytes ride the BUILD-51 asset seam; the URL does NOT ride the public
// /portal-assets door. See personPhoto.js for why, and for the tenant
// guarantee: the signature covers the org id ON THE STORED ROW, so a URL
// minted in org A recomputes to a different digest against org B's row.

// The URL a payload carries for one donor. Null when there is no photo —
// which is the signal the shared mark uses to draw initials instead.
function donorPhotoUrl(orgId, photoAssetId) {
  if (!photoAssetId || !ASSET_ID_RE.test(String(photoAssetId))) return null;
  return personPhoto.signPhotoUrl({ orgId, assetId: photoAssetId });
}

// ── FIX-1 D — PEOPLE, WITHOUT THE LECTURE ─────────────────────────────────
// The model does not move: one person, one record, even when they are two
// things (BUILD-94 Part 2, `donors.person_types`). These are the doors the
// screen needs now that Donors shows donors:
//
//   GET /people?role=…      the people carrying one role (the volunteer roster,
//                           the staff and board list under Settings)
//   GET /people/:id         what a person is, and whether Donor may come off
//   PUT /people/:id/roles   one chip, one write — turn a role on or off
//
// Registered AFTER /people/photos so `/people/:id` never shadows it.
//
// DONOR IS SET BY GIVING. Somebody with a gift on file is a donor because money
// of theirs is on the ledger; taking the word off would drop real gifts out of
// every total that reads donors (donorOnlySql) while the gifts stayed. So the
// removal is REFUSED here and — through donorRemovalProblem — on the older
// PUT /donors/:id personTypes path too. A guard with a side door is not a guard.

// Whether Donor may come off this person, and the sentence when it may not.
// Counted from the gifts table itself, or the rollup when an imported history
// carried a count with no rows behind it — either one is money of theirs.
async function donorLock(orgId, row) {
  const [g] = await query(`SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=? AND donor_id=?`, [orgId, row.id]);
  const n = Math.max((g && g.n) || 0, Number(row.gift_count) || 0);
  if (!n) return { locked: false, reason: null, giftCount: 0 };
  const isOrg = row.kind === "organisation" || row.kind === "organization";
  const who = isOrg ? (String(row.name || "").trim() || "This organization")
                    : (String(row.name || "").trim().split(/\s+/)[0] || "This person");
  return {
    locked: true, giftCount: n,
    reason: `${who} has ${n === 1 ? "a gift" : n + " gifts"} on file, so ${isOrg ? "it stays" : "they stay"} a donor. Donor is set by giving.`,
  };
}
giftHooks.calcWealthScore = calcWealthScore;
return { UNKNOWN_ROLE, UNKNOWN_STATUS, auditShape, buildDonorListFilter, calcWealthScore, donorLock, donorPhotoUrl, lastName, livePlanSentence, livePlansFor };
}

module.exports = { mount };
