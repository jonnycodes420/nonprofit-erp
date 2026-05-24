import { useState, useEffect, useRef } from "react";
import { apiFetch } from "../api";
import { useAuth } from "../main";
import { T, askClaude, Spin, Pill, Card, SectionLabel, AIBtn, PageTitle } from "./shared";

// ── Module-level components: inputs/contenteditable must not live inside render ──

function RichEditor({ editorRef, initialHtml }) {
  useEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = initialHtml || "";
  }, []); // only on mount; parent uses key prop to reset

  const exec = (cmd, val) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, val ?? undefined);
  };

  const TAGS = [
    ["{{first_name}}", "First name"],
    ["{{last_name}}", "Last name"],
    ["{{org_name}}", "Org name"],
    ["{{gift_amount}}", "Last gift $"],
    ["{{total_giving}}", "Total giving"],
  ];

  const TBtn = ({ cmd, val, children }) => (
    <button
      onMouseDown={e => { e.preventDefault(); exec(cmd, val); }}
      style={{ background: "transparent", border: "1px solid " + T.bg3, borderRadius: 5, padding: "3px 7px", color: T.ink2, fontSize: 12, fontWeight: 700, cursor: "pointer" }}
    >{children}</button>
  );

  return (
    <div>
      <div style={{ display: "flex", gap: 4, padding: "6px 8px", background: T.bg2, border: "1px solid " + T.bg3, borderRadius: "8px 8px 0 0", flexWrap: "wrap", alignItems: "center" }}>
        <TBtn cmd="bold"><b>B</b></TBtn>
        <TBtn cmd="italic"><em>I</em></TBtn>
        <TBtn cmd="underline"><u>U</u></TBtn>
        <TBtn cmd="formatBlock" val="h2">H2</TBtn>
        <TBtn cmd="formatBlock" val="p">¶</TBtn>
        <button
          onMouseDown={e => { e.preventDefault(); const url = window.prompt("Enter URL:"); if (url) exec("createLink", url); }}
          style={{ background: "transparent", border: "1px solid " + T.bg3, borderRadius: 5, padding: "3px 7px", color: T.ink2, fontSize: 12, cursor: "pointer" }}
        >Link</button>
        <div style={{ width: 1, height: 16, background: T.bg3, alignSelf: "center", margin: "0 3px" }} />
        <span style={{ fontSize: 10, color: T.ink3, marginRight: 2 }}>Insert:</span>
        {TAGS.map(([tag, label]) => (
          <button key={tag} title={label}
            onMouseDown={e => { e.preventDefault(); editorRef.current?.focus(); document.execCommand("insertText", false, tag); }}
            style={{ background: "#10b98118", border: "1px solid #10b98140", borderRadius: 4, padding: "2px 6px", fontSize: 10, color: "#10b981", cursor: "pointer" }}>
            {tag}
          </button>
        ))}
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        style={{
          minHeight: 220, padding: "12px 14px", background: T.bg,
          border: "1px solid " + T.bg3, borderRadius: "0 0 8px 8px",
          color: T.ink, fontSize: 13, lineHeight: 1.8, outline: "none",
        }}
      />
    </div>
  );
}

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

