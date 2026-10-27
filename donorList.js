// donorList.js · LIST-1. THE DONOR LIST: YOUR COLUMNS, AND A FILTER ON ANYTHING.
//
// One registry of the fields a person can show as a column or filter by on the
// Donors list, grouped the way the column editor groups them. Three rules:
//
//   · A FILTER IS THE LIST'S OWN FILTER. A condition that groups.js already
//     knows (city, state, zip, giving level, lapsed, an event, a campaign, a
//     group, hours volunteered...) is compiled by calling buildDonorFilter with
//     that one rule, so the list, a Group saved from it, Show me and Ask are
//     the same rows. Only what had no rule yet is written here, once.
//   · A NUMBER IN A COLUMN IS THE PROFILE'S NUMBER. Lifetime, last gift, first
//     gift and gift count are the stored totals NUMBERS-1's checker holds to
//     the gifts (donor-stored, donor-lifetime). This year is the profile's
//     "donor-gifts-between" from the fiscal year's start to today, set-wise.
//     Pledge balance is the F-5 remaining balance (amount less payments).
//   · NOTHING IS GUESSED. A condition on a field or with an operator Steward
//     does not know is refused with a sentence, never quietly dropped, because
//     an ignored filter is a list that says "in 40502" and holds everybody.
//
// The filter travels as JSON: {"join":"and"|"or","conditions":[{field,op,value}]}.
"use strict";
const { query } = require("./db");

const GROUPS = ["Contact", "Giving", "Pledges", "Events", "Volunteering", "Communication", "From your imports"];
const DEFAULT_COLUMNS = ["name", "stage", "owner", "lifetime", "last_gift_date", "engagement", "generosity"];
const PAGE_SIZES = [25, 50, 100];
const MAX_CONDITIONS = 25;
const MAX_WHERE_CHARS = 8000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// The operators, each with the kind of value it takes (the client draws the
// input from `input`). A field lists the ones it allows.
const OP = {
  is:        { label: "is", input: "text" },
  isSel:     { op: "is", label: "is", input: "select" },
  isNot:     { op: "is_not", label: "is not", input: "select" },
  contains:  { label: "contains", input: "text" },
  starts:    { label: "starts with", input: "text" },
  in:        { label: "is one of", input: "list" },
  within:    { label: "within miles of", input: "zipmiles" },
  gte:       { label: "at least", input: "money" },
  lte:       { label: "at most", input: "money" },
  between:   { label: "between", input: "moneyrange" },
  ngte:      { op: "gte", label: "at least", input: "number" },
  nlte:      { op: "lte", label: "at most", input: "number" },
  after:     { label: "on or after", input: "date" },
  before:    { label: "on or before", input: "date" },
  dbetween:  { op: "between", label: "between", input: "daterange" },
  blank:     { label: "is empty", input: "none" },
  notBlank:  { op: "not_blank", label: "is not empty", input: "none" },
  yes:       { label: "yes", input: "none" },
  no:        { label: "no", input: "none" },
};
const ops = (...names) => names.map(n => ({ op: OP[n].op || n.replace(/[A-Z]/g, c => "_" + c.toLowerCase()), label: OP[n].label, input: OP[n].input }));
const TEXT_OPS = ops("is", "contains", "starts", "in", "blank", "notBlank");
const MONEY_OPS = ops("gte", "lte", "between");
const NUM_OPS = ops("ngte", "nlte");
const DATE_OPS = ops("after", "before", "dbetween", "blank");
const BOOL_OPS = ops("yes", "no");
const SEL_OPS = ops("isSel");

