import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { apiFetch } from "../api";
import { useAuth } from "../main";
import { T, askClaude, Spin, fmtFull, SectionTabs, StartHere, interactive, PersonMark } from "./shared";
import { errorMessage } from "../lib/domainError";
// BUILD-88c C.2 — the six live in shared/emailTemplates.js, so the gallery, the
// live preview and the send all read ONE copy of the words. The server route
// adds the org's colours, logo and vocabulary on top; this import is what keeps
// the box from ever being blank if that call fails.
import { renderMergeFields, normalizeMergeFields, MERGE_FIELDS, templatesFor } from "../../../shared/emailTemplates";
import { makeT } from "../../../shared/vocabulary";

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
                <span style={{ fontSize: 12, fontWeight: 700, color: "#0d5c3a" }}>{fmtFull(raisedAmt)} raised</span>
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
    amber:   { background: T.gold600, border: "none", borderRadius: 8, padding: "9px 18px", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" },
    subtle:  { background: T.bg2, border: "1px solid " + T.bg3, borderRadius: 8, padding: "8px 14px", color: T.ink, fontSize: 13, cursor: "pointer" },
    // BUILD-88c C.2 — the one emerald action. A screen gets one of these.
    send:    { background: T.greenDk, border: "none", borderRadius: 8, padding: "9px 18px", color: T.white, fontSize: 13, fontWeight: 700, cursor: "pointer" },
  })[variant],
};

// ── Status badge ──────────────────────────────────────────────────────────────
const STATUS_META = {
  draft:     { label: "Draft",     color: T.ink3, bg: T.ink3 + "18" },
  scheduled: { label: "Scheduled", color: T.green500, bg: T.green500 + "18" },
  sending:   { label: "Sending",   color: T.gold600, bg: T.gold600 + "18" },
  sent:      { label: "Sent",      color: "#fff",    bg: T.greenMid },
};
function StatusBadge({ status }) {
  const m = STATUS_META[status] || STATUS_META.draft;
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color: m.color, background: m.bg, borderRadius: 99, padding: "3px 10px", letterSpacing: "0.04em" }}>
      {status === "sending" ? <span style={{ animation: "pulse 1.2s ease-in-out infinite" }}>{m.label}</span> : m.label}
    </span>
  );
}

// The hard-coded template list that used to live here is gone. The six now
// come from shared/emailTemplates.js through GET /campaigns/templates, so the
// gallery, the preview and the send read the same words. BUILD-88c C.2.

// ── Segment helpers ───────────────────────────────────────────────────────────
const STAGE_OPTS = ["prospect", "qualify", "cultivate", "solicit", "steward", "lapsed"];
const TIER_OPTS  = ["transformational", "major", "mid", "small", "micro"];
const SEG_MODES  = [
  { id: "all",     label: "All Donors" },
  { id: "major",   label: "Major >$10k" },
  { id: "lapsed",  label: "Lapsed" },
  { id: "byStage", label: "By Stage" },
  { id: "byTier",  label: "By Tier" },
  { id: "manual",  label: "Manual" },
];

function segLabel(raw) {
  const mode = raw?.mode || "all";
  return {
    all:     "All donors with email",
    major:   "Major donors (>$10k)",
    lapsed:  "Lapsed donors",
    byStage: `Stages: ${(raw?.stages || []).join(", ") || "none"}`,
    byTier:  `Tiers: ${(raw?.tiers || []).join(", ") || "none"}`,
    manual:  `${(raw?.donorIds || []).length} manually selected`,
  }[mode] || "All donors with email";
}

function countSegment(donors, seg) {
  const mode = seg?.mode || "all";
  const withEmail = donors.filter(d => d.email);
  if (mode === "all") return withEmail.length;
  if (mode === "major") return withEmail.filter(d => (d.total_giving || 0) >= 10000).length;
  if (mode === "lapsed") return withEmail.filter(d => d.status === "lapsed").length;
  // d.stage is the DB column (pipeline stage) — this previously read a
  // nonexistent "pipeline_stage" field, so every byStage count showed 0 while the
  // server-side send (which filters on d.stage) worked. BUILD-06 Phase C fix.
  if (mode === "byStage") return withEmail.filter(d => (seg.stages || []).includes(d.stage)).length;
  if (mode === "byTier") return withEmail.filter(d => (seg.tiers || []).map(t => t.toLowerCase()).includes((d.capacity_tier || "").toLowerCase())).length;
  if (mode === "manual") return (seg.donorIds || []).length;
  return 0;
}

// ── SegmentPicker (module-level) ──────────────────────────────────────────────
function SegmentPicker({ seg, onChange, allDonors }) {
  const mode = seg.mode || "all";
  const upd  = p => onChange({ ...seg, ...p });
  const tog  = (key, val) => {
    const arr = seg[key] || [];
    upd({ [key]: arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val] });
  };
  const count = countSegment(allDonors, seg);

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
              background: mode === m.id ? T.green100 : T.bg2,
              border: "1px solid " + (mode === m.id ? T.greenDk : T.bg3),
              borderRadius: 99, padding: "5px 12px", fontSize: 11,
              color: mode === m.id ? T.greenDk : T.ink3, cursor: "pointer",
              fontWeight: mode === m.id ? 700 : 400,
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
              style={{ background: (seg.tiers || []).includes(t) ? T.gold600 : T.bg2, border: "none", borderRadius: 99, padding: "4px 10px", fontSize: 11, color: (seg.tiers || []).includes(t) ? "#fff" : T.ink3, cursor: "pointer" }}>
              {t}
            </button>
          ))}
        </div>
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
      {allDonors.length > 0 && (
        <div style={{ fontSize: 12, color: T.ink3 }}>
          <span style={{ color: T.green, fontWeight: 700 }}>{count}</span> recipient{count !== 1 ? "s" : ""} in this segment
        </div>
      )}
    </div>
  );
}

