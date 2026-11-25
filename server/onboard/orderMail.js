// server/onboard/orderMail.js · ORDER-1. THE TWO EMAILS AN ORDER MAY SEND, AND NO OTHER.
//
//   signedCopy   to the person who just signed, the moment she signs: her signed order
//                as a PDF. Transactional, the close link's own mail (Steward's address,
//                through the Resend proxy that enforces mailBlock.js).
//   requestSign  "Review and sign your order", to the signer named on an order, only when
//                Jonathan presses Send on /ops. Nothing sends it on its own.
// Neither goes to a donor or a prospect: the recipient is the customer's own signer.
"use strict";

const FROM = () => process.env.DEMO_SMTP_FROM || "noreply@stewardapp.dev";
const esc = s => String(s == null ? "" : s).replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
const wrapHtml = lines => `<div style="font-family:Georgia,serif;font-size:15px;color:#0F1A12;line-height:1.7">${lines.join("")}</div>`;

async function send(resend, payload, tag) {
  if (!resend || !process.env.RESEND_API_KEY) return { sent: false, reason: "No mail provider is configured, so nothing was sent." };
  try {
    const { error } = await resend.emails.send({ from: FROM(), ...payload, _stewardKind: tag });
    if (error) return { sent: false, reason: `The mail provider did not accept it: ${error.message}` };
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: `The mail provider did not accept it: ${String(e && e.message || e).slice(0, 200)}` };
  }
}

async function signedCopy(resend, { to, snapshot, stamp, pdf, orgId }) {
  return send(resend, {
    to, subject: `Your signed Steward order ${snapshot.orderNumber}`,
    html: wrapHtml([
      `<p>${esc(stamp)}.</p>`,
      `<p>Your signed order for ${esc(snapshot.orgName)} is attached. ${esc(snapshot.total.label)}: ${esc(snapshot.total.amount)}. Nothing is charged before then, and you can cancel any time before ${esc(snapshot.figures.firstChargeOn)} in Settings and pay nothing.</p>`,
      `<p>Steward</p>`,
    ]),
    attachments: [{ filename: `steward-order-${snapshot.orderNumber}-signed.pdf`, content: pdf.toString("base64"), content_type: "application/pdf" }],
    _stewardOrgId: orgId,
  }, "order_signed_copy");
}

async function requestSign(resend, { to, name, orgName, orderNumber, url, orgId, preparedBy }) {
  return send(resend, {
    to, subject: `Review and sign your Steward order ${orderNumber}`,
    html: wrapHtml([
      `<p>Hi ${esc(String(name || "").split(" ")[0] || "there")},</p>`,
      `<p>${esc(preparedBy || "Jonathan")} has put ${esc(orgName)}'s Steward order in writing: the plan, the price, the setup and the date of the first charge. Read it, sign it, and keep a copy.</p>`,
      `<p><a href="${esc(url)}" style="color:#0D5C3A;font-weight:bold">Review and sign your order</a></p>`,
      `<p>Nothing is charged when you sign. The link works for 14 days.</p>`,
    ]),
    _stewardOrgId: orgId,
  }, "order_request_sign");
}

module.exports = { signedCopy, requestSign };
