// server/shared/milestoneDrafts.js — sending a milestone draft, the one draft sender.
//
// SPLIT-1: moved VERBATIM from routes/crm.js. Nothing in it changed.
//
// routes/crm.js mounts it before the route modules, and what its mount()
// returns is on ctx for every module mounted after it.
// mount() runs once at the end of boot with server.js's ctx and what the helper
// modules hand back. A relative require() or import() reads from this folder.
// Tests read it through readSource("server.js") (scripts/lib/readSource.js).
const SEND_GATE = require("../../sendGate");   // SEND-GATE-1: a staff click is the confirm for one message
const { newId } = require("./newId");   // IDS-1: every new row id is prefix + 20 hex

function mount(ctx) {
const {
  actor, donorMailDecision, donorSendOpts, escapeHtml, mailPolicy, orgToday, orgTz, query, resend, run,
  unsubscribeEmailFooterHtml, uuid,
} = ctx;

// One send of one draft, by the person who pressed the button. Used by the
// single "Send" and by "Send all reviewed", so the two cannot drift apart.
// FIX-12 Part 2: workflow recipes' emails arrive here as drafts too.
async function sendMilestoneDraft(req, draft, opts = {}) {
  const donorRows = await query("SELECT * FROM donors WHERE id=? AND org_id=?", [draft.donor_id, req.user.orgId]);
  const donor = donorRows[0];
  if (!donor || !donor.email) return { status: 400, error: "Donor has no email on file" };

  // PARITY-3 — a volunteer's shift reminder is transactional (FIX-14), so it is
  // asked as one: a marketing opt-out does not stop the reminder for a shift
  // they signed up for. Everything else here is asked as a milestone.
  // FIX-20 Part 5: an auction winner's pay link is service mail about a bid
  // they made, so it is asked as transactional too. A bounce or a complaint
  // still refuses it, and the auction screen offers its Copy link instead.
  const kind = draft.source === "volunteer_reminder" ? "volunteer_reminder"
    : String(draft.milestone_key || "").startsWith("auction-winner:") ? "auction_winner" : "milestone";
  const decision = await donorMailDecision(kind, donor.email, req.user.orgId);
  if (!decision.send) return { status: 400, error: `Cannot send: ${decision.reason === "deceased" ? "this donor is marked deceased" : decision.reason === "do_not_contact" ? "this donor is marked do-not-contact" : (mailPolicy.REASON_SENTENCE[decision.reason] || `this donor is suppressed (${String(decision.reason).replace(/_/g, " ")})`)}` };

  if (process.env.RESEND_API_KEY) {
    // PARITY-2 Part 4: a link in a draft (a winner's pay link, an auction
    // page, a video thank-you) is a link in the email, not text to retype.
    // Only http(s) links, matched AFTER escaping, so nothing typed can open a tag.
    const bodyHtml = `<p>${escapeHtml(draft.body).replace(/https?:\/\/[^\s<]+/g, u => `<a href="${u}">${u}</a>`)
      .replace(/\n\n+/g, "</p><p>").replace(/\n/g, "<br>")}</p>`
      + await unsubscribeEmailFooterHtml(donor.email, req.user.orgId, "sequence");
    try {
      // SEND-GATE-1: a person pressed Send on this draft. That press is the
      // confirm for this one message, so it goes whatever the person's
      // automatic-email switch says (Donor mail must still be on).
      const confirm = await SEND_GATE.recordStaffConfirm({ orgId: req.user.orgId, to: donor.email, what: draft.subject, by: actor(req) });
      const { error: sendErr } = await resend.emails.send({
        ...(await donorSendOpts(req.user.orgId, donor.email, "sequence")),
        to: donor.email, subject: draft.subject, html: bodyHtml, _stewardConfirm: confirm,
      });
      if (sendErr) return { status: 502, error: `Send failed: ${sendErr.message}` };
    } catch (e) {
      return { status: 502, error: `Send failed: ${e.message}` };
    }
  }

  const who = actor(req);
  await run(
    "UPDATE milestone_drafts SET status='sent', sent_at=NOW(), reviewed_by=?, reviewed_by_name=COALESCE(reviewed_by_name, ?) WHERE id=?",
    [req.user.userId, who.name, draft.id]
  );
  const today = orgToday(await orgTz(req.user.orgId));   // ORG_TZ_SEAM_OK (FIX-14 Part 2b)
  const intId = newId("i");
  await run(
    "INSERT INTO interactions (id, org_id, donor_id, type, note, date, created_by, logged_by_name, metadata) VALUES (?, ?, ?, 'email', ?, ?, ?, ?, ?)",
    [intId, req.user.orgId, draft.donor_id, `${draft.source ? "Email" : "Milestone email"}: ${draft.subject}`, today, who.id, who.name,
     opts.taskId ? JSON.stringify({ via: "task_email", taskId: opts.taskId, touch: "email" }) : null]
  ).catch(() => {});
  return { status: 200, interactionId: intId };
}

// PARITY-3 — the volunteer routes send their drafts through this one function.
if (typeof ctx.registerDraftSender === "function") ctx.registerDraftSender(sendMilestoneDraft);
return { sendMilestoneDraft };
}

module.exports = { mount };