// ── RichEditor (module-level) ─────────────────────────────────────────────────
function RichEditor({ editorRef, initialHtml, onInput }) {
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
      <div ref={editorRef} contentEditable suppressContentEditableWarning
        data-testid="campaign-editor"
        onInput={e => onInput && onInput(e.currentTarget.innerHTML)}
        style={{ minHeight: 260, padding: "14px 16px", background: T.bg, color: T.ink, fontSize: 14, lineHeight: 1.8, outline: "none" }} />
    </div>
  );
}

// ── Mini bar chart (Analytics) ────────────────────────────────────────────────
function BarChart({ data }) {
  const max = Math.max(...data.map(d => d.v), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 80 }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <div style={{ width: "100%", height: Math.max(4, (d.v / max) * 64), background: "#0d5c3a", borderRadius: "4px 4px 0 0", opacity: 0.85 }} />
          <div style={{ fontSize: 9, color: T.ink3 }}>{d.label}</div>
        </div>
      ))}
    </div>
  );
}

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
      style={{ background: copied ? T.greenDk : T.greenDk + "14", border: "1px solid " + T.greenDk + "30", borderRadius: 8, padding: "8px 14px", color: copied ? "#fff" : T.greenDk, fontSize: 12, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 6 }}>
      {loading ? <><Spin /> Generating…</> : copied ? "✓ Link copied!" : "Copy Donation Link"}
    </button>
  );
}

// ── BLANK form ────────────────────────────────────────────────────────────────
const BLANK = { name: "", subject: "", bodyHtml: "", seg: { mode: "all" }, scheduledAt: "" };

