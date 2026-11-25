// email-builder/together.jsx · BUILDER-3. WORKING ON AN EMAIL TOGETHER.
//
//   useTogether    every 3 s: who else has this email open, the block each has selected, the block
//                  each is typing in (theirs until they move on or are idle 30 s), and whether
//                  someone saved (then their version is merged in: useEmailBuilder.rebase).
//   Faces          the others in the top bar, a face (an initial) in each one's colour.
//   CommentsPanel  threads pinned to a block, @mentions (the bell, never an email), Resolve.
//   SharePanel     a review link for the org (signed in) or a private view-only link outside it.
//   ExportPanel    the email's HTML, for one person or with sample values: download or copy.
//   StylesTab      the org's house style for every email (an admin changes it).
// The server side is server/mail/emailTogether.js; nothing here sends.
import { useState, useEffect, useRef, useCallback } from "react";
import { apiFetch } from "../../api";
import { T } from "../shared";
import { changedIds } from "../../../../shared/emailMerge.js";
import { stripKeys } from "./useEmailBuilder";
import { paneBtn, paneInput, paneNote } from "./controls";

const BEAT_MS = 3000;
const stored = k => { try { return JSON.parse(localStorage.getItem(k) || "null") || {}; } catch { return {}; } };
const say0 = e => (e && (e.sentence || e.message)) || "That didn't work. Try again.";
// Brass is light: its face reads in ink; the emeralds in white.
const faceInk = c => (/^#(C9A84C|A88A3A|6FB592)$/i.test(c) ? T.ink : T.white);
const box = { padding: "12px 16px", borderBottom: "1px solid " + T.bg2 };
const head = { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 };
const title = { fontSize: 13, fontWeight: 700, color: T.ink };
const doneBtn = { background: "none", border: "none", cursor: "pointer", color: T.ink3, fontSize: 12.5, fontFamily: "inherit" };
const linkBtn = { background: "none", border: "none", padding: 0, font: "inherit", color: T.greenDk, fontWeight: 700, textDecoration: "underline", cursor: "pointer" };

// ── PRESENCE ──────────────────────────────────────────────────────────────
// b: the builder (useEmailBuilder). getSaved(): the version on screen was last in step with.
// onRemote(): someone saved a newer version. busy(): a save of ours is in flight.
export function useTogether({ templateId, b, getSaved, onRemote, busy, say, enabled = true }) {
  const [people, setPeople] = useState([]);
  const [me, setMe] = useState(null);
  const last = useRef(null);
  const editing = useRef(null);
  const inFlight = useRef(false);
  const live = useRef({ b, getSaved, onRemote, busy, say });
  live.current = { b, getSaved, onRemote, busy, say };
  const beat = useCallback(async () => {
    if (inFlight.current || !templateId) return;
    inFlight.current = true;
    const { b: B } = live.current;
    const sel = B.selKey ? B.latest.current.find(x => x._k === B.selKey) : null;
    const selId = (sel && sel.id) || null;
    const now = stripKeys(B.latest.current);
    let typed = false;
    if (last.current) {
      const ch = [...changedIds(last.current, now)];
      if (ch.length) { typed = true; editing.current = ch.includes(selId) ? selId : ch[0]; }
    }
    last.current = now;
    if (editing.current && editing.current !== selId) editing.current = null;   // she moved on
    try {
      const r = await apiFetch(`/email-templates/${templateId}/presence`, { method: "POST", body: JSON.stringify({ blockId: selId, editingBlockId: editing.current, typed }) });
      setPeople(r.others || []); setMe(r.me || null);
      if (r.refused) { editing.current = null; live.current.say(r.refused.sentence); }
      const saved = live.current.getSaved();
      if (Number(r.rev) > Number((saved && saved.rev) || 0) && !live.current.busy()) live.current.onRemote(r.rev);
    } catch { /* the next beat tries again */ }
    inFlight.current = false;
  }, [templateId]);
  useEffect(() => {
    if (!enabled || !templateId) return undefined;
    beat();
    const t = setInterval(beat, BEAT_MS);
    return () => { clearInterval(t); apiFetch(`/email-templates/${templateId}/presence/leave`, { method: "POST", body: "{}" }).catch(() => {}); };
  }, [enabled, templateId, beat]);
  // The first change in a block claims it at once, not at the next beat.
  const idsNow = b.blocks;
  useEffect(() => {
    if (!enabled) return undefined;
    const t = setTimeout(() => { if (!editing.current) beat(); }, 250);
    return () => clearTimeout(t);
  }, [idsNow, b.selKey, enabled, beat]);
  return { people, me, beat };
}

export function Faces({ people, me }) {
  if (!people || !people.length) return null;
  return (
    <div data-testid="together-faces" role="group" aria-label="Also here" style={{ display: "inline-flex", alignItems: "center", gap: 0, marginRight: 4 }}>
      {people.slice(0, 5).map((p, i) => (
        <span key={p.userId} data-testid="together-face" data-color={p.color} title={`${p.name} has this email open${p.holds ? ", editing a part of it" : ""}`}
          style={{ width: 28, height: 28, borderRadius: 14, background: p.color, color: faceInk(p.color), display: "inline-flex", alignItems: "center", justifyContent: "center",
            fontSize: 12.5, fontWeight: 800, border: "2px solid " + T.white, marginLeft: i ? -6 : 0, boxShadow: "0 0 0 1px " + T.bg3 }}>{p.initial}</span>
      ))}
      {people.length > 5 && <span style={{ fontSize: 12, color: T.ink3, marginLeft: 4 }}>+{people.length - 5}</span>}
      {me && <span className="sr-only" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>You are {me.firstName}</span>}
    </div>
  );
}

// ── COMMENTS ──────────────────────────────────────────────────────────────
// blocks: the email's blocks (for each part's name); selectedId: the selected block's id;
// onSelect(id): select a block; labelOf(block): its name.
export function CommentsPanel({ templateId, blocks, selectedId, onSelect, labelOf, onClose, say, readOnly, refreshKey = 0 }) {
  const [data, setData] = useState(null);
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState([]);
  const [replyTo, setReplyTo] = useState(null);
  const [showResolved, setShowResolved] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => apiFetch(`/email-templates/${templateId}/comments`).then(setData).catch(() => setData({ comments: [], people: [] })), [templateId]);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load, refreshKey]);
  const meId = stored("npe_user").id;
  const comments = (data && data.comments) || [];
  const people = ((data && data.people) || []).filter(p => p.id !== meId);
  const roots = comments.filter(c => !c.parentId && (showResolved || !c.resolved));
  const resolvedN = comments.filter(c => !c.parentId && c.resolved).length;
  const nameOfBlock = id => { const i = blocks.findIndex(x => x.id === id); return i < 0 ? "A part since removed" : `Part ${i + 1}: ${labelOf(blocks[i])}`; };
  const post = async () => {
    const body = text.trim();
    if (!body) return;
    const blockId = replyTo ? replyTo.blockId : selectedId;
    if (!blockId) { say("Select the part of the email the comment is about."); return; }
    setBusy(true);
    try {
      const r = await apiFetch(`/email-templates/${templateId}/comments`, { method: "POST", body: JSON.stringify({ blockId, body, parentId: replyTo ? replyTo.id : null, mentions: mentions.map(m => m.id) }) });
      setText(""); setMentions([]); setReplyTo(null); say(r.sentence); await load();
    } catch (e) { say(say0(e)); }
    setBusy(false);
  };
  const resolve = async (c, reopen = false) => {
    setBusy(true);
    try { const r = await apiFetch(`/email-comments/${c.id}/resolve`, { method: "POST", body: JSON.stringify({ reopen }) }); say(r.sentence); await load(); } catch (e) { say(say0(e)); }
    setBusy(false);
  };
  const mention = id => {
    const p = people.find(x => x.id === id);
    if (!p || mentions.some(m => m.id === id)) return;
    const first = String(p.name).split(/\s+/)[0];
    setMentions(m => [...m, { id, first }]);
    setText(t => (t ? t.replace(/\s*$/, " ") : "") + "@" + first + " ");
  };
  const target = replyTo ? nameOfBlock(replyTo.blockId) : selectedId ? nameOfBlock(selectedId) : null;
  return (
    <div data-testid="comments-panel" style={box}>
      <div style={head}><div style={title}>Comments</div><button type="button" onClick={onClose} style={doneBtn}>Done</button></div>
      <div style={{ ...paneNote, marginBottom: 8 }}>Comments stay in Steward. They are never part of the email, a send or the HTML.</div>
      {!readOnly && <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12.5, color: T.ink2, marginBottom: 4 }}>{target ? (replyTo ? `Reply on ${target}` : `On ${target}`) : "Select a part of the email to comment on it."}</div>
        <textarea data-testid="comment-text" aria-label="Comment" value={text} onChange={e => setText(e.target.value)} rows={3} disabled={!target || busy} style={{ ...paneInput, resize: "vertical" }} />
        <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
          {people.length > 0 && <select data-testid="comment-mention" aria-label="Mention someone" value="" disabled={!target} onChange={e => mention(e.target.value)} style={{ ...paneInput, width: "auto", padding: "5px 8px" }}>
            <option value="">@ Mention…</option>
            {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>}
          <button type="button" data-testid="comment-post" style={{ ...paneBtn, background: T.green, color: T.white, borderColor: T.green }} disabled={!target || !text.trim() || busy} onClick={post}>{replyTo ? "Reply" : "Comment"}</button>
          {replyTo && <button type="button" style={paneBtn} onClick={() => setReplyTo(null)}>Cancel</button>}
        </div>
        {mentions.length > 0 && <div style={{ ...paneNote, marginTop: 4 }}>{mentions.map(m => m.first).join(", ")} will see it in their bell. Nobody is emailed.</div>}
      </div>}
      {!data && <div style={paneNote}>Loading…</div>}
      {data && !roots.length && <div style={paneNote}>{resolvedN ? "No open comments." : "No comments yet."}</div>}
      {roots.map(c => {
        const replies = comments.filter(x => x.parentId === c.id);
        return (
          <div key={c.id} data-testid="comment-thread" data-block-id={c.blockId} style={{ borderTop: "1px solid " + T.bg2, padding: "8px 0", opacity: c.resolved ? 0.6 : 1 }}>
            <button type="button" onClick={() => onSelect(c.blockId)} style={{ ...linkBtn, fontSize: 11.5, fontWeight: 600 }}>{nameOfBlock(c.blockId)}</button>
            {[c, ...replies].map(x => (
              <div key={x.id} style={{ marginTop: 4, fontSize: 13, lineHeight: 1.45 }}><b>{x.authorName}</b> {x.body}</div>
            ))}
            {!readOnly && <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
              {!c.resolved && <button type="button" style={{ ...linkBtn, fontSize: 12 }} onClick={() => setReplyTo(c)}>Reply</button>}
              <button type="button" data-testid="comment-resolve" style={{ ...linkBtn, fontSize: 12 }} disabled={busy} onClick={() => resolve(c, c.resolved)}>{c.resolved ? "Reopen" : "Resolve"}</button>
            </div>}
          </div>
        );
      })}
      {resolvedN > 0 && <button type="button" data-testid="comments-show-resolved" style={{ ...linkBtn, fontSize: 12, marginTop: 6 }} onClick={() => setShowResolved(v => !v)}>
        {showResolved ? "Hide resolved" : `Show resolved (${resolvedN})`}</button>}
    </div>
  );
}

