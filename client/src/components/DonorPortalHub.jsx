// BUILD-54 §3 — Donor Portal as a FIRST-CLASS CRM section (a headline
// differentiator, not a Settings tab). The tab is now SLIM: status +
// links-as-buttons, engagement, impact updates, campaign donor-facing
// content, and the button into edit mode. Everything appearance/content-
// editable (the old Settings portal form) moved INTO the in-portal
// editor's Design mode (/portal-editor) — edit what you see, where you see
// it. Every field has exactly ONE home: this tab keeps only the status/
// listing switches (enabled, network_listed + the directory card), which are
// about being live and findable, not about how the page looks.
//
// §6 note on the primary actions: they NAVIGATE, so they stay semantic <a>
// styled as buttons (middle-click / open-in-new-tab / screen readers keep
// working). No raw URL renders as text anywhere here — links are labeled
// buttons, plus a Copy-link button for sharing.
import { useState, useEffect, useRef } from "react";
import { apiFetch } from "../api";
import { T, PageTitle, SectionLabel, Pill } from "./shared";
import { ImpactUpdatesManager, PortalWebsiteSnippetCard } from "./Settings";

const btnPrimary = { display: "inline-block", background: T.gold500, border: "none", borderRadius: 9, padding: "10px 18px", color: T.ink, fontSize: 13, fontWeight: 700, cursor: "pointer", textDecoration: "none" };
const btnSecondary = { ...btnPrimary, background: T.bg2, border: "1px solid " + T.bg3 };
const card = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "24px 28px", marginBottom: 18 };
const lbl = { fontSize: 11, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 };
const inp = { width: "100%", boxSizing: "border-box", background: T.bg, border: "1px solid " + T.bg3, borderRadius: 8, padding: "9px 12px", color: T.ink, fontSize: 13, outline: "none", fontFamily: "inherit" };

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
  const disabled = !isAdmin || isReadOnly;
  const [ps, setPs] = useState(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState("");
  const psRef = useRef(null);          // latest ps, updated synchronously on edit
  const dirSaveTimer = useRef(null);   // debounce for the directory text fields
  useEffect(() => {
    apiFetch("/portal-settings").then(d => { psRef.current = d; setPs(d); }).catch(() => setPs(null));
  }, []);

  // The Hub owns ONLY status/listing fields; the server PUT treats missing
  // fields as no-change (each is guarded `!== undefined`), so we send only
  // what this surface edits — never the theme/page fields the editor owns.
  async function putFields(fields) {
    setErr("");
    try {
      const res = await apiFetch("/portal-settings", { method: "PUT", body: JSON.stringify(fields) });
      const next = { ...psRef.current, ...res };
      delete next.adjusted; delete next.message;
      psRef.current = next; setPs(next);
    } catch (e) { setErr(e.message || "Could not save."); }
  }
  const setToggle = (col, apiKey, v) => {
    if (disabled) return;
    psRef.current = { ...psRef.current, [col]: v };
    setPs(psRef.current);
    putFields({ [apiKey]: v });
  };
  const setListing = (col, v) => {
    if (disabled) return;
    psRef.current = { ...psRef.current, [col]: v };
    setPs(psRef.current);
    if (dirSaveTimer.current) clearTimeout(dirSaveTimer.current);
    dirSaveTimer.current = setTimeout(() => {
      const p = psRef.current;
      putFields({
        directoryDescription: p.directory_description || "",
        directoryCity: p.directory_city || "",
        directoryState: p.directory_state || "",
      });
    }, 800);
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(psRef.current?.portal_url || "");
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked — the Open button still carries the link */ }
  };

  return (
    <div>
      <PageTitle main="Donor" accent="Portal" />
      {/* Status + the prominent actions (§3). The enabled/listing switches
          live here (status, not appearance); everything visual is edited
          inside the portal editor's Design mode. */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 14 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>Your donor portal</span>
              {ps && <Pill label={ps.enabled ? "Live" : "Off"} color={ps.enabled ? T.greenDk : T.ink3} />}
            </div>
            {ps && !ps.enabled && (
              <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 4 }}>Turn it on — donors sign in by email link, no password to manage.</div>
            )}
            {ps?.enabled && (
              <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 4 }}>The page, theme, and details are all edited inside the portal itself.</div>
            )}
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {/* Navigation → semantic anchors styled as buttons (§6 caveat).
                Edit mode (§4) rides the existing staff session — the editor
                renders SAMPLE donor data only, never a real donor's. */}
            {isAdmin && <a href="/portal-editor" style={btnPrimary}>Edit the portal</a>}
            {ps?.enabled && ps?.portal_url && (
              <a href={ps.portal_url} target="_blank" rel="noreferrer" style={btnSecondary}>Open the live portal ↗</a>
            )}
            {ps?.enabled && ps?.portal_url && (
              <button onClick={copyLink} style={btnSecondary}>{copied ? "Copied ✓" : "Copy link"}</button>
            )}
          </div>
        </div>

        {ps && (
          <div style={{ marginTop: 18, borderTop: "1px solid " + T.bg3, paddingTop: 16 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600, color: T.ink, cursor: disabled ? "not-allowed" : "pointer", marginBottom: 12 }}>
              <input type="checkbox" checked={ps.enabled === true} disabled={disabled} onChange={e => setToggle("enabled", "enabled", e.target.checked)} />
              Portal is {ps.enabled ? "ON" : "OFF"}
            </label>
            {/* BUILD-46 §2.2 — donor-dashboard listing. Off by default for
                existing orgs; entirely separate from the portal itself. */}
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: T.ink3, cursor: disabled ? "not-allowed" : "pointer", lineHeight: 1.5 }}>
              <input type="checkbox" checked={ps.network_listed === true} disabled={disabled} onChange={e => setToggle("network_listed", "networkListed", e.target.checked)} />
              List this organization in donor dashboards (donors who verify an email you have on file see their giving with you alongside their other giving; you see nothing new).
            </label>
            {/* BUILD-47 — the directory card donors see when they SEARCH for
                you. Only shown while listed; reveals only what you type. */}
            {ps.network_listed === true && (
              <div style={{ background: T.bg, border: "1px solid " + T.bg3, borderRadius: 10, padding: "14px 16px", marginTop: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: T.ink, marginBottom: 4 }}>Your directory listing</div>
                <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.5, marginBottom: 10 }}>
                  Donors can find you by name, city, or EIN and add you to their dashboard. This card shows only
                  what you enter below — never anything about any donor. Changes save automatically.
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12 }}>
                  <div style={{ gridColumn: "1 / -1" }}><div style={lbl}>One-line description</div>
                    <input style={inp} maxLength={160} value={ps.directory_description || ""} disabled={disabled} onChange={e => setListing("directory_description", e.target.value)} placeholder="What you do, in one sentence" /></div>
                  <div><div style={lbl}>City</div>
                    <input style={inp} maxLength={80} value={ps.directory_city || ""} disabled={disabled} onChange={e => setListing("directory_city", e.target.value)} placeholder="Fairhope" /></div>
                  <div><div style={lbl}>State</div>
                    <input style={inp} maxLength={40} value={ps.directory_state || ""} disabled={disabled} onChange={e => setListing("directory_state", e.target.value)} placeholder="AL" /></div>
                </div>
              </div>
            )}
            {err && <div style={{ marginTop: 10, fontSize: 13, color: T.terracotta, fontWeight: 600 }}>{err}</div>}
          </div>
        )}
      </div>

      {/* BUILD-49 entry point (e) — the copy-paste website snippet lives with
          the other share/link artifacts here (gated enabled+listed+slug
          inside the card component). */}
      {ps && <PortalWebsiteSnippetCard ps={ps} />}

      <CampaignContentCard onNavigate={onNavigate} />
      <div style={{ marginBottom: 18 }}>
        <ImpactUpdatesManager isAdmin={isAdmin} isReadOnly={isReadOnly} />
      </div>
      <EngagementCard />
    </div>
  );
}
