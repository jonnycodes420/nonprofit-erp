// server/outreach/routes.js — campaigns, audiences and the communications hub.
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
const { newId } = require("../shared/newId");   // IDS-1: every new row id is prefix + 20 hex
// EMAIL-1 — a template rendered for one person (the send, the test, drafts).
const emailCompose = require("../../emailCompose");
const lapseRule = require("../../lapseRule");   // FIX-49: the one lapse rule

const routers = {
  r0: express.Router(),
  r1: express.Router(),
};

function mount(ctx) {
const {
  DS, GR, PT_READY, UNDO_SECONDS, actor, brandEmailHeaderHtml, bulkSendAddressGate, campaignAudience,
  checkWriteAccess, displayNameCase, donorFacingOrgName, escapeHtml, filterBySegment, mailPolicy,
  orgSendingIdentity, orgTime, orgToday, orgTz, orgTzName, pruneCampaignAssets, query,
  recordAssetPointerHistory, requireAdmin, requireAuth, resend, resolveCampaignRecipients,
  resolveOrgBrandTheme, resolveSegmentSpec, run, runCampaignSend, trashRow, unsubscribeEmailFooterHtml, uuid,
  wrap,
} = ctx;
let PT = null;
PT_READY.then(m => { PT = m; });

// ── BUILD-88c C.2 — NEVER A BLANK BOX ─────────────────────────────────────
// Communications opened on an empty editor and a blinking cursor. That is the
// moment a fundraiser closes the tab: writing an appeal from nothing, in a box,
// with a send button underneath, is the hardest thing on the screen and Steward
// was asking for it first. Six real emails instead, in the org's own words and
// colours.
const templatesMod = () => import("../../shared/emailTemplates.js");
let app = routers.r0;

app.get("/campaigns/templates", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const T = await templatesMod();
  const [org] = await query("SELECT name, vocabulary_json FROM orgs WHERE id=?", [orgId]);
  const V = await import("../../shared/vocabulary.js");
  const vocab = (() => { try { return org?.vocabulary_json ? JSON.parse(org.vocabulary_json) : null; } catch { return null; } })();
  const t = V.makeT(vocab);
  const theme = await resolveOrgBrandTheme(orgId).catch(() => null);
  const dfName = await donorFacingOrgName(orgId, org?.name || "").catch(() => org?.name || "");
  const list = T.templatesFor({ orgName: dfName, t });
  // PARITY-1 E — which starters a person here has already made their own.
  const reviewedRows = await query("SELECT starter_key FROM email_starter_reviews WHERE org_id=?", [orgId]).catch(() => []);
  const reviewed = new Set(reviewedRows.map(r => r.starter_key));
  // SWEEP-3: a subject on a template card is filled with one of her donors
  // (the newest giver, as the editor's preview is), never the sample "Margaret".
  const [giver] = await query(`SELECT d.name, d.total_giving, g.amount FROM donors d JOIN gifts g ON g.donor_id=d.id AND g.org_id=d.org_id
                                WHERE d.org_id=? AND d.deleted_at IS NULL AND COALESCE(d.name,'') <> ''
                                ORDER BY g.date DESC NULLS LAST, g.id LIMIT 1`, [orgId]).catch(() => []);
  const GR = await import("../../shared/greeting.js");
  const money = n => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });
  res.json({
    orgName: dfName,
    sampleDonor: giver ? { name: giver.name, firstName: GR.firstNames(giver) || String(giver.name).split(/\s+/)[0],
      giftAmount: money(giver.amount), totalGiving: money(giver.total_giving) } : null,
    // The org's own colours and logo, so the gallery is THEIR email and not a
    // stock one with their name pasted in.
    brand: theme ? { band: theme.band, bandFg: theme.bandFg, logo: theme.logoDataUri || theme.logoAbsUrl || null, displayName: theme.displayName } : null,
    mergeFields: T.MERGE_FIELDS,
    templates: list.map(x => ({ key: x.key, label: x.label, blurb: x.blurb, subject: x.subject, body: x.body, reviewed: reviewed.has(x.key) })),
  });
}));

// PARITY-1 E — A STARTER BECOMES THE ORG'S OWN when somebody saves a campaign
// from it with its words changed. The comparison is against the starter as
// THIS org is offered it (its name, its vocabulary), by text rather than markup,
// so an editor's re-serialised HTML is not mistaken for an edit. A key that is
// not one of the org's starters is ignored, never stored.
async function markStarterReviewed(req, starterKey, body, campaignId) {
  const key = String(starterKey || "").slice(0, 60);
  if (!key) return;
  const orgId = req.user.orgId;
  const T = await templatesMod();
  const [org] = await query("SELECT name, vocabulary_json FROM orgs WHERE id=?", [orgId]);
  const V = await import("../../shared/vocabulary.js");
  const vocab = (() => { try { return org?.vocabulary_json ? JSON.parse(org.vocabulary_json) : null; } catch { return null; } })();
  const dfName = await donorFacingOrgName(orgId, org?.name || "").catch(() => org?.name || "");
  const tpl = T.templatesFor({ orgName: dfName, t: V.makeT(vocab) }).find(x => x.key === key);
  if (!tpl || !T.starterEdited(tpl, body)) return;
  await run(
    `INSERT INTO email_starter_reviews (org_id, starter_key, campaign_id, created_by, created_by_name)
     VALUES (?,?,?,?,?) ON CONFLICT (org_id, starter_key) DO NOTHING`,
    [orgId, key, campaignId || null, actor(req).id, actor(req).name]);
}

// The segment, as PEOPLE. "17 recipients" is a number; "17 sponsors, including
// Margaret Chen and Bob Harmon" is a group — and a name that should not be on
// the list is the only thing anybody actually notices.
app.post("/campaigns/segment-preview", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const T = await templatesMod();
  const seg = req.body?.segment && typeof req.body.segment === "object" ? req.body.segment : {};
  // FIX-26: the count is the send's own decision for each person, so the
  // number on the button is the number of messages the send creates.
  const aud = await campaignAudience({ segment: JSON.stringify(seg) }, orgId)
    .catch(() => ({ recipients: [], leftOut: [], leftOutCount: 0, orgGate: { send: false, reason: "unreadable" } }));
  const donors = aud.recipients;
  const [org] = await query("SELECT vocabulary_json FROM orgs WHERE id=?", [orgId]);
  const V = await import("../../shared/vocabulary.js");
  const vocab = (() => { try { return org?.vocabulary_json ? JSON.parse(org.vocabulary_json) : null; } catch { return null; } })();
  const t = V.makeT(vocab);
  // The vocabulary key for a giver is `giver`, not `donor` — asking for
  // "donor" returns null and the sentence reads "3 null, including Margaret".
  // BUILD-94 Part 2 — a segment that crosses types reads as PEOPLE. "6 donors"
  // under a Volunteers segment is exactly the contradiction this part removes,
  // and the org's own word for a giver is still wrong for a volunteer.
  const PERSON_SEGMENTS = new Set(["everyone", "volunteers", "staff_board"]);
  const noun = seg.mode === "recurring" ? t("monthly_giver", 2)
    : PERSON_SEGMENTS.has(seg.mode) ? "people"
    : t("giver", 2);
  const names = donors.slice(0, 2).map(d => displayNameCase(d.name || ""));
  const [firstGift] = donors[0] ? await query("SELECT amount FROM gifts WHERE donor_id=? AND org_id=? ORDER BY date DESC NULLS LAST LIMIT 1", [donors[0].id, req.user.orgId]) : [];
  res.json({
    count: donors.length,
    names: donors.slice(0, 8).map(d => ({ id: d.id, name: displayNameCase(d.name || ""), email: d.email })),
    sentence: T.segmentSentence(donors.length, names, noun),
    // The first recipient is whose name the preview shows, so what she reads on
    // the right of the screen is the email the first person will get.
    // SWEEP-3: with the gift and total the send fills (legacyCampaignBody).
    first: donors[0] ? { id: donors[0].id, name: displayNameCase(donors[0].name || ""), firstName: String(donors[0].name || "").trim().split(/\s+/)[0] || "Margaret",
      ...(firstGift ? { giftAmount: `$${Number(firstGift.amount).toLocaleString()}` } : {}),
      ...(Number(donors[0].total_giving) > 0 ? { totalGiving: `$${Number(donors[0].total_giving).toLocaleString()}` } : {}) } : null,
    // Who the segment holds and this send will not reach, by reason, with the
    // first names of each so "3 left out" opens onto people, not a number.
    leftOutCount: aud.leftOutCount,
    leftOut: aud.leftOut.map(g => ({
      reason: g.reason, count: g.count,
      people: g.people.slice(0, 25).map(d => ({ id: d.id, name: displayNameCase(d.name || "") })),
    })),
    // The organisation itself sends no mail (the demonstration org, or mail
    // switched off): nobody gets it, said once rather than per person.
    orgSends: !!(aud.orgGate && aud.orgGate.send),
    orgReason: aud.orgGate && !aud.orgGate.send ? aud.orgGate.reason : null,
    // EDITOR-1 · ONE LINE THAT ADDS UP. Everyone in the segment is either
    // somebody this email can reach now or in exactly one group that says why
    // not; while Donor mail is off (or this is the demonstration org) the
    // people it would reach are that group. The Send button reads `wouldReach`
    // and is never live while `sendable` is 0, with `blocked` as its reason.
    audience: await audienceLine(orgId, aud, noun, req),
  });
}));

