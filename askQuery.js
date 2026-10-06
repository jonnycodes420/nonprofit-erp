// askQuery.js — ASK-4. ANY QUESTION ABOUT THE ORG'S OWN RECORDS, AS A TYPED QUERY.
//
// The catalog below is every kind of record a question may be about (people,
// gifts, conversations, events and their guests, volunteer hours, recurring
// gifts, campaigns, next steps, asks, grants, tasks, memberships) and every
// field of each that may be filtered, counted, summed or grouped. A question
// becomes a QUERY PLAN that may only name what this catalog names:
//
//   { entity, where: [{ field, op, value }], related: [{ entity, where, min, none }],
//     measure: { fn, field }, groupBy: { field, bucket }, list, sort: { by, dir }, limit }
//
// The model fills that form (AI on); Steward validates it here and compiles it
// to SQL that is READ-ONLY, ORG-SCOPED and PARAMETERISED: every table, column
// and join is written in this file, every value travels as a bound parameter,
// and the org's id is the first condition of every query and sub-query. The
// model never writes SQL and never states a number: the numbers in the answer
// are the ones this file computed, and each opens its rows through the figure
// source "query", which runs the same compiled conditions.
//
// House style for the words: no colons, no em dashes.
const { query } = require("./db");
const orgTime = require("./orgTime");

const T = { text: "text", money: "money", number: "number", date: "date", bool: "bool" };
const f = (sql, type, label, extra = {}) => ({ sql, type, label, ...extra });