// ── THE FIELDS ─────────────────────────────────────────────────────────────
// key, label, group, format (how a cell is drawn), sort (an ORDER BY over the
// donors row, or none), col (a column; false = filter only), filter (ops, and
// `options` filled per org below), cell (where the value comes from: a donors
// column, or a set-wise read named in CELL_READS).
const F = (key, label, group, o = {}) => ({ key, label, group, format: "text", col: true, ...o });
const FIELDS = [
  // Contact
  F("name", "Name", "Contact", { format: "name", sort: "lower(name)", filter: ops("contains", "starts"), cell: "name" }),
  F("email", "Email", "Contact", { sort: "lower(email)", filter: TEXT_OPS, cell: "email" }),
  F("phone", "Phone", "Contact", { filter: ops("contains", "blank", "notBlank"), cell: "phone" }),
  F("address", "Street address", "Contact", { filter: ops("contains", "blank", "notBlank"), cell: "address" }),
  F("city", "City", "Contact", { sort: "lower(city)", filter: TEXT_OPS, cell: "city" }),
  F("state", "State", "Contact", { sort: "upper(state)", filter: ops("is", "in", "blank"), cell: "state" }),
  F("zip", "Zip", "Contact", { sort: "zip", filter: ops("is", "starts", "in", "within", "blank"), cell: "zip" }),
  F("county", "County", "Contact", { sort: "lower(county)", filter: ops("is", "in", "blank"), cell: "county",
    sentence: "The county the address is in, filled in when Steward places the address on the map." }),
  F("country", "Country", "Contact", { sort: "country", filter: ops("is", "blank"), cell: "country" }),
  F("employer", "Employer", "Contact", { sort: "lower(employer)", filter: TEXT_OPS, cell: "employer" }),
  F("kind", "Person or organization", "Contact", { filter: SEL_OPS, cell: "kind",
    options: [{ value: "person", label: "A person" }, { value: "organization", label: "An organization" }] }),
  F("household", "Household", "Contact", { filter: ops("yes", "no"), cell: "household",
    sentence: "The household this person belongs to, from the household record." }),
  F("stage", "Stage", "Contact", { format: "stage", sort: "stage", filter: SEL_OPS, cell: "stage" }),
  F("owner", "Owner", "Contact", { format: "owner", sort: "lower(COALESCE(assigned_to_name, pending_assignee_name, ''))", filter: SEL_OPS, cell: "owner" }),
  F("tags", "Tags", "Contact", { format: "list", filter: SEL_OPS, cell: "tags" }),
  F("group", "Group", "Contact", { col: false, filter: SEL_OPS }),
  F("added", "Added", "Contact", { format: "date", sort: "created_at", filter: ops("after", "before", "dbetween"), cell: "added" }),
  // Giving
  F("lifetime", "Lifetime", "Giving", { format: "money", sort: "total_giving", filter: MONEY_OPS, cell: "lifetime",
    sentence: "Every gift this person has ever given, added up, with any total brought in from an old system. The same figure as Lifetime on the profile." }),
  F("this_year", "This year", "Giving", { format: "money", filter: MONEY_OPS, cell: "this_year",
    sentence: "Every gift dated from the start of your fiscal year to today. The same figure as This year on the profile." }),
  F("last_gift_date", "Last gift", "Giving", { format: "date", sort: "last_gift_date", filter: DATE_OPS, cell: "last_gift_date" }),
  F("last_gift_amount", "Last gift amount", "Giving", { format: "money", sort: "last_gift_amount", filter: MONEY_OPS, cell: "last_gift_amount" }),
  F("first_gift_date", "First gift", "Giving", { format: "date", sort: "first_gift_date", filter: DATE_OPS, cell: "first_gift_date" }),
  F("gift_count", "Number of gifts", "Giving", { format: "number", sort: "gift_count", filter: NUM_OPS, cell: "gift_count" }),
  F("level", "Giving level", "Giving", { col: false, filter: SEL_OPS,
    options: [{ value: "general", label: "General" }, { value: "mid", label: "Mid" }, { value: "major", label: "Major" }] }),
  F("lapse", "Lapsed or lapsing", "Giving", { col: false, filter: SEL_OPS,
    options: [{ value: "lapsed", label: "Lapsed" }, { value: "lapsing", label: "Lapsing" }],
    sentence: "Steward's one lapsed rule: gave before, and nothing in the last twelve months. Lapsing is close to it." }),
  F("lifecycle", "Lifecycle", "Giving", { col: false, filter: SEL_OPS,
    options: ["new", "current", "recaptured", "lapsed"].map(v => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })) }),
  F("monthly", "Gives monthly", "Giving", { col: false, filter: BOOL_OPS }),
  F("fund", "Gave to a fund", "Giving", { col: false, filter: SEL_OPS }),
  F("campaign", "Gave to a campaign", "Giving", { col: false, filter: SEL_OPS }),
  F("payment_method", "Paid by", "Giving", { col: false, filter: SEL_OPS }),
  F("no_date_gift", "Has a gift with no date", "Giving", { col: false, filter: BOOL_OPS,
    sentence: "A gift on file whose date is missing or is not a real day." }),
  F("membership", "Membership", "Giving", { filter: SEL_OPS, cell: "membership",
    options: [{ value: "current", label: "Member now" }, { value: "lapsed", label: "Lapsed member" }, { value: "any", label: "Ever a member" }] }),
  // Shown only to someone who may see it (admin or the major gifts
  // permission); the word rides on the row from prospect.roomToGive.
  F("room_to_give", "Room to give", "Giving", { format: "text", majorGifts: true, cell: "room_to_give" }),
  F("engagement", "Engagement", "Giving", { format: "number", sort: "engagement_score", cell: "engagement" }),
  F("generosity", "Giving strength", "Giving", { format: "number", sort: "generosity_score", cell: "generosity" }),
  // Pledges
  F("open_pledge", "Has an open pledge", "Pledges", { col: false, filter: BOOL_OPS }),
  F("pledge_balance", "Pledge balance", "Pledges", { format: "money", filter: MONEY_OPS, cell: "pledge_balance",
    sentence: "What is still to come on open pledges: each pledge's amount less what has been paid against it." }),
  // Events
  F("event_invited", "Invited to an event", "Events", { col: false, filter: SEL_OPS }),
  F("event_registered", "Registered for an event", "Events", { col: false, filter: SEL_OPS }),
  F("event_attended", "Came to an event", "Events", { col: false, filter: SEL_OPS }),
  F("event_no_gift", "Came to an event and didn't give", "Events", { col: false, filter: SEL_OPS,
    sentence: "Came to the event (attended or checked in) and has given nothing since the day of the event." }),
  F("events_attended", "Events attended", "Events", { format: "number", cell: "events_attended" }),
  // Volunteering
  F("volunteer", "Volunteers", "Volunteering", { col: false, filter: BOOL_OPS }),
  F("volunteer_hours", "Hours volunteered", "Volunteering", { format: "number", filter: NUM_OPS, cell: "volunteer_hours" }),
  // Communication
  F("last_contact", "Last contact", "Communication", { format: "date", filter: ops("before"), cell: "last_contact",
    sentence: "The last call, meeting, email or note logged with this person." }),
  F("do_not_contact", "Do not contact", "Communication", { format: "bool", filter: BOOL_OPS, cell: "do_not_contact" }),
  F("do_not_solicit", "Do not ask", "Communication", { format: "bool", filter: BOOL_OPS, cell: "do_not_solicit" }),
  F("do_not_email", "No email", "Communication", { format: "bool", filter: BOOL_OPS, cell: "do_not_email" }),
  F("do_not_mail", "No mail", "Communication", { format: "bool", filter: BOOL_OPS, cell: "do_not_mail" }),
  F("do_not_call", "No calls", "Communication", { format: "bool", filter: BOOL_OPS, cell: "do_not_call" }),
  F("opted_out", "Opted out of anything", "Communication", { col: false, filter: BOOL_OPS }),
  F("email_unreachable", "Email bounced", "Communication", { format: "bool", filter: BOOL_OPS, cell: "email_unreachable" }),
  // SEND-GATE-1: whether Steward may send this person automatic email.
  F("auto_email", "Automatic emails", "Communication", { format: "bool", filter: BOOL_OPS, cell: "auto_email" }),
];
// The pipeline stages, as client/src/components/shared.jsx STAGES names them.
const STAGE_OPTIONS = [["prospect", "Prospect"], ["qualify", "Qualify"], ["cultivate", "Cultivate"], ["solicit", "Solicit"],
  ["steward", "Ongoing care"], ["lapsed", "Lapsed"]].map(([value, label]) => ({ value, label }));
