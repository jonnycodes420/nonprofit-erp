import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { useAuth } from "../main";

const T = {
  bg: "#f0ede6", bg2: "#e8e4db", bg3: "#ddd9d0",
  ink: "#0f0f0f", ink2: "#2a2a2a", ink3: "#6b6b6b",
  green: "#10b981", greenDk: "#0d5c3a", gold: "#c9a84c",
  amber: "#d97706", red: "#dc2626",
};

const ACTION_LABEL = { call: "Call", email: "Email", thank: "Thank", meeting: "Meeting" };
const ACTION_COLOR = { call: "#10b981", email: "#3b82f6", thank: "#c9a84c", meeting: "#8b5cf6" };

function TodayCard({ item, onDismiss }) {
  const [expanded, setExpanded] = useState(false);
  const [noteType, setNoteType] = useState(item.action === "thank" ? "email" : item.action);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const logFollowUp = async () => {
    setSaving(true);
    try {
      await apiFetch(`/donors/${item.donorId}/interactions`, {
        method: "POST",
        body: JSON.stringify({
          type: noteType,
          note: note || `Follow-up from Today view`,
          date: new Date().toISOString().split("T")[0],
        }),
      });
      onDismiss(item.donorId);
    } catch {
      alert("Could not save — please try again.");
      setSaving(false);
    }
  };

  const accentColor = ACTION_COLOR[item.action] || T.green;

  return (
    <div style={{
      background: "#fff", border: `1px solid ${T.bg3}`, borderRadius: 14,
      padding: "18px 20px", marginBottom: 12,
      boxShadow: "0 2px 8px rgba(15,15,15,0.04)",
      borderLeft: `3px solid ${accentColor}`,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1 }}>

          {/* Badge row: action pill + lapsing pill + donor name */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3, flexWrap: "wrap" }}>
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
              color: accentColor, background: accentColor + "18", borderRadius: 6, padding: "2px 8px",
            }}>
              {ACTION_LABEL[item.action] || item.action}
            </span>
            {item.isLapsing && (
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
                color: T.amber, background: T.amber + "18", borderRadius: 6, padding: "2px 8px",
              }}>
                ⚠ Lapsing
              </span>
            )}
            <span style={{ fontSize: 16, fontWeight: 700, color: T.ink }}>{item.donorName}</span>
          </div>

          {/* Lifetime giving — stakes at a glance */}
          {item.totalGiving > 0 && (
            <div style={{ fontSize: 12, color: T.ink3, marginBottom: 8 }}>
              ${item.totalGiving.toLocaleString()} lifetime giving
            </div>
          )}

          {/* Reason — the hero */}
          <p style={{ margin: "0 0 4px", fontSize: 14, color: T.ink2, lineHeight: 1.55 }}>
            {item.reason}
          </p>

          {/* Days overdue — task cards only */}
          {item.daysOverdue > 0 && (
            <p style={{ margin: "0 0 12px", fontSize: 12, fontWeight: 600, color: T.red }}>
              Overdue by {item.daysOverdue} day{item.daysOverdue !== 1 ? "s" : ""}
            </p>
          )}
          {!item.daysOverdue && <div style={{ marginBottom: 12 }} />}

          {/* Action buttons */}
          {!expanded && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                onClick={() => setExpanded(true)}
                style={{
                  background: T.green, border: "none", borderRadius: 8,
                  padding: "7px 16px", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer",
                }}
              >
                {item.action === "thank" ? "Log thank-you" : `Log ${ACTION_LABEL[item.action] || "follow-up"}`}
              </button>
              <button
                onClick={() => { window.location.href = "/dashboard"; }}
                style={{
                  background: "transparent", border: `1px solid ${T.bg3}`,
                  borderRadius: 8, padding: "7px 16px", color: T.ink3, fontSize: 13, cursor: "pointer",
                }}
              >
                ✉ Draft email
              </button>
            </div>
          )}

          {/* Inline log form */}
          {expanded && (
            <div style={{ marginTop: 2 }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                {["call", "email", "meeting"].map(t => (
                  <button
                    key={t}
                    onClick={() => setNoteType(t)}
                    style={{
                      background: noteType === t ? T.green : T.bg2, border: "none", borderRadius: 8,
                      padding: "5px 12px", color: noteType === t ? "#fff" : T.ink3,
                      fontSize: 12, fontWeight: noteType === t ? 700 : 400, cursor: "pointer",
                    }}
                  >
                    {t[0].toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Quick note (optional)…"
                rows={2}
                style={{
                  width: "100%", background: T.bg, border: `1px solid ${T.bg3}`,
                  borderRadius: 8, padding: "9px 12px", fontSize: 13, color: T.ink,
                  fontFamily: "inherit", resize: "none", boxSizing: "border-box", outline: "none",
                }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button
                  onClick={logFollowUp}
                  disabled={saving}
                  style={{
                    background: T.green, border: "none", borderRadius: 8,
                    padding: "7px 16px", color: "#fff", fontSize: 13, fontWeight: 700,
                    cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1,
                  }}
                >
                  {saving ? "Saving…" : "Save & clear ✓"}
                </button>
                <button
                  onClick={() => setExpanded(false)}
                  style={{
                    background: "transparent", border: `1px solid ${T.bg3}`,
                    borderRadius: 8, padding: "7px 16px", color: T.ink3, fontSize: 13, cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        <button
          onClick={() => onDismiss(item.donorId)}
          title="Dismiss"
          style={{
            background: "transparent", border: "none", color: T.ink3,
            fontSize: 20, cursor: "pointer", padding: "0 4px", lineHeight: 1, flexShrink: 0, marginTop: -2,
          }}
        >×</button>
      </div>
    </div>
  );
}

export default function TodayPage() {
  const { auth } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const orgName = auth?.org?.name || "Steward";

  // Fix 1: proper-case the first name — never "ADMIN" or "admin"
  const rawName = (auth?.user?.name || "").trim();
  const firstName = rawName.split(/\s+/)[0] || "";
  const userName = firstName
    ? firstName[0].toUpperCase() + firstName.slice(1).toLowerCase()
    : "";

  useEffect(() => {
    apiFetch("/dashboard/today")
      .then(data => setItems(Array.isArray(data) ? data : []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  const dismiss = (donorId) => setItems(prev => prev.filter(i => i.donorId !== donorId));

  return (
    <div style={{ minHeight: "100vh", background: T.bg, fontFamily: "'DM Sans',system-ui,sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Serif+Display&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{
        borderBottom: `1px solid ${T.bg3}`, padding: "14px 32px",
        display: "flex", alignItems: "center", justifyContent: "space-between", background: "#fff",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 30, height: 30, background: T.green, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <path d="M8 2L13 5v6L8 14 3 11V5L8 2z" stroke="#fff" strokeWidth="1.5" fill="none" />
              <circle cx="8" cy="8" r="2" fill="#fff" />
            </svg>
          </div>
          <span style={{ fontWeight: 700, fontSize: 15, color: T.ink, letterSpacing: "-0.02em" }}>{orgName}</span>
        </div>
        <a
          href="/dashboard"
          style={{ fontSize: 13, color: T.ink3, textDecoration: "none", display: "flex", alignItems: "center", gap: 4 }}
        >
          Full workspace ↗
        </a>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "52px 24px 80px" }}>
        <h1 style={{
          fontFamily: "'DM Serif Display',Georgia,serif",
          fontSize: "clamp(32px,5vw,48px)", fontWeight: 400,
          color: T.ink, letterSpacing: "-0.02em", margin: "0 0 12px", lineHeight: 1.1,
        }}>
          {userName ? `Good morning, ${userName}.` : "Good morning."}
        </h1>

        {loading ? (
          <p style={{ color: T.ink3, fontSize: 14, marginTop: 32 }}>Loading your follow-ups…</p>
        ) : items.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "60px 20px", textAlign: "center" }}>
            <div style={{ marginBottom: 20, color: T.green, opacity: 0.7 }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
            </div>
            <h2 style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 22, fontWeight: 400, color: T.ink, margin: "0 0 10px", letterSpacing: "-0.01em" }}>
              You're all caught up.
            </h2>
            <p style={{ fontSize: 14, color: T.ink3, maxWidth: 280, lineHeight: 1.65, margin: "0 0 24px" }}>
              No follow-ups due today. Add donors to start tracking relationships.
            </p>
            <button
              onClick={() => { window.location.href = "/dashboard"; }}
              style={{ background: "#1a6b4a", border: "none", borderRadius: 12, padding: "12px 24px", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
            >
              Add your first donor →
            </button>
          </div>
        ) : (
          <>
            <p style={{ fontSize: 15, color: T.ink3, margin: "0 0 36px" }}>
              <strong style={{ color: T.greenDk }}>{items.length} {items.length === 1 ? "person needs" : "people need"} your attention</strong> today.
            </p>
            {items.map(item => (
              <TodayCard key={item.donorId} item={item} onDismiss={dismiss} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
