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

// Who each record in the file is in this org: matched, new, or a question.
async function matchPeople(orgId, u, answers, privacy) {
  const out = new Map();
  const picks = (answers && answers.people) || {};
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
      const m = await PM.matchPerson(orgId, { email: p.email, name: nm, line1: p.address, postal: p.zip });
      if (m.status === "matched") {
        const [d] = await query("SELECT is_client FROM donors WHERE id=?", [m.id]);
        members.push({ name: nm, status: "matched", id: m.id, by: m.by, isClient: !!(d && d.is_client === true) });
      } else if (m.status === "ambiguous") members.push({ name: nm, status: "ambiguous", id: null, candidates: m.candidates || [] });
      else members.push({ name: nm, status: "new", id: null });
    }
    // CLIENT-SAFE-1: a person marked as a client is never made a donor here.
    const client = privacy.on && (members.some(x => x.isClient || (x.id && privacy.clientIds.has(x.id))) || (p.email && privacy.clientEmails.has(p.email)));
    out.set(p.key, { members, client });
  }
  return out;
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
  const [{ n: orgDonors }] = await query("SELECT COUNT(*)::int AS n FROM donors WHERE org_id=? AND deleted_at IS NULL", [orgId]);
  let newPeople = 0, matchedPeople = 0;
  for (const p of u.people) for (const x of matches.get(p.key).members) { if (x.status === "matched") matchedPeople++; else if (x.status === "new") newPeople++; }
  // an event already on the calendar with the suggested name
  let events = [];
  const nm = (body.answers && body.answers.eventName) || (u.questions.find(q => q.id === "date") || {}).suggestedEventName;
  if (nm) events = await query("SELECT id, name, date::text AS date FROM events WHERE org_id=? AND LOWER(name)=LOWER(?) ORDER BY date DESC LIMIT 5", [orgId, nm]);
  u.ready = u.questions.length === 0;
  return { u, matches, model, orgDonors, newPeople, matchedPeople, events, today };
}

function publicView({ u, matches, model, orgDonors, newPeople, matchedPeople, events }) {
  return {
    ...u,
    people: u.people.map(p => ({ key: p.key, name: p.name, kind: p.kind, household: p.household, email: p.email, lines: p.lines,
      members: matches.get(p.key).members.map(x => ({ name: x.name, status: x.status, id: x.id, by: x.by || null })) })),
    newPeople, matchedPeople, orgDonors, events, modelUsed: !!model.used, modelOff: !!model.off,
  };
}

app.post("/sheet-import/understand", requireAuth, wrap(async (req, res) => {
  const body = readBody(req.body);
  if (!body.sheets.some(sh => sh.grid.length)) return res.status(400).json({ error: "empty", message: "The file has no cells in it." });
  const out = await buildUnderstanding(req, body);
  res.json(publicView(out));
}));

