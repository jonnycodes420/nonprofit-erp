// EmailEditor.jsx · EDITOR-1, BUILDER-1. EVERY EMAIL, IN THE ONE EDITOR.
//
// A one-person email (a thank-you, a receipt, the year-end statement, a
// welcome, Update your card), a designed email, a campaign starter and a
// journey step's email all open in StewardEditor. From BUILDER-1 (24 Nov, on
// Jonathan's word, mockup D) that is its builder layout:
//
//   Left pane   Elements (a tile per block an email may hold), Blocks (saved
//               sections, BUILDER-2), Fields (each personal field with what it
//               holds for the person previewed).
//   The email   the server's own render (shared/emailBlocks.js), on cream,
//               typed in where the words show. A click selects a block: an
//               emerald outline, its name, and up, down, duplicate, remove.
//   Right pane  the whole email, small, then the selected block's Edit and
//               Style; with nothing selected, this email's own settings
//               (name, subject, preview line, who it's from, background) and
//               what it is checked against.
//
// Undo and Redo (and Cmd/Ctrl-Z) go back to the last save. History is the
// saved versions, unchanged. The parts live in ./email-builder/. Nothing here
// sends to a donor: "Send me a test" goes to the person pressing it.
import { useState, useEffect, useRef, useMemo } from "react";
import { apiFetch } from "../api";
import { usePeoplePicker } from "../lib/people";
import { useLatestSearch, personStillMatches } from "../lib/latestSearch";   // POLISH-9: the never-given half, kept off the shell's people.js
import { T, Spin } from "./shared";
import { offerUndo } from "./EditHistory";
import { askConfirm } from "./ConfirmDialog";
import { errorMessage } from "../lib/domainError";
import StewardEditor, { useNarrow, railInput, railQuietBtn, railNote, builderQuiet } from "./StewardEditor";
import { previewAsParam } from "../lib/previewAs";   // GIFTS-2: one rule for who a preview is drawn for
import { pastGivingFlag } from "../../../shared/pastGiving.js";   // FLOWS-12 item 1
import { useBuilderWorkspace } from "./email-builder/useBuilderWorkspace";
import { stripKeys } from "./email-builder/useEmailBuilder";
import { PageBackground } from "./email-builder/Panes";
import { Sec, paneInput, paneBtn, paneNote } from "./email-builder/controls";
// The builder's parts, under the names other screens already import.
export { EmailFrame, insertChip, setAtPath } from "./email-builder/EmailFrame";
export { withKeys, stripKeys } from "./email-builder/useEmailBuilder";

const say = (e, fallback) => (e && e.sentence) || errorMessage(e, fallback);
// FIX-56: the printed thank-yous that are also the thank-you task's email.
export const EMAILED_LETTERS = new Set(["thanks_first", "thanks_renewal", "thanks_major", "thanks_memorial"]);
const KIND_BADGE = { receipt: "Receipt", year_end: "Year-end statement", thanks_monthly: "Welcome", volunteer_thanks: "Thank-you" };
export function emailBadge(template) {
  if (!template) return "Email";
  if (template.personKind) return KIND_BADGE[template.personKind] || (/^thanks_/.test(template.personKind) ? "Thank-you" : /^volunteer_/.test(template.personKind) ? "Volunteer email" : "One-person email");
  if (/^campaign_/.test(template.starterKey || "")) return "Campaign starter";
  return "Email template";
}
export const PROBLEM_BOX = { background: T.gold50, border: "1px solid " + T.gold300, borderRadius: 8, padding: "10px 12px", fontSize: 12.5, color: T.ink, lineHeight: 1.5 };

