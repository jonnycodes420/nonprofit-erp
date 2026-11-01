#!/usr/bin/env node
// SECURE-3 item 2 · Seal the synced mail that was stored before sealing existed.
//
// Before SECURE-3 a Gmail or Outlook read wrote each email's text into
// interactions.note ("<the line>\n\n<the body>") and kept a funder's or a
// pledge form's attachment as plain bytes (portal_assets). New mail is sealed
// as it is written (server/mail/sealedMail.js). This script does the rows that
// are already there:
//
//   • an email row the mailbox read wrote (created_by system:mailbox/…) whose
//     body is still in `note`: `note` becomes the line, the body is sealed into
//     body_sealed with this row's own data key, wrapped by the current mail key
//   • an attachment a mailbox read kept (grant_documents source 'mailbox',
//     capture_items from a mailbox message): its bytes are sealed in place,
//     same id, same URL (assetStore.sealAssetInPlace)
//   • ROTATION: a row sealed under an older key id is rewrapped under the
//     current one (STEWARD_MAIL_KEYS' first entry). Only the 32-byte data key is
//     rewrapped; the mail itself is not re-encrypted
//
// DRY RUN BY DEFAULT: it counts and writes nothing. `--apply` writes, in
// batches (--batch=200), keyset-paged so it always finishes. Idempotent: a
// second run finds nothing to do. It prints counts and row ids only, never a
// word of any email or a byte of any file. It never runs at deploy.
//
//   DATABASE_URL=… STEWARD_CREDENTIAL_KEY=… node scripts/ops/seal-synced-mail.js [--org=<id>]
//   DATABASE_URL=… STEWARD_CREDENTIAL_KEY=… node scripts/ops/seal-synced-mail.js --apply --i-know-this-is-prod
//   (with S3 in use, the PORTAL_ASSETS_S3_* variables too; while rotating,
//    STEWARD_MAIL_KEYS="k2:<new>,k1:<old>")
//
// --apply resolves its database through scripts/lib/prodGuard.js: a remote
// DATABASE_URL needs --i-know-this-is-prod as well. The key must be the one the
// server runs with, or what this seals the server cannot open.
"use strict";

const apply = process.argv.includes("--apply");
const batchArg = process.argv.find(a => a.startsWith("--batch="));
const BATCH = Math.max(1, Math.min(1000, parseInt(batchArg ? batchArg.slice(8) : "200", 10) || 200));
// --org=<id> limits every count and write to one organisation (try one first).
const orgArg = process.argv.find(a => a.startsWith("--org="));
const ORG = orgArg ? orgArg.slice(6) : null;
if (apply) process.env.DATABASE_URL = require("../lib/prodGuard").writerDbUrl();

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Every WHERE below carries the org filter; ORG is bound as a parameter, never pasted.
const IN_ORG = "(?::text IS NULL OR org_id = ?)";
// The rows a mailbox read wrote whose body is still in `note`.
const BODY_WHERE = `type = 'email' AND body_sealed IS NULL AND created_by LIKE 'system:mailbox/%'
                    AND position(E'\\n\\n' in COALESCE(note, '')) > 0 AND ${IN_ORG}`;
// The files a mailbox read kept.
const MAIL_ASSETS = `SELECT asset_id FROM grant_documents WHERE source = 'mailbox' AND asset_id IS NOT NULL
                     UNION SELECT asset_id FROM capture_items WHERE source = 'email' AND asset_id IS NOT NULL
                                                             AND source_ref ~ '^(google|microsoft):'`;

