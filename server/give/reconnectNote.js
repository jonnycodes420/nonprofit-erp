// server/give/reconnectNote.js · SENDS-2. ONE RECONNECT-YOUR-GIFT NOTE, AND ITS SEND PLAN.
//
// BUILD-77's reconnect note goes to an imported sustainer whose card could not
// move with them. Recurring giving's "Send" picked several people and the route
// looped, minting a staff confirm per person. Now one person is one press
// (POST /recurring/unlinked/send-reconnect, routes/give.js), and more than one
// is a send plan (kind "reconnect", server/mail/sendPlan.js): every name first.
// Moved out of routes/give.js (over 1,500 lines) with the words unchanged.
const SEND_PLAN = require("../mail/sendPlan");

function mount(deps) {
  const { query, run, actor, newId, escapeHtml, publicAppUrl, signReconnectToken,
    brandEmailHeaderHtml, donorFromAddress, sendDonorLifecycleEmail, donorFacingOrgName, dunningOwner } = deps;
  // The single press and a committed send plan (kind "reconnect") both send through sendOne.
  const WHO = `SELECT id, name, email, imported_sustainer_amount::float AS amount, imported_sustainer_last_gift AS last_gift
         FROM donors WHERE org_id=? AND deleted_at IS NULL AND imported_sustainer IS TRUE AND id = ANY(?)`;
  async function orgOf(orgId) {
    const [org] = await query("SELECT id, name, org_slug FROM orgs WHERE id=?", [orgId]);
    return { org, dfName: await donorFacingOrgName(orgId, org.name).catch(() => org.name) };
  }
  async function sendOne(req, org, dfName, d) {
    const orgId = org.id;
    const freq = "monthly";
    const token = signReconnectToken(d.id, orgId);
    const params = new URLSearchParams({ reconnect: token, frequency: freq });
    if (d.amount != null) params.set("amount", Number(d.amount).toFixed(2));
    const link = `${publicAppUrl()}/give/${org.org_slug}?${params.toString()}`;
    const amtStr = d.amount != null ? "$" + Number(d.amount).toLocaleString("en-US", { maximumFractionDigits: 0 }) + "/month" : "your monthly gift";
    const html = await brandEmailHeaderHtml(orgId)
      + `<p>${escapeHtml((await import("../../shared/greeting.js")).greetingLine(d, { word: "Hi" }))}</p>
         <p>Thank you for being a faithful monthly supporter of <strong>${escapeHtml(dfName)}</strong>. We've moved to a new giving system, and because card details can't transfer between systems, we need you to reconnect your ${escapeHtml(amtStr)} gift.</p>
         <p>It takes about a minute, your amount is already filled in:</p>
         <p><a href="${link}" style="display:inline-block;background:#c9a84c;color:#0f1a12;text-decoration:none;font-weight:700;padding:11px 22px;border-radius:8px">Reconnect my monthly gift</a></p>
         <p style="color:#8fa896;font-size:13px">If you'd rather not continue your monthly gift, no action is needed, and thank you for everything you've already given.</p>`;
    const from = await donorFromAddress(orgId).catch(() => undefined);
    // SEND-GATE-2: she pressed Send for this person; SENDS-2: for more than one, on the list she was shown.
    const confirm = await require("../../sendGate").recordStaffConfirm({ orgId, to: d.email, what: "Reconnect-your-gift note", by: actor(req) });
    const ok = await sendDonorLifecycleEmail("reconnect", d.email, `Reconnect your monthly gift to ${dfName}`, html, from, orgId, confirm);
    if (ok) {
      await run(
        `INSERT INTO reconnect_sends (id, org_id, donor_id, historical_amount, historical_interval, sent_by)
         VALUES (?,?,?,?,?,?)
         ON CONFLICT (org_id, donor_id) DO UPDATE SET sent_at=NOW(), historical_amount=EXCLUDED.historical_amount, sent_by=EXCLUDED.sent_by`,
        [newId("rcs"), orgId, d.id, d.amount, "month", actor(req).id]
      );
    }
    return !!ok;
  }
  SEND_PLAN.register("reconnect", {
    admin: true,
    noun: () => ["reconnect link", "reconnect links"],
    async build(req, ids) {
      const own = await dunningOwner(req.user.orgId);
      const rows = await query(WHO, [req.user.orgId, ids]);
      const items = [], refused = [];
      for (const d of rows) {
        const who = { ref: d.id, name: d.name, email: d.email || null };
        if (own.engine === "provider") refused.push({ ...who, why: own.sentence });
        else if (!d.email) refused.push({ ...who, why: "There is no email address on this record." });
        else items.push({ ...who, donorId: d.id, subject: "Reconnect your monthly gift", fp: SEND_PLAN.fingerprint(d.email, d.amount) });
      }
      return { items, refused };
    },
    async changed(req, items) {
      const own = await dunningOwner(req.user.orgId);
      const by = new Map((await query(WHO, [req.user.orgId, items.map(i => i.ref)])).map(d => [d.id, d]));
      const out = new Map();
      for (const i of items) {
        const d = by.get(i.ref);
        if (own.engine === "provider") out.set(i.ref, own.sentence);
        else if (!d || !d.email) out.set(i.ref, "they are no longer an imported sustainer with an address.");
        else if (SEND_PLAN.fingerprint(d.email, d.amount) !== i.fp) out.set(i.ref, "their address or amount changed after you looked.");
      }
      return out;
    },
    async send(req, item) {
      const [d] = await query(WHO, [req.user.orgId, [item.ref]]);
      if (!d || !d.email) return { ok: false, error: "No address on file." };
      const { org, dfName } = await orgOf(req.user.orgId);
      return (await sendOne(req, org, dfName, d)) ? { ok: true } : { ok: false, error: "The email provider did not accept it." };
    },
  });
  return { WHO, orgOf, sendOne };
}

module.exports = { mount };
