// home/WeekFive.jsx · HOME-7 item 1. THIS WEEK'S FIVE.
//
// Under the greeting, one card: five people for the week, ranked by what is at
// stake (server/insights/weekFive.js chooses them and keeps them all week). The
// first open row is opened: name, its group, the figure, the reason, the draft
// and Add to calls (the one emerald button), Not now and Doesn't fit. The rest
// are one line each with Open. Done moves a person to the done strip; Not now
// and Doesn't fit bring in the next in rank. Under the card, how many more
// people have a next move, and See all opens the four-tab deck (`Deck`, the
// moves deck, kept whole as its own view). Nothing here sends.
import { useEffect, useRef, useState } from "react";
import { apiFetch, takeParked } from "../../api";
import { orgTodayCivil } from "../../lib/orgToday";
import { T } from "../shared";

const SERIF = "'DM Serif Display', Georgia, serif";
const B1 = { background: T.greenDk, color: T.white, border: "1px solid " + T.greenDk, borderRadius: 8, padding: "10px 16px", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit", minHeight: 44 };
const B2 = { background: T.white, color: T.ink, border: "1px solid " + T.bg3, borderRadius: 8, padding: "10px 16px", fontWeight: 600, fontSize: 14, cursor: "pointer", fontFamily: "inherit", minHeight: 44 };
const LNK = { background: "none", border: "none", padding: 0, color: T.greenDk, fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit", textDecoration: "underline", textUnderlineOffset: 3 };
const NAME = { background: "none", border: "none", padding: 0, fontFamily: "inherit", color: T.ink, fontWeight: 700, cursor: "pointer", textAlign: "left" };
const PILL = { display: "inline-block", fontSize: 12, fontWeight: 600, color: T.ink2, background: T.bg, borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" };
const RANK = { flex: "0 0 28px", height: 28, borderRadius: 999, border: "1px solid " + T.bg3, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 600, color: T.ink2 };
const ROW = { display: "flex", gap: 16, alignItems: "flex-start", padding: "16px 20px", borderTop: "1px solid " + T.bg2 };
const shortDay = d => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function WeekFive({ Deck, onNavigate, isReadOnly, noDonors, sample, importAbove, onSettled, onData, deckProps = {} }) {
  const [data, setData] = useState(() => { const p = takeParked("/home/five"); return p === undefined ? null : p; });
  const [err, setErr] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [deck, setDeck] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("moves") === "all");
  const [deckTab, setDeckTab] = useState(null);
  const take = d => { setData(d); if (onData) onData(d); };
  // The Planned card's See all opens the deck at its tab (home/homeWeek.jsx).
  useEffect(() => { const on = e => { setDeckTab(e.detail || null); setDeck(true); }; window.addEventListener("steward:home-deck", on); return () => window.removeEventListener("steward:home-deck", on); }, []);
  useEffect(() => {
    let alive = true;
    const keep = d => { if (alive) take(d); };
    const start = d => (d && d.preview && !isReadOnly ? apiFetch("/home/five/start", { method: "POST", body: "{}" }).then(keep).catch(() => {}) : null);
    if (data) { if (onData) onData(data); start(data); }
    else apiFetch("/home/five").then(d => { keep(d); start(d); }).catch(e => { if (alive) setErr(e); });
    return () => { alive = false; };
  }, []);
  // INSIGHTS-2: before an org's first Insights are built, read again until they are in.
  useEffect(() => { if (!data || !data.preparing) return; const t = setTimeout(() => apiFetch("/home/five").then(take).catch(() => {}), 4000); return () => clearTimeout(t); }, [data]);
  const settled = !!(data || err);
  useEffect(() => { if (settled && onSettled) onSettled(); }, [settled]);
  // MOPUP-2's rule for the five: a phone reserves the height the five drew last time (lib/movesGate.js).
  const boxRef = useRef(null);
  useEffect(() => { if (data && boxRef.current && deckProps.onDeckHeight) deckProps.onDeckHeight(boxRef.current.offsetHeight); }, [!!data]);

  if (deck && Deck) return (
    <div data-testid="home-five-all" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <button type="button" data-testid="home-five-back" style={{ ...LNK, alignSelf: "flex-start" }} onClick={() => setDeck(false)}>Back to this week's five</button>
      <Deck key={deckTab || "deck"} startTab={deckTab} onNavigate={onNavigate} isReadOnly={isReadOnly} noDonors={noDonors} sample={sample} importAbove={importAbove} {...deckProps} />
    </div>
  );
  if (err) return null;
  if (!data) return <section aria-label="This week's five" data-testid="home-five" className="home-card" style={{ color: T.ink3, fontSize: 14, minHeight: deckProps.reserve || 120, boxSizing: "border-box" }}>Reading your donors…</section>;
  if (noDonors && !data.open.length && !data.done.length && Deck) return <Deck onNavigate={onNavigate} isReadOnly={isReadOnly} noDonors sample={sample} importAbove={importAbove} {...deckProps} />;

  const open = data.open || [], done = data.done || [];
  const shown = Math.max(1, Math.min(5, open.length + done.length));
  const cur = open.find(r => r.id === openId) || open[0] || null;
  const openRow = r => { setOpenId(r.id); setMsg(null); };
  const person = id => onNavigate && onNavigate("donors", { selectDonorId: id });
  const act = async (path, body, said) => {
    if (busy || !cur || !cur.id) return;
    setBusy(true); setMsg(null);
    try { const d = await apiFetch(`/home/five/${encodeURIComponent(cur.id)}/${path}`, { method: "POST", body: JSON.stringify(body || {}) }); take(d); setOpenId(null); if (said) setMsg({ text: said }); }
    catch (e) { setMsg({ text: e.message || "That didn't work. Nothing was changed.", err: true }); }
    finally { setBusy(false); }
  };
  const toCalls = async () => {
    if (busy || !cur || !cur.id) return;
    setBusy(true); setMsg(null);
    try {
      const today = orgTodayCivil();
      const due = cur.whenFrom && cur.whenFrom > today ? cur.whenFrom : today;
      const notes = [cur.what, cur.say ? `Say: "${cur.say}"` : null, cur.ask ? cur.ask.words : null].filter(Boolean).join("\n\n");
      await apiFetch("/tasks", { method: "POST", body: JSON.stringify({ title: `Call ${cur.name}`.slice(0, 240), due, type: "donor", donorId: cur.donorId, priority: "medium", kind: "call", notes }) });
      await apiFetch(`/home/five/${encodeURIComponent(cur.id)}/called`, { method: "POST", body: JSON.stringify({ due }) });
      take({ ...data, open: open.map(r => (r.id === cur.id ? { ...r, calledOn: due } : r)) });
      setMsg({ text: `Call ${cur.name} is on your calls for ${shortDay(due)}. Nothing was sent.`, tasks: true });
    } catch (e) { setMsg({ text: e.message || "That didn't work. Nothing was changed.", err: true }); }
    finally { setBusy(false); }
  };
  const fig = r => <span style={{ whiteSpace: "nowrap" }}><b data-testid="five-stake" style={{ fontVariantNumeric: "tabular-nums", color: T.ink }}>{r.stakeWords}</b> <span style={{ color: T.ink3, fontSize: 13 }}>{r.figureWords}</span></span>;

  return (
    <div ref={boxRef} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <section aria-label="This week's five" data-testid="home-five" data-preview={data.preview ? "1" : undefined} className="home-card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "18px 20px 14px", display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ minWidth: 0, flex: "1 1 260px" }}>
            <h2 style={{ margin: 0, fontFamily: SERIF, fontSize: 26, fontWeight: 400, color: T.ink }}>This week's five</h2>
            <div style={{ fontSize: 13, color: T.ink3, marginTop: 4, lineHeight: 1.45 }}>{data.preparing ? "Insights are being prepared. Your five show here once they are in." : data.sentence}</div>
          </div>
          {!data.preparing && (open.length + done.length) > 0 && (
            <div data-testid="five-progress" style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
              <div aria-hidden style={{ display: "flex", gap: 4 }}>{[...Array(shown)].map((_, i) => <span key={i} style={{ width: 22, height: 6, borderRadius: 3, background: i < done.length ? T.greenDk : T.bg2 }} />)}</div>
              <span style={{ fontSize: 13, color: T.ink2 }}>{Math.min(done.length, shown)} of {shown} done</span>
            </div>
          )}
        </div>
        {!data.preparing && !open.length && !done.length && (
          <div data-testid="five-none" style={{ ...ROW, fontSize: 14.5, color: T.ink }}>No moves yet. Once gifts are in Steward, the people to reach out to show here, five a week.</div>
        )}
        {data.allDone && <div data-testid="five-all-done" style={{ ...ROW, fontSize: 15, color: T.ink }}>That's this week. Next week's five are ready Monday.</div>}
        {open.map((r, i) => {
          const rank = done.length + i + 1;
          if (cur && r.id === cur.id) return (
            <article key={r.donorId} data-testid="five-open" data-donor={r.donorId} style={{ ...ROW, background: T.bg + "66" }}>
              <span style={RANK}>{rank}</span>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", minWidth: 0 }}>
                    <button type="button" data-testid="five-name" style={{ ...NAME, fontFamily: SERIF, fontWeight: 400, fontSize: 24 }} onClick={() => person(r.donorId)}>{r.name}</button>
                    <span style={PILL}>{r.pill}</span>
                  </div>
                  {fig(r)}
                </div>
                <p data-testid="five-why" style={{ margin: 0, fontSize: 15, lineHeight: 1.55, color: T.ink }}>{r.what}</p>
                {r.say && <blockquote data-testid="five-draft" style={{ margin: 0, background: T.white, border: "1px solid " + T.bg2, borderRadius: 8, padding: "12px 14px", fontSize: 14.5, lineHeight: 1.55, fontStyle: "italic", color: T.ink }}>“{r.say}”</blockquote>}
                {r.calledOn && <div style={{ fontSize: 13, color: T.ink2 }}>On your calls for {shortDay(r.calledOn)}.</div>}
                {!isReadOnly && !data.preview && (
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    {!r.calledOn && <button type="button" data-testid="five-calls" style={B1} disabled={busy} onClick={toCalls}>Add to calls</button>}
                    <button type="button" data-testid="five-not-now" style={B2} disabled={busy} onClick={() => act("skip", { why: "not_now" }, `${r.name} is out of this week's five. The next person is in.`)}>Not now</button>
                    <button type="button" data-testid="five-not-fit" style={B2} disabled={busy} onClick={() => act("skip", { why: "not_fit" }, `Set aside. ${r.name} won't be suggested again.`)}>Doesn't fit</button>
                    <button type="button" data-testid="five-done" style={{ ...LNK, fontWeight: 600 }} disabled={busy} onClick={() => act("done", {}, `Done. ${r.name} is in this week's done list.`)}>Done</button>
                  </div>
                )}
              </div>
            </article>
          );
          return (
            <div key={r.donorId} data-testid="five-row" data-donor={r.donorId} style={{ ...ROW, alignItems: "center" }}>
              <span style={RANK}>{rank}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                  <button type="button" style={{ ...NAME, fontSize: 15 }} onClick={() => person(r.donorId)}>{r.name}</button><span style={PILL}>{r.pill}</span>
                </div>
                <div style={{ fontSize: 13.5, color: T.ink2, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.what}</div>
              </div>
              {fig(r)}
              <button type="button" data-testid="five-open-row" style={B2} onClick={() => openRow(r)}>Open</button>
            </div>
          );
        })}
        {done.length > 0 && (
          <div data-testid="five-done-strip" style={{ padding: "14px 20px", borderTop: "1px solid " + T.bg2, background: T.bg + "80" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.ink2, marginBottom: 6 }}>Done this week</div>
            {done.map(r => (
              <div key={r.donorId} style={{ fontSize: 14, color: T.ink, lineHeight: 1.7 }}>
                <span aria-hidden style={{ color: T.greenDk }}>✓ </span><button type="button" style={{ ...NAME, fontWeight: 600 }} onClick={() => person(r.donorId)}>{r.name}</button> · {r.outcome}
              </div>
            ))}
          </div>
        )}
        {msg && <div role="status" style={{ padding: "10px 20px", borderTop: "1px solid " + T.bg2, fontSize: 13.5, color: T.ink, ...(msg.err ? { borderLeft: "3px solid " + T.gold } : {}) }}>
          {msg.text}{msg.tasks && onNavigate && <> <button type="button" style={LNK} onClick={() => onNavigate("tasks")}>Open Tasks</button></>}</div>}
      </section>
      {!data.preparing && data.more > 0 && Deck && (
        <div data-testid="five-more" style={{ fontSize: 14, color: T.ink2 }}>
          {data.moreSentence} <button type="button" data-testid="five-see-all" style={LNK} onClick={() => setDeck(true)}>See all</button>
        </div>
      )}
    </div>
  );
}
