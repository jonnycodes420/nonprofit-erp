// BUILD-54 §4 — EDIT MODE: the org edits the portal INSIDE the portal.
// The real page renderer runs in the org's own theme with an editing chrome
// layered over it (BUILD-34's Home-editor interaction machinery, ported).
//
// SAFETY RULES (non-negotiable, §4):
//   • Authenticated by the EXISTING staff session (apiFetch/npe_token) — no
//     new credential, no separate login. Every editor endpoint
//     (/portal-page*) is requireAuth + requireAdmin and org-scoped by the
//     token alone.
//   • Edit mode renders SAMPLE DONOR DATA ONLY — the clearly-labeled
//     fictional donor below. This file deliberately fetches NO donor data:
//     no portal session, no /me, no donor endpoints (pinned by
//     tests/portal-page.test.js's source check).
//   • Draft/publish: autosave writes the DRAFT; nothing donor-visible until
//     an explicit Publish; Revert restores the last published page.
//   • Device toggle: phone and desktop, PHONE DEFAULT (donors arrive from
//     email on a phone).
import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from "react";
import { WIDGETS, typesForSurface, defaultWidget } from "../../../shared/pageWidgets";
import { apiFetch } from "../api";
import { PageRenderer } from "../components/PortalWidgets";
import { resolvePairing, resolveCardStyle, TYPE_PAIRINGS, CARD_STYLES } from "../lib/portalTheme";
import { textToStory, storyToText } from "../lib/storyBlocks";
import { resolveAssetUrl } from "../lib/assetUrl";
import Uploader, { IMAGE_ACCEPT, IMAGE_ACCEPT_LABEL, IMAGE_MAX_BYTES } from "../components/Uploader";
import PhotoField from "../components/PhotoField";
import { PortalBannerCrop, PORTAL_HEADER_RATIO, PORTAL_WIDGET_IMAGE_RATIO } from "../components/PortalBanner";
import { errorMessage } from "../lib/domainError";
import { askConfirm } from "../components/ConfirmDialog";
import MediaPicker from "../components/MediaPicker";
import { VolunteerProvider } from "../components/VolunteerBlocks";
import { safeBack } from "../lib/appUrls";
// GIVE-3 — the preview IS the giving page: the same component a donor opens,
// drawn from the draft's payload, so the two cannot drift apart again.
import Donate from "./Donate";
import { LAYOUTS, TRUST_KEYS, TRUST_LABELS, normalizeDesign, wayNeeds } from "../../../shared/givingPageDesign.js";
// EDITOR-1 — the one editor shell every donor-facing thing opens in.
import StewardEditor, { RailSection, DeviceFrame, RailPhoto, PhotoTools, useNarrow, stockPhotoForBlock } from "../components/StewardEditor";
import InlineText, { INLINE_CSS } from "../components/InlineText";
import { retryImport } from "../lib/lazyRetry";

// Part 3: Steward's photos, opened from the cover and from a photo block.
const LazyStockPicker = lazy(() => retryImport(() => import("../components/StockPhotoPicker")));

// ── The fictional donor (§4: never a real donor's data) ────────────────────
const SAMPLE_ME = {
  donorName: "Sam Sample",
  giving: { ytd: 450, lifetime: 2900 },
  // impact deliberately empty: the editor renders the org's REAL published
  // updates in the impact widget (org content, not donor data — BUILD-55);
  // the sample entry below appears only when the org has published nothing.
  impact: [],
};
const SAMPLE_IMPACT = [{
  id: "sample_imp", title: "Sample impact update",
  body: "Publish an impact update and it appears here, donors it matches see it on their own page.",
  photos: [], date: new Date().toISOString(),
}];

// BUILD-95 §5B — labels, hints and defaults come FROM the ONE registry
// (`shared/pageWidgets.js`). They used to be two more literals here, which is
// how the editor could offer a widget the server would refuse.
const WIDGET_META = Object.fromEntries(WIDGETS.map(w => [w.key, { label: w.label, hint: w.hint }]));
const widgetTypesHere = surface => typesForSurface(surface);