const BY_KEY = new Map(FIELDS.map(f => [f.key, f]));
// A donors column a cell reads straight off the row.
const ROW_CELL = {
  name: "name", email: "email", phone: "phone", address: "address", city: "city", state: "state", zip: "zip", county: "county",
  country: "country", employer: "employer", kind: "kind", stage: "stage", added: "created_at", lifetime: "total_giving",
  last_gift_date: "last_gift_date", last_gift_amount: "last_gift_amount", first_gift_date: "first_gift_date", gift_count: "gift_count",
  engagement: "engagement_score", generosity: "generosity_score", do_not_contact: "do_not_contact", do_not_solicit: "do_not_solicit",
  do_not_email: "do_not_email", do_not_mail: "do_not_mail", do_not_call: "do_not_call", email_unreachable: "email_unreachable",
  auto_email: "auto_email",
};
const BOOL_COL = { do_not_contact: 1, do_not_solicit: 1, do_not_email: 1, do_not_mail: 1, do_not_call: 1, email_unreachable: 1, auto_email: 1 };

// The custom fields an org keeps (BUILD-78's registry, the one IMPORT-4 adds
// imported fields to), as fields of their own under "From your imports".
const CF_OPS = {
  text: TEXT_OPS, long_text: ops("contains", "blank", "notBlank"), number: NUM_OPS, money: MONEY_OPS, date: DATE_OPS,
  select: SEL_OPS, multi_select: SEL_OPS, checkbox: BOOL_OPS,
};
const CF_FORMAT = { number: "number", money: "money", date: "date", multi_select: "list", checkbox: "bool" };
async function customFieldDefs(orgId) {
  return query(`SELECT key, label, type, options FROM custom_field_defs
                 WHERE org_id = ? AND entity = 'donor' AND archived_at IS NULL ORDER BY position, label`, [orgId]).catch(() => []);
}
function cfField(d) {
  let options = d.options;
  if (typeof options === "string") { try { options = JSON.parse(options); } catch { options = []; } }
  options = Array.isArray(options) ? options.map(o => (typeof o === "object" && o ? String(o.value ?? o.label ?? "") : String(o))).filter(Boolean) : [];
  return { key: `cf:${d.key}`, label: d.label, group: "From your imports", col: true, format: CF_FORMAT[d.type] || "text",
    filter: CF_OPS[d.type] || TEXT_OPS, cfKey: d.key, cfType: d.type, options: options.map(v => ({ value: v, label: v })),
    sort: null, cell: "cf" };
}

