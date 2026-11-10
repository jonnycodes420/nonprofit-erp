// server/donors/quickAdd.js · QUICKADD-1. A NEW PERSON AND THEIR GIFT, IN ONE GO.
//
// Allie Barnett typed six Good Giving Challenge donors: add each one, search
// for them, open their giving, then record the gift. Four screens a donor. In
// Record a gift and on each deposit-sheet line, "+ New person: 'Maria Lopez'"
// now opens first name, last name, email, phone and address, and one Save
// adds the person and records the gift.
//
//   POST /gifts/new-person
//     { person: { firstName, lastName, email, phone, address, city, state, zip },
//       confirmNew?, useExistingId?, ...the gift form's own fields }
//
// ONE REQUEST, BOTH THINGS, OR NEITHER.
//   · No person named: the gift is refused (400 no_person). A gift is always
//     somebody's, and this door exists to say whose.
//   · The gift is checked first (amount, date, appeal, page). A refused gift
//     adds nobody.
//   · Somebody already on file by that name or email: 409 possible_duplicate,
//     naming them ("Maria Lopez is already on file. Use that record?"). The
//     answer comes back as useExistingId (the gift goes on them) or confirmNew.
//   · The person is added by addPerson.js (the one way a person is added by
//     hand: name, email check, record limit, owner, the actor stamp), then the
//     gift goes through the gift form's own route body (gifts.js giftForm),
//     so it is recorded, receipted and on the ledger exactly as one typed on
//     the profile. If that refuses, the person just added is taken back out.
"use strict";
const express = require("express");

const routers = { r1: express.Router() };
const clean = (v, n = 120) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);

function fullName(p) {
  const first = clean(p.firstName), last = clean(p.lastName);
  return clean([first, last].filter(Boolean).join(" ") || p.name, 200);
}

// The people already on file this new one could be: the same name, or the same email.
async function lookalikes(query, orgId, name, email) {
  const rows = await query(
    `SELECT id, name, email FROM donors
      WHERE org_id=? AND deleted_at IS NULL
        AND (LOWER(TRIM(name)) = LOWER(?) OR (? <> '' AND LOWER(TRIM(email)) = LOWER(?)))
      ORDER BY created_at DESC LIMIT 5`, [orgId, name, email, email]);
  return rows.map(r => ({ id: r.id, name: r.name, email: r.email || null }));
}

// The gift route answers through res.status().json(); this keeps what it said.
function capture() {
  const out = { status: 200, body: null };
  const res = { status(c) { out.status = c; return res; }, json(b) { out.body = b; return res; } };
  return { res, out };
}

function mount(ctx) {
  const { query, run, requireAuth, checkWriteAccess, wrap, normalizeGiftDate } = ctx;
  const app = routers.r1;
  const giftForm = require("./gifts").giftForm;

  app.post("/gifts/new-person", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const orgId = req.user.orgId, b = req.body || {};
    const giftBody = async (donorId) => {
      const { res: r2, out } = capture();
      await giftForm.body(Object.assign(req, { params: { ...req.params, id: donorId } }), r2);
      return out;
    };

    // "Use that record": the gift goes on the person she chose, through the same door.
    if (b.useExistingId) {
      const [d] = await query("SELECT id FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [String(b.useExistingId), orgId]);
      if (!d) return res.status(404).json({ error: "Donor not found" });
      const out = await giftBody(d.id);
      return res.status(out.status).json(out.status < 300 ? { ...out.body, created: false } : out.body);
    }

    const p = b.person && typeof b.person === "object" ? b.person : null;
    const name = p ? fullName(p) : "";
    if (!name) return res.status(400).json({ error: "Name the person this gift is from.", code: "no_person" });
    const email = clean(p.email, 254).toLowerCase();

    // The gift first: a gift that would be refused adds nobody.
    if (!b.amount || !(Number(b.amount) > 0)) return res.status(400).json({ error: "A positive amount is required" });
    if (!normalizeGiftDate(b.date)) return res.status(400).json({ error: "A valid gift date (YYYY-MM-DD) is required." });
    const attr = await require("./giftAttribution").checkAttribution(query, orgId, b);
    if (attr.error) return res.status(attr.status).json({ error: attr.error });

    if (b.confirmNew !== true) {
      const matches = await lookalikes(query, orgId, name, email);
      if (matches.length) {
        const m = matches[0];
        return res.status(409).json({ error: "possible_duplicate", code: "possible_duplicate", matches,
          sentence: `${m.name} is already on file${m.email ? ` (${m.email})` : ""}. Use that record?` });
      }
    }

    const added = await require("./addPerson").addPerson(ctx, req, {
      name, email, phone: clean(p.phone, 40), address: p.address, address2: p.address2, city: p.city, state: p.state, zip: p.zip,
      stage: "steward", status: "new", personTypes: ["donor"],
    });
    if (added.status >= 300) return res.status(added.status).json(added.body);
    const personId = added.body.id;

    let out;
    try { out = await giftBody(personId); }
    catch (e) { await takeBack(personId); throw e; }
    if (out.status >= 300) { await takeBack(personId); return res.status(out.status).json(out.body); }
    res.status(201).json({ ...out.body, created: true, person: { id: personId, name },
      ...(added.body.warning ? { warning: added.body.warning } : {}) });

    // The person was added a moment ago in this request and holds nothing yet.
    async function takeBack(id) {
      await run("DELETE FROM donors WHERE id=? AND org_id=? AND COALESCE(gift_count,0)=0", [id, orgId])
        .catch(err => console.error("[quick-add] take back:", err.message));
    }
  }));
}

module.exports = { routers, mount };
