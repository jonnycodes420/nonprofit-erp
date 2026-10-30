// CampaignEditor.jsx · EDITOR-1. A CAMPAIGN, IN THE ONE EDITOR.
//
// New campaign used to be three columns: settings, a body textarea, and
// "What Margaret will see" showing the same words again. It is the giving
// page editor's shell now, like every email:
//
//   Left rail   Details (name, subject with its counter, preview line),
//               Audience, Schedule, Design (from Brand), Blocks.
//   Preview     the email as the send draws it, for the first person on the
//               list (or whoever "Preview as" names), typed in where it shows.
//   Right rail  who it goes to, in ONE line whose counts add up to the
//               segment and open their lists, what is held and why, and the
//               checks a send makes.
//   Top bar     Desktop / Phone / Dark mode, Send me a test, Save draft, and
//               "Send to 212", which is never live while Donor mail is off.
//
// The campaign keeps its own copy of its blocks (campaigns.email_blocks), as a
// campaign started from a template always has; the send renders them for
// each person (emailCompose.render). Nothing here sends without the confirm.
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { apiFetch } from "../api";
import { T, Spin } from "./shared";
import MediaPicker from "./MediaPicker";
import StockPhotoPicker from "./StockPhotoPicker";
import { askConfirm } from "./ConfirmDialog";
import StewardEditor, { RailSection, DeviceFrame, useNarrow, railLabel, railInput, railQuietBtn, railNote } from "./StewardEditor";
import { EmailFrame, EmailBlockSettings, BlockMenu, BrandSummary, PreviewAs, FieldMenu, EmailHistory, insertChip, setAtPath, stripKeys, useBlockList } from "./EmailEditor";