// ── THE CATALOG ────────────────────────────────────────────────────────────
// from      the FROM clause; the org condition is `org` (one `?`)
// person    the column holding the person's id (null when not about a person)
// row       the expressions a figure's rows are drawn from
const ENTITIES = {
  people: {
    label: "person", plural: "people", from: "donors d", org: "d.org_id = ?", base: "d.deleted_at IS NULL",
    person: "d.id", amount: "d.total_giving",
    row: { id: "d.id", name: "d.name", date: "d.last_gift_date", amount: "d.total_giving", detail: "COALESCE(NULLIF(d.city,''),'')" },
    fields: {
      name: f("d.name", T.text, "name"), city: f("d.city", T.text, "city"), state: f("d.state", T.text, "state"),
      zip: f("d.zip", T.text, "zip code"), country: f("d.country", T.text, "country"),
      stage: f("d.stage", T.text, "stage", { values: "stage" }), owner: f("d.assigned_to_name", T.text, "owner", { values: "owner" }),
      email: f("d.email", T.text, "email address"), phone: f("d.phone", T.text, "phone"),
      tags: f("d.tags", T.text, "tags"), capacity_tier: f("d.capacity_tier", T.text, "capacity tier"),
      lifetime_giving: f("d.total_giving", T.money, "lifetime giving"), gift_count: f("d.gift_count", T.number, "number of gifts"),
      last_gift_amount: f("d.last_gift_amount", T.money, "last gift"), wealth_score: f("d.wealth_score", T.number, "wealth score"),
      first_gift_date: f("LEFT(d.first_gift_date,10)", T.date, "first gift date"), last_gift_date: f("LEFT(d.last_gift_date,10)", T.date, "last gift date"),
      added_on: f("d.created_at::date::text", T.date, "date added"),
      deceased: f("d.deceased", T.bool, "deceased"), do_not_contact: f("d.do_not_contact", T.bool, "do not contact"),
      do_not_solicit: f("d.do_not_solicit", T.bool, "do not solicit"), do_not_email: f("d.do_not_email", T.bool, "do not email"),
      do_not_mail: f("d.do_not_mail", T.bool, "do not mail"), planned_giving: f("d.planned_giving", T.bool, "planned giving"),
    },
  },
  gifts: {
    label: "gift", plural: "gifts",
    from: `gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
      LEFT JOIN campaigns c ON c.id = g.campaign_id AND c.org_id = g.org_id
      LEFT JOIN fin_funds fu ON fu.id = g.fund_id AND fu.org_id = g.org_id
      LEFT JOIN events ev ON ev.id = g.event_id AND ev.org_id = g.org_id`,
    org: "g.org_id = ?", base: "d.deleted_at IS NULL AND g.amount > 0",
    person: "g.donor_id", amount: "g.amount",
    row: { id: "g.id", name: "d.name", date: "LEFT(g.date,10)", amount: "g.amount", detail: "COALESCE(NULLIF(c.name,''), NULLIF(g.campaign,''), fu.name, '')" },
    fields: {
      amount: f("g.amount", T.money, "amount"), date: f("LEFT(g.date,10)", T.date, "date"),
      fund: f("COALESCE(fu.name,'Unrestricted')", T.text, "fund", { values: "fund" }),
      campaign: f("COALESCE(NULLIF(c.name,''), NULLIF(g.campaign,''), '')", T.text, "campaign", { values: "campaign" }),
      event: f("COALESCE(ev.name,'')", T.text, "event", { values: "event" }),
      payment_method: f("COALESCE(g.payment_method,'')", T.text, "payment method", { values: "payment_method" }),
      type: f("COALESCE(g.type,'')", T.text, "gift type", { values: "gift_type" }),
      thanked: f("COALESCE(g.acknowledgement_sent,false)", T.bool, "thanked"),
      recurring: f("(g.recurring_subscription_id IS NOT NULL)", T.bool, "part of a recurring gift"),
      tribute: f("(COALESCE(g.tribute_type,'') <> '')", T.bool, "given in tribute"),
      donor: f("d.name", T.text, "giver"), donor_city: f("d.city", T.text, "giver's city"), donor_state: f("d.state", T.text, "giver's state"),
    },
  },
  conversations: {
    label: "conversation", plural: "conversations",
    from: "interactions i JOIN donors d ON d.id = i.donor_id AND d.org_id = i.org_id",
    org: "i.org_id = ?", base: "d.deleted_at IS NULL", person: "i.donor_id", amount: null,
    row: { id: "i.id", name: "d.name", date: "LEFT(i.date,10)", amount: "NULL::numeric", detail: "i.type" },
    fields: {
      type: f("i.type", T.text, "kind", { values: "interaction_type" }), date: f("LEFT(i.date,10)", T.date, "date"),
      logged_by: f("COALESCE(i.logged_by_name,'')", T.text, "logged by", { values: "logged_by" }),
      note: f("COALESCE(i.note,'')", T.text, "note"), person: f("d.name", T.text, "person"),
    },
  },
  events: {
    label: "event", plural: "events", from: "events ev", org: "ev.org_id = ?", base: "TRUE", person: null, amount: "ev.revenue",
    row: { id: "ev.id", name: "ev.name", date: "ev.date::text", amount: "ev.revenue", detail: "COALESCE(ev.location,'')" },
    fields: {
      name: f("ev.name", T.text, "name", { values: "event" }), date: f("ev.date::text", T.date, "date"), type: f("COALESCE(ev.event_type,'')", T.text, "kind"),
      location: f("COALESCE(ev.location,'')", T.text, "location"), status: f("COALESCE(ev.status,'')", T.text, "status"),
      capacity: f("ev.capacity", T.number, "capacity"), goal: f("ev.goal_amount", T.money, "goal"),
      revenue: f("ev.revenue", T.money, "revenue on the event record"), cost: f("ev.cost", T.money, "cost"),
    },
  },
  guests: {
    label: "guest", plural: "event guests",
    from: "event_attendees a JOIN events ev ON ev.id = a.event_id AND ev.org_id = a.org_id LEFT JOIN donors d ON d.id = a.donor_id AND d.org_id = a.org_id",
    org: "a.org_id = ?", base: "(d.id IS NULL OR d.deleted_at IS NULL)", person: "a.donor_id", amount: "a.gift_amount",
    row: { id: "a.id", name: "COALESCE(d.name, a.name)", date: "ev.date::text", amount: "a.gift_amount", detail: "ev.name" },
    fields: {
      event: f("ev.name", T.text, "event", { values: "event" }), event_date: f("ev.date::text", T.date, "event date"),
      status: f("COALESCE(a.status,'')", T.text, "status"), checked_in: f("(a.checked_in_at IS NOT NULL)", T.bool, "checked in"),
      vip: f("COALESCE(a.vip,false)", T.bool, "VIP"), gift_amount: f("a.gift_amount", T.money, "gift at the event"),
      tickets: f("a.quantity", T.number, "tickets"), name: f("COALESCE(d.name, a.name)", T.text, "guest"),
    },
  },
  volunteer_hours: {
    label: "volunteer shift", plural: "volunteer shifts",
    from: "volunteer_shifts s JOIN donors d ON d.id = s.person_id AND d.org_id = s.org_id",
    org: "s.org_id = ?", base: "d.deleted_at IS NULL", person: "s.person_id", amount: "s.hours",
    row: { id: "s.id", name: "d.name", date: "LEFT(s.date,10)", amount: "s.hours", detail: "COALESCE(s.role,'')" },
    amountKind: "count", amountWord: "hours",
    fields: {
      hours: f("s.hours", T.number, "hours"), date: f("LEFT(s.date,10)", T.date, "date"), role: f("COALESCE(s.role,'')", T.text, "role"),
      volunteer: f("d.name", T.text, "volunteer"),
    },
  },
  recurring: {
    label: "recurring gift", plural: "recurring gifts",
    from: "recurring_subscriptions r JOIN donors d ON d.id = r.donor_id AND d.org_id = r.org_id",
    org: "r.org_id = ?", base: "d.deleted_at IS NULL", person: "r.donor_id", amount: "r.amount",
    row: { id: "r.id", name: "d.name", date: "r.created_at::date::text", amount: "r.amount", detail: "r.status" },
    fields: {
      amount: f("r.amount", T.money, "amount each time"), interval: f("COALESCE(r.interval,'')", T.text, "how often", { values: "interval" }),
      status: f("COALESCE(r.status,'')", T.text, "status", { values: "recurring_status" }),
      card_failed: f("(r.first_failed_at IS NOT NULL)", T.bool, "card has failed"), started: f("r.created_at::date::text", T.date, "started"),
      canceled: f("r.canceled_at::date::text", T.date, "canceled on"), donor: f("d.name", T.text, "giver"),
    },
  },
  campaigns: {
    label: "campaign", plural: "campaigns", from: "campaigns c", org: "c.org_id = ?",
    base: "c.sent_at IS NULL AND COALESCE(c.subject,'') = ''", person: null, amount: "c.goal_amount",
    row: { id: "c.id", name: "c.name", date: "c.start_date::text", amount: "c.goal_amount", detail: "COALESCE(c.status,'')" },
    fields: {
      name: f("c.name", T.text, "name", { values: "campaign" }), type: f("COALESCE(c.type,'')", T.text, "kind"),
      status: f("COALESCE(c.status,'')", T.text, "status"), goal: f("c.goal_amount", T.money, "goal"),
      start_date: f("c.start_date::text", T.date, "start date"), end_date: f("c.end_date::text", T.date, "end date"),
    },
  },
  next_steps: {
    label: "next step", plural: "next steps",
    from: "threads t JOIN donors d ON d.id = t.donor_id AND d.org_id = t.org_id",
    org: "t.org_id = ?", base: "d.deleted_at IS NULL", person: "t.donor_id", amount: null,
    row: { id: "t.id", name: "d.name", date: "LEFT(t.due_date,10)", amount: "NULL::numeric", detail: "COALESCE(t.next_step_label,'')" },
    fields: {
      open: f("(t.closed_at IS NULL)", T.bool, "still open"), label: f("COALESCE(t.next_step_label,'')", T.text, "step"),
      type: f("COALESCE(t.next_step_type,'')", T.text, "kind"), due: f("LEFT(t.due_date,10)", T.date, "due date"),
      owner: f("COALESCE(t.owner_name,'')", T.text, "owner", { values: "owner" }), opened: f("LEFT(t.opened_on,10)", T.date, "opened on"),
      person: f("d.name", T.text, "person"),
    },
  },
  asks: {
    label: "ask", plural: "asks",
    from: "opportunities o JOIN donors d ON d.id = o.donor_id AND d.org_id = o.org_id",
    org: "o.org_id = ?", base: "d.deleted_at IS NULL", person: "o.donor_id", amount: "o.target_amount",
    row: { id: "o.id", name: "d.name", date: "o.expected_close::text", amount: "o.target_amount", detail: "COALESCE(o.name,'')" },
    fields: {
      name: f("COALESCE(o.name,'')", T.text, "ask"), amount: f("o.target_amount", T.money, "amount asked"),
      status: f("COALESCE(o.status,'')", T.text, "status", { values: "ask_status" }), stage: f("COALESCE(o.proposal_stage,'')", T.text, "stage"),
      expected_close: f("o.expected_close::text", T.date, "expected close"), officer: f("COALESCE(o.officer_name,'')", T.text, "officer"),
      gift_amount: f("o.gift_amount", T.money, "amount given"), person: f("d.name", T.text, "person"),
    },
  },
  grants: {
    label: "grant", plural: "grants", from: "grants gr", org: "gr.org_id = ?", base: "TRUE", person: null, amount: "gr.amount_awarded",
    row: { id: "gr.id", name: "gr.funder", date: "LEFT(gr.deadline,10)", amount: "COALESCE(gr.amount_awarded, gr.amount)", detail: "COALESCE(gr.status,'')" },
    fields: {
      funder: f("COALESCE(gr.funder,'')", T.text, "funder"), program: f("COALESCE(gr.program,'')", T.text, "program"),
      status: f("COALESCE(gr.status,'')", T.text, "status", { values: "grant_status" }),
      requested: f("gr.amount_requested", T.money, "amount requested"), awarded: f("gr.amount_awarded", T.money, "amount awarded"),
      received: f("gr.received", T.money, "amount received"), deadline: f("LEFT(gr.deadline,10)", T.date, "deadline"),
      report_due: f("LEFT(gr.report_due,10)", T.date, "report due"), officer: f("COALESCE(gr.officer,'')", T.text, "officer"),
    },
  },
  tasks: {
    label: "task", plural: "tasks", from: "tasks tk LEFT JOIN donors d ON d.id = tk.donor_id AND d.org_id = tk.org_id",
    org: "tk.org_id = ?", base: "tk.voided_at IS NULL", person: "tk.donor_id", amount: null,
    row: { id: "tk.id", name: "COALESCE(d.name, tk.title)", date: "LEFT(tk.due,10)", amount: "NULL::numeric", detail: "tk.title" },
    fields: {
      title: f("COALESCE(tk.title,'')", T.text, "task"), due: f("LEFT(tk.due,10)", T.date, "due date"), done: f("(tk.done = 1)", T.bool, "done"),
      priority: f("COALESCE(tk.priority,'')", T.text, "priority"), assigned_to: f("COALESCE(tk.assigned_to_name,'')", T.text, "assigned to", { values: "owner" }),
    },
  },
  memberships: {
    label: "membership", plural: "memberships",
    from: "memberships m JOIN donors d ON d.id = m.donor_id AND d.org_id = m.org_id",
    org: "m.org_id = ?", base: "d.deleted_at IS NULL", person: "m.donor_id", amount: null,
    row: { id: "m.id", name: "d.name", date: "LEFT(m.expires_on,10)", amount: "NULL::numeric", detail: "COALESCE(m.status,'')" },
    fields: {
      status: f("COALESCE(m.status,'')", T.text, "status"), joined: f("LEFT(m.joined_on,10)", T.date, "joined"),
      expires: f("LEFT(m.expires_on,10)", T.date, "expires"), member: f("d.name", T.text, "member"),
    },
  },
};
const ENTITY_KEYS = Object.keys(ENTITIES);
const PERSON_ENTITIES = ENTITY_KEYS.filter(k => k !== "people" && ENTITIES[k].person);
const OPS = {
  text: ["eq", "neq", "contains", "in", "empty", "not_empty"],
  money: ["eq", "neq", "gt", "gte", "lt", "lte", "between"],
  number: ["eq", "neq", "gt", "gte", "lt", "lte", "between"],
  date: ["eq", "gt", "gte", "lt", "lte", "between", "last_days", "empty", "not_empty"],
  bool: ["is"],
};
const FNS = ["count", "count_people", "sum", "avg", "min", "max"];
const BUCKETS = ["day", "month", "quarter", "year"];
const MAX_WHERE = 12, MAX_RELATED = 4, MAX_LIMIT = 50;

