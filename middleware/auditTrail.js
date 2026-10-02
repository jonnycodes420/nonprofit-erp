// middleware/auditTrail.js — FIX-11 Part 1. THE ONE AUDIT WRITE.
//
// Mounted once, before every router in server.js, so there is exactly one
// place in the application that records who changed what. A route does not
// opt in. A route added after today is logged with its author doing nothing,
// which is the only arrangement under which "everything leaves a trail" stays
// true for longer than one build.
//
// WHAT IT DOES, per request:
//   1. For a mutating method, works out from the matched route PATTERN what
//      record is being touched (auditTrail.describeRoute).
//   2. If that record is a row in a real table with an id and an org, reads
//      the row BEFORE the handler runs, and reads it again after. The diff is
//      the before/after on the row. No route writes that by hand, and no
//      route can forget it.
//   3. Captures the handler's JSON response so a CREATE can name the record
//      it made and link to it.
//   4. On finish, writes ONE row. Bulk writers replace it with one summary
//      row via req.audit.summary(); nobody writes one row per record.
//   5. A download of donor data is a GET, and a download is a disclosure, so
//      any response that sets Content-Disposition: attachment is logged too.
//      That is the shared seam every export already passes through.
//
// It never throws into a request. An audit write that fails is logged loudly
// to stderr and the request still succeeds: refusing a donor's gift because
// the history table was unhappy would be the worse failure. What it must
// never do is succeed silently while writing nothing, so the one test drives
// real routes and reads the rows back.
const { AsyncLocalStorage } = require("node:async_hooks");
const { query, run, uuid } = require("../db");
const A = require("../auditTrail");

