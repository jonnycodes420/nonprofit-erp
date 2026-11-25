// BUILDER-3 item 4 · REVIEW AN EMAIL. Two doors to one page:
//   /review/:token     an outside reviewer (a board member): no sign-in, the private link only.
//   /app/review/:id    someone in the organization, signed in.
// The email is shown as the one previewed person sees it, or with sample values. It is view only:
// opening it changes nothing. Comments go in only when the link allows them, and they stay in
// Steward (never in the email). An expired or turned-off link says so and shows nothing else.
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { API, apiFetch } from "../api";

const INK = "#0F1A12", WHITE = "#FFFFFF", CREAM = "#F0EDE6", EMERALD = "#0D5C3A";
const input = { fontSize: 14, padding: "9px 11px", border: `1px solid ${INK}33`, borderRadius: 8, fontFamily: "inherit", width: "100%", boxSizing: "border-box", background: WHITE, color: INK };
const when = d => { try { return new Date(d).toLocaleDateString("en-US", { month: "long", day: "numeric" }); } catch { return ""; } };

export default function ReviewPage({ inside = false }) {
  const { token, id } = useParams();
  const [d, setD] = useState(null);
  const [f, setF] = useState({ name: "", body: "", blockId: "" });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const read = () => (inside
    ? apiFetch(`/email-reviews/${encodeURIComponent(id)}`).then(setD).catch(e => setD({ gone: true, sentence: e && e.sentence }))
    : fetch(`${API}/public/email-review/${encodeURIComponent(token)}`).then(r => r.json().then(b => setD(r.ok ? b : { gone: true, sentence: b.sentence }))).catch(() => setD({ gone: true })));
  useEffect(() => { read(); }, [token, id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const post = async () => {
    if (!f.body.trim()) return;
    setBusy(true); setMsg("");
    try {
      if (inside) {
        const r = await apiFetch(`/email-templates/${d.templateId}/comments`, { method: "POST", body: JSON.stringify({ blockId: f.blockId || (d.parts[0] && d.parts[0].id), body: f.body }) });
        setMsg(r.sentence);
      } else {
        const r = await fetch(`${API}/public/email-review/${encodeURIComponent(token)}/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
        const b = await r.json();
        setMsg(b.sentence || "It could not be sent.");
      }
      setF(x => ({ ...x, body: "" }));
      await read();
    } catch (e) { setMsg((e && e.sentence) || "It could not be sent."); }
    setBusy(false);
  };
  if (!d) return <div style={{ padding: 40, fontFamily: "'DM Sans', Helvetica, Arial, sans-serif", color: INK }}>Loading…</div>;
  if (d.gone) return (
    <div data-testid="review-gone" style={{ minHeight: "100vh", background: CREAM, color: INK, fontFamily: "'DM Sans', Helvetica, Arial, sans-serif", padding: "60px 16px" }}>
      <div style={{ maxWidth: 520, margin: "0 auto", background: WHITE, borderRadius: 12, padding: 24 }}>{d.sentence || "This review link has expired or been turned off. Ask for a new one."}</div>
    </div>
  );
  return (
    <div data-testid="review-page" style={{ minHeight: "100vh", background: CREAM, color: INK, fontFamily: "'DM Sans', Helvetica, Arial, sans-serif", padding: "24px 16px 60px" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto", display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 600px", minWidth: 0 }}>
          <div style={{ fontSize: 12.5, letterSpacing: ".06em", textTransform: "uppercase", fontWeight: 700, color: EMERALD }}>An email to review</div>
          <h1 style={{ fontFamily: "Fraunces, Georgia, serif", fontSize: 26, margin: "4px 0 4px" }}>{d.name}</h1>
          <div data-testid="review-shown-as" style={{ fontSize: 13.5, marginBottom: 10 }}>
            <b>Subject:</b> {d.subject || "No subject yet"} · {d.sample ? "Shown with sample values" : `Shown as ${d.shownAs} sees it`} · View only, until {when(d.expiresAt)}
          </div>
          <iframe title="The email" data-testid="review-frame" sandbox="" srcDoc={d.html}
            style={{ width: "100%", height: "70vh", minHeight: 480, border: 0, borderRadius: 10, background: WHITE, colorScheme: "light" }} />
        </div>
        <aside style={{ flex: "1 1 300px", minWidth: 0, background: WHITE, borderRadius: 12, padding: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Comments</div>
          {!d.canComment && <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>This link is view only.</div>}
          {(d.comments || []).map(c => (
            <div key={c.id} data-testid="review-comment" style={{ borderTop: `1px solid ${INK}14`, padding: "8px 0", fontSize: 13.5, lineHeight: 1.45 }}><b>{c.authorName}</b> {c.body}</div>
          ))}
          {d.canComment && <div style={{ marginTop: 8 }}>
            {!inside && <input aria-label="Your name" placeholder="Your name" value={f.name} onChange={e => setF(x => ({ ...x, name: e.target.value }))} style={{ ...input, marginBottom: 6 }} />}
            <select aria-label="Which part" data-testid="review-part" value={f.blockId} onChange={e => setF(x => ({ ...x, blockId: e.target.value }))} style={{ ...input, marginBottom: 6 }}>
              <option value="">The whole email</option>
              {(d.parts || []).map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <textarea aria-label="Comment" data-testid="review-comment-text" rows={4} value={f.body} onChange={e => setF(x => ({ ...x, body: e.target.value }))} style={input} />
            <button type="button" data-testid="review-comment-post" disabled={busy || !f.body.trim()} onClick={post}
              style={{ marginTop: 8, width: "100%", fontSize: 15, fontWeight: 700, padding: "10px 14px", borderRadius: 10, border: 0, background: EMERALD, color: WHITE, cursor: "pointer", fontFamily: "inherit" }}>Send comment</button>
            {msg && <div role="status" style={{ fontSize: 13, marginTop: 8 }}>{msg}</div>}
          </div>}
        </aside>
      </div>
    </div>
  );
}
