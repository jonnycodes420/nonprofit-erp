// shared/eventPage.js: PARITY-2 Part 3. WHAT THE PUBLIC EVENT PAGE IS MADE OF.
//
// The page itself is rendered by the server (GET /e/:slug, routes/crm.js) and
// the staff screen edits the same fields, so the rules for each field live
// here once: what a time looks like, which video hosts may be embedded, what a
// public address may be spelled with, what a sponsor's benefits are, and when
// the photographs appear.
//
// Pure: no DB, no network, no clock (every "today" is a parameter).

// ── TIMES ─────────────────────────────────────────────────────────────────
// A start and an end are CIVIL wall-clock times, HH:MM, in the ORG's zone
// (orgTime.js). An event with no time is an all-day event, and nothing here
// invents seven o'clock for it.
export function parseEventTime(v) {
  if (v === undefined) return undefined;          // not being set
  const s = String(v == null ? "" : v).trim();
  if (!s) return null;                            // explicit clear
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return { error: "A time looks like 18:30." };
  const hh = Number(m[1]), mm = Number(m[2]);
  if (hh > 23 || mm > 59) return { error: "A time looks like 18:30." };
  return `${String(hh).padStart(2, "0")}:${m[2]}`;
}

// "18:30" -> "6:30 pm", "19:00" -> "7 pm". The words a poster uses.
export function timeWords(hhmm) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm || ""));
  if (!m) return "";
  const h = Number(m[1]), min = m[2];
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${min === "00" ? "" : ":" + min} ${h < 12 ? "am" : "pm"}`;
}

export function timeRangeWords(start, end) {
  if (!start) return "";
  return end ? `${timeWords(start)} to ${timeWords(end)}` : `from ${timeWords(start)}`;
}

// ── THE VIDEO ─────────────────────────────────────────────────────────────
// Two hosts, parsed for an id and rebuilt by us, never a pasted embed code.
// YouTube is embedded from its no-cookie domain and Vimeo with do-not-track,
// so opening the page does not hand a visitor to an ad network.
export function parseEventVideo(url) {
  const s = String(url || "").trim().slice(0, 300);
  if (!s) return null;
  let m = /^https:\/\/(?:www\.|m\.)?youtube\.com\/watch\?(?:[^#]*&)?v=([A-Za-z0-9_-]{6,20})/.exec(s)
    || /^https:\/\/youtu\.be\/([A-Za-z0-9_-]{6,20})/.exec(s)
    || /^https:\/\/(?:www\.)?youtube(?:-nocookie)?\.com\/(?:embed|shorts)\/([A-Za-z0-9_-]{6,20})/.exec(s);
  if (m) return { provider: "youtube", id: m[1],
                  embedUrl: `https://www.youtube-nocookie.com/embed/${m[1]}`,
                  watchUrl: `https://www.youtube.com/watch?v=${m[1]}` };
  m = /^https:\/\/(?:www\.)?vimeo\.com\/(\d{6,12})(?:[/?#]|$)/.exec(s)
    || /^https:\/\/player\.vimeo\.com\/video\/(\d{6,12})(?:[/?#]|$)/.exec(s);
  if (m) return { provider: "vimeo", id: m[1],
                  embedUrl: `https://player.vimeo.com/video/${m[1]}?dnt=1`,
                  watchUrl: `https://vimeo.com/${m[1]}` };
  return null;
}
export const VIDEO_HOSTS_SENTENCE = "A YouTube or Vimeo link, such as https://www.youtube.com/watch?v=… or https://vimeo.com/….";

// ── THE ADDRESS ───────────────────────────────────────────────────────────
// /e/<slug>. Lower case, digits and hyphens, because it is typed off a poster.
export function normalizeEventSlug(raw) {
  const s = String(raw == null ? "" : raw).trim().toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!s) return { slug: null };
  if (s.length < 3) return { error: "A page address needs at least three letters or numbers." };
  if (s.length > 60) return { error: "A page address is at most sixty characters." };
  return { slug: s };
}
export function suggestEventSlug(name, date) {
  const base = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  const year = /^(\d{4})/.exec(String(date || ""));
  const withYear = base && year && !base.includes(year[1]) ? `${base}-${year[1]}` : base;
  return withYear || "event";
}

// ── THE PHOTOGRAPHS ───────────────────────────────────────────────────────
// Staff may add them any time; the page shows them once the event is over,
// because a gallery of last year's night on this year's ticket page is a
// promise about photographs nobody has taken yet.
export const MAX_GALLERY = 40;
export function galleryShows({ date, endDate, today }) {
  const day = civil(endDate) || civil(date);
  return !!(day && today && day < today);
}
export function civil(d) {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(d));
  return m ? m[1] : null;
}

// ── THE SHARE ROW ─────────────────────────────────────────────────────────
// Plain links, no scripts and no buttons that phone home: each one opens the
// network's own share screen with the address filled in.
export function shareLinks(url, title) {
  const u = encodeURIComponent(url), t = encodeURIComponent(title || "");
  return [
    { key: "email", label: "Email", href: `mailto:?subject=${t}&body=${encodeURIComponent(`${title || ""}\n\n${url}`)}` },
    { key: "facebook", label: "Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
    { key: "x", label: "X", href: `https://x.com/intent/post?url=${u}&text=${t}` },
    { key: "linkedin", label: "LinkedIn", href: `https://www.linkedin.com/sharing/share-offsite/?url=${u}` },
  ];
}
