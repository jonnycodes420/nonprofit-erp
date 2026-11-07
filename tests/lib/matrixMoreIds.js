// REDTEAM-1 — the rows the tenant matrix needs for the routes it could not
// see until the inventory read every route module (85 of them). One row per
// table, per org, with the `<prefix>_<org>` id shape, so §3 aims org A's token
// at org B's REAL row and §8 can fill each write path with org A's twin.
// Org B's rows carry the private marker (ZZMARKB) wherever there is text, so a
// body that hands any of it to org A is caught by the leak scan.
//
//   seed(q, o, tag)            insert this org's rows (called from seedOrg)
//   resolve(routePath, param, B)  org B's id for one path param, or undefined
//                                 when this module does not own that param
const { civilDay } = require("../clock");

const colsOf = new Map();
async function cols(q, table) {
  if (!colsOf.has(table)) {
    const rows = await q(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [table]);
    colsOf.set(table, new Set(rows.map(r => r.column_name)));
  }
  return colsOf.get(table);
}
// One row. Columns the table does not have are dropped (a schema that moves
// on does not break the seed), the actor stamp is added where the table keeps
// one, and a failure is printed with its table, never swallowed silently.
async function ins(q, table, row) {
  const have = await cols(q, table);
  const r = { ...row };
  if (have.has("created_by") && r.created_by === undefined) r.created_by = "system:test";
  if (have.has("created_by_name") && r.created_by_name === undefined) r.created_by_name = "test";
  const keys = Object.keys(r).filter(k => have.has(k));
  const vals = keys.map(k => (r[k] !== null && typeof r[k] === "object" && !(r[k] instanceof Date)) ? JSON.stringify(r[k]) : r[k]);
  await q(`INSERT INTO "${table}" (${keys.join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")}) ON CONFLICT DO NOTHING`, vals)
    .catch(e => console.error(`matrixMoreIds seed ${table}:`, e.message));
}