const E = {
  ink: "#0f1a12", cream: "#f0ede6", gold: "#c9a84c", bg3: "#dcd8cc", terra: "#8a3a24", green: "#0d5c3a",
  // The editor chrome's own four, named rather than repeated thirty-four times.
  line: "#3a4a3e", muted: "#6b6b64", panel: "#1b2a20", preview: "#1a6b4a",

  // FIX-2 C — named here once, where they were inline.
  white: "#ffffff",
  paper: "#faf9f6",
  hair: "#e7e4dc",
  editInk: "#101a13",
  editPanel2: "#2a3a2e",
  sage: "#8fa896",
  terra100: "#f6e3dd",
  editGround: "#f7f5ef",
  editLine: "#e0dcd0",
  body: "#1c1c1a",
};
const btnQuiet = { background: "transparent", color: E.cream, border: "1px solid " + E.line, borderRadius: 9, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const inp = { width: "100%", boxSizing: "border-box", padding: "8px 10px", fontSize: 13, border: "1px solid " + E.bg3, borderRadius: 8, fontFamily: "inherit" };
const lbl = { fontSize: 11, fontWeight: 700, color: E.muted, textTransform: "uppercase", letterSpacing: "0.06em", margin: "10px 0 4px" };
// GIVE-EDIT-1 — the Details rail and the form preview.
const money0 = n => "$" + Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
const FREQ_LABEL = { once: "One-time", monthly: "Monthly", annual: "Annual" };
const checkRow = { display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, color: E.body, cursor: "pointer", marginTop: 8, lineHeight: 1.5 };

function varsForPs(ps) {
  const pairing = resolvePairing(ps.type_pairing);
  const cs = resolveCardStyle(ps.card_style);
  return {
    "--pt-primary": ps.primary_color || E.preview, "--pt-primary-fg": E.white,
    "--pt-accent": ps.accent_color || E.gold, "--pt-accent-fg": E.white,
    "--pt-button": ps.button_color || ps.primary_color || E.preview, "--pt-button-fg": E.white,
    "--pt-bg": ps.background_tint || E.paper,
    "--pt-serif": pairing.serif, "--pt-sans": pairing.sans,
    "--pt-card-radius": cs.radius + "px",
    "--pt-card-border": cs.borderWidth ? `${cs.borderWidth}px solid ${E.hair}` : "none",
    "--pt-card-shadow": cs.shadow,
  };
}

// Sample My Giving — a clearly-labeled stand-in; NEVER the live component
// (the live one carries recurring mutations and expects a real session).
function SampleMyGiving() {
  return (
    <div style={{ background: E.white, border: "var(--pt-card-border,1px solid "+E.hair+")", borderRadius: "var(--pt-card-radius,14px)", padding: "20px 22px", marginBottom: 18 }}>
      <div style={{ fontFamily: "var(--pt-serif,Georgia,serif)", fontSize: 22, marginBottom: 12 }}>Your giving</div>
      <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
        <div><div style={lbl}>This year</div><div style={{ fontSize: 26, fontWeight: 700 }}>$450</div></div>
        <div><div style={lbl}>Lifetime</div><div style={{ fontSize: 26, fontWeight: 700 }}>$2,900</div></div>
      </div>
      <div style={{ fontSize: 12, color: E.muted, marginTop: 10 }}>
        Signed-in donors see their own history, recurring gifts, and receipts here, this is Sam Sample, a fictional donor.
      </div>
    </div>
  );
}

// GIVE-3 — the desktop preview is the page at a real desktop width (1280),
// scaled down to fit the pane, so the two-column layout shows as a donor's
// browser draws it rather than as a narrow pane would.
function ScaledDesktop({ children, width = 1280 }) {
  const outer = useRef(null);
  const inner = useRef(null);
  const [scale, setScale] = useState(1);
  const [h, setH] = useState(0);
  useEffect(() => {
    const el = outer.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const measure = () => { setScale(Math.min(1, el.clientWidth / width)); if (inner.current) setH(inner.current.offsetHeight); };
    const ro = new ResizeObserver(measure);
    ro.observe(el); if (inner.current) ro.observe(inner.current);
    measure();
    return () => ro.disconnect();
  }, [width]);
  return (
    <div ref={outer} data-testid="scaled-desktop" style={{ width: "100%", height: h ? h * scale : undefined, overflow: "hidden" }}>
      <div ref={inner} style={{ width, transform: `scale(${scale})`, transformOrigin: "top left" }}>{children}</div>
    </div>
  );
}

// GIVE-3 — the draft's fields as she types them, laid over the server's
// payload for the draft. Once a save lands the server's payload already holds
// them, so the two agree and the preview is the page.
function overlayPreview(pv, ds, ps, widgets, orgForm = false) {
  if (!pv || (!pv.givingPage && !orgForm)) return null;
  const gp = pv.givingPage ? { ...pv.givingPage } : null;
  if (gp && ds) {
    if (ds.title != null) gp.title = ds.title;
    if (ds.story != null) gp.story = ds.story;
    const img = ds.imageData || ds.imageUrl || "";
    gp.imageUrl = img;
    gp.cover = img ? { url: img, ...(ds.imageMeta || {}) } : null;
    gp.showGoal = ds.showGoal !== false;
    if (!gp.campaignId && ds.goalAmount !== undefined) gp.goalAmount = ds.goalAmount;
    gp.design = normalizeDesign(ds.design);
  }
  // EDITOR-1: the blocks in the editor's order, as she arranges them: the
  // server's resolved block where it has one, her own (just added, not yet
  // saved) where it does not, so a block shows the moment it is added.
  if (gp && Array.isArray(widgets)) {
    const server = Array.isArray(gp.page) ? gp.page : [];
    // A block the server left out of the page (one with nothing to show) stays
    // out; only one added here and not saved yet ("new_…") is drawn from here.
    gp.page = widgets.map(mine => {
      const w = server.find(x => x && x.id === mine.id);
      if (!w) return String(mine.id || "").startsWith("new_") ? mine : null;
      if (w.type === "hero") return { ...w, heading: mine.heading, sub: mine.sub };
      if (w.type === "richtext") return { ...w, blocks: mine.blocks };
      if (w.type === "quote") return { ...w, text: mine.text, attribution: mine.attribution };
      return w;
    }).filter(Boolean);
  }
  const theme = { ...((pv.org && pv.org.theme) || {}) };
  if (ps) {
    if (ps.display_name) theme.displayName = ps.display_name;
    theme.logo = ps.logo_data || ps.logo_url || null;
    if (ps.primary_color) { theme.primary = ps.primary_color; theme.buttonColor = ps.button_color || ps.primary_color; }
    if (ps.background_tint !== undefined) theme.backgroundTint = ps.background_tint || null;
    if (ps.type_pairing) theme.typePairing = ps.type_pairing;
    if (ps.card_style) theme.cardStyle = ps.card_style;
    // POLISH-3: the header image, its focus and its zoom, the moment they change.
    // The stored path as the server sends it, so the preview's markup is the page's.
    theme.headerImage = ps.header_image_data || ps.header_image_url || null;
    theme.headerFocal = { x: Number(ps.header_focal_x ?? 0.5), y: Number(ps.header_focal_y ?? 0.5) };
    const crop = ps.header_crop;
    theme.headerCrop = !crop ? null : typeof crop === "object" ? crop : (() => { try { return JSON.parse(crop); } catch { return null; } })();
  }
  // The org form's drafted amounts, as she types them.
  if (orgForm && ds) {
    if (Array.isArray(ds.onetimeAmounts) && ds.onetimeAmounts.length) theme.onetimeAmounts = ds.onetimeAmounts.map(Number);
    if (Array.isArray(ds.monthlyAmounts) && ds.monthlyAmounts.length) theme.monthlyAmounts = ds.monthlyAmounts.map(Number);
  }
  return gp ? { ...pv, org: { ...pv.org, theme }, givingPage: gp } : { ...pv, org: { ...pv.org, theme } };
}

function readImageFile(file, cb) {
  if (!file || !/^image\//.test(file.type) || file.size > IMAGE_MAX_BYTES) return;
  const r = new FileReader();
  r.onload = () => cb(r.result);
  r.readAsDataURL(file);
}

export default function PortalEditor() {
  const [widgets, setWidgets] = useState(null);      // null = loading
  const [meta, setMeta] = useState(null);            // starters, publishedAt…
  const [ps, setPs] = useState(null);                // theme row (org's own)
  const [funds, setFunds] = useState([]);
  const [camps, setCamps] = useState([]);
  const [impactUpdates, setImpactUpdates] = useState([]); // the org's REAL published updates (BUILD-55)
  const [volData, setVolData] = useState(null);       // VOL-PAGE-1: the programme's live roles, shifts and numbers
  // GIVE-EDIT-1 — `?form=org` edits the org's own donation form in this same
  // editor; `?page=gp_…` a giving or volunteer page; nothing, the portal.
  const editorParams = new URLSearchParams(window.location.search);
  // FIX-39: "Edit in editor" says where it came from; Back goes there.
  // FIX-39: a `back` is the screen in the app that opened the editor. It is
  // only ever a path on THIS site: safeBack refuses anything else, and the
  // link is built on our own origin, so the URL cannot send anyone elsewhere.
  const backPath = safeBack(editorParams.get("back"));
  const hasBack = !!backPath;
  const backHref = hasBack ? window.location.origin + backPath : "/dashboard";
  const givingPageId = editorParams.get("page") || "";
  const isOrgForm = !givingPageId && editorParams.get("form") === "org";
  const isPageEditor = !!givingPageId || isOrgForm;
  // EDITOR-1: one preview at a time. A giving page opens at desktop width on a
  // wide screen; the portal and every page on a phone open on the phone.
  const narrowAtOpen = typeof window !== "undefined" && window.innerWidth < 900;
  const [device, setDevice] = useState(isPageEditor && !narrowAtOpen ? "desktop" : "phone");     // §4: phone DEFAULT for the portal
  // Which rail section a click in the preview asked for, and a bump to open it.
  const [focusAsk, setFocusAsk] = useState({ id: "", n: 0 });
  const askSection = useCallback(id => setFocusAsk(f => ({ id, n: f.n + 1 })), []);
  const [stockOpen, setStockOpen] = useState(null);   // { onPick } while Steward's photo library is open
  const [addAfter, setAddAfter] = useState(null);     // the block a "+" was pressed under
  const narrow = useNarrow();
  const [ds, setDs] = useState(null);                 // GIVE-EDIT-1: the draft settings
  const [dsErrors, setDsErrors] = useState([]);
  const [dsSave, setDsSave] = useState("idle");
  const [historyOpen, setHistoryOpen] = useState(false);
  // BUILD-95 §5B — which surface this editor is arranging. ONE editor; the
  // surface decides which widgets the palette offers and nothing else.
  // BUILD-95 §5B — ONE editor, two surfaces. `?page=gp_…` arranges a giving
  // page; no parameter arranges the org's portal page. The route SHAPES are
  // identical (GET base · PUT base/draft · POST base/publish · base/revert),
  // so the surface is a base path and a filter, not a second editor.
  // VOL-PAGE-1: a giving_pages row may be a volunteer page; the server says
  // which surface it is, and with it which widgets the palette may offer.
  const surface = isOrgForm ? "orgform" : givingPageId ? (meta?.surface || "give") : "portal";
  const isVolunteer = surface === "volunteer";
  const apiBase = isOrgForm ? "/org-form/page" : givingPageId ? `/giving-pages/${givingPageId}/page` : "/portal-page";
  const [formPosition, setFormPosition] = useState("top");
  const [selected, setSelected] = useState(null);
  const [saveState, setSaveState] = useState("idle"); // idle|dirty|saving|saved|error
  const [publishing, setPublishing] = useState(false);
  const [err, setErr] = useState("");
  const [designNote, setDesignNote] = useState("");   // server's adjusted-color message
  const [dragId, setDragId] = useState(null);
  const editSeq = useRef(0);
  const saveTimer = useRef(null);
  const psSeq = useRef(0);        // Design-mode race guard (mirrors editSeq)
  const psSaveTimer = useRef(null);
  const psRef = useRef(null);     // latest ps, updated synchronously on edit
  const dsSeq = useRef(0);        // GIVE-EDIT-1: settings race guard (mirrors editSeq)
  const dsTimer = useRef(null);
  const dsRef = useRef(null);

  const applyPs = useCallback((next) => { psRef.current = next; setPs(next); }, []);
  // GIVE-3 — the giving page's own payload for the draft, from the same builder
  // as the public page; re-read after every save so the server's word (smart
  // amounts, adjusted colours, the goal bar) is what the preview draws.
  const [pv, setPv] = useState(null);
  // POLISH-3: the org's own Donation form previews through its own payload too.
  const loadPreview = useCallback(() => {
    if (isOrgForm) { apiFetch("/org-form/page/preview").then(d => { if (d && d.org) setPv(d); }).catch(() => {}); return; }
    if (!givingPageId) return;
    apiFetch(`/giving-pages/${givingPageId}/page/preview`).then(d => { if (d && d.givingPage) setPv(d); }).catch(() => {});
  }, [givingPageId, isOrgForm]);

  useEffect(() => {
    apiFetch(apiBase).then(d => {
      setMeta(d); setWidgets(Array.isArray(d.draft) ? d.draft : []); if (d.formPosition) setFormPosition(d.formPosition);
      const s0 = d.draftSettings || d.settings || null;
      dsRef.current = s0; setDs(s0);
      // A volunteer page keeps the phone first.
      if (d.surface === "volunteer") setDevice("phone");
      // The preview draws the real programme (org content, never a person's data).
      if (d.surface === "volunteer" && givingPageId) {
        apiFetch(`/giving-pages/${givingPageId}/volunteer-data`).then(setVolData).catch(() => setVolData({}));
      }
    }).catch(e => setErr(errorMessage(e)));
    apiFetch("/portal-settings").then(d => { psRef.current = d; setPs(d); }).catch(() => {});
    loadPreview();
    apiFetch("/finance/funds").then(f => setFunds(Array.isArray(f) ? f : [])).catch(() => {});
    apiFetch("/fundraising/campaigns").then(c => setCamps(Array.isArray(c) ? c : [])).catch(() => {});
    // Org content, not donor data: published impact updates render for real in
    // the impact widget so the org sees what donors see (BUILD-55 fix 12).
    apiFetch("/impact-updates").then(rows => {
      const pub = (Array.isArray(rows) ? rows : []).filter(u => u.status === "published")
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 6)
        .map(u => ({ id: u.id, title: u.title, body: u.body, photos: Array.isArray(u.photos) ? u.photos : [], date: u.created_at }));
      setImpactUpdates(pub);
    }).catch(() => {});
  }, []);

  // ── Design mode: appearance/content settings, saved via PUT /portal-settings
  // with the same debounced-autosave chrome as the widget draft. Images ride
  // logoData/headerImageData as data URIs when replaced, echo the stored URL
  // otherwise, "" to clear. enabled/network_listed/directory fields are
  // deliberately NOT here — status/listing stays CRM-side (DonorPortalHub).
  const designPayload = (p) => ({
    displayName: p.display_name || "",
    contactEmail: p.contact_email || "",
    footerText: p.footer_text || "",
    einLine: p.ein_line || "",
    minRecurringCents: Number(p.min_recurring_cents) || 500,
    primaryColor: p.primary_color || "",
    accentColor: p.accent_color || "",
    backgroundTint: p.background_tint || "",
    buttonColor: p.button_color || "",
    typePairing: p.type_pairing || "",
    cardStyle: p.card_style || "",
    poweredBy: p.powered_by === true,
    logoData: p.logo_data || p.logo_url || "",
    headerImageData: p.header_image_data || p.header_image_url || "",
    headerFocalX: Number(p.header_focal_x ?? 0.5),
    headerFocalY: Number(p.header_focal_y ?? 0.5),
    // BUILD-61 — the non-destructive crop rect (object or JSON string or null).
    headerCrop: p.header_crop == null ? null : (typeof p.header_crop === "string" ? p.header_crop : p.header_crop),
  });
  const scheduleDesignSave = useCallback((next) => {
    setSaveState("dirty");
    if (psSaveTimer.current) clearTimeout(psSaveTimer.current);
    const seq = ++psSeq.current;
    psSaveTimer.current = setTimeout(async () => {
      setSaveState("saving"); setErr("");
      try {
        const r = await apiFetch("/portal-settings", { method: "PUT", body: JSON.stringify(designPayload(next)) });
        // Adopt the server's canonical row (normalized colors, data URIs →
        // asset URLs) ONLY if nothing changed while the request was in flight.
        if (seq === psSeq.current) {
          const { adjusted, message, ...row } = r;
          psRef.current = row; setPs(row);
          setDesignNote(adjusted ? (message || "Adjusted slightly for legibility.") : "");
          setSaveState("saved");
          loadPreview();
        }
      } catch (e) { setErr(errorMessage(e, "Could not save the design.")); setSaveState("error"); }
    }, 1200);
  }, [loadPreview]);
  const setDesign = (k, v) => {
    const next = { ...(psRef.current || {}), [k]: v };
    applyPs(next);
    scheduleDesignSave(next);
  };

  // `pos` rides the same debounce as the widgets: the form's side of the page
  // is part of the layout, not a second thing to save.
  const scheduleSave = useCallback((next, pos) => {
    setSaveState("dirty");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const seq = ++editSeq.current;
    saveTimer.current = setTimeout(async () => {
      setSaveState("saving"); setErr("");
      try {
        const r = await apiFetch(apiBase + "/draft", { method: "PUT", body: JSON.stringify({ widgets: next, formPosition: pos ?? formPosition }) });
        // Adopt the server's canonical draft (data-URI images became asset
        // paths) ONLY if nothing changed while the request was in flight.
        if (seq === editSeq.current) { setWidgets(r.draft); setSaveState("saved"); loadPreview(); }
      } catch (e) { setErr(errorMessage(e, "Could not save the draft.")); setSaveState("error"); }
    }, 1200);
  }, [apiBase, formPosition, loadPreview]);

  // GIVE-EDIT-1 — the Details rail's draft, saved like the widgets: debounced,
  // and the server's answer adopted only if nothing changed in flight.
  const saveSettingsNow = useCallback(async (next) => {
    const seq = ++dsSeq.current;
    setDsSave("saving");
    const { imageData, ...rest } = next || {};
    const body = { settings: imageData ? { ...rest, imageData } : rest };
    try {
      const r = await apiFetch(apiBase + "/settings", { method: "PUT", body: JSON.stringify(body) });
      if (seq === dsSeq.current) {
        if (r && r.draftSettings) { dsRef.current = r.draftSettings; setDs(r.draftSettings); }
        setMeta(m => m ? { ...m, draftSettings: r?.draftSettings || m.draftSettings } : m);
        setDsErrors([]); setDsSave("saved");
        loadPreview();
      }
      return true;
    } catch (e) {
      if (seq === dsSeq.current) {
        const errs = Array.isArray(e?.body?.errors) ? e.body.errors : Array.isArray(e?.data?.errors) ? e.data.errors : Array.isArray(e?.errors) ? e.errors : [];
        setDsErrors(errs.length ? errs : [{ field: "", message: errorMessage(e, "Could not save the draft.") }]);
        setDsSave("error");
      }
      return false;
    }
  }, [apiBase, loadPreview]);
  const scheduleSettingsSave = useCallback((next) => {
    setDsSave("dirty");
    if (dsTimer.current) clearTimeout(dsTimer.current);
    dsTimer.current = setTimeout(() => { dsTimer.current = null; saveSettingsNow(next); }, 900);
  }, [saveSettingsNow]);
  const setSetting = (k, v) => {
    const next = { ...(dsRef.current || {}), [k]: v };
    if (v === undefined) delete next[k];
    dsRef.current = next; setDs(next); scheduleSettingsSave(next);
  };
  // FIX-41: the cover is two settings saved together (its path and its words/focus).
  const setSettings = (patch) => {
    const next = { ...(dsRef.current || {}), ...patch };
    dsRef.current = next; setDs(next); scheduleSettingsSave(next);
  };
  const setFormSetting = (patch) => {
    const cur = dsRef.current || {};
    const next = { ...cur, form: { ...(cur.form || {}), ...patch } };
    dsRef.current = next; setDs(next); scheduleSettingsSave(next);
  };
  const reloadMeta = async () => {
    const d = await apiFetch(apiBase);
    setMeta(d); setWidgets(Array.isArray(d.draft) ? d.draft : []);
    if (d.formPosition) setFormPosition(d.formPosition);
    const s0 = d.draftSettings || d.settings || null;
    dsRef.current = s0; setDs(s0); setDsErrors([]);
    loadPreview();
    return d;
  };

  const update = (next) => { setWidgets(next); scheduleSave(next); };
  const updateWidget = (id, patch) => update(widgets.map(w => w.id === id ? { ...w, ...patch } : w));
  const removeWidget = (id) => { update(widgets.filter(w => w.id !== id)); if (selected === id) setSelected(null); };
  const move = (id, dir) => {
    const i = widgets.findIndex(w => w.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= widgets.length) return;
    const next = widgets.slice();
    [next[i], next[j]] = [next[j], next[i]];
    update(next);
  };
  // EDITOR-1: a block lands where its "+" was pressed (else at the end), and
  // a duplicate lands under the one it copies.
  const addWidget = async (type, afterId = null) => {
    const w = { ...defaultWidget(type), id: "new_" + Math.random().toString(36).slice(2, 10) };
    // Part 3: a new photo block starts with one of Steward's photos, never an empty box.
    if ((type === "hero" || type === "image") && !w.image) { const p = await stockPhotoForBlock(); if (p) { w.image = p.src; w.alt = p.alt; } }
    const at = afterId ? widgets.findIndex(x => x.id === afterId) + 1 : widgets.length;
    const next = widgets.slice(); next.splice(at > 0 ? at : widgets.length, 0, w);
    update(next);
    setSelected(w.id); setAddAfter(null);
    askSection("block");
  };
  const duplicateWidget = (id) => {
    const i = widgets.findIndex(w => w.id === id);
    if (i < 0) return;
    const copy = { ...JSON.parse(JSON.stringify(widgets[i])), id: "new_" + Math.random().toString(36).slice(2, 10) };
    const next = widgets.slice(); next.splice(i + 1, 0, copy);
    update(next); setSelected(copy.id);
  };
  // Drag reorder — BUILD-34's midpoint rule.
  const onDragOverWidget = (e, overId) => {
    e.preventDefault();
    if (!dragId || dragId === overId) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    const from = widgets.findIndex(w => w.id === dragId);
    let to = widgets.findIndex(w => w.id === overId) + (before ? 0 : 1);
    if (from < 0 || to < 0) return;
    if (from < to) to--;
    if (from === to) return;
    const next = widgets.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setWidgets(next);   // save on drop
  };

  const publish = async () => {
    if (publishing) return;
    if (!(await askConfirm({ title: "Publish this page?", body: isVolunteer ? "Anyone with the link will see it immediately." : "Donors will see it immediately.", yes: "Publish" }))) return;
    setPublishing(true); setErr("");
    try {
      if (saveTimer.current) { clearTimeout(saveTimer.current); }
      // GIVE-EDIT-1 — a pending Details edit is saved first, so Publish
      // publishes what is on screen.
      if (dsTimer.current) { clearTimeout(dsTimer.current); dsTimer.current = null; if (!(await saveSettingsNow(dsRef.current))) throw new Error("Fix the notes in Details, then publish."); }
      if (!isOrgForm && (widgets.length || Array.isArray(meta?.draft))) {
        const seq = ++editSeq.current;
        const r = await apiFetch(apiBase + "/draft", { method: "PUT", body: JSON.stringify({ widgets, formPosition }) });
        if (seq === editSeq.current) setWidgets(r.draft);
      }
      await apiFetch(apiBase + "/publish", { method: "POST", body: "{}" });
      await reloadMeta();
      setSaveState("saved"); setDsSave("idle");
    } catch (e) { setErr(errorMessage(e, "Publish failed.")); }
    setPublishing(false);
  };
  const revert = async () => {
    if (!(await askConfirm({ title: "Discard the draft?", body: "The page goes back to the last published version.", yes: "Discard draft", danger: true }))) return;
    try {
      if (dsTimer.current) { clearTimeout(dsTimer.current); dsTimer.current = null; }
      await apiFetch(apiBase + "/revert", { method: "POST", body: "{}" });
      await reloadMeta();
      setSelected(null); setSaveState("saved"); setDsSave("idle");
    } catch (e) { setErr(errorMessage(e, "Revert failed.")); }
  };
  const applyStarter = async (key) => {
    try {
      const r = await apiFetch(apiBase + "/starter", { method: "POST", body: JSON.stringify({ key }) });
      setWidgets(r.draft); setSaveState("saved");
    } catch (e) { setErr(errorMessage(e, "Could not apply the starter.")); }
  };

  // What the preview draws this instant: the server's payload with the fields
  // being typed laid over it, so a keystroke shows before its save lands.
  const livePayload = useMemo(() => overlayPreview(pv, ds, ps, widgets, isOrgForm), [pv, ds, ps, widgets, isOrgForm]);
  // A click on a part of the preview opens the rail section that sets it.
  // The headline and the story are typed where they show, so they ask nothing.
  const pickField = useCallback((field) => {
    const to = { header: "design", photo: "cover", amounts: "gift", goal: "goal", trust: "trust", ways: "ways", blocks: "blocks" }[field];
    if (to) askSection(to);
  }, [askSection]);

  if (err && widgets === null) {
    return <div style={{ padding: 40, fontFamily: "system-ui" }}>
      <p>{err}</p>
      <a href={backHref} style={{ color: E.green }}>{hasBack ? "← Back" : "← Back to Steward"}</a>
    </div>;
  }
  if (widgets === null || !ps) return <div style={{ padding: 40, fontFamily: "system-ui", color: E.muted }}>Loading the editor…</div>;

  const themeVars = varsForPs(ps);
  const selectedWidget = widgets.find(w => w.id === selected) || null;
  const publicPreviewCtx = {
    giveSlug: ps.org_slug, me: SAMPLE_ME,
    renderMyGiving: () => <SampleMyGiving />,
  };
  // Resolve display-only data the server resolves for the live page.
  const resolvedWidgets = widgets.map(w => {
    // Funds render in the WIDGET's order (fundIds is the manual sort — the
    // org decides what leads), never the fund list's own order (BUILD-55).
    if (w.type === "funds") return { ...w, funds: (w.fundIds || []).map(id => funds.find(f => f.id === id)).filter(Boolean).map(f => ({ id: f.id, name: f.name, description: f.description || null })) };
    if (w.type === "campaign") {
      const c = camps.find(x => x.id === w.campaignId);
      return { ...w, campaign: c ? {
        id: c.id, name: c.donorFacingName || c.name, description: c.donorDescription || null,
        story: c.donorStory || null, heroImage: c.heroImageUrl || null,
        goal: c.goalProgressPublic ? { amount: c.goalAmount, raised: c.raised, percent: c.goalAmount > 0 ? Math.min(100, Math.round((c.raised / c.goalAmount) * 100)) : null } : null,
      } : null };
    }
    if (w.type === "impact") return { ...w, updates: impactUpdates.length ? impactUpdates : SAMPLE_IMPACT };
    return w;
  });

  // ── EDITOR-1 · THE PREVIEW IS WHERE IT IS EDITED ─────────────────────────
  // One shell (StewardEditor): the settings in the left rail, the page in the
  // middle at one width at a time, History on the right when it is open. A
  // block shows its handles when the pointer is on it (move up, move down,
  // duplicate, remove, and a "+" under it to add one there); a text block is
  // typed in where it shows once it is picked; the headline and the story of
  // a giving page are typed in the page; the photo is clicked for its focus.
  const typeLabel = isVolunteer ? "Volunteer page" : surface === "give" ? "Giving page" : surface === "orgform" ? "Donation form" : "Portal";
  const libraryTypes = (Array.isArray(meta?.widgetTypes) && givingPageId ? meta.widgetTypes : widgetTypesHere(surface)).filter(t => WIDGET_META[t]);
  const blockMenu = (afterId) => (
    <div className="se-menu" data-editor-only="" data-testid="editor-block-menu" onClick={e => e.stopPropagation()}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "2px 4px 6px" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: E.body }}>Add a block here</span>
        <button type="button" onClick={() => setAddAfter(null)} aria-label="Close" style={{ background: "none", border: "none", cursor: "pointer", color: E.muted, fontSize: 13 }}>✕</button>
      </div>
      {libraryTypes.map(t => (
        <button key={t} type="button" data-testid={"add-block-" + t} onClick={() => addWidget(t, afterId)}
          style={{ display: "block", width: "100%", textAlign: "left", background: E.white, border: "1px solid " + E.editLine, borderRadius: 8, padding: "7px 10px", marginBottom: 4, cursor: "pointer", fontFamily: "inherit" }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: E.body }}>{WIDGET_META[t].label}</span>
          <span style={{ display: "block", fontSize: 11.5, color: E.muted }}>{WIDGET_META[t].hint}</span>
        </button>
      ))}
    </div>
  );
  const inPlace = (w) => {
    if (w.type === "richtext") return (
      <div style={{ fontFamily: "var(--pt-sans, inherit)", fontSize: 16, lineHeight: 1.6, color: E.body, padding: "6px 4px" }}>
        <InlineText as="div" multiline field="richtext" testid="inline-richtext" value={storyToText(w.blocks)} label="The block's words"
          placeholder="Write something in your own words." onChange={t => updateWidget(w.id, { blocks: textToStory(t) })} />
        <div style={{ fontSize: 11.5, color: E.muted, marginTop: 6 }}>A blank line starts a new paragraph, "## " a heading, "- " a list.</div>
      </div>
    );
    if (w.type === "quote") return (
      <div style={{ padding: "8px 4px", fontFamily: "var(--pt-serif, Georgia, serif)", fontSize: 19, lineHeight: 1.5, color: E.body }}>
        <InlineText as="div" multiline field="quote" testid="inline-quote" value={w.text || ""} label="The quote" placeholder="The words" onChange={t => updateWidget(w.id, { text: t })} />
        <InlineText as="div" field="attribution" value={w.attribution || ""} label="Who said it" placeholder="Who said it"
          style={{ fontFamily: "var(--pt-sans, inherit)", fontSize: 13, color: E.muted, marginTop: 6 }} onChange={t => updateWidget(w.id, { attribution: t })} />
      </div>
    );
    return null;
  };
  const decorateWidget = (w, node) => {
    const on = selected === w.id;
    const typed = on ? inPlace(w) : null;
    return (
      <div className={"se-block" + (on ? " se-on" : "")} data-testid="editor-block" data-block-type={w.type} tabIndex={0} data-editor-wrap=""
        draggable={!typed}
        onDragStart={() => setDragId(w.id)}
        onDragEnd={() => { setDragId(null); scheduleSave(widgets); }}
        onDragOver={e => onDragOverWidget(e, w.id)}
        onClick={() => { if (!on) { setSelected(w.id); askSection("block"); } }}
        onKeyDown={e => { if (e.key === "Enter" && e.target === e.currentTarget) { setSelected(w.id); askSection("block"); } }}
        onDrop={["hero", "image"].includes(w.type) ? (e) => {
          // §4 — in-place image drop: a photo dropped ON the hero IS the hero.
          e.preventDefault(); e.stopPropagation();
          readImageFile(e.dataTransfer?.files?.[0], dataUrl => updateWidget(w.id, { image: dataUrl }));
        } : undefined}>
        <div className="se-handles" data-editor-only="" onClick={e => e.stopPropagation()}>
          <span className="se-tag">{WIDGET_META[w.type]?.label}</span>
          <button type="button" aria-label="Move up" onClick={() => move(w.id, -1)}>↑</button>
          <button type="button" aria-label="Move down" onClick={() => move(w.id, +1)}>↓</button>
          <button type="button" aria-label="Duplicate block" data-testid="block-duplicate" onClick={() => duplicateWidget(w.id)}>Duplicate</button>
          <button type="button" aria-label="Remove widget" data-testid="block-remove" onClick={() => removeWidget(w.id)}>✕</button>
        </div>
        {typed || <div data-editor-node="" style={{ pointerEvents: "none" }}>{node}</div>}
        <button type="button" className="se-add" data-editor-only="" aria-label="Add a block here" data-testid="block-add-here" onClick={e => { e.stopPropagation(); setAddAfter(a => a === w.id ? null : w.id); }}>+</button>
        {addAfter === w.id && blockMenu(w.id)}
      </div>
    );
  };
  const blockCss = `
.se-block{position:relative;border-radius:8px;outline:1px dashed transparent;outline-offset:3px;cursor:grab;margin-bottom:6px}
.se-block:hover,.se-block:focus-visible{outline-color:${E.gold}}
.se-block.se-on{outline:2px solid ${E.gold};cursor:default}
.se-handles{position:absolute;top:-13px;right:6px;z-index:6;display:flex;gap:4px;opacity:0;transition:opacity .12s}
.se-block:hover>.se-handles,.se-block.se-on>.se-handles,.se-block:focus-within>.se-handles{opacity:1}
.se-handles button,.se-tag{background:${E.ink};color:${E.cream};border:none;border-radius:6px;height:22px;min-width:24px;font-size:11px;font-weight:700;cursor:pointer;padding:0 7px;font-family:'DM Sans',system-ui,sans-serif;line-height:22px}
.se-tag{cursor:default}
.se-block>[data-editor-node]:empty{min-height:44px;border:1px dashed ${E.bg3};border-radius:8px}
.se-block>[data-editor-node]:empty::after{content:"Empty block: click it to type, or remove it";display:block;padding:12px 14px;font-size:13px;color:${E.muted};font-family:'DM Sans',system-ui,sans-serif}
.se-add{position:absolute;left:50%;bottom:-14px;transform:translateX(-50%);z-index:6;width:26px;height:26px;border-radius:50%;border:none;background:${E.green};color:${E.white};font-size:17px;line-height:26px;cursor:pointer;opacity:0;padding:0}
.se-block:hover>.se-add,.se-block:focus-within>.se-add{opacity:1}
.se-menu{position:absolute;left:50%;transform:translateX(-50%);top:calc(100% + 16px);z-index:9;background:${E.white};border:1px solid ${E.bg3};border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.18);padding:8px;width:260px;max-height:320px;overflow:auto;cursor:default}
.se-photo-tools{opacity:.0;transition:opacity .12s}
[data-edit="photo"]:hover .se-photo-tools,.se-photo-tools:focus-within{opacity:1}
${INLINE_CSS}`;

  const pageHeader = (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 18px" }}>
      {(ps.logo_data || ps.logo_url) && (
        <img src={ps.logo_data || resolveAssetUrl(ps.logo_url)} alt="" style={{ height: 28, maxWidth: 90, objectFit: "contain" }} />
      )}
      <div style={{ fontFamily: "var(--pt-serif,Georgia,serif)", fontSize: 22 }}>{surface !== "portal" ? (meta?.pageTitle || (isVolunteer ? "Your volunteer page" : "Your giving page")) : (ps.display_name || "Your portal")}</div>
    </div>
  );
  const starterList = (meta?.starters || []).length > 0 && (
    <div data-testid="editor-starters">
      <div style={{ fontSize: 12, color: E.muted, lineHeight: 1.5, marginBottom: 8 }}>Pick a starting point. Everything stays editable, and nothing is visible to {isVolunteer ? "anyone" : "donors"} until you publish.</div>
      {(meta?.starters || []).map(s => (
        <button key={s.key} type="button" onClick={() => applyStarter(s.key)}
          style={{ display: "block", width: "100%", textAlign: "left", background: E.white, border: "1px solid " + E.hair, borderRadius: 10, padding: "10px 12px", marginBottom: 6, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
          {s.label}
        </button>
      ))}
    </div>
  );
  // A page with no blocks yet: one "+" opens the same menu every block's "+" does.
  const addBlockRow = (
    <div data-editor-only="" style={{ position: "relative", margin: "14px 0 6px", textAlign: "center" }}>
      <button type="button" data-testid="editor-add-block" onClick={() => setAddAfter(a => a === "__end" ? null : "__end")}
        style={{ background: "transparent", border: "1px dashed " + E.bg3, borderRadius: 10, padding: "9px 16px", fontSize: 13, fontWeight: 600, color: E.body, cursor: "pointer", fontFamily: "inherit", width: "100%" }}>
        + Add a block
      </button>
      {addAfter === "__end" && blockMenu(null)}
    </div>
  );
  const pageBody = surface === "orgform" ? null : (
    <>
      {isVolunteer ? (
        <VolunteerProvider data={volData || {}} orgSlug={ps.org_slug} pageSlug={meta?.pageSlug} preview
          hasGroup={widgets.some(w => w.type === "groupsignup")}>
          <PageRenderer page={{ widgets: resolvedWidgets, giveSlug: ps.org_slug }} ctx={{ ...publicPreviewCtx, volData: volData || {} }} decorate={decorateWidget} />
        </VolunteerProvider>
      ) : (
        <PageRenderer page={{ widgets: resolvedWidgets, giveSlug: ps.org_slug }} ctx={publicPreviewCtx} decorate={decorateWidget} />
      )}
      {addBlockRow}
    </>
  );

  // The giving page's photo, worked on where it shows.
  const cover = ds && ds.imageUrl ? { url: ds.imageUrl, ...(ds.imageMeta || {}) } : null;
  const setCover = p => setSettings(p ? { imageUrl: p.url, imageMeta: { alt: p.alt || "", fx: p.fx ?? 0.5, fy: p.fy ?? 0.5, ...(p.stock ? { stock: true } : {}) } }
    : { imageUrl: "", imageMeta: { alt: "", fx: 0.5, fy: 0.5 } });
  const choosePhoto = (onPick) => { if (LazyStockPicker) setStockOpen({ onPick }); else askSection("cover"); };
  const photoTools = (has) => (
    <PhotoTools has={has && !!cover} focus={cover ? { fx: Number(cover.fx ?? 0.5), fy: Number(cover.fy ?? 0.5) } : null}
      onFocus={(fx, fy) => setSettings({ imageMeta: { ...(ds.imageMeta || {}), fx, fy } })}
      onReplace={() => choosePhoto(setCover)} onRemove={() => setCover(null)} />
  );
  const heroWidget = widgets.find(w => w.type === "hero") || null;
  const onPreviewText = (field, t) => {
    if (field === "headline") { if (heroWidget) updateWidget(heroWidget.id, { heading: t }); else setSetting("title", t); }
    if (field === "story") setSetting("story", t);
  };

  // GIVE-3 — a giving page's preview is the page: Donate.jsx from the draft's payload.
  const useRealPage = (surface === "give" || surface === "orgform") && !!livePayload;
  const realPage = useRealPage ? (
    <div data-testid="real-preview">
      <Donate preview={{ payload: livePayload, orgSlug: ps.org_slug, pageSlug: meta?.pageSlug, onPick: pickField,
        ...(surface === "give" ? { onText: onPreviewText, photoTools, decorate: decorateWidget, afterBlocks: addBlockRow } : {}) }} />
    </div>
  ) : null;
  const canvasInner = useRealPage
    ? (device === "desktop" && !narrow ? <ScaledDesktop>{realPage}</ScaledDesktop> : realPage)
    : (
      <div className={device === "desktop" ? "pe-desktop" : ""} style={{ ...themeVars, background: "var(--pt-bg," + E.paper + ")", flex: 1 }}>
        <div className={device === "desktop" ? "pe-wrap" : ""} style={{ color: E.body, fontFamily: "var(--pt-sans)", padding: device === "desktop" ? undefined : "18px 20px 60px" }}>
          {pageHeader}
          {pageBody}
        </div>
      </div>
    );

  // ── The rail ──────────────────────────────────────────────────────────────
  const at = id => (focusAsk.id === id ? focusAsk.n : 0);
  const sections = [];
  if (selectedWidget) sections.push(
    <RailSection key={"block-" + selectedWidget.id} id="block" testid="rail-block" title={"This block: " + (WIDGET_META[selectedWidget.type]?.label || "Block")} focus={at("block")}>
      <WidgetOptions w={selectedWidget} funds={funds} camps={camps} volData={volData}
        onChange={patch => updateWidget(selectedWidget.id, patch)}
        onClose={() => setSelected(null)} />
    </RailSection>
  );
  if (surface === "give" && ds) sections.push(...giftSections({ ds, onSet: setSetting, onSetForm: setFormSetting, errors: dsErrors, saveState: dsSave, at,
    funds: Array.isArray(meta?.funds) && meta.funds.length ? meta.funds : funds, camps: Array.isArray(meta?.campaigns) && meta.campaigns.length ? meta.campaigns : camps,
    facts: (livePayload && livePayload.org && livePayload.org.facts) || {}, formPosition,
    onFormPosition: v => { setFormPosition(v); scheduleSave(widgets, v); },
    coverSection: (
      <RailSection key="cover" id="cover" testid="rail-cover" title="Cover photo" focus={at("cover")}>
        <RailPhoto value={cover} name={ds.title || meta?.pageTitle || ""} testid="editor-cover-photo" onChange={setCover}
          onLibrary={LazyStockPicker ? () => choosePhoto(setCover) : undefined} />
      </RailSection>
    ) }));
  if (surface === "orgform" && ds) sections.push(
    <RailSection key="details" id="details" title="Details" focus={at("details")}><OrgFormRail ds={ds} onSet={setSetting} errors={dsErrors} saveState={dsSave} /></RailSection>
  );
  if (isVolunteer && ds) sections.push(
    <RailSection key="cover" id="cover" testid="rail-cover" title="Cover photo" focus={at("cover")}>
      <RailPhoto value={cover} name={ds.title || meta?.pageTitle || ""} testid="editor-cover-photo" onChange={setCover}
        onLibrary={LazyStockPicker ? () => choosePhoto(setCover) : undefined} />
    </RailSection>
  );
  if (surface !== "orgform") sections.push(
    <RailSection key="blocks" id="blocks" title="Blocks" focus={at("blocks")} defaultOpen={widgets.length === 0}
      hint={widgets.length ? "Point at a block in the preview for its handles. The + under a block adds one there." : null}>
      {widgets.length === 0 && starterList}
      <div style={{ fontSize: 11, fontWeight: 700, color: E.muted, textTransform: "uppercase", letterSpacing: "0.06em", margin: "10px 0 6px" }}>Add a block at the end</div>
      {libraryTypes.map(type => (
        <button key={type} type="button" onClick={() => addWidget(type)}
          style={{ display: "block", width: "100%", textAlign: "left", background: E.white, border: "1px solid " + E.editLine, borderRadius: 10, padding: "8px 12px", marginBottom: 6, cursor: "pointer", fontFamily: "inherit" }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{WIDGET_META[type].label}</div>
          <div style={{ fontSize: 11.5, color: E.muted }}>{WIDGET_META[type].hint}</div>
        </button>
      ))}
    </RailSection>
  );
  sections.push(
    <RailSection key="design" id="design" title="Design" focus={at("design")} defaultOpen={surface === "portal"}
      hint="Your brand: the same logo, colors and type on every page and email. Changes autosave and show in the preview.">
      <DesignRail ps={ps} onSet={setDesign} note={designNote} />
    </RailSection>
  );

  const status = saveState === "saving" || dsSave === "saving" ? "Saving draft…" : saveState === "dirty" || dsSave === "dirty" ? "Unsaved edits…"
    : saveState === "error" || dsSave === "error" ? "Save failed" : meta?.publishedAt ? "Draft autosaves · publish when ready" : "Draft autosaves";
  return (
    <div style={{ height: "100vh" }}>
      <style>{`
        .pe-wrap { max-width: 860px; margin: 0 auto; padding: 18px 20px 64px; }
        @media (min-width: 1280px) {
          .pe-wrap { max-width: 1140px; }
          .pe-desktop .pt-widgets { display: grid; grid-template-columns: 1fr 1fr; gap: 0 18px; align-items: start; }
          .pe-desktop .pt-widgets > * { min-width: 0; }
        }
        @media (min-width: 1720px) { .pe-wrap { max-width: 1360px; } }
      `}</style>
      <style>{blockCss}</style>
      <StewardEditor kind={surface} testid="portal-editor"
        back={{ href: backHref, label: hasBack ? "Back" : "Steward" }}
        name={surface === "portal" ? "Portal editor" : (meta?.pageTitle || typeLabel)}
        badge={surface === "portal" ? "SAMPLE DONOR DATA" : typeLabel}
        device={device} onDevice={setDevice} status={status}
        actions={[
          isPageEditor && { id: "history", label: "History", active: historyOpen, onClick: () => { setHistoryOpen(o => !o); } },
          (meta?.publishedAt || meta?.draftSettings) && { id: "revert", label: "Revert to published", onClick: revert },
        ]}
        primary={{ label: publishing ? "Publishing…" : "Publish", onClick: publish, disabled: publishing, testid: "editor-publish" }}
        notice={err ? <div style={{ background: E.terra100, color: E.terra, fontSize: 13, padding: "8px 16px" }}>{err}</div> : null}
        left={<div data-testid={surface === "give" || surface === "orgform" ? "details-rail" : "editor-rail"}>{sections}</div>}
        right={historyOpen && isPageEditor ? <div style={{ padding: "16px 16px 40px" }}><HistoryPanel apiBase={apiBase} onClose={() => setHistoryOpen(false)} onRestored={reloadMeta} /></div> : null}
        rightTitle="History">
        <DeviceFrame device={device} narrow={narrow}
          label={device === "phone" ? (isVolunteer ? "Phone · 390px, how people arriving from a flyer or a text see it" : "Phone · 390px, how donors arriving from email see it") : null}>
          {canvasInner}
        </DeviceFrame>
      </StewardEditor>
      {stockOpen && LazyStockPicker && (
        <Suspense fallback={null}>
          <LazyStockPicker onClose={() => setStockOpen(null)} onPick={p => { const f = stockOpen.onPick; setStockOpen(null); f(p); }} />
        </Suspense>
      )}
    </div>
  );
}

// ── Design mode rail — the portal's appearance + page details, moved here
// from the old Settings PortalManager form (edit what you see, where you see
// it). Saves ride the debounced PUT /portal-settings autosave in the parent.
// Status/listing fields (enabled, network_listed, directory card) are NOT
// here — they live on the CRM's Donor Portal tab.
function DesignRail({ ps, onSet, note }) {
  const group = (label) => (
    <div style={{ fontSize: 12, fontWeight: 700, color: E.body, textTransform: "uppercase", letterSpacing: "0.08em", margin: "18px 0 2px", borderTop: "1px solid "+E.editLine, paddingTop: 14 }}>{label}</div>
  );
  const colorField = (label, key, fallback, { clearable = false, hint = null, placeholder = "" } = {}) => (
    <>
      <div style={lbl}>{label}</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="color" value={ps[key] || fallback} onChange={e => onSet(key, e.target.value)}
          style={{ width: 34, height: 34, border: "1px solid " + E.bg3, borderRadius: 8, background: "none", padding: 2, cursor: "pointer" }} />
        <input style={{ ...inp, width: 104, fontFamily: "monospace" }} value={ps[key] || ""} placeholder={placeholder || fallback}
          onChange={e => onSet(key, e.target.value)} />
        {clearable && ps[key] && (
          <button onClick={() => onSet(key, "")} style={{ background: "none", border: "none", color: E.muted, fontSize: 12, cursor: "pointer" }}>Clear</button>
        )}
      </div>
      {hint && <div style={{ fontSize: 11, color: E.muted, marginTop: 4, lineHeight: 1.4 }}>{hint}</div>}
    </>
  );
  const logoSrc = ps.logo_data || resolveAssetUrl(ps.logo_url);
  const headerSrc = ps.header_image_data || resolveAssetUrl(ps.header_image_url);
  return (
    <>
      {note && <div style={{ fontSize: 12, color: E.green, fontWeight: 600, marginTop: 8, lineHeight: 1.4 }}>{note}</div>}

      {group("Identity")}
      <div style={lbl}>Display name</div>
      <input style={inp} value={ps.display_name || ""} placeholder="Your organization's public name"
        onChange={e => onSet("display_name", e.target.value)} />
      <div style={lbl}>Logo</div>
      <Uploader accept={IMAGE_ACCEPT} acceptLabel={IMAGE_ACCEPT_LABEL} maxBytes={IMAGE_MAX_BYTES} compact
        shape="square" preview={logoSrc || null}
        label={logoSrc ? "Replace logo" : "Drag your logo here, or browse"}
        onFile={({ dataUrl }) => onSet("logo_data", dataUrl)}
        onRemove={() => { onSet("logo_data", ""); onSet("logo_url", null); }} />
      <div style={lbl}>Header image (optional)</div>
      {/* The banner-shaped filled state IS the crop preview — what the org
          sees here is the exact wide crop donors get. */}
      <div data-field="header-image" />
      <Uploader accept={IMAGE_ACCEPT} acceptLabel={IMAGE_ACCEPT_LABEL} maxBytes={IMAGE_MAX_BYTES} compact
        shape="banner" preview={headerSrc || null}
        label={headerSrc ? "Replace image" : "Drag a header image here, or browse"}
        hint={IMAGE_ACCEPT_LABEL + " · landscape, around 1200×300 works best"}
        validate={({ file, dataUrl }) => file.type === "image/svg+xml" ? null : new Promise(resolve => {
          // Mirror of the server banner rule (landscape, >=600px wide) so a
          // portrait drop is explained BEFORE the round trip. UI courtesy
          // only — the server re-validates identically.
          const img = new Image();
          img.onload = () => resolve(img.height >= img.width ? "Header images render as a wide banner, use a landscape image (at least 1200×300 works well)." : (img.width < 600 ? "Header images need to be at least 600px wide." : null));
          img.onerror = () => resolve("That file doesn't parse as an image.");
          img.src = dataUrl;
        })}
        onFile={({ dataUrl }) => { onSet("header_image_data", dataUrl); onSet("header_focal_x", 0.5); onSet("header_focal_y", 0.5); onSet("header_crop", null); }}
        onRemove={() => { onSet("header_image_data", ""); onSet("header_image_url", null); onSet("header_crop", null); }} />
      {/* BUILD-61 — the CROP control: a fixed-ratio viewport IS the banner
          render (same ratio, object-fit math, scrim), with drag-to-move +
          zoom. Non-destructive: it emits a normalized rect against the
          original; Reset returns to the focal fallback. Preview == render by
          reuse (pinned by tests/portal-crop.test.js). */}
      {headerSrc && (
        <div style={{ marginTop: 8 }}>
          <PortalBannerCrop
            url={headerSrc}
            crop={(() => { const c = ps.header_crop; if (!c) return null; if (typeof c === "object") return c; try { return JSON.parse(c); } catch { return null; } })()}
            focal={{ x: ps.header_focal_x, y: ps.header_focal_y }}
            bandColor={ps.primary_color || E.preview}
            ratio={PORTAL_HEADER_RATIO}
            onChange={(c) => onSet("header_crop", c)}
          />
        </div>
      )}

      {group("Colors")}
      {colorField("Primary color", "primary_color", E.preview)}
      {colorField("Accent color", "accent_color", E.gold)}
      {colorField("Background tint (optional)", "background_tint", E.paper, { clearable: true, hint: "A soft page wash. Dark colors are lightened so text stays readable." })}
      {colorField("Button & link color (optional)", "button_color", ps.primary_color || E.preview, { clearable: true, hint: "Left empty, buttons use your primary color.", placeholder: "primary" })}

      {group("Type & cards")}
      <div style={lbl}>Type pairing</div>
      <select style={inp} value={ps.type_pairing || "dm"} onChange={e => onSet("type_pairing", e.target.value)}>
        {Object.entries(TYPE_PAIRINGS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
      </select>
      <div style={{ fontSize: 11, color: E.muted, marginTop: 4, lineHeight: 1.4 }}>A curated set, every pairing is pre-licensed and self-hosted, so your page stays fast.</div>
      <div style={lbl}>Card style</div>
      <select style={inp} value={ps.card_style || "rounded"} onChange={e => onSet("card_style", e.target.value)}>
        {Object.entries(CARD_STYLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
      </select>

      {group("Page details")}
      <div style={lbl}>Contact email (shown to donors)</div>
      <input style={inp} value={ps.contact_email || ""} placeholder="hello@yourorg.org" onChange={e => onSet("contact_email", e.target.value)} />
      <div style={lbl}>Footer text</div>
      <input style={inp} value={ps.footer_text || ""} placeholder="Your mission line or mailing address" onChange={e => onSet("footer_text", e.target.value)} />
      <div style={lbl}>EIN line (for receipts context)</div>
      <input style={inp} value={ps.ein_line || ""} placeholder="Tax ID (EIN): 12-3456789" onChange={e => onSet("ein_line", e.target.value)} />
      <div style={lbl}>Minimum recurring amount ($)</div>
      <input style={inp} inputMode="numeric" value={(Number(ps.min_recurring_cents) || 500) / 100}
        onChange={e => onSet("min_recurring_cents", Math.round((parseFloat(e.target.value) || 5) * 100))} />

      {group("Footer")}
      <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, color: E.body, cursor: "pointer", marginTop: 8, lineHeight: 1.5 }}>
        <input type="checkbox" checked={ps.powered_by === true} onChange={e => onSet("powered_by", e.target.checked)} style={{ marginTop: 2 }} />
        Show a small "Powered by Steward" line in the footer (off by default, the portal is yours)
      </label>
    </>
  );
}

function WidgetOptions({ w, funds, camps, volData, onChange, onClose }) {
  // EMAIL-1: the media library, shared with emails. `picker` is
  // { kind, onPick } while the picker is open; picking fills the widget with
  // the item's /portal-assets path (and its words where the widget has them),
  // which the draft route stores as it is. The upload beside it still works.
  const [picker, setPicker] = useState(null);
  const pickerModal = picker && (
    <MediaPicker kind={picker.kind} onClose={() => setPicker(null)}
      onPick={item => { setPicker(null); picker.onPick(item); }} />
  );
  const libraryBtn = (kind, onPick) => (
    <button type="button" data-testid="choose-from-library" onClick={() => setPicker({ kind, onPick })}
      style={{ ...btnQuiet, color: E.ink, borderColor: E.bg3, marginTop: 6, padding: "6px 12px", fontSize: 12 }}>
      Choose from your library
    </button>
  );
  const head = (<>{pickerModal}
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
      <div style={{ fontSize: 13, fontWeight: 700 }}>{WIDGET_META[w.type]?.label}</div>
      <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 13, cursor: "pointer", color: E.muted }}>Done ✕</button>
    </div></>
  );
  const imgUploader = (value, set, label = "Photo", onPickItem = null) => (
    <>
      <div style={lbl}>{label}</div>
      {/* FIX-41: the one picture control, as on the cover and every item. */}
      <PhotoField variant="cover" noAlt value={value || null} name={w.heading || w.caption || ""} testid="widget-photo"
        onChange={p => set(p ? p.url : null)} />
      {libraryBtn("photo", item => (onPickItem ? onPickItem(item) : set(item.url)))}
    </>
  );
  // The words a screen reader hears for the photo; filled from the library.
  const altField = () => (
    <><div style={lbl}>Describe the photo</div>
      <input style={inp} value={w.alt || ""} maxLength={300} placeholder="What the photo shows, in a few words"
        onChange={e => onChange({ alt: e.target.value })} /></>
  );
  // BUILD-65 Part 3 — the non-destructive crop for a widget image; same
  // PortalBannerCrop the banner uses, at the widget ratio, so preview==render.
  const imgCropper = (value, crop, setCrop) => value ? (
    <div style={{ marginTop: 8 }}>
      <PortalBannerCrop url={String(value).startsWith("data:") ? value : resolveAssetUrl(value)}
        crop={crop || null} ratio={PORTAL_WIDGET_IMAGE_RATIO} onChange={setCrop} />
    </div>
  ) : null;
  switch (w.type) {
    case "hero": return <>{head}
      <div style={lbl}>Heading</div><input style={inp} value={w.heading || ""} onChange={e => onChange({ heading: e.target.value })} />
      <div style={lbl}>Subheading</div><textarea style={{ ...inp, resize: "vertical" }} rows={2} value={w.sub || ""} onChange={e => onChange({ sub: e.target.value })} />
      <div style={lbl}>Size</div>
      <select style={inp} value={w.size || "standard"} onChange={e => onChange({ size: e.target.value })}>
        <option value="standard">Standard</option><option value="tall">Tall</option>
      </select>
      {imgUploader(w.image, v => onChange({ image: v, imageCrop: null }), "Photo", item => onChange({ image: item.url, imageCrop: null, alt: item.alt }))}
      {imgCropper(w.image, w.imageCrop, c => onChange({ imageCrop: c }))}
      {w.image && altField()}</>;
    // EDITOR-1: a text block's words are typed in the preview, where they show.
    case "richtext": return <>{head}
      <div style={{ fontSize: 12, color: E.muted, lineHeight: 1.5 }}>Type in the block in the preview. A blank line starts a new paragraph, "## " a heading, "- " a list.</div></>;
    case "image": return <>{head}
      {imgUploader(w.image, v => onChange({ image: v, imageCrop: null }), "Photo", item => onChange({ image: item.url, imageCrop: null, alt: item.alt }))}
      {imgCropper(w.image, w.imageCrop, c => onChange({ imageCrop: c }))}
      {w.image && altField()}
      <div style={lbl}>Caption</div><input style={inp} value={w.caption || ""} onChange={e => onChange({ caption: e.target.value })} /></>;
    case "gallery": return <>{head}
      <div style={lbl}>Photos</div>
      {/* Multi-photo site: the images array is not a single preview, so the
          thumbnail strip renders as children below the drop zone. */}
      <Uploader accept={IMAGE_ACCEPT} acceptLabel={IMAGE_ACCEPT_LABEL} maxBytes={IMAGE_MAX_BYTES} compact multiple
        label="Drag photos here, or browse"
        hint={"Up to 8 photos · " + IMAGE_ACCEPT_LABEL}
        disabled={(w.images || []).length >= 8}
        onFile={({ dataUrl }) => onChange({ images: [...(w.images || []), dataUrl].slice(0, 8) })}>
        {(w.images || []).length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            {(w.images || []).map((u, i) => (
              <div key={i} style={{ position: "relative" }}>
                <img src={String(u).startsWith("data:") ? u : resolveAssetUrl(u)} alt="" style={{ height: 48, borderRadius: 6 }} />
                <button onClick={() => onChange({ images: w.images.filter((_, j) => j !== i) })}
                  style={{ position: "absolute", top: -6, right: -6, background: E.ink, color: E.white, border: "none", borderRadius: "50%", width: 16, height: 16, fontSize: 9, cursor: "pointer", lineHeight: 1 }}>✕</button>
              </div>
            ))}
          </div>
        )}
      </Uploader>
      {(w.images || []).length < 8 && libraryBtn("photo", item => onChange({ images: [...(w.images || []), item.url].slice(0, 8) }))}</>;
    case "stats": return <>{head}
      <div style={{ fontSize: 12, color: E.muted, lineHeight: 1.5, marginBottom: 4 }}>Your own numbers, in your own words, nothing is computed or invented for you.</div>
      {(w.items || []).map((it, i) => (
        <div key={i} style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <input style={{ ...inp, width: 90 }} placeholder="1,200" value={it.value} onChange={e => onChange({ items: w.items.map((x, j) => j === i ? { ...x, value: e.target.value } : x) })} />
          <input style={inp} placeholder="meals served" value={it.label} onChange={e => onChange({ items: w.items.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })} />
          <button onClick={() => onChange({ items: w.items.filter((_, j) => j !== i) })} style={{ background: "none", border: "none", color: E.terra, cursor: "pointer" }}>✕</button>
        </div>
      ))}
      {(w.items || []).length < 4 && <button onClick={() => onChange({ items: [...(w.items || []), { value: "", label: "" }] })} style={{ ...btnQuiet, color: E.ink, borderColor: E.bg3, marginTop: 8 }}>+ Add stat</button>}</>;
    case "funds": {
      // BUILD-55 — manual sort: fundIds IS the display order. Chosen funds
      // list with ↑ ↓ reorder (the first leads the section); the rest are
      // one-tap adds below.
      const chosen = (w.fundIds || []).map(id => funds.find(f => f.id === id)).filter(Boolean);
      const unchosen = funds.filter(f => !(w.fundIds || []).includes(f.id));
      const moveFund = (i, dir) => {
        const next = (w.fundIds || []).slice();
        const j = i + dir;
        if (j < 0 || j >= next.length) return;
        [next[i], next[j]] = [next[j], next[i]];
        onChange({ fundIds: next });
      };
      return <>{head}
        <div style={lbl}>Heading</div><input style={inp} value={w.heading || ""} onChange={e => onChange({ heading: e.target.value })} />
        <div style={lbl}>Funds, in display order</div>
        {chosen.map((f, i) => (
          <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 6, background: E.white, border: "1px solid "+E.editLine, borderRadius: 8, padding: "6px 8px", marginBottom: 4 }}>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
            <button aria-label={`Move ${f.name} up`} disabled={i === 0} onClick={() => moveFund(i, -1)} style={{ background: "none", border: "1px solid "+E.editLine, borderRadius: 6, width: 24, height: 22, fontSize: 11, cursor: i === 0 ? "default" : "pointer", opacity: i === 0 ? 0.35 : 1 }}>↑</button>
            <button aria-label={`Move ${f.name} down`} disabled={i === chosen.length - 1} onClick={() => moveFund(i, +1)} style={{ background: "none", border: "1px solid "+E.editLine, borderRadius: 6, width: 24, height: 22, fontSize: 11, cursor: i === chosen.length - 1 ? "default" : "pointer", opacity: i === chosen.length - 1 ? 0.35 : 1 }}>↓</button>
            <button aria-label={`Remove ${f.name}`} onClick={() => onChange({ fundIds: (w.fundIds || []).filter(x => x !== f.id) })} style={{ background: "none", border: "none", color: E.terra, fontSize: 12, cursor: "pointer" }}>✕</button>
          </div>
        ))}
        {!chosen.length && <div style={{ fontSize: 12, color: E.muted, marginBottom: 4 }}>Nothing selected yet, the first fund you add leads the section.</div>}
        {chosen.length >= 6 && <div style={{ fontSize: 11.5, color: E.muted, marginBottom: 4 }}>Up to 6 funds show here.</div>}
        {unchosen.length > 0 && chosen.length < 6 && <>
          <div style={lbl}>Add a fund</div>
          {unchosen.map(f => (
            <button key={f.id} onClick={() => onChange({ fundIds: [...(w.fundIds || []), f.id].slice(0, 6) })}
              style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "1px dashed " + E.bg3, borderRadius: 8, padding: "6px 10px", marginBottom: 4, fontSize: 13, cursor: "pointer" }}>
              + {f.name}
            </button>
          ))}
        </>}
        {!funds.length && <div style={{ fontSize: 12, color: E.muted }}>No funds yet, create them in Finance.</div>}
        <div style={{ fontSize: 12, color: E.muted, marginTop: 10, lineHeight: 1.5 }}>
          Each card's Give button carries that fund as the gift's designation.
        </div>
      </>;
    }
    case "campaign": return <>{head}
      <div style={lbl}>Campaign</div>
      <select style={inp} value={w.campaignId || ""} onChange={e => onChange({ campaignId: e.target.value })}>
        <option value="">Pick a campaign</option>
        {camps.map(c => <option key={c.id} value={c.id}>{c.donorFacingName || c.name}</option>)}
      </select>
      <div style={{ fontSize: 12, color: E.muted, marginTop: 8, lineHeight: 1.5 }}>
        The story, photo, and goal come from the campaign itself, edit them in Fundraising. A campaign with no donor-facing content shows nothing here.
      </div></>;
    case "impact": return <>{head}
      <div style={lbl}>Heading</div><input style={inp} value={w.heading || ""} onChange={e => onChange({ heading: e.target.value })} /></>;
    case "quote": return <>{head}
      <div style={{ fontSize: 12, color: E.muted, lineHeight: 1.5 }}>Type the quote and who said it in the preview.</div></>;
    case "staff": return <>{head}
      {(w.members || []).map((m, i) => (
        <div key={i} style={{ border: "1px solid "+E.editLine, borderRadius: 8, padding: 8, marginTop: 8 }}>
          <input style={inp} placeholder="Name" value={m.name} onChange={e => onChange({ members: w.members.map((x, j) => j === i ? { ...x, name: e.target.value } : x) })} />
          <input style={{ ...inp, marginTop: 6 }} placeholder="Role" value={m.role} onChange={e => onChange({ members: w.members.map((x, j) => j === i ? { ...x, role: e.target.value } : x) })} />
          {imgUploader(m.photo, v => onChange({ members: w.members.map((x, j) => j === i ? { ...x, photo: v } : x) }), "Photo (optional)")}
          <button onClick={() => onChange({ members: w.members.filter((_, j) => j !== i) })} style={{ background: "none", border: "none", color: E.terra, fontSize: 12, cursor: "pointer", marginTop: 6 }}>Remove person</button>
        </div>
      ))}
      {(w.members || []).length < 6 && <button onClick={() => onChange({ members: [...(w.members || []), { name: "", role: "", photo: null }] })} style={{ ...btnQuiet, color: E.ink, borderColor: E.bg3, marginTop: 8 }}>+ Add person</button>}
      <div style={lbl}>Contact email</div><input style={inp} value={w.contactEmail || ""} onChange={e => onChange({ contactEmail: e.target.value })} /></>;
    case "faq": return <>{head}
      {(w.items || []).map((it, i) => (
        <div key={i} style={{ border: "1px solid "+E.editLine, borderRadius: 8, padding: 8, marginTop: 8 }}>
          <input style={inp} placeholder="Question" value={it.q} onChange={e => onChange({ items: w.items.map((x, j) => j === i ? { ...x, q: e.target.value } : x) })} />
          <textarea style={{ ...inp, marginTop: 6, resize: "vertical" }} rows={2} placeholder="Answer" value={it.a} onChange={e => onChange({ items: w.items.map((x, j) => j === i ? { ...x, a: e.target.value } : x) })} />
          <button onClick={() => onChange({ items: w.items.filter((_, j) => j !== i) })} style={{ background: "none", border: "none", color: E.terra, fontSize: 12, cursor: "pointer", marginTop: 6 }}>Remove</button>
        </div>
      ))}
      {(w.items || []).length < 10 && <button onClick={() => onChange({ items: [...(w.items || []), { q: "", a: "" }] })} style={{ ...btnQuiet, color: E.ink, borderColor: E.bg3, marginTop: 8 }}>+ Add question</button>}</>;
    case "video": return <>{head}
      <div style={lbl}>YouTube or Vimeo link</div>
      <input style={inp} placeholder="https://youtu.be/…" value={w.url || (w.videoId ? `(saved ${w.provider} video)` : "")}
        onChange={e => onChange({ url: e.target.value, provider: undefined, videoId: undefined })} />
      {libraryBtn("video", item => onChange({ url: item.url, provider: undefined, videoId: undefined, caption: w.caption || item.title || "" }))}
      <div style={{ fontSize: 12, color: E.muted, marginTop: 6, lineHeight: 1.5 }}>Only YouTube and Vimeo links work, the video ID is stored, never pasted embed code.</div>
      <div style={lbl}>Caption</div><input style={inp} value={w.caption || ""} onChange={e => onChange({ caption: e.target.value })} /></>;
    case "give": return <>{head}
      <div style={lbl}>Heading</div><input style={inp} value={w.heading || ""} onChange={e => onChange({ heading: e.target.value })} />
      <div style={lbl}>Button label</div><input style={inp} value={w.buttonLabel || ""} onChange={e => onChange({ buttonLabel: e.target.value })} /></>;
    // ── VOL-PAGE-1 · the volunteer blocks. Roles, shifts and numbers come
    // from Volunteers; only headings, choices and the org's own words are set here.
    case "opportunities":
    case "shiftpicker": {
      const opps = (volData && volData.opportunities) || [];
      const ids = Array.isArray(w.opportunityIds) ? w.opportunityIds : [];
      const toggleOpp = id => onChange({ opportunityIds: ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id] });
      return <>{head}
        <div style={lbl}>Heading</div><input style={inp} value={w.heading || ""} onChange={e => onChange({ heading: e.target.value })} />
        <div style={lbl}>Roles to show</div>
        <div style={{ fontSize: 12, color: E.muted, marginBottom: 6, lineHeight: 1.5 }}>Leave them all unticked to show every public role, including ones you add later.</div>
        {opps.map(o => (
          <label key={o.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, padding: "4px 0", cursor: "pointer" }}>
            <input type="checkbox" checked={ids.includes(o.id)} onChange={() => toggleOpp(o.id)} /> {o.name}
          </label>
        ))}
        {!opps.length && <div style={{ fontSize: 12, color: E.muted }}>No public volunteer roles yet. Add one in Volunteers.</div>}
        <div style={{ fontSize: 12, color: E.muted, marginTop: 10, lineHeight: 1.5 }}>
          {w.type === "shiftpicker" ? "Shifts, open spots and the waiting list come from Volunteers and update themselves." : "Each role's description, time, skills and place come from Volunteers."}
        </div></>;
    }
    case "volsignup": {
      const qs = Array.isArray(w.questions) ? w.questions.map(q => (typeof q === "string" ? q : (q && (q.label || q.q)) || "")) : [];
      const setQs = next => onChange({ questions: next });
      const flag = (k, text) => (
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, padding: "4px 0", cursor: "pointer" }}>
          <input type="checkbox" checked={w[k] !== false} onChange={e => onChange({ [k]: e.target.checked })} /> {text}
        </label>
      );
      return <>{head}
        <div style={lbl}>Heading</div><input style={inp} value={w.heading || ""} onChange={e => onChange({ heading: e.target.value })} />
        <div style={lbl}>Ask for</div>
        <div style={{ fontSize: 12, color: E.muted, marginBottom: 4 }}>Name, email and a shift are always asked.</div>
        {flag("askPhone", "Phone")}
        {flag("askAvailability", "When they can usually help")}
        {flag("askInterests", "Which roles interest them")}
        <div style={lbl}>Your own questions (up to 5)</div>
        {qs.map((q, i) => (
          <div key={i} style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <input style={inp} value={q} maxLength={200} placeholder="Do you have a T-shirt size preference?" onChange={e => setQs(qs.map((x, j) => j === i ? e.target.value : x))} />
            <button aria-label="Remove question" onClick={() => setQs(qs.filter((_, j) => j !== i))} style={{ background: "none", border: "none", color: E.terra, cursor: "pointer" }}>✕</button>
          </div>
        ))}
        {qs.length < 5 && <button onClick={() => setQs([...qs, ""])} style={{ ...btnQuiet, color: E.ink, borderColor: E.bg3, marginTop: 8 }}>+ Add a question</button>}
        <div style={{ fontSize: 12, color: E.muted, marginTop: 10, lineHeight: 1.5 }}>
          A sign-up finds the person if they are already in Steward, or adds them, and books the shift they chose.
        </div></>;
    }
    case "volwaiver":
    case "volimpact":
    case "groupsignup": return <>{head}
      <div style={lbl}>Heading</div><input style={inp} value={w.heading || ""} onChange={e => onChange({ heading: e.target.value })} />
      {w.type === "groupsignup" && <><div style={lbl}>Text</div><textarea style={{ ...inp, resize: "vertical" }} rows={3} value={w.text || ""} onChange={e => onChange({ text: e.target.value })} /></>}
      <div style={{ fontSize: 12, color: E.muted, marginTop: 10, lineHeight: 1.5 }}>
        {w.type === "volwaiver" ? "Which roles ask for a waiver or a background check comes from each role in Volunteers."
          : w.type === "volimpact" ? "Hours served this year and the volunteer roster are counted from your records when the page is opened, never typed in."
          : "Adds a group option to the sign-up form: the group's name, kind, size and the leader's phone."}
      </div></>;
    case "volquote": return <>{head}
      <div style={lbl}>Their words</div>
      <textarea style={{ ...inp, resize: "vertical" }} rows={3} value={w.text || ""} maxLength={500} placeholder="Add a quote from one of your volunteers" onChange={e => onChange({ text: e.target.value })} />
      <div style={lbl}>Their name</div><input style={inp} value={w.name || ""} maxLength={120} onChange={e => onChange({ name: e.target.value })} />
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, marginTop: 10, cursor: "pointer", lineHeight: 1.5 }}>
        <input type="checkbox" checked={w.permission === true} onChange={e => onChange({ permission: e.target.checked })} style={{ marginTop: 3 }} />
        This volunteer said we may share these words with their name.
      </label>
      <div style={{ fontSize: 12, color: E.muted, marginTop: 8, lineHeight: 1.5 }}>The quote shows on the page only with this box ticked.</div></>;
    case "mygiving": return <>{head}
      <div style={{ fontSize: 12.5, color: E.muted, lineHeight: 1.6 }}>
        Signed-in donors see their own giving history, recurring gifts, and receipts here.
        On the public page it shows a sign-in prompt instead. Nothing to configure.
      </div></>;
    default: return head;
  }
}

