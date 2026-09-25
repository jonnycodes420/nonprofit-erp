// shared/reportBuilder.js — BUILD-98 (switch) Part 3. REPORTS PEOPLE CAN BUILD.
//
// Bloomerang's report builder is the feature people say they'll miss. This is
// Steward's: pick what the report is ABOUT, pick its columns, filter it with
// and/or groups on any field (custom fields and funds included), group and
// total it, save it with a name, share it, schedule it.
//
// ── THE RULE THIS MODULE EXISTS TO HOLD ────────────────────────────────────
//     A FIELD IS A NAME FROM THIS CATALOGUE, NEVER A STRING OF SQL.
// Every column, filter and grouping a person picks is a KEY looked up here;
// the SQL beside it is written by this file, and every value she types is a
// bound parameter. A definition naming a field this catalogue does not have is
// refused, not passed through — which is what makes a saved report safe to
// store, share and schedule. The server adds the org scope; this file never
// sees an org id and never needs to.
//
// ── AND THE SECOND ─────────────────────────────────────────────────────────
// The twelve STANDARD reports that answer what every ED asks are not rebuilt
// here. Where Reports already answers the question (LYBUNT, SYBUNT, retention,
// top donors, giving by month), a standard report CALLS THAT HANDLER, so a
// saved LYBUNT and the Reports tab's LYBUNT are one computation and cannot
// disagree.
//
// Pure: no DB, no network, no clock, no JSX.

