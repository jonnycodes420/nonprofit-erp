#!/usr/bin/env node
// BUILD-56 Part 3 — restore-asset: get a retained (soft-deleted) portal asset
// BACK, including the pointer, from the two halves BUILD-56 keeps:
//   • the bytes — soft-deleted portal_assets rows (90-day retention window);
//   • the index — asset_pointer_history (which hash WAS the banner, and where).
//
// A retained byte you cannot get back is not a backup; this script is the
// get-back. No admin UI on purpose — restore is a deliberate operator action.
//
// Usage (direct-DB writer; prodGuard rules — DATABASE_URL required, a remote
// DB additionally requires --i-know-this-is-prod):
//   node scripts/restore-asset.js list <orgId>
//       → the org's soft-deleted (restorable) assets + recent pointer history
//   node scripts/restore-asset.js restore <pa_assetId> [--repoint]
//       → clears deleted_at (the bytes serve again). With --repoint, also
//         re-points the pointer that last referenced it, from history:
//         portal_settings.logo/header_image and campaign.hero are re-pointed
//         directly; impact_update.photos restores the recorded photo array;
//         portal_page.* prints guidance (a page's widget JSONB is not
//         reconstructible from asset paths — re-add the image in the editor).
//
// Classified in tests/script-guards.test.js (GUARDED_WRITERS: writerDbUrl).
const { Pool } = require("pg");
const { writerDbUrl } = require("./lib/prodGuard");
// The ONE retention window constant (assetStore.js) — its require chain builds
// but never connects a DB pool, so importing the constant is side-effect free.
const { ASSET_RETENTION_DAYS } = require("../assetStore");

const [, , cmd, arg] = process.argv;
const REPOINT = process.argv.includes("--repoint");
const ACTOR_EMAIL = "restore-asset-script";

function usage(msg) {
  if (msg) console.error("ERROR: " + msg + "\n");
  console.error("Usage:\n  node scripts/restore-asset.js list <orgId>\n  node scripts/restore-asset.js restore <pa_assetId> [--repoint]");
  process.exit(1);
}

async function main() {
  if (!["list", "restore"].includes(cmd) || !arg) usage();
  const url = writerDbUrl();
  const pool = new Pool({ connectionString: url, ssl: process.env.DB_SSL === "disable" ? false : { rejectUnauthorized: false } });
  const q = (sql, params) => pool.query(sql, params).then(r => r.rows);

  if (cmd === "list") {
    const orgId = arg;
    const assets = await q(
      `SELECT id, kind, content_type, bytes, storage, deleted_at,
              (deleted_at + INTERVAL '${ASSET_RETENTION_DAYS} days') AS purges_after
       FROM portal_assets WHERE org_id = $1 AND deleted_at IS NOT NULL ORDER BY deleted_at DESC`, [orgId]);
    console.log(`\n${assets.length} restorable (soft-deleted) asset(s) for ${orgId}:`);
    for (const a of assets) {
      console.log(`  ${a.id}  ${a.kind.padEnd(8)} ${a.content_type.padEnd(14)} ${String(a.bytes).padStart(8)}B  deleted ${a.deleted_at.toISOString()}  purges after ${a.purges_after.toISOString().slice(0, 10)}`);
    }
    const hist = await q(
      `SELECT entity, entity_id, from_value, to_value, actor_email, created_at
       FROM asset_pointer_history WHERE org_id = $1 ORDER BY created_at DESC LIMIT 40`, [orgId]);
    console.log(`\nPointer history (latest ${hist.length}):`);
    for (const h of hist) {
      console.log(`  ${h.created_at.toISOString()}  ${h.entity} [${h.entity_id}]  ${JSON.stringify(h.from_value)} → ${JSON.stringify(h.to_value)}  (${h.actor_email || "system"})`);
    }
    await pool.end();
    return;
  }

  // restore <assetId>
  const assetId = arg;
  const [asset] = await q(`SELECT * FROM portal_assets WHERE id = $1`, [assetId]);
  if (!asset) usage(`asset ${assetId} not found — it may already be purged (check asset_purge_log)`);
  const path = `/portal-assets/${asset.id}`;

  if (asset.deleted_at == null) {
    console.log(`${assetId} is already live (not soft-deleted) — nothing to un-delete.`);
  } else {
    await q(`UPDATE portal_assets SET deleted_at = NULL WHERE id = $1`, [assetId]);
    console.log(`Restored ${assetId} (${asset.kind}, ${asset.bytes}B, org ${asset.org_id}) — the bytes serve again at ${path}`);
  }

  if (!REPOINT) {
    console.log(`(bytes only — pass --repoint to also re-point the row that last referenced it)`);
    await pool.end();
    return;
  }

  // Find the most recent pointer-history row whose FROM side references this
  // asset — that row says exactly which pointer used to carry it.
  const [h] = await q(
    `SELECT * FROM asset_pointer_history
     WHERE org_id = $1 AND from_value::text LIKE '%' || $2 || '%'
     ORDER BY created_at DESC LIMIT 1`, [asset.org_id, path]);
  if (!h) {
    console.log(`No pointer-history row references ${path} — nothing to re-point (pre-BUILD-56 asset, or it was never a pointer's from-value).`);
    await pool.end();
    return;
  }
  const record = (toVal) => q(
    `INSERT INTO asset_pointer_history (id, org_id, entity, entity_id, from_value, to_value, actor_email)
     VALUES ('aph_' || substr(md5(random()::text), 1, 8), $1, $2, $3, $4::jsonb, $5::jsonb, $6)`,
    [asset.org_id, h.entity, h.entity_id, JSON.stringify(h.to_value ?? null), JSON.stringify(toVal), ACTOR_EMAIL]);

  if (h.entity === "portal_settings.logo" || h.entity === "portal_settings.header_image") {
    const col = h.entity === "portal_settings.logo" ? "logo_url" : "header_image_url";
    await q(`UPDATE portal_settings SET ${col} = $1, updated_at = NOW() WHERE org_id = $2`, [path, asset.org_id]);
    await record(path);
    console.log(`Re-pointed ${h.entity} → ${path} (recorded in history).`);
  } else if (h.entity === "campaign.hero") {
    const n = await pool.query(`UPDATE campaigns SET hero_image_url = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`, [path, h.entity_id, asset.org_id]);
    if (n.rowCount) { await record(path); console.log(`Re-pointed campaign ${h.entity_id} hero → ${path}.`); }
    else console.log(`Campaign ${h.entity_id} no longer exists — bytes restored, no pointer to re-point.`);
  } else if (h.entity === "impact_update.photos") {
    const photos = Array.isArray(h.from_value) ? h.from_value : null;
    if (!photos) { console.log(`History from-value isn't a photo array — restore the photos by hand from: ${JSON.stringify(h.from_value)}`); }
    else {
      const n = await pool.query(`UPDATE impact_updates SET photos = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`, [JSON.stringify(photos), h.entity_id, asset.org_id]);
      if (n.rowCount) { await record(photos); console.log(`Restored impact update ${h.entity_id} photos → ${JSON.stringify(photos)}.`); }
      else console.log(`Impact update ${h.entity_id} no longer exists (deleted) — bytes restored; re-attach ${path} to a new update if needed.`);
    }
  } else {
    console.log(`${h.entity} pointers (portal page widgets) aren't auto-re-pointed — the page's widget JSONB isn't reconstructible from asset paths alone.`);
    console.log(`The bytes are live again at ${path}; re-add the image to the widget in the portal editor.`);
  }
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
