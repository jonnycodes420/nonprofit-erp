// shared/itemLinks.js · THREAD-2. EVERY NAME IS A LINK.
//
// If Steward names a person, a gift, a task or a meeting, you are one click
// from it. This is the one place a named thing becomes its page, read by the
// Thread on Home, by Tell Steward's and the Agent's results, and by every
// email Steward sends to staff. A new kind of Thread item gets links for free:
// it carries `refs` (the things it names) and the renderer does the rest.
//
// A ref is { kind, id, name, donorId?, date?, email?, fundraising? }.
// The paths are the app's own (client/src/lib/appUrls.js reads them back), so
// a link in an email opens the same screen as a click on Home, through
// sign-in first when the reader is signed out (/login?next=...).
//
// Pure: no DOM, no fetch, no Express. The server loads it with import().

// The words a name must never be on a screen or in an email.
const NOT_A_NAME = /^(null|undefined|unknown|untitled|n\/a|none|-+)$/i;
export const NO_NAME = "a donor (no name on file)";

// A name worth printing, or null. "null null" and "Unknown" are not names.
export function realName(v) {
  const s = String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  if (!s) return null;
  const words = s.split(" ").filter(w => !NOT_A_NAME.test(w));
  return words.length ? words.join(" ") : null;
}

// What to call someone: their name, else their email, else the plain fallback.
export function nameOrFallback(name, email, fallback = NO_NAME) {
  return realName(name) || (String(email || "").includes("@") ? String(email).trim() : null) || fallback;
}

const enc = encodeURIComponent;
const PERSON_KINDS = new Set(["person", "donor", "organization", "organisation", "household_member"]);
const ITEM_KINDS = new Set(["email", "call", "note", "conversation", "interaction", "visit", "stewardship"]);

// The app path for a ref, or null when it has no page (then it prints as text).
export function refPath(ref) {
  if (!ref || !ref.kind) return null;
  const k = ref.kind, id = ref.id == null ? "" : String(ref.id);
  const donorPage = (anchor) => ref.donorId ? `/donors/${enc(ref.donorId)}${anchor ? "#" + enc(anchor) : ""}` : null;
  if (PERSON_KINDS.has(k)) return id ? `/donors/${enc(id)}` : null;
  if (k === "household") return id ? `/donors?household=${enc(id)}` : null;
  if (k === "gift") return donorPage(id ? "gift-" + id : "gifts");
  if (k === "pledge") return donorPage(id ? "pledge-" + id : null);
  if (k === "plan") return donorPage(id ? "plan-" + id : null);
  // Anything logged on a person (a call, an ask, a visit) is a line on them.
  if (ITEM_KINDS.has(k) || (ref.logged && ref.donorId)) return donorPage(id ? "item-" + id : null);
  if (k === "meeting") {
    // A meeting that was logged is a line on the person; one on the calendar
    // opens the calendar on its day.
    if (ref.logged && ref.donorId && id) return donorPage("item-" + id);
    if (ref.date) return `/app/calendar?day=${enc(String(ref.date).slice(0, 10))}`;
    return donorPage(null) || "/app/calendar";
  }
  if (!id) return null;
  if (k === "task") return `/app/tasks?task=${enc(id)}`;
  if (k === "group") return `/app/groups?group=${enc(id)}`;
  if (k === "journey") return `/app/journeys?journey=${enc(id)}`;
  if (k === "campaign") return ref.fundraising ? `/app/fundraising?fr=campaigns&campaign=${enc(id)}` : `/app/communications?campaign=${enc(id)}`;
  if (k === "event") return `/app/events?event=${enc(id)}`;
  if (k === "grant") return `/app/grants?grant=${enc(id)}`;
  return null;
}

// The words a ref prints as. Never blank, never "null", never a raw id.
export function refLabel(ref) {
  if (!ref) return "";
  const n = realName(ref.name);
  if (n) return n;
  if (PERSON_KINDS.has(ref.kind)) return nameOrFallback(null, ref.email);
  return { gift: "the gift", pledge: "the pledge", plan: "the monthly gift", task: "the task", meeting: "the meeting",
    email: "the email", call: "the call", note: "the note", group: "the group", journey: "the journey",
    campaign: "the campaign", event: "the event", grant: "the grant", household: "the household" }[ref.kind] || "it";
}

// A sentence cut into plain text and named things. Each ref with a name is
// found in the text (first time only, longest name first, whole words), so a
// sentence written anywhere in Steward links whatever it names.
export function linkSegments(text, refs) {
  const s = String(text == null ? "" : text);
  const list = (refs || []).filter(r => r && realName(r.name) && refPath(r))
    .sort((a, b) => realName(b.name).length - realName(a.name).length);
  const hits = [];
  for (const r of list) {
    const name = realName(r.name);
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?=$|[^\\p{L}\\p{N}])`, "iu");
    const m = re.exec(s);
    if (!m) continue;
    const start = m.index + m[1].length, end = start + m[2].length;
    if (hits.some(h => start < h.end && end > h.start)) continue;
    hits.push({ start, end, ref: r });
  }
  hits.sort((a, b) => a.start - b.start);
  const out = [];
  let at = 0;
  for (const h of hits) {
    if (h.start > at) out.push({ text: s.slice(at, h.start) });
    out.push({ text: s.slice(h.start, h.end), ref: h.ref, href: refPath(h.ref) });
    at = h.end;
  }
  if (at < s.length) out.push({ text: s.slice(at) });
  return out;
}

// ── Email ───────────────────────────────────────────────────────────────
// Every href in a staff email is absolute on the app's public URL; signed
// out, the app sends the reader through sign-in and back to that same path.
export function escHtml(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
export const LINK_STYLE = "color:#0d5c3a;font-weight:700;text-decoration:underline;";

export function refUrl(ref, base) {
  const p = refPath(ref);
  return p ? String(base || "").replace(/\/+$/, "") + p : null;
}

// One named thing as an <a>, or its words when it has no page.
export function refLinkHtml(ref, base, { label = null, style = LINK_STYLE } = {}) {
  const words = escHtml(label != null ? label : refLabel(ref));
  const url = refUrl(ref, base);
  return url ? `<a href="${escHtml(url)}" style="${style}">${words}</a>` : words;
}

// A sentence with every named thing linked.
export function linkedHtml(text, refs, base, { style = LINK_STYLE } = {}) {
  return linkSegments(text, refs).map(seg => seg.ref
    ? `<a href="${escHtml(refUrl(seg.ref, base))}" style="${style}">${escHtml(seg.text)}</a>`
    : escHtml(seg.text)).join("");
}

// The one button at the foot of a staff email: the main thing.
export function buttonHtml(label, url) {
  return `<div style="margin-top:22px;" data-email-button="1"><a href="${escHtml(url)}" style="display:inline-block;background:#0d5c3a;color:#ffffff;text-decoration:none;font-weight:700;padding:11px 22px;border-radius:8px;">${escHtml(label)}</a></div>`;
}
export function refButtonHtml(ref, base, label = null) {
  const url = refUrl(ref, base);
  return url ? buttonHtml(label || `Open ${refLabel(ref)}`, url) : "";
}