export const ENTITIES = {
  people: {
    label: "People",
    from: "donors d",
    base: ["d.deleted_at IS NULL", "d.is_sample IS NOT TRUE"],
    orgCol: "d.org_id",
    fields: {
      name:            { label: "Name", sql: "d.name", type: "text" },
      email:           { label: "Email", sql: "d.email", type: "text" },
      phone:           { label: "Phone", sql: "d.phone", type: "text" },
      city:            { label: "City", sql: "d.city", type: "text" },
      state:           { label: "State", sql: "d.state", type: "text" },
      zip:             { label: "ZIP", sql: "d.zip", type: "text" },
      stage:           { label: "Stage", sql: "d.stage", type: "text" },
      kind:            { label: "Person or organisation", sql: "COALESCE(d.kind,'person')", type: "text" },
      lifetime:        { label: "Lifetime giving", sql: "COALESCE(d.total_giving,0)", type: "money" },
      gift_count:      { label: "Number of gifts", sql: "COALESCE(d.gift_count,0)", type: "number" },
      first_gift_date: { label: "First gift date", sql: "NULLIF(d.first_gift_date,'')", type: "date" },
      last_gift_date:  { label: "Last gift date", sql: "NULLIF(d.last_gift_date,'')", type: "date" },
      last_gift_amount:{ label: "Last gift amount", sql: "COALESCE(d.last_gift_amount,0)", type: "money" },
      owner:           { label: "Assigned to", sql: "d.assigned_to_name", type: "text" },
      tags:            { label: "Tags", sql: "COALESCE(NULLIF(d.tags,''),'[]')", type: "tags" },
      person_type:     { label: "Person type", sql: "COALESCE(d.person_types,'[\"donor\"]'::jsonb)", type: "types" },
      deceased:        { label: "Deceased", sql: "COALESCE(d.deceased,false)", type: "bool" },
      do_not_contact:  { label: "Do not contact", sql: "COALESCE(d.do_not_contact,false)", type: "bool" },
      // BUILD-98 (switch) Part 5 — hours, summed from the shifts.
      volunteer_hours: { label: "Volunteer hours", sql: "(SELECT COALESCE(SUM(vs.hours),0) FROM volunteer_shifts vs WHERE vs.person_id = d.id AND vs.org_id = d.org_id)", type: "number" },
    },
    custom: { entity: "donor", sql: key => `d.custom_fields->>'${key}'` },
  },
  gifts: {
    label: "Gifts",
    from: "gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id LEFT JOIN fin_funds f ON f.id = g.fund_id",
    base: ["d.deleted_at IS NULL", "g.is_sample IS NOT TRUE"],
    orgCol: "g.org_id",
    fields: {
      donor:           { label: "Donor", sql: "d.name", type: "text" },
      amount:          { label: "Amount", sql: "g.amount", type: "money", sum: true },
      date:            { label: "Date", sql: "g.date", type: "date" },
      month:           { label: "Month", sql: "LEFT(g.date,7)", type: "text", groupOnly: true },
      year:            { label: "Year", sql: "LEFT(g.date,4)", type: "text", groupOnly: true },
      fund:            { label: "Fund", sql: "COALESCE(f.name,'(no fund)')", type: "text" },
      campaign:        { label: "Appeal", sql: "NULLIF(g.campaign,'')", type: "text" },
      type:            { label: "Gift type", sql: "g.type", type: "text" },
      payment_method:  { label: "Payment method", sql: "g.payment_method", type: "text" },
      acknowledged:    { label: "Thanked", sql: "(g.acknowledgement_sent_at IS NOT NULL OR COALESCE(g.acknowledgement_sent,false))", type: "bool" },
      acknowledged_via:{ label: "Thanked how", sql: "g.acknowledged_via", type: "text" },
      tribute:         { label: "Tribute", sql: "g.tribute_name", type: "text" },
      donor_stage:     { label: "Donor stage", sql: "d.stage", type: "text" },
      donor_kind:      { label: "Donor is person or organisation", sql: "COALESCE(d.kind,'person')", type: "text" },
    },
    custom: { entity: "gift", sql: key => `g.custom_fields->>'${key}'` },
  },
  pledges: {
    label: "Pledges",
    from: "pledges p JOIN donors d ON d.id = p.donor_id AND d.org_id = p.org_id",
    base: ["d.deleted_at IS NULL"],
    orgCol: "p.org_id",
    fields: {
      donor:     { label: "Donor", sql: "d.name", type: "text" },
      amount:    { label: "Pledged", sql: "p.amount", type: "money", sum: true },
      paid:      { label: "Paid", sql: "(SELECT COALESCE(SUM(pg.amount),0) FROM gifts pg WHERE pg.pledge_id = p.id AND pg.org_id = p.org_id)", type: "money", sum: true },
      remaining: { label: "Still to come", sql: "GREATEST(p.amount - (SELECT COALESCE(SUM(pg.amount),0) FROM gifts pg WHERE pg.pledge_id = p.id AND pg.org_id = p.org_id), 0)", type: "money", sum: true },
      due_date:  { label: "Due", sql: "p.due_date", type: "date" },
      status:    { label: "Status", sql: "p.status", type: "text" },
      is_match:  { label: "Expected employer match", sql: "COALESCE(p.is_match,false)", type: "bool" },
    },
  },
  recurring: {
    label: "Monthly and recurring gifts",
    from: "recurring_subscriptions rs JOIN donors d ON d.id = rs.donor_id AND d.org_id = rs.org_id",
    base: ["d.deleted_at IS NULL"],
    orgCol: "rs.org_id",
    fields: {
      donor:         { label: "Donor", sql: "d.name", type: "text" },
      amount:        { label: "Amount", sql: "rs.amount", type: "money", sum: true },
      interval:      { label: "Every", sql: "rs.interval", type: "text" },
      status:        { label: "Status", sql: "rs.status", type: "text" },
      failure_count: { label: "Times the card failed", sql: "COALESCE(rs.failure_count,0)", type: "number" },
      started:       { label: "Started", sql: "to_char(rs.created_at,'YYYY-MM-DD')", type: "date" },
    },
  },
  interactions: {
    label: "Conversations and notes",
    from: "interactions i JOIN donors d ON d.id = i.donor_id AND d.org_id = i.org_id",
    base: ["d.deleted_at IS NULL"],
    orgCol: "i.org_id",
    fields: {
      donor:  { label: "Donor", sql: "d.name", type: "text" },
      type:   { label: "Kind", sql: "i.type", type: "text" },
      date:   { label: "Date", sql: "i.date", type: "date" },
      note:   { label: "Note", sql: "i.note", type: "text" },
      by:     { label: "Logged by", sql: "i.logged_by_name", type: "text" },
    },
  },
};
export const ENTITY_KEYS = Object.keys(ENTITIES);

// Operators, per field type. A comparison the type cannot take is refused.
export const OPS = {
  eq: { label: "is", types: ["text", "number", "money", "date", "bool"] },
  ne: { label: "is not", types: ["text", "number", "money", "date", "bool"] },
  gt: { label: "more than", types: ["number", "money"] },
  gte: { label: "at least", types: ["number", "money"] },
  lt: { label: "less than", types: ["number", "money"] },
  lte: { label: "at most", types: ["number", "money"] },
  before: { label: "before", types: ["date"] },
  on_or_after: { label: "on or after", types: ["date"] },
  between: { label: "between", types: ["date", "number", "money"] },
  contains: { label: "contains", types: ["text", "tags", "types"] },
  in: { label: "is one of", types: ["text"] },
  empty: { label: "is empty", types: ["text", "date", "number", "money"] },
  not_empty: { label: "is not empty", types: ["text", "date", "number", "money"] },
};

