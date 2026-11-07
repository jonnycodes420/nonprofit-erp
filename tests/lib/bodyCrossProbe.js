// tests/lib/bodyCrossProbe.js — REDTEAM-1 item 1: org B's ids IN THE BODY.
//
// The matrix's §3 puts org B's ids in the PATH. An attacker puts them in the
// BODY: a gift written by org A on org B's donor, a merge that keeps org B's
// person, a group member, a journey enrolment or a soft credit pointing across
// the wall. This walks every authenticated write route in the live router and
// sends org A's admin's request with every id-shaped field set to org B's real
// rows (and the route's own path params on org A's rows, so the route reaches
// its write). Then it reads the database, not the status code:
//
//   - no row of org A's may point at a row of org B's (every table with an
//     org_id, every column, matched on B's id marker), and
//   - org B's row count in every org_id table is unchanged (the matrix's §5
//     hash covers the contents of the main tables).
//
// THE GATE: every authenticated write route is body-probed, or carries a
// reasoned entry in BODY_EXEMPT. A new write route is probed tomorrow with no
// one remembering to add it, exactly as §1 does for path params.

// Every id-shaped field name a write route might read, to org B's real row.
// Matched on the name with underscores taken out, lowercased.
function bodyFor(B) {
  const one = {
    donorid: `d_${B}`, personid: `d_${B}`, primarydonorid: `d_${B}`, relateddonorid: `d_${B}`,
    primaryid: `d_${B}`, secondaryid: `d_${B}`, keepid: `d_${B}`, mergeid: `d_${B}`, keep: `d_${B}`,
    creditdonorid: `d_${B}`, softcreditdonorid: `d_${B}`, matchingdonorid: `d_${B}`, honoreeid: `d_${B}`,
    giftid: `g_${B}`, pledgeid: `pl_${B}`, grantid: `gr_${B}`, campaignid: `c_${B}`, fundid: `fnd_${B}`,
    defaultfundid: `fnd_${B}`, eventid: `ev_${B}`, householdid: `h_${B}`, groupid: `grp_${B}`,
    templateid: `ct_${B}`, journeyid: `ct_${B}`, taskid: `t_${B}`, opportunityid: `op_${B}`,
    proposalid: `op_${B}`, officerid: `u_${B}_staff`, assignedto: `u_${B}_staff`, userid: `u_${B}_staff`,
    sequenceid: `sq_${B}`, levelid: `mbl_${B}`, membershiplevelid: `mbl_${B}`, attendeeid: `ea_${B}`,
    volunteerid: `v_${B}`, pageid: `gp_${B}`, givingpageid: `gp_${B}`, accountid: `acct_${B}`,
    subscriptionid: `rs_${B}`, recurparentid: `rs_${B}`, interactionid: `i_${B}`, auctionid: `auc_${B}`,
    programid: `prg_${B}`, receiptid: `rc_${B}`, planid: `cp_${B}`, threadid: `th_${B}`,
    importid: `imp_${B}`, teamid: `pt_${B}`, slotid: `vslot_${B}`, batchid: `jb_${B}`,
    parentgoalid: `c_${B}`, captainfundraiserid: `pf_${B}`, audienceid: `aud_${B}`, listviewid: `lv_${B}`,
  };
  const many = {
    ids: [`d_${B}`], donorids: [`d_${B}`], personids: [`d_${B}`], memberids: [`d_${B}`],
    giftids: [`g_${B}`], attendeeids: [`ea_${B}`], planids: [`cp_${B}`], draftids: [`ty_${B}`],
    taskids: [`t_${B}`], pledgeids: [`pl_${B}`], groupids: [`grp_${B}`],
  };
  // The spray: both spellings of each, so a route reading donor_id or donorId
  // gets org B's row either way.
  const spray = {};
  const snake = k => k.replace(/id$/, "_id").replace(/ids$/, "_ids");
  const camel = { donorid: "donorId", personid: "personId", giftid: "giftId", pledgeid: "pledgeId", grantid: "grantId",
    campaignid: "campaignId", fundid: "fundId", eventid: "eventId", householdid: "householdId", groupid: "groupId",
    templateid: "templateId", taskid: "taskId", opportunityid: "opportunityId", officerid: "officerId",
    assignedto: "assignedTo", userid: "userId", levelid: "levelId", attendeeid: "attendeeId", pageid: "pageId",
    accountid: "accountId", primarydonorid: "primaryDonorId", relateddonorid: "relatedDonorId", keepid: "keepId",
    mergeid: "mergeId", primaryid: "primaryId", secondaryid: "secondaryId", planid: "planId", threadid: "threadId",
    subscriptionid: "subscriptionId", interactionid: "interactionId", volunteerid: "volunteerId",
    creditdonorid: "creditDonorId", honoreeid: "honoreeId", journeyid: "journeyId", sequenceid: "sequenceId",
    defaultfundid: "defaultFundId", membershiplevelid: "membershipLevelId", givingpageid: "givingPageId" };
  for (const [k, v] of Object.entries(one)) { spray[camel[k] || k] = v; spray[snake(k)] = v; }
  spray.keep = `d_${B}`; spray.from = `d_${B}`; spray.to = `d_${B}`; spray.into = `d_${B}`; spray.id = `d_${B}`;
  spray.donorIds = [`d_${B}`]; spray.donor_ids = [`d_${B}`]; spray.ids = [`d_${B}`]; spray.memberIds = [`d_${B}`];
  spray.giftIds = [`g_${B}`]; spray.gift_ids = [`g_${B}`]; spray.attendeeIds = [`ea_${B}`]; spray.personIds = [`d_${B}`];
  spray.softCredits = [{ donorId: `d_${B}`, donor_id: `d_${B}`, amount: 1 }];
  spray.splits = [{ fundId: `fnd_${B}`, fund_id: `fnd_${B}`, amount: 1 }];
  spray.merges = [{ keepId: `d_${A_OF(B)}`, mergeId: `d_${B}` }];
  // The values a write needs to get past validation, so the probe reaches the
  // lookup and not a 400 on a missing amount.
  Object.assign(spray, { amount: 25, date: "2026-11-04", name: "Body Probe", title: "Body Probe", type: "cash",
    subject: "Body Probe", body: "Body Probe", note: "Body Probe" });
  // ONE ENTITY AT A TIME as well. The spray names every kind of row at once,
  // so the first org check that refuses (an unknown campaign, say) answers 404
  // before the route ever reads the fund: a planted defect on the fund check
  // stayed green under the spray alone. Each body here carries one of org B's
  // rows, in every spelling, plus what a write needs to get past validation.
  const base = { amount: 25, date: "2026-11-04", name: "Body Probe", title: "Body Probe", type: "cash",
    subject: "Body Probe", body: "Body Probe", note: "Body Probe" };
  const byEntity = new Map();
  for (const [k, v] of Object.entries(spray)) {
    const id = typeof v === "string" && v.includes(B) ? v : Array.isArray(v) && typeof v[0] === "string" && v[0].includes(B) ? v[0] : null;
    if (!id) continue;
    if (!byEntity.has(id)) byEntity.set(id, { ...base });
    byEntity.get(id)[k] = v;
  }
  byEntity.get(`d_${B}`).softCredits = spray.softCredits;
  byEntity.get(`fnd_${B}`).splits = spray.splits;
  const entities = [...byEntity.values()];
  return { one, many, spray, entities };
}
const A_OF = B => B.replace(/b$/, "a");

