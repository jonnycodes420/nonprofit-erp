// BUILD-95 §5B — THE ONE WIDGET REGISTRY.
//
// A widget used to be declared in THREE places that nothing kept in step: the
// type list and validator in server.js, the switch in PortalWidgets.jsx, and
// the label/default tables in PortalEditor.jsx. Adding a widget to two of the
// three is a screen that renders nothing, or an editor offering something the
// server refuses — and no test could see it, because there was nothing for a
// test to compare the three against.
//
// This module is that something. It is the ONE place a widget exists, and
// `tests/page-widgets.test.js` walks all three consumers back to it. That is
// what makes "one builder, two surfaces" true rather than aspirational.
//
// THE SURFACE IS A FILTER, NOT A FORK. A widget declares which surfaces it
// belongs on and the editor offers it there; the renderer does not care, and
// there is exactly one of it. A second builder for giving pages would be two
// places to keep a widget, which is the problem this module just solved.

// EMAIL-1: email is the third surface. The blocks a page and an email share
// are the same widgets (same keys, same fields, same editor options); the few
// only an email needs are listed below with surfaces ["email"].
export const SURFACES = ["portal", "give", "email"];

// `full` = spans both grid tracks on a wide screen (the old FULL_WIDTH_WIDGETS).
// `defaults` = what the editor inserts. Both were separate literals before.
export const WIDGETS = [
  { key: "hero",     label: "Hero",             hint: "Big photo + headline",        surfaces: ["portal", "give", "email"], full: true,
    defaults: { heading: "", sub: "", image: null, alt: "", size: "standard" } },
  { key: "richtext", label: "Rich text",        hint: "Paragraphs, headings, lists", surfaces: ["portal", "give", "email"], full: true,
    defaults: { blocks: [{ type: "p", text: "Write something in your own words." }] } },
  { key: "image",    label: "Image + caption",  hint: "One photo",                   surfaces: ["portal", "give", "email"], full: false,
    defaults: { image: null, alt: "", caption: "" } },
  { key: "gallery",  label: "Gallery",          hint: "Up to 8 photos",              surfaces: ["portal", "give"], full: false,
    defaults: { images: [] } },
  { key: "stats",    label: "Stats",            hint: "Your own numbers",            surfaces: ["portal", "give", "email"], full: false,
    defaults: { items: [{ value: "", label: "" }] } },
  { key: "funds",    label: "Programs & funds", hint: "Cards from your real funds",  surfaces: ["portal", "give"], full: false,
    defaults: { heading: "Where you can give", fundIds: [] } },
  { key: "campaign", label: "Campaign",         hint: "A campaign's story + goal",   surfaces: ["portal", "give"], full: false,
    defaults: { campaignId: "" } },
  { key: "impact",   label: "Impact feed",      hint: "Your impact updates",         surfaces: ["portal", "give"], full: false,
    defaults: { heading: "What your giving made possible" } },
  { key: "quote",    label: "Quote",            hint: "A voice from your community", surfaces: ["portal", "give", "email"], full: false,
    defaults: { text: "", attribution: "" } },
  { key: "staff",    label: "People & contact", hint: "Faces + a way to reach you",  surfaces: ["portal", "give"], full: false,
    defaults: { members: [{ name: "", role: "", photo: null }], contactEmail: "" } },
  { key: "faq",      label: "FAQ",              hint: "Questions donors ask",        surfaces: ["portal", "give"], full: false,
    defaults: { items: [{ q: "", a: "" }] } },
  { key: "video",    label: "Video",            hint: "YouTube or Vimeo link",       surfaces: ["portal", "give", "email"], full: true,
    defaults: { url: "", caption: "" } },

  // ── EMAIL-1 · WHAT ONLY AN EMAIL NEEDS ───────────────────────────────────
  // The header and footer are the org's brand and the MAIL-1 footer (address
  // and unsubscribe), filled at render time, never typed. A video in email is
  // its thumbnail with a play button, linking to the video's page, because no
  // inbox plays video.
  { key: "header",     label: "Header with logo", hint: "Your logo and name, from your brand", surfaces: ["email"], full: true,
    defaults: {} },
  { key: "photos2",    label: "Two photos",       hint: "Side by side",                surfaces: ["email"], full: true,
    defaults: { images: [{ src: null, alt: "" }, { src: null, alt: "" }] } },
  { key: "button",     label: "Button",           hint: "Give, RSVP, volunteer or read more", surfaces: ["email"], full: true,
    defaults: { action: "give", label: "Give today", url: "" } },
  { key: "event",      label: "Event card",       hint: "One of your events",          surfaces: ["email"], full: true,
    defaults: { eventId: "" } },
  { key: "givingpage", label: "Giving page card", hint: "One of your giving pages",    surfaces: ["email"], full: true,
    defaults: { givingPageId: "" } },
  { key: "signature",  label: "Signature",        hint: "A name, a title and a photo", surfaces: ["email"], full: true,
    defaults: { name: "", title: "", photo: null } },
  { key: "footer",     label: "Footer",           hint: "Your address and unsubscribe (always included)", surfaces: ["email"], full: true,
    defaults: {} },

  // ── CAMPAIGN-2 · THE THREE A CAMPAIGN PAGE NEEDS ─────────────────────────
  // GIVE-ONLY, each for a reason the portal cannot satisfy: a countdown and a
  // matching challenge are about ONE campaign with a deadline, and a portal is
  // a donor's permanent home with neither.
  //
  // RECENT GIFTS is the one that carries a rule rather than a setting. A name
  // appears only when that donor chose to show it, gift by gift, and the
  // default is off — the BUILD-103 rule (`show_name_to_fundraiser`) applied to
  // a public page, for the same reason: a gift to an organisation is not a
  // public act unless the person giving it says so. AMOUNTS are off by default
  // too, and that is the org's setting rather than the donor's, because the
  // size of a gift beside a name is a second disclosure.
  { key: "recentgifts", label: "Recent gifts",  hint: "Who has given, as each donor chose", surfaces: ["give"], full: false,
    defaults: { count: 8, showAmounts: false, heading: "Recent gifts" } },
  // A countdown reads the CAMPAIGN's end date. It has no date of its own, so
  // there is one answer to "when does this close" and the page cannot contradict
  // the record.
  { key: "countdown",  label: "Countdown",      hint: "Days left, from the campaign's end date", surfaces: ["give"], full: false,
    defaults: { heading: "" } },
  // The matching challenge, which renders NOTHING until the organisation has
  // entered one on the campaign. A match on a page that nobody has funded is a
  // claim about somebody else's money.
  { key: "matchchallenge", label: "Matching challenge", hint: "Shown only when you have entered one", surfaces: ["give"], full: false,
    defaults: {} },

  // PORTAL ONLY, and each for a reason a giving page cannot satisfy.
  //
  // `give` sends somebody TO a giving page; on the giving page they are already
  // there, and the form is on the screen. A button that scrolls to the thing
  // under it is the software admiring itself.
  { key: "give",     label: "Give button",      hint: "A clear way to give",         surfaces: ["portal"], full: true,
    defaults: { heading: "Make a new gift", buttonLabel: "Give" } },
  // `mygiving` is a donor's own history, which needs a donor session. A giving
  // page is opened by a stranger from a QR code on a flyer.
  { key: "mygiving", label: "My Giving",        hint: "The donor's own history",     surfaces: ["portal"], full: false,
    defaults: {} },
];

