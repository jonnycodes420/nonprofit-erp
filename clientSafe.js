// clientSafe.js · CLIENT-SAFE-1. THE SERVER HALF of shared/clientSafe.js.
//
// Every capture door asks two things here before it stores a word:
//   · privacyFor(orgId): is the setting on, and who is marked as a client;
//   · screenForStore(...): what of this email may be kept.
// With the setting off both answer "everything, as before", so an org that has
// not turned it on captures exactly what it did yesterday.
"use strict";

let D = null;                        // server.js hands its helpers over at boot
function configure(deps) { D = deps; }

const HEALTH_MODEL = "claude-haiku-4-5-20251001";
const REMOVAL_UNDO_DAYS = 30;
const CS = () => import("./shared/clientSafe.js");

/** { on, clientIds: Set, clientEmails: Set } for one org. One query when off. */
async function privacyFor(orgId) {
  const [org] = await D.query("SELECT client_privacy FROM orgs WHERE id=?", [orgId]);
  if (!org || org.client_privacy !== true) return { on: false, clientIds: new Set(), clientEmails: new Set() };
  const rows = await D.query("SELECT id, email FROM donors WHERE org_id=? AND is_client IS TRUE", [orgId]);
  return {
    on: true,
    clientIds: new Set(rows.map(r => r.id)),
    clientEmails: new Set(rows.map(r => String(r.email || "").trim().toLowerCase()).filter(Boolean)),
  };
}

/**
 * What of one email may be stored. Returns { subject, body, metadataOnly, held }.
 * Off: the email unchanged. On with AI off, or a read that failed: metadata
 * only (Steward could not check, so it keeps nothing it has not checked).
 * On with AI: the model's quotes and the screen both hold sentences back.
 */
async function screenForStore(orgId, { subject, body }, privacy) {
  const p = privacy || await privacyFor(orgId);
  if (!p.on) return { subject, body, metadataOnly: false, held: 0 };
  const C = await CS();
  const subj = C.holdHealth(subject);
  const subjectOut = subj.held ? C.HELD_LINE : subject;
  const gate = await D.aiGate(orgId);
  let quotes = null;
  if (gate.ok && String(body || "").trim()) {
    try {
      const msg = await D.anthropicFor(orgId).messages.create({
        model: HEALTH_MODEL, max_tokens: 800, thinking: { type: "disabled" },
        system: C.HEALTH_SYSTEM,
        tools: [{ name: C.HEALTH_TOOL.name, description: C.HEALTH_TOOL.description, strict: true, input_schema: C.HEALTH_TOOL.input_schema }],
        tool_choice: { type: "tool", name: C.HEALTH_TOOL.name },
        messages: [{ role: "user", content: String(body).slice(0, 12000) }],
      });
      const use = (msg.content || []).find(b => b.type === "tool_use" && b.name === C.HEALTH_TOOL.name);
      quotes = use && use.input && Array.isArray(use.input.quotes) ? use.input.quotes.map(String) : null;
    } catch (e) {
      // The status only: the error text can echo the request, which is the email.
      console.error("[client-safe] health read failed:", e && e.status ? e.status : "no status");
      await D.recordAiFallback?.(orgId, "client_safe_health", e)?.catch?.(() => {});
    }
  }
  if (!String(body || "").trim()) return { subject: subjectOut, body: "", metadataOnly: false, held: subj.held ? 1 : 0 };
  if (!gate.ok || !quotes) return { subject: subjectOut, body: "", metadataOnly: true, held: subj.held ? 1 : 0 };
  const b = C.holdHealth(body, quotes);
  return { subject: subjectOut, body: b.text, metadataOnly: false, held: (subj.held || b.held) ? 1 : 0 };
}

/** One row per email that had something held back. Never the words. */
async function recordHold(orgId, { donorIds = [], interactionId = null, source, actorId }) {
  for (const donorId of donorIds.length ? donorIds : [null])
    await D.run(`INSERT INTO privacy_holds (id,org_id,donor_id,interaction_id,source,kind,created_by) VALUES (?,?,?,?,?,'health',?)`,
      ["ph_" + D.uuid().slice(0, 12), orgId, donorId, interactionId, source, actorId || "system:client-safe"]);
}

/** Thirty days after a removal, its kept rows are emptied for good. */
async function purgeRemovals(orgId) {
  await D.run(`UPDATE client_email_removals SET rows=NULL, purged_at=NOW()
                WHERE ${orgId ? "org_id=? AND " : ""}purged_at IS NULL AND undone_at IS NULL
                  AND created_at < NOW() - INTERVAL '${REMOVAL_UNDO_DAYS} days'`, orgId ? [orgId] : []);
}

module.exports = { configure, privacyFor, screenForStore, recordHold, purgeRemovals, HEALTH_MODEL, REMOVAL_UNDO_DAYS };
