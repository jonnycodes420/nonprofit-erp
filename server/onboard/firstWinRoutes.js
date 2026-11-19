// server/onboard/firstWinRoutes.js · ONBOARD-3. ONBOARDING THAT ENDS IN A WIN.
//
//   GET  /onboard/totals                  "Does this match your old system?": the last
//                                         three years, each with its definition and the
//                                         facts that explain a difference
//   POST /onboard/totals/compare          { typed: { <yearKey>: "$12,400" } } → Matches or
//                                         the difference, per year (nothing stored)
//   POST /onboard/totals/looks-right      { typed } → stores what was typed, stamps
//                                         orgs.data_in_at (ONBOARD-2's data-in gate)
//   POST /onboard/totals/ask-jonathan     { key, typed } → "Waiting on" on the /ops board
//   GET  /onboard/first-session           Home's "Your first 30 minutes"
//   POST /onboard/first-session/seen|dismiss|reopen|told
//
// THE PLANTED DEFECTS (ONBOARD3_PLANT on the SERVER; tests/onboard3.test.js
// goes red on each): `no-data-in` (Looks right leaves data_in_at alone),
// `own-year` (a year's total counted its own way, soft credits in), `ranking` (the
// first-session list sorted by name, not Home's order); and in dayOne.js and
// weekNotes.js: `before-data-in`, `not-on-list`, `recovered`, `print-all`, `print-dnc`.
"use strict";
const T = require("./totals");
const FS = require("./firstSession");
const BOARD = require("./board");
const PLANT = () => String(process.env.ONBOARD3_PLANT || "");