const AUDIENCE_WORDS = {
  no_email: n => `${n === 1 ? "has" : "have"} no email address`,
  auto_email_off: n => `${n === 1 ? "has" : "have"} automatic email off`,
  // TRUST-1: SEND-GATE-2's reasons, as a campaign now reads them.
  donor_never: () => "set to Never", not_chosen: () => "not chosen for campaign emails",
  type_off: () => "wait until Campaign emails are on", skipped: () => "skipped for campaign emails",
  deceased: () => "deceased", do_not_contact: () => "marked do not contact",
  unsubscribed: n => `${n === 1 ? "has" : "have"} unsubscribed`, unsubscribe: n => `${n === 1 ? "has" : "have"} unsubscribed`,
  bounced: n => `${n === 1 ? "has an address that bounced" : "have addresses that bounced"}`,
  complained: n => `marked a past email as spam`, blocked_address: () => "on the list Steward never mails",
  sample_donor: () => "sample records, not real people",
};
async function audienceLine(orgId, aud, noun, req = null) {
  const [o] = await query("SELECT name FROM orgs WHERE id=?", [orgId]);
  const orgName = displayNameCase(await donorFacingOrgName(orgId, (o && o.name) || "").catch(() => (o && o.name) || ""));
  const groups = aud.leftOut.map(g => ({ reason: g.reason, count: g.count,
    sentence: `${g.count.toLocaleString()} ${(AUDIENCE_WORDS[g.reason] || (() => `can't get it (${g.reason.replace(/_/g, " ")})`))(g.count)}`,
    people: g.people.slice(0, 25).map(d => ({ id: d.id, name: displayNameCase(d.name || "") })) }));
  const wouldReach = aud.recipients.length;
  const off = !(aud.orgGate && aud.orgGate.send);
  const offReason = off ? aud.orgGate.reason : null;
  const orgs = /s$/i.test(orgName) ? `${orgName}'` : `${orgName}'s`;
  const offWords = offReason === "demo_org" ? "can't get email: nothing is sent from the demonstration organization"
    : offReason === "not_onboarded" ? `can't get email until ${orgs} donor file is in`
    : `can't get email while Donor mail is off for ${orgName}`;
  if (off && wouldReach) groups.push({ reason: "org_" + (offReason || "off"), count: wouldReach, sentence: `${wouldReach.toLocaleString()} ${offWords}`,
    people: aud.recipients.slice(0, 25).map(d => ({ id: d.id, name: displayNameCase(d.name || "") })) });
  const sendable = off ? 0 : wouldReach;
  const total = sendable + groups.reduce((n, g) => n + g.count, 0);
  const blocked = off ? (offReason === "demo_org" ? "Nothing is sent from the demonstration organization."
      : offReason === "not_onboarded" ? `Email turns on once ${orgs} donor file is in.`
      : `Donor mail is off for ${orgName}, so nothing is sent until it is turned on.`)
    : sendable === 0 && groups.some(g => g.reason === "type_off") ? "Campaign emails are off, so this campaign waits until they are turned on in Settings, Automatic email."
    : sendable === 0 ? (total ? "Nobody in this group can get this email." : "Nobody is in this group yet.") : null;
  // COMMS-1: where the audience waits on Campaign emails, say where they are turned on.
  const TURN = require("./campaignTurnOn");
  const turnOn = TURN.turnOnNote({ off: groups.some(g => g.reason === "type_off"), isAdmin: TURN.isAdminReq(req) });
  return {
    total, sendable, wouldReach, blocked, groups, noun, turnOn,
    line: `${total.toLocaleString()} ${noun} \u00b7 ${sendable.toLocaleString()} can get this email${groups.length ? ": " + groups.map(g => g.sentence).join(" \u00b7 ") : ""}.`,
  };
}

// EDITOR-1 · A CAMPAIGN'S HISTORY: every save, approval, schedule and send of
// it, from the one audit trail (middleware/auditTrail.js), newest first. Reading only.
app.get("/campaigns/:id/history", requireAuth, wrap(async (req, res) => {
  const [c] = await query("SELECT id FROM campaigns WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!c) return res.status(404).json({ error: "Campaign not found" });
  const rows = await query(`SELECT id, created_at, user_name, actor_kind, request_method, request_path FROM fin_audit_log
                             WHERE org_id=? AND entity_id=? AND request_path LIKE '/campaigns%' ORDER BY created_at DESC LIMIT 50`, [req.user.orgId, c.id]).catch(() => []);
  const what = r => { const p = String(r.request_path || "");
    return /\/send$/.test(p) ? "Sent" : /\/test$/.test(p) ? "Sent a test" : /\/(request-approval)$/.test(p) ? "Asked for approval" : /\/approve$/.test(p) ? "Approved"
      : /\/(unapprove|withdraw-approval)$/.test(p) ? "Approval taken back" : r.request_method === "POST" ? "Started" : "Saved"; };
  res.json({ versions: rows.map(r => ({ id: r.id, at: r.created_at, byName: r.user_name || (r.actor_kind === "system" ? "Steward" : "someone on your team"), what: what(r) })) });
}));

// POLISH-3 · WHAT ELEANOR WILL SEE. A template campaign's preview is the
// send's own render (emailCompose.render on the campaign's blocks, with one
// real person's fields and the real footer), for the person the composer
// names: the first on the list, or whoever it asks for. It used to show
// campaigns.body, a snapshot taken when the campaign was made, which the demo's
// seeded campaign never had, so the right of the screen was blank. Reading
// only: nothing is written and nothing is sent.
app.post("/campaigns/:id/preview", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [campaign] = await query("SELECT * FROM campaigns WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!campaign) return res.status(404).json({ error: "Campaign not found" });
  if (!emailCompose.hasBlocks(campaign)) return res.status(400).json({ error: "not_from_template", sentence: "This campaign is written in the editor, not built from a template." });
  let donor = null;
  const wanted = req.body && req.body.donorId ? String(req.body.donorId) : null;
  if (wanted) [donor] = await query("SELECT * FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [wanted, orgId]);
  if (!donor) {
    const seg = req.body && req.body.segment && typeof req.body.segment === "object" ? JSON.stringify(req.body.segment) : campaign.segment;
    const aud = await campaignAudience({ segment: seg }, orgId).catch(() => ({ recipients: [] }));
    donor = aud.recipients[0] || null;
  }
  const ctx = await emailCompose.orgRenderContext(orgId);
  const fields = donor
    ? await emailCompose.personFields(ctx, donor, { campaignName: campaign.name || "" })
    : emailCompose.sampleFields(ctx, { name: "", email: "", campaignName: campaign.name || "" });
  const r = await emailCompose.render(ctx, { blocks: campaign.email_blocks, subject: campaign.subject, preheader: campaign.preheader, fields, mode: "send" });
  const footer = await unsubscribeEmailFooterHtml((donor && donor.email) || "you@example.org", orgId, "campaign");
  // A copy the send would refuse still shows, drawn the way the template
  // editor draws it, with what to fix said beside it.
  const shown = r.problems.length
    ? await emailCompose.render(ctx, { blocks: campaign.email_blocks, subject: campaign.subject, preheader: campaign.preheader, fields, mode: "preview" })
    : r;
  const html = emailCompose.withFooter(shown, footer, "") || shown.html;
  res.json({
    html, problems: r.problems, sentence: r.problems.length ? emailCompose.refusalSentence(r.problems) : null,
    subject: await emailCompose.subjectFor(campaign.subject, fields),
    person: donor ? { id: donor.id, name: displayNameCase(donor.name || "") } : null,
  });
}));

// POLISH-3 · BACK TO CAMPAIGN. A campaign keeps its own copy of the template's
// blocks (so a scheduled send sends what it holds). When she opened the
// template from this campaign to change its words, coming back takes the
// template's words into the campaign. Only a campaign that has not gone; an
// approval covers the words approved, exactly as an edit through PUT does.
app.post("/campaigns/:id/take-template", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [c] = await query("SELECT * FROM campaigns WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!c) return res.status(404).json({ error: "Campaign not found" });
  if (!c.template_id || !emailCompose.hasBlocks(c)) return res.status(400).json({ error: "not_from_template" });
  if (!["draft", "scheduled", "awaiting_approval"].includes(c.status)) return res.status(409).json({ error: "already_sent", sentence: "This campaign has gone, so its words stay as they were sent." });
  const t = await emailCompose.templateFor(orgId, c.template_id);
  if (!t) return res.status(404).json({ error: "template_not_found" });
  const blocks = emailCompose.toArray(t.blocks);
  const same = JSON.stringify(blocks) === JSON.stringify(emailCompose.toArray(c.email_blocks))
    && (t.subject || "") === (c.subject || "") && (t.preheader || "") === (c.preheader || "");
  if (!same) {
    const [meRole] = await query("SELECT role FROM users WHERE id=?", [req.user.userId]);
    const reapprove = !!c.approved_at && !(meRole && meRole.role === "admin");
    await run(`UPDATE campaigns SET email_blocks=?::jsonb, subject=?, preheader=?, updated_at=NOW()${reapprove ? ", status='awaiting_approval', approved_at=NULL, approved_by=NULL, approved_by_name=NULL" : ""} WHERE id=? AND org_id=?`,
      [JSON.stringify(blocks), t.subject || "", t.preheader || "", c.id, orgId]);
  }
  const [row] = await query("SELECT * FROM campaigns WHERE id=?", [c.id]);
  res.json({ campaign: row, changed: !same });
}));