export const WIDGET_TYPES = WIDGETS.map(w => w.key);
const BY_KEY = new Map(WIDGETS.map(w => [w.key, w]));

export function widgetDef(key) { return BY_KEY.get(key) || null; }
export function widgetsForSurface(surface) { return WIDGETS.filter(w => w.surfaces.includes(surface)); }
export function typesForSurface(surface) { return widgetsForSurface(surface).map(w => w.key); }
export function isFullWidth(key) { const d = BY_KEY.get(key); return !!(d && d.full); }
export function defaultWidget(key) {
  const d = BY_KEY.get(key);
  return d ? { type: key, ...JSON.parse(JSON.stringify(d.defaults)) } : null;
}

// THE FORM IS FIXED, AND SHE CHOOSES WHICH SIDE OF THE PAGE IT LEADS.
//
// It is not a widget, because a giving page whose whole job is taking a gift
// must not be able to lose the form — that is a page that silently stopped
// working, and nothing on the screen would say so. She arranges everything
// around it and picks whether it opens the page or follows the story.
export const FORM_POSITIONS = ["top", "bottom"];
export const DEFAULT_FORM_POSITION = "top";
export function normalizeFormPosition(v) {
  return FORM_POSITIONS.includes(v) ? v : DEFAULT_FORM_POSITION;
}
export const FORM_POSITION_LABEL = {
  top: "The form leads, and the story follows it.",
  bottom: "The story leads, and the form waits at the end of it.",
};
