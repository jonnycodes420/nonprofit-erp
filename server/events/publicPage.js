// server/events/publicPage.js — an event's public page, its thank-you page, the ticket, the calendar file, the waitlist and registration.
//
// SPLIT-1: moved VERBATIM from routes/crm.js. Nothing in it changed.
//
// routes/crm.js mounts it: each router below sits inside crm.js's r0 or r1 at the
// place its routes held in the one file, so Express tries them in the same order.
// mount() runs once at the end of boot with server.js's ctx and what the helper
// modules hand back. A relative require() or import() reads from this folder.
// Tests read it through readSource("server.js") (scripts/lib/readSource.js).
const express = require("express");
const PM = require("../../personMatch");   // WIRE-1 rule 1: one record per person   // WIRE-1 rule 2: every act lands on the timeline

const routers = {
  r1: express.Router(),
};

function mount(ctx) {
const {
  EV_PUBLIC_READY, EV_READY, donateLimiter, evDayWords, evMoney, evPage, eventPageHtml, logEventRegistered,
  orgTime, orgTzName, publicAppUrl, query, resolveOrgBrandTheme, run, uuid, wrap,
} = ctx;
let EV = null;
EV_READY.then(m => { EV = m; });

// ═══════════════════════════════════════════════════════════════════════════
//  EVENTS-1 item 3 · THE PUBLIC REGISTRATION PAGE
// ═══════════════════════════════════════════════════════════════════════════
//
// The org's own brand band and logo, the same shell the volunteer sign-up page
// wears (shared/publicPage.js — one renderer, two surfaces), embeddable like a
// donation form, and built for a phone first: 16px inputs so nothing zooms,
// 48px buttons because it is read one-handed on a sofa.
//
// WHAT IT TAKES: tickets with their deductible line stated before the button,
// the names of the people coming, a sponsorship, or a gift from somebody who
// cannot come at all.
//
// WHAT IT DOES NOT DO YET, SAID PLAINLY ON THE PAGE: take a card. A
// registration from here arrives in Steward as a REQUEST the office confirms,
// and confirming it runs the same `registerForEvent` writer every other
// registration runs, so the money is a gift through recordGift with the
// deductible split on it and there is no second money path. Taking the card
// inline means a Stripe Connect checkout session and a webhook branch that
// completes the registration, and half of that is worse than none: a page that
// takes a card and does not reliably finish the registration is a page that
// charges somebody for a seat they do not get.
let PPG = null;
const PPG_READY = import("../../shared/publicPage.js").then(m => { PPG = m; return m; });
// PARITY-2 Part 3: the page's own rules (times, video, share row, gallery).
let EPG = null;
const EPG_READY = import("../../shared/eventPage.js").then(m => { EPG = m; return m; });

// FIX-7 Part 2 — A PUBLIC EVENT SLUG CARRIES NO ORG, SO IT MUST NAME ONE
// EVENT. `/e/:slug` has no organisation in the path: the slug IS the address.
// The uniqueness index behind it is (org_id, public_slug), which permits two
// organisations to hold `harbor-run`, and this lookup used to take whichever
// row the planner handed back FIRST — one org's link quietly serving another
// org's event, which is the whole class Part 2 is sweeping for. Nothing in the
// product mints a public slug yet (only the demo seed sets one), so no live
// pair exists; the read is made safe now rather than after one does. Two
// claimants means the address is ambiguous, and an ambiguous address resolves
// to NOTHING, loudly in the log, rather than to a coin toss.
async function publicEvent(slug) {
  const rows = await query(
    `SELECT * FROM events WHERE public_slug=? AND status <> 'cancelled' LIMIT 2`, [String(slug || "")]);
  if (rows.length > 1) {
    console.error(`[events] public slug "${slug}" is claimed by ${rows.length} organizations — refusing to guess`);
    return null;
  }
  return rows[0] || null;
}
let app = routers.r1;

app.get("/e/:slug", donateLimiter, wrap(async (req, res) => {
  await EV_PUBLIC_READY;
  const e = await publicEvent(req.params.slug);
  // A slug that has been renamed still opens: the link is on a poster and in
  // somebody's messages, and it is not theirs to take back.
  if (!e) {
    const [moved] = await query(`SELECT public_slug FROM events WHERE previous_slug=? AND status <> 'cancelled' LIMIT 1`,
      [String(req.params.slug || "")]);
    if (moved) return res.redirect(301, `/e/${encodeURIComponent(moved.public_slug)}`);
  }
  if (!e) return res.status(404).send(evPage({ title: "Not found",
    brand: { band: "#0d5c3a", bandFg: "#fff", displayName: "" },
    body: `<div class="card"><h1>That page is not here.</h1><p class="muted">The link may have changed, or this event has been taken down. Ask the organization for its current link.</p></div>` }));
  res.setHeader("Cache-Control", "no-store");
  // EMBEDDABLE, the same rule the donation form follows.
  res.removeHeader("X-Frame-Options");
  res.setHeader("Content-Security-Policy", "frame-ancestors *");
  // SWEEP-4: an event page is not open to the public until the org can take
  // money through it, the same rule as its giving pages (FUNDRAISING-2). It
  // offered "Register" and promised somebody would be in touch about paying.
  // The staff editor's preview (eventPageHtml editable) still draws the page.
  const [payOrg] = await query("SELECT name, stripe_connected, stripe_account_id FROM orgs WHERE id=?", [e.org_id]);
  if (!(payOrg && payOrg.stripe_connected && payOrg.stripe_account_id)) {
    const brand = await resolveOrgBrandTheme(e.org_id).catch(() => null) || { band: "#0d5c3a", bandFg: "#fff", displayName: "" };
    const who = String(brand.displayName || "").trim() || payOrg?.name || "This organization";
    return res.status(404).send(evPage({ title: "Not open yet", brand, body:
      `<div class="card" data-testid="event-not-open"><h1>Not open yet</h1><p class="muted">${PPG.escapeHtml(who)}'s event page isn't open yet. Please check back soon.</p></div>` }));
  }
  res.send(await eventPageHtml(e, req.query || {}));
}));

// ── EVENTS-2 · THE ATTENDEE'S SIDE ────────────────────────────────────────
// Where Stripe sends somebody after they pay. It writes NOTHING: the webhook
// is what confirms a registration, and this page reports what it finds.
//
// The honest case is that the webhook has not landed yet, which happens for a
// second or two and occasionally for longer. The page says so plainly rather
// than pretending, and it refreshes itself: telling somebody who has just been
// charged that there is no record of them is the worst thing this page could
// do.
app.get("/e/:slug/thanks", donateLimiter, wrap(async (req, res) => {
  await EV_PUBLIC_READY;
  const e = await publicEvent(req.params.slug);
  if (!e) return res.status(404).send("Not found");
  const brand = await resolveOrgBrandTheme(e.org_id).catch(() => null) || { band: "#0d5c3a", bandFg: "#fff", displayName: "" };
  const esc = PPG.escapeHtml;
  const sessionId = String(req.query.s || "").slice(0, 200);
  res.setHeader("Cache-Control", "no-store");

  // Which registration this was: the hold carries the Checkout session id, and
  // the hold is stamped confirmed by the webhook that wrote the gift.
  let att = null;
  if (sessionId) {
    const [hold] = await query(
      `SELECT id, email, confirmed_at FROM event_seat_holds
        WHERE stripe_session_id=? AND org_id=? LIMIT 1`, [sessionId, e.org_id]);
    if (hold && hold.email) {
      [att] = await query(
        `SELECT a.id, a.name, a.email, a.quantity, a.dietary, l.name AS level_name
           FROM event_attendees a LEFT JOIN event_levels l ON l.id=a.level_id
          WHERE a.org_id=? AND a.event_id=? AND LOWER(a.email)=? AND a.status <> 'cancelled'
            AND a.registration_gift_id IS NOT NULL
          ORDER BY a.created_at DESC LIMIT 1`, [e.org_id, e.id, String(hold.email).toLowerCase()]);
    }
  }
  const day = e.date instanceof Date ? orgTime.civilOf(e.date).slice(0, 10) : String(e.date).slice(0, 10);
  const CAL = await import("../../shared/calendarLinks.js");
  const calEvent = await evCalendarEvent(e);
  const times = EPG.timeRangeWords(e.start_time, e.end_time);
  const whenWhere = `<p class="muted">${esc(evDayWords(e.date))}${times ? `, ${esc(times)}` : ""}${e.location ? ` · ${esc(e.location)}` : ""}</p>
    <p class="small">
      <a href="/e/${esc(e.public_slug)}/calendar.ics">Add to calendar</a>
      · <a href="${esc(CAL.googleUrl(calEvent))}">Google</a>
      · <a href="${esc(CAL.outlookUrl(calEvent))}">Outlook</a>
      ${e.location ? `· <a href="https://maps.google.com/?q=${encodeURIComponent(e.location)}">Directions</a>` : ""}
    </p>`;

  if (!att) {
    return res.send(withRefresh(evPage({ title: `Thank you · ${e.name}`, brand, body: `
      <div class="card">
        <h1>Thank you. Your payment went through.</h1>
        <p class="muted">We are putting you on the list now. This page finds you within a few seconds; if it does not, your email receipt is your proof of payment and ${esc(brand.displayName || "the organization")} has the record.</p>
        ${whenWhere}
      </div>` })));
  }

  const code = await evTicketQr(e.org_id, att, day);
  const orgSlug = (await orgSlugFor(e.org_id)) || "";
  res.send(evPage({ title: `You are coming · ${e.name}`, brand, body: `
    <div class="card">
      <h1>You are coming, ${esc(String(att.name || "").split(" ")[0])}.</h1>
      <div class="ok">${esc(att.level_name || "Ticket")}${Number(att.quantity) > 1 ? ` · ${att.quantity} places` : ""}. Your receipt is on its way by email.</div>
      ${whenWhere}
    </div>
    <div class="card" style="text-align:center">
      <h2 style="text-align:left">Your ticket</h2>
      ${code ? `<img src="${code}" alt="Your ticket code" style="width:210px;height:210px;display:block;margin:12px auto 6px">` : ""}
      <p class="small" style="text-align:left">Show this at the door. It is read by ${esc(brand.displayName || "the organization")} and says which ticket this is; it carries nothing else about you.</p>
      <a class="btn quiet" href="/you/${esc(orgSlug)}">Keep it on your page</a>
      <p class="small" style="text-align:left">Your page holds this ticket, your receipts and anything else you have with ${esc(brand.displayName || "us")}. It opens with a link to your email and never asks for a password.</p>
    </div>` }));
}));

// THE TICKET QR AS AN IMAGE, ADDRESSED BY THE CODE ITSELF. An email client
// will not render a data: URI, so the confirmation email points here. The code
// IS the credential and it carries nothing but which ticket this is; the
// endpoint verifies the signature before it draws anything, so a guessed or
// edited code renders no image rather than a valid-looking one.
//
// It is a GET and it writes nothing.
app.get("/ticket/:code.png", donateLimiter, wrap(async (req, res) => {
  const PASS = await import("../../shared/passCode.js");
  const read = PASS.readPassCode(String(req.params.code || ""), { secret: process.env.JWT_SECRET || "" });
  if (!read.ok) return res.status(404).send("Not found");
  let png = null;
  try { png = await require("qrcode").toBuffer(String(req.params.code), { width: 360, margin: 1, errorCorrectionLevel: "M" }); }
  catch { return res.status(500).send("Not available"); }
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(png);
}));

// A page that is waiting for a webhook says so and comes back on its own. Ten
// seconds, not one: a reload storm helps nobody and the webhook is usually
// there before the first one.
function withRefresh(html) {
  return html.replace("</head>", `<meta http-equiv="refresh" content="10"></head>`);
}

// THE TICKET QR. The same signed string a member card carries, with a
// different kind, so one scanner reads both (shared/passCode.js).
async function evTicketQr(orgId, attendee, eventDay) {
  try {
    const PASS = await import("../../shared/passCode.js");
    const code = PASS.makePassCode({ kind: "ticket", orgId, id: attendee.id,
      expiresOn: eventDay, secret: process.env.JWT_SECRET || "" });
    return await require("qrcode").toDataURL(code, { width: 320, margin: 1, errorCorrectionLevel: "M",
      color: { dark: "#0f1a12", light: "#ffffff" } });
  } catch { return null; }
}

// PARITY-2 Part 3: THE EVENT AS A CALENDAR ENTRY, built once for the .ics
// file and the Google and Outlook links so the three cannot disagree. A start
// time is the ORG's wall clock, converted to an instant through the one
// timezone seam; an end before the start is the small hours of the next day.
// A start with no end is entered as two hours. No start at all is an all-day
// entry (across every day of a multi-day event), never an invented evening.
async function evCalendarEvent(e) {
  const day = EPG.civil(e.date), last = EPG.civil(e.end_date) || day;
  let startInstant = null, endInstant = null;
  if (e.start_time) {
    const tz = await orgTzName(e.org_id);
    startInstant = orgTime.localToInstant(`${day}T${e.start_time}`, tz);   // ORG_TZ_SEAM_OK
    if (startInstant && e.end_time) {
      const endDay = last === day && e.end_time <= e.start_time ? orgTime.addDays(day, 1) : last;
      endInstant = orgTime.localToInstant(`${endDay}T${e.end_time}`, tz);   // ORG_TZ_SEAM_OK
    }
  }
  return {
    uid: `event-${e.id}@steward`, subject: e.name, dueCivil: day, endCivil: last,
    startInstant, endInstant, minutes: 120, location: e.location || "",
    description: [e.description || "", e.public_slug ? `${publicAppUrl()}/e/${e.public_slug}` : ""].filter(Boolean).join("\n\n"),
  };
}

// The event in a calendar. A GET, and it writes nothing.
app.get("/e/:slug/calendar.ics", donateLimiter, wrap(async (req, res) => {
  await EV_PUBLIC_READY;
  const e = await publicEvent(req.params.slug);
  if (!e) return res.status(404).send("Not found");
  const CAL = await import("../../shared/calendarLinks.js");
  const ics = CAL.buildIcs(await evCalendarEvent(e), { prodId: "-//Steward//Event//EN" });
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${String(e.public_slug || "event")}.ics"`);
  res.send(ics);
}));

// The waiting list. A name and an email, nothing charged, and a place is
// OFFERED by a person pressing a button — never handed out by a sweep.
app.post("/e/:slug/waitlist", donateLimiter, express.urlencoded({ extended: false }), wrap(async (req, res) => {
  await EV_PUBLIC_READY;
  const e = await publicEvent(req.params.slug);
  if (!e) return res.status(404).send("Not found");
  const done = () => res.redirect(303, `/e/${encodeURIComponent(e.public_slug)}?waitlisted=1`);
  if (String(req.body?.website || "").trim()) return done();
  const name = String(req.body?.name || "").trim().slice(0, 200);
  const email = String(req.body?.email || "").trim().toLowerCase().slice(0, 320);
  const [level] = await query("SELECT id FROM event_levels WHERE id=? AND event_id=? AND org_id=? AND retired_at IS NULL",
    [String(req.body?.levelId || ""), e.id, e.org_id]);
  if (!name || !email.includes("@") || !level) {
    return res.redirect(303, `/e/${encodeURIComponent(e.public_slug)}?problem=${encodeURIComponent("A name and an email, so they can reach you if a place comes free.")}`);
  }
  const [dup] = await query(`SELECT id FROM event_waitlist WHERE org_id=? AND level_id=? AND LOWER(email)=?
                              AND removed_at IS NULL AND taken_at IS NULL`, [e.org_id, level.id, email]);
  if (dup) return done();
  const [pos] = await query(`SELECT COALESCE(MAX(position),0)::int AS p FROM event_waitlist
                              WHERE org_id=? AND level_id=? AND removed_at IS NULL`, [e.org_id, level.id]);
  await run(`INSERT INTO event_waitlist (id,org_id,event_id,level_id,name,email,qty,position,created_by,created_by_name)
             VALUES (?,?,?,?,?,?,1,?, 'system:event-waitlist','The waiting list, from the event page')`,
    ["ewl_" + uuid().slice(0, 10), e.org_id, e.id, level.id, name, email, (pos?.p || 0) + 1]);
  done();
}));

async function orgSlugFor(orgId) {
  const [o] = await query("SELECT org_slug FROM orgs WHERE id=?", [orgId]);
  return o && o.org_slug;
}

app.post("/e/:slug/register", donateLimiter, express.urlencoded({ extended: false }), wrap(async (req, res) => {
  await EV_PUBLIC_READY;
  const e = await publicEvent(req.params.slug);
  if (!e) return res.status(404).send("Not found");
  const brand = await resolveOrgBrandTheme(e.org_id).catch(() => null) || { band: "#0d5c3a", bandFg: "#fff", displayName: "" };
  const esc = PPG.escapeHtml;
  const back = `<p><a class="btn quiet" href="/e/${esc(e.public_slug)}">Back</a></p>`;
  // The honeypot: a field no person sees and every simple bot fills in.
  if (String(req.body?.website || "").trim()) return res.send(evPage({ title: "Thank you", brand, body: `<div class="card"><h1>Thank you.</h1></div>` }));

  const name = String(req.body?.name || "").trim().slice(0, 200);
  const email = String(req.body?.email || "").trim().toLowerCase().slice(0, 200);
  if (!name || !email) {
    return res.status(400).send(evPage({ title: "Almost", brand, body:
      `<div class="card"><div class="err">A name and an email, so they know who is coming and how to reach you.</div>${back}</div>` }));
  }
  const [level] = await query("SELECT * FROM event_levels WHERE id=? AND event_id=? AND org_id=? AND retired_at IS NULL",
    [String(req.body?.levelId || ""), e.id, e.org_id]);
  if (!level) return res.status(400).send(evPage({ title: "Almost", brand, body:
    `<div class="card"><div class="err">That option is no longer available.</div>${back}</div>` }));
  // SWEEP-4: the page is not open until payments are connected, so neither is its form
  { const [o] = await query("SELECT name, stripe_connected, stripe_account_id FROM orgs WHERE id=?", [e.org_id]);
    if (!(o && o.stripe_connected && o.stripe_account_id)) return res.status(404).send(evPage({ title: "Not open yet", brand, body:
      `<div class="card" data-testid="event-not-open"><h1>Not open yet</h1><p class="muted">${esc(String(brand.displayName || "").trim() || o?.name || "This organization")}'s event page isn't open yet. Please check back soon.</p></div>` })); }
  const qty = Math.min(EV.MAX_QTY, Math.max(1, parseInt(req.body?.quantity, 10) || 1));

  // ONE PERSON, ONE RECORD. Matched by email first, exactly as every other
  // way into this file works; a registrant who already gives is the person
  // they already are.
  let donorId = await PM.findPersonId(e.org_id, { email, name });   // WIRE-1 rule 1
  if (!donorId) {
    donorId = "d_" + uuid().slice(0, 10);
    await run(`INSERT INTO donors (id,org_id,name,email,stage,status,tags,created_by,created_by_name)
               VALUES (?,?,?,?,'prospect','active','[]','system:event-registration','The registration page')`,
      [donorId, e.org_id, name, email]);
  }
  // A REQUEST, not money and not a seat taken. `registerForEvent` runs when
  // the office confirms it, and that is the one writer that turns a
  // registration into a gift with its deductible split.
  const attId = "att_" + uuid().slice(0, 10);
  await run(
    `INSERT INTO event_attendees (id,event_id,org_id,donor_id,name,email,status,level_id,quantity,dietary,source,notes)
     VALUES (?,?,?,?,?,?,'registered',?,?,?,'public',?)
     ON CONFLICT (event_id, donor_id) DO UPDATE SET
       level_id=EXCLUDED.level_id, quantity=EXCLUDED.quantity, dietary=COALESCE(EXCLUDED.dietary, event_attendees.dietary),
       status=CASE WHEN event_attendees.status='cancelled' THEN 'registered' ELSE event_attendees.status END`,
    [attId, e.id, e.org_id, donorId, name, email, level.id, level.kind === "ticket" ? qty : 1,
     String(req.body?.dietary || "").trim().slice(0, 200) || null,
     `From the registration page. ${level.name}.`]);
  // WIRE-1: the request is on the person's timeline, once per registration.
  const [attRow] = await query("SELECT id FROM event_attendees WHERE event_id=? AND donor_id=? AND org_id=?", [e.id, donorId, e.org_id]);
  await logEventRegistered(e.org_id, { id: attRow?.id || attId, donor_id: donorId }, e,
    { id: "system:event-registration", name: "The registration page" });

  // The other names on the ticket: each one is a person on the list with a
  // seat and a name tag, and NOT a second gift.
  const guests = String(req.body?.guests || "").split(/\r?\n/).map(x => x.trim()).filter(Boolean).slice(0, EV.MAX_QTY);
  for (const g of guests) {
    if (g.toLowerCase() === name.toLowerCase()) continue;
    // JOURNEYS-4 — the guest is a person record of their own.
    const gid = await PM.findOrCreateGuest(e.org_id, g, { id: "system:event-registration", name: "The registration page" }).catch(() => null);
    await run(
      `INSERT INTO event_attendees (id,event_id,org_id,donor_id,name,status,level_id,quantity,source,guest_of,notes)
       VALUES (?,?,?,?,?,'registered',?,0,'public',?,?) ON CONFLICT (event_id, donor_id) DO NOTHING`,
      ["att_" + uuid().slice(0, 10), e.id, e.org_id, gid, g.slice(0, 200), level.id, attId, `Guest of ${name}.`]).catch(() => {});
  }

  const deductible = (Number(level.price) - Number(level.fmv)) * (level.kind === "ticket" ? qty : 1);
  res.send(evPage({ title: `Thank you · ${e.name}`, brand, body: `
    <div class="card">
      <h1>Thank you, ${esc(name.split(" ")[0])}.</h1>
      <div class="ok">You are on the list for ${esc(e.name)}.</div>
      <p class="muted">${esc(evDayWords(e.date))}${e.location ? ` · ${esc(e.location)}` : ""}</p>
      <p>${esc(level.name)}${level.kind === "ticket" && qty > 1 ? ` · ${qty} places` : ""}${guests.length ? ` · ${guests.length} ${guests.length === 1 ? "guest" : "guests"} named` : ""}.</p>
      <p class="small">${esc(brand.displayName || "The organization")} will be in touch about paying. Nothing was charged here${Number(level.fmv) > 0 ? `, and when it is, ${esc(evMoney(deductible))} of it will be tax deductible` : ""}.</p>
    </div>` }));
}));
}

module.exports = { routers, mount };
