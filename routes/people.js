// routes/people.js — FIX-1 D. PEOPLE, WITHOUT THE LECTURE.
//
// The model does not move: one person, one record, even when they are two
// things (BUILD-94 Part 2, `donors.person_types`). What this module adds is the
// small set of doors the SCREEN needs now that Donors shows donors:
//
//   PUT /people/:id/roles   one chip, one write — turn a role on or off
//   GET /people/:id         what a person is, and whether Donor may come off
//   GET /people?role=…      the people carrying one role (the volunteer roster,
//                           the staff and board list in Settings)
//
// DONOR IS SET BY GIVING. Somebody with a gift on file is a donor because money
// of theirs is on the ledger, and taking the word off would drop real gifts out
// of every total that reads donors (the `donorOnly` predicate) while the gifts
// themselves stayed. So removing it is REFUSED, here and — through
// `donorRemovalProblem` — on the older PUT /donors/:id personTypes path too. A
// guard with a side door is not a guard.
//
// Registration style: this module calls `app.get/put(...)` itself rather than
// mounting an express.Router, because the route inventory (and therefore the
// cross-tenant matrix) walks the app's own route table. A Router mounted with
// app.use would hide its routes from the tenant probes.

// The roles a chip may set. "other" is not a role, it is the absence of one —
// normalizeTypes floors an empty list at it, and a chip turning a role on
// replaces it (the recordGift rule: "other" means "we do not know").
const CHIP_ROLES = ["donor", "volunteer", "staff_board"];

function register(app, { query, run, requireAuth, checkWriteAccess, wrap, actor, PT, enrollInSequences }) {
  const typesOfRow = row => PT().typesOf(row);

  // Whether Donor may come off this person, and the sentence when it may not.
  // Counted from the gifts table itself — the rollup columns can lag an edit.
  async function donorLock(orgId, row) {
    const [g] = await query(
      `SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=? AND donor_id=?`, [orgId, row.id]);
    // The gift rows, or the rollup when an imported history carried a count
    // with no rows behind it — either one is money of theirs on file.
    const n = Math.max((g && g.n) || 0, Number(row.gift_count) || 0);
    if (!n) return { locked: false, reason: null, giftCount: 0 };
    const first = String(row.name || "This person").trim().split(/\s+/)[0];
    const isOrg = row.kind === "organisation";
    return {
      locked: true, giftCount: n,
      reason: `${isOrg ? String(row.name || "This organisation").trim() : first} has ${n === 1 ? "a gift" : n + " gifts"} on file, ` +
        `so ${isOrg ? "it stays" : "they stay"} a donor. Donor is set by giving.`,
    };
  }

  // Exported for PUT /donors/:id: null when the change is fine, otherwise the
  // refusal body. Only a change that REMOVES donor can be refused.
  async function donorRemovalProblem(orgId, donorId, nextTypes) {
    const [row] = await query(
      `SELECT id, name, kind, person_types, gift_count FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL`, [donorId, orgId]);
    if (!row) return null;                      // the caller's own 404 handles it
    const was = typesOfRow(row).includes("donor");
    const will = PT().normalizeTypes(nextTypes).includes("donor");
    if (!was || will) return null;
    const lock = await donorLock(orgId, row);
    if (!lock.locked) return null;
    return { error: "donor_has_gifts", sentence: lock.reason, giftCount: lock.giftCount };
  }

  const personOut = (row, lock) => ({
    id: row.id, name: row.name, email: row.email || null, kind: row.kind || null,
    person_types: typesOfRow(row),
    labels: PT().typeLabels(row),
    donorLocked: !!(lock && lock.locked),
    donorLockedReason: lock && lock.locked ? lock.reason : null,
  });

  // ── the lists ────────────────────────────────────────────────────────────
  app.get("/people", requireAuth, wrap(async (req, res) => {
    const role = String(req.query.role || "");
    if (!CHIP_ROLES.includes(role))
      return res.status(400).json({ error: "role_required", sentence: "Ask for donors, volunteers, or staff and board." });
    const rows = await query(
      `SELECT d.id, d.name, d.email, d.phone, d.kind, d.person_types, d.gift_count, d.total_giving, d.last_gift_date,
              d.photo_asset_id
         FROM donors d
        WHERE d.org_id=? AND d.deleted_at IS NULL AND ${PT().typeSql(role, "d")}
        ORDER BY lower(d.name), d.id
        LIMIT 5000`, [req.user.orgId]);
    res.json({
      role,
      people: rows.map(r => ({
        ...personOut(r, null),
        phone: r.phone || null,
        // "whether they also give" — a DONOR ROLE, not a gift count: a
        // volunteer marked donor with no gift yet is a prospect, and says so.
        gives: typesOfRow(r).includes("donor"),
        giftCount: Number(r.gift_count) || 0,
        totalGiving: Number(r.total_giving) || 0,
        lastGiftDate: r.last_gift_date || null,
      })),
    });
  }));

  app.get("/people/:id", requireAuth, wrap(async (req, res) => {
    const [row] = await query(
      `SELECT id, name, email, kind, person_types, gift_count FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL`,
      [req.params.id, req.user.orgId]);
    if (!row) return res.status(404).json({ error: "Person not found" });
    res.json(personOut(row, await donorLock(req.user.orgId, row)));
  }));

  // ── one chip, one write ──────────────────────────────────────────────────
  app.put("/people/:id/roles", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const role = String(req.body?.role || "");
    const on = req.body?.on === true;
    if (!CHIP_ROLES.includes(role))
      return res.status(400).json({ error: "unknown_role", sentence: "A role is Donor, Volunteer, or Staff and board." });
    const [row] = await query(
      `SELECT id, name, kind, person_types, gift_count FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL`,
      [req.params.id, req.user.orgId]);
    if (!row) return res.status(404).json({ error: "Person not found" });

    const was = typesOfRow(row);
    let next = on ? [...was.filter(t => t !== "other"), role] : was.filter(t => t !== role);
    next = PT().normalizeTypes(next);

    if (role === "donor" && !on && was.includes("donor")) {
      const lock = await donorLock(req.user.orgId, row);
      if (lock.locked) return res.status(409).json({ error: "donor_has_gifts", sentence: lock.reason, giftCount: lock.giftCount });
    }

    if (JSON.stringify(next) !== JSON.stringify(was)) {
      await run(`UPDATE donors SET person_types = ?::jsonb, updated_at = NOW() WHERE id=? AND org_id=?`,
        [JSON.stringify(next), row.id, req.user.orgId]);
      // BUILD-94 Part 3 — ADDED AS VOLUNTEER is a trigger, on the transition only.
      if (!was.includes("volunteer") && next.includes("volunteer") && enrollInSequences) {
        enrollInSequences(req.user.orgId, row.id, "added_volunteer", {}, actor(req))
          .catch(e => console.error("[seq] volunteer trigger:", e.message));
      }
    }
    const fresh = { ...row, person_types: next };
    res.json(personOut(fresh, await donorLock(req.user.orgId, fresh)));
  }));

  return { donorRemovalProblem, CHIP_ROLES };
}

module.exports = { register, CHIP_ROLES };
