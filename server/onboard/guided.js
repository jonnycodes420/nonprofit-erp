// server/onboard/guided.js · ONBOARD-4 item 4, reshaped by ONBOARD-5. THE SETUP.
//
// ONBOARD-5 (Jonathan, 24 Nov): setup is one calm page at a time, one connection
// per page, ten steps on its own full page (/onboard/setup, SetupPage.jsx). Home
// shows "Finish setting up · N of 10" until she presses "Go to Home" on the last.
//
//   yours       Make it yours: logo, colours, fiscal year
//   people      Bring your donors: a file, Stripe, or Send it to us (concierge.js).
//               Done at "Looks right" (orgs.data_in_at), ONBOARD-3's check.
//   letters     Receipts and letters: legal name, EIN, address, who signs
//   funds       Funds, campaigns and events: confirmed when she presses Continue
//   voice       How you talk: confirmed when she presses Continue (it saves first)
//   gifts       Where gifts come in: any giving source or Stripe connected
//   quickbooks  QuickBooks: an active books link
//   email       Email: anyone's mailbox connected
//   team        Invite your team: a second person, or an invitation out
//   call        You're set: who to call this week. Done at "Go to Home".
//
// Stored per org (onboard_guided): the steps she skipped (a skipped step comes
// back with one click), the page she was on (she resumes there on any device),
// the two steps confirmed by Continue, and when she finished. Every other
// done-state is read from what really happened, never ticked by hand.
"use strict";
const BOARD = require("./board");
const CONCIERGE = require("./concierge");

const ORDER = ["yours", "people", "letters", "funds", "voice", "gifts", "quickbooks", "email", "team", "call"];
const TITLE = { yours: "Make it yours", people: "Bring your donors", letters: "Receipts and letters", funds: "Funds, campaigns and events",
  voice: "How you talk", gifts: "Where gifts come in", quickbooks: "QuickBooks", email: "Email", team: "Invite your team", call: "You're set" };
