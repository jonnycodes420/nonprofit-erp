// tests/lib/surfacesAgree.js: HARDEN-1. EVERY PLACE STEWARD SHOWS PEOPLE OR
// MONEY, ASKED AT ONCE, MUST GIVE ONE ANSWER.
//
//   const { assertSurfacesAgree } = require("./lib/surfacesAgree");
//   await assertSurfacesAgree(orgId, ctx);
//
// It asks each surface through the real HTTP API, as an org admin, and throws
// one Error listing every disagreement (surface A said x, surface B said y).
// The database is the ground truth: people are `donors` rows with no
// `deleted_at` (and not sample rows), money is their gifts. A deleted person
// appears in nothing and their gifts count toward nothing.
//
// ctx (every field optional except a way to sign in):
//   token     a Bearer token for an ADMIN of orgId (preferred: no extra login)
//   email     with `password` (default "loadtest1234"): signed in with
//             helpers.login when there is no token. With neither, the org's
//             first admin user is signed in (once per process) with that password
//   q         (sql, params) => rows, a direct DB handle for the ground truth;
//             defaults to helpers.q (the scratch DATABASE_URL)
//   label     a word for the messages ("after the undo"), so a red run says
//             where in the suite it went red (`step` is read the same way)
//   importId  accepted and ignored: every import's Move Report is checked
//   soft      true: return { ok, diffs, facts, ms } and do not throw
//   skip      [names] of checks to leave out, e.g. ["atlas"] for a suite
//             whose org pauses Atlas. Names: people, gifts, thisYear,
//             vsLastYear, homeLine, drift, groups, events, campaigns,
//             moveReport, search, ask, atlas, exports, deleted, finance
//
// Returns { ok: true, diffs: [], facts, ms } when every surface agrees.
// Speed: the reads run in parallel; a small org takes well under a second or
// two, so a suite can call it after every write that changes people.
"use strict";
const zlib = require("zlib");
const H = require("../helpers");
const orgTime = require("../../orgTime");

const cents = v => Math.round(Number(v || 0) * 100);
const money = c => `$${(c / 100).toFixed(2)}`;
// "$63,984" / "$2,887,186.01" / "1,208" → a number (dollars or a count)
const num = s => Number(String(s).replace(/[$,]/g, ""));
const MONEY_RE = /\$([\d,]+(?:\.\d{1,2})?)/;

// A zip from the export, read with the zlib Node already has: the central
// directory names each file, its local header says where the bytes start.
function unzip(buf) {
  const out = {};
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) return out;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataAt, dataAt + size);
    out[name] = (method === 8 ? zlib.inflateRawSync(raw) : raw).toString("utf8").replace(/^﻿/, "");
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// RFC-4180 enough for our own exports: quoted cells, doubled quotes, CRLF.
function parseCsv(text) {
  const rows = []; let row = [], cell = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = ""; if (row.some(c => c !== "")) rows.push(row); row = [];
    } else cell += ch;
  }
  row.push(cell); if (row.some(c => c !== "")) rows.push(row);
  const [head = [], ...body] = rows;
  return body.map(r => Object.fromEntries(head.map((h, i) => [h.replace(/^﻿/, ""), r[i]])));
}

// Every leaf of a payload, with its path: a deleted person's id may sit at
// any depth of any answer, so the check walks, it does not stringify.
function* leaves(v, path = "") {
  if (v && typeof v === "object") { for (const [k, x] of Object.entries(v)) yield* leaves(x, path ? `${path}.${k}` : k); }
  else yield [path, v];
}

