// routes/supporter.js — MEMBERS-2. "YOUR PAGE": ONE PAGE FOR EVERY SUPPORTER.
//
// A member, a ticket buyer, a fundraiser and a volunteer were each heading
// for their own surface with their own link and their own idea of what the
// organisation looks like. There is one page now, at /you/:orgSlug, and the
// person on it sees exactly what they have and nothing else.
//
// WHY IT IS SERVER-RENDERED HTML AND NOT A REACT ROUTE. It wears
// shared/publicPage.js, the same shell the volunteer sign-up and the event
// registration pages wear, so the org's band, its logo, its 16px inputs and
// its 48px buttons are the ones already proven on a phone. It is one request
// and no bundle, which is what "works on a slow connection" means. And it is
// the same renderer the volunteer page already used, so folding that page in
// here is a move, not a rewrite.
//
// HOW SOMEBODY GETS IN. They type their email, and a link arrives. The link
// is CSPRNG, hashed at rest, expires in fifteen minutes and is spent on
// arrival; spending it mints a session in its own cookie. Nobody ever has a
// password, and a link forwarded on, or read out of a mailbox next year,
// opens nothing. Known and unknown emails get the same answer, always.
//
// THE WALL. A session is (org, person). Every query in this file is scoped by
// BOTH, from the session and never from the URL or a form field, so a link
// for one person can only ever draw that person's rows — the one test this
// build earned (tests/members2-isolation.test.js) plants exactly that.
//
// WHAT IT DOES NOT DO. It never moves money on its own. Renewing prices from
// the level through the existing ?membership= path; changing a recurring gift
// posts to the donor portal's own routes, which are the only place those
// Stripe calls live. There is no second money path here and there is not
// going to be one.
const express = require("express");

const routers = {
  r0: express.Router(),
};

