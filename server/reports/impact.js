// server/reports/impact.js — impact, impact metrics and a person's impact summary.
//
// SPLIT-1: moved VERBATIM from routes/crm.js. Nothing in it changed.
//
// routes/crm.js mounts it: each router below sits inside crm.js's r0 or r1 at the
// place its routes held in the one file, so Express tries them in the same order.
// mount() runs once at the end of boot with server.js's ctx and what the helper
// modules hand back. A relative require() or import() reads from this folder.
// Tests read it through readSource("server.js") (scripts/lib/readSource.js).
const express = require("express");
const { CAMPAIGN_GIFT_MATCH, NOT_DELETED } = require("../../campaignMatch");   // NUMBERS-1: which gifts count toward a campaign
const NUMBERS = require("../../shared/numbers");   // NUMBERS-3 — one home for every giving number
const { newId } = require("../shared/newId");   // IDS-1: every new row id is prefix + 20 hex
// SCALE-2: org-wide figures are stored per org and served until something changes.
const OS = require("../../orgSummary");
const lapseRule = require("../../lapseRule");   // FIX-49: the one lapse rule

const routers = {
  r1: express.Router(),
};

function mount(ctx) {
const {
  MILESTONE_THRESHOLDS, UNDO_SECONDS, checkWriteAccess, orgTime, orgToday, orgTz, query, requireAdmin,
  requireAuth, resolveOrgBrandTheme, run, trashRow, uuid, wrap,
} = ctx;
let app = routers.r1;

// One-page printable/mailable "Impact Summary" for a single donor — cumulative
// giving, milestones reached, and org-configured impact translations. Reuses
// the pdfkit pattern from POST /reports/board (same require, buffer-to-Promise
// approach, page-footer loop) rather than a new rendering system.
// ATLAS-3: what the Impact summary says, read once for the PDF and for the
// summary the profile's More menu shows on screen (GET /donors/:id/impact-summary).
async function impactData(orgId, donorId) {
  const [donor] = await query("SELECT * FROM donors WHERE id = ? AND org_id = ? AND deleted_at IS NULL", [donorId, orgId]);
  if (!donor) return null;
  // BUILD-64: a donor-facing document (printable/mailable) — carries the org's
  // OWN identity from the shared resolver, never a hardcoded Steward-green band
  // and never the staff-side "(Demo)" name (white-label).
  const brand = await resolveOrgBrandTheme(orgId).catch(() => null);
  const org = { name: brand ? brand.displayName : "" };

  const totalGiving = Number(donor.total_giving) || 0;
  const giftCount = Number(donor.gift_count) || 0;
  const now = new Date();

  const thresholdsReached = MILESTONE_THRESHOLDS.filter(t => totalGiving >= t).sort((a, b) => a - b);

  let yearsGiving = null;
  let firstGiftLabel = null;
  if (donor.first_gift_date) {
    // HARDEN-1: the first gift's own civil day against the org's today, never
    // through a Date (a January 1 first gift read as December 31 west of UTC).
    const first = orgTime.parseCivil(orgTime.civilOf(donor.first_gift_date) || "");
    if (first) {
      const t = orgTime.parseCivil(orgToday(await orgTz(orgId))); // ORG_TZ_SEAM_OK
      yearsGiving = t.y - first.y - ((t.m < first.m || (t.m === first.m && t.d < first.d)) ? 1 : 0);
      firstGiftLabel = orgTime.civilLocale(donor.first_gift_date, { month: "long", year: "numeric" });
    }
  }

  const metricRows = await query(
    "SELECT * FROM impact_metrics WHERE org_id = ? AND active = true AND dollar_threshold <= ? ORDER BY dollar_threshold ASC",
    [orgId, totalGiving]
  );
  // WALKB-1: "1 student", not "1 students" (shared/countWords.js impactSentence).
  const { impactSentence } = await import("../../shared/countWords.js");
  const impactLines = metricRows.map(m => {
    const n = Math.max(1, Math.floor(totalGiving / Number(m.dollar_threshold)));
    return impactSentence(m.outcome_template, { n, amount: totalGiving });
  });

  const recentGifts = await query(
    "SELECT amount, date, campaign FROM gifts WHERE donor_id = ? AND org_id = ? ORDER BY date DESC NULLS LAST LIMIT 5",
    [donor.id, orgId]
  );
  const milestoneLabels = [
    ...thresholdsReached.map(t => `Crossed $${t.toLocaleString()} in lifetime giving`),
    ...(yearsGiving != null && yearsGiving >= 1 ? [`${yearsGiving} year${yearsGiving === 1 ? "" : "s"} of continuous giving`] : []),
  ];
  return { donor, brand, org, totalGiving, giftCount, now, thresholdsReached, yearsGiving, firstGiftLabel, impactLines, recentGifts, milestoneLabels };
}

app.get("/donors/:id/impact-summary", requireAuth, wrap(async (req, res) => {
  const D = await impactData(req.user.orgId, req.params.id);
  if (!D) return res.status(404).json({ error: "Donor not found" });
  const day = d => (d ? orgTime.civilLocale(d, { month: "short", day: "numeric", year: "numeric" }) : "Not set");
  res.json({
    donorId: D.donor.id, name: D.donor.name, orgName: D.org.name,
    totalCents: require("../../money").toCents(D.donor.total_giving) || 0, giftCount: D.giftCount,
    donorSince: D.firstGiftLabel, yearsGiving: D.yearsGiving != null ? Math.max(D.yearsGiving, 0) : null,
    milestones: D.milestoneLabels, impactLines: D.impactLines,
    recentGifts: D.recentGifts.map(g => ({ date: day(g.date), campaign: g.campaign || "General", cents: require("../../money").toCents(g.amount) || 0 })),
    sentence: "Every figure is read from their gifts on record; the impact lines are the ones your organization set in Settings.",
  });
}));

app.get("/donors/:id/impact-summary/pdf", requireAuth, wrap(async (req, res) => {
  let PDFDocument;
  try {
    PDFDocument = require("pdfkit");
  } catch (e) {
    return res.status(500).json({ error: "pdfkit module missing: " + e.message });
  }

  const { orgId } = req.user;
  const D = await impactData(orgId, req.params.id);
  if (!D) return res.status(404).json({ error: "Donor not found" });
  const { donor, brand, org, totalGiving, giftCount, now, thresholdsReached, yearsGiving, firstGiftLabel, impactLines, recentGifts } = D;

  const doc = new PDFDocument({ margin: 50, size: "LETTER", bufferPages: true });
  const pdfBuffer = await new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", c => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // BUILD-64: header band + accent = the org's OWN theme (shared resolver);
    // GREEN stays only as the money-figure color (money = green semantics, same
    // as the receipt PDF), never the band.
    const BAND   = brand ? brand.band : "#1a6b4a";
    const BANDFG = brand ? brand.bandFg : "#ffffff";
    const BANDSUB = BANDFG === "#ffffff" ? "#ffffffcc" : "#0f1a12aa";
    const GREEN = "#1a6b4a";
    const INK   = "#1a1a1a";
    const INK3  = "#6b7280";
    const BG    = "#f5f5f0";
    const PW    = doc.page.width;
    const fmtD  = n => "$" + (parseFloat(n) || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
    const genDate = now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

    doc.rect(0, 0, PW, 96).fill(BAND);
    doc.font("Helvetica").fontSize(9).fillColor(BANDSUB).text("I M P A C T   S U M M A R Y", 50, 22);
    doc.font("Helvetica-Bold").fontSize(24).fillColor(BANDFG).text(donor.name || "Valued Donor", 50, 38);
    doc.font("Helvetica").fontSize(10).fillColor(BANDSUB).text(org.name, 50, 70);

    let y = 128;
    doc.font("Helvetica-Bold").fontSize(12).fillColor(INK).text("Giving Summary", 50, y); y += 20;
    const boxes = [
      ["Total Given", fmtD(totalGiving)],
      ["Gifts Given", String(giftCount)],
      ["Donor Since", firstGiftLabel || "Not set"],
      ["Years Giving", yearsGiving != null ? String(Math.max(yearsGiving, 0)) : "Not set"],
    ];
    const bw = (PW - 100) / boxes.length;
    boxes.forEach(([label, value], i) => {
      const x = 50 + i * bw;
      doc.rect(x, y, bw - 8, 56).fill(BG);
      doc.font("Helvetica").fontSize(7).fillColor(INK3).text(label.toUpperCase(), x + 10, y + 10, { width: bw - 26 });
      doc.font("Helvetica-Bold").fontSize(15).fillColor(GREEN).text(value, x + 10, y + 26, { width: bw - 26 });
    });
    y += 76;

    doc.font("Helvetica-Bold").fontSize(12).fillColor(INK).text("Milestones Reached", 50, y); y += 18;
    const milestoneLabels = [
      ...thresholdsReached.map(t => `Crossed $${t.toLocaleString()} in lifetime giving`),
      ...(yearsGiving != null && yearsGiving >= 1 ? [`${yearsGiving} year${yearsGiving === 1 ? "" : "s"} of continuous giving`] : []),
    ];
    if (milestoneLabels.length === 0) {
      doc.font("Helvetica").fontSize(10).fillColor(INK3).text("No milestones reached yet.", 50, y); y = doc.y + 10;
    } else {
      milestoneLabels.forEach(label => {
        doc.font("Helvetica").fontSize(10).fillColor(INK).text("•  " + label, 50, y, { width: PW - 100 });
        y = doc.y + 4;
      });
      y += 8;
    }

    doc.font("Helvetica-Bold").fontSize(12).fillColor(INK).text("Your Impact", 50, y); y += 18;
    if (impactLines.length === 0) {
      doc.font("Helvetica").fontSize(10).fillColor(INK3).text("Impact translations will appear here once configured for this organization.", 50, y, { width: PW - 100 }); y = doc.y + 10;
    } else {
      impactLines.forEach(line => {
        doc.font("Helvetica").fontSize(10).fillColor(INK).text("•  " + line, 50, y, { width: PW - 100, lineGap: 2 });
        y = doc.y + 6;
      });
      y += 8;
    }

    if (recentGifts.length > 0) {
      doc.moveTo(50, y).lineTo(PW - 50, y).strokeColor("#e5e7eb").lineWidth(0.5).stroke(); y += 16;
      doc.font("Helvetica-Bold").fontSize(12).fillColor(INK).text("Recent Gifts", 50, y); y += 18;
      recentGifts.forEach((g, i) => {
        const d = g.date ? orgTime.civilLocale(g.date, { month: "short", day: "numeric", year: "numeric" }) : "Not set";
        doc.rect(50, y, PW - 100, 19).fill(i % 2 === 0 ? "#ffffff" : BG);
        doc.font("Helvetica").fontSize(8).fillColor(INK).text(d, 58, y + 5, { width: 90 });
        doc.fillColor(INK3).text(g.campaign || "General", 155, y + 5, { width: 250 });
        doc.font("Helvetica-Bold").fillColor(GREEN).text(fmtD(g.amount), PW - 150, y + 5, { width: 100, align: "right" });
        y += 19;
      });
    }

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.font("Helvetica").fontSize(7).fillColor("#9ca3af")
        .text(`${org.name}  ·  Impact Summary  ·  Generated ${genDate}`, 50, doc.page.height - 28, { width: PW - 130, height: 20, align: "left" })
        .text(`${i - range.start + 1} / ${range.count}`, PW - 80, doc.page.height - 28, { width: 30, height: 20, align: "right" });
    }

    doc.end();
  });

  const safeDonor = (donor.name || "donor").replace(/[^a-z0-9]/gi, "-").replace(/-+/g, "-").toLowerCase();
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${safeDonor}-impact-summary.pdf"`);
  res.setHeader("Content-Length", pdfBuffer.length);
  res.end(pdfBuffer);
}));