// ── THE THIRTY-THREE CALLS THAT WERE ALREADY THERE ────────────────────────
// Before this build, thirty-three routes called `writeAuditLog(...)` by hand.
// They are not deleted, because several of them KNOW something the route
// pattern cannot: that this POST was an "api_key_created" rather than a
// generic create, that this one chose an OAuth tenant. What is deleted is
// their second row: `writeAuditLog` now finds the request it is inside and
// IMPROVES the row the middleware is already going to write, instead of
// inserting another one beside it. One action, one row, and the better name
// wins.
//
// It is an AsyncLocalStorage rather than a parameter because those calls sit
// deep inside handlers that never took a `req` and should not start to. A
// call made outside any request (a background sweep) finds no store and
// inserts directly, which is exactly what a sweep should do.
const auditContext = new AsyncLocalStorage();

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// What an id looks like in this application: a short prefix, a separator and
// a hex-ish tail (`g_dcdff6e6`, `ff_5bdf943c`, `ak_2cf46c17-7f8`), or a uuid,
// or a bare number. Deliberately narrow: a false positive here would make the
// middleware read a word like "role" as a record id.
const ID_SHAPE = /^(?:[A-Za-z]{1,10}[_-][A-Za-z0-9][A-Za-z0-9_-]{3,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+)$/;

// ── WHICH NAMES ARE REAL TABLES ───────────────────────────────────────────
// Read from the live catalogue once, not from a hand-kept map: a map is the
// thing that falls behind the schema. A table qualifies for the automatic
// before/after snapshot when it has both an `id` and an `org_id`, because
// those are exactly the two things needed to read one record safely inside
// one organisation.
let SNAPSHOTTABLE = null;
let snapshotLoad = null;

async function snapshottableTables() {
  if (SNAPSHOTTABLE) return SNAPSHOTTABLE;
  if (!snapshotLoad) {
    snapshotLoad = query(
      `SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name IN ('id','org_id')
        GROUP BY table_name HAVING COUNT(DISTINCT column_name) = 2`
    ).then(rows => {
      SNAPSHOTTABLE = new Set(rows.map(r => r.table_name));
      return SNAPSHOTTABLE;
    }).catch(e => {
      console.error("[audit] could not read the table catalogue:", e.message);
      return new Set();   // no snapshot; every row still gets written
    });
  }
  return snapshotLoad;
}

// WHICH TABLE A ROUTE'S RESOURCE NAME MEANS.
//
// Two translations and one surprise. The spelling: a URL uses dashes where
// the database uses underscores ("api-keys" is `api_keys`). The namespace:
// some routes are mounted under a prefix the table carries, so `/finance/
// funds` is `fin_funds`. And the surprise, found while verifying this: there
// is ALSO a table literally called `funds`, so the name alone is ambiguous
// and picking by name picked the wrong one — producing a row with no before
// and no after, silently, on every nested finance edit.
//
// So the name only proposes CANDIDATES, in order, and the caller settles it
// by reading the record: the right table is the one that actually holds this
// id in this organisation. That is two or three primary-key lookups on an
// edit route, and the answer is a fact rather than a guess.
function tableCandidates(resource, tables) {
  if (!resource) return [];
  const base = String(resource).replace(/-/g, "_");
  const out = [];
  const push = t => { if (t && tables.has(t) && !out.includes(t)) out.push(t); };
  // A prefixed table first: `/finance/funds` is far more likely to mean
  // `fin_funds` than `funds`, and when it does not, the read below says so.
  for (const cand of [base, A.singular(base)]) {
    if (!cand) continue;
    for (const t of tables) if (t.endsWith("_" + cand)) push(t);
  }
  push(base); push(base + "s"); push(base.replace(/y$/, "ies")); push(A.singular(base));
  return out;
}

// Kept as the single-answer form for callers that only need a name.
function tableFor(resource, tables) {
  const c = tableCandidates(resource, tables);
  return c.length ? c[0] : null;
}

// ── WHO ──────────────────────────────────────────────────────────────────
// In priority order, because a route that KNOWS who acted (an agent run a
// human approved, an import carrying a filename) is more honest than the
// session that happens to be on the request.
function resolveActor(req, desc) {
  if (req.auditActor && req.auditActor.name) {
    return { kind: req.auditActor.kind || "system", id: req.auditActor.id || null, name: req.auditActor.name };
  }
  // FIX-11 Part 6 tail — AN ACTION THE AGENT DRAFTED AND A PERSON APPROVED.
  // Both halves belong in the row: the model did the work and a named human
  // took responsibility for it. `req.auditApproverName` is the person's NAME,
  // looked up once by the middleware (an email reads as the software talking
  // to itself), falling back to the address when there is no name on file.
  if (desc && desc.agentApproved && req.user && req.user.userId) {
    const by = req.auditApproverName || req.user.email || req.user.userId;
    return { kind: "agent", id: "agent:approved_by:" + req.user.userId, name: `Agent, approved by ${by}` };
  }
  if (req.user && req.user.userId) {
    return { kind: "user", id: req.user.userId, name: req.user.email || req.user.userId };
  }
  if (req.apiKey) {
    return { kind: "api_key", id: "key:" + req.apiKey.id, name: `API key: ${req.apiKey.name || req.apiKey.id}` };
  }
  if (req.portal && req.portal.email) {
    return { kind: "donor", id: req.portal.accountId || null, name: `${req.portal.email} (donor portal)` };
  }
  if (desc && desc.system) return { kind: "system", id: "system:" + desc.system, name: desc.system };
  // A sign-in attempt has no session by definition, so the address that was
  // typed is the only honest actor name there is — and a row saying "a wrong
  // password for dana@… at 09:12" is the whole point of logging failures.
  if (desc && desc.actorFromBody && req.body && req.body[desc.actorFromBody]) {
    return { kind: "anonymous", id: null, name: String(req.body[desc.actorFromBody]).slice(0, 200) };
  }
  return { kind: "system", id: "system:" + (req.path || "unknown"), name: "System" };
}

// A SIGN-IN THAT FAILED has no session by definition, so there is no org on
// the request to file it under — and "a wrong password for dana@… at 09:12" is
// one of the rows an audit log most exists to hold. The address that was typed
// is the only thing the request carries, so the org is looked up from it.
// A wrong address matches nobody and is deliberately recorded nowhere: there
// is no organisation it belongs to, and inventing one would put a stranger's
// typo in somebody's history.
async function orgFromLoginEmail(email) {
  if (!email) return null;
  try {
    const rows = await query(
      "SELECT org_id FROM users WHERE LOWER(email) = LOWER(?) AND deactivated_at IS NULL LIMIT 1",
      [String(email).trim()]);
    return rows.length ? rows[0].org_id : null;
  } catch { return null; }
}

function orgOf(req, responseBody) {
  if (req.user && req.user.orgId) return req.user.orgId;
  if (req.apiKey && req.apiKey.orgId) return req.apiKey.orgId;
  if (req.portal && req.portal.org && req.portal.org.id) return req.portal.org.id;
  if (req.auditOrgId) return req.auditOrgId;
  if (responseBody && typeof responseBody === "object") {
    if (responseBody.orgId) return responseBody.orgId;
    if (responseBody.org_id) return responseBody.org_id;
    if (responseBody.org && responseBody.org.id) return responseBody.org.id;
  }
  return null;
}

// The id of the record the request touched. From the response first (a create
// knows the id it just made), then from the route's own id param.
function resolveEntityId(req, desc, responseBody) {
  const b = responseBody;
  if (b && typeof b === "object" && !Array.isArray(b)) {
    const nested = desc.entity && b[desc.entity.replace(/ /g, "_")];
    if (nested && nested.id) return String(nested.id);
    for (const k of ["id", "giftId", "donorId", "recordId"]) {
      if (b[k] && typeof b[k] !== "object") return String(b[k]);
    }
    for (const k of Object.keys(b)) {
      if (b[k] && typeof b[k] === "object" && b[k].id && !Array.isArray(b[k])) return String(b[k].id);
    }
  }
  if (desc.idParam && req.params && req.params[desc.idParam]) return String(req.params[desc.idParam]);
  return null;
}

async function readRow(table, id, orgId) {
  if (!table || !id || !orgId) return null;
  try {
    const rows = await query(`SELECT * FROM ${table} WHERE id = ? AND org_id = ?`, [id, orgId]);
    return rows.length ? rows[0] : null;
  } catch (e) {
    // A table whose id column is not text, a composite key, a view: the row
    // is still written, just without before/after.
    return null;
  }
}

// ── THE WRITE ────────────────────────────────────────────────────────────
// ONE insert, and the only place in the application that inserts an audit row
// for a request. The DB trigger (db.js) refuses UPDATE and DELETE on this
// table, so a row written here is a row that stays written.
// ── FIX-12 Part 4 · A PERSON IS AN ID IN THIS LOG, NOT A NAME ─────────────
// The log is append-only, so a name written into it can never be taken out
// again, and a person who asks to be erased is erased everywhere but here. So
// from FIX-12 a row stores WHO by id and the screen looks the name up when it
// is read (resolveAuditNames below): a person erased later reads as "Erased
// person", and nothing in the row has to change for that to be true.
//   · the actor: a staff user's id, with no name or address beside it;
//   · the record's label, when the record is a person;
//   · person fields inside before/after (names, addresses, emails, phones)
//     say only that they changed, the same way a secret does.
// Rows written before FIX-12 keep their text; the trigger forbids rewriting them.
const PERSON_ENTITY_RE = /^(donor|person|people|user|volunteer|member|contact|guest|attendee|household|organisation|organization)s?$/i;
const PERSON_FIELD_RE = /(^|_)(email|email2|email_address|phone|phone2|mobile|address|address1|address2|address_line1|address_line2|street|street_address|postcode|postal_code|zip)$|^(first|last|middle|full|preferred|legal|display|donor|payer|attendee|member|contact|recipient|billing|honoree|tribute|spouse|partner|logged_by|created_by|reviewed_by|sent_by|assigned_to)_?name$|^(salutation|addressee|informal_name|formal_name|spouse)$/i;
const PERSON_MARK = "[person]";
function stripPeople(obj, personRow, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 6) return obj;
  if (Array.isArray(obj)) return obj.map(v => stripPeople(v, personRow, depth + 1));
  const out = {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if ((PERSON_FIELD_RE.test(k) || (personRow && /^name$/i.test(k))) && typeof v === "string" && v !== "") {
      out[k] = PERSON_MARK; continue;
    }
    out[k] = (v && typeof v === "object") ? stripPeople(v, personRow, depth + 1) : v;
  }
  return out;
}
async function personScrub(fields) {
  const f = { ...fields };
  const personRow = PERSON_ENTITY_RE.test(String(f.entityType || ""));
  if (f.actorKind === "user") f.actorName = null;
  else if (f.actorKind === "agent") f.actorName = "Agent";                       // id carries the approver
  else if (f.actorKind === "donor") f.actorName = "A donor, through the portal";
  else if (f.actorKind === "anonymous" && f.actorName && /@/.test(f.actorName)) {
    // A failed sign-in names the address typed. It is somebody's address, so
    // the row keeps their user id when there is one, and never the address.
    try {
      const [u] = await query("SELECT id FROM users WHERE LOWER(email)=LOWER(?) AND org_id=?", [f.actorName.trim(), f.orgId]);
      f.actorId = u ? u.id : null;
    } catch { f.actorId = null; }
    f.actorName = f.actorId ? null : "An address with no account here";
    if (f.actorId) f.actorKind = "user";
  }
  if (personRow && f.entityId) f.entityLabel = null;
  else if (f.entityLabel && /@/.test(f.entityLabel)) f.entityLabel = null;
  f.changes = stripPeople(f.changes, personRow);
  f.before = stripPeople(f.before, personRow);
  f.after = stripPeople(f.after, personRow);
  return f;
}