// ── VALIDATION ─────────────────────────────────────────────────────────────
// Returns { ok, plan } or { ok: false, refused } naming the part Steward
// could not read. A value is converted to its type here, never later.
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v));
function cleanValue(type, op, v) {
  if (op === "empty" || op === "not_empty") return { ok: true, value: null };
  if (type === T.bool) return typeof v === "boolean" ? { ok: true, value: v } : /^(true|false|1|0|yes|no)$/i.test(String(v)) ? { ok: true, value: /^(true|1|yes)$/i.test(String(v)) } : { ok: false };
  if (op === "between") {
    const a = Array.isArray(v) ? v : String(v || "").split(/\s*(?:,|\.\.|to|and)\s*/);
    if (a.length !== 2) return { ok: false };
    const x = cleanValue(type, "eq", a[0]), y = cleanValue(type, "eq", a[1]);
    return x.ok && y.ok ? { ok: true, value: [x.value, y.value] } : { ok: false };
  }
  if (op === "last_days") { const n = Number(v); return Number.isInteger(n) && n > 0 && n <= 36600 ? { ok: true, value: n } : { ok: false }; }
  if (op === "in") {
    const a = (Array.isArray(v) ? v : String(v || "").split(/\s*,\s*/)).map(x => String(x).trim()).filter(Boolean).slice(0, 50);
    return a.length ? { ok: true, value: a.map(x => x.slice(0, 200)) } : { ok: false };
  }
  if (type === T.money || type === T.number) { const n = Number(String(v).replace(/[$,]/g, "")); return Number.isFinite(n) ? { ok: true, value: n } : { ok: false }; }
  if (type === T.date) return isDate(v) ? { ok: true, value: String(v) } : { ok: false };
  const s = String(v == null ? "" : v).trim();
  return s ? { ok: true, value: s.slice(0, 200) } : { ok: false };
}
function cleanWhere(entityKey, list, path) {
  const E = ENTITIES[entityKey];
  const out = [];
  for (const c of (Array.isArray(list) ? list : []).slice(0, MAX_WHERE + 1)) {
    if (out.length >= MAX_WHERE) return { refused: "that many conditions at once" };
    const fd = c && E.fields[c.field];
    if (!fd) return { refused: `${String(c && c.field || "a field").slice(0, 40)} on ${E.plural}` };
    const op = String(c.op || (fd.type === T.bool ? "is" : "eq"));
    if (!OPS[fd.type].includes(op)) return { refused: `${fd.label} ${op}` };
    const v = cleanValue(fd.type, op, c.value);
    if (!v.ok) return { refused: `the ${fd.label} ${String(c.value).slice(0, 40)}` };
    out.push({ field: c.field, op, value: v.value });
  }
  return { where: out };
}
// HARDENING: the same meaning written another way is read, never refused;
// anything with no meaning here is still refused by the checks below.
const ENTITY_ALIAS = { donors: "people", donor: "people", person: "people", supporters: "people", gift: "gifts", donations: "gifts", donation: "gifts",
  interactions: "conversations", interaction: "conversations", contacts: "conversations", attendees: "guests", event_attendees: "guests", attendance: "guests",
  volunteers: "volunteer_hours", volunteer_shifts: "volunteer_hours", shifts: "volunteer_hours", subscriptions: "recurring", recurring_gifts: "recurring",
  opportunities: "asks", proposals: "asks", threads: "next_steps", steps: "next_steps", event: "events", campaign: "campaigns", grant: "grants", task: "tasks", membership: "memberships" };