// Every field for this org, with the choices a select offers.
async function fieldsFor(orgId) {
  const [defs, owners, tags, groups, funds, campaigns, methods, events] = await Promise.all([
    customFieldDefs(orgId),
    query(`SELECT id, name FROM users WHERE org_id = ? AND deactivated_at IS NULL ORDER BY lower(name)`, [orgId]),
    query(`SELECT DISTINCT t AS tag FROM donors, LATERAL jsonb_array_elements_text(
             CASE WHEN COALESCE(tags,'') ~ '^\\s*\\[' THEN tags::jsonb ELSE '[]'::jsonb END) AS t
            WHERE org_id = ? AND deleted_at IS NULL ORDER BY 1 LIMIT 300`, [orgId]).catch(() => []),
    query(`SELECT id, name FROM audiences WHERE org_id = ? AND kind IS NOT NULL ORDER BY lower(name)`, [orgId]).catch(() => []),
    query(`SELECT id, name FROM fin_funds WHERE org_id = ? ORDER BY lower(name)`, [orgId]).catch(() => []),
    query(`SELECT id, name FROM campaigns WHERE org_id = ? ORDER BY lower(name)`, [orgId]).catch(() => []),
    query(`SELECT DISTINCT payment_method AS m FROM gifts WHERE org_id = ? AND COALESCE(payment_method,'') <> '' ORDER BY 1 LIMIT 50`, [orgId]),
    query(`SELECT id, name, date::text AS date FROM events WHERE org_id = ? ORDER BY date DESC NULLS LAST, lower(name) LIMIT 300`, [orgId]).catch(() => []),
  ]);
  const ev = events.map(e => ({ value: e.id, label: e.date ? `${e.name} (${String(e.date).slice(0, 10)})` : e.name }));
  const choices = {
    owner: [{ value: "none", label: "No owner" }, ...owners.map(u => ({ value: u.id, label: u.name }))],
    tags: tags.map(t => ({ value: t.tag, label: t.tag })),
    group: groups.map(g => ({ value: g.id, label: g.name })),
    fund: funds.map(x => ({ value: x.id, label: x.name })),
    campaign: campaigns.map(x => ({ value: x.id, label: x.name })),
    payment_method: methods.map(x => ({ value: x.m, label: x.m })),
    event_invited: ev, event_registered: [{ value: "any", label: "Any event" }, ...ev],
    event_attended: [{ value: "any", label: "Any event" }, ...ev], event_no_gift: ev,
    stage: STAGE_OPTIONS,
  };
  return [...FIELDS.map(f => ({ ...f, options: choices[f.key] || f.options || undefined })), ...defs.map(cfField)];
}
function publicField(f) {
  return { key: f.key, label: f.label, group: f.group, column: !!f.col, sortable: !!f.sort, format: f.format,
    sentence: f.sentence || undefined, filter: f.filter ? { ops: f.filter, options: f.options } : null };
}

// ── THE FILTER ─────────────────────────────────────────────────────────────
const bad = sentence => ({ error: sentence });
function parseWhere(raw) {
  if (raw === undefined || raw === null || raw === "") return { where: null };
  if (String(typeof raw === "string" ? raw : JSON.stringify(raw)).length > MAX_WHERE_CHARS) return bad("That filter is too long.");
  let w = raw;
  if (typeof w === "string") { try { w = JSON.parse(w); } catch { return bad("That filter could not be read."); } }
  if (!w || typeof w !== "object" || !Array.isArray(w.conditions)) return bad("That filter could not be read.");
  const join = w.join === "or" ? "or" : "and";
  if (w.join !== undefined && !["and", "or"].includes(w.join)) return bad("Conditions are joined by and or or.");
  if (w.conditions.length > MAX_CONDITIONS) return bad(`A filter holds at most ${MAX_CONDITIONS} conditions.`);
  const conditions = [];
  for (const c of w.conditions) {
    if (!c || typeof c !== "object" || typeof c.field !== "string" || typeof c.op !== "string") return bad("Each condition names a field and how to match it.");
    conditions.push({ field: c.field, op: c.op, value: c.value === undefined ? null : c.value });
  }
  return { where: { join, conditions } };
}

const money = v => { const n = Number(String(v ?? "").replace(/[$,\s]/g, "")); return String(v ?? "").trim() !== "" && Number.isFinite(n) ? n : null; };
const listOf = v => String(v ?? "").split(/[,\n;]+/).map(s => s.trim()).filter(Boolean).slice(0, 200);
const isDay = v => DAY.test(String(v || ""));

// Text on a donors column: is / contains / starts / in / blank / not blank.
function textCond(col, op, value) {
  const c = `lower(trim(COALESCE(${col},'')))`;
  const v = String(value ?? "").trim().toLowerCase();
  if (op === "blank") return { sql: `${c} = ''`, args: [] };
  if (op === "not_blank") return { sql: `${c} <> ''`, args: [] };
  if (!v && op !== "in") return bad("Type something to match.");
  if (op === "is") return { sql: `${c} = ?`, args: [v] };
  if (op === "contains") return { sql: `strpos(${c}, ?) > 0`, args: [v] };
  if (op === "starts") return { sql: `left(${c}, ?) = ?`, args: [v.length, v] };
  if (op === "in") { const l = listOf(value).map(s => s.toLowerCase()); if (!l.length) return bad("List at least one."); return { sql: `${c} = ANY(?::text[])`, args: [l] }; }
  return null;
}
function moneyCond(expr, op, value) {
  if (op === "between") {
    const lo = money(value && value.from), hi = money(value && value.to);
    if (lo === null && hi === null) return bad("Give an amount.");
    const p = [], a = [];
    if (lo !== null) { p.push(`${expr} >= ?`); a.push(lo); }
    if (hi !== null) { p.push(`${expr} <= ?`); a.push(hi); }
    return { sql: p.join(" AND "), args: a };
  }
  const n = money(value);
  if (n === null) return bad("Give an amount, like 500.");
  if (op === "gte") return { sql: `${expr} >= ?`, args: [n] };
  if (op === "lte") return { sql: `${expr} <= ?`, args: [n] };
  return null;
}
function dateCond(col, op, value) {
  const c = `LEFT(COALESCE(${col}::text,''),10)`;
  if (op === "blank") return { sql: `${c} = ''`, args: [] };
  if (op === "between") {
    const from = value && value.from, to = value && value.to;
    if ((from && !isDay(from)) || (to && !isDay(to)) || (!from && !to)) return bad("A date is written 2026-01-31.");
    return { sql: `${c} <> '' AND ${c} >= ? AND ${c} <= ?`, args: [from || "0000-01-01", to || "9999-12-31"] };
  }
  if (!isDay(value)) return bad("A date is written 2026-01-31.");
  if (op === "after") return { sql: `${c} <> '' AND ${c} >= ?`, args: [value] };
  if (op === "before") return { sql: `${c} <> '' AND ${c} <= ?`, args: [value] };
  return null;
}
const bool = (op, sql) => (op === "yes" ? { sql, args: [] } : op === "no" ? { sql: `NOT (${sql})`, args: [] } : null);
const has = (sql) => `EXISTS (${sql})`;
const giftOf = a => `SELECT 1 FROM gifts ${a} WHERE ${a}.org_id = donors.org_id AND ${a}.donor_id = donors.id`;

