// SPLIT-2: moved VERBATIM from server.js (its functions from lines 10783-12375). server.js requires the boot modules in
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
let CAMPAIGN_GIFT_MATCH, DONOR_MAIL_ADDR, EV, EV_READY, GIVE_MONTHLY_DEFAULT, GIVE_ONETIME_DEFAULT, GMAIL_BASE, GRAPH_BASE, IMAGE_MAGIC, MAIL_KIND_HEADERS, MAX_UPLOAD_STR, MB, MB_READY, MEANINGFUL_CONTACT_TYPES, PORTAL_CARD_STYLES, PORTAL_DEFAULT_THEME, PORTAL_IMG_MIMES, PORTAL_TYPE_PAIRINGS, PUBLIC_BAR_GRANTS, PW, STORY_BLOCK_TYPES, SYS_AUTO, TL, UPLOAD_LONG_EDGE, addrOf, brandEmailHeaderHtml, campaignPageMod, consumerEmailHtml, crypto, displayNameCase, donorFacingOrgName, escHtmlWf, escapeHtml, fromWithDisplayName, imageSize, maybeStartJourneyFromServer, mbCents, newId, normalizeAccent, normalizeTint, openAdminTask, openCareThread, openThreadTx, orgTime, orgToday, orgTz, orgTzName, publicAppUrl, query, rbCentsEv, recordGift, run, safeFetch, sendDonorLifecycleEmail, stripe, syncMailbox, withAdvisoryLock, withTransaction;
__boot.register(c => {
  if ("CAMPAIGN_GIFT_MATCH" in c) CAMPAIGN_GIFT_MATCH = c.CAMPAIGN_GIFT_MATCH;
  if ("DONOR_MAIL_ADDR" in c) DONOR_MAIL_ADDR = c.DONOR_MAIL_ADDR;
  if ("EV" in c) EV = c.EV;
  if ("EV_READY" in c) EV_READY = c.EV_READY;
  if ("GIVE_MONTHLY_DEFAULT" in c) GIVE_MONTHLY_DEFAULT = c.GIVE_MONTHLY_DEFAULT;
  if ("GIVE_ONETIME_DEFAULT" in c) GIVE_ONETIME_DEFAULT = c.GIVE_ONETIME_DEFAULT;
  if ("GMAIL_BASE" in c) GMAIL_BASE = c.GMAIL_BASE;
  if ("GRAPH_BASE" in c) GRAPH_BASE = c.GRAPH_BASE;
  if ("IMAGE_MAGIC" in c) IMAGE_MAGIC = c.IMAGE_MAGIC;
  if ("MAIL_KIND_HEADERS" in c) MAIL_KIND_HEADERS = c.MAIL_KIND_HEADERS;
  if ("MAX_UPLOAD_STR" in c) MAX_UPLOAD_STR = c.MAX_UPLOAD_STR;
  if ("MB" in c) MB = c.MB;
  if ("MB_READY" in c) MB_READY = c.MB_READY;
  if ("MEANINGFUL_CONTACT_TYPES" in c) MEANINGFUL_CONTACT_TYPES = c.MEANINGFUL_CONTACT_TYPES;
  if ("PORTAL_CARD_STYLES" in c) PORTAL_CARD_STYLES = c.PORTAL_CARD_STYLES;
  if ("PORTAL_DEFAULT_THEME" in c) PORTAL_DEFAULT_THEME = c.PORTAL_DEFAULT_THEME;
  if ("PORTAL_IMG_MIMES" in c) PORTAL_IMG_MIMES = c.PORTAL_IMG_MIMES;
  if ("PORTAL_TYPE_PAIRINGS" in c) PORTAL_TYPE_PAIRINGS = c.PORTAL_TYPE_PAIRINGS;
  if ("PUBLIC_BAR_GRANTS" in c) PUBLIC_BAR_GRANTS = c.PUBLIC_BAR_GRANTS;
  if ("PW" in c) PW = c.PW;
  if ("STORY_BLOCK_TYPES" in c) STORY_BLOCK_TYPES = c.STORY_BLOCK_TYPES;
  if ("SYS_AUTO" in c) SYS_AUTO = c.SYS_AUTO;
  if ("TL" in c) TL = c.TL;
  if ("UPLOAD_LONG_EDGE" in c) UPLOAD_LONG_EDGE = c.UPLOAD_LONG_EDGE;
  if ("addrOf" in c) addrOf = c.addrOf;
  if ("brandEmailHeaderHtml" in c) brandEmailHeaderHtml = c.brandEmailHeaderHtml;
  if ("campaignPageMod" in c) campaignPageMod = c.campaignPageMod;
  if ("consumerEmailHtml" in c) consumerEmailHtml = c.consumerEmailHtml;
  if ("crypto" in c) crypto = c.crypto;
  if ("displayNameCase" in c) displayNameCase = c.displayNameCase;
  if ("donorFacingOrgName" in c) donorFacingOrgName = c.donorFacingOrgName;
  if ("escHtmlWf" in c) escHtmlWf = c.escHtmlWf;
  if ("escapeHtml" in c) escapeHtml = c.escapeHtml;
  if ("fromWithDisplayName" in c) fromWithDisplayName = c.fromWithDisplayName;
  if ("imageSize" in c) imageSize = c.imageSize;
  if ("maybeStartJourneyFromServer" in c) maybeStartJourneyFromServer = c.maybeStartJourneyFromServer;
  if ("mbCents" in c) mbCents = c.mbCents;
  if ("newId" in c) newId = c.newId;
  if ("normalizeAccent" in c) normalizeAccent = c.normalizeAccent;
  if ("normalizeTint" in c) normalizeTint = c.normalizeTint;
  if ("openAdminTask" in c) openAdminTask = c.openAdminTask;
  if ("openCareThread" in c) openCareThread = c.openCareThread;
  if ("openThreadTx" in c) openThreadTx = c.openThreadTx;
  if ("orgTime" in c) orgTime = c.orgTime;
  if ("orgToday" in c) orgToday = c.orgToday;
  if ("orgTz" in c) orgTz = c.orgTz;
  if ("orgTzName" in c) orgTzName = c.orgTzName;
  if ("publicAppUrl" in c) publicAppUrl = c.publicAppUrl;
  if ("query" in c) query = c.query;
  if ("rbCentsEv" in c) rbCentsEv = c.rbCentsEv;
  if ("recordGift" in c) recordGift = c.recordGift;
  if ("run" in c) run = c.run;
  if ("safeFetch" in c) safeFetch = c.safeFetch;
  if ("sendDonorLifecycleEmail" in c) sendDonorLifecycleEmail = c.sendDonorLifecycleEmail;
  if ("stripe" in c) stripe = c.stripe;
  if ("syncMailbox" in c) syncMailbox = c.syncMailbox;
  if ("withAdvisoryLock" in c) withAdvisoryLock = c.withAdvisoryLock;
  if ("withTransaction" in c) withTransaction = c.withTransaction;
});

