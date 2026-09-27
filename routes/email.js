// routes/email.js — the mail helpers: the donor-mail decision, the unsubscribe
// token and footer, the branded header, the from address, and the senders more
// than one product uses.
//
// FIX-1 split: these functions were moved here VERBATIM from server.js. Nothing
// in them changed. The Resend client itself stays in server.js, and every send
// below still goes through it (tests/mail-block pins that).
//
// server.js imports these functions where they used to be declared and binds
// what they read by calling mount() at the end of boot.
// Tests read this file through readSource("server.js") (scripts/lib/readSource.js).

// Bound by mount(), which server.js calls at the end of boot. Nothing below runs
// before then: server.js calls these functions only from request handlers and jobs.
let
  DONOR_ACCOUNTS_ENABLED, DONOR_MAIL_ADDR, PORTAL_DEFAULT_THEME, UNSUB_SECRET, buildCardUpdateUrl,
  crypto, displayNameCase, donorAudit, donorFacingOrgName, donorSendOpts, escHtmlWf, escapeHtml,
  foldEmail, givingAccountEntry, isBlockedAddress, orgMailGateCache, orgSendingIdentity,
  publicAppUrl, query, resend, resolveOrgBrandTheme, uuid;

function mount(ctx) {
  ({
    DONOR_ACCOUNTS_ENABLED, DONOR_MAIL_ADDR, PORTAL_DEFAULT_THEME, UNSUB_SECRET, buildCardUpdateUrl,
    crypto, displayNameCase, donorAudit, donorFacingOrgName, donorSendOpts, escHtmlWf, escapeHtml,
    foldEmail, givingAccountEntry, isBlockedAddress, orgMailGateCache, orgSendingIdentity,
    publicAppUrl, query, resend, resolveOrgBrandTheme, uuid,
  } = ctx);
}
// The emailed entry link: from=<slug> for the cosmetic theming, and — when the
// email address is verified-in-context (it received this very email) — the
// existing fragment prefill convention. Everything donor-identifying rides
// the URL FRAGMENT, never the query string (never sent to a server or in a
// Referer).
function givingAccountLink(slug, email) {
  return `${publicAppUrl()}/giving#signup&from=${slug}` + (email ? `&email=${encodeURIComponent(email)}` : "");
}
// BUILD-64 decision (Jonathan may overrule): the giving-account CTA STAYS in the
// org's transactional receipt — but quiet, below a divider, and in the ORG's
// palette, never Steward's emerald. So it reads as a service the org offers, not
// a Steward house ad. `linkColor` is the org's own primary (from the shared
// resolver); it falls back to the neutral portal default, never #0d5c3a.
function givingAccountEmailFooterHtml(slug, email, linkColor) {
  const color = linkColor || PORTAL_DEFAULT_THEME.primary;
  return `<p style="border-top:1px solid #e8e4db;margin-top:22px;padding-top:12px;color:#8fa896;font-size:12px;">
    See all your giving in one place — receipts, recurring gifts, and year-end totals across every organization you support:
    <a href="${givingAccountLink(slug, email)}" style="color:${color};">create your free giving account</a>.</p>`;
}

async function sendReceiptEmail(org, donor, snapshot, pdfBuffer, filename) {
  if (!process.env.RESEND_API_KEY) return false;
  try {
    // BUILD-88c C.1 — the org's own identity when their domain is verified,
    // and a Reply-To that reaches a human when it is not. A donor answering a
    // receipt was writing to `noreply@` and the answer went nowhere.
    const ident = await orgSendingIdentity(org.id);
    const from = ident.from;
    // Subject names the artifact honestly (a year-end statement is not a
    // "donation receipt") and the cover carries the branded org header like
    // every other donor-facing email — both live-test findings, 2026-08-05.
    const artifact = snapshot.type === "year_end" ? "year-end giving statement" : "donation receipt";
    const dfName = await donorFacingOrgName(org.id, org.name); // W-2 white-label
    const subject = `Your ${artifact} from ${dfName}`;
    // BUILD-49 entry point (a)+(b): one quiet footer line on the receipt and
    // year-end cover emails, only for listed orgs. BUILD-64: the CTA link is in
    // the org's own palette, never Steward emerald.
    const entry = await givingAccountEntry(org);
    const brand = await resolveOrgBrandTheme(org.id).catch(() => null);
    const html = await brandEmailHeaderHtml(org.id)
      + `<p>Hi ${escapeHtml(donor.name || "there")},</p>
      <p>Thank you for your generous gift to <strong>${escapeHtml(dfName)}</strong> — your official ${snapshot.type === "year_end" ? "year-end giving statement" : "tax receipt"} is attached.</p>`
      // BUILD-54 §2 — the campaign's own org-authored copy (frozen in the
      // snapshot at issue time); absent when the campaign has no content.
      + (snapshot.campaignNote ? `<p>Your gift supports <strong>${escapeHtml(snapshot.campaignNote.name)}</strong>. ${escapeHtml(snapshot.campaignNote.description)}</p>` : "")
      + `<p style="color:#8fa896;font-size:13px">Receipt #${escapeHtml(snapshot.receiptNumber)}</p>`
      + (entry ? givingAccountEmailFooterHtml(entry.slug, donor.email, brand && brand.band) : "");
    // Transactional (not a campaign/sequence send) — deliberately no
    // unsubscribe link/List-Unsubscribe headers, but still skips suppressed
    // addresses (below, before this is ever called) to protect the shared
    // stewardapp.dev sending domain's reputation.
    const { error } = await resend.emails.send({
      from, ...(ident.replyTo ? { replyTo: ident.replyTo } : {}),
      to: donor.email, subject, html,
      attachments: [{ filename, content: pdfBuffer }],
    });
    if (error) { console.error("[receipts] email send failed:", error.message || JSON.stringify(error)); return false; }
    return true;
  } catch (err) {
    console.error("[receipts] email send threw:", err.message);
    return false;
  }
}

