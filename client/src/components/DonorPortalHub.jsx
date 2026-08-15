// BUILD-54 §3 — Donor Portal as a FIRST-CLASS CRM section (a headline
// differentiator, not a Settings tab). One home: portal status + live link,
// theme/branding, impact updates, campaign donor-facing content, and the
// existing quiet engagement signals (portal_audit_log — no new tracking).
// Settings' old Donor Portal tab is a pointer here; the theme/impact editors
// themselves still live in Settings.jsx as exported components (one
// implementation, one rendered home).
//
// §6 note on the two primary actions: "Open the live portal" NAVIGATES, so it
// stays a semantic <a> styled as a button (middle-click / open-in-new-tab /
// screen readers keep working). Edit mode (§4) lands here in the next stage.
import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { T, PageTitle, SectionLabel, Pill } from "./shared";
import { PortalManager, ImpactUpdatesManager } from "./Settings";

const btnPrimary = { display: "inline-block", background: T.gold500, border: "none", borderRadius: 9, padding: "10px 18px", color: T.ink, fontSize: 13, fontWeight: 700, cursor: "pointer", textDecoration: "none" };
const card = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "24px 28px", marginBottom: 18 };

function EngagementCard() {
  const [d, setD] = useState(null);
  useEffect(() => { apiFetch("/portal-engagement").then(setD).catch(() => setD({ error: true })); }, []);
  if (!d || d.error) return null;
  const stats = [
    ["Sign-ins", d.counts?.session_created || 0],
    ["Dashboard views", d.counts?.dashboard_viewed || 0],
    ["Impact views", d.counts?.impact_view || 0],
    ["Receipt downloads", d.counts?.receipt_downloaded || 0],
  ];
  return (
    <div style={card}>
      <SectionLabel>Engagement — last 30 days</SectionLabel>
      <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 6, marginBottom: 14, lineHeight: 1.5 }}>
        The portal's quiet signals — who's signing in and what they look at. Individual visits also land
        on each donor's timeline; nothing here is new tracking.
      </div>
      <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
        {stats.map(([label, n]) => (
          <div key={label}>
            <div style={{ fontSize: 22, fontWeight: 700, color: T.ink }}>{n}</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
          </div>
        ))}
      </div>
      {(d.recent || []).length > 0 && (
        <div style={{ marginTop: 14, borderTop: "1px solid " + T.bg3, paddingTop: 10 }}>
          {d.recent.slice(0, 6).map((r, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: T.ink2, padding: "4px 0" }}>
              <span>{r.donorName || r.email || "A donor"} · {String(r.action).replace(/_/g, " ")}</span>
              <span style={{ color: T.ink3 }}>{String(r.createdAt).slice(0, 10)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CampaignContentCard({ onNavigate }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { apiFetch("/fundraising/campaigns").then(setRows).catch(() => setRows([])); }, []);
  if (!rows) return null;
  const withContent = rows.filter(c => c.donorDescription || c.donorStory || c.heroImageUrl);
  return (
    <div style={card}>
      <SectionLabel>Campaign stories</SectionLabel>
      <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 6, marginBottom: 14, lineHeight: 1.5, maxWidth: 560 }}>
        A gift attributed to a campaign shows that campaign's name in the donor's history — and its story,
        photo, and updates when you've written them. {rows.length === 0
          ? "Create a campaign in Fundraising to get started."
          : `${withContent.length} of ${rows.length} campaign${rows.length === 1 ? "" : "s"} ${withContent.length === 1 ? "has" : "have"} donor-facing content.`}
      </div>
      <button onClick={() => onNavigate && onNavigate("fundraising")} style={btnPrimary}>
        Edit campaign stories in Fundraising →
      </button>
    </div>
  );
}

export function DonorPortalHub({ auth, isReadOnly, onNavigate }) {
  const isAdmin = (auth?.user?.role || "staff") === "admin";
  const [ps, setPs] = useState(null);
  useEffect(() => { apiFetch("/portal-settings").then(setPs).catch(() => setPs(null)); }, []);

  return (
    <div>
      <PageTitle main="Donor" accent="Portal" />
      {/* Status + the two prominent actions (§3) */}
      <div style={{ ...card, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 14 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>Your donor portal</span>
            {ps && <Pill label={ps.enabled ? "Live" : "Off"} color={ps.enabled ? T.greenDk : T.ink3} />}
          </div>
          {ps?.enabled && ps?.portal_url && (
            <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 4 }}>{ps.portal_url}</div>
          )}
          {ps && !ps.enabled && (
            <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 4 }}>Turn it on below — donors sign in by email link, no password to manage.</div>
          )}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {/* Navigation → semantic anchor styled as a button (§6 caveat). */}
          {ps?.enabled && ps?.portal_url && (
            <a href={ps.portal_url} target="_blank" rel="noreferrer" style={btnPrimary}>Open the live portal ↗</a>
          )}
        </div>
      </div>

      <CampaignContentCard onNavigate={onNavigate} />
      <div style={{ marginBottom: 18 }}>
        <PortalManager isAdmin={isAdmin} isReadOnly={isReadOnly} />
      </div>
      <div style={{ marginBottom: 18 }}>
        <ImpactUpdatesManager isAdmin={isAdmin} isReadOnly={isReadOnly} />
      </div>
      <EngagementCard />
    </div>
  );
}
