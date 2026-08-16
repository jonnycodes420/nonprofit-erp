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
import { useState, useEffect, useRef, useCallback } from "react";
import { apiFetch, API } from "../api";
import { PageRenderer } from "../components/PortalWidgets";
import { resolvePairing, resolveCardStyle, TYPE_PAIRINGS, CARD_STYLES } from "../lib/portalTheme";
import { textToStory, storyToText } from "../lib/storyBlocks";
import { resolveAssetUrl } from "../lib/assetUrl";
import Uploader, { IMAGE_ACCEPT, IMAGE_ACCEPT_LABEL, IMAGE_MAX_BYTES } from "../components/Uploader";

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
  body: "Publish an impact update and it appears here — donors it matches see it on their own page.",
  photos: [], date: new Date().toISOString(),
}];

const WIDGET_META = {
  hero:     { label: "Hero",             hint: "Big photo + headline" },
  richtext: { label: "Rich text",        hint: "Paragraphs, headings, lists" },
  image:    { label: "Image + caption",  hint: "One photo" },
  gallery:  { label: "Gallery",          hint: "Up to 8 photos" },
  stats:    { label: "Stats",            hint: "Your own numbers" },
  funds:    { label: "Programs & funds", hint: "Cards from your real funds" },
  campaign: { label: "Campaign",         hint: "A campaign's story + goal" },
  impact:   { label: "Impact feed",      hint: "Your impact updates" },
  quote:    { label: "Quote",            hint: "A voice from your community" },
  staff:    { label: "People & contact", hint: "Faces + a way to reach you" },
  faq:      { label: "FAQ",              hint: "Questions donors ask" },
  video:    { label: "Video",            hint: "YouTube or Vimeo link" },
  give:     { label: "Give button",      hint: "A clear way to give" },
  mygiving: { label: "My Giving",        hint: "The donor's own history" },
};

const DEFAULT_WIDGET = {
  hero: { type: "hero", heading: "", sub: "", image: null, size: "standard" },
  richtext: { type: "richtext", blocks: [{ type: "p", text: "Write something in your own words." }] },
  image: { type: "image", image: null, caption: "" },
  gallery: { type: "gallery", images: [] },
  stats: { type: "stats", items: [{ value: "", label: "" }] },
  funds: { type: "funds", heading: "Where you can give", fundIds: [] },
  campaign: { type: "campaign", campaignId: "" },
  impact: { type: "impact", heading: "What your giving made possible" },
  quote: { type: "quote", text: "", attribution: "" },
  staff: { type: "staff", members: [{ name: "", role: "", photo: null }], contactEmail: "" },
  faq: { type: "faq", items: [{ q: "", a: "" }] },
  video: { type: "video", url: "", caption: "" },
  give: { type: "give", heading: "Make a new gift", buttonLabel: "Give" },
  mygiving: { type: "mygiving" },
};

