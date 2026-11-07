// SPLIT-2: moved VERBATIM from server.js (its functions from lines 6559-7848). server.js requires the boot modules in
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
const DRAFT_KEYS = require("../../shared/numbers/draftRender");   // TRUTH-3: a draft stores figure keys, never numbers
let BRIEF_CATCH_UP_HOURS, DRAFT_CHECK, DRIFT_STORE_OFF, GREET, GREET_READY, ItemRefs, MEANINGFUL_CONTACT_TYPES, MILESTONE_THRESHOLDS, NOTE_MILESTONE_KEYS, SYS_AUTO, WEEKLY_CATCH_UP_HOURS, WEEKLY_HOUR, WEEKLY_LIST_CAP, WEEKLY_TASK_KINDS, anthropicFor, briefSettings, composeDailyTaskReminder, composeThreadNudgeQueue, digestEsc, digestMoney, displayNameCase, donorFromAddress, donorMailDecision, donorOnly, donorSendOpts, driftEngine, escHtmlWf, escapeHtml, figureSources, greetFor, lapseRule, mailPolicy, morningBriefSubject, newId, openingLine, orgMaySendEmail, orgTime, orgToday, orgTz, publicAppUrl, query, recordAiFallback, resend, reserveDigest, run, sendDigestEmail, solicitableSql, staffLinks, staffUnsubscribeUrl, threadShapeMod, unsubscribeEmailFooterHtml, userWantsEmail, weeklyIsEmpty;
__boot.register(c => {
  if ("BRIEF_CATCH_UP_HOURS" in c) BRIEF_CATCH_UP_HOURS = c.BRIEF_CATCH_UP_HOURS;
  if ("DRAFT_CHECK" in c) DRAFT_CHECK = c.DRAFT_CHECK;
  if ("DRIFT_STORE_OFF" in c) DRIFT_STORE_OFF = c.DRIFT_STORE_OFF;
  if ("GREET" in c) GREET = c.GREET;
  if ("GREET_READY" in c) GREET_READY = c.GREET_READY;
  if ("ItemRefs" in c) ItemRefs = c.ItemRefs;
  if ("MEANINGFUL_CONTACT_TYPES" in c) MEANINGFUL_CONTACT_TYPES = c.MEANINGFUL_CONTACT_TYPES;
  if ("MILESTONE_THRESHOLDS" in c) MILESTONE_THRESHOLDS = c.MILESTONE_THRESHOLDS;
  if ("NOTE_MILESTONE_KEYS" in c) NOTE_MILESTONE_KEYS = c.NOTE_MILESTONE_KEYS;
  if ("SYS_AUTO" in c) SYS_AUTO = c.SYS_AUTO;
  if ("WEEKLY_CATCH_UP_HOURS" in c) WEEKLY_CATCH_UP_HOURS = c.WEEKLY_CATCH_UP_HOURS;
  if ("WEEKLY_HOUR" in c) WEEKLY_HOUR = c.WEEKLY_HOUR;
  if ("WEEKLY_LIST_CAP" in c) WEEKLY_LIST_CAP = c.WEEKLY_LIST_CAP;
  if ("WEEKLY_TASK_KINDS" in c) WEEKLY_TASK_KINDS = c.WEEKLY_TASK_KINDS;
  if ("anthropicFor" in c) anthropicFor = c.anthropicFor;
  if ("briefSettings" in c) briefSettings = c.briefSettings;
  if ("composeDailyTaskReminder" in c) composeDailyTaskReminder = c.composeDailyTaskReminder;
  if ("composeThreadNudgeQueue" in c) composeThreadNudgeQueue = c.composeThreadNudgeQueue;
  if ("digestEsc" in c) digestEsc = c.digestEsc;
  if ("digestMoney" in c) digestMoney = c.digestMoney;
  if ("displayNameCase" in c) displayNameCase = c.displayNameCase;
  if ("donorFromAddress" in c) donorFromAddress = c.donorFromAddress;
  if ("donorMailDecision" in c) donorMailDecision = c.donorMailDecision;
  if ("donorOnly" in c) donorOnly = c.donorOnly;
  if ("donorSendOpts" in c) donorSendOpts = c.donorSendOpts;
  if ("driftEngine" in c) driftEngine = c.driftEngine;
  if ("escHtmlWf" in c) escHtmlWf = c.escHtmlWf;
  if ("escapeHtml" in c) escapeHtml = c.escapeHtml;
  if ("figureSources" in c) figureSources = c.figureSources;
  if ("greetFor" in c) greetFor = c.greetFor;
  if ("lapseRule" in c) lapseRule = c.lapseRule;
  if ("mailPolicy" in c) mailPolicy = c.mailPolicy;
  if ("morningBriefSubject" in c) morningBriefSubject = c.morningBriefSubject;
  if ("newId" in c) newId = c.newId;
  if ("openingLine" in c) openingLine = c.openingLine;
  if ("orgMaySendEmail" in c) orgMaySendEmail = c.orgMaySendEmail;
  if ("orgTime" in c) orgTime = c.orgTime;
  if ("orgToday" in c) orgToday = c.orgToday;
  if ("orgTz" in c) orgTz = c.orgTz;
  if ("publicAppUrl" in c) publicAppUrl = c.publicAppUrl;
  if ("query" in c) query = c.query;
  if ("recordAiFallback" in c) recordAiFallback = c.recordAiFallback;
  if ("resend" in c) resend = c.resend;
  if ("reserveDigest" in c) reserveDigest = c.reserveDigest;
  if ("run" in c) run = c.run;
  if ("sendDigestEmail" in c) sendDigestEmail = c.sendDigestEmail;
  if ("solicitableSql" in c) solicitableSql = c.solicitableSql;
  if ("staffLinks" in c) staffLinks = c.staffLinks;
  if ("staffUnsubscribeUrl" in c) staffUnsubscribeUrl = c.staffUnsubscribeUrl;
  if ("threadShapeMod" in c) threadShapeMod = c.threadShapeMod;
  if ("unsubscribeEmailFooterHtml" in c) unsubscribeEmailFooterHtml = c.unsubscribeEmailFooterHtml;
  if ("userWantsEmail" in c) userWantsEmail = c.userWantsEmail;
  if ("weeklyIsEmpty" in c) weeklyIsEmpty = c.weeklyIsEmpty;
});

// SPLIT-2 server.js piece 490

// BUILD-85 — the brief's body. Threads first (the spine), then the tasks that
// were a second email until today, then — for an admin at a multi-officer shop
// — a roll-up of counts, never everyone's rows.
//
// EVERY THREAD ROW CARRIES ITS REASON. shared/threadRank.js decided the order;
// this prints the sentence that order was built from, so the list can always
// answer "why am I looking at this one first?" without the reader guessing.
function renderMorningBriefBody({ threads, more, tasks, org, user, today, team, meetings = [], readouts = [] }) {
  const INK = "#0f1a12", SAGE = "#6b7d70", EMERALD = "#0d5c3a", BRASS = "#c9a84c", TERRA = "#8a3a24";
  // THREAD-2 · every person, task and meeting named here opens its page.
  const L = staffLinks(), base = publicAppUrl();
  const QUIET = `color:${SAGE};text-decoration:underline;`;
  const row = t => {
    const url = `${base}/donors/${encodeURIComponent(t.donorId)}?conversation=1`;
    const late = t.band === "overdue";
    const step = t.stepRef ? L.refLinkHtml(t.stepRef, base, { label: t.stepLabel, style: QUIET }) : digestEsc(t.stepLabel);
    return `<tr><td style="padding:9px 0;border-bottom:1px solid #e4e0d6;">
      <div style="font-size:14px;color:${INK};">
        <a href="${url}" style="color:${EMERALD};font-weight:700;text-decoration:underline;">${digestEsc(L.nameOrFallback(t.donorName))}</a>
        <span style="color:${SAGE};"> · ${step} · day ${t.daysOpen}</span>
      </div>
      ${t.why ? `<div style="font-size:12px;color:${late ? TERRA : SAGE};margin-top:2px;">${digestEsc(t.why)}</div>` : ""}
    </td></tr>`;
  };
  const threadBlock = threads.length ? `
    <div style="font-family:'DM Serif Display',Georgia,serif;font-size:19px;color:${INK};margin-top:4px;">These are waiting on you.</div>
    <div style="font-size:12.5px;color:${SAGE};margin-top:2px;">Each name opens the donor's record. Log what happened there, and the next step comes back when it is due.</div>
    <table style="margin-top:10px;border-collapse:collapse;width:100%;">${threads.map(row).join("")}</table>
    ${more > 0 ? `<div style="font-size:12px;color:${SAGE};margin-top:8px;">and ${more} more open · <a href="${publicAppUrl()}/dashboard" style="color:${EMERALD};">see the whole list</a></div>` : ""}` : "";

  const taskLi = t => {
    const late = String(t.due).slice(0, 10) < today;
    const donor = t.donor_id ? ` · ${L.refLinkHtml({ kind: "person", id: t.donor_id, name: displayNameCase(t.donor_name || ""), email: t.donor_email }, base, { style: QUIET })}` : "";
    return `<tr><td style="padding:7px 0;font-size:13.5px;color:${INK};">
      ${L.refLinkHtml({ kind: "task", id: t.id, name: t.title }, base, { style: `color:${INK};text-decoration:underline;` })}<span style="color:${late ? TERRA : SAGE};font-weight:700;"> · ${late ? "Overdue" : "Due today"}</span><span style="color:${SAGE};">${donor}</span></td></tr>`;
  };
  // BUILD-88a A.2 — DUE TODAY GOES FIRST. The late list led, so the thing she
  // has to do TODAY sat underneath the things she is already late for, and the
  // list she cannot fix pushed the one she can down the screen. (A JS comment,
  // not an HTML one: a comment inside the body would be text in the email, and
  // a word in it can make an assertion about the email's own ORDER read wrong —
  // which is exactly what happened when this one was written the other way.)
  const taskBlock = tasks.count ? `
    <div style="margin-top:22px;padding-top:14px;border-top:2px solid ${BRASS};">
      <div style="font-family:'DM Serif Display',Georgia,serif;font-size:17px;color:${INK};">Your tasks</div>
      <table style="margin-top:6px;border-collapse:collapse;width:100%;">${[...tasks.dueToday, ...tasks.overdue].map(taskLi).join("")}</table>
    </div>` : "";

  // FIX-34 · TODAY'S MEETINGS ride in the same morning email, from the same
  // composer Home's meetings panel reads (routes/finance.js composeTodayMeetings).
  const tz = org.timezone || "America/New_York";
  const at = iso => { try { return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }); } catch { return ""; } };
  const meetingBlock = meetings.length ? `
    <div style="margin-top:22px;padding-top:14px;border-top:2px solid ${BRASS};" data-section="meetings">
      <div style="font-family:'DM Serif Display',Georgia,serif;font-size:17px;color:${INK};">Your meetings today</div>
      <table style="margin-top:6px;border-collapse:collapse;width:100%;">${meetings.map(m => `<tr><td style="padding:7px 0;font-size:13.5px;color:${INK};">
        <strong>${digestEsc(m.startsAt ? at(m.startsAt) : "Today")}</strong> · ${digestEsc(m.title || "Meeting")}${(m.people || []).length ? `<span style="color:${SAGE};"> with ${m.people.map(p => p.id ? L.refLinkHtml({ kind: "person", id: p.id, name: p.name, email: p.email }, base, { style: QUIET }) : digestEsc(L.nameOrFallback(p.name, p.email))).join(", ")}</span>` : ""}</td></tr>`).join("")}</table>
    </div>` : "";
  // LIVE-1 · WHAT YESTERDAY'S IMPORTS AND READS TOLD US, one line each,
  // opening "What changed" where every line has its rows and its action.
  const readoutBlock = readouts.length ? `
    <div style="margin-top:22px;padding-top:14px;border-top:2px solid ${BRASS};" data-section="readouts">
      <div style="font-family:'DM Serif Display',Georgia,serif;font-size:17px;color:${INK};">What yesterday told us</div>
      <table style="margin-top:6px;border-collapse:collapse;width:100%;">${readouts.map(r => `<tr><td style="padding:7px 0;font-size:13.5px;color:${INK};">
        <a href="${publicAppUrl()}/app/agent?view=changed" style="color:${EMERALD};text-decoration:underline;">${digestEsc(r.headline)}</a></td></tr>`).join("")}</table>
    </div>` : "";
  const teamBlock = team && team.length ? `
    <div style="margin-top:22px;padding-top:14px;border-top:1px solid #dcd8cd;">
      <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:${SAGE};">Across the team</div>
      <table style="margin-top:6px;border-collapse:collapse;">${team.map(r =>
        `<tr><td style="padding:3px 0;font-size:13px;color:${INK};">${digestEsc(displayNameCase(r.who))}<span style="color:${SAGE};"> · ${r.n} open${r.overdue ? ` · ${r.overdue} overdue` : ""}</span></td></tr>`).join("")}</table>
    </div>` : "";

  // The org's mailing address in the footer when it has one. This goes to a
  // person's own work account, so with no address on file there is no line.
  const addr = org.receipt_address && String(org.receipt_address).trim();
  const footer = addr
    ? `<div style="margin-top:22px;padding-top:12px;border-top:1px solid #dcd8cd;font-size:11px;color:${SAGE};">${digestEsc(displayNameCase(org.legal_name || org.name || ""))} · ${digestEsc(addr)}</div>`
    : "";

  // The one button: the first person waiting, else her tasks, else Home.
  const button = threads.length
    ? L.buttonHtml(`Open ${L.nameOrFallback(threads[0].donorName)}`, `${base}/donors/${encodeURIComponent(threads[0].donorId)}?conversation=1`)
    : tasks.count ? L.buttonHtml(`Review ${tasks.count} ${tasks.count === 1 ? "task" : "tasks"}`, `${base}/app/tasks`)
    : L.buttonHtml("Open Steward", `${base}/dashboard`);
  return `<div style="padding:22px;background:#f0ede6;font-family:'DM Sans',Helvetica,Arial,sans-serif;">
      <div style="font-size:11.5px;letter-spacing:0.1em;text-transform:uppercase;color:${SAGE};">${digestEsc(displayNameCase(user?.name || ""))} · ${digestEsc(orgTime.civilLocale(today, { month: "long", day: "numeric", year: "numeric" }))}</div>
      ${threadBlock}${readoutBlock}${taskBlock}${meetingBlock}${teamBlock}${button}${footer}
      ${user && user.id && user.email ? `<div style="margin-top:10px;font-size:11px;color:${SAGE};">You get this because the morning email is on in Settings, under Your email, where you choose what is in it and when it comes. <a href="${staffUnsubscribeUrl(user, org.id)}" style="color:${SAGE};text-decoration:underline;">Unsubscribe</a> from the morning email.</div>` : ""}
    </div>`;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 491