function signUnsubscribeToken(email, orgId, source) {
  const payload = Buffer.from(JSON.stringify({
    email: String(email).toLowerCase(),
    orgId: orgId || null,
    source: source === "sequence" ? "sequence" : "campaign",
  })).toString("base64url");
  const sig = crypto.createHmac("sha256", UNSUB_SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function buildUnsubscribeUrl(email, orgId, source) {
  // The canonical domain, NOT the raw API host: /unsubscribe is proxied to
  // this server by the vercel.json rewrite, so the link a donor sees (and
  // hovers) is stewardapp.dev. Same rule as every other email link.
  return `${publicAppUrl()}/unsubscribe?token=${signUnsubscribeToken(email, orgId, source)}`;
}

async function unsubscribeEmailFooterHtml(email, orgId, source) {
  const url = buildUnsubscribeUrl(email, orgId, source);
  let addressLine = "";
  const orgRows = await query("SELECT name, legal_name, receipt_address FROM orgs WHERE id = ?", [orgId]);
  const org = orgRows[0];
  if (org?.receipt_address) {
    const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const address = esc(org.receipt_address).replace(/\r?\n+/g, ", ");
    addressLine = `<div style="margin-bottom:6px;">${esc(org.legal_name || org.name || "")} · ${address}</div>`;
  }
  return `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e0d5;font-family:'DM Sans',Helvetica,Arial,sans-serif;font-size:12px;color:#8fa896;">
    ${addressLine}<a href="${url}" style="color:#8fa896;text-decoration:underline;">Unsubscribe</a> from these emails.
  </div>`;
}

async function donorFromAddress(orgId) {
  return (await orgSendingIdentity(orgId)).from;
}

// Branded email header band (BUILD-13 Part 2, rewired in BUILD-64) — the org's
// logo + white-label name on its OWN primary color (from the shared resolver
// above), above the message body. Tasteful: one slim band, still inside
// Steward's typographic frame. Falls back to a plain org-name band (the
// designed-neutral portal default) when no theme is set, and to nothing if the
// org can't be resolved. async (a DB lookup) — every caller awaits.
async function brandEmailHeaderHtml(orgId) {
  const theme = await resolveOrgBrandTheme(orgId).catch(() => null);
  if (!theme) return "";
  const esc = s => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const name = esc(theme.displayName);
  const src = theme.logoDataUri || theme.logoAbsUrl;
  const logo = src
    ? `<img src="${src}" alt="${name}" height="34" style="height:34px;max-width:150px;vertical-align:middle;border:0;display:inline-block;margin-right:10px;" />`
    : "";
  return `<div style="background:${theme.band};padding:16px 22px;border-radius:12px 12px 0 0;font-family:'DM Sans',Helvetica,Arial,sans-serif;">
    <span style="display:inline-block;vertical-align:middle;">${logo}</span><span style="color:${theme.bandFg};font-size:17px;font-weight:700;vertical-align:middle;">${name}</span>
  </div>`;
}

// List-Unsubscribe headers (RFC 8058) so Gmail/Outlook render a native
// one-click unsubscribe button. The mailto: address isn't monitored/processed —
// it's included only to satisfy the two-part format some older clients expect;
// modern one-click support (Gmail/Outlook) relies on the https: URL + POST below.
// BUILD-88c C.1 — the mailto half of this header carries a DOMAIN, and on a
// verified org it must be theirs: it is one of the four things an inbox will
// show a curious recipient. `identity` is `orgSendingIdentity`'s result; with
// none (a legacy caller) the shared address stands, which is today's behaviour.
function unsubscribeHeaders(email, orgId, source, identity = null) {
  const url = buildUnsubscribeUrl(email, orgId, source);
  const mailto = identity && identity.verified ? `unsubscribe@${identity.domain}` : "unsubscribe@stewardapp.dev";
  return {
    "List-Unsubscribe": `<mailto:${mailto}>, <${url}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

// Returns the suppression reason ('unsubscribed'|'bounced'|'complained') if this
// address is suppressed for this org — either a global row (org_id IS NULL,
// from a bounce/complaint) or an org-scoped row (that org's own unsubscribe).
async function getSuppressionReason(email, orgId) {
  if (!email) return null;
  const rows = await query(
    `SELECT reason FROM email_suppressions
     WHERE LOWER(email) = LOWER(?) AND (org_id IS NULL OR org_id = ?)
     ORDER BY created_at DESC LIMIT 1`,
    [email, orgId || null]
  );
  return rows[0]?.reason || null;
}

const DONOR_MAIL_POLICY = {
  campaign:           "marketing",
  sequence:           "marketing",
  workflow:           "marketing",      // org-authored thank-you / re-engage recipes
  milestone:          "marketing",      // staff-reviewed milestone drafts
  pledge_reminder:    "marketing",      // a reminder to give is solicitation
  onboarding_drip:    "marketing",      // founder drip to org staff
  dunning:            "transactional",  // failed-card recovery (W-4's instance)
  recovered_thankyou: "transactional",  // "your card worked" confirmation
  receipt:            "transactional",  // legal acknowledgment of a gift
  year_end:           "transactional",  // year-end giving statement
  recurring_change:   "transactional",  // staff/donor changes to a recurring gift + proposals
  card_expiring:      "transactional",  // "your card expires soon" — the pre-failure half of dunning
};
// ── INCIDENT 2026-09-22 — ONE ORG-LEVEL GATE, READ BY EVERY SEAM ──────────
// Three different kinds of mail escaped that night — a donor reminder, a
// founder drip and a staff digest — and they escaped through three different
// functions. Any fix that lived in one of them would have left the other two
// open, which is exactly how the night happened in the first place.
//
// So the org-level answer is asked HERE, once, and every seam calls it:
// donorMailDecision (all donor mail), runDigestsForOrg (Week in Review and
// the monthly officer report) and sendOnboardingSequence (the founder drip).
//
// Fails CLOSED. If the org row cannot be read, nothing is sent — the opposite
// of the convention elsewhere in this file, and deliberate: every other
// fail-open default in the mail path is about not losing a real message to a
// real person, and this gate exists precisely because the recipients may not
// be real people at all.
// A campaign send asks this ONCE PER RECIPIENT, so on a 5,000-donor appeal an
// uncached gate is 5,000 extra round trips bolted onto the send loop. That is
// not theoretical: adding this check slowed the bulk path enough to expose a
// latent race in build94-bulk on the first CI run after it landed.
//
// Five seconds, because the thing being cached is a KILL SWITCH. Long enough
// that a bulk send pays for one query instead of thousands; short enough that
// "I turned this org off" is true almost immediately — and the switch route
// drops the entry outright, so an operator flip is instant rather than
// eventually-consistent.
const ORG_MAIL_GATE_TTL_MS = 5000;

async function orgMaySendEmail(orgId) {
  if (!orgId) return { send: false, reason: "no_org" };
  const hit = orgMailGateCache.get(orgId);
  if (hit && Date.now() - hit.at < ORG_MAIL_GATE_TTL_MS) return hit.result;
  try {
    const [org] = await query(
      "SELECT emails_enabled, is_demo_org FROM orgs WHERE id = ?", [orgId]);
    let result;
    if (!org) result = { send: false, reason: "org_not_found" };
    else if (org.emails_enabled === false) result = { send: false, reason: "org_emails_disabled" };
    else if (org.is_demo_org === true) result = { send: false, reason: "demo_org" };
    else result = { send: true, reason: null };
    orgMailGateCache.set(orgId, { at: Date.now(), result });
    return result;
  } catch (err) {
    // NOT cached. A refusal caused by a database blip must not be remembered
    // for five seconds, and — more importantly — must not be remembered as an
    // ALLOW either. Every retry re-asks.
    console.error("[mail-gate] could not read org", orgId, err.message, "— refusing to send");
    return { send: false, reason: "org_gate_unreadable" };
  }
}

async function donorMailDecision(kind, email, orgId) {
  const cls = DONOR_MAIL_POLICY[kind];
  if (!cls) return { send: false, reason: "unclassified_kind:" + kind };
  if (!email) return { send: false, reason: "no_email" };
  // The permanent block (mailBlock.js) outranks everything, the org switch
  // included: it is not a fact about an org or a person's preference.
  if (isBlockedAddress(email)) {
    console.warn(`[mail-block] donorMailDecision refused a blocked address (kind=${kind}, org=${orgId || "none"})`);
    return { send: false, reason: "blocked_address" };
  }
  // The org-level switch outranks every per-person consideration below it:
  // if this organisation is not sending mail, who the person is does not
  // arise. Checked FIRST so a disabled org costs one query, not five.
  const orgGate = await orgMaySendEmail(orgId);
  if (!orgGate.send) return { send: false, reason: orgGate.reason };
  // BUILD-94 Part 4 — UNSUBSCRIBED IS ONE FLAG ON THE PERSON, and it is read
  // HERE, in the one place that decides whether anything may be sent.
  // `do_not_email` existed as a column since BUILD-77 and nothing consulted
  // it: an import that carried a DNE column wrote a flag that changed nothing,
  // which is worse than not having it. `email_unreachable` is the other half
  // — a hard bounce is a fact about the address, not a preference.
  const [flags] = await query(
    `SELECT bool_or(deceased) AS deceased, bool_or(do_not_contact) AS dnc,
            bool_or(do_not_email) AS dne, bool_or(email_unreachable) AS unreachable,
            bool_or(is_sample) AS sample
       FROM donors WHERE org_id = ? AND LOWER(email) = LOWER(?) AND deleted_at IS NULL`,
    [orgId, email]
  ).catch(() => [null]);

  // ── INCIDENT 2026-09-22 — A MADE-UP PERSON HAS NO MAILBOX ────────────────
  // On 22 September a seeded donor received a real pledge reminder at a real
  // yahoo.com address, because the loop that sends them JOINs donors with no
  // is_sample filter. Patching that loop would have been the wrong fix: there
  // are a dozen send paths and only one of them had been audited.
  //
  // This function is the ONE gate every donor-facing send passes through, and
  // it already knows how to say no on behalf of the person (deceased,
  // bounced, unsubscribed, do-not-contact). It simply had no concept of a
  // person who does not exist. It does now, and it refuses for EVERY kind —
  // transactional included, because a receipt to an invented donor is not a
  // legal acknowledgment, it is mail to a stranger who happens to own the
  // address somebody invented.
  //
  // The rule this encodes is one the product already believed: `getDraftFor`
  // has carried "demo fiction never generates work" since BUILD-83. Fiction
  // must not generate MAIL either.
  if (flags?.sample) return { send: false, reason: "sample_donor" };

  if (flags?.deceased) return { send: false, reason: "deceased" };
  // An address that hard-bounced cannot receive anything, transactional
  // included — a receipt to a dead mailbox is not a receipt, it is a bounce.
  if (flags?.unreachable) return { send: false, reason: "bounced" };
  const suppressReason = await getSuppressionReason(email, orgId);
  if (cls === "marketing") {
    if (flags?.dnc) return { send: false, reason: "do_not_contact" };
    if (flags?.dne) return { send: false, reason: "unsubscribed" };
    if (suppressReason) return { send: false, reason: suppressReason };
  } else {
    // Transactional ignores the donor's marketing OPT-OUT ("unsubscribed") —
    // that's the W-4 rule — but still honors DELIVERABILITY suppressions:
    // a hard-bounced address can't receive anything, and mailing a
    // complainer damages the shared sending domain for every org.
    if (suppressReason === "bounced" || suppressReason === "complained") return { send: false, reason: suppressReason };
  }
  return { send: true, reason: null };
}

const DEFAULT_DUNNING_SUBJECT = "A quick fix to keep your support going";
// {{donor_name}}/{{first_name}}/{{org_name}}/{{amount}}/{{update_url}} tokens,
// same replacement convention as campaign/sequence bodies. Deliberately no
// "tier"/"level"/"badge"/"leaderboard" language anywhere — this is a
// stewardship touch, not a collections notice (see CLAUDE.md "Strategic pivot").
const DEFAULT_DUNNING_BODY = `<p>Hi {{first_name}},</p>
<p>Thank you again for your ongoing gift of {{amount}} to {{org_name}} — support like yours is what makes our work possible.</p>
<p>We tried to process your latest gift and the card on file didn't go through. This happens most often when a card has expired or been reissued, and it only takes a minute to fix.</p>
<p style="text-align:center;margin:28px 0;"><a href="{{update_url}}" style="background:#1a6b4a;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;display:inline-block;">Update my card</a></p>
<p>If you have any questions, just reply to this email — we're glad to help.</p>
<p>With gratitude,<br/>{{org_name}}</p>`;

function applyDunningTokens(str, { donor, org, amount, updateUrl }) {
  const firstName = donor.name ? donor.name.trim().split(/\s+/)[0] : "";
  return (str || "")
    .replace(/{{donor_name}}/g, donor.name || "")
    .replace(/{{first_name}}/g, firstName)
    .replace(/{{org_name}}/g, displayNameCase(org.name) || "")
    .replace(/{{amount}}/g, amount != null ? `$${Number(amount).toLocaleString()}` : "your gift")
    .replace(/{{update_url}}/g, updateUrl);
}

// Sends the failed-card recovery email. TRANSACTIONAL (W-4): the marketing
// suppression list does NOT apply — a donor who unsubscribed from campaigns
// has not opted out of being told their card failed. Only the policy's hard
// blocks (deceased, no email) refuse. The recurring_dunning_enabled org-level
// kill switch is checked by callers (processDunning / the manual resend
// route), not here, since a manual staff resend should still work even if an
// org has paused the automatic cadence.
// Returns { sent, refused }: refused = a permanent policy refusal (don't
// retry); sent:false with refused:null = provider failure (retry later).
// Callers log `dunning_sent` ONLY when sent is true — the log never lies.
async function sendDunningEmail(org, donor, subscriptionRow) {
  const decision = await donorMailDecision("dunning", donor.email, org.id);
  if (!decision.send) {
    console.log(`[dunning] refused for ${donor.email} (${decision.reason})`);
    return { sent: false, refused: decision.reason };
  }
  const updateUrl = buildCardUpdateUrl(subscriptionRow.stripe_subscription_id, org.id);
  // W-2 white-label: {{org_name}} renders the donor-facing display name.
  const tokenCtx = { donor, org: { ...org, name: await donorFacingOrgName(org.id, org.name) }, amount: subscriptionRow.amount, updateUrl };
  const subject = applyDunningTokens(org.recurring_dunning_subject || DEFAULT_DUNNING_SUBJECT, tokenCtx);
  // BUILD-45 §6.3 — when the org's donor portal is enabled, the recovery email
  // also links the donor into their portal (magic-link sign-in — no staff, no
  // password) so they can fix the card or manage the gift themselves.
  let portalLine = "";
  try {
    const [ps] = await query(`SELECT ps.enabled, o.org_slug FROM portal_settings ps JOIN orgs o ON o.id = ps.org_id WHERE ps.org_id = ?`, [org.id]);
    if (ps && ps.enabled === true && ps.org_slug) {
      portalLine = `<p style="font-size:13px;color:#555;text-align:center;">Prefer to manage everything yourself? <a href="${publicAppUrl()}/portal/${ps.org_slug}">Sign in to your donor portal</a> — no password needed.</p>`;
    }
  } catch { /* portal line is optional */ }
  const bodyHtml = await brandEmailHeaderHtml(org.id)
    + applyDunningTokens(org.recurring_dunning_body || DEFAULT_DUNNING_BODY, tokenCtx)
    + portalLine
    + await unsubscribeEmailFooterHtml(donor.email, org.id, "campaign");
  const smtpFrom = await donorFromAddress(org.id); // BUILD-64: the org's name in the inbox
  if (process.env.RESEND_API_KEY) {
    try {
      const { error: sendErr } = await resend.emails.send({
        ...(await donorSendOpts(org.id, donor.email, "campaign")),
        to: donor.email, subject, html: bodyHtml,
      });
      if (sendErr) {
        // W-4 log honesty: a provider rejection is a FAILED send — callers
        // must not log dunning_sent for it. refused stays null (retryable).
        console.error("[dunning] send error:", sendErr.message);
        return { sent: false, refused: null };
      }
    } catch (e) { console.error("[dunning] resend error:", e.message); return { sent: false, refused: null }; }
  }
  return { sent: true, refused: null };
}

async function sendDigestEmail(org, toEmail, subject, bodyHtml) {
  if (!toEmail) return false;
  // INCIDENT 2026-09-22 — a Week in Review composed entirely from invented
  // gifts was delivered to a real prospect's inbox four minutes after her org
  // was provisioned. The gate is checked HERE as well as in runDigestsForOrg
  // because this function is reachable on its own and a digest is the one
  // piece of mail whose whole content is a claim about the org's real week.
  const digestGate = await orgMaySendEmail(org && org.id);
  if (!digestGate.send) {
    console.log(`[digest] not sending to ${toEmail} (${digestGate.reason})`);
    return false;
  }
  const html = await brandEmailHeaderHtml(org.id) + bodyHtml; // internal staff mail — no donor unsubscribe footer
  const from = process.env.DEMO_SMTP_FROM || "noreply@stewardapp.dev";
  if (process.env.RESEND_API_KEY) {
    try {
      const { error } = await resend.emails.send({ from, to: toEmail, subject, html });
      if (error) console.error("[digest] email error:", error.message);
    } catch (e) { console.error("[digest] email threw:", e.message); }
  }
  return true;
}

// The notice itself. TRANSACTIONAL, like dunning: it is about the payment
// instrument on an agreement the donor already made, not a new ask.
async function sendCardExpiringEmail(org, donor, rs) {
  const decision = await donorMailDecision("card_expiring", donor.email, org.id);
  if (!decision.send) return { sent: false, refused: decision.reason };
  const dfName = await donorFacingOrgName(org.id, org.name);
  const firstName = donor.name ? donor.name.trim().split(/\s+/)[0] : "";
  const updateUrl = buildCardUpdateUrl(rs.stripe_subscription_id, org.id);
  const last4 = rs.card_last4 ? ` ending ${escHtmlWf(String(rs.card_last4))}` : "";
  const amountStr = rs.amount != null ? `$${Number(rs.amount).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "your";
  const per = rs.interval === "year" ? "yearly" : "monthly";
  const expLabel = `${String(rs.card_exp_month).padStart(2, "0")}/${String(rs.card_exp_year).slice(-2)}`;
  const subject = `Your card${last4} expires soon`;
  // Nothing has gone wrong, and the copy must not imply it has. It states the
  // date, the gift it protects, and the one thing to do.
  const bodyHtml = await brandEmailHeaderHtml(org.id)
    + `<div style="padding:22px;font-family:'DM Sans',Helvetica,Arial,sans-serif;color:#0f1a12;">
        <p>Hi ${escHtmlWf(firstName)},</p>
        <p>The card on your ${escHtmlWf(amountStr)} ${per} gift to ${escHtmlWf(dfName)}${last4} expires ${escHtmlWf(expLabel)}.
           Nothing has gone wrong — we wanted to let you know before your next gift, so it does not
           get interrupted.</p>
        <p style="text-align:center;margin:28px 0;"><a href="${updateUrl}" style="background:#1a6b4a;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;display:inline-block;">Update my card</a></p>
        <p style="font-size:13px;color:#555;">It takes a minute, and ${escHtmlWf(dfName)} never sees your card details — Stripe handles it.</p>
        <p style="font-size:13px;color:#555;">Thank you for giving, month after month.</p>
      </div>`
    + await unsubscribeEmailFooterHtml(donor.email, org.id, "campaign");
  const smtpFrom = await donorFromAddress(org.id);
  if (process.env.RESEND_API_KEY) {
    try {
      const { error: sendErr } = await resend.emails.send({
        ...(await donorSendOpts(org.id, donor.email, "campaign")),
        to: donor.email, subject, html: bodyHtml,
      });
      if (sendErr) { console.error("[card-expiry] send error:", sendErr.message); return { sent: false, refused: null }; }
    } catch (e) { console.error("[card-expiry] resend error:", e.message); return { sent: false, refused: null }; }
  }
  return { sent: true, refused: null };
}

// Send a branded one-off workflow email (thank-you / re-engagement). Reuses the
// BUILD-13 branded header + the CAN-SPAM footer, and honors suppression. No-ops
// cleanly without RESEND_API_KEY (local tests) — the run is still logged.
async function sendWorkflowEmail(org, donor, subject, bodyHtml) {
  if (!donor?.email) return false;
  // W-4: workflow recipe mail is MARKETING — suppression + donor flags apply
  // through the one policy.
  const decision = await donorMailDecision("workflow", donor.email, org.id);
  if (!decision.send) return false;
  const html = await brandEmailHeaderHtml(org.id) + bodyHtml + await unsubscribeEmailFooterHtml(donor.email, org.id, "campaign");
  const from = await donorFromAddress(org.id); // BUILD-64: the org's name in the inbox
  if (process.env.RESEND_API_KEY) {
    try {
      const { error } = await resend.emails.send({ ...(await donorSendOpts(org.id, donor.email, "campaign")), to: donor.email, subject, html });
      if (error) { console.error("[workflow] email error:", error.message); return false; }
    } catch (e) { console.error("[workflow] email threw:", e.message); return false; }
  }
  return true;
}

// Internal staff notification (BUILD-16 Part 3) — a gift-alert email to a team
// member (ED / assigned officer), NOT the donor. So it carries the branded
// header but never the donor unsubscribe/CAN-SPAM footer (that's for donor
// mail). No-ops cleanly without RESEND_API_KEY; the run is still logged.
// Returns TRUE only when the send actually succeeded (BUILD-45 / F-2 fix — it
// used to swallow every provider error and always return true, so callers
// could never tell a delivery failed). No RESEND_API_KEY configured = "nothing
// to deliver" is a success (don't queue retries in an env with no email).
async function sendGiftAlertEmail(org, toEmail, subject, bodyHtml) {
  if (!toEmail) return false;
  const html = await brandEmailHeaderHtml(org.id) + bodyHtml;
  const from = process.env.DEMO_SMTP_FROM || "noreply@stewardapp.dev";
  if (!process.env.RESEND_API_KEY) return true; // email not configured — no failure to record
  try {
    const { error } = await resend.emails.send({ from, to: toEmail, subject, html });
    if (error) { console.error("[notify] gift-alert email error:", error.message); return false; }
    return true;
  } catch (e) { console.error("[notify] gift-alert email threw:", e.message); return false; }
}

// ── BUILD-36 A4: internal-notification dedup + per-user email toggles ────────
// prefKind → the users.notify_* column. NULL / missing column is treated as ON
// (default true) — a pre-existing user keeps hearing about their donors/tasks.
const NOTIFY_PREF_COLUMN = {
  portfolio_gifts: "notify_portfolio_gifts",
  task_assignments: "notify_task_assignments",
  daily_tasks: "notify_daily_tasks",
  thread_nudge: "notify_thread_nudge",   // BUILD-81 — the Thread's morning email
  step_reminder: "notify_step_reminder", // BUILD-84 — a step with a time on it
};
async function userWantsEmail(userId, prefKind) {
  const col = NOTIFY_PREF_COLUMN[prefKind];
  if (!col) return true;
  const rows = await query(`SELECT ${col} AS p FROM users WHERE id=?`, [userId]);
  return rows.length ? rows[0].p !== false : true; // NULL → ON
}
async function sendRawEmail(toEmail, subject, html, fromOverride) {
  if (!toEmail) return false;
  if (!process.env.RESEND_API_KEY) return true; // no email configured — nothing to deliver
  const from = fromOverride || DONOR_MAIL_ADDR(); // BUILD-64: org-named From when caller supplies one
  try {
    const { error } = await resend.emails.send({ from, to: toEmail, subject, html });
    if (error) { console.error("[donor-email] send error:", error.message); return false; }
    return true;
  } catch (e) { console.error("[donor-email] send threw:", e.message); return false; }
}

const DEFAULT_PLEDGE_REMINDER_SUBJECT = "A quick reminder about your pledge to {{org_name}}";
// {{donor_name}}/{{first_name}}/{{org_name}}/{{amount}}/{{due_date}}/{{give_url}}
// tokens, same replacement convention as the dunning templates. No "Update
// my card" CTA here — a pledge has no payment method on file to fix, so the
// call to action is simply the org's existing public donation page.
const DEFAULT_PLEDGE_REMINDER_BODY = `<p>Hi {{first_name}},</p>
<p>Thank you again for your generous pledge of {{amount}} to {{org_name}}. We wanted to check in — that pledge was due {{due_date}}, and we don't show a matching gift yet.</p>
<p>If you've already sent it, thank you — please disregard this note, it may have just crossed paths with your gift. If not, you can fulfill your pledge here:</p>
<p style="text-align:center;margin:28px 0;"><a href="{{give_url}}" style="background:#1a6b4a;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;display:inline-block;">Fulfill my pledge</a></p>
<p>If you have any questions, just reply to this email — we're glad to help.</p>
<p>With gratitude,<br/>{{org_name}}</p>`;

function applyPledgeReminderTokens(str, { donor, org, amount, dueDate, giveUrl }) {
  const firstName = donor.name ? donor.name.trim().split(/\s+/)[0] : "";
  return (str || "")
    .replace(/{{donor_name}}/g, donor.name || "")
    .replace(/{{first_name}}/g, firstName)
    .replace(/{{org_name}}/g, displayNameCase(org.name) || "")
    .replace(/{{amount}}/g, amount != null ? `$${Number(amount).toLocaleString()}` : "your pledge")
    .replace(/{{due_date}}/g, dueDate ? new Date(dueDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "")
    .replace(/{{give_url}}/g, giveUrl);
}

async function sendPledgeReminderEmail(org, donor, pledgeRow) {
  // W-4: a reminder to give is solicitation — MARKETING in the policy.
  const decision = await donorMailDecision("pledge_reminder", donor.email, org.id);
  if (!decision.send) {
    console.log(`[pledge-reminder] skipping ${donor.email} (${decision.reason})`);
    return false;
  }
  const frontendUrl = publicAppUrl();
  const giveUrl = `${frontendUrl}/give/${org.org_slug}`;
  const tokenCtx = { donor, org, amount: pledgeRow.amount, dueDate: pledgeRow.due_date, giveUrl };
  const subject = applyPledgeReminderTokens(org.pledge_reminder_subject || DEFAULT_PLEDGE_REMINDER_SUBJECT, tokenCtx);
  const bodyHtml = applyPledgeReminderTokens(org.pledge_reminder_body || DEFAULT_PLEDGE_REMINDER_BODY, tokenCtx)
    + await unsubscribeEmailFooterHtml(donor.email, org.id, "campaign");
  const smtpFrom = await donorFromAddress(org.id); // BUILD-64: org name in the inbox
  if (process.env.RESEND_API_KEY) {
    try {
      const { error: sendErr } = await resend.emails.send({
        ...(await donorSendOpts(org.id, donor.email, "campaign")),
        to: donor.email, subject, html: bodyHtml,
      });
      if (sendErr) console.error("[pledge-reminder] send error:", sendErr.message);
    } catch (e) { console.error("[pledge-reminder] resend error:", e.message); }
  }
  return true;
}

// ── The seven-day reminder ─────────────────────────────────────────────────
// One email, once, from Jonathan's address. `trial_reminder_sent_at` is what
// makes "once" true — a tick that runs every six hours across seven days must
// not send fourteen warnings.
function trialReminderEmailHtml({ orgName, sentence, cardBrand, cardLast4, cancelUrl }) {
  const card = cardLast4
    ? `${cardBrand ? displayNameCase(cardBrand) + " " : ""}ending ${cardLast4}`
    : "the card on file";
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f0ede6;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0ede6;padding:40px 16px;">
    <tr><td align="center"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
      <tr><td style="padding-bottom:24px;text-align:center;">
        <span style="font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:700;color:#0f1a12;letter-spacing:-0.02em;">Steward</span>
      </td></tr>
      <tr><td style="background:#ffffff;border-radius:16px;padding:40px 40px 36px;box-shadow:0 2px 20px rgba(15,26,18,0.08);">
        <h1 style="margin:0 0 14px;font-size:24px;font-weight:700;color:#0f1a12;letter-spacing:-0.02em;line-height:1.25;">A week before your first charge</h1>
        <p style="margin:0 0 18px;font-size:15px;color:#0f1a12;line-height:1.6;"><strong>${sentence}</strong> It goes to ${card}.</p>
        <p style="margin:0 0 26px;font-size:15px;color:#5A554F;line-height:1.6;">Nothing has been charged yet. If ${orgName ? displayNameCase(orgName) : "your organization"} is not going to keep using Steward, cancel before then and you pay nothing &mdash; one click, no phone call.</p>
        <table cellpadding="0" cellspacing="0" style="margin-bottom:26px;"><tr><td style="border-radius:10px;border:1px solid #E8E4DB;">
          <a href="${cancelUrl}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:700;color:#0f1a12;text-decoration:none;">Cancel my subscription</a>
        </td></tr></table>
        <p style="margin:0;font-size:14px;color:#5A554F;line-height:1.6;">If you are staying, there is nothing to do. Reply to this email with any question &mdash; it reaches me.</p>
        <p style="margin:18px 0 0;font-size:14px;color:#5A554F;line-height:1.6;">&mdash; Jonathan</p>
      </td></tr>
      <tr><td style="padding-top:20px;text-align:center;font-size:12px;color:#8a857f;">Steward &middot; stewardapp.dev</td></tr>
    </table></td></tr>
  </table>
</body></html>`;
}

// Minimal consumer-branded email shell (serif wordmark, no org header — these
// are Steward's emails, not an org's). No emoji, wordmark not glyph.
function consumerEmailHtml(bodyHtml) {
  return `<div style="background:#0f1a12;padding:16px 22px;border-radius:12px 12px 0 0;">
      <span style="color:#f0ede6;font-family:Georgia,'Times New Roman',serif;font-size:18px;font-weight:400;letter-spacing:-0.02em;">Steward</span>
      <span style="color:#8fa896;font-family:Helvetica,Arial,sans-serif;font-size:12px;margin-left:10px;">Your Giving</span>
    </div>
    <div style="font-family:Georgia,'Times New Roman',serif;max-width:520px;margin:0 auto;padding:24px;color:#0f1a12;">${bodyHtml}</div>`;
}

// ── §1.2 the linking job — exact match on VERIFIED emails, nothing else ────
// Idempotent by construction (unique (account_id, donor_id) + ON CONFLICT DO
// NOTHING). An unlinked row (unlinked_at set) is NEVER silently re-linked —
// the conflict target keeps it exactly as the donor left it. Matches only
// portal-ENABLED orgs (the network's population); listing (network_listed)
// gates display, not linking, so an org that lists later appears instantly.
async function linkAccountEmail(accountId, email) {
  const em = foldEmail(email);
  if (!em) return 0;
  const rows = await query(
    `SELECT d.id AS donor_id, d.org_id FROM donors d
     JOIN portal_settings ps ON ps.org_id = d.org_id AND ps.enabled = true
     WHERE LOWER(d.email) = ? AND d.deleted_at IS NULL`, [em]);
  let linked = 0;
  for (const r of rows) {
    const ins = await query(
      `INSERT INTO donor_account_links (id,account_id,org_id,donor_id,via_email)
       VALUES (?,?,?,?,?) ON CONFLICT (account_id, donor_id) DO NOTHING RETURNING id`,
      ["dal_" + uuid().slice(0, 10), accountId, r.org_id, r.donor_id, em]);
    if (ins.length) { linked++; await donorAudit(accountId, em, "link_created", null, { orgId: r.org_id, donorId: r.donor_id }); }
  }
  return linked;
}
// Reverse direction — "runs on gift-create and on org-joins-network": given an
// org+email that just gained a donor record/gift, attach it to any verified
// account holding that email. Fire-and-forget at call sites.
async function linkEmailToAccounts(orgId, email) {
  const em = foldEmail(email);
  if (!em || !DONOR_ACCOUNTS_ENABLED) return;
  const accts = await query(
    `SELECT id FROM donor_accounts WHERE email = ? AND email_verified_at IS NOT NULL
     UNION SELECT account_id AS id FROM donor_account_aliases WHERE email = ? AND verified_at IS NOT NULL`,
    [em, em]);
  for (const a of accts) await linkAccountEmail(a.id, em);
}

module.exports = {
  mount,
  brandEmailHeaderHtml, consumerEmailHtml, donorFromAddress, donorMailDecision, linkAccountEmail,
  linkEmailToAccounts, orgMaySendEmail, sendCardExpiringEmail, sendDigestEmail, sendDunningEmail,
  sendGiftAlertEmail, sendPledgeReminderEmail, sendRawEmail, sendReceiptEmail, sendWorkflowEmail,
  trialReminderEmailHtml, unsubscribeEmailFooterHtml, unsubscribeHeaders, userWantsEmail,
};
