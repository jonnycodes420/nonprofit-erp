import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { API } from "../api";
import { QrCodeBlock, EmbedCodeBlock } from "../components/ShareBlocks";
import { T, fmtMoney } from "./publicTheme";

const inp = {
  width: "100%", boxSizing: "border-box",
  background: T.bg, border: "1px solid " + T.bg3,
  borderRadius: 10, padding: "11px 14px",
  color: T.ink, fontSize: 14, outline: "none", fontFamily: "inherit",
  marginBottom: 14,
};

// The entire "manage your fundraiser" auth model for v1 — the token in the
// URL IS the credential, no login. See peer_fundraisers.edit_token in
// db.js. Deliberately can't touch status/slug/email here (server-side
// enforced too) — this page only ever edits the fundraiser's own content.
export default function ManageFundraiser() {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ name: "", personalGoalAmount: "", story: "", imageUrl: "" });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch(`${API}/peer-fundraisers/manage/${token}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); }
        else {
          setData(d);
          setForm({
            name: d.name || "",
            personalGoalAmount: d.personalGoalAmount != null ? String(d.personalGoalAmount) : "",
            story: d.story || "",
            imageUrl: d.imageUrl || "",
          });
        }
        setLoading(false);
      })
      .catch(() => { setError("Could not load your fundraiser."); setLoading(false); });
  }, [token]);

  async function save(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true); setSaved(false);
    try {
      const r = await fetch(`${API}/peer-fundraisers/manage/${token}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not save changes.");
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e.message);
    }
    setSaving(false);
  }

  const BASE = {
    minHeight: "100vh", background: T.bg,
    fontFamily: "'DM Sans', system-ui, sans-serif",
    display: "flex", flexDirection: "column", alignItems: "center",
    padding: "40px 16px 80px",
  };
  const card = { width: "100%", maxWidth: 480, background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "22px 24px", marginBottom: 20 };

  if (loading) return (
    <div style={{ ...BASE, justifyContent: "center" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Serif+Display:ital@0;1&display=swap" rel="stylesheet" />
      <div style={{ width: 32, height: 32, border: "3px solid " + T.bg3, borderTopColor: T.greenDk, borderRadius: "50%", animation: "sp 0.7s linear infinite" }} />
      <style>{`@keyframes sp{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (error && !data) return (
    <div style={{ ...BASE, justifyContent: "center", textAlign: "center" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.2 }}>◈</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: "#dc2626", marginBottom: 8 }}>Link not found</div>
      <div style={{ fontSize: 13, color: T.ink3 }}>{error}</div>
    </div>
  );

  return (
    <div style={BASE}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Serif+Display:ital@0;1&display=swap" rel="stylesheet" />

      <div style={{ width: "100%", maxWidth: 480, marginBottom: 20, textAlign: "center" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
          Manage Your Fundraiser
        </div>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: T.ink, fontFamily: "'DM Serif Display', serif" }}>
          {data.givingPageTitle} · {data.orgName}
        </h1>
      </div>

      <div style={card}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: T.greenDk, fontFamily: "'DM Serif Display', serif" }}>{fmtMoney(data.raisedAmount)}</div>
          <div style={{ fontSize: 12, color: T.ink3 }}>raised so far</div>
        </div>
        {data.status === "archived" && (
          <div style={{ marginTop: 8, fontSize: 12, color: "#dc2626", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "8px 12px" }}>
            This fundraiser has been archived by {data.orgName} and is no longer visible to the public. You can still update your story below.
          </div>
        )}
      </div>

      <form onSubmit={save} style={card}>
        <div style={{ fontSize: 11, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>Your Fundraiser Page</div>
        <div style={{ fontSize: 12, fontWeight: 600, color: T.ink3, marginBottom: 4 }}>Your name</div>
        <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={inp} required />
        <div style={{ fontSize: 12, fontWeight: 600, color: T.ink3, marginBottom: 4 }}>Personal goal ($, optional)</div>
        <input type="number" value={form.personalGoalAmount} onChange={e => setForm(f => ({ ...f, personalGoalAmount: e.target.value }))} placeholder="e.g. 1000" style={inp} />
        <div style={{ fontSize: 12, fontWeight: 600, color: T.ink3, marginBottom: 4 }}>Your story</div>
        <textarea value={form.story} onChange={e => setForm(f => ({ ...f, story: e.target.value }))} rows={4} placeholder="Tell people why this cause matters to you." style={{ ...inp, resize: "vertical" }} />
        <div style={{ fontSize: 12, fontWeight: 600, color: T.ink3, marginBottom: 4 }}>Photo URL (optional)</div>
        <input value={form.imageUrl} onChange={e => setForm(f => ({ ...f, imageUrl: e.target.value }))} placeholder="https://…" style={{ ...inp, marginBottom: 6 }} />

        {error && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#dc2626", marginBottom: 14 }}>{error}</div>}

        <button type="submit" disabled={saving || !form.name.trim()}
          style={{
            width: "100%", background: saving ? T.bg3 : T.greenDk, border: "none", borderRadius: 12, padding: "13px",
            color: "#fff", fontSize: 14, fontWeight: 800, cursor: saving ? "not-allowed" : "pointer",
          }}>
          {saving ? "Saving…" : saved ? "✓ Saved" : "Save changes"}
        </button>
      </form>

      <div style={card}>
        <div style={{ fontSize: 11, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>Share Your Page</div>
        <div style={{ background: T.bg, borderRadius: 10, padding: "10px 14px", fontFamily: "monospace", fontSize: 12, color: T.ink2, wordBreak: "break-all", border: "1px solid " + T.bg3, marginBottom: 14 }}>
          {data.publicUrl}
        </div>
        <QrCodeBlock url={data.publicUrl} filenameBase={(form.name || "fundraiser").toLowerCase().replace(/[^a-z0-9]+/g, "-")} />
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Embed Code</div>
          <EmbedCodeBlock url={data.publicUrl} />
        </div>
      </div>

      <div style={{ textAlign: "center", fontSize: 11, color: T.ink3, lineHeight: 1.6 }}>
        Bookmark this page — this link is how you manage your fundraiser, there's no password to reset it with.
        <br />Powered by <span style={{ fontWeight: 700, color: T.greenDk }}>Steward</span>
      </div>
    </div>
  );
}
