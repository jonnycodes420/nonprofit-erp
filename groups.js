// groups.js · PARITY-1 Part D. A GROUP IS A LIST WITH A NAME.
//
// Two kinds, one store (the audiences table, BUILD-97):
//   dynamic  a rule: the donor list filters (GET /donors query params), AND-ed,
//            evaluated live through buildDonorFilter below. Nothing about who
//            is in it is stored, so a gift that moves somebody across a rule
//            moves them in or out of the group the moment it is recorded.
//   static   people added and removed by hand, rows in group_members.
//
// buildDonorFilter is the donor list's own filter, moved here from
// routes/crm.js so it can be called with a plain params object: the list, the
// export and every dynamic Group run the same code. A list and a group built
// on the same rule cannot disagree.
const { query, querySetwise } = require("./db");
const DS = require("./donorStatus");

let _pt = null;
async function personTypeMod() { return _pt || (_pt = await import("./shared/personType.js")); }
let _ps = null;
async function proposalShapeMod() { return _ps || (_ps = await import("./shared/proposalShape.js")); }

const PEOPLE_ROLES = ["donor", "volunteer", "staff_board"];

const DONOR_SORTS = {
  total_giving:   "total_giving DESC",
  name:           "lower(name) ASC",
  last_gift_date: "last_gift_date DESC NULLS LAST",
  created_at:     "created_at DESC",
  // ENGAGE-1 — closest first, by the stored score (donor_scores).
  engagement:     "engagement_score DESC NULLS LAST, lower(name) ASC",
  generosity:     "generosity_score DESC NULLS LAST, lower(name) ASC",
};
// ENGAGE-1 — the two scores ride along on every list row, read from the one
// stored compute, so the column and the sort are the same numbers the profile shows.
const DONOR_SCORE_COLS = `,
  (SELECT s.engagement FROM donor_scores s WHERE s.org_id = donors.org_id AND s.donor_id = donors.id) AS engagement_score,
  (SELECT s.generosity FROM donor_scores s WHERE s.org_id = donors.org_id AND s.donor_id = donors.id) AS generosity_score,
  (SELECT s.band FROM donor_scores s WHERE s.org_id = donors.org_id AND s.donor_id = donors.id) AS engagement_band`;