const NOTE_BOX = { background: T.gold50, border: "1px solid " + T.gold300, borderRadius: 8, padding: "10px 12px", fontSize: 12.5, color: T.ink, lineHeight: 1.5 };
// The local wall-clock "now" for a datetime-local's min, in the browser's zone.
const nowLocal = () => { const d = new Date(Date.now() + 60000); d.setSeconds(0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

// ONE LINE THAT ADDS UP, each count opening its list of people.
export function AudienceLine({ audience, testid = "audience-line" }) {
  const [open, setOpen] = useState(null);
  if (!audience) return <div style={railNote}><Spin /> Counting…</div>;
  const g = open ? audience.groups.find(x => x.reason === open) : null;
  return (
    <div data-testid={testid} data-total={audience.total} data-sendable={audience.sendable}>
      <div style={{ fontSize: 13, color: T.ink, lineHeight: 1.55 }}>
        <b>{audience.total.toLocaleString()}</b> {audience.noun} {"·"} <b data-testid="audience-sendable">{audience.sendable.toLocaleString()}</b> can get this email{audience.groups.length ? ": " : "."}
        {audience.groups.map((x, k) => (
          <span key={x.reason}>
            <button type="button" data-testid={"audience-group-" + x.reason} data-count={x.count} aria-expanded={open === x.reason}
              onClick={() => setOpen(o => (o === x.reason ? null : x.reason))}
              style={{ background: "none", border: "none", padding: 0, color: T.green, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: 13, textDecoration: "underline", textUnderlineOffset: 2 }}>
              {x.sentence}
            </button>{k < audience.groups.length - 1 ? ", " : "."}
          </span>
        ))}
      </div>
      {g && (
        <div data-testid="audience-group-list" style={{ marginTop: 8, background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "6px 10px", fontSize: 12.5, lineHeight: 1.6 }}>
          {g.people.map(p => <div key={p.id}><a href={`/app/donors/${encodeURIComponent(p.id)}`} style={{ color: T.ink }}>{p.name}</a></div>)}
          {g.count > g.people.length && <div style={{ color: T.ink3 }}>and {(g.count - g.people.length).toLocaleString()} more</div>}
        </div>
      )}
    </div>
  );
}

export default function CampaignEditor({
  isAdmin, isReadOnly, readOnlySent, campaignId, statusBadge, title, form, setForm, initialBlocks, blockTypes, mergeFields, segPreview, audiencePicker,
  orgTimezone, sending, testState, sendingIdentity, approvalNote, notReviewed, onBack, onSaveDraft, onSend, onSchedule, onRequestApproval, onTest, onDuplicate,
}) {
  const narrow = useNarrow();
  const [blocks, setBlocks, act] = useBlockList(initialBlocks);
  const [device, setDevice] = useState(narrow ? "phone" : "desktop");
  const [dark, setDark] = useState(false);
  const [as, setAs] = useState(null);
  const [preview, setPreview] = useState({ html: "", problems: [], loading: true, as: null, subject: "" });
  const [selected, setSelected] = useState(null);
  const [menuAt, setMenuAt] = useState(undefined);
  const [picker, setPicker] = useState(null);
  const [focusAsk, setFocusAsk] = useState({ id: "", n: 0 });
  const [rev, setRev] = useState(0);
  const [note, setNote] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const frameRef = useRef(null);
  const caret = useRef(null);
  const lastInput = useRef(null);
  const typing = useRef(false);
  const latest = useRef(null);
  latest.current = { blocks, subject: form.subject, preheader: form.preheader || "", name: form.name };
  const labels = useMemo(() => Object.fromEntries(blockTypes.map(t => [t.key, t.label])), [blockTypes]);
  const ask = id => setFocusAsk(f => ({ id, n: f.n + 1 }));
  const at = id => (focusAsk.id === id ? focusAsk.n : 0);
  const email = () => ({ blocks: stripKeys(latest.current.blocks), preheader: latest.current.preheader });

  const redraw = useCallback(() => { if (!typing.current) setRev(r => r + 1); }, []);
  const firstId = segPreview && segPreview.first ? segPreview.first.id : null;
  useEffect(() => { redraw(); }, [blocks.length, device, dark, as, firstId, redraw]);
  const seq = useRef(0);
  useEffect(() => {
    const n = ++seq.current;
    const t = setTimeout(() => {
      const cur = latest.current;
      apiFetch("/email-preview", { method: "POST", body: JSON.stringify({ blocks: stripKeys(cur.blocks), subject: cur.subject, preheader: cur.preheader, dark,
        editable: !readOnlySent && !isReadOnly, as: (as && as.id) || firstId || undefined, campaignName: cur.name }) })
        .then(r => { if (n === seq.current) setPreview({ html: r.html, problems: r.problems || [], loading: false, as: r.as, subject: r.subject || "" }); })
        .catch(e => { if (n === seq.current) setPreview(p => ({ ...p, loading: false, problems: [(e && (e.sentence || e.message)) || "The preview could not be drawn."] })); });
    }, 300);
    return () => clearTimeout(t);
  }, [rev]);   // eslint-disable-line react-hooks/exhaustive-deps

  const setBlock = (i, patch) => { setBlocks(bs => bs.map((b, j) => (j === i ? { ...b, ...patch } : b))); redraw(); };
  const on = {
    commit: (path, value) => { lastInput.current = "frame"; setBlocks(bs => setAtPath(bs, path, value)); },
    focusChange: f => { typing.current = f; if (!f) setTimeout(() => { if (!typing.current) setRev(r => r + 1); }, 120); },
    caret: c => { caret.current = c; lastInput.current = "frame"; },
    select: i => { setSelected(i); ask("block"); },
    action: (what, i) => { if (what === "add") { setMenuAt(i); return; } act(what, i).then(redraw); if (what === "remove" && selected === i) setSelected(null); },
    image: (i, k) => {
      setSelected(i);
      const b = latest.current.blocks[i];
      if (!b) return;
      setPicker({ kind: "photo", onPick: item => {
        if (b.type === "photos2") { const ims = [...(b.images || [{ src: null, alt: "" }, { src: null, alt: "" }])]; ims[k] = { src: item.url, alt: (ims[k] && ims[k].alt) || item.alt || "" }; setBlock(i, { images: ims }); }
        else if (b.type === "signature") setBlock(i, { photo: item.url });
        else setBlock(i, { image: item.url, alt: b.alt || item.alt || "" });
      } });
    },
  };
  const insertField = f => {
    if (lastInput.current === "subject") { setForm(x => ({ ...x, subject: (x.subject ? x.subject.replace(/\s*$/, " ") : "") + f.token })); redraw(); return; }
    if (lastInput.current === "preheader") { setForm(x => ({ ...x, preheader: (x.preheader ? x.preheader.replace(/\s*$/, " ") : "") + f.token })); redraw(); return; }
    if (insertChip(caret.current, f.token.replace(/[{}]/g, ""), f.label.replace(/^Their /, ""))) { typing.current = false; setTimeout(() => setRev(r => r + 1), 50); }
    else setNote("Click into the words in the preview first, then pick the field to put there.");
  };

  const aud = segPreview && segPreview.audience;
  const scheduleOn = !!form.scheduledAt;
  const pastTime = scheduleOn && new Date(form.scheduledAt).getTime() <= Date.now();
  const blockers = preview.problems || [];
  const sendReason = aud == null ? "Counting who it goes to…" : aud.blocked || (blockers.length ? "Fix what the checks list before this can go." : null);
  const primary = readOnlySent ? { label: "Duplicate to edit", onClick: onDuplicate, testid: "duplicate-to-edit", disabled: isReadOnly }
    : !isAdmin ? (form.status === "awaiting_approval"
        ? { label: "Waiting for approval", disabled: true, reason: "Waiting for an admin to approve it.", onClick: () => {} }
        : { label: "Ask an admin to approve", onClick: () => onRequestApproval(email()), testid: "campaign-request-approval" })
    : scheduleOn
      ? { label: "Schedule", onClick: () => onSchedule(email()), disabled: !!sendReason || pastTime, reason: pastTime ? "That time has already gone. Pick a time from now on." : sendReason, testid: "campaign-schedule" }
      : { label: sending ? "Sending…" : aud == null ? "Counting…" : `Send to ${aud.wouldReach.toLocaleString()}`, onClick: () => onSend(email()), disabled: sending || !!sendReason || !aud || aud.sendable === 0, reason: sendReason, testid: "campaign-send" };
  const sel = selected != null ? blocks[selected] : null;
  const fields = (mergeFields || []).map(f => ({ token: f.token, label: f.label }));

  const left = (
    <fieldset disabled={readOnlySent} style={{ border: "none", margin: 0, padding: 0, minWidth: 0 }}>
      {notReviewed && <div data-testid="builder-not-reviewed" style={{ ...NOTE_BOX, margin: "12px 16px 0" }}>These are Steward&rsquo;s starter words. Read them and make them yours before anyone receives them.</div>}
      {sel && (
        <RailSection key={"block-" + sel._k} id="block" testid="rail-block" title={"This block: " + (labels[sel.type] || sel.type)} focus={at("block")}>
          <EmailBlockSettings b={sel} set={patch => setBlock(selected, patch)} events={[]} pages={[]} pick={(kind, onPick) => setPicker({ kind, onPick })} />
        </RailSection>
      )}
      <RailSection id="details" title="Details" testid="rail-details">
        <label style={{ ...railLabel, marginTop: 0 }}>Campaign name</label>
        <input style={railInput} value={form.name} placeholder="Spring Appeal 2026" onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        <label style={railLabel}>Subject <span data-testid="subject-count" style={{ float: "right", color: form.subject.length > 60 ? T.gold700 : T.ink3, textTransform: "none", letterSpacing: 0 }}>{form.subject.length}/60</span></label>
        <input data-testid="email-subject" style={railInput} value={form.subject} placeholder="A message from {{org_name}}" onFocus={() => { lastInput.current = "subject"; }}
          onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} onBlur={redraw} />
        <label style={railLabel}>Preview line</label>
        <input style={railInput} value={form.preheader || ""} placeholder="Shown after the subject in the inbox" onFocus={() => { lastInput.current = "preheader"; }}
          onChange={e => setForm(f => ({ ...f, preheader: e.target.value }))} onBlur={redraw} />
      </RailSection>
      <RailSection id="audience" title="Audience" testid="rail-audience" focus={at("audience")}>
        {audiencePicker}
      </RailSection>
      <RailSection id="schedule" title="Schedule" testid="rail-schedule">
        <label style={{ ...railLabel, marginTop: 0 }} htmlFor="cb-when">Send it later</label>
        {/* EDITOR-1: empty until she picks a time; a time that has gone is refused. */}
        <input id="cb-when" type="datetime-local" data-testid="campaign-schedule-at" value={form.scheduledAt || ""} min={nowLocal()} data-empty={form.scheduledAt ? "false" : "true"}
          onChange={e => setForm(f => ({ ...f, scheduledAt: e.target.value }))}
          style={{ ...railInput, color: form.scheduledAt ? T.ink : T.ink3 }} />
        <div style={{ ...railNote, marginTop: 6 }} data-testid="campaign-schedule-note">
          {!form.scheduledAt ? "Not scheduled. Leave it empty and send it yourself."
            : pastTime ? "That time has already gone. Pick a time from now on."
            : <>Goes out at that time in {orgTimezone || "your organization's timezone"}.</>}
        </div>
        {form.scheduledAt && <button type="button" style={{ ...railQuietBtn, marginTop: 6 }} onClick={() => setForm(f => ({ ...f, scheduledAt: "" }))}>Clear the time</button>}
      </RailSection>
      <RailSection id="blocks" title="Blocks" defaultOpen={false} hint="Point at a block in the preview for its handles. The + under a block adds one there.">
        <button type="button" style={railQuietBtn} onClick={() => setMenuAt(null)}>Add a block at the end</button>
      </RailSection>
      <RailSection id="design" title="Design" defaultOpen={false}><BrandSummary /></RailSection>
    </fieldset>
  );

  const right = (
    <div style={{ padding: "14px 16px 30px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Who it goes to</div>
        <AudienceLine audience={aud} />
        {aud && aud.blocked && <div data-testid="audience-blocked" style={{ ...NOTE_BOX, marginTop: 8 }}>{aud.blocked}</div>}
      </div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Checked against</div>
        {blockers.length
          ? <div style={NOTE_BOX} data-testid="campaign-preview-problems"><div style={{ fontWeight: 700, marginBottom: 4 }}>To fix before this is sent</div><ul style={{ margin: 0, paddingLeft: 18 }}>{blockers.map((p, k) => <li key={k}>{p}</li>)}</ul></div>
          : <div style={railNote}>{preview.loading ? "Checking…" : "Every photo has its words, every field is one Steward fills, and nothing is left in brackets."}</div>}
      </div>
      {note && <div style={NOTE_BOX} role="status">{note}</div>}
      {approvalNote && <div style={NOTE_BOX}>{approvalNote}</div>}
      {testState && testState.state === "sent" && <div data-testid="test-result" style={railNote}>Sent to {testState.to}. It went out from {testState.from} and is not counted against this campaign.</div>}
      {testState && testState.state === "error" && <div style={NOTE_BOX}>{testState.message}</div>}
      {sendingIdentity && sendingIdentity.sentence && <div style={railNote}>{sendingIdentity.sentence}</div>}
      {historyOpen && campaignId && <EmailHistory url={`/campaigns/${campaignId}/history`} what="campaign" onClose={() => setHistoryOpen(false)} />}
    </div>
  );

  // Asked only when something here differs from what was opened.
  // (The group's name, filled in after opening, is a label and not an edit.)
  const snap = () => JSON.stringify([stripKeys(latest.current.blocks), form.name, form.subject, form.preheader || "", { ...(form.seg || {}), audienceName: undefined }, form.scheduledAt || ""]);
  const opened = useRef(null);
  if (opened.current === null) opened.current = snap();
  const goBack = async () => {
    if (readOnlySent || snap() === opened.current || await askConfirm({ title: "Leave this campaign?", body: "Your changes are not saved as a draft yet.", yes: "Leave" })) onBack();
  };
  return (
    <div data-testid="campaign-builder" className="fullscreen-takeover" style={{ position: "fixed", top: 52, left: 0, right: 0, bottom: 0, zIndex: 200 }}>
      <StewardEditor kind="campaign" testid="steward-editor" back={{ onClick: goBack, label: "Back" }}
        name={title} badge={statusBadge || "Campaign"} device={device} onDevice={setDevice}
        toggles={[{ id: "dark", label: "Dark mode", on: dark, onClick: () => setDark(v => !v) }]}
        status={readOnlySent ? "Sent, so it can't change" : form.status === "awaiting_approval" ? "Waiting for approval" : "Draft"}
        actions={[
          !readOnlySent && { id: "test", label: testState && testState.state === "sending" ? "Sending…" : "Send me a test", onClick: () => onTest(email()), testid: "send-me-a-test", disabled: isReadOnly },
          campaignId && { id: "history", label: "History", active: historyOpen, onClick: () => setHistoryOpen(o => !o), testid: "campaign-history" },
          !readOnlySent && 
{ id: "save", label: "Save draft", onClick: () => onSaveDraft(email()), testid: "campaign-save-draft", disabled: isReadOnly },
        ]}
        primary={primary} left={left} right={right} rightTitle="Who it goes to"
        notice={readOnlySent ? <div data-testid="campaign-read-only" style={{ background: T.gold50, color: T.ink, fontSize: 13, padding: "8px 16px", borderBottom: "1px solid " + T.gold300 }}>This campaign has gone out, so it can&rsquo;t change. Duplicate it to send something like it.</div> : null}>
        <DeviceFrame device={device} narrow={narrow} testid="email-frame-wrap">
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "10px 14px", borderBottom: "1px solid " + T.bg2, background: T.white, position: "relative" }}>
            <PreviewAs as={preview.as && preview.as.id ? preview.as : as} onPick={p => setAs(p)} />
            {!readOnlySent && <FieldMenu fields={fields} onInsert={insertField} />}
            {preview.loading && <Spin />}
            <div data-testid="email-subject-line" style={{ flexBasis: "100%", fontSize: 13, color: T.ink2 }}><b style={{ color: T.ink }}>Subject:</b> {preview.subject || form.subject || "No subject yet"}</div>
            {menuAt !== undefined && <BlockMenu blockTypes={blockTypes} onClose={() => setMenuAt(undefined)}
              onPick={type => { act("insert", menuAt, blockTypes, { type }).then(redraw); setMenuAt(undefined); }} />}
          </div>
          <div style={{ flex: 1, display: "flex", minHeight: 0, background: T.bg2, padding: device === "phone" ? 0 : "12px 0" }}>
            <EmailFrame html={preview.html} device={device} selected={selected} on={on} frameRef={frameRef} labels={labels} testid="campaign-preview" />
          </div>
        </DeviceFrame>
      </StewardEditor>
      {picker && (picker.kind === "photo"
        ? <StockPhotoPicker onClose={() => setPicker(null)} onPick={p => { picker.onPick({ url: p.url, alt: p.alt }); setPicker(null); }} />
        : <MediaPicker kind={picker.kind} onClose={() => setPicker(null)} onPick={item => { picker.onPick(item); setPicker(null); }} />)}
    </div>
  );
}