// SEND ME A TEST — one copy, to the person pressing the button, under whatever
// sending identity is in force. It is not a recipient: no `campaign_recipients`
// row, no interaction on anybody's record, and the campaign's own count does
// not move. A test that counted would make every campaign's numbers wrong by
// one, forever.
app.post("/campaigns/:id/test", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [campaign] = await query("SELECT * FROM campaigns WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!campaign) return res.status(404).json({ error: "Campaign not found" });
  const [me] = await query("SELECT email, name FROM users WHERE id=? AND org_id=?", [req.user.userId, orgId]);
  const to = String(req.body?.to || me?.email || "").trim();
  if (!to) return res.status(400).json({ error: "No address to send the test to." });
  if (to !== me?.email) return res.status(403).json({ error: "test_to_self",
    message: "A test goes to you. Sending a draft to somebody else is a send, and it belongs on the campaign." });

  const T = await templatesMod();
  const [org] = await query("SELECT * FROM orgs WHERE id=?", [orgId]);
  const first = String(me?.name || "").trim().split(/\s+/)[0] || "Margaret";
  const testNote = `<div style="margin-top:28px;padding-top:14px;border-top:1px solid #e5e0d5;font-family:'DM Sans',Helvetica,Arial,sans-serif;font-size:12px;color:#8fa896;">
         This is a test of "${escapeHtml(campaign.name || "")}". Nobody else received it, and it is not counted.
       </div>`;
  // EMAIL-1 — a template campaign's test is rendered exactly as the send
  // renders it, with her own name in it and the real footer where the
  // renderer left its slot. A copy the send would refuse is refused here too.
  let blocksHtml = null;
  let testSubject = campaign.subject || campaign.name || "";
  if (emailCompose.hasBlocks(campaign)) {
    const ctx = await emailCompose.orgRenderContext(orgId);
    const r = await emailCompose.render(ctx, {
      blocks: campaign.email_blocks, subject: campaign.subject, preheader: campaign.preheader,
      fields: emailCompose.sampleFields(ctx, { name: me?.name || "", email: to, campaignName: campaign.name || "" }),
      mode: "send" });
    if (r.problems.length) return res.status(400).json({ error: "email_not_ready", message: emailCompose.refusalSentence(r.problems), problems: r.problems });
    blocksHtml = emailCompose.withFooter(r, await unsubscribeEmailFooterHtml(to, orgId, "campaign") + testNote, "");
    testSubject = await emailCompose.subjectFor(campaign.subject, emailCompose.sampleFields(ctx, { name: me?.name || "", email: to }));
  }
  const html = blocksHtml || await brandEmailHeaderHtml(orgId)
    + T.renderMergeFields(campaign.body || "", {
        first_name: first, donor_name: me?.name || first, greeting: first,
        org_name: displayNameCase(org?.name || ""), gift_amount: "$250", total_giving: "$4,150",
        year: String(new Date().getUTCFullYear()),
      })
    + testNote;
  const identity = await orgSendingIdentity(orgId);
  let delivered = false;
  if (process.env.RESEND_API_KEY) {
    try {
      const { error } = await resend.emails.send({
        from: identity.from, ...(identity.replyTo ? { replyTo: identity.replyTo } : {}),
        to, subject: `[Test] ${testSubject}`,
        _stewardOrgId: orgId, _stewardKind: "campaign_test",   // MAIL-1: waits for onboarding like the campaign
        html: blocksHtml ? html : T.renderMergeFields(html, { first_name: first }),
      });
      if (error) throw new Error(error.message);
      delivered = true;
    } catch (e) {
      console.error("[campaign] test send failed:", e.message);
      return res.status(502).json({ error: "send_failed", message: "The test could not be sent just now. Nothing about the campaign changed." });
    }
  }
  res.json({ sent: delivered, to, from: identity.from, verified: identity.verified, counted: false });
}));

// ── EMAIL-1 · WAITING FOR APPROVAL ────────────────────────────────────────
// Somebody writes a campaign and asks an admin to approve it. While it waits
// its status is `awaiting_approval`, which the scheduler never picks up (it
// reads status='scheduled' only). Approving stamps who and when and makes it
// `scheduled`; with no send time it waits as an approved draft. Undo is
// /unapprove, back to waiting.
async function campaignForApproval(req, res) {
  const [c] = await query("SELECT * FROM campaigns WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!c) { res.status(404).json({ error: "Campaign not found" }); return null; }
  return c;
}

app.post("/campaigns/:id/request-approval", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const c = await campaignForApproval(req, res); if (!c) return;
  if (!["draft", "scheduled"].includes(c.status)) {
    return res.status(400).json({ error: "not_a_draft", message: "Only a draft or a scheduled campaign can be sent for approval." });
  }
  const pre = await emailCompose.campaignPreflight(c, req.user.orgId);
  if (!pre.ok) return res.status(400).json({ error: "email_not_ready", message: pre.message, problems: pre.problems });
  await run(
    `UPDATE campaigns SET status='awaiting_approval', approved_at=NULL, approved_by=NULL, approved_by_name=NULL, updated_at=NOW()
      WHERE id=? AND org_id=? AND status IN ('draft','scheduled')`, [c.id, req.user.orgId]);
  req.audit.entity("campaign", c.id, c.name);
  req.audit.action("asked for approval");
  res.json({ ok: true, status: "awaiting_approval", previousStatus: c.status,
    sentence: `${c.name || "The campaign"} is waiting for an admin to approve it. It will not go before then.` });
}));