(async () => {
  const SM = require("../../server/mail/sealedMail");
  const AS = require("../../assetStore");
  const { query, run } = require("../../db");
  const current = SM.currentKeyId();
  const problem = SM.mailKeyProblem();

  const O = [ORG, ORG];
  const [b] = await query(`SELECT COUNT(*)::int AS n FROM interactions WHERE ${BODY_WHERE}`, O);
  const [a] = await query(`SELECT COUNT(*)::int AS n FROM portal_assets WHERE sealed_header IS NULL AND id IN (${MAIL_ASSETS}) AND ${IN_ORG}`, O);
  const [rb] = current ? await query(`SELECT COUNT(*)::int AS n FROM interactions WHERE body_sealed IS NOT NULL AND body_key_id IS DISTINCT FROM ? AND ${IN_ORG}`, [current, ...O]) : [{ n: 0 }];
  const [ra] = current ? await query(`SELECT COUNT(*)::int AS n FROM portal_assets WHERE sealed_header IS NOT NULL AND sealed_key_id IS DISTINCT FROM ? AND ${IN_ORG}`, [current, ...O]) : [{ n: 0 }];
  console.log(`${apply ? "APPLY" : "DRY RUN"} · mail key ${current ? `"${current}"` : "NOT SET"} · ${ORG ? "one organisation" : "every organisation"}`);
  console.log(`  ${plural(b.n, "email body", "email bodies")} to seal`);
  console.log(`  ${plural(a.n, "attachment", "attachments")} to seal`);
  console.log(`  ${plural(rb.n, "email body", "email bodies")} and ${plural(ra.n, "attachment", "attachments")} to rewrap under the current key`);
  if (problem) {
    console.error(`The mail key is ${problem === "unset" ? "not set" : "set but could not be read"} (STEWARD_CREDENTIAL_KEY, or STEWARD_MAIL_KEYS). Nothing can be sealed; nothing was changed.`);
    process.exit(apply ? 2 : 0);
  }
  if (!apply) {
    console.log(b.n + a.n + rb.n + ra.n ? "Nothing was changed. Run again with --apply to seal them." : "Nothing to do.");
    process.exit(0);
  }

  let sealed = 0, assets = 0, rewrapped = 0, failed = 0;
  // 1 · bodies still in `note`, keyset-paged by id.
  for (let after = "";;) {
    const rows = await query(`SELECT id, org_id, note FROM interactions WHERE ${BODY_WHERE} AND id > ? ORDER BY id LIMIT ?`, [...O, after, BATCH]);
    if (!rows.length) break;
    for (const r of rows) {
      after = r.id;
      try {
        const cols = SM.resealEdited(r.org_id, r.id, r.note);
        if (!cols.body_sealed) continue;   // a blank body: nothing to seal
        const done = await run(`UPDATE interactions SET note = ?, body_sealed = ?, body_key_id = ? WHERE id = ? AND body_sealed IS NULL AND note = ?`,
          [cols.note, cols.body_sealed, cols.body_key_id, r.id, r.note]);
        if (!done || done.changes !== 0) sealed++;
      } catch (e) { failed++; console.error(`  interaction ${r.id}: ${e.code || e.name}`); }
    }
  }
  // 2 · rotation of sealed bodies.
  for (let after = "";;) {
    const rows = await query(`SELECT id, org_id, body_sealed FROM interactions WHERE body_sealed IS NOT NULL AND body_key_id IS DISTINCT FROM ? AND ${IN_ORG} AND id > ? ORDER BY id LIMIT ?`,
      [current, ...O, after, BATCH]);
    if (!rows.length) break;
    for (const r of rows) {
      after = r.id;
      try {
        const w = SM.rewrap(r.body_sealed, { aad: SM.interactionAad(r.org_id, r.id) });
        const done = await run(`UPDATE interactions SET body_sealed = ?, body_key_id = ? WHERE id = ? AND body_sealed = ?`, [w.sealed, w.keyId, r.id, r.body_sealed]);
        if (!done || done.changes !== 0) rewrapped++;
      } catch (e) { failed++; console.error(`  interaction ${r.id}: ${e.code || e.name}`); }
    }
  }
  // 3 · attachments, then their rotation.
  for (let after = "";;) {
    const rows = await query(`SELECT id FROM portal_assets WHERE sealed_header IS NULL AND id IN (${MAIL_ASSETS}) AND ${IN_ORG} AND id > ? ORDER BY id LIMIT ?`, [...O, after, BATCH]);
    if (!rows.length) break;
    for (const r of rows) {
      after = r.id;
      try { if (await AS.sealAssetInPlace(r.id) === "sealed") assets++; }
      catch (e) { failed++; console.error(`  asset ${r.id}: ${e.code || e.name}`); }
    }
  }
  for (let after = "";;) {
    const rows = await query(`SELECT id FROM portal_assets WHERE sealed_header IS NOT NULL AND sealed_key_id IS DISTINCT FROM ? AND ${IN_ORG} AND id > ? ORDER BY id LIMIT ?`, [current, ...O, after, BATCH]);
    if (!rows.length) break;
    for (const r of rows) {
      after = r.id;
      try { if (await AS.rewrapAsset(r.id) === "rewrapped") rewrapped++; }
      catch (e) { failed++; console.error(`  asset ${r.id}: ${e.code || e.name}`); }
    }
  }
  console.log(`${plural(sealed, "email body", "email bodies")} sealed, ${plural(assets, "attachment", "attachments")} sealed, ${plural(rewrapped, "row", "rows")} rewrapped under "${current}". `
    + (failed ? `${failed} failed; those rows are unchanged. Run again after fixing the key.` : "None failed."));
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e.code || e.name, e.message); process.exit(1); });