// ── GIVE-EDIT-1 · The page's details, its form, its history ──────────────
// One editor still: the Details rail edits the page's DRAFT settings (the
// headline, the story, the photo, the form's amounts and frequency, where the
// gift goes, the goal bar and the thank-you), saved through
// PUT <base>/settings. Nothing reaches a donor until Publish, and every
// publish is a version that can be put back in one click.

function railGroup(label) {
  return <div style={{ fontSize: 12, fontWeight: 700, color: E.body, textTransform: "uppercase", letterSpacing: "0.08em", margin: "18px 0 2px", borderTop: "1px solid " + E.editLine, paddingTop: 14 }}>{label}</div>;
}
function FieldError({ errors, prefix }) {
  const hit = (errors || []).filter(e => String(e.field || "").startsWith(prefix));
  if (!hit.length) return null;
  return <div data-testid="field-error" style={{ fontSize: 12, color: E.terra, marginTop: 4, lineHeight: 1.4 }}>{hit.map(e => e.message).join(" ")}</div>;
}

// A list of amounts in whole or decimal dollars. The text is local while she
// types, so "2" on the way to "25" never becomes a refused $2 or a lost field.
function AmountList({ valueDollars, onChange, min = 0, max = 8, whole = false, testid }) {
  const [text, setText] = useState(() => (valueDollars || []).map(String));
  const key = (valueDollars || []).join(",");
  const lastSent = useRef(key);
  useEffect(() => { if (key !== lastSent.current) { setText((valueDollars || []).map(String)); lastSent.current = key; } }, [key]);
  const push = (next) => {
    setText(next);
    const nums = next.map(t => Number(String(t).replace(/[$,\s]/g, ""))).filter(n => Number.isFinite(n) && n > 0).map(n => whole ? Math.round(n) : Math.round(n * 100) / 100);
    lastSent.current = nums.join(",");
    onChange(nums);
  };
  return (
    <div data-testid={testid}>
      {text.map((t, i) => (
        <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
          <span style={{ fontSize: 13, color: E.muted }}>$</span>
          <input style={{ ...inp, width: 110 }} inputMode="decimal" value={t} aria-label={`Amount ${i + 1}`}
            onChange={e => push(text.map((x, j) => j === i ? e.target.value : x))} />
          {text.length > min && <button type="button" onClick={() => push(text.filter((_, j) => j !== i))} style={{ background: "none", border: "none", color: E.muted, fontSize: 12, cursor: "pointer" }}>Remove</button>}
        </div>
      ))}
      {text.length < max && <button type="button" onClick={() => push([...text, ""])} style={{ ...btnQuiet, color: E.ink, borderColor: E.bg3, padding: "5px 12px", fontSize: 12 }}>Add an amount</button>}
    </div>
  );
}

