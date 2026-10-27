// routes/sheetImport.js · IMPORT-3. ANY SPREADSHEET, READ THE WAY A PERSON WOULD.
//
//   POST /sheet-import/understand   what Steward understood: the tables, each
//                                   column, every row's fate, the people new
//                                   and matched, the questions. Writes nothing.
//   POST /sheet-import/commit       writes exactly that plan, every row tagged
//                                   with the run, so POST /imports/:id/reverse
//                                   (shape "sheet") undoes the whole file.
//
// The judgement is shared/sheetRead.js, so what she reads and what is written
// are one plan. Money goes through recordGift and nowhere else; the amounts
// come from the cells. With the AI switch on, a model may PROPOSE what an
// unplaced column is; its proposal is checked against every row like any
// other mapping, and it never sees more than the headers and eight rows.
// A second import of the same file adds nothing: every gift and pledge carries
// a key made from its own row.
"use strict";
const express = require("express");

const routers = { r0: express.Router() };
const RUN_ID_RE = /^imp_[A-Za-z0-9_-]{4,40}$/;
const MAX_ROWS = 20000, MAX_SHEETS = 40, MAX_COLS = 120;
const MAPPING_MODEL = "claude-haiku-4-5-20251001";

function mount(ctx) {
const { query, run, requireAuth, checkWriteAccess, wrap, uuid, actor, recordGift, recalcPledgePayment,
        withAdvisoryLock, aiGate, anthropicFor, recordAiFallback } = ctx;
const app = routers.r0;
const R = () => import("../shared/sheetRead.js");
// CHECK-2's one matcher (email; names against the same last name, with
// initials and nicknames; household; street or ZIP). A person is made new only
// when it says "none".
const DM = require("../donorMatch");
const PM = require("../personMatch");

function readBody(b) {
  b = b || {};
  const sheets = (Array.isArray(b.sheets) ? b.sheets : []).slice(0, MAX_SHEETS).map(sh => ({
    name: String((sh && sh.name) || "Sheet").slice(0, 80),
    grid: (Array.isArray(sh && sh.grid) ? sh.grid : []).slice(0, MAX_ROWS).map(r => (Array.isArray(r) ? r.slice(0, MAX_COLS) : [])
      .map(c => (c == null ? null : typeof c === "number" || typeof c === "boolean" ? c : String(c).slice(0, 500)))),
  }));
  const obj = v => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  return { sheets, fileName: String(b.fileName || "").slice(0, 200), overrides: obj(b.overrides), answers: obj(b.answers),
           useModel: b.useModel !== false };
}

// A model's proposal for the columns the rules could not place. Only those
// columns, only a role each; applyOverrides refuses a role the cells refute.
async function modelOverrides(orgId, sheets, u, Rm) {
  const unplaced = (u.help || []).filter(h => h.kind === "column");
  if (!unplaced.length) return { overrides: {}, used: false };
  const gate = await aiGate(orgId).catch(() => ({ ok: false }));
  if (!gate.ok) return { overrides: {}, used: false, off: true };
  const out = {};
  try {
    for (const { key, table } of Rm.tablesForModel(sheets)) {
      const mine = unplaced.filter(h => h.key.startsWith(key + "|"));
      if (!mine.length) continue;
      const msg = await anthropicFor(orgId).messages.create({
        model: MAPPING_MODEL, max_tokens: 600,
        system: "You read the column headers and first rows of a nonprofit's spreadsheet and say what each listed column is. Never invent amounts.",
        tools: [{ name: Rm.MAPPING_TOOL.name, description: Rm.MAPPING_TOOL.description, strict: true, input_schema: Rm.MAPPING_TOOL.input_schema }],
        tool_choice: { type: "tool", name: Rm.MAPPING_TOOL.name },
        messages: [{ role: "user", content: Rm.modelPrompt(table) + `\n\nOnly these column indexes: ${mine.map(h => h.key.split("|")[1]).join(", ")}.` }],
      });
      const use = (msg.content || []).find(c => c.type === "tool_use");
      for (const c of (use && use.input && use.input.columns) || []) {
        if (mine.some(h => h.key === `${key}|${c.index}`)) out[`${key}|${c.index}`] = c.role;
      }
    }
  } catch (e) {
    console.error("[sheet-import] model mapping:", e && e.status ? e.status : (e && e.message));
    await recordAiFallback?.(orgId, "sheet_import_mapping", e)?.catch?.(() => {});
    return { overrides: {}, used: false };
  }
  return { overrides: out, used: Object.keys(out).length > 0 };
}

// FIX-52 · THE ORG'S PEOPLE, READ ONCE. CHECK-2's matcher is still the one
// matcher, but it can only say "matched" or "choices" for a name when some
// record here shares its email, its ID, or one of its words (its last-name
// search is a LIKE on the name, the spouse and the household). A file of 450
// new people asked it 450 times, twice (preview and commit), several queries
// each; against a remote database that was most of the two minutes. A name
// with nothing to find goes straight to "new".
async function orgPeopleIndex(orgId) {
  const rows = await query(
    `SELECT d.id, LOWER(COALESCE(d.name,'')) AS name, LOWER(TRIM(COALESCE(d.email,''))) AS email, LOWER(COALESCE(d.spouse_name,'')) AS spouse,
            LOWER(COALESCE(h.name,'')) AS hh, LOWER(COALESCE(d.external_donor_id,'')) AS ext, d.external_donor_ids AS exts
       FROM donors d LEFT JOIN households h ON h.id = d.household_id AND h.org_id = d.org_id
      WHERE d.org_id=? AND d.deleted_at IS NULL`, [orgId]);
  const emails = new Set(), ids = new Map(), text = [];
  for (const r of rows) {
    if (r.email) emails.add(r.email);
    if (r.ext && !ids.has(r.ext)) ids.set(r.ext, r.id);
    let more = r.exts;
    if (typeof more === "string") { try { more = JSON.parse(more); } catch { more = []; } }
    for (const x of Array.isArray(more) ? more : []) { const k = String(x).toLowerCase(); if (k && !ids.has(k)) ids.set(k, r.id); }
    text.push(`${r.name}|${r.spouse}|${r.hh}`);
  }
  const blob = text.join("\n");
  return {
    idFor: x => (x ? ids.get(String(x).toLowerCase()) || null : null),
    mightMatch(email, name) {
      if (email && emails.has(String(email).trim().toLowerCase())) return true;
      const words = String(name || "").toLowerCase().split(/[^a-z0-9'’-]+/).filter(w => w.length >= 2);
      return words.some(w => blob.includes(w));
    },
  };
}

// FIX-54 · SOMEONE YOU DELETED STAYS DELETED. The matcher reads only the
// people still here, so a file naming a person she deleted made them again as
// "new". Every name the matcher calls new is asked of the people she deleted
// (by the old system's ID, the email, then the exact name); a record that
// matches one is not imported, and the preview says so with a Bring them back
// she has to press. A record merged into another is not a deletion.
async function deletedPeopleIndex(orgId) {
  const rows = await query(
    `SELECT d.id, d.name, LOWER(TRIM(COALESCE(d.name,''))) AS lname, LOWER(TRIM(COALESCE(d.email,''))) AS email,
            LOWER(COALESCE(d.external_donor_id,'')) AS ext, d.external_donor_ids AS exts
       FROM donors d
      WHERE d.org_id=? AND d.deleted_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM donor_merges m WHERE m.org_id=d.org_id AND m.merged_id=d.id AND m.undone_at IS NULL)`, [orgId]);
  const byExt = new Map(), byEmail = new Map(), byName = new Map();
  for (const r of rows) {
    let more = r.exts;
    if (typeof more === "string") { try { more = JSON.parse(more); } catch { more = []; } }
    for (const x of [r.ext, ...(Array.isArray(more) ? more : [])]) { const k = String(x || "").toLowerCase(); if (k && !byExt.has(k)) byExt.set(k, r); }
    if (r.email && !byEmail.has(r.email)) byEmail.set(r.email, r);
    if (r.lname && !byName.has(r.lname)) byName.set(r.lname, r);
  }
  return {
    find({ externalId, email, name }) {
      const ext = externalId && byExt.get(String(externalId).toLowerCase());
      if (ext) return { id: ext.id, name: ext.name, by: "the ID in your file" };
      const em = email && byEmail.get(String(email).trim().toLowerCase());
      if (em) return { id: em.id, name: em.name, by: "email" };
      const nm = name && byName.get(String(name).trim().toLowerCase());
      if (nm) return { id: nm.id, name: nm.name, by: "the same name" };
      return null;
    },
  };
}

// Who each record in the file is in this org: matched, new, or a question.
async function matchPeople(orgId, u, answers, privacy) {
  const out = new Map();
  const picks = (answers && answers.people) || {};
  const deletedPicks = (answers && answers.deletedPeople) || {};
  const idx = await orgPeopleIndex(orgId);
  const gone = await deletedPeopleIndex(orgId);
  for (const p of u.people) {
    const names = p.people.length ? p.people.map(x => x.name) : [p.name];
    const members = [];
    for (const nm of names) {
      const pick = picks[`${p.key}|${nm}`];
      if (pick && pick !== "new") {
        const [d] = await query("SELECT id, name, is_client FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [pick, orgId]);
        if (d) { members.push({ name: nm, status: "matched", id: d.id, by: "you", isClient: d.is_client === true }); continue; }
      }
      if (pick === "new") { members.push({ name: nm, status: "new", id: null, by: "you" }); continue; }
      // TRANS-1: the old system's own id matches first, for the record it names
      if (p.externalId && nm === names[0] && idx.idFor(p.externalId)) {
        const [d] = await query(`SELECT id, is_client FROM donors WHERE org_id=? AND deleted_at IS NULL
                                    AND (LOWER(external_donor_id)=LOWER(?) OR COALESCE(external_donor_ids,'[]'::jsonb) @> ?::jsonb) LIMIT 2`,
          [orgId, p.externalId, JSON.stringify([p.externalId])]);
        if (d) { members.push({ name: nm, status: "matched", id: d.id, by: "the ID in your file", isClient: d.is_client === true }); continue; }
      }
      if (!idx.mightMatch(p.email, nm)) { members.push({ name: nm, status: "new", id: null }); continue; }
      const m = await DM.matchDonor(orgId, { email: p.email, name: nm, line1: p.address, postal: p.zip });
      if (m.state === "matched" && m.selectedId) {
        const [d] = await query("SELECT is_client FROM donors WHERE id=?", [m.selectedId]);
        members.push({ name: nm, status: "matched", id: m.selectedId, by: m.by || "name", isClient: !!(d && d.is_client === true) });
      } else if (m.state === "choices") members.push({ name: nm, status: "ambiguous", id: null, candidates: m.choices || [] });
      else {
        // A one-word name ("Arnold") is weak to CHECK-2 by design; the record
        // with exactly that name, when there is only one, is still that record.
        const exact = await PM.findPersonId(orgId, { email: p.email, name: nm });
        if (exact) {
          const [d] = await query("SELECT is_client FROM donors WHERE id=?", [exact]);
          members.push({ name: nm, status: "matched", id: exact, by: "the same name", isClient: !!(d && d.is_client === true) });
        } else members.push({ name: nm, status: "new", id: null });
      }
    }
    // FIX-54: a name the matcher calls new may be someone she deleted
    for (const [i, x] of members.entries()) {
      if (x.status !== "new" || x.by === "you") continue;
      const hit = gone.find({ externalId: i === 0 ? p.externalId : null, email: i === 0 ? p.email : null, name: x.name });
      if (!hit) continue;
      // HARDEN-1: a match by the name alone is a question, Same person by
      // default; "Different person" imports them as new. An ID or an email stays blocked.
      const nameOnly = hit.by === "the same name";
      if (nameOnly && deletedPicks[`${p.key}|${x.name}`] === "different") { members[i] = { ...x, deletedAsked: hit.id }; continue; }
      members[i] = { name: x.name, status: "deleted", id: null, deletedId: hit.id, deletedName: hit.name, by: hit.by, nameOnly };
    }
    // CLIENT-SAFE-1: a person marked as a client is never made a donor here.
    const client = privacy.on && (members.some(x => x.isClient || (x.id && privacy.clientIds.has(x.id))) || (p.email && privacy.clientEmails.has(p.email)));
    out.set(p.key, { members, client });
  }
  return out;
}

// IMPORT-4 · layers 4 and 5 on the people the import just placed: who was
// invited and who came, communication choices with where they came from, and
// every kept column as a custom field under its own header. Everything carries
// the run (event_attendees.import_id, interactions.import_id, the summary), so
// Undo takes it all back.
const ATT_CHUNK = 500;
const COMM_WORDS = { optOut: "Opted out of email", doNotContact: "Do not contact", doNotMail: "Do not mail", doNotCall: "Do not call",
                     doNotEmail: "Do not email", deceased: "Marked deceased" };
async function writeEngagement({ orgId, u, importId, eventId, personIds, who, summary, fileName, eventName }) {
  const today = ctx.orgToday(await ctx.orgTz(orgId).catch(() => null));
  // attendance, one row per person on the event
  if (eventId) {
    const have = new Set((await query("SELECT donor_id FROM event_attendees WHERE org_id=? AND event_id=? AND donor_id IS NOT NULL", [orgId, eventId])).map(r => r.donor_id));
    const rows = [];
    for (const p of u.people) {
      const at = p.attendance;
      if (!at || !(at.invited || at.rsvp != null || at.attended)) continue;
      const status = at.attended ? "attended" : at.rsvp === true ? "registered" : at.rsvp === false ? "declined" : "invited";
      const ids = personIds.get(p.key) || [];
      ids.forEach((id, i) => {
        if (have.has(id)) return;
        have.add(id);
        const memberName = (p.people[i] && p.people[i].name) || p.name;
        rows.push(["ea_" + uuid().slice(0, 10), eventId, orgId, id, memberName, i === 0 ? p.email : null, status, at.table || null,
                   i === 0 && at.party ? at.party : 1, "import", at.logistics.length ? at.logistics.join(". ") : null, importId]);
      });
    }
    for (let k = 0; k < rows.length; k += ATT_CHUNK) {
      const batch = rows.slice(k, k + ATT_CHUNK);
      await run(`INSERT INTO event_attendees (id,event_id,org_id,donor_id,name,email,status,table_label,quantity,source,notes,import_id)
                 VALUES ${batch.map(() => "(?,?,?,?,?,?,?,?,?,?,?,?)").join(",")}`, batch.flat());
    }
    summary.attendees = rows.length;
  }
  // communication choices: on the person, in the suppression list, and a line
  // on the timeline saying where each came from
  const ix = [];
  for (const p of u.people) {
    const ids = personIds.get(p.key) || [];
    for (const [k, words] of Object.entries(COMM_WORDS)) {
      const src = p.comms && p.comms[k];
      if (!src) continue;
      const where = `${src.file}, ${src.sheet ? src.sheet + " sheet, " : ""}"${src.header}": ${String(src.value).slice(0, 120)}`
        + (eventName && /event|rsvp|guest|mailing|sign/i.test(`${src.sheet} ${src.header}`) ? ` (${eventName})` : "");
      for (const id of ids) ix.push(["int_" + uuid().slice(0, 10), orgId, id, "note", `${words}. From your import: ${where}.`, today, who.id, who.name, importId,
        JSON.stringify({ source: "sheet-import", kind: "preference", preference: k, header: src.header, value: src.value, file: src.file })]);
    }
    if (p.comms && p.comms.optOut && p.email) {
      const em = p.email.toLowerCase();
      const [x] = await query("SELECT id FROM email_suppressions WHERE org_id=? AND LOWER(email)=?", [orgId, em]);
      if (!x) {
        const sid = "sup_" + uuid().slice(0, 10);
        await run("INSERT INTO email_suppressions (id, org_id, email, reason, source) VALUES (?,?,?,?,?)", [sid, orgId, em, "unsubscribed", `import:${importId}`]);
        summary.suppressions.push(sid);
      }
    }
  }
  // kept columns: one custom field per header (an existing field of that
  // name is reused), filled where the person has nothing yet. Past the
  // org's field limit a value is kept as a note on the person instead.
  const kept = u.keptHeaders || [];
  if (kept.length) {
    const { CF_LIMITS, generateFieldKey } = await import("../shared/customFieldShape.js");
    const CF = require("../customFields");
    const keyFor = new Map();
    for (const kh of kept) {
      const label = String(kh.header).trim().slice(0, CF_LIMITS.LABEL_MAX);
      const [def] = await query("SELECT id, key, type FROM custom_field_defs WHERE org_id=? AND entity='donor' AND archived_at IS NULL AND LOWER(label)=LOWER(?) LIMIT 1", [orgId, label]);
      if (def) { if (def.type === "text") keyFor.set(kh.header, def.key); continue; }
      const [{ n }] = await query("SELECT COUNT(*)::int AS n FROM custom_field_defs WHERE org_id=? AND entity='donor' AND archived_at IS NULL", [orgId]);
      if (n >= CF_LIMITS.FIELDS_PER_ENTITY) continue;
      const keys = (await query("SELECT key FROM custom_field_defs WHERE org_id=? AND entity='donor'", [orgId])).map(r => r.key);
      const key = generateFieldKey(label, keys);
      const [{ mp }] = await query("SELECT COALESCE(MAX(position),0) AS mp FROM custom_field_defs WHERE org_id=? AND entity='donor'", [orgId]);
      const id = "cfd_" + uuid().slice(0, 12);
      await run(`INSERT INTO custom_field_defs (id,org_id,entity,key,label,type,options,position,created_by,created_by_name,created_source)
                 VALUES (?,?,'donor',?,?,'text','[]',?,?,?,?)`, [id, orgId, key, label, (mp || 0) + 1, who.id, who.name, `import:${fileName}`.slice(0, 200)]);
      summary.customFieldsCreated.push(id);
      keyFor.set(kh.header, key);
    }
    const defs = await CF.loadDefs("donor", orgId);
    // FIX-52: what each person already holds, read once; written in batches below
    const holderIds = u.people.filter(p => Object.keys(p.kept || {}).length).map(p => (personIds.get(p.key) || [])[0]).filter(Boolean);
    const held = new Map((holderIds.length ? await query("SELECT id, custom_fields FROM donors WHERE org_id=? AND id = ANY(?)", [orgId, holderIds]) : []).map(r => [r.id, r]));
    const cfWrites = [];
    for (const p of u.people) {
      const entries = Object.entries(p.kept || {});
      if (!entries.length) continue;
      const id = (personIds.get(p.key) || [])[0];
      if (!id) continue;
      const vals = {}, notes = [];
      for (const [h, v] of entries) { const k = keyFor.get(h); if (k) vals[k] = String(v).slice(0, 2000); else notes.push(`${h}: ${v}`); }
      if (Object.keys(vals).length) {
        const r = await CF.validateCustomFields("donor", orgId, vals, { defs });
        const ok = Object.fromEntries(Object.entries(r.values).filter(([, v]) => v != null));
        for (const e of r.errors) notes.push(`${e.key}: ${e.raw}`);
        if (Object.keys(ok).length) {
          const cur = held.get(id);
          const have = (cur && cur.custom_fields) || {};
          const fresh = Object.fromEntries(Object.entries(ok).filter(([k]) => have[k] == null || have[k] === ""));
          if (Object.keys(fresh).length) {
            cfWrites.push([id, JSON.stringify(fresh)]);
            summary.customValuesSet.push({ donorId: id, keys: Object.keys(fresh), wasNull: !(cur && cur.custom_fields) });
          }
        }
      }
      if (notes.length) {
        ix.push(["int_" + uuid().slice(0, 10), orgId, id, "note", `From your import (${fileName}): ${notes.join("; ")}`.slice(0, 4000), today, who.id, who.name, importId,
          JSON.stringify({ source: "sheet-import", kind: "kept" })]);
        summary.keptAsNotes++;
      }
    }
    for (let k = 0; k < cfWrites.length; k += ATT_CHUNK) {
      const b = cfWrites.slice(k, k + ATT_CHUNK);
      await run(`UPDATE donors d SET custom_fields = v.cf::jsonb || COALESCE(d.custom_fields, '{}'::jsonb) FROM (VALUES ${b.map(() => "(?,?)").join(",")}) AS v(id, cf)
                  WHERE d.id = v.id AND d.org_id = ?`, [...b.flat(), orgId]);
    }
  }
  for (let k = 0; k < ix.length; k += ATT_CHUNK) {
    const batch = ix.slice(k, k + ATT_CHUNK);
    await run(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name,import_id,metadata)
               VALUES ${batch.map(() => "(?,?,?,?,?,?,?,?,?,?::jsonb)").join(",")}`, batch.flat());
  }
}

async function buildUnderstanding(req, body) {
  const orgId = req.user.orgId;
  const Rm = await R();
  const tz = await ctx.orgTz(orgId).catch(() => null);
  const today = ctx.orgToday(tz);
  let u = Rm.understand({ sheets: body.sheets, fileName: body.fileName, today, overrides: body.overrides, answers: body.answers });
  let model = { used: false };
  if (body.useModel) {
    model = await modelOverrides(orgId, body.sheets, u, Rm);
    if (model.used) u = Rm.understand({ sheets: body.sheets, fileName: body.fileName, today, overrides: { ...model.overrides, ...body.overrides }, answers: body.answers });
  }
  const privacy = await require("../clientSafe").privacyFor(orgId).catch(() => ({ on: false, clientIds: new Set(), clientEmails: new Set() }));
  const matches = await matchPeople(orgId, u, body.answers, privacy);
  // who-questions: two people of one name in this org
  for (const p of u.people) {
    const m = matches.get(p.key);
    for (const x of m.members) if (x.status === "ambiguous") {
      u.questions.push({ id: `person:${p.key}|${x.name}`, kind: "person", key: `${p.key}|${x.name}`,
        text: `Your records have more than one ${x.name}. Which one is on row ${String(p.lines[0]).split(":")[1]}?`,
        options: [...x.candidates.map(c => ({ key: c.id, label: `${c.name}${c.email ? ", " + c.email : ""}` })), { key: "new", label: "Someone new" }] });
    }
  }
  // clients: their rows come out of the plan, said plainly
  const clientKeys = new Set([...matches].filter(([, m]) => m.client).map(([k]) => k));
  if (clientKeys.size) {
    for (const g of [...u.gifts, ...u.pledges]) if (clientKeys.has(g.personKey))
      u.aside.push({ sheet: g.sheet, line: g.line, who: g.who, reason: "marked as a client, so Steward keeps nothing about them", cents: g.cents });
    u.gifts = u.gifts.filter(g => !clientKeys.has(g.personKey));
    u.pledges = u.pledges.filter(g => !clientKeys.has(g.personKey));
    u.people = u.people.filter(p => !clientKeys.has(p.key));
  }
  // FIX-54: a record naming someone she deleted comes out of the plan the same
  // way, and the preview names them, with Bring them back for her to press
  const deletedMatches = [];
  for (const p of u.people) {
    const m = matches.get(p.key);
    if (clientKeys.has(p.key) || !m.members.some(x => x.status === "deleted")) continue;
    for (const x of m.members.filter(y => y.status === "deleted"))
      deletedMatches.push({ key: p.key, name: x.name, id: x.deletedId, deletedName: x.deletedName, by: x.by, line: p.lines[0], nameOnly: !!x.nameOnly });
  }
  // HARDEN-1: each name-only match asks; the answer rides the commit (answers.deletedPeople)
  const asked = new Set();
  for (const p of u.people) for (const x of matches.get(p.key).members) {
    const k = `${p.key}|${x.name}`;
    if (!(x.nameOnly || x.deletedAsked) || asked.has(k)) continue;
    asked.add(k);
    const dn = x.deletedName || x.name;
    u.questions.push({ id: `deleted:${k}`, kind: "deletedPerson", key: k, optional: true, default: "same", deletedId: x.deletedId || x.deletedAsked,
      text: `Is this the same ${dn} you deleted? Row ${String(p.lines[0]).split(":")[1] || p.lines[0]} matches them by name only.`,
      options: [{ key: "same", label: "Same person (stays out)" }, { key: "different", label: "Different person (import as new)" }] });
  }
  const deletedKeys = new Set(deletedMatches.map(x => x.key));
  if (deletedKeys.size) {
    // the counts the button and the receipt read leave them out too
    const c = u.counts || (u.counts = {});
    const sub = (k, n) => { if (typeof c[k] === "number") c[k] = Math.max(0, c[k] - n); };
    for (const p of u.people.filter(x => deletedKeys.has(x.key))) {
      sub("records", 1); sub("people", 1); sub("persons", Math.max(1, (p.people || []).length));
      for (const [role, k] of [["donor", "donors"], ["pledger", "pledgers"], ["volunteer", "volunteers"]]) if ((p.roles || []).includes(role)) sub(k, 1);
    }
    const heldGifts = u.gifts.filter(g => deletedKeys.has(g.personKey) && g.kind !== "installment");
    const heldPledges = u.pledges.filter(g => deletedKeys.has(g.personKey));
    sub("gifts", heldGifts.length); sub("giftCents", heldGifts.reduce((n, g) => n + (g.cents || 0), 0));
    sub("undatedGifts", heldGifts.filter(g => !g.date).length);
    sub("pledges", heldPledges.length); sub("pledgeCents", heldPledges.reduce((n, g) => n + (g.pledgeCents || 0), 0));
    sub("pledgeOpenCents", heldPledges.reduce((n, g) => n + (g.openCents || 0), 0));
    c.aside = (c.aside || 0) + heldGifts.length + heldPledges.length;
    // a paid first year rides on its pledge's row, so it is set aside once, as the pledge
    for (const g of [...u.gifts.filter(x => x.kind !== "installment"), ...u.pledges]) if (deletedKeys.has(g.personKey))
      u.aside.push({ sheet: g.sheet, line: g.line, who: g.who, reason: "matches someone you deleted, so it was not imported", cents: g.pledgeCents != null ? g.pledgeCents : (g.cents || 0) });
    u.gifts = u.gifts.filter(g => !deletedKeys.has(g.personKey));
    u.pledges = u.pledges.filter(g => !deletedKeys.has(g.personKey));
    u.people = u.people.filter(p => !deletedKeys.has(p.key));
  }
  const nDel = new Set(deletedMatches.map(x => x.id)).size;
  u.deletedMatches = deletedMatches;
  u.deletedSentence = nDel ? `${nDel.toLocaleString("en-US")} ${nDel === 1 ? "person matches someone" : "people match someone"} you deleted. Not imported.` : null;
  const [{ n: orgDonors }] = await query("SELECT COUNT(*)::int AS n FROM donors WHERE org_id=? AND deleted_at IS NULL", [orgId]);
  let newPeople = 0, matchedPeople = 0;
  for (const p of u.people) for (const x of matches.get(p.key).members) { if (x.status === "matched") matchedPeople++; else if (x.status === "new") newPeople++; }
  // an event already on the calendar with the suggested name
  let events = [];
  const nm = (body.answers && body.answers.eventName) || (u.questions.find(q => q.id === "date") || {}).suggestedEventName;
  if (nm) events = await query("SELECT id, name, date::text AS date FROM events WHERE org_id=? AND LOWER(name)=LOWER(?) ORDER BY date DESC NULLS LAST LIMIT 5", [orgId, nm]);
  u.ready = u.questions.filter(q => !q.optional).length === 0;
  const button = Rm.importButtonSentence(u, { matched: matchedPeople });
  if (!u.ready) button.text = `Answer ${u.questions.filter(q => !q.optional).length === 1 ? "1 question" : u.questions.filter(q => !q.optional).length + " questions"} first`;
  return { u, matches, model, orgDonors, newPeople, matchedPeople, events, today, button };
}

// The one person shown as they will look after import: the record that
// touches the most layers (IMPORT-4 Part 8, item 24).
function samplePerson(u) {
  let best = null, score = -1;
  for (const p of u.people) {
    const sc = (p.roles.includes("donor") ? 2 : 0) + (p.roles.includes("pledger") ? 2 : 0) + (p.attendance && p.attendance.attended ? 2 : 0)
      + (p.roles.includes("volunteer") ? 2 : 0) + Object.keys(p.comms || {}).length + Object.keys(p.kept || {}).length + (p.email ? 1 : 0);
    if (sc > score) { score = sc; best = p; }
  }
  if (!best) return null;
  const gifts = u.gifts.filter(g => g.personKey === best.key).map(g => ({ cents: g.cents, date: g.date, method: g.method, methodOriginal: g.methodOriginal, fund: g.fund, flags: g.flags, kind: g.kind }));
  const pledges = u.pledges.filter(p => p.personKey === best.key).map(p => ({ pledgeCents: p.pledgeCents, paidCents: p.paidCents, openCents: p.openCents, years: p.years, why: p.why,
    nextDue: (p.installments.find(i => !i.paid) || {}).dueDate || null }));
  return { name: best.name, email: best.email, phone: best.phone, roles: best.roles, attendance: best.attendance, comms: best.comms, kept: best.kept, flags: best.flags,
           household: best.household, gifts, pledges };
}

function publicView({ u, matches, model, orgDonors, newPeople, matchedPeople, events, button }) {
  return {
    ...u,
    button, sample: samplePerson(u),
    people: u.people.map(p => ({ key: p.key, name: p.name, kind: p.kind, household: p.household, email: p.email, lines: p.lines, roles: p.roles, flags: p.flags,
      members: matches.get(p.key).members.map(x => ({ name: x.name, status: x.status, id: x.id, by: x.by || null })) })),
    newPeople, matchedPeople, orgDonors, events, modelUsed: !!model.used, modelOff: !!model.off,
    // FIX-52: what the assistant proposed, so Import writes exactly this plan without asking it again
    modelOverrides: model.used ? model.overrides : {},
  };
}

app.post("/sheet-import/understand", requireAuth, wrap(async (req, res) => {
  const body = readBody(req.body);
  if (!body.sheets.some(sh => sh.grid.length)) return res.status(400).json({ error: "empty", message: "The file has no cells in it." });
  const out = await buildUnderstanding(req, body);
  // HARDEN-1: the file's fingerprint (its cells, not its name or org) on this
  // preview's audit row, so the nightly check can see a file previewed in one
  // org and imported into another (nightlyCheck.js, check e).
  if (req.audit) req.audit.after({ file: fileFingerprint(body) });
  // HARDEN-1: the preview names the org it was read for; commit sends it back
  const [org] = await query("SELECT id, name FROM orgs WHERE id=?", [req.user.orgId]);
  res.json({ ...publicView(out), org: org ? { id: org.id, name: org.name } : null });
}));

// FIX-54 · BRING THEM BACK. The one way a person she deleted returns from an
// import: she presses it, for the people the preview named. Only someone
// deleted by hand comes back (never one merged into another), and their trash
// rows are closed so Undo and Recent changes do not offer them twice.
app.post("/sheet-import/bring-back", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const ids = [...new Set((Array.isArray(req.body && req.body.ids) ? req.body.ids : []).map(String))].slice(0, 5000);
  if (!ids.length) return res.status(400).json({ error: "ids_required", sentence: "Nobody was named to bring back." });
  const back = await query(`UPDATE donors d SET deleted_at = NULL, updated_at = NOW()
                             WHERE d.org_id=? AND d.id = ANY(?) AND d.deleted_at IS NOT NULL
                               AND NOT EXISTS (SELECT 1 FROM donor_merges m WHERE m.org_id=d.org_id AND m.merged_id=d.id AND m.undone_at IS NULL)
                           RETURNING d.id`, [orgId, ids]);
  const backIds = back.map(r => r.id);
  if (backIds.length) {
    await run(`UPDATE deleted_records SET restored_at = NOW() WHERE org_id=? AND table_name='donors' AND record_id = ANY(?) AND restored_at IS NULL`, [orgId, backIds]);
    await require("../afterChange").afterChange(orgId, backIds, { door: "sheet_import_bring_back" }).catch(e => console.error("[sheet-import] bring back:", e.message));
  }
  if (req.audit) req.audit.after({ broughtBack: backIds });
  const n = backIds.length;
  res.json({ restored: n, ids: backIds, sentence: n ? `${n.toLocaleString("en-US")} ${n === 1 ? "person is" : "people are"} back. Their rows will be imported with the file.` : "Nobody was brought back." });
}));

// FIX-52 · IMPORT IS A JOB, AND THE SCREEN TELLS THE TRUTH. On 27 Oct a real
// workbook's commit ran about two minutes inside one request (every row its
// own statement, about 6,800 round trips, plus the matcher asked once per
// person), the request was dropped, the modal went back to the start, and one
// of the three clicks had committed. Now:
//   · Import writes a sheet_import_jobs row and the write runs behind it, in
//     ONE transaction (db.withAmbientTransaction: recordGift and every helper
//     write through it unchanged), batched by table. A failure rolls the whole
//     file back and the job says why; there is no half-import.
//   · The same file and preview is the same job while it runs: a second
//     click, a retry or a refresh never writes twice. Once it is done, the
//     same file again is a new run that adds nothing (every row has its key).
//   · The modal and the Imports list read the job from the server
//     (GET /sheet-import/jobs/:id), never a guess from a dropped request.
//   · A caller that does not ask for `background` (the API, the older suites)
//     waits for the same job and gets the same 201 as before.
const crypto = require("crypto");
const DB = require("../db");
const RUNNING = new Map();          // job id → its promise, in this process
const JOB_BATCH = 500;
const STALE_MS = 3 * 60 * 1000;     // a running job nobody has touched for this long died with its server

// The same cells are the same file, whatever it is called and wherever it was opened.
function fileFingerprint(body) {
  return crypto.createHash("sha256").update(JSON.stringify(body.sheets || [])).digest("hex").slice(0, 32);
}
function requestKeyOf(orgId, body) {
  return crypto.createHash("sha256").update(JSON.stringify([orgId, body.fileName, body.sheets, body.answers, body.overrides])).digest("hex");
}
function jobView(j) {
  if (!j) return null;
  const result = typeof j.result === "string" ? JSON.parse(j.result) : j.result;
  return { id: j.id, importId: j.id, status: j.status, phase: j.phase || null, done: Number(j.done) || 0, total: Number(j.total) || 0,
           fileName: j.file_name || null, error: j.error || null, startedAt: j.started_at, finishedAt: j.finished_at || null,
           result: result ? result.body : null, httpStatus: result ? result.status : null,
           sentence: j.status === "running" ? `${j.phase || "Starting"}…`
             : j.status === "failed" ? `Not imported. ${j.error || "The import stopped."} Nothing was written.` : null };
}
async function readJob(orgId, id) {
  const [j] = await DB.queryOutside("SELECT * FROM sheet_import_jobs WHERE id=? AND org_id=?", [id, orgId]);
  if (j && j.status === "running" && !RUNNING.has(j.id) && Date.now() - new Date(j.updated_at).getTime() > STALE_MS) {
    // its server stopped mid-write; the transaction went with it
    await DB.runOutside(`UPDATE sheet_import_jobs SET status='failed', error=?, finished_at=NOW(), updated_at=NOW() WHERE id=? AND status='running'`,
      ["The server restarted while this file was being written, so it was rolled back. Import the file again.", j.id]);
    return readJob(orgId, id);
  }
  return j || null;
}
async function finishJob(id, status, payload, error) {
  await DB.runOutside(`UPDATE sheet_import_jobs SET status=?, result=?::jsonb, error=?, finished_at=NOW(), updated_at=NOW(), phase=NULL WHERE id=?`,
    [status, JSON.stringify(payload), error || null, id]);
}
function progress(id) {
  let last = 0;
  return async (phase, done, total, force) => {
    if (!force && Date.now() - last < 250) return;
    last = Date.now();
    await DB.runOutside("UPDATE sheet_import_jobs SET phase=?, done=?, total=?, updated_at=NOW() WHERE id=?", [phase, done, total, id]).catch(() => {});
  };
}
const insertRows = async (sql, cols, rows, cast = {}) => {
  for (let k = 0; k < rows.length; k += JOB_BATCH) {
    const batch = rows.slice(k, k + JOB_BATCH);
    await run(`${sql} VALUES ${batch.map(() => "(" + cols.map(c => "?" + (cast[c] || "")).join(",") + ")").join(",")}`, batch.flat());
  }
};

// The stage a person the file creates starts at, from what the file says they
// are. The stage list has no "Donor" or "Pledger": a person who has given is
// in Ongoing care (steward), a person who has promised and not yet paid is at
// Solicit (the list's own reading of "pledge pending"), anyone else a Prospect.
function stageForRoles(roles) {
  if (roles.includes("donor")) return "steward";
  if (roles.includes("pledger")) return "solicit";
  return "prospect";
}

async function writePlan({ req, body, importId, who, report }) {
  const orgId = req.user.orgId;
  await report("Reading the file", 0, 0, true);
  const out = await buildUnderstanding(req, { ...body, useModel: false });
  const { u, matches } = out;
  const Rm = await R();
  if (!u.ready) return { status: 409, body: { error: "questions_open", message: `${u.questions.length} ${u.questions.length === 1 ? "question needs" : "questions need"} an answer first.`, questions: u.questions } };
  if (!u.gifts.length && !u.pledges.length && !u.people.length) return { status: 400, body: { error: "nothing", message: "Nothing in this file is a person or a gift." } };
  const [already] = await query("SELECT id FROM imports WHERE id=? AND org_id=?", [importId, orgId]);
  if (already) return { status: 409, body: { error: "run_exists", message: "That import has already been recorded." } };
  const a = body.answers || {};
  const summary = { eventCreated: null, householdsCreated: [], householdAssigned: [], sustainerFlagged: [], pledges: [], fundsCreated: [],
                    personChanges: [], suppressions: [], attendees: 0, customFieldsCreated: [], customValuesSet: [], keptAsNotes: 0 };
  const memberCount = u.people.reduce((n, p) => n + Math.max(1, matches.get(p.key).members.length), 0);
  const total = memberCount + u.pledges.length + u.gifts.length;
  let done = 0;

  // the event: one she named (IMPORT-3), or one the file shows (IMPORT-4)
  let eventId = null;
  const evName = String(a.eventName || (u.event && u.event.name) || "").trim().slice(0, 200);
  const evDate = /^\d{4}-\d{2}-\d{2}$/.test(String(a.eventDate || "")) ? a.eventDate : (a.linkEvent && /^\d{4}-\d{2}-\d{2}$/.test(String(a.date || "")) ? a.date : null);
  if (evName && ((a.linkEvent && a.eventName) || (u.event && u.event.fromEngagement))) {
    const [ev] = a.eventId
      ? await query("SELECT id FROM events WHERE id=? AND org_id=?", [a.eventId, orgId])
      : evDate ? await query("SELECT id FROM events WHERE org_id=? AND LOWER(name)=LOWER(?) AND date=?::date LIMIT 1", [orgId, evName, evDate])
        : await query("SELECT id FROM events WHERE org_id=? AND LOWER(name)=LOWER(?) ORDER BY date DESC LIMIT 1", [orgId, evName]);
    if (ev) eventId = ev.id;
    else {
      eventId = "evt_" + uuid().slice(0, 8);
      const day = evDate || out.today;
      await run(`INSERT INTO events (id, org_id, name, event_type, date, date_unknown, status, notes, created_by, created_by_name, import_id)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [eventId, orgId, evName, "fundraiser", day, !evDate, day <= out.today ? "completed" : "upcoming",
         `Created by the import of ${body.fileName || "a spreadsheet"}.` + (evDate ? "" : " The file did not give its date."), who.id, who.name, importId]);
      summary.eventCreated = eventId;
    }
  }

  // people: matched, or created in batches; joint names become one household
  const personId = new Map(), personIds = new Map(), touched = new Set(), matchedIds = new Set();
  const newRows = [];
  for (const p of u.people) {
    const m = matches.get(p.key);
    const ids = [];
    const c = p.comms || {};
    for (const [i, x] of m.members.entries()) {
      if (x.id) { ids.push(x.id); matchedIds.add(x.id); continue; }
      const id = "d_" + uuid().replace(/-/g, "").slice(0, 10);
      const spouse = p.people[i] && p.people[i].spouse ? p.people[i].spouse : null;
      newRows.push([id, orgId, x.name || p.name, i === 0 ? p.email : null, i === 0 ? p.phone : null, p.address, p.address2, p.city, p.state, p.zip,
        i === 0 ? p.externalId : null, p.kind === "organization" ? "organisation" : (p.kind === "anonymous" ? "anonymous" : "person"), spouse,
        stageForRoles(p.roles), "active", "[]", JSON.stringify(p.personTypes || ["other"]), !!(c.optOut || c.doNotEmail), !!c.doNotContact, !!c.doNotMail,
        !!c.doNotCall, !!c.deceased, who.id, who.name, importId]);
      ids.push(id);
    }
    personId.set(p.key, ids[0]);
    personIds.set(p.key, ids);
    ids.forEach(id => touched.add(id));
  }
  const DCOLS = ["id", "org_id", "name", "email", "phone", "address", "address2", "city", "state", "zip", "external_donor_id", "kind", "spouse_name",
    "stage", "status", "tags", "person_types", "do_not_email", "do_not_contact", "do_not_mail", "do_not_call", "deceased", "created_by", "created_by_name", "created_import_id"];
  for (let k = 0; k < newRows.length; k += JOB_BATCH) {
    await insertRows(`INSERT INTO donors (${DCOLS.join(",")})`, DCOLS, newRows.slice(k, k + JOB_BATCH), { person_types: "::jsonb" });
    done = Math.min(k + JOB_BATCH, newRows.length);
    await report(`Writing people ${done.toLocaleString("en-US")} of ${memberCount.toLocaleString("en-US")}`, done, total, true);
  }
  const donorsCreated = newRows.length;
  // households: one query for who already has one, one insert, one update
  const hhPeople = u.people.filter(p => p.household && (personIds.get(p.key) || []).length);
  if (hhPeople.length) {
    const allIds = hhPeople.flatMap(p => personIds.get(p.key));
    const cur = new Map((await query("SELECT id, household_id FROM donors WHERE org_id=? AND id = ANY(?)", [orgId, allIds])).map(r => [r.id, r.household_id]));
    const newHh = [], assign = [];
    for (const p of hhPeople) {
      const ids = personIds.get(p.key);
      let hh = ids.map(id => cur.get(id)).find(Boolean) || null;
      if (!hh) { hh = "hh_" + uuid().slice(0, 10); newHh.push([hh, orgId, p.household.slice(0, 200), ids[0], importId]); summary.householdsCreated.push(hh); }
      for (const id of ids) if (!cur.get(id)) { assign.push([id, hh]); cur.set(id, hh); if (matchedIds.has(id)) summary.householdAssigned.push(id); }
    }
    await insertRows("INSERT INTO households (id, org_id, name, primary_donor_id, import_id)", ["id", "org_id", "name", "primary_donor_id", "import_id"], newHh);
    for (let k = 0; k < assign.length; k += JOB_BATCH) {
      const b = assign.slice(k, k + JOB_BATCH);
      await run(`UPDATE donors d SET household_id = v.hh FROM (VALUES ${b.map(() => "(?,?)").join(",")}) AS v(id, hh)
                  WHERE d.id = v.id AND d.org_id = ? AND d.household_id IS NULL`, [...b.flat(), orgId]);
    }
  }
  // A person who was already here: the file fills what is missing, adds their
  // roles and their communication choices, and what it changed is kept so
  // Undo puts them back exactly as they were. (Few rows; one at a time.)
  for (const p of u.people) {
    const ids = personIds.get(p.key) || [];
    const c = p.comms || {};
    for (const id of ids.filter(d => matchedIds.has(d))) {
      const [before] = await query(`SELECT email, phone, address, address2, city, state, zip, external_donor_id, person_types,
                                           do_not_email, do_not_contact, do_not_mail, do_not_call, deceased
                                      FROM donors WHERE id=? AND org_id=?`, [id, orgId]);
      if (!before) continue;
      const first = id === ids[0];
      const types = Array.isArray(before.person_types) ? before.person_types : [];
      const addTypes = (p.personTypes || []).filter(t => t !== "other" && !types.includes(t));
      const nextTypes = addTypes.length ? [...types.filter(t => t !== "other"), ...addTypes] : types;
      const after = {
        email: before.email || (first ? p.email : null) || null, phone: before.phone || (first ? p.phone : null) || null,
        address: before.address || p.address || null, address2: before.address2 || p.address2 || null, city: before.city || p.city || null,
        state: before.state || p.state || null, zip: before.zip || p.zip || null, external_donor_id: before.external_donor_id || (first ? p.externalId : null) || null,
        person_types: nextTypes, do_not_email: before.do_not_email || !!(c.optOut || c.doNotEmail), do_not_contact: before.do_not_contact || !!c.doNotContact,
        do_not_mail: before.do_not_mail || !!c.doNotMail, do_not_call: before.do_not_call || !!c.doNotCall, deceased: before.deceased || !!c.deceased,
      };
      const changed = Object.keys(after).filter(k => JSON.stringify(after[k] ?? null) !== JSON.stringify(before[k] ?? null));
      if (!changed.length) continue;
      await run(`UPDATE donors SET email=?, phone=?, address=?, address2=?, city=?, state=?, zip=?, external_donor_id=?, person_types=?::jsonb,
                                   do_not_email=?, do_not_contact=?, do_not_mail=?, do_not_call=?, deceased=?, updated_at=NOW()
                  WHERE id=? AND org_id=?`,
        [after.email, after.phone, after.address, after.address2, after.city, after.state, after.zip, after.external_donor_id, JSON.stringify(after.person_types),
         after.do_not_email, after.do_not_contact, after.do_not_mail, after.do_not_call, after.deceased, id, orgId]);
      summary.personChanges.push({ id, before: Object.fromEntries(changed.map(k => [k, before[k] ?? null])) });
    }
  }
  done = memberCount;
  await report("Writing attendance and notes", done, total, true);
  await writeEngagement({ orgId, u, importId, eventId, personIds, who, summary, fileName: body.fileName || "your file", eventName: evName });

  // funds named in the file
  const fundCache = new Map();
  const fundIdFor = async name => {
    const nm = String(name || "").trim();
    if (!nm) return null;
    const k = nm.toLowerCase();
    if (fundCache.has(k)) return fundCache.get(k);
    const [hit] = await query("SELECT id FROM fin_funds WHERE org_id=? AND LOWER(name)=LOWER(?) LIMIT 1", [orgId, nm]);
    let id = hit ? hit.id : null;
    if (!id) {
      id = "fund_" + uuid().slice(0, 10);
      await run("INSERT INTO fin_funds (id,org_id,name,restricted,description) VALUES (?,?,?,false,'Created by an import')", [id, orgId, nm.slice(0, 120)]);
      summary.fundsCreated.push(id);
    }
    fundCache.set(k, id);
    return id;
  };

  // pledges first, so a paid first year lands on its own instalment. Each
  // pledge is its own row's amount, never a total column (FIX-52).
  let giftsCreated = 0, giftCents = 0, pledgesCreated = 0, pledgeCents = 0, duplicates = 0, duplicateCents = 0, installmentGifts = 0;
  const pledgeIdByRow = new Map();
  const PCOLS = ["id", "org_id", "donor_id", "amount", "due_date", "status", "notes", "idempotency_key", "frequency", "installment_count",
                 "created_by", "created_by_name", "import_id", "event_id"];
  for (let k = 0; k < u.pledges.length; k += JOB_BATCH) {
    const batch = u.pledges.slice(k, k + JOB_BATCH).map(p => ({ p, pid: "pl_" + uuid().slice(0, 8) }));
    const rows = batch.map(({ p, pid }) => [pid, orgId, personId.get(p.personKey), p.pledgeCents / 100, p.installments[p.installments.length - 1].dueDate || p.dueDate, "open",
      // HARDEN-1: a pledge has no payment-method column, so how it will be paid ("Stock", "Foundation") rides its note
      [p.why, p.note, p.methodOriginal && !/Method in your file/.test(p.note || "") ? `Method in your file: ${p.methodOriginal}` : null,
       eventId && evName ? `Pledged at ${evName}` : null].filter(Boolean).join(". ").slice(0, 1000), "sheet:" + p.rowId + ":pledge",
      p.years > 1 ? "annual" : null, p.installments.length, who.id, who.name, importId, eventId]);
    const ins = await query(`INSERT INTO pledges (${PCOLS.join(",")}) VALUES ${rows.map(() => "(" + PCOLS.map(() => "?").join(",") + ")").join(",")}
                              ON CONFLICT (org_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING id`, rows.flat());
    const made = new Set(ins.map(r => r.id));
    const inst = [];
    for (const { p, pid } of batch) {
      if (!made.has(pid)) { duplicates++; duplicateCents += p.pledgeCents; continue; }
      for (const i of p.installments) inst.push(["pli_" + uuid().slice(0, 10), orgId, pid, i.seq, i.dueDate, i.cents / 100]);
      pledgeIdByRow.set(p.rowId, pid);
      pledgesCreated++; pledgeCents += p.pledgeCents;
      summary.pledges.push(pid);
    }
    await insertRows("INSERT INTO pledge_installments (id,org_id,pledge_id,seq,due_date,amount)", ["id", "org_id", "pledge_id", "seq", "due_date", "amount"], inst);
    done = memberCount + Math.min(k + JOB_BATCH, u.pledges.length);
    await report(`Writing pledges ${Math.min(k + JOB_BATCH, u.pledges.length)} of ${u.pledges.length}`, done, total, true);
  }
  // gifts: through recordGift, the one gift path, inside the same transaction
  let gi = 0;
  for (const g of u.gifts) {
    gi++;
    const args = {
      undated: !g.date, alreadyThanked: !g.date || undefined,
      orgId, donorId: personId.get(g.personKey), amount: g.cents / 100, date: g.date || null,
      paymentMethod: g.method || undefined, notes: g.note || "", campaign: g.campaign || "",
      fundId: await fundIdFor(g.fund), importId, eventId, history: true, post: false,
      idempotencyKey: "sheet:" + g.rowId, conflict: "idempotency", source: "sheet_import",
      actorId: who.id, actorName: who.name, applyInstallment: false,
      // the after-change step runs once for everyone, after the commit
      afterChange: false,
    };
    let inst = null;
    if (g.kind === "installment") {
      const pid = pledgeIdByRow.get(g.installmentOf);
      if (!pid) { duplicates++; continue; }   // its pledge was already here, and so is this payment
      [inst] = await query("SELECT id FROM pledge_installments WHERE pledge_id=? AND seq=1", [pid]);
      Object.assign(args, { pledgeId: pid, installmentId: inst ? inst.id : null, type: "pledge payment" });
    }
    const r = await recordGift(args);
    if (r.duplicate) { duplicates++; if (g.kind !== "installment") duplicateCents += g.cents; continue; }
    if (inst) {
      await run("UPDATE pledge_installments SET paid_gift_id=?, paid_at=NOW() WHERE id=? AND org_id=? AND paid_gift_id IS NULL", [r.gift.id, inst.id, orgId]);
      await recalcPledgePayment(args.pledgeId, orgId);
      installmentGifts++;
    } else { giftsCreated++; giftCents += g.cents; }
    await report(`Writing gifts ${gi} of ${u.gifts.length}`, memberCount + u.pledges.length + gi, total);
  }
  // "Reccuring": a monthly giver for her to confirm, never a subscription
  for (const f of u.flags) {
    const id = personId.get(f.personKey);
    if (!id) continue;
    const upd = await query(`UPDATE donors SET imported_sustainer=true, imported_sustainer_amount=? WHERE id=? AND org_id=? AND imported_sustainer IS NOT TRUE RETURNING id`,
      [f.cents / 100, id, orgId]);
    if (upd.length) summary.sustainerFlagged.push(id);
  }
  await report("Writing the receipt", total, total, true);
  // FIX-52 · THE RECEIPT COUNTS PLEDGES. Rows in the file = gifts + pledges +
  // set aside + errored, and dollars the same. A paid first year of a
  // multi-year pledge is that pledge's row, so it counts once, as the pledge.
  // A row already here (a second import of the same file) is set aside as such.
  const giftRows = u.gifts.filter(g => g.kind !== "installment");
  const asideCents = u.aside.reduce((n, x) => n + (x.cents || 0), 0);
  const rowsIn = giftRows.length + u.pledges.length + u.aside.length;
  const dollarsInCents = giftRows.reduce((n, g) => n + g.cents, 0) + u.pledges.reduce((n, p) => n + p.pledgeCents, 0) + asideCents;
  summary.counts = { ...u.counts, giftsCreated, giftCents, pledgesCreated, pledgeCents, duplicates, donorsCreated, attendees: summary.attendees, installmentGifts };
  summary.pledgesCreated = pledgesCreated;
  summary.pledgeDollarsCreated = pledgeCents / 100;
  summary.dollarsSetAside = (asideCents + duplicateCents) / 100;
  summary.dollarsErrored = 0;
  summary.peopleRows = u.people.length;
  // HARDEN-1: what the receipt of a file of people says (crm.js peopleLine)
  summary.personRowsInFile = new Set(u.people.flatMap(p => p.lines || [])).size;
  summary.peopleMatched = u.people.reduce((n, p) => n + (matches.get(p.key) ? matches.get(p.key).members.filter(x => x.status === "matched").length : 0), 0);
  summary.columnAccount = u.columnAccount;
  summary.button = Rm.importButtonSentence(u).text;
  summary.undatedGiftIds = (await query("SELECT id FROM gifts WHERE org_id=? AND import_id=? AND date IS NULL", [orgId, importId])).map(r => r.id);
  summary.totals = u.totals;
  summary.aside = u.aside.slice(0, 500);
  summary.eventId = eventId;
  summary.notesSheets = u.notesSheets;
  summary.figureChecks = u.figureChecks;
  await run(`INSERT INTO imports (id, org_id, name, source_filename, shape, started_at, rows_in, gifts_created, donors_created,
                                  rows_set_aside, rows_errored, dollars_in, dollars_created, actor_user_id, actor_user_name, summary_json)
             VALUES (?,?,?,?,'sheet',NOW(),?,?,?,?,0,?,?,?,?,?)`,
    [importId, orgId, (body.fileName || "Spreadsheet").slice(0, 200), body.fileName || null,
     rowsIn, giftsCreated, donorsCreated, u.aside.length + duplicates, dollarsInCents / 100, giftCents / 100, who.id, who.name, JSON.stringify(summary)]);
  const parts = [];
  if (giftsCreated) parts.push(`${giftsCreated.toLocaleString("en-US")} ${giftsCreated === 1 ? "gift" : "gifts"} (${money(giftCents)})`);
  if (pledgesCreated) parts.push(`${pledgesCreated.toLocaleString("en-US")} ${pledgesCreated === 1 ? "pledge" : "pledges"} (${money(pledgeCents)}, ${money(u.counts.pledgeOpenCents)} still open)`);
  if (donorsCreated) parts.push(`${donorsCreated.toLocaleString("en-US")} new ${donorsCreated === 1 ? "person" : "people"}`);
  const sentence = parts.length ? `Imported ${parts.join(", ")}.` + (duplicates ? ` ${duplicates} ${duplicates === 1 ? "row was" : "rows were"} already here.` : "")
    : `Nothing new: every row in this file was already here.`;
  return { status: 201, touched: [...touched], body: { importId, eventId, giftsCreated, giftCents, pledgesCreated, pledgeCents, donorsCreated, duplicates,
    aside: u.aside.length, sentence, totals: u.totals, totalsSentence: u.totalsSentence,
    undatedGifts: summary.undatedGiftIds.length, attendees: summary.attendees, eventName: evName || null,
    eventDateKnown: !!evDate, optOuts: u.counts.optOuts, doNotContact: u.counts.doNotContact,
    columnAccount: u.columnAccount, button: summary.button, reconciled: true } };
}

// One job: under the org's import lock, in one transaction. Anything that
// throws rolls the file back whole, and the job says so.
async function runJob(req, body, importId, who) {
  const orgId = req.user.orgId;
  const report = progress(importId);
  try {
    const out = await withAdvisoryLock("import:" + orgId, () => DB.withAmbientTransaction(async () => {
      const r = await writePlan({ req, body, importId, who, report });
      // a plan refused before writing leaves nothing to commit; throwing keeps that true
      if (r.status !== 201) { const e = new Error("refused"); e.refused = r; throw e; }
      return r;
    }));
    await finishJob(importId, "done", { status: out.status, body: out.body });
    // after the commit, outside it: the one after-change step for everyone touched
    await require("../afterChange").afterChange(orgId, out.touched, { door: "sheet_import", history: true })
      .catch(e => console.error("[sheet-import] after change:", e.message));
  } catch (e) {
    if (e && e.refused) { await finishJob(importId, "failed", e.refused, e.refused.body.message); return; }
    console.error("[sheet-import] job failed, rolled back:", importId, e && (e.stack || e.message));
    const why = "Something went wrong while writing it" + (e && e.code ? ` (${e.code})` : "") + ", so all of it was rolled back.";
    await finishJob(importId, "failed", { status: 500, body: { error: "import_failed", message: `Not imported. ${why} Nothing was written.` } }, why);
  }
}

app.post("/sheet-import/commit", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  // HARDEN-1: an import is bound to its preview. A preview read in one org
  // never commits into another, header or no header.
  const moved = await require("../middleware/orgBound").orgChangedRefusal(req.body && req.body.previewOrgId, orgId);
  if (moved) return res.status(moved.status).json(moved.body);
  const body = readBody(req.body);
  const background = req.body && req.body.background === true;
  const who = actor(req);
  const key = requestKeyOf(orgId, body);
  const asked = RUN_ID_RE.test(String(req.body && req.body.importId || "")) ? String(req.body.importId) : null;
  // the same click, a retry, or a refresh: the job that is already there
  // A job by its id is the answer while it runs, or once done while its run is
  // on file. A job whose run is gone (an org reset, a purge) or that failed is
  // history, and a new attempt under that id starts afresh.
  const byId = async () => {
    const j = asked && await readJob(orgId, asked);
    if (!j) return null;
    if (j.status === "running") return j;
    if (j.status === "done" && (await DB.queryOutside("SELECT 1 FROM imports WHERE id=? AND org_id=?", [j.id, orgId])).length) return j;
    await DB.runOutside("DELETE FROM sheet_import_jobs WHERE id=? AND org_id=? AND status<>'running'", [j.id, orgId]);
    return null;
  };
  const find = async () => (await byId())
    || (await DB.queryOutside(`SELECT * FROM sheet_import_jobs WHERE org_id=? AND request_key=? AND status='running' ORDER BY started_at DESC LIMIT 1`,
      [orgId, key]))[0] || null;
  let job = await find();
  if (!job) {
    const id = asked || "imp_" + uuid().replace(/-/g, "").slice(0, 16);
    const ins = await DB.queryOutside(`INSERT INTO sheet_import_jobs (id, org_id, request_key, status, phase, file_name, created_by, created_by_name)
                                       VALUES (?,?,?,'running','Starting',?,?,?) ON CONFLICT DO NOTHING RETURNING *`,
      [id, orgId, key, (body.fileName || "Spreadsheet").slice(0, 200), who.id, who.name]);
    if (ins.length) {
      job = ins[0];
      const p = runJob(req, body, job.id, who).finally(() => RUNNING.delete(job.id));
      RUNNING.set(job.id, p);
    } else job = await find();
  }
  if (!job) return res.status(409).json({ error: "busy", message: "Another import of this file is starting. Open Import again in a moment." });
  // HARDEN-1: nightlyCheck.js check e reads this row: the run, the file's
  // fingerprint, and the org the page said its preview was read in.
  if (req.audit) req.audit.after({ importId: job.id, file: fileFingerprint(body),
    previewOrgId: (req.body && req.body.previewOrgId) ? String(req.body.previewOrgId).slice(0, 80) : null });
  if (background) return res.status(202).json(jobView(job));
  // a caller that waits: the same job, then the same answer as before
  if (RUNNING.has(job.id)) await RUNNING.get(job.id);
  for (let i = 0; job && job.status === "running" && i < 1200; i++) { await new Promise(r => setTimeout(r, 250)); job = await readJob(orgId, job.id); }
  const v = jobView(job);
  if (v.status === "running") return res.status(202).json(v);
  res.status(v.httpStatus || (v.status === "done" ? 201 : 500)).json(v.result || { error: "import_failed", message: v.sentence });
}));

