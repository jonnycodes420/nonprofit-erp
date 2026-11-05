// tests/lib/counts1Item3.js · COUNTS-1 item 3. EVERY COUNT MATCHES THE LIST IT
// COUNTS: an event's guests, the volunteer roster, sequences running, an
// audience's campaign reach, SYBUNT, and Lapsed against Lost.
//
//   const { checkItem3 } = require("./lib/counts1Item3");
//   const fails = await checkItem3({ token, orgId, q: H.q });   // [] is green
//
// It builds what it needs in the given org through the real HTTP API (made-up
// names), apart from two org flags a person sets in Settings (a timezone
// chosen, email turned on) which it writes directly. Each failure is one
// sentence saying which two surfaces disagreed. `countsItem3Diffs` is the
// read-only half, for the truth check (tests/lib/surfacesAgree.js): it builds
// nothing and compares what is already there.
//
// Two of the walk's breaks were in the browser only (the event page's panels
// and the volunteer card read once and never again), and the server answered
// right all along; for those the client source is checked for the re-read.
"use strict";
const fs = require("fs");
const path = require("path");
const H = require("../helpers");
const { civilPlusDays } = H;

// COUNTS1_SRC_ROOT: read another checkout's client (proving the check red on main).
const ROOT = process.env.COUNTS1_SRC_ROOT || path.join(__dirname, "..", "..");
const src = f => fs.readFileSync(path.join(ROOT, f), "utf8");

// The read-only comparisons: what each surface says now, against the list it
// labels. Used by checkItem3 after it builds, and by the truth check.
// maxPeople: past this many people the two whole-org passes (every audience
// through the builder, every summary page) are left to the suites that build
// their own small org; the truth check runs on 25k-person orgs too.
async function countsItem3Diffs(token, { only = null, maxPeople = Infinity } = {}) {
  const diffs = [];
  const get = p => H.api("GET", p, token).then(r => r.body).catch(() => null);
  const total = maxPeople === Infinity ? 0 : Number(((await get("/donors/counts")) || {}).total) || 0;
  const heavy = new Set(["audiences", "lapsed"]);
  const want = k => (!only || only.includes(k)) && !(heavy.has(k) && total > maxPeople);

  if (want("volunteers")) {
    const [roster, counts, people] = await Promise.all([get("/volunteer-hub/roster"), get("/volunteer-hub/counts"), get("/people?role=volunteer")]);
    const n = roster && Array.isArray(roster.people) ? roster.people.length : null;
    const card = counts && counts.roster ? counts.roster.value : null;
    const list = Array.isArray(people) ? people.length : people && Array.isArray(people.people) ? people.people.length : null;
    if (n !== card) diffs.push(`volunteers: the roster has ${n} but the On the roster card says ${card}`);
    if (list !== null && n !== list) diffs.push(`volunteers: the roster has ${n} but the volunteers list holds ${list}`);
    const m = roster && /^(\w+) volunteers? on the roster/.exec(roster.sentence || "");
    if (n && !m) diffs.push(`volunteers: the roster sentence does not say how many ("${roster && roster.sentence}")`);
  }

  if (want("audiences")) {
    const hub = await get("/communications/hub");
    for (const a of (hub && hub.audiences) || []) {
      const seg = a.segment || { mode: a.mode };
      const pv = await H.api("POST", "/campaigns/segment-preview", token, { segment: seg }).then(r => r.body).catch(() => null);
      const builder = pv && pv.audience ? pv.audience.wouldReach : pv ? pv.count : undefined;
      if (a.count !== builder) diffs.push(`audiences: Communications says ${a.name} ${a.count}, the campaign builder counts ${builder}`);
    }
  }

  if (want("sybunt")) {
    const [st, rep] = await Promise.all([get("/groups/starters"), get("/reports/sybunt")]);
    const syb = ((st && st.starters) || []).find(s => s.key === "sybunt");
    const reportN = rep && Array.isArray(rep.rows) ? rep.rows.length : null;
    if (syb && reportN !== null && syb.count !== reportN) {
      if (!syb.report) diffs.push(`SYBUNT: the starter says ${syb.count}, the report ${reportN}, and the starter does not say why`);
      else if (syb.report.count !== reportN) diffs.push(`SYBUNT: the starter quotes the report as ${syb.report.count}, the report lists ${reportN}`);
    }
  }

  if (want("lapsed")) {
    const [counts, rep] = await Promise.all([get("/donors/counts"), get("/saved-reports/std:lapsed-24/run")]);
    const sums = [];
    for (let off = 0; ; off += 500) {
      const page = await get(`/donors/summaries?limit=500&offset=${off}`);
      if (!Array.isArray(page) || !page.length) break;
      sums.push(...page);
      if (page.length < 500) break;
    }
    const re = sums.filter(d => d.reengage), lost = re.filter(d => d.lost);
    const repN = rep && rep.totals ? rep.totals.count : null;
    if (counts && counts.reengage !== re.length) diffs.push(`lapsed: the Re-engage badge says ${counts.reengage}, its list holds ${re.length}`);
    if (sums.length && !sums.some(d => "lost" in d)) diffs.push("lapsed: Re-engage has no Lost & Found list (no person carries the lost flag)");
    else if (repN !== lost.length) diffs.push(`lapsed: the report "${rep && rep.report && rep.report.name}" counts ${repN}, Re-engage's Lost & Found holds ${lost.length}`);
    if (rep && rep.report && !/^Lost\b/.test(rep.report.name)) diffs.push(`lapsed: the over-24-months report is called "${rep.report.name}", not by its window (Lost: over 24 months)`);
  }
  return diffs;
}