// EDITOR-1 — the giving page's settings as the rail's folding sections. The
// headline and the story are typed in the preview, so they are not here; the
// cover photo is its own section (passed in), and a click on a part of the
// preview opens the section that sets it (`at`).
function giftSections({ ds, onSet, onSetForm, errors, funds, camps, saveState, facts = {}, at, formPosition, onFormPosition, coverSection }) {
  const f = ds.form || {};
  // GIVE-3 — the page's design, one field at a time onto the draft.
  const design = normalizeDesign(ds.design);
  const setDesign = patch => onSet("design", { ...design, ...patch });
  const needs = wayNeeds(facts, design);
  const des = f.designation || { mode: "none", fundId: null, fundIds: [] };
  const choosing = des.mode === "choice";
  const freq = f.defaultFrequency || "once";
  const setFreq = v => onSetForm({ defaultFrequency: v, ...(v === "monthly" ? { offerMonthly: true } : {}), ...(v === "annual" ? { offerAnnual: true } : {}) });
  const setFund = fundId => {
    onSet("fundId", fundId || null);
    if (!choosing) onSetForm({ designation: fundId ? { mode: "fixed", fundId, fundIds: [] } : { mode: "none", fundId: null, fundIds: [] } });
  };
  const setChoosing = on => onSetForm({ designation: on ? { mode: "choice", fundId: null, fundIds: funds.map(x => x.id) }
    : ds.fundId ? { mode: "fixed", fundId: ds.fundId, fundIds: [] } : { mode: "none", fundId: null, fundIds: [] } });
  return [
    <RailSection key="details" id="details" title="Details" focus={at("details")}>
      <div style={{ fontSize: 12, color: E.muted, lineHeight: 1.5 }}>
        Type the headline and the story in the page. Every change saves as a draft; donors keep seeing the live page until you press Publish, and the link never changes.
      </div>
      <div style={{ fontSize: 12, color: E.muted, marginTop: 6 }}>{saveState === "saving" ? "Saving draft…" : saveState === "error" ? "Not saved yet. Check the notes below." : saveState === "saved" ? "Draft saved" : ""}</div>
      {errors && errors.length > 0 && (
        <div data-testid="details-errors" style={{ background: E.terra100, color: E.terra, fontSize: 12.5, borderRadius: 8, padding: "8px 10px", marginTop: 8, lineHeight: 1.5 }}>
          {errors.map((e, i) => <div key={i}>{e.message}</div>)}
        </div>
      )}
      <FieldError errors={errors} prefix="title" />
      <FieldError errors={errors} prefix="story" />
      <FieldError errors={errors} prefix="image" />
    </RailSection>,
    <RailSection key="layout" id="layout" title="Layout" focus={at("layout")}>
      <div data-field="layout" role="radiogroup" aria-label="Page layout" style={{ display: "grid", gap: 6 }}>
        {LAYOUTS.map(l => (
          <label key={l.key} data-testid={"details-layout-" + l.key} style={{ ...checkRow, marginTop: 0, border: "1px solid " + (design.layout === l.key ? E.green : E.bg3), borderRadius: 8, padding: "7px 10px", background: design.layout === l.key ? E.white : "transparent" }}>
            <input type="radio" name="page-layout" checked={design.layout === l.key} onChange={() => setDesign({ layout: l.key })} style={{ marginTop: 2 }} />
            <span><strong>{l.label}</strong><span style={{ display: "block", fontSize: 11.5, color: E.muted }}>{l.hint}</span></span>
          </label>
        ))}
      </div>
      {!design.layout && <div style={{ fontSize: 11.5, color: E.muted, marginTop: 4 }}>Not picked yet: the page chooses for you from what it has.</div>}
      <FieldError errors={errors} prefix="design.layout" />
      <div style={lbl}>The donation form</div>
      <select style={inp} value={formPosition} aria-label="Where the donation form sits" onChange={e => onFormPosition(e.target.value)}>
        <option value="top">leads the page</option>
        <option value="bottom">follows the story</option>
      </select>
    </RailSection>,
    coverSection,
    <RailSection key="gift" id="gift" title="The gift" focus={at("gift")} defaultOpen={false}>
      <div style={{ ...lbl, marginTop: 0 }} data-field="amounts">Suggested amounts</div>
      <AmountList testid="details-amounts" valueDollars={(f.amountsCents || []).map(c => c / 100)} max={8}
        onChange={nums => onSetForm({ amountsCents: nums.map(n => Math.round(n * 100)) })} />
      <FieldError errors={errors} prefix="form.amountsCents" />
      <FieldError errors={errors} prefix="amountsCents" />
      {(f.amountsCents || []).length > 0 && (
        <>
          <div style={lbl}>What each amount does (optional)</div>
          <div style={{ fontSize: 11.5, color: E.muted, lineHeight: 1.45, marginBottom: 4 }}>One line, shown when a donor picks that amount. Only say what is true.</div>
          {(f.amountsCents || []).map(c => (
            <div key={c} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
              <span style={{ width: 54, fontSize: 12.5, fontWeight: 700 }}>{money0(c / 100)}</span>
              <input data-testid={"details-impact-" + c} style={inp} maxLength={140} value={design.impact[String(c)] || ""}
                placeholder="buys a week of art supplies for 10 kids"
                onChange={e => setDesign({ impact: { ...design.impact, [String(c)]: e.target.value } })} />
            </div>
          ))}
          <FieldError errors={errors} prefix="design.impact" />
        </>
      )}
      <div style={lbl}>Opens on</div>
      <div role="radiogroup" aria-label="Which frequency is chosen first" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {["once", "monthly", "annual"].map(v => (
          <label key={v} style={{ ...checkRow, marginTop: 0, border: "1px solid " + (freq === v ? E.green : E.bg3), borderRadius: 8, padding: "5px 10px", background: freq === v ? E.white : "transparent" }}>
            <input type="radio" name="opens-on" checked={freq === v} onChange={() => setFreq(v)} /> {FREQ_LABEL[v]}
          </label>
        ))}
      </div>
      <label style={checkRow}><input type="checkbox" checked={f.offerMonthly !== false} disabled={freq === "monthly"} onChange={e => onSetForm({ offerMonthly: e.target.checked })} style={{ marginTop: 2 }} />Offer monthly giving</label>
      <label style={checkRow}><input type="checkbox" checked={f.offerAnnual === true} disabled={freq === "annual"} onChange={e => onSetForm({ offerAnnual: e.target.checked })} style={{ marginTop: 2 }} />Offer a yearly gift</label>
      <FieldError errors={errors} prefix="form.offer" />
      <FieldError errors={errors} prefix="form.defaultFrequency" />
      <label style={checkRow}>
        <input data-testid="details-cover-fee" type="checkbox" checked={f.showCoverFee !== false} onChange={e => onSetForm({ showCoverFee: e.target.checked })} style={{ marginTop: 2 }} />
        <span>Show the box that lets donors cover the fee
          <span style={{ display: "block", fontSize: 11, color: E.muted }}>Your organization's own fee setting in Settings still decides whether it can show at all.</span></span>
      </label>
    </RailSection>,
    <RailSection key="where" id="where" title="Where the gift goes" focus={at("where")} defaultOpen={false}>
      <div style={{ ...lbl, marginTop: 0 }}>Fund</div>
      <select style={inp} value={ds.fundId || ""} onChange={e => setFund(e.target.value)} disabled={choosing}>
        <option value="">No fund named</option>
        {funds.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
      </select>
      <label style={checkRow}><input data-testid="details-donor-chooses" type="checkbox" checked={choosing} onChange={e => setChoosing(e.target.checked)} style={{ marginTop: 2 }} />Let the donor choose the fund</label>
      <FieldError errors={errors} prefix="form.designation" />
      <FieldError errors={errors} prefix="fund" />
      <div style={lbl}>Counts toward a campaign</div>
      <select style={inp} value={ds.campaignId || ""} onChange={e => onSet("campaignId", e.target.value || null)}>
        <option value="">No campaign</option>
        {camps.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <FieldError errors={errors} prefix="campaign" />
    </RailSection>,
    <RailSection key="goal" id="goal" title="Goal" focus={at("goal")} defaultOpen={false}>
      <div data-field="goal" />
      <label style={{ ...checkRow, marginTop: 0 }}><input data-testid="details-show-goal" type="checkbox" checked={ds.showGoal !== false} onChange={e => onSet("showGoal", e.target.checked)} style={{ marginTop: 2 }} />Show the goal and progress bar</label>
      {ds.showGoal !== false && !ds.campaignId && (
        <>
          <div style={lbl}>Goal ($)</div>
          <input style={inp} inputMode="decimal" value={ds.goalAmount == null ? "" : ds.goalAmount}
            onChange={e => { const v = e.target.value.replace(/[^0-9.]/g, ""); onSet("goalAmount", v === "" ? null : Number(v)); }} />
        </>
      )}
      {ds.showGoal !== false && ds.campaignId && <div style={{ fontSize: 11.5, color: E.muted, marginTop: 6 }}>The bar shows the campaign's own goal and what it has raised.</div>}
      <FieldError errors={errors} prefix="goal" />
    </RailSection>,
    <RailSection key="trust" id="trust" title="Trust panel" focus={at("trust")} defaultOpen={false}>
      <div data-field="trust" style={{ fontSize: 11.5, color: E.muted, lineHeight: 1.45 }}>Under the form. Each line shows only what your records hold; untick any to hide it.</div>
      {TRUST_KEYS.map(k => (
        <label key={k} style={checkRow}>
          <input data-testid={"details-trust-" + k} type="checkbox" checked={!design.hide.includes(k)} style={{ marginTop: 2 }}
            onChange={e => setDesign({ hide: e.target.checked ? design.hide.filter(x => x !== k) : [...design.hide, k] })} />
          <span>{TRUST_LABELS[k]}
            {k === "stripe" && !facts.stripe && <span style={{ display: "block", fontSize: 11, color: E.muted }}>Shows once your Stripe account is connected.</span>}
            {k === "legal" && !facts.legalName && !facts.ein && <span style={{ display: "block", fontSize: 11, color: E.muted }}>Add your legal name and EIN in Settings first.</span>}
            {k === "tax" && !facts.ein && <span style={{ display: "block", fontSize: 11, color: E.muted }}>Shows once your EIN is in Settings.</span>}
            {k === "contact" && !facts.contactEmail && !design.phone && <span style={{ display: "block", fontSize: 11, color: E.muted }}>Add a contact email in Design, or a phone below.</span>}
          </span>
        </label>
      ))}
      <div style={lbl}>Your privacy page (optional)</div>
      <input data-testid="details-privacy" style={inp} value={design.privacyUrl} placeholder="https://yourorg.org/privacy (empty: Steward's)" onChange={e => setDesign({ privacyUrl: e.target.value })} />
      <FieldError errors={errors} prefix="design.privacyUrl" />
      <div style={lbl}>Phone (optional)</div>
      <input data-testid="details-phone" style={inp} value={design.phone} placeholder="(978) 555-0100" onChange={e => setDesign({ phone: e.target.value })} />
      <FieldError errors={errors} prefix="design.phone" />
    </RailSection>,
    <RailSection key="ways" id="ways" title="Other ways to give" focus={at("ways")} defaultOpen={false}>
      <div data-field="ways" style={{ fontSize: 11.5, color: E.muted, lineHeight: 1.45 }}>One line each, under the trust panel.</div>
      {[["check", "Mail a check"], ["phone", "By phone"], ["daf", "Donor-advised fund"], ["stock", "Stock"]].map(([k, label]) => (
        <label key={k} style={checkRow}>
          <input data-testid={"details-way-" + k} type="checkbox" checked={design.ways[k]} style={{ marginTop: 2 }}
            onChange={e => setDesign({ ways: { ...design.ways, [k]: e.target.checked } })} />
          <span>{label}{design.ways[k] && needs[k] && <span style={{ display: "block", fontSize: 11, color: E.muted }}>{needs[k]}</span>}</span>
        </label>
      ))}
      <div data-testid="details-connections" style={{ fontSize: 11.5, color: E.muted, lineHeight: 1.45, marginTop: 10 }}>
        Take gifts on Zeffy, Givebutter or PayPal too? Keep them there: Steward reads those gifts in (Donorbox from its export file). <a href="/app/settings?section=connections" style={{ color: E.green }}>Connections</a>
      </div>
    </RailSection>,
    <RailSection key="after" id="after" title="After they give" focus={at("after")} defaultOpen={false}>
      <div style={{ ...lbl, marginTop: 0 }}>Thank-you message</div>
      <textarea data-testid="details-thanks" style={{ ...inp, minHeight: 90, resize: "vertical", lineHeight: 1.5 }} value={(f.thankYou && f.thankYou.message) || ""}
        placeholder="Leave it empty and donors read a short thank-you in your name."
        onChange={e => onSetForm({ thankYou: { ...(f.thankYou || {}), message: e.target.value } })} />
      <FieldError errors={errors} prefix="form.thankYou" />
    </RailSection>,
  ];
}

function OrgFormRail({ ds, onSet, errors, saveState }) {
  return (
    <div data-testid="details-rail">
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>Your donation form</div>
      <div style={{ fontSize: 12, color: E.muted, lineHeight: 1.5 }}>
        The amounts donors see on your main giving page. Changes save as a draft until you publish, and the link never changes. Your name and colors come from the Design tab.
      </div>
      <div style={{ fontSize: 12, color: E.muted, marginTop: 6 }}>{saveState === "saving" ? "Saving draft…" : saveState === "saved" ? "Draft saved" : ""}</div>
      {errors && errors.length > 0 && (
        <div data-testid="details-errors" style={{ background: E.terra100, color: E.terra, fontSize: 12.5, borderRadius: 8, padding: "8px 10px", marginTop: 8 }}>{errors.map((e, i) => <div key={i}>{e.message}</div>)}</div>
      )}
      {railGroup("One-time amounts")}
      <AmountList testid="orgform-onetime" valueDollars={ds.onetimeAmounts || []} min={3} max={6} whole onChange={v => onSet("onetimeAmounts", v)} />
      {railGroup("Monthly amounts")}
      <AmountList testid="orgform-monthly" valueDollars={ds.monthlyAmounts || []} min={3} max={6} whole onChange={v => onSet("monthlyAmounts", v)} />
      <div style={{ fontSize: 11.5, color: E.muted, marginTop: 10, lineHeight: 1.45 }}>Three to six whole-dollar amounts for each.</div>
    </div>
  );
}

function HistoryPanel({ apiBase, onClose, onRestored }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const load = useCallback(() => {
    apiFetch(apiBase + "/history").then(r => setRows(Array.isArray(r?.versions) ? r.versions : []))
      .catch(e => { setRows([]); setErr(errorMessage(e, "Could not load the history.")); });
  }, [apiBase]);
  useEffect(() => { load(); }, [load]);
  const when = d => { try { return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return ""; } };
  const restore = async (v) => {
    if (!(await askConfirm({ title: `Put version ${v.number} back?`, body: "It goes live straight away, at the same link. The page as it is now stays in this list, so you can come back to it.", yes: "Restore" }))) return;
    setBusy(v.id); setErr("");
    try { await apiFetch(`${apiBase}/history/${encodeURIComponent(v.id)}/restore`, { method: "POST", body: "{}" }); await onRestored(); load(); }
    catch (e) { setErr(errorMessage(e, "Could not restore that version.")); }
    setBusy("");
  };
  return (
    <div data-testid="history-panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>History</div>
        <button onClick={onClose} aria-label="Close history" style={{ background: "none", border: "none", fontSize: 13, cursor: "pointer", color: E.muted }}>Done ✕</button>
      </div>
      <div style={{ fontSize: 12, color: E.muted, lineHeight: 1.5, marginBottom: 10 }}>Every publish is kept, with who did it and when. Restore puts that version live again.</div>
      {err && <div style={{ fontSize: 12, color: E.terra, marginBottom: 8 }}>{err}</div>}
      {rows === null ? <div style={{ fontSize: 12, color: E.muted }}>Loading…</div>
        : rows.length === 0 ? <div style={{ fontSize: 12.5, color: E.muted }}>Nothing published yet. The first Publish starts the history.</div>
        : rows.map((v, i) => (
          <div key={v.id} data-testid="history-row" style={{ background: E.white, border: "1px solid " + E.editLine, borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: E.body }}>Version {v.number}{i === 0 ? " · live now" : ""}</div>
            <div style={{ fontSize: 12, color: E.muted, marginTop: 2 }}>{v.baseline ? "As it was before the first edit here" : `${v.restoredFrom ? `Restored from version ${v.restoredFrom}` : "Published"} by ${v.byName || "someone on your team"}`} · {when(v.createdAt)}</div>
            {i > 0 && <button type="button" data-testid="history-restore" disabled={!!busy} onClick={() => restore(v)}
              style={{ ...btnQuiet, color: E.ink, borderColor: E.bg3, padding: "5px 12px", fontSize: 12, marginTop: 8 }}>{busy === v.id ? "Restoring…" : "Restore"}</button>}
          </div>
        ))}
    </div>
  );
}