// What the modal and the Imports list read: the job's real state.
app.get("/sheet-import/jobs/:id", requireAuth, wrap(async (req, res) => {
  const j = await readJob(req.user.orgId, req.params.id);
  if (!j) return res.status(404).json({ error: "not_found", message: "No import by that id." });
  res.json(jobView(j));
}));
app.get("/sheet-import/jobs", requireAuth, wrap(async (req, res) => {
  const rows = await DB.queryOutside(`SELECT * FROM sheet_import_jobs WHERE org_id=? AND (status='running' OR started_at > NOW() - interval '1 day')
                                       ORDER BY started_at DESC LIMIT 20`, [req.user.orgId]);
  const jobs = [];
  for (const r of rows) { const j = await readJob(req.user.orgId, r.id); if (j && (req.query.running !== "1" || j.status === "running")) jobs.push(jobView(j)); }
  res.json({ jobs });
}));

// IMPORT-4 · "Use the event date for these 106 gifts": one click dates every
// gift this run brought in with no date, and the event too when the file never
// gave its day. Optional, never required; once dated they count in This year,
// goals and retention like any other gift.
app.post("/imports/:id/date-undated", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const date = String((req.body && req.body.date) || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date + "T00:00:00Z"))) return res.status(400).json({ error: "bad_date", message: "Pick a day for these gifts." });
  const today = ctx.orgToday(await ctx.orgTz(orgId));
  if (date > today) return res.status(400).json({ error: "future", message: "A gift that was given cannot be dated after today." });
  const [imp] = await query("SELECT id, reversed_at, summary_json FROM imports WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!imp) return res.status(404).json({ error: "not_found" });
  if (imp.reversed_at) return res.status(409).json({ error: "undone", message: "That import was undone." });
  const rows = await query("UPDATE gifts SET date=? WHERE org_id=? AND import_id=? AND date IS NULL RETURNING id, donor_id", [date, orgId, req.params.id]);
  const sj = typeof imp.summary_json === "string" ? JSON.parse(imp.summary_json || "{}") : (imp.summary_json || {});
  let eventDated = false;
  if (sj.eventCreated) {
    const upd = await query("UPDATE events SET date=?::date, date_unknown=false WHERE org_id=? AND id=? AND date_unknown=true RETURNING id", [date, orgId, sj.eventCreated]);
    eventDated = upd.length > 0;
  }
  const donors = [...new Set(rows.map(r => r.donor_id))];
  for (const d of donors) await ctx.recalcDonorSummary(d, orgId);
  await require("../afterChange").afterChange(orgId, donors, { door: "sheet_import", history: true }).catch(e => console.error("[sheet-import] after change:", e.message));
  res.json({ dated: rows.length, date, eventDated,
    sentence: rows.length ? `${rows.length.toLocaleString("en-US")} ${rows.length === 1 ? "gift is" : "gifts are"} now dated ${date}, and count in This year.` : "Every gift from this import already has a date." });
}));
}

function money(c) { return "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 }); }

module.exports = { routers, mount };
