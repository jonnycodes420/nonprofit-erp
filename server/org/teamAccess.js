// server/org/teamAccess.js · ACCESS-2. "SEES: EVERYONE / ONLY PEOPLE ASSIGNED TO THEM".
//
// Set on the invite (POST /auth/invite carries it to the invites row, and the
// accept copies it to the new account or membership) and in Settings → Team
// (PUT /org/users/:id/access, an admin's). The Campaign cabinet preset is
// Staff, only assigned people, no export and no Wealth Score. An admin always
// sees everyone, so the setting is kept but has no effect on one.
"use strict";

const PRESETS = {
  cabinet: { role: "staff", sees: "assigned", canExport: false, canWealth: false },
};
const SENTENCE = {
  everyone: "Sees everyone in Steward.",
  assigned: "Sees only the people assigned to them (they own the person, or the household's main person). Everyone else is not there for them: not in lists, search, Atlas or reports.",
};

// The three switches from a request body: a preset, or each one said.
function accessFrom(body) {
  const b = body || {};
  if (b.preset && PRESETS[b.preset]) {
    const p = PRESETS[b.preset];
    return { sees: p.sees, canExport: p.canExport, canWealth: p.canWealth };
  }
  return {
    sees: b.sees === "assigned" ? "assigned" : "everyone",
    canExport: b.canExport === undefined ? true : !!b.canExport,
    canWealth: b.canWealth === undefined ? true : !!b.canWealth,
  };
}
const isDefault = a => a.sees === "everyone" && a.canExport && a.canWealth;

async function saveOnInvite(run, inviteId, body) {
  const a = accessFrom(body);
  if (isDefault(a)) return a;
  await run(`UPDATE invites SET sees = ?, can_export = ?, can_wealth = ? WHERE id = ?`, [a.sees, a.canExport, a.canWealth, inviteId]);
  return a;
}

// After an invite is accepted: its setting onto the account (home org) or the
// membership (a further org).
async function copyFromInvite(run, inviteId, { userId, orgId, home }) {
  if (home) {
    await run(`UPDATE users u SET sees = i.sees, can_export = i.can_export, can_wealth = i.can_wealth
                 FROM invites i WHERE i.id = ? AND u.id = ? AND u.org_id = i.org_id`, [inviteId, userId]);
  } else {
    await run(`UPDATE org_memberships m SET sees = i.sees, can_export = i.can_export, can_wealth = i.can_wealth
                 FROM invites i WHERE i.id = ? AND m.user_id = ? AND m.org_id = i.org_id`, [inviteId, userId]);
  }
}

function mount(ctx, app) {
  const { query, run, requireAuth, requireAdmin, wrap } = ctx;
  // Settings → Team: change who someone sees. The home org's row, or the
  // membership for someone who joined from another org. Their next request
  // reads it (requireAuth reads it live).
  app.put("/org/users/:id/access", requireAuth, requireAdmin, wrap(async (req, res) => {
    const orgId = req.user.orgId, id = String(req.params.id);
    const a = accessFrom(req.body);
    const [home] = await query(`SELECT id, sees, can_export, can_wealth FROM users WHERE id = ? AND org_id = ? AND deactivated_at IS NULL`, [id, orgId]);
    const [mem] = home ? [] : await query(`SELECT user_id, sees, can_export, can_wealth FROM org_memberships WHERE user_id = ? AND org_id = ? AND revoked_at IS NULL`, [id, orgId]);
    const before = home || mem;
    if (!before) return res.status(404).json({ error: "not_found", message: "That person isn't on this team." });
    if (home) await run(`UPDATE users SET sees = ?, can_export = ?, can_wealth = ? WHERE id = ? AND org_id = ?`, [a.sees, a.canExport, a.canWealth, id, orgId]);
    else await run(`UPDATE org_memberships SET sees = ?, can_export = ?, can_wealth = ? WHERE user_id = ? AND org_id = ?`, [a.sees, a.canExport, a.canWealth, id, orgId]);
    if (req.audit) {
      req.audit.entity("user", id);
      req.audit.before({ sees: before.sees, can_export: before.can_export, can_wealth: before.can_wealth });
      req.audit.after({ sees: a.sees, can_export: a.canExport, can_wealth: a.canWealth });
    }
    res.json({ id, sees: a.sees, canExport: a.canExport, canWealth: a.canWealth, sentence: SENTENCE[a.sees] });
  }));
}

module.exports = { PRESETS, SENTENCE, accessFrom, saveOnInvite, copyFromInvite, mount };