function mount(app, ctx) {
  const { query, run, wrap, requireAuth, requireAdmin, orgToday, orgTz } = ctx;
  const orgRow = async orgId => (await query(`SELECT * FROM orgs WHERE id = ?`, [orgId]))[0];
  const today = async orgId => orgToday(await orgTz(orgId));   // ORG_TZ_SEAM_OK
  const who = req => ({ id: req.user.userId, name: String(req.user.name || req.user.email || "user").slice(0, 120) });
  const heavy = (() => { try { return require("../../db").queryNoJit; } catch { return undefined; } })();

  async function readTotals(orgId) {
    const org = await orgRow(orgId);
    const out = await T.read(query, org, await today(orgId), { heavy });
    // The plant: a year counted by its own rule (soft credits in), not byYear's.
    if (PLANT() === "own-year") for (const y of out.years) y.cents += (y.explain.find(x => x.key === "soft") || {}).cents || 0;
    return out;
  }
  function typedOf(body, years) {
    const typed = (body && body.typed) || {};
    const bad = [];
    const rows = years.map(y => {
      const c = T.parseTyped(typed[y.key]);
      if (Number.isNaN(c)) bad.push(y.label);
      return { key: y.key, label: y.label, from: y.from, to: y.to, stewardCents: y.cents, giftCount: y.giftCount,
        typedCents: Number.isNaN(c) ? null : c, result: Number.isNaN(c) ? null : T.compare(y.cents, c) };
    });
    return { rows, bad };
  }

  app.get("/onboard/totals", requireAuth, wrap(async (req, res) => {
    const orgId = req.user.orgId;
    const out = await readTotals(orgId);
    const [last] = await query(`SELECT years, created_at, created_by_name FROM onboard_totals_checks WHERE org_id = ? ORDER BY created_at DESC LIMIT 1`, [orgId]);
    res.json({ due: await T.isDue(query, orgId), ...out,
      lastCheck: last ? { years: last.years, at: last.created_at, by: last.created_by_name } : null });
  }));

  app.post("/onboard/totals/compare", requireAuth, wrap(async (req, res) => {
    const out = await readTotals(req.user.orgId);
    const { rows, bad } = typedOf(req.body, out.years);
    res.json({ rows, bad: bad.length ? `Type a dollar amount for ${bad.join(" and ")}, like 12,400 or 12,400.50.` : null });
  }));

  app.post("/onboard/totals/looks-right", requireAuth, requireAdmin, wrap(async (req, res) => {
    const orgId = req.user.orgId;
    const out = await readTotals(orgId);
    const { rows, bad } = typedOf(req.body, out.years);
    if (bad.length) return res.status(400).json({ error: "bad_figure", message: `Type a dollar amount for ${bad.join(" and ")}, like 12,400 or 12,400.50, or leave it blank.` });
    const w = who(req);
    const id = require("../shared/newId").newId("otc");
    await run(`INSERT INTO onboard_totals_checks (id, org_id, years, created_by, created_by_name) VALUES (?,?,?::jsonb,?,?)`,
      [id, orgId, JSON.stringify(rows), w.id, w.name]);
    // The data-in gate (ONBOARD-2 reads orgs.data_in_at). Set once.
    if (PLANT() !== "no-data-in") await run(`UPDATE orgs SET data_in_at = COALESCE(data_in_at, NOW()) WHERE id = ?`, [orgId]);
    // Part B: the day-one list, taken at data-in.
    try { await require("./dayOne").snapshot({ query, run }, await orgRow(orgId), await today(orgId)); }
    catch (e) { console.error("[onboard3] day-one snapshot:", e.message); }
    await BOARD.recompute({ query, run }, [orgId]).catch(e => console.error("[onboard3] recompute:", e.message));
    const typedN = rows.filter(r => r.typedCents != null).length;
    if (req.audit) req.audit.summary = `${w.name} said the imported totals look right${typedN ? ` (${typedN} year${typedN === 1 ? "" : "s"} checked against the old system)` : ""}`;
    res.json({ ok: true, rows, sentence: "Thank you. Your donors are in, and Home is ready." });
  }));

  app.post("/onboard/totals/ask-jonathan", requireAuth, wrap(async (req, res) => {
    const orgId = req.user.orgId;
    const out = await readTotals(orgId);
    const y = out.years.find(x => x.key === String((req.body || {}).key || ""));
    if (!y) return res.status(400).json({ error: "unknown_year", message: "Pick one of the years shown." });
    const c = T.parseTyped((req.body || {}).typed);
    const w = who(req);
    const line = `Totals ${y.label}: Steward ${T.fmt(y.cents)}${c != null && !Number.isNaN(c) ? `, old system ${T.fmt(c)}` : ""} (asked by ${w.name})`;
    await BOARD.ensureRow(run, orgId, w);
    const [cur] = await query(`SELECT waiting_on FROM org_onboarding WHERE org_id = ?`, [orgId]);
    const prev = (cur && cur.waiting_on) || "";
    const next = prev.includes(line) ? prev : (prev ? `${prev}; ${line}` : line);
    await run(`UPDATE org_onboarding SET waiting_on = ?, updated_by = ?, updated_by_name = ? WHERE org_id = ?`, [next.slice(0, 600), w.id, w.name, orgId]);
    if (req.audit) req.audit.summary = `${w.name} asked Jonathan about the ${y.label} total`;
    res.json({ ok: true, sentence: "Sent to Jonathan. He'll look at this year with you; you can still press Looks right." });
  }));

  app.get("/onboard/first-session", requireAuth, wrap(async (req, res) => {
    const orgId = req.user.orgId;
    if (!(await FS.active(query, orgId))) return res.json({ show: false });
    const out = await FS.read({ query, run }, await orgRow(orgId), await today(orgId), require("../../insightsData").insightsFor);
    if (PLANT() === "ranking") out.people.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    res.json(out);
  }));

  // Four plain routes, no path parameter: each names the one thing it records.
  for (const what of ["seen", "dismiss", "reopen", "told"]) {
    app.post(`/onboard/first-session/${what}`, requireAuth, wrap(async (req, res) => {
      await FS.mark({ run }, req.user.orgId, what, who(req));
      res.json({ ok: true });
    }));
  }

  // ── Part B · DAY 30 AND THE MONDAY NOTES ────────────────────────────────
  //   GET  /onboard/readout            the day-30 readout (Home)
  //   POST /onboard/readout/dismiss    gone from Home; /ops keeps it
  //   (the same readout per org on /ops: opsBoardRoutes.js GET /ops/onboarding/readouts)
  //   GET  /notes/this-week            the printable list (stores and sends nothing)
  const DAY1 = require("./dayOne");
  const insightsFor = (...a) => require("../../insightsData").insightsFor(...a);
  app.get("/onboard/readout", requireAuth, wrap(async (req, res) => {
    const org = await orgRow(req.user.orgId);
    const [has] = await query(`SELECT 1 AS y FROM onboard_snapshots WHERE org_id = ? LIMIT 1`, [org.id]);
    if (!org.data_in_at || !has) return res.json({ ready: false });
    res.json({ ready: true, ...(await DAY1.readout({ query }, org, await today(org.id), { insightsFor })) });
  }));
  app.post("/onboard/readout/dismiss", requireAuth, wrap(async (req, res) => {
    await run(`INSERT INTO onboard_first_session (org_id, created_by, created_by_name) VALUES (?,?,?) ON CONFLICT (org_id) DO NOTHING`, [req.user.orgId, who(req).id, who(req).name]);
    await run(`UPDATE onboard_first_session SET readout_dismissed_at = NOW() WHERE org_id = ?`, [req.user.orgId]);
    res.json({ ok: true });
  }));
  app.get("/notes/this-week", requireAuth, wrap(async (req, res) => {
    res.json(await require("./weekNotes").list(query, req.user.orgId, await today(req.user.orgId)));
  }));
}

// Home's first screen, for /org/setup-status: "totals" (the check is due and
// she can press Looks right), "first" (her first 30 minutes), "readout" (day 30), or null.
async function firstWinFor(query, orgId, user) {
  try {
    if (await T.isDue(query, orgId)) {
      const role = user.support ? "admin" : await require("../auth/access").liveRoleIn(user.userId, orgId);
      if (role === "admin") return "totals";
    }
    if (await FS.active(query, orgId)) return "first";
    const R = (() => { try { return require("./dayOne"); } catch { return null; } })();
    if (R && R.readoutDue && (await R.readoutDue(query, orgId))) return "readout";
  } catch (e) { console.error("[onboard3] firstWin:", e.message); }
  return null;
}

module.exports = { mount, firstWinFor };
