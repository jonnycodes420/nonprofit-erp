// server/mail/sendPlan.js · SENDS-2. NOTHING GOES TO A PERSON UNTIL SOMEONE HAS SEEN EXACTLY WHO IT GOES TO.
//
// On 22 Nov a staging walk pressed "Send 33 emails" on Volunteers, To send: 33
// stale shift reminders, every one preselected, no dialog. Only the mail block
// stopped them. The cause was that a staff confirm (sendGate.recordStaffConfirm)
// is minted by the server inside the route, one per draft, so a loop of N
// drafts passed the gate as N hand sends.
//
// THE RULE: a staff send to more than one person needs a send plan the server
// built and the same person confirmed. One click on one draft is unchanged.
//
//   POST /send-plans              { kind, ids } → the plan: its id, the count,
//                                 each person's name, address and subject, and
//                                 what will be refused and why. Nothing is sent.
//   POST /send-plans/:id/commit   sends exactly the plan's list, once, by the
//                                 person who built it, within 10 minutes. A
//                                 draft changed since the plan is skipped and
//                                 named. It is the only place a request may
//                                 mint more than one confirm (confirmScope.under).
//
// Each bulk door registers a KIND here (register()): how to build its list from
// ids, how to tell an item changed since, and how to send one item. The old
// bulk routes refuse more than one person without a plan. The CI scan
// (scripts/ci/send-plan-scan.js) fails on any other loop that mints confirms.
const express = require("express");
const crypto = require("crypto");
const { newId } = require("../shared/newId");
const CONFIRM_SCOPE = require("./confirmScope");

const PLAN_MINUTES = 10;
const MAX_ITEMS = 500;
const KINDS = Object.create(null);
const routers = { r1: express.Router() };

// kind: { admin, noun(items) → [one, many], build(req, ids) → { items, refused },
//         changed(req, items) → Map(ref → why), send(req, item) → { ok, error } }
// An item is { ref, donorId, name, email, subject, fp }; fp is what the person
// saw (fingerprint()), compared again at commit.
function register(kind, def) { KINDS[kind] = def; }

function fingerprint(...parts) {
  return crypto.createHash("sha256").update(parts.map(p => String(p == null ? "" : p)).join("\u0000")).digest("hex").slice(0, 24);
}

function plural(n, [one, many]) { return `${n} ${n === 1 ? one : many}`; }

// "To Ana Ruiz, Ben Cho, Corin Ashdown and 1 more. Each goes now." The dialog's
// title asks "Send 4 reminders?"; `sentence` is the two together.
function toLineOf(items, noun) {
  if (!items.length) return `Nothing to send. ${noun[1][0].toUpperCase()}${noun[1].slice(1)} that can't go are listed with why.`;
  const names = items.map(i => i.name || i.email);
  const shown = names.length <= 3 ? names.join(", ").replace(/, ([^,]*)$/, " and $1")
    : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
  return `To ${shown}. ${items.length === 1 ? "It goes" : "Each goes"} now.`;
}
function sentenceOf(items, noun) {
  return items.length ? `Send ${plural(items.length, noun)}? ${toLineOf(items, noun)}` : toLineOf(items, noun);
}