async function seed(q, o, tag) {
  const mark = tag === "b" ? "ZZMARKB" : "Plain";
  const today = civilDay();
  const d = `d_${o}`, admin = `u_${o}_admin`;
  // MAIL-TYPES — one automatic email sent, and one held for a person to send.
  await ins(q, "auto_mail_sent", { id: `ams_${o}`, org_id: o, type_key: "thank_you", kind: "supporter", donor_id: d,
    subject: `${mark} sent subject`, html: `<p>${mark} sent body</p>` });
  await ins(q, "mail_blocked", { id: `mblk_${o}`, org_id: o, donor_id: d, kind: "supporter", what: `${mark} held`,
    subject: `${mark} held subject`, payload: { to: `held-${tag}@mx.local`, subject: `${mark} held subject`, html: `<p>${mark} held body</p>` },
    dedupe_key: `mblk_${o}`, held_reason: "org_mail_off" });
  // SURVEYS — a survey with one answer.
  await ins(q, "surveys", { id: `svy_${o}`, org_id: o, slug: `svy-${tag}`, title: `${mark} Survey`, intro: `${mark} intro`,
    sections: [], status: "draft" });
  await ins(q, "survey_responses", { id: `svr_${o}`, org_id: o, survey_id: `svy_${o}`, anonymous: false, donor_id: d,
    respondent_name: `${mark} Respondent`, answers: { q1: `${mark} answer` } });
  // ASK — a question pinned by this org's admin (the matrix's own token is the admin).
  await ins(q, "ask_pins", { id: `apin_${o}`, org_id: o, user_id: admin, question: `${mark} pinned question`, plan: {} });
  // DATA HEALTH — an import's duplicate notice, and a merge (already undone, so
  // org A's own twin under §8 is refused rather than rewriting two people).
  await ins(q, "data_health_runs", { id: `dhr_${o}`, org_id: o, trigger: "import", counts: {}, new_duplicates: 9 });
  await ins(q, "donor_merges", { id: `dmg_${o}`, org_id: o, kept_id: d, merged_id: `ds_${o}`, kept_name: `${mark} Donor`,
    merged_name: "Shared Person", kept_before: {}, merged_before: {}, moved: {}, undone_at: new Date().toISOString() });
  // GRANTS — a funder contact, a checklist task, a library piece and its
  // version, a send and a report, all on this org's grant.
  await ins(q, "donor_relationships", { id: `drc_${o}`, org_id: o, donor_id_a: d, donor_id_b: `ds_${o}`, relationship_type: "program_officer" });
  await ins(q, "tasks", { id: `tgc_${o}`, org_id: o, title: `${mark} checklist item`, due: today, priority: "normal", done: 0, grant_id: `gr_${o}` });
  await ins(q, "grant_library", { id: `glib_${o}`, org_id: o, kind: "mission", title: `${mark} Mission`, body: `${mark} library text`, version: 1 });
  await ins(q, "grant_library_versions", { id: `glv_${o}`, org_id: o, piece_id: `glib_${o}`, version: 1, title: `${mark} Mission`, body: `${mark} library text` });
  await ins(q, "grant_reports", { id: `grpt_${o}`, org_id: o, grant_id: `gr_${o}`, title: `${mark} Grant report`, status: "draft",
    sections: [], figures: {}, version: 1 });
  await ins(q, "grant_sends", { id: `gsnd_${o}`, org_id: o, grant_id: `gr_${o}`, funder_donor_id: d, what: "other", subject: `${mark} send`,
    sent_on: today, source: "manual" });
  // SHEETS — a kept grant-import file. Its grant list is empty, so the undo
  // under §8 takes nothing of org A's off.
  await ins(q, "stored_sheets", { id: `sht_${o}`, org_id: o, kind: "grant_import", title: `${mark} Sheet`, file_name: `${mark}.csv`,
    content_type: "text/csv", bytes: 10, headers: ["a"], rows: [[`${mark} cell`]], grant_ids: [] });
  // EMAILS SENT — a sequence step 1, and a journey email that went.
  await ins(q, "sequence_steps", { id: `sqs_${o}`, sequence_id: `sq_${o}`, step_order: 1, delay_days: 0, subject: `${mark} step`, body: `${mark} step body` });
  await ins(q, "milestone_drafts", { id: `mds_${o}`, org_id: o, donor_id: d, milestone_key: "threshold_500", subject: `${mark} sent journey`,
    body: `${mark} sent journey body`, status: "sent", sent_at: new Date().toISOString() });
  // CAPTURE — a scanned item waiting, low stakes.
  await ins(q, "capture_items", { id: `cap_${o}`, org_id: o, kind: "letter", stakes: "low", status: "waiting", source: "upload",
    headline: `${mark} capture`, sentence: `${mark} capture sentence` });
  // SETUP — a file on this org's setup run.
  await ins(q, "setup_files", { id: `sf_${o}`, org_id: o, run_id: `sr_${o}`, name: `${mark}.txt`, body: JSON.stringify({ text: `${mark} setup file` }), bytes: 10 });
  // VOICE / ATLAS — one Atlas request (a voice_memos row; /voice/memos reads
  // the same table) with one card already decided, and one action on it.
  await ins(q, "voice_memos", { id: `vm_${o}`, org_id: o, text: `${mark} memo`, source: "atlas", status: "done", donor_ids: [d],
    read: {}, cards: [{ id: "card1", state: "done", kind: "note", line: `${mark} card` }], run_ids: [] });
  await ins(q, "atlas_actions", { id: `aact_${o}`, org_id: o, request_id: `vm_${o}`, card_id: "card1", kind: "note", state: "done",
    line: `${mark} action`, donor_id: d, undoable: false, actor_id: "system:test", actor_name: "test" });
  // PRIVACY — a client mark and an email removal, each with nothing to put back.
  await ins(q, "client_marks", { id: `cmk_${o}`, org_id: o, source: "manual", donor_ids: [] });
  await ins(q, "client_email_removals", { id: `cer_${o}`, org_id: o, donor_id: d, count: 0, rows: [] });
  // EMAIL TEMPLATES — one template.
  await ins(q, "email_templates", { id: `etpl_${o}`, org_id: o, name: `${mark} Template`, purpose: "thank_you", subject: `${mark} subject`,
    blocks: [{ type: "text", text: `${mark} block` }] });
  // INSIGHTS — a review of this org's gift ("it is a gift", nothing to restore).
  await ins(q, "insight_reviews", { org_id: o, gift_id: `g_${o}`, decision: "gift", donor_id: d });
  // READOUTS — one readout.
  await ins(q, "readouts", { id: `rdo_${o}`, org_id: o, source_kind: "manual", title: `${mark} Readout`, headline: `${mark} headline`,
    lines: [{ kind: "new_donors", sentence: `${mark} line`, rows: [] }], for_date: today });
  // SHEET IMPORT — a saved column mapping and a finished job.
  await ins(q, "import_shape_mappings", { id: `ism_${o}`, org_id: o, shape_key: `shape_${o}`, headers: ["Name"], mapping: { Name: "name" }, kind: "sheet" });
  await ins(q, "sheet_import_jobs", { id: `sij_${o}`, org_id: o, request_key: `rk_${o}`, status: "done", phase: "done", done: 1, total: 1,
    file_name: `${mark}.csv`, result: { note: `${mark} result` } });
  // AUCTIONS — a refund flag on this org's item.
  await ins(q, "auction_refund_flags", { id: `arf_${o}`, org_id: o, auction_id: `auc_${o}`, item_id: `aui_${o}`, stripe_payment_id: `pi_${o}`,
    amount: 10, payer_name: `${mark} Payer`, payer_email: `payer-${tag}@mx.local`, donor_id: d });
}