// FIX-22 · `opts.roomRanks` is [[donorId, rank], ...] from prospect.roomToGive,
// handed in by a route that has already checked the major gifts permission.
// It never comes from the query string: the order would show the word.
async function buildDonorFilter(orgId, q = {}, opts = {}) {
  const PT = await personTypeMod();
  const where = ["org_id = ?", "deleted_at IS NULL"];
  const params = [orgId];
  const today = await DS.todayFor(orgId);
  const cl = DS.closenessSql(today);
  const { search, stage, status, assignedTo, designation, household, role } = q;
  // FIX-1 D — DONORS SHOWS DONORS. The Directory asks for role=donor; search
  // and every older caller leave it off and still see everyone. An unknown
  // role is refused (400 at the route) rather than quietly ignored, because an
  // ignored filter is a list that says "donors" and holds everybody.
  if (role !== undefined && role !== "") {
    if (!PEOPLE_ROLES.includes(String(role))) return { badRole: true };
    where.push(PT.typeSql(String(role)));
  }
  if (search && String(search).trim()) {
    const s = "%" + String(search).trim().toLowerCase() + "%";
    where.push("(lower(name) LIKE ? OR lower(email) LIKE ?)");
    params.push(s, s);
  }
  if (stage)      { where.push("stage = ?");       params.push(String(stage)); }
  if (status)     { where.push("status = ?");      params.push(String(status)); }
  if (assignedTo) { where.push("assigned_to = ?"); params.push(String(assignedTo)); }
  // Designation filter (BUILD-14) — planned-giving / estate segments are
  // first-class and filterable everywhere the donor list is. EXISTS keeps it
  // a single query; donors.id is safe (both callers use unaliased FROM donors).
  if (designation) {
    where.push("EXISTS (SELECT 1 FROM donor_designations dd WHERE dd.donor_id = donors.id AND dd.kind = ?)");
    params.push(String(designation));
  }
  // Household filter: `household=<id>` scopes to one household's members;
  // `household=any` / `household=none` filter by membership presence.
  if (household === "none")      { where.push("household_id IS NULL"); }
  else if (household === "any")  { where.push("household_id IS NOT NULL"); }
  else if (household)            { where.push("household_id = ?"); params.push(String(household)); }
  const statusTags = [q.level, q.lifecycle, q.retained === "1" ? "retained" : null].filter(Boolean).map(String);
  if (statusTags.length) {
    const cuts = await DS.cutsFor(orgId);
    for (const t of statusTags) {
      const c = DS.tagCondition(t, orgId, today, cuts);
      if (!c) return { badStatus: true };
      where.push(c.sql); params.push(...c.args);
    }
  }
  if (q.closeness) {
    const c = DS.closenessCondition(String(q.closeness), today);
    if (!c) return { badStatus: true };
    where.push(c.sql); params.push(...c.args);
  }
  if (q.given === "never") where.push("NOT EXISTS (SELECT 1 FROM gifts gv WHERE gv.org_id = donors.org_id AND gv.donor_id = donors.id AND gv.amount > 0)");
  else if (q.given === "ever") where.push("EXISTS (SELECT 1 FROM gifts gv WHERE gv.org_id = donors.org_id AND gv.donor_id = donors.id AND gv.amount > 0)");
  // ── PARITY-3 Part 3 · THE VOLUNTEER FILTERS ──────────────────────────────
  // The Volunteers screen's filters are rules here, so the screen, its export
  // and a Group saved from it are the same rows. Each is an EXISTS or a sum
  // over the volunteer tables, org-scoped, and refused (badStatus) when its
  // value is not one Steward understands, never quietly ignored.
  const D = /^\d{4}-\d{2}-\d{2}$/;
  const dateOr = (v, dflt) => (v && D.test(String(v)) ? String(v) : dflt);
  if (q.volunteer === "1") {
    where.push(`(EXISTS (SELECT 1 FROM volunteer_shifts vx WHERE vx.org_id = donors.org_id AND vx.person_id = donors.id)
             OR EXISTS (SELECT 1 FROM volunteer_applications ax WHERE ax.org_id = donors.org_id AND ax.person_id = donors.id AND ax.status = 'approved'))`);
  }
  if (q.volActive === "1") {
    // ACTIVE: a logged hour in the last twelve months, or a place on a shift
    // still to come. The Volunteers screen's first count is this rule.
    const yearAgo = new Date(Date.UTC(+today.slice(0, 4) - 1, +today.slice(5, 7) - 1, +today.slice(8, 10))).toISOString().slice(0, 10);
    where.push(`(EXISTS (SELECT 1 FROM volunteer_shifts vx WHERE vx.org_id = donors.org_id AND vx.person_id = donors.id AND vx.date > ?)
             OR EXISTS (SELECT 1 FROM volunteer_signups sx JOIN volunteer_slots lx ON lx.id = sx.slot_id AND lx.cancelled_at IS NULL
                         WHERE sx.org_id = donors.org_id AND sx.person_id = donors.id AND sx.status = 'confirmed' AND lx.date >= ?))`);
    params.push(yearAgo, today);
  }
  if (q.volOpp) {
    where.push(`(EXISTS (SELECT 1 FROM volunteer_shifts vx WHERE vx.org_id = donors.org_id AND vx.person_id = donors.id AND vx.opportunity_id = ?)
             OR EXISTS (SELECT 1 FROM volunteer_signups sx JOIN volunteer_slots lx ON lx.id = sx.slot_id
                         WHERE sx.org_id = donors.org_id AND sx.person_id = donors.id AND lx.opportunity_id = ? AND sx.status <> 'cancelled'))`);
    params.push(String(q.volOpp), String(q.volOpp));
  }
  if (q.volShiftFrom || q.volShiftTo) {
    where.push(`EXISTS (SELECT 1 FROM volunteer_signups sx JOIN volunteer_slots lx ON lx.id = sx.slot_id AND lx.cancelled_at IS NULL
                         WHERE sx.org_id = donors.org_id AND sx.person_id = donors.id AND sx.status IN ('confirmed','completed')
                           AND lx.date >= ? AND lx.date <= ?)`);
    params.push(dateOr(q.volShiftFrom, "1900-01-01"), dateOr(q.volShiftTo, "2999-12-31"));
  }
  if (q.volHoursMin !== undefined || q.volHoursMax !== undefined) {
    const sum = `(SELECT COALESCE(SUM(vx.hours), 0) FROM volunteer_shifts vx WHERE vx.org_id = donors.org_id AND vx.person_id = donors.id
                   AND vx.date >= ? AND vx.date <= ?)`;
    const range = [dateOr(q.volHoursFrom, "1900-01-01"), dateOr(q.volHoursTo, "2999-12-31")];
    if (q.volHoursMin !== undefined) { const n = Number(q.volHoursMin); if (!Number.isFinite(n)) return { badStatus: true }; where.push(`${sum} >= ?`); params.push(...range, n); }
    if (q.volHoursMax !== undefined) { const n = Number(q.volHoursMax); if (!Number.isFinite(n)) return { badStatus: true }; where.push(`${sum} < ?`); params.push(...range, n); }
  }
  if (q.gaveFrom || q.gaveTo) {
    where.push("EXISTS (SELECT 1 FROM gifts gv WHERE gv.org_id = donors.org_id AND gv.donor_id = donors.id AND gv.amount > 0 AND LEFT(gv.date,10) >= ? AND LEFT(gv.date,10) <= ?)");
    params.push(dateOr(q.gaveFrom, "1900-01-01"), dateOr(q.gaveTo, "2999-12-31"));
  }
  // PARITY-4 Part 3 · SHOW ME. Five rules so a plain question ("donors who
  // gave last year but not this year", "monthly donors in Lexington",
  // "everyone who gave over $1,000 to the gala") is a list here and not a
  // guess: the Donors list, its export, a Group and Show me all run them.
  if (q.notGaveFrom || q.notGaveTo) {
    where.push("NOT EXISTS (SELECT 1 FROM gifts gn WHERE gn.org_id = donors.org_id AND gn.donor_id = donors.id AND gn.amount > 0 AND LEFT(gn.date,10) >= ? AND LEFT(gn.date,10) <= ?)");
    params.push(dateOr(q.notGaveFrom, "1900-01-01"), dateOr(q.notGaveTo, "2999-12-31"));
  }
  if (q.notDeceased === "1") where.push("deceased IS NOT TRUE");
  if (q.monthly === "1") {
    // A monthly recurring gift that is still running (the same live states
    // the journey suggestion reads as "they give every month").
    where.push(`EXISTS (SELECT 1 FROM recurring_subscriptions rx WHERE rx.org_id = donors.org_id AND rx.donor_id = donors.id
                         AND rx.interval = 'month' AND rx.status IN ('active','past_due','recovering','recovered'))`);
  }
  if (q.city) { where.push("lower(trim(COALESCE(city,''))) = lower(trim(?))"); params.push(String(q.city)); }
  if (q.gaveEvent) {
    where.push("EXISTS (SELECT 1 FROM gifts ge WHERE ge.org_id = donors.org_id AND ge.donor_id = donors.id AND ge.amount > 0 AND ge.event_id = ?)");
    params.push(String(q.gaveEvent));
  }
  if (q.gaveOver !== undefined) {
    // More than this many dollars in all, counting only the gifts the other
    // giving rules point at: to the event named, inside the dates named.
    const n = Number(q.gaveOver);
    if (!Number.isFinite(n) || n < 0) return { badStatus: true };
    const scope = [], sargs = [];
    if (q.gaveEvent) { scope.push("go.event_id = ?"); sargs.push(String(q.gaveEvent)); }
    if (q.gaveFrom || q.gaveTo) { scope.push("LEFT(go.date,10) >= ? AND LEFT(go.date,10) <= ?"); sargs.push(dateOr(q.gaveFrom, "1900-01-01"), dateOr(q.gaveTo, "2999-12-31")); }
    where.push(`(SELECT COALESCE(SUM(go.amount), 0) FROM gifts go WHERE go.org_id = donors.org_id AND go.donor_id = donors.id AND go.amount > 0${scope.length ? " AND " + scope.join(" AND ") : ""}) > ?`);
    params.push(...sargs, n);
  }
  if (q.volQual) {
    // A skill, certification or tag by name; or a background check or waiver
    // that is CURRENT (signed, and not past its expiry) on the org's today.
    const v = String(q.volQual);
    if (v === "background_check" || v === "waiver") {
      where.push(`EXISTS (SELECT 1 FROM volunteer_credentials cx WHERE cx.org_id = donors.org_id AND cx.person_id = donors.id
                           AND cx.kind = ? AND cx.superseded_at IS NULL AND (cx.expires_on IS NULL OR cx.expires_on >= ?))`);
      params.push(v, today);
    } else {
      where.push(`EXISTS (SELECT 1 FROM volunteer_qualifications qx WHERE qx.org_id = donors.org_id AND qx.person_id = donors.id AND lower(qx.name) = lower(?))`);
      params.push(v);
    }
  }
  if (q.volAnswer) {
    // "questionId=answer" against their most recent application.
    const m = /^([A-Za-z0-9_]{1,24})=(.{1,200})$/.exec(String(q.volAnswer));
    if (!m) return { badStatus: true };
    where.push(`EXISTS (SELECT 1 FROM volunteer_applications ax, jsonb_array_elements(ax.answers) el
                         WHERE ax.org_id = donors.org_id AND ax.person_id = donors.id
                           AND el->>'questionId' = ? AND lower(el->>'answerText') = lower(?))`);
    params.push(m[1], m[2]);
  }
  if (q.volAvail) {
    where.push(`EXISTS (SELECT 1 FROM volunteer_applications ax WHERE ax.org_id = donors.org_id AND ax.person_id = donors.id AND ax.availability ? ?)`);
    params.push(String(q.volAvail));
  }
  // ── FIX-27 Part 2 · A CAMPAIGN AND AN ASK ────────────────────────────────
  // "Gave to the spring appeal" and "no ask this year" are rules here, so the
  // Donors list, its export, a Group, Show me and the Agent's find_people are
  // the same rows. A gift counts toward a campaign the way the campaign's own
  // raised figure counts it (figureSources goal-raised): attributed by id, or
  // by the campaign's name on an imported gift. The year, when named, is the
  // gift's calendar year.
  const YR = /^\d{4}$/;
  const campaignGift = (alias, yearKey) => {
    const y = q[yearKey];
    return `EXISTS (SELECT 1 FROM gifts ${alias} JOIN campaigns c${alias} ON c${alias}.org_id = ${alias}.org_id AND c${alias}.id = ?
                     WHERE ${alias}.org_id = donors.org_id AND ${alias}.donor_id = donors.id AND ${alias}.amount > 0
                       AND (${alias}.campaign_id = c${alias}.id OR ${alias}.campaign = c${alias}.name)${y ? ` AND LEFT(${alias}.date,4) = ?` : ""})`;
  };
  for (const [key, yearKey, neg] of [["gaveCampaign", "gaveCampaignYear", false], ["notGaveCampaign", "notGaveCampaignYear", true]]) {
    if (q[yearKey] !== undefined && q[yearKey] !== "" && !YR.test(String(q[yearKey]))) return { badStatus: true };
    if (!q[key]) { if (q[yearKey]) return { badStatus: true }; continue; }
    where.push((neg ? "NOT " : "") + campaignGift(neg ? "gnc" : "gc", yearKey));
    params.push(String(q[key]));
    if (q[yearKey]) params.push(String(q[yearKey]));
  }
  if (q.noAsk === "1") {
    // NO ASK THIS YEAR: no proposal still open, and nothing asked of them in
    // the last twelve months (an ask logged on the timeline, or a proposal
    // made, whatever became of it).
    const PS = await proposalShapeMod();
    const yearAgo = new Date(Date.UTC(+today.slice(0, 4) - 1, +today.slice(5, 7) - 1, +today.slice(8, 10))).toISOString().slice(0, 10);
    where.push(`NOT EXISTS (SELECT 1 FROM opportunities ox WHERE ox.org_id = donors.org_id AND ox.donor_id = donors.id
                              AND (ox.proposal_stage = ANY(?::text[]) OR LEFT(ox.created_at::text,10) > ?))
            AND NOT EXISTS (SELECT 1 FROM interactions ix WHERE ix.org_id = donors.org_id AND ix.donor_id = donors.id
                              AND ix.type = 'ask' AND LEFT(ix.date,10) > ?)`);
    params.push(PS.OPEN_STAGE_KEYS, yearAgo, yearAgo);
  }
  // ", id" tiebreak keeps page boundaries stable when many donors share a value
  let orderBy = (DONOR_SORTS[q.sort] || DONOR_SORTS.total_giving) + ", id";
  // The closeness word rides on every row as a column (selectCols), its
  // arguments ahead of the WHERE's.
  let selectCols = `${DONOR_SCORE_COLS}, ${cl.sql} AS closeness`;
  const selectArgs = [...cl.args];
  // FIX-22 · Room to give, sorted on the server across the whole list: the
  // word is decided once (shared/roomToGive.js, via prospect.roomToGive), and
  // its rank rides along as a column joined from two arrays, so the page is
  // still one statement and page two continues page one. Strong, then Some,
  // then Not yet known (anyone not in the arrays), then total given.
  if (q.sort === "room_to_give" && Array.isArray(opts.roomRanks)) {
    selectCols += `, COALESCE((SELECT rr.rank FROM unnest(?::text[], ?::int[]) AS rr(id, rank) WHERE rr.id = donors.id), 0) AS room_rank`;
    selectArgs.push(opts.roomRanks.map(r => r[0]), opts.roomRanks.map(r => r[1]));
    orderBy = "room_rank DESC, total_giving DESC, id";
  }
  return { whereSql: where.join(" AND "), params, orderBy, selectCols, selectArgs };
}

