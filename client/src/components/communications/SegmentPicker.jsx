// communications/SegmentPicker.jsx · WHO A CAMPAIGN GOES TO: the kinds of audience, the label a
// campaign row shows for its segment, and the picker in the campaign editor's "Who it goes to".
// Moved out of Communications.jsx whole by CAMPAIGN-2 (which changed it: item 1, a new kind starts
// clean; item 2, the tiers are the giving levels).
import { useState, useEffect } from "react";
import { apiFetch } from "../../api";
import { T, activeMark, stageName } from "../shared";
import { ManualAudience } from "./ManualAudience";   // COMMS-SPEED-1: searched on the server

// ── Segment helpers ───────────────────────────────────────────────────────────
const STAGE_OPTS = ["prospect", "qualify", "cultivate", "solicit", "steward", "lapsed"];
// CAMPAIGN-2 item 2: the tiers are the giving levels, the one definition (server/outreach/campaignTiers.js).
const TIER_OPTS  = [{ id: "major", label: "Major" }, { id: "mid", label: "Mid" }, { id: "general", label: "General" }];
const tierName = k => (TIER_OPTS.find(t => t.id === k) || { label: k }).label;
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
  { id: "lapsed",      label: "Lapsing or lapsed" },
  { id: "byStage",     label: "By stage" },
  { id: "byTier",      label: "By tier" },
  { id: "manual",      label: "Manual" },
  // WIRE-1: any Group, kept by hand or by a rule. The server resolves it to
  // its members at send time (resolveSegmentSpec, mode "audience").
  { id: "audience",    label: "A group" },
];


export function segLabel(raw) {
  const mode = raw?.mode || "all";
  return {
    all:         "All donors with email",
    everyone:    "Everyone with an email address",
    volunteers:  "Volunteers with an email",
    staff_board: "Staff and board with an email",
    donors:      "Donors with an email",
    // SWEEP-3: Major is the giving level in Settings, never a fixed $10k; Lapsed
    // is the lapse rule Audience uses; a stage is its name, not its key.
    major:   "Major donors",
    lapsed:  "Lapsing or lapsed donors",
    byStage: `Stages: ${(raw?.stages || []).map(stageName).join(", ") || "none"}`,
    byTier:  `Giving levels: ${(raw?.tiers || []).map(tierName).join(", ") || "none"}`,
    manual:  `${(raw?.donorIds || []).length} manually selected`,
    audience: raw?.audienceName ? `The group ${raw.audienceName}` : "One group",
  }[mode] || "All donors with email";
}

// FIX-26 / EDITOR-1: who the segment holds and this send will not reach is
// the server's one answer (segment-preview `audience`), shown by CampaignEditor's
// AudienceLine as one line whose counts add up to the segment.
// ── SegmentPicker (module-level) ──────────────────────────────────────────────
export function SegmentPicker({ seg, onChange, tierSentence }) {
  const mode = seg.mode || "all";
  const upd  = p => onChange({ ...seg, ...p });
  // CAMPAIGN-2 item 1: a new kind of audience starts clean. "All donors" after "By stage >
  // Lapsed" kept the stage and the count stayed at 281; only her never-given tick carries over.
  const pickMode = m => onChange({ mode: m, ...(seg.includeNeverGiven ? { includeNeverGiven: true } : {}) });
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
        {/* SWEEP-3: "Donors" is the same people as "All donors" (the server
            resolves both to every donor), so it is offered only to a campaign
            that already uses it. */}
        {SEG_MODES.filter(m => m.id !== "donors" || mode === "donors").map(m => (
          <button key={m.id} type="button" data-testid={"segment-mode-" + m.id} onClick={() => { if (m.id !== mode) pickMode(m.id); }}
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
              {stageName(s)}
            </button>
          ))}
        </div>
      )}
      {mode === "byTier" && (
        <div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {TIER_OPTS.map(t => (
              <button key={t.id} type="button" data-testid={"segment-tier-" + t.id} aria-pressed={(seg.tiers || []).includes(t.id)} onClick={() => tog("tiers", t.id)}
                style={{ background: (seg.tiers || []).includes(t.id) ? T.green100 : T.bg2, border: "1px solid " + ((seg.tiers || []).includes(t.id) ? T.greenDk : T.bg3), borderRadius: 99, padding: "4px 10px", fontSize: 11, color: (seg.tiers || []).includes(t.id) ? T.greenDk : T.ink3, cursor: "pointer" }}>
                {t.label}
              </button>
            ))}
          </div>
          {tierSentence && <div data-testid="segment-tier-sentence" style={{ marginTop: 6, fontSize: 12, color: T.ink3, lineHeight: 1.5 }}>{tierSentence}</div>}
        </div>
      )}
      {mode === "audience" && (
        <select aria-label="Which group" data-testid="segment-group" value={seg.audienceId || ""}
          onChange={e => {
            const v = e.target.value;
            if (v.startsWith("mode:")) { onChange({ mode: v.slice(5) }); return; }
            const g = (groups || []).find(x => x.id === v); upd({ audienceId: v || undefined, audienceName: g ? g.name : undefined }); }}
          style={{ border: "1px solid " + T.bg3, borderRadius: 7, padding: "6px 10px", fontSize: 12.5, color: T.ink, background: T.white, maxWidth: 320 }}>
          <option value="">{groups === null ? "Loading your groups…" : groups.length ? "Choose a group" : "No groups yet"}</option>
          {/* TRUST-1: the picker offers the org's donors, not only its groups
              (a walk org whose one group was Volunteers saw nothing else). */}
          <optgroup label="Your donors">
            {SEG_MODES.filter(m => ["all", "everyone", "lapsed", "major"].includes(m.id)).map(m =>
              <option key={"mode:" + m.id} value={"mode:" + m.id}>{m.label}</option>)}
          </optgroup>
          {(groups || []).length > 0 && <optgroup label="Your groups">
            {(groups || []).map(g => <option key={g.id} value={g.id}>{g.name}{g.kind === "dynamic" ? " (by rule)" : ""}{typeof g.count === "number" ? ` · ${g.count.toLocaleString()}` : ""}</option>)}
          </optgroup>}
        </select>
      )}
      {mode === "manual" && <ManualAudience ids={seg.donorIds} onToggle={id => tog("donorIds", id)} />}
    </div>
  );
}