// ── BUILD-85 — THE MORNING BRIEF: ONE EMAIL ────────────────────────────────
// Before this, `processDailyTaskReminders` and `processThreadNudges` shared
// the SAME [6,12) window and sent two separate emails to the same person, with
// two different scoping rules — the Thread was meant to end the tasks battle
// and was instead standing next to it. This is the one sender.
//
// IT RESERVES BOTH LEDGERS. `thread_nudge` and `daily_tasks` each keep their
// own digest_sends key, so whichever tick arrives first sends the combined
// brief and the other finds the reservations taken and does nothing. Two
// timers, one email, and neither idempotency ledger had to be rewritten.
//
// STAFF-MAIL-1: `notify_thread_nudge` is the whole email's switch, and what
// goes in it is the person's own sections (briefSettings). Every section off,
// or the switch off, is no email at all and nothing reserved.
// LIVE-1 · the readouts written since the last weekday morning: yesterday's,
// or Friday's and the weekend's on a Monday. Their headlines, newest first.
async function yesterdaysReadouts(orgId, today) {
  const dow = new Date(today + "T12:00:00Z").getUTCDay();
  const from = orgTime.addDays(today, dow === 1 ? -3 : -1);
  return query(`SELECT id, headline, for_date FROM readouts WHERE org_id=? AND removed_at IS NULL AND is_example IS NOT TRUE
                  AND for_date >= ? AND for_date < ? ORDER BY created_at DESC LIMIT 5`, [orgId, from, today]).catch(() => []);
}
// SPLIT-2 end
// SPLIT-2 server.js piece 493
function briefDueNow(b, today, nowHour, force) {
  if (force) return null;
  const dow = orgTime.dayOfWeek(today);   // 0=Mon … 6=Sun
  if (b.days === "weekdays" && (dow === null || dow >= 5)) return "not_today";
  if (nowHour != null && (nowHour < b.hour || nowHour >= b.hour + BRIEF_CATCH_UP_HOURS)) return "not_yet";
  return null;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 494

async function runMorningBriefForOrg(org, { today, send = true, nowHour = null, force = false }) {
  await ItemRefs.links();   // THREAD-2: the email's links are ready before it renders
  const out = { sent: [], skipped: [] };
  // TIDY-1: what one person's email carries and says is server/mail/morningBrief.js,
  // the one builder Settings' preview and test send render from too.
  const MB = require("../mail/morningBrief");
  const users = await query(`SELECT ${MB.USER_COLS} FROM users WHERE org_id=? AND email IS NOT NULL`, [org.id]);
  const team = await MB.teamRollup(org.id, today);
  const briefCarriedMeetings = new Set();

  for (const u of users) {
    const b = briefSettings(u);
    if (!b.on) { out.skipped.push({ recipientUserId: u.id, reason: "opted_out" }); continue; }
    const notNow = briefDueNow(b, today, nowHour, force);
    if (notNow) { out.skipped.push({ recipientUserId: u.id, reason: notNow }); continue; }
    const p = await MB.composeFor(org, u, today, team);
    if (p.empty) {
      // WHY there is no email matters to whoever is reading this report: a
      // person who turned both notifications off is not the same as a person
      // with a clear morning, and reporting both as "empty" hides a setting
      // somebody may not have meant to leave that way.
      out.skipped.push({ recipientUserId: u.id, reason: p.suppressed ? "opted_out" : "empty" });
      continue;
    }

    const subject = morningBriefSubject(p.threads, p.tasks.count, org, 0, p.readouts.length);
    const payload = { recipientUserId: u.id, email: u.email, subject,
                      threads: p.threads.length, tasks: p.tasks.count, meetings: p.meetings.length, readouts: p.readouts.length, count: p.threads.length + p.tasks.count };
    if (!send) { out.sent.push(payload); continue; }

    // Reserve only the ledgers whose section this brief actually carries. A
    // section whose day is already reserved is DROPPED from the body, not
    // re-sent — so a second tick can never repeat a line the user has read.
    if ((p.threads.length || p.readouts.length) && !(await reserveDigest(org.id, "thread_nudge", "day:" + today, u.id, u.email, "user", { count: p.threads.length, oldestDays: p.threads.length ? p.threads[0].daysOpen : 0, readouts: p.readouts.length }))) { p.threads = []; p.more = 0; p.readouts = []; }
    if ((p.tasks.count || p.meetings.length) && !(await reserveDigest(org.id, "daily_tasks", "day:" + today, u.id, u.email, "user", { count: p.tasks.count, overdue: p.tasks.overdue.length, meetings: p.meetings.length }))) { p.tasks = { rows: [], overdue: [], dueToday: [], count: 0 }; p.meetings = []; }
    if (p.threads.length === 0 && p.tasks.count === 0 && p.meetings.length === 0 && p.readouts.length === 0) { out.skipped.push({ recipientUserId: u.id, reason: "already_sent" }); continue; }

    const mail = MB.renderFor(org, u, today, p);
    if (await sendDigestEmail(org, u.email, mail.subject, mail.body)) { out.sent.push({ ...payload, threads: p.threads.length, tasks: p.tasks.count, meetings: p.meetings.length }); if (p.meetings.length) briefCarriedMeetings.add(u.id); }
    else out.skipped.push({ recipientUserId: u.id, reason: "provider_refused" });
  }
  // FIX-12 Part 7a: the opt-in meetings email rides the same morning tick.
  try { out.meetingBriefs = await runMeetingBriefForOrg(org, { today, send, skipUsers: briefCarriedMeetings, nowHour }); }
  catch (e) { console.error("[meeting-brief]", org.id, e.message); }
  return out;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 495

// Kept as the name the ops route and the suites call. One sender underneath.
async function runThreadNudgesForOrg(org, opts) { return runMorningBriefForOrg(org, opts); }
// SPLIT-2 end
// SPLIT-2 server.js piece 496

// ── FIX-12 Part 7a — "YOUR MEETINGS TODAY", BY EMAIL, IF SHE ASKS ──────────
// The same meetings and the same briefs Home shows (routes/finance.js
// composeTodayMeetings), to the staff member's OWN sign-in address and nobody
// else. Off unless she ticks it in Settings → Account. One a day (the
// meeting_brief ledger), and none on a day with no meetings.
async function runMeetingBriefForOrg(org, { today, send = true, skipUsers = null, nowHour = null }) {
  const out = { sent: [], skipped: [] };
  const users = await query(
    "SELECT id, name, email, brief_hour FROM users WHERE org_id=? AND email IS NOT NULL AND deactivated_at IS NULL AND notify_meeting_brief = true", [org.id]);
  const fin = require("../../routes/finance");
  for (const u of users) {
    // STAFF-MAIL-1 · it comes at the hour she picked for her morning email.
    if (briefDueNow({ ...briefSettings(u), days: "every_day" }, today, nowHour, false)) { out.skipped.push({ recipientUserId: u.id, reason: "not_yet" }); continue; }
    // FIX-34 · the morning email already carried her meetings: one email, not two.
    if (skipUsers && skipUsers.has(u.id)) { out.skipped.push({ recipientUserId: u.id, reason: "in_morning_brief" }); continue; }
    const { meetings } = await fin.composeTodayMeetings(org.id, u.id, { withLogged: true });
    if (!meetings.length) { out.skipped.push({ recipientUserId: u.id, reason: "no_meetings" }); continue; }
    if (!send) { out.sent.push({ recipientUserId: u.id, count: meetings.length }); continue; }
    if (!(await reserveDigest(org.id, "meeting_brief", "day:" + today, u.id, u.email, "user", { count: meetings.length }))) {
      out.skipped.push({ recipientUserId: u.id, reason: "already_sent" }); continue;
    }
    const tz = org.timezone || "America/New_York";
    const at = iso => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
    const lines = b => [b && b.giving && `Giving: ${b.giving.text}`, b && b.openAsk && `Open ask: ${b.openAsk.text}`,
      b && b.lastTime && `Last time: ${b.lastTime.text}`, b && b.unthanked && b.unthanked.text].filter(Boolean);
    const body = `<p style="color:#0f1a12;">Good morning${u.name && GREET && GREET.greetingName({ name: u.name }) ? ", " + escHtmlWf(GREET.greetingName({ name: u.name })) : ""}. Here ${meetings.length === 1 ? "is the meeting" : `are the ${meetings.length} meetings`} on your calendar today, with what Steward knows about each person.</p>`
      + meetings.map(m => `<div style="margin:14px 0;padding:12px 14px;background:#F0EDE6;border-radius:8px;">
<p style="margin:0;color:#0f1a12;"><strong>${escHtmlWf(m.startsAt ? at(m.startsAt) : "Today")}</strong> · ${escHtmlWf(m.title || "Meeting")}${(m.people || []).length ? " with " + escHtmlWf(m.people.map(p => p.name).join(", ")) : ""}</p>
${lines(m.brief).map(l => `<p style="margin:4px 0 0;color:#3a4a3f;font-size:14px;">${escHtmlWf(l)}</p>`).join("")}</div>`).join("")
      + `<p style="color:#6b7d70;font-size:13px;">You asked for this email in Settings, under Your email. Untick "Your meetings today" there to stop it.</p>`;
    if (await sendDigestEmail(org, u.email, meetings.length === 1 ? "Your meeting today" : `Your ${meetings.length} meetings today`, body)) out.sent.push({ recipientUserId: u.id, count: meetings.length });
    else out.skipped.push({ recipientUserId: u.id, reason: "provider_refused" });
  }
  return out;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 500
function weeklyDay(civil) {
  const c = orgTime.parseCivil(String(civil || "").slice(0, 10));
  if (!c) return "";
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return `${DOW[orgTime.dayOfWeek(String(civil).slice(0, 10))]} ${MON[c.m - 1]} ${c.d}`;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 501
// "Not this week" until the org's Monday, from 7 AM until six hours after.
function weeklyDueNow(today, nowHour, force) {
  if (force) return null;
  if (orgTime.dayOfWeek(today) !== 0) return "not_today";
  if (nowHour != null && (nowHour < WEEKLY_HOUR || nowHour >= WEEKLY_HOUR + WEEKLY_CATCH_UP_HOURS)) return "not_yet";
  return null;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 502

// The org-wide half (last week, pledges, events) is the same for everyone, so
// it is composed once per org; the person's own steps and follow-ups per person.
async function composeWeeklyOrgPart(orgId, monday) {
  const sunday = orgTime.addDays(monday, 6);
  const lastMon = orgTime.addDays(monday, -7), lastSun = orgTime.addDays(monday, -1);
  const since = await require("../../routes/crm").reportHooks.thanksSince(orgId);   // Home's start date for thank-yous owed
  const giftsSrc = { key: "gifts", params: { from: lastMon, to: lastSun } };
  const unthankedSrc = { key: "unthanked", params: { since } };
  const [giftSum, giftCount, unthanked] = await Promise.all([
    figureSources.figureValue(orgId, giftsSrc),
    figureSources.figureValue(orgId, { key: "gifts", params: { ...giftsSrc.params, measure: "count" } }),
    figureSources.figureValue(orgId, unthankedSrc),
  ]);
  const DS = require("../../donorStatus");
  const st = DS.statusSql(orgId, monday, await DS.cutsFor(orgId));
  const lapsed = await query(
    `SELECT d.id, d.name, d.email, s.last_date FROM (${st.sql}) s JOIN donors d ON d.id = s.donor_id AND d.org_id = ?
      WHERE ${DS.tagColumn("lapsed")} AND d.deceased IS NOT TRUE AND s.last_date::date BETWEEN ?::date AND ?::date
      ORDER BY s.last12 DESC NULLS LAST, d.name`,
    [...st.args, orgId, "lapsed", orgTime.addDays(lastMon, -lapseRule.LAPSED_DAYS), orgTime.addDays(lastSun, -lapseRule.LAPSED_DAYS)]);
  const pledges = await query(
    `SELECT i.id, i.due_date, i.amount, d.id AS donor_id, d.name AS donor_name, d.email AS donor_email
       FROM pledge_installments i JOIN pledges p ON p.id = i.pledge_id AND p.org_id = i.org_id
       JOIN donors d ON d.id = p.donor_id AND d.org_id = p.org_id
      WHERE i.org_id = ? AND i.paid_gift_id IS NULL AND d.deleted_at IS NULL AND COALESCE(p.status, 'open') = 'open'
        AND i.due_date >= ? AND i.due_date <= ?
      ORDER BY i.due_date, i.amount DESC`, [orgId, monday, sunday]);
  const events = await query(
    `SELECT id, name, TO_CHAR(date, 'YYYY-MM-DD') AS date FROM events WHERE org_id = ? AND date >= ?::date AND date <= ?::date
        AND COALESCE(status, 'upcoming') NOT IN ('cancelled', 'canceled')
      ORDER BY date, name`, [orgId, monday, sunday]);
  return {
    monday, sunday, lastWeek: { from: lastMon, to: lastSun },
    giftCount: Number(giftCount.value) || 0, giftDollars: Number(giftSum.value) || 0,
    unthanked: Number(unthanked.value) || 0,
    lapsed: lapsed.map(r => ({ id: r.id, name: displayNameCase(r.name || ""), email: r.email })),
    pledges: pledges.map(r => ({ id: r.id, due: String(r.due_date).slice(0, 10), amount: Number(r.amount) || 0, donorId: r.donor_id, donorName: displayNameCase(r.donor_name || ""), donorEmail: r.donor_email })),
    events: events.map(e => ({ id: e.id, name: e.name, date: e.date })),
    sources: { gifts: giftsSrc, unthanked: unthankedSrc },
  };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 504
function weeklyTaskKind(t) {
  const by = String(t.created_by || "");
  return by.startsWith("system:") ? by.replace(/\/[^/]*$/, "") : null;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 505
function groupWeeklyTasks(rows) {
  const out = [], byKind = new Map();
  for (const t of rows) {
    const kind = weeklyTaskKind(t);
    const g = kind && byKind.get(kind);
    if (g) { g.tasks.push(t); if (String(t.due) < String(g.due)) g.due = t.due; continue; }
    const line = { kind, tasks: [t], due: t.due };
    if (kind) byKind.set(kind, line);
    out.push(line);
  }
  return out.map(g => {
    const [t] = g.tasks, rule = g.kind && WEEKLY_TASK_KINDS[g.kind];
    if (g.tasks.length === 1) return { id: t.id, title: t.title, due: t.due, donor_id: t.donor_id, donor_name: t.donor_name, n: 1 };
    const title = rule ? rule.line(g.tasks.reduce((a, x) => a + rule.count(x), 0))
      : `${t.title}, and ${g.tasks.length - 1} more like it`;
    return { id: null, title, due: g.due, n: g.tasks.length };
  });
}
// SPLIT-2 end
// SPLIT-2 server.js piece 506

async function composeWeeklyEmail(org, u, monday, orgPart) {
  const isAdmin = u.role === "admin";
  const steps = await composeThreadNudgeQueue(org.id, orgPart.sunday, { userId: u.id, isAdmin, keepTimed: true });
  const tasks = groupWeeklyTasks((await composeDailyTaskReminder(org.id, u.id, orgPart.sunday)).rows);
  return { ...orgPart, steps: steps.list, stepCount: steps.total, tasks, taskCount: tasks.length };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 508

function weeklySubject(w, org) {
  const n = w.stepCount + w.taskCount;
  const name = displayNameCase(org.name || "");
  if (weeklyIsEmpty(w)) return `Your week · ${name}: nothing needs you`;
  return n ? `Your week · ${n} ${n === 1 ? "thing needs" : "things need"} you · ${name}` : `Your week · ${name}`;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 509

function renderWeeklyBody(w, org, user) {
  const INK = "#0f1a12", SAGE = "#6b7d70", EMERALD = "#0d5c3a", BRASS = "#c9a84c";
  const L = staffLinks(), base = publicAppUrl();
  const QUIET = `color:${SAGE};text-decoration:underline;`;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const person = (id, name, email) => L.refLinkHtml({ kind: "person", id, name, email }, base, { style: `color:${EMERALD};text-decoration:underline;` });
  const list = items => `<ul style="margin:6px 0 0;padding-left:18px;">${items.map(i => `<li style="margin:4px 0;font-size:13.5px;color:${INK};">${i}</li>`).join("")}</ul>`;
  const more = (shown, total) => total > shown ? `<div style="font-size:12px;color:${SAGE};margin-top:4px;">and ${total - shown} more in Steward.</div>` : "";
  const head = t => `<div style="font-family:'DM Serif Display',Georgia,serif;font-size:17px;color:${INK};margin-top:20px;">${t}</div>`;
  // POLISH-4: the one greeting rule (greeting.js), never "Good morning, Dr."
  const first = displayNameCase(GREET ? GREET.greetingName({ name: String(user?.name || "") }) : String(user?.name || "").split(/\s+/)[0] || "");
  const empty = weeklyIsEmpty(w);

  let ahead = "";
  if (!empty) {
    const parts = [];
    if (w.stepCount) parts.push(`${head("Next steps due")}${list(w.steps.slice(0, WEEKLY_LIST_CAP).map(t => `${person(t.donorId, t.donorName)}<span style="color:${SAGE};"> · ${t.stepRef ? L.refLinkHtml(t.stepRef, base, { label: t.stepLabel, style: QUIET }) : digestEsc(t.stepLabel || "")} · ${String(t.due).slice(0, 10) < w.monday ? "overdue" : digestEsc(weeklyDay(t.due))}</span>`))}${more(Math.min(w.steps.length, WEEKLY_LIST_CAP), w.stepCount)}`);
    if (w.taskCount) parts.push(`${head("Follow-ups due")}${list(w.tasks.slice(0, WEEKLY_LIST_CAP).map(t => `${t.id ? L.refLinkHtml({ kind: "task", id: t.id, name: t.title }, base, { style: `color:${INK};text-decoration:underline;` }) : `<a href="${base}/app/tasks" style="color:${INK};text-decoration:underline;">${digestEsc(t.title)}</a>`}<span style="color:${SAGE};"> · ${String(t.due).slice(0, 10) < w.monday ? "overdue" : digestEsc(weeklyDay(t.due))}${t.donor_id ? ` · ${digestEsc(displayNameCase(t.donor_name || ""))}` : ""}</span>`))}${more(Math.min(w.tasks.length, WEEKLY_LIST_CAP), w.taskCount)}`);
    if (w.pledges.length) parts.push(`${head("Pledge payments due")}${list(w.pledges.slice(0, WEEKLY_LIST_CAP).map(p => `${person(p.donorId, p.donorName, p.donorEmail)}<span style="color:${SAGE};"> · ${digestMoney(p.amount)} · ${digestEsc(weeklyDay(p.due))}</span>`))}${more(Math.min(w.pledges.length, WEEKLY_LIST_CAP), w.pledges.length)}`);
    if (w.events.length) parts.push(`${head("Events")}${list(w.events.slice(0, WEEKLY_LIST_CAP).map(e => `${digestEsc(e.name)}<span style="color:${SAGE};"> · ${digestEsc(weeklyDay(e.date))}</span>`))}${more(Math.min(w.events.length, WEEKLY_LIST_CAP), w.events.length)}`);
    if (!parts.length) parts.push(`<div style="font-size:14px;color:${INK};margin-top:14px;">Nothing is due this week.</div>`);
    ahead = parts.join("");
  }

  // LAST WEEK, IN A FEW LINES. Each figure is one Home and Atlas read.
  const lines = [];
  if (!empty) {
    lines.push(w.giftCount
      ? `${plural(w.giftCount, "gift", "gifts")} came in, ${digestMoney(w.giftDollars)} in all.`
      : "No gifts came in.");
    if (w.unthanked) lines.push(`${plural(w.unthanked, "gift is", "gifts are")} still waiting for a thank-you.`);
    if (w.lapsed.length) {
      const named = w.lapsed.slice(0, 3).map(p => person(p.id, p.name, p.email));
      const rest = w.lapsed.length - named.length;
      lines.push(`${named.join(", ")}${rest > 0 ? ` and ${plural(rest, "other", "others")}` : ""} lapsed: a year since their last gift.`);
    }
  }
  const lastWeek = lines.length ? `${head("Last week")}<div style="font-size:13.5px;color:${INK};line-height:1.6;margin-top:6px;">${lines.join(" ")}</div>` : "";

  const opening = empty
    ? `<div style="font-size:15px;color:${INK};margin-top:6px;line-height:1.55;">Good morning${first ? `, ${digestEsc(first)}` : ""}. Nothing needs you this week.</div>`
    : `<div style="font-size:15px;color:${INK};margin-top:6px;line-height:1.55;">Good morning${first ? `, ${digestEsc(first)}` : ""}. Here is your week.</div>`;
  const addr = org.receipt_address && String(org.receipt_address).trim();
  const footer = addr
    ? `<div style="margin-top:22px;padding-top:12px;border-top:1px solid #dcd8cd;font-size:11px;color:${SAGE};">${digestEsc(displayNameCase(org.legal_name || org.name || ""))} · ${digestEsc(addr)}</div>`
    : "";
  // A GET never changes state: the link opens My email, and the switch there is the one click.
  const settings = `${base}/app/settings?section=myemail&daily=1`;
  return `<div style="padding:22px;background:#f0ede6;font-family:'DM Sans',Helvetica,Arial,sans-serif;">
      <div style="font-size:11.5px;letter-spacing:0.1em;text-transform:uppercase;color:${SAGE};">Your week · ${digestEsc(weeklyDay(w.monday))} to ${digestEsc(weeklyDay(w.sunday))}</div>
      ${opening}${ahead}${lastWeek}
      <div style="margin-top:22px;padding-top:14px;border-top:2px solid ${BRASS};">${L.buttonHtml("Open Home", `${base}/dashboard`)}</div>
      ${footer}
      ${user && user.id && user.email ? `<div style="margin-top:10px;font-size:11px;color:${SAGE};">Want this every morning instead? <a href="${settings}" style="color:${EMERALD};text-decoration:underline;">Turn on the daily email</a>. You get this weekly email because it is on in Settings, under Your email. <a href="${staffUnsubscribeUrl(user, org.id, "weekly")}" style="color:${SAGE};text-decoration:underline;">Unsubscribe</a> from the weekly email.</div>` : ""}
    </div>`;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 510

// One per person per week (the `weekly_email` ledger). The org's Staff mail
// switch is read before anything is reserved, exactly as the digests do, so a
// week reserved while mail was off is never burned.
async function runWeeklyEmailForOrg(org, { today, send = true, nowHour = null, force = false }) {
  await ItemRefs.links();
  const out = { sent: [], skipped: [] };
  const notNow = weeklyDueNow(today, nowHour, force);
  if (notNow) { out.skipped.push({ reason: notNow }); return out; }
  if (send) {
    const gate = await orgMaySendEmail(org.id, mailPolicy.CATEGORY.STAFF);
    if (!gate.send) { out.gated = gate.reason; return out; }
  }
  const users = await query(
    "SELECT id, name, email, role, notify_weekly FROM users WHERE org_id=? AND email IS NOT NULL AND deactivated_at IS NULL", [org.id]);
  // The week this email is about starts on the Monday of `today`'s week.
  const monday = orgTime.addDays(today, -(orgTime.dayOfWeek(today) || 0));
  let orgPart = null;
  for (const u of users) {
    if (!(await userWantsEmail(u.id, "weekly"))) { out.skipped.push({ recipientUserId: u.id, reason: "opted_out" }); continue; }
    orgPart = orgPart || await composeWeeklyOrgPart(org.id, monday);
    const w = await composeWeeklyEmail(org, u, monday, orgPart);
    const subject = weeklySubject(w, org);
    const payload = { recipientUserId: u.id, email: u.email, subject, empty: weeklyIsEmpty(w),
      steps: w.stepCount, tasks: w.taskCount, pledges: w.pledges.length, events: w.events.length,
      giftCount: w.giftCount, giftDollars: w.giftDollars, unthanked: w.unthanked, lapsed: w.lapsed.map(p => p.id),
      sources: w.sources };
    if (!send) { out.sent.push({ ...payload, html: renderWeeklyBody(w, org, u) }); continue; }
    if (!(await reserveDigest(org.id, "weekly_email", "week:" + monday, u.id, u.email, "user", { steps: w.stepCount, tasks: w.taskCount, empty: payload.empty }))) {
      out.skipped.push({ recipientUserId: u.id, reason: "already_sent" }); continue;
    }
    if (await sendDigestEmail(org, u.email, subject, renderWeeklyBody(w, org, u))) out.sent.push(payload);
    else out.skipped.push({ recipientUserId: u.id, reason: "provider_refused" });
  }
  return out;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 511

// ── BUILD-84 FEATURE — A TASK WITH A TIME ON IT EMAILS AT THAT TIME ─────────
//
// A next step set for Monday at 2:00 sends ONE email Monday at 2:00, carrying
// the task, the donor, and a button into that donor's log-one-line screen. Not
// a reminder that it exists — a reminder at the moment the person said they
// would do it. The morning digest is the weaker form of the same promise: she
// reads it at eight, the call is at two, and by two the email is four screens
// up. This is the one notification that arrives while it can still change what
// she does.
//
// PRECEDENCE lives in shared/threadShape.js (digestShouldSkip /
// stepReminderDue), read by BOTH this sender and the digest, so a task can
// never be reported twice on the same day.
//
// THE WEEKEND RULE INVERTS HERE. The digest is weekday-only by default because
// a list of open threads on a Saturday is an intrusion nobody asked for. A
// time is a commitment to a MOMENT, so a timed step fires on weekends
// regardless of `orgs.thread_nudge_weekends`. There is deliberately no
// weekday gate below — that absence is the rule.
//
// TIMEZONE. The org's, always, and only when a human CHOSE it
// (`timezone_confirmed_at`). An org still carrying Steward's America/New_York
// default cannot set a time at all (the conversations route refuses it and the
// form says why), so this loop can never fire at a guessed hour.
//
// The button is a plain navigation to the donor's log-one-line screen,
// prefilled with the task. BUILD-81's rule stands unchanged and is the reason
// it stands: mail clients prefetch links, so a GET must never change state.
// Done and Snooze happen on the page, after a load, as POSTs.

// Every open, unsnoozed, timed step due TODAY for this org, with its donor.
async function composeStepReminders(orgId, today) {
  return await query(
    `SELECT t.id, t.donor_id, d.name AS donor_name, d.email AS donor_email, t.next_step_label, t.due_date, t.due_time,
            t.owner_id, t.owner_name, t.created_by, t.opened_on
       FROM threads t JOIN donors d ON d.id = t.donor_id AND d.org_id = t.org_id
      WHERE t.org_id = ? AND t.closed_at IS NULL AND d.deleted_at IS NULL
        AND t.due_time IS NOT NULL AND t.due_date = ?
        AND (t.snoozed_until IS NULL OR t.snoozed_until <= ?)
      ORDER BY t.due_time ASC, t.id ASC`,
    [orgId, today, today]);
}
// SPLIT-2 end
// SPLIT-2 server.js piece 512

function stepReminderSubject(t, timeLabel) {
  return `${timeLabel} · ${t.next_step_label} · ${staffLinks().nameOrFallback(displayNameCase(t.donor_name || ""), t.donor_email)}`;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 513

function renderStepReminderBody(t, org, timeLabel) {
  // The one button: the donor's LOG-ONE-LINE screen, prefilled with the task —
  // not the plain profile. She opens it to record what happened, which is the
  // action the email exists to produce.
  const url = `${publicAppUrl()}/donors/${encodeURIComponent(t.donor_id)}?conversation=1&step=${encodeURIComponent(t.next_step_label)}`;
  const addr = org.receipt_address && String(org.receipt_address).trim();
  const footer = addr
    ? `<div style="margin-top:22px;padding-top:12px;border-top:1px solid #dcd8cd;font-size:11px;color:#6b7d70;">${digestEsc(displayNameCase(org.legal_name || org.name || ""))} · ${digestEsc(addr)}</div>`
    : "";
  return `<div style="padding:22px;background:#f0ede6;font-family:'DM Sans',Helvetica,Arial,sans-serif;">
      <div style="font-family:'DM Serif Display',Georgia,serif;font-size:20px;color:#0f1a12;">${digestEsc(timeLabel)}. ${digestEsc(t.next_step_label)}.</div>
      <div style="font-size:14px;color:#0f1a12;margin-top:6px;">${staffLinks().refLinkHtml({ kind: "person", id: t.donor_id, name: displayNameCase(t.donor_name || ""), email: t.donor_email }, publicAppUrl())}</div>
      <div style="font-size:12.5px;color:#6b7d70;margin-top:2px;">This is the time you set for it.</div>
      ${staffLinks().buttonHtml(`Open ${staffLinks().nameOrFallback(displayNameCase(t.donor_name || ""), t.donor_email)}`, url)}
      ${footer}
    </div>`;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 514

// Run the timed reminders for one org at `nowHHMM` (the org's wall clock).
// send=false → compose only, reserving nothing.
async function runStepRemindersForOrg(org, { today, nowHHMM, send = true, force = false }) {
  await ItemRefs.links();   // THREAD-2
  const out = { sent: [], skipped: [] };
  const { stepReminderDue } = await threadShapeMod();
  const rows = await composeStepReminders(org.id, today);
  if (!rows.length) return out;
  const users = await query("SELECT id, name, email FROM users WHERE org_id=? AND email IS NOT NULL", [org.id]);
  for (const t of rows) {
    if (!force && !stepReminderDue(t, today, nowHHMM)) { out.skipped.push({ threadId: t.id, reason: "not_yet" }); continue; }
    const timeLabel = formatOrgStepTime(t.due_time);
    const subject = stepReminderSubject(t, timeLabel);
    const body = renderStepReminderBody(t, org, timeLabel);
    // Who hears about it: the thread's OWNER when it has one (the officer who
    // set the time), otherwise whoever created it, otherwise the org — the
    // same escalation the notification matrix uses. Never everyone: a time is
    // one person's commitment, not the org's.
    const targets = t.owner_id ? users.filter(u => u.id === t.owner_id)
                  : t.created_by ? users.filter(u => u.id === t.created_by)
                  : users;
    for (const u of (targets.length ? targets : users)) {
      if (!send) { out.sent.push({ threadId: t.id, recipientUserId: u.id, email: u.email, subject }); continue; }
      if (!(await userWantsEmail(u.id, "step_reminder"))) { out.skipped.push({ threadId: t.id, recipientUserId: u.id, reason: "opted_out" }); continue; }
      // ONE email per thread per user per day — the digest_sends idempotency
      // the nudge already uses, keyed on the thread so a step moved to a new
      // time on a later day is a new reminder and a re-run is not.
      const rid = await reserveDigest(org.id, "step_reminder", `step:${t.id}:${today}`, u.id, u.email, "user",
        { threadId: t.id, donorId: t.donor_id, due: t.due_date, time: t.due_time });
      if (!rid) { out.skipped.push({ threadId: t.id, recipientUserId: u.id, reason: "already_sent" }); continue; }
      if (await sendDigestEmail(org, u.email, subject, body)) out.sent.push({ threadId: t.id, recipientUserId: u.id, email: u.email, subject });
      else out.skipped.push({ threadId: t.id, recipientUserId: u.id, reason: "provider_refused" });
    }
  }
  return out;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 515

function formatOrgStepTime(hhmm) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm || ""));
  if (!m) return "";
  const h = +m[1], mi = +m[2];
  const ampm = h < 12 ? "AM" : "PM";
  return `${h % 12 === 0 ? 12 : h % 12}:${String(mi).padStart(2, "0")} ${ampm}`;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 516

async function processSequences({ orgId = null } = {}) {   // TRUST-1: a request passes its org; only the hourly job runs all orgs
  try {
    const enrollments = await query(
      `SELECT se.*, s.name AS seq_name, s.org_id, s.trigger AS seq_trigger
       FROM sequence_enrollments se
       JOIN sequences s ON se.sequence_id = s.id
       JOIN orgs o ON o.id = s.org_id
       WHERE se.status = 'active' AND se.next_send_at <= NOW()
         AND ${mailPolicy.orgSendsSql("o")}${orgId ? " AND s.org_id = ?" : ""}`,
      orgId ? [orgId] : []
    );
    for (const enr of enrollments) {
      try {
        const steps = await query(
          "SELECT * FROM sequence_steps WHERE sequence_id = ? ORDER BY step_order ASC",
          [enr.sequence_id]
        );
        const step = steps[enr.current_step];
        if (!step) {
          await run("UPDATE sequence_enrollments SET status='completed', completed_at=NOW() WHERE id=?", [enr.id]);
          continue;
        }
        // MAIL-1 (Jonathan, 4 Oct 2026): the onboarding sequence is OFF FOR
        // GOOD. Jonathan writes and sends onboarding himself. An enrolment that
        // survived from before is stopped here, with its reason, and sends nothing.
        if (enr.seq_trigger === "onboarding") {
          console.log(`[mail-policy] stopped onboarding enrollment ${enr.id} (org ${enr.org_id}): the onboarding sequence is off for good (MAIL-1)`);
          await run(`UPDATE sequence_enrollments SET status='stopped', last_error=? WHERE id=?`,
            ["Not sent: the onboarding sequence is off for good", enr.id]);
          continue;
        }
        const [recipient] = await query("SELECT id, name, email, salutation, spouse_name, kind, total_giving, last_gift_amount FROM donors WHERE id = ? AND org_id = ?", [enr.donor_id, enr.org_id]);
        // "Write a note" reminders are handled before the email-presence
        // check below — they're an in-app nudge for staff to write a real
        // note, not an email send, so a donor without an email on file can
        // still get one.
        if (enr.seq_trigger === "milestone") {
          const metaRaw0 = enr.metadata;
          const meta0 = metaRaw0 ? (typeof metaRaw0 === "string" ? JSON.parse(metaRaw0) : metaRaw0) : {};
          if (isNoteMoment(meta0.milestone_key)) {
            try {
              const points = await computeNoteTalkingPoints(enr.donor_id, enr.org_id, meta0);
              if (points) {
                await run(
                  `INSERT INTO note_reminders (id, org_id, donor_id, sequence_enrollment_id, milestone_key, talking_points, status)
                   VALUES (?,?,?,?,?,?,'pending')`,
                  [newId("note"), enr.org_id, enr.donor_id, enr.id, meta0.milestone_key || null, JSON.stringify(points.map(DRAFT_KEYS.templatize))]
                );
                console.log(`[note-reminder] queued for donor ${enr.donor_id} (${meta0.milestone_key})`);
              }
            } catch (e) { console.error("[note-reminder] failed:", e.message); }
            await run("UPDATE sequence_enrollments SET status='completed', completed_at=NOW() WHERE id=?", [enr.id]);
            continue;
          }
        }
        if (!recipient || !recipient.email) {
          const nxt = steps[enr.current_step + 1];
          if (nxt) {
            await run(
              `UPDATE sequence_enrollments SET current_step = current_step + 1, next_send_at = NOW() + INTERVAL '${parseInt(nxt.delay_days, 10)} days' WHERE id = ?`,
              [enr.id]
            );
          } else {
            await run("UPDATE sequence_enrollments SET status='completed', completed_at=NOW() WHERE id=?", [enr.id]);
          }
          continue;
        }
        const seqDecision = await donorMailDecision("sequence", recipient.email, enr.org_id, { donorId: recipient.id });
        if (!seqDecision.send) {
          console.log(`[seq] skipping recipient ${recipient.email} (${seqDecision.reason}) — enrollment ${enr.id}`);
          await run(
            `UPDATE sequence_enrollments SET status=?, completed_at=NOW() WHERE id=?`,
            // bounced stays bounced; every other refusal (unsubscribe, donor
            // flags) closes the enrollment as unsubscribed.
            [seqDecision.reason === "bounced" ? "bounced" : "unsubscribed", enr.id]
          );
          continue;
        }
        // Only non-note milestone moments reach here — note moments already
        // branched off and `continue`d above. Milestone emails default to
        // staff review rather than auto-send — the
        // AI drafts it, it lands in milestone_drafts for a human to approve/edit
        // (see POST /milestone-drafts/:id/send), and the enrollment is marked
        // complete here so the engine doesn't keep re-processing it. This is a
        // deliberate product decision, not a technical limitation: a tone-deaf
        // auto-sent milestone email is a real trust risk, matching the
        // human-in-the-loop pattern the AI daily briefing already uses
        // elsewhere in Steward (AI informs, staff acts). Flipping to fully
        // automatic sending later is a small change — swap the block below for
        // the same subject/body/send logic the rest of this function already uses.
        if (enr.seq_trigger === "milestone") {
          try {
            const metaRaw = enr.metadata;
            const meta = metaRaw ? (typeof metaRaw === "string" ? JSON.parse(metaRaw) : metaRaw) : {};
            const draft = await generateMilestoneDraft(recipient, enr.org_id, meta);
            if (draft) {
              await run(
                `INSERT INTO milestone_drafts (id, org_id, donor_id, sequence_enrollment_id, milestone_key, subject, body, status)
                 VALUES (?,?,?,?,?,?,?,'pending_review')`,
                [newId("mdraft"), enr.org_id, enr.donor_id, enr.id, meta.milestone_key || null, DRAFT_KEYS.templatize(draft.subject), DRAFT_KEYS.templatize(draft.body)]   // TRUTH-3: keys, not numbers
              );
              console.log(`[milestone] queued draft for donor ${enr.donor_id} (${meta.milestone_key}) — pending review`);
            } else {
              console.error(`[milestone] draft generation returned nothing for enrollment ${enr.id}`);
            }
          } catch (e) { console.error("[milestone] draft generation failed:", e.message); }
          await run("UPDATE sequence_enrollments SET status='completed', completed_at=NOW() WHERE id=?", [enr.id]);
          continue;
        }
        // Same human-in-the-loop pattern as the milestone branch above:
        // AI drafts a re-engagement email, it lands in milestone_drafts
        // (milestone_key='at_risk') for staff review, never auto-sent. See
        // computeAtRiskCandidates/autoEnroll's 'at_risk' branch below.
        if (enr.seq_trigger === "at_risk") {
          try {
            const draft = await generateAtRiskDraft(recipient, enr.org_id);
            if (draft) {
              await run(
                `INSERT INTO milestone_drafts (id, org_id, donor_id, sequence_enrollment_id, milestone_key, subject, body, status)
                 VALUES (?,?,?,?,?,?,?,'pending_review')`,
                [newId("mdraft"), enr.org_id, enr.donor_id, enr.id, "at_risk", DRAFT_KEYS.templatize(draft.subject), DRAFT_KEYS.templatize(draft.body)]   // TRUTH-3
              );
              console.log(`[at-risk] queued re-engagement draft for donor ${enr.donor_id} — pending review`);
            } else {
              console.error(`[at-risk] draft generation returned nothing for enrollment ${enr.id}`);
            }
          } catch (e) { console.error("[at-risk] draft generation failed:", e.message); }
          await run("UPDATE sequence_enrollments SET status='completed', completed_at=NOW() WHERE id=?", [enr.id]);
          continue;
        }
        const orgRows = await query("SELECT name FROM orgs WHERE id = ?", [enr.org_id]);
        const orgName = displayNameCase(orgRows[0]?.name) || "";
        const firstName = recipient.name ? (await GREET_READY).firstNames(recipient) : "";
        const greeting = recipient.name ? GREET.greetingName(recipient) : "";
        // SECURE-1: escaped into the body (HTML), as typed into the subject (text).
        const applyTokens = (str, e = x => x) => GREET.greetMerge(str || "", e(greeting))
          .replace(/{{donor_name}}/g, e(recipient.name))
          .replace(/{{user_name}}/g, e(recipient.name))
          .replace(/{{first_name}}/g, e(firstName))
          .replace(/{{org_name}}/g, e(orgName));
        const subject = applyTokens(step.subject);
        // ATLAS-4: the no-gift variant of "given before" for a never-giver (shared/giftSentence.js).
        const seqHasGift = Number(recipient.total_giving) > 0 || Number(recipient.last_gift_amount) > 0;
        const bodyRaw = applyTokens((await import("../../shared/giftSentence.js")).withoutGivenBefore(step.body, { hasGift: seqHasGift }), escapeHtml);
        const bodyHtml = (bodyRaw.includes("<") ? bodyRaw
          : `<p>${bodyRaw.replace(/\n\n+/g, "</p><p>").replace(/\n/g, "<br>")}</p>`)
          + await unsubscribeEmailFooterHtml(recipient.email, enr.org_id, "sequence");
        // BUILD-64: a donor-facing sequence carries the org's name in the inbox.
        const smtpFrom = await donorFromAddress(enr.org_id);
        // W-4 log honesty: the "Sequence: … Step N" interaction and the step
        // advance happen ONLY after a real delivery. A provider failure skips
        // both — next_send_at is untouched, so the next tick retries, and no
        // timeline entry claims an email that never left.
        // No provider is not a delivery (WHY-1 Part 8): the step stays, with its reason.
        let seqDelivered = false, seqErr = "No mail provider is configured";
        if (process.env.RESEND_API_KEY && smtpFrom) {
          seqErr = null;
          seqDelivered = false;
          try {
            // BUILD-88c C.1: a DONOR-facing sequence carries the org's own identity.
            const sendOpts = { ...(await donorSendOpts(enr.org_id, recipient.email, "sequence")),
                               to: recipient.email, subject, html: bodyHtml };
            const { error: sendErr } = await resend.emails.send(sendOpts);
            if (sendErr) { seqErr = sendErr.message || "refused"; console.error("[seq] send error:", sendErr.message); }
            else seqDelivered = true;
          } catch (e) { seqErr = e.message; console.error("[seq] resend error:", e.message); }
        }
        if (!seqDelivered) {
          // WHY-1 Part 8 — a refused step keeps its reason and is tried again
          // a day later, not on every hourly tick (that was a storm).
          console.error(`[seq] delivery failed for enrollment ${enr.id}; will retry in a day`);
          await run(`UPDATE sequence_enrollments SET last_error = ?, last_failed_at = NOW(), next_send_at = NOW() + INTERVAL '1 day' WHERE id = ?`,
            [String(seqErr || "refused").slice(0, 300), enr.id]).catch(() => {});
          continue;
        }
        if (enr.last_error) await run(`UPDATE sequence_enrollments SET last_error = NULL, last_failed_at = NULL WHERE id = ?`, [enr.id]).catch(() => {});
        {
          const intId = newId("i");
          const today = orgToday(await orgTz(enr.org_id));   // ORG_TZ_SEAM_OK (FIX-14 Part 2b)
          await run(
            "INSERT INTO interactions (id, org_id, donor_id, type, note, date) VALUES (?, ?, ?, 'email', ?, ?)",
            [intId, enr.org_id, enr.donor_id, `Sequence: ${enr.seq_name}: Step ${enr.current_step + 1}: ${step.subject}`, today]
          );
        }
        const nextStep = steps[enr.current_step + 1];
        if (nextStep) {
          await run(
            `UPDATE sequence_enrollments SET current_step = current_step + 1, next_send_at = NOW() + INTERVAL '${parseInt(nextStep.delay_days, 10)} days' WHERE id = ?`,
            [enr.id]
          );
        } else {
          await run("UPDATE sequence_enrollments SET status='completed', completed_at=NOW(), current_step=current_step+1 WHERE id=?", [enr.id]);
        }
      } catch (e) { console.error("[seq] enrollment", enr.id, e.message); }
    }
  } catch (e) { console.error("[seq] processSequences:", e.message); }
}
// SPLIT-2 end
// SPLIT-2 server.js piece 518

// Finds donors who just crossed a threshold (via their most recent gift) or
// just hit a giving anniversary. Each candidate carries a milestoneKey that
// uniquely identifies THIS specific milestone (e.g. "threshold_1000",
// "anniversary_year_3") so autoEnroll can tell a genuinely new milestone
// apart from one it already handled, without needing a separate table.
// TRUTH-2: every figure a draft states is read from shared/numbers when the
// draft is made (draftFigures.js), never the stored donors.total_giving.
async function figuresForDraft(orgId, donorId) {
  const N = require("../../shared/numbers");
  return N.draftFigures.draftFigures(query, orgId, donorId, N.fiscalYear.fiscalYearToDate(await orgTz(orgId)));
}
async function computeMilestoneCandidates(orgId) {
  const candidates = [];
  const { LIFETIME } = require("../../shared/numbers/lifetime");
  const { lastGifts } = require("../../shared/numbers/lastGift");

  const recentGiftDonors = await query(
    `SELECT d.id, ${LIFETIME("d")} AS total_giving FROM donors d
     WHERE org_id = ? AND deleted_at IS NULL AND email IS NOT NULL AND email != ''
       AND deceased IS NOT TRUE AND do_not_contact IS NOT TRUE
       AND last_gift_date IS NOT NULL AND last_gift_date::date >= NOW() - INTERVAL '2 days'`,
    [orgId]
  );
  const lastById = await lastGifts(query, orgId, recentGiftDonors.map(d => d.id));
  for (const d of recentGiftDonors) {
    const total = Number(d.total_giving) || 0;
    const lg = lastById.get(d.id);
    const lastAmt = lg ? lg.cents / 100 : 0;
    const priorTotal = total - lastAmt;
    for (const t of MILESTONE_THRESHOLDS) {
      if (priorTotal < t && total >= t) {
        candidates.push({ donorId: d.id, milestoneKey: `threshold_${t}`, milestoneType: "threshold", threshold: t });
        break; // only the highest threshold crossed by this one gift
      }
    }
  }

  const anniversaryDonors = await query(
    `SELECT id, first_gift_date FROM donors
     WHERE org_id = ? AND deleted_at IS NULL AND email IS NOT NULL AND email != ''
       AND deceased IS NOT TRUE AND do_not_contact IS NOT TRUE AND first_gift_date IS NOT NULL`,
    [orgId]
  );
  // ORG_TZ_SEAM_OK (BUILD-75 A.5) — anniversary math is CIVIL-date arithmetic
  // in the org's timezone: the org's today vs the stored first-gift civil date,
  // both as Y/M/D. The old form compared process-clock parts to a
  // new Date(str) parse (UTC midnight re-read in the process zone), which near
  // month boundaries in the UTC evening put "today" a day/month ahead.
  const today = orgTime.parseCivil(orgToday(await orgTz(orgId)));
  for (const d of anniversaryDonors) {
    const first = orgTime.parseCivil(d.first_gift_date);
    if (!first) continue;
    const dayDiff = Math.abs(today.d - first.d);
    const inWindow = dayDiff <= 3 || dayDiff >= 27; // loose +/-3 day window, tolerates month-length wraparound
    const monthsSince = (today.y - first.y) * 12 + (today.m - first.m);
    if (monthsSince === 6 && inWindow) {
      candidates.push({ donorId: d.id, milestoneKey: "anniversary_6mo", milestoneType: "anniversary", label: "6-month" });
      continue;
    }
    const yearsSince = today.y - first.y;
    if (yearsSince >= 1 && today.m === first.m && inWindow) {
      candidates.push({ donorId: d.id, milestoneKey: `anniversary_year_${yearsSince}`, milestoneType: "anniversary", label: `${yearsSince}-year` });
    }
  }
  return candidates;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 519

// Donors still in an active stage who've drifted past the earliest,
// most-recoverable risk window — the exact rule that used to live only as
// an inline "isLapsing" boolean in GET /dashboard/today. Promoted to a
// shared function so the dashboard display and the 'at_risk' auto-enroll
// trigger (see autoEnroll() below) can never drift into two different
// definitions of "at risk". Thresholds are hardcoded to match what
// /dashboard/today already used — not org-configurable yet. Requires an
// email on file (like computeMilestoneCandidates) since the output feeds an
// AI-drafted email, not just an in-app nudge.
// FIX-49 decision 6: "at risk" is the one lapsing rule (lapseRule.js: last
// gift 9 to 12 months ago, on the org's calendar), not its own 300 days on
// the server clock. The $5,000 floor is who is worth the email, not a lapse rule.
async function computeAtRiskCandidates(orgId) {
  const lapsing = require("../../shared/numbers/lapse").sql("lapsing", "LEFT(d.last_gift_date, 10)", orgToday(await orgTz(orgId)), "d.id");   // ORG_TZ_SEAM_OK
  return query(
    `SELECT id, name, email, total_giving, last_gift_date, last_gift_amount
     FROM donors d
     WHERE org_id = ? AND deleted_at IS NULL
       AND stage NOT IN ('prospect', 'lapsed')
       AND email IS NOT NULL AND email != ''
       AND ${solicitableSql("d")} AND ${donorOnly("d")}
       AND d.imported_sustainer IS NOT TRUE
       AND last_gift_date ~ '^\\d{4}-\\d{2}-\\d{2}' AND ${lapsing.sql}
       AND total_giving >= 5000`,
    [orgId, ...lapsing.args]
  );
}
// SPLIT-2 end
// SPLIT-2 server.js piece 521
// Only an answer JSON can carry exactly is stored (a NaN or an undefined would
// come back as something else); anything else is computed every time.
function driftJsonExact(v) {
  if (v === undefined) return false;
  if (typeof v === "number") return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(driftJsonExact);
  if (v && typeof v === "object") return Object.values(v).every(driftJsonExact);
  return true;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 522
// The gift-derived answer for `ids` (all of the org's donors when null), from
// the store where it is current and from the gifts where it is not.
async function driftGiftAnswers(orgId, today, ids, refusedById, { store = true } = {}) {
  const idFilter = ids ? " AND d.id = ANY(?)" : "";
  const stored = DRIFT_STORE_OFF() ? [] : await query(
    `SELECT s.donor_id, s.assessment, s.yesterday_high, s.pledge_recent, s.refused_rows
       FROM donor_drift s JOIN donors d ON d.id = s.donor_id AND d.org_id = s.org_id
      WHERE s.org_id = ? AND s.computed_for = ? AND d.deleted_at IS NULL${idFilter}`,
    [orgId, today, ...(ids ? [ids] : [])]);
  const out = new Map();
  for (const r of stored) {
    const a = JSON.parse(r.assessment);   // STATUS-1: an answer from before the one rhythm (no v) is recomputed, not read
    if ((refusedById.get(r.donor_id) || 0) !== r.refused_rows || (a && a.basis && a.v !== driftEngine.ANSWER_V)) continue; out.set(r.donor_id, { a, wasDriftingHigh: r.yesterday_high, pledgeRecent: r.pledge_recent });
  }
  const need = [...refusedById.keys()].filter(id => !out.has(id));
  if (!need.length) return out;
  // The old computation, unchanged, for the people with no current answer.
  // SCALE-1: json_agg, not array_agg (the driver's native JSON.parse); and
  // "d.org_id = g.org_id" is the tenant rule that lets the planner probe this
  // org's donors.
  const giftAgg = await query(`SELECT g.donor_id,
                  json_agg(g.date::text ORDER BY g.date) AS dates,
                  json_agg(g.amount ORDER BY g.date) AS amounts,
                  bool_or((g.notes ~* 'pledge (payment|installment)' OR g.pledge_id IS NOT NULL)
                          AND g.date::date >= ?::date - INTERVAL '730 days') AS pledge_recent
             FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
            WHERE g.org_id = ? AND d.deleted_at IS NULL AND d.id = ANY(?)
              AND g.date ~ '^\\d{4}-\\d{2}-\\d{2}'   -- LIST-1: a gift with no date has no place in a rhythm (and ''::date 500'd the list)
            GROUP BY g.donor_id`, [today, orgId, need]);
  const giftsByDonor = new Map(giftAgg.map(r => [r.donor_id, r]));
  const vals = [], tuples = [];
  for (const id of need) {
    const agg = giftsByDonor.get(id);
    const gifts = agg
      ? agg.dates.map((date, i) => ({ date: String(date).slice(0, 10), amount: parseFloat(agg.amounts[i]) || 0 }))
      : [];
    const refusedRows = refusedById.get(id) || 0;
    const a = driftEngine.assessDrift(gifts, today, { refusedRows });
    // POLISH-1 Part 6: the same gifts, read as of yesterday (see below).
    const y = driftEngine.assessDrift(gifts, orgTime.addDays(today, -1), { refusedRows });
    const ans = { a, wasDriftingHigh: y.state === "drifting" && y.confidence === "high", pledgeRecent: !!(agg && agg.pledge_recent) };
    out.set(id, ans);
    if (driftJsonExact(a)) {
      vals.push(orgId, id, JSON.stringify(a), ans.wasDriftingHigh, ans.pledgeRecent, refusedRows, today);
      tuples.push("(?,?,?,?,?,?,?)");
    }
  }
  if (!DRIFT_STORE_OFF() && store) {
    for (let i = 0; i < tuples.length; i += 2000) {
      const t = tuples.slice(i, i + 2000);
      await run(`INSERT INTO donor_drift (org_id, donor_id, assessment, yesterday_high, pledge_recent, refused_rows, computed_for)
                 VALUES ${t.join(",")}
                 ON CONFLICT (org_id, donor_id) DO UPDATE SET assessment = EXCLUDED.assessment, yesterday_high = EXCLUDED.yesterday_high,
                   pledge_recent = EXCLUDED.pledge_recent, refused_rows = EXCLUDED.refused_rows, computed_for = EXCLUDED.computed_for,
                   computed_at = NOW()`, vals.slice(i * 7, (i + t.length) * 7))
        .catch(e => console.error("[drift-store]", orgId, e.message));
    }
  }
  return out;
}
// SPLIT-2 end
// SPLIT-2 server.js piece 523

async function computeDriftForDonors(orgId, { donorIds = null, store = true } = {}) {   // LIST-2: store:false for a GET (its upsert waited on the drift job's row locks: 146 s)
  const org = await orgTz(orgId);
  const today = orgToday(org);                              // ORG_TZ_SEAM_OK
  const idFilter = donorIds ? " AND d.id = ANY(?)" : "";
  const idParams = donorIds ? [donorIds] : [];
  const [donors, recurringRows, pledgeRows, contactRows] = await Promise.all([
    query(`SELECT d.id, d.name, d.total_giving, d.deceased, d.do_not_contact, d.do_not_solicit,
                  d.imported_sustainer, d.tags, d.kind,
                  d.assigned_to, d.assigned_to_name, d.stripe_subscription_status,
                  d.created_at::date::text AS created_date
             FROM donors d WHERE d.org_id = ? AND d.deleted_at IS NULL AND d.erased_at IS NULL   -- TRUTH-2: an erased person has no rhythm to read
                                AND ${donorOnly("d")}${idFilter}`, [orgId, ...idParams]),
    // Every status that means "this donor is ON a subscription": active,
    // failing (past_due/recovering — the failed-payment path owns those),
    // recovered (billing again), and paused (a deliberate, known state with
    // its own portal-drift signal — not QUIET drift). Only canceled/lost
    // return a donor to voluntary cadence.
    // SCALE-2: asked about some people (a page of the donors list, one
    // profile, the after-change step), these three read only those people.
    query(`SELECT DISTINCT donor_id FROM recurring_subscriptions
            WHERE org_id = ? AND status IN ('active','past_due','recovering','recovered','paused')${donorIds ? " AND donor_id = ANY(?)" : ""}`,
          [orgId, ...idParams]),
    query(`SELECT DISTINCT donor_id FROM pledges WHERE org_id = ? AND status = 'open'${donorIds ? " AND donor_id = ANY(?)" : ""}`, [orgId, ...idParams]),
    // Last meaningful contact — powers HANDLED (the list stops resurfacing
    // someone already called; the badge is untouched, they are still drifting).
    query(`SELECT donor_id, MAX(date) AS last_contact FROM interactions
            WHERE org_id = ? AND type IN ${MEANINGFUL_CONTACT_TYPES}${donorIds ? " AND donor_id = ANY(?)" : ""} GROUP BY donor_id`, [orgId, ...idParams]),
  ]);
  const onSubscription = new Set(recurringRows.map(r => r.donor_id));
  const onPledge = new Set(pledgeRows.map(r => r.donor_id));
  // INSIGHTS-1: a person with an undated gift is never called gone quiet; we
  // can't see when they last gave. Their card asks for the date instead.
  const undatedGift = new Set((await query(`SELECT DISTINCT donor_id FROM gifts WHERE org_id = ? AND amount > 0 AND (date IS NULL OR date = '')${donorIds ? " AND donor_id = ANY(?)" : ""}`,
    [orgId, ...idParams])).map(r => r.donor_id));
  const lastContact = new Map(contactRows.map(r => [r.donor_id, String(r.last_contact).slice(0, 10)]));
  const handledCutoff = orgTime.addDays(today, -driftEngine.DRIFT.HANDLED_SNOOZE_DAYS);
  // BUILD-80 Part 2.4: the import stamps has-refused-rows:N; a refused row
  // caps this donor's drift confidence until it is resolved.
  const refusedById = new Map();
  for (const d of donors) {
    let refusedRows = 0;
    try {
      const tags = Array.isArray(d.tags) ? d.tags : JSON.parse(d.tags || "[]");
      for (const tg of tags) { const m = /^has-refused-rows:(\d+)$/.exec(String(tg)); if (m) refusedRows += Number(m[1]); }
    } catch { /* unreadable tags never break drift */ }
    refusedById.set(d.id, refusedRows);
  }
  const answers = await driftGiftAnswers(orgId, today, donorIds, refusedById, { store });

  const map = new Map();
  for (const d of donors) {
    const ans = answers.get(d.id);
    let excludedReason = null;
    // BUILD-80 Part 7 — a grant cycle is not a giving cadence: organisations
    // (and the anonymous holding record) are off every person surface.
    if (d.kind === "organisation" || d.kind === "anonymous") excludedReason = "organisation";
    else if (d.deceased) excludedReason = "deceased";
    else if (d.do_not_contact) excludedReason = "do_not_contact";
    else if (d.do_not_solicit) excludedReason = "do_not_solicit";           // BUILD-77 — an ask list may never carry a no-ask donor
    else if (onSubscription.has(d.id) || d.stripe_subscription_status === "active") excludedReason = "active_recurring";
    else if (d.imported_sustainer) excludedReason = "unlinked_sustainer";  // BUILD-77 Part 5 — their card stopped, they did not; the recurring surface owns them
    else if (onPledge.has(d.id) || (ans && ans.pledgeRecent)) excludedReason = "pledge_cadence";
    else if (undatedGift.has(d.id)) excludedReason = "undated_gift";
    if (excludedReason) {
      map.set(d.id, { state: "excluded", excludedReason, donorId: d.id });
      continue;
    }
    // The gift-derived answer (driftGiftAnswers above): stored, or computed
    // from the gifts and stored. POLISH-1 Part 6: wasDriftingHigh is the same
    // gifts read as of yesterday. Drift is computed against the org's civil
    // today, so the Home count can move at midnight with nothing new in the
    // file (the PREMIUM-1 walk saw 7 become 8 across 11:16pm to 12:05am). The
    // readout names who crossed.
    const a = ans.a;
    a.wasDriftingHigh = ans.wasDriftingHigh;
    a.donorId = d.id;
    a.donorName = d.name;
    a.assignedTo = d.assigned_to || null;
    a.assignedToName = d.assigned_to_name || null;
    a.donorCreatedDate = d.created_date || null;   // the quiet_past_pattern live-transition guard reads this
    const lc = lastContact.get(d.id);
    a.handled = !!(lc && orgTime.compareCivil(lc, handledCutoff) >= 0);
    map.set(d.id, a);
  }
  return { map, today };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 524

// Lazily provisions one "at_risk" sequence per org — unlike milestone
// sequences, this isn't gated on any org-level config (impact_metrics),
// since detecting a donor who's quietly drifted needs no configured content.
async function ensureAtRiskSequence({ orgId = null } = {}) {   // TRUST-1: made OFF ('paused'); with an orgId, that org only
  const orgs = orgId ? [{ id: orgId }] : await query("SELECT id FROM orgs", []);
  for (const o of orgs) {
    const existing = await query("SELECT id FROM sequences WHERE org_id = ? AND trigger = 'at_risk'", [o.id]);
    if (existing.length) continue;
    const seqId = newId("seq");
    await run(
      "INSERT INTO sequences (id, org_id, name, trigger, status, created_by, created_by_name) VALUES (?,?,?,?,'paused',?,?)",
      [seqId, o.id, "At-Risk Re-Engagement", "at_risk", SYS_AUTO.id, SYS_AUTO.name]
    );
    await run(
      "INSERT INTO sequence_steps (id, sequence_id, step_order, delay_days, subject, body) VALUES (?,?,?,?,?,?)",
      [newId("ss"), seqId, 0, 0, "At-risk re-engagement email (AI-drafted per donor)", ""]
    );
  }
}
// SPLIT-2 end
// SPLIT-2 server.js piece 525

// Lazily provisions one "milestone" sequence per org that has opted in by
// configuring at least one active impact_metrics row. A single dummy step is
// enough — milestone content is generated per-donor by generateMilestoneDraft(),
// not from sequence_steps.body like other trigger types.
async function ensureMilestoneSequences({ orgId = null } = {}) {
  const orgs = await query(`SELECT DISTINCT org_id FROM impact_metrics WHERE active = true${orgId ? " AND org_id = ?" : ""}`, orgId ? [orgId] : []);
  for (const o of orgs) {
    const existing = await query("SELECT id FROM sequences WHERE org_id = ? AND trigger = 'milestone'", [o.org_id]);
    if (existing.length) continue;
    const seqId = newId("seq");
    await run(
      "INSERT INTO sequences (id, org_id, name, trigger, status, created_by, created_by_name) VALUES (?,?,?,?,'paused',?,?)",
      [seqId, o.org_id, "Milestone & Anniversary Emails", "milestone", SYS_AUTO.id, SYS_AUTO.name]
    );
    await run(
      "INSERT INTO sequence_steps (id, sequence_id, step_order, delay_days, subject, body) VALUES (?,?,?,?,?,?)",
      [newId("ss"), seqId, 0, 0, "Milestone email (AI-drafted per donor)", ""]
    );
  }
}
// SPLIT-2 end
// SPLIT-2 server.js piece 527
function isNoteMoment(milestoneKey) {
  if (!milestoneKey) return false;
  return NOTE_MILESTONE_KEYS.has(milestoneKey) || milestoneKey.startsWith("anniversary_");
}
// SPLIT-2 end
// SPLIT-2 server.js piece 528

// Computes exactly 3 short, specific, real-data talking points for a
// "write a note" reminder. Deliberately NOT an AI call — no note content is
// ever generated here, only facts pulled straight from the donor record for
// a staff member to write their own note from.
async function computeNoteTalkingPoints(donorId, orgId, meta) {
  const donorRows = await query("SELECT * FROM donors WHERE id = ? AND org_id = ?", [donorId, orgId]);
  const donor = donorRows[0];
  if (!donor) return null;
  const F = await figuresForDraft(orgId, donorId);   // TRUTH-2
  const totalGiving = F.lifetime;
  const lastLine = F.lastGift ? `$${F.lastGift.amount.toLocaleString()} on ${orgTime.civilLocale(F.lastGift.date, { month: "long", day: "numeric", year: "numeric" })}` : null;
  const points = [];

  // 1. The milestone itself
  if (meta.milestone_type === "anniversary") {
    points.push(`This marks their ${meta.label || "giving"} anniversary with your organization.`);
  } else {
    points.push(`Just crossed $${(meta.threshold || 0).toLocaleString()} in total lifetime giving ($${totalGiving.toLocaleString()} total).`);
  }

  // 2. A personal detail — donor.notes first, else the most recent
  // interaction note on file
  let personalDetail = donor.notes && donor.notes.trim() ? donor.notes.trim() : null;
  if (!personalDetail) {
    const lastNoteRows = await query(
      "SELECT note FROM interactions WHERE donor_id = ? AND org_id = ? AND note IS NOT NULL AND note != '' ORDER BY date DESC NULLS LAST LIMIT 1",
      [donorId, orgId]
    );
    personalDetail = lastNoteRows[0]?.note || null;
  }
  points.push(personalDetail
    ? `From their file: "${personalDetail.slice(0, 140)}${personalDetail.length > 140 ? "…" : ""}"`
    : "No personal notes on file yet, worth asking what first drew them to this cause.");

  // 3. Something time-relevant — when the milestone itself is already an
  // anniversary (point 1), use recency of their last gift here instead so
  // this point doesn't just repeat "X years" a second time.
  if (meta.milestone_type === "anniversary") {
    points.push(lastLine ? `Most recent gift: ${lastLine}.` : `${F.giftCount} gift(s) total.`);
  } else if (donor.first_gift_date) {
    const first = new Date(donor.first_gift_date);
    if (!isNaN(first.getTime())) {
      const years = Math.floor((Date.now() - first.getTime()) / (365.25 * 86400000));
      points.push(years >= 1
        ? `They've been giving for ${years} year${years === 1 ? "" : "s"}, since ${orgTime.civilLocale(donor.first_gift_date, { month: "long", year: "numeric" })}.`
        : `They made their first gift on ${orgTime.civilLocale(donor.first_gift_date, { month: "long", day: "numeric", year: "numeric" })}.`);
    }
  }
  if (points.length < 3) {
    points.push(lastLine ? `Last gift: ${lastLine}.` : `${F.giftCount} gift(s) total.`);
  }

  return points.slice(0, 3);
}
// SPLIT-2 end
// SPLIT-2 server.js piece 529

// FIX-27 Part 7: the template sentence a milestone draft falls back to. It
// says only what Steward computed: the threshold crossed, or the anniversary.
// TRUTH-2: with the lifetime read from shared/numbers, it says that figure.
function milestoneTemplate(firstName, orgName, meta, opening = `Dear ${firstName},`, figures = null) {
  const D = require("../../shared/numbers/draftFigures");
  const line = meta.milestone_type === "anniversary"
    ? `It has been ${meta.label || "another year"} since your first gift to ${orgName || "us"}, and we are grateful for every year of it.`
    : figures && figures.lifetimeCents > 0
      ? `Your giving to ${orgName || "us"} has now reached ${D.dollars(figures.lifetime)}, and we wanted to thank you for every gift that got it there.`
      : `Your giving to ${orgName || "us"} has now passed $${(meta.threshold || 0).toLocaleString("en-US")}, and we wanted to thank you for every gift that got it there.`;
  return { subject: firstName ? `Thank you, ${firstName}` : "Thank you", body: `${opening}\n\n${line}\n\nWith gratitude,` };
}
// SPLIT-2 end
// SPLIT-2 server.js piece 530

// Generates a warm, specific, non-gamified thank-you draft for one milestone.
// The dollar math ({n} = floor(total / dollar_threshold)) is computed here in
// JS, not left to the model — only the prose is AI-written. Returns null on
// any failure so the caller can skip gracefully rather than queue garbage.
async function generateMilestoneDraft(recipient, orgId, meta) {
  const donorRows = await query("SELECT * FROM donors WHERE id = ? AND org_id = ?", [recipient.id, orgId]);
  const donor = donorRows[0];
  if (!donor) return null;
  const orgRows = await query("SELECT name FROM orgs WHERE id = ?", [orgId]);
  const orgName = displayNameCase(orgRows[0]?.name) || "";
  const F = await figuresForDraft(orgId, donor.id);   // TRUTH-2: never donors.total_giving
  const totalGiving = F.lifetime;

  const metricRows = await query(
    "SELECT * FROM impact_metrics WHERE org_id = ? AND active = true AND dollar_threshold <= ? ORDER BY dollar_threshold DESC LIMIT 1",
    [orgId, totalGiving]
  );
  let impactLine = null;
  if (metricRows.length) {
    const m = metricRows[0];
    const n = Math.max(1, Math.floor(totalGiving / Number(m.dollar_threshold)));
    impactLine = (await import("../../shared/countWords.js")).impactSentence(m.outcome_template, { n, amount: totalGiving });   // WALKB-1
  }

  const firstName = await greetFor(donor);
  const sinceMonth = donor.first_gift_date ? orgTime.civilLocale(donor.first_gift_date, { month: "long", year: "numeric" }) : null;
  const milestoneDesc = meta.milestone_type === "anniversary"
    ? `This marks their ${meta.label || "giving"} anniversary with your organization.`
    : `They just crossed $${(meta.threshold || 0).toLocaleString()} in total lifetime giving.`;

  try {
    const client = anthropicFor(orgId);
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 400,
      // FIX-28: a short draft needs no thinking (the ASK-3 bug: thinking can eat
      // a small budget and leave the reply cut off or empty).
      thinking: { type: "disabled" },
      system: `You write short, warm donor thank-you emails for a nonprofit development team. The donor just reached a real giving milestone. Rules: no hype, no exclamation-point overload, absolutely no gamification language, never say "tier", "level up", "unlock", "badge", "milestone reward", "leaderboard", or "you're so close to your next milestone". Write like a staff member who personally noticed and cared, not an app tracking progress. 3-5 sentences, plain language, specific, genuine. Return ONLY valid JSON: {"subject":"...","body":"..."}, no markdown, no code fences, no explanation.`,
      messages: [{
        role: "user",
        content: `Greet the donor as (use exactly this after "Dear"): ${firstName}
Organization: ${orgName}
Total given to date: $${totalGiving.toLocaleString()}
${sinceMonth ? `Donor's first gift was in ${sinceMonth}.` : ""}
Milestone: ${milestoneDesc}
${impactLine ? `Concrete impact to reference naturally (weave it in, don't just paste it verbatim): "${impactLine}"` : "No specific impact figure is configured for this giving level, keep it a genuine, specific thank-you about their giving without inventing outcome numbers."}

Write the email now.`,
      }],
    });
    // FIX-28: a reply that did not finish is never shown.
    if (msg.stop_reason && msg.stop_reason !== "end_turn") return null;
    const text = (msg.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.subject || !parsed.body) return null;
    // FIX-27 Part 7: a claim the record does not hold (a video nobody
    // recorded, an amount that is not theirs, a meeting nobody logged) and
    // the draft is the template sentence instead.
    const chk = await DRAFT_CHECK.checkDraft(`${parsed.subject}\n${parsed.body}`, await DRAFT_CHECK.draftRecord(orgId, donor.id));
    if (!chk.ok) {
      recordAiFallback(orgId, "milestone_draft", chk.reasons.join(" · "));
      return milestoneTemplate(firstName, orgName, meta, await openingLine(donor), F);
    }
    // TRUTH-2: a figure that claims a total is the lifetime or this year's giving.
    const wrong = require("../drafts/figureCheck").wrongTotals(`${parsed.subject}\n${parsed.body}`, F);
    if (wrong.length) {
      recordAiFallback(orgId, "milestone_draft", `total not theirs: ${wrong.join(", ")}`);
      return milestoneTemplate(firstName, orgName, meta, await openingLine(donor), F);
    }
    return { subject: String(parsed.subject), body: String(parsed.body) };
  } catch (e) {
    recordAiFallback(orgId, "milestone_draft", e);
    // WHY-1: with AI off, the same answer in a template sentence.
    if (e && e.name === "AiOffError") return milestoneTemplate(firstName, orgName, meta, await openingLine(donor), F);
    return null;
  }
}
// SPLIT-2 end
// SPLIT-2 server.js piece 531

// Generates a warm "thinking of you" re-engagement draft for a donor who
// just crossed into the earliest at-risk window (see
// computeAtRiskCandidates). Mirrors generateMilestoneDraft's shape and trust
// model — AI drafts, staff reviews/sends, never auto-sent — just a
// different prompt frame: a quiet drift to gently reconnect on, not a
// milestone worth celebrating. Returns null on any failure so the caller can
// skip gracefully rather than queue garbage.
async function generateAtRiskDraft(recipient, orgId) {
  const donorRows = await query("SELECT * FROM donors WHERE id = ? AND org_id = ?", [recipient.id, orgId]);
  const donor = donorRows[0];
  if (!donor) return null;
  const orgRows = await query("SELECT name FROM orgs WHERE id = ?", [orgId]);
  const orgName = displayNameCase(orgRows[0]?.name) || "";
  const F = await figuresForDraft(orgId, donor.id);   // TRUTH-2
  const totalGiving = F.lifetime;
  const daysSinceGift = F.lastGift
    ? Math.floor((Date.now() - new Date(F.lastGift.date).getTime()) / 86400000) : null;
  const firstName = await greetFor(donor);

  try {
    const client = anthropicFor(orgId);
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 400,
      thinking: { type: "disabled" },   // FIX-28: the ASK-3 rule, as above
      system: `You write short, warm "checking in" emails for a nonprofit development team to a longtime donor who has quietly gone a while without giving. Rules: no guilt trip, no hard ask, no gamification language, never say "tier", "level up", "unlock", "badge", "lapsed", "at risk", or "we noticed you stopped giving". Write like a staff member who genuinely thought of them and wanted to reconnect, not a system flagging inactivity. 3-5 sentences, plain language, specific, genuine. Return ONLY valid JSON: {"subject":"...","body":"..."}, no markdown, no code fences, no explanation.`,
      messages: [{
        role: "user",
        content: `Greet the donor as (use exactly this after "Dear"): ${firstName}
Organization: ${orgName}
Total given to date: $${totalGiving.toLocaleString()}
${daysSinceGift ? `Days since their last gift: ${daysSinceGift}` : ""}

Write the email now.`,
      }],
    });
    // FIX-28: a reply that did not finish is never shown.
    if (msg.stop_reason && msg.stop_reason !== "end_turn") return null;
    const text = (msg.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.subject || !parsed.body) return null;
    const chk = await DRAFT_CHECK.checkDraft(`${parsed.subject}\n${parsed.body}`, await DRAFT_CHECK.draftRecord(orgId, donor.id));
    if (!chk.ok) {
      recordAiFallback(orgId, "at_risk_draft", chk.reasons.join(" · "));
      return { subject: `Thinking of you, ${firstName}`,
        body: `${await openingLine(donor)}\n\nWe were thinking of you and wanted to say hello from ${orgName || "all of us"}. Thank you for everything you have given; it has mattered.\n\nWarmly,` };
    }
    return { subject: String(parsed.subject), body: String(parsed.body) };
  } catch (e) {
    recordAiFallback(orgId, "at_risk_draft", e);
    return null;
  }
}
// SPLIT-2 end

__share({ renderMorningBriefBody, yesterdaysReadouts, briefDueNow, runMorningBriefForOrg, runThreadNudgesForOrg, runMeetingBriefForOrg, weeklyDay, weeklyDueNow, composeWeeklyOrgPart, weeklyTaskKind, groupWeeklyTasks, composeWeeklyEmail, weeklySubject, renderWeeklyBody, runWeeklyEmailForOrg, composeStepReminders, stepReminderSubject, renderStepReminderBody, runStepRemindersForOrg, formatOrgStepTime, processSequences, computeMilestoneCandidates, computeAtRiskCandidates, driftJsonExact, driftGiftAnswers, computeDriftForDonors, ensureAtRiskSequence, ensureMilestoneSequences, isNoteMoment, computeNoteTalkingPoints, milestoneTemplate, generateMilestoneDraft, generateAtRiskDraft });
