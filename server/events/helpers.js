// server/events/helpers.js — what more than one events file reads.
//
// SPLIT-1: moved VERBATIM from routes/crm.js. Nothing in it changed.
//
// routes/crm.js mounts it before the route modules, and what its mount()
// returns is on ctx for every module mounted after it.
// mount() runs once at the end of boot with server.js's ctx and what the helper
// modules hand back. A relative require() or import() reads from this folder.
// Tests read it through readSource("server.js") (scripts/lib/readSource.js).
const TL = require("../../timelineLine");

function mount(ctx) {
const {
  EV_READY, orgTime, orgToday, orgTz, publicAppUrl, query, resolveOrgBrandTheme,
} = ctx;

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

// WIRE-1 · A REGISTRATION WITH NO GIFT. A paid ticket already shows as its
// gift; a free RSVP wrote nothing. One "Registered for X." line per attendee
// row, keyed so a retried submit writes it once.
async function logEventRegistered(orgId, attendee, event, who) {
  if (!attendee || !attendee.donor_id || !event) return;
  await TL.timelineLine({ orgId, donorId: attendee.donor_id, type: "event",
    note: `Registered for ${event.name}.`, actorId: who.id, actorName: who.name,
    key: `event_registered:${attendee.id}`,
    metadata: { via: "event_registration", event_id: event.id, attendee_id: attendee.id } });
}
const evPage = opts => PPG.publicPage({ footer: "Registration by Steward.", ...opts });
const EV_PUBLIC_READY = Promise.all([EV_READY, PPG_READY, EPG_READY]);
const evDayWords = iso => {
  // `events.date` is a DATE column and pg hands it back as a Date OBJECT, so
  // String(it) is "Sat Dec 05 2026 00:00:00 GMT-0500 (Eastern Standard Time)"
  // and slicing ten characters off that gives "Sat Dec 0". The public page
  // printed exactly that. Normalise to the civil day first.
  const day = iso instanceof Date ? orgTime.civilOf(iso).slice(0, 10) : String(iso || "").slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!m) return String(iso || "");
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
    .toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
};
const evMoney = n => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });

// EVENTS-2 — the page takes a card now. Everything it charges is priced by
// the server from the level (`POST /e/:slug/checkout`, which is the donation
// checkout), the seat is HELD for fifteen minutes while somebody pays, and
// the registration is confirmed only by the payment webhook. A sold-out
// ticket type takes a name for the waiting list instead.
const evSeatsSql = `SELECT
    (SELECT COALESCE(SUM(quantity),0)::int FROM event_attendees WHERE level_id=$1 AND status <> 'cancelled')
  + (SELECT COALESCE(SUM(qty),0)::int FROM event_seat_holds
       WHERE level_id=$1 AND released_at IS NULL AND confirmed_at IS NULL AND expires_at > NOW()) AS used`;
async function evSeatsLeft(level) {
  if (level.capacity == null) return null;                 // no cap, no count
  const [r] = await query(evSeatsSql, [level.id]);
  return Math.max(0, Number(level.capacity) - Number(r?.used || 0));
}