// ── PREVIEW AS ─────────────────────────────────────────────────────────────
export function PreviewAs({ as, onPick, bar = false }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [givers, loading1] = usePeoplePicker(q, { match: "name", limit: 8, emptyToo: true });
  // POLISH-9: people who never gave, on their own (the no-gift version of the email), never crowded out by givers
  const term = q.trim();
  const [never, loading2] = useLatestSearch(term, `${term}|never`, t => apiFetch(`/donors/pick?${new URLSearchParams({ q: t, match: "name", limit: "5", gave: "0" })}`).then(r => (Array.isArray(r) ? r : [])),
    { narrow: personStillMatches });
  const loading = loading1 || loading2;
  const people = [...givers, ...never.filter(n => !givers.some(g => g.id === n.id)).map(n => ({ ...n, neverGave: true }))];
  return (
    <div style={{ position: "relative" }}>
      <button type="button" data-testid="preview-as" onClick={() => setOpen(o => !o)} aria-expanded={open}
        style={bar ? builderQuiet(open) : { ...railQuietBtn, padding: "5px 10px" }}>Preview as {as && as.name ? as.name.split(/\s+/)[0] : "you"} {"▾"}</button>
      {open && (
        <div data-testid="preview-as-menu" style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 30, width: 280, background: T.white, border: "1px solid " + T.bg3, borderRadius: 10, boxShadow: "0 10px 30px rgba(0,0,0,.15)", padding: 8 }}>
          <input autoFocus style={railInput} placeholder="Find one of your people" value={q} onChange={e => setQ(e.target.value)} aria-label="Find a person to preview as" />
          <div style={{ maxHeight: 260, overflowY: "auto", marginTop: 6 }}>
            {loading && <div style={{ padding: 6 }}><Spin /></div>}
            {people.map(p => (
              <button key={p.id} type="button" data-testid="preview-as-person" onClick={() => { onPick(p); setOpen(false); setQ(""); }}
                style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", borderTop: "1px solid " + T.bg2, padding: "7px 8px", cursor: "pointer", fontFamily: "inherit", fontSize: 13, color: T.ink }}>{p.name}{p.neverGave ? <span style={{ color: T.ink3 }}> · never given</span> : null}</button>
            ))}
            {!loading && !people.length && <div style={{ ...railNote, padding: 6 }}>Nobody by that name.</div>}
          </div>
          <button type="button" onClick={() => { onPick(null); setOpen(false); }} style={{ ...railQuietBtn, marginTop: 6, width: "100%" }}>Preview as yourself</button>
        </div>
      )}
    </div>
  );
}

export function BrandSummary({ onOpenBrand }) {
  const [ps, setPs] = useState(null);
  useEffect(() => { apiFetch("/portal-settings").then(setPs).catch(() => setPs({})); }, []);
  const sw = c => c ? <span title={c} style={{ display: "inline-block", width: 22, height: 22, borderRadius: 6, background: c, border: "1px solid " + T.bg3 }} /> : null;
  return (
    <div data-testid="email-brand">
      <div style={railNote}>Your logo, colors and type come from Brand, so every email and page look like yours. A change there reaches every email at once.</div>
      {ps && <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8 }}>{sw(ps.primary_color)}{sw(ps.accent_color)}{sw(ps.button_color)}
        {(ps.logo_url || ps.logo_data) && <span style={{ fontSize: 12, color: T.ink3, marginLeft: 4 }}>Logo set</span>}</div>}
      {onOpenBrand && <button type="button" style={{ ...railQuietBtn, marginTop: 8 }} onClick={onOpenBrand}>Open Brand</button>}
    </div>
  );
}

// Who the email is from: the org's sending identity, in its one sentence.
export function FromLine() {
  const [id, setId] = useState(null);
  useEffect(() => { apiFetch("/org/sending-domain").then(setId).catch(() => setId({})); }, []);
  return <Sec title="Who it's from" testid="email-from"><div style={paneNote}>{id === null ? "Checking…" : id.sentence || "Your organization's name, from Steward's sending address, until your own domain is set up in Settings."}</div></Sec>;
}

// The checks a send makes, in one place.
export function Checks({ problems, loading, testid = "email-problems" }) {
  return (
    <Sec title="Checked against">
      {problems.length
        ? <div style={PROBLEM_BOX} data-testid={testid}><div style={{ fontWeight: 700, marginBottom: 4 }}>To fix before this is sent</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>{problems.map((p, k) => <li key={k}>{p}</li>)}</ul></div>
        : <div style={paneNote} data-testid="email-ready">{loading ? "Checking…" : "Every photo has its words, every field is one Steward fills, and nothing is left in brackets."}</div>}
    </Sec>
  );
}

// The email's background lives on its footer block; one is added at the end if
// the email has none (the footer is always drawn either way).
export function setPageBackground(b, page) {
  const foot = b.latest.current.find(x => x.type === "footer");
  const v = page === "cream" ? undefined : page;
  if (foot) return b.setBlock(foot._k, { page: v }, "page");
  b.change(bs => [...bs, { type: "footer", ...(v ? { page: v } : {}), _k: "kfoot" + Date.now() }], "page");
  return null;
}