// org B's id for one param. Paths are matched by prefix; a param this module
// does not own returns undefined, and bResolver goes on as before.
function resolve(p, n, B) {
  const R = [
    [/^\/going-out\/sent\//, { id: `ams_${B}` }],
    [/^\/going-out\/held\//, { id: `mblk_${B}` }],
    [/^\/donors\/:id\/blocked-mail\/:bid/, { bid: `mblk_${B}` }],
    [/^\/donors\/:id\/emails-received\/:kind\/:ref/, { kind: "journey", ref: `mds_${B}` }],
    [/^\/surveys\//, { id: `svy_${B}` }],
    [/^\/pictures\//, { kind: "event_level", id: `evl_${B}` }],
    [/^\/ask\/pins\//, { id: `apin_${B}` }],
    [/^\/data-health\/notice\//, { id: `dhr_${B}` }],
    [/^\/data-health\/merges\//, { id: `dmg_${B}` }],
    [/^\/grant-funders\/contacts\//, { relId: `drc_${B}` }],
    [/^\/grant-funders\//, { id: `d_${B}` }],
    [/^\/grants\/checklist\//, { taskId: `tgc_${B}` }],
    [/^\/grant-library\//, { id: `glib_${B}` }],
    [/^\/grant-sends\//, { id: `gsnd_${B}` }],
    [/^\/grant-reports\//, { id: `grpt_${B}` }],
    [/^\/funders\/:id\//, { id: `d_${B}` }],
    [/^\/sheets\//, { id: `sht_${B}` }],
    [/^\/sequences\/:id\/steps\/:order/, { order: "1" }],
    [/^\/emails\/journey\//, { draftId: `mds_${B}` }],
    [/^\/capture\/:id\/(?!settled)/, { id: `cap_${B}` }],
    [/^\/setup\/runs\/:id\/files\//, { fileId: `sf_${B}` }],
    [/^\/voice\/memos\//, { id: `vm_${B}`, cardId: "card1" }],
    [/^\/atlas\/actions\//, { id: `aact_${B}` }],
    [/^\/atlas\/:id/, { id: `vm_${B}` }],
    [/^\/privacy\/marks\//, { id: `cmk_${B}` }],
    [/^\/privacy\/removals\//, { id: `cer_${B}` }],
    [/^\/email-templates\//, { id: `etpl_${B}` }],
    [/^\/insights\/donor\//, { id: `d_${B}` }],
    [/^\/insights\/review\//, { giftId: `g_${B}` }],
    [/^\/readouts\//, { id: `rdo_${B}`, kind: "new_donors" }],
    [/^\/import-mappings\//, { id: `ism_${B}` }],
    [/^\/sheet-import\/jobs\//, { id: `sij_${B}` }],
    [/^\/auction-refund-flags\//, { id: `arf_${B}` }],
    // A removal names a KIND from removal.js's registry and that kind's row.
    [/^\/removals\/:kind/, { kind: "membership_level", id: `mbl_${B}` }],
    [/^\/volunteer-hub\/removals\/:kind/, { kind: "shift", id: `vslot_${B}` }],
    [/^\/org\/invites\//, { id: `inv_${B}` }],
  ];
  for (const [re, map] of R) if (re.test(p)) return map[n];
  return undefined;
}

module.exports = { seed, resolve };