// The read side of the same rule: fill in each row's names from the live
// records, as the screen asks for them. A donor erased since reads "Erased
// person"; one deleted outright reads "A person no longer in Steward".
async function resolveAuditNames(rows, orgId) {
  if (!rows || !rows.length) return rows;
  const userIds = new Set(), personIds = new Set();
  for (const r of rows) {
    if (!r.user_name && r.user_id && !String(r.user_id).startsWith("system:")) {
      userIds.add(String(r.user_id).replace(/^agent:approved_by:/, ""));
    } else if (r.actor_kind === "agent" && r.user_id) userIds.add(String(r.user_id).replace(/^agent:approved_by:/, ""));
    if (!r.entity_label && r.entity_id && PERSON_ENTITY_RE.test(String(r.entity_type || ""))) personIds.add(String(r.entity_id));
  }
  const users = new Map(), people = new Map();
  if (userIds.size) {
    const us = await query("SELECT id, name, email FROM users WHERE org_id=? AND id = ANY(?)", [orgId, [...userIds]]).catch(() => []);
    for (const u of us) users.set(u.id, u.name || u.email);
  }
  if (personIds.size) {
    const ds = await query("SELECT id, name, erased_at FROM donors WHERE org_id=? AND id = ANY(?)", [orgId, [...personIds]]).catch(() => []);
    for (const d of ds) people.set(d.id, d.erased_at ? "Erased person" : (d.name || "A person with no name"));
    const us = await query("SELECT id, name, email FROM users WHERE org_id=? AND id = ANY(?)", [orgId, [...personIds]]).catch(() => []);
    for (const u of us) if (!people.has(u.id)) people.set(u.id, u.name || u.email);
  }
  return rows.map(r => {
    const out = { ...r };
    if (r.actor_kind === "agent" && r.user_id) {
      const uid = String(r.user_id).replace(/^agent:approved_by:/, "");
      if (!r.user_name || r.user_name === "Agent") out.user_name = `Agent, approved by ${users.get(uid) || "a former team member"}`;
    } else if (!r.user_name && r.user_id) {
      out.user_name = users.get(String(r.user_id)) || "A former team member";
    }
    if (!r.entity_label && r.entity_id && PERSON_ENTITY_RE.test(String(r.entity_type || ""))) {
      out.entity_label = people.get(String(r.entity_id)) || "A person no longer in Steward";
    }
    return out;
  });
}