// ── SHARE FOR REVIEW ──────────────────────────────────────────────────────
// as: the person the preview is drawn for now ({ id, name }) or null.
export function SharePanel({ templateId, as, onClose, say, readOnly }) {
  const [audience, setAudience] = useState("org");
  const [sample, setSample] = useState(!as || !as.id);
  const [allow, setAllow] = useState(true);
  const [reviewer, setReviewer] = useState("");
  const [made, setMade] = useState(null);
  const [links, setLinks] = useState([]);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => apiFetch(`/email-templates/${templateId}/shares`).then(r => setLinks(r.shares || [])).catch(() => setLinks([])), [templateId]);
  useEffect(() => { load(); }, [load]);
  const make = async () => {
    setBusy(true);
    try {
      const r = await apiFetch(`/email-templates/${templateId}/share`, { method: "POST", body: JSON.stringify({ audience, sample, as: sample ? null : as && as.id, allowComments: audience === "outside" ? allow : true, reviewerName: reviewer }) });
      setMade(r); await load();
    } catch (e) { say(say0(e)); }
    setBusy(false);
  };
  const copy = async url => { try { await navigator.clipboard.writeText(url); say("Link copied."); } catch { say("Select the link and copy it."); } };
  const off = async id => { try { const r = await apiFetch(`/email-review-links/${id}/revoke`, { method: "POST", body: "{}" }); say(r.sentence); await load(); } catch (e) { say(say0(e)); } };
  const first = as && as.name ? String(as.name).split(/\s+/)[0] : null;
  const radio = (on, set, val, label, testid) => (
    <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, padding: "4px 0", cursor: "pointer" }}>
      <input type="radio" data-testid={testid} checked={on === val} onChange={() => set(val)} style={{ marginTop: 3 }} /><span>{label}</span>
    </label>
  );
  return (
    <div data-testid="share-panel" style={box}>
      <div style={head}><div style={title}>Share for review</div><button type="button" onClick={onClose} style={doneBtn}>Done</button></div>
      {radio(audience, setAudience, "org", "Someone in your organization (they sign in)", "share-org")}
      {radio(audience, setAudience, "outside", "An outside reviewer, such as a board member (a private view-only link)", "share-outside")}
      <div style={{ fontSize: 12.5, fontWeight: 700, margin: "8px 0 2px" }}>Show the email</div>
      {first && radio(sample, setSample, false, `As ${first} sees it (only ${first}'s own details)`, "share-as-person")}
      {radio(sample, setSample, true, "With sample values (no one's details)", "share-sample")}
      {audience === "outside" && <>
        <label style={{ display: "flex", gap: 8, fontSize: 13, padding: "6px 0" }}><input type="checkbox" data-testid="share-allow-comments" checked={allow} onChange={e => setAllow(e.target.checked)} />They can leave comments</label>
        <input aria-label="Reviewer's name" placeholder="Reviewer's name (optional)" value={reviewer} onChange={e => setReviewer(e.target.value)} style={paneInput} />
      </>}
      <div style={{ marginTop: 8 }}><button type="button" data-testid="share-make" disabled={busy || readOnly} onClick={make} style={{ ...paneBtn, background: T.green, color: T.white, borderColor: T.green }}>Make the link</button></div>
      {made && <div data-testid="share-made" style={{ marginTop: 10, background: T.bg, borderRadius: 8, padding: 10 }}>
        <div style={{ fontSize: 12.5, lineHeight: 1.5, marginBottom: 6 }}>{made.sentence}</div>
        <input readOnly data-testid="share-url" value={made.url} onFocus={e => e.target.select()} style={{ ...paneInput, fontSize: 12 }} />
        <button type="button" style={{ ...paneBtn, marginTop: 6 }} onClick={() => copy(made.url)}>Copy link</button>
      </div>}
      {links.filter(l => l.live).length > 0 && <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 4 }}>Links that work now</div>
        {links.filter(l => l.live).map(l => (
          <div key={l.id} data-testid="share-link-row" style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, padding: "4px 0", borderTop: "1px solid " + T.bg2 }}>
            <span>{l.audience === "outside" ? `Outside${l.reviewerName ? ` (${l.reviewerName})` : ""}` : "Your organization"}, {l.sample ? "sample values" : "one person"}, until {new Date(l.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
            <button type="button" style={{ ...linkBtn, fontSize: 12 }} onClick={() => off(l.id)}>Turn off</button>
          </div>
        ))}
      </div>}
    </div>
  );
}