// ── Sequence trigger labels ───────────────────────────────────────────────────
const SEQ_TRIGGERS = [
  { id: "lapsed_90",  label: "Lapsed (90 days)",       ctx: "re-engaging lapsed donors who haven't given in 90+ days" },
  { id: "lapsed_180", label: "Lapsed (180 days)",      ctx: "re-engaging long-lapsed donors who haven't given in 180+ days" },
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
        <div style={{ fontSize: 10, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Body — supports <code style={{ fontSize: 9 }}>{"{{donor_name}}"}</code> and <code style={{ fontSize: 9 }}>{"{{org_name}}"}</code></div>
        <textarea value={step.body} onChange={e => onChange({ body: e.target.value })} placeholder="Write your email body here, or click ✦ Write with AI…" rows={5} style={{ ...inp, resize: "vertical", lineHeight: 1.6 }}/>
        {preview && <div style={{ fontSize: 11, color: T.ink3, marginTop: 5, fontStyle: "italic" }}>Preview: {preview}</div>}
      </div>
    </div>
  );
}

// ── Sequences panel ───────────────────────────────────────────────────────────
function SequencesPanel({ data }) {
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
    if (!window.confirm("Delete this sequence and all enrollments?")) return;
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
    let acc = "";
    await askClaude(
      "You are an expert nonprofit fundraiser. Write warm, personal, conversational donor emails. No fluff, no corporate jargon. Max 150 words.",
      `Write a fundraising email for ${data.org.name} (mission: ${data.org.mission || "serving our community"}).\nContext: ${trig.ctx}.\nThis is step ${i + 1} of a ${form.steps.length}-step sequence.\n${step.subject ? `Subject: ${step.subject}` : "Also generate a compelling subject line — put it on the first line as 'Subject: ...' then the body."}\nUse {{donor_name}} to address them personally. Use {{org_name}} for the org name. Keep it under 150 words. Plain text only, no HTML.`,
      chunk => { acc = chunk; updateStep(i, { body: chunk }); }
    );
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
              {SEQ_TRIGGERS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
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
          No sequences yet. A good first one: three gentle emails to donors who've gone quiet for 90 days — write it once, and it looks after them from then on.
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
                        <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 99, padding: "3px 9px", background: isActive ? T.green100 : T.bg2, color: isActive ? T.greenDk : T.ink3, letterSpacing:"0.04em", textTransform:"uppercase" }}>{isActive ? "Active" : "Paused"}</span>
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
                            <span style={{ fontSize: 11, color: T.ink3 }}>{e.next_send_at ? new Date(e.next_send_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}</span>
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
function MilestoneDraftsPanel({ highlightDraftId }) {
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
      setDrafts(prev => prev.map(d => d.id === id ? { ...d, ...editForm } : d));
      setEditingId(null);
    } catch (e) { alert(errorMessage(e)); }
    setBusyId(null);
  };

  const send = async (id) => {
    if (!window.confirm("Send this email now?")) return;
    setBusyId(id);
    try {
      await apiFetch(`/milestone-drafts/${id}/send`, { method: "POST" });
      setDrafts(prev => prev.filter(d => d.id !== id));
    } catch (e) { alert(errorMessage(e)); }
    setBusyId(null);
  };

  const dismiss = async (id) => {
    if (!window.confirm("Dismiss this draft without sending?")) return;
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
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: T.ink }}>Milestone Drafts</h2>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: T.ink3 }}>
          Drafted emails for donors who just crossed a giving threshold or hit a giving anniversary. Nothing sends until you approve it here.
        </p>
      </div>

      {drafts.length === 0 && (
        <div style={{ background: T.bg2, borderRadius: 12, padding: 40, textAlign: "center", color: T.ink3, fontSize: 14 }}>
          Nothing waiting on you. When a donor crosses a milestone or a giving anniversary, the draft will be sitting right here for your eyes first — nothing ever sends itself.
        </div>
      )}

      {drafts.map(d => (
        <div key={d.id} ref={el => { rowRefs.current[d.id] = el; }} style={{ background: T.white, border: (highlightDraftId === d.id ? "2px solid " + T.gold : "1px solid " + T.bg3), boxShadow: highlightDraftId === d.id ? "0 0 0 3px " + T.gold + "22" : "none", borderRadius: 12, padding: 18, transition: "box-shadow 0.3s" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>{d.donor_name}</div>
              <div style={{ fontSize: 12, color: T.ink3 }}>{d.donor_email} · {fmtFull(d.donor_total_giving || 0)} lifetime giving</div>
            </div>
            <div style={{ fontSize: 11, color: T.ink3 }}>{new Date(d.created_at).toLocaleDateString()}</div>
          </div>

          {editingId === d.id ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <input style={inp} value={editForm.subject} onChange={e => setEditForm(f => ({ ...f, subject: e.target.value }))} placeholder="Subject" />
              <textarea style={{ ...inp, minHeight: 140, resize: "vertical" }} value={editForm.body} onChange={e => setEditForm(f => ({ ...f, body: e.target.value }))} placeholder="Body" />
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => saveEdit(d.id)} disabled={busyId === d.id} style={{ background: T.green, border: "none", borderRadius: 8, padding: "8px 14px", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Save</button>
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
                <button onClick={() => send(d.id)} disabled={busyId === d.id} style={{ background: T.green, border: "none", borderRadius: 8, padding: "8px 14px", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                  {busyId === d.id ? "Sending…" : "Approve & Send"}
                </button>
                <button onClick={() => startEdit(d)} style={{ background: "transparent", border: "1px solid " + T.bg3, borderRadius: 8, padding: "8px 14px", color: T.ink, fontSize: 12, cursor: "pointer" }}>Edit</button>
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
export function Communications({ data, isReadOnly, initialNav, onInitialNavConsumed, highlightDraftId, onNavigate }) {
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
  const [nav, setNav] = useState(initialNav || "campaigns");
  useEffect(() => { if (initialNav && onInitialNavConsumed) onInitialNavConsumed(); }, []);

  // Campaigns
  const [campaigns, setCampaigns]     = useState([]);
  const [loading, setLoading]         = useState(true);
  const [expandedId, setExpandedId]   = useState(null);
  const [sendResult, setSendResult]   = useState(null);

  // Builder
  const [view, setView]               = useState("list"); // list | builder
  const [form, setForm]               = useState(BLANK);
  const [editingId, setEditingId]     = useState(null);
  const [sending, setSending]         = useState(false);
  const [aiLoading, setAiLoading]     = useState(false);
  const [aiDraft, setAiDraft]         = useState("");
  const [linkLoading, setLinkLoading] = useState(false);
  const editorRef                     = useRef(null);
  const [editorKey, setEditorKey]     = useState(0);

  // Donors (loaded lazily)
  const [allDonors, setAllDonors]     = useState([]);

  // Audience tab segment preview
  const [audienceSeg, setAudienceSeg] = useState("all");
  const [newBtnHover, setNewBtnHover] = useState(false);
  const [hoveredRowId, setHoveredRowId] = useState(null);

  // ── BUILD-88c C.2 — never a blank box ──────────────────────────────────────
  const [gallery, setGallery]       = useState(null);  // server: the six + brand
  const [segPreview, setSegPreview] = useState(null);  // the segment, as people
  const [testState, setTestState]   = useState(null);  // send-me-a-test result
  const [liveHtml, setLiveHtml]     = useState("");    // what the editor holds, now
  const [showSchedule, setShowSchedule] = useState(false);
  const t = useMemo(() => makeT(data?.org?.vocabulary), [data?.org?.vocabulary]);
  // The server's six carry the org's real name and vocabulary. If that call
  // fails the same six are built here from the shared module — the gallery is
  // never empty, because an empty gallery is a blank box with extra steps.
  const templates = useMemo(() => (
    gallery?.templates?.length ? gallery.templates
      : templatesFor({ orgName: data?.org?.name || "your organisation", t })
  ), [gallery, data?.org?.name, t]);
  const brand = gallery?.brand || null;
  // Which sending identity is in force — hers, or Steward's with her name on
  // it. The preview says so under the email, because "who is this from" is the
  // first thing a donor decides and she should see the same answer they will.
  const [sendingIdentity, setSendingIdentity] = useState(null);
  useEffect(() => {
    apiFetch("/campaigns/templates").then(setGallery).catch(() => {});
    apiFetch("/org/sending-domain").then(setSendingIdentity).catch(() => {});
  }, []);

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

  useEffect(() => { loadCampaigns(); loadDonors(); }, []);

  // Poll while any campaign is sending
  const anySending = campaigns.some(c => c.status === "sending");
  useEffect(() => {
    if (!anySending) return;
    const tid = setInterval(() => loadCampaigns(), 5000);
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

  // ── Monthly send chart data ─────────────────────────────────────────────────
  const monthlyChart = useMemo(() => {
    const map = {};
    campaigns.filter(c => c.sent_at).forEach(c => {
      const k = new Date(c.sent_at).toLocaleString("default", { month: "short" });
      map[k] = (map[k] || 0) + (c.recipient_count || 0);
    });
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return months.filter(m => map[m] !== undefined).map(m => ({ label: m, v: map[m] || 0 })).slice(-6);
  }, [campaigns]);

  // ── Analytics (must be before any early return — Rules of Hooks) ────────────
  const topByOpen = useMemo(() => {
    return [...campaigns]
      .filter(c => c.status === "sent" && (c.recipient_count || 0) > 0)
      .map(c => ({ ...c, rate: Math.round((c.open_count || 0) / c.recipient_count * 100) }))
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 5);
  }, [campaigns]);

  // The segment, as PEOPLE, answered by the side that does the sending. The
  // client's countSegment can only count what /donors/summaries returned; the
  // send resolves its own list. Two answers to "who gets this" is one too many.
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
      seg: { mode, stages: raw.stages || [], tiers: raw.tiers || [], donorIds: raw.donorIds || [] },
      scheduledAt: campaign.scheduled_at ? new Date(campaign.scheduled_at).toISOString().slice(0, 16) : "" });
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
      seg: { mode: "all" }, scheduledAt: "" });
    setEditingId(null); setLiveHtml(body); setTestState(null); setShowSchedule(false);
    setEditorKey(k => k + 1); setAiDraft(""); setView("builder");
  };

  const duplicateCampaign = async (c) => {
    const raw = typeof c.segment === "string" ? JSON.parse(c.segment || "{}") : (c.segment || {});
    const payload = { name: "Copy of " + c.name, subject: c.subject, body: c.body, segment: raw, status: "draft" };
    try { await apiFetch("/campaigns", { method: "POST", body: JSON.stringify(payload) }); await loadCampaigns(); }
    catch (e) { alert(errorMessage(e)); }
  };

  const saveDraft = async () => {
    if (!form.name.trim()) return alert("Campaign name is required.");
    const body = editorRef.current?.innerHTML || "";
    const payload = { name: form.name, subject: form.subject, body, segment: form.seg, status: "draft" };
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
    const body = editorRef.current?.innerHTML || "";
    const payload = { name: form.name, subject: form.subject, body, segment: form.seg, status: "scheduled", scheduledAt: form.scheduledAt };
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
      const body = editorRef.current?.innerHTML || "";
      const payload = { name: form.name, subject: form.subject, body, segment: form.seg, status: "draft" };
      try {
        if (editingId) { await apiFetch(`/campaigns/${editingId}`, { method: "PUT", body: JSON.stringify(payload) }); id = editingId; }
        else { const s = await apiFetch("/campaigns", { method: "POST", body: JSON.stringify(payload) }); id = s.id; }
      } catch (e) { alert(errorMessage(e)); return; }
    }
    if (!window.confirm("Send this campaign now? This will send real emails.")) return;
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
    const body = editorRef.current?.innerHTML || form.bodyHtml || "";
    const payload = { name: form.name || "Untitled", subject: form.subject, body, segment: form.seg, status: "draft" };
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
      setTestState({ state: "sent", to: r.to, from: r.from, verified: r.verified });
      await loadCampaigns();
    } catch (e) { setTestState({ state: "error", message: errorMessage(e) }); }
  };

  const deleteCampaign = async (id) => {
    try { await apiFetch(`/campaigns/${id}`, { method: "DELETE" }); await loadCampaigns(); }
    catch (e) { alert(errorMessage(e)); }
  };

  const draftAI = async () => {
    setAiLoading(true); setAiDraft("");
    await askClaude(
      "You are an expert nonprofit development writer. Write warm, authentic, mission-driven donor emails. Max 250 words.",
      `Write a donor email for ${data.org.name}.\nMission: ${data.org.mission}\nSegment: ${JSON.stringify(form.seg)}\nSubject hint: ${form.subject || "(generate a compelling one)"}\n\nUse these merge tags: {{first_name}}, {{org_name}}, {{gift_amount}}, {{total_giving}}\n\nFormat — first line: "Subject: [subject line]", blank line, then email body as HTML <p> tags.`,
      chunk => setAiDraft(chunk)
    );
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
        const linkHtml = `<p><a href="${r.url}" style="background:#0d5c3a;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">Give Now →</a></p>`;
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
  const previewOrgName = gallery?.orgName || data?.org?.name || "your organisation";
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
      <div data-testid="campaign-gallery" style={{ position: "fixed", inset: 0, zIndex: 200, background: T.bg, color: T.ink, overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 20px", background: T.white, borderBottom: "1px solid " + T.bg3 }}>
          <button onClick={() => setView("list")} style={{ ...S.btn("ghost"), padding: "6px 12px", fontSize: 12 }}>← Back</button>
          <span style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>New Campaign</span>
        </div>

        <div style={{ maxWidth: 880, margin: "0 auto", padding: "32px 20px 64px" }}>
          <h2 style={{ margin: 0, fontFamily: "'DM Serif Display',serif", fontSize: 28, fontWeight: 400, color: T.ink }}>Start from one of these.</h2>
          <p style={{ margin: "10px 0 28px", fontSize: 14, color: T.ink3, lineHeight: 1.6, maxWidth: 560 }}>
            Every one is a finished email in {previewOrgName}&rsquo;s words — not a skeleton. Change the parts that are yours and press send.
          </p>

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
    // The count comes from the side that does the sending when it has answered;
    // the local count is the stand-in for the 250ms before it does.
    const recipCount = segPreview ? segPreview.count : countSegment(allDonors, form.seg);
    const subjLen = form.subject.length;
    const segSentence = segPreview?.sentence || "";
    const previewName = previewFirst?.firstName || "Margaret";
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", flexDirection: "column", background: T.white, color: T.ink }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 20px", background: T.bg2, borderBottom: "1px solid " + T.bg3, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button onClick={() => setView("list")} style={{ ...S.btn("ghost"), padding: "6px 12px", fontSize: 12 }}>← Back</button>
            <span style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>{editingId ? "Edit Campaign" : "New Campaign"}</span>
          </div>
          {/* ONE action, and it is emerald. Everything else here is a way back
              to the draft; scheduling is a link, because a campaign that is
              scheduled is still a campaign that was sent on purpose. */}
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <button onClick={saveDraft} style={S.btn("ghost")}>Save draft</button>
            <button onClick={() => { setShowSchedule(v => !v); }}
              style={{ background: "transparent", border: "none", padding: 0, color: T.greenDk, fontSize: 13, fontWeight: 600, cursor: "pointer", textDecoration: "underline" }}>
              {showSchedule ? "Send it myself instead" : "Schedule it instead"}
            </button>
            {isAdmin && (showSchedule
              ? <button onClick={scheduleIt} style={S.btn("send")}>Schedule</button>
              : <button onClick={() => sendNow(null)} disabled={sending} data-testid="campaign-send"
                  style={{ ...S.btn("send"), opacity: sending ? 0.6 : 1, cursor: sending ? "not-allowed" : "pointer" }}>
                  {sending ? <><Spin /> Sending…</> : `↑ Send to ${recipCount}`}
                </button>)}
          </div>
        </div>

        {/* Two-panel body */}
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          {/* Left: settings */}
          <div style={{ width: 320, flexShrink: 0, padding: 20, borderRight: "1px solid " + T.bg3, overflowY: "auto", display: "flex", flexDirection: "column", gap: 18, background: T.white }}>

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

            {showSchedule && (
              <div>
                <label style={S.label}>Send it at</label>
                <input type="datetime-local" value={form.scheduledAt}
                  onChange={e => setForm(f => ({ ...f, scheduledAt: e.target.value }))}
                  style={{ ...S.input, width: "auto" }} />
              </div>
            )}

            {aiDraft && (
              <div style={{ background: T.gold50, border: "1px solid " + T.gold300, borderRadius: 10, padding: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: T.gold700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>✦ Suggested Draft</div>
                <div style={{ fontSize: 12, color: T.ink2, lineHeight: 1.7, whiteSpace: "pre-wrap", marginBottom: 10 }}>{aiDraft}</div>
                <button onClick={applyAIDraft} style={{ ...S.btn("primary"), padding: "7px 12px", fontSize: 12 }}>Apply to editor</button>
              </div>
            )}
          </div>

          {/* Middle: the editor */}
          <div style={{ flex: 1, minWidth: 0, padding: 20, overflowY: "auto", background: T.white, display: "flex", flexDirection: "column", gap: 12 }}>
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
            <RichEditor key={editorKey} editorRef={editorRef} initialHtml={form.bodyHtml} onInput={setLiveHtml} />
          </div>

          {/* Right: THE EMAIL, at the width it will be read at. Not a preview
              of the markup — the same renderer the send uses, with the first
              recipient's own first name in it. */}
          <div className="comm-preview" style={{ width: 390, flexShrink: 0, borderLeft: "1px solid " + T.bg3, background: T.bg, padding: "20px 20px 32px", overflowY: "auto" }}>
            <div style={{ ...S.label, marginBottom: 12 }}>What {previewName} will see</div>
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

            {/* SEND ME A TEST — one copy, to her, and it counts against nothing. */}
            <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
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
            </div>
          </div>
        </div>

        {/* The preview used to be a modal you had to ask for. It is the right
            half of the screen now, and it is live. */}
      </div>
    );
  }

  // ── Section nav items (horizontal top tabs) ─────────────────────────────────
  const NAV = [
    { id: "campaigns",  label: "Campaigns",  icon: "✉" },
    { id: "templates",  label: "Templates",  icon: "⊞" },
    { id: "audience",   label: "Audience",   icon: "◈" },
    { id: "analytics",  label: "Analytics",  icon: "⬡" },
    { id: "sequences",  label: "Sequences",  icon: "⟳" },
    { id: "milestones", label: "Milestone Drafts", icon: "✦" },
  ];

  // ── Audience tab segments ───────────────────────────────────────────────────
  const AUDIENCE_SEGS = [
    { id: "all",     label: "All Donors",      filter: d => !!d.email },
    { id: "major",   label: "Major (>$10k)",   filter: d => d.email && (d.total_giving || 0) >= 10000 },
    { id: "lapsed",  label: "Lapsed",          filter: d => d.email && d.status === "lapsed" },
    { id: "prospect",label: "Prospects",       filter: d => d.email && d.stage === "prospect" },
    { id: "steward", label: "Stewards",        filter: d => d.email && d.stage === "steward" },
    { id: "solicit", label: "Ready to Solicit",filter: d => d.email && d.stage === "solicit" },
  ];
  const activeSeg = AUDIENCE_SEGS.find(s => s.id === audienceSeg) || AUDIENCE_SEGS[0];
  const audDonors = allDonors.filter(activeSeg.filter);

  // ── Analytics ───────────────────────────────────────────────────────────────
  const sentCampaigns = campaigns.filter(c => c.status === "sent");
  const allTimeSent   = sentCampaigns.reduce((s, c) => s + (c.recipient_count || 0), 0);
  const allTimeOpen   = sentCampaigns.reduce((s, c) => s + (c.open_count || 0), 0);
  const overallRate   = allTimeSent > 0 ? Math.round(allTimeOpen / allTimeSent * 100) : 0;
  const bestCampaign  = topByOpen[0] || null;

  // ── Main layout ─────────────────────────────────────────────────────────────
  return (
    <div className="comm-layout" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* Section nav — horizontal tabs across the top of the content area */}
      <SectionTabs className="comm-tabbar"
        tabs={NAV.map(n => ({ ...n, badge: n.id === "campaigns" && campaigns.length > 0 ? campaigns.length : undefined }))}
        active={nav} onSelect={setNav} />

      {/* Main content */}
      <div className="comm-main" style={{ flex: 1, minHeight: 0 }}>

        {/* CAN-SPAM postal-address prompt — terracotta = needs-attention */}
        {orgPostalAddress === null && (
          <div style={{ background: T.white, border: "1px solid " + T.bg3, borderLeft: "3px solid " + T.terracotta, borderRadius: 12, padding: "12px 16px", marginBottom: 18, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 320px", fontSize: 13, color: T.ink2, lineHeight: 1.45 }}>
              <span style={{ fontWeight: 800, color: T.ink }}>Add your mailing address. </span>
              Commercial email is required to include your organization's postal address (CAN-SPAM). Set it once under Settings → Tax Receipts and it appears in every campaign and sequence footer automatically{isAdmin ? "" : " — ask an admin to add it"}.
            </div>
            {isAdmin && onNavigate && (
              <button onClick={() => onNavigate("settings", { section: "receipts" })} style={{ background: "transparent", border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 700, color: T.ink, cursor: "pointer", whiteSpace: "nowrap" }}>
                Open Settings →
              </button>
            )}
          </div>
        )}

        {/* ── CAMPAIGNS ────────────────────────────────────────────────────── */}
        {nav === "campaigns" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {/* Header row */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: T.ink }}>Campaigns</h2>
              <button onClick={() => openBuilder()}
                onMouseEnter={() => setNewBtnHover(true)}
                onMouseLeave={() => setNewBtnHover(false)}
                disabled={isReadOnly}
                title={isReadOnly?"Reactivate your subscription to make changes.":undefined}
                style={{ ...S.btn("primary"), background: newBtnHover && !isReadOnly ? T.gold600 : T.gold500, cursor: isReadOnly?"not-allowed":"pointer", opacity: isReadOnly?0.45:1 }}>
                + New Campaign
              </button>
            </div>

            {/* Stat pills */}
            <div style={{ display: "flex", gap: 10 }}>
              {[
                { label: "Total Sent", value: allTimeSent.toLocaleString() },
                { label: "Avg Open Rate", value: overallRate + "%" },
                { label: "Active", value: stats.active },
              ].map(({ label, value }) => (
                <div key={label} style={{ background: T.bg2, border: "1px solid " + T.bg3, borderRadius: 99, padding: "7px 16px", display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: T.ink3 }}>{label}</span>
                  <span style={{ fontSize: 14, fontWeight: 800, color: T.greenMid }}>{value}</span>
                </div>
              ))}
            </div>

            {/* Send result toast */}
            {sendResult && (
              <div style={{ background: T.green100, border: "1px solid " + T.green200, borderRadius: 10, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: T.greenDk, fontWeight: 700, fontSize: 14 }}>
                  {sendResult.queued
                    ? `✓ Queued — sending to ${sendResult.recipientCount} recipient${sendResult.recipientCount === 1 ? "" : "s"}`
                    : `✓ Sent to ${sendResult.sent} donors`}
                </span>
                <button onClick={() => setSendResult(null)} style={{ background: "transparent", border: "none", color: T.greenDk, cursor: "pointer", fontSize: 20 }}>×</button>
              </div>
            )}

            {/* Campaign table */}
            {loading ? (
              <div style={{ color: T.ink3, fontSize: 13, padding: "40px 0", textAlign: "center" }}>Loading…</div>
            ) : campaigns.length === 0 ? (
              /* First-run signpost (BUILD-08 Phase D) — the gold "start
                 here" pattern from shared.jsx, not a bare "no data" box. */
              <StartHere
                line="Your first campaign doesn't need to be clever — a plain thank-you to everyone who gave this year is the highest-return email in fundraising. Three warm sentences; Steward handles the sending, the footer, and who opened it."
                actionLabel={isReadOnly?undefined:"Write that thank-you →"} onAction={()=>openBuilder()}/>
            ) : (
              <div style={{ background: T.bg2, border: "1px solid " + T.bg3, borderRadius: 12, overflow: "hidden" }}>
                {/* Table header */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 140px 100px 70px 90px 100px 100px", padding: "10px 16px", background: T.bg2, borderBottom: "1px solid " + T.bg3, fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.06em", gap: 8 }}>
                  <span>Campaign</span>
                  <span>Segment</span>
                  <span>Status</span>
                  <span>Sent</span>
                  <span>Open Rate</span>
                  <span>Date</span>
                  <span>Actions</span>
                </div>
                {campaigns.map(c => {
                  const raw = typeof c.segment === "string" ? JSON.parse(c.segment || "{}") : (c.segment || {});
                  const recs = c.recipients || [];
                  const sentCt = c.recipient_count || recs.filter(r => r.sent_at).length || 0;
                  const openCt = c.open_count || recs.filter(r => r.opened_at).length || 0;
                  const openRate = sentCt > 0 ? Math.round(openCt / sentCt * 100) : 0;
                  const isOpen = expandedId === c.id;

                  return (
                    <div key={c.id} style={{ borderTop: "1px solid " + T.bg3 }}>
                      {/* Row */}
                      <div
                        style={{ display: "grid", gridTemplateColumns: "1fr 140px 100px 70px 90px 100px 100px", padding: "12px 16px", gap: 8, alignItems: "center", cursor: "pointer", transition: "background 0.1s" }}
                        onClick={() => setExpandedId(isOpen ? null : c.id)}
                        onMouseEnter={e => { e.currentTarget.style.background = T.bg3; setHoveredRowId(c.id); }}
                        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; setHoveredRowId(null); }}
                      >
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: hoveredRowId === c.id ? "#0d5c3a" : T.ink, transition: "color 0.1s" }}>{c.name}</div>
                          <div style={{ fontSize: 11, color: T.ink3, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>{c.subject}</div>
                        </div>
                        <div style={{ fontSize: 11, color: T.ink3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{segLabel(raw)}</div>
                        <div><StatusBadge status={c.status} /></div>
                        <div style={{ fontSize: 13, color: T.ink }}>{sentCt > 0 ? sentCt.toLocaleString() : "—"}</div>
                        <div>
                          {sentCt > 0 ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: openRate >= 25 ? T.greenMid : openRate >= 15 ? T.gold600 : T.ink3 }}>{openRate}%</span>
                              <div style={{ height: 3, background: T.bg3, borderRadius: 99 }}>
                                <div style={{ height: "100%", width: `${Math.min(openRate, 100)}%`, background: openRate >= 25 ? T.greenMid : T.gold500, borderRadius: 99 }} />
                              </div>
                            </div>
                          ) : <span style={{ fontSize: 11, color: T.ink3 }}>—</span>}
                        </div>
                        <div style={{ fontSize: 11, color: T.ink3 }}>
                          {c.sent_at ? new Date(c.sent_at).toLocaleDateString() : c.scheduled_at ? "⏰ " + new Date(c.scheduled_at).toLocaleDateString() : "—"}
                        </div>
                        {/* Actions */}
                        <div style={{ display: "flex", gap: 6 }} onClick={e => e.stopPropagation()}>
                          <button title="Edit" onClick={() => openBuilder(c)}
                            style={{ background: "transparent", border: "none", color: T.ink3, cursor: "pointer", fontSize: 14, padding: "2px 4px", borderRadius: 4 }}>✎</button>
                          <button title="Duplicate" onClick={() => duplicateCampaign(c)}
                            style={{ background: "transparent", border: "none", color: T.ink3, cursor: "pointer", fontSize: 14, padding: "2px 4px", borderRadius: 4 }}>⊕</button>
                          {isAdmin && c.status !== "sending" && (
                            <button title="Delete" onClick={() => { if (window.confirm(`Delete "${c.name}"?`)) deleteCampaign(c.id); }}
                              style={{ background: "transparent", border: "none", color: T.terracotta, cursor: "pointer", fontSize: 14, padding: "2px 4px", borderRadius: 4 }}>✕</button>
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
                              {[["Sent", sentCt, T.ink], ["Opened", openCt, T.greenMid], ["Open Rate", openRate + "%", openRate >= 25 ? T.greenMid : T.gold600], ["Failed", recs.filter(r => r.failure_reason).length, T.terracotta]].map(([lbl, val, col]) => (
                                <div key={lbl} style={{ background: T.bg2, borderRadius: 8, padding: "10px 14px", flex: 1 }}>
                                  <div style={{ fontSize: 10, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.06em" }}>{lbl}</div>
                                  <div style={{ fontSize: 20, fontWeight: 800, color: col, marginTop: 2 }}>{val}</div>
                                </div>
                              ))}
                            </div>
                          )}
                          {/* Draft/scheduled/sent actions */}
                          <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                            {c.status !== "sent" && <button onClick={() => openBuilder(c)} style={S.btn("subtle")}>Edit</button>}
                            {isAdmin && c.status !== "sending" && c.status !== "sent" && (
                              <button onClick={() => sendNow(c.id)} disabled={sending}
                                style={{ ...S.btn("primary"), opacity: sending ? 0.6 : 1 }}>
                                {sending ? <><Spin /> Sending…</> : "↑ Send Now"}
                              </button>
                            )}
                            <CampaignLinkBtn campaignId={c.id} campaignName={c.name} />
                          </div>
                          {/* Recipient list */}
                          {recs.length > 0 && (
                            <div style={{ border: "1px solid " + T.bg3, borderRadius: 8, overflow: "hidden" }}>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 80px", padding: "7px 12px", background: T.bg2, fontSize: 10, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.06em", gap: 8 }}>
                                <span>Recipient</span><span>Status</span><span>Time</span>
                              </div>
                              {recs.slice(0, 30).map(r => (
                                <div key={r.id} style={{ display: "grid", gridTemplateColumns: "1fr 80px 80px", padding: "8px 12px", borderTop: "1px solid " + T.bg2, fontSize: 12, gap: 8, alignItems: "center" }}>
                                  <span style={{ color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.donor_name || r.email}</span>
                                  <span style={{ color: r.opened_at ? T.greenMid : r.failure_reason ? T.terracotta : r.sent_at ? T.ink3 : T.gold600 }}
                                    title={r.failure_reason || undefined}>
                                    {r.opened_at ? "Opened" : r.failure_reason ? "Failed" : r.sent_at ? "Delivered" : "Pending"}
                                  </span>
                                  <span style={{ color: T.ink3, fontSize: 11 }}>
                                    {(r.opened_at || r.sent_at) ? new Date(r.opened_at || r.sent_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
                                  </span>
                                </div>
                              ))}
                              {recs.length > 30 && <div style={{ padding: "8px 12px", fontSize: 11, color: T.ink3, borderTop: "1px solid " + T.bg2 }}>+{recs.length - 30} more</div>}
                            </div>
                          )}
                        </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── TEMPLATES ─────────────────────────────────────────────────────── */}
        {nav === "templates" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: T.ink }}>Templates</h2>
            <p style={{ margin: 0, fontSize: 13, color: T.ink3 }}>
              The same six &ldquo;New Campaign&rdquo; opens on — finished emails in {previewOrgName}&rsquo;s words, not skeletons.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
              {templates.map(tpl => (
                <div key={tpl.key} data-testid={"template-card-" + tpl.key}
                  {...interactive(isReadOnly ? null : () => openTemplate(tpl), { label: `Use the ${tpl.label} email` })}
                  style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 14, padding: 32, display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ background: brand?.band || T.greenDk, color: brand?.bandFg || T.white, borderRadius: 10, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10, minHeight: 20 }}>
                    {brand?.logo
                      ? <img src={brand.logo} alt="" style={{ height: 22, maxWidth: 110, objectFit: "contain" }} />
                      : <span style={{ fontFamily: "'DM Serif Display',serif", fontSize: 15 }}>{brand?.displayName || previewOrgName}</span>}
                  </div>
                  <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 20, color: T.ink, lineHeight: 1.2 }}>{tpl.label}</div>
                  <div style={{ fontSize: 13, color: T.ink3, lineHeight: 1.6 }}>{tpl.blurb}</div>
                  <div style={{ borderTop: "1px solid " + T.bg3, paddingTop: 12, fontSize: 13, fontWeight: 700, color: T.ink }}>{renderPreview(tpl.subject)}</div>
                  {!isReadOnly && <span style={{ fontSize: 13, fontWeight: 700, color: T.greenDk }}>Use this &rarr;</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── AUDIENCE ──────────────────────────────────────────────────────── */}
        {nav === "audience" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: T.ink }}>Audience</h2>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {AUDIENCE_SEGS.map(s => {
                const cnt = allDonors.filter(s.filter).length;
                return (
                  <button key={s.id} onClick={() => setAudienceSeg(s.id)}
                    style={{
                      background: audienceSeg === s.id ? T.green : T.bg2,
                      border: "1px solid " + (audienceSeg === s.id ? T.green : T.bg3),
                      borderRadius: 99, padding: "7px 14px", cursor: "pointer",
                      color: audienceSeg === s.id ? "#fff" : T.ink3,
                      fontSize: 12, fontWeight: audienceSeg === s.id ? 700 : 400,
                      display: "flex", alignItems: "center", gap: 6,
                    }}>
                    {s.label}
                    <span style={{ background: audienceSeg === s.id ? "#ffffff30" : T.bg3, borderRadius: 99, padding: "1px 7px", fontSize: 11, color: audienceSeg === s.id ? "#fff" : T.ink3 }}>{cnt}</span>
                  </button>
                );
              })}
            </div>

            {allDonors.length === 0 ? (
              <div style={{ color: T.ink3, fontSize: 13, padding: 20 }}>Loading donors…</div>
            ) : audDonors.length === 0 ? (
              <div style={{ color: T.ink3, fontSize: 13, padding: 20 }}>No donors in this segment.</div>
            ) : (
              <div style={{ background: T.bg2, border: "1px solid " + T.bg3, borderRadius: 12, overflow: "hidden" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 180px 110px 90px", padding: "9px 16px", background: "#0d5c3a", fontSize: 10, fontWeight: 700, color: "#fff", textTransform: "uppercase", letterSpacing: "0.06em", gap: 8 }}>
                  <span>Donor</span><span>Email</span><span>Stage</span><span>Total Giving</span>
                </div>
                {audDonors.slice(0, 50).map(d => (
                  <div key={d.id} style={{ display: "grid", gridTemplateColumns: "1fr 180px 110px 90px", padding: "10px 16px", borderTop: "1px solid " + T.bg3, fontSize: 13, gap: 8, alignItems: "center" }}>
                    <span style={{ fontWeight: 600, color: T.ink }}>{d.name}</span>
                    <span style={{ color: T.ink3, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.email}</span>
                    <span style={{ fontSize: 11, color: T.ink3, textTransform: "capitalize" }}>{d.stage || "—"}</span>
                    <span style={{ fontSize: 12, color: T.ink }}>${Number(d.total_giving || 0).toLocaleString()}</span>
                  </div>
                ))}
                {audDonors.length > 50 && <div style={{ padding: "9px 16px", fontSize: 11, color: T.ink3, borderTop: "1px solid " + T.bg3 }}>+{audDonors.length - 50} more</div>}
              </div>
            )}

            <button
              onClick={() => { setNav("campaigns"); openBuilder(); }}
              style={{ ...S.btn("primary"), alignSelf: "flex-start" }}>
              Email This Segment →
            </button>
          </div>
        )}

        {/* ── ANALYTICS ─────────────────────────────────────────────────────── */}
        {nav === "analytics" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: T.ink }}>Analytics</h2>

            {/* All-time stats */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
              {[
                // Total Sent / Open Rate have no filtered-list destination → static.
                { label: "Total Emails Sent", value: allTimeSent.toLocaleString() },
                { label: "Overall Open Rate",  value: overallRate + "%", note: "Industry avg ~20%" },
                { label: "Campaigns Sent",     value: sentCampaigns.length, onClick: () => setNav("campaigns") },
              ].map(({ label, value, note, onClick }) => (
                <div key={label} {...interactive(onClick, { label: `View ${label}` })}
                  style={{ background: T.bg2, border: "1px solid " + T.bg3, borderRadius: 12, padding: 18 }}>
                  <div style={{ fontSize: 11, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{label}</div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: T.ink }}>{value}</div>
                  {note && <div style={{ fontSize: 11, color: T.ink3, marginTop: 4 }}>{note}</div>}
                </div>
              ))}
            </div>

            {/* Best campaign */}
            {bestCampaign && (
              <div {...interactive(() => setNav("campaigns"), { label: `View campaign ${bestCampaign.name}` })}
                style={{ background: T.green100, border: "1px solid " + T.green200, borderRadius: 12, padding: 16, display: "flex", alignItems: "center", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 11, color: T.green, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>Best Campaign</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: T.ink, marginTop: 2 }}>{bestCampaign.name}</div>
                  <div style={{ fontSize: 12, color: T.ink3 }}>{bestCampaign.rate}% open rate · {bestCampaign.recipient_count} sent</div>
                </div>
              </div>
            )}

            {/* Monthly chart */}
            {monthlyChart.length > 0 && (
              <div style={{ background: T.bg2, border: "1px solid " + T.bg3, borderRadius: 12, padding: 18 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: T.ink, marginBottom: 14 }}>Sends Per Month</div>
                <BarChart data={monthlyChart} />
              </div>
            )}

            {/* Top 5 by open rate */}
            {topByOpen.length > 0 && (
              <div style={{ background: T.bg2, border: "1px solid " + T.bg3, borderRadius: 12, overflow: "hidden" }}>
                <div style={{ padding: "12px 16px", borderBottom: "1px solid " + T.bg3, fontSize: 12, fontWeight: 700, color: T.ink }}>Top Campaigns by Open Rate</div>
                {topByOpen.map((c, i) => (
                  <div key={c.id} style={{ display: "flex", alignItems: "center", padding: "11px 16px", borderTop: i > 0 ? "1px solid " + T.bg3 : undefined, gap: 12 }}>
                    <span style={{ fontSize: 11, color: T.ink3, width: 16, textAlign: "right" }}>#{i + 1}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{c.name}</div>
                      <div style={{ fontSize: 11, color: T.ink3 }}>{c.recipient_count} sent · {new Date(c.sent_at).toLocaleDateString()}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 16, fontWeight: 800, color: c.rate >= 25 ? T.greenMid : T.gold600 }}>{c.rate}%</div>
                      <div style={{ height: 3, width: 60, background: T.bg3, borderRadius: 99, marginTop: 3 }}>
                        <div style={{ height: "100%", width: `${Math.min(c.rate, 100)}%`, background: c.rate >= 25 ? T.greenMid : T.gold500, borderRadius: 99 }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {sentCampaigns.length === 0 && (
              <div style={{ background: T.bg2, borderRadius: 12, padding: 40, textAlign: "center", color: T.ink3, fontSize: 14 }}>
                Send your first campaign to see analytics.
              </div>
            )}
          </div>
        )}

        {/* ── SEQUENCES ─────────────────────────────────────────────────────── */}
        {nav === "sequences" && <SequencesPanel data={data} />}

        {/* ── MILESTONE DRAFTS ──────────────────────────────────────────────── */}
        {nav === "milestones" && <MilestoneDraftsPanel highlightDraftId={highlightDraftId}/>}
      </div>
    </div>
  );
}
