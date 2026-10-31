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
import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import { apiFetch } from "../api";
import { T, Spin, activeMark, interactive } from "./shared";
import { TemplateEditor } from "./BrandKit";
import { offerUndo } from "./EditHistory";
import { errorMessage } from "../lib/domainError";
// EDITOR-1: every email opens in the one editor (EmailEditor.jsx, on StewardEditor).
import { EmailEditor, EMAILED_LETTERS } from "./EmailEditor";
import { retryImport } from "../lib/lazyRetry";

// MediaLibrary and BrandPanel come from the media part of this build. They are
// found by glob so this screen builds before they land and picks them up after.
const MEDIA_MODULES = import.meta.glob(["./MediaLibrary.jsx", "./BrandPanel.jsx"]);
const LazyMediaLibrary = MEDIA_MODULES["./MediaLibrary.jsx"] ? lazy(() => retryImport(MEDIA_MODULES["./MediaLibrary.jsx"])) : null;
const LazyBrandPanel = MEDIA_MODULES["./BrandPanel.jsx"] ? lazy(() => retryImport(MEDIA_MODULES["./BrandPanel.jsx"])) : null;

const card = { background: T.white, border: `1px solid ${T.bg2}`, borderRadius: 12, padding: "16px 18px" };
const btn = {
  primary: { background: T.green, color: T.white, border: "none", borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" },
  quiet: { background: "transparent", color: T.ink, border: `1px solid ${T.bg3}`, borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  small: { background: "transparent", color: T.ink, border: `1px solid ${T.bg2}`, borderRadius: 6, padding: "3px 8px", fontSize: 12, cursor: "pointer" },
};
const problemBox = { background: T.bg, border: `1px solid ${T.gold}`, borderRadius: 8, padding: "10px 12px", fontSize: 13, color: T.ink };
const say = (e, fallback) => (e && e.sentence) || errorMessage(e, fallback);

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
    // VOL-PAGE-1 — the volunteer emails, on the same editor and brand.
    volunteer_confirm: "events", volunteer_reminder: "events", volunteer_miss_you: "events", volunteer_group_leader: "events",
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
const openArea = { background: "none", border: "none", padding: 0, margin: 0, textAlign: "left", fontFamily: "inherit", display: "flex", flexDirection: "column", gap: 4, color: T.ink, width: "100%" };
const mediumStyle = { fontSize: 11, fontWeight: 700, color: T.ink3 };
const reviewedStyle = on => ({ fontSize: 12, fontWeight: 700, color: on ? T.greenDk : T.gold700 });

// ── THE LIBRARY ─────────────────────────────────────────────────────────────
// Props from Communications: the campaign starters it already loaded (and the
// builder that opens one), the people to preview a letter with, and the way to
// Drafts to review.
// FIX-39: `openTemplateId` opens that one template straight away (an "Edit in
// editor" from a journey, a campaign or a draft), and `onBackFromOpen` is where
// its Back goes: to the screen that opened it, not to this library.
export default function EmailTemplates({ isReadOnly, donors = [], campaignStarters = [], previewSubject, onOpenCampaigns, onOpenDrafts, openTemplateId = null, onBackFromOpen = null, openTitle = null, openBackLabel = null }) {
  const [tab, setTab] = useState("templates");
  const [data, setData] = useState(null);
  const [letters, setLetters] = useState(null);
  const [err, setErr] = useState("");
  const [openId, setOpenId] = useState(openTemplateId || null);
  const [openedFrom, setOpenedFrom] = useState(openTemplateId && onBackFromOpen ? openTemplateId : null);
  useEffect(() => { if (openTemplateId) { setOpenId(openTemplateId); if (onBackFromOpen) setOpenedFrom(openTemplateId); } }, [openTemplateId]);   // eslint-disable-line react-hooks/exhaustive-deps
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
      if (r.existing) { load(); setOpenId(id); setBusy(""); return; }
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
    const letter = open.personKind && EMAILED_LETTERS.has(open.personKind) ? (letters?.templates || []).find(t => t.kind === open.personKind) : null;
    return <EmailEditor key={open.id} template={open} isReadOnly={isReadOnly} blockTypes={data.blockTypes || []}
      mergeFields={open.mergeFields || data.mergeFields || []} onOpenDrafts={onOpenDrafts} onOpenCampaigns={onOpenCampaigns}
      onOpenBrand={openedFrom === open.id ? null : () => { setOpenId(null); setTab("brand"); }}
      onQuickPrint={letter ? () => { setOpenId(null); setOpenLetter(letter); } : null}
      backLabel={openedFrom === open.id ? (openBackLabel || "Back") : "Back to templates"}
      title={openedFrom === open.id ? openTitle : null}
      onBack={() => { if (openedFrom === open.id && onBackFromOpen) { setOpenedFrom(null); setOpenId(null); onBackFromOpen(); return; } setOpenId(null); load(); }}
      onSaved={() => { load(); loadLetters(); }} />;
  }

  // FIX-56 · A LETTER OPENS IN PLACE OF THE LIBRARY. It used to open above the
  // four sections, out of sight of a card further down, so pressing a card
  // looked like nothing happened.
  if (openLetter && letters) {
    return (
      <div style={{ padding: "4px 0 40px", display: "flex", flexDirection: "column", gap: 14 }} data-testid="letter-quick-edit">
        <div><button style={btn.quiet} onClick={() => setOpenLetter(null)}>Back to templates</button></div>
        <TemplateEditor t={openLetter} fields={letters.mergeFields || []} donors={donors} isReadOnly={isReadOnly} onOpenDrafts={onOpenDrafts}
          onClose={() => setOpenLetter(null)} onSaved={t => { setOpenLetter(t); loadLetters(); }} />
      </div>
    );
  }

  const tabs = [{ id: "templates", label: "Templates" }, { id: "brand", label: "Brand" }, { id: "media", label: "Media library" }];
  const live = (data?.templates || []).filter(t => !t.archived);
  const archived = (data?.templates || []).filter(t => t.archived);
  // FIX-30 · EVERY EMAIL OPENS IN THE EMAIL EDITOR. A one-person email and a
  // campaign starter open as a saved template of their own (person_<kind>,
  // campaign_<key>): the first open makes it from the org's current words,
  // later opens find the same one. Their cards stay where they always were,
  // so the bridged template is not listed a second time below.
  const BRIDGED = /^(person|campaign)_/;
  const openBridged = key => {
    const had = live.find(t => t.starterKey === key);
    if (had) setOpenId(had.id); else start({ starterKey: key });
  };

  // Every template, from every store, as one list of cards. `medium` is what
  // the card says first: a printed letter or an email.
  const cards = [];
  // FIX-56: a thank-you is a printed letter AND the words of the thank-you
  // task's email, so it opens in the email editor like every email and keeps
  // "Quick edit and print" for the letter. Only a letter that is never emailed
  // (the lapsed note) opens the letter editor, and its card says so.
  for (const t of (letters?.templates || [])) {
    const isLetter = t.channel === "letter", emailed = !isLetter || EMAILED_LETTERS.has(t.kind);
    cards.push({ id: "letter-" + t.kind, store: emailed ? "person" : "letter", section: templateSection("letter", t.kind, t.label),
      name: t.label, medium: !isLetter ? "Email" : emailed ? "Email and printed letter" : "Printed letter", editor: emailed ? "email" : "letter",
      how: !isLetter ? "To one person, as a draft you send" : emailed ? "A draft you send, or a letter you print" : "Prints with this person's details",
      review: t.reviewed ? `Reviewed${t.reviewedBy ? " by " + t.reviewedBy : ""}` : "Not yet reviewed", reviewed: !!t.reviewed,
      onOpen: !emailed ? () => setOpenLetter(t) : (isReadOnly && !live.some(x => x.starterKey === "person_" + t.kind)) || busy ? null : () => openBridged("person_" + t.kind),
      openLabel: !emailed ? "Edit letter" : busy === "person_" + t.kind ? "Opening…" : "Edit in editor",
      quick: isLetter && emailed ? t : null });
  }
  for (const t of live) {
    if (BRIDGED.test(t.starterKey || "")) continue;
    cards.push({ id: "designed-" + t.id, store: "designed", section: templateSection("designed", t.starterKey, `${t.name} ${t.purpose || ""}`),
      name: t.name, medium: "Email", how: (t.subject && previewSubject ? previewSubject(t.subject) : t.subject) || t.purpose || "Designed with your brand", editor: "email",
      review: "In your templates", reviewed: true, onOpen: () => setOpenId(t.id), openLabel: "Edit in editor", designed: t });
  }
  for (const t of campaignStarters) {
    cards.push({ id: "campaign-" + t.key, store: "campaign", section: templateSection("campaign", t.key, `${t.label} ${t.blurb || ""}`),
      name: t.label, medium: "Email", how: previewSubject ? previewSubject(t.subject) : t.subject, editor: "email",
      review: t.reviewed ? "Reviewed" : "Not yet reviewed", reviewed: !!t.reviewed,
      onOpen: (isReadOnly && !live.some(x => x.starterKey === "campaign_" + t.key)) || busy ? null : () => openBridged("campaign_" + t.key),
      openLabel: busy === "campaign_" + t.key ? "Opening…" : "Edit in editor" });
  }
  // SWEEP-3: a designed starter with the same name as a card already listed
  // ("Thank you" beside "Thank-you", two "Event invitation"s) is not offered twice.
  const sameName = n => String(n || "").toLowerCase().replace(/[^a-z]/g, "");
  const listed = new Set(cards.map(c => sameName(c.name)));
  for (const s of (data?.starters || [])) {
    if (listed.has(sameName(s.name))) continue;
    cards.push({ id: "starter-" + s.starterKey, store: "designed", section: templateSection("designed", s.starterKey, `${s.name} ${s.purpose || ""}`),
      name: s.name, medium: "Email", how: s.purpose, editor: "email",
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
        : <div style={card}>Your brand (logo, colors and type) is set on your donor page settings, and every email reads it when it is shown or sent.</div>)}
      {tab === "media" && (LazyMediaLibrary
        ? <Suspense fallback={<Spin />}><LazyMediaLibrary /></Suspense>
        : <div style={card}>Your photos and videos will be kept here, ready for any email or page.</div>)}

      {tab === "templates" && (loading ? <Spin /> : (
        <>
          <p style={{ fontSize: 13, color: T.ink3, margin: 0, lineHeight: 1.55, maxWidth: "70ch" }}>
            Each one starts in Steward's words and says "Not yet reviewed" until someone here has read it and saved it in yours.
            A letter prints. An email to one person becomes a draft for you to send, and a designed email opens with your brand, blocks and photos.
          </p>
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
                      <div key={c.id} style={tplCard} data-template-card={c.store} data-template-id={c.id} data-template-editor={c.editor}
                        {...interactive(c.onOpen || null, { label: `${c.openLabel}: ${c.name}` })}>
                        <div style={openArea}>
                          <span style={mediumStyle} data-template-medium>{c.medium}</span>
                          <span style={{ fontSize: 14.5, fontWeight: 700, color: T.ink, overflowWrap: "anywhere" }}>{c.name}</span>
                          <span style={{ fontSize: 12, color: T.ink3, overflowWrap: "anywhere" }}>{c.how}</span>
                          <span data-reviewed={c.reviewed ? "1" : "0"} style={reviewedStyle(c.reviewed)}>{c.review}</span>
                          {c.onOpen && <span data-testid={c.openLabel === "Edit in editor" ? "edit-in-editor" : undefined} style={{ fontSize: 13, fontWeight: 700, color: T.ink, marginTop: 4 }}>{c.openLabel} &rarr;</span>}
                        </div>
                        {c.quick && (
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                            <button style={btn.small} data-testid="quick-edit" onClick={() => setOpenLetter(c.quick)}>Quick edit and print</button>
                          </div>
                        )}
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