function mount(ctx) {
  const { actor, checkWriteAccess, query, requireAuth, run, wrap } = ctx;
  const app = routers.r1;

  async function isAdmin(req) {
    if (req.user && req.user.support) return true;
    return (await require("../auth/access").liveRoleIn(req.user.userId, req.user.orgId)) === "admin";
  }

  app.post("/send-plans", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const kind = String((req.body && req.body.kind) || "");
    const K = KINDS[kind];
    if (!K) return res.status(400).json({ error: "bad_kind", sentence: "Say which send this is." });
    if (K.admin && !(await isAdmin(req))) return res.status(403).json({ error: "Admin access required" });
    const ids = [...new Set((Array.isArray(req.body && req.body.ids) ? req.body.ids : []).map(String))].slice(0, MAX_ITEMS);
    const built = await K.build(req, ids);
    const items = built.items.slice(0, MAX_ITEMS), refused = built.refused || [];
    const who = actor(req), id = newId("sp");
    await run(`INSERT INTO send_plans (id, org_id, kind, items, refused, created_by, created_by_name) VALUES (?,?,?,?,?,?,?)`,
      [id, req.user.orgId, kind, JSON.stringify(items), JSON.stringify(refused), who.id, who.name]);
    const noun = K.noun(items);
    req.audit && req.audit.action(`prepared a send to ${plural(items.length, ["person", "people"])}`);
    res.status(201).json({
      planId: id, kind, count: items.length, noun,
      recipients: items.map(i => ({ ref: i.ref, name: i.name, email: i.email, subject: i.subject })),
      refused: refused.map(r => ({ ref: r.ref, name: r.name, email: r.email || null, why: r.why })),
      minutes: PLAN_MINUTES,
      sentence: sentenceOf(items, noun), toLine: toLineOf(items, noun),
    });
  }));

  app.post("/send-plans/:id/commit", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const out = await commit(req, String(req.params.id));
    res.status(out.status).json(out.body);
  }));

  // Claimed first, so a second press (or a second person) sends nothing.
  async function commit(req, planId) {
    const orgId = req.user.orgId, who = actor(req);
    const [p] = await query(
      `UPDATE send_plans SET committed_at = NOW(), committed_by = ?
        WHERE id = ? AND org_id = ? AND committed_at IS NULL AND created_by = ?
          AND created_at > NOW() - make_interval(mins => ?)
        RETURNING *`, [who.id, planId, orgId, who.id, PLAN_MINUTES]);
    if (!p) {
      const [had] = await query(`SELECT created_by, created_by_name, committed_at, (created_at <= NOW() - make_interval(mins => ?)) AS old
                                   FROM send_plans WHERE id = ? AND org_id = ?`, [PLAN_MINUTES, planId, orgId]);
      if (!had) return { status: 404, body: { error: "not_found", sentence: "That send list isn't here. Nothing was sent." } };
      if (had.created_by !== who.id) return { status: 403, body: { error: "not_your_plan",
        sentence: `${had.created_by_name || "Someone else"} prepared this list. Only the person who saw it can send it, so nothing was sent.` } };
      if (had.committed_at) return { status: 409, body: { error: "already_sent", sentence: "This list was already sent. Nothing was sent twice." } };
      return { status: 410, body: { error: "plan_expired",
        sentence: `This list was prepared more than ${PLAN_MINUTES} minutes ago. Look at it again before you send. Nothing was sent.` } };
    }
    const K = KINDS[p.kind];
    if (!K) return { status: 400, body: { error: "bad_kind", sentence: "Nothing was sent." } };
    if (K.admin && !(await isAdmin(req))) return { status: 403, body: { error: "Admin access required" } };
    const items = Array.isArray(p.items) ? p.items : JSON.parse(p.items || "[]");
    const changed = await K.changed(req, items);
    let sent = 0;
    const skipped = [], failed = [];
    await CONFIRM_SCOPE.under(p.id, async () => {
      for (const item of items) {
        const why = changed.get(item.ref);
        if (why) { skipped.push({ ref: item.ref, name: item.name, why }); continue; }
        let r;
        try { r = await K.send(req, item); } catch (e) { r = { ok: false, error: e.message }; }
        if (r && r.ok) sent++; else failed.push({ ref: item.ref, name: item.name, why: (r && r.error) || "not sent" });
      }
    });
    const result = { sent, skipped, failed };
    await run(`UPDATE send_plans SET result = ? WHERE id = ?`, [JSON.stringify(result), p.id]);
    const noun = K.noun(items);
    req.audit && req.audit.action(`sent ${plural(sent, noun)} from a list of ${items.length}`);
    req.audit && req.audit.entity("send_plan", p.id);
    const named = list => list.slice(0, 3).map(x => `${x.name}: ${x.why}`).join("; ") + (list.length > 3 ? `; and ${list.length - 3} more` : "");
    return { status: 200, body: { sent, skipped, failed,
      message: `${plural(sent, noun)} sent.`
        + (skipped.length ? ` ${skipped.length} skipped because ${skipped.length === 1 ? "it" : "they"} changed after you looked: ${named(skipped)}.` : "")
        + (failed.length ? ` ${failed.length} not sent: ${named(failed)}.` : "") } };
  }

  return {};
}

// What the old bulk doors answer when asked for more than one person.
const PLAN_REQUIRED = { error: "send_list_required",
  sentence: "To send to more than one person, look at the list first: it opens with every name before anything goes. Nothing was sent." };

module.exports = { routers, mount, register, fingerprint, sentenceOf, PLAN_MINUTES, PLAN_REQUIRED, KINDS };