// ── THE RULE ───────────────────────────────────────────────────────────────
// The keys a dynamic group's rule may hold: exactly the list's own filters.
const RULE_KEYS = ["role", "stage", "status", "assignedTo", "designation", "household", "search",
  "level", "lifecycle", "retained", "closeness", "given",
  // PARITY-3 — the Volunteers screen's filters.
  "volunteer", "volActive", "volOpp", "volShiftFrom", "volShiftTo", "volHoursMin", "volHoursMax", "volHoursFrom", "volHoursTo",
  "gaveFrom", "gaveTo", "volQual", "volAnswer", "volAvail",
  // PARITY-4: Show me.
  "notGaveFrom", "notGaveTo", "notDeceased", "monthly", "city", "gaveEvent", "gaveOver",
  // FIX-27: a campaign (and the year of the gift), and no ask this year.
  "gaveCampaign", "gaveCampaignYear", "notGaveCampaign", "notGaveCampaignYear", "noAsk"];
const KINDS = ["static", "dynamic"];
const ROLE_WORDS = { donor: "donors", volunteer: "volunteers", staff_board: "staff and board" };

// Keep what is recognised and refuse what is wrong; never guess. A rule that
// names a filter nobody understands must not quietly widen the group.
function normalizeRules(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const rules = {}, errors = [];
  for (const k of RULE_KEYS) {
    const v = src[k];
    if (v === undefined || v === null || v === "" || v === false) continue;
    rules[k] = String(v).trim().slice(0, 120);
  }
  if (rules.role && !PEOPLE_ROLES.includes(rules.role)) errors.push("A role is Donor, Volunteer, or Staff and board.");
  if (rules.level && !DS.LEVELS[rules.level]) errors.push("A giving level is General, Mid or Major.");
  if (rules.lifecycle && !DS.LIFECYCLES[rules.lifecycle]) errors.push("A lifecycle is New, Current, Recaptured or Lapsed.");
  if (rules.closeness && !DS.CLOSENESS[rules.closeness]) errors.push("Closeness is Close, Warm, Cooling or New.");
  if (rules.retained !== undefined) {
    if (rules.retained === "true") rules.retained = "1";
    if (rules.retained !== "1") delete rules.retained;
  }
  if (rules.given && !["never", "ever"].includes(rules.given)) errors.push("Given is never or ever.");
  // PARITY-3 — the volunteer rules, checked the same way: wrong is refused.
  if (rules.volActive !== undefined && rules.volActive !== "1") delete rules.volActive;
  if (rules.volunteer !== undefined) { if (rules.volunteer === "true") rules.volunteer = "1"; if (rules.volunteer !== "1") delete rules.volunteer; }
  for (const k of ["notDeceased", "monthly", "noAsk"]) {
    if (rules[k] === undefined) continue;
    if (rules[k] === "true") rules[k] = "1";
    if (rules[k] !== "1") delete rules[k];
  }
  if (rules.gaveOver !== undefined && !(Number(rules.gaveOver) >= 0)) errors.push("An amount is a number of dollars, 0 or more.");
  for (const k of ["volShiftFrom", "volShiftTo", "volHoursFrom", "volHoursTo", "gaveFrom", "gaveTo", "notGaveFrom", "notGaveTo"])
    if (rules[k] && !/^\d{4}-\d{2}-\d{2}$/.test(rules[k])) errors.push("A date is written 2026-01-31.");
  for (const k of ["volHoursMin", "volHoursMax"])
    if (rules[k] !== undefined && !(Number(rules[k]) >= 0)) errors.push("Hours is a number, 0 or more.");
  if (rules.volAnswer && !/^[A-Za-z0-9_]{1,24}=.+$/.test(rules.volAnswer)) errors.push("An answer filter names a question and an answer.");
  for (const [k, y] of [["gaveCampaign", "gaveCampaignYear"], ["notGaveCampaign", "notGaveCampaignYear"]]) {
    if (rules[y] && !/^\d{4}$/.test(rules[y])) errors.push("A year is written 2026.");
    if (rules[y] && !rules[k]) errors.push("A year goes with a campaign.");
  }
  if (!Object.keys(rules).length) errors.push("A group by rule needs at least one rule, or it is everybody.");
  return { ok: errors.length === 0, rules, errors };
}

