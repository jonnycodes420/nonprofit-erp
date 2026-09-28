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
  // BUILD-103 — the thank-you checklist is the fundraiser's own note to
  // themselves. It is kept optimistically so a tick feels like a tick, and
  // reconciled from the server's answer.
  const [gifts, setGifts] = useState([]);
  const [copied, setCopied] = useState("");
  const tick = async (g) => {
    const next = !g.thanked;
    setGifts(list => list.map(x => x.id === g.id ? { ...x, thanked: next } : x));
    try {
      const r = await fetch(`${API}/peer-fundraisers/manage/${token}/thanked`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ giftId: g.id, done: next }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "");
      const set = new Set(d.thanked || []);
      setGifts(list => list.map(x => ({ ...x, thanked: set.has(x.id) })));
    } catch { setGifts(list => list.map(x => x.id === g.id ? { ...x, thanked: !next } : x)); }
  };
  const copy = async (text, key) => {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(""), 2500); } catch { /* a browser that will not copy is not an error worth a banner */ }
  };

  useEffect(() => {
    fetch(`${API}/peer-fundraisers/manage/${token}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); }
        else {
          setData(d);
          setGifts(d.gifts || []);
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
      <div style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 24, marginBottom: 12, opacity: 0.6, letterSpacing: "-0.02em", color: T.ink }}>Steward</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: T.terra700, marginBottom: 8 }}>Link not found</div>
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

      {/* BUILD-103 Part 3 — THE DASHBOARD. What they have raised, with the
          one sentence that says what it counts; the gifts they may read; a
          thank-you checklist they tick themselves; and their team's standing.
          Nothing on this screen reveals a donor's email or a gift the donor
          made to the organisation outside this page. */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
          <div style={{ fontSize: 26, fontWeight: 800, color: T.greenDk, fontFamily: "'DM Serif Display', serif" }}>{fmtMoney(data.raisedAmount)}</div>
          <div style={{ fontSize: 12, color: T.ink3 }}>raised so far</div>
        </div>
        <div style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.5 }} data-testid="pf-raised-sentence">{data.raisedSentence}</div>
        {data.goalCents > 0 && (
          <div style={{ height: 6, background: T.bg2 || T.bg, borderRadius: 3, overflow: "hidden", marginTop: 10 }}>
            <div style={{ height: "100%", width: `${Math.min(100, Math.round((data.raisedCents / data.goalCents) * 100))}%`, background: T.greenDk, borderRadius: 3 }} />
          </div>
        )}
        {data.status === "archived" && (
          <div style={{ marginTop: 8, fontSize: 12, color: T.terra700, background: T.terra100, border: "1px solid "+T.terra200, borderRadius: 8, padding: "8px 12px" }}>
            This fundraiser has been archived by {data.orgName} and is no longer visible to the public. You can still update your story below.
          </div>
        )}
      </div>

      {data.gifts?.length > 0 && (
        <div style={card} data-testid="pf-gifts">
          <div style={{ fontSize: 11, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Gifts, and your thank-yous</div>
          <div style={{ fontSize: 12, color: T.ink3, marginBottom: 12, lineHeight: 1.5 }}>{data.giftsSentence}</div>
          {gifts.map(g => (
            <label key={g.id} data-testid="pf-gift-row"
              style={{ display: "flex", gap: 10, alignItems: "center", padding: "9px 0", borderTop: "1px solid " + T.bg3, cursor: "pointer" }}>
              <input type="checkbox" checked={!!g.thanked} onChange={() => tick(g)} style={{ accentColor: T.greenDk, width: 17, height: 17, flexShrink: 0 }} />
              <span style={{ fontSize: 14, color: T.ink, fontWeight: 600 }}>{g.who}</span>
              <span style={{ fontSize: 13, color: T.ink3, marginLeft: "auto" }}>{g.amount}</span>
              <span style={{ fontSize: 12, color: T.ink3, minWidth: 78, textAlign: "right" }}>{g.date}</span>
            </label>
          ))}
          <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 10 }}>
            Ticking a box is a note to yourself. Nobody is emailed from here, by you or by anybody else.
          </div>
        </div>
      )}

      {data.team && (
        <div style={card} data-testid="pf-team">
          <div style={{ fontSize: 11, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{data.team.name}</div>
          <div style={{ fontSize: 12.5, color: T.ink3, marginBottom: 12, lineHeight: 1.5 }}>{data.team.sentence}</div>
          {data.team.members.map((m, i) => (
            <div key={m.id} style={{ display: "flex", gap: 10, padding: "7px 0", borderTop: i ? "1px solid " + T.bg3 : "none", fontSize: 13.5 }}>
              <span style={{ color: T.ink3, width: 20 }}>{i + 1}</span>
              <span style={{ color: T.ink, fontWeight: m.isYou ? 800 : 500 }}>{m.name}{m.isYou ? " (you)" : ""}</span>
              <span style={{ marginLeft: "auto", color: T.ink }}>{fmtMoney(m.raisedCents / 100)}</span>
            </div>
          ))}
        </div>
      )}

      {data.drafts?.length > 0 && (
        <div style={card} data-testid="pf-drafts">
          <div style={{ fontSize: 11, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Words to send</div>
          <div style={{ fontSize: 12, color: T.ink3, marginBottom: 12, lineHeight: 1.5 }}>{data.draftsSentence}</div>
          {data.drafts.map(d => (
            <div key={d.key} style={{ borderTop: "1px solid " + T.bg3, paddingTop: 12, marginTop: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: T.ink }}>{d.label}</div>
              <div style={{ fontSize: 12, color: T.ink3, marginBottom: 8 }}>{d.when}</div>
              <div style={{ background: T.bg, border: "1px solid " + T.bg3, borderRadius: 10, padding: "10px 12px", fontSize: 12.5, color: T.ink2, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{d.body}</div>
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <button type="button" onClick={() => copy(d.body, d.key)}
                  style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 9, padding: "8px 13px", fontSize: 12.5, fontWeight: 700, color: T.ink, cursor: "pointer", fontFamily: "inherit" }}>
                  {copied === d.key ? "Copied" : "Copy it"}
                </button>
                <a href={d.mailto}
                  style={{ background: T.greenDk, borderRadius: 9, padding: "8px 13px", fontSize: 12.5, fontWeight: 700, color: T.pureWhite, textDecoration: "none" }}>
                  Open in my mail
                </a>
              </div>
            </div>
          ))}
        </div>
      )}

      {data.share && (
        <div style={card} data-testid="pf-share">
          <div style={{ fontSize: 11, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Share it</div>
          <div style={{ fontSize: 12, color: T.ink3, marginBottom: 12, lineHeight: 1.5 }}>
            Each of these carries a tag, so {data.orgName} can see which way of asking worked. It says the channel, never who you sent it to.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[["Text", data.share.text], ["WhatsApp", data.share.whatsapp], ["Facebook", data.share.facebook], ["Email", data.share.email]].map(([label, href]) => (
              <a key={label} href={href}
                style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 9, padding: "8px 13px", fontSize: 12.5, fontWeight: 700, color: T.ink, textDecoration: "none" }}>{label}</a>
            ))}
            <button type="button" onClick={() => copy(data.share.copy, "link")}
              style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 9, padding: "8px 13px", fontSize: 12.5, fontWeight: 700, color: T.ink, cursor: "pointer", fontFamily: "inherit" }}>
              {copied === "link" ? "Copied" : "Copy the link"}
            </button>
          </div>
        </div>
      )}

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

        {error && <div style={{ background: T.terra100, border: "1px solid "+T.terra200, borderRadius: 10, padding: "10px 14px", fontSize: 13, color: T.terra700, marginBottom: 14 }}>{error}</div>}

        <button type="submit" disabled={saving || !form.name.trim()}
          style={{
            width: "100%", background: saving ? T.bg3 : T.greenDk, border: "none", borderRadius: 12, padding: "13px",
            color: T.pureWhite, fontSize: 14, fontWeight: 800, cursor: saving ? "not-allowed" : "pointer",
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