// Undo of a request: back to a draft (or to scheduled, if that is where it was
// and the caller is an admin, whose scheduling needs nobody's approval).
app.post("/campaigns/:id/withdraw-approval", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const c = await campaignForApproval(req, res); if (!c) return;
  if (c.status !== "awaiting_approval") return res.status(400).json({ error: "not_waiting", message: "That campaign is not waiting for approval." });
  const [me] = await query("SELECT role FROM users WHERE id=?", [req.user.userId]);
  const back = req.body && req.body.status === "scheduled" && me && me.role === "admin" && c.scheduled_at ? "scheduled" : "draft";
  await run("UPDATE campaigns SET status=?, updated_at=NOW() WHERE id=? AND org_id=? AND status='awaiting_approval'",
    [back, c.id, req.user.orgId]);
  res.json({ ok: true, status: back, sentence: back === "draft" ? "Back to a draft." : "Back to scheduled." });
}));

app.post("/campaigns/:id/approve", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const c = await campaignForApproval(req, res); if (!c) return;
  if (c.status !== "awaiting_approval") return res.status(400).json({ error: "not_waiting", message: "That campaign is not waiting for approval." });
  const pre = await emailCompose.campaignPreflight(c, req.user.orgId);
  if (!pre.ok) return res.status(400).json({ error: "email_not_ready", message: pre.message, problems: pre.problems });
  const nextStatus = c.scheduled_at ? "scheduled" : "draft";
  const who = actor(req);
  const [me] = await query("SELECT name FROM users WHERE id=? AND org_id=?", [req.user.userId, req.user.orgId]);
  await run(
    `UPDATE campaigns SET status=?, approved_at=NOW(), approved_by=?, approved_by_name=?, updated_at=NOW()
      WHERE id=? AND org_id=? AND status='awaiting_approval'`,
    [nextStatus, who.id, (me && me.name) || who.name, c.id, req.user.orgId]);
  req.audit.entity("campaign", c.id, c.name);
  req.audit.action("approved the campaign");
  const when = c.scheduled_at ? new Date(c.scheduled_at) : null;
  res.json({ ok: true, status: nextStatus,
    sentence: !when ? "Approved. It has no send time, so it waits as a draft until somebody sends it."
      : when <= new Date() ? "Approved. Its send time has passed, so it goes out within five minutes."
      : "Approved. It goes out at its scheduled time." });
}));

app.post("/campaigns/:id/unapprove", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const c = await campaignForApproval(req, res); if (!c) return;
  if (!c.approved_at || !["scheduled", "draft"].includes(c.status)) {
    return res.status(400).json({ error: "not_approved", message: "That campaign is not approved, or it has already started sending." });
  }
  await run(
    `UPDATE campaigns SET status='awaiting_approval', approved_at=NULL, approved_by=NULL, approved_by_name=NULL, updated_at=NOW()
      WHERE id=? AND org_id=? AND status IN ('scheduled','draft')`, [c.id, req.user.orgId]);
  req.audit.entity("campaign", c.id, c.name);
  req.audit.action("took back the approval");
  res.json({ ok: true, status: "awaiting_approval", sentence: "The approval is taken back. It is waiting again." });
}));
app = routers.r1;

// ── ENGAGE-1 §4 — APPEAL-WHY: "How did it do?" ─────────────────────────────
// This campaign against the comparable one a year earlier: the totals, the
// ranked reasons (each a number that opens its rows, figure source appeal-why)
// and who to call. Planning a follow-up is the existing POST
// /donors/:id/threads: it opens a step, it sends nothing.
app.get("/campaigns/:id/how-did-it-do", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const AW = require("../../appealWhy");
  const c = await AW.campaignRow(orgId, req.params.id);
  if (!c) return res.status(404).json({ error: "Not found" });
  const { compare, how, candidates } = await AW.comparableFor(orgId, c);
  if (!compare) return res.json({ campaign: { id: c.id, name: c.name }, compare: null, candidates,
    sentence: "There is no campaign from a year earlier to compare this with. Choose one and the comparison appears." });
  const P = await AW.parts(orgId, c.id, compare.id);
  const src = part => ({ key: "appeal-why", params: { campaign: c.id, compare: compare.id, part } });
  const side = (gifts, newcomers, returning, lapsed) => ({ ...AW.summary(gifts), newDonors: newcomers, returning, lapsed });
  const thisSide = side(P.this, P.newcomers.length, P.returning.length, P.notYet.length);
  const lastSide = { ...AW.summary(P.last) };
  const reasons = [
    { key: "notYet", label: "Last year's donors who have not given yet", people: P.notYet.length, cents: AW.sumC(P.notYet), words: "gave last time" },
    { key: "less", label: "Gave less than last year", people: P.less.length, cents: AW.sumC(P.less), words: "against last time" },
    { key: "more", label: "Gave more than last year", people: P.more.length, cents: AW.sumC(P.more), words: "more than last time" },
    { key: "newcomers", label: "New donors", people: P.newcomers.length, cents: AW.sumC(P.newcomers), words: "from people new to you" },
  ].map(r => ({ ...r, source: src(r.key) }))
   // RANKED by how much money each reason moved, either way.
   .sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents));
  // WHO TO CALL: last year's donors not back yet, ranked half by what they gave
  // last time (where it stands among them) and half by engagement.
  const pool = P.notYet;
  const sortedGift = pool.map(x => x.lastCents).sort((a, b) => a - b);
  const giftPct = v => sortedGift.length ? (100 * (sortedGift.filter(y => y < v).length + sortedGift.filter(y => y === v).length / 2)) / sortedGift.length : 0;
  const whoToCall = pool.map(x => ({ donorId: x.donor_id, name: x.name, lastGiftCents: x.lastCents, engagement: x.engagement, lastTouch: x.date,
      rank: Math.round(giftPct(x.lastCents) / 2 + x.engagement / 2) }))
    .sort((a, b) => b.rank - a.rank || b.lastGiftCents - a.lastGiftCents).slice(0, 25);
  res.json({
    campaign: { id: c.id, name: c.name }, compare: { id: compare.id, name: compare.name, how }, candidates,
    this: { ...thisSide, source: src("this") }, last: { ...lastSide, source: src("last") },
    reasons, whoToCall,
    whoToCallSentence: "Last year's donors who have not given to this campaign yet, ranked half by what they gave last time and half by engagement. Planning a follow-up opens a step on their Thread; nothing is sent.",
  });
}));
app.put("/campaigns/:id/compare", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [c] = await query("SELECT * FROM campaigns WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!c) return res.status(404).json({ error: "Not found" });
  const want = req.body?.compareId ? String(req.body.compareId) : null;
  if (want) {
    const [o] = await query("SELECT id FROM campaigns WHERE id=? AND org_id=? AND id<>?", [want, orgId, c.id]);
    if (!o) return res.status(400).json({ error: "Choose another of your campaigns." });
  }
  if (req.audit) req.audit.before({ compare_campaign_id: c.compare_campaign_id || null });
  await run("UPDATE campaigns SET compare_campaign_id=? WHERE id=? AND org_id=?", [want, c.id, orgId]);
  if (req.audit) req.audit.after({ compare_campaign_id: want });
  res.json({ ok: true, compareId: want });
}));

