// server/receipts/letterSet.js · BUILD-98's letter batch, moved from
// server/outreach/thanks.js by LETTERS-1 so the event and campaign letters
// (letters.js) and the acknowledgment queue print through one path.
//
// The gifts, grouped into one letter per donor. Every id is checked against
// this org; a foreign id is simply not found. What LETTERS-1 added:
//   * a template uploaded from Word carries a `layout`, filled per donor;
//   * the signature image (the receipt signer's, else the printer's own);
//   * {{event_name}}, {{campaign_name}}, {{deductible_amount}}, {{today}};
//   * `excludeDoNotContact`: the event letters leave out, by name, a person
//     marked do not contact (the acknowledgment queue keeps BUILD-98's rule).
"use strict";

function makeLetterSet({ query, ACK_READY, donorFacingOrgName }) {
  async function ackOrg(orgId) {
    const [o] = await query(
      `SELECT id, name, legal_name, receipt_address, receipt_signature_name, receipt_signature_title, receipt_signature_image,
              logo_data, brand_accent, brand_accent_fg, ack_backlog_days FROM orgs WHERE id=?`, [orgId]);
    if (!o) return null;
    const display = await donorFacingOrgName(orgId, o.name || "").catch(() => o.name || "");
    return { ...o, display };
  }

  async function ackTemplate(orgId, templateId) {
    const ACK = await ACK_READY;
    if (templateId) {
      const [t] = await query("SELECT * FROM ack_letter_templates WHERE id=? AND org_id=?", [templateId, orgId]);
      return t || null;
    }
    // Only a template somebody MARKED default stands in for "no choice". Taking
    // whichever saved template came first would print the wrong letter.
    const [t] = await query("SELECT * FROM ack_letter_templates WHERE org_id=? AND is_default=true ORDER BY created_at ASC LIMIT 1", [orgId]);
    return t || { id: null, name: "Standard thank-you", body: ACK.DEFAULT_ACK_TEMPLATE, is_default: true, builtIn: true };
  }

  // The signer rule (BUILD-98) is unchanged: the org's receipt signer, else the
  // person printing. The signature image follows the name: the org's when the
  // org's signer signs, the printer's own when they do.
  async function signerOf(org, userId) {
    const [me] = userId ? await query("SELECT name, signature_image FROM users WHERE id=?", [userId]) : [];
    if (org.receipt_signature_name) return { name: org.receipt_signature_name, title: org.receipt_signature_title || "", image: org.receipt_signature_image || null };
    return { name: (me && me.name) || "", title: "", image: (me && me.signature_image) || null };
  }

  async function ackLetterSet(orgId, giftIds, templateId, { addressesOnly = false, userId = null, excludeDoNotContact = false, today = "" } = {}) {
    const ACK = await ACK_READY;
    const L = require("./letterDoc");
    const ids = [...new Set((Array.isArray(giftIds) ? giftIds : []).map(String).filter(Boolean))].slice(0, 1000);
    if (!ids.length) return { error: "Choose the gifts to write letters for." };
    const tpl = await ackTemplate(orgId, templateId);
    if (!tpl) return { notFound: true };
    const org = await ackOrg(orgId);
    const rows = await query(
      `SELECT g.id, g.donor_id, g.amount, g.date, g.tribute_type, g.tribute_name, f.name AS fund, g.quid_pro_quo_value, g.deductible_amount,
              ev.name AS event_name, cp.name AS campaign_name,
              d.name, d.kind, d.salutation, d.address, d.address2, d.city, d.state, d.zip, d.country, d.deceased, d.do_not_contact
         FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
         LEFT JOIN fin_funds f ON f.id = g.fund_id
         LEFT JOIN events ev ON ev.id = g.event_id AND ev.org_id = g.org_id
         LEFT JOIN campaigns cp ON cp.id = g.campaign_id AND cp.org_id = g.org_id
        WHERE g.org_id=? AND g.id = ANY(?) AND d.deleted_at IS NULL
        ORDER BY d.name, g.date`, [orgId, ids]);
    const byDonor = new Map();
    for (const r of rows) {
      const e = byDonor.get(r.donor_id) || { donor: r, gifts: [] };
      e.gifts.push({ id: r.id, amount: r.amount, date: r.date, fund: r.fund, tributeType: r.tribute_type, tributeName: r.tribute_name,
                     qpqValue: r.quid_pro_quo_value, deductible: r.deductible_amount, event: r.event_name, campaign: r.campaign_name });
      byDonor.set(r.donor_id, e);
    }
    // Never blank: an unsigned letter is not posted.
    const signer = await signerOf(org, userId);
    const orgFields = { name: org.display, signer: signer.name, signerTitle: signer.title };
    let layout = null;
    if (tpl.layout) { try { layout = typeof tpl.layout === "string" ? JSON.parse(tpl.layout) : tpl.layout; } catch { layout = null; } }
    const letters = [], skipped = [];
    for (const { donor, gifts } of byDonor.values()) {
      const giftIdsHere = gifts.map(g => g.id);
      // A letter to somebody who has died is not a thank-you; it goes to the
      // family by hand, and the batch says so rather than printing it.
      if (donor.deceased) { skipped.push({ donorId: donor.donor_id, name: donor.name, giftIds: giftIdsHere, why: "marked deceased" }); continue; }
      if (excludeDoNotContact && donor.do_not_contact) { skipped.push({ donorId: donor.donor_id, name: donor.name, giftIds: giftIdsHere, why: "marked do not contact" }); continue; }
      const address = ACK.addressLines(donor);
      if (!address) { skipped.push({ donorId: donor.donor_id, name: donor.name, giftIds: giftIdsHere, why: "no postal address on file" }); continue; }
      // Labels need an address and nothing else; a template the gift cannot fill
      // must not cost somebody their envelope.
      if (addressesOnly) { letters.push({ donorId: donor.donor_id, name: donor.name, address, text: "", giftIds: giftIdsHere, totalCents: 0 }); continue; }
      const fields = ACK.letterFields({ donor, gifts, org: orgFields, today });
      const r = ACK.renderLetter(tpl.body, fields);
      if (r.missing.length) {
        const why = r.missing.includes("gift_date") && fields._undated
          ? `${fields._undated === 1 ? "a gift here has" : `${fields._undated} gifts here have`} no date; set the date on the gift first`
          : `nothing to put in ${r.missing.map(k => `{{${k}}}`).join(", ")}`;
        skipped.push({ donorId: donor.donor_id, name: donor.name, giftIds: giftIdsHere, why }); continue;
      }
      // HOME-3: what was received in exchange, and what is deductible, under every letter that needs it
      const text = fields._goodsServices ? `${r.text}\n\n${fields._goodsServices}` : r.text;
      const deductibleCents = gifts.reduce((t, g) => t + ACK.deductibleCents(g), 0);
      letters.push({ donorId: donor.donor_id, name: donor.name, address, text, giftIds: giftIdsHere, totalCents: fields._totalCents, deductibleCents,
                     signer: signer.name, goodsServices: fields._goodsServices || "", layout: layout ? L.fillLayout(layout, fields) : null });
    }
    const found = new Set(rows.map(r => r.id));
    return { template: { id: tpl.id, name: tpl.name, builtIn: !!tpl.builtIn, fromWord: !!layout }, org, signer, letters, skipped,
             notFound: ids.filter(id => !found.has(id)).length };
  }

  return { ackOrg, ackTemplate, ackLetterSet, signerOf };
}

module.exports = { makeLetterSet };