// The rule in words, for the group's page and the pickers.
function rulesSentence(rules = {}) {
  const parts = [];
  if (rules.role) parts.push(ROLE_WORDS[rules.role] || rules.role);
  if (rules.level) parts.push(`at giving level ${DS.tagLabel(rules.level)}`);
  if (rules.lifecycle) parts.push(`tagged ${DS.tagLabel(rules.lifecycle)}`);
  if (rules.retained) parts.push("tagged Retained");
  if (rules.closeness) parts.push(`whose closeness is ${DS.CLOSENESS[rules.closeness] ? DS.CLOSENESS[rules.closeness].label : rules.closeness}`);
  if (rules.given === "never") parts.push("who have never given");
  if (rules.given === "ever") parts.push("who have given");
  if (rules.stage) parts.push(`in stage ${rules.stage}`);
  if (rules.status) parts.push(`with status ${rules.status}`);
  if (rules.designation) parts.push(`with a ${rules.designation} designation`);
  if (rules.assignedTo) parts.push("assigned to one person");
  if (rules.household) parts.push(rules.household === "none" ? "not in a household" : "in a household");
  if (rules.search) parts.push(`matching "${rules.search}"`);
  if (rules.volunteer) parts.push("who have volunteered (a logged hour or an approved application)");
  if (rules.volActive) parts.push("active (an hour in the last twelve months, or a shift to come)");
  if (rules.volOpp) parts.push("on one opportunity");
  if (rules.volShiftFrom || rules.volShiftTo) parts.push(`on a shift ${rules.volShiftFrom || "any time"} to ${rules.volShiftTo || "any time"}`);
  if (rules.volHoursMin) parts.push(`with at least ${rules.volHoursMin} hours${rules.volHoursFrom || rules.volHoursTo ? ` from ${rules.volHoursFrom || "the start"} to ${rules.volHoursTo || "today"}` : ""}`);
  if (rules.volHoursMax) parts.push(`with fewer than ${rules.volHoursMax} hours${rules.volHoursFrom || rules.volHoursTo ? ` from ${rules.volHoursFrom || "the start"} to ${rules.volHoursTo || "today"}` : ""}`);
  if (rules.gaveFrom || rules.gaveTo) parts.push(`who gave ${rules.gaveFrom || "any time"} to ${rules.gaveTo || "today"}`);
  if (rules.notGaveFrom || rules.notGaveTo) parts.push(`with nothing given ${rules.notGaveFrom || "any time"} to ${rules.notGaveTo || "today"}`);
  if (rules.monthly) parts.push("giving monthly");
  if (rules.city) parts.push(`in ${rules.city}`);
  if (rules.gaveEvent) parts.push("who gave to one event");
  if (rules.gaveOver !== undefined) parts.push(`who gave more than $${Number(rules.gaveOver).toLocaleString("en-US")}`);
  if (rules.gaveCampaign) parts.push(`who gave to one campaign${rules.gaveCampaignYear ? ` in ${rules.gaveCampaignYear}` : ""}`);
  if (rules.notGaveCampaign) parts.push(`who have not given to one campaign${rules.notGaveCampaignYear ? ` in ${rules.notGaveCampaignYear}` : ""}`);
  if (rules.noAsk) parts.push("with no ask this year (no proposal open, nothing asked in twelve months)");
  if (rules.notDeceased) parts.push("not deceased");
  if (rules.volQual) parts.push(`with ${rules.volQual.replace(/_/g, " ")}`);
  if (rules.volAnswer) parts.push("who gave one answer on their application");
  if (rules.volAvail) parts.push(`free on ${rules.volAvail}`);
  return parts.length ? `Everyone on file: ${parts.join(", ")}. Worked out fresh every time it is read.` : "";
}