// ── A TEMPLATE IN THE EDITOR ────────────────────────────────────────────────
// FIX-39 · A TEMPLATE IN USE CHANGES IN TWO STEPS. The editor opens on the
// waiting draft when there is one; Save keeps changes as that draft when a live
// journey reads the template (the server decides, and says what it would
// change), and Publish is what makes them the template.
const withDraft = t => (t && t.draft ? { ...t, ...t.draft } : t);
export function EmailEditor({ template, isReadOnly, blockTypes, mergeFields, onOpenDrafts, onOpenCampaigns, onOpenBrand, onQuickPrint, onBack, onSaved, backLabel = "Back to templates", title = null }) {
  const start0 = withDraft(template);
  const narrow = useNarrow();
  const [name, setName] = useState(start0.name);
  const [subject, setSubject] = useState(start0.subject || "");
  const [preheader, setPreheader] = useState(start0.preheader || "");
  const [saved, setSaved] = useState(start0);
  const [hasDraft, setHasDraft] = useState(!!template.hasDraft);
  const [draftBy, setDraftBy] = useState(template.draftByName || "");
  const [usage, setUsage] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [device, setDevice] = useState(narrow ? "phone" : "desktop");
  const [dark, setDark] = useState(false);
  // SWEEP-3: undefined is one of her donors (the server picks the newest
  // giver); null is "Preview as yourself", sent as "me".
  const [as, setAs] = useState(undefined);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [ai, setAi] = useState(null);
  const [aiAsk, setAiAsk] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const metaNow = useRef(null);
  metaNow.current = { name, subject, preheader };
  const meta = useMemo(() => ({ get: () => metaNow.current, set: m => { setName(m.name); setSubject(m.subject); setPreheader(m.preheader); } }), []);
  const wsRef = useRef(null);
  const ws = useBuilderWorkspace({
    initialBlocks: start0.blocks, blockTypes, mergeFields, readOnly: isReadOnly, meta, narrow, onOpenBrand,
    metaAppend: (which, tok) => { const set = which === "subject" ? setSubject : setPreheader; wsRef.current.b.changeMeta(() => set(v => (v ? v.replace(/\s*$/, " ") : "") + tok)); },
    previewDeps: [device, dark, as],
    fetchPreview: blocks => apiFetch(`/email-templates/${template.id}/preview`, { method: "POST",
      body: JSON.stringify({ blocks, subject: metaNow.current.subject, preheader: metaNow.current.preheader, device, dark, editable: !isReadOnly, as: previewAsParam(as) }) }),
  });
  wsRef.current = ws;
  const { b, preview, redraw } = ws;
  const blocks = b.blocks;
  // A note is said once as a toast and stays under This email until the next.
  const tell = msg => { setNote(msg); if (msg) ws.say(msg); };

  useEffect(() => { apiFetch(`/email-templates/${template.id}/usage`).then(setUsage).catch(() => setUsage(null)); }, [template.id]);

  const dirty = name !== saved.name || subject !== (saved.subject || "") || preheader !== (saved.preheader || "")
    || JSON.stringify(stripKeys(blocks)) !== JSON.stringify(saved.blocks || []);

  const save = async () => {
    setSaving(true); setNote("");
    const before = { name: saved.name, subject: saved.subject, preheader: saved.preheader, blocks: saved.blocks };
    try {
      const hadDraft = hasDraft;
      const r = await apiFetch(`/email-templates/${template.id}`, { method: "PUT", body: JSON.stringify({ name, subject, preheader, blocks: stripKeys(blocks) }) });
      const now = withDraft(r.template);
      setSaved(now); b.reset(now.blocks, { keepSelection: true });
      setHasDraft(!!r.template.hasDraft); setDraftBy(r.template.draftByName || "");
      if (r.usage) setUsage(r.usage);
      offerUndo({ message: r.draft ? "Saved as a draft. Nothing that uses this template has changed." : "Saved the template.", undoAction: async () => {
        const x = r.draft && !hadDraft
          ? await apiFetch(`/email-templates/${template.id}/discard-draft`, { method: "POST", body: "{}" })
          : await apiFetch(`/email-templates/${template.id}`, { method: "PUT", body: JSON.stringify(before) });
        const back = withDraft(x.template);
        setSaved(back); setName(back.name); setSubject(back.subject || ""); setPreheader(back.preheader || ""); b.reset(back.blocks);
        setHasDraft(!!x.template.hasDraft); ws.force();
        onSaved && onSaved();
        return x;
      } }, "template");
      onSaved && onSaved();
      ws.force();
    } catch (e) { tell(say(e, "It could not be saved.")); }
    setSaving(false);
  };
  const publish = async () => {
    if (dirty) { tell("Save first, so what you publish is what you see."); return; }
    const what = usage && usage.live ? usage.sentence.split(". Saving")[0] + "." : "Nothing live uses this template.";
    if (!(await askConfirm({ title: "Publish these changes?", body: `${what} Publishing changes the template they read from now on. Emails already sent stay as they were.`, yes: "Publish" }))) return;
    setPublishing(true); setNote("");
    try {
      const r = await apiFetch(`/email-templates/${template.id}/publish`, { method: "POST", body: "{}" });
      setSaved(r.template); setHasDraft(false); setDraftBy("");
      if (r.usage) setUsage(r.usage);
      tell("Published. From now on, everything that uses this template reads these words.");
      onSaved && onSaved();
    } catch (e) { tell(say(e, "It could not be published.")); }
    setPublishing(false);
  };
  const discardDraft = async () => {
    if (!(await askConfirm({ title: "Throw away this draft?", body: "The template goes back to the words that are live now.", yes: "Discard draft" }))) return;
    try {
      const r = await apiFetch(`/email-templates/${template.id}/discard-draft`, { method: "POST", body: "{}" });
      setSaved(r.template); setName(r.template.name); setSubject(r.template.subject || ""); setPreheader(r.template.preheader || ""); b.reset(r.template.blocks);
      setHasDraft(false); setDraftBy(""); tell("The draft is gone. The live template did not change."); ws.force();
      onSaved && onSaved();
    } catch (e) { tell(say(e, "The draft could not be discarded.")); }
  };
  // FIX-30 · A ONE-PERSON EMAIL is drafted for one person; Undo dismisses it. Nothing is sent.
  const [who, setWho] = useState(null);
  const [whoQ, setWhoQ] = useState("");
  const [people] = usePeoplePicker(whoQ, { match: "name", limit: 8 });
  // FLOWS-12 item 6 (W-1114-Fundraising-19X): the answer shows beside the
  // button, a made draft opens, and a draft already waiting says so.
  const [personMsg, setPersonMsg] = useState(null);   // { sentence, held?: draftId, busy? }
  const draftForPerson = async (replace = false) => {
    setNote(""); setPersonMsg(null);
    if (dirty) { setPersonMsg({ sentence: "Save first, so the draft holds the words you see." }); return; }
    setPersonMsg({ sentence: "Making the draft…", busy: true });
    try {
      const r = await apiFetch(`/templates/${template.personKind}/draft`, { method: "POST", body: JSON.stringify({ donorId: who.id, ...(replace ? { replace: true } : {}) }) });
      offerUndo({ message: r.sentence, undoAction: () => apiFetch(`/milestone-drafts/${r.draftId}/dismiss`, { method: "POST", body: "{}" }) }, "draft");
      setPersonMsg({ sentence: r.sentence, made: r.draftId });
      if (onOpenDrafts) onOpenDrafts(r.draftId);
    } catch (e) {
      const held = e && e.error === "draft_exists" ? e.draftId : null;   // api.js puts the answer's fields on the error
      setPersonMsg({ sentence: say(e, "The draft could not be made."), held });
    }
  };
  const startCampaign = async () => {
    setNote("");
    if (dirty) { tell("Save first, so the campaign starts from what you see."); return; }
    try {
      const c = await apiFetch("/campaigns/from-template", { method: "POST", body: JSON.stringify({ templateId: template.id, name: saved.name }) });
      offerUndo({ message: c.sentence || `Started ${c.name} from this template.`, undoAction: () => apiFetch(`/campaigns/${c.id}`, { method: "DELETE" }) }, "campaign");
      setNote(c.sentence || `${c.name} is a draft campaign. Nothing has been sent.`);
    } catch (e) { tell(say(e, "The campaign could not be started.")); }
  };
  const test = async () => {
    setNote("");
    if (dirty) { tell("Save first, so the test is the email you see."); return; }
    try {
      const r = await apiFetch(`/email-templates/${template.id}/test`, { method: "POST", body: "{}" });
      tell(r.sentence || (r.sent ? "The test is on its way to you." : "Nothing was sent."));
    } catch (e) { tell(say(e, "The test could not be sent.")); }
  };
  const draftAi = async () => {
    if (dirty) { tell("Save first, so the proposal starts from what you see."); return; }
    setAi({ loading: true, proposals: [], sentence: "", chosen: new Set() });
    try {
      const r = await apiFetch(`/email-templates/${template.id}/draft-ai`, { method: "POST", body: JSON.stringify({ instructions: aiAsk }) });
      const changed = (r.proposals || []).filter(p => p.proposed !== p.current);
      setAi({ loading: false, proposals: changed, sentence: r.sentence, source: r.source, chosen: new Set(changed.map(p => p.id)) });
    } catch (e) { setAi({ loading: false, proposals: [], sentence: say(e, "Drafting could not be reached."), chosen: new Set() }); }
  };
  const applyAi = () => {
    const chosen = ai.proposals.filter(p => ai.chosen.has(p.id));
    b.change(bs => {
      const n = bs.map(x => ({ ...x, ...(x.blocks ? { blocks: x.blocks.map(y => ({ ...y })) } : {}) }));
      for (const p of chosen) {
        const [i, field, j] = p.id.split(".");
        const blk = n[Number(i)];
        if (!blk) continue;
        if (field === "blocks" && blk.blocks && blk.blocks[Number(j)]) blk.blocks[Number(j)].text = p.proposed;
        else if (field !== "blocks") blk[field] = p.proposed;
      }
      return n;
    });
    setAi(null); ws.force();
    tell("The proposed words are in the email. Read them, then press Save to keep them.");
  };

  const goBack = async () => { if (!dirty || await askConfirm({ title: "Leave without saving?", body: "Your changes to this email have not been saved.", yes: "Leave" })) onBack(); };
  const problems = preview.problems || [];
  const foot = blocks.find(x => x.type === "footer");

  const emailSettings = (
    <fieldset disabled={isReadOnly} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
      {note && <div style={{ ...PROBLEM_BOX, margin: "8px 16px" }} role="status" data-testid="email-note">{note}
        {/Drafts to review/.test(note) && onOpenDrafts && <> <button type="button" style={railQuietBtn} onClick={onOpenDrafts}>Open drafts to review</button></>}
        {/draft campaign|is a draft/.test(note) && !template.personKind && onOpenCampaigns && <> <button type="button" style={railQuietBtn} onClick={onOpenCampaigns}>Open campaigns</button></>}
      </div>}
      <Sec title="Name" testid="rail-details">
        <input id="et-name" aria-label="Name" style={paneInput} value={name} onChange={e => { const v = e.target.value; b.changeMeta(() => setName(v), "name"); }} />
      </Sec>
      <Sec title="Subject" right={<span style={{ fontSize: 11.5, color: subject.length > 60 ? T.gold700 : T.ink3 }} data-testid="subject-count">{subject.length}/60</span>}>
        <input id="et-subject" aria-label="Subject" data-testid="email-subject" style={paneInput} value={subject} onFocus={() => { ws.lastInput.current = "subject"; }}
          onChange={e => { const v = e.target.value; b.changeMeta(() => setSubject(v), "subject"); }} onBlur={redraw} />
        <label htmlFor="et-pre" style={{ ...paneNote, display: "block", marginTop: 10 }}>Preview line</label>
        <input id="et-pre" style={{ ...paneInput, marginTop: 4 }} value={preheader} placeholder="Shown after the subject in the inbox" onFocus={() => { ws.lastInput.current = "preheader"; }}
          onChange={e => { const v = e.target.value; b.changeMeta(() => setPreheader(v), "preheader"); }} onBlur={redraw} />
      </Sec>
      <FromLine />
      <PageBackground value={foot && foot.page} brand={preview.brand} disabled={isReadOnly} onChange={v => { const err = setPageBackground(b, v); if (err) ws.say(err); else ws.force(); }} />
      <Checks problems={problems} loading={preview.loading} />
      <Sec title="Who it goes to">
        <div style={paneNote} data-testid="email-who">{template.personKind
          ? "One person at a time, as a draft you read and send. Saving here is what marks it reviewed, and every draft of this kind starts from these words."
          : "Nobody yet. It goes out only in a campaign or a journey step somebody starts, and each send is a person's."}</div>
        {usage && (usage.live || usage.sentence) && <div style={{ ...paneNote, marginTop: 6 }} data-testid="template-usage">{usage.sentence}</div>}
        {hasDraft && (
          <div data-testid="template-draft-state" style={{ ...paneNote, marginTop: 6 }}>
            You are editing a draft{draftBy ? ` saved by ${draftBy}` : ""}. What uses this template still reads the published words until you publish.
            <div><button type="button" style={{ ...paneBtn, marginTop: 6 }} onClick={discardDraft} data-testid="template-discard-draft">Discard draft</button></div>
          </div>
        )}
      </Sec>
      {template.personKind && (
        <Sec title="Make a draft for someone" testid="email-person-draft">
          <input style={paneInput} aria-label="Find a person" placeholder={who ? who.name : "Find a person by name"} value={whoQ} onChange={e => setWhoQ(e.target.value)} />
          {people.map(p => <button key={p.id} type="button" onClick={() => { setWho(p); setWhoQ(""); }}
            style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", borderTop: "1px solid " + T.bg2, padding: "7px 8px", cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}>{p.name}</button>)}
          <button type="button" style={{ ...paneBtn, marginTop: 6 }} disabled={!who || !!(personMsg && personMsg.busy)} onClick={() => draftForPerson(false)} data-testid="email-person-draft-make">{who ? `Make a draft for ${who.name}` : "Make a draft for this person"}</button>
          {personMsg && <div role="status" data-testid="email-person-draft-result" style={{ ...paneNote, marginTop: 6, color: T.ink }}>{personMsg.sentence}
            {personMsg.held && <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
              {onOpenDrafts && <button type="button" style={paneBtn} data-testid="email-person-draft-open" onClick={() => onOpenDrafts(personMsg.held)}>Open it</button>}
              <button type="button" style={paneBtn} data-testid="email-person-draft-replace" onClick={() => draftForPerson(true)}>Replace it</button>
            </div>}</div>}
        </Sec>
      )}
      <Sec title="More">
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {!template.personKind && <button type="button" style={paneBtn} onClick={startCampaign} data-testid="email-start-campaign">Start a campaign from this</button>}
          <button type="button" style={paneBtn} onClick={draftAi} data-testid="email-draft-ai">Draft with AI</button>
          {onQuickPrint && template.personKind && EMAILED_LETTERS.has(template.personKind) && <button type="button" style={paneBtn} onClick={onQuickPrint} data-testid="quick-edit">Quick edit and print</button>}
        </div>
        {ai && (
          <div style={{ marginTop: 8 }} data-testid="ai-proposals">
            <input style={paneInput} value={aiAsk} onChange={e => setAiAsk(e.target.value)} placeholder="Warmer, shorter, mention the spring garden..." aria-label="Anything to ask for" />
            {ai.loading ? <div style={{ padding: 8 }}><Spin /></div> : <>
              <p style={paneNote}>{ai.sentence}</p>
              {ai.proposals.length === 0 && <p style={paneNote}>No words to change.</p>}
              {ai.proposals.map(p => (
                <label key={p.id} style={{ display: "flex", gap: 8, padding: "6px 0", borderTop: "1px solid " + T.bg2, fontSize: 12.5, cursor: "pointer" }}>
                  <input type="checkbox" checked={ai.chosen.has(p.id)} onChange={e => setAi(a => { const c = new Set(a.chosen); if (e.target.checked) c.add(p.id); else c.delete(p.id); return { ...a, chosen: c }; })} />
                  <span><span style={{ display: "block", color: T.ink3, textDecoration: "line-through" }}>{p.current}</span><span style={{ display: "block" }}>{p.proposed}</span></span>
                </label>
              ))}
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <button type="button" style={paneBtn} disabled={!ai.chosen.size} onClick={applyAi}>Use the ticked words</button>
                <button type="button" style={paneBtn} onClick={() => setAi(null)}>Keep mine</button>
              </div></>}
          </div>
        )}
      </Sec>
      <Sec title="Design"><BrandSummary onOpenBrand={onOpenBrand} /></Sec>
    </fieldset>
  );
  const right = (
    <>
      {historyOpen && <div style={{ padding: "12px 16px", borderBottom: "1px solid " + T.bg2 }}><EmailHistory templateId={template.id} onClose={() => setHistoryOpen(false)} /></div>}
      {ws.right(emailSettings)}
    </>
  );
  const pgf = preview.pastGiving && pastGivingFlag({ claims: preview.pastGiving.claims, shownName: preview.pastGiving.shownName });
  const above = (
    <div style={{ padding: "10px 18px 0", display: "flex", flexDirection: "column", gap: 8 }}>
      <div data-testid="email-subject-line" style={{ fontSize: 13, color: T.ink2, lineHeight: 1.4, textAlign: "center" }}><b style={{ color: T.ink }}>Subject:</b> {preview.subject || subject || "No subject yet"}</div>
      {pgf && <div data-testid="past-giving-flag" style={PROBLEM_BOX}>{pgf} Click the block and write a first-gift version in its settings; people who have never given read that instead.</div>}
    </div>
  );

  return (
    <div data-testid="email-editor" style={{ position: "fixed", top: 52, left: 0, right: 0, bottom: 0, zIndex: 200 }} className="fullscreen-takeover no-caps">
      <StewardEditor kind="email" testid="steward-editor" layout="builder"
        back={{ onClick: goBack, label: backLabel, short: /templates/i.test(backLabel) ? "Templates" : "Back" }}
        name={title || name} badge={emailBadge(template)}
        device={device} onDevice={setDevice}
        toggles={[{ id: "dark", label: "Dark mode", on: dark, onClick: () => setDark(v => !v) }]}
        tools={<><PreviewAs bar as={preview.as && preview.as.id ? preview.as : as} onPick={p => setAs(p)} />{ws.tools}</>}
        status={saving ? "Saving…" : dirty ? "Unsaved changes" : hasDraft ? "Draft saved, not published" : "Saved"}
        actions={[
          { id: "test", label: "Send me a test", onClick: test, disabled: isReadOnly, testid: "email-test" },
          { id: "history", label: "History", active: historyOpen, onClick: () => setHistoryOpen(o => !o), testid: "email-history" },
        ]}
        primary={hasDraft && !dirty
          ? { label: publishing ? "Publishing…" : "Publish", onClick: publish, disabled: isReadOnly || publishing, testid: "template-publish" }
          : { label: saving ? "Saving…" : usage && usage.live ? "Save as draft" : "Save", onClick: save, disabled: isReadOnly || saving || !dirty, testid: "email-save" }}
        crumb={ws.crumb} left={ws.left} leftTitle="Elements" right={right} rightTitle="Settings" sheet={ws.sheet} onCanvasClick={ws.clear}>
        {ws.canvas(device, above)}
      </StewardEditor>
      {ws.overlays}
    </div>
  );
}

export function EmailHistory({ templateId, url, onClose, what = "email" }) {
  const [rows, setRows] = useState(null);
  const src = url || `/email-templates/${templateId}/history`;
  useEffect(() => { apiFetch(src).then(r => setRows(r.versions || [])).catch(() => setRows([])); }, [src]);
  const when = d => { try { return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return ""; } };
  return (
    <div data-testid="history-panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>History</div>
        <button type="button" onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: T.ink3, fontSize: 12.5 }}>Done</button>
      </div>
      <div style={{ ...railNote, margin: "4px 0 8px" }}>Everything done to this {what}, with who did it and when.</div>
      {rows === null ? <Spin /> : rows.length === 0 ? <div style={railNote}>Nothing saved here yet.</div> : rows.map(v => (
        <div key={v.id} data-testid="history-row" style={{ background: T.white, border: "1px solid " + T.bg2, borderRadius: 8, padding: "8px 10px", marginBottom: 6, fontSize: 12.5 }}>
          <b>{v.what}</b> by {v.byName}<div style={{ color: T.ink3 }}>{when(v.at)}</div>
        </div>
      ))}
    </div>
  );
}