// The SQL behind This year, pledge balance and hours, shared by a column and a filter.
const THIS_YEAR_SQL = `(SELECT COALESCE(SUM(gy.amount),0) FROM gifts gy WHERE gy.org_id = donors.org_id AND gy.donor_id = donors.id AND gy.date >= ? AND gy.date <= ?)`;
const PLEDGE_BALANCE_SQL = `(SELECT COALESCE(SUM(GREATEST(px.amount - COALESCE((SELECT SUM(pg.amount) FROM gifts pg WHERE pg.org_id = px.org_id AND pg.pledge_id = px.id),0),0)),0)
   FROM pledges px WHERE px.org_id = donors.org_id AND px.donor_id = donors.id AND px.status = 'open')`;

async function yearWindow(orgId) {
  const DS = require("./donorStatus");
  const today = await DS.todayFor(orgId);
  const [vo] = await query(`SELECT timezone, vocabulary_json FROM orgs WHERE id = ?`, [orgId]);
  const fyStart = require("./orgTime").orgFiscalYearStart(vo || {});
  return { from: fyStart, to: today };
}

// One condition to { sql, args } | { rules } | { error }.
async function compileOne(orgId, c, fields) {
  const f = fields.get(c.field);
  if (!f || !f.filter) return bad(`Steward can't filter by "${c.field}".`);
  if (!f.filter.some(o => o.op === c.op)) return bad(`${f.label} can't be matched by "${c.op}".`);
  const v = c.value;
  const sel = () => { const s = String(v ?? "").trim(); return s ? s : null; };
  const needSel = () => bad(`Pick one for ${f.label}.`);
  if (f.cfKey) return cfCond(f, c.op, v);
  switch (f.key) {
    case "name": case "email": case "phone": case "address": case "employer": case "country":
      return textCond(f.key, c.op, v);
    case "city":
      if (c.op === "is") return sel() ? { rules: { city: sel() } } : bad("Type a city.");
      return textCond("city", c.op, v);
    case "county": return textCond("county", c.op, v);
    case "state": {
      if (c.op === "blank") return textCond("state", "blank");
      const codes = (c.op === "in" ? listOf(v) : [String(v ?? "").trim()]).filter(Boolean).map(s => s.toUpperCase());
      if (!codes.length) return bad("Type a state, like KY.");
      return { anyRules: codes.map(state => ({ state })) };
    }
    case "zip": {
      if (c.op === "blank") return textCond("zip", "blank");
      if (c.op === "within") {
        const zip = String(v && v.zip || "").trim(), miles = Number(v && v.miles);
        if (!/^\d{5}$/.test(zip)) return bad("A zip is five digits, like 40502.");
        if (!(miles > 0 && miles <= 500)) return bad("Miles is a number from 1 to 500.");
        return { rules: { zipMiles: `${zip}:${miles}` } };
      }
      const s = c.op === "in" ? listOf(v).join(",") : String(v ?? "").trim();
      if (!s) return bad("Type a zip.");
      return { rules: { zip: c.op === "starts" ? `${s}*` : s } };
    }
    case "kind": return sel() ? { rules: { kind: sel() } } : needSel();
    case "household": return bool(c.op, "household_id IS NOT NULL");
    case "stage": return sel() ? { rules: { stage: sel() } } : needSel();
    case "owner":
      if (!sel()) return needSel();
      return sel() === "none" ? { sql: "assigned_to IS NULL AND pending_assignee_invite_id IS NULL", args: [] } : { rules: { assignedTo: sel() } };
    case "tags": return sel() ? { sql: "strpos(COALESCE(tags,''), ?) > 0", args: [JSON.stringify(sel())] } : needSel();
    case "group": return sel() ? { rules: { groupId: sel() } } : needSel();
    case "added": return dateCond("created_at", c.op, v);
    case "lifetime": return moneyCond("COALESCE(total_giving,0)", c.op, v);
    case "last_gift_amount": return moneyCond("COALESCE(last_gift_amount,0)", c.op, v);
    case "this_year": {
      const r = moneyCond(THIS_YEAR_SQL, c.op, v);
      if (!r || r.error) return r;
      const w = await yearWindow(orgId);
      // Each THIS_YEAR_SQL in the clause takes the window ahead of its amount.
      const out = []; for (const a of r.args) out.push(w.from, w.to, a);
      return { sql: r.sql, args: out };
    }
    case "last_gift_date": return dateCond("last_gift_date", c.op, v);
    case "first_gift_date": return dateCond("first_gift_date", c.op, v);
    case "gift_count": {
      const r = moneyCond("COALESCE(gift_count,0)", c.op === "gte" ? "gte" : "lte", v);
      return r;
    }
    case "level": return sel() ? { rules: { level: sel() } } : needSel();
    case "lapse": return sel() === "lapsing" ? { rules: { lapsing: "1" } } : sel() === "lapsed" ? { rules: { lifecycle: "lapsed" } } : needSel();
    case "lifecycle": return sel() ? { rules: { lifecycle: sel() } } : needSel();
    case "monthly": return c.op === "yes" ? { rules: { recurring: "1" } } : { negateRules: { recurring: "1" } };
    case "fund": return sel() ? { sql: has(`${giftOf("gf")} AND gf.amount > 0 AND gf.fund_id = ?`), args: [sel()] } : needSel();
    case "campaign": return sel() ? { rules: { gaveCampaign: sel() } } : needSel();
    case "payment_method": return sel() ? { sql: has(`${giftOf("gm")} AND gm.amount > 0 AND lower(COALESCE(gm.payment_method,'')) = lower(?)`), args: [sel()] } : needSel();
    case "no_date_gift": return bool(c.op, has(`${giftOf("gd")} AND COALESCE(gd.date,'') !~ '^\\d{4}-\\d{2}-\\d{2}'`));
    case "membership": return sel() ? { rules: { member: sel() } } : needSel();
    case "open_pledge": return c.op === "yes" ? { rules: { hasPledge: "1" } } : { negateRules: { hasPledge: "1" } };
    case "pledge_balance": return moneyCond(PLEDGE_BALANCE_SQL, c.op, v);
    case "event_invited":
      return sel() ? { sql: has(`SELECT 1 FROM event_attendees ei WHERE ei.org_id = donors.org_id AND ei.donor_id = donors.id
                                  AND ei.event_id = ? AND lower(COALESCE(ei.status,'')) <> 'cancelled'`), args: [sel()] } : needSel();
    case "event_registered": return sel() ? { rules: { registeredEvent: sel() } } : needSel();
    case "event_attended": return sel() ? { rules: { attendedEvent: sel() } } : needSel();
    case "event_no_gift": return sel() ? { rules: { attendedNoGift: sel() } } : needSel();
    case "volunteer": return c.op === "yes" ? { rules: { volunteer: "1" } } : { negateRules: { volunteer: "1" } };
    case "volunteer_hours": {
      const n = money(v); if (n === null || n < 0) return bad("Hours is a number, 0 or more.");
      return { rules: c.op === "gte" ? { volHoursMin: String(n) } : { volHoursMax: String(n + 0.000001) } };
    }
    case "last_contact": return isDay(v) ? { rules: { noContactSince: String(v) } } : bad("A date is written 2026-01-31.");
    case "do_not_contact": case "do_not_solicit": case "do_not_email": case "do_not_mail": case "do_not_call": case "email_unreachable":
    case "auto_email":
      return bool(c.op, `${f.key} IS TRUE`);
    case "opted_out":
      return bool(c.op, "(do_not_contact IS TRUE OR do_not_solicit IS TRUE OR do_not_email IS TRUE OR do_not_mail IS TRUE OR do_not_call IS TRUE)");
    default: return bad(`Steward can't filter by "${c.field}".`);
  }
}