const OP_ALIAS = { "=": "eq", "==": "eq", equals: "eq", is_equal: "eq", "!=": "neq", "<>": "neq", not_equals: "neq", ">": "gt", after: "gt", greater_than: "gt",
  ">=": "gte", since: "gte", on_or_after: "gte", at_least: "gte", "<": "lt", before: "lt", less_than: "lt", "<=": "lte", on_or_before: "lte", at_most: "lte",
  like: "contains", ilike: "contains", includes: "contains", has: "contains", within_last_days: "last_days", in_last_days: "last_days", last_n_days: "last_days",
  is_empty: "empty", is_null: "empty", blank: "empty", is_not_empty: "not_empty", not_null: "not_empty", exists: "not_empty", range: "between", one_of: "in" };
const FN_ALIAS = { total: "sum", average: "avg", mean: "avg", minimum: "min", maximum: "max", largest: "max", smallest: "min",
  count_distinct: "count_people", distinct_people: "count_people", people: "count_people", number: "count" };
function normalizeRaw(raw) {
  const r = { ...raw };
  const ek = String(r.entity || "").toLowerCase().trim();
  r.entity = ENTITIES[ek] ? ek : ENTITY_ALIAS[ek] || ek;
  const E = ENTITIES[r.entity];
  const fieldOf = (Ent, k) => { if (!Ent || k == null) return k; const kk = String(k).trim(); if (Ent.fields[kk]) return kk;
    const lc = kk.toLowerCase().replace(/\s+/g, "_"); return Object.keys(Ent.fields).find(x => x.toLowerCase() === lc) || kk; };
  const conds = (Ent, list) => (Array.isArray(list) ? list : list && typeof list === "object" ? [list] : []).map(c => {
    if (!c || typeof c !== "object") return c;
    const op = String(c.op || "").toLowerCase().trim();
    return { ...c, field: fieldOf(Ent, c.field), op: OPS.text.concat(OPS.date, OPS.bool, OPS.money).includes(op) ? op : OP_ALIAS[op] || op || undefined };
  });
  r.where = conds(E, r.where);
  r.related = (Array.isArray(r.related) ? r.related : []).map(x => { if (!x || typeof x !== "object") return x;
    const rk = String(x.entity || "").toLowerCase().trim(); const ent = ENTITIES[rk] ? rk : ENTITY_ALIAS[rk] || rk;
    return { ...x, entity: ent, where: conds(ENTITIES[ent], x.where) }; });
  if (r.measure && typeof r.measure === "object") { const fn = String(r.measure.fn || "count").toLowerCase(); r.measure = { fn: FNS.includes(fn) ? fn : FN_ALIAS[fn] || fn, field: fieldOf(E, r.measure.field) }; }
  else if (typeof r.measure === "string") { const fn = r.measure.toLowerCase(); r.measure = { fn: FNS.includes(fn) ? fn : FN_ALIAS[fn] || fn }; }
  if (r.groupBy && typeof r.groupBy === "string") r.groupBy = { field: r.groupBy };
  if (r.groupBy && r.groupBy.field) r.groupBy = { ...r.groupBy, field: fieldOf(E, r.groupBy.field) };
  if (r.sort && typeof r.sort === "object") {
    const by = String(r.sort.by || "value").toLowerCase();
    // Sorting changes no number, so a sort key that is not a field means "by the figure".
    const sf = fieldOf(E, r.sort.by);
    r.sort = { by: E && E.fields[sf] ? sf : "value",
      dir: String(r.sort.dir || "desc").toLowerCase().startsWith("asc") ? "asc" : "desc" };
  }
  return r;
}
function validateQuery(raw0) {
  if (!raw0 || typeof raw0 !== "object") return { ok: false, refused: "that question" };
  const raw = normalizeRaw(raw0);
  const entity = String(raw.entity || "");
  const E = ENTITIES[entity];
  if (!E) return { ok: false, refused: `${entity.slice(0, 40) || "that kind of record"}` };
  const w = cleanWhere(entity, raw.where);
  if (w.refused) return { ok: false, refused: w.refused };
  const related = [];
  for (const r of (Array.isArray(raw.related) ? raw.related : []).slice(0, MAX_RELATED + 1)) {
    if (related.length >= MAX_RELATED) return { ok: false, refused: "that many related records at once" };
    if (!E.person) return { ok: false, refused: `linking ${E.plural} to other records` };
    const rk = String(r && r.entity || "");
    if (!PERSON_ENTITIES.includes(rk) && rk !== "people") return { ok: false, refused: `${rk.slice(0, 40) || "a related record"}` };
    if (rk === entity) return { ok: false, refused: `${E.plural} within ${E.plural}` };
    const rw = cleanWhere(rk, r.where);
    if (rw.refused) return { ok: false, refused: rw.refused };
    const min = r.min == null ? 1 : Number(r.min);
    if (!Number.isInteger(min) || min < 1 || min > 100000) return { ok: false, refused: "that count" };
    let minSum = null;
    if (r.minSum != null) { minSum = Number(r.minSum); if (!Number.isFinite(minSum) || !ENTITIES[rk].amount) return { ok: false, refused: "that total" }; }
    related.push({ entity: rk, where: rw.where, min, minSum, none: !!r.none });
  }
  const m = raw.measure || {};
  const fn = String(m.fn || (raw.list ? "count" : "count"));
  if (!FNS.includes(fn)) return { ok: false, refused: `${fn.slice(0, 30)}` };
  let field = m.field ? String(m.field) : null;
  if (["sum", "avg", "min", "max"].includes(fn)) {
    if (!field) field = Object.keys(E.fields).find(k => E.fields[k].sql === E.amount) || null;
    const fd = field && E.fields[field];
    if (!fd || ![T.money, T.number].includes(fd.type)) return { ok: false, refused: `a ${fn === "sum" ? "total" : "figure"} of ${field || "that"}` };
  } else field = null;
  if (fn === "count_people" && !E.person) return { ok: false, refused: `people behind ${E.plural}` };
  let groupBy = null;
  if (raw.groupBy && raw.groupBy.field) {
    const gk = String(raw.groupBy.field);
    const gd = E.fields[gk];
    if (!gd || gd.type === T.money || gd.type === T.number) return { ok: false, refused: `breaking ${E.plural} down by ${gk.slice(0, 40)}` };
    const bucket = gd.type === T.date ? (BUCKETS.includes(raw.groupBy.bucket) ? raw.groupBy.bucket : "month") : null;
    groupBy = { field: gk, bucket };
  }
  const list = !!raw.list && !groupBy;
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number(raw.limit) || 10));
  let sort = null;
  if (raw.sort && raw.sort.by) {
    const by = String(raw.sort.by);
    if (by !== "value" && !E.fields[by]) return { ok: false, refused: `sorting by ${by.slice(0, 40)}` };
    sort = { by, dir: raw.sort.dir === "asc" ? "asc" : "desc" };
  }
  return { ok: true, plan: { entity, where: w.where, related, measure: { fn, field }, groupBy, list, sort, limit } };
}