// ── AN OLDER CAMPAIGN'S WORDS, AS BLOCKS, ON OPEN ──────────────────────────
// A campaign written in the old plain editor is HTML. It opens as blocks,
// converted here when it is opened and never in the database: its paragraphs,
// headings and lists become a text block, a paragraph that is only a link
// becomes a button, a picture becomes a photo block, an inline link keeps its
// address in brackets. Nothing is saved until she saves.
export function htmlToBlocks(html, { ask = false } = {}) {
  const out = [{ type: "header" }];
  let run = [];
  const flush = () => { if (run.length) out.push({ type: "richtext", blocks: run }); run = []; };
  let doc = null;
  try { doc = new DOMParser().parseFromString(`<div id="r">${String(html || "")}</div>`, "text/html"); } catch { doc = null; }
  const root = doc && doc.getElementById("r");
  const text = n => {
    let s = "";
    n.childNodes.forEach(c => {
      if (c.nodeType === 3) s += c.nodeValue;
      else if (c.nodeType === 1) {
        if (c.tagName === "BR") s += "\n";
        else if (c.tagName === "A") { const t = text(c).trim(); const h = c.getAttribute("href") || ""; s += /^https?:\/\//.test(h) && h !== t ? `${t} (${h})` : t; }
        else s += text(c);
      }
    });
    return s.replace(/ /g, " ");
  };
  const onlyLink = n => { const kids = [...n.childNodes].filter(c => !(c.nodeType === 3 && !c.nodeValue.trim())); return kids.length === 1 && kids[0].nodeType === 1 && kids[0].tagName === "A" ? kids[0] : null; };
  const visit = n => {
    if (n.nodeType === 3) { const t = n.nodeValue.trim(); if (t) run.push({ type: "p", text: t }); return; }
    if (n.nodeType !== 1) return;
    const tag = n.tagName;
    if (tag === "IMG") { flush(); out.push({ type: "image", image: /^https:\/\//.test(n.getAttribute("src") || "") ? n.getAttribute("src") : null, alt: n.getAttribute("alt") || "", caption: "" }); return; }
    const link = tag === "A" ? n : onlyLink(n);
    if (link && /^https?:\/\//.test(link.getAttribute("href") || "")) { flush(); out.push({ type: "button", action: "readmore", label: text(link).replace(/\s*→\s*$/, "").trim() || "Read more", url: link.getAttribute("href") }); return; }
    if (/^H[1-6]$/.test(tag)) { const t = text(n).trim(); if (t) run.push({ type: "h2", text: t }); return; }
    if (tag === "UL" || tag === "OL") { const items = [...n.querySelectorAll("li")].map(li => text(li).trim()).filter(Boolean); if (items.length) run.push({ type: "ul", items }); return; }
    if (n.querySelector && n.querySelector("p,div,h1,h2,h3,ul,ol,img") && !/^P$/.test(tag)) { n.childNodes.forEach(visit); return; }
    if (n.querySelector && n.querySelector("img")) { n.childNodes.forEach(visit); return; }
    const t = text(n).replace(/\n{3,}/g, "\n\n").trim();
    if (t) run.push({ type: "p", text: t });
  };
  if (root) root.childNodes.forEach(visit);
  flush();
  if (out.length === 1) out.push({ type: "richtext", blocks: [{ type: "p", text: "" }] });
  if (ask && !out.some(b => b.type === "button")) out.push({ type: "button", action: "give", label: "Give", url: "{{give_link}}" });
  out.push({ type: "footer" });
  return out;
}
// The words of the blocks as simple HTML: the campaign's `body`, which the
// lists, the starter check and "as sent" read. The send reads the blocks.
export function blocksToHtml(blocks) {
  const e = s => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const parts = [];
  for (const b of blocks || []) {
    if (!b) continue;
    if (b.type === "hero") { if (b.heading) parts.push(`<h2>${e(b.heading)}</h2>`); if (b.sub) parts.push(`<p>${e(b.sub)}</p>`); }
    if (b.type === "richtext") for (const x of b.blocks || []) {
      if (x.type === "h2") parts.push(`<h2>${e(x.text)}</h2>`);
      else if (x.type === "ul") parts.push(`<ul>${(x.items || []).map(i => `<li>${e(i)}</li>`).join("")}</ul>`);
      else if (String(x.text || "").trim()) parts.push(`<p>${e(x.text).replace(/\n/g, "<br>")}</p>`);
    }
    if (b.type === "quote" && b.text) parts.push(`<p>&ldquo;${e(b.text)}&rdquo;${b.attribution ? ` ${e(b.attribution)}` : ""}</p>`);
    if (b.type === "signature" && b.name) parts.push(`<p>${e(b.name)}${b.title ? `<br>${e(b.title)}` : ""}</p>`);
  }
  return parts.join("");
}