// A custom field, by its immutable key on the donors row's JSONB.
function cfCond(f, op, v) {
  const val = `(custom_fields ->> '${f.cfKey.replace(/[^A-Za-z0-9_]/g, "")}')`;
  const t = f.cfType;
  if (t === "checkbox") return bool(op, `${val} = 'true'`);
  if (t === "number" || t === "money") {
    const num = `(CASE WHEN ${val} ~ '^-?\\d+(\\.\\d+)?$' THEN ${val}::numeric END)`;
    // Money is held in cents (BUILD-78's seam); a person types dollars.
    const expr = t === "money" ? `(${num} / 100.0)` : num;
    return moneyCond(expr, op === "gte" ? "gte" : op === "lte" ? "lte" : op, v);
  }
  if (t === "date") return dateCond(val, op, v);
  if (t === "multi_select") {
    const s = String(v ?? "").trim(); if (!s) return bad(`Pick one for ${f.label}.`);
    return { sql: `(custom_fields -> '${f.cfKey.replace(/[^A-Za-z0-9_]/g, "")}') @> jsonb_build_array(?::text)`, args: [s] };
  }
  if (t === "select") { const s = String(v ?? "").trim(); return s ? { sql: `lower(${val}) = lower(?)`, args: [s] } : bad(`Pick one for ${f.label}.`); }
  return textCond(val, op, v);
}