// ── Campaigns ──────────────────────────────────────────────────────────────
// BUILD-94 Part 4 — "send it at 9:00 on Thursday" is a wall-clock time IN THE
// ORGANISATION's zone. A datetime-local input carries no zone, and handing the
// raw string to a timestamptz column makes Postgres read it in the SERVER's
// zone: 9:00 typed in Chicago was stored as 9:00 UTC and went out at 4 in the
// morning. The conversion happens HERE, server-side, so every write path gets
// it — a client that forgets is a client that schedules at the wrong hour.
// EDITOR-1 · A CAMPAIGN'S OWN EMAIL, AS BLOCKS. The editor writes a
// campaign's words as blocks (the same blocks a template is), checked by the
// one validator. Returns { ok, blocks } or { ok:false, sentence }.
async function campaignBlocksFrom(raw) {
  if (!Array.isArray(raw)) return { ok: false, sentence: "The email's blocks are missing." };
  const B = await emailCompose.blocksMod();
  const PW = await import("../../shared/pageWidgets.js");
  const v = B.validateEmailBlocks(raw, PW.typesForSurface("email"));
  return v.ok ? { ok: true, blocks: v.blocks } : { ok: false, sentence: v.error };
}
// A time to send that has already gone is refused, never taken as "now".
async function pastSchedule(orgId, raw) {
  if (!raw) return false;
  const at = await scheduledInstant(orgId, raw);
  return !at || at.getTime() <= Date.now();
}
async function scheduledInstant(orgId, raw) {
  if (!raw) return null;
  // An explicit instant (a Z or an offset) is already unambiguous — honoured
  // as sent, so an API caller can still be exact.
  if (/[Zz]$|[+-]\d{2}:?\d{2}$/.test(String(raw).trim())) return new Date(raw);
  const tz = await orgTzName(orgId);
  return orgTime.localToInstant(raw, tz) || null;      // ORG_TZ_SEAM_OK
}

app.get("/campaigns", requireAuth, wrap(async (req, res) => {
  const campaigns = await query(
    "SELECT * FROM campaigns WHERE org_id = ? ORDER BY created_at DESC",
    [req.user.orgId]
  );
  const result = await Promise.all(campaigns.map(async c => {
    const recipients = await query(
      `SELECT cr.id, cr.email, cr.sent_at, cr.opened_at, cr.failure_reason, d.name as donor_name, d.id AS donor_id
       FROM campaign_recipients cr
       LEFT JOIN donors d ON d.id = cr.donor_id AND d.org_id = cr.org_id AND d.deleted_at IS NULL
       WHERE cr.campaign_id = ? ORDER BY cr.created_at DESC`,
      [c.id]
    );
    return { ...c, recipients };
  }));
  // SECURE-2: each one says what it actually did (campaignDelivery.js).
  res.json(await require("../../campaignDelivery").withDelivery(req.user.orgId, result));
}));

// ── BUILD-94 Part 4 — THE SENT-CAMPAIGNS LIST ──────────────────────────────
// The two things she will look for on day one: what went, and what came back.
// COUNTS ONLY. Steward stores an open per recipient (it has since BUILD-06, to
// compute the rate), and NOTHING per-person reaches a profile — no "Margaret
// opened this at 6:41am" anywhere in the product. That is a decision, not an
// omission, and it is written down in steward-data-handling.md; changing it is
// a data-handling change and a line in the customer agreement.
app.get("/campaigns/sent", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const rows = await query(
    `SELECT c.id, c.name, c.subject, c.status, c.sent_at, c.scheduled_at, c.created_at,
            COUNT(cr.id)::int                                          AS recipients,
            COUNT(cr.sent_at)::int                                     AS delivered,
            COUNT(cr.opened_at)::int                                   AS opened,
            COUNT(cr.failure_reason)::int                              AS failed
       FROM campaigns c
       LEFT JOIN campaign_recipients cr ON cr.campaign_id = c.id
      WHERE c.org_id = ? AND c.status IN ('sent','sending','scheduled','failed','awaiting_approval')
      GROUP BY c.id ORDER BY COALESCE(c.sent_at, c.scheduled_at, c.created_at) DESC
      LIMIT 100`, [orgId]);
  // Unsubscribes attributable to a campaign: a suppression for one of ITS
  // recipients, written AFTER it went. Attribution by time and audience rather
  // than a foreign key, because a person unsubscribes from an organisation,
  // not from a campaign — the campaign is only what made them reach for it.
  const out = [];
  for (const c of rows) {
    let unsubscribed = 0;
    if (c.sent_at) {
      const [u] = await query(
        `SELECT COUNT(DISTINCT s.email)::int AS n FROM email_suppressions s
          WHERE s.org_id = ? AND s.reason = 'unsubscribed' AND s.created_at >= ?
            AND LOWER(s.email) IN (SELECT LOWER(email) FROM campaign_recipients WHERE campaign_id = ?)`,
        [orgId, c.sent_at, c.id]);
      unsubscribed = u ? u.n : 0;
    }
    out.push({ ...c, unsubscribed,
      openRate: c.delivered ? Math.round((c.opened / c.delivered) * 100) : null });
  }
  res.json({ campaigns: await require("../../campaignDelivery").withDelivery(orgId, out) });
}));

app.get("/campaigns/:id", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    "SELECT * FROM campaigns WHERE id = ? AND org_id = ?",
    [req.params.id, req.user.orgId]
  );
  if (!rows.length) return res.status(404).json({ error: "Not found" });
  const recipients = await query(
    `SELECT cr.id, cr.email, cr.sent_at, cr.opened_at, cr.failure_reason, d.name as donor_name, d.id AS donor_id
     FROM campaign_recipients cr
     LEFT JOIN donors d ON d.id = cr.donor_id AND d.org_id = cr.org_id AND d.deleted_at IS NULL
     WHERE cr.campaign_id = ? ORDER BY cr.created_at DESC`,
    [rows[0].id]
  );
  const [delivered] = await require("../../campaignDelivery").withDelivery(req.user.orgId, [rows[0]]);
  res.json({ ...delivered, recipients });
}));

app.post("/campaigns", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { name, type, subject, body, segment, scheduledAt } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });
  if (scheduledAt && await pastSchedule(req.user.orgId, scheduledAt))
    return res.status(400).json({ error: "schedule_in_past", sentence: "That time has already gone. Pick a time from now on, or leave it empty and send it yourself." });
  let blocks = null;
  if (req.body.emailBlocks !== undefined && req.body.emailBlocks !== null) {
    const v = await campaignBlocksFrom(req.body.emailBlocks);
    if (!v.ok) return res.status(400).json({ error: "invalid_blocks", sentence: v.sentence });
    blocks = v.blocks;
  }

  const id = newId("cmp");
  await run(
    `INSERT INTO campaigns (id,org_id,name,type,subject,body,status,segment,scheduled_at,recipient_count,open_count,created_by,created_by_name)
     VALUES (?,?,?,?,?,?,?,?,?,0,0,?,?)`,
    [id, req.user.orgId, name, type || "appeal", subject || "", body || "",
     scheduledAt ? "scheduled" : "draft", JSON.stringify(segment || {}),
     await scheduledInstant(req.user.orgId, scheduledAt), actor(req).id, actor(req).name]
  );
  if (blocks) await run("UPDATE campaigns SET email_blocks=?::jsonb, preheader=? WHERE id=? AND org_id=?",
    [JSON.stringify(blocks), String(req.body.preheader || "").slice(0, 300), id, req.user.orgId]);
  await markStarterReviewed(req, req.body.starterKey, body, id).catch(e => console.error("[campaigns] starter review:", e.message));
  const rows = await query("SELECT * FROM campaigns WHERE id = ?", [id]);
  res.status(201).json(rows[0]);
}));

