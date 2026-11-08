import { useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { errorMessage } from "../../lib/domainError";
import { told } from "../../lib/stewardTold";
import { T } from "../shared";

// INTEGRITY-2 · THE TRASH (W-1107-Finance-35). A searchable list of the
// people in the trash: who deleted each one, when and why ("Import undo of
// donors.csv, 8 Nov"), and the day they leave on their own. Restore on each
// row and on a selection, through the one door back, so their gifts, notes,
// household and relationship links come back with them.
const PAGE = 50;
const dayOf = iso => { try { return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); } catch { return ""; } };

export function TrashList({ isAdmin, isReadOnly, onChanged }) {
  const [q, setQ] = useState("");
  const [data, setData] = useState(null);
  const [more, setMore] = useState([]);
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");
  const [err, setErr] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!isAdmin) return undefined;
    let live = true;
    const t = setTimeout(() => {
      apiFetch(`/trash/people?limit=${PAGE}&q=${encodeURIComponent(q)}`, { cache: "no-store" })
        .then(r => { if (live) { setData(r); setMore([]); setPicked(new Set()); } })
        .catch(e => { if (live) setErr(errorMessage(e, "Could not read the trash.")); });
    }, q ? 250 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [q, isAdmin, tick]);

  if (!isAdmin) return null;
  const people = data ? [...data.people, ...more] : [];
  const showMore = async () => {
    try { const r = await apiFetch(`/trash/people?limit=${PAGE}&offset=${people.length}&q=${encodeURIComponent(q)}`, { cache: "no-store" }); setMore(m => [...m, ...r.people]); }
    catch (e) { setErr(errorMessage(e, "Could not read the trash.")); }
  };
  const restore = async ids => {
    setBusy(true); setErr(""); setSaid("");
    try {
      const r = await apiFetch("/trash/people/restore", { method: "POST", body: JSON.stringify({ ids }) });
      // the restored rows leave the list at once; the recount follows
      const back = new Set(r.ids || []);
      setData(d => d && { ...d, people: d.people.filter(p => !back.has(p.id)), total: Math.max(0, d.total - back.size), inTrash: Math.max(0, d.inTrash - back.size),
        sentence: d.sentence.replace(/^[\d,]+ (people are|person is)/, () => { const k = Math.max(0, d.inTrash - back.size); return `${k.toLocaleString("en-US")} ${k === 1 ? "person is" : "people are"}`; }) });
      setMore(m => m.filter(p => !back.has(p.id))); setPicked(new Set());
      setSaid(r.sentence || "Restored."); setTick(k => k + 1); told({ donors: true }); if (onChanged) onChanged();
    } catch (e) { setErr(e?.body?.sentence || errorMessage(e, "Nobody was restored.")); }
    setBusy(false);
  };
  const toggle = id => setPicked(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const btn = primary => ({ background: primary ? T.greenDk : T.white, color: primary ? T.white : T.ink, border: primary ? "none" : "1px solid " + T.bg3,
    borderRadius: 8, padding: "6px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" });

  return (
    <div data-testid="trash-list" style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 13, color: T.ink3, lineHeight: 1.6, marginBottom: 10 }}>{data ? data.sentence : "Reading the trash…"}</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
        <input data-testid="trash-search" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name or email"
          aria-label="Search the trash" style={{ flex: "1 1 220px", minWidth: 0, padding: "7px 10px", border: "1px solid " + T.bg3, borderRadius: 8, fontFamily: "inherit", fontSize: 13 }} />
        <button type="button" data-testid="trash-restore-selected" style={{ ...btn(true), opacity: picked.size && !isReadOnly ? 1 : 0.45 }}
          disabled={!picked.size || busy || isReadOnly} onClick={() => restore([...picked])}>
          {busy ? "Restoring…" : `Restore ${picked.size ? picked.size.toLocaleString("en-US") + " " : ""}selected`}
        </button>
      </div>
      {said && <div role="status" data-testid="trash-restored" style={{ fontSize: 13, margin: "6px 0", color: T.ink }}>{said}</div>}
      {err && <div role="alert" style={{ fontSize: 13, margin: "6px 0", color: T.ink }}>{err}</div>}
      {data && !people.length && <div style={{ fontSize: 13, color: T.ink3 }}>{q ? "Nobody in the trash matches that." : "The trash is empty."}</div>}
      {people.length > 0 && (
        <div style={{ border: "1px solid " + T.bg3, borderRadius: 10, overflow: "hidden" }}>
          {people.map(p => (
            <div key={p.id} data-testid="trash-row" style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "9px 12px", borderTop: "1px solid " + T.bg3, background: T.white, flexWrap: "wrap" }}>
              <input type="checkbox" aria-label={`Select ${p.name}`} checked={picked.has(p.id)} onChange={() => toggle(p.id)} style={{ marginTop: 3 }} />
              <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5, color: T.ink }}>{p.name}{p.email ? <span style={{ fontWeight: 400, color: T.ink3 }}> · {p.email}</span> : null}</div>
                <div style={{ fontSize: 12.5, color: T.ink3 }}>
                  {p.why} · by {p.deletedBy}{p.gifts ? ` · ${p.gifts.toLocaleString("en-US")} ${p.gifts === 1 ? "gift" : "gifts"}` : ""} · leaves on its own {dayOf(p.leavesOn)}
                </div>
              </div>
              <button type="button" data-testid="trash-restore" style={btn(false)} disabled={busy || isReadOnly} onClick={() => restore([p.id])}>Restore</button>
            </div>
          ))}
        </div>
      )}
      {data && people.length < data.total && (
        <button type="button" style={{ ...btn(false), marginTop: 8 }} onClick={showMore}>Show more ({(data.total - people.length).toLocaleString("en-US")} left)</button>
      )}
    </div>
  );
}