// ── Impact metrics (org-configured milestone/anniversary email content) ────
app.get("/impact-metrics", requireAuth, wrap(async (req, res) => {
  const rows = await query("SELECT * FROM impact_metrics WHERE org_id=? ORDER BY dollar_threshold ASC", [req.user.orgId]);
  res.json(rows);
}));

app.post("/impact-metrics", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const { name, dollarThreshold, outcomeTemplate } = req.body;
  if (!name || !dollarThreshold || !outcomeTemplate) return res.status(400).json({ error: "name, dollarThreshold, and outcomeTemplate required" });
  const id = newId("im");
  await run(
    "INSERT INTO impact_metrics (id,org_id,name,dollar_threshold,outcome_template) VALUES (?,?,?,?,?)",
    [id, req.user.orgId, name, parseFloat(dollarThreshold), outcomeTemplate]
  );
  const rows = await query("SELECT * FROM impact_metrics WHERE id=?", [id]);
  res.status(201).json(rows[0]);
}));

app.put("/impact-metrics/:id", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const { name, dollarThreshold, outcomeTemplate, active } = req.body;
  const affected = await run(
    "UPDATE impact_metrics SET name=?, dollar_threshold=?, outcome_template=?, active=? WHERE id=? AND org_id=?",
    [name, parseFloat(dollarThreshold), outcomeTemplate, active !== false, req.params.id, req.user.orgId]
  );
  if (!affected.changes) return res.status(404).json({ error: "Not found" });
  const rows = await query("SELECT * FROM impact_metrics WHERE id=?", [req.params.id]);
  res.json(rows[0]);
}));

