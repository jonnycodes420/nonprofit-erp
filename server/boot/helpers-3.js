// SPLIT-2: moved VERBATIM from server.js (its functions from lines 3778-5210). server.js requires the boot modules in
// order: every helpers-N first (a function existed from the start, as hoisting made it), then
// steps-1, steps-2 … in the order the statements ran. Each "SPLIT-2 server.js piece N" block is
// server.js's own text; tests read server.js through readSource("server.js"), which puts the
// pieces back in order. The lines outside the blocks are the wiring: this module's copy of each
// server.js name it reads (bind), and __boot.share() after a declaration or a write, which
// refreshes every module's copy.
// eslint-disable-next-line no-var, no-global-assign
var __dirname = require("path").join(__dirname, "..", "..");   // server.js's folder, as the moved code expects
const __boot = require("./share");
const __share = __boot.share;
let AFTER, DB_READY, DONOR_ACCOUNTS_ENABLED, DONOR_MAIL_ADDR, RECOVERY_RATE_WINDOW_DAYS, RECOVERY_SECRET, RECURRING_CHANGE_KINDS, SEND_GATE, SYS_AUTO, VOL_DAYS, VOL_DAYS_READY, allocateReceiptNumber, applyReceiptTokens, crypto, dbReady, displayNameCase, donorMailDecision, getThemeAsset, money, newId, opsAlert, orgTime, orgToday, orgTz, portalCardTheme, publicAppUrl, query, queryTx, run, runTx, sendReceiptEmail, smartAmountsMod, sweepMissedRecurring, syncSource, testMode, toCents, toDollars, unsubscribeHeaders, withTransaction;
__boot.register(c => {
  if ("AFTER" in c) AFTER = c.AFTER;
  if ("DB_READY" in c) DB_READY = c.DB_READY;
  if ("DONOR_ACCOUNTS_ENABLED" in c) DONOR_ACCOUNTS_ENABLED = c.DONOR_ACCOUNTS_ENABLED;
  if ("DONOR_MAIL_ADDR" in c) DONOR_MAIL_ADDR = c.DONOR_MAIL_ADDR;
  if ("RECOVERY_RATE_WINDOW_DAYS" in c) RECOVERY_RATE_WINDOW_DAYS = c.RECOVERY_RATE_WINDOW_DAYS;
  if ("RECOVERY_SECRET" in c) RECOVERY_SECRET = c.RECOVERY_SECRET;
  if ("RECURRING_CHANGE_KINDS" in c) RECURRING_CHANGE_KINDS = c.RECURRING_CHANGE_KINDS;
  if ("SEND_GATE" in c) SEND_GATE = c.SEND_GATE;
  if ("SYS_AUTO" in c) SYS_AUTO = c.SYS_AUTO;
  if ("VOL_DAYS" in c) VOL_DAYS = c.VOL_DAYS;
  if ("VOL_DAYS_READY" in c) VOL_DAYS_READY = c.VOL_DAYS_READY;
  if ("allocateReceiptNumber" in c) allocateReceiptNumber = c.allocateReceiptNumber;
  if ("applyReceiptTokens" in c) applyReceiptTokens = c.applyReceiptTokens;
  if ("crypto" in c) crypto = c.crypto;
  if ("dbReady" in c) dbReady = c.dbReady;
  if ("displayNameCase" in c) displayNameCase = c.displayNameCase;
  if ("donorMailDecision" in c) donorMailDecision = c.donorMailDecision;
  if ("getThemeAsset" in c) getThemeAsset = c.getThemeAsset;
  if ("money" in c) money = c.money;
  if ("newId" in c) newId = c.newId;
  if ("opsAlert" in c) opsAlert = c.opsAlert;
  if ("orgTime" in c) orgTime = c.orgTime;
  if ("orgToday" in c) orgToday = c.orgToday;
  if ("orgTz" in c) orgTz = c.orgTz;
  if ("portalCardTheme" in c) portalCardTheme = c.portalCardTheme;
  if ("publicAppUrl" in c) publicAppUrl = c.publicAppUrl;
  if ("query" in c) query = c.query;
  if ("queryTx" in c) queryTx = c.queryTx;
  if ("run" in c) run = c.run;
  if ("runTx" in c) runTx = c.runTx;
  if ("sendReceiptEmail" in c) sendReceiptEmail = c.sendReceiptEmail;
  if ("smartAmountsMod" in c) smartAmountsMod = c.smartAmountsMod;
  if ("sweepMissedRecurring" in c) sweepMissedRecurring = c.sweepMissedRecurring;
  if ("syncSource" in c) syncSource = c.syncSource;
  if ("testMode" in c) testMode = c.testMode;
  if ("toCents" in c) toCents = c.toCents;
  if ("toDollars" in c) toDollars = c.toDollars;
  if ("unsubscribeHeaders" in c) unsubscribeHeaders = c.unsubscribeHeaders;
  if ("withTransaction" in c) withTransaction = c.withTransaction;
});

// SPLIT-2 server.js piece 314

