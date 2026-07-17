import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { apiFetch } from "../api";
import { useAuth } from "../main";
import { T, askClaude, Spin, fmtFull } from "./shared";

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
            {saved && <span style={{ fontSize: 11, color: "#10b981" }}>✓ Saved</span>}
            <button onClick={save} disabled={saving} style={{ background: "#10b981", border: "none", borderRadius: 8, padding: "7px 14px", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
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
                <span style={{ fontSize: 12, fontWeight: 700, color: "#1a6b4a" }}>{fmtFull(raisedAmt)} raised</span>
                <span style={{ fontSize: 12, color: T.ink3 }}>of {fmtFull(goalAmt)} goal · {pct}%</span>
              </div>
              <div style={{ height: 8, background: T.bg3, borderRadius: 99, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${pct}%`, background: pct >= 100 ? "#1a6b4a" : "#10b981", borderRadius: 99, transition: "width 0.4s" }} />
              </div>
              {progress?.donorCount > 0 && <div style={{ fontSize: 11, color: T.ink3, marginTop: 6 }}>{progress.donorCount} donor{progress.donorCount !== 1 ? "s" : ""} contributed</div>}
              {progress?.daysRemaining !== null && progress?.daysRemaining !== undefined && (
                <div style={{ fontSize: 11, color: progress.daysRemaining < 0 ? "#ef4444" : T.ink3, marginTop: 4, fontWeight: progress.daysRemaining < 7 ? 700 : 400 }}>
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
  sidebar: { width: 220, bg: "#e8e4db", borderRight: "1px solid #ddd9d0" },
  input: {
    background: T.bg, border: "1px solid " + T.bg3, borderRadius: 8,
    padding: "9px 12px", color: T.ink, fontSize: 13, outline: "none", width: "100%", boxSizing: "border-box",
  },
  label: { fontSize: 11, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 4 },
  btn: (variant = "ghost") => ({
    ghost:   { background: "transparent", border: "1px solid " + T.bg3, borderRadius: 8, padding: "8px 14px", color: T.ink2, fontSize: 13, cursor: "pointer" },
    primary: { background: T.green, border: "none", borderRadius: 8, padding: "9px 18px", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" },
    danger:  { background: "transparent", border: "1px solid #ef4444", borderRadius: 8, padding: "8px 14px", color: "#ef4444", fontSize: 13, cursor: "pointer" },
    amber:   { background: "#f59e0b", border: "none", borderRadius: 8, padding: "9px 18px", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" },
    subtle:  { background: T.bg2, border: "1px solid " + T.bg3, borderRadius: 8, padding: "8px 14px", color: T.ink, fontSize: 13, cursor: "pointer" },
  })[variant],
};

// ── Status badge ──────────────────────────────────────────────────────────────
const STATUS_META = {
  draft:     { label: "Draft",     color: "#6b7280", bg: "#6b728018" },
  scheduled: { label: "Scheduled", color: "#3b82f6", bg: "#3b82f618" },
  sending:   { label: "Sending",   color: "#f59e0b", bg: "#f59e0b18" },
  sent:      { label: "Sent",      color: "#fff",    bg: "#1a6b4a" },
};
function StatusBadge({ status }) {
  const m = STATUS_META[status] || STATUS_META.draft;
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color: m.color, background: m.bg, borderRadius: 99, padding: "3px 10px", letterSpacing: "0.04em" }}>
      {status === "sending" ? <span style={{ animation: "pulse 1.2s ease-in-out infinite" }}>{m.label}</span> : m.label}
    </span>
  );
}

// ── Templates ─────────────────────────────────────────────────────────────────
const TEMPLATES = [
  {
    id: "yearend", name: "Year End Appeal", emoji: "🎁",
    subject: "Your year-end gift makes a difference, {{first_name}}",
    body: `<p>Dear {{first_name}},</p><p>As the year draws to a close, we're reflecting on everything we've accomplished together — and it wouldn't be possible without you.</p><p>Your support of {{org_name}} has helped us create real, lasting change. Your previous gift of {{gift_amount}} made a direct impact on the lives we serve.</p><p>This year-end, would you consider renewing your commitment with a gift? Every dollar goes directly to our programs.</p><p>With gratitude,<br>The {{org_name}} Team</p>`,
  },
  {
    id: "event", name: "Event Invitation", emoji: "🎉",
    subject: "You're invited — join us for a special evening",
    body: `<p>Dear {{first_name}},</p><p>We'd love to have you join us for an exclusive evening with {{org_name}}. As one of our valued supporters, you'll get an inside look at our programs and the impact your generosity is creating.</p><p><strong>Date:</strong> [Date]<br><strong>Time:</strong> [Time]<br><strong>Location:</strong> [Venue]</p><p>Space is limited — please RSVP by [Date].</p><p>We hope to see you there!<br>The {{org_name}} Team</p>`,
  },
  {
    id: "volunteer", name: "Volunteer Thank You", emoji: "🙌",
    subject: "Thank you for giving your time, {{first_name}}",
    body: `<p>Dear {{first_name}},</p><p>We wanted to take a moment to say a sincere thank you for volunteering with {{org_name}}. Your time and dedication mean everything to us and to the people we serve.</p><p>Volunteers like you are the backbone of our mission. Because of your generosity with your time, we've been able to expand our reach and deepen our impact.</p><p>With heartfelt thanks,<br>The {{org_name}} Team</p>`,
  },
  {
    id: "grant", name: "Grant Announcement", emoji: "📣",
    subject: "Exciting news from {{org_name}}",
    body: `<p>Dear {{first_name}},</p><p>We have exciting news to share! {{org_name}} has recently been awarded a significant grant that will allow us to expand our work in meaningful ways.</p><p>This milestone is a testament to the strength of our community — supporters like you who believe in our mission and make our work possible.</p><p>Thank you for being part of this journey with us.</p><p>Warmly,<br>The {{org_name}} Team</p>`,
  },
  {
    id: "newsletter", name: "Monthly Newsletter", emoji: "📰",
    subject: "{{org_name}} — [Month] Update",
    body: `<p>Dear {{first_name}},</p><h2>What We've Been Up To</h2><p>[Highlight 1 — program update, milestone, or story]</p><h2>By the Numbers</h2><p>[Key stat or metric from this month]</p><h2>Coming Up</h2><p>[Upcoming event or opportunity to get involved]</p><p>Thank you for staying connected with {{org_name}}. Your support makes all of this possible.</p><p>Until next month,<br>The {{org_name}} Team</p>`,
  },
  {
    id: "lapsed", name: "Lapsed Donor Re-engagement", emoji: "💌",
    subject: "We miss you, {{first_name}}",
    body: `<p>Dear {{first_name}},</p><p>It's been a while since we've heard from you, and we wanted to reach out personally. Your past gift of {{gift_amount}} to {{org_name}} made a real difference, and we'd love to reconnect.</p><p>A lot has changed since your last gift — and there's so much we'd love to share with you about where your support went and the impact it created.</p><p>If you're open to it, we'd love to have you back. Even a small gift goes a long way.</p><p>With hope,<br>The {{org_name}} Team</p>`,
  },
];

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
        {SEG_MODES.map(m => (
          <button key={m.id} onClick={() => upd({ mode: m.id })}
            style={{
              background: mode === m.id ? T.green : T.bg2,
              border: "1px solid " + (mode === m.id ? T.green : T.bg3),
              borderRadius: 99, padding: "5px 12px", fontSize: 11,
              color: mode === m.id ? "#fff" : T.ink3, cursor: "pointer",
              fontWeight: mode === m.id ? 700 : 400,
            }}>{m.label}</button>
        ))}
      </div>
      {mode === "byStage" && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {STAGE_OPTS.map(s => (
            <button key={s} onClick={() => tog("stages", s)}
              style={{ background: (seg.stages || []).includes(s) ? "#8b5cf6" : T.bg2, border: "none", borderRadius: 99, padding: "4px 10px", fontSize: 11, color: (seg.stages || []).includes(s) ? "#fff" : T.ink3, cursor: "pointer" }}>
              {s}
            </button>
          ))}
        </div>
      )}
      {mode === "byTier" && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {TIER_OPTS.map(t => (
            <button key={t} onClick={() => tog("tiers", t)}
              style={{ background: (seg.tiers || []).includes(t) ? "#f59e0b" : T.bg2, border: "none", borderRadius: 99, padding: "4px 10px", fontSize: 11, color: (seg.tiers || []).includes(t) ? "#fff" : T.ink3, cursor: "pointer" }}>
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
function RichEditor({ editorRef, initialHtml }) {
  useEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = initialHtml || "";
  }, []);

  const exec = (cmd, val) => { editorRef.current?.focus(); document.execCommand(cmd, false, val ?? undefined); };

  const TAGS = [
    ["{{first_name}}", "First"],
    ["{{last_name}}", "Last"],
    ["{{org_name}}", "Org"],
    ["{{gift_amount}}", "Last gift"],
    ["{{total_giving}}", "Total giving"],
  ];

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
            onMouseDown={e => { e.preventDefault(); editorRef.current?.focus(); document.execCommand("insertText", false, tag); }}
            style={{ background: "#10b98114", border: "1px solid #10b98130", borderRadius: 4, padding: "2px 7px", fontSize: 10, color: T.green, cursor: "pointer" }}>
            {lbl}
          </button>
        ))}
      </div>
      <div ref={editorRef} contentEditable suppressContentEditableWarning
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
          <div style={{ width: "100%", height: Math.max(4, (d.v / max) * 64), background: "#1a6b4a", borderRadius: "4px 4px 0 0", opacity: 0.85 }} />
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
      alert(err.message || "Connect Stripe in Settings to generate donation links.");
    }
    setLoading(false);
  };
  return (
    <button onClick={generate} disabled={loading}
      style={{ background: copied ? T.greenDk : T.greenDk + "14", border: "1px solid " + T.greenDk + "30", borderRadius: 8, padding: "8px 14px", color: copied ? "#fff" : T.greenDk, fontSize: 12, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 6 }}>
      {loading ? <><Spin /> Generating…</> : copied ? "✓ Link copied!" : "💳 Copy Donation Link"}
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
            style={{ background: aiLoading ? T.bg3 : "#8b5cf614", border: "1px solid #8b5cf630", borderRadius: 7, padding: "4px 10px", color: aiLoading ? T.ink3 : "#8b5cf6", fontSize: 11, fontWeight: 700, cursor: aiLoading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 5 }}>
            {aiLoading ? <><Spin/> Writing…</> : "✦ Write with AI"}
          </button>
          {total > 1 && <button onClick={onRemove} style={{ background: "transparent", border: "1px solid #ef444440", borderRadius: 7, padding: "4px 9px", color: "#ef4444", fontSize: 11, cursor: "pointer" }}>Remove</button>}
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
    } catch (e) { alert(e.message); }
    setSaveLoading(false);
  };

  const deleteSeq = async (id) => {
    if (!window.confirm("Delete this sequence and all enrollments?")) return;
    try { await apiFetch(`/sequences/${id}`, { method: "DELETE" }); await loadSeqs(); }
    catch (e) { alert(e.message); }
  };

  const toggleStatus = async (seq) => {
    const newStatus = seq.status === "active" ? "paused" : "active";
    try {
      await apiFetch(`/sequences/${seq.id}/status`, { method: "PATCH", body: JSON.stringify({ status: newStatus }) });
      setSeqList(prev => prev.map(s => s.id === seq.id ? { ...s, status: newStatus } : s));
    } catch (e) { alert(e.message); }
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
    } catch (e) { alert(e.message); }
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
          No sequences yet. Create your first one above.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {seqList.map(seq => {
            const isActive = seq.status === "active";
            const enrList = enrollmentsMap[seq.id] || [];
            return (
              <div key={seq.id} style={{ background: "#0f1a12", borderRadius: 12, border: "1px solid #1a2e1f", overflow: "hidden", boxShadow: T.shadow }}>
                <div style={{ padding: "14px 16px" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: "#f0ede6" }}>{seq.name}</div>
                        <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 99, padding: "3px 9px", background: isActive ? "#10b98120" : "#ffffff12", color: isActive ? "#10b981" : "#8fa896", letterSpacing:"0.04em", textTransform:"uppercase" }}>{isActive ? "Active" : "Paused"}</span>
                      </div>
                      <div style={{ fontSize: 12, color: "#8fa896", marginTop: 4 }}>
                        {trigLabel(seq.trigger)} · <span style={{ color: "#c9a84c", fontWeight: 700 }}>{seq.step_count} step{seq.step_count != 1 ? "s" : ""}</span> · {seq.active_enrollments} active
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
                  <div style={{ borderTop: "1px solid #1a2e1f", padding: "12px 16px" }}>
                    {enrList.length === 0 ? (
                      <div style={{ fontSize: 12, color: "#8fa896", textAlign: "center", padding: "8px 0" }}>No enrollments yet.</div>
                    ) : (
                      <div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 160px 80px 100px 100px 80px", gap: 8, padding: "5px 0", fontSize: 10, fontWeight: 700, color: "#8fa896", textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid #1a2e1f", marginBottom: 4 }}>
                          <span>Donor</span><span>Email</span><span>Step</span><span>Next Send</span><span>Status</span><span></span>
                        </div>
                        {enrList.map(e => (
                          <div key={e.id} style={{ display: "grid", gridTemplateColumns: "1fr 160px 80px 100px 100px 80px", gap: 8, padding: "7px 0", borderBottom: "1px solid #1a2e1f", alignItems: "center" }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: "#f0ede6", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.donor_name}</span>
                            <span style={{ fontSize: 11, color: "#8fa896", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.donor_email}</span>
                            <span style={{ fontSize: 12, color: "#c9a84c", fontWeight: 700 }}>{e.current_step}/{e.total_steps}</span>
                            <span style={{ fontSize: 11, color: T.ink3 }}>{e.next_send_at ? new Date(e.next_send_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}</span>
                            <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 99, padding: "2px 7px", background: e.status === "active" ? "#10b98120" : "#6b728020", color: e.status === "active" ? T.green : T.ink3, display: "inline-block" }}>{e.status}</span>
                            {e.status === "active" && (
                              <button onClick={() => unenroll(seq.id, e.donor_id)} style={{ fontSize: 10, background: "transparent", border: "1px solid #ef444440", borderRadius: 6, padding: "2px 7px", color: "#ef4444", cursor: "pointer" }}>Unenroll</button>
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
    } catch (e) { alert(e.message); }
    setBusyId(null);
  };

  const send = async (id) => {
    if (!window.confirm("Send this email now?")) return;
    setBusyId(id);
    try {
      await apiFetch(`/milestone-drafts/${id}/send`, { method: "POST" });
      setDrafts(prev => prev.filter(d => d.id !== id));
    } catch (e) { alert(e.message); }
    setBusyId(null);
  };

  const dismiss = async (id) => {
    if (!window.confirm("Dismiss this draft without sending?")) return;
    setBusyId(id);
    try {
      await apiFetch(`/milestone-drafts/${id}/dismiss`, { method: "POST" });
      setDrafts(prev => prev.filter(d => d.id !== id));
    } catch (e) { alert(e.message); }
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
          No drafts waiting for review right now.
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
  const [showPreview, setShowPreview] = useState(false);
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

  // ── Builder actions ─────────────────────────────────────────────────────────
  const openBuilder = (campaign = null) => {
    if (campaign) {
      const raw = typeof campaign.segment === "string" ? JSON.parse(campaign.segment || "{}") : (campaign.segment || {});
      const mode = raw.mode || "all";
      setForm({ name: campaign.name || "", subject: campaign.subject || "", bodyHtml: campaign.body || "",
        seg: { mode, stages: raw.stages || [], tiers: raw.tiers || [], donorIds: raw.donorIds || [] },
        scheduledAt: campaign.scheduled_at ? new Date(campaign.scheduled_at).toISOString().slice(0, 16) : "" });
      setEditingId(campaign.id);
    } else {
      setForm(BLANK); setEditingId(null);
    }
    setEditorKey(k => k + 1); setAiDraft(""); setView("builder");
  };

  const duplicateCampaign = async (c) => {
    const raw = typeof c.segment === "string" ? JSON.parse(c.segment || "{}") : (c.segment || {});
    const payload = { name: "Copy of " + c.name, subject: c.subject, body: c.body, segment: raw, status: "draft" };
    try { await apiFetch("/campaigns", { method: "POST", body: JSON.stringify(payload) }); await loadCampaigns(); }
    catch (e) { alert(e.message); }
  };

  const saveDraft = async () => {
    if (!form.name.trim()) return alert("Campaign name is required.");
    const body = editorRef.current?.innerHTML || "";
    const payload = { name: form.name, subject: form.subject, body, segment: form.seg, status: "draft" };
    try {
      if (editingId) await apiFetch(`/campaigns/${editingId}`, { method: "PUT", body: JSON.stringify(payload) });
      else await apiFetch("/campaigns", { method: "POST", body: JSON.stringify(payload) });
      await loadCampaigns(); setView("list");
    } catch (e) { alert(e.message); }
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
    } catch (e) { alert(e.message); }
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
      } catch (e) { alert(e.message); return; }
    }
    if (!window.confirm("Send this campaign now? This will send real emails.")) return;
    setSending(true); setSendResult(null);
    try {
      const r = await apiFetch(`/campaigns/${id}/send`, { method: "POST" });
      setSendResult(r); await loadCampaigns(); setView("list");
    } catch (e) { alert(e.message); }
    setSending(false);
  };

  const deleteCampaign = async (id) => {
    try { await apiFetch(`/campaigns/${id}`, { method: "DELETE" }); await loadCampaigns(); }
    catch (e) { alert(e.message); }
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
        const linkHtml = `<p><a href="${r.url}" style="background:#1a6b4a;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">Give Now →</a></p>`;
        document.execCommand("insertHTML", false, linkHtml);
      }
    } catch (e) {
      alert(e.message || "Could not generate donation link. Make sure Stripe is connected in Settings.");
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
    }
    setAiDraft("");
  };

  const getPreviewHtml = () => (editorRef.current?.innerHTML || form.bodyHtml || "")
    .replace(/{{first_name}}/g, "Margaret")
    .replace(/{{last_name}}/g, "Chen")
    .replace(/{{org_name}}/g, data?.org?.name || "Org")
    .replace(/{{gift_amount}}/g, "$5,000")
    .replace(/{{total_giving}}/g, "$24,500")
    .replace(/{{year}}/g, String(new Date().getFullYear()));

  // ── Builder full-screen ─────────────────────────────────────────────────────
  if (view === "builder") {
    const recipCount = countSegment(allDonors, form.seg);
    const subjLen = form.subject.length;
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", flexDirection: "column", background: T.white, color: T.ink }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 20px", background: T.bg2, borderBottom: "1px solid " + T.bg3, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button onClick={() => setView("list")} style={{ ...S.btn("ghost"), padding: "6px 12px", fontSize: 12 }}>← Back</button>
            <span style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>{editingId ? "Edit Campaign" : "New Campaign"}</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {/* Draft campaign copy */}
            <button onClick={draftAI} disabled={aiLoading}
              style={{ background: aiLoading ? T.bg3 : "#8b5cf614", border: "1px solid #8b5cf630", borderRadius: 8, padding: "8px 14px", color: aiLoading ? T.ink3 : "#8b5cf6", fontSize: 13, fontWeight: 700, cursor: aiLoading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 6 }}>
              {aiLoading ? <><Spin /> Drafting…</> : "✦ Draft Copy"}
            </button>
            <button onClick={addDonationLink} disabled={linkLoading}
              style={{ background: linkLoading ? T.bg3 : T.greenDk + "14", border: "1px solid " + T.greenDk + "30", borderRadius: 8, padding: "8px 14px", color: linkLoading ? T.ink3 : T.greenDk, fontSize: 13, fontWeight: 700, cursor: linkLoading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 6 }}>
              {linkLoading ? <><Spin /> Generating…</> : "💳 Donation Link"}
            </button>
            <button onClick={() => setShowPreview(true)} style={S.btn("ghost")}>Preview</button>
            <button onClick={saveDraft} style={S.btn("subtle")}>Save Draft</button>
            {form.scheduledAt && <button onClick={scheduleIt} style={S.btn("amber")}>⏰ Schedule</button>}
            {isAdmin && (
              <button onClick={() => sendNow(null)} disabled={sending}
                style={{ ...S.btn("primary"), opacity: sending ? 0.6 : 1, cursor: sending ? "not-allowed" : "pointer" }}>
                {sending ? <><Spin /> Sending…</> : `↑ Send to ${recipCount}`}
              </button>
            )}
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
                <span style={{ float: "right", color: subjLen > 60 ? "#ef4444" : T.ink3 }}>{subjLen}/60</span>
              </label>
              <input value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                placeholder="A message from {{org_name}}" style={S.input} />
            </div>

            <div>
              <label style={S.label}>Audience Segment</label>
              <SegmentPicker seg={form.seg}
                onChange={seg => { setForm(f => ({ ...f, seg })); if (seg.mode === "manual") loadDonors(); }}
                allDonors={allDonors} />
            </div>

            <div>
              <label style={S.label}>Schedule for later (optional)</label>
              <input type="datetime-local" value={form.scheduledAt}
                onChange={e => setForm(f => ({ ...f, scheduledAt: e.target.value }))}
                style={{ ...S.input, width: "auto" }} />
            </div>

            {aiDraft && (
              <div style={{ background: "#8b5cf608", border: "1px solid #8b5cf630", borderRadius: 10, padding: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#8b5cf6", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>✦ Suggested Draft</div>
                <div style={{ fontSize: 12, color: T.ink2, lineHeight: 1.7, whiteSpace: "pre-wrap", marginBottom: 10 }}>{aiDraft}</div>
                <button onClick={applyAIDraft} style={{ ...S.btn("primary"), padding: "7px 12px", fontSize: 12 }}>Apply to editor</button>
              </div>
            )}
          </div>

          {/* Right: editor */}
          <div style={{ flex: 1, padding: 20, overflowY: "auto", background: T.white }}>
            <label style={S.label}>Email Body</label>
            <RichEditor key={editorKey} editorRef={editorRef} initialHtml={form.bodyHtml} />
          </div>
        </div>

        {/* Preview modal */}
        {showPreview && (
          <div style={{ position: "fixed", inset: 0, background: "#0009", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
            onClick={() => setShowPreview(false)}>
            <div style={{ background: "#fff", borderRadius: 16, padding: 32, maxWidth: 600, width: "90%", maxHeight: "80vh", overflowY: "auto" }}
              onClick={e => e.stopPropagation()}>
              <div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Subject</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#0f1a12", marginBottom: 16 }}>
                {form.subject.replace(/{{org_name}}/g, data?.org?.name || "Org").replace(/{{first_name}}/g, "Margaret")}
              </div>
              <hr style={{ border: "none", borderTop: "1px solid #e5e7eb", marginBottom: 16 }} />
              <div style={{ fontSize: 14, color: "#0f1a12", lineHeight: 1.8 }} dangerouslySetInnerHTML={{ __html: getPreviewHtml() }} />
              <div style={{ marginTop: 10, fontSize: 11, color: "#9ca3af" }}>Preview — merge tags replaced with sample data when sent.</div>
              <button onClick={() => setShowPreview(false)} style={{ marginTop: 16, ...S.btn("subtle") }}>Close</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Sidebar nav items ───────────────────────────────────────────────────────
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
    <div className="comm-layout" style={{ display: "flex", minHeight: 0 }}>
      {/* Sidebar */}
      <div className="comm-sidebar" style={{ width: S.sidebar.width, flexShrink: 0, background: S.sidebar.bg, borderRight: S.sidebar.borderRight, padding: "16px 0", display: "flex", flexDirection: "column", gap: 2 }}>
        <div className="comm-sidebar-label" style={{ padding: "0 14px 14px", fontSize: 11, fontWeight: 800, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.1em" }}>Email</div>
        {NAV.map(n => (
          <button key={n.id} onClick={() => setNav(n.id)}
            style={{
              display: "flex", alignItems: "center", gap: 10, padding: "9px 16px",
              background: nav === n.id ? "#1a6b4a" : "transparent",
              border: "none", borderRadius: 8, margin: "0 6px",
              color: nav === n.id ? "#fff" : T.ink3,
              fontSize: 13, fontWeight: nav === n.id ? 700 : 400,
              cursor: "pointer", textAlign: "left",
            }}>
            <span style={{ fontSize: 14, opacity: 0.7 }}>{n.icon}</span>
            {n.label}
            {n.id === "campaigns" && campaigns.length > 0 && (
              <span style={{ marginLeft: "auto", fontSize: 11, background: nav === n.id ? "#ffffff22" : T.bg3, borderRadius: 99, padding: "1px 7px", color: nav === n.id ? "#fff" : T.ink3 }}>{campaigns.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Main content */}
      <div className="comm-main" style={{ flex: 1, padding: 24, overflowY: "auto", minHeight: 0 }}>

        {/* CAN-SPAM postal-address prompt — terracotta = needs-attention */}
        {orgPostalAddress === null && (
          <div style={{ background: T.white, border: "1px solid " + T.bg3, borderLeft: "3px solid " + T.terracotta, borderRadius: 12, padding: "12px 16px", marginBottom: 18, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 320px", fontSize: 13, color: T.ink2, lineHeight: 1.45 }}>
              <span style={{ fontWeight: 800, color: T.ink }}>Add your mailing address. </span>
              Commercial email is required to include your organization's postal address (CAN-SPAM). Set it once under Settings → Tax Receipts and it appears in every campaign and sequence footer automatically{isAdmin ? "" : " — ask an admin to add it"}.
            </div>
            {isAdmin && onNavigate && (
              <button onClick={() => onNavigate("settings")} style={{ background: "transparent", border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 700, color: T.ink, cursor: "pointer", whiteSpace: "nowrap" }}>
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
                style={{ ...S.btn("primary"), background: newBtnHover && !isReadOnly ? "#0d9e6e" : T.green, cursor: isReadOnly?"not-allowed":"pointer", opacity: isReadOnly?0.45:1 }}>
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
                <div key={label} style={{ background: T.bg2, border: "1px solid #1a6b4a", borderRadius: 99, padding: "7px 16px", display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: T.ink3 }}>{label}</span>
                  <span style={{ fontSize: 14, fontWeight: 800, color: "#1a6b4a" }}>{value}</span>
                </div>
              ))}
            </div>

            {/* Send result toast */}
            {sendResult && (
              <div style={{ background: "#052e16", border: "1px solid " + T.green, borderRadius: 10, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: T.green, fontWeight: 700, fontSize: 14 }}>
                  {sendResult.queued
                    ? `✓ Queued — sending to ${sendResult.recipientCount} recipient${sendResult.recipientCount === 1 ? "" : "s"}`
                    : `✓ Sent to ${sendResult.sent} donors`}
                </span>
                <button onClick={() => setSendResult(null)} style={{ background: "transparent", border: "none", color: T.green, cursor: "pointer", fontSize: 20 }}>×</button>
              </div>
            )}

            {/* Campaign table */}
            {loading ? (
              <div style={{ color: T.ink3, fontSize: 13, padding: "40px 0", textAlign: "center" }}>Loading…</div>
            ) : campaigns.length === 0 ? (
              <div style={{ background: T.bg2, borderRadius: 12, padding: 40, textAlign: "center", color: T.ink3, fontSize: 14 }}>
                No campaigns yet. Create your first one above.
              </div>
            ) : (
              <div style={{ background: T.bg2, border: "1px solid " + T.bg3, borderRadius: 12, overflow: "hidden" }}>
                {/* Table header */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 140px 100px 70px 90px 100px 100px", padding: "10px 16px", background: "#0f1a12", fontSize: 10, fontWeight: 700, color: "#8fa896", textTransform: "uppercase", letterSpacing: "0.06em", gap: 8 }}>
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
                          <div style={{ fontSize: 13, fontWeight: 600, color: hoveredRowId === c.id ? "#1a6b4a" : T.ink, transition: "color 0.1s" }}>{c.name}</div>
                          <div style={{ fontSize: 11, color: T.ink3, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>{c.subject}</div>
                        </div>
                        <div style={{ fontSize: 11, color: T.ink3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{segLabel(raw)}</div>
                        <div><StatusBadge status={c.status} /></div>
                        <div style={{ fontSize: 13, color: T.ink }}>{sentCt > 0 ? sentCt.toLocaleString() : "—"}</div>
                        <div>
                          {sentCt > 0 ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: openRate >= 25 ? T.green : openRate >= 15 ? "#f59e0b" : T.ink3 }}>{openRate}%</span>
                              <div style={{ height: 3, background: T.bg3, borderRadius: 99 }}>
                                <div style={{ height: "100%", width: `${Math.min(openRate, 100)}%`, background: openRate >= 25 ? "#1a6b4a" : "#f59e0b", borderRadius: 99 }} />
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
                              style={{ background: "transparent", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 14, padding: "2px 4px", borderRadius: 4 }}>✕</button>
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
                              {[["Sent", sentCt, T.ink], ["Opened", openCt, T.green], ["Open Rate", openRate + "%", openRate >= 25 ? T.green : "#f59e0b"], ["Failed", recs.filter(r => r.failure_reason).length, "#ef4444"]].map(([lbl, val, col]) => (
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
                                  <span style={{ color: r.opened_at ? T.green : r.failure_reason ? "#ef4444" : r.sent_at ? T.ink3 : "#f59e0b" }}
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
            <p style={{ margin: 0, fontSize: 13, color: T.ink3 }}>One-click to load into the campaign builder with placeholder content.</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
              {TEMPLATES.map(t => (
                <div key={t.id} style={{ background: T.bg2, border: "1px solid " + T.bg3, borderRadius: 12, padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
                  {/* Thumbnail */}
                  <div style={{ background: T.bg3, borderRadius: 8, height: 100, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36 }}>
                    {t.emoji}
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>{t.name}</div>
                    <div style={{ fontSize: 11, color: T.ink3, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.subject}</div>
                  </div>
                  <button
                    onClick={() => {
                      setForm({ name: t.name, subject: t.subject, bodyHtml: t.body, seg: { mode: "all" }, scheduledAt: "" });
                      setEditingId(null);
                      setEditorKey(k => k + 1);
                      setAiDraft("");
                      setView("builder");
                    }}
                    style={S.btn("primary")}>
                    Use Template →
                  </button>
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
                <div style={{ display: "grid", gridTemplateColumns: "1fr 180px 110px 90px", padding: "9px 16px", background: "#1a6b4a", fontSize: 10, fontWeight: 700, color: "#fff", textTransform: "uppercase", letterSpacing: "0.06em", gap: 8 }}>
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
                { label: "Total Emails Sent", value: allTimeSent.toLocaleString() },
                { label: "Overall Open Rate",  value: overallRate + "%", note: "Industry avg ~20%" },
                { label: "Campaigns Sent",     value: sentCampaigns.length },
              ].map(({ label, value, note }) => (
                <div key={label} style={{ background: T.bg2, border: "1px solid " + T.bg3, borderRadius: 12, padding: 18 }}>
                  <div style={{ fontSize: 11, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{label}</div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: T.ink }}>{value}</div>
                  {note && <div style={{ fontSize: 11, color: T.ink3, marginTop: 4 }}>{note}</div>}
                </div>
              ))}
            </div>

            {/* Best campaign */}
            {bestCampaign && (
              <div style={{ background: "#10b98110", border: "1px solid #10b98130", borderRadius: 12, padding: 16, display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 24 }}>🏆</span>
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
                      <div style={{ fontSize: 16, fontWeight: 800, color: c.rate >= 25 ? T.green : "#f59e0b" }}>{c.rate}%</div>
                      <div style={{ height: 3, width: 60, background: T.bg3, borderRadius: 99, marginTop: 3 }}>
                        <div style={{ height: "100%", width: `${Math.min(c.rate, 100)}%`, background: c.rate >= 25 ? "#1a6b4a" : "#f59e0b", borderRadius: 99 }} />
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
