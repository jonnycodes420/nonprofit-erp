import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { SurveysPanel } from "./Surveys";
import EmailTemplates from "./EmailTemplates";
import { RecordLink } from "./RecordLink";
import { tabHref, urlParam, safeBack } from "../lib/appUrls";
import { apiFetch } from "../api";
import { useAuth } from "../main";
import { T, activeMark, Spin, fmtFull, SectionTabs, StartHere, interactive, PersonMark, Modal, stageName } from "./shared";
import { askConfirm } from "./ConfirmDialog";
import { offerUndo } from "./EditHistory";
import { TemplateStart } from "./TemplateStart";
import { errorMessage } from "../lib/domainError";
// BUILD-88c C.2 — the six live in shared/emailTemplates.js, so the gallery, the
// live preview and the send all read ONE copy of the words. The server route
// adds the org's colours, logo and vocabulary on top; this import is what keeps
// the box from ever being blank if that call fails.
import { renderMergeFields, normalizeMergeFields, MERGE_FIELDS, templatesFor, starterEdited } from "../../../shared/emailTemplates";
import { makeT } from "../../../shared/vocabulary";
import { campaignStats, sentWord, openRateWord, statusWord, CAMPAIGN_FILTERS, filterCampaigns } from "../../../shared/campaignKind";
import { displayDate, displayDateTime } from "../../../shared/displayDate";
import { CalendarDays } from "lucide-react";
import { atlasName } from "../lib/atlas";   // AGENT-5
import { AgentDraftReview, agentDraftsIn } from "./AgentDraftReview";
import { AudienceTab, SendsPerMonth, EmailToolGifts, OpenRows } from "./CommsOpens";
import { Figure } from "./Figure";
import { DonorLink } from "./RecordLink";
import { EmailAsSentPanel } from "./EmailAsSent";
import { ThankYouDrafts } from "./ThankYouDrafts";

// WIRE-1-ADDENDUM: "Templates" and "Email templates" were one thing twice, so
// they are one Templates tab now. An old link to either (?subtab=templates,
// ?subtab=emailtemplates, a bookmark, a card) lands on it.
const COMMS_NAV_ALIASES = { emailtemplates: "templates", "email-templates": "templates", email_templates: "templates" };
export const commsNavOf = id => (id && COMMS_NAV_ALIASES[id]) || id || "hub";

