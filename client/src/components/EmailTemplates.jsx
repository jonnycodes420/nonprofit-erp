// EmailTemplates.jsx · EMAIL-1. THE EMAIL TEMPLATE LIBRARY AND ITS EDITOR.
//
// The library opens on emails somebody could send (shared/emailTemplateLibrary.js),
// never a blank box. Opening one saves a copy for this org; the editor is a
// list of blocks (the same widgets a page uses, surface "email"), and the
// preview on the right is the server's own render with the org's live brand,
// in a sandboxed iframe at 600 or 375 wide, light or dark. Nothing here sends
// to a donor: "Send me a test" goes to the person pressing it, and "Draft with
// AI" shows proposed words for approval before anything changes.
//
// Steward's own chrome uses the T tokens only. The org's brand colours appear
// only inside the rendered email in the iframe, which is the org's surface.
import { useState, useEffect, useRef, useCallback, lazy, Suspense } from "react";
import { apiFetch } from "../api";
import { T, Spin, activeMark } from "./shared";
import { TemplateEditor } from "./BrandKit";
import { offerUndo } from "./EditHistory";
import { askConfirm } from "./ConfirmDialog";
import { errorMessage } from "../lib/domainError";
import MediaPicker from "./MediaPicker";

// MediaLibrary and BrandPanel come from the media part of this build. They are
// found by glob so this screen builds before they land and picks them up after.
const MEDIA_MODULES = import.meta.glob(["./MediaLibrary.jsx", "./BrandPanel.jsx"]);
const LazyMediaLibrary = MEDIA_MODULES["./MediaLibrary.jsx"] ? lazy(MEDIA_MODULES["./MediaLibrary.jsx"]) : null;
const LazyBrandPanel = MEDIA_MODULES["./BrandPanel.jsx"] ? lazy(MEDIA_MODULES["./BrandPanel.jsx"]) : null;