app.delete("/impact-metrics/:id", requireAuth, requireAdmin, wrap(async (req, res) => {
  const undoId = await trashRow("impact_metrics", req.params.id, req);
  if (!undoId) return res.status(404).json({ error: "Not found" }); // BUILD-75 B: a foreign/unknown id answers 404, never a false success — one answer everywhere
  res.json({ success: true, deleted: 1, undoId, undoSeconds: UNDO_SECONDS });
}));

// GET /impact — the honest "what Steward has done for you" number, for
// retention (the subscription visibly pays for itself) and the sales demo.
// NON-NEGOTIABLE: only ATTRIBUTABLE amounts. We never present total giving as
// "Steward raised" — that would betray the whole honest-design brand. Two real
// figures + one clearly-labeled estimate:
//
//   (1) recoveredAmount — the hero, a HARD number: dollars the failed-card
//       recovery workflow actually won back, computed ONLY from the
//       payment_recovery_events the workflow itself recorded (type=
//       'payment_recovered', summing the tracked per-event amount). These are
//       recurring gifts that were in a failed/dunning state and then charged
//       successfully — money that, at most orgs, would have silently lapsed.
//       100% attributable, never estimated. Reconciles with the recovery log.
//   (2) platformFeesPaid — FACTUAL, 0 by construction: Steward processes
//       donations on the org's OWN Stripe account at a 0% platform fee, so the
//       org kept 100% of every gift. Not an assumption.
//   (3) estimatedFeesElsewhere — OPTIONAL, secondary, ALWAYS carries its
//       assumption inline (feeAssumptionPct): what a typical platform charging
//       ~3% would have skimmed off that same online giving. An estimate about
//       the counterfactual, clearly labeled — never a claim about Steward.
//
// Org-scoped. New org with nothing recovered yet → recoveredAmount 0 +
// watchingRecurringCount, so the client can show a forward-looking line
// ("watching N recurring donors for failed cards") instead of a fake number.
app.get("/impact", requireAuth, OS.cached("impact", { perUser: false }), wrap(async (req, res) => {
  const orgId = req.user.orgId;

  // (1) Recovered recurring giving — tracked recoveries ONLY, never total gifts.
  // Sum the per-event amount recorded by the recovery workflow. Each
  // payment_recovered event is one real gift won back from a failed state; a
  // subscription can appear across multiple failure/recovery cycles over time,
  // and every one of those is genuinely-recovered money, so we sum all of them
  // (not COUNT DISTINCT subscription like the recovery-RATE math).
  const pRec = query(
    `SELECT COUNT(*)::int AS c,
            COALESCE(SUM((detail->>'amount')::numeric), 0) AS amt
       FROM payment_recovery_events
      WHERE org_id=? AND type='payment_recovered' AND (detail->>'amount') IS NOT NULL`,
    [orgId]
  );


  // (1b) BUILD-32 Part 2 — RE-ENGAGED giving: gifts from donors who were LAPSED
  // and gave again. This is a SEPARATE, precisely-labelled number — it is NOT
  // "recovered" (that word is reserved for the failed-card recovery workflow
  // above; overclaiming it would betray the honest-design brand). "Re-engaged"
  // is a gift that followed a >365-day gap since the donor's prior gift — the
  // SAME lapse definition (LAPSE_DAYS) as inferStage / the auto-lapse sweep /
  // the win-back goal, so it's a real, measurable event, not an estimate. We
  // count EVERY such re-engagement gift (not only a donor's current last gift),
  // so a donor who lapsed, came back, then lapsed and came back again is counted
  // for each genuine return. reengagedDonorCount = distinct donors who came back.
  //
  // SCALE-1: (1b) and (1c) are ONE statement. "The latest earlier gift" was a
  // correlated MAX subquery run twice per gift (150,000 gifts = 600,000 index
  // probes, about 1.5 s each, twice). Now the org's gifts are grouped to one
  // row per donor per day and LAG over those days is exactly "the latest
  // strictly earlier date", so the >365-day test, the totals and the top 50
  // come from one pass. Proven row-for-row identical on a 150,000-gift org.
  // The totals keep gifts whose donor row is gone (the old (1b) had no join);
  // the list joins donors, as (1c) did. NUMBERS-5: a credit row is neither a
  // return nor an earlier gift (money.js).
  const pReengBoth = query(
    `WITH day AS (
       SELECT donor_id, date, ${NUMBERS.money.MONEY_SUM("g")} AS amt, COUNT(*) AS n,
              LAG(date) OVER (PARTITION BY donor_id ORDER BY date) AS prev
         FROM gifts g WHERE g.org_id = ? AND g.date IS NOT NULL AND ${NOT_DELETED("g")} AND ${NUMBERS.money.MONEY("g")}
        GROUP BY donor_id, date),
     per AS (
       SELECT donor_id, COALESCE(SUM(amt),0) AS amount, SUM(n)::int AS gift_count, MAX(date) AS last_return_date
         FROM day WHERE prev IS NOT NULL AND date::date - prev::date >= ${lapseRule.LAPSED_DAYS}
        GROUP BY donor_id)
     SELECT t.amt, t.donors, l.id, l.name, l.amount, l.gift_count, l.last_return_date
       FROM (SELECT COALESCE(SUM(amount),0) AS amt, COUNT(*)::int AS donors FROM per) t
       LEFT JOIN LATERAL (
         SELECT per.donor_id AS id, d.name, per.amount, per.gift_count, per.last_return_date
           FROM per JOIN donors d ON d.id = per.donor_id
          ORDER BY per.amount DESC
          LIMIT 50) l ON true
      ORDER BY l.amount DESC`,
    [orgId]
  );
  const pReeng = pReengBoth.then(rows => [{ amt: rows[0]?.amt ?? 0, donors: rows[0]?.donors ?? 0 }]);
  const pReengDonors = pReengBoth.then(rows => rows.filter(r => r.id != null));

  // (2) Fees kept — factual. Base = online giving processed through Steward
  // (own-Stripe donations, stripe_payment_id set), which the org kept 100% of.
  const pGiving = query(
    `SELECT COALESCE(SUM(amount), 0) AS total
       FROM gifts g WHERE g.org_id=? AND g.stripe_payment_id IS NOT NULL AND ${NOT_DELETED("g")}`,
    [orgId]
  );

  // Forward-looking honest empty state: how many recurring donors Steward is
  // actively watching for failed cards (so a new org sees a real promise, not
  // a fabricated $0-dressed-as-something number).
  const pWatch = query(
    `SELECT COUNT(*)::int AS c FROM recurring_subscriptions
      WHERE org_id=? AND status IN ('active', 'recovering', 'past_due')`,
    [orgId]
  );
  // (1d) BUILD-73 Part 3 — MONEY AT RISK. This is the figure the product leads
  // with now, and the reason is a positioning defect, not a data one.
  //
  // The hero used to read "Steward has recovered $X … and re-engaged $Y from N
  // lapsed donors." Nobody parses that as a description of the ORG's history —
  // it reads as money STEWARD brought in, on the first screen a prospect sees,
  // which is invented social proof. The standing rule is that the value math
  // describes the SIZE OF THE PROBLEM and never Steward's results.
  //
  // So the lead figure is the lifetime giving of donors who have gone QUIET,
  // which is money genuinely at risk today, is a fact about the organization's
  // own file, and claims nothing about what Steward did. FIX-51: "quiet" is
  // the one lapse rule, lapsing or lapsed (lapseRule.js), the same rule the
  // going-quiet suggestion and the Communications segment read.
  // The quiet cutoff is a CIVIL DATE in the ORGANIZATION'S timezone, resolved
  // through the seam (BUILD-72 Part 4). `gifts.date` is a civil date — a gift
  // given on March 15 was given on March 15 in every timezone on earth — so
  // comparing it to CURRENT_DATE would ask Postgres's UTC clock a question only
  // the org's calendar can answer, and the at-risk figure would flip for
  // everyone west of UTC for part of each day. One cutoff, computed once.
  // FIX-51: lapsing or lapsed by the one rule (lapseRule.js): a last gift on
  // or before the day nine months ago.
  const _quietBounds = lapseRule.bounds(orgToday(await orgTz(orgId)));
  const _quietCutoff = _quietBounds.lapsingOnOrBefore;
  // SCALE-1: the at-risk TOTAL query is gone: nothing read it (BUILD-83 3.3 below).
  const pAtRisk = Promise.resolve([]);
  // The donors BEHIND the at-risk number — every aggregate drills into its
  // source, and the destination shows the same count and amount the chip claimed.
  // NUMBERS-4: their last gift is the one rule (shared/numbers/lastGift.js:
  // the old system's last gift counts, a refund or credit row never does),
  // and lapsed or lapsing is the one fragment (shared/numbers/lapse.js).
  const _quietLapsed = NUMBERS.lapse.lapsedSql("x.last_gift_date", _quietBounds.today, "x.id");
  const _quietLapsing = NUMBERS.lapse.lapsingSql("x.last_gift_date", _quietBounds.today, "x.id");
  const pAtRiskDonors = query(
    `SELECT x.id, x.name, x.amount, x.last_gift_date FROM (
       SELECT d.id, d.org_id, d.name, COALESCE(d.total_giving, 0) AS amount, LEFT(${NUMBERS.lastGift.LAST_DATE("d")}, 10) AS last_gift_date
         FROM donors d WHERE d.org_id = ? AND d.deleted_at IS NULL AND d.total_giving > 0 AND d.deceased IS NOT TRUE) x
      WHERE x.last_gift_date IS NOT NULL AND (${_quietLapsed.sql} OR ${_quietLapsing.sql})
      ORDER BY x.amount DESC
      LIMIT 50`,
    [orgId, ..._quietLapsed.args, ..._quietLapsing.args]
  );
  const pOrg = query("SELECT plan FROM orgs WHERE id=?", [orgId]);

  // BUILD-54 §1 — the six reads above are independent; one parallel batch.
  const [recRows, reengRows, reengagedDonors, givingRows, watchRows, atRiskRows, atRiskDonors, orgRows] =
    await Promise.all([pRec, pReeng, pReengDonors, pGiving, pWatch, pAtRisk, pAtRiskDonors, pOrg]);
  const recoveredCount = recRows[0]?.c || 0;
  const recoveredAmount = parseFloat(recRows[0]?.amt) || 0;
  const reengagedAmount = parseFloat(reengRows[0]?.amt) || 0;
  const reengagedDonorCount = reengRows[0]?.donors || 0;
  const onlineGivingProcessed = parseFloat(givingRows[0]?.total) || 0;
  // (3) Optional labeled estimate — assumption shown inline, secondary.
  const FEE_ASSUMPTION_PCT = 3;
  const estimatedFeesElsewhere =
    Math.round(onlineGivingProcessed * (FEE_ASSUMPTION_PCT / 100) * 100) / 100;
  const watchingRecurringCount = watchRows[0]?.c || 0;
  const plan = orgRows[0]?.plan || "trial";
  const planMonthlyCost = PLAN_MONTHLY_COST[plan] ?? null;

  // ── BUILD-83 Part 3.3 — THE "QUIET DONORS" COHORT IS DELETED. ────────────
  // It was Σ LIFETIME giving of every donor with no gift in six months, which
  // on a real file is most of the file: "$38,748,624.17 at risk across 19,855
  // quiet donors" is 79% of a 25,000-donor import, and it is the number that
  // makes an ED close the laptop. At risk is the NEXT gift, not the lifetime,
  // and the donors at risk are the ones past their OWN pattern — which is
  // exactly what Drift already computes, donor by donor, with a sentence.
  // Home reads Drift; nothing reads this any more. `atRiskDonors` stays (it is
  // the re-engagement LIST, not a headline dollar figure) but is renamed on the
  // response to say what it is.
  void atRiskRows;

  res.json({
    quietSinceDays: orgTime.daysBetween(_quietCutoff, _quietBounds.today),
    reengageCandidates: atRiskDonors.map(r => ({
      id: r.id, name: r.name, amount: parseFloat(r.amount) || 0, lastGiftDate: r.last_gift_date,
    })),
    recoveredAmount,               // internal: the failed-card retry workflow's tracked total
    recoveredCount,
    reengagedAmount,               // SURFACED, separate — lapsed donors who came back
    reengagedDonorCount,
    reengagedDonors: reengagedDonors.map(r => ({
      id: r.id, name: r.name, amount: parseFloat(r.amount) || 0,
      giftCount: r.gift_count, lastReturnDate: r.last_return_date,
    })),
    platformFeesPaid: 0,           // factual — 0% platform fee, own Stripe
    onlineGivingProcessed,         // base for the fee estimate
    estimatedFeesElsewhere,        // ESTIMATE — see feeAssumptionPct
    feeAssumptionPct: FEE_ASSUMPTION_PCT,
    watchingRecurringCount,        // forward-looking empty state
    plan,
    planMonthlyCost,
  });
}));

// Published monthly price per plan (USD) — mirrors pages/Pricing.jsx's
// CHECKOUT_PLANS/BILLING_PLANS. Used ONLY to render the ROI comparison
// ("your plan is $249/mo") next to Steward's recovered-dollars figure; not a
// billing source of truth. trial → null (nothing charged yet).
const PLAN_MONTHLY_COST = {
  core: 249, team: 499, founding: 199, seed: 99, growth: 249, impact: 499,
};
}

module.exports = { routers, mount };