// SPLIT-2 server.js piece 660
function mailKindHeaders(get) {
  const out = {};
  for (const n of MAIL_KIND_HEADERS) { const v = get(n); if (v) out[n] = String(v).slice(0, 200); }
  return out;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 661

function gmailToMessage(full) {
  const headers = full.payload?.headers || [];
  const hdr = n => headers.find(h => h.name.toLowerCase() === n)?.value || "";
  const walk = (part, acc) => {
    if (!part) return acc;
    if (part.mimeType === "text/plain" && part.body?.data) {
      acc.text += Buffer.from(part.body.data, "base64").toString("utf8");
    }
    if (part.filename && part.body?.attachmentId) {
      acc.attachments++;
      // Where to fetch it, if the message turns out to be to or from a funder
      // contact (GRANTS-1). Nothing is downloaded here.
      acc.parts.push({ fileName: part.filename, contentType: part.mimeType || "",
                       size: Number(part.body.size) || null, attachmentId: part.body.attachmentId });
    }
    for (const p of part.parts || []) walk(p, acc);
    return acc;
  };
  const acc = walk(full.payload, { text: "", attachments: 0, parts: [] });
  return {
    id: full.id,
    sent: Array.isArray(full.labelIds) && full.labelIds.includes("SENT"),
    threadKey: full.threadId || null,
    headers: mailKindHeaders(n => hdr(n)),
    from: addrOf(hdr("from")),
    to: hdr("to").split(",").map(addrOf).filter(Boolean),
    cc: hdr("cc").split(",").map(addrOf).filter(Boolean),
    subject: hdr("subject"),
    bodyText: acc.text || full.snippet || "",
    attachmentCount: acc.attachments,
    attachmentParts: acc.parts,
    date: new Date(Number(full.internalDate) || Date.now()).toISOString().slice(0, 10),
    receivedAt: new Date(Number(full.internalDate) || Date.now()).toISOString(),
  };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 662

/**
 * GRANTS-1 · THE ATTACHMENTS OF ONE MESSAGE, fetched only once the message is
 * known to be to or from a funder contact. Gmail hands each attachment over by
 * id as base64url; Graph lists them with their bytes as base64. A file over the
 * grant-document cap is listed with its size and never downloaded.
 */
async function fetchMailboxAttachments(providerKey, token, m) {
  const MAX = require("../../grantDocs").DOC_MAX_BYTES;
  const auth = { headers: { Authorization: "Bearer " + token } };
  if (providerKey === "google") {
    const out = [];
    for (const p of m.attachmentParts || []) {
      if (p.size && p.size > MAX) { out.push({ ...p, buffer: null }); continue; }
      const r = await fetch(`${GMAIL_BASE()}/gmail/v1/users/me/messages/${encodeURIComponent(m.id)}/attachments/${encodeURIComponent(p.attachmentId)}`, auth)
        .then(x => x.ok ? x.json() : null).catch(() => null);
      out.push({ ...p, buffer: r && r.data ? Buffer.from(String(r.data), "base64url") : null });
    }
    return out;
  }
  const list = await fetch(`${GRAPH_BASE()}/v1.0/me/messages/${encodeURIComponent(m.id)}/attachments`, auth)
    .then(x => x.ok ? x.json() : null).catch(() => null);
  if (!list) return null;
  return (list.value || [])
    .filter(a => a && !a.isInline && (!a["@odata.type"] || a["@odata.type"] === "#microsoft.graph.fileAttachment"))
    .map(a => ({ fileName: a.name || "", contentType: a.contentType || "", size: Number(a.size) || null,
                 buffer: a.contentBytes && !(Number(a.size) > MAX) ? Buffer.from(String(a.contentBytes), "base64") : null }));
}
// SPLIT-2 end
// SPLIT-2 server.js piece 663

function graphToMessage(m) {
  const html = m.body?.contentType === "html";
  const text = String(m.body?.content || "");
  const gh = n => ((m.internetMessageHeaders || []).find(h => String(h.name || "").toLowerCase() === n) || {}).value || "";
  return {
    id: m.id,
    threadKey: m.conversationId || null,
    headers: mailKindHeaders(gh),
    from: addrOf(m.from?.emailAddress?.address),
    to: (m.toRecipients || []).map(r => addrOf(r.emailAddress?.address)).filter(Boolean),
    cc: (m.ccRecipients || []).map(r => addrOf(r.emailAddress?.address)).filter(Boolean),
    subject: m.subject || "",
    bodyText: html ? text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : text,
    attachmentCount: m.hasAttachments ? 1 : 0,
    webLink: m.webLink || null,   // FIX-22: where the attachment can be opened
    date: String(m.receivedDateTime || m.sentDateTime || "").slice(0, 10),
    receivedAt: m.receivedDateTime || m.sentDateTime || new Date().toISOString(),
  };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 664

/**
 * A logged conversation closes an open Thread that asked for exactly this
 * contact with exactly this person. "Call or write to Marion" is done when
 * Marion gets an email.
 *
 * IT CLOSES AS AN OUTCOME, POINTING AT THE CONVERSATION. `threads_close_honest`
 * requires a closing interaction for an outcome close, which is the right
 * constraint: a thread that claims it was resolved has to name the thing that
 * resolved it. So this passes the interaction it just wrote.
 *
 * Only contact-shaped steps. A pledge reminder, a membership renewal or a
 * check-in on an ask are about something happening, not about having written,
 * and having written does not finish them.
 */
async function closeThreadStepForContact(orgId, donorId, date, interactionId) {
  const ML = await import("../../shared/mailboxLog.js");
  await query(
    `UPDATE threads SET closed_at=NOW(), close_kind='outcome', closing_interaction_id=?
      WHERE org_id=? AND donor_id=? AND closed_at IS NULL
        AND next_step_type = ANY(?)
        AND opened_on <= ?`,
    [interactionId, orgId, donorId, ML.CONTACT_STEP_TYPES, String(date || "9999-12-31")]).catch(() => {});
}
// SPLIT-2 end
// SPLIT-2 server.js piece 665

// ── INT-5 · EMITTING A WEBHOOK, AND DELIVERING IT ──────────────────────────
//
// `emitWebhook` QUEUES. It never posts inline, and it never throws into the
// caller: a donation must not fail because somebody's Zapier endpoint is down,
// and a gift write must not wait on a third party's server to answer.
async function emitWebhook(orgId, event, data) {
  const W = await import("../../shared/webhookOut.js");
  if (!W.isEvent(event)) return 0;
  const endpoints = await query(
    `SELECT id, events FROM webhook_endpoints WHERE org_id=? AND paused_at IS NULL`, [orgId]);
  let queued = 0;
  for (const e of endpoints) {
    const subscribed = Array.isArray(e.events) ? e.events : [];
    if (!subscribed.includes(event)) continue;
    const id = newId("whd");
    const payload = W.eventPayload({ event, orgId, data, id, sentAt: new Date().toISOString() });
    await run(
      `INSERT INTO webhook_deliveries (id,org_id,endpoint_id,event,payload,attempt,next_attempt_at)
       VALUES (?,?,?,?,?::jsonb,0,NOW())`,
      [id, orgId, e.id, event, JSON.stringify(payload)]).catch(() => {});
    queued++;
  }
  return queued;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 666

/**
 * THE DELIVERY PASS. Everything due, signed and posted, with the outcome and
 * the next attempt written back.
 *
 * The signature covers the timestamp AND the body, and the receiver is told to
 * reject anything older than five minutes. A bare HMAC of the body proves where
 * it came from and nothing about when, so anyone who captures one delivery can
 * replay it for ever.
 */
async function deliverWebhooks() {
  const W = await import("../../shared/webhookOut.js");
  const due = await query(
    `SELECT d.*, e.url, e.secret, e.consecutive_failures
       FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id = d.endpoint_id
      WHERE d.delivered_at IS NULL AND d.gave_up_at IS NULL
        AND d.next_attempt_at IS NOT NULL AND d.next_attempt_at <= NOW()
        AND e.paused_at IS NULL
      ORDER BY d.next_attempt_at ASC LIMIT 50`);
  let sent = 0, failed = 0;
  for (const d of due) {
    const attempt = (Number(d.attempt) || 0) + 1;
    const body = JSON.stringify(d.payload);
    const t = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac("sha256", d.secret).update(W.signatureBase(t, body)).digest("hex");
    let status = 0, errText = null;
    // The endpoint is an address an admin typed, so it goes through the one
    // safe fetch (FIX-43): never a private or metadata address, never a
    // redirect (a signed body is posted where it was pointed, nowhere else).
    const r = await safeFetch(d.url, {
      method: "POST", schemes: ["https:"], maxRedirects: 0, maxBytes: 64 * 1024, overflow: "truncate", timeoutMs: 10000,
      headers: { "Content-Type": "application/json",
                 [W.SIGNATURE_HEADER]: W.signatureHeader(t, sig),
                 "user-agent": "Steward-Webhooks/1" },
      body,
    });
    status = r.status || 0;
    if (!r.status && r.reason) errText = String(r.reason).slice(0, 200);

    const outcome = W.deliveryOutcome(status);
    if (outcome.ok) {
      await run(`UPDATE webhook_deliveries SET attempt=?, status=?, outcome=?, delivered_at=NOW(), next_attempt_at=NULL WHERE id=?`,
        [attempt, status, outcome.reason, d.id]);
      await run(`UPDATE webhook_endpoints SET consecutive_failures=0, last_delivered_at=NOW(), last_status=?, updated_at=NOW() WHERE id=?`,
        [status, d.endpoint_id]);
      sent++;
      continue;
    }
    failed++;
    const delay = outcome.retry ? W.nextAttemptDelay(attempt) : null;
    await run(
      `UPDATE webhook_deliveries SET attempt=?, status=?, outcome=?, error=?,
              next_attempt_at=${delay ? "NOW() + (? || ' seconds')::interval" : "NULL"},
              gave_up_at=${delay ? "NULL" : "NOW()"}
        WHERE id=?`,
      delay ? [attempt, status, outcome.reason, errText, String(delay), d.id]
            : [attempt, status, outcome.reason, errText, d.id]);
    const fails = (Number(d.consecutive_failures) || 0) + 1;
    await run(`UPDATE webhook_endpoints SET consecutive_failures=?, last_status=?, updated_at=NOW() WHERE id=?`,
      [fails, status, d.endpoint_id]);
    // AN ENDPOINT THAT KEEPS FAILING IS PAUSED AND SOMEBODY IS TOLD. A webhook
    // that died quietly is how an organisation finds out in March that its
    // automation stopped in January.
    if (W.shouldPause(fails)) {
      await run(`UPDATE webhook_endpoints SET paused_at=NOW() WHERE id=? AND paused_at IS NULL`, [d.endpoint_id]);
      await openWebhookThread(d.org_id, d.url, fails).catch(() => {});
    }
  }
  return { sent, failed };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 667

// The admin's Thread step when an endpoint is paused. It uses the Thread that
// already exists rather than a second notification system.
async function openWebhookThread(orgId, url, failures) {
  const W = await import("../../shared/webhookOut.js");
  const [admin] = await query(`SELECT id, name FROM users WHERE org_id=? AND role='admin' ORDER BY created_at LIMIT 1`, [orgId]);
  if (!admin) return;
  const today = orgToday(await orgTz(orgId));                          // ORG_TZ_SEAM_OK
  const [d] = await query(`SELECT id FROM donors WHERE org_id=? AND deleted_at IS NULL ORDER BY created_at LIMIT 1`, [orgId]);
  if (!d) return;   // a Thread hangs off a person; with nobody on file there is nowhere to put it
  await run(
    `INSERT INTO threads (id,org_id,donor_id,next_step_type,next_step_label,due_date,opened_on,
                          owner_id,owner_name,created_by,created_by_name)
     VALUES (?,?,?,'follow_up',?,?,?,?,?,'system:webhooks','Webhook delivery')
     ON CONFLICT DO NOTHING`,
    [newId("th_wh"), orgId, d.id,
     W.pauseSentence(url, failures).slice(0, 200), today, today, admin.id, admin.name]).catch(() => {});
}
// SPLIT-2 end
// SPLIT-2 server.js piece 668

// The old name, kept so the job tick and the manual button keep working.
async function syncGmail(userId, orgId) { return syncMailbox(userId, orgId, "google"); }
// SPLIT-2 end
// SPLIT-2 server.js piece 672

async function levelTaken(levelId) {
  const [r] = await query("SELECT COALESCE(SUM(quantity),0)::int AS n FROM event_attendees WHERE level_id=? AND status <> 'cancelled'", [levelId]);
  return r?.n || 0;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 673

// The one registration writer. `giftId` is passed when the money already
// exists (the Stripe webhook wrote it); otherwise this writes the gift, or the
// sponsor's pledge, itself. Returns the attendee row.
async function registerForEvent({ orgId, event, level, donorId, qty, paid = true, giftId = null,
                                  paymentMethod = null, date = null, idemKey = null, who,
                                  guests = [], dietary = null, notify = false }) {
  await EV_READY;
  const split = EV.ticketSplit({ priceCents: rbCentsEv(level.price), fmvCents: rbCentsEv(level.fmv), qty });
  const [donor] = await query("SELECT id, name, email FROM donors WHERE id=? AND org_id=?", [donorId, orgId]);
  if (!donor) throw Object.assign(new Error("Donor not found"), { status: 404 });
  if (level.capacity != null && !giftId) {
    // EVENTS-2 — a seat somebody is paying for right now is a seat taken. The
    // office adding a walk-in must not be handed the same chair as the person
    // holding a phone at the door with a Checkout page open on it.
    const taken = await levelTaken(level.id);
    const [h] = await query(`SELECT COALESCE(SUM(qty),0)::int AS n FROM event_seat_holds
                              WHERE level_id=? AND released_at IS NULL AND confirmed_at IS NULL AND expires_at > NOW()`, [level.id]);
    const used = taken + (h?.n || 0);
    if (used + split.qty > level.capacity)
      throw Object.assign(new Error(`${level.name} has ${Math.max(0, level.capacity - used)} places left.`), { status: 409 });
  }
  const day = date || orgToday(await orgTz(orgId));           // ORG_TZ_SEAM_OK
  let pledgeId = null;
  if (!giftId && (paid || level.kind === "ticket")) {
    // A ticket is always money (it cannot be pledged); a sponsorship may be.
    const written = await recordGift({
      orgId, donorId, amount: split.totalCents / 100, date: day, type: "cash", door: "event_checkin",
      campaign: event.name, notes: `${split.qty} × ${level.name}, ${event.name}`,
      paymentMethod, idempotencyKey: idemKey, conflict: idemKey ? "idempotency" : null,
      quidProQuoValue: split.fmvCents / 100,
      quidProQuoDesc: EV.quidProQuoDescription({ eventName: event.name, levelName: level.name, qty: split.qty, kind: level.kind }),
      actorId: who.id, actorName: who.name, source: "event",
      ledgerDescription: `${level.name}, ${event.name}`,
      timelineNote: `${level.kind === "sponsor" ? "Sponsored" : "Bought " + (split.qty === 1 ? "a ticket" : split.qty + " tickets")} for ${event.name}`,
    });
    if (written.duplicate) {
      const [g] = await query("SELECT id FROM gifts WHERE org_id=? AND idempotency_key=?", [orgId, idemKey]);
      giftId = g?.id || null;
    } else giftId = written.gift.id;
  } else if (!giftId) {
    // An unpaid sponsorship is a promise: a pledge due on the event day,
    // attributed to nothing but itself. It is NOT money until it arrives.
    // HARDEN-1: events.date is a DATE, so pg hands a Date; String(Date) is
    // "Thu Jan 01 2026 …", which sorted above every ISO day and became the due date.
    const evDay = orgTime.civilOf(event.date);
    const dueOn = evDay && evDay > day ? evDay : day;
    // FIX-60: the one pledge writer, one installment of the whole sponsorship
    ({ id: pledgeId } = await PW.writePledge({ orgId, donorId, amountCents: split.totalCents, dueDate: dueOn,
      notes: `Sponsorship: ${level.name}, ${event.name}`, createdBy: who.id, createdByName: who.name,
      plan: { firstDue: dueOn } }, { door: "event_checkin" }));
  }
  // EVENTS-1 — stamp WHICH EVENT this gift is, so "raised" is a sum over an
  // id rather than a match on a name that somebody may rename tonight.
  //
  // EVENTS-2 moved it OUT of the branch above. It only ran when this function
  // wrote the gift itself, so every ticket bought online — where the webhook
  // writes the gift and hands the id in — left its money unstamped, and the
  // event's raised figure counted nothing that was actually paid for on the
  // public page. That is the whole of what this build sells.
  if (giftId) await run("UPDATE gifts SET event_id=? WHERE id=? AND org_id=? AND event_id IS NULL", [event.id, giftId, orgId]);
  const recognition = level.kind === "sponsor" ? EV.recognitionLine({ donorName: donor.name, levelName: level.name, recognition: level.recognition }) : null;
  const id = newId("att");
  const rows = await query(
    `INSERT INTO event_attendees (id,event_id,org_id,donor_id,name,email,status,level_id,quantity,registration_gift_id,sponsor_pledge_id,recognition,gift_amount)
     VALUES (?,?,?,?,?,?,'registered',?,?,?,?,?,?)
     ON CONFLICT (event_id, donor_id) DO UPDATE SET
       level_id=EXCLUDED.level_id, quantity=event_attendees.quantity + EXCLUDED.quantity,
       registration_gift_id=COALESCE(EXCLUDED.registration_gift_id, event_attendees.registration_gift_id),
       sponsor_pledge_id=COALESCE(EXCLUDED.sponsor_pledge_id, event_attendees.sponsor_pledge_id),
       recognition=COALESCE(EXCLUDED.recognition, event_attendees.recognition),
       status=CASE WHEN event_attendees.status='cancelled' THEN 'registered' ELSE event_attendees.status END
     RETURNING *`,
    [id, event.id, orgId, donorId, donor.name, donor.email || "", level.id, split.qty, giftId, pledgeId, recognition, split.totalCents / 100]);
  const attendee = rows[0];
  // WIRE-1: a registration with no money (an unpaid sponsorship) wrote no
  // line; a paid one already shows as its gift.
  if (!giftId) await TL.timelineLine({ orgId, donorId, type: "event", note: `Registered for ${event.name}.`,
    actorId: who.id, actorName: who.name, key: `event_registered:${attendee.id}`,
    metadata: { via: "event_registration", event_id: event.id, attendee_id: attendee.id } });
  if (dietary) await run(`UPDATE event_attendees SET dietary=? WHERE id=? AND org_id=?`, [dietary, attendee.id, orgId]).catch(() => {});
  // EVENTS-2 — the other names on the ticket. Each is a place and a name tag
  // and NOT a second gift: quantity 0, guest_of the buyer, exactly as the
  // free registration page has always written them.
  for (const g of (guests || []).slice(0, 10)) {
    if (!g || g.toLowerCase() === String(donor.name || "").toLowerCase()) continue;
    // JOURNEYS-4 — the guest is a person record of their own (personMatch.js).
    const gid = await require("../../personMatch").findOrCreateGuest(orgId, String(g), who).catch(() => null);
    await run(`INSERT INTO event_attendees (id,event_id,org_id,donor_id,name,status,level_id,quantity,source,guest_of,notes)
               VALUES (?,?,?,?,?,'registered',?,0,'public',?,?) ON CONFLICT (event_id, donor_id) DO NOTHING`,
      [newId("att"), event.id, orgId, gid, String(g).slice(0, 200), level.id, attendee.id, `Guest of ${donor.name}.`]).catch(() => {});
  }
  // EVENTS-2 — the confirmation, sent only when somebody paid on the public
  // page. It is transactional (they were just charged for a seat), and it
  // carries the ticket's QR as an IMAGE URL rather than a data: URI, because
  // no email client renders a data: URI.
  if (notify && donor.email) {
    await sendEventTicketEmail({ orgId, event, level, attendee, split, guestCount: guests.length })
      .catch(e => console.error("[event] confirmation email:", e.message));
  }
  return { attendee, giftId, pledgeId, split };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 674

// The ticket in an inbox: what they bought, when and where it is, the code
// the door reads, and the one page that holds it afterwards.
async function sendEventTicketEmail({ orgId, event, level, attendee, split, guestCount = 0 }) {
  await EV_READY;
  const PASS = await import("../../shared/passCode.js");
  const [org] = await query("SELECT id, name, org_slug FROM orgs WHERE id=?", [orgId]);
  const display = await donorFacingOrgName(orgId, org?.name).catch(() => org?.name || "");
  const day = orgTime.civilOf(event.date);   // HARDEN-1: toISOString() on pg's local-midnight Date is the day before east of UTC
  const code = PASS.makePassCode({ kind: "ticket", orgId, id: attendee.id, expiresOn: day, secret: process.env.JWT_SECRET || "" });
  const base = publicAppUrl();
  const when = new Date(day + "T12:00:00Z").toLocaleDateString("en-US",
    { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  const deductible = (split.totalCents - split.fmvCents) / 100;
  const html = await brandEmailHeaderHtml(orgId) + `
    <div style="font-family:Georgia,'Times New Roman',serif;max-width:520px;margin:0 auto;padding:24px;color:#0f1a12;">
      <p>You are coming to <strong>${escapeHtml(event.name)}</strong>.</p>
      <p>${escapeHtml(when)}${event.location ? `<br>${escapeHtml(event.location)}` : ""}</p>
      <p>${escapeHtml(level.name)}${split.qty > 1 ? ` · ${split.qty} places` : ""}${guestCount ? ` · ${guestCount} guest${guestCount === 1 ? "" : "s"} named` : ""}.
         ${split.fmvCents > 0 ? `$${deductible.toLocaleString("en-US", { minimumFractionDigits: 2 })} of what you paid is tax deductible; your receipt states it.` : "The whole amount is tax deductible."}</p>
      <p style="text-align:center;margin:26px 0;">
        <img src="${base}/ticket/${encodeURIComponent(code)}.png" alt="Your ticket code" width="200" height="200" style="display:block;margin:0 auto;">
      </p>
      <p style="font-size:13px;color:#555;text-align:center;">Show this at the door.</p>
      <p style="font-size:13px;color:#555;">Your ticket, your receipts and everything else you have with ${escapeHtml(display)} live on one page:
         <a href="${base}/you/${encodeURIComponent(org?.org_slug || "")}">open your page</a>. It never asks for a password.</p>
      ${event.location ? `<p style="font-size:13px;color:#555;"><a href="https://maps.google.com/?q=${encodeURIComponent(event.location)}">Directions</a> · <a href="${base}/e/${encodeURIComponent(event.public_slug || "")}/calendar.ics">Add to calendar</a></p>` : ""}
    </div>`;
  await sendDonorLifecycleEmail("event_ticket", attendee.email,
    `Your ticket for ${event.name}`, html, fromWithDisplayName(display, DONOR_MAIL_ADDR()), event.org_id);
}
// SPLIT-2 end
// SPLIT-2 server.js piece 678

// Put a person on a level. The membership row is CLAIMED FIRST, so the
// one-current-membership index — not an if-statement — refuses a second one
// before any money is written; if the gift then fails, the claim is released.
async function enrollMembership({ orgId, donorId, level, startsOn = null, paid = true, paymentMethod = null,
                                  idemKey = null, source = "staff", who, existingGiftId = null }) {
  await MB_READY;
  const [donor] = await query(`SELECT id, name, household_id FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL`, [donorId, orgId]);
  if (!donor) throw Object.assign(new Error("Donor not found"), { status: 404 });
  if (idemKey) {
    const [prior] = await query(`SELECT m.* FROM memberships m JOIN gifts g ON g.id=m.gift_id WHERE m.org_id=? AND g.idempotency_key=?`, [orgId, idemKey]);
    if (prior) return { membership: prior, duplicate: true };
  }
  const today = orgToday(await orgTz(orgId)); // ORG_TZ_SEAM_OK
  const start = startsOn || today;
  const expires = MB.expiryFor({ term: level.term, startsOn: start });
  const id = newId("mb");
  try {
    await run(`INSERT INTO memberships (id,org_id,donor_id,household_id,level_id,joined_on,starts_on,expires_on,status,payment_method,source,created_by,created_by_name)
               VALUES (?,?,?,?,?,?,?,?,'active',?,?,?,?)`,
      [id, orgId, donorId, level.scope === "household" ? donor.household_id || null : null, level.id, start, start, expires,
       paid ? paymentMethod : "complimentary", source, who.id, who.name]);
  } catch (e) {
    if (e.code !== "23505") throw e;
    const [cur] = await query(`SELECT m.expires_on, l.name FROM memberships m JOIN membership_levels l ON l.id=m.level_id
                                WHERE m.org_id=? AND m.donor_id=? AND m.status IN ('active','grace')`, [orgId, donorId]);
    throw Object.assign(new Error(`${donor.name} already holds a ${cur ? cur.name : "current"} membership${cur && cur.expires_on ? ", through " + cur.expires_on : ""}. Renew it rather than adding a second.`),
      { status: 409, code: "membership_current" });
  }
  let giftId = existingGiftId;
  if (existingGiftId) {
    await run(`UPDATE memberships SET gift_id=?, updated_at=NOW() WHERE id=? AND org_id=?`, [existingGiftId, id, orgId]);
  } else if (paid) {
    try {
      const written = await recordGift({
        orgId, donorId, amount: mbCents(level.price) / 100, date: today, type: "cash",
        notes: `${level.name} membership`, paymentMethod, idempotencyKey: idemKey, conflict: idemKey ? "idempotency" : null,
        quidProQuoValue: mbCents(level.fmv) / 100, membershipRenewal: false,
        quidProQuoDesc: MB.quidProQuoDescription({ levelName: level.name, benefits: level.benefits || [] }),
        actorId: who.id, actorName: who.name, source: "membership",
        ledgerDescription: `${level.name} membership`,
        timelineNote: `Joined as a ${level.name} member${expires ? ", through " + expires : ""}`,
      });
      giftId = written.duplicate ? (await query(`SELECT id FROM gifts WHERE org_id=? AND idempotency_key=?`, [orgId, idemKey]))[0]?.id || null
                                 : written.gift.id;
    } catch (e) {
      await run(`DELETE FROM memberships WHERE id=? AND org_id=?`, [id, orgId]).catch(() => {});
      throw e;
    }
    await run(`UPDATE memberships SET gift_id=?, updated_at=NOW() WHERE id=? AND org_id=?`, [giftId, id, orgId]);
  }
  const [m] = await query(`SELECT * FROM memberships WHERE id=?`, [id]);
  // WIRE-1: a paid join already shows as its gift ("Joined as a ... member");
  // a complimentary one wrote nothing.
  if (!giftId) await TL.timelineLine({ orgId, donorId, note: `Became a ${level.name} member${expires ? ", through " + expires : ""}.`,
    date: start, actorId: who.id, actorName: who.name, key: `membership_joined:${id}`,
    metadata: { via: "membership", membership_id: id, complimentary: true } });
  // FIX-4 1c — becoming a member can start a journey. Only a NEW membership,
  // never a renewal: a renewal is a person continuing, and greeting a
  // ten-year member with a welcome sequence is worse than saying nothing.
  // The unique index above has already refused a second current membership,
  // so this cannot fire twice for the same person.
  await maybeStartJourneyFromServer(orgId, donorId, "became_member", { membershipId: id });
  // PARITY-1 Part D — and the payment for it is a membership payment.
  if (giftId) await maybeStartJourneyFromServer(orgId, donorId, "membership_payment", { giftId, membershipId: id });
  return { membership: m, giftId };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 679

// ── BUILD-101 Part 2 — RENEWALS THAT COME AROUND ──────────────────────────
// Expiry drives everything. The org's two numbers (how early the renewal
// thread opens, how long an expired membership sits in grace) are read here,
// once, with their defaults.
async function membershipSettings(orgId) {
  await MB_READY;
  const [o] = await query("SELECT membership_renewal_days, membership_grace_days FROM orgs WHERE id=?", [orgId]);
  const n = (v, d) => (Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 365 ? Number(v) : d);
  return { renewalDays: n(o?.membership_renewal_days, MB.DEFAULT_RENEWAL_DAYS), graceDays: n(o?.membership_grace_days, MB.DEFAULT_GRACE_DAYS) };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 680

// THE ONE PLACE A MEMBERSHIP IS RENEWED. The old row becomes 'renewed' and a
// new term begins the day after the OLD expiry while it is still current or in
// grace — so paying early never costs a member time — or today once it has
// lapsed. Serialised per person, because two doors can take the same cheque.
// `attachGift` is either an existing gift (a payment recordGift recognised as
// this renewal) or null, in which case this writes the payment itself.
async function renewMembership({ orgId, membershipId, levelId = null, paymentMethod = null, idemKey = null,
                                 existingGiftId = null, who, source = "staff" }) {
  await MB_READY;
  const [old] = await query(`SELECT * FROM memberships WHERE id=? AND org_id=?`, [membershipId, orgId]);
  if (!old) throw Object.assign(new Error("Not found"), { status: 404 });
  const [level] = await query(`SELECT * FROM membership_levels WHERE id=? AND org_id=?`, [levelId || old.level_id, orgId]);
  if (!level) throw Object.assign(new Error("Level not found"), { status: 404 });
  if (level.active === false) throw Object.assign(new Error(`${level.name} is retired. Choose a current level.`), { status: 400 });
  if (level.term === "lifetime" && old.status !== "lapsed")
    throw Object.assign(new Error("A lifetime membership does not renew."), { status: 400 });
  if (idemKey) {
    const [prior] = await query(`SELECT m.* FROM memberships m JOIN gifts g ON g.id=m.gift_id WHERE m.org_id=? AND g.idempotency_key=?`, [orgId, idemKey]);
    if (prior) return { membership: prior, duplicate: true };
  }
  return withAdvisoryLock(`membership:${orgId}:${old.donor_id}`, async () => {
    const [cur] = await query(`SELECT status, expires_on FROM memberships WHERE id=? AND org_id=?`, [old.id, orgId]);
    if (cur.status === "renewed" || cur.status === "cancelled")
      throw Object.assign(new Error(`This membership was already ${cur.status}.`), { status: 409, code: "membership_" + cur.status });
    const today = orgToday(await orgTz(orgId));                 // ORG_TZ_SEAM_OK
    const continuing = cur.status === "active" || cur.status === "grace";
    const start = MB.renewalStart({ oldExpires: cur.expires_on, today, lapsed: !continuing });
    const expires = MB.expiryFor({ term: level.term, startsOn: start });
    const id = newId("mb");
    if (continuing) await run(`UPDATE memberships SET status='renewed', status_changed_on=?, updated_at=NOW() WHERE id=? AND org_id=?`, [today, old.id, orgId]);
    try {
      await run(`INSERT INTO memberships (id,org_id,donor_id,household_id,level_id,joined_on,starts_on,expires_on,status,payment_method,source,renewed_from,created_by,created_by_name)
                 VALUES (?,?,?,?,?,?,?,?,'active',?,?,?,?,?)`,
        [id, orgId, old.donor_id, old.household_id, level.id, continuing ? old.joined_on : start, start, expires,
         paymentMethod, source, old.id, who.id, who.name]);
    } catch (e) {
      if (continuing) await run(`UPDATE memberships SET status=?, updated_at=NOW() WHERE id=? AND org_id=?`, [cur.status, old.id, orgId]);
      if (e.code === "23505") throw Object.assign(new Error("This person already holds a current membership. Renew that one."), { status: 409, code: "membership_current" });
      throw e;
    }
    const undo = async () => {
      await run(`DELETE FROM memberships WHERE id=? AND org_id=?`, [id, orgId]).catch(() => {});
      if (continuing) await run(`UPDATE memberships SET status=?, updated_at=NOW() WHERE id=? AND org_id=?`, [cur.status, old.id, orgId]).catch(() => {});
    };
    const fmv = mbCents(level.fmv) / 100;
    const qpqDesc = MB.quidProQuoDescription({ levelName: level.name, benefits: level.benefits || [] });
    let giftId = existingGiftId;
    try {
      if (existingGiftId) {
        // A payment that arrived through another door and was recognised as
        // this renewal. It bought the same benefits a renewal buys, so it
        // carries the same split — and says so on the timeline.
        await run(`UPDATE gifts SET quid_pro_quo_value=?, quid_pro_quo_desc=?, deductible_amount=GREATEST(0, amount - ?)
                    WHERE id=? AND org_id=?`, [fmv, qpqDesc, fmv, existingGiftId, orgId]);
      } else {
        const written = await recordGift({
          orgId, donorId: old.donor_id, amount: mbCents(level.price) / 100, date: today, type: "cash",
          notes: `${level.name} membership renewal`, paymentMethod, idempotencyKey: idemKey, conflict: idemKey ? "idempotency" : null,
          quidProQuoValue: fmv, quidProQuoDesc: qpqDesc, membershipRenewal: false,
          actorId: who.id, actorName: who.name, source: "membership",
          ledgerDescription: `${level.name} membership renewal`,
          timelineNote: `Renewed the ${level.name} membership${expires ? ", through " + expires : ""}`,
        });
        giftId = written.duplicate ? (await query(`SELECT id FROM gifts WHERE org_id=? AND idempotency_key=?`, [orgId, idemKey]))[0]?.id || null
                                   : written.gift.id;
      }
    } catch (e) { await undo(); throw e; }
    await run(`UPDATE memberships SET gift_id=?, updated_at=NOW() WHERE id=? AND org_id=?`, [giftId, id, orgId]);
    // The renewal thread closes as an OUTCOME, on the payment's own timeline
    // line — the honest close (threads_close_honest), because the thing the
    // thread asked for happened.
    if (old.renewal_thread_id && giftId) {
      const [line] = await query(`SELECT id FROM interactions WHERE org_id=? AND gift_id=? ORDER BY created_at LIMIT 1`, [orgId, giftId]);
      if (line) await run(`UPDATE threads SET closed_at=NOW(), close_kind='outcome', closing_interaction_id=?
                            WHERE id=? AND org_id=? AND closed_at IS NULL`, [line.id, old.renewal_thread_id, orgId]);
    }
    const [m] = await query(`SELECT * FROM memberships WHERE id=?`, [id]);
    return { membership: m, giftId, startsOn: start, expiresOn: expires,
             sentence: continuing ? `The new term starts the day after the old one ends (${start}), so renewing early cost no time.`
                                  : `The membership had lapsed, so the new term starts today.` };
  });
}
// SPLIT-2 end
// SPLIT-2 server.js piece 681

// Called from recordGift, the door every payment passes through: a gift of
// EXACTLY a level's price from a person whose membership at that level is due
// (inside the renewal window, or in grace) IS that renewal. Within a few
// dollars is deliberately NOT matched — the pledge-instalment rule: a near
// miss is a question, and a background path has nobody to ask.
async function applyGiftAsMembershipRenewal({ orgId, donorId, giftId, amount, actorId, actorName }) {
  await MB_READY;
  const cents = Math.round(Number(amount) * 100);
  if (!(cents > 0)) return null;
  const { renewalDays } = await membershipSettings(orgId);
  const today = orgToday(await orgTz(orgId));                   // ORG_TZ_SEAM_OK
  const [m] = await query(
    `SELECT m.id FROM memberships m JOIN membership_levels l ON l.id=m.level_id AND l.org_id=m.org_id
      WHERE m.org_id=? AND m.donor_id=? AND m.status IN ('active','grace') AND m.expires_on IS NOT NULL
        AND l.active IS NOT FALSE AND round(l.price::numeric * 100)::bigint = ?
        AND l.term <> ALL(?::text[])   -- PARITY-2: a monthly level is never "due" from a plain gift
        AND (m.status='grace' OR m.expires_on <= ?)
      LIMIT 1`, [orgId, donorId, cents, MB.NO_RENEWAL_THREAD_TERMS, MB.addDaysCivil(today, renewalDays)]);
  if (!m) return null;
  return renewMembership({ orgId, membershipId: m.id, existingGiftId: giftId, source: "payment",
                           who: { id: actorId || SYS_AUTO.id, name: actorName || SYS_AUTO.name } });
}
// SPLIT-2 end
// SPLIT-2 server.js piece 682

// The sweep. Two jobs, both idempotent by construction:
//   1. write down each membership's status from its dates (active → grace →
//      lapsed); the status is DERIVED, this only records it;
//   2. open ONE renewal thread per membership whose expiry is inside the
//      window, with the note already drafted in the org's voice. Recorded
//      against that expiry (`renewal_thread_for`), so a second sweep over the
//      same date opens nothing; `threads_one_open` means a person with a thread
//      already open is left alone and tried again next time. It sends nothing.
// WIRE-1 · AN AUCTION ITEM WON AND NOT PAID FOR IS A PERSON TO CALL.
// Two days after an item closed with a winning bid and no payment, one step
// opens on the Thread for the winner's person record. The winner is decided
// by auctionCore (the one place that says who won), never re-derived here.
// Idempotent: the thread is remembered on the item, and an item whose winner
// already holds an open step waits for the next pass. Sends nothing.
async function processAuctionUnpaid(onlyOrgId = null) {
  const AC = require("../../auctionCore");
  const out = { auctions: 0, opened: 0, waiting: 0, orgs: [] };
  const auctions = await query(
    `SELECT a.id, a.org_id, a.title, a.closes_at FROM auctions a
      WHERE (?::text IS NULL OR a.org_id = ?)
        AND a.closes_at > NOW() - INTERVAL '90 days'
        AND (a.closes_at <= NOW() - INTERVAL '2 days'
             OR EXISTS (SELECT 1 FROM auction_items i WHERE i.org_id = a.org_id AND i.auction_id = a.id AND i.closed_at <= NOW() - INTERVAL '2 days'))`,
    [onlyOrgId, onlyOrgId]);
  const cutoff = Date.now() - 2 * 86400000;
  for (const a of auctions) {
    out.auctions++;
    const items = await AC.itemStates(query, a.org_id, a.id);
    for (const it of items) {
      if (!it.closed || !it.bid_id || it.paid_gift_id || it.paid_at || !it.bidder_donor_id) continue;
      const closedAt = Math.min(new Date(a.closes_at).getTime(), it.closed_at ? new Date(it.closed_at).getTime() : Infinity);
      if (closedAt > cutoff) continue;
      const [row] = await query(`SELECT unpaid_thread_id FROM auction_items WHERE id=? AND org_id=?`, [it.id, a.org_id]);
      if (!row || row.unpaid_thread_id) continue;
      const amount = Number(it.high_amount || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
      const th = await openCareThread(a.org_id, it.bidder_donor_id, {
        label: `Won ${it.title} for ${amount}, not paid yet: send the pay link`, dueInDays: 1, path: "auction-unpaid" });
      if (!th) { out.waiting++; continue; }
      await run(`UPDATE auction_items SET unpaid_thread_id=?, updated_at=NOW() WHERE id=? AND org_id=? AND unpaid_thread_id IS NULL`,
        [th.id, it.id, a.org_id]);
      out.opened++;
      if (!out.orgs.includes(a.org_id)) out.orgs.push(a.org_id);
    }
  }
  return out;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 683

// THREAD-3 · A DONOR'S EMAIL THAT NEEDS A REPLY BECOMES A STEP.
// An email logged from a connected mailbox, from a person on file, of kind
// "personal" (shared/mailboxLog.js mailKind: never a newsletter, a receipt or
// an automatic reply), from the last fortnight, with no reply after one
// business day. A reply is an email she wrote to that person afterwards, or a
// call, meeting or email a person here logged by hand, dated on or after it. One step per person,
// naming the latest subject; when the person already has an open step, a task
// for their owner (or the mailbox's owner) instead, so it does not wait
// behind something else. Each email is claimed once in mail_reply_steps.
// Writes a thread or a task and nothing else: nothing is drafted or sent.
async function processUnansweredMail(onlyOrgId = null, { now = new Date() } = {}) {
  const ML = await import("../../shared/mailboxLog.js");
  const out = { emails: 0, opened: 0, tasks: 0, orgs: [] };
  const rows = await query(
    `SELECT i.id, i.org_id, i.donor_id, i.created_at, i.metadata->>'subject' AS subject, i.metadata->>'logged_by' AS mailbox_user,
            d.name, d.assigned_to, d.assigned_to_name
       FROM interactions i
       JOIN donors d ON d.id = i.donor_id AND d.org_id = i.org_id
      WHERE (?::text IS NULL OR i.org_id = ?)
        AND i.type = 'email' AND i.metadata->>'direction' = 'inbound' AND i.metadata->>'mail_kind' = 'personal'
        AND i.created_at > ?::timestamptz - (? || ' days')::interval
        AND d.deleted_at IS NULL AND d.is_sample IS NOT TRUE AND d.deceased IS NOT TRUE
        AND NOT EXISTS (SELECT 1 FROM mail_reply_steps r WHERE r.org_id = i.org_id AND r.interaction_id = i.id)
        AND NOT EXISTS (SELECT 1 FROM interactions o WHERE o.org_id = i.org_id AND o.donor_id = i.donor_id AND o.created_at > i.created_at
              -- written after the email AND dated on or after its day: history an
              -- import or a seed wrote today about last year is not a reply.
              AND LEFT(o.date::text, 10) >= LEFT(i.date::text, 10)
              AND (o.metadata->>'direction' = 'outbound'
                   OR (o.type IN ('email','call','meeting') AND COALESCE(o.metadata->>'direction','') <> 'inbound'
                       AND COALESCE(o.created_by,'') NOT LIKE 'system:%')))
      ORDER BY i.created_at DESC`,
    [onlyOrgId, onlyOrgId, now.toISOString(), String(ML.REPLY_LOOKBACK_DAYS)]);
  const tzs = new Map();
  const byPerson = new Map();
  for (const r of rows) {
    if (!tzs.has(r.org_id)) tzs.set(r.org_id, await orgTz(r.org_id));
    const tz = tzs.get(r.org_id);
    // The weekday in the org's own zone, so Friday evening in New York is Friday.
    const dow = iso => { const d = orgToday(tz, new Date(iso)); return new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))).getUTCDay(); };   // ORG_TZ_SEAM_OK
    const due = ML.replyDueAt(new Date(r.created_at).toISOString(), dow);
    if (!due || Date.parse(due) > now.getTime()) continue;
    const k = r.org_id + "|" + r.donor_id;
    if (!byPerson.has(k)) byPerson.set(k, []);
    byPerson.get(k).push(r);
  }
  const path = "mailbox/needs-reply";
  for (const list of byPerson.values()) {
    const top = list[0];
    out.emails += list.length;
    const label = ML.replyStepLabel(top.name, list.map(x => x.subject));
    const th = await openCareThread(top.org_id, top.donor_id, { type: "reply", label, dueInDays: 0, path });
    let taskId = null;
    if (!th) {
      const owner = top.assigned_to ? { id: top.assigned_to, name: top.assigned_to_name }
        : top.mailbox_user ? (await query(`SELECT id, name, email FROM users WHERE id=? AND org_id=?`, [top.mailbox_user, top.org_id]))[0] : null;
      taskId = await openAdminTask(top.org_id, { title: label, priority: "high", donorId: top.donor_id, assignee: owner || null,
        actorId: `system:${path}`, actorName: SYS_AUTO.name });
      if (!taskId) continue;   // nobody to give it to, or the same task is already open: try again next pass
      out.tasks++;
    } else out.opened++;
    for (const x of list) await run(
      `INSERT INTO mail_reply_steps (org_id, interaction_id, donor_id, thread_id, task_id, created_by) VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING`,
      [x.org_id, x.id, x.donor_id, th ? th.id : null, taskId, `system:${path}`]);
    if (!out.orgs.includes(top.org_id)) out.orgs.push(top.org_id);
  }
  return out;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 684

async function processMembershipRenewals(opts = {}) {
  await MB_READY;
  const out = { orgs: 0, toGrace: 0, toLapsed: 0, opened: 0, skipped: 0, rows: [] };
  const orgs = opts.orgId
    ? await query("SELECT id, name, timezone, voice_samples FROM orgs WHERE id=?", [opts.orgId])
    : await query(`SELECT DISTINCT o.id, o.name, o.timezone, o.voice_samples FROM orgs o JOIN memberships m ON m.org_id=o.id
                    WHERE o.onboarding_complete=1 AND m.status IN ('active','grace')`, []);
  const draftMod = await import("../../shared/draftNote.js");
  for (const org of orgs) {
    out.orgs++;
    const today = opts.today || orgToday(org);                    // ORG_TZ_SEAM_OK
    const { renewalDays, graceDays } = await membershipSettings(org.id);
    const g = await query(`UPDATE memberships SET status='grace', status_changed_on=?, updated_at=NOW()
                            WHERE org_id=? AND status='active' AND expires_on IS NOT NULL AND expires_on < ? RETURNING id`, [today, org.id, today]);
    const l = await query(`UPDATE memberships SET status='lapsed', status_changed_on=?, updated_at=NOW()
                            WHERE org_id=? AND status='grace' AND expires_on < ? RETURNING id`, [today, org.id, MB.addDaysCivil(today, -graceDays)]);
    out.toGrace += g.length; out.toLapsed += l.length;
    // WIRE-1: a membership that lapsed opens one step for a person. The step
    // is remembered on the membership (renewal_thread_for = 'lapsed'), so a
    // re-run opens none, and a member who already holds an open step is tried
    // again on the next pass for thirty days. Renewing closes it as an outcome,
    // the way it closes a renewal step.
    const lapsed = await query(
      `SELECT m.id, m.donor_id, d.name AS donor_name, lv.name AS level_name
         FROM memberships m JOIN donors d ON d.id=m.donor_id AND d.org_id=m.org_id
         LEFT JOIN membership_levels lv ON lv.id=m.level_id AND lv.org_id=m.org_id
        WHERE m.org_id=? AND m.status='lapsed' AND m.status_changed_on >= ?
          AND m.renewal_thread_for IS DISTINCT FROM 'lapsed'
          AND NOT EXISTS (SELECT 1 FROM memberships n WHERE n.org_id=m.org_id AND n.donor_id=m.donor_id AND n.status IN ('active','grace'))
          AND d.do_not_contact IS NOT TRUE AND d.do_not_solicit IS NOT TRUE`, [org.id, MB.addDaysCivil(today, -30)]);
    for (const m of lapsed) {
      const th = await openCareThread(org.id, m.donor_id, {
        label: `Membership lapsed: check in with ${m.donor_name}${m.level_name ? ` (${m.level_name})` : ""}`,
        dueInDays: 3, path: "membership-lapsed" });
      if (!th) continue;
      await run(`UPDATE memberships SET renewal_thread_id=?, renewal_thread_for='lapsed', updated_at=NOW() WHERE id=? AND org_id=?`, [th.id, m.id, org.id]);
      out.lapsedOpened = (out.lapsedOpened || 0) + 1;
      out.rows.push({ orgId: org.id, membershipId: m.id, donorId: m.donor_id, threadId: th.id, lapsed: true });
    }
    const due = await query(
      `SELECT m.id, m.donor_id, m.expires_on, l.name AS level_name, l.price, d.name AS donor_name, d.kind,
              d.assigned_to, d.assigned_to_name
         FROM memberships m
         JOIN membership_levels l ON l.id=m.level_id AND l.org_id=m.org_id
         JOIN donors d ON d.id=m.donor_id AND d.org_id=m.org_id
        WHERE m.org_id=? AND m.status='active' AND m.expires_on BETWEEN ? AND ?
          AND m.renewal_thread_for IS DISTINCT FROM m.expires_on
          AND l.term <> ALL(?::text[])   -- PARITY-2: a monthly level opens no thread
          AND d.deleted_at IS NULL AND d.is_sample IS NOT TRUE
          AND d.deceased IS NOT TRUE AND d.do_not_contact IS NOT TRUE AND d.do_not_solicit IS NOT TRUE
        ORDER BY m.expires_on`, [org.id, today, MB.addDaysCivil(today, renewalDays), MB.NO_RENEWAL_THREAD_TERMS]);
    const samples = Array.isArray(org.voice_samples) ? org.voice_samples
      : (typeof org.voice_samples === "string" ? JSON.parse(org.voice_samples || "[]") : []);
    const voice = draftMod.voiceFrom(samples);
    const displayName = await donorFacingOrgName(org.id, org.name).catch(() => org.name);
    for (const m of due) {
      const isPerson = !m.kind || m.kind === "person";
      const draft = draftMod.membershipRenewalDraft({ donorName: m.donor_name, levelName: m.level_name,
        expiresOnLong: MB.civilLong(m.expires_on), priceCents: mbCents(m.price), orgName: displayName, voice });
      const thread = await withTransaction(client => openThreadTx(client, {
        orgId: org.id, donorId: m.donor_id,
        step: { type: draftMod.MEMBERSHIP_RENEWAL_STEP.type,
                label: MB.renewalLabel({ donorName: m.donor_name, levelName: m.level_name, expiresOn: m.expires_on, isPerson }),
                due: today },
        openedOn: today, ownerId: m.assigned_to || null, ownerName: m.assigned_to_name || null,
        actorId: SYS_AUTO.id, actorName: SYS_AUTO.name,
      }));
      if (!thread) { out.skipped++; continue; }
      await run("UPDATE threads SET draft_note=? WHERE id=?", [draft.body, thread.id]);
      await run("UPDATE memberships SET renewal_thread_id=?, renewal_thread_for=?, updated_at=NOW() WHERE id=? AND org_id=?",
        [thread.id, m.expires_on, m.id, org.id]);
      out.opened++;
      out.rows.push({ orgId: org.id, membershipId: m.id, donorId: m.donor_id, threadId: thread.id, expiresOn: m.expires_on });
    }
  }
  return out;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 688

// The theme fragment shared by the portal config payload and the donor
// dashboard's per-org cards (BUILD-48 takeover). Colors are normalized at
// SAVE time; this re-checks at render and falls back to the designed default
// rather than ever shipping an unreadable surface. `row` carries the raw
// portal_settings column names (background_tint, button_color, …).
function portalCardTheme(row) {
  const prim = row.primary_color ? normalizeAccent(row.primary_color) : null;
  const acc = row.accent_color ? normalizeAccent(row.accent_color) : null;
  const btn = row.button_color ? normalizeAccent(row.button_color) : null;
  const tint = row.background_tint ? normalizeTint(row.background_tint) : null;
  return {
    primary: prim ? prim.accent : PORTAL_DEFAULT_THEME.primary,
    primaryFg: prim ? prim.fg : PORTAL_DEFAULT_THEME.primaryFg,
    accent: acc ? acc.accent : PORTAL_DEFAULT_THEME.accent,
    accentFg: acc ? acc.fg : PORTAL_DEFAULT_THEME.accentFg,
    // Button/link color falls back to primary — the pre-BUILD-48 button color,
    // so existing portals render byte-identically until an org sets one.
    buttonColor: btn ? btn.accent : (prim ? prim.accent : PORTAL_DEFAULT_THEME.primary),
    buttonFg: btn ? btn.fg : (prim ? prim.fg : PORTAL_DEFAULT_THEME.primaryFg),
    backgroundTint: tint ? tint.tint : null,
    typePairing: PORTAL_TYPE_PAIRINGS.includes(row.type_pairing) ? row.type_pairing : "dm",
    cardStyle: PORTAL_CARD_STYLES.includes(row.card_style) ? row.card_style : "rounded",
  };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 691
function parseAmountLadder(raw, fallback) {
  if (raw == null) return fallback.slice();
  let arr = raw;
  if (typeof raw === "string") { try { arr = JSON.parse(raw); } catch { return fallback.slice(); } }
  if (!Array.isArray(arr)) return fallback.slice();
  const clean = arr.map(n => Math.round(Number(n))).filter(n => Number.isFinite(n) && n >= 1 && n <= 1000000);
  return (clean.length >= 3 && clean.length <= 6) ? clean : fallback.slice();
}
// SPLIT-2 end
// SPLIT-2 server.js piece 692

// A normalized crop rectangle {x,y,w,h} (each 0..1) or null. Non-destructive:
// it only ever describes which part of the original asset a slot shows. Shared
// by giveThemePayload + portalThemePayload so the give page and the portal read
// the exact same crop.
function parseCrop(raw) {
  if (raw == null) return null;
  let c = raw;
  if (typeof raw === "string") { try { c = JSON.parse(raw); } catch { return null; } }
  if (!c || typeof c !== "object") return null;
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const x = n(c.x), y = n(c.y), w = n(c.w), h = n(c.h);
  if ([x, y, w, h].some(v => v == null)) return null;
  if (w <= 0 || h <= 0 || w > 1 || h > 1 || x < 0 || y < 0 || x + w > 1.005 || y + h > 1.005) return null;
  return { x, y, w, h };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 693

function giveThemePayload(org) {
  const clean = (v, cap) => (typeof v === "string" ? v.slice(0, cap) : null);
  const clamp01 = (n, d) => Math.min(1, Math.max(0, Number(n ?? d) || d));
  return {
    displayName: clean(org.display_name, 120) || displayNameCase(org.name),
    logo: org.give_logo || null,
    headerImage: org.give_header_image || null,
    headerFocal: { x: clamp01(org.header_focal_x, 0.5), y: clamp01(org.header_focal_y, 0.5) },
    headerCrop: parseCrop(org.header_crop),
    // colors/type/card — the shared portal theme resolver (normalized at save,
    // re-checked here, designed-neutral fallback when unset).
    ...portalCardTheme(org),
    footerText: clean(org.give_footer, 500),
    contactEmail: clean(org.give_contact, 200),
    einLine: require("../org/einLine").einLineOf(org.give_ein),   // MONEY-4: orgs.ein, the one EIN
    // "Powered by Steward" is OFF by default (white-label). A flag so it can be
    // turned on network-wide later without a rebuild — see BUILD-60 decision.
    poweredBy: org.powered_by === true,
    onetimeAmounts: parseAmountLadder(org.onetime_amounts, GIVE_ONETIME_DEFAULT),
    monthlyAmounts: parseAmountLadder(org.monthly_amounts, GIVE_MONTHLY_DEFAULT),
  };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 700

// CRM timeline event for every portal action that matters (low-priority
// signal — recorded, never alerted, per §6.3).
async function portalTimeline(orgId, donorId, note, portalEvent) {
  await run(
    `INSERT INTO interactions (id,org_id,donor_id,type,note,date,logged_by_name,metadata)
     VALUES (?,?,?,?,?,?,?,?)`,
    [newId("int"), orgId, donorId, "note", note,
     orgToday(await orgTz(orgId)), "Donor portal", JSON.stringify({ portal_event: portalEvent })]   // ORG_TZ_SEAM_OK (FIX-14 Part 2b)
  ).catch(e => console.error("[portal] timeline:", e.message));
}
// SPLIT-2 end
// SPLIT-2 server.js piece 703
function imageBytesMatchMime(contentType, buffer) {
  const check = IMAGE_MAGIC[contentType];
  if (!check) return false;                 // an unlisted mime never gets in
  try { return !!check(buffer); } catch { return false; }
}
// SPLIT-2 end
// SPLIT-2 server.js piece 704

function checkThemeImageDimensions(kind, contentType, buffer) {
  if (!imageBytesMatchMime(contentType, buffer)) {
    return { ok: false, message: "That file doesn't parse as an image, try re-exporting it as PNG or JPEG." };
  }
  if (contentType === "image/svg+xml") return { ok: true, width: null, height: null };
  let d;
  try { d = imageSize(buffer); } catch { d = null; }
  if (!d || !d.width || !d.height) {
    return { ok: false, message: "That file doesn't parse as an image, try re-exporting it as PNG or JPEG." };
  }
  if (kind === "header") {
    if (d.height >= d.width) {
      return { ok: false, message: "Header images render as a wide banner, this image is as tall as it is wide and would crop badly. Use a landscape image (at least 1200×300 works well)." };
    }
    if (d.width < 600) {
      return { ok: false, message: "Header images need to be at least 600px wide to look sharp as a banner." };
    }
  }
  // BUILD-65: we resize down on ingest, so a large photo is fine — only reject
  // genuinely absurd dimensions (a decompression-bomb guard, not a size limit).
  if (d.width > 12000 || d.height > 12000) {
    return { ok: false, message: "That image is unusually large. Please use a photo under about 12,000 pixels on a side." };
  }
  return { ok: true, width: d.width, height: d.height };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 705

function validPortalImage(dataUri, capBytes) {
  if (dataUri == null || dataUri === "") return true;
  if (typeof dataUri !== "string" || dataUri.length > capBytes) return false;
  const m = dataUri.match(/^data:([^;]+);base64,/);
  return !!m && PORTAL_IMG_MIMES.includes(m[1]);
}
// SPLIT-2 end
// SPLIT-2 server.js piece 709

// Returns an actionable message if this data URI can't be accepted, else null.
// (Call sites already handle ""/null as "clear" before reaching here.)
function uploadImageError(dataUri) {
  if (typeof dataUri !== "string") return "That file isn't an image we can use. Please upload a PNG, JPEG, GIF or WebP image.";
  const m = dataUri.match(/^data:([^;]+);base64,/);
  if (!m || !PORTAL_IMG_MIMES.includes(m[1])) return "That file isn't an image we can use. Please upload a PNG, JPEG, GIF or WebP image.";
  if (dataUri.length > MAX_UPLOAD_STR) return "That image is unusually large. Please use a photo under 15 MB, a normal photo from a phone or camera is well within that.";
  return null;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 710

// Resize + compress a validated raster on ingest. SVG (vector) and GIF
// (possibly animated → sharp would flatten it) pass through untouched; a raster
// over the slot's long-edge cap is scaled DOWN (never up — upscaling is the
// grain complaint) and re-encoded (WebP for photos; PNG for a logo, to keep
// crisp edges + transparency). Returns { buffer, contentType, width, height }
// or { error, message } if the bytes won't process as an image.
async function normalizeUploadImage(kind, contentType, buffer) {
  if (contentType === "image/svg+xml" || contentType === "image/gif") {
    return { buffer, contentType, width: null, height: null };
  }
  const cap = UPLOAD_LONG_EDGE[kind] || 2560;
  try {
    const sharp = require("sharp");
    let pipe = sharp(buffer, { failOn: "none" }).rotate() // honor EXIF orientation
      .resize({ width: cap, height: cap, fit: "inside", withoutEnlargement: true });
    pipe = (kind === "logo") ? pipe.png({ compressionLevel: 9 }) : pipe.webp({ quality: 82 });
    const out = await pipe.toBuffer({ resolveWithObject: true });
    return {
      buffer: out.data,
      contentType: kind === "logo" ? "image/png" : "image/webp",
      width: out.info.width, height: out.info.height,
    };
  } catch (e) {
    // sharp couldn't process these bytes. checkThemeImageDimensions already
    // parsed the header (via image-size) and the mime already validated, so
    // rather than block the upload we store the original untouched — the pre-
    // BUILD-65 behavior. A genuine photo always decodes; this path is for the
    // odd header-only/edge-case buffer, not a resize failure on a real image.
    console.error("[upload] normalize skipped (storing original):", e.message);
    return { buffer, contentType, width: null, height: null };
  }
}
// SPLIT-2 end
// SPLIT-2 server.js piece 711

// ── BUILD-56 Part 1 — pointer history ───────────────────────────────────────
// Retained bytes are useless if nothing records which hash WAS the banner.
// Every mutation of a row that points at a content-addressed asset appends a
// history row: entity, from → to, when, actor. No-op when nothing changed.
// Rows are tiny and kept INDEFINITELY — they are the index into recovery.
async function recordAssetPointerHistory(orgId, entity, entityId, fromVal, toVal, actor) {
  const f = fromVal === undefined ? null : fromVal;
  const t = toVal === undefined ? null : toVal;
  if (JSON.stringify(f) === JSON.stringify(t)) return;
  await run(
    `INSERT INTO asset_pointer_history (id, org_id, entity, entity_id, from_value, to_value, actor_user_id, actor_email)
     VALUES (?,?,?,?,?,?,?,?)`,
    [newId("aph"), orgId, entity, entityId, JSON.stringify(f), JSON.stringify(t),
     actor?.userId || null, actor?.email || null]);
}
// SPLIT-2 end
// SPLIT-2 server.js piece 713
function validateStoryBlocks(raw) {
  if (raw == null) return { blocks: null };                 // field not being set
  if (raw === "" || (Array.isArray(raw) && raw.length === 0)) return { blocks: [] }; // explicit clear
  if (!Array.isArray(raw) || raw.length > 40) return { error: "bad_story" };
  const out = [];
  for (const b of raw) {
    if (!b || typeof b !== "object" || !STORY_BLOCK_TYPES.includes(b.type)) return { error: "bad_story" };
    if (b.type === "ul") {
      if (!Array.isArray(b.items) || b.items.length === 0 || b.items.length > 20) return { error: "bad_story" };
      const items = b.items.map(i => typeof i === "string" ? i.trim().slice(0, 500) : null);
      if (items.some(i => i == null || i === "")) return { error: "bad_story" };
      out.push({ type: "ul", items });
    } else {
      if (typeof b.text !== "string" || !b.text.trim()) return { error: "bad_story" };
      out.push({ type: b.type, text: b.text.trim().slice(0, b.type === "h2" ? 200 : 2000) });
    }
  }
  return { blocks: out };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 715

// BUILD-95 §5B — the per-widget resolution, shared by the portal page and
// every giving page. ONE pipeline: a widget that resolves differently on two
// surfaces is a widget that eventually shows different numbers on them.
// CAMPAIGN-2 — `ctx` carries the PAGE the widgets belong to: its id and its
// campaign. The three campaign widgets are `give`-only, so the portal caller
// passes nothing and nothing changes for it.
async function resolveWidgetsPublic(org, widgets, ctx = {}) {
  // WALKB-1: a starter's hint is the editor's, never the public's (shared/placeholderCopy.js).
  // The editor's own preview passes keepHints, so she can still click the hint and write over it.
  if (!ctx.keepHints) widgets = (await import("../../shared/placeholderCopy.js")).widgetsWithoutHints(widgets) || [];
  // BUILD-54 §1 discipline: the per-widget resolution queries are independent
  // reads — resolve them in PARALLEL (this is the donor's first paint; a
  // sequential loop re-created the exact round-trip stacking §1 removed).
  const out = await Promise.all(widgets.map(async (w) => {
    const r = { ...w };
    if (w.type === "funds" && w.fundIds?.length) {
      // BUILD-55 — cards render in the WIDGET's fundIds order (the org's manual
      // sort; the first fund leads), not whatever order the DB returns.
      const rows = await query(
        `SELECT id, name, restricted, description FROM fin_funds WHERE org_id = ? AND id = ANY(?)`,
        [org.id, w.fundIds]);
      const byId = new Map(rows.map(f => [f.id, f]));
      r.funds = w.fundIds.map(id => byId.get(id)).filter(Boolean)
        .map(f => ({ id: f.id, name: f.name, description: f.description || null }));
    }
    if (w.type === "campaign") {
      const [c] = await query(
        `SELECT id, COALESCE(donor_facing_name, name) AS name, donor_description, donor_story, hero_image_url, hero_crop, hero_focal_x, hero_focal_y,
                goal_progress_public, goal_amount,
                CASE WHEN goal_progress_public THEN
                  COALESCE((SELECT SUM(g2.amount) FROM gifts g2
                            WHERE g2.org_id = campaigns.org_id AND ${CAMPAIGN_GIFT_MATCH("g2", "campaigns")}), 0)
                + ${PUBLIC_BAR_GRANTS("campaigns")}
                END AS raised
         FROM campaigns WHERE id = ? AND org_id = ?`, [w.campaignId, org.id]);
      r.campaign = c ? {
        id: c.id, name: c.name, description: c.donor_description || null,
        story: Array.isArray(c.donor_story) ? c.donor_story : null,
        heroImage: c.hero_image_url || null,
        heroCrop: parseCrop(c.hero_crop),
        heroFocal: { x: Math.min(1, Math.max(0, Number(c.hero_focal_x ?? 0.5) || 0.5)), y: Math.min(1, Math.max(0, Number(c.hero_focal_y ?? 0.5) || 0.5)) },
        goal: c.goal_progress_public === true ? {
          amount: parseFloat(c.goal_amount) || 0, raised: parseFloat(c.raised) || 0,
          percent: (parseFloat(c.goal_amount) || 0) > 0
            ? Math.min(100, Math.round(((parseFloat(c.raised) || 0) / parseFloat(c.goal_amount)) * 100)) : null,
        } : null,
      } : null;
    }
    // ── CAMPAIGN-2 · THE THREE A CAMPAIGN PAGE NEEDS ──────────────────────
    // Each one renders NOTHING when there is nothing true to say: a countdown
    // with no end date, a match nobody has entered, a list with no gifts in it.
    // "Never fabricate — no content, no widget" is the rule the `campaign`
    // branch above already follows and these follow it.
    if (w.type === "countdown") {
      const CP = await campaignPageMod();
      const end = ctx.campaignEndDate || null;
      r.endDate = end;
      r.sentence = end ? CP.countdownSentence(end, ctx.today || null) : null;
      r.daysLeft = end && ctx.today ? CP.daysBetween(ctx.today, end) : null;
    }
    if (w.type === "matchchallenge") {
      const CP = await campaignPageMod();
      r.match = null;
      if (ctx.campaignId) {
        const [c] = await query(
          `SELECT match_cents, match_sponsor, match_started_at FROM campaigns WHERE id=? AND org_id=?`,
          [ctx.campaignId, org.id]);
        const pot = c && Number(c.match_cents) > 0 ? Math.round(Number(c.match_cents)) : 0;
        if (pot) {
          // WHAT IS LEFT OF IT is counted from the gifts recorded SINCE the
          // match began, because money that arrived before anybody promised to
          // double it was never part of the promise. Donor intent (the gift
          // less any fee the donor covered), the same basis every campaign
          // thermometer in this product already uses.
          const [sum] = await query(
            `SELECT COALESCE(SUM(g.amount),0)::float AS raised
               FROM gifts g JOIN campaigns c ON c.id=? AND c.org_id=g.org_id
              WHERE g.org_id=? AND ${CAMPAIGN_GIFT_MATCH("g", "c")}
                AND (c.match_started_at IS NULL OR g.date >= to_char(c.match_started_at AT TIME ZONE ?,'YYYY-MM-DD'))`,
            // POLISH-4: the day the match began is the org's day, as a gift's date is
            // (UTC put a gift given at 8 PM in New York on the night it began "before" it).
            [ctx.campaignId, org.id, await orgTzName(org.id)]);   // ORG_TZ_SEAM_OK
          const since = Math.round((Number(sum?.raised) || 0) * 100);
          r.match = {
            potCents: pot, sponsor: c.match_sponsor || null,
            claimedCents: Math.min(pot, since), remainingCents: Math.max(0, pot - since),
            sentence: CP.matchSentence({ matchCents: pot, raisedSinceMatchCents: since, sponsor: c.match_sponsor || "" }),
            definition: CP.MATCH_DEFINITION,
          };
        }
      }
    }
    if (w.type === "recentgifts") {
      const CP = await campaignPageMod();
      const n = Math.max(1, Math.min(20, parseInt(w.count, 10) || 8));
      // THE ROWS COME FROM THE CAMPAIGN WHEN THERE IS ONE and from the page
      // otherwise, so a page that is somebody's campaign shows the campaign's
      // gifts — including the ones given through a supporter's own fundraising
      // page, which is the whole point of linking them.
      //
      // The SELECT has no email column and there is not going to be one.
      const rows = ctx.campaignId
        ? await query(
            `SELECT g.date, g.amount, g.cover_fee_amount, g.show_name_publicly, d.name AS donor_name
               FROM gifts g
               JOIN donors d ON d.id=g.donor_id AND d.org_id=g.org_id AND d.deleted_at IS NULL
               JOIN campaigns c ON c.id=? AND c.org_id=g.org_id
              WHERE g.org_id=? AND ${CAMPAIGN_GIFT_MATCH("g", "c")} AND g.amount > 0
              ORDER BY g.date DESC NULLS LAST, g.id DESC LIMIT ?`, [ctx.campaignId, org.id, n])
        : ctx.pageId
        ? await query(
            `SELECT g.date, g.amount, g.cover_fee_amount, g.show_name_publicly, d.name AS donor_name
               FROM gifts g
               JOIN donors d ON d.id=g.donor_id AND d.org_id=g.org_id AND d.deleted_at IS NULL
              WHERE g.org_id=? AND g.giving_page_id=? AND g.amount > 0
              ORDER BY g.date DESC NULLS LAST, g.id DESC LIMIT ?`, [org.id, ctx.pageId, n])
        : [];
      const showAmounts = w.showAmounts === true;
      r.gifts = rows.map(row => CP.publicGiftLine({
        donorName: row.donor_name,
        amountCents: Math.round((Number(row.amount) || 0) * 100),   // FIX-49: the full gift, a covered fee included
        showName: row.show_name_publicly === true,
        date: row.date,
      }, { showAmounts }));
      r.definition = CP.RECENT_GIFTS_DEFINITION;
    }
    if (w.type === "impact") {
      // Public view: ORG-WIDE published updates only (targeted updates need
      // gift attribution, which needs a session — the signed-in client
      // substitutes its matched /me feed).
      r.updates = (await query(
        `SELECT id, title, body, photos, photo_crops, created_at FROM impact_updates
         WHERE org_id = ? AND status = 'published' AND org_wide = true
         ORDER BY created_at DESC LIMIT 6`, [org.id]))
        .map(u => ({ id: u.id, title: u.title, body: u.body, photos: Array.isArray(u.photos) ? u.photos : [], photoCrops: Array.isArray(u.photo_crops) ? u.photo_crops : [], date: u.created_at }));
    }
    return r;
  }));
  return out;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 720

async function donorAudit(accountId, email, action, req, meta) {
  await run(
    `INSERT INTO donor_account_audit (id,account_id,email,action,ip,meta) VALUES (?,?,?,?,?,?)`,
    [newId("daa"), accountId || null, email || null, action,
     (req && req.ip) || null, meta ? JSON.stringify(meta) : null]
  ).catch(e => console.error("[account] audit:", e.message));
}
// SPLIT-2 end
// SPLIT-2 server.js piece 725
async function einLookup(ein) {
  const rows = await query(`SELECT ein, name, status FROM ein_registry WHERE ein = ?`, [ein]);
  if (!rows.length) return { found: false };
  return { found: true, name: rows[0].name, status: rows[0].status };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 727

// BUILD-58 (W-1) — "Stripe onboarding complete" is a fact we ask STRIPE for,
// never our own flag: /stripe/connect sets stripe_connected=true at LINK
// creation, before any onboarding happens, so trusting it let a reviewer
// approve an org whose Express onboarding was never finished (its Give page
// would take gifts Stripe refuses). `definitive` distinguishes a real answer
// from an unreachable Stripe: the approval gate refuses either way (verify or
// don't approve), the auto-delist sweep acts only on a definitive false.
async function stripeChargesEnabled(accountId) {
  if (!accountId) return { ok: false, definitive: true, reason: "no_account" };
  if (!stripe) return { ok: false, definitive: false, reason: "stripe_not_configured" };
  try {
    const acct = await stripe.accounts.retrieve(accountId);
    return { ok: acct.charges_enabled === true, definitive: true, reason: acct.charges_enabled === true ? null : "charges_disabled" };
  } catch (e) {
    return { ok: false, definitive: false, reason: "stripe_unreachable" };
  }
}
// SPLIT-2 end
// SPLIT-2 server.js piece 728

// ── §3.2(5) auto-delist sweep — EIN dropped/revoked or Stripe gone ─────────
// Portal stays up for existing donors; the listing and NEW gifts stop; the
// admin is alerted through the queued path. Registry-empty guard: an unloaded
// registry delists nobody (no data ≠ everyone revoked).
async function processNetworkGate() {
  const approved = await query(
    `SELECT na.id, na.org_id, na.ein, na.decisions, o.name, o.stripe_account_id, o.stripe_connected
     FROM network_applications na JOIN orgs o ON o.id = na.org_id WHERE na.status = 'approved'`);
  if (!approved.length) return { checked: 0, delisted: 0 };
  const [{ c: registryCount }] = await query(`SELECT COUNT(*)::int c FROM ein_registry`);
  let delisted = 0;
  for (const a of approved) {
    let reason = null;
    if (Number(registryCount) > 0) {
      const found = await einLookup(a.ein);
      if (!found.found || found.status !== "ok") reason = `EIN ${a.ein} ${found.found ? "status: " + found.status : "no longer on the IRS list"}`;
    }
    if (!reason) {
      // W-1: the sweep asks Stripe, not our link-creation flag. Fail-safe:
      // an UNREACHABLE Stripe delists nobody (an outage ≠ every org revoked)
      // — only a definitive charges_enabled=false (or no account) delists.
      if (!a.stripe_account_id) reason = "Stripe account disconnected/restricted";
      else {
        const chk = await stripeChargesEnabled(a.stripe_account_id);
        if (chk.definitive && !chk.ok) reason = "Stripe account disconnected/restricted (charges disabled)";
      }
    }
    if (!reason) continue;
    const decisions = (typeof a.decisions === "string" ? JSON.parse(a.decisions || "[]") : (a.decisions || []));
    decisions.push({ at: new Date().toISOString(), by: "system", action: "delisted", reason });
    await run(`UPDATE network_applications SET status = 'delisted', decisions = ?, updated_at = NOW() WHERE id = ?`, [JSON.stringify(decisions), a.id]);
    await run(`UPDATE portal_settings SET network_listed = false, updated_at = NOW() WHERE org_id = ?`, [a.org_id]);
    delisted++;
    await sendDonorLifecycleEmail("admin_delist", process.env.FOUNDER_EMAIL || "jonathan@stewardapp.dev",
      `Network delisting · ${a.name}`,
      consumerEmailHtml(`<p><strong>${escHtmlWf(a.name)}</strong> (org ${escHtmlWf(a.org_id)}) was auto-delisted from donor dashboards.</p><p>Reason: ${escHtmlWf(reason)}.</p><p>Its portal stays up for existing donors; new gifts are blocked until re-approval.</p>`));
  }
  return { checked: approved.length, delisted };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 731
async function inboundMod() { return import("../../shared/inboundEmail.js"); }
// SPLIT-2 end
// SPLIT-2 server.js piece 742

// Per-donor breakdown behind the stewardship_debt headline number — every
// donor's exact contribution to the aggregate, sorted by who's driving it
// most. computeStewardshipDebt() below just sums this same list, so the
// headline number and the drill-down list (GET /dashboard/stewardship-debt/
// breakdown) can never drift into two different computations. Pass
// `userId` to scope to just that user's assigned donors (same assigned_to
// pattern as GET /dashboard/today) — omit for the org-wide figure.
async function computeStewardshipDebtBreakdown(orgId, { userId } = {}) {
  // One LEFT JOIN + GROUP BY instead of a correlated MAX() subquery per donor —
  // at 25k donors × 150k interactions the subquery plan was 25k sequential
  // scans (~6 min per call, measured; see LOADTEST_REPORT.md). MAX over zero
  // joined rows is NULL, so the COALESCE fallback to first_gift_date is
  // byte-identical to the old subquery's behavior. GROUP BY d.id is enough —
  // the other selected columns are functionally dependent on the PK.
  const rows = await query(
    // SCALE-1: now that interactions(donor_id, date) is indexed, a LATERAL
    // MAX per donor is one backward index probe each (24k donors: 64 ms),
    // where the hash join read every org's interactions (2.6M rows: 935 ms).
    // Proven identical on a 25k-donor org (EXCEPT ALL both ways, 0 rows).
    `SELECT d.id, d.name, d.total_giving, d.first_gift_date,
       COALESCE(lc.m, d.first_gift_date) AS last_contact
     FROM donors d
     LEFT JOIN LATERAL (SELECT MAX(i.date) AS m FROM interactions i
                         WHERE i.donor_id = d.id AND i.type IN ${MEANINGFUL_CONTACT_TYPES}) lc ON true
     WHERE d.org_id = ? AND d.deleted_at IS NULL AND d.total_giving > 0 ${userId ? "AND d.assigned_to = ?" : ""}`,
    userId ? [orgId, userId] : [orgId]
  );
  const today = Date.now();
  const breakdown = [];
  for (const d of rows) {
    if (!d.last_contact) continue; // no gift and no contact — nothing to weight yet
    const daysSinceContact = Math.max(0, Math.min(1000, Math.floor((today - new Date(d.last_contact).getTime()) / 86400000)));
    const totalGiving = Number(d.total_giving) || 0;
    const significance = totalGiving / 1000;
    const contribution = (daysSinceContact / 30) * significance;
    breakdown.push({ donorId: d.id, donorName: d.name, totalGiving, daysSinceContact, contribution });
  }
  breakdown.sort((a, b) => b.contribution - a.contribution);
  return breakdown;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 743

async function computeStewardshipDebt(orgId, opts = {}) {
  const breakdown = await computeStewardshipDebtBreakdown(orgId, opts);
  return Math.round(breakdown.reduce((sum, d) => sum + d.contribution, 0));
}
// SPLIT-2 end
// SPLIT-2 server.js piece 744

async function computeFirstTouchDelay(orgId) {
  // Same correlated-subquery → LEFT JOIN + GROUP BY rewrite as
  // computeStewardshipDebtBreakdown above (same reason, same measurement —
  // see LOADTEST_REPORT.md). MIN over zero joined rows is NULL, matching the
  // old subquery's "no first touch yet" result exactly.
  const rows = await query(
    // SCALE-1: LATERAL MIN per donor, one forward index probe each (same
    // reason and proof as computeStewardshipDebtBreakdown above).
    `SELECT d.id, d.name, d.first_gift_date, ft.m AS first_touch_date
     FROM donors d
     LEFT JOIN LATERAL (SELECT MIN(i.date) AS m FROM interactions i
                         WHERE i.donor_id = d.id AND i.type IN ${MEANINGFUL_CONTACT_TYPES}
                           AND i.date >= d.first_gift_date) ft ON true
     WHERE d.org_id = ? AND d.deleted_at IS NULL AND d.first_gift_date IS NOT NULL`,
    [orgId]
  );
  let totalDays = 0, touched = 0, untouched = 0;
  // The specific donors this average is actually about — newest first-gift
  // first, since a brand-new donor still waiting on a human touch is more
  // actionable than one who's been waiting for months (that's a lost cause,
  // not a "get to them today" item).
  const untouchedDonors = [];
  for (const d of rows) {
    if (!d.first_touch_date) {
      untouched++;
      untouchedDonors.push({ donorId: d.id, donorName: d.name, firstGiftDate: d.first_gift_date });
      continue;
    }
    const days = Math.max(0, Math.floor((new Date(d.first_touch_date) - new Date(d.first_gift_date)) / 86400000));
    totalDays += days;
    touched++;
  }
  untouchedDonors.sort((a, b) => new Date(b.firstGiftDate) - new Date(a.firstGiftDate));
  return {
    avgDays: touched > 0 ? Math.round(totalDays / touched) : null,
    sampleSize: touched,
    untouchedCount: untouched,
    newestUntouched: untouchedDonors.slice(0, 3),
  };
}
// SPLIT-2 end

__share({ mailKindHeaders, gmailToMessage, fetchMailboxAttachments, graphToMessage, closeThreadStepForContact, emitWebhook, deliverWebhooks, openWebhookThread, syncGmail, levelTaken, registerForEvent, sendEventTicketEmail, enrollMembership, membershipSettings, renewMembership, applyGiftAsMembershipRenewal, processAuctionUnpaid, processUnansweredMail, processMembershipRenewals, portalCardTheme, parseAmountLadder, parseCrop, giveThemePayload, portalTimeline, imageBytesMatchMime, checkThemeImageDimensions, validPortalImage, uploadImageError, normalizeUploadImage, recordAssetPointerHistory, validateStoryBlocks, resolveWidgetsPublic, donorAudit, einLookup, stripeChargesEnabled, processNetworkGate, inboundMod, computeStewardshipDebtBreakdown, computeStewardshipDebt, computeFirstTouchDelay });