// One PDF renderer for both a single-gift receipt and a year-end statement
// (snapshot.type distinguishes them) rather than two near-duplicate layouts
// — reuses the exact buffer-to-Promise + bufferedPageRange footer pattern
// from the Board Report / Impact Summary PDFs. The footer text MUST pass an
// explicit `height` option — text drawn at y = page.height - N without one
// sits below pdfkit's default maxY and silently triggers an extra page
// break per footer .text() call (bit the Impact Summary and Board Report
// PDFs both, independently, before this).
async function renderReceiptPdf(snapshot) {
  const PDFDocument = require("pdfkit");
  const doc = new PDFDocument({ margin: 50, size: "LETTER", bufferPages: true });
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", c => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // The header band uses the org's brand accent when set (BUILD-13),
    // falling back to Steward green. The amount stays green (money = green in
    // the palette semantics). `fg` is the accessible foreground the accent was
    // normalized against, so header text is always legible on the band.
    const GREEN = "#1a6b4a", INK = "#1a1a1a", INK3 = "#6b7280", BG = "#f5f5f0";
    const HEADER = snapshot.orgAccent || GREEN;
    const HEADER_FG = snapshot.orgAccentFg || "#ffffff";
    const HEADER_SUB = HEADER_FG === "#ffffff" ? "#ffffffcc" : "#0f1a12aa";
    const PW = doc.page.width;
    const fmtD = n => "$" + (parseFloat(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const isYearEnd = snapshot.type === "year_end";

    doc.rect(0, 0, PW, 90).fill(HEADER);
    // Optional logo, right-aligned in the band.
    let logoBuf = null;
    if (snapshot.orgLogo && /^data:image\/(png|jpe?g);base64,/.test(snapshot.orgLogo)) {
      try { logoBuf = Buffer.from(snapshot.orgLogo.split(",")[1], "base64"); } catch { logoBuf = null; }
    }
    if (logoBuf) { try { doc.image(logoBuf, PW - 50 - 54, 18, { fit: [54, 54], align: "right" }); } catch {} }
    doc.font("Helvetica").fontSize(9).fillColor(HEADER_SUB).text(isYearEnd ? "Y E A R - E N D   G I V I N G   S T A T E M E N T" : "D O N A T I O N   R E C E I P T", 50, 24);
    doc.font("Helvetica-Bold").fontSize(19).fillColor(HEADER_FG).text(snapshot.orgLegalName, 50, 40, { width: PW - 120 });
    doc.font("Helvetica").fontSize(9).fillColor(HEADER_SUB).text(`EIN: ${snapshot.orgEin || "Not set"}`, 50, 68);

    let y = 112;
    doc.font("Helvetica").fontSize(9).fillColor(INK3).text(`Receipt #${snapshot.receiptNumber}`, 50, y);
    doc.text(`Issued ${snapshot.issueDate}`, PW - 220, y, { width: 170, align: "right" });
    y += 22;

    doc.font("Helvetica-Bold").fontSize(13).fillColor(INK).text(snapshot.donorName || "Valued Donor", 50, y); y = doc.y + 4;
    if (snapshot.orgAddress) {
      doc.font("Helvetica").fontSize(8).fillColor(INK3).text(snapshot.orgAddress, 50, y, { width: PW - 100 }); y = doc.y;
    }
    y += 14;

    if (!isYearEnd) {
      doc.rect(50, y, PW - 100, 66).fill(BG);
      doc.font("Helvetica").fontSize(7).fillColor(INK3).text("GIFT DATE", 62, y + 10);
      doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text(snapshot.giftDate, 62, y + 22);
      doc.font("Helvetica").fontSize(7).fillColor(INK3).text("AMOUNT", 230, y + 10);
      doc.font("Helvetica-Bold").fontSize(11).fillColor(GREEN).text(fmtD(snapshot.amount), 230, y + 22);
      doc.font("Helvetica").fontSize(7).fillColor(INK3).text("PAYMENT METHOD", 390, y + 10);
      doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text(snapshot.paymentMethod || "Not set", 390, y + 22);
      y += 84;

      if (snapshot.paidInAll != null && snapshot.goodsServicesSentence) {
        // HOME-3: Partly a gift. AMOUNT above is the gift part; this says what was paid in all.
        doc.font("Helvetica").fontSize(9).fillColor(INK).text(snapshot.goodsServicesSentence, 50, y, { width: PW - 100, lineGap: 2 });
      } else if (snapshot.quidProQuoDesc) {
        doc.font("Helvetica").fontSize(9).fillColor(INK).text(
          `In exchange for this contribution, ${snapshot.orgLegalName} provided: ${snapshot.quidProQuoDesc} (estimated fair market value ${fmtD(snapshot.quidProQuoValue)}). Only the amount of your contribution in excess of that value, ${fmtD(snapshot.deductibleAmount)}, is tax-deductible.`,
          50, y, { width: PW - 100, lineGap: 2 }
        );
      } else {
        doc.font("Helvetica").fontSize(9).fillColor(INK).text("No goods or services were provided in exchange for this contribution.", 50, y, { width: PW - 100 });
      }
      y = doc.y + 16;
    } else {
      doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text(`Tax Year ${snapshot.taxYear} Giving Summary`, 50, y); y += 18;
      doc.font("Helvetica").fontSize(7).fillColor(INK3).text("DATE", 58, y);
      doc.text("PAYMENT METHOD", 170, y);
      doc.text("AMOUNT", PW - 150, y, { width: 100, align: "right" });
      y += 12;
      snapshot.lineItems.forEach((item, i) => {
        doc.rect(50, y, PW - 100, 18).fill(i % 2 === 0 ? "#ffffff" : BG);
        doc.font("Helvetica").fontSize(8).fillColor(INK).text(item.date, 58, y + 5, { width: 100 });
        doc.fillColor(INK3).text(item.paymentMethod || "Not set", 170, y + 5, { width: 150 });
        doc.font("Helvetica-Bold").fillColor(GREEN).text(fmtD(item.amount), PW - 150, y + 5, { width: 100, align: "right" });
        y += 18;
      });
      y += 10;
      doc.moveTo(50, y).lineTo(PW - 50, y).strokeColor("#e5e7eb").lineWidth(0.5).stroke(); y += 12;
      doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text("Total tax-deductible contributions", 50, y);
      doc.font("Helvetica-Bold").fontSize(13).fillColor(GREEN).text(fmtD(snapshot.totalDeductible), PW - 200, y - 2, { width: 150, align: "right" });
      y = doc.y + 18;
      // COMMS-2 — when some of what was given bought something (a ticket's
      // fair market value), the statement says both numbers.
      if (snapshot.totalAmount != null && Math.round(snapshot.totalAmount * 100) !== Math.round(snapshot.totalDeductible * 100)) {
        doc.font("Helvetica").fontSize(9).fillColor(INK3).text(`Total given ${fmtD(snapshot.totalAmount)}. The difference is the value of goods or services you received, shown on each gift's own receipt.`, 50, y, { width: PW - 100 });
        y = doc.y + 8;
      }
      doc.font("Helvetica").fontSize(9).fillColor(INK).text("No goods or services were provided in exchange for these contributions, unless otherwise noted on the individual gift receipt for a specific contribution.", 50, y, { width: PW - 100, lineGap: 2 });
      y = doc.y + 16;
      // COMMS-2 §3 — YOUR YEAR WITH US. Not money, and never part of a total:
      // the hours they gave and the events they came to. The org can turn it off.
      if (snapshot.yourYear) {
        const yy = snapshot.yourYear, bits = [];
        if (yy.volunteerHours > 0) bits.push(`You gave ${yy.volunteerHours % 1 ? yy.volunteerHours.toFixed(2) : yy.volunteerHours} hours as a volunteer, over ${yy.shifts} ${yy.shifts === 1 ? "shift" : "shifts"}.`);
        if (yy.events && yy.events.length) bits.push(`You came to ${yy.events.length === 1 ? "one of our events" : yy.events.length + " of our events"}: ${yy.events.join(", ")}.`);
        doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text(`Your ${snapshot.taxYear} with us`, 50, y); y = doc.y + 4;
        doc.font("Helvetica").fontSize(9).fillColor(INK).text(bits.join(" ") + " Thank you for all of it.", 50, y, { width: PW - 100, lineGap: 2 });
        y = doc.y + 16;
      }
    }

    if (snapshot.customMessage) {
      doc.font("Helvetica-Oblique").fontSize(9).fillColor(INK).text(snapshot.customMessage, 50, y, { width: PW - 100, lineGap: 2 });
      y = doc.y + 18;
    }

    y += 14;
    if (snapshot.signatureName) {
      doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text(snapshot.signatureName, 50, y); y = doc.y + 2;
      if (snapshot.signatureTitle) doc.font("Helvetica").fontSize(9).fillColor(INK3).text(snapshot.signatureTitle, 50, y);
    }

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // BUILD-65 Part 5: the receipt/statement footer is the legal tax line
      // ONLY. The "see all your giving" account CTA was removed from the PDF —
      // a document handed to an accountant should not carry a marketing link
      // (the CTA lives in the cover EMAIL instead). Legacy already-issued
      // receipts may still carry snapshot.givingAccountUrl frozen in; we simply
      // no longer render it.
      doc.font("Helvetica").fontSize(7).fillColor("#9ca3af").text(
        // COMMS-2 — the org's own tax language from its brand kit, when it wrote
        // one; the EIN always follows it.
        snapshot.taxLanguage
          ? `${snapshot.taxLanguage} EIN: ${snapshot.orgEin || "Not set"}.`
          : `${snapshot.orgLegalName} is a tax-exempt organization. EIN: ${snapshot.orgEin || "Not set"}. This receipt is provided for your tax records. Please retain it. No portion of this document constitutes tax advice.`,
        50, doc.page.height - 40, { width: PW - 100, height: 30, align: "left" }
      );
    }

    // WHY-1 Part 8 — A DEMO RECEIPT CAN NEVER PASS AS A REAL ONE. Every page of
    // a receipt or statement from a demonstration organisation carries a large
    // "DEMO" across it and a line in its header band saying it is not a tax receipt.
    if (snapshot.demo) {
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        doc.save();
        doc.rotate(-30, { origin: [PW / 2, doc.page.height / 2] });
        doc.font("Helvetica-Bold").fontSize(120).fillColor("#C9A84C").fillOpacity(0.22)
          .text("DEMO", 0, doc.page.height / 2 - 70, { width: PW, align: "center", lineBreak: false });
        doc.restore();
        doc.fillOpacity(1).font("Helvetica-Bold").fontSize(8.5).fillColor(HEADER_FG)
          .text("DEMONSTRATION ONLY. NOT A TAX RECEIPT.", 50, 80, { width: PW - 100, lineBreak: false });
      }
    }

    doc.end();
  });
}
// SPLIT-2 end
// SPLIT-2 server.js piece 315