app.put("/campaigns/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { name, type, subject, body, segment, status, scheduledAt } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });

  const existing = await query(
    "SELECT * FROM campaigns WHERE id = ? AND org_id = ?",
    [req.params.id, req.user.orgId]
  );
  if (!existing.length) return res.status(404).json({ error: "Campaign not found" });
  if (!["draft", "scheduled", "awaiting_approval"].includes(existing[0].status))
    return res.status(400).json({ error: "Only draft, scheduled or waiting campaigns can be edited" });
  if (scheduledAt && status === "scheduled" && await pastSchedule(req.user.orgId, scheduledAt))
    return res.status(400).json({ error: "schedule_in_past", sentence: "That time has already gone. Pick a time from now on, or leave it empty and send it yourself." });
  let newBlocks = null;
  if (Array.isArray(req.body.emailBlocks)) {
    const v = await campaignBlocksFrom(req.body.emailBlocks);
    if (!v.ok) return res.status(400).json({ error: "invalid_blocks", sentence: v.sentence });
    newBlocks = v.blocks;
  }

  // EMAIL-1 — AN APPROVAL COVERS THE WORDS THAT WERE APPROVED. A campaign that
  // is waiting stays waiting whatever status the composer sends, and one that
  // was approved goes back to waiting when somebody who is not an admin
  // changes it. An admin's own edit needs nobody's approval.
  const ex = existing[0];
  const [meRole] = await query("SELECT role FROM users WHERE id=?", [req.user.userId]);
  const isAdminEditor = !!(meRole && meRole.role === "admin");
  const wordsChanged = (subject || "") !== (ex.subject || "") || (body || "") !== (ex.body || "")
    || req.body.emailBlocks !== undefined;
  let nextStatus = status || "draft";
  let clearApproval = false;
  if (ex.status === "awaiting_approval" && !(isAdminEditor && nextStatus === "draft")) nextStatus = "awaiting_approval";
  if (ex.approved_at && !isAdminEditor && wordsChanged) { nextStatus = "awaiting_approval"; clearApproval = true; }
  if (nextStatus !== "awaiting_approval" && !["draft", "scheduled"].includes(nextStatus)) nextStatus = "draft";

  await run(
    `UPDATE campaigns SET name=?,type=?,subject=?,body=?,segment=?,status=?,scheduled_at=?,updated_at=NOW()
     WHERE id=? AND org_id=?`,
    [name, type || "appeal", subject || "", body || "",
     JSON.stringify(segment || {}), nextStatus,
     await scheduledInstant(req.user.orgId, scheduledAt),
     req.params.id, req.user.orgId]
  );
  if (clearApproval) {
    await run("UPDATE campaigns SET approved_at=NULL, approved_by=NULL, approved_by_name=NULL WHERE id=? AND org_id=?",
      [req.params.id, req.user.orgId]);
  }
  // A template campaign's words are its blocks. `emailBlocks: null` lets it go
  // and the campaign becomes an ordinary one whose words are `body`; a preheader
  // edit rides along.
  if (req.body.emailBlocks === null) {
    await run("UPDATE campaigns SET email_blocks=NULL, template_id=NULL WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  }
  // EDITOR-1: the editor's blocks are the campaign's own words (it keeps its
  // own copy, as a template campaign always has).
  if (newBlocks) await run("UPDATE campaigns SET email_blocks=?::jsonb WHERE id=? AND org_id=?", [JSON.stringify(newBlocks), req.params.id, req.user.orgId]);
  if (typeof req.body.preheader === "string") {
    await run("UPDATE campaigns SET preheader=? WHERE id=? AND org_id=?", [req.body.preheader.slice(0, 300), req.params.id, req.user.orgId]);
  }
  await markStarterReviewed(req, req.body.starterKey, body, req.params.id).catch(e => console.error("[campaigns] starter review:", e.message));
  const rows = await query("SELECT * FROM campaigns WHERE id = ?", [req.params.id]);
  res.json(rows[0]);
}));

app.delete("/campaigns/:id", requireAuth, requireAdmin, wrap(async (req, res) => {
  // BUILD-56 — a deleted campaign's hero drops to refcount zero: prune it
  // into the retention window (it used to linger live but unreachable) and
  // record the pointer removal.
  const [ex] = await query("SELECT hero_image_url FROM campaigns WHERE id = ? AND org_id = ?", [req.params.id, req.user.orgId]);
  if (!ex) return res.status(404).json({ error: "Not found" }); // BUILD-75 B: a foreign/unknown id answers 404, never a false success — one answer everywhere
  const undoId = await trashRow("campaigns", req.params.id, req);
  if (!undoId) return res.status(404).json({ error: "Not found" });
  if (ex?.hero_image_url) {
    await pruneCampaignAssets(req.user.orgId);
    await recordAssetPointerHistory(req.user.orgId, "campaign.hero", req.params.id, ex.hero_image_url, null, req.user);
  }
  res.json({ success: true, deleted: 1, undoId, undoSeconds: UNDO_SECONDS });
}));

app.put("/campaigns/:id/briefing", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { briefing, goal_amount, start_date, end_date } = req.body;
  const existing = await query("SELECT id FROM campaigns WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!existing.length) return res.status(404).json({ error: "Campaign not found" });
  await run(
    `UPDATE campaigns SET briefing=?,goal_amount=?,start_date=?,end_date=?,updated_at=NOW() WHERE id=? AND org_id=?`,
    [briefing||null, goal_amount||null, start_date||null, end_date||null, req.params.id, req.user.orgId]
  );
  const rows = await query("SELECT id,name,briefing,goal_amount,start_date,end_date,status FROM campaigns WHERE id=?", [req.params.id]);
  res.json(rows[0]);
}));