export const MAX_RULES = 40;
export const MAX_DEPTH = 3;
export const MAX_COLUMNS = 20;
export const ROW_CAP = 2000;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
// Custom-field keys are the org's own and go INTO the SQL text as a JSON key,
// so only a key of this exact shape is accepted — the one place a name becomes
// SQL, fenced as tightly as anything in the product.
export const CUSTOM_KEY = /^[a-z][a-z0-9_]{0,59}$/;

export function fieldFor(entityKey, fieldKey, customDefs = []) {
  const E = ENTITIES[entityKey];
  if (!E) return null;
  if (E.fields[fieldKey]) return { key: fieldKey, ...E.fields[fieldKey] };
  const m = /^cf:(.+)$/.exec(String(fieldKey || ""));
  if (m && E.custom && CUSTOM_KEY.test(m[1])) {
    const def = customDefs.find(d => d.key === m[1] && d.entity === E.custom.entity);
    if (!def) return null;
    const t = def.type === "number" || def.type === "currency" ? "number" : def.type === "date" ? "date" : def.type === "checkbox" ? "bool" : "text";
    const raw = E.custom.sql(m[1]);
    const sql = t === "number" ? `NULLIF(${raw},'')::numeric` : t === "bool" ? `(${raw} IN ('true','yes','1'))` : raw;
    return { key: fieldKey, label: def.label, sql, type: t, custom: true };
  }
  return null;
}