function SegmentPicker({ seg, onChange, allDonors }) {
  const mode = seg.mode || "all";
  const upd  = p => onChange({ ...seg, ...p });
  const tog  = (key, val) => {
    const arr = seg[key] || [];
    upd({ [key]: arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val] });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {SEG_MODES.map(m => (
          <button key={m.id} onClick={() => upd({ mode: m.id })}
            style={{
              background: mode === m.id ? "#10b981" : T.bg2,
              border: "1px solid " + (mode === m.id ? "#10b981" : T.bg3),
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
              style={{ background: (seg.stages||[]).includes(s) ? "#8b5cf6" : T.bg2, border: "none", borderRadius: 99, padding: "4px 10px", fontSize: 11, color: (seg.stages||[]).includes(s) ? "#fff" : T.ink3, cursor: "pointer" }}>
              {s}
            </button>
          ))}
        </div>
      )}
      {mode === "byTier" && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {TIER_OPTS.map(t => (
            <button key={t} onClick={() => tog("tiers", t)}
              style={{ background: (seg.tiers||[]).includes(t) ? "#f59e0b" : T.bg2, border: "none", borderRadius: 99, padding: "4px 10px", fontSize: 11, color: (seg.tiers||[]).includes(t) ? "#fff" : T.ink3, cursor: "pointer" }}>
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
                <input type="checkbox" checked={(seg.donorIds||[]).includes(d.id)} onChange={() => tog("donorIds", d.id)} style={{ accentColor: "#10b981" }} />
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

const BLANK = { name: "", subject: "", bodyHtml: "", seg: { mode: "all" }, scheduledAt: "" };

export function Communications({ data }) {
  const { auth } = useAuth();
  const isAdmin = auth?.user?.role === "admin";

  const [view, setView]             = useState("list");
  const [campaigns, setCampaigns]   = useState([]);
  const [loading, setLoading]       = useState(true);
  const [form, setForm]             = useState(BLANK);
  const [editingId, setEditingId]   = useState(null);
  const [allDonors, setAllDonors]   = useState([]);
  const [sending, setSending]       = useState(false);
  const [sendResult, setSendResult] = useState(null);
  const [aiLoading, setAiLoading]   = useState(false);
  const [aiDraft, setAiDraft]       = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [showPreview, setShowPreview] = useState(false);

  const editorRef            = useRef(null);
  const [editorKey, setEditorKey] = useState(0);

  const loadCampaigns = async () => {
    try { setCampaigns(await apiFetch("/campaigns")); }
    catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { loadCampaigns(); }, []);

  const loadDonors = async () => {
    if (allDonors.length) return;
    try { setAllDonors(await apiFetch("/donors")); }
    catch (e) { console.error(e); }
  };

  const openBuilder = (campaign = null) => {
    if (campaign) {
      const raw = typeof campaign.segment === "string"
        ? JSON.parse(campaign.segment || "{}")
        : (campaign.segment || {});
      const mode = raw.mode || (raw.stages?.length ? "byStage" : raw.statuses?.length ? "byStage" : "all");
      setForm({
        name: campaign.name || "",
        subject: campaign.subject || "",
        bodyHtml: campaign.body || "",
        seg: { mode, stages: raw.stages || [], tiers: raw.tiers || [], donorIds: raw.donorIds || [] },
        scheduledAt: campaign.scheduled_at
          ? new Date(campaign.scheduled_at).toISOString().slice(0, 16)
          : "",
      });
      setEditingId(campaign.id);
    } else {
      setForm(BLANK);
      setEditingId(null);
    }
    setEditorKey(k => k + 1);
    setAiDraft("");
    setView("builder");
  };

  const saveDraft = async () => {
    if (!form.name.trim()) return alert("Campaign name is required.");
    const body = editorRef.current?.innerHTML || "";
    const payload = { name: form.name, subject: form.subject, body, segment: form.seg, status: "draft" };
    try {
      if (editingId) await apiFetch(`/campaigns/${editingId}`, { method: "PUT", body: JSON.stringify(payload) });
      else await apiFetch("/campaigns", { method: "POST", body: JSON.stringify(payload) });
      await loadCampaigns();
      setView("list");
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
      await loadCampaigns();
      setView("list");
    } catch (e) { alert(e.message); }
  };

  const sendNow = async (directId) => {
    let id = directId;
    if (!id) {
      if (!form.name.trim()) return alert("Campaign name is required.");
      const body = editorRef.current?.innerHTML || "";
      const payload = { name: form.name, subject: form.subject, body, segment: form.seg, status: "draft" };
      try {
        if (editingId) {
          await apiFetch(`/campaigns/${editingId}`, { method: "PUT", body: JSON.stringify(payload) });
          id = editingId;
        } else {
          const saved = await apiFetch("/campaigns", { method: "POST", body: JSON.stringify(payload) });
          id = saved.id;
        }
      } catch (e) { alert(e.message); return; }
    }
    if (!window.confirm("Send this campaign now? This will send real emails.")) return;
    setSending(true); setSendResult(null);
    try {
      const r = await apiFetch(`/campaigns/${id}/send`, { method: "POST" });
      setSendResult(r);
      await loadCampaigns();
      setView("list");
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
      `Write a donor email for ${data.org.name}.\nMission: ${data.org.mission}\nSegment: ${JSON.stringify(form.seg)}\nSubject hint: ${form.subject || "(generate a compelling one)"}\n\nUse these merge tags where natural: {{first_name}}, {{org_name}}, {{gift_amount}}, {{total_giving}}\n\nFormat — first line: "Subject: [subject line]", blank line, then the email body using HTML <p> tags. Be personal and mission-driven.`,
      chunk => setAiDraft(chunk)
    );
    setAiLoading(false);
  };

  const applyAIDraft = () => {
    const lines = aiDraft.split("\n");
    const subjLine = lines.find(l => l.startsWith("Subject:"));
    const bodyText = lines.filter(l => !l.startsWith("Subject:")).join("\n").trim();
    if (subjLine) setForm(f => ({ ...f, subject: subjLine.replace("Subject:", "").trim() }));
    if (editorRef.current) {
      const html = bodyText.startsWith("<")
        ? bodyText
        : bodyText.split(/\n\n+/).map(p => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");
      editorRef.current.innerHTML = html;
    }
    setAiDraft("");
  };

  const getPreviewHtml = () => {
    const html = editorRef.current?.innerHTML || form.bodyHtml || "";
    return html
      .replace(/{{first_name}}/g,   "Margaret")
      .replace(/{{last_name}}/g,    "Chen")
      .replace(/{{donor_name}}/g,   "Margaret Chen")
      .replace(/{{org_name}}/g,     data?.org?.name || "Org")
      .replace(/{{gift_amount}}/g,  "$5,000")
      .replace(/{{total_giving}}/g, "$24,500")
      .replace(/{{year}}/g,         String(new Date().getFullYear()));
  };

  const stripHtml = html => (html || "").replace(/<[^>]+>/g, "");

  // ── Builder view ─────────────────────────────────────────────────────────
  if (view === "builder") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => setView("list")}
            style={{ background: "transparent", border: "none", color: T.ink3, cursor: "pointer", fontSize: 13, padding: 0 }}>
            ← Back
          </button>
          <PageTitle main={editingId ? "Edit" : "New"} accent="Campaign" />
        </div>

        <Card style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {[["Campaign Name", "name", "Spring Appeal 2026"], ["Subject Line", "subject", "A message from {{org_name}}"]].map(([lbl, key, ph]) => (
              <div key={key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 11, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.06em" }}>{lbl}</label>
                <input value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} placeholder={ph}
                  style={{ background: T.bg, border: "1px solid " + T.bg3, borderRadius: 8, padding: "9px 12px", color: T.ink, fontSize: 13, outline: "none" }} />
              </div>
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.06em" }}>Email Body</label>
            <RichEditor key={editorKey} editorRef={editorRef} initialHtml={form.bodyHtml} />
          </div>

          <div>
            <SectionLabel>Audience Segment</SectionLabel>
            <SegmentPicker
              seg={form.seg}
              onChange={seg => { setForm(f => ({ ...f, seg })); if (seg.mode === "manual") loadDonors(); }}
              allDonors={allDonors}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.06em" }}>Schedule for later (optional)</label>
            <input type="datetime-local" value={form.scheduledAt}
              onChange={e => setForm(f => ({ ...f, scheduledAt: e.target.value }))}
              style={{ background: T.bg, border: "1px solid " + T.bg3, borderRadius: 8, padding: "9px 12px", color: T.ink, fontSize: 13, outline: "none", width: 240 }} />
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <AIBtn onClick={draftAI} loading={aiLoading} label="✦ AI Draft" small />
            <button onClick={() => setShowPreview(true)}
              style={{ background: "transparent", border: "1px solid " + T.bg3, borderRadius: 8, padding: "9px 14px", color: T.ink2, fontSize: 13, cursor: "pointer" }}>
              Preview
            </button>
            <button onClick={saveDraft}
              style={{ background: T.bg2, border: "1px solid " + T.bg3, borderRadius: 8, padding: "9px 16px", color: T.ink, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
              Save Draft
            </button>
            {form.scheduledAt && (
              <button onClick={scheduleIt}
                style={{ background: "#f59e0b", border: "none", borderRadius: 8, padding: "9px 16px", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                ⏰ Schedule
              </button>
            )}
            {isAdmin && (
              <button onClick={() => sendNow(null)} disabled={sending}
                style={{ background: sending ? T.bg3 : "#10b981", border: "none", borderRadius: 8, padding: "9px 16px", color: "#fff", fontSize: 13, fontWeight: 700, cursor: sending ? "not-allowed" : "pointer" }}>
                {sending ? <><Spin /> Sending…</> : "↑ Send Now"}
              </button>
            )}
          </div>

          {aiDraft && (
            <div style={{ background: T.bg, border: "1px solid #10b98144", borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#8b5cf6", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>✦ AI Draft</div>
              <div style={{ fontSize: 13, color: T.ink2, lineHeight: 1.75, whiteSpace: "pre-wrap", marginBottom: 12 }}>{aiDraft}</div>
              <button onClick={applyAIDraft}
                style={{ background: "#10b981", border: "none", borderRadius: 8, padding: "8px 14px", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                Apply to editor
              </button>
            </div>
          )}
        </Card>

        {showPreview && (
          <div style={{ position: "fixed", inset: 0, background: "#0008", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
            onClick={() => setShowPreview(false)}>
            <div style={{ background: "#fff", borderRadius: 16, padding: 32, maxWidth: 600, width: "90%", maxHeight: "80vh", overflowY: "auto" }}
              onClick={e => e.stopPropagation()}>
              <div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Subject</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#0f0f0f", marginBottom: 16 }}>
                {form.subject.replace(/{{org_name}}/g, data?.org?.name || "Org").replace(/{{first_name}}/g, "Margaret")}
              </div>
              <hr style={{ border: "none", borderTop: "1px solid #e5e7eb", marginBottom: 16 }} />
              <div style={{ fontSize: 14, color: "#0f0f0f", lineHeight: 1.8 }} dangerouslySetInnerHTML={{ __html: getPreviewHtml() }} />
              <div style={{ marginTop: 8, fontSize: 11, color: "#9ca3af" }}>Sample data — merge tags replaced with real values when sent.</div>
              <button onClick={() => setShowPreview(false)}
                style={{ marginTop: 16, background: "#f3f0e9", border: "none", borderRadius: 8, padding: "9px 16px", color: "#0f0f0f", fontSize: 13, cursor: "pointer" }}>
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── List view ─────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageTitle main="Email" accent="campaigns." />

      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={() => openBuilder()}
          style={{ background: "#10b981", border: "none", borderRadius: 10, padding: "10px 16px", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
          + New Campaign
        </button>
      </div>

      {sendResult && (
        <div style={{ background: "#052e16", border: "1px solid #10b981", borderRadius: 12, padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: "#10b981", fontWeight: 700, fontSize: 14 }}>
            {sendResult.queued
              ? `✓ Queued — sending to ${sendResult.recipientCount} recipient${sendResult.recipientCount === 1 ? "" : "s"}`
              : `✓ Sent to ${sendResult.sent} donors${sendResult.failed ? ` (${sendResult.failed} failed)` : ""}`}
          </span>
          <button onClick={() => setSendResult(null)} style={{ background: "transparent", border: "none", color: "#10b981", cursor: "pointer", fontSize: 20 }}>×</button>
        </div>
      )}

      {loading ? (
        <div style={{ color: T.ink3, fontSize: 13, textAlign: "center", padding: 40 }}>Loading campaigns…</div>
      ) : campaigns.length === 0 ? (
        <Card><div style={{ color: T.ink3, fontSize: 13, textAlign: "center", padding: 24 }}>No campaigns yet. Create your first campaign above.</div></Card>
      ) : campaigns.map(c => {
        const isOpen = expandedId === c.id;
        const recs = c.recipients || [];
        const openCt = recs.filter(r => r.opened_at).length || c.open_count || 0;
        const sentCt = c.recipient_count || recs.filter(r => r.sent_at).length || 0;
        const openRate = sentCt > 0 ? Math.round(openCt / sentCt * 100) : 0;
        const statColor = { draft: "#8b5cf6", scheduled: "#f59e0b", sent: "#10b981", sending: "#3b82f6" }[c.status] || T.ink3;
        const raw = typeof c.segment === "string" ? JSON.parse(c.segment || "{}") : (c.segment || {});
        const segLabel = {
          all:     "All donors with email",
          major:   "Major donors (>$10k)",
          lapsed:  "Lapsed donors",
          byStage: `Stages: ${(raw.stages||[]).join(", ") || "none"}`,
          byTier:  `Capacity tiers: ${(raw.tiers||[]).join(", ") || "none"}`,
          manual:  `${(raw.donorIds||[]).length} manually selected`,
        }[raw.mode || "all"] || "All donors with email";

        return (
          <Card key={c.id} onClick={() => setExpandedId(isOpen ? null : c.id)} style={{ cursor: "pointer" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>{c.name}</div>
                <div style={{ fontSize: 12, color: T.ink3, marginTop: 2 }}>{c.subject}</div>
                {c.status === "scheduled" && c.scheduled_at && (
                  <div style={{ fontSize: 11, color: "#f59e0b", marginTop: 3 }}>⏰ {new Date(c.scheduled_at).toLocaleString()}</div>
                )}
                {c.status === "sending" && (
                  <div style={{ fontSize: 11, color: "#3b82f6", marginTop: 3, display: "flex", alignItems: "center", gap: 4 }}><Spin />Sending in background…</div>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                <Pill label={c.status} color={statColor} />
                {c.status === "sent" && (
                  <div style={{ fontSize: 12, color: T.ink }}>
                    <b>{sentCt}</b> sent · <b style={{ color: openRate >= 25 ? "#10b981" : "#f59e0b" }}>{openRate}%</b> opened
                  </div>
                )}
                {c.sent_at && <div style={{ fontSize: 11, color: T.ink3 }}>{new Date(c.sent_at).toLocaleDateString()}</div>}
              </div>
            </div>

            {c.status === "sent" && sentCt > 0 && (
              <div style={{ marginTop: 10, height: 3, background: T.bg3, borderRadius: 99 }}>
                <div style={{ height: "100%", width: `${openRate}%`, background: "#10b981", borderRadius: 99 }} />
              </div>
            )}

            {isOpen && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid " + T.bg3 }} onClick={e => e.stopPropagation()}>
                {c.status === "sent" ? (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 16 }}>
                      {[["Sent", sentCt, T.ink], ["Opened", openCt, "#10b981"], ["Open Rate", openRate + "%", openRate >= 25 ? "#10b981" : "#f59e0b"]].map(([lbl, val, col]) => (
                        <div key={lbl} style={{ background: T.bg2, borderRadius: 10, padding: "12px 14px" }}>
                          <div style={{ fontSize: 10, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.06em" }}>{lbl}</div>
                          <div style={{ fontSize: 22, fontWeight: 800, color: col, marginTop: 4 }}>{val}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ fontSize: 11, color: T.ink3, marginBottom: 10 }}>Segment: {segLabel}</div>
                    {recs.length > 0 && (
                      <div style={{ border: "1px solid " + T.bg3, borderRadius: 8, overflow: "hidden" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 80px", padding: "7px 12px", background: T.bg2, fontSize: 10, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.06em", gap: 8 }}>
                          <span>Recipient</span><span>Status</span><span>Time</span>
                        </div>
                        {recs.slice(0, 20).map(r => (
                          <div key={r.id} style={{ display: "grid", gridTemplateColumns: "1fr 80px 80px", padding: "8px 12px", borderTop: "1px solid " + T.bg2, fontSize: 12, gap: 8 }}>
                            <span style={{ color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.donor_name || r.email}</span>
                            <span style={{ color: r.opened_at ? "#10b981" : r.sent_at ? T.ink3 : "#f59e0b" }}>
                              {r.opened_at ? "Opened" : r.sent_at ? "Delivered" : "Pending"}
                            </span>
                            <span style={{ color: T.ink3, fontSize: 11 }}>
                              {r.opened_at
                                ? new Date(r.opened_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                                : r.sent_at
                                  ? new Date(r.sent_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                                  : "—"}
                            </span>
                          </div>
                        ))}
                        {recs.length > 20 && (
                          <div style={{ padding: "8px 12px", fontSize: 11, color: T.ink3, borderTop: "1px solid " + T.bg2 }}>
                            +{recs.length - 20} more
                          </div>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 11, color: T.ink3, marginBottom: 10 }}>Segment: {segLabel}</div>
                    <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.6, marginBottom: 12, borderLeft: "3px solid " + T.bg3, paddingLeft: 10, fontStyle: "italic" }}>
                      {stripHtml(c.body || "").slice(0, 200)}{stripHtml(c.body || "").length > 200 ? "…" : ""}
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button onClick={() => openBuilder(c)}
                        style={{ background: T.bg2, border: "1px solid " + T.bg3, borderRadius: 8, padding: "8px 14px", color: T.ink, fontSize: 13, cursor: "pointer" }}>
                        Edit
                      </button>
                      {isAdmin && (
                        <>
                          <button onClick={() => sendNow(c.id)} disabled={sending || c.status === "sending"}
                            style={{ background: (sending || c.status === "sending") ? T.bg3 : "#10b981", border: "none", borderRadius: 8, padding: "8px 14px", color: "#fff", fontSize: 13, fontWeight: 700, cursor: (sending || c.status === "sending") ? "not-allowed" : "pointer" }}>
                            {sending ? <><Spin />Sending…</> : "↑ Send Now"}
                          </button>
                          <button onClick={() => { if (window.confirm(`Delete "${c.name}"?`)) deleteCampaign(c.id); }}
                            style={{ background: "transparent", border: "1px solid #ef4444", borderRadius: 8, padding: "8px 14px", color: "#ef4444", fontSize: 13, cursor: "pointer" }}>
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