app.get("/campaigns/:id/progress", requireAuth, wrap(async (req, res) => {
  const rows = await query("SELECT * FROM campaigns WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!rows.length) return res.status(404).json({ error: "Campaign not found" });
  const c = rows[0];
  // Same raised definition as fundraisingCampaignRows (one definition):
  // gift payments at the full amount paid (FIX-49) + awarded grants; open pledges
  // are a SEPARATE pledged figure, never summed into raised.
  const [giftSum, pledgeSum, grantSum] = await Promise.all([
    query(
      `SELECT COALESCE(SUM(g.amount),0) as total, COUNT(DISTINCT g.donor_id) FILTER (WHERE g.amount > 0) as donor_count
         FROM campaigns c JOIN gifts g ON g.org_id = c.org_id AND ${CAMPAIGN_GIFT_MATCH("g", "c")}
        WHERE c.org_id=? AND c.id=?`,
      [req.user.orgId, c.id]
    ),
    // F-5: pledged = honest REMAINING balance (amount − payments already
    // linked via gifts.pledge_id), so a partially-paid pledge counts only
    // what is still committed-but-unpaid.
    query(
      `SELECT COALESCE(SUM(p.amount - COALESCE(pp.paid,0)),0) AS total
       FROM pledges p
       LEFT JOIN ${require("../../shared/numbers/pledges").PAID_BY_PLEDGE} pp ON pp.pledge_id=p.id
       WHERE p.org_id=? AND p.campaign_id=? AND p.status='open' AND ${NOT_DELETED("p")}`,
      [req.user.orgId, req.user.orgId, c.id]),
    query(`SELECT COALESCE(SUM(amount),0) AS total FROM grants WHERE org_id=? AND campaign_id=? AND awarded_at IS NOT NULL`, [req.user.orgId, c.id]),
  ]);
  const grantAwarded = parseFloat(grantSum[0]?.total || 0);
  const raised = parseFloat(giftSum[0]?.total || 0) + grantAwarded;
  const donorCount = parseInt(giftSum[0]?.donor_count || 0);
  const daysRemaining = c.end_date ? Math.ceil((new Date(c.end_date) - new Date()) / 86400000) : null;
  res.json({
    goal: parseFloat(c.goal_amount || 0),
    raised,
    grantAwarded,
    pledged: parseFloat(pledgeSum[0]?.total || 0),
    donorCount,
    daysRemaining,
    startDate: c.start_date,
    endDate: c.end_date,
    briefing: c.briefing || "",
  });
}));

// Segment → recipient list. Shared by the manual send route and the
// scheduled-campaign job (BUILD-06 Phase C) so both resolve audiences
// identically. Note the predicates read d.stage — the DB column — matching
// what the client's SegmentPicker previews (fixed same pass; it read a
// nonexistent d.pipeline_stage and showed 0 for stage segments).
// ── BUILD-97 — AUDIENCES: THE THINGS WITH NAMES ───────────────────────────
// The registry is shared/audiences.js so the rail and the resolver cannot
// disagree about what exists. Loaded through the depositMod() convention
// rather than a top-level .then that assigns a module-scope binding — that
// leaves a window at boot where the list is empty and every audience is
// unknown (the BUILD-95 §5B part 1 lesson).
let _audMod = null;
async function audienceMod() {
  if (!_audMod) _audMod = await import("../../shared/audiences.js");
  return _audMod;
}

// ONE donor query, every audience counted off it. See filterBySegment.
async function audienceRoster(orgId) {
  const A = await audienceMod();
  const donors = await query(
    "SELECT * FROM donors WHERE org_id = ? AND email IS NOT NULL AND email != '' AND deleted_at IS NULL",
    [orgId]);
  const saved = await query(
    "SELECT id, name, description, segment, created_at, kind, rules FROM audiences WHERE org_id=? ORDER BY LOWER(name)",
    [orgId]).catch(() => []);
  // PARITY-1 Part D — a Group is offered wherever an audience is, counted by
  // its own members (the live rule or the hand-kept list).
  const groupCounts = new Map();
  for (const r of saved.filter(x => x.kind)) {
    const ids = new Set(await GR.memberIds(orgId, GR.shapeGroup(r)));
    groupCounts.set(r.id, donors.filter(d => ids.has(d.id)).length);
  }

  // FIX-49 decision 7: "Major" is the Major giving level, resolved once.
  const { majorIds } = await resolveSegmentSpec({ mode: "major" }, orgId);
  const { lapsedIds } = await resolveSegmentSpec({ mode: "lapsed" }, orgId);
  const segOf = sg => (sg && sg.mode === "major" ? { ...sg, majorIds } : sg && sg.mode === "lapsed" ? { ...sg, lapsedIds } : sg);
  const builtins = A.BUILT_IN_AUDIENCES.map(a => ({
    id: a.id, name: a.name, description: a.description, kind: "builtin", tone: a.tone,
    mode: a.mode,
    count: filterBySegment(donors, segOf({ mode: a.mode })).length,
    // WHERE THESE PEOPLE LIVE. Allie should never have to wonder where her
    // volunteers are kept — an audience names the screen its people are on.
    // FIX-1 D/C — Donors shows donors now, so volunteers live in the
    // Volunteers hub and staff and board under Settings; nobody is on one
    // list any more, so "everyone" names the three places.
    livesOn: a.mode === "everyone" ? { tab: "donors", filter: null, label: "Donors, Volunteers, and Settings for staff and board" }
           : a.mode === "donors" ? { tab: "donors", filter: "donor", label: "Donors" }
           : a.mode === "volunteers" ? { tab: "volunteers", filter: null, label: "Volunteers" }
           : a.mode === "staff_board" ? { tab: "settings", filter: null, label: "Settings, under Organization" }
           : { tab: "donors", filter: a.mode, label: "Donors, filtered to " + a.name.toLowerCase() },
  }));

  const custom = saved.map(r => {
    const seg = typeof r.segment === "string" ? JSON.parse(r.segment || "{}") : (r.segment || {});
    return {
      id: r.id, name: r.name, description: r.description || "", kind: r.kind ? "group" : "saved", tone: "greenMid",
      groupKind: r.kind || null,
      mode: r.kind ? "audience" : seg.mode, segment: r.kind ? { mode: "audience", audienceId: r.id } : seg, created_at: r.created_at,
      count: r.kind ? groupCounts.get(r.id) : filterBySegment(donors, segOf(seg)).length,
      livesOn: { tab: "donors", filter: seg.mode, label: "Donors" },
    };
  });

  // COUNTS-1: each audience's number is the campaign builder's count (audienceReach.js).
  const list = [...builtins, ...custom];
  const reach = await require("./audienceReach").audienceReach(orgId, list.map(x => x.segment || { mode: x.mode }), { query, resolveSegmentSpec, filterBySegment });
  return {
    audiences: list.map((x, i) => ({ ...x, withEmail: x.count, count: reach[i].reach, inSegment: reach[i].inSegment })),
    // The reach line. DISTINCT people, not the sum of the audiences — a
    // volunteer who gives is in two of them and must be one person here.
    // COUNTS-1: it is "Everyone with an email"'s builder count, the same number
    // its card shows; withEmail is everyone on file with an address.
    reach: (() => { const i = list.findIndex(x => x.mode === "everyone"); return i >= 0 ? reach[i].reach : donors.length; })(),
    withEmail: (() => { const i = list.findIndex(x => x.mode === "everyone"); return i >= 0 && reach[i].inSegment != null ? reach[i].inSegment : donors.length; })(),
  };
}

app.get("/audiences", requireAuth, wrap(async (req, res) => {
  res.json(await audienceRoster(req.user.orgId));
}));

app.post("/audiences", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const A = await audienceMod();
  const v = A.validateAudience(req.body || {});
  if (!v.ok) return res.status(400).json({ error: v.errors[0], errors: v.errors });
  const seg = A.segmentFor({ mode: v.mode, stages: req.body.stages, tiers: req.body.tiers });
  const id = newId("aud");
  try {
    await run(`INSERT INTO audiences (id, org_id, name, description, segment, created_by, created_by_name)
               VALUES (?,?,?,?,?,?,?)`,
      [id, req.user.orgId, v.name, v.description || null, JSON.stringify(seg),
       req.user.userId, req.user.name || req.user.email || null]);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "You already have an audience called that." });
    throw err;
  }
  const [row] = await query("SELECT * FROM audiences WHERE id=?", [id]);
  res.status(201).json(row);
}));

app.patch("/audiences/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const A = await audienceMod();
  const [existing] = await query("SELECT * FROM audiences WHERE id=? AND org_id=?",
    [req.params.id, req.user.orgId]);
  if (!existing) return res.status(404).json({ error: "Not found" });
  const prev = typeof existing.segment === "string" ? JSON.parse(existing.segment || "{}") : existing.segment;
  const v = A.validateAudience({
    name: req.body.name !== undefined ? req.body.name : existing.name,
    description: req.body.description !== undefined ? req.body.description : existing.description,
    mode: req.body.mode !== undefined ? req.body.mode : prev.mode,
    stages: req.body.stages !== undefined ? req.body.stages : prev.stages,
    tiers: req.body.tiers !== undefined ? req.body.tiers : prev.tiers,
  });
  if (!v.ok) return res.status(400).json({ error: v.errors[0], errors: v.errors });
  const seg = A.segmentFor({ mode: v.mode,
    stages: req.body.stages !== undefined ? req.body.stages : prev.stages,
    tiers: req.body.tiers !== undefined ? req.body.tiers : prev.tiers });
  try {
    await run("UPDATE audiences SET name=?, description=?, segment=?, updated_at=NOW() WHERE id=? AND org_id=?",
      [v.name, v.description || null, JSON.stringify(seg), req.params.id, req.user.orgId]);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "You already have an audience called that." });
    throw err;
  }
  const [row] = await query("SELECT * FROM audiences WHERE id=?", [req.params.id]);
  res.json(row);
}));