// The whole filter, to one SQL clause over `donors` (unaliased). A rule-backed
// condition runs through groups.js buildDonorFilter with that one rule, whole,
// so it keeps its own org scope and arguments and can sit inside an OR.
async function compileWhere(orgId, raw, opts = {}) {
  const p = parseWhere(raw);
  if (p.error) return p;
  if (!p.where || !p.where.conditions.length) return { sql: null, args: [] };
  const fields = new Map((await fieldsFor(orgId)).map(f => [f.key, f]));
  const GR = require("./groups");
  const viaRules = async rules => {
    const r = await GR.buildDonorFilter(orgId, rules, { depth: opts.depth || 0 });
    if (r.badStatus || r.badRole) return bad(r.badFilter || "One of those choices isn't one Steward knows.");
    return { sql: `(${r.whereSql})`, args: r.params };
  };
  const parts = [], args = [];
  for (const c of p.where.conditions) {
    let r = await compileOne(orgId, c, fields);
    if (!r) return bad(`${(fields.get(c.field) || {}).label || c.field} can't be matched that way.`);
    if (r.error) return r;
    if (r.rules) r = await viaRules(r.rules);
    else if (r.negateRules) { const n = await viaRules(r.negateRules); r = n.error ? n : { sql: `NOT ${n.sql}`, args: n.args }; }
    else if (r.anyRules) {
      const each = []; const ea = [];
      for (const rule of r.anyRules) { const n = await viaRules(rule); if (n.error) return n; each.push(n.sql); ea.push(...n.args); }
      r = { sql: `(${each.join(" OR ")})`, args: ea };
    }
    if (r.error) return r;
    parts.push(`(${r.sql})`); args.push(...r.args);
  }
  return { sql: `(${parts.join(p.where.join === "or" ? " OR " : " AND ")})`, args };
}

// The filter in words, for a group made from it.
function whereSentence(raw) {
  const p = parseWhere(raw);
  if (p.error || !p.where || !p.where.conditions.length) return "";
  const words = p.where.conditions.map(c => {
    const f = BY_KEY.get(c.field);
    const label = f ? f.label : String(c.field).startsWith("cf:") ? String(c.field).slice(3) : c.field;
    const opl = Object.values(OP).find(o => (o.op || "") === c.op) || OP[c.op] || { label: c.op };
    const v = c.value && typeof c.value === "object" ? Object.values(c.value).filter(Boolean).join(" to ") : c.value;
    return `${label} ${opl.label}${v !== null && v !== undefined && v !== "" ? ` ${v}` : ""}`.trim();
  });
  return words.join(p.where.join === "or" ? ", or " : ", and ");
}

// ── THE CELLS ──────────────────────────────────────────────────────────────
// The values for the columns asked for, for one page of rows (set-wise: one
// statement per computed column, never one per row).
async function cellsFor(orgId, rows, columns) {
  const ids = rows.map(r => r.id);
  const want = new Set(columns);
  const out = new Map(rows.map(r => [r.id, {}]));
  if (!ids.length) return out;
  const reads = [];
  const put = (rowsBack, key, fn = r => r.v) => { for (const r of rowsBack) if (out.has(r.id)) out.get(r.id)[key] = fn(r); };
  if (want.has("this_year")) reads.push(yearWindow(orgId).then(w => query(
    `SELECT g.donor_id AS id, COALESCE(SUM(g.amount),0)::text AS v FROM gifts g
      WHERE g.org_id = ? AND g.donor_id = ANY(?) AND g.date >= ? AND g.date <= ? GROUP BY g.donor_id`, [orgId, ids, w.from, w.to]))
    .then(r => { for (const id of ids) out.get(id).this_year = 0; put(r, "this_year", x => Number(x.v)); }));
  if (want.has("pledge_balance")) reads.push(query(
    `SELECT p.donor_id AS id, COALESCE(SUM(GREATEST(p.amount - COALESCE(pp.paid,0),0)),0)::text AS v
       FROM pledges p LEFT JOIN (SELECT pledge_id, SUM(amount) AS paid FROM gifts WHERE org_id = ? AND pledge_id IS NOT NULL GROUP BY pledge_id) pp
         ON pp.pledge_id = p.id
      WHERE p.org_id = ? AND p.donor_id = ANY(?) AND p.status = 'open' GROUP BY p.donor_id`, [orgId, orgId, ids])
    .then(r => { for (const id of ids) out.get(id).pledge_balance = 0; put(r, "pledge_balance", x => Number(x.v)); }));
  if (want.has("events_attended")) reads.push(query(
    `SELECT donor_id AS id, COUNT(DISTINCT event_id)::int AS v FROM event_attendees
      WHERE org_id = ? AND donor_id = ANY(?) AND (lower(COALESCE(status,'')) = 'attended' OR checked_in_at IS NOT NULL) GROUP BY donor_id`, [orgId, ids])
    .then(r => { for (const id of ids) out.get(id).events_attended = 0; put(r, "events_attended"); }));
  if (want.has("volunteer_hours")) reads.push(query(
    `SELECT person_id AS id, COALESCE(SUM(hours),0)::text AS v FROM volunteer_shifts WHERE org_id = ? AND person_id = ANY(?) GROUP BY person_id`, [orgId, ids])
    .then(r => { for (const id of ids) out.get(id).volunteer_hours = 0; put(r, "volunteer_hours", x => Number(x.v)); }));
  if (want.has("membership")) reads.push(query(
    `SELECT DISTINCT ON (m.donor_id) m.donor_id AS id, m.status, l.name AS level FROM memberships m
       LEFT JOIN membership_levels l ON l.id = m.level_id AND l.org_id = m.org_id
      WHERE m.org_id = ? AND m.donor_id = ANY(?) ORDER BY m.donor_id, (m.status IN ('active','grace')) DESC, m.expires_on DESC NULLS LAST`, [orgId, ids])
    .then(r => put(r, "membership", x => [x.level, x.status === "grace" ? "in grace" : x.status].filter(Boolean).join(", "))).catch(() => {}));
  if (want.has("household")) reads.push(query(
    `SELECT d.id, h.name AS v FROM donors d JOIN households h ON h.id = d.household_id AND h.org_id = d.org_id
      WHERE d.org_id = ? AND d.id = ANY(?)`, [orgId, ids]).then(r => put(r, "household")).catch(() => {}));
  if (want.has("last_contact")) reads.push(query(
    `SELECT donor_id AS id, MAX(LEFT(date,10)) AS v FROM interactions
      WHERE org_id = ? AND donor_id = ANY(?) AND type IN ('call','meeting','email','stewardship') GROUP BY donor_id`, [orgId, ids])
    .then(r => put(r, "last_contact")));
  await Promise.all(reads);
  const DTAGS = require("./donorTags");
  for (const r of rows) {
    const cell = out.get(r.id);
    for (const k of want) {
      if (k in cell) continue;
      if (k === "room_to_give") cell.room_to_give = r.room ? r.room.label : null;
      else if (k === "owner") cell.owner = r.assigned_to_name || r.pending_assignee_name || null;
      else if (k === "tags") cell.tags = DTAGS.visibleTags(r.tags);
      else if (k.startsWith("cf:")) {
        const cf = r.custom_fields && typeof r.custom_fields === "object" ? r.custom_fields : (() => { try { return JSON.parse(r.custom_fields || "{}"); } catch { return {}; } })();
        cell[k] = cf[k.slice(3)] ?? null;
      } else if (ROW_CELL[k]) {
        let x = r[ROW_CELL[k]];
        if (BOOL_COL[k]) x = x === true;
        else if (["lifetime", "last_gift_amount"].includes(k)) x = x == null ? null : Number(x);
        else if (["added", "last_gift_date", "first_gift_date"].includes(k)) x = x == null ? null : (x instanceof Date ? require("./orgTime").civilOf(x) : String(x)).slice(0, 10);
        cell[k] = x ?? null;
      }
    }
  }
  return out;
}