async function eventPageHtml(e, q = {}, { editable = false } = {}) {
  const brand = await resolveOrgBrandTheme(e.org_id).catch(() => null) || { band: "#0d5c3a", bandFg: "#fff", displayName: "" };
  const [org] = await query("SELECT name, org_slug, stripe_connected, stripe_account_id FROM orgs WHERE id=?", [e.org_id]);
  const canTakeACard = !!(org && org.stripe_connected && org.stripe_account_id);
  const levels = await query(
    `SELECT id, kind, name, price::float AS price, member_price::float AS member_price, fmv::float AS fmv, capacity, recognition, benefits, picture
       FROM event_levels WHERE org_id=? AND event_id=? AND retired_at IS NULL ORDER BY kind DESC, position, price`, [e.org_id, e.id]);
  const esc = PPG.escapeHtml;

  const seats = new Map();
  for (const l of levels) seats.set(l.id, await evSeatsLeft(l));
  const slugPath = e.public_slug ? `/e/${esc(e.public_slug)}` : "#";
  const tickets = levels.filter(l => l.kind === "ticket");
  const sponsors = levels.filter(l => l.kind === "sponsor");

  const levelCard = l => {
    const left = seats.get(l.id);
    const soldOut = left === 0;
    const deductible = Number(l.price) - Number(l.fmv);
    const memberDeductible = l.member_price != null ? Number(l.member_price) - Number(l.fmv) : null;
    const benefits = Array.isArray(l.benefits) ? l.benefits : [];
    const priceLine = l.member_price != null
      ? `<p class="small">Members pay ${esc(evMoney(l.member_price))}. Enter the email your membership is under and the price changes when you check out; it is checked against the membership, never taken on trust.</p>`
      : "";
    const form = soldOut ? `
      <form method="post" action="${slugPath}/waitlist">
        <input type="hidden" name="levelId" value="${esc(l.id)}">
        <input class="hp" name="website" tabindex="-1" autocomplete="off">
        <p class="small">Leave your name and ${esc(brand.displayName || "the organization")} will be in touch if a place comes free. Nothing is charged and you are under no obligation.</p>
        <label>Your name<input name="name" required autocomplete="name"></label>
        <label>Email<input name="email" type="email" required autocomplete="email"></label>
        <button class="btn quiet" type="submit">Put me on the waiting list</button>
      </form>` : `
      <form method="post" action="${slugPath}/${canTakeACard ? "checkout" : "register"}">
        <input type="hidden" name="levelId" value="${esc(l.id)}">
        <input class="hp" name="website" tabindex="-1" autocomplete="off">
        <label>Your name<input name="name" required autocomplete="name"></label>
        <label>Email<input name="email" type="email" required autocomplete="email"></label>
        ${l.kind === "ticket"
          ? `<label>How many<select name="quantity">${[1,2,3,4,5,6,8,10].filter(n => left == null || n <= left).map(n => `<option value="${n}">${n}</option>`).join("")}</select></label>
             <label>Who is coming, one name per line<textarea name="guests" placeholder="So we can put a name at every seat"></textarea></label>
             <label>Anything we should know about food<input name="dietary" placeholder="Vegetarian, an allergy, anything"></label>`
          : ""}
        <button class="btn" type="submit">${canTakeACard
          ? (l.kind === "sponsor" ? "Sponsor and pay" : "Buy and pay")
          : (l.kind === "sponsor" ? "Sponsor" : "Register")}</button>
      </form>`;
    // FIX-41: a level's own small picture, in a fixed square beside its name.
    const lpic = require("../../pictures").readPicture(l.picture);
    return `<div class="card${l.kind === "sponsor" ? " sponsor" : ""}" data-level-kind="${esc(l.kind)}">
      ${lpic ? `<div style="float:right;width:72px;margin:0 0 8px 12px">${require("../../pictures").pictureHtml({ ...lpic, alt: lpic.alt || l.name }, { ratio: "1 / 1", radius: 10, sizes: "72px" })}</div>` : ""}
      <div class="row"><h2>${esc(l.name)}</h2>${soldOut
        ? `<span class="pill shut">Sold out</span>`
        : `<span class="pill open">${esc(evMoney(l.price))}</span>`}</div>
      ${benefits.length ? `<ul class="benefits">${benefits.map(b => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}
      ${Number(l.fmv) > 0
        ? `<p class="small">${esc(evMoney(l.fmv))} of this is what you receive${l.kind === "sponsor" ? "" : " on the night"}, so ${esc(evMoney(deductible))} is tax deductible${memberDeductible != null ? `, or ${esc(evMoney(memberDeductible))} at the member price` : ""}.</p>`
        : `<p class="small">The whole amount is tax deductible: nothing is given in return.</p>`}
      ${priceLine}
      ${l.recognition ? `<p class="small">Listed as ${esc(String(l.recognition).replace(/\{\{\s*name\s*\}\}/g, "your name"))}.</p>` : ""}
      ${left != null && !soldOut && left <= 10 ? `<p class="small">${left} place${left === 1 ? "" : "s"} left.</p>` : ""}
      ${l.kind === "sponsor" || tickets.length > 1
        ? `<details${soldOut ? " open" : ""}><summary class="btn${l.kind === "sponsor" ? " quiet" : ""}">${soldOut ? "Join the waiting list" : l.kind === "sponsor" ? "Sponsor at this level" : canTakeACard ? "Buy tickets" : "Register"}</summary>${form}</details>`
        : form}
    </div>`;
  };
  const problem = String(q.problem || "").slice(0, 200);

  // ── PARITY-2 Part 3: THE TOP OF THE PAGE ─────────────────────────────
  // The picture (or the film), then when and where, in the words a poster
  // uses. Times are the org's wall clock (orgTime.js) and are printed as
  // typed; the calendar file is what converts them.
  const video = EPG.parseEventVideo(e.hero_video_url);
  const hero = video
    ? `<div class="hero video"><iframe src="${esc(video.embedUrl)}" title="${esc(e.name)}" loading="lazy"
         allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`
    : /^\/portal-assets\/pa_[a-f0-9]{24}$/.test(String(e.hero_image_url || ""))
    ? `<div class="hero"${editable ? ` data-st-photo="cover"` : ""}><img src="${esc(e.hero_image_url)}?w=1280" srcset="${esc(e.hero_image_url)}?w=640 640w, ${esc(e.hero_image_url)}?w=1280 1280w, ${esc(e.hero_image_url)}?w=1920 1920w" sizes="(max-width: 760px) 100vw, 720px" alt="${esc((e.hero_meta && e.hero_meta.alt) || e.name)}" style="object-position:${require("../../pictures").focusCss(require("../../pictures").readPicture({ url: e.hero_image_url, ...(e.hero_meta || {}) }))}"></div>`
    : "";
  const day = EPG.civil(e.date), lastDay = EPG.civil(e.end_date);
  const dateWords = lastDay && lastDay !== day ? `${evDayWords(day)} to ${evDayWords(lastDay)}` : evDayWords(day);
  const times = EPG.timeRangeWords(e.start_time, e.end_time);
  const mapHref = e.location ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.location)}` : "";

  // THE SHARE ROW. Plain links built on the one public address (publicAppUrl),
  // and a copy button that is the only script on the page and is not needed
  // to read it: the address is printed in the box beside it.
  const shareUrl = `${publicAppUrl()}/e/${encodeURIComponent(e.public_slug || "")}`;
  const share = `<div class="card share" data-testid="event-share">
      <h2>Tell a friend</h2>
      <div class="copy"><input readonly value="${esc(shareUrl)}" aria-label="The page address"${editable ? "" : ` onfocus="this.select()"`}>
        <button class="btn small quiet" type="button"${editable ? "" : ` onclick="var i=this.previousElementSibling;i.select();(navigator.clipboard?navigator.clipboard.writeText(i.value):Promise.reject()).then(function(){},function(){document.execCommand&&document.execCommand('copy')});this.textContent='Copied'"`}>Copy link</button></div>
      <p class="links">${EPG.shareLinks(shareUrl, e.name).map(s => `<a href="${esc(s.href)}" target="_blank" rel="noopener noreferrer">${esc(s.label)}</a>`).join("")}</p>
    </div>`;

  // THE PHOTOGRAPHS, once the night is over (shared/eventPage.js galleryShows).
  const today = orgToday(await orgTz(e.org_id));   // ORG_TZ_SEAM_OK
  const photos = (Array.isArray(e.gallery) ? e.gallery : []).filter(p => /^\/portal-assets\/pa_[a-f0-9]{24}$/.test(String(p && p.path || "")));
  const isOver = EPG.galleryShows({ date: day, endDate: lastDay, today });
  const gallery = isOver && photos.length ? `<h2 class="sec">On the night</h2><div class="gallery" data-testid="event-gallery">${photos.map(p => `
      <figure><a href="${esc(p.path)}?w=1920" target="_blank" rel="noopener"><img src="${esc(p.path)}?w=640" alt="${esc(p.caption || "")}" loading="lazy"></a>${p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : ""}</figure>`).join("")}</div>` : "";

  // GIVE INSTEAD, tied to THIS event. The same donation checkout every gift
  // takes (POST /e/:slug/give -> donateHandler); the event and its campaign
  // are the server's to name, never the form's.
  const giveCard = `<div class="card" data-testid="event-give">
      <h2>${isOver ? "Give to what the night was for" : "Cannot come?"}</h2>
      <p class="small">You can still give. It goes to the same place the evening does, and the whole amount is tax deductible because nothing is given in return.</p>
      ${canTakeACard ? `<details><summary class="btn">Donate</summary>
        <form method="post" action="${slugPath}/give">
          <input class="hp" name="website" tabindex="-1" autocomplete="off">
          <label>Amount in dollars<input name="amount" type="number" min="1" step="1" inputmode="numeric" required placeholder="50"></label>
          <label>Your name<input name="name" required autocomplete="name"></label>
          <label>Email, for your receipt<input name="email" type="email" required autocomplete="email"></label>
          <button class="btn" type="submit">Give and pay</button>
        </form></details>`
      : `<a class="btn quiet" href="/give/${esc((org && org.org_slug) || "")}">Give instead</a>`}
    </div>`;

  const style = `<style>
    .hero{margin:0 0 14px;border-radius:14px;overflow:hidden;background:#0f1a12}
    .hero img{display:block;width:100%;aspect-ratio:16/9;height:auto;object-fit:cover}
    .hero.video{position:relative;padding-top:56.25%}
    .hero.video iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
    .when p{margin:0 0 4px}
    .sec{margin:22px 0 10px}
    .sponsors{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}
    .sponsors .card{margin:0;border-top:4px solid #c9a84c}
    .benefits{margin:6px 0 10px;padding:0;list-style:none}
    .benefits li{font-size:14px;padding:3px 0 3px 22px;position:relative}
    .benefits li:before{content:"";position:absolute;left:4px;top:10px;width:8px;height:8px;border-radius:50%;background:#0d5c3a}
    details summary{list-style:none}
    details summary::-webkit-details-marker{display:none}
    details[open] summary{display:none}
    .share .copy{display:flex;gap:8px;align-items:center}
    .share .copy input{flex:1;min-width:0}
    .share .links{display:flex;flex-wrap:wrap;gap:8px 16px;margin:12px 0 0}
    .share .links a{color:#0d5c3a;font-weight:700;font-size:14px}
    .gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin:0 0 14px}
    .gallery figure{margin:0}
    .gallery img{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:10px}
    .gallery figcaption{font-size:12px;color:#5a554f;margin-top:4px}
    a{color:#0d5c3a}
  </style>`;

  const html = evPage({ title: `${e.name} · ${brand.displayName}`, brand, wide: true, body: `${style}
    ${problem ? `<div class="err">${esc(problem)}</div>` : ""}
    ${q.waitlisted === "1" ? `<div class="ok">You are on the waiting list. ${esc(brand.displayName || "The organization")} will be in touch if a place comes free.</div>` : ""}
    ${q.gave === "1" ? `<div class="ok">Thank you. Your gift went through, and your receipt is on its way by email.</div>` : ""}
    ${hero}
    <div class="card when" data-testid="event-when">
      <h1${editable ? ` data-st-edit="name"` : ""}>${esc(e.name)}</h1>
      <p><strong>${esc(dateWords)}</strong>${times ? `<br>${esc(times)}` : ""}</p>
      ${e.location ? `<p>${esc(e.location)} · <a href="${esc(mapHref)}" target="_blank" rel="noopener">Map and directions</a></p>` : ""}
      ${isOver ? "" : `<p class="small"><a href="${slugPath}/calendar.ics" data-testid="event-ics">Add to my calendar</a></p>`}
      ${e.description || editable ? `<p style="margin-top:10px"${editable ? ` data-st-edit="description" data-st-multi="1"` : ""}>${esc(e.description || "")}</p>` : ""}
    </div>
    ${gallery}
    ${!isOver && tickets.length ? `<h2 class="sec">Come along</h2>${tickets.map(levelCard).join("")}` : ""}
    ${!isOver && sponsors.length ? `<h2 class="sec">Sponsor it</h2><div class="sponsors" data-testid="event-sponsors">${sponsors.map(levelCard).join("")}</div>` : ""}
    ${isOver && (tickets.length || sponsors.length) ? `<div class="card"><p class="muted">This event has happened. Thank you to everybody who came.</p></div>` : ""}
    ${giveCard}
    ${share}
    <p class="small" style="text-align:center">${isOver && !canTakeACard ? "" : canTakeACard
      ? `Your card is taken by ${esc(brand.displayName || "the organization")}'s own payment account. Steward never holds the money and never sees the card.`
      : `Registering here tells ${esc(brand.displayName || "the organization")} you are coming. They will be in touch about paying, and nothing is charged on this page.`}</p>
  ` });
  // EDITOR-1: the editor's preview runs no script, so the share box's two
  // inline handlers are never written into it (above).
  return html;
}
return { EV_PUBLIC_READY, evDayWords, evMoney, evPage, eventPageHtml, logEventRegistered };
}

module.exports = { mount };