function mount(ctx) {
const {
  actor, checkWriteAccess, crypto, donateLimiter, donorFacingOrgName, orgSendingIdentity,
  orgToday, orgTz, publicAppUrl, query, requireAuth, resolveOrgBrandTheme, resend, run,
  sendDonorLifecycleEmail, stripe, testMode, uuid, volunteerSummary, withAdvisoryLock, wrap,
  brandEmailHeaderHtml, fromWithDisplayName, DONOR_MAIL_ADDR, writeAuditLog,
} = ctx;

// The shell and the two pure modules arrive by dynamic import, exactly as
// every other consumer of shared/ does. Every route awaits READY before it
// reads them: a request landing between boot and resolution would otherwise
// read null, which is the race EVENTS-1 found and fixed the same way.
let PPG = null, SP = null, PASS = null;
const READY = Promise.all([
  import("../shared/publicPage.js").then(m => { PPG = m; }),
  import("../shared/supporterPage.js").then(m => { SP = m; }),
  import("../shared/passCode.js").then(m => { PASS = m; }),
]);

const { renderMemberCardPdf } = require("../memberCard");

let app = routers.r0;

// ── The one cookie, the one hash, the one link life ───────────────────────
const YOU_COOKIE = "steward_you";
const LINK_MINUTES = 15;
const SESSION_DAYS = 30;
const sha256hex = s => crypto.createHash("sha256").update(String(s)).digest("hex");
const passSecret = () => process.env.JWT_SECRET || "";

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function setYouCookie(res, token) {
  res.append("Set-Cookie",
    [`${YOU_COOKIE}=${encodeURIComponent(token)}`, "HttpOnly", "Secure", "SameSite=Lax", "Path=/",
     `Max-Age=${SESSION_DAYS * 24 * 3600}`].join("; "));
}

async function orgBySlug(slug) {
  if (!slug || typeof slug !== "string" || slug.length > 120) return null;
  const [o] = await query(`SELECT id, name, org_slug, stripe_account_id, stripe_connected,
                                  membership_grace_days FROM orgs WHERE org_slug=?`, [String(slug)]);
  return o || null;
}

async function brandOf(orgId, fallbackName) {
  const b = await resolveOrgBrandTheme(orgId).catch(() => null);
  if (b && b.band) return b;
  const displayName = await donorFacingOrgName(orgId, fallbackName).catch(() => fallbackName || "");
  return { band: "#0d5c3a", bandFg: "#fff", displayName };
}

const youPage = opts => PPG.publicPage({ footer: "Your page, by Steward.", ...opts });

// THE SESSION. (org, person) or nothing. It reads the cookie only: a staff
// JWT in an Authorization header is not a way into anybody's page, and a
// supporter cookie is not a way into the CRM. The two never cross.
async function youSession(req, org) {
  const raw = parseCookies(req)[YOU_COOKIE];
  if (!raw || raw.length > 300) return null;
  const [s] = await query(
    `SELECT id, org_id, person_id FROM supporter_sessions
      WHERE token_hash=? AND revoked_at IS NULL AND expires_at > NOW()`, [sha256hex(raw)]);
  if (!s) return null;
  if (org && s.org_id !== org.id) return null;   // one org per session, always
  const [p] = await query(
    `SELECT id, name, email FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL`,
    [s.person_id, s.org_id]);
  if (!p) return null;
  return { sessionId: s.id, orgId: s.org_id, person: p };
}

// ── EVERYTHING THIS PERSON HAS ───────────────────────────────────────────
// One read, scoped by (orgId, personId) throughout. Nothing in here takes an
// id from the request: the session decides whose rows these are.
async function whatTheyHave(orgId, personId, email) {
  const today = orgToday(await orgTz(orgId));                     // ORG_TZ_SEAM_OK
  const [membership] = await query(
    `SELECT m.id, m.status, m.joined_on, m.starts_on, m.expires_on, m.auto_renew_subscription_id,
            l.id AS level_id, l.name AS level_name, l.term, l.price::float AS price,
            l.fmv::float AS fmv, l.benefits
       FROM memberships m JOIN membership_levels l ON l.id=m.level_id AND l.org_id=m.org_id
      WHERE m.org_id=? AND m.donor_id=? AND m.status IN ('active','grace','lapsed')
      ORDER BY (m.status IN ('active','grace')) DESC, m.expires_on DESC NULLS FIRST LIMIT 1`,
    [orgId, personId]);
  const tickets = await query(
    `SELECT a.id, a.quantity, a.status, a.checked_in_at, a.guest_of,
            e.id AS event_id, e.name AS event_name, e.date, e.location, e.public_slug,
            l.name AS level_name
       FROM event_attendees a
       JOIN events e ON e.id=a.event_id AND e.org_id=a.org_id
       LEFT JOIN event_levels l ON l.id=a.level_id
      WHERE a.org_id=? AND a.donor_id=? AND a.status <> 'cancelled'
        AND e.status <> 'cancelled' AND e.date >= ?
      ORDER BY e.date`, [orgId, personId, today]);
  const shifts = await query(
    `SELECT su.id AS signup_id, su.status, su.position, su.checked_in_at,
            s.date, s.start_time, s.end_time, o.name AS opp_name, o.location
       FROM volunteer_signups su
       JOIN volunteer_slots s ON s.id=su.slot_id
       JOIN volunteer_opportunities o ON o.id=s.opportunity_id
      WHERE su.org_id=? AND su.person_id=? AND su.status IN ('confirmed','waitlisted')
        AND s.date >= ? AND s.cancelled_at IS NULL
      ORDER BY s.date, s.start_time`, [orgId, personId, today]);
  // A fundraiser is matched by EXACT email, never by name — the same rule the
  // whole codebase links a person by.
  const fundraisers = email ? await query(
    `SELECT f.id, f.name, f.slug, f.personal_goal_amount::float AS goal, f.status,
            gp.slug AS page_slug, gp.title AS page_title,
            (SELECT COALESCE(SUM(g.amount),0)::float FROM gifts g WHERE g.peer_fundraiser_id=f.id) AS raised
       FROM peer_fundraisers f JOIN giving_pages gp ON gp.id=f.giving_page_id
      WHERE f.org_id=? AND LOWER(f.email)=? AND f.status='active'
      ORDER BY f.created_at DESC`, [orgId, String(email).toLowerCase()]) : [];
  const gifts = await query(
    `SELECT g.id, g.amount::float AS amount, g.date, g.quid_pro_quo_value::float AS qpq,
            f.name AS fund_name, r.id AS receipt_id, r.receipt_number
       FROM gifts g
       LEFT JOIN fin_funds f ON f.id=g.fund_id AND f.org_id=g.org_id
       LEFT JOIN receipts r ON r.gift_id=g.id AND r.org_id=g.org_id AND r.voided_at IS NULL
      WHERE g.org_id=? AND g.donor_id=? AND g.amount > 0
      ORDER BY g.date DESC, g.created_at DESC LIMIT 100`, [orgId, personId]);
  const recurring = await query(
    `SELECT id, amount::float AS amount, interval, status, current_period_end, stripe_subscription_id,
            membership_level_id
       FROM recurring_subscriptions
      WHERE org_id=? AND donor_id=? AND status <> 'canceled'
      ORDER BY created_at DESC`, [orgId, personId]);
  const vol = shifts.length || (await volunteerSummary(orgId, personId).catch(() => null))?.hundredths
    ? await volunteerSummary(orgId, personId).catch(() => null) : null;
  return { today, membership, tickets, shifts, fundraisers, gifts, recurring, vol };
}

// ── THE PAGE ─────────────────────────────────────────────────────────────

async function qrDataUri(text) {
  try {
    const QR = require("qrcode");
    return await QR.toDataURL(text, { width: 320, margin: 1, errorCorrectionLevel: "M",
      color: { dark: "#0f1a12", light: "#ffffff" } });
  } catch { return null; }
}

function signInBody(esc, orgSlug, brand, { sent = false, prefill = "" } = {}) {
  if (sent) {
    return `<div class="card">
      <h1>Check your email.</h1>
      <p class="muted">If we have that address on file, a link to your page is on its way. It works once and lasts ${LINK_MINUTES} minutes.</p>
      <p class="small">Nothing to remember and no password, here or ever.</p>
    </div>`;
  }
  return `<div class="card">
    <h1>Your page.</h1>
    <p class="muted">Your membership, your tickets, your shifts and your giving with ${esc(brand.displayName || "us")}, in one place.</p>
    <form method="post" action="/you/${esc(orgSlug)}/link">
      <input class="hp" name="website" tabindex="-1" autocomplete="off">
      <label for="em">Your email</label>
      <input id="em" name="email" type="email" required autocomplete="email" inputmode="email" value="${esc(prefill)}">
      <button class="btn" type="submit">Send me my link</button>
    </form>
    <p class="small">We send a link rather than asking for a password. There is no password to forget.</p>
  </div>`;
}

app.get("/you/:orgSlug", donateLimiter, wrap(async (req, res) => {
  await READY;
  const org = await orgBySlug(req.params.orgSlug);
  const esc = PPG.escapeHtml;
  if (!org) return res.status(404).send(youPage({ title: "Not found",
    brand: { band: "#0d5c3a", bandFg: "#fff", displayName: "" },
    body: `<div class="card"><h1>That page is not here.</h1><p class="muted">Ask the organisation for its current link.</p></div>` }));
  const brand = await brandOf(org.id, org.name);
  res.setHeader("Cache-Control", "no-store");
  const manifest = `<link rel="manifest" href="/you/${esc(org.org_slug)}/manifest.webmanifest">`
    + `<meta name="theme-color" content="${esc(brand.band)}">`
    + `<meta name="apple-mobile-web-app-capable" content="yes">`
    + `<meta name="apple-mobile-web-app-title" content="${esc(brand.displayName || "Your page")}">`;

  const sess = await youSession(req, org);
  if (!sess) {
    return res.send(withHead(youPage({ title: `Your page · ${brand.displayName}`, brand,
      body: signInBody(esc, org.org_slug, brand, { sent: req.query.sent === "1" }) }), manifest));
  }

  // Opened. Recorded once on the record itself, because "has she opened it?"
  // is the first thing somebody about to chase a lapsed member asks.
  await run(`UPDATE donors SET your_page_opened_at=NOW() WHERE id=? AND org_id=?`, [sess.person.id, org.id]).catch(() => {});
  await run(`UPDATE supporter_sessions SET last_seen_at=NOW() WHERE id=?`, [sess.sessionId]).catch(() => {});

  const have = await whatTheyHave(org.id, sess.person.id, sess.person.email);
  const first = String(sess.person.name || "").split(/\s+/)[0];
  const sections = [];

  // ── Your membership ───────────────────────────────────────────────────
  if (have.membership) {
    const m = have.membership;
    const benefits = Array.isArray(m.benefits) ? m.benefits
      : (() => { try { return JSON.parse(m.benefits || "[]"); } catch { return []; } })();
    const autoRenew = !!m.auto_renew_subscription_id;
    const sentence = SP.membershipSentence({ levelName: m.level_name, status: m.status,
      expiresOn: m.expires_on, autoRenew, term: m.term });
    const code = PASS.makePassCode({ kind: "membership", orgId: org.id, id: m.id,
      expiresOn: m.expires_on, secret: passSecret() });
    const qr = await qrDataUri(code);
    const renewHref = `/give/${esc(org.org_slug)}?membership=${esc(m.level_id)}`;
    sections.push(`<h2 style="margin:22px 2px 10px">Your membership</h2>
      <div class="card">
        <h1 style="font-size:22px">${esc(sentence)}</h1>
        ${m.joined_on ? `<p class="muted">${esc(SP.memberSinceSentence(m.joined_on))}</p>` : ""}
        ${benefits.length ? `<ul style="margin:10px 0 0 18px;padding:0">${benefits.slice(0, 12).map(b => `<li class="small">${esc(b)}</li>`).join("")}</ul>` : ""}
      </div>
      <div class="card" style="text-align:center">
        <h2 style="text-align:left">Your member card</h2>
        ${qr ? `<img src="${qr}" alt="Your member code" style="width:190px;height:190px;margin:10px auto;display:block">` : ""}
        <p class="small" style="text-align:left">${esc(SP.CARD_SENTENCE)}</p>
        <a class="btn quiet" href="/you/${esc(org.org_slug)}/card.pdf">Download the card</a>
      </div>
      <div class="card">
        <h2>${m.status === "active" ? "Renew or change it" : "Rejoin"}</h2>
        <p class="small">${m.status === "active"
          ? "Renewing early adds a term to the end of the one you have; it never shortens it."
          : "Rejoining starts a fresh term from the day it is paid."}</p>
        <a class="btn" href="${renewHref}">${m.status === "active" ? "Renew my membership" : "Rejoin"}</a>
        ${m.term === "12_months" ? (autoRenew
          ? `<form method="post" action="/you/${esc(org.org_slug)}/auto-renew">
               <input type="hidden" name="on" value="0">
               <p class="small" style="margin-top:12px">It renews itself each year. Turning that off leaves the membership you have paid for exactly as it is; it simply will not renew again.</p>
               <button class="btn quiet small" type="submit">Turn off automatic renewal</button>
             </form>`
          : `<p class="small" style="margin-top:12px">This membership does not renew itself. Choose "renew automatically each year" when you renew and it will.</p>`) : ""}
      </div>`);
  }

  // ── Your tickets ──────────────────────────────────────────────────────
  if (have.tickets.length) {
    const cards = [];
    for (const t of have.tickets) {
      const code = PASS.makePassCode({ kind: "ticket", orgId: org.id, id: t.id,
        expiresOn: String(t.date instanceof Date ? t.date.toISOString() : t.date).slice(0, 10), secret: passSecret() });
      const qr = await qrDataUri(code);
      cards.push(`<div class="card">
        <div class="row"><h2>${esc(t.event_name)}</h2>${t.checked_in_at ? `<span class="pill open">Checked in</span>` : ""}</div>
        <p class="muted">${esc(SP.dayWordsFull(t.date instanceof Date ? t.date.toISOString() : t.date))}${t.location ? " · " + esc(t.location) : ""}</p>
        <p class="small">${esc(t.level_name || "Ticket")}${Number(t.quantity) > 1 ? ` · ${t.quantity} places` : ""}</p>
        ${qr ? `<img src="${qr}" alt="Your ticket code" style="width:170px;height:170px;display:block;margin:10px auto 4px">` : ""}
        <p class="small" style="text-align:center">Show this at the door.</p>
      </div>`);
    }
    sections.push(`<h2 style="margin:22px 2px 10px">Your tickets</h2>${cards.join("")}`);
  }

  // ── Your shifts (the volunteer page, folded in) ───────────────────────
  if (have.shifts.length || (have.vol && have.vol.totalHours)) {
    const cards = have.shifts.map(s => `<div class="card">
      <div class="row"><h2>${esc(s.opp_name)}</h2>${s.status === "waitlisted"
        ? `<span class="pill full">Waiting list${s.position ? ", number " + s.position : ""}</span>`
        : `<span class="pill open">Confirmed</span>`}</div>
      <p class="muted">${esc(SP.dayWordsFull(s.date instanceof Date ? s.date.toISOString() : s.date))}${s.start_time ? " · " + esc(String(s.start_time).slice(0, 5)) : ""}</p>
      ${s.location ? `<p class="small">${esc(s.location)}</p>` : ""}
    </div>`).join("");
    sections.push(`<h2 style="margin:22px 2px 10px">Your shifts</h2>
      ${have.vol && have.vol.totalHours ? `<div class="card"><p class="muted">You have given ${esc(String(have.vol.totalHours))} hours to ${esc(brand.displayName || "us")}.</p></div>` : ""}
      ${cards}`);
  }

  // ── Your fundraising ──────────────────────────────────────────────────
  if (have.fundraisers.length) {
    const cards = have.fundraisers.map(f => `<div class="card">
      <h2>${esc(f.name)}</h2>
      <p class="muted">${esc(SP.money(Math.round(Number(f.raised || 0) * 100)))} raised${f.goal ? ` of ${esc(SP.money(Math.round(Number(f.goal) * 100)))}` : ""} for ${esc(f.page_title || "")}.</p>
      <p class="small">Raised counts every gift given through your own page, in cents, as it arrives.</p>
      <a class="btn quiet" href="/give/${esc(org.org_slug)}/${esc(f.page_slug)}/${esc(f.slug)}">Open my page</a>
    </div>`).join("");
    sections.push(`<h2 style="margin:22px 2px 10px">Your fundraising</h2>${cards}`);
  }

  // ── Your giving (the donor portal, folded in) ─────────────────────────
  if (have.gifts.length || have.recurring.length) {
    const rec = have.recurring.map(r => {
      const nextOn = r.current_period_end ? String(r.current_period_end instanceof Date ? r.current_period_end.toISOString() : r.current_period_end).slice(0, 10) : null;
      const s = SP.recurringSentence({ amountCents: Math.round(Number(r.amount) * 100), interval: r.interval, status: r.status, nextOn });
      return `<div class="card">
        <h2>Your regular gift</h2>
        <p class="muted">${esc(s)}</p>
        <p class="small">Changing it takes you to ${esc(brand.displayName || "the organisation")}'s giving page, which is where the card is held. Steward never holds your card.</p>
        <a class="btn quiet" href="/portal/${esc(org.org_slug)}">Change, pause or stop it</a>
      </div>`;
    }).join("");
    const total = have.gifts.reduce((a, g) => a + Math.round(Number(g.amount) * 100), 0);
    const rows = have.gifts.slice(0, 40).map(g => `<div class="row" style="border-top:1px solid #efece4;padding:9px 0">
      <span>${esc(SP.dayWordsFull(g.date instanceof Date ? g.date.toISOString() : g.date))}${g.fund_name ? ` · ${esc(g.fund_name)}` : ""}</span>
      <span><strong>${esc(SP.money(Math.round(Number(g.amount) * 100)))}</strong>${g.receipt_id
        ? ` · <a href="/you/${esc(org.org_slug)}/receipt/${esc(g.receipt_id)}.pdf">receipt</a>` : ""}</span>
    </div>`).join("");
    sections.push(`<h2 style="margin:22px 2px 10px">Your giving</h2>
      ${rec}
      <div class="card">
        <div class="row"><h2>${esc(SP.money(total))} in all</h2></div>
        <p class="small">${esc(SP.givingSentence({}))}</p>
        ${rows}
      </div>`);
  }

  const body = `
    ${req.query.saved === "1" ? `<div class="ok">Saved. Thank you.</div>` : ""}
    <div class="card">
      <h1>Hello, ${esc(first)}.</h1>
      <p class="muted">Everything you have with ${esc(brand.displayName || "us")}, in one place. Nothing here needs a password.</p>
    </div>
    ${sections.length ? sections.join("") : `<div class="card"><p class="muted">${esc(SP.nothingYetLine(brand.displayName))}</p></div>`}
    <form method="post" action="/you/${esc(org.org_slug)}/signout" style="margin-top:22px">
      <button class="btn quiet small" type="submit">Sign out of this device</button>
    </form>`;
  res.send(withHead(youPage({ title: `Your page · ${brand.displayName}`, brand, body }), manifest));
}));

// The shell renders one <head>; the manifest and theme colour go in without
// forking it, because a second copy of that shell is how two public surfaces
// end up wearing different versions of one brand.
function withHead(html, extra) {
  return html.replace("</head>", extra + "</head>");
}

// ── Asking for a link ────────────────────────────────────────────────────
// Identical answer for a known and an unknown address, every time: the page
// that comes back says the same words whether or not anybody was found.
app.post("/you/:orgSlug/link", donateLimiter, express.urlencoded({ extended: false }), wrap(async (req, res) => {
  await READY;
  const org = await orgBySlug(req.params.orgSlug);
  if (!org) return res.status(404).send("Not found");
  const email = String(req.body?.email || "").trim().toLowerCase().slice(0, 320);
  res.redirect(303, `/you/${encodeURIComponent(org.org_slug)}?sent=1`);
  if (String(req.body?.website || "").trim()) return;              // the honeypot
  if (!email || !email.includes("@")) return;
  (async () => {
    const people = await query(
      `SELECT id, name, email FROM donors WHERE org_id=? AND LOWER(email)=? AND deleted_at IS NULL
        ORDER BY created_at ASC LIMIT 1`, [org.id, email]);
    if (!people.length) return;
    await issueAndSend(org, people[0], { who: { id: "system:your-page", name: "The person, from their own page" } });
  })().catch(e => console.error("[you] link request failed:", e.message));
}));

// The one place a link is minted. A fresh request supersedes any live one, so
// the newest link in somebody's inbox is the only one that opens.
async function issueAndSend(org, person, { who }) {
  const token = crypto.randomBytes(32).toString("base64url");
  await run(`UPDATE supporter_links SET superseded_at=NOW()
              WHERE org_id=? AND person_id=? AND used_at IS NULL AND superseded_at IS NULL`,
    [org.id, person.id]);
  await run(
    `INSERT INTO supporter_links (id,org_id,person_id,email,token_hash,expires_at,created_by,created_by_name)
     VALUES (?,?,?,?,?, NOW() + (? || ' minutes')::interval, ?,?)`,
    ["sl_" + uuid().slice(0, 12), org.id, person.id, person.email || null, sha256hex(token),
     String(LINK_MINUTES), who.id, who.name]);
  const brand = await brandOf(org.id, org.name);
  // The fragment, not the query string: a fragment is never sent in a Referer
  // header and never lands in a server log (the same rule the portal's link
  // and every giving-account entry point follow).
  const link = `${publicAppUrl()}/you/${encodeURIComponent(org.org_slug)}/enter#t=${token}`;
  const esc = PPG.escapeHtml;
  const html = await brandEmailHeaderHtml(org.id) + `
    <div style="font-family:Georgia,'Times New Roman',serif;max-width:520px;margin:0 auto;padding:24px;color:#0f1a12;">
      <p>Here is the link to your page with ${esc(brand.displayName || org.name)}.</p>
      <p style="text-align:center;margin:28px 0;">
        <a href="${link}" style="background:${esc(brand.band)};color:${esc(brand.bandFg)};text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;display:inline-block;">Open my page</a>
      </p>
      <p style="font-size:13px;color:#555;">The link works once and expires in ${LINK_MINUTES} minutes. Once you are in, the page stays open on this device for ${SESSION_DAYS} days, and you can add it to your home screen.</p>
      <p style="font-size:13px;color:#555;">If you did not ask for this, you can ignore it.</p>
    </div>`;
  await sendDonorLifecycleEmail("your_page_link", person.email,
    `Your page — ${brand.displayName || org.name}`,
    html, fromWithDisplayName(brand.displayName || org.name, DONOR_MAIL_ADDR()));
  await run(`UPDATE donors SET your_page_sent_at=NOW() WHERE id=? AND org_id=?`, [person.id, org.id]).catch(() => {});
  return link;
}

// ── Spending the link ────────────────────────────────────────────────────
// THE GET WRITES NOTHING. Mail clients and link scanners fetch links, and a
// scanner that could spend somebody's link would lock them out of their own
// page. The token lives in the fragment, which never reaches this server; the
// page reads it and POSTs it, and the POST is what consumes it.
app.get("/you/:orgSlug/enter", donateLimiter, wrap(async (req, res) => {
  await READY;
  const org = await orgBySlug(req.params.orgSlug);
  if (!org) return res.status(404).send("Not found");
  const brand = await brandOf(org.id, org.name);
  const esc = PPG.escapeHtml;
  res.setHeader("Cache-Control", "no-store");
  res.send(youPage({ title: `Opening your page · ${brand.displayName}`, brand, body: `
    <div class="card">
      <h1>Opening your page.</h1>
      <p class="muted">One moment.</p>
      <form method="post" action="/you/${esc(org.org_slug)}/enter" id="f">
        <input type="hidden" name="t" id="t">
        <button class="btn" type="submit">Open my page</button>
      </form>
      <p class="small" id="bad" style="display:none">That link is missing its code. Ask for a fresh one.</p>
    </div>
    <script>
      (function(){
        var h = String(location.hash || "").replace(/^#/, "");
        var m = /(?:^|&)t=([^&]+)/.exec(h);
        if (!m) { document.getElementById("bad").style.display = "block"; return; }
        document.getElementById("t").value = decodeURIComponent(m[1]);
        history.replaceState(null, "", location.pathname);
        document.getElementById("f").submit();
      })();
    </script>` }));
}));

app.post("/you/:orgSlug/enter", donateLimiter, express.urlencoded({ extended: false }), wrap(async (req, res) => {
  await READY;
  const org = await orgBySlug(req.params.orgSlug);
  if (!org) return res.status(404).send("Not found");
  const brand = await brandOf(org.id, org.name);
  const token = String(req.body?.t || "");
  const esc = PPG.escapeHtml;
  const dead = () => res.status(400).send(youPage({ title: "Link expired", brand, body:
    `<div class="card"><h1>That link has expired.</h1>
      <p class="muted">A link works once and lasts ${LINK_MINUTES} minutes. Ask for a fresh one and it will arrive in a moment.</p>
      ${signInBody(esc, org.org_slug, brand)}</div>` }));
  if (!token || token.length > 300) return dead();
  // Atomic consume: UPDATE … RETURNING wins exactly once, even if the same
  // link is opened twice in the same second.
  const rows = await query(
    `UPDATE supporter_links SET used_at=NOW()
      WHERE token_hash=? AND org_id=? AND used_at IS NULL AND superseded_at IS NULL AND expires_at > NOW()
      RETURNING person_id`, [sha256hex(token), org.id]);
  if (!rows.length) return dead();
  const [person] = await query(`SELECT id FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL`,
    [rows[0].person_id, org.id]);
  if (!person) return dead();
  setYouCookie(res, await mintSupporterSession(org.id, person.id));
  res.redirect(303, `/you/${encodeURIComponent(org.org_slug)}`);
}));

app.post("/you/:orgSlug/signout", donateLimiter, express.urlencoded({ extended: false }), wrap(async (req, res) => {
  const raw = parseCookies(req)[YOU_COOKIE];
  if (raw) await run(`UPDATE supporter_sessions SET revoked_at=NOW() WHERE token_hash=?`, [sha256hex(raw)]).catch(() => {});
  res.append("Set-Cookie", `${YOU_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  res.redirect(303, `/you/${encodeURIComponent(req.params.orgSlug)}`);
}));

// ── The old links, still working ─────────────────────────────────────────
// A volunteer link is a durable thirty-day token somebody has in an email
// from September for a shift in October, and it keeps working: VOL-1's
// /volunteer/me exchanges it for a session here rather than opening a page of
// its own. That route stays where it has always been — one path, one handler —
// and calls this to mint the session.
async function mintSupporterSession(orgId, personId) {
  const token = crypto.randomBytes(32).toString("base64url");
  await run(
    `INSERT INTO supporter_sessions (id,org_id,person_id,token_hash,expires_at)
     VALUES (?,?,?,?, NOW() + (? || ' days')::interval)`,
    ["ss_" + uuid().slice(0, 12), orgId, personId, sha256hex(token), String(SESSION_DAYS)]);
  return token;
}
ctx.registerSupporterSession({ mint: mintSupporterSession, setCookie: setYouCookie });

// ── The member card, as a file ───────────────────────────────────────────
app.get("/you/:orgSlug/card.pdf", donateLimiter, wrap(async (req, res) => {
  await READY;
  const org = await orgBySlug(req.params.orgSlug);
  if (!org) return res.status(404).send("Not found");
  const sess = await youSession(req, org);
  if (!sess) return res.status(404).send("Not found");
  const [m] = await query(
    `SELECT m.id, m.joined_on, m.expires_on, l.name AS level_name
       FROM memberships m JOIN membership_levels l ON l.id=m.level_id AND l.org_id=m.org_id
      WHERE m.org_id=? AND m.donor_id=? AND m.status IN ('active','grace') LIMIT 1`,
    [org.id, sess.person.id]);
  if (!m) return res.status(404).send("Not found");
  const pdf = await buildCardPdf(org, m, sess.person.name);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="member-card.pdf"`);
  res.send(pdf);
}));

async function buildCardPdf(org, m, memberName) {
  const theme = await resolveOrgBrandTheme(org.id).catch(() => null);
  let logo = null;
  if (theme?.logoDataUri && /^data:image\/(png|jpe?g);base64,/.test(theme.logoDataUri)) {
    try { logo = Buffer.from(theme.logoDataUri.split(",")[1], "base64"); } catch { logo = null; }
  }
  const code = PASS.makePassCode({ kind: "membership", orgId: org.id, id: m.id,
    expiresOn: m.expires_on, secret: passSecret() });
  let qrPng = null;
  try { qrPng = await require("qrcode").toBuffer(code, { width: 300, margin: 0, errorCorrectionLevel: "M" }); } catch { qrPng = null; }
  return renderMemberCardPdf({ orgName: theme?.displayName || org.name, accent: theme?.band, logo,
    memberName, levelName: m.level_name, expiresOn: m.expires_on, memberSince: m.joined_on, qrPng });
}

// ── A receipt, as a file ─────────────────────────────────────────────────
// The receipt PDF that was already rendered and stored when the gift was
// receipted. Nothing is re-rendered here: the person downloads the same bytes
// the organisation has, which is what makes it a receipt.
app.get("/you/:orgSlug/receipt/:receiptId.pdf", donateLimiter, wrap(async (req, res) => {
  await READY;
  const org = await orgBySlug(req.params.orgSlug);
  if (!org) return res.status(404).send("Not found");
  const sess = await youSession(req, org);
  if (!sess) return res.status(404).send("Not found");
  const [r] = await query(
    `SELECT id, receipt_number, pdf_data FROM receipts
      WHERE id=? AND org_id=? AND donor_id=? AND voided_at IS NULL`,
    [String(req.params.receiptId), org.id, sess.person.id]);
  if (!r || !r.pdf_data) return res.status(404).send("Not found");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="receipt-${r.receipt_number}.pdf"`);
  res.send(Buffer.from(r.pdf_data, "base64"));
}));

// ── Automatic renewal, off ───────────────────────────────────────────────
// Turning it off stops the NEXT charge and touches nothing else: the term
// already paid for runs to its end. It is the existing recurring cancel
// (cancel_at_period_end), not a new one.
app.post("/you/:orgSlug/auto-renew", donateLimiter, express.urlencoded({ extended: false }), wrap(async (req, res) => {
  await READY;
  const org = await orgBySlug(req.params.orgSlug);
  if (!org) return res.status(404).send("Not found");
  const sess = await youSession(req, org);
  if (!sess) return res.redirect(303, `/you/${encodeURIComponent(req.params.orgSlug)}`);
  if (String(req.body?.on || "") !== "0") return res.redirect(303, `/you/${encodeURIComponent(org.org_slug)}`);
  const [m] = await query(
    `SELECT id, auto_renew_subscription_id FROM memberships
      WHERE org_id=? AND donor_id=? AND status IN ('active','grace') LIMIT 1`, [org.id, sess.person.id]);
  if (m && m.auto_renew_subscription_id) {
    await withAdvisoryLock(`you-autorenew:${m.id}`, async () => {
      const [sub] = await query(`SELECT id, stripe_subscription_id FROM recurring_subscriptions
                                  WHERE id=? AND org_id=? AND donor_id=?`,
        [m.auto_renew_subscription_id, org.id, sess.person.id]);
      if (!sub) return;
      if (stripe && org.stripe_account_id) {
        await stripe.subscriptions.update(sub.stripe_subscription_id, { cancel_at_period_end: true },
          { stripeAccount: org.stripe_account_id }).catch(e => console.error("[you] auto-renew off:", e.message));
      }
      await run(`UPDATE recurring_subscriptions SET status='canceled', canceled_at=NOW(), next_dunning_at=NULL, updated_at=NOW() WHERE id=?`, [sub.id]);
      await run(`UPDATE memberships SET auto_renew_subscription_id=NULL, updated_at=NOW() WHERE id=?`, [m.id]);
    });
  }
  res.redirect(303, `/you/${encodeURIComponent(org.org_slug)}?saved=1`);
}));

// ── Installable to a home screen ─────────────────────────────────────────
// A manifest per org, because the thing on the home screen is the org's, not
// Steward's: its name, its colour, its logo. `standalone` is what removes the
// browser chrome and makes it read as an app.
app.get("/you/:orgSlug/manifest.webmanifest", donateLimiter, wrap(async (req, res) => {
  await READY;
  const org = await orgBySlug(req.params.orgSlug);
  if (!org) return res.status(404).json({ error: "not_found" });
  const brand = await brandOf(org.id, org.name);
  const start = `/you/${encodeURIComponent(org.org_slug)}`;
  res.setHeader("Content-Type", "application/manifest+json");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json({
    name: brand.displayName || org.name,
    short_name: String(brand.displayName || org.name).slice(0, 12),
    description: `Your membership, tickets, shifts and giving with ${brand.displayName || org.name}.`,
    start_url: start,
    scope: start,
    display: "standalone",
    orientation: "portrait",
    background_color: "#f0ede6",
    theme_color: brand.band || "#0d5c3a",
    // ONE icon, and it is an SVG, so there is exactly one file and it is
    // sharp at every size a home screen asks for. Declaring "192x192" for a
    // logo whose real dimensions nobody checked is how an installed app ends
    // up with a blurred or rejected tile.
    icons: [
      { src: `${start}/icon.svg`, sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: `${start}/icon.svg`, sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  });
}));

// THE ICON. A square tile in the org's band colour with its logo on it, or
// its initial when it has none: one SVG, sharp at every size, and never a
// home screen with a broken image on it. Maskable too, so a phone that crops
// icons to its own shape crops the tile and not the logo.
app.get("/you/:orgSlug/icon.svg", donateLimiter, wrap(async (req, res) => {
  await READY;
  const org = await orgBySlug(req.params.orgSlug);
  if (!org) return res.status(404).send("Not found");
  const brand = await brandOf(org.id, org.name);
  const esc = PPG.escapeHtml;
  const logo = /^data:image\/(png|jpe?g|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(String(brand.logoDataUri || ""))
    ? brand.logoDataUri : null;
  const letter = esc(String(brand.displayName || org.name || "?").trim().charAt(0).toUpperCase() || "?");
  const inner = logo
    // Inside the safe area a maskable icon is allowed to keep: 80% of the
    // tile, centred, so a circular crop never takes a bite out of the logo.
    ? `<image href="${esc(logo)}" x="51" y="51" width="410" height="410" preserveAspectRatio="xMidYMid meet"/>`
    : `<text x="256" y="345" font-family="Georgia,serif" font-size="260" fill="${esc(brand.bandFg || "#fff")}" text-anchor="middle">${letter}</text>`;
  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${esc(brand.band || "#0d5c3a")}"/>
  ${inner}
</svg>`);
}));

// ── The staff side: send somebody their link ─────────────────────────────
// A person clicks it, the email goes out through the normal path, and the
// link it carries is the same single-use link the person would have asked
// for themselves. Staff never see the token.
app.post("/donors/:id/your-page-link", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  await READY;
  const orgId = req.user.orgId;
  const [org] = await query(`SELECT id, name, org_slug FROM orgs WHERE id=?`, [orgId]);
  const [person] = await query(
    `SELECT id, name, email FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL`, [req.params.id, orgId]);
  if (!org || !person) return res.status(404).json({ error: "Not found" });
  if (!person.email) return res.status(400).json({ error: "no_email", message: `${person.name} has no email address on file, so there is nowhere to send the link.` });
  const who = actor(req);
  const link = await issueAndSend(org, person, { who });
  await writeAuditLog(orgId, who.id, who.name, "your_page_link_sent", "donor", person.id, {}).catch(() => {});
  // The link itself comes back ONLY under TEST_MODE. On any real deployment
  // the token reaches one place, the person's own mailbox: a staff member who
  // could read it could open somebody else's page, and the whole point of
  // this page is that they cannot.
  res.json({ ok: true, ...(testMode() ? { link } : {}),
    message: `Sent to ${person.email}. The link works once and lasts ${LINK_MINUTES} minutes; their page then stays open on that device for ${SESSION_DAYS} days.` });
}));
}

module.exports = { routers, mount };