// ── THE COMPILER ───────────────────────────────────────────────────────────
// One condition at a time; every value a bound parameter.
const likeEsc = s => String(s).replace(/[\\%_]/g, c => "\\" + c);
function condSql(fd, c, params, today) {
  const x = fd.sql;
  switch (c.op) {
    case "eq": if (fd.type === T.text) { params.push(c.value); return `lower(trim(COALESCE(${x}::text,''))) = lower(trim(?))`; }
      params.push(c.value); return `${x} = ?`;
    case "neq": if (fd.type === T.text) { params.push(c.value); return `lower(trim(COALESCE(${x}::text,''))) <> lower(trim(?))`; }
      params.push(c.value); return `${x} IS DISTINCT FROM ?`;
    case "contains": params.push(`%${likeEsc(c.value)}%`); return `COALESCE(${x}::text,'') ILIKE ?`;
    case "in": params.push(c.value.map(v => v.toLowerCase())); return `lower(trim(COALESCE(${x}::text,''))) = ANY(?::text[])`;
    case "empty": return fd.type === T.text ? `COALESCE(${x}::text,'') = ''` : `${x} IS NULL`;
    case "not_empty": return fd.type === T.text ? `COALESCE(${x}::text,'') <> ''` : `${x} IS NOT NULL`;
    case "gt": params.push(c.value); return `${x} > ?`;
    case "gte": params.push(c.value); return `${x} >= ?`;
    case "lt": params.push(c.value); return `${x} < ?`;
    case "lte": params.push(c.value); return `${x} <= ?`;
    case "between": params.push(c.value[0], c.value[1]); return `${x} BETWEEN ? AND ?`;
    case "last_days": { const d = new Date(today + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - c.value); params.push(d.toISOString().slice(0, 10)); return `${x} >= ?`; }
    case "is": return c.value ? `(${x}) IS TRUE` : `(${x}) IS NOT TRUE`;
    default: throw new Error("unknown op");
  }
}
// A related record's own tables get their own aliases ("d" becomes "d_r"),
// so its conditions can never be read against the outer query's rows.
const TABLES = "donors|gifts|campaigns|fin_funds|events|interactions|event_attendees|volunteer_shifts|recurring_subscriptions|threads|opportunities|grants|tasks|memberships";
const ALIASES = "d|g|c|fu|ev|i|a|s|r|t|o|gr|tk|m";
const reAlias = sql => String(sql).replace(new RegExp(`\\b(${TABLES}) (${ALIASES})\\b`, "g"), "$1 $2_r").replace(new RegExp(`\\b(${ALIASES})\\.`, "g"), "$1_r.");
function relatedEntity(key) {
  const R = ENTITIES[key];
  const fields = {};
  for (const [k, fd] of Object.entries(R.fields)) fields[k] = { ...fd, sql: reAlias(fd.sql) };
  return { ...R, from: reAlias(R.from), org: reAlias(R.org), base: reAlias(R.base), person: reAlias(R.person), amount: R.amount ? reAlias(R.amount) : null, fields };
}
function whereFor(entityKey, plan, orgId, today) {
  const E = ENTITIES[entityKey];
  const params = [orgId];
  const parts = [E.org, E.base];
  for (const c of plan.where) parts.push(condSql(E.fields[c.field], c, params, today));
  for (const r of plan.related || []) {
    const R = relatedEntity(r.entity);
    const rp = [orgId];
    const rparts = [R.org, R.base, `${R.person} = ${E.person}`];
    for (const c of r.where) rparts.push(condSql(R.fields[c.field], c, rp, today));
    const inner = `FROM ${R.from} WHERE ${rparts.join(" AND ")}`;
    if (r.none) { parts.push(`NOT EXISTS (SELECT 1 ${inner})`); params.push(...rp); }
    else if (r.minSum != null) { parts.push(`(SELECT COALESCE(SUM(${R.amount}),0) ${inner}) >= ?`); params.push(...rp, r.minSum); }
    else if (r.min > 1) { parts.push(`(SELECT COUNT(*) ${inner}) >= ?`); params.push(...rp, r.min); }
    else { parts.push(`EXISTS (SELECT 1 ${inner})`); params.push(...rp); }
  }
  return { sql: parts.join(" AND "), params };
}
function measureSql(E, m) {
  if (m.fn === "count") return "COUNT(*)";
  if (m.fn === "count_people") return `COUNT(DISTINCT ${E.person})`;
  const x = E.fields[m.field].sql;
  return { sum: `COALESCE(SUM(${x}),0)`, avg: `AVG(${x})`, min: `MIN(${x})`, max: `MAX(${x})` }[m.fn];
}
function groupSql(E, g) {
  const x = E.fields[g.field].sql;
  if (!g.bucket) return `COALESCE(NULLIF(${x}::text,''),'(none)')`;
  return { day: `LEFT(${x},10)`, month: `LEFT(${x},7)`, year: `LEFT(${x},4)`,
    quarter: `LEFT(${x},4) || '-Q' || ((SUBSTRING(${x},6,2)::int + 2) / 3)::text` }[g.bucket];
}