const TOKENS = new Map();   // orgId|email -> token, so repeated checks sign in once
async function assertSurfacesAgree(orgId, ctx = {}) {
  const t0 = Date.now();
  const q = ctx.q || H.q;
  const label = ctx.label || ctx.step || "";
  const skip = new Set(ctx.skip || []);
  // No token or email: the org's first admin, signed in once per process.
  let email = ctx.email;
  if (!ctx.token && !email) {
    const [u] = await q(`SELECT email FROM users WHERE org_id = $1 AND role = 'admin' ORDER BY created_at ASC NULLS LAST, id LIMIT 1`, [orgId]);
    if (!u) throw new Error(`assertSurfacesAgree: ${orgId} has no admin to ask as; pass ctx.token`);
    email = u.email;
  }
  const key = `${orgId}|${email}`;
  const token = ctx.token || TOKENS.get(key) || await H.login(email, ctx.password || "loadtest1234");
  if (!ctx.token) TOKENS.set(key, token);
  const get = (path) => H.api("GET", path, token).then(r => r.body);
  const raw = (path) => fetch(H.BASE + path, { headers: { Authorization: "Bearer " + token } })
    .then(async r => ({ status: r.status, buf: Buffer.from(await r.arrayBuffer()) }));
  const diffs = [];
  const facts = {};
  // One fact, as several surfaces state it. Every value must equal the first.
  const agree = (what, pairs, fmt = String) => {
    const shown = pairs.filter(([, v]) => v !== undefined && v !== null && !Number.isNaN(v));
    facts[what] = Object.fromEntries(shown);
    const [, want] = shown[0] || [];
    for (const [name, v] of shown.slice(1)) {
      if (v !== want) diffs.push(`${what}: ${shown[0][0]} says ${fmt(want)}, ${name} says ${fmt(v)}`);
    }
  };

  // ── THE GROUND TRUTH, from the database ──────────────────────────────────
  const LIVE = `d.org_id = $1 AND d.deleted_at IS NULL AND d.is_sample IS NOT TRUE`;
  const [[people], [gifts], deleted, donorRows, imports, groupRows, eventRows, campaignRows, [org]] = await Promise.all([
    q(`SELECT COUNT(*)::int AS n FROM donors d WHERE ${LIVE}`, [orgId]),
    q(`SELECT COUNT(*)::int AS n, COALESCE(SUM(ROUND(g.amount*100)),0)::bigint AS c,
              COUNT(*) FILTER (WHERE g.date IS NULL)::int AS undated
         FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id WHERE ${LIVE}`, [orgId]),
    q(`SELECT id, name, email FROM donors WHERE org_id = $1 AND deleted_at IS NOT NULL`, [orgId]),
    q(`SELECT COUNT(*) FILTER (WHERE imported_total IS NOT NULL OR imported_gift_count IS NOT NULL)::int AS summarised
         FROM donors d WHERE ${LIVE}`, [orgId]),
    q(`SELECT id, migration_source FROM imports WHERE org_id = $1 AND reversed_at IS NULL ORDER BY committed_at ASC, id ASC`, [orgId]),
    q(`SELECT gr.id, gr.name, (SELECT COUNT(*)::int FROM group_members m JOIN donors d ON d.id = m.donor_id AND d.org_id = m.org_id
                                 WHERE m.group_id = gr.id AND m.org_id = gr.org_id AND d.deleted_at IS NULL) AS live
         FROM groups gr WHERE gr.org_id = $1 AND COALESCE(gr.kind,'static') = 'static'`, [orgId]).catch(() => []),
    q(`SELECT e.id, e.name,
              (SELECT COUNT(*)::int FROM event_attendees a LEFT JOIN donors d ON d.id = a.donor_id
                WHERE a.event_id = e.id AND a.org_id = e.org_id AND (a.donor_id IS NULL OR d.deleted_at IS NULL)) AS live,
              (SELECT COUNT(*)::int FROM event_attendees a LEFT JOIN donors d ON d.id = a.donor_id
                WHERE a.event_id = e.id AND a.org_id = e.org_id AND a.status = 'attended' AND (a.donor_id IS NULL OR d.deleted_at IS NULL)) AS attended
         FROM events e WHERE e.org_id = $1`, [orgId]),
    q(`SELECT c.id, c.name, c.goal_amount,
              (SELECT COALESCE(SUM(ROUND(g.amount*100)),0)::bigint FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
                WHERE g.org_id = c.org_id AND g.campaign_id = c.id AND d.deleted_at IS NULL
                  AND (c.start_date IS NULL OR g.date >= to_char(c.start_date,'YYYY-MM-DD'))
                  AND (c.end_date IS NULL OR g.date <= to_char(c.end_date,'YYYY-MM-DD'))) AS raised
         FROM campaigns c WHERE c.org_id = $1 AND c.retired_at IS NULL AND c.goal_amount IS NOT NULL`, [orgId]),
    q(`SELECT agent_paused_at FROM orgs WHERE id = $1`, [orgId]),
  ]);
  const pageRows = await q(`SELECT gp.id, gp.title, (SELECT COALESCE(SUM(ROUND(g.amount*100)),0)::bigint FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
                               WHERE g.giving_page_id = gp.id AND g.org_id = gp.org_id AND d.deleted_at IS NULL) AS raised
                              FROM giving_pages gp WHERE gp.org_id = $1`, [orgId]);
  const deletedIds = new Set(deleted.map(d => d.id));

  // ── EVERY SURFACE, at once ───────────────────────────────────────────────
  const ASK_N = "How many donors do we have?", ASK_Y = "How much have we raised this year?";
  const want = (name, p) => (skip.has(name) ? Promise.resolve(null) : p.catch(e => ({ __error: String(e && e.message || e) })));
  const [list, counts, setup, move, lead, dashHome, fund, board, drift, lapsedList, groups, events, campaigns,
         csv, workbook, zip, askN, askY, atlasN, atlasY, reports, searches, finance] = await Promise.all([
    get("/donors?limit=200&offset=0"),
    get("/donors/counts"),
    get("/org/setup-status"),
    want("homeLine", get("/move")),
    get("/home/lead"),
    get("/dashboard/home"),
    get("/fundraising/overview"),
    get("/dashboards/board"),
    want("drift", get("/drift")),
    want("drift", get("/donors?lifecycle=lapsed&limit=1&offset=0")),
    want("groups", get("/groups")),
    want("events", get("/events")),
    want("campaigns", Promise.resolve([])),
    want("exports", raw("/donors/export/csv").then(r => parseCsv(r.buf.toString("utf8")))),
    want("exports", get("/org/export")),
    want("exports", raw("/org/export/csv").then(r => unzip(r.buf))),
    want("ask", H.api("POST", "/ask", token, { text: ASK_N }).then(r => r.body)),
    want("ask", H.api("POST", "/ask", token, { text: ASK_Y }).then(r => r.body)),
    want("atlas", org && org.agent_paused_at ? Promise.resolve(null) : H.api("POST", "/atlas", token, { text: ASK_N }).then(r => r.body)),
    want("atlas", org && org.agent_paused_at ? Promise.resolve(null) : H.api("POST", "/atlas", token, { text: ASK_Y }).then(r => r.body)),
    want("moveReport", Promise.all(imports.map(i => get(`/imports/${encodeURIComponent(i.id)}/move-report`).then(b => [i, b])))),
    want("search", Promise.all(deleted.slice(0, 5).map(d => get(`/search?q=${encodeURIComponent(d.name || "")}`).then(b => [d, b])))),
    want("finance", get("/finance/overview")),
  ]);
  // HOME-3: a suite proves a comparison can fail by having one surface say a
  // different number (ctx.plant gets the bodies it may change, before any check).
  if (typeof ctx.plant === "function") ctx.plant({ lead, board, fund });

  // Atlas writes the request it answered (voice_memos, atlas_actions,
  // agent_instructions). The check leaves no trace in the org, so a suite that
  // counts those rows, or deletes its org afterwards, sees what it wrote.
  const atlasIds = [atlasN, atlasY].map(b => b && b.request && b.request.id).filter(Boolean);
  if (atlasIds.length) {
    await q(`DELETE FROM atlas_actions WHERE org_id = $1 AND request_id = ANY($2)`, [orgId, atlasIds]);
    await q(`DELETE FROM voice_memos WHERE org_id = $1 AND id = ANY($2)`, [orgId, atlasIds]);
    await q(`DELETE FROM agent_instructions WHERE org_id = $1 AND persona = 'atlas' AND text = ANY($2) AND created_at >= $3`,
      [orgId, [ASK_N, ASK_Y], new Date(t0 - 1000).toISOString()]);
  }

  // The list pages at 200; a small org's whole list is read, in parallel.
  if (list && Array.isArray(list.donors) && list.total > list.donors.length && list.total <= 2000) {
    const pages = await Promise.all(Array.from({ length: Math.ceil(list.total / 200) - 1 }, (_, i) => get(`/donors?limit=200&offset=${200 * (i + 1)}`)));
    for (const pg of pages) list.donors.push(...((pg && pg.donors) || []));
  }

  // ── PEOPLE ───────────────────────────────────────────────────────────────
  const csvRows = Array.isArray(csv) ? csv : null;
  const zipDonors = zip && !zip.__error ? Object.entries(zip).find(([n]) => /(^|\/)donors\.csv$/.test(n)) : null;
  const zipGifts = zip && !zip.__error ? Object.entries(zip).find(([n]) => /(^|\/)gifts\.csv$/.test(n)) : null;
  const homeLine = move && move.move && move.move.homeLine;
  const homeLinePeople = homeLine && /This is your file, ([\d,]+) (?:people|person)/.exec(homeLine);
  const setupDonors = ((setup && setup.items) || []).find(i => i.key === "donors") || {};
  if (!skip.has("people")) {
    agree("people", [
      ["the database (live, not sample)", people.n],
      ["the Donors list total", list && list.total],
      ["the Donors count (/donors/counts)", counts && counts.total],
      ["the onboarding card", setupDonors.count],
      ["Home's file line", homeLinePeople ? num(homeLinePeople[1]) : undefined],
      ["the CSV export", csvRows ? csvRows.length : undefined],
      ["the workbook export (/org/export)", workbook && Array.isArray(workbook.donors) ? workbook.donors.length : undefined],
      ["the export zip's donors.csv", zipDonors ? parseCsv(zipDonors[1]).length : undefined],
    ]);
  }

  // ── GIFTS AND MONEY ──────────────────────────────────────────────────────
  if (!skip.has("gifts")) {
    // The exports also carry a gift with no person on it (every row the org
    // holds is theirs); no screen counts one, so the comparison is of gifts
    // that have a person.
    const wbGifts = workbook && Array.isArray(workbook.gifts) ? workbook.gifts.filter(g => g.donor_id) : null;
    const zg = zipGifts ? parseCsv(zipGifts[1]).filter(r => r["Donor name"] || r["Donor email"]) : null;
    agree("gift count", [
      ["the database (live people's gifts)", gifts.n],
      ["the onboarding card", setupDonors.giftCount],
      ["Fundraising, all time", fund && fund.allTime ? fund.allTime.giftCount : undefined],
      ["the workbook export", wbGifts ? wbGifts.length : undefined],
      ["the export zip's gifts.csv", zg ? zg.length : undefined],
    ]);
    const listed = list && Array.isArray(list.donors) && list.donors.length === list.total ? list.donors : null;
    const summarised = donorRows[0] && donorRows[0].summarised > 0;
    agree("total given", [
      ["the database (live people's gifts)", Number(gifts.c)],
      ["Fundraising, all time", fund && fund.allTime ? cents(fund.allTime.raised) : undefined],
      ["the workbook export", wbGifts ? wbGifts.reduce((a, g) => a + cents(g.amount), 0) : undefined],
      // A person's lifetime folds in an imported total; only comparable when no one carries one.
      ["the Donors list (sum of lifetime)", listed && !summarised ? listed.reduce((a, d) => a + cents(d.total_giving), 0) : undefined],
      ["the CSV export (sum of Total giving)", csvRows && !summarised ? csvRows.reduce((a, r) => a + cents(r["Total giving"]), 0) : undefined],
    ], money);
  }

  // ── THIS YEAR, AND THE SAME DAYS LAST YEAR ───────────────────────────────
  const today = (lead && lead.today) || (board && board.asOf);
  const fyStart = board && board.fiscalYear && board.fiscalYear.start;
  if (today && fyStart) {
    const w = orgTime.samePointLastYear(fyStart, board.fiscalYear.end, today);
    const sumBetween = async (from, to) => Number((await q(
      `SELECT COALESCE(SUM(ROUND(g.amount*100)),0)::bigint AS c FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
        WHERE d.org_id = $1 AND d.deleted_at IS NULL AND g.date >= $2 AND g.date <= $3`, [orgId, from, to]))[0].c);
    const thisYear = await sumBetween(fyStart, today);
    const lastYear = w ? await sumBetween(w.from, w.to) : 0;
    const metric = k => ((board.metrics || []).find(m => m.key === k) || {}).value;
    const atlasLine = b => (((b && b.request && b.request.lines) || []).find(l => l.kind === "answer") || {}).line || "";
    if (!skip.has("thisYear")) {
      const aY = MONEY_RE.exec(atlasLine(atlasY));
      const askYm = askY && askY.answered !== false ? MONEY_RE.exec(String(askY.sentence || "")) : null;
      agree("giving this year so far", [
        [`the database (${fyStart} to ${today})`, thisYear],
        ["the Board's Giving this year", metric("revenueThisYear") !== undefined ? cents(metric("revenueThisYear")) : undefined],
        ["Fundraising's Raised tile", fund && fund.period && fund.yearMode === "fiscal" ? cents(fund.period.raised) : undefined],
        ["Atlas, asked how much this year", aY ? cents(num(aY[1])) : undefined],
        ["Ask, asked how much this year", askYm ? cents(num(askYm[1])) : undefined],
      ], money);
    }
    if (!skip.has("vsLastYear") && w) {
      // HOME-3: Home says pace once, in the greeting (lead.pace, numbers.vsLastYear).
      const doorLine = (lead && lead.pace && lead.pace.line) || (lead && lead.doors && ((lead.doors.why && lead.doors.why.line) || (lead.doors.what && lead.doors.what.line))) || "";
      const door = /is \$([\d,.]+) (behind|ahead of) last year/.exec(doorLine);
      const seasonal = /^Giving since /.test(doorLine);
      const boardDiff = board.answer && (board.answer.parts || []).find(p => p.figure && p.figure.key === "givingDifference");
      const fp = fund && fund.period;
      const fundCmp = fp && (fp.compare || null);
      agree(`ahead of or behind the same days last year (${w.from} to ${w.to})`, [
        ["the database", thisYear - lastYear],
        ["the Board", boardDiff ? cents(boardDiff.figure.value) : undefined],
        ["Fundraising's Raised tile", fp && fp.priorRaised > 0 && fp.delta !== undefined ? cents(fp.delta) : undefined],
      ], money);
      // Home writes whole dollars ("$63,984"), so it is held to the dollar.
      if (door && !seasonal) {
        const homeCents = (door[2] === "behind" ? -1 : 1) * cents(num(door[1]));
        const dbCents = /\./.test(door[1]) ? thisYear - lastYear : Math.round((thisYear - lastYear) / 100) * 100;
        facts[`ahead of or behind the same days last year (${w.from} to ${w.to})`]["Home's greeting"] = homeCents;
        if (homeCents !== dbCents) diffs.push(`ahead of or behind the same days last year: the database says ${money(thisYear - lastYear)}, Home's greeting says ${money(homeCents)} ("${doorLine}")`);
      }
      // Every "vs last year" says which days it compares.
      if (fp && fp.priorRaised > 0 && !(fundCmp && fundCmp.sentence && fundCmp.lastFrom === w.from && fundCmp.lastTo === w.to)) {
        diffs.push(`vs last year: Fundraising's comparison does not name the span it compares (${JSON.stringify(fundCmp || { priorRaised: fp.priorRaised, delta: fp.delta })}); the Board compares ${w.from} to ${w.to}`);
      }
    }
  }

  // ── FINANCE: MONEY IN IS GIFTS AND THE ROWS THAT WERE NOT GIFTS ──────────
  // INSIGHTS-1: a row she marks Not a gift in Review leaves `gifts` (so every
  // giving check above holds without it) and stays money in, as a Finance line
  // (fin_transactions.source 'not_a_gift'). Finance's twelve months of money
  // in must be both, to the cent; what she marked (insight_reviews) is the
  // ground truth, so a lost Finance line is caught.
  if (!skip.has("finance") && finance && Array.isArray(finance.byMonth) && finance.byMonth.length && finance.month) {
    const from = `${finance.byMonth[0].month}-01`, to = finance.month.to;
    const [fin] = await q(`SELECT
        (SELECT COALESCE(SUM(ROUND(g.amount*100)),0) FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
          WHERE g.org_id = $1 AND d.deleted_at IS NULL AND g.date IS NOT NULL AND g.date <> '' AND g.date >= $2 AND g.date <= $3)
      + (SELECT COALESCE(SUM(ROUND((r.row_data->>'amount')::numeric*100)),0) FROM insight_reviews r LEFT JOIN donors d ON d.id = r.donor_id AND d.org_id = r.org_id
          WHERE r.org_id = $1 AND r.decision = 'not_gift' AND (d.id IS NULL OR d.deleted_at IS NULL)
            AND COALESCE(r.row_data->>'date','') <> '' AND r.row_data->>'date' >= $2 AND r.row_data->>'date' <= $3) AS c`, [orgId, from, to]).catch(() => [{ c: null }]);
    agree(`money in, gifts and the rows that were not gifts (${from} to ${to})`, [
      ["the database (gifts + the rows marked Not a gift)", fin.c == null ? undefined : Number(fin.c)],
      ["Finance's money in by month", finance.byMonth.reduce((a, m) => a + Number(m.cents || 0), 0)],
    ], money);
  }

  // ── HOME'S SENTENCES: a count in a sentence equals the list beside it ────
  for (const card of (lead && lead.lead) || []) {
    const t = `${card.title || ""} ${card.why || ""}`;
    const m = /Here are (\w+) people/.exec(t);
    const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
    if (m && Array.isArray(card.people)) {
      const n = words[m[1].toLowerCase()] || Number(m[1]);
      if (n !== card.people.length) diffs.push(`Home "${card.title}": the sentence says ${n} people, the card lists ${card.people.length}`);
    }
    const dm = /of the ([\d,]+) people drifting/.exec(t);
    if (dm && drift && !drift.__error && lead.role !== "officer" && num(dm[1]) !== drift.total) {
      diffs.push(`drifting: Home says ${num(dm[1])} people, Drift says ${drift.total}`);
    }
  }

  // ── DRIFT AND RE-ENGAGE ──────────────────────────────────────────────────
  if (!skip.has("drift") && drift && !drift.__error) {
    agree("lapsed people", [
      ["the Donors count (/donors/counts lapsed)", counts && counts.lapsed],
      ["the Donors list filtered to lapsed", lapsedList && lapsedList.total],
    ]);
    if (drift.evaluated > people.n) diffs.push(`Drift evaluated ${drift.evaluated} people, the org holds ${people.n}`);
  }

  // ── GROUPS, EVENTS, CAMPAIGNS ────────────────────────────────────────────
  if (!skip.has("groups") && groups && Array.isArray(groups.groups)) {
    for (const g of groupRows) {
      const shown = groups.groups.find(x => x.id === g.id);
      if (shown && shown.count !== g.live) diffs.push(`group "${g.name}": the Groups page says ${shown.count} members, the database holds ${g.live} live members`);
    }
  }
  if (!skip.has("events") && Array.isArray(events)) {
    for (const e of eventRows) {
      const shown = events.find(x => x.id === e.id);
      if (!shown) continue;
      // attendee_count is who attended; invited_count is every live row.
      const inv = shown.invited_count, att = shown.attendee_count;
      if (typeof inv === "number" && inv !== e.live) diffs.push(`event "${e.name}": the Events page says ${inv} on the list, the database holds ${e.live} live`);
      if (typeof att === "number" && att !== e.attended) diffs.push(`event "${e.name}": the Events page says ${att} attended, the database holds ${e.attended} live`);
    }
  }
  if (!skip.has("campaigns") && Array.isArray(campaigns)) {
    for (const c of campaignRows) {
      const goal = ((fund && fund.goals) || []).find(x => x.id === c.id);
      const gr = goal ? (goal.giftRaised ?? goal.raised) : undefined;
      if (gr !== undefined && cents(gr) !== Number(c.raised)) diffs.push(`campaign "${c.name}": Fundraising's goals say ${money(cents(gr))} raised, its live gifts in its dates are ${money(Number(c.raised))}`);
    }
  }

  if (!skip.has("campaigns")) {
    for (const p of pageRows) {
      const shown = ((fund && fund.givingPages && fund.givingPages.pages) || []).find(x => x.id === p.id);
      if (shown && cents(shown.raised) !== Number(p.raised)) diffs.push(`giving page "${p.title}": Fundraising says ${money(cents(shown.raised))} raised, its live people's gifts are ${money(Number(p.raised))}`);
    }
  }

  // ── THE MOVE REPORT: what Steward holds is live people's gifts ───────────
  if (!skip.has("moveReport") && Array.isArray(reports)) {
    for (const [imp, body] of reports) {
      if (!body || !body.held) continue;
      // The held side is the whole move (TRANS-1): this run and every earlier
      // run from the same old system, and it counts no deleted person's gift.
      let ids = [imp.id];
      if (imp.migration_source) {
        ids = [];
        for (const r of imports.filter(x => x.migration_source === imp.migration_source)) { ids.push(r.id); if (r.id === imp.id) break; }
      }
      const [h] = await q(`SELECT COUNT(*)::int AS n, COALESCE(SUM(ROUND(g.amount*100)),0)::bigint AS c
                             FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
                            WHERE g.org_id = $1 AND g.import_id = ANY($2) AND d.deleted_at IS NULL`, [orgId, ids]);
      if (body.held.gifts !== h.n || body.held.cents !== Number(h.c)) {
        diffs.push(`Move Report for ${imp.id}: says Steward holds ${body.held.gifts} gifts, ${money(body.held.cents)}; live people hold ${h.n} gifts, ${money(Number(h.c))} from ${ids.length === 1 ? "this import" : `these ${ids.length} imports`}`);
      }
      const headline = body.moveReport && body.moveReport.headline;
      if (headline) {
        const scoped = ids.length > 1 ? /whole move/i.test(headline) : /this file/i.test(headline);
        if (!scoped) diffs.push(`Move Report for ${imp.id}: the headline "${headline}" does not say it compares ${ids.length > 1 ? `the whole move (${ids.length} imports)` : "this file"}`);
      }
    }
  }

  // ── DELETED PEOPLE APPEAR NOWHERE ────────────────────────────────────────
  if (!skip.has("deleted") && deletedIds.size) {
    const payloads = { "the Donors list": list, "Home": lead, "Home's dashboard": dashHome, "Fundraising": fund, "Drift": drift,
      "Atlas": atlasN, "Ask": askN, "the workbook export's donors": workbook && workbook.donors, "the workbook export's gifts": workbook && workbook.gifts };
    for (const [name, p] of Object.entries(payloads)) {
      if (!p) continue;
      for (const [path, v] of leaves(p)) {
        if (typeof v === "string" && deletedIds.has(v)) { diffs.push(`deleted person ${v}: ${name} still shows them (${path})`); break; }
      }
    }
    // An address a live person also holds (a merge keeps both) is theirs.
    const liveEmails = new Set((await q(`SELECT LOWER(email) AS e FROM donors d WHERE ${LIVE} AND email IS NOT NULL
                                         UNION SELECT LOWER(email2) FROM donors d WHERE ${LIVE} AND email2 IS NOT NULL`, [orgId])).map(r => r.e));
    const emails = new Set(deleted.map(d => String(d.email || "").toLowerCase()).filter(e => e && !liveEmails.has(e)));
    for (const r of csvRows || []) if (emails.has(String(r.Email || "").toLowerCase())) { diffs.push(`deleted person ${r.Email}: the CSV export still lists them`); break; }
    for (const [d, body] of Array.isArray(searches) ? searches : []) {
      const hit = ((body && body.results) || []).find(x => x.id === d.id || x.donorId === d.id);
      if (hit) diffs.push(`deleted person ${d.name}: search still finds them (${hit.kind} ${hit.id})`);
    }
  }

  // ── ASK AND ATLAS: a number in the answer is the number it names ─────────
  // "How many donors" is answered as the people who gave this year, and says
  // so; the number must be the Board's People who gave.
  const answerLine = b => (((b && b.request && b.request.lines) || []).find(l => l.kind === "answer") || {}).line || "";
  const donorCount = board && ((board.metrics || []).find(m => m.key === "donorCount") || {}).value;
  const gave = s => /([\d,]+) (?:people|person|donors?) gave this year/.exec(String(s || ""));
  const askG = !skip.has("ask") && askN && askN.answered !== false ? gave(askN.sentence) : null;
  const atlasG = !skip.has("atlas") ? gave(answerLine(atlasN)) : null;
  if (!skip.has("ask") && askN && askN.answered === false) diffs.push(`Ask could not answer "${ASK_N}": ${askN.sentence}`);
  agree("people who gave this year", [["the Board's People who gave", donorCount],
    ["Ask, asked how many donors", askG ? num(askG[1]) : undefined], ["Atlas, asked how many donors", atlasG ? num(atlasG[1]) : undefined]]);

  for (const [name, b] of [["the Donors list", list], ["Home", lead], ["Fundraising", fund], ["the Board", board], ["the workbook export", workbook]]) {
    if (b && b.__error) diffs.push(`${name} did not answer: ${b.__error}`);
    else if (b && b.error) diffs.push(`${name} answered an error: ${JSON.stringify(b).slice(0, 200)}`);
  }

  const out = { ok: diffs.length === 0, diffs, facts, ms: Date.now() - t0 };
  if (!out.ok && !ctx.soft) {
    const e = new Error(`surfaces disagree${label ? ` (${label})` : ""} in ${orgId}:\n  - ${diffs.join("\n  - ")}`);
    e.diffs = diffs; e.facts = facts;
    throw e;
  }
  return out;
}

module.exports = { assertSurfacesAgree };
