// server/reports/reportPeople.js · REPORTS-6 item 2. ANY REPORT'S ROWS BECOME AN ACTION IN ONE CLICK.
//
// "Do something with these N people": add to calls (Thread steps, through
// POST /threads/plan, the Plan calls path), make a group (kept in step with
// the report, or a fixed list), add to a journey (the journeys' bulk add, with
// its own Undo), or start a mailing draft (a campaign draft with this audience,
// never sent). Each says the count before it runs and has Undo.
//
// WHO "THESE PEOPLE" ARE is one function, peopleOf, read by the count, by
// every action and by a kept-in-step group's membership (groups.js memberSql):
//   · a report whose rows ARE people (LYBUNT, SYBUNT, Top donors, three-year,
//     a builder report over people, a standard report with a person per row)
//     acts on those rows;
//   · a report whose rows are gifts, funds or months acts on THE PEOPLE BEHIND
//     THEM: the rows of the report's own givers figure (giving summary, the
//     annual report), or the givers of the gifts its total opens (by fund, a
//     builder report over gifts, pledges or monthly plans), and says so;
//   · a report with nobody behind it (retention's cohorts are counted, not
//     listed) says that, and offers nothing.
"use strict";
const express = require("express");
const { newId } = require("../shared/newId");

const routers = { r1: express.Router() };
const PEOPLE_TABS = new Set(["lybunt", "sybunt", "top-donors", "three-year", "solicitations"]);
// A tab report's figure whose rows are the people behind it, in the order asked.
const BEHIND = { "giving-summary": ["uniqueDonors", "total"], annual: ["uniqueDonors", "total"], "by-group": ["grandTotal"] };
const TAB_QUERY = new Set(["year", "yearMode", "from", "to", "groupBy", "scope", "limit", "fundId", "campaignId", "unit"]);
const CALLS_MAX = 200;   // POST /threads/plan's own cap (BULK_PLAN_MAX)

let api = null;