// Validate and compile a definition. Returns { ok, errors } or the SQL
// fragments with every value as a $-placeholder offset from `paramStart`.
export function compile(def, { customDefs = [], paramStart = 1 } = {}) {
  const errors = [];
  const E = ENTITIES[def?.entity];
  if (!E) return { ok: false, errors: ["What is this report about? Choose people, gifts, pledges, recurring gifts or conversations."] };
  const params = [];
  const ph = v => { params.push(v); return `$${paramStart + params.length - 1}`; };

  const cols = (Array.isArray(def.columns) ? def.columns : []).slice(0, MAX_COLUMNS);
  const colFields = [];
  for (const c of cols) {
    const f = fieldFor(def.entity, c, customDefs);
    if (!f) errors.push(`Steward does not have a column called "${c}".`);
    else if (f.groupOnly && !def.groupBy) errors.push(`${f.label} is only for grouping.`);
    else colFields.push(f);
  }
  if (!colFields.length && !def.groupBy) errors.push("Choose at least one column.");

  let ruleCount = 0;
  const walk = (node, depth) => {
    if (!node) return "";
    if (Array.isArray(node.rules)) {
      // DEPTH COUNTS GROUPS, not the conditions inside them: three groups
      // deep is three, however many filters the innermost one holds.
      if (depth > MAX_DEPTH) { errors.push(`Filters can nest ${MAX_DEPTH} groups deep at most.`); return "FALSE"; }
      const join = node.op === "or" ? " OR " : " AND ";
      const parts = node.rules.map(r => walk(r, Array.isArray(r?.rules) ? depth + 1 : depth)).filter(Boolean);
      return parts.length ? `(${parts.join(join)})` : "";
    }
    ruleCount++;
    const f = fieldFor(def.entity, node.field, customDefs);
    if (!f) { errors.push(`Steward cannot filter on "${node.field}".`); return "FALSE"; }
    const op = OPS[node.cmp];
    if (!op || !op.types.includes(f.type)) { errors.push(`${f.label} cannot be filtered with "${node.cmp}".`); return "FALSE"; }
    const v = node.value;
    const num = x => { const n = Number(x); if (!Number.isFinite(n)) errors.push(`${f.label} needs a number.`); return n; };
    const date = x => { if (!ISO.test(String(x || ""))) errors.push(`${f.label} needs a date (YYYY-MM-DD).`); return String(x || ""); };
    const val = x => f.type === "date" ? date(x) : (f.type === "number" || f.type === "money") ? num(x) : f.type === "bool" ? (x === true || x === "true") : String(x ?? "");
    switch (node.cmp) {
      case "eq": return `${f.sql} = ${ph(val(v))}`;
      case "ne": return `${f.sql} IS DISTINCT FROM ${ph(val(v))}`;
      case "gt": return `${f.sql} > ${ph(val(v))}`;
      case "gte": return `${f.sql} >= ${ph(val(v))}`;
      case "lt": return `${f.sql} < ${ph(val(v))}`;
      case "lte": return `${f.sql} <= ${ph(val(v))}`;
      case "before": return `${f.sql} < ${ph(val(v))}`;
      case "on_or_after": return `${f.sql} >= ${ph(val(v))}`;
      case "between": {
        const a = Array.isArray(v) ? v : [];
        if (a.length !== 2) { errors.push(`${f.label} "between" needs two values.`); return "FALSE"; }
        return `(${f.sql} >= ${ph(val(a[0]))} AND ${f.sql} <= ${ph(val(a[1]))})`;
      }
      case "contains":
        if (f.type === "tags" || f.type === "types")
          return `EXISTS (SELECT 1 FROM jsonb_array_elements_text((${f.sql})::jsonb) x WHERE LOWER(x) = LOWER(${ph(String(v ?? ""))}))`;
        return `${f.sql} ILIKE ${ph("%" + String(v ?? "").replace(/[\\%_]/g, m => "\\" + m) + "%")}`;
      case "in": {
        const a = (Array.isArray(v) ? v : String(v || "").split(",")).map(x => String(x).trim()).filter(Boolean);
        if (!a.length) { errors.push(`${f.label} "is one of" needs at least one value.`); return "FALSE"; }
        return `${f.sql} = ANY(${ph(a)})`;
      }
      case "empty": return `(${f.sql} IS NULL${f.type === "text" ? ` OR ${f.sql} = ''` : ""})`;
      case "not_empty": return `(${f.sql} IS NOT NULL${f.type === "text" ? ` AND ${f.sql} <> ''` : ""})`;
    }
    return "FALSE";
  };
  const filterSql = def.filter ? walk(def.filter, 1) : "";
  if (ruleCount > MAX_RULES) errors.push(`A report can have ${MAX_RULES} filters at most.`);

  let group = null;
  if (def.groupBy) {
    const g = fieldFor(def.entity, def.groupBy, customDefs);
    if (!g) errors.push(`Steward cannot group by "${def.groupBy}".`);
    else group = g;
  }
  let sortField = null;
  if (def.sort?.field) {
    sortField = group ? null : fieldFor(def.entity, def.sort.field, customDefs);
    if (!group && !sortField) errors.push(`Steward cannot sort by "${def.sort.field}".`);
  }
  if (errors.length) return { ok: false, errors };

  const where = [...E.base];
  if (filterSql) where.push(filterSql);
  // The server runs this through db.js's query(), which rewrites every `?` to a
  // placeholder. The compiled SQL is written with $n placeholders and must
  // never contain a `?` of its own, or a value would bind to the wrong slot.
  const sqlText = [E.from, ...where, ...colFields.map(f => f.sql), group ? group.sql : ""].join(" ");
  if (sqlText.includes("?")) return { ok: false, errors: ["internal: the compiled report contains a ? and would bind wrongly"] };
  const sums = Object.entries(E.fields).filter(([, f]) => f.sum).map(([k, f]) => ({ key: k, label: f.label, sql: f.sql }));
  return {
    ok: true, entity: def.entity, from: E.from, orgCol: E.orgCol, where, params,
    columns: colFields.map(f => ({ key: f.key, label: f.label, type: f.type, sql: f.sql })),
    group: group ? { key: group.key, label: group.label, sql: group.sql } : null,
    sums,
    sort: group ? null : (sortField ? { sql: sortField.sql, dir: def.sort.dir === "asc" ? "ASC" : "DESC" } : null),
    limit: Math.min(Number(def.limit) > 0 ? Number(def.limit) : ROW_CAP, ROW_CAP),
  };
}

