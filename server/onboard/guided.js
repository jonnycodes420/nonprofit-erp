// server/onboard/guided.js · ONBOARD-4 item 4. THE GUIDED SETUP ON HOME.
//
// Five steps, in her words, each read from what really happened (never ticked
// by hand). It is ONBOARD-2's "Getting set up" and ONBOARD-3's "Your first 30
// minutes" in one card on Home, not a third card beside them: the gates are
// ONBOARD-2's (board.one), step 3 IS ONBOARD-3's first session, and Settings
// still shows the five onboarding stages.
//
//   yours    Make it yours: name, logo, colours, fiscal year
//   people   Bring your people: a file, the giving history Steward can read,
//            or Send it to us (concierge.js). Done at "Looks right"
//            (orgs.data_in_at), ONBOARD-3's check.
//   call     See who to call: ONBOARD-3's "Your first 30 minutes"; done when a
//            call or note is logged from a move (the kickoff gate's signal)
//   connect  Connect what you use: Stripe first; QuickBooks and Mailchimp can wait
//   team     Invite your team: a second person, or an invitation out
//
// Skipping is the one stored fact (onboard_guided.skipped), and a skipped step
// comes back with one click. The current step is the first neither done nor
// skipped, so she resumes where she left off on any device.
"use strict";
const BOARD = require("./board");
const CONCIERGE = require("./concierge");

const ORDER = ["yours", "people", "call", "connect", "team"];
const TITLE = { yours: "Make it yours", people: "Bring your people", call: "See who to call", connect: "Connect what you use", team: "Invite your team" };
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
  const row = await BOARD.one(query, orgId);
  if (!row) return null;
  const [[o], [g], team, sources, jobs, waiting, reached, [mc], [qb]] = await Promise.all([
    query(`SELECT name, logo_data IS NOT NULL AND logo_data <> '' AS has_logo, brand_primary, vocabulary_json, data_in_at FROM orgs WHERE id = ?`, [orgId]),
    safe(query(`SELECT skipped FROM onboard_guided WHERE org_id = ?`, [orgId])),
    query(`SELECT (SELECT COUNT(*)::int FROM users WHERE org_id = ? AND deactivated_at IS NULL AND COALESCE(is_super_admin, false) = false) AS people,
                  (SELECT COUNT(*)::int FROM invites WHERE org_id = ? AND accepted_at IS NULL AND expires_at > NOW()) AS invited`, [orgId, orgId]),
    safe(query(`SELECT provider FROM giving_sources WHERE org_id = ? AND status = 'active'`, [orgId])),
    CONCIERGE.list(query, { orgId }),
    CONCIERGE.waitingBookingFiles(query, orgId),
    reach(query, orgId),
    safe(query(`SELECT 1 AS y FROM email_marketing_connections WHERE org_id = ? AND provider = 'mailchimp' AND status <> 'disconnected' LIMIT 1`, [orgId])),
    safe(query(`SELECT 1 AS y FROM bookkeeping_connections WHERE org_id = ? AND status = 'active' LIMIT 1`, [orgId])),
  ]);
  const skipped = new Set(list(g && g.skipped).filter(s => ORDER.includes(s)));
  let vocab = o.vocabulary_json;
  if (typeof vocab === "string") { try { vocab = JSON.parse(vocab); } catch { vocab = null; } }
  const fiscal = !!(vocab && Number(vocab.fiscal_year_start_month) >= 1);
  const gates = row.gates;
  const stripePart = (gates.connections.parts || []).find(p => p.key === "stripe") || {};
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
  const steps = {
    yours: { done: !!(o.has_logo && o.brand_primary && fiscal), parts: [
      { key: "name", label: "Name", ok: !!o.name, says: o.name },
      { key: "logo", label: "Logo", ok: !!o.has_logo, says: o.has_logo ? "Added" : "Not added yet" },
      { key: "colours", label: "Colours", ok: !!o.brand_primary, says: o.brand_primary ? "Set" : "Not set yet" },
      { key: "fiscal", label: "Fiscal year", ok: fiscal, says: fiscal ? `Starts in ${MON[Number(vocab.fiscal_year_start_month) - 1]}` : "Not set yet" }] },
    people: { done: !!o.data_in_at, peopleIn, dataInAt: o.data_in_at,
      ways: {
        file: { words: peopleIn && !o.data_in_at ? `${n(peopleIn)} people are in. Check that the totals match your old system.` : "Import your donor file. Steward shows you what it understood before anything is written, and the import has an Undo." },
        giving: [from("stripe", "Stripe", !!stripePart.ok || live.has("stripe")), from("paypal", "PayPal", live.has("paypal"))],
        send: { jobs: jobs.map(j => ({ id: j.id, fileName: j.fileName, source: j.source, key: j.key, words: j.words, steps: j.steps, undone: j.undone })),
          waiting: waiting.map(b => ({ bookingId: b.id, fileName: b.file_name, at: b.created_at })) },
      } },
    call: { done: !!(gates.kickoff.parts.find(p => p.key === "call") || {}).ok, ready: !!o.data_in_at },
    connect: { done: !!stripePart.ok, parts: [
      { key: "stripe", label: "Stripe", ok: !!stripePart.ok, says: stripePart.says || "Not connected", first: true },
      { key: "quickbooks", label: "QuickBooks", ok: !!qb, says: "Can wait" },
      { key: "mailchimp", label: "Mailchimp", ok: !!mc, says: "Can wait" }] },
    team: { done: Number(team[0].people) > 1 || Number(team[0].invited) > 0, people: Number(team[0].people), invited: Number(team[0].invited) },
  };
  for (const p of steps.connect.parts.slice(1)) if (p.ok) p.says = "Connected";
  const out = ORDER.map((id, i) => ({ id, n: i + 1, title: TITLE[id], skipped: !steps[id].done && skipped.has(id), ...steps[id] }));
  const current = out.find(s => !s.done && !s.skipped) || null;
  // Gone from Home once every step is done or the org is billing; Settings keeps the five stages.
  const doneAll = out.every(s => s.done);
  return { show: !doneAll && row.stage !== "billing", steps: out, current: current ? current.id : null,
    doneCount: out.filter(s => s.done).length, skippedCount: out.filter(s => s.skipped).length,
    sentence: "Five steps to a Steward that is yours. Each is ticked by what really happened; skip any and come back to it." };
}

async function setSkip(run, orgId, stepId, on, who) {
  if (!ORDER.includes(stepId)) return { error: "bad_step", message: "There is no such step." };
  await run(`INSERT INTO onboard_guided (org_id, created_by, created_by_name) VALUES (?,?,?) ON CONFLICT (org_id) DO NOTHING`, [orgId, who.id, who.name]);
  await run(on
    ? `UPDATE onboard_guided SET skipped = (SELECT jsonb_agg(DISTINCT x) FROM jsonb_array_elements_text(skipped || to_jsonb(?::text)) x), updated_at = NOW(), updated_by = ?, updated_by_name = ? WHERE org_id = ?`
    : `UPDATE onboard_guided SET skipped = COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements_text(skipped) x WHERE x <> ?), '[]'::jsonb), updated_at = NOW(), updated_by = ?, updated_by_name = ? WHERE org_id = ?`,
  [stepId, who.id, who.name, orgId]);
  return { ok: true };
}

module.exports = { read, setSkip, ORDER, TITLE };
