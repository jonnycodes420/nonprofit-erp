// ONBOARD-3 · /print/notes — "Print this week's notes".
//
// One letter-size page (print CSS, the browser's own print dialog) listing
// everyone with a thank-you or note step due this week: the name, the mailing
// address on file, the last gift, the About note's detail, and a suggested
// first line written from those facts. Each row has a box to tick by hand.
// Printing stores and sends nothing; marking a note done stays in the app.
// Opened with ?print=1 (the buttons on Tasks and Home), it opens the print
// dialog once the list is drawn; with nobody due it says so and never prints blank.
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../api";

const C = { ink: "#0F1A12", white: "#FFFFFF", cream: "#F0EDE6", emerald: "#0D5C3A", muted: "#5a554f", line: "#ddd9d0" };
const SERIF = "'DM Serif Display',Georgia,serif";
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || "")); return m ? `${MON[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : ""; };
const usd = c => { const n = Number(c || 0); return `$${(n / 100).toLocaleString("en-US", { minimumFractionDigits: n % 100 ? 2 : 0, maximumFractionDigits: 2 })}`; };
const PRINT_CSS = `
@page { size: letter; margin: 0.55in; }
@media print {
  .pn-noprint { display: none !important; }
  body, .pn-page { background: #FFFFFF !important; }
  .pn-row { break-inside: avoid; }
}`;

export default function PrintNotes() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const printed = useRef(false);
  const wantPrint = (() => { try { return new URLSearchParams(window.location.search).get("print") === "1"; } catch { return false; } })();
  useEffect(() => { apiFetch("/notes/this-week").then(setD).catch(e => setErr((e && e.message) || "This week's notes could not be read.")); }, []);
  useEffect(() => {
    if (!d || printed.current || !wantPrint || !d.people.length) return;
    printed.current = true;
    setTimeout(() => window.print(), 300);
  }, [d, wantPrint]);
  return (
    <div className="pn-page" style={{ minHeight: "100vh", background: C.cream, color: C.ink, fontFamily: "'DM Sans',system-ui,sans-serif" }}>
      <style>{PRINT_CSS}</style>
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "20px 16px 48px", background: C.white }}>
        <div className="pn-noprint" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
          <a href="/app/tasks" style={{ color: C.emerald, fontSize: 13, fontWeight: 700 }}>← Back to Tasks</a>
          {d && d.people.length ? <button type="button" data-testid="pn-print" onClick={() => window.print()}
            style={{ marginLeft: "auto", background: C.emerald, color: C.white, border: 0, borderRadius: 8, padding: "9px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Print</button> : null}
        </div>
        <h1 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 28, margin: "0 0 4px" }}>Notes to write this week</h1>
        {d ? <p style={{ margin: "0 0 4px", fontSize: 13 }}>{day(d.week.from)} to {day(d.week.to)}</p> : null}
        {!d ? <p>{err || "Reading this week's notes…"}</p> : null}
        {d && d.empty ? <p data-testid="pn-empty" style={{ fontSize: 15, marginTop: 18 }}>{d.empty}</p> : null}
        {d && d.people.length ? <>
          <p style={{ margin: "0 0 14px", fontSize: 11.5, color: C.muted }}>{d.sentence} Tick each box by hand as you go; mark them done in Steward when you're back at your desk.</p>
          <ol data-testid="pn-list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {d.people.map(p => <li key={p.id} className="pn-row" data-testid="pn-row" data-id={p.id}
              style={{ display: "flex", gap: 12, padding: "12px 0", borderTop: `1px solid ${C.line}` }}>
              <span aria-hidden style={{ width: 16, height: 16, border: `1.5px solid ${C.ink}`, borderRadius: 2, flexShrink: 0, marginTop: 3 }} />
              <div style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: 1.45 }}>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
                  <strong style={{ fontSize: 15 }}>{p.name}</strong>
                  <span style={{ color: C.muted, fontSize: 12 }}>{p.step}, due {day(p.due)}</span>
                </div>
                <div>{p.address ? p.address.join(", ") : p.noMail ? "Marked do not mail: hand it over or skip." : "No mailing address on file."}</div>
                <div>{p.lastGift ? `Last gift ${usd(p.lastGift.cents)} on ${day(p.lastGift.date)}` : "No gift on file"}</div>
                {p.about ? <div><em>About them:</em> {p.about}</div> : null}
                <div style={{ marginTop: 4 }}><em>A first line:</em> “{p.firstLine}”</div>
              </div>
            </li>)}
          </ol>
        </> : null}
      </div>
    </div>
  );
}