// ── RUNNING IT ─────────────────────────────────────────────────────────────
// The value, the groups (top fifty) or the list, and the people behind it.
async function runQuery(orgId, plan, today) {
  const E = ENTITIES[plan.entity];
  const w = whereFor(plan.entity, plan, orgId, today);
  const ms = measureSql(E, plan.measure);
  const [agg] = await query(`SELECT ${ms} AS v, COUNT(*)::int AS n FROM ${E.from} WHERE ${w.sql}`, w.params);
  const out = { value: agg.v == null ? null : Number(agg.v), rows: Number(agg.n) || 0 };
  if (plan.groupBy) {
    const gx = groupSql(E, plan.groupBy);
    // Dates read in calendar order unless she asked for the most or the least.
    const byKey = !!plan.groupBy.bucket && !(plan.sort && plan.sort.by === "value");
    out.groups = (await query(`SELECT ${gx} AS k, ${ms} AS v, COUNT(*)::int AS n FROM ${E.from} WHERE ${w.sql}
        GROUP BY 1 ORDER BY ${byKey ? "1" : plan.sort && plan.sort.dir === "asc" ? "2 ASC NULLS LAST, 1" : "2 DESC NULLS LAST, 1"} LIMIT ${MAX_LIMIT}`, w.params))
      .map(r => ({ key: String(r.k), value: r.v == null ? null : Number(r.v), n: Number(r.n) }));
  }
  if (plan.list || plan.measure.fn === "count_people" || ["min", "max"].includes(plan.measure.fn)) {
    out.list = await listRows(orgId, plan, today, { limit: plan.limit });
  }
  return out;
}
// The rows of a list: one per record, or one per PERSON (with their total)
// when the question counts people. Sorted by her choice, else the measured
// figure largest first, else most recent.
async function listRows(orgId, plan, today, { limit = MAX_LIMIT, groupKey = null } = {}) {
  const E = ENTITIES[plan.entity];
  const w = whereFor(plan.entity, plan, orgId, today);
  if (groupKey != null && plan.groupBy) { w.sql += ` AND ${groupSql(E, plan.groupBy)} = ?`; w.params.push(String(groupKey)); }
  const amt = plan.measure.field ? E.fields[plan.measure.field].sql : E.row.amount;
  const lim = Math.min(5000, Number(limit) || MAX_LIMIT);
  if (plan.measure.fn === "count_people" && E.person && plan.entity !== "people") {
    return query(`SELECT ${E.person} AS id, ${E.person} AS donor_id, MAX(d.name) AS name, MAX(${E.row.date}) AS date,
        COALESCE(SUM(${amt}),0) AS amount, COUNT(*)::int AS detail_n FROM ${E.from} WHERE ${w.sql}
        GROUP BY ${E.person} ORDER BY 5 DESC, 3 LIMIT ${lim}`, w.params).then(rs => rs.map(r => ({ ...r, type: "person", detail: `${r.detail_n} ${r.detail_n === 1 ? E.label : E.plural}` })));
  }
  let order;
  if (["min", "max"].includes(plan.measure.fn)) order = `${E.fields[plan.measure.field].sql} ${plan.measure.fn === "min" ? "ASC" : "DESC"} NULLS LAST`;
  else if (plan.sort && plan.sort.by !== "value") order = `${E.fields[plan.sort.by].sql} ${plan.sort.dir.toUpperCase()} NULLS LAST`;
  else if (amt && amt !== "NULL::numeric") order = `${amt} ${plan.sort && plan.sort.dir === "asc" ? "ASC" : "DESC"} NULLS LAST`;
  else order = `${E.row.date} DESC NULLS LAST`;
  const lim2 = ["min", "max"].includes(plan.measure.fn) ? 1 : lim;
  return query(`SELECT ${E.row.id} AS id, '${plan.entity}' AS type, ${E.person || "NULL"} AS donor_id, ${E.row.name} AS name,
      ${E.row.date} AS date, ${amt || "NULL::numeric"} AS amount, ${E.row.detail} AS detail
      FROM ${E.from} WHERE ${w.sql} ORDER BY ${order}, ${E.row.id} LIMIT ${lim2}`, w.params);
}

