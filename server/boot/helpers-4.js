// SPLIT-2: moved VERBATIM from server.js (its functions from lines 5219-6550). server.js requires the boot modules in
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
let ACTIVITY_DEFINITIONS, AUDIENCE_REASON_ORDER, GEOCODE_TICK_BUDGET, GR, GREET, GREET_READY, ItemRefs, PHOTO_FETCH_BUDGET, PHOTO_FETCH_CONCURRENCY, PT, RB, RB_READY, SYS_AUTO, _fiveXXWindow, _opsAlertSent, _rawResend, aiGate, asJson, brandEmailHeaderHtml, digestEsc, digestMoney, digestNudgeHtml, displayNameCase, donorMailDecision, donorMailDecisions, donorSendOpts, emailCompose, figureSources, fromWithDisplayName, geocode, imageBytesMatchMime, isBlockedAddress, mailPolicy, money, newId, orgMaySendEmail, orgPeriodBounds, orgPlanTier, orgReportYear, orgTime, orgToday, orgTz, personPhoto, publicAppUrl, putThemeAsset, query, rbCents, resend, resolveOrgBrandTheme, run, runMorningBriefForOrg, safeFetch, sendDigestEmail, sendGiftAlertEmail, threadRankMod, threadShapeMod, unsubscribeEmailFooterHtml, userWantsEmail;
__boot.register(c => {
  if ("ACTIVITY_DEFINITIONS" in c) ACTIVITY_DEFINITIONS = c.ACTIVITY_DEFINITIONS;
  if ("AUDIENCE_REASON_ORDER" in c) AUDIENCE_REASON_ORDER = c.AUDIENCE_REASON_ORDER;
  if ("GEOCODE_TICK_BUDGET" in c) GEOCODE_TICK_BUDGET = c.GEOCODE_TICK_BUDGET;
  if ("GR" in c) GR = c.GR;
  if ("GREET" in c) GREET = c.GREET;
  if ("GREET_READY" in c) GREET_READY = c.GREET_READY;
  if ("ItemRefs" in c) ItemRefs = c.ItemRefs;
  if ("PHOTO_FETCH_BUDGET" in c) PHOTO_FETCH_BUDGET = c.PHOTO_FETCH_BUDGET;
  if ("PHOTO_FETCH_CONCURRENCY" in c) PHOTO_FETCH_CONCURRENCY = c.PHOTO_FETCH_CONCURRENCY;
  if ("PT" in c) PT = c.PT;
  if ("RB" in c) RB = c.RB;
  if ("RB_READY" in c) RB_READY = c.RB_READY;
  if ("SYS_AUTO" in c) SYS_AUTO = c.SYS_AUTO;
  if ("_fiveXXWindow" in c) _fiveXXWindow = c._fiveXXWindow;
  if ("_opsAlertSent" in c) _opsAlertSent = c._opsAlertSent;
  if ("_rawResend" in c) _rawResend = c._rawResend;
  if ("aiGate" in c) aiGate = c.aiGate;
  if ("asJson" in c) asJson = c.asJson;
  if ("brandEmailHeaderHtml" in c) brandEmailHeaderHtml = c.brandEmailHeaderHtml;
  if ("digestEsc" in c) digestEsc = c.digestEsc;
  if ("digestMoney" in c) digestMoney = c.digestMoney;
  if ("digestNudgeHtml" in c) digestNudgeHtml = c.digestNudgeHtml;
  if ("displayNameCase" in c) displayNameCase = c.displayNameCase;
  if ("donorMailDecision" in c) donorMailDecision = c.donorMailDecision;
  if ("donorMailDecisions" in c) donorMailDecisions = c.donorMailDecisions;
  if ("donorSendOpts" in c) donorSendOpts = c.donorSendOpts;
  if ("emailCompose" in c) emailCompose = c.emailCompose;
  if ("figureSources" in c) figureSources = c.figureSources;
  if ("fromWithDisplayName" in c) fromWithDisplayName = c.fromWithDisplayName;
  if ("geocode" in c) geocode = c.geocode;
  if ("imageBytesMatchMime" in c) imageBytesMatchMime = c.imageBytesMatchMime;
  if ("isBlockedAddress" in c) isBlockedAddress = c.isBlockedAddress;
  if ("mailPolicy" in c) mailPolicy = c.mailPolicy;
  if ("money" in c) money = c.money;
  if ("newId" in c) newId = c.newId;
  if ("orgMaySendEmail" in c) orgMaySendEmail = c.orgMaySendEmail;
  if ("orgPeriodBounds" in c) orgPeriodBounds = c.orgPeriodBounds;
  if ("orgPlanTier" in c) orgPlanTier = c.orgPlanTier;
  if ("orgReportYear" in c) orgReportYear = c.orgReportYear;
  if ("orgTime" in c) orgTime = c.orgTime;
  if ("orgToday" in c) orgToday = c.orgToday;
  if ("orgTz" in c) orgTz = c.orgTz;
  if ("personPhoto" in c) personPhoto = c.personPhoto;
  if ("publicAppUrl" in c) publicAppUrl = c.publicAppUrl;
  if ("putThemeAsset" in c) putThemeAsset = c.putThemeAsset;
  if ("query" in c) query = c.query;
  if ("rbCents" in c) rbCents = c.rbCents;
  if ("resend" in c) resend = c.resend;
  if ("resolveOrgBrandTheme" in c) resolveOrgBrandTheme = c.resolveOrgBrandTheme;
  if ("run" in c) run = c.run;
  if ("runMorningBriefForOrg" in c) runMorningBriefForOrg = c.runMorningBriefForOrg;
  if ("safeFetch" in c) safeFetch = c.safeFetch;
  if ("sendDigestEmail" in c) sendDigestEmail = c.sendDigestEmail;
  if ("sendGiftAlertEmail" in c) sendGiftAlertEmail = c.sendGiftAlertEmail;
  if ("threadRankMod" in c) threadRankMod = c.threadRankMod;
  if ("threadShapeMod" in c) threadShapeMod = c.threadShapeMod;
  if ("unsubscribeEmailFooterHtml" in c) unsubscribeEmailFooterHtml = c.unsubscribeEmailFooterHtml;
  if ("userWantsEmail" in c) userWantsEmail = c.userWantsEmail;
});

// SPLIT-2 server.js piece 425
async function opsAlert(kind, subject, body) {
  const to = process.env.FOUNDER_EMAIL;
  if (!to) return { skipped: "no_founder_email" };
  // This one send uses the raw client, so the permanent block is checked here too.
  if (isBlockedAddress(to)) { console.warn("[mail-block] REFUSED an ops alert to a blocked address"); return { skipped: "blocked_address" }; }
  const hourKey = kind + ":" + new Date().toISOString().slice(0, 13);
  if (_opsAlertSent.has(hourKey)) return { skipped: "already_alerted_this_hour" };
  _opsAlertSent.set(hourKey, true);
  if (_opsAlertSent.size > 200) _opsAlertSent.clear();
  // SCALE-1: the hour's mark is a row too, so a worker and two web replicas
  // that all see the same failure send one alert between them.
  const marked = await query(`INSERT INTO ops_alert_marks (hour_key) VALUES (?) ON CONFLICT DO NOTHING RETURNING hour_key`, [hourKey])
    .catch(() => [{ hour_key: hourKey }]);
  if (!marked.length) return { skipped: "already_alerted_this_hour" };
  console.error(`[ops-alert] ${kind}: ${subject}`);
  try {
    await _rawResend.emails.send({
      from: process.env.DEMO_SMTP_FROM || "noreply@stewardapp.dev",
      to, subject: `[Steward] ${subject}`,
      html: `<p>${String(body).replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c])).replace(/\n/g, "<br>")}</p>`,
    });
    return { sent: true };
  } catch (e) { return { failed: String(e && e.message || e) }; }
}
// SPLIT-2 end
// SPLIT-2 server.js piece 427
function noteServerError() {
  const now = Date.now();
  _fiveXXWindow = _fiveXXWindow.filter(t => now - t < 10 * 60000); __share({ _fiveXXWindow });
  _fiveXXWindow.push(now);
  if (_fiveXXWindow.length >= 25) {
    opsAlert("5xx_burst", "Steward is returning server errors",
      `${_fiveXXWindow.length} 5xx responses in the last ten minutes.`).catch(() => {});
    _fiveXXWindow = []; __share({ _fiveXXWindow });
  }
}
// SPLIT-2 end
// SPLIT-2 server.js piece 428
async function thresholdsMod() { return import("../../shared/thresholds.js"); }
// SPLIT-2 end
// SPLIT-2 server.js piece 429

// ── BUILD-96 Part 3 — THE ONE GATE IN FRONT OF ANTHROPIC ───────────────────
// Two features send an organisation's own data to a third party: cheque
// reading sends a photograph of a cheque, and the agent sends rows and
// vocabulary. They are named together in steward-data-handling.md and in the
// customer agreement's subprocessor table because they are one disclosure, so
// they are gated together here for the same reason — two gates would
// eventually disagree, and the way they would disagree is by one of them
// sending something after an organisation said not to.
//
// Two conditions, and the reason says WHICH:
//   ai_no_key   — no ANTHROPIC_API_KEY. Nothing is configured; this is
//                 Steward's state, not the org's, and the control is ABSENT
//                 rather than broken (MANUAL-STEPS §12).
//   ai_disabled — the org turned it off in Settings. Its choice, per org.
// aiGate now lives in aiClient.js (FIX-12 Part 3), beside the only code that
// may call a model, so the gate and the call cannot drift apart.

