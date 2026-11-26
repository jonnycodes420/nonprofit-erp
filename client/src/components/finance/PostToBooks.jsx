// LEDGER-3 item 3 · POST TO THE BOOKS. The waiting gifts, grouped by the
// deposit they came in with, each group with its count and total. She ticks
// the deposits she means and confirms; every gift posts as revenue to its own
// fund through the same write recordGift uses (server/finance/ledgerPost.js).
// Undo, on this card, takes exactly that batch back off.
import { useState, useEffect } from "react";
import { T, fmtFull, Card, SectionLabel } from "../shared";
import { apiFetch } from "../../api";
import { errorMessage } from "../../lib/domainError";
import { useLive } from "../../lib/liveRead";   // FRESH-3: the census holds it

const btn = (primary, off) => ({ background: primary ? T.green : "transparent", color: primary ? T.white : T.ink, border: primary ? "none" : "1px solid " + T.bg3,
  borderRadius: 8, padding: "7px 12px", fontSize: 12.5, fontWeight: 700, cursor: off ? "not-allowed" : "pointer", opacity: off ? 0.5 : 1 });
const SHOW = 12;

export default function PostToBooks({ isReadOnly, onChanged }) {
  const [d, setD] = useState(null);
  const [pick, setPick] = useState({});
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [err, setErr] = useState("");
  const load = () => apiFetch("/finance/ledger-post").then(r => { setD(r); setPick({}); }).catch(e => setErr(errorMessage(e, "The waiting gifts did not load.")));
  useEffect(() => { load(); }, []);
  useLive("finance.post-to-books", ["gift", "fund"], () => { if (!busy) load(); });
  if (!d) return err ? <Card><div role="alert" style={{ fontSize: 13, color: T.ink }}>{err}</div></Card> : null;
  if (d.postingOff || (!d.groups.length && !d.recent.length && !done)) return null;

  const chosen = d.groups.filter(g => pick[g.key]);
  const n = chosen.reduce((a, g) => a + g.n, 0), cents = chosen.reduce((a, g) => a + g.cents, 0);
  const shown = all ? d.groups : d.groups.slice(0, SHOW);
  const toggleAll = on => setPick(on ? Object.fromEntries(d.groups.map(g => [g.key, true])) : {});

  async function post() {
    setErr(""); setBusy(true);
    try {
      const every = chosen.length === d.groups.length;
      const body = every ? { all: { rows: d.groups.reduce((a, g) => a + g.rows, 0), cents: d.groups.reduce((a, g) => a + g.cents, 0) } }
        : { groups: chosen.map(g => ({ key: g.key, rows: g.rows, cents: g.cents })) };
      const r = await apiFetch("/finance/ledger-post", { method: "POST", body: JSON.stringify(body) });
      setDone(r); await load(); onChanged && onChanged();
    } catch (e) { setErr(errorMessage(e, "Nothing was posted.")); await load(); }
    finally { setBusy(false); }
  }
  async function undo(id) {
    setErr(""); setBusy(true);
    try { const r = await apiFetch(`/finance/ledger-post/${encodeURIComponent(id)}/undo`, { method: "POST", body: "{}" }); setDone({ undone: true, sentence: r.sentence }); await load(); onChanged && onChanged(); }
    catch (e) { setErr(errorMessage(e, "The undo did not go through.")); }
    finally { setBusy(false); }
  }

  return (
    <Card>
      <div data-testid="post-to-books">
        <SectionLabel>Post to the books</SectionLabel>
        <div style={{ fontSize: 13, color: T.ink2, lineHeight: 1.6, maxWidth: 700 }}>{d.sentence}</div>
        <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.55, marginTop: 4, maxWidth: 700 }}>{d.definition}</div>
        {d.undatedSentence && <div style={{ fontSize: 12, color: T.ink3, marginTop: 4 }}>{d.undatedSentence}</div>}
        {d.groups.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5, fontWeight: 700, color: T.ink, padding: "6px 0", borderBottom: "1px solid " + T.bg2 }}>
              <input type="checkbox" data-testid="post-all" disabled={isReadOnly} checked={d.groups.length > 0 && chosen.length === d.groups.length} onChange={e => toggleAll(e.target.checked)} />
              Every deposit ({d.groups.length})
            </label>
            <div>{/* no inner scrollbar (smoke-walk §scroll): 12 deposits, then Show all */}
              {shown.map(g => (
                <label key={g.key} data-testid="post-group" style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", fontSize: 13, padding: "7px 0", borderBottom: "1px solid " + T.bg2 }}>
                  <span style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
                    <input type="checkbox" disabled={isReadOnly} checked={!!pick[g.key]} onChange={e => setPick(p => ({ ...p, [g.key]: e.target.checked }))} />
                    <span style={{ color: T.ink }}>{g.label}</span>
                    <span style={{ color: T.ink3, fontSize: 12 }}>{g.n === 1 ? "1 gift" : `${g.n.toLocaleString("en-US")} gifts`}</span>
                  </span>
                  <span style={{ fontWeight: 700, color: T.ink, whiteSpace: "nowrap" }}>{fmtFull(g.amount)}</span>
                </label>
              ))}
            </div>
            {d.groups.length > SHOW && (
              <button type="button" onClick={() => setAll(a => !a)} style={{ ...btn(false), marginTop: 8 }}>{all ? "Show fewer" : `Show all ${d.groups.length} deposits`}</button>
            )}
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
              <button type="button" data-testid="post-confirm" disabled={isReadOnly || busy || !chosen.length} onClick={post} style={btn(true, isReadOnly || busy || !chosen.length)}>
                {chosen.length ? `Post ${n.toLocaleString("en-US")} ${n === 1 ? "gift" : "gifts"} (${fmtFull(cents / 100)})` : "Pick the deposits to post"}
              </button>
              <span style={{ fontSize: 12, color: T.ink3 }}>Each gift posts as revenue to its own fund, dated the day it was given.</span>
            </div>
          </div>
        )}
        {done && <div role="status" data-testid="post-result" style={{ fontSize: 13, color: T.ink, marginTop: 12 }}>{done.sentence}</div>}
        {err && <div role="alert" style={{ fontSize: 13, color: T.ink, marginTop: 10 }}>{err}</div>}
        {d.recent.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.ink3 }}>Recent postings</div>
            {d.recent.map(b => (
              <div key={b.id} data-testid="post-batch" style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", fontSize: 12.5, padding: "6px 0", borderBottom: "1px solid " + T.bg2 }}>
                <span style={{ color: T.ink }}>{`${b.n.toLocaleString("en-US")} ${b.n === 1 ? "gift" : "gifts"}, ${fmtFull(b.amount)}`}{b.by ? `, by ${b.by}` : ""}</span>
                {!isReadOnly && <button type="button" data-testid="post-undo" disabled={busy} onClick={() => undo(b.id)} style={btn(false, busy)}>Undo</button>}
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