// ── EXPORT ────────────────────────────────────────────────────────────────
// email(): { blocks, subject, preheader, name } as on screen now.
export function ExportPanel({ email, as, onClose, say }) {
  const [sample, setSample] = useState(!as || !as.id);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState([]);
  const first = as && as.name ? String(as.name).split(/\s+/)[0] : null;
  const get = async () => {
    const e = email();
    const r = await apiFetch("/email-export", { method: "POST", body: JSON.stringify({ ...e, as: sample ? null : as && as.id }) });
    setProblems(r.problems || []);
    return r;
  };
  const download = async () => {
    setBusy(true);
    try {
      const r = await get();
      const url = URL.createObjectURL(new Blob([r.html], { type: "text/html" }));
      const a = document.createElement("a"); a.href = url; a.download = r.fileName || "email.html"; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      say(`Downloaded ${r.fileName}.${(r.problems || []).length ? " It has things to fix before it can be sent; they are listed under Export." : ""}`);
    } catch (e) { say(say0(e)); }
    setBusy(false);
  };
  const copy = async () => {
    setBusy(true);
    try { const r = await get(); await navigator.clipboard.writeText(r.html); say("The HTML is copied."); } catch (e) { say(say0(e)); }
    setBusy(false);
  };
  return (
    <div data-testid="export-panel" style={box}>
      <div style={head}><div style={title}>Export</div><button type="button" onClick={onClose} style={doneBtn}>Done</button></div>
      <div style={{ ...paneNote, marginBottom: 8 }}>The email as HTML, with a sample unsubscribe line in the footer. A real send fills in each person's own.</div>
      {first && <label style={{ display: "flex", gap: 8, fontSize: 13, padding: "3px 0" }}><input type="radio" data-testid="export-as-person" checked={!sample} onChange={() => setSample(false)} />As {first} sees it</label>}
      <label style={{ display: "flex", gap: 8, fontSize: 13, padding: "3px 0" }}><input type="radio" data-testid="export-sample" checked={sample} onChange={() => setSample(true)} />With sample values</label>
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <button type="button" data-testid="export-download" disabled={busy} onClick={download} style={{ ...paneBtn, background: T.green, color: T.white, borderColor: T.green }}>Download HTML</button>
        <button type="button" data-testid="export-copy" disabled={busy} onClick={copy} style={paneBtn}>Copy HTML</button>
      </div>
      {problems.length > 0 && <div data-testid="export-problems" style={{ ...paneNote, marginTop: 8, color: T.ink }}>Before it can be sent: {problems.slice(0, 3).join(" ")}</div>}
    </div>
  );
}