// One place decides whether the agent may act for this org, and it answers with
// a REASON rather than a boolean, because a quiet screen has to say why.
async function agentGate(orgId) {
  const ai = await aiGate(orgId);
  if (!ai.ok) return { ok: false, reason: ai.reason === "ai_no_key" ? "agent_unavailable" : ai.reason };
  const [org] = await query("SELECT agent_paused_at FROM orgs WHERE id=?", [orgId]);
  if (!org) return { ok: false, reason: "org_not_found" };
  if (org.agent_paused_at) return { ok: false, reason: "agent_paused" };
  return { ok: true, reason: null };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 430

// BUILD-97 — a SAVED audience is a name over one of these same segments, so
// it is resolved to its stored segment here and then filtered by the one
// implementation below. Deliberately NOT recursive: an audience cannot be
// built on another audience, so there is no cycle to guard and no chain of
// indirection between "the screen said Sponsors" and who actually got mail.
// FIX-49 decision 7: a "Major" audience is the Major giving level, the one
// rule (donorStatus.js: the org's cut points over the last 12 months), not
// $10,000 lifetime. The ids are worked out here so filterBySegment stays pure.
async function resolveSegmentSpec(segment, orgId) {
  const r = await resolveSegmentSpecInner(segment, orgId);
  if (r && r.mode === "major") {
    const DS = require("../../donorStatus");
    const c = DS.tagCondition("major", orgId, await DS.todayFor(orgId), await DS.cutsFor(orgId));
    const ids = (await query(`SELECT id FROM donors WHERE org_id = ? AND deleted_at IS NULL AND ${c.sql}`, [orgId, ...c.args])).map(x => x.id);
    return { ...r, majorIds: ids };
  }
  // SWEEP-3: "Lapsed" is the one lapse rule (FIX-51, donorStatus.quietIds),
  // the same people Audience counts as Lapsing or lapsed. It read the stage
  // column, which nothing sets, so a campaign to it reached nobody.
  if (r && r.mode === "lapsed") {
    const DS = require("../../donorStatus");
    return { ...r, lapsedIds: [...await DS.quietIds(orgId, await DS.todayFor(orgId))] };
  }
  return r;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 431
async function resolveSegmentSpecInner(segment, orgId) {
  if (segment && segment.mode === "audience") {
    const [row] = await query("SELECT segment, kind FROM audiences WHERE id=? AND org_id=?",
      [segment.audienceId, orgId]).catch(() => [null]);
    if (!row) return { mode: "manual", donorIds: [] };   // a deleted audience is NOBODY, never everybody
    // PARITY-1 Part D — a Group resolves to its members at this moment: the
    // live rule, or the hand-kept list. Then the one filter below as always.
    if (row.kind) {
      const g = await GR.groupById(orgId, segment.audienceId);
      return { mode: "manual", donorIds: g ? await GR.memberIds(orgId, g) : [] };
    }
    const inner = typeof row.segment === "string" ? JSON.parse(row.segment || "{}") : (row.segment || {});
    return inner && inner.mode === "audience" ? { mode: "manual", donorIds: [] } : inner;
  }
  return segment;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 432

// PURE. Extracted from resolveCampaignRecipients so the hub can count every
// audience from ONE donor query instead of one query per audience — on a
// 25,000-donor org that was the difference between a screen and a stall. The
// filtering rules are unchanged and there is still only one copy of them.
function filterBySegment(allDonors, segment) {
  let donors = allDonors;
  const mode = segment.mode || "legacy";
  if (mode === "major") {
    // FIX-49: the Major giving level, resolved by resolveSegmentSpec. A segment
    // that skipped it names nobody, never everybody.
    const ids = new Set(segment.majorIds || []);
    donors = donors.filter(d => ids.has(d.id));
  } else if (mode === "lapsed") {
    const ids = segment.lapsedIds ? new Set(segment.lapsedIds) : null;
    donors = donors.filter(d => ids ? ids.has(d.id) : d.stage === "lapsed");
  // AN EMPTY SELECTION SELECTS NOBODY. Each of these three used to fall
  // THROUGH to the unfiltered list when its list was empty, so a campaign that
  // named no stages, no tiers or no people went to EVERY donor with an email
  // address. That is the exact thing C.2's rule forbids: nothing goes to a
  // donor she did not press send on. An empty explicit segment is zero people.
  } else if (mode === "byStage") {
    donors = (segment.stages || []).length ? donors.filter(d => segment.stages.includes(d.stage)) : [];
  } else if (mode === "byTier") {
    donors = (segment.tiers || []).length ? donors.filter(d => segment.tiers.includes(d.capacity_tier)) : [];
  } else if (mode === "manual") {
    donors = (segment.donorIds || []).length ? donors.filter(d => segment.donorIds.includes(d.id)) : [];
  } else if (mode === "group") {
    // A Group's stored placeholder: it is resolved by resolveSegmentSpec, and
    // reaching here unresolved selects NOBODY, never everybody.
    donors = [];
  // ── BUILD-94 Part 2 — the four segments that let Mailchimp go ────────────
  // Allie's volunteers, staff and board are on this table now, so the
  // audience picker has to be able to name them. "Everyone with an email" is
  // the one segment in the product that deliberately crosses every type —
  // it is the Mailchimp audience, and it is why she is paying them.
  } else if (mode === "everyone") {
    /* already every person with an email — no type filter at all */
  } else if (mode === "volunteers") {
    donors = donors.filter(d => PT.hasType(d, "volunteer"));
  } else if (mode === "staff_board") {
    donors = donors.filter(d => PT.hasType(d, "staff_board"));
  } else if (mode === "donors") {
    donors = donors.filter(d => PT.isDonor(d));
  } else {
    // "all" or legacy format.
    // BUILD-94 Part 2 — and "all" MEANS ALL DONORS, which is what the picker
    // has always called it. Before this build every person was a donor so the
    // two were the same set; now they are not, and leaving it unfiltered would
    // quietly send an appeal to the volunteer coordinator's whole roster.
    donors = donors.filter(d => PT.isDonor(d));
    if (segment.stages && segment.stages.length) donors = donors.filter(d => segment.stages.includes(d.stage));
    if (segment.statuses && segment.statuses.length) donors = donors.filter(d => segment.statuses.includes(d.status));
  }
  return donors;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 433

async function resolveCampaignRecipients(campaign, orgId) {
  const raw = typeof campaign.segment === "string"
    ? JSON.parse(campaign.segment || "{}")
    : (campaign.segment || {});
  const segment = await resolveSegmentSpec(raw, orgId);
  const donors = await query(
    "SELECT * FROM donors WHERE org_id = ? AND email IS NOT NULL AND email != '' AND deleted_at IS NULL",
    [orgId]
  );
  return filterBySegment(donors, segment);
}
// SPLIT-2 end
// SPLIT-2 server.js piece 435
async function campaignAudience(campaign, orgId) {
  const raw = typeof campaign.segment === "string"
    ? JSON.parse(campaign.segment || "{}")
    : (campaign.segment || {});
  const segment = await resolveSegmentSpec(raw, orgId);
  const everyone = await query("SELECT * FROM donors WHERE org_id = ? AND deleted_at IS NULL", [orgId]);
  const inSegment = filterBySegment(everyone, segment);
  const decisions = await donorMailDecisions("campaign", inSegment.filter(d => d.email && String(d.email).trim()), orgId, { personOnly: true });
  const recipients = [];
  const byReason = new Map();
  for (const d of inSegment) {
    const dec = (d.email && String(d.email).trim()) ? decisions.get(d.id) : { send: false, reason: "no_email" };
    if (dec && dec.send) { recipients.push(d); continue; }
    const reason = (dec && dec.reason) || "no_email";
    if (!byReason.has(reason)) byReason.set(reason, []);
    byReason.get(reason).push(d);
  }
  const rank = r => { const i = AUDIENCE_REASON_ORDER.indexOf(r); return i < 0 ? 99 : i; };
  const leftOut = [...byReason.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([reason, people]) => ({ reason, count: people.length, people }));
  return {
    recipients,
    leftOut,
    leftOutCount: leftOut.reduce((n, g) => n + g.count, 0),
    orgGate: await orgMaySendEmail(orgId),
  };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 438

// FIX-40 · A LEGACY (non-block) CAMPAIGN'S MERGE FIELDS, FILLED FOR ONE
// PERSON. The send and the "as sent" page (routes/emailsSent.js) both call
// this, so the page shows exactly the words the send would write today.
// SECURE-1: the donor's own words (a name typed on a public form) go into the
// HTML body as text; a subject is text already and passes { text: true }.
async function legacyCampaignBody(body, donor, orgName, year, { text = false } = {}) {
  const e = text ? (x => x) : escapeHtml;
  const firstName   = e((await GREET_READY).firstNames(donor));
  const lastName    = e(donor.name.split(" ").slice(1).join(" "));
  const totalGiving = donor.total_giving ? `$${Number(donor.total_giving).toLocaleString()}` : "$0";
  const giftRows    = await query("SELECT amount FROM gifts WHERE donor_id=? ORDER BY date DESC NULLS LAST LIMIT 1", [donor.id]);
  const giftAmount  = giftRows[0] ? `$${Number(giftRows[0].amount).toLocaleString()}` : "";   // TRUST-1: no gift, no gift sentence (shared/giftSentence.js)
  return (await GREET_READY).greetMerge((await import("../../shared/giftSentence.js")).withoutMissingGift(body || "", { hasGift: !!giftRows[0], hasTotal: Number(donor.total_giving) > 0 }), e(GREET.greetingName(donor)))
    .replace(/{{first_name}}/g,   firstName)
    .replace(/{{last_name}}/g,    lastName)
    .replace(/{{donor_name}}/g,   e(donor.name))
    .replace(/{{org_name}}/g,     e(displayNameCase(orgName)))
    .replace(/{{gift_amount}}/g,  giftAmount)
    .replace(/{{total_giving}}/g, totalGiving)
    .replace(/{{year}}/g,         year);
}
// SPLIT-2 end
// SPLIT-2 server.js piece 439

async function runCampaignSend(campaign, org, donors) {
  const BACKEND_URL = process.env.BACKEND_URL || "https://nonprofit-erp-production.up.railway.app";
  {
    console.log(`[campaign:${campaign.id}] background send starting — ${donors.length} recipients`);
    let sentCount = 0;
    let failCount = 0;

    try {
      const resendApiKey = process.env.RESEND_API_KEY;
      const smtpFrom     = process.env.DEMO_SMTP_FROM;

      if (!resendApiKey || !smtpFrom) {
        console.log(`[campaign:${campaign.id}] RESEND_API_KEY=${resendApiKey?"set":"MISSING"} DEMO_SMTP_FROM=${smtpFrom||"MISSING"} — recording sends without emailing`);
      } else {
        console.log(`[campaign:${campaign.id}] Resend HTTP API configured — from=${smtpFrom}`);
      }

      const year = orgToday(await orgTz(org.id)).slice(0, 4); // ORG_TZ_SEAM_OK (BUILD-75 A.5) — the {{year}} token is the org's civil year
      const brandHeader = await brandEmailHeaderHtml(org.id); // BUILD-13 — once per send, not per recipient
      // EMAIL-1 — A TEMPLATE CAMPAIGN is rendered from its blocks for each
      // person. The org half (brand, links) is read once, here, at send time.
      const fromBlocks = emailCompose.hasBlocks(campaign);
      const renderCtx = fromBlocks ? await emailCompose.orgRenderContext(org.id) : null;
      const campaignFrom = smtpFrom ? fromWithDisplayName((await resolveOrgBrandTheme(org.id).catch(() => null))?.displayName, smtpFrom) : smtpFrom; // BUILD-64: org name in the inbox, resolved once

      for (const donor of donors) {
        const decision = await donorMailDecision("campaign", donor.email, org.id, { donorId: donor.id });
        if (!decision.send && decision.reason !== "type_off") {   // TRUST-1: Campaign emails off, so it waits: the send gate holds it (Going out's Held)
          console.log(`[campaign:${campaign.id}] skipping ${donor.id} (${decision.reason})`);
          await run(
            "INSERT INTO campaign_recipients (id,org_id,campaign_id,donor_id,email,failure_reason) VALUES (?,?,?,?,?,?)",
            [newId("cr"), org.id, campaign.id, donor.id, donor.email, `suppressed: ${decision.reason}`]
          ).catch(() => {});
          continue;
        }

        const recipientId = newId("cr");
        await run(
          "INSERT INTO campaign_recipients (id,org_id,campaign_id,donor_id,email) VALUES (?,?,?,?,?)",
          [recipientId, org.id, campaign.id, donor.id, donor.email]
        );

        const pixel    = `<img src="${BACKEND_URL}/track/${recipientId}/open.gif" width="1" height="1" alt="" style="display:none">`;
        const footer   = await unsubscribeEmailFooterHtml(donor.email, org.id, "campaign");
        let htmlFull;
        let personSubject = campaign.subject || "";
        if (fromBlocks) {
          // The header block IS the header: no brand band on top. The footer
          // goes where the renderer left its slot, once, and a copy with a
          // problem in it is never sent (the send route refused the whole
          // campaign before this if the problem was in the blocks).
          const fields = await emailCompose.personFields(renderCtx, donor, { campaignName: campaign.name || "" });
          const r = await emailCompose.render(renderCtx, {
            blocks: campaign.email_blocks, subject: campaign.subject, preheader: campaign.preheader, fields, mode: "send" });
          htmlFull = r.problems.length ? null : emailCompose.withFooter(r, footer, pixel);
          personSubject = await emailCompose.subjectFor(campaign.subject, fields);
          if (!htmlFull) {
            failCount++;
            await run("UPDATE campaign_recipients SET failure_reason=? WHERE id=?",
              [("not rendered: " + (r.problems[0] || "no footer slot")).slice(0, 500), recipientId]).catch(() => {});
            continue;
          }
        } else {
          const bodyHtml = await legacyCampaignBody(campaign.body, donor, org.name, year);
          htmlFull = brandHeader + bodyHtml + footer + pixel;
          // FIX-40 · the subject gets the same tags as the body. It went out raw,
          // so a donor read "Thank you, {{first_name}}" in her inbox.
          personSubject = await legacyCampaignBody(campaign.subject || "", donor, org.name, year, { text: true });
        }

        try {
          // No provider means nothing left: that is a failure with its
          // reason, not a delivery (WHY-1 Part 8).
          if (!(resendApiKey && smtpFrom)) throw new Error("No mail provider is configured, so this was not sent.");
          {
            const { error: sendError } = await resend.emails.send({
              // BUILD-88c C.1 — the org's own identity, resolved per recipient
              // so the From, the Reply-To and the List-Unsubscribe mailto
              // cannot disagree about which domain is in force.
              ...(await donorSendOpts(org.id, donor.email, "campaign")),
              to: donor.email,
              subject: personSubject,
              html: htmlFull,
            });
            if (sendError) throw new Error(sendError.message);
          }
          await run("UPDATE campaign_recipients SET sent_at=NOW() WHERE id=?", [recipientId]);
          // ── BUILD-88c C.2 — AN APPEAL IS A CONVERSATION ──────────────────
          // A campaign left no trace on anybody's record, so the timeline never
          // showed it and DRIFT — which measures silence — counted a donor as
          // untouched in the same week the organisation wrote to them. One
          // interaction per recipient, written only after a REAL delivery (the
          // BUILD-85 W-4 rule: no timeline entry claims an email that never
          // left), and only once, because `campaign_recipients` is unique per
          // recipient and this sits inside that same successful branch.
          await run(
            `INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,logged_by_name,metadata)
             VALUES (?,?,?,?,?,?,?,?,?)`,
            [newId("int"), org.id, donor.id, "email",
             `Sent "${(campaign.name || "a campaign").slice(0, 120)}".`,
             orgToday(await orgTz(org.id)),                          // ORG_TZ_SEAM_OK
             campaign.created_by || SYS_AUTO.id, campaign.created_by_name || SYS_AUTO.name,
             JSON.stringify({ via: "campaign", campaignId: campaign.id, recipientId })]
          ).catch(e => console.error(`[campaign:${campaign.id}] timeline entry failed for ${donor.id}:`, e.message));
          sentCount++;
        } catch (err) {
          failCount++;
          const reason = [
            err.message,
            err.code        ? `code=${err.code}`               : "",
            err.responseCode ? `smtp=${err.responseCode}`      : "",
            err.response    ? `response="${err.response}"`     : "",
            err.command     ? `cmd=${err.command}`             : "",
          ].filter(Boolean).join(" | ").slice(0, 500);
          console.error(`[campaign:${campaign.id}] SEND FAILED ${donor.id}: ${reason}`);
          await run(
            "UPDATE campaign_recipients SET failure_reason=? WHERE id=?",
            [reason, recipientId]
          ).catch(() => {});
        }
      }
    } catch (err) {
      console.error(`[campaign:${campaign.id}] FATAL send error: msg="${err.message}" code=${err.code||"?"} smtp=${err.responseCode||"?"} response="${err.response||""}" stack=${err.stack?.split("\n").slice(0,2).join(" | ")}`);
    }

    // Always finalize, and say what happened (WHY-1 Part 8, HONEST "SENT"):
    // `recipient_count` is how many the provider ACCEPTED, and a campaign none
    // of whose recipients went is "failed", never "sent". The screen reads a
    // partial send as "Sent to N of M" from the recipient rows.
    const [tally] = await query(
      "SELECT COUNT(*)::int AS m, COUNT(sent_at)::int AS n FROM campaign_recipients WHERE campaign_id=?", [campaign.id]
    ).catch(() => [{ m: 0, n: sentCount }]);
    const finalStatus = tally && tally.m > 0 && tally.n === 0 ? "failed" : "sent";
    await run(
      "UPDATE campaigns SET status=?, sent_at=NOW(), recipient_count=?, updated_at=NOW() WHERE id=?",
      [finalStatus, sentCount, campaign.id]
    ).catch(e => console.error(`[campaign:${campaign.id}] final status update failed:`, e.message));

    console.log(`[campaign:${campaign.id}] done — sent:${sentCount} failed:${failCount}`);
  }
}
// SPLIT-2 end
// SPLIT-2 server.js piece 440

// ── Giving Pages ────────────────────────────────────────────────────────────
// Campaign-specific donation pages, e.g. /give/:orgSlug/:pageSlug — distinct
// from the org-wide /give/:orgSlug page above, and NOT the same concept as
// the `campaigns` table (email campaigns). See db.js giving_pages comment.
function slugifyGivingPage(s) {
  return (s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "page";
}
// SPLIT-2 end
// SPLIT-2 server.js piece 441

// ── BUILD-102 (Steward Give) Part 6 — THE FUNNEL, COUNTED NOT TRACKED ──────
// Views, starts and completions per form per day. NOTHING about who: no person id,
// no session id, no IP, no user agent, no cookie id — and the SHAPE is the
// guarantee rather than a promise in a policy, because `form_events` has nowhere to
// put one.
//
// Every counter is an ATOMIC UPSERT on (form, day, variant). A read-modify-write
// would lose counts the moment two people opened the form in the same second, and
// the first thing anybody would notice is a completion rate over 100%.
async function bumpFormEvent(orgId, formId, field, { variant = null, cents = 0, today = null } = {}) {
  if (!["views", "starts", "completions"].includes(field)) return;
  const org = await orgTz(orgId);
  const day = today || orgToday(org);                                  // ORG_TZ_SEAM_OK
  const v = variant === "a" || variant === "b" ? variant : null;
  await run(
    `INSERT INTO form_events (id,org_id,form_id,day,variant,${field},completed_cents)
     VALUES (?,?,?,?,?,1,?)
     ON CONFLICT (form_id, day, COALESCE(variant,''))
     DO UPDATE SET ${field} = form_events.${field} + 1,
                   completed_cents = form_events.completed_cents + ?,
                   updated_at = NOW()`,
    [newId("fe"), orgId, formId, day, v, Math.max(0, Math.trunc(cents) || 0),
     Math.max(0, Math.trunc(cents) || 0)]);
}
// SPLIT-2 end
// SPLIT-2 server.js piece 442

// ── BUILD-102 (Steward Give) Part 1 — A FORM IS A GIVING PAGE WITH A CONFIG ──
// shared/formConfig.js is the ONE validator and the ONE spec builder. The editor
// and the page a stranger opens from a QR code derive their form from the SAME
// function — not two components fed similar props — so a preview cannot show a
// field the donor will not get.
async function formConfigMod() { return import("../../shared/formConfig.js"); }
// SPLIT-2 end
// SPLIT-2 server.js piece 443

// GIVE-2 — the three pure money modules the giving layer reads, loaded the same
// way, so there is one place each rule lives:
//   processingRates  what the processor takes and what the cover-fee box adds
//   giftFooting      gross / covered / fee / net on one gift, footing to the cent
//   smartAmounts     which amounts a form offers, and the ask from a history
//   employerMatch    the employer list and the (unsigned, unnamed) lookup shape
async function ratesMod() { return import("../../shared/processingRates.js"); }
// SPLIT-2 end
// SPLIT-2 server.js piece 444
async function footingMod() { return import("../../shared/giftFooting.js"); }
// SPLIT-2 end
// SPLIT-2 server.js piece 445
async function smartAmountsMod() { return import("../../shared/smartAmounts.js"); }
// SPLIT-2 end
// SPLIT-2 server.js piece 446
async function employerMatchMod() { return import("../../shared/employerMatch.js"); }
// SPLIT-2 end
// SPLIT-2 server.js piece 447
// CAMPAIGN-2 — the campaign page's templates, plan, countdown, match and the
// ONE function that turns a gift row into a line a stranger may read.
async function campaignPageMod() { return import("../../shared/campaignPage.js"); }
// SPLIT-2 end
// SPLIT-2 server.js piece 448

// ── GIVE-2 §5 — THE RATE THE PUBLIC FORM SHOWS ────────────────────────────
// Every public giving payload carries it, so the sentence under the
// cover-the-fee box is the org's own rate rather than a constant hand-copied
// into two client files. ONE function, because four payloads show this number
// and a number shown in four places is computed once (CLAUDE.md).
//
// The CARD rate, and only the card rate: with Stripe Checkout the donor picks
// how to pay after the amount is fixed, so the dearer of the two is the only
// one it is safe to ask for. The sentence says so.
async function coverFeePayload(org) {
  const R = await ratesMod();
  const rates = R.orgRates(org || {});
  return {
    feeRate: { pct: rates.card.pct, flatCents: rates.card.flatCents, capCents: rates.card.capCents },
    feeRateSentence: R.rateSentence(rates.card),
    coverFeeDefinition: `Adds the card processing fee (${R.rateSentence(rates.card)}) so the full amount reaches the organization.`,
    // SWEEP-6: whether a receipt from this org would really reach the donor:
    // receipts on (issueGiftReceipt skips an org with them off) and the same
    // mail gate the send goes through open for a receipt. A one-time payment
    // always gets Stripe's receipt (receipt_email); a monthly one does not, so
    // the thank-you after a recurring checkout promises one only when this is true.
    receiptsEmailed: !!(org && org.receipts_enabled)
      && !!(await orgMaySendEmail(org.org_id || org.id, mailPolicy.categoryOf("receipt"), "receipt").catch(() => ({ send: false }))).send,
  };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 449

// Caller-supplied name/story/org/page title get interpolated into a raw
// HTML email body below — escape them so a submitted name like
// `<img src=x onerror=...>` can't inject markup into the manage-link email.
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
// SPLIT-2 end
// SPLIT-2 server.js piece 452

// Fiscal year N = Jul 1 (N-1) through Jun 30 N — same July-1 boundary as
// /dashboard/my-stats and /finance/summary. A gift on 2025-12-15 is FY2026
// and CY2025.
// FIX-3 E — the fiscal year starts in the ORG's month (vocabulary_json's
// fiscal_year_start_month, read by orgTime like the Board reads it), labelled
// by the year it ends in, as orgReportYear labels it. July is the default, and
// a July org's bounds are the same strings they always were.
function reportYearBounds(year, yearMode, startMonth = 7) {
  if (yearMode !== "fiscal") return { from: `${year}-01-01`, to: `${year}-12-31` };
  const m = Number.isInteger(startMonth) && startMonth >= 1 && startMonth <= 12 ? startMonth : 7;
  const mm = String(m).padStart(2, "0");
  return { from: `${year - 1}-${mm}-01`, to: orgTime.addDays(`${year}-${mm}-01`, -1) };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 453
// The year currently in progress (fiscal label year is the June-30 end year).
// ORG_TZ_SEAM_OK — which year a report calls "current" is a civil-calendar
// question, answered in the ORG's timezone. On Dec 31 at 8pm in New York the
// server's UTC clock is already next year, so an org opening Reports on New
// Year's Eve used to be shown the wrong year by default.
function reportCurrentYear(yearMode, org = null) {
  return orgReportYear(org || {}, yearMode);
}
// SPLIT-2 end
// SPLIT-2 server.js piece 456

async function rbCustomDefs(orgId) {
  return query("SELECT key, label, type, entity FROM custom_field_defs WHERE org_id=? AND archived_at IS NULL", [orgId]).catch(() => []);
}
// SPLIT-2 end
// SPLIT-2 server.js piece 457

// The date words a stored definition may use, resolved on the org's own
// calendar every time it runs — a saved "this year" is this year.
async function rbTokens(orgId) {
  const org = await orgTz(orgId);
  const today = orgToday(org);                                 // ORG_TZ_SEAM_OK
  const fy = reportYearBounds(reportCurrentYear("fiscal", org), "fiscal");
  return { today, fyStart: fy.from, fyEnd: fy.to, twoYearsAgo: orgTime.addDays(today, -730) };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 459

// Run a builder definition for one org. Returns {columns, rows, totals, groups}.
// The compiled SQL carries its own $n placeholders and contains no `?`, so it
// passes through query()'s ?-to-$n rewrite untouched (asserted in the suite).
async function runBuilderDef(orgId, def) {
  await RB_READY;
  const c = RB.compile(RB.resolveDateTokens(def, await rbTokens(orgId)), { customDefs: await rbCustomDefs(orgId), paramStart: 2 });
  if (!c.ok) return { errors: c.errors };
  const where = [`${c.orgCol} = $1`, ...c.where].join(" AND ");
  const params = [orgId, ...c.params];
  // Totals are summed in the DATABASE over exactly the rows the filter names,
  // then read back to the cent — never re-added from a capped page.
  const sumSel = c.sums.map((s, i) => `COALESCE(SUM(${s.sql}),0) AS s${i}`).join(", ");
  const [tot] = await query(`SELECT COUNT(*)::int AS n${sumSel ? ", " + sumSel : ""} FROM ${c.from} WHERE ${where}`, params);
  const totals = { count: tot.n, sums: c.sums.map((s, i) => ({ key: s.key, label: s.label, cents: rbCents(tot["s" + i]) })) };
  if (c.group) {
    const gSel = c.sums.map((s, i) => `COALESCE(SUM(${s.sql}),0) AS s${i}`).join(", ");
    const rows = await query(
      `SELECT ${c.group.sql} AS g, COUNT(*)::int AS n${gSel ? ", " + gSel : ""} FROM ${c.from} WHERE ${where}
        GROUP BY 1 ORDER BY 1 NULLS LAST LIMIT ${c.limit}`, params);
    const columns = [{ key: "group", label: c.group.label, type: "text" }, { key: "count", label: "Count", type: "number" },
      ...c.sums.map((s, i) => ({ key: "s" + i, label: s.label, type: "money" }))];
    return { columns, rows: rows.map(r => ({ group: r.g ?? "(blank)", count: r.n, ...Object.fromEntries(c.sums.map((s, i) => ["s" + i, rbCents(r["s" + i]) / 100])) })), totals, grouped: true };
  }
  // FIX-2 B — each row carries the person it is about (`_pid`), so a row on
  // the screen opens that person. It is not a column: the CSV, the PDF and the
  // weekly email walk `columns`, so no file grows a field for it.
  const sel = c.columns.map((f, i) => `${f.sql} AS c${i}`).join(", ") + (c.person ? `, ${c.person} AS _pid` : "");
  const order = c.sort ? `${c.sort.sql} ${c.sort.dir} NULLS LAST` : "1";
  const rows = await query(`SELECT ${sel} FROM ${c.from} WHERE ${where} ORDER BY ${order} LIMIT ${c.limit}`, params);
  return {
    columns: c.columns.map((f, i) => ({ key: "c" + i, label: f.label, type: f.type })),
    rows: rows.map(r => {
      const o = Object.fromEntries(c.columns.map((f, i) => ["c" + i, f.type === "money" ? rbCents(r["c" + i]) / 100 : r["c" + i]]));
      if (c.person && r._pid) o._pid = r._pid;
      return o;
    }),
    totals, capped: totals.count > rows.length,
  };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 460

function rbFormatCell(v, type) {
  if (v === null || v === undefined) return "";
  if (type === "money") return "$" + (rbCents(v) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (type === "bool") return v ? "Yes" : "No";
  return String(v);
}
// SPLIT-2 end
// SPLIT-2 server.js piece 461

// ── THE WEEKLY EMAIL ───────────────────────────────────────────────────────
// Monday morning, org-local, ONCE per report per week: saved_report_sends is
// reserved BEFORE the send (the digest_sends discipline) and released if the
// send fails. It goes to the report's OWNER — staff mail, branded, no donor
// footer — and its only link opens the report in Steward, a plain GET that
// changes nothing.
async function runSavedReportScheduleForOrg(org, { weekKey, force = false } = {}) {
  const reps = await query("SELECT * FROM saved_reports WHERE org_id=? AND schedule='weekly'", [org.id]);
  let sent = 0, skipped = 0;
  for (const r of reps) {
    const reserved = await query(
      "INSERT INTO saved_report_sends (id,org_id,report_id,period_key) VALUES (?,?,?,?) ON CONFLICT (report_id, period_key) DO NOTHING RETURNING id",
      [newId("rps"), org.id, r.id, weekKey]);
    if (!reserved.length) { skipped++; continue; }
    const [owner] = await query("SELECT email, name FROM users WHERE id=? AND org_id=?", [r.owner_id, org.id]);
    if (!owner?.email) { skipped++; continue; }
    const out = await runBuilderDef(org.id, asJson(r.definition, {}));
    if (out.errors) { await run("DELETE FROM saved_report_sends WHERE id=?", [reserved[0].id]); skipped++; continue; }
    const link = `${publicAppUrl()}/dashboard?report=${encodeURIComponent(r.id)}`;
    const head = out.columns.map(c => `<th style="text-align:left;padding:4px 8px;border-bottom:1px solid #e8e4db;font-size:12px">${escapeHtml(c.label)}</th>`).join("");
    const body = out.rows.slice(0, 20).map(row => `<tr>${out.columns.map(c => `<td style="padding:4px 8px;font-size:12px">${escapeHtml(rbFormatCell(row[c.key], c.type))}</td>`).join("")}</tr>`).join("");
    const html = `<div style="font-family:Arial,sans-serif;color:#0f1a12"><p style="font-size:15px"><strong>${escapeHtml(r.name)}</strong>: ${out.totals.count.toLocaleString("en-US")} ${out.totals.count === 1 ? "row" : "rows"} this week.</p>
      <table style="border-collapse:collapse">${head ? `<tr>${head}</tr>` : ""}${body}</table>
      ${out.totals.count > 20 ? `<p style="font-size:12px;color:#5a554f">and ${out.totals.count - 20} more.</p>` : ""}
      <p><a href="${link}">Open the report in Steward</a></p></div>`;
    const ok = await sendGiftAlertEmail(org, owner.email, `${r.name}: your weekly report`, html);
    if (!ok) { await run("DELETE FROM saved_report_sends WHERE id=?", [reserved[0].id]); skipped++; continue; }
    await run("UPDATE saved_reports SET last_sent_at=NOW() WHERE id=?", [r.id]);
    sent++;
  }
  return { sent, skipped, force };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 462

// ══ Development reporting cadence — digests (BUILD-17) ══════════════════════
// The oversight rhythm that runs a development office. Two scheduled emails —
// a weekly "Week in Review" (ED + every team member) and a monthly per-officer
// report — composed from the BUILD-14/15/16 feeds and sent through the SAME
// 5-min tick as scheduled campaigns/dunning (no second scheduler). Idempotent
// per (org, digest_type, period_key, recipient) via digest_sends' unique index:
// a row is RESERVED before sending, so re-ticking within the week never
// double-sends. A double-send is a trust disaster; the reservation is
// non-negotiable, exactly like workflow_runs.

// (digestYmd deleted, BUILD-75 A.5 — its last caller now reads orgToday; a
// process-clock date formatter kept around is a tainted helper waiting for a
// new caller, which is exactly the class the reachability guard exists for.)
// Monday-based week. offset 0 = the week containing `now`; -1 = the prior
// (most-recently-completed) week. key is stable per Monday.
// BUILD-72 Part 4 — both delegate to the seam. They used to build windows from
// the SERVER's local clock (UTC in prod), so a gift entered Sunday evening in
// New York landed outside the week the product called "this week". `org` is
// {timezone} from orgTz(orgId); omitting it falls back to the default zone
// rather than to the server's, which is the whole point. ORG_TZ_SEAM_OK
function weekBounds(offset = 0, org = null, atInstant = new Date()) {
  return orgPeriodBounds(org || {}, "week", offset, atInstant);
}
// SPLIT-2 end
// SPLIT-2 server.js piece 463
function monthBounds(offset = 0, org = null, atInstant = new Date()) {
  return orgPeriodBounds(org || {}, "month", offset, atInstant);
}
// SPLIT-2 end
// SPLIT-2 server.js piece 464

// ── BUILD-88a A.5 — THE WEEK IN REVIEW IS THE ACTIVITY REPORT ──────────────
// The weekly email listed gifts, asks, moves and past-due tasks: what the money
// did and what was still owed. It did not say what anyone DID. A fundraiser's
// week is conversations logged, gifts received, thank-yous sent, and follow-ups
// closed or let go — and that report existed nowhere, so nobody could answer
// "what happened last week?" without reading the database.
//
// ONE COUNTER, used by the weekly email AND by the People dashboard's "This
// week", so the two can never disagree. It takes a WINDOW rather than a period
// name, which is what makes the arithmetic checkable: the seven single-day
// windows of a week sum to the week, in cents, and tests/build88a-week.test.js
// asserts exactly that. A number you cannot take apart is a number nobody can
// audit.
//
// `userId` scopes to one person's work (the conversations they logged, the
// gifts on their donors, the threads they own); org-wide otherwise.
async function composeActivityReport(orgId, win, userId = null) {
  const { start, end } = win;
  const byUser = !!userId;
  // FIX-2 A — every figure here is read THROUGH its source (figureSources.js),
  // the same sources the People dashboard's "This week" opens. A conversation
  // is a TOUCH, not every interaction: an automatic timeline entry (a gift
  // landing, a stage change) is not something a person did (CONVERSATION_TYPES).
  // The thank-yous are counted by the stamp, not the flag: a gift acknowledged
  // before A.5 carries no date and belongs to no week rather than to this one.
  const w = { from: start, to: end };
  const v = source => figureSources.figureValue(orgId, source).then(r => r.value);
  const [conversations, giftsN, giftDollars, thanks, outcome, dismissed] = await Promise.all([
    v({ key: "conversations", params: { ...w, ...(byUser ? { by: userId } : {}) } }),
    v({ key: "gifts", params: { ...w, measure: "count", ...(byUser ? { assigned: userId } : {}) } }),
    v({ key: "gifts", params: { ...w, ...(byUser ? { assigned: userId } : {}) } }),
    v({ key: "thanks-marked", params: { ...w, ...(byUser ? { assigned: userId } : {}) } }),
    v({ key: "threads-closed", params: { ...w, kind: "outcome", ...(byUser ? { owner: userId } : {}) } }),
    v({ key: "threads-closed", params: { ...w, kind: "dismissed", ...(byUser ? { owner: userId } : {}) } }),
  ]);
  // CENTS, through the one money seam. The week is compared against the sum of
  // its days and floats do not survive that comparison.
  const giftCents = money.toCents(giftDollars) ?? 0;
  return {
    window: { start, end }, scope: byUser ? "user" : "org", userId: userId || null,
    conversationsLogged: conversations || 0,
    giftsReceived: giftsN || 0,
    giftCents,
    giftDollars: money.toDollars(giftCents),
    thankYousMarkedSent: thanks || 0,
    threadsClosedByOutcome: outcome || 0,
    threadsDismissed: dismissed || 0,
  };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 466

// Compose the Week-in-Review sections for a window. officerId != null scopes
// every section to that officer's portfolio (their assigned donors + their
// tasks); org-wide otherwise. today gates the past-due-tasks section.
async function composeWeekInReview(orgId, win, officerId = null) {
  const { start, end } = win;
  const today = orgToday(await orgTz(orgId)); // ORG_TZ_SEAM_OK (BUILD-75 A.5) — past-due gating on the ORG's civil date
  const dFilter = officerId ? "AND d.assigned_to = ?" : "";
  const dParam = officerId ? [officerId] : [];
  const gifts = await query(
    `SELECT g.amount, d.name AS donor_name, d.id AS donor_id FROM gifts g
     JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
     WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.date >= ? AND g.date <= ? ${dFilter}
     ORDER BY g.amount DESC`, [orgId, start, end, ...dParam]);
  const asks = await query(
    `SELECT o.name AS opp_name, o.target_amount, o.officer_name, d.name AS donor_name, d.id AS donor_id FROM opportunities o
     JOIN donors d ON d.id = o.donor_id AND d.org_id = o.org_id
     WHERE o.org_id = ? AND d.deleted_at IS NULL AND ${orgTime.orgDayWindowSql("o.created_at", orgTime.orgTzSql("o.org_id"), "?", "?")} ${dFilter}
     ORDER BY o.target_amount DESC`, [orgId, start, end, ...dParam]);
  const moves = await query(
    `SELECT m.from_stage, m.to_stage, m.description, m.officer_name, d.name AS donor_name, d.id AS donor_id FROM moves m
     JOIN donors d ON d.id = m.donor_id AND d.org_id = m.org_id
     WHERE m.org_id = ? AND d.deleted_at IS NULL AND ${orgTime.orgDayWindowSql("m.created_at", orgTime.orgTzSql("m.org_id"), "?", "?")} ${dFilter}
     ORDER BY m.created_at DESC`, [orgId, start, end, ...dParam]);
  const tFilter = officerId ? "AND t.assigned_to = ?" : "";
  const pastDueTasks = await query(
    `SELECT t.title, t.due, t.assigned_to_name, d.name AS donor_name, d.id AS donor_id FROM tasks t
     LEFT JOIN donors d ON d.id = t.donor_id AND d.org_id = t.org_id
     WHERE t.org_id = ? AND t.done = 0 AND t.voided_at IS NULL AND t.due IS NOT NULL AND t.due <> '' AND LEFT(t.due,10) < ? ${tFilter}
       AND COALESCE(t.link_kind, '') <> 'next_step'   -- FIX-31: next steps are reported as threads
     ORDER BY t.due ASC`, [orgId, today, ...(officerId ? [officerId] : [])]);
  // BUILD-88a A.5 — the activity report rides with the sections, from the ONE
  // counter the People dashboard reads.
  const activity = await composeActivityReport(orgId, win, officerId);
  return {
    activity, activityDefinitions: ACTIVITY_DEFINITIONS,
    gifts: gifts.map(g => ({ donorId: g.donor_id, donorName: g.donor_name, amount: Number(g.amount) })),
    asks: asks.map(a => ({ donorId: a.donor_id, donorName: a.donor_name, name: a.opp_name, targetAmount: Number(a.target_amount || 0), officerName: a.officer_name })),
    moves: moves.map(m => ({ donorId: m.donor_id, donorName: m.donor_name, fromStage: m.from_stage, toStage: m.to_stage, description: m.description, officerName: m.officer_name })),
    pastDueTasks: pastDueTasks.map(t => ({ title: t.title, due: t.due, donorName: t.donor_name, assignedToName: t.assigned_to_name })),
    totals: {
      giftCount: gifts.length, giftTotal: gifts.reduce((s, g) => s + Number(g.amount), 0),
      askCount: asks.length, askTotal: asks.reduce((s, a) => s + Number(a.target_amount || 0), 0),
      moveCount: moves.length, pastDueCount: pastDueTasks.length,
    },
  };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 467

// Compose one officer's monthly report: asks made, moves made, gifts closed,
// portfolio progress — the management-oversight artifact.
async function composeOfficerMonthly(orgId, win, officer) {
  const { start, end } = win;
  const [made] = await query(
    `SELECT COUNT(*)::int AS cnt, COALESCE(SUM(target_amount),0) AS amt FROM opportunities WHERE org_id=? AND officer_id=? AND ${orgTime.orgDayWindowSql("created_at", orgTime.orgTzSql("org_id"), "?", "?")}`,
    [orgId, officer.id, start, end]);
  const [movesMade] = await query(
    `SELECT COUNT(*)::int AS cnt FROM moves WHERE org_id=? AND officer_id=? AND ${orgTime.orgDayWindowSql("created_at", orgTime.orgTzSql("org_id"), "?", "?")}`,
    [orgId, officer.id, start, end]);
  const [won] = await query(
    `SELECT COUNT(*)::int AS cnt, COALESCE(SUM(gift_amount),0) AS amt FROM opportunities WHERE org_id=? AND officer_id=? AND status='won' AND ${orgTime.orgDayWindowSql("closed_at", orgTime.orgTzSql("org_id"), "?", "?")}`,
    [orgId, officer.id, start, end]);
  const [portfolio] = await query(
    "SELECT COUNT(*)::int AS cnt, COALESCE(SUM(total_giving),0) AS val FROM donors WHERE org_id=? AND assigned_to=? AND deleted_at IS NULL",
    [orgId, officer.id]);
  return {
    officerId: officer.id, officerName: officer.name,
    asksMade: made.cnt, asksMadeAmount: Number(made.amt),
    movesMade: movesMade.cnt,
    giftsClosed: won.cnt, giftsClosedAmount: Number(won.amt),
    portfolioCount: portfolio.cnt, portfolioValue: Number(portfolio.val),
  };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 470
function digestSectionHtml(title, rowsHtml, emptyLine) {
  return `<div style="margin:22px 0 0;">
    <div style="font-family:'DM Sans',Helvetica,Arial,sans-serif;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#1a6b4a;margin-bottom:8px;">${digestEsc(title)}</div>
    ${rowsHtml || `<div style="font-family:'DM Sans',Helvetica,Arial,sans-serif;font-size:13px;color:#8fa896;">${digestEsc(emptyLine)}</div>`}
  </div>`;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 471
function renderWeekInReviewBody(sec, win, headingName) {
  // BUILD-88a A.5 — WHAT ANYBODY ACTUALLY DID. Every figure carries the
  // sentence it answers to, from the same constant the People dashboard reads.
  const a = sec.activity || {};
  const defs = sec.activityDefinitions || {};
  const actRow = (label, value, key) => `<tr><td style="padding:6px 0;border-bottom:1px solid #eee7d8;">
      <div style="font-family:'DM Sans',Helvetica,Arial,sans-serif;font-size:14px;color:#0f1a12;">${label}<span style="float:right;color:#0d5c3a;font-weight:800;">${value}</span></div>
      <div style="font-family:'DM Sans',Helvetica,Arial,sans-serif;font-size:11.5px;color:#6b7d70;margin-top:2px;max-width:420px;">${digestEsc(defs[key] || "")}</div>
    </td></tr>`;
  const activityBlock = `<div style="margin:22px 0 0;">
    <div style="font-family:'DM Sans',Helvetica,Arial,sans-serif;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#1a6b4a;margin-bottom:8px;">What happened</div>
    <table style="border-collapse:collapse;width:100%;">
      ${actRow("Conversations logged", a.conversationsLogged || 0, "conversationsLogged")}
      ${actRow("Gifts received", `${a.giftsReceived || 0} · ${digestMoney(a.giftDollars || 0)}`, "giftsReceived")}
      ${actRow("Thank-yous marked sent", a.thankYousMarkedSent || 0, "thankYousMarkedSent")}
      ${actRow("Follow-ups closed by outcome", a.threadsClosedByOutcome || 0, "threadsClosedByOutcome")}
      ${actRow("Follow-ups dismissed", a.threadsDismissed || 0, "threadsDismissed")}
    </table>
  </div>`;
  const row = (a2, b) => `<div style="font-family:'DM Sans',Helvetica,Arial,sans-serif;font-size:14px;color:#0f1a12;padding:5px 0;border-bottom:1px solid #eee7d8;">${a2}${b ? `<span style="float:right;color:#0d5c3a;font-weight:700;">${b}</span>` : ""}</div>`;
  const gifts = sec.gifts.map(g => row(digestEsc(g.donorName), digestMoney(g.amount))).join("");
  const asks = sec.asks.map(a => row(`${digestEsc(a.donorName)}${a.name ? ` ${digestEsc(a.name)}` : ""}`, digestMoney(a.targetAmount))).join("");
  const moves = sec.moves.map(m => row(`${digestEsc(m.donorName)} · ${digestEsc(m.fromStage || "Not set")} → ${digestEsc(m.toStage)}<div style="font-size:12px;color:#6b7d70;">${digestEsc(m.description)}</div>`, "")).join("");
  const tasks = sec.pastDueTasks.map(t => row(`${digestEsc(t.title)}${t.donorName ? ` · ${digestEsc(t.donorName)}` : ""}`, `due ${digestEsc((t.due || "").slice(0, 10))}`)).join("");
  return `<div style="padding:22px;background:#f0ede6;font-family:'DM Sans',Helvetica,Arial,sans-serif;">
    <div style="font-family:'DM Serif Display',Georgia,serif;font-size:22px;color:#0f1a12;">Week in Review</div>
    <div style="font-size:13px;color:#6b7d70;margin-top:2px;">${digestEsc(win.start)} – ${digestEsc(win.end)}${headingName ? ` · ${digestEsc(headingName)}` : ""}</div>
    <div style="margin:16px 0;padding:14px 16px;background:#fff;border-radius:12px;border:1px solid #e5e0d5;">
      <span style="font-weight:800;color:#0d5c3a;">${digestMoney(sec.totals.giftTotal)}</span> in ${sec.totals.giftCount} gift${sec.totals.giftCount === 1 ? "" : "s"} ·
      ${sec.totals.askCount} ask${sec.totals.askCount === 1 ? "" : "s"} ·
      ${sec.totals.moveCount} move${sec.totals.moveCount === 1 ? "" : "s"} ·
      <span style="color:${sec.totals.pastDueCount ? "#b8593f" : "#6b7d70"};font-weight:700;">${sec.totals.pastDueCount} past-due task${sec.totals.pastDueCount === 1 ? "" : "s"}</span>
    </div>
    ${activityBlock}
    ${digestSectionHtml("Gifts received", gifts, "No gifts recorded this week.")}
    ${digestSectionHtml("Asks / pledges made", asks, "No new asks logged this week.")}
    ${digestSectionHtml("Moves", moves, "No pipeline moves this week.")}
    ${digestSectionHtml("Past-due tasks", tasks, "Nothing past due, nice.")}
  </div>`;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 472
function renderOfficerMonthlyBody(rep, win) {
  const stat = (l, v) => `<div style="display:inline-block;min-width:130px;margin:6px 14px 6px 0;"><div style="font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#6b7d70;">${l}</div><div style="font-size:20px;font-weight:800;color:#0f1a12;">${v}</div></div>`;
  return `<div style="padding:22px;background:#f0ede6;font-family:'DM Sans',Helvetica,Arial,sans-serif;">
    <div style="font-family:'DM Serif Display',Georgia,serif;font-size:22px;color:#0f1a12;">Monthly Report · ${digestEsc(displayNameCase(rep.officerName))}</div>
    <div style="font-size:13px;color:#6b7d70;margin-top:2px;">${digestEsc(win.start)} – ${digestEsc(win.end)}</div>
    <div style="margin-top:16px;padding:16px;background:#fff;border-radius:12px;border:1px solid #e5e0d5;">
      ${stat("Asks made", `${rep.asksMade} · ${digestMoney(rep.asksMadeAmount)}`)}
      ${stat("Moves made", rep.movesMade)}
      ${stat("Gifts closed", `${rep.giftsClosed} · ${digestMoney(rep.giftsClosedAmount)}`)}
      ${stat("Portfolio", `${rep.portfolioCount} · ${digestMoney(rep.portfolioValue)}`)}
    </div>
  </div>`;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 473

// "Due for a touch" — the real-data nudge behind an otherwise-empty digest
// (BUILD-35 Part 2): assigned (or org-wide) donors with no interaction in the
// last 30 days. An all-zero stat row shames and spams; a computed nudge tells
// the officer the one useful thing their data actually says.
async function countDonorsDueForTouch(orgId, officerId = null) {
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const oFilter = officerId ? "AND d.assigned_to = ?" : "";
  const [row] = await query(
    `SELECT COUNT(*)::int AS n FROM donors d
     WHERE d.org_id = ? AND d.deleted_at IS NULL AND d.is_sample IS NOT TRUE ${oFilter}
       AND NOT EXISTS (SELECT 1 FROM interactions i
                       WHERE i.donor_id = d.id AND i.org_id = d.org_id AND LEFT(i.date,10) >= ?)`,
    officerId ? [orgId, officerId, cutoff] : [orgId, cutoff]);
  return row.n;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 475

// Reserve one recipient's digest (idempotency choke point). Returns the row id
// if newly reserved, or null if it was already sent this period.
async function reserveDigest(orgId, digestType, periodKey, recipientUserId, recipientEmail, scope, meta) {
  const id = newId("dg");
  const reserved = await query(
    `INSERT INTO digest_sends (id,org_id,digest_type,period_key,recipient_user_id,recipient_email,scope,meta)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT (org_id,digest_type,period_key,recipient_user_id) DO NOTHING
     RETURNING id`,
    [id, orgId, digestType, periodKey, recipientUserId, recipientEmail || null, scope || null, JSON.stringify(meta || {})]);
  return reserved.length ? id : null;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 476

// Run both digests for one org for the given windows. send=false → compose
// only (preview/dry-run), reserving nothing. Returns what was sent + skipped.
async function runDigestsForOrg(org, { wk, mo, types = ["weekly", "monthly"], send = true }) {
  const tier = orgPlanTier(org);
  const out = { weekly: { sent: [], skipped: [] }, monthly: { sent: [], skipped: [] } };
  // Checked before anything is RESERVED, not just before it is sent: a
  // reserved period is a promise never to retry it, so reserving for an org
  // that may not send would silently burn the week it would have reported on
  // once mail is turned back on. send=false (dry-run/preview) is composition
  // only and stays allowed — looking at what a digest WOULD say is how you
  // check an org is safe to re-enable.
  if (send) {
    // FIX-48: a digest is STAFF mail, so it reads the staff switch.
    const gate = await orgMaySendEmail(org && org.id, mailPolicy.CATEGORY.STAFF);
    if (!gate.send) {
      out.gated = gate.reason;
      return out;
    }
  }
  const users = await query("SELECT id, name, email, role FROM users WHERE org_id=? AND email IS NOT NULL", [org.id]);

  // ── Weekly Week-in-Review — every user. On Team, an admin/ED sees org-wide;
  //    an officer sees their own portfolio + a team roll-up. On Core (incl.
  //    single-user), everyone gets the whole org-wide digest.
  if (types.includes("weekly")) {
    const orgWide = await composeWeekInReview(org.id, wk, null);
    for (const u of users) {
      const isOfficerScope = tier === "team" && u.role !== "admin";
      const sec = isOfficerScope ? await composeWeekInReview(org.id, wk, u.id) : orgWide;
      const scope = isOfficerScope ? "officer" : "org";
      const teamRollup = isOfficerScope ? orgWide.totals : null;
      const payload = { recipientUserId: u.id, email: u.email, scope, periodKey: wk.key, sections: sec, teamRollup };
      if (!send) { out.weekly.sent.push(payload); continue; }
      // STAFF-MAIL-1: only to a person who turned it on. Asked before the
      // period is reserved, so turning it on later still gets this week.
      if (!(await userWantsEmail(u.id, "week_in_review"))) { out.weekly.skipped.push({ recipientUserId: u.id, reason: "opted_out" }); continue; }
      // A fully-empty week never sends four "No X this week" sections
      // (BUILD-35 Part 2): if real data offers a nudge (donors due for a
      // touch), send that instead; if there's genuinely nothing actionable,
      // reserve the period (so the tick never retries) and send nothing.
      const wkEmpty = sec.totals.giftCount === 0 && sec.totals.askCount === 0 && sec.totals.moveCount === 0 && sec.totals.pastDueCount === 0;
      const wkDue = wkEmpty ? await countDonorsDueForTouch(org.id, isOfficerScope ? u.id : null) : 0;
      const rid = await reserveDigest(org.id, "weekly", wk.key, u.id, u.email, scope, wkEmpty ? { ...sec.totals, empty: true, dueForTouch: wkDue, suppressed: wkDue === 0 } : sec.totals);
      if (!rid) { out.weekly.skipped.push({ recipientUserId: u.id }); continue; }
      if (wkEmpty && wkDue === 0) { out.weekly.skipped.push({ recipientUserId: u.id, suppressed: true }); continue; }
      const rollupLine = teamRollup ? `<div style="padding:0 22px 22px;background:#f0ede6;font-family:'DM Sans',Helvetica,Arial,sans-serif;font-size:12px;color:#6b7d70;">Team roll-up: ${digestMoney(teamRollup.giftTotal)} · ${teamRollup.giftCount} gifts · ${teamRollup.moveCount} moves org-wide.</div>` : "";
      const body = wkEmpty
        ? `<div style="padding:22px;background:#f0ede6;font-family:'DM Sans',Helvetica,Arial,sans-serif;">
            <div style="font-family:'DM Serif Display',Georgia,serif;font-size:22px;color:#0f1a12;">Week in Review</div>
            <div style="font-size:13px;color:#6b7d70;margin-top:2px;">${digestEsc(wk.start)} – ${digestEsc(wk.end)}${isOfficerScope ? ` · ${digestEsc(displayNameCase(u.name))}` : ""}</div>
            ${digestNudgeHtml(`A quiet week, nothing logged. <strong>${wkDue}</strong> donor${wkDue === 1 ? "" : "s"} ${isOfficerScope ? "in your portfolio " : ""}${wkDue === 1 ? "is" : "are"} due for a touch, a call or note this week keeps them from drifting.`, "Open Steward")}
          </div>` + rollupLine
        : renderWeekInReviewBody(sec, wk, isOfficerScope ? displayNameCase(u.name) : null) + rollupLine;
      // FIX-15 Part 3: "sent" only when the provider took it.
      if (await sendDigestEmail(org, u.email, `Week in Review: ${displayNameCase(org.name)}`, body)) out.weekly.sent.push(payload);
      else out.weekly.skipped.push({ ...payload, reason: "provider_refused" });
    }
  }

  // ── Monthly per-officer report — [Team] only. One email per officer.
  if (types.includes("monthly") && tier === "team") {
    for (const u of users) {
      const rep = await composeOfficerMonthly(org.id, mo, u);
      const payload = { recipientUserId: u.id, email: u.email, periodKey: mo.key, report: rep };
      if (!send) { out.monthly.sent.push(payload); continue; }
      if (!(await userWantsEmail(u.id, "monthly_report"))) { out.monthly.skipped.push({ recipientUserId: u.id, reason: "opted_out" }); continue; }
      // An all-zero month must never render "0 asks · 0 moves · 0 gifts" at an
      // officer (BUILD-35 Part 2). If their portfolio offers a real nudge,
      // send that; if nothing is actionable either, reserve the period (no
      // tick retries) and send nothing this month.
      const allZero = rep.asksMade === 0 && rep.movesMade === 0 && rep.giftsClosed === 0;
      const moDue = allZero ? await countDonorsDueForTouch(org.id, u.id) : 0;
      const rid = await reserveDigest(org.id, "monthly", mo.key, u.id, u.email, "officer",
        allZero ? { asksMade: 0, giftsClosed: 0, empty: true, dueForTouch: moDue, suppressed: moDue === 0 } : { asksMade: rep.asksMade, giftsClosed: rep.giftsClosed });
      if (!rid) { out.monthly.skipped.push({ recipientUserId: u.id }); continue; }
      if (allZero && moDue === 0) { out.monthly.skipped.push({ recipientUserId: u.id, suppressed: true }); continue; }
      const body = allZero
        ? `<div style="padding:22px;background:#f0ede6;font-family:'DM Sans',Helvetica,Arial,sans-serif;">
            <div style="font-family:'DM Serif Display',Georgia,serif;font-size:22px;color:#0f1a12;">Monthly Report · ${digestEsc(displayNameCase(rep.officerName))}</div>
            <div style="font-size:13px;color:#6b7d70;margin-top:2px;">${digestEsc(mo.start)} – ${digestEsc(mo.end)}</div>
            ${digestNudgeHtml(`No moves logged this month, <strong>${moDue}</strong> prospect${moDue === 1 ? "" : "s"} in your portfolio ${moDue === 1 ? "is" : "are"} due for a touch. One conversation this week is next month's ask.`, "Open your pipeline")}
          </div>`
        : renderOfficerMonthlyBody(rep, mo);
      if (await sendDigestEmail(org, u.email, `Your Monthly Report: ${displayNameCase(org.name)}`, body)) out.monthly.sent.push(payload);
      else out.monthly.skipped.push({ ...payload, reason: "provider_refused" });
    }
  }
  return out;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 477

async function composeDailyTaskReminder(orgId, userId, today) {
  const rows = await query(
    `SELECT t.*, d.name AS donor_name, d.email AS donor_email FROM tasks t
       LEFT JOIN donors d ON d.id=t.donor_id AND d.org_id=t.org_id
      WHERE t.org_id=? AND t.assigned_to=? AND t.done=0 AND t.voided_at IS NULL
        AND t.due IS NOT NULL AND t.due <> '' AND LEFT(t.due,10) <= ?
        -- FIX-31: a next step (and a deadline whose follow-up thread is open)
        -- already has its own nudge email; one reminder per thing, not two.
        AND COALESCE(t.link_kind, '') <> 'next_step'
        AND NOT EXISTS (SELECT 1 FROM grant_milestones m JOIN threads th ON th.id = m.thread_id AND th.closed_at IS NULL
                         WHERE m.id = t.milestone_id AND m.org_id = t.org_id AND t.link_kind = 'deadline')
      ORDER BY t.due ASC`,
    [orgId, userId, today]);
  const overdue = rows.filter(r => String(r.due).slice(0, 10) < today);
  const dueToday = rows.filter(r => String(r.due).slice(0, 10) === today);
  return { rows, overdue, dueToday, count: rows.length };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 478

function renderDailyTaskReminderBody(digest, org, user, today) {
  const li = t => {
    const badge = String(t.due).slice(0, 10) < today
      ? `<span style="color:#8a3a24;font-weight:700;">Overdue</span>`
      : `<span style="color:#8a6d1f;font-weight:700;">Today</span>`;
    const donor = t.donor_name ? ` · ${digestEsc(displayNameCase(t.donor_name))}` : "";
    return `<li style="margin:6px 0;color:#0f1a12;">${digestEsc(t.title)} <span style="color:#6b7d70;">${badge}<span style="color:#6b7d70;"> ${digestEsc(String(t.due).slice(0, 10))}${donor}</span></span></li>`;
  };
  const overdueBlock = digest.overdue.length
    ? `<div style="font-weight:700;color:#8a3a24;margin-top:12px;">Overdue (${digest.overdue.length})</div><ul style="margin:4px 0 0;padding-left:18px;">${digest.overdue.map(li).join("")}</ul>` : "";
  const todayBlock = digest.dueToday.length
    ? `<div style="font-weight:700;color:#8a6d1f;margin-top:12px;">Due today (${digest.dueToday.length})</div><ul style="margin:4px 0 0;padding-left:18px;">${digest.dueToday.map(li).join("")}</ul>` : "";
  return `<div style="padding:22px;background:#f0ede6;font-family:'DM Sans',Helvetica,Arial,sans-serif;">
      <div style="font-family:'DM Serif Display',Georgia,serif;font-size:22px;color:#0f1a12;">Your tasks for today</div>
      <div style="font-size:13px;color:#6b7d70;margin-top:2px;">${digestEsc(displayNameCase(user.name || ""))} · ${digestEsc(today)}</div>
      ${todayBlock}${overdueBlock}
      <div style="margin-top:16px;"><a href="${publicAppUrl()}/dashboard" style="color:#0d5c3a;font-weight:700;text-decoration:underline;">Open your tasks →</a></div>
    </div>`;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 479

// Run the daily reminder for one org. send=false → compose only (preview),
// reserving nothing. Non-empty is required to send. Returns sent/skipped.
// BUILD-85 — there is ONE morning sender now. This name survives because the
// ops route and the suites call it; underneath, it is the brief, which carries
// the task section this function used to send on its own. Both ticks land
// here, and the digest_sends reservations make the second one a no-op.
async function runDailyTaskRemindersForOrg(org, opts) { return runMorningBriefForOrg(org, opts); }
// SPLIT-2 end
// SPLIT-2 server.js piece 481

// processGeocodeQueue(opts) — drain `pending`, oldest org first, up to the
// tick's budget. Batched: one provider request per 1,000 addresses on Geocodio.
// Every row leaves with a TERMINAL status, so "still processing" can never be
// a permanent state that the map has to paper over.
async function processGeocodeQueue({ limit = GEOCODE_TICK_BUDGET, orgId = null } = {}) {
  const cfg = geocode.providerConfig();
  if (cfg.name === "unconfigured") return { provider: cfg.name, reason: cfg.reason, looked_up: 0, requests: 0 };
  const scope = orgId ? " AND org_id = ?" : "";
  const params = orgId ? [orgId, limit] : [limit];
  const rows = await query(
    `SELECT id, org_id, address, address2, city, state, zip, country, geocode_key
       FROM donors WHERE geocode_status = 'pending' AND deleted_at IS NULL${scope}
      ORDER BY updated_at ASC, id ASC LIMIT ?`, params);
  if (!rows.length) return { provider: cfg.name, looked_up: 0, requests: 0 };

  // De-duplicate by KEY before spending a request: an org with 400 donors in
  // one town is one lookup, not 400. This is the other half of the caching
  // requirement, and the reason a real first import costs far less than its
  // row count suggests.
  const byKey = new Map();
  for (const d of rows) {
    const k = d.geocode_key || geocode.addressKey(d);
    if (!byKey.has(k)) byKey.set(k, { query: geocode.addressQuery(d), ids: [] });
    byKey.get(k).ids.push(d.id);
  }
  const keys = [...byKey.keys()];
  const t0 = Date.now();
  const { results, requests, provider } = await geocode.geocodeAddresses(keys.map(k => byKey.get(k).query), { config: cfg });

  const buckets = { ok: [], not_found: [], failed: [] };
  const coords = new Map();
  keys.forEach((k, i) => {
    const r = results[i] || { status: "failed", error: "no result" };
    const ids = byKey.get(k).ids;
    (buckets[r.status] || buckets.failed).push(...ids);
    if (r.status === "ok") for (const id of ids) coords.set(id, r);
  });
  for (const [status, ids] of Object.entries(buckets)) {
    if (!ids.length) continue;
    if (status === "ok") {
      await run(`UPDATE donors SET geocode_status='ok', geocoded_at=NOW(), geocode_provider=?,
                   latitude=v.lat::double precision, longitude=v.lng::double precision,
                   county=COALESCE(NULLIF(v.county, ''), donors.county)
                   FROM (SELECT * FROM UNNEST(?::text[], ?::text[], ?::text[], ?::text[]) AS t(id, lat, lng, county)) AS v
                  WHERE donors.id = v.id`,
                [provider, ids, ids.map(id => String(coords.get(id).lat)), ids.map(id => String(coords.get(id).lng)),
                 ids.map(id => coords.get(id).county || "")]);   // LIST-1: the county the provider placed it in
    } else {
      await run(`UPDATE donors SET geocode_status=?, geocoded_at=NOW(), geocode_provider=?,
                   latitude=NULL, longitude=NULL WHERE id = ANY(?)`, [status, provider, ids]);
    }
  }
  const out = { provider, looked_up: rows.length, distinct: keys.length, requests,
                ok: buckets.ok.length, not_found: buckets.not_found.length, failed: buckets.failed.length,
                ms: Date.now() - t0 };
  console.log(`[geocode] provider=${provider} rows=${out.looked_up} distinct=${out.distinct} requests=${out.requests} ` +
              `ok=${out.ok} not_found=${out.not_found} failed=${out.failed} ${out.ms}ms`);
  return out;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 484

// Fetch ONE remote image under the BUILD-37 G5 rules. Returns
// { buffer, contentType } or { error }. Never throws.
async function fetchRemoteImage(rawUrl) {
  const check = personPhoto.checkRemoteImageUrl(rawUrl);
  if (!check.ok) return { error: check.reason };
  // The string check above is the cheap first answer; the wall is
  // safeFetch.js (FIX-43): resolved once, connected to that checked address,
  // every redirect hop re-checked. The old `r.url` re-check after
  // redirect:"follow" never saw a NAME that resolved private.
  const r = await safeFetch(check.url, { headers: { accept: "image/*" }, schemes: ["https:"],
    maxBytes: personPhoto.PHOTO_MAX_BYTES, timeoutMs: personPhoto.PHOTO_FETCH_TIMEOUT_MS });
  if (!r.ok) {
    if (r.status) return { error: `http ${r.status}` };
    return { error: r.reason === "the answer was too large" ? "larger than 10 MB" : r.reason === "the page took too long" ? "timed out after 10s" : r.reason };
  }
  const buf = r.body;
  if (!buf.length) return { error: "empty response" };
  // Type by CONTENT, never by the header or the extension — the same rule
  // the upload route follows.
  const ct = ["image/png", "image/jpeg", "image/gif", "image/webp"]
    .find(m => imageBytesMatchMime(m, buf));
  if (!ct) return { error: "not an image" };
  return { buffer: buf, contentType: ct };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 485

async function processPhotoQueue({ limit = PHOTO_FETCH_BUDGET, orgId = null } = {}) {
  const scope = orgId ? " AND org_id = ?" : "";
  const params = orgId ? [orgId, limit] : [limit];
  const rows = await query(
    `SELECT id, org_id, photo_source_url FROM donors
      WHERE photo_fetch_status = 'pending' AND deleted_at IS NULL${scope}
      ORDER BY updated_at ASC, id ASC LIMIT ?`, params);
  if (!rows.length) return { fetched: 0, failed: 0, scanned: 0 };

  let fetched = 0, failed = 0;
  const queue = [...rows];
  const worker = async () => {
    for (let row = queue.shift(); row; row = queue.shift()) {
      const got = await fetchRemoteImage(row.photo_source_url);
      if (got.error) {
        failed++;
        // Logged per row, and kept on the row. Never fatal.
        console.error(`[person-photo] import row ${row.id}: ${got.error}`);
        await run(`UPDATE donors SET photo_fetch_status='failed', photo_fetch_error=? WHERE id=?`,
          [String(got.error).slice(0, 200), row.id]).catch(() => {});
        continue;
      }
      try {
        let out;
        const sharp = require("sharp");
        const r = await sharp(got.buffer, { failOn: "none" }).rotate()
          .resize(personPhoto.PHOTO_SIZE, personPhoto.PHOTO_SIZE, { fit: "cover", position: "attention" })
          .webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
        out = { buffer: r.data, width: r.info.width, height: r.info.height };
        const asset = await putThemeAsset({
          orgId: row.org_id, kind: personPhoto.PHOTO_ASSET_KIND,
          buffer: out.buffer, contentType: "image/webp", width: out.width, height: out.height,
        });
        await run(`UPDATE donors SET photo_asset_id=?, photo_fetch_status='ok', photo_fetch_error=NULL WHERE id=?`,
          [asset.id, row.id]);
        fetched++;
      } catch (e) {
        failed++;
        console.error(`[person-photo] import row ${row.id}: store failed:`, e.message);
        await run(`UPDATE donors SET photo_fetch_status='failed', photo_fetch_error=? WHERE id=?`,
          [("could not store: " + e.message).slice(0, 200), row.id]).catch(() => {});
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PHOTO_FETCH_CONCURRENCY, rows.length) }, worker));
  return { fetched, failed, scanned: rows.length };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 486

// ── BUILD-81 Part 2 — THE NUDGE LEAVES THE APP ──────────────────────────────
// A reminder in a dashboard nobody opens is not a reminder. ONE email per
// user per weekday morning, listing every open thread that is due or
// overdue, oldest first. Nothing on weekends by default (org toggle
// thread_nudge_weekends). NO email when nothing is due, and an empty morning
// reserves nothing. The SUBJECT is what escalates ("2 threads open · Bill
// Harmon, day 3" becomes "… day 11"); the body doesn't nag, the number does.
// Links open the donor's log-one-line screen in the app — a GET changes
// NOTHING (mail clients prefetch links); Done and Snooze happen there, after
// a page load, as POSTs. Idempotent per (org, user, day) via digest_sends
// ('thread_nudge', day:YYYY-MM-DD); per-user off switch notify_thread_nudge
// (default on); rides the existing 5-minute tick — never a second scheduler.

// Weekday check on the ORG's civil day (orgTime.dayOfWeek: 0=Mon … 6=Sun).
function threadNudgeDayOk(org, todayStr) {
  const dow = orgTime.dayOfWeek(todayStr);
  if (dow === null) return false;
  return dow < 5 || !!org.thread_nudge_weekends;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 487

// BUILD-85 — Every open thread due or overdue on `today` THAT THIS PERSON
// OWNS. BUILD-81 selected the whole org and handed the identical list to
// everybody: at a two-person shop that is invisible, and at six officers it is
// the classic failure — if it is everyone's list it is no one's. Unowned
// threads ride the ADMIN's list (a backstop, so nothing is orphaned) and
// nobody else's. Ranked and capped by shared/threadRank.js, so the ten rows
// an email can carry are the right ten.
async function composeThreadNudge(orgId, today, { userId = null, isAdmin = false, keepTimed = false } = {}) {
  const ownerClause = !userId ? ""
    : (isAdmin ? "AND (t.owner_id = ? OR t.owner_id IS NULL)" : "AND t.owner_id = ?");
  const rows = await query(
    `SELECT t.id, t.donor_id, d.name AS donor_name, d.email AS donor_email, t.next_step_type, t.next_step_label,
            t.due_date, t.due_time, t.opened_on, d.total_giving, d.gift_count, t.opening_gift_id, t.calendar_event_id,
            (SELECT k.id FROM tasks k WHERE k.org_id = t.org_id AND k.thread_id = t.id AND k.link_kind = 'next_step' AND k.done = 0 LIMIT 1) AS step_task_id
       FROM threads t JOIN donors d ON d.id = t.donor_id AND d.org_id = t.org_id
      WHERE t.org_id = ? AND t.closed_at IS NULL AND d.deleted_at IS NULL
        AND (t.snoozed_until IS NULL OR t.snoozed_until <= ?)
        AND t.due_date <= ? ${ownerClause}
      ORDER BY t.opened_on ASC, t.due_date ASC`,
    userId ? [orgId, today, today, userId] : [orgId, today, today]);
  // BUILD-84 FEATURE — PRECEDENCE, read from the ONE function that states it
  // (shared/threadShape.js digestShouldSkip): a task with a time sends its own
  // email at that time and is out of the digest ON ITS DUE DATE ONLY. Left
  // open, it rejoins the next morning as overdue, counted like everything
  // else. No task is ever reported twice on the same day.
  const { digestShouldSkip } = await threadShapeMod();
  const rank = await threadRankMod();
  // STAFF-MAIL-1: the step's own email is a switch she turns on. Until she
  // does (`keepTimed`), a step with a time today stays in her morning email,
  // so no step is ever reported nowhere.
  const eligible = keepTimed ? rows : rows.filter(r => !digestShouldSkip(r, today));
  if (!eligible.length) return [];

  // The same rank signals the queue uses, read in batches for exactly the
  // donors on this person's list — never one query per row.
  const donorIds = [...new Set(eligible.map(r => r.donor_id))];
  const ph = donorIds.map(() => "?").join(",");
  const asks = {}; const atRisk = new Set();
  for (const a of await query(
    `SELECT donor_id, COALESCE(SUM(target_amount),0) AS amt FROM opportunities
      WHERE org_id = ? AND status = 'open' AND donor_id IN (${ph}) GROUP BY donor_id`,
    [orgId, ...donorIds])) asks[a.donor_id] = parseFloat(a.amt) || 0;
  for (const r of await query(
    `SELECT DISTINCT donor_id FROM recurring_subscriptions
      WHERE org_id = ? AND donor_id IN (${ph}) AND status IN ('past_due','recovering')`,
    [orgId, ...donorIds])) atRisk.add(r.donor_id);
  // NUMBERS-4: the top tenth by lifetime, one line (shared/numbers/tags.js).
  const [{ p90 } = {}] = await query(require("../../shared/numbers/tags").TOP_TENTH_SQL, [orgId]);
  const majorThreshold = parseFloat(p90) || 0;

  const L = await ItemRefs.links();
  const shaped = eligible.map(r => ({
    id: r.id, donorId: r.donor_id,
    // THREAD-2: never a blank name in the morning email.
    donorName: L.nameOrFallback(displayNameCase(r.donor_name || ""), r.donor_email),
    stepRef: r.calendar_event_id ? { kind: "meeting", id: r.calendar_event_id, donorId: r.donor_id, date: r.due_date }
      : r.step_task_id ? { kind: "task", id: r.step_task_id, donorId: r.donor_id } : null,
    stepLabel: r.next_step_label, due: r.due_date,
    nextStep: { due: r.due_date },
    daysOpen: Math.max(0, orgTime.daysBetween(r.opened_on, today) ?? 0),
    dueDate: r.due_date, stepType: r.next_step_type, stepLabel: r.next_step_label,
    openAskAmount: asks[r.donor_id] || 0,
    recurringAtRisk: atRisk.has(r.donor_id),
    isFirstGift: !!r.opening_gift_id && Number(r.gift_count) === 1,
    lifetimeGiving: parseFloat(r.total_giving) || 0,
    majorThreshold,
  }));
  const q = rank.buildQueue(shaped, today, { cap: rank.EMAIL_CAP });
  return q.list.map(t => ({
    id: t.id, donorId: t.donorId, donorName: t.donorName, stepLabel: t.stepLabel, stepRef: t.stepRef || null,
    due: t.due, daysOpen: t.daysOpen, why: t.rank.why, band: t.band,
  }));
}
// SPLIT-2 end
// SPLIT-2 server.js piece 488

// The same list plus what the cap left behind, for the email's "and N more".
async function composeThreadNudgeQueue(orgId, today, opts) {
  const list = await composeThreadNudge(orgId, today, opts);
  const rank = await threadRankMod();
  // buildQueue already capped; `total` is recoverable from the unranked count,
  // which is cheaper to ask for again than to thread through the composer.
  const ownerClause = !opts?.userId ? ""
    : (opts.isAdmin ? "AND (t.owner_id = ? OR t.owner_id IS NULL)" : "AND t.owner_id = ?");
  const [{ n } = { n: 0 }] = await query(
    `SELECT COUNT(*)::int AS n FROM threads t JOIN donors d ON d.id = t.donor_id AND d.org_id = t.org_id
      WHERE t.org_id = ? AND t.closed_at IS NULL AND d.deleted_at IS NULL
        AND (t.snoozed_until IS NULL OR t.snoozed_until <= ?) AND t.due_date <= ? ${ownerClause}`,
    opts?.userId ? [orgId, today, today, opts.userId] : [orgId, today, today]);
  return { list, total: n, more: Math.max(0, n - list.length), cap: rank.EMAIL_CAP };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 489

// BUILD-85 — ONE subject for ONE email. The count is everything waiting on
// this person (threads AND tasks); the escalation is still the oldest thread,
// named, with its day count — the BUILD-81 line that made the subject do the
// work. A brief with no threads falls back to the task sentence rather than
// inventing a thread that is not there.
function morningBriefSubject(threads, taskCount, org, meetingCount = 0, readoutCount = 0) {
  const total = threads.length + taskCount;
  // LIVE-1 — a morning whose only news is what yesterday's import told us.
  if (threads.length === 0 && taskCount === 0 && !meetingCount && readoutCount) {
    return `What yesterday told us · ${displayNameCase(org.name || "")}`;
  }
  if (threads.length === 0 && taskCount === 0 && meetingCount) {
    return `${meetingCount} meeting${meetingCount === 1 ? "" : "s"} today · ${displayNameCase(org.name || "")}`;
  }
  if (threads.length === 0) {
    return `${taskCount} task${taskCount === 1 ? "" : "s"} need${taskCount === 1 ? "s" : ""} you today · ${displayNameCase(org.name || "")}`;
  }
  // BUILD-86 FIX — the escalation names the thread the QUEUE says to do first,
  // not the one that has been open longest. `threads` arrives rank-ordered
  // (shared/threadRank.js), so threads[0] is that one.
  //
  // Picking the oldest was BUILD-81's idea and it was right when nothing was
  // ranked. It stopped being right the moment a thread could be deliberately
  // deferred: a revisit-snoozed thread carries a huge `daysOpen` and would own
  // the subject line of every morning email for as long as it was open. The
  // day count still rides along, because a number in the subject is what made
  // the line work.
  const lead = threads[0];
  return `${total} waiting on you · ${lead.donorName}, day ${lead.daysOpen}`;
}
// SPLIT-2 end

__share({ opsAlert, noteServerError, thresholdsMod, agentGate, resolveSegmentSpec, resolveSegmentSpecInner, filterBySegment, resolveCampaignRecipients, campaignAudience, legacyCampaignBody, runCampaignSend, slugifyGivingPage, bumpFormEvent, formConfigMod, ratesMod, footingMod, smartAmountsMod, employerMatchMod, campaignPageMod, coverFeePayload, escapeHtml, reportYearBounds, reportCurrentYear, rbCustomDefs, rbTokens, runBuilderDef, rbFormatCell, runSavedReportScheduleForOrg, weekBounds, monthBounds, composeActivityReport, composeWeekInReview, composeOfficerMonthly, digestSectionHtml, renderWeekInReviewBody, renderOfficerMonthlyBody, countDonorsDueForTouch, reserveDigest, runDigestsForOrg, composeDailyTaskReminder, renderDailyTaskReminderBody, runDailyTaskRemindersForOrg, processGeocodeQueue, fetchRemoteImage, processPhotoQueue, threadNudgeDayOk, composeThreadNudge, composeThreadNudgeQueue, morningBriefSubject });