// About how long each page takes, for "About N minutes left" (the mockup's).
const MINUTES = { yours: 2, people: 5, letters: 4, funds: 3, voice: 2, gifts: 3, quickbooks: 2, email: 1, team: 1, call: 0 };
// The two pages with nothing to connect: done when she presses Continue on them.
const CONFIRMED_BY_CONTINUE = new Set(["funds", "voice"]);
// The connections: a skipped one shows on Home as not connected.
const CONNECTIONS = { gifts: "Where gifts come in", quickbooks: "QuickBooks", email: "Email" };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = v => { if (!v) return null; const d = new Date(v); return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`; };
const n = v => Number(v || 0).toLocaleString("en-US");
const list = raw => { if (Array.isArray(raw)) return raw; try { const p = JSON.parse(raw || "[]"); return Array.isArray(p) ? p : []; } catch { return []; } };
const MISSING = new Set(["42P01", "42703"]);
const safe = p => p.catch(e => { if (e && MISSING.has(e.code)) return []; throw e; });

// How far back the giving Steward can already read reaches: per source, its gifts and the oldest.
async function reach(query, orgId) {
  const rows = await safe(query(`SELECT CASE WHEN source = 'stripe' OR source = 'giving-source:stripe' THEN 'stripe' ELSE substr(source, 15) END AS p,
                                        COUNT(*)::int AS c, MIN(date) AS first
                                   FROM gifts WHERE org_id = ? AND (source = 'stripe' OR source LIKE 'giving-source:%') AND COALESCE(is_sample, false) = false
                                  GROUP BY 1`, [orgId]));
  return new Map(rows.map(r => [r.p, r]));
}

async function read(query, orgId) {
  // An org off the onboarding board (an older customer opening setup from Settings) reads the same page.
  const row = (await BOARD.one(query, orgId).catch(() => null)) || { stage: null, gates: { connections: { parts: [] }, kickoff: { parts: [] } } };
  const [[o], [g], team, sources, jobs, waiting, reached, [mb], [qb]] = await Promise.all([
    query(`SELECT name, logo_data IS NOT NULL AND logo_data <> '' AS has_logo, brand_primary, brand_accent, vocabulary_json, vocabulary_set_at, data_in_at,
                  legal_name, ein, receipt_address, receipt_signature_name, stripe_connected FROM orgs WHERE id = ?`, [orgId]),
    safe(query(`SELECT skipped, confirmed, current_step, finished_at FROM onboard_guided WHERE org_id = ?`, [orgId])),
    query(`SELECT (SELECT COUNT(*)::int FROM users WHERE org_id = ? AND deactivated_at IS NULL AND COALESCE(is_super_admin, false) = false) AS people,
                  (SELECT COUNT(*)::int FROM invites WHERE org_id = ? AND accepted_at IS NULL AND expires_at > NOW()) AS invited`, [orgId, orgId]),
    safe(query(`SELECT provider FROM giving_sources WHERE org_id = ? AND status = 'active'`, [orgId])),
    CONCIERGE.list(query, { orgId }),
    CONCIERGE.waitingBookingFiles(query, orgId),
    reach(query, orgId),
    safe(query(`SELECT 1 AS y FROM mailbox_connections WHERE org_id = ? AND status <> 'disconnected' LIMIT 1`, [orgId])),
    safe(query(`SELECT 1 AS y FROM bookkeeping_connections WHERE org_id = ? AND status = 'active' LIMIT 1`, [orgId])),
  ]);
  const skipped = new Set(list(g && g.skipped).filter(s => ORDER.includes(s)));
  const confirmed = new Set(list(g && g.confirmed).filter(s => CONFIRMED_BY_CONTINUE.has(s)));
  const finishedAt = (g && g.finished_at) || null;
  let vocab = o.vocabulary_json;
  if (typeof vocab === "string") { try { vocab = JSON.parse(vocab); } catch { vocab = null; } }
  // July is the default and is not stored (vocabularyToStore keeps only what differs), so a
  // saved vocabulary with no month is a chosen July.
  const fiscalMonth = vocab && Number(vocab.fiscal_year_start_month) >= 1 ? Number(vocab.fiscal_year_start_month) : o.vocabulary_set_at ? 7 : null;
  const fiscal = !!fiscalMonth;
  const gates = row.gates;
  const stripePart = ((gates.connections || {}).parts || []).find(p => p.key === "stripe") || {};
  const live = new Set(sources.map(s => s.provider));
  const people = await query(`SELECT COUNT(*)::int AS c FROM donors WHERE org_id = ? AND deleted_at IS NULL AND COALESCE(is_sample, false) = false`, [orgId]);
  const peopleIn = Number(people[0].c);

  const from = (key, label, connected) => {
    const r = reached.get(key);
    return { key, label, connected,
      words: r && r.c ? `${n(r.c)} gifts read from ${label}, reaching back to ${day(r.first)}.`
        : connected ? `${label} is connected. Its history is being read; Steward reads as far back as ${label} keeps it.`
          : `Connect ${label} and Steward builds your list from its gift history, as far back as ${label} keeps it.` };
  };
  const has = v => v != null && String(v).trim() !== "";
  const colors = !!(o.brand_primary || o.brand_accent);
  const giving = live.size > 0 || !!stripePart.ok || o.stripe_connected === true || o.stripe_connected === 1;
  const steps = {
    yours: { done: !!(o.has_logo && colors && fiscal), parts: [
      { key: "name", label: "Name", ok: !!o.name, says: o.name },
      { key: "logo", label: "Logo", ok: !!o.has_logo, says: o.has_logo ? "Added" : "Not added yet" },
      { key: "colors", label: "Colors", ok: colors, says: colors ? "Set" : "Not set yet" },
      { key: "fiscal", label: "Fiscal year", ok: fiscal, says: fiscal ? `Starts in ${MON[fiscalMonth - 1]}` : "Not set yet" }] },
    people: { done: !!o.data_in_at, peopleIn, dataInAt: o.data_in_at,
      ways: {
        file: { words: peopleIn && !o.data_in_at ? `${n(peopleIn)} people are in. Check that the totals match your old system.` : "Import your donor file. Steward shows you what it understood before anything is written, and the import has an Undo." },
        giving: [from("stripe", "Stripe", !!stripePart.ok || live.has("stripe")), from("paypal", "PayPal", live.has("paypal"))],
        send: { jobs: jobs.map(j => ({ id: j.id, fileName: j.fileName, source: j.source, key: j.key, words: j.words, steps: j.steps, undone: j.undone })),
          waiting: waiting.map(b => ({ bookingId: b.id, fileName: b.file_name, at: b.created_at })) },
      } },
    letters: { done: has(o.legal_name) && has(o.ein) && has(o.receipt_address) && has(o.receipt_signature_name) },
    funds: { done: confirmed.has("funds") },
    voice: { done: confirmed.has("voice") },
    gifts: { done: giving },
    quickbooks: { done: !!qb },
    email: { done: !!mb },
    team: { done: Number(team[0].people) > 1 || Number(team[0].invited) > 0, people: Number(team[0].people), invited: Number(team[0].invited) },
    call: { done: !!finishedAt, ready: !!o.data_in_at },
  };
  const out = ORDER.map((id, i) => ({ id, n: i + 1, title: TITLE[id], minutes: MINUTES[id], skipped: !steps[id].done && skipped.has(id), ...steps[id] }));
  const firstOpen = out.find(s => !s.done && !s.skipped) || null;
  // She comes back to the page she was on; with none stored, the first step neither done nor skipped.
  const stored = g && ORDER.includes(g.current_step) ? g.current_step : null;
  const current = finishedAt ? null : stored || (firstOpen ? firstOpen.id : "call");
  // On Home until she presses "Go to Home" (or every step is done); Settings keeps the way back in.
  const doneAll = out.every(s => s.done);
  return { show: !finishedAt && !doneAll && row.stage !== "billing", finished: !!finishedAt, finishedAt,
    steps: out, current, total: ORDER.length,
    doneCount: out.filter(s => s.done).length, skippedCount: out.filter(s => s.skipped).length,
    notConnected: Object.keys(CONNECTIONS).filter(id => { const s = out.find(x => x.id === id); return s && !s.done && s.skipped; })
      .map(id => ({ id, title: CONNECTIONS[id] })),
    sentence: "Ten short pages to a Steward that is yours. Each is ticked by what really happened; skip any and come back to it." };
}

async function setSkip(run, orgId, stepId, on, who) {
  if (!ORDER.includes(stepId)) return { error: "bad_step", message: "There is no such step." };
  await ensure(run, orgId, who);
  await run(on
    ? `UPDATE onboard_guided SET skipped = (SELECT jsonb_agg(DISTINCT x) FROM jsonb_array_elements_text(skipped || to_jsonb(?::text)) x), updated_at = NOW(), updated_by = ?, updated_by_name = ? WHERE org_id = ?`
    : `UPDATE onboard_guided SET skipped = COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements_text(skipped) x WHERE x <> ?), '[]'::jsonb), updated_at = NOW(), updated_by = ?, updated_by_name = ? WHERE org_id = ?`,
  [stepId, who.id, who.name, orgId]);
  return { ok: true };
}

async function ensure(run, orgId, who) {
  await run(`INSERT INTO onboard_guided (org_id, created_by, created_by_name) VALUES (?,?,?) ON CONFLICT (org_id) DO NOTHING`, [orgId, who.id, who.name]);
}

// The page she is on, so she comes back to it.
async function setAt(run, orgId, stepId, who) {
  if (!ORDER.includes(stepId)) return { error: "bad_step", message: "There is no such step." };
  await ensure(run, orgId, who);
  await run(`UPDATE onboard_guided SET current_step = ?, updated_at = NOW(), updated_by = ?, updated_by_name = ? WHERE org_id = ?`, [stepId, who.id, who.name, orgId]);
  return { ok: true };
}

// Continue on a page with nothing to connect (funds, how you talk).
async function confirm(run, orgId, stepId, who) {
  if (!CONFIRMED_BY_CONTINUE.has(stepId)) return { error: "bad_step", message: "That step is done by what happens on it, not by Continue." };
  await ensure(run, orgId, who);
  await run(`UPDATE onboard_guided SET confirmed = (SELECT jsonb_agg(DISTINCT x) FROM jsonb_array_elements_text(confirmed || to_jsonb(?::text)) x),
                    skipped = COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements_text(skipped) x WHERE x <> ?), '[]'::jsonb),
                    updated_at = NOW(), updated_by = ?, updated_by_name = ? WHERE org_id = ?`, [stepId, stepId, who.id, who.name, orgId]);
  return { ok: true };
}

// "Go to Home": setup is finished; Home stops showing it, Settings keeps the way back in.
async function finish(run, orgId, who) {
  await ensure(run, orgId, who);
  await run(`UPDATE onboard_guided SET finished_at = COALESCE(finished_at, NOW()), finished_by = COALESCE(finished_by, ?), finished_by_name = COALESCE(finished_by_name, ?),
                    current_step = NULL, updated_at = NOW(), updated_by = ?, updated_by_name = ? WHERE org_id = ?`, [who.id, who.name, who.id, who.name, orgId]);
  return { ok: true };
}

// /ops: which page each org is on and which it skipped. One query for many orgs.
async function progressFor(query, orgIds) {
  if (!orgIds || !orgIds.length) return {};
  const rows = await safe(query(`SELECT org_id, skipped, current_step, finished_at FROM onboard_guided WHERE org_id = ANY(?::text[])`, [orgIds]));
  const out = {};
  for (const r of rows) {
    const sk = list(r.skipped).filter(s => ORDER.includes(s));
    out[r.org_id] = { at: ORDER.includes(r.current_step) ? r.current_step : null, atTitle: TITLE[r.current_step] || null,
      atN: ORDER.indexOf(r.current_step) + 1 || null, skipped: sk.map(s => TITLE[s]), finishedAt: r.finished_at || null };
  }
  return out;
}

module.exports = { read, setSkip, setAt, confirm, finish, progressFor, ORDER, TITLE, MINUTES };