// ── SORT ───────────────────────────────────────────────────────────────────
function sortSql(key, dir) {
  const f = BY_KEY.get(key);
  if (!f || !f.sort) return null;
  return `${f.sort} ${dir === "asc" ? "ASC" : "DESC"} NULLS LAST, id`;
}

// ── LAYOUTS ────────────────────────────────────────────────────────────────
// Keep what is a known column (name first, always), drop the rest.
function cleanLayout(body, known) {
  const b = body && typeof body === "object" ? body : {};
  const cols = Array.isArray(b.columns) ? b.columns.map(String).filter(k => known.has(k)) : [];
  const columns = ["name", ...[...new Set(cols)].filter(k => k !== "name")].slice(0, 40);
  const widths = {};
  if (b.widths && typeof b.widths === "object") for (const [k, w] of Object.entries(b.widths)) {
    const n = Math.round(Number(w));
    if (known.has(k) && n >= 60 && n <= 800) widths[k] = n;
  }
  const pageSize = PAGE_SIZES.includes(Number(b.pageSize)) ? Number(b.pageSize) : 50;
  return { columns, widths, pageSize };
}
const asJson = v => (typeof v === "string" ? JSON.parse(v) : v);
async function layoutFor(orgId, userId) {
  const rows = await query(`SELECT user_id, columns, widths, page_size FROM donor_list_layouts WHERE org_id = ? AND user_id IN (?, '')`, [orgId, userId]);
  const pick = rows.find(r => r.user_id === userId) || rows.find(r => r.user_id === "");
  if (!pick) return { columns: DEFAULT_COLUMNS, widths: {}, pageSize: 50, source: "default" };
  return { columns: asJson(pick.columns), widths: asJson(pick.widths) || {}, pageSize: pick.page_size, source: pick.user_id === "" ? "org" : "mine" };
}
async function saveLayout(orgId, userId, layout, who) {
  await query(`INSERT INTO donor_list_layouts (org_id, user_id, columns, widths, page_size, created_by, created_by_name, updated_at)
               VALUES (?, ?, ?::jsonb, ?::jsonb, ?, ?, ?, NOW())
               ON CONFLICT (org_id, user_id) DO UPDATE SET columns = EXCLUDED.columns, widths = EXCLUDED.widths,
                 page_size = EXCLUDED.page_size, updated_at = NOW()`,
    [orgId, userId, JSON.stringify(layout.columns), JSON.stringify(layout.widths), layout.pageSize, who.id, who.name]);
}

module.exports = { GROUPS, DEFAULT_COLUMNS, PAGE_SIZES, FIELDS, fieldsFor, publicField, parseWhere, compileWhere, whereSentence,
  cellsFor, sortSql, cleanLayout, layoutFor, saveLayout, THIS_YEAR_SQL, PLEDGE_BALANCE_SQL };