async function insertAuditRow(rawFields) {
  const fields = await personScrub(rawFields);
  const id = "al_" + uuid().slice(0, 12);
  await run(
    `INSERT INTO fin_audit_log
       (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id, entity_label,
        changes, before_fields, after_fields, summary, record_count, request_method, request_path, status_code, ip)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, fields.orgId, fields.actorId, fields.actorName, fields.actorKind, fields.action,
     fields.entityType, fields.entityId, fields.entityLabel,
     JSON.stringify(fields.changes || {}),
     fields.before ? JSON.stringify(fields.before) : null,
     fields.after ? JSON.stringify(fields.after) : null,
     fields.summary || null, fields.recordCount == null ? null : fields.recordCount,
     fields.method, fields.path, fields.status, fields.ip || null]
  );
  return id;
}

// ── IS THIS REQUEST LOGGED? ──────────────────────────────────────────────
// Exported so the route-inventory test can ask the same question of every
// route in the live router WITHOUT calling it: the test and the middleware
// read one function, so a route the test believes is covered is covered.
function coversRoute(method, pattern) {
  const m = String(method || "").toUpperCase();
  if (!MUTATING.has(m)) return { covered: false, reason: "not a mutating method" };
  const desc = A.describeRoute(m, pattern);
  if (desc.readOnly) return { covered: false, reason: "declared read-only in auditTrail.READ_ONLY_POSTS" };
  return { covered: true, desc };
}

function auditTrail(opts = {}) {
  const enabled = opts.enabled !== false;

  return function auditTrailMiddleware(req, res, next) {
    if (!enabled) return next();

    const method = String(req.method || "").toUpperCase();
    const mutating = MUTATING.has(method);
    // A download is a disclosure. Every export in the app sets
    // Content-Disposition on the way out, so that header is the one seam a
    // new export cannot be written without passing through.
    const maybeDownload = method === "GET" || method === "HEAD";
    if (!mutating && !maybeDownload) return next();

    let responseBody = null;
    let skipped = null;
    let extra = {};          // what a route chose to say about this change
    let summaryRow = null;   // a bulk writer's one row
    let doneOnce = false;

    // The handle a route uses when it knows more than the pattern does. Every
    // method here IMPROVES the row the middleware is already going to write;
    // none of them creates one, so forgetting to call them costs detail and
    // never costs the row.
    req.audit = {
      skip(reason) { skipped = reason || "route asked"; },
      before(row) { extra.before = row; },
      after(row) { extra.after = row; },
      entity(type, id, label) { extra.entityType = type; extra.entityId = id; if (label) extra.entityLabel = label; },
      label(text) { extra.entityLabel = text; },
      action(verb) { extra.action = verb; },
      org(orgId) { req.auditOrgId = orgId; },
      actor(a) { req.auditActor = a; },
      // ONE row for a bulk action, naming the records it touched. "Imported
      // 243 gifts, $240,853, from bookkeeper.csv" is one line of history; two
      // hundred and forty-three lines is a wall nobody reads.
      summary(text, meta = {}) {
        summaryRow = { text: String(text || ""), meta: meta || {} };
        if (meta.count != null) extra.recordCount = meta.count;
        if (meta.entityType) extra.entityType = meta.entityType;
      },
    };

    const desc = mutating ? A.describeRoute(method, (req.route && req.route.path) || req.path) : null;

    const origJson = res.json.bind(res);
    res.json = body => { responseBody = body; return origJson(body); };

    // THE BEFORE-SNAPSHOT, and the one subtle thing in this file.
    //
    // It has to be read BEFORE the handler runs, which means before
    // requireAuth has run, which means there is no req.user and therefore no
    // organisation to scope the read to. The first version of this scoped it
    // to orgOf(req) anyway, got null every time, and quietly recorded no
    // before/after on a single edit in the application — green, and empty.
    //
    // So the row is read by PRIMARY KEY alone, and the organisation is checked
    // at finish time against the org the request turned out to belong to. A
    // row that belongs to somebody else is dropped rather than reported, so
    // reading it early can never disclose it.
    const pending = (async () => {
      if (!mutating || method === "POST") return null;   // a create has no before
      const tables = await snapshottableTables();
      // WHICH SEGMENT IS THE ID. Read from the right, because `/gifts/:id`,
      // `/finance/funds/:id` and `/users/:id/role` all put the resource
      // immediately in front of the id and nowhere else predictable. Taking
      // segment 0 as the resource and segment 1 as the id — which is what the
      // first version did — read `/finance/funds/ff_x` as table "finance",
      // id "funds", and recorded no before/after on any nested route in the
      // application. It was invisible: every row still appeared, just empty.
      const segs = req.path.split("/").filter(Boolean);
      for (let i = segs.length - 1; i >= 1; i--) {
        if (!ID_SHAPE.test(segs[i])) continue;
        const cands = tableCandidates(segs[i - 1], tables);
        if (!cands.length) continue;
        for (const table of cands) {
          try {
            const rows = await query(`SELECT * FROM ${table} WHERE id = ?`, [segs[i]]);
            if (rows.length) return { table, id: segs[i], row: rows[0] };
          } catch { /* not this table's shape */ }
        }
        // The name matched tables and none of them holds this id: the row is
        // gone, or the route reads something else. Remember the table so the
        // after-read has somewhere to look.
        return { table: cands[0], id: segs[i], row: null };
      }
      return null;
    })().catch(() => null);

    const finish = async () => {
      if (doneOnce) return;
      doneOnce = true;
      try {
        const status = res.statusCode;
        const pattern = (req.route && req.route.path) || req.path;

        if (!mutating) {
          // A download, and only a download.
          const cd = res.getHeader("Content-Disposition") || "";
          if (!/attachment/i.test(String(cd))) return;
          if (status >= 400) return;
          const orgId = orgOf(req, null);
          if (!orgId) return;
          const who = resolveActor(req, null);
          const file = (String(cd).match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i) || [])[1] || "a file";
          await insertAuditRow({
            orgId, actorId: who.id, actorName: who.name, actorKind: who.kind,
            action: "downloaded", entityType: "export", entityId: null, entityLabel: file,
            summary: `${file}${req.originalUrl && req.originalUrl.includes("?") ? " (" + req.originalUrl.split("?")[1].slice(0, 200) + ")" : ""}`,
            method, path: req.originalUrl || req.path, status, ip: req.ip,
          });
          return;
        }

        const d = A.describeRoute(method, pattern);
        if (d.readOnly) return;
        if (skipped) return;
        // A REPLAYED WRITE CHANGED NOTHING, so a row saying it created a gift
        // would be a false record — and a false record in an audit log is
        // worse than a missing one. `duplicate: true` is this codebase's
        // existing answer for an idempotent write that was replayed
        // (recordGift returns exactly that), so it is the signal, and the
        // three next to it are the same statement in other words.
        if (responseBody && typeof responseBody === "object"
            && (responseBody.duplicate === true || responseBody.noop === true
                || responseBody.unchanged === true || responseBody.alreadyDone === true)) return;
        // A refusal is history too, but only where the refusal itself is the
        // security event: a wrong password, a reset that was attempted. A 404
        // on every other route is noise, and noise is what makes a log unread.
        if (status >= 400 && !d.logFailures) return;

        let orgId = orgOf(req, responseBody);
        if (!orgId && d.actorFromBody && req.body && req.body[d.actorFromBody]) {
          orgId = await orgFromLoginEmail(req.body[d.actorFromBody]);
        }
        // The approver's NAME, read once and only where the row will carry it.
        if (d.agentApproved && req.user && req.user.userId) {
          try {
            const [u] = await query("SELECT name FROM users WHERE id=? AND org_id=?",
              [req.user.userId, orgId]);
            if (u && u.name) req.auditApproverName = u.name;
          } catch { /* the address is a fine fallback */ }
        }
        const who = resolveActor(req, d);
        const entityId = extra.entityId !== undefined ? extra.entityId : resolveEntityId(req, d, responseBody);
        const entityType = extra.entityType || d.entity;

        // AFTER: the row as it now stands, read back rather than guessed from
        // the request body — a request body says what was asked for, and the
        // row says what happened.
        let before = extra.before !== undefined ? extra.before : null;
        let after = extra.after !== undefined ? extra.after : null;
        if (before === null || after === null) {
          const tables = await snapshottableTables();
          const snap = await pending;
          // Only this organisation's row. The early read had no org to scope
          // to (see the note on `pending`), so the check is here.
          if (before === null && snap && snap.row
              && (!snap.row.org_id || snap.row.org_id === orgId)) before = snap.row;
          // The after-read settles its table the same way: by which one holds
          // the record. A create has no snapshot to inherit a table from.
          if (after === null && orgId && entityId) {
            const cands = (snap && snap.table ? [snap.table] : [])
              .concat(tableCandidates(d.created, tables))
              .concat(tableCandidates(d.resource, tables));
            for (const t of cands) {
              const row = await readRow(t, entityId, orgId);
              if (row) { after = row; break; }
            }
          }
        }

        // A CREATE HAS NOTHING BEFORE IT, and diffing the new row against
        // nothing produces a "change" on every column, which reads as though
        // forty fields were edited. So a create is not diffed — but it still
        // carries the record it made (the browser walk found the first version
        // of this showing nothing at all for a create, which makes a created
        // $100,000 gift a row with no amount in it). A DELETE is the mirror:
        // everything it was, and nothing after.
        const isCreate = method === "POST" && !before;
        const isDelete = method === "DELETE";
        const changed = (isCreate || isDelete) ? null : A.diffFields(before, after);

        // ONE ROW FOR A BULK ACTION. Derived from the response the route
        // already returns, so an import added later gets its summary without
        // anybody remembering to write one. A route that said it better wins.
        let bulk = summaryRow;
        if (!bulk && d.bulk) {
          const auto = A.bulkSummary(d, responseBody, req.body);
          if (auto) { bulk = { text: auto.text }; if (extra.recordCount == null) extra.recordCount = auto.count; }
        }
        const action = extra.action || d.action;
        const label = extra.entityLabel
          || (after && (after.name || after.title || after.email))
          || (before && (before.name || before.title || before.email))
          || null;

        // WITHOUT AN ORG there is nowhere honest to file this row: the audit
        // log is scoped to an organisation, and a row in the wrong one is
        // worse than a row that says so. Loud rather than silent.
        if (!orgId) {
          if (status < 400) console.error(`[audit] no org on a successful ${method} ${pattern} — not logged`);
          return;
        }

        await insertAuditRow({
          orgId,
          actorId: who.id, actorName: who.name, actorKind: who.kind,
          action: status >= 400 ? (d.actionRefused || `${action} (refused)`) : action,
          entityType, entityId, entityLabel: label,
          // What a legacy `writeAuditLog(...)` call said about this change,
          // alongside the before/after the middleware read off the row.
          changes: { ...(changed || {}), ...(req.auditLegacyChanges || {}) },
          before: changed ? changed.before : (isCreate ? null : (before ? A.redact(before) : null)),
          after: changed ? changed.after : (isDelete ? null : (after ? A.redact(after) : null)),
          // isCreate keeps `after`; isDelete keeps `before`. Both are the
          // record, redacted, because for those two actions the record IS the
          // change and there is no other copy of it in the log.
          summary: bulk ? bulk.text : null,
          recordCount: extra.recordCount,
          method, path: req.originalUrl || req.path, status, ip: req.ip,
        });
      } catch (e) {
        console.error("[audit] CRITICAL: a change was not recorded:", req.method, req.originalUrl, e.message);
      }
    };

    res.on("finish", () => { finish(); });
    auditContext.run({ req }, next);
  };
}

// What `writeAuditLog(...)` does when it is inside a request: nothing is
// inserted, the row already on its way is improved. Returns false when there
// is no request to improve, which is the signal to insert directly.
function enrichFromLegacyCall(orgId, userId, userName, action, entityType, entityId, changes) {
  const store = auditContext.getStore();
  const req = store && store.req;
  if (!req || !req.audit) return false;
  if (action) req.audit.action(String(action).replace(/_/g, " "));
  if (entityType) req.audit.entity(String(entityType).replace(/_/g, " "), entityId === undefined ? null : entityId);
  if (orgId) req.audit.org(orgId);
  if (userName && !(req.user && req.user.userId)) req.audit.actor({ kind: "system", id: userId || null, name: userName });
  if (changes && Object.keys(changes).length) req.auditLegacyChanges = { ...(req.auditLegacyChanges || {}), ...changes };
  return true;
}

module.exports = {
  auditTrail, coversRoute, snapshottableTables, tableFor, tableCandidates, resolveActor, MUTATING,
  auditContext, enrichFromLegacyCall, insertAuditRow, resolveAuditNames, personScrub,
};