// Path params on ORG A's own rows: the matrix's resolver gives org B's, and
// every fixture id is `<prefix>_<org>`, so swapping the org gives A's twin.
const aSide = (bResolver, A, B) => (p, n) => {
  if (n === "provider") return /^\/email-marketing\//.test(p) ? "mailchimp" : "gmail";
  if (/^\/org\/users\/:id\//.test(p) && n === "id") return `u_${A}_staff`;
  const v = bResolver(p, n);
  return v == null ? null : String(v).split(B).join(A);
};

// Routes the spray does not reach, each with the reason a reviewer can audit.
// Anything authenticated, written to, and neither probed nor listed FAILS.
const BODY_EXEMPT = [
  [/^\/auth\//, "sign-in, sign-out and token doors: no org row is addressed by id in the body"],
  [/^\/me(\/|$)/, "the caller's own account; the matrix §3 crosses its row-id paths"],
  [/^\/admin\//, "super-admin only (requireSuperAdmin, crossed by §2), all-org by design"],
  [/^\/ops(\/|$)/, "super-admin only, all-org by design"],
  [/^\/support\//, "SUPPORT-1: the help assistant and support sessions, no org rows addressed by id"],
  [/^\/mail-types\/:key$/, "a key from the fixed registry in mailTypes.js; turns a type on or off for the caller's own org, reads only `on` and `audience`"],
  [/^\/groups\/starters\/:key$/, "a key from a fixed starter registry; makes a group in the caller's own org from it, no ids read from the body"],
  [/^\/stock-photos\/:id\/use$/, "a bundled stock-photo catalog id, not an org row (exempt in the matrix's PARAM_EXEMPT for the same reason)"],
];

async function runBodyCrossProbe({ inv, mfetch, q, ok, A, B, tok, bResolver, fillPath, scanLeak, keyOf }) {
  console.log("\n— §8 · REDTEAM-1: org B's ids in the BODY of every write —");
  const { spray, entities } = bodyFor(B);
  const aRes = aSide(bResolver, A, B);
  const tables = (await q(`SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
    WHERE c.column_name = 'org_id' AND c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
    ORDER BY c.table_name`)).map(r => r.table_name);
  // Tables that record what a request SENT rather than link to it: the audit
  // trail, the custom-field change log (it notes the ids a reorder was given;
  // the UPDATE itself is org-scoped), and the job queue (the score recompute
  // carries the ids a write named; scorePeople reads them `WHERE org_id = ?`, so
  // org B's id is dropped as not found). The B-count and the §5 hash catch any
  // write those records could cause.
  const SCAN_SKIP = new Set(["audit_log", "audit_logs", "custom_field_events", "job_queue"]);
  const mark = B.toLowerCase();
  async function aRowsPointingAtB() {
    // One statement over every table, so a per-route read stays cheap.
    const sql = tables.filter(t => !SCAN_SKIP.has(t)).map(t =>
      `SELECT '${t}' AS t, COUNT(*)::int AS n FROM "${t}" x WHERE x.org_id = $1 AND lower(x::text) LIKE $2`).join(" UNION ALL ");
    const out = {};
    for (const { t, n } of await q(sql, [A, `%${mark}%`])) if (n) out[t] = n;
    return out;
  }
  async function bCounts() {
    const sql = tables.map(t => `SELECT '${t}' AS t, COUNT(*)::int AS n FROM "${t}" WHERE org_id = $1`).join(" UNION ALL ");
    const out = {};
    for (const { t, n } of await q(sql, [B])) out[t] = n;
    return out;
  }
  // §7 sends org A a signed Stripe gift carrying org B's donor's EMAIL on
  // purpose, so org A rightly has a person with that address. It is org A's
  // own row; renamed here so the leak scan reads only what §8 caused.
  await q(`UPDATE donors SET email = 'webhook-probe@mx.local' WHERE org_id = $1 AND lower(email) LIKE 'donor-zzmarkb%'`, [A]);
  await q(`DELETE FROM mail_blocked WHERE org_id = $1 AND lower(mail_blocked::text) LIKE '%zzmarkb%'`, [A]).catch(() => {});
  const before = await aRowsPointingAtB();
  const bBefore = await bCounts();

  const probed = new Set(), unprobed = [], twoXX = [];
  const writes = inv.filter(r => r.method !== "GET" && r.method !== "HEAD" && r.auth.includes("requireAuth") && !r.auth.includes("requireSuperAdmin"));
  // Each route alone, and the table it wrote to read right after, so a
  // failure names the route that crossed, not just "something did".
  const crossed = [];
  for (const r of writes) {
    const key = keyOf(r);
    if (BODY_EXEMPT.some(([re]) => re.test(r.path))) continue;
    const { out, unresolved } = fillPath(r.path, aRes);
    if (unresolved.length) { unprobed.push(`${key} (path :${unresolved.join(", :")})`); continue; }
    // Two bodies: the spray, and the route's own scanned fields alone (a route
    // that refuses an unknown field would otherwise never reach its lookup).
    const own = {};
    const { one, many } = bodyFor(B);
    for (const f of r.params.body) {
      const k = f.replace(/_/g, "").toLowerCase();
      if (one[k]) own[f] = one[k]; else if (many[k]) own[f] = many[k];
    }
    const bodies = [spray, ...(Object.keys(own).length ? [{ ...own, amount: 25, date: "2026-11-04", name: "Body Probe" }] : []),
      ...(r.method === "DELETE" ? [] : entities)];
    for (const body of bodies) {
      const res = await mfetch(r.method, out, tok, body);
      if (res.status >= 200 && res.status < 300) twoXX.push(key);
      scanLeak(r, "cross-tenant-body", res.text);
    }
    probed.add(key);
    // Cheap per-route check on the tables a write most often lands in.
    const now = await aRowsPointingAtB();
    for (const [t, n] of Object.entries(now)) if (n > (before[t] || 0)) { crossed.push(`${key} → ${t} (+${n - (before[t] || 0)})`); before[t] = n; }
  }
  const bAfter = await bCounts();
  const bChanged = Object.keys(bAfter).filter(t => bAfter[t] !== bBefore[t]).map(t => `${t}: ${bBefore[t]}→${bAfter[t]}`);

  if (crossed.length) for (const c of crossed) console.log("  BODY-CROSS  " + c);
  ok(`no write route left a row of org A's pointing at org B's (${probed.size} routes body-probed, ${crossed.length} crossed)`,
     crossed.length === 0, crossed.slice(0, 20));
  ok(`org B's row count is unchanged in every org table (${tables.length} tables)`, bChanged.length === 0, bChanged.slice(0, 20));
  ok(`coverage: every authenticated write route is body-probed or in BODY_EXEMPT (${unprobed.length} not): [${unprobed.slice(0, 15).join("; ")}]`,
     unprobed.length === 0, unprobed);
  ok(`the body probe ran at scale (${probed.size} write routes ≥ 300)`, probed.size >= 300, probed.size);
  return { probed, crossed, unprobed, twoXX };
}

module.exports = { runBodyCrossProbe, bodyFor, BODY_EXEMPT };