async function checkItem3(ctx) {
  const { token, orgId } = ctx;
  const q = ctx.q || H.q;
  const fails = [];
  const api = (m, p, b) => H.api(m, p, token, b);
  const tag = String(orgId).slice(-6);
  const person = async (name, extra = {}) => {
    const r = await api("POST", "/donors", { name, email: `${name.toLowerCase().replace(/\W+/g, ".")}.${tag}@example.test`, ...extra });
    if (!r.body || !r.body.id) throw new Error(`could not add ${name}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    return r.body.id;
  };
  const gift = (id, amount, date) => api("POST", `/donors/${id}/gifts`, { amount, date, type: "cash", payment_method: "Check" });

  // ── 1. AN EVENT: 2 guests, 1 came ─────────────────────────────────────────
  {
    const a = await person("Wren Halloway"), b = await person("Tobias Fenwick");
    const ev = (await api("POST", "/events", { name: "Lantern Supper", eventType: "gala", date: civilPlusDays(-10) })).body;
    await api("POST", `/events/${ev.id}/attendees`, { donorIds: [a, b] });
    const det = (await api("GET", `/events/${ev.id}`)).body;
    const att = (det.attendees || []).find(x => x.donor_id === a);
    await api("PATCH", `/events/${ev.id}/attendees/${att.id}`, { status: "attended" });
    const rep = (await api("GET", `/events/${ev.id}/report`)).body || {};
    const story = rep.story || {};
    const guests = (await api("GET", `/events/${ev.id}/guests`)).body || {};
    const rows = guests.guests || [];
    if (story.invited !== 2 || story.attended !== 1) fails.push(`event: After the event says Invited ${story.invited}, Came ${story.attended}; the guest rows say 2 and 1`);
    if (rows.length !== 2 || rows.filter(g => g.status === "attended").length !== 1) fails.push(`event: Tables and seating reads ${rows.length} guests, ${rows.filter(g => g.status === "attended").length} came`);
    // The page's panels re-read when a guest is added or marked (the walk's
    // "Invited 0, Came 0" was After the event never reading again).
    const E = src("client/src/components/Events.jsx");
    const reportRereads = /function EventReport[\s\S]{0,400}useEventRowsRev\(eventId\)[\s\S]{0,200}\/report`\)[^\n]*\[eventId, rowsRev\]/.test(E);
    const seatingRereads = /function EventSeating[\s\S]{0,1200}useEventRowsRev\(eventId\);\s*useEffect\(\(\) => \{ load\(\); \}, \[eventId, rowsRev\]\)/.test(E);
    const patchSays = /attendees: ev\.attendees\.map[^\n]*\n\s*\}\)\);\n\s*eventRowsChanged\(eventId\);/.test(E);
    if (!reportRereads) fails.push("event: After the event reads its counts once and never again after a guest changes");
    if (!seatingRereads) fails.push("event: Tables and seating reads its guests once and never again after a guest changes");
    if (!patchSays) fails.push("event: marking a guest as come does not tell the other panels");
  }

  // ── 2. VOLUNTEERS: card, roster sentence and list ─────────────────────────
  {
    await api("POST", "/volunteer-hub/people", { name: "Maren Oakhurst", email: `maren.${tag}@example.test` });
    await api("POST", "/volunteer-hub/people", { name: "Idris Pellow", email: `idris.${tag}@example.test` });
    fails.push(...await countsItem3Diffs(token, { only: ["volunteers"] }));
    const V = src("client/src/components/VolunteersHub.jsx");
    if (!/const loadRoster = useCallback\(\(\) => \{\s*setCountsKey\(n => n \+ 1\)/.test(V))
      fails.push("volunteers: the On the roster card does not re-read when the roster does (a new volunteer left the card a step behind)");
  }

  // ── 3. SEQUENCES RUNNING: turned on and able to send ──────────────────────
  {
    const mk = name => api("POST", "/sequences", { name, trigger: "manual", steps: [{ delayDays: 0, subject: "Hello", body: "Thank you." }] }).then(r => r.body && r.body.id);
    const s1 = await mk("Autumn welcome"), s2 = await mk("Spring check-in");
    await q("UPDATE sequences SET status='active' WHERE id = ANY($1::text[])", [[s1, s2]]);
    await q("UPDATE orgs SET timezone_confirmed_at = NULL WHERE id=$1", [orgId]);
    let hub = (await api("GET", "/communications/hub")).body || {};
    if (hub.stats && hub.stats.activeSequences !== 0) fails.push(`sequences: Sequences running says ${hub.stats.activeSequences} while the Sequences page says both are paused until a timezone is set`);
    await q("UPDATE orgs SET timezone_confirmed_at = NOW(), onboarded_at = COALESCE(onboarded_at, NOW()), emails_enabled = true WHERE id=$1", [orgId]);
    hub = (await api("GET", "/communications/hub")).body || {};
    const sends = hub.mail && hub.mail.sends;
    if (sends && hub.stats.activeSequences !== 2) fails.push(`sequences: two turned on and able to send, Sequences running says ${hub.stats.activeSequences}`);
    await api("PATCH", `/sequences/${s1}/status`, { status: "paused" });
    hub = (await api("GET", "/communications/hub")).body || {};
    if (sends && hub.stats.activeSequences !== 1) fails.push(`sequences: one paused, Sequences running says ${hub.stats.activeSequences}, not 1`);
    if (!sends) fails.push(`sequences: email did not turn on for the test org (${hub.mail && hub.mail.sentence}), so running could not be checked`);
  }

  // ── 4. AN AUDIENCE'S NUMBER IS THE CAMPAIGN BUILDER'S ─────────────────────
  {
    const v = await person("Corin Ashdown");
    await api("POST", "/volunteer-hub/people", { personId: v });
    await q("UPDATE donors SET do_not_email = true WHERE id=$1", [v]);   // on the roster, and the builder leaves them out
    fails.push(...await countsItem3Diffs(token, { only: ["audiences"] }));
  }

  // ── 5. SYBUNT: the starter and the report ─────────────────────────────────
  {
    const old = await person("Philippa Greaves"), last = await person("Anselm Rook");
    await gift(old, 250, civilPlusDays(-3 * 365));      // gave three years ago only: both lists
    await gift(last, 120, civilPlusDays(-430));          // gave last year only: the report's SYBUNT, not the starter's
    fails.push(...await countsItem3Diffs(token, { only: ["sybunt"] }));
  }

  // ── 6. LAPSED 12-24 MONTHS, LOST OVER 24, AND THE REPORT ──────────────────
  {
    const lost = await person("Bertrand Quill"), recent = await person("Odile Marsh");
    await gift(lost, 400, civilPlusDays(-1000));
    await gift(recent, 90, civilPlusDays(-500));
    fails.push(...await countsItem3Diffs(token, { only: ["lapsed"] }));
  }
  return fails;
}

module.exports = { checkItem3, countsItem3Diffs };