app.delete("/audiences/:id", requireAuth, wrap(async (req, res) => {
  const r = await run("DELETE FROM audiences WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!r.changes) return res.status(404).json({ error: "Not found" });
  // A campaign already sent keeps its recipient rows, so history is intact.
  // A DRAFT pointing at this audience now resolves to nobody rather than to
  // everybody — resolveSegmentSpec returns an empty manual list for a missing
  // audience, which is the BUILD-88c rule held at the one place it matters.
  res.json({ deleted: true });
}));
async function hubMailState(orgId) {
  const [org] = await query("SELECT id, name, emails_enabled, onboarded_at, org_kind FROM orgs WHERE id=?", [orgId]).catch(() => []);
  const d = mailPolicy.orgMailDecision(org || null, mailPolicy.CATEGORY.DONOR);
  if (!d.send) return { sends: false, sentence: mailPolicy.REASON_SENTENCE[d.reason] || "Email is not going out from this organization right now." };
  const ident = await orgSendingIdentity(orgId).catch(() => null);
  return { sends: true, from: ident ? ident.from : null, sentence: ident ? `Your email goes out from ${ident.from}.` : null };
}

// FIX-40 · AUDIENCE, COUNTED BY THE RULES A CAMPAIGN SENDS BY. The tab used to
// filter the whole donor list in the browser with rules of its own: "All
// Donors" was everyone with an email (volunteers and staff too, 1,206 against
// 1,158 donors), and "Lapsed" read a status nothing sets (0). Each segment is
// now filterBySegment's, over the same people audienceRoster counts (everyone
// with an email). FIX-51: "Lapsing or lapsed" is the one lapse rule
// (lapseRule.js), read from the tags themselves (donorStatus.quietIds), so it
// is exactly the Lapsing people plus the Lapsed people. A volunteer coordinator gets no giving column
// (VOL-2's rule).
app.get("/communications/audience", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const coordinator = req.user.role === "volunteer_coordinator";
  const donors = await query(
    "SELECT * FROM donors WHERE org_id = ? AND email IS NOT NULL AND email != '' AND deleted_at IS NULL", [orgId]);
  const quiet = await DS.quietIds(orgId, orgToday(await orgTz(orgId)));
  const all = filterBySegment(donors, { mode: "donors" });
  const byStage = st => all.filter(d => d.stage === st);
  const SEGS = [
    { id: "all", label: "All donors", rows: all,
      definition: "Every donor with an email address. People who only volunteer or work here are not in it." },
    { id: "major", label: "Major", rows: filterBySegment(all, await resolveSegmentSpec({ mode: "major" }, orgId)),
      definition: "Donors with an email address at the Major giving level: what they gave in the last 12 months against your cut points in Settings, Giving levels." },
    { id: "lapsed", label: "Lapsing or lapsed", rows: all.filter(d => quiet.has(d.id)),
      definition: `Donors with an email address who are lapsing or lapsed. ${lapseRule.WORDS.lapsing} ${lapseRule.WORDS.lapsed}` },
    { id: "prospect", label: "Prospects", rows: byStage("prospect"), definition: "Donors with an email address at the Prospect stage." },
    { id: "steward", label: "In ongoing care", rows: byStage("steward"), definition: "Donors with an email address at the Ongoing care stage." },
    { id: "solicit", label: "Ready to solicit", rows: byStage("solicit"), definition: "Donors with an email address at the Solicit stage." },
  ];
  const everyone = await query("SELECT id, person_types FROM donors WHERE org_id = ? AND deleted_at IS NULL", [orgId]);
  const donorTotal = everyone.filter(d => PT.isDonor(d)).length;
  res.json({
    donorTotal,
    segments: SEGS.map(s => ({
      id: s.id, label: s.label, count: s.rows.length, definition: s.definition,
      rows: s.rows.slice().sort((a, b) => (Number(b.total_giving) || 0) - (Number(a.total_giving) || 0))
        .map(d => ({ id: d.id, name: d.name, email: d.email, stage: d.stage,
                     ...(coordinator ? {} : { totalGiving: Number(d.total_giving) || 0 }) })),
    })),
  });
}));

app.get("/communications/hub", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [roster, campaigns, seqs] = await Promise.all([
    audienceRoster(orgId),
    query(`SELECT id, name, subject, status, recipient_count, open_count, sent_at, created_at
             FROM campaigns WHERE org_id=? ORDER BY COALESCE(sent_at, created_at) DESC LIMIT 6`, [orgId]),
    query(`SELECT s.id, s.name, s.status,
                  (SELECT COUNT(*) FROM sequence_enrollments e WHERE e.sequence_id=s.id AND e.status='active') AS active
             FROM sequences s WHERE s.org_id=? AND s.trigger <> 'onboarding'
            ORDER BY s.created_at DESC LIMIT 5`, [orgId]).catch(() => []),
  ]);
  // FIX-40 · THE TOTALS COUNT EVERY SENT EMAIL CAMPAIGN, not the six newest
  // rows the Recent sends list shows. With six drafts newer than the one appeal
  // that went out, Overview said 0 emails sent while Analytics said 180. Both
  // now read campaignStats over the same rows (shared/campaignKind.js).
  const CK = await import("../../shared/campaignKind.js");
  const every = await query(
    `SELECT id, status, subject, body, sent_at, scheduled_at, recipient_count, open_count, goal_amount, email_blocks
       FROM campaigns WHERE org_id=?`, [orgId]);
  const cs = CK.campaignStats(every);
  const totalSent = cs.totalSent;
  const mail = await hubMailState(orgId);
  const totalOpen = cs.totalSentRows.reduce((n, c) => n + (Number(c.open_count) || 0), 0);
  // COMMS-1: none can get a campaign email because the switch is off: say where it is.
  const TURN = require("./campaignTurnOn");
  const campaignTurnOn = TURN.turnOnNote({ off: await TURN.campaignEmailsOff(query, orgId).catch(() => false), isAdmin: TURN.isAdminReq(req) });
  res.json({
    ...roster,
    mail,
    campaignTurnOn,
    campaigns: await require("../../campaignDelivery").withDelivery(orgId, campaigns),
    sequences: seqs.map(s => ({ ...s, active: parseInt(s.active, 10) || 0 })),
    stats: {
      totalSent,
      openRate: totalSent > 0 ? Math.round(totalOpen / totalSent * 100) : null,
      // COUNTS-1: running is turned on AND able to send, every sequence, never the newest five.
      ...await require("./sequenceCounts").sequencesRunning(query, orgId, { mailSends: mail.sends }).then(r => ({ activeSequences: r.running, sequencesSentence: r.sentence })),
    },
  });
}));

app.post("/campaigns/:id/send", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const campaigns = await query(
    "SELECT * FROM campaigns WHERE id = ? AND org_id = ?",
    [req.params.id, req.user.orgId]
  );
  if (!campaigns.length) return res.status(404).json({ error: "Campaign not found" });
  const campaign = campaigns[0];
  if (campaign.status === "sent") return res.status(400).json({ error: "Campaign already sent" });
  // BUILD-94 Part 4 — NO ADDRESS, NO SEND. Before the recipients are resolved,
  // before anything is marked sending: nothing in bulk leaves without one.
  const addrGate = await bulkSendAddressGate(req.user.orgId);
  if (!addrGate.ok) return res.status(400).json({ error: addrGate.reason, message: addrGate.message });
  // EMAIL-1 — A TEMPLATE CAMPAIGN WITH A HOLE IN IT IS REFUSED WHOLE: a
  // picture with no alt text, a field Steward does not fill, no footer.
  if (campaign.status === "awaiting_approval") {
    return res.status(400).json({ error: "awaiting_approval", message: "This campaign is waiting for approval. Approve it first, then it can go." });
  }
  const pre = await emailCompose.campaignPreflight(campaign, req.user.orgId);
  if (!pre.ok) return res.status(400).json({ error: "email_not_ready", message: pre.message, problems: pre.problems });

  const orgs = await query("SELECT * FROM orgs WHERE id = ?", [req.user.orgId]);
  const org = orgs[0];
  // The send's list is the server's, always: the segment resolved here, never
  // a list from the browser. Each person is then decided by donorMailDecision
  // in the loop (suppressed ones keep a row with their reason), and the count
  // returned is that same decision taken for the whole list (FIX-26).
  const donors = await resolveCampaignRecipients(campaign, req.user.orgId);
  const aud = await campaignAudience(campaign, req.user.orgId);

  // Mark as sending and respond immediately (non-blocking).
  // HARDEN-1: the mark is a CLAIM. Two presses of Send (a double-click, a
  // retry after a lost answer, a second tab) both read 'draft', both marked it
  // sending and both ran the loop below, so every donor got the campaign
  // twice. One UPDATE now decides which press sends; the other is told it is
  // already going. A send stuck in 'sending' for 15 minutes (the server died
  // mid-loop) may be pressed again, as before.
  const claimed = await query(
    `UPDATE campaigns SET status='sending', updated_at=NOW()
      WHERE id=? AND org_id=? AND status IS DISTINCT FROM 'sent'
        AND (status IS DISTINCT FROM 'sending' OR updated_at < NOW() - interval '15 minutes')
      RETURNING id`, [campaign.id, req.user.orgId]);
  if (!claimed.length) {
    req.audit && req.audit.skip && req.audit.skip("a second press of Send changes nothing");
    return res.status(409).json({ error: "already_sending", message: "This campaign is already going out. Nothing was sent twice." });
  }
  res.json({ queued: true, recipientCount: aud.orgGate.send ? aud.recipients.length : 0 });

  setImmediate(() => runCampaignSend(campaign, org, donors));
}));
}

module.exports = { routers, mount };