// ── THE TWELVE ─────────────────────────────────────────────────────────────
// `handler` reports call Reports' own function with these params (the server
// supplies the year); `builder` reports are definitions this module compiles.
// `today`/fiscal boundaries are resolved by the server at run time, so a saved
// "this year" is this year every time it runs.
export const STANDARD_REPORTS = [
  { key: "lybunt", name: "LYBUNT", question: "Who gave last year and not yet this year?", kind: "handler", handler: "lybunt", params: { yearMode: "fiscal" } },
  { key: "sybunt", name: "SYBUNT", question: "Who gave in some earlier year and not this one?", kind: "handler", handler: "sybunt", params: { yearMode: "fiscal" } },
  { key: "first-time", name: "First-time donors this year", question: "Who gave for the very first time this year?", kind: "builder",
    def: { entity: "people", columns: ["name", "first_gift_date", "lifetime", "email"], filter: { op: "and", rules: [{ field: "first_gift_date", cmp: "on_or_after", value: "{{fyStart}}" }] }, sort: { field: "first_gift_date", dir: "desc" } } },
  { key: "by-fund", name: "Donors by fund", question: "How much came in to each fund this year, and from how many gifts?", kind: "builder",
    def: { entity: "gifts", columns: [], groupBy: "fund", filter: { op: "and", rules: [{ field: "date", cmp: "on_or_after", value: "{{fyStart}}" }] } } },
  { key: "top-50", name: "Top 50 lifetime", question: "Who has given the most, ever?", kind: "handler", handler: "top-donors", params: { scope: "lifetime", limit: 50 } },
  { key: "monthly-givers", name: "Monthly givers and status", question: "Who gives every month, and is their card working?", kind: "builder",
    def: { entity: "recurring", columns: ["donor", "amount", "interval", "status", "failure_count", "started"], sort: { field: "amount", dir: "desc" } } },
  { key: "pledges-outstanding", name: "Pledges outstanding", question: "What has been promised and not yet arrived?", kind: "builder",
    def: { entity: "pledges", columns: ["donor", "amount", "paid", "remaining", "due_date", "is_match"], filter: { op: "and", rules: [{ field: "status", cmp: "eq", value: "open" }] }, sort: { field: "due_date", dir: "asc" } } },
  { key: "by-month", name: "Gifts by month vs last year", question: "How does each month this year compare with the same month last year?", kind: "handler", handler: "by-month-vs-last-year", params: { yearMode: "fiscal" } },
  { key: "retention", name: "Retention by cohort", question: "Of last year's donors, how many gave again?", kind: "handler", handler: "retention", params: { yearMode: "fiscal" } },
  { key: "lapsed-24", name: "Lapsed over 24 months", question: "Who has not given in more than two years?", kind: "builder",
    def: { entity: "people", columns: ["name", "last_gift_date", "last_gift_amount", "lifetime", "email"], filter: { op: "and", rules: [{ field: "last_gift_date", cmp: "before", value: "{{twoYearsAgo}}" }, { field: "deceased", cmp: "eq", value: false }] }, sort: { field: "lifetime", dir: "desc" } } },
  { key: "ack-backlog", name: "Acknowledgment backlog", question: "Which gifts has nobody thanked yet?", kind: "builder",
    def: { entity: "gifts", columns: ["donor", "date", "amount", "fund"], filter: { op: "and", rules: [{ field: "acknowledged", cmp: "eq", value: false }] }, sort: { field: "date", dir: "asc" } } },
  // BUILD-98 (switch) Part 5 — volunteer-to-donor conversion.
  { key: "volunteers-who-give", name: "Volunteers who give", question: "Which of our volunteers also give?", kind: "builder",
    def: { entity: "people", columns: ["name", "volunteer_hours", "lifetime", "last_gift_date"], filter: { op: "and", rules: [{ field: "person_type", cmp: "contains", value: "volunteer" }, { field: "lifetime", cmp: "gt", value: 0 }] }, sort: { field: "name", dir: "asc" } } },
  { key: "board-giving", name: "Board giving", question: "What has each board member given?", kind: "builder",
    def: { entity: "people", columns: ["name", "lifetime", "last_gift_date", "last_gift_amount"], filter: { op: "and", rules: [{ field: "person_type", cmp: "contains", value: "staff_board" }] }, sort: { field: "lifetime", dir: "desc" } } },
];
export const STANDARD_KEYS = STANDARD_REPORTS.map(r => r.key);

// Fill {{fyStart}} and friends from the server's clock and the org's fiscal
// year. Returns a new definition; the stored one keeps its placeholders.
export function resolveDateTokens(def, tokens) {
  const walk = n => {
    if (!n || typeof n !== "object") return n;
    if (Array.isArray(n)) return n.map(walk);
    const o = {};
    for (const [k, v] of Object.entries(n)) o[k] = typeof v === "string" && /^\{\{\w+\}\}$/.test(v) ? (tokens[v.slice(2, -2)] ?? v) : walk(v);
    return o;
  };
  return walk(def);
}

// Validates a definition before it is stored, without compiling it for a run.
export function validateDefinition(def, opts) {
  const c = compile(resolveDateTokens(def, { fyStart: "2000-01-01", twoYearsAgo: "2000-01-01", today: "2000-01-01" }), opts);
  return c.ok ? { ok: true, errors: [] } : { ok: false, errors: c.errors };
}

export const SCHEDULES = [null, "weekly"];