// ── Campaign Briefing panel (rendered inside expanded row) ──────────────────
function CampaignBriefing({ campaign }) {
  const [progress, setProgress] = useState(null);
  const [briefing, setBriefing] = useState(campaign.briefing || "");
  const [goal, setGoal] = useState(campaign.goal_amount || "");
  const [startDate, setStartDate] = useState(campaign.start_date ? campaign.start_date.split("T")[0] : "");
  const [endDate, setEndDate] = useState(campaign.end_date ? campaign.end_date.split("T")[0] : "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiFetch(`/campaigns/${campaign.id}/progress`).then(r => setProgress(r)).catch(() => {});
  }, [campaign.id]);

  const save = useCallback(async () => {
    setSaving(true); setSaved(false);
    try {
      await apiFetch(`/campaigns/${campaign.id}/briefing`, {
        method: "PUT",
        body: JSON.stringify({ briefing, goal_amount: goal || null, start_date: startDate || null, end_date: endDate || null }),
      });
      apiFetch(`/campaigns/${campaign.id}/progress`).then(r => setProgress(r)).catch(() => {});
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch (e) { console.error(e); }
    setSaving(false);
  }, [campaign.id, briefing, goal, startDate, endDate]);

  const raisedAmt = progress?.raised || 0;
  const goalAmt = parseFloat(goal) || 0;
  const pct = goalAmt > 0 ? Math.min(Math.round(raisedAmt / goalAmt * 100), 100) : 0;

  return (
    <div style={{ borderTop: "1px solid " + T.bg3, background: T.bg, padding: "16px" }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3, marginBottom: 12 }}>Campaign Briefing</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        {/* Left: briefing text + timeline */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <textarea
            value={briefing}
            onChange={e => setBriefing(e.target.value)}
            onBlur={save}
            placeholder="Strategy, key messages, target segments, talking points…"
            rows={5}
            style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "10px 12px", color: T.ink, fontSize: 12, outline: "none", resize: "vertical", lineHeight: 1.6, fontFamily: "inherit" }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: T.ink3, marginBottom: 4 }}>Start date</div>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} onBlur={save} style={{ width: "100%", background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 10px", color: T.ink, fontSize: 12, outline: "none", boxSizing: "border-box" }} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: T.ink3, marginBottom: 4 }}>End date</div>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} onBlur={save} style={{ width: "100%", background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 10px", color: T.ink, fontSize: 12, outline: "none", boxSizing: "border-box" }} />
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8 }}>
            {saved && <span style={{ fontSize: 11, color: T.green500 }}>✓ Saved</span>}
            <button onClick={save} disabled={saving} style={{ background: T.gold500, border: "none", borderRadius: 8, padding: "7px 14px", color: T.ink, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
        {/* Right: goal + progress */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <div style={{ fontSize: 10, color: T.ink3, marginBottom: 4 }}>Campaign Goal ($)</div>
            <input type="number" value={goal} onChange={e => setGoal(e.target.value)} onBlur={save} placeholder="e.g. 50000" style={{ width: "100%", background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 10px", color: T.ink, fontSize: 12, outline: "none", boxSizing: "border-box" }} />
          </div>
          {goalAmt > 0 && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: T.greenDk }}>{fmtFull(raisedAmt)} raised</span>
                <span style={{ fontSize: 12, color: T.ink3 }}>of {fmtFull(goalAmt)} goal · {pct}%</span>
              </div>
              <div style={{ height: 8, background: T.bg3, borderRadius: 99, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${pct}%`, background: pct >= 100 ? T.greenDk : T.greenMid, borderRadius: 99, transition: "width 0.4s" }} />
              </div>
              {progress?.donorCount > 0 && <div style={{ fontSize: 11, color: T.ink3, marginTop: 6 }}>{progress.donorCount} donor{progress.donorCount !== 1 ? "s" : ""} contributed</div>}
              {progress?.daysRemaining !== null && progress?.daysRemaining !== undefined && (
                <div style={{ fontSize: 11, color: progress.daysRemaining < 0 ? T.terracotta : T.ink3, marginTop: 4, fontWeight: progress.daysRemaining < 7 ? 700 : 400 }}>
                  {progress.daysRemaining < 0 ? `Ended ${Math.abs(progress.daysRemaining)} days ago` : progress.daysRemaining === 0 ? "Ends today" : `${progress.daysRemaining} days remaining`}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Design constants ──────────────────────────────────────────────────────────
const S = {
  input: {
    background: T.bg, border: "1px solid " + T.bg3, borderRadius: 8,
    padding: "9px 12px", color: T.ink, fontSize: 13, outline: "none", width: "100%", boxSizing: "border-box",
  },
  label: { fontSize: 11, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 4 },
  btn: (variant = "ghost") => ({
    ghost:   { background: "transparent", border: "1px solid " + T.bg3, borderRadius: 8, padding: "8px 14px", color: T.ink2, fontSize: 13, cursor: "pointer" },
    primary: { background: T.gold500, border: "none", borderRadius: 8, padding: "9px 18px", color: T.ink, fontSize: 13, fontWeight: 700, cursor: "pointer" },
    danger:  { background: "transparent", border: "1px solid " + T.terracotta, borderRadius: 8, padding: "8px 14px", color: T.terracotta, fontSize: 13, cursor: "pointer" },
    amber:   { background: T.gold600, border: "none", borderRadius: 8, padding: "9px 18px", color: T.white, fontSize: 13, fontWeight: 700, cursor: "pointer" },
    subtle:  { background: T.bg2, border: "1px solid " + T.bg3, borderRadius: 8, padding: "8px 14px", color: T.ink, fontSize: 13, cursor: "pointer" },
    // BUILD-88c C.2 — the one emerald action. A screen gets one of these.
    send:    { background: T.greenDk, border: "none", borderRadius: 8, padding: "9px 18px", color: T.white, fontSize: 13, fontWeight: 700, cursor: "pointer" },
  })[variant],
};

// FIX-39 — an item in a row's More menu: a real button, with words.
const menuItem = { background: "transparent", border: "none", textAlign: "left", padding: "8px 12px", fontSize: 13, color: T.ink, cursor: "pointer", borderRadius: 6, fontFamily: "inherit" };

// FIX-39 — a subject line as she reads it in a list: merge tags filled with
// the same sample the preview uses ("Before the year ends, Margaret"), never braces.
// It is rendered as text, never as HTML, so React escapes whatever it holds.
const subjectPreview = subject => renderMergeFields(subject || "", {});

// ── Status badge ──────────────────────────────────────────────────────────────
const STATUS_META = {
  draft:     { label: statusWord("draft"),     color: T.ink3, bg: T.ink3 + "18" },
  scheduled: { label: statusWord("scheduled"), color: T.green500, bg: T.green500 + "18" },
  sending:   { label: statusWord("sending"),   color: T.gold600, bg: T.gold600 + "18" },
  sent:      { label: statusWord("sent"),      color: T.white,    bg: T.greenMid },
  // WHY-1 Part 8 — HONEST "SENT". Nothing went: Failed, in brass (a problem,
  // not a destructive confirm, so never red). Some went: "Sent to N of M",
  // and the badge opens the failed rows.
  failed:    { label: statusWord("failed"),    color: T.ink,      bg: T.gold500 },
  partial:   { label: statusWord("sent"),      color: T.ink,      bg: T.gold500 + "55" },
  // EMAIL-1 — written, and waiting for an admin to approve it. Brass: it needs
  // somebody, it is not a problem.
  awaiting_approval: { label: statusWord("awaiting_approval"), color: T.ink, bg: T.gold500 + "55" },
};
function StatusBadge({ status, campaign, onFailed }) {
  const recs = (campaign && campaign.recipients) || [];
  const failed = recs.filter(r => r.failure_reason).length;
  const partial = status === "sent" && failed > 0;
  const m = partial ? STATUS_META.partial : (STATUS_META[status] || STATUS_META.draft);
  const label = partial ? `Sent to ${recs.filter(r => r.sent_at).length} of ${recs.length}` : m.label;
  const clickable = (partial || status === "failed") && onFailed;
  return (
    <span data-testid="camp-status" data-status={partial ? "partial" : status} role={clickable ? "button" : undefined} tabIndex={clickable ? 0 : undefined}
      title={clickable ? "Show the ones that did not go" : undefined}
      onClick={clickable ? e => { e.stopPropagation(); onFailed(); } : undefined}
      style={{ fontSize: 11, fontWeight: 700, color: m.color, background: m.bg, borderRadius: 99, padding: "3px 10px", letterSpacing: "0.04em", cursor: clickable ? "pointer" : "default", whiteSpace: "nowrap" }}>
      {status === "sending" ? <span style={{ animation: "pulse 1.2s ease-in-out infinite" }}>{m.label}</span> : label}
    </span>
  );
}

// The hard-coded template list that used to live here is gone. The six now
// come from shared/emailTemplates.js through GET /campaigns/templates, so the
// gallery, the preview and the send read the same words. BUILD-88c C.2.

// PARITY-1 E — STARTER COPY IS STEWARD'S UNTIL SOMEBODY HERE CHANGES IT. Brass,
// the product's "look here", on the card and in the editor, until a campaign
// made from that starter is saved with its words changed.
function NotReviewedPill() {
  return (
    <span data-testid="starter-not-reviewed"
      title="This is Steward's starter copy. It counts as reviewed once someone here saves it with their own changes."
      style={{ alignSelf: "flex-start", fontSize: 11, fontWeight: 700, color: T.gold700, background: T.gold100,
               border: "1px solid " + T.gold300, borderRadius: 99, padding: "2px 9px", whiteSpace: "nowrap" }}>
      Not yet reviewed
    </span>
  );
}

// ── Segment helpers ───────────────────────────────────────────────────────────
const STAGE_OPTS = ["prospect", "qualify", "cultivate", "solicit", "steward", "lapsed"];
const TIER_OPTS  = ["transformational", "major", "mid", "small", "micro"];
// BUILD-94 Part 2 — the four that let Mailchimp go, alongside the stage, tier
// and manual segments that were already here. "Everyone with an email" is the
// one segment that deliberately crosses every type: it IS the Mailchimp
// audience, and it is what she is paying them $100 a month for.
const SEG_MODES  = [
  { id: "all",         label: "All donors" },
  { id: "everyone",    label: "Everyone with an email" },
  { id: "volunteers",  label: "Volunteers" },
  { id: "staff_board", label: "Staff and board" },
  { id: "donors",      label: "Donors" },
  { id: "major",       label: "Major" },
  { id: "lapsed",      label: "Lapsed" },
  { id: "byStage",     label: "By stage" },
  { id: "byTier",      label: "By tier" },
  { id: "manual",      label: "Manual" },
  // WIRE-1: any Group, kept by hand or by a rule. The server resolves it to
  // its members at send time (resolveSegmentSpec, mode "audience").
  { id: "audience",    label: "A group" },
];


function segLabel(raw) {
  const mode = raw?.mode || "all";
  return {
    all:         "All donors with email",
    everyone:    "Everyone with an email address",
    volunteers:  "Volunteers with an email",
    staff_board: "Staff and board with an email",
    donors:      "Donors with an email",
    major:   "Major donors (>$10k)",
    lapsed:  "Lapsed donors",
    byStage: `Stages: ${(raw?.stages || []).join(", ") || "none"}`,
    byTier:  `Tiers: ${(raw?.tiers || []).join(", ") || "none"}`,
    manual:  `${(raw?.donorIds || []).length} manually selected`,
    audience: raw?.audienceName ? `The group ${raw.audienceName}` : "One group",
  }[mode] || "All donors with email";
}

// FIX-26: WHO THE SEGMENT HOLDS AND THIS SEND WILL NOT REACH. The builder
// used to count the segment here, from /donors/summaries, which carries no
// person types, so every volunteer and guest with an email counted as a donor.
// There is one count now and it is the server's: the send's own decision for
// each person. This is the other half of that answer, opened by its reasons.
const LEFT_OUT_REASONS = {
  no_email:        "No email address",
  deceased:        "Deceased",
  do_not_contact:  "Do not contact",
  unsubscribed:    "Unsubscribed",
  unsubscribe:     "Unsubscribed",
  bounced:         "Email bounced",
  complained:      "Marked a past email as spam",
  blocked_address: "Address Steward never mails",
  sample_donor:    "Sample record, not a real person",
};
const ORG_NO_MAIL = {
  demo_org: "This is the demonstration organization, so nothing is sent from it. In a real organization, these people would get it.",
  org_emails_disabled: "Email is switched off for this organization, so nothing will be sent until it is switched back on.",
  not_onboarded: "Email turns on once your donor file is in.",   // MAIL-1
};
function LeftOut({ preview }) {
  const [open, setOpen] = useState(false);
  if (!preview) return null;
  const n = preview.leftOutCount || 0;
  return (
    <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
      {n > 0 && (
        <button type="button" data-testid="segment-left-out" aria-expanded={open} onClick={() => setOpen(o => !o)}
          style={{ alignSelf: "flex-start", background: "none", border: "none", padding: 0, fontSize: 12.5, color: T.green, fontWeight: 600, cursor: "pointer" }}>
          {n.toLocaleString()} left out {open ? "\u25B4" : "\u25BE"}
        </button>
      )}
      {open && n > 0 && (
        <div data-testid="segment-left-out-reasons" style={{ border: "1px solid " + T.bg3, borderRadius: 8, padding: "6px 10px", background: T.white }}>
          {(preview.leftOut || []).map(g => (
            <div key={g.reason} style={{ padding: "6px 0", borderBottom: "1px solid " + T.bg2 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, color: T.ink }}>
                <span>{LEFT_OUT_REASONS[g.reason] || g.reason}</span>
                <span style={{ fontWeight: 700 }}>{g.count.toLocaleString()}</span>
              </div>
              {g.people && g.people.length > 0 && (
                <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 2, lineHeight: 1.5 }}>
                  {g.people.slice(0, 6).map(x => x.name).join(", ")}{g.count > 6 ? ` and ${(g.count - 6).toLocaleString()} more` : ""}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {preview.orgSends === false && (
        <div data-testid="segment-org-no-mail" style={{ fontSize: 12, color: T.ink3, lineHeight: 1.5 }}>
          {ORG_NO_MAIL[preview.orgReason] || "This organization is not sending email right now, so nothing will be sent."}
        </div>
      )}
    </div>
  );
}

// ── SegmentPicker (module-level) ──────────────────────────────────────────────
function SegmentPicker({ seg, onChange, allDonors }) {
  const mode = seg.mode || "all";
  const upd  = p => onChange({ ...seg, ...p });
  // WIRE-1: the org's Groups, read once the group mode is chosen.
  const [groups, setGroups] = useState(null);
  useEffect(() => {
    if (mode !== "audience" || groups) return;
    apiFetch("/groups").then(r => setGroups((r && r.groups) || [])).catch(() => setGroups([]));
  }, [mode, groups]);
  useEffect(() => {
    // A group chosen before the list arrived (a link from the Group page)
    // gets its name, so the label says which group it is.
    if (mode !== "audience" || !groups || !seg.audienceId || seg.audienceName) return;
    const g = groups.find(x => x.id === seg.audienceId);
    if (g) onChange({ ...seg, audienceName: g.name });
  }, [mode, groups, seg.audienceId]);   // eslint-disable-line react-hooks/exhaustive-deps
  const tog  = (key, val) => {
    const arr = seg[key] || [];
    upd({ [key]: arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val] });
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {/* A CHOSEN SEGMENT IS A STATE, NOT AN ACTION. Filled emerald used to
            say "All Donors" louder than the send button said "Send to 3", and
            one thing on a screen may mean "this is the button". */}
        {SEG_MODES.map(m => (
          <button key={m.id} onClick={() => upd({ mode: m.id })}
            aria-pressed={mode === m.id}
            style={{
              background: T.white,
              border: "1px solid " + T.bg3,
              borderRadius: 7, padding: "5px 12px", fontSize: 11,
              color: T.ink3, cursor: "pointer",
              fontWeight: 400,
              ...activeMark(mode === m.id, "bottom"),
            }}>{m.label}</button>
        ))}
      </div>
      {mode === "byStage" && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {STAGE_OPTS.map(s => (
            <button key={s} onClick={() => tog("stages", s)}
              style={{ background: (seg.stages || []).includes(s) ? T.green100 : T.bg2, border: "1px solid " + ((seg.stages || []).includes(s) ? T.greenDk : T.bg3), borderRadius: 99, padding: "4px 10px", fontSize: 11, color: (seg.stages || []).includes(s) ? T.greenDk : T.ink3, cursor: "pointer" }}>
              {s}
            </button>
          ))}
        </div>
      )}
      {mode === "byTier" && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {TIER_OPTS.map(t => (
            <button key={t} onClick={() => tog("tiers", t)}
              style={{ background: (seg.tiers || []).includes(t) ? T.gold600 : T.bg2, border: "none", borderRadius: 99, padding: "4px 10px", fontSize: 11, color: (seg.tiers || []).includes(t) ? T.white : T.ink3, cursor: "pointer" }}>
              {t}
            </button>
          ))}
        </div>
      )}
      {mode === "audience" && (
        <select aria-label="Which group" data-testid="segment-group" value={seg.audienceId || ""}
          onChange={e => { const g = (groups || []).find(x => x.id === e.target.value); upd({ audienceId: e.target.value || undefined, audienceName: g ? g.name : undefined }); }}
          style={{ border: "1px solid " + T.bg3, borderRadius: 7, padding: "6px 10px", fontSize: 12.5, color: T.ink, background: T.white, maxWidth: 320 }}>
          <option value="">{groups === null ? "Loading your groups…" : groups.length ? "Choose a group" : "No groups yet"}</option>
          {(groups || []).map(g => <option key={g.id} value={g.id}>{g.name}{g.kind === "dynamic" ? " (by rule)" : ""}</option>)}
        </select>
      )}
      {mode === "manual" && (
        <div style={{ maxHeight: 200, overflowY: "auto", border: "1px solid " + T.bg3, borderRadius: 8, padding: "4px 8px" }}>
          {allDonors.length === 0
            ? <div style={{ fontSize: 12, color: T.ink3, padding: 8 }}>Loading donors…</div>
            : allDonors.filter(d => d.email).map(d => (
              <label key={d.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 4px", borderBottom: "1px solid " + T.bg2, cursor: "pointer" }}>
                <input type="checkbox" checked={(seg.donorIds || []).includes(d.id)} onChange={() => tog("donorIds", d.id)} style={{ accentColor: T.green }} />
                <span style={{ fontSize: 13, color: T.ink, flex: 1 }}>{d.name}</span>
                <span style={{ fontSize: 11, color: T.ink3 }}>{d.email}</span>
              </label>
            ))
          }
        </div>
      )}
    </div>
  );
}

// ── RichEditor (module-level) ─────────────────────────────────────────────────
function RichEditor({ editorRef, initialHtml, onInput, readOnly }) {
  useEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = initialHtml || "";
    if (onInput) onInput(initialHtml || "");
  }, []);

  const exec = (cmd, val) => { editorRef.current?.focus(); document.execCommand(cmd, false, val ?? undefined); };

  // ONE list, and it is the renderer's. `{{last_name}}` used to be offered here
  // and renderMergeFields has never replaced it — every email that used the chip
  // went out with the braces still in it.
  const TAGS = MERGE_FIELDS.map(f => [f.token, f.label]);

  const TB = ({ cmd, val, children }) => (
    <button onMouseDown={e => { e.preventDefault(); exec(cmd, val); }}
      style={{ background: "transparent", border: "1px solid " + T.bg3, borderRadius: 5, padding: "3px 8px", color: T.ink2, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
      {children}
    </button>
  );

  return (
    <div style={{ border: "1px solid " + T.bg3, borderRadius: 8, overflow: "hidden" }}>
      <div style={{ display: "flex", gap: 4, padding: "7px 10px", background: T.bg2, flexWrap: "wrap", alignItems: "center", borderBottom: "1px solid " + T.bg3 }}>
        <TB cmd="bold"><b>B</b></TB>
        <TB cmd="italic"><em>I</em></TB>
        <TB cmd="underline"><u>U</u></TB>
        <TB cmd="formatBlock" val="h2">H2</TB>
        <TB cmd="formatBlock" val="p">¶</TB>
        <button onMouseDown={e => { e.preventDefault(); const u = window.prompt("URL:"); if (u) exec("createLink", u); }}
          style={{ background: "transparent", border: "1px solid " + T.bg3, borderRadius: 5, padding: "3px 8px", color: T.ink2, fontSize: 12, cursor: "pointer" }}>Link</button>
        <div style={{ width: 1, height: 14, background: T.bg3, margin: "0 4px" }} />
        <span style={{ fontSize: 10, color: T.ink3 }}>Insert:</span>
        {TAGS.map(([tag, lbl]) => (
          <button key={tag} title={tag}
            onMouseDown={e => { e.preventDefault(); editorRef.current?.focus(); document.execCommand("insertText", false, tag); if (onInput) onInput(editorRef.current?.innerHTML || ""); }}
            style={{ background: T.green100, border: "1px solid " + T.green200, borderRadius: 4, padding: "2px 7px", fontSize: 10, color: T.greenDk, cursor: "pointer" }}>
            {lbl}
          </button>
        ))}
      </div>
      <div ref={editorRef} contentEditable={!readOnly} suppressContentEditableWarning
        data-testid="campaign-editor"
        onInput={e => onInput && onInput(e.currentTarget.innerHTML)}
        style={{ minHeight: 260, padding: "14px 16px", background: T.bg, color: T.ink, fontSize: 14, lineHeight: 1.8, outline: "none" }} />
    </div>
  );
}

// ── Mini bar chart (Analytics) ────────────────────────────────────────────────
// ── Campaign donation link copy button ────────────────────────────────────────
function CampaignLinkBtn({ campaignId, campaignName }) {
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const generate = async (e) => {
    e.stopPropagation();
    setLoading(true);
    try {
      const r = await apiFetch("/stripe/campaign-link", {
        method: "POST",
        body: JSON.stringify({ campaignId, campaignName }),
      });
      await navigator.clipboard.writeText(r.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (err) {
      alert(errorMessage(err, "Connect Stripe in Settings to generate donation links."));
    }
    setLoading(false);
  };
  return (
    <button onClick={generate} disabled={loading}
      style={{ background: copied ? T.greenDk : T.greenDk + "14", border: "1px solid " + T.greenDk + "30", borderRadius: 8, padding: "8px 14px", color: copied ? T.white : T.greenDk, fontSize: 12, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 6 }}>
      {loading ? <><Spin /> Generating…</> : copied ? "✓ Link copied!" : "Copy Donation Link"}
    </button>
  );
}

// ── BLANK form ────────────────────────────────────────────────────────────────
const BLANK = { name: "", subject: "", bodyHtml: "", seg: { mode: "all" }, scheduledAt: "" };

// ── Sequence trigger labels ───────────────────────────────────────────────────
const SEQ_TRIGGERS = [
  // FIX-51: one lapse rule. Both ids mean Lapsed (12+ months); the second is
  // kept only so a sequence saved with it still reads its name.
  { id: "lapsed_90",  label: "Lapsed (12+ months)",    ctx: "re-engaging lapsed donors who haven't given in 12 months or more" },
  { id: "lapsed_180", label: "Lapsed (12+ months)",    ctx: "re-engaging lapsed donors who haven't given in 12 months or more", legacy: true },
  { id: "new_donor",  label: "New donor (first gift)", ctx: "welcoming first-time donors and building the relationship after their first gift" },
  { id: "manual",     label: "Manual only",            ctx: "a personal donor outreach sequence" },
];

// ── Single step row in the sequence builder ───────────────────────────────────
function SeqStep({ step, index, total, onChange, onRemove, onAI, aiLoading }) {
  const inp = { background: T.bg, border: "1px solid " + T.bg3, borderRadius: 8, padding: "8px 11px", color: T.ink, fontSize: 13, outline: "none", width: "100%", boxSizing: "border-box" };
  const preview = step.body ? step.body.replace(/{{donor_name}}/g, "Alexandra").replace(/{{org_name}}/g, "your org").slice(0, 80) + (step.body.length > 80 ? "…" : "") : "";
  return (
    <div style={{ background: T.bg2, borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 10, border: "1px solid " + T.bg3 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: T.ink3 }}>Step {index + 1}</div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button onClick={onAI} disabled={aiLoading}
            style={{ background: aiLoading ? T.bg3 : T.gold100, border: "1px solid " + T.gold300, borderRadius: 7, padding: "4px 10px", color: aiLoading ? T.ink3 : T.gold700, fontSize: 11, fontWeight: 700, cursor: aiLoading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 5 }}>
            {aiLoading ? <><Spin/> Writing…</> : "✦ Write with AI"}
          </button>
          {total > 1 && <button onClick={onRemove} style={{ background: "transparent", border: "1px solid " + T.terracotta + "66", borderRadius: 7, padding: "4px 9px", color: T.terracotta, fontSize: 11, cursor: "pointer" }}>Remove</button>}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "80px 1fr", gap: 10 }}>
        <div>
          <div style={{ fontSize: 10, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Delay (days)</div>
          <input type="number" min="0" value={step.delayDays} onChange={e => onChange({ delayDays: parseInt(e.target.value) || 0 })} style={inp}/>
        </div>
        <div>
          <div style={{ fontSize: 10, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Subject</div>
          <input value={step.subject} onChange={e => onChange({ subject: e.target.value })} placeholder="Subject line…" style={inp}/>
        </div>
      </div>
      <div>
        <div style={{ fontSize: 10, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Body, supports <code style={{ fontSize: 9 }}>{"{{donor_name}}"}</code> and <code style={{ fontSize: 9 }}>{"{{org_name}}"}</code></div>
        <textarea value={step.body} onChange={e => onChange({ body: e.target.value })} placeholder="Write your email body here, or click ✦ Write with AI…" rows={5} style={{ ...inp, resize: "vertical", lineHeight: 1.6 }}/>
        {preview && <div style={{ fontSize: 11, color: T.ink3, marginTop: 5, fontStyle: "italic" }}>Preview: {preview}</div>}
      </div>
    </div>
  );
}

// ── Sequences panel ───────────────────────────────────────────────────────────
// ── BUILD-94 Part 3 — the tracked-sequence editor ──────────────────────────
// She writes every word here. Steward offers her the merge fields her own data
// already holds and refuses to save a sentence it cannot render — and that is
// the whole of Steward's contribution to what a donor reads.
// ── FIX-27 Part 9 · ONE TRUTH ABOUT SEQUENCES AND THE TIMEZONE ────────────
// Sequences really do not send until somebody here has chosen the
// organisation's timezone (sequenceShape.timezoneGate). The banner said so
// while the list below it still called a sequence ACTIVE. Now every list says
// "Paused until you set your timezone", and the banner offers the browser's
// own zone in one click (a person choosing it, so it counts), with Settings
// one link away for any other.
let _seqGate = null;
function useSequenceGate() {
  const [gate, setGate] = useState(_seqGate);
  const load = useCallback(() => apiFetch("/sequences/builder").then(b => { _seqGate = { canRun: !!b.canRun, reason: b.blockedReason || "" }; setGate(_seqGate); }).catch(() => {}), []);
  useEffect(() => { if (!_seqGate) load(); }, [load]);
  return [gate, load];
}
const PAUSED_FOR_TZ = "Paused until you set your timezone";
function browserZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; }
}
function zoneLabel(z) {
  try {
    const name = new Intl.DateTimeFormat("en-US", { timeZone: z, timeZoneName: "long" }).formatToParts(new Date()).find(p => p.type === "timeZoneName");
    return name ? `${name.value} (${z})` : z;
  } catch { return z; }
}
function TimezoneGateBanner({ onChosen }) {
  const zone = browserZone();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const orgId = (() => { try { return JSON.parse(localStorage.getItem("npe_org") || "{}").id || ""; } catch { return ""; } })();
  const choose = async () => {
    setBusy(true); setErr("");
    try { await apiFetch(`/orgs/${orgId}`, { method: "PATCH", body: JSON.stringify({ timezone: zone }) }); _seqGate = null; onChosen && onChosen(); }
    catch (e) { setErr(errorMessage(e, "The timezone was not saved.")); }
    setBusy(false);
  };
  return (
    <div data-testid="seq-blocked" style={{ background: T.gold100, border: `1px solid ${T.gold300}`, borderRadius: 12, padding: "16px 18px", fontSize: 13.5, color: T.ink, lineHeight: 1.6, maxWidth: 680 }}>
      <div style={{ fontWeight: 800, marginBottom: 6 }}>Sequences are paused until you set your timezone.</div>
      A sequence sends on weekday mornings where you are, so Steward has to know where that is. Nothing is lost while it waits.
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
        {zone && orgId && <button type="button" data-testid="seq-use-browser-zone" disabled={busy} onClick={choose} style={{ ...S.btn("send"), fontSize: 12.5 }}>{busy ? "Saving…" : `Use ${zoneLabel(zone)}`}</button>}
        <RecordLink to={tabHref("settings", { section: "giving", focus: "timezone" })} style={{ color: T.greenDk, fontWeight: 700, fontSize: 12.5 }}>Choose another in Settings</RecordLink>
      </div>
      {err && <div style={{ fontSize: 12.5, marginTop: 6 }}>{err}</div>}
    </div>
  );
}

function TrackedSequences() {
  const [builder, setBuilder] = useState(null);
  const [list, setList] = useState([]);
  const [view, setView] = useState("list");       // list | edit
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(null);
  const [problems, setProblems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [turnOn, setTurnOn] = useState(null);     // the confirm screen's payload

  const reload = () => apiFetch("/sequences/home").then(r => { setList(r.sequences || []); }).catch(() => setList([]));
  useEffect(() => { apiFetch("/sequences/builder").then(setBuilder).catch(() => setBuilder(null)); reload(); }, []);

  const blank = () => ({
    name: "", trigger: "first_gift",
    tracks: [{ key: "everyone", label: "Everyone else", rule: "everyone_else", value: "" }],
    steps: [{ trackKey: "everyone", dayOffset: 0, subject: "", body: "", sendEvenAfterGift: true }],
  });

  const open = async (id) => {
    setProblems([]); setPreview(null);
    if (!id) { setForm(blank()); setEditingId(null); setView("edit"); return; }
    const s = await apiFetch(`/sequences/tracked/${id}`).catch(() => null);
    if (!s) return;
    setEditingId(id);
    setForm({
      name: s.name, trigger: s.trigger,
      tracks: Array.isArray(s.tracks) ? s.tracks : [],
      steps: (s.steps || []).map(st => ({ trackKey: st.track_key, dayOffset: st.delay_days,
        subject: st.subject, body: st.body, sendEvenAfterGift: st.send_even_after_gift === true })),
    });
    setView("edit");
  };

  const save = async () => {
    setBusy(true); setProblems([]);
    try {
      const path = editingId ? `/sequences/tracked/${editingId}` : "/sequences/tracked";
      const r = await apiFetch(path, { method: editingId ? "PUT" : "POST", body: JSON.stringify(form) });
      setEditingId(r.id); await reload(); setView("list");
    } catch (e) {
      // A sequence that cannot be turned on says so BEFORE she tries — the
      // server's own refusals, in her words, not a stack trace.
      const p = e && e.body && e.body.problems;
      setProblems(Array.isArray(p) ? p : [errorMessage(e, "Could not save this sequence")]);
    }
    setBusy(false);
  };

  const askTurnOn = async (id) => {
    const p = await apiFetch(`/sequences/tracked/${id}/turn-on-preview`).catch(() => null);
    if (p) setTurnOn({ id, ...p });
  };
  const doTurnOn = async () => {
    try { await apiFetch(`/sequences/tracked/${turnOn.id}/turn-on`, { method: "POST" }); setTurnOn(null); reload(); }
    catch (e) { alert(errorMessage(e, "Could not turn this on")); }
  };
  const turnOff = async (id) => {
    try { await apiFetch(`/sequences/tracked/${id}/turn-off`, { method: "POST" }); reload(); }
    catch (e) { alert(errorMessage(e, "Could not turn this off")); }
  };
  const showPreview = async (id) => {
    const p = await apiFetch(`/sequences/tracked/${id}/preview`).catch(() => null);
    setPreview(p);
  };

  const [, reloadGate] = useSequenceGate();
  const tzPaused = !!(builder && !builder.canRun);
  const gateChosen = () => { apiFetch("/sequences/builder").then(setBuilder).catch(() => {}); reloadGate(); reload(); };

  const upd = (p) => setForm(f => ({ ...f, ...p }));
  const updTrack = (i, p) => setForm(f => ({ ...f, tracks: f.tracks.map((t, j) => j === i ? { ...t, ...p } : t) }));
  const updStep = (i, p) => setForm(f => ({ ...f, steps: f.steps.map((s, j) => j === i ? { ...s, ...p } : s) }));

  if (view === "edit" && form) {
    return (
      <div data-testid="seq-editor" style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 820 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => setView("list")} style={{ ...S.btn("ghost"), padding: "6px 12px", fontSize: 12 }}>← Back</button>
          <span style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>{editingId ? "Edit sequence" : "New sequence"}</span>
        </div>

        {problems.length > 0 && (
          <div data-testid="seq-problems" style={{ background: T.gold100, border: `1px solid ${T.gold300}`, borderRadius: 10, padding: "10px 14px", fontSize: 12.5, color: T.ink, lineHeight: 1.6 }}>
            {problems.map((p, i) => <div key={i}>{p}</div>)}
          </div>
        )}

        <div>
          <label style={S.label}>What is it called</label>
          <input value={form.name} onChange={e => upd({ name: e.target.value })} placeholder="Welcome" style={S.input} data-testid="seq-name" />
        </div>
        <div>
          <label style={S.label}>What starts it</label>
          <select value={form.trigger} onChange={e => upd({ trigger: e.target.value })} style={S.input} data-testid="seq-trigger">
            {(builder?.triggers || []).map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
          <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 5, lineHeight: 1.5 }}>
            It starts from the day you turn it on. Nobody who already qualified is added.
          </div>
        </div>

        {/* TRACKS. Tried in order, first match wins — so the order on this
            screen IS the rule, and the last one has to be Everyone else. */}
        <div>
          <label style={S.label}>Tracks, tried in order, first match wins</label>
          {form.tracks.map((t, i) => (
            <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
              <input value={t.label || ""} onChange={e => updTrack(i, { label: e.target.value, key: t.key || e.target.value.toLowerCase().replace(/\W+/g, "_") })}
                placeholder="Name this track" style={{ ...S.input, flex: "0 0 180px", marginBottom: 0 }} />
              <select value={t.rule} onChange={e => updTrack(i, { rule: e.target.value })} style={{ ...S.input, flex: 1, marginBottom: 0 }}>
                {(builder?.trackRules || []).map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
              {(t.rule === "fund" || t.rule === "source") && (
                <input value={t.value || ""} onChange={e => updTrack(i, { value: e.target.value })}
                  placeholder={t.rule === "fund" ? "Which fund" : "Which source"} style={{ ...S.input, flex: "0 0 150px", marginBottom: 0 }} />
              )}
              {form.tracks.length > 1 && (
                <button onClick={() => setForm(f => ({ ...f, tracks: f.tracks.filter((_, j) => j !== i) }))}
                  style={{ ...S.btn("ghost"), padding: "6px 10px", fontSize: 12 }}>✕</button>
              )}
            </div>
          ))}
          <button onClick={() => setForm(f => ({ ...f, tracks: [...f.tracks.slice(0, -1),
              { key: "track_" + (f.tracks.length), label: "", rule: "gift_major", value: "" }, f.tracks[f.tracks.length - 1]] }))}
            style={{ ...S.btn("ghost"), fontSize: 12 }}>+ Add a track</button>
        </div>

        {/* STEPS. Her words. Steward will not write them. */}
        <div>
          <label style={S.label}>Steps</label>
          {form.steps.map((s, i) => (
            <div key={i} style={{ border: `1px solid ${T.bg3}`, borderRadius: 10, padding: 12, marginBottom: 8, background: T.white }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                <select value={s.trackKey} onChange={e => updStep(i, { trackKey: e.target.value })} style={{ ...S.input, flex: "0 0 180px", marginBottom: 0 }}>
                  {form.tracks.map(t => <option key={t.key} value={t.key}>{t.label || t.key}</option>)}
                </select>
                <span style={{ fontSize: 12, color: T.ink3 }}>day</span>
                <input type="number" min="0" value={s.dayOffset} onChange={e => updStep(i, { dayOffset: parseInt(e.target.value, 10) || 0 })}
                  style={{ ...S.input, flex: "0 0 72px", marginBottom: 0 }} />
                <span style={{ fontSize: 12, color: T.ink3 }}>after they join</span>
                <button onClick={() => setForm(f => ({ ...f, steps: f.steps.filter((_, j) => j !== i) }))}
                  style={{ ...S.btn("ghost"), padding: "6px 10px", fontSize: 12, marginLeft: "auto" }}>✕</button>
              </div>
              <input value={s.subject} onChange={e => updStep(i, { subject: e.target.value })} placeholder="Subject" style={S.input} />
              <textarea value={s.body} onChange={e => updStep(i, { body: e.target.value })} rows={5}
                placeholder="Your words. Steward will not write them." style={{ ...S.input, resize: "vertical", fontFamily: "inherit" }} />
              <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: T.ink2, cursor: "pointer" }}>
                <input type="checkbox" checked={!!s.sendEvenAfterGift} onChange={e => updStep(i, { sendEvenAfterGift: e.target.checked })}
                  style={{ accentColor: T.greenDk }} />
                Send this one even if they give again
              </label>
            </div>
          ))}
          <button onClick={() => setForm(f => ({ ...f, steps: [...f.steps, { trackKey: f.tracks[0].key, dayOffset: 3, subject: "", body: "", sendEvenAfterGift: false }] }))}
            style={{ ...S.btn("ghost"), fontSize: 12 }}>+ Add a step</button>
        </div>

        <div style={{ fontSize: 11.5, color: T.ink3, lineHeight: 1.6, background: T.bg2, borderRadius: 8, padding: "9px 12px" }}>
          <strong>Fields you can use:</strong> {(builder?.mergeFields || []).map(f => "{{" + f.key + "}}").join("  ")}
          <div style={{ marginTop: 6 }}>{builder?.stopNote}</div>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={save} disabled={busy} data-testid="seq-save" style={{ ...S.btn("send"), opacity: busy ? 0.6 : 1 }}>
            {busy ? <><Spin /> Saving…</> : "Save, and leave it off"}
          </button>
          <button onClick={() => setView("list")} style={S.btn("ghost")}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 820 }}>
      {tzPaused && <TimezoneGateBanner onChosen={gateChosen} />}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 13, color: T.ink2, lineHeight: 1.6, maxWidth: 560 }}>
          A sequence runs for each new person on its own, in your words, on weekday
          mornings where you are. You write it, you turn it on, and every send is yours.
        </div>
        <button onClick={() => open(null)} data-testid="seq-new" style={S.btn("send")}>New sequence</button>
      </div>

      {list.length === 0
        ? <div style={{ fontSize: 13, color: T.ink3 }}>No sequences yet.</div>
        : list.map(s => (
          <div key={s.id} data-testid="seq-row" {...interactive(() => open(s.id), { row: true, label: `Edit ${s.line}` })} style={{ border: `1px solid ${T.bg3}`, borderRadius: 12, padding: "13px 16px", background: T.white, display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>{s.line}</div>
              <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 3 }} data-testid="seq-status">
                {s.status === "active" ? (tzPaused ? PAUSED_FOR_TZ : "On") : "Off"}
              </div>
            </div>
            <button onClick={() => showPreview(s.id)} style={{ ...S.btn("ghost"), fontSize: 12 }}>Preview</button>
            <button onClick={() => open(s.id)} style={{ ...S.btn("ghost"), fontSize: 12 }}>Edit</button>
            {s.status === "active"
              ? <button onClick={() => turnOff(s.id)} data-testid="seq-off" style={{ ...S.btn("ghost"), fontSize: 12 }}>Turn off</button>
              : <button onClick={() => askTurnOn(s.id)} data-testid="seq-on" style={{ ...S.btn("send"), fontSize: 12 }}>Turn on</button>}
          </div>
        ))}

      {/* THE MOMENT OF TURNING IT ON is the moment to say that enrollment is
          not retroactive, with the number attached. */}
      {turnOn && (
        <Modal onClose={() => setTurnOn(null)} title="Turn this on">
          <div style={{ fontSize: 13.5, color: T.ink, lineHeight: 1.65, marginBottom: 14 }} data-testid="turn-on-sentence">
            {turnOn.retroactiveSentence}
          </div>
          <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.6, marginBottom: 16 }}>{turnOn.stopNote}</div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={doTurnOn} disabled={!turnOn.canTurnOn} data-testid="turn-on-confirm" style={S.btn("send")}>Turn it on</button>
            <button onClick={() => setTurnOn(null)} style={S.btn("ghost")}>Not yet</button>
          </div>
        </Modal>
      )}

      {preview && (
        <Modal onClose={() => setPreview(null)} title={preview.person ? `What ${preview.person.name} would read` : "Preview"}>
          {!preview.person
            ? <div style={{ fontSize: 13, color: T.ink3 }}>{preview.note}</div>
            : preview.steps.map(st => (
              <div key={st.trackKey + "-" + st.stepOrder} style={{ borderBottom: `1px solid ${T.bg2}`, paddingBottom: 12, marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: T.ink3, marginBottom: 4 }}>{st.trackKey} · day {st.dayOffset}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.ink, marginBottom: 6 }}>{subjectPreview(st.subject)}</div>
                <div style={{ fontSize: 13, color: T.ink2, lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{st.body}</div>
                {st.missing.length > 0 && (
                  <div style={{ fontSize: 11.5, color: T.gold700, marginTop: 6 }}>
                    Blank for {preview.person.name}: {st.missing.map(m => "{{" + m + "}}").join(", ")}
                  </div>
                )}
              </div>
            ))}
        </Modal>
      )}
    </div>
  );
}

function SequencesPanel({ data }) {
  const [seqGate] = useSequenceGate();
  const tzPaused = !!(seqGate && !seqGate.canRun);
  const [seqList, setSeqList] = useState([]);
  const [seqLoading, setSeqLoading] = useState(true);
  const [view, setView] = useState("list");
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", trigger: "manual", triggerStage: "", status: "active", steps: [{ delayDays: 0, subject: "", body: "" }] });
  const [saveLoading, setSaveLoading] = useState(false);
  const [expandedEnr, setExpandedEnr] = useState(null);
  const [enrollmentsMap, setEnrollmentsMap] = useState({});
  const [stepAiLoading, setStepAiLoading] = useState({});

  const loadSeqs = async () => {
    setSeqLoading(true);
    try { setSeqList(await apiFetch("/sequences")); } catch (e) {}
    setSeqLoading(false);
  };
  useEffect(() => { loadSeqs(); }, []);

  const openBuilder = async (seq = null) => {
    if (seq) {
      setEditing(seq);
      const steps = await apiFetch(`/sequences/${seq.id}/steps`).catch(() => []);
      setForm({
        name: seq.name,
        trigger: seq.trigger,
        triggerStage: seq.trigger_stage || "",
        status: seq.status,
        steps: steps.length ? steps.map(s => ({ delayDays: s.delay_days, subject: s.subject, body: s.body })) : [{ delayDays: 0, subject: "", body: "" }],
      });
    } else {
      setEditing(null);
      setForm({ name: "", trigger: "manual", triggerStage: "", status: "active", steps: [{ delayDays: 0, subject: "", body: "" }] });
    }
    setView("builder");
  };

  const saveSeq = async () => {
    if (!form.name.trim()) return;
    setSaveLoading(true);
    try {
      const payload = { ...form };
      if (editing) await apiFetch(`/sequences/${editing.id}`, { method: "PUT", body: JSON.stringify(payload) });
      else await apiFetch("/sequences", { method: "POST", body: JSON.stringify(payload) });
      await loadSeqs();
      setView("list"); setEditing(null);
    } catch (e) { alert(errorMessage(e)); }
    setSaveLoading(false);
  };

  const deleteSeq = async (id) => {
    if (!(await askConfirm({ title: "Delete this sequence?", body: "The sequence and every enrollment in it go for good. Nobody in it gets another step. This cannot be undone.", yes: "Delete sequence", danger: true }))) return;
    try { await apiFetch(`/sequences/${id}`, { method: "DELETE" }); await loadSeqs(); }
    catch (e) { alert(errorMessage(e)); }
  };

  const toggleStatus = async (seq) => {
    const newStatus = seq.status === "active" ? "paused" : "active";
    try {
      await apiFetch(`/sequences/${seq.id}/status`, { method: "PATCH", body: JSON.stringify({ status: newStatus }) });
      setSeqList(prev => prev.map(s => s.id === seq.id ? { ...s, status: newStatus } : s));
    } catch (e) { alert(errorMessage(e)); }
  };

  const viewEnrollments = async (seqId) => {
    if (expandedEnr === seqId) { setExpandedEnr(null); return; }
    setExpandedEnr(seqId);
    try {
      const rows = await apiFetch(`/sequences/${seqId}/enrollments`);
      setEnrollmentsMap(prev => ({ ...prev, [seqId]: rows }));
    } catch (e) {}
  };

  const unenroll = async (seqId, donorId) => {
    try {
      await apiFetch(`/sequences/${seqId}/unenroll`, { method: "POST", body: JSON.stringify({ donorId }) });
      setEnrollmentsMap(prev => ({ ...prev, [seqId]: (prev[seqId] || []).map(e => e.donor_id === donorId ? { ...e, status: "unsubscribed" } : e) }));
    } catch (e) { alert(errorMessage(e)); }
  };

  const addStep = () => setForm(f => ({ ...f, steps: [...f.steps, { delayDays: 3, subject: "", body: "" }] }));
  const removeStep = i => setForm(f => ({ ...f, steps: f.steps.filter((_, idx) => idx !== i) }));
  const updateStep = (i, patch) => setForm(f => ({ ...f, steps: f.steps.map((s, idx) => idx === i ? { ...s, ...patch } : s) }));

  const writeWithAI = async (i) => {
    const step = form.steps[i];
    const trig = SEQ_TRIGGERS.find(t => t.id === form.trigger) || SEQ_TRIGGERS[3];
    setStepAiLoading(prev => ({ ...prev, [i]: true }));
    try {
      const r = await apiFetch("/ai/draft-email", { method: "POST",
        body: JSON.stringify({ purpose: "sequence", context: trig.ctx, step: i + 1, steps: form.steps.length, subjectHint: step.subject || "" }) });
      updateStep(i, step.subject ? { body: r.body } : { subject: r.subject, body: r.body });
    } catch (e) { alert(errorMessage(e, "The draft could not be written just now.")); }
    setStepAiLoading(prev => ({ ...prev, [i]: false }));
  };

  const trigLabel = id => SEQ_TRIGGERS.find(t => t.id === id)?.label || id;
  const inp = { background: T.bg, border: "1px solid " + T.bg3, borderRadius: 8, padding: "9px 12px", color: T.ink, fontSize: 13, outline: "none", width: "100%", boxSizing: "border-box" };

  // Builder view
  if (view === "builder") return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 680 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={() => { setView("list"); setEditing(null); }} style={{ ...S.btn("ghost"), padding: "6px 12px", fontSize: 12 }}>← Back</button>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: T.ink }}>{editing ? "Edit Sequence" : "New Sequence"}</h2>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, background: T.bg2, borderRadius: 12, padding: 16 }}>
        <div>
          <div style={S.label}>Sequence Name</div>
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Lapsed donor re-engagement" style={inp}/>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <div style={S.label}>Trigger</div>
            <select value={form.trigger} onChange={e => setForm(f => ({ ...f, trigger: e.target.value }))} style={{ ...inp, cursor: "pointer" }}>
              {SEQ_TRIGGERS.filter(t => !t.legacy || form.trigger === t.id).map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <div style={S.label}>Status</div>
            <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} style={{ ...inp, cursor: "pointer" }}>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
            </select>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>Steps</div>
        {form.steps.map((step, i) => (
          <SeqStep key={i} step={step} index={i} total={form.steps.length}
            onChange={patch => updateStep(i, patch)}
            onRemove={() => removeStep(i)}
            onAI={() => writeWithAI(i)}
            aiLoading={!!stepAiLoading[i]}
          />
        ))}
        <button onClick={addStep} style={{ ...S.btn("ghost"), alignSelf: "flex-start", fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}>+ Add Step</button>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={saveSeq} disabled={saveLoading || !form.name.trim()} style={{ ...S.btn("primary"), opacity: saveLoading || !form.name.trim() ? 0.6 : 1 }}>
          {saveLoading ? "Saving…" : editing ? "Save Changes" : "Create Sequence"}
        </button>
        <button onClick={() => { setView("list"); setEditing(null); }} style={S.btn("ghost")}>Cancel</button>
      </div>
    </div>
  );

  // List view
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: T.ink }}>Sequences</h2>
        <button onClick={() => openBuilder()} style={S.btn("primary")}>+ New Sequence</button>
      </div>

      <div style={{ background: T.bg2, borderRadius: 10, padding: "12px 16px", fontSize: 12, color: T.ink3, lineHeight: 1.6 }}>
        Sequences automatically send multi-step emails to donors based on triggers (new gift, lapsed, etc.). The engine runs every hour.{" "}
        <button onClick={async () => { await apiFetch("/sequences/process", { method: "POST" }).catch(() => {}); alert("Processing triggered."); }} style={{ background: "none", border: "none", color: T.green, cursor: "pointer", fontSize: 12, padding: 0, fontWeight: 600 }}>Trigger now →</button>
      </div>

      {seqLoading ? (
        <div style={{ color: T.ink3, fontSize: 13, textAlign: "center", padding: 40 }}>Loading…</div>
      ) : seqList.length === 0 ? (
        <div style={{ background: T.bg2, borderRadius: 12, padding: 40, textAlign: "center", color: T.ink3, fontSize: 14 }}>
          No sequences yet. A good first one: three gentle emails to donors who've gone quiet for 90 days, write it once, and it looks after them from then on.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {seqList.map(seq => {
            const isActive = seq.status === "active";
            const enrList = enrollmentsMap[seq.id] || [];
            return (
              <div key={seq.id} style={{ background: T.white, borderRadius: 12, border: "1px solid " + T.bg3, overflow: "hidden", boxShadow: T.shadow }}>
                <div style={{ padding: "14px 16px" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>{seq.name}</div>
                        <span data-testid="legacy-seq-status" style={{ fontSize: 10, fontWeight: 700, borderRadius: 99, padding: "3px 9px", background: isActive && !tzPaused ? T.green100 : T.bg2, color: isActive && !tzPaused ? T.greenDk : T.ink3, letterSpacing:"0.04em", textTransform:"uppercase" }}>{isActive ? (tzPaused ? PAUSED_FOR_TZ : "Active") : "Paused"}</span>
                      </div>
                      <div style={{ fontSize: 12, color: T.ink3, marginTop: 4 }}>
                        {trigLabel(seq.trigger)} · <span style={{ color: T.gold700, fontWeight: 700 }}>{seq.step_count} step{seq.step_count != 1 ? "s" : ""}</span> · {seq.active_enrollments} active
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
                      <button onClick={() => viewEnrollments(seq.id)} style={{ ...S.btn("ghost"), fontSize: 11, padding: "5px 10px" }}>
                        {expandedEnr === seq.id ? "Hide" : "Enrollments"}
                      </button>
                      <button onClick={() => toggleStatus(seq)} style={{ ...S.btn("ghost"), fontSize: 11, padding: "5px 10px" }}>
                        {isActive ? "⏸ Pause" : "▶ Resume"}
                      </button>
                      <button onClick={() => openBuilder(seq)} style={{ ...S.btn("subtle"), fontSize: 11, padding: "5px 10px" }}>Edit</button>
                      <button onClick={() => deleteSeq(seq.id)} style={{ ...S.btn("danger"), fontSize: 11, padding: "5px 10px" }}>Delete</button>
                    </div>
                  </div>
                </div>

                {expandedEnr === seq.id && (
                  <div style={{ borderTop: "1px solid " + T.bg3, padding: "12px 16px", background: T.bg }}>
                    {enrList.length === 0 ? (
                      <div style={{ fontSize: 12, color: T.ink3, textAlign: "center", padding: "8px 0" }}>No enrollments yet.</div>
                    ) : (
                      <div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 160px 80px 100px 100px 80px", gap: 8, padding: "5px 0", fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid " + T.bg3, marginBottom: 4 }}>
                          <span>Donor</span><span>Email</span><span>Step</span><span>Next Send</span><span>Status</span><span></span>
                        </div>
                        {enrList.map(e => (
                          <div key={e.id} style={{ display: "grid", gridTemplateColumns: "1fr 160px 80px 100px 100px 80px", gap: 8, padding: "7px 0", borderBottom: "1px solid " + T.bg2, alignItems: "center" }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.donor_name}</span>
                            <span style={{ fontSize: 11, color: T.ink3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.donor_email}</span>
                            <span style={{ fontSize: 12, color: T.gold700, fontWeight: 700 }}>{e.current_step}/{e.total_steps}</span>
                            <span style={{ fontSize: 11, color: T.ink3 }}>{e.next_send_at ? new Date(e.next_send_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "not scheduled"}</span>
                            <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 99, padding: "2px 7px", background: e.status === "active" ? T.green100 : T.bg2, color: e.status === "active" ? T.greenDk : T.ink3, display: "inline-block" }}>{e.status}</span>
                            {e.status === "active" && (
                              <button onClick={() => unenroll(seq.id, e.donor_id)} style={{ fontSize: 10, background: "transparent", border: "1px solid " + T.terracotta + "66", borderRadius: 6, padding: "2px 7px", color: T.terracotta, cursor: "pointer" }}>Unenroll</button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Milestone Drafts panel ───────────────────────────────────────────────────
// AI-drafted giving-milestone/anniversary emails, queued here for a human to
// approve/edit/send rather than going out automatically — see
// processSequences()'s 'milestone' branch in server.js for why.
// WIRE-1-ADDENDUM: the Agent's drafts are drafts to review too. They keep
// their own queue (approving one marks its gift thanked), so this is the door
// to it: how many are waiting, and Review all, in a row.
function AgentDraftsWaiting({ highlightDraftId = null }) {
  const [n, setN] = useState(null);
  // AGENT-5: Atlas's "Review and send" opens its draft here, ready to read.
  const [open, setOpen] = useState(() => /^adr_/.test(String(highlightDraftId || "")));
  const load = () => apiFetch("/agent/waiting").then(w => setN(agentDraftsIn(w).length)).catch(() => setN(0));
  useEffect(() => { load(); }, []);
  if (!n) return null;
  return (
    <div data-testid="agent-drafts-waiting" style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", background: T.bg2, borderRadius: 10, padding: "10px 14px" }}>
      <span style={{ fontSize: 13.5, color: T.ink }}>{n === 1 ? `One note ${atlasName()} drafted is` : `${n} notes ${atlasName()} drafted are`} waiting for you.</span>
      <button onClick={() => setOpen(true)} style={{ background: T.greenDk, border: "none", borderRadius: 8, padding: "8px 14px", color: T.white, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Review all {n}</button>
      {open && <AgentDraftReview onClose={() => { setOpen(false); load(); }} onChanged={load} />}
    </div>
  );
}

function MilestoneDraftsPanel({ highlightDraftId, onEditTemplate }) {
  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ subject: "", body: "" });
  const [busyId, setBusyId] = useState(null);
  const rowRefs = useRef({});

  const load = async () => {
    setLoading(true);
    try { setDrafts(await apiFetch("/milestone-drafts")); } catch (e) {}
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!highlightDraftId || loading) return;
    const el = rowRefs.current[highlightDraftId];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightDraftId, loading]);

  const startEdit = (d) => { setEditingId(d.id); setEditForm({ subject: d.subject, body: d.body }); };
  const cancelEdit = () => { setEditingId(null); };

  const saveEdit = async (id) => {
    setBusyId(id);
    try {
      await apiFetch(`/milestone-drafts/${id}`, { method: "PUT", body: JSON.stringify(editForm) });
      setDrafts(prev => prev.map(d => d.id === id ? { ...d, ...editForm, reviewed_at: new Date().toISOString() } : d));
      setEditingId(null);
    } catch (e) { alert(errorMessage(e)); }
    setBusyId(null);
  };

  const send = async (id) => {
    if (!(await askConfirm({ title: "Send this email now?", body: "It goes to the donor as soon as you say so.", yes: "Send" }))) return;
    setBusyId(id);
    try {
      await apiFetch(`/milestone-drafts/${id}/send`, { method: "POST" });
      setDrafts(prev => prev.filter(d => d.id !== id));
    } catch (e) { alert(errorMessage(e)); }
    setBusyId(null);
  };

  // FIX-12 Part 2: "reviewed" is her saying the words are right. Only
  // reviewed drafts go out with "Send all reviewed".
  const markReviewed = async (id) => {
    setBusyId(id);
    try {
      await apiFetch(`/milestone-drafts/${id}/reviewed`, { method: "POST" });
      setDrafts(prev => prev.map(d => d.id === id ? { ...d, reviewed_at: new Date().toISOString() } : d));
    } catch (e) { alert(errorMessage(e)); }
    setBusyId(null);
  };
  const reviewedCount = drafts.filter(d => d.reviewed_at).length;
  const sendAllReviewed = async () => {
    if (!(await askConfirm({ title: `Send ${reviewedCount} reviewed draft${reviewedCount === 1 ? "" : "s"} now?`, body: "Each one goes to its donor as soon as you say so.", yes: "Send" }))) return;
    setBusyId("all");
    try {
      const r = await apiFetch("/milestone-drafts/send-reviewed", { method: "POST" });
      if (r.failed && r.failed.length) alert(`${r.sent} sent. ${r.failed.length} could not be sent: ${r.failed.map(f => f.error).join("; ")}`);
      await load();
    } catch (e) { alert(errorMessage(e)); }
    setBusyId(null);
  };

  // EMAIL-1 — the draft's words from a template, with this person's name in
  // them. Still a draft; Undo puts the old words back.
  const fromTemplate = async (d, tpl) => {
    setBusyId(d.id);
    try {
      const r = await apiFetch(`/milestone-drafts/${d.id}/from-template`, { method: "POST", body: JSON.stringify({ templateId: tpl.id }) });
      setDrafts(prev => prev.map(x => x.id === d.id ? { ...x, ...r.draft } : x));
      offerUndo({ message: r.sentence, undoAction: async () => {
        const y = await apiFetch(`/milestone-drafts/${d.id}/restore`, { method: "POST", body: JSON.stringify(r.previous) });
        setDrafts(prev => prev.map(x => x.id === d.id ? { ...x, ...y.draft } : x));
        return y;
      } }, "draft");
    } catch (e) { alert(errorMessage(e)); }
    setBusyId(null);
  };

  const dismiss = async (id) => {
    if (!(await askConfirm({ title: "Dismiss this draft?", body: "It is set aside without sending.", yes: "Dismiss" }))) return;
    setBusyId(id);
    try {
      await apiFetch(`/milestone-drafts/${id}/dismiss`, { method: "POST" });
      setDrafts(prev => prev.filter(d => d.id !== id));
    } catch (e) { alert(errorMessage(e)); }
    setBusyId(null);
  };

  const inp = { background: T.bg, border: "1px solid " + T.bg3, borderRadius: 8, padding: "9px 12px", color: T.ink, fontSize: 13, outline: "none", width: "100%", boxSizing: "border-box", fontFamily: "inherit" };

  if (loading) return <Spin />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: T.ink }}>Drafts to review</h2>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: T.ink3 }}>
          Emails drafted for a milestone, an anniversary, a journey step or Atlas. Steward drafts it. You send it. Nothing goes to a donor until somebody sends it from here.
        </p>
        <AgentDraftsWaiting highlightDraftId={highlightDraftId} />
        <div style={{ marginTop: 14 }}><ThankYouDrafts highlightId={highlightDraftId} testid="comms-ty-drafts" /></div>
        {reviewedCount > 0 && (
          <button type="button" data-commit data-testid="drafts-send-reviewed" onClick={sendAllReviewed} disabled={busyId === "all"}
            style={{ marginTop: 12, background: T.green, border: "none", borderRadius: 8, padding: "8px 14px", color: T.white, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
            {busyId === "all" ? "Sending…" : `Send all reviewed (${reviewedCount})`}
          </button>
        )}
      </div>

      {drafts.length === 0 && (
        <div style={{ background: T.bg2, borderRadius: 12, padding: 40, textAlign: "center", color: T.ink3, fontSize: 14 }}>
          Nothing waiting on you. When a donor crosses a milestone, hits a giving anniversary or reaches a journey step, the draft waits here for you. Nothing sends itself.
        </div>
      )}

      {drafts.map(d => (
        <div key={d.id} ref={el => { rowRefs.current[d.id] = el; }} style={{ background: T.white, border: (highlightDraftId === d.id ? "2px solid " + T.gold : "1px solid " + T.bg3), boxShadow: highlightDraftId === d.id ? "0 0 0 3px " + T.gold + "22" : "none", borderRadius: 12, padding: 18, transition: "box-shadow 0.3s" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>
                {d.donor_id ? <DonorLink id={d.donor_id} data-testid="draft-person" style={{ color: T.ink }}>{d.donor_name}</DonorLink> : d.donor_name}
              </div>
              <div style={{ fontSize: 12, color: T.ink3 }}>{d.donor_email} · {d.donor_id
                ? <Figure variant="cell" kind="money" value={Number(d.donor_total_giving || 0)} label={`${d.donor_name}, lifetime giving`} source={{ key: "donor-lifetime", params: { donor: d.donor_id } }} />
                : fmtFull(d.donor_total_giving || 0)} lifetime giving</div>
              <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 2 }}>
                {d.source && d.source.startsWith("workflow:") ? "Drafted by an automatic step" : d.source === "journey" ? "From a journey step" : "Milestone draft"}
                {d.reviewed_at ? <strong style={{ color: T.greenMid }}> · Reviewed</strong> : null}
              </div>
            </div>
            <div style={{ fontSize: 11, color: T.ink3 }}>{displayDate(new Date(d.created_at))}</div>
          </div>

          {editingId === d.id ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <input style={inp} value={editForm.subject} onChange={e => setEditForm(f => ({ ...f, subject: e.target.value }))} placeholder="Subject" />
              <textarea style={{ ...inp, minHeight: 140, resize: "vertical" }} value={editForm.body} onChange={e => setEditForm(f => ({ ...f, body: e.target.value }))} placeholder="Body" />
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => saveEdit(d.id)} disabled={busyId === d.id} style={{ background: T.green, border: "none", borderRadius: 8, padding: "8px 14px", color: T.white, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Save</button>
                <button onClick={cancelEdit} style={{ background: "transparent", border: "1px solid " + T.bg3, borderRadius: 8, padding: "8px 14px", color: T.ink3, fontSize: 12, cursor: "pointer" }}>Cancel</button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ background: T.bg, borderRadius: 8, padding: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, marginBottom: 6 }}>{d.subject}</div>
                <div style={{ fontSize: 13, color: T.ink2 || T.ink, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{d.body}</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => send(d.id)} disabled={busyId === d.id} style={{ background: T.green, border: "none", borderRadius: 8, padding: "8px 14px", color: T.white, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                  {busyId === d.id ? "Sending…" : "Send"}
                </button>
                {!d.reviewed_at && <button onClick={() => markReviewed(d.id)} disabled={busyId === d.id} style={{ background: "transparent", border: "1px solid " + T.bg3, borderRadius: 8, padding: "8px 14px", color: T.ink, fontSize: 12, cursor: "pointer" }}>Mark reviewed</button>}
                <button onClick={() => startEdit(d)} style={{ background: "transparent", border: "1px solid " + T.bg3, borderRadius: 8, padding: "8px 14px", color: T.ink, fontSize: 12, cursor: "pointer" }}>Edit</button>
                <TemplateStart disabled={busyId === d.id} onPick={tpl => fromTemplate(d, tpl)} />
                {/* FIX-39: a draft made from a template opens that template in the email editor. */}
                {d.template_id && onEditTemplate && (
                  <button type="button" data-testid="edit-in-editor" onClick={() => onEditTemplate(d.template_id)}
                    style={{ background: "transparent", border: "1px solid " + T.bg3, borderRadius: 8, padding: "8px 14px", color: T.ink2, fontSize: 12, cursor: "pointer" }}>Edit in editor</button>
                )}
                <button onClick={() => dismiss(d.id)} disabled={busyId === d.id} style={{ background: "transparent", border: "1px solid " + T.bg3, borderRadius: 8, padding: "8px 14px", color: T.ink3, fontSize: 12, cursor: "pointer" }}>Dismiss</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
// ── INT-3 · THE CAMPAIGNS SOMEBODY ELSE SENT ────────────────────────────────
//
// Every number here opens its people, and the gifts column says what it is:
// gifts that arrived within thirty days of the send, sitting BESIDE the
// campaign. Not credited to it. A column headed "raised" beside an open rate is
// read as attribution whatever the footnote says, so the words do the work.
function EmailToolPanel({ onNavigate }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(null);   // {campaign, which, people}
  useEffect(() => {
    apiFetch("/email-marketing/campaigns")
      .then(setD).catch(e => setErr(errorMessage(e, "That did not load.")));
  }, []);
  // FIX-40 · `page` opens the campaign's own page (what the tool reports about
  // it, then the people it can name); otherwise the people behind one number.
  const openRows = (c, which, page) => {
    apiFetch(`/email-marketing/campaigns/${c.id}/people?which=${which}`)
      .then(r => setOpen({ ...r, page: !!page })).catch(e => setErr(errorMessage(e, "Those rows did not load.")));
  };
  const pct = r => r === null || r === undefined ? "" : Math.round(r * 100) + "%";
  // A DATE FORMATTER, NOT A MONEY ONE. `fmtFull` is currency, and it printed
  // "$0" in the Sent column for every campaign: a date rendered as nothing,
  // twice a lie, because $0 also reads as a campaign that raised nothing.
  const sentDay = v => {
    if (!v) return "not sent";
    const d = new Date(String(v).length <= 10 ? String(v) + "T00:00:00Z" : v);
    return isNaN(d) ? String(v).slice(0, 10)
      : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
  };

  if (err) return <div style={{ color: T.ink, padding: 24 }}>{err}</div>;
  if (!d) return <Spin />;
  const rows = d.campaigns || [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div>
        <div style={{ fontSize: 20, fontWeight: 700, color: T.ink }}>Your email tool</div>
        <div style={{ fontSize: 13, color: T.inkSoft, marginTop: 6, maxWidth: 680, lineHeight: 1.5 }}>
          The campaigns your organization sent from Mailchimp or Constant Contact. Steward did not send
          these and cannot resend one. It reads who opened, who clicked and who asked to stop, and puts
          that on the person's own record.
        </div>
      </div>

      {!rows.length && (
        <div style={{ background: T.cream, border: `1px solid ${T.line}`, borderRadius: 10, padding: 20 }}>
          <div style={{ fontWeight: 600, color: T.ink }}>Nothing read back yet.</div>
          <div style={{ fontSize: 13, color: T.inkSoft, marginTop: 6 }}>
            Connect Mailchimp or Constant Contact on the Connections screen, choose which audience to keep
            in step, and the campaigns you have already sent will appear here.
          </div>
          {onNavigate && (
            <button onClick={() => onNavigate("settings", { section: "connections" })}
              style={{ marginTop: 14, background: T.green, color: "#fff", border: "none", borderRadius: 8,
                       padding: "9px 16px", fontWeight: 600, cursor: "pointer" }}>
              Open Connections
            </button>
          )}
        </div>
      )}

      {!!rows.length && (
        <div style={{ border: `1px solid ${T.line}`, borderRadius: 10, overflowX: "auto", background: "#fff" }}>
          <table style={{ width: "100%", minWidth: 640, borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: T.cream, textAlign: "left" }}>
                <th style={{ padding: "10px 12px", color: T.ink }}>Campaign</th>
                <th style={{ padding: "10px 12px", color: T.ink }}>Sent</th>
                <th style={{ padding: "10px 12px", color: T.ink }}>Delivered</th>
                <th style={{ padding: "10px 12px", color: T.ink }}>Opened</th>
                <th style={{ padding: "10px 12px", color: T.ink }}>Clicked</th>
                <th style={{ padding: "10px 12px", color: T.ink }}>Gifts within 30 days</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(c => (
                <tr key={c.id} style={{ borderTop: `1px solid ${T.line}` }}>
                  <td style={{ padding: "10px 12px" }}>
                    <button {...interactive(() => openRows(c, "delivered", true), { label: `Open ${c.name}` })} data-testid="emailtool-name"
                      style={{ background: "none", border: "none", padding: 0, color: T.ink, fontWeight: 600, cursor: "pointer", textDecoration: "underline", textAlign: "left", font: "inherit" }}>
                      {c.name}
                    </button>
                  </td>
                  <td style={{ padding: "10px 12px", color: T.inkSoft }}>{sentDay(c.sentAt)}</td>
                  <td style={{ padding: "10px 12px" }}>
                    <button {...interactive(() => openRows(c, "delivered"), { label: `Who ${c.name} went to` })} data-testid="emailtool-delivered"
                      style={{ background: "none", border: "none", padding: 0, color: T.green, fontWeight: 600, cursor: "pointer", textDecoration: "underline" }}>
                      {c.sends.toLocaleString()}
                    </button>
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <button {...interactive(() => openRows(c, "opens"), { label: `Who opened ${c.name}` })}
                      style={{ background: "none", border: "none", padding: 0, color: T.green,
                               fontWeight: 600, cursor: "pointer", textDecoration: "underline" }}>
                      {c.opens.toLocaleString()}{pct(c.openRate) ? ` (${pct(c.openRate)})` : ""}
                    </button>
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <button {...interactive(() => openRows(c, "clicks"), { label: `Who clicked ${c.name}` })}
                      style={{ background: "none", border: "none", padding: 0, color: T.green,
                               fontWeight: 600, cursor: "pointer", textDecoration: "underline" }}>
                      {c.clicks.toLocaleString()}{pct(c.clickRate) ? ` (${pct(c.clickRate)})` : ""}
                    </button>
                  </td>
                  <td style={{ padding: "10px 12px", color: T.ink }}>
                    {/* "none" rather than a dash: no em dashes reach a screen,
                        and a word says what an empty cell means. */}
                    <EmailToolGifts campaign={c} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: "10px 12px", borderTop: `1px solid ${T.line}`, background: T.cream,
                        fontSize: 12, color: T.inkSoft, lineHeight: 1.5 }}>
            {d.giftWindowSentence}
          </div>
        </div>
      )}

      {open && (
        <Modal onClose={() => setOpen(null)} title={open.page ? open.campaign.name : `${open.campaign.name}: ${open.which === "delivered" ? "who it went to" : open.which}`}>
          {open.page && (
            <div data-testid="emailtool-campaign-page" style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 14px", fontSize: 13, marginBottom: 14 }}>
              <span style={{ color: T.inkSoft }}>Subject</span><span style={{ color: T.ink }}>{open.campaign.subject || "Not reported by the email tool"}</span>
              <span style={{ color: T.inkSoft }}>Sent</span><span style={{ color: T.ink }}>{sentDay(open.campaign.sentAt)} from {open.campaign.provider}</span>
              <span style={{ color: T.inkSoft }}>Delivered</span><span style={{ color: T.ink }}>{Number(open.campaign.sends || 0).toLocaleString()}</span>
              <span style={{ color: T.inkSoft }}>Body</span><span style={{ color: T.inkSoft }}>Steward does not read the email's body or the list name from {open.campaign.provider}. Open it there to see the words.</span>
            </div>
          )}
          {/* The tool's count and the people Steward can name are two numbers,
              and the sentence says so rather than letting 188 open onto three
              rows as though that footed. */}
          <div style={{ fontSize: 13, color: T.inkSoft, marginBottom: 10, lineHeight: 1.5 }}>
            {open.sentence}
          </div>
          <div style={{ maxHeight: 360, overflowY: "auto" }}>
            {open.people.map((p, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12,
                                    padding: "7px 0", borderTop: i ? `1px solid ${T.line}` : "none" }}>
                {p.donorId
                  ? <DonorLink id={p.donorId} data-testid="emailtool-person" style={{ color: T.ink, fontWeight: 600 }}>{p.name}</DonorLink>
                  : <span style={{ color: T.ink }} title="An address on the list that is not a person on file here">{p.name}</span>}
                <span style={{ color: T.inkSoft, fontSize: 12 }}>
                  {p.clicked ? (p.clickedLabel ? `clicked ${p.clickedLabel}` : "clicked") : p.opened ? "opened" : ""}
                </span>
              </div>
            ))}
            {!open.people.length && <div style={{ color: T.inkSoft }}>Nobody yet.</div>}
          </div>
        </Modal>
      )}
    </div>
  );
}

export function Communications({ data, isReadOnly, initialNav, onInitialNavConsumed, highlightDraftId, onNavigate }) {
  const [hubSeqGate] = useSequenceGate();   // FIX-27 Part 9: one truth about paused sequences
  const { auth } = useAuth();
  const isAdmin = auth?.user?.role === "admin";

  // CAN-SPAM: every campaign/sequence footer carries the org's postal address
  // (sourced from Settings → Tax Receipts' receipt_address). Until it's set,
  // surface a prompt here — sends still work, they just go out without the
  // legally required address line. null = confirmed missing; undefined =
  // loading/fetch failed (no banner either way, never a false alarm).
  const [orgPostalAddress, setOrgPostalAddress] = useState(undefined);
  useEffect(() => {
    apiFetch("/me").then(({ org }) => setOrgPostalAddress(org?.receipt_address || null)).catch(() => {});
  }, []);

  // Sidebar nav
  const [nav, setNav] = useState(() => commsNavOf(initialNav));
  // CHECK-2: the draft a link names is held here, because the intent that
  // carried it is cleared on mount, before the drafts panel has loaded.
  const [heldDraftId] = useState(highlightDraftId || null);
  // BUILD-97 — the hub's single read. One request, so the landing screen does
  // not assemble itself in a different order on every visit.
  const [hub, setHub] = useState(null);
  const [hubErr, setHubErr] = useState("");
  const loadHub = useCallback(() => {
    apiFetch("/communications/hub").then(h => { setHub(h); setHubErr(""); })
      .catch(e => setHubErr(e?.message || "Could not load"));
  }, []);
  useEffect(() => { loadHub(); }, [loadHub]);
  useEffect(() => { if (initialNav && onInitialNavConsumed) onInitialNavConsumed(); }, []);

  // Campaigns
  const [campaigns, setCampaigns]     = useState([]);
  const [loading, setLoading]         = useState(true);
  // FIX-15 Part 5: /app/communications?subtab=campaigns&campaign=<id> opens
  // with that campaign expanded, so a campaign's name is a real link.
  const [expandedId, setExpandedId]   = useState(() => urlParam("communications", "campaign"));
  // WIRE-1: /app/communications?audience=<group id> (a Group page's "Email
  // this group") opens a new campaign with that group as its audience. It
  // opens a draft and nothing more: she writes it, and each send is hers.
  const [presetSeg] = useState(() => { const a = urlParam("communications", "audience"); return a ? { mode: "audience", audienceId: a } : null; });
  const [failedOnly, setFailedOnly]   = useState(null);   // WHY-1 Part 8: the campaign whose failed rows are showing
  // FIX-6 item 5 — which figure is open, and the rows behind it.
  const [statRows, setStatRows] = useState(null);
  // FIX-39 — the one table's filter, and which row's More menu is open.
  const [campFilter, setCampFilter] = useState("all");
  const [moreFor, setMoreFor] = useState(null);
  // FIX-39 · EDIT IN EDITOR. Which template the email editor is open on, and
  // where its Back goes. From inside Communications that is the screen it came
  // from; from another screen (?template=<id>&back=<path>) it is that path,
  // on this site's own origin only (safeBack refuses anything else).
  const [tplOpen, setTplOpen] = useState(() => {
    const id = urlParam("communications", "template");
    if (!id) return null;
    const backPath = safeBack(urlParam("communications", "back"));
    return { id, back: backPath ? () => window.location.assign(window.location.origin + backPath) : () => {} };
  });
  const [sendResult, setSendResult]   = useState(null);

  // Builder
  const [view, setView]               = useState("list"); // list | builder
  // POLISH-3: the second click of a double click lands after the screen has
  // changed, on whatever the editor put under the pointer. For half a second
  // after the editor opens, a click goes nowhere, so pressing twice lands
  // exactly where pressing once does.
  const openTemplateEditor = (id, back, ctx = {}) => {
    const swallow = e => { e.stopPropagation(); e.preventDefault(); };
    document.addEventListener("click", swallow, true);
    setTimeout(() => document.removeEventListener("click", swallow, true), 500);
    setView("list"); setTplOpen({ id, back: back || (() => {}), title: ctx.title || null, backLabel: ctx.backLabel || null }); setNav("templates");
  };
  // WIRE-1: arriving with a group opens New Campaign (the starting emails),
  // and whichever she picks starts with that group as its audience.
  useEffect(() => { if (presetSeg && !isReadOnly) { setNav("campaigns"); setView("gallery"); } }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const [form, setForm]               = useState(BLANK);
  const [editingId, setEditingId]     = useState(null);
  const [sending, setSending]         = useState(false);
  const [aiLoading, setAiLoading]     = useState(false);
  const [aiDraft, setAiDraft]         = useState("");
  const [aiNote, setAiNote]           = useState("");
  const [linkLoading, setLinkLoading] = useState(false);
  const editorRef                     = useRef(null);
  const [editorKey, setEditorKey]     = useState(0);

  // Donors (loaded lazily)
  const [allDonors, setAllDonors]     = useState([]);

  // Audience tab segment preview
  // FIX-40 · the campaign page: the email as sent, when, and to whom.
  const [asSent, setAsSent] = useState(null);
  const [newBtnHover, setNewBtnHover] = useState(false);
  const [hoveredRowId, setHoveredRowId] = useState(null);

  // ── BUILD-88c C.2 — never a blank box ──────────────────────────────────────
  const [gallery, setGallery]       = useState(null);  // server: the six + brand
  const [segPreview, setSegPreview] = useState(null);  // the segment, as people
  const [testState, setTestState]   = useState(null);  // send-me-a-test result
  const [liveHtml, setLiveHtml]     = useState("");    // what the editor holds, now
  const [showSchedule, setShowSchedule] = useState(false);
  // EMAIL-1 — the org's own email templates, offered first in New Campaign.
  // null while loading; [] when there are none or the route is not there.
  const [myTemplates, setMyTemplates] = useState(null);
  const [approvalNote, setApprovalNote] = useState("");
  // BUILD-94 Part 4 — the org's own zone, named beside the picker so a typed
  // time is never ambiguous. From the sequence builder payload, which already
  // resolves it through the one timezone seam.
  const [orgTimezone, setOrgTimezone] = useState(null);
  useEffect(() => { apiFetch("/sequences/builder").then(r => setOrgTimezone(r && r.timezone)).catch(() => {}); }, []);
  const t = useMemo(() => makeT(data?.org?.vocabulary), [data?.org?.vocabulary]);
  // The server's six carry the org's real name and vocabulary. If that call
  // fails the same six are built here from the shared module — the gallery is
  // never empty, because an empty gallery is a blank box with extra steps.
  const templates = useMemo(() => (
    gallery?.templates?.length ? gallery.templates
      : templatesFor({ orgName: data?.org?.name || "your organization", t })
  ), [gallery, data?.org?.name, t]);
  const brand = gallery?.brand || null;
  // Which sending identity is in force — hers, or Steward's with her name on
  // it. The preview says so under the email, because "who is this from" is the
  // first thing a donor decides and she should see the same answer they will.
  const [sendingIdentity, setSendingIdentity] = useState(null);
  useEffect(() => {
    apiFetch("/org/sending-domain").then(setSendingIdentity).catch(() => {});
  }, []);
  // Re-read whenever the builder closes, so a starter somebody just made their
  // own stops saying "Not yet reviewed" without a reload.
  useEffect(() => {
    if (view === "builder") return;
    apiFetch("/campaigns/templates").then(setGallery).catch(() => {});
  }, [view]);
  useEffect(() => {
    if (view !== "gallery") return;
    apiFetch("/email-templates")
      .then(r => setMyTemplates((Array.isArray(r) ? r : (Array.isArray(r?.templates) ? r.templates : [])).filter(x => !x.archived && !x.personKind)))
      .catch(() => setMyTemplates([]));
  }, [view]);

  const loadCampaigns = async () => {
    try { setCampaigns(await apiFetch("/campaigns")); } catch (e) { console.error(e); }
    setLoading(false);
  };
  const loadDonors = async () => {
    if (allDonors.length) return;
    // Summaries carry every field the segment predicates read (email,
    // total_giving, status, stage, capacity_tier) at a fraction of the payload
    try { setAllDonors(await apiFetch("/donors/summaries")); } catch (e) { console.error(e); }
  };

  // BUILD-94 Part 4 — the sent list's counts, server-computed so the screen
  // and the numbers cannot disagree.
  const [sentRows, setSentRows] = useState([]);
  const loadSent = () => apiFetch("/campaigns/sent").then(r => setSentRows((r && r.campaigns) || [])).catch(() => setSentRows([]));
  useEffect(() => { loadCampaigns(); loadDonors(); loadSent(); }, []);

  // Poll while any campaign is sending
  const anySending = campaigns.some(c => c.status === "sending");
  useEffect(() => {
    if (!anySending) return;
    const tid = setInterval(() => { loadCampaigns(); loadSent(); }, 5000);
    return () => clearInterval(tid);
  }, [anySending]);

  // ── Derived stats ───────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const sent = campaigns.filter(c => c.status === "sent");
    const totalSent = sent.reduce((s, c) => s + (c.recipient_count || 0), 0);
    const totalOpen = sent.reduce((s, c) => s + (c.open_count || 0), 0);
    const avgOpen   = totalSent > 0 ? Math.round(totalOpen / totalSent * 100) : 0;
    const active    = campaigns.filter(c => c.status === "sending" || c.status === "scheduled").length;
    return { totalSent, avgOpen, active };
  }, [campaigns]);

  // ── Analytics (must be before any early return — Rules of Hooks) ────────────
  const topByOpen = useMemo(() => {
    return [...campaigns]
      .filter(c => c.status === "sent" && (c.recipient_count || 0) > 0)
      .map(c => ({ ...c, rate: Math.round((c.open_count || 0) / c.recipient_count * 100) }))
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 5);
  }, [campaigns]);

  // The segment, as PEOPLE, answered by the side that does the sending. It is
  // the only count on the screen (FIX-26): the browser used to count its own,
  // and two answers to "who gets this" is one too many.
  const segKey = JSON.stringify(form.seg);
  useEffect(() => {
    if (view !== "builder") return;
    let dead = false;
    const tid = setTimeout(() => {
      apiFetch("/campaigns/segment-preview", { method: "POST", body: JSON.stringify({ segment: JSON.parse(segKey) }) })
        .then(r => { if (!dead) setSegPreview(r); })
        .catch(() => { if (!dead) setSegPreview(null); });
    }, 250);
    return () => { dead = true; clearTimeout(tid); };
  }, [view, segKey]);

  // POLISH-3 · A TEMPLATE CAMPAIGN'S PREVIEW IS THE SEND'S RENDER, for the
  // first person on the list (the server's /campaigns/:id/preview). It used to
  // read campaigns.body, a snapshot the seeded Year-end appeal never had.
  const [campPreview, setCampPreview] = useState(null);
  const firstId = segPreview?.first?.id || "";
  const fromBlocks = !!(form.fromTemplate && !form.detach);
  useEffect(() => {
    if (view !== "builder" || !fromBlocks || !editingId) { setCampPreview(null); return; }
    let dead = false;
    apiFetch(`/campaigns/${editingId}/preview`, { method: "POST", body: JSON.stringify({ donorId: firstId || undefined, segment: JSON.parse(segKey) }) })
      .then(r => { if (!dead) setCampPreview(r); })
      .catch(() => { if (!dead) setCampPreview({ html: "", problems: ["The preview could not be drawn."] }); });
    return () => { dead = true; };
  }, [view, fromBlocks, editingId, firstId, form.source]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ── Builder actions ─────────────────────────────────────────────────────────
  const openBuilder = (campaign = null) => {
    setTestState(null); setSegPreview(null); setShowSchedule(false);
    // NEVER A BLANK BOX. A new campaign starts at the six, not at a cursor —
    // writing an appeal from nothing is the hardest thing on the screen and it
    // is not what Steward should ask for first.
    if (!campaign) { setView("gallery"); return; }
    const raw = typeof campaign.segment === "string" ? JSON.parse(campaign.segment || "{}") : (campaign.segment || {});
    const mode = raw.mode || "all";
    const body = normalizeMergeFields(campaign.body || "");
    setForm({ name: campaign.name || "", subject: campaign.subject || "", bodyHtml: body,
      seg: { mode, stages: raw.stages || [], tiers: raw.tiers || [], donorIds: raw.donorIds || [],
             ...(raw.audienceId ? { audienceId: raw.audienceId, audienceName: raw.audienceName || undefined } : {}) },
      scheduledAt: campaign.scheduled_at ? new Date(campaign.scheduled_at).toISOString().slice(0, 16) : "",
      // EMAIL-1 — a campaign from a template: its words are the template's
      // blocks, rendered for each person at send. `detach` lets them go.
      fromTemplate: Array.isArray(campaign.email_blocks) && campaign.email_blocks.length > 0, detach: false,
      status: campaign.status || "draft", templateId: campaign.template_id || null, source: campaign });
    setApprovalNote("");
    setEditingId(campaign.id);
    setShowSchedule(!!campaign.scheduled_at);
    setLiveHtml(body);
    setEditorKey(k => k + 1); setAiDraft(""); setView("builder");
  };

  // One of the six, opened as a campaign. The words arrive already written and
  // already in the org's name; what is left is the part that is hers.
  const openTemplate = (tpl) => {
    const body = normalizeMergeFields(tpl.body || "");
    setForm({ name: tpl.label || tpl.name || "", subject: tpl.subject || "", bodyHtml: body,
      seg: presetSeg ? { ...presetSeg } : { mode: "all" }, scheduledAt: "",
      // PARITY-1 E — which starter this came from, so a save can say whether
      // its words were changed (the server decides).
      starterKey: tpl.key || "", starterReviewed: !!tpl.reviewed, starterBody: body });
    setEditingId(null); setLiveHtml(body); setTestState(null); setShowSchedule(false);
    setEditorKey(k => k + 1); setAiDraft(""); setView("builder");
  };

  // FIX-39: returns the copy, so "Duplicate to edit" can open it. A campaign
  // built from a template is copied from that template, so the copy keeps its
  // blocks instead of becoming a plain email of the rendered words.
  const duplicateCampaign = async (c) => {
    const raw = typeof c.segment === "string" ? JSON.parse(c.segment || "{}") : (c.segment || {});
    const payload = { name: "Copy of " + c.name, subject: c.subject, body: c.body, segment: raw, status: "draft" };
    try {
      const copy = c.template_id
        ? await apiFetch("/campaigns/from-template", { method: "POST", body: JSON.stringify({ templateId: c.template_id, name: "Copy of " + c.name }) })
        : await apiFetch("/campaigns", { method: "POST", body: JSON.stringify(payload) });
      await loadCampaigns();
      return copy;
    } catch (e) { alert(errorMessage(e)); return null; }
  };

  // EMAIL-1 — a template campaign has no editor on screen, so its body is the
  // preview it arrived with; letting the template go sends `emailBlocks: null`.
  const templateMode = !!(form.fromTemplate && !form.detach);
  const currentBody = () => (templateMode ? form.bodyHtml : (editorRef.current?.innerHTML || ""));
  const templateExtras = () => (form.fromTemplate && form.detach ? { emailBlocks: null } : {});

  // A template of her own, opened as a draft campaign. Undo deletes the draft.
  const startFromMyTemplate = async (tpl) => {
    try {
      const c = await apiFetch("/campaigns/from-template", { method: "POST", body: JSON.stringify({ templateId: tpl.id, name: tpl.name }) });
      offerUndo({ message: c.sentence || `Started ${c.name} from a template.`,
        undoAction: async () => { const x = await apiFetch(`/campaigns/${c.id}`, { method: "DELETE" }); setView("list"); await loadCampaigns(); return x; } }, "campaign");
      await loadCampaigns();
      openBuilder(c);
      if (presetSeg) setForm(f => ({ ...f, seg: { ...presetSeg } }));
    } catch (e) { alert(errorMessage(e)); }
  };

  // Approval: somebody who is not an admin asks; an admin approves. Each has
  // its Undo.
  const requestApproval = async () => {
    if (!form.name.trim()) return alert("Campaign name is required.");
    try {
      const payload = { name: form.name, subject: form.subject, body: currentBody(), segment: form.seg, status: "draft",
        scheduledAt: form.scheduledAt || undefined, starterKey: form.starterKey || undefined, ...templateExtras() };
      let id = editingId;
      if (id) await apiFetch(`/campaigns/${id}`, { method: "PUT", body: JSON.stringify(payload) });
      else { const sv = await apiFetch("/campaigns", { method: "POST", body: JSON.stringify(payload) }); id = sv.id; setEditingId(id); }
      const r = await apiFetch(`/campaigns/${id}/request-approval`, { method: "POST", body: "{}" });
      offerUndo({ message: r.sentence, undoAction: async () => { const x = await apiFetch(`/campaigns/${id}/withdraw-approval`, { method: "POST", body: "{}" }); await loadCampaigns(); return x; } }, "approval request");
      await loadCampaigns(); setView("list");
    } catch (e) { setApprovalNote(errorMessage(e)); }
  };
  const approveCampaign = async (c) => {
    try {
      const r = await apiFetch(`/campaigns/${c.id}/approve`, { method: "POST", body: "{}" });
      offerUndo({ message: r.sentence, undoAction: async () => { const x = await apiFetch(`/campaigns/${c.id}/unapprove`, { method: "POST", body: "{}" }); await loadCampaigns(); return x; } }, "approval");
      await loadCampaigns(); loadSent();
    } catch (e) { alert(errorMessage(e)); }
  };

  const saveDraft = async () => {
    if (!form.name.trim()) return alert("Campaign name is required.");
    const body = currentBody();
    const payload = { name: form.name, subject: form.subject, body, segment: form.seg, status: "draft", starterKey: form.starterKey || undefined, ...templateExtras() };
    try {
      if (editingId) await apiFetch(`/campaigns/${editingId}`, { method: "PUT", body: JSON.stringify(payload) });
      else await apiFetch("/campaigns", { method: "POST", body: JSON.stringify(payload) });
      await loadCampaigns(); setView("list");
    } catch (e) { alert(errorMessage(e)); }
  };

  const scheduleIt = async () => {
    if (!form.scheduledAt) return alert("Select a date and time to schedule.");
    if (new Date(form.scheduledAt) <= new Date()) return alert("Scheduled time must be in the future.");
    if (!form.name.trim()) return alert("Campaign name is required.");
    const body = currentBody();
    const payload = { name: form.name, subject: form.subject, body, segment: form.seg, status: "scheduled", scheduledAt: form.scheduledAt, starterKey: form.starterKey || undefined, ...templateExtras() };
    try {
      if (editingId) await apiFetch(`/campaigns/${editingId}`, { method: "PUT", body: JSON.stringify(payload) });
      else await apiFetch("/campaigns", { method: "POST", body: JSON.stringify(payload) });
      await loadCampaigns(); setView("list");
    } catch (e) { alert(errorMessage(e)); }
  };

  const sendNow = async (directId) => {
    let id = directId;
    if (!id) {
      if (!form.name.trim()) return alert("Campaign name is required.");
      const body = currentBody();
      const payload = { name: form.name, subject: form.subject, body, segment: form.seg, status: "draft", starterKey: form.starterKey || undefined, ...templateExtras() };
      try {
        if (editingId) { await apiFetch(`/campaigns/${editingId}`, { method: "PUT", body: JSON.stringify(payload) }); id = editingId; }
        else { const s = await apiFetch("/campaigns", { method: "POST", body: JSON.stringify(payload) }); id = s.id; }
      } catch (e) { alert(errorMessage(e)); return; }
    }
    if (!(await askConfirm({ title: "Send this campaign now?", body: "This sends real emails to everyone on the list.", yes: "Send campaign" }))) return;
    setSending(true); setSendResult(null);
    try {
      const r = await apiFetch(`/campaigns/${id}/send`, { method: "POST" });
      setSendResult(r); await loadCampaigns(); setView("list");
    } catch (e) { alert(errorMessage(e)); }
    setSending(false);
  };

  // One save path for the two things that need a campaign id — the test and the
  // send — so a test never creates a second draft beside the one on screen.
  const saveForSend = async () => {
    const body = currentBody() || form.bodyHtml || "";
    const payload = { name: form.name || "Untitled", subject: form.subject, body, segment: form.seg, status: "draft", starterKey: form.starterKey || undefined, ...templateExtras() };
    if (editingId) { await apiFetch(`/campaigns/${editingId}`, { method: "PUT", body: JSON.stringify(payload) }); return editingId; }
    const saved = await apiFetch("/campaigns", { method: "POST", body: JSON.stringify(payload) });
    setEditingId(saved.id);
    return saved.id;
  };

  // SEND ME A TEST. One copy, to her, under whatever sending identity is in
  // force — and it is not a recipient: nobody's record gets an email on it and
  // the campaign's count does not move.
  const sendTest = async () => {
    setTestState({ state: "sending" });
    try {
      const id = await saveForSend();
      const r = await apiFetch(`/campaigns/${id}/test`, { method: "POST", body: JSON.stringify({}) });
      // FIX-15 Part 3: a 200 with sent:false (no mail key configured) is not a send.
      if (r && r.sent === false) setTestState({ state: "error", message: r.message || r.error || "The test was not sent: email is not set up on this server." });
      else setTestState({ state: "sent", to: r.to, from: r.from, verified: r.verified });
      await loadCampaigns();
    } catch (e) { setTestState({ state: "error", message: errorMessage(e) }); }
  };

  const deleteCampaign = async (c) => {
    const id = c.id;
    if (!(await askConfirm({ title: `Delete "${c.name}"?`, body: c.sent_at ? "The campaign and its counts leave this list. Nothing already sent is recalled." : "The draft and its words are deleted. You can undo it straight after.", yes: "Delete campaign", danger: true }))) return;
    try { const r = await apiFetch(`/campaigns/${id}`, { method: "DELETE" }); await loadCampaigns(); offerUndo(r, "campaign", loadCampaigns); }
    catch (e) { alert(errorMessage(e)); }
  };

  // FIX-27 Part 7: the server writes the draft and checks every claim in it
  // against the record (no invented video, link, amount, date, meeting or
  // event); a draft that fails comes back as the plain template instead.
  const draftAI = async () => {
    setAiLoading(true); setAiDraft("");
    try {
      const r = await apiFetch("/ai/draft-email", { method: "POST",
        body: JSON.stringify({ purpose: "campaign", segment: form.seg, subjectHint: form.subject || "" }) });
      setAiDraft(`Subject: ${r.subject}\n\n${r.body}`);
      if (r.aiOff && r.reasons && r.reasons[0]) setAiNote(r.reasons[0]); else setAiNote("");
    } catch (e) { setAiNote(errorMessage(e, "The draft could not be written just now.")); }
    setAiLoading(false);
  };

  const addDonationLink = async () => {
    setLinkLoading(true);
    try {
      const r = await apiFetch("/stripe/campaign-link", {
        method: "POST",
        body: JSON.stringify({ campaignId: editingId || "", campaignName: form.name }),
      });
      if (editorRef.current) {
        editorRef.current.focus();
        const linkHtml = `<p><a href="${r.url}" style="background:${T.greenDk};color:${T.white};padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">Give Now →</a></p>`;
        document.execCommand("insertHTML", false, linkHtml);
        setLiveHtml(editorRef.current.innerHTML);
      }
    } catch (e) {
      alert(errorMessage(e, "Could not generate donation link. Make sure Stripe is connected in Settings."));
    }
    setLinkLoading(false);
  };

  const applyAIDraft = () => {
    const lines = aiDraft.split("\n");
    const subjLine = lines.find(l => l.startsWith("Subject:"));
    const bodyText = lines.filter(l => !l.startsWith("Subject:")).join("\n").trim();
    if (subjLine) setForm(f => ({ ...f, subject: subjLine.replace("Subject:", "").trim() }));
    if (editorRef.current) {
      const html = bodyText.startsWith("<") ? bodyText
        : bodyText.split(/\n\n+/).map(p => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");
      editorRef.current.innerHTML = html;
      setLiveHtml(html);
    }
    setAiDraft("");
  };

  // THE PREVIEW IS THE EMAIL. Same renderer as the server's send, and the name
  // in it is the FIRST RECIPIENT's — what she reads on the right of the screen
  // is what the first person on the list will open. "Margaret" only when the
  // segment is still empty.
  const previewFirst = segPreview?.first || null;
  const previewOrgName = gallery?.orgName || data?.org?.name || "your organization";
  const renderPreview = (html) => renderMergeFields(html || "", {
    first_name: previewFirst?.firstName || "Margaret",
    donor_name: previewFirst?.name || "Margaret Chen",
    org_name: previewOrgName,
  });
  const getPreviewHtml = () => renderPreview(liveHtml || editorRef.current?.innerHTML || form.bodyHtml || "");

  // ── THE SIX — full screen, in the org's own colours ─────────────────────────
  // This is what "New Campaign" is now. Six emails that could go out today,
  // each one already carrying the org's name, its colours and its logo, so the
  // first decision is "which of these", not "what do I write".
  if (view === "gallery") {
    const stripTags = h => String(h || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return (
      <div data-testid="campaign-gallery" className="fullscreen-takeover" style={{ position: "fixed", top: 52, left: 0, right: 0, bottom: 0, zIndex: 200, background: T.bg, color: T.ink, overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 20px", background: T.white, borderBottom: "1px solid " + T.bg3 }}>
          <button onClick={() => setView("list")} style={{ ...S.btn("ghost"), padding: "6px 12px", fontSize: 12 }}>← Back</button>
          <span style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>New Campaign</span>
        </div>

        <div style={{ maxWidth: 880, margin: "0 auto", padding: "32px 20px 64px" }}>
          <h2 style={{ margin: 0, fontFamily: "'DM Serif Display',serif", fontSize: 28, fontWeight: 400, color: T.ink }}>Start from one of these.</h2>
          <p style={{ margin: "10px 0 28px", fontSize: 14, color: T.ink3, lineHeight: 1.6, maxWidth: 560 }}>
            Every one is a finished email in {previewOrgName}&rsquo;s words, not a skeleton. Change the parts that are yours and press send.
          </p>

          {/* EMAIL-1 — START FROM A TEMPLATE: the org's own, first. */}
          {Array.isArray(myTemplates) && myTemplates.length > 0 && (
            <div data-testid="my-email-templates" style={{ marginBottom: 28 }}>
              <div style={{ ...S.label, marginBottom: 10 }}>Start from a template</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {myTemplates.map(mt => (
                  <button key={mt.id} type="button" data-testid={"my-template-" + mt.id} onClick={() => startFromMyTemplate(mt)}
                    style={{ ...S.btn("ghost"), textAlign: "left", display: "flex", flexDirection: "column", gap: 2, maxWidth: 260 }}>
                    <span style={{ fontWeight: 700, color: T.ink }}>{mt.name}</span>
                    {mt.subject && <span style={{ fontSize: 12, color: T.ink3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 230 }}>{subjectPreview(mt.subject)}</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))", gap: 20 }}>
            {templates.map(tpl => (
              <div key={tpl.key} data-testid={"template-" + tpl.key}
                {...interactive(() => openTemplate(tpl), { label: `Use the ${tpl.label} email` })}
                style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 14, padding: 32,
                  display: "flex", flexDirection: "column", gap: 12 }}>
                {/* The org's band and logo, because this is THEIR email. */}
                <div style={{ background: brand?.band || T.greenDk, color: brand?.bandFg || T.white, borderRadius: 10, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10, minHeight: 20 }}>
                  {brand?.logo
                    ? <img src={brand.logo} alt="" style={{ height: 22, maxWidth: 110, objectFit: "contain" }} />
                    : <span style={{ fontFamily: "'DM Serif Display',serif", fontSize: 15 }}>{brand?.displayName || previewOrgName}</span>}
                </div>
                <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 21, color: T.ink, lineHeight: 1.2 }}>{tpl.label}</div>
                {!tpl.reviewed && <NotReviewedPill />}
                <div style={{ fontSize: 13, color: T.ink3, lineHeight: 1.6 }}>{tpl.blurb}</div>
                <div style={{ borderTop: "1px solid " + T.bg3, paddingTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>{renderPreview(tpl.subject)}</div>
                  <div style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.6, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>
                    {stripTags(renderPreview(tpl.body))}
                  </div>
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.greenDk }}>Use this &rarr;</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Builder full-screen ─────────────────────────────────────────────────────
  if (view === "builder") {
    // The count comes from the side that does the sending, and only from it.
    // Until it has answered, the button waits rather than guessing (FIX-26).
    const recipCount = segPreview ? segPreview.count : null;
    const subjLen = form.subject.length;
    const segSentence = segPreview?.sentence || "";
    const previewName = previewFirst?.firstName || "Margaret";
    // FIX-39 — a campaign that has gone out opens read-only. Its words are
    // what people received; the way to change them is a copy.
    const readOnlySent = !!editingId && ["sent", "sending", "failed"].includes(form.status);
    const duplicateToEdit = async () => {
      const copy = await duplicateCampaign(form.source || { id: editingId, name: form.name, subject: form.subject, body: form.bodyHtml, segment: form.seg, template_id: form.templateId });
      if (copy && copy.id) openBuilder(copy);
    };
    return (
      // FIX-25: under the app's top bar (z 250), never behind it. At inset 0
      // the bar covered this header, Save draft with it, so no draft could be
      // saved. The takeover class starts it beside the sidebar on desktop and
      // full screen on a phone, like the donor profile.
      <div data-testid="campaign-builder" className="fullscreen-takeover" style={{ position: "fixed", top: 52, left: 0, right: 0, bottom: 0, zIndex: 200, display: "flex", flexDirection: "column", background: T.white, color: T.ink }}>
        {/* Header */}
        <div className="cb-head" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 20px", background: T.bg2, borderBottom: "1px solid " + T.bg3, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button onClick={() => setView("list")} style={{ ...S.btn("ghost"), padding: "6px 12px", fontSize: 12 }}>← Back</button>
            <span style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>{readOnlySent ? form.name : editingId ? "Edit campaign" : "New campaign"}</span>
            {readOnlySent && <StatusBadge status={form.status} campaign={form.source} />}
          </div>
          {/* ONE action, and it is emerald. Everything else here is a way back
              to the draft; scheduling is a link, because a campaign that is
              scheduled is still a campaign that was sent on purpose. */}
          {readOnlySent ? (
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }} data-testid="campaign-read-only">
            <span style={{ fontSize: 12.5, color: T.ink2 }}>This campaign has gone out, so it can&rsquo;t change.</span>
            <button type="button" onClick={duplicateToEdit} disabled={isReadOnly} data-testid="duplicate-to-edit" style={S.btn("send")}>Duplicate to edit</button>
          </div>
          ) : (
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <button onClick={saveDraft} style={S.btn("ghost")}>Save draft</button>
            {!isAdmin && form.status !== "awaiting_approval" && (
              <button onClick={requestApproval} data-testid="campaign-request-approval" style={S.btn("send")}>Ask an admin to approve</button>
            )}
            {!isAdmin && form.status === "awaiting_approval" && (
              <span style={{ fontSize: 12.5, color: T.ink2 }}>Waiting for an admin to approve it.</span>
            )}
            {isAdmin && ((showSchedule || form.scheduledAt)
              ? <button onClick={scheduleIt} style={S.btn("send")}>Schedule</button>
              : <button type="button" data-commit onClick={() => sendNow(null)} disabled={sending || recipCount == null} data-testid="campaign-send"
                  style={{ ...S.btn("send"), opacity: (sending || recipCount == null) ? 0.6 : 1, cursor: (sending || recipCount == null) ? "not-allowed" : "pointer" }}>
                  {sending ? <><Spin /> Sending…</> : recipCount == null ? "Counting…" : `↑ Send to ${recipCount.toLocaleString()}`}
                </button>)}
          </div>
          )}
        </div>

        {/* Two-panel body. FIX-26: on a phone the three columns stack and the
            body scrolls as one page (.cb-body in GlobalStyles). */}
        <div className="cb-body" style={{ display: "flex", flex: 1, minHeight: 0 }}>
          {/* FIX-39: a sent campaign's fields are shown, never editable. */}
          <fieldset disabled={readOnlySent} style={{ display: "contents" }}>
          {/* Left: settings */}
          <div className="cb-col cb-settings" style={{ width: 320, flexShrink: 0, padding: 20, borderRight: "1px solid " + T.bg3, overflowY: "auto", display: "flex", flexDirection: "column", gap: 18, background: T.white }}>

            {form.starterKey && !form.starterReviewed && !starterEdited({ body: form.starterBody }, liveHtml || form.bodyHtml) ? (
              <div data-testid="builder-not-reviewed" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <NotReviewedPill />
                <span style={{ fontSize: 12, color: T.ink3, lineHeight: 1.5 }}>
                  These are Steward&rsquo;s starter words. Read them and make them yours before anyone receives them.
                </span>
              </div>
            ) : null}
            <div>
              <label style={S.label}>Campaign Name</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Spring Appeal 2026" style={S.input} />
            </div>

            <div>
              <label style={S.label}>
                Subject Line
                <span style={{ float: "right", color: subjLen > 60 ? T.terracotta : T.ink3 }}>{subjLen}/60</span>
              </label>
              <input value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                placeholder="A message from {{org_name}}" style={S.input} />
            </div>

            <div>
              <label style={S.label}>Audience Segment</label>
              <SegmentPicker seg={form.seg}
                onChange={seg => { setForm(f => ({ ...f, seg })); if (seg.mode === "manual") loadDonors(); }}
                allDonors={allDonors} />
              {/* THE SEGMENT, AS PEOPLE. Nobody notices that 17 is too many;
                  everybody notices a name that should not be on the list. */}
              {segSentence && (
                <div data-testid="segment-sentence" style={{ marginTop: 10, fontSize: 13, color: T.ink2, lineHeight: 1.55 }}>
                  {segSentence}
                </div>
              )}
              <LeftOut preview={segPreview} />
              {/* BUILD-94 Part 1 — and now the first few of them have faces.
                  The sentence already named two; a row of marks is the fastest
                  read there is of "who is actually on this list". */}
              {Array.isArray(segPreview?.names) && segPreview.names.length > 0 && (
                <div data-testid="segment-faces" style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {segPreview.names.map(n => (
                    <PersonMark key={n.id} id={n.id} name={n.name} size={24} title={n.name} />
                  ))}
                </div>
              )}
            </div>

            {/* BUILD-94 Part 4 — SCHEDULING IS A REAL CONTROL, not a link you
                have to know is there. It is the thing Mailchimp does that she
                will look for first, and the time she types is a wall-clock
                time IN HER OWN ZONE — the server converts it, so 9:00 means
                9:00 where she is and not 4 in the morning. */}
            <div>
              <label style={S.label}>Send it later</label>
              <input type="datetime-local" value={form.scheduledAt} data-testid="campaign-schedule-at"
                onChange={e => { setForm(f => ({ ...f, scheduledAt: e.target.value })); if (e.target.value) setShowSchedule(true); }}
                style={{ ...S.input, width: "100%" }} />
              <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 5, lineHeight: 1.5 }}>
                {form.scheduledAt
                  ? <>Goes out at that time in {orgTimezone || "your organization's timezone"}.</>
                  : <>Leave it empty to send it yourself.</>}
              </div>
            </div>

            {aiDraft && (
              <div style={{ background: T.gold50, border: "1px solid " + T.gold300, borderRadius: 10, padding: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: T.gold700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>✦ Suggested Draft</div>
                <div style={{ fontSize: 12, color: T.ink2, lineHeight: 1.7, whiteSpace: "pre-wrap", marginBottom: 10 }}>{aiDraft}</div>
                {aiNote && <div data-testid="ai-draft-note" style={{ fontSize: 12, color: T.ink3, marginBottom: 8 }}>{aiNote}</div>}
                <button onClick={applyAIDraft} style={{ ...S.btn("primary"), padding: "7px 12px", fontSize: 12 }}>Apply to editor</button>
              </div>
            )}
          </div>

          {/* Middle: the editor */}
          <div className="cb-col cb-editor" style={{ flex: 1, minWidth: 0, padding: 20, overflowY: "auto", background: T.white, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <label style={{ ...S.label, marginBottom: 0 }}>Email Body</label>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={draftAI} disabled={aiLoading}
                  style={{ background: aiLoading ? T.bg3 : T.gold100, border: "1px solid " + T.gold300, borderRadius: 8, padding: "6px 12px", color: aiLoading ? T.ink3 : T.gold700, fontSize: 12, fontWeight: 700, cursor: aiLoading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                  {aiLoading ? <><Spin /> Drafting…</> : "✦ Draft copy"}
                </button>
                <button onClick={addDonationLink} disabled={linkLoading}
                  style={{ background: "transparent", border: "1px solid " + T.bg3, borderRadius: 8, padding: "6px 12px", color: linkLoading ? T.ink3 : T.ink2, fontSize: 12, fontWeight: 700, cursor: linkLoading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                  {linkLoading ? <><Spin /> Generating…</> : "Donation link"}
                </button>
              </div>
            </div>
            {approvalNote && <div style={{ fontSize: 12.5, color: T.ink2, lineHeight: 1.55 }}>{approvalNote}</div>}
            {templateMode ? (
              <div data-testid="campaign-from-template" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 13, color: T.ink2, lineHeight: 1.6 }}>
                  This email is built from a template. Each person&rsquo;s copy is made from it when it goes, with their own name and last gift in it.
                  Change its words in the template.
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {/* FIX-39: the template opens in the email editor, and its Back comes here. */}
                  {form.templateId && !readOnlySent && (
                    <button type="button" data-testid="edit-in-editor" onClick={() => {
                      const cid = editingId, src = form.source, name = form.name || (src && src.name) || "this campaign";
                      const kept = form;   // what she had typed here and not saved yet comes back with her
                      // Back takes the template's words into this campaign (it keeps its own
                      // copy), then reopens it, so its preview shows the change.
                      openTemplateEditor(form.templateId, async () => {
                        setNav("campaigns");
                        let fresh = src;
                        if (cid) {
                          await apiFetch(`/campaigns/${cid}/take-template`, { method: "POST", body: "{}" }).catch(() => null);
                          fresh = await apiFetch(`/campaigns/${cid}`).catch(() => src);
                          loadCampaigns();
                        }
                        if (fresh) {
                          openBuilder(fresh);
                          // The template owns the words; the name, the audience and the
                          // schedule are the campaign's, so her unsaved edits to them stay.
                          // The subject stays hers unless the template changed it.
                          const tplSubject = fresh.subject !== (src && src.subject);
                          setForm(f => ({ ...f, name: kept.name, seg: kept.seg, scheduledAt: kept.scheduledAt, ...(tplSubject ? {} : { subject: kept.subject }) }));
                        }
                      }, { title: `Editing the email for ${name}`, backLabel: "Back to campaign" });
                    }}
                      style={{ ...S.btn("ghost") }}>Edit in editor</button>
                  )}
                  <button type="button" onClick={() => { setForm(f => ({ ...f, detach: true })); setEditorKey(k => k + 1); }}
                    style={{ ...S.btn("ghost"), alignSelf: "flex-start" }}>Write it as a plain email instead</button>
                </div>
              </div>
            ) : (
              <RichEditor key={editorKey} editorRef={editorRef} initialHtml={form.bodyHtml} onInput={setLiveHtml} readOnly={readOnlySent} />
            )}
          </div>

          </fieldset>

          {/* Right: THE EMAIL, at the width it will be read at. Not a preview
              of the markup — the same renderer the send uses, with the first
              recipient's own first name in it. */}
          <div className="comm-preview cb-col" style={{ width: 390, flexShrink: 0, borderLeft: "1px solid " + T.bg3, background: T.bg, padding: "20px 20px 32px", overflowY: "auto" }}>
            <div style={{ ...S.label, marginBottom: 12 }}>What {previewName} will see</div>
            {templateMode ? (
              <>
                {campPreview?.subject && <div style={{ fontSize: 13, color: T.ink2, marginBottom: 8, lineHeight: 1.45 }}><b style={{ color: T.ink }}>Subject:</b> {campPreview.subject}</div>}
                {!!campPreview?.problems?.length && (
                  <div data-testid="campaign-preview-problems" style={{ fontSize: 12.5, color: T.ink2, background: T.white, border: "1px solid " + T.gold300, borderRadius: 10, padding: "8px 12px", marginBottom: 8, lineHeight: 1.5 }}>
                    {campPreview.sentence || campPreview.problems[0]}
                  </div>
                )}
                <iframe data-testid="campaign-preview" title="The email" sandbox=""
                  srcDoc={campPreview ? (campPreview.html || "") : ""}
                  style={{ width: "100%", height: 640, border: "1px solid " + T.bg3, borderRadius: 16, background: T.white }} />
                {!campPreview && <div style={{ marginTop: 8 }}><Spin /></div>}
              </>
            ) : (
            <div data-testid="campaign-preview" style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, overflow: "hidden" }}>
              <div style={{ background: brand?.band || T.greenDk, color: brand?.bandFg || T.white, padding: "14px 18px", display: "flex", alignItems: "center", gap: 10, minHeight: 22 }}>
                {brand?.logo
                  ? <img src={brand.logo} alt="" style={{ height: 24, maxWidth: 120, objectFit: "contain" }} />
                  : <span style={{ fontFamily: "'DM Serif Display',serif", fontSize: 16 }}>{brand?.displayName || previewOrgName}</span>}
              </div>
              <div style={{ padding: "18px 18px 26px" }}>
                <div style={{ fontSize: 11, color: T.ink3, marginBottom: 4 }}>
                  From {brand?.displayName || previewOrgName}{sendingIdentity?.verified && sendingIdentity.fromEmail ? ` · ${sendingIdentity.fromEmail}` : ""}
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: T.ink, lineHeight: 1.35, marginBottom: 14 }}>
                  {renderPreview(form.subject) || "No subject yet"}
                </div>
                <hr style={{ border: "none", borderTop: "1px solid " + T.bg3, margin: "0 0 14px" }} />
                <div style={{ fontSize: 14, color: T.ink, lineHeight: 1.8 }}
                  dangerouslySetInnerHTML={{ __html: getPreviewHtml() }} />
              </div>
            </div>
            )}

            {/* SEND ME A TEST — one copy, to her, and it counts against nothing. */}
            {!readOnlySent && <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
              <button onClick={sendTest} disabled={testState?.state === "sending"} data-testid="send-me-a-test"
                style={{ ...S.btn("ghost"), fontWeight: 700, color: T.ink, cursor: testState?.state === "sending" ? "not-allowed" : "pointer" }}>
                {testState?.state === "sending" ? <><Spin /> Sending…</> : "Send me a test"}
              </button>
              {testState?.state === "sent" && (
                <div data-testid="test-result" style={{ fontSize: 12, color: T.ink2, lineHeight: 1.55 }}>
                  Sent to {testState.to}. It went out from {testState.from} and is not counted against this campaign.
                </div>
              )}
              {testState?.state === "error" && (
                <div style={{ fontSize: 12, color: T.terracotta, lineHeight: 1.55 }}>{testState.message}</div>
              )}
              {sendingIdentity?.sentence && (
                <div style={{ fontSize: 11.5, color: T.ink3, lineHeight: 1.55 }}>{sendingIdentity.sentence}</div>
              )}
            </div>}
          </div>
        </div>

        {/* The preview used to be a modal you had to ask for. It is the right
            half of the screen now, and it is live. */}
      </div>
    );
  }

  // ── Section nav items (horizontal top tabs) ─────────────────────────────────
  // FIX-39: no icons on these tabs. They were nine unrelated symbols, not the app's set.
  const NAV = [
    { id: "hub",        label: "Overview" },
    { id: "campaigns",  label: "Campaigns" },
    // One tab for every template: letters, one-person emails, campaign
    // starters and the EMAIL-1 designed emails (WIRE-1-ADDENDUM).
    { id: "templates",  label: "Templates" },
    { id: "audience",   label: "Audience" },
    { id: "analytics",  label: "Analytics" },
    { id: "sequences",  label: "Sequences" },
    // INT-3 — the campaigns she sent from Mailchimp or Constant Contact. A
    // separate entry from "Campaigns" on purpose: those are the ones Steward
    // sent and she can open and edit, these are somebody else's sends that
    // Steward only reports on, and running them together would suggest she
    // could resend one from here.
    { id: "emailtool",  label: "Your email tool" },
    { id: "milestones", label: "Drafts to review" },
    // SURVEY-1 — ask donors and volunteers; "Send this survey" fills Drafts to review.
    { id: "surveys",    label: "Surveys" },
  ];

  // ── Analytics ───────────────────────────────────────────────────────────────
  // FIX-6 item 5 — OVER EMAIL CAMPAIGNS ONLY. `campaigns` holds fundraising
  // goals too (shared/campaignKind.js says why), and counting them here is
  // what made every figure on this screen empty: Harborlight's two rows are
  // the Annual Fund and the gala, which are goals, so nothing was ever `sent`
  // and the whole screen read as broken rather than as empty.
  const cstats = campaignStats(campaigns);
  const emailCampaigns = cstats.emails;
  // FIX-39 — what the table shows, and the server's counts for each row.
  const shownCampaigns = filterCampaigns(emailCampaigns, campFilter);
  const sentById = Object.fromEntries(sentRows.map(r => [r.id, r]));
  const sentCampaigns = cstats.totalSentRows;
  const allTimeSent   = cstats.totalSent;
  const allTimeOpen   = sentCampaigns.reduce((s, c) => s + (c.open_count || 0), 0);
  const overallRate   = allTimeSent > 0 ? Math.round(allTimeOpen / allTimeSent * 100) : 0;
  const bestCampaign  = topByOpen[0] || null;

  // ── Main layout ─────────────────────────────────────────────────────────────
  return (
    <div className="comm-layout" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* Section nav — horizontal tabs across the top of the content area */}
      <SectionTabs className="comm-tabbar"
        tabs={NAV.map(n => ({ ...n, badge: n.id === "campaigns" && emailCampaigns.length > 0 ? emailCampaigns.length : undefined }))}
        active={nav} onSelect={setNav} />

      {/* Main content */}
      <div className="comm-main" style={{ flex: 1, minHeight: 0 }}>
        {/* FIX-40 · a campaign's own page: the email as sent and who it went to. */}
        {asSent && <EmailAsSentPanel path={asSent} onClose={() => setAsSent(null)} />}

        {/* CAN-SPAM postal-address prompt — terracotta = needs-attention */}
        {orgPostalAddress === null && (
          <div style={{ background: T.white, border: "1px solid " + T.bg3, borderLeft: "3px solid " + T.terracotta, borderRadius: 12, padding: "12px 16px", marginBottom: 18, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 320px", fontSize: 13, color: T.ink2, lineHeight: 1.45 }}>
              <span style={{ fontWeight: 800, color: T.ink }}>Add your mailing address. </span>
              Commercial email is required to include your organization's postal address (CAN-SPAM). Set it once under Settings → Tax Receipts and it appears in every campaign and sequence footer automatically{isAdmin ? "" : " ask an admin to add it"}.
            </div>
            {isAdmin && onNavigate && (
              <button onClick={() => onNavigate("settings", { section: "receipts" })} style={{ background: "transparent", border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 700, color: T.ink, cursor: "pointer", whiteSpace: "nowrap" }}>
                Open Settings →
              </button>
            )}
          </div>
        )}

        {/* ── HUB ──────────────────────────────────────────────────────────
            BUILD-97. The screen that makes Communications its own place
            rather than a folder of four lists.

            The right rail is the point. Allie's volunteers, staff and board
            live on the SAME table as her donors, which is correct and is also
            completely invisible — so every audience says, in words, which
            screen its people are on and links straight to them. "Where are my
            volunteers kept?" should never be a question this product makes
            somebody ask. */}
        {nav === "hub" && (
          <div className="comm-hub" style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>

            {/* ── main column ── */}
            <div style={{ flex: "1 1 520px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: T.ink, fontFamily: "'DM Serif Display',Georgia,serif" }}>
                  Communications
                </h2>
                <div style={{ fontSize: 14, color: T.ink2, marginTop: 6, lineHeight: 1.5, maxWidth: "52ch" }}>
                  {hub === null && !hubErr ? "Counting who you can reach…"
                    : hubErr ? "Could not load who you can reach, " + hubErr
                    : hub.reach === 0
                      ? "Nobody on file has an email address yet. Add one to a person and they become reachable here."
                      : <>You can reach <strong style={{ color: T.ink }}>{hub.reach.toLocaleString()}</strong>{" "}
                         {hub.reach === 1 ? "person" : "people"} across{" "}
                         <strong style={{ color: T.ink }}>{hub.audiences.length}</strong>{" "}
                         {hub.audiences.length === 1 ? "audience" : "audiences"}.</>}
                </div>
                {/* MAIL-1: one sentence from the mail policy. Before the donor file
                    is in, "Email turns on once your donor file is in."; once it
                    sends, the From address. Never a raw flag. */}
                {hub?.mail?.sentence && (
                  <div data-testid="comm-mail-state" style={{ fontSize: 13, color: T.ink3, marginTop: 6, lineHeight: 1.5, maxWidth: "60ch" }}>
                    {hub.mail.sentence}
                  </div>
                )}
              </div>

              {/* the three numbers that describe sending, not people */}
              {hub && (
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {/* FIX-40 · each opens: every email sent, the sent
                      campaigns, the sequences. */}
                  {[
                    { label: "Emails sent", id: "sent", value: (hub.stats.totalSent || 0).toLocaleString(), source: { key: "emails-sent", params: {} }, n: hub.stats.totalSent || 0 },
                    { label: "Open rate", id: "rate", value: hub.stats.openRate === null ? "Not sent yet" : hub.stats.openRate + "%", go: () => { setCampFilter("sent"); setNav("campaigns"); } },
                    { label: "Sequences running", id: "sequences", value: hub.stats.activeSequences, go: () => setNav("sequences") },
                  ].map(({ label, id, value, source, n, go }) => {
                    const inner = (
                      <>
                        <span style={{ display: "block", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: T.ink3 }}>{label}</span>
                        <span style={{ display: "block", fontSize: 22, fontWeight: 800, color: T.ink, fontFamily: "'DM Serif Display',Georgia,serif", marginTop: 3 }}>{value}</span>
                      </>
                    );
                    const box = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 12, padding: "12px 16px", minWidth: 132, textAlign: "left" };
                    return source
                      ? <OpenRows key={label} testid={"hub-stat-" + id} source={source} title={label} value={n} style={box}>{inner}</OpenRows>
                      : <button key={label} type="button" data-testid={"hub-stat-" + id} onClick={go} style={{ ...box, font: "inherit", cursor: "pointer" }}>{inner}</button>;
                  })}
                </div>
              )}

              {/* what she actually sent */}
              <div style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 14, overflow: "hidden" }}>
                <div style={{ padding: "14px 18px", borderBottom: "1px solid " + T.bg3, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <span style={{ fontSize: 15, fontWeight: 800, color: T.ink, fontFamily: "'DM Serif Display',Georgia,serif" }}>Recent sends</span>
                  <button onClick={() => { setNav("campaigns"); openBuilder(); }} disabled={isReadOnly}
                    title={isReadOnly ? "Reactivate your subscription to make changes." : undefined}
                    style={{ ...S.btn("primary"), background: T.gold500, cursor: isReadOnly ? "not-allowed" : "pointer", opacity: isReadOnly ? 0.45 : 1 }}>
                    + New campaign
                  </button>
                </div>
                {!hub ? (
                  <div style={{ padding: 22 }}><Spin /></div>
                ) : hub.campaigns.length === 0 ? (
                  <div style={{ padding: "20px 18px", fontSize: 13.5, color: T.ink2, lineHeight: 1.55, maxWidth: "58ch" }}>
                    Nothing has gone out yet. A plain thank-you to everyone who gave this year is the
                    highest-return email in fundraising, three warm sentences, and Steward handles the
                    footer, the suppressions and who opened it.
                  </div>
                ) : (
                  <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                    {hub.campaigns.map((c, i) => {
                      const rate = c.recipient_count > 0 ? Math.round((c.open_count || 0) / c.recipient_count * 100) : null;
                      return (
                        <li key={c.id} data-testid="hub-recent" {...interactive(() => c.status === "sent" ? setAsSent(`/campaigns/${c.id}/as-sent`) : setNav("campaigns"), { label: `Open ${c.name}` })}
                          style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", cursor: "pointer",
                                                borderBottom: i < hub.campaigns.length - 1 ? "1px solid " + T.bg2 : "none" }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13.5, fontWeight: 700, color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
                            <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 2 }}>
                              {c.status === "sent"
                                ? `Sent to ${(c.recipient_count || 0).toLocaleString()}`
                                : c.status === "sending" ? "Sending…" : statusWord(c.status)}
                            </div>
                          </div>
                          {c.status === "sent" && rate !== null && (
                            <div style={{ textAlign: "right", flexShrink: 0 }}>
                              <div style={{ fontSize: 15, fontWeight: 800, color: T.ink, fontFamily: "'DM Serif Display',Georgia,serif" }}>{rate}%</div>
                              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: T.ink3 }}>opened</div>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>

            {/* ── RIGHT RAIL: the audiences, and where their people live ── */}
            <aside className="comm-hub-rail" style={{ flex: "0 0 320px", width: 320, display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 14, overflow: "hidden" }}>
                <div style={{ padding: "13px 16px", borderBottom: "1px solid " + T.bg3 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 800, color: T.ink, fontFamily: "'DM Serif Display',Georgia,serif" }}>Audiences</div>
                  <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 3, lineHeight: 1.45 }}>
                    Everyone lives on one list of people. An audience is a way of looking at it.
                  </div>
                </div>
                {!hub ? <div style={{ padding: 18 }}><Spin /></div> : (
                  <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                    {hub.audiences.map((a, i) => (
                      <li key={a.id} style={{ padding: "12px 16px", borderBottom: i < hub.audiences.length - 1 ? "1px solid " + T.bg2 : "none" }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                          <span aria-hidden style={{ width: 7, height: 7, borderRadius: 99, flexShrink: 0,
                            background: T[a.tone] || T.greenMid, transform: "translateY(-1px)" }} />
                          <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: T.ink }}>{a.name}</span>
                          <span data-testid="hub-audience-count" style={{ fontSize: 14, fontWeight: 800, color: T.ink, fontFamily: "'DM Serif Display',Georgia,serif" }}>
                            {/* FIX-40 · a group's count opens its members; the
                                others open the screen their people live on,
                                the same place the link under them goes. */}
                            {a.kind === "group"
                              ? <Figure variant="cell" value={a.count} label={a.name} source={{ key: "group-members", params: { group: a.id } }} />
                              : onNavigate
                                ? <button type="button" onClick={() => onNavigate(a.livesOn.tab, a.livesOn.filter ? { personType: a.livesOn.filter } : {})}
                                    aria-label={`${a.name}: ${a.count}. Opens ${a.livesOn.label}.`} className="figure-inline"
                                    style={{ background: "none", border: "none", padding: 0, font: "inherit", color: "inherit", cursor: "pointer" }}>{a.count.toLocaleString()}</button>
                                : a.count.toLocaleString()}
                          </span>
                        </div>
                        <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 4, lineHeight: 1.45, paddingLeft: 15 }}>
                          {a.description}
                        </div>
                        {/* WHERE THEY LIVE — the sentence this rail exists for,
                            and it is shown at a count of ZERO too. An empty
                            audience is exactly when somebody needs telling
                            where those people would be kept; hiding the link
                            there answers the question only for people who
                            already knew the answer. */}
                        {onNavigate && (
                          <button onClick={() => onNavigate(a.livesOn.tab, a.livesOn.filter ? { personType: a.livesOn.filter } : {})}
                            style={{ marginTop: 6, marginLeft: 15, background: "transparent", border: "none", padding: 0,
                                     fontSize: 11.5, fontWeight: 700, color: a.count > 0 ? T.greenMid : T.ink3,
                                     cursor: "pointer", textAlign: "left" }}>
                            {a.count > 0 ? `${a.livesOn.label} →` : `None yet, ${a.livesOn.label} →`}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <div style={{ padding: "11px 16px", borderTop: "1px solid " + T.bg3, background: T.bg2 }}>
                  <button onClick={() => setNav("audience")}
                    style={{ background: "transparent", border: "none", padding: 0, fontSize: 12, fontWeight: 700, color: T.ink2, cursor: "pointer" }}>
                    Build a new audience →
                  </button>
                </div>
              </div>

              {/* sequences, because a running sequence is mail she is sending
                  right now and belongs beside the audiences it draws from */}
              {hub && hub.sequences.length > 0 && (
                <div style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 14, overflow: "hidden" }}>
                  <div style={{ padding: "13px 16px", borderBottom: "1px solid " + T.bg3, fontSize: 14.5, fontWeight: 800, color: T.ink, fontFamily: "'DM Serif Display',Georgia,serif" }}>
                    Sequences
                  </div>
                  <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                    {hub.sequences.map((q, i) => (
                      <li key={q.id} style={{ padding: "11px 16px", display: "flex", alignItems: "center", gap: 10,
                                              borderBottom: i < hub.sequences.length - 1 ? "1px solid " + T.bg2 : "none" }}>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 700, color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{q.name}</span>
                        <span style={{ fontSize: 11, color: q.status === "active" ? T.greenMid : T.ink3, fontWeight: 700, flexShrink: 0 }}>
                          {q.status === "active" ? (hubSeqGate && !hubSeqGate.canRun ? PAUSED_FOR_TZ : `${q.active} enrolled`) : "Off"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </aside>
          </div>
        )}

        {/* ── CAMPAIGNS ────────────────────────────────────────────────────── */}
        {nav === "campaigns" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {/* Header row */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: T.ink }}>Campaigns</h2>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {/* FIX-27 Part 9b: Write stays. It lived only on the first-run
                  card, which goes the moment one campaign exists, so the
                  button showed once and vanished. It opens the thank-you,
                  already written, every time. */}
              {!isReadOnly && <button data-testid="comms-write" onClick={() => { const tpl = templates.find(x => x.key === "thank_you"); if (tpl) openTemplate(tpl); else openBuilder(); }}
                style={{ ...S.btn("ghost") }}>Write a thank-you</button>}
              <button onClick={() => openBuilder()}
                onMouseEnter={() => setNewBtnHover(true)}
                onMouseLeave={() => setNewBtnHover(false)}
                disabled={isReadOnly}
                title={isReadOnly?"Reactivate your subscription to make changes.":undefined}
                style={{ ...S.btn("primary"), background: newBtnHover && !isReadOnly ? T.gold600 : T.gold500, cursor: isReadOnly?"not-allowed":"pointer", opacity: isReadOnly?0.45:1 }}>
                + New Campaign
              </button>
              </div>
            </div>

            {/* Stat pills — FIX-6 item 5: real values, and each one opens its rows. */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {[
                { key: "sent", label: "Total Sent", value: cstats.totalSentWord, rows: cstats.totalSentRows, sentence: cstats.totalSentSentence },
                { key: "open", label: "Avg Open Rate", value: cstats.openRateWord, rows: cstats.openRateRows, sentence: cstats.openRateSentence },
                { key: "active", label: "Active", value: cstats.activeWord, rows: cstats.activeRows, sentence: cstats.activeSentence },
              ].map(({ key, label, value, rows, sentence }) => (
                <button key={label} data-testid={"camp-stat-" + key} title={sentence}
                  onClick={() => setStatRows({ label, value, rows, sentence })}
                  style={{ background: T.bg2, border: "1px solid " + T.bg3, borderRadius: 99, padding: "7px 16px",
                           display: "flex", gap: 8, alignItems: "center", cursor: "pointer", fontFamily: "inherit" }}>
                  <span style={{ fontSize: 11, color: T.ink3 }}>{label}</span>
                  <span style={{ fontSize: 14, fontWeight: 800, color: T.ink }}>{value}</span>
                </button>
              ))}
            </div>

            {/* ── FIX-6 item 5 · EVERY FIGURE OPENS ITS ROWS ────────────
                The count and the list behind it come from ONE computation
                (shared/campaignKind.js), so a number cannot stop matching the
                campaigns it claims to be about. */}
            {statRows && (
              <Modal onClose={() => setStatRows(null)} title={`${statRows.label} · ${statRows.value}`} width={620}>
                <p data-testid="camp-stat-sentence" style={{ fontSize: 13, color: T.ink3, lineHeight: 1.6, marginTop: 0 }}>{statRows.sentence}</p>
                <div style={{ maxHeight: 340, overflowY: "auto" }}>
                  {statRows.rows.map(c => (
                    <div key={c.id} data-testid="camp-stat-row" style={{ padding: "9px 0", borderBottom: "1px solid " + T.bg3 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: T.ink }}>{c.name}</div>
                      <div style={{ fontSize: 12, color: T.ink3, marginTop: 2 }}>
                        {sentWord(c)}{Number(c.recipient_count) > 0 ? ` · ${openRateWord(c)} opened` : ""}
                        {c.sent_at ? ` · ${displayDate(new Date(c.sent_at))}` : c.scheduled_at ? ` · scheduled ${displayDateTime(new Date(c.scheduled_at))}` : ""}
                      </div>
                    </div>
                  ))}
                  {!statRows.rows.length && (
                    <div data-testid="camp-stat-empty" style={{ fontSize: 13, color: T.ink3, lineHeight: 1.6 }}>
                      No campaign yet. This number is zero because nothing has happened, not because something is missing.
                    </div>
                  )}
                </div>
              </Modal>
            )}

            {/* Send result toast */}
            {sendResult && (
              <div style={{ background: T.green100, border: "1px solid " + T.green200, borderRadius: 10, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: T.ink, fontWeight: 700, fontSize: 14 }}>
                  {sendResult.queued
                    ? `✓ Queued, sending to ${sendResult.recipientCount} recipient${sendResult.recipientCount === 1 ? "" : "s"}`
                    : `✓ Sent to ${sendResult.sent} donors`}
                </span>
                <button onClick={() => setSendResult(null)} style={{ background: "transparent", border: "none", color: T.greenDk, cursor: "pointer", fontSize: 20 }}>×</button>
              </div>
            )}

            {/* ── FIX-39 · ONE TABLE ───────────────────────────────────────
                There used to be two: a "Sent" table (which also listed a
                campaign waiting for approval) above this one, with the same
                rows twice. One table now, under four filters, and the tab's
                count is the number of rows under "All". The Sent and Opened
                counts are the server's (/campaigns/sent), COUNTS ONLY:
                nothing per person, anywhere. */}
            {loading ? (
              <div style={{ color: T.ink3, fontSize: 13, padding: "40px 0", textAlign: "center" }}>Loading…</div>
            ) : emailCampaigns.length === 0 ? (
              /* First-run signpost (BUILD-08 Phase D) — the gold "start
                 here" pattern from shared.jsx, not a bare "no data" box. */
              <StartHere
                line="Your first campaign doesn't need to be clever, a plain thank-you to everyone who gave this year is the highest-return email in fundraising. Three warm sentences; Steward handles the sending, the footer, and who opened it."
                actionLabel={isReadOnly?undefined:"Write that thank-you →"} onAction={()=>openBuilder()}/>
            ) : (
              <div data-testid="campaigns-table" style={{ border: "1px solid " + T.bg3, borderRadius: 12, background: T.white }}>
                <style>{`
                  .fx39-row { display: grid; grid-template-columns: minmax(0,2fr) minmax(0,1.2fr) 150px 80px 90px 150px 210px; gap: 10px; align-items: center; padding: 12px 16px; }
                  .fx39-head { font-size: 11px; font-weight: 700; color: ${T.ink3}; letter-spacing: 0.04em; padding-top: 10px; padding-bottom: 10px; }
                  .fx39-cell { min-width: 0; font-size: 13px; color: ${T.ink2}; }
                  .fx39-cell[data-label]::before { content: none; }
                  @media (max-width: 900px) {
                    .fx39-head { display: none; }
                    .fx39-row { grid-template-columns: 1fr 1fr; row-gap: 8px; }
                    .fx39-row > .fx39-name, .fx39-row > .fx39-actions { grid-column: 1 / -1; }
                    .fx39-cell[data-label]::before { content: attr(data-label); display: block; font-size: 11px; font-weight: 700; color: ${T.ink3}; margin-bottom: 2px; }
                  }
                `}</style>
                <div role="tablist" aria-label="Show campaigns" style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "10px 16px", borderBottom: "1px solid " + T.bg2 }}>
                  {CAMPAIGN_FILTERS.map(f => {
                    const n = filterCampaigns(emailCampaigns, f.id).length;
                    const on = campFilter === f.id;
                    return (
                      <button key={f.id} type="button" role="tab" aria-selected={on} data-testid={"camp-filter-" + f.id}
                        onClick={() => setCampFilter(f.id)}
                        style={{ fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, cursor: "pointer", borderRadius: 99, padding: "5px 12px",
                                 border: "1px solid " + (on ? T.ink : T.bg3), background: on ? T.ink : T.white, color: on ? T.white : T.ink2 }}>
                        {f.label} {n}
                      </button>
                    );
                  })}
                </div>
                <div className="fx39-row fx39-head" aria-hidden="true">
                  <span>Campaign</span><span>Who it goes to</span><span>Status</span><span>Sent</span><span>Opened</span><span>Date</span><span></span>
                </div>
                {shownCampaigns.length === 0 && (
                  <div data-testid="camp-filter-empty" style={{ padding: "14px 16px", fontSize: 13, color: T.ink3, borderTop: "1px solid " + T.bg2 }}>
                    No campaign here yet.
                  </div>
                )}
                {shownCampaigns.map(c => {
                  const raw = typeof c.segment === "string" ? JSON.parse(c.segment || "{}") : (c.segment || {});
                  const recs = c.recipients || [];
                  const sr = sentById[c.id] || null;
                  const sentCt = sr ? sr.delivered : (c.recipient_count || recs.filter(r => r.sent_at).length || 0);
                  const openCt = sr ? sr.opened : (c.open_count || recs.filter(r => r.opened_at).length || 0);
                  const openRate = sentCt > 0 ? Math.round(openCt / sentCt * 100) : 0;
                  const gone = ["sent", "sending", "failed"].includes(c.status) || !!c.sent_at;
                  const isOpen = expandedId === c.id;
                  return (
                    <div key={c.id} data-testid="camp-row" data-status={c.status} style={{ borderTop: "1px solid " + T.bg2 }}>
                      <div {...interactive(() => setExpandedId(isOpen ? null : c.id), { row: true, className: "fx39-row", href: tabHref("communications", { subtab: "campaigns", campaignId: c.id }) })} aria-expanded={isOpen}>
                        <div className="fx39-cell fx39-name">
                          <RecordLink to={tabHref("communications", { subtab: "campaigns", campaignId: c.id })} data-record-link="email-campaign"
                            onOpen={() => setExpandedId(isOpen ? null : c.id)}
                            style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: T.ink }}>{c.name}</RecordLink>
                          <div data-testid="camp-subject" style={{ fontSize: 12, color: T.ink3, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {c.subject ? subjectPreview(c.subject) : "No subject yet"}
                          </div>
                        </div>
                        <div className="fx39-cell" data-label="Who it goes to" style={{ fontSize: 12.5 }}>{segLabel(raw)}</div>
                        <div className="fx39-cell" data-label="Status">
                          <StatusBadge status={c.status} campaign={c} onFailed={() => { setExpandedId(c.id); setFailedOnly(c.id); }} />
                        </div>
                        <div className="fx39-cell" data-label="Sent" data-testid="camp-row-sent" style={{ color: sentCt > 0 ? T.ink : T.ink3 }}>
                          {gone && sentCt > 0
                            ? <OpenRows testid="camp-sent-open" source={{ key: "emails-sent", params: { campaign: c.id } }} title={`Emails ${c.name} sent`} value={sentCt}>{sentCt.toLocaleString("en-US")}</OpenRows>
                            : gone ? "0" : "Not yet"}
                        </div>
                        <div className="fx39-cell" data-label="Opened" data-testid="camp-row-rate" style={{ color: sentCt > 0 ? T.ink : T.ink3 }}>
                          {gone && sentCt > 0
                            ? <button type="button" data-testid="camp-rate-open" onClick={() => setAsSent(`/campaigns/${c.id}/as-sent`)} className="figure-inline"
                                aria-label={`${c.name}: ${openRate}% opened. Opens the campaign.`}
                                style={{ background: "none", border: "none", padding: 0, font: "inherit", color: "inherit", cursor: "pointer" }}>{`${openCt.toLocaleString("en-US")} (${openRate}%)`}</button>
                            : "Not yet"}
                        </div>
                        <div className="fx39-cell" data-label="Date" data-testid="camp-row-date" style={{ fontSize: 12.5 }}>
                          {c.sent_at ? displayDate(new Date(c.sent_at))
                            : c.scheduled_at ? <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                                <CalendarDays size={14} strokeWidth={1.75} aria-label="Scheduled for" />{displayDateTime(new Date(c.scheduled_at))}</span>
                            : "Not set"}
                        </div>
                        <div className="fx39-cell fx39-actions" style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap", position: "relative" }}>
                          {gone
                            ? <button type="button" data-testid="camp-view" onClick={() => openBuilder(c)} style={{ ...S.btn("ghost"), padding: "5px 10px", fontSize: 12.5 }}>View</button>
                            : <button type="button" data-testid="edit-in-editor" disabled={isReadOnly} onClick={() => openBuilder(c)} style={{ ...S.btn("ghost"), padding: "5px 10px", fontSize: 12.5 }}>Edit in editor</button>}
                          <button type="button" data-testid="camp-more" aria-haspopup="menu" aria-expanded={moreFor === c.id}
                            onClick={() => setMoreFor(moreFor === c.id ? null : c.id)}
                            style={{ ...S.btn("ghost"), padding: "5px 10px", fontSize: 12.5 }}>More</button>
                          {moreFor === c.id && (
                            <div role="menu" data-testid="camp-more-menu"
                              style={{ position: "absolute", right: 0, top: "100%", marginTop: 4, zIndex: 20, background: T.white, border: "1px solid " + T.bg3, borderRadius: 10, boxShadow: "0 8px 24px rgba(15,26,18,0.12)", padding: 4, minWidth: 150, display: "flex", flexDirection: "column" }}>
                              <button type="button" role="menuitem" disabled={isReadOnly} onClick={() => { setMoreFor(null); duplicateCampaign(c); }} style={menuItem}>Duplicate</button>
                              {isAdmin && c.status !== "sending" && (
                                <button type="button" role="menuitem" data-testid="camp-delete" onClick={() => { setMoreFor(null); deleteCampaign(c); }} style={menuItem}>Delete</button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Expanded row: briefing + recipient table */}
                      {isOpen && (
                        <div style={{ borderTop: "1px solid " + T.bg3 }}>
                          <CampaignBriefing campaign={c} />
                        <div style={{ background: T.bg, padding: "14px 16px" }}>
                          {/* Stats */}
                          {c.status === "sent" && sentCt > 0 && (
                            <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
                              {[["Sent", sentCt, T.ink], ["Opened", openCt, T.greenMid], ["Open rate", openRate + "%", openRate >= 25 ? T.greenMid : T.gold600], ["Unsubscribed", sr ? sr.unsubscribed : 0, T.ink], ["Failed", sr ? sr.failed : recs.filter(r => r.failure_reason).length, T.ink]].map(([lbl, val, col]) => (
                                <div key={lbl} style={{ background: T.bg2, borderRadius: 8, padding: "10px 14px", flex: 1 }}>
                                  <div style={{ fontSize: 10, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.06em" }}>{lbl}</div>
                                  <div style={{ fontSize: 20, fontWeight: 800, color: col, marginTop: 2 }}>{val}</div>
                                </div>
                              ))}
                            </div>
                          )}
                          {/* Draft/scheduled/sent actions */}
                          <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                            {c.status !== "sent" && c.status !== "failed" && c.status !== "sending" && <button type="button" data-testid="edit-in-editor" onClick={() => openBuilder(c)} style={S.btn("subtle")}>Edit in editor</button>}
                            {c.status === "awaiting_approval" && (isAdmin
                              ? <button onClick={() => approveCampaign(c)} data-testid="campaign-approve" style={S.btn("send")}>Approve</button>
                              : <span style={{ fontSize: 12.5, color: T.ink2, alignSelf: "center" }}>Waiting for an admin to approve it.</span>)}
                            {c.approved_by_name && c.status !== "awaiting_approval" && (
                              <span style={{ fontSize: 12.5, color: T.ink3, alignSelf: "center" }}>Approved by {c.approved_by_name}</span>
                            )}
                            {isAdmin && c.status !== "sending" && c.status !== "sent" && c.status !== "failed" && c.status !== "awaiting_approval" && (
                              <button onClick={() => sendNow(c.id)} disabled={sending}
                                style={{ ...S.btn("primary"), opacity: sending ? 0.6 : 1 }}>
                                {sending ? <><Spin /> Sending…</> : "↑ Send Now"}
                              </button>
                            )}
                            <CampaignLinkBtn campaignId={c.id} campaignName={c.name} />
                          </div>
                          {/* Recipient list */}
                          {recs.some(r => r.failure_reason) && (
                            <div style={{ fontSize: 12, marginBottom: 8 }}>
                              <button type="button" data-testid="camp-failed-toggle" onClick={() => setFailedOnly(failedOnly === c.id ? null : c.id)}
                                style={{ background: "none", border: "none", padding: 0, color: T.greenDk, fontWeight: 700, cursor: "pointer", textDecoration: "underline", fontFamily: "inherit", fontSize: 12 }}>
                                {failedOnly === c.id ? "Show everyone" : `Show the ${recs.filter(r => r.failure_reason).length} that did not go`}
                              </button>
                            </div>
                          )}
                          {recs.length > 0 && (
                            <div style={{ border: "1px solid " + T.bg3, borderRadius: 8, overflow: "hidden" }}>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 80px", padding: "7px 12px", background: T.bg2, fontSize: 10, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.06em", gap: 8 }}>
                                <span>Recipient</span><span>Status</span><span>Time</span>
                              </div>
                              {(failedOnly === c.id ? recs.filter(r => r.failure_reason) : recs.slice(0, 30)).map(r => (
                                <div key={r.id} style={{ display: "grid", gridTemplateColumns: "1fr 80px 80px", padding: "8px 12px", borderTop: "1px solid " + T.bg2, fontSize: 12, gap: 8, alignItems: "center" }}>
                                  {r.donor_id
                                    ? <DonorLink id={r.donor_id} style={{ color: T.ink, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.donor_name || r.email}</DonorLink>
                                    : <span style={{ color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.donor_name || r.email}</span>}
                                  <span style={{ color: r.opened_at ? T.greenMid : r.failure_reason ? T.terracotta : r.sent_at ? T.ink3 : T.gold600 }}
                                    title={r.failure_reason || undefined}>
                                    {r.opened_at ? "Opened" : r.failure_reason ? "Failed" : r.sent_at ? "Delivered" : "Pending"}
                                  </span>
                                  {failedOnly === c.id && r.failure_reason && <span data-testid="camp-failed-reason" style={{ gridColumn: "1 / -1", color: T.ink3, fontSize: 11.5 }}>{r.failure_reason}</span>}
                                  <span style={{ color: T.ink3, fontSize: 11 }}>
                                    {(r.opened_at || r.sent_at) ? new Date(r.opened_at || r.sent_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Not set"}
                                  </span>
                                </div>
                              ))}
                              {failedOnly !== c.id && recs.length > 30 && <div style={{ padding: "8px 12px", fontSize: 11, color: T.ink3, borderTop: "1px solid " + T.bg2 }}>+{recs.length - 30} more</div>}
                            </div>
                          )}
                        </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                <div style={{ padding: "8px 16px", borderTop: "1px solid " + T.bg2, fontSize: 11.5, color: T.ink3, lineHeight: 1.5 }}>
                  Opens are counted per campaign. Steward never shows who opened what.
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── TEMPLATES ─────────────────────────────────────────────────────
            WIRE-1-ADDENDUM: one tab. Letters and thank-yous, the campaign
            starters New Campaign opens on and the designed emails, in four
            sections (EmailTemplates.jsx says the rule). */}
        {nav === "templates" && (
          <EmailTemplates isReadOnly={isReadOnly} key={tplOpen ? "open-" + tplOpen.id : "library"}
            openTemplateId={tplOpen ? tplOpen.id : null} openTitle={tplOpen ? tplOpen.title : null} openBackLabel={tplOpen ? tplOpen.backLabel : null} onBackFromOpen={tplOpen ? () => { const b = tplOpen.back; setTplOpen(null); b(); } : null}
            campaignStarters={templates} previewSubject={s => renderPreview(s)}
            onOpenCampaigns={() => setNav("campaigns")} onOpenDrafts={() => setNav("milestones")} />
        )}

        {/* ── AUDIENCE ──────────────────────────────────────────────────────── */}
        {nav === "audience" && <AudienceTab onEmailSegment={() => { setNav("campaigns"); openBuilder(); }} />}

        {/* ── ANALYTICS ─────────────────────────────────────────────────────── */}
        {nav === "analytics" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: T.ink }}>Analytics</h2>

            {/* FIX-40 · every number opens. Total emails sent opens every email
                sent (figure source emails-sent); the open rate and Campaigns
                sent open the sent campaigns. The "Industry avg ~20%" line had
                no source and is gone, with nothing in its place. */}
            <div className="comm-stats" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
              <Figure label="Total emails sent" value={allTimeSent} figureKey="comms-total-sent"
                source={{ key: "emails-sent", params: {} }} />
              <div className="fig-tile" style={{ background: T.bgCard, border: "1px solid " + T.bg2, borderRadius: 12 }}>
                <button type="button" data-testid="analytics-open-rate" onClick={() => { setCampFilter("sent"); setNav("campaigns"); }}
                  aria-label="Overall open rate. Opens the sent campaigns, each with its own rate."
                  style={{ textAlign: "left", background: "transparent", border: "none", width: "100%", padding: "16px 18px 12px", cursor: "pointer", display: "flex", flexDirection: "column", gap: 6, font: "inherit", color: T.ink }}>
                  <span style={{ fontSize: 11, letterSpacing: "0.07em", textTransform: "uppercase", color: T.ink3, fontWeight: 700 }}>Overall open rate</span>
                  <span style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 30, lineHeight: 1.1 }}>{allTimeSent > 0 ? overallRate + "%" : "Not sent yet"}</span>
                </button>
              </div>
              <div className="fig-tile" style={{ background: T.bgCard, border: "1px solid " + T.bg2, borderRadius: 12 }}>
                <button type="button" data-testid="analytics-campaigns-sent" onClick={() => { setCampFilter("sent"); setNav("campaigns"); }}
                  aria-label="Campaigns sent. Opens those campaigns."
                  style={{ textAlign: "left", background: "transparent", border: "none", width: "100%", padding: "16px 18px 12px", cursor: "pointer", display: "flex", flexDirection: "column", gap: 6, font: "inherit", color: T.ink }}>
                  <span style={{ fontSize: 11, letterSpacing: "0.07em", textTransform: "uppercase", color: T.ink3, fontWeight: 700 }}>Campaigns sent</span>
                  <span style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 30, lineHeight: 1.1 }}>{sentCampaigns.length.toLocaleString("en-US")}</span>
                </button>
              </div>
            </div>

            {bestCampaign && (
              <button type="button" data-testid="analytics-best" onClick={() => setAsSent(`/campaigns/${bestCampaign.id}/as-sent`)}
                style={{ textAlign: "left", font: "inherit", cursor: "pointer", background: T.white, border: "1px solid " + T.bg3, borderRadius: 12, padding: 16 }}>
                <div style={{ fontSize: 11, color: T.ink3, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>Best campaign</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.ink, marginTop: 2, textDecoration: "underline" }}>{bestCampaign.name}</div>
                <div style={{ fontSize: 12, color: T.ink3 }}>{bestCampaign.rate}% open rate, {Number(bestCampaign.recipient_count).toLocaleString("en-US")} sent</div>
              </button>
            )}

            {sentCampaigns.length > 0 && (
              <div style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 12, padding: 18 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, marginBottom: 14 }}>Sends per month, last 12 months</div>
                <SendsPerMonth campaigns={sentCampaigns} />
              </div>
            )}

            {topByOpen.length > 0 && (
              <div style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 12, overflow: "hidden" }}>
                <div style={{ padding: "12px 16px", borderBottom: "1px solid " + T.bg3, fontSize: 13, fontWeight: 700, color: T.ink }}>Top campaigns by open rate</div>
                {topByOpen.map((c, i) => (
                  <button key={c.id} type="button" data-testid="analytics-top-row" onClick={() => setAsSent(`/campaigns/${c.id}/as-sent`)}
                    style={{ display: "flex", width: "100%", alignItems: "center", padding: "11px 16px", border: "none", borderTop: i > 0 ? "1px solid " + T.bg3 : "none", gap: 12, background: "none", font: "inherit", cursor: "pointer", textAlign: "left" }}>
                    <span style={{ fontSize: 11, color: T.ink3, width: 16, textAlign: "right" }}>{i + 1}</span>
                    <span style={{ flex: 1 }}>
                      <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: T.ink, textDecoration: "underline" }}>{c.name}</span>
                      <span style={{ display: "block", fontSize: 11.5, color: T.ink3 }}>{Number(c.recipient_count).toLocaleString("en-US")} sent, {displayDate(new Date(c.sent_at))}</span>
                    </span>
                    <span style={{ fontSize: 16, fontWeight: 800, color: T.ink }}>{c.rate}%</span>
                  </button>
                ))}
              </div>
            )}

            {sentCampaigns.length === 0 && (
              <div style={{ background: T.white, borderRadius: 12, padding: 40, textAlign: "center", color: T.ink3, fontSize: 14 }}>
                Send your first campaign to see analytics.
              </div>
            )}
          </div>
        )}

        {/* ── SEQUENCES ─────────────────────────────────────────────────────── */}
        {nav === "sequences" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
            <TrackedSequences />
            {/* The BUILD-13 recipe engine (milestones, at-risk, lapsed) is a
                different thing wearing the same word and stays where it is. */}
            <SequencesPanel data={data} />
          </div>
        )}

        {/* ── INT-3 · WHAT THE EMAIL TOOL SENT ─────────────────────────────── */}
        {nav === "emailtool" && <EmailToolPanel onNavigate={onNavigate} />}

        {/* ── MILESTONE DRAFTS ──────────────────────────────────────────────── */}
        {nav === "milestones" && <MilestoneDraftsPanel highlightDraftId={highlightDraftId || heldDraftId} onEditTemplate={id => openTemplateEditor(id, () => setNav("milestones"))}/>}
        {nav === "surveys" && <SurveysPanel isReadOnly={isReadOnly} orgName={data?.org?.name || ""} onOpenDrafts={() => setNav("milestones")} />}
      </div>
    </div>
  );
}