function parseJson(v, fallback) {
  if (v == null) return fallback;
  if (typeof v === "string") { try { return JSON.parse(v); } catch { return fallback; } }
  return v;
}
function shapeGroup(r) {
  if (!r) return null;
  const rules = r.kind === "dynamic" ? parseJson(r.rules, {}) : null;
  return {
    id: r.id, name: r.name, description: r.description || "", kind: r.kind, rules,
    sentence: r.kind === "dynamic" ? rulesSentence(rules) : "People added to this group by hand. They stay until someone takes them out.",
    createdByName: r.created_by_name || "", createdAt: r.created_at,
  };
}

// One group of this org, or null. A saved audience with no kind is not a group.
async function groupById(orgId, id) {
  const [r] = await query("SELECT * FROM audiences WHERE id=? AND org_id=? AND kind IS NOT NULL", [String(id || ""), orgId]);
  return shapeGroup(r);
}
async function listGroups(orgId) {
  const rows = await query("SELECT * FROM audiences WHERE org_id=? AND kind IS NOT NULL ORDER BY LOWER(name)", [orgId]);
  return rows.map(shapeGroup);
}

// The SQL "the ids of this group's members", for an IN (...) anywhere: the
// group page, a figure source, a campaign, a journey's audience. A rule the
// filter refuses selects nobody, never everybody.
const NOBODY = { sql: "SELECT NULL::text AS id WHERE false", args: [] };
async function memberSql(orgId, group) {
  if (!group) return NOBODY;
  if (group.kind === "static") {
    return {
      sql: `SELECT gm.donor_id AS id FROM group_members gm
              JOIN donors gd ON gd.id = gm.donor_id AND gd.org_id = gm.org_id
             WHERE gm.org_id = ? AND gm.group_id = ? AND gd.deleted_at IS NULL`,
      args: [orgId, group.id],
    };
  }
  if (group.kind !== "dynamic") return NOBODY;
  const f = await buildDonorFilter(orgId, group.rules || {});
  if (f.badRole || f.badStatus) return NOBODY;
  return { sql: `SELECT donors.id FROM donors WHERE ${f.whereSql}`, args: f.params };
}
async function memberIds(orgId, group) {
  const m = await memberSql(orgId, group);
  return (await query(m.sql, m.args)).map(r => r.id);
}
// FIX-21 · every group's member count in ONE statement: the count of the same
// memberSql rows memberIds returns, so a card's count is the group's own
// People figure. The rules are built side by side, then counted together.
async function memberCounts(orgId, groups) {
  if (!groups.length) return [];
  const ms = await Promise.all(groups.map(g => memberSql(orgId, g)));
  const cols = ms.map((m, i) => `(SELECT COUNT(*)::int FROM (${m.sql}) c${i}) AS n${i}`);
  const [row] = await querySetwise(`SELECT ${cols.join(", ")}`, ms.flatMap(m => m.args));
  return ms.map((_, i) => Number(row[`n${i}`]) || 0);
}
async function isMember(orgId, group, donorId) {
  const m = await memberSql(orgId, group);
  const rows = await query(`SELECT 1 FROM (${m.sql}) gx WHERE gx.id = ? LIMIT 1`, [...m.args, donorId]);
  return rows.length > 0;
}
// Every group this person is in right now, static and by rule.
// FIX-22 · in ONE statement, one EXISTS column per group (it was one query per
// group: on prod each costs a ~65ms round trip, so 12 groups were most of a
// second). The same memberSql rows isMember reads, so the answers agree.
async function membershipFlags(orgId, groups, donorId) {
  if (!groups.length) return [];
  const ms = await Promise.all(groups.map(g => memberSql(orgId, g)));
  const cols = ms.map((m, i) => `EXISTS (SELECT 1 FROM (${m.sql}) g${i} WHERE g${i}.id = ?) AS in${i}`);
  const [row] = await query(`SELECT ${cols.join(", ")}`, ms.flatMap(m => [...m.args, donorId]));
  return ms.map((_, i) => !!(row && row[`in${i}`]));
}
async function groupsFor(orgId, donorId, groups) {
  const all = groups || await listGroups(orgId);
  const flags = await membershipFlags(orgId, all, donorId);
  return all.filter((_, i) => flags[i]);
}