// ── BUILD-49 — the donor front door's entry-point gate ─────────────────────
// One predicate for every donor-touching surface that may mention the /giving
// account: the org must be portal-enabled AND network_listed (the same
// listing predicate as the directory/dashboard queries) and the accounts flag
// must be on. Unlisted orgs' donors NEVER see any of it. Returns the org
// slug for from=<slug> links, or null.
async function givingAccountEntry(org) {
  if (!DONOR_ACCOUNTS_ENABLED || !org || !org.org_slug) return null;
  const rows = await query(
    `SELECT 1 FROM portal_settings WHERE org_id = ? AND enabled = true AND network_listed = true`, [org.id]);
  return rows.length ? { slug: org.org_slug } : null;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 317

// Single choke point for issuing a per-gift receipt — used by both the
// webhook (fire-and-forget) and the manual "Send receipt" route, so
// idempotency/suppression/sample-skip logic lives in exactly one place.
// SEND-GATE-1: `manual` is a person's click (Send receipt): the confirm for this one receipt.
async function issueGiftReceipt(gift, org, donor, { send = true, by = SYS_AUTO, manual = false } = {}) {
  if (!org.receipts_enabled) return { skipped: "receipts_disabled" };
  if (gift.is_sample) return { skipped: "sample_gift" };
  // HARDEN-1: a tax receipt names the day the gift was given. An undated gift
  // (IMPORT-4) has none, so no receipt is issued until somebody sets its date.
  if (gift.date == null || String(gift.date).trim() === "") return { skipped: "undated_gift" };

  // Idempotency — a redelivered Stripe event (or a double-click) must never
  // create a second active receipt for the same gift. Enforced here AND by
  // the DB's own partial-unique index (receipts_active_gift_uk) as a
  // second line of defense against a race between this check and the
  // INSERT below.
  const existing = await query("SELECT * FROM receipts WHERE gift_id=? AND voided_at IS NULL AND type='gift'", [gift.id]);
  if (existing.length) return { skipped: "already_issued", receipt: existing[0] };

  // COMMS-2 — the one rule (statementTotals.js): never more deductible than was
  // given, so a partial refund cannot leave a receipt claiming the old figure.
  const _line = require("../../statementTotals").statementLines([{ ...gift, is_sample: false, dispute_status: null }]).lines[0];
  const deductibleAmount = toDollars(_line.deductibleCents);
  const receiptNumber = await allocateReceiptNumber(org.id);
  // BUILD-64: the receipt's brand surface (band color + logo) comes from the
  // SAME resolver as the portal/give page — frozen into the snapshot at issue
  // time, so a later theme change never alters an already-issued receipt.
  const brand = await resolveOrgBrandTheme(org.id).catch(() => null);

  const snapshot = {
    type: "gift",
    orgLegalName: org.legal_name || org.name,
    orgAccent: brand ? brand.band : null,      // BUILD-64: portal primary, never Steward green
    orgAccentFg: brand ? brand.bandFg : null,
    orgLogo: await resolvePdfLogo(brand),      // BUILD-65: from object storage, not base64-only
    orgEin: (await import("../../shared/placeholderCopy.js")).publicEin(org.ein),   // WALKB-1: never a placeholder EIN
    orgAddress: org.receipt_address || "",
    signatureName: org.receipt_signature_name || "",
    signatureTitle: org.receipt_signature_title || "",
    customMessage: applyReceiptTokens(org.receipt_custom_message, org, donor),
    taxLanguage: org.tax_language || null,   // COMMS-2: the brand kit's tax language
    receiptNumber,
    // ORG_TZ_SEAM_OK — the issue date printed on a tax document is the org's
    // civil date, and the gift date is a stored civil date formatted from its
    // own Y/M/D (never round-tripped through new Date(), which shifts it a day
    // in any process timezone west of UTC).
    issueDate: orgTime.formatCivil(orgToday(await orgTz(org.id))),
    donorName: donor.name,
    giftDate: gift.date ? orgTime.formatCivil(gift.date) : "",
    giftDateRaw: gift.date || null, // ISO, alongside the display-formatted giftDate above — lets the /dashboard/today mismatch-detection query compare against gifts.date directly without reparsing a formatted string
    amount: parseFloat(gift.amount),
    deductibleAmount,
    paymentMethod: gift.payment_method || "",
    quidProQuoDesc: gift.quid_pro_quo_desc || null,
    quidProQuoValue: gift.quid_pro_quo_value != null ? parseFloat(gift.quid_pro_quo_value) : null,
  };
  // HOME-3: the quid-pro-quo disclosure, in one sentence the receipt prints.
  // A row she marked Partly a gift in Review is stored at the gift part (the
  // value received left giving and is Finance revenue), so its receipt also
  // says what was paid in all; a gala ticket's gift is stored at what was paid.
  const qpqCents = gift.quid_pro_quo_value != null ? Math.round(parseFloat(gift.quid_pro_quo_value) * 100) : 0;
  if (qpqCents > 0) {
    const fmtC = c => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const [partly] = await query("SELECT received FROM insight_reviews WHERE org_id=? AND gift_id=? AND decision='partly'", [org.id, gift.id]);
    const said = `You received goods or services valued at ${fmtC(qpqCents)}; the deductible amount is ${fmtC(_line.deductibleCents)}.`;
    snapshot.goodsServicesSentence = partly
      ? `You paid ${fmtC(_line.amountCents + qpqCents)} in all, and ${snapshot.orgLegalName} provided in exchange: ${snapshot.quidProQuoDesc || "goods or services"}. ${said}`
      : said;
    if (partly) snapshot.paidInAll = toDollars(_line.amountCents + qpqCents);
  }

  // BUILD-54 §2 — org-authored campaign copy for the cover email, frozen into
  // the snapshot at issue time like everything else (a later campaign edit
  // never changes what an already-issued receipt said). Present ONLY when the
  // gift is campaign-attributed AND the campaign carries donor-facing
  // content — a campaign with no content adds nothing (never fabricate).
  if (gift.campaign_id || gift.campaign) {
    const [c] = await query(
      `SELECT COALESCE(donor_facing_name, name) AS name, donor_description FROM campaigns
       WHERE org_id = ? AND (id = ? OR name = ?) AND donor_description IS NOT NULL LIMIT 1`,
      [org.id, gift.campaign_id || "", gift.campaign || ""]);
    if (c) snapshot.campaignNote = { name: c.name, description: c.donor_description };
  }
  if (require("../../twoFactor").isDemoOrg(org)) snapshot.demo = true;   // WHY-1 Part 8

  const pdfBuffer = await renderReceiptPdf(snapshot);
  const id = newId("rcpt");
  await run(
    `INSERT INTO receipts (id, org_id, donor_id, gift_id, type, receipt_number, amount, deductible_amount, snapshot, pdf_data, created_by, created_by_name)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, org.id, donor.id, gift.id, "gift", receiptNumber, snapshot.amount, deductibleAmount, JSON.stringify(snapshot), pdfBuffer.toString("base64"), by.id, by.name]
  );

  let emailSent = false;
  if (send && donor.email) {
    // W-4: a receipt is TRANSACTIONAL — the marketing suppression list does
    // not apply (deceased still blocks, via the one policy).
    const decision = await donorMailDecision("receipt", donor.email, org.id, { donorId: donor.id });
    // SEND-GATE-2: with the org's email off, the receipt still goes to the
    // client, which refuses it there (nothing reaches the provider) and keeps
    // it as a held line, so Going out shows it was not sent and why.
    if (decision.send || (!manual && decision.reason === "org_emails_disabled")) {
      const extra = manual ? { _stewardConfirm: await SEND_GATE.recordStaffConfirm({ orgId: org.id, to: donor.email, what: "Receipt", by }) } : {};
      emailSent = await sendReceiptEmail(org, donor, snapshot, pdfBuffer, `receipt-${receiptNumber}.pdf`, extra);
      if (emailSent) await run("UPDATE receipts SET sent_to=?, sent_at=NOW() WHERE id=?", [donor.email, id]);
    }
  }

  // acknowledgement_sent reflects "a written acknowledgment now exists for
  // this gift" (satisfying the IRS contemporaneous-acknowledgment
  // requirement the moment the PDF is generated), not "the email definitely
  // arrived" — even on a suppressed address or a failed send, the PDF is
  // stored and staff can download + mail it manually from DonorProfile.
  // A.5 — the moment, not just the fact.
  await run("UPDATE gifts SET acknowledgement_sent=true, acknowledgement_sent_at=COALESCE(acknowledgement_sent_at, NOW()) WHERE id=?", [gift.id]);

  const rows = await query("SELECT * FROM receipts WHERE id=?", [id]);
  return { receipt: rows[0], created: true, emailSent };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 319

async function processGivingSources({ orgId = null } = {}) {
  try {
    const sources = await query(
      `SELECT id, org_id FROM giving_sources
        WHERE status <> 'disconnected' AND credentials_sealed IS NOT NULL
          AND (?::text IS NULL OR org_id = ?)
        ORDER BY COALESCE(last_synced_at, '1970-01-01'::timestamptz) ASC`, [orgId, orgId]);
    for (const s of sources) {
      await syncSource(s.org_id, s.id, { reason: "scheduled" })
        .catch(e => console.error("[giving-source] sync", s.id, e.message));
    }
    const orgs = await query(
      `SELECT DISTINCT org_id FROM giving_recurring WHERE status='active' AND (?::text IS NULL OR org_id = ?)`,
      [orgId, orgId]);
    let opened = 0;
    for (const o of orgs) {
      const out = await sweepMissedRecurring(o.org_id, {}).catch(e => {
        console.error("[giving-source] sweep", o.org_id, e.message); return { opened: 0 };
      });
      opened += out.opened;
    }
    if (opened) console.log(`[giving-source] ${opened} missed-payment thread(s) opened`);
    return { sources: sources.length, threadsOpened: opened };
  } catch (e) { console.error("[giving-source] processGivingSources:", e.message); return { sources: 0, threadsOpened: 0 }; }
}
// SPLIT-2 end
// SPLIT-2 server.js piece 320

async function donorIsOrganisation(donorId, orgId) {
  const rows = await query("SELECT id, name, kind FROM donors WHERE id=? AND org_id=?", [donorId, orgId]);
  if (!rows.length) return null;                       // caller answers 404 as it already does
  return { ...rows[0], isOrg: rows[0].kind === "organisation" || rows[0].kind === "anonymous" };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 321

// ── ONE RESOLVE-OR-CREATE BY NAME ──────────────────────────────────────────
// Extracted from importGiftExtras in BUILD-102 Part 3 so the donation form and
// the importer cannot drift apart about what an employer is. A second copy would
// eventually mean a form creating a PERSON called "Acme Corp" while the importer
// creates an organisation, and the two would never merge.
//
// `made` is an out-parameter the caller counts, because "how many people did this
// create" is a figure both callers report and neither may guess at.
async function donorByNameOrCreate(orgId, name, { create = false, kind = null, who = null, cache = null, made = null } = {}) {
  const nm = String(name || "").trim();
  if (!nm) return null;
  const key = (kind || "p") + ":" + nm.toLowerCase();
  if (cache && cache.has(key)) return cache.get(key);
  const rows = await query(
    "SELECT id FROM donors WHERE org_id=? AND deleted_at IS NULL AND LOWER(name)=LOWER(?) ORDER BY created_at, id LIMIT 2",
    [orgId, nm]);
  let id = rows.length ? rows[0].id : null;
  if (!id && create) {
    id = newId("d");
    await run(
      `INSERT INTO donors (id,org_id,name,stage,status,tags,kind,person_types,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?::jsonb,?,?)`,
      [id, orgId, nm, "prospect", "active", "[]", kind || "person", '["donor"]',
       (who && who.id) || null, (who && who.name) || null]);
    if (made) made.count++;
  }
  if (cache) cache.set(key, id);
  return id;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 325


// ── BUILD-100 (grants) Part 2 — DEADLINES THAT COME AND FIND YOU ───────────
// A milestone, when its lead time arrives, IS a BUILD-81 thread on the
// officer. shared/grantMilestones.js holds every rule and the reason the
// middle state exists; these routes are its writers and the sweep.
async function grantMsMod() { return import("../../shared/grantMilestones.js"); }
// SPLIT-2 end
// SPLIT-2 server.js piece 326

async function orgLeadDays(orgId) {
  const M = await grantMsMod();
  const [o] = await query("SELECT grant_lead_days FROM orgs WHERE id=?", [orgId]);
  return M.normalizeLeadDays(o && o.grant_lead_days);
}
// SPLIT-2 end
// SPLIT-2 server.js piece 327

// THE ONE PLACE A MILESTONE BECOMES A THREAD.
// Returns "raised" | "waiting" | null, and the WAITING answer is not a
// failure — it is the `threads_one_open` index doing its job, recorded so the
// screen can say why and the next close can advance it.
async function raiseGrantMilestone(orgId, ms, { today }) {
  const M = await grantMsMod();
  try {
    // The funder must still be an organisation on file. A milestone whose
    // funder record was deleted has nobody to hang a thread on; it stays
    // pending and is reported rather than silently dropped.
    const [g] = await query(
      `SELECT g.id, g.funder_donor_id, g.program, g.officer_id, g.status,
              d.name AS funder_name, d.assigned_to, d.assigned_to_name
         FROM grants g
         LEFT JOIN donors d ON d.id = g.funder_donor_id AND d.org_id = g.org_id
                           AND d.deleted_at IS NULL AND d.is_sample IS NOT TRUE
        WHERE g.id = ? AND g.org_id = ?`, [ms.grant_id, orgId]);
    if (!g || !g.funder_donor_id || !g.funder_name) return null;
    if (!M.grantWantsMilestones(g.status)) return null;

    const { sanitizeStepLabel } = await threadShapeMod();
    const label = sanitizeStepLabel(M.milestoneStepLabel({
      kind: ms.kind, label: ms.label, funderName: g.funder_name, program: g.program,
    })) || "Follow up on the grant";

    // The officer who owns the GRANT owns the deadline; otherwise whoever owns
    // the funder record. A deadline is one person's commitment.
    let ownerId = g.officer_id || g.assigned_to || null, ownerName = g.assigned_to_name || null;
    if (ownerId) {
      const [u] = await query("SELECT name FROM users WHERE id=? AND org_id=?", [ownerId, orgId]);
      if (u) ownerName = u.name; else { ownerId = null; ownerName = null; }
    }

    const thread = await withTransaction(client => openThreadTx(client, {
      orgId, donorId: g.funder_donor_id,
      // DUE ON THE MILESTONE'S OWN DATE, not today + the lead. The lead decides
      // WHEN the officer is told; the deadline is still the deadline.
      step: { type: "follow_up", label, due: ms.due_date },
      openedOn: today, ownerId, ownerName,
      actorId: SYS_AUTO.id, actorName: SYS_AUTO.name,
    }));

    if (thread && thread.id) {
      await run(`UPDATE grant_milestones SET state='raised', thread_id=?, raised_at=NOW(), updated_at=NOW()
                  WHERE id=? AND org_id=?`, [thread.id, ms.id, orgId]);
      return "raised";
    }
    // openThreadTx declines when the donor already holds an open thread. That
    // is the constraint, not an error: the milestone waits its turn.
    await run(`UPDATE grant_milestones SET state='waiting', updated_at=NOW()
                WHERE id=? AND org_id=? AND state <> 'raised'`, [ms.id, orgId]);
    return "waiting";
  } catch (e) {
    console.error("[grant-milestone] raise:", e.message);
    return null;
  }
}
// SPLIT-2 end
// SPLIT-2 server.js piece 328

// THE SWEEP. Idempotent and self-healing, in the BUILD-99 shape: it re-reads
// `pending` AND `waiting` every pass, so a funder whose thread closed today
// gets their next deadline raised with no second mechanism, and a pass that
// was missed yesterday loses nothing (`dueWithinLead` stays true once true).
async function processGrantMilestones(onlyOrgId = null, { today: pinnedToday = null } = {}) {
  const M = await grantMsMod();
  const orgs = onlyOrgId
    ? await query("SELECT id FROM orgs WHERE id=?", [onlyOrgId])
    : await query(`SELECT DISTINCT org_id AS id FROM grant_milestones
                    WHERE state IN ('pending','waiting') AND org_id IS NOT NULL`);
  const summary = { raised: 0, waiting: 0, checked: 0 };
  for (const o of orgs) {
    try {
      const org = await orgTz(o.id);
      const today = pinnedToday && testMode() ? pinnedToday : orgToday(org);   // ORG_TZ_SEAM_OK
      const leadDays = await orgLeadDays(o.id);
      const rows = await query(
        `SELECT m.* FROM grant_milestones m
           JOIN grants g ON g.id = m.grant_id AND g.org_id = m.org_id
          WHERE m.org_id=? AND m.state IN ('pending','waiting')
            AND g.is_sample IS NOT TRUE
          ORDER BY m.due_date ASC`, [o.id]);
      for (const ms of rows) {
        summary.checked++;
        if (!M.dueWithinLead({ kind: ms.kind, dueDate: ms.due_date }, today, leadDays)) continue;
        const r = await raiseGrantMilestone(o.id, ms, { today });
        if (r === "raised") summary.raised++;
        else if (r === "waiting") summary.waiting++;
      }
    } catch (e) { console.error(`[grant-milestone] sweep org=${o.id}:`, e.message); }
  }
  return summary;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 330


// ── BUILD-100 (grants) Part 4 — WHERE RESTRICTED MONEY ACTUALLY IS ─────────
// shared/restrictedMoney.js holds the four figures, their definitions, and the
// reason "remaining" excludes what the funder still owes.
async function restrictedMod() { return import("../../shared/restrictedMoney.js"); }
// SPLIT-2 end
// SPLIT-2 server.js piece 331

// ONE query for a grant's money, so the balance can never be assembled two
// ways. `received` is the payments APPLIED TO THE AWARD PLEDGE — not every gift
// the funder ever sent, which would fold an unrelated donation into a
// restricted balance.
async function grantMoneyRows(orgId, where = "", args = []) {
  return query(
    `SELECT g.id, g.restriction, g.restricted_until, g.fund_id, g.status, g.program,
            g.amount_awarded, g.award_pledge_id,
            d.name AS funder_name, f.name AS fund_name, f.restricted AS fund_restricted,
            ${require("../../shared/numbers/pledges").GRANT_RECEIVED("g")} AS received,   -- NUMBERS-5: money only
            COALESCE((SELECT SUM(s.amount) FROM grant_spend s
                       WHERE s.org_id = g.org_id AND s.grant_id = g.id), 0) AS spent
       FROM grants g
       LEFT JOIN donors d ON d.id = g.funder_donor_id AND d.org_id = g.org_id
       LEFT JOIN fin_funds f ON f.id = g.fund_id AND f.org_id = g.org_id
      WHERE g.org_id = ? AND g.is_sample IS NOT TRUE ${where}`, [orgId, ...args]);
}
// SPLIT-2 end
// SPLIT-2 server.js piece 332

function grantBalanceFrom(R, r, today) {
  const b = R.grantBalance({
    awardedCents: toCents(r.amount_awarded) || 0,
    receivedCents: toCents(r.received) || 0,
    spentCents: toCents(r.spent) || 0,
    restriction: r.restriction, restrictedUntil: r.restricted_until, today,
  });
  return {
    grantId: r.id, funderName: r.funder_name || "", program: r.program || "",
    grantStatus: r.status, fundId: r.fund_id || null, fundName: r.fund_name || null,
    fundIsRestricted: r.fund_restricted === true,
    ...b,
    awarded: toDollars(b.awardedCents), received: toDollars(b.receivedCents),
    spent: toDollars(b.spentCents), outstanding: toDollars(b.outstandingCents),
    remaining: toDollars(b.remainingCents),
    sentence: R.balanceSentence(b, money.formatCentsPlain),
  };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 336

// A person who logged a shift IS a volunteer, on the same record — the
// recordGift rule for "donor", applied to hours. "other" means "we do not know"
// and a shift answers that.
// `client` (FIX-3 B): inside a transaction (the agent's run), the same write
// on that transaction's connection.
async function markVolunteer(orgId, personId, client = null) {
  const sql = `UPDATE donors SET person_types = CASE
      WHEN person_types IS NULL THEN '["donor","volunteer"]'::jsonb
      WHEN person_types @> '["volunteer"]'::jsonb THEN person_types
      ELSE (person_types - 'other') || '["volunteer"]'::jsonb END
    WHERE id=? AND org_id=?`;
  if (client) await runTx(client, sql, [personId, orgId]);
  else await run(sql, [personId, orgId]);
}
// SPLIT-2 end
// SPLIT-2 server.js piece 339
function volunteerRecordFields(opts = {}) {
  const errors = [];
  let hoursPerWeek = null;
  if (opts.hoursPerWeek !== undefined && opts.hoursPerWeek !== null && String(opts.hoursPerWeek).trim() !== "") {
    const n = Number(String(opts.hoursPerWeek).trim());
    if (!Number.isFinite(n) || n <= 0 || n > 80) errors.push("Hours a week is a number from 1 to 80.");
    else hoursPerWeek = Math.round(n * 100) / 100;
  }
  const availability = [...new Set((Array.isArray(opts.availability) ? opts.availability : []).map(String).filter(a => VOL_DAYS.includes(a)))];
  const rawRoles = Array.isArray(opts.roles) ? opts.roles : String(opts.roles || "").split(",");
  const roles = [...new Set(rawRoles.map(r => String(r).trim().slice(0, 60)).filter(Boolean))].slice(0, 10);
  return { errors, hoursPerWeek, availability, roles };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 340
async function makeVolunteer(orgId, personId, opts = {}, who, client = null) {
  await VOL_DAYS_READY;
  const q = (sql, p) => client ? queryTx(client, sql, p) : query(sql, p);
  const w = (sql, p) => client ? runTx(client, sql, p) : run(sql, p);
  const f = volunteerRecordFields(opts);
  if (f.errors.length) return { error: "bad_fields", message: f.errors[0] };
  const [p] = await q("SELECT id, name, email, phone FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [personId, orgId]);
  if (!p) return { error: "not_found", message: "That person is not on file." };
  await markVolunteer(orgId, p.id, client);
  const [had] = await q(`SELECT id, hours_per_week, availability, roles FROM volunteer_applications
                          WHERE org_id=? AND person_id=? AND status='approved' ORDER BY decided_at DESC NULLS LAST LIMIT 1`, [orgId, p.id]);
  let recordId, created = false;
  if (had) {
    recordId = had.id;
    // Only what was given changes; a field left out keeps what it had.
    await w(`UPDATE volunteer_applications SET
               hours_per_week = CASE WHEN ? THEN ?::numeric ELSE hours_per_week END,
               availability = CASE WHEN ? THEN ?::jsonb ELSE availability END,
               roles = CASE WHEN ? THEN ?::jsonb ELSE roles END
             WHERE id=? AND org_id=?`,
      [opts.hoursPerWeek !== undefined, f.hoursPerWeek, opts.availability !== undefined, JSON.stringify(f.availability),
       opts.roles !== undefined, JSON.stringify(f.roles), had.id, orgId]);
  } else {
    recordId = newId("vap");
    created = true;
    const via = opts.via === "agent" || String(who.id || "").startsWith("system:agent") ? "agent" : "staff";
    await w(`INSERT INTO volunteer_applications (id,org_id,name,email,phone,answers,availability,status,person_id,matched_existing,
                                                 decided_at,decided_by,decided_by_name,created_by,created_by_name,hours_per_week,roles,via)
             VALUES (?,?,?,?,?,'[]'::jsonb,?::jsonb,'approved',?,TRUE,NOW(),?,?,?,?,?,?::jsonb,?)`,
      [recordId, orgId, p.name, String(p.email || "").toLowerCase(), p.phone || null, JSON.stringify(f.availability), p.id,
       who.id, who.name, who.id, who.name, f.hoursPerWeek, JSON.stringify(f.roles), via]);
  }
  const [now] = await q("SELECT hours_per_week, availability, roles FROM volunteer_applications WHERE id=? AND org_id=?", [recordId, orgId]);
  const parse = v => { try { return typeof v === "string" ? JSON.parse(v) : (v || []); } catch { return []; } };
  return { personId: p.id, recordId, created, name: p.name,
    hoursPerWeek: now && now.hours_per_week != null ? Number(now.hours_per_week) : null,
    availability: parse(now && now.availability), roles: parse(now && now.roles) };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 341
async function checkVolunteerFields(opts) { await VOL_DAYS_READY; return volunteerRecordFields(opts); }
// SPLIT-2 end
// SPLIT-2 server.js piece 342
// The sentence a screen (or the Agent's step) says after makeVolunteer.
function volunteerRecordSentence(r) {
  const bits = [];
  if (r.hoursPerWeek) bits.push(`${r.hoursPerWeek} ${r.hoursPerWeek === 1 ? "hour" : "hours"} a week`);
  if (r.availability && r.availability.length) bits.push(r.availability.join(", "));
  if (r.roles && r.roles.length) bits.push(`as ${r.roles.join(", ")}`);
  return `${r.name} ${r.created ? "is now a volunteer, on the record they already had" : "was already a volunteer; their record is updated"}${bits.length ? ": " + bits.join(" · ") : ""}.`;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 343

async function insertShift(orgId, personId, shift, { via, importKey = null, who }) {
  const rows = await query(
    `INSERT INTO volunteer_shifts (id,org_id,person_id,date,hours,role,note,via,import_key,created_by,created_by_name,
                                   opportunity_id,slot_id,start_time,end_time)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT (org_id, import_key) WHERE import_key IS NOT NULL DO NOTHING RETURNING id`,
    [newId("vs"), orgId, personId, shift.date, shift.hundredths / 100, shift.role, shift.note || null,
     via, importKey, who.id, who.name,
     // PARITY-3 — which opportunity and shift the hours were given to, and the
     // clock times when they were logged that way. All optional.
     shift.opportunityId || null, shift.slotId || null, shift.startTime || null, shift.endTime || null]);
  if (rows.length) await markVolunteer(orgId, personId);
  // LIVE-1 — hours are a change to the person: the one after-change step.
  if (rows.length) AFTER.afterChangeSoon(orgId, [personId], { door: "volunteer_hours", recalc: false });
  return rows[0]?.id || null;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 344

async function volunteerSummary(orgId, personId) {
  const [t] = await query(`SELECT COALESCE(SUM(round(hours*100)),0)::bigint AS h, COUNT(*)::int AS n, MIN(date) AS first, MAX(date) AS last
                             FROM volunteer_shifts WHERE org_id=? AND person_id=?`, [orgId, personId]);
  return { hundredths: Number(t?.h || 0), totalHours: Number(t?.h || 0) / 100, shiftCount: t?.n || 0, firstShift: t?.first || null, lastShift: t?.last || null };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 388

// ── BUILD-81 — THE THREAD ───────────────────────────────────────────────────
// A thread is a donor plus an open next step: the last touch, the next step
// with a due date, days open, and who owns it. One open thread per donor
// (partial unique index threads_one_open). The engine is BUILD-76's byproduct
// logging with a name and a place: logging a conversation IS creating the
// follow-up — nothing here asks anyone to create a task.
//
// Ways out of a thread, and silent is not one of them (threads_close_honest
// CHECK in db.js — the DATABASE refuses a close with no outcome and no
// reason): an outcome logged (one line, and the next-step prompt runs again)
// or a dismissal with a reason. "Not now, revisit on [date]" is a SNOOZE on
// an open thread, deliberately not a close.
//
// Threads are NEVER inferred from imported data — a Last Contact column in a
// file is history, not an open loop. The only non-human opener is a LIVE gift
// landing (webhook / manual entry), whose next step is "Thank".
async function threadShapeMod() { return import("../../shared/threadShape.js"); }
// SPLIT-2 end
// SPLIT-2 server.js piece 389
// BUILD-85 — the ordering. Pure module, same ESM-from-CJS door as above.
async function threadRankMod() { return import("../../shared/threadRank.js"); }
// SPLIT-2 end
// SPLIT-2 server.js piece 390

// Open a thread inside a caller-held transaction. Returns the row, or null
// when the donor already has an open thread (the one-open-thread rule — the
// partial unique index decides under a race, not a check-then-insert).
async function openThreadTx(client, { orgId, donorId, step, openedOn, ownerId, ownerName, actorId, actorName, openingInteractionId = null, openingGiftId = null, followon = null }) {
  const id = newId("th");
  const rows = await queryTx(client,
    `INSERT INTO threads (id,org_id,donor_id,next_step_type,next_step_label,due_date,due_time,opened_on,
                          opening_interaction_id,opening_gift_id,owner_id,owner_name,
                          created_by,created_by_name,followon_type,followon_label,followon_due)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT (org_id, donor_id) WHERE closed_at IS NULL DO NOTHING
     RETURNING *`,
    [id, orgId, donorId, step.type, step.label, step.due, step.time || null, openedOn,
     openingInteractionId, openingGiftId, ownerId || null, ownerName || null,
     actorId || null, actorName || null,
     followon?.type || null, followon?.label || null, followon?.due || null]);
  return rows[0] || null;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 391

// A LIVE gift opens a thread whose next step is "Thank" (+2 days) — the
// "gift received" row of the defaults table, applied on the server so a gift
// not yet thanked IS a thread rather than a parallel computation. Gated the
// way every person surface is: never for sample/deceased/do-not-contact
// donors or non-person records (orgs/DAFs/anonymous), never for recurring
// renewals (their thank-you path is transactional and automatic), and never
// from an import (imports call bulk inserts, not this).
async function openGiftThread(orgId, donorId, { giftId, giftDate, actorId, actorName }) {
  try {
    const [d] = await query(
      `SELECT id, assigned_to, assigned_to_name FROM donors
        WHERE id = ? AND org_id = ? AND deleted_at IS NULL
          AND is_sample IS NOT TRUE AND deceased IS NOT TRUE AND do_not_contact IS NOT TRUE
          AND (kind IS NULL OR kind = 'person')`, [donorId, orgId]);
    if (!d) return null;
    const org = await orgTz(orgId);
    const today = orgToday(org);                       // ORG_TZ_SEAM_OK
    const { nextStepSuggestion } = await threadShapeMod();
    const step = nextStepSuggestion("gift", today);
    return await withTransaction(client => openThreadTx(client, {
      orgId, donorId, step: { type: step.type, label: step.label, due: step.due },
      openedOn: today, openingGiftId: giftId || null,
      ownerId: d.assigned_to || null, ownerName: d.assigned_to_name || null,
      actorId, actorName,
    }));
  } catch (e) { console.error("[thread] gift thread:", e.message); return null; }
}
// SPLIT-2 end
// SPLIT-2 server.js piece 392

// WIRE-1 · AN ORG-LEVEL THING THAT NEEDS A HUMAN IS A TASK FOR AN ADMIN.
// One open task per title (a second sweep finds the first and opens none),
// assigned to the given user or the org's first admin, linked to a person when
// there is one. It writes the task and nothing else. Returns the new task id,
// or null when one is already open or there is nobody to give it to.
async function openAdminTask(orgId, { title, due = null, priority = "medium", donorId = null, assignee = null, actorId, actorName }) {
  const owner = assignee || (await query(
    `SELECT id, name, email FROM users WHERE org_id=? AND role='admin' AND deactivated_at IS NULL ORDER BY created_at ASC LIMIT 1`, [orgId]))[0];
  if (!owner) return null;
  const [open] = await query(
    `SELECT id FROM tasks WHERE org_id=? AND title=? AND COALESCE(done::text, '0') NOT IN ('1','true') AND voided_at IS NULL LIMIT 1`, [orgId, title]);
  if (open) return null;
  const id = newId("t");
  await run(
    `INSERT INTO tasks (id,org_id,title,due,priority,type,done,donor_id,assigned_to,assigned_to_name,created_by,created_by_name)
     VALUES (?,?,?,?,?,?,0,?,?,?,?,?)`,
    [id, orgId, title, due || orgToday(await orgTz(orgId)), priority, donorId ? "donor" : "admin", donorId,   // ORG_TZ_SEAM_OK
     owner.id, owner.name || owner.email || "", actorId, actorName || "Steward (automatic)"]);
  return id;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 393

// WIRE-1 · A THING THAT NEEDS A HUMAN OPENS A STEP ON THE THREAD.
// One opener for the automatic care steps (a membership that lapsed, a missed
// shift, an auction item won and not paid). It writes a thread and nothing
// else: no draft is sent, no mail goes out. The person's own owner holds it;
// the actor is `system:<path>` so the row says which automation opened it.
// Never for deleted, sample or deceased people. Returns the thread, or null
// when the person already has an open step (that step waits its turn).
async function openCareThread(orgId, donorId, { type = "follow_up", label, dueInDays = 2, path }) {
  try {
    const [d] = await query(
      `SELECT id, assigned_to, assigned_to_name FROM donors
        WHERE id = ? AND org_id = ? AND deleted_at IS NULL AND is_sample IS NOT TRUE AND deceased IS NOT TRUE`,
      [donorId, orgId]);
    if (!d) return null;
    const today = orgToday(await orgTz(orgId));                    // ORG_TZ_SEAM_OK
    const { sanitizeStepLabel } = await threadShapeMod();
    return await withTransaction(client => openThreadTx(client, {
      orgId, donorId, step: { type, label: sanitizeStepLabel(label) || "Follow up", due: orgTime.addDays(today, dueInDays) },
      openedOn: today, ownerId: d.assigned_to || null, ownerName: d.assigned_to_name || null,
      actorId: `system:${path}`, actorName: SYS_AUTO.name,
    }));
  } catch (e) { console.error(`[thread] ${path}:`, e.message); return null; }
}
// SPLIT-2 end
// SPLIT-2 server.js piece 394

// ── A SUSTAINER THE AUTOMATION COULD NOT SAVE BECOMES A PERSON'S JOB ───────
// (2026-09-11) The dunning cadence is four emails over fourteen days. When it
// runs out, `next_dunning_at` goes NULL and the subscription was left to
// Stripe's own retries and eventual cancellation — with nobody told. A monthly
// donor of six years stopped being a donor and no human ever heard about it.
//
// That is the exact moment this product exists for: the follow-up that was
// meant and never happened. So exhausting the automation opens a THREAD — a
// donor, an open next step, a due date — owned by whoever owns the donor.
//
// Deliberately a thread and not a task: BUILD-81 made the thread the spine,
// one open per donor, closed only by a logged outcome or a stated reason. The
// `ON CONFLICT (org_id, donor_id) WHERE closed_at IS NULL DO NOTHING` in
// openThreadTx is what makes this safe to call from both of its two callers
// (cadence exhaustion, and involuntary cancellation for orgs that never dunned)
// without ever producing a second thread.
//
// NOTE: the person-surface gate is copied from openGiftThread verbatim, so a
// sample/deceased/do-not-contact/non-person record never gets one. BUILD-84
// gave organisations a `contact_name`, which arguably makes them callable now —
// that is a change to BUILD-80 Part 7's contract and belongs to its own
// decision, not to this one.
async function openSustainerLapseThread(orgId, donorId, { amount = null, interval = "month", reason = "dunning_exhausted" } = {}) {
  try {
    const [d] = await query(
      `SELECT id, assigned_to, assigned_to_name FROM donors
        WHERE id = ? AND org_id = ? AND deleted_at IS NULL
          AND is_sample IS NOT TRUE AND deceased IS NOT TRUE AND do_not_contact IS NOT TRUE
          AND (kind IS NULL OR kind = 'person')`, [donorId, orgId]);
    if (!d) return null;
    const org = await orgTz(orgId);
    const today = orgToday(org);                       // ORG_TZ_SEAM_OK
    const { sanitizeStepLabel } = await threadShapeMod();
    // The label says the money and the cadence, because "follow up" on its own
    // tells the officer nothing about what they are walking into.
    const amt = amount != null && Number(amount) > 0
      ? "$" + Number(amount).toLocaleString(undefined, { maximumFractionDigits: 2 }) + " " : "";
    const per = interval === "year" ? "yearly" : "monthly";
    const label = sanitizeStepLabel(`Call about their ${amt}${per} gift: the card failed and our emails did not reach them`)
      || "Call about their recurring gift";
    // Due TODAY: by the time this fires the gift has already been failing for
    // a fortnight. A +N-day default would be the automation stalling twice.
    const thread = await withTransaction(client => openThreadTx(client, {
      orgId, donorId, step: { type: "follow_up", label, due: today },
      openedOn: today,
      ownerId: d.assigned_to || null, ownerName: d.assigned_to_name || null,
      actorId: SYS_AUTO.id, actorName: SYS_AUTO.name,
    }));
    if (thread) console.log(`[recurring] sustainer handed to a human: org=${orgId} donor=${donorId} reason=${reason}`);
    return thread;
  } catch (e) { console.error("[thread] sustainer lapse thread:", e.message); return null; }
}
// SPLIT-2 end
// SPLIT-2 server.js piece 397

// ── BUILD-85 — DOES THE ENGINE RUN? ────────────────────────────────────────
// Drift snapshots log_capture_rate. The Thread snapshotted NOTHING, so the
// product's central claim — log a conversation and the next step comes back —
// was untested in the only way that counts. The number that answers it is
// CONTINUATION: of the threads closed as an outcome, how many had their
// closing conversation open the next one. A high open count with a low
// continuation rate is a list being cleared, not a relationship being kept.
async function computeThreadHealth(orgId, { days = 30 } = {}) {
  const [row = {}] = await query(
    `WITH closed AS (
       SELECT t.id, t.close_kind, t.closing_interaction_id, t.opened_on,
              GREATEST(0, (t.closed_at AT TIME ZONE 'UTC')::date - t.opened_on::date) AS days_to_close
         FROM threads t
        WHERE t.org_id = ? AND t.closed_at IS NOT NULL
          AND t.closed_at >= NOW() - (? || ' days')::interval
     )
     SELECT COUNT(*)::int AS closed_count,
            COUNT(*) FILTER (WHERE close_kind = 'outcome')::int AS outcome_count,
            COUNT(*) FILTER (WHERE close_kind = 'dismissed')::int AS dismissed_count,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY days_to_close) AS median_days
       FROM closed`, [orgId, String(days)]);
  // Continuation: an outcome-closed thread whose closing interaction is the
  // OPENING interaction of another thread. That join IS the chain.
  const [cont = {}] = await query(
    `SELECT COUNT(*)::int AS n
       FROM threads a
       JOIN threads b ON b.org_id = a.org_id AND b.opening_interaction_id = a.closing_interaction_id
      WHERE a.org_id = ? AND a.close_kind = 'outcome' AND a.closing_interaction_id IS NOT NULL
        AND a.closed_at >= NOW() - (? || ' days')::interval`, [orgId, String(days)]);
  const outcome = row.outcome_count || 0;
  const [{ n: open } = { n: 0 }] = await query(
    `SELECT COUNT(*)::int AS n FROM threads t JOIN donors d ON d.id = t.donor_id AND d.org_id = t.org_id
      WHERE t.org_id = ? AND t.closed_at IS NULL AND d.deleted_at IS NULL`, [orgId]);
  return {
    windowDays: days, open,
    closed: row.closed_count || 0,
    outcome, dismissed: row.dismissed_count || 0,
    medianDaysToClose: row.median_days == null ? null : Math.round(parseFloat(row.median_days)),
    // THIN DATA IS SAID, NOT SMOOTHED (the BUILD-76 retention rule): a rate
    // over three threads is an artifact, so it is returned as null with the
    // count beside it rather than as a confident percentage.
    continued: cont.n || 0,
    continuationRate: outcome >= 5 ? Math.round((cont.n || 0) / outcome * 100) : null,
    thinData: outcome < 5,
  };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 400

// CAN-SPAM requires the sender's physical postal address in commercial email,
// so the footer carries it alongside the unsubscribe link. Sourced live from
// the org's tax-receipt settings (orgs.receipt_address, BUILD-01) so there is
// exactly one address to maintain; async because it looks the org up itself —
// one pk lookup per send, trivial next to the Resend HTTP call, and it means
// no send path can miss the address by forgetting a column in its org SELECT.
// An org that hasn't filled in receipt_address yet degrades to the old
// unsubscribe-only footer (Communications shows admins a Settings prompt
// until they add it).
// ── BUILD-94 Part 4 — NO ADDRESS, NO SEND ──────────────────────────────────
// Commercial email must carry the sender's physical postal address (CAN-SPAM
// §7704(a)(5)); Gmail and Yahoo's bulk-sender rules assume it too. BUILD-81
// already made the digest refuse to go without one. This extends that refusal
// to CAMPAIGNS and SEQUENCES — the two things that actually go out in bulk.
//
// It is a REFUSAL, not a warning, and deliberately so: a warning on a screen
// somebody dismissed is how an organisation ends up sending 4,000 unlawful
// emails, and the fix is ninety seconds of typing in Settings.
async function bulkSendAddressGate(orgId) {
  const [org] = await query("SELECT name, receipt_address FROM orgs WHERE id = ?", [orgId]).catch(() => []);
  const addr = String(org?.receipt_address || "").trim();
  if (addr) return { ok: true, address: addr };
  return {
    ok: false,
    reason: "no_mailing_address",
    message: "Every bulk email has to carry your organization's mailing address, it is the law for " +
             "commercial email, and Gmail and Yahoo both require it. Add it in Settings → Tax Receipts " +
             "and it appears in every footer from then on.",
  };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 401

// ── BUILD-64 — ONE theme resolver for every donor-facing artifact ──────────
// The give page and the portal read the org's identity from portal_settings
// (portalCardTheme + display_name). Before BUILD-64 the EMAIL header band and
// the receipt PDF read a SECOND, unrelated copy — orgs.brand_accent (the old
// BUILD-13 white-label), which was unset on the demo orgs and fell back to
// Steward green. Result: a terracotta org's receipt arrived with a green band.
// resolveOrgBrandTheme is now THE resolver every off-web artifact reads, so an
// org's mail and documents carry the same colors, logo and white-label name as
// its portal — never a second copy, never Steward's mark. (Legal fields — the
// receipt's legal_name/EIN — stay on orgs; only the BRAND surface moves here.)
async function resolveOrgBrandTheme(orgId) {
  const rows = await query(
    `SELECT o.name, o.legal_name, o.logo_data AS org_logo,
            ps.display_name, ps.primary_color, ps.accent_color, ps.button_color,
            ps.background_tint, ps.type_pairing, ps.card_style,
            ps.logo_data AS ps_logo_data, ps.logo_url AS ps_logo_url
       FROM orgs o LEFT JOIN portal_settings ps ON ps.org_id = o.id
      WHERE o.id = ?`, [orgId]);
  const r = rows[0] || {};
  const card = portalCardTheme(r); // primary/accent/fg from portal_settings, designed-neutral default when unset
  const isData = v => typeof v === "string" && /^data:image\/(png|jpe?g|gif|webp);base64,/.test(v);
  // A logo we can embed inline (email <img>, PDF doc.image) MUST be base64.
  const logoDataUri = [r.ps_logo_data, r.org_logo].find(isData) || null;
  // An asset-URL logo (portal_settings.logo_url, e.g. /portal-assets/pa_…) can
  // ride an email as an absolute src, but can't be embedded in the PDF.
  const logoAbsUrl = (!logoDataUri && typeof r.ps_logo_url === "string" && r.ps_logo_url)
    ? (r.ps_logo_url.startsWith("http") ? r.ps_logo_url : publicAppUrl() + r.ps_logo_url) : null;
  const displayName = displayNameCase(String(r.display_name || "").trim() || r.name || "");
  return {
    band: card.primary, bandFg: card.primaryFg,
    accent: card.accent, accentFg: card.accentFg,
    logoDataUri, logoAbsUrl,
    displayName,
    legalName: r.legal_name || r.name || displayName,
  };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 402

// ── BUILD-65 Part 2 — a PDF-embeddable logo, from OBJECT STORAGE ────────────
// renderReceiptPdf can only embed PNG/JPEG bytes (pdfkit's constraint). Since
// BUILD-51 a modern org's logo lives in object storage — portal_settings
// .logo_url = /portal-assets/<id> — so resolveOrgBrandTheme's logoDataUri
// (base64 only) is NULL for it, and every real org's tax receipt rendered with
// NO logo while the legacy demo data (base64 in the row) worked fine. This
// fetches the asset bytes and returns a png/jpeg data URI the PDF can embed —
// converting WebP/SVG/GIF to PNG (which also fixes legacy base64 WebP logos the
// old png|jpeg-only check silently dropped). Async + only called on the
// (low-frequency) PDF-issue paths, so resolveOrgBrandTheme stays cheap for the
// hot email paths. Returns null on any failure — a missing logo is never fatal.
async function resolvePdfLogo(brand) {
  if (!brand) return null;
  let buffer = null, ct = null;
  try {
    const dm = typeof brand.logoDataUri === "string" ? brand.logoDataUri.match(/^data:([^;]+);base64,(.*)$/s) : null;
    if (dm) { buffer = Buffer.from(dm[2], "base64"); ct = dm[1]; }
    else if (typeof brand.logoAbsUrl === "string") {
      const idm = brand.logoAbsUrl.match(/(pa_[a-f0-9]{24})/);
      if (idm) { const a = await getThemeAsset(idm[1]); if (a) { buffer = a.buffer; ct = a.contentType; } }
    }
  } catch (e) { console.error("[pdf-logo] fetch failed:", e.message); return null; }
  if (!buffer || !buffer.length) return null;
  if (ct === "image/png" || ct === "image/jpeg" || ct === "image/jpg") {
    return `data:${ct};base64,${buffer.toString("base64")}`;
  }
  try {
    const sharp = require("sharp");
    const png = await sharp(buffer, { failOn: "none" }).png().toBuffer();
    return "data:image/png;base64," + png.toString("base64");
  } catch (e) { console.error("[pdf-logo] convert failed:", e.message); return null; }
}
// SPLIT-2 end
// SPLIT-2 server.js piece 404
function fromWithDisplayName(displayName, addr) {
  const clean = String(displayName || "").replace(/[\r\n"<>]/g, "").trim().slice(0, 78);
  return clean ? `${clean} <${addr}>` : addr;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 405

// ── BUILD-88c C.1 — THE ONE PLACE A SENDING IDENTITY IS DECIDED ───────────
// Every donor-facing send asks this, and nothing else decides it. Two answers:
//
//   VERIFIED — the org published Resend's DNS records for a domain it controls,
//   Steward checked, and it holds. From is a PERSON at that domain
//   ("Ada Trelawney <ada@sparrowmissions.org>"), Reply-To is the same address,
//   and the List-Unsubscribe mailto is on their domain too. Nothing the
//   recipient's inbox shows them says "steward".
//
//   NOT VERIFIED — exactly today's behaviour, unchanged: the org's NAME in the
//   display slot over Steward's shared address, with the user's address as
//   Reply-To. Nobody is ever blocked from sending by a DNS record they have not
//   published yet, and the screen says which of the two is in force.
//
// A verified domain is a fact about the ORG, so this reads the org row and
// never a request parameter: a caller cannot ask to send as somebody else.
async function orgSendingIdentity(orgId, { replyTo = null } = {}) {
  const [org] = await query(
    `SELECT name, sending_domain, sending_domain_status, sending_from_email, sending_domain_verified_at
       FROM orgs WHERE id=?`, [orgId]).catch(() => []);
  const theme = await resolveOrgBrandTheme(orgId).catch(() => null);
  const displayName = (theme && theme.displayName) || (org && org.name) || "";
  const verified = !!(org && org.sending_domain && org.sending_domain_status === "verified"
                      && org.sending_from_email
                      && String(org.sending_from_email).toLowerCase().endsWith("@" + String(org.sending_domain).toLowerCase()));
  const addr = verified ? org.sending_from_email : DONOR_MAIL_ADDR();
  // ON THE SHARED DOMAIN A REPLY HAS TO REACH A HUMAN. It did not: donor-facing
  // mail carried no Reply-To at all, so a donor answering a receipt or an
  // appeal was writing to `noreply@stewardapp.dev`, and the answer went nowhere.
  // The org's chosen sending address if it has one, else its first admin.
  let reply = null;
  if (!verified) {
    reply = replyTo || (org && org.sending_from_email) || null;
    if (!reply) {
      const [admin] = await query(
        "SELECT email FROM users WHERE org_id=? AND email IS NOT NULL AND role='admin' ORDER BY created_at ASC, id ASC LIMIT 1",
        [orgId]).catch(() => []);
      reply = admin?.email || null;
    }
  }
  return {
    verified,
    domain: verified ? org.sending_domain : null,
    verifiedAt: verified ? org.sending_domain_verified_at : null,
    address: addr,
    from: fromWithDisplayName(displayName, addr),
    // On the org's own domain the From IS a human at their own address, and a
    // second header saying the same thing is noise.
    replyTo: reply,
    displayName,
  };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 406

// The three headers every donor-facing send needs, resolved together so they
// cannot disagree about which identity is in force. ONE call site per send.
// NOTE, and it cost this build an assertion to find: the Resend SDK maps
// `payload.replyTo` onto the wire's `reply_to` and IGNORES a `reply_to` key
// passed in. Three call sites in this file were passing the snake_case one and
// silently sending no Reply-To at all — including the founder's onboarding
// drip. Every one of them is `replyTo` now.
async function donorSendOpts(orgId, donorEmail, source = "campaign") {
  const identity = await orgSendingIdentity(orgId);
  return {
    from: identity.from,
    ...(identity.replyTo ? { replyTo: identity.replyTo } : {}),
    headers: unsubscribeHeaders(donorEmail, orgId, source, identity),
    // Read by the client proxy (logged per org, refused if the org's mail is
    // off) and stripped before the provider sees the payload.
    _stewardOrgId: orgId, _stewardKind: source,
  };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 407

// ── BUILD-58 W-4 — ONE place decides suppressibility ───────────────────────
// Every donor-facing message kind is classified transactional | marketing.
// TRANSACTIONAL = service mail about the donor's own money or account
// (failed-card recovery, receipts, year-end statements, recurring-gift
// changes). A donor who unsubscribed from a newsletter has NOT opted out of
// being told their card failed — transactional mail NEVER consults the
// marketing suppression list. MARKETING = org-authored outreach; the
// suppression list and the donor's do_not_contact flag both apply.
// `deceased` blocks everything.
//
// The raw probe above (getSuppressionReason) may be called ONLY by
// donorMailDecision — pinned by tests/mail-suppression.test.js source scan —
// so a new send site cannot quietly consult the wrong list. An UNCLASSIFIED
// kind fails CLOSED: classify it here before it can send.
//
// NB the transactional-vs-marketing line is a legal judgment as well as a
// product one — flagged for attorney review in NEEDS-JONATHAN.md §7; this table
// is the product's best-faith classification, not a legal conclusion.
// W-2 white-label sweep: the name a DONOR sees is the portal display name
// when the org set one, never the staff-side orgs.name ("CREO Arts (Demo)").
// Used by the transactional donor-mail family + the public give payloads.
async function donorFacingOrgName(orgId, fallbackName) {
  const rows = await query("SELECT display_name FROM portal_settings WHERE org_id = ?", [orgId]).catch(() => []);
  const dn = String(rows[0]?.display_name || "").trim();
  return dn || displayNameCase(fallbackName || "");
}
// SPLIT-2 end
// SPLIT-2 server.js piece 413

function signRecoveryToken(subscriptionId, orgId) {
  const payload = Buffer.from(JSON.stringify({ subscriptionId, orgId })).toString("base64url");
  const sig = crypto.createHmac("sha256", RECOVERY_SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 414

// BUILD-77 Part 6 — the reconnect token binds a giving-page prefill to the
// EXISTING donor so the new subscription stitches back to their record
// (never a second donor). Same HMAC construction as the recovery token.
function signReconnectToken(donorId, orgId) {
  const payload = Buffer.from(JSON.stringify({ donorId, orgId, k: "reconnect" })).toString("base64url");
  const sig = crypto.createHmac("sha256", RECOVERY_SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 415
function verifyReconnectToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = crypto.createHmac("sha256", RECOVERY_SECRET).update(payload).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { const d = JSON.parse(Buffer.from(payload, "base64url").toString()); return (d.k === "reconnect" && d.donorId && d.orgId) ? d : null; }
  catch { return null; }
}
// SPLIT-2 end
// SPLIT-2 server.js piece 416

// ── GIVE-2 §3 · WHICH AMOUNTS A FORM OFFERS ────────────────────────────────
// Two questions, in this order, and the org wins both:
//
//   1. Has this form asked for computed amounts (`smartAmounts`)? OFF by
//      default. A fundraiser who typed four numbers is not overruled.
//   2. Who is looking? A donor arriving on their OWN personal link (the
//      BUILD-77 reconnect token, which is the personal link this product
//      already sends) sees amounts starting from their own last gift. Everybody
//      else sees amounts drawn from this organisation's own recorded gifts
//      through this form.
//
// FROM THE ORG'S OWN DATA AND NOTHING ELSE. Not wealth data, not a capacity
// estimate, not anything bought from anybody — that is PROSPECT-1 and it is a
// different build with different promises. The sentence the form shows says
// exactly which of the two answers a donor is reading.
//
// A ladder that cannot be computed honestly is NOT computed: fewer than eight
// gifts is not a distribution, and the form keeps what the fundraiser set.
async function smartAmountsFor(spec, { orgId, givingPageId, personalToken }) {
  if (!spec || !spec.amount || !spec.amount.smartAmounts) return null;
  const S = await smartAmountsMod();

  // THE DONOR'S OWN LAST GIFT, when they hold their own link. Verified by HMAC
  // and scoped to this org, so a token minted for another organisation reads
  // nothing here.
  if (personalToken) {
    const decoded = verifyReconnectToken(personalToken);
    if (decoded && decoded.orgId === orgId) {
      const [d] = await query(
        `SELECT last_gift_amount FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL`,
        [decoded.donorId, orgId]);
      const ladder = d ? S.ladderFromLastGift(toCents(d.last_gift_amount) || 0) : null;
      if (ladder) return ladder;
    }
  }

  // THE ORG'S OWN DISTRIBUTION. This form's gifts when it has enough of them,
  // the org's otherwise — a brand-new form has no history of its own and the
  // organisation's is the next most honest thing. Twenty-four months, because a
  // ladder built on what people gave four years ago is a ladder about a
  // different organisation. Cover-the-fee comes OFF first: what the donor MEANT
  // to give is the number a suggested amount is built from.
  const rows = await query(
    `SELECT round((amount - COALESCE(cover_fee_amount,0)) * 100)::bigint AS cents
       FROM gifts
      WHERE org_id = ? AND giving_page_id = ?
        AND date >= (${orgTime.orgTodaySql(orgTime.orgTzSql("gifts.org_id"))} - INTERVAL '24 months')::date::text
        AND amount > 0
      ORDER BY date DESC NULLS LAST LIMIT 2000`, [orgId, givingPageId]);
  let cents = rows.map(r => Number(r.cents));
  let scope = "this form";
  if (cents.length < S.MIN_SAMPLE) {
    const orgRows = await query(
      `SELECT round((amount - COALESCE(cover_fee_amount,0)) * 100)::bigint AS cents
         FROM gifts
        WHERE org_id = ?
          AND date >= (${orgTime.orgTodaySql(orgTime.orgTzSql("gifts.org_id"))} - INTERVAL '24 months')::date::text
          AND amount > 0
        ORDER BY date DESC NULLS LAST LIMIT 2000`, [orgId]);
    if (orgRows.length >= S.MIN_SAMPLE) { cents = orgRows.map(r => Number(r.cents)); scope = "this organization"; }
  }
  const dist = S.ladderFromDistribution(cents);
  if (!dist.amountsCents) return null;
  return { ...dist, scope };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 417

// The one place a computed ladder replaces a typed one, so the public form and
// the editor's preview cannot disagree about which answer the donor is reading.
// A null ladder leaves the spec byte-for-byte as `formSpec` built it.
async function withSmartAmounts(spec, ctx) {
  const ladder = await smartAmountsFor(spec, ctx).catch(e => {
    // A ladder is a nicety. A form that cannot compute one still has to take a
    // gift, so the typed amounts stand and the failure is logged.
    console.error("[forms] could not compute smart amounts:", e.message);
    return null;
  });
  if (!ladder) return spec;
  return { ...spec, amount: { ...spec.amount,
    amountsCents: [...ladder.amountsCents],
    amountsSource: ladder.source,
    amountsSentence: ladder.sentence || "",
  } };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 418

function buildCardUpdateUrl(subscriptionId, orgId) {
  // Canonical domain via the vercel.json /recurring/update-card proxy rewrite
  // — the failed-card recovery email is exactly where a suspicious-looking
  // host would cost a recovery. See buildUnsubscribeUrl.
  return `${publicAppUrl()}/recurring/update-card?token=${signRecoveryToken(subscriptionId, orgId)}`;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 419

async function logRecoveryEvent(orgId, donorId, subscriptionId, type, stripeEventId, detail) {
  await run(
    `INSERT INTO payment_recovery_events (id, org_id, donor_id, subscription_id, type, stripe_event_id, detail)
     VALUES (?,?,?,?,?,?,?)`,
    [newId("pre"), orgId, donorId || null, subscriptionId || null, type, stripeEventId || null, JSON.stringify(detail || {})]
  );
}
// SPLIT-2 end
// SPLIT-2 server.js piece 421
async function logRecurringChange(orgId, subscriptionId, donorId, kind, { oldAmount = null, newAmount = null, interval = null, actor = "system", actorName = null } = {}) {
  if (!RECURRING_CHANGE_KINDS.has(kind)) return;
  await run(
    `INSERT INTO recurring_change_log (id, org_id, subscription_id, donor_id, kind, old_amount, new_amount, sub_interval, actor, actor_name)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [newId("rcl"), orgId, subscriptionId || null, donorId || null, kind, oldAmount, newAmount, interval, actor, actorName]
  ).catch(e => console.error("[recurring] change-log write failed:", e.message));
}
// SPLIT-2 end
// SPLIT-2 server.js piece 422

