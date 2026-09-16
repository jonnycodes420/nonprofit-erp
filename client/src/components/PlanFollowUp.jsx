// BUILD-85 — PLANNING FORWARD.
//
// Every BUILD-81 opener required something to have already happened: a logged
// conversation, a gift, a drift-done, a sustainer lapse. "I am calling these
// twenty lapsed donors this month" had nowhere to live, so it lived in Tasks —
// which is exactly what kept two follow-up systems running side by side.
//
// This does NOT reopen the tasks battle. That rule was "logging a conversation
// must not require a second step", never "you may not plan". A planned thread
// is the same row as any other: one donor, one open step, one owner, closed by
// the same conversation flow. Its last touch reads "Planned" because nothing
// has happened yet, which is the honest thing for it to say.
//
// ONE OPEN THREAD PER DONOR still holds, and the server refuses (409) rather
// than replacing a commitment somebody already made — so this surface REPORTS
// a skip instead of pretending it planned something.
import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../api";
import { T, Modal } from "./shared";
import { errorMessage } from "../lib/domainError";
import { addCivilDays, sanitizeStepLabel, NEXT_STEP_LABEL_MAX } from "../../../shared/threadShape";

const todayLocal = () => new Date().toISOString().split("T")[0];

// A plan needs a verb and a date. These are the three a fundraiser reaches for
// most; the field stays free text, because a plan nobody can phrase is a plan
// nobody keeps.
const QUICK = ["Call", "Send an update", "Ask for a meeting"];

export function PlanFollowUpModal({ donor = null, donors = null, onSaved, onClose }) {
  const bulk = Array.isArray(donors) && donors.length > 0;
  const [label, setLabel] = useState("Call");
  const [due, setDue] = useState(addCivilDays(todayLocal(), 7));
  const [picked, setPicked] = useState(donor || null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState(null);
  const labelRef = useRef(null);
  useEffect(() => { labelRef.current?.focus(); }, []);

  // Donor search, only in the single-donor path with nobody chosen yet.
  useEffect(() => {
    if (bulk || picked || !q.trim()) { setHits([]); return; }
    const id = setTimeout(() => {
      apiFetch(`/donors?search=${encodeURIComponent(q.trim())}&limit=6`)
        .then(r => setHits(Array.isArray(r) ? r : (r.donors || [])))
        .catch(() => setHits([]));
    }, 220);
    return () => clearTimeout(id);
  }, [q, picked, bulk]);

  const clean = useMemo(() => sanitizeStepLabel(label), [label]);
  const ready = !!clean && /^\d{4}-\d{2}-\d{2}$/.test(due) && (bulk || !!picked);

  async function save() {
    if (!ready || busy) return;
    setBusy(true); setErr("");
    try {
      if (bulk) {
        const r = await apiFetch("/threads/plan", { method: "POST",
          body: JSON.stringify({ donorIds: donors.map(d => d.id), label: clean, due }) });
        setResult(r);
        if (r.skipped === 0) { onSaved?.(r); onClose?.(); }
      } else {
        const r = await apiFetch(`/donors/${picked.id}/threads`, { method: "POST",
          body: JSON.stringify({ label: clean, due }) });
        onSaved?.(r); onClose?.();
      }
    } catch (e) {
      // A 409 is not a failure, it is the model holding: say which commitment
      // is already there rather than a generic error.
      setErr(errorMessage(e, "Could not plan that follow-up."));
    } finally { setBusy(false); }
  }

  const fld = { width: "100%", padding: "9px 11px", border: "1px solid " + T.bg3, borderRadius: 8, fontSize: 14, color: T.ink, background: "#fff", boxSizing: "border-box" };
  const lbl = { fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: T.ink3, display: "block", marginBottom: 5 };

  return (
    <Modal onClose={onClose} width={480} backdrop="rgba(15,26,18,0.5)" blur={false} padding={22}
      ariaLabel="Plan a follow-up" dialogStyle={{ background: T.bg, borderRadius: 14 }}>
      <div>
        <div style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 21, color: T.ink }}>Plan a follow-up</div>
        <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 3, lineHeight: 1.55 }}>
          {bulk
            ? <>This opens a thread on {donors.length} {donors.length === 1 ? "donor" : "donors"}. Anyone who already has an open next step keeps it. A commitment already made outranks a plan being drawn up.</>
            : <>Nothing has to have happened yet. The step comes back to you on its date, the same as one that came out of a conversation.</>}
        </div>

        {!bulk && (
          <div style={{ marginTop: 16 }}>
            <label style={lbl}>Donor</label>
            {picked
              ? <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>{picked.name}</span>
                  {!donor && <button onClick={() => { setPicked(null); setQ(""); }} style={{ background: "none", border: "none", color: T.greenDk, fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>change</button>}
                </div>
              : <>
                  <input style={fld} value={q} onChange={e => setQ(e.target.value)} placeholder="Search donors by name or email" />
                  {hits.length > 0 && (
                    <div style={{ border: "1px solid " + T.bg3, borderTop: "none", borderRadius: "0 0 8px 8px", background: "#fff" }}>
                      {hits.map(h => (
                        <button key={h.id} onClick={() => { setPicked(h); setHits([]); }}
                          style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 11px", border: "none", background: "none", fontSize: 13, color: T.ink, cursor: "pointer" }}>
                          {h.name}{h.email ? <span style={{ color: T.ink3 }}> · {h.email}</span> : null}
                        </button>
                      ))}
                    </div>
                  )}
                </>}
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <label style={lbl}>What are you going to do?</label>
          <input ref={labelRef} style={fld} value={label} maxLength={NEXT_STEP_LABEL_MAX}
            onChange={e => setLabel(e.target.value)} placeholder="Call about the spring appeal" />
          <div style={{ display: "flex", gap: 6, marginTop: 7, flexWrap: "wrap" }}>
            {QUICK.map(k => (
              <button key={k} onClick={() => setLabel(k)}
                style={{ background: label === k ? T.greenDk : "transparent", color: label === k ? "#fff" : T.ink3,
                         border: "1px solid " + (label === k ? T.greenDk : T.bg3), borderRadius: 99, padding: "3px 10px", fontSize: 11.5, cursor: "pointer" }}>{k}</button>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <label style={lbl}>When should it come back?</label>
          <input type="date" style={{ ...fld, maxWidth: 190 }} value={due} onChange={e => setDue(e.target.value)} />
        </div>

        {err && <div style={{ marginTop: 14, fontSize: 12.5, color: T.terra700, background: T.terra100, border: "1px solid " + T.terra200, borderRadius: 8, padding: "9px 11px", lineHeight: 1.5 }}>{err}</div>}

        {result && (
          <div style={{ marginTop: 14, fontSize: 12.5, color: T.ink, background: T.bg2, borderRadius: 8, padding: "10px 12px", lineHeight: 1.55 }}>
            <strong>{result.planned}</strong> planned.
            {result.skipped > 0 && <> <strong>{result.skipped}</strong> already had an open next step and were left alone.</>}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20 }}>
          <button onClick={onClose} style={{ background: "transparent", border: "1px solid " + T.bg3, borderRadius: 8, padding: "9px 16px", fontSize: 13, color: T.ink3, cursor: "pointer" }}>
            {result ? "Done" : "Cancel"}
          </button>
          {!result && (
            <button onClick={save} disabled={!ready || busy}
              style={{ background: T.gold500, border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 700, color: T.ink, cursor: ready && !busy ? "pointer" : "not-allowed", opacity: ready && !busy ? 1 : 0.5 }}>
              {busy ? "Planning…" : bulk ? `Plan for ${donors.length}` : "Plan it"}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