// ── "JOINS A GROUP" FOR A GROUP BY RULE ─────────────────────────────────────
// A group by rule has no add button to fire from, so joining is noticed by
// comparing today's members with the last look (group_sweep_seen). That table
// is the sweep's memory only; who is in the group is always the live rule.
// A sentinel row marks that a starting line was taken, so the first look at a
// group records who is already in it and fires on nobody.
const BASELINE = "__baseline__";
async function baselineGroup(orgId, group, today = "") {
  const ids = await memberIds(orgId, group);
  await query(`DELETE FROM group_sweep_seen WHERE org_id=? AND group_id=?`, [orgId, group.id]);
  for (const id of [BASELINE, ...ids]) {
    await query(`INSERT INTO group_sweep_seen (org_id, group_id, donor_id, seen_on) VALUES (?,?,?,?)
                 ON CONFLICT (group_id, donor_id) DO NOTHING`, [orgId, group.id, id, today || ""]);
  }
  return ids.length;
}
// The groups by rule that an armed "joins a group" journey watches.
async function watchedDynamicGroups(orgId) {
  const rows = await query(
    `SELECT DISTINCT trigger_filters->>'groupId' AS gid FROM cultivation_templates
      WHERE org_id=? AND trigger_key='joined_group' AND journey_enabled=true AND archived_at IS NULL
        AND trigger_filters->>'groupId' IS NOT NULL`, [orgId]);
  const out = [];
  for (const r of rows) {
    const g = await groupById(orgId, r.gid);
    if (g && g.kind === "dynamic") out.push(g);
  }
  return out;
}
// Look again. `donorId` narrows it to one person (the gift path, the moment a
// gift lands); without it every member is compared (the morning sweep).
// `fire(donorId, groupId)` is called once for each person who is newly in.
async function dynamicJoins(orgId, { donorId = null, today = "", fire } = {}) {
  let fired = 0;
  for (const g of await watchedDynamicGroups(orgId)) {
    const [base] = await query(`SELECT 1 FROM group_sweep_seen WHERE group_id=? AND donor_id=?`, [g.id, BASELINE]);
    if (!base) { await baselineGroup(orgId, g, today); continue; }
    const seenRows = await query(`SELECT donor_id FROM group_sweep_seen WHERE group_id=?${donorId ? " AND donor_id=?" : ""}`,
      donorId ? [g.id, donorId] : [g.id]);
    const seen = new Set(seenRows.map(r => r.donor_id));
    const now = donorId ? ((await isMember(orgId, g, donorId)) ? [donorId] : []) : await memberIds(orgId, g);
    const nowSet = new Set(now);
    for (const id of now) {
      if (seen.has(id)) continue;
      await query(`INSERT INTO group_sweep_seen (org_id, group_id, donor_id, seen_on) VALUES (?,?,?,?)
                   ON CONFLICT (group_id, donor_id) DO NOTHING`, [orgId, g.id, id, today || ""]);
      if (typeof fire === "function") { await fire(id, g.id); fired++; }
    }
    // Somebody who left is forgotten, so coming back in is a join again.
    for (const id of seen) {
      if (id !== BASELINE && !nowSet.has(id)) await query(`DELETE FROM group_sweep_seen WHERE group_id=? AND donor_id=?`, [g.id, id]);
    }
  }
  return fired;
}

module.exports = {
  baselineGroup, dynamicJoins, watchedDynamicGroups,
  DONOR_SORTS, DONOR_SCORE_COLS, PEOPLE_ROLES, RULE_KEYS, KINDS,
  buildDonorFilter, normalizeRules, rulesSentence, groupById, listGroups, memberSql, memberIds, memberCounts, isMember, groupsFor, shapeGroup,
};