const BUTTON_ACTIONS = [
  { id: "give", label: "Give" }, { id: "rsvp", label: "RSVP" },
  { id: "volunteer", label: "Volunteer" }, { id: "readmore", label: "Read more" },
];
const card = { background: T.white, border: `1px solid ${T.bg2}`, borderRadius: 12, padding: "16px 18px" };
const label = { display: "block", fontSize: 12, fontWeight: 700, color: T.ink3, margin: "10px 0 4px" };
const input = { width: "100%", boxSizing: "border-box", border: `1px solid ${T.bg3}`, borderRadius: 8, padding: "8px 10px", fontSize: 14, fontFamily: "inherit", color: T.ink, background: T.white };
const btn = {
  primary: { background: T.green, color: T.white, border: "none", borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" },
  quiet: { background: "transparent", color: T.ink, border: `1px solid ${T.bg3}`, borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  small: { background: "transparent", color: T.ink, border: `1px solid ${T.bg2}`, borderRadius: 6, padding: "3px 8px", fontSize: 12, cursor: "pointer" },
};
const problemBox = { background: T.bg, border: `1px solid ${T.gold}`, borderRadius: 8, padding: "10px 12px", fontSize: 13, color: T.ink };
const say = (e, fallback) => (e && e.sentence) || errorMessage(e, fallback);
let keySeq = 0;
const withKeys = blocks => (blocks || []).map(b => ({ ...b, _k: `k${++keySeq}` }));
const stripKeys = blocks => blocks.map(b => { const c = { ...b }; delete c._k; return c; });

// ── THE SECTIONS ────────────────────────────────────────────────────────────
// WIRE-1-ADDENDUM: one Templates tab. Three stores feed it and none of them is
// merged: the letters and thank-yous (message_templates, COMMS-2), the campaign
// starters (shared/emailTemplates.js, opened in New Campaign) and the designed
// emails (email_templates plus the EMAIL-1 starters). The view sorts every one
// into four sections by the key it already has. The rule, in order:
//   1. a known key (per store, because "year_end" is a statement in one store
//      and an appeal in another) names its section;
//   2. otherwise its name and purpose are read: grant, funder or foundation is
//      Grants and funders; event, volunteer, RSVP or gala is Events and
//      volunteers; thank, receipt, statement or welcome is Thank-yous;
//   3. anything left is Appeals and campaigns, the closest home for a message
//      that asks for something (the lapsed-donor note lands here by this rule).
export const TEMPLATE_SECTIONS = [
  { id: "thanks", label: "Thank-yous and receipts" },
  { id: "appeals", label: "Appeals and campaigns" },
  { id: "events", label: "Events and volunteers" },
  { id: "grants", label: "Grants and funders" },
];
const SECTION_BY_KEY = {
  letter: {
    thanks_first: "thanks", thanks_renewal: "thanks", thanks_monthly: "thanks", thanks_major: "thanks",
    thanks_memorial: "thanks", receipt: "thanks", year_end: "thanks", lapsed: "appeals",
    event_followup: "events", volunteer_thanks: "events",
  },
  campaign: {
    appeal: "appeals", monthly_appeal: "appeals", year_end: "appeals", newsletter: "appeals", sponsor_update: "appeals",
    thank_you: "thanks", event_invitation: "events",
  },
  designed: {
    year_end_appeal: "appeals", spring_appeal: "appeals", impact_report: "appeals", p2p_share: "appeals", membership_renewal: "appeals",
    thank_you: "thanks", first_gift_welcome: "thanks", monthly_welcome: "thanks", failed_card: "thanks",
    event_invitation: "events", event_thank_you: "events", volunteer_thank_you: "events",
    grant_funder_update: "grants",
  },
};
export function templateSection(store, key, words) {
  const known = SECTION_BY_KEY[store] && key ? SECTION_BY_KEY[store][key] : null;
  if (known) return known;
  const w = String(words || "").toLowerCase();
  if (/grant|funder|foundation/.test(w)) return "grants";
  if (/event|volunteer|rsvp|gala/.test(w)) return "events";
  if (/thank|receipt|statement|welcome/.test(w)) return "thanks";
  return "appeals";
}

const tplCard = { ...card, display: "flex", flexDirection: "column", gap: 6, minWidth: 0 };
const openArea = { background: "none", border: "none", padding: 0, margin: 0, textAlign: "left", cursor: "pointer", fontFamily: "inherit", display: "flex", flexDirection: "column", gap: 4, color: T.ink, width: "100%" };
const mediumStyle = { fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: T.ink3 };
const reviewedStyle = on => ({ fontSize: 12, fontWeight: 700, color: on ? T.greenDk : T.gold700 });

// ── THE LIBRARY ─────────────────────────────────────────────────────────────
// Props from Communications: the campaign starters it already loaded (and the
// builder that opens one), the people to preview a letter with, and the way to
// Drafts to review.
export default function EmailTemplates({ isReadOnly, donors = [], campaignStarters = [], previewSubject, onUseCampaign, onOpenDrafts }) {
  const [tab, setTab] = useState("templates");
  const [data, setData] = useState(null);
  const [letters, setLetters] = useState(null);
  const [err, setErr] = useState("");
  const [openId, setOpenId] = useState(null);
  const [openLetter, setOpenLetter] = useState(null);
  const [busy, setBusy] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(() => {
    apiFetch("/email-templates").then(d => { setData(d); setErr(""); }).catch(e => setErr(say(e, "The templates could not be loaded.")));
  }, []);
  const loadLetters = useCallback(() => {
    apiFetch("/templates").then(setLetters).catch(() => setLetters({ templates: [], mergeFields: [] }));
  }, []);
  useEffect(() => { load(); loadLetters(); }, [load, loadLetters]);

  const start = async body => {
    setBusy(body.starterKey || body.copyOf || "x");
    try {
      const r = await apiFetch("/email-templates", { method: "POST", body: JSON.stringify(body) });
      const id = r.template.id;
      offerUndo({ message: `Saved "${r.template.name}" to your templates.`, undoAction: async () => {
        const x = await apiFetch(`/email-templates/${id}/archive`, { method: "POST", body: "{}" }); setOpenId(null); load(); return x;
      } }, "template");
      load(); setOpenId(id);
    } catch (e) { setErr(say(e, "That template could not be started.")); }
    setBusy("");
  };
  const archive = async t => {
    try {
      await apiFetch(`/email-templates/${t.id}/archive`, { method: "POST", body: "{}" });
      offerUndo({ message: `Archived "${t.name}".`, undoAction: async () => {
        const x = await apiFetch(`/email-templates/${t.id}/restore`, { method: "POST", body: "{}" }); load(); return x;
      } }, "template");
      load();
    } catch (e) { setErr(say(e, "It could not be archived.")); }
  };
  const restore = async t => {
    try {
      await apiFetch(`/email-templates/${t.id}/restore`, { method: "POST", body: "{}" });
      offerUndo({ message: `Restored "${t.name}".`, undoAction: async () => {
        const x = await apiFetch(`/email-templates/${t.id}/archive`, { method: "POST", body: "{}" }); load(); return x;
      } }, "template");
      load();
    } catch (e) { setErr(say(e, "It could not be restored.")); }
  };

  const open = data && openId ? (data.templates || []).find(t => t.id === openId) : null;
  if (open) {
    return <EmailEditor key={open.id} template={open} isReadOnly={isReadOnly} blockTypes={data.blockTypes || []}
      mergeFields={data.mergeFields || []} onBack={() => { setOpenId(null); load(); }} onSaved={load} />;
  }

  const tabs = [{ id: "templates", label: "Templates" }, { id: "brand", label: "Brand" }, { id: "media", label: "Media library" }];
  const live = (data?.templates || []).filter(t => !t.archived);
  const archived = (data?.templates || []).filter(t => t.archived);

  // Every template, from every store, as one list of cards. `medium` is what
  // the card says first: a printed letter or an email.
  const cards = [];
  for (const t of (letters?.templates || [])) {
    cards.push({ id: "letter-" + t.kind, store: "letter", section: templateSection("letter", t.kind, t.label),
      name: t.label, medium: t.channel === "letter" ? "Printed letter" : "Email",
      how: t.channel === "letter" ? "Prints with this person's details" : "To one person, as a draft you send",
      review: t.reviewed ? `Reviewed${t.reviewedBy ? " by " + t.reviewedBy : ""}` : "Not yet reviewed", reviewed: !!t.reviewed,
      onOpen: () => setOpenLetter(t), openLabel: "Open" });
  }
  for (const t of live) {
    cards.push({ id: "designed-" + t.id, store: "designed", section: templateSection("designed", t.starterKey, `${t.name} ${t.purpose || ""}`),
      name: t.name, medium: "Email", how: t.subject || t.purpose || "Designed with your brand",
      review: "In your templates", reviewed: true, onOpen: () => setOpenId(t.id), openLabel: "Open", designed: t });
  }
  for (const t of campaignStarters) {
    cards.push({ id: "campaign-" + t.key, store: "campaign", section: templateSection("campaign", t.key, `${t.label} ${t.blurb || ""}`),
      name: t.label, medium: "Email", how: previewSubject ? previewSubject(t.subject) : t.subject,
      review: t.reviewed ? "Reviewed" : "Not yet reviewed", reviewed: !!t.reviewed,
      onOpen: isReadOnly || !onUseCampaign ? null : () => onUseCampaign(t), openLabel: "Start a campaign" });
  }
  for (const s of (data?.starters || [])) {
    cards.push({ id: "starter-" + s.starterKey, store: "designed", section: templateSection("designed", s.starterKey, `${s.name} ${s.purpose || ""}`),
      name: s.name, medium: "Email", how: s.purpose,
      review: "Not yet reviewed", reviewed: false,
      onOpen: isReadOnly || busy ? null : () => start({ starterKey: s.starterKey }),
      openLabel: busy === s.starterKey ? "Starting…" : "Start from this" });
  }
  const loading = !data || !letters;

  return (
    <div style={{ padding: "4px 0 40px", display: "flex", flexDirection: "column", gap: 14 }} data-testid="templates-merged">
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: T.ink }}>Templates</h2>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} role="tablist">
        {tabs.map(t => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            style={{ ...btn.quiet, ...activeMark(tab === t.id, "bottom") }}>{t.label}</button>
        ))}
      </div>
      {err && <div style={problemBox}>{err}</div>}

      {tab === "brand" && (LazyBrandPanel
        ? <Suspense fallback={<Spin />}><LazyBrandPanel onChanged={load} /></Suspense>
        : <div style={card}>Your brand (logo, colours and type) is set on your donor page settings, and every email reads it when it is shown or sent.</div>)}
      {tab === "media" && (LazyMediaLibrary
        ? <Suspense fallback={<Spin />}><LazyMediaLibrary /></Suspense>
        : <div style={card}>Your photos and videos will be kept here, ready for any email or page.</div>)}

      {tab === "templates" && (loading ? <Spin /> : (
        <>
          <p style={{ fontSize: 13, color: T.ink3, margin: 0, lineHeight: 1.55, maxWidth: "70ch" }}>
            Each one starts in Steward's words and says "Not yet reviewed" until someone here has read it and saved it in yours.
            A letter prints. An email to one person becomes a draft for you to send, and a designed email opens with your brand, blocks and photos.
          </p>
          {openLetter && letters && (
            <TemplateEditor t={openLetter} fields={letters.mergeFields || []} donors={donors} isReadOnly={isReadOnly} onOpenDrafts={onOpenDrafts}
              onClose={() => setOpenLetter(null)} onSaved={t => { setOpenLetter(t); loadLetters(); }} />
          )}
          {TEMPLATE_SECTIONS.map(sec => {
            const mine = cards.filter(c => c.section === sec.id);
            return (
              <section key={sec.id} data-template-section={sec.id} style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: T.ink }}>{sec.label}</h3>
                {mine.length === 0 ? (
                  <div style={{ fontSize: 13, color: T.ink3 }}>Nothing here yet. A template for this lands here once one is saved.</div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(100%,250px),1fr))", gap: 10 }}>
                    {mine.map(c => (
                      <div key={c.id} style={tplCard} data-template-card={c.store} data-template-id={c.id}>
                        <button type="button" style={{ ...openArea, cursor: c.onOpen ? "pointer" : "default" }} disabled={!c.onOpen}
                          aria-label={`${c.openLabel}: ${c.name}`} onClick={c.onOpen || undefined}>
                          <span style={mediumStyle} data-template-medium>{c.medium}</span>
                          <span style={{ fontSize: 14.5, fontWeight: 700, color: T.ink, overflowWrap: "anywhere" }}>{c.name}</span>
                          <span style={{ fontSize: 12, color: T.ink3, overflowWrap: "anywhere" }}>{c.how}</span>
                          <span data-reviewed={c.reviewed ? "1" : "0"} style={reviewedStyle(c.reviewed)}>{c.review}</span>
                          {c.onOpen && <span style={{ fontSize: 13, fontWeight: 700, color: T.ink, marginTop: 4 }}>{c.openLabel} &rarr;</span>}
                        </button>
                        {c.designed && (
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                            <button style={btn.small} disabled={isReadOnly || !!busy} onClick={() => start({ copyOf: c.designed.id })}>Copy</button>
                            <button style={btn.small} disabled={isReadOnly} onClick={() => archive(c.designed)}>Archive</button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
          {!!archived.length && (
            <div style={{ marginTop: 12 }}>
              <button style={btn.small} onClick={() => setShowArchived(v => !v)}>{showArchived ? "Hide" : "Show"} archived ({archived.length})</button>
              {showArchived && archived.map(t => (
                <div key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${T.bg2}`, fontSize: 13 }}>
                  <span>{t.name}</span>
                  <button style={btn.small} disabled={isReadOnly} onClick={() => restore(t)}>Restore</button>
                </div>
              ))}
            </div>
          )}
        </>
      ))}
    </div>
  );
}

// ── THE EDITOR ──────────────────────────────────────────────────────────────
export function EmailEditor({ template, isReadOnly, blockTypes, mergeFields, onBack, onSaved }) {
  const [name, setName] = useState(template.name);
  const [subject, setSubject] = useState(template.subject);
  const [preheader, setPreheader] = useState(template.preheader);
  const [blocks, setBlocks] = useState(() => withKeys(template.blocks));
  const [saved, setSaved] = useState(template);
  const [device, setDevice] = useState("desktop");
  const [dark, setDark] = useState(false);
  const [preview, setPreview] = useState({ html: "", problems: [], loading: true });
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState(null);   // { kind, onPick }
  const [ai, setAi] = useState(null);           // { loading, proposals, sentence, chosen:Set }
  const [aiAsk, setAiAsk] = useState("");
  const [addType, setAddType] = useState("");
  const [events, setEvents] = useState([]);
  const [pages, setPages] = useState([]);
  const previewSeq = useRef(0);

  useEffect(() => {
    apiFetch("/events").then(r => setEvents(Array.isArray(r) ? r : [])).catch(() => setEvents([]));
    apiFetch("/giving-pages").then(r => setPages(Array.isArray(r) ? r : [])).catch(() => setPages([]));
  }, []);

  const dirty = name !== saved.name || subject !== saved.subject || preheader !== saved.preheader
    || JSON.stringify(stripKeys(blocks)) !== JSON.stringify(saved.blocks);

  // The preview is the server's render of what is on the screen now.
  useEffect(() => {
    const seq = ++previewSeq.current;
    const t = setTimeout(() => {
      apiFetch(`/email-templates/${template.id}/preview`, { method: "POST",
        body: JSON.stringify({ blocks: stripKeys(blocks), subject, preheader, device, dark }) })
        .then(r => { if (seq === previewSeq.current) setPreview({ html: r.html, problems: r.problems || [], loading: false }); })
        .catch(e => { if (seq === previewSeq.current) setPreview(p => ({ ...p, loading: false, problems: [say(e, "The preview could not be drawn.")] })); });
    }, 450);
    return () => clearTimeout(t);
  }, [blocks, subject, preheader, device, dark, template.id]);

  const setBlock = (i, patch) => setBlocks(bs => bs.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const move = (i, d) => setBlocks(bs => { const n = [...bs]; const j = i + d; if (j < 0 || j >= n.length) return bs; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const remove = i => setBlocks(bs => bs.filter((_, j) => j !== i));
  const add = type => {
    const def = blockTypes.find(b => b.key === type);
    if (!def) return;
    const fresh = { type, ...JSON.parse(JSON.stringify(def.defaults || {})), _k: `k${++keySeq}` };
    setBlocks(bs => {
      const footAt = bs.findIndex(b => b.type === "footer");
      if (footAt < 0) return [...bs, fresh];
      return [...bs.slice(0, footAt), fresh, ...bs.slice(footAt)];
    });
    setAddType("");
  };

  const save = async () => {
    setSaving(true); setNote("");
    const before = { name: saved.name, subject: saved.subject, preheader: saved.preheader, blocks: saved.blocks };
    try {
      const r = await apiFetch(`/email-templates/${template.id}`, { method: "PUT",
        body: JSON.stringify({ name, subject, preheader, blocks: stripKeys(blocks) }) });
      setSaved(r.template); setBlocks(withKeys(r.template.blocks));
      offerUndo({ message: "Saved the template.", undoAction: async () => {
        const x = await apiFetch(`/email-templates/${template.id}`, { method: "PUT", body: JSON.stringify(before) });
        setSaved(x.template); setName(x.template.name); setSubject(x.template.subject); setPreheader(x.template.preheader); setBlocks(withKeys(x.template.blocks));
        onSaved && onSaved();
        return x;
      } }, "template");
      onSaved && onSaved();
    } catch (e) { setNote(say(e, "It could not be saved.")); }
    setSaving(false);
  };

  const test = async () => {
    setNote("");
    if (dirty) { setNote("Save first, so the test is the email you see."); return; }
    try {
      const r = await apiFetch(`/email-templates/${template.id}/test`, { method: "POST", body: "{}" });
      setNote(r.sentence || (r.sent ? "The test is on its way to you." : "Nothing was sent."));
    } catch (e) { setNote(say(e, "The test could not be sent.")); }
  };

  const draftAi = async () => {
    if (dirty) { setNote("Save first, so the proposal starts from what you see."); return; }
    setAi({ loading: true, proposals: [], sentence: "", chosen: new Set() });
    try {
      const r = await apiFetch(`/email-templates/${template.id}/draft-ai`, { method: "POST", body: JSON.stringify({ instructions: aiAsk }) });
      const changed = (r.proposals || []).filter(p => p.proposed !== p.current);
      setAi({ loading: false, proposals: changed, sentence: r.sentence, source: r.source, chosen: new Set(changed.map(p => p.id)) });
    } catch (e) { setAi({ loading: false, proposals: [], sentence: say(e, "Drafting could not be reached."), chosen: new Set() }); }
  };
  const applyAi = () => {
    const chosen = ai.proposals.filter(p => ai.chosen.has(p.id));
    setBlocks(bs => {
      const n = bs.map(b => ({ ...b, ...(b.blocks ? { blocks: b.blocks.map(x => ({ ...x })) } : {}) }));
      for (const p of chosen) {
        const [i, field, j] = p.id.split(".");
        const b = n[Number(i)];
        if (!b) continue;
        if (field === "blocks" && b.blocks && b.blocks[Number(j)]) b.blocks[Number(j)].text = p.proposed;
        else if (field !== "blocks") b[field] = p.proposed;
      }
      return n;
    });
    setAi(null);
    setNote("The proposed words are in the editor. Read them, then press Save to keep them.");
  };

  const problems = preview.problems || [];
  // Below 900px the blocks and the preview stack, the preview first, so a
  // phone never scrolls sideways.
  const narrow = typeof window !== "undefined" && window.innerWidth < 900;
  return (
    <div style={{ padding: "4px 0 40px" }} data-testid="email-editor">
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <button style={btn.quiet} onClick={async () => { if (!dirty || await askConfirm({ title: "Leave without saving?", body: "Your changes to this template have not been saved.", yes: "Leave" })) onBack(); }}>Back to templates</button>
        <div style={{ flex: 1 }} />
        <button style={btn.quiet} disabled={isReadOnly} onClick={draftAi}>Draft with AI</button>
        <button style={btn.quiet} disabled={isReadOnly} onClick={test}>Send me a test</button>
        <button style={btn.primary} disabled={isReadOnly || saving || !dirty} onClick={save}>{saving ? "Saving…" : dirty ? "Save" : "Saved"}</button>
      </div>
      {note && <div style={{ ...problemBox, marginBottom: 12 }} role="status">{note}</div>}

      {ai && (
        <div style={{ ...card, marginBottom: 14, borderColor: T.gold }} data-testid="ai-proposals">
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Proposed words</div>
          <label style={label} htmlFor="ai-ask">Anything to ask for (optional)</label>
          <div style={{ display: "flex", gap: 6 }}>
            <input id="ai-ask" style={input} value={aiAsk} onChange={e => setAiAsk(e.target.value)} placeholder="Warmer, shorter, mention the spring garden..." />
            <button style={btn.quiet} onClick={draftAi} disabled={ai.loading}>Ask again</button>
          </div>
          {ai.loading ? <div style={{ padding: 12 }}><Spin /></div> : (
            <>
              <p style={{ fontSize: 13, color: T.ink3 }}>{ai.sentence}</p>
              {ai.proposals.length === 0 && <p style={{ fontSize: 13 }}>No words to change.</p>}
              {ai.proposals.map(p => (
                <label key={p.id} style={{ display: "flex", gap: 10, padding: "8px 0", borderTop: `1px solid ${T.bg2}`, fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={ai.chosen.has(p.id)} onChange={e => setAi(a => { const c = new Set(a.chosen); if (e.target.checked) c.add(p.id); else c.delete(p.id); return { ...a, chosen: c }; })} />
                  <span style={{ flex: 1 }}>
                    <span style={{ display: "block", color: T.ink3, textDecoration: "line-through" }}>{p.current}</span>
                    <span style={{ display: "block", color: T.ink }}>{p.proposed}</span>
                  </span>
                </label>
              ))}
              <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                <button style={btn.primary} disabled={!ai.chosen.size} onClick={applyAi}>Use the ticked words</button>
                <button style={btn.quiet} onClick={() => setAi(null)}>Keep mine</button>
              </div>
            </>
          )}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: narrow ? "minmax(0, 1fr)" : "minmax(300px, 1fr) minmax(320px, 640px)", gap: 18, alignItems: "start" }} className="email-editor-grid">
        <div>
          <div style={card}>
            <label style={{ ...label, marginTop: 0 }} htmlFor="et-name">Template name</label>
            <input id="et-name" style={input} value={name} onChange={e => setName(e.target.value)} />
            <label style={label} htmlFor="et-subject">Subject</label>
            <input id="et-subject" style={input} value={subject} onChange={e => setSubject(e.target.value)} />
            <label style={label} htmlFor="et-pre">Preview line (shown after the subject in the inbox)</label>
            <input id="et-pre" style={input} value={preheader} onChange={e => setPreheader(e.target.value)} />
            <div style={{ fontSize: 12, color: T.ink3, marginTop: 8 }}>Fields you can type: {mergeFields.map(f => f.token).join("  ")}</div>
          </div>

          {blocks.map((b, i) => (
            <div key={b._k} style={{ ...card, marginTop: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.ink, flex: 1 }}>{(blockTypes.find(t => t.key === b.type) || {}).label || b.type}</span>
                <button style={btn.small} aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0}>Up</button>
                <button style={btn.small} aria-label="Move down" onClick={() => move(i, 1)} disabled={i === blocks.length - 1}>Down</button>
                {b.type !== "footer" && <button style={btn.small} onClick={() => remove(i)}>Remove</button>}
              </div>
              <BlockOptions b={b} set={patch => setBlock(i, patch)} events={events} pages={pages}
                pick={(kind, onPick) => setPicker({ kind, onPick })} />
            </div>
          ))}
          <div style={{ ...card, marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
            <label htmlFor="et-add" style={{ fontSize: 13, fontWeight: 700 }}>Add a block</label>
            <select id="et-add" style={{ ...input, width: "auto", flex: 1 }} value={addType} onChange={e => setAddType(e.target.value)}>
              <option value="">Choose…</option>
              {blockTypes.filter(t => t.key !== "footer").map(t => <option key={t.key} value={t.key}>{t.label}: {t.hint}</option>)}
            </select>
            <button style={btn.quiet} disabled={!addType} onClick={() => add(addType)}>Add</button>
          </div>
        </div>

        <div style={{ position: narrow ? "static" : "sticky", top: 12, order: narrow ? -1 : 0, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
            {[["desktop", "Desktop"], ["phone", "Phone"]].map(([id, l]) => (
              <button key={id} style={{ ...btn.small, background: device === id ? T.ink : "transparent", color: device === id ? T.white : T.ink }} aria-pressed={device === id} onClick={() => setDevice(id)}>{l}</button>
            ))}
            <button style={{ ...btn.small, background: dark ? T.ink : "transparent", color: dark ? T.white : T.ink }} aria-pressed={dark} onClick={() => setDark(v => !v)}>Dark mode</button>
            {preview.loading && <Spin />}
          </div>
          {!!problems.length && (
            <div style={{ ...problemBox, marginBottom: 8 }} data-testid="email-problems">
              <div style={{ fontWeight: 700, marginBottom: 4 }}>To fix before this is sent</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>{problems.map((p, k) => <li key={k}>{p}</li>)}</ul>
            </div>
          )}
          <div style={{ background: T.bg2, borderRadius: 12, padding: 10, overflowX: "auto" }}>
            <iframe title="Email preview" sandbox="" srcDoc={preview.html}
              style={{ display: "block", margin: "0 auto", width: device === "phone" ? 375 : 640, maxWidth: "100%", height: 760, border: 0, background: T.white, borderRadius: 8 }} />
          </div>
        </div>
      </div>
      {picker && (
        <MediaPicker kind={picker.kind} onClose={() => setPicker(null)}
          onPick={item => { picker.onPick(item); setPicker(null); }} />
      )}
    </div>
  );
}

// ── ONE BLOCK'S OPTIONS ─────────────────────────────────────────────────────
function PhotoField({ value, alt, onChange, pick, what }) {
  const [paste, setPaste] = useState("");
  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: value ? T.ink : T.ink3, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value || `No ${what} chosen yet`}</span>
        <button style={btn.small} onClick={() => pick("photo", item => onChange({ src: item.url, alt: alt || item.alt || "" }))}>Choose from media</button>
        {value && <button style={btn.small} onClick={() => onChange({ src: null, alt })}>Clear</button>}
      </div>
      {!value && (
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <input style={input} placeholder="or paste an https:// image link" value={paste} onChange={e => setPaste(e.target.value)} />
          <button style={btn.small} disabled={!/^https:\/\//.test(paste)} onClick={() => { onChange({ src: paste.trim(), alt }); setPaste(""); }}>Use</button>
        </div>
      )}
      <label style={label}>Alt text (required: what the photo shows, for people who cannot see it)</label>
      <input style={{ ...input, borderColor: value && !String(alt || "").trim() ? T.gold : T.bg3 }} value={alt || ""} onChange={e => onChange({ src: value, alt: e.target.value })} />
    </div>
  );
}

function BlockOptions({ b, set, pick, events, pages }) {
  switch (b.type) {
    case "header":
      return <div style={{ fontSize: 12, color: T.ink3 }}>Your logo and name, from your brand.</div>;
    case "footer":
      return <div style={{ fontSize: 12, color: T.ink3 }}>Your legal name, mailing address and an unsubscribe link. Always included, whether or not this block is here.</div>;
    case "hero":
      return (
        <>
          <label style={label}>Heading</label>
          <input style={input} value={b.heading || ""} onChange={e => set({ heading: e.target.value })} />
          <label style={label}>Line under it</label>
          <textarea style={{ ...input, minHeight: 60 }} value={b.sub || ""} onChange={e => set({ sub: e.target.value })} />
          <label style={label}>Photo</label>
          <PhotoField value={b.image} alt={b.alt} what="photo" pick={pick} onChange={({ src, alt }) => set({ image: src, alt })} />
        </>
      );
    case "richtext":
      return (
        <>
          {(b.blocks || []).map((p, j) => (
            <div key={j} style={{ marginTop: 6 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <select style={{ ...input, width: "auto", padding: "4px 6px", fontSize: 12 }} value={p.type}
                  onChange={e => set({ blocks: b.blocks.map((x, k) => (k === j ? (e.target.value === "ul" ? { type: "ul", items: [x.text || ""] } : { type: e.target.value, text: x.text || (x.items || []).join(" ") }) : x)) })}>
                  <option value="p">Paragraph</option><option value="h2">Heading</option><option value="ul">List</option>
                </select>
                <div style={{ flex: 1 }} />
                <button style={btn.small} onClick={() => set({ blocks: b.blocks.filter((_, k) => k !== j) })}>Remove</button>
              </div>
              {p.type === "ul"
                ? <textarea style={{ ...input, minHeight: 70, marginTop: 4 }} placeholder="One item per line" value={(p.items || []).join("\n")}
                    onChange={e => set({ blocks: b.blocks.map((x, k) => (k === j ? { type: "ul", items: e.target.value.split("\n") } : x)) })} />
                : <textarea style={{ ...input, minHeight: p.type === "h2" ? 36 : 80, marginTop: 4 }} value={p.text || ""}
                    onChange={e => set({ blocks: b.blocks.map((x, k) => (k === j ? { ...x, text: e.target.value } : x)) })} />}
            </div>
          ))}
          <button style={{ ...btn.small, marginTop: 8 }} onClick={() => set({ blocks: [...(b.blocks || []), { type: "p", text: "" }] })}>Add a paragraph</button>
        </>
      );
    case "image":
      return (
        <>
          <PhotoField value={b.image} alt={b.alt} what="photo" pick={pick} onChange={({ src, alt }) => set({ image: src, alt })} />
          <label style={label}>Caption (optional)</label>
          <input style={input} value={b.caption || ""} onChange={e => set({ caption: e.target.value })} />
        </>
      );
    case "photos2":
      return (
        <>
          {[0, 1].map(k => {
            const im = (b.images || [])[k] || { src: null, alt: "" };
            return (
              <div key={k} style={{ marginTop: k ? 12 : 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>Photo {k + 1}</div>
                <PhotoField value={im.src} alt={im.alt} what="photo" pick={pick}
                  onChange={v => { const ims = [...(b.images || [{ src: null, alt: "" }, { src: null, alt: "" }])]; ims[k] = v; set({ images: ims }); }} />
              </div>
            );
          })}
        </>
      );
    case "stats":
      return (
        <>
          <div style={{ fontSize: 12, color: T.ink3 }}>Your own figures only. A stat left empty is listed as something to fill before a send.</div>
          {(b.items || []).map((s, k) => (
            <div key={k} style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <input style={{ ...input, width: 110 }} placeholder="Number" value={s.value || ""} onChange={e => set({ items: b.items.map((x, j) => (j === k ? { ...x, value: e.target.value } : x)) })} />
              <input style={input} placeholder="What it counts" value={s.label || ""} onChange={e => set({ items: b.items.map((x, j) => (j === k ? { ...x, label: e.target.value } : x)) })} />
              <button style={btn.small} onClick={() => set({ items: b.items.filter((_, j) => j !== k) })}>Remove</button>
            </div>
          ))}
          {(b.items || []).length < 3 && <button style={{ ...btn.small, marginTop: 8 }} onClick={() => set({ items: [...(b.items || []), { value: "", label: "" }] })}>Add a stat</button>}
        </>
      );
    case "quote":
      return (
        <>
          <label style={label}>The words</label>
          <textarea style={{ ...input, minHeight: 60 }} value={b.text || ""} onChange={e => set({ text: e.target.value })} />
          <label style={label}>Who said it</label>
          <input style={input} value={b.attribution || ""} onChange={e => set({ attribution: e.target.value })} />
        </>
      );
    case "video":
      return (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: b.videoId ? T.ink : T.ink3, flex: 1 }}>{b.videoId ? `${b.provider === "vimeo" ? "Vimeo" : "YouTube"} video ${b.videoId}` : "No video chosen yet"}</span>
            <button style={btn.small} onClick={() => pick("video", item => set({ provider: item.provider, videoId: item.videoId, thumbUrl: item.thumbUrl || undefined, caption: b.caption || item.title || "" }))}>Choose from media</button>
          </div>
          <VideoLink onParsed={ref => set(ref)} />
          <div style={{ fontSize: 12, color: T.ink3, marginTop: 6 }}>Inboxes cannot play video, so the email shows its picture with a play button that opens it on your own video page.</div>
          <label style={label}>Caption (also the text for people who cannot see the picture)</label>
          <input style={input} value={b.caption || ""} onChange={e => set({ caption: e.target.value })} />
        </>
      );
    case "button":
      return (
        <>
          <label style={label}>What it does</label>
          <select style={input} value={b.action || "give"} onChange={e => set({ action: e.target.value })}>
            {BUTTON_ACTIONS.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
          <label style={label}>Label</label>
          <input style={input} value={b.label || ""} onChange={e => set({ label: e.target.value })} />
          <label style={label}>Link {b.action === "give" ? "(leave empty for your giving page)" : "(https://...)"}</label>
          <input style={input} value={b.url || ""} onChange={e => set({ url: e.target.value })} />
        </>
      );
    case "event":
      return (
        <>
          <label style={label}>Which event</label>
          <select style={input} value={b.eventId || ""} onChange={e => set({ eventId: e.target.value })}>
            <option value="">Choose one of your events…</option>
            {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}{ev.date ? ` · ${String(ev.date).slice(0, 10)}` : ""}</option>)}
          </select>
        </>
      );
    case "givingpage":
      return (
        <>
          <label style={label}>Which giving page</label>
          <select style={input} value={b.givingPageId || ""} onChange={e => set({ givingPageId: e.target.value })}>
            <option value="">Choose one of your giving pages…</option>
            {pages.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </>
      );
    case "signature":
      return (
        <>
          <label style={label}>Name</label>
          <input style={input} value={b.name || ""} onChange={e => set({ name: e.target.value })} />
          <label style={label}>Title</label>
          <input style={input} value={b.title || ""} onChange={e => set({ title: e.target.value })} />
          <label style={label}>Photo (optional)</label>
          <PhotoField value={b.photo} alt={b.name} what="photo" pick={pick} onChange={({ src }) => set({ photo: src })} />
        </>
      );
    default:
      return null;
  }
}

// A YouTube or Vimeo link, parsed here for the id; the server checks it again.
function VideoLink({ onParsed }) {
  const [v, setV] = useState("");
  const [bad, setBad] = useState(false);
  const parse = () => {
    const s = v.trim();
    let m = /^https?:\/\/(?:www\.|m\.)?youtube\.com\/watch\?(?:[^#]*&)?v=([A-Za-z0-9_-]{6,20})/.exec(s)
      || /^https?:\/\/youtu\.be\/([A-Za-z0-9_-]{6,20})/.exec(s)
      || /^https?:\/\/(?:www\.)?youtube(?:-nocookie)?\.com\/(?:embed|shorts)\/([A-Za-z0-9_-]{6,20})/.exec(s);
    if (m) { onParsed({ provider: "youtube", videoId: m[1], thumbUrl: undefined }); setV(""); setBad(false); return; }
    m = /^https?:\/\/(?:www\.)?vimeo\.com\/(\d{6,12})/.exec(s);
    if (m) { onParsed({ provider: "vimeo", videoId: m[1] }); setV(""); setBad(false); return; }
    setBad(true);
  };
  return (
    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
      <input style={{ ...input, borderColor: bad ? T.gold : T.bg3 }} placeholder="or paste a YouTube or Vimeo link" value={v} onChange={e => { setV(e.target.value); setBad(false); }} />
      <button style={btn.small} disabled={!v.trim()} onClick={parse}>Use</button>
    </div>
  );
}