app.post("/sheet-import/commit", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const body = readBody(req.body);
  const importId = RUN_ID_RE.test(String(req.body && req.body.importId || "")) ? String(req.body.importId) : "imp_" + uuid().replace(/-/g, "").slice(0, 16);
  const who = actor(req);
  const result = await withAdvisoryLock("import:" + orgId, async () => {
    const out = await buildUnderstanding(req, body);
    const { u, matches } = out;
    if (!u.ready) return { status: 409, body: { error: "questions_open", message: `${u.questions.length} ${u.questions.length === 1 ? "question needs" : "questions need"} an answer first.`, questions: u.questions } };
    if (!u.gifts.length && !u.pledges.length && !u.people.length) return { status: 400, body: { error: "nothing", message: "Nothing in this file is a person or a gift." } };
    const [already] = await query("SELECT id FROM imports WHERE id=? AND org_id=?", [importId, orgId]);
    if (already) return { status: 409, body: { error: "run_exists", message: "That import has already been recorded." } };
    const a = body.answers || {};
    const summary = { eventCreated: null, householdsCreated: [], householdAssigned: [], sustainerFlagged: [], pledges: [], fundsCreated: [] };

    // the event, when she named one
    let eventId = null;
    if (a.linkEvent && a.eventName && a.date) {
      const nm = String(a.eventName).trim().slice(0, 200);
      const [ev] = a.eventId
        ? await query("SELECT id FROM events WHERE id=? AND org_id=?", [a.eventId, orgId])
        : await query("SELECT id FROM events WHERE org_id=? AND LOWER(name)=LOWER(?) AND date=?::date LIMIT 1", [orgId, nm, a.date]);
      if (ev) eventId = ev.id;
      else {
        eventId = "evt_" + uuid().slice(0, 8);
        await run(`INSERT INTO events (id, org_id, name, event_type, date, status, notes, created_by, created_by_name, import_id)
                   VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [eventId, orgId, nm, "fundraiser", a.date, a.date < out.today ? "completed" : "upcoming",
           `Created by the import of ${body.fileName || "a spreadsheet"}.`, who.id, who.name, importId]);
        summary.eventCreated = eventId;
      }
    }

    // people: matched, or created; joint names become one household
    const personId = new Map();   // record key → the donor the gift is credited to
    const touched = new Set();
    let donorsCreated = 0;
    for (const p of u.people) {
      const m = matches.get(p.key);
      const ids = [];
      for (const [i, x] of m.members.entries()) {
        if (x.id) { ids.push(x.id); continue; }
        const id = "d_" + uuid().replace(/-/g, "").slice(0, 10);
        const spouse = p.people[i] && p.people[i].spouse ? p.people[i].spouse : null;
        await run(`INSERT INTO donors (id, org_id, name, email, phone, address, address2, city, state, zip, external_donor_id, kind, spouse_name,
                                       stage, status, tags, person_types, created_by, created_by_name, created_import_id)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'prospect','active','[]',?::jsonb,?,?,?)`,
          [id, orgId, x.name || p.name, i === 0 ? p.email : null, i === 0 ? p.phone : null, p.address, p.address2, p.city, p.state, p.zip,
           i === 0 ? p.externalId : null, p.kind === "organization" ? "organisation" : (p.kind === "anonymous" ? "anonymous" : "person"), spouse,
           u.fileKind === "gifts" ? '["donor"]' : '["other"]', who.id, who.name, importId]);
        ids.push(id); donorsCreated++;
      }
      if (p.household && ids.length) {
        const cur = await query("SELECT id, household_id FROM donors WHERE org_id=? AND id = ANY(?)", [orgId, ids]);
        let hh = (cur.find(r => r.household_id) || {}).household_id || null;
        if (!hh) {
          hh = "hh_" + uuid().slice(0, 10);
          await run("INSERT INTO households (id, org_id, name, primary_donor_id, import_id) VALUES (?,?,?,?,?)", [hh, orgId, p.household.slice(0, 200), ids[0], importId]);
          summary.householdsCreated.push(hh);
        }
        for (const r of cur) if (!r.household_id) {
          await run("UPDATE donors SET household_id=? WHERE id=? AND org_id=? AND household_id IS NULL", [hh, r.id, orgId]);
          if (m.members.find(x => x.id === r.id)) summary.householdAssigned.push(r.id);
        }
      }
      personId.set(p.key, ids[0]);
      ids.forEach(id => touched.add(id));
    }

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
    const giftArgs = async g => ({
      orgId, donorId: personId.get(g.personKey), amount: g.cents / 100, date: g.date,
      paymentMethod: g.method || undefined, notes: g.note || "", campaign: g.campaign || "",
      fundId: await fundIdFor(g.fund), importId, eventId, history: true, post: false,
      idempotencyKey: "sheet:" + g.rowId, conflict: "idempotency", source: "sheet_import",
      actorId: who.id, actorName: who.name, applyInstallment: false,
    });

    // pledges first, so a paid first year lands on its own instalment
    let giftsCreated = 0, giftCents = 0, pledgesCreated = 0, pledgeCents = 0, duplicates = 0;
    const pledgeIdByRow = new Map();
    for (const p of u.pledges) {
      const pid = "pl_" + uuid().slice(0, 8);
      const notes = [p.why, p.note, eventId && a.eventName ? `Pledged at ${a.eventName}` : null].filter(Boolean).join(". ");
      const ins = await query(
        `INSERT INTO pledges (id, org_id, donor_id, amount, due_date, status, notes, idempotency_key, frequency, installment_count,
                              created_by, created_by_name, import_id, event_id)
         VALUES (?,?,?,?,?,'open',?,?,?,?,?,?,?,?) ON CONFLICT (org_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING id`,
        [pid, orgId, personId.get(p.personKey), p.pledgeCents / 100, p.installments[p.installments.length - 1].dueDate || p.dueDate,
         notes.slice(0, 1000), "sheet:" + p.rowId + ":pledge", p.years > 1 ? "annual" : null, p.installments.length,
         who.id, who.name, importId, eventId]);
      if (!ins.length) { duplicates++; continue; }
      for (const inst of p.installments) {
        await run("INSERT INTO pledge_installments (id,org_id,pledge_id,seq,due_date,amount) VALUES (?,?,?,?,?,?)",
          ["pli_" + uuid().slice(0, 10), orgId, pid, inst.seq, inst.dueDate, inst.cents / 100]);
      }
      pledgeIdByRow.set(p.rowId, pid);
      pledgesCreated++; pledgeCents += p.pledgeCents;
      summary.pledges.push(pid);
    }
    for (const g of u.gifts) {
      const args = await giftArgs(g);
      let inst = null;
      if (g.kind === "installment") {
        const pid = pledgeIdByRow.get(g.installmentOf);
        if (!pid) { duplicates++; continue; }
        [inst] = await query("SELECT id FROM pledge_installments WHERE pledge_id=? AND seq=1", [pid]);
        Object.assign(args, { pledgeId: pid, installmentId: inst ? inst.id : null, type: "pledge payment" });
      }
      const r = await recordGift(args);
      if (r.duplicate) { duplicates++; continue; }
      if (inst) {
        await run("UPDATE pledge_installments SET paid_gift_id=?, paid_at=NOW() WHERE id=? AND org_id=? AND paid_gift_id IS NULL", [r.gift.id, inst.id, orgId]);
        await recalcPledgePayment(args.pledgeId, orgId).catch(e => console.error("[sheet-import] pledge recalc:", e.message));
      }
      giftsCreated++; giftCents += g.cents;
    }
    // "Reccuring": a monthly giver for her to confirm, never a subscription
    for (const f of u.flags) {
      const id = personId.get(f.personKey);
      if (!id) continue;
      const upd = await query(`UPDATE donors SET imported_sustainer=true, imported_sustainer_amount=? WHERE id=? AND org_id=? AND imported_sustainer IS NOT TRUE RETURNING id`,
        [f.cents / 100, id, orgId]);
      if (upd.length) summary.sustainerFlagged.push(id);
    }
    summary.counts = { ...u.counts, giftsCreated, giftCents, pledgesCreated, pledgeCents, duplicates, donorsCreated };
    summary.totals = u.totals;
    summary.aside = u.aside.slice(0, 500);
    summary.eventId = eventId;
    await run(`INSERT INTO imports (id, org_id, name, source_filename, shape, started_at, rows_in, gifts_created, donors_created,
                                    rows_set_aside, dollars_in, dollars_created, actor_user_id, actor_user_name, summary_json)
               VALUES (?,?,?,?,'sheet',NOW(),?,?,?,?,?,?,?,?,?)`,
      [importId, orgId, (body.fileName || "Spreadsheet").slice(0, 200), body.fileName || null,
       u.gifts.length + u.pledges.length + u.aside.length + (u.fileKind === "people" ? u.people.length : 0),
       giftsCreated, donorsCreated, u.aside.length, u.counts.rowCents / 100, giftCents / 100, who.id, who.name, JSON.stringify(summary)]);
    await require("../afterChange").afterChange(orgId, [...touched], { door: "sheet_import", history: true }).catch(e => console.error("[sheet-import] after change:", e.message));
    const parts = [];
    if (giftsCreated) parts.push(`${giftsCreated.toLocaleString("en-US")} ${giftsCreated === 1 ? "gift" : "gifts"} (${money(giftCents)})`);
    if (pledgesCreated) parts.push(`${pledgesCreated.toLocaleString("en-US")} ${pledgesCreated === 1 ? "pledge" : "pledges"} (${money(pledgeCents)})`);
    if (donorsCreated) parts.push(`${donorsCreated.toLocaleString("en-US")} new ${donorsCreated === 1 ? "person" : "people"}`);
    const sentence = parts.length ? `Imported ${parts.join(", ")}.` + (duplicates ? ` ${duplicates} ${duplicates === 1 ? "row was" : "rows were"} already here.` : "")
      : `Nothing new: every row in this file was already here.`;
    return { status: 201, body: { importId, eventId, giftsCreated, giftCents, pledgesCreated, pledgeCents, donorsCreated, duplicates,
                                  aside: u.aside.length, sentence, totals: u.totals, totalsSentence: u.totalsSentence } };
  });
  res.status(result.status).json(result.body);
}));
}

function money(c) { return "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 }); }

module.exports = { routers, mount };
