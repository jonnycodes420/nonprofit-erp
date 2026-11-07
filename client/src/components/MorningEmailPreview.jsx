// TIDY-1 · Settings → Your email → the daily email, seen and tested.
// "Preview today's email" shows exactly what the morning tick would send her,
// rendered by the server's one builder (server/mail/morningBrief.js).
// "Send me a test" sends that email, marked [Test], to her own sign-in address
// only, at most 3 a day. "Last sent" is the last real morning email.
import { useState, useEffect } from "react";
import { T } from "./shared";
import { apiFetch } from "../api";
import { errorMessage } from "../lib/domainError";
import { displayDateTime } from "../../../shared/displayDate.js";

const btn = { background: "none", border: "1px solid " + T.bg3, borderRadius: 10, padding: "8px 14px", fontSize: 13.5, fontWeight: 700, color: T.greenDk, cursor: "pointer", fontFamily: "inherit" };

export function MorningEmailPreview() {
  const [d, setD] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const load = () => apiFetch("/me/morning-email").then(setD).catch(e => setNote(errorMessage(e, "Today's email did not load.")));
  useEffect(() => { load(); }, []);

  async function preview() {
    if (open) { setOpen(false); return; }
    setBusy("preview"); setNote("");
    await load(); setOpen(true); setBusy("");
  }
  async function test() {
    setBusy("test"); setNote("");
    try {
      const r = await apiFetch("/me/morning-email/test", { method: "POST", body: "{}" });
      setNote(`Sent to ${r.to}. ${r.testsLeft === 0 ? "That was your last test today." : `${r.testsLeft} more test${r.testsLeft === 1 ? "" : "s"} today.`}`);
      setD(x => x && { ...x, testsLeft: r.testsLeft });
    } catch (e) { setNote(errorMessage(e, "The test didn't send.")); }
    finally { setBusy(""); }
  }

  const last = d && d.lastSent;
  return (
    <div data-testid="morning-preview" style={{ borderTop: "1px solid " + T.bg2, paddingTop: 12, marginTop: 4 }}>
      <div data-testid="morning-last-sent" style={{ fontSize: 13, color: T.ink3, marginBottom: 10 }}>
        {!d ? " " : last
          ? <>Last sent {displayDateTime(last.at)}, with {last.items} item{last.items === 1 ? "" : "s"}.</>
          : "No morning email has been sent to you yet."}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" data-testid="morning-preview-btn" onClick={preview} disabled={busy === "preview"} style={btn}>
          {open ? "Hide the preview" : "Preview today's email"}</button>
        <button type="button" data-testid="morning-test-btn" onClick={test} disabled={busy === "test" || (d && d.testsLeft === 0)} style={btn}>
          Send me a test</button>
        {d && <span style={{ fontSize: 12, color: T.ink3 }}>Goes only to {d.to}. Up to {d.testsADay} a day.</span>}
      </div>
      {note && <div role="status" data-testid="morning-note" style={{ fontSize: 13, color: T.ink, marginTop: 8 }}>{note}</div>}
      {open && d && (
        <div style={{ marginTop: 12 }}>
          {d.whyWords && <div data-testid="morning-why" style={{ fontSize: 13, color: T.gold700, marginBottom: 8 }}>{d.whyWords}</div>}
          <div style={{ fontSize: 13, color: T.ink, marginBottom: 6 }}><b>Subject:</b> {d.subject}</div>
          <iframe title="Today's morning email" data-testid="morning-frame" sandbox="" srcDoc={d.html}
            style={{ width: "100%", height: 480, border: "1px solid " + T.bg3, borderRadius: 10, background: T.white }} />
        </div>
      )}
    </div>
  );
}
