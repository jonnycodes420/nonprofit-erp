// server/outreach/draftPlans.js · SENDS-2 item 1. MILESTONE DRAFTS, MORE THAN ONE AT A TIME.
//
// Two bulk doors sent milestone drafts in a loop, each draft minting its own
// staff confirm: Communications' "Send all reviewed" (POST
// /milestone-drafts/send-reviewed) and Auctions' "Send all" (the browser
// pressing /milestone-drafts/:id/send once per winner). Both now build a send
// plan (server/mail/sendPlan.js) and send exactly the list she was shown.
//
//   milestone_reviewed  every draft somebody marked reviewed (or those of `ids`
//                       that are), less any whose link does not open (FLOWS-9)
//   milestone           the drafts named by `ids`
//
// Admin only, the bar /milestone-drafts/:id/send has. Each one still goes
// through sendMilestoneDraft, so every mail rule is asked at the press.
const SEND_PLAN = require("../mail/sendPlan");

function mount(ctx) {
  const { query, sendMilestoneDraft } = ctx;

  const read = (orgId, ids) => ids.length ? query(
    `SELECT md.*, d.name AS donor_name, d.email AS donor_email
       FROM milestone_drafts md JOIN donors d ON d.id = md.donor_id AND d.org_id = md.org_id
      WHERE md.org_id = ? AND md.id = ANY(?) ORDER BY md.created_at, md.id`, [orgId, ids]) : Promise.resolve([]);
  const fp = d => SEND_PLAN.fingerprint(d.subject, d.body, d.status, d.donor_id, d.donor_email, d.reviewed_at ? 1 : 0);

  // FLOWS-9: a draft whose link does not open, or that speaks of a video nobody
  // recorded, is never "ready". Map(id → sentence).
  async function linkHeld(orgId, drafts) {
    if (!drafts.length) return new Map();
    const checked = await require("../drafts/linkCheck").checkDrafts(orgId, await require("../drafts/render").renderDrafts(orgId, drafts));
    return new Map(checked.filter(c => c.linkCheck && !c.linkCheck.ok)
      .map(c => [c.id, "Check this draft before sending: a link in it does not open, or it speaks of a video that is not there."]));
  }

  function kind(reviewedOnly) {
    return {
      admin: true,
      noun: () => ["email", "emails"],
      async build(req, ids) {
        const orgId = req.user.orgId;
        let drafts;
        if (reviewedOnly && !ids.length) {
          const pick = await query(`SELECT id FROM milestone_drafts WHERE org_id = ? AND status = 'pending_review' AND reviewed_at IS NOT NULL
                                      ORDER BY created_at ASC LIMIT 200`, [orgId]);
          drafts = await read(orgId, pick.map(r => r.id));
        } else drafts = await read(orgId, ids);
        const held = reviewedOnly ? await linkHeld(orgId, drafts) : new Map();
        const items = [], refused = [];
        for (const d of drafts) {
          const who = { ref: d.id, name: d.donor_name, email: d.donor_email || null };
          if (d.status !== "pending_review") refused.push({ ...who, why: "Already sent or dismissed." });
          else if (reviewedOnly && !d.reviewed_at) refused.push({ ...who, why: "Not marked reviewed yet." });
          else if (!d.donor_email) refused.push({ ...who, why: "There is no email address on this record." });
          else if (held.get(d.id)) refused.push({ ...who, why: held.get(d.id) });
          else items.push({ ...who, donorId: d.donor_id, subject: d.subject, fp: fp(d) });
        }
        return { items, refused };
      },
      async changed(req, items) {
        const orgId = req.user.orgId;
        const now = await read(orgId, items.map(i => i.ref));
        const by = new Map(now.map(d => [d.id, d]));
        const held = reviewedOnly ? await linkHeld(orgId, now.filter(d => d.status === "pending_review")) : new Map();
        const out = new Map();
        for (const i of items) {
          const d = by.get(i.ref);
          if (!d || d.status !== "pending_review") out.set(i.ref, "it was sent or dismissed since.");
          else if (held.get(d.id)) out.set(i.ref, held.get(d.id));
          else if (fp(d) !== i.fp) out.set(i.ref, "its words or address changed after you looked.");
        }
        return out;
      },
      async send(req, item) {
        const [d] = await query(`SELECT * FROM milestone_drafts WHERE org_id = ? AND id = ? AND status = 'pending_review'`, [req.user.orgId, item.ref]);
        if (!d) return { ok: false, error: "Already sent." };
        const r = await sendMilestoneDraft(req, d);
        return r.status === 200 ? { ok: true } : { ok: false, error: r.error };
      },
    };
  }
  SEND_PLAN.register("milestone_reviewed", kind(true));
  SEND_PLAN.register("milestone", kind(false));
  return {};
}

module.exports = { mount };