const E = {
  ink: "#0f1a12", cream: "#f0ede6", gold: "#c9a84c", bg3: "#dcd8cc", terra: "#8a3a24", green: "#0d5c3a",
};
const btn = { background: E.gold, color: E.ink, border: "none", borderRadius: 9, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" };
const btnQuiet = { background: "transparent", color: E.cream, border: "1px solid #3a4a3e", borderRadius: 9, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const inp = { width: "100%", boxSizing: "border-box", padding: "8px 10px", fontSize: 13, border: "1px solid " + E.bg3, borderRadius: 8, fontFamily: "inherit" };
const lbl = { fontSize: 11, fontWeight: 700, color: "#6b6b64", textTransform: "uppercase", letterSpacing: "0.06em", margin: "10px 0 4px" };

function varsForPs(ps) {
  const pairing = resolvePairing(ps.type_pairing);
  const cs = resolveCardStyle(ps.card_style);
  return {
    "--pt-primary": ps.primary_color || "#1a6b4a", "--pt-primary-fg": "#ffffff",
    "--pt-accent": ps.accent_color || "#c9a84c", "--pt-accent-fg": "#ffffff",
    "--pt-button": ps.button_color || ps.primary_color || "#1a6b4a", "--pt-button-fg": "#ffffff",
    "--pt-bg": ps.background_tint || "#faf9f6",
    "--pt-serif": pairing.serif, "--pt-sans": pairing.sans,
    "--pt-card-radius": cs.radius + "px",
    "--pt-card-border": cs.borderWidth ? `${cs.borderWidth}px solid #e7e4dc` : "none",
    "--pt-card-shadow": cs.shadow,
  };
}

// Sample My Giving — a clearly-labeled stand-in; NEVER the live component
// (the live one carries recurring mutations and expects a real session).
function SampleMyGiving() {
  return (
    <div style={{ background: "#fff", border: "var(--pt-card-border,1px solid #e7e4dc)", borderRadius: "var(--pt-card-radius,14px)", padding: "20px 22px", marginBottom: 18 }}>
      <div style={{ fontFamily: "var(--pt-serif,Georgia,serif)", fontSize: 22, marginBottom: 12 }}>Your giving</div>
      <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
        <div><div style={lbl}>This year</div><div style={{ fontSize: 26, fontWeight: 700 }}>$450</div></div>
        <div><div style={lbl}>Lifetime</div><div style={{ fontSize: 26, fontWeight: 700 }}>$2,900</div></div>
      </div>
      <div style={{ fontSize: 12, color: "#6b6b64", marginTop: 10 }}>
        Signed-in donors see their own history, recurring gifts, and receipts here — this is Sam Sample, a fictional donor.
      </div>
    </div>
  );
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
  const [device, setDevice] = useState("phone");     // §4: phone DEFAULT
  const [mode, setMode] = useState("page");           // "page" (widgets) | "design" (theme)
  const [libOpen, setLibOpen] = useState(false);      // widget library — collapsed by default (BUILD-55)
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

  const applyPs = useCallback((next) => { psRef.current = next; setPs(next); }, []);

  useEffect(() => {
    apiFetch("/portal-page").then(d => { setMeta(d); setWidgets(Array.isArray(d.draft) ? d.draft : []); }).catch(e => setErr(e.message));
    apiFetch("/portal-settings").then(d => { psRef.current = d; setPs(d); }).catch(() => {});
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
        }
      } catch (e) { setErr(e.message || "Could not save the design."); setSaveState("error"); }
    }, 1200);
  }, []);
  const setDesign = (k, v) => {
    const next = { ...(psRef.current || {}), [k]: v };
    applyPs(next);
    scheduleDesignSave(next);
  };

  const scheduleSave = useCallback((next) => {
    setSaveState("dirty");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const seq = ++editSeq.current;
    saveTimer.current = setTimeout(async () => {
      setSaveState("saving"); setErr("");
      try {
        const r = await apiFetch("/portal-page/draft", { method: "PUT", body: JSON.stringify({ widgets: next }) });
        // Adopt the server's canonical draft (data-URI images became asset
        // paths) ONLY if nothing changed while the request was in flight.
        if (seq === editSeq.current) { setWidgets(r.draft); setSaveState("saved"); }
      } catch (e) { setErr(e.message || "Could not save the draft."); setSaveState("error"); }
    }, 1200);
  }, []);

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
  const addWidget = (type) => {
    const w = { ...DEFAULT_WIDGET[type], id: "new_" + Math.random().toString(36).slice(2, 10) };
    update([...widgets, w]);
    setSelected(w.id);
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
    if (!window.confirm("Publish this page? Donors will see it immediately.")) return;
    setPublishing(true); setErr("");
    try {
      if (saveTimer.current) { clearTimeout(saveTimer.current); }
      const seq = ++editSeq.current;
      const r = await apiFetch("/portal-page/draft", { method: "PUT", body: JSON.stringify({ widgets }) });
      if (seq === editSeq.current) setWidgets(r.draft);
      await apiFetch("/portal-page/publish", { method: "POST", body: "{}" });
      const d = await apiFetch("/portal-page");
      setMeta(d); setSaveState("saved");
    } catch (e) { setErr(e.message || "Publish failed."); }
    setPublishing(false);
  };
  const revert = async () => {
    if (!window.confirm("Discard the draft and go back to the last published page?")) return;
    try {
      const r = await apiFetch("/portal-page/revert", { method: "POST", body: "{}" });
      setWidgets(Array.isArray(r.draft) ? r.draft : []);
      setSelected(null); setSaveState("saved");
    } catch (e) { setErr(e.message || "Revert failed."); }
  };
  const applyStarter = async (key) => {
    try {
      const r = await apiFetch("/portal-page/starter", { method: "POST", body: JSON.stringify({ key }) });
      setWidgets(r.draft); setSaveState("saved");
    } catch (e) { setErr(e.message || "Could not apply the starter."); }
  };

  if (err && widgets === null) {
    return <div style={{ padding: 40, fontFamily: "system-ui" }}>
      <p>{err}</p>
      <a href="/dashboard" style={{ color: E.green }}>← Back to Steward</a>
    </div>;
  }
  if (widgets === null || !ps) return <div style={{ padding: 40, fontFamily: "system-ui", color: "#6b6b64" }}>Loading the editor…</div>;

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

  // ── BUILD-55 Part 2 layout ──────────────────────────────────────────────
  // Phone = a real phone frame (390px, its own scroll), centered in the
  // canvas. Desktop = the REAL full-width portal render — one PageRenderer
  // over all widgets so the published .pt-widgets two-track grid and the
  // wrap ladder (860 → 1140 ≥1280 → 1360 ≥1720, mirrored from Portal.jsx's
  // PortalStyles) actually apply — with the edit chrome layered per widget
  // via PageRenderer's decorate seam. The widget library is no longer a
  // permanent rail: "+ Add widget" opens it; the selected widget's options
  // panel appears beside the canvas only while something is selected.

  // Per-widget edit chrome, injected INSIDE the widget's grid cell so the
  // desktop grid placement is untouched.
  const decorateWidget = (w, node) => (
    <div draggable
      onDragStart={() => setDragId(w.id)}
      onDragEnd={() => { setDragId(null); scheduleSave(widgets); }}
      onDragOver={e => onDragOverWidget(e, w.id)}
      onClick={() => setSelected(w.id)}
      onDrop={["hero", "image"].includes(w.type) ? (e) => {
        // §4 — in-place image drop: a photo dropped ON the hero IS the hero.
        e.preventDefault(); e.stopPropagation();
        readImageFile(e.dataTransfer?.files?.[0], dataUrl => updateWidget(w.id, { image: dataUrl }));
      } : undefined}
      style={{ position: "relative", outline: selected === w.id ? `2px solid ${E.gold}` : "1px dashed transparent", borderRadius: 8, cursor: "grab" }}
      onMouseEnter={e => { if (selected !== w.id) e.currentTarget.style.outline = "1px dashed #c9a84c"; }}
      onMouseLeave={e => { if (selected !== w.id) e.currentTarget.style.outline = "1px dashed transparent"; }}>
      {/* floating widget controls — keyboard path first-class */}
      <div style={{ position: "absolute", top: -10, right: 6, zIndex: 5, display: "flex", gap: 4 }}>
        <span style={{ background: E.ink, color: E.cream, fontSize: 10, fontWeight: 700, borderRadius: 6, padding: "3px 8px" }}>{WIDGET_META[w.type]?.label}</span>
        <button aria-label="Move up" onClick={e => { e.stopPropagation(); move(w.id, -1); }} style={{ background: E.ink, color: E.cream, border: "none", borderRadius: 6, width: 22, height: 20, fontSize: 11, cursor: "pointer" }}>↑</button>
        <button aria-label="Move down" onClick={e => { e.stopPropagation(); move(w.id, +1); }} style={{ background: E.ink, color: E.cream, border: "none", borderRadius: 6, width: 22, height: 20, fontSize: 11, cursor: "pointer" }}>↓</button>
        <button aria-label="Remove widget" onClick={e => { e.stopPropagation(); removeWidget(w.id); }} style={{ background: E.terra, color: "#fff", border: "none", borderRadius: 6, width: 22, height: 20, fontSize: 11, cursor: "pointer" }}>✕</button>
      </div>
      <div style={{ pointerEvents: "none" }}>{node}</div>
    </div>
  );

  const pageHeader = (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 18px" }}>
      {(ps.logo_data || ps.logo_url) && (
        <img src={ps.logo_data || resolveAssetUrl(ps.logo_url)} alt="" style={{ height: 28, maxWidth: 90, objectFit: "contain" }} />
      )}
      <div style={{ fontFamily: "var(--pt-serif,Georgia,serif)", fontSize: 22 }}>{ps.display_name || "Your portal"}</div>
    </div>
  );
  const pageBody = widgets.length === 0 ? (
    <div style={{ padding: "10px 0 30px" }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Start with a layout</div>
      <div style={{ fontSize: 13, color: "#6b6b64", marginBottom: 14 }}>Pick a starting point — everything stays editable, and nothing is visible to donors until you publish.</div>
      {(meta?.starters || []).map(s => (
        <button key={s.key} onClick={() => applyStarter(s.key)}
          style={{ display: "block", width: "100%", textAlign: "left", background: "#fff", border: "1px solid #e7e4dc", borderRadius: 10, padding: "12px 14px", marginBottom: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
          {s.label}
        </button>
      ))}
    </div>
  ) : (
    <PageRenderer page={{ widgets: resolvedWidgets, giveSlug: ps.org_slug }} ctx={publicPreviewCtx}
      decorate={mode === "page" ? decorateWidget : undefined} />
  );

  return (
    <div style={{ height: "100vh", background: "#101a13", fontFamily: "'DM Sans',system-ui,sans-serif", display: "flex", flexDirection: "column" }}>
      {/* Desktop preview = the published page's own layout rules, scoped to the
          editor canvas (mirrors Portal.jsx PortalStyles — keep in lock-step). */}
      <style>{`
        .pe-wrap { max-width: 860px; margin: 0 auto; padding: 18px 20px 64px; }
        @media (min-width: 1280px) {
          .pe-wrap { max-width: 1140px; }
          .pe-desktop .pt-widgets { display: grid; grid-template-columns: 1fr 1fr; gap: 0 18px; align-items: start; }
          .pe-desktop .pt-widgets > * { min-width: 0; }
        }
        @media (min-width: 1720px) { .pe-wrap { max-width: 1360px; } }
      `}</style>
      {/* ── Top chrome ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", background: E.ink, color: E.cream, flexWrap: "wrap" }}>
        <a href="/dashboard" style={{ color: E.cream, textDecoration: "none", fontSize: 13, fontWeight: 600 }}>← Steward</a>
        <span style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 16 }}>Portal editor</span>
        <span style={{ fontSize: 11, fontWeight: 700, background: E.gold, color: E.ink, borderRadius: 20, padding: "3px 10px" }}>SAMPLE DONOR DATA</span>
        {/* Mode toggle — "Page" edits the widgets; "Design" edits the theme +
            page details (the old Settings portal form, moved here so you edit
            what you see, where you see it). */}
        <div style={{ display: "flex", gap: 6, marginLeft: 8 }}>
          {["page", "design"].map(m => (
            <button key={m} onClick={() => { setMode(m); if (m === "design") { setSelected(null); setLibOpen(false); } }}
              style={{ ...btnQuiet, padding: "5px 12px", fontSize: 12, background: mode === m ? "#2a3a2e" : "transparent", borderColor: mode === m ? E.gold : "#3a4a3e" }}>
              {m === "page" ? "Page" : "Design"}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, marginLeft: 8 }}>
          {["phone", "desktop"].map(d => (
            <button key={d} onClick={() => setDevice(d)}
              style={{ ...btnQuiet, padding: "5px 12px", fontSize: 12, background: device === d ? "#2a3a2e" : "transparent", borderColor: device === d ? E.gold : "#3a4a3e" }}>
              {d === "phone" ? "Phone" : "Desktop"}
            </button>
          ))}
        </div>
        {mode === "page" && (
          <button onClick={() => setLibOpen(o => !o)} style={{ ...btnQuiet, borderColor: libOpen ? E.gold : "#3a4a3e", background: libOpen ? "#2a3a2e" : "transparent", marginLeft: 8 }}>
            + Add widget
          </button>
        )}
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#8fa896" }}>
          {saveState === "saving" ? "Saving draft…" : saveState === "dirty" ? "Unsaved edits…" : saveState === "error" ? "Save failed" : meta?.publishedAt ? "Draft autosaves · publish when ready" : "Draft autosaves"}
        </span>
        {meta?.publishedAt && <button onClick={revert} style={btnQuiet}>Revert to published</button>}
        <button onClick={publish} disabled={publishing} style={btn}>{publishing ? "Publishing…" : "Publish"}</button>
      </div>
      {err && <div style={{ background: "#f6e3dd", color: E.terra, fontSize: 13, padding: "8px 16px" }}>{err}</div>}

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* ── Left rail: Design mode — the theme + page-detail controls (the
            old Settings PortalManager form, one home now). The preview to the
            right updates immediately from local ps state. ── */}
        {mode === "design" && (
          <div style={{ width: 320, flexShrink: 0, background: "#f7f5ef", borderRight: "1px solid #2a3a2e", overflowY: "auto", padding: "16px 16px 40px" }}>
            <DesignRail ps={ps} onSet={setDesign} note={designNote} />
          </div>
        )}
        {/* ── Widget library — collapsible, not a permanent rail ── */}
        {mode === "page" && libOpen && (
          <div style={{ width: 280, flexShrink: 0, background: "#f7f5ef", borderRight: "1px solid #2a3a2e", overflowY: "auto", padding: "16px 16px 40px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>Add a widget</div>
              <button onClick={() => setLibOpen(false)} aria-label="Close widget library" style={{ background: "none", border: "none", fontSize: 13, cursor: "pointer", color: "#6b6b64" }}>✕</button>
            </div>
            {Object.entries(WIDGET_META).map(([type, m]) => (
              <button key={type} onClick={() => { addWidget(type); setLibOpen(false); }}
                style={{ display: "block", width: "100%", textAlign: "left", background: "#fff", border: "1px solid #e0dcd0", borderRadius: 10, padding: "10px 12px", marginBottom: 6, cursor: "pointer" }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{m.label}</div>
                <div style={{ fontSize: 11.5, color: "#6b6b64" }}>{m.hint}</div>
              </button>
            ))}
            <div style={{ fontSize: 12, color: "#6b6b64", marginTop: 12, lineHeight: 1.5 }}>
              The new widget lands at the end of the page, already selected — its options open beside the preview.
            </div>
          </div>
        )}

        {/* ── Canvas ── */}
        {device === "phone" ? (
          <div style={{ flex: 1, minWidth: 0, overflow: "auto", display: "flex" }}>
            {/* margin:auto centers the frame both ways and never clips when the
                viewport is shorter than the frame (flex centering would). */}
            <div style={{ margin: "auto", padding: 24 }}>
              <div style={{ background: E.ink, borderRadius: 40, padding: 10, boxShadow: "0 18px 50px rgba(0,0,0,0.45)" }}>
                <div style={{ width: 390, maxWidth: "calc(100vw - 120px)", height: "min(844px, calc(100vh - 150px))", background: "var(--pt-bg,#faf9f6)", borderRadius: 30, overflow: "hidden", display: "flex", flexDirection: "column", ...themeVars }}>
                  <div style={{ flex: 1, overflowY: "auto", padding: "18px 20px 60px", color: "#1c1c1a", fontFamily: "var(--pt-sans)" }}>
                    {pageHeader}
                    {pageBody}
                  </div>
                </div>
              </div>
              <div style={{ textAlign: "center", fontSize: 11, color: "#8fa896", marginTop: 10 }}>Phone · 390px — how donors arriving from email see it</div>
            </div>
          </div>
        ) : (
          <div className="pe-desktop" style={{ flex: 1, minWidth: 0, overflowY: "auto", background: "var(--pt-bg,#faf9f6)", ...themeVars }}>
            {/* The real page: full canvas width, the published wrap ladder
                centers the column and the ≥1280 two-track grid applies. */}
            <div className="pe-wrap" style={{ color: "#1c1c1a", fontFamily: "var(--pt-sans)" }}>
              {pageHeader}
              {pageBody}
            </div>
          </div>
        )}

        {/* ── Options panel — beside the canvas, only while a widget is selected ── */}
        {mode === "page" && selectedWidget && (
          <div style={{ width: 320, flexShrink: 0, background: "#f7f5ef", borderLeft: "1px solid #2a3a2e", overflowY: "auto", padding: "16px 16px 40px" }}>
            <WidgetOptions w={selectedWidget} funds={funds} camps={camps}
              onChange={patch => updateWidget(selectedWidget.id, patch)}
              onClose={() => setSelected(null)} />
          </div>
        )}
      </div>
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
    <div style={{ fontSize: 12, fontWeight: 700, color: "#1c1c1a", textTransform: "uppercase", letterSpacing: "0.08em", margin: "18px 0 2px", borderTop: "1px solid #e0dcd0", paddingTop: 14 }}>{label}</div>
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
          <button onClick={() => onSet(key, "")} style={{ background: "none", border: "none", color: "#6b6b64", fontSize: 12, cursor: "pointer" }}>Clear</button>
        )}
      </div>
      {hint && <div style={{ fontSize: 11, color: "#6b6b64", marginTop: 4, lineHeight: 1.4 }}>{hint}</div>}
    </>
  );
  const logoSrc = ps.logo_data || resolveAssetUrl(ps.logo_url);
  const headerSrc = ps.header_image_data || resolveAssetUrl(ps.header_image_url);
  return (
    <>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>Design</div>
      <div style={{ fontSize: 12, color: "#6b6b64", lineHeight: 1.5 }}>
        Your portal's look and page details. Changes autosave and show in the preview immediately —
        colors may be adjusted slightly on save so text stays readable.
      </div>
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
      <Uploader accept={IMAGE_ACCEPT} acceptLabel={IMAGE_ACCEPT_LABEL} maxBytes={IMAGE_MAX_BYTES} compact
        shape="banner" preview={headerSrc || null}
        label={headerSrc ? "Replace image" : "Drag a header image here, or browse"}
        hint={IMAGE_ACCEPT_LABEL + " · landscape, around 1200×300 works best"}
        validate={({ file, dataUrl }) => file.type === "image/svg+xml" ? null : new Promise(resolve => {
          // Mirror of the server banner rule (landscape, >=600px wide) so a
          // portrait drop is explained BEFORE the round trip. UI courtesy
          // only — the server re-validates identically.
          const img = new Image();
          img.onload = () => resolve(img.height >= img.width ? "Header images render as a wide banner — use a landscape image (at least 1200×300 works well)." : (img.width < 600 ? "Header images need to be at least 600px wide." : null));
          img.onerror = () => resolve("That file doesn't parse as an image.");
          img.src = dataUrl;
        })}
        onFile={({ dataUrl }) => onSet("header_image_data", dataUrl)}
        onRemove={() => { onSet("header_image_data", ""); onSet("header_image_url", null); }} />

      {group("Colors")}
      {colorField("Primary color", "primary_color", "#1a6b4a")}
      {colorField("Accent color", "accent_color", "#c9a84c")}
      {colorField("Background tint (optional)", "background_tint", "#faf9f6", { clearable: true, hint: "A soft page wash. Dark colors are lightened so text stays readable." })}
      {colorField("Button & link color (optional)", "button_color", ps.primary_color || "#1a6b4a", { clearable: true, hint: "Left empty, buttons use your primary color.", placeholder: "primary" })}

      {group("Type & cards")}
      <div style={lbl}>Type pairing</div>
      <select style={inp} value={ps.type_pairing || "dm"} onChange={e => onSet("type_pairing", e.target.value)}>
        {Object.entries(TYPE_PAIRINGS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
      </select>
      <div style={{ fontSize: 11, color: "#6b6b64", marginTop: 4, lineHeight: 1.4 }}>A curated set — every pairing is pre-licensed and self-hosted, so your page stays fast.</div>
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
      <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, color: "#1c1c1a", cursor: "pointer", marginTop: 8, lineHeight: 1.5 }}>
        <input type="checkbox" checked={ps.powered_by === true} onChange={e => onSet("powered_by", e.target.checked)} style={{ marginTop: 2 }} />
        Show a small "Powered by Steward" line in the footer (off by default — the portal is yours)
      </label>
    </>
  );
}

function WidgetOptions({ w, funds, camps, onChange, onClose }) {
  const head = (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
      <div style={{ fontSize: 13, fontWeight: 700 }}>{WIDGET_META[w.type]?.label}</div>
      <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 13, cursor: "pointer", color: "#6b6b64" }}>Done ✕</button>
    </div>
  );
  const imgUploader = (value, set, label = "Photo") => (
    <>
      <div style={lbl}>{label}</div>
      <Uploader accept={IMAGE_ACCEPT} acceptLabel={IMAGE_ACCEPT_LABEL} maxBytes={IMAGE_MAX_BYTES} compact
        shape="wide" preview={value ? (String(value).startsWith("data:") ? value : resolveAssetUrl(value)) : null}
        label={value ? "Replace" : "Drag a photo here, or browse — or drop one straight onto the widget"}
        onFile={({ dataUrl }) => set(dataUrl)}
        onRemove={() => set(null)} />
    </>
  );
  switch (w.type) {
    case "hero": return <>{head}
      <div style={lbl}>Heading</div><input style={inp} value={w.heading || ""} onChange={e => onChange({ heading: e.target.value })} />
      <div style={lbl}>Subheading</div><textarea style={{ ...inp, resize: "vertical" }} rows={2} value={w.sub || ""} onChange={e => onChange({ sub: e.target.value })} />
      <div style={lbl}>Size</div>
      <select style={inp} value={w.size || "standard"} onChange={e => onChange({ size: e.target.value })}>
        <option value="standard">Standard</option><option value="tall">Tall</option>
      </select>
      {imgUploader(w.image, v => onChange({ image: v }))}</>;
    case "richtext": return <>{head}
      <div style={lbl}>Text <span style={{ fontWeight: 400, textTransform: "none" }}>(blank line = paragraph, "## " heading, "- " list)</span></div>
      <textarea style={{ ...inp, resize: "vertical" }} rows={8} value={storyToText(w.blocks)} onChange={e => onChange({ blocks: textToStory(e.target.value) })} /></>;
    case "image": return <>{head}
      {imgUploader(w.image, v => onChange({ image: v }))}
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
                  style={{ position: "absolute", top: -6, right: -6, background: E.ink, color: "#fff", border: "none", borderRadius: "50%", width: 16, height: 16, fontSize: 9, cursor: "pointer", lineHeight: 1 }}>✕</button>
              </div>
            ))}
          </div>
        )}
      </Uploader></>;
    case "stats": return <>{head}
      <div style={{ fontSize: 12, color: "#6b6b64", lineHeight: 1.5, marginBottom: 4 }}>Your own numbers, in your own words — nothing is computed or invented for you.</div>
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
        <div style={lbl}>Funds — in display order</div>
        {chosen.map((f, i) => (
          <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff", border: "1px solid #e0dcd0", borderRadius: 8, padding: "6px 8px", marginBottom: 4 }}>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
            <button aria-label={`Move ${f.name} up`} disabled={i === 0} onClick={() => moveFund(i, -1)} style={{ background: "none", border: "1px solid #e0dcd0", borderRadius: 6, width: 24, height: 22, fontSize: 11, cursor: i === 0 ? "default" : "pointer", opacity: i === 0 ? 0.35 : 1 }}>↑</button>
            <button aria-label={`Move ${f.name} down`} disabled={i === chosen.length - 1} onClick={() => moveFund(i, +1)} style={{ background: "none", border: "1px solid #e0dcd0", borderRadius: 6, width: 24, height: 22, fontSize: 11, cursor: i === chosen.length - 1 ? "default" : "pointer", opacity: i === chosen.length - 1 ? 0.35 : 1 }}>↓</button>
            <button aria-label={`Remove ${f.name}`} onClick={() => onChange({ fundIds: (w.fundIds || []).filter(x => x !== f.id) })} style={{ background: "none", border: "none", color: E.terra, fontSize: 12, cursor: "pointer" }}>✕</button>
          </div>
        ))}
        {!chosen.length && <div style={{ fontSize: 12, color: "#6b6b64", marginBottom: 4 }}>Nothing selected yet — the first fund you add leads the section.</div>}
        {chosen.length >= 6 && <div style={{ fontSize: 11.5, color: "#6b6b64", marginBottom: 4 }}>Up to 6 funds show here.</div>}
        {unchosen.length > 0 && chosen.length < 6 && <>
          <div style={lbl}>Add a fund</div>
          {unchosen.map(f => (
            <button key={f.id} onClick={() => onChange({ fundIds: [...(w.fundIds || []), f.id].slice(0, 6) })}
              style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "1px dashed " + E.bg3, borderRadius: 8, padding: "6px 10px", marginBottom: 4, fontSize: 13, cursor: "pointer" }}>
              + {f.name}
            </button>
          ))}
        </>}
        {!funds.length && <div style={{ fontSize: 12, color: "#6b6b64" }}>No funds yet — create them in Finance.</div>}
        <div style={{ fontSize: 12, color: "#6b6b64", marginTop: 10, lineHeight: 1.5 }}>
          Each card's Give button carries that fund as the gift's designation.
        </div>
      </>;
    }
    case "campaign": return <>{head}
      <div style={lbl}>Campaign</div>
      <select style={inp} value={w.campaignId || ""} onChange={e => onChange({ campaignId: e.target.value })}>
        <option value="">— pick a campaign —</option>
        {camps.map(c => <option key={c.id} value={c.id}>{c.donorFacingName || c.name}</option>)}
      </select>
      <div style={{ fontSize: 12, color: "#6b6b64", marginTop: 8, lineHeight: 1.5 }}>
        The story, photo, and goal come from the campaign itself — edit them in Fundraising. A campaign with no donor-facing content shows nothing here.
      </div></>;
    case "impact": return <>{head}
      <div style={lbl}>Heading</div><input style={inp} value={w.heading || ""} onChange={e => onChange({ heading: e.target.value })} /></>;
    case "quote": return <>{head}
      <div style={lbl}>Quote</div><textarea style={{ ...inp, resize: "vertical" }} rows={3} value={w.text || ""} onChange={e => onChange({ text: e.target.value })} />
      <div style={lbl}>Attribution</div><input style={inp} value={w.attribution || ""} onChange={e => onChange({ attribution: e.target.value })} /></>;
    case "staff": return <>{head}
      {(w.members || []).map((m, i) => (
        <div key={i} style={{ border: "1px solid #e0dcd0", borderRadius: 8, padding: 8, marginTop: 8 }}>
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
        <div key={i} style={{ border: "1px solid #e0dcd0", borderRadius: 8, padding: 8, marginTop: 8 }}>
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
      <div style={{ fontSize: 12, color: "#6b6b64", marginTop: 6, lineHeight: 1.5 }}>Only YouTube and Vimeo links work — the video ID is stored, never pasted embed code.</div>
      <div style={lbl}>Caption</div><input style={inp} value={w.caption || ""} onChange={e => onChange({ caption: e.target.value })} /></>;
    case "give": return <>{head}
      <div style={lbl}>Heading</div><input style={inp} value={w.heading || ""} onChange={e => onChange({ heading: e.target.value })} />
      <div style={lbl}>Button label</div><input style={inp} value={w.buttonLabel || ""} onChange={e => onChange({ buttonLabel: e.target.value })} /></>;
    case "mygiving": return <>{head}
      <div style={{ fontSize: 12.5, color: "#6b6b64", lineHeight: 1.6 }}>
        Signed-in donors see their own giving history, recurring gifts, and receipts here.
        On the public page it shows a sign-in prompt instead. Nothing to configure.
      </div></>;
    default: return head;
  }
}