// ── HOUSE STYLE ───────────────────────────────────────────────────────────
export function StylesTab({ onChanged, say }) {
  const [d, setD] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const admin = stored("npe_user").role === "admin";
  useEffect(() => { apiFetch("/email-style").then(r => { setD(r); setDraft(r.style); }).catch(() => setD({ error: true })); }, []);
  if (!d) return <div style={{ padding: 14, ...paneNote }}>Loading…</div>;
  if (d.error) return <div style={{ padding: 14, ...paneNote }}>The house style could not be read.</div>;
  const set = (k, v) => setDraft(x => ({ ...x, [k]: v }));
  const save = async reset => {
    setBusy(true);
    try { const r = await apiFetch("/email-style", { method: "PUT", body: JSON.stringify(reset ? { reset: true } : { style: draft }) }); setD(x => ({ ...x, style: r.style, set: r.set })); setDraft(r.style); say(r.sentence); onChanged && onChanged(); }
    catch (e) { say(say0(e)); }
    setBusy(false);
  };
  const changed = JSON.stringify(draft) !== JSON.stringify(d.style);
  const row = { display: "block", fontSize: 12.5, fontWeight: 700, color: T.ink, margin: "10px 0 4px" };
  const fontSel = (k, label) => (
    <label style={row}>{label}
      <select data-testid={"style-" + k} disabled={!admin} value={draft[k] || ""} onChange={e => set(k, e.target.value || null)} style={{ ...paneInput, marginTop: 4, fontWeight: 400 }}>
        <option value="">Your brand's ({k === "headingFont" ? "headings" : "body"})</option>
        {d.fonts.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
      </select></label>
  );
  const size = (k, label, [lo, hi]) => (
    <label style={row}>{label}: {draft[k]} px
      <input type="range" data-testid={"style-" + k} disabled={!admin} min={lo} max={hi} value={draft[k]} onChange={e => set(k, Number(e.target.value))} style={{ width: "100%", accentColor: T.green }} /></label>
  );
  return (
    <div data-testid="builder-styles" style={{ padding: 14 }}>
      <div style={{ ...paneNote, marginBottom: 4 }}>The house style for every email your organization sends. A part that sets its own size keeps it. {admin ? "" : "An admin changes it."}</div>
      {fontSel("headingFont", "Headings")}
      {size("headingSize", "Heading size", [d.sizes.heading[0], d.sizes.heading[1]])}
      {fontSel("bodyFont", "Body text")}
      {size("bodySize", "Body size", [d.sizes.body[0], d.sizes.body[1]])}
      <label style={row}>Links
        <select data-testid="style-linkColor" disabled={!admin} value={draft.linkColor} onChange={e => set("linkColor", e.target.value)} style={{ ...paneInput, marginTop: 4, fontWeight: 400 }}>
          {d.linkColors.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select></label>
      <div style={row}>Buttons</div>
      <div role="group" aria-label="Button shape" style={{ display: "flex", gap: 6 }}>
        {d.buttons.map(bt => <button key={bt.key} type="button" data-testid={"style-button-" + bt.key} aria-pressed={draft.buttonShape === bt.key} disabled={!admin} onClick={() => set("buttonShape", bt.key)}
          style={{ ...paneBtn, flex: 1, padding: "6px 4px", borderColor: draft.buttonShape === bt.key ? T.green : T.bg3, color: draft.buttonShape === bt.key ? T.green : T.ink }}>{bt.label}</button>)}
      </div>
      {admin && <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
        <button type="button" data-testid="style-save" disabled={busy || !changed} onClick={() => save(false)} style={{ ...paneBtn, background: T.green, color: T.white, borderColor: T.green, opacity: changed ? 1 : 0.5 }}>Save the house style</button>
        {d.set && <button type="button" disabled={busy} onClick={() => save(true)} style={paneBtn}>Back to Steward's style</button>}
      </div>}
    </div>
  );
}
