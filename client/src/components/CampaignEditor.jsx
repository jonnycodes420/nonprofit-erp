// CampaignEditor.jsx · EDITOR-1, BUILDER-1. A CAMPAIGN, IN THE ONE EDITOR.
//
// The email builder (StewardEditor's builder layout, ./email-builder/), as
// every email is from BUILDER-1:
//
//   Left pane   Elements, Blocks, Fields.
//   The email   as the send draws it, for the first person on the list (or
//               whoever "Preview as" names), typed in and clicked to select.
//   Right pane  the selected block's Edit and Style; with nothing selected,
//               this campaign's own settings: name, subject, preview line,
//               who it goes to in ONE line whose counts add up to the segment
//               and open their lists, the schedule, who it's from, the
//               background, and the checks a send makes.
//   Top bar     Desktop / Phone / Dark mode, Preview as, Undo / Redo, Send me
//               a test, Save draft, and "Send to 212", which is never live
//               while Donor mail is off.
//
// The campaign keeps its own copy of its blocks (campaigns.email_blocks), as a
// campaign started from a template always has; the send renders them for
// each person (emailCompose.render). Nothing here sends without the confirm.
import { useState, useEffect, useRef, useMemo } from "react";
import { apiFetch } from "../api";
import { T, Spin } from "./shared";
import { askConfirm } from "./ConfirmDialog";
import StewardEditor, { useNarrow, railNote, useShellTop, shellStyle } from "./StewardEditor";
import { BrandSummary, PreviewAs, EmailHistory, FromLine, Checks, setPageBackground } from "./EmailEditor";
import { useBuilderWorkspace } from "./email-builder/useBuilderWorkspace";
import { stripKeys } from "./email-builder/useEmailBuilder";
import { PageBackground } from "./email-builder/Panes";
import { Sec, paneInput, paneBtn, paneNote } from "./email-builder/controls";
import { previewAsParam } from "../lib/previewAs";   // GIFTS-2: Preview as yourself re-draws the preview
import CampaignTurnOn from "./CampaignTurnOn";   // COMMS-1: where Campaign emails are turned on
import { pastGivingFlag, audienceNeverGivenSentence, openClaims, leftOutSentence, includedSentence, INCLUDE_LABEL } from "../../../shared/pastGiving.js";   // FLOWS-12 item 1, FLOWS-15 item 1

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
      {/* CAMPAIGN-2 item 3: what the org is waiting on leads, with where the switch is; the
          line below keeps every reason as a figure that opens its people. */}
      {audience.canReceive && <div data-testid="can-receive" data-count={audience.canReceive.count} data-of={audience.canReceive.of}
        style={{ ...NOTE_BOX, marginBottom: 8 }}>
        <b>{audience.canReceive.sentence}</b>
        <CampaignTurnOn note={audience.turnOn} style={{ marginTop: 4 }} linkOnly />
        {audience.canReceive.others.length > 0 && <div style={{ marginTop: 4 }}>{audience.canReceive.othersSentence} {audience.groups.filter(x => audience.canReceive.others.includes(x.reason)).map((x, k, arr) => (
          <span key={x.reason}><button type="button" data-testid={"can-receive-other-" + x.reason} data-count={x.count} onClick={() => setOpen(o => (o === x.reason ? null : x.reason))}
            style={{ background: "none", border: "none", padding: 0, color: T.green, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: 13, textDecoration: "underline", textUnderlineOffset: 2 }}>{x.sentence}</button>{k < arr.length - 1 ? " · " : "."}</span>))}</div>}
      </div>}
      <div data-testid="audience-count" style={{ fontSize: 13, color: T.ink, lineHeight: 1.55 }}>
        <b>{audience.total.toLocaleString()}</b> {audience.noun} {"·"} <b data-testid="audience-sendable">{audience.sendable.toLocaleString()}</b> can get this email{audience.groups.length ? ": " : "."}
        {audience.groups.map((x, k) => (
          <span key={x.reason}>
            <button type="button" data-testid={"audience-group-" + x.reason} data-count={x.count} aria-expanded={open === x.reason}
              onClick={() => setOpen(o => (o === x.reason ? null : x.reason))}
              style={{ background: "none", border: "none", padding: 0, color: T.green, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: 13, textDecoration: "underline", textUnderlineOffset: 2 }}>
              {x.sentence}
            </button>{k < audience.groups.length - 1 ? " · " : "."}
          </span>
        ))}
      </div>
      {!audience.canReceive && <CampaignTurnOn note={audience.turnOn} />}
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
  isAdmin, isReadOnly, readOnlySent, campaignId, statusBadge, title, form, setForm, initialBlocks, blockTypes, mergeFields, segPreview, onDonorOnlyCopy, audiencePicker,
  orgTimezone, sending, testState, sendingIdentity, approvalNote, notReviewed, onBack, onSaveDraft, onSend, onSchedule, onRequestApproval, onTest, onDuplicate,
}) {
  const narrow = useNarrow();
  const shellTop = useShellTop();   // CAMPAIGN-2: under the header and the staging strip, measured
  const [device, setDevice] = useState(narrow ? "phone" : "desktop");
  const [dark, setDark] = useState(false);
  const [as, setAs] = useState(undefined);   // GIFTS-2: undefined = first recipient, null = yourself (lib/previewAs.js)
  const [historyOpen, setHistoryOpen] = useState(false);
  const formNow = useRef(form);
  formNow.current = form;
  const meta = useMemo(() => ({ get: () => ({ name: formNow.current.name, subject: formNow.current.subject, preheader: formNow.current.preheader || "" }),
    set: m => setForm(f => ({ ...f, name: m.name, subject: m.subject, preheader: m.preheader })) }), [setForm]);
  const firstId = segPreview && segPreview.first ? segPreview.first.id : null;
  // FLOWS-15 item 1: her tick ("Send it to them anyway") lives on the segment, so the send reads it.
  const includeNeverGiven = !!(form.seg && form.seg.includeNeverGiven);
  const locked = readOnlySent || isReadOnly;
  const wsRef = useRef(null);
  const ws = useBuilderWorkspace({
    initialBlocks, blockTypes, mergeFields, readOnly: !!readOnlySent, meta, narrow, frameTestid: "campaign-preview",
    metaAppend: (which, tok) => wsRef.current.b.changeMeta(() => setForm(x => ({ ...x, [which]: (x[which] ? x[which].replace(/\s*$/, " ") : "") + tok }))),
    previewDeps: [device, dark, as, firstId, segPreview && segPreview.audienceNoGift, includeNeverGiven],
    fetchPreview: blocks => apiFetch("/email-preview", { method: "POST", body: JSON.stringify({ blocks, subject: formNow.current.subject, preheader: formNow.current.preheader || "", dark,
      editable: !locked, as: previewAsParam(as, firstId), campaignName: formNow.current.name,
      audienceNoGift: !!(segPreview && segPreview.audienceNoGift), campaign: true, includeNeverGiven }) }),   // POLISH-9; FLOWS-15 item 1
  });
  wsRef.current = ws;
  const { b, preview, redraw } = ws;
  const blocks = b.blocks;
  const email = () => ({ blocks: stripKeys(b.latest.current), preheader: formNow.current.preheader || "" });
  // FLOWS-15 item 1: whether these blocks thank the reader for giving with no first-gift version
  // (donor-only copy); the audience count leaves the never-givers out while it is so.
  const donorOnly = useMemo(() => openClaims(stripKeys(blocks)).length > 0, [blocks]);
  useEffect(() => { if (onDonorOnlyCopy) onDonorOnlyCopy(donorOnly); }, [donorOnly, onDonorOnlyCopy]);
  // FLOWS-12 item 1 (W-1114-Fundraising-17): a letter that thanks them for
  // giving, to people who never have. Flagged until each such block has her
  // first-gift version; never rewritten, never blocked: the send is still hers.
  const neverGiven = segPreview && segPreview.audienceNeverGiven != null ? segPreview.audienceNeverGiven : null;   // FLOWS-15: the whole audience, the left-out ones included
  const leftOutNeverGiven = segPreview ? segPreview.neverGivenLeftOut || 0 : 0;
  const setInclude = on => setForm(f => ({ ...f, seg: { ...(f.seg || {}), includeNeverGiven: on ? true : undefined } }));
  const pg = preview.pastGiving || null;
  const pgFlag = pg ? pastGivingFlag({ claims: pg.claims, neverGiven: neverGiven || 0, shownName: pg.shownName }) : null;
  const pgBlocks = pg ? pg.claims.filter(c => !c.hasVersion).map(c => c.index + 1) : [];

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
  const foot = blocks.find(x => x.type === "footer");
  const setMeta = (key, v) => b.changeMeta(() => setForm(f => ({ ...f, [key]: v })), key);

  const emailSettings = (
    <fieldset disabled={readOnlySent} style={{ border: "none", margin: 0, padding: 0, minWidth: 0 }}>
      {notReviewed && <div data-testid="builder-not-reviewed" style={{ ...NOTE_BOX, margin: "8px 16px" }}>These are Steward&rsquo;s starter words. Read them and make them yours before anyone receives them.</div>}
      <Sec title="Campaign name" testid="rail-details">
        <input aria-label="Campaign name" style={paneInput} value={form.name} placeholder="Spring Appeal 2026" onChange={e => setMeta("name", e.target.value)} />
      </Sec>
      {/* CAMPAIGN-2 item 3: who can receive it comes before the words, so she knows before she plans. */}
      <Sec>
        <div data-testid="builder-who" style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Who it goes to</div>
        <AudienceLine audience={aud} />
        {neverGiven != null && <div data-testid="audience-never-given" data-count={neverGiven} style={{ ...railNote, marginTop: 6 }}>{audienceNeverGivenSentence(neverGiven)}</div>}
        {/* FLOWS-15 item 1: a never-giver never receives donor-only copy unless she ticks them in, knowingly. */}
        {donorOnly && (leftOutNeverGiven > 0 || includeNeverGiven) && (neverGiven || 0) > 0 && (
          <div data-testid="never-given-left-out" data-count={leftOutNeverGiven} style={{ ...NOTE_BOX, marginTop: 8 }}>
            {includeNeverGiven ? includedSentence(neverGiven) : leftOutSentence(leftOutNeverGiven)}
            {!readOnlySent && <label style={{ display: "flex", gap: 6, alignItems: "flex-start", marginTop: 6, fontSize: 12.5, cursor: "pointer" }}>
              <input type="checkbox" data-testid="include-never-given" checked={includeNeverGiven} disabled={isReadOnly} onChange={e => setInclude(e.target.checked)} />
              <span>{INCLUDE_LABEL}</span></label>}
          </div>)}
        {aud && aud.blocked && <div data-testid="audience-blocked" style={{ ...NOTE_BOX, marginTop: 8 }}>{aud.blocked}</div>}
        <div data-testid="rail-audience" style={{ marginTop: 10 }}>{audiencePicker}</div>
      </Sec>
      <Sec title="Subject" right={<span data-testid="subject-count" style={{ fontSize: 11.5, color: form.subject.length > 60 ? T.gold700 : T.ink3 }}>{form.subject.length}/60</span>}>
        <input aria-label="Subject" data-testid="email-subject" style={paneInput} value={form.subject} placeholder="A message from {{org_name}}" onFocus={() => { ws.lastInput.current = "subject"; }}
          onChange={e => setMeta("subject", e.target.value)} onBlur={redraw} />
        <label style={{ ...paneNote, display: "block", marginTop: 10 }} htmlFor="cb-pre">Preview line</label>
        <input id="cb-pre" style={{ ...paneInput, marginTop: 4 }} value={form.preheader || ""} placeholder="Shown after the subject in the inbox" onFocus={() => { ws.lastInput.current = "preheader"; }}
          onChange={e => setMeta("preheader", e.target.value)} onBlur={redraw} />
      </Sec>
      <Sec title="Send it later" testid="rail-schedule">
        {/* EDITOR-1: empty until she picks a time; a time that has gone is refused. */}
        <input id="cb-when" type="datetime-local" aria-label="Send it later" data-testid="campaign-schedule-at" value={form.scheduledAt || ""} min={nowLocal()} data-empty={form.scheduledAt ? "false" : "true"}
          onChange={e => setForm(f => ({ ...f, scheduledAt: e.target.value }))}
          style={{ ...paneInput, color: form.scheduledAt ? T.ink : T.ink3 }} />
        <div style={{ ...paneNote, marginTop: 6 }} data-testid="campaign-schedule-note">
          {!form.scheduledAt ? "Not scheduled. Leave it empty and send it yourself."
            : pastTime ? "That time has already gone. Pick a time from now on."
            : <>Goes out at that time in {orgTimezone || "your organization's timezone"}.</>}
        </div>
        {form.scheduledAt && <button type="button" style={{ ...paneBtn, marginTop: 6 }} onClick={() => setForm(f => ({ ...f, scheduledAt: "" }))}>Clear the time</button>}
      </Sec>
      {sendingIdentity && sendingIdentity.sentence ? <Sec title="Who it's from" testid="email-from"><div style={paneNote}>{sendingIdentity.sentence}</div></Sec> : <FromLine />}
      <PageBackground value={foot && foot.page} brand={preview.brand} disabled={!!readOnlySent} onChange={v => { const err = setPageBackground(b, v); if (err) ws.say(err); else ws.force(); }} />
      <Checks problems={blockers} loading={preview.loading} testid="campaign-preview-problems" />
      {(approvalNote || testState) && <Sec>
        {approvalNote && <div style={NOTE_BOX}>{approvalNote}</div>}
        {testState && testState.state === "sent" && <div data-testid="test-result" style={paneNote}>Sent to {testState.to}. It went out from {testState.from} and is not counted against this campaign.</div>}
        {testState && testState.state === "error" && <div style={NOTE_BOX}>{testState.message}</div>}
      </Sec>}
      <Sec title="Design"><BrandSummary /></Sec>
    </fieldset>
  );
  const right = (
    <>
      {historyOpen && campaignId && <div style={{ padding: "12px 16px", borderBottom: "1px solid " + T.bg2 }}><EmailHistory url={`/campaigns/${campaignId}/history`} what="campaign" onClose={() => setHistoryOpen(false)} /></div>}
      {ws.right(emailSettings)}
    </>
  );

  // Asked only when something here differs from what was opened.
  // (The group's name, filled in after opening, is a label and not an edit.)
  const snap = () => JSON.stringify([stripKeys(b.latest.current), form.name, form.subject, form.preheader || "", { ...(form.seg || {}), audienceName: undefined }, form.scheduledAt || ""]);
  const opened = useRef(null);
  if (opened.current === null) opened.current = snap();
  const goBack = async () => {
    if (readOnlySent || snap() === opened.current || await askConfirm({ title: "Leave this campaign?", body: "Your changes are not saved as a draft yet.", yes: "Leave" })) onBack();
  };
  const above = (
    <div style={{ padding: "10px 18px 0", display: "flex", flexDirection: "column", gap: 8 }}>
      <div data-testid="email-subject-line" style={{ fontSize: 13, color: T.ink2, textAlign: "center" }}><b style={{ color: T.ink }}>Subject:</b> {preview.subject || form.subject || "No subject yet"}</div>
      {pgFlag && <div data-testid="past-giving-flag" style={NOTE_BOX}>{pgFlag} Click {pgBlocks.length === 1 ? `block ${pgBlocks[0]}` : `blocks ${pgBlocks.join(" and ")}`} and write a first-gift version in its settings; people who have never given read that instead.</div>}
    </div>
  );
  return (
    <div data-testid="campaign-builder" className="fullscreen-takeover no-caps" style={shellStyle(shellTop)}>
      <StewardEditor kind="campaign" testid="steward-editor" layout="builder" back={{ onClick: goBack, label: "Back" }}
        name={title} badge={statusBadge || "Campaign"} device={device} onDevice={setDevice}
        toggles={[{ id: "dark", label: "Dark mode", on: dark, onClick: () => setDark(v => !v) }]}
        tools={<><PreviewAs bar as={preview.as && preview.as.id ? preview.as : as} onPick={p => setAs(p)} />{ws.tools}</>}
        status={readOnlySent ? "Sent, so it can't change" : form.status === "awaiting_approval" ? "Waiting for approval" : "Draft"}
        actions={[
          !readOnlySent && { id: "test", label: testState && testState.state === "sending" ? "Sending…" : "Send me a test", onClick: () => onTest(email(), previewAsParam(as, firstId)), testid: "send-me-a-test", disabled: isReadOnly },
          campaignId && { id: "history", label: "History", active: historyOpen, onClick: () => setHistoryOpen(o => !o), testid: "campaign-history" },
          !readOnlySent && { id: "save", label: "Save draft", onClick: () => { onSaveDraft(email()); b.markSaved(); }, testid: "campaign-save-draft", disabled: isReadOnly },
        ]}
        primary={primary} crumb={ws.crumb} left={ws.left} leftTitle="Elements" right={right} rightTitle="Settings" sheet={ws.sheet} onCanvasClick={ws.clear}
        notice={readOnlySent ? <div data-testid="campaign-read-only" style={{ background: T.gold50, color: T.ink, fontSize: 13, padding: "8px 16px", borderBottom: "1px solid " + T.gold300 }}>This campaign has gone out, so it can&rsquo;t change. Duplicate it to send something like it.</div> : null}>
        {ws.canvas(device, above, preview.notSent
          ? <div data-testid="preview-not-sent" style={{ ...NOTE_BOX, margin: "24px auto", maxWidth: 460, alignSelf: "flex-start" }}>{preview.notSent} Write a first-gift version in the block's settings, or tick them in under Who it goes to.</div>
          : null)}
      </StewardEditor>
      {ws.overlays}
    </div>
  );
}