// ── THE WORDS ──────────────────────────────────────────────────────────────
const OP_WORDS = { eq: "is", neq: "is not", contains: "mentions", in: "is one of", empty: "is blank", not_empty: "is filled in",
  gt: "over", gte: "at least", lt: "under", lte: "at most", between: "between", last_days: "in the last", is: "" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const dayWords = d => (isDate(d) ? `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}, ${d.slice(0, 4)}` : String(d));
const money = n => (n == null ? "nothing" : "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 }));
function valWords(fd, c) {
  const v = c.value;
  const one = x => (fd.type === T.money ? money(x) : fd.type === T.date ? dayWords(x) : String(x));
  if (c.op === "between") return `${one(v[0])} and ${one(v[1])}`;
  if (c.op === "last_days") return `${v} days`;
  if (c.op === "in") return v.join(", ");
  if (c.op === "empty" || c.op === "not_empty") return "";
  if (fd.type === T.date && ["gt", "gte"].includes(c.op)) return one(v);
  return one(v);
}
function condWords(E, c) {
  const fd = E.fields[c.field];
  if (fd.type === T.bool) return c.value ? fd.label : `not ${fd.label}`;
  const op = fd.type === T.date ? ({ gt: "after", gte: "on or after", lt: "before", lte: "on or before", eq: "on" }[c.op] || OP_WORDS[c.op]) : OP_WORDS[c.op];
  return [fd.label, op, valWords(fd, c)].filter(Boolean).join(" ");
}
function queryWords(plan) {
  const E = ENTITIES[plan.entity];
  const w = [E.plural.charAt(0).toUpperCase() + E.plural.slice(1)];
  for (const c of plan.where) w.push(condWords(E, c));
  for (const r of plan.related || []) {
    const R = ENTITIES[r.entity];
    const inner = r.where.map(c => condWords(R, c)).join(", ");
    w.push(r.none ? `no ${R.plural}${inner ? ` with ${inner}` : ""}`
      : r.minSum != null ? (R.amountWord ? `${r.minSum} or more ${R.amountWord} of ${R.plural}` : `${money(r.minSum)} or more in ${R.plural}`) + (inner ? ` with ${inner}` : "")
      : `${r.min > 1 ? `${r.min} or more` : "any"} ${R.plural}${inner ? ` with ${inner}` : ""}`);
  }
  const m = plan.measure;
  if (m.fn !== "count" && !(m.fn === "count_people" && plan.entity === "people")) w.push(m.fn === "count_people" ? "counted by person" : `${{ sum: "total", avg: "average", min: "smallest", max: "largest" }[m.fn]} ${E.fields[m.field].label}`);
  if (plan.groupBy) w.push(`by ${plan.groupBy.bucket ? plan.groupBy.bucket : E.fields[plan.groupBy.field].label}`);
  return w.join(" · ");
}

// ── THE MODEL'S FORM ───────────────────────────────────────────────────────
// The catalog, written out for the model, with the org's own values for the
// fields that have a fixed list (its funds, campaigns, events, owners…).
async function catalogValues(orgId) {
  const q = (sql) => query(sql, [orgId]).then(rs => rs.map(r => r.v).filter(Boolean)).catch(() => []);
  const [fund, campaign, event, owner, payment_method, gift_type, interaction_type, logged_by, stage, interval, recurring_status, ask_status, grant_status] = await Promise.all([
    q(`SELECT name AS v FROM fin_funds WHERE org_id = ? ORDER BY name LIMIT 40`),
    q(`SELECT name AS v FROM campaigns WHERE org_id = ? AND sent_at IS NULL AND COALESCE(subject,'') = '' ORDER BY start_date DESC NULLS LAST LIMIT 40`),
    q(`SELECT name AS v FROM events WHERE org_id = ? ORDER BY date DESC LIMIT 40`),
    q(`SELECT DISTINCT assigned_to_name AS v FROM donors WHERE org_id = ? AND assigned_to_name <> '' LIMIT 30`),
    q(`SELECT DISTINCT payment_method AS v FROM gifts WHERE org_id = ? AND payment_method <> '' LIMIT 20`),
    q(`SELECT DISTINCT type AS v FROM gifts WHERE org_id = ? AND type <> '' LIMIT 20`),
    q(`SELECT DISTINCT type AS v FROM interactions WHERE org_id = ? LIMIT 20`),
    q(`SELECT DISTINCT logged_by_name AS v FROM interactions WHERE org_id = ? AND logged_by_name <> '' LIMIT 30`),
    q(`SELECT DISTINCT stage AS v FROM donors WHERE org_id = ? AND stage <> '' LIMIT 20`),
    q(`SELECT DISTINCT interval AS v FROM recurring_subscriptions WHERE org_id = ? LIMIT 10`),
    q(`SELECT DISTINCT status AS v FROM recurring_subscriptions WHERE org_id = ? LIMIT 20`),
    q(`SELECT DISTINCT status AS v FROM opportunities WHERE org_id = ? LIMIT 20`),
    q(`SELECT DISTINCT status AS v FROM grants WHERE org_id = ? LIMIT 20`),
  ]);
  return { fund, campaign, event, owner, payment_method, gift_type, interaction_type, logged_by, stage, interval, recurring_status, ask_status, grant_status };
}
function catalogText(values = {}) {
  const lines = [];
  for (const [k, E] of Object.entries(ENTITIES)) {
    lines.push(`${k} (${E.plural}${E.person ? ", each about one person" : ""}):`);
    for (const [fk, fd] of Object.entries(E.fields)) {
      const vals = fd.values && values[fd.values] && values[fd.values].length ? ` values: ${values[fd.values].slice(0, 25).join(" | ")}` : "";
      lines.push(`  ${fk} [${fd.type}] ${fd.label}${vals}`);
    }
  }
  return lines.join("\n");
}
function queryTool() {
  const cond = { type: "object", properties: { field: { type: "string" }, op: { type: "string", enum: [...new Set(Object.values(OPS).flat())] },
    value: { description: "A string, number, true/false, or a two-item array for between. Dates YYYY-MM-DD." } }, required: ["field", "op"] };
  return {
    name: "query_plan",
    description: "The records that answer the question, using only the entities and fields in the catalog. Steward runs it; you never state a number.",
    input_schema: {
      type: "object",
      properties: {
        answerable: { type: "boolean", description: "false when the catalog cannot express the question; then fill unsupported and nothing else" },
        unsupported: { type: ["string", "null"], description: "What the catalog cannot express, in a few plain words" },
        entity: { type: "string", enum: ENTITY_KEYS },
        where: { type: "array", items: cond },
        related: { type: "array", description: "Only when entity is people (or another per-person entity): conditions on that person's OTHER records.",
          items: { type: "object", properties: { entity: { type: "string", enum: ENTITY_KEYS }, where: { type: "array", items: cond },
            min: { type: "integer", description: "at least this many such records (default 1)" },
            minSum: { type: "number", description: "at least this total of the record's amount" },
            none: { type: "boolean", description: "true for people with NO such record" } }, required: ["entity"] } },
        measure: { type: "object", properties: { fn: { type: "string", enum: FNS }, field: { type: "string" } }, required: ["fn"] },
        groupBy: { type: "object", properties: { field: { type: "string" }, bucket: { type: "string", enum: BUCKETS } }, required: ["field"] },
        list: { type: "boolean", description: "true when the question asks WHO or WHICH: return the records themselves" },
        sort: { type: "object", properties: { by: { type: "string" }, dir: { type: "string", enum: ["asc", "desc"] } } },
        limit: { type: "integer" },
      },
      required: ["answerable"],
    },
  };
}
function queryPrompt(question, { today, catalog, previous = null }) {
  return [
    "Turn a nonprofit fundraiser's question about their own records into a query plan with the query_plan tool.",
    "Use ONLY the entities and fields below. Never invent a field. If the question needs something the catalog cannot express, set answerable to false and say what in unsupported.",
    `Today is ${today}. "This year" and "last year" are calendar years. Write dates as YYYY-MM-DD; use last_days for "in the last N days/months" (a month is 30 days, "a while" is 180).`,
    "A question about people (who, how many people, which donors) with conditions on their gifts, conversations, events, volunteering or other records uses entity people with related.",
    "\"How much\" is measure sum; \"how many\" is count (count_people for how many people gave); \"average\" is avg; \"largest/smallest\" is max/min.",
    "Came to, went to or attended an event means a guest of it; add checked_in only when she says checked in. Gave to an event means gifts with that event.",
    "A name she gives may be partial: use contains for names and titles, eq only for a value from a listed set.",
    "\"By month/fund/campaign…\" is groupBy. \"Who/which/list/show\" sets list true. A value for a field with listed values must be one of them, written the same.",
    ...(previous ? [`The question before this one was answered with this plan, and a follow-up changes it: ${JSON.stringify(previous)}`] : []),
    "",
    "CATALOG",
    catalog,
    "",
    `Question: ${question}`,
  ].join("\n");
}
function readQueryTool(content) {
  const b = (content || []).find(x => x && x.type === "tool_use" && x.name === "query_plan");
  if (!b || !b.input || typeof b.input !== "object") return null;
  return b.input;
}

// The org's own today (its timezone), for "in the last N days".
async function orgToday(orgId) {
  const [o] = await query("SELECT timezone FROM orgs WHERE id = ?", [orgId]);
  return orgTime.orgToday({ timezone: o && o.timezone });
}
// The rows behind one figure of an answer: "value" (the whole answer) or
// "g<n>" (one group). They are drawn by the same conditions that counted it.
async function figureRows(orgId, plan, cell) {
  const today = await orgToday(orgId);
  if (/^g\d+$/.test(String(cell)) && plan.groupBy) {
    const r = await runQuery(orgId, { ...plan, list: false }, today);
    const g = (r.groups || [])[Number(String(cell).slice(1))];
    return g ? listRows(orgId, plan, today, { limit: 20000, groupKey: g.key }) : [];
  }
  return listRows(orgId, plan, today, { limit: 20000 });
}

// The Agent's people-finder, when the donor list's filters cannot express her
// words: the model fills the query form for a list of PEOPLE, Steward runs it.
// Returns { ids, words } or null.
async function peopleForWords(orgId, words, client, model) {
  if (!client || !words) return null;
  const today = await orgToday(orgId);
  const catalog = catalogText(await catalogValues(orgId));
  const out = await client.messages.create({ model, max_tokens: 1500, tools: [queryTool()], tool_choice: { type: "tool", name: "query_plan" },
    messages: [{ role: "user", content: queryPrompt(`List the people she means: ${words}`, { today, catalog }) + "\nThis is a request for a list of people: use entity people and list true." }] });
  const raw = readQueryTool(out.content);
  if (!raw || raw.answerable === false) return null;
  const chk = validateQuery({ ...raw, list: true, groupBy: null });
  if (!chk.ok || chk.plan.entity !== "people") return null;
  const rows = await listRows(orgId, chk.plan, today, { limit: 1001 });
  return { ids: rows.map(r => r.id), words: queryWords(chk.plan).split(" · ").slice(1), plan: chk.plan };
}

module.exports = { orgToday, figureRows, peopleForWords, ENTITIES, ENTITY_KEYS, OPS, FNS, validateQuery, whereFor, runQuery, listRows, queryWords, catalogValues, catalogText, queryTool, queryPrompt, readQueryTool, money, dayWords };