// Recovered / (recovered + lost) over a trailing window, computed from the
// append-only payment_recovery_events log — shared by GET /recurring/health
// and the daily metric_snapshots snapshot below.
async function computeRecoveryRate(orgId) {
  const windowStart = new Date(Date.now() - RECOVERY_RATE_WINDOW_DAYS * 86400000).toISOString();
  const recoveredCount = (await query(
    "SELECT COUNT(DISTINCT subscription_id)::int AS c FROM payment_recovery_events WHERE org_id=? AND type='payment_recovered' AND created_at >= ?",
    [orgId, windowStart]
  ))[0]?.c || 0;
  const lostCount = (await query(
    "SELECT COUNT(DISTINCT subscription_id)::int AS c FROM payment_recovery_events WHERE org_id=? AND type='subscription_canceled' AND created_at >= ?",
    [orgId, windowStart]
  ))[0]?.c || 0;
  const rate = (recoveredCount + lostCount) > 0 ? Math.round((recoveredCount / (recoveredCount + lostCount)) * 100) : null;
  return { rate, recoveredCount, lostCount };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 423

// ── BUILD-97 Part 5 — OBSERVABILITY, BECAUSE YOU CANNOT RUN WHAT YOU CANNOT
// SEE ──────────────────────────────────────────────────────────────────────
// The 22 September incident ran for TWELVE DAYS. It was found in a Resend log
// at eleven at night, by somebody who went looking because three delivered
// messages had turned up. The brief's own sentence: "The incident on the 22nd
// would have shown here in one line at 3 PM instead of in a Resend log at 11."
//
// One page, super-admin only. Everything on it is a READ.

// A tick that throws is a console line on a server nobody is reading. This
// wraps one, records it, and never changes what the tick does.
// FIX-11 Part 6 tail — EVERY JOB EITHER LEAVES A TRAIL OR IS NAMED AS ONE
// THAT DOES NOT.
//
// Part 1 gave every ROUTE a trail it cannot forget, and its census named the
// hole that left: a periodic sweep does not pass through Express. The sweeps
// that did log called `writeAuditLog` by hand, which is the same arrangement
// that left four hundred routes unlogged for a year.
//
// `recordTick` is the one seam every job passes through, so the rule lives
// here. A job is declared in jobAudit.js as one that WRITES (donor data,
// money, mail) or one that only READS. A job in neither list throws rather
// than running: forgetting must not be a silent option, and a job nobody has
// classified is a job nobody has thought about.
//
// A writing job returns `{ detail, orgs, summary }` and gets ONE audit row per
// organisation it changed, because an audit row is scoped to an org. Returning
// a plain string still works and means "I changed nothing worth recording" —
// which is the honest answer for most runs of most sweeps.
async function recordTick(name, fn) {
  if (!dbReady) await DB_READY;   // HARDEN-1: never before the schema is migrated
  const JA = require("../../jobAudit");
  const kind = JA.jobKind(name);
  if (!kind) {
    const msg = `Background job "${name}" is not classified in jobAudit.js. `
      + `Add it to JOB_WRITES (and return its orgs) or to JOB_READS_ONLY with the reason.`;
    console.error("[tick] REFUSED:", msg);
    throw new Error(msg);
  }
  const id = newId("tick");
  await run(`INSERT INTO tick_log (id,name) VALUES (?,?)`, [id, name]).catch(() => {});
  try {
    const raw = await fn();
    const r = JA.normalizeJobResult(raw);
    await run(`UPDATE tick_log SET finished_at=NOW(), ok=TRUE, detail=? WHERE id=?`,
      [r.detail ? r.detail.slice(0, 300) : null, id]).catch(() => {});
    // ONE ROW PER ORG THE JOB CHANGED. Written through the same insert the
    // request middleware uses, so a job's row and a person's row are the same
    // kind of row and the screen shows them together.
    if (kind === "writes" && r.orgs.length) {
      const M = require("../../middleware/auditTrail");
      const who = JA.jobActor(name);
      for (const orgId of r.orgs.slice(0, 2000)) {
        await M.insertAuditRow({
          orgId, actorId: who.id, actorName: who.name, actorKind: "system",
          action: "ran", entityType: "background job", entityId: name,
          entityLabel: JA.JOB_WRITES[name] || name,
          changes: r.counts || {}, before: null, after: null,
          summary: r.summary || r.detail || null, recordCount: null,
          method: null, path: `job:${name}`, status: null, ip: null,
        }).catch(e => console.error(`[tick] ${name}: audit row for ${orgId}:`, e.message));
      }
    }
    return raw;
  } catch (e) {
    await run(`UPDATE tick_log SET finished_at=NOW(), ok=FALSE, error=? WHERE id=?`,
      [String(e && e.message || e).slice(0, 400), id]).catch(() => {});
    // A TICK FAILURE IS AN ALERT, not just a row. It is one of the three things
    // the brief says Jonathan hears about.
    opsAlert("tick_failed", `Background job "${name}" failed`,
      `${name} threw: ${String(e && e.message || e).slice(0, 400)}`).catch(() => {});
    throw e;
  }
}
// SPLIT-2 end

__share({ renderReceiptPdf, givingAccountEntry, issueGiftReceipt, processGivingSources, donorIsOrganisation, donorByNameOrCreate, grantMsMod, orgLeadDays, raiseGrantMilestone, processGrantMilestones, restrictedMod, grantMoneyRows, grantBalanceFrom, markVolunteer, volunteerRecordFields, makeVolunteer, checkVolunteerFields, volunteerRecordSentence, insertShift, volunteerSummary, threadShapeMod, threadRankMod, openThreadTx, openGiftThread, openAdminTask, openCareThread, openSustainerLapseThread, computeThreadHealth, bulkSendAddressGate, resolveOrgBrandTheme, resolvePdfLogo, fromWithDisplayName, orgSendingIdentity, donorSendOpts, donorFacingOrgName, signRecoveryToken, signReconnectToken, verifyReconnectToken, smartAmountsFor, withSmartAmounts, buildCardUpdateUrl, logRecoveryEvent, logRecurringChange, computeRecoveryRate, recordTick });
