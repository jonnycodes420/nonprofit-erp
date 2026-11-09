import { useState } from "react";
import { apiFetch } from "../api";
import { errorMessage } from "../lib/domainError";
import { donorHref } from "../lib/appUrls";
import { T } from "./shared";

// INTEGRITY-2 (W-1107-Prod-04) · WHERE DOES EVERYONE COME FROM? The count
// opens into the parts that add up to it (donors, and contacts by type), what
// it never counts (the trash, archived, erased), and the newest records, so
// "1,218 against 1,217" can name the extra one. One read:
// GET /people/everyone-breakdown (shared/numbers/everyoneBreakdown.js).
const f = k => Number(k || 0).toLocaleString("en-US");
const dayOf = iso => { try { return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }); } catch { return ""; } };

export function EveryoneBreakdown({ count }) {
  const [open, setOpen] = useState(false);
  const [b, setB] = useState(null);
  const [err, setErr] = useState("");
  const toggle = () => {
    const next = !open; setOpen(next); setErr("");
    if (next) apiFetch("/people/everyone-breakdown", { cache: "no-store" }).then(setB).catch(e => setErr(errorMessage(e, "Could not count Everyone.")));
  };
  if (count == null) return null;
  return (
    <div style={{ fontSize: 12.5, color: T.ink }}>
      <button type="button" data-testid="everyone-breakdown-open" onClick={toggle} aria-expanded={open}
        style={{ background: "none", border: "none", padding: 0, color: T.greenDk, fontSize: 12.5, fontWeight: 700, cursor: "pointer", textDecoration: "underline", fontFamily: "inherit" }}>
        Where does {f(count)} come from?
      </button>
      {open && (
        <div data-testid="everyone-breakdown" style={{ marginTop: 6, background: T.white, border: "1px solid " + T.bg3, borderRadius: 10, padding: "10px 12px", maxWidth: 520, lineHeight: 1.55 }}>
          {err ? <div role="alert">{err}</div> : !b ? "Counting…" : (
            <>
              <div style={{ fontWeight: 700 }}>{b.sentence}</div>
              <ul style={{ margin: "4px 0 6px 18px", padding: 0 }}>
                {b.parts.map(p => (
                  <li key={p.key}>{p.label}: {f(p.n)}. {p.sentence}
                    {p.parts && <ul style={{ margin: "2px 0 0 16px", padding: 0 }}>{p.parts.map(c => <li key={c.key}>{c.label}: {f(c.n)}</li>)}</ul>}
                  </li>
                ))}
              </ul>
              <div style={{ color: T.ink3 }}>{b.notCounted.sentence}</div>
              {b.newest.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <div style={{ fontWeight: 700 }}>The newest records:</div>
                  <ul style={{ margin: "2px 0 0 18px", padding: 0 }}>
                    {b.newest.map(x => <li key={x.id}><a href={donorHref(x.id)} style={{ color: T.greenDk }}>{x.name}</a>, {x.how}, {dayOf(x.createdAt)}</li>)}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