function mount(ctx) {
  const { actor, checkWriteAccess, computeDriftForDonors, computeRetentionRate, figureSources, orgTime, orgToday, orgTz,
    query, reportHooks, requireAuth, run, runSaved, savedReportFor, wrap } = ctx;
  const deps = { computeRetentionRate, computeDriftForDonors };
  const app = routers.r1;

  // A spec is what the screen sends: { kind: "tab", key, query } | { kind: "saved", id }. It is
  // also a kept-in-step group's rule (groups.js `report`), with `by`, the user who made it.
  function readSpec(raw) {
    let s = raw;
    if (typeof s === "string") { try { s = JSON.parse(s); } catch { return null; } }
    if (!s || typeof s !== "object") return null;
    if (s.kind === "tab") {
      const key = String(s.key || "");
      if (!/^[a-z0-9-]{1,40}$/.test(key)) return null;
      const q = {};
      const src = typeof s.query === "string" ? Object.fromEntries(new URLSearchParams(s.query)) : (s.query || {});
      for (const [k, v] of Object.entries(src)) if (TAB_QUERY.has(k) && /^[\w:.-]{0,40}$/.test(String(v))) q[k] = String(v);
      return { kind: "tab", key, query: q, label: String(s.label || key).slice(0, 80), by: s.by ? String(s.by) : null };
    }
    if (s.kind === "builder") {
      // The builder's results before they are saved: its definition, checked by the builder itself when it runs.
      const def = s.def && typeof s.def === "object" ? s.def : null;
      if (!def || JSON.stringify(def).length > 3000) return null;
      return { kind: "builder", def, label: String(s.label || "This report").slice(0, 80), by: s.by ? String(s.by) : null };
    }
    if (s.kind === "saved") {
      const id = String(s.id || "");
      if (!/^(std:[a-z0-9-]+|[A-Za-z0-9_-]{1,64})$/.test(id)) return null;
      return { kind: "saved", id, label: String(s.label || id).slice(0, 80), by: s.by ? String(s.by) : null };
    }
    return null;
  }

  async function idsOfSource(orgId, source) {
    const rows = await figureSources.allRows(orgId, source, deps);
    return [...new Set((rows || []).map(r => r.donorId).filter(Boolean))];
  }

  // → { ids, rowsArePeople, sentence, capped, cannot }
  async function peopleOf(orgId, spec, userId) {
    if (spec.kind === "tab") {
      if (!(reportHooks.handlerKeys || []).includes(spec.key)) return { ids: [], cannot: "That report is not one Steward knows." };
      const d = await reportHooks.run(orgId, spec.key, spec.query);
      if (PEOPLE_TABS.has(spec.key)) {
        const ids = [...new Set((d.rows || []).map(r => r.id || r._pid || r.donorId).filter(Boolean))];
        return { ids, rowsArePeople: true };
      }
      for (const f of BEHIND[spec.key] || []) {
        const fig = d.figures && d.figures[f];
        if (fig && fig.source) {
          const ids = await idsOfSource(orgId, fig.source);
          return { ids, rowsArePeople: false,
            sentence: `This report's rows are ${spec.key === "by-group" ? "funds and campaigns" : "totals of gifts"}, so this acts on the people who made those gifts.` };
        }
      }
      return { ids: [], cannot: "This report counts people without listing them, so there is nobody here to act on. Open one of its numbers to see the people behind it." };
    }
    const rep = spec.kind === "builder" ? { id: null, name: spec.label, standard: false, kind: "builder", def: spec.def }
      : await savedReportFor(orgId, userId, spec.id);
    if (!rep) return { ids: [], cannot: "That report is not one you can open." };
    const RB0 = await import("../../shared/reportBuilder.js");
    if (rep.def && RB0.usesWealth(rep.def) && !(await require("../wealth/access").maySee(userId, orgId))) return { ids: [], cannot: "This report reads Wealth Scores, which you cannot see." };
    let out = await runSaved(orgId, rep, { all: true });
    if (out.errors) return { ids: [], cannot: out.errors.join(" ") };
    let rowsArePeople = true;
    if (out.grouped && rep.def) {
      // A grouped report's rows are its groups. The people behind them are the rows it groups.
      const RB = await import("../../shared/reportBuilder.js");
      const E = RB.ENTITIES[rep.def.entity];
      const first = E && Object.keys(E.fields)[0];
      out = first ? await runSaved(orgId, { ...rep, standard: false, def: { ...rep.def, groupBy: undefined, columns: [first] } }, { all: true }) : out;
      rowsArePeople = false;
    }
    const ids = [...new Set((out.rows || []).map(r => r._pid).filter(Boolean))];
    if (!ids.length && (out.rows || []).length) return { ids: [], cannot: "This report's rows are not people, and Steward cannot tell whose they are." };
    const entity = rep.def && rep.def.entity;
    return { ids, rowsArePeople: rowsArePeople && (!entity || entity === "people"), capped: !!out.capped,
      sentence: rowsArePeople && (!entity || entity === "people") ? null
        : `This report's rows are ${entity === "gifts" ? "gifts" : entity === "pledges" ? "pledges" : entity === "recurring" ? "monthly plans" : entity === "grants" ? "grants" : "not people"}, so this acts on the people behind them.` };
  }

  // Only people still on file, in this org.
  async function live(orgId, ids) {
    if (!ids.length) return [];
    const rows = await query(`SELECT id FROM donors WHERE org_id=? AND deleted_at IS NULL AND archived_at IS NULL AND id = ANY(?::text[])`, [orgId, ids]);
    const keep = new Set(rows.map(r => r.id));
    return ids.filter(id => keep.has(id));
  }
  async function resolve(orgId, spec, userId) {
    const p = await peopleOf(orgId, spec, userId);
    return { ...p, ids: await live(orgId, p.ids || []) };
  }
  api = { readSpec, resolve };

  const headline = (n, p) => n === 0 ? "Nobody on this report to act on." : `Do something with these ${n.toLocaleString("en-US")} ${n === 1 ? "person" : "people"}`;

  // GET: who, and how many. A read; it writes nothing.
  app.get("/report-people", requireAuth, wrap(async (req, res) => {
    const spec = readSpec(req.query.spec);
    if (!spec) return res.status(400).json({ error: "Unknown report." });
    const p = await resolve(req.user.orgId, spec, req.user.userId);
    res.json({ count: p.ids.length, headline: headline(p.ids.length), rowsArePeople: !!p.rowsArePeople, sentence: p.sentence || null,
      cannot: p.cannot || null, capped: !!p.capped, callsMax: CALLS_MAX,
      ...(req.query.ids === "1" ? { ids: p.ids } : {}) });
  }));

  async function batch(req, kind, spec, count, made) {
    const id = newId("rpb"), a = actor(req);
    await run(`INSERT INTO report_action_batches (id, org_id, kind, report, count, made, created_by, created_by_name) VALUES (?,?,?,?,?,?::jsonb,?,?)`,
      [id, req.user.orgId, kind, spec.label, count, JSON.stringify(made), a.id, a.name]);
    return id;
  }

  // MAKE A GROUP: kept in step with the report (a group by rule whose rule IS the report), or a fixed list.
  app.post("/report-people/group", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const spec = readSpec(req.body && req.body.spec);
    if (!spec) return res.status(400).json({ error: "Unknown report." });
    const keep = req.body.keep === "in_step" ? "in_step" : "fixed";
    const p = await resolve(req.user.orgId, spec, req.user.userId);
    if (p.cannot) return res.status(400).json({ error: p.cannot });
    const orgId = req.user.orgId, a = actor(req);
    const today = orgToday(await orgTz(orgId));   // ORG_TZ_SEAM_OK
    let name = String((req.body && req.body.name) || `${spec.label}, ${today}`).trim().slice(0, 60);
    const id = newId("grp");
    const insert = n => run(`INSERT INTO audiences (id, org_id, name, description, segment, kind, rules, created_by, created_by_name)
        VALUES (?,?,?,?,?::jsonb,?,?::jsonb,?,?)`,
      [id, orgId, n, keep === "in_step" ? `Kept in step with the report ${spec.label}.` : `The ${p.ids.length} people on ${spec.label} on ${today}.`,
       JSON.stringify({ mode: "group" }), keep === "in_step" ? "dynamic" : "static",
       keep === "in_step" ? JSON.stringify({ report: JSON.stringify({ ...spec, by: req.user.userId }) }) : null, a.id, a.name]);
    try { await insert(name); }
    catch (e) { if (e.code !== "23505") throw e; name = `${name.slice(0, 47)} ${orgTime.addDays(today, 0)} ${id.slice(-4)}`; await insert(name); }
    if (keep === "fixed" && p.ids.length) {
      await run(`INSERT INTO group_members (org_id, group_id, donor_id, added_by, added_by_name)
                 SELECT ?, ?, x, ?, ? FROM unnest(?::text[]) AS x ON CONFLICT (group_id, donor_id) DO NOTHING`, [orgId, id, a.id, a.name, p.ids]);
    }
    res.status(201).json({ groupId: id, name, count: p.ids.length, keep,
      message: keep === "in_step" ? `Made the group ${name}. It keeps in step with ${spec.label} by itself: ${p.ids.length} ${p.ids.length === 1 ? "person" : "people"} today.`
        : `Made the group ${name} with ${p.ids.length} ${p.ids.length === 1 ? "person" : "people"}. It stays as it is until someone changes it.`,
      undo: { label: "Undo", path: `/groups/${encodeURIComponent(id)}`, method: "DELETE" } });
  }));

  // UNDO FOR "ADD TO CALLS": the steps POST /threads/plan just opened, while still open.
  app.post("/report-people/calls/undo", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const ids = Array.isArray(req.body && req.body.threadIds) ? req.body.threadIds.map(String).slice(0, CALLS_MAX) : [];
    if (!ids.length) return res.status(400).json({ error: "Nothing to undo." });
    const open = await query(`SELECT id FROM threads WHERE org_id=? AND id = ANY(?::text[]) AND closed_at IS NULL AND created_at > NOW() - INTERVAL '1 day'`, [req.user.orgId, ids]);
    const openIds = open.map(r => r.id);
    if (openIds.length) await run(`DELETE FROM threads WHERE org_id=? AND id = ANY(?::text[]) AND closed_at IS NULL`, [req.user.orgId, openIds]);
    res.json({ removed: openIds.length, kept: ids.length - openIds.length,
      sentence: `Took back ${openIds.length} planned ${openIds.length === 1 ? "call" : "calls"}${ids.length - openIds.length ? `; ${ids.length - openIds.length} already done or changed stay` : ""}.` });
  }));

  // START A MAILING DRAFT: a fixed group of these people, and a campaign draft whose audience is it. Never sent.
  app.post("/report-people/mailing", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const spec = readSpec(req.body && req.body.spec);
    if (!spec) return res.status(400).json({ error: "Unknown report." });
    const p = await resolve(req.user.orgId, spec, req.user.userId);
    if (p.cannot) return res.status(400).json({ error: p.cannot });
    if (!p.ids.length) return res.status(400).json({ error: "Nobody on this report to write to." });
    const orgId = req.user.orgId, a = actor(req);
    const today = orgToday(await orgTz(orgId));   // ORG_TZ_SEAM_OK
    const groupId = newId("grp"), campaignId = newId("cmp");
    const gname = `Mailing: ${spec.label}, ${today} ${groupId.slice(-4)}`.slice(0, 60);
    await run(`INSERT INTO audiences (id, org_id, name, description, segment, kind, created_by, created_by_name) VALUES (?,?,?,?,?::jsonb,'static',?,?)`,
      [groupId, orgId, gname, `The ${p.ids.length} people on ${spec.label} on ${today}, for a mailing draft.`, JSON.stringify({ mode: "group" }), a.id, a.name]);
    await run(`INSERT INTO group_members (org_id, group_id, donor_id, added_by, added_by_name)
               SELECT ?, ?, x, ?, ? FROM unnest(?::text[]) AS x ON CONFLICT (group_id, donor_id) DO NOTHING`, [orgId, groupId, a.id, a.name, p.ids]);
    await run(`INSERT INTO campaigns (id, org_id, name, type, subject, body, status, segment, recipient_count, open_count, created_by, created_by_name)
               VALUES (?,?,?,'email','','', 'draft', ?::jsonb, 0, 0, ?, ?)`,
      [campaignId, orgId, `${spec.label}: mailing draft`.slice(0, 120), JSON.stringify({ mode: "group", audienceId: groupId }), a.id, a.name]);
    const batchId = await batch(req, "mailing", spec, p.ids.length, { groupId, campaignId });
    res.status(201).json({ campaignId, groupId, count: p.ids.length,
      message: `Started a mailing draft to ${p.ids.length} ${p.ids.length === 1 ? "person" : "people"}. Nothing is sent: write it and send it from Email when you are ready.`,
      undo: { label: "Undo", path: `/report-people/batches/${encodeURIComponent(batchId)}/undo`, method: "POST" } });
  }));

  app.post("/report-people/batches/:id/undo", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const [b] = await query(`SELECT * FROM report_action_batches WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
    if (!b) return res.status(404).json({ error: "Not found" });
    if (b.undone_at) return res.status(409).json({ error: "already_undone", sentence: "This has already been undone." });
    const made = typeof b.made === "string" ? JSON.parse(b.made) : (b.made || {});
    if (b.kind === "mailing") {
      const [c] = await query(`SELECT status FROM campaigns WHERE id=? AND org_id=?`, [made.campaignId, req.user.orgId]);
      if (c && c.status !== "draft") return res.status(409).json({ error: "not_a_draft", sentence: "That mailing is no longer a draft, so it stays." });
      await run(`DELETE FROM campaigns WHERE id=? AND org_id=? AND status='draft'`, [made.campaignId, req.user.orgId]);
      await run(`DELETE FROM group_members WHERE org_id=? AND group_id=?`, [req.user.orgId, made.groupId]);
      await run(`DELETE FROM audiences WHERE id=? AND org_id=?`, [made.groupId, req.user.orgId]);
    }
    await run(`UPDATE report_action_batches SET undone_at=NOW() WHERE id=? AND org_id=?`, [b.id, req.user.orgId]);
    res.json({ undone: b.id, sentence: "Taken back. The mailing draft and its list are gone." });
  }));
}

// A kept-in-step group's members: the report as it reads now (groups.js memberSql).
async function idsForRule(orgId, rule) {
  if (!api) return [];
  const spec = api.readSpec(rule);
  if (!spec) return [];
  return (await api.resolve(orgId, spec, spec.by)).ids || [];
}
const ruleLabel = rule => { try { const s = typeof rule === "string" ? JSON.parse(rule) : rule; return s && s.label ? String(s.label) : "a report"; } catch { return "a report"; } };

module.exports = { routers, mount, idsForRule, ruleLabel };
